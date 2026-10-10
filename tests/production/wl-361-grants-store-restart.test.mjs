// @ts-nocheck
// WL-361 — `R6-A-05` (شطرُ «المنح»): دفترُ منحِ القدراتِ في الإنتاجِ دوّامٌ عبرَ إعادةِ
// التشغيلِ. المشغّلُ الإنتاجيُّ يمرِّرُ `FileCapabilityGrantStore` صراحةً إلى جذرِ التركيبِ
// (`composeEnforcementChain`) — فمنحاً سارياً لا يُمحى بإعادةِ التشغيلِ، والمسحوبُ لا يُبعث،
// والمنتهي لا يعود، وفسادُ اللقطةِ رفعٌ لا افتراضُ صفرٍ.
//
// (التجهيزُ منسوخٌ من `wl-305-quarantine-restart.test.mjs` كي يبقى الملفُّ قائماً بنفسِه.)

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  createCipheriv,
  createDecipheriv,
  generateKeyPairSync,
  randomBytes,
  sign as softwareSign,
} from 'node:crypto';
import { Buffer } from 'node:buffer';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { registerTmpRoot } from '../helpers/tmp-roots.mjs';
import { createProductionSystem } from '../../src/production/entrypoint.mjs';
import { InMemoryFreshnessSocket, fingerprint } from '../../src/root-of-trust/index.mjs';
import { registerTestKing, royalKeyEnv } from '../helpers/royal-halt-command.mjs';

/** `LIVE-24`: مفتاحٌ ملكيٌّ مستقلٌّ عن مفتاحِ المرساةِ في التوكن. */
const ROYAL_KEY = royalKeyEnv();

/** مقبسُ حداثةٍ للاختبارِ بلا علامةِ testFixture — يَلفُّ InMemoryFreshnessSocket. */
class TestFreshnessSocket {
  constructor(initial = 0n, anchorPrefix = 'test') {
    this.inner = new InMemoryFreshnessSocket(initial, anchorPrefix);
  }
  read() {
    return this.inner.read();
  }
  bump() {
    return this.inner.bump();
  }
  advance() {
    return this.inner.advance();
  }
  failNext() {
    return this.inner.failNext();
  }
}

function stableToken(king, aeadKey, ledgerPair) {
  const aad = Buffer.from('xuux-event');
  const ed = new Map([
    ['06', king],
    ['07', ledgerPair],
  ]);
  return {
    describe: () => ({ kind: 'pkcs11-hsm', canExport: false, tokenSerial: 'DEADBEEFCAFE0001' }),
    getAeadKey: async (keyId) => {
      if (keyId !== '05') throw new Error('KEY_NOT_FOUND');
      return {
        keyId,
        encrypt: async (plaintext) => {
          const iv = randomBytes(12);
          const cipher = createCipheriv('aes-256-gcm', aeadKey, iv);
          cipher.setAAD(aad);
          return {
            ciphertext: Buffer.concat([cipher.update(plaintext), cipher.final()]),
            iv,
            tag: cipher.getAuthTag(),
          };
        },
        decrypt: async (ciphertext, iv, tag) => {
          const decipher = createDecipheriv('aes-256-gcm', aeadKey, iv);
          decipher.setAAD(aad);
          decipher.setAuthTag(tag);
          return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
        },
      };
    },
    getSigningKey: async (keyId) => {
      const pair = ed.get(keyId);
      if (!pair) throw new Error('KEY_NOT_FOUND');
      return {
        keyId,
        sign: async (message) => softwareSign(null, message, pair.privateKey),
        exportPublicPem: async () => pair.publicKey.export({ type: 'spki', format: 'pem' }),
      };
    },
  };
}

function fixedKeys() {
  return {
    king: registerTestKing(generateKeyPairSync('ed25519')),
    aeadKey: randomBytes(32),
    ledgerPair: registerTestKing(generateKeyPairSync('ed25519')),
  };
}

