// اختبارُ قبولِ الخطوة M8.06: **مؤسسةٌ تتجاوز اختصاصَها تُمنع وتُسجَّل**.
//
// وما يُقاس هنا ستّةُ حدودٍ لا حدٌّ واحد: الاختصاصُ (مجالٌ مُستثنىً يُمنع)،
// والصلاحيةُ (فعلٌ بلا صلاحيةٍ مسمّاةٍ يُمنع)، وسقفُ الصرفِ في المدّة (مُخصَّصٌ
// كلّيٌّ لا يمنع استنفادَ موردِ سنةٍ في أسبوع)، والمساءلةُ (كلُّ مخالفةٍ منسوبةٌ
// إلى جهةٍ من خارج المؤسسة)، والتقريرُ الدوريُّ (تأخُّرٌ يُوقف العملَ لا يُسجَّل
// ملاحظةً)، وإغلاقُ الدورةِ (لا تُغلَق قبل أوانها ولا تُغلَق مرّتين).
//
// و**المنعُ وحده نصفُ الشرط**: كلُّ منعٍ في هذا الملف يُقاس بصفِّ مخالفةٍ محفوظٍ
// في مستودعه منسوبٍ إلى جهةِ مساءلته، وبحادثةٍ في سجلٍّ سليمِ السلسلة. ومنعٌ لا
// أثرَ له مساءلةٌ بلا مادّة.
//
// وكلُّ رقمٍ ومفتاحٍ ومجالٍ في الملف **مقروءٌ من `config/institutional-mandates.yaml`**
// لا مكتوبٌ حرفاً: حرفٌ مكتوبٌ يبقى أخضرَ بعد تغيُّرِ الوثيقة فيقيس ما لم يبقَ.

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  INSTITUTION_ERRORS,
  InstitutionOperations,
  MANDATE_ERRORS,
  effectIndex,
} from '../../src/institutions/index.mjs';
import {
  CYCLE_CLOSER,
  ENACTOR,
  MANDATES,
  OPERATOR,
  POLICY,
  SUBMITTER,
  agentWithRole,
  domainFor,
  eligibleRole,
  establish,
  field,
  firstTaskKind,
  mandateOf,
  pilot,
  state,
  subjectFor,
} from './harness.mjs';

const DAY_MS = 86_400_000;

/**
 * أوّلُ نموذجٍ يُعلن مجالاً **مُستثنىً صراحةً**: هو موضعُ قياسِ التجاوز، فمجالٌ
 * غيرُ مُستثنىً لا يُقاس تجاوزُه.
 * @returns {import('../../src/institutions/mandate.mjs').InstitutionMandateEntry}
 */
function excluding() {
  const found = MANDATES.mandates.find((entry) => entry.jurisdiction.excludes.length > 0);
  if (found === undefined) throw new Error('لا نموذجَ يُعلن مجالاً مُستثنىً في الوثيقة');
  return found;
}

/** المجالُ المُستثنى الأولُ لذاك النموذج. */
function excludedDomain() {
  const [domain] = excluding().jurisdiction.excludes;
  if (domain === undefined) throw new Error('نموذجٌ بلا مجالٍ مُستثنى');
  return domain;
}

