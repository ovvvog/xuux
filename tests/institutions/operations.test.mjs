// اختبارُ قبولِ الخطوة M8.05: **دورةُ تشغيلٍ كاملةٌ موثَّقةٌ لكلٍّ من مؤسستين**.
//
// وما يُقاس هنا خمسةُ شروطٍ لا واحد: أنّ المؤسسةَ تُؤسَّس بمُخصَّصٍ من العهد لا
// من المستدعي، وأنّها **تستقبل** مهمّةً من نوعٍ مُعلَن، وأنّها **تُنفِّذها بوكيلٍ**
// نشطٍ مؤهَّلٍ مقروءٍ من سجلِّ الهويات، وأنّها **تستهلك ميزانيةً** تُقاس ويُرفض ما
// بعد نفادها، وأنّها **تُنتج تقريراً** مُشتقّاً من الصفوف لا نصّاً محفوظاً.
//
// والقياسُ في كل موضعٍ على **الحالة المحفوظة** لا على قيمةٍ يُعيدها النداء: قيمةٌ
// راجعةٌ تشهد لنفسها، والصفُّ في المستودع يشهد على ما بقي بعد النداء.

import assert from 'node:assert/strict';
import test from 'node:test';
import { INSTITUTION_ERRORS } from '../../src/institutions/index.mjs';
import {
  OPERATOR,
  POLICY,
  REPORTER,
  SUBMITTER,
  agentWithRole,
  domainFor,
  eligibleRole,
  establish,
  field,
  firstTaskKind,
  mandatesWithCeilingAtAllocation,
  pilot,
  ranTask,
  state,
  subjectFor,
} from './harness.mjs';

/** المؤسستان التجريبيتان مقروءتان من العهد لا مكتوبتان حرفاً في الاختبار. */
const KEYS = POLICY.pilots.map((entry) => entry.key);

test('العهدُ يُعلن مؤسستين تجريبيتين على الأقل، وإلا فلا شيءَ يُقاس في هذه الخطوة', () => {
  assert.ok(KEYS.length >= 2, `العهد يُعلن ${KEYS.length} مؤسسةً فقط`);
});

