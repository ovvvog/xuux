// رموزُ رفضِ مسارِ الأقاليم — الخطوة `M10.07`.
//
// الرموزُ مُفرَدةٌ في ملفٍّ لا تستوردُه إلا وحداتُ المسار، وتقابلُها مع
// `refusalCodes` في `config/regions.yaml` محروسٌ **في الاتجاهين**: رمزٌ في
// الكودِ بلا إعلانٍ رمزٌ لا يجده قارئُ الوثيقة، ورمزٌ في الوثيقةِ بلا كودٍ وعدٌ
// لا يُنفَّذ.

/** كتالوجُ رموزِ الرفضِ في مسارِ الأقاليم. */
export const REGION_ERRORS = Object.freeze({
  CONFIG_INVALID: 'REGION_CONFIG_INVALID',
  UNDECLARED: 'REGION_UNDECLARED',
  ROLE_INVALID: 'REGION_ROLE_INVALID',
  WRITER_NOT_UNIQUE: 'REGION_WRITER_NOT_UNIQUE',
  WRITER_MISSING: 'REGION_WRITER_MISSING',
  PRIORITY_INVALID: 'REGION_PRIORITY_INVALID',
  PATH_CONFLICT: 'REGION_PATH_CONFLICT',
  LAG_INVALID: 'REGION_LAG_INVALID',
  LAG_EXCEEDED: 'REGION_LAG_EXCEEDED',
  HEALTH_UNDECLARED: 'REGION_HEALTH_UNDECLARED',
  OBSERVATION_INVALID: 'REGION_OBSERVATION_INVALID',
  OBSERVATION_MISSING: 'REGION_OBSERVATION_MISSING',
  FAILOVER_DISABLED: 'REGION_FAILOVER_DISABLED',
  FAILOVER_CANDIDATE_MISSING: 'REGION_FAILOVER_CANDIDATE_MISSING',
  FAILOVER_TIMEOUT_EXCEEDED: 'REGION_FAILOVER_TIMEOUT_EXCEEDED',
  IMPACT_EXCEEDED: 'REGION_IMPACT_EXCEEDED',
  QUORUM_LOST: 'REGION_QUORUM_LOST',
  CLOCK_INVALID: 'REGION_CLOCK_INVALID',
});

/** خطأُ مسارِ الأقاليم — يحمل رمزَه من `REGION_ERRORS` وتفصيلَه. */
export class RegionError extends Error {
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
    this.name = 'RegionError';
    this.code = code;
    this.detail = detail;
  }
}
