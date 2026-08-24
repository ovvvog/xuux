/**
 * مُعالِج اختبار يرمي خطأً — كي يُفحص أن فشل المُعالِج يُصنَّف
 * `TASK_HANDLER_FAILED` ولا يُخلط بانتهاء المهلة أو بتجاوز الذاكرة.
 * @param {Record<string, unknown>} payload
 * @returns {Promise<Record<string, unknown>>}
 */
export default async function handle(payload) {
  const message = typeof payload['message'] === 'string' ? payload['message'] : 'فشل مقصود';
  throw new Error(message);
}
