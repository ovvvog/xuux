// WL-485 — هويّةُ السجلِّ الدائمِ بالملفِّ لا بنصِّ المسار (مقترحُ `CO55-M11.05-R8-01`
// من تقريرِ عضوٍ منفردٍ في جولةٍ غيرِ مكتملة — **ليس نتيجةً معتمدة**؛ الإصلاحُ هنا تقنيٌّ
// مستقلٌّ أُثبتت حاجتُهُ بالإعادةِ أدناه).
//
// قبلَ الإصلاح (أُعيدَ إنتاجُهُ على main@2ea0b8c7): القفلُ `<المسار>.lock` يُشتقُّ من نصِّ
// المسارِ المُمرَّر، فرابطٌ رمزيٌّ إلى الملفِّ نفسِهِ (أو إلى مجلّدِه) يأخذُ قفلاً آخرَ ويفتحُ
// كاتباً ثانياً على السجلِّ نفسِه — في العمليةِ نفسِها وفي عمليّةٍ أخرى — ويقرأُ رأساً
// (`.head`) آخرَ غيرَ رأسِ الكاتبِ الأوّل.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PersistentEventLog, LOG_LOCK_SUFFIX } from '../../src/root-of-trust/index.mjs';

const OPTS = { fsync: false, env: { NODE_ENV: 'test' } };
const MODULE = new URL('../../src/root-of-trust/index.mjs', import.meta.url).href;

