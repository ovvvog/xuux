// اختبار تدوير مفتاح الملك — الخطوة M2.04.
//
// معيار القبول حرفياً: «بعد التدوير تُقبل الأوامر الجديدة وتُرفض بالمفتاح
// المُبطَل». ولذلك الاختبار المحوري هنا يمرّ عبر `CrownGateway` الحقيقية لا
// عبر تحقق مباشر من التوقيع: القبول والرفض يجب أن يظهرا في البوابة التي
// تستهلك الملك فعلاً، وإلا كان الاختبار يشهد لنفسه.

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  CertificateAuthority,
  CoexistingKingIdentity,
  CrownGateway,
  DEFAULT_COEXISTENCE_MS,
  EventLog,
  KING_KEY_MANIFEST_NAME,
  KingIdentity,
  KingKeyError,
  KingKeyRotationError,
  KingKeyRotationErrorCodes,
  KingKeyVersionStatuses,
  LocalEncryptedKeyProvider,
  describeKingKeyRotation,
  ensureKingKeyManifest,
  kingKeyNameForVersion,
  loadKingIdentity,
  loadKingKeySet,
  provisionKingKey,
  readKingKeyManifest,
  reissueCertificate,
  reissueCertificates,
  revokeKingKeyVersion,
  rotateKingKey,
} from '../../src/root-of-trust/index.mjs';

/** @typedef {import('../../src/root-of-trust/key-provider.mjs').KeyProvider} KeyProvider */
/** @typedef {import('../../src/root-of-trust/identity.mjs').Certificate} Certificate */

/** @type {string[]} */
const directories = [];

/**
 * يبني مخزناً محلياً مشفَّراً جديداً لكل حالة، فلا تتسرب حالة بين الاختبارات.
 * @returns {LocalEncryptedKeyProvider} مخزناً معزولاً
 */
function freshProvider() {
  const directory = mkdtempSync(join(tmpdir(), 'king-rotation-'));
  directories.push(directory);
  return new LocalEncryptedKeyProvider(directory, randomUUID());
}

/**
 * يبني مخزناً مزوَّداً بمفتاح ملك (الحالة التي تتركها M2.03).
 * @returns {Promise<LocalEncryptedKeyProvider>} مخزناً فيه إصدار أول
 */
async function provisionedProvider() {
  const provider = freshProvider();
  await provisionKingKey(provider, { requireProductionReady: false });
  return provider;
}

/**
 * يوقّع أمراً ملكياً ويمرّره على البوابة.
 * @param {KingIdentity} signer - الملك الموقِّع
 * @param {CrownGateway} gateway - البوابة الفاحصة
 * @returns {import('../../src/root-of-trust/crown.mjs').AcceptedRoyalCommand} الأمر المقبول
 */
function issueCommand(signer, gateway) {
  const command = {
    id: randomUUID(),
    action: 'state.write',
    target: 'registry:models',
    payload: { note: 'أمر اختبار' },
    issuedAt: new Date().toISOString(),
  };
  return gateway.command(command, signer.sign(command));
}

test.after(() => {
  for (const directory of directories) rmSync(directory, { recursive: true, force: true });
});

// ─────────────── معيار القبول: القبول بعد التدوير والرفض بعد الإبطال ───────────────

