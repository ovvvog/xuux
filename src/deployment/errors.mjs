// رموزُ رفضِ مسارِ النشر — الخطوة `M10.06`.
//
// الرموزُ مُفرَدةٌ في ملفٍّ لا تستوردُه إلا وحداتُ المسار، وتقابلُها مع
// `refusalCodes` في `config/deployment.yaml` محروسٌ **في الاتجاهين**: رمزٌ في
// الكودِ بلا إعلانٍ رمزٌ لا يجده قارئُ الوثيقة، ورمزٌ في الوثيقةِ بلا كودٍ وعدٌ
// لا يُنفَّذ.

/** كتالوجُ رموزِ الرفضِ في مسارِ النشر. */
export const DEPLOY_ERRORS = Object.freeze({
  CONFIG_INVALID: 'DEPLOY_CONFIG_INVALID',
  RELEASE_ID_INVALID: 'DEPLOY_RELEASE_ID_INVALID',
  RELEASE_UNKNOWN: 'DEPLOY_RELEASE_UNKNOWN',
  WAVE_UNDECLARED: 'DEPLOY_WAVE_UNDECLARED',
  WAVE_ORDER_INVALID: 'DEPLOY_WAVE_ORDER_INVALID',
  WAVE_SHARE_INVALID: 'DEPLOY_WAVE_SHARE_INVALID',
  OBJECTIVE_UNDECLARED: 'DEPLOY_OBJECTIVE_UNDECLARED',
  OBSERVATION_INVALID: 'DEPLOY_OBSERVATION_INVALID',
  OBSERVATION_MISSING: 'DEPLOY_OBSERVATION_MISSING',
  VERDICT_UNDECLARED: 'DEPLOY_VERDICT_UNDECLARED',
  ROLLBACK_TARGET_MISSING: 'DEPLOY_ROLLBACK_TARGET_MISSING',
  ROLLBACK_DISABLED: 'DEPLOY_ROLLBACK_DISABLED',
  PROBE_FAILED: 'DEPLOY_PROBE_FAILED',
  CLOCK_INVALID: 'DEPLOY_CLOCK_INVALID',
});

/** خطأُ مسارِ النشر — يحمل رمزَه من `DEPLOY_ERRORS` وتفصيلَه. */
export class DeploymentError extends Error {
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
    this.name = 'DeploymentError';
    this.code = code;
    this.detail = detail;
  }
}
