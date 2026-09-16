// اختباراتُ وحدةِ هويةِ المالك — التطبيعُ والإخفاءُ والتحقُّقُ والإنشاء.
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  OWNER_IDENTITY_ERRORS,
  OwnerIdentityError,
  createOwnerIdentity,
  createOwnerDevice,
  isDeliverable,
  isValidIdentityValue,
  maskIdentityValue,
  maskOwnerDevice,
  maskOwnerIdentity,
  normalizeIdentityValue,
} from '../../src/owner-identity/index.mjs';

// ── التطبيع ──

test('normalizeIdentityValue يُطبِّعُ البريدَ إلى أحرفٍ صغيرة', () => {
  assert.equal(normalizeIdentityValue('email', 'Owner@Example.COM'), 'owner@example.com');
});

test('normalizeIdentityValue يُزيلُ المسافاتِ من رقمِ الهاتف', () => {
  assert.equal(normalizeIdentityValue('phone', '+966 50 123 4567'), '+966501234567');
});

test('normalizeIdentityValue يُزيلُ @ من معرّفِ Instagram', () => {
  assert.equal(normalizeIdentityValue('instagram', '@username'), 'username');
});

// ── الإخفاء ──

test('maskIdentityValue يُخفي البريدَ جزئيّاً', () => {
  const masked = maskIdentityValue('email', 'owner@example.com');
  assert.ok(masked.includes('***'));
  assert.ok(!masked.includes('owner@example.com'));
  assert.ok(masked.includes('@example.com'));
});

test('maskIdentityValue يُخفي آخرَ أربعةِ أرقامٍ من الهاتف', () => {
  const masked = maskIdentityValue('phone', '+966501234567');
  assert.ok(masked.includes('4567'));
  assert.ok(!masked.includes('96650123'));
});

// ── التحقق ──

test('isValidIdentityValue يقبلُ بريداً صحيحاً', () => {
  assert.ok(isValidIdentityValue('email', 'test@example.com'));
});

test('isValidIdentityValue يرفضُ بريداً تالفاً', () => {
  assert.ok(!isValidIdentityValue('email', 'not-an-email'));
});

test('isValidIdentityValue يقبلُ رقمَ هاتفٍ دوليّاً', () => {
  assert.ok(isValidIdentityValue('phone', '+966501234567'));
});

// ── الإنشاء ──

test('createOwnerIdentity يُنشئُ هويّةً مُجمَّدةً صحيحة', () => {
  const identity = createOwnerIdentity({
    ownerId: 'owner:king',
    identityType: 'telegram_chat',
    identityValue: '8634283336',
    provider: 'telegram',
    verificationStatus: 'verified',
    consentStatus: 'consented',
    createdAtMs: 1000,
  });
  assert.equal(identity.ownerId, 'owner:king');
  assert.equal(identity.identityType, 'telegram_chat');
  assert.ok(Object.isFrozen(identity));
  assert.equal(identity.verificationStatus, 'verified');
});

test('createOwnerIdentity يرفضُ معرّفَ مالكٍ قصيراً', () => {
  assert.throws(
    () =>
      createOwnerIdentity({
        ownerId: 'a',
        identityType: 'email',
        identityValue: 'test@example.com',
        provider: 'gmail',
        createdAtMs: 1000,
      }),
    (/** @type {unknown} */ e) =>
      e instanceof OwnerIdentityError && e.code === OWNER_IDENTITY_ERRORS.OWNER_ID_INVALID,
  );
});

test('createOwnerIdentity يرفضُ قيمةً غيرَ صحيحة', () => {
  assert.throws(
    () =>
      createOwnerIdentity({
        ownerId: 'owner:king',
        identityType: 'email',
        identityValue: 'not-an-email',
        provider: 'gmail',
        createdAtMs: 1000,
      }),
    (/** @type {unknown} */ e) =>
      e instanceof OwnerIdentityError && e.code === OWNER_IDENTITY_ERRORS.IDENTITY_VALUE_INVALID,
  );
});

// ── isDeliverable ──

test('isDeliverable يُعيدُ true للهويّةِ النشطةِ المُوافقةِ المُتحقَّقة', () => {
  const identity = createOwnerIdentity({
    ownerId: 'owner:king',
    identityType: 'email',
    identityValue: 'test@example.com',
    provider: 'gmail',
    verificationStatus: 'verified',
    consentStatus: 'consented',
    createdAtMs: 1000,
  });
  assert.ok(isDeliverable(identity));
});

