/**
 * مُوائمُ مزوّدٍ عبرَ `https` — سدادُ `D-11` (الشوطُ الثاني: نداءُ مزوّدٍ حقيقيٌّ).
 *
 * **العيبُ الذي يُغلقه هذا الملفُّ** كان مُعلَناً بنصِّه في
 * `docs/INFERENCE.md §5.1`: «لا مُوائمَ مزوّدٍ حقيقيٍّ في المستودعِ. لا نداءَ
 * شبكةٍ إلى أيِّ مزوّدٍ». فبوابةُ الاستدلالِ وعقدُ المُوائمِ كانا مقيسَينِ على
 * مُنفِّذٍ **داخليٍّ حتميٍّ** وحدَه، ومُنفِّذٌ لا يفتحُ مِقبساً لا يُقاسُ عليه
 * سلوكُ الشبكةِ: لا تحقُّقُ شهادةٍ، ولا مفتاحٌ يُقرأُ من بيئةٍ، ولا ردٌّ يُرفَضُ
 * لأنّه ليس ما وعدَ به المزوّدُ، ولا جسمٌ بلا سقفٍ يُستنزَفُ به المُخزَنُ.
 *
 * **ستّةُ حدودٍ لا تُخفَّفُ:**
 *   1. **لا سرَّ في المستودعِ ولا في الإعلانِ.** المفتاحُ يُقرأُ عندَ **كلِّ
 *      نداءٍ** من `process.env[declaration.apiKeyEnv]`، فلا نسخةَ منه محفوظةٌ في
 *      كائنِ المُوائمِ تعيشُ ما عاشتِ العمليّةُ ولا تُبدَّلُ إن بُدِّلَ المفتاحُ.
 *      وغيابُه رفضٌ مُسمّىً (`KEY_ABSENT`) لا نداءٌ بلا ترويسةِ تفويضٍ.
 *   2. **لا نقلَ بلا تعميةٍ مُتحقَّقٍ منها.** خياراتُ العميلِ من
 *      `secureClientOptions` في `src/transport/tls.mjs` وحدَها — نفسُ الموضعِ
 *      الذي سُدَّ به `D-12`، فلا مقياسانِ للتعميةِ في الدولةِ. ولا يُذكَرُ
 *      `rejectUnauthorized` في هذا الملفِّ أصلاً، فلا سبيلَ إلى إسقاطِه هنا.
 *      وعنوانٌ غيرُ `https:` يُرفَضُ قبلَ النداءِ، وعنوانٌ يحمِلُ اسماً وكلمةَ
 *      مرورٍ في نفسِه يُرفَضُ لأنّ ذلك سرٌّ في عنوانٍ يُكتَبُ في السجلّاتِ.
 *   3. **لا سلطةَ في المُوائمِ.** لا سياسةَ ولا مستودعَ ولا قيدَ في السجلِّ ولا
 *      تفويضاً؛ يقرأُ نصّاً ويُعيدُ نصّاً واستهلاكاً، والقرارُ والقيدُ للبوابةِ.
 *   4. **لا بروتوكولَ مُختَرَعاً.** أسماءُ حقولِ الطلبِ ومساراتُ حقولِ الردِّ
 *      **بياناتٌ في الإعلانِ** (`requestFields` و`outputPath` و`usagePaths`)، لا
 *      فروعٌ في الشفرةِ لكلِّ مزوّدٍ؛ فمزوّدٌ جديدٌ إعلانٌ جديدٌ لا تعديلُ شفرةٍ.
 *      وما لا يُطابِقُ الإعلانَ يُرفَضُ (`RESPONSE_UNREADABLE`) ولا يُخمَّنُ.
 *   5. **لا جسمَ بلا سقفٍ.** يُقطَعُ النداءُ عندَ تجاوزِ
 *      `HTTPS_ADAPTER_MAX_RESPONSE_BYTES`، فردٌّ بلا نهايةٍ استنزافُ ذاكرةٍ لا
 *      نداءٌ بطيءٌ. والمُهلةُ من العقدِ (`executorFor`) تُجهِضُ الطلبَ بإشارةٍ.
 *   6. **لا سرَّ في رسالةِ خطأٍ.** كلُّ نصٍّ يُخرَجُ من هذا الملفِّ يمرُّ على
 *      `redact`، فيُحجَبُ المفتاحُ لو ردَّدَه المزوّدُ في جسمِ ردِّه، وتُقتَطَعُ
 *      رسالةُ المزوّدِ عندَ حدٍّ معلومٍ.
 *
 * **حدٌّ مُعلَنٌ صريحٌ:** المُوائمُ يفحصُ **شكلَ** ما يعودُ لا **صدقَه**، كما
 * أعلنَ العقدُ. ومطابقةُ الاستهلاكِ بفاتورةِ المزوّدِ ليست في المستودعِ ولا
 * تُدَّعى. ولا مزوّدَ مُعلَناً في `config/` بعدُ: هذا الملفُّ **مُوائمٌ يُنادى بإعلانٍ
 * يُمرَّرُ إليه**، وربطُه بوثيقةِ مزوّدينَ وسقفٍ من `config/quotas.yaml` هو
 * الشوطُ الثالثُ المُعلَنُ في `docs/INFERENCE.md §5.2`.
 */

