import { randomUUID } from 'node:crypto';

/** @typedef {import('../root-of-trust/event-log.mjs').EventLog} EventLog */

/**
 * حالات القانون الخمس، مشتقة من الكائن المُجمَّد نفسه فلا تنحرف عنه.
 * @typedef {(typeof LawState)[keyof typeof LawState]} LawStateValue
 */

/**
 * حالات القضية الخمس.
 * @typedef {(typeof CaseState)[keyof typeof CaseState]} CaseStateValue
 */

/**
 * قانون في السجل. `changedAt` يُضاف عند أول انتقال حالة فهو اختياري.
 * @typedef {object} Law
 * @property {string} id
 * @property {string} title
 * @property {string} text
 * @property {string} scope - نطاق السريان، و'all' تعني كل النطاقات
 * @property {string} proposer
 * @property {LawStateValue} state
 * @property {number} version - يزيد مع كل انتقال حالة، فهو أثر لا وصف
 * @property {string} createdAt
 * @property {string} [changedAt]
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
export class LawRegistry {
  /**
   * السجل موصوف كاختياري في النوع لأن التوقيع يقبل الاستدعاء بلا وسائط ويردّ
   * بخطأ مُسمّى `LAW_LOG_REQUIRED`؛ التحقّق في أول سطر هو ما يضيّق النوع بعده.
   * @param {{ log?: EventLog }} [deps]
   */
  constructor({ log } = {}) {
    if (!log) throw new Error('LAW_LOG_REQUIRED');
    this.log = log;
    /** @type {Map<string, Law>} */
    this.laws = new Map();
  }
  /**
   * يقترح قانوناً جديداً في حالة مسوّدة. الاقتراح لا يُنفّذ شيئاً بذاته.
   * @param {{ title: string, text: string, scope: string, proposer: string }} draft
   * @returns {Readonly<Law>}
   */
  propose({ title, text, scope, proposer }) {
    if (!title || !text || !scope || !proposer) throw new Error('LAW_REQUIRED');
    const id = 'law:' + randomUUID();
    /** @type {Law} */
    const l = {
      id,
      title,
      text,
      scope,
      proposer,
      state: LawState.DRAFT,
      version: 1,
      createdAt: new Date().toISOString(),
    };
    this.laws.set(id, l);
    this.log.append('law.proposed', proposer, { id, title, scope });
    return Object.freeze({ ...l });
  }
  /**
   * ينقل قانوناً إلى حالة أخرى. الإنفاذ حصر على التاج، والملغى لا يُعاد فتحه.
   * @param {string} id
   * @param {LawStateValue} state - الحالة المطلوبة
   * @param {string} actor - من يطلب الانتقال؛ الإنفاذ يشترط 'crown'
   * @returns {Readonly<Law>}
   */
  transition(id, state, actor) {
    const l = this.laws.get(id);
    if (!l) throw new Error('LAW_NOT_FOUND');
    if (!Object.values(LawState).includes(state)) throw new Error('INVALID_LAW_STATE');
    if (l.state === LawState.REPEALED) throw new Error('REPEALED_LAW_IMMUTABLE');
    if (state === LawState.ENACTED && actor !== 'crown') throw new Error('CROWN_APPROVAL_REQUIRED');
    l.state = state;
    l.version++;
    l.changedAt = new Date().toISOString();
    this.log.append(`law.${state}`, actor, { id, version: l.version });
    return Object.freeze({ ...l });
  }
  /**
   * القوانين المُنفَّذة السارية على نطاق معيّن، بما فيها ما نطاقه 'all'.
   * @param {string} scope
   * @returns {Array<Readonly<Law>>}
   */
  active(scope) {
    return [...this.laws.values()]
      .filter((x) => x.state === LawState.ENACTED && (x.scope === scope || x.scope === 'all'))
      .map((x) => Object.freeze({ ...x }));
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
    return Object.freeze({ ...c });
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
    return Object.freeze({ ...c });
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
    return Object.freeze({ ...c });
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
    return Object.freeze({ ...c });
  }
}
