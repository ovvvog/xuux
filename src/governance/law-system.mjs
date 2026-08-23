import { randomUUID } from 'node:crypto';
import { snapshot } from '../lib/snapshot.mjs';
import { LAW_SPEC } from '../persistence/entities.mjs';

/** @typedef {import('../root-of-trust/event-log.mjs').EventLog} EventLog */

/**
 * نظام القانون. **سجل القوانين صار دائماً** في الخطوة `M3.05`: قانونٌ نافذ يُمحى
 * بإعادة التشغيل ليس قانوناً، وهذا أخطر ما كان في المخزن المؤقّت.
 *
 * **حدٌّ معلن — قرارُ مالك لا قرارُ منفّذ:** `Court` أدناه **بقيت في الذاكرة**.
 * جدول `state.cases` في الهجرة `0001` يشترط `law_id` مرجعاً إلى قانون، ونموذج
 * المحكمة هنا يرفع قضية بين طرفين بلا قانون مرجعي. المخطَّط والنموذج متناقضان،
 * وتغيير أيّهما قرارٌ سياديّ لا يُتخذ صامتاً في خطوةٍ عنوانها «نقل السجلات».
 * فالقضايا **تُفقد بإعادة التشغيل**، وهذا مُعلن هنا ومسجَّل في خارطة الطريق.
 */

/**
 * حالات القانون الخمس، مشتقة من الكائن المُجمَّد نفسه فلا تنحرف عنه.
 * @typedef {(typeof LawState)[keyof typeof LawState]} LawStateValue
 */

/**
 * حالات القضية الخمس.
 * @typedef {(typeof CaseState)[keyof typeof CaseState]} CaseStateValue
 */

/**
 * قانون في السجل. `version` يديره المستودع ويزيد مع كل كتابة، فهو أثرٌ لا وصف —
 * وهذه هي نفس دلالة النسخة التي كان السجل يحسبها بيده.
 * @typedef {object} Law
 * @property {string} id
 * @property {string} title
 * @property {string} text
 * @property {string} scope - نطاق السريان، و'all' تعني كل النطاقات
 * @property {string} proposer
 * @property {LawStateValue} state
 * @property {number} version
 * @property {string | null} enactedBy - سلطة النفاذ؛ لا نفاذ بلا سلطة مسمّاة
 * @property {Date | null} enactedAt
 * @property {Date | null} repealedAt
 * @property {Date | null} stateChangedAt
 * @property {Date} createdAt
 * @property {Date} updatedAt
 */

/**
 * عقد المستودع الذي يحتاجه سجل القوانين.
 * @typedef {object} LawRepository
 * @property {(record: Record<string, unknown>) => Promise<Record<string, unknown>>} insert
 * @property {(id: string) => Promise<Record<string, unknown> | null>} findById
 * @property {(query?: { filter?: Record<string, unknown>, limit?: number }) => Promise<Array<Record<string, unknown>>>} list
 * @property {(id: string, expectedVersion: number, patch: Record<string, unknown>) => Promise<Record<string, unknown>>} update
 */

/**
 * حكم صادر في قضية.
 * @typedef {{ outcome: string, reason: string, actor: string, at: string }} Judgment
 */

/**
 * طلب استئناف على حكم.
 * @typedef {{ reason: string, actor: string, at: string }} Appeal
 */

/**
 * قضية أمام المحكمة. الحقول التالية للفتح تُضاف عند الانتقال فهي اختيارية.
 * @typedef {object} LegalCase
 * @property {string} id
 * @property {string} claimant
 * @property {string} respondent
 * @property {string} claim
 * @property {unknown[]} evidence - الأدلة كما قدّمها الأطراف، لا تفرض المحكمة شكلها
 * @property {CaseStateValue} state
 * @property {string} createdAt
 * @property {string} [heardBy]
 * @property {Judgment} [judgment]
 * @property {Appeal} [appeal]
 */

