/**
 * بوابة تخصيص الميزانية — LIM-2
 *
 * العيب الذي تعالجه: الفعلُ `allocate-budget` كان مُعلَناً في كتالوج الأفعال
 * (`config/policies.yaml`) وحصّتُه `budget-allocated` مُعلَنةٌ في
 * `config/quotas.yaml` بـ`measure.kind: measured` و`measure.key: budgetUnits`،
 * **بلا مسارٍ واحدٍ يُنفّذه**. فالإعلان كان توثيقاً لا حاجزاً: تخصيصُ ميزانيةٍ في
 * الدولة لا يمرّ بقرارٍ ولا يُسجَّل ولا يُستهلِك حصّة.
 *
 * فالبوابةُ **المسارُ الوحيد** لتخصيص الميزانية: لا تملك الوحدات قناةً خاصة، بل
 * تُمرَّر طلباتُها هنا فتُقيَّس ثم تُقيَّم ثم تُسجَّل. والترتيب مقصود:
 *
 *   1. **المؤسسة** تُطابَق بصفٍّ قائمٍ أولاً: مؤسسةٌ غير مُؤسَّسةٍ تُرفض قبل أن
 *      يُقرأ المبلغ، فلا يصير الرفض نفسه قناةً تُعلن مبلغاً بلا صفٍّ.
 *   2. **المبلغ** يُقاس قبل التفويض: مبلغٌ فوق المتبقّي يُرفض بلا استهلاك حصّة.
 *   3. **التفويض** عبر نقطة التفويض وحدها (`allocate-budget` فعلٌ حسّاس)، فتسري
 *      عليه سياسة الحصّة الشهرية بوحدةِ قياسٍ مُعلَنةٍ (`budgetUnits`).
 *   4. **التذكرة تُستهلَك في لحظة القيد** (`verify`) لا قبله.
 *   5. **السجل يُكتب في الحالتين**: الرفض يُسجَّل كما يُسجَّل التخصيص.
 *
 * حدود معلنة:
 *   - البوابة لا تتحقّق من النوع المالي ولا من مصدر الميزانية؛ المصدر يأتي من
 *     المُنادي ويُحاسَب عليه في السياسة.
 *   - الحصّة الدائمة مسؤولية دفتر الحصص في نقطة التفويض.
 *   - البوابة لا تمنع وحدةً تستدعي `institutions.update` بنفسها؛ منعُ ذلك عزلٌ
 *     حقيقي وهو خارج النطاق.
 */

/** فعل تخصيص الميزانية كما هو معلَن في كتالوج الأفعال. */
export const BUDGET_ACTION = 'allocate-budget';

export const BUDGET_ERRORS = Object.freeze({
  DEPENDENCY_MISSING: 'BUDGET_DEPENDENCY_MISSING',
  INSTITUTION_UNKNOWN: 'BUDGET_INSTITUTION_UNKNOWN',
  AMOUNT_INVALID: 'BUDGET_AMOUNT_INVALID',
  NOT_AUTHORIZED: 'BUDGET_NOT_AUTHORIZED',
  TICKET_INVALID: 'BUDGET_TICKET_INVALID',
  ALLOCATION_FAILED: 'BUDGET_ALLOCATION_FAILED',
});

/** خطأ مُسمّى: البوابات والأتمتة تقرأ الرمز، والنص العربي للقارئ البشري. */
export class BudgetError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   * @param {Record<string, unknown>} [detail]
   */
  constructor(code, message, detail = {}) {
    super(message);
    this.name = 'BudgetError';
    /** @type {string} */
    this.code = code;
    /** @type {Record<string, unknown>} */
    this.detail = detail;
  }
}

/**
 * @typedef {object} BudgetRequest
 * @property {import('../policy/model.mjs').PolicyActor} actor
 * @property {string} institutionKey مفتاح المؤسسة التي تُخصَّص لها الميزانية.
 * @property {number} amount المبلغ المُخصَّص بوحدة القياس المُعلَنة.
 * @property {string} [purpose] الغرض المُعلَن للتخصيص؛ يُسجَّل مع كل قيد.
 * @property {Record<string, unknown>} [context] سياق إضافي يمرّ إلى السياسة.
 */

/**
 * @typedef {object} BudgetAllocation
 * @property {string} institutionKey
 * @property {number} amount
 * @property {string} purpose
 * @property {number} allocatedAt
 */

/**
 * بوابة تخصيص الميزانية — المسار الوحيد لتخصيص الميزانية لمؤسسة.
 *
 * تُنشأ بتبعياتٍ مُحقَنة: نقطة التفويض، السجل، ومُحدِّث صفّ المؤسسة.
 */
export class BudgetGate {
  /**
   * @param {{
   *   enforcementPoint?: import('../policy/enforcement-point.mjs').EnforcementPoint,
   *   log?: { append: (type: string, actor: string, payload: object) => unknown },
   *   institutions?: {
   *     list: (opts: { filter: { key: string }, limit: number }) => Promise<Readonly<Record<string, unknown>>[]>,
   *     update: (id: string, fields: Record<string, unknown>) => Promise<Readonly<Record<string, unknown>>>,
   *   },
   *   now?: () => Date,
   * }} [deps]
   */
  constructor(deps = {}) {
    const { enforcementPoint, log, institutions, now = () => new Date() } = deps;

    if (!enforcementPoint || !log || !institutions) {
      throw new BudgetError(
        BUDGET_ERRORS.DEPENDENCY_MISSING,
        'بوابة تخصيص الميزانية تَلزم نقطةَ تفويضٍ وسجلًّا ومُحدِّثَ مؤسسات.',
      );
    }

    this.enforcementPoint = enforcementPoint;
    this.log = log;
    this.institutions = institutions;
    this.now = now;
  }

