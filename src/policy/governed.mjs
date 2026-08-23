/**
 * كتالوج الأفعال المحكومة — M4.05
 *
 * موضعه هنا لا في النواة لسبب واحد: النواة يجب أن تعرف أن الفعل محكوم **قبل**
 * أن تعرف من سيقرّر فيه. فلو كانت المعرفة تأتي من نقطة التفويض وحدها، لصار من
 * بنى نواةً بلا نقطة تفويض ينفّذ الأفعال الحسّاسة بلا قرار — أي أن المسار
 * الجانبي كان سيكون «لا تُوصل النقطة».
 *
 * فالكتالوج يُقرأ من البيانات (`config/policies.yaml` و`royal-authority.yaml`)
 * ويُخزَّن مرّة واحدة: قراءة القرص في كل مهمة تحوّل حاجزاً أمنياً إلى عبء أداء
 * فيُطفَأ. ومن أراد إعادة القراءة بعد تعديل معتمد يستدعي `resetGovernedActions`.
 */

import { loadPolicyBundle } from './loader.mjs';

/** @type {ReadonlySet<string> | null} */
let cached = null;

/**
 * الأفعال التي لا تُنفَّذ إلا عبر نقطة التفويض: الحسّاس في كتالوج الأفعال موحَّداً
 * مع كل فعل في العتبة السيادية.
 * @returns {ReadonlySet<string>}
 */
export function loadGovernedActions() {
  if (cached !== null) return cached;
  const bundle = loadPolicyBundle();
  /** @type {Set<string>} */
  const governed = new Set();
  for (const action of bundle.actions.values()) {
    if (action.sensitive) governed.add(action.id);
  }
  for (const entry of bundle.threshold) governed.add(entry.action);
  cached = Object.freeze(governed);
  return cached;
}

/**
 * يُسقط المخزون فتُقرأ البيانات من جديد. للاختبارات وللتعديل المعتمد بعد إصدار
 * سياسة جديدة (M4.06).
 * @returns {void}
 */
export function resetGovernedActions() {
  cached = null;
}