test('isDeliverable يُعيدُ false للهويّةِ غيرِ المُوافَقة', () => {
  const identity = createOwnerIdentity({
    ownerId: 'owner:king',
    identityType: 'email',
    identityValue: 'test@example.com',
    provider: 'gmail',
    consentStatus: 'pending',
    createdAtMs: 1000,
  });
  assert.ok(!isDeliverable(identity));
});

test('isDeliverable يُعيدُ false للهويّةِ المُلغاة', () => {
  const identity = createOwnerIdentity({
    ownerId: 'owner:king',
    identityType: 'email',
    identityValue: 'test@example.com',
    provider: 'gmail',
    verificationStatus: 'verified',
    consentStatus: 'consented',
    activity: 'cancelled',
    createdAtMs: 1000,
  });
  assert.ok(!isDeliverable(identity));
});

// ── maskOwnerIdentity ──

test('maskOwnerIdentity يُخفي القيمةَ ولا يكشفُها', () => {
  const identity = createOwnerIdentity({
    ownerId: 'owner:king',
    identityType: 'email',
    identityValue: 'owner@example.com',
    provider: 'gmail',
    createdAtMs: 1000,
  });
  const masked = maskOwnerIdentity(identity);
  assert.ok(!JSON.stringify(masked).includes('owner@example.com'));
  assert.ok(masked.maskedValue.includes('***'));
});

// ── الأجهزة ──

test('createOwnerDevice يُنشئُ جهازاً صحيحاً', () => {
  const device = createOwnerDevice({
    deviceId: 'device:king-laptop',
    deviceType: 'laptop',
    fingerprint: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4',
    ownerId: 'owner:king',
    registeredAtMs: 1000,
  });
  assert.equal(device.deviceId, 'device:king-laptop');
  assert.equal(device.deviceType, 'laptop');
  assert.ok(Object.isFrozen(device));
});

test('createOwnerDevice يرفضُ بصمةً غيرَ صحيحة', () => {
  assert.throws(
    () =>
      createOwnerDevice({
        deviceId: 'device:x',
        deviceType: 'laptop',
        fingerprint: 'short',
        ownerId: 'owner:king',
        registeredAtMs: 1000,
      }),
    (/** @type {unknown} */ e) =>
      e instanceof OwnerIdentityError &&
      e.code === OWNER_IDENTITY_ERRORS.DEVICE_FINGERPRINT_INVALID,
  );
});

test('maskOwnerDevice يُخفي البصمةَ في السجلِّ', () => {
  const device = createOwnerDevice({
    deviceId: 'device:king-laptop',
    deviceType: 'laptop',
    fingerprint: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4',
    ownerId: 'owner:king',
    registeredAtMs: 1000,
  });
  const masked = maskOwnerDevice(device);
  assert.ok(!masked.maskedFingerprint.includes('a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4'));
  assert.ok(masked.maskedFingerprint.includes('...'));
});

// ─ـ مالكٌ واحدٌ بمعرّفاتٍ متعدّدةٍ وأجهزةٍ متعدّدة ──

test('مالكٌ واحدٌ يربطُ أكثرَ من معرّفٍ وأكثرَ من جهاز', () => {
  const emailIdentity = createOwnerIdentity({
    ownerId: 'owner:king',
    identityType: 'email',
    identityValue: 'king@example.com',
    provider: 'gmail',
    verificationStatus: 'verified',
    consentStatus: 'consented',
    createdAtMs: 1000,
  });
  const telegramIdentity = createOwnerIdentity({
    ownerId: 'owner:king',
    identityType: 'telegram_chat',
    identityValue: '8634283336',
    provider: 'telegram',
    verificationStatus: 'verified',
    consentStatus: 'consented',
    createdAtMs: 2000,
  });
  const laptop = createOwnerDevice({
    deviceId: 'device:king-laptop',
    deviceType: 'laptop',
    fingerprint: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4',
    ownerId: 'owner:king',
    registeredAtMs: 1000,
  });
  const phone = createOwnerDevice({
    deviceId: 'device:king-phone',
    deviceType: 'phone',
    fingerprint: 'b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5',
    ownerId: 'owner:king',
    registeredAtMs: 2000,
  });

  assert.equal(emailIdentity.ownerId, telegramIdentity.ownerId);
  assert.equal(laptop.ownerId, phone.ownerId);
  assert.equal(emailIdentity.ownerId, laptop.ownerId);
  assert.notEqual(emailIdentity.identityType, telegramIdentity.identityType);
  assert.notEqual(laptop.deviceId, phone.deviceId);
});
