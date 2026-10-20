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
// **WL-426 (الجولةُ السادسةُ):** قاسَ عضوانِ مستقلّانِ أنّ المصنعَ
// `createSmtpEgressTransport` كانَ مسارًا خامًا (استدعاءٌ مباشرٌ بلا بوابةٍ يفتحُ
// اتصالًا). الإصلاحُ: سطحُ الوحدةِ لا يُصدِّرُ أيَّ قدرةِ إرسالٍ — سابقةُ Telegram.

import assert from 'node:assert/strict';
import net from 'node:net';
import test from 'node:test';

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

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
     * @param {import('../../src/egress/egress-gate.mjs').EgressRequest} request
     */
    async send(request) {
      assert.equal(request.destination, 'smtp.internal.example');
      assert.equal(request.classification, 'internal');
      assert.equal(request.actor.id, 'system:notifications');
      // القناةُ تُرسِلُ JSON نصًّا دائمًا (JSON.stringify أعلاه) — النوعُ اتحادٌ فنُثبِّتُهُ
      const payload = JSON.parse(/** @type {string} */ (request.payload));
      assert.equal(payload.to, 'test@example.com');
      assert.equal(payload.subject, 'اختبار');
      assert.equal(payload.body, 'رسالة اختبار');
      assert.equal(request.context?.['channel'], 'email');
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
      // خطأُ البوابةِ الحقيقيُّ يحملُ `code` من `EGRESS_ERRORS` (م-3: الرفضُ
      // وفشلُ النقلِ رمزانِ مختلفانِ لا رمزٌ واحدٌ يُلَفُّ بهِ كلُّ خطأٍ)
      // م-3: الرمزُ المسمّى للرفضِ يُبنى في الخطأِ بلا توسيعِ نمطِ Error
      const error = Object.assign(
        new Error('DESTINATION_UNKNOWN: smtp.internal.example غير معتمدة'),
        {
          code: 'EGRESS_DESTINATION_UNKNOWN',
        },
      );
      throw error;
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
  assert.ok(
    result.failureReason.includes('EGRESS_DESTINATION_UNKNOWN'),
    'ورمزُ البوابةِ المحدَّدُ ظاهرٌ (م-3)',
  );
});

// ——— WL-426 (الجولةُ السادسةُ — حكمُ المجلسِ: النتيجةُ باقيةٌ مفتوحةً) ———
// قاسَ العضوانِ المستقلّانِ (وبإعادةِ إنتاجِ المنفِّذِ) أنّ المصنعَ المُصدَّرَ
// `createSmtpEgressTransport` كانَ مسارًا خامًا: استدعاؤهُ مباشرةً بسجلٍّ مُلفَّقٍ
// فتحَ اتصالًا حقيقيًّا بلا أيِّ بوابةٍ. الإصلاحُ: **سطحُ الوحدةِ لا يُصدِّرُ أيَّ
// قدرةِ إرسالٍ** — نقلُ البوابةِ يُكتَبُ في موقعِ التركيبِ (سابقةُ Telegram).

test('WL-426: سطحُ الوحدةِ لا يُصدِّرُ أيَّ قدرةِ إرسالٍ — لا دالةً خامَةً ولا مصنعَ نقلٍ', async () => {
  const module = /** @type {Record<string, unknown>} */ (
    await import('../../src/notifications/channels/email.mjs')
  );
  const exported = Object.keys(module).sort();
  assert.deepEqual(exported, ['EmailChannel'], 'الوحدةُ تُصدِّرُ القناةَ وحدَها (سابقةُ Telegram)');
  assert.equal(module.sendSmtp, undefined, 'sendSmtp ليست على سطحِ الوحدةِ');
  assert.equal(
    module.createSmtpEgressTransport,
    undefined,
    'المصنعُ الخامُّ (مسارُ الجولةِ السادسةِ) لم يعد على سطحِ الوحدةِ',
  );

  // اختبارُ انحدارٍ لمسارِ الجولةِ: كانَ الاستيرادُ المُسمّى للمصنعِ ينجحُ ويفتحُ
  // اتصالًا بلا بوابةٍ — الآنَ يفشلُ عندَ الربطِ قبلَ أيِّ تشغيلٍ.
  const execFileAsync = promisify(execFile);
  const factoryProbe = `
import { createSmtpEgressTransport } from './src/notifications/channels/email.mjs';
createSmtpEgressTransport({ getSmtpConfig: () => null });
`;
  await assert.rejects(
    () =>
      execFileAsync(process.execPath, ['--input-type=module', '-e', factoryProbe], { cwd: process.cwd() }),
    (error) => {
      assert.match(
        String(/** @type {{ stderr?: string }} */ (error).stderr),
        /does not provide an export named 'createSmtpEgressTransport'/,
      );
      return true;
    },
    'الاستيرادُ المُسمّى للمصنعِ الخامِّ يجبُ أن يفشلَ عندَ الربطِ',
  );

  // والاستيرادُ المُسمّى لـsendSmtp يفشلُ كذلك (إغلاقُ الجولةِ السابقةِ باقٍ)
  const probe = `
import { sendSmtp } from './src/notifications/channels/email.mjs';
sendSmtp({ host: 'x', port: 1, user: 'u', password: 'p' }, { subject: 's', body: 'b', sentAtMs: 0 }, 'to@x');
`;
  await assert.rejects(
    () =>
      execFileAsync(process.execPath, ['--input-type=module', '-e', probe], { cwd: process.cwd() }),
    (error) => {
      assert.match(
        String(/** @type {{ stderr?: string }} */ (error).stderr),
        /does not provide an export named 'sendSmtp'/,
      );
      return true;
    },
    'الاستيرادُ المُسمّى لـsendSmtp يجبُ أن يفشلَ عندَ الربطِ',
  );
});

