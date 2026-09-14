import { randomUUID } from 'node:crypto';
import { DATA_ASSET_SPEC } from '../persistence/entities.mjs';
import { Classification, loadClassificationLattice } from './classification.mjs';
import { LINEAGE_ERRORS, LineageError } from './lineage.mjs';

/** @typedef {import('../root-of-trust/event-log.mjs').EventLog} EventLog */
/** @typedef {import('./classification.mjs').ClassificationLattice} Lattice */
/** @typedef {import('./approvals.mjs').ClassificationApprovalRegistry} ApprovalRegistry */

/**
 * فهرس البيانات — صار **دائماً** في الخطوة `M3.05`.
 *
 * كان `Map` في الذاكرة: فهرسٌ يُمحى بإعادة التشغيل يجعل كل قرار إتاحةٍ لاحقٍ
 * قراراً بلا مرجع — لأن التصنيف نفسه ضاع. صار المخزن مستودعاً على جدول
 * `state.data_assets`، وقيدُ التصنيف وسلطةُ الاحتفاظ صارا قيدين في القاعدة.
 *
 * **حدٌّ معلن:** كل العمليات صارت `async`، و`records` الداخلية زالت — من كان
 * يقرأ `catalog.records` مباشرة (وقد كان اختبارٌ يفعلها) صار يقرأ `get(id)`.
 */

/**
 * سلّم التصنيف صار بياناً واحداً في `config/classification.yaml` يقرؤه
 * `./classification.mjs` (الخطوة `M7.01`). كان هنا كائنٌ `Classification` وسلّمٌ
 * `RANK` مكتوبان في الكود، ونسخةٌ ثالثة من السلّم في بوابة الاستدلال تختلف عنهما
 * — فصار للحساسية مصدرٌ واحد يحرسه فحص انحراف التعداد.
 *
 * @typedef {import('./classification.mjs').ClassificationValue} TierValue
 */

/**
 * حالة جودة مجموعة بيانات. `unverified` هي الحالة الابتدائية لكل سجل جديد:
 * البيانات غير موثوقة حتى يُثبت خلاف ذلك، لا العكس.
 * @typedef {'unverified' | 'verified' | 'degraded' | 'rejected'} QualityValue
 */

/**
 * سجل مجموعة بيانات في الفهرس. `createdAt` صار `Date` من القاعدة لا نصّاً.
 * @typedef {object} DataRecord
 * @property {string} id
 * @property {string} name
 * @property {string} owner - الجهة المسؤولة، تُنسب إليها كل أحداث السجل
 * @property {TierValue} classification
 * @property {string} source - أصل البيانات، شرط تسجيل لا حقل وصفي
 * @property {number} retentionDays - مدة الاحتفاظ؛ 0 تعني بلا حد معلَن
 * @property {QualityValue} quality
 * @property {boolean} legalHold - حفظٌ قانوني يمنع المحو ولو انتهى الاحتفاظ
 * @property {number} version
 * @property {Date} createdAt
 * @property {Date} updatedAt
 */

/**
 * عقد المستودع الذي يحتاجه هذا الفهرس.
 * @typedef {object} DataRepository
 * @property {(record: Record<string, unknown>) => Promise<Record<string, unknown>>} insert
 * @property {(id: string) => Promise<Record<string, unknown> | null>} findById
 * @property {(query?: { filter?: Record<string, unknown>, limit?: number }) => Promise<Array<Record<string, unknown>>>} list
 * @property {(filter?: Record<string, unknown>) => Promise<number>} count
 * @property {(id: string, expectedVersion: number, patch: Record<string, unknown>) => Promise<Record<string, unknown>>} update
 */

/**
 * السلّم يُحمَّل مرّة واحدة لكل عملية ويُعاد استعماله: قراءة ملف الإعدادات عند كل
 * إنشاء فهرس تُخفي كلفة، والسلّم بيانٌ لا يتغيّر أثناء التشغيل.
 * @type {Lattice | null}
 */
let defaultLattice = null;

/** @returns {Lattice} */
function sharedLattice() {
  defaultLattice ??= loadClassificationLattice();
  return defaultLattice;
}

/** فعل إعادة التصنيف كما هو معلَن في كتالوج الأفعال؛ يُفوَّض وتُتحقَّق تذكرته هنا. */
export const RECLASSIFY_ACTION = 'reclassify-data';

