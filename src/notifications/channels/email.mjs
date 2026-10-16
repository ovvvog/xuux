// موصلُ البريد — قناةُ إشعارٍ حقيقيّةٌ تُرسِلُ عبرَ SMTP.
//
// **R5-B-04 (CO55-M11.05-R3-01): القناةُ تمرُّ عبرَ بوابةِ الخروجِ لا تفتحُ
// اتصالًا مباشرةً.** بلا بوابةِ خروجٍ موصولةٍ يُرفضُ الإرسالُ قبلَ أيِّ اتصالٍ
// بـ`EGRESS_GATE_REQUIRED` — لا يخرجُ بايتٌ. والإرسالُ الخارجيُّ بلا بوابةٍ
// مسارٌ ممنوعٌ لا مسارٌ احتياطيٌّ (كما في `TelegramBotChannel`). والنقلُ نفسُهُ
// يقومُ به نقلُ البوابةِ (المركِّبُ يوصِلُهُ بـ`sendSmtp`) فتبقى القناةُ
// «اللمسَ» لا الناقلَ.
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
 *   egressGate?: { send: (request: { actor: { id: string }, destination: string, payload: string, classification: string, context: Record<string, unknown> }) => Promise<{ bytes: number, destination: string, policyId: string | null, result: unknown }> } | null,
 *   actor?: { id: string },
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
      const actor = deps.actor ?? { id: 'system:notifications' };

      if (egressGate) {
        try {
          const payload = JSON.stringify({
            to: destination,
            subject: message.subject,
            body: message.body,
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
          return createNotificationResult({
            channel: 'email',
            ownerId: message.ownerId,
            maskedDestination: maskEmail(destination),
            state: 'failed',
            attemptedAtMs: message.sentAtMs,
            failureReason: `EGRESS_REFUSED: ${error instanceof Error ? error.message : String(error)}`,
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
export function sendSmtp(config, message, to) {
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
