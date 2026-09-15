// اختباراتُ عميلِ إثباتِ الحيازةِ وصياغتِه المشتركةِ — `WL-179` (إغلاقُ `LIVE-1`).
//
// **ما تقيسه:** أنّ ما يُوقِّعُه العميلُ **يقبلُه المُتحقِّقُ نفسُه** بلا تلييِنٍ،
// وأنّ الصياغةَ المشتركةَ هي عينُها التي يبنيها الخادمُ (‏فلا مصدرانِ للحقيقةِ)،
// **وأنّ الحمايةَ لم تُثقَبْ بوجودِ العميلِ**: نداءٌ بلا توقيعٍ يُرَدُّ، وتوقيعٌ
// مُعادٌ يُرَدُّ، وتوقيعٌ لنداءٍ يُنقَلُ إلى نداءٍ آخرَ يُرَدُّ.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, createHash } from 'node:crypto';
import path from 'node:path';

import { ApiGateway } from '../../src/api/gateway.mjs';
import { SESSION_ERRORS } from '../../src/api/session-store.mjs';
import { createPoPClient } from '../../src/api/pop-client.mjs';
import {
  canonicalCallPayload,
  canonicalOpenPayload,
  popMessage,
} from '../../src/api/pop-canonical.mjs';
import { EventLog } from '../../src/root-of-trust/index.mjs';
import { loadApiPolicy } from '../../src/api/index.mjs';
import { loadMonitoringPolicy, MonitorAgent } from '../../src/observability/index.mjs';
import { enforcementPointFor } from '../helpers/authorization.mjs';
import { createMemoryRepositories } from '../../src/persistence/composition.mjs';

const CONFIG_DIR = path.join(process.cwd(), 'config');
const MONITORING_ROLE = loadMonitoringPolicy({ dir: CONFIG_DIR }).role;
const AUDITOR = 'agent:auditor';
const ROUTE = 'state.agents.list';

/** @returns {Record<string, unknown>} وكيلٌ نشطٌ بدورٍ صالحٍ. */
function activeAgent() {
  return Object.freeze({
    role: MONITORING_ROLE,
    state: 'active',
    capabilities: Object.freeze([
      'action:read-registry',
      'action:read-memory',
      'action:read-audit',
    ]),
  });
}

/** @returns {{ gateway: ApiGateway }} بوابةٌ تُلزِمُ إثباتَ الحيازةِ. */
function popGateway() {
  const log = new EventLog();
  const agents = {
    get: async (/** @type {string} */ id) => (id === AUDITOR ? activeAgent() : null),
  };
  const monitor = new MonitorAgent({
    policy: loadMonitoringPolicy({ dir: CONFIG_DIR }),
    repositories: createMemoryRepositories(),
    agents: /** @type {never} */ (agents),
    log: /** @type {never} */ (log),
  });
  const gateway = new ApiGateway({
    policy: loadApiPolicy({ dir: CONFIG_DIR }),
    log: /** @type {never} */ (log),
    agents,
    monitor,
    enforcementPoint: enforcementPointFor(log),
    requirePoP: true,
  });
  return { gateway };
}

/** @returns {{ client: ReturnType<typeof createPoPClient>, publicKeyPem: string }} مُوقِّعٌ بمفتاحٍ لحظيٍّ. */
function signer() {
  const pair = generateKeyPairSync('ed25519');
  return {
    client: createPoPClient({ privateKey: pair.privateKey }),
    publicKeyPem: /** @type {string} */ (pair.publicKey.export({ type: 'spki', format: 'pem' })),
  };
}

/**
 * @param {ApiGateway} gateway
 * @returns {{ id: string, method: string, path: string, action: string, resource: string }} وصفُ المسارِ المُعلَنِ.
 */
function routeSpecOf(gateway) {
  const spec = gateway.routes().find((route) => route.id === ROUTE);
  assert.ok(spec !== undefined, `المسارُ ${ROUTE} غيرُ مُعلَنٍ`);
  return spec;
}

test('العميلُ بلا مفتاحٍ خاصٍّ لا يُنشَأُ — ولا يُوقِّعُ بلا حيازةٍ', () => {
  assert.throws(() => createPoPClient(/** @type {never} */ ({})), TypeError);
});

