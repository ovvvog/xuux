/**
 * محرّك السياسات والصلاحيات — المسار M4.
 *
 * ما تعرضه هذه الوحدة: تحميل السياسات كبيانات (`loadPolicyBundle`)، ونقطة قرار
 * تُقيّم وتُسبّب (`PolicyDecisionPoint`)، ونقطة تفويض مركزية واحدة يمرّ بها كل
 * فعل محكوم (`EnforcementPoint`)، وكتالوج الأفعال المحكومة مشتقّاً من البيانات.
 *
 * وما **لا** تعرضه: أي دالة تُعيد «مسموح» بلا سبب. القرار في هذا المسار كائنٌ
 * يحمل رمزه وسببه وسياسته الحاكمة، لا قيمة منطقية.
 */

export { loadPolicyBundle, CONFIG_DIR } from './loader.mjs';
export { PolicyDecisionPoint, createPolicyDecisionPoint } from './engine.mjs';
export { EnforcementPoint, createEnforcementPoint } from './enforcement-point.mjs';
export { loadGovernedActions, resetGovernedActions } from './governed.mjs';
