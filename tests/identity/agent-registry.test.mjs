import test from 'node:test';
import assert from 'node:assert/strict';
import { KingIdentity, CertificateAuthority, EventLog } from '../../src/root-of-trust/index.mjs';
import { AgentRegistry, AgentState } from '../../src/identity/agent-registry.mjs';
function setup(maxAgents = 10) {
  const king = new KingIdentity(),
    ca = new CertificateAuthority(king),
    log = new EventLog();
  return { r: new AgentRegistry({ ca, log, maxAgents }), ca };
}
test('registers a least-privilege agent with certificate', () => {
  const { r, ca } = setup();
  const a = r.register({ name: 'observer-1', role: 'observer', capabilities: ['action:inspect'] });
  assert.equal(a.state, AgentState.ACTIVE);
  assert.equal(ca.isValid(a.certificate), true);
  assert.deepEqual(
    r.list().map((x) => x.id),
    [a.id],
  );
});
test('rejects forbidden capabilities and quota overflow', () => {
  const { r } = setup(1);
  r.register({ name: 'one', role: 'observer' });
  assert.throws(() => r.register({ name: 'two', role: 'observer' }), /AGENT_QUOTA_EXCEEDED/);
  const { r: r2 } = setup();
  assert.throws(
    () => r2.register({ name: 'root', role: 'x', capabilities: ['sovereign:root'] }),
    /FORBIDDEN_CAPABILITY/,
  );
});
test('suspends and revokes agents irreversibly', () => {
  const { r, ca } = setup();
  const a = r.register({ name: 'worker', role: 'worker' });
  r.transition(a.id, AgentState.SUSPENDED, 'maintenance');
  assert.equal(r.get(a.id).state, AgentState.SUSPENDED);
  r.transition(a.id, AgentState.REVOKED, 'security');
  assert.equal(ca.isValid(a.certificate), false);
  assert.throws(() => r.transition(a.id, AgentState.ACTIVE, 'resume'), /REVOKED_AGENT_IMMUTABLE/);
});
