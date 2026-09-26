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
  loadScopeExclusionsAt,
  isExcluded,
  scopeDiff,
  listTreePathsQuoted,
  SCOPE_CONFIG,
} from '../../scripts/lib/skip-baseline-scope.mjs';

/** @returns {string} جذرٌ مؤقّتٌ مُسجَّلٌ للمحوِ — سياسةُ `LIVE-9`. */
function makeRoot() {
  return registerTmpRoot(mkdtempSync(path.join(os.tmpdir(), 'xuux-scope-')));
}

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');

/**
 * الإعلانُ المُقيَّدُ — **مكتوبٌ هنا نصّاً لا مقروءاً**، فأيُّ تعديلٍ على
 * `config/skip-baseline-scope.yaml` يُسقِطُ `و١١` حتّى يُعدَّلَ هذا معَهُ عمداً.
 */
const REPO_EXCLUSIONS = [
  // ── تضييقُ النطاقِ (‏`OPS-1/R7-COST` · `WL-270`): أدلةٌ مصدريّةٌ وقوالبُ ──
  'src/',
  'scripts/',
  '.github/',
  'civilization/',
  'migrations/',
  'federation/',
  'institutions/',
  'knowledge/',
  'sim/',
  'clients/',
  'constitution/',
  'contracts/',
  'data-platform/',
  'engines/',
  'infrastructure/',
  'interfaces/',
  'operations/',
  'seed/',
  'web/',
  // ── ملفّاتُ المُحاسَبةِ السبعةُ (‏`WL-265`) ──
  'PROJECT_STATUS.md',
  'docs/READINESS_REPORT.md',
  'docs/external-review/M11.05-round-1-plan.md',
  'docs/external-review/M11.06-round-2-plan.md',
  'docs/external-review/skip-baseline.json',
  'docs/roadmap/05-work-log.md',
  'docs/roadmap/06-debt-register.md',
];

test('و١ — البصمةُ حتميّةٌ: نداءانِ على الكوميتِ نفسِهِ يُعطيانِ بصمةً واحدةً', () => {
  const dir = makeRoot();
  const sha = initFixtureRepo(dir);
  const first = computeScopeDigest(dir, sha);
  const second = computeScopeDigest(dir, sha);
  assert.equal(first, second);
  assert.match(first, /^[0-9a-f]{64}$/);
});

test('و٢ — تغييرُ ملفٍّ في `tests/` يُبدِّلُ البصمةَ', () => {
  const dir = makeRoot();
  const before = initFixtureRepo(dir);
  const after = commitFiles(dir, { 'tests/core.test.mjs': 'export const value = 2;\n' });
  assert.notEqual(
    computeScopeDigest(dir, before),
    computeScopeDigest(dir, after),
    'تغييرٌ في النطاقِ يجبُ أن يُبدِّلَ البصمةَ — وإلا فالقاعدةُ لا تَحرُسُ.',
  );
});

test('و٢ب — تغييرُ صلاحيّةِ ملفٍّ وحدَها يُبدِّلُ البصمةَ (البصمةُ تَقرأُ `mode`)', () => {
  const dir = makeRoot();
  const before = initFixtureRepo(dir);
  git(dir, ['update-index', '--chmod=+x', 'tests/alpha.test.mjs']);
  git(dir, ['commit', '--quiet', '-m', 'fixture: صلاحيّةٌ']);
  const after = git(dir, ['rev-parse', 'HEAD']).trim();
  assert.notEqual(computeScopeDigest(dir, before), computeScopeDigest(dir, after));
});

test('و٢ج — إعادةُ تسميةٍ بلا تغييرِ محتوىً تُبدِّلُ البصمةَ (البصمةُ تَقرأُ المسارَ)', () => {
  const dir = makeRoot();
  const before = initFixtureRepo(dir);
  git(dir, ['mv', 'tests/alpha.test.mjs', 'tests/renamed.test.mjs']);
  git(dir, ['commit', '--quiet', '-m', 'fixture: تسميةٌ']);
  const after = git(dir, ['rev-parse', 'HEAD']).trim();
  assert.notEqual(computeScopeDigest(dir, before), computeScopeDigest(dir, after));
});