export const LawState = Object.freeze({
  DRAFT: 'draft',
  PROPOSED: 'proposed',
  ENACTED: 'enacted',
  SUSPENDED: 'suspended',
  REPEALED: 'repealed',
});
export const CaseState = Object.freeze({
  OPEN: 'open',
  HEARD: 'heard',
  DECIDED: 'decided',
  APPEALED: 'appealed',
  CLOSED: 'closed',
});
/**
 * @param {Record<string, unknown>} row
 * @returns {Law}
 */
function toLaw(row) {
  return /** @type {Law} */ (/** @type {unknown} */ (Object.freeze({ ...row })));
}

export class LawRegistry {
  /**
   * الاعتماديات اختيارية في النوع لأن التوقيع يقبل الاستدعاء بلا وسائط ويردّ
   * بخطأ مُسمّى `LAW_LOG_REQUIRED`؛ التحقّق في أول سطر هو ما يضيّق النوع بعده.
   * @param {{ log?: EventLog, repository?: LawRepository }} [deps]
   */
  constructor({ log, repository } = {}) {
    if (!log || !repository) throw new Error('LAW_LOG_REQUIRED');
    this.log = log;
    /** @type {LawRepository} */
    this.repository = repository;
  }

  /** @returns {import('../persistence/entities.mjs').EntitySpec} */
  static get spec() {
    return LAW_SPEC;
  }

  /**
   * يقترح قانوناً جديداً في حالة مسوّدة. الاقتراح لا يُنفّذ شيئاً بذاته.
   * @param {{ title: string, text: string, scope: string, proposer: string }} draft
   * @returns {Promise<Law>}
   */
  async propose({ title, text, scope, proposer }) {
    if (!title || !text || !scope || !proposer) throw new Error('LAW_REQUIRED');
    const id = 'law:' + randomUUID();
    const row = await this.repository.insert({
      id,
      title,
      text,
      scope,
      proposer,
      state: LawState.DRAFT,
    });
    this.log.append('law.proposed', proposer, { id, title, scope });
    return toLaw(row);
  }

  /**
   * ينقل قانوناً إلى حالة أخرى. الإنفاذ حصر على التاج، والملغى لا يُعاد فتحه.
   *
   * وصار **التعليق والإلغاء لا يقعان على ما لم يَنفُذ**: قيد القاعدة
   * `laws_enactment_authority_recorded` يشترط سلطة نفاذ ووقت نفاذ لكل حالةٍ بعد
   * النفاذ، ومسوّدةٌ «معلَّقة» حالةٌ بلا معنى كانت تُقبل قبل هذه الخطوة.
   * @param {string} id
   * @param {LawStateValue} state - الحالة المطلوبة
   * @param {string} actor - من يطلب الانتقال؛ الإنفاذ يشترط 'crown'
   * @returns {Promise<Law>}
   */
  async transition(id, state, actor) {
    const row = await this.repository.findById(id);
    if (row === null) throw new Error('LAW_NOT_FOUND');
    const law = toLaw(row);
    if (!Object.values(LawState).includes(state)) throw new Error('INVALID_LAW_STATE');
    if (law.state === LawState.REPEALED) throw new Error('REPEALED_LAW_IMMUTABLE');
    if (state === LawState.ENACTED && actor !== 'crown') throw new Error('CROWN_APPROVAL_REQUIRED');
    const now = new Date();
    /** @type {Record<string, unknown>} */
    const patch = { state, stateChangedAt: now };
    if (state === LawState.ENACTED) {
      patch['enactedBy'] = actor;
      patch['enactedAt'] = law.enactedAt ?? now;
    } else if (state === LawState.SUSPENDED || state === LawState.REPEALED) {
      if (law.enactedAt === null) throw new Error('LAW_NOT_ENACTED_YET');
      if (state === LawState.REPEALED) patch['repealedAt'] = now;
    }
    const updated = await this.repository.update(id, law.version, patch);
    this.log.append(`law.${state}`, actor, { id, version: updated['version'] });
    return toLaw(updated);
  }

