// موصلُ البريد — قناةُ إشعارٍ حقيقيّةٌ تُرسِلُ عبرَ SMTP.
//
// **R5-B-04 (CO55-M11.05-R3-01): القناةُ تمرُّ عبرَ بوابةِ الخروجِ لا تفتحُ
// اتصالًا مباشرةً.** بلا بوابةِ خروجٍ موصولةٍ يُرفضُ الإرسالُ قبلَ أيِّ اتصالٍ
// بـ`EGRESS_GATE_REQUIRED` — لا يخرجُ بايتٌ. والإرسالُ الخارجيُّ بلا بوابةٍ
// مسارٌ ممنوعٌ لا مسارٌ احتياطيٌّ (كما في `TelegramBotChannel`). والنقلُ نفسُهُ
// يقومُ به نقلُ البوابةِ (المركِّبُ يوصِلُهُ بـ`createSmtpEgressTransport`) فتبقى القناةُ
// «اللمسَ» لا الناقلَ.
//
// **جولةُ إعادةِ الاختبارِ 2026-10-17 (حكمُ المجلسِ: النتيجةُ باقيةٌ مفتوحةً):**
// كانَ `sendSmtp` مُصدَّرًا خامًا من هذهِ الوحدةِ — فأيُّ مُركِّبٍ يستورِدُهُ يُرسِلُ
// بلا بوابةٍ (قِيسَ في الجولةِ: اتصالٌ واحدٌ و484 بايتًا). عولِجَ: **لم تعد الوحدةُ
// تُصدِّرُ أيَّ دالةِ إرسالٍ خامَةٍ** — بروتوكولُ SMTP صارَ إغلاقًا داخلَ الوحدةِ،
// والوحيدُ المُتاحُ للمُركِّبِ هو `createSmtpEgressTransport` الذي يُنتِجُ **نقلَ
// بوابةٍ** (توقيعُهُ سجلُ البوابةِ لا «أرسِلْ هذهِ الرسالةَ») يُمرَّرُ للبوابةِ نفسِها
// في تركيبِها — وهو عقدُ الوحداتِ الموثوقةِ مثلَ نقلِ Telegram المكتوبِ في موقعِ
// التركيبِ لا مُصدَّرًا من وحدةِ القناةِ.
//
// **حدٌّ معلَنٌ — لا سرَّ في الكود:** كلمةُ السرِّ تُقرأُ من متغيّرٍ بيئيٍّ
// (SMTP_PASSWORD) ولا تُكتبُ في الكودِ ولا السجلّ.
//
// **حدٌّ معلَنٌ — القبولُ ليس التسليم:** SMTP يُعيدُ قبولَ الرسالةِ للإرسال
// (250 OK) وهذا دليلُ قبولٍ لا دليلُ قراءة. فالحالةُ `sent` لا `delivered`.

import { createNotificationResult } from '../dispatcher.mjs';
import tls from 'node:tls';
import net from 'node:net';

/**
 * موصلُ البريد — يُرسِلُ رسالةً عبرَ SMTP باستخدام وحدات Node.js المدمجة.
 *
 * @param {{
 *   getSmtpConfig: () => { host: string, port: number, user: string, password: string } | null,
 *   egressGate?: { send: (request: import('../../egress/egress-gate.mjs').EgressRequest) => Promise<{ bytes: number, destination: string, policyId: string | null, result: unknown }> } | null,
 *   actor?: import('../../policy/model.mjs').PolicyActor,
 * }} deps
 */
