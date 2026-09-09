// src/root-of-trust/production-boot.mts
// جذر الثقة — قيدُ التركيبِ عند نقطةِ الإقلاعِ الإنتاجيّة (WL-089، ADR 0004).
//
// **الحدُّ الذي تُغلقه هذه الوحدة، وقد قِيس لا افتُرض:** بعد `3f239e93` صارت
// المفاتيح F05/F06/F07 مربوطةً بمساراتها داخل التوكن في `hsm-binding.mts`،
// لكنّ **الإنتاج لم يكن مُلزَماً بها**. الطريقُ البرمجيُّ كان قائماً ومفتوحاً:
//
//   1. `kingKeyProviderFromEnv` كانت تُرجع `RemoteSecretStoreKeyProvider` في
//      الإنتاج، ووصفُه `canExport: true` و`productionReady: true` على https.
//   2. `assertKingKeyProviderFit` كانت **تُلزِم** `canExport: true`، فكان مخزنٌ
//      لا يُصدِّر (أي HSM) مرفوضاً ومخزنٌ يُصدِّر مقبولاً — أي أنّ عقدَ المادةِ
//      كان يُفضّل البرمجيَّ على العتاديِّ في الإنتاج.
//   3. `new KingIdentity()` بلا وسائطَ كانت تولّد زوجاً في ذاكرةِ العملية بلا
//      أيِّ فحصِ بيئةٍ، فكلُّ نقطةِ إقلاعٍ تقدر أن تُركّب جذرَ ثقةٍ برمجياً.
//
// فكان الإنتاجُ قادراً على العملِ بمفتاحٍ برمجيٍّ كاملِ المادةِ في الذاكرة،
// و**غيابُ HSM لا يُوقِف شيئاً**. وهذا هو الحدُّ المُعلَن في ADR 0003:
// «`KingIdentity` البرمجي يبقى قائماً لمسارات التطوير والاختبار؛ منعُه في
// الإنتاج قيدُ تركيبٍ عند نقطةِ الإقلاع». هذه الوحدة هي ذلك القيد.
//
// القاعدةُ المُنفَّذة، بأربعةِ أحكامٍ لا استثناءَ فيها:
//   • **الإنتاجُ يفرض HSM.** لا مخزنَ مادةٍ برمجيّاً، ولا هويةَ ملكٍ برمجيّةً،
//     ولا موفّراً يُعلن `canExport: true`.
//   • **التطويرُ والاختبارُ** يستعملان `KingIdentity` البرمجي، **ولا يُحذف**.
//   • **غيابُ HSM أو نقصُ إعدادِه (وحدة، توكن، PIN) فشلٌ مغلقٌ** برمزٍ مُسمّىً،
//     لا سقوطٌ إلى مفتاحٍ برمجيٍّ ولا صمتٌ.
//   • **لا وضعَ تطويريٍّ يُصرَّح به في الإنتاج:** `XUUX_ROOT_OF_TRUST_MODE=software`
//     يُرَدُّ في الإنتاج بدل أن يُقرأ إذناً.
//
// وحدودٌ معلَنة: هذه الوحدة **قيدُ تركيبٍ** لا حرسُ عتادٍ. لا تُثبت أنّ التوكن
// عتاديٌّ ولا أنّ PIN صحيحٌ ولا أنّ المفتاحَ في التوكن هو المفتاحُ المقصود —
// ذاك عملُ `pkcs11-provider.mts` عند فتحِ الجلسةِ وعملُ `hsm-binding.mts` عند
// ربطِ الأدوار. ما تُثبته هنا: **لا مسارَ برمجيّاً مفتوحاً في الإنتاج**.

/**
 * متغيّراتُ البيئةِ التي تُعلن وضعَ التشغيل، بترتيبِ الأولويّة: `STATE_ENV`
 * يسبق `NODE_ENV` كما في `src/persistence/db.mjs` و`src/data/encryption.mjs`،
 * فلا يتفارق تعريفُ «الإنتاج» بين جذرِ الثقةِ وبقيّةِ الدولة.
 */
export const RUNTIME_ENV_KEYS = ['STATE_ENV', 'NODE_ENV'] as const;

