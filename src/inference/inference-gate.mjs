/**
 * بوابة الاستدلال — M6.07
 *
 * العيب الذي تعالجه: الاستدلال كان سيقبل معرّف النموذج من المنادي ويشغّله بلا
 * توجيهٍ من السجل، ولا حدّ معدل أو ميزانية أو أثرٍ آمن للمُدخل والمُخرج. فيصبح
 * النموذج غير النشط طريقاً خفياً، ويصير السجل نفسه موضع تسريب للمصنّف الحساس.
 *
 * هذه البوابة هي المسار الوحيد: تختار النموذج النشط لغرضٍ معلن، تفحص الحجر
 * والمعدل وميزانية الإدخال ومرشح السلامة، ثم تفوّض وتتحقق من تذكرتها في لحظة
 * النداء، وبعد التنفيذ تحاسب الاستهلاك الفعلي وتفحص المُخرج قبل إعادته.
 *
 * ترتيب الفحوص مقصود: الحجر أولاً، ثم التوجيه الصريح، ثم حدّ المعدل، ثم ما
 * يمنع التنفيذ (الميزانية والمرشح)، ثم التفويض. فلا يُصدر طلبٌ إلى النموذج عند
 * غياب نموذج نشط أو تجاوز سقف معروف، ولا تُستهلك تذكرة قبل لحظة النداء.
 *
 * حدود معلنة:
 *   - **سقفُ الرموزِ ونافذتُه من `config/quotas.yaml` وحدَها** (المورد
 *     `inference-tokens`) عبر `loadInferenceTokenQuota`، ولا رقمَ سقفٍ في هذا
 *     الملفِّ ولا سقوطَ صامتاً إلى رقمٍ مكتوبٍ عندَ غيابِ الحصّةِ. ونافذةُ
 *     الميزانيةِ **مستقلّةٌ** عن نافذةِ حدِّ المعدَّلِ (`windowMs`): الأولى من
 *     الوثيقةِ والثانيةُ حدُّ نداءاتٍ لا حدُّ كلفةٍ.
 *   - **دفترُ الميزانيةِ مُلزَمٌ ودائمٌ على قرصٍ** (‏`LIM-1`، `WL-197`): كان
 *     العدّادُ في الذاكرةِ وحدَها، فمن استنفدَ سقفَه استأنفَ الإنفاقَ بإعادةِ
 *     التشغيلِ. وصارَ المخزنُ إلزاميّاً: لا تُبنى بوابةٌ بلا `budgetStore`، ولا
 *     يُفترَضُ صفرٌ عندَ غيابِه. والاستعادةُ **لا تُخفِّضُ**: الأعلى من المُقاسِ
 *     والمُستعادِ هو المُلزِمُ، ونافذةٌ انقضتْ تُهمَلُ فلا يُمَدُّ عمرُها بلقطةٍ.
 *   - **الاستهلاكُ يُقيَّدُ في دفترِ التكلفةِ إلزاماً** (‏`LIM-1`، `WL-197`): كان
 *     تمريرُ الدفترِ خيارَ تركيبٍ، فبوابةٌ بلا دفترٍ تُنفِقُ بلا أثرٍ. وصارَ الدفترُ
 *     إلزاميّاً: لا تُبنى بوابةٌ بلا `costLedger`، وفشلُ القيدِ **يمنعُ إعادةَ
 *     المُخرَجِ** (`INFERENCE_USAGE_UNRECORDED`).
 *   - تقدير الإدخال يمنع طلباً يتجاوز السقف قبل التشغيل؛ لا يمكن معرفة طول
 *     المُخرج قبل تشغيل النموذج، لذلك يُحاسب الاستهلاك الفعلي بعده ويُحجب
 *     المُخرج إن جعل الاستهلاك السقف متجاوزاً.
 *   - قواعد السلامة بيانات معلنة في `DEFAULT_SAFETY_RULES` ويمكن تمرير نسخة
 *     أشد؛ المطابقة اللفظية ليست بديلاً عن مصنف سلامة متخصص أو عزل التنفيذ.
 */

import { createHash } from 'node:crypto';
import { loadClassificationLattice } from '../data/classification.mjs';
import { inferenceCostItem, loadInferenceTokenQuota } from './quota.mjs';

const DEFAULT_WINDOW_MS = 60_000;
const DEFAULT_CALLS_PER_WINDOW = 30;
const DEFAULT_COST_PER_WINDOW = 100;
const DEFAULT_LOG_TEXT_CHARS = 512;

/** فعل الاستدلال المعلَن في كتالوج السياسات. */
export const INFERENCE_ACTION = 'model-inference';

