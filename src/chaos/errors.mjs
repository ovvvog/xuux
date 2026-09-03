// رموزُ رفضِ مسارِ اختباراتِ الفوضى — الخطوة `M10.09`.
//
// الرموزُ مُفرَدةٌ في ملفٍّ لا تستوردُه إلا وحداتُ المسار، وتقابلُها مع
// `refusalCodes` في `config/chaos.yaml` محروسٌ **في الاتجاهين**: رمزٌ في
// الكودِ بلا إعلانٍ رمزٌ لا يجده قارئُ الوثيقة، ورمزٌ في الوثيقةِ بلا كودٍ
// وعدٌ لا يُنفَّذ.
//
// وفي مسارِ الفوضى لهذا التقابلِ وجهٌ زائدٌ: **الرفضُ هو المُخرَجُ المطلوبُ**
// في أكثرِ التجاربِ — فالفرضيّةُ في `chaos:message-poison` و`chaos:disk-full`
// و`chaos:clock-skew` أن يقع رفضٌ **برمزٍ معلَنٍ** لا أن يقع صمتٌ. ورمزٌ لا
// إعلانَ له لا يُميَّز من عطبٍ غيرِ متوقَّعٍ عند القراءة.

/** كتالوجُ رموزِ الرفضِ في مسارِ اختباراتِ الفوضى. */
export const CHAOS_ERRORS = Object.freeze({
  CONFIG_INVALID: 'CHAOS_CONFIG_INVALID',
  EXPERIMENT_UNDECLARED: 'CHAOS_EXPERIMENT_UNDECLARED',
  EXPERIMENT_DUPLICATE: 'CHAOS_EXPERIMENT_DUPLICATE',
  ORDER_INVALID: 'CHAOS_ORDER_INVALID',
  FAULT_INVALID: 'CHAOS_FAULT_INVALID',
  HYPOTHESIS_MISSING: 'CHAOS_HYPOTHESIS_MISSING',
  DEVIATION_UNDECLARED: 'CHAOS_DEVIATION_UNDECLARED',
  DEVIATION_UNCLOSED: 'CHAOS_DEVIATION_UNCLOSED',
  DEVIATION_UNLINKED: 'CHAOS_DEVIATION_UNLINKED',
  VERDICT_UNDECLARED: 'CHAOS_VERDICT_UNDECLARED',
  EXIT_CODE_CONFLICT: 'CHAOS_EXIT_CODE_CONFLICT',
  RESULT_MISSING: 'CHAOS_RESULT_MISSING',
  RESULT_INVALID: 'CHAOS_RESULT_INVALID',
  LEDGER_INVALID: 'CHAOS_LEDGER_INVALID',
  LEDGER_UNWRITABLE: 'CHAOS_LEDGER_UNWRITABLE',
  INJECTION_UNAVAILABLE: 'CHAOS_INJECTION_UNAVAILABLE',
  BLAST_RADIUS_ESCAPE: 'CHAOS_BLAST_RADIUS_ESCAPE',
  CLOCK_INVALID: 'CHAOS_CLOCK_INVALID',
});

/** خطأُ مسارِ الفوضى — يحمل رمزَه من `CHAOS_ERRORS` وتفصيلَه. */
export class ChaosError extends Error {
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
    this.name = 'ChaosError';
    this.code = code;
    this.detail = detail;
  }
}