/**
 * القيمُ المقبولةُ لكلِّ متغيّرِ إعلانٍ — **منقولةٌ حرفاً عن `config/environment.yaml`**
 * (‏`STATE_ENV` بصيغةِ `^(development|ci|production)$` و`NODE_ENV` بصيغةِ
 * `^(development|test|production)$`)، فلا يُخترَعُ هنا عقدٌ ثانٍ للبيئة.
 *
 * ولماذا لُزوم القائمةِ لا مجردُ المقابلةِ بـ`'production'`: أثبتَ عضوا الجولةِ
 * الثانيةِ (‏`UF-04`) أنّ `NODE_ENV=Production` و`'production '` و`STATE_ENV=' '`
 * كانت **تُقرأُ «ليس إنتاجاً»** فتُفتَحُ مساراتُ المفاتيحِ البرمجيّةِ في عقدةٍ
 * يظنُّ مشغّلُها أنه أعلنَ الإنتاج. فالقيمةُ التي لا يعرفُها العقدُ **تُرفَض**
 * ولا تُقرأُ إذناً ولا تُقرأُ تطويراً.
 */
export const RUNTIME_ENV_VALUES: Readonly<Record<(typeof RUNTIME_ENV_KEYS)[number], string[]>> =
  Object.freeze({
    STATE_ENV: ['development', 'ci', 'production'],
    NODE_ENV: ['development', 'test', 'production'],
  });

/** اسمُ المتغيّرِ الذي يُصرِّح بوضعِ جذرِ الثقةِ صراحةً. */
export const ROOT_OF_TRUST_MODE_ENV = 'XUUX_ROOT_OF_TRUST_MODE';

/** الأوضاعُ المقبولةُ في `XUUX_ROOT_OF_TRUST_MODE`. */
export const ROOT_OF_TRUST_MODES = ['hsm', 'software'] as const;

export type RootOfTrustMode = (typeof ROOT_OF_TRUST_MODES)[number];

/**
 * إعدادُ HSM اللازمُ لفتحِ التوكن. الأسماءُ نفسُها التي يقرأها
 * `Pkcs11HsmProvider.fromEnv`، فلا يُفحَص هنا اسمٌ لا يُستعمل هناك.
 */
export const HSM_REQUIRED_ENV_VARS = ['XUUX_PKCS11_MODULE', 'XUUX_PKCS11_TOKEN'] as const;

/** مصدرا PIN المقبولان؛ أحدُهما يكفي، وغيابُهما جميعاً نقصُ إعدادٍ. */
export const HSM_PIN_ENV_VARS = ['XUUX_PKCS11_PIN', 'XUUX_PKCS11_PIN_FILE'] as const;

/**
 * **تثبيتُ هويّةِ التوكنِ والملكِ** — إلزاميٌّ في الإنتاجِ (‏`UF-05`).
 *
 * أثبتَ العضوُ الثاني بإعادةِ إنتاجٍ على توكنينِ حقيقيّينِ أنّ توكناً ثانياً
 * يحملُ **الاسمَ نفسَه** يُقبَلُ بلا إنذارٍ فيصيرُ الملكُ ملكاً آخرَ: الاكتشافُ
 * كان بالاسمِ وحدَه، والرقمُ التسلسليُّ اختياريّاً، ولا بصمةَ للموديولِ ولا
 * تثبيتَ لهويةِ الملكِ. فصارت الثلاثةُ عقداً:
 *   • `XUUX_PKCS11_TOKEN_SERIAL` — الرقمُ التسلسليُّ للتوكنِ المقصودِ بعينِه.
 *   • `XUUX_PKCS11_MODULE_SHA256` — بصمةُ ملفِّ موديولِ PKCS#11 قبلَ تحميلِه.
 *   • `XUUX_KING_ID` — هويةُ الملكِ المنتظرةُ (بصمةُ مفتاحٍ عامٍّ لا مادةٌ خاصّة).
 */
export const HSM_PINNING_ENV_VARS = [
  'XUUX_PKCS11_TOKEN_SERIAL',
  'XUUX_PKCS11_MODULE_SHA256',
  'XUUX_KING_ID',
] as const;

/**
 * متغيّراتُ مخزنِ المفاتيحِ **البرمجي**. المصدرُ الواحدُ لهذه القائمة: تُقرأ
 * هنا ويُعيد `hsm-binding.mts` تصديرَها باسمِه القديم، فلا تتفارق نسختان
 * فيصير متغيّرٌ ممنوعاً في وحدةٍ ومقبولاً في أخرى.
 */