test('و٣ — تغييرُ ملفِّ مُحاسَبةٍ تحتَ `docs/` **لا** يُبدِّلُ البصمةَ — الاستثناءُ المُعلَنُ نافذٌ', () => {
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
  const arabic = 'tests/ولاية-001/وحدة.mjs';
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
  const arabic = 'tests/ولاية-001/وحدة.mjs';
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
  const after = commitFiles(dir, { 'tests/جديد/ملف.mjs': 'export const y = 1;\n' });
  assert.notEqual(
    computeScopeDigest(dir, before),
    computeScopeDigest(dir, after),
    'قائمةُ إذنٍ تَرهَلُ فيَخرُجُ منها ملفٌّ بلا خطأٍ — ولذلكَ النطاقُ فائضٌ بالاستثناءِ.',
  );
  assert.ok(listScopeEntries(dir, after).some((e) => e.path === 'tests/جديد/ملف.mjs'));
});

test('و٧ — طفرةٌ: نزعُ سجلِّ الأعمالِ من الاستثناءِ يُدخِلُهُ النطاقَ فتُبدِّلُ البصمةَ', () => {
  const dir = makeRoot();
  initFixtureRepo(dir);
  const sha = commitFiles(dir, { 'docs/roadmap/05-work-log.md': '## WL-999\n' });
  const declared = computeScopeDigest(dir, sha);
  const mutated = computeScopeDigest(
    dir,
    sha,
    loadScopeExclusions(dir).filter((e) => e !== 'docs/roadmap/05-work-log.md'),
  );
  assert.notEqual(
    declared,
    mutated,
    'كلُّ مسارٍ يُضافُ إلى الاستثناءِ يُنشئُ بقعةً عمياءَ — فالإعلانُ يُحرَسُ لا يُوسَّعُ صامتاً.',
  );
});

test('و٨ — الإعلانُ يُقرأُ YAML برنامجاً، ويَسقُطُ برمزٍ مُسمَّىً إن غابَ أو فَسَدَ', () => {
  const dir = makeRoot();
  initFixtureRepo(dir);
  assert.deepEqual(loadScopeExclusions(dir), REPO_EXCLUSIONS);

  const broken = makeRoot();
  initFixtureRepo(broken, { scopeYaml: 'version: 1\nnonScope: "ليسَ قائمةً"\n' });
  assert.throws(() => loadScopeExclusions(broken), /SCOPE_CONFIG_SHAPE/);

  const missing = makeRoot();
  initFixtureRepo(missing);
  removeAndCommit(missing, SCOPE_CONFIG);
  assert.throws(() => loadScopeExclusions(missing), /SCOPE_CONFIG_MISSING/);
});

test('و٩ — `isExcluded` يُطابِقُ البادئةَ والمسارَ التامَّ ولا يُطابِقُ ما شابَهَ', () => {
  const exclusions = ['vendor/', 'PROJECT_STATUS.md'];
  assert.equal(isExcluded('vendor/lib/a.mjs', exclusions), true, 'مُدخلةٌ بـ`/` بادئةُ مجلَّدٍ');
  assert.equal(isExcluded('PROJECT_STATUS.md', exclusions), true);
  assert.equal(isExcluded('src/vendor/readme.md', exclusions), false);
  assert.equal(isExcluded('scripts/core.mjs', exclusions), false);
  // مطابقةٌ تامّةٌ لا بادئةٌ لمُدخلةِ ملفٍّ (‏`WL-265`): البادئةُ كانت تَستثني هذينِ صامتةً.
  assert.equal(isExcluded('PROJECT_STATUS.md.bak', exclusions), false);
  assert.equal(isExcluded('PROJECT_STATUS.mdx/a', exclusions), false);
});

test('و١٠ — `scopeDiff` يُسمّي ما اختلفَ: هذا ما يُطبَعُ عندَ الرفضِ فلا يُخمَّنُ', () => {
  const dir = makeRoot();
  const before = initFixtureRepo(dir);
  const after = commitFiles(dir, {
    'tests/alpha.test.mjs': 'export const value = 9;\n',
    'tests/new.test.mjs': 'export const n = 1;\n',
    'docs/roadmap/05-work-log.md': '## WL-999\nلا يَظهرُ\n',
  });
  const diff = scopeDiff(dir, before, after);
  assert.ok(diff.includes('~ tests/alpha.test.mjs'), JSON.stringify(diff));
  assert.ok(diff.includes('+ tests/new.test.mjs'), JSON.stringify(diff));
  assert.ok(
    !diff.some((d) => d.includes('docs/')),
    'المُستثنى لا يَظهرُ في الفرقِ — وإلا أَرسلَ المنفِّذَ إلى إصلاحٍ لا يَلزَمُ.',
  );
});

