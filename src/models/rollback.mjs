/**
 * تراجع النموذج بأمر واحد — M6.08.
 *
 * الخطر الذي يعالجه: عند اكتشاف نموذجٍ ناشط معيب كان المشغّل يحتاج تذكّر النسخة
 * السابقة وتعطيل الحالية ثم تنشيط السابقة يدوياً. هذا يطيل نافذة الضرر، ويجعل
 * سهو خطوة واحدة يترك الغرض بلا نموذج أو يعيد نموذجاً مرجعاً عنه.
 *
 * يختار هذا المسار آخر نموذج معتمد غير ناشط للغرض، ويتحقق من قابليته للتفعيل قبل
 * إرجاع الحالي عنه نهائياً. النموذج المرجع عنه لا يعود أبداً لأن `transition`
 * نفسها تحرس `ROLLED_BACK_MODEL_IMMUTABLE`.
 *
 * حدود معلنة: إن تبدّلت أوزان السابق بين فحصه وتنشيطه، يفشل التراجع مغلقاً وقد
 * يبقى الغرض بلا ناشط؛ لا يُبقي النظام نموذجاً مشتبهاً به خدمةً للاستمرارية.
 */

import { performance } from 'node:perf_hooks';

export const MODEL_ROLLBACK_ERRORS = Object.freeze({
  DEPENDENCY_MISSING: 'MODEL_ROLLBACK_DEPENDENCY_MISSING',
  PURPOSE_REQUIRED: 'MODEL_ROLLBACK_PURPOSE_REQUIRED',
  REASON_REQUIRED: 'MODEL_ROLLBACK_REASON_REQUIRED',
  ACTIVE_MISSING: 'MODEL_ROLLBACK_ACTIVE_MISSING',
  PREVIOUS_MISSING: 'MODEL_ROLLBACK_PREVIOUS_MISSING',
});

/** خطأ مُسمّى: التراجع قرار سلامة لا استثناءً غامضاً. */
export class ModelRollbackError extends Error {
  /** @param {string} code @param {string} message */
  constructor(code, message) {
    super(message);
    this.name = 'ModelRollbackError';
    /** @type {string} */
    this.code = code;
  }
}

/** @param {Date} value @returns {number} */
function timeOf(value) {
  return value.getTime();
}

/**
 * يعيد النموذج المعتمد السابق نشطاً ويجعل الحالي مرجعاً عنه نهائياً.
 * @param {{ registry?: import('./model-registry.mjs').ModelRegistry, purpose: string, reason: string, actor?: string, now?: () => number }} input
 * @returns {Promise<{ purpose: string, reason: string, rolledBackId: string, restoredId: string, durationMs: number }>}
 */
export async function rollbackModel({
  registry,
  purpose,
  reason,
  actor = 'crown',
  now = () => performance.now(),
}) {
  if (!registry) {
    throw new ModelRollbackError(
      MODEL_ROLLBACK_ERRORS.DEPENDENCY_MISSING,
      'التراجع يحتاج سجل النماذج؛ مسار بلا سجل لا يعرف ما هو الناشط أو السابق.',
    );
  }
  if (typeof purpose !== 'string' || purpose.trim() === '') {
    throw new ModelRollbackError(
      MODEL_ROLLBACK_ERRORS.PURPOSE_REQUIRED,
      'التراجع يحتاج غرض النموذج؛ غرض فارغ قد يعيد نموذج نطاق آخر.',
    );
  }
  if (typeof reason !== 'string' || reason.trim() === '') {
    throw new ModelRollbackError(
      MODEL_ROLLBACK_ERRORS.REASON_REQUIRED,
      'التراجع بلا سبب مسجّل مرفوض؛ القرار لا يُراجع إن غاب سببه.',
    );
  }
  const startedAt = now();
  const active = await registry.getActive(purpose);
  if (active === null) {
    registry.log.append('model.rollback-refused', actor, {
      purpose,
      reason,
      code: MODEL_ROLLBACK_ERRORS.ACTIVE_MISSING,
    });
    throw new ModelRollbackError(
      MODEL_ROLLBACK_ERRORS.ACTIVE_MISSING,
      `لا نموذج ناشط للغرض «${purpose}» كي يُرجع عنه.`,
    );
  }
  const candidates = (await registry.listByPurpose(purpose))
    .filter((model) => model.id !== active.id && model.state === 'approved' && !model.isActive)
    .sort((left, right) => timeOf(right.updatedAt) - timeOf(left.updatedAt));
  const previous = candidates[0];
  if (previous === undefined) {
    registry.log.append('model.rollback-refused', actor, {
      purpose,
      reason,
      activeId: active.id,
      code: MODEL_ROLLBACK_ERRORS.PREVIOUS_MISSING,
    });
    throw new ModelRollbackError(
      MODEL_ROLLBACK_ERRORS.PREVIOUS_MISSING,
      `لا نسخة معتمدة سابقة للغرض «${purpose}»؛ لا يُخترع بديل عند التراجع.`,
    );
  }

  try {
    // التحقق قبل إرجاع الحالي: تقييم أو بصمة السابق الفاشلان لا يبرران إيقاف
    // النموذج القائم. يستدعي activate لاحقاً الفحوص نفسها لحظة الكتابة.
    await registry.assertActivatable(previous.id);
    await registry.transition(active.id, 'rolled-back', reason);
    await registry.activate(previous.id);
  } catch (error) {
    registry.log.append('model.rollback-failed', actor, {
      purpose,
      reason,
      activeId: active.id,
      previousId: previous.id,
      code:
        /** @type {{ code?: string }} */ (error).code ??
        (error instanceof Error ? error.message : 'MODEL_ROLLBACK_FAILED'),
    });
    throw error;
  }
  const durationMs = now() - startedAt;
  const result = { purpose, reason, rolledBackId: active.id, restoredId: previous.id, durationMs };
  registry.log.append('model.rolled-back', actor, result);
  return result;
}
