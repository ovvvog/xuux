/**
 * حكمُ تمرينِ الطوارئ — الخطوة `M11.07`.
 *
 * الضماناتُ المُنفَّذةُ هنا ثلاثةٌ:
 *
 * - `G-EMERGENCY-PURE-JUDGEMENT`: هذه الوحدةُ **لا تلمس قرصاً ولا تُشغِّل عمليّةً
 *   ولا تقرأ ساعةَ جهازٍ**. تُعطى وقائعَ جُمِعت في `scripts/lib/emergency-facts.mjs`
 *   فتحكم عليها. والسببُ ليس أناقةً معماريّةً: حكمٌ يملك أن يكتب على ما يفحصه
 *   يملك أن يُصلِحه ثم يُثني عليه، والفصلُ يجعل ذلك مستحيلاً لا مكروهاً.
 * - `G-EMERGENCY-EVERY-PHASE-EXECUTED`: تمرينٌ ينقصه طورٌ واحدٌ يُحكَم **غيرَ
 *   مقيسٍ** برمزِ خروجٍ موجبٍ، ولا يُقرأ نقصانُ طورٍ نجاحاً جزئيّاً.
 * - `G-EMERGENCY-PER-PHASE-TIMED`: لكلِّ طورٍ زمنٌ مقيسٌ يُحاسَب على عهدِه
 *   المكتوبِ في العقدِ، وتقريرٌ ينقصه زمنُ طورٍ يُحكَم غيرَ مقيس.
 *
 * **وثلاثيّةُ الحكمِ مقصودةٌ:** «جاهزٌ» و«مُخفِقٌ» و«غيرُ مقيسٍ» ثلاثةٌ لا اثنان،
 * لأنّ الفرقَ بين «قِسنا فوجدنا خللاً» و«لم نَقِس» فرقٌ جوهريٌّ في الطوارئ:
 * الأوّلُ يُصلَح، والثاني يُخيف. ودمجُهما في «فاشلٍ» واحدٍ يُخفي أخطرَهما.
 *
 * @module emergency/judgement
 */

import { EMERGENCY_ERRORS, EmergencyError } from './errors.mjs';
import { assertPhaseSequence } from './phase-plan.mjs';

/** حكمُ الجاهزيّةِ. */
export const VERDICT_READY = 'emergency:ready';
/** حكمُ الإخفاقِ المقيسِ: قِسنا فوجدنا إنفاذاً لم يقع أو زمناً جاوز عهدَه. */
export const VERDICT_FAILED = 'emergency:failed';
/** حكمُ انعدامِ القياسِ: لم يقع قياسٌ صالحٌ أصلاً — ولا يُقرأ هذا الصمتُ جاهزيّةً. */
export const VERDICT_UNMEASURED = 'emergency:unmeasured';

/**
 * @typedef {object} PhaseOutcome
 * @property {string} phase معرَّفُ الطورِ كما في العقد.
 * @property {number} ms الزمنُ المقيسُ بالملّي ثانية.
 * @property {boolean} enforced هل وقع الإنفاذُ المعلَنُ للطورِ فعلاً؟
 * @property {string} evidence دليلُ الإنفاذِ بلغةٍ تُقرأ — رمزُ رفضٍ رُدَّ به فعلٌ أو حالةٌ قُرِئت من قرص.
 * @property {string} [failureCode] رمزُ الرفضِ إن لم يقع الإنفاذ.
 */

/**
 * @typedef {object} EmergencyJudgement
 * @property {string} verdict
 * @property {number} totalMs
 * @property {number} objectiveMs
 * @property {{ phase: string, ms: number, maxMs: number, enforced: boolean, withinBudget: boolean, evidence: string }[]} phases
 * @property {{ code: string, message: string }[]} reasons
 */

/**
 * @param {number} value
 * @returns {boolean}
 */
function isMeasuredMs(value) {
  return Number.isFinite(value) && Number.isInteger(value) && value >= 0;
}

/**
 * يحكم على تمرينٍ من وقائعِه المقيسةِ وحدَها.
 *
 * @param {import('./contract.mjs').EmergencyContract} contract
 * @param {{ phases: PhaseOutcome[], reportPhaseIds?: string[] }} facts
 * @returns {EmergencyJudgement}
 */