  /**
   * القوانين المُنفَّذة السارية على نطاق معيّن، بما فيها ما نطاقه 'all'.
   *
   * **حدٌّ معلن:** الترشيح على الحالة يجري في القاعدة (فهرس `laws_scope_status_idx`)
   * وعلى النطاق في الذاكرة، لأن «نطاق هذا أو 'all'» ليس ترشيحاً بحقلٍ واحد.
   * @param {string} scope
   * @returns {Promise<Law[]>}
   */
  async active(scope) {
    const rows = await this.repository.list({ filter: { state: LawState.ENACTED } });
    return rows
      .map((row) => toLaw(row))
      .filter((law) => law.scope === scope || law.scope === 'all');
  }
}
export class Court {
  /**
   * الاعتماديات اختيارية في النوع لأن التوقيع يردّ بخطأ مُسمّى
   * `COURT_DEPENDENCY_MISSING` بدل الانهيار؛ التحقّق بعده يضيّق النوع.
   * @param {{ log?: EventLog, laws?: LawRegistry }} [deps]
   */
  constructor({ log, laws } = {}) {
    if (!log || !laws) throw new Error('COURT_DEPENDENCY_MISSING');
    this.log = log;
    this.laws = laws;
    /** @type {Map<string, LegalCase>} */
    this.cases = new Map();
  }
  /**
   * يرفع قضية جديدة في حالة مفتوحة.
   * @param {{ claimant: string, respondent: string, claim: string, evidence?: unknown[] }} filing
   * @returns {Readonly<LegalCase>}
   */
  file({ claimant, respondent, claim, evidence = [] }) {
    if (!claimant || !respondent || !claim) throw new Error('CASE_REQUIRED');
    const id = 'case:' + randomUUID();
    /** @type {LegalCase} */
    const c = {
      id,
      claimant,
      respondent,
      claim,
      evidence: [...evidence],
      state: CaseState.OPEN,
      createdAt: new Date().toISOString(),
    };
    this.cases.set(id, c);
    this.log.append('court.case.opened', 'court', { id, claimant, respondent });
    return snapshot(c);
  }
  /**
   * ينظر في قضية مفتوحة فينقلها إلى حالة «منظورة».
   * @param {string} id
   * @param {string} [actor='court']
   * @returns {Readonly<LegalCase>}
   */
  hear(id, actor = 'court') {
    const c = this.cases.get(id);
    if (!c) throw new Error('CASE_NOT_FOUND');
    if (c.state !== CaseState.OPEN) throw new Error('CASE_NOT_OPEN');
    c.state = CaseState.HEARD;
    c.heardBy = actor;
    this.log.append('court.case.heard', actor, { id });
    return snapshot(c);
  }
  /**
   * يصدر حكماً في قضية منظورة. الحكم يشترط نتيجة وسبباً معلَنين.
   * @param {string} id
   * @param {{ outcome: string, reason: string }} judgment
   * @param {string} [actor='crown']
   * @returns {Readonly<LegalCase>}
   */
  decide(id, { outcome, reason }, actor = 'crown') {
    const c = this.cases.get(id);
    if (!c) throw new Error('CASE_NOT_FOUND');
    if (c.state !== CaseState.HEARD) throw new Error('CASE_NOT_HEARD');
    if (!outcome || !reason) throw new Error('JUDGMENT_REQUIRED');
    c.state = CaseState.DECIDED;
    c.judgment = { outcome, reason, actor, at: new Date().toISOString() };
    this.log.append('court.case.decided', actor, { id, outcome });
    return snapshot(c);
  }
  /**
   * يستأنف حكماً صادراً. غير المحكوم فيها لا تُستأنف.
   * @param {string} id
   * @param {string} reason
   * @param {string} actor
   * @returns {Readonly<LegalCase>}
   */
  appeal(id, reason, actor) {
    const c = this.cases.get(id);
    if (!c || c.state !== CaseState.DECIDED) throw new Error('CASE_NOT_APPEALABLE');
    c.state = CaseState.APPEALED;
    c.appeal = { reason, actor, at: new Date().toISOString() };
    this.log.append('court.case.appealed', actor, { id });
    return snapshot(c);
  }
}
