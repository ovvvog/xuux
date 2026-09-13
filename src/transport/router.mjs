/**
 * جدولُ المساراتِ **مُشتَقٌّ** من `config/api.yaml` لا مكتوبٌ يداً — سدادُ `D-1`.
 *
 * هذا هو العهدُ الأوّلُ في `PRODUCT_BUILD_PLAN.md`، وسببُه أنّ جدولاً مكتوباً يداً
 * يفترقُ عن الوثيقةِ في أوّلِ تعديلٍ: يُضافُ مسارٌ في الوثيقةِ فلا يُخدَمُ، أو
 * يُحذَفُ منها فيبقى مخدوماً — وهذا الثاني ثغرةٌ لا سهوٌ. فما لم تُعلِنْه الوثيقةُ
 * **لا وجودَ له على السلكِ**، ولا سطرَ في هذا الملفِّ يذكرُ عنواناً واحداً.
 *
 * ومبادئُ المطابقةِ الثلاثةُ:
 *
 * 1. **الحرفُ يسبقُ المُتغيِّرَ:** `/state/agents/count` و`/state/agents/:id`
 *    كلاهما يطابقُ `/state/agents/count`. فلو رُتِّبَ بترتيبِ الوثيقةِ لقُرِئَ
 *    «count» معرّفَ هويّةٍ. فالتفضيلُ **بعددِ المقاطعِ الحرفيّةِ** لا بترتيبِ
 *    الظهورِ، والغموضُ الباقي يُفشِلُه الحاجزُ لا يَحُلُّه التخمينُ.
 * 2. **لا فعلَ إلا `GET` للقراءةِ و`POST` للكتابةِ السياديّةِ:** قراءةٌ من
 *    `config/api.yaml` (`GET` وحدَه) وكتابةٌ من `config/royal-console.yaml`
 *    (`POST` وحدَه). و`scripts/guard-api.mjs` يَرُدُّ أيَّ مسارٍ قارئٍ فعلُه غيرُ
 *    `GET`. والكتابةُ من الواجهةِ أمرٌ ملكيٌّ موقَّعٌ (`M9.03`) ولا تُفتَحُ إلا من
 *    مسارٍ مُشتَقٍّ من وثيقةِ الديوان.
 * 3. **المُتغيِّرُ لا يعبرُ مقطعاً:** `:id` يطابقُ مقطعاً واحداً لا يحملُ `/`،
 *    فلا يَبلعُ مسارٌ واحدٌ شجرةً كاملةً.
 */

import { loadApiPolicy } from '../api/index.mjs';
import { loadConsolePolicy } from '../console/index.mjs';

import { TRANSPORT_ERRORS } from './problem.mjs';

/** خطأُ طبقةِ النقلِ برمزٍ مُعلَنٍ. */
export class TransportError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   */
  constructor(code, message) {
    super(message);
    this.name = 'TransportError';
    this.code = code;
  }
}

/**
 * @typedef {object} CompiledRoute
 * @property {string} id معرّفُ المسارِ في الوثيقةِ — وهو ما يُمرَّرُ إلى البوابةِ.
 * @property {string} method
 * @property {string} path العنوانُ كما أُعلِنَ.
 * @property {string} call نداءُ المشهدِ (`list` أو `findById` أو `count`).
 * @property {ReadonlyArray<{ literal: string | null, name: string | null }>} segments
 * @property {number} literals عددُ المقاطعِ الحرفيّةِ — به يُرتَّبُ التفضيلُ.
 */

/**
 * يُقسِّمُ عنواناً مُعلَناً إلى مقاطعَ حرفيّةٍ ومُتغيِّرةٍ.
 * @param {string} declared
 * @returns {{ segments: Array<{ literal: string | null, name: string | null }>, literals: number }}
 */
function compilePath(declared) {
  /** @type {Array<{ literal: string | null, name: string | null }>} */
  const segments = [];
  let literals = 0;
  for (const part of declared.split('/')) {
    if (part === '') continue;
    if (part.startsWith(':')) {
      segments.push({ literal: null, name: part.slice(1) });
    } else {
      segments.push({ literal: part, name: null });
      literals += 1;
    }
  }
  return { segments, literals };
}

