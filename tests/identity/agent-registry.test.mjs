import test from 'node:test';
import assert from 'node:assert/strict';
import { KingIdentity, CertificateAuthority, EventLog } from '../../src/root-of-trust/index.mjs';
import { AgentRegistry, AgentState } from '../../src/identity/agent-registry.mjs';
import { createMemoryRepository } from '../../src/persistence/repository-memory.mjs';

// السجل صار على مستودع (`M3.05`)، ومستودع الذاكرة هنا للسرعة لا للاستمرارية:
// إثبات بقاء الحالة بعد إعادة التشغيل موضعه `tests/persistence/restart.test.mjs`
// على قاعدة حقيقية.
function setup(maxAgents = 10) {
  const king = new KingIdentity(),
    ca = new CertificateAuthority(king),
    log = new EventLog();
  return {
    r: new AgentRegistry({
      ca,
      log,
      repository: createMemoryRepository(AgentRegistry.spec),
      maxAgents,
    }),
    ca,
  };
}
test('registers a least-privilege agent with certificate', async () => {
  const { r, ca } = setup();
  const a = await r.register({
    name: 'observer-1',
    role: 'observer',
    capabilities: ['action:inspect'],
  });
  assert.equal(a.state, AgentState.ACTIVE);
  assert.equal(ca.isValid(a.certificate), true);
  assert.deepEqual(
    (await r.list()).map((x) => x.id),
    [a.id],
  );
});
test('rejects forbidden capabilities and quota overflow', async () => {
  const { r } = setup(1);
  await r.register({ name: 'one', role: 'observer' });
  await assert.rejects(() => r.register({ name: 'two', role: 'observer' }), /AGENT_QUOTA_EXCEEDED/);
  const { r: r2 } = setup();
  await assert.rejects(
    () => r2.register({ name: 'root', role: 'x', capabilities: ['sovereign:root'] }),
    /FORBIDDEN_CAPABILITY/,
  );
});
test('suspends and revokes agents irreversibly', async () => {
  const { r, ca } = setup();
  const a = await r.register({ name: 'worker', role: 'worker' });
  await r.transition(a.id, AgentState.SUSPENDED, 'maintenance');
  const suspended = await r.get(a.id);
  assert.ok(suspended, 'الوكيل الموقوف يجب أن يبقى في السجل');
  assert.equal(suspended.state, AgentState.SUSPENDED);
  assert.equal(suspended.stateReason, 'maintenance');
  await r.transition(a.id, AgentState.REVOKED, 'security');
  assert.equal(ca.isValid(a.certificate), false);
  await assert.rejects(
    () => r.transition(a.id, AgentState.ACTIVE, 'resume'),
    /REVOKED_AGENT_IMMUTABLE/,
  );
});
test('punitive transitions refuse to be recorded without a reason', async () => {
  // تضييقٌ جديد في `M3.05`: قيد القاعدة `agents_punitive_has_reason` لا يقبل
  // تعليقاً بلا سبب، فصار الرفض في السجل قبل أن يصل إلى القاعدة.
  const { r } = setup();
  const a = await r.register({ name: 'auditee', role: 'worker' });
  await assert.rejects(
    () => r.transition(a.id, AgentState.SUSPENDED),
    /AGENT_PUNITIVE_REASON_REQUIRED/,
  );
  const still = await r.get(a.id);
  assert.ok(still, 'الرفض لا يحذف الوكيل');
  assert.equal(still.state, AgentState.ACTIVE);
});
