/**
 * مَخرجُ مركزِ العمليات — الخطوة `M9.05`.
 *
 * يُصدَّر من هنا ما يُنادى وما يُفحص: المركزُ، ومُحمِّلُ وثيقتِه، ورموزُ رفضِه،
 * وصنفُ خطئِه، وأوجهُه الخمسةُ وأوجهُ الحصصِ منها — وهي حدودٌ تُقرأ من الكودِ في
 * الحاجزِ والاختبارِ معاً فلا تُوسَّع في أحدِهما بلا الآخر — ومزوِّدُ الحصصِ
 * المبنيُّ على وثيقةِ الحصصِ الأصل.
 */

export {
  OperationsCenter,
  OperationsError,
  OPERATIONS_ERRORS,
  OPERATIONS_FACES,
  QUOTA_FACES,
  loadOperationsPolicy,
  quotaReaderFromPolicy,
  DEFAULT_OPERATIONS_CONFIG_DIR,
} from './operations-center.mjs';
