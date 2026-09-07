import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign, randomUUID, createHash } from 'node:crypto';
import { ApiGateway } from '../../src/api/gateway.mjs';
import { SessionError, SESSION_ERRORS } from '../../src/api/session-store.mjs';
import { EventLog } from '../../src/root-of-trust/index.mjs';
import { loadApiPolicy } from '../../src/api/index.mjs';
import { loadMonitoringPolicy, MonitorAgent } from '../../src/observability/index.mjs';
import { enforcementPointFor } from '../helpers/authorization.mjs';
import { createMemoryRepositories } from '../../src/persistence/composition.mjs';
import path from 'node:path';

const CONFIG_DIR = path.join(process.cwd(), 'config');
const MONITORING_ROLE = loadMonitoringPolicy({ dir: CONFIG_DIR }).role;

const KING = 'agent:king';
const AUDITOR = 'agent:auditor';
const ROUTE = 'state.agents.list';

/** وكيلٌ نشطٌ بدورٍ صالحٍ من سياسةِ المراقبة. */
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

/**
 * يبني بوابةً تُلزمُ إثباتَ الحيازةِ.
 * @param {{ agents?: { get: (id: string) => Promise<Record<string, unknown> | null> } }} [options]
 */
function popGateway({ agents } = {}) {
  const log = new EventLog();
  const resolvedAgents = agents ?? {
    get: async (/** @type {string} */ id) => (id === KING || id === AUDITOR ? activeAgent() : null),
  };
  const monitor = new MonitorAgent({
    policy: loadMonitoringPolicy({ dir: CONFIG_DIR }),
    repositories: createMemoryRepositories(),
    agents: /** @type {never} */ (resolvedAgents),
    log: /** @type {never} */ (log),
  });
  const gateway = new ApiGateway({
    policy: loadApiPolicy({ dir: CONFIG_DIR }),
    log: /** @type {never} */ (log),
    agents: resolvedAgents,
    monitor,
    enforcementPoint: enforcementPointFor(log),
    requirePoP: true,
  });
  return { gateway, log };
}

/** يولِّدُ زوجَ مفاتيحِ Ed25519 ويعيدُ العامَّ بصيغةِ PEM. */
function keyPair() {
  return generateKeyPairSync('ed25519');
}

/** المفتاحُ العامُّ بصيغةِ PEM نصٌّ صريحٌ (إثباتُ الحيازةِ يقبلُ PEM فقط).
 * @param {{ publicKey: import('node:crypto').KeyObject }} kp
 * @returns {string}
 */
function pubPem(kp) {
  return /** @type {string} */ (kp.publicKey.export({ type: 'spki', format: 'pem' }));
}

/**
 * يوقّعُ رسالةً بالمفتاحِ الخاصِّ ويعيدُ التوقيعَ base64url.
 * @param {import('node:crypto').KeyObject} privateKey
 * @param {string} message
 * @returns {string}
 */
function signWith(privateKey, message) {
  return sign(null, Buffer.from(message, 'utf8'), privateKey).toString('base64url');
}

/** يبني طلبَ فتحِ جلسةٍ موقّعًا.
 * @param {string} actorId
 * @param {import('node:crypto').KeyObject} privateKey
 * @param {() => Date} [clock]
 */
function openRequest(actorId, privateKey, clock = () => new Date()) {
  const timestamp = clock().toISOString();
  const nonce = randomUUID();
  const message = `open:${actorId}|${timestamp}|${nonce}`;
  return {
    actorId,
    popTimestamp: timestamp,
    popNonce: nonce,
    popSignature: signWith(privateKey, message),
  };
}

test('GPT-F01: المعرّفُ العامُّ وحدَه لا يفتحُ جلسةً بلا إثباتِ حيازةٍ', async () => {
  const { gateway } = popGateway();
  await gateway.registerPoPKey(AUDITOR, pubPem(keyPair()));
  await assert.rejects(
    gateway.openSession({ actorId: AUDITOR }),
    (err) => err instanceof SessionError && err.code === SESSION_ERRORS.POP_REQUIRED,
    'من عرفَ المعرّفَ العامَّ وحدَه لا يفتحُ جلسةً — الفشلُ مغلقٌ.',
  );
});

test('GPT-F01: فتحُ جلسةٍ بتوقيعٍ صحيحٍ ينجحُ ويربطُ المفتاحَ', async () => {
  const { gateway } = popGateway();
  const kp = keyPair();
  assert.ok(gateway.registerPoPKey(AUDITOR, pubPem(kp)));
  const session = await gateway.openSession(openRequest(AUDITOR, kp.privateKey));
  assert.equal(session.actorId, AUDITOR);
  assert.ok(typeof session.token === 'string' && session.token.length > 0);
});