export const SOFTWARE_KEY_STORE_ENV_VARS = [
  'KING_KEY_DIR',
  'KING_KEY_MASTER',
  'KING_KEY_STORE_ENDPOINT',
  'KING_KEY_STORE_TOKEN',
  'KING_KEY_STORE_ALLOW_INSECURE',
] as const;

/** الصنفُ الوحيدُ من الموفّرين المقبولُ في الإنتاج (وصفُ `Pkcs11HsmProvider`). */
export const PRODUCTION_PROVIDER_KIND = 'pkcs11-hsm';

/** رموزُ الرفض. مثبَّتةٌ نصّاً لأن الاختباراتَ توازنُها ولا تُخمَّن من رسالة. */
export const ProductionBootErrorCodes = [
  'HSM_REQUIRED_IN_PRODUCTION',
  'HSM_CONFIG_INCOMPLETE_IN_PRODUCTION',
  'SOFTWARE_KEY_STORE_FORBIDDEN_IN_PRODUCTION',
  'EXPORTABLE_PROVIDER_FORBIDDEN_IN_PRODUCTION',
  'SOFTWARE_KING_IDENTITY_FORBIDDEN_IN_PRODUCTION',
  'DEV_MODE_FORBIDDEN_IN_PRODUCTION',
  'ROOT_OF_TRUST_MODE_INVALID',
  'RUNTIME_ENV_INVALID',
  'HSM_PINNING_REQUIRED_IN_PRODUCTION',
  'KING_IDENTITY_PIN_MISMATCH',
] as const;

export type ProductionBootErrorCode = (typeof ProductionBootErrorCodes)[number];

/**
 * خطأُ قيدِ التركيب. الرسالةُ هي الرمزُ، و`detail` يحمل **أسماءً** لا قيماً:
 * لا PIN ولا توكن ولا مسار مخزنٍ ولا مادة تدخل رسالةَ خطأ تُطبَع أو تُسجَّل.
 */
export class ProductionBootError extends Error {
  readonly code: ProductionBootErrorCode;
  readonly detail?: string;

  /**
   * @param code - رمزُ الرفض
   * @param detail - تفصيلٌ يُقرأ برمجياً، بلا أسرار
   */
  constructor(code: ProductionBootErrorCode, detail?: string) {
    super(code);
    this.name = 'ProductionBootError';
    this.code = code;
    if (detail !== undefined) this.detail = detail;
  }
}

/**
 * قيمةٌ حاضرةٌ فعلاً: غيرُ معرَّفةٍ أو نصٌّ فارغٌ = غائبة. فمتغيّرٌ مُعلَنٌ
 * بقيمةٍ فارغةٍ لا يُقرأ إعداداً حاضراً، ولا يُقرأ إذناً كذلك.
 * @param value - القيمةُ المقروءةُ من البيئة
 * @returns هل هي حاضرةٌ فعلاً
 */
function present(value: string | undefined): boolean {
  // `trim` لا مقابلةٌ بالفراغِ وحدَه: أثبتَ العضوُ الثاني (‏`UF-09`) أنّ
  // `XUUX_PKCS11_MODULE=' '` كانت تُقرأُ **حاضرةً** فيصيرُ `hsmConfigured=true`
  // على إعدادٍ لا يفتحُ توكناً؛ وقيمةٌ من فراغٍ غيابٌ لا حضور.
  return value !== undefined && value.trim() !== '';
}

/**
 * يرفضُ كلَّ قيمةِ إعلانٍ لا يعرفُها العقدُ. الفشلُ مغلقٌ في كلِّ البيئاتِ: قيمةٌ
 * مكتوبةٌ خطأً (‏`Production`، `prod`، `production `) كانت تُقرأُ «ليس إنتاجاً»
 * فتُلغي أثرَ الإعلانِ صامتةً — وهو ما أثبتَه العضوانِ في `UF-04`. والفراغُ
 * غيابٌ لا قيمةٌ، فلا يُحكَمُ عليه هنا (يحكمُ عليه `present`).
 * @param env - البيئةُ المقروءة
 */
