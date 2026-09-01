/**
 * القياسُ الموحّد — الواجهةُ الجامعةُ للخطوة `M10.01`.
 *
 * هذه الوحدةُ تجمع الأشتاتَ الثلاثةَ في مِقبضٍ واحد: **الأثرُ** من
 * `tracer.mjs`، و**المقاييسُ** من `metrics.mjs`، و**السجلُّ المهيكلُ** هنا. وسببُ
 * الجمعِ ليس ترتيباً، بل أن الثلاثةَ بلا رابطٍ ثلاثةُ مصادرَ يُقارَن بعضُها
 * ببعضٍ بالتخمين: مقياسٌ يقول «ارتفع الزمنُ»، وسجلٌّ يقول «وقع خطأٌ»، ولا شيءَ
 * يقول **إنهما النداءُ نفسُه**. فالضمانُ `G-TEL-CORRELATED-LOGS` هو أن كلَّ سطرِ
 * سجلٍّ يُصدَر داخلَ مدًى يحمل `traceId` و`spanId` وأباه — فيُقرأ منسوباً لا
 * مجاوراً.
 *
 * والضمانُ الآخرُ المُنفَّذُ هنا هو `G-TEL-DECLARED-NAMES`: **لا اسمَ إشارةٍ
 * يُخترَع خارجَ `config/telemetry.yaml`.** كلُّ مدًى وكلُّ مقياسٍ وكلُّ مستوى
 * سجلٍّ يُطابَق بالوثيقةِ قبل إصداره، والمخالفُ يُرَدُّ برمزِه لا يُصدَر على
 * علّته. وذاك لأن الإشارةَ المُخترَعةَ لا تظهر خطأً قطُّ — تظهر سلسلةً ثانيةً
 * صامتةً يقرأ منها القارئُ نصفَ الحقيقةِ على أنه كلُّها.
 *
 * **حدودٌ معلَنة:**
 * 1. **لا صادرَ إلى مُجمِّعٍ خارجيّ:** الإشاراتُ تُجمَع في ذاكرةِ العمليةِ
 *    وتُقرأ وتُمرَّر إلى مستقبِلاتٍ تُحقَن. والنقلُ (OTLP) دَينُ خطواتِ `M10`
 *    التالية، ولا يُدَّعى هنا.
 * 2. **ليست هذه حزمةَ `@opentelemetry/*`:** بل نموذجُ بياناتِها ومعيارُ W3C
 *    Trace Context منفَّذَين بلا تبعيةٍ جديدة — والمستودعُ عليه `pg` و`yaml`
 *    وحدَهما، وأمنُ سلسلةِ التوريدِ نصُّ `M11.02` ولم يُنفَّذ بعد.
 * 3. **القياسُ عمليةٌ واحدة:** لا تجميعَ عبر العمليات ولا عبر الأجهزة.
 *
 * @module telemetry/telemetry
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import Ajv2020Default from 'ajv/dist/2020.js';

// وحزمةُ Ajv تُصدِّر صنفَها افتراضاً في ESM، فيُقرأ نوعُه صريحاً وإلا صار «غيرَ
// قابلٍ للإنشاء» في الفحصِ الصارم — كما في عارضِ سجلِّ التدقيقِ وطبقةِ الواجهة.
const Ajv2020 = /** @type {typeof import('ajv/dist/2020.js').Ajv2020} */ (
  /** @type {unknown} */ (Ajv2020Default)
);
import YAML from 'yaml';

import { MetricsRegistry } from './metrics.mjs';
import { Tracer, formatTraceparent, parseTraceparent } from './tracer.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** مجلَّدُ الوثائقِ الافتراضيُّ للقياس. */
export const DEFAULT_TELEMETRY_CONFIG_DIR = path.resolve(HERE, '..', '..', 'config');

/**
 * كتالوجُ رموزِ الرفض. ويقابله في `config/telemetry.yaml` حقلُ `refusalCodes`
 * **في الاتجاهين**، ويحرس التقابلَ الحاجزُ `scripts/guard-telemetry.mjs` (R3):
 * رمزٌ في الكودِ بلا إعلانٍ رمزٌ لا يجده قارئُ الوثيقة، ورمزٌ في الوثيقةِ بلا
 * كودٍ وعدٌ لا يُنفَّذ.
 */
