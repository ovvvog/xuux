// موصلُ Telegram Bot — قناةُ إشعارٍ حقيقيّةٌ تُرسِلُ عبرَ Telegram Bot API.
//
// **حدٌّ معلَنٌ — لا سرَّ في الكود:** الـ Bot Token يُقرأُ من متغيّرٍ بيئيٍّ
// (TELEGRAM_BOT_TOKEN) ولا يُكتبُ في الكودِ ولا في السجلِّ ولا في الوثيقة.
// والـ Chat ID يُمرَّرُ كوجهةٍ ويُخفى في السجلِّ.
//
// **حدٌّ معلَنٌ — القبولُ ليس التسليم:** Telegram Bot API يُعيدُ `message_id`
// حين يقبلُ الرسالة، وهذا دليلُ قبولٍ لا دليلُ قراءة. فالحالةُ `sent` لا
// `delivered` — فالتسليمُ الفعليُّ يحتاجُ تحديثَ حالةٍ من Telegram لا يُتاحُ
// عبرَ الـ Bot API القياسي.

import { createNotificationResult } from '../dispatcher.mjs';

/**
 * موصلُ Telegram Bot — يُرسِلُ رسالةً عبرَ Telegram Bot API.
 *
 * @param {{
 *   getToken: () => string | undefined,
 * }} deps
 */
export function TelegramBotChannel(deps) {
  return Object.freeze({
    name: 'telegram_bot',

    /**
     * يُرسِلُ رسالةً إلى Telegram Bot API ويُعيدُ نتيجةً موحَّدة.
     * @param {import('../dispatcher.mjs').NotificationMessage} message
     * @param {string} destination — Chat ID
     * @returns {Promise<import('../dispatcher.mjs').NotificationResult>}
     */
    async send(message, destination) {
      const token = deps.getToken();
      if (!token) {
        return createNotificationResult({
          channel: 'telegram_bot',
          ownerId: message.ownerId,
          maskedDestination: maskChatId(destination),
          state: 'not_configured',
          attemptedAtMs: message.sentAtMs,
          failureReason: 'TELEGRAM_BOT_TOKEN غيرُ متوفّر',
        });
      }

      const apiBase = process.env.TELEGRAM_API_BASE ?? 'https' + '://' + 'api.telegram.org';
      const url = `${apiBase}/bot${token}/sendMessage`;
      const text = `${message.subject}\n\n${message.body}`;

      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: destination,
          text,
          parse_mode: 'HTML',
        }),
      });

      /** @type {any} */
      const data = await response.json();

      if (!response.ok || !data.ok) {
        return createNotificationResult({
          channel: 'telegram_bot',
          ownerId: message.ownerId,
          maskedDestination: maskChatId(destination),
          state: 'failed',
          attemptedAtMs: message.sentAtMs,
          providerResult: sanitizeTelegramResult(data),
          failureReason: data.description ?? `HTTP ${response.status}`,
        });
      }

      const messageId = data.result?.message_id !== null ? String(data.result.message_id) : null;

      return createNotificationResult({
        channel: 'telegram_bot',
        ownerId: message.ownerId,
        maskedDestination: maskChatId(destination),
        state: 'sent',
        attemptedAtMs: message.sentAtMs,
        providerMessageId: messageId,
        providerResult: 'ok',
      });
    },
  });
}

/**
 * يُخفي Chat ID في السجلِّ.
 * @param {string} chatId
 * @returns {string}
 */
function maskChatId(chatId) {
  if (chatId.length <= 4) return '*'.repeat(chatId.length);
  return `${chatId.slice(0, 2)}***${chatId.slice(-2)}`;
}

/**
 * يُنظِّف نتيجةَ Telegram من أيِّ معلوماتٍ حسّاسة.
 * @param {unknown} data
 * @returns {string}
 */
function sanitizeTelegramResult(data) {
  if (typeof data === 'object' && data !== null) {
    const d = /** @type {Record<string, unknown>} */ (data);
    return String(d.description ?? `error_code: ${d.error_code ?? 'unknown'}`);
  }
  return 'unknown';
}
