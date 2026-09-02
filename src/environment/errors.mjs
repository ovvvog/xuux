// رموزُ رفضِ مسارِ البيئة — الخطوة `M10.05`.
//
// الرموزُ مُفرَدةٌ في ملفٍّ لا تستوردُه إلا وحداتُ المسار، وتقابلُها مع
// `refusalCodes` في `config/environment.yaml` محروسٌ **في الاتجاهين**: رمزٌ في
// الكودِ بلا إعلانٍ رمزٌ لا يجده قارئُ الوثيقة، ورمزٌ في الوثيقةِ بلا كودٍ وعدٌ
// لا يُنفَّذ.

/** كتالوجُ رموزِ الرفضِ في مسارِ البيئة. */
export const ENV_ERRORS = Object.freeze({
  CONFIG_INVALID: 'ENV_CONFIG_INVALID',
  PROFILE_UNDECLARED: 'ENV_PROFILE_UNDECLARED',
  TOOL_UNDECLARED: 'ENV_TOOL_UNDECLARED',
  VARIABLE_UNDECLARED: 'ENV_VARIABLE_UNDECLARED',
  PHASE_UNDECLARED: 'ENV_PHASE_UNDECLARED',
  PHASE_NOT_IDEMPOTENT: 'ENV_PHASE_NOT_IDEMPOTENT',
  PROBE_UNDECLARED: 'ENV_PROBE_UNDECLARED',
  PROBE_MISSING: 'ENV_PROBE_MISSING',
  PROBE_DUPLICATE: 'ENV_PROBE_DUPLICATE',
  SEVERITY_UNDECLARED: 'ENV_SEVERITY_UNDECLARED',
  VERDICT_UNDECLARED: 'ENV_VERDICT_UNDECLARED',
  CLOCK_INVALID: 'ENV_CLOCK_INVALID',
  LOG_REQUIRED: 'ENV_LOG_REQUIRED',
});

/** خطأُ مسارِ البيئة — يحمل رمزَه من `ENV_ERRORS` وتفصيلَه. */
export class EnvironmentError extends Error {
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
    this.name = 'EnvironmentError';
    this.code = code;
    this.detail = detail;
  }
}
