// R5-B-08 (تقرير: R5-B-06) — اختبارُ إثباتٍ: حجرُ الذاكرةِ موصولٌ بنقطةِ الإنفاذ.
//
// **السلسلة:** composeEnforcementChain → تسجيل وكيل → quarantine.report → authorize.
// **المعيار:** الوكيلُ المحجورُ يُرفضُ قبلَ تقييمِ السياسة. الإذنُ السابقُ للحجر
// لا يبقى بعدَه. هذا الإثباتُ يُثبتُ أنّ الفشلَ السابقَ (وكيلٌ محجورٌ يُؤذَنُ له)
// صار ممنوعاً.
//
// **الحدُّ معلَن:** هذا إثباتُ إنفاذٍ لا إثباتُ إغلاقٍ. صلاحيّةُ الإغلاقِ للمجلس.

import assert from 'node:assert/strict';
import test from 'node:test';

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

test('R5-B-08: وكيلٌ محجورٌ يُرفضُ عندَ نقطةِ الإنفاذِ قبلَ السياسة', async () => {
  const chain = composeEnforcementChain({ log: memoryLog() });

  const agent = await chain.registry.register({
    name: 'quarantine-probe',
    role: 'role:agent',
    capabilities: ['action:write-memory'],
    kind: 'autonomous',
  });

  // التحقّقُ من أنّ الوكيلَ مأذونٌ قبلَ الحجر
  const before = await chain.enforcementPoint.authorize({
    actor: { id: agent.id, kind: 'autonomous', role: 'role:agent', state: 'active' },
    action: 'write-memory',
    resource: { type: 'memory', id: agent.id },
    context: {},
  });
  assert.equal(before.decision.allowed, true, 'الوكيلُ مأذونٌ قبلَ الحجر');

  // الإبلاغُ عن شذوذٍ يحجرُ الوكيل
  chain.quarantine.report({
    kind: 'model-fingerprint-mismatch',
    subject: agent.id,
  });
  assert.equal(chain.quarantine.isQuarantined(agent.id), true, 'الوكيلُ محجورٌ بعدَ الإبلاغ');

  // المحاولةُ بعدَ الحجر: تُرفضُ بـ ACTOR_QUARANTINED
  const after = await chain.enforcementPoint.authorize({
    actor: { id: agent.id, kind: 'autonomous', role: 'role:agent', state: 'active' },
    action: 'write-memory',
    resource: { type: 'memory', id: agent.id },
    context: {},
  });
  assert.equal(after.decision.allowed, false, 'الوكيلُ المحجورُ لا يُؤذَنُ');
  assert.equal(after.decision.code, 'ACTOR_QUARANTINED', 'رمزُ الرفضِ ACTOR_QUARANTINED');
});

test('R5-B-08: فاعلٌ غيرُ محجورٍ لا يتأثّرُ بفحصِ الحجر', async () => {
  const chain = composeEnforcementChain({ log: memoryLog() });

  const agent = await chain.registry.register({
    name: 'clean-probe',
    role: 'role:agent',
    capabilities: ['action:write-memory'],
    kind: 'autonomous',
  });

  // حجرُ وكيلٍ آخر لا يؤثّرُ على هذا الوكيل
  chain.quarantine.report({
    kind: 'model-fingerprint-mismatch',
    subject: 'agent:different',
  });

  const result = await chain.enforcementPoint.authorize({
    actor: { id: agent.id, kind: 'autonomous', role: 'role:agent', state: 'active' },
    action: 'write-memory',
    resource: { type: 'memory', id: agent.id },
    context: {},
  });
  assert.equal(result.decision.allowed, true, 'الوكيلُ غيرُ المحجورِ مأذونٌ');
});