test('بعد التدوير تُقبل الأوامر بالمفتاح الجديد وتُرفض بالمفتاح المُبطَل', async () => {
  const provider = await provisionedProvider();
  const before = await loadKingKeySet(provider, { requireProductionReady: false });
  const oldKingId = before.id;

  const rotation = await rotateKingKey(provider, {
    requireProductionReady: false,
    coexistenceMs: 60_000,
  });
  assert.equal(rotation.version, 2);
  assert.equal(rotation.previousVersion, 1);
  assert.notEqual(rotation.kingId, oldKingId);

  // بوابة تعمل بمجموعة المفاتيح بعد التدوير، وفي فترة التعايش.
  const during = await loadKingKeySet(provider, { requireProductionReady: false });
  const gateway = new CrownGateway(during, new CertificateAuthority(during), new EventLog());

  // الأمر الجديد (بالمفتاح الفعّال) مقبول.
  assert.equal(issueCommand(during, gateway).acceptedAt.length > 0, true);
  // وأمرٌ بالمفتاح السابق مقبول أيضاً **خلال التعايش** — وهذا هو الغرض منها.
  const oldSigner = await loadKingIdentity(provider, { requireProductionReady: false });
  assert.equal(issueCommand(oldSigner, gateway).acceptedAt.length > 0, true);

  // ثم يُبطل الإصدار السابق صراحةً.
  const revoked = await revokeKingKeyVersion(provider, 1, 'اشتباه تسرّب — اختبار');
  assert.equal(revoked.status, 'revoked');
  assert.equal(revoked.revocationReason, 'اشتباه تسرّب — اختبار');

  const after = await loadKingKeySet(provider, { requireProductionReady: false });
  const gatewayAfter = new CrownGateway(after, new CertificateAuthority(after), new EventLog());
  // الجديد يُقبل.
  assert.equal(issueCommand(after, gatewayAfter).acceptedAt.length > 0, true);
  // والمُبطَل يُرفض — وهو نصّ المعيار.
  assert.throws(() => issueCommand(oldSigner, gatewayAfter), /INVALID_ROYAL_SIGNATURE/);
  assert.deepEqual(after.acceptedVersions, [2]);
});

test('انتهاء فترة التعايش يرفض التوقيع القديم بلا إبطال، والمادة تبقى حتى يُبطل صراحةً', async () => {
  const provider = await provisionedProvider();
  const oldSigner = await loadKingIdentity(provider, { requireProductionReady: false });
  const start = new Date('2026-08-23T12:00:00.000Z');
  await rotateKingKey(provider, {
    requireProductionReady: false,
    coexistenceMs: 3_600_000,
    now: start,
  });

  const inside = await loadKingKeySet(provider, {
    requireProductionReady: false,
    now: new Date(start.getTime() + 1_800_000),
  });
  assert.deepEqual(inside.acceptedVersions, [2, 1]);

  const outside = await loadKingKeySet(provider, {
    requireProductionReady: false,
    now: new Date(start.getTime() + 3_600_001),
  });
  assert.deepEqual(outside.acceptedVersions, [2]);
  const payload = { note: 'مادة' };
  assert.equal(outside.verify(payload, oldSigner.sign(payload)), false);

  // ومع ذلك المادة لم تُمحَ: المحو لا يقع إلا بإبطال صريح، فلا تهدم ساعةٌ
  // مغشوشة القدرة على التحقق من أرشيف قديم.
  assert.equal(await provider.has(kingKeyNameForVersion(1)), true);
  await revokeKingKeyVersion(provider, 1, 'انتهى التعايش');
  assert.equal(await provider.has(kingKeyNameForVersion(1)), false);
});

// ─────────────── الإصدارات والبيان ───────────────

test('الإصدار الأول يحتفظ باسم M2.03 فلا هجرة مادة، والتالي يأخذ لاحقة إصدار', async () => {
  assert.equal(kingKeyNameForVersion(1), 'king-signing-key');
  assert.equal(kingKeyNameForVersion(2), 'king-signing-key:v2');
  assert.equal(kingKeyNameForVersion(7), 'king-signing-key:v7');

  const provider = await provisionedProvider();
  const beforeId = (await loadKingIdentity(provider, { requireProductionReady: false })).id;
  const manifest = await ensureKingKeyManifest(provider, { requireProductionReady: false });
  assert.equal(manifest.activeVersion, 1);
  assert.equal(manifest.versions[0]?.keyName, 'king-signing-key');
  assert.equal(manifest.versions[0]?.kingId, beforeId);
  // إنشاء البيان لم يمسّ المادة: نفس الهوية بعده.
  assert.equal((await loadKingIdentity(provider, { requireProductionReady: false })).id, beforeId);
});

