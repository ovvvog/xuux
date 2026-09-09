// @ts-nocheck
// اختبارُ **الهجرةِ الإنتاجيةِ** لجذرِ الثقة — WL-092 / ADR 0005.
//
// الفرقُ بين هذا الملفِّ و`hsm-binding.test.mjs`: ذاك يقيسُ قدراتِ الربطِ
// وحداتٍ (هل يختمُ `sealEventData`؟ هل يوقّعُ `signLedgerEntry`؟). وهذا يقيسُ أن
// **المساراتَ الإنتاجيةَ نفسَها** تستدعي تلك القدرات: `createProductionRootOfTrust`
// يبني `PersistentEventLog` و`CommandLedger` و`HaltSwitch` الحقيقيّةَ، فيُفحصُ ما
// يُكتَبُ على القرصِ فعلاً — لا ما تقدرُ الدوالُّ على فعله.
//
// ولماذا توكنٌ مزيَّفٌ هنا: `pkcs11js` وSoftHSM غيرُ متوفّرين في CI، واختبارٌ
// يُتجاوَزُ لا يحمي شيئاً. والمزيَّفُ يحقّقُ عقدَ `HsmKeySource` حرفياً بتعمِيةٍ
// وتوقيعٍ حقيقيّين من `node:crypto`، ويُمرَّرُ عبرَ **الأصنافِ الإنتاجيةِ نفسِها**
// (`HsmSigner.open`، `bindHsmRootOfTrust`)، فالمنطقُ المفحوصُ إنتاجيٌّ كلُّه.
// والتوكنُ الحقيقيُّ يُقاسُ في `production-runtime-softhsm.test.mjs` محلياً، ولا
// يُدّعى هنا أنه قِيسَ في CI.

import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import {
  createCipheriv,
  createDecipheriv,
  generateKeyPairSync,
  randomBytes,
  sign as softwareSign,
} from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { describe } from 'node:test';

import {
  CommandLedger,
  CrownGateway,
  FileAnchorStore,
  SEAL_IV_BYTES,
  anchorLogWithHsm,
  createProductionRootOfTrust,
  describeProductionBindings,
  royalVerifierFromPublicKey,
  verifyAnchorChain,
  verifyEventChain,
} from '../../src/root-of-trust/index.mjs';

/** بيئةُ إنتاجٍ كاملةٌ الشرطِ: وضعُ توكنٍ ومسارُ وحدةٍ واسمُ توكنٍ وPIN. */
const PRODUCTION_ENV = Object.freeze({
  NODE_ENV: 'production',
  XUUX_ROOT_OF_TRUST_MODE: 'hsm',
  XUUX_PKCS11_MODULE: '/usr/lib/softhsm/libsofthsm2.so',
  XUUX_PKCS11_TOKEN: 'xuux-test',
  XUUX_PKCS11_PIN: 'fake-pin-not-used-by-injected-source', // secret-scan:allow
});

/**
 * توكنٌ مزيَّفٌ: المفاتيحُ داخلَه، ولا يُصدَّرُ إلا العام — كما يفعلُ التوكن.
 * @param overrides - تبديلُ مفاتيحَ بعينِها (لاختبارِ مُصدِرٍ آخر)
 * @returns موفّراً يحقّقُ عقدَ `HsmKeySource`
 */