export const TELEMETRY_ERRORS = Object.freeze({
  CONFIG_INVALID: 'TELEMETRY_CONFIG_INVALID',
  SPAN_UNDECLARED: 'TELEMETRY_SPAN_UNDECLARED',
  METRIC_UNDECLARED: 'TELEMETRY_METRIC_UNDECLARED',
  METRIC_KIND_MISMATCH: 'TELEMETRY_METRIC_KIND_MISMATCH',
  VALUE_INVALID: 'TELEMETRY_VALUE_INVALID',
  ATTRIBUTE_UNDECLARED: 'TELEMETRY_ATTRIBUTE_UNDECLARED',
  LEVEL_UNDECLARED: 'TELEMETRY_LEVEL_UNDECLARED',
  CLOCK_INVALID: 'TELEMETRY_CLOCK_INVALID',
  CONTEXT_INVALID: 'TELEMETRY_CONTEXT_INVALID',
  SPAN_ALREADY_ENDED: 'TELEMETRY_SPAN_ALREADY_ENDED',
  SPAN_LIMIT_EXCEEDED: 'TELEMETRY_SPAN_LIMIT_EXCEEDED',
});

/** خطأُ القياسِ برمزٍ مُعلَن. */
export class TelemetryError extends Error {
  /** @type {string} */
  code;
  /** @type {Record<string, unknown>} */
  detail;

  /**
   * @param {string} code
   * @param {string} message
   * @param {Record<string, unknown>} [detail]
   */
  constructor(code, message, detail = {}) {
    super(message);
    this.name = 'TelemetryError';
    this.code = code;
    this.detail = detail;
  }
}

/**
 * @param {string} message
 * @returns {never}
 */
function invalidConfig(message) {
  throw new TelemetryError(TELEMETRY_ERRORS.CONFIG_INVALID, message);
}

/**
 * @param {unknown} error
 * @returns {string}
 */
function errorText(error) {
  if (error instanceof Error) return error.message;
  return typeof error === 'string' ? error : String(error);
}

/**
 * @typedef {object} TelemetrySpanDeclaration
 * @property {string} name
 * @property {string} kind
 * @property {string} emittedIn
 * @property {string} purpose
 * @property {string[]} attributes
 */

/**
 * @typedef {object} TelemetryMetricDeclaration
 * @property {string} name
 * @property {'counter' | 'histogram'} kind
 * @property {string} unit
 * @property {string} purpose
 */

/**
 * @typedef {object} TelemetryGuarantee
 * @property {string} id
 * @property {string} enforcedIn
 * @property {string[]} codes
 * @property {string} statement
 */

/**
 * @typedef {object} TelemetryPolicy
 * @property {number} version
 * @property {string} statement
 * @property {{ mode: 'alwaysOn', statement: string }} sampling
 * @property {{ maxSpansPerTrace: number, maxAttributesPerSpan: number, maxAttributeLength: number, statement: string }} limits
 * @property {{ traceIdField: string, spanIdField: string, parentSpanIdField: string, traceparentHeader: string, traceparentVersion: string, statement: string }} correlation
 * @property {string[]} logLevels
 * @property {TelemetrySpanDeclaration[]} spans
 * @property {TelemetryMetricDeclaration[]} metrics
 * @property {string[]} refusalCodes
 * @property {TelemetryGuarantee[]} guarantees
 */

/**
 * يقرأ وثيقةَ القياسِ ويتحقّق منها بمخطَّطِها ثم بفحوصِ تماسكٍ لا يُعبِّر عنها
 * مخطَّط. **ووثيقةٌ غائبةٌ أو مخالفةٌ توقف التحميلَ** ولا يُبتدأ قياسٌ بأسماءٍ
 * افتراضيةٍ — فقياسٌ يبتدئ بلا وثيقةٍ قياسٌ حدُّه نيّةُ كاتبِه.
 *
 * @param {{ dir?: string }} [options]
 * @returns {TelemetryPolicy}
 */
