/**
 * مَخرجُ طبقةِ النقلِ — سدادُ الدَينِ `D-1`.
 *
 * يُصدَّرُ من هنا ما يُنادى وما يُفحَصُ وحدَه: مُنشِئُ الخادمِ، ومُشتَقُّ جدولِ
 * المساراتِ ومُطابِقُه ومُترجِمُ وُسطائِه، وخريطةُ الحالاتِ، ورموزُ الرفضِ، وصنفُ
 * الخطأِ — لأنّ لكلٍّ منها اختباراً مباشراً وحاجزاً يقابلُه بالوثيقةِ.
 */

export { createStateServer } from './server.mjs';
export { TransportError, compileRoutes, matchRoute, paramsFor } from './router.mjs';
export { TRANSPORT_ERRORS, STATUS_BY_CODE, codeOf, problemFor } from './problem.mjs';
export { resolveStaticFile } from './static.mjs';
