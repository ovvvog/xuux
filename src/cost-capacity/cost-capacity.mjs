/**
 * تتبّعُ التكلفةِ والسعة — الواجهةُ الجامعةُ للخطوة `M10.04`.
 *
 * **العيبُ الذي تُغلقه هذه الوحدة:** صار للنظامِ بعد `M10.01`–`M10.03` رقمٌ
 * وحكمٌ وصوتٌ، وكلُّها في بُعدِ **الصحّة**. فهو يعرف أنه «بخيرٍ» ولا يعرف
 * **بكم** كان بخير: العملُ يجري بلا ثمنٍ معلَنٍ، والاستهلاكُ بلا صاحبٍ يُسنَد
 * إليه، والسعةُ بلا سقفٍ يُقاس عليه، والشهرُ ينقضي بلا تقريرٍ يُولَّد. **ومن لا
 * يُعرَف استهلاكُه لا يُحاسَب عليه.**
 *
 * **والقاعدة: لا استهلاكَ بلا ثمنٍ مُعلَنٍ سلفاً، ولا ثمنَ بلا صاحبٍ في
 * الأبعادِ الثلاثةِ، ولا تقريرَ من ذاكرةِ كاتبِه.** فهذه الوحدةُ **لا تخترع
 * سعراً ولا سقفاً**: تقرأهما من `config/cost-capacity.yaml`، ويقيس
 * `scripts/guard-cost-capacity.mjs` غيابَ أرقامِهما نصّاً من الكود (R5).
 * و**لا تُنشئ سجلًّا ثانياً**: القيدُ في السجلِّ الدائمِ المُحقَنِ، والحادثةُ
 * في **مركزِ العملياتِ بعينِه** عبر `operations.record(` — وهو المسارُ الذي
 * فتحه `M10.03`، ولو فُتح له مسارٌ ثانٍ لصار في الدولةِ سجلّا حوادثَ يتباعدان.
 *
 * والضماناتُ المُنفَّذةُ هنا: `G-COST-SUBJECT-DECLARED` و`G-COST-NO-EMPTY-ZERO`
 * و`G-COST-REPORT-FROM-LEDGER` و`G-COST-SINGLE-INCIDENT-LEDGER`
 * و`G-COST-INJECTED-CLOCK`؛ وضمانا الحسابِ والشهرِ في `pricing.mjs`.
 *
 * **حدودٌ معلَنة:**
 * 1. **الأسعارُ وحداتٌ محاسبيةٌ داخليةٌ** لا عملةٌ ولا فاتورةُ مزوِّدٍ ولا
 *    تحصيل؛ ولا موصلَ فوترةٍ خارجيّاً في هذه الخطوة.
 * 2. **عضويةُ الوكيلِ والنموذجِ ديناميكيةٌ**: يُفحَص شكلُ المعرّفِ وبادئتُه، ولا
 *    يُسأل سجلُّ الهوياتِ ولا سجلُّ النماذجِ هنا عن وجودِه — وهو حدٌّ معلَنٌ
 *    مسجَّلٌ في `REMAINING_WORK.md` لا سهو.
 * 3. **لا مُجدوِلَ يعمل بنفسِه**: التقريرُ يُولَّد بنداءٍ، والساعةُ مُمرَّرةٌ،
 *    ولا `setTimeout` ولا `setInterval` في المسار.
 *
 * @module cost-capacity/cost-capacity
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import Ajv2020Default from 'ajv/dist/2020.js';

// وحزمةُ Ajv تُصدِّر صنفَها افتراضاً في ESM، فيُقرأ نوعُه صريحاً وإلا صار «غيرَ
// قابلٍ للإنشاء» في الفحصِ الصارم — كما في وحدةِ مستوياتِ الخدمةِ قبلَها.
const Ajv2020 = /** @type {typeof import('ajv/dist/2020.js').Ajv2020} */ (
  /** @type {unknown} */ (Ajv2020Default)
);
import YAML from 'yaml';

