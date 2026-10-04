// @ts-nocheck
// tests/helpers/wl-326-root.mjs
//
// `WL-326` (‏`LIVE-28` الخيار ب، `D3`/`D6`): أدواتُ قياسٍ على **جذرِ الثقةِ الإنتاجيِّ الحقيقيّ**
// (‏`createProductionRootOfTrust` بحاجزِه وبيانِه وسجلِّه ودفترِه) عبرَ عملياتٍ متعدّدة:
//
//   - مفاتيحُ ثابتةٌ تُسلسَلُ إلى JSON فتُقلِعُ بها عمليّةٌ فرعيّةٌ الجذرَ نفسَه بعدَ SIGKILL.
//   - توكنٌ برمجيٌّ يحقّقُ عقدَ `HsmKeySource` (‏المفاتيحُ لا تخرجُ منه إلا عامّة) — بديلُ
//     التوكنِ العتاديِّ في الاختبار، وهو هو في `production-runtime.test.mjs`.
//   - مرجعُ حداثةٍ **مربوطٌ بالحالة** على ملفٍّ خارجَ جذرِ الحالة (‏`testFixture`): يدومُ عبرَ
//     العمليات، ويُطبِّقُ `judgeStateAdvance` نفسَه الذي يحكمُ به المرجعُ في الذاكرة، ويحقنُ
//     أعطالَ النقلِ والسقوطَ قبلَ التطبيقِ وبعدَه. هو أداةُ اختبارٍ لا مرجعٌ إنتاجيّ: المدخلُ
//     الإنتاجيُّ يرفضُ كلَّ مقبسٍ يحملُ `testFixture` — ولا يُقدَّمُ دليلاً على عتادٍ (‏`D2`).

import {
  createCipheriv,
  createDecipheriv,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  randomBytes,
  sign as softwareSign,
} from 'node:crypto';
import {
  closeSync,
  existsSync,
  fsyncSync,
  openSync,
  readFileSync,
  renameSync,
  writeSync,
} from 'node:fs';

import {
  FRESHNESS_GENESIS_ANCHOR,
  SEAL_IV_BYTES,
  createProductionRootOfTrust,
  fingerprint,
  judgeStateAdvance,
} from '../../src/root-of-trust/index.mjs';
import { kingIdOfPublicKey, registerTestKing, signRoyalCommand } from './royal-halt-command.mjs';

/**
 * مفاتيحُ الجذرِ مُسلسَلةً.
 * @returns {object} المفاتيح
 */
export function makeKeys() {
  const pem = (pair) => ({
    pub: pair.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    priv: pair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
  });
  return {
    anchor: pem(generateKeyPairSync('ed25519')),
    ledger: pem(generateKeyPairSync('ed25519')),
    royal: pem(generateKeyPairSync('ed25519')),
    aead: randomBytes(32).toString('hex'),
  };
}

/**
 * زوجٌ من مفاتيحَ مُسلسَلة.
 * @param {{pub: string, priv: string}} serialized - المفتاحان
 * @returns {{publicKey: import('node:crypto').KeyObject, privateKey: import('node:crypto').KeyObject}} الزوج
 */
export function pairOf(serialized) {
  return {
    publicKey: createPublicKey(serialized.pub),
    privateKey: createPrivateKey(serialized.priv),
  };
}

/**
 * توكنٌ برمجيٌّ بعقدِ `HsmKeySource`.
 * @param {ReturnType<typeof makeKeys>} keys - المفاتيح
 * @returns {object} المصدر
 */
