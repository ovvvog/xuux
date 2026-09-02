// تسعيرُ الاستهلاكِ وجمعُه — نقيٌّ بلا أثرٍ ولا ساعةٍ ولا سجلّ.
//
// **ولا رقمَ سعرٍ ولا سقفٍ في هذا الملفّ:** كلُّ ثمنٍ يصل إلى هنا **مُمرَّراً**
// من `config/cost-capacity.yaml`، ويقيس الحاجزُ (R5) غيابَ الأرقامِ نصّاً.
// فسعرٌ مكتوبٌ في الوثيقةِ وفي الكودِ مصدرا حقيقةٍ لشيءٍ واحدٍ يُشدَّد أحدُهما
// ويبقى الآخرُ يعمل بالقديم.
//
// **والمالُ بالأعدادِ الصحيحة.** الكلفةُ مِلّي‑وحدةٍ صحيحةٌ لا فاصلةٌ عائمة،
// والتقريبُ **عند كلِّ قيدٍ على حدة** (`Math.round`) لا عند جمعِ الشهر: فجمعُ
// كسورٍ عائمةٍ ثم تقريبُها يُنتج دفتراً لا يُطابَق قيداً قيداً، وأوّلُ من
// يكتشفه من يعترض على فاتورتِه.
//
// **وشهرُ القيدِ من ختمِ القيد** بالتوقيتِ العالميِّ المنسَّق لا من ساعةِ من
// يطلب التقرير؛ فالتقريرُ الواحدُ لا يتبدّل بمن قرأه ولا بموضعِه من الأرض.
//
// والضماناتُ المُنفَّذةُ هنا: `G-COST-INTEGER-MONEY` و`G-COST-PERIOD-FROM-ENTRY`.

import { COST_ERRORS, CostCapacityError } from './errors.mjs';

/**
 * @typedef {object} CostItemLike
 * @property {string} id
 * @property {string} resource
 * @property {number} perUnits
 * @property {number} unitPriceMilli
 */

/**
 * قيدُ استهلاكٍ واحدٌ **يحمل أبعادَه الثلاثةَ معاً**: فالعملُ الواحدُ وقع من
 * وكيلٍ في مؤسسةٍ على نموذجٍ، وقيدٌ لكلِّ بُعدٍ على حدةٍ يُضاعِف المجموعَ ثلاثاً
 * ويجعل «كم أنفقت الدولةُ؟» سؤالاً له ثلاثةُ أجوبةٍ متناقضة.
 *
 * @typedef {object} UsageEntryLike
 * @property {string} item
 * @property {string} institution
 * @property {string} agent
 * @property {string} model
 * @property {number} quantity
 * @property {number} atMs
 * @property {number} costMilli
 */

/**
 * كلفةُ قيدٍ واحدٍ بالمِلّي‑وحدة.
 *
 * **الكميّةُ عددٌ صحيحٌ غيرُ سالبٍ ومنتهٍ**، وما دونَ ذلك يُرَدُّ باسمِه: كميّةٌ
 * كسريةٌ أو سالبةٌ أو `NaN` تمرّ صامتةً فتُنتج دفتراً يُقرأ ولا يُصدَّق.
 *
 * @param {{ item: CostItemLike, quantity: number }} input
 * @returns {number}
 */
export function costMilliOf({ item, quantity }) {
  if (!Number.isInteger(quantity) || quantity < 0) {
    throw new CostCapacityError(
      COST_ERRORS.QUANTITY_INVALID,
      `الكميّةُ «${String(quantity)}» ليست عدداً صحيحاً غيرَ سالب؛ ودفترٌ يقبل كميّةً لا تُعَدُّ دفترٌ لا يُطابَق.`,
      { item: item.id, quantity },
    );
  }
  return Math.round((quantity * item.unitPriceMilli) / item.perUnits);
}

