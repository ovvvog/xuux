/**
 * مُعالِج اختبار يتجمّد في **حلقة محسوبة مشغولة** لا في `setTimeout`.
 *
 * والفرق جوهري: مهلةٌ مبنية على `Promise.race` داخل العملية نفسها تنجح ظاهرياً مع
 * انتظارٍ خامل، لكنها لا تقطع حلقةً تحتكر المعالج. فهذا المُعالِج يحتكر المعالج
 * عمداً كي يُثبت أن المهلة تُقتل بإشارة على عملية، لا بوعدٍ يسبق وعداً.
 * @param {Record<string, unknown>} payload
 * @returns {Promise<Record<string, unknown>>}
 */
export default async function handle(payload) {
  const busy = payload['busy'] !== false;
  if (!busy) {
    await new Promise(() => {});
    return {};
  }
  // حلقة لا تنتهي: تُقطع بالقتل وحده.
  let counter = 0;
  for (;;) counter = (counter + 1) % 1_000_000;
}
