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

import { assertSoftwareKingIdentityAllowed } from './production-boot.mjs';

/** شهادة صادرة من سلطة التصديق، وتحمل المادة اللازمة للتحقق من تفويض الوكيل. */
export interface Certificate {
  id: string;
  subject: string;
  issuer: string;
  role: string;
  capabilities: string[];
  issuedAt: string;
  /**
   * وقتُ انتهاءِ صلاحيّةِ الشهادةِ (ISO-8601). **إلزاميٌّ** في كلِّ شهادةٍ
   * جديدة: لا تُصدرُ سلطةُ التصديقِ شهادةً بلا انتهاء، فلا تبقى شهادةٌ
   * مسروقةٌ صالحةً إلى الأبد. والانتهاءُ جزءٌ من الجسمِ الموقَّع، فلا يُبدَّلُ
   * إلا بكسرِ التوقيع. (`Grok-F03`).
   */
  notAfter: string;
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
 * مصدرُ الزمنِ القابلُ للحقنِ في سلطةِ التصديق. الافتراضيُّ `() => Date.now()`،
 * لكنّ الغرضَ من عزله جعلُ إلزامِ الساعةِ الموثوقة (`Grok-F04`) تغييراً في
 * التركيبِ والسياسةِ لا إعادةَ تصميم: تُحقَنُ ساعةٌ موثوقةٌ (`TrustedClock`)
 * في الإنتاجِ، وتُحقَنُ ساعةٌ قابلةٌ للتحكيمِ في الاختبار. ولا يستعملُ أحدٌ
 * `Date.now()` مباشرةً في منطقِ انتهاءِ الصلاحيّة.
 */
export type TimeSource = () => number;

/**
 * مخزنُ سحبِ الشهاداتِ الدائم. الافتراضيُّ في الذاكرةِ (للاختبارِ والتطوير)،
 * لكنّ وجودَ تنفيذٍ دائمٍ (PostgreSQL) هو ما يُغلقُ `Grok-F03`: شهادةٌ
 * تُسحبُ تُكتَبُ هنا، ويُحمَّلُ هذا المخزنُ قبلَ أيِّ `isValid`، فلا تعودُ
 * شهادةٌ مسحوبةٌ صالحةً بعدَ إعادةِ إقلاعٍ. والواجهةُ **تفشلُ مغلقةً**: إن لم
 * يكن المخزنُ جاهزاً للقراءةِ يُرجعُ `isValid` `false`، فلا يمرُّ وكيلٌ
 * بناءً على غيابِ دليلِ الإبطال.
 */
export interface RevocationStore {
  /** هل سُحبتْ هذه الشهادة؟ يُحمَّلُ من القرصِ، فلا يُفقدُ بعدَ إعادةِ تشغيل. */
  isRevoked(certificateId: string): boolean;
  /** يسحبُ شهادةً بكتابةٍ دائمة. يُرجعُ `true` إن نجحَ الحفظُ، `false` إن فشل. */
  revoke(certificateId: string, revokedBy: string, reason: string): boolean;
  /** هل حُمِّلَ المخزنُ وجاهزٌ للقراءة؟ إن لم يكن، `isValid` يُرجعُ `false`. */
  ready(): boolean;
}

/**
 * مخزنُ سحبٍ في الذاكرةِ — التنفيذُ الافتراضيُّ للسلطة. يُستعملُ في الاختبارِ
 * والتطويرِ، وفيه أثرُ السحبِ ضمنَ العمليةِ الحيّةِ وحدَها. لا يَدومُ، لكنّه
 * يَحققُ نفسَ عقدِ `RevocationStore` فيُحقَنُ حيثُ لا قاعدةَ بيانات.
 */
export class MemoryRevocationStore implements RevocationStore {
  private readonly revoked = new Set<string>();
  isRevoked(certificateId: string): boolean {
    return this.revoked.has(certificateId);
  }
  revoke(certificateId: string): boolean {
    this.revoked.add(certificateId);
    return true;
  }
  ready(): boolean {
    return true;
  }
}

/** المدّةُ الافتراضيّةُ لصلاحيّةِ الشهادة: سبعةُ أيّام. مسمّاةٌ وموثَّقةٌ. */
export const DEFAULT_CERTIFICATE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

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
   *
   * وأُضيف في `WL-089` قيدُ التركيب: هذه الهويةُ **برمجيّةٌ** — مادتُها في
   * ذاكرةِ العمليةِ — فتُرفَض في الإنتاج (`SOFTWARE_KING_IDENTITY_FORBIDDEN_IN_PRODUCTION`)
   * ويبقى بديلُها `HsmSigner` في `hsm-binding.mts`. والفحصُ **قبل** توليدِ
   * الزوجِ لا بعده: المعاملُ الافتراضيُّ نُقل إلى جسمِ المُنشئِ كي لا تُولَّد
   * مادةُ مفتاحٍ في الإنتاج ثم يُرفع الخطأُ بعد وجودِها في الذاكرة.
   * @param keys - زوج مفاتيح محضَر؛ إن غاب وُلّد زوج جديد في الذاكرة
   */
  constructor(keys?: KingKeyPair) {
    assertSoftwareKingIdentityAllowed();
    const material = keys ?? generateKeyPairSync('ed25519');
    this.id = 'king:' + fingerprint(material.publicKey).slice(0, 24);
    this.privateKey = material.privateKey;
    this.publicKey = material.publicKey;
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

export interface CertificateAuthorityOptions {
  /** مخزنُ سحبٍ دائم؛ إن غاب فالذاكرة (في العمليةِ الحيّةِ وحدَها). */
  revocationStore?: RevocationStore;
  /** مصدرُ الزمنِ؛ إن غاب فـ`Date.now`. يُعزلُ ليُحقَنَ الموثوقُ لاحقاً. */
  now?: TimeSource;
  /**
   * مدّةُ صلاحيّةِ كلِّ شهادةٍ تُصدرُ؛ إن غابت فالافتراضيّة `DEFAULT_CERTIFICATE_TTL_MS`.
   * لا يمكنٌ إصدارُ شهادةٍ بلا انتهاء.
   */
  defaultTtlMs?: number;
  /**
   * قبولُ الشهاداتِ القديمةِ بلا `notAfter`؟ **افتراضُه `false`**: شهادةٌ بلا
   * انتهاءٍ تُرفَضُ، فلا تمرُّ شهادةٌ مسروقةٌ قديمةٌ بلا أمد. لا يُفعَّلُ إلّا
   * لترحيلٍ موثَّقٍ صراحةً.
   */
  allowLegacyCertificatesWithoutExpiry?: boolean;
}

export class CertificateAuthority {
  king: KingIdentity;
  private readonly revoked: RevocationStore;
  private readonly now: TimeSource;
  private readonly defaultTtlMs: number;
  private readonly allowLegacy: boolean;

  /**
   * @param king - هوية الملك التي توقع الشهادات
   * @param options - مخزنُ السحبِ ومصدرُ الزمنِ ومدّةُ الصلاحيّةِ
   */
  constructor(king: KingIdentity, options: CertificateAuthorityOptions = {}) {
    this.king = king;
    this.revoked = options.revocationStore ?? new MemoryRevocationStore();
    this.now = options.now ?? (() => Date.now());
    this.defaultTtlMs = options.defaultTtlMs ?? DEFAULT_CERTIFICATE_TTL_MS;
    this.allowLegacy = options.allowLegacyCertificatesWithoutExpiry ?? false;
  }

  /**
   * يصدر تفويضاً محدد الدور والقدرات لوكيل معروف. كلُّ شهادةٍ تنتهي بعدَ مدّةٍ
   * محدودةٍ (`notAfter`)، فلا تبقى صالحةً إلى الأبد. والانتهاءُ جزءٌ من الجسمِ
   * الموقَّع، فلا يُبدَّلُ إلا بكسرِ التوقيع.
   * @param subject - معرّف الموضوع المفوّض
   * @param role - الدور التنظيمي للموضوع
   * @param capabilities - أقل القدرات الممنوحة
   * @param ttlMs - مدّةُ الصلاحيّةِ؛ إن غابت فالافتراضيّة
   * @returns شهادة موقعة قابلة للتحقق
   */
  issue(subject: string, role: string, capabilities: string[] = [], ttlMs?: number): Certificate {
    const issuedAt = this.now();
    const notAfter = new Date(issuedAt + (ttlMs ?? this.defaultTtlMs)).toISOString();
    const body: CertificateBody = {
      id: randomUUID(),
      subject,
      issuer: this.king.id,
      role,
      capabilities,
      issuedAt: new Date(issuedAt).toISOString(),
      notAfter,
    };
    return { ...body, signature: this.king.sign(body) };
  }

  /**
   * يسحبُ شهادةً بكتابةٍ دائمة في المخزن. إن فشلَ الحفظُ الدائمُ لم يُحدَّث
   * في الذاكرةِ — فلا يُمرَّرُ السحبُ كأنّه نجح. والسحبُ أحاديُّ الاتجاهِ: لا
   * يُلغى إلّا بإصدارِ شهادةٍ جديدةٍ بمعرّفٍ مختلف.
   * @param certificateId - معرّف الشهادة المسحوبة
   * @param reason - سبب السحب المسجل
   * @returns سجل السحب؛ `persisted: false` إن لم يُكتبْ في المخزنِ الدائم
   */
  revoke(
    certificateId: string,
    reason: string,
  ): { certificateId: string; reason: string; revokedAt: string; persisted: boolean } {
    // الفشلُ مغلقٌ: إن لم يكن المخزنُ جاهزاً، أو رفضَ الكتابةَ، فالسحبُ **لم
    // يحدثْ**. فلا يدَّعي المستدعي أنّ الشهادةَ مسحوبةٌ وهي لم تُكتبْ، فتبقى
    // صالحةً عند من لم يرَ المخزنَ.
    if (!this.revoked.ready()) {
      return {
        certificateId,
        reason,
        revokedAt: new Date(this.now()).toISOString(),
        persisted: false,
      };
    }
    const persisted = this.revoked.revoke(certificateId, this.king.id, reason);
    return {
      certificateId,
      reason,
      revokedAt: new Date(this.now()).toISOString(),
      persisted,
    };
  }

  /**
   * يجمع بين فحصِ السحبِ الدائمِ وفحصِ انتهاءِ الصلاحيّةِ وفحصِ توقيعِ ملكِ
   * الإصدار. كلُّ ما لا يمكنُ التحققُ منه يُرجعُ `false` — فلا تمرُّ شهادةٌ
   * بناءً على غيابِ دليلٍ.
   * @param cert - الشهادة المطلوب التحقق منها
   * @returns صلاحية الشهادة الحالية
   */
  isValid(cert: Certificate): boolean {
    // شهادةٌ ناقصة الحقول تُقرأ باطلة ولا تُسقط الفاحص: من يُلفّق شهادة يُلفّقها
    // ناقصةً كذلك، وانهيارُ الفاحص عندها يُخرجه عن كونه فاحصاً.
    if (!cert || typeof cert !== 'object' || typeof cert.id !== 'string') return false;
    // المخزنُ غيرُ جاهزٍ ← رفضٌ مغلقٌ: لا يُسمحُ بمرورِ وكيلٍ بناءً على غيابِ
    // دليلِ الإبطال. إن لم يُحمَلْ السجلُ الدائمُ فلا يُعرفُ هل سُحبتْ، فيُرفض.
    if (!this.revoked.ready()) return false;
    if (this.revoked.isRevoked(cert.id)) return false;
    // انتهاءُ الصلاحيّةِ (`Grok-F03`): شهادةٌ بلا `notAfter` تُرفَضُ افتراضاً
    // (إلّا في وضعِ الترحيلِ الصريح)، فلا تمرُّ شهادةٌ قديمةٌ بلا أمد. وانتهى
    // أجلُها ← باطلةٌ وإن صحَّ توقيعُها.
    if (typeof cert.notAfter !== 'string' || cert.notAfter === '') {
      if (!this.allowLegacy) return false;
    } else {
      const notAfterMs = Date.parse(cert.notAfter);
      if (!Number.isFinite(notAfterMs)) return false;
      if (this.now() >= notAfterMs) return false;
    }
    // الجسمُ الموقَّعُ يُعادُ بناؤه من حقولِ الشهادةِ بترتيبٍ ثابت: `notAfter`
    // جزءٌ منه، فتبديلُه يكسرُ التوقيع.
    const body: CertificateBody = {
      id: cert.id,
      subject: cert.subject,
      issuer: cert.issuer,
      role: cert.role,
      capabilities: cert.capabilities,
      issuedAt: cert.issuedAt,
      notAfter: cert.notAfter,
    };
    return this.king.verify(body, cert.signature);
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