for (const key of KEYS) {
  test(`دورةُ تشغيلٍ كاملةٌ للمؤسسة ${key}: استقبالٌ فإسنادٌ فتنفيذٌ باستهلاكِ ميزانيةٍ فتقرير`, async () => {
    const s = state();
    const declared = pilot(key);
    const commissioned = await establish(s, key);

    // ١. المُخصَّصُ من العهد، والمقيَّدُ صفرٌ عند التأسيس.
    assert.equal(field(commissioned, 'budgetAllocated'), declared.budget.allocation);
    assert.equal(field(commissioned, 'budgetConsumed'), 0);
    assert.equal(field(commissioned, 'seedId'), declared.seedId);

    // ٢. الاستقبالُ يُحفظ صفّاً بحالة «مُستقبَلة» بلا وكيلٍ ولا تنفيذ.
    const kind = firstTaskKind(key);
    const taskId = `task:${key}:1`;
    await s.ops.submit({
      id: taskId,
      institutionKey: key,
      kind: kind.kind,
      domain: domainFor(key, kind.kind),
      subject: subjectFor(kind.kind),
      submittedBy: SUBMITTER,
      actorRole: SUBMITTER,
    });
    const received = await s.tasks.findById(taskId);
    assert.equal(field(received, 'state'), 'received');
    assert.equal(field(received, 'agentId'), null);
    assert.equal(field(received, 'budgetCost'), kind.cost);

    // ٣. الإسنادُ إلى وكيلٍ **مسجَّلٍ نشطٍ** دورُه من أدوار المؤسسة.
    const agentId = await agentWithRole(s, eligibleRole(key));
    await s.ops.assign({ taskId, agentId, actorRole: OPERATOR });
    const assigned = await s.tasks.findById(taskId);
    assert.equal(field(assigned, 'state'), 'assigned');
    assert.equal(field(assigned, 'agentId'), agentId);
    assert.ok(field(assigned, 'assignedAt') instanceof Date);

    // ٤. التنفيذُ يستهلك الميزانيةَ **قبله**، ويُنتج مخرَجاً، ويُقاس أثرُه
    //    ببصمتين مختلفتين. والبصمتان تُقرآن من الصفِّ المحفوظ.
    const executed = await s.ops.execute({ taskId, actorRole: OPERATOR });
    assert.equal(field(executed, 'state'), 'executed');
    assert.equal(field(executed, 'effect'), kind.effect);
    assert.notEqual(field(executed, 'fingerprintBefore'), field(executed, 'fingerprintAfter'));
    const debitedAt = field(executed, 'budgetDebitedAt');
    const executedAt = field(executed, 'executedAt');
    assert.ok(debitedAt instanceof Date && executedAt instanceof Date);
    assert.ok(debitedAt.getTime() <= executedAt.getTime());

    // والمخرَجُ صفٌّ فعليٌّ منسوبٌ إلى المهمّة وإلى الوكيل.
    const outputId = String(field(executed, 'outputId'));
    const output = await s.outputs.findById(outputId);
    assert.notEqual(output, null);
    assert.equal(field(output, 'taskId'), taskId);
    assert.equal(field(output, 'producedBy'), agentId);

    // والميزانيةُ المستهلَكةُ مقروءةٌ من صفِّ المؤسسة لا من قيمةٍ راجعة.
    const afterOne = await s.institutions.findById(String(field(commissioned, 'id')));
    assert.equal(field(afterOne, 'budgetConsumed'), kind.cost);

    // ٥. التقريرُ **مُشتقٌّ** من الصفوف: عددُ المهام وحالاتُها وميزانيتُها.
    const report = await s.ops.report({ institutionKey: key, actorRole: REPORTER });
    assert.equal(report.tasks.total, 1);
    assert.equal(report.tasks.executed, 1);
    assert.equal(report.outputs.count, 1);
    assert.deepEqual([...report.outputs.ids], [outputId]);
    assert.equal(report.budget.allocated, declared.budget.allocation);
    assert.equal(report.budget.consumed, kind.cost);
    assert.equal(report.budget.remaining, declared.budget.allocation - kind.cost);

    // وحوادثُ الدورة كلُّها منشورةٌ في سجلٍّ سليمِ السلسلة: دورةٌ لا أثرَ لها في
    // السجل دورةٌ غيرُ موثَّقة، وهو نصُّ اختبار القبول حرفاً.
    assert.equal(s.log.verify(), true);
    assert.equal(s.log.verifyChain().ok, true);
    const types = s.log.snapshot().map((entry) => field(entry, 'type'));
    for (const expected of [
      'institutions.institution.commissioned',
      'institutions.task.received',
      'institutions.task.assigned',
      'institutions.budget.debited',
      'institutions.task.executed',
      'institutions.report.produced',
    ]) {
      assert.ok(types.includes(expected), `الحادثة ${expected} غائبةٌ عن السجل`);
    }
  });

  test(`ميزانيةُ المؤسسة ${key} تنفد فعلاً: ما بعد المُخصَّصِ يُرفض ولا مخرَجَ له`, async () => {
    // سقفُ المدّةِ يُرفع هنا إلى المُخصَّصِ الكلّي كي يقيس هذا الاختبارُ نفادَ
    // المُخصَّصِ نفسَه لا حدَّ المدّة؛ والسقفُ الزمنيُّ مقيسٌ في mandate.test.mjs.
    const s = state({ mandatesPolicy: mandatesWithCeilingAtAllocation() });
    const declared = pilot(key);
    const kind = firstTaskKind(key);
    const institution = await establish(s, key);
    // عددُ المهام التي يحملها المُخصَّصُ محسوبٌ من العهد لا مكتوبٌ رقماً: رقمٌ
    // مكتوبٌ يبقى أخضرَ بعد تغيُّرِ المُخصَّصِ أو الكلفة فيقيس ما لم يبقَ.
    const affordable = Math.floor(declared.budget.allocation / kind.cost);
    assert.ok(affordable >= 2, `المُخصَّص ${declared.budget.allocation} لا يحمل مهمّتين`);

    for (let index = 1; index <= affordable; index += 1) {
      await ranTask(s, { key, id: `task:${key}:${index}` });
    }
    const exhausted = await s.institutions.findById(String(field(institution, 'id')));
    assert.equal(field(exhausted, 'budgetConsumed'), affordable * kind.cost);

    const outputsBefore = await s.outputs.count({});
    const overId = `task:${key}:over`;
    await s.ops.submit({
      id: overId,
      institutionKey: key,
      kind: kind.kind,
      domain: domainFor(key, kind.kind),
      subject: subjectFor(kind.kind),
      submittedBy: SUBMITTER,
      actorRole: SUBMITTER,
    });
    const agentId = await agentWithRole(s, eligibleRole(key));
    await s.ops.assign({ taskId: overId, agentId, actorRole: OPERATOR });
    await assert.rejects(
      () => s.ops.execute({ taskId: overId, actorRole: OPERATOR }),
      (error) => field(error, 'code') === INSTITUTION_ERRORS.BUDGET_EXHAUSTED,
    );

    // والرفضُ **محفوظٌ** في الصفّ لا مرميٌّ وحده، ولا مخرَجَ زائدٌ، ولا قيدٌ زائد.
    const refused = await s.tasks.findById(overId);
    assert.equal(field(refused, 'state'), 'refused');
    assert.equal(field(refused, 'refusalCode'), INSTITUTION_ERRORS.BUDGET_EXHAUSTED);
    assert.equal(await s.outputs.count({}), outputsBefore);
    const unchanged = await s.institutions.findById(String(field(institution, 'id')));
    assert.equal(field(unchanged, 'budgetConsumed'), affordable * kind.cost);

    // والتقريرُ يقرأ الرفضَ رفضاً: مهمّةٌ رُفضت لا تُعدّ منفَّذةً ولا مُستقبَلةً.
    const report = await s.ops.report({ institutionKey: key, actorRole: REPORTER });
    assert.equal(report.tasks.total, affordable + 1);
    assert.equal(report.tasks.executed, affordable);
    assert.equal(report.tasks.refused, 1);
    assert.equal(report.budget.remaining, declared.budget.allocation - affordable * kind.cost);
    assert.deepEqual(
      report.refusals.map((entry) => entry.code),
      [INSTITUTION_ERRORS.BUDGET_EXHAUSTED],
    );
  });
}