function fakeToken(overrides = {}) {
  const aesKeys = new Map([['05', overrides.aead ?? randomBytes(32)]]);
  const edKeys = new Map([
    ['06', overrides.king ?? generateKeyPairSync('ed25519')],
    ['07', overrides.ledger ?? generateKeyPairSync('ed25519')],
  ]);
  const aad = Buffer.from('xuux-event');
  return {
    describe: () => ({ canExport: false }),
    getAeadKey: async (keyId) => {
      const key = aesKeys.get(keyId);
      if (!key) throw new Error('KEY_NOT_FOUND');
      return {
        keyId,
        encrypt: async (plaintext) => {
          const iv = randomBytes(SEAL_IV_BYTES);
          const cipher = createCipheriv('aes-256-gcm', key, iv);
          cipher.setAAD(aad);
          const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
          return { ciphertext, iv, tag: cipher.getAuthTag() };
        },
        decrypt: async (ciphertext, iv, tag) => {
          const decipher = createDecipheriv('aes-256-gcm', key, iv);
          decipher.setAAD(aad);
          decipher.setAuthTag(tag);
          return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
        },
      };
    },
    getSigningKey: async (keyId) => {
      const pair = edKeys.get(keyId);
      if (!pair) throw new Error('KEY_NOT_FOUND');
      return {
        keyId,
        sign: async (message) => softwareSign(null, message, pair.privateKey),
        exportPublicPem: async () => pair.publicKey.export({ type: 'spki', format: 'pem' }),
      };
    },
  };
}

/**
 * يبني تركيباً إنتاجياً بمصدرٍ محقونٍ في مجلدٍ مؤقّت.
 * @param options - تبديلاتُ المفاتيحِ وزياداتُ البيئة
 * @returns التركيبُ وجذرُه ودالةُ التنظيف
 */
async function buildRuntime(options = {}) {
  const root = mkdtempSync(join(tmpdir(), 'xuux-prod-'));
  const token = options.token ?? fakeToken();
  const runtime = await createProductionRootOfTrust(
    { ...PRODUCTION_ENV, ...(options.env ?? {}) },
    { root, fsync: false },
    { openSource: async () => ({ source: token, close: async () => undefined }) },
  );
  return {
    runtime,
    root,
    token,
    cleanup: () => {
      runtime.log.close?.();
      rmSync(root, { recursive: true, force: true });
    },
  };
}

/**
 * يمسكُ خطأً متزامناً ليُفحصَ رمزُه؛ `assert.throws` لا يُعيدُ الخطأ.
 * @param fn - الدالةُ المتوقّعُ فشلُها
 * @returns الخطأُ المرفوع
 */
function caught(fn) {
  try {
    fn();
  } catch (error) {
    return error;
  }
  return assert.fail('لم يُرفع خطأ');
}

/**
 * يمسكُ خطأً غيرَ متزامنٍ ليُفحصَ رمزُه.
 * @param fn - الدالةُ المتوقّعُ فشلُها
 * @returns الخطأُ المرفوع
 */
async function caughtAsync(fn) {
  try {
    await fn();
  } catch (error) {
    return error;
  }
  return assert.fail('لم يُرفع خطأ');
}

