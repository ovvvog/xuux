/**
 * مستوياتُ الخدمة — الواجهةُ الجامعةُ للخطوة `M10.02`.
 *
 * **العيبُ الذي تُغلقه هذه الوحدة:** بعد `M10.01` صار للنداءِ الواحدِ أثرٌ
 * واحدٌ وصارت خمسةُ مقاييسَ تُجمَع بأسماءٍ مُعلَنة. فمن سأل «كم نداءً وكم
 * استغرق وكم رُفض؟» وجد جوابَه رقماً. **ومن سأل «وهل هذا الرقمُ مقبول؟» لم يجد
 * شيئاً.** والمقياسُ بلا هدفٍ مُعلَنٍ رقمٌ يُقرأ بمزاجِ قارئِه، والتدهورُ
 * التدريجيُّ تحته غيرُ مرئيٍّ لأنه لا يقع في يومٍ بعينه فيُنبِّه.
 *
 * **فالقاعدة: لا مقياسَ بلا هدفٍ يُقاس عليه، ولا رقمَ يُقاس مرّتين من
 * مصدرين.** فهذه الوحدةُ **لا تقيس شيئاً من عندها**: تقرأ سجلَّ مقاييسِ
 * `M10.01` نفسَه (`MetricsRegistry`) وتحسب عليه الالتزامَ والانحرافَ
 * والميزانية. ومن لم يُمرَّر إليه سجلٌّ رُدَّ بـ`SLO_METRICS_REQUIRED` ولم
 * يُعطَ لوحةً صفريةً تُقرأ قياساً — فالصفرُ بلا مصدرٍ كذبٌ مُطمئنّ، وهو نفسُ
 * اختيارِ لوحاتِ `M9.05`.
 *
 * **والأهدافُ بياناتٌ لا كود:** لا رقمَ هدفٍ ولا عتبةَ زمنٍ مكتوبةٌ في هذا
 * الملفِّ، ويحرس ذلك `scripts/guard-service-levels.mjs` نصّاً (R5). فتشديدُ
 * هدفٍ سطرٌ في `config/service-levels.yaml` يظهر أثرُه في فرقِ الالتزام.
 *
 * والضماناتُ المُنفَّذةُ هنا: `G-SLO-DECLARED-SIGNALS` و`G-SLO-NO-ORPHAN-METRIC`
 * و`G-SLO-NO-EMPTY-SUCCESS` و`G-SLO-OBJECTIVES-ARE-DATA` و`G-SLO-SINGLE-SOURCE`
 * و`G-SLO-INJECTED-CLOCK` و`G-SLO-READ-ONLY`؛ وضمانُ الميزانيةِ
 * `G-SLO-BUDGET-FROM-OBJECTIVE` منفَّذٌ في `budget.mjs`.
 *
 * **حدودٌ معلَنة:**
 * 1. **النافذةُ عمرُ العملية** لا مدّةٌ تقويمية: العدّاداتُ في ذاكرةِ العمليةِ
 *    تزول بإعادةِ تشغيلِها، فلا «آخرَ ثلاثين يوماً» يُدَّعى هنا. ويُعرض عمرُ
 *    النافذةِ المقيسُ في اللوحةِ ليُقرأ الرقمُ على مداه.
 * 2. **لا تنبيهَ ولا تصعيدَ ولا تجميدَ نشرٍ**: الاستنفادُ حكمٌ يُعرض ورفضٌ
 *    يُرَدُّ به مِقبضُ التأكيد؛ والقناةُ نصُّ `M10.03` والنشرُ نصُّ `M10.06`
 *    ولا يُدَّعى واحدٌ منهما هنا.
 * 3. **لا قدرةَ بلا مقياس**: القدراتُ المُعلَنةُ هي ما له مقياسٌ مُصدَرٌ من
 *    موضعِه فعلاً بعد `M10.01`، وما لم يُقَس لم يُعلَن له هدفٌ.
 *
 * @module service-levels/service-levels
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import Ajv2020Default from 'ajv/dist/2020.js';

// وحزمةُ Ajv تُصدِّر صنفَها افتراضاً في ESM، فيُقرأ نوعُه صريحاً وإلا صار «غيرَ
// قابلٍ للإنشاء» في الفحصِ الصارم — كما في طبقةِ القياسِ تحتَها.
const Ajv2020 = /** @type {typeof import('ajv/dist/2020.js').Ajv2020} */ (
  /** @type {unknown} */ (Ajv2020Default)
);
import YAML from 'yaml';

