// بصمةُ نطاقِ القياسِ — قياسُ الهويّةِ لا وصفُها (‏`OPS-1`).
//
// **ما يُقاسُ هنا:** أنَّ البصمةَ حتميّةٌ، وأنّها تَتغيَّرُ بما يجبُ أن يُغيِّرَها،
// **وأنّها لا تَتغيَّرُ بما لولا استثناؤهُ لَدارَ الأثرُ على نفسِهِ**، وأنَّ القراءةَ
// الآمنةَ تَرى المسارَ العربيَّ الذي تُخفيهِ القراءةُ الساذجةُ (‏`DOC-11`).

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { registerTmpRoot } from '../helpers/tmp-roots.mjs';
import {
  initFixtureRepo,
  commitFiles,
  removeAndCommit,
  git,
  writeFile,
} from '../helpers/skip-baseline-fixture.mjs';
import {
  computeScopeDigest,
  listScopeEntries,
  loadScopeExclusions,
  isExcluded,
  scopeDiff,
  listTreePathsQuoted,
  SCOPE_CONFIG,
} from '../../scripts/lib/skip-baseline-scope.mjs';

/** @returns {string} جذرٌ مؤقّتٌ مُسجَّلٌ للمحوِ — سياسةُ `LIVE-9`. */
function makeRoot() {
  return registerTmpRoot(mkdtempSync(path.join(os.tmpdir(), 'xuux-scope-')));
}

test('و١ — البصمةُ حتميّةٌ: نداءانِ على الكوميتِ نفسِهِ يُعطيانِ بصمةً واحدةً', () => {
  const dir = makeRoot();
  const sha = initFixtureRepo(dir);
  const first = computeScopeDigest(dir, sha);
  const second = computeScopeDigest(dir, sha);
  assert.equal(first, second);
  assert.match(first, /^[0-9a-f]{64}$/);
});

test('و٢ — تغييرُ ملفٍّ في `src/` يُبدِّلُ البصمةَ', () => {
  const dir = makeRoot();
  const before = initFixtureRepo(dir);
  const after = commitFiles(dir, { 'src/core.mjs': 'export const value = 2;\n' });
  assert.notEqual(
    computeScopeDigest(dir, before),
    computeScopeDigest(dir, after),
    'تغييرٌ في النطاقِ يجبُ أن يُبدِّلَ البصمةَ — وإلا فالقاعدةُ لا تَحرُسُ.',
  );
});

test('و٢ب — تغييرُ صلاحيّةِ ملفٍّ وحدَها يُبدِّلُ البصمةَ (البصمةُ تَقرأُ `mode`)', () => {
  const dir = makeRoot();
  const before = initFixtureRepo(dir);
  git(dir, ['update-index', '--chmod=+x', 'src/core.mjs']);
  git(dir, ['commit', '--quiet', '-m', 'fixture: صلاحيّةٌ']);
  const after = git(dir, ['rev-parse', 'HEAD']).trim();
  assert.notEqual(computeScopeDigest(dir, before), computeScopeDigest(dir, after));
});

test('و٢ج — إعادةُ تسميةٍ بلا تغييرِ محتوىً تُبدِّلُ البصمةَ (البصمةُ تَقرأُ المسارَ)', () => {
  const dir = makeRoot();
  const before = initFixtureRepo(dir);
  git(dir, ['mv', 'src/core.mjs', 'src/renamed.mjs']);
  git(dir, ['commit', '--quiet', '-m', 'fixture: تسميةٌ']);
  const after = git(dir, ['rev-parse', 'HEAD']).trim();
  assert.notEqual(computeScopeDigest(dir, before), computeScopeDigest(dir, after));
});

test('و٣ — تغييرُ ملفٍّ تحتَ `docs/` **لا** يُبدِّلُ البصمةَ — الاستثناءُ المُعلَنُ نافذٌ', () => {
  const dir = makeRoot();
  const before = initFixtureRepo(dir);
  const after = commitFiles(dir, {
    'docs/roadmap/05-work-log.md': '## WL-999\nمُدخلةٌ جديدةٌ\n',
    'docs/external-review/M11.05-round-1-plan.md': '# خطّةٌ مُعدَّلةٌ\n',
  });
  assert.equal(
    computeScopeDigest(dir, before),
    computeScopeDigest(dir, after),
    'لو أبطلَت مُدخلةُ سجلٍّ الأثرَ لَما أمكنَ نشرُ أثرٍ أصلاً — جمودُ LIVE-16 من بابٍ آخرَ.',
  );
});

