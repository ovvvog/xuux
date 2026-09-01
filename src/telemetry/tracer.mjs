/**
 * المُتتبِّع — نواةُ القياسِ الموحّدِ في الخطوة `M10.01`.
 *
 * **العيبُ الذي تُغلقه هذه الوحدة:** النداءُ الواحدُ في هذه الدولةِ يمرّ بثلاثِ
 * طبقاتٍ — بوابةُ الواجهةِ (`M9.02`) ثم مشهدُ المراقبةِ (`M9.01`) ثم نداءٌ قارئٌ
 * على مستودعٍ في طبقةِ الاستمراريةِ (`M3`) — وكلُّ طبقةٍ تكتب قيدَها في سجلِّ
 * الأحداثِ، **ولا معرّفَ واحداً يربط القيودَ الثلاثةَ**. فمن قرأ السجلَّ رأى
 * ثلاثةَ أحداثٍ متجاورةٍ في الزمنِ فخمَّن أنها نداءٌ واحد. والتخمينُ ليس رصداً.
 *
 * **الفكرةُ الحاكمة: معرّفُ ارتباطٍ واحدٌ للنداءِ كلِّه، يُوَرَّث ولا يُمرَّر
 * بيدِ المستدعي.** وهذا هو موضعُ الاختيارِ الهندسيِّ في هذه الوحدة: السياقُ
 * ضمنيٌّ عبر `AsyncLocalStorage` من `node:async_hooks` لا وسيطٌ صريحٌ يُمرَّر
 * من دالّةٍ إلى دالّة. ولذلك سببٌ مقيسٌ لا ذوقيّ: الوسيطُ الصريحُ **يُنسى** —
 * فطبقةٌ من ثلاثٍ تُغفل تمريرَه فينشأ أثرٌ ثانٍ لنداءٍ واحدٍ، ولا يظهر الخللُ
 * رفضاً بل يظهر **أثراً ناقصاً يُقرأ على أنه تامّ**. والسياقُ الضمنيُّ لا
 * يُنسى، وثمنُه معلَنٌ في آخرِ هذا الرأس.
 *
 * **الضمانات المُنفَّذة هنا:**
 * - `G-TEL-ONE-TRACE` — معرّفُ الأثرِ يُولَّد في المدى الجذرِ ويُوَرَّث إلى كلِّ
 *   مدًى ينشأ داخلَه؛ ورمزُ `TELEMETRY_CONTEXT_INVALID` لسياقٍ واردٍ مُشوَّه.
 * - `G-TEL-W3C-CONTEXT` — أثرٌ من 32 خانةً ست عشريةً لا كلُّها أصفارٌ، ومدًى من
 *   16 كذلك، و`traceparent` بالنسخةِ `00` يُقرأ ويُكتب؛ وما خالف رُدَّ ولا
 *   يُصلَّح بالظنّ ولا يُبتدأ أثرٌ جديدٌ صامتاً على أنقاضه.
 * - `G-TEL-INJECTED-CLOCK` — الزمنُ من ساعةٍ تُمرَّر؛ و`TELEMETRY_CLOCK_INVALID`
 *   لساعةٍ تُعطي غيرَ عددٍ منتهٍ. ولا ساعةَ نظامٍ في مسارِ القياسِ ألبتة: موضعُ
 *   ساعةِ النظامِ الوحيدُ قيمةٌ افتراضيةٌ في المُنشئ، وحاجزُ الخطوةِ يَعُدُّ
 *   مواضعَها فلا تزيد.
 * - `G-TEL-SPAN-CAP` — فوق سقفِ المدَياتِ المُعلَنِ رفضٌ مُسمّىً
 *   (`TELEMETRY_SPAN_LIMIT_EXCEEDED`) لا إسقاطٌ صامتٌ يُري أثراً ناقصاً تامّاً.
 * - `G-TEL-READ-ONLY-SIGNALS` — `withSpan` يُعيد قيمةَ الدالّةِ المقيسةِ كما هي
 *   ويُعيد رمي خطئها **هو نفسه** بعد تسجيلِ حالةِ المدى؛ فلا خطأُ قياسٍ يُخفي
 *   خطأَ عملٍ، ولا نجاحُ عملٍ يُبطله إخفاقُ قياس.
 *
 * **حدودٌ معلَنة:**
 * 1. **لا صادرَ إلى مُجمِّعٍ خارجيّ** (‏OTLP ولا gRPC ولا HTTP): المدَياتُ
 *    تُجمَع في ذاكرةِ العمليةِ وتُقرأ من `finished()` وتُصدَر إلى مستقبِلٍ
 *    يُمرَّر. والنقلُ دَينُ `M10` نفسِه بخطواتِه التالية، ولا يُدَّعى هنا.
 * 2. **لا تبعيةَ جديدة:** هذا نموذجُ بياناتِ OpenTelemetry ومعيارُ W3C كما هما،
 *    لا حزمةُ `@opentelemetry/*`. وأمنُ سلسلةِ التوريدِ نصُّ `M11.02`.
 * 3. **السياقُ الضمنيُّ لا يعبُر حدَّ العملية:** ما جاوز العمليةَ يُنقل نصّاً في
 *    `traceparent` ويُقرأ بـ`parseTraceparent` — وذاك مِقبضٌ صريحٌ لا ضمنيّ.
 * 4. **ثمنُ السياقِ الضمنيِّ معلَن:** `AsyncLocalStorage` يكلّف في المسارِ الحارِّ
 *    وقد يُفلت في نداءٍ يُغادر السياقَ بحيلةٍ (‏`setTimeout` مُلتقَطٌ قبل الدخول
 *    مثلاً)؛ فالمِقبضُ الصريحُ `startSpan({ parent })` باقٍ لمن أراد أن يربط
 *    يدَه بنفسِه.
 * 5. **العشوائيةُ من `node:crypto`** — والمعرّفُ ليس سرّاً ولا يُشتقّ منه سرّ.
 *
 * @module telemetry/tracer
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import { randomBytes } from 'node:crypto';

/** طولُ معرّفِ الأثرِ بالخانات الست عشرية — معيار W3C Trace Context. */
export const TRACE_ID_HEX_LENGTH = 32;

