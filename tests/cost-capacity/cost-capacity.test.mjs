// اختباراتُ وحدةِ دفترِ التكلفةِ والسعة — الخطوة `M10.04`.
//
// ما يُقاس هنا هو **الرفضُ المُسمّى** و**الحسابُ الصحيح** و**تبعيةُ الحكمِ
// للوثيقةِ**: فمعيارُ القبولِ مقيسٌ وحدَه في `monthly-report.test.mjs`، وهذا
// الملفُّ يقيس ما دونَه ممّا لو انكسر لصار التقريرُ يُولَّد ويُقرأ وهو كاذب.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import test from 'node:test';
import { registerTmpRoot } from '../helpers/tmp-roots.mjs';

import YAML from 'yaml';

import {
  COST_ERRORS,
  CostCapacity,
  costMilliOf,
  evaluateCapacity,
  evaluateDeviation,
  loadCostCapacityPolicy,
  periodOf,
} from '../../src/cost-capacity/index.mjs';

const CONFIG_DIR = path.join(process.cwd(), 'config');
const POLICY = loadCostCapacityPolicy({ dir: CONFIG_DIR });

const INSTITUTION = 'institution:digital-administration';
const AGENT = 'agent:planner-001';
const MODEL = 'model:sovereign-base';

/** سجلٌّ ذاكريٌّ يكفي لقياسِ الرفضِ والقيد — والقرصُ مقيسٌ في اختبارِ القبول. */
function memoryLog() {
  /** @type {Array<{ type: string, actor: string, data: Record<string, unknown> }>} */
  const entries = [];
  return {
    entries,
    append(/** @type {string} */ type, /** @type {string} */ actor, /** @type {object} */ data) {
      const record = { type, actor, data: /** @type {Record<string, unknown>} */ (data) };
      entries.push(record);
      return record;
    },
  };
}

/** @param {{ nowMs?: () => number, log?: ReturnType<typeof memoryLog> | null }} [options] */
function ledgerOn(options = {}) {
  const log = options.log === undefined ? memoryLog() : options.log;
  const ledger = new CostCapacity({
    policy: POLICY,
    log,
    ledger: () => (log === null ? [] : log.entries),
    operations: null,
    nowMs: options.nowMs ?? (() => Date.UTC(2026, 4, 10, 12)),
  });
  return { log, ledger };
}

test('الوثيقةُ تُحمَّل بمخطَّطِها، ووصفُ الدفترِ يُطابق ما فيها لا ما في الكود', () => {
  const described = new CostCapacity({ policy: POLICY, nowMs: () => 0 }).describe();
  assert.deepEqual(
    described.items,
    POLICY.costItems.map((item) => item.id),
  );
  assert.deepEqual(described.dimensions, ['institution', 'agent', 'model']);
  assert.deepEqual(described.sections, POLICY.report.requiredSections);
  assert.equal(described.unit, POLICY.accounting.unit);
});

test('بندٌ غيرُ معلَنٍ وصاحبٌ ناقصٌ وبادئةٌ مخالفةٌ ومؤسسةٌ غيرُ مُشغَّلةٍ — كلٌّ يُرَدُّ برمزِه ويُقيَّد رفضُه', () => {
  const { log, ledger } = ledgerOn();
  const item = POLICY.costItems[0]?.id;
  assert.ok(item !== undefined);

  assert.throws(
    () =>
      ledger.record({
        item: 'cost:invented',
        quantity: 1,
        institution: INSTITUTION,
        agent: AGENT,
        model: MODEL,
      }),
    (/** @type {import('../../src/cost-capacity/errors.mjs').CostCapacityError} */ error) =>
      error.code === COST_ERRORS.ITEM_UNDECLARED,
  );
  assert.throws(
    () => ledger.record({ item, quantity: 1, agent: AGENT, model: MODEL }),
    (/** @type {import('../../src/cost-capacity/errors.mjs').CostCapacityError} */ error) =>
      error.code === COST_ERRORS.SUBJECT_UNDECLARED,
  );
  assert.throws(
    () => ledger.record({ item, quantity: 1, institution: 'agent:x', agent: AGENT, model: MODEL }),
    (/** @type {import('../../src/cost-capacity/errors.mjs').CostCapacityError} */ error) =>
      error.code === COST_ERRORS.SUBJECT_UNDECLARED,
  );
  assert.throws(
    () =>
      ledger.record({
        item,
        quantity: 1,
        institution: 'institution:not-operational',
        agent: AGENT,
        model: MODEL,
      }),
    (/** @type {import('../../src/cost-capacity/errors.mjs').CostCapacityError} */ error) =>
      error.code === COST_ERRORS.SUBJECT_UNDECLARED,
  );
  assert.throws(
    () =>
      ledger.record({ item, quantity: -5, institution: INSTITUTION, agent: AGENT, model: MODEL }),
    (/** @type {import('../../src/cost-capacity/errors.mjs').CostCapacityError} */ error) =>
      error.code === COST_ERRORS.QUANTITY_INVALID,
  );

  const refusals =
    log === null ? [] : log.entries.filter((entry) => entry.type === POLICY.audit.refusedEvent);
  assert.equal(refusals.length, 5, 'الرفضُ يُكتب كما يُكتب القبول — وخمسةُ ردودٍ خمسةُ قيود.');
});

