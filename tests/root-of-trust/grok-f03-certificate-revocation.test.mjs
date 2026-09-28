// خصوم Grok-F03 — دوامُ سحبِ الشهاداتِ على القرصِ وانتهاءُ صلاحيّتِها.
//
// العيب (Grok-F03): كان سحبُ الشهاداتِ في الذاكرةِ وحدَها (`Set` في
// `CertificateAuthority`)، فلا يبقى أثرُ السحبِ بعدَ إعادةِ تشغيلٍ: شهادةٌ
// سُحبت تعود صالحةً لأنّ مجموعةَ السحبِ فارغةٌ في العمليةِ الجديدةِ والتوقيعُ
// ما زال صحيحاً. وبلا انتهاءِ صلاحيّةٍ تبقى الشهادةُ المسروقةُ صالحةً إلى الأبد.
//
// الإصلاح: مخزنُ سحبٍ دائم (`RevocationStore`) يُحمَّلُ قبلَ أيِّ `isValid`،
// فلا تعودُ شهادةٌ مسحوبةٌ صالحةً بعدَ إعادةِ إقلاعٍ. وكلُّ شهادةٍ تنتهي بعدَ
// مدّةٍ محدودةٍ (`notAfter`) جزءٍ من الجسمِ الموقَّع، فلا تبقى صالحةً إلى الأبد،
// ولا يُبدَّلُ انتهاؤها إلا بكسرِ التوقيع. والفشلُ مغلقٌ: إن لم يكن المخزنُ
// جاهزاً للقراءةِ يُرجعُ `isValid` `false`.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  CertificateAuthority,
  KingIdentity,
  MemoryRevocationStore,
  DEFAULT_CERTIFICATE_TTL_MS,
} from '../../src/root-of-trust/index.mjs';

function setup(now = () => Date.now()) {
  const king = new KingIdentity();
  const ca = new CertificateAuthority(king, { now });
  return { king, ca };
}

test('الشهادة الصادرة تحمل notAfter وتُقبل ما لم تنتهِ', () => {
  const { ca } = setup();
  const cert = ca.issue('agent:x', 'minister', ['read']);
  assert.equal(typeof cert.notAfter, 'string', 'كل شهادة تنتهي');
  assert.ok(cert.notAfter.length > 0);
  assert.equal(ca.isValid(cert), true, 'شهادة لم تنتهِ تُقبل');
});

test('شهادةٌ منتهية الصلاحية تُرفض ولو صحَّ توقيعُها', () => {
  const { ca } = setup();
  const cert = ca.issue('agent:x', 'minister', ['read']);
  // تقديمُ الساعةِ إلى ما بعدَ الانتهاء.
  const expiredCa = new CertificateAuthority(ca.king, {
    now: () => Date.now() + DEFAULT_CERTIFICATE_TTL_MS + 1,
  });
  assert.equal(expiredCa.isValid(cert), false, 'الشهادة المنتهية مرفوضة');
});

test('شهادةٌ بلا notAfter تُرفض افتراضاً (لا تمرُّ شهادةٌ بلا أمد)', () => {
  const { king } = setup();
  const ca = new CertificateAuthority(king);
  // شهادةٌ مُلفَّقةٌ بلا notAfter: التوقيعُ صحيحٌ على جسمٍ ناقص، لكنّ الفحصَ
  // يرفضُها لأنّها بلا انتهاء.
  const cert = ca.issue('agent:x', 'minister', ['read']);
  /** @type {any} */
  const forged = { ...cert };
  delete forged.notAfter;
  assert.equal(ca.isValid(forged), false, 'الشهادة بلا notAfter مرفوضة');
});

test('تبديل notAfter يكسر التوقيع فتُرفض الشهادة', () => {
  const { ca } = setup();
  const cert = ca.issue('agent:x', 'minister', ['read']);
  const tampered = {
    ...cert,
    notAfter: new Date(Date.now() + 1000 * 60 * 60 * 24 * 365).toISOString(),
  };
  assert.equal(ca.isValid(tampered), false, 'تبديل notAfter يكسر التوقيع');
});

test('السحبُ يبقى نافذاً بعدَ إعادةِ بناءِ السلطةِ بنفسِ المخزنِ الدائم', () => {
  const { king } = setup();
  const store = new MemoryRevocationStore();
  const ca1 = new CertificateAuthority(king, { revocationStore: store });
  const cert = ca1.issue('agent:x', 'minister', ['read']);
  assert.equal(ca1.isValid(cert), true, 'قبل السحب: مقبولة');
  const result = ca1.revoke(cert.id, 'compromised');
  // `R5-A-05`: مخزنُ الذاكرةِ لا يَكتبُ كتابةً دائمةً، فلا يُقالُ عنه `persisted: true`
  // — وإن نفذَ السحبُ داخلَ العمليّةِ ونفذَ عندَ سلطةٍ ثانيةٍ على **الكائنِ نفسِه**.
  assert.equal(result.persisted, false, 'مخزن الذاكرة لا يدّعي كتابة دائمة');
  assert.equal(ca1.isValid(cert), false, 'بعد السحب: مرفوضة');
  // «إعادةُ تشغيل»: سلطةٌ جديدةٌ بنفسِ الملكِ ونفسِ المخزنِ — لا مجموعةُ ذاكرةٍ
  // جديدة. لو كان السحبُ في الذاكرةِ وحدَها لكانتْ الشهادةُ عادَتْ صالحةً هنا.
  const ca2 = new CertificateAuthority(king, { revocationStore: store });
  assert.equal(ca2.isValid(cert), false, 'بعد إعادة التشغيل بنفس المخزن: ما زالت مسحوبة');
});

