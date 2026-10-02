// @ts-nocheck
// tests/root-of-trust/production-runtime-softhsm.test.mjs
//
// المسارُ الإنتاجيُّ على **توكنٍ حقيقيٍّ** (SoftHSM) — WL-092.
//
// تصريحٌ صريحٌ لا يُلبَّس: هذا الملفُّ **يُتجاوَزُ في CI** ولا يُدّعى أنه شغِّل
// هناك. CI بلا `softhsm2-util` وبلا `pkcs11js`، فيُتجاوَزُ الملفُّ كلُّه ويظهرُ
// في العدِّ متجاوَزاً لا ناجحاً. وما يُشغَّلُ في CI هو
// `production-runtime.test.mjs` بمصدرِ مفاتيحَ محقونٍ يُمرَّرُ عبرَ الأصنافِ
// الإنتاجيةِ نفسِها — منطقٌ إنتاجيٌّ حقيقيٌّ بتوكنٍ غيرِ حقيقيّ.
//
// تشغيلُه محلياً: `XUUX_HSM_TEST=1 node --test tests/root-of-trust/production-runtime-softhsm.test.mjs`
// وبنفسِ تهيئةِ `pkcs11-provider.test.mjs`: توكنٌ مؤقّتٌ في /tmp ثم
// `scripts/pkcs11-keygen.mjs` يولّدُ 05/06/07 داخلَه.
//
// ما يُقاسُ هنا وما لا يُغني عنه المزيَّف: أن `createProductionRootOfTrust`
// يُقلعُ من متغيّراتِ البيئةِ وحدَها عبرَ `Pkcs11HsmProvider.fromEnv` — أي بلا
// حقنٍ — وأن الختمَ والتوقيعَ يقعان داخلَ التوكنِ فعلاً.

