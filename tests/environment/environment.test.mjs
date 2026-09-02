// اختباراتُ وحدةِ عقدِ البيئةِ والخطّةِ والمجسّات — الخطوة `M10.05`.
//
// ما يُقاس هنا هو **الرفضُ المُسمّى** و**الخطّةُ التابعةُ للوقائعِ** و**الحكمُ
// التابعُ للدرجاتِ**: فمعيارُ القبولِ («أمرٌ واحدٌ ⇒ نظامٌ عاملٌ ⇒ فحصٌ ناجح»)
// مقيسٌ وحدَه في `one-command.test.mjs` بعمليّاتٍ أبناءٍ حقيقيّة، وهذا الملفُّ
// يقيس ما دونَه ممّا لو انكسر لصارت الإقامةُ تُنفَّذ والفحصُ يُخضِّر وهما كاذبان.

import assert from 'node:assert/strict';
import path from 'node:path';
import process from 'node:process';
import test from 'node:test';

import {
  ENV_ERRORS,
  Environment,
  bootstrapPlan,
  evaluateProbes,
  exitCodeOf,
  healthVerdict,
  loadEnvironmentContract,
  versionInRange,
} from '../../src/environment/index.mjs';

const CONFIG_DIR = path.join(process.cwd(), 'config');
const CONTRACT = loadEnvironmentContract({ dir: CONFIG_DIR });

/** سجلٌّ ذاكريٌّ يكفي لقياسِ القيدِ — والقرصُ مقيسٌ في اختبارِ القبول. */
function memoryLog() {
  /** @type {Array<{ type: string, actor: string, data: Record<string, unknown> }>} */
  const entries = [];
  return {
    entries,
    append(/** @type {string} */ type, /** @type {string} */ actor, /** @type {object} */ data) {
      entries.push({ type, actor, data: /** @type {Record<string, unknown>} */ (data) });
      return entries.length;
    },
  };
}

/** @param {Partial<import('../../src/environment/plan.mjs').EnvironmentFacts>} [overrides] */
function facts(overrides = {}) {
  return {
    profile: 'development',
    presentTools: ['tool:node', 'tool:npm', 'tool:docker'],
    setVariables: ['DATABASE_URL'],
    ...overrides,
  };
}

test('العقدُ يُحمَّل من الوثيقةِ ويُعلن كلَّ ما تعتمد عليه الإقامةُ والفحص', () => {
  assert.equal(CONTRACT.version, 1);
  const profileIds = CONTRACT.profiles.map((profile) => profile.id);
  assert.ok(profileIds.includes('development'));
  assert.ok(profileIds.includes('ci'));
  assert.ok(profileIds.includes('production'));
  assert.ok(CONTRACT.phases.length > 0);
  assert.ok(CONTRACT.probes.length > 0);
  assert.ok(CONTRACT.directories.length > 0);
  // كلُّ طورٍ متكافئٌ — والضمان `G-ENV-IDEMPOTENT-BOOTSTRAP` ليس نيّةً.
  for (const phase of CONTRACT.phases) assert.equal(phase.idempotent, true);
});

test('رمزُ الخروجِ من الوثيقةِ لا من الكود، وحكمٌ غيرُ معلَنٍ يُرفَض باسمِه', () => {
  assert.equal(exitCodeOf(CONTRACT, 'healthy'), 0);
  assert.equal(exitCodeOf(CONTRACT, 'unfit') > 0, true);
  assert.throws(
    () => exitCodeOf(CONTRACT, 'مُخترَع'),
    (error) => /** @type {{ code?: string }} */ (error).code === ENV_ERRORS.VERDICT_UNDECLARED,
  );
});

test('مجالُ الإصدارِ يُقاس من الوثيقةِ: داخلَه يُقبَل وخارجَه يُرفَض', () => {
  const node = CONTRACT.toolchain.find((tool) => tool.id === 'tool:node');
  assert.ok(node !== undefined);
  assert.equal(versionInRange(node, 'v20.20.1').inRange, true);
  assert.equal(versionInRange(node, 'v22.1.0').inRange, false);
  assert.equal(versionInRange(node, 'v18.19.0').inRange, false);
  // نصٌّ لا إصدارَ فيه ليس إصداراً داخلَ المجال — فالغموضُ لا يُقرأ نجاحاً.
  assert.equal(versionInRange(node, 'لا إصدار').inRange, false);
});

