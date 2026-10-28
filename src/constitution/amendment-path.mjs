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
 *   1. **الطروحُ تُستعاد من السجلِّ لا من لقطة** (`WL-484`، شطرُ المقترحاتِ في
 *      `R6-A-05`). كانت الطروحُ ومعرّفاتُ الأوامرِ المستهلَكةِ في الذاكرةِ وحدَها،
 *      فكانت إعادةُ التشغيلِ تُسقِطُ الطرحَ **وتُعيدُ قبولَ أمرٍ استُهلك**. صارَ
 *      المُنشئُ يُعيدُ بناءَهما من أحداثِ القناةِ في سجلِّ الأحداثِ المتسلسلِ
 *      (الشاهد)، ويُطابقُها **في الاتجاهين** مع سلسلةِ الدستورِ الموقَّعة؛ وأيُّ
 *      شاهدٍ خربٍ أو متعارضٍ أو متراجعٍ يُسقِطُ التركيبَ مغلقاً
 *      (`CONSTITUTION_PROPOSALS_WITNESS_INVALID`/`..._CONFLICT`). وحدودُهُ:
 *      سجلٌّ مختومٌ (`sealed`) لا يُقرأُ متزامناً فيُرفَضُ صراحةً (والإلحاقُ
 *      المتزامنُ عليهِ مرفوضٌ أصلاً)؛ وتراجعُ السجلِّ إلى ما قبلَ طرحٍ لم يُبرَمْ
 *      لا يُكشَفُ إلا بمرساةٍ خارجيّةٍ (`EXT-6`) — والاتجاهُ آمن: طرحٌ مفقودٌ لا
 *      يُنشئُ تعديلاً؛ وطرحٌ قديمٌ بلا نصٍّ في حدثِهِ (قبلَ `WL-484`) لا يُستعادُ
 *      بل يُحصى في `unrecoverable` ويبقى أمرُهُ مستهلَكاً.
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
  /** شاهدُ الاسترجاعِ (السجلّ) خربٌ أو ناقصُ الحقولِ أو لا يُقرأ (`WL-484`). */
  WITNESS_INVALID: 'CONSTITUTION_PROPOSALS_WITNESS_INVALID',
  /** الشاهدُ سليمُ الشكلِ لكنّه يناقضُ نفسَهُ أو سلسلةَ الدستورِ (`WL-484`). */
  WITNESS_CONFLICT: 'CONSTITUTION_PROPOSALS_WITNESS_CONFLICT',
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
    /** @type {Set<string>} طروحٌ شُهِدَت بلا نصٍّ (قبلَ `WL-484`) فلا تُستعاد. */
    this.unrecoverable = new Set();
    /** @type {number[]} عهودُ تعديلٍ في السلسلةِ وقعَ الانقطاعُ قبلَ قيدِ إبرامِها. */
    this.ratifiedWithoutWitness = [];
    this.#restoreFromWitness();
  }

  /**
   * **الاسترجاعُ من الشاهد** (`WL-484`، `R6-A-05`). يُعيدُ بناءَ الطروحِ والأوامرِ
   * المستهلَكةِ بإعادةِ تطبيقِ أحداثِ القناةِ بالترتيبِ وبالقواعدِ نفسِها التي
   * فرضَها المسارُ حيّاً؛ فحدثٌ ما كانَ المسارُ ليقبلَهُ حيّاً شاهدٌ متعارض.
   * ثمّ يُطابقُ الشاهدَ بسلسلةِ الدستورِ الموقَّعةِ في الاتجاهين:
   *   - إبرامٌ في السجلِّ بلا عهدٍ مطابقٍ في السلسلة ⇒ السلسلةُ تراجعت أو غريبة؛
   *   - عهدُ تعديلٍ في السلسلةِ بلا طرحٍ مُراجَعٍ مطابقٍ في السجلّ ⇒ السجلُّ
   *     تراجعَ أو غريب. **والاستثناءُ الوحيدُ** نافذةُ الانقطاعِ بينَ كتابةِ العهدِ
   *     وقيدِ الإبرام: عهدٌ **أخيرٌ** يطابقُ طرحاً مُراجَعاً متوافقاً على العهدِ
   *     السابقِ له نصّاً ومادّةً ومعرّفاً — فيُعدُّ مُبرَماً ويُحصى في
   *     `ratifiedWithoutWitness`، لأنّ السلسلةَ موقَّعةٌ بمفتاحِ الملكِ ولا تُكتَبُ
   *     إلا من `ratify` بعدَ كلِّ فحوصِه.
   * لا يكتبُ شيئاً في السجلّ؛ فالإقلاعُ نفسُهُ قراءةٌ لا واقعة.
   * @returns {void}
   */
  #restoreFromWitness() {
    const log =
      /** @type {{ sealed?: unknown, events?: unknown, verifyChain?: () => { ok: boolean, brokenAt?: number } }} */ (
        /** @type {unknown} */ (this.log)
      );
    /** @type {(detail: string) => never} */
    const invalid = (detail) => {
      throw new ConstitutionError(AMENDMENT_ERRORS.WITNESS_INVALID, detail);
    };
    /** @type {(detail: string) => never} */
    const conflict = (detail) => {
      throw new ConstitutionError(AMENDMENT_ERRORS.WITNESS_CONFLICT, detail);
    };
    if (log.sealed === true) {
      invalid(
        'سجلٌّ مختومٌ لا تُقرأ متونُهُ متزامنةً؛ ومسارُ التعديلِ يُلحِقُ متزامناً — فلا يُركَّبُ عليهِ بلا مسارٍ لامتزامنٍ مُصمَّم.',
      );
    }
    if (log.events === undefined) return; // سجلٌّ بلا قراءةٍ (بديلٌ اختباريٌّ): لا شاهدَ يُستعاد
    if (!Array.isArray(log.events)) invalid('أحداثُ السجلِّ ليست قائمة؛ فلا يُقرأ الشاهد.');
    if (typeof log.verifyChain === 'function') {
      const chain = log.verifyChain();
      if (!chain.ok) {
        invalid(
          `سلسلةُ السجلِّ مكسورةٌ عندَ ${String(chain.brokenAt)}؛ ولا يُستعادُ طرحٌ من شاهدٍ خرب.`,
        );
      }
    }
    const revisions = this.store.revisions().map(({ revision }) => revision);
    /** @type {Map<number, ConstitutionRevision>} */
    const byEpoch = new Map(revisions.map((revision) => [revision.epoch, revision]));
    /**
     * نصُّ المادّةِ النافذُ عندَ عهدٍ بعينه — من النصِّ المؤسِّسِ وما أُبرم حتّاه.
     * @param {string} articleId
     * @param {number} epoch
     * @returns {string | null}
     */
    const textAt = (articleId, epoch) => {
      const founding = this.policy.articles.find((article) => article.id === articleId);
      if (!founding) return null;
      let text = founding.text;
      for (const revision of revisions) {
        if (revision.epoch > epoch) break;
        if (revision.kind === 'amendment' && revision.articleId === articleId) {
          text = revision.text ?? text;
        }
      }
      return text;
    };
    /** @type {Set<number>} */
    const witnessedEpochs = new Set();
    const str = (/** @type {unknown} */ v) => typeof v === 'string' && v.trim() !== '';

    for (const event of /** @type {Array<{ seq?: number, type: string, actor: string, data: Record<string, unknown>, at: string }>} */ (
      log.events
    )) {
      if (typeof event?.type !== 'string' || !event.type.startsWith('constitution.amendment.'))
        continue;
      if (event.type === 'constitution.amendment.refused') continue; // الرفضُ لا يُغيّرُ حالاً
      const where = `الحدث ${String(event.seq)} (${event.type})`;
      const d = isPlainObject(event.data) ? event.data : invalid(`${where}: متنٌ ليس كائناً.`);
      if (!str(d.proposalId)) invalid(`${where}: بلا معرّفِ طرح.`);
      const id = /** @type {string} */ (d.proposalId);

      if (event.type === 'constitution.amendment.proposed') {
        if (
          !str(d.commandId) ||
          !str(d.proposalHash) ||
          !str(d.articleId) ||
          !Number.isInteger(d.epoch)
        ) {
          invalid(`${where}: حقولُ الطرحِ ناقصة.`);
        }
        const commandId = /** @type {string} */ (d.commandId);
        if (this.consumedCommands.has(commandId)) {
          conflict(
            `${where}: الأمرُ ${commandId} استُهلكَ قبلاً في الشاهد؛ والمسارُ حيّاً ما كانَ ليقبلَه.`,
          );
        }
        this.consumedCommands.add(commandId);
        if (d.text === undefined && d.previousText === undefined && d.proposedAt === undefined) {
          // طرحٌ سابقٌ لـ`WL-484`: حدثُهُ يحملُ التجزئةَ لا النصّ — فلا يُستعاد.
          this.proposals.delete(id);
          this.unrecoverable.add(id);
          continue;
        }
        if (
          !str(d.text) ||
          typeof d.previousText !== 'string' ||
          epochMs(d.proposedAt) === null ||
          !str(d.reason)
        ) {
          invalid(`${where}: نصُّ الطرحِ أو سببُهُ أو وقتُهُ ناقصٌ أو خربان.`);
        }
        const epoch = /** @type {number} */ (d.epoch);
        const articleId = /** @type {string} */ (d.articleId);
        const recomputed = AmendmentPath.hashProposal({
          articleId,
          previousText: /** @type {string} */ (d.previousText),
          text: /** @type {string} */ (d.text),
          proposer: event.actor,
          epoch,
          reason: /** @type {string} */ (d.reason),
        });
        if (recomputed !== d.proposalHash || recomputed.slice(0, 32) !== id) {
          invalid(`${where}: التجزئةُ المختومةُ لا تطابقُ حقولَ الطرحِ المقروءة.`);
        }
        if (!byEpoch.has(epoch)) {
          conflict(
            `${where}: طرحٌ على العهد ${epoch} والسلسلةُ لا تبلغُه — السلسلةُ تراجعت أو غريبة.`,
          );
        }
        if (textAt(articleId, epoch) !== d.previousText) {
          conflict(
            `${where}: النصُّ السابقُ في الطرحِ لا يطابقُ نصَّ المادّةِ في السلسلةِ عندَ العهد ${epoch}.`,
          );
        }
        this.unrecoverable.delete(id);
        this.proposals.set(id, {
          id,
          articleId,
          previousText: /** @type {string} */ (d.previousText),
          text: /** @type {string} */ (d.text),
          reason: /** @type {string} */ (d.reason),
          proposer: event.actor,
          proposedAt: /** @type {string} */ (d.proposedAt),
          epoch,
          proposalHash: recomputed,
          state: ProposalState.PROPOSED,
          review: null,
          ratifiedEpoch: null,
        });
        continue;
      }

      if (event.type === 'constitution.amendment.reviewed') {
        if (this.unrecoverable.has(id)) continue;
        const proposal = this.proposals.get(id);
        if (!proposal) conflict(`${where}: مراجعةٌ لطرحٍ لم يشهدْهُ السجلّ.`);
        if (proposal.state !== ProposalState.PROPOSED) {
          conflict(`${where}: مراجعةٌ ثانيةٌ لطرحٍ في حالة «${proposal.state}».`);
        }
        if (event.actor === proposal.proposer) conflict(`${where}: الطارحُ راجعَ طرحَه.`);
        const verdict = d.verdict;
        if (verdict !== ReviewVerdict.COMPATIBLE && verdict !== ReviewVerdict.CONFLICT) {
          invalid(`${where}: حكمُ مراجعةٍ غيرُ معروف.`);
        }
        const state =
          verdict === ReviewVerdict.COMPATIBLE ? ProposalState.REVIEWED : ProposalState.REFUSED;
        if (d.state !== state || !str(d.opinion))
          invalid(`${where}: الحالةُ لا تطابقُ الحكمَ أو الرأيُ غائب.`);
        const at = d.at === undefined ? event.at : d.at;
        if (epochMs(at) === null) invalid(`${where}: وقتُ المراجعةِ خربان.`);
        proposal.review = {
          reviewer: event.actor,
          verdict: /** @type {string} */ (verdict),
          opinion: /** @type {string} */ (d.opinion),
          at: /** @type {string} */ (at),
        };
        proposal.state = state;
        continue;
      }

      if (event.type === 'constitution.amendment.ratified') {
        if (!str(d.commandId) || !Number.isInteger(d.epoch) || !str(d.articleId)) {
          invalid(`${where}: حقولُ الإبرامِ ناقصة.`);
        }
        const commandId = /** @type {string} */ (d.commandId);
        if (this.consumedCommands.has(commandId)) {
          conflict(`${where}: أمرُ الإبرامِ ${commandId} استُهلكَ قبلاً في الشاهد.`);
        }
        this.consumedCommands.add(commandId);
        const epoch = /** @type {number} */ (d.epoch);
        const revision = byEpoch.get(epoch);
        if (
          !revision ||
          revision.kind !== 'amendment' ||
          revision.amendmentId !== id ||
          revision.articleId !== d.articleId
        ) {
          conflict(
            `${where}: إبرامٌ على العهد ${epoch} لا يقابلُهُ عهدٌ مطابقٌ في السلسلة — السلسلةُ تراجعت أو غريبة.`,
          );
        }
        if (witnessedEpochs.has(epoch))
          conflict(`${where}: العهدُ ${epoch} أُبرمَ مرّتين في الشاهد.`);
        witnessedEpochs.add(epoch);
        if (this.unrecoverable.has(id)) continue;
        const proposal = this.proposals.get(id);
        if (!proposal) conflict(`${where}: إبرامٌ لطرحٍ لم يشهدْهُ السجلّ.`);
        if (proposal.state !== ProposalState.REVIEWED) {
          conflict(
            `${where}: إبرامُ طرحٍ في حالة «${proposal.state}» والمسارُ لا يُبرمُ إلا المراجَعَ المتوافق.`,
          );
        }
        if (
          d.proposalHash !== proposal.proposalHash ||
          revision.text !== proposal.text ||
          epoch !== proposal.epoch + 1
        ) {
          conflict(`${where}: العهدُ المُبرَمُ لا يطابقُ الطرحَ نصّاً أو تجزئةً أو تعاقباً.`);
        }
        proposal.state = ProposalState.RATIFIED;
        proposal.ratifiedEpoch = epoch;
        continue;
      }
      invalid(`${where}: نوعٌ غيرُ معروفٍ في قناةِ الدستور.`);
    }

    // الاتجاهُ المعاكس: كلُّ عهدِ تعديلٍ في السلسلةِ له إبرامٌ في الشاهد.
    const top = revisions.at(-1)?.epoch ?? 0;
    for (const revision of revisions) {
      if (revision.kind !== 'amendment' || witnessedEpochs.has(revision.epoch)) continue;
      const proposal = this.proposals.get(revision.amendmentId ?? '');
      const crashGap =
        revision.epoch === top &&
        proposal !== undefined &&
        proposal.state === ProposalState.REVIEWED &&
        proposal.epoch + 1 === revision.epoch &&
        proposal.articleId === revision.articleId &&
        proposal.text === revision.text;
      if (!crashGap) {
        conflict(
          `العهدُ ${revision.epoch} في السلسلةِ بلا إبرامٍ في الشاهدِ ولا طرحٍ مُراجَعٍ يطابقُه — السجلُّ تراجعَ أو غريب.`,
        );
      }
      proposal.state = ProposalState.RATIFIED;
      proposal.ratifiedEpoch = revision.epoch;
      this.ratifiedWithoutWitness.push(revision.epoch);
    }
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
      // `WL-484`: ما يلزمُ لاسترجاعِ الطرحِ بعدَ إعادةِ التشغيل — فالتجزئةُ وحدَها
      // تشهدُ ولا تُعيدُ نصّاً.
      text: nextText,
      previousText: article.text,
      proposedAt: proposal.proposedAt,
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
      at: review.at,
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
