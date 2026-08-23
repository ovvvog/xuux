import { generateKeyPairSync, sign, verify, randomUUID, createHash } from 'node:crypto';

/** @typedef {import('node:crypto').KeyObject} KeyObject */
/**
 * شهادة صادرة من سلطة التصديق، وتحمل المادة اللازمة للتحقق من تفويض الوكيل.
 * @typedef {{id: string, subject: string, issuer: string, role: string, capabilities: string[], issuedAt: string, signature: string}} Certificate
 */
/**
 * شهادة تعريف المفتاح العام للملك خارج نطاق التوقيع التشغيلي.
 * @typedef {{subject: string, issuer: string, publicKey: string, purpose: string}} KingCertificate
 */

/**
 * يحوّل المفتاح العام إلى بصمة مستقرة صالحة لتعريف صاحب السيادة.
 * @param {KeyObject} publicKey - المفتاح العام المراد تلخيصه
 * @returns {string} بصمة SHA-256 بترميز ست عشري
 */
export function fingerprint(publicKey) {
  return createHash('sha256')
    .update(publicKey.export({ type: 'spki', format: 'der' }))
    .digest('hex');
}

export class KingIdentity {
  constructor() {
    const keys = generateKeyPairSync('ed25519');
    /** @type {string} */
    this.id = 'king:' + fingerprint(keys.publicKey).slice(0, 24);
    /** @type {KeyObject} */
    this.privateKey = keys.privateKey;
    /** @type {KeyObject} */
    this.publicKey = keys.publicKey;
  }
  /**
   * يوقّع تمثيلاً كائنيًا منضبطًا لتثبيت مصدر الأوامر والشهادات.
   * @param {object} payload - المادة التي ستدخل في التوقيع
   * @returns {string} التوقيع بترميز base64url
   */
  sign(payload) {
    return sign(null, Buffer.from(JSON.stringify(payload)), this.privateKey).toString('base64url');
  }
  /**
   * يتحقق من أن التوقيع يطابق المادة نفسها ومفتاح الملك العام.
   * @param {object} payload - المادة الموقعة كما استلمت
   * @param {string} signature - التوقيع بترميز base64url
   * @returns {boolean} صحة التوقيع
   */
  verify(payload, signature) {
    return verify(
      null,
      Buffer.from(JSON.stringify(payload)),
      this.publicKey,
      Buffer.from(signature, 'base64url'),
    );
  }
  /**
   * يعرّف مفتاح الملك العام من دون كشف المادة الخاصة.
   * @returns {KingCertificate} شهادة تعريف جذر السيادة
   */
  certificate() {
    return {
      subject: this.id,
      issuer: 'crown-root',
      publicKey: /** @type {string} */ (this.publicKey.export({ type: 'spki', format: 'pem' })),
      purpose: 'sovereign-authority',
    };
  }
}

export class CertificateAuthority {
  /**
   * @param {KingIdentity} king - هوية الملك التي توقع الشهادات
   */
  constructor(king) {
    /** @type {KingIdentity} */
    this.king = king;
    /** @type {Set<string>} */
    this.revoked = new Set();
  }
  /**
   * يصدر تفويضًا محدد الدور والقدرات لوكيل معروف.
   * @param {string} subject - معرّف الموضوع المفوّض
   * @param {string} role - الدور التنظيمي للموضوع
   * @param {string[]} [capabilities=[]] - أقل القدرات الممنوحة
   * @returns {Certificate} شهادة موقعة قابلة للتحقق
   */
  issue(subject, role, capabilities = []) {
    const body = {
      id: randomUUID(),
      subject,
      issuer: this.king.id,
      role,
      capabilities,
      issuedAt: new Date().toISOString(),
    };
    return { ...body, signature: this.king.sign(body) };
  }
  /**
   * يسحب شهادةً بحيث لا تعود مقبولة حتى لو ظل توقيعها صحيحًا.
   * @param {string} certificateId - معرّف الشهادة المسحوبة
   * @param {string} reason - سبب السحب المسجل
   * @returns {{certificateId: string, reason: string, revokedAt: string}} سجل السحب
   */
  revoke(certificateId, reason) {
    this.revoked.add(certificateId);
    return { certificateId, reason, revokedAt: new Date().toISOString() };
  }
  /**
   * يجمع بين فحص السحب وفحص توقيع ملك الإصدار.
   * @param {Certificate} cert - الشهادة المطلوب التحقق منها
   * @returns {boolean} صلاحية الشهادة الحالية
   */
  isValid(cert) {
    return (
      !this.revoked.has(cert.id) &&
      this.king.verify(
        {
          id: cert.id,
          subject: cert.subject,
          issuer: cert.issuer,
          role: cert.role,
          capabilities: cert.capabilities,
          issuedAt: cert.issuedAt,
        },
        cert.signature,
      )
    );
  }
}

export class AgentIdentity {
  /**
   * @param {CertificateAuthority} ca - السلطة التي تصدر شهادة الوكيل
   * @param {string} name - الاسم المحلي للوكيل
   * @param {string} role - الدور المطلوب للوكيل
   * @param {string[]} [capabilities=[]] - القدرات الممنوحة للوكيل
   */
  constructor(ca, name, role, capabilities = []) {
    /** @type {string} */
    this.name = name;
    /** @type {Certificate} */
    this.certificate = ca.issue('agent:' + name, role, capabilities);
  }
}
