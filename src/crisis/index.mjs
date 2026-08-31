/**
 * مَخرجُ غرفةِ الأزمات — الخطوة `M9.06`.
 *
 * يُصدَّر من هنا ما يُنادى وما يُفحص: الغرفةُ، ومُحمِّلُ وثيقتِها، ورموزُ رفضِها،
 * وصنفُ خطئِها، وأنواعُ خطواتِها — وهي حدٌّ يُقرأ من الكودِ في الحاجزِ
 * والاختبارِ معاً فلا يُوسَّع في أحدِهما بلا الآخر.
 */

export {
  CrisisRoom,
  CrisisError,
  CRISIS_ERRORS,
  CRISIS_STEP_KINDS,
  loadCrisisPolicy,
  DEFAULT_CRISIS_CONFIG_DIR,
} from './crisis-room.mjs';
