/**
 * بوابةُ الواجهةِ الداخليةِ الموحّدة — الخطوة `M9.02`.
 *
 * **العيبُ الذي تُغلقه هذه الوحدة:** بعد `M9.01` صار للدولةِ مسارُ قراءةٍ مُدقَّقٌ
 * (‏`MonitorAgent`)، لكنّ من نادى ذلك المسارَ كان يقول عن نفسِه ما شاء: يمرّر
 * معرّفَ فاعلٍ نصّاً، فتُقرأ الهويةُ من سجلِّ الهوياتِ ولا يُسأل **مَن** أثبت أنه
 * ذلك الفاعل. ولا حدَّ معدَّلٍ يوقف ألفَ نداءٍ في الثانية. ولا مرورَ بنقطةِ
 * التفويضِ المركزيةِ فأفعالُ القراءةِ كانت خارجَ كتالوجِ الأفعالِ المحكومة — وذاك
 * دَينٌ سُجِّل في `WL-043` وتُغلقه هذه الخطوة.
 *
 * **العقباتُ خمسٌ بترتيبٍ ثابتٍ لا يُقلب:**
 * 1. **مسارٌ معلَن** في `config/api.yaml` — وما ليس فيها لا وجودَ له.
 * 2. **جلسةٌ صالحةٌ** لهويةٍ نشطة (‏`SessionStore`) — والغيابُ رفضٌ مُسمّى.
 * 3. **حدُّ معدَّلٍ** يَعُدُّ المحاولةَ لا النجاح.
 * 4. **قرارُ نقطةِ التفويضِ المركزيةِ** ثم **استهلاكُ تذكرتِها** — فلا مسارَ
 *    جانبيَّ للسماح، والتذكرةُ مربوطةٌ بالفاعلِ والفعلِ والمورد.
 * 5. **مشهدُ المراقبةِ** وحده — ولا مستودعَ في يدِ هذه الطبقة.
 *
 * **لماذا هذا الترتيب:** المصادقةُ قبل الحدِّ لأنّ حدّاً على مُنادٍ مجهولٍ يُحسَب
 * على مَن؟ والحدُّ قبل التفويضِ لأنّ نداءً مرفوضاً يجب أن يُكلِّف صاحبَه (ونقطةُ
 * التفويضِ لا تخصم الحصّةَ على مرفوض، بحقّ). والتذكرةُ **قبل** الأثر لأنّ إثباتَ
 * «مررتُ بالنقطة» بعد القراءةِ إثباتٌ لا يمنع شيئاً.
 *
 * **الفشلُ مغلق (المادة 9):** بلا سجلِّ أحداثٍ لا نداءَ (`API_AUDIT_REQUIRED`)،
 * وبلا نقطةِ تفويضٍ لا نداءَ (`API_ENFORCEMENT_REQUIRED`)، وبلا سجلِّ هوياتٍ لا
 * جلسةَ (`API_IDENTITY_UNVERIFIED`)، وبلا وكيلِ مراقبةٍ لا قراءةَ
 * (`API_HANDLER_UNDECLARED`). فالتركيبُ الناقصُ يظهر رفضاً لا سماحاً.
 *
 * **حدودٌ معلَنة:**
 * 1. **لا طبقةَ نقلٍ هنا:** لا مُنصِتَ HTTP ولا مِقبسَ شبكة. البوابةُ نداءٌ داخليٌّ
 *    في العمليةِ نفسِها، ومحوِّلُ النقلِ (‏HTTP) يُبنى في `M9.03` مع الديوانِ فوق
 *    هذه الطبقةِ لا بجوارها. وأثرُ ذلك معلَن: كلُّ ما يُقاس هنا هو التفويضُ
 *    والتدقيقُ والحدّ، **لا** أمنُ النقلِ ولا الرؤوسُ ولا CORS ولا TLS.
 * 2. **كلُّ المساراتِ قارئة.** الكتابةُ من الواجهةِ أمرٌ ملكيٌّ موقَّعٌ ونصُّها
 *    `M9.03`؛ ولا يُعلَن مسارٌ كاتبٌ قبل أن يوجد مَن يوقّعه ومَن يتحقّق من توقيعه.
 * 3. **حدُّ المعدَّلِ لكلِّ عملية** لا للعنقود (انظر `rate-limiter.mjs`).
 * 4. **قيدُ النداءِ يُكتب قبل التفويض**، فقد يُكتب قيدٌ لنداءٍ رُفض بعده: زائدٌ
 *    لا ناقص، وهو نفسُ اختيارِ `M9.01`.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import Ajv2020Default from 'ajv/dist/2020.js';

// وحزمةُ Ajv تُصدِّر صنفَها افتراضاً في ESM، فيُقرأ نوعُه صريحاً وإلا صار «غيرَ
// قابلٍ للإنشاء» في الفحصِ الصارم — كما في وحدةِ المراقبةِ ووحدةِ التقارير.
const Ajv2020 = /** @type {typeof import('ajv/dist/2020.js').Ajv2020} */ (
  /** @type {unknown} */ (Ajv2020Default)
);
import YAML from 'yaml';