/**
 * يبني جدولَ المساراتِ من الوثيقةِ. **مصدرُ الجدولِ الوثيقةُ وحدَها.**
 * @param {{ policy?: ReturnType<typeof loadApiPolicy>, dir?: string }} [options]
 * @returns {ReadonlyArray<CompiledRoute>}
 */
export function compileRoutes(options = {}) {
  const policy =
    options.policy ?? loadApiPolicy(options.dir === undefined ? {} : { dir: options.dir });
  /** @type {CompiledRoute[]} */
  const compiled = [];
  for (const route of policy.routes) {
    // فعلٌ غيرُ `GET` **لا يُخدَمُ ولا يُتجاهَلُ صامتاً**: وجودُه في الوثيقةِ
    // خِلافٌ بينها وبين حاجزِها، فيُرفَعُ صراحةً لا يُمرَّرُ.
    if (route.method !== 'GET') {
      throw new TransportError(
        TRANSPORT_ERRORS.METHOD_NOT_ALLOWED,
        `المسارُ ${route.id} مُعلَنٌ بفعلٍ ${route.method}، وهذه الطبقةُ قارئةٌ فقط.`,
      );
    }
    const { segments, literals } = compilePath(route.path);
    compiled.push({
      id: route.id,
      method: route.method,
      path: route.path,
      call: route.call,
      segments,
      literals,
    });
  }
  // الأكثرُ حرفيّةً أوّلاً، ثمَّ الأطولُ مقاطعَ: هكذا يسبقُ `count` المُتغيِّرَ.
  compiled.sort((a, b) => b.literals - a.literals || b.segments.length - a.segments.length);
  return Object.freeze(compiled);
}

/**
 * يُطابِقُ عنواناً واردَاً بجدولٍ مُشتَقٍّ.
 * @param {ReadonlyArray<CompiledRoute>} routes
 * @param {string} method
 * @param {string} pathname
 * @returns {{ route: CompiledRoute, pathParams: Record<string, string> } | null}
 */
export function matchRoute(routes, method, pathname) {
  const parts = pathname.split('/').filter((part) => part !== '');
  for (const route of routes) {
    if (route.segments.length !== parts.length) continue;
    /** @type {Record<string, string>} */
    const pathParams = {};
    let matched = true;
    for (let index = 0; index < route.segments.length; index += 1) {
      const segment = route.segments[index];
      const part = parts[index];
      if (segment === undefined || part === undefined) {
        matched = false;
        break;
      }
      if (segment.literal !== null) {
        if (segment.literal !== part) {
          matched = false;
          break;
        }
      } else if (part === '') {
        matched = false;
        break;
      } else {
        pathParams[/** @type {string} */ (segment.name)] = decodeURIComponent(part);
      }
    }
    if (!matched) continue;
    // العنوانُ طابقَ والفعلُ لا: هذا `405` لا `404` — فالمورِدُ موجودٌ والفعلُ مُنكَرٌ.
    if (route.method !== method) {
      throw new TransportError(
        TRANSPORT_ERRORS.METHOD_NOT_ALLOWED,
        `المسارُ ${route.path} قارئٌ فقط، والفعلُ ${method} غيرُ مُعلَنٍ عليه.`,
      );
    }
    return { route, pathParams };
  }
  return null;
}

/**
 * يبني جدولَ مساراتِ الكتابةِ السياديّةِ من وثيقةِ الديوانِ — **مصدرُ الجدولِ
 * الوثيقةُ وحدَها**، كقرينِها من `config/api.yaml`.
 *
 * كلُّ أمرٍ مُعلَنٍ في `config/royal-console.yaml` يُشتَقُّ منه مسارُ `POST` واحدٌ
 * على `/state/console/<action>`، فلا يُخدَمُ أمرٌ غيرُ مُعلَنٍ، ولا يُخدَمُ مسارٌ
 * غيرُ مُشتَقٍّ. و`action` فريدٌ لكلِّ أمرٍ (يُفحَصُ في `loadConsolePolicy`)، فلا
 * غموضَ في المطابقة.
 *
 * والجدولُ الناتجُ يُدمَجُ مع جدولِ القراءةِ في الخادمِ، فيطابقُ `matchRoute`
 * المسارَ والفعلَ معاً: `GET` للقراءةِ و`POST` للكتابةِ.
 * @param {{ policy?: ReturnType<typeof loadConsolePolicy>, dir?: string }} [options]
 * @returns {ReadonlyArray<CompiledRoute>}
 */