test('معيارُ القبول: مؤسسةٌ ترفع مهمّةً في مجالٍ مُستثنىً من اختصاصها تُمنع ويُحفظ صفُّ مخالفتها', async () => {
  const mandate = excluding();
  const key = mandate.key;
  const domain = excludedDomain();
  const kind = firstTaskKind(key);
  const s = state();
  await establish(s, key);

  await assert.rejects(
    () =>
      s.ops.submit({
        id: 'task:beyond',
        institutionKey: key,
        kind: kind.kind,
        domain,
        subject: subjectFor(kind.kind),
        submittedBy: SUBMITTER,
        actorRole: SUBMITTER,
      }),
    (error) => field(error, 'code') === MANDATE_ERRORS.OUT_OF_JURISDICTION,
  );

  // ١. لا صفَّ مهمّةٍ فُتح: المنعُ وقع **قبل** الاستقبال، فلا تُقرأ مهمّةٌ خارجةُ
  //    الاختصاصِ في عدّادِ مهامِّ المؤسسةِ أصلاً.
  assert.equal(await s.tasks.count({}), 0);

  // ٢. والمخالفةُ صفٌّ محفوظٌ منسوبٌ إلى جهةِ مساءلةٍ من **خارج** المؤسسة.
  const breaches = await s.breaches.list({ filter: { institutionKey: key } });
  assert.equal(breaches.length, 1);
  const [breach] = breaches;
  assert.equal(field(breach, 'code'), MANDATE_ERRORS.OUT_OF_JURISDICTION);
  assert.equal(field(breach, 'taskId'), 'task:beyond');
  assert.equal(field(breach, 'domain'), domain);
  assert.equal(field(breach, 'accountableTo'), mandate.accountability.accountableTo);
  assert.equal(field(breach, 'escalateTo'), mandate.accountability.escalateTo);
  assert.ok(field(breach, 'detectedAt') instanceof Date);
  assert.ok(
    String(field(breach, 'detail')).length >= MANDATES.procedure.minBreachDetailLength,
    'تفصيلُ المخالفة أقصرُ من الحدِّ المُعلَن',
  );
  assert.ok(!pilot(key).agentRoles.includes(String(field(breach, 'accountableTo'))));

  // ٣. والحادثةُ منشورةٌ في سجلٍّ سليمِ السلسلة: تجاوزٌ لا أثرَ له في السجل
  //    تجاوزٌ غيرُ موثَّق، وهو نصفُ معيارِ القبول الآخر.
  const types = s.log.snapshot().map((entry) => field(entry, 'type'));
  assert.ok(types.includes('institutions.mandate.enacted'));
  assert.ok(types.includes('institutions.mandate.exceeded'));
  assert.equal(s.log.verify(), true);
  assert.equal(s.log.verifyChain().ok, true);
});

test('اختصاصُ مؤسسةٍ ممنوعٌ على أخرى: المجالُ المُستثنى هو اختصاصُ الأخرى فعلاً', () => {
  const domain = excludedDomain();
  const owner = MANDATES.mandates.find(
    (entry) => entry.key !== excluding().key && entry.jurisdiction.domains.includes(domain),
  );
  assert.notEqual(owner, undefined, `المجال ${domain} مُستثنىً ولا مؤسسةَ تختصُّ به`);
});

test('نموذجٌ لم يُنفَذ لا تُستقبَل له مهمّةٌ: التأسيسُ وحدَه لا يفتح باب العمل', async () => {
  const s = state();
  const [key] = POLICY.pilots.map((entry) => entry.key);
  assert.ok(typeof key === 'string');
  await s.ops.commission({ key });
  const kind = firstTaskKind(key);
  await assert.rejects(
    () =>
      s.ops.submit({
        id: 'task:unenacted',
        institutionKey: key,
        kind: kind.kind,
        domain: domainFor(key, kind.kind),
        subject: subjectFor(kind.kind),
        submittedBy: SUBMITTER,
        actorRole: SUBMITTER,
      }),
    (error) => field(error, 'code') === MANDATE_ERRORS.NOT_ENACTED,
  );
  assert.equal(await s.tasks.count({}), 0);
  // ولا مخالفةَ تُسجَّل: بلا صفِّ اختصاصٍ لا جهةَ مساءلةٍ تُنسب إليها المخالفة.
  assert.equal(await s.breaches.count({}), 0);
});

