// اختبارُ قبولِ الخطوة M8.09: **تقريرٌ مُولَّدٌ فعلاً ومُراجَع، بلا حقولٍ
// تقديريةٍ غيرِ معلَنة**.
//
// والمعيارُ يُقاس بأثرٍ لا بادّعاء، بأربعةِ أشقّاء:
//   ١. **مُولَّدٌ من صفوفٍ لا من تقدير:** كلُّ حقلٍ مقيسٍ يُرجِع قيمتَه ومصدرَه
//      وعددَ الصفوفِ التي قِيس منها؛ وأرقامُ التقريرِ تتغيّر بتغيُّرِ الصفوفِ لا
//      بكتابةٍ في الطلب.
//   ٢. **بلا تقديرٍ غيرِ معلَن:** حقلٌ تقديريٌّ يُكتب `estimated: true` بفرضيةٍ
//      مكتوبةٍ وقيمةٍ غيرِ معروفة، وقيمةٌ لم تُقَس ولم تُعلَن تقديريةً تُردّ
//      بـ`REPORTS_ESTIMATE_UNDECLARED`، وحقلٌ يُعلن مصدراً غيرَ منفَّذٍ يُردّ عند
//      **التركيب** لا عند أولِ توليدٍ (`REPORTS_MEASURE_MISSING`).
//   ٣. **مُراجَعٌ بشريّاً:** المراجعُ مقروءٌ من سجلِّ الهويات نوعاً وحالاً ودوراً،
//      بسببٍ مكتوبٍ لا يقلّ عن الحدِّ المُعلَن، وليس بدورِ من ولّد التقرير.
//   ٤. **يُنشر بأمرٍ ملكيٍّ وبقياسٍ حاضر:** النشرُ يمرّ ببوابةِ التاجِ قبل لمسِ
//      الحال، ولا يقع قبل مراجعةٍ قابلة، ويُردّ بائتاً إن تغيّرت الصفوفُ بعد
//      التوليد.
//
// والساعةُ **مُجمَّدةٌ** وبوابةُ التاجِ تقرؤها نفسَها: أيُّ زمنٍ يُقاس هنا زمنٌ
// مصنوعٌ بالطلبِ لا بمرورِ وقتٍ في آلةِ الاختبار.
//
// **حدٌّ معلَن:** المستودعاتُ ذاكريةٌ لا PostgreSQL، فقيودُ الهجرة 0018 لا تُقاس
// هنا؛ وتطابقُ أسمائها مع ثوابتِ المواصفةِ محروسٌ في البوابة 25
// (`scripts/guard-reports.mjs`)، وثوابتُ المواصفةِ نفسُها تُقاس هنا بمحاولةِ
// كتابةِ صفٍّ يخالفها.

import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import {
  CertificateAuthority,
  CrownGateway,
  EventLog,
  KingIdentity,
  createRoyalCommand,
} from '../../src/root-of-trust/index.mjs';
import {
  REPORT_ERRORS,
  REPORT_STATES,
  RoyalReportGenerator,
  createReportMeasures,
  loadReportPolicy,
} from '../../src/reports/index.mjs';
import { createMemoryRepositories } from '../../src/persistence/composition.mjs';
import { DelegationRegister } from '../../src/federation/index.mjs';

/** وثيقةُ التقاريرِ النافذة، مقروءةً لا مُختلقة. */
const POLICY = loadReportPolicy({ dir: path.join(process.cwd(), 'config') });

const GENERATOR_ROLE = POLICY.acts.generate;
const REVIEW_ROLE = POLICY.acts.review;
const PUBLISH_ACTION = POLICY.command.publish;
const REASON =
  'راجعتُ أقسامَ التقريرِ الأربعةَ وقابلتُ كلَّ حقلٍ بمصدرِه وعددِ صفوفِه فوجدتُها مطابقةً لما في الجداول';

/**
 * @param {unknown} source
 * @param {string} key
 * @returns {unknown}
 */
function field(source, key) {
  return source !== null && typeof source === 'object'
    ? /** @type {Record<string, unknown>} */ (source)[key]
    : undefined;
}