export function EmailChannel(deps) {
  return Object.freeze({
    name: 'email',

    /**
     * يُرسِلُ رسالةً عبرَ SMTP ويُعيدُ نتيجةً موحَّدة.
     * @param {import('../dispatcher.mjs').NotificationMessage} message
     * @param {string} destination — عنوانُ البريدِ
     * @returns {Promise<import('../dispatcher.mjs').NotificationResult>}
     */
    async send(message, destination) {
      const config = deps.getSmtpConfig();
      if (!config) {
        return createNotificationResult({
          channel: 'email',
          ownerId: message.ownerId,
          maskedDestination: maskEmail(destination),
          state: 'not_configured',
          attemptedAtMs: message.sentAtMs,
          failureReason: 'SMTP غيرُ مُعدّ',
        });
      }

      // R5-B-04 (CO55-M11.05-R3-01): القناةُ تمرُّ عبرَ بوابةِ الخروجِ لا تفتحُ
      // اتصالًا. البوابةُ تفحصُ الجهةَ (مضيفُ SMTP) والحمولةَ (الرسالةُ كاملةً)
      // والتصنيفَ قبلَ النقلِ، ونقلُها هو من يُرسِل.
      const egressGate = deps.egressGate;
      const actor = deps.actor ?? { id: 'system:notifications', role: 'system', state: 'active' };

      if (egressGate) {
        try {
          const payload = JSON.stringify({
            to: destination,
            subject: message.subject,
            body: message.body,
            sentAtMs: message.sentAtMs,
          });
          const egressResult = await egressGate.send({
            actor,
            destination: config.host,
            payload,
            classification: 'internal',
            context: { channel: 'email', port: config.port },
          });
          const result = /** @type {unknown} */ (egressResult.result);
          if (result !== null && typeof result === 'object' && 'messageId' in result) {
            const data = /** @type {{ messageId?: unknown }} */ (result);
            const messageId =
              data.messageId !== null && data.messageId !== undefined
                ? String(data.messageId)
                : null;
            return createNotificationResult({
              channel: 'email',
              ownerId: message.ownerId,
              maskedDestination: maskEmail(destination),
              state: 'sent',
              attemptedAtMs: message.sentAtMs,
              providerMessageId: messageId,
              providerResult: '250 OK',
              egressBytes: egressResult.bytes,
            });
          }
          // النتيجةُ ليست ما يتوقّعُه عقدُ النقلِ
          return createNotificationResult({
            channel: 'email',
            ownerId: message.ownerId,
            maskedDestination: maskEmail(destination),
            state: 'failed',
            attemptedAtMs: message.sentAtMs,
            failureReason: 'EGRESS_TRANSPORT_FAILED: نتيجة غير متوقعة',
          });
        } catch (/** @type {unknown} */ error) {
          // م-3 (جولةُ 2026-10-17): رفضُ البوابةِ وفشلُ النقلِ رمزانِ مختلفانِ —
          // خطأُ البوابةِ يحملُ `code` من `EGRESS_ERRORS` فلا يُلَفُّ كلُّ خطأٍ
          // برمزِ الرفضِ. فشلُ النقلِ الحقيقيِّ يظهرُ في نتيجةِ القناةِ كما وُصِفَ.
          const code =
            error !== null && typeof error === 'object' && 'code' in error
              ? String(/** @type {{ code?: unknown }} */ (error).code)
              : '';
          const isRefusal = code.startsWith('EGRESS_') && code !== 'EGRESS_TRANSPORT_FAILED';
          // الرفضُ يبقى برمزِهِ المستقرِّ (`EGRESS_REFUSED`) معَ ظهورِ رمزِ البوابةِ
          // المحدَّدِ في الرسالةِ — لا رمزًا مُلَفَّقًا يُخفي سببَ الرفضِ.
          const prefix = isRefusal ? 'EGRESS_REFUSED' : 'EGRESS_TRANSPORT_FAILED';
          const detail = isRefusal && code ? ` (${code})` : '';
          return createNotificationResult({
            channel: 'email',
            ownerId: message.ownerId,
            maskedDestination: maskEmail(destination),
            state: 'failed',
            attemptedAtMs: message.sentAtMs,
            failureReason: `${prefix}${detail}: ${error instanceof Error ? error.message : String(error)}`,
          });
        }
      }

      // R5-B-04: بلا بوابةِ خروجٍ لا يخرجُ بايتٌ — لا اتصالَ يُفتَحُ أصلاً.
      // الإرسالُ الخارجيُّ بلا بوابةٍ مسارٌ ممنوعٌ لا مسارٌ احتياطيٌّ.
      return createNotificationResult({
        channel: 'email',
        ownerId: message.ownerId,
        maskedDestination: maskEmail(destination),
        state: 'failed',
        attemptedAtMs: message.sentAtMs,
        failureReason:
          'EGRESS_GATE_REQUIRED: لا يمكنُ الإرسالُ الخارجيُّ بلا بوابةِ خروجٍ موصولةٍ (R5-B-04)',
      });
    },
  });
}

/**
 * يُخفي عنوانَ البريدِ في السجلِّ.
 * @param {string} email
 * @returns {string}
 */
