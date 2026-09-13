/**
 * اختبارُ بابِ الدولةِ — سدادُ الدَينِ `D-1`.
 *
 * الدعوى المقيسةُ هنا جملتانِ، وكلُّ واحدةٍ تفشلُ وحدَها إن انكسرتْ:
 *
 * 1. **صارَ للدولةِ بابٌ:** نداءٌ HTTP حقيقيٌّ على مقبسٍ حقيقيٍّ يَرجعُ ببياناتٍ
 *    من مستودعٍ حقيقيٍّ عبرَ بوابةٍ حقيقيّةٍ. لا مُزيَّفَ في الطريقِ، لأنّ اختباراً
 *    على مُزيَّفٍ يُثبِتُ أنّ الشفرةَ تُنادي المُزيَّفَ لا أنّها محكومةٌ.
 * 2. **ولم يَزِدِ البابُ سلطةً:** العقباتُ الخمسُ في موضعِها — بلا رمزِ جلسةٍ
 *    `401`، وبدورٍ بلا قدرةٍ `403` بقرارِ نقطةِ التفويضِ لا بحكمِ النقلِ، وما لم
 *    تُعلِنْه `config/api.yaml` `404`، وكلُّ فعلٍ غيرِ `GET` `405`.
 *
 * ومعهما ما يَسهُلُ أن يُكتَبَ خطأً في كلِّ خادمٍ يُكتَبُ يداً: تفضيلُ المقطعِ
 * الحرفيِّ على المُتغيِّرِ (`/state/agents/count` لا يُقرأُ معرّفَ هويّةٍ)،
 * والخروجُ من جذرِ الملفّاتِ بترميزٍ، ورمزُ جلسةٍ يُقبَلُ من مُلحقِ استعلامٍ.
 */

import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import path from 'node:path';
import test from 'node:test';

import { API_ERRORS, ApiGateway, loadApiPolicy } from '../../src/api/index.mjs';
import { CONSOLE_ERRORS, ConsoleError, loadConsolePolicy } from '../../src/console/index.mjs';
import { MonitorAgent, loadMonitoringPolicy } from '../../src/observability/index.mjs';
import { createMemoryRepositories } from '../../src/persistence/composition.mjs';
import { EventLog } from '../../src/root-of-trust/index.mjs';
import {
  STATUS_BY_CODE,
  TRANSPORT_ERRORS,
  compileCommandRoutes,
  compileRoutes,
  createStateServer,
  matchRoute,
  resolveStaticFile,
} from '../../src/transport/index.mjs';
import { enforcementPointFor } from '../helpers/authorization.mjs';

// `fetch` عالميٌّ في Node 20 وليس في قائمةِ العوالمِ المُعلَنةِ لأداةِ التدقيقِ؛
// فيُقرأُ من `globalThis` صراحةً بدلَ توسيعِ إعداداتِ التدقيقِ لأجلِ ملفٍّ واحدٍ.
const { fetch } = globalThis;

const CONFIG_DIR = path.join(process.cwd(), 'config');
const API_POLICY = loadApiPolicy({ dir: CONFIG_DIR });
const MONITORING_POLICY = loadMonitoringPolicy({ dir: CONFIG_DIR });
const ROUTES = compileRoutes({ policy: API_POLICY });
const CONSOLE_POLICY = loadConsolePolicy({ dir: CONFIG_DIR });
const COMMAND_ROUTES = compileCommandRoutes({ policy: CONSOLE_POLICY });

const AUDITOR = 'agent:transport-auditor';
const KING = 'human:transport-king';