/**
 * دولةٌ مصغَّرةٌ بساعةٍ مُجمَّدةٍ ومستودعاتٍ ذاكرية.
 * @param {object} [options]
 * @param {boolean} [options.withCrown] بلا بوابةٍ يُقاس أنّ النشرَ يسقط لا أنّه يُفترَض.
 * @param {boolean} [options.withAgents] بلا سجلِّ هوياتٍ يُقاس أنّ المراجعةَ تسقط.
 * @param {Record<string, Record<string, unknown>>} [options.identities]
 */
function state(options = {}) {
  const log = new EventLog();
  const repositories = createMemoryRepositories();
  let clock = new Date('2026-06-01T00:00:00.000Z');
  const king = new KingIdentity();
  const crown = new CrownGateway(king, new CertificateAuthority(king), log, {
    clock: /** @type {never} */ ({ now: () => clock.getTime() }),
  });
  const register = new DelegationRegister({ repository: repositories.federationRegister, log });
  const identities = options.identities ?? {
    'human:auditor-1': { kind: 'human', state: 'active', role: REVIEW_ROLE },
    'human:operator-1': { kind: 'human', state: 'active', role: GENERATOR_ROLE },
    'agent:auditor-bot': { kind: 'agent', state: 'active', role: REVIEW_ROLE },
    'human:suspended': { kind: 'human', state: 'suspended', role: REVIEW_ROLE },
  };
  const agents = {
    /** @param {string} id */
    get: async (id) => {
      const row = identities[id];
      if (row === undefined) throw new Error(`الهوية ${id} غيرُ مسجَّلة`);
      return row;
    },
  };
  const generator = new RoyalReportGenerator({
    policy: POLICY,
    reports: repositories.royalReports,
    measures: createReportMeasures({ repositories, register }),
    agents: options.withAgents === false ? null : /** @type {never} */ (agents),
    crown: options.withCrown === false ? null : /** @type {never} */ (crown),
    now: () => clock,
  });
  return {
    log,
    repositories,
    register,
    king,
    crown,
    generator,
    /** @param {string} target */
    order: (target) => {
      const command = {
        ...createRoyalCommand(PUBLISH_ACTION, target),
        issuedAt: clock.toISOString(),
      };
      return { command, signature: king.sign(command) };
    },
    /** @param {number} ms */
    advance: (ms) => {
      clock = new Date(clock.getTime() + ms);
    },
    now: () => clock,
    window: () => ({
      periodStart: new Date(clock.getTime() - POLICY.period.windowMs),
      periodEnd: new Date(clock.getTime() - 1000),
    }),
  };
}

/**
 * صفوفٌ حقيقيةٌ في النافذةِ ليُقاس التقريرُ منها لا من فراغ.
 * @param {ReturnType<typeof state>} s
 * @param {{ tasks?: number, breaches?: number }} [counts]
 */
async function seed(s, counts = {}) {
  const at = new Date(s.now().getTime() - 60000);
  await s.repositories.institutions.insert({
    id: 'institution:stats',
    key: 'INST-01',
    seedId: 'INST-01',
    name: 'هيئةُ الإحصاء',
    agentRoles: ['role:agent'],
    budgetResource: 'compute',
    budgetAllocated: 1000,
    budgetConsumed: 400,
    charterVersion: 1,
    commissionedAt: at,
  });
  const tasks = counts.tasks ?? 2;
  for (let index = 0; index < tasks; index += 1) {
    await s.repositories.institutionTasks.insert({
      id: `task:${index}`,
      institutionId: 'institution:stats',
      kind: 'statistical-bulletin',
      domain: 'statistics',
      subject: `نشرةٌ إحصائيةٌ دوريةٌ رقم ${index} لقياسِ حالِ الدولة`,
      submittedBy: 'human:operator-1',
      receivedAt: at,
      budgetCost: 10,
      state: 'executed',
      agentId: 'agent:statistician',
      assignedAt: at,
      effect: 'نشرُ نشرةٍ إحصائيةٍ في السجلِّ العام',
      outputId: `output:${index}`,
      budgetDebitedAt: at,
      executedAt: at,
      fingerprintBefore: 'a'.repeat(64),
      fingerprintAfter: 'b'.repeat(64),
    });
  }
  const breaches = counts.breaches ?? 1;
  for (let index = 0; index < breaches; index += 1) {
    await s.repositories.institutionBreaches.insert({
      id: `breach:${index}`,
      institutionId: 'institution:stats',
      institutionKey: 'INST-01',
      code: 'MANDATE_OUT_OF_JURISDICTION',
      domain: 'statistics',
      power: 'publish',
      detail: 'مهمةٌ خارجَ نطاقِ الاختصاصِ المُنفَذ',
      accountableTo: 'role:minister',
      escalateTo: 'role:chief-justice',
      detectedAt: at,
    });
  }
}

