import test from 'node:test';
import assert from 'node:assert/strict';
import { EventLog } from '../../src/root-of-trust/index.mjs';
import { LawRegistry, LawState } from '../../src/governance/index.mjs';
import { createMemoryRepository } from '../../src/persistence/repository-memory.mjs';

/** @returns {LawRegistry} */
function registry(log = new EventLog()) {
  return new LawRegistry({ log, repository: createMemoryRepository(LawRegistry.spec) });
}

/**
 * يُنفِّذ قانوناً في المستودع مباشرةً مع ربطِه بمادةٍ وسياسة. الربطُ شرطُ نفاذٍ
 * بعد `M8.02` (ثابتُ `LAW_ENACTED_REQUIRES_BINDING` وقيدُ الهجرة 0011)، والمسارُ
 * السياديُّ الكاملُ (أمرٌ ملكيٌّ وكشفُ تعارض) يُختبر في `tests/legislation/`.
 * هنا يُكتفى بحالةٍ نافذةٍ صحيحةٍ كي تُختبر ما بعدها من انتقالات.
 * @param {LawRegistry} r
 * @param {string} id
 * @returns {Promise<Record<string, unknown>>}
 */
async function bind(r, id) {
  const row = await r.repository.findById(id);
  if (row === null) throw new Error('LAW_NOT_FOUND');
  return r.repository.update(id, Number(row['version']), {
    state: LawState.ENACTED,
    articleId: 'art:05',
    policyIds: ['pol:test'],
    enactedBy: 'crown',
    enactedAt: new Date(),
    stateChangedAt: new Date(),
  });
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
  // بعد `M8.02` لم يبقَ النفاذُ انتقالَ حالة: حتى مع كتابة الحرف «crown» يُردّ
  // الانتقالُ إلى `enacted` بلا ربطٍ بمادةٍ وسياسة، والطريقُ `Legislature.enact`.
  await assert.rejects(
    () => r.transition(l.id, LawState.ENACTED, 'crown'),
    /LAW_ENACTMENT_PATH_REQUIRED/,
  );
  const e = await bind(r, l.id);
  assert.equal(e['state'], LawState.ENACTED);
  // النسخة أثرٌ لا وصف: الاقتراح ثم انتقالان يعنيان ثلاث كتابات.
  assert.equal(e['version'], 3);
  assert.equal(e['enactedBy'], 'crown');
  assert.ok(e['enactedAt'] instanceof Date, 'النفاذ فعلٌ مؤرَّخ');
  assert.equal((await r.active('operations')).length, 1);
});

test('repealed law cannot be changed', async () => {
  const r = registry(),
    l = await r.propose({ title: 'x', text: 'x', scope: 'x', proposer: 'council' });
  // الإلغاء لا يقع على ما لم يَنفُذ: هذا تضييق `M3.05` وقيدٌ في القاعدة معاً.
  await assert.rejects(() => r.transition(l.id, LawState.REPEALED, 'crown'), /LAW_NOT_ENACTED_YET/);
  await bind(r, l.id);
  const repealed = await r.transition(l.id, LawState.REPEALED, 'crown');
  assert.ok(repealed.repealedAt instanceof Date, 'الإلغاء يُؤرَّخ');
  await assert.rejects(
    () => r.transition(l.id, LawState.ENACTED, 'crown'),
    /REPEALED_LAW_IMMUTABLE/,
  );
  assert.equal((await r.active('x')).length, 0);
});
