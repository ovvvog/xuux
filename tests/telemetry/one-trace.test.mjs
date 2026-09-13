// اختبارُ قبولِ الخطوة `M10.01`: **تتبّع نداء واحد من الواجهة إلى التخزين في
// أثر واحد**.
//
// والجملةُ ذاتُ ثلاثةِ أشقٍّ، وكلُّ شقٍّ يفشل وحدَه إن انكسر:
//   ١. **نداءٌ واحد** — نداءٌ واحدٌ على البوابةِ لا ثلاثةُ نداءاتٍ مصنوعةٌ يدوياً.
//   ٢. **من الواجهةِ إلى التخزين** — المدَياتُ الثلاثةُ حاضرةٌ بأسمائها المُعلَنةِ
//      (`api.call` ← `monitor.read` ← `storage.read`)، وآخرُها يقع عند حدِّ
//      المستودعِ نفسِه لا عند طبقةٍ فوقه.
//   ٣. **في أثرٍ واحد** — معرّفُ الأثرِ **واحدٌ** في المدَياتِ الثلاثةِ، وسلسلةُ
//      الأبوّةِ متّصلةٌ حلقةً حلقةً لا مجرّدَ تجاورٍ في الزمن.
//
// والمكوّناتُ **حقيقيةٌ** كما في اختبارِ `M9.02`: بوابةٌ حقيقيةٌ على وثيقتِها
// النافذة، ووكيلُ مراقبةٍ حقيقيٌّ على وثيقتِه، ونقطةُ تفويضٍ على حزمةِ السياساتِ
// من القرص، وسجلُّ أحداثٍ حقيقيّ. فما يُقاس هنا سلوكُ النظامِ لا مزدوجٌ صُنع
// ليوافق.
//
// **حدٌّ معلَن:** المستودعاتُ ذاكريةٌ لا PostgreSQL، وسجلُّ الهوياتِ قارئٌ
// يُرجِع صفوفاً مصنوعة — كما في اختبارِ البوابة. والمقيسُ هنا **بنيةُ الأثرِ**
// لا كلفتُه: قياسُ حِمْلِ `AsyncLocalStorage` في المسارِ الحارِّ خارجُ ما تدّعيه
// هذه الخطوة، وهو حدٌّ مكتوبٌ في رأسِ `src/telemetry/tracer.mjs`.

import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';

import { ApiGateway, loadApiPolicy } from '../../src/api/index.mjs';
import { MonitorAgent, loadMonitoringPolicy } from '../../src/observability/index.mjs';
import { createMemoryRepositories } from '../../src/persistence/composition.mjs';
import { EventLog } from '../../src/root-of-trust/index.mjs';
import { createTelemetry, isValidSpanId, isValidTraceId } from '../../src/telemetry/index.mjs';
import { enforcementPointFor } from '../helpers/authorization.mjs';

const CONFIG_DIR = path.join(process.cwd(), 'config');
const API_POLICY = loadApiPolicy({ dir: CONFIG_DIR });
const MONITORING_POLICY = loadMonitoringPolicy({ dir: CONFIG_DIR });

const AUDITOR = 'agent:telemetry-auditor';

/**
 * دولةٌ مصغَّرةٌ ببوابةٍ حقيقيةٍ ووكيلِ مراقبةٍ حقيقيٍّ **يتشاركان مثيلَ قياسٍ
 * واحداً** — وبوحدتِه وحدَها يصير النداءُ الثلاثيُّ أثراً واحداً.
 * @param {{ nowMs?: () => number }} [options]
 */
function state(options = {}) {
  let ticks = 5_000;
  const nowMs = options.nowMs ?? (() => (ticks += 1));
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
  const telemetry = createTelemetry({ now: nowMs });
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
    requirePoP: false, // اختباراتٌ بلا إثباتِ حيازةٍ
  });
  return { gateway, monitor, telemetry, log };
}

/**
 * @param {ReadonlyArray<import('../../src/telemetry/tracer.mjs').FinishedSpan>} spans
 * @param {string} name
 * @returns {import('../../src/telemetry/tracer.mjs').FinishedSpan}
 */