test('GPT-F01: توقيعٌ بمفتاحٍ آخر لا يفتحُ جلسةَ الفاعلِ', async () => {
  const { gateway } = popGateway();
  const registered = keyPair();
  gateway.registerPoPKey(AUDITOR, pubPem(registered));
  // المهاجمُ يملكُ مفتاحًا آخر ولا يملكُ الخاصَّ المسجَّل.
  const attacker = keyPair();
  await assert.rejects(
    gateway.openSession(openRequest(AUDITOR, attacker.privateKey)),
    (err) => err instanceof SessionError && err.code === SESSION_ERRORS.POP_INVALID,
    'توقيعُ مفتاحٍ غيرِ مسجَّلٍ مرفوضٌ — فمن لا يملكُ الخاصَّ لا يَنْتَحِلُ.',
  );
});

test('Grok-F02: الطلبُ بلا PoP مرفوضٌ حتى لو سُرِقَ الرمزُ', async () => {
  const { gateway } = popGateway();
  const kp = keyPair();
  gateway.registerPoPKey(AUDITOR, pubPem(kp));
  const session = await gateway.openSession(openRequest(AUDITOR, kp.privateKey));
  // الرمزُ مسروقٌ (لدى المهاجمِ) لكنّه لا يملكُ المفتاحَ الخاصَّ.
  await assert.rejects(
    gateway.call({ route: ROUTE, token: session.token }),
    (err) => err instanceof SessionError && err.code === SESSION_ERRORS.POP_REQUIRED,
    'الرمزُ المسروقُ بلا توقيعِ حيازةٍ مرفوضٌ — فالفتحُ لا يكفي.',
  );
});

test('Grok-F02: توقيعٌ صحيحٌ لكلِّ طلبٍ يمرُّ', async () => {
  const { gateway } = popGateway();
  const kp = keyPair();
  gateway.registerPoPKey(AUDITOR, pubPem(kp));
  const session = await gateway.openSession(openRequest(AUDITOR, kp.privateKey));
  const result = await callSigned(gateway, session, ROUTE, {}, kp.privateKey);
  assert.equal(result.status, 'ok');
});

test('Grok-F02: إعادةُ تشغيلِ التوقيعِ (replay) مرفوضةٌ', async () => {
  const { gateway } = popGateway();
  const kp = keyPair();
  gateway.registerPoPKey(AUDITOR, pubPem(kp));
  const session = await gateway.openSession(openRequest(AUDITOR, kp.privateKey));
  const timestamp = new Date().toISOString();
  const nonce = randomUUID();
  const route = gateway.policy.routes.find((r) => r.id === ROUTE);
  if (route === undefined) throw new Error(`مسارٌ غيرُ معروف: ${ROUTE}`);
  const canonical = canonicalPayload(route, session.sessionId, {});
  const message = `${canonical}|${timestamp}|${nonce}`;
  const signature = signWith(kp.privateKey, message);
  // الطلبُ الأوّلُ يمرُّ.
  await gateway.call({
    route: ROUTE,
    token: session.token,
    pop: { signature, timestamp, nonce },
  });
  // نفسُ التوقيعِ وnonce مرفوضٌ ثانيةً.
  await assert.rejects(
    gateway.call({
      route: ROUTE,
      token: session.token,
      pop: { signature, timestamp, nonce },
    }),
    (err) => err instanceof SessionError && err.code === SESSION_ERRORS.POP_REPLAY,
    'التوقيعُ نفسُه لا يُقبلُ مرّتَين — فإعادةُ التشغيلِ مرفوضةٌ.',
  );
});

test('Grok-F02: لا يُعادُ تشغيلُ توقيعٍ بينَ جلستَينِ لنفسِ الفاعلِ', async () => {
  const { gateway } = popGateway();
  const kp = keyPair();
  gateway.registerPoPKey(AUDITOR, pubPem(kp));
  // الفاعلُ يفتحُ جلستَينِ؛ دفترُ nonce لكلِّ جلسةٍ منفصلٌ.
  const first = await gateway.openSession(openRequest(AUDITOR, kp.privateKey));
  const second = await gateway.openSession(openRequest(AUDITOR, kp.privateKey));
  const route = gateway.policy.routes.find((r) => r.id === ROUTE);
  if (route === undefined) throw new Error(`مسارٌ غيرُ معروف: ${ROUTE}`);
  const timestamp = new Date().toISOString();
  const nonce = randomUUID();
  // توقيعٌ مرتبطٌ بمعرّفِ الجلسةِ الأولى لا يصلحُ للثانية.
  const message = `${canonicalPayload(route, first.sessionId, {})}|${timestamp}|${nonce}`;
  const signature = signWith(kp.privateKey, message);
  await assert.rejects(
    gateway.call({
      route: ROUTE,
      token: second.token,
      pop: { signature, timestamp, nonce },
    }),
    (err) => err instanceof SessionError && err.code === SESSION_ERRORS.POP_INVALID,
    'التوقيعُ مرتبطٌ بالجلسةِ؛ فلا يُعادُ تشغيلُه على جلسةٍ أخرى ولو كان الفاعلُ نفسَه.',
  );
});

