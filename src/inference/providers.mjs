/**
 * مزوّدو الاستدلالِ كبياناتٍ — سدادُ الدَينِ `D-11` (الشوطُ الثالثُ: الإعلانُ).
 *
 * **العيبُ الذي يُغلقه هذا الملفُّ:** الشوطُ الثاني أعطى الدولةَ مُوائمَ `https`
 * صحيحَ العقدِ، لكنّه أعطاها معه **باباً يُفتَحُ من أيِّ موضعٍ**: من أراد
 * مزوّداً نادى `createHttpsAdapter` بعنوانٍ واسمِ متغيّرِ مفتاحٍ ومساراتِ ردٍّ
 * يكتبُها في شفرتِه. فصارَ سطحُ الثقةِ الخارجيُّ — أيُّ عنوانٍ تُنادى عليه
 * الدولةُ، وأيُّ مفتاحٍ يُقرأُ من بيئتِها — **مبثوثاً في الكودِ لا مقروءاً في
 * وثيقةٍ واحدةٍ تُراجَع**. وسطحُ ثقةٍ لا يُقرأُ في موضعٍ واحدٍ سطحٌ لا يُراجَع،
 * ومزوّدٌ يُضافُ في سطرٍ من شفرةٍ مزوّدٌ يُضافُ بلا مراجعةٍ.
 *
 * **والقاعدةُ: لا مزوّدَ إلا مُعلَناً في `config/inference-providers.yaml`.**
 * وهذه الوحدةُ تقرأُ الوثيقةَ وتتحقّقُ منها بمخطَّطِها ثمَّ بفحوصِ تماسكٍ لا
 * يُعبِّرُ عنها مخطَّطٌ، ثمَّ تبني المُوائمَ **بـ`createHttpsAdapter` وحدَه**: فلا
 * مسارَ ثانٍ إلى الشبكةِ، ولا عقدَ ثانٍ لناتجِ المزوّدِ.
 *
 * **وثلاثةُ حدودٍ لا تُخفَّفُ:**
 *   1. **لا سرَّ في الإعلانِ.** `apiKeyEnv` و`caFileEnv` **أسماءُ** متغيّراتِ
 *      بيئةٍ لا قيمٌ، وقيمةٌ تُشبِهُ مفتاحاً في ترويسةٍ ثابتةٍ أو في حقلِ طلبٍ
 *      ثابتٍ **تُرفَضُ** بـ`SECRET_INLINE` — والمادةُ 7 تمنعُ سرّاً في المستودعِ.
 *   2. **لا افتراضَ عندَ الغيابِ.** وثيقةٌ غائبةٌ أو مخالفةٌ أو مزوّدٌ غيرُ
 *      مُعلَنٍ: رفضٌ باسمِه. ولا يُبتدأُ مُوائمٌ بعنوانٍ افتراضيٍّ، فعنوانٌ
 *      افتراضيٌّ عنوانٌ لم يُقرِّرْه أحدٌ وتُرسَلُ إليه أسرارُ الدولةِ.
 *   3. **لا سلطةَ هنا.** هذه الوحدةُ تقرأُ وثيقةً وتبني مُوائماً؛ لا تُفوِّضُ
 *      ولا تُقيِّدُ في سجلٍّ ولا تخصمُ من ميزانيّةٍ — تلك أفعالُ البوابةِ.
 *
 * **حدٌّ مُعلَنٌ صريحٌ:** ما يُقاسُ هنا **بناءُ المُوائمِ من إعلانِه ورفضُ
 * الإعلانِ الفاسدِ**، لا صحّةُ مساراتِ الردِّ عندَ المزوّدِ الحقيقيِّ: تلك تحتاجُ
 * مفتاحاً حقيقيّاً في البيئةِ ونداءً على الشبكةِ، ومفتاحٌ لا يُوضَعُ في مستودعٍ.
 * ومسارٌ مخالفٌ لا يُقرأُ منه صفرٌ بل يُرَدُّ بـ`RESPONSE_UNREADABLE`.
 *
 * @module inference/providers
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import Ajv2020Default from 'ajv/dist/2020.js';

// وحزمةُ Ajv تُصدِّرُ صنفَها افتراضاً في ESM، فيُقرأُ نوعُه صريحاً وإلا صارَ
// «غيرَ قابلٍ للإنشاءِ» في الفحصِ الصارمِ — كما في وحدةِ التكلفةِ قبلَها.
const Ajv2020 = /** @type {typeof import('ajv/dist/2020.js').Ajv2020} */ (
  /** @type {unknown} */ (Ajv2020Default)
);
import YAML from 'yaml';

