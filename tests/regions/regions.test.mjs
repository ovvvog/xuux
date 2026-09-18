// اختباراتُ وحدةِ الأقاليمِ وتجاوزِ الفشل — الخطوة `M10.07`.
//
// وهذه الاختباراتُ تقيس **الحكمَ النقيَّ**: لا قرصَ ولا عمليّةَ ابنةً ولا ساعةَ
// جهازٍ؛ الوقائعُ تُبنى في المتنِ وتُمرَّر، فما يُقاس هنا هو العقدُ والحكمُ لا
// البيئة. ومعيارُ القبولِ نفسُه — إسقاطُ إقليمٍ كاملٍ — مقيسٌ في
// `tests/regions/failover.test.mjs` بعمليّاتٍ أبناءٍ حقيقيّة.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { registerTmpRoot } from '../helpers/tmp-roots.mjs';

import YAML from 'yaml';

import {
  REGION_ERRORS,
  RegionError,
  assertObservation,
  assertQuorum,
  exitCodeFor,
  judgeAllRegions,
  judgeFailoverDuration,
  judgeRegion,
  loadRegionsContract,
  measureImpact,
  planFailover,
  requireRegion,
  triggersFailover,
} from '../../src/regions/index.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const CONTRACT_FILE = path.join(ROOT, 'config', 'regions.yaml');

const contract = loadRegionsContract();

/**
 * كتابةُ عقدٍ معدَّلٍ في جذرٍ مؤقّتٍ وتحميلُه — لقياسِ رفضِ العقودِ الفاسدة.
 *
 * @param {(document: Record<string, unknown>) => void} mutate
 * @returns {() => void}
 */
function loadMutated(mutate) {
  const dir = registerTmpRoot(fs.mkdtempSync(path.join(os.tmpdir(), 'regions-contract-')));
  const source = YAML.parse(fs.readFileSync(CONTRACT_FILE, 'utf8'));
  mutate(source);
  fs.writeFileSync(path.join(dir, 'regions.yaml'), YAML.stringify(source), 'utf8');
  return () => {
    loadRegionsContract({ dir });
  };
}

/**
 * @param {string} region
 * @param {{ reachable?: boolean, lag?: number, at?: number }} [options]
 * @returns {import('../../src/regions/health.mjs').RegionObservation}
 */
function observation(region, options = {}) {
  return {
    region,
    reachable: options.reachable ?? true,
    replicationLagMs: options.lag ?? 0,
    at: options.at ?? 1_000,
  };
}

test('عقدُ الأقاليمِ يُحمَّل ويُعلن كاتباً واحداً وثلاثةَ أحكامِ صحّة', () => {
  assert.equal(contract.regions.filter((region) => region.role === 'writer').length, 1);
  assert.deepEqual(contract.health.map((verdict) => verdict.id).sort(), [
    'health:down',
    'health:unmeasured',
    'health:up',
  ]);
  assert.equal(exitCodeFor(contract, 'health:up'), 0);
});

test('نافذةُ الفقدِ مشتقّةٌ من عهدِ الاتساقِ وحدَه — مصدرُ حقيقةٍ واحد', () => {
  assert.equal(contract.maxDataLossMs, contract.consistency.maxReplicationLagMs);
  const raw = YAML.parse(fs.readFileSync(CONTRACT_FILE, 'utf8'));
  assert.equal(Object.hasOwn(raw.impact, 'maxDataLossMs'), false);
  assert.equal(Object.hasOwn(raw.impact, 'maxReplicationLagMs'), false);
});

test('كاتبانِ معلَنانِ يُرَدّان عند التحميلِ لا في منتصفِ السقوط', () => {
  assert.throws(
    loadMutated((document) => {
      const regions = /** @type {Array<Record<string, unknown>>} */ (document.regions);
      const second = /** @type {Record<string, unknown>} */ (regions[1]);
      second.role = 'writer';
    }),
    (/** @type {RegionError} */ error) =>
      error instanceof RegionError && error.code === REGION_ERRORS.WRITER_NOT_UNIQUE,
  );
});

test('عقدٌ بلا كاتبٍ يُرَدّ بالرمزِ المعلَن', () => {
  assert.throws(
    loadMutated((document) => {
      for (const region of /** @type {Array<Record<string, unknown>>} */ (document.regions)) {
        region.role = 'reader';
      }
    }),
    (/** @type {RegionError} */ error) =>
      error instanceof RegionError && error.code === REGION_ERRORS.WRITER_MISSING,
  );
});