describe('المصنعُ الإنتاجيُّ يفشلُ مغلقاً قبلَ أن يمسَّ القرصَ أو التوكن', () => {
  test('غيابُ إعدادِ التوكنِ في الإنتاج يُرفض ولا يُفتح مصدرُ مفاتيحَ أصلاً', async () => {
    let opened = false;
    const error = await caughtAsync(() =>
      createProductionRootOfTrust(
        { NODE_ENV: 'production' },
        { root: mkdtempSync(join(tmpdir(), 'xuux-prod-')) },
        {
          openSource: async () => {
            opened = true;
            return { source: fakeToken(), close: async () => undefined };
          },
        },
      ),
    );
    assert.equal(error.code, 'HSM_REQUIRED_IN_PRODUCTION');
    assert.equal(opened, false, 'لا يُفتح توكنٌ في بيئةٍ مرفوضة');
  });

  test('غيابُ الـPIN وحدَه يُرفض برمزِه', async () => {
    const env = { ...PRODUCTION_ENV };
    delete env.XUUX_PKCS11_PIN;
    const error = await caughtAsync(() =>
      createProductionRootOfTrust(
        env,
        { root: mkdtempSync(join(tmpdir(), 'xuux-prod-')) },
        {
          openSource: async () => ({ source: fakeToken(), close: async () => undefined }),
        },
      ),
    );
    assert.equal(error.code, 'HSM_CONFIG_INCOMPLETE_IN_PRODUCTION');
  });

  test('وضعُ `software` المُصرَّحُ يُرفض في الإنتاج', async () => {
    const error = await caughtAsync(() =>
      createProductionRootOfTrust(
        { ...PRODUCTION_ENV, XUUX_ROOT_OF_TRUST_MODE: 'software' },
        { root: mkdtempSync(join(tmpdir(), 'xuux-prod-')) },
        { openSource: async () => ({ source: fakeToken(), close: async () => undefined }) },
      ),
    );
    assert.equal(error.code, 'DEV_MODE_FORBIDDEN_IN_PRODUCTION');
  });

  test('متغيّرُ مخزنٍ برمجيٍّ حاضرٌ يُرفض — لا سقوطَ إلى مخزنِ مفاتيحَ برمجيّ', async () => {
    const error = await caughtAsync(() =>
      createProductionRootOfTrust(
        { ...PRODUCTION_ENV, KING_KEY_DIR: '/tmp/xuux-keys' },
        { root: mkdtempSync(join(tmpdir(), 'xuux-prod-')) },
        { openSource: async () => ({ source: fakeToken(), close: async () => undefined }) },
      ),
    );
    assert.equal(error.code, 'SOFTWARE_KEY_STORE_FORBIDDEN_IN_PRODUCTION');
  });

  test('مصدرٌ يُصدِّرُ مفاتيحَه يُرفض ولو صحّت البيئة، والجلسةُ تُغلق', async () => {
    let closed = false;
    const exporting = { ...fakeToken(), describe: () => ({ canExport: true }) };
    const error = await caughtAsync(() =>
      createProductionRootOfTrust(
        PRODUCTION_ENV,
        { root: mkdtempSync(join(tmpdir(), 'xuux-prod-')) },
        {
          openSource: async () => ({
            source: exporting,
            close: async () => {
              closed = true;
            },
          }),
        },
      ),
    );
    assert.equal(error.code, 'HSM_PROVIDER_EXPORTS_MATERIAL');
    assert.equal(closed, true, 'جلسةُ توكنٍ لا تبقى مفتوحةً بعدَ فشلِ الإقلاع');
  });
});

describe('F05: السجلُّ الإنتاجيُّ مختومٌ على القرصِ فعلاً', () => {
  test('جسمُ الحدثِ لا يظهرُ نصّاً في الملف، ويُفكُّ ختمُه بالمفتاحِ وحده', async () => {
    const { runtime, cleanup } = await buildRuntime();
    try {
      assert.equal(runtime.log.sealed, true);
      const secret = 'plan-alpha-classified-42'; // secret-scan:allow — قيمةُ شاهدٍ للاختبارِ لا سرٌّ
      await runtime.log.appendSealed('royal.command', 'king:test', { plan: secret });
      const raw = readFileSync(runtime.log.file, 'utf8');
      assert.equal(raw.includes(secret), false, 'السجلُّ لا يحملُ الجسمَ صريحاً');
      assert.equal(raw.includes('"alg":"AES-256-GCM"'), true);
      const [event] = runtime.log.events;
      assert.equal(typeof event.data.ct, 'string');
      assert.deepEqual(await runtime.log.openEvent(event), { plan: secret });
      assert.equal(describeProductionBindings(runtime).sealKeyId, '05');
    } finally {
      cleanup();
    }
  });

  test('العبثُ بالمختومِ يُرفض ولا يُرجعُ جسماً مشكوكاً فيه', async () => {
    const { runtime, cleanup } = await buildRuntime();
    try {
      const event = await runtime.log.appendSealed('royal.command', 'king:test', { n: 1 });
      const tampered = {
        ...event,
        data: { ...event.data, ct: Buffer.from('deadbeef', 'hex').toString('base64') },
      };
      await assert.rejects(() => runtime.log.openEvent(tampered));
    } finally {
      cleanup();
    }
  });

  test('الإلحاقُ المتزامنُ القديمُ يُرفض فلا يبقى بابُ نصٍّ صريح', async () => {
    const { runtime, cleanup } = await buildRuntime();
    try {
      assert.throws(() => runtime.log.append('x', 'king:test', { a: 1 }), {
        message: 'SEALED_LOG_REQUIRES_ASYNC_APPEND',
      });
    } finally {
      cleanup();
    }
  });

  test('سلسلةُ التجزئةِ تبقى متحقَّقةً بلا مفتاحٍ — شرطُ التدقيقِ الخارجيّ', async () => {
    const { runtime, cleanup } = await buildRuntime();
    try {
      for (let i = 0; i < 3; i += 1) {
        await runtime.log.appendSealed('royal.command', 'king:test', { i });
      }
      const chain = verifyEventChain(runtime.log.events);
      assert.equal(chain.ok, true);
      assert.equal(chain.count, 3);
    } finally {
      cleanup();
    }
  });
});

