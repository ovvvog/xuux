/**
 * بوابة الميزانية للتنفيذ — الخطوة `M5.06`.
 *
 * تربط مهام الطابور بدفتر الحصص الذرّي (`M4.07`). والقاعدة التي تحرسها:
 * **نفاد الميزانية يوقف المهمة قبل أن تبدأ**، لا بعد أن تُستهلك الموارد. لأن
 * حسماً بعد التنفيذ ليس ميزانيةً بل فاتورةً: المال أُنفق والحدّ أُعلن متأخّراً.
 *
 * ولذلك الترتيب هنا مقصود: يُخصم من الدفتر **أوّلاً** (والخصم ذرّي في القاعدة
 * ويرفض التجاوز بقيدٍ لا بعدٍّ)، ثم يُشغَّل المُعالِج. فمن رفضه الدفتر لم يُشغَّل.
 *
 * ## الحدود المعلنة
 *
 * 1. **الخصم مُسبَق ولا يُردّ عند الفشل.** مهمةٌ خُصمت ثم فشلت لا يُعاد إليها
 *    رصيدها في هذه الخطوة: الردّ يحتاج قراراً عن العدل (هل تُحاسب المحاولة أم
 *    النتيجة؟) وهو قرار مالك لا مُنفِّذ (المادة 10). فالسلوك الحالي: **المحاولة
 *    تُحاسَب**، وهو صريح لا مستور.
 * 2. الخصم يُقيَّد بمفتاح عدم التكرار حتى لا تُحاسَب إعادةُ المحاولة مرّتين على
 *    نفس الحجز: تُسجَّل الحجوزات المخصومة في `state.tasks.budget_debited_at`.
 * 3. الدفتر يعرف المورد ونوع الصاحب من ملف السياسة؛ مهمةٌ تطلب مورداً غير معلن
 *    تُرفض برمزه ولا «تمرّ لأن حدّها مجهول».
 */

import { QUOTA_ERRORS, QuotaError } from '../policy/quota.mjs';

/** رموز بوابة الميزانية. */
export const BUDGET_ERRORS = Object.freeze({
  DEPENDENCY_MISSING: 'BUDGET_DEPENDENCY_MISSING',
  EXHAUSTED: 'TASK_BUDGET_EXHAUSTED',
  RESOURCE_UNDECLARED: 'TASK_BUDGET_RESOURCE_UNDECLARED',
});

/** خطأ ميزانية يحمل رمزاً مقروءاً آلياً. */
export class BudgetError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   * @param {{ cause?: unknown, resource?: string }} [context]
   */
  constructor(code, message, context = {}) {
    super(message, context.cause === undefined ? undefined : { cause: context.cause });
    this.name = 'BudgetError';
    /** @type {string} */
    this.code = code;
    /** @type {string | undefined} */
    this.resource = context.resource;
  }
}

/**
 * نتيجة فحص الميزانية: `allowed` تفصل السماح عن المنع، و`reading` تحمل الرصيد
 * بعد الخصم إن جرى خصمٌ فعلاً (وإلا `null` كي لا يُقرأ رقمٌ قديم نتيجةً).
 * @typedef {object} BudgetDecision
 * @property {boolean} allowed
 * @property {string | null} code
 * @property {string | null} message
 * @property {{ resource: string, consumed: number, limit: number, remaining: number } | null} reading
 * @property {boolean} debited هل خُصم في هذا النداء؟ (لا يُخصم مرّتين لنفس الحجز)
 */

/**
 * @param {object} dependencies
 * @param {import('pg').Pool} dependencies.pool
 * @param {{ debit: Function, read: Function }} dependencies.ledger دفتر الحصص من `M4.07`.
 * @param {() => Date} [dependencies.now]
 */
export function createBudgetGate({ pool, ledger, now = () => new Date() }) {
  if (pool === undefined || ledger === undefined) {
    throw new BudgetError(
      BUDGET_ERRORS.DEPENDENCY_MISSING,
      'بوابة الميزانية تحتاج مجمّع قاعدة ودفتر حصص؛ بوابةٌ بلا دفتر تسمح بكل شيء وهي أخطر من غيابها.',
    );
  }

  return Object.freeze({
    /**
     * يُحاسب المهمة **قبل** تشغيلها. يُعيد قراراً لا يرمي عند النفاد: النفاد
     * حالةٌ متوقّعة يُسجّلها العامل في المهمة، لا عطبٌ في النظام.
     * @param {{ id: string, actorId: string, budgetResource: string | null, budgetAmount: number }} task
     * @param {{ subjectType?: string }} [options]
     * @returns {Promise<BudgetDecision>}
     */
    async chargeBeforeStart(task, options = {}) {
      const resource = task.budgetResource;
      // مهمة بلا مورد معلن لا ميزانية عليها؛ وهذا صريح لا استثناء خفيّ: من أراد
      // محاسبتها فليُعلن موردها عند الإدخال.
      if (resource === null || resource === '' || task.budgetAmount <= 0) {
        return { allowed: true, code: null, message: null, reading: null, debited: false };
      }

      // خصمٌ مرّة واحدة لكل مهمة: إعادة المحاولة بعد فشلٍ لا تُحاسَب ثانياً.
      const marked = await pool.query(
        `UPDATE state.tasks SET budget_debited_at = $2
          WHERE id = $1 AND budget_debited_at IS NULL
          RETURNING id`,
        [task.id, now()],
      );
      if (marked.rows.length === 0) {
        const reading = await ledger.read({
          subjectType: options.subjectType ?? 'agent',
          subjectId: task.actorId,
          resource,
        });
        return {
          allowed: true,
          code: null,
          message: null,
          reading: reading ?? null,
          debited: false,
        };
      }

      try {
        const reading = await ledger.debit({
          subjectType: options.subjectType ?? 'agent',
          subjectId: task.actorId,
          resource,
          amount: task.budgetAmount,
        });
        return { allowed: true, code: null, message: null, reading, debited: true };
      } catch (error) {
        // الرفض يُرجع علامة الخصم كي لا تُحسب المهمة مخصومة وهي لم تُخصم: علامةٌ
        // كاذبة تجعل إعادة المحاولة تمرّ بلا محاسبة، وذلك تسريبٌ للحدّ.
        await pool.query(`UPDATE state.tasks SET budget_debited_at = NULL WHERE id = $1`, [
          task.id,
        ]);

        if (error instanceof QuotaError && error.code === QUOTA_ERRORS.EXCEEDED) {
          return {
            allowed: false,
            code: BUDGET_ERRORS.EXHAUSTED,
            message: `نفدت ميزانية المورد «${resource}» للفاعل ${task.actorId}؛ أُوقفت المهمة قبل تشغيلها.`,
            reading: null,
            debited: false,
          };
        }
        if (error instanceof QuotaError && error.code === QUOTA_ERRORS.RESOURCE_UNDECLARED) {
          return {
            allowed: false,
            code: BUDGET_ERRORS.RESOURCE_UNDECLARED,
            message: `المورد «${resource}» غير معلن في ملف السياسة؛ لا يُشغَّل ما لا حدّ له.`,
            reading: null,
            debited: false,
          };
        }
        throw new BudgetError(
          BUDGET_ERRORS.DEPENDENCY_MISSING,
          `تعذّر الخصم من دفتر الحصص للمورد ${resource}.`,
          { cause: error, resource },
        );
      }
    },
  });
}
