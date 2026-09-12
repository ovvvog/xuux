/**
 * عقدُ مُوائمِ الاستدلالِ — سدادُ الدَينِ `D-11` (الشطرُ الأوّلُ: العقدُ).
 *
 * **العيبُ الذي يُغلقه هذا الملفُّ:** `src/inference/inference-gate.mjs` بوابةٌ
 * محكمةٌ تحكُمُ **عدَماً**: `execute` دالّةٌ تُحقَنُ من الخارجِ بلا عقدٍ، فما
 * تُعيدُه يُقبَلُ كما هو ويُقيَّدُ في السجلِّ ويُحاسَبُ عليه. فمن حقَنَ مُنفِّذاً
 * حقَنَ معه ما شاءَ: مُخرَجاً غيرَ نصٍّ، واستهلاكاً يُصغِّرُ نفسَه فلا يُخصَمُ من
 * الميزانيّةِ، ونموذجاً غيرَ الذي وجَّهَ إليه السجلُّ، وقراراً يدّعيه المُنفِّذُ
 * لنفسِه فيُقرأُ كأنّه قرارُ نقطةِ التفويضِ. **وثغرةُ `execute` ليست غيابَ
 * مزوّدٍ، بل غيابَ عقدٍ يُحاكَمُ إليه ما يعودُ منه.**
 *
 * وهذا الملفُّ يُعلنُ العقدَ وحدَه: **إعلانُ** المُوائمِ يُفحَصُ قبلَ استعمالِه،
 * و**ناتجُه** يُفحَصُ قبلَ تسليمِه إلى البوابةِ، وما بينَهما مُهلةٌ مُعلَنةٌ لا
 * انتظارَ بلا حدٍّ.
 *
 * **أربعةُ حدودٍ لا تُخفَّفُ:**
 *   1. **لا سلطةَ في المُوائمِ.** المُوائمُ مِحبرةٌ لا فاعلٌ: لا يُفوِّضُ ولا
 *      يُقيِّدُ ولا يقرأُ قاعدةً. وناتجٌ يحمِلُ حقلَ قرارٍ (`policyId` أو
 *      `decision` أو `allowed` أو `token`) **يُرفَضُ**، لأنّ قراراً يدّعيه
 *      المُنادى عليه ليس قراراً بل انتحالٌ لصفةِ العقبةِ.
 *   2. **لا سرَّ في الشفرةِ ولا في الإعلانِ.** الإعلانُ يحمِلُ **اسمَ** متغيّرِ
 *      البيئةِ (`apiKeyEnv`) لا قيمتَه، على نفسِ اصطلاحِ `DATABASE_CA_FILE`
 *      و`STATE_TLS_CA_FILE`. وقيمةٌ تُشبِهُ مفتاحاً في الإعلانِ تُرفَضُ.
 *   3. **لا شبكةَ إلا بإعلانٍ.** `network` مُعلَنٌ في الإعلانِ، و`in-process`
 *      يُلزَمُ بـ`disabled` — فمُوائمٌ داخليٌّ يفتحُ مِقبساً مُوائمٌ يكذبُ إعلانَه.
 *   4. **لا استهلاكَ مجهولٌ.** أرقامُ الاستهلاكِ أعدادٌ صحيحةٌ غيرُ سالبةٍ، فمن
 *      أعادَ كسراً أو سالباً أو `NaN` أعادَ رقماً **يُفسِدُ الخصمَ من الميزانيّةِ**،
 *      وميزانيّةٌ تُخصَمُ برقمٍ فاسدٍ سقفٌ لا يُقاسُ عليه.
 *
 * **وحدٌّ مُعلَنٌ صريحٌ:** هذا العقدُ يفحصُ **شكلَ** ما يعودُ لا **صحّتَه**: لا
 * يعرفُ أنّ المُخرَجَ صادقٌ ولا أنّ الاستهلاكَ المُعلَنَ هو ما استُهلِكَ عندَ
 * المزوّدِ فعلاً. وقياسُ الاستهلاكِ عندَ المزوّدِ يحتاجُ مُطابقةً بفاتورتِه، وهي
 * **ليست في هذه الدفعةِ** ولا تُدّعى.
 */

