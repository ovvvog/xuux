// اختبارُ حاجزِ نظافةِ الجذورِ المؤقّتةِ — تحويلُ `LIVE-9` إلى سياسةٍ محروسةٍ
// (`WL-219`).
//
// **الحاجزُ يُنادى عمليّةً ابنةً كما يُناديه المسارُ الآليُّ**، ويُقاس فيه ما
// يُقاس في كلِّ حاجزٍ: أنّه يُصدِّقُ الشجرةَ القائمةَ، وأنّه **يَرفضُ فعلاً** عندَ
// إخلالٍ مُصطنَعٍ — فحاجزٌ لم يُرَ رافضاً مرّةً واحدةً حاجزٌ لا يُعرَفُ أيَرفضُ
// أصلاً. **ويُقاسُ معهُ سلوكُ المُعِينِ لا نصُّه وحدَه:** أنّ الجذرَ المُسجَّلَ
// **يزولُ فعلاً** عندَ خروجِ العمليّةِ، وأنّ التغليفَ **لا يُغيِّرُ القيمةَ**
// المُعادةَ فلا يُمَسُّ منطقُ اختبارٍ.

import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { registerTmpRoot, registeredTmpRoots } from '../helpers/tmp-roots.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const GUARD = path.join(ROOT, 'scripts/guard-test-tmp-hygiene.mjs');
const HELPER = path.join(ROOT, 'tests/helpers/tmp-roots.mjs');

/**
 * @param {string} [root]
 * @returns {{ status: number | null, stdout: string, stderr: string }}
 */
function runGuard(root = undefined) {
  const args = root === undefined ? [GUARD] : [GUARD, '--root', root];
  const outcome = spawnSync(process.execPath, args, { encoding: 'utf8', shell: false });
  return {
    status: outcome.status,
    stdout: String(outcome.stdout ?? ''),
    stderr: String(outcome.stderr ?? ''),
  };
}

/**
 * شجرةٌ مؤقّتةٌ صغيرةٌ **متعقَّبةٌ بـgit** — فالحاجزُ يقرأُ المتعقَّبَ لا ما على
 * القرصِ، وشجرةٌ بلا `git` تُخرِجُه بخطأٍ لا بحكمٍ.
 *
 * @param {Record<string, string>} files مسارٌ نسبيٌّ ← نصٌّ.
 * @returns {string} جذرُ الشجرةِ.
 */
function fixture(files) {
  const dir = registerTmpRoot(fs.mkdtempSync(path.join(os.tmpdir(), 'guard-tmp-hygiene-')));
  fs.mkdirSync(path.join(dir, 'scripts/lib'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'tests/helpers'), { recursive: true });
  fs.copyFileSync(GUARD, path.join(dir, 'scripts/guard-test-tmp-hygiene.mjs'));
  fs.copyFileSync(
    path.join(ROOT, 'scripts/lib/git-files.mjs'),
    path.join(dir, 'scripts/lib/git-files.mjs'),
  );
  fs.copyFileSync(HELPER, path.join(dir, 'tests/helpers/tmp-roots.mjs'));
  for (const [relative, text] of Object.entries(files)) {
    const target = path.join(dir, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, text, 'utf8');
  }
  for (const args of [
    ['init', '-q'],
    ['config', 'user.email', 'guard@example.invalid'],
    ['config', 'user.name', 'guard'],
    ['add', '-A'],
  ]) {
    spawnSync('git', args, { cwd: dir, encoding: 'utf8', shell: false });
  }
  return dir;
}

const CREATES = [
  "import fs from 'node:fs';",
  "import os from 'node:os';",
  "import path from 'node:path';",
].join('\n');

test('الحاجزُ يُصدِّقُ الشجرةَ القائمةَ — كلُّ موضعِ إنشاءٍ مُدبَّرُ المحوِ', () => {
  const outcome = runGuard();
  assert.equal(outcome.status, 0, `الحاجزُ رفضَ الشجرةَ القائمةَ:\n${outcome.stderr}`);
  assert.match(outcome.stdout, /موضعَ إنشاءِ جذرٍ مؤقّتٍ/);
});

test('R1: جذرٌ يُنشَأُ بلا تغليفٍ ولا `rmSync` يُرفَضُ، ويُسمّى مِلفُّه وسطرُه', () => {
  const dir = fixture({
    'tests/leak.test.mjs': `${CREATES}\nconst d = fs.mkdtempSync(path.join(os.tmpdir(), 'leak-'));\nconsole.log(d);\n`,
  });
  const outcome = runGuard(dir);
  assert.equal(outcome.status, 1, 'الحاجزُ قَبِلَ تسريباً صريحاً');
  assert.match(outcome.stderr, /tests\/leak\.test\.mjs:4/);
  assert.match(outcome.stderr, /لا يُدبِّرُ محوَهُ/);
});

