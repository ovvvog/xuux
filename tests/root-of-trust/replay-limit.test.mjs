// @ts-nocheck
// tests/root-of-trust/replay-limit.test.mjs
//
// شاهدُ الحدِّ الأمنيِّ — WL-099، **وقد انقلبَ بعقدِه** (‏`WL-285`، ومُوثَّقٌ في
// `WL-312` جواباً عن `R10-F-03`).
//
// كانَ هذا الملفُّ يُثبِتُ **حدّاً**: أنّ استرجاعَ لقطةٍ كاملةٍ متّسقةٍ لجذرِ الحالةِ
// (البيانُ المختومُ ودفترُ رفعِه والسجلُّ والدفترُ ومجلَّدُ الإيقافِ) **ينجحُ**، لأنّ
// الخاتَمَ وقّعَ تلك الحالةَ بنفسِه فلا يكشفُها التوقيع.
//
// **عقدُ التعديلِ** في `ADR 0006` نصَّ على أنّ منعَ إعادةٍ إن نُفِّذَ فهذا الشاهدُ
// يجبُ أن يفشلَ ولا يُصحَّحُ إلّا معَ تحديثِ القرار. **وقد نُفِّذَ منعٌ بشرطٍ:**
// مقبسُ الحداثةِ `FreshnessSocket` (‏`WL-285`) يُقارِنُ عهدَ البيانِ بمرجعٍ خارجَ
// اللقطةِ، فصارَت الشواهدُ أدناه تُثبِتُ **الرفضَ** بـ`STALE_MANIFEST_EPOCH` على
// مقبسٍ ذاكريٍّ (‏`InMemoryFreshnessSocket`). وتحديثُ القرارِ في قسمِ «انقلابُ
// الشاهدِ بمقبسِ الحداثةِ — `WL-312`» من `ADR 0006`.
//
// **وحدُّ هذا الانقلابِ مُعلَنٌ لا مستورٌ:** المقبسُ هنا بديلُ اختبارٍ داخلَ العمليّة،
// ولا مرجعَ حداثةٍ إنتاجيٌّ واحدٌ قائمٌ (‏`scripts/production-entry.mjs`:
// `SUPPORTED_FRESHNESS_BACKENDS` فارغةٌ — `R10-F-02`/`EXT-6`)، فالحدُّ في الإنتاجِ
// الحقيقيِّ **لم يُرفَعْ بعدُ**؛ وهذا الملفُّ لا يُغلِقُ `R3-A-01` ولا يُخفِّفُ حكمَه —
// الأحكامُ للمجلس.
//
// والتفصيلُ في `docs/adr/0006-state-manifest-seal-and-anti-rollback-limit.md`،
// والنصوصُ الخامّةُ لما قبلَ المقبسِ — بمصدرٍ محقونٍ **وعلى SoftHSM حقيقيٍّ** — في
// `docs/external-review/evidence/WL-099-full-snapshot-replay.md`.
//
// **وضُيِّقَ الحدُّ بشطرٍ مقيسٍ في `WL-237`:** اللقطةُ **الجزئيّةُ** — بيانٌ أقدمُ
// معَ محوِ السجلِّ — مردودةٌ في الإنتاجِ بـ`LOG_STATE_ROOT_MISSING`، وبـ
// `STALE_MANIFEST_EPOCH` حيثُ يُوصَلُ المقبسُ (‏قسمُ `S13` أدناه). والحدّانِ مُثبَّتانِ معاً هنا
// **قصداً** فلا يتّسعُ أحدُهما صامتاً على الآخر.

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
  cpSync,
  existsSync,
  mkdirSync,
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
  ProductionRuntimeErrorCodes,
  SEAL_IV_BYTES,
  assertSealedLogPresentOnExistingRoot,
  createProductionRootOfTrust,
  fingerprint,
  inspectEventLog,
  InMemoryFreshnessSocket,
} from '../../src/root-of-trust/index.mjs';
import { registerTestKing, royalCommandFor, royalKeyEnv } from '../helpers/royal-halt-command.mjs';

/** `LIVE-24`: مفتاحٌ ملكيٌّ مستقلٌّ عن مفتاحِ المرساةِ في التوكن. */
const ROYAL_KEY = royalKeyEnv();