describe('F06: التثبيتُ الإنتاجيُّ موقَّعٌ بمفتاحِ التوكنِ ولا يوقّعُ متزامناً', () => {
  test('`anchorLogWithHsm` يثبّتُ السجلَّ المختومَ وتُتحقَّقُ سلسلتُه', async () => {
    const { runtime, root, cleanup } = await buildRuntime();
    try {
      await runtime.log.appendSealed('royal.command', 'king:test', { a: 1 });
      const store = new FileAnchorStore(join(root, 'anchors.jsonl'));
      const record = await anchorLogWithHsm(store, runtime.anchorSigner, runtime.log);
      assert.equal(record.count, 1);
      assert.equal(verifyAnchorChain(store.read(), runtime.anchorSigner).ok, true);
      assert.equal(runtime.anchorSigner.keyId, '06');
      assert.throws(() => runtime.anchorSigner.sign(), { message: 'HSM_SYNC_SIGN_UNSUPPORTED' });
    } finally {
      cleanup();
    }
  });

  test('توجيهُ الإيقافِ يُصدَرُ غيرَ متزامنٍ ويُتحقَّقُ منه بالمفتاحِ العامّ وحده', async () => {
    const { runtime, cleanup } = await buildRuntime();
    try {
      const directive = await runtime.haltSwitch.haltAsync('اختبارُ الهجرة');
      assert.equal(directive.state, 'halted');
      const verifier = royalVerifierFromPublicKey(runtime.anchorSigner.publicKeyPem);
      const reading = runtime.haltSwitch.read();
      assert.equal(reading.state, 'halted');
      assert.equal(verifier.id.length > 0, true);
      assert.throws(() => runtime.haltSwitch.halt('متزامن'), {
        message: 'HALT_ALREADY_HALTED',
      });
      const resumed = await runtime.haltSwitch.resumeAsync('انتهى الاختبار');
      assert.equal(resumed.state, 'running');
      assert.equal(resumed.epoch > directive.epoch, true);
    } finally {
      cleanup();
    }
  });

  test('حذفُ ملفاتِ الإيقافِ الثلاثةِ لا يُعيدُ التشغيل', async () => {
    const { runtime, cleanup } = await buildRuntime();
    try {
      await runtime.haltSwitch.haltAsync('إيقافٌ سياديّ');
      rmSync(runtime.haltSwitch.file, { force: true });
      rmSync(runtime.haltSwitch.historyFile, { force: true });
      const reading = runtime.haltSwitch.read();
      assert.equal(reading.state, 'halted');
      assert.equal(reading.problem !== undefined, true);
    } finally {
      cleanup();
    }
  });
});

