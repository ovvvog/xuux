/**
 * اختبارُ مستوياتِ الخدمة — الخطوة `M10.02`.
 *
 * القياسُ هنا على **الوحداتِ نفسِها** بساعةٍ مُقادةٍ وبوثائقَ تُبنى في
 * الاختبارِ لتُقاس حالاتُ الرفضِ بأعيانها: فوثيقةٌ واحدةٌ من القرصِ لا تُنتج
 * مقياساً يتيماً ولا نوعاً مُبدَّلاً، ومن لم يقس الرفضَ لم يقس الضمان. وأمّا
 * معيارُ قبولِ الخطوة — «لوحة تُظهر الأهداف والانحراف بأرقام» — فمقيسٌ في
 * `tests/service-levels/dashboard.test.mjs` على تركيبٍ حقيقيّ.
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import test from 'node:test';

import {
  SLO_ERRORS,
  ServiceLevelError,
  ServiceLevels,
  attainment,
  createServiceLevels,
  deviation,
  errorBudget,
  loadServiceLevelPolicy,
  objectiveStatus,
} from '../../src/service-levels/index.mjs';
import { MetricsRegistry } from '../../src/telemetry/index.mjs';

const GUARD = path.join(process.cwd(), 'scripts', 'guard-service-levels.mjs');

/**
 * @param {unknown} error
 * @returns {string | undefined}
 */
function codeOf(error) {
  return /** @type {{ code?: string }} */ (error).code;
}

/**
 * وثيقةُ قياسٍ مصغَّرةٌ تُبنى في الاختبار: فما يُقاس هنا سلوكُ الوحدةِ أمام
 * وثيقةٍ بعينِها لا أمام وثيقةِ المستودعِ وحدَها.
 * @param {ReadonlyArray<{ name: string, kind: 'counter' | 'histogram' }>} metrics
 */
function telemetryPolicyOf(metrics) {
  return /** @type {never} */ ({ metrics });
}

/**
 * @param {ReadonlyArray<{ name: string, kind: 'counter' | 'histogram' }>} metrics
 */
function registryOf(metrics) {
  return new MetricsRegistry(
    metrics.map((metric) => ({ ...metric, unit: '1', purpose: 'قياسُ اختبارٍ' })),
  );
}

const RATIO_METRICS = /** @type {const} */ ([
  { name: 'x.count', kind: 'counter' },
  { name: 'x.bad', kind: 'counter' },
]);

/**
 * @param {{ target: number }} options
 */
function ratioPolicy({ target }) {
  return /** @type {import('../../src/service-levels/service-levels.mjs').ServiceLevelPolicy} */ ({
    version: 1,
    statement: 'وثيقةُ اختبارٍ لهدفٍ نسبيٍّ واحدٍ يُقاس على عدّادَين مُعلَنَين.',
    window: { scope: 'process', statement: 'النافذةُ عمرُ العمليةِ في الاختبار.' },
    capabilities: [
      {
        id: 'capability:probe',
        statement: 'قدرةُ اختبارٍ واحدةٌ يُقاس عليها هدفٌ واحدٌ.',
        objectives: [
          {
            id: 'slo:probe.availability',
            kind: 'ratio',
            totalMetric: 'x.count',
            badMetric: 'x.bad',
            target,
            statement: 'نسبةُ ما لم يُرَدَّ من مجموعِ ما دخل.',
          },
        ],
      },
    ],
    errorBudget: {
      statement: 'ميزانيةٌ مشتقّةٌ من الهدفِ حساباً لا مكتوبةٌ إلى جانبِه.',
      policy: {
        onExhausted: 'refuse-assertion',
        statement: 'أثرُ الاستنفادِ مِقبضُ رفضٍ لا تجميدُ نشرٍ.',
      },
    },
    refusalCodes: [...Object.values(SLO_ERRORS)],
    guarantees: [],
  });
}

// ───────────────────────── الحسابُ نقيّاً ─────────────────────────