test('الفشلُ المغلق: مخزنٌ غيرُ جاهزٍ يُرجعُ isValid ← false', () => {
  const { king } = setup();
  // مخزنٌ يُعلنُ أنّه غيرُ جاهزٍ للقراءة (كأنّ تحميلَ السجلِّ الدائمِ فشل).
  const unreadyStore = {
    durability: /** @type {const} */ ('volatile'),
    isRevoked: () => false,
    revoke: () => true,
    ready: () => false,
  };
  const ca = new CertificateAuthority(king, { revocationStore: unreadyStore });
  const cert = ca.issue('agent:x', 'minister', ['read']);
  assert.equal(ca.isValid(cert), false, 'المخزن غير الجاهز يرفض الشهادة');
});

test('السحبُ على مخزنٍ غيرِ جاهزٍ لا يدَّعي النجاح (persisted: false)', () => {
  const { king } = setup();
  const unreadyStore = {
    durability: /** @type {const} */ ('volatile'),
    isRevoked: () => false,
    revoke: () => true,
    ready: () => false,
  };
  const ca = new CertificateAuthority(king, { revocationStore: unreadyStore });
  const cert = ca.issue('agent:x', 'minister', ['read']);
  const result = ca.revoke(cert.id, 'compromised');
  assert.equal(result.persisted, false, 'لم يُكتب في المخزن غير الجاهز');
  // المخزنُ غيرُ جاهزٍ ← الفشلُ مغلقٌ: لا يمرُّ وكيلٌ بناءً على غيابِ دليلٍ.
  // فالشهادةُ غيرُ صالحةٍ لا لأنّها سُحبت، بل لأنّ النظامَ لا يستطيعُ التحققَ.
  assert.equal(ca.isValid(cert), false, 'المخزن غير الجاهز يرفض الشهادة (فشل مغلق)');
});

test('منعُ الترحيل الضمني: لا يُفعَّلُ قبولُ الشهاداتِ بلا notAfter إلا صراحةً', () => {
  const { king } = setup();
  const strict = new CertificateAuthority(king);
  const legacy = new CertificateAuthority(king, { allowLegacyCertificatesWithoutExpiry: true });
  // شهادةٌ «قديمة» حقيقية: أُصدِرتْ بلا notAfter ووُقِّعتْ على جسمٍ ناقصٍ.
  const legacyBody = {
    id: 'cert:legacy',
    subject: 'agent:legacy',
    issuer: king.id,
    role: 'minister',
    capabilities: ['read'],
    issuedAt: new Date().toISOString(),
  };
  /** @type {any} */
  const legacyCert = {
    ...legacyBody,
    signature: king.sign(legacyBody),
  };
  // شهادةٌ مُحدَّثةٌ (بلا notAfter) لكنّها مُلفَّقةٌ من شهادةٍ أُصدِرتْ بـnotAfter
  // — حذفُ الحقلِ يكسرُ التوقيع، فلا تمرُّ حتى في وضعِ الترحيل.
  const fresh = strict.issue('agent:x', 'minister', ['read']);
  /** @type {any} */
  const forged = { ...fresh };
  delete forged.notAfter;
  assert.equal(strict.isValid(legacyCert), false, 'الافتراض: رفض الشهادة القديمة بلا notAfter');
  assert.equal(
    legacy.isValid(legacyCert),
    true,
    'وضع الترحيل الصريح: يُقبل الشهادة القديمة للترحيل',
  );
  assert.equal(
    legacy.isValid(forged),
    false,
    'حذف notAfter من شهادة موقَّعة يكسر التوقيع حتى في وضع الترحيل',
  );
});

test('Grok-F03 (M11.04-F03): الإنتاجُ يرفضُ بناءَ السلطةِ بمخزنِ الذاكرةِ — لا ثباتَ بلا دائمٍ', () => {
  const king = new KingIdentity();
  const previous = process.env.STATE_ENV;
  process.env.STATE_ENV = 'production';
  try {
    assert.throws(
      () => new CertificateAuthority(king),
      (err) =>
        /** @type {Error} */ (err).message === 'PERSISTENT_REVOCATION_STORE_REQUIRED_IN_PRODUCTION',
      'يجبُ رفضُ بناءِ السلطةِ في الإنتاجِ بمخزنِ الذاكرةِ — لا ثباتَ بلا دائمٍ',
    );
  } finally {
    if (previous === undefined) delete process.env.STATE_ENV;
    else process.env.STATE_ENV = previous;
  }
});

test('Grok-F03 (M11.04-F03): الإنتاجُ بقبولِ مخزنٍ دائمٍ ينجحُ', () => {
  const king = new KingIdentity();
  const previous = process.env.STATE_ENV;
  process.env.STATE_ENV = 'production';
  try {
    // مخزنُ سحبٍ يُعلِنُ `durability: 'persistent'` — يُقبَلُ في الإنتاجِ بإعلانِه
    // لا بأنّه ليسَ `MemoryRevocationStore` (‏`R5-B-01`).
    const persistentStore = {
      durability: /** @type {const} */ ('persistent'),
      revoked: new Set(),
      isRevoked(/** @type {string} */ id) {
        return this.revoked.has(id);
      },
      revoke(/** @type {string} */ id) {
        this.revoked.add(id);
        return true;
      },
      ready() {
        return true;
      },
    };
    const ca = new CertificateAuthority(king, { revocationStore: persistentStore });
    assert.equal(
      ca instanceof CertificateAuthority,
      true,
      'البناءُ بمخزنٍ دائمٍ صريحٍ ينجحُ في الإنتاجِ',
    );
  } finally {
    if (previous === undefined) delete process.env.STATE_ENV;
    else process.env.STATE_ENV = previous;
  }
});
