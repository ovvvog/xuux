/**
 * حدود موارد المهمة — الخطوة `M5.05`: مهلة زمنية، وحدّ ذاكرة، وإلغاء قسري.
 *
 * ## لماذا عملية منفصلة ولا وعدٌ يسبق وعداً
 *
 * الطريق الشائع لتنفيذ «مهلة» في Node هو `Promise.race([handler, timeout])`.
 * وهو **لا يحدّ شيئاً**: الوعد الخاسر يبقى يعمل، والمُعالِج الذي يحتكر المعالج في
 * حلقة محسوبة لا يترك حلقة الأحداث تصل إلى المؤقّت أصلاً، فلا المهلة تنطق ولا
 * العمل يتوقّف. وحدُّ الذاكرة أشدّ: لا سبيل إلى تحديد كومة العملية الجارية من
 * داخلها. فالحدّ الحقيقي يحتاج **حدوداً على عملية** يمكن قتلها من خارجها:
 *
 * - المهلة: مؤقّت في الأمّ يُرسل `SIGTERM` ثم `SIGKILL` بعد مهلة تهذيب.
 * - الذاكرة: `--max-old-space-size` على الابن، فيموت الابن بنفسه عند التجاوز.
 * - الإلغاء القسري: الأمّ تقتل الابن عند طلب إلغاء، ولا تنتظر تعاونه.
 *
 * ## الحدود المعلنة (لا تُقرأ هذه الوحدة أقوى مما هي)
 *
 * 1. حدّ الذاكرة هو **سقف كومة V8** لا الذاكرة المقيمة: ما يسكن خارج الكومة
 *    (`Buffer`, وحدات أصلية, خرائط ملفات) لا يحرسه. الحرس التامّ يحتاج cgroups أو
 *    `ulimit`، وهو أثرٌ على النظام لم يُتّخذ قراره بعد.
 * 2. «حدّ الحساب» مقيسٌ بزمن المعالج المستهلك (`cpuUsage` للابن) لا بعدّ تعليمات،
 *    ويُطبَّق بالقتل عند تجاوز المهلة؛ فليس حدّاً مستقلّاً عن المهلة بل قياسٌ يُسجَّل.
 * 3. القتل بـ`SIGKILL` لا يترك للمُعالِج فرصة تنظيف. من احتاج تنظيفاً فليستعمل
 *    نافذة `SIGTERM` قبله، ومدّتها معلنة في `GRACE_MS`.
 * 4. الابن يُنفَّذ بنفس صلاحيات الأمّ ونفس نظام الملفات: هذه ليست عزلةً أمنية
 *    (لا حاوية ولا مستخدم منفصل)، بل حدُّ موارد. عزلة الحدود الأمنية خارج `M5`.
 */

import { fork } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
/** مسار العملية الابن التي تُنفّذ المُعالِج. */
export const TASK_RUNNER_PATH = path.resolve(HERE, '../../scripts/task-runner.mjs');

/**
 * نافذة التهذيب بين `SIGTERM` و`SIGKILL`. رقمٌ معلن كي يُعرف السلوك لا يُخمَّن:
 * من لم يخرج في هذه المدّة يُقتل قتلاً لا يُراجَع فيه.
 */
export const GRACE_MS = 200;

/** رموز نتائج التنفيذ المحدود. تُكتب في `error_code` فتُقرأ آلياً لا بتحليل نصّ. */
export const LIMIT_ERRORS = Object.freeze({
  TIMEOUT: 'TASK_TIMEOUT',
  MEMORY: 'TASK_MEMORY_EXCEEDED',
  CANCELLED: 'TASK_CANCELLED',
  HANDLER_FAILED: 'TASK_HANDLER_FAILED',
  RUNNER_CRASHED: 'TASK_RUNNER_CRASHED',
  LIMIT_INVALID: 'TASK_LIMIT_INVALID',
});

/** خطأ حدود يحمل رمزاً مقروءاً آلياً. */
export class LimitError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   */
  constructor(code, message) {
    super(message);
    this.name = 'LimitError';
    /** @type {string} */
    this.code = code;
  }
}

/**
 * نتيجة تنفيذٍ محدود. `ok` تفصل النجاح عن الفشل، و`code` يفصل أنواع الفشل: خلطُ
 * انتهاء المهلة بفشل المُعالِج يُخفي عيباً في الحدود وراء عيبٍ في الكود.
 * @typedef {object} LimitedRun
 * @property {boolean} ok
 * @property {Record<string, unknown> | null} result
 * @property {string | null} code
 * @property {string | null} message
 * @property {number} durationMs
 * @property {number} cpuMs زمن المعالج الذي استهلكه الابن (قياس لا حدّ).
 * @property {boolean} killed هل قُتل الابن قسراً؟
 * @property {number | null} exitCode
 * @property {string | null} signal
 */

/**
 * @param {unknown} value
 * @param {string} field
 * @returns {number}
 */
function requirePositiveInt(value, field) {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new LimitError(
      LIMIT_ERRORS.LIMIT_INVALID,
      `${field} يجب أن يكون عدداً صحيحاً موجباً؛ حدٌّ غير صالح يُقرأ «لا حدّ» وهو أخطر من غيابه.`,
    );
  }
  return value;
}

/**
 * يُنفّذ مُعالِج فعلٍ في **عملية منفصلة** بحدود مفروضة من خارجها.
 *
 * @param {object} request
 * @param {string} request.action الفعل (يُترجم إلى مُعالِج في `handlers.mjs`).
 * @param {Record<string, unknown>} [request.payload]
 * @param {number} request.timeoutMs المهلة القصوى قبل القتل.
 * @param {number} request.memoryLimitMb سقف كومة الابن.
 * @param {AbortSignal} [request.signal] إلغاء قسري من الخارج (نبضة قلب أو إيقاف شامل).
 * @param {string} [request.taskId] يُمرَّر للابن للتسجيل وحده.
 * @returns {Promise<LimitedRun>}
 */
