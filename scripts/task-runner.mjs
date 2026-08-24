#!/usr/bin/env node
/**
 * منفّذ المهمة الواحدة في عملية منفصلة — الخطوة `M5.05`.
 *
 * يُقلعه `runWithLimits` بـ`fork` ويُرسل إليه رسالة `run` واحدة، فيستورد مُعالِج
 * الفعل من السجل ويُشغّله ويُعيد النتيجة رسالةً على قناة IPC ثم يخرج.
 *
 * سببُ فصله عملية: المهلة وحدّ الذاكرة والإلغاء القسري لا تُفرض على كودٍ يعمل في
 * نفس العملية (انظر التعليل الطويل في `src/execution/limits.mjs`).
 *
 * حدٌّ معلن: هذه العملية ليست حبساً أمنياً — ترث صلاحيات أمّها ونظام ملفاتها.
 * وهي حدُّ موارد لا عزلة ثقة.
 */

import { loadHandler } from '../src/execution/handlers.mjs';
import { LIMIT_ERRORS } from '../src/execution/limits.mjs';

const startCpu = process.cpuUsage();

/** @returns {number} زمن المعالج المستهلك بالمللي (مستخدم + نظام). */
function cpuMs() {
  const used = process.cpuUsage(startCpu);
  return Math.round((used.user + used.system) / 1000);
}

/**
 * @param {Record<string, unknown>} message
 * @returns {void}
 */
function reply(message) {
  // `process.send` غير معرّفة إن شُغّل الملف بلا `fork`؛ فيُعلن ذلك بوضوح بدل أن
  // تُبتلع النتيجة صامتة ويظنّ الظانّ أن المهمة نُفّذت وأُبلغ عنها.
  if (typeof process.send !== 'function') {
    console.error('[منفّذ] لا قناة IPC: هذا الملف يُقلع بـfork لا يُشغَّل مباشرة.');
    process.exit(2);
  }
  process.send(message);
}

/**
 * مقبضٌ حيّ يبقى قائماً أثناء التنفيذ.
 *
 * لماذا؟ لأن مُعالِجاً ينتظر وعداً لا يُحلّ أبداً (`await new Promise(() => {})`)
 * لا يترك في حلقة الأحداث مؤقّتاً ولا اتصالاً، فتخرج عملية Node **برمز صفر**
 * وكأنها انتهت بنجاح بلا نتيجة. وذلك أسوأ من التجمّد: تجمّدٌ تقتله المهلة، أمّا
 * الخروج الصامت فيُقرأ «مات المنفّذ» ولا يُقرأ «تجاوز مهلته». فيُثبَّت مقبضٌ حيّ
 * كي يكون التجمّدُ تجمّداً حقيقياً تحسمه المهلة من الأمّ.
 * @type {NodeJS.Timeout | null}
 */
let keepAlive = null;

process.once('message', async (raw) => {
  const request = /** @type {Record<string, unknown>} */ (raw);
  if (request['type'] !== 'run') return;
  keepAlive = setInterval(() => {}, 1_000);
  const action = String(request['action'] ?? '');
  const payload = /** @type {Record<string, unknown>} */ (request['payload'] ?? {});

  try {
    const handler = await loadHandler(action);
    const result = await handler(payload);
    if (keepAlive !== null) clearInterval(keepAlive);
    reply({ type: 'done', result: result ?? {}, cpuMs: cpuMs() });
    process.exit(0);
  } catch (error) {
    const code =
      error instanceof Error && typeof (/** @type {{ code?: unknown }} */ (error).code) === 'string'
        ? String(/** @type {{ code?: unknown }} */ (error).code)
        : LIMIT_ERRORS.HANDLER_FAILED;
    if (keepAlive !== null) clearInterval(keepAlive);
    reply({
      type: 'error',
      code,
      message: error instanceof Error ? error.message : String(error),
      cpuMs: cpuMs(),
    });
    process.exit(1);
  }
});

// `SIGTERM` هي نافذة التهذيب قبل القتل: تُقبل بالخروج فوراً. ولا يُدّعى تنظيفٌ لا
// يُجرى — من احتاج تنظيفاً فعليّاً في مُعالِجه فليُعلنه، وهذا حدٌّ معلن.
process.on('SIGTERM', () => {
  process.exit(143);
});