import { RateLimiter, RateLimitError, RATE_LIMIT_ERRORS } from './rate-limiter.mjs';
import { SessionStore, SessionError, SESSION_ERRORS } from './session-store.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** مجلَّدُ الإعداداتِ الافتراضيُّ لطبقةِ الواجهة. */
export const DEFAULT_API_CONFIG_DIR = path.resolve(HERE, '..', '..', 'config');

/** رموزُ رفضِ الطبقة — كلُّها مُعلَنةٌ في `config/api.yaml` ومربوطةٌ بضمان. */
export const API_ERRORS = Object.freeze({
  CONFIG_INVALID: 'API_CONFIG_INVALID',
  ROUTE_UNKNOWN: 'API_ROUTE_UNKNOWN',
  AUTH_REQUIRED: SESSION_ERRORS.AUTH_REQUIRED,
  SESSION_INVALID: SESSION_ERRORS.SESSION_INVALID,
  SESSION_EXPIRED: SESSION_ERRORS.SESSION_EXPIRED,
  IDENTITY_UNVERIFIED: SESSION_ERRORS.IDENTITY_UNVERIFIED,
  RATE_LIMITED: RATE_LIMIT_ERRORS.RATE_LIMITED,
  AUTHORIZATION_DENIED: 'API_AUTHORIZATION_DENIED',
  TICKET_INVALID: 'API_TICKET_INVALID',
  ENFORCEMENT_REQUIRED: 'API_ENFORCEMENT_REQUIRED',
  AUDIT_REQUIRED: SESSION_ERRORS.AUDIT_REQUIRED,
  HANDLER_UNDECLARED: 'API_HANDLER_UNDECLARED',
  HANDLER_REFUSED: 'API_HANDLER_REFUSED',
  PARAMS_INVALID: 'API_PARAMS_INVALID',
});

/** خطأُ طبقةِ الواجهةِ برمزٍ مُعلَن. */
export class ApiError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   * @param {Record<string, unknown>} [detail]
   */
  constructor(code, message, detail = {}) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.detail = Object.freeze({ ...detail });
  }
}

/**
 * @param {string} message
 * @returns {never}
 */
function invalidConfig(message) {
  throw new ApiError(API_ERRORS.CONFIG_INVALID, message);
}

/**
 * @param {unknown} error
 * @returns {string}
 */
function errorText(error) {
  return error instanceof Error ? error.message : String(error);
}

/**
 * @param {unknown} error
 * @returns {string}
 */
function codeOf(error) {
  if (error instanceof ApiError || error instanceof SessionError) return error.code;
  if (error instanceof RateLimitError) return error.code;
  const candidate = /** @type {{ code?: unknown }} */ (error)?.code;
  return typeof candidate === 'string' && candidate !== '' ? candidate : 'API_CALL_FAILED';
}

/**
 * @typedef {object} ApiRouteSpec
 * @property {string} id
 * @property {string} method
 * @property {string} path
 * @property {string} action
 * @property {string} resource
 * @property {string} view
 * @property {string} call
 * @property {string} purpose
 * @property {{ windowSeconds: number, maxCalls: number }} [rateLimit]
 */

/**
 * @typedef {object} ApiPolicy
 * @property {number} version
 * @property {string} statement
 * @property {import('./session-store.mjs').SessionPolicy} session
 * @property {{ windowSeconds: number, maxCalls: number }} rateLimit
 * @property {{ callEvent: string, refusalEvent: string, sessionOpenedEvent: string, sessionClosedEvent: string, statement: string }} audit
 * @property {readonly string[]} refusalCodes
 * @property {readonly ApiRouteSpec[]} routes
 * @property {ReadonlyArray<{ id: string, statement: string, enforcedBy: string, codes: readonly string[] }>} guarantees
 */

