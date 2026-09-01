/**
 * المقاييس — الشقُّ الثاني من القياسِ الموحّدِ في `M10.01`.
 *
 * **العيبُ الذي تُغلقه هذه الوحدة:** الأثرُ يجيب عن «أين ذهب هذا النداء»،
 * ولا يجيب عن «كم نداءً، وكم استغرقت، وكم رُفض ولماذا». وتلك أسئلةٌ تُجاب
 * بأعدادٍ مُجمَّعةٍ لا بآثارٍ مفردة. والخطرُ ها هنا ليس في الجمع بل في
 * **الأسماء**: عدّادٌ يُنشأ باسمٍ مطبوعٍ خطأً في موضعٍ من الكودِ يُنشئ سلسلةً
 * ثانيةً صامتةً، فيقرأ القارئُ نصفَ العددِ على أنه كلُّه — **ولا يظهر ذلك خطأً
 * قطُّ**، بل يظهر انخفاضاً في المنحنى يُفسَّر تحسّناً.
 *
 * **فالقاعدة: لا مقياسَ يُخترَع خارجَ الوثيقة، ولا نوعُ مقياسٍ يُبدَّل.** كلُّ
 * اسمٍ يُطابَق بـ`config/telemetry.yaml` قبل الجمع، وعدّادٌ يُنادى مدرجاً
 * تكراريّاً يُرَدُّ بـ`TELEMETRY_METRIC_KIND_MISMATCH` لا يُقبَل على تسامح.
 *
 * والضمانُ المُنفَّذُ هنا هو شقُّ المقاييسِ من `G-TEL-DECLARED-NAMES`.
 *
 * **حدودٌ معلَنة:**
 * 1. المدرجُ التكراريُّ يحفظ **العدَّ والمجموعَ وأصغرَ قيمةٍ وأكبرَها والقيمَ
 *    نفسَها بحدٍّ أقصى** — لا حِزَماً (buckets) بحدودٍ مُعلَنةٍ كما في OTLP.
 *    والنسبُ المئويةُ تُحسَب من القيمِ المحفوظةِ فهي دقيقةٌ ما لم يُتجاوَز الحدُّ،
 *    وتقريبيةٌ بعده. وهذا حدٌّ يُغلَق حين يُوصَل صادرٌ خارجيّ.
 * 2. لا تجميعَ عبر العمليات: هذه أعدادُ عمليةٍ واحدة.
 *
 * @module telemetry/metrics
 */

/** أقصى ما يُحفَظ من قيمِ مدرجٍ تكراريٍّ واحدٍ في الذاكرة. */
const MAX_HISTOGRAM_SAMPLES = 2048;

/** خطأُ المقاييس — يحمل رمزَه من كتالوجِ `TELEMETRY_ERRORS`. */
export class MetricsError extends Error {
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
    this.name = 'MetricsError';
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
  throw new MetricsError(code, message, detail);
}

/**
 * @typedef {object} MetricDeclaration
 * @property {string} name
 * @property {'counter' | 'histogram'} kind
 * @property {string} unit
 * @property {string} purpose
 */

/**
 * @typedef {object} CounterReading
 * @property {string} name
 * @property {'counter'} kind
 * @property {string} unit
 * @property {number} value
 * @property {Readonly<Record<string, string>>} attributes
 */

/**
 * @typedef {object} HistogramReading
 * @property {string} name
 * @property {'histogram'} kind
 * @property {string} unit
 * @property {number} count
 * @property {number} sum
 * @property {number} min
 * @property {number} max
 * @property {Readonly<Record<string, string>>} attributes
 */

/**
 * مفتاحٌ ثابتٌ لسلسلةٍ واحدة: الاسمُ ثم وسومُه مرتّبةً بالاسم — فالترتيبُ
 * المُثبَّتُ يمنع أن يُنشئ ترتيبان مختلفان للوسومِ نفسِها سلسلتين.
 * @param {string} name
 * @param {Record<string, string>} attributes
 * @returns {string}
 */
