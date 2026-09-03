/**
 * خطّةُ التجاربِ مرتَّبةً وحكمُ اكتمالِها — الخطوة `M10.09`.
 *
 * **لماذا خطّةٌ أصلاً؟** لأنّ تجربةَ فوضى تُختار بالمزاجِ تجربةٌ تُجرى حين
 * يكون النظامُ مستريحاً وتُترك حين يكون مشغولاً. فالخطّةُ تُشتقُّ من العقدِ
 * **بترتيبِه المعلَنِ**، ويُقاس اكتمالُها بمطابقةِ **مجموعةِ ما جرى** بمجموعةِ
 * ما أُعلِن: تجربةٌ معلَنةٌ بلا نتيجةٍ تُرَدُّ بـ`CHAOS_RESULT_MISSING`، ونتيجةٌ
 * بمعرَّفٍ غريبٍ تُرَدُّ بـ`CHAOS_EXPERIMENT_UNDECLARED` — فـ«أجرينا أهمَّها»
 * ليست جملةً يقبلها هذا الملفّ.
 *
 * وهذا الملفُّ **نقيٌّ**: يستقبل العقدَ والنتائجَ ويردُّ حكماً، ولا يلمس قرصاً
 * ولا يُشغِّل عمليّةً ولا يقرأ ساعةَ جهاز.
 *
 * @module chaos/experiment-plan
 */

import { CHAOS_ERRORS, ChaosError } from './errors.mjs';

/**
 * @typedef {import('./contract.mjs').ChaosContract} ChaosContract
 * @typedef {import('./contract.mjs').ChaosExperiment} ChaosExperiment
 */

/**
 * @typedef {object} ExperimentResult
 * @property {string} experiment معرَّفُ التجربةِ كما أُعلِن في العقد.
 * @property {boolean} injected أوَقَع حقنُ العطبِ فعلاً؟
 * @property {boolean} upheld أصمدت الفرضيّةُ بقياسٍ مقروء؟
 * @property {string} evidence نصُّ الدليلِ المقيسِ — رقمٌ أو رمزُ رفضٍ أو عددُ سطور.
 * @property {string | null} [unavailable] سببُ عدمِ توافرِ أداةِ الحقنِ إن لم تتوفّر.
 */

/**
 * @param {string} code
 * @param {string} message
 * @param {Record<string, unknown>} [detail]
 * @returns {never}
 */
function refuse(code, message, detail = {}) {
  throw new ChaosError(code, message, detail);
}

/**
 * خطّةُ التجاربِ مرتَّبةً بترتيبِ العقدِ المعلَن.
 *
 * @param {ChaosContract} contract
 * @returns {ReadonlyArray<ChaosExperiment>}
 */
export function planExperiments(contract) {
  return Object.freeze([...contract.experiments].sort((left, right) => left.order - right.order));
}

/**
 * التحقّقُ من صلاحيةِ نتيجةِ تجربةٍ بنيةً — فنتيجةٌ ناقصةُ الحقولِ لا يُبنى
 * عليها حكمُ صمود.
 *
 * @param {unknown} value
 * @returns {ExperimentResult}
 */
export function assertResult(value) {
  if (typeof value !== 'object' || value === null) {
    refuse(CHAOS_ERRORS.RESULT_INVALID, 'نتيجةُ التجربةِ ليست كائناً.');
  }
  const entry = /** @type {Record<string, unknown>} */ (value);
  if (typeof entry.experiment !== 'string' || entry.experiment === '') {
    refuse(CHAOS_ERRORS.RESULT_INVALID, 'نتيجةٌ بلا معرَّفِ تجربة.');
  }
  for (const field of ['injected', 'upheld']) {
    if (typeof entry[field] !== 'boolean') {
      refuse(
        CHAOS_ERRORS.RESULT_INVALID,
        `نتيجةُ «${entry.experiment}» بلا حقلِ «${field}» منطقيٍّ — ولا يُقرأ الغيابُ صموداً.`,
        { experiment: entry.experiment },
      );
    }
  }
  if (typeof entry.evidence !== 'string' || entry.evidence.trim() === '') {
    refuse(
      CHAOS_ERRORS.RESULT_INVALID,
      `نتيجةُ «${entry.experiment}» بلا دليلٍ مقيسٍ — والمادةُ 2 تمنع دعوىً بلا دليلٍ قابلٍ للتشغيل.`,
      { experiment: entry.experiment },
    );
  }
  return /** @type {ExperimentResult} */ (value);
}

/**
 * مطابقةُ ما جرى بما أُعلِن — لا نقصَ ولا زيادة.
 *
 * @param {ChaosContract} contract
 * @param {ReadonlyArray<unknown>} results
 * @returns {ReadonlyArray<ExperimentResult>}
 */
export function assertPlanCovered(contract, results) {
  /** @type {ExperimentResult[]} */
  const checked = results.map((raw) => assertResult(raw));
  const declared = new Set(contract.experiments.map((experiment) => experiment.id));
  /** @type {Set<string>} */
  const seen = new Set();
  for (const result of checked) {
    if (!declared.has(result.experiment)) {
      refuse(
        CHAOS_ERRORS.EXPERIMENT_UNDECLARED,
        `نتيجةٌ لتجربةٍ غيرِ معلَنةٍ «${result.experiment}» — وتجربةٌ بلا عقدٍ نتيجتُها لا تُقارَن بفرضيّة.`,
        { experiment: result.experiment },
      );
    }
    if (seen.has(result.experiment)) {
      refuse(
        CHAOS_ERRORS.RESULT_INVALID,
        `للتجربة «${result.experiment}» نتيجتان في تشغيلٍ واحدٍ — وأيُّهما يُقرأ حكماً؟`,
        { experiment: result.experiment },
      );
    }
    seen.add(result.experiment);
  }
  for (const experiment of contract.experiments) {
    if (!seen.has(experiment.id)) {
      refuse(
        CHAOS_ERRORS.RESULT_MISSING,
        `التجربة «${experiment.id}» معلَنةٌ ولم تُنفَّذ في هذا التشغيلِ — وغيابُ القياسِ ليس صموداً.`,
        { experiment: experiment.id },
      );
    }
  }
  return Object.freeze(checked);
}
