/**
 * اختبارُ القياسِ الموحّد — الخطوة `M10.01`.
 *
 * القياسُ هنا على **الوحداتِ نفسِها** بساعةٍ مُقادةٍ لا بساعةِ النظام: مدّةٌ
 * تُقاس بساعةٍ لا تُقاد تُختبَر بـ«أكبرَ من صفر» وذاك ليس قياساً. وأمّا معيارُ
 * قبولِ الخطوةِ — «تتبّع نداء واحد من الواجهة إلى التخزين في أثر واحد» — فمقيسٌ
 * في `tests/telemetry/one-trace.test.mjs` على تركيبٍ حقيقيّ.
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { registerTmpRoot } from '../helpers/tmp-roots.mjs';

import {
  MetricsRegistry,
  SPAN_ID_HEX_LENGTH,
  TELEMETRY_ERRORS,
  TRACEPARENT_VERSION,
  TRACE_ID_HEX_LENGTH,
  Telemetry,
  TelemetryError,
  Tracer,
  TracerError,
  createTelemetry,
  formatTraceparent,
  isValidSpanId,
  isValidTraceId,
  loadTelemetryPolicy,
  newSpanId,
  newTraceId,
  parseTraceparent,
} from '../../src/telemetry/index.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CONFIG_DIR = path.join(REPO_ROOT, 'config');
const GUARD = path.join(REPO_ROOT, 'scripts', 'guard-telemetry.mjs');

/** @type {string[]} */
const tempDirs = [];

/** @returns {string} */
function tempDir() {
  const dir = registerTmpRoot(fs.mkdtempSync(path.join(os.tmpdir(), 'telemetry-')));
  tempDirs.push(dir);
  return dir;
}

/**
 * ساعةٌ مُقادةٌ باليد: تُقدَّم بالملّي ثانيةِ الصريحة، فتُقاس المدّةُ رقماً
 * معلوماً لا تقديراً.
 * @param {number} [start]
 */
function drivenClock(start = 1_000) {
  let value = start;
  return {
    now: () => value,
    /** @param {number} ms */
    advance: (ms) => {
      value += ms;
    },
  };
}

/**
 * @param {unknown} error
 * @returns {string}
 */
function codeOf(error) {
  return error instanceof TelemetryError || error instanceof TracerError
    ? error.code
    : String(error);
}

test.after(() => {
  for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true });
});

// ───────────────────────── الوثيقةُ والمخطَّط ─────────────────────────

test('الوثيقةُ تُحمَّل بمخطَّطها وتُعلن ما ينصّ عليه معيارُ القبول', () => {
  const policy = loadTelemetryPolicy();
  assert.equal(policy.version, 1);
  assert.equal(policy.sampling.mode, 'alwaysOn');
  assert.equal(policy.correlation.traceparentVersion, TRACEPARENT_VERSION);

  const spanNames = policy.spans.map((span) => span.name);
  // الطبقاتُ الثلاثُ التي يمرّ بها النداءُ الواحد: واجهةٌ ← مراقبةٌ ← تخزين.
  assert.deepEqual(spanNames, ['api.call', 'monitor.read', 'storage.read']);
  const emitters = new Map(policy.spans.map((span) => [span.name, span.emittedIn]));
  assert.equal(emitters.get('api.call'), 'src/api/gateway.mjs');
  assert.equal(emitters.get('storage.read'), 'src/observability/monitor-agent.mjs');

  // ورموزُ الرفضِ متقابلةٌ في الاتجاهين مع كتالوجِ الكود.
  assert.deepEqual([...policy.refusalCodes].sort(), [...Object.values(TELEMETRY_ERRORS)].sort());
});

test('وثيقةٌ غائبةٌ تُرَدُّ برمزٍ مُسمّىً ولا يبتدئ قياسٌ بأسماءٍ افتراضية', () => {
  const dir = tempDir();
  assert.throws(
    () => loadTelemetryPolicy({ dir }),
    (/** @type {unknown} */ error) => codeOf(error) === TELEMETRY_ERRORS.CONFIG_INVALID,
  );
});

test('وثيقةٌ تُخالف مخطَّطَها تُرَدُّ — والاسمُ المُخترَعُ لا يعبُر المخطَّط', () => {
  const dir = tempDir();
  fs.mkdirSync(path.join(dir, 'schemas'), { recursive: true });
  fs.copyFileSync(
    path.join(CONFIG_DIR, 'schemas', 'telemetry.schema.json'),
    path.join(dir, 'schemas', 'telemetry.schema.json'),
  );
  fs.writeFileSync(path.join(dir, 'telemetry.yaml'), 'version: 1\nstatement: نصٌّ قصير\n', 'utf8');
  assert.throws(
    () => loadTelemetryPolicy({ dir }),
    (/** @type {unknown} */ error) => codeOf(error) === TELEMETRY_ERRORS.CONFIG_INVALID,
  );
});