test('أولويّتانِ متساويتانِ تُرَدّان — وترتيبٌ ملتبسٌ يُقرَّر بالحظ', () => {
  assert.throws(
    loadMutated((document) => {
      const regions = /** @type {Array<Record<string, unknown>>} */ (document.regions);
      const first = /** @type {Record<string, unknown>} */ (regions[0]);
      const second = /** @type {Record<string, unknown>} */ (regions[1]);
      second.priority = first.priority;
    }),
    (/** @type {RegionError} */ error) =>
      error instanceof RegionError && error.code === REGION_ERRORS.PRIORITY_INVALID,
  );
});

test('جذرا حالةٍ متداخلانِ يُرَدّان — وموضعٌ واحدٌ لإقليمين يُفسدهما', () => {
  assert.throws(
    loadMutated((document) => {
      const regions = /** @type {Array<Record<string, unknown>>} */ (document.regions);
      const first = /** @type {Record<string, unknown>} */ (regions[0]);
      const second = /** @type {Record<string, unknown>} */ (regions[1]);
      second.statePath = first.statePath;
    }),
    (/** @type {RegionError} */ error) =>
      error instanceof RegionError && error.code === REGION_ERRORS.PATH_CONFLICT,
  );
});

test('حكمُ صحّةٍ يُطلَق عليه التجاوزُ ولا إعلانَ له يُرَدّ', () => {
  assert.throws(
    loadMutated((document) => {
      const failover = /** @type {Record<string, unknown>} */ (document.failover);
      failover.triggerOn = ['health:nowhere'];
    }),
    (/** @type {RegionError} */ error) =>
      error instanceof RegionError && error.code === REGION_ERRORS.HEALTH_UNDECLARED,
  );
});

test('حقلٌ غيرُ معلَنٍ في العقدِ يُرَدّ — additionalProperties: false في كل موضع', () => {
  assert.throws(
    loadMutated((document) => {
      document.extra = 'حقلٌ لا يقرؤه أحدٌ ويُظَنّ نافذاً';
    }),
    (/** @type {RegionError} */ error) =>
      error instanceof RegionError && error.code === REGION_ERRORS.CONFIG_INVALID,
  );
});

test('إقليمٌ غيرُ معلَنٍ لا يُسقَط ولا يُنصَّب', () => {
  assert.throws(
    () => requireRegion(contract, 'region:nowhere'),
    (/** @type {RegionError} */ error) =>
      error instanceof RegionError && error.code === REGION_ERRORS.UNDECLARED,
  );
});

test('إقليمٌ بلا مشاهدةٍ صالحةٍ يُحكَم unmeasured لا up', () => {
  const judgement = judgeRegion({ contract, region: 'region:secondary', observations: [] });
  assert.equal(judgement.verdict, 'health:unmeasured');
  assert.equal(judgement.reason, REGION_ERRORS.OBSERVATION_MISSING);
  assert.equal(judgement.replicationLagMs, null);
});

test('تأخّرٌ يتجاوز عهدَ الاتساقِ يُحكَم down بالرمزِ المعلَن', () => {
  const judgement = judgeRegion({
    contract,
    region: 'region:secondary',
    observations: [
      observation('region:secondary', { lag: contract.consistency.maxReplicationLagMs + 1 }),
    ],
  });
  assert.equal(judgement.verdict, 'health:down');
  assert.equal(judgement.reason, REGION_ERRORS.LAG_EXCEEDED);
});

test('مشاهدةٌ بتأخّرٍ سالبٍ تُرَدّ — ونسخةٌ أحدثُ من أصلِها دليلُ ساعةٍ فاسدة', () => {
  assert.throws(
    () =>
      assertObservation({
        region: 'region:secondary',
        reachable: true,
        replicationLagMs: -1,
        at: 1,
      }),
    (/** @type {RegionError} */ error) =>
      error instanceof RegionError && error.code === REGION_ERRORS.LAG_INVALID,
  );
});

test('مشاهدةٌ بلا لحظةٍ منتهيةٍ تُرَدّ ولا تُطرَح صامتة', () => {
  assert.throws(
    () =>
      assertObservation({
        region: 'region:secondary',
        reachable: true,
        replicationLagMs: 0,
        at: Number.NaN,
      }),
    (/** @type {RegionError} */ error) =>
      error instanceof RegionError && error.code === REGION_ERRORS.OBSERVATION_INVALID,
  );
});

test('التجاوزُ يُطلَق على السقوطِ وعلى غيابِ القياسِ لا على الصحّة', () => {
  assert.equal(triggersFailover(contract, 'health:down'), true);
  assert.equal(triggersFailover(contract, 'health:unmeasured'), true);
  assert.equal(triggersFailover(contract, 'health:up'), false);
});

test('لا تُبنى خطّةُ تنصيبٍ والكاتبُ القائمُ صحيحٌ — بابُ كاتبَين مسدود', () => {
  const judgements = judgeAllRegions({
    contract,
    observations: contract.regions.map((region) => observation(region.id)),
  });
  assert.throws(
    () => planFailover({ contract, currentWriter: 'region:primary', judgements }),
    (/** @type {RegionError} */ error) =>
      error instanceof RegionError && error.code === REGION_ERRORS.WRITER_NOT_UNIQUE,
  );
});

