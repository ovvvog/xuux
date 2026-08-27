// اختبارات فصل المصالح والمراجعة البشرية (M8.04).
//
// معيارُ القبول المُعلَن في خارطة الطريق: «تعارضُ مصالحَ يمنع الفصلَ تلقائياً».
// و«تلقائياً» هي كلمةُ المعيار: لا يُطلب من المستدعي أن يُعلن التعارضَ ولا أن
// يستدعي فاحصاً، بل يُرفض السماعُ والحكمُ من داخل المحكمة نفسِها. ولذلك تُقاس
// هنا ثلاثةُ أشياءَ لا شيءٌ واحد:
//
//   • أنّ التعارضَ **مقروءٌ من البيانات**: تُسجَّل هويةٌ مالكُها القاضي فيُرفض
//     السماع، وتُسجَّل هويةٌ مالكُها غيرُه فيُقبل — فالضابطُ قابلٌ للتزييف لا
//     مُعلَنٌ في وثيقة.
//   • أنّ الرفضَ **يقول بأيِّ قاعدةٍ** رُفض: حادثةُ `court.conflict.detected`
//     تحمل معرّفَ القاعدة، فالتدقيقُ يعرف السببَ لا مجردَ الامتناع.
//   • أنّ الحكمَ الحسّاس **لا يُنفَّذ بلا مراجعةٍ بشرية**، وأنّ بشريةَ المراجع
//     تُقرأ من سجلِّ الهويات لا تُقبل بالاسم.
//
// **حدٌّ معلَن:** قاعدةُ `self-review-after-appeal` مقيسةٌ هنا على الدالّة
// المُصدَّرة لا على مسار المحكمة، لأنّ مسارَ «إعادةِ النظر بعد الاستئناف» غيرُ
// مُنشأٍ بعد: `hear` تشترط الحالة `opened` و`judge` تشترط `heard`، والقضيةُ بعد
// الاستئناف حالتُها `appealed`. فالقاعدةُ اليومَ حاجزٌ جاهزٌ لمسارٍ قادم، وهذا
// مسجَّلٌ في `docs/REMAINING_WORK.md` لا مُدَّعىً هنا خلافُه.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CONFLICT_RULES,
  JUDICIARY_ERRORS,
  Judiciary,
  SOVEREIGN_OWNER,
  executorIndex,
  screenJudicialInterest,
} from '../../src/judiciary/index.mjs';
import {
  CLAIM,
  POLICY,
  REASON,
  REVIEW_REASON,
  REVIEWER_ROLE,
  agentId,
  field,
  command,
  enactedLaw,
  humanReviewer,
  judged,
  state,
} from './harness.mjs';

/** @type {WeakMap<object, string>} */
const LAWS = new WeakMap();

const RECUSAL_REASON = 'ح'.repeat(POLICY.procedure.minRecusalReasonLength);

/** @param {unknown} error @param {string} code */
const hasCode = (error, code) => /** @type {Error & { code?: string }} */ (error).code === code;

/**
 * قضيةٌ مفتوحةٌ على قانونٍ نافذٍ فعلاً، ومالكُ هويةِ المدّعى عليه معلومٌ للمستدعي.
 * @param {ReturnType<typeof state>} s
 * @param {{ id?: string, respondentOwner?: string }} [options]
 */
async function filed(s, { id = 'case:0001', respondentOwner = SOVEREIGN_OWNER } = {}) {
  // **قانونٌ واحدٌ لكلِّ دولةٍ مصغَّرة:** السلطةُ التشريعية ترفض نفاذَ قانونٍ ثانٍ
  // يشترك مع الأول في السياسةِ نفسِها (`LEGISLATION_CONFLICT_SHARED_POLICY` من
  // الخطوة M8.02)، فالقضايا المتعددةُ في اختبارٍ واحدٍ تقوم على قانونٍ نافذٍ واحد.
  const lawId = LAWS.get(s) ?? (await enactedLaw(s));
  LAWS.set(s, lawId);
  const respondentAgent = await s.agents.register({
    name: `وكيلُ المدّعى عليه ${id}`,
    role: 'role:operator',
    owner: respondentOwner,
  });
  const claimant = await agentId(s.agents, `وكيلُ المدّعي ${id}`);
  await s.judiciary.file({
    id,
    lawId,
    claimant,
    respondent: respondentAgent.id,
    claim: CLAIM,
  });
  return { caseId: id, lawId, claimant, respondent: respondentAgent.id };
}

