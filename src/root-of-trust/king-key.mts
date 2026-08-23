// جذر الثقة — ربط مفتاح الملك بمخزن خارجي (الخطوة M2.03، الفجوة G1).
//
// المشكلة قبل هذه الخطوة: `KingIdentity` كانت تولّد زوج مفاتيح جديداً في كل
// إنشاء، فكان مفتاح الملك عمرُه عمر العملية. ذلك آمن بمعنى «لا مفتاح على
// القرص»، لكنه ليس جذر ثقة: كل إعادة تشغيل تُنتج ملكاً جديداً، فكل شهادة
// صدرت قبلها تصير بلا مُصدِّق. والحل الخاطئ الشائع هو حفظ المفتاح في ملف
// بجانب الخدمة، وهو عين الفجوة G1.
//
// ما تفعله هذه الوحدة: تجعل مادة مفتاح الملك تُسكِن **مخزناً خارجياً** عبر
// عقد `KeyProvider` (M2.02)، وتُحضَر عند الإقلاع في الذاكرة فقط. فلا مفتاح
// خاص في المستودع ولا على قرص الخدمة، وتبقى هوية الملك ثابتة عبر التشغيلات.
//
// حدود معلَنة، لا يُدَّعى غيرها:
//   1. هذا ربطُ **مادة**: المخزن يُخرج المفتاح فيوقّع جذر الثقة في ذاكرته.
//      مخزن HSM الذي لا يُخرج المادة (‏`canExport: false`) يلزمه عقد توقيع
//      داخل الحدود، وهو غير منفَّذ اليوم؛ ولذلك تُرفض هذه الوحدة صراحةً على
//      مخزن لا يُخرج بدل أن تفشل عنده بغموض.
//   2. ما دامت المادة تصل إلى ذاكرة العملية، فحماية الذاكرة (نسخ، تفريغ،
//      لقطة نواة) خارج ضمان هذه الخطوة. وJavaScript لا يعطي محو ذاكرة
//      موثوقاً، فلا يُكتب هنا `zeroize` يوهم بما لا يتحقق.
//   3. لا تدوير ولا إصدارات مفاتيح هنا؛ ذاك معيار M2.04 كاملاً.

import { createPrivateKey, createPublicKey, generateKeyPairSync } from 'node:crypto';
import { KingIdentity } from './identity.mjs';
import type { KeyProvider, KeyProviderDescription, KeyRecord } from './key-provider.mjs';
import { LocalEncryptedKeyProvider } from './key-provider-local.mjs';
import { RemoteSecretStoreKeyProvider } from './key-provider-remote.mjs';

/**
 * اسم مفتاح الملك في المخزن. مثبَّت في الكود لا في الإعداد، لأن اسماً قابلاً
 * للتغيير بمتغير بيئة يسمح بتوجيه جذر الثقة إلى مفتاح آخر بتعديل إعداد.
 */
export const KING_KEY_NAME = 'king-signing-key';

/** رموز أخطاء الربط. مثبَّتة نصاً لأن الاختبارات توازنها. */
export const KingKeyErrorCodes = [
  'KING_KEY_ALREADY_PROVISIONED',
  'KING_KEY_NOT_PROVISIONED',
  'KING_KEY_MATERIAL_INVALID',
  'PROVIDER_NOT_PRODUCTION_READY',
  'PROVIDER_CANNOT_EXPORT',
  'KEY_STORE_NOT_CONFIGURED',
] as const;

export type KingKeyErrorCode = (typeof KingKeyErrorCodes)[number];

/** خطأ الربط. الرسالة هي الرمز ولا تحمل مادة ولا عنوان مخزن ولا توكن. */
export class KingKeyError extends Error {
  readonly code: KingKeyErrorCode;

  constructor(code: KingKeyErrorCode) {
    super(code);
    this.name = 'KingKeyError';
    this.code = code;
  }
}