test('التدوير يُنشئ مادة جديدة ولا يطمس القديمة، ويثبت الإصدارات في البيان', async () => {
  const provider = await provisionedProvider();
  await rotateKingKey(provider, { requireProductionReady: false });
  await rotateKingKey(provider, { requireProductionReady: false });

  const manifest = await readKingKeyManifest(provider);
  assert.notEqual(manifest, null);
  assert.equal(manifest?.activeVersion, 3);
  assert.deepEqual(
    manifest?.versions.map((version) => [version.version, version.status]),
    [
      [1, 'retiring'],
      [2, 'retiring'],
      [3, 'active'],
    ],
  );
  for (const version of manifest?.versions ?? []) {
    assert.equal(await provider.has(version.keyName), true);
    // البيان يحمل مفتاحاً عاماً فقط: لا مادة خاصة فيه بأي شكل.
    assert.match(version.publicKeyPem, /BEGIN PUBLIC KEY/);
    assert.doesNotMatch(version.publicKeyPem, /PRIVATE/);
  }
  const stored = await provider.get(KING_KEY_MANIFEST_NAME);
  assert.doesNotMatch(stored, /PRIVATE/);
});

test('فترة التعايش الافتراضية معلَنة رقماً، والمدة السالبة أو غير الرقمية تُرفض', async () => {
  assert.equal(DEFAULT_COEXISTENCE_MS, 86_400_000);
  const provider = await provisionedProvider();
  const result = await rotateKingKey(provider, { requireProductionReady: false });
  const remaining = Date.parse(result.coexistUntil) - Date.now();
  assert.equal(remaining > DEFAULT_COEXISTENCE_MS - 10_000, true);
  assert.equal(remaining <= DEFAULT_COEXISTENCE_MS, true);

  for (const bad of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
    await assert.rejects(
      () => rotateKingKey(provider, { requireProductionReady: false, coexistenceMs: bad }),
      (error) =>
        error instanceof KingKeyRotationError && error.code === 'COEXISTENCE_WINDOW_INVALID',
    );
  }
});

test('التعايش الصفري يُنتج إصداراً سابقاً غير مقبول فوراً، بلا محو مادته', async () => {
  const provider = await provisionedProvider();
  const now = new Date('2026-08-23T12:00:00.000Z');
  await rotateKingKey(provider, { requireProductionReady: false, coexistenceMs: 0, now });
  const set = await loadKingKeySet(provider, {
    requireProductionReady: false,
    now: new Date(now.getTime() + 1),
  });
  assert.deepEqual(set.acceptedVersions, [2]);
  assert.equal(await provider.has(kingKeyNameForVersion(1)), true);
});

// ─────────────── الإبطال ───────────────

test('لا يُبطل الإصدار الفعّال، ولا يُبطل مرتين، ولا يُبطل ما لا وجود له', async () => {
  const provider = await provisionedProvider();
  await ensureKingKeyManifest(provider, { requireProductionReady: false });

  await assert.rejects(
    () => revokeKingKeyVersion(provider, 1, 'محاولة إبطال الفعّال'),
    (error) =>
      error instanceof KingKeyRotationError && error.code === 'CANNOT_REVOKE_ACTIVE_VERSION',
  );

  await rotateKingKey(provider, { requireProductionReady: false });
  await revokeKingKeyVersion(provider, 1, 'تدوير مخطَّط');
  await assert.rejects(
    () => revokeKingKeyVersion(provider, 1, 'مرة ثانية'),
    (error) => error instanceof KingKeyRotationError && error.code === 'VERSION_ALREADY_REVOKED',
  );
  await assert.rejects(
    () => revokeKingKeyVersion(provider, 99, 'إصدار وهمي'),
    (error) => error instanceof KingKeyRotationError && error.code === 'VERSION_NOT_FOUND',
  );
});