function maskEmail(email) {
  const [local = '', domain = ''] = email.split('@');
  if (!domain || local.length <= 2) return `*@${domain ?? ''}`;
  return `${local[0]}***${local[local.length - 1]}@${domain}`;
}

/**
 * مصنعُ نقلِ بوابةِ الخروجِ لقناةِ البريد (R5-B-04 — جولةُ 2026-10-17).
 *
 * **هذا ليسَ دالةَ إرسالٍ خامَةً بل نقلُ بوابةٍ:** توقيعُهُ سجلُ البوابةِ
 * (‏`{ destination, bytes, payload }`) لا «أرسِلْ هذهِ الرسالةَ»، ولا يُستدعى
 * إلّا منَ البوابةِ نفسِها بعدَ التفويضِ — المُركِّبُ يُمرِّرُهُ في `transport`
 * عندَ تركيبِ البوابةِ (عقدُ الوحداتِ الموثوقةِ مثلَ نقلِ Telegram المكتوبِ في
 * موقعِ التركيبِ). بروتوكولُ SMTP نفسُهُ (`sendSmtp`) إغلاقٌ داخلَ الوحدةِ لا
 * يُصدَّرُ — فلا مسارَ إرسالٍ خارجَ البوابةِ على سطحِ الوحدةِ.
 *
 * @param {{ getSmtpConfig: () => { host: string, port: number, user: string, password: string } | null }} deps
 * @returns {(record: { destination: unknown, bytes: number, payload: string | Uint8Array }) => Promise<{ messageId: string | null }>}
 */
export function createSmtpEgressTransport(deps) {
  return async function smtpEgressTransport(record) {
    const config = deps.getSmtpConfig();
    if (!config) {
      throw new Error('SMTP غيرُ مُعدّ');
    }
    const raw =
      typeof record.payload === 'string'
        ? record.payload
        : Buffer.from(record.payload).toString('utf8');
    /** @type {{ to?: unknown, subject?: unknown, body?: unknown, sentAtMs?: unknown }} */
    const parsed = JSON.parse(raw);
    if (
      typeof parsed.to !== 'string' ||
      typeof parsed.subject !== 'string' ||
      typeof parsed.body !== 'string'
    ) {
      throw new Error('EGRESS_TRANSPORT_FAILED: حمولةُ النقلِ ليست رسالةَ بريدٍ متوقعةً');
    }
    const message = {
      ownerId: 'owner:egress-transport',
      channel: 'email',
      subject: parsed.subject,
      body: parsed.body,
      sentAtMs: typeof parsed.sentAtMs === 'number' ? parsed.sentAtMs : Date.now(),
    };
    return sendSmtp(config, message, parsed.to);
  };
}

/**
 * يُرسِلُ رسالةً عبرَ SMTP باستخدام STARTTLS و AUTH LOGIN.
 *
 * يعالج ردودَ SMTP متعددةَ الأسطر: الردُّ الأخيرُ له مسافةٌ بعد الرمزِ (250 OK)
 * والردودُ الوسيطةُ لها شرطةٌ (250-SIZE).
 *
 * @param {{ host: string, port: number, user: string, password: string }} config
 * @param {import('../dispatcher.mjs').NotificationMessage} message
 * @param {string} to
 * @returns {Promise<{ messageId: string | null }>}
 */
