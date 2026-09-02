// رموزُ رفضِ تتبّعِ التكلفةِ والسعة — الخطوة `M10.04`.
//
// الرموزُ مُفرَدةٌ في ملفٍّ لا تستوردُه إلا وحداتُ المسار، وتقابلُها مع
// `refusalCodes` في `config/cost-capacity.yaml` محروسٌ **في الاتجاهين**: رمزٌ في
// الكودِ بلا إعلانٍ رمزٌ لا يجده قارئُ الوثيقة، ورمزٌ في الوثيقةِ بلا كودٍ وعدٌ
// لا يُنفَّذ.

/** كتالوجُ رموزِ الرفضِ في مسارِ التكلفةِ والسعة. */
export const COST_ERRORS = Object.freeze({
  CONFIG_INVALID: 'COST_CONFIG_INVALID',
  POLICY_REQUIRED: 'COST_POLICY_REQUIRED',
  LOG_REQUIRED: 'COST_LOG_REQUIRED',
  LEDGER_REQUIRED: 'COST_LEDGER_REQUIRED',
  OPERATIONS_REQUIRED: 'COST_OPERATIONS_REQUIRED',
  ITEM_UNDECLARED: 'COST_ITEM_UNDECLARED',
  DIMENSION_UNDECLARED: 'COST_DIMENSION_UNDECLARED',
  SUBJECT_UNDECLARED: 'COST_SUBJECT_UNDECLARED',
  QUANTITY_INVALID: 'COST_QUANTITY_INVALID',
  PERIOD_INVALID: 'COST_PERIOD_INVALID',
  CLOCK_INVALID: 'COST_CLOCK_INVALID',
});

/** خطأُ مسارِ التكلفةِ والسعة — يحمل رمزَه من `COST_ERRORS` وتفصيلَه. */
export class CostCapacityError extends Error {
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
    this.name = 'CostCapacityError';
    this.code = code;
    this.detail = detail;
  }
}