/** طولُ معرّفِ المدى بالخانات الست عشرية — معيار W3C Trace Context. */
export const SPAN_ID_HEX_LENGTH = 16;

/** النسخةُ الوحيدةُ المقروءةُ من `traceparent`. */
export const TRACEPARENT_VERSION = '00';

const INVALID_TRACE_ID = '0'.repeat(TRACE_ID_HEX_LENGTH);
const INVALID_SPAN_ID = '0'.repeat(SPAN_ID_HEX_LENGTH);

const TRACEPARENT_PATTERN = /^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/;

/** خطأُ المُتتبِّع — يحمل رمزَه من كتالوجِ `TELEMETRY_ERRORS`. */
export class TracerError extends Error {
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
    this.name = 'TracerError';
    this.code = code;
    this.detail = detail;
  }
}

/**
 * @param {string} code
 * @param {string} message
 * @param {Record<string, unknown>} [detail]
 * @returns {never}
 */
function refuse(code, message, detail = {}) {
  throw new TracerError(code, message, detail);
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function textOf(value) {
  if (value instanceof Error) return value.message;
  return typeof value === 'string' ? value : String(value);
}

/**
 * @param {unknown} value
 * @param {number} length
 * @returns {boolean}
 */
function isHexId(value, length) {
  if (typeof value !== 'string' || value.length !== length) return false;
  for (let index = 0; index < value.length; index += 1) {
    const ch = value.charAt(index);
    const isDigit = ch >= '0' && ch <= '9';
    const isLower = ch >= 'a' && ch <= 'f';
    if (!isDigit && !isLower) return false;
  }
  return true;
}

/**
 * معرّفُ أثرٍ صالحٌ: طولٌ ثابتٌ، ست عشريٌّ صغيرُ الحرفِ، وليس أصفاراً كلَّه —
 * فالأصفارُ في المعيارِ **معرّفٌ باطلٌ معلَنٌ** لا معرّفٌ نادر.
 * @param {unknown} value
 * @returns {boolean}
 */
export function isValidTraceId(value) {
  return isHexId(value, TRACE_ID_HEX_LENGTH) && value !== INVALID_TRACE_ID;
}

/**
 * @param {unknown} value
 * @returns {boolean}
 */
export function isValidSpanId(value) {
  return isHexId(value, SPAN_ID_HEX_LENGTH) && value !== INVALID_SPAN_ID;
}

/**
 * @param {number} bytes
 * @returns {string}
 */
function randomHex(bytes) {
  return randomBytes(bytes).toString('hex');
}

/** @returns {string} */
export function newTraceId() {
  let id = randomHex(TRACE_ID_HEX_LENGTH / 2);
  // احتمالُ الأصفارِ كلِّها لا يُحسَب، لكنّ المعيارَ يُبطله صراحةً — والفحصُ
  // أرخصُ من الاعتمادِ على الاحتمال.
  while (id === INVALID_TRACE_ID) id = randomHex(TRACE_ID_HEX_LENGTH / 2);
  return id;
}

/** @returns {string} */
export function newSpanId() {
  let id = randomHex(SPAN_ID_HEX_LENGTH / 2);
  while (id === INVALID_SPAN_ID) id = randomHex(SPAN_ID_HEX_LENGTH / 2);
  return id;
}

/**
 * @typedef {object} SpanContext
 * @property {string} traceId
 * @property {string} spanId
 * @property {string} traceFlags خانتان ست عشريتان؛ `01` معايَنٌ و`00` غيرُ معايَن.
 */

/**
 * يُسلسِل سياقَ مدًى إلى رأسِ `traceparent` بالنسخةِ `00`.
 * @param {SpanContext} context
 * @returns {string}
 */
export function formatTraceparent(context) {
  if (!isValidTraceId(context?.traceId) || !isValidSpanId(context?.spanId)) {
    refuse(
      'TELEMETRY_CONTEXT_INVALID',
      'سياقٌ بمعرّفٍ باطلٍ لا يُسلسَل إلى traceparent؛ ورأسٌ مُشوَّهٌ يُرسَل إلى طرفٍ آخرَ يجعله يبتدئ أثراً ثانياً لنداءٍ واحد.',
      { traceId: context?.traceId, spanId: context?.spanId },
    );
  }
  const flags = /^[0-9a-f]{2}$/.test(context.traceFlags) ? context.traceFlags : '01';
  return `${TRACEPARENT_VERSION}-${context.traceId}-${context.spanId}-${flags}`;
}

/**
 * يقرأ رأسَ `traceparent`. والنسخةُ `00` وحدها مقروءة، وما خالف الصيغةَ رُدَّ
 * بـ`TELEMETRY_CONTEXT_INVALID` — **ولا يُبتدأ أثرٌ جديدٌ صامتاً على أنقاضه**:
 * من فعل ذلك أخفى قطعَ سلسلةِ الارتباطِ بين خدمتين وأظهر أثرين سليمين.
 * @param {unknown} header
 * @returns {SpanContext}
 */
export function parseTraceparent(header) {
  if (typeof header !== 'string') {
    refuse(
      'TELEMETRY_CONTEXT_INVALID',
      'رأسُ traceparent ليس نصّاً؛ والسياقُ الوارِدُ يُقرأ نصّاً بصيغةٍ معلَنةٍ أو يُرَدُّ.',
      { received: typeof header },
    );
  }
  const match = TRACEPARENT_PATTERN.exec(header.trim());
  if (match === null) {
    refuse(
      'TELEMETRY_CONTEXT_INVALID',
      `رأسُ traceparent «${header}» يخالف صيغةَ النسخة 00 (‏00-<32>-<16>-<2>)؛ والنسخةُ 00 وحدها مقروءةٌ هنا، وما خالف لا يُصلَّح بالظنّ.`,
      { header },
    );
  }
  const traceId = /** @type {string} */ (match[1]);
  const spanId = /** @type {string} */ (match[2]);
  const traceFlags = /** @type {string} */ (match[3]);
  if (!isValidTraceId(traceId) || !isValidSpanId(spanId)) {
    refuse(
      'TELEMETRY_CONTEXT_INVALID',
      'رأسُ traceparent يحمل معرّفاً باطلاً (أصفاراً كلَّه)؛ والمعيارُ يُبطله صراحةً فلا يُقبَل أباً لمدًى.',
      { traceId, spanId },
    );
  }
  return Object.freeze({ traceId, spanId, traceFlags });
}

/**
 * @typedef {object} SpanEventRecord
 * @property {string} name
 * @property {number} timeUnixNano
 * @property {Readonly<Record<string, string | number | boolean>>} attributes
 */

/**
 * @typedef {object} FinishedSpan
 * @property {string} name
 * @property {string} kind
 * @property {string} traceId
 * @property {string} spanId
 * @property {string | null} parentSpanId
 * @property {number} startTimeUnixNano
 * @property {number} endTimeUnixNano
 * @property {number} durationMs
 * @property {{ code: 'unset' | 'ok' | 'error', message: string }} status
 * @property {Readonly<Record<string, string | number | boolean>>} attributes
 * @property {ReadonlyArray<SpanEventRecord>} events
 */

/** ملّي ثانيةٍ بالنانوثانية — يُكتب رقماً لا يُخفى في ثابتٍ مبهم. */
const NANOS_PER_MS = 1_000_000;

/**
 * مدًى واحدٌ قيدَ التشغيل. لا يُبنى من خارجِ `Tracer` — ولذلك بانيه لا يُصدَّر.
 */
export class Span {
  /** @type {string} */ #name;
  /** @type {string} */ #kind;
  /** @type {SpanContext} */ #context;
  /** @type {string | null} */ #parentSpanId;
  /** @type {number} */ #startMs;
  /** @type {number | null} */ #endMs = null;
  /** @type {{ code: 'unset' | 'ok' | 'error', message: string }} */
  #status = { code: 'unset', message: '' };
  /** @type {Map<string, string | number | boolean>} */ #attributes = new Map();
  /** @type {SpanEventRecord[]} */ #events = [];
  /** @type {(span: Span) => void} */ #onEnd;
  /** @type {() => number} */ #nowMs;
  /** @type {number} */ #maxAttributes;
  /** @type {number} */ #maxAttributeLength;
  /** @type {readonly string[] | null} */ #declaredAttributes;
  /** @type {boolean} */ #truncated = false;
  /** @type {boolean} */ #dropped = false;

  /**
   * @param {{ name: string, kind: string, context: SpanContext, parentSpanId: string | null, startMs: number, nowMs: () => number, onEnd: (span: Span) => void, maxAttributes: number, maxAttributeLength: number, declaredAttributes: readonly string[] | null }} init
   */
  constructor(init) {
    this.#name = init.name;
    this.#kind = init.kind;
    this.#context = init.context;
    this.#parentSpanId = init.parentSpanId;
    this.#startMs = init.startMs;
    this.#nowMs = init.nowMs;
    this.#onEnd = init.onEnd;
    this.#maxAttributes = init.maxAttributes;
    this.#maxAttributeLength = init.maxAttributeLength;
    this.#declaredAttributes = init.declaredAttributes;
  }

  /** @returns {string} */
  get name() {
    return this.#name;
  }

  /** @returns {SpanContext} */
  get context() {
    return this.#context;
  }

  /** @returns {string} */
  get traceId() {
    return this.#context.traceId;
  }

  /** @returns {string} */
  get spanId() {
    return this.#context.spanId;
  }

  /** @returns {string | null} */
  get parentSpanId() {
    return this.#parentSpanId;
  }

  /** @returns {boolean} */
  get ended() {
    return this.#endMs !== null;
  }

  /** رأسُ `traceparent` لهذا المدى — لمن أراد أن يعبُر به حدَّ العملية. */
  traceparent() {
    return formatTraceparent(this.#context);
  }

  /**
   * يضع وسماً. والوسمُ غيرُ المُعلَنِ في الوثيقةِ يُرَدُّ
   * بـ`TELEMETRY_ATTRIBUTE_UNDECLARED` حين تُمرَّر قائمةُ الوسومِ المُعلَنة؛
   * وفوقَ سقفِ العددِ أو الطولِ **يُقتطَع ويُعلَن اقتطاعُه** في وسمٍ مُعلَنٍ
   * لا يُحذَف صامتاً.
   * @param {string} key
   * @param {string | number | boolean} value
   * @returns {this}
   */
  setAttribute(key, value) {
    if (this.ended) {
      refuse(
        'TELEMETRY_SPAN_ALREADY_ENDED',
        `المدى «${this.#name}» مُنتهٍ ولا يُوسَم بعد انتهائه؛ ووسمٌ يُضاف بعد الطابعِ الأخيرِ وسمٌ يكذب على زمنِه.`,
        { span: this.#name, key },
      );
    }
    const declared = this.#declaredAttributes;
    if (declared !== null && !declared.includes(key)) {
      refuse(
        'TELEMETRY_ATTRIBUTE_UNDECLARED',
        `الوسم «${key}» غيرُ مُعلَنٍ للمدى «${this.#name}» في وثيقةِ القياس؛ ووسمٌ يُخترَع في الكودِ لا يجده قارئُ الوثيقةِ فيقرأ أثراً لا تصفه وثيقتُه.`,
        { span: this.#name, key, declared },
      );
    }
    if (typeof value === 'number' && !Number.isFinite(value)) {
      refuse(
        'TELEMETRY_VALUE_INVALID',
        `قيمةُ الوسم «${key}» ليست عدداً منتهياً؛ وقيمةٌ غيرُ منتهيةٍ في أثرٍ تُقرأ صفراً أو تُسقِط قارئَها.`,
        { span: this.#name, key },
      );
    }
    if (!this.#attributes.has(key) && this.#attributes.size >= this.#maxAttributes) {
      this.#truncated = true;
      this.#dropped = true;
      return this;
    }
    let stored = value;
    if (typeof stored === 'string' && stored.length > this.#maxAttributeLength) {
      stored = stored.slice(0, this.#maxAttributeLength);
      this.#truncated = true;
    }
    this.#attributes.set(key, stored);
    return this;
  }

  /**
   * حدثٌ داخلَ المدى — طابعُه من الساعةِ المُمرَّرةِ نفسِها.
   * @param {string} name
   * @param {Record<string, string | number | boolean>} [attributes]
   * @returns {this}
   */
  addEvent(name, attributes = {}) {
    if (this.ended) {
      refuse(
        'TELEMETRY_SPAN_ALREADY_ENDED',
        `المدى «${this.#name}» مُنتهٍ ولا يُضاف إليه حدثٌ بعد انتهائه.`,
        { span: this.#name, event: name },
      );
    }
    this.#events.push(
      Object.freeze({
        name,
        timeUnixNano: Math.round(this.#readClock() * NANOS_PER_MS),
        attributes: Object.freeze({ ...attributes }),
      }),
    );
    return this;
  }

  /**
   * يُثبِّت حالةَ المدى. و`error` تحمل رسالةَ سببِها كي يُقرأ الإخفاقُ في الأثرِ
   * بلا رجوعٍ إلى سجلٍّ آخر.
   * @param {'ok' | 'error'} code
   * @param {string} [message]
   * @returns {this}
   */
  setStatus(code, message = '') {
    if (this.ended) {
      refuse(
        'TELEMETRY_SPAN_ALREADY_ENDED',
        `المدى «${this.#name}» مُنتهٍ ولا تُبدَّل حالتُه بعد انتهائه.`,
        { span: this.#name },
      );
    }
    this.#status = { code, message };
    return this;
  }

  /**
   * يُغلق المدى. والإغلاقُ مرّةً واحدةً: إغلاقٌ ثانٍ يُرَدُّ
   * بـ`TELEMETRY_SPAN_ALREADY_ENDED` لا يُطيل المدةَ صامتاً.
   * @returns {FinishedSpan}
   */
  end() {
    if (this.ended) {
      refuse(
        'TELEMETRY_SPAN_ALREADY_ENDED',
        `المدى «${this.#name}» أُغلق مرّةً وإغلاقُه ثانيةً يُبدِّل مدّتَه المقيسة؛ فالمدّةُ تُقاس مرّةً أو لا تُقاس.`,
        { span: this.#name, spanId: this.#context.spanId },
      );
    }
    this.#endMs = this.#readClock();
    const record = this.snapshot();
    this.#onEnd(this);
    return record;
  }

  /**
   * صورةٌ مُجمَّدةٌ من المدى بشكلِ نموذجِ بياناتِ OpenTelemetry.
   * @returns {FinishedSpan}
   */
  snapshot() {
    const endMs = this.#endMs ?? this.#startMs;
    /** @type {Record<string, string | number | boolean>} */
    const attributes = {};
    for (const [key, value] of this.#attributes) attributes[key] = value;
    if (this.#truncated) {
      attributes['telemetry.attributes.truncated'] = true;
      if (this.#dropped) attributes['telemetry.attributes.dropped'] = true;
    }
    return Object.freeze({
      name: this.#name,
      kind: this.#kind,
      traceId: this.#context.traceId,
      spanId: this.#context.spanId,
      parentSpanId: this.#parentSpanId,
      startTimeUnixNano: Math.round(this.#startMs * NANOS_PER_MS),
      endTimeUnixNano: Math.round(endMs * NANOS_PER_MS),
      durationMs: endMs - this.#startMs,
      status: Object.freeze({ ...this.#status }),
      attributes: Object.freeze(attributes),
      events: Object.freeze([...this.#events]),
    });
  }

  /** @returns {number} */
  #readClock() {
    const value = this.#nowMs();
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      refuse(
        'TELEMETRY_CLOCK_INVALID',
        'ساعةُ القياسِ أعطت غيرَ عددٍ منتهٍ؛ ومدّةٌ مقيسةٌ بساعةٍ فاسدةٍ رقمٌ يُقرأ ولا يُصدَّق.',
        { span: this.#name },
      );
    }
    return value;
  }
}

/**
 * @typedef {object} TracerOptions
 * @property {() => number} [nowMs] ساعةُ القياسِ بالملّي ثانية. والافتراضُ
 *   `Date.now` **في البانيِ وحده** لا في مسارِ القياس — والاختبارُ يُمرِّر ساعتَه.
 * @property {number} [maxSpansPerTrace]
 * @property {number} [maxAttributesPerSpan]
 * @property {number} [maxAttributeLength]
 * @property {(span: FinishedSpan) => void} [onSpanEnd] مستقبِلُ المدَياتِ
 *   المنتهية — به يُوصَل صادرٌ خارجيٌّ لاحقاً بلا تغييرِ هذه الوحدة.
 * @property {number} [keepFinished] عددُ المدَياتِ المحفوظةِ في الذاكرةِ للقراءة.
 */

/**
 * مُتتبِّعٌ واحدٌ للعملية. المِقبضُ المقصودُ هو `withSpan`: هو الذي يفتح المدى
 * ويُدخله السياقَ الضمنيَّ ويُغلقه في كلِّ الطرقِ — نجاحاً ورفضاً ورمياً — فلا
 * مدًى يبقى مفتوحاً لأن أحداً نسي إغلاقَه في مسارِ الخطأ.
 */
export class Tracer {
  /** @type {AsyncLocalStorage<SpanContext>} */
  #store = new AsyncLocalStorage();
  /** @type {() => number} */ #nowMs;
  /** @type {number} */ #maxSpansPerTrace;
  /** @type {number} */ #maxAttributesPerSpan;
  /** @type {number} */ #maxAttributeLength;
  /** @type {((span: FinishedSpan) => void) | null} */ #onSpanEnd;
  /** @type {FinishedSpan[]} */ #finished = [];
  /** @type {number} */ #keepFinished;
  /** @type {Map<string, number>} */ #spanCounts = new Map();

  /** @param {TracerOptions} [options] */
  constructor(options = {}) {
    this.#nowMs = options.nowMs ?? (() => Date.now());
    this.#maxSpansPerTrace = options.maxSpansPerTrace ?? 128;
    this.#maxAttributesPerSpan = options.maxAttributesPerSpan ?? 32;
    this.#maxAttributeLength = options.maxAttributeLength ?? 512;
    this.#onSpanEnd = options.onSpanEnd ?? null;
    this.#keepFinished = options.keepFinished ?? 1024;
  }

  /** السياقُ النشطُ الآن — أو `null` خارجَ كلِّ مدًى. */
  activeContext() {
    return this.#store.getStore() ?? null;
  }

  /**
   * يبتدئ مدًى. والأبُ يُؤخَذ بهذا الترتيبِ المُعلَن: `parent` الصريحُ إن
   * مُرِّر، ثم السياقُ الضمنيُّ النشطُ، ثم `traceparent` الوارِدُ من خارجِ
   * العملية، ثم أثرٌ جديدٌ. والترتيبُ معلَنٌ كي لا يُسأل عنه في مراجعةٍ.
   * @param {string} name
   * @param {{ kind?: string, parent?: SpanContext | null, traceparent?: string, attributes?: Record<string, string | number | boolean>, declaredAttributes?: readonly string[] | null }} [options]
   * @returns {Span}
   */
  startSpan(name, options = {}) {
    const parent =
      options.parent ??
      this.activeContext() ??
      (typeof options.traceparent === 'string' ? parseTraceparent(options.traceparent) : null);
    const traceId = parent === null ? newTraceId() : parent.traceId;
    const count = (this.#spanCounts.get(traceId) ?? 0) + 1;
    if (count > this.#maxSpansPerTrace) {
      refuse(
        'TELEMETRY_SPAN_LIMIT_EXCEEDED',
        `الأثر ${traceId} بلغ سقفَ المدَياتِ المُعلَنَ ${this.#maxSpansPerTrace}؛ والرفضُ مُسمّىً لا إسقاطٌ صامتٌ — فأثرٌ يُسقِط مدَياتِه بلا بلاغٍ يُقرأ تامّاً وهو ناقص.`,
        { traceId, limit: this.#maxSpansPerTrace, attempted: count },
      );
    }
    this.#spanCounts.set(traceId, count);
    const context = Object.freeze({
      traceId,
      spanId: newSpanId(),
      traceFlags: parent?.traceFlags ?? '01',
    });
    const startMs = this.#readClock(name);
    const span = new Span({
      name,
      kind: options.kind ?? 'internal',
      context,
      parentSpanId: parent === null ? null : parent.spanId,
      startMs,
      nowMs: this.#nowMs,
      onEnd: (ended) => this.#collect(ended),
      maxAttributes: this.#maxAttributesPerSpan,
      maxAttributeLength: this.#maxAttributeLength,
      declaredAttributes: options.declaredAttributes ?? null,
    });
    for (const [key, value] of Object.entries(options.attributes ?? {})) {
      span.setAttribute(key, value);
    }
    return span;
  }

  /**
   * يُشغّل الدالّةَ داخلَ مدًى ويضمن إغلاقَه في كلِّ الطرق. وهو **موضعُ الضمانِ
   * `G-TEL-READ-ONLY-SIGNALS`**: القيمةُ تُعاد كما هي، والخطأُ يُعاد رميُه هو
   * نفسُه بعد تسجيلِ الحالة — لا يُغلَّف ولا يُبدَّل ولا يُخفى.
   * @template T
   * @param {string} name
   * @param {{ kind?: string, parent?: SpanContext | null, traceparent?: string, attributes?: Record<string, string | number | boolean>, declaredAttributes?: readonly string[] | null }} options
   * @param {(span: Span) => Promise<T> | T} fn
   * @returns {Promise<T>}
   */
  async withSpan(name, options, fn) {
    const span = this.startSpan(name, options);
    try {
      const result = await this.#store.run(span.context, () => fn(span));
      span.setStatus('ok');
      return result;
    } catch (error) {
      // الحالةُ تُسجَّل ثم يُعاد رميُ الخطأِ الأصليِّ نفسِه. ولو أخفق تسجيلُ
      // الحالةِ لَبقيَ الخطأُ الأصليُّ هو المرميَّ: القياسُ لا يُبدّل المقيس.
      try {
        span.setStatus('error', textOf(error));
      } catch {
        /* لا يُستبدَل خطأُ القياسِ بخطأِ العمل فيُخفيه */
      }
      throw error;
    } finally {
      try {
        if (!span.ended) span.end();
      } catch {
        /* إغلاقٌ أخفق لا يُبطل نتيجةَ النداءِ المقيس */
      }
    }
  }

  /**
   * المدَياتُ المنتهيةُ المحفوظةُ في الذاكرة — صورٌ مُجمَّدة.
   * @param {{ traceId?: string }} [filter]
   * @returns {ReadonlyArray<FinishedSpan>}
   */
  finished(filter = {}) {
    const rows =
      typeof filter.traceId === 'string'
        ? this.#finished.filter((span) => span.traceId === filter.traceId)
        : [...this.#finished];
    return Object.freeze(rows);
  }

  /** يُفرِغ المحفوظَ في الذاكرةِ — لمن صدَّر ثم أراد أن يُخلي. */
  clear() {
    this.#finished = [];
    this.#spanCounts.clear();
  }

  /**
   * @param {Span} span
   * @returns {void}
   */
  #collect(span) {
    const record = span.snapshot();
    this.#finished.push(record);
    if (this.#finished.length > this.#keepFinished) {
      this.#finished.splice(0, this.#finished.length - this.#keepFinished);
    }
    const sink = this.#onSpanEnd;
    if (sink !== null) {
      try {
        sink(record);
      } catch {
        // مستقبِلٌ يرمي لا يُسقِط النداءَ المقيس؛ وذاك نصُّ
        // `G-TEL-READ-ONLY-SIGNALS`.
      }
    }
  }

  /**
   * @param {string} name
   * @returns {number}
   */
  #readClock(name) {
    const value = this.#nowMs();
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      refuse(
        'TELEMETRY_CLOCK_INVALID',
        `ساعةُ القياسِ أعطت غيرَ عددٍ منتهٍ عند ابتداءِ المدى «${name}»؛ والقياسُ بساعةٍ فاسدةٍ لا يبتدئ.`,
        { span: name },
      );
    }
    return value;
  }
}
