/**
 * G2-3 (الجزءُ §3.2-2) — تحقّقُ هويّةِ EK: سلسلةُ الشهادةِ وتطابقُ `SubjectPublicKeyInfo`.
 *
 * **العقدُ (الملحقُ هـ §3.2):** مفتاحُ EK الذي سيُستعملُ ملحًا لا يُقبلُ إلّا بعدَ
 * التحقّقِ من شهادتهِ: تتحقّقُ السلسلةُ من جذرِ الثقةِ المعلنِ، ثمّ يُطابَقُ
 * `SubjectPublicKeyInfo` في الشهادةِ معَ بايتاتِ المفتاحِ العامّ القادمةِ من
 * `ReadPublic`/`CreatePrimary` (الوحدةُ `TPMT_PUBLIC` كما هي، بلا تعديل).
 * أيُّ اختلافٍ بايتٍ واحدٍ ⇒ `FRESHNESS_TPM_IDENTITY_UNPROVEN`.
 *
 * **حدودُ الصدق:** في الاختباراتِ على المحاكي، الشهادةُ وجذرُ الاختبارِ يُصكّانِ
 * داخلَ عزلةِ الاختبارِ (وسمُ `XUUX_SIM_EK_CERT`)؛ هذا يُثبتُ عملَ مسارِ التحقّقِ
 * لا يُثبتُ شيئًا عن عتادٍ حقيقيٍّ أو جاهزيةِ إنتاج.
 */

import { createPublicKey, createHash, createSign, generateKeyPairSync, X509Certificate } from 'node:crypto';
import { strict as assert } from 'node:assert';
import { parseTpmtPublic } from './command_builder.mjs';

/** تحويلُ خطأٍ مجهولٍ إلى نصٍّ بلا كشفِ غيرِ المعلومةِ المقصودةِ. @param {unknown} e */
function errorText(e) {
  return String(e instanceof Error ? e.message : e);
}

export const EK_IDENTITY_ERRORS = Object.freeze({
  CERTIFICATE_INVALID: 'EK_CERTIFICATE_INVALID',
  CHAIN_UNVERIFIED: 'EK_CHAIN_UNVERIFIED',
  SPKI_MISMATCH: 'EK_SPKI_MISMATCH',
  KEY_TYPE_UNSUPPORTED: 'EK_KEY_TYPE_UNSUPPORTED',
});

class EkIdentityError extends Error {
  /**
   * @param {string} code
   * @param {string} detail
   */
  constructor(code, detail) {
    super(`${code}: ${detail}`);
    this.name = 'EkIdentityError';
    this.code = code;
    this.detail = detail;
  }
}

/**
 * التحقّقُ الكاملُ §3.2-2: السلسلةُ ثمّ تطابقُ SPKI.
 * @param {{ certificatePem: string, caPem: string, ekPublic: Buffer }} fields
 * @returns {{ ok: true, spkiSha256: string }}
 */
export function verifyEkIdentity(fields) {
  if (typeof fields.certificatePem !== 'string' || typeof fields.caPem !== 'string') {
    throw new EkIdentityError(EK_IDENTITY_ERRORS.CERTIFICATE_INVALID, 'certificatePem and caPem are required');
  }
  let cert;
  try {
    cert = new X509Certificate(fields.certificatePem);
  } catch (e) {
    throw new EkIdentityError(EK_IDENTITY_ERRORS.CERTIFICATE_INVALID, errorText(e));
  }
  let ca;
  try {
    ca = new X509Certificate(fields.caPem);
  } catch (e) {
    throw new EkIdentityError(EK_IDENTITY_ERRORS.CERTIFICATE_INVALID, `CA: ${errorText(e)}`);
  }
  // (1) السلسلةُ: الشهادةُ توقيعُها صادرٌ عن الجذرِ المعلنِ (في المحاكاةِ جذرُ اختبارٍ معزول).
  if (!cert.verify(ca.publicKey)) {
    throw new EkIdentityError(EK_IDENTITY_ERRORS.CHAIN_UNVERIFIED, 'certificate is not signed by the declared CA');
  }
  // (2) تطابقُ SPKI مع بايتاتِ المفتاحِ من الشريحةِ.
  const parsed = parseTpmtPublic(fields.ekPublic);
  if (!parsed.rsa) {
    throw new EkIdentityError(EK_IDENTITY_ERRORS.KEY_TYPE_UNSUPPORTED, 'only RSA-2048 EK is verified in this slice');
  }
  const e = parsed.rsa.exponent === 0 ? 65537 : parsed.rsa.exponent;
  if (e !== 65537) {
    throw new EkIdentityError(EK_IDENTITY_ERRORS.KEY_TYPE_UNSUPPORTED, `exponent ${e}`);
  }
  const jwk = {
    kty: 'RSA',
    n: parsed.rsa.modulus.toString('base64url'),
    e: Buffer.from([0x01, 0x00, 0x01]).toString('base64url'),
  };
  const ekKey = createPublicKey({ key: jwk, format: 'jwk' });
  const ekSpki = createHash('sha256').update(ekKey.export({ type: 'spki', format: 'der' })).digest();
  const certSpki = createHash('sha256').update(cert.publicKey.export({ type: 'spki', format: 'der' })).digest();
  if (!ekSpki.equals(certSpki)) {
    throw new EkIdentityError(EK_IDENTITY_ERRORS.SPKI_MISMATCH, 'certificate SPKI differs from the EK public from the chip');
  }
  return { ok: true, spkiSha256: ekSpki.toString('hex') };
}