import { evaluateCapacity, evaluateDeviation } from './deviation.mjs';
import { COST_ERRORS, CostCapacityError } from './errors.mjs';
import { aggregateBy, assertPeriod, costMilliOf, periodOf, totalsByItem } from './pricing.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** مجلَّدُ الوثائقِ الافتراضيُّ لوثيقةِ التكلفةِ والسعة. */
export const DEFAULT_COST_CAPACITY_CONFIG_DIR = path.resolve(HERE, '..', '..', 'config');

/** أبعادُ الإسنادِ الثلاثةُ بترتيبِها المُعلَنِ في الوثيقة. */
export const COST_DIMENSIONS = Object.freeze(['institution', 'agent', 'model']);

/**
 * @param {string} code
 * @param {string} message
 * @param {Record<string, unknown>} [detail]
 * @returns {never}
 */
function refuse(code, message, detail = {}) {
  throw new CostCapacityError(code, message, detail);
}

/** @param {unknown} error @returns {string} */
function errorText(error) {
  return error instanceof Error ? error.message : String(error);
}

/** @param {string} message @returns {never} */
function invalidConfig(message) {
  refuse(COST_ERRORS.CONFIG_INVALID, message);
}

/**
 * @typedef {object} CostItem
 * @property {string} id
 * @property {string} resource
 * @property {string} quantityUnit
 * @property {number} perUnits
 * @property {number} unitPriceMilli
 * @property {string} statement
 */

/**
 * @typedef {object} CostDimension
 * @property {'institution' | 'agent' | 'model'} id
 * @property {string} subjectPrefix
 * @property {'declared' | 'dynamic'} membership
 * @property {string} source
 * @property {string[]} [members]
 * @property {string} statement
 */

/**
 * @typedef {object} CostCapacityPolicy
 * @property {number} version
 * @property {string} statement
 * @property {{ unit: string, rounding: string, statement: string }} accounting
 * @property {CostItem[]} costItems
 * @property {CostDimension[]} dimensions
 * @property {Array<{ id: string, dimension: 'institution' | 'agent' | 'model', item: string, limitUnits: number, severity: string, statement: string }>} capacityLimits
 * @property {Array<{ id: string, dimension: 'institution' | 'agent' | 'model', item: string, baselineUnits: number, toleranceRatio: number, severity: string, channel: string, statement: string }>} deviationRules
 * @property {{ period: string, requiredSections: string[], statement: string }} report
 * @property {{ usageRecordedEvent: string, reportGeneratedEvent: string, deviationRaisedEvent: string, refusedEvent: string, statement: string }} audit
 * @property {string[]} refusalCodes
 * @property {Array<{ id: string, enforcedIn: string, codes: string[], statement: string }>} guarantees
 */

/**
 * يقرأ وثيقةَ التكلفةِ والسعةِ ويتحقّق منها بمخطَّطِها ثم بفحوصِ تماسكٍ لا
 * يُعبِّر عنها مخطَّط. **ووثيقةٌ غائبةٌ أو مخالفةٌ توقف التحميلَ** ولا يُبتدأ
 * دفترٌ بأسعارٍ افتراضية — فسعرٌ افتراضيٌّ سعرٌ لم يُقرّره أحدٌ ويُحاسَب عليه
 * الجميع.
 *
 * @param {{ dir?: string }} [options]
 * @returns {CostCapacityPolicy}
 */