import fs from 'node:fs';
import { request as httpsRequest } from 'node:https';
import process from 'node:process';

import { secureClientOptions } from '../../transport/tls.mjs';

import {
  ADAPTER_ERRORS,
  InferenceAdapterError,
  assertAdapterDeclaration,
  executorFor,
  isEnvName,
  looksLikeSecret,
} from './contract.mjs';

/** سقفُ جسمِ الردِّ: ما فوقَه استنزافُ ذاكرةٍ لا ردُّ نموذجٍ. */
export const HTTPS_ADAPTER_MAX_RESPONSE_BYTES = 1_048_576;

/** مُهلةٌ افتراضيّةٌ لنداءِ شبكةٍ؛ تُعلَنُ في الإعلانِ ويُفحَصُ سقفُها في العقدِ. */
export const HTTPS_ADAPTER_DEFAULT_TIMEOUT_MS = 30_000;

/** أقصى ما يُقتَطَعُ من رسالةِ المزوّدِ في رفضٍ؛ فسجلٌّ يُغرَقُ بردٍّ سجلٌّ لا يُقرأُ. */
export const HTTPS_ADAPTER_MAX_REFUSAL_EXCERPT = 200;

/** ما يُكتَبُ مكانَ المفتاحِ إن ظهرَ في نصٍّ يُخرَجُ. */
export const REDACTION_MARK = '⟨مفتاحٌ مَحجوبٌ⟩';

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
 * حجبُ المفتاحِ من نصٍّ يُخرَجُ. **لا يُستثنى منه نصٌّ**: رسالةُ المزوّدِ قد
 * تُعيدُ ما أُرسِلَ إليها، ورسالةُ خطأِ مِقبسٍ قد تحمِلُ العنوانَ بكاملِه.
 *
 * @param {string} text
 * @param {string} secret
 * @returns {string}
 */
export function redact(text, secret) {
  if (secret === '') return text;
  return text.split(secret).join(REDACTION_MARK);
}

/**
 * قراءةُ قيمةٍ من ردٍّ بمسارٍ مُعلَنٍ. **ولا تخميناً**: ما ليس على المسارِ غيرُ
 * موجودٍ، فلا يُبحَثُ عنه في حقلٍ آخرَ يُشبِهُه.
 *
 * @param {unknown} source
 * @param {ReadonlyArray<string | number>} route
 * @returns {unknown}
 */
export function pluck(source, route) {
  /** @type {unknown} */
  let cursor = source;
  for (const step of route) {
    if (cursor === null || typeof cursor !== 'object') return undefined;
    cursor = /** @type {Record<string | number, unknown>} */ (cursor)[step];
  }
  return cursor;
}

/**
 * @param {unknown} candidate
 * @param {string} field
 * @returns {ReadonlyArray<string | number>}
 */
function assertRoute(candidate, field) {
  if (!Array.isArray(candidate) || candidate.length === 0) {
    refuse(
      ADAPTER_ERRORS.DECLARATION_INVALID,
      `«${field}» يجبُ أن يكونَ مساراً غيرَ فارغٍ إلى حقلٍ في ردِّ المزوّدِ؛ ومُوائمٌ لا يعرفُ أينَ يقرأُ مُخرَجَه يُخمِّنُ.`,
      { field },
    );
  }
  for (const step of candidate) {
    if (typeof step !== 'string' && !Number.isInteger(step)) {
      refuse(
        ADAPTER_ERRORS.DECLARATION_INVALID,
        `«${field}» يحمِلُ خطوةً ليست نصّاً ولا عدداً صحيحاً؛ ومسارٌ مُشوَّهٌ يقرأُ من غيرِ موضعِه.`,
        { field },
      );
    }
  }
  return Object.freeze([.../** @type {Array<string | number>} */ (candidate)]);
}