import { attainment, deviation, errorBudget, objectiveStatus } from './budget.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** مجلَّدُ الوثائقِ الافتراضيُّ لمستوياتِ الخدمة. */
export const DEFAULT_SERVICE_LEVELS_CONFIG_DIR = path.resolve(HERE, '..', '..', 'config');

/**
 * كتالوجُ رموزِ الرفض. ويقابله في `config/service-levels.yaml` حقلُ
 * `refusalCodes` **في الاتجاهين**، ويحرس التقابلَ الحاجزُ (R3): رمزٌ في الكودِ
 * بلا إعلانٍ رمزٌ لا يجده قارئُ الوثيقة، ورمزٌ في الوثيقةِ بلا كودٍ وعدٌ لا
 * يُنفَّذ.
 */
export const SLO_ERRORS = Object.freeze({
  CONFIG_INVALID: 'SLO_CONFIG_INVALID',
  POLICY_REQUIRED: 'SLO_POLICY_REQUIRED',
  METRICS_REQUIRED: 'SLO_METRICS_REQUIRED',
  METRIC_UNDECLARED: 'SLO_METRIC_UNDECLARED',
  METRIC_KIND_MISMATCH: 'SLO_METRIC_KIND_MISMATCH',
  METRIC_ORPHANED: 'SLO_METRIC_ORPHANED',
  OBJECTIVE_UNDECLARED: 'SLO_OBJECTIVE_UNDECLARED',
  MEASUREMENT_UNAVAILABLE: 'SLO_MEASUREMENT_UNAVAILABLE',
  BUDGET_EXHAUSTED: 'SLO_BUDGET_EXHAUSTED',
  CLOCK_INVALID: 'SLO_CLOCK_INVALID',
});

/** خطأُ مستوياتِ الخدمة — يحمل رمزَه من `SLO_ERRORS`. */
export class ServiceLevelError extends Error {
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
    this.name = 'ServiceLevelError';
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
  throw new ServiceLevelError(code, message, detail);
}

/**
 * @param {string} message
 * @returns {never}
 */
function invalidConfig(message) {
  refuse(SLO_ERRORS.CONFIG_INVALID, message);
}

/**
 * @param {unknown} error
 * @returns {string}
 */
function errorText(error) {
  return error instanceof Error ? error.message : String(error);
}

/**
 * @typedef {object} ServiceLevelObjective
 * @property {string} id
 * @property {'ratio' | 'latency'} kind
 * @property {string} totalMetric
 * @property {string} [badMetric]
 * @property {string} [durationMetric]
 * @property {number} [thresholdMs]
 * @property {number} target
 * @property {string} statement
 */

/**
 * @typedef {object} ServiceLevelCapability
 * @property {string} id
 * @property {string} statement
 * @property {ServiceLevelObjective[]} objectives
 */

/**
 * @typedef {object} ServiceLevelGuarantee
 * @property {string} id
 * @property {string} enforcedIn
 * @property {string[]} codes
 * @property {string} statement
 */

/**
 * @typedef {object} ServiceLevelPolicy
 * @property {number} version
 * @property {string} statement
 * @property {{ scope: 'process', statement: string }} window
 * @property {ServiceLevelCapability[]} capabilities
 * @property {{ statement: string, policy: { onExhausted: string, statement: string } }} errorBudget
 * @property {string[]} refusalCodes
 * @property {ServiceLevelGuarantee[]} guarantees
 */

