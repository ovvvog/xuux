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
  createHash,
  generateKeyPairSync,
  randomBytes,
  sign as softwareSign,
} from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
  appendFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { describe } from 'node:test';
import { registerTmpRoot } from '../helpers/tmp-roots.mjs';

import {
  CommandLedger,
  CrownGateway,
  FileAnchorStore,
  SEAL_IV_BYTES,
  anchorLogWithHsm,
  createProductionRootOfTrust,
  describeProductionBindings,
  InMemoryFreshnessSocket,
  fingerprint,
  maybeAnchorLogWithHsm,
  royalVerifierFromPublicKey,
  verifyAnchorChain,
  verifyEventChain,
  StateManifest,
  stateManifestPath,
  stateManifestBinding,
} from '../../src/root-of-trust/index.mjs';

/**
 * بيئةُ إنتاجٍ كاملةُ الشرطِ. وWL-094 (`UF-05`) شدَّت الشرطَ: الرقمُ التسلسليُّ
 * وبصمةُ الموديولِ وهويةُ الملكِ **إلزاميّةٌ** في الإنتاج، فبيئةٌ بلا تثبيتٍ لم
 * تعُد «كاملةَ الشرط». وهويةُ الملكِ تُحسَبُ من مفتاحِ البديلِ نفسِه في
 * `buildRuntime` لأنها تتغيّرُ بتغيّرِ المفتاحِ المولَّدِ لكلِّ اختبار.
 */
const PRODUCTION_ENV = Object.freeze({
  NODE_ENV: 'production',
  STATE_ENV: 'production',
  XUUX_ROOT_OF_TRUST_MODE: 'hsm',
  XUUX_PKCS11_MODULE: '/usr/lib/softhsm/libsofthsm2.so',
  XUUX_PKCS11_TOKEN: 'xuux-test',
  XUUX_PKCS11_TOKEN_SERIAL: 'DEADBEEFCAFE0001',
  XUUX_PKCS11_MODULE_SHA256: 'f'.repeat(64),
  // هويةٌ نائبةٌ صحيحةُ الصيغةِ لاختباراتِ ما قبلَ فتحِ التوكن؛ و`buildRuntime`
  // يستبدلُها بهويةِ مفتاحِ البديلِ الحقيقيةِ فلا يمرُّ إقلاعٌ بهويةٍ لا تُقابَل.
  XUUX_KING_ID: 'king:' + '0'.repeat(24),
  XUUX_PKCS11_PIN: 'fake-pin-not-used-by-injected-source', // secret-scan:allow
  XUUX_ROOT_OF_TRUST_PROVISION: '1',
});

/**
 * هويةُ الملكِ كما يشتقُّها `HsmSigner` من المفتاحِ العامّ.
 * @param pair - زوجُ المفاتيحِ المولَّدُ للبديل
 * @returns الهويةُ المُثبَّتة
 */
