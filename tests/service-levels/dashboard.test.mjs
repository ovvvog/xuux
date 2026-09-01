// اختبارُ قبولِ الخطوة `M10.02`: **لوحةٌ تُظهر الأهدافَ والانحرافَ بأرقام**.
//
// والجملةُ ذاتُ أربعةِ أشقٍّ، وكلُّ شقٍّ يفشل وحدَه إن انكسر:
//   ١. **لوحةٌ** — تُقرأ من التركيبِ الحقيقيِّ نفسِه (`registries.serviceLevels`)
//      لا من مثيلٍ يُبنى في الاختبارِ بوثيقةٍ مصنوعةٍ ليوافق.
//   ٢. **تُظهر الأهدافَ** — كلُّ هدفٍ مُعلَنٍ في `config/service-levels.yaml` له
//      صفٌّ، ورقمُ هدفِه في الصفِّ هو رقمُ **الوثيقة** لا رقمٌ في الكود.
//   ٣. **والانحرافَ** — فرقٌ رقميٌّ موجبٌ أو سالبٌ بين المقيسِ والهدفِ، لا وصفٌ.
//   ٤. **بأرقام** — الأرقامُ مقروءةٌ من **سجلِّ مقاييسِ التركيبِ نفسِه**: نداءٌ
//      حقيقيٌّ على البوابةِ يرفعها، ورفضٌ حقيقيٌّ يستهلك الميزانية.
//
// والمكوّناتُ **حقيقيةٌ** كما في اختبارِ `M10.01`: بوابةٌ حقيقيةٌ على وثيقتِها
// النافذة، ووكيلُ مراقبةٍ حقيقيٌّ، ونقطةُ تفويضٍ على حزمةِ السياساتِ من القرص،
// وسجلُّ أحداثٍ حقيقيّ.
//
// **حدٌّ معلَن أول:** المستودعاتُ ذاكريةٌ لا PostgreSQL، وسجلُّ الهوياتِ قارئٌ
// يُرجِع صفوفاً مصنوعة — كما في اختبارِ البوابة. والمقيسُ هنا **صدقُ اللوحةِ عن
// المقاييس** لا سلامةُ الطبقاتِ تحتَها، وهي مقيسةٌ في `tests/api` و`tests/telemetry`.
//
// **حدٌّ معلَن ثانٍ:** لا يُقاس هنا هدفُ المدّةِ على عتبتِه الحقيقيةِ حكماً
// (مستوفٍ أو مُخفِق)، لأن ذلك يجعل نجاحَ الاختبارِ رهناً بسرعةِ آلةِ CI —
// **واختبارٌ يخضر بحسب الحِمْلِ ليس دليلاً**. فالمقيسُ أن المدّةَ قِيست وأن
// الحكمَ خرج من عتبةِ الوثيقةِ لا من ثابتٍ في الاختبار.

import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';

import { ApiGateway, loadApiPolicy } from '../../src/api/index.mjs';
import { MonitorAgent, loadMonitoringPolicy } from '../../src/observability/index.mjs';
import { createMemoryRepositories } from '../../src/persistence/composition.mjs';
import { EventLog } from '../../src/root-of-trust/index.mjs';
import {
  SLO_ERRORS,
  createServiceLevels,
  loadServiceLevelPolicy,
} from '../../src/service-levels/index.mjs';
import { createTelemetry, loadTelemetryPolicy } from '../../src/telemetry/index.mjs';
import { enforcementPointFor } from '../helpers/authorization.mjs';

const CONFIG_DIR = path.join(process.cwd(), 'config');
const API_POLICY = loadApiPolicy({ dir: CONFIG_DIR });
const MONITORING_POLICY = loadMonitoringPolicy({ dir: CONFIG_DIR });
const TELEMETRY_POLICY = loadTelemetryPolicy({ dir: CONFIG_DIR });
const SERVICE_LEVELS_POLICY = loadServiceLevelPolicy({ dir: CONFIG_DIR });

const AUDITOR = 'agent:service-levels-auditor';

