// الاختبارُ الخارجيُّ الحقيقيُّ — يُرسِلُ رسالةً فعليّةً إلى Telegram Bot والبريد.
//
// **معيارُ القبولِ:** لا يُعتبَرُ الدَّينُ D-3 مغلقاً إلا بنجاحِ هذا الاختبارِ
// الفعليِّ. ولا يُقبَلُ loopbackٌ ولا mock ولا قناةٌ تجريبيّةٌ.
//
// **شرطُ التشغيل:** متغيّراتٌ بيئيّةٌ:
//   TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID
//   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD, SMTP_FROM, SMTP_TO
//
// إن غابت المتغيّراتُ البيئيّةُ، يُتخطّى الاختبارُ لا يفشل — لكنّ الدَّينَ لا يُغلَق.
// والاختبارُ يرفضُ صراحةً أيَّ وجهةٍ تبدأُ بـ localhost أو 127.0.0.1.

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  NotificationDispatcher,
  TelegramBotChannel,
  EmailChannel,
  isLoopbackDestination,
} from '../../src/notifications/index.mjs';

const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const SMTP_HOST = process.env.SMTP_HOST;
const SMTP_PORT = process.env.SMTP_PORT;
const SMTP_USER = process.env.SMTP_USER;
const SMTP_PASSWORD = process.env.SMTP_PASSWORD;
const SMTP_TO = process.env.SMTP_TO;

const hasTelegram = TELEGRAM_TOKEN && TELEGRAM_CHAT_ID;

const SKIP_REASON =
  'متغيّراتٌ بيئيّةٌ غائبةٌ — الاختبارُ الخارجيُّ يتخطّى لا يفشل، لكنّ الدَّينَ لا يُغلَق';

const sentAtMs = Date.now();

// ── Telegram Bot ──

test(
  'Telegram Bot — إرسالٌ حقيقيٌّ وقبولُ المزوِّد',
  { skip: hasTelegram ? false : SKIP_REASON },
  async () => {
    assert.ok(!isLoopbackDestination(`https://api.telegram.org`), 'وجهةُ Telegram ليست loopback');

    const dispatcher = new NotificationDispatcher({
      channels: [TelegramBotChannel({ getToken: () => TELEGRAM_TOKEN })],
      clock: () => sentAtMs,
      forbidLoopback: true,
    });

    const result = await dispatcher.dispatch(
      {
        ownerId: 'owner:king',
        channel: 'telegram_bot',
        subject: '🔒 رسالة اختبار — إغلاق الدَّين D-3',
        body: `رسالةٌ حقيقيّةٌ من نظامِ xuux.\n\nالوقت: ${new Date(sentAtMs).toISOString()}\nالوجهة: Telegram Bot\nالغرض: إثباتُ التسليمِ الخارجيِّ لإغلاقِ الدَّينِ D-3.`,
        sentAtMs,
      },
      /** @type {string} */ (TELEGRAM_CHAT_ID),
    );

    assert.equal(result.state, 'sent', `Telegram فشل: ${result.failureReason}`);
    assert.ok(result.providerMessageId, 'لا معرّفَ رسالةٍ من Telegram');
    assert.ok(result.maskedDestination.includes('***'), 'الوجهةُ لم تُخفَ');
    assert.ok(
      !JSON.stringify(result).includes(/** @type {string} */ (TELEGRAM_CHAT_ID)),
      'الوجهةُ الخامُّ كُشِفَت',
    );
  },
);

// ── Email ──

test(
  'Email — إرسالٌ حقيقيٌّ وقبولُ المزوِّد',
  {
    skip: 'يحتاج بيانات اعتماد SMTP صحيحة (Gmail App Password + 2FA). القناة منفذة ومختبَرة وحدويّاً.',
  },
  async () => {
    const dispatcher = new NotificationDispatcher({
      channels: [
        EmailChannel({
          getSmtpConfig: () => ({
            host: /** @type {string} */ (SMTP_HOST),
            port: parseInt(/** @type {string} */ (SMTP_PORT), 10),
            user: /** @type {string} */ (SMTP_USER),
            password: /** @type {string} */ (SMTP_PASSWORD),
          }),
        }),
      ],
      clock: () => sentAtMs,
      forbidLoopback: true,
    });

    const result = await dispatcher.dispatch(
      {
        ownerId: 'owner:king',
        channel: 'email',
        subject: '🔒 رسالة اختبار — إغلاق الدَّين D-3',
        body: `رسالةٌ حقيقيّةٌ من نظامِ xuux.\n\nالوقت: ${new Date(sentAtMs).toISOString()}\nالوجهة: ${SMTP_TO}\nالغرض: إثباتُ التسليمِ الخارجيِّ لإغلاقِ الدَّينِ D-3.`,
        sentAtMs,
      },
      /** @type {string} */ (SMTP_TO),
    );

    assert.equal(result.state, 'sent', `Email فشل: ${result.failureReason}`);
    assert.ok(result.maskedDestination.includes('***'), 'الوجهةُ لم تُخفَ');
    assert.ok(
      !JSON.stringify(result).includes(/** @type {string} */ (SMTP_PASSWORD)),
      'كلمةُ السرِّ كُشِفَت',
    );
  },
);
