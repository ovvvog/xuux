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
 * 4. **علامةُ المهمة ودفترُ الحصص في معاملةٍ واحدة** (`withTransaction`): وضعُ
 *    العلامةِ على المهمّةِ والخصمُ من الدفترِ يلتزمانِ أو يتراجعانِ معاً. لا حالةَ
 *    وسيطةَ تُحاسَبُ المهمّةُ فيها مخصومةً والدفترُ لم يتحرّك، ولا خصمٌ يُثبَتُ
 *    بلا علامة. هذه هي ذرّيةُ الميزانيةِ (`LIVE-45` ج): خاصيةٌ من التصميمِ لا
 *    اتفاقٌ بين دوالٍّ منفصلة.
 *
 * `BudgetOutcomeUnknown` خطأٌ مسمّى يرميه مُنفِّذُ هذه البوابة عند تعذُّرِ إثبات
 * نتيجةِ الخصم (انقطاعُ اتصالٍ بعد التزامِ المعاملة). لا يحملُ ميزانيةً ولا
 * يُعالِجُه العاملُ بنفسه؛ يرميه للطرفِ الذي يستدعي هذه البوابة (العامل)
 * ليتفرّع مسارُه إلى الاستردادِ الآمن (`WorkerDatabaseFault`). إعادةُ المحاولةِ
 * الكبرى تُقصَرُ على القرارِ الحتميّ الذي يثبتُ نتيجةً معروفة: لا يُعادُ خصمٌ
 * مجهول، ولا يُخصَمُ مرّةً ثانيةً لنتيجةٍ قد تكونُ وقعت.
 */

import { QUOTA_ERRORS, QuotaError } from '../policy/quota.mjs';
import { withTransaction } from '../persistence/db.mjs';
import { BudgetOutcomeUnknown } from './budget-errors.mjs';

// `classifyDatabaseFault` يُستوردُ ديناميكياً في `worker.mjs` لا هنا: هذا الملفُ لا
// يصنّفُ الأخطاءَ بنفسه، بل يُسلّمُ السببَ الأصليَّ ليتفرّعَ مسارُ العطلِ الآمنُ بلا
// دورةِ استيرادٍ بين `budget.mjs` و`db-recovery.mjs`.

/** رموز بوابة الميزانية. */
export const BUDGET_ERRORS = Object.freeze({
  DEPENDENCY_MISSING: 'BUDGET_DEPENDENCY_MISSING',
  EXHAUSTED: 'TASK_BUDGET_EXHAUSTED',
  RESOURCE_UNDECLARED: 'TASK_BUDGET_RESOURCE_UNDECLARED',
  /** خطأُ تصفيرِ العلامة: لا يُخفي سببَه الأصليَّ عن العامل. */
  MARK_RELEASE_FAILED: 'BUDGET_MARK_RELEASE_FAILED',
});

/**
 * خطأ ميزانية يحمل رمزاً مقروءاً آلياً.
 */
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
 * خطأٌ يرميه هذا المُنفِّذ عند تعذُّرِ إثباتِ نتيجةِ الخصم — تعريفُه في
 * `budget-errors.mjs` كي لا تُنتِجَ دورةَ استيرادٍ بينهما. خطأٌ مُسمّى
 * لا `BudgetError` ولا `QuotaError` ولا `QueueError`: يُميَّز ليصلَ إلى مُصنِّفِ
 * عطبِ قاعدةِ البياناتِ (`classifyDatabaseFault`) بلا غلافٍ يُخفيه.
 */
export { BudgetOutcomeUnknown };

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
 * يُصفّر علامةَ الخصمَ في المهمّة إن كان السببُ معروفاً. هذا الاستعلامُ يُحفظُ
 * أثرَه: من يُقرأُ العلامةَ بعد فشلِ تصفيرِها يرى علامةً قائمةً لا تُدلّي على
 * خصمٍ وقعَ فعلًا — ولا مسارَ صحيحاً يُغادرُ بوابةَ الميزانيةِ بلا إثباتِه.
 * @param {import('pg').Pool} pool
 * @param {string} taskId
 */
