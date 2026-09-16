// وحدةُ تسليمِ إشعاراتِ التنبيهات — إغلاقُ الدَّينِ `D-3`.
//
// **حدٌّ معلَنٌ أول — الحكمُ نقيٌّ واللمسُ محصور:** هذه الوحدةُ تُنشئُ رسالةَ
// التنبيهِ من حالتِه وتُرسِلُها عبر مُرسِلٍ **محقونٍ** لا مستوردٍ. فلا `fetch`
// هنا ولا `http` ولا `https` — كلُّ ذلك في المُرسِلِ الذي يُمرَّر من خارجِ
// الوحدة. ومن جمعَ الحكمَ والشبكةَ في وحدةٍ واحدةٍ جعل الحكمَ تابعاً لشبكةٍ
// قد تنقطع، فاختبارُ الحكمِ صار اختبارَ شبكة.
//
// **حدٌّ معلَنٌ ثانٍ — لا ساعةَ نظام:** لا ساعةَ نظامٍ هنا. الزمنُ يُمرَّر
// معرّفاً `atMs` من المُنسِّق، فالمُنسِّقُ يملك ساعتَه المُمرَّرة ويمرّر
// قيمتَها. وساعةٌ في وحدةِ التسليمِ ساعةٌ ثانيةٌ بعد ساعةِ المُنسِّق.
//
// **حدٌّ معلَنٌ ثالثٌ — لا استيرادَ من طبقة:** لا `import` من `../telemetry/`
// ولا `../service-levels/` ولا `../operations/` ولا `../crisis/` — هذه وحدةُ
// تسليمٍ لا وحدةَ قياسٍ ولا لوحةٍ ولا مركز. والحاجزُ يفحصُ ذلك نصّاً.

import { IncidentResponseError, IR_ERRORS } from './errors.mjs';

/**
 * @typedef {object} DeliveryEndpoint
 * @property {string} id - معرّفُ القناة (مثل `channel:audit-desk`)
 * @property {string} url - عنوانُ نقطةِ التسليم
 * @property {string} method - طريقةُ الإرسال (`POST`)
 */

/**
 * @typedef {object} NotificationPayload
 * @property {string} channel
 * @property {string} alert
 * @property {string} incident
 * @property {string} severity
 * @property {number} raisedAtMs
 * @property {string} message
 */

/**
 * @typedef {object} DeliveryResult
 * @property {string} channel
 * @property {boolean} delivered
 * @property {number} status - رمزُ حالةِ HTTP
 * @property {number} atMs
 */

/**
 * @typedef {object} SenderLike
 * @property {(url: string, method: string, payload: NotificationPayload) => Promise<{ status: number, delivered: boolean }>} send
 */

/**
 * @typedef {import('./incident-response.mjs').AlertState} AlertState
 */

/**
 * تُنشئُ رسالةَ التنبيهِ من حالتِه — دالةٌ خالصةٌ لا أثرَ ولا شبكة.
 *
 * @param {Pick<AlertState, 'rule' | 'severity' | 'channel' | 'incident' | 'raisedAtMs'>} alert
 * @returns {NotificationPayload}
 */
export function buildNotification(alert) {
  return Object.freeze({
    channel: alert.channel,
    alert: alert.rule,
    incident: alert.incident,
    severity: alert.severity,
    raisedAtMs: alert.raisedAtMs,
    message: `تنبيهٌ «${alert.rule}» بمستوى «${alert.severity}» للحادثةِ «${alert.incident}» — قناةُ الإبلاغِ «${alert.channel}»، رُفعَ عندَ ${alert.raisedAtMs}ms.`,
  });
}

/**
 * مُبلِّغُ الإشعارات: يأخذُ نقاطِ التسليمِ من الوثيقةِ ومُرسِلاً محقوناً،
 * فيُرسِلُ الرسالةَ ويُعيدُ نتيجتَها مقيسةً. ولا يُرسِلُ من تلقاءِ نفسه:
 * المُنسِّقُ يُناديه عند رفعِ كلِّ تنبيهٍ مفتوحٍ لم يُسلَّم بعد.
 */
export class Notifier {
  /** @type {Map<string, DeliveryEndpoint>} */
  #endpoints = new Map();
  /** @type {SenderLike} */
  #sender;

  /**
   * @param {{ endpoints?: readonly DeliveryEndpoint[], sender?: SenderLike }} [deps]
   */
  constructor(deps = {}) {
    const sender = deps.sender;
    if (sender === null || sender === undefined) {
      throw new IncidentResponseError(
        IR_ERRORS.DELIVERY_REQUIRED,
        'مُرسِلُ الإشعاراتِ غيرُ محقونٍ في المُبلِّغ؛ ولا تسليمَ بلا مُرسِل، والمُرسِلُ محقونٌ لا مستوردٌ كي لا يصيرَ الحكمُ تابعاً لشبكةٍ قد تنقطع.',
        {},
      );
    }
    this.#sender = sender;
    for (const endpoint of deps.endpoints ?? []) {
      this.#endpoints.set(endpoint.id, endpoint);
    }
  }

  /**
   * هل لهذه القناةِ نقطةُ تسليمٍ مُعلَنة؟
   * @param {string} channelId
   * @returns {DeliveryEndpoint | null}
   */
  endpointFor(channelId) {
    const endpoint = this.#endpoints.get(channelId);
    return endpoint === undefined ? null : Object.freeze({ ...endpoint });
  }

  /**
   * تُرسِلُ الرسالةَ إلى نقطةِ تسليمِ القناةِ ويُقاسُ وصولُها.
   *
   * @param {NotificationPayload} notification
   * @param {number} atMs
   * @returns {Promise<DeliveryResult>}
   */
  async deliver(notification, atMs) {
    const endpoint = this.#endpoints.get(notification.channel);
    if (endpoint === undefined) {
      return Object.freeze({
        channel: notification.channel,
        delivered: false,
        status: 0,
        atMs,
      });
    }
    let result;
    try {
      result = await this.#sender.send(endpoint.url, endpoint.method, notification);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return Object.freeze({
        channel: notification.channel,
        delivered: false,
        status: 0,
        atMs,
        error: message,
      });
    }
    return Object.freeze({
      channel: notification.channel,
      delivered: result.delivered,
      status: result.status,
      atMs,
    });
  }
}
