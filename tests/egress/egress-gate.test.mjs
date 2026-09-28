// اختبار بوابة الخروج الخارجي — M6.05.
//
// المقيس ليس «هل تنقل البوابة حِزمة» بل: هل يبقى مسارٌ لإخراج بيانات بلا قرارٍ
// أو بلا أثرٍ أو بلا حدّ. فالمفحوص: جهةٌ غير معلَنة، وفاعلٌ غير مأذون، ومصنَّفٌ
// حسّاس إلى جهة معتمدة، وحدُّ معدّلٍ متجاوَز، وحمولةٌ فوق الحدّ، وتذكرةٌ لا
// تُستهلَك مرّتين. ونقطة التفويض هنا **حقيقية** بحزمة السياسات الحقيقية: بوابةٌ
// تُختبر بنقطةٍ مزيّفة تُثبت أنها تنادي مزيّفاً لا أنها محكومة.

import test from 'node:test';
import assert from 'node:assert/strict';

import { loadPolicyBundle } from '../../src/policy/loader.mjs';
import { createPolicyDecisionPoint } from '../../src/policy/engine.mjs';
import { EnforcementPoint } from '../../src/policy/enforcement-point.mjs';
import { EGRESS_ERRORS, EgressGate, createEgressGate } from '../../src/egress/egress-gate.mjs';

const bundle = loadPolicyBundle();

const DESTINATIONS = [
  {
    id: 'federation:audit-mirror',
    uri: 'https://audit-mirror.federation.example/ingest',
    purpose: 'مرآة تدقيق معتمدة',
  },
  {
    id: 'federation:archive',
    uri: 'https://archive.federation.example/ingest',
    purpose: 'أرشيف معتمد',
  },
];

/** سجل أحداث صغير: المقيس ما سُجّل، فلا يُستعار سجلٌ ثقيل لقياس التسجيل. */
function memoryLog() {
  /** @type {Array<{ type: string, actor: string, payload: Record<string, unknown> }>} */
  const events = [];
  return {
    events,
    /**
     * @param {string} type
     * @param {string} actor
     * @param {object} payload
     * @returns {void}
     */
    append(type, actor, payload) {
      events.push({ type, actor, payload: /** @type {Record<string, unknown>} */ (payload) });
    },
  };
}

/**
 * @param {{ callsPerWindow?: number, maxPayloadBytes?: number, transport?: (record: object) => Promise<unknown>, quarantine?: { report: (signal: object) => unknown } | null, classifier?: import('../../src/egress/egress-gate.mjs').EgressClassifier | null }} [deps]
 */
function setup(deps = {}) {
  const log = memoryLog();
  /** @type {Array<{ destination: { id: string }, bytes: number }>} */
  const sent = [];
  const point = new EnforcementPoint({
    decisionPoint: createPolicyDecisionPoint({ bundle }),
    log,
    requireIdentityGate: false,
  });
  const gate = createEgressGate({
    enforcementPoint: point,
    log,
    destinations: DESTINATIONS,
    quarantine: deps.quarantine ?? null,
    classifier: deps.classifier ?? null,
    callsPerWindow: deps.callsPerWindow ?? 30,
    maxPayloadBytes: deps.maxPayloadBytes ?? 1024,
    transport:
      deps.transport ??
      (async (record) => {
        sent.push(/** @type {{ destination: { id: string }, bytes: number }} */ (record));
        return { status: 202 };
      }),
  });
  return { gate, log, sent, point };
}

/**
 * @param {Partial<{ id: string, role: string, state: string, scope: string }>} [patch]
 */
function minister(patch = {}) {
  return {
    id: 'agent:minister-1',
    role: 'role:minister',
    kind: /** @type {const} */ ('human'),
    state: 'active',
    scope: 'org:interior',
    ...patch,
  };
}

test('الخروج المأذون إلى جهة معتمدة ينفُذ ويُسجَّل بحجمه وغرضه', async () => {
  const { gate, log, sent } = setup();
  const outcome = await gate.send({
    actor: minister(),
    destination: 'federation:audit-mirror',
    payload: 'سطر تدقيق',
    classification: 'internal',
    resourceId: 'audit:2026-08-24',
  });
  assert.equal(outcome.destination, 'federation:audit-mirror');
  assert.equal(outcome.bytes, Buffer.byteLength('سطر تدقيق', 'utf8'));
  assert.equal(sent.length, 1);
  const record = log.events.find((event) => event.type === 'egress.sent');
  assert.ok(record, 'النقل الناجح يجب أن يُسجَّل');
  assert.equal(record.payload['purpose'], 'مرآة تدقيق معتمدة');
  assert.equal(record.payload['bytes'], outcome.bytes);
});

