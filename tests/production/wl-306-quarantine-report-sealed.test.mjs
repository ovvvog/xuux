// @ts-nocheck
// WL-306 — `LIVE-27`: نافذةُ الفقدِ بينَ رجوعِ الإبلاغِ عن الحجرِ وختمِ قيدِه.
//
// النافذةُ المقيسة: `QuarantineWarden.report` متزامنٌ، فيُدرِجُ `quarantine.isolated` في طابورِ
// `sealedAudit` ويُرجِعُ قبلَ ختمِه. وكلُّ ما يقعُ بعدَ الرجوعِ وقبلَ الختمِ — سقوطُ العمليّةِ أو
// غيابُ التوكن — يُسقِطُ القيد، فيُطلَقُ المحجورُ بالإقلاعِ التالي (‏`quarantineFromSealedLog` لا
// يجدُ شاهداً). وتُحاكى «الوفاةُ» هنا بتوكنٍ يكفُّ عن الختمِ **بعدَ رجوعِ الإبلاغ** مباشرةً.
//
// (‏التجهيزُ منسوخٌ من `wl-305-quarantine-restart.test.mjs` معَ مفتاحِ «وفاةِ التوكن».)

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
import { mkdtempSync, rmSync } from 'node:fs';
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

/** مفتاحُ «الوفاة»: إذا رُفِعَ كفَّ التوكنُ عن الختم (‏كما لو ماتت العمليّةُ أو انتُزِعَ التوكن). */
const DEATH = { dead: false };

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
          if (DEATH.dead) throw new Error('TOKEN_GONE');
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
  return registerTmpRoot(mkdtempSync(join(tmpdir(), 'xuux-wl306-')));
}

/** يُبلِّغُ بالمسارِ الإنتاجيِّ المتاح: `reportSealed` بعدَ الإصلاح، و`report` على `main` قبلَه. */
async function reportContainment(warden, signal) {
  return typeof warden.reportSealed === 'function'
    ? warden.reportSealed(signal)
    : warden.report(signal);
}

/** إقلاعٌ ⇒ فعلٌ ⇒ «وفاةٌ» بعدَ رجوعِه ⇒ إغلاقٌ ⇒ إقلاعٌ جديدٌ يُعادُ عليه الفحص. */
async function crashAfter(act, check) {
  const root = tmpRoot();
  const socket = new TestFreshnessSocket(0n, 'wl306');
  const { boot } = rig({ freshnessSocket: socket });
  DEATH.dead = false;
  const shared = {};
  try {
    const first = await boot(root);
    try {
      await act(first, shared);
    } finally {
      DEATH.dead = true;
      await first.close().catch((error) => {
        shared.closeError = error;
      });
      DEATH.dead = false;
    }
    const second = await boot(root);
    try {
      await check(second, shared);
    } finally {
      await second.close();
    }
  } finally {
    DEATH.dead = false;
    rmSync(root, { recursive: true, force: true });
  }
}

describe('WL-306 — LIVE-27: لا نافذةَ فقدٍ بينَ الإبلاغِ عن الحجرِ وختمِه', () => {
  test('L1 — حجرٌ أُبلِغَ ثمّ «ماتت» العمليّةُ بعدَ رجوعِ الإبلاغ ⇒ المحجورُ محجورٌ بعدَ الإقلاع', async () => {
    await crashAfter(
      async (system, shared) => {
        const agent = await system.chain.registry.register({ name: 'l1', role: 'role:king' });
        shared.id = agent.id;
        const r = await reportContainment(system.chain.quarantine, {
          kind: 'model-fingerprint-mismatch',
          subject: agent.id,
        });
        assert.equal(r.isolated, true);
      },
      async (system, shared) => {
        assert.equal(system.chain.quarantine.isQuarantined(shared.id), true);
        const types = system.auditLog.events
          .filter((e) => e.actor === shared.id && e.type.startsWith('quarantine.'))
          .map((e) => e.type);
        // الترتيبُ محفوظٌ: الإشارةُ ثمّ العزلُ ثمّ الإعادةُ عندَ الإقلاع.
        assert.deepEqual(types, [
          'quarantine.signal',
          'quarantine.isolated',
          'quarantine.restored',
        ]);
      },
    );
  });

  test('L2 — الإبلاغُ المتزامنُ على السجلِّ المختومِ يُرَدُّ قبلَ أيِّ أثر', async () => {
    await crashAfter(
      async (system, shared) => {
        const agent = await system.chain.registry.register({ name: 'l2', role: 'role:king' });
        shared.id = agent.id;
        assert.throws(
          () =>
            system.chain.quarantine.report({
              kind: 'model-fingerprint-mismatch',
              subject: agent.id,
            }),
          (e) => e.code === 'QUARANTINE_REPORT_REQUIRES_SEALED',
        );
        assert.equal(system.chain.quarantine.isQuarantined(agent.id), false);
      },
      async (system, shared) => {
        assert.equal(
          system.auditLog.events.some(
            (e) => e.actor === shared.id && e.type.startsWith('quarantine.'),
          ),
          false,
        );
      },
    );
  });

  test('L3 — فشلُ الختمِ أثناءَ الإبلاغِ يُرفَعُ ولا يُخرِجُ المحجورَ ولا يفتحُ نقطةَ الإنفاذ', async () => {
    await crashAfter(
      async (system, shared) => {
        const agent = await system.chain.registry.register({ name: 'l3', role: 'role:king' });
        shared.id = agent.id;
        DEATH.dead = true;
        await assert.rejects(
          () =>
            system.chain.quarantine.reportSealed({
              kind: 'model-fingerprint-mismatch',
              subject: agent.id,
            }),
          /TOKEN_GONE/,
        );
        DEATH.dead = false;
        assert.equal(system.chain.quarantine.isQuarantined(agent.id), true);
        // المُحوِّلُ مسمومٌ بعدَ أوّلِ فشلٍ: لا قرارَ يُصدَرُ بعدَه، لا سماحَ صامت.
        await assert.rejects(() =>
          system.chain.enforcementPoint.authorize({
            actor: {
              id: agent.id,
              kind: 'service',
              role: 'role:king',
              state: 'active',
              capabilities: [],
            },
            action: 'stop-state',
            resource: { type: 'state', id: 'sovereign' },
            context: {},
          }),
        );
      },
      async (_system, shared) => {
        assert.match(String(shared.closeError?.message ?? shared.closeError), /TOKEN_GONE/);
      },
    );
  });
});
