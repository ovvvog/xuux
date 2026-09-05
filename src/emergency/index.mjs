/**
 * مدخلُ وحدةِ تمرينِ الطوارئ — الخطوة `M11.07`.
 *
 * يُصدِّر **الحكمَ والعقدَ والخطّةَ** فقط: أمّا لمسُ القرصِ وتشغيلُ العمليّاتِ
 * وقراءةُ الساعةِ فمكانُها `scripts/lib/emergency-facts.mjs` وحدَه.
 *
 * @module emergency
 */

export { EMERGENCY_ERRORS, EmergencyError } from './errors.mjs';
export {
  DEFAULT_EMERGENCY_CONFIG_DIR,
  READY_VERDICT,
  exitCodeFor,
  loadEmergencyContract,
} from './contract.mjs';
export { assertPhaseSequence, assertPhasesImplemented, orderedPhaseIds } from './phase-plan.mjs';
export { VERDICT_FAILED, VERDICT_READY, VERDICT_UNMEASURED, judgeDrill } from './judgement.mjs';