/** دولةٌ مصغَّرةٌ ببوابةٍ حقيقيّةٍ على مكوّناتٍ حقيقيّةٍ — نفسُ تركيبِ `tests/api`. */
function realGateway() {
  const log = new EventLog();
  const repositories = createMemoryRepositories();
  /** @type {Record<string, Record<string, unknown>>} */
  const identities = {
    [AUDITOR]: {
      id: AUDITOR,
      kind: 'service',
      state: 'active',
      role: MONITORING_POLICY.role,
      capabilities: ['action:read-registry', 'action:read-memory', 'action:read-audit'],
    },
    // الملكُ ليس مأذوناً بفعلِ `read-registry` في `config/policies.yaml`: فهو
    // حالةُ المنعِ المركزيِّ الحقيقيّةُ لا حالةٌ مُختلَقةٌ.
    [KING]: {
      id: KING,
      kind: 'human',
      state: 'active',
      role: 'role:king',
      capabilities: ['sovereign:command'],
    },
  };
  const agents = { get: async (/** @type {string} */ id) => identities[id] ?? null };
  const monitor = new MonitorAgent({
    policy: MONITORING_POLICY,
    repositories,
    agents: /** @type {never} */ (agents),
    log: /** @type {never} */ (log),
  });
  const gateway = new ApiGateway({
    policy: API_POLICY,
    log,
    agents,
    monitor,
    enforcementPoint: enforcementPointFor(log),
  });
  return { gateway, log };
}

/**
 * يُشغِّلُ خادماً على منفذٍ يختارُه النظامُ، ويُغلِقُه بعدَ العملِ حتماً.
 * @param {{ gateway: unknown, webDir?: string | null, console?: unknown, commandRoutes?: unknown }} options
 * @param {(base: string) => Promise<void>} work
 */
async function serving(options, work) {
  const server = createStateServer(/** @type {never} */ (options));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(undefined)));
  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;
  try {
    await work(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve) => server.close(() => resolve(undefined)));
  }
}

test('نداءٌ HTTP حقيقيٌّ يَرجعُ ببياناتٍ من الدولةِ — وهذا نصُّ الدَينِ `D-1`', async () => {
  const { gateway } = realGateway();
  const session = await gateway.openSession({ actorId: AUDITOR });
  await serving({ gateway }, async (base) => {
    const response = await fetch(`${base}/state/agents`, {
      headers: { authorization: `Bearer ${session.token}` },
    });
    assert.equal(response.status, 200);
    const body = /** @type {Record<string, unknown>} */ (await response.json());
    assert.equal(body.route, 'state.agents.list');
    assert.equal(body.status, 'ok');
    assert.ok('data' in body, 'ردٌّ بلا بياناتٍ ليس قراءةً');
    // ولا تُخزَّنُ بياناتُ الدولةِ في وسيطٍ ولا متصفِّحٍ.
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  });
});

test('بلا رمزِ جلسةٍ يُرَدُّ `401` — والعقبةُ الثانيةُ في موضعِها', async () => {
  const { gateway, log } = realGateway();
  await serving({ gateway }, async (base) => {
    const response = await fetch(`${base}/state/agents`);
    assert.equal(response.status, 401);
    assert.equal(
      /** @type {Record<string, unknown>} */ (await response.json()).code,
      API_ERRORS.AUTH_REQUIRED,
    );
  });
  // والرفضُ مُسجَّلٌ في سجلِّ الأحداثِ: رفضٌ لا أثرَ له لا يُعرَفُ أنّ صاحبَه حاولَ.
  assert.ok(
    /** @type {ReadonlyArray<{ type: string, data: Record<string, unknown> }>} */ (
      log.snapshot()
    ).some(
      (entry) =>
        entry.type === API_POLICY.audit.refusalEvent &&
        entry.data['code'] === API_ERRORS.AUTH_REQUIRED,
    ),
    'مرَّ الرفضُ على السلكِ ولم يُقيَّدْ',
  );
});

test('دورٌ بلا قدرةٍ يُرَدُّ `403` بقرارِ نقطةِ التفويضِ لا بحكمِ النقلِ', async () => {
  const { gateway } = realGateway();
  const session = await gateway.openSession({ actorId: KING });
  await serving({ gateway }, async (base) => {
    const response = await fetch(`${base}/state/cases`, {
      headers: { authorization: `Bearer ${session.token}` },
    });
    assert.equal(response.status, 403);
    assert.equal(
      /** @type {Record<string, unknown>} */ (await response.json()).code,
      API_ERRORS.AUTHORIZATION_DENIED,
    );
  });
});

