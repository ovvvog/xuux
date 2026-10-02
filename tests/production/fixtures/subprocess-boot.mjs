// @ts-nocheck
/**
 * tests/production/fixtures/subprocess-boot.mjs
 *
 * سكربتُ مساعدةٌ لاختبارِ الإقلاعِ الإنتاجيِّ في عمليةٍ منفصلةٍ.
 * يَحقنُ deps اختباريةً (stableToken وtest clock) ويُشغِّلُ createProductionSystem()
 * ببيئةِ إنتاجٍ فعليةٍ، ثمَّ يُخرجُ نتيجةً JSON.
 *
 * هذا ملفُ اختبارٍ لا مُشغِّلُ إنتاجٍ — يُستعملُ من subprocess.test.mjs وحدَه.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createCipheriv,
  createDecipheriv,
  generateKeyPairSync,
  randomBytes,
  sign as softwareSign,
} from 'node:crypto';
import { Buffer } from 'node:buffer';

import { createProductionSystem } from '../../../src/production/entrypoint.mjs';
import { InMemoryFreshnessSocket, fingerprint } from '../../../src/root-of-trust/index.mjs';

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
    king: generateKeyPairSync('ed25519'),
    aeadKey: randomBytes(32),
    ledgerPair: generateKeyPairSync('ed25519'),
  };
}

const env = {
  NODE_ENV: 'production',
  STATE_ENV: 'production',
  XUUX_ROOT_OF_TRUST_MODE: 'hsm',
  XUUX_PKCS11_MODULE: '/usr/lib/softhsm/libsofthsm2.so',
  XUUX_PKCS11_TOKEN: 'xuux-test',
  XUUX_PKCS11_TOKEN_SERIAL: 'DEADBEEFCAFE0001',
  XUUX_PKCS11_MODULE_SHA256: 'f'.repeat(64),
  XUUX_PKCS11_PIN: 'unused-by-injected-source',
  XUUX_KING_ID: '',
  XUUX_ROOT_OF_TRUST_PROVISION: '1',
};

const k = fixedKeys();
env.XUUX_KING_ID = 'king:' + fingerprint(k.king.publicKey).slice(0, 24);

const root = mkdtempSync(join(tmpdir(), 'xuux-subprocess-boot-'));
const socket = new InMemoryFreshnessSocket(0n, 'subprocess-test');

// تسجيلُ الجذرِ المؤقّتِ للمحوِ الآليِّ — سياسةُ نظافةِ الجذورِ (WL-219)
process.on('exit', () => {
  try {
    rmSync(root, { recursive: true, force: true });
  } catch {
    // تجاهلُ أخطاءِ المحوِ عندَ الخروجِ
  }
});

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

try {
  const system = await createProductionSystem(
    env,
    { root, freshnessSocket: socket, clock: testClock },
    {
      openSource: async () => ({
        source: stableToken(k.king, k.aeadKey, k.ledgerPair),
        close: async () => undefined,
      }),
    },
  );

  const king = system.crown.king;
  const result = {
    ok: true,
    kingId: king?.id ?? null,
    expectedKingId: env.XUUX_KING_ID,
    kingIdMatches: king?.id === env.XUUX_KING_ID,
    signThrows: false,
    verifyWorks: false,
  };

  // Verify sign() throws
  try {
    king.sign({ test: true });
  } catch {
    result.signThrows = true;
  }

  // Verify verify() works (returns false for bad sig)
  result.verifyWorks = king.verify({ test: true }, 'bad-signature') === false;

  await system.close();

  console.log(JSON.stringify(result));
  process.exit(0);
} catch (err) {
  const e = /** @type {{ message?: string, code?: string }} */ (err);
  console.log(JSON.stringify({ ok: false, error: e.message ?? 'unknown', code: e.code ?? null }));
  process.exit(1);
}