const MANIFEST = 'root-of-trust.manifest.json';
const JOURNAL = 'root-of-trust.manifest.journal';

/**
 * توكنٌ مزيَّفٌ **ثابتُ المفاتيحِ** عبرَ الإقلاعاتِ — نظيرُ توكنٍ لم يُبدَّل.
 * @param king - زوجُ مفاتيحِ الملك
 * @param aeadKey - مفتاحُ الختمِ المتماثلُ الثابت
 * @param ledgerPair - مفتاحُ توقيعِ الدفترِ الثابت
 * @returns موفّرٌ يحقّقُ عقدَ `HsmKeySource`
 */
function stableToken(king, aeadKey, ledgerPair) {
  const aad = Buffer.from('xuux-event');
  const ed = new Map([
    ['06', king],
    ['07', ledgerPair],
  ]);
  return {
    describe: () => ({ kind: 'pkcs11-hsm', canExport: false, tokenSerial: 'DEADBEEFCAFE0001' }),
    getAeadKey: async (keyId) => {
      if (keyId !== '05') throw new Error('KEY_NOT_FOUND');
      return {
        keyId,
        encrypt: async (plaintext) => {
          const iv = randomBytes(SEAL_IV_BYTES);
          const cipher = createCipheriv('aes-256-gcm', aeadKey, iv);
          cipher.setAAD(aad);
          const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
          return { ciphertext, iv, tag: cipher.getAuthTag() };
        },
        decrypt: async (ciphertext, iv, tag) => {
          const decipher = createDecipheriv('aes-256-gcm', aeadKey, iv);
          decipher.setAAD(aad);
          decipher.setAuthTag(tag);
          return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
        },
      };
    },
    getSigningKey: async (keyId) => {
      const pair = ed.get(keyId);
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
 * جهازٌ ثابتُ الهويةِ يُقلعُ الجذرَ نفسَه مرّاتٍ متعدّدةً.
 * @returns دالةُ الإقلاعِ ودالةُ قراءةِ المتنِ
 */
function rig() {
  const king = registerTestKing(generateKeyPairSync('ed25519'));
  const aeadKey = randomBytes(32);
  const ledgerPair = registerTestKing(generateKeyPairSync('ed25519'));
  const env = {
    NODE_ENV: 'production',
    STATE_ENV: 'production',
    XUUX_ROOT_OF_TRUST_MODE: 'hsm',
    XUUX_PKCS11_MODULE: '/usr/lib/softhsm/libsofthsm2.so',
    XUUX_PKCS11_TOKEN: 'xuux-test',
    XUUX_PKCS11_TOKEN_SERIAL: 'DEADBEEFCAFE0001',
    XUUX_PKCS11_MODULE_SHA256: 'f'.repeat(64),
    XUUX_PKCS11_PIN: 'unused-by-injected-source', // secret-scan:allow
    XUUX_KING_ID: 'king:' + fingerprint(king.publicKey).slice(0, 24),
    ...ROYAL_KEY.env,
    XUUX_ROOT_OF_TRUST_PROVISION: '1',
  };
  const freshnessSocket = new InMemoryFreshnessSocket(0n, 'replay');
  const boot = (root) =>
    createProductionRootOfTrust(
      env,
      { root, fsync: false, freshnessSocket },
      {
        openSource: async () => ({
          source: stableToken(king, aeadKey, ledgerPair),
          close: async () => undefined,
        }),
      },
    );
  return { boot, body: (root) => JSON.parse(readFileSync(join(root, MANIFEST), 'utf8')).body };
}

describe('حدُّ الإعادةِ — لقطةٌ كاملةٌ متّسقةٌ لا يكشفُها الخاتَم (لكنَّ الحداثةَ تكشفُها)', () => {
  test('استرجاعُ الجذرِ كلِّه بعدَ تقدّمِ الحداثةِ → REJECT (STALE_MANIFEST_EPOCH)', async () => {
    const { boot, body } = rig();
    const root = registerTmpRoot(mkdtempSync(join(tmpdir(), 'xuux-replay-')));
    const snapshot = registerTmpRoot(mkdtempSync(join(tmpdir(), 'xuux-replay-snap-')));
    try {
      const first = await boot(root);
      first.log.close?.();

      // لقطةٌ **كاملةٌ** للجذرِ عندَ زمنٍ صحيحٍ.
      rmSync(snapshot, { recursive: true, force: true });
      cpSync(root, snapshot, { recursive: true });

      // تقدّمُ الحالةِ: أمرٌ موقَّعٌ ثمَّ إيقافٌ سياديٌّ موقَّع.
      const second = await boot(root);
      const command = { id: 'أمرٌ-قابلٌ-للإعادة' };
      await second.ledger.beginAsync(command);
      await second.ledger.commitSigned(command, 'تمّ');
      const directive = await second.haltSwitch.haltAsync(
        'إيقافٌ سياديّ',
        royalCommandFor(second.haltSwitch, 'halt', 'إيقافٌ سياديّ'),
      );
      assert.equal(directive.state, 'halted');
      assert.equal(body(root).haltEpoch >= 1, true);
      assert.equal(body(root).ledgerCommitted >= 1, true);
      second.log.close?.();

      // الخصمُ يملكُ القرصَ: يمحو الجذرَ ويُعيدُ اللقطةَ كلَّها معاً.
      // P0 Freshness: الحداثةُ الخارجيّةُ تقدّمَت، فاللقطةُ القديمةُ تُرفَضُ.
      rmSync(root, { recursive: true, force: true });
      cpSync(snapshot, root, { recursive: true });

      await assert.rejects(
        () => boot(root),
        (err) => /** @type {Error & { code?: string }} */ (err).code === 'STALE_MANIFEST_EPOCH',
        'اللقطةُ القديمةُ المتّسقةُ يجبُ أن تُرفَضَ بحداثةِ المرجعِ الخارجيِّ',
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(snapshot, { recursive: true, force: true });
    }
  });

  test('P0 Freshness: تسلسلُ الختمِ يرجعُ إلى الوراءِ فيُكشَفُ الآنَ بالحداثةِ', async () => {
    const { boot, body } = rig();
    const root = registerTmpRoot(mkdtempSync(join(tmpdir(), 'xuux-replay-')));
    const snapshot = registerTmpRoot(mkdtempSync(join(tmpdir(), 'xuux-replay-snap-')));
    try {
      const first = await boot(root);
      first.log.close?.();
      const snapshotSequence = body(root).sequence;
      rmSync(snapshot, { recursive: true, force: true });
      cpSync(root, snapshot, { recursive: true });

      const second = await boot(root);
      const command = { id: 'أمرٌ-يُسقَط' };
      await second.ledger.beginAsync(command);
      await second.ledger.commitSigned(command, 'تمّ');
      await second.haltSwitch.haltAsync(
        'إيقافٌ سياديّ',
        royalCommandFor(second.haltSwitch, 'halt', 'إيقافٌ سياديّ'),
      );
      const advancedSequence = body(root).sequence;
      second.log.close?.();
      assert.equal(advancedSequence > snapshotSequence, true, 'التسلسلُ لم يتقدّمْ');

      // P0 Freshness: المرجعُ الخارجيُّ تقدّمَ، فاللقطةُ القديمةُ تُرفَضُ الآنَ.
      rmSync(root, { recursive: true, force: true });
      cpSync(snapshot, root, { recursive: true });
      await assert.rejects(
        () => boot(root),
        (err) => /** @type {Error & { code?: string }} */ (err).code === 'STALE_MANIFEST_EPOCH',
        'اللقطةُ القديمةُ يجبُ أن تُرفَضَ الآنَ بالحداثةِ الخارجيّةِ',
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(snapshot, { recursive: true, force: true });
    }
  });
  test('حدُّ الإعادةِ **لا يشملُ** اللقطةَ الجزئيّةَ: محوُ السجلِّ معَ بيانٍ أقدمَ يُرَدُّ (الآنَ بالحداثةِ)', async () => {
    // `S13` (`WL-237`): الفرقُ بينَ هذا الاختبارِ والأولِ هو **السجلُّ وحدَه**:
    // هناك يُستعادُ معَ البيانِ فتُرفَضُ بالحداثةِ، وهنا يُمحى
    // فيُرَدُّ الإقلاعُ — بالحداثةِ أوَّلاً ثمَّ بفحصِ السجلِّ كخطِّ دفاعٍ ثانٍ.
    const { boot, body } = rig();
    const root = registerTmpRoot(mkdtempSync(join(tmpdir(), 'xuux-replay-')));
    try {
      const first = await boot(root);
      first.log.close?.();
      const olderManifest = readFileSync(join(root, MANIFEST));

      const second = await boot(root);
      const command = { id: 'أمرٌ-مُثبَّتٌ' };
      await second.ledger.beginAsync(command);
      await second.ledger.commitSigned(command, 'تمّ');
      await second.haltSwitch.haltAsync(
        'إيقافٌ سياديّ',
        royalCommandFor(second.haltSwitch, 'halt', 'إيقافٌ سياديّ'),
      );
      second.log.close?.();
      assert.equal(body(root).ledgerCommitted >= 1, true, 'المقدّمةُ ساقطةٌ: الشاهدُ لم يتقدّمْ');

      // لقطةٌ **جزئيّةٌ**: البيانُ يرجعُ والسجلُّ يُمحى — لا لقطةٌ متّسقةٌ.
      // P0 Freshness: الحداثةُ الخارجيّةُ تقدّمَت، فالبيانُ القديمُ يُرفَضُ أوَّلاً.
      writeFileSync(join(root, MANIFEST), olderManifest);
      rmSync(join(root, 'events.log'), { force: true });
      rmSync(join(root, 'events.log.head'), { force: true });
      rmSync(join(root, 'commands.ledger'), { force: true });
      rmSync(join(root, 'commands.ledger.claims'), { recursive: true, force: true });
      writeFileSync(join(root, 'commands.ledger'), '');
      mkdirSync(join(root, 'commands.ledger.claims'), { recursive: true });

      await assert.rejects(
        () => boot(root),
        (err) => /** @type {Error & { code?: string }} */ (err).code === 'STALE_MANIFEST_EPOCH',
        'البيانُ القديمُ يجبُ أن يُرفَضَ بالحداثةِ الخارجيّةِ',
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('حدُّ الإعادةِ لا يمتدُّ إلى ما هو أضيقُ: سطرُ دفترٍ مدسوسٌ بتجزئةٍ عامّةٍ يُرفَضُ', async () => {
    // مجَسُّ المُراجعِ `P10` في `M11.04` الجولةِ الرابعةِ (النتيجةُ `R4-B-01`)
    // قِيسَ عندَ رفعِه: `signedValue=7,newSealValid=true`. يُقاسُ هنا **من
    // مصنعِ الإنتاجِ نفسِه** لا من وحدةِ البيانِ وحدَها، بشكلِ المُراجعِ نصّاً
    // (`seq: body.sequence` و`prev: body.journalHead` وتجزئةٌ عاريّةٌ بلا سرٍّ)،
    // ليُثبَتَ أنّ الحدَّ المُعلَنَ في هذا الملفِّ هو **اللقطةُ الكاملةُ
    // المتّسقةُ وحدَها**، وأنّه ليس مسارَ مصادقةٍ بديلاً أوسعَ منها.
    const { boot, body } = rig();
    const root = registerTmpRoot(mkdtempSync(join(tmpdir(), 'xuux-replay-')));
    try {
      const first = await boot(root);
      first.log.close?.();
      const before = body(root);
      const entry = {
        seq: before.sequence,
        key: 'ledgerCommitted',
        value: 7,
        at: '2026-09-11T00:00:00Z',
        prev: before.journalHead,
      };
      const hash = createHash('sha256')
        .update(JSON.stringify({ instanceId: before.instanceId, ...entry }))
        .digest('hex');
      writeFileSync(join(root, JOURNAL), JSON.stringify({ ...entry, hash }) + '\n', 'utf8');

      await assert.rejects(
        () => boot(root),
        (err) =>
          /** @type {Error & { code?: string }} */ (err).code ===
          'STATE_MANIFEST_JOURNAL_UNAUTHENTICATED',
        'قيمةٌ غيرُ مصدَّقةٍ يجبُ ألّا تصيرَ مختومةً بمجرَّدِ سلسلةِ تجزئةٍ عامّةٍ',
      );
      // ولم يرتفعْ عدّادٌ على القرصِ بهذا الدسِّ.
      assert.equal(body(root).ledgerCommitted, before.ledgerCommitted, 'العدّادُ ارتفعَ برفضٍ');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

// ═══ شاهدُ سدِّ `S13` (كانَ ملفّاً مفرداً، وأُدمِجَ هنا — العلّةُ في `WL-237`) ═══
//
// شاهدُ سدِّ `S13` — الجولةُ السادسةُ من `M11.04`، `WL-237`.
//
// المصدرُ: `S13` رُفِعَ في تقريرِ `kimi_k3` (الجولةُ الرابعةُ)، ثمَّ رُفِعَ إلى
// المجلسِ نتيجةً جديدةً في الجولةِ السادسةِ بأمرِ المالكِ. والتقريرانِ الخامّانِ:
//   docs/external-review/reports/M11.04-round-6-model-council-report-claude-sonnet-5-0.md
//   docs/external-review/reports/M11.04-round-6-model-council-report-gpt-5-6-luna.md
// وحكمُ V5 عندَ كليهما: حارسُ «بيانٌ مختومٌ حاضرٌ بلا سجلٍّ» **يسدُّ `S13` وحدَه**
// ويبقى داخلَ قيودِ `ADR 0006`، **على أن يُقيَّدَ بنافذةِ التهيئةِ الشرعيّةِ**
// و**على أن يُفحَصَ السجلُّ ورأسُه معاً** (`gpt_5_6_luna`، V5).
//
// العلّةُ المقيسةُ: شواهدُ `WL-184`/`R5-A-01` (`haltEpochFromSealedLog`،
// `ledgerCommittedFromSealedLog`) تُقرأُ **من السجلِّ المختومِ**. فمن ملكَ القرصَ
// واستعادَ بياناً أقدمَ **ومحا السجلَّ** أسقطَ الشاهدَ الثاني صامتاً: غيابُ
// الشاهدِ كانَ يُقرأُ **صفراً لا تناقضاً**، فترجعُ العدّاداتُ ويُقبَلُ أمرٌ ثُبِّتَ.
//
// عقدُ هذا الملفِّ:
//   • كلُّ اختبارٍ هنا **كان يفشلُ على `43a18d3c`** (رأسُ `main` قبلَ الإصلاحِ):
//     المجَسّانِ الأوّلانِ كانا يُقلعانِ `BOOT_OK` بلا رمزٍ، والثالثُ كانَ يقرأُ
//     رمزاً آخرَ (`LEDGER_STATE_ROOT_MISSING`) لا رمزَ غيابِ السجلِّ.
//   • القياسُ **بالرفضِ** لا بالوصفِ: كلُّ حكمٍ رمزُ رفضٍ أو حالةٌ مقروءةٌ من
//     تركيبٍ حقيقيٍّ على القرصِ، لا فحصُ نصٍّ في ملفٍّ.
//   • ولا يُغلَقُ بهذا الملفِّ حكمُ مراجعةٍ: أحكامُ `UF-01`/`UF-03`/`UF-07`/
//     `R4-K3-01`/`R5-A-01` للمجلسِ وحدَه (المادة 11 §1)، وهذا شطرُ المنفِّذِ منه.
//
// **حدٌّ يُصرَّحُ به ولا يُخفى:** هذا يسدُّ «بياناً حاضراً بلا سجلٍّ» وحدَه. أمّا
// اللقطةُ الكاملةُ المتّسقةُ (بيانٌ **وسجلٌّ** أقدمُ معاً) فتبقى ناجحةً — مقيسةً
// في `replay-limit.test.mjs` — وهي الحدُّ المُعلَنُ في `ADR 0006` و`R3-A-01`،
// فلا تُغلَقُ بهذا `R4-K3-01`.

const PRODUCTION_ENV = Object.freeze({
  NODE_ENV: 'production',
  STATE_ENV: 'production',
  XUUX_ROOT_OF_TRUST_MODE: 'hsm',
  XUUX_PKCS11_MODULE: '/usr/lib/softhsm/libsofthsm2.so',
  XUUX_PKCS11_TOKEN: 'xuux-test',
  XUUX_PKCS11_TOKEN_SERIAL: 'DEADBEEFCAFE0001',
  XUUX_PKCS11_MODULE_SHA256: 'f'.repeat(64),
  XUUX_PKCS11_PIN: 'fake-pin-not-used-by-injected-source', // secret-scan:allow
  XUUX_ROOT_OF_TRUST_PROVISION: '1',
});

const LEDGER = 'commands.ledger';
const CLAIMS = 'commands.ledger.claims';
const EVENTS = 'events.log';
const EVENTS_HEAD = 'events.log.head';

/**
 * هويةُ الملكِ تُشتقُّ من مفتاحِه نفسِه لا من قيمةٍ تُخترَع.
 * @param pair - زوجُ مفاتيحِ الملك
 * @returns معرّفُ الملكِ كما يقرأُه التركيب
 */
function kingIdOf(pair) {
  return 'king:' + fingerprint(pair.publicKey).slice(0, 24);
}

/**
 * توكنٌ مزيَّفٌ بشكلِ PKCS#11 **ثابتُ المفاتيحِ** عبرَ الإقلاعاتِ — نظيرُ توكنٍ
 * لم يُبدَّل. وهو نفسُ التوكنِ المستعملِ في `round-4-halt-log-witness.test.mjs`.
 * @param overrides - تبديلاتُ المفاتيح
 * @returns مصدرُ مفاتيحَ محقونٌ
 */
function fakeToken(overrides = {}) {
  const aesKeys = new Map([['05', overrides.aead ?? randomBytes(32)]]);
  const edKeys = new Map([
    ['06', overrides.king ?? registerTestKing(generateKeyPairSync('ed25519'))],
    ['07', overrides.ledger ?? registerTestKing(generateKeyPairSync('ed25519'))],
  ]);
  const aad = Buffer.from('xuux-event');
  return {
    describe: () => ({ kind: 'pkcs11-hsm', canExport: false, tokenSerial: 'DEADBEEFCAFE0001' }),
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
 * يُقلعُ تركيباً إنتاجياً في مجلَّدٍ مؤقَّتٍ بمصدرٍ محقون.
 * @param options - الجذرُ والمفاتيحُ وزياداتُ البيئة
 * @returns التركيبُ وجذرُه وأدواتُ إغلاقِه
 */
async function bootRuntime(options = {}) {
  const root = options.root ?? registerTmpRoot(mkdtempSync(join(tmpdir(), 'xuux-s13-witness-')));
  const king = options.king ?? registerTestKing(generateKeyPairSync('ed25519'));
  const token = options.token ?? fakeToken({ king });
  const env = {
    ...PRODUCTION_ENV,
    XUUX_KING_ID: kingIdOf(king),
    ...ROYAL_KEY.env,
    ...(options.env ?? {}),
  };
  const freshnessSocket = options.freshnessSocket ?? new InMemoryFreshnessSocket(0n, 's13');
  const runtime = await createProductionRootOfTrust(
    env,
    { root, fsync: false, freshnessSocket },
    { openSource: async () => ({ source: token, close: async () => undefined }) },
  );
  return {
    runtime,
    root,
    king,
    token,
    env,
    freshnessSocket,
    close: () => runtime.log.close?.(),
    destroy: () => rmSync(root, { recursive: true, force: true }),
  };
}

/**
 * يُعيدُ الإقلاعَ على الجذرِ نفسِه والتوكنِ نفسِه.
 * @param first - التركيبُ الأولُ الذي أُغلِق
 * @returns التركيبُ الثاني
 */
async function rebootRuntime(first) {
  return bootRuntime({
    root: first.root,
    king: first.king,
    token: first.token,
    env: first.env,
    freshnessSocket: first.freshnessSocket,
  });
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

/** متنُ بيانِ الجذرِ كما هو على القرصِ. */
const bodyOf = (root) => JSON.parse(readFileSync(join(root, MANIFEST), 'utf8')).body;

/**
 * يُقدِّمُ الحالةَ تقديماً حقيقيّاً: أمرٌ يُثبَّتُ ثمَّ إيقافٌ سياديٌّ — فيصيرُ في
 * البيانِ وفي السجلِّ شاهدانِ لا يجوزُ أن يرجعا.
 * @param first - التركيبُ القائمُ على الجذر
 * @param commandId - معرّفُ الأمرِ المُثبَّت
 * @returns متنُ البيانِ بعدَ التقديم
 */
async function advanceState(first, commandId) {
  const second = await rebootRuntime(first);
  try {
    await second.runtime.ledger.beginAsync({ id: commandId });
    await second.runtime.ledger.commitSigned({ id: commandId }, 'تمّ');
    const directive = await second.runtime.haltSwitch.haltAsync(
      'إيقافٌ سياديّ',
      royalCommandFor(second.runtime.haltSwitch, 'halt', 'إيقافٌ سياديّ'),
    );
    assert.equal(directive.state, 'halted');
  } finally {
    second.close();
  }
  const body = bodyOf(first.root);
  assert.equal(body.haltEpoch >= 1, true, 'عهدُ الإيقافِ لم يتقدّمْ فالمقدّمةُ ساقطةٌ');
  assert.equal(body.ledgerCommitted >= 1, true, 'شاهدُ الدفترِ لم يتقدّمْ فالمقدّمةُ ساقطةٌ');
  return body;
}

describe('`S13`: بيانٌ مختومٌ حاضرٌ بلا سجلٍّ على جذرٍ قائمٍ ⇒ فشلٌ مُغلَقٌ', () => {
  test('الرمزُ مُثبَّتٌ نصّاً في عقدِ المصنعِ فيُختبَرُ ولا يُخمَّنُ من رسالةٍ', () => {
    assert.equal(
      ProductionRuntimeErrorCodes.includes('LOG_STATE_ROOT_MISSING'),
      true,
      'رمزُ الرفضِ غيرُ مُعلَنٍ في العقدِ',
    );
  });

  test('`S13`: بيانٌ أقدمُ صحيحُ الخاتَمِ + محوُ السجلِّ ورأسِه + دفترٌ فارغٌ ⇒ يُرَدُّ الإقلاعُ (الآنَ بالحداثةِ)', async () => {
    const first = await bootRuntime();
    try {
      first.close();
      // بيانُ النشأةِ: مختومٌ صحيحٌ، وهو ما يستعيدُه الخصمُ.
      const genesisManifest = readFileSync(join(first.root, MANIFEST));
      await advanceState(first, 'أمرٌ-يُرادُ-إعادتُه');

      // الخصمُ يملكُ القرصَ: بيانٌ أقدمُ، ومحوُ السجلِّ ورأسِه، ودفترٌ يُستحدَثُ
      // فارغاً بمجلَّدِ حجوزاتٍ — فلا يُرَدُّ بـ`LEDGER_STATE_ROOT_MISSING`.
      // P0 Freshness: الحداثةُ الخارجيّةُ تقدّمَت، فالبيانُ القديمُ يُرفَضُ أوَّلاً.
      writeFileSync(join(first.root, MANIFEST), genesisManifest);
      rmSync(join(first.root, EVENTS), { force: true });
      rmSync(join(first.root, EVENTS_HEAD), { force: true });
      rmSync(join(first.root, LEDGER), { force: true });
      rmSync(join(first.root, CLAIMS), { recursive: true, force: true });
      writeFileSync(join(first.root, LEDGER), '');
      mkdirSync(join(first.root, CLAIMS), { recursive: true });

      const refused = await caughtAsync(() => rebootRuntime(first));
      assert.equal(refused.code, 'STALE_MANIFEST_EPOCH', `رمزٌ غيرُ متوقّعٍ: ${refused.code}`);
      // ولم يُنشئْ الرفضُ سجلاً فارغاً يُقرأُ في الإقلاعِ التالي «نشأةً».
      assert.equal(existsSync(join(first.root, EVENTS)), false, 'الرفضُ خلَّفَ سجلاً فارغاً');
    } finally {
      first.destroy();
    }
  });

  test('`S13` بصيغةِ التخفّي: سجلٌّ فارغٌ يُترَكُ مكانَ المحوِ ⇒ يُرَدُّ بالحداثةِ', async () => {
    const first = await bootRuntime();
    try {
      first.close();
      const genesisManifest = readFileSync(join(first.root, MANIFEST));
      await advanceState(first, 'أمرٌ-يُرادُ-إعادتُه');

      // فحصُ الوجودِ وحدَه يُتجاوَزُ بهذا: ملفٌّ حاضرٌ لكنّه لا يشهدُ بشيءٍ.
      // P0 Freshness: الحداثةُ الخارجيّةُ تقدّمَت، فالبيانُ القديمُ يُرفَضُ أوَّلاً.
      writeFileSync(join(first.root, MANIFEST), genesisManifest);
      writeFileSync(join(first.root, EVENTS), '');
      rmSync(join(first.root, EVENTS_HEAD), { force: true });
      rmSync(join(first.root, LEDGER), { force: true });
      rmSync(join(first.root, CLAIMS), { recursive: true, force: true });
      writeFileSync(join(first.root, LEDGER), '');
      mkdirSync(join(first.root, CLAIMS), { recursive: true });

      const refused = await caughtAsync(() => rebootRuntime(first));
      assert.equal(refused.code, 'STALE_MANIFEST_EPOCH', `رمزٌ غيرُ متوقّعٍ: ${refused.code}`);
    } finally {
      first.destroy();
    }
  });

  test('إقلاعٌ شرعيٌّ على جذرٍ قائمٍ لا يمسُّه الحارسُ — ولو كانَ السجلُّ بلا واقعةٍ بعدُ', async () => {
    const first = await bootRuntime();
    try {
      first.close();
      // حالةٌ شرعيّةٌ مقيسةٌ: بعدَ إقلاعٍ أوّلٍ تامٍّ يكونُ السجلُّ حاضراً وعدُّه صفرٌ.
      const inspection = inspectEventLog(join(first.root, EVENTS));
      assert.equal(inspection.exists, true, 'السجلُّ لم يُنشَأْ في الإقلاعِ الأوّلِ');
      assert.equal(inspection.head !== null, true, 'الرأسُ لم يُكتَبْ في الإقلاعِ الأوّلِ');
      assert.equal(inspection.count, 0, 'المقدّمةُ تغيّرَت: السجلُّ فيه واقعةٌ بعدَ النشأةِ');

      const second = await rebootRuntime(first);
      try {
        assert.equal(second.runtime.haltSwitch.read().state, 'running');
      } finally {
        second.close();
      }
    } finally {
      first.destroy();
    }
  });

  test('الحارسُ لا يُطبَّقُ على تهيئةٍ أولى: النشأةُ تكتبُ البيانَ قبلَ السجلِّ فغيابُه حالُها', () => {
    const root = registerTmpRoot(mkdtempSync(join(tmpdir(), 'xuux-s13-genesis-')));
    try {
      // لا سجلَّ ولا بيانَ: هذه تهيئةٌ أولى، والحارسُ يُمَرِّرُها بلا رفضٍ.
      assert.doesNotThrow(
        () => assertSealedLogPresentOnExistingRoot(join(root, EVENTS), true, PRODUCTION_ENV),
        'الحارسُ ردَّ تهيئةً أولى — وذاكَ يمنعُ نشأةً شرعيّةً',
      );
      // وعلى جذرٍ قائمٍ يردُّ الغيابَ نفسَه.
      const refused = (() => {
        try {
          assertSealedLogPresentOnExistingRoot(join(root, EVENTS), false, PRODUCTION_ENV);
        } catch (error) {
          return error;
        }
        return assert.fail('لم يُرفع خطأ');
      })();
      assert.equal(refused.code, 'LOG_STATE_ROOT_MISSING');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('الحارسُ إنتاجيٌّ وحدَه: خارجَ الإنتاجِ لا يُرَدُّ غيابُ السجلِّ', () => {
    const root = registerTmpRoot(mkdtempSync(join(tmpdir(), 'xuux-s13-dev-')));
    try {
      assert.doesNotThrow(() =>
        assertSealedLogPresentOnExistingRoot(join(root, EVENTS), false, { NODE_ENV: 'test' }),
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