test('عنوانٌ لم تُعلِنْه الوثيقةُ يُرَدُّ `404` ولو كان معقولاً', async () => {
  const { gateway } = realGateway();
  await serving({ gateway }, async (base) => {
    // ولا `/state/agents/../laws` هنا عن قصدٍ: `URL` يُسوّي الصعودَ قبلَ المطابقةِ
    // فيصيرُ `/state/laws` وهو مسارٌ مُعلَنٌ فعلاً، فرَدُّه `401` لا `404`.
    for (const attempt of ['/state/secrets', '/state/agents/x/y', '/admin', '/state']) {
      const response = await fetch(`${base}${attempt}`);
      assert.equal(response.status, 404, `مرَّ عنوانٌ غيرُ مُعلَنٍ: ${attempt}`);
      assert.equal(
        /** @type {Record<string, unknown>} */ (await response.json()).code,
        TRANSPORT_ERRORS.ROUTE_UNKNOWN,
      );
    }
  });
});

test('كلُّ فعلٍ غيرِ `GET` يُرَدُّ `405` — والطبقةُ قارئةٌ فقط', async () => {
  const { gateway } = realGateway();
  await serving({ gateway }, async (base) => {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      const response = await fetch(`${base}/state/agents`, { method });
      assert.equal(response.status, 405, `مرَّ فعلٌ كاتبٌ: ${method}`);
    }
  });
});

test('جسمُ طلبٍ في قراءةٍ يُرَدُّ لا يُهمَلُ', async () => {
  const { gateway } = realGateway();
  await serving({ gateway }, async (base) => {
    // `fetch` يمنعُ جسماً مع `GET` ويُسقِطُ `content-length`، فلا يَقيسُ هذا
    // الشرطَ أصلاً. فيُرسَلُ الطلبُ بعميلٍ خامٍ كي يكونَ المقيسُ ما يُدَّعى.
    const target = new URL(`${base}/state/agents`);
    const status = await new Promise((resolve, reject) => {
      const request = httpRequest(
        {
          hostname: target.hostname,
          port: target.port,
          path: target.pathname,
          method: 'GET',
          headers: { 'content-length': '12', 'content-type': 'application/json' },
        },
        (response) => {
          response.resume();
          resolve(response.statusCode);
        },
      );
      request.on('error', reject);
      request.end('{"a":"bc"}\r\n');
    });
    assert.equal(status, 400);
  });
});

test('رمزُ الجلسةِ لا يُقبَلُ من مُلحقِ استعلامٍ — فالمُلحقاتُ تُكتَبُ في السجلّاتِ', async () => {
  const { gateway } = realGateway();
  const session = await gateway.openSession({ actorId: AUDITOR });
  await serving({ gateway }, async (base) => {
    const response = await fetch(`${base}/state/agents?token=${session.token}`);
    assert.notEqual(response.status, 200);
    assert.equal(
      /** @type {Record<string, unknown>} */ (await response.json()).code,
      TRANSPORT_ERRORS.BODY_NOT_ALLOWED,
    );
  });
});