test('WL-426: النقلُ يُكتَبُ في موقعِ التركيبِ — الحمولةُ كاملةٌ عبرَ البوابةِ ووجهةُ الإذنِ من قراءةٍ واحدةٍ', async () => {
  // سابقةُ Telegram: نقلُ البوابةِ كودُ مُركِّبٍ في موقعِ التركيبِ — لا قدرةَ على
  // سطحِ وحدةِ القناةِ. القياسُ هنا للعقدِ الذي يُلزِمُ القناةَ: الحمولةُ تمرُّ
  // كاملةً عبرَ البوابةِ، ووجهةُ الإذنِ هي مضيفُ القراءةِ الواحدةِ للإعدادِ.
  const config = { host: 'smtp.internal.example', port: 587, user: 'user', password: 'pass' };
  let configReads = 0;
  /** @type {Array<import('../../src/egress/egress-gate.mjs').EgressRequest>} */
  const gateRequests = [];
  /** @type {Array<{ destination: unknown, bytes: number, payload: string }>} */
  const transportRecords = [];
  /**
   * @param {{ destination: unknown, bytes: number, payload: string }} record
   */
  const composerTransport = async (record) => {
    transportRecords.push(record);
    return { messageId: 'msg-43' };
  };
  const fakeEgressGate = {
    /**
     * @param {import('../../src/egress/egress-gate.mjs').EgressRequest} request
     */
    async send(request) {
      gateRequests.push(request);
      const record = {
        destination: request.destination,
        bytes: Buffer.byteLength(/** @type {string} */ (request.payload)),
        payload: /** @type {string} */ (request.payload),
      };
      const result = await composerTransport(record);
      return {
        bytes: record.bytes,
        destination: request.destination,
        policyId: 'pol:egress-approved-destinations',
        result,
      };
    },
  };

  const channel = EmailChannel({
    getSmtpConfig: () => {
      configReads += 1;
      return config;
    },
    egressGate: fakeEgressGate,
  });
  const message = makeMessage();
  const result = await channel.send(message, 'test@example.com');
  assert.equal(result.state, 'sent', `الإرسالُ عبرَ البوابةِ ينجح: ${result.failureReason}`);
  assert.equal(result.providerMessageId, 'msg-43');
  // وجهةُ الإذنِ من قراءةٍ واحدةٍ — لا انفصالَ بينَ ما أُذِنَ لهُ وما يُنقَلُ (حدُّ الجولةِ السادسةِ)
  assert.equal(configReads, 1, 'القناةُ تقرأُ الإعدادَ مرةً واحدةً: وجهةُ الإذنِ هي مضيفُها');
  assert.equal(gateRequests.length, 1, 'نداءُ بوابةٍ واحدٌ');
  const firstRequest = gateRequests[0];
  assert.ok(firstRequest !== undefined, 'نداءُ البوابةِ مضمونٌ قبلَ قراءتِهِ');
  assert.equal(firstRequest.destination, 'smtp.internal.example', 'وجهةُ الإذنِ مضيفُ الإعدادِ');
  assert.equal(transportRecords.length, 1, 'النقلُ (كودُ الموقعِ) استُدعي مرةً واحدةً عبرَ البوابةِ');
  const firstRecord = transportRecords[0];
  assert.ok(firstRecord !== undefined, 'نقلٌ واحدٌ مضمونٌ قبلَ قراءتِهِ');
  const payload = JSON.parse(firstRecord.payload);
  assert.equal(payload.to, 'test@example.com');
  assert.equal(payload.subject, 'اختبار');
  assert.equal(payload.body, 'رسالة اختبار');
  assert.equal(payload.sentAtMs, message.sentAtMs, 'زمنُ الإرسالِ يمرُّ في الحمولةِ كاملًا');
});

test('WL-426: بلا بوابةٍ لا يُفتحُ اتصالٌ — ولو وُجدَ نقلٌ في موقعِ التركيبِ', async () => {
  const smtp = await fakeSmtpServer();
  try {
    const config = { host: '127.0.0.1', port: 587, user: 'user', password: 'pass' };
    // نقلُ مُركِّبٍ موجودٌ في النطاقِ — القناةُ لا تعرفُهُ ولا تستدعيهِ بلا بوابةٍ
    const composerTransport = async () => ({ messageId: 'never' });
    const channel = EmailChannel({ getSmtpConfig: () => config }); // بلا بوابةٍ
    const result = await channel.send(makeMessage(), 'test@example.com');
    assert.equal(result.state, 'failed');
    assert.ok(
      result.failureReason !== null && result.failureReason.includes('EGRESS_GATE_REQUIRED'),
    );
    assert.equal(
      smtp.connections(),
      0,
      'لا اتصالَ بلا بوابةٍ — النقلُ لا يُستدعى إلا منَ البوابةِ',
    );
    void composerTransport;
  } finally {
    await smtp.close();
  }
});
