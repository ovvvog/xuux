/**
 * موعدُ التجربةِ التاليةِ وحكمُ فواتِها — الخطوة `M10.08`.
 *
 * **الضمان `G-RECOVERY-DUE-FROM-LEDGER`:** موعدُ التجربةِ التاليةِ وحكمُ فواتِها
 * يُحسبان من **سجلِّ آخرِ تجربةٍ** المكتوبِ على القرصِ لا من وسيطٍ يُمرَّر
 * مجاملةً ولا من ذاكرةِ منفِّذٍ يقول «أجريناها قريباً». والدوريّةُ عهدٌ معلَنٌ
 * يُقاس من الدفتر. **وتحديثُ `WL-191`:** صارَ التمرينُ **مجدوَلاً فعلاً** بالعملِ
 * `job:recovery-drill` في `config/schedule.yaml` (إغلاقُ الدَينِ `D-4`)؛ وهذه
 * الوحدةُ تبقى **قياسَ فواتٍ** لا مُطلِقاً — والإطلاقُ سلطةُ `src/scheduling/`
 * وحدَها، فلا مصدرَي إطلاقٍ لعملٍ واحدٍ.
 *
 * وهذا الملفُّ **نقيٌّ**: يستقبل تاريخَ آخرِ تجربةٍ ولحظةَ الآنِ بساعةٍ مُحقَنةٍ،
 * ولا يقرأ قرصاً ولا ساعةَ نظام.
 *
 * @module recovery/schedule
 */

import { RECOVERY_ERRORS, RecoveryError } from './errors.mjs';

/**
 * @typedef {import('./contract.mjs').RecoveryContract} RecoveryContract
 */

const MS_PER_DAY = 86400000;

/**
 * @typedef {object} DrillDueness
 * @property {number | undefined} lastDrillAt
 * @property {number | undefined} dueAt
 * @property {number | undefined} deadlineAt
 * @property {boolean} overdue
 * @property {number | undefined} sinceDays
 * @property {string} statement
 */

/**
 * حسابُ فواتِ التجربةِ من سجلِّ آخرِ تجربةٍ ولحظةِ الآنِ المُحقَنة.
 *
 * @param {RecoveryContract} contract
 * @param {{ lastDrillAt?: number | undefined, now: number }} facts
 * @returns {DrillDueness}
 */
export function evaluateDrillDueness(contract, facts) {
  if (!Number.isFinite(facts.now) || !Number.isSafeInteger(facts.now)) {
    throw new RecoveryError(
      RECOVERY_ERRORS.CLOCK_INVALID,
      'لحظةُ الآنِ ليست عدداً صحيحاً منتهياً — وساعةٌ لا تُصدر عدداً لا يُبنى عليها موعد.',
      { now: facts.now },
    );
  }
  const { everyDays, graceDays } = contract.cadence;
  const last = facts.lastDrillAt;
  if (last === undefined) {
    return Object.freeze({
      lastDrillAt: undefined,
      dueAt: undefined,
      deadlineAt: undefined,
      overdue: true,
      sinceDays: undefined,
      statement:
        'لا سجلَّ لتجربةٍ سابقةٍ في الدفترِ — وغيابُ الدليلِ ليس براءةً، فالتجربةُ مُستحقّةٌ الآن.',
    });
  }
  if (!Number.isFinite(last) || !Number.isSafeInteger(last)) {
    throw new RecoveryError(
      RECOVERY_ERRORS.LEDGER_INVALID,
      'تاريخُ آخرِ تجربةٍ في السجلِّ ليس عدداً صحيحاً منتهياً — وسجلٌّ لا يُقرأ سجلٌّ لا يُحتَجُّ به.',
      { lastDrillAt: last },
    );
  }
  // ── إصلاحُ الانحراف `DEV-CHAOS-CLOCK-SKEW` (‏`M10.09`، مُغلَقٌ في `WL-062`) ──
  // كشفت تجربةُ `chaos:clock-skew` أنّ سجلًّا تاريخُه **في المستقبلِ** كان
  // يُنتِج مدّةً سالبةً مضت وحكماً `overdue: false` وعبارةَ «والعهدُ قائم» — أي
  // أنّ ساعةً رجعت إلى الوراءِ كانت تكفي لإظهارِ امتثالٍ لدوريّةٍ لم تجرِ.
  // والسببُ الجذريُّ أنّ الحسابَ كان يثق بفرقٍ **قد يكون سالباً**، فصار
  // السجلُّ المستقبليُّ مردوداً برمزِ `RECOVERY_LEDGER_INVALID` لا مقروءاً
  // امتثالاً؛ فامتثالٌ مصدرُه ساعةٌ فاسدةٌ ادّعاءٌ لا دليل.
  if (last > facts.now) {
    throw new RecoveryError(
      RECOVERY_ERRORS.LEDGER_INVALID,
      `تاريخُ آخرِ تجربةٍ (${String(last)}) يسبق الآنَ (${String(facts.now)}) في المستقبلِ — وساعةٌ رجعت إلى الوراءِ لا تُنتِج امتثالاً، فالسجلُّ مردودٌ لا محتَجٌّ به.`,
      { lastDrillAt: last, now: facts.now },
    );
  }
  const dueAt = last + everyDays * MS_PER_DAY;
  const deadlineAt = dueAt + graceDays * MS_PER_DAY;
  const sinceDays = Math.floor((facts.now - last) / MS_PER_DAY);
  const overdue = facts.now > deadlineAt;
  return Object.freeze({
    lastDrillAt: last,
    dueAt,
    deadlineAt,
    overdue,
    sinceDays,
    statement: overdue
      ? `مضى ${String(sinceDays)} يوماً على آخرِ تجربةٍ، ودوريّةُ العهدِ ${String(everyDays)} يوماً بسماحِ ${String(graceDays)} — فالتجربةُ فائتةٌ لا مُتأخّرةٌ عفواً.`
      : `مضى ${String(sinceDays)} يوماً على آخرِ تجربةٍ من دوريّةٍ قدرُها ${String(everyDays)} يوماً بسماحِ ${String(graceDays)} يوماً — والعهدُ قائم.`,
  });
}

/**
 * ردُّ تجربةٍ فائتةٍ بخطأٍ صريحٍ لمن أراد بوابةً لا تقريراً.
 *
 * @param {RecoveryContract} contract
 * @param {{ lastDrillAt?: number | undefined, now: number }} facts
 * @returns {DrillDueness}
 */
export function assertDrillNotOverdue(contract, facts) {
  const dueness = evaluateDrillDueness(contract, facts);
  if (dueness.overdue) {
    throw new RecoveryError(RECOVERY_ERRORS.DRILL_OVERDUE, dueness.statement, {
      lastDrillAt: dueness.lastDrillAt,
      deadlineAt: dueness.deadlineAt,
    });
  }
  return dueness;
}
