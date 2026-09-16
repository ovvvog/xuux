# طبقةُ الإشعارات

## نظرةٌ عامّةٌ

طبقةُ قنواتِ إشعارٍ قابلةٌ للتوسعة. تُوفّرُ واجهةً موحَّدةً لكلِّ قناةٍ (Telegram،
بريد، WhatsApp، Instagram، X/Twitter، SMS) مع حالاتٍ موحَّدةٍ وسجلِّ تدقيقٍ دائم.

## الوحداتُ

### `src/notifications/dispatcher.mjs`

- `NotificationDispatcher` — يحقنُ القنواتِ ويُوزِّعُ الإرسال.
  - `dispatch(message, destination)` — يُرسِلُ رسالةً عبر القناةِ المحدّدة.
  - `assertNotLoopback(destination)` — يرفضُ وجهاتِ loopback.
  - `isLoopbackDestination(destination)` — يتحقّقُ من وجهاتِ loopback.
  - `maskDestination(destination)` — يُخفي الوجهةَ في السجل.
  - `createNotificationResult(opts)` — يُنشئُ نتيجةً موحَّدة.
  - `#recordAudit(result, message)` — يُقيِّدُ النتيجةَ في السجلِّ الدائم.

### `src/notifications/channels/telegram-bot.mjs`

- `TelegramBotChannel(deps)` — قناةُ Telegram Bot باستخدام `fetch`.
  - يقرأُ `TELEGRAM_BOT_TOKEN` من البيئةِ عبر `deps.getToken()`.
  - يُرسِلُ رسالةً إلى `chat_id` محدّد.
  - العنوانُ من البيئةِ لا من الشفرة.

### `src/notifications/channels/email.mjs`

- `EmailChannel(deps)` — قناةُ بريدٍ باستخدام `node:tls` و`node:net`.
  - يقرأُ إعدادَ SMTP من البيئةِ عبر `deps.getSmtpConfig()`.
  - يدعمُ STARTTLS وAUTH LOGIN وردودَ SMTP متعددةَ الأسطر.
  - لا يعتمدُ على `nodemailer` — مُنفَّذٌ من الصفر.

## الحالاتُ الموحَّدة

| الحالةُ | المعنى |
|---------|--------|
| `accepted` | القُبلت الرسالةُ للإرسال |
| `sent` | أُرسِلَت الرسالةُ وقُبِلَت من المزوّد |
| `delivered` | تأكَّدَ وصولُ الرسالة |
| `failed` | فشلَ الإرسالُ |
| `unsupported` | القناةُ غيرُ مدعومة |
| `not_configured` | القناةُ غيرُ مُعدّة |

## منعُ Loopback

`NotificationDispatcher` يرفضُ صراحةً أيَّ وجهةٍ تبدأُ بـ:
- `localhost`
- `127.0.0.1`
- `0.0.0.0`
- `[::1]`

والاختبارُ الخارجيُّ يرفضُ `mock` و`loopback` من الاعتبارِ نجاحاً للإغلاق.

## القنواتُ المستقبلية

الواجهةُ مُجهَّزةٌ للقنواتِ التالية (غيرُ منفَّذةٍ بعدُ):
- WhatsApp
- Instagram
- X/Twitter
- SMS

## الاختبارُ الخارجيُّ

`tests/notifications/external-delivery.test.mjs`:
- **Telegram Bot**: إرسالٌ حقيقيٌّ ناجحٌ (message_id من المزوّد).
- **البريد**: مُتخطّىٌ (يحتاج بياناتِ اعتمادِ SMTP صحيحة).
