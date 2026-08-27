/**
 * مسارُ التعديل الدستوريّ — أربعُ خطواتٍ لا خطوة (الخطوة M8.01).
 *
 * **العيبُ الذي تُغلقه هذه الوحدة:** في `LawRegistry` كان تعديلُ نصٍّ فعلاً
 * واحداً: `propose` ثم `transition(..., 'crown')`. أي أنّ سلسلةَ نداءَين من
 * فاعلٍ واحدٍ في مللي‑ثانيةٍ واحدةٍ كانت تكفي لتغيير أعلى نصٍّ في الدولة، وكانت
 * «سلطةُ التاج» **سلسلةَ نصٍّ** تُمرَّر في وسيطٍ لا توقيعاً يُتحقَّق منه.
 *
 * **وما تفرضه هذه الوحدة:** لا يمرّ تعديلٌ إلا باستيفاء الأربعة كلِّها بالترتيب:
 *
 *   1. **طرحٌ** بأمرٍ ملكيٍّ مقبولٍ من بوابة التاج، فعلُه `amend-constitution`
 *      وهدفُه المادةَ بعينها، من فاعلٍ ذي دور الملك، على مادةٍ **غير مختومة**،
 *      بنصٍّ **مختلفٍ فعلاً** عن النافذ، وبسببٍ مكتوبٍ يبلغ الحدَّ الأدنى.
 *   2. **مراجعةٌ** من رئيس القضاة، **لا يجريها الطارح** (فحصٌ على الفاعل نفسِه
 *      لا على دوره)، برأيٍ مكتوبٍ وحكمٍ صريحٍ بالتوافق أو التعارض.
 *   3. **مهلةُ تدبُّرٍ** تمرّ بتمامها، مقيسةً على ساعةٍ تُمرَّر لا على
 *      `Date.now()` داخل الوحدة — فالاختبارُ يقيس المهلةَ ولا يقفز عنها.
 *   4. **إبرامٌ** بأمرٍ ملكيٍّ **ثانٍ مستقلٍّ** فعلُه `ratify-constitution`،
 *      يحمل في حِمله **تجزئةَ الطرح بعينها**؛ فلا يُبرَم نصٌّ غيرُ الذي طُرح
 *      وراجعه القضاء، ولا يُعاد استعمالُ أمرٍ استُهلك في هذا المسار.
 *
 * وكلُّ رفضٍ **واقعةٌ مسجَّلةٌ برمزها** في قناة `constitution`؛ فالمنعُ الصامت
 * لا يُميَّز عن الخلل.
 *
 * **حدودٌ معلَنة:**
 *   1. **الطروحُ في الذاكرة**، لا في جدول. فطرحٌ لم يُبرَم يزول بإعادة التشغيل
 *      ويلزم إعادةُ طرحه بأمرٍ جديد. والاتجاهُ آمن (فقدانُ طرحٍ لا يُنشئ
 *      تعديلاً)، لكنه **نقصٌ مُعلَن** لا ميزة، مكتوبٌ في `docs/REMAINING_WORK.md`.
 *   2. الوحدةُ **تتحقّق من أمرٍ مقبولٍ سلفاً** من `CrownGateway` ولا تتحقّق من
 *      التوقيع بنفسها؛ فقبولُ الأمر مسؤوليةُ البوابة، وهذه الوحدةُ تفحص
 *      **مطابقةَ الأمر للفعل والهدف والحِمل وعدمَ إعادةِ استعماله**.
 *   3. **لا تُنفَّذ المهلةُ بمؤقّت**: لا شيء يستيقظ ليُبرم. الإبرامُ فعلٌ يطلبه
 *      التاجُ بعد المهلة، وهذا مقصود — التعديلُ الدستوريُّ لا يقع بمؤقّت.
 */

import { createHash } from 'node:crypto';
import { ConstitutionError, ConstitutionStore } from './constitution.mjs';

/** @typedef {import('./constitution.mjs').ConstitutionPolicy} ConstitutionPolicy */
/** @typedef {import('./constitution.mjs').ConstitutionArticle} ConstitutionArticle */
/** @typedef {import('./constitution.mjs').ConstitutionRevision} ConstitutionRevision */
/** @typedef {import('../root-of-trust/event-log.mjs').EventLog} EventLog */