test('صفرُ أحداثٍ ليس التزاماً تامّاً: النسبةُ `null` لا واحدٌ', () => {
  assert.equal(attainment({ good: 0, total: 0 }), null);
  assert.equal(deviation({ measured: null, target: 0.9 }), null);
  assert.equal(objectiveStatus({ measured: null, target: 0.9 }), 'unmeasured');
});

test('الميزانيةُ تُشتقّ من الهدفِ ولا تُكتب إلى جانبِه', () => {
  const reading = errorBudget({ total: 1000, bad: 3, target: 0.99 });
  assert.equal(reading.allowed, 10);
  assert.equal(reading.consumed, 3);
  assert.equal(reading.remaining, 7);
  assert.equal(reading.consumedRatio, 0.3);
  assert.equal(reading.exhausted, false);
  assert.ok(Object.isFrozen(reading));

  // وتشديدُ الهدفِ **وحدَه** يضيّق المسموحَ: وهذا معنى «الميزانيةُ تُحسَب
  // ولا تُكتب» مقيساً لا موصوفاً.
  const stricter = errorBudget({ total: 1000, bad: 3, target: 0.999 });
  assert.equal(stricter.allowed, 1);
  assert.equal(stricter.exhausted, true);
});

test('ميزانيةٌ معدومةٌ لا تُقرأ نسبةً: `null` لا قسمةٌ على صفر', () => {
  const reading = errorBudget({ total: 0, bad: 0, target: 0.99 });
  assert.equal(reading.allowed, 0);
  assert.equal(reading.consumedRatio, null);
  assert.equal(reading.exhausted, false);
  // وأمّا مُخفِقٌ بلا مسموحٍ فمستنفَدٌ: إخفاقٌ واحدٌ في ميزانيةٍ معدومةٍ تجاوزٌ.
  assert.equal(errorBudget({ total: 0, bad: 1, target: 0.99 }).exhausted, true);
});

// ───────────────────── الوثيقةُ مصدرُ الحقيقةِ الواحد ─────────────────────

test('وثيقةُ المستودعِ تُحمَّل بمخطَّطها وتُعلن قدراتِها وأهدافَها', () => {
  const policy = loadServiceLevelPolicy();
  assert.equal(policy.version, 1);
  assert.equal(policy.window.scope, 'process');
  const ids = policy.capabilities.flatMap((capability) =>
    capability.objectives.map((objective) => objective.id),
  );
  assert.deepEqual(ids, ['slo:api.availability', 'slo:api.latency', 'slo:storage.latency']);
  // وكلُّ رمزٍ في الكتالوجِ مُعلَنٌ في الوثيقةِ وبالعكس — والحاجزُ يحرسه، وهذا
  // قياسُه سلوكاً لا نصّاً.
  assert.deepEqual([...policy.refusalCodes].sort(), [...Object.values(SLO_ERRORS)].sort());
});

test('وثيقةٌ غائبةٌ تُرَدُّ برمزِها ولا تُبتدأ لوحةٌ بأهدافٍ افتراضية', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'slo-'));
  assert.throws(
    () => loadServiceLevelPolicy({ dir }),
    (/** @type {unknown} */ error) => codeOf(error) === SLO_ERRORS.CONFIG_INVALID,
  );
});

test('وثيقةٌ تُخالف مخطَّطَها تُرَدُّ ولا تُقرأ نصّاً حرّاً', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'slo-'));
  fs.writeFileSync(path.join(dir, 'service-levels.yaml'), 'version: 1\ncapabilities: []\n', 'utf8');
  assert.throws(
    () => loadServiceLevelPolicy({ dir }),
    (/** @type {unknown} */ error) => codeOf(error) === SLO_ERRORS.CONFIG_INVALID,
  );
});

// ───────────────────── مصدرُ الحقيقةِ لا يُخترَع ─────────────────────

test('بلا سجلِّ مقاييسَ لا لوحةَ: رفضٌ مُسمّىً لا لوحةٌ صفريةٌ تُقرأ قياساً', () => {
  assert.throws(
    () =>
      new ServiceLevels({
        policy: ratioPolicy({ target: 0.99 }),
        telemetryPolicy: telemetryPolicyOf(RATIO_METRICS),
        metrics: /** @type {never} */ (undefined),
      }),
    (/** @type {unknown} */ error) => codeOf(error) === SLO_ERRORS.METRICS_REQUIRED,
  );
});