/** سكُّ زوجِ (شهادةِ EK ‖ جذرِ اختبارٍ ذاتيّ) داخلَ عزلةِ المحاكاةِ — للاختباراتِ فقط. */
/** @param {{ kty: string, n: string, e: string }} rsaPublicJwk */
export function mintSimulatedEkCertificatePair(rsaPublicJwk) {
  assert(rsaPublicJwk, 'RSA public JWK required');
  const { privateKey: caKey, publicKey: caPublicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const ekKey = createPublicKey({ key: rsaPublicJwk, format: 'jwk' });
  const caCertDer = mintMinimalCert(caPublicKey, caKey);
  const ekCertDer = mintMinimalCert(ekKey, caKey);
  return { certificatePem: toPem('CERTIFICATE', ekCertDer), caPem: toPem('CERTIFICATE', caCertDer) };
}

// ——— أدواتُ الصكِّ (خارجَ نطاقِ التحقّقِ؛ للاختباراتِ فقط) ———

/** @param {string} label @param {Buffer} der */
function toPem(label, der) {
  const b64 = der.toString('base64').replace(/(.{64})/g, '$1\n');
  return `-----BEGIN ${label}-----\n${b64}\n-----END ${label}-----\n`;
}

/** @param {import('node:crypto').KeyObject} publicKey @param {import('node:crypto').KeyObject} signingKey */
function mintMinimalCert(publicKey, signingKey) {
  const spki = publicKey.export({ type: 'spki', format: 'der' });
  const der = (/** @type {number} */ tag, /** @type {Buffer} */ content) => {
    if (content.length < 128) return Buffer.concat([Buffer.from([tag, content.length]), content]);
    const lenBytes = (() => {
      const b = [];
      let l = content.length;
      while (l > 0) {
        b.unshift(l & 0xff);
        l >>= 8;
      }
      return b;
    })();
    return Buffer.concat([Buffer.from([tag, 0x80 | lenBytes.length]), Buffer.from(lenBytes), content]);
  };
  const version = der(0xA0, der(0x02, Buffer.from([0x02]))); // [0] EXPLICIT INTEGER 2 (v3)
  const serial = der(0x02, Buffer.from([0x01]));
  const alg = der(0x30, Buffer.concat([der(0x06, Buffer.from([0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x0b])), der(0x05, Buffer.alloc(0))]));
  const name = der(0x30, Buffer.alloc(0));
  const validity = der(0x30, Buffer.concat([der(0x17, Buffer.from('260101000000Z')), der(0x17, Buffer.from('360101000000Z'))]));
  const spkiWrapped = spki; // SPKI نفسُهُ تسلسلُ DER كاملٌ — لا لفَّ إضافيّ
  const tbs = der(0x30, Buffer.concat([version, serial, alg, name, validity, name, spkiWrapped]));
  const sign = createSign('RSA-SHA256');
  sign.update(tbs);
  const signature = sign.sign(signingKey);
  return der(0x30, Buffer.concat([tbs, alg, der(0x03, Buffer.concat([Buffer.alloc(1), signature]))]));
}