test('المؤسسةُ لا تُؤسَّس مرّتين: التأسيسُ الثاني يُرفض ولا يُعيد المُخصَّصَ إلى أوّله', async () => {
  const s = state();
  const [key] = KEYS;
  assert.ok(typeof key === 'string');
  await establish(s, key);
  await ranTask(s, { key, id: `task:${key}:1` });
  await assert.rejects(
    () => s.ops.commission({ key }),
    (error) => field(error, 'code') === INSTITUTION_ERRORS.ALREADY_COMMISSIONED,
  );
  const [row] = await s.institutions.list({ filter: { key } });
  assert.equal(field(row, 'budgetConsumed'), firstTaskKind(key).cost);
});

test('مهمّةٌ إلى مؤسسةٍ لم تُؤسَّس تُرفض: لا عملَ قبل تخصيصِ ميزانية', async () => {
  const s = state();
  const [key] = KEYS;
  assert.ok(typeof key === 'string');
  const kind = firstTaskKind(key);
  await assert.rejects(
    () =>
      s.ops.submit({
        id: 'task:orphan',
        institutionKey: key,
        kind: kind.kind,
        domain: domainFor(key, kind.kind),
        subject: subjectFor(kind.kind),
        submittedBy: SUBMITTER,
        actorRole: SUBMITTER,
      }),
    (error) => field(error, 'code') === INSTITUTION_ERRORS.NOT_COMMISSIONED,
  );
  assert.equal(await s.tasks.count({}), 0);
});

