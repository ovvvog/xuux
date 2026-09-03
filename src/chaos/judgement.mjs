/**
 * حكمُ تشغيلِ الفوضى — الخطوة `M10.09`.
 *
 * **الضمان `G-CHAOS-PURE-JUDGEMENT`:** هذا الملفُّ **لا يستورد قرصاً ولا عمليّةً ولا يقرأ
 * ساعةَ جهازٍ**؛ فوحدةٌ تملك أن تقتل عمليّةً وتملأ قرصاً هي نفسُها التي تحكم
 * على الصمودِ تستطيع — عند أوّلِ حمرةٍ — أن تُلطِّف العطبَ قليلاً ثم تُثني على
 * الصمود. فالحقنُ في جامعِ الوقائع، والحكمُ هنا، والفصلُ بينهما بنيةٌ يقرؤها
 * الحاجزُ نصّاً.
 *
 * وثلاثةُ أحكامٍ لا أكثر:
 *   `chaos:resilient` — التجاربُ المعلَنةُ كلُّها جرت، وفرضيّاتُها صمدت، ولا
 *       انحرافَ مفتوحاً. وهو **وحدَه** يخرج صفراً.
 *   `chaos:deviated` — فرضيّةٌ أُخلِفت أو انحرافٌ مفتوحٌ في الدفتر.
 *   `chaos:unmeasured` — تجربةٌ لم يقع حقنُها أصلاً (أداةُ حقنٍ غيرُ متاحةٍ في
 *       البيئةِ مثلاً) فلا قياسَ يُحتَجُّ به؛ **ولا يُقرأ هذا الصمتُ صموداً**.
 *
 * وترتيبُ الأولويّةِ مقصودٌ: **غيرُ المقيسِ يُقدَّم على الانحرافِ** لأنّ من لم
 * يَقِس لا يعلم أصمدَ أم انحرف، فادّعاءُ الانحرافِ مع غيابِ القياسِ ادّعاءُ
 * علمٍ لا يملكه.
 *
 * @module chaos/judgement
 */

import { RESILIENT_VERDICT } from './contract.mjs';
import { recordDeviations } from './deviation.mjs';

/**
 * @typedef {import('./contract.mjs').ChaosContract} ChaosContract
 * @typedef {import('./experiment-plan.mjs').ExperimentResult} ExperimentResult
 * @typedef {import('./deviation.mjs').DeviationRecord} DeviationRecord
 */

/** حكمُ الانحراف. */
export const DEVIATED_VERDICT = 'chaos:deviated';

/** حكمُ عدمِ القياس. */
export const UNMEASURED_VERDICT = 'chaos:unmeasured';

/**
 * @typedef {object} ChaosRunJudgement
 * @property {string} verdict
 * @property {number} experiments عددُ التجاربِ التي جرى حقنُها فعلاً.
 * @property {number} upheld عددُ الفرضيّاتِ التي صمدت.
 * @property {ReadonlyArray<DeviationRecord>} deviations
 * @property {ReadonlyArray<string>} open رموزُ الانحرافاتِ المفتوحة.
 * @property {string} reason
 */

/**
 * الحكمُ على تشغيلٍ كاملٍ من نتائجِه ومن دفترِ انحرافاتِ العقد.
 *
 * @param {object} input
 * @param {ChaosContract} input.contract
 * @param {ReadonlyArray<ExperimentResult>} input.results
 * @returns {ChaosRunJudgement}
 */
export function judgeRun({ contract, results }) {
  const deviations = recordDeviations(contract, results);
  const open = deviations.filter((entry) => !entry.closed).map((entry) => entry.code);
  const injected = results.filter((entry) => entry.injected);
  const upheld = results.filter((entry) => entry.upheld && entry.injected);
  const notInjected = results.filter((entry) => !entry.injected);

  if (notInjected.length > 0) {
    return Object.freeze({
      verdict: UNMEASURED_VERDICT,
      experiments: injected.length,
      upheld: upheld.length,
      deviations,
      open: Object.freeze(open),
      reason: `لم يقع حقنُ العطبِ في: ${notInjected
        .map((entry) => `${entry.experiment} (${entry.unavailable ?? entry.evidence})`)
        .join('، ')} — ومن لم يَقِس لا يقول صمدتُ.`,
    });
  }
  if (open.length > 0) {
    return Object.freeze({
      verdict: DEVIATED_VERDICT,
      experiments: injected.length,
      upheld: upheld.length,
      deviations,
      open: Object.freeze(open),
      reason: `انحرافاتٌ مفتوحةٌ بلا مُدخلةِ عملٍ تُغلِقها: ${open.join('، ')}.`,
    });
  }
  if (deviations.length > 0) {
    return Object.freeze({
      verdict: DEVIATED_VERDICT,
      experiments: injected.length,
      upheld: upheld.length,
      deviations,
      open: Object.freeze(open),
      reason: `فرضيّاتٌ أُخلِفت في هذا التشغيلِ: ${deviations
        .map((entry) => `${entry.experiment}⇐${entry.code}`)
        .join('، ')} — وإن كان لها إصلاحٌ مُقيَّدٌ فالإخلافُ **الآن** انحرافٌ يُحكَم به.`,
    });
  }
  return Object.freeze({
    verdict: RESILIENT_VERDICT,
    experiments: injected.length,
    upheld: upheld.length,
    deviations,
    open: Object.freeze(open),
    reason: `التجاربُ ${String(injected.length)} جرت بعطبٍ محقونٍ حقيقيٍّ وصمدت فرضيّاتُها كلُّها، ولا انحرافَ مفتوحاً في الدفتر.`,
  });
}
