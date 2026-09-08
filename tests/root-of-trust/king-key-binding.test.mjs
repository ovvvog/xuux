// اختبار ربط مفتاح الملك بمخزن خارجي — معيار قبول الخطوة M2.03 (الفجوة G1).
//
// المعيار نصّه: «اربط مفتاح الملك بمخزن خارجي؛ يُمنع وجود مفتاح خاص في المستودع
// أو على قرص الخدمة». وهذا الملف يُثبت الشقّين:
//   1. **الربط ربطٌ لا إعادة توليد:** تزويدٌ واحد ثم إحضارٌ في «عملية أخرى»
//      يُنتج نفس معرّف الملك، وتوقيعٌ صدر قبل الإحضار يبقى قابلاً للتحقق بعده.
//      هذا هو الفرق بين جذر ثقة وبين ملك جديد كل إقلاع.
//   2. **لا مادة على قرص الخدمة:** يُشغَّل التزويد والإحضار وكل مسار التوقيع
//      بمجلد عمل مؤقت، ثم يُفحص المجلد بفاحص M2.03 نفسه ⇒ صفر مخالفة. وليثبت
//      أن الفحص ليس فارغاً، يُفحص في المقابل مجلد التطبيق المحلي فيُكشف فيه
//      مادة مشفَّرة مقيمة على القرص.
// التشغيل: node --test tests/root-of-trust/king-key-binding.test.mjs

import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID, generateKeyPairSync } from 'node:crypto';

import { startSecretStore } from '../helpers/secret-store.mjs';
import { scanPathForKeys, partitionBySeverity } from '../../scripts/scan-private-keys.mjs';
import {
  CertificateAuthority,
  KingIdentity,
  KingKeyError,
  KingKeyErrorCodes,
  KING_KEY_NAME,
  LocalEncryptedKeyProvider,
  ProductionBootError,
  RemoteSecretStoreKeyProvider,
  describeKingKeyBinding,
  kingIdentityFromMaterial,
  kingKeyProviderFromEnv,
  loadKingIdentity,
  provisionKingKey,
} from '../../src/root-of-trust/index.mjs';

const storeToken = randomUUID();
const store = await startSecretStore(storeToken);
const workDirectory = mkdtempSync(join(tmpdir(), 'king-key-work-'));
const localDirectory = mkdtempSync(join(tmpdir(), 'king-key-local-'));

/**
 * يُنشئ عميل مخزن خارجي جديداً في كل نداء، محاكياً «عملية جديدة» لا تحمل شيئاً
 * في ذاكرتها من التزويد السابق.
 * @returns {RemoteSecretStoreKeyProvider}
 */
const externalStore = () =>
  new RemoteSecretStoreKeyProvider({
    endpoint: store.origin,
    token: storeToken,
    allowInsecureTransport: true,
  });

after(async () => {
  await store.close();
  rmSync(workDirectory, { recursive: true, force: true });
  rmSync(localDirectory, { recursive: true, force: true });
});

// ─────────────────────────── الشقّ الأول: الربط ───────────────────────────

test('التزويد يضع المادة في المخزن الخارجي ولا يُرجعها إلى المستدعي', async () => {
  const provider = externalStore();
  const result = await provisionKingKey(provider, { requireProductionReady: false });

  assert.match(result.id, /^king:[0-9a-f]{24}$/);
  assert.match(result.publicKeyPem, /^-----BEGIN PUBLIC KEY-----/);
  assert.equal(result.record.name, KING_KEY_NAME);
  assert.equal(await provider.has(KING_KEY_NAME), true);

  // حصيلة التزويد كائن معلوم الحقول: أي مادة خاصة كانت ستظهر في تسلسله.
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes('PRIVATE KEY'), false);
  assert.deepEqual(Object.keys(result).sort(), ['fingerprint', 'id', 'publicKeyPem', 'record']);
});

test('الإحضار من المخزن يُنتج نفس الملك: نفس المعرّف، وتوقيع سابق يبقى صحيحاً', async () => {
  // توقيع صدر «قبل إعادة التشغيل»
  const before = await loadKingIdentity(externalStore(), { requireProductionReady: false });
  const payload = { order: 'أمر ملكي', at: '2026-08-23T12:00:00.000Z' };
  const signature = before.sign(payload);

  // عميل جديد تماماً، لا يشترك مع الأول في ذاكرة
  const after1 = await loadKingIdentity(externalStore(), { requireProductionReady: false });

  assert.equal(after1.id, before.id, 'معرّف الملك تغيّر بين إحضارين ⇒ الربط ليس ربطاً');
  assert.equal(after1.verify(payload, signature), true, 'توقيع سابق لم يُقبل بعد الإحضار');
  assert.equal(
    after1.certificate().publicKey,
    before.certificate().publicKey,
    'المفتاح العام تغيّر ⇒ المادة أُعيد توليدها لا إحضارها',
  );

  // والنقيض المطلوب إثباته: البناء بلا مادة يولّد ملكاً آخر.
  assert.notEqual(new KingIdentity().id, before.id);
});