test('إثباتُ الحيازةِ يُحمَلُ على السلكِ — وبلا حملِه لا تُخاطَبُ البوابةُ الرسميُّةُ', async () => {
  // التركيبُ الرسميُّ يُركِّبُ البوابةَ بـ`requirePoP: true`، فيُقاسُ النقلُ على
  // ما سيُخاطِبُه فعلاً لا على تركيبٍ أسهلَ.
  const log = new EventLog();
  const repositories = createMemoryRepositories();
  const identity = {
    id: AUDITOR,
    kind: 'service',
    state: 'active',
    role: MONITORING_POLICY.role,
    capabilities: ['action:read-registry', 'action:read-memory', 'action:read-audit'],
  };
  const agents = { get: async (/** @type {string} */ id) => (id === AUDITOR ? identity : null) };
  const monitor = new MonitorAgent({
    policy: MONITORING_POLICY,
    repositories,
    agents: /** @type {never} */ (agents),
    log: /** @type {never} */ (log),
  });
  const gateway = new ApiGateway({
    policy: API_POLICY,
    log,
    agents,
    monitor,
    enforcementPoint: enforcementPointFor(log),
    requirePoP: true,
  });
  const keys = generateKeyPairSync('ed25519');
  const publicKeyPem = keys.publicKey.export({ type: 'spki', format: 'pem' }).toString();
  await gateway.registerPoPKey(AUDITOR, publicKeyPem);
  /** @param {string} message */
  const signature = (message) =>
    sign(null, Buffer.from(message, 'utf8'), keys.privateKey).toString('base64url');
  const openStamp = new Date().toISOString();
  const openNonce = randomUUID();
  const session = await gateway.openSession(
    /** @type {never} */ ({
      actorId: AUDITOR,
      popTimestamp: openStamp,
      popNonce: openNonce,
      popSignature: signature(`open:${AUDITOR}|${openStamp}|${openNonce}`),
    }),
  );

  const route = API_POLICY.routes.find((candidate) => candidate.id === 'state.agents.list');
  assert.ok(route !== undefined);
  const digest = createHash('sha256').update(JSON.stringify({})).digest('base64url');
  const payload = [
    route.method,
    route.path,
    route.action,
    route.resource,
    session.sessionId,
    digest,
  ].join('|');

  await serving({ gateway }, async (base) => {
    // أوّلاً: بلا ترويساتِ الإثباتِ يُرَدُّ — فالشرطُ ليس مُسقَطاً في النقلِ.
    const bare = await fetch(`${base}/state/agents`, {
      headers: { authorization: `Bearer ${session.token}` },
    });
    assert.notEqual(bare.status, 200, 'مرَّتْ قراءةٌ بلا إثباتِ حيازةٍ على تركيبٍ يُلزِمُه');

    // وثانياً: بإثباتٍ موقَّعٍ تمرُّ القراءةُ — فالحقولُ محمولةٌ لا مُلقاةٌ.
    const stamp = new Date().toISOString();
    const nonce = randomUUID();
    const proven = await fetch(`${base}/state/agents`, {
      headers: {
        authorization: `Bearer ${session.token}`,
        'x-state-pop-signature': signature(`${payload}|${stamp}|${nonce}`),
        'x-state-pop-timestamp': stamp,
        'x-state-pop-nonce': nonce,
      },
    });
    assert.equal(proven.status, 200, 'إثباتٌ موقَّعٌ ومع ذلك رُدَّتِ القراءةُ');
    assert.equal(
      /** @type {Record<string, unknown>} */ (await proven.json()).route,
      'state.agents.list',
    );
  });
});

test('جدولُ المساراتِ مُشتَقٌّ من الوثيقةِ حرفاً بحرفٍ لا مكتوبٌ يداً', () => {
  assert.equal(ROUTES.length, API_POLICY.routes.length);
  const declared = new Set(API_POLICY.routes.map((route) => route.id));
  for (const route of ROUTES) {
    assert.ok(declared.has(route.id), `مسارٌ في الجدولِ لا وجودَ له في الوثيقةِ: ${route.id}`);
    const matched = matchRoute(
      ROUTES,
      'GET',
      route.path.replace(/:([A-Za-z0-9_]+)/g, 'قيمةٌ-اختباريّةٌ'),
    );
    assert.ok(matched !== null, `مسارٌ مُعلَنٌ لا يُطابَقُ: ${route.path}`);
  }
});

test('المقطعُ الحرفيُّ يسبقُ المُتغيِّرَ — وإلا قُرِئَ `count` معرّفَ هويّةٍ', () => {
  const matched = matchRoute(ROUTES, 'GET', '/state/agents/count');
  assert.ok(matched !== null);
  assert.equal(matched.route.id, 'state.agents.count');
  const byId = matchRoute(ROUTES, 'GET', '/state/agents/agent%3Ax');
  assert.ok(byId !== null);
  assert.equal(byId.route.id, 'state.agents.get');
  assert.equal(byId.pathParams['id'], 'agent:x');
});