test('بلا وثيقةِ قياسٍ لا لوحةَ: لا يُفرَّق بين مقياسٍ غائبٍ ومقياسٍ لم يقع تحته حدث', () => {
  assert.throws(
    () =>
      new ServiceLevels({
        policy: ratioPolicy({ target: 0.99 }),
        telemetryPolicy: /** @type {never} */ (null),
        metrics: /** @type {never} */ (registryOf(RATIO_METRICS)),
      }),
    (/** @type {unknown} */ error) => codeOf(error) === SLO_ERRORS.POLICY_REQUIRED,
  );
});

test('هدفٌ على مقياسٍ غيرِ مُعلَنٍ يُرَدُّ عند التركيبِ لا عند أوّلِ قراءة', () => {
  assert.throws(
    () =>
      new ServiceLevels({
        policy: ratioPolicy({ target: 0.99 }),
        telemetryPolicy: telemetryPolicyOf([{ name: 'x.count', kind: 'counter' }]),
        metrics: /** @type {never} */ (registryOf(RATIO_METRICS)),
      }),
    (/** @type {unknown} */ error) => codeOf(error) === SLO_ERRORS.METRIC_UNDECLARED,
  );
});

test('نوعُ مقياسٍ مُبدَّلٌ يُرَدُّ: عدّادٌ يُقرأ مدرجاً كذبٌ بنيويّ', () => {
  assert.throws(
    () =>
      new ServiceLevels({
        policy: ratioPolicy({ target: 0.99 }),
        telemetryPolicy: telemetryPolicyOf([
          { name: 'x.count', kind: 'counter' },
          { name: 'x.bad', kind: 'histogram' },
        ]),
        metrics: /** @type {never} */ (registryOf(RATIO_METRICS)),
      }),
    (/** @type {unknown} */ error) => codeOf(error) === SLO_ERRORS.METRIC_KIND_MISMATCH,
  );
});

test('مقياسٌ يتيمٌ يُرَدُّ به التركيبُ: عمودٌ يُملأ ولا يُقرأ ليس قياساً', () => {
  assert.throws(
    () =>
      new ServiceLevels({
        policy: ratioPolicy({ target: 0.99 }),
        telemetryPolicy: telemetryPolicyOf([
          ...RATIO_METRICS,
          { name: 'x.orphan', kind: 'counter' },
        ]),
        metrics: /** @type {never} */ (registryOf(RATIO_METRICS)),
      }),
    (/** @type {unknown} */ error) => codeOf(error) === SLO_ERRORS.METRIC_ORPHANED,
  );
});

test('ساعةٌ لا تُعيد عدداً منتهياً تُرَدُّ: نافذةٌ بلا مدًى تُبطل كلَّ رقمٍ فوقها', () => {
  const build = (/** @type {() => number} */ now) =>
    new ServiceLevels({
      policy: ratioPolicy({ target: 0.99 }),
      telemetryPolicy: telemetryPolicyOf(RATIO_METRICS),
      metrics: /** @type {never} */ (registryOf(RATIO_METRICS)),
      now,
    });
  assert.throws(
    () => build(/** @type {never} */ ('ليست دالّةً')),
    (/** @type {unknown} */ error) => codeOf(error) === SLO_ERRORS.CLOCK_INVALID,
  );
  assert.throws(
    () => build(() => Number.NaN),
    (/** @type {unknown} */ error) => codeOf(error) === SLO_ERRORS.CLOCK_INVALID,
  );
});

// ───────────────────── اللوحةُ أرقاماً لا وصفاً ─────────────────────

/**
 * @param {{ target: number, total: number, bad: number, ticks?: number[] }} options
 */