export function loadTelemetryPolicy(options = {}) {
  const dir = options.dir ?? DEFAULT_TELEMETRY_CONFIG_DIR;
  const schemaDir = fs.existsSync(path.join(dir, 'schemas')) ? dir : DEFAULT_TELEMETRY_CONFIG_DIR;
  const file = path.join(dir, 'telemetry.yaml');
  if (!fs.existsSync(file)) {
    invalidConfig(
      'وثيقةُ القياسِ الموحّدِ غائبة؛ وقياسٌ بلا وثيقةٍ تُعلن مدَياتِه ومقاييسَه وحدودَه قياسٌ يُخترَع فيه الاسمُ عند الحاجةِ فتُقرأ سلسلتان على أنهما واحدة.',
    );
  }
  /** @type {unknown} */
  let raw;
  try {
    raw = YAML.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    invalidConfig(`تعذّرت قراءة telemetry.yaml: ${errorText(error)}`);
  }
  const schemaPath = path.join(schemaDir, 'schemas', 'telemetry.schema.json');
  if (!fs.existsSync(schemaPath)) {
    invalidConfig(
      'مخطَّطُ وثيقةِ القياسِ غائب؛ وبلا مخطَّطٍ يصير إعلانُ الإشاراتِ نصّاً حرّاً كالذي جاء ليمنعه.',
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
    invalidConfig(`telemetry.yaml يخالف مخطَّطه: ${problems}`);
  }
  const parsed = /** @type {TelemetryPolicy} */ (raw);

  // ── فحوصُ تماسكٍ لا يُعبِّر عنها مخطَّط ──

  /** @type {Set<string>} */
  const spanNames = new Set();
  for (const span of parsed.spans) {
    if (spanNames.has(span.name)) {
      invalidConfig(
        `المدى «${span.name}» مُعلَنٌ مرّتين؛ ولا مدَيانِ باسمٍ واحدٍ يُقرأ أحدُهما بوسومِ الآخر.`,
      );
    }
    spanNames.add(span.name);
  }

  /** @type {Set<string>} */
  const metricNames = new Set();
  for (const metric of parsed.metrics) {
    if (metricNames.has(metric.name)) {
      invalidConfig(
        `المقياس «${metric.name}» مُعلَنٌ مرّتين؛ واسمٌ واحدٌ بنوعين مقياسٌ لا يُعرف كيف يُجمَع.`,
      );
    }
    metricNames.add(metric.name);
  }

  const declaredCodes = new Set(parsed.refusalCodes);
  for (const guarantee of parsed.guarantees) {
    for (const code of guarantee.codes) {
      if (!declaredCodes.has(code)) {
        invalidConfig(
          `الضمان ${guarantee.id} يُحيل إلى الرمز ${code} وهو غيرُ مُعلَنٍ في refusalCodes؛ وضمانٌ يَعِد برمزٍ لا وجودَ له وعدٌ لا يُقاس.`,
        );
      }
    }
  }

  /** @type {Set<string>} */
  const guaranteeIds = new Set();
  for (const guarantee of parsed.guarantees) {
    if (guaranteeIds.has(guarantee.id)) {
      invalidConfig(`الضمان ${guarantee.id} مُعلَنٌ مرّتين؛ ولا ضمانانِ برمزٍ واحد.`);
    }
    guaranteeIds.add(guarantee.id);
  }

  if (parsed.limits.maxAttributesPerSpan < 4) {
    invalidConfig('سقفُ الوسومِ أقلُّ من أربعة؛ ومدًى بوسمين لا يصف نداءً.');
  }

  return parsed;
}

/**
 * @typedef {object} TelemetryLogRecord
 * @property {string} level
 * @property {string} message
 * @property {number} timeUnixNano
 * @property {string | null} traceId
 * @property {string | null} spanId
 * @property {string | null} parentSpanId
 * @property {Readonly<Record<string, unknown>>} attributes
 */

/**
 * @typedef {object} TelemetryOptions
 * @property {TelemetryPolicy} [policy] الوثيقةُ المحمَّلةُ سلفاً.
 * @property {string} [dir] مجلَّدُ الوثائقِ حين لا تُمرَّر الوثيقةُ نفسُها.
 * @property {() => number} [now] ساعةُ القياسِ بالملّي ثانية.
 * @property {(record: TelemetryLogRecord) => void} [onLog] مستقبِلُ السجلِّ المهيكل.
 * @property {(span: import('./tracer.mjs').FinishedSpan) => void} [onSpanEnd]
 */

/**
 * الواجهةُ الجامعةُ للقياس. تُبنى مرّةً في التركيب وتُحقَن حيث تُقاس الطبقات؛
 * ولا تستوردها طبقةٌ من طبقةٍ أخرى — **الحقنُ لا الاستيراد**، حفاظاً على أن
 * بوابةَ الواجهةِ لا تستورد من طبقةِ الرصدِ شيئاً في زمنِ التشغيل كما نصَّ
 * رأسُها في `M9.02`.
 */
export class Telemetry {
  /** @type {TelemetryPolicy} */ #policy;
  /** @type {Tracer} */ #tracer;
  /** @type {MetricsRegistry} */ #metrics;
  /** @type {Map<string, TelemetrySpanDeclaration>} */ #spans = new Map();
  /** @type {Set<string>} */ #levels;
  /** @type {(record: TelemetryLogRecord) => void} */ #onLog;
  /** @type {() => number} */ #now;
  /** @type {TelemetryLogRecord[]} */ #logs = [];

  /** @param {TelemetryOptions} [options] */
  constructor(options = {}) {
    this.#policy =
      options.policy ?? loadTelemetryPolicy(options.dir === undefined ? {} : { dir: options.dir });
    for (const span of this.#policy.spans) this.#spans.set(span.name, span);
    this.#levels = new Set(this.#policy.logLevels);
    this.#now = options.now ?? (() => Date.now());
    this.#onLog = options.onLog ?? (() => {});
    this.#metrics = new MetricsRegistry(this.#policy.metrics);
    this.#tracer = new Tracer({
      nowMs: this.#now,
      maxSpansPerTrace: this.#policy.limits.maxSpansPerTrace,
      maxAttributesPerSpan: this.#policy.limits.maxAttributesPerSpan,
      maxAttributeLength: this.#policy.limits.maxAttributeLength,
      ...(options.onSpanEnd === undefined ? {} : { onSpanEnd: options.onSpanEnd }),
    });
  }

  /** الوثيقةُ المعمولُ بها — تُقرأ ولا تُبدَّل. */
  get policy() {
    return this.#policy;
  }

  /** المُتتبِّعُ الخام — لمن أراد `startSpan` بيدِه. */
  get tracer() {
    return this.#tracer;
  }

  /** سجلُّ المقاييس. */
  get metrics() {
    return this.#metrics;
  }

  /** أسماءُ المدَياتِ المُعلَنة. */
  declaredSpanNames() {
    return Object.freeze([...this.#spans.keys()]);
  }

  /**
   * يُشغّل الدالّةَ داخلَ مدًى **مُعلَنِ الاسم**. واسمٌ غيرُ مُعلَنٍ يُرَدُّ
   * بـ`TELEMETRY_SPAN_UNDECLARED` قبل أن يُصدَر — فذاك نصُّ
   * `G-TEL-DECLARED-NAMES`.
   *
   * @template T
   * @param {string} name
   * @param {{ attributes?: Record<string, string | number | boolean>, parent?: import('./tracer.mjs').SpanContext | null, traceparent?: string }} options
   * @param {(span: import('./tracer.mjs').Span) => Promise<T> | T} fn
   * @returns {Promise<T>}
   */
  async span(name, options, fn) {
    const declaration = this.#spans.get(name);
    if (declaration === undefined) {
      throw new TelemetryError(
        TELEMETRY_ERRORS.SPAN_UNDECLARED,
        `المدى «${name}» غيرُ مُعلَنٍ في config/telemetry.yaml؛ ولو أُصدِر لَظهر في الأثرِ اسمٌ لا يجده قارئُ الوثيقةِ ولا يعرف من أيِّ ملفٍ خرج.`,
        { name, declared: this.declaredSpanNames() },
      );
    }
    return this.#tracer.withSpan(
      name,
      {
        kind: declaration.kind,
        declaredAttributes: declaration.attributes,
        ...(options.attributes === undefined ? {} : { attributes: options.attributes }),
        ...(options.parent === undefined ? {} : { parent: options.parent }),
        ...(options.traceparent === undefined ? {} : { traceparent: options.traceparent }),
      },
      fn,
    );
  }

  /**
   * يكتب سطرَ سجلٍّ مهيكلٍ **موسوماً بمعرّفِ الأثرِ النشطِ ومداه** — وذاك نصُّ
   * `G-TEL-CORRELATED-LOGS`. والمستوى غيرُ المُعلَنِ يُرَدُّ
   * بـ`TELEMETRY_LEVEL_UNDECLARED`.
   *
   * @param {string} level
   * @param {string} message
   * @param {Record<string, unknown>} [attributes]
   * @returns {TelemetryLogRecord}
   */
  log(level, message, attributes = {}) {
    if (!this.#levels.has(level)) {
      throw new TelemetryError(
        TELEMETRY_ERRORS.LEVEL_UNDECLARED,
        `مستوى السجل «${level}» غيرُ مُعلَنٍ في config/telemetry.yaml؛ ومستوىً يُخترَع يُفلت من كلِّ ترشيحٍ يُبنى على المستويات.`,
        { level, declared: [...this.#levels] },
      );
    }
    const at = this.#now();
    if (typeof at !== 'number' || !Number.isFinite(at)) {
      throw new TelemetryError(
        TELEMETRY_ERRORS.CLOCK_INVALID,
        'ساعةُ القياسِ أعطت غيرَ عددٍ منتهٍ عند كتابةِ سطرِ سجلٍّ؛ وسطرٌ بزمنٍ فاسدٍ سطرٌ لا يُرتَّب.',
        { level },
      );
    }
    const context = this.#tracer.activeContext();
    /** @type {TelemetryLogRecord} */
    const record = Object.freeze({
      level,
      message,
      timeUnixNano: Math.round(at * 1_000_000),
      traceId: context === null ? null : context.traceId,
      spanId: context === null ? null : context.spanId,
      parentSpanId: null,
      attributes: Object.freeze({ ...attributes }),
    });
    this.#logs.push(record);
    try {
      this.#onLog(record);
    } catch {
      // مستقبِلُ سجلٍّ يرمي لا يُسقِط النداءَ المقيس — `G-TEL-READ-ONLY-SIGNALS`.
    }
    return record;
  }

  /**
   * @param {{ traceId?: string }} [filter]
   * @returns {ReadonlyArray<TelemetryLogRecord>}
   */
  logs(filter = {}) {
    const rows =
      typeof filter.traceId === 'string'
        ? this.#logs.filter((row) => row.traceId === filter.traceId)
        : [...this.#logs];
    return Object.freeze(rows);
  }

  /**
   * المدَياتُ المنتهية.
   * @param {{ traceId?: string }} [filter]
   */
  finishedSpans(filter = {}) {
    return this.#tracer.finished(filter);
  }

  /** السياقُ النشطُ — أو `null` خارجَ كلِّ مدًى. */
  activeContext() {
    return this.#tracer.activeContext();
  }

  /**
   * رأسُ `traceparent` للسياقِ النشط — أو `null` خارجَ كلِّ مدًى. وبه يعبُر
   * الأثرُ حدَّ العمليةِ نصّاً.
   * @returns {string | null}
   */
  activeTraceparent() {
    const context = this.#tracer.activeContext();
    return context === null ? null : formatTraceparent(context);
  }

  /**
   * يقرأ سياقاً وارِداً من رأسِ `traceparent`.
   * @param {unknown} header
   */
  contextFromTraceparent(header) {
    return parseTraceparent(header);
  }

  /** يُفرِغ ما جُمِع في الذاكرة. */
  clear() {
    this.#tracer.clear();
    this.#metrics.clear();
    this.#logs = [];
  }
}

/**
 * يبني قياساً من الوثيقةِ مباشرة — مِقبضٌ مختصرٌ للتركيب.
 * @param {TelemetryOptions} [options]
 * @returns {Telemetry}
 */
export function createTelemetry(options = {}) {
  return new Telemetry(options);
}