/** @param {ReturnType<typeof state>['log']} log */
const conflicts = (log) =>
  log.snapshot().filter((entry) => entry.type === 'court.conflict.detected');

// ═══════════════════════════════════════════════════════════════════════════
// ١. معيارُ القبول: تعارضُ مصالحَ يمنع الفصلَ تلقائياً.
// ═══════════════════════════════════════════════════════════════════════════

test('تعارضُ مصالحَ يمنع الفصلَ تلقائياً: مالكُ هويةِ الخصم لا يسمع ولا يحكم', async () => {
  const s = state();
  const judge = 'role:chief-justice';

  // القاضي مالكُ هويةِ المدّعى عليه — ملكيةٌ واقعةٌ في `state.agents` لا إعلان.
  const owned = await filed(s, { id: 'case:owned', respondentOwner: judge });
  await assert.rejects(
    () => s.judiciary.hear({ caseId: owned.caseId, judge }),
    (error) => hasCode(error, JUDICIARY_ERRORS.CONFLICT_OF_INTEREST),
  );

  // والرفضُ يقول بأيِّ قاعدةٍ رُفض، فالتدقيقُ يقرأ السببَ لا الامتناعَ وحده.
  const [detected] = conflicts(s.log);
  assert.equal(field(detected?.data, 'rule'), 'judge-owns-party');
  assert.equal(field(detected?.data, 'id'), owned.caseId);
  assert.ok(CONFLICT_RULES.some((rule) => rule.id === field(detected?.data, 'rule')));

  // والقضيةُ لم تُسمَع: الرفضُ منعَ الفصلَ ولم يُسجّل قاضياً ثم يعتذر.
  const row = await s.judiciary.caseOf(owned.caseId);
  assert.equal(row['state'], 'opened');
  assert.equal(row['judge'], null);

  // **والتزييف:** القضيةُ نفسُها بمالكٍ سياديٍّ تُسمَع — فالضابطُ يقيس الملكيةَ
  // لا يرفض كلَّ سماع.
  const clean = await filed(s, { id: 'case:clean' });
  const heard = await s.judiciary.hear({ caseId: clean.caseId, judge });
  assert.equal(heard['judge'], judge);
});

test('القاضي هويةٌ يملكها خصمٌ، أو يشترك معه في مالكٍ واحد: كلاهما يمنع الفصل', async () => {
  const s = state();

  // (أ) `party-owns-judge`: القاضي هويةٌ مالكُها المدّعي.
  const first = await filed(s, { id: 'case:owns-judge' });
  const puppet = await s.agents.register({
    name: 'قاضٍ مملوكٌ للمدّعي',
    role: 'role:chief-justice',
    owner: first.claimant,
  });
  await assert.rejects(
    () => s.judiciary.hear({ caseId: first.caseId, judge: puppet.id }),
    (error) => hasCode(error, JUDICIARY_ERRORS.CONFLICT_OF_INTEREST),
  );
  assert.equal(field(conflicts(s.log).at(-1)?.data, 'rule'), 'party-owns-judge');

  // (ب) `shared-owner`: القاضي والخصمُ هويتان لمالكٍ واحدٍ غيرِ سياديّ.
  const second = await filed(s, { id: 'case:shared', respondentOwner: 'role:minister' });
  const sibling = await s.agents.register({
    name: 'قاضٍ لمالكِ الخصم',
    role: 'role:chief-justice',
    owner: 'role:minister',
  });
  await assert.rejects(
    () => s.judiciary.hear({ caseId: second.caseId, judge: sibling.id }),
    (error) => hasCode(error, JUDICIARY_ERRORS.CONFLICT_OF_INTEREST),
  );
  assert.equal(field(conflicts(s.log).at(-1)?.data, 'rule'), 'shared-owner');

  // **والتزييف:** المالكُ السياديُّ مشتركٌ بين كلِّ هويةٍ تُسجَّل بلا مالكٍ
  // مصرَّح، وهو مستثنىً بحدٍّ معلَنٍ في `interests.mjs`. فقاضٍ هويتُه سياديةٌ
  // وخصمٌ هويتُه سياديةٌ يُسمَع بينهما — ولو لم يُستثنَ لتعطّل الفحصُ كلُّه.
  const third = await filed(s, { id: 'case:sovereign' });
  const crownJudge = await s.agents.register({ name: 'قاضٍ سياديّ', role: 'role:chief-justice' });
  assert.equal(crownJudge.owner, SOVEREIGN_OWNER);
  const heard = await s.judiciary.hear({ caseId: third.caseId, judge: crownJudge.id });
  assert.equal(heard['judge'], crownJudge.id);
});

