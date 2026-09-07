import test from 'node:test';
import assert from 'node:assert/strict';
import { KingIdentity, CertificateAuthority, EventLog } from '../../src/root-of-trust/index.mjs';
import { AgentRegistry, AgentState } from '../../src/identity/agent-registry.mjs';
import { createMemoryRepository } from '../../src/persistence/repository-memory.mjs';
import { loadCapabilityCatalog } from '../../src/identity/capability-catalog.mjs';
import { CapabilityGrantLedger } from '../../src/identity/capability-grants.mjs';
import { IncidentRegister } from '../../src/identity/incident-register.mjs';
import { IdentityGate } from '../../src/identity/identity-gate.mjs';
import { loadPolicyBundle } from '../../src/policy/loader.mjs';
import { PolicyDecisionPoint } from '../../src/policy/engine.mjs';
import { EnforcementPoint } from '../../src/policy/enforcement-point.mjs';

// البوابة تُبنى من المكوّنات الحقيقية لا من مزدوجات: قيمة `M6.01` في أن الإبطال
// في **سلطة الشهادات وسجل الوكلاء** ينفذ إلى نقطة التفويض، ومزدوجٌ يقول «مبطَل»
// لا يُثبت ذلك، بل يُثبت أن البوابة تصدّق مزدوجاً.
function setup() {
  let nowMs = Date.UTC(2026, 7, 24, 9, 0, 0);
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
  return {
    gate,
    registry,
    grants,
    incidents,
    ca,
    log,
    catalog,
    advance: (/** @type {number} */ s) => (nowMs += s * 1000),
  };
}

test('a registered active agent verifies with its certificate capabilities', async () => {
  const { gate, registry } = setup();
  const agent = await registry.register({
    name: 'reader',
    role: 'role:agent',
    capabilities: ['action:read-registry'],
  });
  const verdict = await gate.verify(agent.id);
  assert.equal(verdict.ok, true);
  assert.equal(verdict.code, 'IDENTITY_VERIFIED');
  assert.equal(verdict.actor?.role, 'role:agent');
  assert.deepEqual(verdict.actor?.capabilities, ['action:read-registry']);
});

test('an unknown actor is rejected because identity is read from the registry', async () => {
  const { gate } = setup();
  assert.equal((await gate.verify('agent:ghost')).code, 'IDENTITY_UNKNOWN');
  assert.equal((await gate.verify('')).code, 'IDENTITY_ID_MISSING');
});

test('a revoked agent is rejected at the very next authorization', async () => {
  const { gate, registry } = setup();
  const agent = await registry.register({ name: 'worker', role: 'role:agent' });
  assert.equal((await gate.verify(agent.id)).ok, true);
  await registry.transition(agent.id, AgentState.REVOKED, 'تسريب بيانات');
  const verdict = await gate.verify(agent.id);
  assert.equal(verdict.ok, false);
  assert.equal(verdict.code, 'IDENTITY_NOT_ACTIVE');
  assert.match(verdict.reason, /تسريب بيانات/);
});

test('a suspended agent is rejected too, and loses its temporary grants', async () => {
  const { gate, registry, grants } = setup();
  const agent = await registry.register({ name: 'worker', role: 'role:agent' });
  grants.grant({
    agentId: agent.id,
    capability: 'action:read-audit',
    reason: 'تحقيق جارٍ',
    principal: { id: 'agent:justice', role: 'role:chief-justice', state: 'active' },
    ttlSeconds: 3600,
  });
  assert.equal(
    (await gate.verify(agent.id)).actor?.capabilities.includes('action:read-audit'),
    true,
  );
  await registry.transition(agent.id, AgentState.SUSPENDED, 'مراجعة سلوك');
  assert.equal((await gate.verify(agent.id)).code, 'IDENTITY_NOT_ACTIVE');
  assert.equal(
    grants.capabilitiesOf(agent.id).size,
    0,
    'تعليق الهوية يسحب منحها فلا تعود بإعادة التفعيل بلا قرار',
  );
});

test('a revoked certificate on an otherwise active agent is rejected', async () => {
  const { gate, registry, ca } = setup();
  const agent = await registry.register({ name: 'worker', role: 'role:agent' });
  // السحب من السلطة مباشرةً بلا تغيير حالة السجل: هذا هو الفرق بين سؤال جذر
  // الثقة في كل طلب والاكتفاء بحالةٍ مخزَّنة.
  ca.revoke(agent.certificate.id, 'اشتباه في تسريب المفتاح');
  const verdict = await gate.verify(agent.id);
  assert.equal(verdict.code, 'IDENTITY_CERTIFICATE_INVALID');
});

