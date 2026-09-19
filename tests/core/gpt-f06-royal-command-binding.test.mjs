// خصوم GPT-F06 — ربط تذكرة التفويض بالأمر الملكي المقبول لا بمعرّفه وحدَه.
//
// العيب (GPT-F06): كانت تذكرةُ التفويضِ تربطُ الفاعلَ/الفعلَ/الموردَ وحسب، فلا
// تحملُ معرّفَ الأمرِ الملكيِّ ولا ملخصَه. فكان مَن يملكُ تذكرةً صالحةً لأمرٍ
// ملكيٍّ مُتخيَّلٍ أن يُنفِّذَ بها أيَّ أمرٍ آخرَ يطابقُ الفاعلَ/الفعلَ/الموردَ،
// فيُمرَّرُ «أمرٌ ملكيٌّ مقبولٌ» مُدّعىً دون ربطٍ بمادةِ الأمرِ الفعليِّ.
//
// الإصلاح: ربطُ المعرّفِ وملخصِ الأمرِ (`royalCommandDigest` لـ`id`/`action`/
// `target`/`payload`/`issuedAt`) معاً في القرارِ والتذكرةِ والنواة. النواةُ تُقدّمُ
// معرّفَ الأمرِ الفعليِّ وملخصَه فتُقارَنُ بالتذكرة قبلَ استهلاكِها والتنفيذ.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CertificateAuthority,
  CrownGateway,
  EventLog,
  KingIdentity,
  createRoyalCommand,
  royalCommandDigest,
} from '../../src/root-of-trust/index.mjs';
import { ExecutionKernel, TaskState } from '../../src/core/index.mjs';
import { createPolicyDecisionPoint, EnforcementPoint } from '../../src/policy/index.mjs';

function setup() {
  const king = new KingIdentity();
  const log = new EventLog();
  const crown = new CrownGateway(king, new CertificateAuthority(king), log);
  const enforcement = new EnforcementPoint({
    decisionPoint: createPolicyDecisionPoint(),
    log,
    requireIdentityGate: false,
    royalCommandVerifier: () => true,
  });
  return { king, log, crown, enforcement };
}

/**
 * @param {string} [commandId]
 */
function sovereignRequest(commandId) {
  const command = createRoyalCommand('change-policy', 'policy:retention');
  if (commandId) command.id = commandId;
  return command;
}

test('النجاح: نفس معرّف الأمر وملخصه في القرار والتذكرة والنواة يُنفَّذ', async () => {
  const { king, crown, log, enforcement } = setup();
  const kernel = new ExecutionKernel({ crown, log, enforcement });
  const command = sovereignRequest();
  const { decision, token } = await enforcement.authorize({
    actor: { id: 'crown', kind: 'human', role: 'role:king', state: 'active' },
    action: 'change-policy',
    resource: { type: 'policy', id: 'retention' },
    context: {},
    royalCommandId: command.id,
    royalCommandDigest: royalCommandDigest(command),
  });
  assert.equal(decision.allowed, true);
  assert.equal(decision.royalCommandId, command.id, 'القرار يصف الأمر الذي صدر من أجله');
  const task = await kernel.submit(command, king.sign(command), () => ({ changed: true }), {
    decisionToken: /** @type {string} */ (token),
  });
  assert.equal(task.state, TaskState.SUCCEEDED);
});

test('الرفض المغلق: معرّف أمرٍ بلا ملخصٍ لا يفتح العتبة السيادية', async () => {
  const { enforcement } = setup();
  const command = sovereignRequest();
  /** @type {Partial<import('../../src/policy/model.mjs').PolicyRequest>} */
  const request = {
    actor: { id: 'crown', kind: 'human', role: 'role:king', state: 'active' },
    action: 'change-policy',
    resource: { type: 'policy', id: 'retention' },
    context: {},
    royalCommandId: command.id,
  };
  const { decision } = await enforcement.authorize(
    /** @type {import('../../src/policy/model.mjs').PolicyRequest} */ (request),
  );
  assert.equal(decision.allowed, false);
  assert.equal(decision.code, 'SOVEREIGN_COMMAND_REQUIRED', 'المعرّف وحده لا يكفي');
});

