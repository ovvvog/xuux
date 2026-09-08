// tests/root-of-trust/production-boot.test.mjs
// اختباراتٌ خصميّةٌ لقيدِ التركيبِ الإنتاجيّ (WL-089، ADR 0004).
//
// ما تُثبته هذه الملفّة: **لا مسارَ برمجيّاً مفتوحاً إلى جذرِ الثقةِ في
// الإنتاج**. وكلُّ اختبارٍ منها يقيس رفضاً برمزٍ مُسمّىً، لا مجرّدَ رميِ خطأٍ:
// خطأٌ بلا رمزٍ لا يُميّز فشلاً مغلقاً من فشلٍ عارض.
//
// والبيئةُ تُحقَن وسيطاً حيث أمكن (`env`)، ولا تُمسّ `process.env` إلا حيث لا
// بديل — مُنشئُ `KingIdentity` يقرأ بيئةَ العمليةِ لأنه يُنادى من مواضعَ لا
// تُمرِّر إليه شيئاً (`scripts/stress.mjs`, `scripts/lib/emergency-facts.mjs`)،
// وهناك تُستعاد البيئةُ في `finally` كي لا يتسرّب الوضعُ إلى اختبارٍ تالٍ.

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  HSM_PIN_ENV_VARS,
  HSM_REQUIRED_ENV_VARS,
  KingIdentity,
  ProductionBootError,
  ROOT_OF_TRUST_MODE_ENV,
  SOFTWARE_KEY_STORE_ENV_VARS,
  assertHsmRequiredInProduction,
  assertKingKeyProviderFit,
  assertProductionKeyProviderAllowed,
  assertSoftwareKingIdentityAllowed,
  describeRootOfTrustBoot,
  isProductionRuntime,
  kingKeyProviderFromEnv,
  presentSoftwareKeyStoreVars,
} from '../../src/root-of-trust/index.mjs';

/**
 * إعدادُ HSM كاملٌ وصحيحٌ: خطُّ الأساسِ الذي يجب أن **يعبُر**.
 * @type {Readonly<NodeJS.ProcessEnv>}
 */
const HSM_ENV = Object.freeze({
  NODE_ENV: 'production',
  XUUX_PKCS11_MODULE: '/usr/lib/softhsm/libsofthsm2.so',
  XUUX_PKCS11_TOKEN: 'xuux-security',
  XUUX_PKCS11_PIN_FILE: '/home/king/.config/xuux/pkcs11-pin',
});

/**
 * يجمع رمزَ الرفضِ من نداءٍ مُتوقَّعِ الفشل.
 * @param {() => unknown} fn - النداءُ المقيس
 * @returns {string} رمزُ `ProductionBootError` الراجع
 */
function rejectionCode(fn) {
  try {
    fn();
  } catch (/** @type {any} */ error) {
    assert.ok(
      error instanceof ProductionBootError,
      `المتوقَّع ProductionBootError لا ${error?.name}: ${error?.message}`,
    );
    return error.code;
  }
  assert.fail('كان يجب أن يُرفض التركيب، لكنه قُبل');
}

/**
 * يشغّل نداءً وبيئةُ العمليةِ مُعدَّلةٌ مؤقتاً، ثم يستعيدها حرفياً.
 * @param {Record<string, string | undefined>} patch - المفاتيحُ المضافةُ أو المحذوفة (`undefined` = حذف)
 * @param {() => void} fn - النداءُ المقيس
 * @returns {void} ما يرجعه النداء
 */
