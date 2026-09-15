/**
 * صياغةُ رسالةِ إثباتِ الحيازةِ — **موضعٌ واحدٌ لا موضعانِ**. (‏`WL-179`، إغلاقُ `LIVE-1`.)
 *
 * **لماذا وُجِدَ هذا الملفُّ:** كانت صياغةُ الرسالةِ الموقَّعةِ محبوسةً في دالَّتَينِ
 * خاصَّتَينِ داخلَ `gateway.mjs` و`session-store.mjs`، **فلم يكن لعميلٍ يُوقِّعُ أن
 * يعرفَها إلا بنسخِها**. ونسخُ صياغةٍ أمنيّةٍ يُنشئُ مصدرَينِ للحقيقةِ: يتغيَّرُ
 * أحدُهما فينكسرُ التحقُّقُ في وجهِ المستعملِ، **أو أسوأُ: يُلَيَّنُ التحقُّقُ ليُوافِقَ
 * النسخةَ**. فصارت الصياغةُ هنا، **يقرأُها المُوقِّعُ والمُتحقِّقُ من نصٍّ واحدٍ**.
 *
 * **والثباتُ شرطٌ لا استحسانٌ:** تغييرُ ترتيبِ حقلٍ أو فاصلٍ **يكسرُ كلَّ توقيعٍ
 * قائمٍ** — فمن غيَّرَ شيئاً هنا فعليه أن يعلمَ أنّه غيَّرَ عقداً بينَ طرفَينِ، لا
 * سطراً في نصٍّ.
 *
 * **وما لا يفعلُه هذا الملفُّ:** لا يُوقِّعُ ولا يتحقَّقُ ولا يحملُ مفتاحاً. هو
 * **صياغةٌ محضةٌ** بلا حالةٍ ولا سلطةٍ — والسلطةُ في `session-store.mjs` وحدَه.
 */

import { createHash } from 'node:crypto';

/**
 * الحمولةُ المتّفَقُ عليها لنداءٍ. مُلزَمةٌ بمعرِّفِ الجلسةِ كي لا يُعادَ تشغيلُ
 * توقيعِ طلبٍ بينَ جلستَينِ لنفسِ الفاعلِ، والمعاملاتُ **تُهضَمُ** بـsha256 لا
 * تُوقَّعُ خامَّةً (‏استقرارٌ وحدٌّ لحجمِ الرسالةِ).
 * @param {{ method: string, path: string, action: string, resource: string }} route
 * @param {string} sessionId
 * @param {Record<string, unknown> | undefined} params
 * @returns {string}
 */
export function canonicalCallPayload(route, sessionId, params) {
  const paramsDigest = createHash('sha256')
    .update(JSON.stringify(params ?? {}))
    .digest('base64url');
  return [route.method, route.path, route.action, route.resource, sessionId, paramsDigest].join(
    '|',
  );
}

/**
 * الحمولةُ المتّفَقُ عليها عندَ فتحِ الجلسةِ.
 * @param {string} actorId
 * @returns {string}
 */
export function canonicalOpenPayload(actorId) {
  return `open:${actorId}`;
}

/**
 * الرسالةُ الموقَّعةُ: حمولةٌ ثمّ طابعٌ زمنيٌّ ثمّ nonce.
 * @param {string} canonicalPayload
 * @param {string} popTimestamp
 * @param {string} popNonce
 * @returns {string}
 */
export function popMessage(canonicalPayload, popTimestamp, popNonce) {
  return `${canonicalPayload}|${popTimestamp}|${popNonce}`;
}
