// جذرُ الثقة — ربطُ مرجعِ الحداثةِ على NV داخلَ متنِ البيانِ المختومِ (WL-434).
//
// **ما هذا الملفُّ:** عقدُ الربطِ المثبَّتِ لمرجعِ الحداثةِ على فهارسِ NV، كما يُختمُ
// في متنِ بيانِ جذرِ الحالةِ الموقَّعِ بمفتاحِ الملكِ داخلَ HSM — تنفيذُ الخيارِ (أ)
// من §5.1 في الملحقِ ج لـADR 0007 («حقلٌ في متنِ البيانِ المختومِ … يُكتَبُ مرّةً
// عندَ الربطِ الأوّلِ ولا يتغيّرُ»). قبلَ WL-434 كانَ الربطُ ملفًّا جانبيًّا في المحاكاةِ
// وحدَها (`sim/freshness-nv/pinned-binding.mjs`)؛ هنا يصيرُ حقلًا في المتنِ الموقَّعِ
// نفسِه، فلا مصدرَ حقيقةٍ ثانيًا إلى جانبِ البيان.
//
// **تغطيةُ الختمِ (قياسٌ لا ادّعاءٌ):** `ManifestSealer.signAsync` يوقّعُ
// `JSON.stringify(payload)` كاملًا، والحقولُ المتداخّلةُ تدخلُ في المتنِ الموقَّعِ،
// فأيُّ تحريرٍ للربطِ بعدَ الختمِ يُسقِطُ التوقيعَ (`STATE_MANIFEST_SEAL_INVALID`).
// والاختبارُ `wl-434-fnv-manifest-binding` يقيسُ ذلك على مسارِ الإنتاجِ الحقيقيّ.
//
// **سياسةُ إصدارِ المخطّطِ والتوافقِ (بلا ترقيةٍ صامتةٍ):**
//   - `version: 2` (التاريخيُّ): بلا ربطٍ. يبقى مقبولًا كما هو، ولا يُرقّيه `openAsync`
//     ولا `checkpointAsync` ولا أيُّ تحديثٍ عاديّ. وربطٌ مهرَّبٌ في متنه ⇒ رفضٌ
//     (`STATE_MANIFEST_FNV_BINDING_INVALID`) — لا يُقبَلُ حقلُ حمايةٍ بلا إعلانِ الوضعِ.
//   - `version: 3` (وضعُ NV): الربطُ **إلزاميُّ**؛ غيابُه رفضٌ لا دعوةٌ لإنشائه.
//     القارئُ القديمُ (الذي لا يعرفُ إلا 2) يرفضُه بـ`STATE_MANIFEST_VERSION_UNSUPPORTED`
//     بدلَ قبولِه معَ تجاهلِ الحمايةِ الجديدة.
//   - الانتقالُ 2→3 لا يقعُ إلا عبرَ مراسمِ الربطِ المعلنةِ (`bindFnvAsync`)، ولا
//     رجوعَ بعدها: `version` و`freshnessBinding` ثابتانِ عبرَ كلِّ ختمٍ لاحقٍ.
//
// **حدٌّ مصرَّحٌ به (لا يُدَّعى خلافُه):** `tpmIdentity` و`authPolicy` جزءٌ من عقدِ
// الربطِ ومصدرُهما المرجعُ نفسُه (اسمُ مفتاحِ EK أو شهادتُه، وسياسةُ كلِّ فهرسٍ كما
// تُقرَأُ من منطقتهِ العامة). **لا backend إنتاجيًّا يوفّرُهما اليوم** (`SUPPORTED_FRESHNESS_BACKENDS`
// فارغ)، فلا يُنشَأُ ربطٌ إنتاجيٌّ إلا بمرجعٍ حقيقيٍّ يوفرُهما، والاختباراتُ تُحْقِنُ
// مادّةً معلَنةً بلا ادّعاءِ هويةِ عتاد. وصحةُ الشكلِ ليست إثباتًا لهويةِ TPM.
// **ويُرفضُ الربطُ الناقصُ**: غيابُ الهويةِ أو السياسةِ أو خللُ شكلِهما ⇒
// `STATE_MANIFEST_FNV_BINDING_INVALID`.

import type { StateManifestBody } from './state-manifest.mjs';

/**
 * إصدارُ مخططِ البيانِ الذي يحملُ ربطَ NV — يميّزُه القارئُ فيفرضُ الربطَ.
 * القارئُ القديمُ يرفضُه بـ`STATE_MANIFEST_VERSION_UNSUPPORTED` فلا يُقبَلُ بيانُ NV
 * معَ تجاهلِ حمايتِه.
 */
export const FNV_MANIFEST_SCHEMA_VERSION = 3;

