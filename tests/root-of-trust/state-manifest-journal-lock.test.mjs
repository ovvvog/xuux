// @ts-nocheck
// tests/root-of-trust/state-manifest-journal-lock.test.mjs
//
// WL-492 — إغلاقُ دينِ `LIVE-62`: سباقا قفلِ الكاتبِ الواحدِ على دفترِ الرفعِ في
// `state-manifest.mts` (‏`#acquireJournalLock`) — النمطُ المقيسُ في نظيرِهِ من
// `persistent-log` (تشغيلةُ `40814498943` + إجهادُ `R8-01/8`):
//   1. نافذةُ «قفلٍ فارغٍ» بينَ `openSync('wx')` و`writeSync`: منافسٌ يقرأُ مالكًا
//      `null` فينتزعُ قفلَ عمليةٍ حيّةٍ.
//   2. حذفٌ غيرُ مشروطٍ لقفلِ مالكٍ ميتٍ: منافسٌ استحواذَ القفلَ بينَ القراءةِ
//      والحذفِ يُسلَبُ قفلَهُ الحيَّ — كاتبانِ على الدفترِ معًا.
//
// **ما يقيسُه على المسارِ البرمجيِّ الحقيقيّ (عملياتٌ منفصلةٌ لا محاكاةُ دوالَّ):**
//   - رفضُ القفلِ لعمليةٍ حيّةٍ (رفضٌ مغلقٌ برمزِهِ) وبقاءُ الدفترِ سليمًا.
//   - استردادُ قفلِ عمليةٍ ماتت فعلًا (لا رقمًا مفترى) والرفعُ يقعُ بعده.
//   - استردادُ **تصريحِ سرقةٍ متعطِّلٍ** بمطالبةٍ ذرّيّةٍ (renameSync) — تطبيقُ النمطِ
//     المصلَّحِ من WL-491 كاملًا بلا الحذفِ الأعمى.
//   - إجهادُ سباقٍ عبرَ العمليّاتِ: جولاتٌ متتابعةٌ من متسابقينَ حقيقيّينَ، والدليلُ
//     على كاتبٍ واحدٍ في كلِّ لحظةٍ هو سلامةُ سلسلةِ الدفترِ (الفحصُ الرسميُّ
//     `openAsync` يتحققُ من تجزئةِ كلِّ سطرٍ وسلسلتِهِ) ووصولُ القيمةِ إلى أعلى رفعٍ.
//
// **حدودٌ معلنة:** بيانٌ موقَّعٌ بموقِّعٍ تجريبيٍّ (Ed25519 من node:crypto) لا HSM؛
// وبيئةُ اختبارٍ لا تُلزمُ مفتاحَ مصادقةِ الدفترِ (لا إنتاج)؛ ولا مساسَ لنتائجِ
// المجلسِ — هذا انحدارُ تقنيٌّ لدينٍ مسجَّلٍ لا حكمٌ على نتيجةٍ.

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { generateKeyPairSync, sign as edSign, verify as edVerify } from 'node:crypto';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { StateManifest, STATE_PROVISION_ENV } from '../../src/root-of-trust/index.mjs';

const MODULE = new URL('../../src/root-of-trust/index.mjs', import.meta.url).href;
const KING = 'king:wl-492';
const BINDING = { kingId: KING, context: 'test', tokenSerial: 'T', moduleSha256: 'M' };
const PROVISION_ENV = { [STATE_PROVISION_ENV]: '1' };

/** موقِّعٌ تجريبيٌّ بالعقدِ نفسِهِ (توقيعُ Ed25519 على `JSON.stringify` للمتنِ). */
function softwareSealer(pair) {
  return {
    id: KING,
    signAsync: async (payload) =>
      edSign(null, Buffer.from(JSON.stringify(payload), 'utf8'), pair.privateKey).toString(
        'base64',
      ),
    verify: (payload, signature) =>
      edVerify(
        null,
        Buffer.from(JSON.stringify(payload), 'utf8'),
        pair.publicKey,
        Buffer.from(signature, 'base64'),
      ),
  };
}