function seriesKey(name, attributes) {
  const keys = Object.keys(attributes).sort();
  const parts = keys.map((key) => `${key}=${attributes[key]}`);
  return parts.length === 0 ? name : `${name}|${parts.join(',')}`;
}

/**
 * @param {Record<string, string | number | boolean>} attributes
 * @returns {Record<string, string>}
 */
function normalizeAttributes(attributes) {
  /** @type {Record<string, string>} */
  const out = {};
  for (const [key, value] of Object.entries(attributes)) out[key] = String(value);
  return out;
}

/**
 * سجلُّ المقاييس. لا يُنشئ أداةً إلا لاسمٍ مُعلَن، ولا يقبل نداءً بنوعٍ يخالف
 * نوعَ الاسمِ المُعلَن.
 */
export class MetricsRegistry {
  /** @type {Map<string, MetricDeclaration>} */ #declared = new Map();
  /** @type {Map<string, { name: string, attributes: Record<string, string>, value: number }>} */
  #counters = new Map();
  /** @type {Map<string, { name: string, attributes: Record<string, string>, values: number[], count: number, sum: number, min: number, max: number }>} */
  #histograms = new Map();

  /** @param {ReadonlyArray<MetricDeclaration>} declarations */
  constructor(declarations) {
    for (const declaration of declarations) this.#declared.set(declaration.name, declaration);
  }

  /** أسماءُ المقاييسِ المُعلَنةِ — تُقرأ ولا تُبدَّل. */
  declaredNames() {
    return Object.freeze([...this.#declared.keys()]);
  }

  /**
   * @param {string} name
   * @param {'counter' | 'histogram'} kind
   * @returns {MetricDeclaration}
   */
  #require(name, kind) {
    const declaration = this.#declared.get(name);
    if (declaration === undefined) {
      refuse(
        'TELEMETRY_METRIC_UNDECLARED',
        `المقياس «${name}» غيرُ مُعلَنٍ في config/telemetry.yaml؛ واسمٌ يُخترَع في الكودِ يُنشئ سلسلةً صامتةً يقرأ منها القارئُ نصفَ العددِ على أنه كلُّه.`,
        { name, declared: this.declaredNames() },
      );
    }
    if (declaration.kind !== kind) {
      refuse(
        'TELEMETRY_METRIC_KIND_MISMATCH',
        `المقياس «${name}» مُعلَنٌ «${declaration.kind}» ونودي «${kind}»؛ ونوعٌ يُبدَّل يجعل مجموعَ المدّاتِ يُقرأ عدّاداً أو العكس.`,
        { name, declaredKind: declaration.kind, usedKind: kind },
      );
    }
    return declaration;
  }

  /**
   * يزيد عدّاداً. والزيادةُ عددٌ منتهٍ غيرُ سالبٍ — فعدّادٌ ينقص ليس عدّاداً.
   * @param {string} name
   * @param {number} [value]
   * @param {Record<string, string | number | boolean>} [attributes]
   * @returns {void}
   */
  addCounter(name, value = 1, attributes = {}) {
    this.#require(name, 'counter');
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
      refuse(
        'TELEMETRY_VALUE_INVALID',
        `زيادةُ العدّاد «${name}» يجب أن تكون عدداً منتهياً غيرَ سالب؛ وعدّادٌ ينقص أو يُزاد بلانهايةٍ عدّادٌ لا يُقرأ.`,
        { name, value },
      );
    }
    const normalized = normalizeAttributes(attributes);
    const key = seriesKey(name, normalized);
    const current = this.#counters.get(key);
    if (current === undefined) {
      this.#counters.set(key, { name, attributes: normalized, value });
      return;
    }
    current.value += value;
  }