/**
 * دولةٌ مصغَّرةٌ ببوابةٍ حقيقيةٍ ووكيلِ مراقبةٍ حقيقيٍّ **يتشاركان مثيلَ قياسٍ
 * واحداً**، ولوحةُ مستوياتِ خدمةٍ مبنيةٌ على **سجلِّ مقاييسِ ذلك المثيلِ بعينِه**
 * — فمثيلانِ للمقاييسِ رقمانِ لشيءٍ واحد، وتقرأ اللوحةُ صفراً والنداءاتُ معدودةٌ
 * في غيرِه.
 */
function state() {
  let ticks = 5_000;
  const nowMs = () => (ticks += 1);
  const log = new EventLog();
  const repositories = createMemoryRepositories();
  /** @type {Record<string, Record<string, unknown>>} */
  const identities = {
    [AUDITOR]: {
      id: AUDITOR,
      kind: 'service',
      state: 'active',
      role: MONITORING_POLICY.role,
      capabilities: ['action:read-registry', 'action:read-memory', 'action:read-audit'],
    },
  };
  const agents = {
    /** @param {string} id */
    get: async (id) => identities[id] ?? null,
  };
  const telemetry = createTelemetry({ policy: TELEMETRY_POLICY, now: nowMs });
  const monitor = new MonitorAgent({
    policy: MONITORING_POLICY,
    repositories,
    agents: /** @type {never} */ (agents),
    log: /** @type {never} */ (log),
    telemetry,
  });
  const gateway = new ApiGateway({
    policy: API_POLICY,
    log: /** @type {never} */ (log),
    agents: /** @type {never} */ (agents),
    monitor,
    enforcementPoint: enforcementPointFor(log),
    telemetry,
  });
  const serviceLevels = createServiceLevels({
    policy: SERVICE_LEVELS_POLICY,
    telemetryPolicy: TELEMETRY_POLICY,
    metrics: telemetry.metrics,
    now: nowMs,
  });
  return { gateway, serviceLevels, telemetry };
}

/**
 * @param {ReturnType<typeof createServiceLevels>} levels
 * @param {string} id
 * @returns {import('../../src/service-levels/service-levels.mjs').ObjectiveRow}
 */
function rowOf(levels, id) {
  const board = levels.dashboard();
  for (const capability of board.capabilities) {
    for (const row of capability.objectives) {
      if (row.id === id) return row;
    }
  }
  throw new Error(`الهدف ${id} غائبٌ عن اللوحة`);
}