/**
 * يقرأ وثيقةَ مستوياتِ الخدمةِ ويتحقّق منها بمخطَّطِها ثم بفحوصِ تماسكٍ لا
 * يُعبِّر عنها مخطَّط. **ووثيقةٌ غائبةٌ أو مخالفةٌ توقف التحميلَ** ولا تُبتدأ
 * لوحةٌ بأهدافٍ افتراضية — فهدفٌ افتراضيٌّ هدفٌ لم يقرّره أحدٌ ويُحاسَب عليه
 * الجميع.
 *
 * @param {{ dir?: string }} [options]
 * @returns {ServiceLevelPolicy}
 */
export function loadServiceLevelPolicy(options = {}) {
  const dir = options.dir ?? DEFAULT_SERVICE_LEVELS_CONFIG_DIR;
  const schemaDir = fs.existsSync(path.join(dir, 'schemas'))
    ? dir
    : DEFAULT_SERVICE_LEVELS_CONFIG_DIR;
  const file = path.join(dir, 'service-levels.yaml');
  if (!fs.existsSync(file)) {
    invalidConfig(
      'وثيقةُ مستوياتِ الخدمةِ غائبة؛ ولوحةٌ بلا وثيقةٍ تُعلن أهدافَها لوحةٌ يُقرَّر فيها المقبولُ بعد رؤيةِ الرقمِ لا قبلَه.',
    );
  }
  /** @type {unknown} */
  let raw;
  try {
    raw = YAML.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    invalidConfig(`تعذّرت قراءة service-levels.yaml: ${errorText(error)}`);
  }
  const schemaPath = path.join(schemaDir, 'schemas', 'service-levels.schema.json');
  if (!fs.existsSync(schemaPath)) {
    invalidConfig(
      'مخطَّطُ وثيقةِ مستوياتِ الخدمةِ غائب؛ وبلا مخطَّطٍ يصير إعلانُ الأهدافِ نصّاً حرّاً كالذي جاء ليمنعه.',
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
    invalidConfig(`service-levels.yaml يخالف مخطَّطه: ${problems}`);
  }
  const parsed = /** @type {ServiceLevelPolicy} */ (raw);

  // ── فحوصُ تماسكٍ لا يُعبِّر عنها مخطَّط ──

  /** @type {Set<string>} */
  const capabilityIds = new Set();
  /** @type {Set<string>} */
  const objectiveIds = new Set();
  for (const capability of parsed.capabilities) {
    if (capabilityIds.has(capability.id)) {
      invalidConfig(
        `القدرة ${capability.id} مُعلَنةٌ مرّتين؛ وقدرتان بمعرّفٍ واحدٍ تجعلان اللوحةَ تُظهر صفَّين لشيءٍ واحد.`,
      );
    }
    capabilityIds.add(capability.id);
    for (const objective of capability.objectives) {
      if (objectiveIds.has(objective.id)) {
        invalidConfig(
          `الهدف ${objective.id} مُعلَنٌ مرّتين؛ ومعرّفٌ واحدٌ لهدفين يجعل التأكيدَ يُصيب غيرَ ما قُصد.`,
        );
      }
      objectiveIds.add(objective.id);
    }
  }

  const declaredCodes = new Set(parsed.refusalCodes);
  /** @type {Set<string>} */
  const guaranteeIds = new Set();
  for (const guarantee of parsed.guarantees) {
    if (guaranteeIds.has(guarantee.id)) {
      invalidConfig(`الضمان ${guarantee.id} مُعلَنٌ مرّتين؛ ولا ضمانانِ برمزٍ واحد.`);
    }
    guaranteeIds.add(guarantee.id);
    for (const code of guarantee.codes) {
      if (!declaredCodes.has(code)) {
        invalidConfig(
          `الضمان ${guarantee.id} يُحيل إلى الرمز ${code} وهو غيرُ مُعلَنٍ في refusalCodes؛ وضمانٌ يَعِد برمزٍ لا وجودَ له وعدٌ لا يُقاس.`,
        );
      }
    }
  }

  return parsed;
}

/**
 * @typedef {object} ObjectiveEvents
 * @property {number} good
 * @property {number} bad
 * @property {number} total
 */

/**
 * @typedef {object} ObjectiveRow
 * @property {string} id
 * @property {string} capability
 * @property {'ratio' | 'latency'} kind
 * @property {number} target
 * @property {number | null} thresholdMs
 * @property {Readonly<Record<string, string | null>>} sources
 * @property {ObjectiveEvents} events
 * @property {Readonly<{ calls: number, durationsRecorded: number | null, durationsRetained: number | null }>} observed
 * @property {boolean} sampled
 * @property {number | null} measured
 * @property {number | null} deviation
 * @property {'meeting' | 'breaching' | 'unmeasured'} status
 * @property {import('./budget.mjs').BudgetReading} errorBudget
 * @property {string} statement
 */

/**
 * الشكلُ البنيويُّ الذي تقرأ منه اللوحةُ — سجلُّ مقاييسِ `M10.01` نفسُه. ولا
 * يُستورَد الصنفُ هنا: **الحقنُ لا الاستيراد**، كما في طبقةِ القياسِ تحتَها،
 * فلا تصير طبقةُ الأهدافِ تبعيةَ ترجمةٍ لطبقةِ القياس.
 *
 * **والقراءةُ مجموعةٌ على السلاسلِ لا على وسمٍ بعينِه**: مقاييسُ `M10.01`
 * تُفرَّق بمسارِها وفاعلِها ورمزِ رفضِها، فمن قرأها بوسومٍ فارغةٍ قرأ
 * سلسلةً لم تُنادَ قطّ فخرج بصفرٍ والنداءاتُ معدودةٌ في غيرِه — **لوحةٌ
 * تُقرأ خضراءَ وهي لم تقس شيئاً**. ومستوى الخدمةِ حكمٌ على القدرةِ كلِّها
 * لا على مسارٍ واحدٍ منها.
 *
 * @typedef {object} MetricsSource
 * @property {(name: string) => number} counterTotal
 * @property {(name: string) => ({ count: number, retained: number, values: ReadonlyArray<number> } | null)} histogramTotals
 */

/**
 * @typedef {object} ServiceLevelsOptions
 * @property {ServiceLevelPolicy} [policy] وثيقةُ الأهدافِ المحمَّلةُ سلفاً.
 * @property {string} [dir] مجلَّدُ الوثائقِ حين لا تُمرَّر الوثيقةُ نفسُها.
 * @property {import('../telemetry/telemetry.mjs').TelemetryPolicy} telemetryPolicy وثيقةُ القياسِ الموحّد.
 * @property {MetricsSource} metrics سجلُّ مقاييسِ `M10.01`.
 * @property {() => number} [now] ساعةُ اللوحةِ بالملّي ثانية.
 */

/**
 * لوحةُ مستوياتِ الخدمة. تُبنى مرّةً في التركيبِ على **سجلِّ المقاييسِ نفسِه**
 * الذي تقرأ منه بقيّةُ الطبقات، وتُقرأ ولا تكتب.
 */
export class ServiceLevels {
  /** @type {ServiceLevelPolicy} */ #policy;
  /** @type {MetricsSource} */ #metrics;
  /** @type {() => number} */ #clock;
  /** @type {number} */ #startedAtMs;
  /** @type {Map<string, { capability: string, objective: ServiceLevelObjective }>} */
  #objectives = new Map();

  /** @param {ServiceLevelsOptions} options */
  constructor(options) {
    const telemetryPolicy = options.telemetryPolicy;
    if (telemetryPolicy === undefined || telemetryPolicy === null) {
      refuse(
        SLO_ERRORS.POLICY_REQUIRED,
        'وثيقةُ القياسِ الموحّدِ لم تُمرَّر؛ ولوحةٌ لا تعرف المقاييسَ المُعلَنةَ لا تستطيع أن تفرّق بين مقياسٍ غائبٍ ومقياسٍ لم يقع تحته حدث — والضمانُ G-SLO-SINGLE-SOURCE يمنع ذلك.',
      );
    }
    const metrics = options.metrics;
    if (metrics === undefined || metrics === null) {
      refuse(
        SLO_ERRORS.METRICS_REQUIRED,
        'سجلُّ المقاييسِ لم يُمرَّر؛ ولوحةُ أهدافٍ بلا مصدرِ قياسٍ لوحةٌ صفريةٌ تُقرأ «مستوفاةً» وهي لم تقس شيئاً — والضمانُ G-SLO-SINGLE-SOURCE يمنع ذلك.',
      );
    }
    const clock = options.now ?? Date.now;
    if (typeof clock !== 'function') {
      refuse(
        SLO_ERRORS.CLOCK_INVALID,
        'ساعةُ اللوحةِ ليست دالّةً؛ والضمانُ G-SLO-INJECTED-CLOCK يشترط ساعةً تُمرَّر وتُقاد في الاختبار.',
      );
    }
    this.#policy =
      options.policy ?? loadServiceLevelPolicy(options.dir ? { dir: options.dir } : {});
    this.#metrics = metrics;
    this.#clock = clock;
    this.#startedAtMs = this.#readClock();

    // ── G-SLO-DECLARED-SIGNALS: كلُّ مؤشِّرٍ يقرأ مقياساً مُعلَناً بنوعِه ──

    /** @type {Map<string, 'counter' | 'histogram'>} */
    const declared = new Map();
    for (const metric of telemetryPolicy.metrics) declared.set(metric.name, metric.kind);
    /** @type {Set<string>} */
    const referenced = new Set();

    /**
     * @param {string} objectiveId
     * @param {string} name
     * @param {'counter' | 'histogram'} kind
     */
    const requireMetric = (objectiveId, name, kind) => {
      const actual = declared.get(name);
      if (actual === undefined) {
        refuse(
          SLO_ERRORS.METRIC_UNDECLARED,
          `الهدف ${objectiveId} يقرأ المقياس «${name}» وهو غيرُ مُعلَنٍ في config/telemetry.yaml؛ وهدفٌ على مقياسٍ لا وجودَ له يُقرأ «غيرَ مقيسٍ» أبداً فيبدو بريئاً.`,
          { objective: objectiveId, metric: name },
        );
      }
      if (actual !== kind) {
        refuse(
          SLO_ERRORS.METRIC_KIND_MISMATCH,
          `الهدف ${objectiveId} يقرأ «${name}» على أنه ${kind} وهو مُعلَنٌ ${actual}؛ ونوعٌ يُبدَّل يجعل مجموعَ المدّاتِ يُقرأ عدّاداً أو العكس.`,
          { objective: objectiveId, metric: name, declaredKind: actual, usedKind: kind },
        );
      }
      referenced.add(name);
    };

    for (const capability of this.#policy.capabilities) {
      for (const objective of capability.objectives) {
        requireMetric(objective.id, objective.totalMetric, 'counter');
        if (objective.badMetric !== undefined) {
          requireMetric(objective.id, objective.badMetric, 'counter');
        }
        if (objective.durationMetric !== undefined) {
          requireMetric(objective.id, objective.durationMetric, 'histogram');
        }
        this.#objectives.set(objective.id, { capability: capability.id, objective });
      }
    }

    // ── G-SLO-NO-ORPHAN-METRIC: لا مقياسَ يُجمَع بلا هدفٍ يُقاس عليه ──

    for (const name of declared.keys()) {
      if (!referenced.has(name)) {
        refuse(
          SLO_ERRORS.METRIC_ORPHANED,
          `المقياس «${name}» مُعلَنٌ في وثيقةِ القياسِ ولا هدفَ يقرؤه في وثيقةِ مستوياتِ الخدمة؛ ومقياسٌ يُجمَع ولا يُقاس عليه عمودٌ في لوحةٍ يُملأ ولا يُقرأ.`,
          { metric: name },
        );
      }
    }
  }

  /**
   * قراءةُ الساعةِ الممرَّرةِ مرّةً واحدةً بتحقّقٍ واحد — والضمانُ
   * `G-SLO-INJECTED-CLOCK` يمرّ من هنا وحدَه.
   * @returns {number}
   */
  #readClock() {
    const value = this.#clock();
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      refuse(
        SLO_ERRORS.CLOCK_INVALID,
        'ساعةُ اللوحةِ أعادت قيمةً غيرَ منتهية؛ ونافذةٌ بعمرٍ غيرِ منتهٍ تجعل كلَّ رقمٍ فوقها بلا مدى.',
      );
    }
    return value;
  }

  /** الوثيقةُ النافذةُ — تُقرأ ولا تُبدَّل. */
  get policy() {
    return this.#policy;
  }

  /** معرّفاتُ الأهدافِ المُعلَنةِ بترتيبِ الوثيقة. */
  objectiveIds() {
    return Object.freeze([...this.#objectives.keys()]);
  }

  /**
   * صفُّ هدفٍ بعينِه مقروءاً من المقاييسِ الآن.
   * @param {string} id
   * @returns {ObjectiveRow}
   */
  objective(id) {
    const entry = this.#objectives.get(id);
    if (entry === undefined) {
      refuse(
        SLO_ERRORS.OBJECTIVE_UNDECLARED,
        `الهدف «${id}» غيرُ مُعلَنٍ في config/service-levels.yaml؛ ومعرّفٌ يُخترَع عند السؤالِ يُجاب عنه بلوحةٍ لا يعرفها أحد.`,
        { id, declared: this.objectiveIds() },
      );
    }
    return this.#rowFor(entry.capability, entry.objective);
  }

  /**
   * اللوحةُ كاملةً: القدراتُ وأهدافُها بأرقامِها، والانحرافُ عن كلِّ هدفٍ رقماً
   * موجباً أو سالباً، وميزانيةُ أخطائه مستهلَكةً ومتبقّيةً — وهذا معيارُ
   * القبولِ بحرفه.
   *
   * @returns {{ generatedAtMs: number, window: { scope: string, ageMs: number }, capabilities: ReadonlyArray<{ id: string, statement: string, objectives: ReadonlyArray<ObjectiveRow> }>, summary: Readonly<{ objectives: number, meeting: number, breaching: number, unmeasured: number, budgetsExhausted: number }> }}
   */
  dashboard() {
    const now = this.#readClock();
    let meeting = 0;
    let breaching = 0;
    let unmeasured = 0;
    let budgetsExhausted = 0;
    let objectives = 0;
    const capabilities = this.#policy.capabilities.map((capability) => {
      const rows = capability.objectives.map((objective) => {
        const row = this.#rowFor(capability.id, objective);
        objectives += 1;
        if (row.status === 'meeting') meeting += 1;
        else if (row.status === 'breaching') breaching += 1;
        else unmeasured += 1;
        if (row.errorBudget.exhausted) budgetsExhausted += 1;
        return row;
      });
      return Object.freeze({
        id: capability.id,
        statement: capability.statement,
        objectives: Object.freeze(rows),
      });
    });
    return Object.freeze({
      generatedAtMs: now,
      window: Object.freeze({
        scope: this.#policy.window.scope,
        ageMs: now - this.#startedAtMs,
      }),
      capabilities: Object.freeze(capabilities),
      summary: Object.freeze({
        objectives,
        meeting,
        breaching,
        unmeasured,
        budgetsExhausted,
      }),
    });
  }

  /**
   * يُرَدُّ الطلبُ إن استُنفدت ميزانيةُ الهدفِ أو لم يُقَس أصلاً، ويُعاد صفُّه
   * إن كان في سعته. وهذا هو أثرُ الاستنفادِ المُعلَنُ في الوثيقة
   * (`onExhausted: refuse-assertion`) **ولا يُدَّعى أثرٌ سواه**: لا تجميدَ نشرٍ
   * ولا تنبيهَ، فلا موضعَ لهما في المستودعِ بعد.
   *
   * @param {string} id
   * @returns {ObjectiveRow}
   */
  assertWithinBudget(id) {
    const row = this.objective(id);
    if (row.status === 'unmeasured') {
      refuse(
        SLO_ERRORS.MEASUREMENT_UNAVAILABLE,
        `الهدف ${id} لم يقع تحته حدثٌ مقيسٌ واحدٌ؛ وصفرُ أحداثٍ ليس التزاماً تامّاً، فلا يُجزَم بحكمٍ لم يُقَس.`,
        { id, events: row.events, observed: row.observed },
      );
    }
    if (row.errorBudget.exhausted) {
      refuse(
        SLO_ERRORS.BUDGET_EXHAUSTED,
        `ميزانيةُ أخطاءِ الهدف ${id} استُنفدت: المسموحُ ${row.errorBudget.allowed} والمستهلَكُ ${row.errorBudget.consumed}.`,
        { id, errorBudget: row.errorBudget, measured: row.measured, target: row.target },
      );
    }
    return row;
  }

  /**
   * @param {string} capabilityId
   * @param {ServiceLevelObjective} objective
   * @returns {ObjectiveRow}
   */
  #rowFor(capabilityId, objective) {
    const calls = this.#metrics.counterTotal(objective.totalMetric);
    /** @type {ObjectiveEvents} */
    let events;
    /** @type {number | null} */
    let durationsRecorded = null;
    /** @type {number | null} */
    let durationsRetained = null;
    let sampled = false;

    if (objective.kind === 'ratio') {
      const bad = this.#metrics.counterTotal(/** @type {string} */ (objective.badMetric));
      const good = calls > bad ? calls - bad : 0;
      events = { good, bad: calls > bad ? bad : calls, total: calls };
    } else {
      const samples = this.#metrics.histogramTotals(
        /** @type {string} */ (objective.durationMetric),
      );
      if (samples === null) {
        // ولا يُقرأ غيابُ المدّاتِ نجاحاً: مجموعٌ صفريٌّ يُعطي «غيرَ مقيسٍ»
        // صراحةً — وهذا شقُّ `G-SLO-NO-EMPTY-SUCCESS`.
        events = { good: 0, bad: 0, total: 0 };
      } else {
        const threshold = /** @type {number} */ (objective.thresholdMs);
        let within = 0;
        for (const value of samples.values) if (value <= threshold) within += 1;
        events = {
          good: within,
          bad: samples.retained - within,
          total: samples.retained,
        };
        durationsRecorded = samples.count;
        durationsRetained = samples.retained;
        sampled = samples.count > samples.retained;
      }
    }

    const measured = attainment({ good: events.good, total: events.total });
    return Object.freeze({
      id: objective.id,
      capability: capabilityId,
      kind: objective.kind,
      target: objective.target,
      thresholdMs: objective.thresholdMs ?? null,
      sources: Object.freeze({
        total: objective.totalMetric,
        bad: objective.badMetric ?? null,
        duration: objective.durationMetric ?? null,
      }),
      events: Object.freeze(events),
      observed: Object.freeze({ calls, durationsRecorded, durationsRetained }),
      sampled,
      measured,
      deviation: deviation({ measured, target: objective.target }),
      status: objectiveStatus({ measured, target: objective.target }),
      errorBudget: errorBudget({
        total: events.total,
        bad: events.bad,
        target: objective.target,
      }),
      statement: objective.statement,
    });
  }
}

/**
 * يبني لوحةَ مستوياتِ الخدمةِ على وثيقتِها المحمَّلةِ من القرصِ إن لم تُمرَّر.
 *
 * @param {ServiceLevelsOptions} options
 * @returns {ServiceLevels}
 */
export function createServiceLevels(options) {
  return new ServiceLevels(options);
}