function spanNamed(spans, name) {
  const found = spans.find((span) => span.name === name);
  assert.ok(found !== undefined, `المدى «${name}» غائبٌ عن الأثر — والأثرُ ناقصٌ طبقةً.`);
  return found;
}

test('معيارُ القبول: نداءٌ واحدٌ من الواجهةِ إلى التخزينِ يُنتج أثراً واحداً متّصلَ الأبوّة', async () => {
  const { gateway, telemetry } = state();
  const session = await gateway.openSession({ actorId: AUDITOR });
  const result = await gateway.call({
    route: 'state.agents.list',
    token: session.token,
    params: { limit: 5 },
  });
  assert.equal(result.status, 'ok');

  const spans = telemetry.finishedSpans();
  assert.ok(
    spans.length >= 3,
    `المدَياتُ ${spans.length} وهي أقلُّ من ثلاثٍ؛ والنداءُ يمرّ بثلاثِ طبقاتٍ فأثرُه لا يكون أقلَّ منها.`,
  );

  // ── الشقُّ الثالث: **أثرٌ واحدٌ** لا آثارٌ متجاورة ──
  const traceIds = new Set(spans.map((span) => span.traceId));
  assert.equal(
    traceIds.size,
    1,
    `النداءُ الواحدُ أنتج ${traceIds.size} آثارٍ؛ ومعرّفٌ لا يُوَرَّث يجعل القارئَ يخمّن أن الأحداثَ نداءٌ واحد — والتخمينُ ليس رصداً.`,
  );
  const traceId = /** @type {string} */ ([...traceIds][0]);
  assert.ok(isValidTraceId(traceId), 'معرّفُ الأثرِ يخالف معيار W3C.');

  // ── الشقُّ الثاني: الطبقاتُ الثلاثُ بأسمائِها المُعلَنة ──
  const api = spanNamed(spans, 'api.call');
  const monitorRead = spanNamed(spans, 'monitor.read');
  const storageRead = spanNamed(spans, 'storage.read');
  for (const span of [api, monitorRead, storageRead]) {
    assert.ok(isValidSpanId(span.spanId), `معرّفُ المدى «${span.name}» يخالف معيار W3C.`);
  }

  // ── سلسلةُ الأبوّةِ متّصلةٌ حلقةً حلقةً ──
  assert.equal(api.parentSpanId, null, 'المدى الجذرُ له أبٌ — وجذرٌ بأبٍ ليس جذراً.');
  assert.equal(
    monitorRead.parentSpanId,
    api.spanId,
    'مدى المراقبةِ ليس ابنَ مدى البوابة؛ وطبقةٌ منفصلةُ الأبوّةِ لا تُقرأ في موضعِها من النداء.',
  );
  assert.equal(
    storageRead.parentSpanId,
    monitorRead.spanId,
    'مدى التخزينِ ليس ابنَ مدى المراقبة؛ وبلا هذه الحلقةِ لا يبلغ الأثرُ التخزينَ متّصلاً.',
  );

  // ── والوسومُ تصف النداءَ بعينِه لا نداءً عامّاً ──
  assert.equal(api.attributes['api.route'], 'state.agents.list');
  assert.equal(api.attributes['api.actor'], AUDITOR);
  assert.equal(api.status.code, 'ok');
  // ووسمُ المراقبةِ هو اسمُ العرضِ كما تعرفه وثيقةُ المراقبةِ لا كما تسمّيه
  // البوابةُ: `api.resource` مُقدَّمٌ بلاحقةِ سجلِّه، فالمقيسُ هو اتّساقُ
  // اللاحقةِ لا تطابقُ النصّين حرفاً بحرف.
  assert.equal(monitorRead.attributes['monitor.view'], 'agents');
  assert.equal(api.attributes['api.resource'], 'registry:agents');
  assert.equal(typeof storageRead.attributes['storage.registry'], 'string');
  assert.equal(typeof storageRead.attributes['storage.method'], 'string');
});