test('معيارُ القبول: اللوحةُ تُظهر كلَّ هدفٍ مُعلَنٍ وانحرافَه رقماً من نداءاتٍ حقيقية', async () => {
  const { gateway, serviceLevels } = state();
  const session = await gateway.openSession({ actorId: AUDITOR });
  for (let index = 0; index < 4; index += 1) {
    const result = await gateway.call({
      route: 'state.agents.list',
      token: session.token,
      params: { limit: 5 },
    });
    assert.equal(result.status, 'ok');
  }

  const board = serviceLevels.dashboard();

  // ── الشقُّ الأول: لوحةٌ بقدراتِها المُعلَنةِ كلِّها ──
  assert.deepEqual(
    board.capabilities.map((capability) => capability.id),
    SERVICE_LEVELS_POLICY.capabilities.map((capability) => capability.id),
  );
  const declaredObjectives = SERVICE_LEVELS_POLICY.capabilities.flatMap((capability) =>
    capability.objectives.map((objective) => objective.id),
  );
  assert.equal(board.summary.objectives, declaredObjectives.length);
  assert.ok(board.window.ageMs > 0, 'عمرُ النافذةِ صفرٌ — ورقمٌ بلا مدًى لا يُقرأ.');

  // ── الشقُّ الثاني: رقمُ الهدفِ من الوثيقةِ لا من الكود ──
  for (const capability of SERVICE_LEVELS_POLICY.capabilities) {
    for (const objective of capability.objectives) {
      const row = rowOf(serviceLevels, objective.id);
      assert.equal(
        row.target,
        objective.target,
        `هدفُ ${objective.id} في اللوحةِ ليس هدفَ الوثيقة.`,
      );
      assert.equal(row.thresholdMs, objective.thresholdMs ?? null);
      assert.equal(row.capability, capability.id);
    }
  }

  // ── الشقُّ الرابع: الأرقامُ من سجلِّ مقاييسِ التركيبِ نفسِه ──
  const availability = rowOf(serviceLevels, 'slo:api.availability');
  assert.equal(
    availability.events.total,
    4,
    'اللوحةُ لم تقرأ نداءاتِ البوابةِ — والصفرُ هنا «أخضرُ فارغٌ» لا قياس.',
  );
  assert.equal(availability.events.bad, 0);
  assert.equal(availability.measured, 1);

  // ── الشقُّ الثالث: الانحرافُ رقمٌ لا وصفٌ ──
  assert.equal(typeof availability.deviation, 'number');
  assert.ok(/** @type {number} */ (availability.deviation) > 0);
  assert.equal(availability.status, 'meeting');
  assert.equal(availability.errorBudget.consumed, 0);
  assert.ok(availability.errorBudget.allowed > 0);
  assert.equal(availability.errorBudget.remaining, availability.errorBudget.allowed);

  // والمدّةُ قِيست فعلاً وحكمُها من عتبةِ الوثيقةِ لا من ثابتٍ في الاختبار.
  const latency = rowOf(serviceLevels, 'slo:api.latency');
  assert.equal(latency.kind, 'latency');
  assert.equal(
    latency.events.total,
    4,
    'مدّاتُ النداءاتِ لم تُقَس — وهدفُ مدّةٍ بلا مدّاتٍ لا حكمَ له.',
  );
  assert.equal(latency.events.good + latency.events.bad, 4);
  assert.ok(['meeting', 'breaching'].includes(latency.status));
  assert.equal(latency.observed.calls, 4);
  assert.equal(latency.sampled, false);
});

test('الرفضُ الحقيقيُّ يستهلك الميزانيةَ ويُقلب الحكمَ — ولا يُخفيه القياس', async () => {
  const { gateway, serviceLevels } = state();
  // نداءٌ بلا رمزٍ يُرَدُّ بـ`API_AUTH_REQUIRED`، ويُعَدُّ إخفاقاً في القدرةِ
  // **وإن كان رفضاً مشروعاً**: الميزانيةُ تقيس ما رآه المستدعي لا ما نواه النظام.
  await gateway.call({ route: 'state.agents.list' }).catch(() => {});

  const row = rowOf(serviceLevels, 'slo:api.availability');
  assert.equal(row.events.total, 1);
  assert.equal(row.events.bad, 1);
  assert.equal(row.measured, 0);
  assert.ok(/** @type {number} */ (row.deviation) < 0, 'الانحرافُ لم يُعرض سالباً عند الإخفاق.');
  assert.equal(row.status, 'breaching');
  assert.equal(row.errorBudget.exhausted, true);
  assert.throws(
    () => serviceLevels.assertWithinBudget('slo:api.availability'),
    (/** @type {unknown} */ error) =>
      /** @type {{ code?: string }} */ (error).code === SLO_ERRORS.BUDGET_EXHAUSTED,
  );
});