export const RECLASSIFY_ERRORS = Object.freeze({
  ENFORCEMENT_REQUIRED: 'CLASSIFICATION_ENFORCEMENT_REQUIRED',
  APPROVALS_REQUIRED: 'CLASSIFICATION_APPROVALS_REQUIRED',
  DOWNGRADE_APPROVAL_REQUIRED: 'CLASSIFICATION_DOWNGRADE_APPROVAL_REQUIRED',
  TIER_SEALED: 'CLASSIFICATION_TIER_SEALED',
  UNCHANGED: 'CLASSIFICATION_UNCHANGED',
  JUSTIFICATION_REQUIRED: 'CLASSIFICATION_JUSTIFICATION_REQUIRED',
  NOT_AUTHORIZED: 'CLASSIFICATION_RECLASSIFY_NOT_AUTHORIZED',
  TICKET_INVALID: 'CLASSIFICATION_RECLASSIFY_TICKET_INVALID',
});

/**
 * فعلُ تغييرِ الحفظِ القانونيِّ (`R6-A-09`). قبلَ هذا كان الحفظُ القانونيُّ حقلاً
 * يُكتَبُ عندَ التسجيلِ ولا مسارَ **مطلقاً** لتعيينِه أو رفعِه بعدَه إلا `UPDATE`
 * مباشرٌ على القاعدةِ — فالوثيقةُ تقولُ «لا موافقةَ سياديّةً» وهي دقيقةٌ: لم يكنْ
 * هناك ما يُوافَقُ عليه أصلاً. ورفعُ الحفظِ يفتحُ المحوَ على أصلٍ كان ممنوعاً
 * محوُه، وتعيينُه يُعطِّلُ حقَّ محوٍ قد يكونَ واجباً؛ فالاتجاهانِ فوقَ العتبةِ.
 */
export const LEGAL_HOLD_ACTION = 'set-legal-hold';

/** أقلُّ تسبيبٍ مقبولٍ لتغييرِ الحفظِ القانونيِّ؛ سببٌ أقصرُ لا يُراجَعُ لاحقاً. */
export const LEGAL_HOLD_MIN_JUSTIFICATION = 24;

export const LEGAL_HOLD_ERRORS = Object.freeze({
  ENFORCEMENT_REQUIRED: 'LEGAL_HOLD_ENFORCEMENT_REQUIRED',
  UNCHANGED: 'LEGAL_HOLD_UNCHANGED',
  JUSTIFICATION_REQUIRED: 'LEGAL_HOLD_JUSTIFICATION_REQUIRED',
  RETENTION_UNDECLARED: 'LEGAL_HOLD_RETENTION_UNDECLARED',
  NOT_AUTHORIZED: 'LEGAL_HOLD_NOT_AUTHORIZED',
  TICKET_INVALID: 'LEGAL_HOLD_TICKET_INVALID',
});

/** خطأ مُسمّى للحفظ القانوني: الرمز للأتمتة والنص للقارئ. */
export class LegalHoldError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   * @param {Record<string, unknown>} [detail]
   */
  constructor(code, message, detail = {}) {
    super(message);
    this.name = 'LegalHoldError';
    this.code = code;
    /** @type {Record<string, unknown>} */
    this.detail = detail;
  }
}

/** خطأ مُسمّى لإعادة التصنيف: الرمز للأتمتة والنص للقارئ. */
export class ReclassifyError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   * @param {Record<string, unknown>} [detail]
   */
  constructor(code, message, detail = {}) {
    super(message);
    this.name = 'ReclassifyError';
    /** @type {string} */
    this.code = code;
    /** @type {Record<string, unknown>} */
    this.detail = detail;
  }
}

/**
 * @param {Record<string, unknown>} row
 * @returns {DataRecord}
 */
function toRecord(row) {
  // لا حقل `lineage` في السجل المُعاد بعد `M7.04`: كان يُقرأ من عمود الادّعاء
  // فيُصدَّق كأنه نسب. النسب يُقرأ الآن بـ`LineageLedger.trace(id)` وحدها.
  return /** @type {DataRecord} */ (/** @type {unknown} */ (Object.freeze({ ...row })));
}