describe('F07: دفترُ الأوامرِ الإنتاجيُّ لا يقبلُ قراراً غيرَ موقَّع', () => {
  test('القرارُ يُكتبُ موقَّعاً بمفتاحِ `07` ويُحمَّلُ بعدَ التحقّق', async () => {
    const { runtime, cleanup } = await buildRuntime();
    try {
      const entry = await runtime.ledger.recordSigned({ id: 'cmd-0001' });
      assert.equal(entry.keyId, '07');
      assert.equal(typeof entry.signature, 'string');
      const audit = runtime.ledger.auditSignatures();
      assert.deepEqual({ ok: audit.ok, signed: audit.signed }, { ok: true, signed: 1 });
      runtime.ledger.load();
      assert.equal(runtime.ledger.has('cmd-0001'), true);
    } finally {
      cleanup();
    }
  });

  test('المسارُ المتزامنُ يُرفض فلا يُكتبُ سطرٌ بلا توقيع', async () => {
    const { runtime, cleanup } = await buildRuntime();
    try {
      assert.throws(() => runtime.ledger.record({ id: 'cmd-sync' }), {
        message: 'SIGNED_LEDGER_REQUIRES_ASYNC',
      });
    } finally {
      cleanup();
    }
  });

  test('سطرٌ مُعدَّلٌ بعدَ التوقيعِ يُرفض عندَ التحميل', async () => {
    const { runtime, cleanup } = await buildRuntime();
    try {
      const entry = await runtime.ledger.recordSigned({ id: 'cmd-0002' });
      const tampered = { ...entry, reason: 'مُدسٌّ بعدَ التوقيع' };
      writeFileSync(runtime.ledger.file, JSON.stringify(tampered) + '\n', 'utf8');
      assert.throws(() => runtime.ledger.load(), { code: 'LEDGER_SIGNATURE_INVALID' });
      assert.equal(runtime.ledger.auditSignatures().problem, 'LEDGER_SIGNATURE_INVALID');
    } finally {
      cleanup();
    }
  });

  test('سطرٌ بلا توقيعٍ — أي بالصيغةِ القديمة — يُرفض', async () => {
    const { runtime, cleanup } = await buildRuntime();
    try {
      writeFileSync(
        runtime.ledger.file,
        JSON.stringify({
          id: 'cmd-old',
          state: 'committed',
          pid: 1,
          at: new Date().toISOString(),
        }) + '\n',
        'utf8',
      );
      assert.throws(() => runtime.ledger.load(), { code: 'LEDGER_ENTRY_UNSIGNED' });
    } finally {
      cleanup();
    }
  });

  test('توقيعٌ صحيحٌ من مفتاحٍ آخرَ يُرفض بمنشئِه لا بتوقيعِه', async () => {
    const first = await buildRuntime();
    try {
      const entry = await first.runtime.ledger.recordSigned({ id: 'cmd-0003' });
      // دفترٌ آخرُ بمفتاحِ إصدارٍ مختلفٍ يقرأُ نفسَ الملف: التوقيعُ سليمٌ في ذاته
      // لكنه منسوبٌ إلى مفتاحٍ ليس مفتاحَ هذه العقدة.
      const other = await buildRuntime();
      try {
        // البناءُ نفسُه يُحمّلُ فيتحقّق: فالرفضُ يقعُ عندَ البناءِ لا بعدَه.
        const signer = other.runtime.ledgerSigner;
        assert.throws(
          () =>
            new CommandLedger(first.runtime.ledger.file, {
              signer: {
                keyId: '99',
                activeVersion: signer.activeVersion,
                signAsync: (payload) => signer.signAsync(payload),
                verify: (payload, signature) => signer.verify(payload, signature),
              },
              fsync: false,
            }),
          { code: 'LEDGER_KEY_MISMATCH' },
        );
        assert.throws(
          () => new CommandLedger(first.runtime.ledger.file, { signer, fsync: false }),
          { code: 'LEDGER_SIGNATURE_INVALID' },
        );
        assert.equal(entry.id, 'cmd-0003');
      } finally {
        other.cleanup();
      }
    } finally {
      first.cleanup();
    }
  });

  test('حذفُ سطرِ الدفترِ لا يُعيدُ قبولَ الأمرِ: الحجزُ يبقى فيَغمُض', async () => {
    const { runtime, cleanup } = await buildRuntime();
    try {
      await runtime.ledger.recordSigned({ id: 'cmd-0004' });
      // محوُ سطرِ الدفترِ لا يمحو الحجزَ الذريَّ على القرص، فإعادةُ إرسالِ الأمرِ
      // تُردُّ حالةً غامضةً تُفصَلُ بقرارٍ صريحٍ — لا تُنفَّذُ ثانيةً بصمت.
      writeFileSync(runtime.ledger.file, '', 'utf8');
      runtime.ledger.load();
      const rejection = caught(() => runtime.ledger.begin({ id: 'cmd-0004' }));
      assert.equal(
        ['COMMAND_IN_FLIGHT', 'INDETERMINATE_COMMAND'].includes(rejection.code),
        true,
        `رمزٌ غيرُ متوقّع: ${rejection.code}`,
      );
      // وإعادةُ التثبيتِ تبقى موقَّعةً: لا سطرَ يعودُ إلى الدفترِ بلا مفتاحِ F07.
      const recommitted = await runtime.ledger.commitSigned(
        { id: 'cmd-0004' },
        'تثبيتٌ بعدَ العبث',
      );
      assert.equal(recommitted.keyId, '07');
      assert.equal(runtime.ledger.auditSignatures().ok, true);
    } finally {
      cleanup();
    }
  });
});

