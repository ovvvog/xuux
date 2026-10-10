// @ts-nocheck — حزامُ `WL-304` (‏`wl-304-sealed-execution-path.test.mjs`) بلا أنواع.
// `WL-349`: حزامُ إقلاعِ `createProductionSystem` للديوانِ الملكيّ — مُستخرَجٌ من `WL-348` ليشتركَ فيه
// `wl-348-sovereign-console` و`wl-349-durable-veto`. مقبسُ الحداثةِ فيه للاختبار (‏`EXT-6` مفتوح).

import assert from 'node:assert/strict';
import {
  createCipheriv,
  createDecipheriv,
  generateKeyPairSync,
  randomBytes,
  sign as softwareSign,
} from 'node:crypto';
import { Buffer } from 'node:buffer';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { registerTmpRoot } from './tmp-roots.mjs';
import { createProductionSystem } from '../../src/production/entrypoint.mjs';
import { InMemoryFreshnessSocket, fingerprint } from '../../src/root-of-trust/index.mjs';
import { factorCodeForStep, loadKingAuthPolicy } from '../../src/authn/index.mjs';
import { registerTestKing, royalKeyEnv, signRoyalCommand } from './royal-halt-command.mjs';

export const ROYAL_KEY = royalKeyEnv();
export const AUTHN_POLICY = loadKingAuthPolicy();

/**
 * **ساعةٌ رتيبةٌ للاختبارِ (‏WL-364):** ساعةُ الجدارِ في العدّاءِ المُحمَلِ قد تَخطو إلى
 * الوراءِ (‏slew)، فإذا وقعَتْ نداءتانِ من `session()` في خطوتَينِ متتاليتَينِ وقد خطتِ
 * الساعةُ خطوةً بينَهما **قدّمَتِ الثانيةُ الرمزَ نفسَهُ الذي استُهلَكَ في الأولى** —
 * ورفضُ الإعادةِ (‏`AUTHN_FACTOR_REPLAYED`) سلوكٌ إنتاجيٌّ صحيحٌ لا يُعطَّل؛ العطلُ في
 * الحزامِ الذي قدّمَ الرمزَ المستهلَكَ. الحزامُ هنا يُقدِّمُ ساعةً لا تتراجعُ: كلُّ قراءةٍ
 * ≥ سابقتِها، فلا يُولَّدَ رمزُ خطوةٍ قد استُهلَكتْ.
 */
let monotonicNow = 0;
export function monotonicDateNow() {
  const wall = Date.now();
  if (wall > monotonicNow) monotonicNow = wall;
  return monotonicNow;
}

/** مقبسُ حداثةٍ للاختبارِ بلا علامةِ testFixture — الحزامُ نفسُه في `WL-304`. */
export class TestFreshnessSocket {
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

export function fixedKeys() {
  return {
    king: registerTestKing(generateKeyPairSync('ed25519')),
    aeadKey: randomBytes(32),
    ledgerPair: registerTestKing(generateKeyPairSync('ed25519')),
  };
}

/** خزنةُ أسرارِ العاملِ الثاني للاختبار — المصدرُ الإنتاجيُّ لها تبعيّةٌ مُعلَنةٌ لا مُنفَّذة. */
export function testVault() {
  const secret = randomBytes(32).toString('hex');
  /** @type {Record<string, string>} */
  const vault = {};
  for (const device of AUTHN_POLICY.devices) vault[device.factorRef] = secret;
  return { secret, factorSecrets: { read: (/** @type {string} */ name) => vault[name] ?? null } };
}

export function boot(root, { keys, factorSecrets = null }) {
  const env = {
    NODE_ENV: 'production',
    STATE_ENV: 'production',
    XUUX_ROOT_OF_TRUST_MODE: 'hsm',
    XUUX_PKCS11_MODULE: '/usr/lib/softhsm/libsofthsm2.so',
    XUUX_PKCS11_TOKEN: 'xuux-test',
    XUUX_PKCS11_TOKEN_SERIAL: 'DEADBEEFCAFE0001',
    XUUX_PKCS11_MODULE_SHA256: 'f'.repeat(64),
    XUUX_PKCS11_PIN: 'unused-by-injected-source',
    XUUX_KING_ID: 'king:' + fingerprint(keys.king.publicKey).slice(0, 24),
    ...ROYAL_KEY.env,
    XUUX_ROOT_OF_TRUST_PROVISION: '1',
  };
  const testClock = {
    now: () => monotonicDateNow(),
    assertTrusted: () => undefined,
    attestation: () => ({
      atMs: Date.now(),
      radiusMs: 1000,
      ageMs: 0,
      sources: ['ci-test'],
      localSkewMs: 0,
    }),
  };
  return createProductionSystem(
    env,
    {
      root,
      freshnessSocket: keys.socket,
      clock: testClock,
      ...(factorSecrets === null ? {} : { factorSecrets }),
    },
    {
      openSource: async () => ({
        source: stableToken(keys.king, keys.aeadKey, keys.ledgerPair),
        close: async () => undefined,
      }),
    },
  );
}

export function tmpRoot() {
  return registerTmpRoot(mkdtempSync(join(tmpdir(), 'xuux-wl348-')));
}

/** أمرٌ ملكيٌّ بصيغةِ بوابةِ التاجِ موقَّعٌ بالمفتاحِ الملكيّ (‏`LIVE-24`). */
export function crownCommand(fields) {
  const command = {
    // المعرّفُ مشتركٌ بينَ الأمرِ وسندِ مفتاحِ الإيقاف، فيلزمُه نمطُ السند (‏`[A-Za-z0-9_-]{16,128}`).
    id: fields.id ?? randomBytes(16).toString('hex'),
    action: fields.action,
    target: fields.target,
    payload: { reason: fields.reason },
    issuedAt: new Date().toISOString(),
  };
  const signature = softwareSign(
    null,
    Buffer.from(JSON.stringify(command)),
    ROYAL_KEY.pair.privateKey,
  ).toString('base64url');
  return { command, signature };
}

/**
 * سندُ مفتاحِ الإيقافِ (‏R5-B-07) بالمفتاحِ الملكيِّ على العهدِ الحاضر — بلا لمسٍ لساعةِ المفتاح:
 * المفتاحُ الإنتاجيُّ موصولٌ بساعتِه الموثوقةِ من المُشغِّل (‏`useTrustedClock`).
 */
export function haltAuthority(halt, operation, reason, commandId) {
  return signRoyalCommand(ROYAL_KEY.pair, {
    operation,
    reason,
    commandId,
    targetEpoch: halt.read().epoch,
  });
}

export async function session(system, secret, stepOffset = 0) {
  const device = AUTHN_POLICY.devices[0];
  assert.ok(device !== undefined);
  const { stepSeconds, digits, algorithm } = AUTHN_POLICY.secondFactor;
  const step = Math.floor(monotonicDateNow() / 1000 / stepSeconds) + stepOffset;
  const factorCode = factorCodeForStep({ secret, step, digits, algorithm });
  return {
    factorCode,
    opened: await system.kingAuth.authenticate({
      actorId: system.crown.king.id,
      deviceId: device.id,
      factorCode,
    }),
  };
}

export async function sealedTypes(system) {
  await system.rootOfTrust.log.flush?.();
  return system.auditLog.events.map((event) => event.type);
}