/**
 * @typedef {object} HttpsAdapterOptions
 * @property {string} id معرّفُ المُوائمِ كما يُقيَّدُ في السجلِّ
 * @property {string} provider جهةُ التنفيذِ كما تُعلَنُ في سجلِّ النماذجِ
 * @property {string} endpoint عنوانُ `https` كاملاً
 * @property {string} apiKeyEnv **اسمُ** متغيّرِ بيئةِ المفتاحِ لا قيمتُه
 * @property {number} [timeoutMs]
 * @property {string | null} [caFileEnv] اسمُ متغيّرٍ يحمِلُ **مسارَ** شهادةِ جهةِ إصدارٍ
 * @property {string} [authHeader] ترويسةُ التفويضِ؛ الافتراضُ `authorization`
 * @property {string} [authScheme] بادئةُ الترويسةِ؛ الافتراضُ `Bearer`
 * @property {Record<string, string>} [headers] ترويساتٌ ثابتةٌ غيرُ سرّيّةٍ
 * @property {{ model?: string, input?: string, purpose?: string }} [requestFields] أسماءُ حقولِ الطلبِ عندَ المزوّدِ
 * @property {Record<string, unknown>} [requestExtras] حقولٌ ثابتةٌ تُضافُ إلى الطلبِ
 * @property {ReadonlyArray<string | number>} outputPath مسارُ المُخرَجِ في الردِّ
 * @property {{ inputTokens?: ReadonlyArray<string | number>, outputTokens?: ReadonlyArray<string | number>, totalTokens?: ReadonlyArray<string | number>, cost?: ReadonlyArray<string | number> }} [usagePaths]
 * @property {ReadonlyArray<string | number> | null} [modelPath] مسارُ النموذجِ في الردِّ إن أعلنَه المزوّدُ
 * @property {NodeJS.ProcessEnv} [env]
 * @property {typeof httpsRequest} [requestFn]
 */

/**
 * يُنشئُ مُوائمَ مزوّدٍ عبرَ `https` بإعلانٍ يُفحَصُ قبلَ أن يُنادى.
 *
 * @param {HttpsAdapterOptions} options
 * @returns {{ declaration: import('./contract.mjs').AdapterDeclaration, endpoint: URL, invoke: (call: { model: { id: string, purpose: string }, purpose: string, input: string, signal: AbortSignal }) => Promise<unknown> }}
 */
