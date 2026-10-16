// R5-B-04 (CO55-M11.05-R3-01) — اختبارُ إثباتٍ: قناةُ Email تمرُّ عبرَ بوابةِ الخروج.
//
// **المعيار:** القناةُ لا تفتحُ اتصالًا مباشرةً. بلا بوابةِ خروجٍ موصولةٍ
// يُرفضُ الإرسالُ قبلَ أيِّ اتصالٍ بـ`EGRESS_GATE_REQUIRED` **ولا يصلُ إلى مضيفِ
// SMTP بايتٌ واحدٌ** (يُقاسُ بعدّادِ اتصالاتٍ على خادمٍ محليٍّ حقيقيٍّ لا
// بالتصريحِ). والوجهةُ المعتمدةُ تُنقلُ عبرَ البوابةِ، ورفضُ البوابةِ
// `EGRESS_REFUSED`.
//
// **الحدُّ معلَن:** هذا إثباتُ إنفاذٍ لا إثباتُ إغلاقٍ. صلاحيّةُ الإغلاقِ
// للمجلسِ لا للمنفِّذِ.

import assert from 'node:assert/strict';
import net from 'node:net';
import test from 'node:test';

import { EmailChannel } from '../../src/notifications/channels/email.mjs';

/**
 * خادمُ SMTP محليٌّ وهميٌّ يَعُدُّ الاتصالاتِ (لا يستجيبُ — العدُّ يكفي): إن
 * وصله اتصالٌ فقد خرجَ بايتٌ إلى «الخارجِ» بلا بوابةٍ.
 * @returns {Promise<{ server: import('node:net').Server, connections: () => number, close: () => Promise<void> }>}
 */
function fakeSmtpServer() {
  return new Promise((resolve) => {
    let count = 0;
    const server = net.createServer((socket) => {
      count += 1;
      socket.destroy();
    });
    server.listen(0, '127.0.0.1', () => {
      resolve({
        server,
        connections: () => count,
        close: () => new Promise((done) => server.close(() => done())),
      });
    });
  });
}

/** @returns {{ ownerId: string, channel: string, subject: string, body: string, sentAtMs: number }} */
function makeMessage() {
  return {
    ownerId: 'owner:probe',
    channel: 'email',
    subject: 'اختبار',
    body: 'رسالة اختبار',
    sentAtMs: Date.now(),
  };
}

test('R5-B-04: بلا بوابةِ خروجٍ يُرفضُ الإرسالُ قبلَ أيِّ اتصالٍ — لا يخرجُ بايت', async () => {
  const smtp = await fakeSmtpServer();
  const address = /** @type {import('node:net').AddressInfo} */ (smtp.server.address());
  try {
    const channel = EmailChannel({
      getSmtpConfig: () => ({
        host: '127.0.0.1',
        port: address.port,
        user: 'user',
        password: 'pass',
      }),
    });

    const result = await channel.send(makeMessage(), 'test@example.com');
    assert.equal(result.state, 'failed', 'بلا بوابةٍ يفشل');
    assert.ok(result.failureReason !== null, 'سببُ الفشلِ حاضرٌ');
    assert.ok(
      result.failureReason.includes('EGRESS_GATE_REQUIRED'),
      `السببُ EGRESS_GATE_REQUIRED لا «${result.failureReason}»`,
    );
    assert.equal(
      smtp.connections(),
      0,
      'لا يجوزُ أن يصلَ إلى مضيفِ SMTP اتصالٌ واحدٌ — لا يخرجُ بايتٌ بلا بوابةٍ',
    );
  } finally {
    await smtp.close();
  }
});

test('R5-B-04: الوجهةُ المعتمدةُ تُنقلُ عبرَ البوابةِ (الحمولةُ كاملةً والوجهةُ مضيفُ SMTP)', async () => {
  const fakeEgressGate = {
    /**
     * @param {{ actor: { id: string }, destination: string, payload: string, classification: string, context: Record<string, unknown> }} request
     */
    async send(request) {
      assert.equal(request.destination, 'smtp.internal.example');
      assert.equal(request.classification, 'internal');
      assert.equal(request.actor.id, 'system:notifications');
      const payload = JSON.parse(request.payload);
      assert.equal(payload.to, 'test@example.com');
      assert.equal(payload.subject, 'اختبار');
      assert.equal(payload.body, 'رسالة اختبار');
      assert.equal(request.context['channel'], 'email');
      return {
        bytes: 51,
        destination: 'smtp.internal.example',
        policyId: 'pol:egress-approved-destinations',
        result: { messageId: 'msg-42' },
      };
    },
  };

  const channel = EmailChannel({
    getSmtpConfig: () => ({
      host: 'smtp.internal.example',
      port: 587,
      user: 'user',
      password: 'pass',
    }),
    egressGate: fakeEgressGate,
  });

  const result = await channel.send(makeMessage(), 'test@example.com');
  assert.equal(result.state, 'sent', `الإرسالُ نجح: ${result.failureReason}`);
  assert.equal(result.providerMessageId, 'msg-42');
});

test('R5-B-04: رفضُ البوابةِ يُفشِلُ الإرسالَ بـEGRESS_REFUSED', async () => {
  const fakeEgressGate = {
    async send() {
      throw new Error('DESTINATION_UNKNOWN: smtp.internal.example غير معتمدة');
    },
  };

  const channel = EmailChannel({
    getSmtpConfig: () => ({
      host: 'smtp.internal.example',
      port: 587,
      user: 'user',
      password: 'pass',
    }),
    egressGate: fakeEgressGate,
  });

  const result = await channel.send(makeMessage(), 'test@example.com');
  assert.equal(result.state, 'failed', 'الإرسالُ فشل');
  assert.ok(result.failureReason !== null, 'سببُ الفشلِ حاضرٌ');
  assert.ok(result.failureReason.includes('EGRESS_REFUSED'), 'السببُ EGRESS_REFUSED');
});
