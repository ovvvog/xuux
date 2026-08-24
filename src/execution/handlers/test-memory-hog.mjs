/**
 * مُعالِج اختبار يستهلك الذاكرة حتى يتجاوز الحدّ.
 *
 * حدٌّ معلن: الحدّ المفروض هو سقف كومة V8 (`--max-old-space-size`) لا الذاكرة
 * المقيمة (RSS) بضابط نظام: بُنى خارج الكومة (مثل `Buffer`) لا يحرسها هذا السقف.
 * الحرس الكامل يحتاج cgroups أو `ulimit`، وذلك أثرٌ على النظام لم يُتّخذ قراره.
 * @param {Record<string, unknown>} payload
 * @returns {Promise<Record<string, unknown>>}
 */
export default async function handle(payload) {
  const chunkMb = typeof payload['chunkMb'] === 'number' ? payload['chunkMb'] : 8;
  /** @type {number[][]} */
  const held = [];
  for (;;) {
    // مصفوفة أعداد تسكن الكومة (لا `Buffer` فهو خارجها ولا يحرسه السقف).
    held.push(new Array(chunkMb * 131_072).fill(1));
  }
}