/**
 * أحداثُ قناة `constitution` كما هي في `config/events.yaml`.
 *
 * وتُكتب هذه الأنواعُ **نصوصاً حرفيّةً في مواضع النشر** أدناه لا عبر هذا الكائن،
 * لأن مستخرِجَ مواضع النشر في `scripts/lib/event-emissions.mjs` يقرأ الشجرةَ
 * سكونياً ولا يحلّ قيمةَ ثابتٍ مُشار إليه — وهذا حدٌّ مُعلَنٌ هناك. فالثابتُ هنا
 * **للمستهلكين** (والاختبارُ يقايس المنشورَ به فيُكشف أيُّ انحرافٍ بينهما).
 */
export const CONSTITUTION_EVENTS = Object.freeze({
  PROPOSED: 'constitution.amendment.proposed',
  REVIEWED: 'constitution.amendment.reviewed',
  RATIFIED: 'constitution.amendment.ratified',
  REFUSED: 'constitution.amendment.refused',
});

/** حالاتُ الطرح. لا حالةَ «مقبول ضمناً»: ما لم يُبرَم لم يَنفُذ. */
export const ProposalState = Object.freeze({
  PROPOSED: 'proposed',
  REVIEWED: 'reviewed',
  RATIFIED: 'ratified',
  REFUSED: 'refused',
});

/** أحكامُ المراجعة القضائية. */
export const ReviewVerdict = Object.freeze({ COMPATIBLE: 'compatible', CONFLICT: 'conflict' });

/** رموزُ رفضِ المسار. كلُّ رمزٍ مربوطٍ ببندِ ضمانٍ في `config/constitution.yaml`. */
export const AMENDMENT_ERRORS = Object.freeze({
  ROLE_REFUSED: 'CONSTITUTION_ROLE_REFUSED',
  ARTICLE_ENTRENCHED: 'CONSTITUTION_ARTICLE_ENTRENCHED',
  TEXT_UNCHANGED: 'CONSTITUTION_TEXT_UNCHANGED',
  TEXT_TOO_SHORT: 'CONSTITUTION_TEXT_TOO_SHORT',
  REASON_MISSING: 'CONSTITUTION_REASON_MISSING',
  OPINION_MISSING: 'CONSTITUTION_OPINION_MISSING',
  COMMAND_REQUIRED: 'CONSTITUTION_COMMAND_REQUIRED',
  COMMAND_REPLAYED: 'CONSTITUTION_COMMAND_REPLAYED',
  PROPOSAL_UNKNOWN: 'CONSTITUTION_PROPOSAL_UNKNOWN',
  PROPOSAL_STALE: 'CONSTITUTION_PROPOSAL_STALE',
  PROPOSAL_HASH_MISMATCH: 'CONSTITUTION_PROPOSAL_HASH_MISMATCH',
  PROPOSAL_STATE_INVALID: 'CONSTITUTION_PROPOSAL_STATE_INVALID',
  REVIEW_MISSING: 'CONSTITUTION_REVIEW_MISSING',
  REVIEW_VERDICT_INVALID: 'CONSTITUTION_REVIEW_VERDICT_INVALID',
  REVIEW_CONFLICT: 'CONSTITUTION_REVIEW_CONFLICT',
  SELF_REVIEW_REFUSED: 'CONSTITUTION_SELF_REVIEW_REFUSED',
  DELIBERATION_INCOMPLETE: 'CONSTITUTION_DELIBERATION_INCOMPLETE',
});

/** فاعلٌ في المسار: هويّةٌ **ودورٌ مُصرَّحٌ به من خارج الوحدة** لا مطالبةٌ في نصّ. */
/** @typedef {{ id: string, roles: readonly string[] }} PathActor */

/** أمرٌ ملكيٌّ مقبولٌ كما تعيده `CrownGateway.command`. */
/** @typedef {{ id: string, action: string, target: string, payload?: Record<string, unknown>, issuedAt?: string, acceptedAt: string }} AcceptedCommand */

