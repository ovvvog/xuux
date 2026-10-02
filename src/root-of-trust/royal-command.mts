// src/root-of-trust/royal-command.mts
//
// الأمرُ الملكيُّ على halt/resume: **صيغتُه وتوقيعُه** لا سلطتُه.
//
// الفصلُ مقصودٌ (‏`WL-302`): هذه الوحدةُ تُجيبُ عن سؤالٍ واحدٍ — «هل وقّعَ هذا
// الجسمَ بعينِه المفتاحُ المُثبَّتُ؟». أمّا «هل يجوزُ تنفيذُه الآنَ على هذه
// الحالةِ؟» (‏العملُ المطلوبُ، العهدُ المستهدَفُ، الحداثةُ، السببُ) فقرارُ
// `HaltSwitch` بعدَ التحقّقِ، لأنّه وحدَه يعرفُ العهدَ الدائمَ والساعةَ الموثوقة.
//
// الجسمُ الموقَّعُ يحملُ:
//   - `domain` — فصلُ نطاقٍ: المفتاحُ نفسُه يوقّعُ في التوكنِ متوناً أخرى (توجيهاتٌ،
//     مراسٍ، مفتاحُ الدفترِ)، فلا يُقرأُ توقيعُ متنٍ منها أمراً ملكيّاً.
//   - `operation` — فلا يُفكُّ توقيعُ halt لـ resume ولا العكس.
//   - `commandId` — معرّفٌ عشوائيٌّ يُسجَّلُ في الأثرِ.
//   - `targetEpoch` — العهدُ الذي صدرَ الأمرُ عليه: بعدَ تنفيذِه يرتفعُ العهدُ،
//     فلا يُعادُ الأمرُ نفسُه ولا أمرٌ قديمٌ — ولو بعدَ إعادةِ التشغيلِ.
//   - `reason` و`at` — السببُ المختومُ ولحظةُ الإصدار.

import { createHash, createPublicKey, verify as cryptoVerify, type KeyObject } from 'node:crypto';

/** فاصلُ النطاقِ المختومُ في كلِّ أمرٍ ملكيٍّ على مفتاحِ الإيقاف. */
export const ROYAL_COMMAND_DOMAIN = 'xuux.royal-command.halt.v1';

/** حقولُ الأمرِ المقبولةُ — وما سواها رفضٌ، فلا يحملُ الأمرُ ما لم يُوقَّعْ. */
const ROYAL_COMMAND_FIELDS: ReadonlySet<string> = new Set([
  'operation',
  'signerId',
  'commandId',
  'targetEpoch',
  'reason',
  'at',
  'signature',
]);

/** صيغةُ المعرّفِ: 16–128 محرفاً من أبجديّةِ base64url/hex. */
const COMMAND_ID_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;

/** صيغةُ اللحظةِ: ISO-8601 بتوقيتِ UTC كما تُخرجُها `toISOString`. */
const ISO_INSTANT_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;

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

/** العملُ المختومُ في الأمر. */
export type RoyalCommandOperation = 'halt' | 'resume';

/** الجسمُ الأساسيُّ للأمرِ الملكيِّ — كلُّ الحقولِ ما عدا `signature`. */
export interface RoyalCommandBody {
  /** العملُ المطلوبُ: `halt` أو `resume` */
  operation: RoyalCommandOperation;
  /** معرّفُ الموقِّعِ — يجبُ أن يطابقَ الملكَ */
  signerId: string;
  /** معرّفُ الأمرِ — عشوائيٌّ، 16 محرفاً فأكثر */
  commandId: string;
  /** العهدُ الذي صدرَ الأمرُ عليه */
  targetEpoch: number;
  /** سببُ الأمرِ */
  reason: string;
  /** لحظةُ الإصدارِ ISO-8601 بتوقيتِ UTC */
  at: string;
}

/** الأمرُ الملكيُّ الكاملُ: جسمُهُ وتوقيعُهُ. */
export interface RoyalCommand extends RoyalCommandBody {
  /** التوقيعُ بترميز base64url */
  signature: string;
}

/** متنُ التوقيعِ: الجسمُ بترتيبٍ ثابتٍ معَ فاصلِ النطاق. */
export interface RoyalCommandSigningBody extends RoyalCommandBody {
  domain: typeof ROYAL_COMMAND_DOMAIN;
}

/**
 * يقولُ إن كانت القيمةُ جسمَ أمرٍ مكتملَ الأنواعِ. لا تحويلَ ولا افتراضَ:
 * حقلٌ ناقصٌ أو بنوعٍ آخرَ رفضٌ، فلا يُوقَّعُ متنٌ ويُتحقَّقُ من آخرَ.
 * @param value - القيمةُ المفحوصة
 * @returns هل هي جسمٌ صالحُ الصيغة
 */
export function isWellFormedRoyalCommandBody(value: unknown): value is RoyalCommandBody {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  return (
    (v.operation === 'halt' || v.operation === 'resume') &&
    typeof v.signerId === 'string' &&
    v.signerId !== '' &&
    typeof v.commandId === 'string' &&
    COMMAND_ID_PATTERN.test(v.commandId) &&
    typeof v.targetEpoch === 'number' &&
    Number.isSafeInteger(v.targetEpoch) &&
    v.targetEpoch >= 0 &&
    typeof v.reason === 'string' &&
    typeof v.at === 'string' &&
    ISO_INSTANT_PATTERN.test(v.at) &&
    Number.isFinite(Date.parse(v.at))
  );
}

