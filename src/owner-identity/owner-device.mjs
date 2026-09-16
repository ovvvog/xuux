// سجلُ الأجهزة — يربطُ الجهازَ بالمالكِ ويتحقَّقُ من بصمتِه.
//
// **وحدٌّ معلَنٌ — لا بصمةَ خامَّةً عبرَ الإنترنت:** لا يُعتمَدُ على عنوانِ MAC
// كهويّةٍ عامّةٍ عبرَ الإنترنت. يُستخدمُ فقط في شبكةٍ محليّةٍ أو حين يُرسِلُهُ وكيلٌ
// مثبَّتٌ ومصرَّحٌ به. والقيمةُ المُخزَّنةُ مشتقَّةٌ ومحميّةٌ لا خامَّة.

/**
 * @typedef {'laptop' | 'desktop' | 'phone' | 'tablet' | 'server' | 'embedded'} DeviceType
 *
 * @typedef {'active' | 'inactive' | 'revoked'} DeviceStatus
 *
 * @typedef {object} OwnerDevice
 * @property {string} deviceId — معرّفٌ داخليٌّ (مثل device:king-laptop)
 * @property {DeviceType} deviceType
 * @property {string | null} name — اسمٌ اختياريّ
 * @property {string | null} platform — نظامُ التشغيلِ أو المنصّة
 * @property {string} fingerprint — بصمةٌ مشتقَّةٌ غيرُ قابلةٍ للعكس
 * @property {string} ownerId — المالكُ المرتبط
 * @property {number} registeredAtMs
 * @property {number | null} lastSeenAtMs
 * @property {DeviceStatus} status
 */

import { OWNER_IDENTITY_ERRORS, OwnerIdentityError } from './errors.mjs';

const FINGERPRINT_RE = /^[a-f0-9]{16,128}$/;

/**
 * يُنشئُ سجلَّ جهازٍ مُتحقَّقاً منه.
 * @param {{
 *   deviceId: string,
 *   deviceType: DeviceType,
 *   name?: string | null,
 *   platform?: string | null,
 *   fingerprint: string,
 *   ownerId: string,
 *   registeredAtMs: number,
 *   lastSeenAtMs?: number | null,
 *   status?: DeviceStatus,
 * }} input
 * @returns {OwnerDevice}
 */
export function createOwnerDevice(input) {
  if (!input.deviceId || input.deviceId.length < 3) {
    throw new OwnerIdentityError(
      OWNER_IDENTITY_ERRORS.DEVICE_OWNER_REQUIRED,
      'معرّفُ الجهازِ قصيرٌ أو غائب',
      { deviceId: input.deviceId },
    );
  }
  if (!input.fingerprint || !FINGERPRINT_RE.test(input.fingerprint)) {
    throw new OwnerIdentityError(
      OWNER_IDENTITY_ERRORS.DEVICE_FINGERPRINT_INVALID,
      'بصمةُ الجهازِ ليست بصمةً مشتقَّةً صحيحة',
      {},
    );
  }
  if (!input.ownerId || input.ownerId.length < 3) {
    throw new OwnerIdentityError(
      OWNER_IDENTITY_ERRORS.DEVICE_OWNER_REQUIRED,
      'مالكُ الجهازِ غائب',
      {},
    );
  }

  return Object.freeze({
    deviceId: input.deviceId,
    deviceType: input.deviceType,
    name: input.name ?? null,
    platform: input.platform ?? null,
    fingerprint: input.fingerprint,
    ownerId: input.ownerId,
    registeredAtMs: input.registeredAtMs,
    lastSeenAtMs: input.lastSeenAtMs ?? null,
    status: input.status ?? 'active',
  });
}

/**
 * يُخفي بصمةَ الجهازِ في السجلِّ — لا تُكتَبُ كاملةً.
 * @param {string} fingerprint
 * @returns {string}
 */
export function maskDeviceFingerprint(fingerprint) {
  if (fingerprint.length <= 8) return '*'.repeat(fingerprint.length);
  return `${fingerprint.slice(0, 4)}...${fingerprint.slice(-4)}`;
}

/**
 * يُعيدُ قناعاً آمناً للجهازِ — للسجلِّ والتدقيق.
 * @param {OwnerDevice} device
 * @returns {{ deviceId: string, deviceType: DeviceType, maskedFingerprint: string, ownerId: string, status: DeviceStatus }}
 */
export function maskOwnerDevice(device) {
  return Object.freeze({
    deviceId: device.deviceId,
    deviceType: device.deviceType,
    maskedFingerprint: maskDeviceFingerprint(device.fingerprint),
    ownerId: device.ownerId,
    status: device.status,
  });
}