test('الدورُ غيرُ الحائزِ للفعل يُرفض: الرفعُ والإسنادُ والتقريرُ ليست لكل دور', async () => {
  const s = state();
  const [key] = KEYS;
  assert.ok(typeof key === 'string');
  await establish(s, key);
  const kind = firstTaskKind(key);
  // فاعلُ التنفيذِ ليس فاعلَ الرفع: الفصلُ مقروءٌ من العهد ومُتحقَّقٌ عند تحميله.
  await assert.rejects(
    () =>
      s.ops.submit({
        id: 'task:role',
        institutionKey: key,
        kind: kind.kind,
        domain: domainFor(key, kind.kind),
        subject: subjectFor(kind.kind),
        submittedBy: OPERATOR,
        actorRole: OPERATOR,
      }),
    (error) => field(error, 'code') === INSTITUTION_ERRORS.ROLE_NOT_PERMITTED,
  );
  await assert.rejects(
    () => s.ops.report({ institutionKey: key, actorRole: SUBMITTER }),
    (error) => field(error, 'code') === INSTITUTION_ERRORS.ROLE_NOT_PERMITTED,
  );
});

test('نوعُ المهمّةِ غيرُ المُعلَنِ للمؤسسةِ يُرفض: نوعٌ مفتوحٌ يُلغي معنى الإسناد المؤسسي', async () => {
  const s = state();
  const [key] = KEYS;
  assert.ok(typeof key === 'string');
  await establish(s, key);
  await assert.rejects(
    () =>
      s.ops.submit({
        id: 'task:kind',
        institutionKey: key,
        kind: 'إجراءٌ لم تُعلنه الوثيقة',
        domain: domainFor(key, firstTaskKind(key).kind),
        subject: subjectFor('إجراء'),
        submittedBy: SUBMITTER,
        actorRole: SUBMITTER,
      }),
    (error) => field(error, 'code') === INSTITUTION_ERRORS.TASK_KIND_NOT_DECLARED,
  );
});

test('موضوعٌ أقصرُ من الحدِّ المُعلَنِ يُرفض بحدِّ الوثيقة لا برقمٍ في الاختبار', async () => {
  const s = state();
  const [key] = KEYS;
  assert.ok(typeof key === 'string');
  await establish(s, key);
  const kind = firstTaskKind(key);
  await assert.rejects(
    () =>
      s.ops.submit({
        id: 'task:short',
        institutionKey: key,
        kind: kind.kind,
        domain: domainFor(key, kind.kind),
        subject: 'ط'.repeat(POLICY.procedure.minSubjectLength - 1),
        submittedBy: SUBMITTER,
        actorRole: SUBMITTER,
      }),
    (error) => field(error, 'code') === INSTITUTION_ERRORS.SUBJECT_TOO_SHORT,
  );
});

test('وكيلٌ معلَّقٌ أو غيرُ مؤهَّلِ الدورِ لا يُسنَد إليه عمل: الأهليّةُ مقروءةٌ من سجلِّ الهويات', async () => {
  const s = state();
  const [key] = KEYS;
  assert.ok(typeof key === 'string');
  await establish(s, key);
  const kind = firstTaskKind(key);

  /** @param {string} id */
  const submitted = async (id) => {
    await s.ops.submit({
      id,
      institutionKey: key,
      kind: kind.kind,
      domain: domainFor(key, kind.kind),
      subject: subjectFor(kind.kind),
      submittedBy: SUBMITTER,
      actorRole: SUBMITTER,
    });
  };

  // (أ) وكيلٌ لا صفَّ له في السجل: اسمُ وكيلٍ في عمودٍ ليس وكيلاً.
  await submitted('task:ghost');
  await assert.rejects(
    () => s.ops.assign({ taskId: 'task:ghost', agentId: 'agent:ghost', actorRole: OPERATOR }),
    (error) => field(error, 'code') === INSTITUTION_ERRORS.AGENT_NOT_ELIGIBLE,
  );

  // (ب) وكيلٌ نشطٌ لكن دورُه ليس من أدوار المؤسسة.
  await submitted('task:role');
  const outsider = await agentWithRole(s, 'role:minister');
  await assert.rejects(
    () => s.ops.assign({ taskId: 'task:role', agentId: outsider, actorRole: OPERATOR }),
    (error) => field(error, 'code') === INSTITUTION_ERRORS.AGENT_NOT_ELIGIBLE,
  );

  // (ج) وكيلٌ مؤهَّلُ الدورِ لكنّه أُوقف: الحالةُ تُقرأ من المستودع بعد الانتقال.
  await submitted('task:suspended');
  const suspended = await agentWithRole(s, eligibleRole(key));
  await s.agents.transition(suspended, 'suspended', 'إيقافٌ لقياسِ أهليّةِ الإسناد');
  await assert.rejects(
    () => s.ops.assign({ taskId: 'task:suspended', agentId: suspended, actorRole: OPERATOR }),
    (error) => field(error, 'code') === INSTITUTION_ERRORS.AGENT_NOT_ELIGIBLE,
  );

  // ولا مهمّةَ واحدةً صارت مُسنَدةً بأحدِ الثلاثة.
  assert.equal(await s.tasks.count({ state: 'assigned' }), 0);
});