test('المقاييسُ تُسجَّل للنداءِ نفسِه: عدُّ الواجهةِ وعدُّ التخزينِ ومدّتاهما', async () => {
  const { gateway, telemetry } = state();
  const session = await gateway.openSession({ actorId: AUDITOR });
  await gateway.call({ route: 'state.agents.list', token: session.token, params: { limit: 5 } });

  const readings = telemetry.metrics.snapshot();
  const apiCalls = readings.counters.find((row) => row.name === 'api.call.count');
  assert.equal(apiCalls?.value, 1);
  assert.equal(apiCalls?.attributes['api.route'], 'state.agents.list');

  const storageReads = readings.counters.find((row) => row.name === 'storage.read.count');
  assert.ok(storageReads !== undefined, 'التخزينُ لم يُعَدّ — ونداءٌ بلغ المستودعَ ولم يُقَس.');
  assert.ok(/** @type {number} */ (storageReads.value) >= 1);

  const names = readings.histograms.map((row) => row.name);
  assert.ok(names.includes('api.call.duration'), 'زمنُ النداءِ لم يُقَس.');
  assert.ok(
    names.includes('storage.read.duration'),
    'زمنُ التخزينِ لم يُقَس وحدَه — ومن قاس الطبقةَ الفوقيةَ وحدَها رأى البطءَ ولم يرَ من سبَّبَه.',
  );
});

test('الرفضُ يُقاس برمزِه في المدى وفي العدّاد — لا يُخفيه القياس', async () => {
  const { gateway, telemetry } = state();
  await gateway.call({ route: 'state.agents.list' }).catch(() => {});

  const spans = telemetry.finishedSpans();
  const api = spanNamed(spans, 'api.call');
  assert.equal(api.status.code, 'error');
  assert.equal(api.attributes['api.refusal.code'], 'API_AUTH_REQUIRED');

  const refusals = telemetry.metrics
    .snapshot()
    .counters.find((row) => row.name === 'api.call.refusals');
  assert.equal(refusals?.value, 1);
  assert.equal(refusals?.attributes['api.refusal.code'], 'API_AUTH_REQUIRED');
});

test('كلُّ سطرِ سجلٍّ مهيكلٍ يُكتب داخلَ النداءِ يحمل معرّفَ أثرِه', async () => {
  const { gateway, telemetry } = state();
  const session = await gateway.openSession({ actorId: AUDITOR });

  /** @type {string | null} */
  let seen = null;
  await telemetry.span('api.call', { attributes: { 'api.route': 'probe' } }, async (span) => {
    const record = telemetry.log('info', 'قيدٌ داخلَ النداء');
    seen = record.traceId;
    assert.equal(record.spanId, span.spanId);
  });
  assert.ok(seen !== null, 'سطرُ السجلِّ خرج بلا معرّفِ أثرٍ — فيُقرأ مجاوراً لا منسوباً.');
  assert.equal(telemetry.logs({ traceId: /** @type {string} */ (seen) }).length, 1);
  assert.ok(session.token.length > 0);
});

test('القياسُ يُضاف ولا يَحكم: بوابةٌ بلا قياسٍ تعمل كما هي', async () => {
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
  const agents = { get: async (/** @type {string} */ id) => identities[id] ?? null };
  const monitor = new MonitorAgent({
    policy: MONITORING_POLICY,
    repositories,
    agents: /** @type {never} */ (agents),
    log: /** @type {never} */ (log),
  });
  const gateway = new ApiGateway({
    policy: API_POLICY,
    log: /** @type {never} */ (log),
    agents: /** @type {never} */ (agents),
    monitor,
    enforcementPoint: enforcementPointFor(log),
    requirePoP: false, // اختباراتٌ بلا إثباتِ حيازةٍ
  });
  const session = await gateway.openSession({ actorId: AUDITOR });
  const result = await gateway.call({
    route: 'state.agents.list',
    token: session.token,
    params: { limit: 5 },
  });
  assert.equal(result.status, 'ok');
});
