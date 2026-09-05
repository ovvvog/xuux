/**
 * خطّةُ أطوارِ تمرينِ الطوارئ — الخطوة `M11.07`.
 *
 * الضمانُ المُنفَّذُ هنا `G-EMERGENCY-PHASES-ORDERED`: الأطوارُ تُنفَّذ بترتيبِها
 * المعلَنِ، ولا يُقبَل طورٌ قبل سابقِه ولا تمرينٌ ينقصه طورٌ. ومن استأنف قبل أن
 * يتعافى استأنف فوقَ حالةٍ لم تُستعَد؛ ومن حجَر قبل أن يُوقِف حجَر في دولةٍ ما
 * زالت تعمل — فترتيبُ الأطوارِ هو معنى التمرينِ لا تفصيلٌ إجرائيّ.
 *
 * والوحدةُ **نقيّةٌ**: لا قرصَ ولا عمليّةَ ولا ساعةَ جهازٍ — تُعطى الوقائعَ
 * فتحكم عليها.
 *
 * @module emergency/phase-plan
 */

import { EMERGENCY_ERRORS, EmergencyError } from './errors.mjs';

/**
 * معرَّفاتُ الأطوارِ بترتيبِها المعلَنِ في العقد.
 *
 * @param {{ phases: { id: string, order: number }[] }} contract
 * @returns {string[]}
 */
export function orderedPhaseIds(contract) {
  return [...contract.phases]
    .sort((left, right) => left.order - right.order)
    .map((phase) => phase.id);
}

/**
 * يتحقّق أنّ ما نُفِّذ فعلاً هو الأطوارُ المعلَنةُ كلُّها **بترتيبِها**.
 *
 * ولا يُقبَل نقصانُ طورٍ ولو نجحت البقيّةُ: تمرينُ الطوارئ سلسلةٌ، وحلقةٌ ساقطةٌ
 * منها تجعل ما بعدَها غيرَ مقيسٍ لا ناجحاً.
 *
 * @param {{ phases: { id: string, order: number }[] }} contract
 * @param {{ phase: string }[]} executed
 * @returns {{ phase: string }[]} الوقائعُ نفسُها بعد قبولِها — كي يُسلسَل النداء.
 */
export function assertPhaseSequence(contract, executed) {
  const expected = orderedPhaseIds(contract);
  const actual = executed.map((entry) => entry.phase);
  if (actual.length !== expected.length) {
    throw new EmergencyError(
      EMERGENCY_ERRORS.PHASE_SKIPPED,
      `نُفِّذ ${actual.length} طوراً والمعلَنُ ${expected.length} — وتمرينٌ ينقصه طورٌ لا يُقرأ نجاحاً جزئيّاً.`,
      { expected, actual },
    );
  }
  for (let index = 0; index < expected.length; index += 1) {
    if (actual[index] !== expected[index]) {
      throw new EmergencyError(
        EMERGENCY_ERRORS.PHASE_SKIPPED,
        `الطورُ في الموضعِ ${index + 1} هو «${String(actual[index])}» والمعلَنُ «${String(expected[index])}» — ومن استأنف قبل أن يتعافى استأنف فوقَ حالةٍ لم تُستعَد.`,
        { expected, actual },
      );
    }
  }
  return executed;
}

/**
 * يتحقّق أنّ لكلِّ طورٍ معلَنٍ **مُنفِّذاً موجوداً** بالاسمِ في جامعِ الوقائع.
 *
 * فطورٌ معلَنٌ في العقدِ بلا مُنفِّذٍ وعدُ عملٍ لا يقع، ويُكتشَف عند التحميلِ لا
 * بعد أن تُوقَف الدولة.
 *
 * @param {{ phases: { id: string }[] }} contract
 * @param {Record<string, unknown>} runners
 * @returns {void}
 */
export function assertPhasesImplemented(contract, runners) {
  for (const phase of contract.phases) {
    if (typeof runners[phase.id] !== 'function') {
      throw new EmergencyError(
        EMERGENCY_ERRORS.PHASE_UNIMPLEMENTED,
        `الطورُ «${phase.id}» معلَنٌ في العقدِ بلا مُنفِّذٍ في جامعِ الوقائعِ — ووعدُ طورٍ لا يقع.`,
        { phase: phase.id },
      );
    }
  }
  for (const id of Object.keys(runners)) {
    if (!contract.phases.some((phase) => phase.id === id)) {
      throw new EmergencyError(
        EMERGENCY_ERRORS.PHASE_UNIMPLEMENTED,
        `مُنفِّذٌ للطورِ «${id}» لا إعلانَ له في العقدِ — وطورٌ يقع بلا عهدِ زمنٍ طورٌ لا يُحاسَب.`,
        { phase: id },
      );
    }
  }
}