test('و١١ — المستودَعُ الحقيقيُّ: الإعلانُ المُقيَّدُ ملفّاتُ المُحاسَبةِ السبعةُ وحدَها', () => {
  // قياسٌ على المستودَعِ نفسِهِ لا على جذرٍ مصنوعٍ: كلُّ مسارٍ يُضافُ إلى
  // الاستثناءِ بقعةٌ عمياءُ، فالتوسيعُ يجبُ أن يُسقِطَ اختباراً لا أن يَمُرَّ.
  assert.deepEqual(loadScopeExclusions(REPO_ROOT), REPO_EXCLUSIONS);
});

test('و١٢ — جذرٌ بلا `git` يَرمي ولا يُعيدُ بصمةً كاذبةً', () => {
  const dir = makeRoot();
  writeFile(dir, 'config/skip-baseline-scope.yaml', 'version: 1\nnonScope: []\n');
  assert.throws(() => computeScopeDigest(dir, 'HEAD'));
});

// ── `OPS-1/SCOPE-BLIND` · `WL-265`: وثيقةٌ مُعلَنةٌ تُبدِّلُ البصمةَ وسجلٌّ لا يُبدِّلُها ──

test('و١٣ — معيارُ الإغلاقِ: تغييرُ وثيقةٍ تَقرأُها الاختباراتُ يُبدِّلُ البصمةَ، وتغييرُ سجلٍّ لا يُبدِّلُها', () => {
  // الجذرُ المصنوعُ يَحمِلُ إعلانَ المستودعِ نفسَهُ (‏`DEFAULT_SCOPE_YAML` مقروءٌ منه).
  const dir = makeRoot();
  const base = initFixtureRepo(dir, {
    extraFiles: {
      'docs/ROOT_OF_TRUST.md': '# جذرُ الثقةِ\n',
      'docs/roadmap/05-work-log.md': '## WL-001\n',
    },
  });
  // وثائقُ تَقرأُها اختباراتٌ فعلاً — كانت خارجَ البصمةِ حينَ كانَ `docs/` كلُّهُ مُستثنىً.
  /** @type {[string, string][]} */
  const declaredDocs = [
    ['docs/ROOT_OF_TRUST.md', '# جذرُ الثقةِ — مُعدَّلٌ\n'],
    ['docs/adr/0099-new.md', '# قرارٌ جديدٌ\n'],
    ['docs/API_CONTRACT.json', '{}\n'],
  ];
  for (const [rel, body] of declaredDocs) {
    const d = makeRoot();
    const before = initFixtureRepo(d, {
      extraFiles: { 'docs/ROOT_OF_TRUST.md': '# جذرُ الثقةِ\n' },
    });
    const after = commitFiles(d, { [rel]: body });
    assert.notEqual(
      computeScopeDigest(d, before),
      computeScopeDigest(d, after),
      `${rel} وثيقةٌ لا سجلٌّ — تغييرُها يجبُ أن يُبدِّلَ البصمةَ، وإلا فهيَ البقعةُ العمياءُ نفسُها.`,
    );
  }
  // وكلُّ ملفّاتِ المُحاسَبةِ السبعةِ معاً لا تُبدِّلُها — وإلا دارَ الأثرُ على نفسِهِ.
  // (فقط ملفّاتُ المُحاسَبةِ، لا الأدلةُ — فالأدلةُ لا تُكتَبُ ملفّاً.)
  const ACCOUNTING_FILES = REPO_EXCLUSIONS.filter((e) => !e.endsWith('/'));
  const after = commitFiles(
    dir,
    Object.fromEntries(ACCOUNTING_FILES.map((rel) => [rel, `مُحاسَبةٌ بعدَ الدفعةِ: ${rel}\n`])),
  );
  assert.equal(computeScopeDigest(dir, base), computeScopeDigest(dir, after));
});