test('GPT-F01: توقيعٌ لجلسةٍ على حمولةٍ مغايرةٍ مرفوضٌ', async () => {
  const { gateway } = popGateway();
  const kp = keyPair();
  gateway.registerPoPKey(AUDITOR, pubPem(kp));
  const session = await gateway.openSession(openRequest(AUDITOR, kp.privateKey));
  // المهاجمُ يوقّعُ حمولةً مختلفةً ويدّعيها.
  const clock = () => new Date();
  const timestamp = clock().toISOString();
  const nonce = randomUUID();
  const wrongCanonical = 'GET|/wrong|wrong:action|wrong:resource|{}';
  const message = `${wrongCanonical}|${timestamp}|${nonce}`;
  await assert.rejects(
    gateway.call({
      route: ROUTE,
      token: session.token,
      pop: { signature: signWith(kp.privateKey, message), timestamp, nonce },
    }),
    (err) => err instanceof SessionError && err.code === SESSION_ERRORS.POP_INVALID,
    'التوقيعُ على حمولةٍ مغايرةٍ لا يُمرَّرُ — فالحقيقةُ موقّعةٌ لا ادّعاءٌ.',
  );
});

test('التوافقُ مع الإصدارِ: البوابةُ بلا requirePoP لا تُلزمُ إثباتَ حيازةٍ', async () => {
  const log = new EventLog();
  const resolvedAgents = {
    get: async (/** @type {string} */ id) => (id === AUDITOR ? activeAgent() : null),
  };
  const monitor = new MonitorAgent({
    policy: loadMonitoringPolicy({ dir: CONFIG_DIR }),
    repositories: createMemoryRepositories(),
    agents: /** @type {never} */ (resolvedAgents),
    log: /** @type {never} */ (log),
  });
  const gateway = new ApiGateway({
    policy: loadApiPolicy({ dir: CONFIG_DIR }),
    log: /** @type {never} */ (log),
    agents: resolvedAgents,
    monitor,
    enforcementPoint: enforcementPointFor(log),
    // requirePoP غائبٌ افتراضيًا → التوافقُ مع الإصدارِ.
  });
  const session = await gateway.openSession({ actorId: AUDITOR });
  const result = await gateway.call({ route: ROUTE, token: session.token });
  assert.equal(result.status, 'ok');
});

/**
 * الحمولةُ المتّفَقُ عليها — مطابقةٌ لِما تبنيهُ البوابةُ داخلًا: تضمُّ معرّفَ
 * الجلسةِ كي يُربطَ التوقيعُ بجلسةٍ بعينِها، وتُهضَمُ المعاملاتُ بـsha256.
 * @param {{ method: string, path: string, action: string, resource: string }} route
 * @param {string} sessionId
 * @param {Record<string, unknown>} params
 * @returns {string}
 */
function canonicalPayload(route, sessionId, params) {
  const digest = createHash('sha256')
    .update(JSON.stringify(params ?? {}))
    .digest('base64url');
  return [route.method, route.path, route.action, route.resource, sessionId, digest].join('|');
}

/**
 * يبني طلبًا موقّعًا وينادي البوابةَ.
 * @param {ApiGateway} gateway
 * @param {{ token: string, sessionId: string }} session
 * @param {string} routeId
 * @param {Record<string, unknown>} params
 * @param {import('node:crypto').KeyObject} privateKey
 */
async function callSigned(gateway, session, routeId, params, privateKey) {
  const route = gateway.policy.routes.find((r) => r.id === routeId);
  if (route === undefined) throw new Error(`مسارٌ غيرُ معروف: ${routeId}`);
  const canonical = canonicalPayload(route, session.sessionId, params);
  const timestamp = new Date().toISOString();
  const nonce = randomUUID();
  const message = `${canonical}|${timestamp}|${nonce}`;
  return gateway.call({
    route: routeId,
    token: session.token,
    params,
    pop: { signature: signWith(privateKey, message), timestamp, nonce },
  });
}