test('إحضار المجموعة يُرفض إن كان الفعّال مُبطَلاً، ولا يسقط إلى مفتاح مولَّد', async () => {
  const provider = await provisionedProvider();
  const manifest = await ensureKingKeyManifest(provider, { requireProductionReady: false });
  // عبثٌ يدوي بالبيان: إصدار فعّال مُعلَن مُبطَلاً.
  await provider.put(
    KING_KEY_MANIFEST_NAME,
    JSON.stringify({
      ...manifest,
      versions: [
        { ...manifest.versions[0], status: 'revoked', revokedAt: new Date().toISOString() },
      ],
    }),
    { overwrite: true },
  );
  await assert.rejects(
    () => loadKingKeySet(provider, { requireProductionReady: false }),
    (error) => error instanceof KingKeyRotationError && error.code === 'ACTIVE_VERSION_REVOKED',
  );
});

test('حالة «مُبطَل» وحدها تكفي للرفض ولو بقيت المادة في المخزن', async () => {
  // هذه الحالة أضيفت بعد قياس طفرة: إسقاط فحص الحالة عند الإحضار لم يُفشل أي
  // اختبار، لأن الإبطال يمحو المادة فيحجبها فحص الوجود. فكان القبول محروساً
  // بطبقة واحدة عملياً، والحراسة المزدوجة غير مُختبرة. وهنا تُزرع الحالة يدوياً
  // مع بقاء المادة — كما يحدث لو أُبطل إصدار في مخزن ثانٍ لم يُمحَ منه بعد.
  const provider = await provisionedProvider();
  const oldSigner = await loadKingIdentity(provider, { requireProductionReady: false });
  await rotateKingKey(provider, { requireProductionReady: false, coexistenceMs: 600_000 });
  const manifest = await readKingKeyManifest(provider);
  assert.notEqual(manifest, null);

  await provider.put(
    KING_KEY_MANIFEST_NAME,
    JSON.stringify({
      .../** @type {NonNullable<typeof manifest>} */ (manifest),
      versions: /** @type {NonNullable<typeof manifest>} */ (manifest).versions.map((version) =>
        version.version === 1
          ? { ...version, status: 'revoked', revokedAt: new Date().toISOString() }
          : version,
      ),
    }),
    { overwrite: true },
  );

  assert.equal(await provider.has(kingKeyNameForVersion(1)), true, 'المادة ما زالت موجودة');
  const set = await loadKingKeySet(provider, { requireProductionReady: false });
  assert.deepEqual(set.acceptedVersions, [2], 'الحالة وحدها كافية للاستبعاد');
  const payload = { note: 'مادة' };
  assert.equal(set.verify(payload, oldSigner.sign(payload)), false);

  const described = await describeKingKeyRotation(provider);
  const first = described.versions.find((version) => version.version === 1);
  assert.equal(first?.materialPresent, true);
  assert.equal(first?.acceptedNow, false, 'الوصف يوافق قرار الإحضار');
});

test('بيان تالف أو غير متسق يُرفض ولا يُصلَح تخميناً', async () => {
  const provider = await provisionedProvider();
  /** @type {[string, string][]} */
  const cases = [
    ['ليس JSON', 'نصّ ليس JSON'],
    ['ليس كائناً', '"سلسلة"'],
    [
      'بلا إصدارات',
      JSON.stringify({ baseKeyName: 'king-signing-key', activeVersion: 1, versions: [] }),
    ],
    [
      'إصدار فعّال غير موجود في القائمة',
      JSON.stringify({
        baseKeyName: 'king-signing-key',
        activeVersion: 9,
        versions: [
          {
            version: 1,
            keyName: 'king-signing-key',
            kingId: 'king:x',
            publicKeyPem: 'p',
            status: 'active',
            createdAt: 'now',
          },
        ],
      }),
    ],
    [
      'حالة غير معروفة',
      JSON.stringify({
        baseKeyName: 'king-signing-key',
        activeVersion: 1,
        versions: [
          {
            version: 1,
            keyName: 'king-signing-key',
            kingId: 'king:x',
            publicKeyPem: 'p',
            status: 'مجهول',
            createdAt: 'now',
          },
        ],
      }),
    ],
  ];
  for (const [label, body] of cases) {
    await provider.put(KING_KEY_MANIFEST_NAME, body, { overwrite: true });
    await assert.rejects(
      () => readKingKeyManifest(provider),
      (error) => error instanceof KingKeyRotationError && error.code === 'MANIFEST_INVALID',
      label,
    );
  }
});

