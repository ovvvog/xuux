/**
 * دفتر اعتمادات إعادة التصنيف — M7.01.
 *
 * العيب الذي يعالجه: الاشتراط الساذج للاعتماد هو أن تقبل الدالة كائناً اسمه
 * `approval` في طلبها. من يستطيع تمرير `{ approvedBy: 'king' }` يستطيع اختراعه،
 * فيصير «الاعتماد» حقلاً يكتبه **نفس** من يريد إنزال التصنيف. فالاعتماد هنا
 * **صفٌّ في مستودع** يُنشأ بفعل منفصل، ولا يقبل الفهرس إلا مُعرّفه.
 *
 * وأربعة قيود تجعل الصفّ اعتماداً لا مجرّد أثر:
 *   1. **فصل السلطات**: المعتمِد غير الطالب، ودورُه من أدوار التخفيض المعلنة في
 *      `config/classification.yaml`.
 *   2. **الربط بالانتقال**: الاعتماد مربوط بالأصل وبالمرتبتين معاً؛ فاعتماد
 *      «سيادي ← حساس» لا يُستعمل لـ«سيادي ← عام».
 *   3. **الربط بنسخة السجل**: قرارٌ على حالةٍ بعينها؛ فإن تغيّر الأصل بعد الاعتماد
 *      سقط الاعتماد ولم يُطبَّق على حالٍ لم يرها المعتمِد.
 *   4. **مرّة واحدة وفي نافذة**: يُستهلَك فلا يُعاد، وينتهي فلا يبقى تصريحاً نائماً.
 *
 * حدٌّ معلن: الاستهلاك كتابةٌ في المستودع، و«استهلِك ثم اكتب التصنيف» كتابتان.
 * حين تُركَّب الحالة على قاعدة مع مُشغّل معاملة تصيران ذرّيتين؛ ومن ركّبها بلا
 * مُشغّل معاملة فقد الذرّية — والفرق معلَن لا مخفيّ. ولا يُقرِّر هذا الملف
 * **جواز** الاعتماد سياسةً؛ فذلك لنقطة التفويض في `data-catalog.mjs`.
 */

import { randomUUID } from 'node:crypto';
import { CLASSIFICATION_APPROVAL_SPEC } from '../persistence/entities.mjs';

export const APPROVAL_ERRORS = Object.freeze({
  DEPENDENCY_MISSING: 'CLASSIFICATION_APPROVAL_DEPENDENCY_MISSING',
  INPUT_INVALID: 'CLASSIFICATION_APPROVAL_INPUT_INVALID',
  NOT_DEMOTION: 'CLASSIFICATION_APPROVAL_NOT_DEMOTION',
  SELF: 'CLASSIFICATION_APPROVAL_SELF',
  ROLE_FORBIDDEN: 'CLASSIFICATION_APPROVAL_ROLE_FORBIDDEN',
  TIER_SEALED: 'CLASSIFICATION_TIER_SEALED',
  STEP_TOO_LARGE: 'CLASSIFICATION_DEMOTION_STEP_TOO_LARGE',
  JUSTIFICATION_REQUIRED: 'CLASSIFICATION_JUSTIFICATION_REQUIRED',
  NOT_FOUND: 'CLASSIFICATION_APPROVAL_NOT_FOUND',
  MISMATCH: 'CLASSIFICATION_APPROVAL_MISMATCH',
  CONSUMED: 'CLASSIFICATION_APPROVAL_CONSUMED',
  EXPIRED: 'CLASSIFICATION_APPROVAL_EXPIRED',
});

/** خطأ مُسمّى: الرمز للأتمتة والنص العربي لمراجع قرار الرفض. */
export class ClassificationApprovalError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   * @param {Record<string, unknown>} [detail]
   */
  constructor(code, message, detail = {}) {
    super(message);
    this.name = 'ClassificationApprovalError';
    /** @type {string} */
    this.code = code;
    /** @type {Record<string, unknown>} */
    this.detail = detail;
  }
}

/**
 * @typedef {object} ApprovalRecord
 * @property {string} id
 * @property {string} assetId
 * @property {import('./classification.mjs').ClassificationValue} fromClassification
 * @property {import('./classification.mjs').ClassificationValue} toClassification
 * @property {string} requestedBy
 * @property {string} approvedBy
 * @property {string} approverRole
 * @property {string} justification
 * @property {number} recordVersion
 * @property {Date} expiresAt
 * @property {Date | null} consumedAt
 * @property {string | null} consumedBy
 * @property {number} version
 */

/**
 * @param {Record<string, unknown>} row
 * @returns {ApprovalRecord}
 */