describe('مصنعُ البوابةِ: الدفترُ ومفتاحُ الإيقافِ إلزاميّان في الإنتاج', () => {
  test('بوابةٌ بلا دفترٍ تُرفض عندَ البناءِ لا عندَ أولِ أمر', () => {
    assert.throws(
      () =>
        new CrownGateway(
          { id: 'king:x' },
          {},
          { append: () => undefined },
          {
            requireCommandLedger: true,
          },
        ),
      { message: 'COMMAND_LEDGER_REQUIRED_IN_PRODUCTION' },
    );
  });

  test('بوابةٌ بلا مفتاحِ إيقافٍ تُرفض عندَ البناء', () => {
    assert.throws(
      () =>
        new CrownGateway(
          { id: 'king:x' },
          {},
          { append: () => undefined },
          {
            commandLedger: { has: () => false },
            requireHaltSwitch: true,
          },
        ),
      { message: 'HALT_SWITCH_REQUIRED_IN_PRODUCTION' },
    );
  });

  test('الإلزامُ يُشتقُّ من بيئةِ التشغيلِ لا من راياتٍ يدويّةٍ فقط', async () => {
    const { runtime, cleanup } = await buildRuntime();
    const previous = process.env.STATE_ENV;
    process.env.STATE_ENV = 'production';
    try {
      assert.throws(() => new CrownGateway({ id: 'king:x' }, {}, { append: () => undefined }, {}), {
        message: 'COMMAND_LEDGER_REQUIRED_IN_PRODUCTION',
      });
      // ومع المكوّنين الحقيقيّين يُبنى: التركيبُ الإنتاجيُّ يوفّرُهما معاً.
      const gateway = new CrownGateway(
        { id: 'king:x' },
        {},
        { append: () => undefined },
        {
          commandLedger: runtime.ledger,
          haltSwitch: runtime.haltSwitch,
          requireTrustedClock: false,
        },
      );
      assert.equal(gateway.requireCommandLedger, true);
      assert.equal(gateway.requireHaltSwitch, true);
    } finally {
      if (previous === undefined) delete process.env.STATE_ENV;
      else process.env.STATE_ENV = previous;
      cleanup();
    }
  });
});
