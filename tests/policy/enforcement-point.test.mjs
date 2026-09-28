// اختبار نقطة التفويض المركزية — M4.05.
//
// المقيس هنا ليس «هل تُعيد النقطة سماحاً» بل هل يبقى مسارٌ لتنفيذ فعلٍ محكوم بلا
// قرار. فالمفحوص خمسة مسارات كان كلٌّ منها ممكناً قبل هذه الخطوة: إعادة استخدام
// تذكرة، وتذكرةٌ لفعلٍ آخر أو لمورد آخر أو لفاعلٍ آخر، وتذكرةٌ مزوّرة التوقيع،
// وتذكرةٌ منتهية، وتنفيذٌ أثناء الإيقاف الشامل. وفوقها: أن الرفض يُسجَّل كما
// يُسجَّل السماح، وأن الحصّة لا تُخصم على مرفوض.

import test from 'node:test';
import assert from 'node:assert/strict';

import { loadPolicyBundle } from '../../src/policy/loader.mjs';
import { createPolicyDecisionPoint } from '../../src/policy/engine.mjs';
import { EnforcementPoint } from '../../src/policy/enforcement-point.mjs';
import { createGovernance } from '../../src/policy/governance.mjs';

const bundle = loadPolicyBundle();

/** سجل أحداث صغير: الاختبار يقيس ما سُجّل، فلا يُستعار سجلٌ ثقيل لقياس التسجيل. */
function memoryLog() {
  /** @type {Array<{ type: string, actor: string, payload: object }>} */
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

/**
 * @param {{ haltSwitch?: { assertOperational: () => void } | null, quotaLedger?: any, now?: () => Date }} [deps]
 */
function setup(deps = {}) {
  const log = memoryLog();
  /** @type {Array<{ decision: import('../../src/policy/model.mjs').PolicyDecision }>} */
  const sunk = [];
  const point = new EnforcementPoint({
    decisionPoint: createPolicyDecisionPoint({ bundle }),
    log,
    haltSwitch: deps.haltSwitch ?? null,
    quotaLedger: deps.quotaLedger ?? null,
    decisionSink: (record) => {
      sunk.push(record);
    },
    ...(deps.now ? { now: deps.now } : {}),
    requireIdentityGate: false, // اختباراتٌ لا تُمرِّر بوابةَ هويةٍ
  });
  return { point, log, sunk };
}

/**
 * @param {Partial<import('../../src/policy/model.mjs').PolicyRequest>} [patch]
 * @returns {import('../../src/policy/model.mjs').PolicyRequest}
 */
function writeMemory(patch = {}) {
  return {
    actor: { id: 'agent:one', kind: 'autonomous', role: 'role:agent', state: 'active' },
    action: 'write-memory',
    resource: { type: 'memory', id: 'agent:one' },
    context: {},
    ...patch,
  };
}

test('التفويض يُصدر تذكرة على السماح ولا يُصدرها على المنع', async () => {
  const { point } = setup();
  const allowed = await point.authorize(writeMemory());
  assert.equal(allowed.decision.allowed, true);
  assert.equal(typeof allowed.token, 'string');

  const denied = await point.authorize(
    writeMemory({
      actor: { id: 'agent:one', kind: 'autonomous', role: 'role:agent', state: 'suspended' },
    }),
  );
  assert.equal(denied.decision.allowed, false);
  assert.equal(denied.token, null, 'تذكرةٌ على قرار منع تُبطل معنى النقطة');
});

test('القرار يُسجَّل مسبَّباً في السجل وفي المصرف — سماحاً كان أو منعاً', async () => {
  const { point, log, sunk } = setup();
  await point.authorize(writeMemory());
  await point.authorize(
    writeMemory({ resource: { type: 'memory', id: 'agent:two' } }), // مورد غيره ← لا سياسة
  );
  const decisions = log.events.filter((e) => e.type === 'policy.decision');
  assert.equal(decisions.length, 2, 'كل قرار يُسجَّل، والرفض قرار');
  assert.equal(sunk.length, 2, 'المصرف الدائم يستقبل القرارين — عليه يقوم محاكي M4.08');
  for (const event of decisions) {
    const payload = /** @type {{ code?: unknown, reason?: unknown }} */ (event.payload);
    assert.equal(typeof payload.code, 'string');
    assert.ok(String(payload.reason).length > 12, 'قرارٌ مسجَّل بلا سبب لا يصلح للتدقيق');
  }
});

test('التذكرة تصلح مرّة واحدة فقط', () => {
  return (async () => {
    const { point } = setup();
    const { token } = await point.authorize(writeMemory());
    const binding = {
      actorId: 'agent:one',
      action: 'write-memory',
      resourceKey: 'memory:agent:one',
    };
    assert.equal(
      point.verify(/** @type {string} */ (token), binding).policyId,
      'pol:write-own-memory',
    );
    assert.throws(
      () => point.verify(/** @type {string} */ (token), binding),
      /AUTHORIZATION_DECISION_REUSED/,
      'تذكرةٌ تُقبل مرّتين تعني فعلين بقرار واحد',
    );
  })();
});

test('التذكرة مربوطة بالفاعل والفعل والمورد فلا تُحوَّل إلى غيره', async () => {
  const { point } = setup();
  const { token } = await point.authorize(writeMemory());
  const cases = [
    { actorId: 'agent:two', action: 'write-memory', resourceKey: 'memory:agent:one' },
    { actorId: 'agent:one', action: 'purge-data', resourceKey: 'memory:agent:one' },
    { actorId: 'agent:one', action: 'write-memory', resourceKey: 'memory:agent:two' },
  ];
  for (const binding of cases) {
    assert.throws(
      () => point.verify(/** @type {string} */ (token), binding),
      /AUTHORIZATION_DECISION_MISMATCH/,
      `تذكرة قُبلت لربط آخر: ${JSON.stringify(binding)}`,
    );
  }
});

test('التذكرة المزوّرة والمبتورة والغائبة تُرفض بأخطاء مُسمّاة', async () => {
  const { point } = setup();
  const { token } = await point.authorize(writeMemory());
  const binding = { actorId: 'agent:one', action: 'write-memory', resourceKey: 'memory:agent:one' };
  const [body] = /** @type {string} */ (token).split('.');
  assert.throws(() => point.verify(`${body}.forged`, binding), /FORGED/);
  assert.throws(() => point.verify('لا-نقطة-فيه', binding), /MISSING/);
  assert.throws(() => point.verify(undefined, binding), /MISSING/);
});

test('التذكرة المنتهية تُرفض ولو كان توقيعها صحيحاً', async () => {
  let clock = new Date('2026-01-01T00:00:00.000Z');
  const { point } = setup({ now: () => clock });
  const { token } = await point.authorize(writeMemory());
  clock = new Date('2026-01-01T00:05:00.000Z');
  assert.throws(
    () =>
      point.verify(/** @type {string} */ (token), {
        actorId: 'agent:one',
        action: 'write-memory',
        resourceKey: 'memory:agent:one',
      }),
    /EXPIRED/,
  );
});

test('الإيقاف الشامل يمنع التفويض قبل تقييم السياسة', async () => {
  const { point, log } = setup({
    haltSwitch: {
      assertOperational() {
        throw new Error('STATE_HALTED: أمر إيقاف سيادي نافذ');
      },
    },
  });
  const { decision, token } = await point.authorize(writeMemory());
  assert.equal(decision.allowed, false);
  assert.equal(decision.code, 'STATE_HALTED');
  assert.equal(token, null);
  assert.ok(
    log.events.some((e) => e.type === 'policy.decision'),
    'الرفض بسبب الإيقاف يُسجَّل أيضاً',
  );
});

test('الحصّة تُخصم على المسموح وتُوقفه عند الحدّ، ولا تُخصم على مرفوض', async () => {
  /** @type {Array<{ resource: string, amount: number }>} */
  const debits = [];
  let remaining = 1;
  const quotaLedger = {
    /**
     * @param {{ subjectType: string, subjectId: string, resource: string, amount: number }} request
     * @returns {Promise<{ resource: string, consumed: number, limit: number, remaining: number }>}
     */
    async debit(request) {
      debits.push({ resource: request.resource, amount: request.amount });
      if (remaining < request.amount) throw new Error('QUOTA_EXCEEDED: memory-writes');
      remaining -= request.amount;
      return { resource: request.resource, consumed: 1, limit: 1, remaining };
    },
  };
  const { point } = setup({ quotaLedger });

  const first = await point.authorize(writeMemory());
  assert.equal(first.decision.allowed, true);
  assert.equal(debits.length, 1, 'الفعل المسموح يُخصم فعلاً');

  const second = await point.authorize(writeMemory());
  assert.equal(second.decision.allowed, false, 'الحدّ يوقف الفعل ولو أذنت به السياسة');
  assert.equal(second.decision.code, 'QUOTA_EXCEEDED');
  assert.equal(second.token, null);

  const denied = await point.authorize(
    writeMemory({
      actor: { id: 'agent:one', kind: 'autonomous', role: 'role:agent', state: 'revoked' },
    }),
  );
  assert.equal(denied.decision.allowed, false);
  assert.equal(debits.length, 2, 'طلبٌ مرفوض بالسياسة لا يستنزف حصّة صاحبه');
});

test('كتالوج الأفعال المحكومة يشمل الحسّاس والعتبة معاً', () => {
  const { point } = setup();
  const governed = point.governedActions();
  for (const entry of bundle.threshold) {
    assert.ok(governed.has(entry.action), `فعل عتبة خارج الكتالوج المحكوم: ${entry.action}`);
  }
  for (const action of bundle.actions.values()) {
    if (action.sensitive) assert.ok(governed.has(action.id), `فعل حسّاس غير محكوم: ${action.id}`);
  }
  assert.equal(governed.has('read-registry'), false, 'فعلٌ غير حسّاس لا يُثقَل بتذكرة');
});

// مراجعة M11.04 — Grok-F01: المصنع الرسمي للإدارة كان يبني نقطةَ تفويضٍ بلا
// بوابةِ هويةٍ، فيقرأ دور الفاعل من ادعاء المستدعي. الإصلاح: التركيبُ الذي يلزم
// البوابةَ يفشلُ مغلقًا برمزٍ مُسمَّى حين تُغيَب، فلا يبقى مسارٌ «رسميّ» يقبل فاعلًا
// بلا شهادةٍ من جذر الثقة.
test('التركيبُ الذي يلزم بوابةَ الهوية يرفضُ البناءَ بلا بوابةٍ بفشلٍ مغلق (M11.04 Grok-F01)', () => {
  const log = memoryLog();
  // الإنشاءُ بـ`requireIdentityGate: true` و`identityGate: null` يُرفَض عند البناءِ —
  // لا ينتظرُ حتى الاستعمال. وهذا هو سدُّ العقدِ العامِّ: الرفضُ مُسمَّى
  // `ENFORCEMENT_IDENTITY_GATE_REQUIRED` لا قبولٌ صامتٌ لفاعلٍ بلا شهادة.
  assert.throws(
    () =>
      new EnforcementPoint({
        decisionPoint: createPolicyDecisionPoint({ bundle }),
        log,
        requireIdentityGate: true,
        identityGate: null,
      }),
    /ENFORCEMENT_IDENTITY_GATE_REQUIRED/,
    'الإنشاءُ بلا بوابةِ هويةٍ في التركيب المُلزم يجب أن يُرفَض عند البناءِ',
  );
});

test('التركيبُ غير المُلزم يبقى متساهلًا مع بقاء البوابة اختيارية (توافقٌ مع الإصدار)', async () => {
  const log = memoryLog();
  const point = new EnforcementPoint({
    decisionPoint: createPolicyDecisionPoint({ bundle }),
    log,
    requireIdentityGate: false,
    identityGate: null,
  });
  const result = await point.authorize(writeMemory());
  // بلا بوابةٍ ولا إلزامٍ: يسقط إلى سلوك الإصدار القديم (لا يُعرَض فاعلٌ مُستبدَل)،
  // وهذا مقصودٌ كي لا تنكسر اختباراتٌ تبني النقطة مباشرةً بلا بوابة.
  assert.notEqual(
    result.decision.code,
    'IDENTITY_GATE_REQUIRED',
    'الإلزامُ مُفعَّلٌ فقط حين يطلبه التركيب',
  );
});

test('الإنشاءُ الخامُّ بلا بوابةِ هويةٍ يُرفَض عند البناءِ (M11.04-F01)', () => {
  const log = memoryLog();
  // الإنشاءُ بلا بوابةٍ وبدون تصريحٍ صريحٍ بـ`requireIdentityGate: false` يرفعُ خطأً
  // عند البناءِ — لا ينتظرُ حتى الاستعمال. وهذا هو سدُّ العقدِ العامِّ.
  assert.throws(
    () =>
      new EnforcementPoint({
        decisionPoint: createPolicyDecisionPoint({ bundle }),
        log,
      }),
    /ENFORCEMENT_IDENTITY_GATE_REQUIRED/,
    'الإنشاءُ الخامُّ بلا بوابةٍ يجب أن يُرفَض عند البناءِ',
  );
});

test('الإنشاءُ مع بوابةِ هويةٍ ينجحُ عند البناءِ (M11.04-F01)', () => {
  const log = memoryLog();
  const gate = {
    /**
     * @param {string} _actorId
     */
    async verify(_actorId) {
      return {
        ok: true,
        code: 'IDENTITY_OK',
        reason: '',
        actor: {
          id: _actorId,
          role: 'role:agent',
          state: 'active',
          kind: /** @type {const} */ ('autonomous'),
          capabilities: [],
        },
      };
    },
  };
  // الإنشاءُ مع بوابةٍ ينجحُ — الافتراضيُّ `requireIdentityGate: true` يُلزِمُها
  const point = new EnforcementPoint({
    decisionPoint: createPolicyDecisionPoint({ bundle }),
    log,
    identityGate: gate,
  });
  assert.ok(point, 'الإنشاءُ مع بوابةِ هويةٍ يجب أن ينجح');
});

// R5-A-02: المصنعُ الرسميُّ `createGovernance` كانَ يُسقطُ بوابةَ الهويةِ صامتاً
// (`requireIdentityGate: identityGate !== null`)، فالتركيبُ بلا بوابةٍ يَبني نقطةً
// تُصدرُ تذاكرَ لفاعلٍ يصفُ دورَه بنفسِه. الإصلاحُ: المصنعُ يُلزِمُ البوابةَ دائماً.
test('R5-A-02: createGovernance بلا بوابةِ هويةٍ يُرفَضُ عند البناءِ لا يُصدرُ تذاكر', () => {
  const log = memoryLog();
  // التركيبُ بلا بوابةٍ يجبُ أن يُرفَضَ برمزٍ مُسمَّى — لا أن يَبني نقطةً تُصدرُ تذاكرَ.
  assert.throws(
    () => createGovernance({ log, bundle }),
    /ENFORCEMENT_IDENTITY_GATE_REQUIRED/,
    'createGovernance بلا identityGate يجب أن يرفض البناء برمز ENFORCEMENT_IDENTITY_GATE_REQUIRED',
  );
});

// ── R5-B-10 (تقرير: R5-B-08): `requireIdentityGate: false` لا يُبنى في الإنتاج ──
//
// مسلكُ المُراجِعِ ISO-01: نقطةٌ بلا بوابةِ هويّةٍ تُقيِّمُ فاعلاً يَصِفُ نفسَه
// `role:king` كما وَرَدَ. والإصلاحُ: المخرجُ يبقى للاختبارِ والتطويرِ، ويُرفَضُ
// **عندَ البناءِ** في الإنتاجِ — والإنتاجُ يُقرأُ من البيئةِ المحقونةِ ومن بيئةِ
// العمليّةِ معاً، فحقنُ `env: {}` لا يَفتحُه.

/**
 * فاعلٌ يَصِفُ نفسَه ملكاً — عينُ مسلكِ ISO-01.
 * @returns {import('../../src/policy/model.mjs').PolicyRequest}
 */
function kingClaim() {
  return {
    actor: { id: 'agent:liar', kind: 'autonomous', role: 'role:king', state: 'active' },
    action: 'read-data',
    resource: { type: 'data', id: 'registry' },
    context: {},
  };
}

/**
 * يُشغِّلُ `fn` وبيئةُ العمليّةِ `STATE_ENV` مضبوطةٌ، ثمَّ يُعيدُها كما كانت.
 * @template T
 * @param {string | undefined} value
 * @param {() => T} fn
 * @returns {T}
 */
function withProcessStateEnv(value, fn) {
  const had = Object.hasOwn(process.env, 'STATE_ENV');
  const previous = process.env['STATE_ENV'];
  if (value === undefined) delete process.env['STATE_ENV'];
  else process.env['STATE_ENV'] = value;
  try {
    return fn();
  } finally {
    if (had) process.env['STATE_ENV'] = previous;
    else delete process.env['STATE_ENV'];
  }
}

test('R5-B-10: `requireIdentityGate: false` بلا بوابةٍ يُرفَضُ عندَ البناءِ في الإنتاجِ المحقونِ', () => {
  assert.throws(
    () =>
      new EnforcementPoint({
        decisionPoint: createPolicyDecisionPoint({ bundle }),
        log: memoryLog(),
        requireIdentityGate: false,
        identityGate: null,
        env: { STATE_ENV: 'production' },
      }),
    /ENFORCEMENT_IDENTITY_GATE_BYPASS_FORBIDDEN_IN_PRODUCTION/,
  );
});

test('R5-B-10: حقنُ `env: {}` في عمليّةٍ إنتاجيّةٍ لا يَفتحُ المخرجَ', () => {
  withProcessStateEnv('production', () => {
    assert.throws(
      () =>
        new EnforcementPoint({
          decisionPoint: createPolicyDecisionPoint({ bundle }),
          log: memoryLog(),
          requireIdentityGate: false,
          identityGate: null,
          env: {},
        }),
      /ENFORCEMENT_IDENTITY_GATE_BYPASS_FORBIDDEN_IN_PRODUCTION/,
    );
  });
});

test('R5-B-10: بيئةُ العمليّةِ الإنتاجيّةُ بلا حقنٍ ترفضُ المخرجَ أيضاً', () => {
  withProcessStateEnv('production', () => {
    assert.throws(
      () =>
        new EnforcementPoint({
          decisionPoint: createPolicyDecisionPoint({ bundle }),
          log: memoryLog(),
          requireIdentityGate: false,
          identityGate: null,
        }),
      /ENFORCEMENT_IDENTITY_GATE_BYPASS_FORBIDDEN_IN_PRODUCTION/,
    );
  });
});

test('R5-B-10: خارجَ الإنتاجِ يبقى المخرجُ قائماً للاختبارِ (السلوكُ المُعلَنُ لا يُكسَرُ)', async () => {
  const point = withProcessStateEnv(
    undefined,
    () =>
      new EnforcementPoint({
        decisionPoint: createPolicyDecisionPoint({ bundle }),
        log: memoryLog(),
        requireIdentityGate: false,
        identityGate: null,
        env: { STATE_ENV: 'development' },
      }),
  );
  const result = await point.authorize(kingClaim());
  assert.notEqual(result.decision.code, 'IDENTITY_GATE_REQUIRED');
});

test('R5-B-10: حقلٌ يُبدَّلُ بعدَ البناءِ إلى الإنتاجِ ⇒ الاستعمالُ يُرفَضُ بـIDENTITY_GATE_REQUIRED بلا تذكرة', async () => {
  const log = memoryLog();
  const point = withProcessStateEnv(
    undefined,
    () =>
      new EnforcementPoint({
        decisionPoint: createPolicyDecisionPoint({ bundle }),
        log,
        requireIdentityGate: false,
        identityGate: null,
        env: { STATE_ENV: 'development' },
      }),
  );
  // المسارُ الذي يتجاوزُ البناءَ: تبديلُ الحقلِ بعدَه.
  /** @type {{ env: NodeJS.ProcessEnv }} */ (/** @type {unknown} */ (point)).env = {
    STATE_ENV: 'production',
  };
  const result = await point.authorize(kingClaim());
  assert.equal(result.decision.allowed, false);
  assert.equal(result.decision.code, 'IDENTITY_GATE_REQUIRED');
  assert.equal(result.token, null);
});

test('R5-B-10: الرفضُ للثقةِ بالوصفِ لا للخيارِ — بوابةٌ موصولةٌ في الإنتاجِ تُبنى', () => {
  const gate = {
    /** @param {string} actorId */
    async verify(actorId) {
      return {
        ok: true,
        code: 'IDENTITY_OK',
        reason: '',
        actor: { id: actorId, kind: 'autonomous', role: 'role:agent', state: 'active' },
      };
    },
  };
  assert.doesNotThrow(
    () =>
      new EnforcementPoint({
        decisionPoint: createPolicyDecisionPoint({ bundle }),
        log: memoryLog(),
        requireIdentityGate: false,
        identityGate: /** @type {never} */ (gate),
        env: { STATE_ENV: 'production' },
      }),
  );
});
