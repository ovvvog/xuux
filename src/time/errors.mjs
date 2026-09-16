/**
 * أخطاءُ الوقتِ المُبرهَنِ — إغلاقُ الدَّينِ `D-7` (‏`WL-192`).
 *
 * العيبُ الذي تُغلِقُه هذه الحزمةُ ليس «قياساً غيرَ دقيقٍ للوقتِ» بل **غيابُ
 * مصدرٍ يُبرهِنُ الوقتَ**: ساعةُ الجذرِ القائمةُ (`SovereignClock`) تكشفُ
 * الانزياحَ والرجوعَ بين تشغيلين، ولا تُثبتُ أنَّ الوقتَ الذي تقرؤه صحيحٌ.
 * وساعةٌ منزاحةٌ انزياحاً ثابتاً منذ الإقلاعِ تُقرأُ سليمةً عندها. ولذلك كانت
 * كلُّ مهلةٍ سياديّةٍ تُقاسُ على ساعةٍ يملكُها من يملكُ الجهازَ.
 *
 * ورمزٌ لكلِّ سببِ رفضٍ لأنَّ «تعذَّرَ إثباتُ الوقتِ» رسالةً واحدةً تخلطُ
 * توقيعاً مكسوراً بمِفتاحٍ غيرِ معلَنٍ بشهادةٍ منتهيةٍ بنِصابٍ غيرِ مكتملٍ
 * بمصادرَ متخالفةٍ — وخمسةُ أسبابٍ باسمٍ واحدٍ لا تُراجَعُ.
 *
 * @module time/errors
 */

export const TIME_ERRORS = Object.freeze({
  /** `config/time.yaml` مفقودٌ أو لا يطابقُ مخطَّطَه أو غيرُ متماسكٍ. */
  CONFIG_INVALID: 'TIME_CONFIG_INVALID',
  /** وسيطٌ ناقصٌ أو غيرُ صالحٍ في نداءٍ داخليٍّ. */
  INPUT_INVALID: 'TIME_INPUT_INVALID',
  /** رسالةُ الرَّدِّ لا تُفكُّ: طولٌ ناقصٌ أو إزاحاتٌ أو وسومٌ غيرُ مرتَّبةٍ. */
  RESPONSE_MALFORMED: 'TIME_RESPONSE_MALFORMED',
  /** وسمٌ واجبٌ غائبٌ عن الرسالةِ. */
  TAG_MISSING: 'TIME_TAG_MISSING',
  /** وسمٌ موجودٌ بطولٍ مخالفٍ لطولِه المُثبَّتِ. */
  TAG_SIZE_INVALID: 'TIME_TAG_SIZE_INVALID',
  /** مصدرٌ غيرُ معلَنٍ في السياسةِ، أو مِفتاحٌ لا يطابقُ المُعلَنَ. */
  SOURCE_UNKNOWN: 'TIME_SOURCE_UNKNOWN',
  /** توقيعُ الشهادةِ (`CERT`) لا يتحقَّقُ بالمِفتاحِ الطويلِ المُعلَنِ. */
  DELEGATION_SIGNATURE_INVALID: 'TIME_DELEGATION_SIGNATURE_INVALID',
  /** الوقتُ المُوقَّعُ خارجَ نافذةِ صلاحيةِ التفويضِ (‏`MINT`..`MAXT`). */
  DELEGATION_WINDOW_INVALID: 'TIME_DELEGATION_WINDOW_INVALID',
  /** توقيعُ الرَّدِّ (`SREP`) لا يتحقَّقُ بالمِفتاحِ المُفوَّضِ. */
  SIGNATURE_INVALID: 'TIME_SIGNATURE_INVALID',
  /** المُستهانُ (`nonce`) الذي أرسلناه غيرُ مشمولٍ بجذرِ ميركل: رَدٌّ مُعادٌ. */
  NONCE_NOT_INCLUDED: 'TIME_NONCE_NOT_INCLUDED',
  /** مسارُ ميركل أقصرُ من الفهرسِ المُعلَنِ أو أطولُ منه. */
  MERKLE_PATH_INVALID: 'TIME_MERKLE_PATH_INVALID',
  /** نصفُ قُطرِ عدمِ اليقينِ أوسعُ من الحدِّ المُعلَنِ: بُرهانٌ بلا فائدةٍ. */
  RADIUS_TOO_WIDE: 'TIME_RADIUS_TOO_WIDE',
  /** عددُ المصادرِ المُتحقَّقِ منها أقلُّ من النِّصابِ المُعلَنِ. */
  QUORUM_NOT_MET: 'TIME_QUORUM_NOT_MET',
  /** مصادرُ صحيحةُ التوقيعِ لا تتقاطعُ فتراتُها: أحدُها يكذبُ ولا يُعرَفُ أيُّها. */
  SOURCES_DISAGREE: 'TIME_SOURCES_DISAGREE',
  /** بُرهانُ الوقتِ أقدمُ من مُدَّةِ صلاحيتِه المُعلَنةِ. */
  ATTESTATION_STALE: 'TIME_ATTESTATION_STALE',
  /** ساعةُ الجهازِ تُخالفُ الوقتَ المُبرهَنَ بأكثرَ من حدِّ التسامحِ. */
  LOCAL_SKEW_EXCEEDED: 'TIME_LOCAL_SKEW_EXCEEDED',
  /** لا بُرهانَ وقتٍ في مسارٍ يلزمُه: فشلٌ مُغلَقٌ لا سقوطٌ إلى ساعةِ الجهازِ. */
  ATTESTED_TIME_REQUIRED: 'ATTESTED_TIME_REQUIRED',
  /** النقلُ إلى المصدرِ فشلَ أو انقضت مُهلتُه. */
  TRANSPORT_FAILED: 'TIME_TRANSPORT_FAILED',
});

/** خطأُ وقتٍ مُسمّى: الرمزُ للأتمتةِ والنصُّ لمن يقرأُ الرفضَ. */
export class TimeError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   * @param {Record<string, unknown>} [detail]
   */
  constructor(code, message, detail = {}) {
    super(`${code}: ${message}`);
    this.name = 'TimeError';
    this.code = code;
    this.detail = Object.freeze({ ...detail });
  }
}