// ───────────────────────── معيارُ W3C Trace Context ─────────────────────────

test('المعرّفاتُ على طولِ المعيارِ ولا تكون أصفاراً كلَّها', () => {
  const traceId = newTraceId();
  const spanId = newSpanId();
  assert.equal(traceId.length, TRACE_ID_HEX_LENGTH);
  assert.equal(spanId.length, SPAN_ID_HEX_LENGTH);
  assert.ok(isValidTraceId(traceId));
  assert.ok(isValidSpanId(spanId));

  // والأصفارُ كلُّها معرّفٌ **باطلٌ معلَنٌ** في المعيارِ لا معرّفٌ نادر.
  assert.equal(isValidTraceId('0'.repeat(32)), false);
  assert.equal(isValidSpanId('0'.repeat(16)), false);
  // وحرفٌ كبيرٌ خارجُ الصيغة، وطولٌ ناقصٌ كذلك.
  assert.equal(isValidTraceId('A'.repeat(32)), false);
  assert.equal(isValidTraceId('a'.repeat(31)), false);
});

test('traceparent يُكتب ويُقرأ بالنسخة 00 ذهاباً وإياباً', () => {
  const context = { traceId: newTraceId(), spanId: newSpanId(), traceFlags: '01' };
  const header = formatTraceparent(context);
  assert.match(header, /^00-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$/);
  assert.deepEqual({ ...parseTraceparent(header) }, context);
});

test('رأسٌ مُشوَّهٌ يُرَدُّ ولا يُبتدأ أثرٌ جديدٌ صامتاً على أنقاضه', () => {
  for (const header of [
    '',
    'garbage',
    // نسخةٌ غيرُ 00 — والنسخةُ 00 وحدها مقروءةٌ هنا، وهذا حدٌّ معلَن.
    `01-${'a'.repeat(32)}-${'b'.repeat(16)}-01`,
    // معرّفٌ باطلٌ بالأصفار.
    `00-${'0'.repeat(32)}-${'b'.repeat(16)}-01`,
    // طولٌ ناقص.
    `00-${'a'.repeat(31)}-${'b'.repeat(16)}-01`,
    null,
    42,
  ]) {
    assert.throws(
      () => parseTraceparent(header),
      (/** @type {unknown} */ error) => codeOf(error) === TELEMETRY_ERRORS.CONTEXT_INVALID,
      `رأسٌ مُشوَّهٌ قُبِل: ${String(header)}`,
    );
  }
});

// ───────────────────────── الأثرُ الواحدُ والوراثةُ الضمنية ─────────────────────────

test('السياقُ يُوَرَّث ضمنياً: مدَياتٌ متداخلةٌ بلا تمريرٍ يدويٍّ تشترك في أثرٍ واحد', async () => {
  const clock = drivenClock();
  const tracer = new Tracer({ nowMs: clock.now });

  await tracer.withSpan('outer', {}, async () => {
    // لا يُمرَّر أبٌ ولا سياقٌ — والوراثةُ من `AsyncLocalStorage`.
    await tracer.withSpan('middle', {}, async () => {
      await tracer.withSpan('inner', {}, async () => {
        clock.advance(5);
      });
    });
  });

  const spans = tracer.finished();
  assert.equal(spans.length, 3);
  const traceIds = new Set(spans.map((span) => span.traceId));
  assert.equal(traceIds.size, 1, 'المدَياتُ الثلاثةُ يجب أن تكون في أثرٍ واحد');

  const byName = new Map(spans.map((span) => [span.name, span]));
  const outer = /** @type {import('../../src/telemetry/tracer.mjs').FinishedSpan} */ (
    byName.get('outer')
  );
  const middle = /** @type {import('../../src/telemetry/tracer.mjs').FinishedSpan} */ (
    byName.get('middle')
  );
  const inner = /** @type {import('../../src/telemetry/tracer.mjs').FinishedSpan} */ (
    byName.get('inner')
  );
  assert.equal(outer.parentSpanId, null);
  assert.equal(middle.parentSpanId, outer.spanId);
  assert.equal(inner.parentSpanId, middle.spanId);
});

