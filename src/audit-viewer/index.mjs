/**
 * مَخرجُ عارضِ سجلِّ التدقيق — الخطوة `M9.07`.
 *
 * يُصدَّر من هنا ما يُنادى وما يُفحص: العارضُ، ومُحمِّلُ وثيقتِه، ورموزُ رفضِه،
 * وصنفُ خطئِه، وأوجهُه الثلاثةُ — وهي حدٌّ يُقرأ من الكودِ في الحاجزِ والاختبارِ
 * معاً فلا يُوسَّع في أحدِهما بلا الآخر.
 */

export {
  AuditLogViewer,
  AuditViewerError,
  AUDIT_VIEWER_ERRORS,
  AUDIT_VIEWER_FACES,
  loadAuditViewerPolicy,
  DEFAULT_AUDIT_VIEWER_CONFIG_DIR,
} from './audit-log-viewer.mjs';
