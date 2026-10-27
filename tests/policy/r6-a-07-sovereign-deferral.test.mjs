// R6-A-07 (جولتا 7 و8) — إثباتُ إصلاحِ المحرّكِ ونقطةِ الإنفاذِ معًا.
//
// **المعيار الأول:** المحرّكُ لا يُصدِرُ إذنًا سياديًّا بفحصِ الصورةِ — فعلٌ فوقَ
// العتبةِ مأذونٌ بهِ بالسياسةِ يعودُ منَ المحرّكِ **تأجيلًا** (`policyAllows: true`
// و`allowed: false` و`SOVEREIGN_COMMAND_VERIFICATION_REQUIRED`)، فلا يبقى للمحرّكِ
// إذنٌ يُنتحَلُ بملخصٍ مختلقٍ مهما حسُنَتْ صورتُه.
//
// **المعيار الثاني:** الإذنَ السياديَّ يُصدِرُهُ الترقيةُ عندَ نقطةِ الإنفاذِ بعدَ
// تحقُّقِ الديوانِ من الأمرِ الموقَّعِ — فالأمرُ المُجازُ يُرقّى القرارَ المؤجَّلَ
// إلى `POLICY_ALLOW` وتُصدرُ التذكرةُ، والأمرُ المرفوضُ يبقيهِ `SOVEREIGN_COMMAND_UNVERIFIED`
// بلا تذكرةٍ، وغيابُ المُحقِّقِ يبقيهِ `SOVEREIGN_COMMAND_VERIFIER_REQUIRED`.
//
// **الحدُّ المعلَن:** هذا إثباتُ إنفاذٍ لا إثباتُ إغلاقٍ. صلاحيّةُ الإغلاقِ للمجلس.

import assert from 'node:assert/strict';
import test from 'node:test';

import { EnforcementPoint } from '../../src/policy/enforcement-point.mjs';
import { createPolicyDecisionPoint } from '../../src/policy/engine.mjs';
import { loadPolicyBundle } from '../../src/policy/loader.mjs';

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

/**
 * @param {{ royalCommandVerifier?: ((command: { id: string, action: string, resource?: string, digest?: string }) => boolean) | null }} [opts]
 */
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

/** @type {import('../../src/policy/model.mjs').PolicyActor} */
const king = {
  id: 'actor:probe',
  kind: 'service',
  role: 'role:king',
  state: 'active',
  capabilities: [],
};

/** @type {import('../../src/policy/model.mjs').PolicyRequest} */
const stopRequest = {
  actor: king,
  action: 'stop-state',
  resource: { type: 'state', id: 'sovereign' },
  context: {},
  royalCommandId: 'cmd:forged-probe',
  royalCommandDigest: 'a'.repeat(64),
};

test('R6-A-07: المحرّكُ يؤجّلُ الفعلَ السياديَّ ولا يُجيزُه — قرارُ المحرّكِ لا نقطةِ الإنفاذِ', () => {
  const bundle = loadPolicyBundle();
  const pdp = createPolicyDecisionPoint({ bundle });
  const decision = pdp.evaluate(stopRequest);
  assert.equal(
    decision.allowed,
    false,
    'المحرّكُ أصدرَ إذنًا سياديًّا بفحصِ الصورةِ — العيبُ باقٍ',
  );
  assert.equal(decision.code, 'SOVEREIGN_COMMAND_VERIFICATION_REQUIRED');
  assert.equal(decision.policyAllows, true, 'التأجيلُ فقدَ تمييزَه عن رفضِ الصلاحية');
  assert.equal(decision.requiresRoyalCommand, true);
});

test('R6-A-07: الأمرُ المُجازُ منَ الديوانِ يُرقّي التأجيلَ إلى إذنٍ وتذكرة', async () => {
  const ep = makeEnforcementPoint({
    royalCommandVerifier: (cmd) =>
      cmd.id === 'cmd:real-royal-command' && cmd.action === 'stop-state',
  });
  const result = await ep.authorize({
    ...stopRequest,
    royalCommandId: 'cmd:real-royal-command',
  });
  assert.equal(result.decision.allowed, true, 'الأمرُ المُجازُ لم يُرقَّ إلى إذنٍ');
  assert.equal(result.decision.code, 'POLICY_ALLOW', 'الترقيةُ لا تُصدرُ رمزَ إذنٍ');
  assert.equal(
    result.decision.royalCommandId,
    'cmd:real-royal-command',
    'القرارُ المُرقّى يبقى وصّافًا للأمرِ الذي أُجيزَ من أجله',
  );
  assert.notEqual(result.token, null, 'الأمرُ المُجازُ لا يُصدرُ تذكرةً');
});

test('R6-A-07: الأمرُ المرفوضُ منَ الديوانِ يُبقي التأجيلَ رفضًا بلا تذكرة', async () => {
  const ep = makeEnforcementPoint({
    royalCommandVerifier: () => false,
  });
  const result = await ep.authorize(stopRequest);
  assert.equal(result.decision.allowed, false);
  assert.equal(result.decision.code, 'SOVEREIGN_COMMAND_UNVERIFIED');
  assert.equal(result.token, null, 'لا تذكرةَ على أمرٍ يرفضُه الديوان');
});

test('R6-A-07: غيابُ المُحقِّقِ يُبقي التأجيلَ رفضًا — لا يمرُّ الإذنُ بلا ديوان', async () => {
  const ep = makeEnforcementPoint({ royalCommandVerifier: null });
  const result = await ep.authorize(stopRequest);
  assert.equal(result.decision.allowed, false);
  assert.equal(result.decision.code, 'SOVEREIGN_COMMAND_VERIFIER_REQUIRED');
  assert.equal(result.token, null);
});

test('R6-A-07: غيابُ الأمرِ يبقى رفضًا مستقلًّا لا يتأثر بالتأجيل', async () => {
  const ep = makeEnforcementPoint({
    royalCommandVerifier: () => true,
  });
  // بحذفِ الحقلينِ لا بتمريرِ `undefined`: العقدُ `exactOptionalPropertyTypes`
  // يميّزُ الغيابَ عن النصِّ الفارغِ، والغيابُ هو المطلوبُ هنا.
  const { royalCommandId: _omitId, royalCommandDigest: _omitDigest, ...bare } = stopRequest;
  const result = await ep.authorize(bare);
  assert.equal(result.decision.allowed, false);
  assert.equal(result.decision.code, 'SOVEREIGN_COMMAND_REQUIRED', 'لا أمرَ أصلًا — لا تحققُّ');
  assert.equal(result.token, null);
});