/** بادئةُ المجالِ في بايتاتِ التحقّقِ من تماسكِ الربطِ — تمنعُ خلطَ الغرض. */
export const FNV_BINDING_SCHEMA = 'xuux.manifest-fnv-binding/1';

/**
 * رموزُ أخطاءِ ربطِ NV المسمّاةُ — قائمةٌ مغلقةٌ تصلُ إلى قرارِ الإقلاعِ كما هي
 * (`decideStateBoundBoot`) فلا يبقى «ربطٌ مكسورٌ» متعذّرَ التمييزِ من «مصدرٍ لا يجيب».
 * تفصيلُ الرسائلِ ثابتٌ نصًّا: لا `error.message` ولا محتوىُ استثناءٍ حسّاسٍ يُمرَّر.
 */
export const FnvBindingErrorCodes = [
  'FRESHNESS_NV_BINDING_INVALID',
  'FRESHNESS_NV_BINDING_MISMATCH',
] as const;

export type FnvBindingErrorCode = (typeof FnvBindingErrorCodes)[number];

/** شكلُ هويةِ TPM — مصدرُها المرجعُ (اسمُ مفتاحِ EK أو تجزئةُ شهادتِه) لا القارئ. */
export interface TpmIdentitySource {
  kind: 'ek-name' | 'ek-certificate-sha256';
  /** قيمةٌ سداسيةٌ عشريةٌ غيرُ فارغةٍ كما قرأها المصدرُ (بلا تفسيرٍ هنا). */
  value: string;
}

/**
 * مادّةُ الربطِ كما يوفّرُها مصدرُ NV عندَ المراسمِ المعلنةِ — لا يخترعُها المنفّذ.
 * `authPolicy` لكلِّ فهرسٍ على حدةٍ (قد تختلفانِ، وقد تكونانِ فارغتينِ: «لا سياسة»
 * أمرٌ يُثبَّتُ كما هو؛ لا يُفترضُ أنّهما غيرُ فارغتينِ ولا متطابقتين).
 */
export interface FnvBindingMaterial {
  /** مقبضُ فهرسِ العدّادِ `C` — `0x` + ثمانيةٌ سداسيةٌ عشريةٌ. */
  counterIndex: string;
  /** مقبضُ فهرسِ السجلِّ `R`. */
  recordIndex: string;
  /** اسمُ NV للعدّادِ من `TPM2_NV_ReadPublic` — `000b` + 64 سداسيةً. */
  counterName: string;
  /** اسمُ NV للسجلِّ. */
  recordName: string;
  /** قيمةُ `C` عندَ الربطِ — سلسلةٌ عشريةٌ عشرية (BigInt خارجَ JSON). */
  base: string;
  tpmIdentity: TpmIdentitySource;
  authPolicy: { counter: string; record: string };
}

/**
 * الربطُ كما يُختمُ في متنِ البيانِ — امتدادُ المادّةِ بـ`instanceId` الذي يربطُه
 * بنسخةِ جذرِ الثقةِ التي خُتمَ فيها، فلا يُنقَلُ بيانٌ إلى نشرٍ أو جهازٍ آخرَ.
 */
export interface ManifestFnvBinding extends FnvBindingMaterial {
  schema: typeof FNV_BINDING_SCHEMA;
  instanceId: string;
}

const HANDLE = /^0x[0-9a-f]{8}$/;
const NV_NAME = /^000b[0-9a-f]{64}$/;
const DECIMAL = /^(0|[1-9][0-9]*)$/;
const POLICY_DIGEST = /^([0-9a-f]{2})*$/;
const IDENTITY_VALUE = /^[0-9a-f]{8,1024}$/;
const IDENTITY_KINDS = new Set(['ek-name', 'ek-certificate-sha256']);

/**
 * يتحقّقُ من شكلِ المادّةِ — قائمةٌ مغلقةٌ من الفحوصِ، لا سرٌّ في تفصيلِها.
 * @param material - المادّةُ المفحوصة
 * @returns سببُ الرفضِ أو `null` إن صحّ الشكلُ
 */