  /**
   * يسجّل قيمةً في مدرجٍ تكراريّ. والقيمُ السالبةُ مقبولةٌ في المدرجِ لأن منه ما
   * يقيس فروقاً، والمردودُ غيرُ المنتهي وحدَه.
   * @param {string} name
   * @param {number} value
   * @param {Record<string, string | number | boolean>} [attributes]
   * @returns {void}
   */
  recordHistogram(name, value, attributes = {}) {
    this.#require(name, 'histogram');
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      refuse(
        'TELEMETRY_VALUE_INVALID',
        `قيمةُ المدرج «${name}» يجب أن تكون عدداً منتهياً؛ وقيمةٌ غيرُ منتهيةٍ تُفسِد المجموعَ والنسبَ كلَّها بعدها.`,
        { name, value },
      );
    }
    const normalized = normalizeAttributes(attributes);
    const key = seriesKey(name, normalized);
    const current = this.#histograms.get(key);
    if (current === undefined) {
      this.#histograms.set(key, {
        name,
        attributes: normalized,
        values: [value],
        count: 1,
        sum: value,
        min: value,
        max: value,
      });
      return;
    }
    current.count += 1;
    current.sum += value;
    if (value < current.min) current.min = value;
    if (value > current.max) current.max = value;
    if (current.values.length < MAX_HISTOGRAM_SAMPLES) current.values.push(value);
  }

  /**
   * قراءةُ عدّادٍ بعينِه — أو صفرٌ إن لم يُنادَ بعد بهذه الوسوم.
   * @param {string} name
   * @param {Record<string, string | number | boolean>} [attributes]
   * @returns {number}
   */
  counterValue(name, attributes = {}) {
    this.#require(name, 'counter');
    const key = seriesKey(name, normalizeAttributes(attributes));
    return this.#counters.get(key)?.value ?? 0;
  }

  /**
   * النسبةُ المئويةُ المطلوبةُ من مدرجٍ — تُحسَب من القيمِ المحفوظة.
   * @param {string} name
   * @param {number} percentile عددٌ بين 0 و100.
   * @param {Record<string, string | number | boolean>} [attributes]
   * @returns {number | null}
   */
  percentile(name, percentile, attributes = {}) {
    this.#require(name, 'histogram');
    if (typeof percentile !== 'number' || !Number.isFinite(percentile)) {
      refuse('TELEMETRY_VALUE_INVALID', 'النسبةُ المئويةُ يجب أن تكون عدداً منتهياً.', {
        name,
        percentile,
      });
    }
    const key = seriesKey(name, normalizeAttributes(attributes));
    const series = this.#histograms.get(key);
    if (series === undefined || series.values.length === 0) return null;
    const sorted = [...series.values].sort((a, b) => a - b);
    const bounded = Math.min(100, Math.max(0, percentile));
    const index = Math.min(sorted.length - 1, Math.floor((bounded / 100) * sorted.length));
    return /** @type {number} */ (sorted[index]);
  }

  /**
   * كلُّ القراءاتِ صورةً مُجمَّدةً — بها يُصدَّر إلى مُجمِّعٍ خارجيٍّ لاحقاً.
   * @returns {{ counters: ReadonlyArray<CounterReading>, histograms: ReadonlyArray<HistogramReading> }}
   */
  snapshot() {
    /** @type {CounterReading[]} */
    const counters = [];
    for (const series of this.#counters.values()) {
      const declaration = /** @type {MetricDeclaration} */ (this.#declared.get(series.name));
      counters.push(
        Object.freeze({
          name: series.name,
          kind: /** @type {'counter'} */ ('counter'),
          unit: declaration.unit,
          value: series.value,
          attributes: Object.freeze({ ...series.attributes }),
        }),
      );
    }
    /** @type {HistogramReading[]} */
    const histograms = [];
    for (const series of this.#histograms.values()) {
      const declaration = /** @type {MetricDeclaration} */ (this.#declared.get(series.name));
      histograms.push(
        Object.freeze({
          name: series.name,
          kind: /** @type {'histogram'} */ ('histogram'),
          unit: declaration.unit,
          count: series.count,
          sum: series.sum,
          min: series.min,
          max: series.max,
          attributes: Object.freeze({ ...series.attributes }),
        }),
      );
    }
    return Object.freeze({
      counters: Object.freeze(counters),
      histograms: Object.freeze(histograms),
    });
  }

  /** يُفرِغ القراءاتِ — لمن صدَّر ثم أراد أن يُخلي. */
  clear() {
    this.#counters.clear();
    this.#histograms.clear();
  }
}