/**
 * @param {ReturnType<typeof state>} s
 */
async function generated(s) {
  await seed(s);
  return await s.generator.generate({ actorRole: GENERATOR_ROLE, ...s.window() });
}

test('معيارُ القبول: التقريرُ مُولَّدٌ من صفوفٍ مقيسة، وكلُّ حقلٍ بمصدرِه وعددِ صفوفِه', async () => {
  const s = state();
  const row = await generated(s);

  const declared = POLICY.sections.reduce((sum, section) => sum + section.fields.length, 0);
  assert.equal(field(row, 'fieldsDeclared'), declared);
  assert.equal(field(row, 'state'), REPORT_STATES.GENERATED);
  assert.equal(field(row, 'generatedBy'), GENERATOR_ROLE);

  const sections = /** @type {Array<Record<string, unknown>>} */ (field(row, 'sections'));
  assert.equal(sections.length, declared);
  for (const entry of sections) {
    if (entry['estimated'] === true) {
      assert.equal(entry['value'], null, `حقلٌ تقديريٌّ بقيمةٍ: ${String(entry['id'])}`);
      assert.ok(
        String(entry['assumption']).length >= 60,
        `حقلٌ تقديريٌّ بفرضيةٍ قصيرة: ${String(entry['id'])}`,
      );
      continue;
    }
    assert.equal(entry['estimated'], false);
    assert.ok(
      typeof entry['measuredFrom'] === 'string' && entry['measuredFrom'] !== '',
      `حقلٌ مقيسٌ بلا مصدر: ${String(entry['id'])}`,
    );
    assert.ok(
      typeof entry['rowCount'] === 'number' && entry['rowCount'] >= 0,
      `حقلٌ مقيسٌ بلا عددِ صفوف: ${String(entry['id'])}`,
    );
  }

  // والأرقامُ من الصفوفِ لا من الطلب: مهمّتانِ ومخالفةٌ واحدةٌ أُدرِجت فعلاً.
  const byId = new Map(sections.map((entry) => [String(entry['id']), entry]));
  assert.equal(byId.get('institutions.tasks')?.['value'], 2);
  assert.equal(byId.get('violations.institutionBreaches')?.['value'], 1);
  assert.equal(byId.get('cost.budgetDebited')?.['value'], 20);
  assert.equal(byId.get('cost.budgetRemaining')?.['value'], 600);
});

test('معيارُ القبول: كلُّ حقلٍ تقديريٍّ معلَنٌ بفرضيتِه، ولا حقلَ ثالثاً', async () => {
  const s = state();
  const row = await generated(s);
  const sections = /** @type {Array<Record<string, unknown>>} */ (field(row, 'sections'));
  const estimated = sections.filter((entry) => entry['estimated'] === true);
  assert.equal(field(row, 'fieldsEstimated'), estimated.length);
  assert.equal(
    Number(field(row, 'fieldsMeasured')) + Number(field(row, 'fieldsEstimated')),
    Number(field(row, 'fieldsDeclared')),
  );
  // والتقديريُّ **مُعلَنٌ في الوثيقةِ نفسِها** لا مُختلَقٌ في الاختبار.
  for (const entry of estimated) {
    const declaredField = POLICY.sections
      .flatMap((section) => section.fields)
      .find((candidate) => candidate.id === entry['id']);
    assert.ok(declaredField, `حقلٌ تقديريٌّ غيرُ معلَنٍ في الوثيقة: ${String(entry['id'])}`);
    assert.equal(declaredField?.estimated, true);
  }
});

