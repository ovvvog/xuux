/**
 * حكمُ تجربةِ التعافي — الخطوة `M10.08`.
 *
 * **الضمان `G-RECOVERY-NO-EMPTY-SUCCESS`:** تجربةٌ بلا قياسٍ صالحٍ تُحكَم
 * `recovery:unmeasured` برمزِ خروجٍ **موجبٍ**، ولا تُقرأ بلوغاً للعهد. فالصمتُ
 * ليس نجاحاً، وأخطرُ إخفاقٍ ما لبس ثوبَ السكون.
 *
 * **الضمان `G-RECOVERY-PURE-JUDGEMENT`:** هذا الملفُّ لا يلمس قرصاً ولا يُشغِّل
 * عمليّةً ولا يقرأ ساعةَ جهازٍ؛ فالحاكمُ الذي يلمس ما يفحصه يستطيع أن يُصلِحه
 * سرّاً ثم يُثني على نفسه.
 *
 * @module recovery/judgement
 */

import { exitCodeFor } from './contract.mjs';
import { RECOVERY_ERRORS, RecoveryError } from './errors.mjs';

/**
 * @typedef {import('./contract.mjs').RecoveryContract} RecoveryContract
 */

/**
 * @typedef {object} RecoveryMeasurement
 * @property {number | undefined} totalMs زمنُ التعافي المقيسُ كاملاً، أو `undefined` إن لم يقع قياس.
 * @property {number} files عددُ الملفّاتِ المُستعادةِ المُطابَقةِ بالبصمة.
 * @property {boolean} verified هل جرت المطابقةُ بالبصمةِ ثم القراءةُ من المُستعاد.
 * @property {number} phases عددُ الأطوارِ المنفَّذةِ بترتيبِها.
 */

/**
 * @typedef {object} RecoveryJudgement
 * @property {string} verdict
 * @property {number} exitCode
 * @property {number | undefined} totalMs
 * @property {number} maxRecoveryMs
 * @property {number} maxDataLossMs
 * @property {number} files
 * @property {string} statement
 */

/**
 * الحكمُ على تجربةٍ من قياسِها وعهدِ العقد.
 *
 * @param {RecoveryContract} contract
 * @param {RecoveryMeasurement} measurement
 * @returns {RecoveryJudgement}
 */
export function judgeRecovery(contract, measurement) {
  const target = contract.objective.maxRecoveryMs;
  const base = {
    maxRecoveryMs: target,
    maxDataLossMs: contract.maxDataLossMs,
    files: measurement.files,
  };
  const expectedPhases = contract.phases.length;

  if (
    measurement.totalMs === undefined ||
    !Number.isFinite(measurement.totalMs) ||
    measurement.totalMs < 0 ||
    !measurement.verified ||
    measurement.files === 0 ||
    measurement.phases !== expectedPhases
  ) {
    return Object.freeze({
      ...base,
      verdict: 'recovery:unmeasured',
      exitCode: exitCodeFor(contract, 'recovery:unmeasured'),
      totalMs: measurement.totalMs,
      statement:
        'لم يقع قياسٌ صالحٌ للتعافي: طورٌ لم يُنفَّذ، أو مطابقةٌ لم تجرِ، أو نسخةٌ خاويةٌ، أو زمنٌ لا يُقرأ — ولا يُقرأ هذا الصمتُ نجاحاً.',
    });
  }

  if (measurement.totalMs > target) {
    return Object.freeze({
      ...base,
      verdict: 'recovery:missed',
      exitCode: exitCodeFor(contract, 'recovery:missed'),
      totalMs: measurement.totalMs,
      statement: `زمنُ التعافي المقيسُ ${String(measurement.totalMs)}ms جاوز العهدَ المعلَن ${String(target)}ms — إخفاقٌ مُعلَنٌ لا اجتهادٌ يُبرَّر.`,
    });
  }

  return Object.freeze({
    ...base,
    verdict: 'recovery:met',
    exitCode: exitCodeFor(contract, 'recovery:met'),
    totalMs: measurement.totalMs,
    statement: `عادت الدولةُ إلى بيئةٍ نظيفةٍ في ${String(measurement.totalMs)}ms من عهدٍ قدرُه ${String(target)}ms، بمطابقةِ بصمةٍ لـ${String(measurement.files)} ملفّاً ثم قراءةٍ منها، ونافذةُ فقدٍ مشتقّةٍ قدرُها ${String(contract.maxDataLossMs)}ms.`,
  });
}

/**
 * رَدُّ زمنٍ جاوز العهدَ بخطأٍ صريحٍ — لمن أراد الإخفاقَ رمياً لا حكماً مقروءاً.
 *
 * @param {RecoveryContract} contract
 * @param {number} totalMs
 * @returns {void}
 */
export function assertWithinObjective(contract, totalMs) {
  if (totalMs > contract.objective.maxRecoveryMs) {
    throw new RecoveryError(
      RECOVERY_ERRORS.TIME_EXCEEDED,
      `زمنُ التعافي ${String(totalMs)}ms جاوز العهدَ ${String(contract.objective.maxRecoveryMs)}ms.`,
      { totalMs, maxRecoveryMs: contract.objective.maxRecoveryMs },
    );
  }
}