import {
  ADAPTER_ERRORS,
  executorFor,
  InferenceAdapterError,
  isEnvName,
  looksLikeSecret,
  MAX_ADAPTER_TIMEOUT_MS,
} from './adapters/contract.mjs';
import { createHttpsAdapter } from './adapters/https.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** مجلَّدُ الوثائقِ الافتراضيُّ لوثيقةِ المزوّدين. */
export const DEFAULT_INFERENCE_CONFIG_DIR = path.resolve(HERE, '..', '..', 'config');

/** اسمُ وثيقةِ المزوّدين كما يُقرأُ في الحاجزِ والاختبارِ بلا تكرارِ نصٍّ. */
export const INFERENCE_PROVIDERS_FILE = 'inference-providers.yaml';

/**
 * @typedef {ReadonlyArray<string | number>} Route
 */

/**
 * @typedef {object} DeclaredProvider
 * @property {string} id
 * @property {string} provider
 * @property {'https'} transport
 * @property {string} endpoint
 * @property {string} apiKeyEnv
 * @property {string} [caFileEnv]
 * @property {string} [authHeader]
 * @property {string} [authScheme]
 * @property {number} [timeoutMs]
 * @property {Record<string, string>} [headers]
 * @property {{ model?: string, input?: string, purpose?: string }} [requestFields]
 * @property {Record<string, unknown>} [requestExtras]
 * @property {Route} outputPath
 * @property {Route} [modelPath]
 * @property {{ inputTokens?: Route, outputTokens?: Route, totalTokens?: Route, cost?: Route }} [usagePaths]
 * @property {string} statement
 */

/**
 * @typedef {object} InferenceProvidersDocument
 * @property {number} version
 * @property {string} owner
 * @property {ReadonlyArray<Readonly<DeclaredProvider>>} providers
 */

/**
 * @param {string} code
 * @param {string} message
 * @param {Record<string, unknown>} [detail]
 * @returns {never}
 */
function refuse(code, message, detail = {}) {
  throw new InferenceAdapterError(code, message, detail);
}

/** @param {unknown} error @returns {string} */
function errorText(error) {
  return error instanceof Error ? error.message : String(error);
}

/** @param {string} message @param {Record<string, unknown>} [detail] @returns {never} */
function invalidDocument(message, detail = {}) {
  refuse(ADAPTER_ERRORS.DECLARATION_INVALID, message, detail);
}

/**
 * يقرأُ وثيقةَ المزوّدينَ ويتحقّقُ منها بمخطَّطِها ثمَّ بفحوصِ تماسكٍ لا
 * يُعبِّرُ عنها مخطَّطٌ: تكرارُ معرّفٍ، وسرٌّ في ترويسةٍ أو حقلِ طلبٍ، ومُهلةٌ
 * فوقَ سقفِ العقدِ. **ووثيقةٌ غائبةٌ أو مخالفةٌ توقفُ التحميلَ** ولا يُبتدأُ
 * سجلُّ مزوّدينَ فارغٌ يُقرأُ «لا مزوّدَ» — فغيابٌ يُقرأُ سماحاً غيابٌ يُخفي عَطَباً.
 *
 * @param {{ dir?: string }} [options]
 * @returns {InferenceProvidersDocument}
 */
