// اختبارُ وحدةِ تسليمِ إشعاراتِ التنبيهات — إغلاقُ الدَّينِ `D-3`.
//
// ومَحَلُّ القياسِ هنا أنّ **رسالةً تُرسَلُ فعلاً ويُقاسُ وصولُها**: خادمُ HTTP
// محليٌّ يستقبلُ الحزمة، والنتيجةُ رمزُ حالةٍ يُقاس. فمن لم يصل التنبيهُ لا
// يدري أنه فات — وهذا عينُ العيبِ الذي جاء الدَّينُ ليُغلقه.
//
// **حدٌّ معلَنٌ أول:** المُرسِلُ محقونٌ لا مستورد. فاختبارُ التسليمِ يُحقِنُ
// مُرسِلاً يستعملُ `fetch` إلى خادمٍ محليٍّ، ولا تُستوردُ وحدةُ التسليمِ
// `fetch` ولا `http`.
//
// **حدٌّ معلَنٌ ثانٍ:** لا ساعةَ نظامٍ في وحدةِ التسليم. الزمنُ يُمرَّر
// معرّفاً `atMs` من المُنسِّق، فلا `Date.now` في الوحدة.
//
// **حدٌّ معلَنٌ ثالثٌ:** الفشلُ قيدٌ لا صمت. فمن أرسلَ رسالةً ولم تصل قيَّد
// الفشلَ برمزِ حالةٍ، ولم يُسقِط الحادثةَ بأكملِها.

import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';

import {
  IR_ERRORS,
  IncidentResponseError,
  Notifier,
  buildNotification,
} from '../../src/incident-response/index.mjs';

/** @type {Array<{ method: string, url: string, body: string, status: number }>} */
let received = [];

/**
 * يُنشئُ خادمَ HTTP محليّاً يستقبلُ التسليمات ويُعيدُ رمزَ الحالةِ المطلوب.
 * @param {number} statusCode
 * @returns {Promise<{ server: import('node:http').Server, port: number, close: () => Promise<void> }>}
 */
function startServer(statusCode = 200) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', () => {
        received.push({
          method: req.method ?? '',
          url: req.url ?? '',
          body,
          status: statusCode,
        });
        res.writeHead(statusCode, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ received: true }));
      });
    });
    server.listen(0, '127.0.0.1', () => {
      const port = /** @type {import('node:net').AddressInfo} */ (server.address()).port;
      resolve({
        server,
        port,
        close: () => new Promise((resolveClose) => server.close(() => resolveClose())),
      });
    });
  });
}

/**
 * مُرسِلٌ يستعملُ `fetch` إلى خادمٍ محليٍّ.
 * @param {string} url
 * @param {string} method
 * @param {object} payload
 * @returns {Promise<{ status: number, delivered: boolean }>}
 */
async function httpSender(url, method, payload) {
  const response = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return { status: response.status, delivered: response.ok };
}

// ── buildNotification ──

test('buildNotification تُنشئُ رسالةً من حالِ التنبيهِ — دالةٌ خالصةٌ لا أثرَ', () => {
  const notification = buildNotification({
    rule: 'alert:api-availability-breaching',
    severity: 'severity:critical',
    channel: 'channel:audit-desk',
    incident: 'incident:alert:api-availability-breaching@1000',
    raisedAtMs: 1000,
  });
  assert.equal(notification.channel, 'channel:audit-desk');
  assert.equal(notification.alert, 'alert:api-availability-breaching');
  assert.equal(notification.incident, 'incident:alert:api-availability-breaching@1000');
  assert.equal(notification.severity, 'severity:critical');
  assert.equal(notification.raisedAtMs, 1000);
  assert.ok(notification.message.length > 20);
  assert.ok(Object.isFrozen(notification));
});

// ── Notifier ──

test('Notifier بلا مُرسِلٍ يُرَدُّ برمزٍ مُسمّى — ولا تسليمَ بلا مُرسِل', () => {
  assert.throws(
    () => new Notifier({ endpoints: [] }),
    (/** @type {unknown} */ error) =>
      error instanceof IncidentResponseError && error.code === IR_ERRORS.DELIVERY_REQUIRED,
  );
});