export const INFERENCE_ERRORS = Object.freeze({
  DEPENDENCY_MISSING: 'INFERENCE_DEPENDENCY_MISSING',
  PURPOSE_REQUIRED: 'INFERENCE_PURPOSE_REQUIRED',
  INPUT_INVALID: 'INFERENCE_INPUT_INVALID',
  ACTIVE_MODEL_MISSING: 'INFERENCE_ACTIVE_MODEL_MISSING',
  MODEL_REGISTRY_FAILED: 'INFERENCE_MODEL_REGISTRY_FAILED',
  QUARANTINED: 'INFERENCE_ACTOR_QUARANTINED',
  RATE_LIMIT_EXCEEDED: 'INFERENCE_RATE_LIMIT_EXCEEDED',
  BUDGET_EXCEEDED: 'INFERENCE_BUDGET_EXCEEDED',
  INPUT_BLOCKED: 'INFERENCE_INPUT_BLOCKED',
  NOT_AUTHORIZED: 'INFERENCE_NOT_AUTHORIZED',
  TICKET_INVALID: 'INFERENCE_TICKET_INVALID',
  EXECUTION_FAILED: 'INFERENCE_EXECUTION_FAILED',
  OUTPUT_INVALID: 'INFERENCE_OUTPUT_INVALID',
  OUTPUT_BLOCKED: 'INFERENCE_OUTPUT_BLOCKED',
  USAGE_UNRECORDED: 'INFERENCE_USAGE_UNRECORDED',
  BUDGET_UNREADABLE: 'INFERENCE_BUDGET_UNREADABLE',
  BUDGET_UNPERSISTED: 'INFERENCE_BUDGET_UNPERSISTED',
});

/** خطأ مسمى: الرمز للبرامج والرسالة العربية لقرار الرفض المقروء. */
export class InferenceError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   * @param {Record<string, unknown>} [detail]
   */
  constructor(code, message, detail = {}) {
    super(message);
    this.name = 'InferenceError';
    /** @type {string} */
    this.code = code;
    /** @type {Record<string, unknown>} */
    this.detail = detail;
  }
}

/**
 * قواعد السلامة بيانات لا شروط مبثوثة في مسار الاستدلال. كل قاعدة تحدد الموضع
 * والعبارات التي تمنعها وسبباً يسجل مع الرفض.
 * @type {readonly Readonly<{ id: string, target: 'input' | 'output', terms: readonly string[], reason: string }>[]}
 */
export const DEFAULT_SAFETY_RULES = Object.freeze([
  Object.freeze({
    id: 'input-prompt-injection',
    target: 'input',
    terms: Object.freeze(['ignore previous instructions', 'reveal system prompt']),
    reason: 'المُدخل يحاول تجاوز تعليمات النظام أو طلب محتواها المحمي.',
  }),
  Object.freeze({
    id: 'output-private-key',
    target: 'output',
    terms: Object.freeze(['begin private key', 'ssh-rsa']),
    reason: 'المُخرج يتضمن مادة اعتماد خاصة لا يجوز إعادتها.',
  }),
]);

/**
 * @typedef {object} InferenceUsage
 * @property {number} [inputTokens]
 * @property {number} [outputTokens]
 * @property {number} [totalTokens]
 * @property {number} [cost]
 */

/**
 * @typedef {object} InferenceExecution
 * @property {string} output
 * @property {InferenceUsage} [usage]
 */

/**
 * @typedef {object} InferenceRequest
 * @property {import('../policy/model.mjs').PolicyActor} actor
 * @property {string} purpose الغرض فقط؛ النموذج يختاره السجل ولا يقبله الطلب.
 * @property {string} input
 * @property {string} [inputClassification] مرتبة من سلّم `config/classification.yaml`؛ المجهول يُعامل معاملة المحجوب
 * @property {string} [outputClassification]
 * @property {number} [estimatedInputTokens]
 * @property {number} [estimatedInputCost]
 * @property {string} [resourceId]
 * @property {Record<string, unknown>} [context]
 */

/**
 * @param {string} text
 * @returns {number}
 */
function estimateTokens(text) {
  return Math.max(1, Math.ceil(Buffer.byteLength(text, 'utf8') / 4));
}

/**
 * @param {unknown} value
 * @param {number} fallback
 * @returns {number}
 */
function nonNegativeNumber(value, fallback) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback;
}