test('الإنفاذُ فعلٌ سياديٌّ لا تشغيليّ، ولا يُنفَذ اختصاصٌ مرّتين ولا لكيانٍ بلا صفّ', async () => {
  const s = state();
  const [key] = POLICY.pilots.map((entry) => entry.key);
  assert.ok(typeof key === 'string');

  // (أ) قبل التأسيس: الرمزُ من عهد التشغيل لا من وثيقة الاختصاص.
  await assert.rejects(
    () => s.mandate.enact({ institutionKey: key, actorRole: ENACTOR }),
    (error) => field(error, 'code') === INSTITUTION_ERRORS.NOT_COMMISSIONED,
  );

  await s.ops.commission({ key });

  // (ب) دورٌ غيرُ حاملِ الفعل: من يُشغِّل المؤسسةَ لا يُوسِّع اختصاصَها.
  await assert.rejects(
    () => s.mandate.enact({ institutionKey: key, actorRole: OPERATOR }),
    (error) => field(error, 'code') === MANDATE_ERRORS.ROLE_NOT_PERMITTED,
  );
  assert.equal(await s.mandateRows.count({}), 0);

  // (ج) الإنفاذُ الأولُ يُحفظ صفّاً مقروءَ الحدود من الوثيقة.
  const row = await s.mandate.enact({ institutionKey: key, actorRole: ENACTOR });
  const declared = mandateOf(key);
  assert.deepEqual(
    [.../** @type {string[]} */ (field(row, 'domains'))],
    [...declared.jurisdiction.domains],
  );
  assert.deepEqual([.../** @type {string[]} */ (field(row, 'powers'))], [...declared.powers]);
  assert.equal(field(row, 'budgetCeiling'), declared.budget.ceiling);
  assert.equal(field(row, 'reportingPeriodDays'), declared.reporting.periodDays);
  assert.equal(field(row, 'modelVersion'), MANDATES.version);

  // (د) والإنفاذُ الثاني يُرفض: إعادةُ كتابةِ الاختصاصِ تمحو حدَّه الأولَ بلا أثر.
  await assert.rejects(
    () => s.mandate.enact({ institutionKey: key, actorRole: ENACTOR }),
    (error) => field(error, 'code') === MANDATE_ERRORS.ALREADY_ENACTED,
  );
  assert.equal(await s.mandateRows.count({}), 1);
});

test('مهمّةٌ بلا مجالٍ معلَنٍ تُمنع: مجالٌ غيرُ معلَنٍ لا يُقاس تجاوزُه', async () => {
  const key = excluding().key;
  const kind = firstTaskKind(key);
  const s = state();
  await establish(s, key);
  await assert.rejects(
    () =>
      s.ops.submit({
        id: 'task:nodomain',
        institutionKey: key,
        kind: kind.kind,
        domain: '   ',
        subject: subjectFor(kind.kind),
        submittedBy: SUBMITTER,
        actorRole: SUBMITTER,
      }),
    (error) => field(error, 'code') === MANDATE_ERRORS.DOMAIN_NOT_DECLARED,
  );
  assert.equal(await s.breaches.count({ code: MANDATE_ERRORS.DOMAIN_NOT_DECLARED }), 1);
});

test('نوعٌ لا صلاحيةَ مسمّاةً له في النموذج يُمنع ويُسجَّل: فعلٌ بلا سند', async () => {
  const key = excluding().key;
  const s = state();
  await establish(s, key);
  const [domain] = mandateOf(key).jurisdiction.domains;
  assert.ok(typeof domain === 'string');
  await assert.rejects(
    () => s.mandate.authorize({ institutionKey: key, kind: 'فعلٌ لا حدَّ له', domain }),
    (error) => field(error, 'code') === MANDATE_ERRORS.POWER_NOT_GRANTED,
  );
  assert.equal(await s.breaches.count({ code: MANDATE_ERRORS.POWER_NOT_GRANTED }), 1);
});

test('نوعٌ يُرفع تحت مجالٍ آخرَ داخلِ الاختصاص يُمنع: التفافٌ على الحدِّ لا امتثالٌ له', async () => {
  const found = MANDATES.mandates.find((entry) => {
    const [act] = entry.acts;
    return act !== undefined && entry.jurisdiction.domains.some((d) => d !== act.domain);
  });
  assert.notEqual(found, undefined, 'لا نموذجَ بمجالين ليُقاس الخلطُ بينهما');
  const mandate = /** @type {NonNullable<typeof found>} */ (found);
  const [act] = mandate.acts;
  assert.notEqual(act, undefined);
  const other = mandate.jurisdiction.domains.find((d) => d !== /** @type {any} */ (act).domain);
  assert.ok(typeof other === 'string');

  const s = state();
  await establish(s, mandate.key);
  await assert.rejects(
    () =>
      s.ops.submit({
        id: 'task:mismatch',
        institutionKey: mandate.key,
        kind: /** @type {any} */ (act).kind,
        domain: other,
        subject: subjectFor(/** @type {any} */ (act).kind),
        submittedBy: SUBMITTER,
        actorRole: SUBMITTER,
      }),
    (error) => field(error, 'code') === MANDATE_ERRORS.ACT_DOMAIN_MISMATCH,
  );
  const [breach] = await s.breaches.list({ filter: { code: MANDATE_ERRORS.ACT_DOMAIN_MISMATCH } });
  assert.equal(field(breach, 'domain'), other);
  assert.equal(await s.tasks.count({}), 0);
});

