/**
 * عميلُ إثباتِ الحيازةِ — **مَن يحملُ المفتاحَ يُوقِّعُ، ومَن لا يحملُه لا يُعفى**.
 * (‏`WL-179`، إغلاقُ الدَينِ `LIVE-1`.)
 *
 * **الدَينُ الذي أُغلِقَ به:** كان `scripts/serve-state.mjs` يفتحُ الجلسةَ **بمعرِّفٍ
 * عامٍّ وحدَه**، وقد صارَ إثباتُ الحيازةِ لازماً افتراضاً في `SessionStore`، **فمات
 * الخادمُ قبلَ الإنصاتِ** بـ`POP_REQUIRED`. **والعلاجُ الخطأُ الجاهزُ كان `requirePoP:
 * false`** — أي إسقاطُ الحمايةِ لِيُقلِعَ نصُّ تطويرٍ. **فلم يُسقَطْ شيءٌ**: صارَ
 * لِمُشغِّلِ التطويرِ مفتاحُه ووُقِّعَ به.
 *
 * **وحدودُه مُعلَنةٌ:**
 * 1. **لا يُولِّدُ مفاتيحَ ولا يُخزِّنُها:** يستقبلُ مفتاحاً خاصّاً جاهزاً. فمن
 *    أرادَ مفتاحاً في وحدةِ أمانٍ وضعَه هناك ومرَّرَ كائنَه.
 * 2. **ولا يكتبُ مفتاحاً على قرصٍ ولا يطبعُه:** المفتاحُ الخاصُّ لا يُغادِرُ
 *    الذاكرةَ من هذا الطريقِ.
 * 3. **ولا يصوغُ الرسالةَ بنفسِه:** الصياغةُ من `pop-canonical.mjs` — الموضعُ
 *    الذي يقرأُه المُتحقِّقُ نفسُه، **فلا يُصحَّحُ عميلٌ بتلييِنِ خادمٍ**.
 * 4. **ولا يُصلِحُ متصفِّحاً:** صفحةٌ لا تحملُ مفتاحاً خاصّاً، **فقراءةُ المشهدِ من
 *    متصفِّحٍ تبقى غيرَ ممكنةٍ في تركيبٍ يُلزِمُ الحيازةَ** — وذاك قُيِّدَ ديناً
 *    باسمِه (`LIVE-5`) ولم يُخبَّأْ تحتَ إقلاعٍ ناجحٍ.
 */

import { randomUUID, sign as cryptoSign } from 'node:crypto';

import { canonicalCallPayload, canonicalOpenPayload, popMessage } from './pop-canonical.mjs';

/**
 * @typedef {object} PoPProof
 * @property {string} signature التوقيعُ بصيغةِ base64url.
 * @property {string} timestamp طابعٌ زمنيٌّ ISO داخلَ نافذةِ القبولِ.
 * @property {string} nonce مُعرِّفٌ لا يُقبلُ مرّتَينِ على الجلسةِ نفسِها.
 */

/**
 * يُنشئُ مُوقِّعاً يحملُ مفتاحاً خاصّاً.
 * @param {{ privateKey: import('node:crypto').KeyObject, now?: () => Date, newNonce?: () => string }} deps
 */
export function createPoPClient(deps) {
  const privateKey = deps?.privateKey;
  if (privateKey === undefined || privateKey === null) {
    throw new TypeError(
      'عميلُ إثباتِ الحيازةِ بلا مفتاحٍ خاصٍّ لا معنى له؛ ولا يُنشَأُ ليُوقِّعَ بلا حيازةٍ.',
    );
  }
  const now = typeof deps.now === 'function' ? deps.now : () => new Date();
  const newNonce = typeof deps.newNonce === 'function' ? deps.newNonce : () => randomUUID();

  /**
   * @param {string} canonicalPayload
   * @returns {PoPProof}
   */
  function proofFor(canonicalPayload) {
    const timestamp = now().toISOString();
    const nonce = newNonce();
    const message = popMessage(canonicalPayload, timestamp, nonce);
    const signature = cryptoSign(null, Buffer.from(message, 'utf8'), privateKey).toString(
      'base64url',
    );
    return { signature, timestamp, nonce };
  }

  return {
    /**
     * طلبُ فتحِ جلسةٍ موقَّعٌ، جاهزٌ لـ`gateway.openSession`.
     * @param {string} actorId
     * @returns {{ actorId: string, popSignature: string, popTimestamp: string, popNonce: string }}
     */
    signOpen(actorId) {
      const proof = proofFor(canonicalOpenPayload(actorId));
      return {
        actorId,
        popSignature: proof.signature,
        popTimestamp: proof.timestamp,
        popNonce: proof.nonce,
      };
    },

    /**
     * إثباتُ حيازةٍ لنداءٍ واحدٍ. **ولكلِّ نداءٍ إثباتُه**: `nonce` لا يُقبلُ مرّتَينِ.
     * @param {{ route: { method: string, path: string, action: string, resource: string }, sessionId: string, params?: Record<string, unknown> }} request
     * @returns {PoPProof}
     */
    signCall(request) {
      return proofFor(
        canonicalCallPayload(request.route, request.sessionId, request.params ?? undefined),
      );
    },

    /**
     * الإثباتُ نفسُه بترويساتِ طبقةِ النقلِ — **بأسمائِها كما يقرأُها الخادمُ**
     * (`src/transport/server.mjs`)، فلا يُخطئُ عميلٌ في اسمِ ترويسةٍ فيُظَنُّ أنّ
     * الحمايةَ مُعطَّلةٌ وهي تعملُ.
     * @param {PoPProof} proof
     * @returns {Record<string, string>}
     */
    headersFor(proof) {
      return {
        'x-state-pop-signature': proof.signature,
        'x-state-pop-timestamp': proof.timestamp,
        'x-state-pop-nonce': proof.nonce,
      };
    },
  };
}