export function fnvBindingMaterialShapeError(material: unknown): string | null {
  const m = material as Partial<FnvBindingMaterial> | null;
  if (m === null || typeof m !== 'object') return 'not an object';
  if (!HANDLE.test(String(m.counterIndex ?? ''))) return 'counterIndex';
  if (!HANDLE.test(String(m.recordIndex ?? ''))) return 'recordIndex';
  if (m.counterIndex === m.recordIndex) return 'C == R';
  if (!NV_NAME.test(String(m.counterName ?? ''))) return 'counterName';
  if (!NV_NAME.test(String(m.recordName ?? ''))) return 'recordName';
  if (typeof m.base !== 'string' || !DECIMAL.test(m.base)) return 'base';
  const identity = m.tpmIdentity as Partial<TpmIdentitySource> | undefined;
  if (identity === undefined || identity === null || typeof identity !== 'object')
    return 'tpmIdentity';
  if (typeof identity.kind !== 'string' || !IDENTITY_KINDS.has(identity.kind))
    return 'tpmIdentity.kind';
  if (typeof identity.value !== 'string' || !IDENTITY_VALUE.test(identity.value))
    return 'tpmIdentity.value';
  const policy = m.authPolicy as Partial<{ counter: unknown; record: unknown }> | undefined;
  if (policy === undefined || policy === null || typeof policy !== 'object') return 'authPolicy';
  if (typeof policy.counter !== 'string' || !POLICY_DIGEST.test(policy.counter))
    return 'authPolicy.counter';
  if (typeof policy.record !== 'string' || !POLICY_DIGEST.test(policy.record))
    return 'authPolicy.record';
  return null;
}

/**
 * يتحقّقُ من شكلِ الربطِ المختومِ في المتنِ — المادّةُ و`instanceId` معًا.
 * @param binding - الربطُ كما قُرئ من المتن
 * @returns سببُ الرفضِ أو `null`
 */
export function manifestFnvBindingShapeError(binding: unknown): string | null {
  const b = binding as Partial<ManifestFnvBinding> | null;
  if (b === null || typeof b !== 'object') return 'not an object';
  if (b.schema !== FNV_BINDING_SCHEMA) return 'schema';
  const material: FnvBindingMaterial = {
    counterIndex: String(b.counterIndex ?? ''),
    recordIndex: String(b.recordIndex ?? ''),
    counterName: String(b.counterName ?? ''),
    recordName: String(b.recordName ?? ''),
    base: String(b.base ?? ''),
    tpmIdentity: b.tpmIdentity as TpmIdentitySource,
    authPolicy: b.authPolicy as { counter: string; record: string },
  };
  const materialError = fnvBindingMaterialShapeError(material);
  if (materialError !== null) return materialError;
  if (typeof b.instanceId !== 'string' || b.instanceId.length === 0) return 'instanceId';
  return null;
}

/**
 * بايتاتُ التماسكِ للربطِ داخلَ المتنِ — ترتيبُ حقولٍ ثابتٌ وسابقةُ مجالٍ تمنعُ
 * استعمالَ القيمةِ لغرضٍ آخرَ. تُستعملُ في مقارنةِ الثباتِ (لا في توقيعٍ مستقلٍّ:
 * الختمُ الكاملُ للمتنِ هو ما يحمي الربط).
 * @param binding - الربطُ المختومُ في المتن
 */
export function manifestFnvBindingBytes(binding: ManifestFnvBinding): Buffer {
  return Buffer.from(
    JSON.stringify([
      FNV_BINDING_SCHEMA,
      binding.instanceId,
      binding.counterIndex,
      binding.recordIndex,
      binding.counterName,
      binding.recordName,
      binding.base,
      binding.tpmIdentity.kind,
      binding.tpmIdentity.value,
      binding.authPolicy.counter,
      binding.authPolicy.record,
    ]),
    'utf8',
  );
}

/**
 * مقارنةُ ثباتٍ للربطِ — مقارنةُ بايتاتٍ لا مراجعَ: كائنانِ يشتركانِ في المرجعِ
 * متساويانِ دائمًا، فالمقارنةُ بالقيمةِ هي وحدها دليلُ الثبات.
 * @param previous - الربطُ كما كانَ قبلَ التحديث
 * @param next - الربطُ كما صارَ بعده
 * @returns هل هما القيمةُ نفسُها بايتًا ببايت
 */
export function manifestFnvBindingEqual(previous: unknown, next: unknown): boolean {
  if (previous === next) return true;
  const a = previous as Partial<ManifestFnvBinding> | null;
  const b = next as Partial<ManifestFnvBinding> | null;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;
  return manifestFnvBindingBytes(a as ManifestFnvBinding).equals(
    manifestFnvBindingBytes(b as ManifestFnvBinding),
  );
}

/**
 * الحقولُ المشتركةُ بينَ ربطِ البيانِ وربطِ المصدرِ — ما يجبَ أن يتفقَ عليهِ
 * المصدرُ والبيانُ وإلّا فالإقلاعُ يرفض. الهويةُ والسياسةُ تُقارَنانِ أيضًا متى
 * وضعهما المصدرُ (ملفُّ WL-433 الجانبيُّ أقدمُ مخطّطًا ولا يحملُهما — حدٌّ معلَنٌ).
 * @param manifestBinding - الربطُ المختومُ في البيان
 * @param sourceBinding - الربطُ الذي يتحققُ منه المصدر
 * @returns أولُ اختلافٍ أو `null` إن اتفقا
 */
