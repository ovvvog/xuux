// @ts-nocheck
// tests/root-of-trust/round-4-halt-log-witness.test.mjs
//
// مجَسّاتُ الشاهدِ المختومِ لعهدِ الإيقاف — `M11.04-F07`، الشطرُ الثاني.
//
// المصدرُ: تقريرُ العضوِ «أ» في الجولةِ الرابعة
//   docs/external-review/reports/M11.04-round-4-model-council-report-gpt-6-astra.md
// وفيه المجَسُّ `P14`: استرجاعُ بيانٍ **أقدمَ صحيحِ الخاتَمِ** معَ محوِ مجلَّدِ
// `halt/` وحدَه وإبقاءِ الدفترِ بايتاً ببايتٍ أعادَ التركيبَ `running`/`epoch=0`
// بعدَ إيقافٍ سياديٍّ. وهي لقطةٌ **جزئيّةٌ** لا كاملةٌ، فليست هي الخطرَ المتبقّيَ
// المُعلَنَ في `docs/adr/0006-state-manifest-seal-and-anti-rollback-limit.md`.
//
// العلّةُ المقيسةُ: شاهدُ العهدِ كانَ في موضعٍ واحدٍ — البيانِ المختومِ — يُسترجَعُ
// كلُّه؛ والإيقافُ السياديُّ لم يكن يُخلِّفُ أثراً في السجلِّ المختومِ أصلاً
// (‏`log: null` كانَ مُمرَّراً إلى `HaltSwitch` لأنّ السجلَّ المختومَ يرفضُ
// الإلحاقَ المتزامنَ بحقٍّ). فصارَ المساران غيرُ المتزامنين (‏`haltAsync`،
// `resumeAsync`) يُلحقانِ **وينتظرانِ** واقعةً مختومةً، والإقلاعُ يقرأُ أعلى
// الشاهدَين (‏`haltEpochFromSealedLog`).
//
// عقدُ هذا الملفِّ:
//   • كلُّ اختبارٍ هنا **كان يفشلُ على `c20d149b`**: المجَسُّ الأولُ كان يقرأُ
//     `running`/`epoch=0`، والثاني لا يجدُ واقعةً في السجلِّ، والثالثُ لا يجدُ
//     رمزَ الإلزامِ مُعلَناً، والرابعُ يقرأُ `halt.issued` غيرَ موجودٍ.
//   • القياسُ **بالرفضِ** لا بالوصفِ: كلُّ حكمٍ هنا رمزُ رفضٍ أو حالةٌ مقروءةٌ من
//     تركيبٍ حقيقيٍّ على القرصِ، لا فحصُ نصٍّ في ملفٍّ.
//   • ولا يُغلَقُ بهذا الملفِّ حكمُ مراجعةٍ: حكمُ `M11.04-F07` بيدِ المجلسِ
//     وحدَه (المادة 11 §1)، وهذا شطرُ المنفِّذِ منه.
//   • لا توكنَ حقيقيّاً ولا توليدَ مفاتيحَ على عتادٍ: المصدرُ محقونٌ عبرَ
//     `openSource`، ومسارُ التوكنِ الحقيقيِّ في `production-runtime-softhsm.test.mjs`.
//
// **حدٌّ يُصرَّحُ به ولا يُخفى (المجَسُّ الخامسُ يقيسُه):** من استرجعَ **اللقطةَ
// الكاملةَ المتّسقةَ** — البيانَ والسجلَّ والمراسي معاً — عادَ إلى `running`
// و`epoch=0`، ولا يردُّه شيءٌ من هذا. وذاك هو الخطرُ المُعلَنُ في `ADR 0006`،
// ومنعُه التامُّ يحتاجُ مرساةً خارجَ القرصِ (عدّاداً رتيباً في عتادٍ) وهو
// `R3-A-01`. ولا يُصطنَعُ لسدِّه «عدّادٌ رتيبٌ» ثانٍ في ملفٍّ على القرصِ: ذاك
// ممنوعٌ نصّاً في تلك الوثيقةِ لأنّه شاهدٌ في يدِ من يُشهَدُ عليه.

import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import {
  createCipheriv,
  createDecipheriv,
  generateKeyPairSync,
  randomBytes,
  sign as softwareSign,
} from 'node:crypto';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { registerTmpRoot } from '../helpers/tmp-roots.mjs';

