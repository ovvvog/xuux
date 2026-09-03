// رموزُ رفضِ مسارِ التعافي — الخطوة `M10.08`.
//
// الرموزُ مُفرَدةٌ في ملفٍّ لا تستوردُه إلا وحداتُ المسار، وتقابلُها مع
// `refusalCodes` في `config/recovery.yaml` محروسٌ **في الاتجاهين**: رمزٌ في
// الكودِ بلا إعلانٍ رمزٌ لا يجده قارئُ الوثيقة، ورمزٌ في الوثيقةِ بلا كودٍ وعدٌ
// لا يُنفَّذ.

/** كتالوجُ رموزِ الرفضِ في مسارِ التعافي. */
export const RECOVERY_ERRORS = Object.freeze({
  CONFIG_INVALID: 'RECOVERY_CONFIG_INVALID',
  OBJECTIVE_INVALID: 'RECOVERY_OBJECTIVE_INVALID',
  CADENCE_INVALID: 'RECOVERY_CADENCE_INVALID',
  PHASE_ORDER_INVALID: 'RECOVERY_PHASE_ORDER_INVALID',
  PHASE_SKIPPED: 'RECOVERY_PHASE_SKIPPED',
  VERDICT_UNDECLARED: 'RECOVERY_VERDICT_UNDECLARED',
  BACKUP_EMPTY: 'RECOVERY_BACKUP_EMPTY',
  ENVIRONMENT_NOT_CLEAN: 'RECOVERY_ENVIRONMENT_NOT_CLEAN',
  INTEGRITY_MISMATCH: 'RECOVERY_INTEGRITY_MISMATCH',
  RESTORE_INCOMPLETE: 'RECOVERY_RESTORE_INCOMPLETE',
  TIME_EXCEEDED: 'RECOVERY_TIME_EXCEEDED',
  DRILL_OVERDUE: 'RECOVERY_DRILL_OVERDUE',
  LEDGER_INVALID: 'RECOVERY_LEDGER_INVALID',
  CLOCK_INVALID: 'RECOVERY_CLOCK_INVALID',
});

/** خطأُ مسارِ التعافي — يحمل رمزَه من `RECOVERY_ERRORS` وتفصيلَه. */
export class RecoveryError extends Error {
  /** @type {string} */
  code;
  /** @type {Record<string, unknown>} */
  detail;

  /**
   * @param {string} code
   * @param {string} message
   * @param {Record<string, unknown>} [detail]
   */
  constructor(code, message, detail = {}) {
    super(message);
    this.name = 'RecoveryError';
    this.code = code;
    this.detail = detail;
  }
}