test('a certificate issued for another subject is not accepted', async () => {
  const { registry, ca, catalog, grants, incidents, log } = setup();
  const agent = await registry.register({ name: 'worker', role: 'role:agent' });
  const other = ca.issue('agent:someone-else', 'role:king', ['action:stop-state']);
  const forged = {
    get: async () => ({ ...agent, certificate: other }),
  };
  const forgedGate = new IdentityGate({
    registry: /** @type {never} */ (forged),
    ca,
    catalog,
    grants,
    incidents,
    log,
  });
  assert.equal((await forgedGate.verify(agent.id)).code, 'IDENTITY_SUBJECT_MISMATCH');
});

test('active grants add to the certificate, and expiry removes them', async () => {
  const { gate, registry, grants, advance } = setup();
  const agent = await registry.register({
    name: 'reader',
    role: 'role:agent',
    capabilities: ['action:read-registry'],
  });
  grants.grant({
    agentId: agent.id,
    capability: 'action:write-memory',
    reason: 'كتابة تقرير الحادثة',
    principal: { id: 'agent:minister', role: 'role:minister', state: 'active' },
    ttlSeconds: 120,
  });
  assert.deepEqual((await gate.verify(agent.id)).actor?.capabilities, [
    'action:read-registry',
    'action:write-memory',
  ]);
  advance(121);
  assert.deepEqual((await gate.verify(agent.id)).actor?.capabilities, ['action:read-registry']);
});

test('registering a forbidden capability is rejected and opens an incident', async () => {
  const { registry, incidents } = setup();
  await assert.rejects(
    () => registry.register({ name: 'root', role: 'role:agent', capabilities: ['key:export'] }),
    /FORBIDDEN_CAPABILITY/,
  );
  const opened = incidents.list({ type: 'forbidden-capability' });
  assert.equal(opened.length, 1);
  const incident = opened[0];
  assert.ok(incident);
  assert.deepEqual(incident.detail['capabilities'], ['key:export']);
});

test('the enforcement point denies unverified identities before policy runs', async () => {
  const { gate, registry, log } = setup();
  const decisionPoint = new PolicyDecisionPoint({ bundle: loadPolicyBundle() });
  const point = new EnforcementPoint({ decisionPoint, log, identityGate: gate });
  const agent = await registry.register({
    name: 'reader',
    role: 'role:agent',
    capabilities: ['action:read-registry'],
  });

  const request = {
    actor: {
      id: agent.id,
      kind: /** @type {const} */ ('autonomous'),
      role: 'role:operator',
      state: 'active',
    },
    action: 'read-registry',
    resource: { type: 'registry', id: 'agents' },
    context: {},
  };

  const allowed = await point.authorize(request);
  assert.equal(allowed.decision.allowed, true, 'الهوية المحقَّقة تمرّ كما كانت');

  await registry.transition(agent.id, AgentState.REVOKED, 'إبطال أمني');
  const denied = await point.authorize(request);
  assert.equal(denied.decision.allowed, false);
  assert.equal(denied.decision.code, 'IDENTITY_UNVERIFIED');
  assert.equal(denied.token, null, 'المرفوض لا تُصدر له تذكرة');
  assert.match(denied.decision.reason, /IDENTITY_NOT_ACTIVE/);
});

test('the enforcement point replaces the claimed role instead of trusting it', async () => {
  const { gate, registry, log } = setup();
  const decisionPoint = new PolicyDecisionPoint({ bundle: loadPolicyBundle() });
  const point = new EnforcementPoint({ decisionPoint, log, identityGate: gate });
  const agent = await registry.register({
    name: 'reader',
    role: 'role:agent',
    capabilities: ['action:read-registry'],
  });
  // الوكيل يزعم أنه ملك ويطلب فعلاً سيادياً؛ الزعم يُستبدل بدوره الحقيقي فيُرفض.
  const result = await point.authorize({
    actor: {
      id: agent.id,
      kind: /** @type {const} */ ('autonomous'),
      role: 'role:king',
      state: 'active',
      capabilities: ['action:stop-state'],
    },
    action: 'stop-state',
    resource: { type: 'state', id: 'root' },
    context: {},
  });
  assert.equal(result.decision.allowed, false, 'مطالبةٌ بدورٍ ليس دوره لا تُصدَّق');
});

test('the gate refuses to exist without registry, ca and catalog', () => {
  assert.throws(() => new IdentityGate({}), /IDENTITY_GATE_DEPENDENCY_MISSING/);
});
