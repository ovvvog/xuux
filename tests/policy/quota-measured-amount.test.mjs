// اختبارُ مقدارِ خصمِ الحصّةِ — إغلاقُ `R6-A-02` (مجلسُ النماذجِ، الجولةُ M11.06).
//
// **العيبُ المُقاسُ قبلَ الإصلاحِ بنصِّه:** `src/policy/enforcement-point.mjs`
// L247–248 كان يقرأُ `evaluated.context?.['quotaAmount']` وإلّا يخصمُ `1`. ولمّا
// كانت بوابةُ الإخراجِ تُمرِّرُ `bytes` في السياقِ (لا `quotaAmount`)، كان إخراجُ
// خمسِمئةِ ألفِ بايتٍ يخصمُ **واحداً** من موردٍ حدُّه المُعلَنُ
// `1073741824` بايتاً في اليومِ — فالسقفُ المُعلَنُ بالبايتِ لم يكن نافذاً
// بالبايتِ، وطفرةُ «ثبِّت المقدارَ على 1» (‏M15) نجَت من كلِّ الاختباراتِ.
// وفوقَ ذلك: السياقُ يملكُه المُنادي، فكان بمُكنتِه إعلانُ الكمّيةِ التي يُخصمُ
// منها بنفسِه.
//
// **وما يقيسُه هذا الملفُّ:** أنّ المخصومَ عددٌ **مُقاسٌ** لا عدُّ نداءاتٍ، وأنّ
// وحدةَ القياسِ تُقرأُ من `config/quotas.yaml` لا من الشفرةِ، وأنّ قناةَ القياسِ
// **ليست** سياقَ المُنادي، وأنّ الكمّيةَ غيرَ المقيسةِ **رفضٌ مُسمّىً** لا سقوطٌ
// إلى واحدٍ.

import test from 'node:test';
import assert from 'node:assert/strict';

import { loadPolicyBundle } from '../../src/policy/loader.mjs';
import { createPolicyDecisionPoint } from '../../src/policy/engine.mjs';
import { EnforcementPoint } from '../../src/policy/enforcement-point.mjs';
import { createEgressGate } from '../../src/egress/egress-gate.mjs';

const DESTINATIONS = [
  {
    id: 'federation:audit-mirror',
    uri: 'https://audit-mirror.federation.example/ingest',
    purpose: 'مرآة تدقيق معتمدة',
  },
];

const bundle = loadPolicyBundle();

/** سجلٌّ صغيرٌ: المقيسُ ما سُجّل، فلا يُستعارُ سجلٌّ ثقيلٌ لقياسِ التسجيلِ. */
function memoryLog() {
  /** @type {Array<{ type: string, actor: string, payload: any }>} */
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
      events.push({ type, actor, payload });
    },
  };
}

/** دفترُ حصصٍ يُسجّلُ كلَّ خصمٍ بمقدارِه: المقيسُ هو المقدارُ لا وقوعُ النداءِ. */
function recordingLedger() {
  /** @type {Array<{ resource: string, subjectId: string, amount: number }>} */
  const debits = [];
  return {
    debits,
    /** @returns {number} */
    get total() {
      return debits.reduce((sum, entry) => sum + entry.amount, 0);
    },
    /**
     * @param {{ subjectType: string, subjectId: string, resource: string, amount: number }} request
     */
    async debit(request) {
      debits.push({
        resource: request.resource,
        subjectId: request.subjectId,
        amount: request.amount,
      });
      return {
        resource: request.resource,
        consumed: debits.reduce((sum, entry) => sum + entry.amount, 0),
        limit: Number.MAX_SAFE_INTEGER,
        remaining: Number.MAX_SAFE_INTEGER,
      };
    },
  };
}

/**
 * @param {{ quotaLedger?: any }} [deps]
 */
function setup(deps = {}) {
  const log = memoryLog();
  const point = new EnforcementPoint({
    decisionPoint: createPolicyDecisionPoint({ bundle }),
    log,
    quotaLedger: deps.quotaLedger ?? null,
  });
  return { point, log };
}

/**
 * @param {number} bytes
 * @returns {import('../../src/policy/model.mjs').PolicyRequest}
 */
function egressRequest(bytes) {
  return {
    actor: { id: 'agent:minister-1', kind: 'autonomous', role: 'role:minister', state: 'active' },
    action: 'external-egress',
    resource: { type: 'data', id: 'data:report', classification: 'internal' },
    context: { destination: 'federation:audit-mirror', bytes },
  };
}

