// @ts-nocheck
// tests/root-of-trust/pkcs11-provider.test.mjs
// اختبارات موفّر HSM (PKCS#11) — تُتجاوز تلقائياً في بيئة بلا SoftHSM/pkcs11js
// (مثل CI) عبر فحص المتغيّر XUUX_HSM_TEST. عند تفعيله تُهيَّأ توكن SoftHSM
// مؤقت في /tmp وتُجرى الاختبارات الحقيقية ضد الموفّر.
//
// ملاحظة: C_Initialize عالميٌّ في العملية، لذا يُشارَك موفّرٌ واحدٌ عبر كل الاختبارات.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Buffer } from 'node:buffer';
import { registerTmpRoot } from '../helpers/tmp-roots.mjs';

const ENABLED = process.env.XUUX_HSM_TEST === '1';
const MODULE = process.env.XUUX_HSM_TEST_MODULE ?? '/usr/lib/softhsm/libsofthsm2.so';
const TOKEN_LABEL = 'xuux-test';
const PIN = '5678';
const SO_PIN = '1234';

let confPath = '';
let tokenDir = '';
let provider = null;

function softhsmAvailable() {
  try {
    execFileSync('softhsm2-util', ['--version'], { stdio: 'ignore' });
    return existsSync(MODULE);
  } catch {
    return false;
  }
}

before(async () => {
  if (!ENABLED || !softhsmAvailable()) return;
  try {
    tokenDir = registerTmpRoot(mkdtempSync(join(tmpdir(), 'xuux-hsm-')));
    confPath = join(tokenDir, 'softhsm2.conf');
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
    const { Pkcs11HsmProvider } = await import('../../src/root-of-trust/pkcs11-provider.mjs');
    provider = await Pkcs11HsmProvider.create({
      modulePath: MODULE,
      tokenLabel: TOKEN_LABEL,
      pin: PIN,
    });
  } catch (e) {
    console.error('[hsm-test] setup failed:', e?.message || e);
  }
});

after(async () => {
  if (provider) {
    try {
      await provider.close();
    } catch {
      /* تجاوز */
    }
  }
  if (tokenDir) rmSync(tokenDir, { recursive: true, force: true });
});

// `LIVE-17/SKIP-NO-REASON`: التخطّي يَحملُ سببَه في TAP، فلا يَلتبِسُ غيابُ
// بيئةٍ مشروعٌ بتعطيلٍ صامتٍ. ولا يَذكرُ `DATABASE_URL` لأنّ الحاجزَ يَنسِبُ به.
const skipReason = !ENABLED
  ? 'XUUX_HSM_TEST=1 غيرُ مُعلَنٍ — اختباراتُ التوكنِ الحقيقيِّ (SoftHSM) محلّيّةٌ لا CI'
  : !softhsmAvailable()
    ? `XUUX_HSM_TEST=1 مُعلَنٌ و softhsm2-util أو الموديولُ غائبٌ: ${MODULE}`
    : false;
const it = skipReason ? (name, fn) => test(name, { skip: skipReason }, fn) : test;

describe('Pkcs11HsmProvider', () => {
  describe('فشلٌ مغلق عند غياب المكتبة/التوكن', () => {
    // هذه لا تحتاج SoftHSM حقيقيًّا فهي تختبر المسارات الخطأ فقط.
    test('fromEnv ترمي MODULE_MISSING عند غياب المتغيّرات', async () => {
      const { Pkcs11HsmProvider, HsmError } =
        await import('../../src/root-of-trust/pkcs11-provider.mjs');
      await assert.rejects(
        () => Pkcs11HsmProvider.fromEnv({}),
        (e) => e instanceof HsmError && e.code === 'MODULE_MISSING',
      );
    });
  });

  describe('AeadKeyHandle (AES-256-GCM داخل HSM) — F05', () => {
    let aead;
    before(async () => {
      if (!provider) return;
      aead = await provider.getAeadKey('05');
    });

    it('encrypt/decrypt roundtrip يستعيد النص', async () => {
      const pt = Buffer.from('secret-event-payload');
      const { ciphertext, iv, tag } = await aead.encrypt(pt);
      assert.ok(ciphertext.length > 0);
      assert.equal(iv.length, 12);
      assert.equal(tag.length, 16);
      const dec = await aead.decrypt(ciphertext, iv, tag);
      assert.equal(dec.toString('utf8'), 'secret-event-payload');
    });

    it('كشف التلاعب: نص مُعدَّل يفشل فك التشفير', async () => {
      const { ciphertext, iv, tag } = await aead.encrypt(Buffer.from('tamper-me'));
      const tampered = Buffer.from(ciphertext);
      tampered[0] = tampered[0] ^ 1;
      await assert.rejects(() => aead.decrypt(tampered, iv, tag));
    });

    it('كل عملية تنتج IV عشوائياً مختلفاً', async () => {
      const a = await aead.encrypt(Buffer.from('x'));
      const b = await aead.encrypt(Buffer.from('x'));
      assert.ok(!a.iv.equals(b.iv));
    });

    it('عدم الاستخراج: aeadReady=true وcanExport=false', async () => {
      const desc = provider.describe();
      assert.equal(desc.aeadReady, true);
      assert.equal(desc.canExport, false);
    });
  });

  describe('SigningKeyHandle (EdDSA داخل HSM) — F06/F07 فشلٌ مغلق', () => {
    it('getSigningKey فشلٌ مغلقٌ عند عدم دعم الخلفية لـEdDSA', async () => {
      const { HsmError } = await import('../../src/root-of-trust/pkcs11-provider.mjs');
      const desc = provider.describe();
      if (desc.signingReady) {
        const handle = await provider.getSigningKey('06');
        const sig = await handle.sign(Buffer.from('probe'));
        assert.equal(sig.length, 64);
      } else {
        await assert.rejects(
          () => provider.getSigningKey('06'),
          (e) => e instanceof HsmError && e.code === 'CAPABILITY_SELFTEST_FAILED',
        );
      }
    });
  });
});