test('السياقُ الوارِدُ من traceparent يُورَّث فيصير الأثرُ ممتدّاً عبر العملية', async () => {
  const tracer = new Tracer({ nowMs: drivenClock().now });
  const upstream = { traceId: newTraceId(), spanId: newSpanId(), traceFlags: '01' };
  await tracer.withSpan('root', { traceparent: formatTraceparent(upstream) }, async () => {});
  const [span] = tracer.finished();
  assert.equal(span?.traceId, upstream.traceId);
  assert.equal(span?.parentSpanId, upstream.spanId);
});

// ───────────────────────── الساعةُ المُمرَّرة ─────────────────────────

test('المدّةُ تُقاس بالساعةِ المُمرَّرةِ رقماً معلوماً لا تقديراً', async () => {
  const clock = drivenClock(10_000);
  const tracer = new Tracer({ nowMs: clock.now });
  await tracer.withSpan('measured', {}, async () => {
    clock.advance(250);
  });
  const [span] = tracer.finished();
  assert.equal(span?.durationMs, 250);
  assert.equal(span?.startTimeUnixNano, 10_000 * 1_000_000);
  assert.equal(span?.endTimeUnixNano, 10_250 * 1_000_000);
});

test('ساعةٌ تُعطي غيرَ عددٍ منتهٍ تُرَدُّ برمزٍ مُسمّىً ولا تُقاس عليها مدّة', async () => {
  const tracer = new Tracer({ nowMs: () => Number.NaN });
  await assert.rejects(
    () => tracer.withSpan('broken', {}, async () => {}),
    (/** @type {unknown} */ error) => codeOf(error) === TELEMETRY_ERRORS.CLOCK_INVALID,
  );
});

// ───────────────────────── الأسماءُ المُعلَنة ─────────────────────────

test('مدًى غيرُ مُعلَنٍ يُرَدُّ ولا يُصدَر باسمٍ لا تعرفه الوثيقة', async () => {
  const telemetry = createTelemetry({ now: drivenClock().now });
  await assert.rejects(
    () => telemetry.span('api.invented', {}, async () => 1),
    (/** @type {unknown} */ error) => codeOf(error) === TELEMETRY_ERRORS.SPAN_UNDECLARED,
  );
  assert.equal(telemetry.finishedSpans().length, 0);
});

test('وسمٌ غيرُ مُعلَنٍ للمدى يُرَدُّ برمزِه', async () => {
  const telemetry = createTelemetry({ now: drivenClock().now });
  await assert.rejects(
    () => telemetry.span('api.call', { attributes: { 'api.invented': 'x' } }, async () => 1),
    (/** @type {unknown} */ error) => codeOf(error) === TELEMETRY_ERRORS.ATTRIBUTE_UNDECLARED,
  );
});

test('مقياسٌ غيرُ مُعلَنٍ أو بنوعٍ مُبدَّلٍ يُرَدُّ برمزِه', () => {
  const registry = new MetricsRegistry([
    { name: 'api.call.count', kind: 'counter', unit: '{call}', purpose: 'عدّ' },
    { name: 'api.call.duration', kind: 'histogram', unit: 'ms', purpose: 'زمن' },
  ]);
  assert.throws(
    () => registry.addCounter('api.invented'),
    (/** @type {unknown} */ error) =>
      /** @type {{ code?: string }} */ (error).code === TELEMETRY_ERRORS.METRIC_UNDECLARED,
  );
  assert.throws(
    () => registry.addCounter('api.call.duration'),
    (/** @type {unknown} */ error) =>
      /** @type {{ code?: string }} */ (error).code === TELEMETRY_ERRORS.METRIC_KIND_MISMATCH,
  );
  assert.throws(
    () => registry.recordHistogram('api.call.count', 1),
    (/** @type {unknown} */ error) =>
      /** @type {{ code?: string }} */ (error).code === TELEMETRY_ERRORS.METRIC_KIND_MISMATCH,
  );
});

test('قيمةٌ باطلةٌ على عدّادٍ أو مدرجٍ تُرَدُّ ولا تُفسِد المجموع', () => {
  const registry = new MetricsRegistry([
    { name: 'api.call.count', kind: 'counter', unit: '{call}', purpose: 'عدّ' },
    { name: 'api.call.duration', kind: 'histogram', unit: 'ms', purpose: 'زمن' },
  ]);
  for (const bad of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(
      () => registry.addCounter('api.call.count', bad),
      (/** @type {unknown} */ error) =>
        /** @type {{ code?: string }} */ (error).code === TELEMETRY_ERRORS.VALUE_INVALID,
    );
  }
  assert.throws(
    () => registry.recordHistogram('api.call.duration', Number.NaN),
    (/** @type {unknown} */ error) =>
      /** @type {{ code?: string }} */ (error).code === TELEMETRY_ERRORS.VALUE_INVALID,
  );
  assert.equal(registry.counterValue('api.call.count'), 0);
});

