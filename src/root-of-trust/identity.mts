// جذر الثقة — الهوية وسلطة التصديق. نُقل من JSDoc إلى TypeScript صارم في M2.01
// بلا تغيير سلوك: نفس الدوال ونفس الأسماء ونفس مسار الاستيراد (`./identity.mjs`)
// لأن `.mts` يُصرَّف إلى `.mjs` في موضعه. المرجع: docs/TYPING_STANDARD.md §8.

import {
  generateKeyPairSync,
  sign,
  verify,
  randomUUID,
  createHash,
  type KeyObject,
} from 'node:crypto';

/** شهادة صادرة من سلطة التصديق، وتحمل المادة اللازمة للتحقق من تفويض الوكيل. */
export interface Certificate {
  id: string;
  subject: string;
  issuer: string;
  role: string;
  capabilities: string[];
  issuedAt: string;
  signature: string;
}

/** جسم الشهادة قبل التوقيع — وهو نفسه ما يُعاد التحقق منه لاحقاً. */
export type CertificateBody = Omit<Certificate, 'signature'>;

/** شهادة تعريف المفتاح العام للملك خارج نطاق التوقيع التشغيلي. */
export interface KingCertificate {
  subject: string;
  issuer: string;
  publicKey: string;
  purpose: string;
}

/**
 * يحوّل المفتاح العام إلى بصمة مستقرة صالحة لتعريف صاحب السيادة.
 * @param publicKey - المفتاح العام المراد تلخيصه
 * @returns بصمة SHA-256 بترميز ست عشري
 */
export function fingerprint(publicKey: KeyObject): string {
  return createHash('sha256')
    .update(publicKey.export({ type: 'spki', format: 'der' }))
    .digest('hex');
}

/** زوج مفاتيح جاهز يُمرَّر إلى هوية الملك بدل التوليد. */
export interface KingKeyPair {
  privateKey: KeyObject;
  publicKey: KeyObject;
}

export class KingIdentity {
  id: string;
  privateKey: KeyObject;
  publicKey: KeyObject;

  /**
   * أُضيف المعامل الاختياري في M2.03 ليصير مفتاح الملك قابلاً للإحضار من مخزن
   * خارجي بدل التوليد في كل إقلاع (الفجوة G1). وهو **اختياري** قصداً: حذفه
   * يُبقي السلوك القديم حرفياً — توليد زوج جديد — فلم يتغير مستدعٍ واحد.
   * والاشتقاق نفسه لم يُمسّ: المعرّف يبقى بصمة المفتاح العام، فنفس المادة
   * تُنتج نفس المعرّف، وهذا عين ما يُثبت أن الربط ربطٌ لا إعادة توليد.
   * @param keys - زوج مفاتيح محضَر؛ إن غاب وُلّد زوج جديد في الذاكرة
   */
  constructor(keys: KingKeyPair = generateKeyPairSync('ed25519')) {
    this.id = 'king:' + fingerprint(keys.publicKey).slice(0, 24);
    this.privateKey = keys.privateKey;
    this.publicKey = keys.publicKey;
  }

  /**
   * يوقّع تمثيلاً كائنياً منضبطاً لتثبيت مصدر الأوامر والشهادات.
   * @param payload - المادة التي ستدخل في التوقيع
   * @returns التوقيع بترميز base64url
   */
  sign(payload: object): string {
    return sign(null, Buffer.from(JSON.stringify(payload)), this.privateKey).toString('base64url');
  }

  /**
   * يتحقق من أن التوقيع يطابق المادة نفسها ومفتاح الملك العام.
   * @param payload - المادة الموقعة كما استلمت
   * @param signature - التوقيع بترميز base64url
   * @returns صحة التوقيع
   */
  verify(payload: object, signature: string): boolean {
    // توقيعٌ تالف يجب أن يُقرأ **باطلاً** لا أن يُسقط البوابة (M2.09). فقبل هذا
    // الحرس كان توقيعٌ ليس نصاً، أو مادةٌ لا تُرتَّب في JSON (حلقة مرجعية،
    // `BigInt`)، يرفع استثناءً من نوع آخر يخرج من `command()` قبل كل الفحوص —
    // فيصير الفرق بين «رُفض» و«انهار» مجهولاً للمستدعي. والفشل مُغلَق: كل ما
    // لا يمكن التحقق منه يُرجع `false`.
    if (typeof signature !== 'string' || signature === '') return false;
    try {
      return verify(
        null,
        Buffer.from(JSON.stringify(payload)),
        this.publicKey,
        Buffer.from(signature, 'base64url'),
      );
    } catch {
      return false;
    }
  }

  /**
   * يعرّف مفتاح الملك العام من دون كشف المادة الخاصة.
   * @returns شهادة تعريف جذر السيادة
   */
  certificate(): KingCertificate {
    return {
      subject: this.id,
      issuer: 'crown-root',
      publicKey: this.publicKey.export({ type: 'spki', format: 'pem' }) as string,
      purpose: 'sovereign-authority',
    };
  }
}

export class CertificateAuthority {
  king: KingIdentity;
  revoked: Set<string>;

  /**
   * @param king - هوية الملك التي توقع الشهادات
   */
  constructor(king: KingIdentity) {
    this.king = king;
    this.revoked = new Set();
  }

  /**
   * يصدر تفويضاً محدد الدور والقدرات لوكيل معروف.
   * @param subject - معرّف الموضوع المفوّض
   * @param role - الدور التنظيمي للموضوع
   * @param capabilities - أقل القدرات الممنوحة
   * @returns شهادة موقعة قابلة للتحقق
   */
  issue(subject: string, role: string, capabilities: string[] = []): Certificate {
    const body: CertificateBody = {
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
   * يسحب شهادةً بحيث لا تعود مقبولة حتى لو ظل توقيعها صحيحاً.
   * @param certificateId - معرّف الشهادة المسحوبة
   * @param reason - سبب السحب المسجل
   * @returns سجل السحب
   */
  revoke(
    certificateId: string,
    reason: string,
  ): { certificateId: string; reason: string; revokedAt: string } {
    this.revoked.add(certificateId);
    return { certificateId, reason, revokedAt: new Date().toISOString() };
  }

  /**
   * يجمع بين فحص السحب وفحص توقيع ملك الإصدار.
   * @param cert - الشهادة المطلوب التحقق منها
   * @returns صلاحية الشهادة الحالية
   */
  isValid(cert: Certificate): boolean {
    // شهادةٌ ناقصة الحقول تُقرأ باطلة ولا تُسقط الفاحص: من يُلفّق شهادة يُلفّقها
    // ناقصةً كذلك، وانهيارُ الفاحص عندها يُخرجه عن كونه فاحصاً.
    if (!cert || typeof cert !== 'object' || typeof cert.id !== 'string') return false;
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
  name: string;
  certificate: Certificate;

  /**
   * @param ca - السلطة التي تصدر شهادة الوكيل
   * @param name - الاسم المحلي للوكيل
   * @param role - الدور المطلوب للوكيل
   * @param capabilities - القدرات الممنوحة للوكيل
   */
  constructor(ca: CertificateAuthority, name: string, role: string, capabilities: string[] = []) {
    this.name = name;
    this.certificate = ca.issue('agent:' + name, role, capabilities);
  }
}