test('كلُّ رمزِ رفضٍ في البوابةِ له ترجمةٌ مُعلَنةٌ — والخريطةُ لا تُترَكُ ناقصةً', () => {
  for (const code of Object.values(API_ERRORS)) {
    assert.ok(
      Object.prototype.hasOwnProperty.call(STATUS_BY_CODE, code),
      `رمزُ رفضٍ بلا ترجمةٍ في طبقةِ النقلِ: ${code} — ورفضٌ بلا ترجمةٍ يُسلَّمُ بحالةٍ مخمَّنةٍ.`,
    );
  }
  for (const code of Object.values(TRANSPORT_ERRORS)) {
    assert.ok(Object.prototype.hasOwnProperty.call(STATUS_BY_CODE, code), `بلا ترجمةٍ: ${code}`);
  }
  for (const code of Object.values(CONSOLE_ERRORS)) {
    assert.ok(
      Object.prototype.hasOwnProperty.call(STATUS_BY_CODE, code),
      `رمزُ رفضِ ديوانٍ بلا ترجمةٍ: ${code}`,
    );
  }
  // ولا ترجمةَ لرمزٍ لا وجودَ له: خريطةٌ فيها زائدٌ خريطةٌ لِما لا يُرَدُّ.
  const known = /** @type {Set<string>} */ (
    new Set([
      ...Object.values(API_ERRORS),
      ...Object.values(TRANSPORT_ERRORS),
      ...Object.values(CONSOLE_ERRORS),
    ])
  );
  for (const code of Object.keys(STATUS_BY_CODE)) {
    assert.ok(known.has(code), `ترجمةٌ لرمزٍ غيرِ مُعلَنٍ: ${code}`);
  }
});

test('لا خروجَ من جذرِ ملفّاتِ الواجهةِ ولو بترميزٍ', () => {
  const root = path.join(process.cwd(), 'web');
  for (const attempt of [
    '/../package.json',
    '/%2e%2e/package.json',
    '/..%2fpackage.json',
    '/subdir/../../package.json',
  ]) {
    assert.equal(resolveStaticFile(root, attempt), null, `عبرَ الجذرَ: ${attempt}`);
  }
  // وامتدادٌ غيرُ مُعلَنٍ لا يُخدَمُ ولو كان الملفُّ تحتَ الجذرِ.
  assert.equal(resolveStaticFile(process.cwd(), '/package.json'), null);
});

test('لا خادمَ بلا بوابةٍ — فشلٌ مُغلَقٌ عندَ التركيبِ لا `503` عندَ كلِّ نداءٍ', () => {
  assert.throws(
    () => createStateServer(/** @type {never} */ ({ gateway: null })),
    (error) => {
      assert.equal(/** @type {{ code: string }} */ (error).code, TRANSPORT_ERRORS.GATEWAY_REQUIRED);
      return true;
    },
  );
});

// ═══════════════════════════════════════════════════════════════
// مسارُ الكتابةِ السياديّةِ المُوقَّعةِ — سدادُ باقي `D-1` (`M9.03` عبر النقل)
// ═══════════════════════════════════════════════════════════════

/** ديوانٌ مُتَتبِّعٌ يسجِّلُ النداءاتِ ويُعيدُ نتيجةً أو يرمي خطأً. */
/**
 * @param {(() => Promise<Record<string, unknown>>) | Record<string, unknown>} behavior
 */
function trackingConsole(behavior) {
  /** @type {Array<{ command: string, royalCommand: unknown, signature: string, sovereignSession?: string }>} */
  const calls = [];
  return {
    calls,
    /** @param {{ command: string, royalCommand: unknown, signature: string, sovereignSession?: string }} request */
    issue: async (request) => {
      calls.push(request);
      if (typeof behavior === 'function') return behavior();
      return behavior;
    },
  };
}

/** نتيجةُ أمرٍ ناجحٍ ثابتةٌ. */
const SUCCESS_RESULT = Object.freeze({
  command: 'cmd:halt',
  action: 'stop-state',
  kind: 'halt',
  path: 'crown',
  commandId: 'test-command-id',
  acceptedAt: '2026-01-01T00:00:00.000Z',
  status: 'executed',
  effect: Object.freeze({ state: 'halted', epoch: 1, reason: 'test' }),
});