/**
 * يقرأ وثيقةَ الواجهةِ ويتحقّق منها بمخطَّطها ثم بفحوصِ تماسكٍ لا يُعبِّر عنها
 * مخطَّط: لا مسارين بمعرّفٍ واحدٍ ولا بمسلكٍ واحد، ورموزُ الرفضِ المُعلَنةُ
 * مطابقةٌ لرموزِ الكودِ **في الاتجاهين**، وكلُّ رمزٍ في ضمانٍ مُعلَنٌ في القائمة.
 * @param {{ dir?: string }} [options]
 * @returns {ApiPolicy}
 */
export function loadApiPolicy(options = {}) {
  const dir = options.dir ?? DEFAULT_API_CONFIG_DIR;
  const schemaDir = fs.existsSync(path.join(dir, 'schemas')) ? dir : DEFAULT_API_CONFIG_DIR;
  const file = path.join(dir, 'api.yaml');
  if (!fs.existsSync(file)) {
    invalidConfig(
      'وثيقةُ طبقةِ الواجهةِ غائبة؛ وطبقةٌ بلا وثيقةٍ تُعلن مساراتَها وأفعالَها ومشاهدَها طبقةٌ حدُّها نيّةُ كاتبها.',
    );
  }
  /** @type {unknown} */
  let raw;
  try {
    raw = YAML.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    invalidConfig(`تعذّرت قراءة api.yaml: ${errorText(error)}`);
  }
  const schemaPath = path.join(schemaDir, 'schemas', 'api.schema.json');
  if (!fs.existsSync(schemaPath)) {
    invalidConfig(
      'مخطَّطُ وثيقةِ الواجهةِ غائب؛ وبلا مخطَّطٍ يصير إعلانُ المساراتِ نصّاً حرّاً كالذي جاء ليمنعه.',
    );
  }
  const validate = new Ajv2020({ allErrors: true, strict: false }).compile(
    JSON.parse(fs.readFileSync(schemaPath, 'utf8')),
  );
  if (!validate(raw)) {
    const problems = (validate.errors ?? [])
      .map((/** @type {{ instancePath: string, message?: string }} */ entry) =>
        `${entry.instancePath || '/'} ${entry.message ?? ''}`.trim(),
      )
      .join(' · ');
    invalidConfig(`api.yaml يخالف مخطَّطه: ${problems}`);
  }
  const parsed = /** @type {ApiPolicy} */ (raw);

  // ── فحوصُ تماسكٍ لا يُعبِّر عنها مخطَّط ──

  /** @type {Set<string>} */
  const ids = new Set();
  /** @type {Set<string>} */
  const endpoints = new Set();
  for (const route of parsed.routes) {
    if (ids.has(route.id)) {
      invalidConfig(
        `المسار ${route.id} مُعلَنٌ مرّتين؛ ولا مسارانِ بمعرّفٍ واحدٍ يُنفَّذ أحدُهما بالآخر.`,
      );
    }
    ids.add(route.id);
    const endpoint = `${route.method} ${route.path}`;
    if (endpoints.has(endpoint)) {
      invalidConfig(
        `المسلك ${endpoint} مُعلَنٌ لمسارين؛ ومسلكٌ واحدٌ بمعنيين يُخفي أحدَهما عن قارئِ الوثيقة.`,
      );
    }
    endpoints.add(endpoint);
    if (!route.resource.includes(':')) {
      invalidConfig(`المورد «${route.resource}» في المسار ${route.id} بلا نوعٍ ومعرّف.`);
    }
  }

  /** @type {Set<string>} */
  const declared = new Set(Object.values(API_ERRORS));
  /** @type {Set<string>} */
  const listed = new Set(parsed.refusalCodes);
  for (const code of declared) {
    if (!listed.has(code)) {
      invalidConfig(
        `الرمز ${code} يرفعه الكودُ ولا إعلانَ له في الوثيقة؛ ورفضٌ بلا نصٍّ يُعلنه رفضٌ يُفاجئ قارئه.`,
      );
    }
  }
  for (const code of listed) {
    if (!declared.has(code)) {
      invalidConfig(
        `الرمز ${code} مُعلَنٌ في الوثيقةِ ولا يرفعه كودٌ؛ ووثيقةٌ تَعِد برفضٍ لا يقع وثيقةٌ تكذب.`,
      );
    }
  }
  for (const guarantee of parsed.guarantees) {
    for (const code of guarantee.codes) {
      if (!listed.has(code)) {
        invalidConfig(
          `الضمان ${guarantee.id} يُشير إلى الرمز ${code} وهو غيرُ مُعلَنٍ في refusalCodes.`,
        );
      }
    }
  }

  return Object.freeze({
    version: parsed.version,
    statement: parsed.statement,
    session: Object.freeze({ ...parsed.session }),
    rateLimit: Object.freeze({ ...parsed.rateLimit }),
    audit: Object.freeze({ ...parsed.audit }),
    refusalCodes: Object.freeze([...parsed.refusalCodes]),
    routes: Object.freeze(parsed.routes.map((route) => Object.freeze({ ...route }))),
    guarantees: Object.freeze(
      parsed.guarantees.map((entry) =>
        Object.freeze({ ...entry, codes: Object.freeze([...entry.codes]) }),
      ),
    ),
  });
}