export function loadCostCapacityPolicy(options = {}) {
  const dir = options.dir ?? DEFAULT_COST_CAPACITY_CONFIG_DIR;
  const schemaDir = fs.existsSync(path.join(dir, 'schemas'))
    ? dir
    : DEFAULT_COST_CAPACITY_CONFIG_DIR;
  const file = path.join(dir, 'cost-capacity.yaml');
  if (!fs.existsSync(file)) {
    invalidConfig(
      'وثيقةُ التكلفةِ والسعةِ غائبة؛ ودفترٌ بلا وثيقةٍ تُعلن أثمانَه دفترٌ يُقرَّر فيه الثمنُ بعد رؤيةِ الاستهلاكِ لا قبلَه.',
    );
  }
  /** @type {unknown} */
  let raw;
  try {
    raw = YAML.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    invalidConfig(`تعذّرت قراءة cost-capacity.yaml: ${errorText(error)}`);
  }
  const schemaPath = path.join(schemaDir, 'schemas', 'cost-capacity.schema.json');
  if (!fs.existsSync(schemaPath)) {
    invalidConfig(
      'مخطَّطُ وثيقةِ التكلفةِ والسعةِ غائب؛ وبلا مخطَّطٍ يصير إعلانُ الأثمانِ نصّاً حرّاً كالذي جاء ليمنعه.',
    );
  }
  const validate = new Ajv2020({ allErrors: true, strict: false }).compile(
    JSON.parse(fs.readFileSync(schemaPath, 'utf8')),
  );
  if (!validate(raw)) {
    const problems = (validate.errors ?? [])
      .map(
        (/** @type {{ instancePath: string, message?: string }} */ entry) =>
          `${entry.instancePath || '/'}: ${entry.message ?? 'مخالفة'}`,
      )
      .join('؛ ');
    invalidConfig(`وثيقةُ التكلفةِ والسعةِ تخالف مخطَّطَها: ${problems}`);
  }
  const parsed = /** @type {CostCapacityPolicy} */ (raw);

  const itemIds = new Set(parsed.costItems.map((item) => item.id));
  if (itemIds.size !== parsed.costItems.length) {
    invalidConfig(
      'بندُ كلفةٍ مكرَّرُ المعرّف؛ ومعرّفٌ يُشير إلى ثمنين ثمنٌ لا يُعرَف أيُّه النافذ.',
    );
  }
  const dimensionIds = new Set(parsed.dimensions.map((dimension) => dimension.id));
  for (const dimension of COST_DIMENSIONS) {
    if (!dimensionIds.has(/** @type {'institution' | 'agent' | 'model'} */ (dimension))) {
      invalidConfig(
        `بُعدُ الإسناد «${dimension}» غائبٌ عن الوثيقة؛ ومعيارُ الخطوةِ «كلفةٌ لكلِّ مؤسسةٍ ووكيلٍ ونموذج» لا يُستوفى ببُعدين.`,
      );
    }
  }
  for (const limit of parsed.capacityLimits) {
    if (!itemIds.has(limit.item)) {
      invalidConfig(
        `الحدُّ «${limit.id}» على بندٍ غيرِ معلَنٍ «${limit.item}»؛ وسقفٌ على بندٍ لا ثمنَ له سقفٌ لا يُقاس.`,
      );
    }
  }
  for (const rule of parsed.deviationRules) {
    if (!itemIds.has(rule.item)) {
      invalidConfig(
        `القاعدة «${rule.id}» على بندٍ غيرِ معلَنٍ «${rule.item}»؛ وانحرافٌ عن خطِّ أساسٍ لبندٍ لا وجودَ له انحرافٌ لا مصدرَ لحكمِه.`,
      );
    }
  }
  return parsed;
}

/**
 * @typedef {object} LogLike
 * @property {(type: string, actor: string, data: object) => unknown} append
 */

/**
 * @typedef {object} OperationsLike
 * @property {(incident: { id: string, severity: string, title: string, source: string, detail?: Record<string, unknown> }, context?: { actor?: string }) => unknown} record
 */

/**
 * استخراجُ قيودِ الاستهلاكِ الصحيحةِ من صفوفِ السجلِّ الخامِّ — منطقُ التحقّقِ من
 * القيدِ **واحدٌ** هنا يقرأُ منه الدفترُ نفسُه وكلُّ من يقرأُ عدّادَ وحداتِ الحسابِ
 * من خارجِه؛ فنسختانِ من منطقِ القيدِ تنفصلانِ عند أوّلِ تعديلٍ فيُعدَّ ما لا
 * يعدّه الآخر.
 *
 * **والقيدُ الناقصُ يُطرَح ولا يُكمَّل بافتراضٍ:** صفٌّ ليس من نوعِ حدثِ القيدِ أو
 * نقصَ أحدَ حقولِه المسمّاة أو جاء حقلٌ منها بنوعٍ باطلٍ يُترك، فقيدٌ مُرمَّمٌ قيدٌ
 * اخترعه القارئ (المادة 2). ولا يُفلترُ هنا بزمنٍ ولا ببُعدٍ — فالزمنُ والبُعدُ
 * سؤالُ من يقرأُ لا سؤالُ القيد.
 *
 * @param {readonly Record<string, unknown>[]} rows صفوفُ السجلِّ الخامّة كما يُقرؤها قارئُ الدفتر.
 * @param {CostCapacityPolicy} policy وثيقةُ الدفتر — منها اسمُ حدثِ القيدِ (`audit.usageRecordedEvent`).
 * @returns {import('./pricing.mjs').UsageEntryLike[]}
 */
