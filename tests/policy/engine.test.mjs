// اختبار محرّك القرار — M4.03.
//
// المعيار يطلب ثلاثاً: حتميةً، وأولويةً، ومنعاً صريحاً يعلو على السماح، ونتيجةً
// مسبَّبة تسمّي السياسة الحاكمة. وهذه الأربع مقيسة هنا على **بيانات المشروع
// نفسها** لا على بيانات مخترعة للاختبار، لأن السياسة التي تُختبر ببيانات أخرى
// لم تُختبر. وما زاد على ذلك ثلاثة مسارات كان الفشل فيها ممكناً: فعلٌ لا يعرفه
// الكتالوج، ودورٌ لا تعرفه الدولة، وشرطٌ يقارن نطاق الفاعل بنطاق المورد.

import test from 'node:test';
import assert from 'node:assert/strict';
import { loadPolicyBundle } from '../../src/policy/loader.mjs';
import { PolicyDecisionPoint, createPolicyDecisionPoint } from '../../src/policy/engine.mjs';
import { composeEnforcementChain } from '../../src/core/composition-root.mjs';

const bundle = loadPolicyBundle();

/**
 * يبني طلباً كاملاً كي لا يتكرّر في كل اختبار، فيبقى المقيس هو الفرق لا الصياغة.
 * @param {Partial<import('../../src/policy/model.mjs').PolicyRequest> & { action: string }} patch
 * @returns {import('../../src/policy/model.mjs').PolicyRequest}
 */
function request(patch) {
  return {
    actor: { id: 'agent:one', kind: 'autonomous', role: 'role:agent', state: 'active' },
    resource: { type: 'memory', id: 'agent:one' },
    context: {},
    ...patch,
  };
}

test('السماح المسبَّب يسمّي السياسة الحاكمة ونسختها', () => {
  const pdp = createPolicyDecisionPoint();
  const decision = pdp.evaluate(
    request({ action: 'write-memory', resource: { type: 'memory', id: 'agent:one' } }),
  );
  assert.equal(decision.allowed, true);
  assert.equal(decision.code, 'POLICY_ALLOW');
  assert.equal(decision.policyId, 'pol:write-own-memory');
  assert.equal(decision.policyVersion, 1);
  assert.ok(decision.reason.length > 12, 'القرار بلا سبب مقروء لا يُقبل (المادة 2)');
});

test('المنع الصريح يعلو على السماح ولو كان السماح أعلى أولوية', () => {
  const pdp = createPolicyDecisionPoint();
  // الملك مأذون له بـ`export-keys`? لا — لكن `pol:forbid-key-export` عام على كل
  // الأدوار بأولوية 1000، فالمقيس أن المنع يمسك الفعل حتى لمن يملك السيادة.
  const decision = pdp.evaluate(
    request({
      actor: { id: 'king', kind: 'human', role: 'role:king', state: 'active' },
      action: 'export-keys',
      resource: { type: 'key', id: 'king' },
      royalCommandId: 'cmd:signed',
    }),
  );
  assert.equal(decision.allowed, false);
  assert.equal(decision.code, 'POLICY_DENY');
  assert.equal(decision.policyId, 'pol:forbid-key-export');
});

test('الفاعل غير النشط يُمنع من فعل كان مأذوناً له وهو نشط', () => {
  const pdp = createPolicyDecisionPoint();
  const allowed = pdp.evaluate(request({ action: 'write-memory' }));
  const suspended = pdp.evaluate(
    request({
      action: 'write-memory',
      actor: { id: 'agent:one', kind: 'autonomous', role: 'role:agent', state: 'suspended' },
    }),
  );
  assert.equal(allowed.allowed, true);
  assert.equal(suspended.allowed, false);
  assert.equal(suspended.policyId, 'pol:deny-non-active-actor');
});

test('الافتراض منع: طلبٌ لا تطابقه سياسة يُرفض بـPOLICY_NO_MATCH', () => {
  const pdp = createPolicyDecisionPoint();
  const decision = pdp.evaluate(
    request({ action: 'allocate-budget', resource: { type: 'budget', id: 'institution:one' } }),
  );
  assert.equal(decision.allowed, false);
  assert.equal(decision.code, 'POLICY_NO_MATCH');
  assert.equal(decision.policyId, null);
});

test('فعل غير معلَن ودور غير معلَن يُرفضان بلا تقييم', () => {
  const pdp = createPolicyDecisionPoint();
  const unknownAction = pdp.evaluate(request({ action: 'fabricate-authority' }));
  assert.equal(unknownAction.code, 'POLICY_UNKNOWN_ACTION');
  assert.equal(unknownAction.allowed, false);
  const unknownRole = pdp.evaluate(
    request({
      action: 'write-memory',
      actor: { id: 'x', kind: 'autonomous', role: 'role:ghost', state: 'active' },
    }),
  );
  assert.equal(unknownRole.code, 'POLICY_UNKNOWN_ROLE');
  assert.equal(unknownRole.allowed, false);
});