export function runWithLimits(request) {
  const timeoutMs = requirePositiveInt(request.timeoutMs, 'timeoutMs');
  const memoryLimitMb = requirePositiveInt(request.memoryLimitMb, 'memoryLimitMb');
  const startedAt = Date.now();

  return new Promise((resolve) => {
    const child = fork(TASK_RUNNER_PATH, [], {
      // سقف الكومة على الابن: هو الحدّ الحقيقي الوحيد للذاكرة هنا.
      execArgv: [`--max-old-space-size=${memoryLimitMb}`],
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      env: { ...process.env, XUUX_TASK_ID: request.taskId ?? '' },
    });

    /** @type {Record<string, unknown> | null} */
    let result = null;
    /** @type {string | null} */
    let failureCode = null;
    /** @type {string | null} */
    let failureMessage = null;
    let cpuMs = 0;
    let killed = false;
    /** @type {'timeout' | 'cancel' | null} سبب القتل، يُحسم به الرمز عند الخروج. */
    let killReason = null;
    let stderr = '';
    let settled = false;

    /** @param {'timeout' | 'cancel'} reason */
    function killChild(reason) {
      if (killReason !== null) return;
      killReason = reason;
      killed = true;
      // تهذيبٌ أوّلاً ثم قتلٌ لا يُراجَع: من لم يخرج طوعاً لا يُترك يعمل.
      child.kill('SIGTERM');
      setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      }, GRACE_MS).unref();
    }

    const timer = setTimeout(() => killChild('timeout'), timeoutMs);
    timer.unref();

    /** إلغاء قسري: لا يُنتظر تعاون المُعالِج، لأن المتجمّد لا يتعاون. */
    const onAbort = () => killChild('cancel');
    request.signal?.addEventListener('abort', onAbort, { once: true });

    child.stderr?.on('data', (chunk) => {
      stderr += String(chunk);
      // سقفٌ للنصّ المحفوظ: مُعالِجٌ يطبع بلا توقّف لا يجوز أن يُفجّر ذاكرة الأمّ.
      if (stderr.length > 8_192) stderr = stderr.slice(-8_192);
    });

    child.on('message', (raw) => {
      const message = /** @type {Record<string, unknown>} */ (raw);
      if (message['type'] === 'done') {
        result = /** @type {Record<string, unknown>} */ (message['result'] ?? {});
        cpuMs = typeof message['cpuMs'] === 'number' ? message['cpuMs'] : 0;
        return;
      }
      if (message['type'] === 'error') {
        failureCode =
          typeof message['code'] === 'string' ? message['code'] : LIMIT_ERRORS.HANDLER_FAILED;
        failureMessage =
          typeof message['message'] === 'string' ? message['message'] : 'فشل بلا رسالة';
        cpuMs = typeof message['cpuMs'] === 'number' ? message['cpuMs'] : 0;
      }
    });

    child.on('error', (error) => {
      failureCode ??= LIMIT_ERRORS.RUNNER_CRASHED;
      failureMessage ??= `تعذّر إقلاع عملية التنفيذ: ${error.message}`;
    });

    child.on('exit', (exitCode, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      request.signal?.removeEventListener('abort', onAbort);
      const durationMs = Date.now() - startedAt;

      /** @type {LimitedRun} */
      const base = {
        ok: false,
        result: null,
        code: null,
        message: null,
        durationMs,
        cpuMs,
        killed,
        exitCode,
        signal,
      };

      if (killReason === 'timeout') {
        resolve({
          ...base,
          code: LIMIT_ERRORS.TIMEOUT,
          message: `تجاوزت المهمة مهلتها (${timeoutMs}ms) فقُتلت عمليتها قسراً بعد ${durationMs}ms.`,
        });
        return;
      }
      if (killReason === 'cancel') {
        resolve({
          ...base,
          code: LIMIT_ERRORS.CANCELLED,
          message: 'أُلغيت المهمة قسراً وقُتلت عمليتها؛ لم تُنتظر موافقة المُعالِج.',
        });
        return;
      }
      if (failureCode !== null) {
        resolve({ ...base, code: failureCode, message: failureMessage });
        return;
      }
      if (result !== null && exitCode === 0) {
        resolve({ ...base, ok: true, result });
        return;
      }
      // موتٌ بلا رسالة: أغلب حالاته نفاد الكومة، وV8 يطبع «heap out of memory»
      // ويخرج برمزٍ غير صفري. فيُفرَّق بالنصّ المطبوع لا بالتخمين، وما لم يُعرف
      // يُعلن `TASK_RUNNER_CRASHED` صريحاً بدل أن يُنسب ظلماً إلى الذاكرة.
      const outOfMemory = /heap out of memory|heap limit|Allocation failed/i.test(stderr);
      resolve({
        ...base,
        code: outOfMemory ? LIMIT_ERRORS.MEMORY : LIMIT_ERRORS.RUNNER_CRASHED,
        message: outOfMemory
          ? `تجاوزت المهمة حدّ الذاكرة (${memoryLimitMb}MB لكومة V8) فمات المنفّذ.`
          : `مات منفّذ المهمة بلا نتيجة (رمز ${String(exitCode)}، إشارة ${String(signal)}): ${stderr.slice(-400) || 'بلا مخرج'}`,
      });
    });

    child.send({
      type: 'run',
      action: request.action,
      payload: request.payload ?? {},
      taskId: request.taskId ?? null,
    });
  });
}