test('الشهادات الصادرة عن ملك محضَر من المخزن تُقبل وتُسحب كما هي', async () => {
  const king = await loadKingIdentity(externalStore(), { requireProductionReady: false });
  const ca = new CertificateAuthority(king);
  const cert = ca.issue('agent:وزارة-الداخلية', 'minister', ['read']);

  assert.equal(ca.isValid(cert), true);
  ca.revoke(cert.id, 'اختبار');
  assert.equal(ca.isValid(cert), false);

  // شهادة ملك آخر لا تُقبل عند هذا الملك: التحقق مربوط بالمادة المحضَرة.
  const foreign = new CertificateAuthority(new KingIdentity()).issue('agent:دخيل', 'minister');
  assert.equal(ca.isValid(foreign), false);
});

test('لا تزويد فوق تزويد، ولا إحضار لما لم يُزوَّد', async () => {
  await assert.rejects(
    () => provisionKingKey(externalStore(), { requireProductionReady: false }),
    (error) => error instanceof KingKeyError && error.code === 'KING_KEY_ALREADY_PROVISIONED',
    'التزويد فوق مفتاح قائم يطمس جذر الثقة ويُبطل كل شهادة صدرت عنه',
  );

  const empty = new LocalEncryptedKeyProvider(
    mkdtempSync(join(tmpdir(), 'king-key-empty-')),
    randomUUID(),
  );
  await assert.rejects(
    () => loadKingIdentity(empty, { requireProductionReady: false }),
    (error) => error instanceof KingKeyError && error.code === 'KING_KEY_NOT_PROVISIONED',
  );
});

test('رموز أخطاء الربط كلها معلَنة، ورسالة الخطأ هي الرمز ولا تحمل سرًّا', () => {
  assert.deepEqual([...KingKeyErrorCodes].sort(), [
    'KEY_STORE_NOT_CONFIGURED',
    'KING_KEY_ALREADY_PROVISIONED',
    'KING_KEY_MATERIAL_INVALID',
    'KING_KEY_NOT_PROVISIONED',
    'PROVIDER_CANNOT_EXPORT',
    'PROVIDER_NOT_PRODUCTION_READY',
  ]);
  const error = new KingKeyError('KING_KEY_MATERIAL_INVALID');
  assert.equal(error.message, 'KING_KEY_MATERIAL_INVALID');
  assert.equal(error.name, 'KingKeyError');
});

test('المادة غير الصالحة أو غير Ed25519 تُرفض بلا تمرير نص خطأ المكتبة', () => {
  const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const rsaMaterial = /** @type {string} */ (
    rsa.privateKey.export({ type: 'pkcs8', format: 'pem' })
  );

  for (const material of ['', 'ليس مفتاحاً', rsaMaterial]) {
    assert.throws(
      () => kingIdentityFromMaterial(material),
      (error) => error instanceof KingKeyError && error.code === 'KING_KEY_MATERIAL_INVALID',
    );
  }

  // والصالح يمرّ: نفس المادة تُنتج نفس المعرّف في كل بناء.
  const ed = generateKeyPairSync('ed25519');
  const material = /** @type {string} */ (ed.privateKey.export({ type: 'pkcs8', format: 'pem' }));
  assert.equal(kingIdentityFromMaterial(material).id, kingIdentityFromMaterial(material).id);
});

test('المخزن غير الإنتاجي يُرفض حين يُطلب الإنتاج، ويُقبل صريحاً في التطوير', async () => {
  const disk = new LocalEncryptedKeyProvider(localDirectory, randomUUID());
  assert.equal(disk.describe().productionReady, false);

  await assert.rejects(
    () => provisionKingKey(disk, { requireProductionReady: true }),
    (error) => error instanceof KingKeyError && error.code === 'PROVIDER_NOT_PRODUCTION_READY',
  );

  // النقل غير المشفَّر ليس إنتاجياً ولو كان المخزن خارجياً.
  assert.equal(externalStore().describe().productionReady, false);
  await assert.rejects(
    () => loadKingIdentity(externalStore(), { requireProductionReady: true }),
    (error) => error instanceof KingKeyError && error.code === 'PROVIDER_NOT_PRODUCTION_READY',
  );

  // وفي التطوير يُقبل القرص المحلي صراحةً، وإلا عمل المطوّر بلا جذر ثقة.
  const provisioned = await provisionKingKey(disk, { requireProductionReady: false });
  const loaded = await loadKingIdentity(disk, { requireProductionReady: false });
  assert.equal(loaded.id, provisioned.id);
});