/**
 * يَبني متنَ التوقيعِ بترتيبِ مفاتيحَ ثابتٍ معَ فاصلِ النطاقِ. وهو نفسُه ما
 * يُمرَّرُ إلى `signAsync` في التوكنِ (الذي يُسلسِلُ بـ`JSON.stringify`)، فيتطابقُ
 * التوقيعُ والتحقّقُ بلا ترجمةٍ بينَهما.
 * @param body - الجسمُ الأساسيُّ
 * @returns متنُ التوقيع
 */
export function royalCommandSigningBody(body: RoyalCommandBody): RoyalCommandSigningBody {
  return {
    domain: ROYAL_COMMAND_DOMAIN,
    operation: body.operation,
    signerId: body.signerId,
    commandId: body.commandId,
    targetEpoch: body.targetEpoch,
    reason: body.reason,
    at: body.at,
  };
}

/**
 * يَبني المادةَ الموقَّعةَ: JSON بترتيبِ مفاتيحَ ثابتٍ. كلُّ حقلٍ نصٌّ أو عددٌ
 * صحيحٌ مُتحقَّقٌ من نوعِه، و`JSON.stringify` يهرِّبُ النصوصَ — فلا يلتبسُ متنانِ.
 * @param body - الجسمُ الأساسيُّ
 * @returns JSON بترتيبِ مفاتيحَ ثابتٍ
 */
export function canonicalRoyalCommand(body: RoyalCommandBody): string {
  return JSON.stringify(royalCommandSigningBody(body));
}

/** المُتحقِّقاتُ المبنيّةُ هنا وبصماتُ مفاتيحِها — علامةُ «مُتحقِّقٍ تشفيريٍّ» لا دالّةٍ تُعيدُ `true`. */
const TRUSTED_VERIFIERS = new WeakMap<object, string>();

/**
 * يُعيدُ بصمةَ المفتاحِ الذي بُنيَ عليه المُتحقِّقُ إن كان مبنيّاً بـ
 * `createRoyalCommandVerifier`، وإلّا `null` — فدالّةٌ مُرتجَلةٌ لا تُعدُّ مُتحقِّقاً.
 * @param verifier - المُتحقِّقُ المفحوص
 * @returns بصمةُ المفتاحِ أو null
 */
export function trustedRoyalVerifierFingerprint(verifier: unknown): string | null {
  if (typeof verifier !== 'function') return null;
  return TRUSTED_VERIFIERS.get(verifier) ?? null;
}

/**
 * بصمةُ مفتاحٍ عامٍّ بترميزِ PEM — للمقابلةِ بمُتحقِّقٍ.
 * @param publicKeyPem - المفتاحُ العامُّ
 * @returns البصمة
 */
export function royalKeyFingerprint(publicKeyPem: string): string {
  return publicKeyFingerprint(createPublicKey(publicKeyPem));
}

/**
 * يَبني مُتحقِّقاً تشفيرياً للأوامرِ الملكيّةِ على halt/resume.
 *
 * يُجيبُ عن التوقيعِ وحدَه: صيغةٌ مكتملةٌ بلا حقلٍ زائدٍ، وموقِّعٌ هو الملكُ
 * المُثبَّتُ، وتوقيعٌ صحيحٌ على متنٍ بفاصلِ النطاق. **ولا يقرّرُ التنفيذَ**: العهدُ
 * والحداثةُ والسببُ يُفحصُها `HaltSwitch` بعدَه.
 *
 * @param kingPublicKeyPem - المفتاحُ العامُّ للملكِ بترميز PEM (SPKI)
 * @returns دالةُ تحققٍ للأوامرِ الملكيّةِ
 */
export function createRoyalCommandVerifier(
  kingPublicKeyPem: string,
): (command: unknown) => boolean {
  const publicKey = createPublicKey(kingPublicKeyPem);
  const fingerprint = publicKeyFingerprint(publicKey);
  const kingId = 'king:' + fingerprint.slice(0, 24);

  const verifier = (command: unknown): boolean => {
    if (typeof command !== 'object' || command === null || Array.isArray(command)) return false;
    const cmd = command as Record<string, unknown>;
    for (const key of Object.keys(cmd)) {
      if (!ROYAL_COMMAND_FIELDS.has(key)) return false;
    }
    if (typeof cmd.signature !== 'string' || cmd.signature === '') return false;
    if (!isWellFormedRoyalCommandBody(cmd)) return false;
    if (cmd.signerId !== kingId) return false;
    try {
      return cryptoVerify(
        null,
        Buffer.from(canonicalRoyalCommand(cmd)),
        publicKey,
        Buffer.from(cmd.signature, 'base64url'),
      );
    } catch {
      return false;
    }
  };
  TRUSTED_VERIFIERS.set(verifier, fingerprint);
  return verifier;
}
