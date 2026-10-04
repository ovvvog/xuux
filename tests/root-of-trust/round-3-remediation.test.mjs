// @ts-nocheck
// tests/root-of-trust/round-3-remediation.test.mjs
//
// مجَسّاتٌ خصميّةٌ **مركَّبةٌ** لنتائجِ الجولةِ الثالثة — WL-098.
//
// المصدرُ الوحيدُ لهذه المجَسّاتِ هو تقريرُ العضوِ «أ» الخامُّ عندَ `d86014d9`:
//   docs/external-review/reports/M11.04-round-3-model-council-report-gpt-5-6-terra.md
// وفيه أنّ **تخفيضَ قيمِ البيانِ مع حذفِ الملفّاتِ التابعةِ معاً** كان يفتحُ
// ثلاثةَ أبوابٍ زُعِمَ سدُّها: إعادةَ السجلِّ من `GENESIS` (‏`UF-01`)، وعودةَ
// `halted` إلى `running` بعهدٍ صفرٍ (‏`UF-03`)، وقبولَ أمرٍ مكرَّرٍ بعدَ تخفيضِ
// عدَّ المُثبَّتِ (‏`UF-07`). وأصلُ الثلاثةِ نتيجةٌ واحدةٌ سُجِّلت `R3-A-01`:
// البيانُ كان JSON بلا خاتَمٍ، فمن ملكَ القرصَ ملكَ الشاهدَ.
//
// عقدُ هذا الملفِّ:
//   • **كلُّ اختبارٍ هنا كان يفشلُ على `84c792d9`** — ويفشلُ بمعنىً أمنيٍّ لا
//     بخطإِ استيرادٍ: كلُّ ما يُستورَدُ هنا (`createProductionRootOfTrust`،
//     `FileAnchorStore`، `anchorLogWithHsm`، `fingerprint`، `SEAL_IV_BYTES`)
//     كان مُصدَّراً عندَ ذلك الكوميتِ نفسِه، والعبثُ بالبيانِ يقعُ على ملفِّ
//     JSON بمساره لا على واجهةٍ جديدة.
//   • لا يُخفَّفُ شرطٌ ليمرَّ، ولا يُغلَقُ به حكمُ مراجعةٍ: أحكامُ الجولتينِ
//     تبقى `open` بيدِ الأعضاءِ وحدَهم.
//   • ولا يلمسُ شيءٌ هنا توكناً حقيقياً ولا يولّدُ مفتاحاً ولا يُدوِّرُه: المصدرُ
//     محقونٌ عبرَ `openSource`. ومسارُ التوكنِ الحقيقيِّ في ملفِّه المستقلِّ
//     `production-runtime-softhsm.test.mjs`.
//
// **حدٌّ يُصرَّحُ به ولا يُخفى:** استرجاعُ لقطةٍ كاملةٍ متّسقةٍ (البيانُ المختومُ
// وكلُّ الملفّاتِ التابعةِ وحالةُ التوكنِ) لا يُكشَفُ محلياً، وصحّةُ التوقيعِ
// **ليست** حمايةً من الإعادة. التفصيلُ في
// `docs/adr/0006-state-manifest-seal-and-anti-rollback-limit.md`، ومجَسُّ «الاسترجاعِ الجزئيِّ»
// أدناه يختبرُ ما يُكشَفُ فعلاً لا ما نتمنّاه.