export class InferenceGate {
  /**
   * @param {{ modelRegistry?: { getActive: (purpose: string) => Promise<{ id: string, purpose: string } | null> }, enforcementPoint?: import('../policy/enforcement-point.mjs').EnforcementPoint, log?: { append: (type: string, actor: string, payload: object) => unknown }, execute?: (request: { model: { id: string, purpose: string }, purpose: string, input: string }) => Promise<InferenceExecution>, quarantine?: { isQuarantined?: (subject: string) => boolean, report?: (signal: { kind: string, subject: string, detail?: Record<string, unknown> }) => unknown } | null, safetyRules?: readonly { id: string, target: 'input' | 'output', terms: readonly string[], reason: string }[], callsPerWindow?: number, windowMs?: number, tokensPerWindow?: number, budgetWindowMs?: number, budgetStore?: { load: () => unknown, save: (entries: Array<{ actorId: string, startedAt: number, tokens: number, cost: number }>) => unknown }, quota?: Readonly<import('./quota.mjs').InferenceTokenQuota>, costPerWindow?: number, costLedger?: { record: (usage: { item: string, quantity: number, institution: string, agent: string, model: string }, context?: { actor?: string }) => unknown }, costInstitution?: string, maxLoggedTextChars?: number, lattice?: import('../data/classification.mjs').ClassificationLattice | null, now?: () => Date }} [deps]
   */
  constructor({
    modelRegistry,
    enforcementPoint,
    log,
    execute,
    quarantine = null,
    safetyRules = DEFAULT_SAFETY_RULES,
    callsPerWindow = DEFAULT_CALLS_PER_WINDOW,
    windowMs = DEFAULT_WINDOW_MS,
    tokensPerWindow,
    budgetWindowMs,
    budgetStore,
    quota,
    costPerWindow = DEFAULT_COST_PER_WINDOW,
    costLedger,
    costInstitution,
    maxLoggedTextChars = DEFAULT_LOG_TEXT_CHARS,
    lattice = null,
    now,
  } = {}) {
    if (!modelRegistry || !enforcementPoint || !log || typeof execute !== 'function') {
      throw new InferenceError(
        INFERENCE_ERRORS.DEPENDENCY_MISSING,
        'بوابة الاستدلال تحتاج سجل النماذج ونقطة تفويض وسجلاً ومنفّذاً؛ غياب واحد منها يفتح استدلالاً بلا توجيه أو قرار أو أثر.',
      );
    }
    // ── دوامُ الميزانيةِ إلزامٌ لا خيارٌ (‏`LIM-1`، `WL-197`) ──
    // كان العدّادُ في الذاكرةِ وحدَها، فمن استنفدَ سقفَه استأنفَ الإنفاقَ بإعادةِ
    // التشغيلِ. والآن لا تُبنى بوابةٌ بلا مخزنٍ يُقرأُ منه ويُكتَبُ إليه.
    if (
      budgetStore === null ||
      budgetStore === undefined ||
      typeof (/** @type {{ load?: Function, save?: Function }} */ (budgetStore).load) !==
        'function' ||
      typeof (/** @type {{ load?: Function, save?: Function }} */ (budgetStore).save) !== 'function'
    ) {
      throw new InferenceError(
        INFERENCE_ERRORS.DEPENDENCY_MISSING,
        'بوابة الاستدلال تحتاج مخزنَ دوامٍ للميزانيةِ (budgetStore) بـ`load` و`save`؛ العدّادُ في الذاكرةِ وحدَها يعودُ بإعادةِ التشغيلِ.',
      );
    }
    // ── دفترُ التكلفةِ إلزامٌ لا خيارٌ (‏`LIM-1`، `WL-197`) ──
    // كان تمريرُ الدفترِ خيارَ تركيبٍ، فبوابةٌ بلا دفترٍ تُنفِقُ بلا أثرٍ. والآن
    // لا تُبنى بوابةٌ بلا دفترٍ يُقيِّدُ الاستهلاكَ.
    if (
      costLedger === null ||
      costLedger === undefined ||
      typeof (/** @type {{ record?: Function }} */ (costLedger).record) !== 'function'
    ) {
      throw new InferenceError(
        INFERENCE_ERRORS.DEPENDENCY_MISSING,
        'بوابة الاستدلال تحتاج دفترَ تكلفةٍ (costLedger) بـ`record`؛ الاستهلاكُ بلا قيدٍ استهلاكٌ لا دليلَ عليه.',
      );
    }
    if (
      costInstitution === null ||
      costInstitution === undefined ||
      costInstitution.trim() === ''
    ) {
      throw new InferenceError(
        INFERENCE_ERRORS.DEPENDENCY_MISSING,
        'دفترُ التكلفةِ مُلزَمٌ بمؤسسةٍ يُسنَدُ إليها الإنفاقُ؛ وإسنادٌ يُخمَّنُ إسنادٌ إلى غيرِ صاحبِه.',
      );
    }
    this.modelRegistry = modelRegistry;
    this.enforcementPoint = enforcementPoint;
    this.log = log;
    this.execute = execute;
    this.quarantine = quarantine;
    this.safetyRules = safetyRules;
    this.callsPerWindow = callsPerWindow;
    this.windowMs = windowMs;
    /**
     * سقفُ الرموزِ ونافذتُه **من الوثيقةِ**: `config/quotas.yaml` هي مرجعُ
     * الموردِ، وقراءتُها هنا تجعلُ حذفَ الحصّةِ منها رفضاً مقيساً لا سقوطاً إلى
     * رقمٍ مكتوبٍ في الشفرةِ. والتمريرُ الصريحُ للاختبارِ لا للتخييرِ.
     * @type {Readonly<import('./quota.mjs').InferenceTokenQuota> | null}
     */
    this.quota =
      tokensPerWindow !== undefined && budgetWindowMs !== undefined
        ? null
        : (quota ?? loadInferenceTokenQuota());
    this.tokensPerWindow =
      tokensPerWindow ?? /** @type {NonNullable<typeof this.quota>} */ (this.quota).tokensPerWindow;
    // نافذةُ الميزانيةِ ليست نافذةَ حدِّ المعدَّلِ: تلك حدُّ نداءاتٍ في دقيقةٍ،
    // وهذه سقفُ استهلاكٍ في نافذةِ الحصّةِ المُعلَنةِ. وخلطُهما كان يُنفِذُ
    // سقفَ ساعةٍ في دقيقةٍ فيصيرُ الحدُّ المُعلَنُ ستّينَ ضِعفَ ما يَنفُذُ.
    this.budgetWindowMs =
      budgetWindowMs ?? /** @type {NonNullable<typeof this.quota>} */ (this.quota).budgetWindowMs;
    this.costPerWindow = costPerWindow;
    /** @type {{ record: (usage: { item: string, quantity: number, institution: string, agent: string, model: string }, context?: { actor?: string }) => unknown }} */
    this.costLedger = costLedger;
    /**
     * بندُ الكلفةِ يُقرأُ من الوثيقةِ **مقابَلاً بموردِ الحصّةِ**.
     * @type {string}
     */
    this.costItem = inferenceCostItem().id;
    /**
     * صاحبُ الإنفاقِ في بُعدِ المؤسسةِ. الدفترُ يشترطُ أبعادَه الثلاثةَ معاً،
     * والوكيلُ والنموذجُ يُشتقّانِ من الطلبِ نفسِه، أمّا المؤسسةُ فقرارُ تركيبٍ
     * **لا يُخمَّنُ**: دفترٌ مع مؤسسةٍ مجهولةٍ يُسنِدُ الإنفاقَ إلى غيرِ صاحبِه.
     * @type {string}
     */
    this.costInstitution = costInstitution;
    this.maxLoggedTextChars = maxLoggedTextChars;
    /**
     * سلّم التصنيف هو مصدر قرار الحجب في السجل. كان الحجب مكتوباً هنا بنصّين
     * (`sensitive` و`secret`) و`secret` مرتبةٌ لا وجود لها في الفهرس، بينما
     * `sovereign` — أعلى المراتب — لم تكن مذكورة، فكان نصّها يُكتب كاملاً في سجل
     * التدقيق. الآن القرار من السلّم عبر `redactInLogs`، والمجهول يُحجب.
     * @type {import('../data/classification.mjs').ClassificationLattice}
     */
    this.lattice = lattice ?? loadClassificationLattice();
    this.now = now ?? (() => new Date());
    /** @type {Map<string, number[]>} */
    this.attempts = new Map();
    /** @type {Map<string, { startedAt: number, tokens: number, cost: number }>} */
    this.budgets = new Map();
    /**
     * مخزنُ دوامِ الميزانيةِ (‏`LIM-1`، `WL-197`). إلزامٌ لا خيارٌ: القراءةُ عندَ
     * أوّلِ قياسٍ والكتابةُ عندَ كلِّ تغيُّرٍ، فلا يعودُ السقفُ بإعادةِ التشغيلِ.
     * @type {{ load: () => unknown, save: (entries: Array<{ actorId: string, startedAt: number, tokens: number, cost: number }>) => unknown }}
     */
    this.budgetStore = budgetStore;
    /** @type {boolean} */
    this.budgetLoaded = false;
  }

