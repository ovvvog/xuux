import { randomUUID } from 'node:crypto';
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
  constructor({ log } = {}) {
    if (!log) throw new Error('LAW_LOG_REQUIRED');
    this.log = log;
    this.laws = new Map();
  }
  propose({ title, text, scope, proposer }) {
    if (!title || !text || !scope || !proposer) throw new Error('LAW_REQUIRED');
    const id = 'law:' + randomUUID();
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
  active(scope) {
    return [...this.laws.values()]
      .filter((x) => x.state === LawState.ENACTED && (x.scope === scope || x.scope === 'all'))
      .map((x) => Object.freeze({ ...x }));
  }
}
export class Court {
  constructor({ log, laws } = {}) {
    if (!log || !laws) throw new Error('COURT_DEPENDENCY_MISSING');
    this.log = log;
    this.laws = laws;
    this.cases = new Map();
  }
  file({ claimant, respondent, claim, evidence = [] }) {
    if (!claimant || !respondent || !claim) throw new Error('CASE_REQUIRED');
    const id = 'case:' + randomUUID();
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
  hear(id, actor = 'court') {
    const c = this.cases.get(id);
    if (!c) throw new Error('CASE_NOT_FOUND');
    if (c.state !== CaseState.OPEN) throw new Error('CASE_NOT_OPEN');
    c.state = CaseState.HEARD;
    c.heardBy = actor;
    this.log.append('court.case.heard', actor, { id });
    return Object.freeze({ ...c });
  }
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
  appeal(id, reason, actor) {
    const c = this.cases.get(id);
    if (!c || c.state !== CaseState.DECIDED) throw new Error('CASE_NOT_APPEALABLE');
    c.state = CaseState.APPEALED;
    c.appeal = { reason, actor, at: new Date().toISOString() };
    this.log.append('court.case.appealed', actor, { id });
    return Object.freeze({ ...c });
  }
}
