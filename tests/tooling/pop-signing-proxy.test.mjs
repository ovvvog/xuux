// اختبارُ الوسيطِ الموقِّعِ للتطويرِ — `WL-183` (إغلاقُ الدَينِ `LIVE-5`).
//
// **الدَينُ الذي يُقاسُ إغلاقُه:** مشهدُ الويبِ كان **يُخدَمُ ولا يقرأُ** — صفحةُ
// متصفِّحٍ لا تحملُ مفتاحاً خاصّاً، فكلُّ نداءٍ منها يُرَدُّ `401`
// ‏`API_POP_REQUIRED`. **وشرطُ الإغلاقِ في سجلِّ الديونِ:** وسيطٌ موقِّعٌ في
// الخادمِ **تُعلَنُ سلطتُه ومداه**، **ولا يُغلَقُ بـ`requirePoP: false`**.
//
// **وما يُقاسُ هنا بالرفضِ لا بالوصفِ:** أنّ المدى قراءةٌ فقط (فعلٌ كاتبٌ يُرَدُّ
// برمزٍ مُسمّىً)، وأنّ الرَّبطَ محلّيٌّ **يَفشلُ مُغلَقاً** على غيرِه، وأنّ الوسيطَ
// **لا يَنتحلُ جلسةَ مَن أتى برمزِه**، وأنّ الإعلانَ حاضرٌ في الوثيقةِ **وفي
// واجهةِ المشهدِ نفسِها** لا في الوثيقةِ وحدَها.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import process from 'node:process';

import {
  DevProxyError,
  LOOPBACK_HOSTS,
  PROXY_AUTHORITY,
  PROXY_HEADER,
  PROXY_REFUSALS,
  assertLoopbackHost,
  createSigningProxyHandler,
  proxyHeaderValue,
} from '../../scripts/dev-pop-proxy.mjs';

/** مسارٌ واحدٌ مُعلَنٌ يكفي للقياسِ: الجدولُ الحقيقيُّ مُشتَقٌّ في المُشغِّلِ. */
const ROUTE = Object.freeze({
  id: 'agents.list',
  method: 'GET',
  path: '/state/agents',
  action: 'read',
  resource: 'agents',
  call: 'list',
  literals: 2,
  segments: [
    { literal: 'state', name: null },
    { literal: 'agents', name: null },
  ],
});

/**
 * وسيطٌ فوقَ طبقةٍ داخليّةٍ مُصطنَعةٍ: تَقبلُ الموقَّعَ وتَرُدُّ غيرَه — كما يفعلُ
 * النقلُ الحقيقيُّ — فيُقاسُ سلوكُ الوسيطِ لا سلوكُ نسخةٍ منه.
 * @returns {Promise<{ proxyBase: string, innerBase: string, close: () => Promise<void> }>}
 */
async function stack() {
  const inner = http.createServer((request, response) => {
    const authorized =
      typeof request.headers['authorization'] === 'string' &&
      typeof request.headers['x-pop-signature'] === 'string';
    if (!authorized) {
      const body = JSON.stringify({ code: 'API_POP_REQUIRED' });
      response.writeHead(401, { 'content-type': 'application/json', 'x-state-transport': 'plain' });
      response.end(body);
      return;
    }
    response.writeHead(200, { 'content-type': 'application/json', 'x-state-transport': 'plain' });
    response.end(JSON.stringify({ route: ROUTE.id, seen: request.headers['authorization'] }));
  });
  await new Promise((resolve) => inner.listen(0, '127.0.0.1', () => resolve(undefined)));
  const innerAddress = inner.address();
  const innerPort =
    typeof innerAddress === 'object' && innerAddress !== null ? innerAddress.port : 0;

  const handler = createSigningProxyHandler({
    routes: [ROUTE],
    specs: [ROUTE],
    popClient: {
      signCall: () => ({ signature: 'sig', timestamp: 'ts', nonce: 'n' }),
      headersFor: (proof) => ({ 'x-pop-signature': proof.signature }),
    },
    sessionId: 'session-under-test',
    token: 'runner-token',
    origin: `http://127.0.0.1:${innerPort}`,
  });
  const front = http.createServer(handler);
  await new Promise((resolve) => front.listen(0, '127.0.0.1', () => resolve(undefined)));
  const frontAddress = front.address();
  const frontPort =
    typeof frontAddress === 'object' && frontAddress !== null ? frontAddress.port : 0;

  return {
    proxyBase: `http://127.0.0.1:${frontPort}`,
    innerBase: `http://127.0.0.1:${innerPort}`,
    close: async () => {
      await new Promise((resolve) => front.close(() => resolve(undefined)));
      await new Promise((resolve) => inner.close(() => resolve(undefined)));
    },
  };
}

test('الرَّبطُ يَفشلُ مُغلَقاً على مضيفٍ غيرِ محلّيٍّ — لا وسيطَ موقِّعاً على الشبكةِ', () => {
  for (const host of LOOPBACK_HOSTS) assert.doesNotThrow(() => assertLoopbackHost(host));
  for (const host of ['0.0.0.0', '10.0.0.5', 'state.example.com', '']) {
    assert.throws(
      () => assertLoopbackHost(host),
      (error) => {
        assert.ok(error instanceof DevProxyError);
        assert.equal(error.code, PROXY_REFUSALS.HOST_NOT_LOOPBACK);
        return true;
      },
      `مضيفٌ غيرُ محلّيٍّ قُبِلَ: ${host}`,
    );
  }
});