function ratioDashboard({ target, total, bad, ticks }) {
  const metrics = registryOf(RATIO_METRICS);
  // والوسومُ **مختلفةٌ قصداً**: المؤشِّرُ يجمع على السلاسلِ كلِّها، ومن قرأ
  // وسماً فارغاً قرأ صفراً والنداءاتُ معدودةٌ في غيرِه.
  for (let index = 0; index < total; index += 1) {
    metrics.addCounter('x.count', 1, { route: index % 2 === 0 ? 'a' : 'b' });
  }
  for (let index = 0; index < bad; index += 1) metrics.addCounter('x.bad', 1, { code: 'R' });
  const queue = [...(ticks ?? [1_000, 1_500])];
  const levels = createServiceLevels({
    policy: ratioPolicy({ target }),
    telemetryPolicy: telemetryPolicyOf(RATIO_METRICS),
    metrics: /** @type {never} */ (metrics),
    now: () => /** @type {number} */ (queue.shift() ?? 9_999),
  });
  return { levels, metrics };
}

test('اللوحةُ تُظهر الهدفَ والمقيسَ والانحرافَ أرقاماً، وتجمع على السلاسلِ كلِّها', () => {
  const { levels } = ratioDashboard({ target: 0.99, total: 1000, bad: 5 });
  const board = levels.dashboard();
  assert.equal(board.window.scope, 'process');
  assert.equal(board.window.ageMs, 500);
  const [capability] = board.capabilities;
  const row = /** @type {import('../../src/service-levels/service-levels.mjs').ObjectiveRow} */ (
    capability?.objectives[0]
  );
  assert.equal(row.events.total, 1000, 'المجموعُ لم يُجمَع على وسومِه — والصفرُ هنا كذبٌ مُطمئن.');
  assert.equal(row.events.bad, 5);
  assert.equal(row.measured, 0.995);
  assert.equal(row.target, 0.99);
  assert.ok(Math.abs(/** @type {number} */ (row.deviation) - 0.005) < 1e-12);
  assert.equal(row.status, 'meeting');
  assert.equal(row.errorBudget.allowed, 10);
  assert.equal(row.errorBudget.remaining, 5);
  assert.deepEqual(board.summary, {
    objectives: 1,
    meeting: 1,
    breaching: 0,
    unmeasured: 0,
    budgetsExhausted: 0,
  });
  assert.ok(Object.isFrozen(row));
});

test('الانحرافُ يُعرض سالباً عند الإخفاقِ ولا يُطوى في وصفٍ', () => {
  const { levels } = ratioDashboard({ target: 0.99, total: 100, bad: 5 });
  const row = levels.objective('slo:probe.availability');
  assert.equal(row.measured, 0.95);
  assert.ok(/** @type {number} */ (row.deviation) < 0);
  assert.equal(row.status, 'breaching');
  assert.equal(row.errorBudget.exhausted, true);
  assert.throws(
    () => levels.assertWithinBudget('slo:probe.availability'),
    (/** @type {unknown} */ error) => codeOf(error) === SLO_ERRORS.BUDGET_EXHAUSTED,
  );
});

test('تشديدُ الهدفِ في الوثيقةِ **وحدَه** يبدّل الحكمَ: الأهدافُ بياناتٌ لا كود', () => {
  const lenient = ratioDashboard({ target: 0.9, total: 100, bad: 5 }).levels.objective(
    'slo:probe.availability',
  );
  const strict = ratioDashboard({ target: 0.99, total: 100, bad: 5 }).levels.objective(
    'slo:probe.availability',
  );
  assert.equal(lenient.measured, strict.measured, 'المقيسُ واحدٌ — فالمُبدَّلُ هو الهدفُ وحدَه.');
  assert.equal(lenient.status, 'meeting');
  assert.equal(strict.status, 'breaching');
  assert.ok(/** @type {number} */ (lenient.deviation) > /** @type {number} */ (strict.deviation));
});