export function createHttpsAdapter(options) {
  if (options === null || typeof options !== 'object') {
    refuse(
      ADAPTER_ERRORS.DECLARATION_INVALID,
      'مُوائمُ الشبكةِ بلا خياراتٍ؛ ولا نداءَ إلى عنوانٍ مجهولٍ بمفتاحٍ مجهولٍ.',
    );
  }
  const timeoutMs = options.timeoutMs ?? HTTPS_ADAPTER_DEFAULT_TIMEOUT_MS;
  const declaration = assertAdapterDeclaration({
    id: options.id,
    provider: options.provider,
    transport: 'https',
    network: 'https-only',
    apiKeyEnv: options.apiKeyEnv,
    timeoutMs,
  });
  if (declaration.apiKeyEnv === null) {
    refuse(
      ADAPTER_ERRORS.KEY_ABSENT,
      'مُوائمُ شبكةٍ بلا «apiKeyEnv»؛ ونداءٌ إلى مزوّدٍ بلا ترويسةِ تفويضٍ نداءٌ يُرَدُّ أو — وهو الأسوأُ — يُقبَلُ بلا هويّةٍ.',
    );
  }
  /** @type {URL} */
  let endpoint;
  try {
    endpoint = new URL(options.endpoint);
  } catch {
    refuse(
      ADAPTER_ERRORS.ENDPOINT_INSECURE,
      'عنوانُ المزوّدِ ليس عنواناً صالحاً؛ ولا يُبنى نداءٌ على نصٍّ لا يُحلَّلُ.',
      { field: 'endpoint' },
    );
  }
  if (endpoint.protocol !== 'https:') {
    refuse(
      ADAPTER_ERRORS.ENDPOINT_INSECURE,
      `عنوانُ المزوّدِ يُعلنُ «${endpoint.protocol}» لا «https:»؛ ومفتاحٌ يُرسَلُ بلا تعميةٍ مفتاحٌ مقروءٌ على الطريقِ.`,
      { protocol: endpoint.protocol },
    );
  }
  if (endpoint.username !== '' || endpoint.password !== '') {
    refuse(
      ADAPTER_ERRORS.SECRET_INLINE,
      'عنوانُ المزوّدِ يحمِلُ اسماً أو كلمةَ مرورٍ في نفسِه؛ والعنوانُ يُكتَبُ في السجلّاتِ وتقاريرِ العَطَبِ، فسرٌّ فيه سرٌّ مُذاعٌ.',
      { field: 'endpoint' },
    );
  }
  const caFileEnv = options.caFileEnv ?? null;
  if (caFileEnv !== null && !isEnvName(caFileEnv)) {
    refuse(
      ADAPTER_ERRORS.DECLARATION_INVALID,
      '«caFileEnv» يجبُ أن يكونَ اسمَ متغيّرِ بيئةٍ يحمِلُ **مسارَ** شهادةٍ لا الشهادةَ نفسَها.',
      { field: 'caFileEnv' },
    );
  }
  const headers = Object.freeze({ ...(options.headers ?? {}) });
  for (const [key, value] of Object.entries(headers)) {
    if (typeof value !== 'string') {
      refuse(
        ADAPTER_ERRORS.DECLARATION_INVALID,
        `الترويسةُ الثابتةُ «${key}» ليست نصّاً؛ ولا تُرسَلُ إلى مزوّدٍ قيمةٌ لا يُعرَفُ شكلُها.`,
        { header: key },
      );
    }
    if (looksLikeSecret(value)) {
      refuse(
        ADAPTER_ERRORS.SECRET_INLINE,
        `الترويسةُ الثابتةُ «${key}» تحمِلُ قيمةً تُشبِهُ مفتاحاً؛ والمفاتيحُ من البيئةِ وحدَها.`,
        { header: key },
      );
    }
    if (key.toLowerCase() === 'authorization') {
      refuse(
        ADAPTER_ERRORS.SECRET_INLINE,
        'ترويسةُ التفويضِ لا تُعلَنُ ثابتةً؛ فهي تُبنى عندَ النداءِ من متغيّرِ البيئةِ المُعلَنِ.',
        { header: key },
      );
    }
  }
  const requestExtras = Object.freeze({ ...(options.requestExtras ?? {}) });
  for (const [key, value] of Object.entries(requestExtras)) {
    if (typeof value === 'string' && looksLikeSecret(value)) {
      refuse(
        ADAPTER_ERRORS.SECRET_INLINE,
        `حقلُ الطلبِ الثابتُ «${key}» يحمِلُ قيمةً تُشبِهُ مفتاحاً؛ والسرُّ في إعلانٍ سرٌّ في المستودعِ.`,
        { field: key },
      );
    }
  }
  const fields = Object.freeze({
    model: options.requestFields?.model ?? 'model',
    input: options.requestFields?.input ?? 'input',
    purpose: options.requestFields?.purpose ?? null,
  });
  const outputPath = assertRoute(options.outputPath, 'outputPath');
  const modelPath =
    options.modelPath === undefined || options.modelPath === null
      ? null
      : assertRoute(options.modelPath, 'modelPath');
  /** @type {Record<string, ReadonlyArray<string | number>>} */
  const usagePaths = {};
  for (const [key, route] of Object.entries(options.usagePaths ?? {})) {
    if (route === undefined) continue;
    usagePaths[key] = assertRoute(route, `usagePaths.${key}`);
  }
  const env = options.env ?? process.env;
  const requestFn = options.requestFn ?? httpsRequest;
  const authHeader = (options.authHeader ?? 'authorization').toLowerCase();
  const authScheme = options.authScheme ?? 'Bearer';
  const apiKeyEnv = declaration.apiKeyEnv;

  return {
    declaration,
    endpoint,
    /**
     * @param {{ model: { id: string, purpose: string }, purpose: string, input: string, signal: AbortSignal }} call
     * @returns {Promise<unknown>}
     */
    invoke({ model, purpose, input, signal }) {
      // المفتاحُ يُقرأُ **الآنَ** لا عندَ الإنشاءِ: نسخةٌ محفوظةٌ في كائنٍ تعيشُ
      // ما عاشتِ العمليّةُ، ولا تُبدَّلُ إن بُدِّلَ المفتاحُ في البيئةِ.
      const key = env[apiKeyEnv];
      if (typeof key !== 'string' || key.trim() === '') {
        refuse(
          ADAPTER_ERRORS.KEY_ABSENT,
          `متغيّرُ البيئةِ «${apiKeyEnv}» غيرُ مُعلَنٍ أو فارغٌ؛ ولا نداءَ بلا مفتاحٍ — والاسمُ وحدَه يُذكَرُ هنا، لا قيمتُه.`,
          { apiKeyEnv, adapterId: declaration.id },
        );
      }
      const secret = key.trim();
      /** @type {Record<string, unknown>} */
      const payload = {
        ...requestExtras,
        [fields.model]: model.id,
        [fields.input]: input,
        ...(fields.purpose === null ? {} : { [fields.purpose]: purpose }),
      };
      const body = Buffer.from(JSON.stringify(payload), 'utf8');
      // خياراتُ التعميةِ من موضعِ التعميةِ الواحدِ في الدولةِ؛ ولو أُعيدَ بناؤها
      // هنا لصارَ للتحقُّقِ من الشهادةِ موضعانِ يفترقانِ.
      const tls = secureClientOptions({
        ...(caFileEnv === null ? {} : { caFile: readCaPath(env, caFileEnv) }),
        env,
      });
      return new Promise((resolve, reject) => {
        const call = requestFn(
          {
            ...tls,
            method: 'POST',
            hostname: endpoint.hostname,
            ...(endpoint.port === '' ? {} : { port: Number(endpoint.port) }),
            path: `${endpoint.pathname}${endpoint.search}`,
            headers: {
              ...headers,
              accept: 'application/json',
              'content-type': 'application/json',
              'content-length': String(body.byteLength),
              [authHeader]: `${authScheme} ${secret}`,
            },
            signal,
          },
          (response) => {
            /** @type {Buffer[]} */
            const chunks = [];
            let size = 0;
            response.on('data', (/** @type {Buffer} */ chunk) => {
              size += chunk.byteLength;
              if (size > HTTPS_ADAPTER_MAX_RESPONSE_BYTES) {
                response.destroy();
                call.destroy();
                reject(
                  new InferenceAdapterError(
                    ADAPTER_ERRORS.RESPONSE_TOO_LARGE,
                    `ردُّ المزوّدِ تجاوزَ ${HTTPS_ADAPTER_MAX_RESPONSE_BYTES} بايتاً فقُطِعَ النداءُ؛ وردٌّ بلا سقفٍ استنزافُ ذاكرةٍ لا بطءٌ.`,
                    { adapterId: declaration.id, limit: HTTPS_ADAPTER_MAX_RESPONSE_BYTES },
                  ),
                );
                return;
              }
              chunks.push(chunk);
            });
            response.on('end', () => {
              const text = Buffer.concat(chunks).toString('utf8');
              const status = response.statusCode ?? 0;
              if (status < 200 || status >= 300) {
                reject(
                  new InferenceAdapterError(
                    ADAPTER_ERRORS.PROVIDER_REFUSED,
                    `المزوّدُ «${declaration.provider}» ردَّ بالحالةِ ${status}: ${redact(text.slice(0, HTTPS_ADAPTER_MAX_REFUSAL_EXCERPT), secret)}`,
                    { adapterId: declaration.id, status },
                  ),
                );
                return;
              }
              /** @type {unknown} */
              let parsed;
              try {
                parsed = JSON.parse(text);
              } catch (error) {
                reject(
                  new InferenceAdapterError(
                    ADAPTER_ERRORS.RESPONSE_UNREADABLE,
                    `ردُّ المزوّدِ ليس JSON صالحاً: ${redact(/** @type {Error} */ (error).message, secret)}`,
                    { adapterId: declaration.id },
                  ),
                );
                return;
              }
              const output = pluck(parsed, outputPath);
              if (typeof output !== 'string') {
                reject(
                  new InferenceAdapterError(
                    ADAPTER_ERRORS.RESPONSE_UNREADABLE,
                    `مُخرَجُ المزوّدِ ليس نصّاً على المسارِ المُعلَنِ «${outputPath.join('.')}»؛ ولا يُخمَّنُ موضعُ المُخرَجِ في حقلٍ آخرَ يُشبِهُه.`,
                    { adapterId: declaration.id, outputPath: outputPath.join('.') },
                  ),
                );
                return;
              }
              /** @type {Record<string, unknown>} */
              const usage = {};
              for (const [name, route] of Object.entries(usagePaths)) {
                const value = pluck(parsed, route);
                if (value !== undefined) usage[name] = value;
              }
              const reported = modelPath === null ? undefined : pluck(parsed, modelPath);
              resolve({
                output,
                usage,
                // نموذجُ المزوّدِ كما أعلنَه هو **لا** كما وجَّهَ السجلُّ: العقدُ
                // يُقابِلُ الاثنينِ ويَرفعُ `MODEL_MISMATCH` إن افترقا، ومُوائمٌ
                // يُعيدُ ما وُجِّهَ إليه دائماً يُخفي تبديلَ المزوّدِ للنموذجِ.
                ...(typeof reported === 'string' ? { modelId: reported } : {}),
              });
            });
            response.on('error', (/** @type {Error} */ error) => {
              reject(transportFailure(error, declaration.id, secret));
            });
          },
        );
        call.on('error', (/** @type {Error} */ error) => {
          reject(transportFailure(error, declaration.id, secret));
        });
        call.end(body);
      });
    },
  };
}

