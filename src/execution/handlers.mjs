/**
 * سجل مُعالِجات المهام — المسار `M5`.
 *
 * المهمة في الطابور تحمل `action` نصّاً، والعامل يحتاج أن يعرف **من يُنفّذها**.
 * والطريق الساذج أن يُمرَّر المُعالِج دالةً من الذاكرة، وذلك يمنع تنفيذ المهمة في
 * عملية منفصلة (لا تُنقل الدوال بين العمليات). فالسجل هنا يربط الاسم بمسار وحدة
 * قابلة للاستيراد، فيستوردها الابن بنفسه من اسمها.
 *
 * حدٌّ معلن: السجل ثابتٌ في الكود لا مقروءٌ من مُدخل خارجي. تحميلُ وحدةٍ باسمٍ
 * يأتي من صفٍّ في القاعدة يعني أن من يكتب صفّاً ينفّذ كوداً، وهذا ثقبٌ لا حدّ.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** رموز أخطاء السجل. */
export const HANDLER_ERRORS = Object.freeze({
  UNKNOWN_ACTION: 'TASK_ACTION_UNKNOWN',
  HANDLER_SHAPE_INVALID: 'TASK_HANDLER_SHAPE_INVALID',
});

/** خطأ سجل مُعالِجات يحمل رمزاً مقروءاً آلياً. */
export class HandlerError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   */
  constructor(code, message) {
    super(message);
    this.name = 'HandlerError';
    /** @type {string} */
    this.code = code;
  }
}

/**
 * الأفعال المعروفة ومسار وحدة كلٍّ منها. أفعال `اختبار.*` مقصودة للاختبار وحده
 * وتُعلن كذلك صراحةً: إخفاؤها بأسماء تبدو إنتاجية يخلط المُنفَّذ بالمُختبَر.
 * @type {Readonly<Record<string, string>>}
 */
export const HANDLER_REGISTRY = Object.freeze({
  'اختبار.نجاح': path.join(HERE, 'handlers/test-success.mjs'),
  'اختبار.فشل': path.join(HERE, 'handlers/test-failure.mjs'),
  'اختبار.تجمّد': path.join(HERE, 'handlers/test-hang.mjs'),
  'اختبار.نهم-ذاكرة': path.join(HERE, 'handlers/test-memory-hog.mjs'),
});

/**
 * @param {string} action
 * @returns {string} مسار وحدة المُعالِج
 */
export function resolveHandlerPath(action) {
  const modulePath = HANDLER_REGISTRY[action];
  if (modulePath === undefined) {
    throw new HandlerError(
      HANDLER_ERRORS.UNKNOWN_ACTION,
      `فعلٌ لا مُعالِج له في السجل: ${action}. الأفعال المعلنة: ${Object.keys(HANDLER_REGISTRY).join('، ')}.`,
    );
  }
  return modulePath;
}

/**
 * يستورد المُعالِج ويتحقّق من شكله قبل تشغيله.
 * @param {string} action
 * @returns {Promise<(payload: Record<string, unknown>) => Promise<Record<string, unknown>>>}
 */
export async function loadHandler(action) {
  const modulePath = resolveHandlerPath(action);
  const loaded = /** @type {{ default?: unknown }} */ (await import(modulePath));
  const handler = loaded.default;
  if (typeof handler !== 'function') {
    throw new HandlerError(
      HANDLER_ERRORS.HANDLER_SHAPE_INVALID,
      `مُعالِج الفعل ${action} لا يُصدّر دالة افتراضية.`,
    );
  }
  return /** @type {(payload: Record<string, unknown>) => Promise<Record<string, unknown>>} */ (
    handler
  );
}