export function judgeDrill(contract, facts) {
  /** @type {{ code: string, message: string }[]} */
  const reasons = [];
  const outcomes = facts.phases ?? [];

  // ① الساعةُ أوّلاً: زمنٌ غيرُ منتهٍ يجعل كلَّ حسابٍ بعده وهماً، فيُحكَم غيرَ مقيس.
  for (const outcome of outcomes) {
    if (!isMeasuredMs(outcome.ms)) {
      reasons.push({
        code: EMERGENCY_ERRORS.CLOCK_INVALID,
        message: `الطورُ «${outcome.phase}» بزمنٍ غيرِ مقيسٍ (${String(outcome.ms)}) — وساعةٌ لا تُصدر عدداً منتهياً تجعل كلَّ حسابٍ بعدها وهماً.`,
      });
    }
  }
  if (reasons.length > 0) {
    return finalize(contract, VERDICT_UNMEASURED, outcomes, reasons);
  }

  // ② اكتمالُ السلسلةِ وترتيبُها — نقصانُ طورٍ انعدامُ قياسٍ لا نجاحٌ جزئيّ.
  try {
    assertPhaseSequence(contract, outcomes);
  } catch (error) {
    const emergency = error instanceof EmergencyError ? error : undefined;
    reasons.push({
      code: emergency?.code ?? EMERGENCY_ERRORS.PHASE_SKIPPED,
      message: emergency?.message ?? String(error),
    });
    return finalize(contract, VERDICT_UNMEASURED, outcomes, reasons);
  }

  // ③ تقريرٌ ينقصه زمنُ طورٍ واحدٍ: غيرُ مقيسٍ — فالتقريرُ هو الدليلُ الباقي بعد
  //    أن تنتهي العمليّةُ، وما لم يُكتَب فيه لم يُقَس عمليّاً.
  if (facts.reportPhaseIds !== undefined) {
    const missing = contract.phases
      .map((phase) => phase.id)
      .filter((id) => !facts.reportPhaseIds?.includes(id));
    if (missing.length > 0) {
      reasons.push({
        code: EMERGENCY_ERRORS.REPORT_INCOMPLETE,
        message: `التقريرُ لا يحمل زمنَ الأطوارِ: ${missing.join('، ')} — وتقريرٌ ينقصه زمنُ طورٍ يُحكَم غيرَ مقيسٍ لا ناجحاً.`,
      });
      return finalize(contract, VERDICT_UNMEASURED, outcomes, reasons);
    }
  }

  // ④ الإنفاذُ: طورٌ لم يقع إنفاذُه إخفاقٌ **مقيسٌ** برمزِه المعلَن.
  for (const outcome of outcomes) {
    if (!outcome.enforced) {
      reasons.push({
        code: outcome.failureCode ?? EMERGENCY_ERRORS.PHASE_SKIPPED,
        message: `الطورُ «${outcome.phase}» لم يقع إنفاذُه: ${outcome.evidence}`,
      });
    }
  }

  // ⑤ العهودُ: زمنُ كلِّ طورٍ ثم زمنُ التمرينِ كلِّه.
  let totalMs = 0;
  for (const outcome of outcomes) {
    totalMs += outcome.ms;
    const declared = contract.phases.find((phase) => phase.id === outcome.phase);
    if (declared !== undefined && outcome.ms > declared.maxMs) {
      reasons.push({
        code: EMERGENCY_ERRORS.TIME_EXCEEDED,
        message: `الطورُ «${outcome.phase}» استغرق ${outcome.ms}ms وعهدُه ${declared.maxMs}ms.`,
      });
    }
  }
  if (totalMs > contract.objective.maxDrillMs) {
    reasons.push({
      code: EMERGENCY_ERRORS.TIME_EXCEEDED,
      message: `التمرينُ استغرق ${totalMs}ms وعهدُه ${contract.objective.maxDrillMs}ms — وتجاوزُ العهدِ إخفاقٌ مُعلَنٌ لا تحذيرٌ يُقرأ ويُنسى.`,
    });
  }

  return finalize(
    contract,
    reasons.length === 0 ? VERDICT_READY : VERDICT_FAILED,
    outcomes,
    reasons,
  );
}

/**
 * @param {import('./contract.mjs').EmergencyContract} contract
 * @param {string} verdict
 * @param {PhaseOutcome[]} outcomes
 * @param {{ code: string, message: string }[]} reasons
 * @returns {EmergencyJudgement}
 */
function finalize(contract, verdict, outcomes, reasons) {
  return {
    verdict,
    totalMs: outcomes.reduce(
      (sum, outcome) => sum + (isMeasuredMs(outcome.ms) ? outcome.ms : 0),
      0,
    ),
    objectiveMs: contract.objective.maxDrillMs,
    phases: outcomes.map((outcome) => {
      const declared = contract.phases.find((phase) => phase.id === outcome.phase);
      const maxMs = declared?.maxMs ?? 0;
      return {
        phase: outcome.phase,
        ms: outcome.ms,
        maxMs,
        enforced: outcome.enforced === true,
        withinBudget: isMeasuredMs(outcome.ms) && maxMs > 0 && outcome.ms <= maxMs,
        evidence: outcome.evidence,
      };
    }),
    reasons,
  };
}