  /**
   * هل تُحجب مادة هذه المرتبة عن نصّ السجل؟ المرتبة المجهولة **تُحجب**: تصريحٌ
   * لا يُعرف لا يُقرأ عامّاً، والفشل إلى الحجب لا إلى الكشف.
   * @param {string} classification
   * @returns {boolean}
   */
  #redacts(classification) {
    try {
      return this.lattice.redactInLogs(classification);
    } catch {
      return true;
    }
  }

  /**
   * يسجل نصاً عاماً/داخلياً مقتطعاً، وبصمةً وطولاً فقط لما تُحجب مرتبته.
   * @param {string} text
   * @param {string} classification
   * @returns {Record<string, unknown>}
   */
  #auditText(text, classification) {
    const charLength = text.length;
    const bytes = Buffer.byteLength(text, 'utf8');
    if (this.#redacts(classification)) {
      return {
        classification,
        charLength,
        bytes,
        sha256: createHash('sha256').update(text, 'utf8').digest('hex'),
      };
    }
    return {
      classification,
      charLength,
      bytes,
      text: text.slice(0, this.maxLoggedTextChars),
      truncated: charLength > this.maxLoggedTextChars,
    };
  }

  /** @param {string} actorId @returns {number} */
  #countAttempt(actorId) {
    const nowMs = this.now().getTime();
    const cutoff = nowMs - this.windowMs;
    const window = (this.attempts.get(actorId) ?? []).filter((at) => at > cutoff);
    window.push(nowMs);
    this.attempts.set(actorId, window);
    return window.length;
  }

  /**
   * يقرأُ دفترَ الميزانيةِ من المخزنِ مرّةً واحدةً عندَ أوّلِ قياسٍ.
   *
   * وتعذُّرُ القراءةِ **يُغلِقُ ولا يَفتحُ**: مخزنٌ لا يُقرأُ يعني استهلاكاً
   * مجهولاً، وافتراضُ الصفرِ عندَه هو نفسُ التجاوزِ الذي يُعالَجُ هنا بلباسٍ
   * آخرَ. فيُرفَضُ الاستدلالُ برمزٍ مُسمّىً.
   * @returns {void}
   */
  #loadBudgets() {
    if (this.budgetLoaded) return;
    let entries;
    try {
      entries = this.budgetStore.load();
    } catch (error) {
      throw new InferenceError(
        INFERENCE_ERRORS.BUDGET_UNREADABLE,
        `مخزنُ ميزانيةِ الاستدلالِ لا يُقرأُ: ${error instanceof Error ? error.message : String(error)}. واستهلاكٌ مجهولٌ لا يُفترَضُ صفراً.`,
      );
    }
    this.budgetLoaded = true;
    this.budgetRestore(entries);
  }

  /**
   * يكتبُ دفترَ الميزانيةِ إلى المخزنِ بعدَ كلِّ تغيُّرٍ.
   *
   * وفشلُ الكتابةِ يُرفَعُ خطأً مُسمّىً لا يُبتلَعُ: استهلاكٌ وقعَ ولم يُدَمْ هو
   * سقفٌ يعودُ بإعادةِ التشغيلِ، وهو العيبُ نفسُه.
   * @returns {void}
   */
  #persistBudgets() {
    try {
      this.budgetStore.save(this.budgetSnapshot());
    } catch (error) {
      throw new InferenceError(
        INFERENCE_ERRORS.BUDGET_UNPERSISTED,
        `استهلاكُ الاستدلالِ وقعَ ولم يُقيَّدْ في مخزنِ الميزانيةِ: ${error instanceof Error ? error.message : String(error)}. وسقفٌ لا يدومُ سقفٌ يعودُ بإعادةِ التشغيلِ.`,
      );
    }
  }

  /**
   * @param {string} actorId
   * @returns {{ startedAt: number, tokens: number, cost: number }}
   */
  #budgetFor(actorId) {
    this.#loadBudgets();
    const nowMs = this.now().getTime();
    const previous = this.budgets.get(actorId);
    if (previous === undefined || nowMs - previous.startedAt >= this.budgetWindowMs) {
      const fresh = { startedAt: nowMs, tokens: 0, cost: 0 };
      this.budgets.set(actorId, fresh);
      return fresh;
    }
    return previous;
  }

  /**
   * لقطةٌ من دفترِ الميزانيةِ تُستعمَلُ لإعادةِ البناءِ بعدَ إعادةِ التشغيلِ
   * (‏`R6-A-05`). تُعادُ النوافذُ **الحيّةُ** وحدَها: نافذةٌ انقضتْ لا معنى
   * لحملِها، وحملُها كان سيُنفِذُ سقفَ نافذةٍ ماضيةٍ على نافذةٍ حاضرةٍ.
   * @returns {Array<{ actorId: string, startedAt: number, tokens: number, cost: number }>}
   */
  budgetSnapshot() {
    const nowMs = this.now().getTime();
    /** @type {Array<{ actorId: string, startedAt: number, tokens: number, cost: number }>} */
    const entries = [];
    for (const [actorId, window] of this.budgets.entries()) {
      if (nowMs - window.startedAt >= this.budgetWindowMs) continue;
      entries.push({
        actorId,
        startedAt: window.startedAt,
        tokens: window.tokens,
        cost: window.cost,
      });
    }
    return entries;
  }

  /**
   * يُعيدُ بناءَ دفترِ الميزانيةِ من لقطةٍ بعدَ إعادةِ التشغيلِ (‏`R6-A-05`).
   *
   * والاستعادةُ **لا تكونُ بابَ تصفيرٍ**: لقطةٌ تُعلِنُ استهلاكاً أقلَّ من
   * المُقاسِ في هذه العمليّةِ تُهمَلُ، فالأعلى هو المُلزِمُ — وإلّا صارَ الحقنُ
   * بلقطةٍ مصنوعةٍ طريقاً إلى سقفٍ جديدٍ، وهو نفسُ العيبِ الذي تُعالِجُه اللقطةُ
   * بلباسٍ آخرَ. ونافذةٌ انقضتْ تُهمَلُ فلا يُمَدُّ عمرُ نافذةٍ ولا يُحمَلُ
   * استهلاكٌ قديمٌ على جديدةٍ. والسطرُ المعطوبُ يُهمَلُ وحدَه ولا يُسقِطُ اللقطةَ
   * كلَّها، وكلُّ مُستعادٍ يُقيَّدُ في السجلِّ بـ`inference.budget.restored`.
   *
   * @param {unknown} entries
   * @returns {number} عددُ النوافذِ المُطبَّقةِ
   */
  budgetRestore(entries) {
    if (!Array.isArray(entries)) return 0;
    const nowMs = this.now().getTime();
    let applied = 0;
    for (const entry of entries) {
      if (entry === null || typeof entry !== 'object') continue;
      const { actorId, startedAt, tokens, cost } = /** @type {Record<string, unknown>} */ (entry);
      if (typeof actorId !== 'string' || actorId.trim() === '') continue;
      if (typeof startedAt !== 'number' || !Number.isFinite(startedAt)) continue;
      if (typeof tokens !== 'number' || !Number.isFinite(tokens) || tokens < 0) continue;
      if (typeof cost !== 'number' || !Number.isFinite(cost) || cost < 0) continue;
      if (nowMs - startedAt >= this.budgetWindowMs) continue;
      if (startedAt > nowMs) continue;
      const current = this.budgets.get(actorId);
      // لا تُخفَّضُ حصيلةٌ قائمةٌ، ولا يُؤخَّرُ بدءُ نافذةٍ قائمةٍ.
      const merged = {
        startedAt: current === undefined ? startedAt : Math.min(current.startedAt, startedAt),
        tokens: Math.max(tokens, current?.tokens ?? 0),
        cost: Math.max(cost, current?.cost ?? 0),
      };
      if (
        current !== undefined &&
        merged.tokens === current.tokens &&
        merged.cost === current.cost &&
        merged.startedAt === current.startedAt
      ) {
        continue;
      }
      this.budgets.set(actorId, merged);
      this.log.append('inference.budget.restored', actorId, {
        startedAt: merged.startedAt,
        tokens: merged.tokens,
        cost: merged.cost,
      });
      applied++;
    }
    return applied;
  }

  /**
   * @param {string} text
   * @param {'input' | 'output'} target
   * @returns {{ id: string, reason: string } | null}
   */
  #blockedBySafetyRule(text, target) {
    const normalized = text.toLocaleLowerCase('en-US');
    for (const rule of this.safetyRules) {
      if (rule.target !== target) continue;
      if (rule.terms.some((term) => normalized.includes(term.toLocaleLowerCase('en-US')))) {
        return { id: rule.id, reason: rule.reason };
      }
    }
    return null;
  }

  /**
   * يسجل الرفض، ويبلّغ الحجر فقط عند تجاوز الميزانية، ثم يرمي الخطأ المسمى.
   * @param {string} code
   * @param {string} message
   * @param {{ actorId: string, purpose: string, modelId: string | null, input: string, inputClassification: string, output?: string, outputClassification: string, [key: string]: unknown }} facts
   * @returns {never}
   */
  #refuse(code, message, facts) {
    const { input, inputClassification, output, outputClassification, ...safeFacts } = facts;
    this.log.append('inference.refused', facts.actorId, {
      code,
      reason: message,
      ...safeFacts,
      input: this.#auditText(input, inputClassification),
      ...(output === undefined ? {} : { output: this.#auditText(output, outputClassification) }),
    });
    if (code === INFERENCE_ERRORS.BUDGET_EXCEEDED && this.quarantine?.report !== undefined) {
      this.quarantine.report({
        kind: 'budget-exceeded',
        subject: facts.actorId,
        detail: { code, purpose: facts.purpose, modelId: facts.modelId },
      });
    }
    throw new InferenceError(code, message, safeFacts);
  }

  /**
   * المسار الوحيد للاستدلال المحكوم.
   * @param {InferenceRequest} request
   * @returns {Promise<{ modelId: string, purpose: string, output: string, usage: { inputTokens: number, outputTokens: number, totalTokens: number, cost: number }, policyId: string | null }>}
   */
  async infer(request) {
    const actor = /** @type {{ id?: unknown }} */ (request.actor ?? {});
    const actorId = typeof actor.id === 'string' ? actor.id : 'unknown';
    const purpose = typeof request.purpose === 'string' ? request.purpose.trim() : '';
    const input = request.input;
    const inputClassification = request.inputClassification ?? 'internal';
    const outputClassification = request.outputClassification ?? inputClassification;
    /** @type {{ actorId: string, purpose: string, modelId: string | null, input: string, inputClassification: string, outputClassification: string, [key: string]: unknown }} */
    const facts = {
      actorId,
      purpose,
      modelId: null,
      input: typeof input === 'string' ? input : '',
      inputClassification,
      outputClassification,
    };

    if (purpose === '') {
      this.#refuse(
        INFERENCE_ERRORS.PURPOSE_REQUIRED,
        'الاستدلال بلا غرض معلَن مرفوض؛ الغرض هو مفتاح توجيه النموذج ولا يُخمن.',
        facts,
      );
    }
    if (typeof input !== 'string') {
      this.#refuse(
        INFERENCE_ERRORS.INPUT_INVALID,
        'مُدخل الاستدلال يجب أن يكون نصاً؛ تحويل قيمة مجهولة إلى نص قد يخفي بيانات أو يغيّر معناها.',
        facts,
      );
    }
    if (this.quarantine?.isQuarantined?.(actorId) === true) {
      this.#refuse(
        INFERENCE_ERRORS.QUARANTINED,
        `الفاعل ${actorId} محجور؛ الحجر يوقف الاستدلال ولا يؤجله إلى ما بعد التحقق.`,
        facts,
      );
    }

    let model;
    try {
      model = await this.modelRegistry.getActive(purpose);
    } catch (error) {
      this.#refuse(
        INFERENCE_ERRORS.MODEL_REGISTRY_FAILED,
        `تعذّر قراءة النموذج النشط للغرض ${purpose}: ${error instanceof Error ? error.message : String(error)}. لا يُختار بديل صامت.`,
        facts,
      );
    }
    if (model === null) {
      this.#refuse(
        INFERENCE_ERRORS.ACTIVE_MODEL_MISSING,
        `لا نموذج نشط للغرض ${purpose}؛ رفض الطلب أأمن من اختيار نموذج احتياطي غير معلَن.`,
        facts,
      );
    }
    facts.modelId = model.id;

    const attempts = this.#countAttempt(actorId);
    if (attempts > this.callsPerWindow) {
      this.#refuse(
        INFERENCE_ERRORS.RATE_LIMIT_EXCEEDED,
        `تجاوز الفاعل ${actorId} حد المعدل: ${attempts} طلبات في ${this.windowMs} مللي ثانية والحد ${this.callsPerWindow}.`,
        { ...facts, attemptsInWindow: attempts },
      );
    }

    const estimatedInputTokens = nonNegativeNumber(
      request.estimatedInputTokens,
      estimateTokens(input),
    );
    const estimatedInputCost = nonNegativeNumber(request.estimatedInputCost, 0);
    const budget = this.#budgetFor(actorId);
    if (
      budget.tokens + estimatedInputTokens > this.tokensPerWindow ||
      budget.cost + estimatedInputCost > this.costPerWindow
    ) {
      this.#refuse(
        INFERENCE_ERRORS.BUDGET_EXCEEDED,
        `تقدير مُدخل الاستدلال يتجاوز الميزانية قبل التنفيذ؛ المتاح ${this.tokensPerWindow - budget.tokens} رمزاً و${this.costPerWindow - budget.cost} كلفة.`,
        {
          ...facts,
          estimatedInputTokens,
          estimatedInputCost,
          consumedTokens: budget.tokens,
          consumedCost: budget.cost,
        },
      );
    }

    const blockedInput = this.#blockedBySafetyRule(input, 'input');
    if (blockedInput !== null) {
      this.#refuse(
        INFERENCE_ERRORS.INPUT_BLOCKED,
        `مُدخل الاستدلال حُجب بقاعدة السلامة ${blockedInput.id}: ${blockedInput.reason}`,
        { ...facts, safetyRule: blockedInput.id },
      );
    }

    const resourceId = request.resourceId ?? model.id;
    const {
      decision,
      token,
      quota: debitedQuota,
    } = await this.enforcementPoint.authorize(
      {
        actor: request.actor,
        action: INFERENCE_ACTION,
        resource: { type: 'model', id: resourceId, classification: inputClassification },
        context: { ...(request.context ?? {}), purpose, modelId: model.id, estimatedInputTokens },
      },
      // قناةُ القياسِ منفصلةٌ عن السياقِ (‏`R6-A-02`): الرموزُ المُقدَّرةُ للمُدخَلِ
      // تُقاسُ هنا، ورموزُ المُخرَجِ لا تُعرفُ قبلَ توليدِه فتُسوّى بعدَه.
      { measured: { tokens: estimatedInputTokens } },
    );
    if (!decision.allowed) {
      this.#refuse(
        INFERENCE_ERRORS.NOT_AUTHORIZED,
        `التفويض رفض الاستدلال برمز ${decision.code}: ${decision.reason}`,
        facts,
      );
    }

    try {
      // التذكرة تستهلك في آخر لحظة قبل المنفذ، لا عند التصريح ولا بعده.
      this.enforcementPoint.verify(token ?? undefined, {
        actorId,
        action: INFERENCE_ACTION,
        resourceKey: `model:${resourceId}`,
      });
    } catch (error) {
      this.#refuse(
        INFERENCE_ERRORS.TICKET_INVALID,
        `تذكرة قرار الاستدلال غير مقبولة: ${error instanceof Error ? error.message : String(error)}`,
        facts,
      );
    }

    let execution;
    try {
      execution = await this.execute({ model, purpose, input });
    } catch (error) {
      this.#refuse(
        INFERENCE_ERRORS.EXECUTION_FAILED,
        `فشل منفذ الاستدلال للنموذج ${model.id}: ${error instanceof Error ? error.message : String(error)}`,
        facts,
      );
    }
    const output = execution.output;
    if (typeof output !== 'string') {
      this.#refuse(
        INFERENCE_ERRORS.OUTPUT_INVALID,
        'منفذ الاستدلال أعاد مُخرجاً غير نصي؛ لا يُعاد كائن مجهول للمستدعي ولا يُسجّل كنص.',
        facts,
      );
    }

    const inputTokens = nonNegativeNumber(execution.usage?.inputTokens, estimatedInputTokens);
    const outputTokens = nonNegativeNumber(execution.usage?.outputTokens, estimateTokens(output));
    const totalTokens = nonNegativeNumber(execution.usage?.totalTokens, inputTokens + outputTokens);
    const cost = nonNegativeNumber(execution.usage?.cost, estimatedInputCost);
    budget.tokens += totalTokens;
    budget.cost += cost;
    // الدوامُ يقعُ **قبلَ** أيِّ رفضٍ تالٍ: استهلاكٌ وقعَ يُقيَّدُ ولو حُجبَ
    // مُخرَجُه، وإلّا صارَ تجاوزُ السقفِ مجّانياً بعدَ إعادةِ التشغيلِ.
    this.#persistBudgets();

    // تسويةُ الحصّةِ بالاستهلاكِ المقيسِ فعلاً (‏`R6-A-02`): خُصمَ المُدخَلُ
    // المُقدَّرُ عندَ التفويضِ، وهنا يُخصمُ فرقُ ما استُهلكَ فعلاً. وتقعُ التسويةُ
    // **قبلَ** فحصِ الميزانيةِ وحجبِ المُخرَجِ: استهلاكٌ وقعَ يُخصمُ ولو حُجبَ
    // مُخرَجُه، وإلّا صارَ تجاوزُ السقفِ مجّانياً على الحصّةِ.
    if (debitedQuota !== null && debitedQuota !== undefined) {
      try {
        await this.enforcementPoint.settleQuota(debitedQuota, totalTokens, actorId);
      } catch (error) {
        this.#refuse(
          INFERENCE_ERRORS.NOT_AUTHORIZED,
          `الحصّةُ استُنفدت عندَ تسويةِ الاستهلاكِ الفعليِّ (${totalTokens} رمزاً): ${error instanceof Error ? error.message : String(error)}. ولا يُعادُ مُخرَجٌ استُهلكَ فوقَ الحصّةِ.`,
          { ...facts, totalTokens },
        );
      }
    }

    if (budget.tokens > this.tokensPerWindow || budget.cost > this.costPerWindow) {
      this.#refuse(
        INFERENCE_ERRORS.BUDGET_EXCEEDED,
        'الاستهلاك الفعلي بعد التنفيذ تجاوز الميزانية؛ يُسجَّل ويُحجب المُخرج وتُوقف الطلبات التالية في النافذة.',
        {
          ...facts,
          output,
          inputTokens,
          outputTokens,
          totalTokens,
          cost,
          consumedTokens: budget.tokens,
          consumedCost: budget.cost,
        },
      );
    }

    const blockedOutput = this.#blockedBySafetyRule(output, 'output');
    if (blockedOutput !== null) {
      this.#refuse(
        INFERENCE_ERRORS.OUTPUT_BLOCKED,
        `مُخرج الاستدلال حُجب بقاعدة السلامة ${blockedOutput.id}: ${blockedOutput.reason}`,
        {
          ...facts,
          output,
          // محتوى حُجب لكونه خطراً لا يعود نصاً إلى السجل ولو ادعى المنادي أنه عام.
          outputClassification: 'sensitive',
          safetyRule: blockedOutput.id,
          inputTokens,
          outputTokens,
          totalTokens,
          cost,
        },
      );
    }

    // ── قيدُ الاستهلاكِ في دفترِ التكلفةِ قبلَ إعادةِ المُخرَجِ ──
    // الترتيبُ مقصودٌ: استهلاكٌ يقعُ ولا يُقيَّدُ استهلاكٌ لا دليلَ عليه
    // (المادة 2)، فإن رفضَ الدفترُ القيدَ **لا يُعادُ المُخرَجُ** ولو نجحَ
    // النداءُ — والرفضُ يُقيَّد في السجلِّ باسمِه لا يُهمَل.
    // والدفترُ إلزامٌ لا خيارٌ (‏`LIM-1`): لا بوابةَ بلا دفترٍ.
    try {
      this.costLedger.record(
        {
          item: this.costItem,
          quantity: Math.round(totalTokens),
          institution: this.costInstitution,
          agent: actorId.startsWith('agent:') ? actorId : `agent:${actorId}`,
          model: `model:${model.id}`,
        },
        { actor: actorId },
      );
    } catch (error) {
      this.#refuse(
        INFERENCE_ERRORS.USAGE_UNRECORDED,
        `تعذّر تقييدُ استهلاكِ الاستدلالِ في دفترِ التكلفةِ: ${error instanceof Error ? error.message : String(error)}. ولا يُعادُ مُخرَجٌ استُهلِكَ له موردٌ بلا قيدٍ.`,
        { ...facts, output, inputTokens, outputTokens, totalTokens, cost },
      );
    }

    this.log.append('inference.completed', actorId, {
      purpose,
      modelId: model.id,
      policyId: decision.policyId,
      attemptsInWindow: attempts,
      usage: { inputTokens, outputTokens, totalTokens, cost },
      input: this.#auditText(input, inputClassification),
      output: this.#auditText(output, outputClassification),
    });
    return {
      modelId: model.id,
      purpose,
      output,
      usage: { inputTokens, outputTokens, totalTokens, cost },
      policyId: decision.policyId,
    };
  }
}

/** @param {ConstructorParameters<typeof InferenceGate>[0]} deps @returns {InferenceGate} */
export function createInferenceGate(deps) {
  return new InferenceGate(deps);
}