test('لا سجلَّ ولا قارئَ ولا مركزَ عملياتٍ — ثلاثةُ ردودٍ مُسمّاةٍ لا دفترٌ صفريٌّ يُقرأ قياساً', () => {
  const bare = new CostCapacity({ policy: POLICY, nowMs: () => 0 });
  assert.throws(
    () =>
      bare.record({
        item: POLICY.costItems[0]?.id,
        quantity: 1,
        institution: INSTITUTION,
        agent: AGENT,
        model: MODEL,
      }),
    (/** @type {import('../../src/cost-capacity/errors.mjs').CostCapacityError} */ error) =>
      error.code === COST_ERRORS.LOG_REQUIRED,
  );
  const withLog = new CostCapacity({ policy: POLICY, log: memoryLog(), nowMs: () => 0 });
  assert.throws(
    () => withLog.report({ period: '2026-03' }),
    (/** @type {import('../../src/cost-capacity/errors.mjs').CostCapacityError} */ error) =>
      error.code === COST_ERRORS.LEDGER_REQUIRED,
  );
  const { ledger } = ledgerOn();
  assert.throws(
    () => ledger.evaluate({ period: '2026-05' }),
    (/** @type {import('../../src/cost-capacity/errors.mjs').CostCapacityError} */ error) =>
      error.code === COST_ERRORS.OPERATIONS_REQUIRED,
  );
});

test('ساعةٌ لا تُعيد عدداً منتهياً وشهرٌ على غيرِ صيغتِه — يُرَدَّانِ برمزيهما', () => {
  const { ledger } = ledgerOn({ nowMs: () => Number.NaN });
  assert.throws(
    () =>
      ledger.record({
        item: POLICY.costItems[0]?.id,
        quantity: 1,
        institution: INSTITUTION,
        agent: AGENT,
        model: MODEL,
      }),
    (/** @type {import('../../src/cost-capacity/errors.mjs').CostCapacityError} */ error) =>
      error.code === COST_ERRORS.CLOCK_INVALID,
  );
  const sane = ledgerOn().ledger;
  assert.throws(
    () => sane.report({ period: '2026-13' }),
    (/** @type {import('../../src/cost-capacity/errors.mjs').CostCapacityError} */ error) =>
      error.code === COST_ERRORS.PERIOD_INVALID,
  );
  assert.throws(
    () => sane.report({ period: 'آذار' }),
    (/** @type {import('../../src/cost-capacity/errors.mjs').CostCapacityError} */ error) =>
      error.code === COST_ERRORS.PERIOD_INVALID,
  );
});

test('شهرُ القيدِ من ختمِه بالتوقيتِ العالميِّ لا من ساعةِ قارئِه', () => {
  assert.equal(periodOf(Date.UTC(2026, 0, 31, 23, 59, 59)), '2026-01');
  assert.equal(periodOf(Date.UTC(2026, 1, 1, 0, 0, 0)), '2026-02');
  assert.throws(
    () => periodOf(Number.POSITIVE_INFINITY),
    (/** @type {import('../../src/cost-capacity/errors.mjs').CostCapacityError} */ error) =>
      error.code === COST_ERRORS.PERIOD_INVALID,
  );
});

test('الحسابُ بالأعدادِ الصحيحةِ والتقريبُ عند القيدِ لا عند الجمع', () => {
  const item = { id: 'cost:x', resource: 'x', perUnits: 1000, unitPriceMilli: 3 };
  // ثلاثةُ قيودٍ كلٌّ منها يُقرَّب وحدَه: ٢ + ٢ + ٢ = ٦، لا تقريبَ ٥٫٢٥ إلى ٥.
  const perEntry = costMilliOf({ item, quantity: 500 }) * 3;
  assert.equal(costMilliOf({ item, quantity: 500 }), 2);
  assert.equal(perEntry, 6);
  assert.equal(costMilliOf({ item, quantity: 0 }), 0);
  assert.throws(
    () => costMilliOf({ item, quantity: 1.5 }),
    (/** @type {import('../../src/cost-capacity/errors.mjs').CostCapacityError} */ error) =>
      error.code === COST_ERRORS.QUANTITY_INVALID,
  );
});

