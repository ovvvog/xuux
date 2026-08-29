/**
 * واجهةُ التقاريرِ الملكيةِ الدورية — الخطوة `M8.09`.
 *
 * بابٌ واحدٌ للتقارير: الوثيقةُ تُحمَّل بـ`loadReportPolicy`، والمقاييسُ تُبنى
 * بـ`createReportMeasures` من المستودعاتِ نفسِها لا من أرقامٍ تُمرَّر، والتوليدُ
 * والمراجعةُ والنشرُ في `RoyalReportGenerator`.
 *
 * **حدٌّ معلَن:** لا شيءَ هنا يُصدِّر التقريرَ إلى صيغةٍ للعرضِ (PDF أو غيره):
 * الوحدةُ تُنتج صفّاً مقيساً مُراجَعاً منشوراً، والعرضُ مسارٌ لاحقٌ لم يُنفَّذ.
 */

export {
  DEFAULT_REPORTS_CONFIG_DIR,
  REPORT_ERRORS,
  REPORT_STATES,
  ReportError,
  RoyalReportGenerator,
  createReportMeasures,
  loadReportPolicy,
} from './royal-report.mjs';