test('R1: التغليفُ بـ`registerTmpRoot` يُقبَلُ — وهو العلاجُ الذي لا يَمَسُّ منطقَ اختبارٍ', () => {
  const dir = fixture({
    'tests/ok.test.mjs':
      `${CREATES}\nimport { registerTmpRoot } from '../helpers/tmp-roots.mjs';\n` +
      `const d = registerTmpRoot(fs.mkdtempSync(path.join(os.tmpdir(), 'ok-')));\nconsole.log(d);\n`,
  });
  const outcome = runGuard(dir);
  assert.equal(outcome.status, 0, `الحاجزُ رفضَ تغليفاً صحيحاً:\n${outcome.stderr}`);
});

test('R1: العُرفُ القائمُ (`rmSync` في الملفِّ) يُقبَلُ — فالحاجزُ لا يُلغي عُرفاً عاملاً', () => {
  const dir = fixture({
    'tests/legacy.test.mjs':
      `${CREATES}\nconst d = fs.mkdtempSync(path.join(os.tmpdir(), 'legacy-'));\n` +
      `fs.rmSync(d, { recursive: true, force: true });\n`,
  });
  assert.equal(runGuard(dir).status, 0);
});

test('R1: الفئةُ تُرفَضُ **بأيِّ اسمٍ** — لا قائمةَ استثناءٍ ولا لاحقةٌ مُميَّزةٌ', () => {
  const dir = fixture({
    'tests/newly/invented-name.test.mjs': `${CREATES}\nconst d = fs.mkdtempSync(path.join(os.tmpdir(), 'brand-new-prefix-'));\nconsole.log(d);\n`,
  });
  const outcome = runGuard(dir);
  assert.equal(outcome.status, 1, 'اسمٌ جديدٌ أفلتَ من السياسةِ');
  assert.match(outcome.stderr, /invented-name\.test\.mjs/);
});

test('R3: مُعِينٌ فُرِّغَ من عملِه يُرفَضُ — لا يُخرَسُ الحاجزُ بإبقاءِ الاسمِ', () => {
  const dir = fixture({
    'tests/ok.test.mjs': `${CREATES}\nconsole.log('x');\n`,
  });
  fs.writeFileSync(
    path.join(dir, 'tests/helpers/tmp-roots.mjs'),
    'export function registerTmpRoot(d) {\n  return d;\n}\n',
    'utf8',
  );
  spawnSync('git', ['add', '-A'], { cwd: dir, encoding: 'utf8', shell: false });
  const outcome = runGuard(dir);
  assert.equal(outcome.status, 1, 'مُعِينٌ لا يَمحو مرَّ بلا رفضٍ');
  assert.match(outcome.stderr, /R3/);
});

test('المُعِينُ يُعيدُ المسارَ نفسَه ويُسجِّلُه — فالتغليفُ لا يُغيِّرُ قيمةً', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tmp-roots-identity-'));
  const returned = registerTmpRoot(dir);
  assert.equal(returned, dir, 'التغليفُ غيَّرَ القيمةَ المُعادةَ');
  assert.ok(registeredTmpRoots().includes(dir), 'الجذرُ لم يُسجَّلْ');
});

test('سلوكٌ لا نصٌّ: الجذرُ المُسجَّلُ **يزولُ فعلاً** عندَ خروجِ العمليّةِ', () => {
  const helperUrl = new URL('file://' + HELPER).href;
  const program =
    `import fs from 'node:fs';\nimport os from 'node:os';\nimport path from 'node:path';\n` +
    `import { registerTmpRoot } from ${JSON.stringify(helperUrl)};\n` +
    `const d = registerTmpRoot(fs.mkdtempSync(path.join(os.tmpdir(), 'exit-purge-')));\n` +
    `fs.writeFileSync(path.join(d, 'f.txt'), 'x');\nprocess.stdout.write(d);\n`;
  const outcome = spawnSync(process.execPath, ['--input-type=module', '-e', program], {
    encoding: 'utf8',
    shell: false,
  });
  assert.equal(outcome.status, 0, `العمليّةُ الابنةُ فشلَت:\n${outcome.stderr}`);
  const created = String(outcome.stdout).trim();
  assert.notEqual(created, '', 'العمليّةُ الابنةُ لم تُخرِجْ مساراً');
  assert.equal(
    fs.existsSync(created),
    false,
    `الجذرُ ${created} بقيَ بعدَ خروجِ العمليّةِ — المحوُ عندَ الخروجِ لا يقعُ`,
  );
});