test('وحدةُ القياسِ مُعلَنةٌ في الوثيقةِ لكلِّ حصّةٍ — لا وحدةَ في الشفرةِ', () => {
  const quotas = bundle.quotas ?? [];
  assert.ok(quotas.length > 0, 'لا حصصَ في الحزمةِ — انقطعَ مصدرُ القياسِ.');
  for (const quota of quotas) {
    const measure = /** @type {{ kind?: string, key?: string }} */ (quota['measure']);
    assert.ok(
      measure !== undefined && (measure.kind === 'calls' || measure.kind === 'measured'),
      `المورد ${String(quota['resource'])} بلا وحدةِ قياسٍ معلَنةٍ.`,
    );
    if (measure.kind === 'measured') {
      assert.equal(
        typeof measure.key,
        'string',
        `المورد ${String(quota['resource'])} measured بلا مفتاحِ قياسٍ.`,
      );
    }
  }
  // والحدُّ المُعلَنُ بالبايتِ وحدةُ قياسِه مقيسةٌ لا نداءٌ — وهذا هو نصُّ العيبِ.
  const egress = quotas.find((entry) => entry['resource'] === 'egress-bytes');
  assert.deepEqual(egress?.['measure'], { kind: 'measured', key: 'bytes' });
});

test('خصمُ الإخراجِ يساوي عددَ البايتاتِ المقيسةِ لا عددَ النداءاتِ', async () => {
  const quotaLedger = recordingLedger();
  const { point } = setup({ quotaLedger });
  const bytes = 500000;
  const { decision, quota } = await point.authorize(egressRequest(bytes), {
    measured: { bytes },
  });
  assert.equal(decision.allowed, true, `الإخراجُ رُفض: ${decision.code} — ${decision.reason}`);
  assert.deepEqual(quotaLedger.debits, [
    { resource: 'egress-bytes', subjectId: 'agent:minister-1', amount: bytes },
  ]);
  assert.equal(quota?.amount, bytes);
  // ونداءانِ يخصمانِ ضِعفَ الكمّيةِ لا اثنينِ.
  await point.authorize(egressRequest(bytes), { measured: { bytes } });
  assert.equal(quotaLedger.total, bytes * 2);
});

test('بوابةُ الإخراجِ تُمرِّرُ الحجمَ المقيسَ فعلاً — لا الطالبُ ولا رقمٌ ثابتٌ', async () => {
  const quotaLedger = recordingLedger();
  const { point } = setup({ quotaLedger });
  const payload = 'ب'.repeat(4096);
  const bytes = Buffer.byteLength(payload, 'utf8');
  const gate = createEgressGate({
    log: memoryLog(),
    enforcementPoint: point,
    destinations: DESTINATIONS,
    quarantine: null,
    callsPerWindow: 30,
    maxPayloadBytes: 1048576,
    transport: async () => ({ status: 202 }),
  });
  await gate.send({
    actor: { id: 'agent:minister-1', kind: 'autonomous', role: 'role:minister', state: 'active' },
    destination: 'federation:audit-mirror',
    payload,
    classification: 'internal',
    resourceId: 'audit:measured',
    // المُنادي يُعلنُ كمّيةً كاذبةً في سياقِه: القناةُ ميّتةٌ فلا أثرَ لها.
    context: { quotaAmount: 1, bytes: 1 },
  });
  assert.equal(quotaLedger.debits.length, 1);
  assert.equal(quotaLedger.debits[0]?.amount, bytes);
  assert.notEqual(quotaLedger.debits[0]?.amount, 1);
});

test('كمّيةٌ غيرَ مقيسةٍ رفضٌ مُسمّىً ولا خصمَ — لا سقوطٌ إلى واحدٍ', async () => {
  const quotaLedger = recordingLedger();
  const { point } = setup({ quotaLedger });
  const { decision, token, quota } = await point.authorize(egressRequest(500000));
  assert.equal(decision.allowed, false);
  assert.equal(decision.code, 'QUOTA_AMOUNT_UNMEASURED');
  assert.equal(token, null);
  assert.equal(quota, null);
  assert.deepEqual(quotaLedger.debits, [], 'خُصمت حصّةٌ على كمّيةٍ لم تُقَس.');
});