/** رموزُ الرفضِ: الرمزُ للبرامجِ والرسالةُ العربيّةُ لقرارِ الرفضِ المقروءِ. */
export const ADAPTER_ERRORS = Object.freeze({
  DECLARATION_INVALID: 'INFERENCE_ADAPTER_DECLARATION_INVALID',
  AUTHORITY_CLAIMED: 'INFERENCE_ADAPTER_AUTHORITY_CLAIMED',
  SECRET_INLINE: 'INFERENCE_ADAPTER_SECRET_INLINE',
  NETWORK_UNDECLARED: 'INFERENCE_ADAPTER_NETWORK_UNDECLARED',
  INVOKE_MISSING: 'INFERENCE_ADAPTER_INVOKE_MISSING',
  RESULT_INVALID: 'INFERENCE_ADAPTER_RESULT_INVALID',
  USAGE_INVALID: 'INFERENCE_ADAPTER_USAGE_INVALID',
  MODEL_MISMATCH: 'INFERENCE_ADAPTER_MODEL_MISMATCH',
  TIMED_OUT: 'INFERENCE_ADAPTER_TIMED_OUT',
  // ── رموزُ نقلِ الشبكةِ: تُستعملُ في مُوائمِ `https` وحدَه، ومكانُها هنا لأنّ
  //    رمزَ الرفضِ عقدٌ يُقرأُ من خارجِ الوحدةِ، ورمزٌ يُعلَنُ في كلِّ مُوائمٍ
  //    وحدَه يصيرُ رمزينِ لعَيبٍ واحدٍ.
  KEY_ABSENT: 'INFERENCE_ADAPTER_KEY_ABSENT',
  ENDPOINT_INSECURE: 'INFERENCE_ADAPTER_ENDPOINT_INSECURE',
  PROVIDER_REFUSED: 'INFERENCE_ADAPTER_PROVIDER_REFUSED',
  TRANSPORT_FAILED: 'INFERENCE_ADAPTER_TRANSPORT_FAILED',
  RESPONSE_UNREADABLE: 'INFERENCE_ADAPTER_RESPONSE_UNREADABLE',
  RESPONSE_TOO_LARGE: 'INFERENCE_ADAPTER_RESPONSE_TOO_LARGE',
});

/** خطأٌ مسمّىً لعقدِ المُوائمِ. */
export class InferenceAdapterError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   * @param {Record<string, unknown>} [detail]
   */
  constructor(code, message, detail = {}) {
    super(message);
    this.name = 'InferenceAdapterError';
    /** @type {string} */
    this.code = code;
    /** @type {Record<string, unknown>} */
    this.detail = detail;
  }
}

/** أنماطُ النقلِ المُعلَنةُ؛ ما ليس فيها لا يُشغَّلُ. */
export const ADAPTER_TRANSPORTS = Object.freeze(['in-process', 'https']);

/** حالاتُ الشبكةِ المُعلَنةُ. */
export const ADAPTER_NETWORK_STATES = Object.freeze(['disabled', 'https-only']);

/**
 * حقولُ القرارِ التي **لا يجوزُ** أن تعودَ من مُوائمٍ: كلُّها من صلاحيّةِ نقطةِ
 * التفويضِ والسجلِّ، لا من صلاحيّةِ المُنادى عليه.
 */
export const FORBIDDEN_RESULT_FIELDS = Object.freeze([
  'policyId',
  'decision',
  'allowed',
  'authorized',
  'token',
  'ticket',
  'actor',
]);

/** أقصى مُهلةٍ مُعلَنةٍ لنداءِ مُوائمٍ؛ ما فوقَها انتظارٌ لا مُهلةٌ. */
export const MAX_ADAPTER_TIMEOUT_MS = 120_000;

const SECRET_LOOKING = /^(sk-|pk-|Bearer\s|xoxb-|ghp_|AIza)/i;
const ENV_NAME = /^[A-Z][A-Z0-9_]{2,63}$/;