test('فحصٌ لازمٌ بلا سجلِّ هوياتٍ يرفض ولا يفترض نجاحَه', async () => {
  const s = state();
  const { caseId } = await filed(s, { id: 'case:blind' });

  // قضاءٌ مُركَّبٌ بلا سجلِّ هويات: الفحصُ لازمٌ في الوثيقة ولا سبيلَ إلى إجرائه.
  const blind = new Judiciary({
    policy: POLICY,
    laws: s.laws,
    log: s.log,
    repository: s.judiciary.repository,
    crown: s.gateway,
    executors: executorIndex([]),
    agents: null,
  });
  assert.equal(POLICY.procedure.requireInterestScreening, true);
  await assert.rejects(
    () => blind.hear({ caseId, judge: 'role:chief-justice' }),
    (error) => hasCode(error, JUDICIARY_ERRORS.INTEREST_SCREENING_UNAVAILABLE),
  );
});

// ═══════════════════════════════════════════════════════════════════════════
// ٢. التنحّي: قيدٌ دائمٌ لا إعلانٌ يُرفع بالنداء التالي.
// ═══════════════════════════════════════════════════════════════════════════

test('التنحّي يُعيد القضيةَ مفتوحةً ويمنع عودةَ المتنحّي أبداً', async () => {
  const s = state();
  const judge = 'role:chief-justice';
  const { caseId } = await filed(s, { id: 'case:recusal' });
  await s.judiciary.hear({ caseId, judge });

  // لا يتنحّى من لم يجلس، ولا تنحٍّ بسببٍ أقصرَ من الحدِّ المُعلَن.
  await assert.rejects(
    () => s.judiciary.recuse({ caseId, judge: 'role:justice', reason: RECUSAL_REASON }),
    (error) => hasCode(error, JUDICIARY_ERRORS.RECUSAL_NOT_PERMITTED),
  );
  await assert.rejects(
    () => s.judiciary.recuse({ caseId, judge, reason: 'قصير' }),
    (error) => hasCode(error, JUDICIARY_ERRORS.REASON_REQUIRED),
  );

  const recused = await s.judiciary.recuse({ caseId, judge, reason: RECUSAL_REASON });
  assert.equal(recused['state'], 'opened');
  assert.equal(recused['judge'], null);
  assert.equal(recused['heardAt'], null);
  assert.deepEqual(recused['recusedJudges'], [judge]);
  assert.equal(s.log.snapshot().filter((entry) => entry.type === 'court.judge.recused').length, 1);

  // والعودةُ ممنوعةٌ: تنحٍّ يُرفع بنداءٍ تالٍ تنحٍّ بالاسم فقط.
  await assert.rejects(
    () => s.judiciary.hear({ caseId, judge }),
    (error) => hasCode(error, JUDICIARY_ERRORS.JUDGE_RECUSED),
  );
  assert.equal(field(conflicts(s.log).at(-1)?.data, 'rule'), 'recused');

  // وغيرُه يسمع فعلاً: التنحّي لا يُقفل القضية.
  const heard = await s.judiciary.hear({ caseId, judge: 'role:justice' });
  assert.equal(heard['judge'], 'role:justice');
});

