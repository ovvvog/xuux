/**
 * سجل تقييم النماذج — M6.08.
 *
 * العيب الذي يعالجه: اعتماد النموذج كان كافياً لتنشيطه، فلا يثبت السجل أن أوزانه
 * اجتازت مجموعة تقييم ولا أن النتيجة تخص الأوزان الموجودة لحظة الطلب. نتيجة من
 * إصدارٍ سابق كانت ستصير تصريحاً عاماً باسم النموذج، وهو بالضبط ما يمنعه الربط
 * بـ`fingerprint` هنا.
 *
 * الأحكام بيانات في `config/model-evaluation.yaml`: الفحوص الإلزامية وعتباتها
 * وحالات النتيجة لا تتوزع في فروع كود. والنتيجة الناقصة تفشل مغلقاً؛ غياب فحص
 * سلامة لا يُقرأ نجاحاً لمجرد أن بقية الدرجات جيدة.
 *
 * حدود معلنة: السجل ملف JSON ذري اختياري أو ذاكرة للاختبار، لا جدول PostgreSQL؛
 * ملف التشغيل يجب أن يبقى على وسط الدولة الدائم (افتراضياً `.state`). لا يشغّل
 * هذا الملف النموذج ولا يثبت صحة المقيِّم؛ وظيفته حفظ قرار التقييم وربطه بالبصمة.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';
import Ajv2020Default from 'ajv/dist/2020.js';

const Ajv2020 = /** @type {typeof import('ajv/dist/2020.js').Ajv2020} */ (
  /** @type {unknown} */ (Ajv2020Default)
);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DEFAULT_CONFIG_DIR = path.join(ROOT, 'config');
const FINGERPRINT_PATTERN = /^[0-9a-f]{64}$/u;

export const MODEL_EVALUATION_ERRORS = Object.freeze({
  CONFIG_MISSING: 'MODEL_EVALUATION_CONFIG_MISSING',
  CONFIG_UNPARSABLE: 'MODEL_EVALUATION_CONFIG_UNPARSABLE',
  SCHEMA_MISSING: 'MODEL_EVALUATION_SCHEMA_MISSING',
  CONFIG_INVALID: 'MODEL_EVALUATION_CONFIG_INVALID',
  CATALOG_INCOHERENT: 'MODEL_EVALUATION_CATALOG_INCOHERENT',
  DEPENDENCY_MISSING: 'MODEL_EVALUATION_DEPENDENCY_MISSING',
  INPUT_INVALID: 'MODEL_EVALUATION_INPUT_INVALID',
  RESULT_DUPLICATE: 'MODEL_EVALUATION_RESULT_DUPLICATE',
  CHECK_UNKNOWN: 'MODEL_EVALUATION_CHECK_UNKNOWN',
  STORAGE_INVALID: 'MODEL_EVALUATION_STORAGE_INVALID',
});

/** خطأ مُسمّى: الرمز للأتمتة والنص العربي لمراجع قرار الرفض. */
export class ModelEvaluationError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   */
  constructor(code, message) {
    super(message);
    this.name = 'ModelEvaluationError';
    /** @type {string} */
    this.code = code;
  }
}

/**
 * @typedef {object} EvaluationCheck
 * @property {string} id
 * @property {boolean} required
 * @property {number} minimumScore
 * @property {string} reason
 */

/**
 * @typedef {object} EvaluationCatalog
 * @property {number} version
 * @property {string} owner
 * @property {ReadonlyMap<string, EvaluationCheck>} checks
 * @property {string} passedState
 * @property {string} failedState
 */

/**
 * @typedef {object} EvaluationResult
 * @property {string} checkId
 * @property {number | null} score
 * @property {boolean} passed
 * @property {boolean} required
 * @property {number} minimumScore
 */

/**
 * @typedef {object} EvaluationRecord
 * @property {string} modelId
 * @property {string} fingerprint
 * @property {string} state
 * @property {string} evaluatedBy
 * @property {string} evaluatedAt
 * @property {string} experimentId
 * @property {readonly EvaluationResult[]} results
 */

/** @param {unknown} error @returns {string} */
function errorText(error) {
  return error instanceof Error ? error.message : String(error);
}

/**
 * يقرأ كتالوج التقييم ويتحقق من مخططه ثم من التماسك الذي لا يكفي المخطط لوصفه.
 * @param {{ dir?: string }} [options]
 * @returns {EvaluationCatalog}
 */