test('هدفٌ لم يقع تحته حدثٌ يُعرض «غيرَ مقيسٍ» ويُرَدُّ الجزمُ به', () => {
  const { levels } = ratioDashboard({ target: 0.99, total: 0, bad: 0 });
  const row = levels.objective('slo:probe.availability');
  assert.equal(row.measured, null);
  assert.equal(row.deviation, null);
  assert.equal(row.status, 'unmeasured');
  assert.throws(
    () => levels.assertWithinBudget('slo:probe.availability'),
    (/** @type {unknown} */ error) => codeOf(error) === SLO_ERRORS.MEASUREMENT_UNAVAILABLE,
  );
});

test('هدفٌ في سعتِه يُعاد صفُّه لا يُرَدُّ', () => {
  const { levels } = ratioDashboard({ target: 0.99, total: 1000, bad: 2 });
  const row = levels.assertWithinBudget('slo:probe.availability');
  assert.equal(row.status, 'meeting');
  assert.equal(row.errorBudget.exhausted, false);
});

test('معرّفُ هدفٍ غيرُ مُعلَنٍ يُرَدُّ برمزِه لا يُجاب عنه بلوحةٍ لا يعرفها أحد', () => {
  const { levels } = ratioDashboard({ target: 0.99, total: 10, bad: 0 });
  assert.throws(
    () => levels.objective('slo:invented'),
    (/** @type {unknown} */ error) =>
      error instanceof ServiceLevelError && error.code === SLO_ERRORS.OBJECTIVE_UNDECLARED,
  );
  assert.deepEqual(levels.objectiveIds(), ['slo:probe.availability']);
});

test('القراءةُ لا تُبدّل المقيس: قارئانِ متعاقبانِ يريانِ الرقمَ نفسَه', () => {
  const { levels, metrics } = ratioDashboard({
    target: 0.99,
    total: 200,
    bad: 1,
    ticks: [0, 1, 2, 3, 4, 5],
  });
  const first = levels.dashboard();
  const second = levels.dashboard();
  const rowOf = (/** @type {ReturnType<typeof levels.dashboard>} */ board) =>
    /** @type {import('../../src/service-levels/service-levels.mjs').ObjectiveRow} */ (
      board.capabilities[0]?.objectives[0]
    );
  assert.equal(rowOf(first).events.total, rowOf(second).events.total);
  assert.equal(rowOf(first).measured, rowOf(second).measured);
  assert.equal(metrics.counterTotal('x.count'), 200);
});

// ───────────────────── المدّةُ والمعاينةُ ─────────────────────

test('مؤشِّرُ المدّةِ يعدّ ما أتمّ دون العتبةِ، ويُعلن المعاينةَ حين تقع', () => {
  const metrics = registryOf([
    { name: 'y.count', kind: 'counter' },
    { name: 'y.duration', kind: 'histogram' },
  ]);
  const threshold = 100;
  const values = [10, 20, 30, 500];
  for (const value of values) {
    metrics.addCounter('y.count', 1, { route: 'a' });
    metrics.recordHistogram('y.duration', value, { route: 'a' });
  }
  const policy =
    /** @type {import('../../src/service-levels/service-levels.mjs').ServiceLevelPolicy} */ ({
      version: 1,
      statement: 'وثيقةُ اختبارٍ لهدفِ مدّةٍ واحدٍ يُقاس على مدرجٍ مُعلَن.',
      window: { scope: 'process', statement: 'النافذةُ عمرُ العمليةِ في الاختبار.' },
      capabilities: [
        {
          id: 'capability:probe',
          statement: 'قدرةُ اختبارٍ واحدةٌ يُقاس عليها هدفُ مدّةٍ واحد.',
          objectives: [
            {
              id: 'slo:probe.latency',
              kind: 'latency',
              totalMetric: 'y.count',
              durationMetric: 'y.duration',
              thresholdMs: threshold,
              target: 0.9,
              statement: 'نسبةُ ما أتمّ دون العتبةِ المُعلَنة.',
            },
          ],
        },
      ],
      errorBudget: {
        statement: 'ميزانيةٌ مشتقّةٌ من الهدفِ حساباً لا مكتوبةٌ إلى جانبِه.',
        policy: {
          onExhausted: 'refuse-assertion',
          statement: 'أثرُ الاستنفادِ مِقبضُ رفضٍ لا تجميدُ نشرٍ.',
        },
      },
      refusalCodes: [...Object.values(SLO_ERRORS)],
      guarantees: [],
    });
  let tick = 0;
  const levels = createServiceLevels({
    policy,
    telemetryPolicy: telemetryPolicyOf([
      { name: 'y.count', kind: 'counter' },
      { name: 'y.duration', kind: 'histogram' },
    ]),
    metrics: /** @type {never} */ (metrics),
    now: () => (tick += 1),
  });
  const row = levels.objective('slo:probe.latency');
  assert.equal(row.thresholdMs, threshold);
  assert.equal(row.events.total, values.length);
  assert.equal(row.events.good, 3);
  assert.equal(row.events.bad, 1);
  assert.equal(row.measured, 0.75);
  assert.equal(row.status, 'breaching');
  assert.equal(row.sampled, false);
  assert.equal(row.observed.calls, values.length);
  assert.equal(row.observed.durationsRecorded, values.length);
  assert.equal(row.observed.durationsRetained, values.length);
});

