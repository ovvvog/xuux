// طبقةُ قنواتِ الإشعارات — واجهةٌ عامةٌ قابلةٌ للتوسعةِ لموصلاتٍ مستقلّة.
//
// **الفكرةُ الأساسيةُ:** لا تُبنى قناةٌ واحدةٌ بترميزٍ خاص. كلُّ قناةٍ موصلٌ
// مستقلٌّ يُحقنُ في المُرسِل، والنتيجةُ موحَّدةٌ عبرَ كلِّ القنوات. فإضافةُ
// قناةٍ جديدةٍ تعني إضافةَ موصلٍ جديدٍ لا إعادةَ كتابةِ المُرسِل.
//
// **وحدٌّ معلَنٌ أول — الحكمُ نقيٌّ واللمسُ محصور:** المُرسِلُ (`NotificationDispatcher`)
// حكمٌ نقيٌّ — يأخذُ قنواتٍ مُحقنةً ويُوجِّهُ الرسالةَ ويُقيِّدُ النتيجة. لا يُرسِلُ
// شيئاً بنفسِه. والقنواتُ (`TelegramBotChannel`، `EmailChannel`) هي اللمسُ — تُرسِلُ
// فعلاً وتُعيدُ النتيجة.
//
// **وحدٌّ معلَنٌ ثانٍ — القبولُ ليس التسليم:** لا يُدَّعى أنّ الرسالةَ وصلت لمجرّدِ
// أنّ طلبَ HTTP نجح. فرّق بين قبولِ المزوِّدِ للرسالةِ (`accepted`/`sent`) وبين
// التسليمِ الفعليِّ (`delivered`). و`delivered` لا يُكتبُ إلا بدليلِ تسليمٍ فعلي.
//
// **وحدٌّ معلَنٌ ثالثٌ — لا loopbackَ ولا mock:** لا يُعتبَرُ اختبارٌ على `localhost`
// أو `127.0.0.1` أو `mock` نجاحاً للإغلاق. والاختبارُ يرفضُ صراحةً أيَّ وجهةٍ
// تبدأُ بـ`http://localhost` أو `http://127.0.0.1`.

/**
 * @typedef {'accepted' | 'sent' | 'delivered' | 'failed' | 'unsupported' | 'not_configured'} NotificationState
 *
 * @typedef {object} NotificationResult
 * @property {string} channel — اسمُ القناةِ (telegram_bot, email, ...)
 * @property {string} ownerId — معرّفُ المالك
 * @property {string} maskedDestination — الوجهةُ بعد الإخفاء
 * @property {NotificationState} state
 * @property {number} attemptedAtMs
 * @property {string | null} providerMessageId — معرّفُ الرسالةِ لدى المزوِّد
 * @property {string | null} providerResult — نتيجةُ المزوِّد (مُنظَّفة)
 * @property {string | null} failureReason
 * @property {string | null} auditRef — مرجعُ سجلِّ التدقيق
 *
 * @typedef {object} NotificationMessage
 * @property {string} ownerId
 * @property {string} channel — اسمُ القناةِ المطلوبة
 * @property {string} subject
 * @property {string} body
 * @property {number} sentAtMs
 *
 * @typedef {object} NotificationChannel
 * @property {string} name — اسمُ القناةِ (telegram_bot, email, ...)
 * @property {(message: NotificationMessage, destination: string) => Promise<NotificationResult>} send
 */

import { NOTIFICATION_ERRORS, NotificationError } from './errors.mjs';

const LOOPBACK_RE = /^(https?:\/\/)?(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])/i;

/**
 * يرفضُ وجهاتِ loopback وmock — لا يُعتبَرُ اختبارٌ عليها نجاحاً للإغلاق.
 * @param {string} destination
 * @returns {boolean}
 */
export function isLoopbackDestination(destination) {
  return LOOPBACK_RE.test(destination);
}

/**
 * يُتحقَّقُ من أنّ الوجهةَ ليست loopback — ويرفضُها إن كانت.
 * @param {string} destination
 * @throws {NotificationError} LOOPBACK_FORBIDDEN
 */
export function assertNotLoopback(destination) {
  if (isLoopbackDestination(destination)) {
    throw new NotificationError(
      NOTIFICATION_ERRORS.LOOPBACK_FORBIDDEN,
      'وجهةُ loopback أو mock لا تُعتبَرُ نجاحاً للإغلاق',
      { destination: '***' },
    );
  }
}

/**
 * يُنشئُ نتيجةَ إشعارٍ موحَّدةً عبرَ كلِّ القنوات.
 * @param {{
 *   channel: string,
 *   ownerId: string,
 *   maskedDestination: string,
 *   state: NotificationState,
 *   attemptedAtMs: number,
 *   providerMessageId?: string | null,
 *   providerResult?: string | null,
 *   failureReason?: string | null,
 *   auditRef?: string | null,
 * }} input
 * @returns {NotificationResult}
 */
export function createNotificationResult(input) {
  return Object.freeze({
    channel: input.channel,
    ownerId: input.ownerId,
    maskedDestination: input.maskedDestination,
    state: input.state,
    attemptedAtMs: input.attemptedAtMs,
    providerMessageId: input.providerMessageId ?? null,
    providerResult: input.providerResult ?? null,
    failureReason: input.failureReason ?? null,
    auditRef: input.auditRef ?? null,
  });
}