test('قيمةٌ لم تُقَس ولم تُعلَن تقديريةً تُردّ ولا تُكتب صفراً', async () => {
  const s = state();
  await seed(s);
  const measures = createReportMeasures({
    repositories: s.repositories,
    register: s.register,
  });
  // مقياسٌ يُرجِع «لا قيمة» مع صفوفٍ مقيسة: هذا بعينه التقديرُ غيرُ المعلَن.
  measures['institutions.taskCount'] = async () => ({
    value: null,
    rowCount: 7,
    measuredFrom: 'state.institution_tasks',
  });
  const generator = new RoyalReportGenerator({
    policy: POLICY,
    reports: s.repositories.royalReports,
    measures,
    now: s.now,
  });
  await assert.rejects(
    generator.generate({ actorRole: GENERATOR_ROLE, ...s.window() }),
    (/** @type {unknown} */ error) => field(error, 'code') === REPORT_ERRORS.ESTIMATE_UNDECLARED,
  );
  assert.equal((await s.repositories.royalReports.list({})).length, 0);
});

test('حقلٌ بلا مصدرٍ مقروءٍ يُردّ بلا كتابةِ صفّ', async () => {
  const s = state();
  await seed(s);
  const measures = createReportMeasures({
    repositories: s.repositories,
    register: s.register,
  });
  measures['risks.lateCycleCount'] = async () =>
    /** @type {never} */ ({ value: 3, rowCount: -1, measuredFrom: '' });
  const generator = new RoyalReportGenerator({
    policy: POLICY,
    reports: s.repositories.royalReports,
    measures,
    now: s.now,
  });
  await assert.rejects(
    generator.generate({ actorRole: GENERATOR_ROLE, ...s.window() }),
    (/** @type {unknown} */ error) => field(error, 'code') === REPORT_ERRORS.FIELD_UNMEASURED,
  );
});

test('حقلٌ يُعلن مصدراً غيرَ منفَّذٍ يُردّ عند التركيبِ لا عند أولِ توليد', async () => {
  const s = state();
  const measures = createReportMeasures({
    repositories: s.repositories,
    register: s.register,
  });
  delete measures['cost.remainingTotal'];
  assert.throws(
    () =>
      new RoyalReportGenerator({
        policy: POLICY,
        reports: s.repositories.royalReports,
        measures,
        now: s.now,
      }),
    (/** @type {unknown} */ error) => field(error, 'code') === REPORT_ERRORS.MEASURE_MISSING,
  );
  // والاتجاهُ الآخرُ محروسٌ كذلك: مقياسٌ لا حقلَ له.
  const extra = createReportMeasures({ repositories: s.repositories, register: s.register });
  extra['cost.phantomTotal'] = async () => ({
    value: 0,
    rowCount: 0,
    measuredFrom: 'state.institutions',
  });
  assert.throws(
    () =>
      new RoyalReportGenerator({
        policy: POLICY,
        reports: s.repositories.royalReports,
        measures: extra,
        now: s.now,
      }),
    (/** @type {unknown} */ error) => field(error, 'code') === REPORT_ERRORS.MEASURE_MISSING,
  );
});

test('نافذةٌ مقلوبةٌ أو ممتدةٌ أو في المستقبلِ تُردّ', async () => {
  const s = state();
  await seed(s);
  const now = s.now();
  /** @type {Array<[Date, Date]>} */
  const bad = [
    [new Date(now.getTime() - 1000), new Date(now.getTime() - 5000)],
    [new Date(now.getTime() - POLICY.period.windowMs * 3), new Date(now.getTime() - 1000)],
    [new Date(now.getTime() - 1000), new Date(now.getTime() + 60000)],
  ];
  for (const [periodStart, periodEnd] of bad) {
    await assert.rejects(
      s.generator.generate({ actorRole: GENERATOR_ROLE, periodStart, periodEnd }),
      (/** @type {unknown} */ error) => field(error, 'code') === REPORT_ERRORS.PERIOD_INVALID,
    );
  }
});

test('من ليس دورَه التوليدُ لا يُولّد تقريراً', async () => {
  const s = state();
  await seed(s);
  await assert.rejects(
    s.generator.generate({ actorRole: REVIEW_ROLE, ...s.window() }),
    (/** @type {unknown} */ error) => field(error, 'code') === REPORT_ERRORS.ROLE_NOT_PERMITTED,
  );
});

