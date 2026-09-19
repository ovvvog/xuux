// R5-B-09 (تقرير: R5-B-07) — اختبارُ إثباتٍ: سقفُ القدراتِ منفَّذٌ في سياسةِ الكتابة.
//
// **المعيار:** الوكيلُ بلا قدرةِ كتابةٍ لا يُؤذَنُ له بالكتابة ولو كان دورُه
// مأذوناً. الدورُ يُطابقُ لكنّ القدرةَ غائبةٌ → رفض. والوكيلُ بقدرةِ كتابةٍ
// مأذونٌ.
//
// **الحدُّ معلَن:** هذا إثباتُ إنفاذٍ لا إثباتُ إغلاقٍ. صلاحيّةُ الإغلاقِ للمجلس.

import assert from 'node:assert/strict';
import test from 'node:test';
import { loadPolicyBundle, createPolicyDecisionPoint } from '../../src/policy/index.mjs';

import { composeEnforcementChain } from '../../src/core/composition-root.mjs';

/** سجلُّ أحداثٍ صغيرٌ للقياس. */
function memoryLog() {
  const events = [];
  return {
    events,
    append(type, actor, payload) {
      events.push({ type, actor, payload });
    },
  };
}

test('R5-B-09: وكيلٌ بلا قدرةِ كتابةٍ يُرفضُ حتى لو كان دورُه مأذوناً', async () => {
  const chain = composeEnforcementChain({ log: memoryLog() });

  const agent = await chain.registry.register({
    name: 'no-write-capability',
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
  assert.equal(result.decision.allowed, false, 'الوكيلُ بلا قدرةِ كتابةٍ لا يُؤذَنُ');
});

test('R5-B-09: وكيلٌ بقدرةِ كتابةٍ مأذونٌ', async () => {
  const chain = composeEnforcementChain({ log: memoryLog() });

  const agent = await chain.registry.register({
    name: 'has-write-capability',
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
  assert.equal(result.decision.allowed, true, 'الوكيلُ بقدرةِ كتابةٍ مأذونٌ');
});

test('R5-B-09: دورٌ غير agent بلا قدرةِ كتابةٍ يُرفض', () => {
  const bundle = loadPolicyBundle();
  const pdp = createPolicyDecisionPoint({ bundle });

  // وزيرٌ بلا قدرةِ كتابةٍ
  const withoutCap = pdp.evaluate({
    actor: {
      id: 'minister:1',
      role: 'role:minister',
      state: 'active',
      capabilities: [],
    },
    action: 'write-data',
    resource: { id: 'res-1', type: 'data' },
  });
  assert.equal(withoutCap.allowed, false, 'وزيرٌ بلا قدرةِ كتابةٍ يُرفض');

  // وزيرٌ بقدرةِ كتابةٍ
  const withCap = pdp.evaluate({
    actor: {
      id: 'minister:2',
      role: 'role:minister',
      state: 'active',
      capabilities: ['action:write-data'],
    },
    action: 'write-data',
    resource: { id: 'res-2', type: 'data' },
  });
  assert.equal(withCap.allowed, true, 'وزيرٌ بقدرةِ كتابةٍ يُؤذَن');
});
