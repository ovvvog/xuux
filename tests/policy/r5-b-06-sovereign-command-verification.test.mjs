// R5-B-06 (تقرير: R5-B-04) — اختبارُ إثباتٍ: ملخصُ sha256 لا يفتحُ إذناً سياديّاً.
//
// **المعيار:** أمرٌ ملكيٌّ مُزوَّرٌ (معرّفٌ وملخصٌ على الصورةِ الصحيحة) لا يُصدرُ
// تذكرةً. المحرّكُ يفحصُ الصورةَ، والإنفاذُ يتحقّقُ من الديوان. الأصلُ: من استطاع
// تقديمَ طلبٍ بحقلين على الصورةِ الصحيحة نالَ تذكرةً. الإصلاحُ: التذكرةُ تُرفضُ
// ما لم يكن الأمرُ موثَّقاً.
//
// **الحدُّ معلَن:** هذا إثباتُ إنفاذٍ لا إثباتُ إغلاقٍ. صلاحيّةُ الإغلاقِ للمجلس.

import assert from 'node:assert/strict';
import test from 'node:test';

import { EnforcementPoint } from '../../src/policy/enforcement-point.mjs';
import { createPolicyDecisionPoint } from '../../src/policy/engine.mjs';
import { loadPolicyBundle } from '../../src/policy/loader.mjs';

function memoryLog() {
  const events = [];
  return {
    events,
    append(type, actor, payload) {
      events.push({ type, actor, payload });
    },
  };
}

function makeEnforcementPoint({ royalCommandVerifier = null } = {}) {
  const bundle = loadPolicyBundle();
  const decisionPoint = createPolicyDecisionPoint({ bundle });
  return new EnforcementPoint({
    decisionPoint,
    log: memoryLog(),
    identityGate: null,
    requireIdentityGate: false,
    royalCommandVerifier,
  });
}

test('R5-B-06: أمرٌ ملكيٌّ مُزوَّرٌ (صورةٌ صحيحة) لا يُصدرُ تذكرةً', async () => {
  const ep = makeEnforcementPoint({
    royalCommandVerifier: (cmd) =>
      cmd.id === 'cmd:real-royal-command' && cmd.action === 'stop-state',
  });

  const result = await ep.authorize({
    actor: {
      id: 'actor:probe',
      kind: 'service',
      role: 'role:king',
      state: 'active',
      capabilities: [],
    },
    action: 'stop-state',
    resource: { type: 'state', id: 'sovereign' },
    context: {},
    royalCommandId: 'cmd:forged-probe',
    royalCommandDigest: 'a'.repeat(64),
  });

  assert.equal(result.decision.allowed, false, 'الأمرُ المُزوَّرُ لا يُؤذَنُ');
  assert.equal(
    result.decision.code,
    'SOVEREIGN_COMMAND_UNVERIFIED',
    'رمزُ الرفضِ SOVEREIGN_COMMAND_UNVERIFIED',
  );
  assert.equal(result.token, null, 'لا تذكرةَ على أمرٍ غيرِ موثَّق');
});

test('R5-B-06: أمرٌ ملكيٌّ موثَّقٌ يُصدرُ تذكرةً', async () => {
  const ep = makeEnforcementPoint({
    royalCommandVerifier: (cmd) =>
      cmd.id === 'cmd:real-royal-command' && cmd.action === 'stop-state',
  });

  const result = await ep.authorize({
    actor: {
      id: 'actor:probe',
      kind: 'service',
      role: 'role:king',
      state: 'active',
      capabilities: [],
    },
    action: 'stop-state',
    resource: { type: 'state', id: 'sovereign' },
    context: {},
    royalCommandId: 'cmd:real-royal-command',
    royalCommandDigest: 'a'.repeat(64),
  });

  assert.equal(result.decision.allowed, true, 'الأمرُ الموثَّقُ مأذونٌ');
  assert.ok(result.token, 'تذكرةٌ صادرة');
});

test('R5-B-06: بلا أمرٍ ملكيٍّ يُرفضُ قبلَ التحقّقِ من الديوان', async () => {
  const ep = makeEnforcementPoint({
    royalCommandVerifier: (cmd) => true,
  });

  const result = await ep.authorize({
    actor: {
      id: 'actor:probe',
      kind: 'service',
      role: 'role:king',
      state: 'active',
      capabilities: [],
    },
    action: 'stop-state',
    resource: { type: 'state', id: 'sovereign' },
    context: {},
  });

  assert.equal(result.decision.allowed, false, 'بلا أمرٍ ملكيٍّ يُرفض');
  assert.equal(
    result.decision.code,
    'SOVEREIGN_COMMAND_REQUIRED',
    'رمزُ الرفضِ SOVEREIGN_COMMAND_REQUIRED',
  );
});