test('الشرط يقارن نطاق الفاعل بنطاق المورد فلا يمتد وزيرٌ إلى نطاق غيره', () => {
  const pdp = createPolicyDecisionPoint();
  const minister = {
    id: 'minister:health',
    kind: /** @type {const} */ ('human'),
    role: 'role:minister',
    state: /** @type {const} */ ('active'),
    scope: 'institution:health',
  };
  const own = pdp.evaluate(
    request({
      actor: minister,
      action: 'create-agent',
      resource: { type: 'agent', id: 'agent:new', scope: 'institution:health' },
    }),
  );
  const other = pdp.evaluate(
    request({
      actor: minister,
      action: 'create-agent',
      resource: { type: 'agent', id: 'agent:new', scope: 'institution:defense' },
    }),
  );
  assert.equal(own.allowed, true, 'الوزير في نطاقه مأذون له');
  assert.equal(own.policyId, 'pol:minister-manage-agents');
  assert.equal(other.allowed, false, 'الوزير خارج نطاقه ليس مأذوناً له');
  assert.equal(other.code, 'POLICY_NO_MATCH');
});

test('الشرط الغائب من السياق يُقرأ منعاً لا سماحاً', () => {
  const pdp = createPolicyDecisionPoint();
  const minister = {
    id: 'minister:health',
    kind: /** @type {const} */ ('human'),
    role: 'role:minister',
    state: /** @type {const} */ ('active'),
    scope: 'institution:health',
  };
  const withoutEvaluation = pdp.evaluate(
    request({
      actor: minister,
      action: 'deploy-model',
      resource: { type: 'model', id: 'model:one', scope: 'institution:health' },
      context: {},
    }),
  );
  assert.equal(withoutEvaluation.allowed, false, 'نموذج بلا تقييم ناجح لا يُنشر');
  const withEvaluation = pdp.evaluate(
    request({
      actor: minister,
      action: 'deploy-model',
      resource: { type: 'model', id: 'model:one', scope: 'institution:health' },
      context: { evaluationPassed: true },
    }),
  );
  assert.equal(withEvaluation.allowed, true);
  assert.equal(withEvaluation.policyId, 'pol:minister-deploy-evaluated-model');
});

test('السياسة المعلَّقة لا تُقيَّم أصلاً', () => {
  const disabled = bundle.policies.filter((p) => !p.enabled);
  assert.ok(disabled.length >= 1, 'البيانات يجب أن تحمل سياسة معلَّقة واحدة على الأقل للقياس');
  const pdp = new PolicyDecisionPoint({ bundle });
  for (const policy of disabled) {
    for (const decision of [
      pdp.evaluate(request({ action: policy.actions[0] ?? 'write-memory' })),
    ]) {
      assert.notEqual(
        decision.policyId,
        policy.id,
        `سياسة معلَّقة حكمت قراراً: ${policy.id} — هذا سماحٌ بلا اعتماد`,
      );
    }
  }
});

test('القرار حتمي: ترتيب البيانات لا يغيّر السياسة الحاكمة', () => {
  const shuffled = {
    ...bundle,
    policies: Object.freeze([...bundle.policies].reverse()),
  };
  const a = new PolicyDecisionPoint({ bundle });
  const b = new PolicyDecisionPoint({ bundle: shuffled });
  const cases = [
    request({ action: 'write-memory' }),
    request({ action: 'read-registry', resource: { type: 'registry', id: 'agents' } }),
    request({
      action: 'external-egress',
      resource: { type: 'data', id: 'ds:1', classification: 'sensitive' },
      context: { destination: 'partner:approved' },
    }),
    request({
      actor: { id: 'king', kind: 'human', role: 'role:king', state: 'active' },
      action: 'stop-state',
      resource: { type: 'state', id: 'all' },
      royalCommandId: 'cmd:1',
    }),
  ];
  for (const one of cases) {
    const first = a.evaluate(one);
    const second = b.evaluate(one);
    assert.equal(second.code, first.code, `اختلف الرمز باختلاف الترتيب: ${one.action}`);
    assert.equal(second.policyId, first.policyId, `اختلفت السياسة الحاكمة: ${one.action}`);
    // وتكرار نفس الطلب على نفس النقطة يعطي نفس النتيجة بحرفها.
    assert.equal(a.evaluate(one).reason, first.reason);
  }
});

test('أثر التطابق يُعاد كاملاً كي يكون القرار قابلاً للمراجعة', () => {
  const pdp = createPolicyDecisionPoint();
  const decision = pdp.evaluate(
    request({
      action: 'external-egress',
      resource: { type: 'data', id: 'ds:1', classification: 'sensitive' },
      context: { destination: 'partner:approved' },
    }),
  );
  assert.equal(decision.code, 'POLICY_DENY');
  assert.equal(decision.policyId, 'pol:deny-egress-of-sensitive');
  const ids = decision.matched.map((m) => m.id);
  assert.ok(ids.includes('pol:deny-egress-of-sensitive'));
  // الأثر مرتَّب حتماً: الأعلى أولوية أولاً، والمنع قبل السماح عند التساوي.
  const priorities = decision.matched.map((m) => m.priority);
  assert.deepEqual(
    priorities,
    [...priorities].sort((x, y) => y - x),
  );
});