test('المرشَّحُ يُشتقُّ من الأولويّةِ ومن تأخّرٍ مقيسٍ لا من وسيطٍ يُمرَّر', () => {
  const judgements = judgeAllRegions({
    contract,
    observations: [
      observation('region:primary', { reachable: false }),
      observation('region:secondary', { lag: contract.consistency.maxReplicationLagMs + 1 }),
      observation('region:tertiary', { lag: 10 }),
    ],
  });
  const plan = planFailover({ contract, currentWriter: 'region:primary', judgements });
  assert.equal(plan.to, 'region:tertiary');
  assert.equal(plan.candidateLagMs, 10);
  assert.ok(plan.skipped.some((entry) => entry.startsWith('region:secondary')));
});

test('غيابُ مرشَّحٍ صالحٍ يُرَدّ ولا يُنصَّب من يُظَنّ صالحاً', () => {
  const judgements = judgeAllRegions({
    contract,
    observations: contract.regions.map((region) => observation(region.id, { reachable: false })),
  });
  assert.throws(
    () => planFailover({ contract, currentWriter: 'region:primary', judgements }),
    (/** @type {RegionError} */ error) =>
      error instanceof RegionError && error.code === REGION_ERRORS.FAILOVER_CANDIDATE_MISSING,
  );
});

test('فقدُ النصابِ المعلَنِ يُرَدّ ولا يُقال «استمرّت الخدمة»', () => {
  const judgements = judgeAllRegions({
    contract,
    observations: contract.regions.map((region) => observation(region.id, { reachable: false })),
  });
  assert.throws(
    () => assertQuorum({ contract, judgements }),
    (/** @type {RegionError} */ error) =>
      error instanceof RegionError && error.code === REGION_ERRORS.QUORUM_LOST,
  );
});

test('مدّةُ التجاوزِ تُحاسَب على السقفِ المعلَنِ في العقد', () => {
  const within = judgeFailoverDuration({ contract, durationMs: 10 });
  assert.equal(within.withinLimit, true);
  assert.equal(within.limitMs, contract.failover.maxFailoverMs);
  const beyond = judgeFailoverDuration({
    contract,
    durationMs: contract.failover.maxFailoverMs + 1,
  });
  assert.equal(beyond.withinLimit, false);
});

test('الأثرُ رقمانِ مقيسانِ: انقطاعُ كتابةٍ ونافذةُ فقدٍ، كلٌّ بسقفِه', () => {
  const impact = measureImpact({
    contract,
    droppedAt: 1_000,
    writeAcceptedAt: 1_400,
    lagAtDropMs: 20,
  });
  assert.equal(impact.unavailableMs, 400);
  assert.equal(impact.dataLossWindowMs, 20);
  assert.equal(impact.maxDataLossMs, contract.consistency.maxReplicationLagMs);
  assert.equal(impact.withinBudget, true);
  assert.equal(impact.breach, null);
});

test('تجاوزُ الأثرِ عهدَه يُعلَن بالرمزِ لا يُطوى في عبارةٍ', () => {
  const tooLong = measureImpact({
    contract,
    droppedAt: 0,
    writeAcceptedAt: contract.impact.maxUnavailableMs + 1,
    lagAtDropMs: 0,
  });
  assert.equal(tooLong.withinBudget, false);
  assert.equal(tooLong.breach, REGION_ERRORS.IMPACT_EXCEEDED);
  const tooStale = measureImpact({
    contract,
    droppedAt: 0,
    writeAcceptedAt: 10,
    lagAtDropMs: contract.consistency.maxReplicationLagMs + 1,
  });
  assert.equal(tooStale.breach, REGION_ERRORS.LAG_EXCEEDED);
});

test('ساعةٌ ترجع إلى الوراءِ لا يُقاس عليها أثر', () => {
  assert.throws(
    () => measureImpact({ contract, droppedAt: 100, writeAcceptedAt: 50, lagAtDropMs: 0 }),
    (/** @type {RegionError} */ error) =>
      error instanceof RegionError && error.code === REGION_ERRORS.CLOCK_INVALID,
  );
});

test('كلُّ ضمانٍ معلَنٍ حاضرٌ نصّاً في ملفِّ إنفاذِه', () => {
  for (const guarantee of contract.guarantees) {
    const source = fs.readFileSync(path.join(ROOT, guarantee.file), 'utf8');
    assert.ok(
      source.includes(guarantee.id),
      `الضمان ${guarantee.id} ليس حاضراً في ${guarantee.file}`,
    );
  }
});