/** @param {(dir: string) => Promise<void> | void} body */
async function withDir(body) {
  const dir = mkdtempSync(join(tmpdir(), 'xuux-journal-lock-'));
  try {
    await body(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * عمليةٌ ماتت فعلًا: يُنتظَرُ خروجُها ويُعادُ رقمُها — للاستردادِ المزعومِ لا المفترى.
 * @returns {Promise<number>} رقمُ العمليةِ الميتة
 */
async function deadPid() {
  const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 20)']);
  const pid = child.pid;
  await new Promise((resolve) => child.on('exit', resolve));
  return pid;
}

/**
 * يهيّئُ بيانًا موقَّعًا في المجلدِ ويعيدُ البيانَ ومسارَهُ وزوجَ المفاتيحِ.
 * @param {string} dir
 */
async function provisioned(dir) {
  const pair = generateKeyPairSync('ed25519');
  const file = join(dir, 'root-of-trust.manifest.json');
  const manifest = new StateManifest(file, { fsync: false, sealer: softwareSealer(pair) });
  await manifest.provisionAsync(BINDING, PROVISION_ENV);
  return { manifest, file, pair };
}

test('LIVE-62/1: قفلُ عمليةٍ حيّةٍ أخرى يمنعُ الرفعَ رفضًا مغلقًا برمزِهِ — والدليلُ لا يُهرَّبُ', async () => {
  await withDir(async (dir) => {
    const { manifest } = await provisioned(dir);
    // العمليةُ 1 حيّةٌ في كلِّ نظامٍ يعملُ عليه هذا الاختبارُ، وليست هذه العمليةَ.
    writeFileSync(manifest.journalLockFile, JSON.stringify({ pid: 1, at: 'x' }));
    assert.throws(
      () => manifest.raise('haltEpoch', 3),
      (e) => e.code === 'STATE_MANIFEST_JOURNAL_LOCKED',
    );
    assert.equal(manifest.read().haltEpoch, 0, 'ولا شاهدَ ارتفعَ');
    rmSync(manifest.journalLockFile, { force: true });
    manifest.raise('haltEpoch', 3);
    assert.equal(manifest.read().haltEpoch, 3, 'وبزوالِ القفلِ يقعُ الرفعُ');
  });
});

test('LIVE-62/2: قفلُ عمليةٍ ماتت فعلًا أثرُ تعطُّلٍ يُنتزَعُ والرفعُ يقعُ — ولا قفلَ يُترَكُ بعده', async () => {
  await withDir(async (dir) => {
    const { manifest } = await provisioned(dir);
    const pid = await deadPid();
    writeFileSync(manifest.journalLockFile, JSON.stringify({ pid, at: 'x' }));
    manifest.raise('haltEpoch', 5);
    assert.equal(manifest.read().haltEpoch, 5, 'الاستردادُ وقعَ والرفعُ نجحَ');
    // الرفعُ يُفكُّ قفلَهُ في `finally` — فالملفُّ لا يبقى، وهو عينُ ما يُقاسُ هنا:
    assert.equal(existsSync(manifest.journalLockFile), false, 'القفلُ مُفكوكٌ لا متروكًا');
    assert.equal(
      existsSync(`${manifest.journalLockFile}.steal-permit`),
      false,
      'ولا تصريحَ يُتركُ',
    );
  });
});

test('LIVE-62/3: تصريحُ سرقةٍ متعطِّلٌ (ماتَ مالكُهُ) يُستردُّ بالمطالبةِ الذرّيّةِ — والقفلُ الميتُ يُنتزعُ بعده', async () => {
  await withDir(async (dir) => {
    const { manifest } = await provisioned(dir);
    const pid = await deadPid();
    writeFileSync(manifest.journalLockFile, JSON.stringify({ pid, at: 'x' }));
    const permit = `${manifest.journalLockFile}.steal-permit`;
    writeFileSync(permit, JSON.stringify({ pid, at: 'x' }));
    manifest.raise('haltEpoch', 7);
    assert.equal(manifest.read().haltEpoch, 7, 'الاستردادُ المزدوجُ وقعَ والرفعُ نجحَ');
    assert.equal(existsSync(permit), false, 'والتصريحُ لا يُترَكُ قائمًا بعدَ الاستردادِ');
  });
});

/**
 * متسابقٌ حقيقيٌّ في عمليةٍ منفصلةٍ: يفتحُ البيانَ ثمَّ يرفعُ شريحتَهُ من القيمِ
 * ويطبعُ نتيجةَ كلِّ رفعٍ (OK أو رمزَ الخطأِ). المفتاحُ يُقرأُ من ملفٍّ في المجلدِ
 * المؤقتِ (زوجٌ تجريبيٌّ لا سرَّ إنتاجٍ).
 * @param {string} manifestFile مسارُ البيانِ
 * @param {string} keyFile مسارُ مفتاحِ التوقيعِ الخاصِّ
 * @param {number} base قاعدةُ شريحةِ القيمِ
 * @param {number} count عددُ الرفوعاتِ
 */
function racer(manifestFile, keyFile, pubKeyFile, base, count) {
  const code = `
    const { StateManifest } = await import(${JSON.stringify(MODULE)});
    const { readFileSync } = await import('node:fs');
    const { sign, verify } = await import('node:crypto');
    const privateKey = readFileSync(${JSON.stringify(keyFile)}, 'utf8');
    const publicKey = readFileSync(${JSON.stringify(pubKeyFile)}, 'utf8');
    const sealer = {
      id: ${JSON.stringify(KING)},
      signAsync: async (payload) =>
        sign(null, Buffer.from(JSON.stringify(payload), 'utf8'), privateKey).toString('base64'),
      verify: (payload, signature) =>
        verify(null, Buffer.from(JSON.stringify(payload), 'utf8'), publicKey, Buffer.from(signature, 'base64')),
    };
    const m = new StateManifest(${JSON.stringify(manifestFile)}, { fsync: false, sealer, env: { NODE_ENV: 'test' } });
    // الفتحُ نفسُهُ يطوي الدفترَ فيأخذُ القفلَ: تحتَ التنافسِ يُعادُ حتى ينجحَ (فشلٌ
    // مغلقٌ لا فقدٌ). وقراءةُ البيانِ والدفترِ في openAsync خارجَ القفلِ لقطةٌ غيرُ
    // ذرّيّةٍ: ختمٌ مكتملٌ بينَ القراءتينِ يُقرأ «متنًا أقدمَ تحتَ دفترٍ أحدثَ» فيُرَدُّ
    // ROLLBACK_DETECTED رفضًا مغلقًا صادقًا (كشفُ اللقطةِ الممزقةِ — لا فسادَ ولا
    // كاتبَينِ)؛ إعادتُهُ تعيدُ القراءةَ فتجدها متّسقةً — وهو عينُ ما يفعلهُ المُقيلِ.
    for (let openAttempt = 0; openAttempt < 400; openAttempt += 1) {
      try { await m.openAsync(${JSON.stringify(BINDING)}); break; }
      catch (e) {
        if (e.code !== 'STATE_MANIFEST_JOURNAL_LOCKED' && e.code !== 'STATE_MANIFEST_ROLLBACK_DETECTED' && e.code !== 'ENOENT') { process.stdout.write((e.code ?? String(e)) + '\\n'); process.exit(1); }
        await new Promise((r) => setTimeout(r, 5));
      }
    }
    // الرفعُ تحتَ التنافسِ فشلٌ مغلقٌ لا فقدٌ: إعادةُ المحاولةِ قصيرةٌ حتى يهبطَ
    // الرفعُ — فكلُّ قيمةٍ من الشريحةِ تصلُ إلى الدفترِ مهما اشتدَّ الزحامُ.
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    for (let i = 0; i < ${count}; i += 1) {
      const value = ${base} + i + 1;
      let landed = false;
      for (let attempt = 0; attempt < 400 && !landed; attempt += 1) {
        try { m.raise('haltEpoch', value); process.stdout.write('OK\\n'); landed = true; }
        catch (e) {
          // رفضُ القفلِ شغلٌ عابرٌ: إعادةٌ قصيرةٌ. أيُّ رمزٍ آخرَ تحتَ قفلٍ سليمٍ
          // عيبٌ لا زحامٌ — يُفصَحُ عنهُ (LOST) ولا يُقنَّعُ بإعادةٍ.
          if (e.code !== 'STATE_MANIFEST_JOURNAL_LOCKED') { process.stdout.write((e.code ?? String(e)) + '\\n'); break; }
          await sleep(5);
        }
      }
      if (!landed) process.stdout.write('LOST ' + value + '\\n');
    }
    process.stdout.write('DONE\\n');
  `;
  return spawn(process.execPath, ['--input-type=module', '-e', code], {
    env: { ...process.env, NODE_ENV: 'test' },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
}

/** يقرأُ كلَّ أسطرِ الخرجِ من عمليةٍ حتى نهايتِها. @param {import('node:child_process').ChildProcess} child */
const allLines = (child) =>
  new Promise((resolve) => {
    let buf = '';
    child.stdout?.on('data', (d) => {
      buf += d;
    });
    child.on('exit', () => resolve(buf.split('\n').filter((l) => l !== '')));
  });

test('LIVE-62/4: إجهادُ السباقِ — عملياتٌ متسابقةٌ على الرفعِ: سلسلةُ الدفترِ سليمةٌ وكاتبٌ واحدٌ في كلِّ لحظةٍ (انحدارُ WL-492)', async () => {
  await withDir(async (dir) => {
    const { file, pair } = await provisioned(dir);
    const keyFile = join(dir, 'test-key.pem');
    const pubKeyFile = join(dir, 'test-key.pub');
    writeFileSync(keyFile, pair.privateKey.export({ type: 'pkcs8', format: 'pem' }));
    writeFileSync(pubKeyFile, pair.publicKey.export({ type: 'spki', format: 'pem' }));
    const RACERS = 6;
    const RAISES = 10;
    // ثلاثُ جولاتٍ متتابعةٍ من السباقِ الحقيقيِّ عبرَ العمليّاتِ؛ أعلى قيمةٍ ممكنةٌ
    // معلومةٌ سلفًا فتَصِلُ إليها الحالةُ إن لم يُفقدْ رفعٌ ولم يفسُدْ سطرٌ.
    for (let round = 0; round < 3; round += 1) {
      const children = Array.from({ length: RACERS }, (_, i) =>
        racer(file, keyFile, pubKeyFile, round * 100 + i * RAISES, RAISES),
      );
      const lines = await Promise.all(children.map(allLines));
      for (const linesOfOne of lines) {
        assert.equal(linesOfOne[linesOfOne.length - 1], 'DONE', 'المتسابقُ أكملَ شريحتَهُ');
        // سطورُ النتائجِ وحدَها (بلا خاتمةِ DONE): كلُّ رفعٍ هبطَ — لا فقدَ ولا خطأً
        // مجهولًا — والفشلُ المغلقُ تحتَ التنافسِ يُعادُ حتى يهبطَ (أعلاهُ).
        const results = linesOfOne.slice(0, -1);
        assert.ok(results.length > 0, 'نتائجُ الرفوعاتِ ظاهرةٌ');
        assert.ok(
          results.every((l) => l === 'OK'),
          `كلُّ الرفوعاتِ هبطتْ: ${JSON.stringify(linesOfOne)}`,
        );
      }
    }
    // الدليلُ على كاتبٍ واحدٍ في كلِّ لحظةٍ: فتحٌ نظيفٌ يتحققُ من ختمِ البيانِ
    // وتجزئةِ كلِّ سطرٍ في الدفترِ وسلسلتِهِ — لو تداخلَ كاتبانِ لانكسرتِ السلسلةُ أو
    // خالفَ سطرٌ رأسَهُ فأُلقيَ الخطأُ. والقيمةُ النهائيةُ أعلى رفعٍ حاولَهُ المتسابقونَ.
    const reader = new StateManifest(file, { fsync: false, sealer: softwareSealer(pair) });
    const body = await reader.openAsync(BINDING);
    const maxTried = 2 * 100 + (RACERS - 1) * RAISES + RAISES; // جولة 3 × آخر شريحة
    assert.equal(body.haltEpoch, maxTried, 'القيمةُ وصلتْ إلى أعلى رفعٍ حاولَهُ المتسابقونَ');
    assert.equal(existsSync(reader.journalLockFile), false, 'والقفلُ لا يُتركُ قائمًا');
    assert.equal(existsSync(`${reader.journalLockFile}.steal-permit`), false, 'ولا تصريحَ يُتركُ');
  });
});