export function compileCommandRoutes(options = {}) {
  const policy =
    options.policy ?? loadConsolePolicy(options.dir === undefined ? {} : { dir: options.dir });
  /** @type {CompiledRoute[]} */
  const compiled = [];
  for (const command of policy.commands) {
    const path = '/' + ['state', 'console', command.action].join('/');
    const { segments, literals } = compilePath(path);
    compiled.push({
      id: command.id,
      method: 'POST',
      path,
      call: 'command',
      segments,
      literals,
    });
  }
  compiled.sort((a, b) => b.literals - a.literals || b.segments.length - a.segments.length);
  return Object.freeze(compiled);
}

/**
 * يترجمُ العنوانَ ومُلحقاتِه إلى وُسطاءِ نداءٍ **بحدودِ ما تقبلُه البوابةُ**.
 *
 * والحدودُ ليست مُخترَعةً هنا: `#readParams` في البوابةِ يقبلُ `id` لـ`findById`،
 * و`filter` لـ`count`، و`filter` و`limit` لـ`list`، **ويَرُدُّ الزائدَ لا
 * يُهمِلُه**. فطبقةُ النقلِ تُطبِّقُ الحدَّ نفسَه على مُلحقاتِ الاستعلامِ كي يكونَ
 * الرفضُ واحداً في الطبقتَينِ، ولا يظنَّ المُنادي أنّه رشَّحَ وهو يقرأُ الكلَّ.
 * @param {CompiledRoute} route
 * @param {Record<string, string>} pathParams
 * @param {URLSearchParams} query
 * @returns {Record<string, unknown>}
 */
export function paramsFor(route, pathParams, query) {
  if (route.call === 'findById') {
    // مُلحقُ استعلامٍ على قراءةِ صفٍّ واحدٍ زائدٌ: يُرَدُّ لا يُهمَلُ.
    if ([...query.keys()].length > 0) {
      throw new TransportError(
        TRANSPORT_ERRORS.BODY_NOT_ALLOWED,
        'قراءةُ صفٍّ بمعرّفِه لا تقبلُ مُلحقاتِ استعلامٍ.',
      );
    }
    return { id: pathParams['id'] ?? '' };
  }
  const allowed = route.call === 'count' ? ['filter'] : ['filter', 'limit'];
  /** @type {Record<string, unknown>} */
  const params = {};
  for (const key of query.keys()) {
    if (!allowed.includes(key)) {
      throw new TransportError(
        TRANSPORT_ERRORS.BODY_NOT_ALLOWED,
        `المُلحقُ «${key}» غيرُ مقبولٍ على النداءِ ${route.call}؛ والمقبولُ: ${allowed.join(', ')}.`,
      );
    }
  }
  const filter = query.get('filter');
  if (filter !== null) {
    // الترشيحُ كائنٌ عند البوابةِ، ونصٌّ على السلكِ. فيُقرأُ JSON صراحةً ويَفشلُ
    // مُغلَقاً إن لم يكنْ كائناً — لا يُمرَّرُ نصّاً فتُقرأَ حدودُه على غيرِ وجهِها.
    /** @type {unknown} */
    let parsed;
    try {
      parsed = JSON.parse(filter);
    } catch {
      throw new TransportError(
        TRANSPORT_ERRORS.BODY_NOT_ALLOWED,
        'المُلحقُ `filter` يجب أن يكونَ كائنَ JSON.',
      );
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new TransportError(
        TRANSPORT_ERRORS.BODY_NOT_ALLOWED,
        'المُلحقُ `filter` يجب أن يكونَ كائنَ JSON.',
      );
    }
    params['filter'] = parsed;
  }
  const limit = query.get('limit');
  if (limit !== null) {
    if (!/^[0-9]+$/.test(limit)) {
      throw new TransportError(
        TRANSPORT_ERRORS.BODY_NOT_ALLOWED,
        'المُلحقُ `limit` يجب أن يكونَ عدداً صحيحاً غيرَ سالبٍ.',
      );
    }
    params['limit'] = Number.parseInt(limit, 10);
  }
  return params;
}
