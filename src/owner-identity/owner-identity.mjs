// هويةُ المالك — سجلٌّ موحَّدٌ يربطُ كلَّ جهةٍ مالكةٍ بهويةٍ داخليةٍ ثابتةٍ.
//
// **الفكرةُ الأساسيةُ:** قيمةُ المعرّفِ وحدَها ليست هويّةً. فالبريدُ قد يُبدَّل،
// ورقمُ الهاتفِ قد يُنقَل، وحسابُ Telegram قد يُغيَّر. فالهويّةُ الداخليّةُ الثابتةُ
// (owner_id) هي المرجعُ، والمعرّفاتُ الخارجيّةُ تُربَطُ بها وتُتحقَّقُ وتُلغى
// دون أن تنكسرَ سلسلةُ الإسنادِ كلُّها.
//
// **وحدٌّ معلَنٌ أول — الحكمُ نقيٌّ واللمسُ محصور:** هذه الوحدةُ تُطبِّعُ المعرّفاتِ
// وتُخفيها وتُتحقَّقُ من شكلِها — ولا تُرسِلُ شيئاً ولا تقرأُ من شبكةٍ. فالإرسالُ
// أثرٌ والوحدةُ حكم.
//
// **وحدٌّ معلَنٌ ثانٍ — لا أسرارَ هنا:** لا تُخزَّنُ رموزُ API ولا كلماتُ السرِّ في
// هذه الوحدةِ ولا في قاعدةِ البيانات. يُخزَّنُ مرجعُ السرِّ وحدَه (اسمُ متغيرٍ
// بيئيٍّ أو مفتاحُ مخزنِ أسرارٍ)، والقيمةُ تُقرأُ من خارجِ الوحدةِ عند الإرسال.
//
// **وحدٌّ معلَنٌ ثالثٌ — الإخفاءُ واجب:** كلُّ معرّفٍ يُسجَّلُ في سجلِّ التدقيقِ
// يُخفى جزئيّاً. فبريدٌ مثل «owner@example.com» يُخفى إلى «o***r@example.com»،
// ورقمُ هاتفٍ يُخفى آخرَ أربعةٍ أرقام. والقيمةُ الخامُّ لا تُكتَبُ في سجلٍّ أبداً.

/**
 * @typedef {'email' | 'phone' | 'telegram_chat' | 'telegram_bot' | 'whatsapp' | 'instagram' | 'x_twitter' | 'device_id' | 'internal'} IdentityType
 *
 * @typedef {'verified' | 'unverified' | 'pending' | 'revoked'} VerificationStatus
 *
 * @typedef {'consented' | 'denied' | 'pending'} ConsentStatus
 *
 * @typedef {'active' | 'cancelled'} IdentityActivity
 *
 * @typedef {object} OwnerIdentity
 * @property {string} ownerId — معرّفٌ داخليٌّ ثابت (مثل owner:king)
 * @property {IdentityType} identityType
 * @property {string} identityValue — بعد التطبيع
 * @property {string} provider — اسمُ الخدمة (telegram, gmail, ...)
 * @property {VerificationStatus} verificationStatus
 * @property {ConsentStatus} consentStatus
 * @property {number} createdAtMs
 * @property {number | null} lastVerifiedAtMs
 * @property {string | null} proofSource
 * @property {IdentityActivity} activity
 * @property {string | null} secretRef — مرجعُ السرِّ (اسمُ متغيرٍ بيئيٍّ) لا القيمةُ
 */

import { OWNER_IDENTITY_ERRORS } from './errors.mjs';
import { OwnerIdentityError } from './errors.mjs';

const EMAIL_RE = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
const PHONE_RE = /^\+[1-9]\d{6,14}$/;
const TELEGRAM_CHAT_RE = /^-?\d+$/;
const DEVICE_ID_RE = /^[a-f0-9]{16,64}$/;

/**
 * يُطبِّعُ قيمةَ المعرّفِ بحسبِ نوعِها — فالبريدُ يُصغَّرُ والهاتفُ يُوحَّدُ.
 * @param {IdentityType} type
 * @param {string} value
 * @returns {string}
 */
export function normalizeIdentityValue(type, value) {
  const trimmed = String(value).trim();
  switch (type) {
    case 'email':
      return trimmed.toLowerCase();
    case 'phone':
      return trimmed.replace(/[\s()-]/g, '');
    case 'telegram_chat':
    case 'telegram_bot':
      return trimmed;
    case 'whatsapp':
      return trimmed.replace(/[\s()-]/g, '');
    case 'instagram':
      return trimmed.toLowerCase().replace(/^@/, '');
    case 'x_twitter':
      return trimmed.toLowerCase().replace(/^@/, '');
    case 'device_id':
      return trimmed.toLowerCase();
    case 'internal':
      return trimmed;
    default:
      return trimmed;
  }
}

/**
 * يُخفي قيمةَ المعرّفِ جزئيّاً — فالقيمةُ الخامُّ لا تُكتَبُ في سجلٍّ أبداً.
 * @param {IdentityType} type
 * @param {string} value
 * @returns {string}
 */
