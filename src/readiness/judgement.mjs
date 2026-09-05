/**
 * حكمُ تقريرِ الجاهزيّةِ — الخطوة `M11.08`.
 *
 * معيارُ القبولِ بحرفِه: **«صفرُ بندٍ بلا دليلٍ أو بلا تأجيلٍ معلَنٍ»**. فالحكمُ
 * هنا ثلاثيٌّ لا ثنائيٌّ:
 *
 *   `readiness:reported`   — كلُّ بندٍ مقابَلٌ: مُنجَزٌ بدليلٍ يُشار إلى موضعِه، أو
 *                            غيرُ منجَزٍ بتأجيلٍ مُصرَّحٍ كاملِ الحقولِ.
 *   `readiness:incomplete` — بندٌ بلا دليلٍ ولا تأجيلٍ، أو تأجيلٌ ناقصٌ أو يتيمٌ.
 *   `readiness:unmeasured` — لم يُقَسْ أصلاً: مصدرٌ غائبٌ أو عددُ بنودٍ مخالفٌ
 *                            للمُعلَنِ. **والصمتُ لا يُقرأ نجاحاً.**
 *
 * وفارقُ «غيرِ المقيسِ» عن «الناقصِ» مقصودٌ: من دمجَ الرمزَينِ صار عندَه عطبٌ في
 * أداةِ القياسِ يُقرأ نقصاً في المشروعِ، أو نقصٌ في المشروعِ يُقرأ عطباً في الأداةِ.
 *
 * **والضمانُ `G-READINESS-EVERY-ITEM-COVERED` يُنفَّذ هنا:** كلُّ بندٍ مقروءٍ يظهر
 * بحالتِه، وبندٌ بلا دليلٍ ولا تأجيلٍ يُصدِر `readiness:incomplete` — فتقريرٌ يسكتُ
 * عن بندٍ يُخفي أضعفَ حلقةٍ فيه.
 *
 * والوحدةُ **نقيّةٌ**: وقائعٌ تدخل وحكمٌ يخرج — بلا قرصٍ ولا ساعةٍ ولا عمليّاتٍ.
 *
 * @module readiness/judgement
 */

import { READINESS_ERRORS } from './errors.mjs';

/** الحكمُ الوحيدُ المسموحُ له بالخروجِ صفراً. */
export const REPORTED_VERDICT = 'readiness:reported';

/**
 * @typedef {object} CoveredItem
 * @property {string} id
 * @property {string} kind
 * @property {string} title
 * @property {string} statusMark
 * @property {'evidenced' | 'deferred' | 'uncovered'} coverage
 * @property {import('./evidence.mjs').EvidenceRef[]} evidence
 * @property {import('./deferrals.mjs').DeferralRecord | null} deferral
 */

/**
 * @typedef {object} ReadinessJudgement
 * @property {string} verdict
 * @property {{ total: number, evidenced: number, deferred: number, uncovered: number }} coverage
 * @property {{ code: string, id: string, evidence: string }[]} faults
 */

/**
 * @param {{ items: CoveredItem[], deferralFaults: {code: string, id: string, evidence: string}[], countFaults: {code: string, id: string, evidence: string}[] }} facts
 * @returns {ReadinessJudgement}
 */
export function judgeReadiness(facts) {
  const items = Array.isArray(facts.items) ? facts.items : [];
  const coverage = {
    total: items.length,
    evidenced: items.filter((item) => item.coverage === 'evidenced').length,
    deferred: items.filter((item) => item.coverage === 'deferred').length,
    uncovered: items.filter((item) => item.coverage === 'uncovered').length,
  };

  /** @type {{ code: string, id: string, evidence: string }[]} */
  const faults = [...facts.countFaults, ...facts.deferralFaults];
  for (const item of items) {
    if (item.coverage !== 'uncovered') continue;
    faults.push({
      code: READINESS_ERRORS.ITEM_UNCOVERED,
      id: item.id,
      evidence:
        item.statusMark === '✅'
          ? 'بندٌ مُعلَنٌ مُنجَزاً ولا مُدخلةَ سجلٍّ ولا صفَّ أدلّةٍ يُشار إليه — إنجازٌ بلا دليلٍ.'
          : 'بندٌ غيرُ منجَزٍ بلا تأجيلٍ مُصرَّحٍ — نقصٌ يمرُّ بصمتٍ.',
    });
  }

  if (facts.countFaults.length > 0 || coverage.total === 0) {
    return { verdict: 'readiness:unmeasured', coverage, faults };
  }
  if (faults.length > 0) {
    return { verdict: 'readiness:incomplete', coverage, faults };
  }
  return { verdict: REPORTED_VERDICT, coverage, faults };
}

/**
 * رمزُ الخروجِ من العقدِ لا من ذاكرةِ الكاتبِ؛ وحكمٌ غيرُ معلَنٍ يُرفَض.
 *
 * @param {{ verdicts: { id: string, exitCode: number }[] }} contract
 * @param {string} verdict
 * @returns {number}
 */
export function exitCodeFor(contract, verdict) {
  const declared = contract.verdicts.find((entry) => entry.id === verdict);
  if (declared === undefined) {
    throw new Error(`${READINESS_ERRORS.VERDICT_UNDECLARED}: حكمٌ غيرُ معلَنٍ «${verdict}»`);
  }
  return declared.exitCode;
}