for (const mandate of MANDATES.mandates) {
  const key = mandate.key;
  const kind = firstTaskKind(key);
  const allocation = pilot(key).budget.allocation;
  const withinPeriod = Math.floor(mandate.budget.ceiling / kind.cost);
  const withinAllocation = Math.floor(allocation / kind.cost);
  if (withinPeriod >= withinAllocation) continue;

  test(`سقفُ مدّةِ ${key} يمنع قبل نفادِ المُخصَّصِ الكلّي: مُخصَّصُ سنةٍ لا يُستهلَك في أسبوع`, async () => {
    const s = state();
    const institution = await establish(s, key);
    const domain = domainFor(key, kind.kind);

    /** @param {string} id */
    const run = async (id) => {
      await s.ops.submit({
        id,
        institutionKey: key,
        kind: kind.kind,
        domain,
        subject: subjectFor(kind.kind),
        submittedBy: SUBMITTER,
        actorRole: SUBMITTER,
      });
      const agentId = await agentWithRole(s, eligibleRole(key));
      await s.ops.assign({ taskId: id, agentId, actorRole: OPERATOR });
      return s.ops.execute({ taskId: id, actorRole: OPERATOR });
    };

    // ما يحمله السقفُ يمرّ، والذي بعده يُمنع **وفي المُخصَّصِ الكلّي بقيّةٌ**.
    for (let index = 1; index <= withinPeriod; index += 1) {
      await run(`task:${key}:ceiling:${index}`);
    }
    const spent = withinPeriod * kind.cost;
    const before = await s.institutions.findById(String(field(institution, 'id')));
    assert.equal(field(before, 'budgetConsumed'), spent);
    assert.ok(spent + kind.cost <= allocation, 'المُخصَّصُ الكلّي نفد فلا يُقاس السقفُ الزمنيّ');

    const overId = `task:${key}:ceiling:over`;
    await assert.rejects(
      () => run(overId),
      (error) => field(error, 'code') === MANDATE_ERRORS.PERIOD_CEILING_EXCEEDED,
    );

    // والرفضُ محفوظٌ في صفِّ المهمّة، ولا وحدةَ ميزانيةٍ قُيِّدت بما مُنِع.
    const refused = await s.tasks.findById(overId);
    assert.equal(field(refused, 'state'), 'refused');
    assert.equal(field(refused, 'refusalCode'), MANDATE_ERRORS.PERIOD_CEILING_EXCEEDED);
    assert.equal(field(refused, 'budgetDebitedAt'), null);
    const after = await s.institutions.findById(String(field(institution, 'id')));
    assert.equal(field(after, 'budgetConsumed'), spent);
    assert.equal(await s.breaches.count({ code: MANDATE_ERRORS.PERIOD_CEILING_EXCEEDED }), 1);
  });
}