function sendSmtp(config, message, to) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(config.port, config.host);
    /** @type {import('node:tls').TLSSocket | null} */
    let tlsSocket = null;
    let step = 'connect';
    let buffer = '';
    let currentSocket = socket;
    let multilineCode = 0;
    let multilineText = '';

    const cleanup = () => {
      socket.destroy();
      if (tlsSocket) tlsSocket.destroy();
    };

    /** @param {string} reason */
    const fail = (reason) => {
      cleanup();
      reject(new Error(`SMTP ${step}: ${reason}`));
    };

    /** @param {string} cmd */
    const sendCommand = (cmd) => {
      currentSocket.write(cmd + '\r\n');
    };

    /** @param {string} line */
    const handleLine = (line) => {
      const code = parseInt(line.slice(0, 3), 10);

      // ردٌّ متعددُ الأسطرِ: السطرُ يبدأُ بالرمزِ متبوعاً بشرطةٍ (250-SIZE)
      // السطرُ الأخيرُ يبدأُ بالرمزِ متبوعاً بمسافةٍ (250 OK)
      const isContinuation = line.length > 3 && line[3] === '-';

      if (isContinuation) {
        multilineCode = code;
        multilineText = line;
        return; // انتظرِ السطرَ الأخير
      }

      const finalCode = multilineCode || code;
      const finalText = multilineText || line;
      multilineCode = 0;
      multilineText = '';

      if (finalCode >= 500 && step !== 'body') {
        fail(finalText);
        return;
      }

      switch (step) {
        case 'connect':
          if (finalCode === 220) {
            step = 'ehlo';
            sendCommand(`EHLO ${config.host}`);
          }
          break;
        case 'ehlo':
          if (finalCode === 250) {
            step = 'starttls';
            sendCommand('STARTTLS');
          }
          break;
        case 'starttls':
          if (finalCode === 220) {
            step = 'tls_handshake';
            socket.removeAllListeners('data');
            socket.removeAllListeners('error');
            tlsSocket = tls.connect(
              {
                socket,
                servername: config.host,
              },
              () => {
                currentSocket = /** @type {import('node:net').Socket} */ (tlsSocket);
                step = 'ehlo_tls';
                sendCommand(`EHLO ${config.host}`);
              },
            );
            tlsSocket.on('data', onData);
            tlsSocket.on('error', (err) => fail(err.message));
          }
          break;
        case 'ehlo_tls':
          if (finalCode === 250) {
            step = 'auth';
            sendCommand('AUTH LOGIN');
          }
          break;
        case 'auth':
          if (finalCode === 334) {
            step = 'auth_user';
            sendCommand(Buffer.from(config.user).toString('base64'));
          } else {
            fail('AUTH LOGIN rejected');
          }
          break;
        case 'auth_user':
          if (finalCode === 334) {
            step = 'auth_pass';
            sendCommand(Buffer.from(config.password).toString('base64'));
          } else {
            fail('Username rejected');
          }
          break;
        case 'auth_pass':
          if (finalCode === 235) {
            step = 'mail_from';
            sendCommand(`MAIL FROM:<${config.user}>`);
          } else {
            fail('Authentication failed');
          }
          break;
        case 'mail_from':
          if (finalCode === 250) {
            step = 'rcpt_to';
            sendCommand(`RCPT TO:<${to}>`);
          }
          break;
        case 'rcpt_to':
          if (finalCode === 250) {
            step = 'data';
            sendCommand('DATA');
          }
          break;
        case 'data':
          if (finalCode === 354) {
            step = 'body';
            const emailBody = buildEmailBody(message, to, config.user);
            currentSocket.write(emailBody + '\r\n.\r\n');
          }
          break;
        case 'body':
          if (finalCode === 250) {
            const messageIdMatch = finalText.match(/<[^>]+>/);
            step = 'quit';
            sendCommand('QUIT');
            resolve({ messageId: messageIdMatch ? messageIdMatch[0] : null });
          }
          break;
        case 'quit':
          cleanup();
          break;
      }
    };

    /** @param {Buffer} data */
    const onData = (data) => {
      buffer += data.toString();
      while (buffer.includes('\r\n')) {
        const line = buffer.slice(0, buffer.indexOf('\r\n'));
        buffer = buffer.slice(buffer.indexOf('\r\n') + 2);
        handleLine(line);
      }
    };

    socket.on('data', onData);
    socket.on('error', (err) => fail(err.message));
    socket.setTimeout(30000, () => fail('timeout'));
  });
}

/**
 * يبني نصَ رسالةِ البريدِ بصيغةِ RFC 5322.
 * @param {import('../dispatcher.mjs').NotificationMessage} message
 * @param {string} to
 * @param {string} from
 * @returns {string}
 */
function buildEmailBody(message, to, from) {
  const date = new Date(message.sentAtMs).toUTCString();
  const headers = [
    `From: Xuux State <${from}>`,
    `To: <${to}>`,
    `Subject: ${message.subject}`,
    `Date: ${date}`,
    `MIME-Version: 1.0`,
    `Content-Type: text/plain; charset=UTF-8`,
    `Content-Transfer-Encoding: 8bit`,
  ];
  return headers.join('\r\n') + '\r\n\r\n' + message.body;
}