/**
 * هل تُشبِهُ القيمةُ مفتاحاً؟ **مُصدَّرةٌ لا مخفيّةٌ**: مُوائمُ الشبكةِ يفحصُ بها
 * ترويساتَه وحقولَه الثابتةَ بنفسِ المقياسِ الذي يفحصُ به العقدُ الإعلانَ، ولو
 * كرَّرَ كلُّ مُوائمٍ نمطَه لصارَ للسرِّ مقياسانِ يفترقانِ عندَ أوّلِ تعديلٍ.
 *
 * @param {string} value
 * @returns {boolean}
 */
export function looksLikeSecret(value) {
  return SECRET_LOOKING.test(value);
}

/**
 * اسمُ متغيّرِ بيئةٍ لا قيمتُه — نفسُ مقياسِ `apiKeyEnv` في هذا العقدِ.
 *
 * @param {string} value
 * @returns {boolean}
 */
export function isEnvName(value) {
  return ENV_NAME.test(value);
}

/**
 * @param {string} code
 * @param {string} message
 * @param {Record<string, unknown>} [detail]
 * @returns {never}
 */
function refuse(code, message, detail = {}) {
  throw new InferenceAdapterError(code, message, detail);
}

/**
 * @param {unknown} value
 * @returns {boolean}
 */
function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== '';
}

/**
 * @typedef {object} AdapterDeclaration
 * @property {string} id معرّفُ المُوائمِ كما يُقيَّدُ في السجلِّ
 * @property {string} provider جهةُ التنفيذِ كما تُعلَنُ في سجلِّ النماذجِ
 * @property {'in-process' | 'https'} transport
 * @property {'disabled' | 'https-only'} network
 * @property {string | null} apiKeyEnv **اسمُ** متغيّرِ البيئةِ لا قيمتُه
 * @property {number} timeoutMs
 */

/**
 * فحصُ إعلانِ المُوائمِ قبلَ استعمالِه. **والإعلانُ يُفحَصُ لا يُصدَّقُ**: مُوائمٌ
 * يُعلنُ ما لا يُطابِقُ ما يفعلُه يُكشَفُ بحاجزِ `scripts/guard-inference.mjs`،
 * وهذا الفحصُ يمنعُ الإعلانَ المُتناقِضَ مع نفسِه من الأصلِ.
 *
 * @param {unknown} candidate
 * @returns {AdapterDeclaration}
 */
