// @ts-nocheck
// tests/root-of-trust/round-2-remediation.test.mjs
//
// اختباراتُ إعادةِ إنتاجٍ لنتائجِ الجولةِ الثانية — WL-094.
//
// المصدرُ الوحيدُ للنتائجِ هو التقريرانِ الخامّانِ عندَ الكوميتِ `1d40c75e`:
//   docs/external-review/reports/M11.04-round-2-model-council-report-grok-4-6.md
//   docs/external-review/reports/M11.04-round-2-model-council-report-claude-opus-5-0.md
// ودمجُهما في: docs/external-review/M11.04-round-2-findings-matrix.md
//
// عقدُ هذا الملفِّ: **كلُّ اختبارٍ هنا كان يفشلُ قبلَ إصلاحِه**. لا يُخفَّفُ منه
// شرطٌ ليمرَّ، ولا يُغلَقُ به حكمُ مراجعةٍ: الأحكامُ الثمانيةُ تبقى `open` وحدَها
// بيدِ العضوينِ. وما يُثبِتُه هذا الملفُّ هو أن **إعادةَ الإنتاجِ لم تعُد تُنتِج**.
//
// ولا يلمسُ شيءٌ هنا توكناً حقيقياً ولا يولّدُ مفتاحاً ولا يُدوِّرُه: المصدرُ
// محقونٌ عبرَ `openSource` كما في `production-runtime.test.mjs`.

import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import {
  createCipheriv,
  createDecipheriv,
  generateKeyPairSync,
  randomBytes,
  sign as softwareSign,
} from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { describe } from 'node:test';
import { registerTmpRoot } from '../helpers/tmp-roots.mjs';

import {
  CommandLedger,
  CrownGateway,
  SEAL_IV_BYTES,
  assertRuntimeEnvDeclared,
  createProductionRootOfTrust,
  fingerprint,
  isProductionRuntime,
} from '../../src/root-of-trust/index.mjs';
import { loadEnvironmentContract } from '../../src/environment/contract.mjs';
import { resolveKeygenLogPath } from '../../scripts/pkcs11-f05-verify.mjs';

const SOURCE_DIR = new URL('../../src/root-of-trust/', import.meta.url);

/**
 * يُمسك الخطأ المرفوع ليُفحص رمزُه؛ `assert.throws` لا يعيد الخطأ.
 * @param fn - الدالةُ المتوقَّعُ فشلُها
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
 * نظيرُ `caught` للمسارِ غيرِ المتزامن.
 * @param fn - الدالةُ المتوقَّعُ رفضُها
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

/**
 * توكنٌ مزيَّفٌ يُعلن نفسَه `pkcs11-hsm`: المفاتيحُ فيه ولا يخرجُ إلا العامّ.
 * @param overrides - تبديلُ المفتاحِ أو الوصفِ لاختبارِ حالةٍ بعينِها
 * @returns موفّرٌ يحقّقُ عقدَ `HsmKeySource`
 */