export function loadModelEvaluationCatalog(options = {}) {
  const dir = options.dir ?? DEFAULT_CONFIG_DIR;
  const schemaDir = fs.existsSync(path.join(dir, 'schemas')) ? dir : DEFAULT_CONFIG_DIR;
  const file = path.join(dir, 'model-evaluation.yaml');
  if (!fs.existsSync(file)) {
    throw new ModelEvaluationError(
      MODEL_EVALUATION_ERRORS.CONFIG_MISSING,
      'ملف مجموعة تقييم النماذج غائب؛ التنشيط بلا عتبات معلنة ممنوع.',
    );
  }
  /** @type {unknown} */
  let raw;
  try {
    raw = YAML.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    throw new ModelEvaluationError(
      MODEL_EVALUATION_ERRORS.CONFIG_UNPARSABLE,
      `تعذرت قراءة model-evaluation.yaml: ${errorText(error)}`,
    );
  }
  const schemaPath = path.join(schemaDir, 'schemas', 'model-evaluation.schema.json');
  if (!fs.existsSync(schemaPath)) {
    throw new ModelEvaluationError(
      MODEL_EVALUATION_ERRORS.SCHEMA_MISSING,
      'مخطط مجموعة تقييم النماذج غائب؛ لا تُقبل بيانات غير متحقق منها.',
    );
  }
  const validate = new Ajv2020({ allErrors: true, strict: false }).compile(
    JSON.parse(fs.readFileSync(schemaPath, 'utf8')),
  );
  if (!validate(raw)) {
    const problems = (validate.errors ?? [])
      .map((entry) => `${entry.instancePath || '/'} ${entry.message ?? ''}`.trim())
      .join(' | ');
    throw new ModelEvaluationError(
      MODEL_EVALUATION_ERRORS.CONFIG_INVALID,
      `مجموعة تقييم النماذج تخالف مخططها: ${problems}`,
    );
  }

  const doc =
    /** @type {{ version: number, owner: string, states: Array<{ id: string, terminal: boolean }>, checks: EvaluationCheck[] }} */ (
      raw
    );
  /** @type {string[]} */
  const problems = [];
  /** @type {Map<string, EvaluationCheck>} */
  const checks = new Map();
  for (const check of doc.checks) {
    if (checks.has(check.id)) problems.push(`فحص مكرّر: ${check.id}`);
    checks.set(check.id, Object.freeze({ ...check }));
  }
  const states = new Map(doc.states.map((state) => [state.id, state]));
  if (!states.get('passed')?.terminal) problems.push('حالة passed النهائية غائبة');
  if (!states.get('failed')?.terminal) problems.push('حالة failed النهائية غائبة');
  if (![...checks.values()].some((check) => check.required)) {
    problems.push('لا يوجد فحص إلزامي؛ نتيجة فارغة قد تُقرأ نجاحاً');
  }
  if (problems.length > 0) {
    throw new ModelEvaluationError(
      MODEL_EVALUATION_ERRORS.CATALOG_INCOHERENT,
      `مجموعة تقييم النماذج غير متماسكة: ${problems.join(' | ')}`,
    );
  }
  return Object.freeze({
    version: doc.version,
    owner: doc.owner,
    checks,
    passedState: 'passed',
    failedState: 'failed',
  });
}

/** @param {string} value @returns {boolean} */
function isFingerprint(value) {
  return FINGERPRINT_PATTERN.test(value);
}