export function loadInferenceProviders(options = {}) {
  const dir = options.dir ?? DEFAULT_INFERENCE_CONFIG_DIR;
  const schemaDir = fs.existsSync(path.join(dir, 'schemas')) ? dir : DEFAULT_INFERENCE_CONFIG_DIR;
  const file = path.join(dir, INFERENCE_PROVIDERS_FILE);
  if (!fs.existsSync(file)) {
    invalidDocument(
      `وثيقةُ المزوّدينَ «${INFERENCE_PROVIDERS_FILE}» غائبةٌ؛ ومزوّدٌ يُنادى بلا وثيقةٍ تُعلنُ عنوانَه مزوّدٌ يُضافُ بلا مراجعةٍ.`,
      { file },
    );
  }
  /** @type {unknown} */
  let raw;
  try {
    raw = YAML.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    invalidDocument(`تعذّرت قراءةُ ${INFERENCE_PROVIDERS_FILE}: ${errorText(error)}`, { file });
  }
  const schemaPath = path.join(schemaDir, 'schemas', 'inference-providers.schema.json');
  if (!fs.existsSync(schemaPath)) {
    invalidDocument(
      'مخطَّطُ وثيقةِ المزوّدينَ غائبٌ؛ وبلا مخطَّطٍ يصيرُ إعلانُ العناوينِ والمساراتِ نصّاً حرّاً كالذي جاءَ ليمنعَه.',
      { schemaPath },
    );
  }
  const validate = new Ajv2020({ allErrors: true, strict: false }).compile(
    JSON.parse(fs.readFileSync(schemaPath, 'utf8')),
  );
  if (!validate(raw)) {
    const problems = (validate.errors ?? [])
      .map(
        (/** @type {{ instancePath: string, message?: string }} */ entry) =>
          `${entry.instancePath || '/'}: ${entry.message ?? 'مخالفةٌ'}`,
      )
      .join('؛ ');
    invalidDocument(`وثيقةُ المزوّدينَ تخالفُ مخطَّطَها: ${problems}`, { file });
  }
  const parsed = /** @type {InferenceProvidersDocument} */ (raw);

  /** @type {Set<string>} */
  const seen = new Set();
  for (const provider of parsed.providers) {
    if (seen.has(provider.id)) {
      invalidDocument(
        `المزوّدُ «${provider.id}» مُعلَنٌ مرّتينِ؛ ومعرّفٌ يُشيرُ إلى عنوانينِ عنوانٌ لا يُعرَفُ أيُّهما النافذُ.`,
        { id: provider.id },
      );
    }
    seen.add(provider.id);
    // والسرُّ يُفحَصُ **قبلَ** شكلِ الاسمِ: لو قُدِّمَ فحصُ الشكلِ لَرُدَّتْ قيمةُ
    // المفتاحِ بـ«ليس اسمَ متغيّرٍ» ولَما قِيلَ في السجلِّ إنّ سرّاً كُتِبَ في
    // وثيقةٍ — ورمزُ الرفضِ هو ما يُقرأُ في المراجعةِ لا نصُّه وحدَه.
    if (looksLikeSecret(provider.apiKeyEnv)) {
      refuse(
        ADAPTER_ERRORS.SECRET_INLINE,
        `«apiKeyEnv» في المزوّدِ «${provider.id}» قيمةٌ تُشبِهُ مفتاحاً لا اسمَ متغيّرٍ؛ وسرٌّ في وثيقةٍ سرٌّ في المستودعِ (المادة 7).`,
        { id: provider.id, field: 'apiKeyEnv' },
      );
    }
    if (!isEnvName(provider.apiKeyEnv)) {
      invalidDocument(
        `«apiKeyEnv» في المزوّدِ «${provider.id}» ليس اسمَ متغيّرِ بيئةٍ؛ والمفتاحُ يُقرأُ من البيئةِ باسمٍ مُعلَنٍ لا يُكتَبُ في وثيقةٍ.`,
        { id: provider.id, field: 'apiKeyEnv' },
      );
    }
    if (provider.caFileEnv !== undefined && !isEnvName(provider.caFileEnv)) {
      invalidDocument(
        `«caFileEnv» في المزوّدِ «${provider.id}» ليس اسمَ متغيّرِ بيئةٍ يحمِلُ **مسارَ** شهادةٍ.`,
        { id: provider.id, field: 'caFileEnv' },
      );
    }
    for (const [key, value] of Object.entries(provider.headers ?? {})) {
      if (looksLikeSecret(value)) {
        refuse(
          ADAPTER_ERRORS.SECRET_INLINE,
          `الترويسةُ الثابتةُ «${key}» في المزوّدِ «${provider.id}» تحمِلُ قيمةً تُشبِهُ مفتاحاً؛ والمفاتيحُ من البيئةِ وحدَها.`,
          { id: provider.id, header: key },
        );
      }
      if (key.toLowerCase() === 'authorization') {
        refuse(
          ADAPTER_ERRORS.SECRET_INLINE,
          `ترويسةُ التفويضِ مُعلَنةٌ ثابتةً في المزوّدِ «${provider.id}»؛ وهي تُبنى عندَ النداءِ من متغيّرِ البيئةِ المُعلَنِ لا تُكتَبُ في وثيقةٍ.`,
          { id: provider.id, header: key },
        );
      }
    }
    for (const [key, value] of Object.entries(provider.requestExtras ?? {})) {
      if (typeof value === 'string' && looksLikeSecret(value)) {
        refuse(
          ADAPTER_ERRORS.SECRET_INLINE,
          `حقلُ الطلبِ الثابتُ «${key}» في المزوّدِ «${provider.id}» يحمِلُ قيمةً تُشبِهُ مفتاحاً؛ والسرُّ في إعلانٍ سرٌّ في المستودعِ.`,
          { id: provider.id, field: key },
        );
      }
    }
    if (provider.timeoutMs !== undefined && provider.timeoutMs > MAX_ADAPTER_TIMEOUT_MS) {
      invalidDocument(
        `مُهلةُ المزوّدِ «${provider.id}» تتجاوزُ سقفَ العقدِ (${MAX_ADAPTER_TIMEOUT_MS}ms)؛ وما فوقَ السقفِ انتظارٌ لا مُهلةٌ.`,
        { id: provider.id, timeoutMs: provider.timeoutMs },
      );
    }
  }
  return Object.freeze({
    version: parsed.version,
    owner: parsed.owner,
    providers: Object.freeze(parsed.providers.map((entry) => Object.freeze({ ...entry }))),
  });
}