/**
 * @typedef {object} ApiCallRequest
 * @property {string} route معرّفُ المسارِ المُعلَن.
 * @property {string} [token] رمزُ الجلسة؛ غيابُه رفضٌ لا نداءٌ مجهولُ الهوية.
 * @property {Record<string, unknown>} [params] وسائطُ النداءِ بحدودِ ما يقبله المشهد.
 */

/**
 * والعقدُ يُكتب بأنواعِ الطرفِ الحقيقيِّ نفسِه لا بنوعٍ فضفاضٍ يشبهه: عقدٌ يقول
 * `Record<string, unknown>` أو `object` يبدو أوسعَ قبولاً، وهو في الحقيقةِ
 * **يرفض** المُعالِجَ القائمَ لأن دالّةً تقبل نوعاً محدَّداً لا تُسند إلى دالّةٍ
 * تُوعِد بقبولِ أيِّ شيء. فالاستيرادُ النوعيُّ هنا صدقٌ في العقدِ لا اقتراناً
 * في التشغيل: لا تستورد هذه الطبقةُ وحدةً واحدةً من `src/observability/` ولا من
 * `src/policy/` في زمنِ التنفيذ.
 *
 * @typedef {object} ApiMonitorLike
 * @property {(viewId: string, request: import('../observability/monitor-agent.mjs').MonitorReadRequest) => Promise<unknown>} read
 * @property {() => readonly string[]} views
 */

/**
 * @typedef {object} ApiEnforcementLike
 * @property {(request: import('../policy/model.mjs').PolicyRequest) => Promise<{ decision: { allowed: boolean, code: string, reason: string, policyId: string | null }, token: string | null }>} authorize
 * @property {(token: string | undefined, binding: { actorId: string, action: string, resourceKey: string }) => { policyId: string | null }} verify
 */

/**
 * بوابةٌ واحدةٌ لكلِّ نداءٍ داخليّ. لا تُصدِّر مشهداً ولا مستودعاً ولا مخزنَ
 * جلساتٍ: كلُّها في حقولٍ خاصّة، والنداءُ كلُّه من `call` وحده.
 */
export class ApiGateway {
  /** @type {ApiPolicy} */
  #policy;
  /** @type {Map<string, ApiRouteSpec>} */
  #routes = new Map();
  /** @type {SessionStore} */
  #sessions;
  /** @type {RateLimiter} */
  #limiter;
  /** @type {ApiEnforcementLike | null} */
  #enforcement;
  /** @type {ApiMonitorLike | null} */
  #monitor;
  /** @type {import('./session-store.mjs').SessionLogLike | null} */
  #log;