/**
 * المُرسِلُ — حكمٌ نقيٌّ يأخذُ قنواتٍ مُحقنةً ويُوجِّهُ الرسالةَ ويُقيِّدُ النتيجة.
 *
 * لا يُرسِلُ شيئاً بنفسِه. كلُّ قناةٍ موصلٌ مُحقنٌ، والنتيجةُ موحَّدةٌ عبرَ كلِّها.
 * والسجلُّ الدائمُ مُحقنٌ — فلا إرسالَ بلا أثر.
 */
export class NotificationDispatcher {
  /** @type {Map<string, NotificationChannel>} */
  #channels = new Map();
  /** @type {Set<string>} */
  // #loopbackForbidders — محجوزٌ لتتبّعِ القنواتِ التي ترفضُ loopback

  /**
   * @param {{
   *   channels?: NotificationChannel[],
   *   clock?: () => number,
   *   audit?: { append: (type: string, actor: string, data: object) => unknown },
   *   forbidLoopback?: boolean,
   * }} deps
   */
  constructor(deps = {}) {
    this.#clock = deps.clock ?? (() => Date.now());
    if (typeof this.#clock() !== 'number' || !Number.isFinite(this.#clock())) {
      throw new NotificationError(
        NOTIFICATION_ERRORS.DISPATCHER_AUDIT_REQUIRED,
        'الساعةُ ليست دالّةً تُعيدُ عدداً',
        {},
      );
    }
    this.#audit = deps.audit ?? null;
    this.#forbidLoopback = deps.forbidLoopback ?? true;
    for (const channel of deps.channels ?? []) {
      this.registerChannel(channel);
    }
  }

  /** @type {() => number} */
  #clock;
  /** @type {{ append: (type: string, actor: string, data: object) => unknown } | null} */
  #audit;
  #forbidLoopback;

  /**
   * يُسجِّلُ قناةً جديدةً — لا تُبنى قناةٌ بترميزٍ خاص.
   * @param {NotificationChannel} channel
   */
  registerChannel(channel) {
    if (!channel.name || typeof channel.send !== 'function') {
      throw new NotificationError(
        NOTIFICATION_ERRORS.DISPATCHER_CHANNEL_REQUIRED,
        'القناةُ بلا اسمٍ أو دالّةِ إرسال',
        {},
      );
    }
    this.#channels.set(channel.name, channel);
  }

  /**
   * يُوجِّهُ رسالةً عبرَ القناةِ المطلوبةِ ويُقيِّدُ النتيجةَ.
   * @param {NotificationMessage} message
   * @param {string} destination — الوجهةُ الخامُّ (تُخفى في السجلِّ)
   * @returns {Promise<NotificationResult>}
   */
  async dispatch(message, destination) {
    const now = this.#clock();
    const channel = this.#channels.get(message.channel);
    if (!channel) {
      const result = createNotificationResult({
        channel: message.channel,
        ownerId: message.ownerId,
        maskedDestination: maskDestination(destination),
        state: 'not_configured',
        attemptedAtMs: now,
        failureReason: 'القناةُ غيرُ مُسجَّلةٍ',
      });
      this.#recordAudit(result, message);
      return result;
    }

    if (this.#forbidLoopback) {
      assertNotLoopback(destination);
    }

    let result;
    try {
      result = await channel.send(message, destination);
    } catch (/** @type {unknown} */ error) {
      result = createNotificationResult({
        channel: message.channel,
        ownerId: message.ownerId,
        maskedDestination: maskDestination(destination),
        state: 'failed',
        attemptedAtMs: now,
        failureReason: error instanceof Error ? error.message : 'خطأٌ غيرُ معروف',
      });
    }

    this.#recordAudit(result, message);
    return result;
  }

  /**
   * يُقيِّدُ نتيجةَ الإشعارِ في السجلِّ الدائمِ — لا إرسالَ بلا أثر.
   * @param {NotificationResult} result
   * @param {NotificationMessage} message
   */
  #recordAudit(result, message) {
    if (!this.#audit) return;
    this.#audit.append('notification.dispatched', message.ownerId, {
      channel: result.channel,
      ownerId: result.ownerId,
      maskedDestination: result.maskedDestination,
      state: result.state,
      attemptedAtMs: result.attemptedAtMs,
      providerMessageId: result.providerMessageId,
      failureReason: result.failureReason,
      messageSubject: message.subject,
    });
  }

  /**
   * يُعيدُ أسماءَ القنواتِ المُسجَّلة.
   * @returns {string[]}
   */
  get channelNames() {
    return Array.from(this.#channels.keys());
  }

  /**
   * يُتحقَّقُ من أنّ قناةً مُسجَّلةٌ.
   * @param {string} name
   * @returns {boolean}
   */
  hasChannel(name) {
    return this.#channels.has(name);
  }
}

/**
 * يُخفي وجهةَ الرسالةِ في السجلِّ — لا تُكتَبُ خامَّةً.
 * @param {string} destination
 * @returns {string}
 */
export function maskDestination(destination) {
  if (destination.length <= 4) return '*'.repeat(destination.length);
  return `${destination.slice(0, 2)}***${destination.slice(-2)}`;
}