test('تأخُّرٌ عن التقرير الدوريِّ يُوقف العملَ حتى تُغلَق الدورة، والإغلاقُ يُشتقُّ من صفوفِ المدّة', async () => {
  const key = excluding().key;
  const declared = mandateOf(key);
  const kind = firstTaskKind(key);
  const domain = domainFor(key, kind.kind);
  // ساعةٌ مُحقونةٌ: المدّةُ المُعلَنةُ ثلاثون يوماً أو نحوُها، ولا يُنتظر شهرٌ
  // ليُقاس حدٌّ زمنيّ. والقياسُ على المدّةِ المقروءةِ من الوثيقة لا على رقمٍ ثابت.
  let clock = new Date('2026-01-01T00:00:00.000Z');
  const s = state({ now: () => clock });
  await establish(s, key);

  // داخلَ المدّة: العملُ يمرّ.
  await s.ops.submit({
    id: 'task:cycle:1',
    institutionKey: key,
    kind: kind.kind,
    domain,
    subject: subjectFor(kind.kind),
    submittedBy: SUBMITTER,
    actorRole: SUBMITTER,
  });

  // ومخالفةٌ تقع **داخلَ** المدّة تُقرأ في تقريرها.
  await assert.rejects(
    () =>
      s.ops.submit({
        id: 'task:cycle:beyond',
        institutionKey: key,
        kind: kind.kind,
        domain: excludedDomain(),
        subject: subjectFor(kind.kind),
        submittedBy: SUBMITTER,
        actorRole: SUBMITTER,
      }),
    (error) => field(error, 'code') === MANDATE_ERRORS.OUT_OF_JURISDICTION,
  );

  // (أ) إغلاقٌ قبل انقضاءِ المدّة يُرفض ولا يُسجَّل مخالفةً: عيبُ توقيتٍ في فعلِ
  //     المُسائل لا تجاوزٌ من المؤسسة.
  await assert.rejects(
    () => s.mandate.closeCycle({ institutionKey: key, actorRole: CYCLE_CLOSER }),
    (error) => field(error, 'code') === MANDATE_ERRORS.CYCLE_NOT_DUE,
  );
  assert.equal(await s.breaches.count({ code: MANDATE_ERRORS.CYCLE_NOT_DUE }), 0);

  // (ب) بعد المدّةِ ومهلتِها: لا مهمّةَ جديدةً تُستقبَل، وتُسجَّل المخالفة.
  clock = new Date(
    clock.getTime() + (declared.reporting.periodDays + declared.reporting.graceDays + 1) * DAY_MS,
  );
  await assert.rejects(
    () =>
      s.ops.submit({
        id: 'task:cycle:2',
        institutionKey: key,
        kind: kind.kind,
        domain,
        subject: subjectFor(kind.kind),
        submittedBy: SUBMITTER,
        actorRole: SUBMITTER,
      }),
    (error) => field(error, 'code') === MANDATE_ERRORS.REPORTING_OVERDUE,
  );
  assert.equal(await s.breaches.count({ code: MANDATE_ERRORS.REPORTING_OVERDUE }), 1);
  assert.equal(await s.tasks.count({}), 1);

  // (ج) وإغلاقُ الدورةِ تقريرٌ **مُشتقٌّ** من صفوفِ المدّة لا نصٌّ محفوظ.
  const report = await s.mandate.closeCycle({ institutionKey: key, actorRole: CYCLE_CLOSER });
  assert.equal(report.tasks.total, 1);
  // مخالفةُ الاختصاصِ وقعت داخلَ المدّة فتُقرأ فيها، ومخالفةُ التأخُّرِ وقعت في
  // المهلةِ **بعد** نهايةِ المدّة فتُقرأ في المدّةِ التالية لا في هذه: تقريرُ مدّةٍ
  // يحتسب ما وقع فيها لا ما وقع بعدها.
  assert.equal(report.breaches.length, 1);
  assert.equal(report.breaches[0]?.code, MANDATE_ERRORS.OUT_OF_JURISDICTION);
  assert.equal(await s.breaches.count({}), 2);
  assert.equal(report.accountability.accountableTo, declared.accountability.accountableTo);
  assert.equal(await s.cycles.count({ institutionKey: key }), 1);
  const types = s.log.snapshot().map((entry) => field(entry, 'type'));
  assert.ok(types.includes('institutions.report.cycle.closed'));

  // (د) وإغلاقٌ ثانٍ بعد الأولِ لا يُعيد كتابةَ المدّة: المدّةُ التاليةُ تبدأ من
  //     نهايةِ المُغلَقةِ ولم تنقضِ بعد، فيُرفض بالرمزِ الزمنيِّ لا بالتكرار.
  await assert.rejects(
    () => s.mandate.closeCycle({ institutionKey: key, actorRole: CYCLE_CLOSER }),
    (error) => field(error, 'code') === MANDATE_ERRORS.CYCLE_NOT_DUE,
  );
  assert.equal(await s.cycles.count({ institutionKey: key }), 1);

  // (هـ) وبعد الإغلاقِ يُستأنَف العمل: المدّةُ الجديدةُ تبدأ من نهايةِ المُغلَقة.
  await s.ops.submit({
    id: 'task:cycle:3',
    institutionKey: key,
    kind: kind.kind,
    domain,
    subject: subjectFor(kind.kind),
    submittedBy: SUBMITTER,
    actorRole: SUBMITTER,
  });
  assert.equal(await s.tasks.count({}), 2);
  assert.equal(s.log.verifyChain().ok, true);
});