  /**
   * @param {{ policy?: ApiPolicy, dir?: string, log?: import('./session-store.mjs').SessionLogLike | null, agents?: import('./session-store.mjs').SessionAgentsLike | null, monitor?: ApiMonitorLike | null, enforcementPoint?: ApiEnforcementLike | null, now?: () => Date }} [deps]
   */
  constructor(deps = {}) {
    const policy = deps.policy ?? loadApiPolicy(deps.dir === undefined ? {} : { dir: deps.dir });
    this.#policy = policy;
    this.#log = deps.log ?? null;
    this.#monitor = deps.monitor ?? null;
    this.#enforcement = deps.enforcementPoint ?? null;
    for (const route of policy.routes) this.#routes.set(route.id, route);
    /** @type {Map<string, { windowSeconds: number, maxCalls: number }>} */
    const rules = new Map();
    for (const route of policy.routes) {
      if (route.rateLimit !== undefined) rules.set(route.id, route.rateLimit);
    }
    // و`exactOptionalPropertyTypes` مُفعَّلٌ في هذا المستودع، فحقلٌ اختياريٌّ
    // يُمرَّر بقيمةِ `undefined` ليس كحقلٍ غائب. فتُبنى الساعةُ نشراً مشروطاً.
    const clock = deps.now === undefined ? {} : { now: deps.now };
    this.#limiter = new RateLimiter({ fallback: policy.rateLimit, rules, ...clock });
    this.#sessions = new SessionStore({
      policy: policy.session,
      audit: policy.audit,
      log: deps.log ?? null,
      agents: deps.agents ?? null,
      ...clock,
    });
  }

  /** @returns {ApiPolicy} */
  get policy() {
    return this.#policy;
  }

  /**
   * وصفُ المساراتِ المُعلَنة — بياناتٌ تُقرأ، لا مِقبضٌ يُنفَّذ به شيء.
   * @returns {ReadonlyArray<{ id: string, method: string, path: string, action: string, resource: string, purpose: string, limit: { windowSeconds: number, maxCalls: number } }>}
   */
  routes() {
    return Object.freeze(
      [...this.#routes.values()].map((route) =>
        Object.freeze({
          id: route.id,
          method: route.method,
          path: route.path,
          action: route.action,
          resource: route.resource,
          purpose: route.purpose,
          limit: this.#limiter.ruleFor(route.id),
        }),
      ),
    );
  }

  /**
   * يفتح جلسةً. هذا هو المدخلُ الوحيدُ للمصادقةِ في هذه الطبقة، وهو نفسُه مُدقَّق.
   * @param {{ actorId: string }} request
   * @returns {Promise<{ token: string, sessionId: string, actorId: string, expiresAt: string }>}
   */
  async openSession(request) {
    return this.#sessions.open(request);
  }

  /**
   * يُغلق جلسةً بالرمز.
   * @param {string | undefined | null} token
   * @returns {boolean}
   */
  closeSession(token) {
    return this.#sessions.close(token);
  }

  /**
   * نداءٌ واحدٌ محكوم. كلُّ رفضٍ يُسجَّل برمزِه في `refusalEvent` قبل رميه — إلا
   * رفضَ غيابِ سجلِّ الأحداثِ نفسِه، ولا موضعَ يُسجَّل فيه.
   * @param {ApiCallRequest} request
   * @returns {Promise<{ route: string, status: 'ok', policyId: string | null, session: string, data: unknown }>}
   */
  async call(request) {
    const log = this.#log;
    if (log === null) {
      throw new ApiError(
        API_ERRORS.AUDIT_REQUIRED,
        'سجلُّ الأحداثِ غيرُ موصولٍ ببوابةِ الواجهة؛ ونداءٌ بلا أثرِ تدقيقٍ أسوأُ من نداءٍ مرفوضٍ لأنه يقع ولا يُرى.',
      );
    }
    const routeId = typeof request?.route === 'string' ? request.route.trim() : '';
    /** @type {string} */
    let actorId = 'unknown';
    try {
      return await this.#callChecked(request, routeId, log, (id) => (actorId = id));
    } catch (error) {
      try {
        const detail = error instanceof ApiError ? error.detail : {};
        log.append(this.#policy.audit.refusalEvent, actorId, {
          route: routeId === '' ? 'unknown' : routeId,
          code: codeOf(error),
          reason: errorText(error),
          // تفصيلُ الرفضِ يُسجَّل معه: رمزٌ مُغلَّفٌ بلا رمزِ سببِه قيدٌ يقول «رُفض»
          // ولا يقول «لماذا»، فيُقرأ بعد شهرٍ ولا يُفهم.
          ...(Object.keys(detail).length === 0 ? {} : { detail }),
        });
      } catch {
        // قيدُ الرفضِ لا يُبدِّل الرفض: من أخفق تسجيلُ رفضِه يبقى مرفوضاً، ولا
        // يُستبدَل خطأُ التسجيلِ بخطأِ السببِ فيُخفيه.
      }
      throw error;
    }
  }

  /**
   * @param {ApiCallRequest} request
   * @param {string} routeId
   * @param {import('./session-store.mjs').SessionLogLike} log
   * @param {(actorId: string) => void} remember
   * @returns {Promise<{ route: string, status: 'ok', policyId: string | null, session: string, data: unknown }>}
   */
  async #callChecked(request, routeId, log, remember) {
    // ── (1) مسارٌ معلَن ──
    const route = this.#routes.get(routeId);
    if (route === undefined) {
      throw new ApiError(
        API_ERRORS.ROUTE_UNKNOWN,
        `المسار «${routeId}» غيرُ مُعلَنٍ في وثيقةِ الواجهة؛ والمساراتُ بياناتٌ في الوثيقةِ لا أسماءٌ يخترعها المُنادي.`,
      );
    }

    // ── (2) المصادقة: جلسةٌ صالحةٌ لهويةٍ نشطة ──
    const session = await this.#sessions.resolve(request.token);
    remember(session.actorId);

    // ── (3) حدُّ المعدَّل: يَعُدُّ المحاولةَ لا النجاح ──
    const limit = this.#limiter.consume({ routeId: route.id, actorId: session.actorId });

    // ── (4) قيدُ النداءِ قبل سؤالِ التفويض (الحدُّ المُعلَن رقم 4) ──
    log.append(this.#policy.audit.callEvent, session.actorId, {
      route: route.id,
      method: route.method,
      path: route.path,
      action: route.action,
      resource: route.resource,
      session: session.id,
      remaining: limit.remaining,
    });

    // ── (5) التفويضُ من النقطةِ المركزيةِ وحدها ──
    const enforcement = this.#enforcement;
    if (enforcement === null) {
      throw new ApiError(
        API_ERRORS.ENFORCEMENT_REQUIRED,
        'نقطةُ التفويضِ المركزيةُ غيرُ موصولةٍ ببوابةِ الواجهة؛ وطبقةُ واجهةٍ تُقرِّر بنفسِها هي المسارُ الجانبيُّ الذي أُغلق في M4.05.',
      );
    }
    const params = this.#readParams(route, request.params);
    const [resourceType, resourceId] = this.#splitResource(route.resource);
    const policyRequest = {
      actor: {
        id: session.actorId,
        role: session.role,
        state: session.state,
        capabilities: session.capabilities,
      },
      action: route.action,
      resource: { type: resourceType, id: resourceId },
      context: Object.freeze({
        via: 'api',
        route: route.id,
        call: route.call,
        view: route.view,
      }),
    };
    const { decision, token } = await enforcement.authorize(policyRequest);
    if (!decision.allowed || token === null) {
      throw new ApiError(
        API_ERRORS.AUTHORIZATION_DENIED,
        `التفويضُ رُفض على المسار ${route.id}: ${decision.code} — ${decision.reason}`,
        { policyCode: decision.code, policyId: decision.policyId },
      );
    }

    // ── (6) استهلاكُ التذكرةِ قبل الأثر: إثباتُ «مررتُ بالنقطة» لا بعد القراءة ──
    try {
      enforcement.verify(token, {
        actorId: session.actorId,
        action: route.action,
        resourceKey: `${resourceType}:${resourceId}`,
      });
    } catch (error) {
      throw new ApiError(
        API_ERRORS.TICKET_INVALID,
        `تذكرةُ القرارِ لم تُقبل على المسار ${route.id}: ${errorText(error)} — والتذكرةُ مربوطةٌ بالفاعلِ والفعلِ والمورد، وتُستهلَك مرّةً واحدة.`,
      );
    }

    // ── (7) القراءةُ من مشهدِ المراقبةِ وحده ──
    const monitor = this.#monitor;
    if (monitor === null) {
      throw new ApiError(
        API_ERRORS.HANDLER_UNDECLARED,
        'وكيلُ المراقبةِ غيرُ موصولٍ ببوابةِ الواجهة؛ ولا تقرأ هذه الطبقةُ من مستودعٍ مباشرةً ولو كان في متناولِها — فالقراءةُ من مشهدٍ مُدقَّقٍ أو لا قراءة.',
      );
    }
    // ورفضُ المُعالِجِ يُغلَّف برمزٍ من كتالوجِ هذه الطبقة. وليس هذا تجميلاً:
    // كتالوجُ `refusalCodes` يَعِد بأنّ ما يخرج من هنا مُعلَنٌ فيه، فخروجُ
    // `MONITOR_*` منه يجعل الوعدَ كاذباً. ورمزُ المُعالِجِ يُحفَظ في التفصيلِ
    // ويُسجَّل، فلا يضيع السببُ الأصليُّ في التغليف.
    //
    // وهذا الطريقُ **مسلوكٌ فعلاً** لا احتياطٌ نظريّ: كتالوجُ السياساتِ يأذن
    // لـ`role:minister` و`role:operator` و`role:agent` و`role:chief-justice`
    // بفعلِ `read-registry`، ووكيلُ المراقبةِ لا يخدم إلا دورَه المُعلَنَ
    // (`role:auditor`). فمن أذنت له النقطةُ المركزيةُ قد يردّه المُعالِج. وذاك
    // تفاوتٌ **مقصودُ الإظهار** لا مسكوتٌ عنه: توسيعُ خدمةِ المشهدِ إلى تلك
    // الأدوارِ قرارُ حَوْكمةٍ في `config/monitoring.yaml` لا قرارُ هذه الخطوة،
    // وهو مُدرَجٌ حدّاً معلَناً في `docs/API_LAYER.md`.
    /** @type {unknown} */
    let data;
    try {
      data = await monitor.read(route.view, {
        actor: session.actorId,
        method: route.call,
        ...params,
      });
    } catch (error) {
      throw new ApiError(
        API_ERRORS.HANDLER_REFUSED,
        `مشهدُ «${route.view}» ردّ النداءَ على المسار ${route.id}: ${errorText(error)}`,
        { handlerCode: codeOf(error), view: route.view },
      );
    }
    return Object.freeze({
      route: route.id,
      status: /** @type {const} */ ('ok'),
      policyId: decision.policyId,
      session: session.id,
      data,
    });
  }

  /**
   * @param {string} resource
   * @returns {[string, string]}
   */
  #splitResource(resource) {
    const index = resource.indexOf(':');
    return [resource.slice(0, index), resource.slice(index + 1)];
  }

  /**
   * يقرأ وسائطَ النداءِ بحدودِ ما يقبله نداءُ المشهد. والوسيطُ غيرُ المعروفِ
   * **يُرفض** لا يُهمَل: إهمالُه صامتاً يجعل المُنادي يظنّ أنه رشَّح وهو يقرأ الكلّ.
   * @param {ApiRouteSpec} route
   * @param {Record<string, unknown> | undefined} given
   * @returns {Record<string, unknown>}
   */
  #readParams(route, given) {
    const params = given ?? {};
    if (params === null || typeof params !== 'object' || Array.isArray(params)) {
      throw new ApiError(
        API_ERRORS.PARAMS_INVALID,
        'وسائطُ النداءِ يجب أن تكون كائناً؛ وشكلٌ آخرُ طلبٌ لا تُقرأ حدودُه.',
      );
    }
    const allowed =
      route.call === 'findById'
        ? ['id']
        : route.call === 'count'
          ? ['filter']
          : ['filter', 'limit'];
    for (const key of Object.keys(params)) {
      if (!allowed.includes(key)) {
        throw new ApiError(
          API_ERRORS.PARAMS_INVALID,
          `الوسيط «${key}» غيرُ مقبولٍ على النداء ${route.call}؛ والمقبولُ: ${allowed.join(', ')} — والزائدُ يُرفض لا يُهمَل صامتاً.`,
        );
      }
    }
    if (route.call === 'findById') {
      const id = typeof params['id'] === 'string' ? params['id'].trim() : '';
      if (id === '') {
        throw new ApiError(
          API_ERRORS.PARAMS_INVALID,
          `المسار ${route.id} يقرأ صفّاً بمعرّفه، ولا معرّفَ نصّيَّ في الوسائط؛ ومعرّفٌ غائبٌ سؤالٌ لا جواب له.`,
        );
      }
      return { id };
    }
    /** @type {Record<string, unknown>} */
    const out = {};
    if (params['filter'] !== undefined) out['filter'] = params['filter'];
    if (params['limit'] !== undefined) out['limit'] = params['limit'];
    return out;
  }
}
