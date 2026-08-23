// جذر الثقة — عقد إدارة المفاتيح (الخطوة M2.02).
//
// لماذا واجهة قبل تطبيق: قبل هذه الخطوة كان `EncryptedKeyStore` هو الطريق
// الوحيد لحفظ مادة مفتاح، وهو ملف مشفَّر على قرص الخدمة. أي ربط بمخزن أسرار
// خارجي كان سيعني تعديل كل مستدعٍ. العقد هنا يفصل «ما تحتاجه الدولة من مخزن
// مفاتيح» عن «أين يقيم المخزن»، فتصير الخطوة M2.03 (نقل مفتاح الملك خارج
// المستودع) استبدال تطبيق لا إعادة كتابة مستدعين.
//
// حدود هذا العقد بصراحة: هو عقد **مادة مفاتيح** (put/get/destroy)، لا عقد
// توقيع. مخزن HSM حقيقي لا يُخرج المادة الخاصة أصلاً بل يوقّع داخله، ولذلك
// يُعلن كل تطبيق قدرته في `describe().canExport`، وواجهة التوقيع داخل الحدود
// تُعرَّف حين تُنفَّذ في مسارها (M2.03) ولا يُدَّعى وجودها اليوم.

/**
 * وصف مفتاح دون مادته؛ صالح للعرض والتدقيق ولا يحمل سرًّا.
 * لا يحمل طول المادة قصداً: طول المفتاح معلومة تخدم من يحاول تخمينه، ولأن
 * إدراجه في الجرد يُلزم التطبيق المحلي بفكّ تشفير كل مفتاح لمجرد العدّ.
 */
export interface KeyRecord {
  name: string;
  createdAt: string;
}

/** ما يُعلنه التطبيق عن نفسه؛ يُستخدم في التدقيق وفي قرار «هل يجوز في الإنتاج». */
export interface KeyProviderDescription {
  kind: string;
  location: string;
  canExport: boolean;
  productionReady: boolean;
}

/** خيارات الكتابة. الافتراضي منع الطمس، لأن طمس مفتاح صامتاً فقدان لا تعديل. */
export interface PutOptions {
  overwrite?: boolean;
}

/**
 * عقد مخزن المفاتيح. كل التطبيقات غير متزامنة حتى لو كان تطبيقٌ محلياً
 * متزامناً في داخله، لأن المخزن الخارجي شبكة والعقد لا يُصاغ على الأسهل.
 */
export interface KeyProvider {
  describe(): KeyProviderDescription;
  put(name: string, material: string, options?: PutOptions): Promise<KeyRecord>;
  get(name: string): Promise<string>;
  has(name: string): Promise<boolean>;
  list(): Promise<KeyRecord[]>;
  destroy(name: string): Promise<void>;
}

/** رموز الأخطاء. مثبَّتة نصاً لأن اختبار العقد يوازن بينها في التطبيقين. */
export const KeyProviderErrorCodes = [
  'KEY_NAME_INVALID',
  'KEY_MATERIAL_EMPTY',
  'KEY_NOT_FOUND',
  'KEY_ALREADY_EXISTS',
  'PROVIDER_NOT_CONFIGURED',
  'PROVIDER_UNAVAILABLE',
] as const;

export type KeyProviderErrorCode = (typeof KeyProviderErrorCodes)[number];

/**
 * خطأ المخزن. الرسالة **هي** الرمز ولا تحمل اسم المفتاح ولا مادته، حتى لا
 * يسيل سرٌّ إلى سجل أو إلى رسالة خطأ تُرسل إلى الخارج.
 */
export class KeyProviderError extends Error {
  readonly code: KeyProviderErrorCode;

  constructor(code: KeyProviderErrorCode) {
    super(code);
    this.name = 'KeyProviderError';
    this.code = code;
  }
}

/**
 * حروف الاسم مقيَّدة لأن الاسم يصير جزءاً من مسار ملف في التطبيق المحلي وجزءاً
 * من مسار URL في التطبيق الخارجي. المنع هنا يمنع الهروب من المجلد (`../`)
 * والالتباس في الترميز، ويوحّد سلوك التطبيقين.
 */
const KEY_NAME_PATTERN = /^[a-z0-9][a-z0-9._:-]{0,63}$/;

/**
 * يتحقق من الاسم قبل أي لمس للتخزين، فلا تحدث كتابة جزئية باسم غير مقبول.
 * @param name - الاسم المطلوب فحصه
 */
export function assertKeyName(name: string): void {
  if (typeof name !== 'string' || !KEY_NAME_PATTERN.test(name) || name.includes('..')) {
    throw new KeyProviderError('KEY_NAME_INVALID');
  }
}

/**
 * يتحقق من أن المادة ليست فارغة. مادة فارغة ليست مفتاحاً، وقبولها يُنتج
 * مخزناً يقول «المفتاح موجود» عن لا شيء.
 * @param material - المادة المراد حفظها
 */
export function assertKeyMaterial(material: string): void {
  if (typeof material !== 'string' || material.length === 0) {
    throw new KeyProviderError('KEY_MATERIAL_EMPTY');
  }
}