export class DataCatalog {
  /**
   * الاعتماديات اختيارية في النوع لأن التوقيع يقبل الاستدعاء بلا وسائط ويردّ
   * بخطأ مُسمّى `DATA_CATALOG_DEPENDENCY_MISSING`؛ التحقّق بعده يضيّق النوع.
   * @param {{ log?: EventLog, repository?: DataRepository, lattice?: Lattice, approvals?: ApprovalRegistry | null, enforcementPoint?: import('../policy/enforcement-point.mjs').EnforcementPoint | null, lineage?: import('./lineage.mjs').LineageLedger | null, now?: () => Date }} [deps]
   */
  constructor({
    log,
    repository,
    lattice,
    approvals = null,
    enforcementPoint = null,
    lineage = null,
    now,
  } = {}) {
    if (!log || !repository) throw new Error('DATA_CATALOG_DEPENDENCY_MISSING');
    this.log = log;
    /** @type {DataRepository} */
    this.repository = repository;
    /** @type {Lattice} */
    this.lattice = lattice ?? sharedLattice();
    /**
     * دفتر الاعتمادات ونقطة التفويض اختياريّان في **التركيب** لا في الفعل: من ركّب
     * فهرساً بلا أحدهما يقدر على التسجيل والقراءة، و`reclassify` ترفض عنده برمز
     * مُسمّى — فالفشل مغلقٌ ومعلَن، وليس تصنيفاً يُكتب بلا قرار.
     * @type {ApprovalRegistry | null}
     */
    this.approvals = approvals;
    this.enforcementPoint = enforcementPoint;
    /**
     * دفتر النسب — شرط تركيبٍ للتسجيل (‏`M7.04`). غيابُه يُقرأ **رفضاً** في
     * `register`، لا تسجيلاً بلا نسب.
     * @type {import('./lineage.mjs').LineageLedger | null}
     */
    this.lineage = lineage;
    this.now = now ?? (() => new Date());
  }

  /** @returns {import('../persistence/entities.mjs').EntitySpec} */
  static get spec() {
    return DATA_ASSET_SPEC;
  }

