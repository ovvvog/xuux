/**
 * رموزُ رفضِ تمرينِ الطوارئ وصنفُ خطئِه — الخطوة `M11.07`.
 *
 * الرمزُ للأتمتةِ والنصُّ للقارئِ: مسارٌ آليٌّ يقرأ رمزاً، وإنسانٌ في لحظةٍ حرجةٍ
 * يقرأ سبباً. والرموزُ **متقابلةٌ في الاتجاهين** مع `refusalCodes` في
 * `config/emergency-drill.yaml`، ويُثبت الحاجزُ `guard:emergency` هذا التقابلَ —
 * فرمزٌ في الوثيقةِ بلا نظيرٍ في الكودِ وعدٌ لا يُرَدُّ به شيء، ورمزٌ في الكودِ
 * بلا نظيرٍ في الوثيقةِ رفضٌ لا يُقرأ معناه.
 *
 * @module emergency/errors
 */

export const EMERGENCY_ERRORS = Object.freeze({
  CONFIG_INVALID: 'EMERGENCY_CONFIG_INVALID',
  OBJECTIVE_INVALID: 'EMERGENCY_OBJECTIVE_INVALID',
  PHASE_ORDER_INVALID: 'EMERGENCY_PHASE_ORDER_INVALID',
  PHASE_SKIPPED: 'EMERGENCY_PHASE_SKIPPED',
  PHASE_UNIMPLEMENTED: 'EMERGENCY_PHASE_UNIMPLEMENTED',
  VERDICT_UNDECLARED: 'EMERGENCY_VERDICT_UNDECLARED',
  HALT_NOT_ENFORCED: 'EMERGENCY_HALT_NOT_ENFORCED',
  QUARANTINE_NOT_ENFORCED: 'EMERGENCY_QUARANTINE_NOT_ENFORCED',
  RECOVERY_FAILED: 'EMERGENCY_RECOVERY_FAILED',
  RESUME_NOT_ENFORCED: 'EMERGENCY_RESUME_NOT_ENFORCED',
  REPORT_INCOMPLETE: 'EMERGENCY_REPORT_INCOMPLETE',
  TIME_EXCEEDED: 'EMERGENCY_TIME_EXCEEDED',
  CLOCK_INVALID: 'EMERGENCY_CLOCK_INVALID',
  LEDGER_INVALID: 'EMERGENCY_LEDGER_INVALID',
});

/** خطأٌ مُسمّى: رمزُه معلَنٌ في العقدِ، وتفصيلُه يُقرأ ولا يُخترَع. */
export class EmergencyError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   * @param {Record<string, unknown>} [detail]
   */
  constructor(code, message, detail = {}) {
    super(message);
    this.name = 'EmergencyError';
    /** @type {string} */
    this.code = code;
    /** @type {Record<string, unknown>} */
    this.detail = detail;
  }
}
