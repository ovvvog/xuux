import test from 'node:test';
import assert from 'node:assert/strict';
import { EventLog } from '../../src/root-of-trust/index.mjs';
import { LawRegistry, Court, LawState, CaseState } from '../../src/governance/index.mjs';
import { createMemoryRepository } from '../../src/persistence/repository-memory.mjs';

/** @returns {LawRegistry} */
function registry(log = new EventLog()) {
  return new LawRegistry({ log, repository: createMemoryRepository(LawRegistry.spec) });
}

test('law requires crown for enactment and is versioned', async () => {
  const r = registry(),
    l = await r.propose({
      title: 'safe operation',
      text: 'stop on uncertainty',
      scope: 'operations',
      proposer: 'council',
    });
  assert.equal(l.state, LawState.DRAFT);
  assert.equal(l.version, 1);
  await r.transition(l.id, LawState.PROPOSED, 'council');
  await assert.rejects(
    () => r.transition(l.id, LawState.ENACTED, 'ministry'),
    /CROWN_APPROVAL_REQUIRED/,
  );
  const e = await r.transition(l.id, LawState.ENACTED, 'crown');
  assert.equal(e.state, LawState.ENACTED);
  // النسخة أثرٌ لا وصف: الاقتراح ثم انتقالان يعنيان ثلاث كتابات.
  assert.equal(e.version, 3);
  assert.equal(e.enactedBy, 'crown');
  assert.ok(e.enactedAt instanceof Date, 'النفاذ فعلٌ مؤرَّخ');
  assert.equal((await r.active('operations')).length, 1);
});

test('court enforces hearing before judgment and supports appeal', async () => {
  const log = new EventLog(),
    laws = registry(log),
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

test('repealed law cannot be changed', async () => {
  const r = registry(),
    l = await r.propose({ title: 'x', text: 'x', scope: 'x', proposer: 'council' });
  // الإلغاء لا يقع على ما لم يَنفُذ: هذا تضييق `M3.05` وقيدٌ في القاعدة معاً.
  await assert.rejects(() => r.transition(l.id, LawState.REPEALED, 'crown'), /LAW_NOT_ENACTED_YET/);
  await r.transition(l.id, LawState.ENACTED, 'crown');
  const repealed = await r.transition(l.id, LawState.REPEALED, 'crown');
  assert.ok(repealed.repealedAt instanceof Date, 'الإلغاء يُؤرَّخ');
  await assert.rejects(
    () => r.transition(l.id, LawState.ENACTED, 'crown'),
    /REPEALED_LAW_IMMUTABLE/,
  );
  assert.equal((await r.active('x')).length, 0);
});
