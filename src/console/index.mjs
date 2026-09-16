/**
 * مَخرجُ الديوانِ الملكيّ — الخطوة `M9.03`.
 *
 * يُصدَّر من هنا ما يُنادى وما يُفحص: الديوانُ، ومُحمِّلُ وثيقتِه، ورموزُ رفضِه،
 * وصنفُ خطئِه، وحدُّ أنواعِ مسارِ التعافي — وهو حدٌّ يُقرأ من الكودِ في الحاجزِ
 * والاختبارِ معاً، فلا يُوسَّع في أحدِهما بلا الآخر.
 *
 * ويُصدَّرُ معه **كاتبُ الديوانِ السياديُّ** (‏سدادُ `D-1`): مِقبضُ الكتابةِ الذي
 * لا يقبلُ توقيعاً من المُنادي بل يطلبُه من وحدةِ أمانٍ تُعلِنُ أنّها لا تُصدِّرُ
 * مادّتَها، ثمّ يُمضي الأمرَ إلى الديوانِ بكلِّ فحوصِه بلا تخفيفِ واحدٍ منها.
 */

export {
  RoyalConsole,
  ConsoleError,
  CONSOLE_ERRORS,
  RECOVERY_KINDS,
  loadConsolePolicy,
  DEFAULT_CONSOLE_CONFIG_DIR,
} from './royal-console.mjs';

export {
  SovereignWriter,
  SovereignWriteError,
  WRITER_ERRORS,
  moduleSignerFromHsm,
} from './sovereign-writer.mjs';