test('فاعلٌ غير مأذون يُحجب ويُسجَّل رفضه ولا يمسّ الناقل', async () => {
  const { gate, log, sent } = setup();
  await assert.rejects(
    gate.send({
      actor: { id: 'agent:operator-1', role: 'role:operator', kind: 'autonomous', state: 'active' },
      destination: 'federation:archive',
      payload: 'محاولة',
      resourceId: 'audit:x',
    }),
    (error) => {
      assert.equal(/** @type {{ code: string }} */ (error).code, EGRESS_ERRORS.NOT_AUTHORIZED);
      return true;
    },
  );
  assert.equal(sent.length, 0, 'المرفوض لا يصل الناقل');
  const refusal = log.events.find((event) => event.type === 'egress.refused');
  assert.ok(refusal, 'الرفض يُسجَّل كما يُسجَّل النقل');
  assert.equal(refusal.payload['code'], EGRESS_ERRORS.NOT_AUTHORIZED);
  assert.ok(
    log.events.some((event) => event.type === 'policy.decision'),
    'قرار السياسة نفسه يُسجَّل أيضاً',
  );
});

test('الجهة غير المعلَنة تُرفض قبل التفويض', async () => {
  const { gate, log, sent } = setup();
  await assert.rejects(
    gate.send({
      actor: minister(),
      destination: 'https://exfil.example/collect',
      payload: 'بيانات',
    }),
    (error) => /** @type {{ code: string }} */ (error).code === EGRESS_ERRORS.DESTINATION_UNKNOWN,
  );
  assert.equal(sent.length, 0);
  assert.equal(
    log.events.filter((event) => event.type === 'policy.decision').length,
    0,
    'جهةٌ مجهولة تُرفض قبل أن يُستدعى التفويض',
  );
});

test('المصنَّف الحسّاس لا يخرج ولو كان الفاعل مأذوناً والجهة معتمدة', async () => {
  const { gate, sent } = setup();
  await assert.rejects(
    gate.send({
      actor: minister(),
      destination: 'federation:audit-mirror',
      payload: 'سرّ',
      classification: 'secret',
      resourceId: 'audit:secret',
    }),
    (error) => /** @type {{ code: string }} */ (error).code === EGRESS_ERRORS.NOT_AUTHORIZED,
  );
  assert.equal(sent.length, 0);
});

test('حدّ المعدّل يوقف الطلب المتجاوز ويُسجّله', async () => {
  const { gate, log, sent } = setup({ callsPerWindow: 2 });
  for (let index = 0; index < 2; index += 1) {
    await gate.send({
      actor: minister(),
      destination: 'federation:archive',
      payload: `حزمة ${index}`,
      resourceId: `audit:${index}`,
    });
  }
  await assert.rejects(
    gate.send({
      actor: minister(),
      destination: 'federation:archive',
      payload: 'الحزمة الثالثة',
      resourceId: 'audit:3',
    }),
    (error) => /** @type {{ code: string }} */ (error).code === EGRESS_ERRORS.RATE_LIMIT_EXCEEDED,
  );
  assert.equal(sent.length, 2, 'ما بعد الحدّ لا ينقُل');
  assert.ok(
    log.events.some(
      (event) =>
        event.type === 'egress.refused' &&
        event.payload['code'] === EGRESS_ERRORS.RATE_LIMIT_EXCEEDED,
    ),
  );
});

test('الحمولة فوق الحدّ تُرفض بلا تفويض، والقياس بالبايت لا بالمحرف', async () => {
  const { gate, log } = setup({ maxPayloadBytes: 8 });
  assert.equal(EgressGate.sizeOf('أربعة'), 10);
  await assert.rejects(
    gate.send({ actor: minister(), destination: 'federation:archive', payload: 'أربعة' }),
    (error) => /** @type {{ code: string }} */ (error).code === EGRESS_ERRORS.PAYLOAD_TOO_LARGE,
  );
  assert.equal(log.events.filter((event) => event.type === 'policy.decision').length, 0);
});

