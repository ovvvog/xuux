// أوامرُ ملكيّةٌ موقَّعةٌ على مفتاحِ الإيقافِ للاختبارات (‏`WL-302`).
//
// الاختباراتُ التي تبني جذرَ ثقةٍ إنتاجيّاً بتوكنٍ محقونٍ تملكُ زوجَ مفاتيحِ الملكِ
// (‏`06`)، فتوقّعُ به أمراً حقيقيّاً بالصيغةِ التي يقبلُها `createRoyalCommandVerifier`
// — لا مُحقِّقاً يُعيدُ `true`. والسجلُّ هنا يربطُ معرّفَ الملكِ بزوجِه فيُوقَّعُ
// الأمرُ لمفتاحِ الإيقافِ بمفتاحِ مَن يملكُه.

import { createHash, generateKeyPairSync, randomBytes, sign } from 'node:crypto';

import { canonicalRoyalCommand } from '../../src/root-of-trust/royal-command.mjs';

/** @type {Map<string, import('node:crypto').KeyPairKeyObjectResult>} */
const KINGS = new Map();

/**
 * @param {import('node:crypto').KeyObject} publicKey
 * @returns {string}
 */
export function kingIdOfPublicKey(publicKey) {
  return (
    'king:' +
    createHash('sha256')
      .update(publicKey.export({ type: 'spki', format: 'der' }))
      .digest('hex')
      .slice(0, 24)
  );
}

/**
 * يُسجِّلُ زوجَ مفاتيحٍ ليُوقَّعَ به لاحقاً بمعرّفِه.
 * @template {import('node:crypto').KeyPairKeyObjectResult} T
 * @param {T} pair
 * @returns {T}
 */
export function registerTestKing(pair) {
  KINGS.set(kingIdOfPublicKey(pair.publicKey), pair);
  return pair;
}

/** @returns {import('node:crypto').KeyPairKeyObjectResult} */
export function testKingPair() {
  return registerTestKing(generateKeyPairSync('ed25519'));
}

/**
 * يوقّعُ جسمَ أمرٍ بزوجٍ معلوم.
 * @param {import('node:crypto').KeyPairKeyObjectResult} pair
 * @param {{ operation: 'halt' | 'resume', targetEpoch: number, reason: string, at?: string, commandId?: string, signerId?: string }} fields
 * @returns {Record<string, unknown>}
 */
export function signRoyalCommand(pair, fields) {
  const body = {
    operation: fields.operation,
    signerId: fields.signerId ?? kingIdOfPublicKey(pair.publicKey),
    commandId: fields.commandId ?? randomBytes(16).toString('hex'),
    targetEpoch: fields.targetEpoch,
    reason: fields.reason,
    at: fields.at ?? new Date().toISOString(),
  };
  const signature = sign(null, Buffer.from(canonicalRoyalCommand(body)), pair.privateKey).toString(
    'base64url',
  );
  return { ...body, signature };
}

/**
 * أمرٌ موقَّعٌ على العهدِ الحاضرِ لمفتاحِ إيقافٍ بعينِه، بمفتاحِ ملكِه المسجَّل.
 * @param {{ king: { id: string }, royalKeyId?: string | null, read: () => { epoch: number }, useTrustedClock?: (clock: { now(): number }) => void }} haltSwitch
 * @param {'halt' | 'resume'} operation
 * @param {string} reason
 * @param {{ at?: string, commandId?: string, targetEpoch?: number }} [overrides]
 * @returns {Record<string, unknown>}
 */
export function royalCommandFor(haltSwitch, operation, reason, overrides = {}) {
  // تركيبُ الاختبارِ (‏`createProductionRootOfTrust` بلا مدخلِ الإنتاجِ) لا يبني
  // `AttestedClock`؛ فيُوصِلُ الاختبارُ ساعةَ الجهازِ ساعةً موثوقةً **للاختبارِ
  // وحدَه** — والمدخلُ الإنتاجيُّ يُوصِلُ `AttestedClock` (‏`src/production/entrypoint.mjs`).
  if (typeof haltSwitch.useTrustedClock === 'function') {
    haltSwitch.useTrustedClock({ now: () => Date.now() });
  }
  // `LIVE-24`: الأمرُ يُوقَّعُ بالمفتاحِ الملكيِّ الذي بُنيَ عليه المُحقِّقُ، لا بمفتاحِ التوجيه.
  const signerKeyId = haltSwitch.royalKeyId ?? haltSwitch.king.id;
  const pair = KINGS.get(signerKeyId);
  if (pair === undefined) throw new Error(`TEST_KING_NOT_REGISTERED: ${signerKeyId}`);
  return signRoyalCommand(pair, {
    operation,
    reason,
    targetEpoch: overrides.targetEpoch ?? haltSwitch.read().epoch,
    ...(overrides.at !== undefined ? { at: overrides.at } : {}),
    ...(overrides.commandId !== undefined ? { commandId: overrides.commandId } : {}),
  });
}

/**
 * أمرٌ بالصيغةِ الكاملةِ بلا توقيعٍ حقيقيٍّ — لمُحقِّقاتِ الاختبارِ المعزولةِ التي
 * تفحصُ مسارَ التفويضِ بعدَ التوقيعِ لا التوقيعَ نفسَه.
 * @param {{ read: () => { epoch: number } }} haltSwitch
 * @param {'halt' | 'resume'} operation
 * @param {string} reason
 * @param {Record<string, unknown>} [overrides]
 * @returns {Record<string, unknown>}
 */
export function shapedCommandFor(haltSwitch, operation, reason, overrides = {}) {
  return {
    operation,
    signerId: 'king:test',
    commandId: randomBytes(16).toString('hex'),
    targetEpoch: haltSwitch.read().epoch,
    reason,
    at: new Date().toISOString(),
    signature: 'test-signature',
    ...overrides,
  };
}

/**
 * `LIVE-24`: بيئةُ المفتاحِ الملكيِّ المستقلِّ للإقلاعِ الإنتاجيِّ في الاختبار — يُسجَّلُ
 * الزوجُ ليُوقَّعَ به، ويُعادُ مفتاحُه العامُّ وبصمتُه المُثبَّتة.
 * @param {import('node:crypto').KeyPairKeyObjectResult} [pair]
 * @returns {{ pair: import('node:crypto').KeyPairKeyObjectResult, env: { XUUX_ROYAL_PUBLIC_KEY_PEM: string, XUUX_ROYAL_KEY_ID: string } }}
 */
export function royalKeyEnv(pair = generateKeyPairSync('ed25519')) {
  registerTestKing(pair);
  return {
    pair,
    env: {
      XUUX_ROYAL_PUBLIC_KEY_PEM: pair.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
      XUUX_ROYAL_KEY_ID: kingIdOfPublicKey(pair.publicKey),
    },
  };
}