test('قيمُ المدرجِ تُفتَح للقراءةِ مع فرقٍ مُعلَنٍ بين المقيسِ والمحفوظ', () => {
  const registry = new MetricsRegistry([
    { name: 'api.call.duration', kind: 'histogram', unit: 'ms', purpose: 'زمن' },
  ]);
  // ولا مدرجَ قبل أوّلِ نداءٍ: `null` صريحةٌ لا صفرٌ يُقرأ قياساً.
  assert.equal(registry.histogramSamples('api.call.duration'), null);
  for (const value of [10, 20, 30]) registry.recordHistogram('api.call.duration', value);
  const reading = registry.histogramSamples('api.call.duration');
  assert.ok(reading !== null);
  assert.equal(reading.count, 3);
  assert.equal(reading.retained, 3);
  assert.deepEqual([...reading.values], [10, 20, 30]);
  assert.ok(Object.isFrozen(reading));
  assert.ok(Object.isFrozen(reading.values));
  // والوسومُ تفصل السلاسل: قراءةُ وسمٍ لم يُنادَ بِه `null` لا قيمُ غيرِه.
  assert.equal(registry.histogramSamples('api.call.duration', { 'api.route': 'r' }), null);
  assert.throws(
    () => registry.histogramSamples('api.invented'),
    (/** @type {unknown} */ error) =>
      /** @type {{ code?: string }} */ (error).code === TELEMETRY_ERRORS.METRIC_UNDECLARED,
  );
});

test('فوق سقفِ المعاينةِ يبقى العدُّ صادقاً ويُعلَن المحفوظُ أقلَّ منه', () => {
  const registry = new MetricsRegistry([
    { name: 'api.call.duration', kind: 'histogram', unit: 'ms', purpose: 'زمن' },
  ]);
  const total = 2100;
  for (let index = 0; index < total; index += 1) {
    registry.recordHistogram('api.call.duration', 1);
  }
  const reading = registry.histogramSamples('api.call.duration');
  assert.ok(reading !== null);
  // العدُّ المقيسُ كاملٌ، والمحفوظُ محدودٌ بسقفِ المعاينة: والفرقُ **مُعلَنٌ**
  // ليقرأ المستدعي رقمَه مُعايَناً لا تامّاً، فلا يُدَّعى قياسٌ كاملٌ على معاينة.
  assert.equal(reading.count, total);
  assert.ok(reading.retained < reading.count);
  assert.equal(reading.retained, reading.values.length);
});

test('العدّادُ يجمع بالوسومِ لا بترتيبِ كتابتِها', () => {
  const registry = new MetricsRegistry([
    { name: 'api.call.count', kind: 'counter', unit: '{call}', purpose: 'عدّ' },
  ]);
  registry.addCounter('api.call.count', 1, { a: '1', b: '2' });
  registry.addCounter('api.call.count', 2, { b: '2', a: '1' });
  assert.equal(registry.counterValue('api.call.count', { a: '1', b: '2' }), 3);
  assert.equal(registry.snapshot().counters.length, 1);
});

test('مستوى سجلٍّ غيرُ مُعلَنٍ يُرَدُّ برمزِه', () => {
  const telemetry = createTelemetry({ now: drivenClock().now });
  assert.throws(
    () => telemetry.log('trace', 'رسالة'),
    (/** @type {unknown} */ error) => codeOf(error) === TELEMETRY_ERRORS.LEVEL_UNDECLARED,
  );
});

// ───────────────────────── ارتباطُ السجلِّ بالأثر ─────────────────────────

test('سطرُ السجلِّ داخلَ مدًى يحمل معرّفَي أثرِه ومداه، وخارجَه يحملهما فارغَين صراحةً', async () => {
  const telemetry = createTelemetry({ now: drivenClock().now });
  const outside = telemetry.log('info', 'خارجَ كلِّ مدًى');
  assert.equal(outside.traceId, null);
  assert.equal(outside.spanId, null);

  /** @type {import('../../src/telemetry/telemetry.mjs').TelemetryLogRecord | null} */
  let inside = null;
  await telemetry.span('api.call', { attributes: { 'api.route': 'r' } }, async (span) => {
    inside = telemetry.log('warn', 'داخلَ المدى');
    assert.equal(inside.traceId, span.traceId);
    assert.equal(inside.spanId, span.spanId);
  });
  assert.notEqual(inside, null);
});

// ───────────────────────── الحدودُ والرفضُ المُسمّى ─────────────────────────