test('المهمّةُ لا تُنفَّذ قبل إسنادها ولا تُنفَّذ مرّتين: الحالةُ حاجزٌ لا وصف', async () => {
  const s = state();
  const [key] = KEYS;
  assert.ok(typeof key === 'string');
  await establish(s, key);
  const kind = firstTaskKind(key);
  await s.ops.submit({
    id: 'task:order',
    institutionKey: key,
    kind: kind.kind,
    domain: domainFor(key, kind.kind),
    subject: subjectFor(kind.kind),
    submittedBy: SUBMITTER,
    actorRole: SUBMITTER,
  });
  await assert.rejects(
    () => s.ops.execute({ taskId: 'task:order', actorRole: OPERATOR }),
    (error) => field(error, 'code') === INSTITUTION_ERRORS.TASK_STATE_INVALID,
  );
  const agentId = await agentWithRole(s, eligibleRole(key));
  await s.ops.assign({ taskId: 'task:order', agentId, actorRole: OPERATOR });
  await s.ops.execute({ taskId: 'task:order', actorRole: OPERATOR });
  // والتنفيذُ الثاني يُرفض بحالةٍ لا بمخرَجٍ مكرَّر: مخرَجان لمهمّةٍ واحدةٍ
  // يجعلان الكلفةَ المقيَّدةَ مرّةً تُنتج أثرين.
  await assert.rejects(
    () => s.ops.execute({ taskId: 'task:order', actorRole: OPERATOR }),
    (error) => field(error, 'code') === INSTITUTION_ERRORS.TASK_STATE_INVALID,
  );
  assert.equal(await s.outputs.count({}), 1);
});

test('أثرٌ بلا منفِّذٍ مُسجَّلٍ يُرفض ويُسجَّل رفضُه: اسمُ أثرٍ في وثيقةٍ ليس يداً تُحدثه', async () => {
  const s = state({ effects: false });
  const [key] = KEYS;
  assert.ok(typeof key === 'string');
  await establish(s, key);
  const kind = firstTaskKind(key);
  await s.ops.submit({
    id: 'task:noeffect',
    institutionKey: key,
    kind: kind.kind,
    domain: domainFor(key, kind.kind),
    subject: subjectFor(kind.kind),
    submittedBy: SUBMITTER,
    actorRole: SUBMITTER,
  });
  const agentId = await agentWithRole(s, eligibleRole(key));
  await s.ops.assign({ taskId: 'task:noeffect', agentId, actorRole: OPERATOR });
  await assert.rejects(
    () => s.ops.execute({ taskId: 'task:noeffect', actorRole: OPERATOR }),
    (error) => field(error, 'code') === INSTITUTION_ERRORS.EFFECT_NOT_REGISTERED,
  );
  const refused = await s.tasks.findById('task:noeffect');
  assert.equal(field(refused, 'state'), 'refused');
  assert.equal(field(refused, 'refusalCode'), INSTITUTION_ERRORS.EFFECT_NOT_REGISTERED);
  // ولا ميزانيةَ قُيِّدت: الرفضُ وقع قبل القيد لا بعده.
  const [row] = await s.institutions.list({ filter: { key } });
  assert.equal(field(row, 'budgetConsumed'), 0);
});