test('Notifier يُسلِّمُ رسالةً إلى خادمٍ محليٍّ ويُقاسُ وصولُها — رمزُ الحالةِ 200', async () => {
  received = [];
  const { port, close } = await startServer(200);
  try {
    const notifier = new Notifier({
      endpoints: [
        { id: 'channel:audit-desk', url: `http://127.0.0.1:${port}/notify`, method: 'POST' },
      ],
      sender: { send: httpSender },
    });
    const notification = buildNotification({
      rule: 'alert:api-availability-breaching',
      severity: 'severity:critical',
      channel: 'channel:audit-desk',
      incident: 'incident:test@1000',
      raisedAtMs: 1000,
    });
    const result = await notifier.deliver(notification, 2000);
    assert.equal(result.delivered, true);
    assert.equal(result.status, 200);
    assert.equal(result.atMs, 2000);
    assert.equal(received.length, 1);
    assert.equal(received[0]?.method, 'POST');
    const body = JSON.parse(received[0]?.body ?? '{}');
    assert.equal(body.alert, 'alert:api-availability-breaching');
    assert.equal(body.channel, 'channel:audit-desk');
  } finally {
    await close();
  }
});

test('Notifier يُسجِّلُ الفشلَ ويُعيدُ رمزَ الحالةِ — رمزُ الحالةِ 500', async () => {
  received = [];
  const { port, close } = await startServer(500);
  try {
    const notifier = new Notifier({
      endpoints: [
        { id: 'channel:audit-desk', url: `http://127.0.0.1:${port}/notify`, method: 'POST' },
      ],
      sender: { send: httpSender },
    });
    const notification = buildNotification({
      rule: 'alert:api-availability-breaching',
      severity: 'severity:critical',
      channel: 'channel:audit-desk',
      incident: 'incident:test@2000',
      raisedAtMs: 2000,
    });
    const result = await notifier.deliver(notification, 3000);
    assert.equal(result.delivered, false);
    assert.equal(result.status, 500);
    assert.equal(result.atMs, 3000);
    assert.equal(received.length, 1);
  } finally {
    await close();
  }
});

test('Notifier يُعيدُ قناةً بلا نقطةِ تسليمٍ — delivered=false وstatus=0', async () => {
  const notifier = new Notifier({
    endpoints: [],
    sender: { send: httpSender },
  });
  const notification = buildNotification({
    rule: 'alert:api-availability-breaching',
    severity: 'severity:critical',
    channel: 'channel:unknown',
    incident: 'incident:test@3000',
    raisedAtMs: 3000,
  });
  const result = await notifier.deliver(notification, 4000);
  assert.equal(result.delivered, false);
  assert.equal(result.status, 0);
});

test('Notifier يُمسكُ خطأَ المُرسِلِ ويُسجِّلُه قيداً لا صمتاً', async () => {
  const notifier = new Notifier({
    endpoints: [{ id: 'channel:audit-desk', url: 'http://127.0.0.1:1/notify', method: 'POST' }],
    sender: {
      send: async () => {
        throw new Error('connection refused');
      },
    },
  });
  const notification = buildNotification({
    rule: 'alert:api-availability-breaching',
    severity: 'severity:critical',
    channel: 'channel:audit-desk',
    incident: 'incident:test@4000',
    raisedAtMs: 4000,
  });
  const result = await notifier.deliver(notification, 5000);
  assert.equal(result.delivered, false);
  assert.equal(result.status, 0);
  assert.ok('error' in result);
});

test('Notifier.endpointFor يُعيدُ نقطةَ التسليمِ أو null', () => {
  const notifier = new Notifier({
    endpoints: [{ id: 'channel:audit-desk', url: 'http://localhost/notify', method: 'POST' }],
    sender: { send: httpSender },
  });
  const endpoint = notifier.endpointFor('channel:audit-desk');
  assert.ok(endpoint !== null);
  assert.equal(endpoint?.id, 'channel:audit-desk');
  assert.equal(notifier.endpointFor('channel:unknown'), null);
});