/**
 * يقرأُ إعلانَ مزوّدٍ بعينِه من الوثيقةِ؛ ومعرّفٌ غيرُ مُعلَنٍ يُرَدُّ باسمِه ولا
 * يُبنى له مُوائمٌ بعنوانٍ مُخمَّنٍ.
 *
 * @param {{ id: string, dir?: string, document?: InferenceProvidersDocument }} options
 * @returns {DeclaredProvider}
 */
export function declaredProvider({ id, dir, document }) {
  const doc = document ?? loadInferenceProviders(dir === undefined ? {} : { dir });
  const found = doc.providers.find((entry) => entry.id === id);
  if (found === undefined) {
    invalidDocument(
      `المزوّدُ «${String(id)}» غيرُ مُعلَنٍ في ${INFERENCE_PROVIDERS_FILE}؛ والمُعلَنونَ: ${doc.providers.map((entry) => entry.id).join('، ') || 'لا أحدَ'}.`,
      { id: String(id) },
    );
  }
  return found;
}

/**
 * يبني مُوائمَ مزوّدٍ **من إعلانِه في الوثيقةِ** عبرَ `createHttpsAdapter` وحدَه؛
 * فلا عنوانَ في شفرةِ المُنادي ولا اسمَ متغيّرِ مفتاحٍ فيها.
 *
 * @param {{ id: string, dir?: string, document?: InferenceProvidersDocument, env?: NodeJS.ProcessEnv, requestFn?: import('./adapters/https.mjs').HttpsAdapterOptions['requestFn'] }} options
 * @returns {ReturnType<typeof createHttpsAdapter>}
 */