test('المراجعةُ بشريةٌ مقروءةٌ من سجلِّ الهويات لا إعلاناً في الطلب', async () => {
  const s = state();
  const row = await generated(s);
  const reportId = String(field(row, 'reportId'));

  // ١. بلا سجلِّ هوياتٍ لا مراجعة: فحصٌ لا سبيلَ إليه لا يُفترض نجاحُه.
  const blind = state({ withAgents: false });
  await seed(blind);
  const blindRow = await blind.generator.generate({ actorRole: GENERATOR_ROLE, ...blind.window() });
  await assert.rejects(
    blind.generator.review({
      reportId: String(field(blindRow, 'reportId')),
      reviewer: 'human:auditor-1',
      decision: 'accept',
      reason: REASON,
    }),
    (/** @type {unknown} */ error) => field(error, 'code') === REPORT_ERRORS.HUMAN_REVIEW_REQUIRED,
  );

  // ٢. وكيلٌ لا يُراجع، وموقوفٌ لا يُراجع، ومجهولٌ لا يُراجع، وسببٌ قصيرٌ لا يُقبل.
  /** @type {Array<[string, string]>} */
  const refused = [
    ['agent:auditor-bot', REASON],
    ['human:suspended', REASON],
    ['human:unknown', REASON],
    ['human:auditor-1', 'مراجعةٌ سريعة'],
  ];
  for (const [reviewer, reason] of refused) {
    await assert.rejects(
      s.generator.review({ reportId, reviewer, decision: 'accept', reason }),
      (/** @type {unknown} */ error) =>
        field(error, 'code') === REPORT_ERRORS.HUMAN_REVIEW_REQUIRED,
      `قُبِلت مراجعةٌ كان يجب ردُّها: ${reviewer}`,
    );
  }

  // ٣. ومن بدورِ من ولّد التقريرَ لا يُراجعه.
  await assert.rejects(
    s.generator.review({
      reportId,
      reviewer: 'human:operator-1',
      decision: 'accept',
      reason: REASON,
    }),
    (/** @type {unknown} */ error) => field(error, 'code') === REPORT_ERRORS.ROLE_NOT_PERMITTED,
  );

  // ٤. والمراجعةُ القابلةُ تُثبَت في الصفِّ باسمِ مراجعها وسببِه.
  const reviewed = await s.generator.review({
    reportId,
    reviewer: 'human:auditor-1',
    decision: 'accept',
    reason: REASON,
  });
  assert.equal(field(reviewed, 'state'), REPORT_STATES.REVIEWED);
  assert.equal(field(reviewed, 'reviewer'), 'human:auditor-1');
  assert.equal(field(reviewed, 'reviewDecision'), 'accept');
});

test('المراجعةُ الرافضةُ تُثبَت في الصفِّ ولا يُنشر بعدها تقرير', async () => {
  const s = state();
  const row = await generated(s);
  const reportId = String(field(row, 'reportId'));
  await assert.rejects(
    s.generator.review({
      reportId,
      reviewer: 'human:auditor-1',
      decision: 'reject',
      reason:
        'حقلُ التكلفةِ لا يطابق ما في جدولِ المهامِ بعد إعادةِ القياسِ يدويّاً على النافذةِ نفسِها',
    }),
    (/** @type {unknown} */ error) => field(error, 'code') === REPORT_ERRORS.REVIEW_REJECTED,
  );
  const stored = await s.repositories.royalReports.findById(reportId);
  assert.equal(field(stored, 'state'), REPORT_STATES.REJECTED);
  assert.equal(field(stored, 'reviewDecision'), 'reject');

  await assert.rejects(
    s.generator.publish({ reportId, ...s.order(reportId) }),
    (/** @type {unknown} */ error) => field(error, 'code') === REPORT_ERRORS.NOT_REVIEWED,
  );
});