test('تنفيذٌ لا يُغيِّر بصمةَ المخزن يُرفض، والمقيَّدُ لا يُردّ: هذا ما تُعلنه الوثيقة', async () => {
  const s = state();
  const [key] = KEYS;
  assert.ok(typeof key === 'string');
  assert.equal(POLICY.budget.refundOnIneffectiveExecution, false);
  const institution = await establish(s, key);
  const kind = firstTaskKind(key);
  await s.ops.submit({
    id: 'task:noeffectrun',
    institutionKey: key,
    kind: kind.kind,
    domain: domainFor(key, kind.kind),
    subject: subjectFor(kind.kind),
    submittedBy: SUBMITTER,
    actorRole: SUBMITTER,
  });
  const agentId = await agentWithRole(s, eligibleRole(key));
  await s.ops.assign({ taskId: 'task:noeffectrun', agentId, actorRole: OPERATOR });

  // منفِّذٌ يزعم الإنتاجَ ولا يكتب شيئاً — وهو بعينه ما يجب أن يُكشف: لو كان
  // «منفَّذ» عَلَماً يُرفع بنجاحِ النداء لمرّ هذا صامتاً.
  const executor = s.ops.effects.get(kind.effect);
  assert.notEqual(executor, undefined);
  s.ops.effects.set(kind.effect, {
    name: kind.effect,
    fingerprint: () => Promise.resolve('outputs:0:'),
    produce: () => Promise.resolve('out:مزعوم'),
  });
  await assert.rejects(
    () => s.ops.execute({ taskId: 'task:noeffectrun', actorRole: OPERATOR }),
    (error) => field(error, 'code') === INSTITUTION_ERRORS.EXECUTION_INEFFECTIVE,
  );
  const refused = await s.tasks.findById('task:noeffectrun');
  assert.equal(field(refused, 'state'), 'refused');
  assert.equal(field(refused, 'executedAt'), null);
  assert.ok(field(refused, 'budgetDebitedAt') instanceof Date);
  const after = await s.institutions.findById(String(field(institution, 'id')));
  assert.equal(field(after, 'budgetConsumed'), kind.cost);
  assert.equal(await s.outputs.count({}), 0);
});

test('تقريرٌ عن مؤسسةٍ بلا مهمّةٍ واحدةٍ يُرفض: تقريرٌ عن صفرِ عملٍ يوهم بعملٍ لم يقع', async () => {
  const s = state();
  const [key] = KEYS;
  assert.ok(typeof key === 'string');
  await establish(s, key);
  await assert.rejects(
    () => s.ops.report({ institutionKey: key, actorRole: REPORTER }),
    (error) => field(error, 'code') === INSTITUTION_ERRORS.REPORT_EMPTY,
  );
});

test('مفتاحٌ لا تُعلنه الوثيقةُ يُرفض برمزِه الخاص: المُشغَّلُ ما أعلنته لا ما يُنادى به', async () => {
  const s = state();
  await assert.rejects(
    () => s.ops.commission({ key: 'وزارةٌ لم تُعلن' }),
    (error) => field(error, 'code') === INSTITUTION_ERRORS.UNKNOWN,
  );
});

test('المؤسستان مستقلّتان: ميزانيةُ إحداهما لا تُقيَّد بعملِ الأخرى ولا يخلط تقريراهما', async () => {
  const s = state();
  const [first, second] = KEYS;
  assert.ok(typeof first === 'string' && typeof second === 'string');
  await establish(s, first);
  await establish(s, second);
  await ranTask(s, { key: first, id: `task:${first}:solo` });

  const firstReport = await s.ops.report({ institutionKey: first, actorRole: REPORTER });
  assert.equal(firstReport.tasks.total, 1);
  assert.equal(firstReport.budget.consumed, firstTaskKind(first).cost);

  // والثانيةُ لم تُقيَّد منها وحدةٌ واحدة، وتقريرُها يُرفض لأنّها لم تعمل.
  const [row] = await s.institutions.list({ filter: { key: second } });
  assert.equal(field(row, 'budgetConsumed'), 0);
  await assert.rejects(
    () => s.ops.report({ institutionKey: second, actorRole: REPORTER }),
    (error) => field(error, 'code') === INSTITUTION_ERRORS.REPORT_EMPTY,
  );

  // ولا مخرَجَ من الأولى يُقرأ في مخزنِ الثانية.
  const outputs = await s.outputs.list({ filter: { institutionId: String(field(row, 'id')) } });
  assert.equal(outputs.length, 0);
});
