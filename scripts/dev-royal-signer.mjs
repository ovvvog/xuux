/**
 * موقِّعُ الأمرِ الملكيِّ للتطويرِ — يُغلِقُ الفجوةَ بينَ «الكتابةُ ممكنةٌ» و«الكتابةُ
 * تُقاسُ على السلكِ» في سدادِ الدَينِ `D-1`.
 *
 * **ولماذا يعيشُ خارجَ `src/`؟** لسببِ `scripts/dev-pop-proxy.mjs` نفسِه (‏إغلاقُ
 * `LIVE-5`): هذا موقِّعُ **تطويرٍ**، ومكانُه في الشِّفرةِ يجبُ أن يقولَ ذلك قبلَ
 * أن يقولَه تعليقٌ. فمن قرأَ `src/console/sovereign-writer.mjs` رأى عقداً واحداً
 * لا يعرفُ من يُحقِّقُه، ومن أرادَ الإنتاجَ وصلَ `moduleSignerFromHsm(HsmSigner)`
 * بلا تعديلِ سطرٍ واحدٍ في المُنادي.
 *
 * **وحدودُه مُعلَنةٌ في الكودِ لا في الهامشِ، وهي تُنفَّذُ لا تُوصَف:**
 *
 * 1. **يُعلِنُ نفسَه غيرَ إنتاجيٍّ (`productionReady: false`)**، فيَرُدُّه
 *    `SovereignWriter` في بيئةِ إنتاجٍ بحُكمِ `assertProductionKeyProviderAllowed`
 *    نفسِه الذي يحكمُ مخازنَ المفاتيح. وذاك ليس تواضعاً في التعبيرِ: مادّتُه في
 *    **ذاكرةِ هذه العمليّةِ**، فهو وحدةُ أمانٍ **بالعقدِ لا بالعتادِ**، ووحدةٌ
 *    بالعقدِ وحدَه لا تُؤتمَنُ على سلطةٍ سياديّةٍ حقيقيّة.
 * 2. **لا يُصدِّرُ مادّتَه (`canExport: false`) ولا يُعطي مِقبضاً إليها**: المفتاحُ
 *    الخاصُّ محصورٌ في هذا المِلفِّ (‏في مُغلَقٍ لا في خاصّيّةٍ)، ولا `sign`
 *    متزامنٌ يُنادى من خارجِه، ولا يُكتَبُ على قرصٍ، ولا يُطبَعُ، ويموتُ مع
 *    العمليّة. فما يخرجُ منه توقيعٌ ومفتاحٌ عامٌّ، وهما ما يُنشَرُ قصداً.
 * 3. **مفتاحُه يُعطى له ولا يُولِّدُه لنفسِه.** لو ولّدَ زوجاً لكانَ توقيعُه
 *    مردوداً عندَ بوابةِ التاجِ لأنّه ليس مفتاحَ الملكِ — فيَظهرُ العيبُ رفضاً
 *    غامضاً بعدَ الإرسالِ بدلَ أن يكونَ تركيباً مستقيماً قبلَه.
 */

import { Buffer } from 'node:buffer';
import { createPublicKey, sign as signBytes } from 'node:crypto';

/** نوعُ الموقِّعِ كما يُعلِنُه لنفسِه. نصٌّ واحدٌ يُقرأُ في الردِّ والتقريرِ والحاجز. */
export const DEV_ROYAL_SIGNER_KIND = 'dev-loopback-signer';

/**
 * يُنشئُ موقِّعاً يُحقِّقُ عقدَ `ModuleSigner` من `src/console/sovereign-writer.mjs`.
 * @param {{ privateKey: import('node:crypto').KeyObject, publicKey: import('node:crypto').KeyObject }} keys - زوجُ مفاتيحِ الملكِ نفسُه
 * @returns {{ describe: () => { kind: string, canExport: boolean, productionReady: boolean, location: string }, signAsync: (payload: object) => Promise<string>, publicKeyPem: string }}
 */
export function createDevRoyalSigner(keys) {
  const publicKeyPem = /** @type {string} */ (
    keys.publicKey.export({ type: 'spki', format: 'pem' })
  );
  if (createPublicKey(publicKeyPem).asymmetricKeyType !== 'ed25519') {
    throw new Error('DEV_ROYAL_SIGNER_KEY_NOT_ED25519');
  }
  // المادّةُ في مُغلَقٍ لا في خاصّيّةٍ: خاصّيّةٌ تُقرأُ من كلِّ من يمسكُ الكائنَ،
  // وهذا مُغلَقٌ لا يُقرأُ إلا بنداءِ `signAsync` — وهو لا يُرجِعُ المادّةَ.
  const privateKey = keys.privateKey;
  return {
    describe: () => ({
      kind: DEV_ROYAL_SIGNER_KIND,
      canExport: false,
      productionReady: false,
      location: 'process-memory',
    }),
    // و`JSON.stringify` هو ترتيبُ البايتاتِ الذي يوقّعُ عليه `KingIdentity`
    // و`HsmSigner` معاً، فلا يختلفُ الموقِّعُ عن المُتحقِّقِ في بايتٍ واحدٍ.
    signAsync: async (payload) =>
      signBytes(null, Buffer.from(JSON.stringify(payload), 'utf8'), privateKey).toString(
        'base64url',
      ),
    publicKeyPem,
  };
}
