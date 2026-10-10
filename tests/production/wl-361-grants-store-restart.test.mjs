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

        const active = await system.chain.grants.grantAsync({
          agentId: shared.id,
          capability: 'action:read-registry',
          reason: 'تدقيقُ حادثةٍ رقم 361',
          principal: { id: 'king:test', role: 'role:king', state: 'active' },
          ttlSeconds: ttlActive,
        });
        assert.ok(typeof active.id === 'string' && active.id.trim() !== '', 'منحةٌ بلا معرّف');

        // منحةٌ ستنتهي مدتُها بينَ الإقلاعَين: تُقدَّمُ لقطتُها على القرصِ إلى الماضي أدناه.
        const expired = await system.chain.grants.grantAsync({
          agentId: shared.id,
          capability: 'action:read-audit',
          reason: 'انتهتْ مدتُها',
          principal: { id: 'king:test', role: 'role:king', state: 'active' },
          ttlSeconds: ttlActive,
        });
        assert.ok(typeof expired.id === 'string');
        // منحةٌ تُسحبُ فوراً
        const revoked = await system.chain.grants.grantAsync({
          agentId: shared.id,
          capability: 'action:write-memory',
          reason: 'تُسحبُ فوراً',
          principal: { id: 'king:test', role: 'role:king', state: 'active' },
          ttlSeconds: ttlActive,
        });
        await system.chain.grants.revokeAsync(revoked.id, 'سُحِبَت');
        // **WL-361 (‏`R6-A-05`، تتمّةُ «المنح»): الحفظُ «الشاهدُ المختومُ أوّلاً ثمّ الملفُّ» —
        // فقبلَ قراءةِ اللقطةِ يُنتظرُ صرفُ عملياتِ الحفظِ المعلَّقةِ (`persist()`).**
        await system.chain.grants.persist();

        // الملفُّ مكتوبٌ على القرص
        assert.ok(
          readFileSync(shared.grantsFilePath, 'utf8').includes('action:read-registry'),
          'لقطةُ المنحِ غابتْ عن القرص',
        );

        assert.ok(system.chain.grants.capabilitiesOf(shared.id).has('action:read-registry'));
        assert.ok(!system.chain.grants.capabilitiesOf(shared.id).has('action:write-memory'));
      },
      // **بينَ الإقلاعَين (`WL-361`):** الحقنَ السابقَ للملفِّ (إزاحةُ grantedAt/expiresAt على القرص)
      // كانَ تزويراً بمعيارِ العقدِ الجديدِ — فالشاهدُ المختومُ يُقارِنُ الحقولَ كلَّها، والمسُّ
      // للقرصِ مرفوضٌ. تُختبرُ الانتهاءُ بساعةِ الدفترِ: «القراءةُ نفسُها تُقاسُ بالساعةِ المُمرَّرة،
      // فمنحٌ انتهى لا يظهرُ في القدراتِ الفعّالة» — تُزحزَحُ الساعةُ لا الملفُّ.
      async (system, shared) => {
        assert.ok(system.chain.grants.capabilitiesOf(shared.id).has('action:read-audit'));
        const originalNow = system.chain.grants.now;
        system.chain.grants.now = () => new Date(Date.now() + 3700_000);
        try {
          assert.equal(
            system.chain.grants.capabilitiesOf(shared.id).has('action:read-audit'),
            false,
            'منحٌ انتهى لا يظهرُ في القدراتِ الفعّالةِ ولو لم يُحذفْ من المخزنِ',
          );
        } finally {
          system.chain.grants.now = originalNow;
        }
      },
      // العمليةُ الثالثة: يُعادُ بناءُ الدفترِ من القرصِ — الساريةُ تبقى والمنتهيةُ لا تعودُ والمسحوبةُ لا تُبعث.
      // والانتهاءُ يُختبرُ بساعةِ الدفترِ (مضيُّ ساعةٍ وسبعِ دقائق) لا بمسِّ الملفِّ — فتزويرُ
      // الملفِّ مرفوضٌ بعقدِ الشاهدِ، والانتهاءُ يُسقطُ القدرةَ بالقراءةِ لا بالحذفِ.
      async (system, shared) => {
        assert.ok(
          system.chain.grants.capabilitiesOf(shared.id).has('action:read-registry'),
          'منحٌ سارٍ فُقدَ بإعادةِ التشغيلِ',
        );
        assert.ok(
          !system.chain.grants.capabilitiesOf(shared.id).has('action:write-memory'),
          'منحٌ مسحوبٌ أُحييَ',
        );
        const originalNow = system.chain.grants.now;
        system.chain.grants.now = () => new Date(Date.now() + 3700_000);
        try {
          assert.equal(
            system.chain.grants.capabilitiesOf(shared.id).has('action:read-audit'),
            false,
            'منحٌ منتهيٌ عادَ بعدَ انتهاءِ مدتِه',
          );
        } finally {
          system.chain.grants.now = originalNow;
        }
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
        await system.chain.grants.grantAsync({
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
        await system.chain.grants.grantAsync({
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

// ═══════════════════════════════════════════════════════════════════════════════
// WL-361 (تتمّة) — الاختباراتُ السلبيةُ: لا منحَ بلا شاهدٍ مختومٍ، ولا تزويرَ للملفِّ
// ═══════════════════════════════════════════════════════════════════════════════

describe('WL-361 (تتمّة) — رفضُ المنحِ المزوَّرةِ: لا منحَ بلا شاهدٍ مختومٍ', () => {
  test('منحٌ مزوَّرةٌ بلا شاهدٍ مختومٍ ⇒ رفضُ إقلاعٍ CAPABILITY_GRANT_UNWITNESSED', async () => {
    const root = tmpRoot();
    try {
      const agentId = 'agent:worker';
      const forged = [
        {
          id: 'grant:00000000-0000-4000-8000-000000000001',
          agentId,
          capability: 'action:read-registry',
          reason: 'عنوانٌ مزوَّرٌ',
          grantedBy: 'king:test',
          grantorRole: 'role:king',
          grantedAt: '2026-10-10T00:00:00.000Z',
          expiresAt: '2999-01-01T00:00:00.000Z', // مدّةٌ غيرُ معقولةٍ فوقَ السقفِ
          revokedAt: null,
          revokedReason: null,
        },
      ];
      writeFileSync(join(root, 'capability-grants.json'), JSON.stringify(forged, null, 2), 'utf8');

      const socket = new TestFreshnessSocket(0n, 'wl361forged');
      const { boot } = rig({ freshnessSocket: socket });
      await assert.rejects(
        () => boot(root),
        /CAPABILITY_GRANT_UNWITNESSED/,
        'منحٌ مزوَّرةٌ بلا شاهدٍ مختومٍ تُقبَلُ صامتةً',
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('منحٌ مزوَّرةٌ بمدّةٍ فوقَ سقفِ الكتالوجِ بلا شاهدٍ ⇒ رفضٌ حتى لو كانَ المانحُ المزعومُ سليمَ البنيةِ', async () => {
    const root = tmpRoot();
    try {
      const forged = [
        {
          id: 'grant:00000000-0000-4000-8000-000000000002',
          agentId: 'agent:worker',
          capability: 'action:read-registry',
          reason: 'م',
          grantedBy: 'king:test',
          grantorRole: 'role:king',
          grantedAt: '2026-10-10T00:00:00.000Z',
          expiresAt: '2999-01-01T00:00:00.000Z',
          revokedAt: null,
          revokedReason: null,
        },
      ];
      writeFileSync(join(root, 'capability-grants.json'), JSON.stringify(forged, null, 2), 'utf8');
      const socket = new TestFreshnessSocket(0n, 'wl361ttl');
      const { boot } = rig({ freshnessSocket: socket });
      // الرفضُ يقعُ على الشاهدِ لا على الملفِّ: لا شاهدَ ⇒ UNWITNESSED (قواعدُ الكتالوجِ تُفحَصُ
      // بعدَ وجودِ الشاهدِ لا قبلهُ — فلا يَمرُّ ملفٌّ بمنحٍ فوقَ السقفِ أصلاً).
      await assert.rejects(() => boot(root), /CAPABILITY_GRANT_UNWITNESSED/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('منحٌ حقيقيةٌ ثمّ سحبٌ على القرصِ بلا شاهدِ سحبٍ ⇒ تبقى مسحوبةً (لا توسيعٍ)', async () => {
    const root = tmpRoot();
    try {
      const socket = new TestFreshnessSocket(0n, 'wl361hiddenrevoke');
      const { boot } = rig({ freshnessSocket: socket });
      const shared = { id: '', grantsFilePath: join(root, 'capability-grants.json') };
      let revokedGrantId = '';

      const system = await boot(root);
      try {
        const agent = await system.chain.registry.register({ name: 'x', role: 'role:minister' });
        shared.id = agent.id;
        const granted = await system.chain.grants.grantAsync({
          agentId: shared.id,
          capability: 'action:write-memory',
          reason: 'ثُمّ يُسحَبُ',
          principal: { id: 'king:test', role: 'role:king', state: 'active' },
          ttlSeconds: 3600,
        });
        revokedGrantId = granted.id;
        await system.chain.grants.revokeAsync(revokedGrantId, 'سُحِبَت');
        await system.chain.grants.persist();
      } finally {
        await system.close();
      }

      // تزويرٌ: محوُ السحبِ من الملفِّ (إعادةُ revokedAt إلى null) وإخفاءُ السحبِ
      const raw = JSON.parse(readFileSync(shared.grantsFilePath, 'utf8'));
      const entry = raw.find((g) => g.id === revokedGrantId);
      assert.ok(entry, 'المنحةُ غابتْ عن القرصِ');
      entry.revokedAt = null;
      entry.revokedReason = null;
      writeFileSync(shared.grantsFilePath, JSON.stringify(raw, null, 2), 'utf8');

      // والنتيجةُ: إقلاعٌ يُبعثُ المنحَ **مسحوبةً** من الشاهدِ لا ساريةً من الملفِّ
      const system2 = await boot(root);
      try {
        assert.ok(
          !system2.chain.grants.capabilitiesOf(shared.id).has('action:write-memory'),
          'تزويرُ إخفاءِ السحبِ نفعَ',
        );
        const restored = system2.chain.grants.grants.get(revokedGrantId);
        assert.ok(restored, 'المنحةُ غابتْ من الذاكرةِ');
        assert.notEqual(restored.revokedAt, null, 'منحٌ مُزوَّرُ إخفاءِ سحبِهِ عادَتْ ساريةً');
      } finally {
        await system2.close();
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('انقطاعٌ بينَ ختمِ الشاهدِ وحفظِ الملفِّ ⇒ منحٌ لا يُقبَلُ من ملفٍّ لا يشهدُ له السجلُّ', async () => {
    // المحاكاةُ: منحٌ شُهِدَ لهُ في السجلِّ (الحدثُ مختومٌ) ثمّ انقطاعٌ **قبلَ** حفظِ الملفّ.
    // النتيجةُ المقبولةُ: الملفُّ لا يحملُ المنحَ فتضيعُ (تضييقٌ)، ولا يحملُها بلا شاهدٍ أبداً.
    const root = tmpRoot();
    try {
      const socket = new TestFreshnessSocket(0n, 'wl361crash');
      const { boot } = rig({ freshnessSocket: socket });
      const shared = { id: '', grantsFilePath: join(root, 'capability-grants.json') };

      const system = await boot(root);
      try {
        const agent = await system.chain.registry.register({ name: 'y', role: 'role:minister' });
        shared.id = agent.id;
        // تعليقُ الحفظِ صراحةً: المنحُ يقعُ (شاهدُهُ يُسجَّلُ في السجلِّ) والملفُّ لا يُحدَّثُ
        system.chain.grants.suspendPersistForTest();
        await system.chain.grants.grantAsync({
          agentId: shared.id,
          capability: 'action:read-registry',
          reason: 'قبلَ الانقطاعِ',
          principal: { id: 'king:test', role: 'role:king', state: 'active' },
          ttlSeconds: 3600,
        });
        // ختمُ الشاهدِ يقعُ (flush) بلا حفظِ ملفٍّ — انقطاعٌ بينَ الخطوتَينِ
        await system.rootOfTrust.log.flush?.();
      } finally {
        await system.close();
      }

      // الإقلاعُ التالي: الملفُّ لا يحملُ المنحَ (فُقدت — تضييقٌ)، ولا يحملُها بلا شاهدٍ
      const system2 = await boot(root);
      try {
        assert.equal(
          system2.chain.grants.capabilitiesOf(shared.id).has('action:read-registry'),
          false,
          'منحٌ لم يُحفَظْ ملفُّهُ عادَ سارياً',
        );
      } finally {
        await system2.close();
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('انقطاعٌ بينَ ختمِ السحبِ وحفظِهِ ⇒ المنحةُ تُبعَثُ **مسحوبةً** من الشاهدِ لا ساريةً', async () => {
    const root = tmpRoot();
    try {
      const socket = new TestFreshnessSocket(0n, 'wl361crashrevoke');
      const { boot } = rig({ freshnessSocket: socket });
      const shared = { id: '', grantsFilePath: join(root, 'capability-grants.json') };
      let revokedGrantId = '';

      const system = await boot(root);
      try {
        const agent = await system.chain.registry.register({ name: 'z', role: 'role:minister' });
        shared.id = agent.id;
        const granted = await system.chain.grants.grantAsync({
          agentId: shared.id,
          capability: 'action:read-registry',
          reason: 'تُسحَبُ بعدَها',
          principal: { id: 'king:test', role: 'role:king', state: 'active' },
          ttlSeconds: 3600,
        });
        revokedGrantId = granted.id;
        await system.chain.grants.persist();
        // السحبُ يقعُ بشاهدِهِ (الحدثُ يُسجَّلُ) ثمّ انقطاعٌ **قبلَ** حفظِ الملفّ:
        system.chain.grants.suspendPersistForTest();
        await system.chain.grants.revokeAsync(revokedGrantId, 'سُحِبَت');
        await system.rootOfTrust.log.flush?.();
      } finally {
        await system.close();
      }

      // الإقلاعُ التالي: الملفُّ لا يعرفُ السحبَ، والشاهدُ المختومُ يعرفُهُ — فالمنحةُ
      // تُبعَثُ **مسحوبةً** (الاتجاهُ الأضيقُ يفوزُ) لا ساريةً.
      const system2 = await boot(root);
      try {
        const restored = system2.chain.grants.grants.get(revokedGrantId);
        assert.ok(restored, 'المنحةُ فُقدتْ من الذاكرةِ');
        assert.notEqual(
          restored.revokedAt,
          null,
          'انقطاعٌ بينَ ختمِ السحبِ وحفظِهِ أعادَ المنحَ ساريةً',
        );
        assert.ok(
          !system2.chain.grants.capabilitiesOf(shared.id).has('action:read-registry'),
          'القدرةُ المسحوبةُ عادتْ',
        );
      } finally {
        await system2.close();
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