test('لا تنحٍّ بعد الحكم: من حكم يُسأل عن حكمِه ولا يمحو نفسَه من الصف', async () => {
  const s = state();
  const { caseId } = await judged(s, { review: false });
  await assert.rejects(
    () => s.judiciary.recuse({ caseId, judge: 'role:chief-justice', reason: RECUSAL_REASON }),
    (error) => hasCode(error, JUDICIARY_ERRORS.RECUSAL_NOT_PERMITTED),
  );
});

// ═══════════════════════════════════════════════════════════════════════════
// ٣. المراجعةُ البشرية: حكمٌ حسّاسٌ لا يُنفَّذ بلا قارئٍ بشريٍّ يُسأل عنه.
// ═══════════════════════════════════════════════════════════════════════════

test('حكمٌ حسّاسٌ لا يُنفَّذ بلا مراجعةٍ بشرية، ويُنفَّذ بعدها', async () => {
  const s = state();
  const { caseId, respondent } = await judged(s, { review: false });
  const effect = 'suspend-respondent-agent';

  // المنطوقُ `guilty` والأثرُ `suspend-respondent-agent` كلاهما مُعلَنٌ حسّاساً.
  assert.ok(POLICY.review.sensitiveOutcomes.includes('guilty'));
  assert.equal(s.judiciary.isSensitive(await s.judiciary.caseOf(caseId), effect), true);

  await assert.rejects(
    () =>
      s.judiciary.execute({
        caseId,
        effect,
        ...command(s.king, POLICY.procedure.executeAction, caseId),
      }),
    (error) => hasCode(error, JUDICIARY_ERRORS.HUMAN_REVIEW_REQUIRED),
  );

  // والامتناعُ حادثةٌ مُدقَّقةٌ لا صمت.
  assert.ok(
    s.log
      .snapshot()
      .some(
        (entry) =>
          entry.type === 'court.judgment.refused' &&
          field(entry.data, 'reason') === JUDICIARY_ERRORS.HUMAN_REVIEW_REQUIRED,
      ),
  );

  // والهويةُ لم تُمسّ: الرفضُ منعَ الأثرَ لا سجّله ثم اعتذر.
  assert.equal((await s.agents.get(respondent))?.state, 'active');

  // ثم يُراجع بشرٌ فيُنفَّذ، والأثرُ يُقاس على السجل لا على قولِ المحكمة.
  const reviewer = await humanReviewer(s);
  const ratified = await s.judiciary.ratify({
    caseId,
    reviewer,
    decision: 'approved',
    reason: REVIEW_REASON,
  });
  assert.equal(ratified['reviewDecision'], 'approved');
  assert.equal(ratified['reviewer'], reviewer);
  assert.ok(ratified['reviewedAt'] instanceof Date);
  await s.judiciary.execute({
    caseId,
    effect,
    ...command(s.king, POLICY.procedure.executeAction, caseId),
  });
  assert.equal((await s.agents.get(respondent))?.state, 'suspended');
});