test('ما لم يقع تحته حدثٌ يُعرض «غيرَ مقيسٍ» لا مستوفياً — ولو كان بقيةُ اللوحةِ أخضر', async () => {
  const { gateway, serviceLevels } = state();
  const session = await gateway.openSession({ actorId: AUDITOR });
  await gateway.call({ route: 'state.agents.list', token: session.token, params: { limit: 5 } });

  const board = serviceLevels.dashboard();
  const storage = rowOf(serviceLevels, 'slo:storage.latency');
  // فإن بلغ النداءُ المستودعَ قِيست مدّتُه، وإن لم يبلغه فُقرئ «غيرَ مقيسٍ»
  // صراحةً — والحالتان مقبولتان، **والممنوعُ هو الثالثةُ**: صفرُ أحداثٍ يُقرأ
  // التزاماً تامّاً.
  if (storage.events.total === 0) {
    assert.equal(storage.measured, null);
    assert.equal(storage.status, 'unmeasured');
    assert.throws(
      () => serviceLevels.assertWithinBudget('slo:storage.latency'),
      (/** @type {unknown} */ error) =>
        /** @type {{ code?: string }} */ (error).code === SLO_ERRORS.MEASUREMENT_UNAVAILABLE,
    );
  } else {
    assert.equal(typeof storage.measured, 'number');
    assert.notEqual(storage.status, 'unmeasured');
  }
  assert.equal(
    board.summary.meeting + board.summary.breaching + board.summary.unmeasured,
    board.summary.objectives,
  );
});

test('اللوحةُ تقرأ ولا تكتب: قراءتانِ متعاقبتانِ لا تُبدّلانِ المقيس', async () => {
  const { gateway, serviceLevels, telemetry } = state();
  const session = await gateway.openSession({ actorId: AUDITOR });
  await gateway.call({ route: 'state.agents.list', token: session.token, params: { limit: 5 } });

  const before = telemetry.metrics.counterTotal('api.call.count');
  serviceLevels.dashboard();
  serviceLevels.dashboard();
  const after = telemetry.metrics.counterTotal('api.call.count');
  assert.equal(
    after,
    before,
    'قراءةُ اللوحةِ استهلكت المقيس — فالقارئُ الثاني يرى غيرَ ما رأى الأوّل.',
  );
  assert.equal(rowOf(serviceLevels, 'slo:api.availability').events.total, before);
});

test('التركيبُ الحقيقيُّ يصل اللوحةَ دائماً بسجلِّ مقاييسِ المثيلِ نفسِه', async () => {
  const { createRegistries } = await import('../../src/persistence/composition.mjs');
  const { CertificateAuthority, KingIdentity } = await import('../../src/root-of-trust/index.mjs');
  const log = new EventLog();
  const king = new KingIdentity();
  const registries = createRegistries({
    ca: new CertificateAuthority(king),
    log: /** @type {never} */ (log),
    repositories: createMemoryRepositories(),
  });
  assert.ok(registries.serviceLevels !== undefined, 'التركيبُ بلا لوحةِ مستوياتِ خدمةٍ موصولة.');
  const board = registries.serviceLevels.dashboard();
  assert.equal(
    board.summary.objectives,
    SERVICE_LEVELS_POLICY.capabilities.reduce(
      (total, capability) => total + capability.objectives.length,
      0,
    ),
  );
  // وقبل أيِّ نداءٍ كلُّ الأهدافِ «غيرُ مقيسةٍ» — **لا مستوفاةً**: وهذا موضعُ
  // الكذبِ المُطمئنِّ الذي يُقاس غيابُه هنا على التركيبِ الحقيقيّ.
  assert.equal(board.summary.unmeasured, board.summary.objectives);
  assert.equal(board.summary.meeting, 0);

  // والسجلُّ واحدٌ: نداءٌ يُقاس في `telemetry.metrics` يظهر في اللوحةِ نفسِها.
  const session = await registries.api.openSession({ actorId: AUDITOR }).catch(() => null);
  if (session === null) {
    // الهويةُ غيرُ مسجَّلةٍ في هذا التركيبِ فلا جلسة؛ والمقيسُ حينها **وحدةُ
    // السجلِّ** لا نجاحُ النداء: عدّادُ الرفضِ يرتفع في اللوحةِ نفسِها.
    await registries.api.call({ route: 'state.agents.list' }).catch(() => {});
    const row = rowOf(registries.serviceLevels, 'slo:api.availability');
    assert.ok(
      row.events.total >= 1,
      'نداءٌ وقع على البوابةِ ولم تره اللوحةُ — ومثيلانِ للمقاييسِ رقمانِ لشيءٍ واحد.',
    );
  }
});
