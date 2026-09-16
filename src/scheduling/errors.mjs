/**
 * أخطاءُ الجدولةِ — إغلاقُ الدَينِ `D-4` (‏`WL-191`).
 *
 * رمزٌ لكلِّ سببِ رفضٍ: مُجدوِلٌ يرفضُ برسالةٍ واحدةٍ يُقرأُ كلُّ رفضٍ فيه
 * «تعذَّرَ التشغيلُ»، فلا يُفرَّقُ تركيبٌ ناقصٌ من قرارٍ رافضٍ من شقٍّ محجوزٍ من
 * عملٍ غيرِ مسجَّلٍ — وأربعةُ أسبابٍ باسمٍ واحدٍ لا تُراجَعُ.
 *
 * @module scheduling/errors
 */

export const SCHEDULER_ERRORS = Object.freeze({
  /** قيودُ الجدولةِ مفقودةٌ أو لا تطابقُ مخطَّطها أو غيرُ متماسكةٍ. */
  CONFIG_INVALID: 'SCHEDULER_CONFIG_INVALID',
  /** وسيطٌ ناقصٌ أو غيرُ صالحٍ في نداءٍ داخليٍّ. */
  INPUT_INVALID: 'SCHEDULER_INPUT_INVALID',
  /** عملٌ غيرُ معلَنٍ في `config/schedule.yaml`. */
  JOB_UNKNOWN: 'SCHEDULER_JOB_UNKNOWN',
  /** عملٌ معلَنٌ ولا مُنفِّذَ مسجَّلٌ له. */
  HANDLER_MISSING: 'SCHEDULER_HANDLER_MISSING',
  /** لا نقطةَ تفويضٍ موصولةً، أو نقطةٌ بلا بوابةِ هويةٍ. */
  AUTHORIZER_REQUIRED: 'SCHEDULER_AUTHORIZER_REQUIRED',
  /** نقطةُ التفويضِ رفضت إطلاقَ العملِ. */
  NOT_AUTHORIZED: 'SCHEDULER_NOT_AUTHORIZED',
  /** شقٌّ زمنيٌّ محجوزٌ سابقاً: إطلاقٌ ثانٍ له إطلاقٌ مزدوجٌ. */
  SLOT_ALREADY_CLAIMED: 'SCHEDULER_SLOT_ALREADY_CLAIMED',
  /** فعلٌ فوقَ العتبةِ السياديّةِ لا يُجدوَلُ: المُجدوِلُ لا يحملُ أمراً ملكيّاً. */
  SOVEREIGN_ACTION_NOT_SCHEDULABLE: 'SCHEDULER_SOVEREIGN_ACTION_NOT_SCHEDULABLE',
  /** سلسلةُ دفترِ الإطلاقاتِ مكسورةٌ: صفٌّ حُذف أو عُدِّل. */
  LEDGER_CHAIN_BROKEN: 'SCHEDULER_LEDGER_CHAIN_BROKEN',
  /** ساعةٌ لا تُصدرُ عدداً صحيحاً منتهياً لا يُبنى عليها موعدٌ. */
  CLOCK_INVALID: 'SCHEDULER_CLOCK_INVALID',
});

/** خطأُ جدولةٍ مُسمّى: الرمزُ للأتمتةِ والنصُّ لمن يقرأُ الرفضَ. */
export class SchedulerError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   * @param {Record<string, unknown>} [detail]
   */
  constructor(code, message, detail = {}) {
    super(`${code}: ${message}`);
    this.name = 'SchedulerError';
    this.code = code;
    this.detail = Object.freeze({ ...detail });
  }
}
