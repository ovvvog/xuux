// R5-B-04 (تقرير: R5-B-02) — اختبارُ إثباتٍ: قناةُ Telegram تمرُّ عبرَ بوابةِ الخروج.
//
// **المعيار:** القناةُ لا تنادي `fetch` مباشرةً. بلا بوابةِ خروجٍ موصولةٍ
// يُرفضُ الإرسالُ بـ`EGRESS_GATE_REQUIRED`. والوجهةُ غيرُ المعتمدةِ تُرفضُ
// قبلَ النقل. والوجهةُ المعتمدةُ تُنقلُ عبرَ البوابة.
//
// **الحدُّ معلَن:** هذا إثباتُ إنفاذٍ لا إثباتُ إغلاقٍ. صلاحيّةُ الإغلاقِ للمجلس.

import assert from 'node:assert/strict';
import test from 'node:test';

import { TelegramBotChannel } from '../../src/notifications/channels/telegram-bot.mjs';

function makeMessage() {
  return {
    ownerId: 'owner:probe',
    channel: 'telegram_bot',
    subject: 'اختبار',
    body: 'رسالة اختبار',
    sentAtMs: Date.now(),
  };
}

test('R5-B-04: وجهةٌ غير معتمدةٍ تُرفضُ قبلَ fetch', async () => {
  const fakeEgressGate = {
    async send() {
      throw new Error('DESTINATION_UNKNOWN: telegram-api غير معتمدة');
    },
  };

  const channel = TelegramBotChannel({
    getToken: () => 'dummy-token',
    egressGate: fakeEgressGate,
  });

  const result = await channel.send(makeMessage(), '123456789');
  assert.equal(result.state, 'failed', 'الإرسالُ فشل');
  assert.ok(result.failureReason.includes('EGRESS_REFUSED'), 'السببُ EGRESS_REFUSED');
});

test('R5-B-04: وجهةٌ معتمدةٌ تُنقلُ عبرَ البوابة', async () => {
  const fakeEgressGate = {
    async send(request) {
      assert.equal(request.destination, 'telegram-api');
      assert.equal(request.classification, 'internal');
      assert.ok(request.payload);
      return {
        bytes: 51,
        destination: 'telegram-api',
        policyId: 'pol:egress-approved-destinations',
        result: { ok: true, result: { message_id: 42 } },
      };
    },
  };

  const channel = TelegramBotChannel({
    getToken: () => 'dummy-token',
    egressGate: fakeEgressGate,
  });

  const result = await channel.send(makeMessage(), '123456789');
  assert.equal(result.state, 'sent', 'الإرسالُ نجح');
  assert.equal(result.providerMessageId, '42');
});

test('R5-B-04: بلا بوابةِ خروجٍ يُرفضُ الإرسالُ — لا fetch مباشر', async () => {
  const channel = TelegramBotChannel({
    getToken: () => 'dummy-token',
  });

  const result = await channel.send(makeMessage(), '123456789');
  assert.equal(result.state, 'failed', 'بلا بوابةٍ يفشل');
  assert.ok(result.failureReason.includes('EGRESS_GATE_REQUIRED'), 'السببُ EGRESS_GATE_REQUIRED');
});

test('R5-B-04: بلا بوابةٍ لا يُستدعى fetch إطلاقاً', async () => {
  let fetchCalled = false;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => {
    fetchCalled = true;
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ ok: true, result: { message_id: 1 } }),
    });
  };
  try {
    const channel = TelegramBotChannel({
      getToken: () => 'dummy-token',
    });

    const result = await channel.send(makeMessage(), '123456789');
    assert.equal(result.state, 'failed', 'بلا بوابةٍ يفشل');
    assert.equal(fetchCalled, false, 'fetch لم يُستدعَ إطلاقاً');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
