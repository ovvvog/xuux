/**
 * دفترُ الانحرافاتِ وحكمُ إغلاقِها — الخطوة `M10.09`.
 *
 * **الضمان `G-CHAOS-DEVIATION-CLOSED`:** كلُّ انحرافٍ ظهر في تجربةٍ يُقيَّد
 * برمزِ انحرافِ تجربتِه، ولا يُعَدُّ **مُغلَقاً** إلا بمُدخلةِ عملٍ في
 * `docs/roadmap/05-work-log.md` تشرح إصلاحَ **سببِه** لا عرضِه؛ وانحرافٌ مفتوحٌ
 * يُوجب حكمَ رفضٍ برمزِ خروجٍ موجبٍ.
 *
 * **ولماذا هذا القيدُ بنيةٌ لا أدبٌ؟** لأنّ تجربةَ فوضى تُنتِج اكتشافاتٍ
 * مُزعجةً في أسوأِ الأوقاتِ، وأسهلُ ما يُفعَل بها أن تُكتَب «ملاحظةً» في تقريرٍ
 * ثم تُنسى، فيُخضَّر المسارُ ويبقى العطبُ. فمن قيَّد انحرافاً ولم يُغلِقه لا
 * يستطيع أن يُخرِج صفراً — لا لأنّ الأدبَ يمنعه، بل لأنّ الحكمَ يُحسَب من
 * الدفترِ فيرفض.
 *
 * وهذا الملفُّ **نقيٌّ**: لا قرصَ ولا عمليّةَ ولا ساعةَ جهازٍ؛ يستقبل العقدَ
 * والنتائجَ فيردُّ انحرافاتٍ مقروءةً.
 *
 * @module chaos/deviation
 */

import { CHAOS_ERRORS, ChaosError } from './errors.mjs';

/**
 * @typedef {import('./contract.mjs').ChaosContract} ChaosContract
 * @typedef {import('./contract.mjs').ChaosDeviation} ChaosDeviation
 * @typedef {import('./experiment-plan.mjs').ExperimentResult} ExperimentResult
 */

/**
 * @typedef {object} DeviationRecord
 * @property {string} code رمزُ انحرافِ التجربة.
 * @property {string} experiment معرَّفُ التجربةِ التي أُخلِفت فرضيّتُها.
 * @property {string} evidence الدليلُ المقيسُ الذي أظهر الإخلاف.
 * @property {boolean} closed أمُغلَقٌ بمُدخلةِ عملٍ مُقيَّدةٍ في العقد؟
 * @property {string | null} closedBy مُدخلةُ العملِ التي تُغلِقه، أو `null`.
 * @property {string | null} fixedIn ملفُّ الإصلاحِ المُقيَّد، أو `null`.
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
 * قيدُ الانحرافاتِ من نتائجِ تشغيلٍ: كلُّ فرضيّةٍ أُخلِفت انحرافٌ برمزِ
 * تجربتِه، ويُوسَم مُغلَقاً إن كان في دفترِ العقدِ ما يُغلِقه.
 *
 * @param {ChaosContract} contract
 * @param {ReadonlyArray<ExperimentResult>} results
 * @returns {ReadonlyArray<DeviationRecord>}
 */
export function recordDeviations(contract, results) {
  /** @type {Map<string, string>} */
  const codeByExperiment = new Map(
    contract.experiments.map((experiment) => [experiment.id, experiment.deviationCode]),
  );
  /** @type {Map<string, ChaosDeviation>} */
  const closures = new Map(contract.deviations.map((entry) => [entry.code, entry]));
  /** @type {DeviationRecord[]} */
  const records = [];
  for (const result of results) {
    if (result.upheld && result.injected) {
      continue;
    }
    const code = codeByExperiment.get(result.experiment);
    if (code === undefined) {
      refuse(
        CHAOS_ERRORS.DEVIATION_UNDECLARED,
        `انحرافٌ في تجربةٍ غيرِ معلَنةٍ «${result.experiment}» — ولا يُقيَّد انحرافٌ بلا رمزٍ معلَن.`,
        { experiment: result.experiment },
      );
    }
    const closure = closures.get(code);
    records.push(
      Object.freeze({
        code,
        experiment: result.experiment,
        evidence: result.evidence,
        closed: closure !== undefined,
        closedBy: closure?.closedBy ?? null,
        fixedIn: closure?.fixedIn ?? null,
      }),
    );
  }
  return Object.freeze(records);
}

/**
 * ردُّ الانحرافاتِ المفتوحةِ بخطأٍ صريحٍ لمن أراد بوابةً لا تقريراً — الضمان
 * `G-CHAOS-DEVIATION-CLOSED`.
 *
 * @param {ReadonlyArray<DeviationRecord>} deviations
 * @returns {ReadonlyArray<DeviationRecord>}
 */
export function assertDeviationsClosed(deviations) {
  const open = deviations.filter((entry) => !entry.closed);
  if (open.length > 0) {
    refuse(
      CHAOS_ERRORS.DEVIATION_UNCLOSED,
      `انحرافاتٌ مفتوحةٌ بلا مُدخلةِ عملٍ تُغلِقها: ${open.map((entry) => entry.code).join('، ')} — وانحرافٌ مفتوحٌ رفضٌ لا ملاحظةٌ تُقرأ وتُنسى.`,
      { open: open.map((entry) => entry.code) },
    );
  }
  return deviations;
}

/**
 * مُدخلاتُ دفترِ العقدِ التي تُغلِق انحرافاً — تُقرأ لتُعرَض في التقريرِ
 * وليُثبت الحاجزُ ربطَها بملفِّ إصلاحٍ قائم.
 *
 * @param {ChaosContract} contract
 * @param {string} code
 * @returns {ChaosDeviation}
 */
export function requireClosure(contract, code) {
  const closure = contract.deviations.find((entry) => entry.code === code);
  if (closure === undefined) {
    refuse(
      CHAOS_ERRORS.DEVIATION_UNLINKED,
      `الانحراف «${code}» بلا مُدخلةٍ في دفترِ الانحرافاتِ — ولا إغلاقَ بلا قيد.`,
      { deviation: code },
    );
  }
  return closure;
}