test('لا تدوير على مخزن بلا مفتاح ملك: التزويد فعل سيادي له مساره', async () => {
  const provider = freshProvider();
  await assert.rejects(
    () => rotateKingKey(provider, { requireProductionReady: false }),
    (error) => error instanceof KingKeyError && error.code === 'KING_KEY_NOT_PROVISIONED',
  );
  assert.equal(await readKingKeyManifest(provider), null);
});

// ─────────────── إعادة توقيع الشهادات ───────────────

test('إعادة التوقيع تُبقي المعرّف والموضوع والقدرات وتُحوّل المُصدِّر إلى الملك الجديد', async () => {
  const provider = await provisionedProvider();
  const before = await loadKingKeySet(provider, { requireProductionReady: false });
  const oldCa = new CertificateAuthority(before);
  const certificate = oldCa.issue('agent:نديم', 'operator', ['state.read']);

  await rotateKingKey(provider, { requireProductionReady: false, coexistenceMs: 0 });
  const after = await loadKingKeySet(provider, { requireProductionReady: false });
  const newCa = new CertificateAuthority(after);

  // الشهادة القديمة لم تعد صالحة عند الملك الجديد — ولهذا وُجدت إعادة التوقيع.
  assert.equal(newCa.isValid(certificate), false);

  const reissued = reissueCertificate(certificate, after);
  assert.equal(newCa.isValid(reissued), true);
  assert.equal(reissued.id, certificate.id);
  assert.equal(reissued.subject, certificate.subject);
  assert.equal(reissued.role, certificate.role);
  assert.deepEqual(reissued.capabilities, certificate.capabilities);
  assert.equal(reissued.issuedAt, certificate.issuedAt);
  assert.equal(reissued.issuer, after.id);
  assert.notEqual(reissued.signature, certificate.signature);
});

test('السحب يبقى نافذاً بعد إعادة التوقيع لأن المعرّف لم يتغيّر', async () => {
  const provider = await provisionedProvider();
  const before = await loadKingKeySet(provider, { requireProductionReady: false });
  const first = new CertificateAuthority(before).issue('agent:مسحوب', 'operator', []);
  const second = new CertificateAuthority(before).issue('agent:سليم', 'operator', []);

  await rotateKingKey(provider, { requireProductionReady: false, coexistenceMs: 0 });
  const after = await loadKingKeySet(provider, { requireProductionReady: false });
  const ca = new CertificateAuthority(after);
  ca.revoke(first.id, 'سُحبت قبل التدوير');

  const reissued = reissueCertificates([first, second], after);
  const [reissuedFirst, reissuedSecond] = /** @type {[Certificate, Certificate]} */ (reissued);
  assert.equal(ca.isValid(reissuedFirst), false, 'المسحوبة لا تعود بالحياة بإعادة التوقيع');
  assert.equal(ca.isValid(reissuedSecond), true);
});

// ─────────────── هوية التعايش ───────────────