test('مدرجٌ لم يُنادَ يُعطي «غيرَ مقيسٍ» صراحةً ولا يُقرأ التزاماً تامّاً', () => {
  const metrics = registryOf([
    { name: 'y.count', kind: 'counter' },
    { name: 'y.duration', kind: 'histogram' },
  ]);
  // نداءاتٌ معدودةٌ ومدّاتٌ غيرُ مسجَّلةٍ: **هذا بعينِه** الموضعُ الذي يُقرأ فيه
  // الفراغُ نجاحاً لو أُعيد `1`؛ ويُعلن `observed.calls` الفجوةَ لا يطويها.
  metrics.addCounter('y.count', 5, { route: 'a' });
  const policy =
    /** @type {import('../../src/service-levels/service-levels.mjs').ServiceLevelPolicy} */ ({
      version: 1,
      statement: 'وثيقةُ اختبارٍ لهدفِ مدّةٍ بلا مدّاتٍ مسجَّلة.',
      window: { scope: 'process', statement: 'النافذةُ عمرُ العمليةِ في الاختبار.' },
      capabilities: [
        {
          id: 'capability:probe',
          statement: 'قدرةُ اختبارٍ واحدةٌ يُقاس عليها هدفُ مدّةٍ واحد.',
          objectives: [
            {
              id: 'slo:probe.latency',
              kind: 'latency',
              totalMetric: 'y.count',
              durationMetric: 'y.duration',
              thresholdMs: 100,
              target: 0.9,
              statement: 'نسبةُ ما أتمّ دون العتبةِ المُعلَنة.',
            },
          ],
        },
      ],
      errorBudget: {
        statement: 'ميزانيةٌ مشتقّةٌ من الهدفِ حساباً لا مكتوبةٌ إلى جانبِه.',
        policy: {
          onExhausted: 'refuse-assertion',
          statement: 'أثرُ الاستنفادِ مِقبضُ رفضٍ لا تجميدُ نشرٍ.',
        },
      },
      refusalCodes: [...Object.values(SLO_ERRORS)],
      guarantees: [],
    });
  let tick = 0;
  const levels = createServiceLevels({
    policy,
    telemetryPolicy: telemetryPolicyOf([
      { name: 'y.count', kind: 'counter' },
      { name: 'y.duration', kind: 'histogram' },
    ]),
    metrics: /** @type {never} */ (metrics),
    now: () => (tick += 1),
  });
  const row = levels.objective('slo:probe.latency');
  assert.equal(row.measured, null);
  assert.equal(row.status, 'unmeasured');
  assert.equal(row.observed.calls, 5);
  assert.equal(row.observed.durationsRetained, null);
});

// ───────────────────────── الحاجزُ يعمل ─────────────────────────

test('حاجزُ مستوياتِ الخدمةِ يمرّ على المستودعِ كما هو', () => {
  const result = spawnSync(process.execPath, [GUARD], { encoding: 'utf8' });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /حاجز مستويات الخدمة/u);
});
