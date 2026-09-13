// نقطة تفويض **حقيقية** لاختبارات الاستمرارية والتجميد — أُضيفت في `M7.02`.
//
// بعد أن صار الوصول إلى البيانات يمرّ ببوابةٍ تُقيّم السياسة وتتحقّق من التذكرة،
// صارت اختبارات القاعدة تحتاج نقطة تفويض كي تكتب أصلاً. وُضعت هنا لأن بديلها
// نقطةٌ مزيّفة في كل ملف: واختبارٌ يُبنى على مزيّفٍ يُثبت أن الكود ينادي المزيّف
// لا أنه محكوم. والحزمة تُحمَّل مرّة واحدة لأنها ملفٌ على القرص.

import { createPolicyDecisionPoint } from '../../src/policy/engine.mjs';
import { EnforcementPoint } from '../../src/policy/enforcement-point.mjs';
import { loadPolicyBundle } from '../../src/policy/loader.mjs';

const bundle = loadPolicyBundle();

/**
 * @param {{ append: (type: string, actor: string, payload: object) => unknown }} log
 * @returns {EnforcementPoint}
 */
export function enforcementPointFor(log) {
  return new EnforcementPoint({
    decisionPoint: createPolicyDecisionPoint({ bundle }),
    log: /** @type {never} */ (log),
    requireIdentityGate: false, // اختباراتٌ لا تُمرِّر بوابةَ هويةٍ
  });
}

/**
 * فاعلٌ بدورٍ معلَن في `config/roles.yaml`. التخليص **لا يُمرَّر**: تشتقّه بوابة
 * الوصول من الدور بعد التحقّق من الهوية، فلا يستطيع الاختبار أن يزعمه.
 * @param {string} role
 * @param {Record<string, unknown>} [patch]
 * @returns {never}
 */
export function testActor(role, patch = {}) {
  return /** @type {never} */ ({
    id: `agent:${role.replace('role:', '')}-test`,
    role,
    kind: role === 'role:agent' ? 'agent' : 'human',
    state: 'active',
    scope: 'org:interior',
    ...patch,
  });
}
