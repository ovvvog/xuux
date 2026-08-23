import test from 'node:test';
import assert from 'node:assert/strict';
import { EventLog } from '../../src/root-of-trust/index.mjs';
import { LawRegistry, Court, LawState, CaseState } from '../../src/governance/index.mjs';
test('law requires crown for enactment and is versioned', () => {
  const r = new LawRegistry({ log: new EventLog() }),
    l = r.propose({
      title: 'safe operation',
      text: 'stop on uncertainty',
      scope: 'operations',
      proposer: 'council',
    });
  assert.equal(l.state, LawState.DRAFT);
  r.transition(l.id, LawState.PROPOSED, 'council');
  assert.throws(() => r.transition(l.id, LawState.ENACTED, 'ministry'), /CROWN_APPROVAL_REQUIRED/);
  const e = r.transition(l.id, LawState.ENACTED, 'crown');
  assert.equal(e.state, LawState.ENACTED);
  assert.equal(r.active('operations').length, 1);
});
test('court enforces hearing before judgment and supports appeal', () => {
  const log = new EventLog(),
    laws = new LawRegistry({ log }),
    court = new Court({ log, laws }),
    c = court.file({
      claimant: 'agent:a',
      respondent: 'institution:x',
      claim: 'boundary violation',
      evidence: ['event:1'],
    });
  assert.throws(
    () => court.decide(c.id, { outcome: 'upheld', reason: 'evidence' }, 'crown'),
    /CASE_NOT_HEARD/,
  );
  court.hear(c.id);
  const d = court.decide(c.id, { outcome: 'upheld', reason: 'evidence' }, 'crown');
  assert.equal(d.state, CaseState.DECIDED);
  assert.equal(court.appeal(c.id, 'new evidence', 'agent:a').state, CaseState.APPEALED);
});
test('repealed law cannot be changed', () => {
  const r = new LawRegistry({ log: new EventLog() }),
    l = r.propose({ title: 'x', text: 'x', scope: 'x', proposer: 'council' });
  r.transition(l.id, LawState.REPEALED, 'crown');
  assert.throws(() => r.transition(l.id, LawState.ENACTED, 'crown'), /REPEALED_LAW_IMMUTABLE/);
});
