// اختبار المسار الجانبي في النواة — M4.05، بوابة G4.
//
// نصّ البوابة: «لا فعل حسّاس يُنفَّذ بلا قرار سياسة مسبَّب ومسجَّل». وأخطر ما
// يبطلها ليس ثغرةً في المحرّك، بل أن يبقى في النواة طريقٌ لا يمرّ به. فالمقيس
// هنا أربع حالات: فعلٌ محكوم بلا تذكرة يُرفض، وفعلٌ محكوم بتذكرة صحيحة يُنفَّذ،
// ونواةٌ بلا نقطة تفويض ترفض المحكوم كلّه (فلا يكون «لا تُوصل النقطة» مساراً)،
// وفعلٌ غير محكوم يبقى كما كان قبل M4 فلا تُثقل الدولة بتذكرةٍ لكل قراءة.
//
// وحالة خامسة تُقاس صراحةً: الرفض لا يحرق معرّف الأمر الملكي، فيبقى نفس الأمر
// قابلاً للتنفيذ بعد الحصول على تذكرة. ولو كان يحرقه لصار كل رفض تفويض عقوبةً
// على الأمر نفسه.

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
    royalCommandVerifier: (cmd) => true,
  });
  return { king, log, crown, enforcement };
}

/**
 * أمرٌ ملكي على فعل محكوم: تغيير السياسة فعلٌ فوق العتبة السيادية.
 * @returns {import('../../src/root-of-trust/crown.mjs').RoyalCommand}
 */
function governedCommand() {
  return createRoyalCommand('change-policy', 'policy:retention');
}

test('فعلٌ محكوم بلا تذكرة قرار يُرفض بخطأ مُسمّى', async () => {
  const { king, crown, log, enforcement } = setup();
  const kernel = new ExecutionKernel({ crown, log, enforcement });
  const command = governedCommand();
  // `submit` غير متزامنة بعد `M5.01`، فالرفض وعدٌ مرفوض لا رميةٌ متزامنة.
  await assert.rejects(
    () => kernel.submit(command, king.sign(command), () => ({ changed: true })),
    /AUTHORIZATION_DECISION_MISSING/,
  );
  assert.equal(kernel.tasks.size, 0, 'الفعل المرفوض لا يُدرج مهمةً في النواة');
});

test('نواةٌ بلا نقطة تفويض ترفض كل فعل محكوم — الغياب ليس استثناءً', async () => {
  const { king, crown, log } = setup();
  const kernel = new ExecutionKernel({ crown, log });
  assert.ok(kernel.governedActions.size >= 15, 'الكتالوج يُقرأ من البيانات لا من النقطة');
  for (const action of ['change-policy', 'export-keys', 'purge-data', 'create-agent']) {
    const command = createRoyalCommand(action, 'resource:one');
    await assert.rejects(
      () => kernel.submit(command, king.sign(command), () => true),
      /AUTHORIZATION_POINT_REQUIRED/,
      `فعلٌ محكوم نُفِّذ بلا نقطة تفويض: ${action}`,
    );
  }
});

test('فعلٌ غير محكوم يبقى مساره كما كان قبل M4', async () => {
  const { king, crown, log, enforcement } = setup();
  const kernel = new ExecutionKernel({ crown, log, enforcement });
  const command = createRoyalCommand('inspect', 'agent:one');
  const task = await kernel.submit(command, king.sign(command), () => ({ ok: true }));
  assert.equal(task.state, TaskState.SUCCEEDED);
});