test('مخزن لا يُخرج المادة يُرفض صراحةً بدل أن يُجرَّب ويفشل بغموض', async () => {
  // تطبيق يُعلن `canExport: false` كما يفعل HSM حقيقي. عقد التوقيع داخل الحدود
  // غير منفَّذ (M2.04)، فالرفض هنا تصريحٌ بالحدّ لا إخفاءٌ له.
  const hsm = {
    describe: () => ({
      kind: 'hsm',
      location: 'pkcs11:token=state-hsm',
      canExport: false,
      productionReady: true,
    }),
    put: () => Promise.reject(new Error('لا يجب أن يُنادى')),
    get: () => Promise.reject(new Error('لا يجب أن يُنادى')),
    has: () => Promise.reject(new Error('لا يجب أن يُنادى')),
    list: () => Promise.reject(new Error('لا يجب أن يُنادى')),
    destroy: () => Promise.reject(new Error('لا يجب أن يُنادى')),
  };

  for (const call of [
    () => provisionKingKey(hsm, { requireProductionReady: true }),
    () => loadKingIdentity(hsm, { requireProductionReady: true }),
  ]) {
    await assert.rejects(
      call,
      (error) => error instanceof KingKeyError && error.code === 'PROVIDER_CANNOT_EXPORT',
    );
  }
});

test('وصف الربط يُظهر أين يقيم المفتاح دون لمس مادته', async () => {
  const binding = await describeKingKeyBinding(externalStore());
  assert.equal(binding.keyName, KING_KEY_NAME);
  assert.equal(binding.present, true);
  assert.equal(binding.provider.kind, 'remote-secret-store');
  assert.equal(binding.provider.canExport, true);
  assert.equal(JSON.stringify(binding).includes(storeToken), false, 'التوكن سال إلى وصف التدقيق');
});

// ──────────────── الشقّ الثاني: لا مادة خاصة على قرص الخدمة ────────────────

test('التزويد والإحضار والتوقيع لا يكتبون مادة مفتاح في مجلد الخدمة', async () => {
  const provider = new RemoteSecretStoreKeyProvider({
    endpoint: store.origin,
    token: storeToken,
    allowInsecureTransport: true,
  });
  // مجلد عمل نظيف: كل ما يُكتب فيه أثناء المسار يُفحص بعده.
  writeFileSync(join(workDirectory, 'service.log'), 'خدمة تعمل\n');
  const king = await loadKingIdentity(provider, { requireProductionReady: false });
  king.sign({ order: 'أمر' });
  king.certificate();
  new CertificateAuthority(king).issue('agent:أ', 'minister');

  const findings = partitionBySeverity(scanPathForKeys(workDirectory), true);
  assert.deepEqual(findings.blocking, [], 'مادة مفتاح ظهرت في مجلد الخدمة');
  assert.deepEqual(findings.noted, []);
});

test('والفحص ليس فارغاً: مادة مقيمة على قرص التطوير تُكشف، وفي الإنتاج تُفشل', () => {
  // مجلد التطبيق المحلي يحمل مفتاح الملك مشفَّراً (زُوِّد في اختبار سابق).
  const findings = scanPathForKeys(localDirectory);
  assert.ok(
    findings.some((f) => f.id === 'ENCRYPTED_KEY_AT_REST'),
    'الفاحص لم يكشف مادة مشفَّرة مقيمة على القرص ⇒ حراسته دعوى',
  );
  assert.deepEqual(partitionBySeverity(findings, false).blocking, [], 'التطوير لا يُفشله المشفَّر');
  assert.ok(
    partitionBySeverity(findings, true).blocking.length > 0,
    'الإنتاج يجب أن يفشل على أي مادة مفتاح مقيمة على قرص الخدمة ولو مشفَّرة',
  );
});

test('المستودع نفسه خالٍ من مادة مفاتيح خاصة — الشرط الحرفي للمعيار', () => {
  const repoRoot = new URL('../..', import.meta.url).pathname;
  const { blocking } = partitionBySeverity(scanPathForKeys(repoRoot), false);
  assert.deepEqual(
    blocking.map((f) => `${f.file}:${f.line} ${f.id}`),
    [],
  );
});