import test, { after, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { registerTmpRoot } from '../helpers/tmp-roots.mjs';
import { royalKeyEnv } from '../helpers/royal-halt-command.mjs';

/** `LIVE-24`: مفتاحٌ ملكيٌّ مستقلٌّ عن مفتاحِ المرساةِ في التوكن. */
const ROYAL_KEY = royalKeyEnv();

const ENABLED = process.env.XUUX_HSM_TEST === '1';
const MODULE = process.env.XUUX_HSM_TEST_MODULE ?? '/usr/lib/softhsm/libsofthsm2.so';
const TOKEN_LABEL = 'xuux-test';
const PIN = '5678'; // secret-scan:allow
const SO_PIN = '1234'; // secret-scan:allow

let tokenDir = '';
let ready = false;
let setupError = null;
let identity = null;

const PROVIDER_URL = new URL('../../src/root-of-trust/pkcs11-provider.mjs', import.meta.url).href;
const BINDING_URL = new URL('../../src/root-of-trust/hsm-binding.mjs', import.meta.url).href;

/**
 * هل أداةُ SoftHSM حاضرةٌ في المسار؟
 * @returns حضورُها
 */
function utilAvailable() {
  try {
    execFileSync('softhsm2-util', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * يستخرجُ من التوكنِ رقمَه التسلسليَّ وهويةَ ملكِه **في عمليّةٍ ابنةٍ**.
 *
 * لماذا عمليّةٌ ابنةٌ: مكتبةُ PKCS#11 تُهيَّأُ مرّةً واحدةً لكلِّ عمليّةٍ، فمن
 * فتحَ موفّراً هنا ثم أقلعَ المصنعَ بعدَه لقيَ `ALREADY_INITIALIZED` بحقٍّ
 * (‏`UF-12`). والاستخراجُ **من التوكنِ نفسِه** لا من قيمةٍ مكتوبةٍ في الاختبار:
 * تثبيتٌ يُقابِلُ قيمةً يخترعُها الاختبارُ لا يُثبِتُ شيئاً.
 * @returns الرقمُ التسلسليُّ وهويةُ الملك
 */
function probeTokenIdentity() {
  const script = join(tokenDir, 'probe-identity.mjs');
  writeFileSync(
    script,
    [
      "import { Pkcs11HsmProvider } from '" + PROVIDER_URL + "';",
      "import { bindHsmRootOfTrust } from '" + BINDING_URL + "';",
      'const provider = await Pkcs11HsmProvider.create({',
      '  modulePath: process.env.XUUX_PKCS11_MODULE,',
      '  tokenLabel: process.env.XUUX_PKCS11_TOKEN,',
      '  pin: process.env.XUUX_PKCS11_PIN,',
      '});',
      '// بيئةٌ غيرُ إنتاجيّةٍ عن قصد: الاستخراجُ يسبقُ التثبيتَ فلا يُقابَلُ به.',
      'const binding = await bindHsmRootOfTrust(provider, { env: {} });',
      'process.stdout.write(',
      '  JSON.stringify({ serial: provider.describe().tokenSerial, kingId: binding.kingSigner.id }),',
      ');',
      'await provider.close();',
    ].join('\n'),
  );
  const out = execFileSync('node', [script], {
    env: {
      ...process.env,
      XUUX_PKCS11_MODULE: MODULE,
      XUUX_PKCS11_TOKEN: TOKEN_LABEL,
      XUUX_PKCS11_PIN: PIN,
    },
    encoding: 'utf8',
  });
  return JSON.parse(out);
}

before(() => {
  if (!ENABLED) return;
  try {
    tokenDir = registerTmpRoot(mkdtempSync(join(tmpdir(), 'xuux-prod-hsm-')));
    const confPath = join(tokenDir, 'softhsm2.conf');
    writeFileSync(confPath, `directories.tokendir = ${tokenDir}\nobjectstore.backend = file\n`);
    process.env.SOFTHSM2_CONF = confPath;
    execFileSync(
      'softhsm2-util',
      ['--init-token', '--free', '--label', TOKEN_LABEL, '--so-pin', SO_PIN, '--pin', PIN],
      { stdio: 'ignore' },
    );
    execFileSync('node', ['scripts/pkcs11-keygen.mjs'], {
      env: {
        ...process.env,
        XUUX_PKCS11_MODULE: MODULE,
        XUUX_PKCS11_PIN: PIN,
        XUUX_PKCS11_TOKEN: TOKEN_LABEL,
        XUUX_PKCS11_TOKEN_SERIAL: '',
      },
      stdio: 'ignore',
    });
    identity = probeTokenIdentity();
    ready = true;
  } catch (error) {
    // `UF-14`: يُحفَظُ الخطأُ ويُرفَعُ في اختبارٍ يفشل، ولا يُطبَعُ ويُنسى.
    setupError = error;
  }
});

after(() => {
  if (tokenDir) rmSync(tokenDir, { recursive: true, force: true });
});

// `UF-14`: `XUUX_HSM_TEST=1` **عقدٌ لا رغبة**. كان التخطّي يقعُ حتى مع إعلانِ
// المتغيّرِ إذا غابَ SoftHSM، فيخرجُ الأمرُ صفراً ويُقرأُ «التوكنُ الحقيقيُّ
// مُختبَرٌ» على بيئةٍ لم تلمسْ توكناً. الآن: بلا إعلانٍ ⇒ تخطٍّ مُعلَنٌ كما كان،
// ومع إعلانٍ ⇒ غيابُ الأداةِ أو الموديولِ أو فشلُ التهيئةِ **فشلٌ** باسمِه.
// `LIVE-17/SKIP-NO-REASON`: الشرطُ نفسُه (`UF-14`) لم يُمَسَّ، والتخطّي يَحملُ سببَه في TAP.
const skip = !ENABLED;
const skipReason = skip
  ? 'XUUX_HSM_TEST=1 غيرُ مُعلَنٍ — المسارُ الإنتاجيُّ على توكنٍ حقيقيٍّ محلّيٌّ لا CI'
  : false;
const it = skipReason ? (name, fn) => test(name, { skip: skipReason }, fn) : test;

describe('المسارُ الإنتاجيُّ على توكنٍ حقيقيّ (SoftHSM، محليٌّ لا CI)', () => {
  it('إعلانُ XUUX_HSM_TEST=1 عقدٌ: غيابُ الأداةِ أو الموديولِ فشلٌ لا تخطٍّ (UF-14)', () => {
    assert.equal(utilAvailable(), true, 'XUUX_HSM_TEST=1 مُعلَنٌ و`softhsm2-util` غائبٌ عن المسار');
    assert.equal(existsSync(MODULE), true, `XUUX_HSM_TEST=1 مُعلَنٌ والموديولُ غائبٌ: ${MODULE}`);
    assert.equal(setupError, null, `تهيئةُ التوكنِ فشلت: ${setupError?.message ?? setupError}`);
    assert.equal(ready, true, 'التهيئةُ لم تكتمل');
    assert.equal(typeof identity?.serial, 'string');
    assert.notEqual(identity?.serial, '', 'الرقمُ التسلسليُّ مُستخرَجٌ من التوكنِ لا مخترَع');
    assert.match(identity?.kingId ?? '', /^king:[0-9a-f]{24}$/);
  });

  it('يُقلعُ من البيئةِ وحدَها، فيَختمُ السجلَّ ويوقّعُ الدفترَ والتثبيتَ داخلَ التوكن', async () => {
    const {
      createProductionRootOfTrust,
      FileAnchorStore,
      anchorLogWithHsm,
      verifyAnchorChain,
      InMemoryFreshnessSocket,
    } = await import('../../src/root-of-trust/index.mjs');
    const root = registerTmpRoot(mkdtempSync(join(tmpdir(), 'xuux-prod-state-')));
    const env = {
      ...process.env,
      NODE_ENV: 'production',
      STATE_ENV: 'production',
      XUUX_ROOT_OF_TRUST_MODE: 'hsm',
      XUUX_PKCS11_MODULE: MODULE,
      XUUX_PKCS11_TOKEN: TOKEN_LABEL,
      // `UF-05`: الرقمُ والبصمةُ والهويةُ **مُستخرَجَةٌ من التوكنِ والملفِّ**، لا
      // فراغٌ يُمرَّرُ ليمرَّ الاختبار.
      XUUX_PKCS11_TOKEN_SERIAL: identity.serial,
      XUUX_PKCS11_MODULE_SHA256: createHash('sha256').update(readFileSync(MODULE)).digest('hex'),
      XUUX_KING_ID: identity.kingId,
      ...ROYAL_KEY.env,
      XUUX_PKCS11_PIN: PIN,
      XUUX_ROOT_OF_TRUST_PROVISION: '1',
    };
    // لا حقنَ هنا: المصدرُ الافتراضيُّ هو `Pkcs11HsmProvider.fromEnv`.
    const runtime = await createProductionRootOfTrust(env, {
      root,
      freshnessSocket: new InMemoryFreshnessSocket(0n, 'softhsm'),
    });
    try {
      const secret = 'softhsm-plaintext-canary'; // secret-scan:allow — قيمةُ شاهدٍ للاختبارِ لا سرٌّ
      await runtime.log.appendSealed('royal.command', runtime.anchorSigner.id, { plan: secret });
      const raw = readFileSync(runtime.log.file, 'utf8');
      assert.equal(raw.includes(secret), false, 'السجلُّ على القرصِ ليس نصّاً ظاهراً');
      assert.deepEqual(await runtime.log.openEvent(runtime.log.events[0]), { plan: secret });

      const entry = await runtime.ledger.recordSigned({ id: 'softhsm-cmd-1' });
      assert.equal(entry.keyId, '07');
      assert.equal(runtime.ledger.auditSignatures().ok, true);

      const store = new FileAnchorStore(join(root, 'anchors.jsonl'));
      const record = await anchorLogWithHsm(store, runtime.anchorSigner, runtime.log);
      assert.equal(record.count, 1);
      assert.equal(verifyAnchorChain(store.read(), runtime.anchorSigner).ok, true);

      const directive = await runtime.haltSwitch.haltAsync('اختبارُ توكنٍ حقيقيّ');
      assert.equal(directive.state, 'halted');
      assert.equal(runtime.haltSwitch.read().state, 'halted');
    } finally {
      runtime.log.close?.();
      await runtime.close();
      rmSync(root, { recursive: true, force: true });
    }
  });
});