test('تذكرة القرار تُنفِذ الفعل المحكوم وتُسجَّل، والأمر لا يُحرق قبل التفويض', async () => {
  const { king, crown, log, enforcement } = setup();
  const kernel = new ExecutionKernel({ crown, log, enforcement });
  const command = governedCommand();
  const signature = king.sign(command);

  // المحاولة الأولى ترفض لغياب التذكرة…
  await assert.rejects(() => kernel.submit(command, signature, () => true), /AUTHORIZATION/);

  // …ثم يُطلب القرار من النقطة الوحيدة، ويُنفَّذ **نفس** الأمر بنفس معرّفه.
  const { decision, token } = await enforcement.authorize({
    actor: { id: 'crown', kind: 'human', role: 'role:king', state: 'active' },
    action: 'change-policy',
    resource: { type: 'policy', id: 'retention' },
    context: {},
    royalCommandId: command.id,
    royalCommandDigest: royalCommandDigest(command),
  });
  assert.equal(decision.allowed, true, `القرار جاء رفضاً: ${decision.code} — ${decision.reason}`);
  assert.equal(typeof token, 'string');

  const task = await kernel.submit(command, signature, () => ({ changed: true }), {
    decisionToken: /** @type {string} */ (token),
  });
  assert.equal(task.state, TaskState.SUCCEEDED);
  assert.deepEqual(task.result, { changed: true });

  const verified = log.events.filter((e) => e.type === 'kernel.authorization.verified');
  assert.equal(verified.length, 1, 'مرور الفعل بالنقطة يُسجَّل في السجل');
  const decisions = log.events.filter((e) => e.type === 'policy.decision');
  assert.equal(decisions.length, 1, 'القرار نفسه مسجَّل مسبَّباً');
});

test('تذكرة الفعل المحكوم لا تُستعمل مرّتين ولو أُعيد الأمر نفسه', async () => {
  const { king, crown, log, enforcement } = setup();
  const kernel = new ExecutionKernel({ crown, log, enforcement });
  const command = governedCommand();
  const signature = king.sign(command);
  const { token } = await enforcement.authorize({
    actor: { id: 'crown', kind: 'human', role: 'role:king', state: 'active' },
    action: 'change-policy',
    resource: { type: 'policy', id: 'retention' },
    context: {},
    royalCommandId: command.id,
    royalCommandDigest: royalCommandDigest(command),
  });
  const authorization = { decisionToken: /** @type {string} */ (token) };
  await kernel.submit(command, signature, () => true, authorization);
  await assert.rejects(
    () => kernel.submit(command, signature, () => true, authorization),
    /AUTHORIZATION_DECISION_REUSED|COMMAND_REPLAY|ROYAL_COMMAND/,
    'إعادة التنفيذ بنفس التذكرة يجب أن تُرفض',
  );
});

test('تذكرةٌ صحيحة لفعل آخر لا تُنفِّذ الفعل المحكوم', async () => {
  const { king, crown, log, enforcement } = setup();
  const kernel = new ExecutionKernel({ crown, log, enforcement });
  const otherCommand = createRoyalCommand('change-policy', 'policy:other');
  const { token } = await enforcement.authorize({
    actor: { id: 'crown', kind: 'human', role: 'role:king', state: 'active' },
    action: 'change-policy',
    resource: { type: 'policy', id: 'other' },
    context: {},
    // أمرٌ آخرُ حقيقيٌّ لا سلسلةٌ نائبةٌ: بعدَ النتيجةِ `R6-A-07` يُرفَضُ الملخصُ
    // المشوَّهُ في المحرّكِ نفسِه، فتُصبحُ التذكرةُ معدومةً ويُختبَرُ غيابُها لا
    // عدمُ تطابقِها. والمقصودُ هنا تذكرةٌ **صحيحةٌ تماماً** لأمرٍ آخرَ.
    royalCommandId: otherCommand.id,
    royalCommandDigest: royalCommandDigest(otherCommand),
  });
  assert.equal(typeof token, 'string', 'تذكرةُ الأمرِ الآخرِ يجب أن تصدرَ فعلاً');
  const command = governedCommand();
  await assert.rejects(
    () =>
      kernel.submit(command, king.sign(command), () => true, {
        decisionToken: /** @type {string} */ (token),
      }),
    /AUTHORIZATION_DECISION_MISMATCH/,
  );
});
