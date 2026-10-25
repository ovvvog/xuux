// موصلُ البريد — قناةُ إشعارٍ حقيقيّةٌ تُرسِلُ عبرَ SMTP.
//
// **R5-B-04 (CO55-M11.05-R3-01): القناةُ تمرُّ عبرَ بوابةِ الخروجِ لا تفتحُ
// اتصالًا مباشرةً.** بلا بوابةِ خروجٍ موصولةٍ يُرفضُ الإرسالُ قبلَ أيِّ اتصالٍ
// بـ`EGRESS_GATE_REQUIRED` — لا يخرجُ بايتٌ. والإرسالُ الخارجيُّ بلا بوابةٍ
// مسارٌ ممنوعٌ لا مسارٌ احتياطيٌّ (كما في `TelegramBotChannel`). والنقلُ نفسُهُ
// يقومُ به نقلُ البوابةِ (المركِّبُ يكتبُهُ في موقعِ التركيبِ) فتبقى القناةُ
// «اللمسَ» لا الناقلَ.
//
// **جولةُ إعادةِ الاختبارِ 2026-10-17 (حكمُ المجلسِ: النتيجةُ باقيةٌ مفتوحةً):**
// كانَ `sendSmtp` مُصدَّرًا خامًا من هذهِ الوحدةِ — فأيُّ مُركِّبٍ يستورِدُهُ يُرسِلُ
// بلا بوابةٍ (قِيسَ في الجولةِ: اتصالٌ واحدٌ و484 بايتًا). عولِجَ: **لم تعد الوحدةُ
// تُصدِّرُ أيَّ دالةِ إرسالٍ خامَةٍ** — بروتوكولُ SMTP صارَ إغلاقًا داخلَ الوحدةِ،
//
// **WL-426 (الجولةُ السادسةُ — حكمُ المجلسِ: النتيجةُ باقيةٌ مفتوحةً):** وجدَ
// عضوانِ مستقلّانِ من مزوِّدَينِ مختلفَينِ أنّ المصنعَ البديلَ
// `createSmtpEgressTransport` كانَ هو نفسُهُ مسارًا خامًا: استدعاؤهُ مباشرةً بسجلٍّ
// مُلفَّقٍ (بلا بوابةٍ إطلاقًا) فتحَ اتصالًا حقيقيًّا وأخرجَ الرسالةَ كاملةً
// (قِيسَ عندَ العضوَينِ وبإعادةِ إنتاجِ المنفِّذِ). وقاسَ العضوانِ أيضًا انفصالًا بينَ
// وجهةِ الإذنِ ووجهةِ النقلِ الفعليةِ لأنّ النقلَ كانَ يعيدُ قراءةَ الإعدادِ ويتجاهلُ
// وجهةَ السجلِّ. **الإصلاحُ:** اتباعُ سابقةِ Telegram الحرفيّةِ — **وحدةُ القناةِ
// تُصدِّرُ القناةَ وحدَها** ولا يُوجدُ على سطحِها أيُّ قدرةِ إرسالٍ أو بروتوكولِ SMTP:
// نقلُ البوابةِ يُكتَبُ في موقعِ التركيبِ (كودُ المُركِّبِ الموثوقِ) لا يُصدَّرُ من
// وحدةِ القناةِ. فمن أرادَ إرسالًا فلا سبيلَ إلا عبرَ بوابةٍ يركِّبُها — والقناةُ بلا
// بوابةٍ تُرفَضُ قبلَ أيِّ اتصالٍ.
//
// **حدٌّ معلَنٌ — لا سرَّ في الكود:** كلمةُ السرِّ تُقرأُ من متغيّرٍ بيئيٍّ
// (SMTP_PASSWORD) ولا تُكتبُ في الكودِ ولا السجلّ.
//
// **حدٌّ معلَنٌ — القبولُ ليس التسليم:** SMTP يُعيدُ قبولَ الرسالةِ للإرسال
// (250 OK) وهذا دليلُ قبولٍ لا دليلُ قراءة. فالحالةُ `sent` لا `delivered`.

import { createNotificationResult } from '../dispatcher.mjs';

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
