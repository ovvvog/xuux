// اختباراتُ المُرسِلِ والقنوات — بما فيها منعُ loopback والـ mock.
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  NOTIFICATION_ERRORS,
  NotificationDispatcher,
  NotificationError,
  TelegramBotChannel,
  EmailChannel,
  assertNotLoopback,
  createNotificationResult,
  isLoopbackDestination,
  maskDestination,
} from '../../src/notifications/index.mjs';

// ── منعُ loopback ──

test('isLoopbackDestination يُعيدُ true لـ localhost', () => {
  assert.ok(isLoopbackDestination('http://localhost:9800/notify'));
  assert.ok(isLoopbackDestination('http://127.0.0.1:9800/notify'));
  assert.ok(isLoopbackDestination('https://localhost/notify'));
});

test('isLoopbackDestination يُعيدُ false لعنوانٍ خارجيٍّ', () => {
  assert.ok(!isLoopbackDestination('https://api.telegram.org'));
  assert.ok(!isLoopbackDestination('smtp.gmail.com'));
});

test('assertNotLoopback يرفضُ localhost', () => {
  assert.throws(
    () => assertNotLoopback('http://localhost:9800/notify'),
    (/** @type {unknown} */ e) =>
      e instanceof NotificationError && e.code === NOTIFICATION_ERRORS.LOOPBACK_FORBIDDEN,
  );
});

test('assertNotLoopback يرفضُ 127.0.0.1', () => {
  assert.throws(
    () => assertNotLoopback('http://127.0.0.1:9800/notify'),
    (/** @type {unknown} */ e) =>
      e instanceof NotificationError && e.code === NOTIFICATION_ERRORS.LOOPBACK_FORBIDDEN,
  );
});

// ─ـ maskDestination ──

test('maskDestination يُخفي الوجهةَ في السجلِّ', () => {
  const masked = maskDestination('8634283336');
  assert.ok(masked.includes('***'));
  assert.ok(!masked.includes('8634283336'));
});

// ── المُرسِلُ بقناةٍ مُحقنة ──

test('NotificationDispatcher يُسجِّلُ قناةً ويُوجِّهُ الرسالةَ عبرها', async () => {
  const sent = [];
  const dispatcher = new NotificationDispatcher({
    channels: [
      {
        name: 'test_channel',
        send: async (message, destination) => {
          sent.push({ message, destination });
          return createNotificationResult({
            channel: 'test_channel',
            ownerId: message.ownerId,
            maskedDestination: maskDestination(destination),
            state: 'sent',
            attemptedAtMs: message.sentAtMs,
            providerMessageId: 'msg-123',
            providerResult: 'ok',
          });
        },
      },
    ],
    clock: () => 5000,
    forbidLoopback: false,
  });

  const result = await dispatcher.dispatch(
    {
      ownerId: 'owner:king',
      channel: 'test_channel',
      subject: 'اختبار',
      body: 'رسالة',
      sentAtMs: 5000,
    },
    '8634283336',
  );

  assert.equal(result.state, 'sent');
  assert.equal(result.providerMessageId, 'msg-123');
  assert.equal(sent.length, 1);
});

test('NotificationDispatcher يُعيدُ not_configured لقناةٍ غيرِ مُسجَّلة', async () => {
  const dispatcher = new NotificationDispatcher({
    clock: () => 5000,
    forbidLoopback: false,
  });

  const result = await dispatcher.dispatch(
    { ownerId: 'owner:king', channel: 'unknown', subject: 'اختبار', body: 'رسالة', sentAtMs: 5000 },
    '8634283336',
  );

  assert.equal(result.state, 'not_configured');
});

test('NotificationDispatcher يرفضُ وجهةَ loopback', async () => {
  const dispatcher = new NotificationDispatcher({
    channels: [
      {
        name: 'test_channel',
        send: async () =>
          createNotificationResult({
            channel: 'test_channel',
            ownerId: 'x',
            maskedDestination: 'x',
            state: 'sent',
            attemptedAtMs: 0,
          }),
      },
    ],
    clock: () => 5000,
    forbidLoopback: true,
  });

  await assert.rejects(
    () =>
      dispatcher.dispatch(
        {
          ownerId: 'owner:king',
          channel: 'test_channel',
          subject: 'اختبار',
          body: 'رسالة',
          sentAtMs: 5000,
        },
        'http://localhost:9800/notify',
      ),
    (/** @type {unknown} */ e) =>
      e instanceof NotificationError && e.code === NOTIFICATION_ERRORS.LOOPBACK_FORBIDDEN,
  );
});

test('NotificationDispatcher يُقيِّدُ النتيجةَ في السجلِّ', async () => {
  /** @type {Array<Record<string, unknown>>} */
  const auditEntries = [];
  const dispatcher = new NotificationDispatcher({
    channels: [
      {
        name: 'test_channel',
        send: async (message, destination) =>
          createNotificationResult({
            channel: 'test_channel',
            ownerId: message.ownerId,
            maskedDestination: maskDestination(destination),
            state: 'sent',
            attemptedAtMs: message.sentAtMs,
            providerMessageId: 'msg-1',
          }),
      },
    ],
    clock: () => 5000,
    audit: {
      append: (type, actor, data) => auditEntries.push({ type, actor, data }),
    },
    forbidLoopback: false,
  });

  await dispatcher.dispatch(
    {
      ownerId: 'owner:king',
      channel: 'test_channel',
      subject: 'اختبار',
      body: 'رسالة',
      sentAtMs: 5000,
    },
    '8634283336',
  );

  assert.equal(auditEntries.length, 1);
  assert.equal(auditEntries[0]?.type, 'notification.dispatched');
  assert.equal(auditEntries[0]?.actor, 'owner:king');
  // لا تُكتبُ الوجهةُ الخامُّ في السجلِّ
  assert.ok(!JSON.stringify(auditEntries[0] ?? {}).includes('8634283336'));
});

test('NotificationDispatcher يُمسكُ فشلَ القناةِ ويُسجِّلُه', async () => {
  const dispatcher = new NotificationDispatcher({
    channels: [
      {
        name: 'failing',
        send: async () => {
          throw new Error('network error');
        },
      },
    ],
    clock: () => 5000,
    forbidLoopback: false,
  });

  const result = await dispatcher.dispatch(
    { ownerId: 'owner:king', channel: 'failing', subject: 'اختبار', body: 'رسالة', sentAtMs: 5000 },
    '8634283336',
  );

  assert.equal(result.state, 'failed');
  assert.ok(result.failureReason?.includes('network error'));
});

// ── القنوات ──

test('TelegramBotChannel يُعيدُ not_configured بلا token', async () => {
  const channel = TelegramBotChannel({ getToken: () => undefined });
  const result = await channel.send(
    {
      ownerId: 'owner:king',
      channel: 'telegram_bot',
      subject: 'اختبار',
      body: 'رسالة',
      sentAtMs: 5000,
    },
    '8634283336',
  );
  assert.equal(result.state, 'not_configured');
});

test('EmailChannel يُعيدُ not_configured بلا إعداد', async () => {
  const channel = EmailChannel({ getSmtpConfig: () => null });
  const result = await channel.send(
    { ownerId: 'owner:king', channel: 'email', subject: 'اختبار', body: 'رسالة', sentAtMs: 5000 },
    'test@example.com',
  );
  assert.equal(result.state, 'not_configured');
});
