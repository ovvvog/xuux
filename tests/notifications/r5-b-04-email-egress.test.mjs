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

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import {
  EmailChannel,
  createSmtpEgressTransport,
} from '../../src/notifications/channels/email.mjs';

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

// ——— جولةُ إعادةِ الاختبارِ 2026-10-17 (حكمُ المجلسِ: النتيجةُ باقيةٌ مفتوحةً) ———
// قاسَ عضوُ المجلسِ أنَّ `sendSmtp` المُصدَّرةَ كانت تُرسِلُ بلا بوابةٍ (اتصالٌ
// واحدٌ و484 بايتًا). الإصلاحُ: لا دالةَ إرسالٍ خامَةً على سطحِ الوحدةِ أصلًا —
// بروتوكولُ SMTP إغلاقٌ داخلَها، والمُتاحُ للمُركِّبِ هو نقلُ بوابةٍ فقط.

test('جولة 2026-10-17: سطحُ الوحدةِ لا يُصدِّرُ دالةَ إرسالٍ خامَةً (إغلاقُ التفافِ `sendSmtp`)', async () => {
  const module = /** @type {Record<string, unknown>} */ (
    await import('../../src/notifications/channels/email.mjs')
  );
  const exported = Object.keys(module).sort();
  assert.deepEqual(exported, ['EmailChannel', 'createSmtpEgressTransport']);
  assert.equal(module.sendSmtp, undefined, 'sendSmtp لم تعد على سطحِ الوحدةِ');

  // والاستيرادُ المُسمّى لها يفشلُ عندَ الربطِ — فلا مسارَ إرسالٍ خامًا يستورِدُهُ مُركِّبٌ
  const execFileAsync = promisify(execFile);
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

/**
 * خادمُ SMTP وهميٌّ كاملُ الحوارِ (220/EHLO/STARTTLS/…/DATA) يَعُدُّ الاتصالاتِ
 * والأسطرَ — للسماحِ بقياسِ مسارِ النقلِ الحقيقيِّ عبرَ البوابةِ دونَ خادمٍ خارجيٍّ.
 * لا يقبلُ TLS (يردُّ 454) فيكملُ الحوارَ نصًّا ويرفضُ AUTH — يكفي لقياسِ أنَّ
 * النقلَ وصَلَ فعلاً إلى «الخارجِ» عبرَ البوابةِ وحدَها.
 *
 * @returns {Promise<{ server: import('node:net').Server, connections: () => number, lines: () => string[], close: () => Promise<void> }>}
 */
function scriptedSmtpServer() {
  return new Promise((resolve) => {
    let count = 0;
    /** @type {string[]} */
    const lines = [];
    const server = net.createServer((socket) => {
      count += 1;
      /** @param {string} s */
      const w = (s) => socket.write(s + '\r\n');
      w('220 fake.smtp ESMTP');
      socket.on('data', (data) => {
        for (const line of data.toString().split('\r\n')) {
          if (!line) continue;
          lines.push(line);
          const u = line.toUpperCase();
          if (u.startsWith('EHLO')) {
            w('250-fake.smtp');
            w('250 AUTH LOGIN');
          } else if (u === 'STARTTLS') w('500 STARTTLS not available here');
          else if (u === 'AUTH LOGIN') w('334 VXNlcm5hbWU6');
          else if (u.startsWith('MAIL FROM') || u.startsWith('RCPT TO')) w('250 ok');
          else if (u === 'DATA') w('354 go');
          else if (u === 'QUIT') {
            w('221 bye');
            socket.end();
          }
        }
      });
      socket.on('error', () => {});
    });
    server.listen(0, '127.0.0.1', () => {
      resolve({
        server,
        connections: () => count,
        lines: () => lines,
        close: () => new Promise((done) => server.close(() => done())),
      });
    });
  });
}

test('جولة 2026-10-17: النقلُ (`createSmtpEgressTransport`) لا يفتحُ اتصالًا إلا عبرَ البوابةِ — والحمولةُ كاملةٌ', async () => {
  const smtp = await scriptedSmtpServer();
  const address = /** @type {import('node:net').AddressInfo} */ (smtp.server.address());
  /** @type {Array<{ destination: unknown, bytes: number, payload: string }>} */
  const transports = [];
  try {
    const config = { host: '127.0.0.1', port: address.port, user: 'user', password: 'pass' };
    const transport = createSmtpEgressTransport({ getSmtpConfig: () => config });
    const fakeEgressGate = {
      /**
       * @param {import('../../src/egress/egress-gate.mjs').EgressRequest} request
       */
      async send(request) {
        // البوابةُ هي من يستدعي النقلَ بعدَ التفويضِ — هنا نمثّل ذلك حرفيًا
        const record = {
          destination: request.destination,
          bytes: Buffer.byteLength(request.payload),
          payload: /** @type {string} */ (request.payload),
        };
        transports.push(record);
        const result = await transport(record);
        return {
          bytes: record.bytes,
          destination: request.destination,
          policyId: 'pol:egress-approved-destinations',
          result,
        };
      },
    };

    const channel = EmailChannel({ getSmtpConfig: () => config, egressGate: fakeEgressGate });
    const message = makeMessage();
    const result = await channel.send(message, 'test@example.com');
    // الخادمُ يرفضُ STARTTLS (454) فيفشلُ النقلُ — المهمُّ هنا أنَّ الاتصالَ وقعَ
    // عبرَ البوابةِ وحدَها (اتصالٌ واحدٌ = نقلٌ واحدٌ عبرَها) لا قبله.
    assert.equal(result.state, 'failed');
    assert.ok(
      result.failureReason !== null && result.failureReason.includes('EGRESS_TRANSPORT_FAILED'),
      `فشلُ النقلِ يظهرُ برمزِ النقلِ لا الرفضِ (م-3): ${result.failureReason}`,
    );
    assert.equal(smtp.connections(), 1, 'اتصالٌ واحدٌ فقط — عبرَ البوابةِ');
    assert.equal(transports.length, 1, 'النقلُ استُدعي مرةً واحدةً عبرَ البوابةِ');
    const firstTransport = transports[0];
    assert.ok(firstTransport !== undefined, 'نقلٌ واحدٌ عبرَ البوابةِ مضمونٌ قبلَ قراءتِهِ');
    const payload = JSON.parse(firstTransport.payload);
    assert.equal(payload.to, 'test@example.com');
    assert.equal(payload.subject, 'اختبار');
    assert.equal(payload.body, 'رسالة اختبار');
    assert.equal(payload.sentAtMs, message.sentAtMs, 'زمنُ الإرسالِ يمرُّ في الحمولةِ كاملًا');
    assert.ok(
      smtp.lines().some((l) => l.toUpperCase().startsWith('EHLO')),
      'وصلَ الحوارُ إلى SMTP فعلاً عبرَ النقلِ',
    );
  } finally {
    await smtp.close();
  }
});

test('جولة 2026-10-17: بلا بوابةٍ لا يُستدعى النقلُ ولا يُفتحُ اتصالٌ — حتى معَ وجودِ النقلِ', async () => {
  const smtp = await scriptedSmtpServer();
  const address = /** @type {import('node:net').AddressInfo} */ (smtp.server.address());
  try {
    const config = { host: '127.0.0.1', port: address.port, user: 'user', password: 'pass' };
    const transport = createSmtpEgressTransport({ getSmtpConfig: () => config });
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
    // والنقلُ المُهيَّأُ موجودٌ لكنَّهُ لا يُستدعى إلا منَ البوابةِ — القناةُ لا تعرفُهُ
    void transport;
  } finally {
    await smtp.close();
  }
});

test('جولة 2026-10-17: نقلُ البوابةِ يرفضُ الحمولةَ غيرَ المتوقعةِ ولا يفتحُ اتصالًا', async () => {
  const smtp = await scriptedSmtpServer();
  const address = /** @type {import('node:net').AddressInfo} */ (smtp.server.address());
  try {
    const config = { host: '127.0.0.1', port: address.port, user: 'user', password: 'pass' };
    const transport = createSmtpEgressTransport({ getSmtpConfig: () => config });
    await assert.rejects(
      () => transport({ destination: 'x', bytes: 3, payload: '{"not":"an email"}' }),
      (error) => {
        assert.match(
          String(/** @type {{ message?: string }} */ (error).message),
          /EGRESS_TRANSPORT_FAILED/,
        );
        return true;
      },
    );
    assert.equal(smtp.connections(), 0, 'لا اتصالَ لحمولةٍ مرفوضةٍ');
  } finally {
    await smtp.close();
  }
});

test('جولة 2026-10-17: النقلُ بلا إعدادِ SMTP يفشلُ لا يفتحُ اتصالًا', async () => {
  const smtp = await scriptedSmtpServer();
  try {
    const transport = createSmtpEgressTransport({ getSmtpConfig: () => null });
    await assert.rejects(() => transport({ destination: 'x', bytes: 1, payload: '{}' }), /SMTP/);
    assert.equal(smtp.connections(), 0);
  } finally {
    await smtp.close();
  }
});
