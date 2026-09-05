/**
 * رموزُ رفضِ تقريرِ الجاهزيّةِ وصنفُ خطئِه — الخطوة `M11.08`.
 *
 * الرمزُ للأتمتةِ والنصُّ للقارئِ. والرموزُ **متقابلةٌ في الاتجاهين** مع
 * `refusalCodes` في `config/readiness-report.yaml`، ويُثبت الحاجزُ
 * `guard:readiness` هذا التقابلَ: رمزٌ في الوثيقةِ بلا نظيرٍ في الكودِ وعدٌ لا
 * يُرَدُّ به شيء، ورمزٌ في الكودِ بلا نظيرٍ في الوثيقةِ رفضٌ لا يُقرأ معناه.
 *
 * @module readiness/errors
 */

export const READINESS_ERRORS = Object.freeze({
  CONFIG_INVALID: 'READINESS_CONFIG_INVALID',
  DEFERRALS_INVALID: 'READINESS_DEFERRALS_INVALID',
  SOURCE_MISSING: 'READINESS_SOURCE_MISSING',
  ITEM_COUNT_MISMATCH: 'READINESS_ITEM_COUNT_MISMATCH',
  ITEM_UNCOVERED: 'READINESS_ITEM_UNCOVERED',
  DEFERRAL_INCOMPLETE: 'READINESS_DEFERRAL_INCOMPLETE',
  DEFERRAL_UNDECLARED: 'READINESS_DEFERRAL_UNDECLARED',
  DEFERRAL_ORPHAN: 'READINESS_DEFERRAL_ORPHAN',
  EVIDENCE_MISSING: 'READINESS_EVIDENCE_MISSING',
  REPORT_DRIFT: 'READINESS_REPORT_DRIFT',
  SELF_APPROVAL: 'READINESS_SELF_APPROVAL',
  LAUNCH_CLAIM: 'READINESS_LAUNCH_CLAIM',
  VERDICT_UNDECLARED: 'READINESS_VERDICT_UNDECLARED',
  ARGUMENT_UNKNOWN: 'READINESS_ARGUMENT_UNKNOWN',
});

/** خطأٌ مُسمّى: رمزُه معلَنٌ في العقدِ، وتفصيلُه يُقرأ ولا يُخترَع. */
export class ReadinessError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   * @param {Record<string, unknown>} [detail]
   */
  constructor(code, message, detail = {}) {
    super(message);
    this.name = 'ReadinessError';
    /** @type {string} */
    this.code = code;
    /** @type {Record<string, unknown>} */
    this.detail = detail;
  }
}