test('السياقُ ليس قناةَ قياسٍ: حقنُ quotaAmount أو bytes في الطلبِ لا يُخصمُ منه', async () => {
  const quotaLedger = recordingLedger();
  const { point } = setup({ quotaLedger });
  const request = {
    ...egressRequest(9),
    context: { destination: 'federation:audit-mirror', bytes: 9, quotaAmount: 9 },
  };
  const { decision } = await point.authorize(request);
  assert.equal(decision.allowed, false, 'سياقُ المُنادي قِيسَ كأنّه قياسٌ.');
  assert.equal(decision.code, 'QUOTA_AMOUNT_UNMEASURED');
  assert.deepEqual(quotaLedger.debits, []);
});

test('مَورِدٌ بلا وحدةِ قياسٍ مُعلَنةٍ يُرفَضُ ولا يُخصمُ بواحدٍ', async () => {
  const quotaLedger = recordingLedger();
  const { point } = setup({ quotaLedger });
  // تُحذفُ وحدةُ القياسِ من الخريطةِ كما لو حُذفت من الوثيقةِ: الأثرُ رفضٌ لا خصمٌ.
  point.quotaMeasures = new Map(
    [...point.quotaMeasures].filter(([resource]) => resource !== 'egress-bytes'),
  );
  const { decision } = await point.authorize(egressRequest(500000), {
    measured: { bytes: 500000 },
  });
  assert.equal(decision.allowed, false);
  assert.equal(decision.code, 'QUOTA_MEASURE_UNDECLARED');
  assert.deepEqual(quotaLedger.debits, []);
});

test('موردٌ مُعلَنٌ بالنداءِ يخصمُ واحداً — بإعلانِ الوثيقةِ لا بسقوطٍ ضمنيٍّ', async () => {
  const quotaLedger = recordingLedger();
  const { point } = setup({ quotaLedger });
  const { decision } = await point.authorize({
    actor: { id: 'agent:one', kind: 'autonomous', role: 'role:agent', state: 'active' },
    action: 'write-memory',
    resource: { type: 'memory', id: 'agent:one' },
    context: {},
  });
  assert.equal(decision.allowed, true, `${decision.code} — ${decision.reason}`);
  assert.deepEqual(quotaLedger.debits, [
    { resource: 'memory-writes', subjectId: 'agent:one', amount: 1 },
  ]);
  const declared = (bundle.quotas ?? []).find((entry) => entry['resource'] === 'memory-writes');
  assert.deepEqual(declared?.['measure'], { kind: 'calls' });
});

test('التسويةُ تخصمُ فرقَ الاستهلاكِ المقيسِ بعدَ التنفيذِ ولا تُعيدُ شيئاً', async () => {
  const quotaLedger = recordingLedger();
  const { point, log } = setup({ quotaLedger });
  const debited = {
    resource: 'inference-tokens',
    subjectType: 'agent',
    subjectId: 'agent:one',
    amount: 120,
  };
  const { settled } = await point.settleQuota(debited, 400, 'agent:one');
  assert.equal(settled, 280);
  assert.deepEqual(quotaLedger.debits, [
    { resource: 'inference-tokens', subjectId: 'agent:one', amount: 280 },
  ]);
  assert.ok(log.events.some((event) => event.type === 'policy.quota.settled'));
  // أقلُّ من المُقدَّرِ لا يُعادُ: ردُّ الحصّةِ يفتحُ بابَ تقديرٍ مرتفعٍ يُستردُّ.
  const lower = await point.settleQuota(debited, 30, 'agent:one');
  assert.equal(lower.settled, 0);
  assert.equal(quotaLedger.debits.length, 1);
});

test('الاستدلالُ يخصمُ رموزاً مقيسةً بعددِها لا نداءً واحداً', async () => {
  const quotaLedger = recordingLedger();
  const { point } = setup({ quotaLedger });
  const { decision, quota } = await point.authorize(
    {
      actor: { id: 'agent:minister-1', kind: 'autonomous', role: 'role:minister', state: 'active' },
      action: 'model-inference',
      resource: { type: 'model', id: 'model:one', classification: 'public' },
      context: { purpose: 'analysis', modelId: 'model:one' },
    },
    { measured: { tokens: 733 } },
  );
  assert.equal(decision.allowed, true, `${decision.code} — ${decision.reason}`);
  assert.equal(quota?.amount, 733);
  assert.deepEqual(quotaLedger.debits, [
    { resource: 'inference-tokens', subjectId: 'agent:minister-1', amount: 733 },
  ]);
});