test('الإعلانُ في الترويسةِ يُفرِّقُ بينَ المُوقَّعِ والمُمَرَّرِ', () => {
  const signed = proxyHeaderValue(true);
  const passed = proxyHeaderValue(false);
  for (const value of [signed, passed]) {
    assert.match(value, /authority=service:state-viewer-dev/u);
    assert.match(value, /scope=read-only/u);
    assert.match(value, /binding=loopback-only/u);
  }
  assert.match(signed, /signed=yes/u);
  assert.match(passed, /signed=no/u);
  assert.equal(PROXY_AUTHORITY.scope, 'read-only');
});

test('نداءُ متصفِّحٍ بلا رمزٍ ولا توقيعٍ يُقبَلُ عبرَ الوسيطِ — والتوقيعُ وقعَ في الخادمِ', async () => {
  const stackUnderTest = await stack();
  try {
    // والقياسُ الأوّلُ أنّ الحمايةَ قائمةٌ: النداءُ نفسُه إلى الداخلِ يُرَدُّ.
    const direct = await fetch(`${stackUnderTest.innerBase}${ROUTE.path}`);
    assert.equal(direct.status, 401);
    assert.match(await direct.text(), /API_POP_REQUIRED/u);

    const proxied = await fetch(`${stackUnderTest.proxyBase}${ROUTE.path}`);
    assert.equal(proxied.status, 200);
    assert.match(String(proxied.headers.get(PROXY_HEADER)), /signed=yes/u);
    const body = /** @type {{ seen: string }} */ (await proxied.json());
    assert.equal(body.seen, 'Bearer runner-token');
    // ولا يَرفعُ زعمَ التعميةِ: يُمرِّرُ ما وردَ من الداخلِ كما وردَ.
    assert.equal(proxied.headers.get('x-state-transport'), 'plain');
  } finally {
    await stackUnderTest.close();
  }
});

test('المدى قراءةٌ فقط: فعلٌ كاتبٌ يُرَدُّ برمزٍ مُسمّىً ولا يُوقَّعُ ولا يُمرَّرُ', async () => {
  const stackUnderTest = await stack();
  try {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      const response = await fetch(`${stackUnderTest.proxyBase}${ROUTE.path}`, { method });
      assert.equal(response.status, 405, `فعلٌ كاتبٌ لم يُرَدَّ: ${method}`);
      assert.match(await response.text(), /DEV_PROXY_READ_ONLY/u);
      assert.match(String(response.headers.get(PROXY_HEADER)), /signed=no/u);
    }
  } finally {
    await stackUnderTest.close();
  }
});

test('ولا انتحالَ جلسةٍ: مَن أتى برمزِه مُرَّ كما هو بلا توقيعٍ فرُدَّ', async () => {
  const stackUnderTest = await stack();
  try {
    const response = await fetch(`${stackUnderTest.proxyBase}${ROUTE.path}`, {
      headers: { authorization: 'Bearer some-other-session' },
    });
    assert.equal(response.status, 401);
    assert.match(String(response.headers.get(PROXY_HEADER)), /signed=no/u);
  } finally {
    await stackUnderTest.close();
  }
});

test('وانقطاعُ الطبقةِ الداخليّةِ يُقالُ انقطاعاً لا منعاً', async () => {
  const handler = createSigningProxyHandler({
    routes: [ROUTE],
    specs: [ROUTE],
    popClient: {
      signCall: () => ({ signature: 'sig', timestamp: 'ts', nonce: 'n' }),
      headersFor: () => ({ 'x-pop-signature': 'sig' }),
    },
    sessionId: 's',
    token: 't',
    origin: 'http://127.0.0.1:1',
    fetchImpl: () => Promise.reject(new Error('ECONNREFUSED')),
  });
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(undefined)));
  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;
  try {
    const response = await fetch(`http://127.0.0.1:${port}${ROUTE.path}`);
    assert.equal(response.status, 502);
    assert.match(await response.text(), /DEV_PROXY_UPSTREAM_UNREACHABLE/u);
  } finally {
    await new Promise((resolve) => server.close(() => resolve(undefined)));
  }
});

test('السلطةُ والمدى مُعلَنانِ في الوثيقةِ وفي واجهةِ المشهدِ نفسِها', () => {
  const transportDoc = fs.readFileSync(path.join(process.cwd(), 'docs', 'TRANSPORT.md'), 'utf8');
  for (const needle of [
    'dev-pop-proxy.mjs',
    PROXY_AUTHORITY.actor,
    PROXY_HEADER,
    PROXY_REFUSALS.READ_ONLY,
  ]) {
    assert.ok(transportDoc.includes(needle), `الوثيقةُ لا تُعلِنُ: ${needle}`);
  }
  const page = fs.readFileSync(path.join(process.cwd(), 'web', 'index.html'), 'utf8');
  for (const needle of [PROXY_AUTHORITY.actor, PROXY_HEADER, 'requirePoP']) {
    assert.ok(page.includes(needle), `واجهةُ المشهدِ لا تُعلِنُ: ${needle}`);
  }
  const app = fs.readFileSync(path.join(process.cwd(), 'web', 'app.mjs'), 'utf8');
  assert.ok(app.includes(PROXY_HEADER), 'الواجهةُ لا تقرأُ إعلانَ الوسيطِ فتقولَ مَن وقَّعَ.');
});