export function createDeclaredHttpsAdapter({ id, dir, document, env, requestFn }) {
  const declaration = declaredProvider({
    id,
    ...(dir === undefined ? {} : { dir }),
    ...(document === undefined ? {} : { document }),
  });
  return createHttpsAdapter(
    /** @type {import('./adapters/https.mjs').HttpsAdapterOptions} */ ({
      id: declaration.id,
      provider: declaration.provider,
      endpoint: declaration.endpoint,
      apiKeyEnv: declaration.apiKeyEnv,
      ...(declaration.caFileEnv === undefined ? {} : { caFileEnv: declaration.caFileEnv }),
      ...(declaration.authHeader === undefined ? {} : { authHeader: declaration.authHeader }),
      ...(declaration.authScheme === undefined ? {} : { authScheme: declaration.authScheme }),
      ...(declaration.timeoutMs === undefined ? {} : { timeoutMs: declaration.timeoutMs }),
      ...(declaration.headers === undefined ? {} : { headers: declaration.headers }),
      ...(declaration.requestFields === undefined
        ? {}
        : { requestFields: declaration.requestFields }),
      ...(declaration.requestExtras === undefined
        ? {}
        : { requestExtras: declaration.requestExtras }),
      outputPath: declaration.outputPath,
      ...(declaration.modelPath === undefined ? {} : { modelPath: declaration.modelPath }),
      ...(declaration.usagePaths === undefined ? {} : { usagePaths: declaration.usagePaths }),
      ...(env === undefined ? {} : { env }),
      ...(requestFn === undefined ? {} : { requestFn }),
    }),
  );
}

/**
 * مُنفِّذٌ جاهزٌ للبوابةِ من مزوّدٍ مُعلَنٍ: يمرُّ بـ`executorFor` فيُفحَصُ ناتجُه
 * بالعقدِ، فلا يَصِلُ إلى البوابةِ ناتجٌ بلا فحصٍ.
 *
 * @param {{ id: string, dir?: string, document?: InferenceProvidersDocument, env?: NodeJS.ProcessEnv, requestFn?: import('./adapters/https.mjs').HttpsAdapterOptions['requestFn'] }} options
 * @returns {ReturnType<typeof executorFor>}
 */
export function declaredHttpsExecutor(options) {
  return executorFor(createDeclaredHttpsAdapter(options));
}

/**
 * وصفُ المزوّدينَ المُعلَنينَ **بلا مفتاحٍ ولا قيمةِ بيئةٍ**: المعرّفُ والجهةُ
 * والعنوانُ واسمُ متغيّرِ المفتاحِ، وهل هو حاضرٌ في البيئةِ الآنَ. وهذا هو
 * الوصفُ الذي يُقرأُ في تقريرٍ أو لوحةٍ، فلا يحمِلُ سرّاً.
 *
 * @param {{ dir?: string, document?: InferenceProvidersDocument, env?: NodeJS.ProcessEnv }} [options]
 * @returns {Array<{ id: string, provider: string, endpoint: string, apiKeyEnv: string, keyPresent: boolean, timeoutMs: number | null }>}
 */
export function describeInferenceProviders(options = {}) {
  const doc =
    options.document ??
    loadInferenceProviders(options.dir === undefined ? {} : { dir: options.dir });
  const env = options.env ?? process.env;
  return doc.providers.map((entry) => {
    const value = env[entry.apiKeyEnv];
    return {
      id: entry.id,
      provider: entry.provider,
      endpoint: entry.endpoint,
      apiKeyEnv: entry.apiKeyEnv,
      keyPresent: typeof value === 'string' && value.trim() !== '',
      timeoutMs: entry.timeoutMs ?? null,
    };
  });
}