test('الخطّةُ مرتَّبةٌ بترتيبِ الوثيقةِ لا بترتيبِ ما يخطر للمُنفِّذ', () => {
  const plan = bootstrapPlan(CONTRACT, facts());
  assert.deepEqual(
    plan.steps.map((step) => step.phase),
    CONTRACT.phases.map((phase) => phase.id),
  );
  assert.deepEqual(
    plan.directories,
    CONTRACT.directories.map((directory) => directory.path),
  );
});

test('التخطّي بسببٍ مُسمّى: أداةٌ غائبةٌ ⇒ tool-missing ولا يُدَّعى التنفيذ', () => {
  const plan = bootstrapPlan(CONTRACT, facts({ presentTools: ['tool:node', 'tool:npm'] }));
  const database = plan.steps.find((step) => step.phase === 'phase:database');
  assert.ok(database !== undefined);
  assert.equal(database.skipped, true);
  assert.equal(database.skipReason, 'tool-missing');
  assert.ok((database.skipStatement ?? '').length > 0);
});

test('التخطّي بسببٍ مُسمّى: متغيّرٌ غيرُ مضبوطٍ ⇒ variable-unset ولا قيمةَ تُصطنَع', () => {
  const plan = bootstrapPlan(CONTRACT, facts({ setVariables: [] }));
  const migrate = plan.steps.find((step) => step.phase === 'phase:migrate');
  assert.ok(migrate !== undefined);
  assert.equal(migrate.skipped, true);
  assert.equal(migrate.skipReason, 'variable-unset');
});

test('التخطّي بسببٍ مُسمّى: وضعٌ مُستثنىً ⇒ profile، وعدَّا التنفيذِ والتخطّي يستوفيان الأطوار', () => {
  const plan = bootstrapPlan(CONTRACT, facts({ profile: 'ci' }));
  const database = plan.steps.find((step) => step.phase === 'phase:database');
  assert.ok(database !== undefined);
  assert.equal(database.skipped, true);
  assert.equal(database.skipReason, 'profile');
  assert.equal(plan.executeCount + plan.skipCount, CONTRACT.phases.length);
});

test('وضعٌ غيرُ معلَنٍ يُرفَض باسمِه ولا يُقرأ افتراضاً صامتاً', () => {
  assert.throws(
    () => bootstrapPlan(CONTRACT, facts({ profile: 'staging' })),
    (error) => /** @type {{ code?: string }} */ (error).code === ENV_ERRORS.PROFILE_UNDECLARED,
  );
});

test('المجساتُ تُقيَّم بدرجاتِها، ومشاهدةٌ لمجسٍّ غيرِ معلَنٍ تُرفَض', () => {
  const observations = CONTRACT.probes.map((probe) => ({
    probe: probe.id,
    satisfied: true,
    detail: 'مشاهدةٌ مُصطنَعةٌ في الاختبار',
  }));
  const results = evaluateProbes(CONTRACT, observations);
  assert.equal(results.length, CONTRACT.probes.length);
  assert.throws(
    () =>
      evaluateProbes(CONTRACT, [
        ...observations,
        { probe: 'probe:مُخترَع', satisfied: true, detail: '' },
      ]),
    (error) => /** @type {{ code?: string }} */ (error).code === ENV_ERRORS.PROBE_UNDECLARED,
  );
});

test('مجسٌّ معلَنٌ بلا مشاهدةٍ يُرفَض — والصمتُ لا يُقرأ نجاحاً', () => {
  const observations = CONTRACT.probes
    .slice(1)
    .map((probe) => ({ probe: probe.id, satisfied: true, detail: '' }));
  assert.throws(
    () => evaluateProbes(CONTRACT, observations),
    (error) => /** @type {{ code?: string }} */ (error).code === ENV_ERRORS.PROBE_MISSING,
  );
});