test('فشل الناقل يُسجَّل بخطأ مُسمّى لا يُبلَّع', async () => {
  const { gate, log } = setup({
    transport: async () => {
      throw new Error('الشبكة مقطوعة');
    },
  });
  await assert.rejects(
    gate.send({
      actor: minister(),
      destination: 'federation:archive',
      payload: 'حزمة',
      resourceId: 'audit:t',
    }),
    (error) => /** @type {{ code: string }} */ (error).code === EGRESS_ERRORS.TRANSPORT_FAILED,
  );
  assert.ok(
    log.events.some(
      (event) =>
        event.type === 'egress.refused' && event.payload['code'] === EGRESS_ERRORS.TRANSPORT_FAILED,
    ),
  );
});

test('كل نقل يستهلك تذكرته: لا تذكرة تُستعمل مرّتين', async () => {
  const { gate, point } = setup();
  await gate.send({
    actor: minister(),
    destination: 'federation:archive',
    payload: 'حزمة',
    resourceId: 'audit:once',
  });
  assert.equal(point.issued.size, 0, 'التذكرة تُستهلَك في لحظة النقل فلا تبقى صالحة');
});

test('البوابة ترفض الإنشاء بلا نقطة تفويض أو سجل أو ناقل', () => {
  assert.throws(
    () => createEgressGate({ log: memoryLog(), transport: async () => undefined }),
    (error) => /** @type {{ code: string }} */ (error).code === EGRESS_ERRORS.DEPENDENCY_MISSING,
  );
});

test('الرفض يُبلَّغ الحجر الصحّي إن كان موصولاً', async () => {
  /** @type {Array<{ kind: string, subject: string }>} */
  const signals = [];
  const { gate } = setup({
    quarantine: {
      report(signal) {
        signals.push(/** @type {{ kind: string, subject: string }} */ (signal));
      },
    },
  });
  await assert.rejects(
    gate.send({ actor: minister(), destination: 'unknown:place', payload: 'x' }),
    (error) => /** @type {{ code: string }} */ (error).code === EGRESS_ERRORS.DESTINATION_UNKNOWN,
  );
  assert.equal(signals.length, 1);
  assert.equal(signals[0]?.kind, 'egress-refused');
  assert.equal(signals[0]?.subject, 'agent:minister-1');
});

// ── R5-B-05 (`M11.05` الجولة 1، `grok_4_6`، مسلك EGRESS-03) ─────────────────
// المقيسُ: هل يُخرَجُ مصنَّفٌ حسّاسٌ بإعلانِ المُنادي أنّه عامٌّ؟ قبلَ `WL-275`
// كانت البوابةُ تأخذُ `classification` من الطلبِ كما وردَ، فبايتٌ مسجَّلٌ حسّاساً
// يُعلَنُ `public` يَعبُرُ `pol:deny-egress-of-sensitive` إلى جهةٍ معتمدة.

/**
 * مُصنِّفٌ من جدولٍ ثابت: التصنيفُ المسجَّلُ لا ما يقولُه المُنادي.
 * @param {Record<string, string>} table
 * @returns {import('../../src/egress/egress-gate.mjs').EgressClassifier}
 */
function recordedAs(table) {
  return { classificationOf: (resourceId) => table[resourceId] ?? null };
}

/**
 * @param {string} code
 * @returns {(error: unknown) => boolean}
 */
function codeIs(code) {
  return (error) => {
    assert.equal(/** @type {{ code: string }} */ (error).code, code);
    return true;
  };
}

test('R5-B-05: مسجَّلٌ حسّاسٌ يُعلَنُ `public` لا يخرج — المسجَّلُ يغلبُ الادّعاءَ الأدنى', async () => {
  const { gate, sent, log } = setup({ classifier: recordedAs({ 'data:ledger': 'sensitive' }) });
  await assert.rejects(
    gate.send({
      actor: minister(),
      destination: 'federation:archive',
      payload: new Uint8Array([0x2a]),
      classification: 'public',
      resourceId: 'data:ledger',
    }),
    codeIs(EGRESS_ERRORS.NOT_AUTHORIZED),
  );
  assert.equal(sent.length, 0, 'البايتُ الحسّاسُ لم يصلِ الناقل');
  const decision = log.events.find((event) => event.type === 'policy.decision');
  assert.equal(decision?.payload['policyId'], 'pol:deny-egress-of-sensitive');
  const refusal = log.events.find((event) => event.type === 'egress.refused');
  assert.equal(refusal?.payload['classification'], 'sensitive', 'السجلُّ يَحملُ التصنيفَ الفعليَّ');
});

test('R5-B-05: بلا مُصنِّفٍ لا ينزلُ الادّعاءُ دونَ `internal`', async () => {
  const { gate, log } = setup();
  await gate.send({
    actor: minister(),
    destination: 'federation:archive',
    payload: 'سطر',
    classification: 'public',
    resourceId: 'audit:floor',
  });
  const record = log.events.find((event) => event.type === 'egress.sent');
  assert.equal(record?.payload['classification'], 'internal');
});

