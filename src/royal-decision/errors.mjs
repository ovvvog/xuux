/**
 * رموزُ رفضِ حزمةِ القرارِ الملكيِّ — تجهيزُ الخطوةِ `M11.09`.
 *
 * الرمزُ للأتمتةِ والنصُّ للقارئِ، والرموزُ **متقابلةٌ في الاتجاهَينِ** مع
 * `refusalCodes` في `config/royal-decision.yaml`؛ يُثبِتُ التقابلَ الحاجزُ
 * `guard:royal-decision`: رمزٌ في العقدِ بلا نظيرٍ في الكودِ وعدٌ لا يُرَدُّ به
 * شيءٌ، ورمزٌ في الكودِ بلا نظيرٍ في العقدِ رفضٌ لا يُقرأُ معناه.
 *
 * @module royal-decision/errors
 */

export const ROYAL_DECISION_ERRORS = Object.freeze({
  CONFIG_INVALID: 'ROYAL_DECISION_CONFIG_INVALID',
  SELF_SIGNED: 'ROYAL_DECISION_SELF_SIGNED',
  SELF_APPROVAL: 'ROYAL_DECISION_SELF_APPROVAL',
  LAUNCH_CLAIM: 'ROYAL_DECISION_LAUNCH_CLAIM',
  PRECONDITION_UNDECLARED: 'ROYAL_DECISION_PRECONDITION_UNDECLARED',
  OPTION_INCOMPLETE: 'ROYAL_DECISION_OPTION_INCOMPLETE',
  PHASE_INCOMPLETE: 'ROYAL_DECISION_PHASE_INCOMPLETE',
  PACKET_DRIFT: 'ROYAL_DECISION_PACKET_DRIFT',
  STEP_CLOSED: 'ROYAL_DECISION_STEP_CLOSED',
  ARGUMENT_UNKNOWN: 'ROYAL_DECISION_ARGUMENT_UNKNOWN',
});

/** خطأٌ مُسمّى: رمزُه معلَنٌ في العقدِ، وتفصيلُه يُقرأُ ولا يُخترَعُ. */
export class RoyalDecisionError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   * @param {Record<string, unknown>} [detail]
   */
  constructor(code, message, detail = {}) {
    super(message);
    this.name = 'RoyalDecisionError';
    /** @type {string} */
    this.code = code;
    /** @type {Record<string, unknown>} */
    this.detail = detail;
  }
}