test('هوية التعايش توقّع بالفعّال وحده وتكشف أي إصدار قَبِل التوقيع', async () => {
  const provider = await provisionedProvider();
  const oldSigner = await loadKingIdentity(provider, { requireProductionReady: false });
  const rotation = await rotateKingKey(provider, {
    requireProductionReady: false,
    coexistenceMs: 600_000,
  });
  const set = await loadKingKeySet(provider, { requireProductionReady: false });

  assert.equal(set instanceof CoexistingKingIdentity, true);
  assert.equal(set instanceof KingIdentity, true, 'قابلة للتمرير في كل موضع يطلب ملكاً');
  assert.equal(set.activeVersion, 2);
  assert.equal(set.id, rotation.kingId, 'هويتها هي هوية الإصدار الفعّال');

  const payload = { note: 'مادة' };
  assert.equal(set.verifyingVersion(payload, set.sign(payload)), 2, 'التوقيع بالفعّال دائماً');
  assert.equal(set.verifyingVersion(payload, oldSigner.sign(payload)), 1);
  assert.equal(set.verifyingVersion(payload, new KingIdentity().sign(payload)), null);
  assert.deepEqual(set.acceptedVersions, [2, 1]);
});

test('مخزن لم يُدوَّر بعد يعمل بلا بيان، والإحضار لا يكتب شيئاً', async () => {
  const provider = await provisionedProvider();
  const set = await loadKingKeySet(provider, { requireProductionReady: false });
  assert.equal(set.activeVersion, 1);
  assert.deepEqual(set.acceptedVersions, [1]);
  assert.equal(await provider.has(KING_KEY_MANIFEST_NAME), false, 'الإحضار قراءة محضة');

  const described = await describeKingKeyRotation(provider);
  assert.equal(described.initialized, false);
  assert.equal(described.activeVersion, 1);
  assert.equal(await provider.has(KING_KEY_MANIFEST_NAME), false, 'الوصف قراءة محضة أيضاً');
});

// ─────────────── التدقيق والرموز ───────────────

test('الوصف يُبيّن الحالات والمقبول الآن ولا يُخرج مادة ولا توكناً', async () => {
  const provider = await provisionedProvider();
  const now = new Date('2026-08-23T12:00:00.000Z');
  await rotateKingKey(provider, { requireProductionReady: false, coexistenceMs: 3_600_000, now });
  await rotateKingKey(provider, {
    requireProductionReady: false,
    coexistenceMs: 3_600_000,
    now: new Date(now.getTime() + 1000),
  });
  await revokeKingKeyVersion(provider, 1, 'تدوير مخطَّط', { now });

  const described = await describeKingKeyRotation(provider, {
    now: new Date(now.getTime() + 2000),
  });
  assert.equal(described.initialized, true);
  assert.equal(described.activeVersion, 3);
  assert.deepEqual(
    described.versions.map((version) => [
      version.version,
      version.status,
      version.materialPresent,
      version.acceptedNow,
    ]),
    [
      [1, 'revoked', false, false],
      [2, 'retiring', true, true],
      [3, 'active', true, true],
    ],
  );
  const serialized = JSON.stringify(described);
  assert.doesNotMatch(serialized, /PRIVATE/);
});

test('رموز أخطاء التدوير وحالات الإصدار مثبَّتة نصاً، والرسالة هي الرمز', () => {
  assert.deepEqual([...KingKeyRotationErrorCodes].sort(), [
    'ACTIVE_VERSION_REVOKED',
    'CANNOT_REVOKE_ACTIVE_VERSION',
    'COEXISTENCE_WINDOW_INVALID',
    'MANIFEST_INVALID',
    'VERSION_ALREADY_REVOKED',
    'VERSION_NOT_FOUND',
  ]);
  assert.deepEqual([...KingKeyVersionStatuses], ['active', 'retiring', 'revoked']);
  const error = new KingKeyRotationError('VERSION_NOT_FOUND');
  assert.equal(error.message, 'VERSION_NOT_FOUND');
  assert.equal(error.name, 'KingKeyRotationError');
  assert.equal(error instanceof Error, true);
});

test('التدوير على مخزن غير إنتاجي يُرفض في الوضع الإنتاجي', async () => {
  const provider = await provisionedProvider();
  await assert.rejects(
    () => rotateKingKey(provider, { requireProductionReady: true }),
    (error) => error instanceof KingKeyError && error.code === 'PROVIDER_NOT_PRODUCTION_READY',
  );
});