test('مراجعةٌ مرفوضةٌ تمنع التنفيذ، ولا تُعاد المراجعةُ حتى تُقبل', async () => {
  const s = state();
  const { caseId, respondent } = await judged(s, { review: false });
  const reviewer = await humanReviewer(s);
  await s.judiciary.ratify({
    caseId,
    reviewer,
    decision: 'rejected',
    reason: REVIEW_REASON,
  });

  await assert.rejects(
    () =>
      s.judiciary.execute({
        caseId,
        effect: 'suspend-respondent-agent',
        ...command(s.king, POLICY.procedure.executeAction, caseId),
      }),
    (error) => hasCode(error, JUDICIARY_ERRORS.REVIEW_REJECTED),
  );
  assert.equal((await s.agents.get(respondent))?.state, 'active');

  // ومراجعةٌ ثانيةٌ تُقلب بها الأولى ليست مراجعة.
  const other = await humanReviewer(s);
  await assert.rejects(
    () =>
      s.judiciary.ratify({ caseId, reviewer: other, decision: 'approved', reason: REVIEW_REASON }),
    (error) => hasCode(error, JUDICIARY_ERRORS.REVIEW_NOT_PERMITTED),
  );
});

test('بشريةُ المراجع تُقرأ من السجل: وكيلٌ أو موقوفٌ أو غيرُ مسجلٍ يُرفض', async () => {
  const s = state();
  const { caseId } = await judged(s, { review: false });

  // (أ) غيرُ مسجّل.
  await assert.rejects(
    () =>
      s.judiciary.ratify({
        caseId,
        reviewer: 'agent:ghost',
        decision: 'approved',
        reason: REVIEW_REASON,
      }),
    (error) => hasCode(error, JUDICIARY_ERRORS.REVIEWER_NOT_HUMAN),
  );

  // (ب) مسجَّلٌ نوعُه `autonomous` ولو كان دورُه دورَ المراجعة.
  const machine = await s.agents.register({
    name: 'مراجعٌ آليّ',
    role: REVIEWER_ROLE,
    kind: 'autonomous',
  });
  await assert.rejects(
    () =>
      s.judiciary.ratify({
        caseId,
        reviewer: machine.id,
        decision: 'approved',
        reason: REVIEW_REASON,
      }),
    (error) => hasCode(error, JUDICIARY_ERRORS.REVIEWER_NOT_HUMAN),
  );

  // (ج) بشريٌّ حالُه غيرُ `active`: هويةٌ موقوفةٌ لا تملك إذناً تمنحه.
  const idle = await s.agents.register({
    name: 'مراجعٌ بشريٌّ موقوف',
    role: REVIEWER_ROLE,
    kind: 'human',
  });
  await s.agents.transition(idle.id, 'suspended', 'إيقافٌ إداريٌّ يسبق المراجعة');
  await assert.rejects(
    () =>
      s.judiciary.ratify({
        caseId,
        reviewer: idle.id,
        decision: 'approved',
        reason: REVIEW_REASON,
      }),
    (error) => hasCode(error, JUDICIARY_ERRORS.REVIEWER_NOT_HUMAN),
  );

  // (د) بشريٌّ نشطٌ لكن دورَه ليس من حاملي سلطة المراجعة.
  const outsider = await s.agents.register({
    name: 'بشريٌّ بلا سلطةِ مراجعة',
    role: 'role:operator',
    kind: 'human',
  });
  await assert.rejects(
    () =>
      s.judiciary.ratify({
        caseId,
        reviewer: outsider.id,
        decision: 'approved',
        reason: REVIEW_REASON,
      }),
    (error) => hasCode(error, JUDICIARY_ERRORS.REVIEW_NOT_PERMITTED),
  );

  // (هـ) وقرارٌ غيرُ مُعلَنٍ يُرفض ولو كان المراجعُ بشراً مؤهَّلاً، وسببٌ أقصرُ
  //      من الحدِّ يُرفض: مراجعةٌ بلا سببٍ مكتوبٍ لا يُراجَع عليها شيء.
  const human = await humanReviewer(s);
  await assert.rejects(
    () => s.judiciary.ratify({ caseId, reviewer: human, decision: 'maybe', reason: REVIEW_REASON }),
    (error) => hasCode(error, JUDICIARY_ERRORS.REVIEW_NOT_PERMITTED),
  );
  await assert.rejects(
    () => s.judiciary.ratify({ caseId, reviewer: human, decision: 'approved', reason: 'قصير' }),
    (error) => hasCode(error, JUDICIARY_ERRORS.REASON_REQUIRED),
  );
});

