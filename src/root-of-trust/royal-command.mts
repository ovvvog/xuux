// src/root-of-trust/royal-command.mts
//
// التحققُ التشفيريُّ من الأمرِ الملكيِّ على halt/resume.
//
// لا يكفي وجودُ objectٍ أو مقارنةُ معرّفٍ — التحققُ تشفيريٌّ فقط:
// التوقيعُ بالمفتاحِ العامِّ للملكِ، و`operation` مختومٌ في الجسمِ
// فلا يُفكُّ توقيعُ halt لـ resume ولا العكس.

import { createHash, createPublicKey, verify as cryptoVerify, type KeyObject } from 'node:crypto';

/**
 * يَبني بصمةً مستقرّةً للمفتاحِ العامِّ — نفسُ خوارزميةِ `fingerprint` في identity.mts.
 * @param publicKey - المفتاحُ العامُّ
 * @returns بصمة SHA-256 بترميز ست عشري
 */
function publicKeyFingerprint(publicKey: KeyObject): string {
  return createHash('sha256')
    .update(publicKey.export({ type: 'spki', format: 'der' }))
    .digest('hex');
}

/**
 * الجسمُ الأساسيُّ للأمرِ الملكيِّ — كلُّ الحقولِ ما عدا `signature`.
 * `operation` مختومٌ هنا فلا يُفكُّ توقيعُ halt لـ resume.
 */
export interface RoyalCommandBody {
  /** العملُ المطلوبُ: `halt` أو `resume` */
  operation: 'halt' | 'resume';
  /** معرّفُ الموقِّعِ — يجبُ أن يطابقَ الملكَ */
  signerId: string;
  /** سببُ الأمرِ */
  reason: string;
  /** لحظةُ الإصدارِ ISO-8601 */
  at: string;
}

/** الأمرُ الملكيُّ الكاملُ: جسمُهُ وتوقيعُهُ. */
export interface RoyalCommand extends RoyalCommandBody {
  /** التوقيعُ بترميز base64url */
  signature: string;
}

/**
 * يَبني الجسمَ الأساسيَّ للأمرِ الملكيِّ بترتيبِ مفاتيحَ ثابتٍ.
 * لا يَدخُلُ `signature` في المادةِ الموقَّعةِ.
 * @param body - الجسمُ الأساسيُّ
 * @returns JSON بترتيبِ مفاتيحَ ثابتٍ
 */
export function canonicalRoyalCommand(body: RoyalCommandBody): string {
  return JSON.stringify({
    operation: body.operation,
    signerId: body.signerId,
    reason: body.reason,
    at: body.at,
  });
}

/**
 * يَبني مُتحقِّقاً تشفيرياً للأوامرِ الملكيّةِ على halt/resume.
 *
 * يرفضُ كلَّ أمرٍ بلا توقيعٍ، ويتحققُ من التوقيعِ بالمفتاحِ العامِّ للملكِ.
 * يربطُ `operation` بجسمِ الأمرِ فلا يقبلُ توقيعَ halt لـ resume أو العكس.
 * لا يثقُ بوجودِ objectٍ أو اسمِ callbackٍ — التحققُ تشفيرياً فقط.
 *
 * @param kingPublicKeyPem - المفتاحُ العامُّ للملكِ بترميز PEM (SPKI)
 * @returns دالةُ تحققٍ للأوامرِ الملكيّةِ
 */
export function createRoyalCommandVerifier(
  kingPublicKeyPem: string,
): (command: unknown) => boolean {
  const publicKey = createPublicKey(kingPublicKeyPem);
  const kingId = 'king:' + publicKeyFingerprint(publicKey).slice(0, 24);

  return (command: unknown): boolean => {
    if (typeof command !== 'object' || command === null) return false;
    const cmd = command as Record<string, unknown>;
    // التوقيعُ إلزاميٌّ — لا يُقبلُ أمرٌ بلا توقيعٍ
    if (typeof cmd.signature !== 'string' || cmd.signature === '') return false;
    // operation إلزاميٌّ ومُختومٌ في الجسمِ — لا يُفكُّ توقيعُ halt لـ resume
    if (
      typeof cmd.operation !== 'string' ||
      (cmd.operation !== 'halt' && cmd.operation !== 'resume')
    )
      return false;
    // signerId إلزاميٌّ — يجبُ أن يطابقَ الملكَ
    if (typeof cmd.signerId !== 'string' || cmd.signerId !== kingId) return false;
    // بناءُ الجسمِ الأساسيِّ للتحققِ — كلُّ الحقولِ ما عدا التوقيعِ
    const body: RoyalCommandBody = {
      operation: cmd.operation as 'halt' | 'resume',
      signerId: cmd.signerId as string,
      reason: (cmd.reason as string) ?? '',
      at: (cmd.at as string) ?? '',
    };
    try {
      return cryptoVerify(
        null,
        Buffer.from(canonicalRoyalCommand(body)),
        publicKey,
        Buffer.from(cmd.signature, 'base64url'),
      );
    } catch {
      return false;
    }
  };
}
