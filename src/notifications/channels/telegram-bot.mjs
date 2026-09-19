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
//
// **R5-B-04 (تقرير: R5-B-02):** الإرسالُ الخارجيُّ يمرُّ عبرَ بوابةِ الخروجِ.
// القناةُ لا تنادي `fetch` مباشرةً ما دامت البوابةُ موصولةً. إن رُفِضَ الخروجُ،
// تُعاد نتيجةُ فشلٍ بلا نقل.

import { createNotificationResult } from '../dispatcher.mjs';

/**
 * موصلُ Telegram Bot — يُرسِلُ رسالةً عبرَ Telegram Bot API.
 *
 * @param {{
 *   getToken: () => string | undefined,
 *   egressGate?: { send: (request: object) => Promise<{ bytes: number, destination: string, policyId: string | null, result: unknown }> } | null,
 *   actor?: { id: string },
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
      const payload = JSON.stringify({
        chat_id: destination,
        text,
        parse_mode: 'HTML',
      });

      // R5-B-04 (تقرير: R5-B-02): القناةُ تمرُّ عبرَ بوابةِ الخروجِ لا تنادي
      // `fetch` مباشرةً. البوابةُ تفحصُ الجهةَ والحمولةَ والتصنيفَ قبلَ النقل.
      const egressGate = deps.egressGate;
      const actor = deps.actor ?? { id: 'system:notifications' };

      if (egressGate) {
        try {
          const egressResult = await egressGate.send({
            actor,
            destination: 'telegram-api',
            payload,
            classification: 'internal',
            context: { channel: 'telegram_bot', chatId: destination },
          });
          const result = egressResult.result;
          if (result && typeof result === 'object' && 'ok' in result) {
            const data = /** @type {any} */ (result);
            if (!data.ok) {
              return createNotificationResult({
                channel: 'telegram_bot',
                ownerId: message.ownerId,
                maskedDestination: maskChatId(destination),
                state: 'failed',
                attemptedAtMs: message.sentAtMs,
                providerResult: sanitizeTelegramResult(data),
                failureReason: data.description ?? 'EGRESS_TRANSPORT_FAILED',
              });
            }
            const messageId =
              data.result?.message_id != null ? String(data.result.message_id) : null;
            return createNotificationResult({
              channel: 'telegram_bot',
              ownerId: message.ownerId,
              maskedDestination: maskChatId(destination),
              state: 'sent',
              attemptedAtMs: message.sentAtMs,
              providerMessageId: messageId,
              providerResult: 'ok',
              egressBytes: egressResult.bytes,
            });
          }
          // النتيجةُ ليست JSON متوقَّعاً
          return createNotificationResult({
            channel: 'telegram_bot',
            ownerId: message.ownerId,
            maskedDestination: maskChatId(destination),
            state: 'failed',
            attemptedAtMs: message.sentAtMs,
            failureReason: 'EGRESS_TRANSPORT_FAILED: نتيجة غير متوقعة',
          });
        } catch (error) {
          return createNotificationResult({
            channel: 'telegram_bot',
            ownerId: message.ownerId,
            maskedDestination: maskChatId(destination),
            state: 'failed',
            attemptedAtMs: message.sentAtMs,
            failureReason: `EGRESS_REFUSED: ${error instanceof Error ? error.message : String(error)}`,
          });
        }
      }

      // R5-B-04: بلا بوابةِ خروجٍ لا يخرجُ بايتٌ. الإرسالُ الخارجيُّ بلا
      // بوابةٍ مسارٌ ممنوعٌ لا مسارٌ احتياطيٌّ.
      return createNotificationResult({
        channel: 'telegram_bot',
        ownerId: message.ownerId,
        maskedDestination: maskChatId(destination),
        state: 'failed',
        attemptedAtMs: message.sentAtMs,
        failureReason:
          'EGRESS_GATE_REQUIRED: لا يمكنُ الإرسالُ الخارجيُّ بلا بوابةِ خروجٍ موصولةٍ (R5-B-04)',
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
