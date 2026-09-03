/**
 * ترتيبُ أطوارِ تجربةِ التعافي وحراسةُ تتابعِها — الخطوة `M10.08`.
 *
 * **الضمان `G-RECOVERY-PHASES-ORDERED`:** الأطوارُ تُنفَّذ بترتيبِها المعلَنِ في
 * العقدِ، ولا يُقبَل طورٌ سُجِّل قبل سابقِه، ولا تجربةٌ ينقصها طورٌ واحد. فمن
 * استعاد قبل أن يُفرِّغ استعاد **فوقَ حالةٍ قائمةٍ**، فما قاس استعادةً بل قاس
 * بقاءَ ما كان ثم سمّاه تعافياً.
 *
 * وهذا الملفُّ **نقيٌّ**: لا `node:fs` ولا `node:child_process` ولا
 * `node:process`، ولا قراءةَ لساعةِ النظامِ ولا مؤقِّتٌ ذاتيٌّ — الوقائعُ كلُّها
 * تُمرَّر إليه من `scripts/lib/recovery-facts.mjs` وحدَها.
 *
 * @module recovery/drill-plan
 */

import { RECOVERY_ERRORS, RecoveryError } from './errors.mjs';

/**
 * @typedef {import('./contract.mjs').RecoveryContract} RecoveryContract
 */

/**
 * @typedef {object} PhaseRecord
 * @property {string} id معرّفُ الطورِ المعلَنِ في العقد.
 * @property {number} startedAt لحظةُ البدءِ بساعةٍ مُحقَنة.
 * @property {number} endedAt لحظةُ الانتهاءِ بساعةٍ مُحقَنة.
 */

/**
 * ترتيبُ الأطوارِ المعلَنِ في العقدِ، مرتَّباً برتبتِه.
 *
 * @param {RecoveryContract} contract
 * @returns {string[]}
 */
export function orderedPhaseIds(contract) {
  return [...contract.phases]
    .sort((first, second) => first.order - second.order)
    .map((phase) => phase.id);
}

/**
 * التحقّقُ من أنّ الأطوارَ المسجَّلةَ هي الأطوارُ المعلَنةُ كلُّها، بترتيبِها،
 * وأنّ كلَّ طورٍ بدأ بعد انتهاءِ سابقِه.
 *
 * @param {RecoveryContract} contract
 * @param {PhaseRecord[]} records
 * @returns {Readonly<{ phases: readonly PhaseRecord[], totalMs: number }>}
 */
export function assertPhaseSequence(contract, records) {
  const expected = orderedPhaseIds(contract);
  if (records.length !== expected.length) {
    throw new RecoveryError(
      RECOVERY_ERRORS.PHASE_SKIPPED,
      `التجربةُ سجّلت ${String(records.length)} طوراً والعقدُ يُعلن ${String(expected.length)} — وتجربةٌ ينقصها طورٌ تجربةٌ تقيس غيرَ ما وعدت.`,
      { recorded: records.map((record) => record.id), expected },
    );
  }
  for (const [index, record] of records.entries()) {
    const wanted = expected[index];
    if (record.id !== wanted) {
      throw new RecoveryError(
        RECOVERY_ERRORS.PHASE_SKIPPED,
        `الطور رقم ${String(index + 1)} هو «${record.id}» والعقدُ يوجب «${String(wanted)}» — ولا يُتجاوَز ترتيبٌ مُعلَنٌ باجتهادِ منفِّذ.`,
        { at: index + 1, found: record.id, expected: wanted },
      );
    }
    assertTimestamps(record);
    const previous = index === 0 ? undefined : records[index - 1];
    if (previous !== undefined && record.startedAt < previous.endedAt) {
      throw new RecoveryError(
        RECOVERY_ERRORS.PHASE_SKIPPED,
        `الطور «${record.id}» بدأ قبل انتهاءِ «${previous.id}» — وتداخلُ الأطوارِ يُفسد القياسَ ويُخفي التخطّي.`,
        { phase: record.id, previous: previous.id },
      );
    }
  }
  const first = records[0];
  const last = records[records.length - 1];
  if (first === undefined || last === undefined) {
    throw new RecoveryError(
      RECOVERY_ERRORS.PHASE_SKIPPED,
      'لا طورَ مسجَّلٌ في التجربةِ — ولا يُقاس تعافٍ لم يقع منه شيء.',
    );
  }
  return Object.freeze({
    phases: Object.freeze([...records]),
    totalMs: last.endedAt - first.startedAt,
  });
}

/** @param {PhaseRecord} record */
function assertTimestamps(record) {
  for (const value of [record.startedAt, record.endedAt]) {
    if (!Number.isFinite(value) || !Number.isSafeInteger(value)) {
      throw new RecoveryError(
        RECOVERY_ERRORS.CLOCK_INVALID,
        `الطور «${record.id}» يحمل لحظةً ليست عدداً صحيحاً منتهياً — وزمنٌ لا يُقرأ لا يُحاسَب عليه.`,
        { phase: record.id },
      );
    }
  }
  if (record.endedAt < record.startedAt) {
    throw new RecoveryError(
      RECOVERY_ERRORS.CLOCK_INVALID,
      `الطور «${record.id}» انتهى قبل أن يبدأ — وساعةٌ ترجع إلى الوراءِ تُفسد كلَّ قياسٍ بعدها.`,
      { phase: record.id },
    );
  }
}