export function assertRuntimeEnvDeclared(env: NodeJS.ProcessEnv = process.env): void {
  for (const key of RUNTIME_ENV_KEYS) {
    const raw = env[key];
    if (!present(raw)) continue;
    const value = (raw as string).trim();
    // القيمةُ تُقارَنُ **بعدَ `trim` وحدَه** لا بعدَ توحيدِ حالةِ الأحرفِ: من
    // كتبَ `Production` أخطأ إعلاناً، ولا يُصحَّحُ له إعلانُه ضِمناً.
    if (!(RUNTIME_ENV_VALUES[key] ?? []).includes(value)) {
      throw new ProductionBootError('RUNTIME_ENV_INVALID', key);
    }
    if (value !== raw) {
      throw new ProductionBootError('RUNTIME_ENV_INVALID', key);
    }
  }
}

/**
 * هل التركيبُ إنتاجيٌّ؟ `STATE_ENV` ثم `NODE_ENV`، والقيمةُ المطلوبةُ
 * `production` حرفاً. وما سوى ذلك ليس إنتاجاً — وهذا مقصودٌ: الإنتاجُ
 * **يُعلَن** ولا يُستنبَط، لكن ما يُبنى عليه في الإنتاج مغلقٌ بلا استثناء.
 * @param env - البيئةُ المقروءةُ؛ افتراضُها بيئةُ العملية
 * @returns هل الوضعُ إنتاجيٌّ
 */
export function isProductionRuntime(env: NodeJS.ProcessEnv = process.env): boolean {
  // الفحصُ قبلَ القراءةِ: إعلانٌ لا يعرفُه العقدُ يُرفَعُ خطأً ولا يُقرأُ حالةً
  // ثالثةً صامتةً (‏`UF-04`).
  assertRuntimeEnvDeclared(env);
  const declared = present(env.STATE_ENV) ? env.STATE_ENV : env.NODE_ENV;
  return declared === 'production';
}

/**
 * يقرأ الوضعَ المُصرَّحَ به، ويرفض قيمةً لا يعرفها. الفشلُ مغلقٌ في كلِّ
 * البيئات: قيمةٌ مكتوبةٌ خطأً (‏`HSM`، `hsm-only`، `true`) كانت ستُقرأ
 * «غيرَ مُصرَّحٍ» فتُلغي أثرَ الإعلانِ صامتةً.
 * @param env - البيئةُ المقروءة
 * @returns الوضعُ المُصرَّحُ به أو `null` إن لم يُصرَّح
 */
export function readRootOfTrustMode(env: NodeJS.ProcessEnv = process.env): RootOfTrustMode | null {
  const raw = env[ROOT_OF_TRUST_MODE_ENV];
  if (!present(raw)) return null;
  const mode = raw as RootOfTrustMode;
  if (!ROOT_OF_TRUST_MODES.includes(mode)) {
    throw new ProductionBootError('ROOT_OF_TRUST_MODE_INVALID', ROOT_OF_TRUST_MODE_ENV);
  }
  return mode;
}

/**
 * أسماءُ متغيّراتِ المخزنِ البرمجيِّ الحاضرةِ في البيئة (أسماءٌ فقط).
 * @param env - البيئةُ المقروءة
 * @returns الأسماءُ الحاضرة
 */
export function presentSoftwareKeyStoreVars(env: NodeJS.ProcessEnv = process.env): string[] {
  return SOFTWARE_KEY_STORE_ENV_VARS.filter((name) => present(env[name]));
}

/**
 * يرفض في الإنتاج كلَّ ما يُتيح مساراً برمجياً، ويُلزِم إعدادَ HSM كاملاً.
 * ترتيبُ الفحوصِ مقصودٌ: الوضعُ المُصرَّحُ أولاً (فمن أعلن `software` في
 * الإنتاج أخطأ إعلاناً لا إعداداً)، ثم بقايا المخزنِ البرمجيِّ، ثم حضورُ
 * إعدادِ التوكن، ثم كفايتُه. فالرمزُ الراجعُ يدلُّ على السببِ الأوّلِ لا على
 * آخرِ ما تعذّر.
 * @param env - البيئةُ المقروءة
 */