test('تشديدُ سقفٍ أو خطِّ أساسٍ في الوثيقةِ وحدَه يقلب الحكمَ بلا سطرِ كودٍ يُغيَّر', () => {
  /** @type {Map<string, Map<string, { units: number, costMilli: number, entries: number }>>} */
  const totals = new Map([
    [
      INSTITUTION,
      new Map([['cost:inference-tokens', { units: 1000, costMilli: 2000, entries: 1 }]]),
    ],
  ]);
  /** @param {'institution' | 'agent' | 'model'} dimension */
  const totalsFor = (dimension) => (dimension === 'institution' ? totals : new Map());

  const loose = evaluateCapacity({
    limits: [
      {
        id: 'capacity:x',
        dimension: 'institution',
        item: 'cost:inference-tokens',
        limitUnits: 2000,
        severity: 'warning',
      },
    ],
    totalsFor,
  });
  const strict = evaluateCapacity({
    limits: [
      {
        id: 'capacity:x',
        dimension: 'institution',
        item: 'cost:inference-tokens',
        limitUnits: 500,
        severity: 'warning',
      },
    ],
    totalsFor,
  });
  assert.equal(loose[0]?.status, 'within');
  assert.equal(strict[0]?.status, 'exceeded');

  const quiet = evaluateDeviation({
    rules: [
      {
        id: 'deviation:x',
        dimension: 'institution',
        item: 'cost:inference-tokens',
        baselineUnits: 1000,
        toleranceRatio: 0.5,
        severity: 'warning',
        channel: 'channel:audit-desk',
      },
    ],
    totalsFor,
  });
  const firing = evaluateDeviation({
    rules: [
      {
        id: 'deviation:x',
        dimension: 'institution',
        item: 'cost:inference-tokens',
        baselineUnits: 500,
        toleranceRatio: 0.1,
        severity: 'warning',
        channel: 'channel:audit-desk',
      },
    ],
    totalsFor,
  });
  assert.equal(quiet[0]?.firing, false);
  assert.equal(firing[0]?.firing, true);
});

test('حدٌّ لم يقع تحته قيدٌ يُعاد «غيرَ مقيسٍ» ولا يُطوى من اللوحة', () => {
  const rows = evaluateCapacity({
    limits: [
      {
        id: 'capacity:empty',
        dimension: 'model',
        item: 'cost:inference-tokens',
        limitUnits: 10,
        severity: 'critical',
      },
    ],
    totalsFor: () => new Map(),
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.status, 'unmeasured');
  assert.equal(rows[0]?.subject, null);
});

test('وثيقةٌ تخالف مخطَّطَها أو تُسقِط بُعداً من الثلاثةِ توقف التحميلَ ولا تُبتدأ بأسعارٍ افتراضية', () => {
  const directory = registerTmpRoot(fs.mkdtempSync(path.join(os.tmpdir(), 'xuux-cost-cfg-')));
  fs.mkdirSync(path.join(directory, 'schemas'));
  fs.copyFileSync(
    path.join(CONFIG_DIR, 'schemas', 'cost-capacity.schema.json'),
    path.join(directory, 'schemas', 'cost-capacity.schema.json'),
  );
  const raw = YAML.parse(fs.readFileSync(path.join(CONFIG_DIR, 'cost-capacity.yaml'), 'utf8'));

  raw.dimensions = raw.dimensions.filter(
    (/** @type {{ id: string }} */ dimension) => dimension.id !== 'model',
  );
  fs.writeFileSync(path.join(directory, 'cost-capacity.yaml'), YAML.stringify(raw), 'utf8');
  assert.throws(
    () => loadCostCapacityPolicy({ dir: directory }),
    (/** @type {import('../../src/cost-capacity/errors.mjs').CostCapacityError} */ error) =>
      error.code === COST_ERRORS.CONFIG_INVALID,
  );

  fs.rmSync(path.join(directory, 'cost-capacity.yaml'));
  assert.throws(
    () => loadCostCapacityPolicy({ dir: directory }),
    (/** @type {import('../../src/cost-capacity/errors.mjs').CostCapacityError} */ error) =>
      error.code === COST_ERRORS.CONFIG_INVALID,
  );
});

test('كلُّ بندِ كلفةٍ مربوطٌ بموردٍ معلَنٍ في وثيقةِ الحصص — لا قائمةَ مواردَ ثانيةً', () => {
  const quotas = YAML.parse(fs.readFileSync(path.join(CONFIG_DIR, 'quotas.yaml'), 'utf8'));
  const resources = new Set(
    quotas.quotas.map((/** @type {{ resource: string }} */ quota) => quota.resource),
  );
  for (const item of POLICY.costItems) {
    assert.ok(
      resources.has(item.resource),
      `المورد «${item.resource}» في البند «${item.id}» غيرُ معلَنٍ في config/quotas.yaml — ومصدرا حقيقةٍ لموردٍ واحدٍ يتباعدان.`,
    );
  }
});