export class ModelEvaluationLedger {
  /**
   * @param {{ log?: { append: (type: string, actor: string, payload: object) => unknown }, experiments?: { assertRegistered: (input: { experimentId: string, kind: string, subject: Record<string, string> }) => unknown }, catalog?: EvaluationCatalog, file?: string | null, now?: () => Date }} [deps]
   */
  constructor({ log, experiments, catalog = loadModelEvaluationCatalog(), file = null, now } = {}) {
    if (!log) {
      throw new ModelEvaluationError(
        MODEL_EVALUATION_ERRORS.DEPENDENCY_MISSING,
        'سجل التقييم يحتاج سجل أحداث؛ قرار نجاح أو فشل بلا أثر مدقّق ممنوع.',
      );
    }
    if (!experiments) {
      // البند ME-3 من معيار «تقييم النماذج» (‏M7.08): سجلُّ التقييم لا يُبنى بلا
      // سجل تجارب — كما لا يُبنى بلا سجل أحداث. وقبل هذا الشرط كانت الدرجاتُ
      // تُكتب بلا سندٍ يقول: أيُّ تجربةٍ أنتجتها، ومن أعلن فرضيتَها ومقاييسَها
      // قبل أن يراها. اعتمادٌ اختياريٌّ هنا يعني حاجزاً يُتجاوَز بحذف وسيط.
      throw new ModelEvaluationError(
        MODEL_EVALUATION_ERRORS.DEPENDENCY_MISSING,
        'سجل التقييم يحتاج سجل تجارب؛ درجةٌ بلا تجربةٍ مسجَّلةٍ سابقةٍ لها ممنوعة.',
      );
    }
    this.log = log;
    this.experiments = experiments;
    this.catalog = catalog;
    this.file = file === null ? null : path.resolve(file);
    this.now = now ?? (() => new Date());
    /** @type {Map<string, EvaluationRecord[]>} */
    this.records = new Map();
    this.#load();
  }