test('R5-B-06: بلا مُحقِّقٍ يُرفضُ الفعلُ السياديُّ — fail-closed', async () => {
  const ep = makeEnforcementPoint({ royalCommandVerifier: null });

  const result = await ep.authorize({
    actor: {
      id: 'actor:probe',
      kind: 'service',
      role: 'role:king',
      state: 'active',
      capabilities: [],
    },
    action: 'stop-state',
    resource: { type: 'state', id: 'sovereign' },
    context: {},
    royalCommandId: 'cmd:any',
    royalCommandDigest: 'a'.repeat(64),
  });

  // بلا مُحقِّق: الفعلُ السياديُّ مرفوضٌ لا مُؤذَن
  assert.equal(result.decision.allowed, false, 'بلا مُحقِّقٍ يُرفض (fail-closed)');
  assert.equal(result.decision.code, 'SOVEREIGN_COMMAND_VERIFIER_REQUIRED');
});

test('R5-B-06: أمرٌ صحيحٌ بملخّصٍ خاطئٍ يُرفض', async () => {
  const ep = makeEnforcementPoint({
    royalCommandVerifier: (cmd) =>
      cmd.id === 'cmd:real-royal-command' &&
      cmd.digest === 'a'.repeat(64) &&
      cmd.action === 'stop-state',
  });

  const result = await ep.authorize({
    actor: {
      id: 'actor:probe',
      kind: 'service',
      role: 'role:king',
      state: 'active',
      capabilities: [],
    },
    action: 'stop-state',
    resource: { type: 'state', id: 'sovereign' },
    context: {},
    royalCommandId: 'cmd:real-royal-command',
    royalCommandDigest: 'b'.repeat(64), // ملخّصٌ خاطئ
  });

  assert.equal(result.decision.allowed, false, 'الملخّصُ الخاطئُ مرفوض');
  assert.equal(result.decision.code, 'SOVEREIGN_COMMAND_UNVERIFIED');
});

test('R5-B-06: أمرٌ صحيحٌ بفعلٍ خاطئٍ يُرفض', async () => {
  const ep = makeEnforcementPoint({
    royalCommandVerifier: (cmd) =>
      cmd.id === 'cmd:real-royal-command' && cmd.action === 'stop-state',
  });

  // الفعلُ في الطلب: change-policy، لكنّ المُحقّقَ ينتظرُ stop-state
  const result = await ep.authorize({
    actor: {
      id: 'actor:probe',
      kind: 'service',
      role: 'role:king',
      state: 'active',
      capabilities: [],
    },
    action: 'change-policy',
    resource: { type: 'policy', id: 'policy:retention' },
    context: {},
    royalCommandId: 'cmd:real-royal-command',
    royalCommandDigest: 'a'.repeat(64),
  });

  assert.equal(result.decision.allowed, false, 'الفعلُ الخاطئُ مرفوض');
  assert.equal(result.decision.code, 'SOVEREIGN_COMMAND_UNVERIFIED');
});

test('R5-B-06: أمرٌ صحيحٌ بموردٍ خاطئٍ يُرفض', async () => {
  const ep = makeEnforcementPoint({
    royalCommandVerifier: (cmd) =>
      cmd.id === 'cmd:real-royal-command' &&
      cmd.action === 'stop-state' &&
      cmd.resource === 'sovereign',
  });

  const result = await ep.authorize({
    actor: {
      id: 'actor:probe',
      kind: 'service',
      role: 'role:king',
      state: 'active',
      capabilities: [],
    },
    action: 'stop-state',
    resource: { type: 'state', id: 'wrong-resource' }, // موردٌ خاطئ
    context: {},
    royalCommandId: 'cmd:real-royal-command',
    royalCommandDigest: 'a'.repeat(64),
  });

  assert.equal(result.decision.allowed, false, 'الموردُ الخاطئُ مرفوض');
  assert.equal(result.decision.code, 'SOVEREIGN_COMMAND_UNVERIFIED');
});

test('R5-B-06: موردّان بنفس id ونوعٍ مختلفٍ لا يتقاطعان', async () => {
  const ep = makeEnforcementPoint({
    royalCommandVerifier: (cmd) => cmd.id === 'cmd:data-only' && cmd.resource === 'data:res-1',
  });

  // أمرٌ لـ data:res-1 لا يُجيزُ فعلًا على state:res-1 (نفسُ id لكنّ النوعَ مختلف)
  const result = await ep.authorize({
    actor: {
      id: 'actor:probe',
      kind: 'service',
      role: 'role:king',
      state: 'active',
      capabilities: [],
    },
    action: 'stop-state',
    resource: { type: 'state', id: 'res-1' }, // state:res-1 ≠ data:res-1
    context: {},
    royalCommandId: 'cmd:data-only',
    royalCommandDigest: 'a'.repeat(64),
  });

  assert.equal(result.decision.allowed, false, 'نوعٌ مختلفٌ بنفس id مرفوض');
  assert.equal(result.decision.code, 'SOVEREIGN_COMMAND_UNVERIFIED');
});
