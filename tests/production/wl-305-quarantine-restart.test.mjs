// @ts-nocheck
// WL-305 — `R6-A-05`: حالةُ الحجرِ في النظامِ الإنتاجيِّ المُقلَعِ تدومُ عبرَ إعادةِ التشغيلِ،
// تُعادُ من السجلِّ المختومِ (‏`quarantineFromSealedLog`) قبلَ أيِّ طلب، ولا تُخرَجُ إلا بسببٍ مسجَّل.
//
// (‏التجهيزُ منسوخٌ من `wl-303-sovereign-authorization.test.mjs` كي يبقى الملفُّ قائماً بنفسِه.)

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  createCipheriv,
  createDecipheriv,
  generateKeyPairSync,
  randomBytes,
  randomUUID,
  sign as softwareSign,
} from 'node:crypto';
import { Buffer } from 'node:buffer';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { registerTmpRoot } from '../helpers/tmp-roots.mjs';
import { createProductionSystem } from '../../src/production/entrypoint.mjs';
import { InMemoryFreshnessSocket, fingerprint } from '../../src/root-of-trust/index.mjs';
import { quarantineFromSealedLog } from '../../src/root-of-trust/production-runtime.mjs';
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
  return registerTmpRoot(mkdtempSync(join(tmpdir(), 'xuux-wl303-')));
}

/** @typedef {Awaited<ReturnType<typeof createProductionSystem>>} ProductionSystem */
/** @typedef {(system: ProductionSystem, shared: { id: string }) => Promise<void>} Step */

/**
 * يُقلِعُ النظامَ الإنتاجيَّ على جذرٍ واحدٍ مرّاتٍ متتالية.
 * @param {Step[]} steps
 */
async function lifecycle(steps) {
  const root = tmpRoot();
  const socket = new TestFreshnessSocket(0n, 'wl305');
  const { boot } = rig({ freshnessSocket: socket });
  const shared = { id: '' };
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

/** @type {Step} */
const quarantineAgent = async (system, shared) => {
  const agent = await system.chain.registry.register({ name: 'q', role: 'role:king' });
  shared.id = agent.id;
  system.chain.quarantine.report({ kind: 'model-fingerprint-mismatch', subject: agent.id });
  assert.equal(system.chain.quarantine.isQuarantined(agent.id), true);
};

describe('WL-305 — R6-A-05: الحجرُ يدومُ عبرَ إعادةِ تشغيلِ النظامِ الإنتاجيّ', () => {
  test('Q1 — محجورٌ قبلَ إعادةِ التشغيلِ يبقى محجوراً بعدَها، والإعادةُ مختومة', async () => {
    await lifecycle([
      quarantineAgent,
      async (system, shared) => {
        assert.equal(system.chain.quarantine.isQuarantined(shared.id), true);
        const restored = system.auditLog.events.filter(
          (e) => e.type === 'quarantine.restored' && e.actor === shared.id,
        );
        assert.equal(restored.length, 1);
        // المستهلكُ الفعليُّ: نقطةُ الإنفاذِ الإنتاجيّةُ تقرأُ الحاجبَ نفسَه.
        assert.equal(system.chain.enforcementPoint.quarantine, system.chain.quarantine);
      },
    ]);
  });

  test('Q2 — إعادتان متتاليتان لا تُكرِّرانِ المحجورَ ولا تُسقطانِه', async () => {
    await lifecycle([
      quarantineAgent,
      async (system, shared) =>
        assert.equal(system.chain.quarantine.isQuarantined(shared.id), true),
      async (system, shared) => {
        assert.equal(system.chain.quarantine.isQuarantined(shared.id), true);
        assert.equal(
          system.chain.quarantine.list().filter((e) => e.subject === shared.id).length,
          1,
        );
      },
    ]);
  });

  test('Q3 — المُخرَجُ بسببٍ مسجَّلٍ قبلَ إعادةِ التشغيلِ لا يُعادُ إلى الحجر', async () => {
    await lifecycle([
      async (system, shared) => {
        await quarantineAgent(system, shared);
        system.chain.quarantine.release(shared.id, 'فُحِصَت البصمةُ وطابقت');
      },
      async (system, shared) =>
        assert.equal(system.chain.quarantine.isQuarantined(shared.id), false),
    ]);
  });

  test('Q4 — المُعادُ من السجلِّ يُخرَجُ بسببٍ مسجَّلٍ بعدَ إعادةِ التشغيلِ، ويبقى خارجاً بعدَها', async () => {
    await lifecycle([
      quarantineAgent,
      async (system, shared) => {
        assert.throws(() => system.chain.quarantine.release(shared.id, ' '), /سبب/);
        assert.equal(system.chain.quarantine.isQuarantined(shared.id), true);
        system.chain.quarantine.release(shared.id, 'قرارٌ بشريٌّ بعدَ المراجعة');
        assert.equal(system.chain.quarantine.isQuarantined(shared.id), false);
      },
      async (system, shared) =>
        assert.equal(system.chain.quarantine.isQuarantined(shared.id), false),
    ]);
  });
});

describe('WL-305 — quarantineFromSealedLog: الشاهدُ يُقرأُ أو يُرَدُّ الإقلاع', () => {
  /**
   * @param {string} type
   * @param {string} actor
   * @param {object} data
   * @param {string} [id]
   */
  const event = (type, actor, data, id = 'e:' + randomUUID()) => ({
    id,
    type,
    actor,
    data,
    at: 't',
  });
  test('W1 — الترتيبُ: عزلٌ ⇒ إخراجٌ ⇒ عزلٌ يُبقي المحجورَ مرّةً واحدة', async () => {
    const log = {
      sealed: false,
      events: [
        event('quarantine.isolated', 'a', { kind: 'egress-refused', incidentId: 'i1' }),
        event('quarantine.isolated', 'b', { kind: 'egress-refused', incidentId: 'i2' }),
        event('quarantine.released', 'a', { incidentId: 'i1' }),
        event('quarantine.restored', 'b', { kind: 'egress-refused', incidentId: 'i2' }),
      ],
    };
    const out = await quarantineFromSealedLog(/** @type {never} */ (log));
    assert.deepEqual(
      out.map((e) => [e.subject, e.kind, e.incidentId]),
      [['b', 'egress-refused', 'i2']],
    );
  });
  test('W2 — جسمٌ مختومٌ لا يُفَكُّ ⇒ PRODUCTION_QUARANTINE_WITNESS_UNREADABLE لا إطلاق', async () => {
    const log = {
      sealed: true,
      events: [event('quarantine.isolated', 'a', {})],
      openEvent: async () => {
        throw new Error('bad tag');
      },
    };
    await assert.rejects(
      () => quarantineFromSealedLog(/** @type {never} */ (log)),
      /PRODUCTION_QUARANTINE_WITNESS_UNREADABLE/,
    );
  });
  test('W3 — واقعةُ حجرٍ بلا فاعلٍ أو بلا نوعٍ ⇒ رفض', async () => {
    for (const bad of [
      event('quarantine.isolated', '', { kind: 'x' }),
      event('quarantine.isolated', 'a', {}),
    ]) {
      await assert.rejects(
        () => quarantineFromSealedLog(/** @type {never} */ ({ sealed: false, events: [bad] })),
        /PRODUCTION_QUARANTINE_WITNESS_UNREADABLE/,
      );
    }
  });
});