export function usageEntriesOf(rows, policy) {
  const wanted = policy.audit.usageRecordedEvent;
  /** @type {import('./pricing.mjs').UsageEntryLike[]} */
  const entries = [];
  for (const raw of rows) {
    if (raw === null || typeof raw !== 'object') continue;
    if (raw['type'] !== wanted) continue;
    const data = /** @type {Record<string, unknown>} */ (raw['data'] ?? {});
    const atMs = data['atMs'];
    const quantity = data['quantity'];
    const costMilli = data['costMilli'];
    if (
      typeof data['item'] !== 'string' ||
      typeof data['institution'] !== 'string' ||
      typeof data['agent'] !== 'string' ||
      typeof data['model'] !== 'string' ||
      typeof atMs !== 'number' ||
      typeof quantity !== 'number' ||
      typeof costMilli !== 'number'
    ) {
      continue;
    }
    entries.push({
      item: data['item'],
      institution: data['institution'],
      agent: data['agent'],
      model: data['model'],
      quantity,
      costMilli,
      atMs,
    });
  }
  return entries;
}

/**
 * دفترُ التكلفةِ والسعة.
 *
 * **ثلاثةُ محاقنَ لا استيراداتٍ:** السجلُّ الدائمُ، وقارئُ القيودِ من القرص،
 * ومركزُ العمليات. ومن لم يُمرَّر إليه واحدٌ منها **رُدَّ باسمِه** عند أوّلِ
 * نداءٍ يحتاجه، ولم يُعطَ دفتراً صفريّاً يُقرأ قياساً.
 */
export class CostCapacity {
  /** @type {CostCapacityPolicy} */
  #policy;
  /** @type {LogLike | null} */
  #log;
  /** @type {(() => readonly Record<string, unknown>[]) | null} */
  #ledger;
  /** @type {OperationsLike | null} */
  #operations;
  /** @type {() => number} */
  #nowMs;

  /**
   * @param {{ policy?: CostCapacityPolicy, dir?: string, log?: LogLike | null, ledger?: (() => readonly Record<string, unknown>[]) | null, operations?: OperationsLike | null, nowMs?: () => number }} [deps]
   */
  constructor(deps = {}) {
    this.#policy =
      deps.policy ?? loadCostCapacityPolicy(deps.dir === undefined ? {} : { dir: deps.dir });
    this.#log = deps.log ?? null;
    this.#ledger = deps.ledger ?? null;
    this.#operations = deps.operations ?? null;
    this.#nowMs = deps.nowMs ?? (() => Date.now());
  }

  /**
   * وصفُ الدفترِ كما أُعلن — يُقرأ ولا يُحسَب منه شيء.
   * @returns {{ version: number, unit: string, items: string[], dimensions: string[], limits: string[], rules: string[], sections: string[] }}
   */
  describe() {
    return {
      version: this.#policy.version,
      unit: this.#policy.accounting.unit,
      items: this.#policy.costItems.map((item) => item.id),
      dimensions: this.#policy.dimensions.map((dimension) => dimension.id),
      limits: this.#policy.capacityLimits.map((limit) => limit.id),
      rules: this.#policy.deviationRules.map((rule) => rule.id),
      sections: [...this.#policy.report.requiredSections],
    };
  }

  /**
   * ساعةٌ مُتحقَّقٌ منها عند كلِّ قراءة — وساعةٌ لا تُعيد عدداً منتهياً تُرَدُّ
   * باسمِها؛ فزمنٌ مزوَّرٌ في دفترٍ يُنقل قيداً من شهرٍ إلى شهر.
   * @param {string} where
   * @returns {number}
   */
  #clock(where) {
    const value = this.#nowMs();
    if (!Number.isFinite(value)) {
      refuse(
        COST_ERRORS.CLOCK_INVALID,
        `الساعةُ المُمرَّرةُ لم تُعِد عدداً منتهياً عند ${where}؛ وقيدٌ بزمنٍ باطلٍ قيدٌ يقع في شهرٍ لا يُعرَف.`,
        { where },
      );
    }
    return value;
  }