export function assertAdapterDeclaration(candidate) {
  if (candidate === null || typeof candidate !== 'object') {
    refuse(
      ADAPTER_ERRORS.DECLARATION_INVALID,
      'إعلانُ المُوائمِ ليس كائناً؛ ومُوائمٌ بلا إعلانٍ مُنفِّذٌ مجهولُ النقلِ والشبكةِ والمُهلةِ.',
    );
  }
  const declaration = /** @type {Record<string, unknown>} */ (candidate);
  for (const field of ['id', 'provider']) {
    if (!isNonEmptyString(declaration[field])) {
      refuse(
        ADAPTER_ERRORS.DECLARATION_INVALID,
        `إعلانُ المُوائمِ ينقصُه الحقلُ «${field}»؛ وقيدٌ في السجلِّ بلا معرّفِ مُنفِّذٍ وجهتِه قيدٌ لا يُعرَفُ منه من نفَّذَ.`,
        { field },
      );
    }
  }
  const transport = declaration['transport'];
  if (typeof transport !== 'string' || !ADAPTER_TRANSPORTS.includes(transport)) {
    refuse(
      ADAPTER_ERRORS.DECLARATION_INVALID,
      `نقلُ المُوائمِ «${String(transport)}» غيرُ مُعلَنٍ؛ والمُعلَنُ: ${ADAPTER_TRANSPORTS.join('، ')}.`,
      { transport: String(transport) },
    );
  }
  const network = declaration['network'];
  if (typeof network !== 'string' || !ADAPTER_NETWORK_STATES.includes(network)) {
    refuse(
      ADAPTER_ERRORS.NETWORK_UNDECLARED,
      `حالةُ شبكةِ المُوائمِ «${String(network)}» غيرُ مُعلَنةٍ؛ والمُعلَنُ: ${ADAPTER_NETWORK_STATES.join('، ')}.`,
      { network: String(network) },
    );
  }
  if (transport === 'in-process' && network !== 'disabled') {
    refuse(
      ADAPTER_ERRORS.NETWORK_UNDECLARED,
      'مُوائمٌ داخليُّ التنفيذِ يُعلنُ شبكةً؛ وإعلانٌ يُخالِفُ نقلَه إعلانٌ لا يُحتَجُّ به.',
      { transport, network },
    );
  }
  if (transport === 'https' && network !== 'https-only') {
    refuse(
      ADAPTER_ERRORS.NETWORK_UNDECLARED,
      'مُوائمُ الشبكةِ يجبُ أن يُعلنَ `https-only`؛ فلا نقلَ بلا تعميةٍ إلى مزوّدٍ خارجيٍّ.',
      { transport, network },
    );
  }
  const apiKeyEnv = declaration['apiKeyEnv'] ?? null;
  if (apiKeyEnv !== null) {
    if (typeof apiKeyEnv !== 'string' || !ENV_NAME.test(apiKeyEnv)) {
      refuse(
        ADAPTER_ERRORS.SECRET_INLINE,
        `«apiKeyEnv» يجبُ أن يكونَ **اسمَ** متغيّرِ بيئةٍ بحروفٍ كبيرةٍ لا قيمةً؛ وما وردَ لا يُشبِهُ اسماً: ${typeof apiKeyEnv === 'string' ? `طولُه ${apiKeyEnv.length}` : typeof apiKeyEnv}.`,
        { field: 'apiKeyEnv' },
      );
    }
    if (SECRET_LOOKING.test(apiKeyEnv)) {
      refuse(
        ADAPTER_ERRORS.SECRET_INLINE,
        '«apiKeyEnv» يحمِلُ قيمةً تُشبِهُ مفتاحاً لا اسمَ متغيّرٍ؛ والسرُّ في إعلانٍ سرٌّ في المستودعِ.',
        { field: 'apiKeyEnv' },
      );
    }
  }
  for (const [key, value] of Object.entries(declaration)) {
    if (typeof value !== 'string') continue;
    if (SECRET_LOOKING.test(value)) {
      refuse(
        ADAPTER_ERRORS.SECRET_INLINE,
        `الحقلُ «${key}» في إعلانِ المُوائمِ يحمِلُ قيمةً تُشبِهُ مفتاحاً؛ والمفاتيحُ من البيئةِ وحدَها.`,
        { field: key },
      );
    }
  }
  const timeoutMs = declaration['timeoutMs'];
  if (
    typeof timeoutMs !== 'number' ||
    !Number.isInteger(timeoutMs) ||
    timeoutMs <= 0 ||
    timeoutMs > MAX_ADAPTER_TIMEOUT_MS
  ) {
    refuse(
      ADAPTER_ERRORS.DECLARATION_INVALID,
      `مُهلةُ المُوائمِ «${String(timeoutMs)}» غيرُ مقبولةٍ؛ عددٌ صحيحٌ موجبٌ لا يتجاوزُ ${MAX_ADAPTER_TIMEOUT_MS} — ونداءٌ بلا مُهلةٍ يُعلِّقُ الطلبَ فيصيرُ حجبَ خدمةٍ بلا مُهاجمٍ.`,
      { timeoutMs: String(timeoutMs) },
    );
  }
  return Object.freeze({
    id: /** @type {string} */ (declaration['id']),
    provider: /** @type {string} */ (declaration['provider']),
    transport: /** @type {'in-process' | 'https'} */ (transport),
    network: /** @type {'disabled' | 'https-only'} */ (network),
    apiKeyEnv: /** @type {string | null} */ (apiKeyEnv),
    timeoutMs,
  });
}

/**
 * @param {unknown} value
 * @param {string} field
 * @returns {number | undefined}
 */