test('مشاهدةٌ مكرَّرةٌ لمجسٍّ واحدٍ تُرفَض — فآخرُ قائلٍ يغلب أوّلَه بلا حكم', () => {
  const observations = CONTRACT.probes.map((probe) => ({
    probe: probe.id,
    satisfied: true,
    detail: '',
  }));
  const first = observations.at(0);
  assert.ok(first !== undefined);
  assert.throws(
    () => evaluateProbes(CONTRACT, [...observations, first]),
    (error) => /** @type {{ code?: string }} */ (error).code === ENV_ERRORS.PROBE_DUPLICATE,
  );
});

test('الحكمُ من الدرجاتِ: حاسمٌ واحدٌ ساقطٌ ⇒ unfit برمزٍ غيرِ صفريّ', () => {
  const observations = CONTRACT.probes.map((probe) => ({
    probe: probe.id,
    satisfied: probe.severity !== 'critical',
    detail: '',
  }));
  const report = healthVerdict(CONTRACT, evaluateProbes(CONTRACT, observations));
  assert.equal(report.verdict, 'unfit');
  assert.ok(report.exitCode > 0);
  assert.ok(report.criticalFailures > 0);
});

test('الحكمُ من الدرجاتِ: تحذيريٌّ ساقطٌ ⇒ degraded برمزٍ صفريٍّ والنقصُ مُسمّى', () => {
  const observations = CONTRACT.probes.map((probe) => ({
    probe: probe.id,
    satisfied: probe.severity !== 'warning',
    detail: '',
  }));
  const report = healthVerdict(CONTRACT, evaluateProbes(CONTRACT, observations));
  assert.equal(report.verdict, 'degraded');
  assert.equal(report.exitCode, 0);
  assert.ok(report.failed.length > 0);
  assert.ok(report.statement.length > 0);
});

test('الحكمُ من الدرجاتِ: كلُّ المجساتِ قائمةٌ ⇒ healthy برمزٍ صفريّ', () => {
  const observations = CONTRACT.probes.map((probe) => ({
    probe: probe.id,
    satisfied: true,
    detail: '',
  }));
  const report = healthVerdict(CONTRACT, evaluateProbes(CONTRACT, observations));
  assert.equal(report.verdict, 'healthy');
  assert.equal(report.exitCode, 0);
  assert.equal(report.failed.length, 0);
});

test('كلُّ قيدٍ في السجلِّ من نوعٍ معلَنٍ في audit.events، ونوعٌ مُخترَعٌ يُرفَض', () => {
  const log = memoryLog();
  const environment = new Environment({ contract: CONTRACT, log, nowMs: () => 1000 });
  environment.plan(facts(), { actor: 'tester@unit' });
  environment.recordPhase(
    { phase: 'phase:install', ok: true, exitCode: 0, durationMs: 5, detail: 'نُفِّذ' },
    { actor: 'tester@unit' },
  );
  environment.verify(
    CONTRACT.probes.map((probe) => ({ probe: probe.id, satisfied: true, detail: '' })),
    { actor: 'tester@unit' },
  );
  assert.equal(log.entries.length, 3);
  const declaredEvents = CONTRACT.audit.events.map((event) => event.type);
  for (const entry of log.entries) assert.ok(declaredEvents.includes(entry.type));
  assert.throws(
    () =>
      environment.recordPhase(
        { phase: 'phase:مُخترَع', ok: true, exitCode: 0, durationMs: 0, detail: '' },
        { actor: 'tester@unit' },
      ),
    (error) => /** @type {{ code?: string }} */ (error).code === ENV_ERRORS.PHASE_UNDECLARED,
  );
});

test('الساعةُ مُحقَنةٌ: ساعةٌ لا تُعطي رقماً منتهياً تُرفَض، وسجلٌّ غائبٌ يُرفَض', () => {
  const log = memoryLog();
  const broken = new Environment({ contract: CONTRACT, log, nowMs: () => Number.NaN });
  assert.throws(
    () => broken.plan(facts(), { actor: 'tester@unit' }),
    (error) => /** @type {{ code?: string }} */ (error).code === ENV_ERRORS.CLOCK_INVALID,
  );
  assert.throws(
    () => new Environment({ contract: CONTRACT, log: /** @type {never} */ (null) }),
    (error) => /** @type {{ code?: string }} */ (error).code === ENV_ERRORS.LOG_REQUIRED,
  );
});