test('و٤ — تغييرُ `PROJECT_STATUS.md` **لا** يُبدِّلُ البصمةَ', () => {
  const dir = makeRoot();
  const before = initFixtureRepo(dir, { extraFiles: { 'PROJECT_STATUS.md': 'آخر تحديث: أ\n' } });
  const after = commitFiles(dir, { 'PROJECT_STATUS.md': 'آخر تحديث: ب\n' });
  assert.equal(computeScopeDigest(dir, before), computeScopeDigest(dir, after));
});

test('و٤ب — الأثرُ نفسُهُ خارجُ النطاقِ: كتابةُ `skip-baseline.json` لا تُبدِّلُ البصمةَ', () => {
  const dir = makeRoot();
  const before = initFixtureRepo(dir);
  const after = commitFiles(dir, {
    'docs/external-review/skip-baseline.json': '{"contractVersion":2,"measurements":[]}\n',
  });
  assert.equal(
    computeScopeDigest(dir, before),
    computeScopeDigest(dir, after),
    'أثرٌ يُبطِلُ نفسَهُ بمجرَّدِ نشرِهِ دورانٌ لا حِراسةٌ.',
  );
});

test('و٥ — مسارٌ عربيٌّ: القراءةُ الآمنةُ تراهُ والساذجةُ تُهرِّبُهُ (‏`DOC-11`)', () => {
  const dir = makeRoot();
  const arabic = 'src/ولاية-001/وحدة.mjs';
  const sha = initFixtureRepo(dir, { extraFiles: { [arabic]: 'export const x = 1;\n' } });

  const safe = listScopeEntries(dir, sha).map((e) => e.path);
  assert.ok(
    safe.includes(arabic),
    'القراءةُ بـ`-z` يجبُ أن ترى المسارَ العربيَّ كما هو على القرصِ.',
  );

  const naive = listTreePathsQuoted(dir, sha);
  assert.ok(
    !naive.includes(arabic),
    'القراءةُ الساذجةُ تُهرِّبُ المسارَ — وهذا هوَ العَطَبُ الذي يُقاسُ لا يُوصَفُ.',
  );
  assert.ok(
    naive.some((p) => p.startsWith('"') && p.includes('\\3')),
    'وهذا شكلُ التهريبِ: اقتباسٌ وثُمانيّاتٌ.',
  );
});

test('و٥ب — والمسارُ العربيُّ داخلٌ في البصمةِ فعلاً: تغييرُهُ يُبدِّلُها', () => {
  const dir = makeRoot();
  const arabic = 'src/ولاية-001/وحدة.mjs';
  const before = initFixtureRepo(dir, { extraFiles: { [arabic]: 'export const x = 1;\n' } });
  const after = commitFiles(dir, { [arabic]: 'export const x = 2;\n' });
  assert.notEqual(
    computeScopeDigest(dir, before),
    computeScopeDigest(dir, after),
    'مسارٌ يُقرأُ ولا يَدخُلُ البصمةَ حاجزٌ يَحرُسُ وجودَ ردٍّ لا صحّتَهُ.',
  );
});

test('و٦ — مجلَّدٌ جديدٌ غيرُ مُستثنىً يَدخُلُ النطاقَ تلقائيّاً (فائضٌ بالاستثناءِ)', () => {
  const dir = makeRoot();
  const before = initFixtureRepo(dir);
  const after = commitFiles(dir, { 'engines/جديد/ملف.mjs': 'export const y = 1;\n' });
  assert.notEqual(
    computeScopeDigest(dir, before),
    computeScopeDigest(dir, after),
    'قائمةُ إذنٍ تَرهَلُ فيَخرُجُ منها ملفٌّ بلا خطأٍ — ولذلكَ النطاقُ فائضٌ بالاستثناءِ.',
  );
  assert.ok(listScopeEntries(dir, after).some((e) => e.path === 'engines/جديد/ملف.mjs'));
});

