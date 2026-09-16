/**
 * نقلُ رسائلِ الوقتِ — مِقبسٌ واحدٌ لسؤالٍ واحدٍ (‏`D-7`، `WL-192`).
 *
 * أُفرِدَ النقلُ عن التحقُّقِ كي يُقاسَ التحقُّقُ بلا شبكةٍ، ويُقاسَ النقلُ
 * بشاهدٍ محليٍّ على مِقبسٍ حقيقيٍّ. وخلطُهما يجعلُ اختبارَ التوقيعِ رهينَ شبكةٍ،
 * فيُعطَّلُ عندَ انقطاعِها ثمّ يُسكَتُ عنه — وهي الطريقُ التي تُفقَدُ بها
 * البُرهاناتُ.
 *
 * ثلاثةُ قيودٍ مقصودةٍ:
 *   1. **مُهلةٌ لازمةٌ.** سؤالٌ بلا مُهلةٍ يُعلِّقُ المسارَ السياديَّ على صمتِ
 *      خادمٍ، وتعليقٌ بلا نهايةٍ إنكارُ خدمةٍ لا انتظارٌ.
 *   2. **رَدٌّ واحدٌ ثمّ إغلاقٌ.** المِقبسُ يُغلَقُ بعدَ أوّلِ رزمةٍ، فلا يتراكمُ
 *      رَدٌّ ثانٍ من مُنتحِلٍ يسبقُ الخادمَ ثمّ يُقرأُ لاحقاً.
 *   3. **حدُّ طولٍ أعلى.** رزمةٌ أكبرُ من الحدِّ تُرفَضُ ولا تُفَكُّ: فكُّ ما لا
 *      حدَّ لطولِه بابُ استهلاكِ ذاكرةٍ بلا تفويضٍ.
 *
 * @module time/transport
 */

import { createSocket } from 'node:dgram';

import { TIME_ERRORS, TimeError } from './errors.mjs';

/** أقصى طولِ رزمةِ رَدٍّ مقبولٍ. */
export const MAX_RESPONSE_BYTES = 4096;

/**
 * يسألُ مصدراً واحداً ويعودُ برزمةِ رَدِّه، أو يرفعُ رفضاً مُسمّى.
 *
 * @param {object} options
 * @param {string} options.host
 * @param {number} options.port
 * @param {Buffer} options.request
 * @param {number} options.timeoutMs
 * @returns {Promise<Buffer>}
 */
export function askSource({ host, port, request, timeoutMs }) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    throw new TimeError(
      TIME_ERRORS.INPUT_INVALID,
      'مُهلةُ السؤالِ يجبُ أن تكونَ عدداً صحيحاً موجباً؛ وسؤالٌ بلا مُهلةٍ يُعلِّقُ المسارَ على صمتِ خادمٍ.',
      { timeoutMs },
    );
  }
  return new Promise((resolve, reject) => {
    const socket = createSocket('udp4');
    let settled = false;

    /**
     * @param {Error | null} error
     * @param {Buffer | null} value
     * @returns {void}
     */
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.close();
      if (error !== null) reject(error);
      else if (value !== null) resolve(value);
    };

    /** @type {NodeJS.Timeout} */
    const timer = setTimeout(() => {
      finish(
        new TimeError(TIME_ERRORS.TRANSPORT_FAILED, 'انقضت مُهلةُ سؤالِ مصدرِ الوقتِ.', {
          host,
          port,
          timeoutMs,
        }),
        null,
      );
    }, timeoutMs);
    if (typeof timer.unref === 'function') timer.unref();

    socket.on('error', (error) => {
      finish(
        new TimeError(TIME_ERRORS.TRANSPORT_FAILED, 'فشلَ مِقبسُ سؤالِ مصدرِ الوقتِ.', {
          host,
          port,
          detail: error.message,
        }),
        null,
      );
    });

    socket.on('message', (message) => {
      if (message.length > MAX_RESPONSE_BYTES) {
        finish(
          new TimeError(TIME_ERRORS.TRANSPORT_FAILED, 'رزمةُ رَدٍّ أطولُ من الحدِّ المُعلَنِ.', {
            host,
            port,
            length: message.length,
          }),
          null,
        );
        return;
      }
      finish(null, Buffer.from(message));
    });

    socket.send(request, port, host, (error) => {
      if (error) {
        finish(
          new TimeError(TIME_ERRORS.TRANSPORT_FAILED, 'تعذَّرَ إرسالُ طلبِ الوقتِ.', {
            host,
            port,
            detail: error.message,
          }),
          null,
        );
      }
    });
  });
}