  /**
   * يسجّل مجموعة بيانات جديدة. الاسم والمالك والمصدر شروط تسجيل: بيانات بلا
   * مالك معلَن ولا مصدر معلَن لا يجوز أن تدخل الفهرس. والاسم **فريد** في
   * القاعدة، فمن سجّل اسماً مكرّراً أخذ `REPOSITORY_DUPLICATE_UNIQUE`.
   *
   * وفي `M7.04` زال `lineage` من العقد: كان مصفوفةً حرّة يكتبها المُسجّل نفسه
   * (`['command']`، `[{ from: 'seed' }]`) فتُقرأ لاحقاً كأنها نسب محقَّق. صار
   * موضعُه `derivedFrom`: **معرّفات أصولٍ مفهرسة** يتحقّق منها دفتر النسب واحداً
   * واحداً، ويرفض السلف المجهول، ويرفض الدورة، ويرفض اشتقاقاً ينزل بالتصنيف.
   * ومن مرّر `lineage` أخذ رفضاً مُسمّى لا تجاهلاً صامتاً — لأن تجاهل حقلٍ يظنّ
   * مُمرِّره أنه يُحفظ أسوأ من رفضه.
   * @param {object} contract
   * @param {string} contract.name
   * @param {string} contract.owner
   * @param {TierValue} [contract.classification=Classification.INTERNAL]
   * @param {string} contract.source
   * @param {string[]} [contract.derivedFrom=[]] أسلاف الأصل: معرّفات أصولٍ قائمة
   *   في الفهرس. مصفوفةٌ فارغة تعني أصلاً أوّلَ مصدرُه `source`.
   * @param {string} [contract.purpose] غرضُ التسجيل، يُكتب في قيد النسب
   * @param {number} [contract.retentionDays=0]
   * @param {boolean} [contract.legalHold=false]
   * @returns {Promise<DataRecord>}
   */
  async register(contract) {
    if (Object.hasOwn(contract ?? {}, 'lineage')) {
      throw new LineageError(
        LINEAGE_ERRORS.CLAIM_REFUSED,
        'الحقل `lineage` أُلغي في `M7.04`: كان نسباً يُدّعى في الطلب بلا تحقّق. مرّر `derivedFrom` بمعرّفات أصولٍ مفهرسة، أو لا تمرّر شيئاً إن كان الأصل أوّلاً.',
      );
    }
    const {
      name,
      owner,
      classification = Classification.INTERNAL,
      source,
      derivedFrom = [],
      purpose,
      retentionDays = 0,
      legalHold = false,
    } = contract ?? {};
    if (!name || !owner || !source) throw new Error('DATA_CONTRACT_REQUIRED');
    if (this.lattice.normalize(classification) !== classification) {
      throw new Error('INVALID_CLASSIFICATION');
    }
    if (!Array.isArray(derivedFrom)) {
      throw new LineageError(
        LINEAGE_ERRORS.INPUT_INVALID,
        '`derivedFrom` مصفوفة معرّفات أصولٍ مفهرسة.',
      );
    }
    // الدفتر شرط **تركيب** لا حقل طلب: فهرسٌ يسجّل أصولاً بلا دفتر نسب يُنتج
    // أصولاً لا جواب لسؤال «من أين جاءت» — وهو بعينه ما تُغلقه هذه الخطوة.
    if (this.lineage === null) {
      throw new LineageError(
        LINEAGE_ERRORS.DEPENDENCY_MISSING,
        'التسجيل يشترط دفتر نسبٍ مركّباً؛ فهرسٌ بلا دفتر يرفض التسجيل ولا يقبل أصلاً بلا مصدرٍ مقيَّد.',
      );
    }
    const parents = derivedFrom.map((parent) => String(parent));
    const id = 'data:' + randomUUID();
    const row = await this.repository.insert({
      id,
      name,
      owner,
      classification,
      source,
      retentionDays,
      quality: 'unverified',
      legalHold,
    });
    // **حدٌّ معلن:** قيد النسب يُكتب **بعد** صفّ الأصل، لأن مرجع القاعدة يشترط
    // وجود الأصل. فإن أخفق التحقّق من سلفٍ (سلفٌ مجهول، أو دورة، أو اشتقاقٌ ينزل
    // بالتصنيف) بقي صفُّ الأصل مكتوباً بلا نسب، ويُرفع الخطأ كما هو. ولا يُبتلع:
    // الأصل الذي بلا قيد أصلٍ يكشفه `scripts/guard-lineage.mjs` وتكشفه
    // `LineageLedger.verify()`. والذرّية تحتاج مُشغّل معاملة، وهي متاحة في
    // `createPostgresRegistries` ومن ركّب على الذاكرة لا يملكها — والفرق معلَن.
    await this.lineage.record({
      assetId: id,
      kind: parents.length === 0 ? 'origin' : 'derivation',
      actorId: owner,
      parents,
      purpose: typeof purpose === 'string' && purpose.trim() !== '' ? purpose.trim() : 'register',
      asset: row,
    });
    this.log.append('data.registered', owner, {
      id,
      name,
      classification,
      derivedFrom: [...parents],
    });
    return toRecord(row);
  }

  /**
   * يُعلن نتيجة تدقيق جودة. لا يقبل `unverified` لأنها حالة ابتدائية لا حكم.
   * @param {string} id
   * @param {'verified' | 'degraded' | 'rejected'} quality
   * @returns {Promise<DataRecord>}
   */
  async markQuality(id, quality) {
    const row = await this.repository.findById(id);
    if (row === null) throw new Error('DATASET_NOT_FOUND');
    if (!['verified', 'degraded', 'rejected'].includes(quality)) {
      throw new Error('INVALID_QUALITY');
    }
    const current = toRecord(row);
    const updated = await this.repository.update(id, current.version, { quality });
    this.log.append('data.quality.changed', current.owner, { id, quality });
    return toRecord(updated);
  }

  // قرار الإتاحة **ليس هنا** — الخطوة `M7.02`. كانت في هذا الموضع دالّة
  // `canRead(id, actor, clearance)` تقارن تصريحاً **يمرّره المُنادي** بتصنيف الأصل
  // بلا سياسةٍ تُقيَّم ولا تذكرةٍ تُحقَّق ولا رفضٍ يُسجَّل: فمن نادى بـ«sovereign» قرأ
  // السيادي. ومن يمرّر تصريحه يخترعه — وهو نفس عيب «الاعتماد حقلٌ في الطلب».
  // فحُذفت، وصار الوصول من `src/data/access-gate.mjs` وحدها: تفويضٌ فتخليصٌ
  // مشتقٌّ من الدور فتذكرةٌ قبل الأثر، وكلُّ رفضٍ مسجَّلٌ ومُبلَّغٌ للحاجب.

