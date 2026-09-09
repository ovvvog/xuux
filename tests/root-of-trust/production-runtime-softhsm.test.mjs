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
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ENABLED = process.env.XUUX_HSM_TEST === '1';
const MODULE = process.env.XUUX_HSM_TEST_MODULE ?? '/usr/lib/softhsm/libsofthsm2.so';
const TOKEN_LABEL = 'xuux-test';
const PIN = '5678'; // secret-scan:allow
const SO_PIN = '1234'; // secret-scan:allow

let tokenDir = '';
let ready = false;

/**
 * هل SoftHSM حاضرٌ فعلاً؟ حضورُ المتغيّرِ وحدَه لا يكفي.
 * @returns حضورُه
 */
function softhsmAvailable() {
  try {
    execFileSync('softhsm2-util', ['--version'], { stdio: 'ignore' });
    return existsSync(MODULE);
  } catch {
    return false;
  }
}

before(() => {
  if (!ENABLED || !softhsmAvailable()) return;
  try {
    tokenDir = mkdtempSync(join(tmpdir(), 'xuux-prod-hsm-'));
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
    ready = true;
  } catch (error) {
    console.error('[prod-hsm-test] تعذّرت التهيئة:', error?.message ?? error);
  }
});

after(() => {
  if (tokenDir) rmSync(tokenDir, { recursive: true, force: true });
});

const skip = !ENABLED || !softhsmAvailable();
const it = skip ? test.skip : test;

describe('المسارُ الإنتاجيُّ على توكنٍ حقيقيّ (SoftHSM، محليٌّ لا CI)', () => {
  it('يُقلعُ من البيئةِ وحدَها، فيَختمُ السجلَّ ويوقّعُ الدفترَ والتثبيتَ داخلَ التوكن', async () => {
    assert.equal(ready, true, 'التهيئةُ لم تكتمل');
    const { createProductionRootOfTrust, FileAnchorStore, anchorLogWithHsm, verifyAnchorChain } =
      await import('../../src/root-of-trust/index.mjs');
    const root = mkdtempSync(join(tmpdir(), 'xuux-prod-state-'));
    const env = {
      ...process.env,
      NODE_ENV: 'production',
      XUUX_ROOT_OF_TRUST_MODE: 'hsm',
      XUUX_PKCS11_MODULE: MODULE,
      XUUX_PKCS11_TOKEN: TOKEN_LABEL,
      XUUX_PKCS11_TOKEN_SERIAL: '',
      XUUX_PKCS11_PIN: PIN,
    };
    // لا حقنَ هنا: المصدرُ الافتراضيُّ هو `Pkcs11HsmProvider.fromEnv`.
    const runtime = await createProductionRootOfTrust(env, { root });
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