export function fnvBindingSourceDiff(
  manifestBinding: ManifestFnvBinding,
  sourceBinding: Record<string, unknown>,
): string | null {
  const pairs: Array<[string, unknown, unknown]> = [
    ['counterIndex', manifestBinding.counterIndex, sourceBinding.counterIndex],
    ['recordIndex', manifestBinding.recordIndex, sourceBinding.recordIndex],
    ['counterName', manifestBinding.counterName, sourceBinding.counterName],
    ['recordName', manifestBinding.recordName, sourceBinding.recordName],
    ['base', manifestBinding.base, sourceBinding.base],
  ];
  const identity = sourceBinding.tpmIdentity as { kind?: unknown; value?: unknown } | undefined;
  if (identity !== undefined && identity !== null && typeof identity === 'object') {
    pairs.push(['tpmIdentity.kind', manifestBinding.tpmIdentity.kind, identity.kind]);
    pairs.push(['tpmIdentity.value', manifestBinding.tpmIdentity.value, identity.value]);
  }
  const policy = sourceBinding.authPolicy as { counter?: unknown; record?: unknown } | undefined;
  if (policy !== undefined && policy !== null && typeof policy === 'object') {
    pairs.push(['authPolicy.counter', manifestBinding.authPolicy.counter, policy.counter]);
    pairs.push(['authPolicy.record', manifestBinding.authPolicy.record, policy.record]);
  }
  for (const [field, manifestValue, sourceValue] of pairs) {
    if (manifestValue !== sourceValue) return field;
  }
  return null;
}

/**
 * يبني الربطَ المختومَ من المادّةِ ونسخةِ الجذرِ — نسخًا عميقًا للمادّةِ كي لا
 * يبقى للمدخِلِ مرجعٌ يعدّلُ به الربطَ بعدَ الختم.
 * @param material - المادّةُ من المصدر
 * @param instanceId - معرّفُ نسخةِ الجذرِ من المتن
 */
export function buildManifestFnvBinding(
  material: FnvBindingMaterial,
  instanceId: string,
): ManifestFnvBinding {
  const shapeError = fnvBindingMaterialShapeError(material);
  if (shapeError !== null) {
    throw new Error(`FNV_BINDING_MATERIAL_INVALID: ${shapeError}`);
  }
  return {
    schema: FNV_BINDING_SCHEMA,
    instanceId,
    counterIndex: material.counterIndex,
    recordIndex: material.recordIndex,
    counterName: material.counterName,
    recordName: material.recordName,
    base: material.base,
    tpmIdentity: { kind: material.tpmIdentity.kind, value: material.tpmIdentity.value },
    authPolicy: { counter: material.authPolicy.counter, record: material.authPolicy.record },
  };
}

/**
 * عقدُ مصدرٍ يكشفُ الربطَ الذي يتحققُ منه — يميّزُ المقبسَ الذي يملكُ ربطًا مثبَّتًا.
 * غيابُ الكشفِ في وضعِ NV ليسِ تخطيًا للفحصِ بل رفضٌ مغلقٌ عندَ الإقلاع.
 */
export interface FnvPinnedBindingSource {
  /** الربطُ المثبَّتُ الذي يتحققُ منه المصدرُ في كلِّ قراءةٍ وانتقال. */
  pinnedBinding(): unknown;
}

/**
 * عقدُ مصدرٍ يوفّرُ مادّةَ الربطِ عندَ المراسمِ المعلنةِ (‏B10) — المصدرُ وحدَه
 * يملكُ المادّةَ (المقبضانِ والاسمانِ و`base` والهويةُ والسياسةُ)؛ المنفّذُ لا
 * يخترعُها ولا يخمّنُها. من لا يكشفُها يبقى على المسارِ التاريخيّ.
 */
export interface FnvBindingMaterialSource {
  /** مادّةُ الربطِ من المرجعِ الحيّ — تُقرأُ مرّةً عندَ الربطِ الأوّلِ المعلن. */
  fnvBindingMaterial(): Promise<FnvBindingMaterial>;
}

/**
 * هل يكشفُ المقبسُ ربطًا مثبَّتًا؟
 * @param socket - المقبسُ المفحوص
 */
export function isFnvPinnedBindingSource(socket: unknown): socket is FnvPinnedBindingSource {
  if (socket === null || typeof socket !== 'object') return false;
  return typeof (socket as Partial<FnvPinnedBindingSource>).pinnedBinding === 'function';
}

/**
 * هل يحملُ البيانُ ربطَ NV؟ — للتمييزِ بينَ المسارِ التاريخيِّ ووضعِ NV عندَ الإقلاع.
 * @param body - متنُ البيان
 */
export function manifestHasFnvBinding(body: StateManifestBody): boolean {
  return body.freshnessBinding !== undefined && body.freshnessBinding !== null;
}
