/**
 * صورة عميقة مُجمَّدة — الخطوة `M2.11`، إصلاح العيب `D1`.
 *
 * كانت كل السجلات تُرجع `Object.freeze({ ...record })`، والتجميد **سطحي**:
 * الحقول المركّبة تُنسخ بالمرجع فتبقى مشتركة مع السجل الداخلي. فمن أخذ «صورة
 * مُجمَّدة» قدر أن يدسّ قدرة محرَّمة في مصفوفة قدرات نموذج مسجَّل، ودسُّه يقع في
 * السجل نفسه — أي أن فحوص القدرات عند التسجيل تُتجاوز **بعد** التسجيل. وأسوأ من
 * التسريب أن التجميد الظاهر يُسكت الشكّ: من رأى `Object.isFrozen` صادقة توقّف عن
 * الحذر.
 *
 * ولذلك: **نسخٌ ثم تجميد**، لا تجميدٌ في المكان. التجميد في المكان كان سيُجمّد
 * كائناً يملكه المستدعي (محتوى الذاكرة مثلاً) فيُعطّل كوداً لا نملكه.
 *
 * **حدّ معلن:** ما ليس مصفوفةً ولا كائناً بسيطاً — نسخةُ صنف، و`Buffer`،
 * و`Date`، و`Map`، ودالة — يُمرَّر **بالمرجع** كما هو. نسخُه نسخاً عاماً يفقد
 * صنفه ويكسر سلوكه، وهذا ثمنٌ أعلى من الفائدة. فالسجلات التي تحمل مثل هذه القيم
 * (‏`content` في مخزن الذاكرة) محميّةٌ في هيكلها لا في محتواها، وهو مصرَّح به
 * ومُختبر في `tests/core/immutability-gates.test.mjs`.
 */

/**
 * هل القيمة كائن بسيط (‏`{}` أو بلا سلف)؟ نسخةُ الصنف ليست كذلك.
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isPlainObject(value) {
  if (typeof value !== 'object' || value === null) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * نسخٌ عميق مع تجميد كل مستوى. الخريطة تمنع الدوران اللانهائي في مرجعٍ دائري
 * وتحفظ الاشتراك: مرجعان إلى نفس الكائن يبقيان مرجعين إلى نفس النسخة.
 * @param {unknown} value
 * @param {WeakMap<object, unknown>} seen
 * @returns {unknown}
 */
function cloneDeep(value, seen) {
  if (Array.isArray(value)) {
    const cached = seen.get(value);
    if (cached !== undefined) return cached;
    /** @type {unknown[]} */
    const copy = [];
    seen.set(value, copy);
    for (const item of value) copy.push(cloneDeep(item, seen));
    return Object.freeze(copy);
  }
  if (isPlainObject(value)) {
    const cached = seen.get(value);
    if (cached !== undefined) return cached;
    /** @type {Record<string, unknown>} */
    const copy = {};
    seen.set(value, copy);
    for (const [key, item] of Object.entries(value)) copy[key] = cloneDeep(item, seen);
    return Object.freeze(copy);
  }
  return value;
}

/**
 * صورةٌ عميقة مُجمَّدة من سجل. تُستعمل في كل موضع كان يُرجع
 * `Object.freeze({ ...record })`.
 * @template T
 * @param {T} record
 * @returns {Readonly<T>}
 */
export function snapshot(record) {
  return /** @type {Readonly<T>} */ (/** @type {unknown} */ (cloneDeep(record, new WeakMap())));
}