import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import {
  createCipheriv,
  createDecipheriv,
  generateKeyPairSync,
  randomBytes,
  sign as softwareSign,
} from 'node:crypto';
import {
  appendFileSync,
  copyFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { describe } from 'node:test';
import { registerTmpRoot } from '../helpers/tmp-roots.mjs';

import {
  FileAnchorStore,
  SEAL_IV_BYTES,
  anchorLogWithHsm,
  createProductionRootOfTrust,
  InMemoryFreshnessSocket,
  fingerprint,
} from '../../src/root-of-trust/index.mjs';
import { registerTestKing, royalCommandFor, royalKeyEnv } from '../helpers/royal-halt-command.mjs';

/** `LIVE-24`: مفتاحٌ ملكيٌّ مستقلٌّ عن مفتاحِ المرساةِ في التوكن. */
const ROYAL_KEY = royalKeyEnv();

const MANIFEST = 'root-of-trust.manifest.json';
const JOURNAL = 'root-of-trust.manifest.journal';

/**
 * نظيرُ `assert.throws` يُعيدُ الخطأَ ليُفحَصَ رمزُه.
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
 * @param overrides - تبديلُ مفتاحِ الملكِ أو الوصف
 * @returns موفّرٌ يحقّقُ عقدَ `HsmKeySource`
 */
function fakeToken(overrides = {}) {
  const aesKeys = new Map([['05', randomBytes(32)]]);
  const edKeys = new Map([
    ['06', overrides.king ?? registerTestKing(generateKeyPairSync('ed25519'))],
    ['07', registerTestKing(generateKeyPairSync('ed25519'))],
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
    STATE_ENV: 'production',
    XUUX_ROOT_OF_TRUST_MODE: 'hsm',
    XUUX_PKCS11_MODULE: '/usr/lib/softhsm/libsofthsm2.so',
    XUUX_PKCS11_TOKEN: 'xuux-test',
    XUUX_PKCS11_TOKEN_SERIAL: 'DEADBEEFCAFE0001',
    XUUX_PKCS11_MODULE_SHA256: 'f'.repeat(64),
    XUUX_PKCS11_PIN: 'fake-pin-not-used-by-injected-source', // secret-scan:allow
    XUUX_KING_ID: kingIdOf(king),
    ...ROYAL_KEY.env,
    XUUX_ROOT_OF_TRUST_PROVISION: '1',
    ...extra,
  };
}

/**
 * يُقلع تركيباً إنتاجياً بمصدرٍ محقونٍ في جذرٍ مؤقّتٍ أو جذرٍ مُعطى.
 * @param options - الجذرُ والمفتاحُ وزياداتُ البيئة
 * @returns التركيبُ وجذرُه ومفتاحُه ودالةُ التنظيف
 */
async function boot(options = {}) {
  const root = options.root ?? registerTmpRoot(mkdtempSync(join(tmpdir(), 'xuux-r3-')));
  const king = options.king ?? registerTestKing(generateKeyPairSync('ed25519'));
  const token = options.token ?? fakeToken({ king });
  const freshnessSocket = options.freshnessSocket ?? new InMemoryFreshnessSocket(0n, 'r3');
  const runtime = await createProductionRootOfTrust(
    productionEnv(king, options.env ?? {}),
    { root, fsync: false, freshnessSocket },
    { openSource: async () => ({ source: token, close: async () => undefined }) },
  );
  return {
    runtime,
    root,
    king,
    freshnessSocket,
    cleanup: () => {
      runtime.log.close?.();
      rmSync(root, { recursive: true, force: true });
    },
  };
}

/**
 * يقرأُ ملفَّ البيانِ كما هو على القرص.
 * @param root - جذرُ الحالة
 * @returns الملفُّ محلَّلاً
 */
function readManifest(root) {
  return JSON.parse(readFileSync(join(root, MANIFEST), 'utf8'));
}

/**
 * يُخفِّضُ حقلاً في متنِ البيانِ ويُبقي الخاتَمَ كما هو — عينُ ما فعلَ العضو «أ».
 * @param root - جذرُ الحالة
 * @param key - الحقلُ المُخفَّض
 * @param value - القيمةُ الجديدة
 */
function lowerField(root, key, value) {
  const file = readManifest(root);
  // صيغةُ ما قبلَ الختمِ كانت حقولاً في الجذرِ، وصيغةُ الآنِ متنٌ وخاتَمٌ.
  // المجَسُّ يعبثُ بالموضعينِ كي يعملَ على الكوميتِ القديمِ والجديدِ سواءً.
  if (file.body !== undefined) file.body[key] = value;
  else file[key] = value;
  writeFileSync(join(root, MANIFEST), JSON.stringify(file, null, 2) + '\n', 'utf8');
}

describe('R3-A-01 — بيانُ الجذرِ مختومٌ داخلَ التوكنِ فلا يُخفَّضُ بتحرير', () => {
  test('البيانُ المكتوبُ يحملُ خاتَماً ومتناً مربوطاً بالهويةِ والسياقِ والإصدار', async () => {
    const first = await boot({ env: { XUUX_STATE_CONTEXT: 'probe-context' } });
    try {
      const file = readManifest(first.root);
      assert.equal(file.body.version, 2, 'الإصدارُ ليس في المتنِ الموقَّع');
      assert.equal(file.body.kingId, first.runtime.anchorSigner.id);
      assert.equal(file.body.context, 'probe-context');
      assert.equal(file.body.tokenSerial, 'DEADBEEFCAFE0001');
      assert.equal(file.body.moduleSha256, 'f'.repeat(64));
      assert.equal(file.seal.alg, 'ed25519');
      assert.equal(typeof file.seal.signature, 'string');
      assert.ok(file.seal.signature.length > 0, 'خاتَمٌ فارغٌ ليس خاتَماً');
      // ولا مادةَ سرٍّ في الملفِّ: الخاتَمُ توقيعٌ لا مفتاح.
      const text = readFileSync(join(first.root, MANIFEST), 'utf8');
      assert.equal(/PRIVATE KEY/.test(text), false);
    } finally {
      first.cleanup();
    }
  });

  test('تغييرُ سياقِ النشرِ على جذرٍ قائمٍ يُرفَضُ ولا يُقبَلُ صامتاً', async () => {
    const first = await boot({ env: { XUUX_STATE_CONTEXT: 'أوّل' } });
    const { root, king } = first;
    try {
      first.runtime.log.close?.();
      const error = await caughtAsync(() =>
        boot({
          root,
          king,
          freshnessSocket: first.freshnessSocket,
          env: { XUUX_STATE_CONTEXT: 'ثانٍ' },
        }),
      );
      assert.equal(error.code, 'STATE_MANIFEST_BINDING_MISMATCH');
      assert.equal(error.detail, 'context');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('بيانٌ بصيغةِ ما قبلَ الختمِ (بلا خاتَمٍ) لا يُقبَلُ ولا يُرقَّى ضمناً', async () => {
    const first = await boot();
    const { root, king } = first;
    try {
      const file = readManifest(root);
      first.runtime.log.close?.();
      // الصيغةُ الأولى حرفياً: حقولٌ في الجذرِ بلا خاتَم.
      writeFileSync(
        join(root, MANIFEST),
        JSON.stringify({ version: 1, ...file.body, seal: undefined }, null, 2) + '\n',
        'utf8',
      );
      const error = await caughtAsync(() =>
        boot({ root, king, freshnessSocket: first.freshnessSocket }),
      );
      assert.equal(error.code, 'STATE_MANIFEST_SEAL_MISSING');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('UF-01 مركَّبٌ — تخفيضُ عدِّ المُثبَّتِ مع حذفِ السجلِّ ومخزنِ المراسي', () => {
  test('لا يُقرأُ نشأةً جديدةً بل يُرفَضُ الإقلاعُ مغلقاً', async () => {
    const first = await boot();
    const { root, king } = first;
    try {
      await first.runtime.log.appendSealed('royal.command', first.runtime.anchorSigner.id, {
        plan: 'أمرٌ أوّل',
      });
      const anchors = new FileAnchorStore(join(root, 'anchors.jsonl'), { fsync: false });
      await first.runtime.commitBarrier.run('anchor', () =>
        anchorLogWithHsm(anchors, first.runtime.anchorSigner, first.runtime.log),
      );
      const logFile = first.runtime.log.file;
      const headFile = first.runtime.log.headFile;
      first.runtime.log.close?.();
      // إقلاعٌ ثانٍ نظيفٌ: عندَه يشهدُ البيانُ بعددِ المُثبَّتِ ويُختَمُ عليه.
      const second = await boot({ root, king, freshnessSocket: first.freshnessSocket });
      assert.equal(readManifest(root).body.anchoredCount >= 1, true, 'البيانُ لم يشهدْ بالتثبيت');
      second.runtime.log.close?.();
      // المجَسُّ المركَّبُ كما نفَّذه العضوُ «أ»: تخفيضُ الشاهدِ **ثمَّ** حذفُ
      // كلِّ ما يشهدُ عليه. قبلَ الختمِ كان هذا إقلاعاً ناجحاً من `GENESIS`.
      lowerField(root, 'anchoredCount', 0);
      rmSync(logFile, { force: true });
      rmSync(headFile, { force: true });
      rmSync(join(root, 'anchors.jsonl'), { force: true });
      const error = await caughtAsync(() =>
        boot({ root, king, freshnessSocket: first.freshnessSocket }),
      );
      assert.equal(
        error.code,
        'STATE_MANIFEST_SEAL_INVALID',
        `رمزٌ غيرُ متوقّع: ${error.code} — تخفيضُ البيانِ لم يُكشَفْ بالخاتَم`,
      );
      // ولا يُنشأُ سجلٌّ جديدٌ نتيجةَ المحاولةِ: الرفضُ قبلَ أيِّ كتابة.
      assert.equal(existsSync(logFile), false, 'أُنشئ سجلٌّ جديدٌ بعدَ الرفض');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('UF-03 مركَّبٌ — تخفيضُ عهدِ الإيقافِ مع محوِ مجلَّدِ الإيقاف', () => {
  test('لا عودةَ إلى running ولا إلى عهدٍ صفرٍ بل رفضٌ مغلق', async () => {
    const first = await boot();
    const { root, king } = first;
    try {
      const directive = await first.runtime.haltSwitch.haltAsync(
        'إيقافٌ سياديّ',
        royalCommandFor(first.runtime.haltSwitch, 'halt', 'إيقافٌ سياديّ'),
      );
      assert.equal(directive.state, 'halted');
      // بعدَ التوجيهِ الموقَّعِ صارَ العهدُ **داخلَ المتنِ المختومِ** لا في دفترٍ
      // معلَّقٍ: `sealEpoch` يختمُ حيثُ يجوزُ الانتظار.
      assert.equal(readManifest(root).body.haltEpoch >= directive.epoch, true);
      first.runtime.log.close?.();
      lowerField(root, 'haltEpoch', 0);
      rmSync(join(root, 'halt'), { recursive: true, force: true });
      const error = await caughtAsync(() =>
        boot({ root, king, freshnessSocket: first.freshnessSocket }),
      );
      assert.equal(error.code, 'STATE_MANIFEST_SEAL_INVALID', `رمزٌ غيرُ متوقّع: ${error.code}`);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('UF-07 مركَّبٌ — تخفيضُ عدِّ المُقرَّرِ مع محوِ الدفترِ وحجوزاتِه', () => {
  test('لا يُقبَلُ أمرٌ مكرَّرٌ لأن الإقلاعَ نفسَه يُرفَض', async () => {
    const first = await boot();
    const { root, king } = first;
    try {
      const command = { id: 'أمرٌ-مكرَّر' };
      await first.runtime.ledger.beginAsync(command);
      await first.runtime.ledger.commitSigned(command, 'تمّ');
      assert.equal(readManifest(root).body.ledgerCommitted >= 1, true);
      const ledgerFile = first.runtime.ledger.file;
      first.runtime.log.close?.();
      lowerField(root, 'ledgerCommitted', 0);
      rmSync(ledgerFile, { force: true });
      rmSync(first.runtime.ledger.claimsDir, { recursive: true, force: true });
      const error = await caughtAsync(() =>
        boot({ root, king, freshnessSocket: first.freshnessSocket }),
      );
      assert.equal(error.code, 'STATE_MANIFEST_SEAL_INVALID', `رمزٌ غيرُ متوقّع: ${error.code}`);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('استبدالُ البيانِ بنسخةٍ أقدمَ صحيحةِ الخاتَم', () => {
  test('استرجاعٌ جزئيٌّ (بيانٌ أقدمُ وملفّاتٌ أحدثُ) يُكشَفُ ولا يعودُ running', async () => {
    const first = await boot();
    const { root, king } = first;
    const snapshot = join(root, 'manifest.snapshot');
    try {
      // لقطةٌ للبيانِ المختومِ **قبلَ** الإيقافِ: توقيعُها صحيحٌ إلى الأبد.
      copyFileSync(join(root, MANIFEST), snapshot);
      const directive = await first.runtime.haltSwitch.haltAsync(
        'إيقافٌ سياديّ',
        royalCommandFor(first.runtime.haltSwitch, 'halt', 'إيقافٌ سياديّ'),
      );
      first.runtime.log.close?.();
      copyFileSync(snapshot, join(root, MANIFEST));
      rmSync(snapshot, { force: true });
      // الحكمُ الأمنيُّ المطلوبُ: لا عودةَ إلى `running`. إمّا رفضُ الإقلاعِ،
      // وإمّا إقلاعٌ يبقى فيه الإيقافُ قائماً بشهادةِ ملفّاتِ التوجيهِ الأحدثِ.
      let refused = null;
      let state = null;
      try {
        const second = await boot({ root, king, freshnessSocket: first.freshnessSocket });
        state = second.runtime.haltSwitch.read();
        second.runtime.log.close?.();
      } catch (error) {
        refused = error;
      }
      if (refused !== null) {
        assert.equal(typeof refused.code, 'string');
        assert.ok(
          refused.code.startsWith('STATE_MANIFEST_') || refused.code.startsWith('PRODUCTION_'),
          `رمزٌ غيرُ نطاقيّ: ${refused.code}`,
        );
      } else {
        assert.notEqual(state.state, 'running', 'استرجاعُ بيانٍ أقدمَ أعادَ التشغيل');
        assert.equal(state.epoch >= directive.epoch, true, 'العهدُ تراجَعَ بالاسترجاع');
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('بيانٌ مُنشأٌ مسبقاً بهويةٍ مختلفة', () => {
  test('بيانُ ملكٍ آخرَ في جذرٍ فارغٍ يُرفَضُ ولو أُعلِنَ إذنُ التهيئة', async () => {
    const other = await boot();
    const stolen = readFileSync(join(other.root, MANIFEST), 'utf8');
    other.cleanup();
    const root = registerTmpRoot(mkdtempSync(join(tmpdir(), 'xuux-r3-')));
    try {
      writeFileSync(join(root, MANIFEST), stolen, 'utf8');
      const error = await caughtAsync(() => boot({ root }));
      assert.equal(error.code, 'STATE_MANIFEST_KING_MISMATCH', `رمزٌ غيرُ متوقّع: ${error.code}`);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('حذفُ البيانِ والملفّاتِ التابعةِ معاً', () => {
  test('محوٌ شاملٌ يُرفَضُ ولا يُقرأُ GENESIS بلا إعلانِ تهيئةٍ صريح', async () => {
    const first = await boot();
    const { root, king } = first;
    try {
      await first.runtime.log.appendSealed('royal.command', first.runtime.anchorSigner.id, {
        plan: 'أمرٌ أوّل',
      });
      const command = { id: 'أمرٌ-قبلَ-المحو' };
      await first.runtime.ledger.beginAsync(command);
      await first.runtime.ledger.commitSigned(command, 'تمّ');
      await first.runtime.haltSwitch.haltAsync(
        'إيقافٌ قبلَ المحو',
        royalCommandFor(first.runtime.haltSwitch, 'halt', 'إيقافٌ قبلَ المحو'),
      );
      const logFile = first.runtime.log.file;
      const headFile = first.runtime.log.headFile;
      const ledgerFile = first.runtime.ledger.file;
      first.runtime.log.close?.();
      // محوٌ شاملٌ: البيانُ ودفترُ رفعِه والسجلُّ ورأسُه والدفترُ والإيقاف.
      for (const path of [join(root, MANIFEST), join(root, JOURNAL), logFile, headFile, ledgerFile])
        rmSync(path, { force: true });
      rmSync(join(root, 'halt'), { recursive: true, force: true });
      rmSync(first.runtime.ledger.claimsDir, { recursive: true, force: true });
      const error = await caughtAsync(() =>
        boot({
          root,
          king,
          freshnessSocket: first.freshnessSocket,
          env: { XUUX_ROOT_OF_TRUST_PROVISION: '' },
        }),
      );
      assert.equal(error.code, 'PRODUCTION_STATE_ROOT_UNPROVISIONED');
      assert.equal(existsSync(logFile), false, 'أُنشئ سجلٌّ جديدٌ بعدَ الرفض');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('دفترُ الرفعِ مُسلسَلٌ بالتجزئةِ فلا يُدَسُّ فيه سطرٌ', () => {
  test('سطرٌ مُلحَقٌ بتجزئةٍ مُختلَقةٍ يُرفَضُ عندَ الإقلاع', async () => {
    const first = await boot();
    const { root, king } = first;
    try {
      first.runtime.log.close?.();
      appendFileSync(
        join(root, JOURNAL),
        JSON.stringify({
          seq: 99,
          key: 'anchoredCount',
          value: 9_000,
          at: new Date().toISOString(),
          prev: 'مُختلَق',
          hash: 'مُختلَق',
        }) + '\n',
        'utf8',
      );
      const error = await caughtAsync(() =>
        boot({ root, king, freshnessSocket: first.freshnessSocket }),
      );
      assert.equal(
        ['STATE_MANIFEST_JOURNAL_INVALID', 'STATE_MANIFEST_ROLLBACK_DETECTED'].includes(error.code),
        true,
        `رمزٌ غيرُ متوقّع: ${error.code}`,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('طفراتٌ نصّيّةٌ — لا يُنزَعُ الختمُ بصمتٍ في تعديلٍ لاحق', () => {
  test('المصنعُ الإنتاجيُّ يُمرِّرُ موقّعَ التوكنِ خاتَماً للبيان', () => {
    const source = readFileSync(
      new URL('../../src/root-of-trust/production-runtime.mts', import.meta.url),
      'utf8',
    );
    assert.ok(source.includes('sealer: signers.anchorSigner'), 'البيانُ يُبنى بلا خاتَم');
    assert.ok(source.includes('provisionAsync('), 'الإقلاعُ لا يتحقّقُ من الخاتَمِ قبلَ الثقة');
  });

  test('البيانُ يوقّعُ داخلَ التوكنِ ولا يوقّعُ برمجياً في العمليّة', () => {
    const source = readFileSync(
      new URL('../../src/root-of-trust/state-manifest.mts', import.meta.url),
      'utf8',
    );
    assert.ok(source.includes('signAsync('), 'الختمُ لا يُنادي توقيعَ التوكن');
    for (const forbidden of ['generateKeyPairSync', 'createPrivateKey', 'privateKey']) {
      assert.equal(
        source.includes(forbidden),
        false,
        `مادةُ مفتاحٍ برمجيّةٌ في وحدةِ البيان: ${forbidden}`,
      );
    }
  });
});