function rig({ freshnessSocket = null, keys, env: extraEnv = {} } = {}) {
  const k = keys ?? fixedKeys();
  const env = {
    NODE_ENV: 'production',
    STATE_ENV: 'production',
    XUUX_ROOT_OF_TRUST_MODE: 'hsm',
    XUUX_PKCS11_MODULE: '/usr/lib/softhsm/libsofthsm2.so',
    XUUX_PKCS11_TOKEN: 'xuux-test',
    XUUX_PKCS11_TOKEN_SERIAL: 'DEADBEEFCAFE0001',
    XUUX_PKCS11_MODULE_SHA256: 'f'.repeat(64),
    XUUX_PKCS11_PIN: 'unused-by-injected-source',
    XUUX_KING_ID: 'king:' + fingerprint(k.king.publicKey).slice(0, 24),
    ...ROYAL_KEY.env,
    XUUX_ROOT_OF_TRUST_PROVISION: '1',
    ...extraEnv,
  };
  const testClock = {
    now: () => Date.now(),
    assertTrusted: () => undefined,
    attestation: () => ({
      atMs: Date.now(),
      radiusMs: 1000,
      ageMs: 0,
      sources: ['ci-test'],
      localSkewMs: 0,
    }),
  };
  const boot = (root) =>
    createProductionSystem(
      env,
      { root, freshnessSocket, clock: testClock },
      {
        openSource: async () => ({
          source: stableToken(k.king, k.aeadKey, k.ledgerPair),
          close: async () => undefined,
        }),
      },
    );
  return { boot, keys: k, env };
}

function tmpRoot() {
  return registerTmpRoot(mkdtempSync(join(tmpdir(), 'xuux-wl361-')));
}

/** @typedef {Awaited<ReturnType<typeof createProductionSystem>>} ProductionSystem */
/** @typedef {(system: ProductionSystem, shared: { id: string, grantsFilePath: string }) => Promise<void>} Step */

/**
 * يُقلِعُ النظامَ الإنتاجيَّ على جذرٍ واحدٍ مرّاتٍ متتالية.
 * @param {Step[]} steps
 */