// ═══ ‏`WL-608` — تسرّبُ `xuux-ops1-*`: المحوُ عندَ كلِّ مسارِ إنهاء (‏انحدار) ═══════════════════════════════
// السببُ المقيس: ‏`SIGTERM`/`SIGINT`/`SIGHUP` تُنهي عمليّةَ Node بلا حدثِ `exit`، فكانَ كلُّ جذرٍ مُسجَّلٍ يبقى —
// وإيقافُ تشغيلةِ اختباراتٍ (‏أبٍ `node --test` أو ابنٍ) تركَ عشراتِ `xuux-ops1-*` (‏15 جذراً في كلِّ تشغيلةٍ للملفّ).
// تُقاسُ هنا كلُّ مسارات: نجاح، فشلُ توكيد، استثناءٌ غيرُ ملتقَط، مهلةُ اختبار، إشاراتُ الإنهاء، مُستمِعٌ آخر،
// و`SIGKILL` (‏حدٌّ معلَن: يبقى، ويُمحى هنا بيدِ الاختبارِ لأنّه أنشأه).

/**
 * يُشغِّلُ برنامجاً ابناً يُسجِّلُ جذراً ويطبعُ مسارَه، ثمّ يُرسِلُ إليه `signal` إن طُلِب.
 * @param {string} body ما يُنفَّذُ بعدَ التسجيل (‏`d` مسارُ الجذر)
 * @param {{ signal?: NodeJS.Signals, args?: string[], file?: boolean }} [opts]
 * @returns {Promise<{ dir: string, code: number | null, signal: NodeJS.Signals | null, aliveAfterSignal?: boolean, existedAtSignal?: boolean, stdout: string }>}
 */
function runRegistered(body, opts = {}) {
  const helperUrl = new URL('file://' + HELPER).href;
  // ‏المسارُ يُكتَبُ في ملفٍّ لا في stdout: ‏`node --test` يحجزُ مخرجَ ابنِه حتى ينتهي.
  const scratch = registerTmpRoot(fs.mkdtempSync(path.join(os.tmpdir(), 'tmp-roots-wl608-')));
  const handshake = path.join(scratch, 'dir.txt');
  const program =
    `import fs from 'node:fs';\nimport os from 'node:os';\nimport path from 'node:path';\nimport test from 'node:test';\n` +
    `import { registerTmpRoot } from ${JSON.stringify(helperUrl)};\n` +
    `const d = registerTmpRoot(fs.mkdtempSync(path.join(os.tmpdir(), 'xuux-wl608-purge-')));\n` +
    `fs.writeFileSync(path.join(d, 'f.txt'), 'x');\nfs.writeFileSync(${JSON.stringify(handshake)}, d);\n${body}\n`;
  /** @type {string[]} */
  let args;
  if (opts.file) {
    const f = path.join(scratch, 'child.test.mjs');
    fs.writeFileSync(f, program);
    args = [...(opts.args ?? []), f];
  } else {
    args = ['--input-type=module', '-e', program];
  }
  return new Promise((resolve, reject) => {
    // ‏`NODE_TEST_CONTEXT` موروثٌ من عدّاءِ هذا الملفّ يجعلُ `node --test` الابنَ يتكلّمُ بروتوكولَ الأبِ لا TAP.
    const { NODE_TEST_CONTEXT: _ctx, ...env } = process.env;
    const child = spawn(process.execPath, args, { stdio: ['ignore', 'pipe', 'pipe'], env });
    let stdout = '';
    let dir = '';
    /** @type {{ aliveAfterSignal?: boolean, existedAtSignal?: boolean }} */
    const seen = {};
    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
    });
    const poll = setInterval(() => {
      if (dir !== '' || !fs.existsSync(handshake)) return;
      dir = fs.readFileSync(handshake, 'utf8');
      if (dir === '') return;
      clearInterval(poll);
      if (opts.signal) {
        const sig = opts.signal;
        setTimeout(() => {
          seen.existedAtSignal = fs.existsSync(dir);
          child.kill(sig);
          setTimeout(() => {
            seen.aliveAfterSignal = child.exitCode === null && child.signalCode === null;
          }, 150);
        }, 100);
      }
    }, 20);
    child.on('error', reject);
    child.on('close', (code, signal) => {
      clearInterval(poll);
      if (dir === '' && fs.existsSync(handshake)) dir = fs.readFileSync(handshake, 'utf8');
      setTimeout(() => resolve({ dir, code, signal, stdout, ...seen }), 0);
    });
  });
}