test('الصياغةُ المشتركةُ: حمولةُ النداءِ هي ذاتُ الحقولِ بذاتِ الترتيبِ وبهضمِ المعاملاتِ', () => {
  const route = {
    method: 'GET',
    path: '/state/agents',
    action: 'action:read',
    resource: 'r:agents',
  };
  const digest = createHash('sha256')
    .update(JSON.stringify({ limit: 2 }))
    .digest('base64url');
  assert.equal(
    canonicalCallPayload(route, 'sid-1', { limit: 2 }),
    `GET|/state/agents|action:read|r:agents|sid-1|${digest}`,
  );
  // معاملاتٌ غائبةٌ تُهضَمُ كالكائنِ الفارغِ لا تُحذَفُ من الرسالةِ.
  const emptyDigest = createHash('sha256').update('{}').digest('base64url');
  assert.ok(canonicalCallPayload(route, 'sid-1', undefined).endsWith(`|${emptyDigest}`));
  assert.equal(canonicalOpenPayload('agent:x'), 'open:agent:x');
  assert.equal(popMessage('p', 't', 'n'), 'p|t|n');
});

test('فتحُ الجلسةِ بتوقيعِ العميلِ يُقبَلُ، وبلا توقيعٍ يُرَدُّ بـPOP_REQUIRED', async () => {
  const { gateway } = popGateway();
  const { client, publicKeyPem } = signer();
  gateway.registerPoPKey(AUDITOR, publicKeyPem);

  const session = await gateway.openSession(client.signOpen(AUDITOR));
  assert.ok(typeof session.token === 'string' && session.token.length > 0);

  await assert.rejects(
    () => gateway.openSession({ actorId: AUDITOR }),
    (/** @type {{ code?: string }} */ error) => error.code === SESSION_ERRORS.POP_REQUIRED,
  );
});

test('نداءٌ بتوقيعِ العميلِ يُقبَلُ، وإعادةُ التوقيعِ نفسِه تُرَدُّ بـPOP_REPLAY', async () => {
  const { gateway } = popGateway();
  const { client, publicKeyPem } = signer();
  gateway.registerPoPKey(AUDITOR, publicKeyPem);
  const session = await gateway.openSession(client.signOpen(AUDITOR));
  const route = routeSpecOf(gateway);

  const proof = client.signCall({ route, sessionId: session.sessionId, params: {} });
  const result = await gateway.call({
    route: ROUTE,
    params: {},
    token: session.token,
    pop: { signature: proof.signature, timestamp: proof.timestamp, nonce: proof.nonce },
  });
  assert.equal(result.status, 'ok');

  await assert.rejects(
    () =>
      gateway.call({
        route: ROUTE,
        params: {},
        token: session.token,
        pop: { signature: proof.signature, timestamp: proof.timestamp, nonce: proof.nonce },
      }),
    (/** @type {{ code?: string }} */ error) => error.code === SESSION_ERRORS.POP_REPLAY,
  );
});

test('توقيعُ نداءٍ لا يَصلُحُ لنداءٍ آخرَ — الحمولةُ مُلزَمةٌ بالمسارِ والمعاملاتِ', async () => {
  const { gateway } = popGateway();
  const { client, publicKeyPem } = signer();
  gateway.registerPoPKey(AUDITOR, publicKeyPem);
  const session = await gateway.openSession(client.signOpen(AUDITOR));
  const route = routeSpecOf(gateway);

  // وُقِّعَ لمعاملاتٍ، ثمّ نُودِيَ بمعاملاتٍ أخرى.
  const proof = client.signCall({ route, sessionId: session.sessionId, params: { limit: 1 } });
  await assert.rejects(
    () =>
      gateway.call({
        route: ROUTE,
        params: {},
        token: session.token,
        pop: { signature: proof.signature, timestamp: proof.timestamp, nonce: proof.nonce },
      }),
    (/** @type {{ code?: string }} */ error) => error.code === SESSION_ERRORS.POP_INVALID,
  );
});

test('ترويساتُ النقلِ تحملُ الأسماءَ التي يقرأُها الخادمُ لا أسماءً مُخترَعةً', () => {
  const { client } = signer();
  const headers = client.headersFor({ signature: 's', timestamp: 't', nonce: 'n' });
  assert.deepEqual(headers, {
    'x-state-pop-signature': 's',
    'x-state-pop-timestamp': 't',
    'x-state-pop-nonce': 'n',
  });
});