  /** يحمّل سجلاً سابقاً إن كان مساره معلناً؛ فسادُه يوقف القراءة ولا ينساه. */
  #load() {
    if (this.file === null || !fs.existsSync(this.file)) return;
    /** @type {unknown} */
    let raw;
    try {
      raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
    } catch (error) {
      throw new ModelEvaluationError(
        MODEL_EVALUATION_ERRORS.STORAGE_INVALID,
        `سجل التقييم الدائم غير مقروء: ${errorText(error)}`,
      );
    }
    if (!Array.isArray(raw)) {
      throw new ModelEvaluationError(
        MODEL_EVALUATION_ERRORS.STORAGE_INVALID,
        'سجل التقييم الدائم ليس قائمة نتائج؛ رفضه يمنع استعمال قرار تالف.',
      );
    }
    for (const entry of raw) {
      const record = /** @type {Partial<EvaluationRecord>} */ (entry);
      if (
        typeof record.modelId !== 'string' ||
        typeof record.fingerprint !== 'string' ||
        !isFingerprint(record.fingerprint) ||
        typeof record.state !== 'string' ||
        typeof record.evaluatedBy !== 'string' ||
        typeof record.evaluatedAt !== 'string' ||
        // نتيجةٌ محفوظةٌ بلا معرّف تجربة سندُها مفقود؛ وقبولُها من الملف كان
        // سيصير الطريقَ الجانبيّ الذي يُبطل شرطَ `record` نفسَه.
        typeof record.experimentId !== 'string' ||
        record.experimentId.trim() === '' ||
        !Array.isArray(record.results)
      ) {
        throw new ModelEvaluationError(
          MODEL_EVALUATION_ERRORS.STORAGE_INVALID,
          'سجل التقييم الدائم يحوي نتيجة ناقصة أو ببصمة غير صالحة أو بلا معرّف تجربة.',
        );
      }
      const saved = /** @type {EvaluationRecord} */ (
        Object.freeze({
          ...record,
          results: Object.freeze(record.results.map((result) => Object.freeze({ ...result }))),
        })
      );
      const existing = this.records.get(saved.modelId) ?? [];
      existing.push(saved);
      this.records.set(saved.modelId, existing);
    }
  }

  /** يكتب السجل ذرياً: انقطاع الكتابة لا يحوّل قراراً قديماً إلى ملف نصف مكتوب. */
  #persist() {
    if (this.file === null) return;
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const all = [...this.records.values()].flat();
    const temporary = `${this.file}.${process.pid}.partial`;
    fs.writeFileSync(temporary, JSON.stringify(all, null, 2));
    fs.renameSync(temporary, this.file);
  }

  /**
   * يسجّل نتيجة كاملة ويرد الحالة المحسوبة من العتبات المعلنة.
   *
   * البندان ME-1 وME-2 (‏M7.08): `experimentId` **واجب**، والتجربةُ تُطابَق نوعاً
   * وموضوعاً **قبل أيّ كتابة أو نشرِ حدث** — فتجربةٌ غيرُ مسجَّلةٍ تُرفض ولا تُخلّف
   * في السجل نتيجةً منقوصةَ السند.
   * @param {{ modelId: string, fingerprint: string, evaluatedBy: string, experimentId: string, results: Array<{ checkId: string, score: number }> }} input
   * @returns {EvaluationRecord}
   */
  record({ modelId, fingerprint, evaluatedBy, experimentId, results }) {
    if (
      typeof modelId !== 'string' ||
      modelId.trim() === '' ||
      typeof fingerprint !== 'string' ||
      !isFingerprint(fingerprint) ||
      typeof evaluatedBy !== 'string' ||
      evaluatedBy.trim() === '' ||
      !Array.isArray(results)
    ) {
      throw new ModelEvaluationError(
        MODEL_EVALUATION_ERRORS.INPUT_INVALID,
        'نتيجة التقييم تحتاج معرّف نموذج وبصمة sha256 ومقيّماً وقائمة درجات صالحة.',
      );
    }
    // الرفضُ يقع هنا: قبل حساب الحالة، وقبل `#persist`، وقبل `log.append`.
    this.experiments.assertRegistered({
      experimentId,
      kind: 'model-evaluation',
      subject: { modelId, fingerprint },
    });
    /** @type {Map<string, number>} */
    const scores = new Map();
    for (const result of results) {
      if (
        !result ||
        typeof result.checkId !== 'string' ||
        !Number.isFinite(result.score) ||
        result.score < 0 ||
        result.score > 1
      ) {
        throw new ModelEvaluationError(
          MODEL_EVALUATION_ERRORS.INPUT_INVALID,
          'كل نتيجة تحتاج معرّف فحص ودرجة بين صفر وواحد.',
        );
      }
      if (!this.catalog.checks.has(result.checkId)) {
        throw new ModelEvaluationError(
          MODEL_EVALUATION_ERRORS.CHECK_UNKNOWN,
          `الفحص «${result.checkId}» غير معلَن في مجموعة التقييم.`,
        );
      }
      if (scores.has(result.checkId)) {
        throw new ModelEvaluationError(
          MODEL_EVALUATION_ERRORS.RESULT_DUPLICATE,
          `الفحص «${result.checkId}» ورد مرتين؛ لا يُختار بين درجتين بصمت.`,
        );
      }
      scores.set(result.checkId, result.score);
    }
    const detailed = [...this.catalog.checks.values()].map((check) => {
      const score = scores.get(check.id) ?? null;
      return Object.freeze({
        checkId: check.id,
        score,
        passed: score !== null && score >= check.minimumScore,
        required: check.required,
        minimumScore: check.minimumScore,
      });
    });
    const failedRequired = detailed.some((result) => result.required && !result.passed);
    const state = failedRequired ? this.catalog.failedState : this.catalog.passedState;
    const record = /** @type {EvaluationRecord} */ (
      Object.freeze({
        modelId,
        fingerprint,
        state,
        evaluatedBy,
        evaluatedAt: this.now().toISOString(),
        experimentId,
        results: Object.freeze(detailed),
      })
    );
    const existing = this.records.get(modelId) ?? [];
    existing.push(record);
    this.records.set(modelId, existing);
    this.#persist();
    this.log.append(`model.evaluation.${state}`, evaluatedBy, {
      modelId,
      fingerprint,
      experimentId,
      state,
      requiredChecksPassed: !failedRequired,
      results: detailed,
    });
    return record;
  }

  /**
   * آخر نتيجة لهذا النموذج وهذه البصمة فقط؛ نتيجة بصمة أخرى ليست تصريحاً عاماً.
   * @param {string} modelId
   * @param {string} fingerprint
   * @returns {EvaluationRecord | null}
   */
  latestFor(modelId, fingerprint) {
    const matches = (this.records.get(modelId) ?? []).filter(
      (record) => record.fingerprint === fingerprint,
    );
    return matches.length === 0 ? null : (matches[matches.length - 1] ?? null);
  }

  /** @param {string} modelId @param {string} fingerprint @returns {boolean} */
  isPassed(modelId, fingerprint) {
    return this.latestFor(modelId, fingerprint)?.state === this.catalog.passedState;
  }
}

/** @param {ConstructorParameters<typeof ModelEvaluationLedger>[0]} deps @returns {ModelEvaluationLedger} */
export function createModelEvaluationLedger(deps) {
  return new ModelEvaluationLedger(deps);
}