/**
 * @param {Error} error
 * @param {string} adapterId
 * @param {string} secret
 * @returns {InferenceAdapterError}
 */
function transportFailure(error, adapterId, secret) {
  return new InferenceAdapterError(
    ADAPTER_ERRORS.TRANSPORT_FAILED,
    `نداءُ المزوّدِ فشلَ في النقلِ: ${redact(error.message, secret)}`,
    { adapterId, cause: redact(error.name, secret) },
  );
}

/**
 * مسارُ شهادةِ جهةِ الإصدارِ من متغيّرٍ مُعلَنٍ. **مسارٌ لا شهادةٌ**: نصُّ
 * الشهادةِ في متغيّرِ بيئةٍ يُقرأُ في قائمةِ العمليّاتِ، على نفسِ اصطلاحِ
 * `STATE_TLS_CA_FILE` و`DATABASE_CA_FILE`.
 *
 * @param {NodeJS.ProcessEnv} env
 * @param {string} name
 * @returns {string}
 */
function readCaPath(env, name) {
  const declared = env[name];
  if (typeof declared !== 'string' || declared.trim() === '') {
    refuse(
      ADAPTER_ERRORS.DECLARATION_INVALID,
      `متغيّرُ شهادةِ جهةِ الإصدارِ «${name}» مُعلَنٌ في المُوائمِ وغيرُ موجودٍ في البيئةِ؛ وإعلانٌ لا يُقابِلُه شيءٌ إعلانٌ لا يُحتَجُّ به.`,
      { field: name },
    );
  }
  const file = declared.trim();
  if (!fs.existsSync(file)) {
    refuse(
      ADAPTER_ERRORS.DECLARATION_INVALID,
      `شهادةُ جهةِ الإصدارِ المُعلَنةُ في «${name}» غيرُ موجودةٍ على المسارِ؛ ونداءٌ يَسقُطُ إلى المخزنِ الافتراضيِّ صامتاً نداءٌ لا يُعرَفُ مَن وثَّقَه.`,
      { field: name },
    );
  }
  return file;
}

/**
 * `execute` جاهزٌ لبوابةِ الاستدلالِ: المُوائمُ مُغلَّفاً بعقدِه، فلا طريقَ إلى
 * البوابةِ إلا عبرَ `assertAdapterResult` وبمُهلةٍ تُجهِضُ بإشارةٍ.
 *
 * @param {HttpsAdapterOptions} options
 * @returns {(call: { model: { id: string, purpose: string }, purpose: string, input: string }) => Promise<{ output: string, usage: { inputTokens?: number, outputTokens?: number, totalTokens?: number, cost?: number } }>}
 */
export function httpsExecutor(options) {
  return executorFor(createHttpsAdapter(options));
}