function fakeToken(overrides = {}) {
  const aesKeys = new Map([['05', randomBytes(32)]]);
  const edKeys = new Map([
    ['06', overrides.king ?? generateKeyPairSync('ed25519')],
    ['07', generateKeyPairSync('ed25519')],
  ]);
  const aad = Buffer.from('xuux-event');
  return {
    describe: () =>
      overrides.description ?? {
        kind: 'pkcs11-hsm',
        canExport: false,
        tokenSerial: 'DEADBEEFCAFE0001',
      },
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
 * هويةُ الملكِ كما يشتقُّها `HsmSigner` من مفتاحِه العامّ.
 * @param pair - زوجُ مفاتيحِ الملك
 * @returns الهوية
 */
function kingIdOf(pair) {
  return 'king:' + fingerprint(pair.publicKey).slice(0, 24);
}

/**
 * بيئةُ إنتاجٍ مُثبَّتةٌ كاملةُ الشرطِ لمفتاحِ ملكٍ بعينِه.
 * @param king - زوجُ مفاتيحِ الملك
 * @param extra - زياداتٌ أو تبديلات
 * @returns البيئة
 */
function productionEnv(king, extra = {}) {
  return {
    NODE_ENV: 'production',
    XUUX_ROOT_OF_TRUST_MODE: 'hsm',
    XUUX_PKCS11_MODULE: '/usr/lib/softhsm/libsofthsm2.so',
    XUUX_PKCS11_TOKEN: 'xuux-test',
    XUUX_PKCS11_TOKEN_SERIAL: 'DEADBEEFCAFE0001',
    XUUX_PKCS11_MODULE_SHA256: 'f'.repeat(64),
    XUUX_PKCS11_PIN: 'fake-pin-not-used-by-injected-source', // secret-scan:allow
    XUUX_KING_ID: kingIdOf(king),
    XUUX_ROOT_OF_TRUST_PROVISION: '1',
    ...extra,
  };
}

/**
 * يُقلع تركيباً إنتاجياً بمصدرٍ محقونٍ في جذرٍ مؤقّتٍ (أو جذرٍ مُعطى).
 * @param options - الجذرُ والمفتاحُ وزياداتُ البيئة
 * @returns التركيبُ وجذرُه ومفتاحُه ودالةُ التنظيف
 */
async function boot(options = {}) {
  const root = options.root ?? registerTmpRoot(mkdtempSync(join(tmpdir(), 'xuux-r2-')));
  const king = options.king ?? generateKeyPairSync('ed25519');
  const token = options.token ?? fakeToken({ king });
  const runtime = await createProductionRootOfTrust(
    productionEnv(king, options.env ?? {}),
    { root, fsync: false },
    { openSource: async () => ({ source: token, close: async () => undefined }) },
  );
  return {
    runtime,
    root,
    king,
    cleanup: () => {
      runtime.log.close?.();
      rmSync(root, { recursive: true, force: true });
    },
  };
}

describe('UF-01 — لا إقلاعَ من GENESIS بلا مرساةٍ موثوقة', () => {
  test('محوُ السجلِّ ورأسِه معاً لا يُقرأُ نشأةً جديدةً بل يُرفَض', async () => {
    const first = await boot();
    const { root, king } = first;
    try {
      await first.runtime.log.appendSealed('royal.command', first.runtime.anchorSigner.id, {
        plan: 'أمرٌ أوّل',
      });
      const store = first.runtime.anchorStore ?? null;
      const { FileAnchorStore, anchorLogWithHsm } =
        await import('../../src/root-of-trust/index.mjs');
      const anchors = store ?? new FileAnchorStore(join(root, 'anchors.jsonl'), { fsync: false });
      await anchorLogWithHsm(anchors, first.runtime.anchorSigner, first.runtime.log);
      const logFile = first.runtime.log.file;
      const headFile = first.runtime.log.headFile;
      first.runtime.log.close?.();
      // إعادةُ الإنتاجِ حرفياً كما في التقريرَين: يُمحى الملفّانِ معاً.
      rmSync(logFile, { force: true });
      rmSync(headFile, { force: true });
      const error = await caughtAsync(() => boot({ root, king }));
      assert.equal(
        ['PRODUCTION_LOG_BEHIND_ANCHOR', 'PRODUCTION_ANCHOR_CHAIN_INVALID'].includes(error.code),
        true,
        `رمزٌ غيرُ متوقّع: ${error.code}`,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('محوُ بيانِ الجذرِ كلِّه لا يُقلعُ بلا إعلانِ تهيئةٍ صريح', async () => {
    const first = await boot();
    const { root, king } = first;
    try {
      first.runtime.log.close?.();
      rmSync(join(root, 'root-of-trust.manifest.json'), { force: true });
      const error = await caughtAsync(() =>
        boot({ root, king, env: { XUUX_ROOT_OF_TRUST_PROVISION: '' } }),
      );
      assert.equal(error.code, 'PRODUCTION_STATE_ROOT_UNPROVISIONED');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('مخزنُ المراسي لا يجوزُ أن يكونَ ملفَّ السجلِّ نفسَه', async () => {
    const root = registerTmpRoot(mkdtempSync(join(tmpdir(), 'xuux-r2-')));
    try {
      const king = generateKeyPairSync('ed25519');
      const error = await caughtAsync(() =>
        boot({ root, king, env: { XUUX_ANCHOR_STORE: join(root, 'events.log') } }),
      );
      assert.equal(error.code, 'ANCHOR_STORE_NOT_SEPARATE');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('UF-02 و UF-10 — مصدرُ المفاتيحِ يُحكَمُ بعقدِ الإنتاجِ لا بادّعائِه', () => {
  test('موفّرٌ ليس pkcs11-hsm يُرفَضُ ولو أعلن canExport:false', async () => {
    const king = generateKeyPairSync('ed25519');
    const liar = fakeToken({
      king,
      description: { kind: 'in-memory-opaque', canExport: false },
    });
    const error = await caughtAsync(() => boot({ king, token: liar }));
    // الرمزُ رمزُ «مخزنٌ برمجيٌّ ممنوعٌ في الإنتاج»: كلُّ ما ليس `pkcs11-hsm`
    // يُقرأُ مخزناً برمجياً مهما ادّعى في `canExport`.
    assert.equal(error.code, 'SOFTWARE_KEY_STORE_FORBIDDEN_IN_PRODUCTION');
    assert.equal(error.detail, 'in-memory-opaque');
  });

  test('canExport غيرُ مُعلَنٍ يُرفَض: الفحصُ على القيمةِ نصّاً لا على صدقيّتِها', async () => {
    const king = generateKeyPairSync('ed25519');
    const vague = fakeToken({ king, description: { kind: 'pkcs11-hsm' } });
    const error = await caughtAsync(() => boot({ king, token: vague }));
    assert.equal(error.code, 'EXPORTABLE_PROVIDER_FORBIDDEN_IN_PRODUCTION');
  });

  test('طفرةٌ: حذفُ نداءِ الحارسِ من المصنعِ يُفشِلُ هذا الملفَّ نصّاً', () => {
    const runtimeSource = readFileSync(new URL('production-runtime.mts', SOURCE_DIR), 'utf8');
    const bindingSource = readFileSync(new URL('hsm-binding.mts', SOURCE_DIR), 'utf8');
    // النتيجةُ الأصليةُ كانت: الحارسُ مكتوبٌ ومُختبَرٌ **ولا مصنعَ ينادِيه**.
    assert.ok(
      runtimeSource.includes('assertProductionKeyProviderAllowed('),
      'المصنعُ الإنتاجيُّ لا ينادي حارسَ الموفّر',
    );
    assert.ok(
      bindingSource.includes('assertProductionKeyProviderAllowed('),
      'الربطُ لا ينادي حارسَ الموفّر',
    );
  });
});

describe('UF-03 — محوُ ثلاثيةِ الإيقافِ لا يُعيدُ الحالةَ إلى running', () => {
  test('بعدَ إيقافٍ سياديٍّ: حذفُ التوجيهِ والتاريخِ والحقبةِ يبقى مغلقاً', async () => {
    const { runtime, cleanup } = await boot();
    try {
      const directive = await runtime.haltSwitch.haltAsync('إيقافٌ سياديّ');
      assert.equal(directive.state, 'halted');
      rmSync(runtime.haltSwitch.file, { force: true });
      rmSync(runtime.haltSwitch.historyFile, { force: true });
      rmSync(runtime.haltSwitch.epochFile, { force: true });
      const reading = runtime.haltSwitch.read();
      assert.notEqual(reading.state, 'running', 'محوُ الملفّاتِ أعادَ التشغيل');
      assert.equal(reading.epoch >= directive.epoch, true, 'العهدُ تراجَع');
    } finally {
      cleanup();
    }
  });

  test('حدُّ العهدِ يسكنُ خارجَ مجلَّدِ halt فلا يُمحى بمحوِه', async () => {
    const { runtime, root, cleanup } = await boot();
    try {
      await runtime.haltSwitch.haltAsync('إيقافٌ سياديّ');
      rmSync(join(root, 'halt'), { recursive: true, force: true });
      // صيغةُ البيانِ صارت مختومةً (‏`WL-098`): المتنُ تحتَ `body` والخاتَمُ
      // بجانبِه. الثابتُ المختبَرُ لم يتغيّر: العهدُ يسكنُ خارجَ `halt/`.
      const manifest = JSON.parse(readFileSync(join(root, 'root-of-trust.manifest.json'), 'utf8'));
      assert.equal(manifest.body.haltEpoch >= 1, true);
      assert.equal(typeof manifest.seal.signature, 'string');
      assert.notEqual(runtime.haltSwitch.read().state, 'running');
    } finally {
      cleanup();
    }
  });
});

describe('UF-04 و UF-09 — إعلانُ الوضعِ يُقرأُ فشلاً مغلقاً', () => {
  test('Production بحرفٍ كبيرٍ تُرفَضُ ولا تُقرأُ تطويراً', () => {
    const error = caught(() => isProductionRuntime({ NODE_ENV: 'Production' }));
    assert.equal(error.code, 'RUNTIME_ENV_INVALID');
    assert.equal(error.detail, 'NODE_ENV');
  });

  test('production بفراغٍ لاحقٍ تُرفَض', () => {
    assert.equal(
      caught(() => isProductionRuntime({ NODE_ENV: 'production ' })).code,
      'RUNTIME_ENV_INVALID',
    );
  });

  test('UF-09: قيمةٌ من فراغٍ غيابٌ لا حضورٌ فلا تحجبُ إعلانَ الإنتاج', () => {
    // كان الفراغُ يُقرأُ إعلاناً حاضراً، فـ`STATE_ENV=' '` تُلغي `NODE_ENV`
    // وتفتحُ المساراتِ البرمجيّة. الآن هو غيابٌ: يُقرأُ الإعلانُ التالي.
    assert.doesNotThrow(() => assertRuntimeEnvDeclared({ STATE_ENV: ' ' }));
    assert.equal(isProductionRuntime({ STATE_ENV: ' ', NODE_ENV: 'production' }), true);
  });

  test('القيمُ المُعلَنةُ وحدَها تعبُر', () => {
    assert.doesNotThrow(() => isProductionRuntime({ NODE_ENV: 'production' }));
    assert.doesNotThrow(() => isProductionRuntime({ STATE_ENV: 'ci', NODE_ENV: 'test' }));
    assert.equal(isProductionRuntime({ STATE_ENV: 'ci', NODE_ENV: 'production' }), false);
  });
});

describe('UF-05 — التوكنُ والملكُ مُثبَّتانِ فلا استبدالَ صامت', () => {
  test('توكنٌ برقمٍ تسلسليٍّ آخرَ يُرفَضُ ولو حملَ الاسمَ نفسَه', async () => {
    const king = generateKeyPairSync('ed25519');
    const other = fakeToken({
      king,
      description: { kind: 'pkcs11-hsm', canExport: false, tokenSerial: 'AAAABBBBCCCC9999' },
    });
    const error = await caughtAsync(() => boot({ king, token: other }));
    assert.equal(error.code, 'HSM_TOKEN_SERIAL_MISMATCH');
  });

  test('ملكٌ لا يطابقُ التثبيتَ يُرفَض', async () => {
    const king = generateKeyPairSync('ed25519');
    const impostor = generateKeyPairSync('ed25519');
    const error = await caughtAsync(() => boot({ king, token: fakeToken({ king: impostor }) }));
    assert.equal(error.code, 'KING_IDENTITY_PIN_MISMATCH');
  });

  test('بيانُ جذرٍ لملكٍ آخرَ يُرفَضُ ولو صحَّ التثبيتُ في البيئة', async () => {
    const first = await boot();
    const { root } = first;
    try {
      first.runtime.log.close?.();
      const second = generateKeyPairSync('ed25519');
      const error = await caughtAsync(() => boot({ root, king: second }));
      assert.equal(error.code, 'STATE_MANIFEST_KING_MISMATCH');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('غيابُ أيِّ متغيّرِ تثبيتٍ في الإنتاجِ يُغلِقُ الإقلاع', async () => {
    for (const name of ['XUUX_PKCS11_TOKEN_SERIAL', 'XUUX_PKCS11_MODULE_SHA256', 'XUUX_KING_ID']) {
      const king = generateKeyPairSync('ed25519');
      const error = await caughtAsync(() => boot({ king, env: { [name]: '' } }));
      assert.equal(error.code, 'HSM_PINNING_REQUIRED_IN_PRODUCTION', `لم يُرفض غيابُ ${name}`);
    }
  });
});

describe('UF-06 و UF-11 — ضماناتُ البوابةِ لا تُطفَأُ بخيارِ مُستدعٍ', () => {
  const PROD = Object.freeze({ NODE_ENV: 'production' });

  test('خيارٌ يُلغي الدفترَ في الإنتاجِ يُرفَضُ عندَ البناء', () => {
    const error = caught(
      () =>
        new CrownGateway(
          { id: 'king:x' },
          {},
          { append: () => undefined },
          { env: PROD, requireCommandLedger: false },
        ),
    );
    assert.match(
      error.message,
      /CROWN_GUARANTEE_CANNOT_BE_DISABLED_IN_PRODUCTION:requireCommandLedger/,
    );
  });

  test('خيارٌ يُلغي مفتاحَ الإيقافِ أو الساعةَ يُرفَضُ كذلك', () => {
    for (const name of ['requireHaltSwitch', 'requireTrustedClock']) {
      const error = caught(
        () =>
          new CrownGateway(
            { id: 'king:x' },
            {},
            { append: () => undefined },
            { env: PROD, [name]: false },
          ),
      );
      assert.match(error.message, new RegExp(`CANNOT_BE_DISABLED_IN_PRODUCTION:${name}`));
    }
  });

  test('STATE_ENV=production وحدَه يُلزِمُ الساعةَ — تعريفُ الإنتاجِ واحد', () => {
    const error = caught(
      () =>
        new CrownGateway(
          { id: 'king:x' },
          {},
          { append: () => undefined },
          { env: { STATE_ENV: 'production' }, requireTrustedClock: false },
        ),
    );
    assert.match(error.message, /requireTrustedClock/);
  });
});

describe('UF-07 و UF-13 — محوُ الدفترِ والحجوزاتِ يُكشَفُ لا يُقرأُ نقصاً', () => {
  test('محوُ الدفترِ ومجلَّدِ الحجوزاتِ معاً لا يُعيدُ قبولَ أمرٍ سابق', async () => {
    const { runtime, cleanup } = await boot();
    try {
      await runtime.ledger.recordSigned({ id: 'cmd-r2-01' });
      writeFileSync(runtime.ledger.file, '', 'utf8');
      rmSync(runtime.ledger.claimsDir, { recursive: true, force: true });
      const error = caught(() => runtime.ledger.load());
      assert.equal(error.code, 'LEDGER_BEHIND_WITNESS');
      assert.equal(
        caught(() => runtime.ledger.begin({ id: 'cmd-r2-01' })).code,
        'LEDGER_BEHIND_WITNESS',
      );
    } finally {
      cleanup();
    }
  });

  test('مجلَّدُ حجوزاتٍ مفقودٌ يُرفَعُ برمزِه لا بـENOENT خام', async () => {
    const { runtime, cleanup } = await boot();
    try {
      rmSync(runtime.ledger.claimsDir, { recursive: true, force: true });
      const error = caught(() => runtime.ledger.pendingClaims());
      assert.equal(error.code, 'LEDGER_STATE_ROOT_MISSING');
      assert.equal(error instanceof Error && error.code !== 'ENOENT', true);
    } finally {
      cleanup();
    }
  });

  test('في الإنتاجِ لا يُنشأُ جذرُ الدفترِ ضِمناً بلا تهيئةٍ مُعلَنة', () => {
    const root = registerTmpRoot(mkdtempSync(join(tmpdir(), 'xuux-r2-ledger-')));
    try {
      const error = caught(
        () =>
          new CommandLedger(join(root, 'missing', 'commands.ledger'), {
            env: { NODE_ENV: 'production' },
            fsync: false,
          }),
      );
      assert.equal(error.code, 'LEDGER_STATE_ROOT_MISSING');
      assert.equal(existsSync(join(root, 'missing')), false, 'أُنشئ المجلَّدُ ضِمناً');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('UF-08 — كلُّ متغيّرٍ يقرؤه جذرُ الثقةِ مُعلَنٌ في عقدِ البيئة', () => {
  test('لا متغيّرَ XUUX_* مقروءٌ في المصدرِ وغيرُ مُعلَنٍ في config/environment.yaml', async () => {
    const { readdirSync } = await import('node:fs');
    const declared = new Set(loadEnvironmentContract().variables.map((entry) => entry.id));
    const read = new Set();
    /**
     * يجمعُ أسماءَ `XUUX_*` المقروءةَ من شجرةِ مصادرَ.
     * @param dir - المجلَّدُ المفحوص
     */
    const walk = (dir) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(path);
          continue;
        }
        if (!/\.(mts|mjs)$/.test(entry.name) || entry.name.endsWith('.d.mts')) continue;
        for (const match of readFileSync(path, 'utf8').matchAll(/XUUX_[A-Z0-9_]+/g)) {
          read.add(match[0]);
        }
      }
    };
    walk(new URL('../../src', import.meta.url).pathname);
    const undeclared = [...read].filter((name) => !declared.has(name)).sort();
    assert.deepEqual(undeclared, [], `متغيّراتٌ مقروءةٌ وغيرُ مُعلَنة: ${undeclared.join(', ')}`);
  });
});

describe('UF-12 — كلُّ فشلٍ يُرفَعُ برمزٍ نطاقيٍّ مُعلَن', () => {
  test('تهيئةٌ ثانيةٌ للمكتبةِ تُغلَّفُ برمزِ النطاقِ لا تصلُ خاماً', async () => {
    const source = readFileSync(new URL('pkcs11-provider.mts', SOURCE_DIR), 'utf8');
    assert.ok(source.includes('CKR_CRYPTOKI_ALREADY_INITIALIZED'), 'لا تغليفَ للتهيئةِ الثانية');
    assert.ok(source.includes('ALREADY_INITIALIZED'), 'الرمزُ النطاقيُّ غيرُ معلَن');
    const { HsmErrorCodes } = await import('../../src/root-of-trust/pkcs11-provider.mjs');
    assert.ok(HsmErrorCodes.includes('ALREADY_INITIALIZED'));
    assert.ok(HsmErrorCodes.includes('MODULE_FINGERPRINT_MISMATCH'));
  });
});

describe('UF-14 — طلبُ اختبارِ التوكنِ الحقيقيِّ عقدٌ لا رغبة', () => {
  test('الملفُّ لا يتخطّى بصمتٍ حين يُطلَبُ تشغيلُه صراحةً', () => {
    const source = readFileSync(
      new URL('production-runtime-softhsm.test.mjs', import.meta.url),
      'utf8',
    );
    assert.ok(
      !/const skip = !ENABLED \|\| !softhsmAvailable\(\)/.test(source),
      'التخطّي ما زال يبتلعُ غيابَ البيئةِ مع طلبٍ صريح',
    );
    assert.ok(source.includes('const skip = !ENABLED;'), 'شرطُ التخطّي ليس الإعلانَ وحدَه');
    assert.ok(source.includes('setupError'), 'فشلُ التهيئةِ ما زال يُطبَعُ ويُنسى');
  });
});

describe('UF-15 — تعريفُ الإنتاجِ واحدٌ في المشروعِ كلِّه', () => {
  test('STATE_ENV فارغةٌ مع NODE_ENV=production تُرفَضُ وصلةٌ بلا TLS', async () => {
    const { resolveDatabaseConfig } = await import('../../src/persistence/db.mjs');
    const previousState = process.env.STATE_ENV;
    const previousNode = process.env.NODE_ENV;
    process.env.STATE_ENV = '';
    process.env.NODE_ENV = 'production';
    try {
      const error = caught(() =>
        resolveDatabaseConfig({ url: 'postgres://u:p@db.example.com:5432/xuux' }),
      );
      assert.equal(error.code, 'DB_INSECURE_IN_PRODUCTION');
    } finally {
      if (previousState === undefined) delete process.env.STATE_ENV;
      else process.env.STATE_ENV = previousState;
      if (previousNode === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previousNode;
    }
  });
});

describe('UF-16 — أمرُ hsm:verify:f05 قابلٌ للنجاحِ بعقدِه المُعلَن', () => {
  test('ترتيبُ الأولويّةِ: العَلَمُ ثم المتغيّرُ ثم الافتراضيُّ', () => {
    assert.equal(
      resolveKeygenLogPath({ XUUX_KEYGEN_LOG: 'from/env.log' }, ['--keygen-log', 'from/flag.log']),
      'from/flag.log',
    );
    assert.equal(resolveKeygenLogPath({ XUUX_KEYGEN_LOG: 'from/env.log' }, []), 'from/env.log');
    assert.equal(resolveKeygenLogPath({}, []), 'artifacts/hsm/keygen.log');
  });

  test('سكربتُ npm يُمرِّرُ الوسيطَ الذي يشترطُه السكربت', () => {
    const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
    assert.match(pkg.scripts['hsm:verify:f05'], /--keygen-log\s+\S+/);
  });
});