function usageNumber(value, field) {
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    refuse(
      ADAPTER_ERRORS.USAGE_INVALID,
      `استهلاكُ المُوائمِ في «${field}» ليس عدداً صحيحاً غيرَ سالبٍ؛ ورقمٌ فاسدٌ يُخصَمُ منه سقفٌ لا يُقاسُ عليه.`,
      { field, value: String(value) },
    );
  }
  return value;
}

/**
 * فحصُ ناتجِ المُوائمِ قبلَ تسليمِه إلى البوابةِ. يُعادُ **كائنٌ جديدٌ** بحقولِ
 * العقدِ وحدَها، فما زادَه المُوائمُ لا يمرُّ إلى السجلِّ ولو كان بريئاً — إذ
 * حقلٌ يمرُّ اليومَ بلا معنىً يُقرأُ غداً كأنّ له معنىً.
 *
 * @param {unknown} candidate
 * @param {{ model: { id: string }, adapterId: string }} expectation
 * @returns {{ output: string, usage: { inputTokens?: number, outputTokens?: number, totalTokens?: number, cost?: number }, modelId: string, adapterId: string }}
 */
export function assertAdapterResult(candidate, expectation) {
  if (candidate === null || typeof candidate !== 'object') {
    refuse(
      ADAPTER_ERRORS.RESULT_INVALID,
      'ناتجُ المُوائمِ ليس كائناً؛ ولا يُسلَّمُ إلى البوابةِ ما لا يُقرأُ منه مُخرَجٌ واستهلاكٌ.',
    );
  }
  const result = /** @type {Record<string, unknown>} */ (candidate);
  for (const field of FORBIDDEN_RESULT_FIELDS) {
    if (field in result) {
      refuse(
        ADAPTER_ERRORS.AUTHORITY_CLAIMED,
        `ناتجُ المُوائمِ يحمِلُ حقلَ سلطةٍ «${field}»؛ والقرارُ من نقطةِ التفويضِ وحدَها، ومُوائمٌ يدّعي قراراً يُرفَضُ ولا يُهمَلُ حقلُه.`,
        { field, adapterId: expectation.adapterId },
      );
    }
  }
  if (typeof result['output'] !== 'string') {
    refuse(
      ADAPTER_ERRORS.RESULT_INVALID,
      'مُخرَجُ المُوائمِ ليس نصّاً؛ ولا يُحوَّلُ مجهولٌ إلى نصٍّ فيَخفى معناه في السجلِّ.',
      { adapterId: expectation.adapterId },
    );
  }
  const modelId = result['modelId'];
  if (modelId !== undefined && modelId !== expectation.model.id) {
    refuse(
      ADAPTER_ERRORS.MODEL_MISMATCH,
      `المُوائمُ نفَّذَ على النموذجِ «${String(modelId)}» والسجلُّ وجَّهَ إلى «${expectation.model.id}»؛ ونموذجٌ غيرُ الذي وجَّهَ إليه السجلُّ طريقٌ خفيٌّ لا بديلٌ.`,
      { expected: expectation.model.id, actual: String(modelId) },
    );
  }
  const rawUsage = result['usage'];
  if (rawUsage !== undefined && (rawUsage === null || typeof rawUsage !== 'object')) {
    refuse(
      ADAPTER_ERRORS.USAGE_INVALID,
      'استهلاكُ المُوائمِ ليس كائناً؛ وغيابُ الاستهلاكِ يُعامَلُ بالتقديرِ، أمّا استهلاكٌ مُشوَّهٌ فيُرفَضُ.',
      { adapterId: expectation.adapterId },
    );
  }
  const usageRecord = /** @type {Record<string, unknown>} */ (rawUsage ?? {});
  const inputTokens = usageNumber(usageRecord['inputTokens'], 'inputTokens');
  const outputTokens = usageNumber(usageRecord['outputTokens'], 'outputTokens');
  const totalTokens = usageNumber(usageRecord['totalTokens'], 'totalTokens');
  const cost = usageNumber(usageRecord['cost'], 'cost');
  /** @type {{ inputTokens?: number, outputTokens?: number, totalTokens?: number, cost?: number }} */
  const usage = {
    ...(inputTokens === undefined ? {} : { inputTokens }),
    ...(outputTokens === undefined ? {} : { outputTokens }),
    ...(totalTokens === undefined ? {} : { totalTokens }),
    ...(cost === undefined ? {} : { cost }),
  };
  return Object.freeze({
    output: /** @type {string} */ (result['output']),
    usage: Object.freeze(usage),
    modelId: expectation.model.id,
    adapterId: expectation.adapterId,
  });
}

