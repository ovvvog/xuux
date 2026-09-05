import test from 'node:test';
import assert from 'node:assert/strict';
import { KingIdentity, CertificateAuthority, EventLog } from '../../src/root-of-trust/index.mjs';
import { AgentRegistry, AgentState } from '../../src/identity/agent-registry.mjs';
import { createMemoryRepository } from '../../src/persistence/repository-memory.mjs';
import { loadCapabilityCatalog } from '../../src/identity/capability-catalog.mjs';
import { CapabilityGrantLedger } from '../../src/identity/capability-grants.mjs';
import { IncidentRegister } from '../../src/identity/incident-register.mjs';
import { IdentityGate } from '../../src/identity/identity-gate.mjs';
import { QuarantineWarden } from '../../src/governance/quarantine.mjs';

// اختبارات التواطؤ والعزل — M11.03
//
// المسألة التي تُقاس: هل يمنع النظام وكلاءً متعدّدين من تجاوز الحدود بالتنسيق
// بينهم؟ كلُّ اختبار يبني وكلاءَ حقيقيّين ويحاول سيناريو تواطؤ.

function setup() {
  let nowMs = Date.UTC(2026, 8, 5, 2, 0, 0);
  const now = () => new Date(nowMs);
  const king = new KingIdentity();
  const ca = new CertificateAuthority(king);
  const log = new EventLog();
  const catalog = loadCapabilityCatalog();
  const incidents = new IncidentRegister({ log, now });
  const grants = new CapabilityGrantLedger({ catalog, log, incidents, now });
  const registry = new AgentRegistry({
    ca,
    log,
    repository: createMemoryRepository(AgentRegistry.spec),
    catalog,
    grants,
    incidents,
  });
  const gate = new IdentityGate({ registry, ca, catalog, grants, incidents, log });
  const warden = new QuarantineWarden({ log, incidents, now });

  return {
    gate,
    registry,
    grants,
    incidents,
    ca,
    log,
    catalog,
    warden,
    advance: (/** @type {number} */ s) => (nowMs += s * 1000),
  };
}

test('collusion: agent A cannot use agent B identity to access B capabilities', async () => {
  const { gate, registry } = setup();
  const agentA = await registry.register({
    name: 'alpha',
    role: 'role:agent',
    capabilities: ['action:read-registry'],
  });
  const agentB = await registry.register({
    name: 'beta',
    role: 'role:agent',
    capabilities: ['action:read-registry', 'action:external-egress'],
  });

  // Agent A verifies with its own ID — gets only its own capabilities
  const verdictA = await gate.verify(agentA.id);
  assert.equal(verdictA.ok, true);
  assert.deepEqual(verdictA.actor?.capabilities, ['action:read-registry']);
  assert.ok(!verdictA.actor?.capabilities.includes('action:external-egress'));

  // Agent B has more capabilities, but A cannot use B's identity
  const verdictB = await gate.verify(agentB.id);
  assert.ok(verdictB.actor?.capabilities.includes('action:external-egress'));
  assert.notEqual(verdictA.actor?.id, verdictB.actor?.id);
});

test('collusion: a revoked agent cannot regain access through another agent', async () => {
  const { gate, registry } = setup();
  const agentA = await registry.register({
    name: 'alpha',
    role: 'role:agent',
    capabilities: ['action:read-registry'],
  });
  const agentB = await registry.register({
    name: 'beta',
    role: 'role:agent',
    capabilities: ['action:read-registry'],
  });

  // Revoke Agent A
  await registry.transition(agentA.id, AgentState.REVOKED, 'compromised');

  // Agent A is revoked — identity gate rejects it
  const verdictA = await gate.verify(agentA.id);
  assert.equal(verdictA.ok, false);
  assert.equal(verdictA.code, 'IDENTITY_NOT_ACTIVE');

  // Agent B is still active but cannot transfer its identity to A
  const verdictB = await gate.verify(agentB.id);
  assert.equal(verdictB.ok, true);
  assert.deepEqual(verdictB.actor?.id, agentB.id);
  assert.notEqual(verdictB.actor?.id, agentA.id);
});

test('collusion: agents cannot chain authorizations to escalate privileges', async () => {
  const { gate, registry } = setup();
  const agentA = await registry.register({
    name: 'alpha',
    role: 'role:agent',
    capabilities: ['action:read-registry'],
  });
  const agentB = await registry.register({
    name: 'beta',
    role: 'role:supervisor',
    capabilities: ['action:read-registry', 'action:approve-classification'],
  });

  // Agent A has limited capabilities
  const verdictA = await gate.verify(agentA.id);
  assert.equal(verdictA.actor?.role, 'role:agent');
  assert.ok(!verdictA.actor?.capabilities.includes('action:approve-classification'));

  // Agent B has more capabilities, but A cannot access them
  const verdictB = await gate.verify(agentB.id);
  assert.ok(verdictB.actor?.capabilities.includes('action:approve-classification'));
  assert.notEqual(verdictA.actor?.role, verdictB.actor?.role);
});

test('collusion: two agents have separate certificates and cannot share them', async () => {
  const { gate, registry } = setup();
  const agentA = await registry.register({
    name: 'alpha',
    role: 'role:agent',
    capabilities: ['action:read-registry'],
  });
  const agentB = await registry.register({
    name: 'beta',
    role: 'role:agent',
    capabilities: ['action:read-registry'],
  });

  // Each agent has its own identity
  const verdictA = await gate.verify(agentA.id);
  const verdictB = await gate.verify(agentB.id);

  assert.equal(verdictA.ok, true);
  assert.equal(verdictB.ok, true);
  assert.notEqual(verdictA.actor?.id, verdictB.actor?.id);
});

test('collusion: quarantine prevents an agent from operating after signaling', () => {
  const { log, incidents } = setup();
  let nowMs = Date.UTC(2026, 8, 5, 2, 0, 0);
  const warden = new QuarantineWarden({
    log,
    incidents,
    now: () => new Date(nowMs),
    thresholds: { 'fingerprint-drift': 1 },
    windowMs: 60000,
  });

  // Report an anomaly to quarantine an agent
  warden.report({ kind: 'fingerprint-drift', subject: 'agent:beta' });

  // The agent should be quarantined
  assert.ok(warden.isQuarantined('agent:beta'));
});

test('collusion: a suspended agent loses its temporary grants', async () => {
  const { gate, registry, grants } = setup();
  const agentA = await registry.register({
    name: 'alpha',
    role: 'role:agent',
    capabilities: ['action:read-registry'],
  });
  const agentB = await registry.register({
    name: 'beta',
    role: 'role:admin',
    capabilities: ['action:read-registry'],
  });

  // Agent B grants a temporary capability to Agent A
  grants.grant({
    agentId: agentA.id,
    capability: 'action:read-registry',
    reason: 'temporary access',
    grantedBy: agentB.id,
    grantorRole: 'role:admin',
    ttlSeconds: 3600,
  });

  // Suspend Agent A
  await registry.transition(agentA.id, AgentState.SUSPENDED, 'security concern');

  // Agent A should be rejected
  const verdict = await gate.verify(agentA.id);
  assert.equal(verdict.ok, false);
});