export function tokenFromKeys(keys) {
  const aes = Buffer.from(keys.aead, 'hex');
  const ed = new Map([
    ['06', registerTestKing(pairOf(keys.anchor))],
    ['07', registerTestKing(pairOf(keys.ledger))],
  ]);
  const aad = Buffer.from('xuux-event');
  return {
    describe: () => ({ kind: 'pkcs11-hsm', canExport: false, tokenSerial: 'DEADBEEFCAFE0001' }),
    getAeadKey: async (keyId) => {
      if (keyId !== '05') throw new Error('KEY_NOT_FOUND');
      return {
        keyId,
        encrypt: async (plaintext) => {
          const iv = randomBytes(SEAL_IV_BYTES);
          const cipher = createCipheriv('aes-256-gcm', aes, iv);
          cipher.setAAD(aad);
          const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
          return { ciphertext, iv, tag: cipher.getAuthTag() };
        },
        decrypt: async (ciphertext, iv, tag) => {
          const decipher = createDecipheriv('aes-256-gcm', aes, iv);
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

/**
 * بيئةُ إنتاجٍ كاملةُ الشرطِ لهذه المفاتيح.
 * @param {ReturnType<typeof makeKeys>} keys - المفاتيح
 * @param {object} [extra] - زيادات
 * @returns {object} البيئة
 */
export function envFor(keys, extra = {}) {
  const royal = pairOf(keys.royal);
  registerTestKing(royal);
  return {
    NODE_ENV: 'production',
    STATE_ENV: 'production',
    XUUX_ROOT_OF_TRUST_MODE: 'hsm',
    XUUX_PKCS11_MODULE: '/usr/lib/softhsm/libsofthsm2.so',
    XUUX_PKCS11_TOKEN: 'xuux-test',
    XUUX_PKCS11_TOKEN_SERIAL: 'DEADBEEFCAFE0001',
    XUUX_PKCS11_MODULE_SHA256: 'f'.repeat(64),
    XUUX_PKCS11_PIN: 'fake-pin-not-used-by-injected-source', // secret-scan:allow
    XUUX_ROOT_OF_TRUST_PROVISION: '1',
    XUUX_KING_ID: 'king:' + fingerprint(createPublicKey(keys.anchor.pub)).slice(0, 24),
    XUUX_ROYAL_PUBLIC_KEY_PEM: keys.royal.pub,
    XUUX_ROYAL_KEY_ID: kingIdOfPublicKey(royal.publicKey),
    ...extra,
  };
}

/**
 * أمرٌ ملكيٌّ موقَّعٌ بالمفتاحِ الملكيّ.
 * @param {ReturnType<typeof makeKeys>} keys - المفاتيح
 * @param {'halt'|'resume'} operation - العملية
 * @param {string} reason - السبب
 * @param {number} targetEpoch - العهدُ الحاضر
 * @returns {object} الأمر
 */
export function royalCommand(keys, operation, reason, targetEpoch) {
  return signRoyalCommand(pairOf(keys.royal), { operation, reason, targetEpoch });
}

const encode = (reading) =>
  JSON.stringify({ epoch: reading.epoch.toString(), anchor: reading.anchor }) + '\n';

/**
 * مرجعُ حداثةٍ مربوطٌ بالحالةِ على ملفٍّ خارجَ الجذر. `testFixture` — يرفضُه المدخلُ الإنتاجيّ.
 * الأعطالُ تُحقَنُ بـ`faults` (‏طابورٌ يُستهلَك): `kill-before-apply`، `kill-after-apply`،
 * `throw-before-apply`، `throw-after-apply`.
 */
export class FileStateBoundSocket {
  stateBound = true;
  testFixture = true;
  /** @type {string[]} */
  faults = [];
  applied = 0;

  /** @param {string} file - ملفُّ المرجع */
  constructor(file) {
    this.file = file;
  }

  /** @returns {{epoch: bigint, anchor: string}} الحالُ على الملفّ */
  current() {
    if (!existsSync(this.file)) return { epoch: 0n, anchor: FRESHNESS_GENESIS_ANCHOR };
    const parsed = JSON.parse(readFileSync(this.file, 'utf8'));
    return { epoch: BigInt(parsed.epoch), anchor: parsed.anchor };
  }

  async read() {
    return this.current();
  }

  async advanceState(from, to) {
    const fault = this.faults.shift();
    if (fault === 'kill-before-apply') process.kill(process.pid, 'SIGKILL');
    if (fault === 'throw-before-apply') throw new Error('FRESHNESS_TRANSPORT_LOST');
    const verdict = judgeStateAdvance(this.current(), from, to);
    if (verdict === 'apply') {
      this.force(to);
      this.applied += 1;
    }
    if (fault === 'kill-after-apply') process.kill(process.pid, 'SIGKILL');
    if (fault === 'throw-after-apply') throw new Error('FRESHNESS_TRANSPORT_LOST');
    return this.current();
  }

  /**
   * يضعُ المرجعَ على حالٍ بعينِها (‏كاتبٌ آخرُ تقدّمَ به، أو مرجعٌ أُعيد). دائمٌ ذرّيّ.
   * @param {{epoch: bigint, anchor: string}} reading - الحال
   */
  force(reading) {
    const temporary = `${this.file}.tmp`;
    const fd = openSync(temporary, 'w');
    try {
      writeSync(fd, encode(reading));
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(temporary, this.file);
  }
}

/**
 * يُقلِعُ الجذرَ الإنتاجيَّ الحقيقيَّ على مجلدٍ بمفاتيحَ ومرجعٍ معطاة.
 * @param {string} root - جذرُ الحالة
 * @param {ReturnType<typeof makeKeys>} keys - المفاتيح
 * @param {object} socket - المرجع
 * @param {{env?: object, fsync?: boolean}} [options] - خيارات
 * @returns {Promise<object>} جذرُ الثقة
 */
export async function bootRoot(root, keys, socket, options = {}) {
  const token = tokenFromKeys(keys);
  const runtime = await createProductionRootOfTrust(
    envFor(keys, options.env ?? {}),
    { root, fsync: options.fsync ?? false, freshnessSocket: socket },
    { openSource: async () => ({ source: token, close: async () => undefined }) },
  );
  runtime.haltSwitch.useTrustedClock({ now: () => Date.now() });
  return runtime;
}