test('إغلاقُ الدورةِ ليس لمن يُنفِذ الاختصاص: من يُوسِّع الحدَّ لا يُقرّ تقريرَ من يعمل تحته', async () => {
  const key = excluding().key;
  const s = state();
  await establish(s, key);
  assert.notEqual(ENACTOR, CYCLE_CLOSER);
  await assert.rejects(
    () => s.mandate.closeCycle({ institutionKey: key, actorRole: ENACTOR }),
    (error) => field(error, 'code') === MANDATE_ERRORS.ROLE_NOT_PERMITTED,
  );
});

test('تشغيلٌ مؤسسيٌّ بلا نموذجِ اختصاصٍ يُرفض عند التركيب: وسيطٌ اختياريٌّ مسارٌ لمؤسسةٍ بلا حدّ', () => {
  const s = state();
  assert.throws(
    () =>
      new InstitutionOperations(
        // الوسيطُ ناقصٌ عن قصد: هذا هو ما يُقاس. والتحويلُ لأنّ النوعَ يمنع ما
        // يمنعه التنفيذُ أيضاً، وقياسُ الحاجزِ في التنفيذ يحتاج تجاوزَ حاجزِ النوع.
        /** @type {any} */ ({
          policy: POLICY,
          log: s.log,
          institutions: s.institutions,
          tasks: s.tasks,
          outputs: s.outputs,
          agents: s.agents,
          effects: effectIndex([]),
        }),
      ),
    (error) => error instanceof Error && error.message === 'INSTITUTION_MANDATE_REQUIRED',
  );
});

test('مفتاحٌ لا نموذجَ له في الوثيقة يُرفض برمزِه الخاص: اختصاصٌ لا يُشتقّ من مؤسسةٍ أخرى', async () => {
  const s = state();
  await assert.rejects(
    () => s.mandate.enact({ institutionKey: 'جهةٌ لا نموذجَ لها', actorRole: ENACTOR }),
    (error) => field(error, 'code') === MANDATE_ERRORS.UNKNOWN,
  );
});

test('إغلاقان متزامنان لمدّةٍ واحدةٍ: أحدُهما يمرّ والآخرُ يُرفض بالرمز المُعلَن لا بخطأِ مستودع', async () => {
  // وهذا هو المسارُ الواقعيُّ الوحيدُ لتكرارِ الإغلاق: الفحصُ المتقدِّمُ يقرأ ثم
  // يكتب، وبين القراءةِ والكتابةِ متَّسعٌ لنداءٍ ثانٍ. فتفرُّدُ (المفتاح، بدايةُ
  // المدّة) هو الحاجزُ، ويُقرأ رفضاً محكوماً لا انهيارَ مستودع.
  const key = excluding().key;
  const declared = mandateOf(key);
  let clock = new Date('2026-01-01T00:00:00.000Z');
  const s = state({ now: () => clock });
  await establish(s, key);
  clock = new Date(clock.getTime() + (declared.reporting.periodDays + 1) * DAY_MS);

  const [first, second] = await Promise.allSettled([
    s.mandate.closeCycle({ institutionKey: key, actorRole: CYCLE_CLOSER }),
    s.mandate.closeCycle({ institutionKey: key, actorRole: CYCLE_CLOSER }),
  ]);
  const outcomes = [first, second];
  assert.equal(outcomes.filter((entry) => entry.status === 'fulfilled').length, 1);
  const rejected = outcomes.find((entry) => entry.status === 'rejected');
  assert.notEqual(rejected, undefined);
  assert.equal(
    field(/** @type {PromiseRejectedResult} */ (rejected).reason, 'code'),
    MANDATE_ERRORS.CYCLE_ALREADY_CLOSED,
  );
  assert.equal(await s.cycles.count({ institutionKey: key }), 1);
});