export function maskIdentityValue(type, value) {
  const normalized = normalizeIdentityValue(type, value);
  switch (type) {
    case 'email': {
      const [local = '', domain = ''] = normalized.split('@');
      if (local.length <= 2) return `*@${domain}`;
      return `${local[0]}***${local[local.length - 1]}@${domain}`;
    }
    case 'phone': {
      const digits = normalized.replace(/\D/g, '');
      if (digits.length <= 4) return '*'.repeat(digits.length);
      return `+${'*'.repeat(digits.length - 4)}${digits.slice(-4)}`;
    }
    case 'telegram_chat':
    case 'telegram_bot': {
      if (normalized.length <= 4) return '*'.repeat(normalized.length);
      return `${normalized.slice(0, 2)}***${normalized.slice(-2)}`;
    }
    case 'whatsapp':
    case 'instagram':
    case 'x_twitter':
    case 'device_id':
    case 'internal':
    default: {
      if (normalized.length <= 4) return '*'.repeat(normalized.length);
      return `${normalized.slice(0, 2)}***${normalized.slice(-2)}`;
    }
  }
}

/**
 * يُتحقَّقُ من شكلِ المعرّفِ بحسبِ نوعِه — فشكلٌ خاطئٌ ليس تطبيعاً.
 * @param {IdentityType} type
 * @param {string} value
 * @returns {boolean}
 */
export function isValidIdentityValue(type, value) {
  const normalized = normalizeIdentityValue(type, value);
  switch (type) {
    case 'email':
      return EMAIL_RE.test(normalized);
    case 'phone':
      return PHONE_RE.test(normalized);
    case 'telegram_chat':
    case 'telegram_bot':
      return TELEGRAM_CHAT_RE.test(normalized);
    case 'whatsapp':
      return PHONE_RE.test(normalized);
    case 'instagram':
    case 'x_twitter':
      return normalized.length >= 1 && normalized.length <= 50;
    case 'device_id':
      return DEVICE_ID_RE.test(normalized);
    case 'internal':
      return normalized.length >= 1;
    default:
      return false;
  }
}

/**
 * يُنشئُ سجلَّ هويةِ مالكٍ مُتحقَّقاً منه — فكلُّ حقلٍ يُفحَصُ قبل أن يُكتَب.
 * @param {{
 *   ownerId: string,
 *   identityType: IdentityType,
 *   identityValue: string,
 *   provider: string,
 *   verificationStatus?: VerificationStatus,
 *   consentStatus?: ConsentStatus,
 *   createdAtMs: number,
 *   lastVerifiedAtMs?: number | null,
 *   proofSource?: string | null,
 *   activity?: IdentityActivity,
 *   secretRef?: string | null,
 * }} input
 * @returns {OwnerIdentity}
 */
export function createOwnerIdentity(input) {
  if (!input.ownerId || input.ownerId.length < 3) {
    throw new OwnerIdentityError(
      OWNER_IDENTITY_ERRORS.OWNER_ID_INVALID,
      'معرّفُ المالكِ قصيرٌ أو غائب',
      { ownerId: input.ownerId },
    );
  }
  if (!isValidIdentityValue(input.identityType, input.identityValue)) {
    throw new OwnerIdentityError(
      OWNER_IDENTITY_ERRORS.IDENTITY_VALUE_INVALID,
      `قيمةُ معرّفٍ غيرُ صحيحةٍ للنوعِ ${input.identityType}`,
      { identityType: input.identityType },
    );
  }
  if (!input.provider || input.provider.length < 1) {
    throw new OwnerIdentityError(OWNER_IDENTITY_ERRORS.PROVIDER_REQUIRED, 'اسمُ الخدمةِ غائب', {});
  }

  /** @type {OwnerIdentity} */
  const identity = Object.freeze({
    ownerId: input.ownerId,
    identityType: input.identityType,
    identityValue: normalizeIdentityValue(input.identityType, input.identityValue),
    provider: input.provider,
    verificationStatus: input.verificationStatus ?? 'unverified',
    consentStatus: input.consentStatus ?? 'pending',
    createdAtMs: input.createdAtMs,
    lastVerifiedAtMs: input.lastVerifiedAtMs ?? null,
    proofSource: input.proofSource ?? null,
    activity: input.activity ?? 'active',
    secretRef: input.secretRef ?? null,
  });

  return identity;
}

/**
 * يُتحقَّقُ من أنّ الهويّةَ مُوافَقٌ على التواصلِ عبرها ونشطةٌ.
 * @param {OwnerIdentity} identity
 * @returns {boolean}
 */
export function isDeliverable(identity) {
  return (
    identity.activity === 'active' &&
    identity.consentStatus === 'consented' &&
    identity.verificationStatus !== 'revoked'
  );
}

/**
 * يُعيدُ قناعاً آمناً للهويّةِ — للسجلِّ والتدقيق.
 * @param {OwnerIdentity} identity
 * @returns {{ ownerId: string, identityType: IdentityType, maskedValue: string, provider: string, verificationStatus: VerificationStatus, consentStatus: ConsentStatus, activity: IdentityActivity }}
 */
export function maskOwnerIdentity(identity) {
  return Object.freeze({
    ownerId: identity.ownerId,
    identityType: identity.identityType,
    maskedValue: maskIdentityValue(identity.identityType, identity.identityValue),
    provider: identity.provider,
    verificationStatus: identity.verificationStatus,
    consentStatus: identity.consentStatus,
    activity: identity.activity,
  });
}