test('و١٤ — الإعلانُ على المستودَعِ: كلُّ مُدخلةٍ ملفّاً متعقَّباً أو دليلاً مُسماً', () => {
  const tracked = new Set(
    git(REPO_ROOT, ['-c', 'core.quotePath=false', 'ls-files', '-z']).split('\0'),
  );
  for (const entry of loadScopeExclusions(REPO_ROOT)) {
    if (entry.endsWith('/')) {
      // دليلٌ مُسماً — تضييقُ النطاقِ (‏`OPS-1/R7-COST`): كلُّ دليلٍ بقعةٌ عمياءُ مُعلَنةٌ بعلّتِها.
      // لا يُقبَلُ دليلٌ بلا ملفّاتٍ تتبَعُه (‏استثناءٌ ميّتٌ).
      const prefix = entry.slice(0, -1);
      assert.ok(
        [...tracked].some((f) => f.startsWith(prefix + '/')),
        `${entry}: دليلٌ بلا ملفّاتٍ متعقَّبةٍ — استثناءٌ ميّتٌ يَستُرُ بقعةً لا شيءَ فيها.`,
      );
    } else {
      assert.ok(
        tracked.has(entry),
        `${entry}: مُدخلةٌ لا تُسمّي ملفّاً متعقَّباً — استثناءٌ ميّتٌ يَستُرُ بقعةً إن عادَ الاسمُ.`,
      );
    }
  }
});

test('و١٥ — بصمةُ كوميتٍ دالّةٌ فيه وحدَهُ: تُقرَأُ بإعلانِ الكوميتِ لا بإعلانِ الشجرةِ العاملةِ', () => {
  const dir = makeRoot();
  const before = initFixtureRepo(dir, { extraFiles: { 'docs/guide.md': '# دليلٌ\n' } });
  const digestBefore = computeScopeDigest(dir, before);
  // كوميتٌ لاحقٌ يُوسِّعُ الإعلانَ — ويجبُ ألّا يُغيِّرَ بصمةَ الكوميتِ السابقِ.
  commitFiles(dir, {
    'config/skip-baseline-scope.yaml': 'version: 1\nnonScope:\n  - docs/\n',
  });
  assert.deepEqual(
    loadScopeExclusions(dir),
    ['docs/'],
    'الشجرةُ العاملةُ تَحمِلُ الإعلانَ الجديدَ',
  );
  assert.notDeepEqual(
    loadScopeExclusionsAt(dir, before),
    ['docs/'],
    'والكوميتُ السابقُ يَحمِلُ إعلانَهُ',
  );
  assert.equal(
    computeScopeDigest(dir, before),
    digestBefore,
    'بصمةُ كوميتٍ تَتغيَّرُ بإعلانِ فرعٍ لاحقٍ = تشخيصٌ كاذبٌ بتقادُمِ `main` (‏مقيسٌ في WL-265).',
  );
  // وكوميتٌ بلا إعلانٍ يَرمي برمزٍ مُسمَّىً لا يُعيدُ بصمةً على إعلانٍ مُستعارٍ.
  const bare = makeRoot();
  initFixtureRepo(bare);
  const noConfig = removeAndCommit(bare, SCOPE_CONFIG);
  assert.throws(() => loadScopeExclusionsAt(bare, noConfig), /SCOPE_CONFIG_MISSING/);
});

test('و١٦ — تضييقُ النطاقِ: كلُّ دليلٍ مُستثنىً بقعةٌ عمياءُ مُسماّةٌ (‏`OPS-1/R7-COST`)', () => {
  // قررَ المالكُ تضييقَ النطاقِ إلى `tests/` والمُعلَناتِ. كلُّ دليلٍ يُضافُ إلى
  // الاستثناءِ بقعةٌ عمياءُ — ويُقاسُ ذلكَ بأنّ نزعَ الدليلِ من الاستثناءِ يُدخِلُهُ
  // النطاقَ فتُبدِّلُ البصمةَ (كما في `و٧`).
  const dir = makeRoot();
  initFixtureRepo(dir);
  const sha = commitFiles(dir, { 'src/ملف.mjs': 'export const z = 1;\n' });
  const declared = computeScopeDigest(dir, sha);
  // نزعُ `src/` من الاستثناءِ يُدخِلُ محتواه في البصمةِ.
  const mutated = computeScopeDigest(
    dir,
    sha,
    loadScopeExclusions(dir).filter((e) => e !== 'src/'),
  );
  assert.notEqual(
    declared,
    mutated,
    'نزعُ `src/` من الاستثناءِ يجبُ أن يُبدِّلَ البصمةَ — وإلا فالبقعةُ العمياءُ ليست مُسماّةً.',
  );
});