test('فوق سقفِ المدَياتِ رفضٌ مُسمّىً لا إسقاطٌ صامت', async () => {
  const tracer = new Tracer({ nowMs: drivenClock().now, maxSpansPerTrace: 3 });
  await tracer.withSpan('root', {}, async () => {
    await tracer.withSpan('a', {}, async () => {});
    await tracer.withSpan('b', {}, async () => {});
    await assert.rejects(
      () => tracer.withSpan('c', {}, async () => {}),
      (/** @type {unknown} */ error) => codeOf(error) === TELEMETRY_ERRORS.SPAN_LIMIT_EXCEEDED,
    );
  });
});

test('الوسمُ الطويلُ يُقتطَع ويُعلَن اقتطاعُه، ولا يُقرأ ناقصاً على أنه تامّ', async () => {
  const tracer = new Tracer({ nowMs: drivenClock().now, maxAttributeLength: 8 });
  await tracer.withSpan('root', {}, (span) => {
    span.setAttribute('long', 'x'.repeat(50));
  });
  const [span] = tracer.finished();
  assert.equal(span?.attributes['long'], 'x'.repeat(8));
  assert.equal(span?.attributes['telemetry.attributes.truncated'], true);
});

test('إغلاقُ مدًى مرّتين يُرَدُّ — والمدّةُ تُقاس مرّةً أو لا تُقاس', async () => {
  const tracer = new Tracer({ nowMs: drivenClock().now });
  const span = tracer.startSpan('once');
  span.end();
  assert.throws(
    () => span.end(),
    (/** @type {unknown} */ error) => codeOf(error) === TELEMETRY_ERRORS.SPAN_ALREADY_ENDED,
  );
  assert.throws(
    () => span.setAttribute('k', 'v'),
    (/** @type {unknown} */ error) => codeOf(error) === TELEMETRY_ERRORS.SPAN_ALREADY_ENDED,
  );
});

// ───────────────────────── القياسُ لا يُبدّل المقيس ─────────────────────────

test('withSpan يُعيد القيمةَ كما هي ويُعيد رميَ الخطأِ نفسِه لا مُغلَّفاً', async () => {
  const tracer = new Tracer({ nowMs: drivenClock().now });
  const value = { ok: true };
  assert.equal(await tracer.withSpan('ok', {}, async () => value), value);

  const failure = new Error('خطأُ عملٍ لا خطأُ قياس');
  await assert.rejects(
    () =>
      tracer.withSpan('bad', {}, async () => {
        throw failure;
      }),
    (/** @type {unknown} */ error) => error === failure,
  );
  const bad = tracer.finished().find((span) => span.name === 'bad');
  assert.equal(bad?.status.code, 'error');
  assert.equal(bad?.status.message, 'خطأُ عملٍ لا خطأُ قياس');
});

test('مستقبِلٌ يرمي لا يُسقِط النداءَ المقيس', async () => {
  const tracer = new Tracer({
    nowMs: drivenClock().now,
    onSpanEnd: () => {
      throw new Error('مستقبِلٌ فاسد');
    },
  });
  assert.equal(await tracer.withSpan('safe', {}, async () => 7), 7);
});

test('المدَياتُ المنتهيةُ مُجمَّدةٌ فلا يُبدَّل دليلٌ بعد تسجيله', async () => {
  const tracer = new Tracer({ nowMs: drivenClock().now });
  await tracer.withSpan('frozen', {}, (span) => {
    span.setAttribute('k', 'v');
  });
  const [span] = tracer.finished();
  assert.ok(Object.isFrozen(span));
  assert.ok(Object.isFrozen(span?.attributes));
  assert.throws(() => {
    /** @type {{ name: string }} */ (/** @type {unknown} */ (span)).name = 'other';
  });
});

// ───────────────────────── الحاجزُ يعمل ويرفض ─────────────────────────

test('حاجزُ القياسِ يمرّ على المستودعِ كما هو', () => {
  const result = spawnSync(process.execPath, [GUARD], { encoding: 'utf8' });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /حاجز القياس الموحّد/u);
});

test('الواجهةُ الجامعةُ تُبنى من وثيقةٍ مُمرَّرةٍ ولا تقرأ القرصَ مرّتين', async () => {
  const policy = loadTelemetryPolicy();
  const telemetry = new Telemetry({ policy, now: drivenClock().now });
  assert.deepEqual(telemetry.declaredSpanNames(), ['api.call', 'monitor.read', 'storage.read']);
  await telemetry.span('monitor.read', { attributes: { 'monitor.view': 'v' } }, async () => {});
  assert.equal(telemetry.finishedSpans().length, 1);
  telemetry.clear();
  assert.equal(telemetry.finishedSpans().length, 0);
});