  /**
   * يُعيد تصنيف أصل بيانات — الخطوة `M7.01`.
   *
   * الاتجاه هو الفارق: **الترقية** (رفع الحساسية) اتجاهٌ أمن، يكفيها تسبيبٌ
   * مسجّل؛ ومن اشترط لها اعتماداً أخّر تصحيح تصنيفٍ ناقص. و**التخفيض** هو الفعل
   * الخطر — به يُنشر ما كان محجوباً — فيشترط **اعتماداً مسجّلاً** يُقرأ بمُعرّفه من
   * دفتر الاعتمادات ويُستهلَك مرّةً واحدة؛ ولا يُقبل كائن اعتمادٍ يُمرَّر في الطلب، لأن
   * من يستطيع تمريره يستطيع اختراعه.
   *
   * الترتيب مقصود: الأصل فالاتجاه فالختم فالتسبيب → التفويض والتذكرة → الاعتماد
   * إن كان تخفيضاً → الكتابة. والاعتماد يُستهلَك **بعد** التفويض كي لا يُحرَق اعتمادٌ
   * صحيح على طلبٍ ترفضه السياسة.
   * @param {object} request
   * @param {string} request.id
   * @param {import('../policy/model.mjs').PolicyActor} request.actor
   * @param {unknown} request.to - المرتبة المطلوبة
   * @param {string} request.justification
   * @param {string} [request.approvalId] - إلزامي للتخفيض، ولا معنى له في الترقية
   * @returns {Promise<DataRecord>}
   */
  async reclassify({ id, actor, to, justification, approvalId }) {
    const row = await this.repository.findById(id);
    if (row === null) throw new Error('DATASET_NOT_FOUND');
    const current = toRecord(row);
    const target = this.lattice.tier(to).id;
    const from = current.classification;
    const direction = this.lattice.direction(from, target);
    const reason = typeof justification === 'string' ? justification.trim() : '';
    const actorId = actor?.id ?? 'unknown';

    /**
     * الرفض يُسجّل ثم يُرفع: سجلٌ لا يحوي إلا النجاح لا يُرى فيه اعتداء.
     * @param {string} code
     * @param {string} message
     * @returns {never}
     */
    const refuse = (code, message) => {
      this.log.append('data.classification.refused', actorId, {
        id,
        from,
        to: target,
        direction,
        code,
      });
      throw new ReclassifyError(code, message, { id, from, to: target, direction });
    };

    if (direction === 'unchanged') {
      refuse(
        RECLASSIFY_ERRORS.UNCHANGED,
        `الأصل مصنّف أصلاً «${target}»؛ إعادة تصنيفٍ لا تغيّر شيئاً تملأ السجل بلا قرار.`,
      );
    }
    const rules = direction === 'demotion' ? this.lattice.demotion : this.lattice.promotion;
    if (rules.requiresJustification && reason.length < rules.minJustificationChars) {
      refuse(
        RECLASSIFY_ERRORS.JUSTIFICATION_REQUIRED,
        `التسبيب أقصر من ${rules.minJustificationChars} حرفاً؛ تغيير تصنيف بلا سبب مقروء لا يُراجَع لاحقاً.`,
      );
    }
    if (direction === 'demotion' && this.lattice.isSealed(from)) {
      refuse(
        RECLASSIFY_ERRORS.TIER_SEALED,
        `المرتبة «${from}» مختومة: إنزالها إجراءٌ دستوري (M8) لا قرار مُشغّل، فلا يُقبل لها اعتماد تشغيلي.`,
      );
    }
    if (direction === 'demotion' && rules.requiresApproval && this.approvals === null) {
      refuse(
        RECLASSIFY_ERRORS.APPROVALS_REQUIRED,
        'التخفيض يشترط دفتر اعتمادات مركّباً؛ فهرسٌ بلا دفتر يرفض التخفيض ولا يمرّره بلا اعتماد.',
      );
    }
    if (
      direction === 'demotion' &&
      rules.requiresApproval &&
      (typeof approvalId !== 'string' || approvalId.trim() === '')
    ) {
      refuse(
        RECLASSIFY_ERRORS.DOWNGRADE_APPROVAL_REQUIRED,
        `تخفيض التصنيف «${from} ← ${target}» بلا اعتماد مسجّل مرفوض: نشر ما كان محجوباً لا يقع بقرار منفّذٍ واحد.`,
      );
    }
    if (this.enforcementPoint === null) {
      refuse(
        RECLASSIFY_ERRORS.ENFORCEMENT_REQUIRED,
        'إعادة التصنيف فعلٌ محكوم: فهرسٌ بلا نقطة تفويض لا ينفّذها، والغياب رفضٌ لا تجاوز.',
      );
    }

    const { decision, token } = await this.enforcementPoint.authorize({
      actor,
      action: RECLASSIFY_ACTION,
      resource: { type: 'data', id, classification: from },
      context: { from, to: target, direction, steps: this.lattice.steps(from, target) },
    });
    if (!decision.allowed) {
      refuse(
        RECLASSIFY_ERRORS.NOT_AUTHORIZED,
        `التفويض رفض إعادة التصنيف برمز ${decision.code}: ${decision.reason}`,
      );
    }
    try {
      this.enforcementPoint.verify(token ?? undefined, {
        actorId,
        action: RECLASSIFY_ACTION,
        resourceKey: `data:${id}`,
      });
    } catch (error) {
      refuse(
        RECLASSIFY_ERRORS.TICKET_INVALID,
        `تذكرة القرار غير مقبولة: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    /** @type {string | null} */
    let consumedApprovalId = null;
    if (direction === 'demotion' && rules.requiresApproval) {
      const approvals = /** @type {ApprovalRegistry} */ (this.approvals);
      const approval = await approvals.consume({
        approvalId: /** @type {string} */ (approvalId),
        assetId: id,
        from,
        to: target,
        actorId,
        recordVersion: current.version,
      });
      consumedApprovalId = approval.id;
    }

    const updated = await this.repository.update(id, current.version, { classification: target });
    this.log.append('data.classification.changed', actorId, {
      id,
      from,
      to: target,
      direction,
      justification: reason,
      approvalId: consumedApprovalId,
    });
    return toRecord(updated);
  }

  /**
   * يُعيّنُ الحفظَ القانونيَّ أو يرفعُه **بأمرٍ ملكيٍّ مقبولٍ** لا بقرارِ مُشغّلٍ.
   *
   * `R6-A-09`: لم يكنْ في الفهرسِ مسارُ تغييرٍ للحفظِ القانونيِّ بعدَ التسجيلِ،
   * فكان تعيينُه ورفعُه يقعانِ — إن وقعا — بـ`UPDATE` مباشرٍ على القاعدةِ: بلا
   * سياسةٍ، وبلا أمرٍ ملكيٍّ، وبلا قيدٍ في سجلِّ الأحداثِ يُقرأُ لاحقاً. والاتجاهانِ
   * كلاهما محكومانِ: الرفعُ يفتحُ محوَ ما كان محميّاً، والتعيينُ يُعطِّلُ حقَّ محوٍ
   * قد يكونَ واجباً — فليس أحدُهما «آمناً» بطبعِه.
   *
   * **والغيابُ رفضٌ لا تجاوزٌ:** فهرسٌ بلا نقطةِ تفويضٍ لا يُنفِّذُ الفعلَ.
   *
   * **حدٌّ معلَنٌ باقٍ:** هذا يحكمُ مسارَ التطبيقِ. ومن يملكُ اتّصالاً مباشراً
   * بالقاعدةِ يبقى قادراً على تعديلِ العمودِ؛ إغلاقُ ذلك امتيازاتُ قاعدةٍ ومُشغّلٌ
   * لا شفرةُ تطبيقٍ، وهو خارجَ نطاقِ هذا التغييرِ.
   * @param {object} request
   * @param {string} request.id
   * @param {import('../policy/model.mjs').PolicyActor} request.actor
   * @param {boolean} request.hold الحالةُ المطلوبةُ: تعيينٌ أم رفعٌ
   * @param {string} request.justification
   * @param {string} [request.royalCommandId]
   * @param {string} [request.royalCommandDigest]
   * @returns {Promise<DataRecord>}
   */
  async setLegalHold({ id, actor, hold, justification, royalCommandId, royalCommandDigest }) {
    const row = await this.repository.findById(id);
    if (row === null) throw new Error('DATASET_NOT_FOUND');
    const current = toRecord(row);
    const from = current.legalHold === true;
    const to = hold === true;
    const reason = typeof justification === 'string' ? justification.trim() : '';
    const actorId = actor?.id ?? 'unknown';

    /**
     * الرفضُ يُسجَّلُ ثمَّ يُرفَعُ: محاولةُ رفعِ حفظٍ قانونيٍّ تُرَدُّ هي نفسُها
     * واقعةٌ تستحقُّ القراءةَ، وسجلٌّ لا يحوي إلا النجاحَ لا يُرى فيه اعتداءٌ.
     * @param {string} code
     * @param {string} message
     * @returns {never}
     */
    const refuse = (code, message) => {
      this.log.append('data.legal-hold.refused', actorId, { id, from, to, code });
      throw new LegalHoldError(code, message, { id, from, to });
    };

    if (from === to) {
      refuse(
        LEGAL_HOLD_ERRORS.UNCHANGED,
        `الحفظ القانوني على «${id}» هو أصلاً ${to ? 'مُعيَّن' : 'مرفوع'}؛ تغييرٌ لا يغيّر شيئاً يملأ السجل بلا قرار.`,
      );
    }
    if (reason.length < LEGAL_HOLD_MIN_JUSTIFICATION) {
      refuse(
        LEGAL_HOLD_ERRORS.JUSTIFICATION_REQUIRED,
        `التسبيب أقصر من ${LEGAL_HOLD_MIN_JUSTIFICATION} حرفاً؛ ${to ? 'تعيينُ' : 'رفعُ'} حفظٍ قانونيٍّ بلا سبب مقروء لا يُراجَع لاحقاً.`,
      );
    }
    // قيدُ القاعدةِ `data_assets_hold_blocks_zero_retention` يرفض حفظاً على أصلٍ
    // بلا مدّةِ احتفاظٍ معلَنةٍ. ويُقرأُ الرفضُ هنا برمزٍ مُسمّى لا بخطأِ قاعدةٍ
    // خامٍ يصلُ إلى المُنادي فيُقرأَ عطباً في الأداةِ لا رفضاً مقصوداً.
    if (to && current.retentionDays === 0) {
      refuse(
        LEGAL_HOLD_ERRORS.RETENTION_UNDECLARED,
        'حفظٌ قانونيٌّ على أصلٍ بلا مدّةِ احتفاظٍ معلَنةٍ مرفوضٌ؛ أعلِن المدّةَ أوّلاً فالقيدُ في القاعدةِ يرفضه.',
      );
    }
    if (this.enforcementPoint === null) {
      refuse(
        LEGAL_HOLD_ERRORS.ENFORCEMENT_REQUIRED,
        'تغييرُ الحفظ القانوني فعلٌ محكوم: فهرسٌ بلا نقطة تفويض لا ينفّذه، والغياب رفضٌ لا تجاوز.',
      );
    }

    const { decision, token } = await this.enforcementPoint.authorize({
      actor,
      action: LEGAL_HOLD_ACTION,
      resource: { type: 'data', id, classification: current.classification, legalHold: from },
      context: { from, to, direction: to ? 'set' : 'lift', reason },
      ...(typeof royalCommandId === 'string' ? { royalCommandId } : {}),
      ...(typeof royalCommandDigest === 'string' ? { royalCommandDigest } : {}),
    });
    if (!decision.allowed) {
      refuse(
        LEGAL_HOLD_ERRORS.NOT_AUTHORIZED,
        `التفويض رفض تغيير الحفظ القانوني برمز ${decision.code}: ${decision.reason}`,
      );
    }
    try {
      this.enforcementPoint.verify(token ?? undefined, {
        actorId,
        action: LEGAL_HOLD_ACTION,
        resourceKey: `data:${id}`,
        ...(typeof royalCommandId === 'string' ? { royalCommandId } : {}),
        ...(typeof royalCommandDigest === 'string' ? { royalCommandDigest } : {}),
      });
    } catch (error) {
      refuse(
        LEGAL_HOLD_ERRORS.TICKET_INVALID,
        `تذكرة القرار غير مقبولة: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    const updated = await this.repository.update(id, current.version, { legalHold: to });
    this.log.append('data.legal-hold.changed', actorId, {
      id,
      from,
      to,
      justification: reason,
      royalCommandId: typeof royalCommandId === 'string' ? royalCommandId : null,
    });
    return toRecord(updated);
  }

  /**
   * @param {string} id
   * @returns {Promise<DataRecord | null>} صورة مُجمَّدة، أو null إن لم يوجد السجل
   */
  async get(id) {
    const row = await this.repository.findById(id);
    return row === null ? null : toRecord(row);
  }
}