test('النشرُ أمرٌ ملكيٌّ: بلا بوابةٍ ولا أمرٍ صحيحِ الفعلِ والهدفِ لا يقع', async () => {
  // ١. بلا بوابةٍ مركَّبةٍ لا نشر.
  const blind = state({ withCrown: false });
  const blindRow = await generated(blind);
  await assert.rejects(
    blind.generator.publish({ reportId: String(field(blindRow, 'reportId')) }),
    (/** @type {unknown} */ error) => field(error, 'code') === REPORT_ERRORS.ROYAL_COMMAND_REQUIRED,
  );

  const s = state();
  const row = await generated(s);
  const reportId = String(field(row, 'reportId'));
  await s.generator.review({
    reportId,
    reviewer: 'human:auditor-1',
    decision: 'accept',
    reason: REASON,
  });

  // ٢. بلا أمرٍ ولا توقيعٍ لا نشر.
  await assert.rejects(
    s.generator.publish({ reportId }),
    (/** @type {unknown} */ error) => field(error, 'code') === REPORT_ERRORS.ROYAL_COMMAND_REQUIRED,
  );

  // ٣. أمرٌ على فعلٍ آخرَ يُردّ ولو صحّ توقيعُه.
  const wrongAction = {
    ...createRoyalCommand('revoke-territorial-delegation', reportId),
    issuedAt: s.now().toISOString(),
  };
  await assert.rejects(
    s.generator.publish({
      reportId,
      command: wrongAction,
      signature: s.king.sign(wrongAction),
    }),
    (/** @type {unknown} */ error) => field(error, 'code') === REPORT_ERRORS.COMMAND_ACTION_UNKNOWN,
  );

  // ٤. أمرٌ على تقريرٍ آخرَ لا ينفُذ في هذا.
  await assert.rejects(
    s.generator.publish({ reportId, ...s.order('report:other') }),
    (/** @type {unknown} */ error) =>
      field(error, 'code') === REPORT_ERRORS.COMMAND_TARGET_MISMATCH,
  );

  // ٥. توقيعٌ مُختلَقٌ يُردّ في بوابةِ التاجِ نفسِها قبل لمسِ الحال.
  const forged = s.order(reportId);
  await assert.rejects(
    s.generator.publish({ reportId, command: forged.command, signature: 'ff'.repeat(32) }),
    // وبوابةُ التاجِ ترفض بنصِّ رسالتِها لا برمزٍ من رموزِ التقارير: الحاجزُ حاجزُها.
    /INVALID_ROYAL_SIGNATURE/,
  );
  const untouched = await s.repositories.royalReports.findById(reportId);
  assert.equal(field(untouched, 'state'), REPORT_STATES.REVIEWED);

  // ٦. والأمرُ الصحيحُ ينشر، ويُحفظ معرّفُه في الصف.
  const order = s.order(reportId);
  const published = await s.generator.publish({ reportId, ...order });
  assert.equal(field(published, 'state'), REPORT_STATES.PUBLISHED);
  assert.equal(field(published, 'publishCommandId'), order.command.id);
});

test('لا نشرَ قبل مراجعة', async () => {
  const s = state();
  const row = await generated(s);
  const reportId = String(field(row, 'reportId'));
  await assert.rejects(
    s.generator.publish({ reportId, ...s.order(reportId) }),
    (/** @type {unknown} */ error) => field(error, 'code') === REPORT_ERRORS.NOT_REVIEWED,
  );
});

test('تقريرٌ تغيّرت صفوفُه بعد توليدِه يُردّ بائتاً ولا يُنشر', async () => {
  const s = state();
  const row = await generated(s);
  const reportId = String(field(row, 'reportId'));
  await s.generator.review({
    reportId,
    reviewer: 'human:auditor-1',
    decision: 'accept',
    reason: REASON,
  });

  // مخالفةٌ جديدةٌ **في النافذةِ نفسِها** تُغيّر القياسَ لا الطلب.
  await s.repositories.institutionBreaches.insert({
    id: 'breach:late',
    institutionId: 'institution:stats',
    institutionKey: 'INST-01',
    code: 'MANDATE_POWER_NOT_GRANTED',
    domain: 'statistics',
    power: 'enforce',
    detail: 'صلاحيةٌ خارجَ ما أُنفِذ للمؤسسة',
    accountableTo: 'role:minister',
    escalateTo: 'role:chief-justice',
    detectedAt: new Date(s.now().getTime() - 30000),
  });

  await assert.rejects(
    s.generator.publish({ reportId, ...s.order(reportId) }),
    (/** @type {unknown} */ error) => field(error, 'code') === REPORT_ERRORS.STALE,
  );
  const stored = await s.repositories.royalReports.findById(reportId);
  assert.equal(field(stored, 'state'), REPORT_STATES.REVIEWED);
});