  /** @returns {LogLike} */
  #requireLog() {
    const log = this.#log;
    if (log === null) {
      refuse(
        COST_ERRORS.LOG_REQUIRED,
        'لا سجلَّ دائماً مُمرَّراً إلى الدفتر؛ واستهلاكٌ يُحسَب ولا يُقيَّد استهلاكٌ لا دليلَ عليه (المادة 2).',
      );
    }
    return log;
  }

  /** @returns {() => readonly Record<string, unknown>[]} */
  #requireLedger() {
    const ledger = this.#ledger;
    if (ledger === null) {
      refuse(
        COST_ERRORS.LEDGER_REQUIRED,
        'لا قارئَ لقيودِ السجلِّ مُمرَّراً إلى الدفتر؛ وتقريرٌ يُبنى على ذاكرةِ العمليةِ عن نفسِها تقريرٌ يشهد لنفسِه.',
      );
    }
    return ledger;
  }

  /** @returns {OperationsLike} */
  #requireOperations() {
    const operations = this.#operations;
    if (operations === null) {
      refuse(
        COST_ERRORS.OPERATIONS_REQUIRED,
        'لا مركزَ عملياتٍ مُمرَّراً إلى الدفتر؛ وانحرافٌ يُقرأ ولا يُقيَّد حادثةً انحرافٌ لا يراه أحد.',
      );
    }
    return operations;
  }

  /**
   * قيدُ رفضٍ في السجلِّ ثم رفعُ الخطأ: الرفضُ يُكتب كما يُكتب القبول.
   * @param {string} actor
   * @param {CostCapacityError} error
   * @param {Record<string, unknown>} data
   * @returns {never}
   */
  #refuse(actor, error, data) {
    const log = this.#log;
    if (log !== null) {
      log.append(this.#policy.audit.refusedEvent, actor, {
        ...data,
        code: error.code,
        reason: error.message,
      });
    }
    throw error;
  }

  /**
   * التحقُّقُ من صاحبِ الاستهلاكِ في بُعدٍ معلَن.
   * @param {'institution' | 'agent' | 'model'} dimensionId
   * @param {unknown} subject
   * @returns {string}
   */
  #assertSubject(dimensionId, subject) {
    const dimension = this.#policy.dimensions.find((entry) => entry.id === dimensionId);
    if (dimension === undefined) {
      refuse(
        COST_ERRORS.DIMENSION_UNDECLARED,
        `بُعدُ الإسناد «${dimensionId}» غيرُ معلَنٍ في الوثيقة؛ وبُعدٌ يخترعه المُنادي بُعدٌ لا يُقرأ في تقرير.`,
        { dimension: dimensionId },
      );
    }
    if (typeof subject !== 'string' || subject.trim() === '') {
      refuse(
        COST_ERRORS.SUBJECT_UNDECLARED,
        `الاستهلاكُ بلا صاحبٍ في البُعد «${dimensionId}»؛ وإسنادٌ ناقصُ بُعدٍ يُخرِج القيدَ من تقريرِ ذلك البُعدِ صامتاً فيُقرأ نقصُه توفيراً.`,
        { dimension: dimensionId },
      );
    }
    const value = subject.trim();
    if (!value.startsWith(dimension.subjectPrefix)) {
      refuse(
        COST_ERRORS.SUBJECT_UNDECLARED,
        `الصاحبُ «${value}» لا يحمل بادئةَ البُعد «${dimension.subjectPrefix}»؛ وبادئةٌ مختلفةٌ تعني بُعداً آخرَ لا هذا.`,
        { dimension: dimensionId, subject: value },
      );
    }
    if (dimension.membership === 'declared' && !(dimension.members ?? []).includes(value)) {
      refuse(
        COST_ERRORS.SUBJECT_UNDECLARED,
        `الصاحبُ «${value}» غيرُ معلَنٍ في أعضاءِ البُعد «${dimensionId}» المقروءةِ من ${dimension.source}؛ ومؤسسةٌ لا تعمل لا يُسنَد إليها إنفاق.`,
        { dimension: dimensionId, subject: value },
      );
    }
    return value;
  }

  /**
   * تقييدُ استهلاكٍ واحدٍ بثمنِه وأبعادِه الثلاثة — **والقيدُ قبل الأثر**.
   *
   * @param {{ item?: unknown, quantity?: unknown, institution?: unknown, agent?: unknown, model?: unknown }} usage
   * @param {{ actor?: string }} [context]
   * @returns {{ item: string, quantity: number, costMilli: number, institution: string, agent: string, model: string, atMs: number, period: string }}
   */
  record(usage, context = {}) {
    const actor = context.actor ?? 'agent:cost-ledger';
    const log = this.#requireLog();
    const atMs = this.#clock('تقييدِ استهلاك');

    if (usage === null || typeof usage !== 'object') {
      this.#refuse(
        actor,
        new CostCapacityError(
          COST_ERRORS.ITEM_UNDECLARED,
          'الاستهلاكُ ليس كائناً؛ وقيدٌ بلا حقولٍ قيدٌ لا يُقرأ منه ثمنٌ ولا صاحب.',
        ),
        {},
      );
    }
    const item = this.#policy.costItems.find((entry) => entry.id === usage.item);
    if (item === undefined) {
      this.#refuse(
        actor,
        new CostCapacityError(
          COST_ERRORS.ITEM_UNDECLARED,
          `بندُ الكلفة «${String(usage.item)}» غيرُ معلَنٍ في الوثيقة؛ وبندٌ بلا ثمنٍ مُعلَنٍ سلفاً بندٌ يُسعَّر بعد وقوعِه.`,
          { item: String(usage.item) },
        ),
        { item: String(usage.item) },
      );
    }

    // ورفضُ الإسنادِ يُقيَّد كما يُقيَّد قبولُه: `#assertSubject` يرفع الخطأَ
    // نقيّاً كي يُختبَر وحدَه، والكتابةُ في السجلِّ من موضعٍ واحدٍ هنا — فلو
    // كتب كلُّ فاحصٍ بنفسِه لصار للقيدِ مصدرانِ يُنسى أحدُهما عند أوّلِ فاحصٍ
    // جديد. **وقد كشف القياسُ هذا بعينِه**: كانت ردودُ الإسنادِ تخرج بلا قيدٍ
    // فيُقرأ الرفضُ في الشيفرةِ ولا يُقرأ في السجلّ.
    /** @type {{ institution: string, agent: string, model: string }} */
    let subjects;
    try {
      subjects = {
        institution: this.#assertSubject('institution', usage.institution),
        agent: this.#assertSubject('agent', usage.agent),
        model: this.#assertSubject('model', usage.model),
      };
    } catch (error) {
      if (error instanceof CostCapacityError) {
        this.#refuse(actor, error, { item: item.id, ...error.detail });
      }
      throw error;
    }
    const { institution, agent, model } = subjects;

    /** @type {number} */
    let costMilli;
    try {
      costMilli = costMilliOf({ item, quantity: /** @type {number} */ (usage.quantity) });
    } catch (error) {
      if (error instanceof CostCapacityError) {
        this.#refuse(actor, error, { item: item.id, quantity: String(usage.quantity) });
      }
      throw error;
    }

    const quantity = /** @type {number} */ (usage.quantity);
    const period = periodOf(atMs);
    log.append(this.#policy.audit.usageRecordedEvent, actor, {
      item: item.id,
      resource: item.resource,
      quantity,
      costMilli,
      institution,
      agent,
      model,
      period,
      atMs,
    });
    return { item: item.id, quantity, costMilli, institution, agent, model, atMs, period };
  }

  /**
   * كلُّ قيودِ الاستهلاكِ الصحيحةِ **من قارئِ السجلِّ المُحقَنِ** لا من ذاكرةِ الدفترِ عن
   * نفسِه؛ وقيدٌ ناقصُ حقلٍ يُطرَح ولا يُكمَّل بافتراضٍ — فقيدٌ مُرمَّمٌ قيدٌ
   * اخترعه القارئ. وهذا القراءُ العامُّ هو ما يقرأُ منه `#entriesOf` لشهرٍ بعينِه،
   * وهو ما يقرأُ منه التقريرُ الملكيُّ عدّادَ وحداتِ الحسابِ (`D-6`) على نافذتِهِ
   * لا على شهرِ التقويم — فالنافذةُ زمنُ القراءةِ والشهرُ زمنُ الحسبةِ، ولا يجوزُ أن
   * يُقيَّدَ عدّادُ النافذةِ بمنطقِ الشهر.
   *
   * @returns {import('./pricing.mjs').UsageEntryLike[]}
   */
  usageEntries() {
    const ledger = this.#requireLedger();
    return usageEntriesOf(ledger(), this.#policy);
  }

  /**
   * قراءةُ قيودِ شهرٍ من القراءِ العامِّ بترشيحِ الشهرِ — فمنطقُ التحقّقِ من القيدِ
   * واحدٌ في `usageEntriesOf` ولا يُكرَّر في القارئات.
   *
   * @param {string} period
   * @returns {import('./pricing.mjs').UsageEntryLike[]}
   */
  #entriesOf(period) {
    const ledger = this.#requireLedger();
    return usageEntriesOf(ledger(), this.#policy).filter(
      (entry) => periodOf(entry.atMs) === period,
    );
  }

  /**
   * تقريرُ الشهرِ التقويميِّ — **مُولَّدٌ من قيودِ السجلِّ** لا مكتوبٌ بيدٍ.
   *
   * **وشهرٌ بلا قيدٍ واحدٍ يُعلَن `measured: false`** ولا يُعرَض صفرَ إنفاقٍ:
   * فالصفرُ بلا مصدرٍ أخضرُ فارغٌ، وهو أسوأُ من الأحمرِ لأنه يُسكِت السؤالَ بدل
   * أن يجيبه — وهو الاختيارُ نفسُه الذي اتُّخذ في لوحةِ `M10.02`.
   *
   * @param {{ period: string, actor?: string }} request
   * @returns {{ period: string, measured: boolean, generatedAtMs: number, unit: string, totals: Array<{ item: string, units: number, costMilli: number, entries: number }>, costMilli: number, byInstitution: Array<{ subject: string, costMilli: number, items: Array<{ item: string, units: number, costMilli: number }> }>, byAgent: Array<{ subject: string, costMilli: number, items: Array<{ item: string, units: number, costMilli: number }> }>, byModel: Array<{ subject: string, costMilli: number, items: Array<{ item: string, units: number, costMilli: number }> }>, capacity: import('./deviation.mjs').CapacityRow[], deviations: import('./deviation.mjs').DeviationRow[], evidence: { entries: number, event: string, firstAtMs: number | null, lastAtMs: number | null } }}
   */
  report(request) {
    const actor = request.actor ?? 'agent:cost-ledger';
    const period = assertPeriod(request.period);
    const generatedAtMs = this.#clock('توليدِ تقريرِ الشهر');
    const entries = this.#entriesOf(period);

    /** @type {Map<'institution' | 'agent' | 'model', Map<string, Map<string, { units: number, costMilli: number, entries: number }>>>} */
    const aggregates = new Map();
    for (const dimension of COST_DIMENSIONS) {
      aggregates.set(
        /** @type {'institution' | 'agent' | 'model'} */ (dimension),
        aggregateBy({
          entries,
          dimension: /** @type {'institution' | 'agent' | 'model'} */ (dimension),
        }),
      );
    }
    /** @param {'institution' | 'agent' | 'model'} dimension */
    const totalsFor = (dimension) => aggregates.get(dimension) ?? new Map();

    /** @param {'institution' | 'agent' | 'model'} dimension */
    const breakdown = (dimension) =>
      [...totalsFor(dimension)]
        .map(([subject, items]) => ({
          subject,
          costMilli: [...items.values()].reduce((sum, entry) => sum + entry.costMilli, 0),
          items: [...items].map(([item, entry]) => ({
            item,
            units: entry.units,
            costMilli: entry.costMilli,
          })),
        }))
        .sort(
          (left, right) =>
            right.costMilli - left.costMilli || left.subject.localeCompare(right.subject),
        );

    const totals = [...totalsByItem(entries)]
      .map(([item, entry]) => ({
        item,
        units: entry.units,
        costMilli: entry.costMilli,
        entries: entry.entries,
      }))
      .sort(
        (left, right) => right.costMilli - left.costMilli || left.item.localeCompare(right.item),
      );

    const report = {
      period,
      measured: entries.length > 0,
      generatedAtMs,
      unit: this.#policy.accounting.unit,
      totals,
      costMilli: totals.reduce((sum, entry) => sum + entry.costMilli, 0),
      byInstitution: breakdown('institution'),
      byAgent: breakdown('agent'),
      byModel: breakdown('model'),
      capacity: evaluateCapacity({ limits: this.#policy.capacityLimits, totalsFor }),
      deviations: evaluateDeviation({ rules: this.#policy.deviationRules, totalsFor }),
      evidence: {
        entries: entries.length,
        event: this.#policy.audit.usageRecordedEvent,
        firstAtMs: entries.length === 0 ? null : Math.min(...entries.map((entry) => entry.atMs)),
        lastAtMs: entries.length === 0 ? null : Math.max(...entries.map((entry) => entry.atMs)),
      },
    };

    this.#requireLog().append(this.#policy.audit.reportGeneratedEvent, actor, {
      period,
      measured: report.measured,
      entries: entries.length,
      costMilli: report.costMilli,
      exceeded: report.capacity.filter((row) => row.status === 'exceeded').length,
      deviating: report.deviations.filter((row) => row.firing).length,
    });
    return report;
  }

  /**
   * تقييمُ انحرافِ شهرٍ وتقييدُ ما أشعل منه **حادثةً في مركزِ العملياتِ بعينِه**.
   *
   * **ويُعاد كلُّ ما قُيِّم لا ما أشعل وحدَه**؛ ولا يُقيَّد إلا المُشعِل، فحادثةٌ
   * لكلِّ قاعدةٍ هادئةٍ ضجيجٌ يُتعلَّم تجاهُلُه.
   *
   * @param {{ period: string, actor?: string }} request
   * @returns {{ period: string, measured: boolean, raised: string[], candidates: import('./deviation.mjs').DeviationRow[] }}
   */
  evaluate(request) {
    const actor = request.actor ?? 'agent:cost-ledger';
    const operations = this.#requireOperations();
    const log = this.#requireLog();
    const generated = this.report({ period: request.period, actor });

    /** @type {string[]} */
    const raised = [];
    for (const row of generated.deviations) {
      if (!row.firing || row.subject === null) continue;
      const id = `incident:cost:${row.rule}:${row.subject}:${generated.period}`;
      operations.record(
        {
          id,
          severity: row.severity,
          title: `انحرافُ إنفاقٍ في «${row.subject}» على «${row.item}» في شهر ${generated.period}`,
          source: row.rule,
          detail: {
            channel: row.channel,
            dimension: row.dimension,
            item: row.item,
            subject: row.subject,
            units: row.units,
            baselineUnits: row.baselineUnits,
            allowedUnits: row.allowedUnits,
            deviationRatio: row.deviationRatio,
            reason: row.reason,
          },
        },
        { actor },
      );
      log.append(this.#policy.audit.deviationRaisedEvent, actor, {
        incident: id,
        rule: row.rule,
        subject: row.subject,
        period: generated.period,
        units: row.units,
        allowedUnits: row.allowedUnits,
        severity: row.severity,
        channel: row.channel,
      });
      raised.push(id);
    }
    return {
      period: generated.period,
      measured: generated.measured,
      raised,
      candidates: generated.deviations,
    };
  }
}