test('الرفض المغلق: ملخصٌ بلا معرّفٍ لا يفتح العتبة السيادية', async () => {
  const { enforcement } = setup();
  const command = sovereignRequest();
  /** @type {Partial<import('../../src/policy/model.mjs').PolicyRequest>} */
  const request = {
    actor: { id: 'crown', kind: 'human', role: 'role:king', state: 'active' },
    action: 'change-policy',
    resource: { type: 'policy', id: 'retention' },
    context: {},
    royalCommandDigest: royalCommandDigest(command),
  };
  const { decision } = await enforcement.authorize(
    /** @type {import('../../src/policy/model.mjs').PolicyRequest} */ (request),
  );
  assert.equal(decision.allowed, false);
  assert.equal(decision.code, 'SOVEREIGN_COMMAND_REQUIRED');
});

test('تبديل الأمر: تذكرةٌ لأمرٍ (أ) تُرفَضُ عند تنفيذ أمرٍ (ب) يطابقُ الفاعلَ والفعلَ والمورد', async () => {
  const { king, crown, log, enforcement } = setup();
  const kernel = new ExecutionKernel({ crown, log, enforcement });
  // أمرٌ (أ) يُصدرُ تذكرةً، وأمرٌ (ب) مختلفُ المعرّفِ والملخصِ لكن نفس الفعل/المورد.
  const commandA = sovereignRequest('cmd:aaaa-aaaa');
  const commandB = sovereignRequest('cmd:bbbb-bbbb');
  const { token } = await enforcement.authorize({
    actor: { id: 'crown', kind: 'human', role: 'role:king', state: 'active' },
    action: 'change-policy',
    resource: { type: 'policy', id: 'retention' },
    context: {},
    royalCommandId: commandA.id,
    royalCommandDigest: royalCommandDigest(commandA),
  });
  await assert.rejects(
    () =>
      kernel.submit(commandB, king.sign(commandB), () => true, {
        decisionToken: /** @type {string} */ (token),
      }),
    /ROYAL_COMMAND_MISMATCH/,
  );
});

test('تبديل الحمولة: تذكرةٌ لأمرٍ تُرفَضُ عند تغيير حمولة الأمر الفعلي', async () => {
  const { king, crown, log, enforcement } = setup();
  const kernel = new ExecutionKernel({ crown, log, enforcement });
  const command = sovereignRequest('cmd:payload-swap');
  const { token } = await enforcement.authorize({
    actor: { id: 'crown', kind: 'human', role: 'role:king', state: 'active' },
    action: 'change-policy',
    resource: { type: 'policy', id: 'retention' },
    context: {},
    royalCommandId: command.id,
    royalCommandDigest: royalCommandDigest(command),
  });
  // تبديلُ الحمولةِ بعدَ إصدارِ التذكرةِ يُغيّرُ الملخصَ فيكشفُ التبديل.
  // eslint-disable-next-line require-atomic-updates -- تبديلٌ متعمّدٌ لاختبارِ الكشفِ، لا تعيينٌ تنافسيٌّ حقيقيٌّ.
  command.payload = { tampered: true };
  await assert.rejects(
    () =>
      kernel.submit(command, king.sign(command), () => true, {
        decisionToken: /** @type {string} */ (token),
      }),
    /ROYAL_COMMAND_MISMATCH/,
  );
});

test('إعادة استعمال التذكرة على أمرٍ آخرَ تُرفَضُ ولو طابقَ الفاعلَ والفعلَ والمورد', async () => {
  const { king, crown, log, enforcement } = setup();
  const kernel = new ExecutionKernel({ crown, log, enforcement });
  const commandA = sovereignRequest('cmd:reuse-first');
  const commandB = sovereignRequest('cmd:reuse-second');
  const { token } = await enforcement.authorize({
    actor: { id: 'crown', kind: 'human', role: 'role:king', state: 'active' },
    action: 'change-policy',
    resource: { type: 'policy', id: 'retention' },
    context: {},
    royalCommandId: commandA.id,
    royalCommandDigest: royalCommandDigest(commandA),
  });
  // الاستهلاكُ الأولُ يُنفِّذُ أمرَ (أ).
  await kernel.submit(commandA, king.sign(commandA), () => true, {
    decisionToken: /** @type {string} */ (token),
  });
  // التذكرةُ استُهلكت، فلا يجوزُ إعادةُ استعمالِها — على أيِّ أمر.
  await assert.rejects(
    () =>
      kernel.submit(commandB, king.sign(commandB), () => true, {
        decisionToken: /** @type {string} */ (token),
      }),
    /AUTHORIZATION_DECISION_REUSED/,
  );
});