export function assertHsmRequiredInProduction(env: NodeJS.ProcessEnv = process.env): void {
  const mode = readRootOfTrustMode(env);
  if (!isProductionRuntime(env)) return;
  if (mode === 'software') {
    throw new ProductionBootError('DEV_MODE_FORBIDDEN_IN_PRODUCTION', ROOT_OF_TRUST_MODE_ENV);
  }
  const software = presentSoftwareKeyStoreVars(env);
  if (software.length > 0) {
    throw new ProductionBootError('SOFTWARE_KEY_STORE_FORBIDDEN_IN_PRODUCTION', software.join(','));
  }
  const missing = HSM_REQUIRED_ENV_VARS.filter((name) => !present(env[name]));
  if (missing.length > 0) {
    throw new ProductionBootError('HSM_REQUIRED_IN_PRODUCTION', missing.join(','));
  }
  if (!HSM_PIN_ENV_VARS.some((name) => present(env[name]))) {
    throw new ProductionBootError(
      'HSM_CONFIG_INCOMPLETE_IN_PRODUCTION',
      HSM_PIN_ENV_VARS.join('|'),
    );
  }
  // تثبيتُ الهويّةِ آخرُ الفحوصِ لا أوّلُها: من نقصَه التوكنُ أصلاً يُقالُ له
  // «لا توكن» لا «لا بصمة»، فالرمزُ الراجعُ يدلُّ على السببِ الأوّل.
  const unpinned = HSM_PINNING_ENV_VARS.filter((name) => !present(env[name]));
  if (unpinned.length > 0) {
    throw new ProductionBootError('HSM_PINNING_REQUIRED_IN_PRODUCTION', unpinned.join(','));
  }
}

/**
 * يقابلُ هويةَ الملكِ الحاضرةَ بالمُثبَّتةِ في البيئةِ (‏`UF-05`). خارجَ الإنتاجِ
 * لا يحكمُ شيئاً إن لم تُثبَّت، ويحكمُ إن ثُبِّتت — فمن ثبّتَ أراد التثبيتَ.
 * @param kingId - هويةُ الملكِ كما اشتُقّت من المفتاحِ العامِّ في التوكن
 * @param env - البيئةُ المقروءة
 */
export function assertKingIdentityPinned(
  kingId: string,
  env: NodeJS.ProcessEnv = process.env,
): void {
  const pinned = env.XUUX_KING_ID;
  if (!present(pinned)) {
    if (!isProductionRuntime(env)) return;
    throw new ProductionBootError('HSM_PINNING_REQUIRED_IN_PRODUCTION', 'XUUX_KING_ID');
  }
  if ((pinned as string).trim() !== kingId) {
    // التفصيلُ يحملُ **المنتظَرَ** لا الحاضرَ: هويةُ الملكِ بصمةٌ عامّةٌ، والرسالةُ
    // تُقرأُ في سجلٍّ فلا يُضاف إليها ما لا يلزمُ التشخيص.
    throw new ProductionBootError('KING_IDENTITY_PIN_MISMATCH', 'XUUX_KING_ID');
  }
}

/**
 * يرفض تركيبَ هويةِ ملكٍ **برمجيّةٍ** حيث لا تجوز. يُنادى من مُنشئ
 * `KingIdentity` نفسِه، فلا يبقى بابٌ خلفيٌّ: كلُّ طريقٍ إلى مفتاحٍ في ذاكرةِ
 * العمليةِ يمرُّ من هناك (توليدٌ، أو مادةٌ مُحضَرةٌ من مخزن، أو تعايشُ إصدارات).
 *
 * والوضعُ المُصرَّحُ `hsm` يمنعُها **حتى خارجَ الإنتاج**: من أعلن أنه يعمل على
 * التوكن ثم رُكّب له مفتاحٌ برمجيٌّ فقد وقع في fallback صامتٍ — وهو ما يُقاس
 * في التطويرِ قبل أن يُكتشَف في الإنتاج.
 * @param env - البيئةُ المقروءة
 */
export function assertSoftwareKingIdentityAllowed(env: NodeJS.ProcessEnv = process.env): void {
  const mode = readRootOfTrustMode(env);
  if (isProductionRuntime(env)) {
    throw new ProductionBootError(
      'SOFTWARE_KING_IDENTITY_FORBIDDEN_IN_PRODUCTION',
      mode === 'software' ? ROOT_OF_TRUST_MODE_ENV : 'runtime',
    );
  }
  if (mode === 'hsm') {
    throw new ProductionBootError(
      'SOFTWARE_KING_IDENTITY_FORBIDDEN_IN_PRODUCTION',
      ROOT_OF_TRUST_MODE_ENV,
    );
  }
}