test('لا يُراجع أحدٌ عملَ نفسه، ولا يُراجع مالكُ هويةِ خصمٍ حكماً عليها', async () => {
  const s = state();
  const judge = 'role:chief-justice';

  // (أ) بشريٌّ مؤهَّلٌ جلس وحكم: لا يُراجع حكمَ نفسه.
  const dual = await s.agents.register({
    name: 'بشريٌّ يجلس ويراجع',
    role: REVIEWER_ROLE,
    kind: 'human',
  });
  const first = await filed(s, { id: 'case:self-review' });
  await s.judiciary.hear({ caseId: first.caseId, judge: dual.id });
  await s.judiciary.judge({
    caseId: first.caseId,
    verdict: 'guilty',
    reason: REASON,
    judge: dual.id,
  });
  await assert.rejects(
    () =>
      s.judiciary.ratify({
        caseId: first.caseId,
        reviewer: dual.id,
        decision: 'approved',
        reason: REVIEW_REASON,
      }),
    (error) => hasCode(error, JUDICIARY_ERRORS.REVIEW_NOT_PERMITTED),
  );

  // (ب) مراجعٌ مالكُ هويةِ المدّعى عليه: قواعدُ فحص المصالح نفسُها تسري عليه،
  //     فالإذنُ بتنفيذ حكمٍ على هويةٍ يملكها إذنٌ لنفسه.
  const owner = await s.agents.register({
    name: 'مراجعٌ مالكُ هويةِ خصم',
    role: REVIEWER_ROLE,
    kind: 'human',
  });
  const second = await filed(s, { id: 'case:reviewer-owns', respondentOwner: owner.id });
  await s.judiciary.hear({ caseId: second.caseId, judge });
  await s.judiciary.judge({
    caseId: second.caseId,
    verdict: 'guilty',
    reason: REASON,
    judge,
  });
  await assert.rejects(
    () =>
      s.judiciary.ratify({
        caseId: second.caseId,
        reviewer: owner.id,
        decision: 'approved',
        reason: REVIEW_REASON,
      }),
    (error) => hasCode(error, JUDICIARY_ERRORS.CONFLICT_OF_INTEREST),
  );
  assert.equal(field(conflicts(s.log).at(-1)?.data, 'rule'), 'judge-owns-party');

  // **والتزييف:** مراجعٌ بشريٌّ مؤهَّلٌ لا يملك شيئاً يُقبل على القضية نفسِها.
  const clean = await humanReviewer(s);
  const ratified = await s.judiciary.ratify({
    caseId: second.caseId,
    reviewer: clean,
    decision: 'approved',
    reason: REVIEW_REASON,
  });
  assert.equal(ratified['reviewer'], clean);
});

// ═══════════════════════════════════════════════════════════════════════════
// ٤. القاعدةُ الجاهزةُ لمسارٍ قادم: مقيسةٌ على الدالّة، ومسجَّلٌ حدُّها.
// ═══════════════════════════════════════════════════════════════════════════

test('قاعدةُ لا مراجعةَ للنفس بعد الاستئناف مقيسةٌ على الدالّة المُصدَّرة', async () => {
  const agents = { get: async () => null };
  const finding = await screenJudicialInterest({
    judge: 'role:chief-justice',
    row: {
      id: 'case:appealed',
      claimant: 'agent:a',
      respondent: 'agent:b',
      judge: 'role:chief-justice',
      appealedAt: new Date(),
    },
    agents,
    required: true,
  });
  assert.equal(finding?.rule, 'self-review-after-appeal');

  // وبلا استئنافٍ لا قاعدةَ: الحاجزُ يقيس واقعةً لا يرفض دائماً.
  const clean = await screenJudicialInterest({
    judge: 'role:chief-justice',
    row: { id: 'case:open', claimant: 'agent:a', respondent: 'agent:b', judge: null },
    agents,
    required: true,
  });
  assert.equal(clean, null);
});
