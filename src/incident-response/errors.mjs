// رموزُ رفضِ مسارِ الاستجابةِ للحوادثِ وخطؤه — الخطوة `M10.03`.
//
// فُصلت في ملفٍّ واحدٍ لأن الوحداتِ الثلاثَ تحتَ هذا المجلَّدِ ترفع منها
// (`alerts` و`rotation` و`review` والمنسِّق)، وجمعُها في المنسِّقِ كان يُنشئ
// دَورةَ استيرادٍ بين النقيِّ والمُنسِّق. **ولا يُعلَن هنا رمزٌ لا يُقابله سطرٌ
// في `config/incident-response.yaml`** — يفحص الحاجزُ ذلك في الاتجاهين، فرمزٌ
// في الكودِ بلا إعلانٍ رفضٌ لا يعرف قارئُ الوثيقةِ أنه قد يقع، ورمزٌ في
// الوثيقةِ بلا موضعِ إنفاذٍ وعدٌ لا يُنفَّذ.

/** رموزُ الرفضِ — تُقابَل بـ`refusalCodes` في الوثيقةِ في الاتجاهين. */
export const IR_ERRORS = Object.freeze({
  CONFIG_INVALID: 'IR_CONFIG_INVALID',
  POLICY_REQUIRED: 'IR_POLICY_REQUIRED',
  AUDIT_REQUIRED: 'IR_AUDIT_REQUIRED',
  SERVICE_LEVELS_REQUIRED: 'IR_SERVICE_LEVELS_REQUIRED',
  OPERATIONS_REQUIRED: 'IR_OPERATIONS_REQUIRED',
  OBJECTIVE_UNDECLARED: 'IR_OBJECTIVE_UNDECLARED',
  SEVERITY_UNDECLARED: 'IR_SEVERITY_UNDECLARED',
  RULE_UNDECLARED: 'IR_RULE_UNDECLARED',
  ALERT_UNKNOWN: 'IR_ALERT_UNKNOWN',
  ALERT_NOT_OPEN: 'IR_ALERT_NOT_OPEN',
  ALERT_ALREADY_ACKNOWLEDGED: 'IR_ALERT_ALREADY_ACKNOWLEDGED',
  RESPONDER_UNKNOWN: 'IR_RESPONDER_UNKNOWN',
  RESPONDER_NOT_ON_CALL: 'IR_RESPONDER_NOT_ON_CALL',
  ROTATION_GAP: 'IR_ROTATION_GAP',
  ESCALATION_TIER_EXHAUSTED: 'IR_ESCALATION_TIER_EXHAUSTED',
  ESCALATION_PREMATURE: 'IR_ESCALATION_PREMATURE',
  ACKNOWLEDGE_DEADLINE_MISSED: 'IR_ACKNOWLEDGE_DEADLINE_MISSED',
  RESOLVE_BEFORE_ACKNOWLEDGE: 'IR_RESOLVE_BEFORE_ACKNOWLEDGE',
  REVIEW_REQUIRED: 'IR_REVIEW_REQUIRED',
  REVIEW_SECTION_MISSING: 'IR_REVIEW_SECTION_MISSING',
  REVIEW_EVIDENCE_MISSING: 'IR_REVIEW_EVIDENCE_MISSING',
  REVIEW_REVIEWER_CONFLICT: 'IR_REVIEW_REVIEWER_CONFLICT',
  REVIEW_DEADLINE_MISSED: 'IR_REVIEW_DEADLINE_MISSED',
  CLOCK_INVALID: 'IR_CLOCK_INVALID',
});

/** الشروطُ المكتوبةُ في الكود — يقابلها `enum` في مخطَّطِ الوثيقة. */
export const IR_CONDITIONS = Object.freeze([
  'objective-breaching',
  'budget-exhausted',
  'measurement-missing',
]);

/**
 * رفضٌ مُسمّىً برمزِه وتفصيلِه — لا `Error` عامٌّ يُقرأ نصُّه بالعين.
 */
export class IncidentResponseError extends Error {
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
    this.name = 'IncidentResponseError';
    this.code = code;
    this.detail = detail;
  }
}