function toApproval(row) {
  return /** @type {ApprovalRecord} */ (
    /** @type {unknown} */ (
      Object.freeze({
        ...row,
        consumedAt: row['consumedAt'] ?? null,
        consumedBy: row['consumedBy'] ?? null,
      })
    )
  );
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

export class ClassificationApprovalRegistry {
  /**
   * @param {{ log?: import('../root-of-trust/event-log.mjs').EventLog, repository?: import('./data-catalog.mjs').DataRepository, lattice?: import('./classification.mjs').ClassificationLattice, now?: () => Date }} [deps]
   */
  constructor({ log, repository, lattice, now } = {}) {
    if (!log || !repository || !lattice) {
      throw new ClassificationApprovalError(
        APPROVAL_ERRORS.DEPENDENCY_MISSING,
        'دفتر الاعتمادات يحتاج سجلاً ومستودعاً وسلّم تصنيف؛ غياب أحدها يجعل الاعتماد ادّعاءً بلا أثر ولا سلّم يُقاس عليه.',
      );
    }
    this.log = log;
    /** @type {import('./data-catalog.mjs').DataRepository} */
    this.repository = repository;
    /** @type {import('./classification.mjs').ClassificationLattice} */
    this.lattice = lattice;
    this.now = now ?? (() => new Date());
  }

  /** @returns {import('../persistence/entities.mjs').EntitySpec} */
  static get spec() {
    return CLASSIFICATION_APPROVAL_SPEC;
  }

  /**
   * يمنح اعتماد تخفيضٍ واحداً مربوطاً بأصل وانتقالٍ ونسخة سجل.
   * @param {object} request
   * @param {string} request.assetId
   * @param {unknown} request.from - المرتبة الحالية للأصل
   * @param {unknown} request.to - المرتبة المطلوبة، وهي أدنى حساسية
   * @param {string} request.requestedBy - طالب التخفيض
   * @param {string} request.approvedBy - المعتمِد، ولا يكون هو الطالب
   * @param {string} request.approverRole - دور المعتمِد، من أدوار التخفيض المعلنة
   * @param {string} request.justification
   * @param {number} request.recordVersion - نسخة سجل الأصل لحظة الاعتماد
   * @returns {Promise<ApprovalRecord>}
   */
  async grant({
    assetId,
    from,
    to,
    requestedBy,
    approvedBy,
    approverRole,
    justification,
    recordVersion,
  }) {
    const requester = text(requestedBy);
    const approver = text(approvedBy);
    const role = text(approverRole);
    const reason = text(justification);
    if (text(assetId) === '' || requester === '' || approver === '' || role === '') {
      throw new ClassificationApprovalError(
        APPROVAL_ERRORS.INPUT_INVALID,
        'اعتماد التخفيض يحتاج أصلاً وطالباً ومعتمِداً ودوراً؛ أي فراغ منها يجعله أثراً لا يُنسب.',
      );
    }
    if (!Number.isInteger(recordVersion) || recordVersion < 1) {
      throw new ClassificationApprovalError(
        APPROVAL_ERRORS.INPUT_INVALID,
        'نسخة السجل شرط ربط: اعتمادٌ بلا نسخة يُطبَّق على حالٍ لم يرها المعتمِد.',
      );
    }

    const fromTier = this.lattice.tier(from);
    const toTier = this.lattice.tier(to);
    if (this.lattice.direction(fromTier.id, toTier.id) !== 'demotion') {
      throw new ClassificationApprovalError(
        APPROVAL_ERRORS.NOT_DEMOTION,
        `هذا الدفتر للتخفيض وحده؛ «${fromTier.id} ← ${toTier.id}» ليس تخفيضاً، والترقية لا تحتاج اعتماداً.`,
        { from: fromTier.id, to: toTier.id },
      );
    }
    if (fromTier.sealed) {
      throw new ClassificationApprovalError(
        APPROVAL_ERRORS.TIER_SEALED,
        `المرتبة «${fromTier.id}» مختومة: إنزالها إجراءٌ دستوري لا اعتماد تشغيلي، فلا يُمنح له اعتماد هنا.`,
        { from: fromTier.id },
      );
    }
    const steps = this.lattice.steps(fromTier.id, toTier.id);
    if (steps > this.lattice.demotion.maxStepDown) {
      throw new ClassificationApprovalError(
        APPROVAL_ERRORS.STEP_TOO_LARGE,
        `التخفيض ${steps} درجات والحد ${this.lattice.demotion.maxStepDown}؛ كل درجة قرارٌ مستقل يُطلب له اعتمادٌ مستقل.`,
        { steps, maxStepDown: this.lattice.demotion.maxStepDown },
      );
    }
    if (approver === requester) {
      throw new ClassificationApprovalError(
        APPROVAL_ERRORS.SELF,
        'الاعتماد الذاتي إلغاءٌ للاعتماد: من طلب التخفيض لا يعتمده.',
        { actor: approver },
      );
    }
    if (!this.lattice.demotion.approverRoles.includes(role)) {
      throw new ClassificationApprovalError(
        APPROVAL_ERRORS.ROLE_FORBIDDEN,
        `الدور «${role}» ليس من أدوار اعتماد التخفيض المعلنة: ${this.lattice.demotion.approverRoles.join('، ')}.`,
        { role },
      );
    }
    if (
      this.lattice.demotion.requiresJustification &&
      reason.length < this.lattice.demotion.minJustificationChars
    ) {
      throw new ClassificationApprovalError(
        APPROVAL_ERRORS.JUSTIFICATION_REQUIRED,
        `التسبيب أقصر من ${this.lattice.demotion.minJustificationChars} حرفاً؛ اعتمادٌ بلا سبب مقروء لا يُراجَع لاحقاً.`,
      );
    }

    const issuedAt = this.now();
    const row = await this.repository.insert({
      id: 'approval:' + randomUUID(),
      assetId,
      fromClassification: fromTier.id,
      toClassification: toTier.id,
      requestedBy: requester,
      approvedBy: approver,
      approverRole: role,
      justification: reason,
      recordVersion,
      expiresAt: new Date(issuedAt.getTime() + this.lattice.demotion.approvalTtlMs),
      consumedAt: null,
      consumedBy: null,
    });
    const approval = toApproval(row);
    this.log.append('data.classification.approval.granted', approver, {
      id: approval.id,
      assetId,
      from: fromTier.id,
      to: toTier.id,
      requestedBy: requester,
      approverRole: role,
      recordVersion,
      expiresAt: approval.expiresAt.toISOString(),
    });
    return approval;
  }

  /**
   * يقرأ اعتماداً بمُعرّفه ويتحقّق أنه يطابق **هذا** الانتقال بعينه، ثم يستهلكه.
   * الرفض يُرفع خطأً لا يُرجَع قيمةً، فلا يُتجاهل بالإهمال.
   * @param {object} claim
   * @param {string} claim.approvalId
   * @param {string} claim.assetId
   * @param {unknown} claim.from
   * @param {unknown} claim.to
   * @param {string} claim.actorId - المنفّذ، ولا يكون هو المعتمِد
   * @param {number} claim.recordVersion
   * @returns {Promise<ApprovalRecord>} الاعتماد بعد استهلاكه
   */
  async consume({ approvalId, assetId, from, to, actorId, recordVersion }) {
    const row = await this.repository.findById(text(approvalId));
    if (row === null) {
      throw new ClassificationApprovalError(
        APPROVAL_ERRORS.NOT_FOUND,
        'لا اعتماد بهذا المُعرّف: التخفيض يحتاج اعتماداً **مسجَّلاً**، ولا يُقبل كائن اعتماد يُمرَّر في الطلب.',
        { approvalId: text(approvalId) },
      );
    }
    const approval = toApproval(row);
    if (approval.consumedAt !== null) {
      throw new ClassificationApprovalError(
        APPROVAL_ERRORS.CONSUMED,
        'الاعتماد مُستهلَك: صالحٌ مرّةً واحدة، وإعادة استعماله تجعل قراراً واحداً تصريحاً دائماً.',
        { approvalId: approval.id, consumedAt: approval.consumedAt },
      );
    }
    const fromTier = this.lattice.tier(from);
    const toTier = this.lattice.tier(to);
    const actor = text(actorId);
    if (
      approval.assetId !== assetId ||
      approval.fromClassification !== fromTier.id ||
      approval.toClassification !== toTier.id ||
      approval.recordVersion !== recordVersion
    ) {
      throw new ClassificationApprovalError(
        APPROVAL_ERRORS.MISMATCH,
        `الاعتماد لا يطابق هذا الانتقال: مسجَّل «${approval.assetId}: ${approval.fromClassification} ← ${approval.toClassification} @v${approval.recordVersion}» والمطلوب «${assetId}: ${fromTier.id} ← ${toTier.id} @v${recordVersion}».`,
        { approvalId: approval.id },
      );
    }
    if (approval.approvedBy === actor) {
      throw new ClassificationApprovalError(
        APPROVAL_ERRORS.SELF,
        'من اعتمد التخفيض لا ينفّذه بنفسه: فصل السلطات يسري على الاستهلاك كما يسري على المنح.',
        { actor },
      );
    }
    if (approval.expiresAt.getTime() <= this.now().getTime()) {
      throw new ClassificationApprovalError(
        APPROVAL_ERRORS.EXPIRED,
        `الاعتماد انتهى في ${approval.expiresAt.toISOString()}؛ نافذةٌ مفتوحة إلى الأبد تصير تصريحاً دائماً.`,
        { approvalId: approval.id, expiresAt: approval.expiresAt },
      );
    }

    const consumedAt = this.now();
    const updated = await this.repository.update(approval.id, approval.version, {
      consumedAt,
      consumedBy: actor,
    });
    this.log.append('data.classification.approval.consumed', actor, {
      id: approval.id,
      assetId: approval.assetId,
      from: approval.fromClassification,
      to: approval.toClassification,
      approvedBy: approval.approvedBy,
    });
    return toApproval(updated);
  }

  /**
   * @param {string} id
   * @returns {Promise<ApprovalRecord | null>} صورة مُجمَّدة، أو null إن لم يوجد
   */
  async get(id) {
    const row = await this.repository.findById(id);
    return row === null ? null : toApproval(row);
  }
}
