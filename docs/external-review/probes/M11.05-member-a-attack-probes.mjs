import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import process from 'node:process';

import { ApiGateway, API_ERRORS } from '../../../src/api/gateway.mjs';
import { loadPolicyBundle } from '../../../src/policy/loader.mjs';
import { createPolicyDecisionPoint } from '../../../src/policy/engine.mjs';
import { EnforcementPoint } from '../../../src/policy/enforcement-point.mjs';
import { createEgressGate, EGRESS_ERRORS } from '../../../src/egress/egress-gate.mjs';
import {
  KingAuthenticator,
  AUTHN_ERRORS,
  factorCodeForStep,
  loadKingAuthPolicy,
} from '../../../src/authn/king-auth.mjs';
import {
  KingIdentity,
  CertificateAuthority,
  CrownGateway,
  EventLog,
  createRoyalCommand,
} from '../../../src/root-of-trust/index.mjs';
import { loadCapabilityCatalog } from '../../../src/identity/capability-catalog.mjs';
import { CapabilityGrantLedger } from '../../../src/identity/capability-grants.mjs';
import { IncidentRegister } from '../../../src/identity/incident-register.mjs';

const observations = [];
const memoryLog = () => ({
  events: [],
  append(type, actor, payload) {
    this.events.push({ type, actor, payload });
  },
});
async function rejected(name, expected, operation) {
  try {
    await operation();
    observations.push({ name, outcome: 'ATTACK_SUCCEEDED', code: null });
    return false;
  } catch (error) {
    const code = error?.code ?? error?.message ?? String(error);
    observations.push({
      name,
      outcome: code === expected ? 'REJECTED_AS_EXPECTED' : 'REJECTED_UNEXPECTEDLY',
      code,
    });
    return code === expected;
  }
}

// 1) سطح الواجهة: نداء مسار معلن بلا جلسة.
{
  const log = memoryLog();
  const gateway = new ApiGateway({
    log,
    agents: { get: async () => null },
    monitor: null,
    enforcementPoint: null,
  });
  const route = gateway.routes()[0].id;
  assert.equal(
    await rejected('api-no-session', API_ERRORS.AUTH_REQUIRED, () => gateway.call({ route })),
    true,
  );
}

// 2) بوابة الخروج: وجهة غير معلنة، مع عداد يثبت أن الناقل لم يُمس.
{
  const log = memoryLog();
  let transportCalls = 0;
  const point = new EnforcementPoint({
    decisionPoint: createPolicyDecisionPoint({ bundle: loadPolicyBundle() }),
    log,
    requireIdentityGate: false,
  });
  const gate = createEgressGate({
    enforcementPoint: point,
    log,
    destinations: [
      {
        id: 'federation:archive',
        uri: 'https://archive.federation.example/ingest',
        purpose: 'archive',
      },
    ],
    transport: async () => {
      transportCalls += 1;
      return { status: 202 };
    },
  });
  assert.equal(
    await rejected('egress-unknown-destination', EGRESS_ERRORS.DESTINATION_UNKNOWN, () =>
      gate.send({
        actor: { id: 'agent:minister-1', role: 'role:minister', kind: 'human', state: 'active' },
        destination: 'attacker:dropbox',
        payload: 'one-byte-attempt',
        classification: 'internal',
      }),
    ),
    true,
  );
  assert.equal(transportCalls, 0);
}

// 3a) مصادقة الملك: إعادة رمز العامل نفسه في الخطوة الزمنية نفسها.
{
  const nowMs = Date.UTC(2026, 8, 19, 5, 0, 0);
  const policy = loadKingAuthPolicy();
  const trusted = policy.devices.find((device) => device.state === 'trusted');
  assert.ok(trusted);
  const secret = randomBytes(32).toString('hex');
  const auth = new KingAuthenticator({
    policy,
    king: { id: 'king:probe' },
    log: memoryLog(),
    factorSecrets: { read: async () => secret },
    nowMs: () => nowMs,
  });
  const code = factorCodeForStep({
    secret,
    step: Math.floor(nowMs / 1000 / policy.secondFactor.stepSeconds),
    digits: policy.secondFactor.digits,
    algorithm: policy.secondFactor.algorithm,
  });
  await auth.authenticate({ actorId: 'king:probe', deviceId: trusted.id, factorCode: code });
  assert.equal(
    await rejected('king-factor-replay', AUTHN_ERRORS.FACTOR_REPLAYED, () =>
      auth.authenticate({
        actorId: 'king:probe',
        deviceId: trusted.id,
        factorCode: code,
      }),
    ),
    true,
  );
}

// 3b) أمر سيادي: توقيع مزور، ثم إعادة أمر صحيح سبق قبوله.
{
  const king = new KingIdentity();
  const crown = new CrownGateway(king, new CertificateAuthority(king), new EventLog());
  const command = createRoyalCommand('sovereign-recovery-probe', 'state:sovereign', {});
  assert.equal(
    await rejected('royal-command-forged-signature', 'INVALID_ROYAL_SIGNATURE', () =>
      crown.command(command, 'forged-signature'),
    ),
    true,
  );
  const signature = king.sign(command);
  crown.command(command, signature);
  assert.equal(
    await rejected('royal-command-replay', 'REPLAYED_COMMAND', () =>
      crown.command(command, signature),
    ),
    true,
  );
}

// 4) عزل الوكلاء/التواطؤ: مانح وزير ووكيل مستفيد يحاولان منح قدرة محرمة، ثم منح ذاتي.
{
  const log = new EventLog();
  const catalog = loadCapabilityCatalog();
  const incidents = new IncidentRegister({ log });
  const ledger = new CapabilityGrantLedger({ catalog, log, incidents });
  assert.equal(
    await rejected('collusive-forbidden-capability', 'FORBIDDEN_CAPABILITY', () =>
      ledger.grant({
        agentId: 'agent:worker',
        capability: 'sovereign:root',
        reason: 'collusion probe',
        principal: { id: 'agent:minister', role: 'role:minister', state: 'active' },
        ttlSeconds: 60,
      }),
    ),
    true,
  );
  assert.equal(
    await rejected('agent-self-grant', 'CAPABILITY_SELF_GRANT_FORBIDDEN', () =>
      ledger.grant({
        agentId: 'agent:self',
        capability: 'action:read-registry',
        reason: 'self escalation probe',
        principal: { id: 'agent:self', role: 'role:minister', state: 'active' },
        ttlSeconds: 60,
      }),
    ),
    true,
  );
  assert.equal(ledger.capabilitiesOf('agent:worker').size, 0);
  assert.equal(ledger.capabilitiesOf('agent:self').size, 0);
}

process.stdout.write(`${JSON.stringify({ probe: 'M11.05-member-a', observations }, null, 2)}\n`);