/**
 * شهرُ القيدِ التقويميُّ بالتوقيتِ العالميِّ المنسَّق، مشتقّاً من ختمِ القيد.
 *
 * @param {number} atMs
 * @returns {string}
 */
export function periodOf(atMs) {
  if (!Number.isFinite(atMs)) {
    throw new CostCapacityError(
      COST_ERRORS.PERIOD_INVALID,
      `ختمُ القيدِ «${String(atMs)}» ليس عدداً منتهياً، فلا شهرَ يُشتَقُّ منه؛ وقيدٌ بلا زمنٍ قيدٌ لا يقع في تقريرٍ بعينه.`,
      { atMs },
    );
  }
  const date = new Date(atMs);
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + 1;
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`;
}

/**
 * التحقُّقُ من صيغةِ شهرٍ مطلوبٍ في التقرير.
 *
 * @param {unknown} period
 * @returns {string}
 */
export function assertPeriod(period) {
  if (typeof period !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) {
    throw new CostCapacityError(
      COST_ERRORS.PERIOD_INVALID,
      `الشهرُ المطلوبُ «${String(period)}» ليس على صيغةِ «سنة-شهر» التقويميةِ المُعلَنة؛ وتقريرٌ بمدًى يخترعه طالبُه تقريرٌ لا يُقارَن بغيرِه.`,
      { period },
    );
  }
  return period;
}

/**
 * جمعُ قيودِ شهرٍ على بُعدٍ واحدٍ من أبعادِه: خريطةُ «صاحبٍ ⇐ بندٌ ⇐ كميّةٌ
 * وكلفة». والبُعدُ حقلٌ في القيدِ نفسِه لا سجلٌّ ثانٍ يُقرأ.
 *
 * **ويُعاد كلُّ من وقع له قيدٌ ولو كان واحداً**، ولا يُخترَع صاحبٌ لم يقع له
 * قيدٌ لِيُعرَض صفراً — فصفرٌ لصاحبٍ لم يعمل يُقرأ توفيراً وهو غيابُ قياس.
 *
 * @param {{ entries: readonly UsageEntryLike[], dimension: 'institution' | 'agent' | 'model' }} input
 * @returns {Map<string, Map<string, { units: number, costMilli: number, entries: number }>>}
 */
export function aggregateBy({ entries, dimension }) {
  /** @type {Map<string, Map<string, { units: number, costMilli: number, entries: number }>>} */
  const bySubject = new Map();
  for (const entry of entries) {
    const subject = entry[dimension];
    let items = bySubject.get(subject);
    if (items === undefined) {
      items = new Map();
      bySubject.set(subject, items);
    }
    const current = items.get(entry.item) ?? { units: 0, costMilli: 0, entries: 0 };
    current.units += entry.quantity;
    current.costMilli += entry.costMilli;
    current.entries += 1;
    items.set(entry.item, current);
  }
  return bySubject;
}

/**
 * مجموعُ الشهرِ لكلِّ بند — يُحسَب **على القيودِ نفسِها مرّةً واحدةً** لا بجمعِ
 * الأبعادِ الثلاثةِ بعضِها إلى بعض، لأنّ القيدَ الواحدَ يقع في الأبعادِ الثلاثةِ
 * كلِّها فيُحسَب ثلاثاً وتصير الجملةُ ثلاثةَ أضعافِ الحقيقة.
 *
 * @param {readonly UsageEntryLike[]} entries
 * @returns {Map<string, { units: number, costMilli: number, entries: number }>}
 */
export function totalsByItem(entries) {
  /** @type {Map<string, { units: number, costMilli: number, entries: number }>} */
  const totals = new Map();
  for (const entry of entries) {
    const current = totals.get(entry.item) ?? { units: 0, costMilli: 0, entries: 0 };
    current.units += entry.quantity;
    current.costMilli += entry.costMilli;
    current.entries += 1;
    totals.set(entry.item, current);
  }
  return totals;
}