/** خيارات الربط. `requireProductionReady` افتراضه مشتق من بيئة التشغيل. */
export interface KingKeyOptions {
  /**
   * يمنع ربط جذر الثقة بمخزن يُعلن أنه غير إنتاجي. افتراضه `true` حين تكون
   * `NODE_ENV === 'production'`: في الإنتاج لا يُقبل قرص محلي مشفَّر، وفي
   * التطوير يُقبل صراحةً لأن البديل أن يعمل المطور بلا جذر ثقة أصلاً.
   */
  requireProductionReady?: boolean;
}

/** حصيلة التزويد: معلومة عامة فقط، ولا تُرجَع المادة الخاصة إلى المستدعي. */
export interface KingKeyProvisionResult {
  id: string;
  fingerprint: string;
  publicKeyPem: string;
  record: KeyRecord;
}

/** وصف الربط للتدقيق: أين يقيم مفتاح الملك، وهل هو موجود، وهل المخزن إنتاجي. */
export interface KingKeyBinding {
  keyName: string;
  present: boolean;
  provider: KeyProviderDescription;
}

/**
 * يتحقق من صلاحية المخزن لحمل مفتاح الملك قبل أي عملية عليه.
 * @param provider - المخزن المرشَّح
 * @param options - قيود الربط
 */
function assertProviderFit(provider: KeyProvider, options: KingKeyOptions = {}): void {
  const description = provider.describe();
  const requireProduction = options.requireProductionReady ?? process.env.NODE_ENV === 'production';
  if (requireProduction && !description.productionReady) {
    throw new KingKeyError('PROVIDER_NOT_PRODUCTION_READY');
  }
  // مخزن لا يُخرج المادة يُرفض صراحةً هنا لا يُحاول ويُفشَل بغموض: عقد
  // التوقيع داخل الحدود غير منفَّذ، وادّعاء دعم HSM بلا تنفيذه كذب موثَّق.
  if (!description.canExport) {
    throw new KingKeyError('PROVIDER_CANNOT_EXPORT');
  }
}

/**
 * يبني هوية ملك من مادة مفتاح خاص، ويرفض ما ليس Ed25519.
 * @param material - مفتاح خاص بترميز PKCS8 نصي
 * @returns هوية الملك المرتبطة بالمادة
 */
export function kingIdentityFromMaterial(material: string): KingIdentity {
  let privateKey;
  try {
    privateKey = createPrivateKey(material);
  } catch {
    // النص الأصلي للخطأ لا يُمرَّر: رسائل OpenSSL قد تتضمن مقتطفاً من المادة.
    throw new KingKeyError('KING_KEY_MATERIAL_INVALID');
  }
  if (privateKey.asymmetricKeyType !== 'ed25519') {
    throw new KingKeyError('KING_KEY_MATERIAL_INVALID');
  }
  return new KingIdentity({ privateKey, publicKey: createPublicKey(privateKey) });
}

/**
 * يولّد مفتاح الملك ويحفظ مادته في المخزن الخارجي مرة واحدة.
 * لا يطمس مفتاحاً قائماً: طمس مفتاح الملك يُبطل كل شهادة صدرت عنه، فيُطلب
 * إبطالٌ صريح (`destroy`) قبل تزويد جديد بدل تدمير الجذر بنداء واحد.
 * @param provider - المخزن الذي ستقيم فيه المادة
 * @param options - قيود الربط
 * @returns المعلومة العامة لمفتاح الملك وسجلّه في المخزن
 */
export async function provisionKingKey(
  provider: KeyProvider,
  options: KingKeyOptions = {},
): Promise<KingKeyProvisionResult> {
  assertProviderFit(provider, options);
  if (await provider.has(KING_KEY_NAME)) {
    throw new KingKeyError('KING_KEY_ALREADY_PROVISIONED');
  }
  const keys = generateKeyPairSync('ed25519');
  const material = keys.privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;
  // المادة تُكتب إلى المخزن ولا تُكتب إلى قرص ولا تُطبع ولا تُعاد للمستدعي.
  const record = await provider.put(KING_KEY_NAME, material);
  const king = new KingIdentity({ privateKey: keys.privateKey, publicKey: keys.publicKey });
  return {
    id: king.id,
    fingerprint: king.id.replace(/^king:/, ''),
    publicKeyPem: keys.publicKey.export({ type: 'spki', format: 'pem' }) as string,
    record,
  };
}