for (const sig of /** @type {const} */ (['SIGTERM', 'SIGINT', 'SIGHUP'])) {
  test(`WL-608: إشارةُ ${sig} تمحو الجذرَ المُسجَّلَ وتُبقي الإنهاءَ بالإشارةِ نفسِها (‏كانَ يبقى)`, async () => {
    const r = await runRegistered('setInterval(() => {}, 1000);', { signal: sig });
    assert.notEqual(r.dir, '');
    assert.equal(r.existedAtSignal, true, 'الجذرُ قائمٌ قبلَ الإشارة');
    assert.equal(r.signal, sig, `الإنهاءُ بالإشارةِ نفسِها لا برمزٍ آخر (${r.code}/${r.signal})`);
    assert.equal(fs.existsSync(r.dir), false, `${r.dir} بقيَ بعدَ ${sig}`);
  });
}

test('WL-608: مُستمِعٌ آخرُ للإشارة ⇒ لا محوَ وقتَها (‏الجذرُ قد يكونُ قيدَ الاستعمال)، ويُمحى عندَ الخروجِ الذي قرّرَه صاحبُه', async () => {
  const r = await runRegistered(
    `process.on('SIGTERM', () => { process.stdout.write('HANDLED ' + fs.existsSync(d) + '\\n'); setTimeout(() => process.exit(0), 300); });\nsetInterval(() => {}, 1000);`,
    { signal: 'SIGTERM' },
  );
  assert.match(r.stdout, /HANDLED true/, 'الجذرُ باقٍ داخلَ مُستمِعِ صاحبِه');
  assert.equal(r.aliveAfterSignal, true, 'العمليّةُ لم تُقتَل بإعادةِ الإشارة');
  assert.equal(r.code, 0);
  assert.equal(fs.existsSync(r.dir), false, 'ويُمحى عندَ الخروج');
});

test('WL-608: فشلُ توكيدٍ واستثناءٌ غيرُ ملتقَطٍ ورفضٌ غيرُ معالَجٍ ⇒ الجذرُ يُمحى', async () => {
  for (const body of [
    `import('node:assert/strict').then((a) => a.default.equal(1, 2));`,
    `setTimeout(() => { throw new Error('boom'); }, 10);`,
    `Promise.reject(new Error('unhandled'));`,
    `process.exit(3);`,
  ]) {
    const r = await runRegistered(body);
    assert.notEqual(r.code, 0, body);
    assert.equal(fs.existsSync(r.dir), false, `${body}: ${r.dir} بقي`);
  }
});

test('WL-608: مهلةُ اختبارٍ تحتَ node --test ⇒ الملفُّ يفشلُ والجذرُ يُمحى عندَ خروجِه', async () => {
  const r = await runRegistered(
    `test('hang', { timeout: 200 }, () => new Promise((res) => setTimeout(res, 1500)));`,
    { file: true, args: ['--test', '--test-reporter=tap'] },
  );
  assert.match(r.stdout, /not ok/);
  assert.equal(fs.existsSync(r.dir), false, `${r.dir} بقيَ بعدَ المهلة`);
});

test('WL-608: إيقافُ عدّاءِ node --test نفسِه بـSIGTERM أثناءَ اختبارٍ جارٍ ⇒ جذرُ الابنِ يُمحى', async () => {
  const r = await runRegistered(
    `test('long', () => new Promise((res) => setTimeout(res, 20000)));`,
    {
      file: true,
      args: ['--test', '--test-reporter=tap'],
      signal: 'SIGTERM',
    },
  );
  assert.notEqual(r.dir, '');
  // ‏الأبُ يُنهي ابنَه: لا يُنتظَرُ إلا قليلاً حتى يُمحى.
  for (let i = 0; i < 40 && fs.existsSync(r.dir); i++)
    await new Promise((res) => setTimeout(res, 50));
  assert.equal(fs.existsSync(r.dir), false, `${r.dir} بقيَ بعدَ إيقافِ العدّاء`);
});

test('WL-608 حدٌّ معلَن: SIGKILL لا يُلتقَط ⇒ الجذرُ يبقى (‏يُمحى هنا لأنّ الاختبارَ أنشأه)', async () => {
  const r = await runRegistered('setInterval(() => {}, 1000);', { signal: 'SIGKILL' });
  assert.equal(r.signal, 'SIGKILL');
  assert.equal(fs.existsSync(r.dir), true, 'لو زالَ لكانَ الحدُّ المعلَنُ خاطئاً');
  fs.rmSync(r.dir, { recursive: true, force: true });
});
