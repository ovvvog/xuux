/**
 * ميزانيةُ الأخطاء — الشقُّ الحسابيُّ من الخطوة `M10.02`.
 *
 * **العيبُ الذي تُغلقه هذه الوحدة:** الميزانيةُ رقمٌ يُشتقّ من الهدف، ومن كتبه
 * إلى جانبِ الهدفِ في الوثيقةِ صنع **مصدرَي حقيقةٍ لرقمٍ واحد**: يُشدَّد الهدفُ
 * ولا تُعدَّل الميزانيةُ فتبقى اللوحةُ خضراءَ على هدفٍ لم يعد قائماً. وهذا
 * العيبُ بعينِه رُصد ثلاثَ مرّاتٍ في عدّادِ الخارطةِ (‏`WL-005` و`WL-030`
 * و`WL-052`) — عمودٌ يُجمَع وحقلٌ يُكتب بيدٍ، فينحرفان.
 *
 * **فالقاعدة: الميزانيةُ تُحسَب ولا تُكتب.** المسموحُ به حاصلُ ضربِ متمِّمِ
 * الهدفِ في مجموعِ الأحداثِ المقيسة، والمستهلَكُ عددُ المُخفِقِ فعلاً،
 * والمتبقّي فرقُهما. ولا رقمَ هدفٍ واحدٌ مكتوبٌ هنا: كلُّها تصل مُعامِلاتٍ من
 * `config/service-levels.yaml`.
 *
 * والضمانُ المُنفَّذُ هنا `G-SLO-BUDGET-FROM-OBJECTIVE`، ورمزُ رفضِه
 * `SLO_BUDGET_EXHAUSTED` يُصدَر من مِقبضِ التأكيدِ في `service-levels.mjs`
 * بناءً على الحكمِ الذي تُصدره هذه الوحدة.
 *
 * **حدودٌ معلَنة:**
 * 1. **الدوالُّ نقيّةٌ لا حالةَ فيها**: لا تقرأ ساعةً ولا سجلَّ مقاييسَ ولا
 *    ملفّاً؛ تأخذ أعداداً وتُعيد أعداداً. فما يُختبَر منها يُختبَر بلا تركيب.
 * 2. **لا نافذةَ زمنيةً هنا**: الأحداثُ تصل مجموعةً، وحدُّ النافذةِ مُعلَنٌ في
 *    الوثيقةِ (نافذةُ الميزانيةِ عمرُ العملية) لا مُنفَّذٌ هنا.
 *
 * @module service-levels/budget
 */

/**
 * @typedef {object} BudgetReading
 * @property {number} allowed المسموحُ به من الأحداثِ المُخفِقة — مشتقٌّ من الهدف.
 * @property {number} consumed المستهلَكُ فعلاً.
 * @property {number} remaining المتبقّي، وقد يكون سالباً حين يُتجاوَز.
 * @property {number | null} consumedRatio نسبةُ الاستهلاك، و`null` حين لا ميزانيةَ أصلاً.
 * @property {boolean} exhausted هل استُنفدت.
 */

/**
 * نسبةُ الالتزامِ المقيسة — و`null` حين لا حدثَ واحدٌ وقع.
 *
 * **وصفرُ أحداثٍ ليس التزاماً تامّاً:** من أعاد `1` هنا على مجموعٍ صفريٍّ صنع
 * لوحةً تُقرأ «مئةً في المئة» وهي لم تقس شيئاً — وذاك أخطرُ من عمودٍ فارغٍ
 * لأنه فارغٌ **يبدو ممتلئاً**.
 *
 * @param {{ good: number, total: number }} events
 * @returns {number | null}
 */
export function attainment({ good, total }) {
  if (!Number.isFinite(total) || total <= 0) return null;
  if (!Number.isFinite(good) || good < 0) return null;
  return good / total;
}

/**
 * الانحرافُ عن الهدفِ رقماً موجباً أو سالباً — و`null` حين لا قياس.
 *
 * @param {{ measured: number | null, target: number }} reading
 * @returns {number | null}
 */
export function deviation({ measured, target }) {
  if (measured === null) return null;
  return measured - target;
}

/**
 * ميزانيةُ الأخطاءِ مشتقّةً من الهدفِ نفسِه.
 *
 * @param {{ total: number, bad: number, target: number }} input
 * @returns {BudgetReading}
 */
export function errorBudget({ total, bad, target }) {
  // والحسابُ `total - target * total` لا `(1 - target) * total`: وهما سواءٌ
  // جبراً ولا يستويانِ في الفاصلةِ العائمة — فمُتمِّمُ هدفٍ كسرِيٍّ يُحسب أوّلاً
  // يخرج بديلاً تقريبيًّا له، فيصير المسموحُ على ألفِ حدثٍ عدداً بذيلٍ من
  // الكسور لا عدداً مدوراً. ورقمٌ كهذا في لوحةٍ يُقرأ عيباً في القياسِ لا في
  // الحساب. **وهو حدٌّ لا يُلغى**: الفاصلةُ العائمةُ باقيةٌ ولا يُدَّعى
  // إلغاءُها؛ والمختارُ أقلُّ الصورتين ضجيجاً عند الأهدافِ المُعلَنة.
  const allowed = Number.isFinite(total) && total > 0 ? total - target * total : 0;
  const consumed = Number.isFinite(bad) && bad > 0 ? bad : 0;
  const remaining = allowed - consumed;
  return Object.freeze({
    allowed,
    consumed,
    remaining,
    consumedRatio: allowed > 0 ? consumed / allowed : null,
    exhausted: allowed > 0 ? consumed > allowed : consumed > 0,
  });
}

/**
 * حكمُ الهدفِ من نسبةِ التزامِه — ثلاثةُ أحوالٍ لا اثنان: و«غيرُ مقيسٍ» حالٌ
 * قائمةٌ بذاتها لا تُطوى في «مستوفٍ».
 *
 * @param {{ measured: number | null, target: number }} reading
 * @returns {'meeting' | 'breaching' | 'unmeasured'}
 */
export function objectiveStatus({ measured, target }) {
  if (measured === null) return 'unmeasured';
  return measured >= target ? 'meeting' : 'breaching';
}