/**
 * يُحضِر مفتاح الملك من المخزن الخارجي في الذاكرة ويبني هويته.
 * @param provider - المخزن الذي تقيم فيه المادة
 * @param options - قيود الربط
 * @returns هوية الملك نفسها في كل تشغيل ما دامت المادة نفسها
 */
export async function loadKingIdentity(
  provider: KeyProvider,
  options: KingKeyOptions = {},
): Promise<KingIdentity> {
  assertProviderFit(provider, options);
  if (!(await provider.has(KING_KEY_NAME))) {
    throw new KingKeyError('KING_KEY_NOT_PROVISIONED');
  }
  return kingIdentityFromMaterial(await provider.get(KING_KEY_NAME));
}

/**
 * يصف حالة الربط للتدقيق دون لمس المادة الخاصة.
 * @param provider - المخزن المفحوص
 * @returns اسم المفتاح ووجوده ووصف المخزن
 */
export async function describeKingKeyBinding(provider: KeyProvider): Promise<KingKeyBinding> {
  return {
    keyName: KING_KEY_NAME,
    present: await provider.has(KING_KEY_NAME),
    provider: provider.describe(),
  };
}

/**
 * يبني مخزن مفتاح الملك من بيئة التشغيل. هذه هي نقطة الربط العملية: من يكتب
 * نقطة إقلاع الخدمة لا يختار مخزناً في الكود، بل يُعلنه في البيئة، فلا يحتاج
 * تعديل كود لينتقل من التطوير إلى الإنتاج — وهو عين ما يجعل قرص التطوير لا
 * يتسرّب إلى الإنتاج سهواً.
 *
 * العقد:
 *   - `KING_KEY_STORE_ENDPOINT` و`KING_KEY_STORE_TOKEN` ⇒ مخزن أسرار خارجي.
 *   - أو `KING_KEY_DIR` و`KING_KEY_MASTER` ⇒ قرص محلي مشفَّر، **وللتطوير فقط**؛
 *     ويُرفض في الإنتاج لأنه إقامة مادة مفتاح على قرص الخدمة (الفجوة G1).
 *   - وإلا ⇒ خطأ صريح، لا سقوط إلى مفتاح مولَّد في الذاكرة. فالسقوط الصامت
 *     كان سيُنتج ملكاً جديداً كل إقلاع بلا أن يشتكي أحد.
 * @param env - البيئة المقروءة؛ افتراضها بيئة العملية
 * @returns مخزناً جاهزاً لتمريره إلى `provisionKingKey` أو `loadKingIdentity`
 */
export function kingKeyProviderFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): LocalEncryptedKeyProvider | RemoteSecretStoreKeyProvider {
  const production = env.NODE_ENV === 'production';
  const endpoint = env.KING_KEY_STORE_ENDPOINT;
  const token = env.KING_KEY_STORE_TOKEN;

  if (endpoint !== undefined && endpoint !== '' && token !== undefined && token !== '') {
    const timeout = Number(env.KING_KEY_STORE_TIMEOUT_MS ?? '');
    return new RemoteSecretStoreKeyProvider({
      endpoint,
      token,
      ...(Number.isFinite(timeout) && timeout > 0 ? { timeoutMs: timeout } : {}),
      // النقل غير المشفَّر يبقى ممنوعاً في الإنتاج ولو أُعلن السماح به هنا،
      // لأن العميل نفسه يرفضه إلى مضيف غير محلي (M2.02).
      allowInsecureTransport: !production && env.KING_KEY_STORE_ALLOW_INSECURE === 'true',
    });
  }

  const directory = env.KING_KEY_DIR;
  const master = env.KING_KEY_MASTER;
  if (directory !== undefined && directory !== '' && master !== undefined && master !== '') {
    if (production) throw new KingKeyError('PROVIDER_NOT_PRODUCTION_READY');
    return new LocalEncryptedKeyProvider(directory, master);
  }

  throw new KingKeyError('KEY_STORE_NOT_CONFIGURED');
}