/**
 * طرحُ تعديل.
 * @typedef {object} AmendmentProposal
 * @property {string} id
 * @property {string} articleId
 * @property {string} previousText
 * @property {string} text
 * @property {string} reason
 * @property {string} proposer
 * @property {string} proposedAt
 * @property {number} epoch - عهدُ النصّ الذي طُرح عليه التعديل
 * @property {string} proposalHash
 * @property {string} state
 * @property {{ reviewer: string, verdict: string, opinion: string, at: string } | null} review
 * @property {number | null} ratifiedEpoch
 */

/**
 * @param {unknown} value
 * @returns {string}
 */
function sha256(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}

/**
 * @param {unknown} value
 * @returns {boolean}
 */
function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * زمنٌ صالحٌ أو لا زمن. **لا يُقرأ تاريخٌ غيرُ صالحٍ صفراً** — فذلك يجعل المهلةَ
 * تمرّ بتاريخٍ خربان.
 * @param {unknown} value
 * @returns {number | null}
 */
function epochMs(value) {
  if (typeof value !== 'string' || value.trim() === '') return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * مسارُ التعديل الدستوريّ.
 */
export class AmendmentPath {
  /**
   * @param {{ policy?: ConstitutionPolicy, store?: ConstitutionStore, log?: EventLog, now?: () => Date }} deps
   */
  constructor({ policy, store, log, now } = {}) {
    if (!policy || !store || !(store instanceof ConstitutionStore)) {
      throw new ConstitutionError(
        AMENDMENT_ERRORS.PROPOSAL_STATE_INVALID,
        'مسارُ التعديل بلا سياسةٍ أو بلا مخزنِ دستورٍ؛ ولا يُعدَّل ما لا يُقرأ.',
      );
    }
    if (!log || typeof log.append !== 'function') {
      throw new ConstitutionError(
        AMENDMENT_ERRORS.PROPOSAL_STATE_INVALID,
        'مسارُ التعديل بلا سجلِّ أحداث؛ وتعديلٌ دستوريٌّ بلا أثرٍ يُقرأ ليس تعديلاً مسؤولاً.',
      );
    }
    this.policy = policy;
    this.store = store;
    this.log = log;
    this.now = now ?? (() => new Date());
    /** @type {Map<string, AmendmentProposal>} */
    this.proposals = new Map();
    /** @type {Set<string>} معرّفاتُ الأوامر التي استُهلكت في هذا المسار. */
    this.consumedCommands = new Set();
  }

  /**
   * يسجّل واقعةَ رفضٍ ثم يرفع الخطأ. **الرفضُ يُسجَّل دائماً قبل أن يُرفع**، فلا
   * يوجد رفضٌ صامتٌ في هذا المسار.
   * @param {string} actor
   * @param {string} code
   * @param {string} detail
   * @param {Record<string, unknown>} [context]
   * @returns {never}
   */
  #refuse(actor, code, detail, context = {}) {
    this.log.append('constitution.amendment.refused', actor, { code, detail, ...context });
    throw new ConstitutionError(code, detail);
  }

  /**
   * @param {PathActor | undefined} actor
   * @returns {PathActor}
   */
  #actorOf(actor) {
    if (
      !actor ||
      typeof actor.id !== 'string' ||
      actor.id.trim() === '' ||
      !Array.isArray(actor.roles)
    ) {
      throw new ConstitutionError(
        AMENDMENT_ERRORS.ROLE_REFUSED,
        'فاعلٌ بلا هويّةٍ أو بلا أدوارٍ مُصرَّحة؛ والمجهولُ لا يعدّل دستوراً.',
      );
    }
    return actor;
  }

  /**
   * @param {PathActor} actor
   * @param {readonly string[]} allowed
   * @param {string} step
   * @returns {void}
   */
  #assertRole(actor, allowed, step) {
    if (!actor.roles.some((role) => allowed.includes(role))) {
      this.#refuse(
        actor.id,
        AMENDMENT_ERRORS.ROLE_REFUSED,
        `خطوةُ «${step}» محصورةٌ في ${allowed.join(' أو ')}؛ وأدوارُ الفاعل: ${actor.roles.join(', ') || 'لا شيء'}.`,
        { step },
      );
    }
  }

  /**
   * يفحص أمراً ملكياً مقبولاً: فعلَه وهدفَه وقبولَه وعدمَ إعادةِ استعماله.
   * **لا يستهلكه** — الاستهلاكُ بعد نجاح الخطوة كلِّها، فخطوةٌ فاشلةٌ لا تُحرق
   * أمراً صحيحاً.
   * @param {PathActor} actor
   * @param {unknown} command
   * @param {string} expectedAction
   * @param {string} expectedTarget
   * @returns {AcceptedCommand}
   */
  #assertCommand(actor, command, expectedAction, expectedTarget) {
    if (!isPlainObject(command)) {
      this.#refuse(
        actor.id,
        AMENDMENT_ERRORS.COMMAND_REQUIRED,
        'لا أمرَ ملكياً مع الطلب؛ ولا تُلمَس المادةُ الدستورية بطلبٍ عاديّ.',
        { expectedAction, expectedTarget },
      );
    }
    const record = /** @type {Record<string, unknown>} */ (command);
    const id = typeof record.id === 'string' ? record.id : '';
    if (id.trim() === '') {
      this.#refuse(
        actor.id,
        AMENDMENT_ERRORS.COMMAND_REQUIRED,
        'أمرٌ بلا معرّفٍ لا يُمكن منعُ إعادةِ استعماله؛ فيُرفض.',
        { expectedAction },
      );
    }
    if (record.action !== expectedAction) {
      this.#refuse(
        actor.id,
        AMENDMENT_ERRORS.COMMAND_REQUIRED,
        `فعلُ الأمر «${String(record.action)}» ليس «${expectedAction}»؛ وأمرٌ لفعلٍ آخر لا يُصرَف في هذا المسار.`,
        { commandId: id },
      );
    }
    if (record.target !== expectedTarget) {
      this.#refuse(
        actor.id,
        AMENDMENT_ERRORS.COMMAND_REQUIRED,
        `هدفُ الأمر «${String(record.target)}» ليس «${expectedTarget}»؛ ولا يُنقل إذنُ أمرٍ إلى غير هدفه.`,
        { commandId: id },
      );
    }
    if (epochMs(record.acceptedAt) === null) {
      this.#refuse(
        actor.id,
        AMENDMENT_ERRORS.COMMAND_REQUIRED,
        'الأمرُ غيرُ مقبولٍ من بوابة التاج (لا وقتَ قبولٍ صالحاً)؛ والقبولُ لا يُفترض.',
        { commandId: id },
      );
    }
    if (this.consumedCommands.has(id)) {
      this.#refuse(
        actor.id,
        AMENDMENT_ERRORS.COMMAND_REPLAYED,
        `الأمرُ ${id} استُهلك في هذا المسار؛ وأمرٌ واحدٌ لا يُصرَف مرّتين.`,
        { commandId: id },
      );
    }
    return /** @type {AcceptedCommand} */ (record);
  }

  /**
   * تجزئةُ الطرح: تربط المادةَ والنصَّ الجديدَ والنصَّ الذي طُرح عليه والطارحَ
   * والعهدَ والسبب. فأيُّ تغييرٍ في واحدٍ منها طرحٌ آخر.
   * @param {{ articleId: string, previousText: string, text: string, proposer: string, epoch: number, reason: string }} input
   * @returns {string}
   */
  static hashProposal({ articleId, previousText, text, proposer, epoch, reason }) {
    return sha256(
      [articleId, sha256(previousText), sha256(text), proposer, String(epoch), sha256(reason)].join(
        '\u0000',
      ),
    );
  }

  /**
   * **الخطوة 1 — الطرح.**
   * @param {{ actor?: PathActor, articleId: string, text: string, reason: string, command: unknown }} input
   * @returns {AmendmentProposal}
   */
  propose({ actor, articleId, text, reason, command }) {
    const who = this.#actorOf(actor);
    this.store.assertIntact();
    this.#assertRole(who, this.policy.amendment.proposerRoles, 'الطرح');

    const article = this.store.articleOf(articleId);
    if (article.entrenched) {
      this.#refuse(
        who.id,
        AMENDMENT_ERRORS.ARTICLE_ENTRENCHED,
        `المادة ${articleId} مختومة؛ ولا تُعدَّل ولو بالمسار كاملاً — تغييرُها فعلٌ تأسيسيٌّ خارج سلطة هذا النظام.`,
        { articleId },
      );
    }
    const nextText = typeof text === 'string' ? text.trim() : '';
    if (nextText.length < this.policy.amendment.minTextLength) {
      this.#refuse(
        who.id,
        AMENDMENT_ERRORS.TEXT_TOO_SHORT,
        `نصُّ المادة يجب أن يبلغ ${this.policy.amendment.minTextLength} حرفاً على الأقل؛ والمقدَّمُ ${nextText.length}.`,
        { articleId },
      );
    }
    if (nextText === article.text.trim()) {
      this.#refuse(
        who.id,
        AMENDMENT_ERRORS.TEXT_UNCHANGED,
        'النصُّ المطروح مطابقٌ للنافذ؛ وتعديلٌ لا يغيّر شيئاً ليس تعديلاً.',
        { articleId },
      );
    }
    const why = typeof reason === 'string' ? reason.trim() : '';
    if (why.length < this.policy.amendment.minReasonLength) {
      this.#refuse(
        who.id,
        AMENDMENT_ERRORS.REASON_MISSING,
        `سببُ التعديل يجب أن يبلغ ${this.policy.amendment.minReasonLength} حرفاً على الأقل؛ فلا تعديلَ بلا حجّةٍ في السجل.`,
        { articleId },
      );
    }
    const accepted = this.#assertCommand(
      who,
      command,
      this.policy.amendment.proposeAction,
      articleId,
    );

    const epoch = this.store.epoch();
    const proposalHash = AmendmentPath.hashProposal({
      articleId,
      previousText: article.text,
      text: nextText,
      proposer: who.id,
      epoch,
      reason: why,
    });
    /** @type {AmendmentProposal} */
    const proposal = {
      id: proposalHash.slice(0, 32),
      articleId,
      previousText: article.text,
      text: nextText,
      reason: why,
      proposer: who.id,
      proposedAt: this.now().toISOString(),
      epoch,
      proposalHash,
      state: ProposalState.PROPOSED,
      review: null,
      ratifiedEpoch: null,
    };
    this.consumedCommands.add(accepted.id);
    this.proposals.set(proposal.id, proposal);
    this.log.append('constitution.amendment.proposed', who.id, {
      proposalId: proposal.id,
      articleId,
      proposalHash,
      epoch,
      commandId: accepted.id,
      reason: why,
    });
    return Object.freeze({ ...proposal });
  }

  /**
   * @param {PathActor} who
   * @param {string} proposalId
   * @returns {AmendmentProposal}
   */
  #proposalOf(who, proposalId) {
    const found = this.proposals.get(proposalId);
    if (!found) {
      this.#refuse(
        who.id,
        AMENDMENT_ERRORS.PROPOSAL_UNKNOWN,
        `لا طرحَ بهذا المعرّف: ${String(proposalId)} — ولا يُبنى على طرحٍ لم يقع.`,
        { proposalId },
      );
    }
    return found;
  }

  /**
   * **الخطوة 2 — المراجعة القضائية.**
   * @param {{ actor?: PathActor, proposalId: string, verdict: string, opinion: string }} input
   * @returns {AmendmentProposal}
   */
  review({ actor, proposalId, verdict, opinion }) {
    const who = this.#actorOf(actor);
    this.store.assertIntact();
    this.#assertRole(who, this.policy.amendment.reviewerRoles, 'المراجعة');
    const proposal = this.#proposalOf(who, proposalId);

    if (proposal.state !== ProposalState.PROPOSED) {
      this.#refuse(
        who.id,
        AMENDMENT_ERRORS.PROPOSAL_STATE_INVALID,
        `الطرحُ في حالة «${proposal.state}»؛ ولا يُراجَع إلا المطروحُ مرّةً واحدة.`,
        { proposalId },
      );
    }
    if (who.id === proposal.proposer) {
      this.#refuse(
        who.id,
        AMENDMENT_ERRORS.SELF_REVIEW_REFUSED,
        'الطارحُ لا يراجع طرحَه؛ ومراجعةُ المرء عملَ نفسِه ليست مراجعة.',
        { proposalId },
      );
    }
    if (verdict !== ReviewVerdict.COMPATIBLE && verdict !== ReviewVerdict.CONFLICT) {
      this.#refuse(
        who.id,
        AMENDMENT_ERRORS.REVIEW_VERDICT_INVALID,
        `حكمُ المراجعة يجب أن يكون «${ReviewVerdict.COMPATIBLE}» أو «${ReviewVerdict.CONFLICT}»؛ والمقدَّمُ «${String(verdict)}».`,
        { proposalId },
      );
    }
    const said = typeof opinion === 'string' ? opinion.trim() : '';
    if (said.length < this.policy.amendment.minOpinionLength) {
      this.#refuse(
        who.id,
        AMENDMENT_ERRORS.OPINION_MISSING,
        `رأيُ المراجعة يجب أن يبلغ ${this.policy.amendment.minOpinionLength} حرفاً على الأقل؛ فحكمٌ بلا رأيٍ ليس مراجعة.`,
        { proposalId },
      );
    }

    const review = { reviewer: who.id, verdict, opinion: said, at: this.now().toISOString() };
    // حكمُ التعارض **يُنهي** الطرحَ ولا يتركه قابلاً للإبرام: فطرحٌ قضى القضاءُ
    // بتعارضه لا يُحيا بمرور الوقت.
    proposal.review = review;
    proposal.state =
      verdict === ReviewVerdict.COMPATIBLE ? ProposalState.REVIEWED : ProposalState.REFUSED;
    this.log.append('constitution.amendment.reviewed', who.id, {
      proposalId: proposal.id,
      articleId: proposal.articleId,
      verdict,
      opinion: said,
      state: proposal.state,
    });
    return Object.freeze({ ...proposal, review: Object.freeze({ ...review }) });
  }

  /**
   * الزمنُ المتبقّي من مهلة التدبُّر بالثواني (صفرٌ إن انقضت). دالّةُ قراءةٍ
   * لا تغيّر شيئاً، ووجودُها يجعل الخطوةَ الثالثة **مقيسةً لا مفترضة**.
   * @param {string} proposalId
   * @returns {number}
   */
  deliberationRemaining(proposalId) {
    const proposal = this.proposals.get(proposalId);
    if (!proposal) {
      throw new ConstitutionError(
        AMENDMENT_ERRORS.PROPOSAL_UNKNOWN,
        `لا طرحَ بهذا المعرّف: ${String(proposalId)}.`,
      );
    }
    const from = epochMs(proposal.proposedAt);
    if (from === null) {
      throw new ConstitutionError(
        AMENDMENT_ERRORS.PROPOSAL_STATE_INVALID,
        'وقتُ الطرح غيرُ صالح؛ ولا تُقاس مهلةٌ على زمنٍ خربان.',
      );
    }
    const elapsed = (this.now().getTime() - from) / 1000;
    const remaining = this.policy.amendment.deliberationSeconds - elapsed;
    return remaining > 0 ? remaining : 0;
  }

  /**
   * **الخطوة 4 — الإبرام** (وفيها تُقاس الخطوةُ الثالثة: مهلةُ التدبُّر).
   * @param {{ actor?: PathActor, proposalId: string, command: unknown }} input
   * @returns {{ proposal: AmendmentProposal, revision: ConstitutionRevision }}
   */
  ratify({ actor, proposalId, command }) {
    const who = this.#actorOf(actor);
    this.store.assertIntact();
    this.#assertRole(who, this.policy.amendment.ratifierRoles, 'الإبرام');
    const proposal = this.#proposalOf(who, proposalId);

    if (proposal.state === ProposalState.PROPOSED) {
      this.#refuse(
        who.id,
        AMENDMENT_ERRORS.REVIEW_MISSING,
        'لا إبرامَ بلا مراجعةٍ من رئيس القضاة؛ والخطوةُ الثانيةُ لم تقع.',
        { proposalId },
      );
    }
    if (proposal.state === ProposalState.REFUSED) {
      this.#refuse(
        who.id,
        AMENDMENT_ERRORS.REVIEW_CONFLICT,
        'الطرحُ مرفوضٌ قضائياً بتعارضه مع الدستور؛ ولا يُبرَم ما قضى القضاءُ بتعارضه.',
        { proposalId },
      );
    }
    if (proposal.state !== ProposalState.REVIEWED) {
      this.#refuse(
        who.id,
        AMENDMENT_ERRORS.PROPOSAL_STATE_INVALID,
        `الطرحُ في حالة «${proposal.state}»؛ ولا يُبرَم إلا المراجَعُ مرّةً واحدة.`,
        { proposalId },
      );
    }
    const remaining = this.deliberationRemaining(proposal.id);
    if (remaining > 0) {
      this.#refuse(
        who.id,
        AMENDMENT_ERRORS.DELIBERATION_INCOMPLETE,
        `مهلةُ التدبُّر لم تنقضِ: بقي ${Math.ceil(remaining)} ثانيةً من ${this.policy.amendment.deliberationSeconds}.`,
        { proposalId, remaining: Math.ceil(remaining) },
      );
    }
    // العهدُ الذي طُرح عليه التعديل يجب أن يكون هو النافذَ الآن؛ فتعديلٌ آخر
    // أُبرم بعد الطرح يُسقطه — لأن نصَّه المرجعيَّ صار غيرَ ما راجعه القضاء.
    const epochNow = this.store.epoch();
    if (epochNow !== proposal.epoch) {
      this.#refuse(
        who.id,
        AMENDMENT_ERRORS.PROPOSAL_STALE,
        `الطرحُ بُني على العهد ${proposal.epoch} والنافذُ الآن ${epochNow}؛ فيُعاد طرحُه على النصّ القائم.`,
        { proposalId, proposedEpoch: proposal.epoch, currentEpoch: epochNow },
      );
    }
    const accepted = this.#assertCommand(
      who,
      command,
      this.policy.amendment.ratifyAction,
      proposal.articleId,
    );
    const carried = isPlainObject(accepted.payload)
      ? /** @type {Record<string, unknown>} */ (accepted.payload).proposalHash
      : undefined;
    if (carried !== proposal.proposalHash) {
      this.#refuse(
        who.id,
        AMENDMENT_ERRORS.PROPOSAL_HASH_MISMATCH,
        'أمرُ الإبرام لا يحمل تجزئةَ الطرح؛ فلا يُبرَم نصٌّ غيرُ الذي طُرح وراجعه القضاء.',
        { proposalId, commandId: accepted.id },
      );
    }
    // فحصٌ أخير قبل الكتابة: المادةُ ما زالت غيرَ مختومة. (خَتْمُها لا يقع إلا
    // بتغيير النصّ المؤسِّس، وذلك مكشوفٌ بجذره — لكن الفحصُ هنا فشلٌ مغلقٌ مزدوج.)
    if (this.store.articleOf(proposal.articleId).entrenched) {
      this.#refuse(
        who.id,
        AMENDMENT_ERRORS.ARTICLE_ENTRENCHED,
        `المادة ${proposal.articleId} مختومة؛ ولا تُعدَّل ولو بالمسار كاملاً.`,
        { proposalId },
      );
    }

    const revision = this.store.appendAmendment({
      articleId: proposal.articleId,
      text: proposal.text,
      amendmentId: proposal.id,
      ratifiedBy: who.id,
    });
    this.consumedCommands.add(accepted.id);
    proposal.state = ProposalState.RATIFIED;
    proposal.ratifiedEpoch = revision.epoch;
    this.log.append('constitution.amendment.ratified', who.id, {
      proposalId: proposal.id,
      articleId: proposal.articleId,
      proposalHash: proposal.proposalHash,
      epoch: revision.epoch,
      commandId: accepted.id,
    });
    return { proposal: Object.freeze({ ...proposal }), revision };
  }
}