function withProcessEnv(patch, fn) {
  const saved = new Map(Object.keys(patch).map((key) => [key, process.env[key]]));
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return fn();
  } finally {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

/**
 * موفّرُ مفاتيحَ زائفٌ يُعلن وصفاً معيّناً. لا يوقّع ولا يخزّن: المقيسُ هو
 * الحكمُ على **الوصف** قبل أيِّ استعمال، فالتركيبُ يُرَدُّ قبل أن يُفتح مخزن.
 * @param {{ kind: string, canExport: boolean, productionReady: boolean }} description - الوصفُ المُعلَن
 * @returns {any} موفّراً يكفي لعقدِ `assertKingKeyProviderFit`
 */
function providerWith(description) {
  return {
    describe: () => description,
    async list() {
      return [];
    },
    async destroy() {
      return false;
    },
    async get() {
      throw new Error('لا يجوز أن يُقرأ هذا الموفّر في هذه الاختبارات');
    },
    async put() {
      throw new Error('لا يجوز أن يُكتب هذا الموفّر في هذه الاختبارات');
    },
    async has() {
      return false;
    },
  };
}

test('تعريفُ الإنتاج واحدٌ: STATE_ENV يسبق NODE_ENV', () => {
  assert.equal(isProductionRuntime({ NODE_ENV: 'production' }), true);
  assert.equal(isProductionRuntime({ STATE_ENV: 'production' }), true);
  // إعلانٌ صريحٌ بغيرِ الإنتاجِ يسبق NODE_ENV، فلا يُقرأ إنتاجاً بالوراثة.
  assert.equal(isProductionRuntime({ STATE_ENV: 'development', NODE_ENV: 'production' }), false);
  assert.equal(isProductionRuntime({}), false);
  // قيمةٌ فارغةٌ ليست إعلاناً، فتُقرأ من التالي في الترتيب.
  assert.equal(isProductionRuntime({ STATE_ENV: '', NODE_ENV: 'production' }), true);
});

test('في الإنتاج: غيابُ HSM فشلٌ مغلقٌ لا سقوطٌ إلى مفتاحٍ برمجي', () => {
  assert.equal(
    rejectionCode(() => assertHsmRequiredInProduction({ NODE_ENV: 'production' })),
    'HSM_REQUIRED_IN_PRODUCTION',
  );
  assert.equal(
    rejectionCode(() => assertHsmRequiredInProduction({ STATE_ENV: 'production' })),
    'HSM_REQUIRED_IN_PRODUCTION',
  );
});

test('في الإنتاج: إعدادُ HSM الناقصُ يُرفض، وكلُّ متغيّرٍ لازمٍ يُقاس وحدَه', () => {
  // نقصُ الوحدةِ أو التوكن ⇒ «HSM مطلوب»: لا يُفتح توكنٌ بإعدادٍ نصفِه غائب.
  for (const missing of HSM_REQUIRED_ENV_VARS) {
    const env = { ...HSM_ENV };
    delete env[missing];
    const code = rejectionCode(() => assertHsmRequiredInProduction(env));
    assert.equal(code, 'HSM_REQUIRED_IN_PRODUCTION', `لم يُرفض غيابُ ${missing}`);
    // ومتغيّرٌ مُعلَنٌ بقيمةٍ فارغةٍ لا يُقرأ إعداداً حاضراً.
    assert.equal(
      rejectionCode(() => assertHsmRequiredInProduction({ ...HSM_ENV, [missing]: '' })),
      'HSM_REQUIRED_IN_PRODUCTION',
    );
  }

  // غيابُ PIN بمصدرَيه ⇒ «إعدادٌ ناقص»: توكنٌ لا يُفتح ليس مساراً إنتاجياً.
  const noPin = { ...HSM_ENV };
  for (const name of HSM_PIN_ENV_VARS) delete noPin[name];
  assert.equal(
    rejectionCode(() => assertHsmRequiredInProduction(noPin)),
    'HSM_CONFIG_INCOMPLETE_IN_PRODUCTION',
  );

  // وأيٌّ من مصدرَي PIN يكفي وحدَه — لا يُشترط الاثنان.
  for (const name of HSM_PIN_ENV_VARS) {
    assert.doesNotThrow(() => assertHsmRequiredInProduction({ ...noPin, [name]: 'x' }));
  }
});

test('في الإنتاج: إعدادُ HSM الكاملُ يعبُر — القيدُ ليس منعاً مطلقاً', () => {
  assert.doesNotThrow(() => assertHsmRequiredInProduction({ ...HSM_ENV }));
  assert.doesNotThrow(() =>
    assertHsmRequiredInProduction({ ...HSM_ENV, [ROOT_OF_TRUST_MODE_ENV]: 'hsm' }),
  );
});

test('في الإنتاج: كلُّ متغيّرٍ من مخزنِ المفاتيحِ البرمجيِّ يُرفض ولو كان HSM مهيَّأً', () => {
  // مسارٌ برمجيٌّ مهيَّأٌ بجانب التوكن هو fallback بالفعل ولو لم يُستدع.
  for (const name of SOFTWARE_KEY_STORE_ENV_VARS) {
    const code = rejectionCode(() =>
      assertHsmRequiredInProduction({ ...HSM_ENV, [name]: 'value-not-logged' }),
    );
    assert.equal(code, 'SOFTWARE_KEY_STORE_FORBIDDEN_IN_PRODUCTION', `لم يُرفض ${name}`);
  }
  assert.deepEqual(presentSoftwareKeyStoreVars({ KING_KEY_DIR: '/x', KING_KEY_STORE_TOKEN: '' }), [
    'KING_KEY_DIR',
  ]);
});

test('رسائلُ الرفضِ تحمل أسماءَ المتغيّراتِ لا قيمَها', () => {
  // قيمةٌ مُعلَّمةٌ لا سرٌّ: الغرضُ أن تُبحَث في نصِّ الخطأِ فلا تُوجَد فيه.
  const secret = 'super-secret-token-value'; // secret-scan:allow
  let caught;
  try {
    assertHsmRequiredInProduction({ ...HSM_ENV, KING_KEY_STORE_TOKEN: secret });
  } catch (error) {
    caught = error;
  }
  assert.ok(caught instanceof ProductionBootError);
  const text = `${caught.message} ${caught.detail ?? ''} ${caught.stack ?? ''}`;
  assert.equal(text.includes(secret), false, 'تسرّبت قيمةُ سرٍّ إلى نصِّ الخطأ');
  assert.equal(caught.detail, 'KING_KEY_STORE_TOKEN');
});

test('في الإنتاج: وضعُ التطويرِ المُصرَّحُ به يُرَدُّ ولا يُقرأ إذناً', () => {
  assert.equal(
    rejectionCode(() =>
      assertHsmRequiredInProduction({ ...HSM_ENV, [ROOT_OF_TRUST_MODE_ENV]: 'software' }),
    ),
    'DEV_MODE_FORBIDDEN_IN_PRODUCTION',
  );
  // ولا يُنجيه أن يكون HSM غائباً أصلاً: الإعلانُ نفسُه هو المرفوض.
  assert.equal(
    rejectionCode(() =>
      assertHsmRequiredInProduction({
        NODE_ENV: 'production',
        [ROOT_OF_TRUST_MODE_ENV]: 'software',
      }),
    ),
    'DEV_MODE_FORBIDDEN_IN_PRODUCTION',
  );
});

test('وضعٌ لا يُعرَف يُرفض في كلِّ البيئاتِ لا يُتجاهَل صامتاً', () => {
  for (const bad of ['HSM', 'hsm-only', 'true', 'software ', 'none']) {
    assert.equal(
      rejectionCode(() => assertHsmRequiredInProduction({ [ROOT_OF_TRUST_MODE_ENV]: bad })),
      'ROOT_OF_TRUST_MODE_INVALID',
      `قيمةٌ فاسدةٌ لم تُرفض: ${bad}`,
    );
  }
});

test('في الإنتاج: موفّرٌ يُعلن canExport مرفوضٌ، ومخزنٌ برمجيٌّ مرفوضٌ', () => {
  const remoteLike = { kind: 'remote-secret-store', canExport: true, productionReady: true };
  assert.equal(
    rejectionCode(() => assertProductionKeyProviderAllowed(remoteLike, HSM_ENV)),
    'EXPORTABLE_PROVIDER_FORBIDDEN_IN_PRODUCTION',
  );
  const localLike = { kind: 'local-encrypted-file', canExport: true, productionReady: false };
  assert.equal(
    rejectionCode(() => assertProductionKeyProviderAllowed(localLike, HSM_ENV)),
    'EXPORTABLE_PROVIDER_FORBIDDEN_IN_PRODUCTION',
  );
  // موفّرٌ لا يُصدِّر لكنه ليس توكناً: يبقى مرفوضاً — «لا يُصدِّر» وحدَها لا تكفي.
  const opaqueSoftware = { kind: 'in-memory-opaque', canExport: false, productionReady: true };
  assert.equal(
    rejectionCode(() => assertProductionKeyProviderAllowed(opaqueSoftware, HSM_ENV)),
    'SOFTWARE_KEY_STORE_FORBIDDEN_IN_PRODUCTION',
  );
  // والتوكنُ وحدَه يعبُر.
  assert.doesNotThrow(() =>
    assertProductionKeyProviderAllowed(
      { kind: 'pkcs11-hsm', canExport: false, productionReady: true },
      HSM_ENV,
    ),
  );
  // وخارجَ الإنتاجِ لا يحكم القيدُ شيئاً: المطوّرُ يعمل بمخزنِه.
  assert.doesNotThrow(() => assertProductionKeyProviderAllowed(remoteLike, { NODE_ENV: 'test' }));
});

test('في الإنتاج: عقدُ مادةِ مفتاحِ الملكِ مغلقٌ على الوجهين', () => {
  // مخزنٌ برمجيٌّ «جاهزٌ للإنتاج» بحسب وصفِه: كان هذا هو الطريقُ المفتوح.
  assert.equal(
    rejectionCode(() =>
      assertKingKeyProviderFit(
        providerWith({ kind: 'remote-secret-store', canExport: true, productionReady: true }),
        { env: HSM_ENV },
      ),
    ),
    'EXPORTABLE_PROVIDER_FORBIDDEN_IN_PRODUCTION',
  );
  // والتوكنُ لا يخدم عقدَ المادة أصلاً، فيُرفض هو أيضاً برمزِ العقدِ القائم:
  // أي أنّ مسارَ المادةِ **لا مخرجَ له في الإنتاج**، وبديلُه `hsm-binding`.
  assert.throws(
    () =>
      assertKingKeyProviderFit(
        providerWith({ kind: 'pkcs11-hsm', canExport: false, productionReady: true }),
        { env: HSM_ENV },
      ),
    /PROVIDER_CANNOT_EXPORT/,
  );
  // وخارجَ الإنتاجِ يبقى العقدُ القائمُ كما كان بلا تضييق.
  assert.doesNotThrow(() =>
    assertKingKeyProviderFit(
      providerWith({ kind: 'local-encrypted-file', canExport: true, productionReady: false }),
      { env: { NODE_ENV: 'development' } },
    ),
  );
});

test('في الإنتاج: kingKeyProviderFromEnv لا تبني مخزناً برمجيّاً بحالٍ', () => {
  const attempts = [
    { NODE_ENV: 'production' },
    {
      NODE_ENV: 'production',
      KING_KEY_STORE_ENDPOINT: 'https://vault.internal',
      KING_KEY_STORE_TOKEN: 'token',
    },
    { NODE_ENV: 'production', KING_KEY_DIR: '/var/lib/xuux/keys', KING_KEY_MASTER: 'master' },
    { STATE_ENV: 'production', KING_KEY_STORE_ENDPOINT: 'http://127.0.0.1:8200' },
    { ...HSM_ENV, KING_KEY_STORE_ENDPOINT: 'https://vault.internal' },
  ];
  for (const env of attempts) {
    assert.equal(
      rejectionCode(() => kingKeyProviderFromEnv(env)),
      'SOFTWARE_KEY_STORE_FORBIDDEN_IN_PRODUCTION',
      `بُني مخزنٌ برمجيٌّ في الإنتاج من: ${Object.keys(env).join(',')}`,
    );
  }
  // وخارجَ الإنتاجِ تبقى الدالّةُ تعمل: التطويرُ لم يُمنع.
  const dev = kingKeyProviderFromEnv({
    NODE_ENV: 'development',
    KING_KEY_DIR: '/tmp/xuux-keys',
    // مفتاحٌ رئيسٌ بطولٍ مقبولٍ لأنّ المقيسَ أنّ المسارَ التطويريَّ بَنَى
    // مخزناً فعلاً، لا أنّه رُدَّ لسببٍ آخر.
    KING_KEY_MASTER: 'dev-master-key-with-enough-entropy-32',
  });
  assert.equal(dev.describe().kind, 'local-encrypted-file');
});

test('في الإنتاج: تركيبُ KingIdentity البرمجيةِ مرفوضٌ من المُنشئ نفسِه', () => {
  for (const patch of [
    { NODE_ENV: 'production', STATE_ENV: undefined },
    { STATE_ENV: 'production', NODE_ENV: undefined },
  ]) {
    withProcessEnv(patch, () => {
      assert.equal(
        rejectionCode(() => new KingIdentity()),
        'SOFTWARE_KING_IDENTITY_FORBIDDEN_IN_PRODUCTION',
      );
      // ومادةٌ مُحضَرةٌ من مخزنٍ ليست بابَ خلفٍ: المنعُ في المُنشئِ لا في التوليد.
      assert.equal(
        rejectionCode(
          () => new KingIdentity(/** @type {any} */ ({ publicKey: {}, privateKey: {} })),
        ),
        'SOFTWARE_KING_IDENTITY_FORBIDDEN_IN_PRODUCTION',
      );
    });
  }
});

test('KingIdentity البرمجيةُ تبقى قائمةً خارجَ الإنتاج — لا تُحذف', () => {
  withProcessEnv(
    { NODE_ENV: 'test', STATE_ENV: undefined, [ROOT_OF_TRUST_MODE_ENV]: undefined },
    () => {
      const king = new KingIdentity();
      assert.match(king.id, /^king:/);
      const signature = king.sign({ action: 'ping' });
      assert.equal(typeof signature, 'string');
      assert.equal(king.verify({ action: 'ping' }, signature), true);
      assert.doesNotThrow(() => assertSoftwareKingIdentityAllowed());
    },
  );
});

test('إعلانُ وضعِ HSM يمنع الهويةَ البرمجيةَ حتى خارجَ الإنتاج', () => {
  // من أعلن أنه يعمل على التوكن ثم رُكّبت له هويةٌ برمجيةٌ فقد وقع في
  // fallback صامتٍ — ويُقاس في التطويرِ قبل أن يُكتشَف في الإنتاج.
  assert.equal(
    rejectionCode(() =>
      assertSoftwareKingIdentityAllowed({
        NODE_ENV: 'development',
        [ROOT_OF_TRUST_MODE_ENV]: 'hsm',
      }),
    ),
    'SOFTWARE_KING_IDENTITY_FORBIDDEN_IN_PRODUCTION',
  );
  assert.doesNotThrow(() =>
    assertSoftwareKingIdentityAllowed({
      NODE_ENV: 'development',
      [ROOT_OF_TRUST_MODE_ENV]: 'software',
    }),
  );
});

test('وصفُ قرارِ الإقلاعِ يُقرأ للتدقيقِ ولا يحمل سرّاً', () => {
  const production = describeRootOfTrustBoot(HSM_ENV);
  assert.deepEqual(production, {
    production: true,
    declaredMode: null,
    effectiveMode: 'hsm',
    hsmRequired: true,
    hsmConfigured: true,
    softwareKeyStoreVarsPresent: [],
  });

  const broken = describeRootOfTrustBoot({ NODE_ENV: 'production', KING_KEY_DIR: '/var/keys' });
  assert.equal(broken.hsmRequired, true);
  assert.equal(broken.hsmConfigured, false);
  assert.deepEqual(broken.softwareKeyStoreVarsPresent, ['KING_KEY_DIR']);
  assert.equal(JSON.stringify(broken).includes('/var/keys'), false);

  // والوصفُ لا يُسقِط مُستدعيه على قيمةِ وضعٍ فاسدة، بخلافِ الحكم.
  assert.doesNotThrow(() => describeRootOfTrustBoot({ [ROOT_OF_TRUST_MODE_ENV]: 'nonsense' }));

  const dev = describeRootOfTrustBoot({ NODE_ENV: 'development' });
  assert.equal(dev.hsmRequired, false);
  assert.equal(dev.effectiveMode, 'software');
});