/** أقلُّ ما يُقرأ من وصفِ موفّرٍ للحكمِ عليه، فلا يُشترَط نوعٌ كاملٌ. */
export interface ProviderDescriptionLike {
  kind: string;
  canExport: boolean;
  productionReady?: boolean;
}

/**
 * يحكم على موفّرِ مفاتيحَ قبلَ استعمالِه في الإنتاج. في الإنتاج: موفّرٌ
 * يُصدِّر المادةَ مرفوضٌ، وموفّرٌ ليس توكنَ PKCS#11 مرفوضٌ، وموفّرٌ يُعلن أنه
 * غيرُ إنتاجيٍّ مرفوضٌ. وخارجَ الإنتاج لا يحكم شيئاً — القيدُ قيدُ إنتاجٍ لا
 * تضييقٌ على المطوّر.
 * @param description - وصفُ الموفّرِ كما يُعلنه عن نفسِه
 * @param env - البيئةُ المقروءة
 */
export function assertProductionKeyProviderAllowed(
  description: ProviderDescriptionLike,
  env: NodeJS.ProcessEnv = process.env,
): void {
  if (!isProductionRuntime(env)) return;
  // `!== false` نصّاً لا صدقيّةً: أثبتَ العضوُ الثاني (‏`UF-10`) أنّ
  // `canExport: undefined` و`0` كانا يمرّانِ من فحصِ الصدقيّةِ. وموفّرٌ لا يقولُ
  // «لا أُصدِّر» صريحاً ليس موفّراً غيرَ مُصدِّرٍ.
  if (description.canExport !== false) {
    throw new ProductionBootError('EXPORTABLE_PROVIDER_FORBIDDEN_IN_PRODUCTION', description.kind);
  }
  if (description.kind !== PRODUCTION_PROVIDER_KIND) {
    throw new ProductionBootError('SOFTWARE_KEY_STORE_FORBIDDEN_IN_PRODUCTION', description.kind);
  }
  if (description.productionReady === false) {
    throw new ProductionBootError('SOFTWARE_KEY_STORE_FORBIDDEN_IN_PRODUCTION', description.kind);
  }
}

/** وصفُ قرارِ الإقلاعِ للتدقيق: لا يحمل قيمةَ متغيّرٍ واحدةً. */
export interface RootOfTrustBootDescription {
  production: boolean;
  declaredMode: RootOfTrustMode | null;
  effectiveMode: RootOfTrustMode;
  hsmRequired: boolean;
  hsmConfigured: boolean;
  softwareKeyStoreVarsPresent: string[];
}

/**
 * يصف قرارَ الإقلاعِ بلا أثرٍ ولا سرٍّ — للتقاريرِ وحزمِ الأدلّةِ ولمسارِ
 * تشخيصٍ يُقرأ قبل أن يُشتكى. الوصفُ **لا يُغني عن الفحص**: من أراد الحكمَ
 * ينادي `assertHsmRequiredInProduction`، ومن أراد أن يُطبع الحالُ ينادي هذه.
 * @param env - البيئةُ المقروءة
 * @returns وصفُ القرار
 */
export function describeRootOfTrustBoot(
  env: NodeJS.ProcessEnv = process.env,
): RootOfTrustBootDescription {
  const production = isProductionRuntime(env);
  let declaredMode: RootOfTrustMode | null;
  try {
    declaredMode = readRootOfTrustMode(env);
  } catch {
    // وصفٌ لا يُسقِط مُستدعيه: القيمةُ الفاسدةُ تُقرأ «غيرَ مُصرَّحٍ» في
    // **الوصفِ** وحدَه، والحكمُ يبقى في `assertHsmRequiredInProduction`.
    declaredMode = null;
  }
  const hsmConfigured =
    HSM_REQUIRED_ENV_VARS.every((name) => present(env[name])) &&
    HSM_PIN_ENV_VARS.some((name) => present(env[name])) &&
    HSM_PINNING_ENV_VARS.every((name) => present(env[name]));
  return {
    production,
    declaredMode,
    effectiveMode: production || declaredMode === 'hsm' ? 'hsm' : 'software',
    hsmRequired: production || declaredMode === 'hsm',
    hsmConfigured,
    softwareKeyStoreVarsPresent: presentSoftwareKeyStoreVars(env),
  };
}