// WL-561 (G1): دُمِجَ هنا حرفياً tests/policy/r5-b-09-official-path.test.mjs (‏توحيدُ الاستيرادِ فقط).
// R5-B-09 (تقرير: R5-B-07) — المسارُ الرسميُّ كاملًا (composeEnforcementChain
// + identityGate موصولةٌ + policy engine) — اختبارُ رجوعٍ لقيد WL-382.
//
// قبلَ WL-382 كانَ هذا السيناريو يُسجَّلُ `NOT_TESTED` لأنّ المسبارَ كانَ يستعملُ
// معرّفَ فاعلٍ غيرِ مسجَّلٍ في السجلِّ الرسميِّ (minister:9) فتسبقُهُ بوابةُ
// الهويةِ (IDENTITY_UNVERIFIED) قبلَ أن يُقيَّسَ ضابطُ سقفِ القدرةِ نفسُهُ.
// هنا: فاعلٌ مُسجَّلٌ بالسجلِّ الرسميِّ (register → شهادة → state=active)
// بقدراتٍ فارغةٍ، وضابطٌ مسجَّلٌ بقدرةِ كتابةٍ يمرُّ — فالرفضُ إن وقعَ فهو
// من ضابطِ سقفِ القدرةِ لا من بوابةِ الهويةِ.

/** سجلُّ أحداثٍ صغيرٌ للقياس. */
function memoryLog() {
  /** @type {{ type: string, actor: string, payload: object }[]} */
  const events = [];
  return {
    events,
    /**
     * @param {string} type
     * @param {string} actor
     * @param {object} payload
     */
    append(type, actor, payload) {
      events.push({ type, actor, payload });
    },
  };
}

test('R5-B-09 عبرَ المسارِ الرسميِّ: فاعلٌ مسجَّلٌ بقدراتٍ فارغةٍ يُرفضُ عندَ سقفِ القدرةِ لا عندَ بوابةِ الهويةِ', async () => {
  const chain = composeEnforcementChain({ log: memoryLog() });
  const agent = await chain.registry.register({
    name: 'r5b09-official-path-no-cap',
    role: 'role:agent',
    capabilities: [],
    kind: 'autonomous',
  });

  const result = await chain.enforcementPoint.authorize({
    actor: { id: agent.id, kind: 'autonomous', role: 'role:agent', state: 'active' },
    action: 'write-data',
    resource: { type: 'data', id: 'doc:1' },
    context: {},
  });

  assert.equal(result.decision.allowed, false, 'الرفضُ مطلوبٌ');
  assert.equal(
    result.decision.code,
    'POLICY_NO_MATCH',
    'الرفضُ من ضابطِ سقفِ القدرةِ (السياسةِ)، لا من بوابةِ الهويةِ',
  );
  assert.notEqual(
    result.decision.code,
    'IDENTITY_UNVERIFIED',
    'الفاعلُ مُسجَّلٌ فلا يُرفَضُ من بوابةِ الهويةِ',
  );
});

test('R5-B-09 عبرَ المسارِ الرسميِّ: الضابطُ — فاعلٌ مسجَّلٌ بقدرةِ كتابةٍ يُؤذَنُ (لا يُكسَرُ السلوكُ المشروعُ)', async () => {
  const chain = composeEnforcementChain({ log: memoryLog() });
  const agent = await chain.registry.register({
    name: 'r5b09-official-path-with-cap',
    role: 'role:agent',
    capabilities: ['action:write-data'],
    kind: 'autonomous',
  });

  const result = await chain.enforcementPoint.authorize({
    actor: { id: agent.id, kind: 'autonomous', role: 'role:agent', state: 'active' },
    action: 'write-data',
    resource: { type: 'data', id: 'doc:1' },
    context: {},
  });

  assert.equal(result.decision.allowed, true, 'الفاعلُ بقدرةِ كتابةٍ مسجَّلٌ يُؤذَنُ');
  assert.equal(result.decision.code, 'POLICY_ALLOW');
});

test('R5-B-09 عبرَ المسارِ الرسميِّ: فاعلٌ غيرُ مسجَّلٍ يُرفَضُ من بوابةِ الهويةِ أصلًا (حدٌّ لا يُختلطُ بضابطِ القدرةِ)', async () => {
  const chain = composeEnforcementChain({ log: memoryLog() });

  const result = await chain.enforcementPoint.authorize({
    actor: { id: 'minister:9', kind: 'human', role: 'role:minister', state: 'active' },
    action: 'write-data',
    resource: { type: 'data', id: 'doc:1' },
    context: {},
  });

  assert.equal(result.decision.allowed, false);
  assert.equal(
    result.decision.code,
    'IDENTITY_UNVERIFIED',
    'غيرُ المُسجَّلِ يُرفَضُ من الهويةِ — وهذا سلوكٌ سليمٌ لا يُقاسُ بضابطِ القدرةِ',
  );
});