/**
 * @typedef {object} InferenceAdapter
 * @property {AdapterDeclaration} declaration
 * @property {(call: { model: { id: string, purpose: string }, purpose: string, input: string, signal: AbortSignal }) => Promise<unknown>} invoke
 */

/**
 * يُحوِّلُ مُوائماً إلى `execute` تقبلُه بوابةُ الاستدلالِ: يفحصُ الإعلانَ مرّةً،
 * ثمَّ يَنادي بمُهلةٍ مُعلَنةٍ، ثمَّ يفحصُ الناتجَ. **والمُهلةُ تُلغي النداءَ
 * بإشارةِ إجهاضٍ** لا تُهمِلُه وتُعيدُ خطأً بينما هو ماضٍ في استهلاكِ الحصّةِ.
 *
 * @param {InferenceAdapter} adapter
 * @returns {(call: { model: { id: string, purpose: string }, purpose: string, input: string }) => Promise<{ output: string, usage: { inputTokens?: number, outputTokens?: number, totalTokens?: number, cost?: number } }>}
 */
export function executorFor(adapter) {
  if (adapter === null || typeof adapter !== 'object' || typeof adapter.invoke !== 'function') {
    refuse(
      ADAPTER_ERRORS.INVOKE_MISSING,
      'المُوائمُ بلا دالّةِ `invoke`؛ وبوابةٌ تُسنَدُ إلى مُنفِّذٍ لا يُنادى بوابةٌ تحكُمُ عدَماً — وهذا هو الدَينُ `D-11` نفسُه.',
    );
  }
  const declaration = assertAdapterDeclaration(adapter.declaration);
  return async function execute({ model, purpose, input }) {
    const controller = new AbortController();
    /** @type {NodeJS.Timeout | undefined} */
    let timer;
    const timeout = new Promise((_resolve, reject) => {
      timer = setTimeout(() => {
        // والرفضُ قبلَ الإجهاضِ مقصودٌ: لو أُجهِضَ أوّلاً لرَفَضَ المُنفِّذُ
        // بخطأِ نفسِه فَسبَقَ في المُسابقةِ، فيُقرَأُ تجاوُزُ المُهلةِ فشلَ مُنفِّذٍ
        // مُبهَماً لا مُهلةً مُعلَنةً انقضت، ورمزٌ مُبهَمٌ لا يُعرَفُ منه أينَ العَيبُ.
        reject(
          new InferenceAdapterError(
            ADAPTER_ERRORS.TIMED_OUT,
            `المُوائمُ «${declaration.id}» تجاوزَ مُهلتَه ${declaration.timeoutMs} مللي ثانيةٍ فأُجهِضَ النداءُ؛ ونداءٌ لا يُجهَضُ يُعلِّقُ الطلبَ ويستهلكُ حصّتَه بلا مُخرَجٍ.`,
            { adapterId: declaration.id, timeoutMs: declaration.timeoutMs },
          ),
        );
        controller.abort();
      }, declaration.timeoutMs);
      // ولا يُنزَعُ مرجعُ المُؤقِّتِ من حلقةِ الحوادثِ (`unref`): مُهلةٌ لا تُبقي
      // الحلقةَ حيّةً مُهلةٌ قد لا تحينُ أصلاً إن كان النداءُ آخرَ ما يُنتظَرُ،
      // فيبقى الطلبُ مُعلَّقاً بلا قرارٍ. والمُؤقِّتُ يُبطَلُ في `finally` دائماً.
    });
    try {
      const raw = await Promise.race([
        adapter.invoke({ model, purpose, input, signal: controller.signal }),
        timeout,
      ]);
      const checked = assertAdapterResult(raw, { model, adapterId: declaration.id });
      return { output: checked.output, usage: checked.usage };
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  };
}