test('لا تقريران منشوران على نافذةٍ واحدةٍ ولا قبل أدنى المدةِ المعلَنة', async () => {
  const s = state();
  const row = await generated(s);
  const reportId = String(field(row, 'reportId'));
  await s.generator.review({
    reportId,
    reviewer: 'human:auditor-1',
    decision: 'accept',
    reason: REASON,
  });
  const window = s.window();
  await s.generator.publish({ reportId, ...s.order(reportId) });

  await assert.rejects(
    s.generator.generate({ actorRole: GENERATOR_ROLE, ...window, reportId: 'report:again' }),
    (/** @type {unknown} */ error) => field(error, 'code') === REPORT_ERRORS.TOO_SOON,
  );

  // ونافذةٌ أخرى قبل انقضاءِ أدنى المدةِ المعلَنةِ تُردّ كذلك.
  s.advance(60000);
  await assert.rejects(
    s.generator.generate({
      actorRole: GENERATOR_ROLE,
      periodStart: new Date(s.now().getTime() - POLICY.period.windowMs),
      periodEnd: new Date(s.now().getTime() - 500),
      reportId: 'report:soon',
    }),
    (/** @type {unknown} */ error) => field(error, 'code') === REPORT_ERRORS.TOO_SOON,
  );
});

test('ثوابتُ مواصفةِ التقريرِ ترفض صفّاً يخالفها', async () => {
  const s = state();
  const base = {
    id: 'report:manual',
    reportId: 'report:manual',
    periodStart: new Date('2026-05-01T00:00:00.000Z'),
    periodEnd: new Date('2026-05-31T00:00:00.000Z'),
    generatedBy: GENERATOR_ROLE,
    generatedAt: new Date('2026-05-31T00:00:01.000Z'),
    state: REPORT_STATES.GENERATED,
    fieldsDeclared: 1,
    fieldsMeasured: 1,
    fieldsEstimated: 0,
    digest: 'a'.repeat(64),
    sections: [
      {
        id: 'state.x',
        section: 'state',
        title: 'حقلٌ مقيس',
        value: 1,
        estimated: false,
        rowCount: 1,
        measuredFrom: 'state.institutions',
        assumption: null,
      },
    ],
    reviewer: null,
    reviewDecision: null,
    reviewReason: null,
    reviewedAt: null,
    publishCommandId: null,
    publishedAt: null,
    modelVersion: POLICY.version,
  };
  // ١. حقلٌ تقديريٌّ بلا فرضيةٍ يُردّ.
  await assert.rejects(
    s.repositories.royalReports.insert({
      ...base,
      fieldsMeasured: 0,
      fieldsEstimated: 1,
      sections: [{ ...base.sections[0], estimated: true, value: null, measuredFrom: null }],
    }),
    /ROYAL_REPORT_ESTIMATES_DECLARED/,
  );
  // ٢. نافذةٌ مقلوبةٌ تُردّ.
  await assert.rejects(
    s.repositories.royalReports.insert({
      ...base,
      periodStart: new Date('2026-05-31T00:00:00.000Z'),
      periodEnd: new Date('2026-05-01T00:00:00.000Z'),
    }),
    /ROYAL_REPORT_PERIOD_ORDERED/,
  );
  // ٣. مجموعٌ لا يطابق المعلَنَ يُردّ.
  await assert.rejects(
    s.repositories.royalReports.insert({ ...base, fieldsDeclared: 3 }),
    /ROYAL_REPORT_FIELDS_MEASURED/,
  );
  // ٤. نشرٌ بلا أمرٍ يُردّ.
  await assert.rejects(
    s.repositories.royalReports.insert({
      ...base,
      state: REPORT_STATES.PUBLISHED,
      reviewer: 'human:auditor-1',
      reviewDecision: 'accept',
      reviewReason: REASON,
      reviewedAt: new Date('2026-05-31T01:00:00.000Z'),
    }),
    /ROYAL_REPORT_PUBLISH_REQUIRES_REVIEW/,
  );
  // ٥. والصفُّ السليمُ يُقبل: الثوابتُ ترفض المخالفَ لا كلَّ شيء.
  const ok = await s.repositories.royalReports.insert(base);
  assert.equal(field(ok, 'reportId'), 'report:manual');
});