async function lifecycle(steps) {
  const root = tmpRoot();
  const socket = new TestFreshnessSocket(0n, 'wl361');
  const { boot } = rig({ freshnessSocket: socket });
  const shared = { id: '', grantsFilePath: join(root, 'capability-grants.json') };
  try {
    for (const step of steps) {
      const system = await boot(root);
      try {
        await step(system, shared);
      } finally {
        await system.close();
      }
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe('WL-361 — دوامُ منحِ القدراتِ في الإنتاجِ عبرَ إعادةِ التشغيلِ (R6-A-05)', () => {
  test('منحٌ سارٍ لا يُمحى بإعادةِ التشغيلِ — والمسحوبُ لا يُبعثُ — والمنتهي لا يعود', async () => {
    await lifecycle([
      // العمليةُ الأولى: يُسجَّلُ وكيلٌ ثمّ تُمنَحُ منحةٌ ساريةٌ ومنتهيةٌ ومسحوبةٌ.
      async (system, shared) => {
        const agent = await system.chain.registry.register({ name: 'w', role: 'role:minister' });
        shared.id = agent.id;

        const ttlActive = 3600; // ساعةٌ من الآن

        const active = system.chain.grants.grant({
          agentId: shared.id,
          capability: 'action:read-registry',
          reason: 'تدقيقُ حادثةٍ رقم 361',
          principal: { id: 'king:test', role: 'role:king', state: 'active' },
          ttlSeconds: ttlActive,
        });
        assert.ok(typeof active.id === 'string' && active.id.trim() !== '', 'منحةٌ بلا معرّف');

        // منحةٌ ستنتهي مدتُها بينَ الإقلاعَين: تُقدَّمُ لقطتُها على القرصِ إلى الماضي أدناه.
        const expired = system.chain.grants.grant({
          agentId: shared.id,
          capability: 'action:read-audit',
          reason: 'انتهتْ مدتُها',
          principal: { id: 'king:test', role: 'role:king', state: 'active' },
          ttlSeconds: ttlActive,
        });
        assert.ok(typeof expired.id === 'string');
        // منحةٌ تُسحبُ فوراً
        const revoked = system.chain.grants.grant({
          agentId: shared.id,
          capability: 'action:write-memory',
          reason: 'تُسحبُ فوراً',
          principal: { id: 'king:test', role: 'role:king', state: 'active' },
          ttlSeconds: ttlActive,
        });
        system.chain.grants.revoke(revoked.id, 'سُحِبَت');

        // الملفُّ مكتوبٌ على القرص
        assert.ok(
          readFileSync(shared.grantsFilePath, 'utf8').includes('action:read-registry'),
          'لقطةُ المنحِ غابتْ عن القرص',
        );

        assert.ok(system.chain.grants.capabilitiesOf(shared.id).has('action:read-registry'));
        assert.ok(!system.chain.grants.capabilitiesOf(shared.id).has('action:write-memory'));
      },
      // بينَ الإقلاعَين: تمرُّ مدّةُ إحدى المنحِ (تُزحزَحُ على القرصِ) كأنّ الزمنَ مضى.
      async (system, shared) => {
        assert.ok(system.chain.grants.capabilitiesOf(shared.id).has('action:read-audit'));
        const snap = JSON.parse(readFileSync(shared.grantsFilePath, 'utf8'));
        const entry = snap.find((g) => g.capability === 'action:read-audit');
        assert.ok(entry, 'منحةُ read-audit غابت عن اللقطة');
        entry.expiresAt = new Date(Date.now() - 60_000).toISOString();
        entry.grantedAt = new Date(Date.now() - 3_600_000).toISOString();
        writeFileSync(shared.grantsFilePath, JSON.stringify(snap), 'utf8');
      },
      // العمليةُ الثالثة: يُعادُ بناءُ الدفترِ من القرصِ — الساريةُ تبقى والمنتهيةُ لا تعودُ والمسحوبةُ لا تُبعث.
      async (system, shared) => {
        assert.ok(
          system.chain.grants.capabilitiesOf(shared.id).has('action:read-registry'),
          'منحٌ سارٍ فُقدَ بإعادةِ التشغيلِ',
        );
        assert.ok(
          !system.chain.grants.capabilitiesOf(shared.id).has('action:read-audit'),
          'منحٌ منتهيٌ عادَ بعدَ انتهاءِ مدتِه',
        );
        assert.ok(
          !system.chain.grants.capabilitiesOf(shared.id).has('action:write-memory'),
          'منحٌ مسحوبٌ أُحييَ',
        );
      },
    ]);
  });

  test('فسادُ اللقطةِ رفعٌ لا افتراضُ صفرٍ — منحٌ مجهولُ الحالةِ لا يُفترَضُ سليماً', async () => {
    const root = tmpRoot();
    const socket = new TestFreshnessSocket(0n, 'wl361corrupt');
    const { boot } = rig({ freshnessSocket: socket });
    const shared = { id: '', grantsFilePath: join(root, 'capability-grants.json') };
    try {
      // العمليةُ الأولى: منحٌ واحدةٌ سليمة
      const system = await boot(root);
      try {
        const agent = await system.chain.registry.register({ name: 'c', role: 'role:minister' });
        shared.id = agent.id;
        system.chain.grants.grant({
          agentId: shared.id,
          capability: 'action:read-registry',
          reason: 'قبلَ الفساد',
          principal: { id: 'king:test', role: 'role:king', state: 'active' },
          ttlSeconds: 3600,
        });
        assert.ok(system.chain.grants.capabilitiesOf(shared.id).size > 0);
      } finally {
        await system.close();
      }

      // تُفسَدُ اللقطةُ
      writeFileSync(shared.grantsFilePath, 'not-valid-json{', 'utf8');

      // العمليةُ الثانية: يُرفَضُ الإقلاعُ لا افتراضُ صفرٍ
      await assert.rejects(boot(root), /تعذُّرَ قراءةُ ملفِّ منحِ القدرات|CAPABILITY_GRANT_STORE/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('الملفُّ الغائبُ إقلاعٌ نظيفٌ: لا منحَ ولا خطأ', async () => {
    await lifecycle([
      async (system, shared) => {
        const agent = await system.chain.registry.register({ name: 'n', role: 'role:minister' });
        shared.id = agent.id;
        assert.equal(system.chain.grants.capabilitiesOf(shared.id).size, 0);
      },
      async (system, shared) => {
        assert.equal(system.chain.grants.capabilitiesOf(shared.id).size, 0);
      },
    ]);
  });

  test('بصمةُ الحالةِ المختومةِ لا تتغيّرُ بوجودِ المخزنِ — لا كاتبَ ثانٍ في الجذرِ', async () => {
    await lifecycle([
      async (system, shared) => {
        const agent = await system.chain.registry.register({ name: 'f', role: 'role:minister' });
        shared.id = agent.id;
        system.chain.grants.grant({
          agentId: shared.id,
          capability: 'action:read-registry',
          reason: 'قياسُ بصمةِ الحالةِ',
          principal: { id: 'king:test', role: 'role:king', state: 'active' },
          ttlSeconds: 3600,
        });
        assert.ok(system.chain.grants.capabilitiesOf(shared.id).size > 0);
      },
      async (system, shared) => {
        // المنحُ دوّامٌ والنظامُ يُقلِعُ — فالملفُّ خارجَ بصمةِ الحالةِ المختومةِ لا يُفسِدُها
        assert.ok(system.chain.grants.capabilitiesOf(shared.id).size > 0);
        assert.ok(system.chain.quarantine !== null);
        assert.ok(system.chain.enforcementPoint !== null);
      },
    ]);
  });
});