  /**
   * يُخصِّص ميزانيةً لمؤسسةٍ قائمةٍ عبر نقطة التفويض.
   *
   * @param {BudgetRequest} request
   * @returns {Promise<BudgetAllocation>}
   */
  async allocate(request) {
    const { actor, institutionKey, amount, purpose = '', context = {} } = request;

    if (typeof amount !== 'number' || amount <= 0 || !Number.isFinite(amount)) {
      throw new BudgetError(
        BUDGET_ERRORS.AMOUNT_INVALID,
        `المبلغُ غيرُ صالح: ${String(amount)}؛ والتخصيصُ بلا مبلغٍ صالحٍ لا يمرّ.`,
        { institutionKey, amount },
      );
    }

    // المؤسسة تُطابَق بصفٍّ قائمٍ أولاً.
    const [institution] = await this.institutions.list({
      filter: { key: institutionKey },
      limit: 1,
    });

    if (institution === undefined) {
      throw new BudgetError(
        BUDGET_ERRORS.INSTITUTION_UNKNOWN,
        `المؤسسةُ ${institutionKey} غيرُ مُؤسَّسة؛ ولا يُخصَّص ميزانيةٌ لمن لا صفَّ له.`,
        { institutionKey },
      );
    }

    const resourceId = String(institution['id'] ?? institutionKey);
    const policyRequest = {
      actor,
      action: BUDGET_ACTION,
      resource: { type: 'institution', id: resourceId, classification: 'internal' },
      context: { ...context, institutionKey, amount },
    };

    // قناة القياس منفصلة عن السياق (R6-A-02): `budgetUnits` هنا هو المبلغُ الذي
    // يُخصَص، فيُخصم من `budget-allocated` بالوحدة المُعلَنة.
    const { decision, token } = await this.enforcementPoint.authorize(policyRequest, {
      measured: { budgetUnits: amount },
    });

    if (!decision.allowed) {
      this.log.append('institutions.budget.refused', actor.id, {
        institutionKey,
        amount,
        code: decision.code,
        reason: decision.reason,
      });
      throw new BudgetError(
        BUDGET_ERRORS.NOT_AUTHORIZED,
        `التفويض رفض التخصيص برمز ${decision.code}: ${decision.reason}`,
        { institutionKey, amount, code: decision.code },
      );
    }

    // التذكرة تُستهلَك هنا، بعد القرار وقبل القيد.
    try {
      this.enforcementPoint.verify(token ?? undefined, {
        actorId: actor.id,
        action: BUDGET_ACTION,
        resourceKey: `institution:${resourceId}`,
      });
    } catch (error) {
      this.log.append('institutions.budget.ticket_invalid', actor.id, {
        institutionKey,
        amount,
        error: error instanceof Error ? error.message : String(error),
      });
      throw new BudgetError(
        BUDGET_ERRORS.TICKET_INVALID,
        `تذكرة القرار غير مقبولة: ${error instanceof Error ? error.message : String(error)}`,
        { institutionKey, amount },
      );
    }

    // قيد الميزانية في صف المؤسسة.
    const currentAllocated = Number(institution['budgetAllocated'] ?? 0);
    const currentConsumed = Number(institution['budgetConsumed'] ?? 0);
    const newAllocated = currentAllocated + amount;

    try {
      await this.institutions.update(resourceId, {
        budgetAllocated: newAllocated,
        budgetDebitedAt: this.now().toISOString(),
      });
    } catch (error) {
      this.log.append('institutions.budget.allocation_failed', actor.id, {
        institutionKey,
        amount,
        error: error instanceof Error ? error.message : String(error),
      });
      throw new BudgetError(
        BUDGET_ERRORS.ALLOCATION_FAILED,
        `فشل قيد الميزانية: ${error instanceof Error ? error.message : String(error)}`,
        { institutionKey, amount },
      );
    }

    const allocation = {
      institutionKey,
      amount,
      purpose,
      allocatedAt: this.now().getTime(),
    };

    this.log.append('institutions.budget.allocated', actor.id, {
      institutionKey,
      amount,
      purpose,
      newAllocated,
      remaining: newAllocated - currentConsumed,
      resource: 'budget-allocated',
    });

    return allocation;
  }
}

/**
 * @param {{
 *   enforcementPoint: import('../policy/enforcement-point.mjs').EnforcementPoint,
 *   log: { append: (type: string, actor: string, payload: object) => unknown },
 *   institutions: {
 *     list: (opts: { filter: { key: string }, limit: number }) => Promise<Readonly<Record<string, unknown>>[]>,
 *     update: (id: string, fields: Record<string, unknown>) => Promise<Readonly<Record<string, unknown>>>,
 *   },
 *   now?: () => Date,
 * }} deps
 * @returns {BudgetGate}
 */
export function createBudgetGate(deps) {
  return new BudgetGate(deps);
}