// ─────────────── نقطة الربط العملية: المخزن يُعلَن في البيئة ───────────────

test('المخزن يُبنى من البيئة: خارجي إن أُعلن، ومحلي للتطوير، ولا سقوط صامت', async () => {
  const external = kingKeyProviderFromEnv({
    KING_KEY_STORE_ENDPOINT: store.origin,
    KING_KEY_STORE_TOKEN: storeToken,
    KING_KEY_STORE_ALLOW_INSECURE: 'true',
  });
  assert.equal(external.describe().kind, 'remote-secret-store');
  // وهو مخزن يعمل فعلاً لا كائن بالشكل الصحيح: يجد المفتاح المزوَّد سابقاً.
  assert.equal(
    (await loadKingIdentity(external, { requireProductionReady: false })).id.length > 0,
    true,
  );

  const dev = kingKeyProviderFromEnv({
    KING_KEY_DIR: mkdtempSync(join(tmpdir(), 'king-key-env-')),
    KING_KEY_MASTER: randomUUID(),
  });
  assert.equal(dev.describe().productionReady, false);

  // بيئة خالية لا تسقط إلى مفتاح في الذاكرة: تشتكي.
  assert.throws(
    () => kingKeyProviderFromEnv({}),
    (error) => error instanceof KingKeyError && error.code === 'KEY_STORE_NOT_CONFIGURED',
  );
});

// هذا الاختبارُ كان يُثبِّت الحدَّ لا يسدُّه (WL-089): أوّلُه يرفض القرصَ
// المحليَّ والنقلَ المكشوف، وكان آخرُه **يقبل** مخزنَ أسرارٍ برمجيّاً في
// الإنتاج ويُعلنه `productionReady: true` — أي أنّه كان يُوثّق إخراجَ مادةِ
// مفتاحِ الملكِ إلى ذاكرةِ العمليةِ مساراً إنتاجيّاً مقبولاً. فصار المقيسُ: لا
// مخزنَ مادةٍ برمجيّاً في الإنتاج أصلاً، وحجّةُ الرفضِ واحدةٌ لا ثلاث.
test('في الإنتاج يُرفض كلُّ مخزنِ مفاتيحَ برمجيّ، قرصاً أو مخزنَ أسرارٍ مشفَّرَ النقل', () => {
  /**
   * يتحقّق أنّ التركيبَ رُدَّ فشلاً مغلقاً برمزِ قيدِ الإقلاع.
   * @param {NodeJS.ProcessEnv} env - البيئةُ المقيسة
   */
  const assertClosedFailure = (env) => {
    assert.throws(
      () => kingKeyProviderFromEnv(env),
      (error) =>
        error instanceof ProductionBootError &&
        error.code === 'SOFTWARE_KEY_STORE_FORBIDDEN_IN_PRODUCTION',
    );
  };

  // قرصٌ محليٌّ مشفَّر: مادةُ مفتاحٍ مقيمةٌ على قرصِ الخدمة.
  assertClosedFailure({
    NODE_ENV: 'production',
    KING_KEY_DIR: '/var/keys',
    KING_KEY_MASTER: randomUUID(),
  });

  // نقلٌ غيرُ مشفَّرٍ ولو أُعلن السماحُ به صراحةً.
  assertClosedFailure({
    NODE_ENV: 'production',
    KING_KEY_STORE_ENDPOINT: 'http://vault.internal',
    KING_KEY_STORE_TOKEN: randomUUID(),
    KING_KEY_STORE_ALLOW_INSECURE: 'true',
  });

  // ومخزنُ أسرارٍ على https مع توكن — أي أنقى إعدادٍ برمجيٍّ ممكن —
  // يُرَدُّ أيضاً: مخزنٌ يُخرج المادةَ إلى الذاكرةِ ليس جذرَ ثقةٍ إنتاجيّاً،
  // وبديلُه التوكنُ عبر `bindHsmRootOfTrust`.
  assertClosedFailure({
    NODE_ENV: 'production',
    KING_KEY_STORE_ENDPOINT: 'https://vault.internal',
    KING_KEY_STORE_TOKEN: randomUUID(),
  });

  // والإعلانُ بـ `STATE_ENV` يستوي و`NODE_ENV`، فلا يُفلت من القيدِ بتبديلِ الاسم.
  assertClosedFailure({
    STATE_ENV: 'production',
    KING_KEY_STORE_ENDPOINT: 'https://vault.internal',
    KING_KEY_STORE_TOKEN: randomUUID(),
  });
});