test('و٧ — طفرةٌ: نزعُ `docs/` من الاستثناءِ يُدخِلُها النطاقَ فتُبدِّلُ البصمةَ', () => {
  const dir = makeRoot();
  initFixtureRepo(dir);
  const sha = commitFiles(dir, { 'docs/roadmap/05-work-log.md': '## WL-999\n' });
  const declared = computeScopeDigest(dir, sha);
  const mutated = computeScopeDigest(dir, sha, ['PROJECT_STATUS.md']);
  assert.notEqual(
    declared,
    mutated,
    'كلُّ مسارٍ يُضافُ إلى الاستثناءِ يُنشئُ بقعةً عمياءَ — فالإعلانُ يُحرَسُ لا يُوسَّعُ صامتاً.',
  );
});

test('و٨ — الإعلانُ يُقرأُ YAML برنامجاً، ويَسقُطُ برمزٍ مُسمَّىً إن غابَ أو فَسَدَ', () => {
  const dir = makeRoot();
  initFixtureRepo(dir);
  assert.deepEqual(loadScopeExclusions(dir), ['docs/', 'PROJECT_STATUS.md']);

  const broken = makeRoot();
  initFixtureRepo(broken, { scopeYaml: 'version: 1\nnonScope: "ليسَ قائمةً"\n' });
  assert.throws(() => loadScopeExclusions(broken), /SCOPE_CONFIG_SHAPE/);

  const missing = makeRoot();
  initFixtureRepo(missing);
  removeAndCommit(missing, SCOPE_CONFIG);
  assert.throws(() => loadScopeExclusions(missing), /SCOPE_CONFIG_MISSING/);
});

test('و٩ — `isExcluded` يُطابِقُ البادئةَ والمسارَ التامَّ ولا يُطابِقُ ما شابَهَ', () => {
  const exclusions = ['docs/', 'PROJECT_STATUS.md'];
  assert.equal(isExcluded('docs/roadmap/05-work-log.md', exclusions), true);
  assert.equal(isExcluded('PROJECT_STATUS.md', exclusions), true);
  assert.equal(isExcluded('src/docs/readme.md', exclusions), false);
  assert.equal(isExcluded('scripts/core.mjs', exclusions), false);
});

test('و١٠ — `scopeDiff` يُسمّي ما اختلفَ: هذا ما يُطبَعُ عندَ الرفضِ فلا يُخمَّنُ', () => {
  const dir = makeRoot();
  const before = initFixtureRepo(dir);
  const after = commitFiles(dir, {
    'src/core.mjs': 'export const value = 9;\n',
    'src/new.mjs': 'export const n = 1;\n',
    'docs/ignored.md': 'لا يَظهرُ\n',
  });
  const diff = scopeDiff(dir, before, after);
  assert.ok(diff.includes('~ src/core.mjs'), JSON.stringify(diff));
  assert.ok(diff.includes('+ src/new.mjs'), JSON.stringify(diff));
  assert.ok(
    !diff.some((d) => d.includes('docs/')),
    'المُستثنى لا يَظهرُ في الفرقِ — وإلا أَرسلَ المنفِّذَ إلى إصلاحٍ لا يَلزَمُ.',
  );
});

test('و١١ — المستودَعُ الحقيقيُّ: الإعلانُ المُقيَّدُ هوَ `docs/` و`PROJECT_STATUS.md` وحدَهما', () => {
  // قياسٌ على المستودَعِ نفسِهِ لا على جذرٍ مصنوعٍ: كلُّ مسارٍ يُضافُ إلى
  // الاستثناءِ بقعةٌ عمياءُ، فالتوسيعُ يجبُ أن يُسقِطَ اختباراً لا أن يَمُرَّ.
  const repoRoot = path.resolve(import.meta.dirname, '..', '..');
  assert.deepEqual(loadScopeExclusions(repoRoot), ['docs/', 'PROJECT_STATUS.md']);
});

test('و١٢ — جذرٌ بلا `git` يَرمي ولا يُعيدُ بصمةً كاذبةً', () => {
  const dir = makeRoot();
  writeFile(dir, 'config/skip-baseline-scope.yaml', 'version: 1\nnonScope: []\n');
  assert.throws(() => computeScopeDigest(dir, 'HEAD'));
});