test('R5-B-05: موردٌ بلا تصنيفٍ مسجَّلٍ يُرفَضُ قبلَ التفويضِ حينَ يُوصَلُ مُصنِّف', async () => {
  const { gate, sent, log } = setup({ classifier: recordedAs({}) });
  await assert.rejects(
    gate.send({
      actor: minister(),
      destination: 'federation:archive',
      payload: 'سطر',
      classification: 'public',
      resourceId: 'data:unrecorded',
    }),
    codeIs(EGRESS_ERRORS.CLASSIFICATION_UNRECORDED),
  );
  assert.equal(sent.length, 0);
  assert.equal(log.events.filter((event) => event.type === 'policy.decision').length, 0);
});

test('R5-B-05: تصنيفٌ لا يعرفُه السلّمُ يُرفَضُ ولا يُقرأُ عامّاً', async () => {
  const { gate, sent } = setup();
  await assert.rejects(
    gate.send({
      actor: minister(),
      destination: 'federation:archive',
      payload: 'سطر',
      classification: 'top-secret',
      resourceId: 'audit:unknown',
    }),
    codeIs(EGRESS_ERRORS.CLASSIFICATION_UNKNOWN),
  );
  assert.equal(sent.length, 0);
});

test('R5-B-05: المرتبةُ المختومةُ باسمِها القانونيِّ `sovereign` لا تخرج ولو أذِنَت السياسة', async () => {
  const { gate, sent } = setup({ classifier: recordedAs({ 'data:root': 'sovereign' }) });
  await assert.rejects(
    gate.send({
      actor: minister(),
      destination: 'federation:archive',
      payload: 'جذر',
      resourceId: 'data:root',
    }),
    codeIs(EGRESS_ERRORS.CLASSIFICATION_SEALED),
  );
  assert.equal(sent.length, 0);
});

test('R5-B-05: الادّعاءُ يرفعُ — مسجَّلٌ عامٌّ يُعلَنُ حسّاساً يُعامَلُ حسّاساً', async () => {
  const { gate, sent } = setup({ classifier: recordedAs({ 'data:notice': 'public' }) });
  await assert.rejects(
    gate.send({
      actor: minister(),
      destination: 'federation:archive',
      payload: 'إعلان',
      classification: 'sensitive',
      resourceId: 'data:notice',
    }),
    codeIs(EGRESS_ERRORS.NOT_AUTHORIZED),
  );
  assert.equal(sent.length, 0);
});

test('R5-B-05: مسجَّلٌ عامٌّ يخرجُ عامّاً — المُصنِّفُ لا يَكسِرُ المأذون', async () => {
  const { gate, sent, log } = setup({ classifier: recordedAs({ 'data:notice': 'public' }) });
  await gate.send({
    actor: minister(),
    destination: 'federation:archive',
    payload: 'إعلان',
    classification: 'public',
    resourceId: 'data:notice',
  });
  assert.equal(sent.length, 1);
  const record = log.events.find((event) => event.type === 'egress.sent');
  assert.equal(record?.payload['classification'], 'public');
});

test('R5-B-05: البوابةُ بلا مُصنِّفٍ لا تُبنى في الإنتاجِ — محقوناً ومن العمليّة', () => {
  const deps = {
    enforcementPoint: /** @type {never} */ ({}),
    log: memoryLog(),
    transport: async () => ({}),
    destinations: DESTINATIONS,
  };
  assert.throws(
    () => new EgressGate({ ...deps, env: { STATE_ENV: 'production' } }),
    codeIs(EGRESS_ERRORS.CLASSIFIER_REQUIRED_IN_PRODUCTION),
  );
  const had = Object.hasOwn(process.env, 'STATE_ENV');
  const previous = process.env['STATE_ENV'];
  process.env['STATE_ENV'] = 'production';
  try {
    assert.throws(
      () => new EgressGate({ ...deps, env: {} }),
      codeIs(EGRESS_ERRORS.CLASSIFIER_REQUIRED_IN_PRODUCTION),
    );
    assert.doesNotThrow(
      () => new EgressGate({ ...deps, classifier: recordedAs({}), env: {} }),
      'بمُصنِّفٍ موصولٍ تُبنى في الإنتاج',
    );
  } finally {
    if (had) process.env['STATE_ENV'] = previous;
    else delete process.env['STATE_ENV'];
  }
});