function kingIdOf(pair) {
  return 'king:' + fingerprint(pair.publicKey).slice(0, 24);
}

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
    // WL-094 (`UF-02`): البديلُ يُعلن نوعَه ورقمَه التسلسليَّ لأنه بديلُ توكنٍ.
    // وموفّرٌ لا يُعلن `pkcs11-hsm` يُرَدُّ في الإنتاجِ الآن.
    describe: () => ({
      kind: 'pkcs11-hsm',
      canExport: false,
      tokenSerial: 'DEADBEEFCAFE0001',
    }),
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
  const root = options.root ?? registerTmpRoot(mkdtempSync(join(tmpdir(), 'xuux-prod-')));
  // `UF-05`: هويةُ الملكِ تُثبَّتُ في البيئةِ، فتُشتقُّ من مفتاحِ البديلِ نفسِه
  // لا من قيمةٍ ثابتةٍ تُخترَع.
  const king = options.king ?? generateKeyPairSync('ed25519');
  const token = options.token ?? fakeToken({ king });
  const freshnessSocket = options.freshnessSocket ?? new InMemoryFreshnessSocket(0n, 'prod-rt');
  const runtime = await createProductionRootOfTrust(
    { ...PRODUCTION_ENV, XUUX_KING_ID: kingIdOf(king), ...(options.env ?? {}) },
    {
      root,
      fsync: false,
      freshnessSocket,
      ...(options.royalCommandVerifier === undefined
        ? { royalCommandVerifier: () => true }
        : options.royalCommandVerifier === null
          ? {}
          : { royalCommandVerifier: options.royalCommandVerifier }),
    },
    { openSource: async () => ({ source: token, close: async () => undefined }) },
  );
  return {
    runtime,
    root,
    token,
    king,
    freshnessSocket,
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
        { root: registerTmpRoot(mkdtempSync(join(tmpdir(), 'xuux-prod-'))) },
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
        { root: registerTmpRoot(mkdtempSync(join(tmpdir(), 'xuux-prod-'))) },
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
        { root: registerTmpRoot(mkdtempSync(join(tmpdir(), 'xuux-prod-'))) },
        { openSource: async () => ({ source: fakeToken(), close: async () => undefined }) },
      ),
    );
    assert.equal(error.code, 'DEV_MODE_FORBIDDEN_IN_PRODUCTION');
  });

  test('متغيّرُ مخزنٍ برمجيٍّ حاضرٌ يُرفض — لا سقوطَ إلى مخزنِ مفاتيحَ برمجيّ', async () => {
    const error = await caughtAsync(() =>
      createProductionRootOfTrust(
        { ...PRODUCTION_ENV, KING_KEY_DIR: '/tmp/xuux-keys' },
        { root: registerTmpRoot(mkdtempSync(join(tmpdir(), 'xuux-prod-'))) },
        { openSource: async () => ({ source: fakeToken(), close: async () => undefined }) },
      ),
    );
    assert.equal(error.code, 'SOFTWARE_KEY_STORE_FORBIDDEN_IN_PRODUCTION');
  });

  test('مصدرٌ يُصدِّرُ مفاتيحَه يُرفض ولو صحّت البيئة، والجلسةُ تُغلق', async () => {
    let closed = false;
    const exporting = {
      ...fakeToken(),
      describe: () => ({ kind: 'pkcs11-hsm', canExport: true }),
    };
    const error = await caughtAsync(() =>
      createProductionRootOfTrust(
        PRODUCTION_ENV,
        { root: registerTmpRoot(mkdtempSync(join(tmpdir(), 'xuux-prod-'))) },
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
    // WL-094 (`UF-02`): الرمزُ الآن رمزُ **قيدِ الإنتاج** لأن المصنعَ صار
    // يُنادي `assertProductionKeyProviderAllowed` — وهي التي كانت مكتوبةً
    // ومُختبَرةً ولا مصنعَ ينادِيها. والرفضُ في الحالين قبلَ أيِّ مقبض.
    assert.equal(error.code, 'EXPORTABLE_PROVIDER_FORBIDDEN_IN_PRODUCTION');
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
      const directive = await runtime.haltSwitch.haltAsync('اختبارُ الهجرة', { id: 'test-cmd' });
      assert.equal(directive.state, 'halted');
      const verifier = royalVerifierFromPublicKey(runtime.anchorSigner.publicKeyPem);
      const reading = runtime.haltSwitch.read();
      assert.equal(reading.state, 'halted');
      assert.equal(verifier.id.length > 0, true);
      assert.throws(() => runtime.haltSwitch.halt('متزامن', { id: 'test-cmd' }), {
        message: 'HALT_ALREADY_HALTED',
      });
      const resumed = await runtime.haltSwitch.resumeAsync('انتهى الاختبار', { id: 'test-cmd' });
      assert.equal(resumed.state, 'running');
      assert.equal(resumed.epoch > directive.epoch, true);
    } finally {
      cleanup();
    }
  });

  test('حذفُ ملفاتِ الإيقافِ الثلاثةِ لا يُعيدُ التشغيل', async () => {
    const { runtime, cleanup } = await buildRuntime();
    try {
      await runtime.haltSwitch.haltAsync('إيقافٌ سياديّ', { id: 'test-cmd' });
      // WL-094 (`UF-03`): الاختبارُ كان اسمُه «الثلاثة» ويحذفُ اثنين، فكان
      // بابُ العودةِ إلى `running` وepoch=0 مفتوحاً ولا يراه أحد. الآن
      // يُحذَفُ **الثالثُ** أيضاً: ملفُّ الحقبة.
      rmSync(runtime.haltSwitch.file, { force: true });
      rmSync(runtime.haltSwitch.historyFile, { force: true });
      rmSync(runtime.haltSwitch.epochFile, { force: true });
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
      // WL-094 (`UF-07`): كان المحوُ يُقرأُ «دفتراً فارغاً» فيُردُّ الأمرُ حالةً
      // غامضةً بفضلِ الحجزِ وحدَه — وتلك بقيّةُ WL-011. الآن الشاهدُ خارجَ
      // الدفترِ يقولُ «كان فيه كذا»، فالمحوُ **يُكشَفُ باسمِه** ولا يُقرأُ نقصاً.
      const wipe = caught(() => runtime.ledger.load());
      assert.equal(wipe.code, 'LEDGER_BEHIND_WITNESS');
      // ولا يُقبَلُ أمرٌ جديدٌ على دفترٍ ممسوحٍ: الرفضُ مغلقٌ لا يُتجاوَز.
      const rejection = caught(() => runtime.ledger.begin({ id: 'cmd-0005' }));
      assert.equal(rejection.code, 'LEDGER_BEHIND_WITNESS');
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
      // D-7: ساعةٌ تكشفُ انزياحَها ولا تُبرهِنُ وقتَها لا تكفي في الإنتاجِ.
      // والرفضُ عندَ البناءِ لا عندَ أوّلِ أمرٍ: تركيبٌ يعملُ لحظةً بلا الضمانِ
      // المُعلَنِ له قد قَبِلَ أمراً بزمنٍ لا شاهدَ له.
      assert.throws(
        () =>
          new CrownGateway(
            { id: 'king:x' },
            {},
            { append: () => undefined },
            {
              commandLedger: runtime.ledger,
              haltSwitch: runtime.haltSwitch,
              clock: { now: () => Date.now(), assertTrusted: () => undefined },
            },
          ),
        { code: 'ATTESTED_TIME_REQUIRED' },
      );
      // ومع المكوّنين الحقيقيّين وساعةٍ تُبرهِنُ وقتَها يُبنى.
      const gateway = new CrownGateway(
        { id: 'king:x' },
        {},
        { append: () => undefined },
        {
          commandLedger: runtime.ledger,
          haltSwitch: runtime.haltSwitch,
          clock: {
            now: () => Date.now(),
            assertTrusted: () => undefined,
            attestation: () => ({
              atMs: Date.now(),
              radiusMs: 1000,
              ageMs: 0,
              sources: ['w1', 'w2'],
              localSkewMs: 0,
            }),
          },
        },
      );
      assert.equal(gateway.requireCommandLedger, true);
      assert.equal(gateway.requireHaltSwitch, true);
      assert.equal(gateway.requireAttestedTime, true);
    } finally {
      if (previous === undefined) delete process.env.STATE_ENV;
      else process.env.STATE_ENV = previous;
      cleanup();
    }
  });
});

test('UF-07: محوُ ملفِّ الدفترِ مع شاهدٍ موجبٍ يُرفَضُ لا يُقبَلُ كنشأةٍ', async () => {
  const { runtime, cleanup } = await buildRuntime();
  try {
    runtime.ledger.begin({ id: 'cmd-uf-07' });
    await runtime.ledger.commitSigned({ id: 'cmd-uf-07' });
    assert.equal(runtime.ledger.has('cmd-uf-07'), true);
    assert.equal(runtime.manifest.read().ledgerCommitted, 1);

    unlinkSync(runtime.ledger.file);

    assert.throws(
      () => runtime.ledger.load(),
      (err) => /** @type {Error & { code?: string }} */ (err).code === 'LEDGER_BEHIND_WITNESS',
      'محوُ الدفترِ مع شاهدٍ موجبٍ يجبُ أن يُرفَض',
    );
  } finally {
    cleanup();
  }
});