test('مساراتُ الكتابةِ مُشتَقّةٌ من `config/royal-console.yaml` وحدَها', () => {
  assert.ok(COMMAND_ROUTES.length > 0, 'لا مساراتِ كتابةٍ مُشتَقّةٍ.');
  for (const route of COMMAND_ROUTES) {
    assert.equal(route.method, 'POST', `مسارُ كتابةٍ بفعلٍ غيرِ POST: ${route.id}`);
    assert.ok(route.path.startsWith('/state/console/'), `مسارٌ خارجَ الديوانِ: ${route.path}`);
  }
  // كلُّ أمرٍ مُعلَنٍ له مسارٌ، وكلُّ مسارٍ له أمرٌ.
  const commandIds = new Set(CONSOLE_POLICY.commands.map((c) => c.id));
  const routeIds = new Set(COMMAND_ROUTES.map((r) => r.id));
  assert.deepEqual(
    [...commandIds].sort(),
    [...routeIds].sort(),
    'الأوامرُ والمساراتُ غيرُ متطابقةٍ.',
  );
});

test('كلُّ أمرٍ مُعلَنٍ يُخدَمُ على مقبسٍ حقيقيٍّ عبر النقلِ', async () => {
  const { gateway } = realGateway();
  const console_ = trackingConsole(SUCCESS_RESULT);
  await serving({ gateway, console: console_, commandRoutes: COMMAND_ROUTES }, async (base) => {
    for (const command of CONSOLE_POLICY.commands) {
      const path = `/state/console/${command.action}`;
      const response = await fetch(`${base}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          royalCommand: {
            id: 'test',
            action: command.action,
            target: command.target,
            payload: {},
            issuedAt: new Date().toISOString(),
          },
          signature: 'test-signature',
          sovereignSession: 'test-session',
        }),
      });
      assert.equal(response.status, 200, `أمرٌ مُعلَنٌ رُدَّ: ${command.id} → ${response.status}`);
      const body = /** @type {Record<string, unknown>} */ (await response.json());
      assert.equal(body.status, 'executed', `أمرٌ لم يُنفَّذ: ${command.id}`);
    }
  });
  // وكلُّ نداءٍ مرَّ بالديوانِ لا بسلطةٍ في النقلِ.
  assert.equal(
    console_.calls.length,
    CONSOLE_POLICY.commands.length,
    'ليس كلُّ الأوامرِ مرَّت بالديوانِ.',
  );
});

test('أمرٌ غيرُ مُعلَنٍ يُرَدُّ `404` — ولو كان العنوانُ معقولاً', async () => {
  const { gateway } = realGateway();
  const console_ = trackingConsole(SUCCESS_RESULT);
  await serving({ gateway, console: console_, commandRoutes: COMMAND_ROUTES }, async (base) => {
    const response = await fetch(`${base}/state/console/nonexistent-action`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ royalCommand: {}, signature: 'x' }),
    });
    assert.equal(response.status, 404);
    assert.equal(
      /** @type {Record<string, unknown>} */ (await response.json()).code,
      TRANSPORT_ERRORS.ROUTE_UNKNOWN,
    );
  });
  assert.equal(console_.calls.length, 0, 'أمرٌ غيرُ مُعلَنٍ مرَّ بالديوانِ!');
});

test('بلا ديوانٍ يُرَدُّ `503` — فالكتابةُ ليست قائمةً', async () => {
  const { gateway } = realGateway();
  await serving({ gateway, console: null, commandRoutes: COMMAND_ROUTES }, async (base) => {
    const response = await fetch(`${base}/state/console/stop-state`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ royalCommand: {}, signature: 'x' }),
    });
    assert.equal(response.status, 503);
    assert.equal(
      /** @type {Record<string, unknown>} */ (await response.json()).code,
      CONSOLE_ERRORS.GATEWAY_REQUIRED,
    );
  });
});

test('رموزُ رفضِ الديوانِ تُترجَمُ بحالتِها المُعلَنةِ لا بـ`500`', async () => {
  const { gateway } = realGateway();
  const codes = [
    [CONSOLE_ERRORS.COMMAND_UNDECLARED, 404],
    [CONSOLE_ERRORS.AUTHENTICATION_REQUIRED, 401],
    [CONSOLE_ERRORS.SIGNATURE_INVALID, 403],
    [CONSOLE_ERRORS.REPLAYED_COMMAND, 409],
    [CONSOLE_ERRORS.ACTION_MISMATCH, 400],
    [CONSOLE_ERRORS.CROWN_REQUIRED, 503],
  ];
  for (const [code, status] of codes) {
    const console_ = trackingConsole(() => {
      throw new ConsoleError(/** @type {string} */ (code), 'test');
    });
    await serving({ gateway, console: console_, commandRoutes: COMMAND_ROUTES }, async (base) => {
      const response = await fetch(`${base}/state/console/stop-state`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ royalCommand: {}, signature: 'x' }),
      });
      assert.equal(response.status, status, `رمزٌ ${code} رُدَّ بحالةٍ غيرِ ${status}`);
      assert.equal(
        /** @type {Record<string, unknown>} */ (await response.json()).code,
        code,
        `رمزٌ ${code} رُدَّ برمزٍ آخر`,
      );
    });
  }
});

test('النقلُ يُمرِّرُ الظرفَ كما هو — لا يُوقِّعُ ولا يُتحقَّقُ', async () => {
  const { gateway } = realGateway();
  /** @type {Record<string, unknown>} */
  const royalCommand = {
    id: 'cmd-123',
    action: 'stop-state',
    target: 'state:sovereign',
    payload: { reason: 'test' },
    issuedAt: '2026-01-01T00:00:00.000Z',
  };
  const signature = 'ed25519:test-signature';
  const sovereignSession = 'sovereign-session-token';
  const console_ = trackingConsole(SUCCESS_RESULT);
  await serving({ gateway, console: console_, commandRoutes: COMMAND_ROUTES }, async (base) => {
    await fetch(`${base}/state/console/stop-state`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ royalCommand, signature, sovereignSession }),
    });
  });
  assert.equal(console_.calls.length, 1, 'لم يصلِ النداءُ للديوانِ.');
  const call = console_.calls[0];
  assert.ok(call, 'لم يُسجَّل النداءُ.');
  assert.equal(call.command, 'cmd:halt', 'معرّفُ الأمرِ لم يُشتَقَّ من المسارِ.');
  assert.deepEqual(call.royalCommand, royalCommand, 'الأمرُ الملكيُّ لم يُمرَّر كما هو.');
  assert.equal(call.signature, signature, 'التوقيعُ لم يُمرَّر كما هو.');
  assert.equal(call.sovereignSession, sovereignSession, 'الجلسةُ القويةُ لم تُمرَّر كما هي.');
});

test('جسمٌ غيرُ JSON يُرَدُّ `400` — لا يُهمَلُ ولا يُخمَّنُ', async () => {
  const { gateway } = realGateway();
  const console_ = trackingConsole(SUCCESS_RESULT);
  await serving({ gateway, console: console_, commandRoutes: COMMAND_ROUTES }, async (base) => {
    const response = await fetch(`${base}/state/console/stop-state`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'not-json',
    });
    assert.equal(response.status, 400);
    assert.equal(
      /** @type {Record<string, unknown>} */ (await response.json()).code,
      TRANSPORT_ERRORS.BODY_NOT_ALLOWED,
    );
  });
  assert.equal(console_.calls.length, 0, 'جسمٌ غيرُ صالحٍ مرَّ بالديوانِ!');
});

test('ظرفٌ ناقصُ الحقول يُرَدُّ `400`', async () => {
  const { gateway } = realGateway();
  const console_ = trackingConsole(SUCCESS_RESULT);
  await serving({ gateway, console: console_, commandRoutes: COMMAND_ROUTES }, async (base) => {
    // بلا royalCommand
    const r1 = await fetch(`${base}/state/console/stop-state`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ signature: 'x' }),
    });
    assert.equal(r1.status, 400);
    // بلا signature
    const r2 = await fetch(`${base}/state/console/stop-state`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ royalCommand: {} }),
    });
    assert.equal(r2.status, 400);
  });
  assert.equal(console_.calls.length, 0, 'ظرفٌ ناقصٌ مرَّ بالديوانِ!');
});

test('كلُّ رموزِ رفضِ الديوانِ لها ترجمةُ حالةٍ في النقلِ', () => {
  for (const code of Object.values(CONSOLE_ERRORS)) {
    assert.ok(
      Object.prototype.hasOwnProperty.call(STATUS_BY_CODE, code),
      `رمزُ رفضٍ بلا ترجمةٍ في طبقةِ النقلِ: ${code}`,
    );
  }
});
