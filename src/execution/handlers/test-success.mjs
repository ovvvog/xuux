/**
 * مُعالِج اختبار ينجح — يُعيد الحمولة موسومةً كي يُفحص أن النتيجة عادت من
 * العملية الابن فعلاً لا من الأمّ. مقصودٌ للاختبار وحده.
 * @param {Record<string, unknown>} payload
 * @returns {Promise<Record<string, unknown>>}
 */
export default async function handle(payload) {
  const delayMs = typeof payload['delayMs'] === 'number' ? payload['delayMs'] : 0;
  if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
  return { نُفِّذ: true, pid: process.pid, صدى: payload };
}
