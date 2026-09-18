/**
 * `DOC-11` — **الإخفاءُ الصامتُ في فهرسِ Git، وقائمةُ إذنٍ أوسعُ من واقعِها.**
 *
 * هذا الملفُّ يُثبِتُ ثلاثةَ أشياءَ **بالقياسِ لا بالوصفِ**:
 *
 * 1. أنّ العَطَبَ **واقعٌ**: القراءةُ سطراً سطراً من `git ls-files` تُخفي مساراتِ
 *    المستودعِ غيرَ ASCII، فتنقُصُ عن القراءةِ بـ`-z`.
 * 2. أنّ الإخفاءَ **يُبطِلُ فحصاً أمنيّاً**: مادّةُ مفاتيحَ متعقَّبةٌ تحتَ مسارٍ عربيٍّ
 *    تمرُّ من مُرشِّحِ اللاحقةِ — ويُقاسُ ذلك في مستودعٍ مصنوعٍ لا في فرضٍ.
 * 3. أنّ حاجزَ القوالبِ صارَ **يرفضُ إذناً نائماً** — مُطفَرةً تُسقِطُه ثمّ يُردُّ
 *    الأصلُ بايتاً ببايتٍ ويُثبَتُ ردُّه.
 *
 * **وسببُ وجودِ الدَّينِ نفسِه هذا العَطَبُ:** قيلَ في `WL-200` إنّ ثلاثةَ مساراتٍ
 * مأذونةٍ «لم تبقَ»، والقياسُ الصحيحُ يقولُ إنّها على القرصِ ومتعقَّبةٌ — وإنّما
 * أخفاها الاقتباسُ. فالدَّينُ أُغلِقَ **بتكذيبِ مقدّمتِه** لا بتقليمٍ لا مُقلَّمَ له.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { registerTmpRoot } from '../helpers/tmp-roots.mjs';

import { listTrackedFiles, listTrackedFilesQuoted } from '../../scripts/lib/git-files.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const ALLOWLIST = path.join(ROOT, 'docs/audit/template-allowlist.txt');

const SPEC = /test\.spec\.ts$/;

test('القراءةُ الساذجةُ تُخفي مساراتَ المستودعِ غيرَ ASCII والقراءةُ بـ`-z` تُظهِرُها', () => {
  const safe = listTrackedFiles({ cwd: ROOT }).filter((file) => SPEC.test(file));
  const naive = listTrackedFilesQuoted({ cwd: ROOT }).filter((file) => SPEC.test(file));

  assert.ok(
    safe.length > 0,
    'لا ملفَّ `test.spec.ts` متعقَّبٌ أصلاً — تغيّرَ المستودعُ فيُعادُ النظرُ.',
  );
  assert.ok(
    naive.length < safe.length,
    `العَطَبُ لم يُقَسْ: الساذجةُ ${naive.length} والآمنةُ ${safe.length}. إن تساوتا فإمّا زالَت المساراتُ العربيّةُ وإمّا صارَ \`core.quotePath\` معطَّلاً — وفي الحالتين يُعادُ النظرُ في هذا التوكيدِ لا يُحذَفُ.`,
  );

  // وكلُّ ما تُظهِرُه القراءةُ الآمنةُ موجودٌ فعلاً على القرصِ: فالإظهارُ ليس ضجيجاً.
  for (const file of safe) {
    assert.ok(fs.existsSync(path.join(ROOT, file)), `مسارٌ ظهرَ ولا وجودَ له: ${file}`);
  }

  // والمُخفَى ليس مُتخيَّلاً: أسماءُ ما أخفتْه الساذجةُ تحتوي محارفَ غيرَ ASCII.
  const hidden = safe.filter((file) => !naive.includes(file));
  assert.ok(hidden.length > 0, 'لم يُحدَّدْ ما أُخفِيَ.');
  for (const file of hidden) {
    // eslint-disable-next-line no-control-regex
    assert.match(file, /[^\x00-\x7F]/, `أُخفِيَ مسارٌ ASCII — فالعلّةُ غيرُ الاقتباسِ: ${file}`);
  }
});

test('الإخفاءُ يُمرِّرُ مادّةَ مفاتيحَ متعقَّبةً تحتَ مسارٍ عربيٍّ — والقراءةُ الآمنةُ تُوقِفُها', () => {
  const dir = registerTmpRoot(fs.mkdtempSync(path.join(os.tmpdir(), 'xuux-doc11-')));
  try {
    const run = (/** @type {string[]} */ args) =>
      execFileSync('git', args, { cwd: dir, encoding: 'utf8' });
    run(['init', '-q']);
    run(['config', 'user.email', 'test@example.invalid']);
    run(['config', 'user.name', 'test']);
    const secretDir = path.join(dir, 'مفاتيحُ-سرّيّةٌ');
    fs.mkdirSync(secretDir);
    // النصُّ يُركَّبُ في زمنِ التشغيلِ لا يُكتَبُ حرفيّاً: `npm run scan:secrets` **صرخَ**
    // على هذا المِجَسِّ حين كُتِبَ حرفيّاً — وهو صوابٌ من الحاجزِ، **فلم يُستَثنَ بعلامةِ
    // إذنٍ** بل رُكِّبَ من شقَّينِ، فيبقى الحاجزُ حادّاً على كتلةٍ حقيقيّةٍ.
    const fakeKey = `${'-----BEGIN'} ${'PRIVATE KEY-----'}\n`;
    fs.writeFileSync(path.join(secretDir, 'server.pem'), fakeKey);
    run(['add', '-A']);
    run(['commit', '-qm', 'x']);

    const KEYS = /\.(pem|key|p12|pfx)$/;
    const naive = listTrackedFilesQuoted({ cwd: dir }).filter((file) => KEYS.test(file));
    const safe = listTrackedFiles({ cwd: dir }).filter((file) => KEYS.test(file));

    assert.deepEqual(
      naive,
      [],
      'المُرشِّحُ الساذجُ رأى المفتاحَ — فالفرضيّةُ تغيّرَت ويُعادُ النظرُ.',
    );
    assert.equal(safe.length, 1, 'القراءةُ الآمنةُ لم تُوقِفِ المفتاحَ — العلاجُ لا يُعالِجُ.');
    assert.match(safe[0] ?? '', /server\.pem$/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('كلُّ مسارٍ في قائمةِ إذنِ القوالبِ موجودٌ على القرصِ ومتعقَّبٌ', () => {
  const tracked = new Set(listTrackedFiles({ cwd: ROOT }));
  const entries = fs
    .readFileSync(ALLOWLIST, 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'));

  assert.ok(entries.length > 0, 'قائمةُ الإذنِ فارغةٌ فالتوكيدُ أجوفُ.');
  const stale = entries.filter((rel) => !fs.existsSync(path.join(ROOT, rel)) || !tracked.has(rel));
  assert.deepEqual(stale, [], `إذنٌ نائمٌ في القائمةِ: ${stale.join(' · ')}`);
});

test('حاجزُ القوالبِ يسقُطُ على إذنٍ نائمٍ — مُطفَرةً، والأصلُ يُردُّ', () => {
  const original = fs.readFileSync(ALLOWLIST);
  const probes = [
    { line: 'civilization/001-domain/لا-وجودَ-له.md', needle: 'لا وجودَ له على القرصِ' },
    { line: null, needle: 'موجودٌ وغيرُ متعقَّبٍ في Git' },
  ];
  const untracked = path.join(ROOT, 'civilization/001-domain/probe-doc11-untracked.md');

  try {
    for (const probe of probes) {
      let rel = probe.line;
      if (rel === null) {
        fs.writeFileSync(untracked, 'مِجَسٌّ مؤقّتٌ.\n');
        rel = 'civilization/001-domain/probe-doc11-untracked.md';
      }
      fs.writeFileSync(ALLOWLIST, `${original.toString('utf8')}${rel}\n`);
      let code = 0;
      let out = '';
      try {
        out = execFileSync('node', ['scripts/guard-templates.mjs'], {
          cwd: ROOT,
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe'],
        });
      } catch (error) {
        const failure = /** @type {{ status?: number, stdout?: string, stderr?: string }} */ (
          error
        );
        code = failure.status ?? -1;
        out = `${failure.stdout ?? ''}${failure.stderr ?? ''}`;
      }
      assert.notEqual(code, 0, `الحاجزُ لم يسقُطْ على: ${rel}`);
      assert.match(out, /قائمة الإذن أوسع من واقعها/);
      assert.ok(out.includes(probe.needle), `سببُ الرفضِ لم يُطبَعْ: ${probe.needle}`);
      fs.writeFileSync(ALLOWLIST, original);
      fs.rmSync(untracked, { force: true });
    }
  } finally {
    fs.writeFileSync(ALLOWLIST, original);
    fs.rmSync(untracked, { force: true });
  }

  assert.deepEqual(fs.readFileSync(ALLOWLIST), original, 'لم يُردَّ الأصلُ بايتاً ببايتٍ.');
  assert.equal(fs.existsSync(untracked), false, 'بقيَ المِجَسُّ على القرصِ.');
  const after = execFileSync('node', ['scripts/guard-templates.mjs'], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  assert.match(after, /مداخل إذنٍ متروكة \(لا ملفَّ لها أو غير متعقَّبة\): 0/);
});