import {
  HaltError,
  HaltErrorCodes,
  HaltSwitch,
  SEAL_IV_BYTES,
  createProductionRootOfTrust,
  InMemoryFreshnessSocket,
  fingerprint,
  haltEpochFromSealedLog,
} from '../../src/root-of-trust/index.mjs';

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

/**
 * هويةُ الملكِ تُشتقُّ من مفتاحِ البديلِ نفسِه لا من قيمةٍ ثابتةٍ تُخترَع.
 * @param pair - زوجُ مفاتيحِ الملك
 * @returns معرّفُ الملكِ كما يقرأُه التركيب
 */
function kingIdOf(pair) {
  return 'king:' + fingerprint(pair.publicKey).slice(0, 24);
}

/**
 * توكنٌ مزيَّفٌ بشكلِ PKCS#11: تعميةٌ وتوقيعٌ حقيقيّانِ من `node:crypto`، ولا
 * تصديرَ لمفتاحٍ خاصّ. وهو نفسُ التوكنِ المستعملِ في `production-runtime.test.mjs`.
 * @param overrides - تبديلاتُ المفاتيح
 * @returns مصدرُ مفاتيحَ محقونٌ
 */
function fakeToken(overrides = {}) {
  const aesKeys = new Map([['05', overrides.aead ?? randomBytes(32)]]);
  const edKeys = new Map([
    ['06', overrides.king ?? generateKeyPairSync('ed25519')],
    ['07', overrides.ledger ?? generateKeyPairSync('ed25519')],
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
  const root = options.root ?? registerTmpRoot(mkdtempSync(join(tmpdir(), 'xuux-halt-witness-')));
  const king = options.king ?? generateKeyPairSync('ed25519');
  const token = options.token ?? fakeToken({ king });
  const env = { ...PRODUCTION_ENV, XUUX_KING_ID: kingIdOf(king), ...(options.env ?? {}) };
  const freshnessSocket = options.freshnessSocket ?? new InMemoryFreshnessSocket(0n, 'test');
  const runtime = await createProductionRootOfTrust(
    env,
    { root, fsync: false, royalCommandVerifier: () => true, freshnessSocket },
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
 * يُقلعُ على الجذرِ نفسِه والتوكنِ نفسِه **بلا إذنِ تهيئةٍ**: إقلاعٌ ثانٍ حقيقيٌّ
 * لا نشأةٌ جديدة.
 * @param first - التركيبُ الأولُ الذي أُغلِق
 * @returns التركيبُ الثاني
 */
async function rebootRuntime(first) {
  const env = { ...first.env };
  delete env.XUUX_ROOT_OF_TRUST_PROVISION;
  return bootRuntime({
    root: first.root,
    king: first.king,
    token: first.token,
    env,
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

/** مسارُ بيانِ الجذرِ ودفترِ رفعِه في جذرٍ ما. */
const manifestPaths = (root) => ({
  manifest: join(root, 'root-of-trust.manifest.json'),
  journal: join(root, 'root-of-trust.manifest.journal'),
});

describe('`M11.04-F07`: لا رجوعَ من الحَجزِ باسترجاعِ بيانٍ أقدمَ ومحوِ مجلَّدِ الإيقاف', () => {
  test('`P14`: بيانٌ أقدمُ صحيحُ الخاتَمِ + محوُ `halt/` وحدَه ⇒ يبقى موقوفاً بعهدِه', async () => {
    const first = await bootRuntime();
    try {
      const paths = manifestPaths(first.root);
      // أمرٌ يُثبَّتُ ثمَّ نقطةُ ضبطٍ: اللقطةُ تُلقَطُ **بعدَ** آخرِ تثبيتٍ، فلا
      // يُخالِفُها الدفترُ فيُكشَفَ الاسترجاعُ بفحصٍ آخرَ (‏`LEDGER_AHEAD_OF_WITNESS`)
      // ويُقاسَ ضمانٌ لم يُبنَ بعد.
      first.runtime.ledger.begin({ id: 'cmd-p14' });
      await first.runtime.ledger.commitSigned({ id: 'cmd-p14' });
      await first.runtime.manifest.checkpointAsync();
      const olderManifest = readFileSync(paths.manifest);
      const olderJournal = existsSync(paths.journal) ? readFileSync(paths.journal) : null;
      assert.equal(first.runtime.manifest.read().haltEpoch, 0);

      await first.runtime.haltSwitch.haltAsync('إيقافٌ سياديٌّ مقيس', { id: 'test-cmd' });
      assert.equal(first.runtime.haltSwitch.read().state, 'halted');
      assert.equal(first.runtime.haltSwitch.read().epoch, 1);
      assert.equal(first.runtime.manifest.read().haltEpoch, 1);
      first.close();

      const ledgerBytes = readFileSync(join(first.root, 'commands.ledger'));
      writeFileSync(paths.manifest, olderManifest);
      if (olderJournal === null) rmSync(paths.journal, { force: true });
      else writeFileSync(paths.journal, olderJournal);
      rmSync(join(first.root, 'halt'), { recursive: true, force: true });
      // الدفترُ لم يُلمَسْ: الاسترجاعُ جزئيٌّ بدقّةِ ما وصفَه العضو.
      assert.ok(readFileSync(join(first.root, 'commands.ledger')).equals(ledgerBytes));

      const second = await rebootRuntime(first);
      try {
        const reading = second.runtime.haltSwitch.read();
        assert.equal(reading.state, 'halted');
        assert.equal(reading.epoch, 1);
        assert.equal(reading.problem, 'HALT_DIRECTIVE_MISSING');
        // والبيانُ يُشفى: أرضيّةُ العهدِ تُرفَعُ إلى ما يشهدُ به السجلُّ وتُختَمُ
        // في الإقلاعِ نفسِه، فلا يبقى شاهدٌ خارجَ الخاتَمِ إلى إقلاعٍ تالٍ.
        assert.equal(second.runtime.manifest.read().haltEpoch, 1);
      } finally {
        second.close();
      }
    } finally {
      first.destroy();
    }
  });

  test('الإيقافُ السياديُّ يُخلِّفُ واقعةً **مختومةً** في السجلِّ، ويُقرأُ عهدُها من التوكن', async () => {
    const first = await bootRuntime();
    try {
      await first.runtime.haltSwitch.haltAsync('إيقافٌ سياديٌّ مقيس', { id: 'test-cmd' });
      const events = first.runtime.log.events.filter((event) => event.type === 'halt.issued');
      assert.equal(events.length, 1);
      // الجسمُ مختومٌ لا صريحٌ: لا `epoch` مقروءٌ من القرصِ بلا توكن.
      assert.equal(Object.hasOwn(events[0].data, 'epoch'), false);
      assert.equal(events[0].data.alg, 'AES-256-GCM');
      const body = await first.runtime.log.openEvent(events[0]);
      assert.equal(body.epoch, 1);
      assert.equal(await haltEpochFromSealedLog(first.runtime.log), 1);
      first.close();
    } finally {
      first.destroy();
    }
  });

  test('الاستئنافُ مشهودٌ أيضاً: عهدٌ 2 في السجلِّ يُغلِقُ البابَ بعدَ استرجاعِ بيانِ العهدِ 1', async () => {
    const first = await bootRuntime();
    try {
      const paths = manifestPaths(first.root);
      await first.runtime.haltSwitch.haltAsync('إيقافٌ سياديٌّ مقيس', { id: 'test-cmd' });
      const manifestAtEpochOne = readFileSync(paths.manifest);
      const journalAtEpochOne = existsSync(paths.journal) ? readFileSync(paths.journal) : null;
      await first.runtime.haltSwitch.resumeAsync('استئنافٌ ملكيٌّ', { id: 'test-cmd' });
      assert.equal(first.runtime.haltSwitch.read().state, 'running');
      assert.equal(first.runtime.haltSwitch.read().epoch, 2);
      assert.equal(await haltEpochFromSealedLog(first.runtime.log), 2);
      first.close();

      writeFileSync(paths.manifest, manifestAtEpochOne);
      if (journalAtEpochOne === null) rmSync(paths.journal, { force: true });
      else writeFileSync(paths.journal, journalAtEpochOne);
      rmSync(join(first.root, 'halt'), { recursive: true, force: true });

      const second = await rebootRuntime(first);
      try {
        const reading = second.runtime.haltSwitch.read();
        // محوُ التوجيهِ ليس استئنافاً: من أرادَ التشغيلَ أصدرَ توجيهاً موقَّعاً.
        assert.equal(reading.state, 'halted');
        assert.equal(reading.epoch, 2);
        assert.equal(reading.problem, 'HALT_DIRECTIVE_MISSING');
      } finally {
        second.close();
      }
    } finally {
      first.destroy();
    }
  });

  test('لا يُركَّبُ في الإنتاجِ مفتاحُ إيقافٍ بلا شاهدٍ مختومٍ خارجَ البيان', () => {
    assert.ok(HaltErrorCodes.includes('HALT_SEALED_LOG_REQUIRED_IN_PRODUCTION'));
    const root = registerTmpRoot(mkdtempSync(join(tmpdir(), 'xuux-halt-witness-')));
    try {
      let raised = null;
      try {
        new HaltSwitch(
          join(root, 'halt', 'directive.json'),
          { verify: () => true },
          {
            fsync: false,
            epochFloor: { read: () => 0, raise: () => undefined },
            logAsync: null,
            env: { NODE_ENV: 'production' },
          },
        );
      } catch (error) {
        raised = error;
      }
      assert.ok(raised instanceof HaltError);
      assert.equal(raised.code, 'HALT_SEALED_LOG_REQUIRED_IN_PRODUCTION');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('العبثُ بجسمِ الواقعةِ المختومِ أو قصُّ سطرِها يردُّ الإقلاعَ فشلاً مغلقاً', async () => {
    const tampered = await bootRuntime();
    try {
      await tampered.runtime.haltSwitch.haltAsync('إيقافٌ سياديٌّ مقيس', { id: 'test-cmd' });
      tampered.close();
      const logFile = join(tampered.root, 'events.log');
      const lines = readFileSync(logFile, 'utf8').trimEnd().split('\n');
      const index = lines.findIndex((line) => line.includes('halt.issued'));
      assert.ok(index >= 0);
      const record = JSON.parse(lines[index]);
      const ciphertext = Buffer.from(record.data.ct, 'base64');
      ciphertext[0] ^= 0xff;
      record.data.ct = ciphertext.toString('base64');
      lines[index] = JSON.stringify(record);
      writeFileSync(logFile, lines.join('\n') + '\n');
      const error = await caughtAsync(() => rebootRuntime(tampered));
      assert.equal(error.code, 'CORRUPT_EVENT_LOG');
    } finally {
      tampered.destroy();
    }

    const truncated = await bootRuntime();
    try {
      await truncated.runtime.haltSwitch.haltAsync('إيقافٌ سياديٌّ مقيس', { id: 'test-cmd' });
      truncated.close();
      const logFile = join(truncated.root, 'events.log');
      const kept = readFileSync(logFile, 'utf8')
        .trimEnd()
        .split('\n')
        .filter((line) => !line.includes('halt.issued'));
      writeFileSync(logFile, kept.length === 0 ? '' : kept.join('\n') + '\n');
      rmSync(join(truncated.root, 'halt'), { recursive: true, force: true });
      const error = await caughtAsync(() => rebootRuntime(truncated));
      assert.equal(error.code, 'TRUNCATED_EVENT_LOG');
    } finally {
      truncated.destroy();
    }
  });

  test('P0 Freshness: لقطةٌ كاملةٌ متّسقةٌ تُرفَضُ الآنَ بالحداثةِ (كانت تُقبَلُ بلا مرجعٍ)', async () => {
    const first = await bootRuntime();
    const snapshot = first.root + '-snapshot';
    try {
      await first.runtime.manifest.checkpointAsync();
      first.close();
      // لقطةٌ كاملةٌ: البيانُ ودفترُ رفعِه والسجلُّ والمراسي والدفترُ ومجلَّدُ
      // الإيقافِ — كلُّ ما على القرصِ في لحظةٍ واحدة.
      cpSync(first.root, snapshot, { recursive: true });

      const second = await rebootRuntime(first);
      await second.runtime.haltSwitch.haltAsync('إيقافٌ سياديٌّ مقيس', { id: 'test-cmd' });
      assert.equal(second.runtime.haltSwitch.read().state, 'halted');
      second.close();

      rmSync(first.root, { recursive: true, force: true });
      cpSync(snapshot, first.root, { recursive: true });
      // P0 Freshness: المرجعُ الخارجيُّ تقدّمَ، فاللقطةُ القديمةُ تُرفَضُ الآنَ.
      const third = await caughtAsync(() => rebootRuntime(first));
      assert.equal(third.code, 'STALE_MANIFEST_EPOCH', `رمزٌ غيرُ متوقّعٍ: ${third.code}`);
    } finally {
      rmSync(snapshot, { recursive: true, force: true });
      first.destroy();
    }
  });
});