test('إقلاعٌ مردودٌ لا يتركُ قفلَ كاتبٍ يمنعُ الإقلاعَ المُصلَحَ بعدَه', async () => {
  // العيبُ: السجلُّ الدائمُ يُفتَحُ ويأخذُ قفلَ كاتبٍ واحدٍ **قبلَ** بناءِ الدفترِ
  // ومفتاحِ الإيقافِ، فإن سقطَ الإقلاعُ بعدَه (مجلَّدُ حجوزاتٍ ممسوحٌ — `UF-13`)
  // بقيَ القفلُ على القرصِ والمِقبضُ مفتوحاً، فيُردُّ الإقلاعُ المُصلَحُ بعدَه
  // بـ`LOG_ALREADY_LOCKED`: تعطيلٌ ذاتيٌّ لا يُرفَعُ إلا بحذفٍ يدويٍّ.
  const first = await buildRuntime();
  const { root, king, freshnessSocket } = first;
  const lockFile = join(root, 'events.log.lock');
  try {
    first.runtime.log.close?.();
    const claimsDir = first.runtime.ledger.claimsDir;
    rmSync(claimsDir, { recursive: true, force: true });

    const refused = await caughtAsync(() => buildRuntime({ root, king, freshnessSocket }));
    assert.equal(refused.code, 'LEDGER_STATE_ROOT_MISSING', `رمزٌ غيرُ متوقّعٍ: ${refused.code}`);
    assert.equal(existsSync(lockFile), false, 'إقلاعٌ مردودٌ خلّفَ قفلَ كاتبٍ');

    // والمقصودُ أثرٌ لا شكلُ ملفٍّ: إصلاحُ السببِ يُعيدُ الإقلاعَ فعلاً.
    mkdirSync(claimsDir, { recursive: true });
    const repaired = await buildRuntime({ root, king, freshnessSocket });
    assert.equal(repaired.runtime.haltSwitch.read().state, 'running');
    repaired.runtime.log.close?.();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('R4-B-01: سطرُ دفترِ رفعٍ بلا مصادقةٍ يُرفَضُ عندَ وجودِ مفتاحٍ من التوكنِ (M11.04-F05)', async () => {
  const { runtime, root, cleanup } = await buildRuntime();
  try {
    const manifestPath = stateManifestPath(root);
    const journalPath = join(root, 'root-of-trust.manifest.journal');
    const sealed = JSON.parse(readFileSync(manifestPath, 'utf8'));
    const body = sealed.body;
    const forgedEntry = {
      seq: body.sequence,
      key: 'anchoredCount',
      value: 7,
      at: new Date().toISOString(),
      prev: body.journalHead,
      hash: createHash('sha256')
        .update(
          JSON.stringify({
            instanceId: body.instanceId,
            seq: body.sequence,
            key: 'anchoredCount',
            value: 7,
            at: new Date().toISOString(),
            prev: body.journalHead,
          }),
        )
        .digest('hex'),
    };
    appendFileSync(journalPath, JSON.stringify(forgedEntry) + '\n');

    const manifest = new StateManifest(manifestPath, {
      fsync: false,
      sealer: runtime.anchorSigner,
    });
    const binding = stateManifestBinding(runtime.anchorSigner.id, PRODUCTION_ENV);
    await assert.rejects(
      () => manifest.provisionAsync(binding, process.env),
      (err) =>
        /** @type {Error & { code?: string }} */ (err).code ===
        'STATE_MANIFEST_JOURNAL_UNAUTHENTICATED',
      'سطرُ دفترِ رفعٍ بلا مصادقةٍ يجبُ أن يُرفَضَ عندَ وجودِ مفتاحٍ من التوكنِ',
    );
  } finally {
    cleanup();
  }
});

test('UF-01: رفعُ شاهدِ المرساةِ عندَ الإنجازِ يمنعُ الإقلاعَ بعدَ محوِ السجلِّ والمرساة', async () => {
  const { runtime, root, token, king, freshnessSocket, cleanup } = await buildRuntime();
  try {
    await runtime.log.appendSealed('test.event', 'king:test', { n: 1 });
    const store = new FileAnchorStore(join(root, 'anchors.json'), { fsync: false });
    // R5-B-02: الشاهدُ الموثوقُ يُحقَنُ لا callbackٌ عامٌّ. الرفعُ يقعُ داخلَ
    // المسارِ نفسِه، والتحقّقُ بعدَهُ يمنعُ مرساةً موقَّعةً بلا شاهدٍ.
    const record = await maybeAnchorLogWithHsm(store, runtime.anchorSigner, runtime.log, {
      force: true,
      witness: runtime.manifest.anchoredCountFloor(),
    });
    assert.ok(record, 'المرساةُ يجبُ أن تُنجَز');
    assert.equal(runtime.manifest.read().anchoredCount, record.count);

    // إغلاقُ السجلِّ قبلَ محوِه: القفلُ لا يُتْرَكُ مفتوحاً.
    runtime.log.close?.();

    unlinkSync(runtime.log.file);
    unlinkSync(runtime.log.headFile);
    unlinkSync(join(root, 'anchors.json'));

    await assert.rejects(
      () =>
        createProductionRootOfTrust(
          { ...PRODUCTION_ENV, XUUX_KING_ID: kingIdOf(king) },
          { root, fsync: false, freshnessSocket },
          { openSource: async () => ({ source: token, close: async () => undefined }) },
        ),
      // `WL-237`: الرمزُ صارَ رمزَ الحارسِ **الأسبقِ** — `LOG_STATE_ROOT_MISSING`.
      // المقاسُ لم يَضعُفْ: السيناريو نفسُه لم يُمَسَّ، والإقلاعُ ما زالَ مردوداً
      // ولا يُقرأُ نشأةً؛ لكنَّ غيابَ السجلِّ على جذرٍ قائمٍ يُرَدُّ الآنَ **قبلَ**
      // فحصِ المراسي، لأنَّ تأخيرَ الفحصِ إلى ما بعدَ فتحِ السجلِّ كانَ يُنشئُ ملفّاً
      // فارغاً يُمرِّرُ الهجومَ في الإقلاعِ التالي (‏`S13`). **وفاحصُ المراسي نفسُه
      // بقيَ مقيساً بسجلٍّ حاضرٍ** في الاختبارِ الذي يَليه بمسارَيهِ كلَيهما.
      (err) => /** @type {Error & { code?: string }} */ (err).code === 'LOG_STATE_ROOT_MISSING',
      'الإقلاعُ بعدَ محوِ السجلِّ والمرساةِ مع شاهدٍ موجبٍ يجبُ أن يُرفَض',
    );
  } finally {
    cleanup();
  }
});

// `WL-237`: فاحصُ المراسي يُقاسُ **بسجلٍّ حاضرٍ** بمسارَيهِ كلَيهما. وهذا قياسٌ
// أدقُّ من الذي كانَ: الاختبارُ السابقُ كانَ يمحو السجلَّ فيَخلِطُ حارسَينِ في
// رمزٍ واحدٍ، فإذا سبقَ حارسُ غيابِ السجلِّ بقيَ فاحصُ المراسي بلا قياسٍ.
test('UF-01: شاهدُ مراسٍ موجبٌ ومخزنُ المراسي مُزيلٌ والسجلُّ حاضرٌ ⇒ يُرَدُّ الإقلاع', async () => {
  const { runtime, root, token, king, freshnessSocket, cleanup } = await buildRuntime();
  try {
    await runtime.log.appendSealed('test.event', 'king:test', { n: 1 });
    const store = new FileAnchorStore(join(root, 'anchors.json'), { fsync: false });
    const record = await maybeAnchorLogWithHsm(store, runtime.anchorSigner, runtime.log, {
      force: true,
      witness: runtime.manifest.anchoredCountFloor(),
    });
    assert.ok(record, 'المرساةُ يجبُ أن تُنجَز');
    assert.equal(runtime.manifest.read().anchoredCount > 0, true, 'الشاهدُ لم يرتفعْ');
    runtime.log.close?.();

    // المخزنُ وحدَه يُزال، **والسجلُّ ورأسُه يبقيانِ** — فلا يَسبِقُ حارسُ غيابِ السجلِّ.
    unlinkSync(join(root, 'anchors.json'));
    assert.equal(existsSync(runtime.log.file), true, 'السجلُّ يجبُ أن يبقى في هذا المجَسّ');

    const refused = await caughtAsync(() =>
      createProductionRootOfTrust(
        { ...PRODUCTION_ENV, XUUX_KING_ID: kingIdOf(king) },
        { root, fsync: false, freshnessSocket },
        { openSource: async () => ({ source: token, close: async () => undefined }) },
      ),
    );
    assert.equal(
      refused.code,
      'PRODUCTION_LOG_BEHIND_ANCHOR',
      `رمزٌ غيرُ متوقّعٍ: ${refused.code}`,
    );
  } finally {
    cleanup();
  }
});

test('UF-01: سجلٌّ أقصرُ ممّا تشهدُ به مرساةٌ قائمةٌ يُرَدُّ الإقلاعُ به', async () => {
  const { runtime, root, token, king, freshnessSocket, cleanup } = await buildRuntime();
  try {
    await runtime.log.appendSealed('test.event', 'king:test', { n: 1 });
    await runtime.log.appendSealed('test.event', 'king:test', { n: 2 });
    const store = new FileAnchorStore(join(root, 'anchors.json'), { fsync: false });
    const record = await maybeAnchorLogWithHsm(store, runtime.anchorSigner, runtime.log, {
      force: true,
      witness: runtime.manifest.anchoredCountFloor(),
    });
    assert.ok(record, 'المرساةُ يجبُ أن تُنجَز');
    const logFile = runtime.log.file;
    const headFile = runtime.log.headFile;
    const anchoredCount = record.count;
    runtime.log.close?.();

    // قصُّ السجلِّ إلى ما دونَ ما تشهدُ به المرساةُ، **ورأسُه يُوافَقُ معَ المقصوصِ**
    // كي لا يَسبِقَ رمزُ قصٍّ فيَحجُبَ فاحصَ المراسي عن القياسِ.
    const lines = readFileSync(logFile, 'utf8').split('\n').filter(Boolean);
    assert.equal(lines.length >= 2, true, 'المقدّمةُ ساقطةٌ: السجلُّ أقصرُ من اثنينِ');
    const kept = lines.slice(0, lines.length - 1);
    writeFileSync(logFile, kept.join('\n') + '\n', 'utf8');
    const keptLast = JSON.parse(kept[kept.length - 1]);
    writeFileSync(
      headFile,
      JSON.stringify({
        count: kept.length,
        lastHash: keptLast.hash,
        updatedAt: new Date().toISOString(),
      }),
      'utf8',
    );
    assert.equal(
      kept.length < anchoredCount,
      true,
      'المقدّمةُ ساقطةٌ: القصُّ لم يَنزلْ دونَ المرساةِ',
    );

    const refused = await caughtAsync(() =>
      createProductionRootOfTrust(
        { ...PRODUCTION_ENV, XUUX_KING_ID: kingIdOf(king) },
        { root, fsync: false, freshnessSocket },
        { openSource: async () => ({ source: token, close: async () => undefined }) },
      ),
    );
    assert.equal(
      ['PRODUCTION_LOG_BEHIND_ANCHOR', 'PRODUCTION_ANCHOR_CHAIN_INVALID'].includes(refused.code),
      true,
      `رمزٌ غيرُ متوقّعٍ: ${refused.code}`,
    );
  } finally {
    cleanup();
  }
});

/**
 * موقّعٌ بلا `deriveJournalKey` — أي توكنٌ لا يُسألُ مفتاحَ مصادقةٍ. وهذا هو
 * المسارُ الذي كانَ يُسقِطُ الدفترَ إلى تجزئةٍ عاريّةٍ صامتاً (‏`R4-K3-02`).
 * @param signer - الموقّعُ الحقيقيُّ
 * @returns موقّعاً يختمُ ويتحقّقُ ولا يُشتقُّ منه مفتاحٌ
 */
function sealerWithoutJournalKey(signer) {
  return {
    id: signer.id,
    signAsync: (payload) => signer.signAsync(payload),
    verify: (payload, signature) => signer.verify(payload, signature),
  };
}

test('R4-K3-02: موقّعٌ بلا مفتاحِ مصادقةٍ يُرفَضُ في الإنتاجِ ولا يُسقَطُ إلى تجزئةٍ عاريّةٍ', async () => {
  const { runtime, root, cleanup } = await buildRuntime();
  try {
    const manifest = new StateManifest(stateManifestPath(root), {
      fsync: false,
      sealer: sealerWithoutJournalKey(runtime.anchorSigner),
      env: PRODUCTION_ENV,
    });
    await assert.rejects(
      () => manifest.openAsync(stateManifestBinding(runtime.anchorSigner.id, PRODUCTION_ENV)),
      (err) =>
        /** @type {Error & { code?: string }} */ (err).code ===
        'STATE_MANIFEST_JOURNAL_UNAUTHENTICATED',
      'الإنتاجُ لا يقبلُ دفترَ رفعٍ بلا مفتاحِ مصادقةٍ من التوكن',
    );
  } finally {
    cleanup();
  }
});

test('R4-K3-02: سطرٌ متّسقُ التجزئةِ لا يرفعُ العدّاداتِ حينَ يغيبُ المفتاحُ', async () => {
  const { runtime, root, cleanup } = await buildRuntime();
  try {
    const manifestPath = stateManifestPath(root);
    const journalPath = join(root, 'root-of-trust.manifest.journal');
    const sealed = JSON.parse(readFileSync(manifestPath, 'utf8'));
    const body = sealed.body;
    const at = new Date().toISOString();
    // سطرٌ يحسبُه مالكُ القرصِ بنفسِه: تجزئةٌ عاريّةٌ متّسقةٌ بلا أيِّ سرٍّ.
    const entry = {
      seq: body.sequence,
      key: 'ledgerCommitted',
      value: 99,
      at,
      prev: body.journalHead,
    };
    const forged = {
      ...entry,
      hash: createHash('sha256')
        .update(JSON.stringify({ instanceId: body.instanceId, ...entry }))
        .digest('hex'),
    };
    appendFileSync(journalPath, JSON.stringify(forged) + '\n');

    const manifest = new StateManifest(manifestPath, {
      fsync: false,
      sealer: sealerWithoutJournalKey(runtime.anchorSigner),
      env: PRODUCTION_ENV,
    });
    await assert.rejects(
      () => manifest.openAsync(stateManifestBinding(runtime.anchorSigner.id, PRODUCTION_ENV)),
      (err) =>
        /** @type {Error & { code?: string }} */ (err).code ===
        'STATE_MANIFEST_JOURNAL_UNAUTHENTICATED',
      'سطرٌ مدسوسٌ متّسقُ التجزئةِ يجبُ أن يُرفَضَ لا أن يرفعَ عدّاداً',
    );
  } finally {
    cleanup();
  }
});

test('R4-K3-02: دفترٌ مُصادَقٌ يُقرأُ بلا مفتاحٍ يُرفَضُ تخفيضاً في كلِّ البيئاتِ', async () => {
  const { runtime, root, cleanup } = await buildRuntime();
  try {
    // رفعٌ حقيقيٌّ عبرَ المسارِ الإنتاجيِّ: يكتبُ سطراً يحملُ `mac`.
    runtime.manifest.raise('anchoredCount', 3);
    const journalPath = join(root, 'root-of-trust.manifest.journal');
    const written = JSON.parse(readFileSync(journalPath, 'utf8').trim().split('\n')[0]);
    assert.equal(typeof written.mac, 'string', 'السطرُ المكتوبُ يجبُ أن يكونَ مُصادَقاً');

    const devEnv = { NODE_ENV: 'test' };
    const manifest = new StateManifest(stateManifestPath(root), {
      fsync: false,
      sealer: sealerWithoutJournalKey(runtime.anchorSigner),
      env: devEnv,
    });
    await assert.rejects(
      () => manifest.openAsync(stateManifestBinding(runtime.anchorSigner.id, PRODUCTION_ENV)),
      (err) =>
        /** @type {Error & { code?: string }} */ (err).code ===
        'STATE_MANIFEST_JOURNAL_UNAUTHENTICATED',
      'دفترٌ كُتِبَ مُصادَقاً ثمَّ قُرِئَ بلا مفتاحٍ تخفيضٌ يُرفَضُ',
    );
  } finally {
    cleanup();
  }
});

test('R4-B-03: maybeAnchorLogWithHsm يرفعُ شاهدَ البيانِ عبرَ witness (R5-B-02)', async () => {
  const { maybeAnchorLogWithHsm } = await import('../../src/root-of-trust/production-runtime.mjs');
  const { FileAnchorStore } = await import('../../src/root-of-trust/anchor.mjs');
  const { StateManifest, stateManifestPath } =
    await import('../../src/root-of-trust/state-manifest.mjs');
  const { runtime, root, cleanup } = await buildRuntime();
  try {
    const store = new FileAnchorStore(join(root, 'anchors.jsonl'), { fsync: false });
    // أضفْ وقعةً للسجلِّ قبلَ التثبيتِ — لا يُثبَّتُ سجلٌّ فارغٌ.
    await runtime.log.appendSealed('test.event', runtime.anchorSigner.id, { n: 1 });
    const manifest = new StateManifest(stateManifestPath(root), {
      fsync: false,
      sealer: runtime.anchorSigner,
    });
    // البيانُ أُنشئَ بالفعلِ في `buildRuntime` — نقرأُهُ فقط.
    const witnessed = manifest.read().anchoredCount;
    assert.equal(witnessed, 0, 'قبلَ التثبيت: صفرٌ');
    // R5-B-02: الشاهدُ الموثوقُ يُحقَنُ لا callbackٌ عامٌّ.
    const record = await maybeAnchorLogWithHsm(store, runtime.anchorSigner, runtime.log, {
      force: true,
      witness: manifest.anchoredCountFloor(),
    });
    assert.notEqual(record, null, 'التثبيتُ وقع');
    assert.equal(
      manifest.read().anchoredCount,
      record.count,
      'بعدَ التثبيت: شاهدُ البيانِ ارتفعَ إلى عدِّ المرساة',
    );
  } finally {
    cleanup();
  }
});

describe('المصنعُ الإنتاجيُّ يُسلِّمُ مخزنَ سحبٍ دائماً (R4-K3-03)', () => {
  test('revocationStore ليس null وهو من نوع FileRevocationStore', async () => {
    const { runtime, cleanup } = await buildRuntime();
    try {
      assert.ok(runtime.revocationStore, 'المخزن مُسلَّم');
      assert.equal(typeof runtime.revocationStore.ready, 'function', 'يحقق عقد RevocationStore');
      assert.equal(
        typeof runtime.revocationStore.isRevoked,
        'function',
        'يحقق عقد RevocationStore',
      );
    } finally {
      cleanup();
    }
  });

  test('revocationStore يُحقَنُ في CertificateAuthority ويدومُ عبرَ إعادةِ التشغيل', async () => {
    const { runtime, root, cleanup } = await buildRuntime();
    try {
      const store = runtime.revocationStore;
      assert.equal(store.ready(), true, 'المخزن جاهز');

      // بناءُ سلطةِ تصديقٍ بمخزنِ الإنتاج.
      const KingIdentity = (await import('../../src/root-of-trust/identity.mjs')).KingIdentity;
      const CertificateAuthority = (await import('../../src/root-of-trust/identity.mjs'))
        .CertificateAuthority;
      const kingId = new KingIdentity();
      const ca = new CertificateAuthority(kingId, { revocationStore: store });
      const cert = ca.issue('agent:x', 'minister', ['read']);
      assert.equal(ca.isValid(cert), true, 'قبل السحب: مقبولة');
      const result = ca.revoke(cert.id, 'compromised');
      assert.equal(result.persisted, true, 'السحب كُتب في المخزن');
      assert.equal(ca.isValid(cert), false, 'بعد السحب: مرفوضة');

      // «إعادةُ تشغيل»: مخزنٌ جديدٌ من نفسِ الملف.
      const FileRevocationStore = (await import('../../src/root-of-trust/identity.mjs'))
        .FileRevocationStore;
      const store2 = new FileRevocationStore(join(root, 'revoked.jsonl'), {
        fsync: false,
      });
      const ca2 = new CertificateAuthority(kingId, { revocationStore: store2 });
      assert.equal(ca2.isValid(cert), false, 'بعد إعادة التشغيل بنفس الملف: ما زالت مسحوبة');
    } finally {
      cleanup();
    }
  });
});

// ————————————————————————————————————————————————————————————————————————
// WL-165 — امتدادُ `R4-B-03`/`M11.04-F05`: شاهدُ المرساةِ لا يبقى خارجَ الخاتَمِ
// بسهوِ مُستدعٍ، ودفترُ الرفعِ كاتبُه واحدٌ في اللحظةِ.
//
// لماذا أُضيفَ هذا القسمُ: الإصلاحُ السابقُ جعلَ `onAnchor` **اختياريّاً**،
// والمُستدعي الحقيقيُّ الوحيدُ في المستودعِ (`scripts/anchor-log.mjs`) لم يكن
// يُمرِّرُه — فكانت الأداةُ تُوقِّعُ مرساةً ولا يرتفعُ الشاهدُ، أي النتيجةُ
// المفتوحةُ قائمةً في المسارِ التشغيليِّ بعدَ «إصلاحِها» في الدالّة.
describe('WL-165: مصرفُ شاهدِ المرساةِ شرطٌ، ودفترُ الرفعِ كاتبُه واحدٌ', () => {
  test('مرساةٌ بلا مصرفِ شاهدٍ تُرفَضُ قبلَ التوقيعِ ولا تُكتَبُ', async () => {
    const { runtime, root, cleanup } = await buildRuntime();
    try {
      await runtime.log.appendSealed('test.event', 'king:test', { n: 1 });
      const store = new FileAnchorStore(join(root, 'anchors-no-sink.json'), { fsync: false });
      const error = await caughtAsync(() =>
        maybeAnchorLogWithHsm(store, runtime.anchorSigner, runtime.log, { force: true }),
      );
      assert.equal(error.code, 'ANCHOR_WITNESS_SINK_MISSING', 'الرفضُ برمزِه لا برسالةٍ عامّةٍ');
      assert.equal(store.read().length, 0, 'ولا مرساةَ موقَّعةً خُلِّفت: الرفضُ قبلَ التوقيعِ');
      assert.equal(runtime.manifest.read().anchoredCount, 0, 'والشاهدُ لم يتحرَّكْ');
    } finally {
      cleanup();
    }
  });

  test('رفعٌ من نسخةٍ قديمةِ الذاكرةِ يقرأُ القرصَ فلا يُنتَجُ دفترٌ منقطعٌ', async () => {
    const { runtime, root, king, cleanup } = await buildRuntime();
    try {
      const env = { ...PRODUCTION_ENV, XUUX_KING_ID: kingIdOf(king) };
      // نسخةٌ ثانيةٌ على الجذرِ نفسِه — تمثيلُ الأداةِ التي تعملُ خارجَ العمليةِ.
      const second = new StateManifest(stateManifestPath(root), {
        fsync: false,
        sealer: runtime.anchorSigner,
        env,
      });
      await second.openAsync(stateManifestBinding(runtime.anchorSigner.id, env));
      // الأولى (نسخةُ الخدمةِ) تقرأُ الحالةَ فتصيرُ ذاكرتُها مرجعاً، ثمَّ ترفعُ
      // الثانيةُ. ولو بقيَ الرفعُ يقرأُ من الذاكرةِ لكتبتِ الأولى سطراً برأسٍ
      // قديمٍ أو بقيمةٍ غيرِ صاعدةٍ، فلا يُقرأُ الدفترُ عندَ الإقلاعِ التالي.
      assert.equal(runtime.manifest.read().anchoredCount, 0);
      second.raise('anchoredCount', 9);
      // الخدمةُ ترفعُ قيمةً أدنى مما رفعتْه الأداةُ: لو قِيسَ الحدُّ من الذاكرةِ
      // لكُتِبَ سطرٌ غيرُ صاعدٍ بعدَ سطرِ الأداةِ، فيُرفَضُ الدفترُ عندَ الإقلاعِ
      // التالي — منعُ خدمةٍ بذاتِها. والقراءةُ من القرصِ داخلَ القفلِ تجعلُه
      // لا عملاً بلا ضررٍ.
      runtime.raiseAnchorWitness(7);
      assert.equal(runtime.manifest.read().anchoredCount, 9, 'الحدُّ من القرصِ لا من الذاكرةِ');
      runtime.raiseAnchorWitness(11);
      // ثالثةٌ نظيفةُ الذاكرةِ تُطوي الدفترَ: لو انقطعتِ السلسلةُ لرُفِعَ رمزٌ.
      const reader = new StateManifest(stateManifestPath(root), {
        fsync: false,
        sealer: runtime.anchorSigner,
        env,
      });
      await reader.openAsync(stateManifestBinding(runtime.anchorSigner.id, env));
      assert.equal(reader.read().anchoredCount, 11, 'الدفترُ مقروءٌ والقيمةُ أعلى الرفعَينِ');
      assert.equal(existsSync(reader.journalLockFile), false, 'والقفلُ لا يُترَكُ قائماً');
    } finally {
      cleanup();
    }
  });

  test('قفلٌ لعمليةٍ حيّةٍ أخرى يمنعُ الرفعَ رفضاً مغلقاً برمزِه', async () => {
    const { runtime, cleanup } = await buildRuntime();
    try {
      // العمليةُ 1 حيّةٌ في كلِّ نظامٍ يعملُ عليه هذا الاختبارُ، وليست هذه العمليةَ.
      writeFileSync(runtime.manifest.journalLockFile, JSON.stringify({ pid: 1, at: 'x' }));
      const error = caught(() => runtime.raiseAnchorWitness(3));
      assert.equal(error.code, 'STATE_MANIFEST_JOURNAL_LOCKED', 'رفضٌ مغلقٌ لا كتابةٌ متوازيةٌ');
      assert.equal(runtime.manifest.read().anchoredCount, 0, 'ولا شاهدَ ارتفعَ');
      rmSync(runtime.manifest.journalLockFile, { force: true });
      runtime.raiseAnchorWitness(3);
      assert.equal(runtime.manifest.read().anchoredCount, 3, 'وبزوالِ القفلِ يقعُ الرفعُ');
    } finally {
      cleanup();
    }
  });

  test('قفلٌ لعمليةٍ ميتةٍ أثرُ تعطُّلٍ يُنتزَعُ فلا يتعطَّلُ الرفعُ أبداً', async () => {
    const { runtime, cleanup } = await buildRuntime();
    try {
      // رقمُ عمليةٍ فوقَ الحدِّ الأقصى في لينكس: ميتٌ يقيناً لا تخميناً.
      writeFileSync(
        runtime.manifest.journalLockFile,
        JSON.stringify({ pid: 4194305, at: 'stale' }),
      );
      runtime.raiseAnchorWitness(5);
      assert.equal(runtime.manifest.read().anchoredCount, 5, 'قفلٌ ميتٌ لا يُعطِّلُ جذرَ الثقةِ');
      assert.equal(existsSync(runtime.manifest.journalLockFile), false, 'والقفلُ فُكَّ بعدَه');
    } finally {
      cleanup();
    }
  });
});

// R5-B-02: مرساةٌ موقَّعةٌ مع `onAnchor` شكليٍّ تبقى بلا شاهدٍ — كانَ callbackٌ عامٌّ
// يُمكنُ أن يُنسى أو يُمرَّرَ فارغاً. الإصلاحُ: الشاهدُ الموثوقُ يُحقَنُ ويُتحقَّقُ منه.
test('R5-B-02: witness موثوقٌ يرفعُ ويُتحقَّقُ، وonAnchor شكليٌّ لا يكفي', async () => {
  const { maybeAnchorLogWithHsm } = await import('../../src/root-of-trust/production-runtime.mjs');
  const { FileAnchorStore } = await import('../../src/root-of-trust/anchor.mjs');
  const { StateManifest, stateManifestPath } =
    await import('../../src/root-of-trust/state-manifest.mjs');
  const { runtime, root, cleanup } = await buildRuntime();
  try {
    await runtime.log.appendSealed('test.event', runtime.anchorSigner.id, { n: 1 });
    const store = new FileAnchorStore(join(root, 'anchors-r5b02.jsonl'), { fsync: false });
    const manifest = new StateManifest(stateManifestPath(root), {
      fsync: false,
      sealer: runtime.anchorSigner,
    });
    const witnessed = manifest.read().anchoredCount;
    assert.equal(witnessed, 0, 'قبلَ التثبيت: صفرٌ');
    // الشاهدُ الموثوقُ يُرفَعُ ويُتحقَّقُ منه بعدَ التوقيع.
    const record = await maybeAnchorLogWithHsm(store, runtime.anchorSigner, runtime.log, {
      force: true,
      witness: manifest.anchoredCountFloor(),
    });
    assert.ok(record, 'التثبيتُ وقع');
    assert.equal(
      manifest.read().anchoredCount,
      record.count,
      'الشاهدُ ارتفعَ إلى عدِّ المرساةِ والتحقّقُ نجح',
    );
  } finally {
    cleanup();
  }
});

// R5-A-01: شاهدُ العهدِ المزدوجُ — من البيانِ ومن السجلِّ المختومِ. بيانٌ أقدمُ
// صحيحُ الخاتَمِ + دفترٌ فارغٌ كانَ يُعيدُ قبولَ أمرٍ ثُبِّتَ، لأنّ الشاهدَ كانَ في
// البيانِ وحدَه. الإصلاحُ: `onCommitSink` يكتبُ واقعةً مختومةً في السجلِّ،
// و`ledgerCommittedFromSealedLog` يقرأُها عندَ الإقلاعِ.
test('R5-A-01: ledgerCommittedFromSealedLog يقرأُ أعلى عدٍّ من السجلِّ المختوم', async () => {
  const { ledgerCommittedFromSealedLog } =
    await import('../../src/root-of-trust/production-runtime.mjs');
  const { runtime, cleanup } = await buildRuntime();
  try {
    // قبلَ أيِّ التزامٍ: صفرٌ.
    const before = await ledgerCommittedFromSealedLog(runtime.log);
    assert.equal(before, 0, 'قبلَ أيِّ التزامٍ: صفرٌ');
    // بعدَ التزامٍ موقَّعٍ: يُكتبُ واقعةٌ مختومةٌ في السجلِّ.
    runtime.ledger.begin({ id: 'cmd:r5a01-test' });
    await runtime.ledger.commitSigned({ id: 'cmd:r5a01-test' });
    const after = await ledgerCommittedFromSealedLog(runtime.log);
    assert.equal(after, 1, 'بعدَ التزامٍ واحدٍ: واحدٌ');
  } finally {
    cleanup();
  }
});

// R5-B-02: onAnchor شكليٌّ لم يَعُدْ مقبولاً — callbackٌ عامٌّ كانَ ثغرةً. لا بدَّ من
// شاهدٍ موثوقٍ يُرفَعُ ويُتحقَّقُ منه.
test('R5-B-02: onAnchor شكليٌّ يُرفَضُ — لا بدَّ من witness موثوق', async () => {
  const { maybeAnchorLogWithHsm } = await import('../../src/root-of-trust/production-runtime.mjs');
  const { FileAnchorStore } = await import('../../src/root-of-trust/anchor.mjs');
  const { runtime, root, cleanup } = await buildRuntime();
  try {
    await runtime.log.appendSealed('test.event', runtime.anchorSigner.id, { n: 1 });
    const store = new FileAnchorStore(join(root, 'anchors-r5b02-noop.jsonl'), {
      fsync: false,
    });
    // onAnchor شكليٌّ لا يَرفعُ شاهداً ولا يُتحقَّقُ — يجبُ أن يُرفَض.
    const error = await caughtAsync(() =>
      maybeAnchorLogWithHsm(store, runtime.anchorSigner, runtime.log, {
        force: true,
        onAnchor: () => {},
      }),
    );
    assert.equal(
      error.code,
      'ANCHOR_WITNESS_SINK_MISSING',
      'onAnchor شكليٌّ يجبُ أن يُرفَضَ — لا بدَّ من witness',
    );
    assert.equal(store.read().length, 0, 'ولا مرساةَ موقَّعةً خُلِّفت');
    assert.equal(runtime.manifest.read().anchoredCount, 0, 'والشاهدُ لم يتحرَّكْ');
  } finally {
    cleanup();
  }
});

test('R5-B-07: runtime بلا مُحقّقٍ يرفضُ haltAsync — fail-closed', async () => {
  const { runtime, cleanup } = await buildRuntime({ royalCommandVerifier: null });
  try {
    await assert.rejects(
      runtime.haltSwitch.haltAsync('إيقاف', { id: 'test-cmd' }),
      /HALT_ROYAL_COMMAND_REQUIRED/,
      'haltAsync بلا مُحقّقٍ موصولٍ مرفوض',
    );
  } finally {
    cleanup();
  }
});

test('R5-B-07: runtime بلا مُحقّقٍ يرفضُ resumeAsync على حالة موقوفة — fail-closed', async () => {
  // ابنِ runtime بمُحقّقٍ لتمكين الإيقاف
  const { runtime, root, king, token, freshnessSocket, cleanup } = await buildRuntime({
    royalCommandVerifier: () => true,
  });
  try {
    // أوقف النظام بأمرٍ موثَّق
    await runtime.haltSwitch.haltAsync('إيقاف', { id: 'halt-cmd' });
    assert.equal(runtime.haltSwitch.read().state, 'halted', 'النظام موقوف');

    // أغلق السجلَّ قبل إعادة الفتح
    runtime.log.close?.();

    // أعد الفتح بنفس الجذر والمفتاح لكن بلا مُحقّق
    const runtime2 = await createProductionRootOfTrust(
      { ...PRODUCTION_ENV, XUUX_KING_ID: kingIdOf(king) },
      { root, fsync: false, royalCommandVerifier: null, freshnessSocket },
      { openSource: async () => ({ source: token, close: async () => undefined }) },
    );

    // resumeAsync بلا مُحقّقٍ على حالة موقوفة يجب أن يُرفض بـ HALT_ROYAL_COMMAND_REQUIRED
    await assert.rejects(
      runtime2.haltSwitch.resumeAsync('استئناف', { id: 'resume-cmd' }),
      /HALT_ROYAL_COMMAND_REQUIRED/,
      'resumeAsync بلا مُحقّقٍ على حالة موقوفة مرفوض',
    );
    runtime2.log.close?.();
  } finally {
    cleanup();
  }
});