async function releaseMarkedFlag(pool, taskId) {
  await pool.query(`UPDATE state.tasks SET budget_debited_at = NULL WHERE id = $1`, [taskId]);
}

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

      const subjectType = options.subjectType ?? 'agent';
      const subjectId = task.actorId;
      const markedAt = now();

      try {
        // الحلُّ الجذريُّ للذرّية (`LIVE-45` ج): علامةُ المهمّةِ وخصمُ الدفترِ
        // في معاملةٍ واحدة. إمّا أن يُلتزما معاً أو يتراجعا معاً، فلا حالةَ
        // وسيطة. خصمٌ ملتزمٌ لا علامةَ عليه مستحيل، وعلامةٌ بلا خصمٍ مستحيلة:
        // فالنتيجةُ حتميّةٌ من التصميمِ لا من اتفاقِ دوالٍّ منفصلة.
        //
        // `client` المحجوزُ داخل `withTransaction` يُمرَّرُ إلى `ledger.debit`
        // كي يستعملَ اتصالَ المعاملةِ نفسَه: الخصمُ والعلامةُ يُلتزمانِ عند
        // `COMMIT` حصراً، فلا انقطاعٌ بينهما يُنتجُ خصماً بلا علامةٍ أو علامةً بلا خصم.
        const outcome = await withTransaction(pool, async (client) => {
          // خصمٌ مرّةً واحدة لكل مهمة: إعادة المحاولة بعد فشلٍ لا تُحاسَب ثانياً.
          const marked = await client.query(
            `UPDATE state.tasks SET budget_debited_at = $2
              WHERE id = $1 AND budget_debited_at IS NULL
              RETURNING id`,
            [task.id, markedAt],
          );
          if (marked.rows.length === 0) return { alreadyMarked: true, reading: null };
          const current = await ledger.debit({
            subjectType,
            subjectId,
            resource,
            amount: task.budgetAmount,
            client,
          });
          return { alreadyMarked: false, reading: current };
        });
        if (outcome.alreadyMarked) {
          const currentReading = await ledger.read({ subjectType, subjectId, resource });
          return {
            allowed: true,
            code: null,
            message: null,
            reading: currentReading ?? null,
            debited: false,
          };
        }
        return {
          allowed: true,
          code: null,
          message: null,
          reading: outcome.reading,
          debited: true,
        };
      } catch (error) {
        // الرفض يُرجع علامة الخصم كي لا تُحسب المهمة مخصومة وهي لم تُخصم: علامةٌ
        // كاذبة تجعل إعادة المحاولة تمرّ بلا محاسبة، وذلك تسريبٌ للحدّ.
        if (error instanceof QuotaError && error.code === QUOTA_ERRORS.EXCEEDED) {
          try {
            await releaseMarkedFlag(pool, task.id);
          } catch {
            throw new BudgetError(
              BUDGET_ERRORS.MARK_RELEASE_FAILED,
              `تعذّرَ تصفيرُ علامةِ الخصمِ للمهمّةِ ${task.id} بعدَ رفضِ الميزانية؛ العلامةُ تبقى ` +
                `قائمةً حتى يُفحصَ الدفترُ أو يُحكمَ مخوَّل. السببُ الأصليُّ مرفق.`,
              { cause: error, resource },
            );
          }
          return {
            allowed: false,
            code: BUDGET_ERRORS.EXHAUSTED,
            message: `نفدت ميزانية المورد «${resource}» للفاعل ${task.actorId}؛ أُوقفت المهمة قبل تشغيلها.`,
            reading: null,
            debited: false,
          };
        }
        if (error instanceof QuotaError && error.code === QUOTA_ERRORS.RESOURCE_UNDECLARED) {
          try {
            await releaseMarkedFlag(pool, task.id);
          } catch {
            throw new BudgetError(
              BUDGET_ERRORS.MARK_RELEASE_FAILED,
              `تعذّرَ تصفيرُ علامةِ الخصمِ للمهمّةِ ${task.id} بعدَ رفضِ الميزانية؛ العلامةُ تبقى ` +
                `قائمةً حتى يُفحصَ الدفترُ أو يُحكمَ مخوَّل. السببُ الأصليُّ مرفق.`,
              { cause: error, resource },
            );
          }
          return {
            allowed: false,
            code: BUDGET_ERRORS.RESOURCE_UNDECLARED,
            message: `المورد «${resource}» غير معلن في ملف السياسة؛ لا يُشغَّل ما لا حدّ له.`,
            reading: null,
            debited: false,
          };
        }

        // خطأٌ غيرُ `QuotaError`: لا يُصنّفُ هذا الملفُ الأخطاءَ بنفسه (دورةُ استيرادٍ
        // مع `db-recovery.mjs`)، بل يُرمى `BudgetOutcomeUnknown` مُرتّقاً السببَ
        // الأصليَّ (`cause`) كي يصلَ إلى `classifyDatabaseFault` في `worker.mjs`
        // بلا غلافٍ يُخفيه. إن كانَ السببُ عطلَ قاعدةٍ مُصنَّفاً فذلك هو مسارُ
        // الاستردادِ الآمن؛ وإلا فالرميُّ كما هو ليوقفَ العاملَ عند حدٍّ آمنٍ
        // لا أن يفترضَ خصماً لم يُثبَت. لا يُصفّرُ علامةَ عدمِ التكرارِ في
        // نتيجةٍ مجهولة: دليلُ الخصمِ إن وقعَ لا يُمحى.
        throw new BudgetOutcomeUnknown(resource, error, task.id, subjectId, subjectType, markedAt);
      }
    },
  });
}