/** @param {(dir: string) => Promise<void> | void} body */
async function withDir(body) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'xuux-log-identity-'));
  try {
    await body(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** @param {() => unknown} fn @param {string} code */
const throwsCode = (fn, code) => assert.throws(fn, (/** @type {any} */ e) => e.code === code);

test('R8-01/1: رابطٌ رمزيٌّ إلى ملفِّ السجلِّ لا يفتحُ كاتباً ثانياً في العمليةِ نفسِها', async () => {
  await withDir((dir) => {
    const file = path.join(dir, 'events.log');
    const first = new PersistentEventLog(file, OPTS);
    try {
      const link = path.join(dir, 'alias.log');
      symlinkSync(file, link);
      throwsCode(() => new PersistentEventLog(link, OPTS), 'LOG_ALREADY_LOCKED');
      assert.equal(existsSync(link + LOG_LOCK_SUFFIX), false, 'لا قفلَ موازياً باسمِ الرابط');
    } finally {
      first.close();
    }
  });
});

test('R8-01/2: رابطٌ رمزيٌّ إلى المجلّدِ لا يفتحُ كاتباً ثانياً', async () => {
  await withDir((dir) => {
    const real = path.join(dir, 'real');
    mkdirSync(real);
    const first = new PersistentEventLog(path.join(real, 'events.log'), OPTS);
    try {
      const alias = path.join(dir, 'alias-dir');
      symlinkSync(real, alias, 'dir');
      throwsCode(
        () => new PersistentEventLog(path.join(alias, 'events.log'), OPTS),
        'LOG_ALREADY_LOCKED',
      );
    } finally {
      first.close();
    }
  });
});

test('R8-01/3: اختلافُ تمثيلِ المسارِ (نسبيٌّ، `..`، فواصلُ مكرَّرة) يقعُ على القفلِ نفسِه', async () => {
  await withDir((dir) => {
    const file = path.join(dir, 'events.log');
    const first = new PersistentEventLog(file, OPTS);
    try {
      mkdirSync(path.join(dir, 'sub'));
      for (const variant of [
        path.join(dir, 'sub', '..', 'events.log'),
        `${dir}//events.log`,
        path.relative(process.cwd(), file),
      ]) {
        throwsCode(() => new PersistentEventLog(variant, OPTS), 'LOG_ALREADY_LOCKED');
      }
    } finally {
      first.close();
    }
  });
});

test('R8-01/4: هويّةُ السجلِّ قانونيّة: `file` و`headFile` و`lockFile` على الملفِّ الحقيقيّ', async () => {
  await withDir((dir) => {
    const file = path.join(dir, 'events.log');
    new PersistentEventLog(file, OPTS).close();
    const link = path.join(dir, 'alias.log');
    symlinkSync(file, link);
    const viaLink = new PersistentEventLog(link, OPTS);
    try {
      const canonical = realpathSync.native(file);
      assert.equal(viaLink.file, canonical);
      assert.equal(viaLink.lockFile, canonical + LOG_LOCK_SUFFIX);
      assert.ok(viaLink.headFile.startsWith(canonical));
      // والكتابةُ عبرَ الرابطِ تُرى من المسارِ الحقيقيِّ بالرأسِ نفسِه
      viaLink.append('test.event', 'tester', { n: 1 });
    } finally {
      viaLink.close();
    }
    const reopened = new PersistentEventLog(file, OPTS);
    try {
      assert.equal(reopened.events.length, 1);
    } finally {
      reopened.close();
    }
  });
});

test('R8-01/5: رابطٌ رمزيٌّ معلَّقٌ (بلا هدف) يُرفَضُ ولا يُنشئُ ملفّاً ولا قفلاً', async () => {
  await withDir((dir) => {
    const link = path.join(dir, 'dangling.log');
    const target = path.join(dir, 'missing', 'events.log');
    symlinkSync(target, link);
    throwsCode(() => new PersistentEventLog(link, OPTS), 'LOG_PATH_UNRESOLVABLE');
    assert.equal(existsSync(target), false);
    assert.equal(existsSync(link + LOG_LOCK_SUFFIX), false);
  });
});

/**
 * عمليّةٌ تفتحُ السجلَّ بمسارٍ وتطبعُ النتيجةَ ثم تمسكُ القفلَ مدّةً.
 * @param {string} file
 * @param {number} holdMs
 */
function holder(file, holdMs) {
  const code = `
    const { PersistentEventLog } = await import(${JSON.stringify(MODULE)});
    try {
      const log = new PersistentEventLog(${JSON.stringify(file)}, { fsync: false, env: { NODE_ENV: 'test' } });
      process.stdout.write('OPEN\\n');
      setTimeout(() => { log.close(); process.exit(0); }, ${holdMs});
    } catch (e) { process.stdout.write((e.code ?? String(e)) + '\\n'); process.exit(0); }
  `;
  return spawn(process.execPath, ['--input-type=module', '-e', code], {
    env: { ...process.env, NODE_ENV: 'test' },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
}

/**
 * WL-569: عمليّةٌ تفتحُ السجلَّ وتمسكُ القفلَ **حتى يُطلَقَ** (‏إغلاقُ stdin) لا مدّةً ثابتة —
 * فالمتسابقونَ كلُّهم يُجيبونَ والفائزُ ما زالَ يمسك، ولا يُقرأُ «فتحانِ متتاليانِ» تحتَ حِملٍ
 * (‏بدءُ ستِّ عمليّاتٍ يتجاوزُ مدّةَ الإمساك) كاتبَينِ متزامنَين.
 * @param {string} file
 */
function heldUntilReleased(file) {
  const code = `
    const { PersistentEventLog } = await import(${JSON.stringify(MODULE)});
    try {
      const log = new PersistentEventLog(${JSON.stringify(file)}, { fsync: false, env: { NODE_ENV: 'test' } });
      process.stdout.write('OPEN\\n');
      process.stdin.on('end', () => { log.close(); process.exit(0); });
      process.stdin.resume();
    } catch (e) { process.stdout.write((e.code ?? String(e)) + '\\n'); process.exit(0); }
  `;
  return spawn(process.execPath, ['--input-type=module', '-e', code], {
    env: { ...process.env, NODE_ENV: 'test' },
    stdio: ['pipe', 'pipe', 'inherit'],
  });
}

/**
 * يُطلقُ كلَّ ممسكٍ وينتظرُ خروجَه (‏فالقفلُ مُحرَّرٌ قبلَ الجولةِ التالية).
 * @param {import('node:child_process').ChildProcess[]} children
 */
const releaseAll = (children) =>
  Promise.all(
    children.map(
      (child) =>
        new Promise((resolve) => {
          if (child.exitCode !== null || child.signalCode !== null) return resolve(undefined);
          child.on('exit', resolve);
          child.stdin?.end();
        }),
    ),
  );

/** @param {import('node:child_process').ChildProcess} child */
const firstLine = (child) =>
  new Promise((resolve) => {
    let buf = '';
    child.stdout?.on('data', (d) => {
      buf += d;
      if (buf.includes('\n')) resolve(buf.split('\n')[0]);
    });
    child.on('exit', () => resolve(buf.split('\n')[0]));
  });

test('R8-01/6: عبرَ العمليّات — الرابطُ الرمزيُّ لا يفتحُ ما تمسكُهُ عمليّةٌ حيّة', async () => {
  await withDir(async (dir) => {
    const file = path.join(dir, 'events.log');
    const link = path.join(dir, 'alias.log');
    new PersistentEventLog(file, OPTS).close();
    symlinkSync(file, link);
    const owner = holder(file, 3000);
    assert.equal(await firstLine(owner), 'OPEN');
    const out = execFileSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `const { PersistentEventLog } = await import(${JSON.stringify(MODULE)});
         try { new PersistentEventLog(${JSON.stringify(link)}, { fsync: false, env: { NODE_ENV: 'test' } }); console.log('OPEN'); }
         catch (e) { console.log(e.code); }`,
      ],
      { env: { ...process.env, NODE_ENV: 'test' }, encoding: 'utf8' },
    ).trim();
    owner.kill();
    assert.equal(out, 'LOG_ALREADY_LOCKED');
  });
});

test('R8-01/7: التزامن — عمليّاتٌ متسابقةٌ على المسارِ والرابطِ معاً: كاتبٌ واحدٌ فقط', async () => {
  await withDir(async (dir) => {
    const file = path.join(dir, 'events.log');
    const link = path.join(dir, 'alias.log');
    new PersistentEventLog(file, OPTS).close();
    symlinkSync(file, link);
    const children = Array.from({ length: 6 }, (_, i) =>
      heldUntilReleased(i % 2 === 0 ? file : link),
    );
    const results = await Promise.all(children.map(firstLine));
    await releaseAll(children);
    assert.equal(results.filter((r) => r === 'OPEN').length, 1, JSON.stringify(results));
    assert.ok(
      results.every((r) => r === 'OPEN' || r === 'LOG_ALREADY_LOCKED'),
      JSON.stringify(results),
    );
  });
});

// WL-491 — انحدارُ سباقِ إنشاءِ القفلِ: كانت نافذةُ «ملفِّ قفلٍ بلا محتوى» بينَ
// `openSync('wx')` و`writeSync` تجعلُ المنافسَ يقرأُ مالكًا `null` فينتزعُ القفلَ من
// كاتبٍ حيٍّ — قِيسَ في CI (تشغيلةُ `40814498943`): كاتبانِ OPEN من ستّةِ متسابقين.
// الإصلاحُ أزالَ النافذةَ بالبناءِ (ملفٌّ مؤقتٌ كاملٌ ثم `linkSync` ذرّيٌّ)؛ وهذا
// الإجهادُ حارسُ الانحدارِ: جولاتٌ متتابعةٌ من السباقِ نفسِهِ، كاتبٌ واحدٌ فقط في
// كلِّ جولةٍ، والقفلُ الظاهرُ مقروءُ المحتوى دومًا.
test('R8-01/8: إجهادُ السباقِ — جولاتٌ متتابعةٌ، كاتبٌ واحدٌ فقط في كلِّ جولةٍ، والقفلُ مقروءُ المحتوى (انحدارُ WL-491)', async () => {
  await withDir(async (dir) => {
    const file = path.join(dir, 'events.log');
    const link = path.join(dir, 'alias.log');
    new PersistentEventLog(file, OPTS).close();
    symlinkSync(file, link);
    for (let round = 0; round < 15; round += 1) {
      const children = Array.from({ length: 6 }, (_, i) =>
        heldUntilReleased(i % 2 === 0 ? file : link),
      );
      const results = await Promise.all(children.map(firstLine));
      // القفلُ الظاهرُ والفائزُ ما زالَ يمسك: مقروءُ المحتوى ومالكُه الفائزُ نفسُه.
      const held = JSON.parse(readFileSync(file + LOG_LOCK_SUFFIX, 'utf8'));
      const winner = children[results.indexOf('OPEN')];
      await releaseAll(children);
      assert.equal(held.pid, winner?.pid, `جولةُ ${round}: القفلُ للفائز`);
      assert.equal(
        results.filter((r) => r === 'OPEN').length,
        1,
        `جولةُ ${round}: ${JSON.stringify(results)}`,
      );
      assert.ok(
        results.every((r) => r === 'OPEN' || r === 'LOG_ALREADY_LOCKED'),
        JSON.stringify(results),
      );
      // القفلُ الظاهرُ أثناءَ الإمساكِ مقروءُ المحتوى: مالكُهُ رقمُ عمليةٍ — فالقفلُ
      // الموجودُ موجودٌ بمحتواهُ، لا نافذةَ فارغةً تُقرأُ مالكًا مجهولًا.
      assert.equal(typeof held.pid, 'number', 'القفلُ يحملُ رقمَ عمليةٍ كاملًا');
      // وبعدَ الإطلاقِ المنظَّمِ يُحرَّرُ القفل.
      assert.equal(
        existsSync(file + LOG_LOCK_SUFFIX),
        false,
        `جولةُ ${round}: القفلُ مُحرَّرٌ بعدَ الإطلاق`,
      );
    }
  });
});

// WL-492 — استردادُ تصريحِ سرقةٍ ماتَ مالكُهُ: القفلُ الميتُ يُنتزَعُ تحتَ تصريحٍ حصريٍّ،
// والتصريحُ المتعطِّلُ نفسُهُ يُستردُّ **بمطالبةٍ ذرّيّةٍ** (renameSync) لا بحذفٍ أعمى بعدَ
// قراءةٍ متقادمةٍ — فلا يُحذفُ تصريحُ منافسٍ حيٍّ، ولا يبقى المتعطِّلُ معطِّلًا للأبدِ.
test('R8-01/9: تصريحُ سرقةٍ متعطِّلٌ (ماتَ مالكُهُ) يُستردُّ بالمطالبةِ الذرّيّةِ — والقفلُ الميتُ يُنتزعُ (انحدارُ WL-492)', async () => {
  await withDir(async (dir) => {
    const file = path.join(dir, 'events.log');
    new PersistentEventLog(file, OPTS).close();
    // عمليةٌ ماتت فعلًا (لا رقمًا مفترى): يُنتظَرُ خروجُها ثمَّ يُنسبُ إليها القفلُ والتصريحُ.
    const dead = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 20)']);
    const deadPid = dead.pid;
    await new Promise((resolve) => dead.on('exit', resolve));
    writeFileSync(file + LOG_LOCK_SUFFIX, JSON.stringify({ pid: deadPid, at: 'x' }));
    const permit = file + LOG_LOCK_SUFFIX + '.steal-permit';
    writeFileSync(permit, JSON.stringify({ pid: deadPid, at: 'x' }));
    const log = new PersistentEventLog(file, OPTS);
    try {
      assert.equal(log.events.length, 0, 'الفتحُ نجحَ بعدَ استردادِ القفلِ الميتِ');
      const lock = readFileSync(file + LOG_LOCK_SUFFIX, 'utf8');
      const parsed = JSON.parse(lock);
      assert.equal(parsed.pid, process.pid, 'والقفلُ الظاهرُ صارَ لنا بمحتواهُ الكامل');
      assert.equal(existsSync(permit), false, 'والتصريحُ لا يُترَكُ قائمًا بعدَ الاستردادِ');
    } finally {
      log.close();
    }
  });
});
