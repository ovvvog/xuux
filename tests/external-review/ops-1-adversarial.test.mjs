// اختباراتٌ عدائيّةٌ لعقدِ هويّةِ خطِّ أساسِ التخطّي (‏`OPS-1`).
//
// **كلُّ اختبارٍ هنا يُثبِتُ رفضاً برمزِهِ لا مروراً.** فحاجزٌ يَحرُسُ وجودَ ردٍّ ولا
// يَحرُسُ صحّتَهُ لا يَحرُسُ، واختبارٌ يمرُّ لأنَّ الخاصيّةَ لم تُقَسْ ليسَ نجاحاً
// بل سَتراً. ولذلكَ يُقابَلُ **رمزُ الرفضِ بعينِهِ** لا مجرَّدُ فشلٍ.
//
// وفيه ثلاثُ لحظاتِ سباقٍ مقيسةٌ صريحاً (‏شرطُ المالكِ):
//   س١ — قياسٌ على M0 ثمَّ تحرُّكُ main **خارجَ** النطاقِ ⇒ النشرُ يَمضي.
//   س٢ — قياسٌ على M0 ثمَّ تحرُّكُ main **داخلَ** النطاقِ ⇒ النشرُ يُمنَعُ.
//   س٣ — طلبُ دمجٍ مفتوحٌ ثمَّ تحرُّكُ main ⇒ `R8/BASE-DRIFT`.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import { registerTmpRoot } from '../helpers/tmp-roots.mjs';
import {
  initFixtureRepo,
  commitFiles,
  setOriginMain,
  tapText,
  guardFailureBlock,
  foreignFailureBlock,
  writeFile,
  git,
} from '../helpers/skip-baseline-fixture.mjs';
import { computeScopeDigest } from '../../scripts/lib/skip-baseline-scope.mjs';
import { allowSelfStaleOnly } from '../../scripts/measure-skip-baseline.mjs';
import { verifyArtifact } from '../../scripts/verify-skip-baseline-artifact.mjs';
import { checkSkipBaseline } from '../../scripts/guard-skip-baseline.mjs';

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');
const TOOL = path.join(REPO_ROOT, 'scripts', 'measure-skip-baseline.mjs');
const ARTIFACT_REL = 'docs/external-review/skip-baseline.json';
const PLAN_REL = 'docs/external-review/M11.05-round-1-plan.md';

/** @returns {string} */
function makeRoot() {
  return registerTmpRoot(mkdtempSync(path.join(os.tmpdir(), 'xuux-ops1-')));
}

/**
 * @param {string[]} args
 * @returns {{ status: number, stdout: string, stderr: string }}
 */
function runTool(args) {
  try {
    const stdout = execFileSync('node', [TOOL, ...args], {
      encoding: 'utf8',
      cwd: REPO_ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { status: 0, stdout, stderr: '' };
  } catch (err) {
    const e = /** @type {{ status?: number, stdout?: string, stderr?: string }} */ (err);
    return { status: e.status ?? 1, stdout: e.stdout ?? '', stderr: e.stderr ?? '' };
  }
}

/** @param {{ tap?: string }} [options] */
function scene(options = {}) {
  const measuredRoot = makeRoot();
  const artifactRoot = makeRoot();
  const measuredSha = initFixtureRepo(measuredRoot);
  initFixtureRepo(artifactRoot);
  const tapPath = path.join(makeRoot(), 'run.tap');
  writeFileSync(tapPath, options.tap ?? tapText(), 'utf8');
  return { measuredRoot, artifactRoot, measuredSha, tapPath };
}

/**
 * @param {{ measuredRoot: string, artifactRoot: string, measuredSha: string, tapPath: string }} s
 * @param {Record<string, string>} [overrides]
 */
function args(s, overrides = {}) {
  /** @type {Record<string, string>} */
  const flags = {
    engagement: 'M11.05',
    plan: PLAN_REL,
    command: 'env -u DATABASE_URL npm test',
    'measured-root': s.measuredRoot,
    'artifact-root': s.artifactRoot,
    'expect-commit': s.measuredSha,
    'expect-main-head': s.measuredSha,
    'test-exit': '0',
    date: '2026-09-22',
    ...overrides,
  };
  const out = [s.tapPath];
  for (const [k, v] of Object.entries(flags)) {
    if (v === '') continue;
    out.push(`--${k}`, v);
  }
  return out;
}

// ════════════════════ هجماتٌ على الأداةِ (A1…A10) ════════════════════

test('ع١ — `--expect-commit` لا يُطابِقُ رأسَ جذرِ القياسِ ⇒ MEASURE_COMMIT_MISMATCH', () => {
  const s = scene();
  const other = commitFiles(s.measuredRoot, { 'src/core.mjs': 'export const value = 7;\n' });
  git(s.measuredRoot, ['reset', '--hard', '--quiet', s.measuredSha]);
  const run = runTool(args(s, { 'expect-commit': other, 'expect-main-head': other }));
  assert.equal(run.status, 1);
  assert.match(run.stderr, /MEASURE_COMMIT_MISMATCH/);
});

test('ع٢ — شجرةُ قياسٍ مُوَسَّخةٌ ⇒ MEASURE_TREE_DIRTY', () => {
  const s = scene();
  writeFile(s.measuredRoot, 'src/injected.mjs', 'export const evil = 1;\n');
  const run = runTool(args(s));
  assert.equal(run.status, 1);
  assert.match(run.stderr, /MEASURE_TREE_DIRTY/);
});

test('ع٣ — مرجعٌ تاريخيٌّ: المقاسُ ليسَ رأسَ main ⇒ MEASURE_NOT_MAIN_HEAD', () => {
  const s = scene();
  const newer = commitFiles(s.measuredRoot, { 'src/core.mjs': 'export const value = 3;\n' });
  git(s.measuredRoot, ['reset', '--hard', '--quiet', s.measuredSha]);
  const run = runTool(args(s, { 'expect-main-head': newer }));
  assert.equal(run.status, 1);
  assert.match(run.stderr, /MEASURE_NOT_MAIN_HEAD/);
});

test('ع٤ — بصمةٌ مُختصَرةٌ أو اسمُ فرعٍ ⇒ MEASURE_SHA_MALFORMED', () => {
  const s = scene();
  for (const bad of [s.measuredSha.slice(0, 8), 'main', 'HEAD', `${s.measuredSha}0`]) {
    const run = runTool(args(s, { 'expect-commit': bad, 'expect-main-head': bad }));
    assert.equal(run.status, 1, `المُدخَلُ ${bad} يجبُ أن يُرَدَّ.`);
    assert.match(run.stderr, /MEASURE_SHA_MALFORMED/);
  }
});

test('ع٥ — رمزُ خروجٍ صفرٌ وTAP يقولُ إخفاقاً ⇒ MEASURE_EXIT_TAP_DIVERGENT', () => {
  const tap = tapText({
    tests: 4,
    pass: 2,
    fail: 1,
    skipped: 1,
    extraLines: guardFailureBlock(4, 'R6/STALE'),
  });
  const s = scene({ tap });
  const run = runTool(args(s, { 'test-exit': '0' }));
  assert.equal(run.status, 1);
  assert.match(run.stderr, /MEASURE_EXIT_TAP_DIVERGENT/);
});

test('ع٥ب — رمزُ خروجٍ غيرُ صفرٍ وTAP يقولُ نجاحاً ⇒ MEASURE_EXIT_TAP_DIVERGENT', () => {
  const s = scene();
  const run = runTool(args(s, { 'test-exit': '1' }));
  assert.equal(run.status, 1);
  assert.match(run.stderr, /MEASURE_EXIT_TAP_DIVERGENT/);
});

test('ع٦ — TAP بلا مُلخَّصٍ ختاميٍّ ⇒ رفضٌ لا تخمينٌ', () => {
  const s = scene({ tap: 'TAP version 13\nok 1 - alpha\n' });
  const run = runTool(args(s));
  assert.equal(run.status, 1);
  assert.match(run.stderr, /مُلخَّصٍ ختاميٍّ|MEASURE_TAP/);
});

test('ع٧ — TAP مفقودٌ أصلاً ⇒ MEASURE_TAP_MISSING', () => {
  const s = scene();
  const run = runTool(args({ ...s, tapPath: path.join(makeRoot(), 'ghost.tap') }));
  assert.equal(run.status, 1);
  assert.match(run.stderr, /MEASURE_TAP_MISSING/);
});

test('ع٨ — إخفاقٌ أجنبيٌّ **بجانبِ** `R6/STALE` ⇒ MEASURE_FOREIGN_FAILURE', () => {
  const tap = tapText({
    tests: 5,
    pass: 2,
    fail: 2,
    skipped: 1,
    extraLines: [...guardFailureBlock(4, 'R6/STALE'), ...foreignFailureBlock(5)],
  });
  const s = scene({ tap });
  const run = runTool(args(s, { 'test-exit': '1' }));
  assert.equal(run.status, 1);
  assert.match(run.stderr, /MEASURE_FOREIGN_FAILURE/);
});

test('ع٩ — إخفاقٌ أجنبيٌّ **بجانبِ** `R7/SCOPE-DRIFT` ⇒ MEASURE_FOREIGN_FAILURE', () => {
  const tap = tapText({
    tests: 5,
    pass: 2,
    fail: 2,
    skipped: 1,
    extraLines: [...guardFailureBlock(4, 'R7/SCOPE-DRIFT'), ...foreignFailureBlock(5)],
  });
  const s = scene({ tap });
  const run = runTool(args(s, { 'test-exit': '1' }));
  assert.equal(run.status, 1);
  assert.match(run.stderr, /MEASURE_FOREIGN_FAILURE/);
});

test('ع١٠ — `R8/BASE-DRIFT` وحدَهُ **لا يُستثنى** ⇒ MEASURE_FOREIGN_FAILURE', () => {
  const tap = tapText({
    tests: 4,
    pass: 2,
    fail: 1,
    skipped: 1,
    extraLines: guardFailureBlock(4, 'R8/BASE-DRIFT'),
  });
  const s = scene({ tap });
  const run = runTool(args(s, { 'test-exit': '1' }));
  assert.equal(
    run.status,
    1,
    'استثناءُ R8 ذاتيّاً يَفتحُ المنفَذَ الذي أُغلِقَ بـLIVE-16 — فلا استثناءَ لهُ.',
  );
  assert.match(run.stderr, /MEASURE_FOREIGN_FAILURE/);
  const decision = allowSelfStaleOnly(guardFailureBlock(1, 'R8/BASE-DRIFT').join('\n'), 1);
  assert.equal(decision.allowed, false);
});

test('ع١١ — تبايُنٌ: `# fail 2` وكتلةٌ ذاتيّةٌ واحدةٌ ⇒ رفضٌ (‏`WL-242`)', () => {
  const tap = tapText({
    tests: 4,
    pass: 1,
    fail: 2,
    skipped: 1,
    extraLines: guardFailureBlock(4, 'R6/STALE'),
  });
  const s = scene({ tap });
  const run = runTool(args(s, { 'test-exit': '1' }));
  assert.equal(run.status, 1);
  assert.match(run.stderr, /تبايُنٌ|MEASURE_FOREIGN_FAILURE/);
});

test('ع١١ب — `--commit` محذوفٌ: تمريرُهُ يُسقِطُ الأداةَ صريحاً', () => {
  const s = scene();
  const run = runTool(args(s, { commit: 'f'.repeat(40) }));
  assert.equal(run.status, 1);
  assert.match(run.stderr, /--commit محذوفٌ/);
});

// ════════════════════ هجماتٌ على المُتحقِّقِ (V1…V7) ════════════════════

/**
 * يَبني مشهدَ نشرٍ: جذرٌ موثوقٌ على M0، و`origin/main` مُثبَّتٌ، وأثرٌ مُطابِقٌ.
 * @returns {{ trustedRoot: string, m0: string, artifactText: string, sha256: string }}
 */
function publishScene() {
  const trustedRoot = makeRoot();
  const m0 = initFixtureRepo(trustedRoot);
  setOriginMain(trustedRoot, m0);
  const artifact = {
    generatedBy: 'npm run measure:skip-baseline',
    contractVersion: 2,
    measurements: [
      {
        engagement: 'M11.05',
        plan: PLAN_REL,
        command: 'env -u DATABASE_URL npm test',
        commit: m0,
        mainHeadAtMeasure: m0,
        scopeDigest: computeScopeDigest(trustedRoot, m0),
        measuredOn: '2026-09-22',
        verdict: 'success',
        testFileCount: 1,
        tests: 3,
        pass: 2,
        fail: 0,
        skipped: 1,
        skipLines: 1,
        topLevelSkipPoints: 1,
        attributedToDatabaseUrl: 1,
        otherReasons: [],
      },
    ],
  };
  const artifactText = `${JSON.stringify(artifact, null, 2)}\n`;
  return {
    trustedRoot,
    m0,
    artifactText,
    sha256: createHash('sha256').update(artifactText, 'utf8').digest('hex'),
  };
}

/**
 * @param {{ trustedRoot: string, m0: string, artifactText: string, sha256: string }} p
 * @param {Partial<Parameters<typeof verifyArtifact>[0]>} [overrides]
 */
function verify(p, overrides = {}) {
  return verifyArtifact({
    artifactText: p.artifactText,
    expectedArtifactSha256: p.sha256,
    measuredSha: p.m0,
    mainHeadAtMeasure: p.m0,
    trustedRoot: p.trustedRoot,
    ...overrides,
  });
}

test('ع١٢ — أثرٌ مُعدَّلٌ بايتاً بعدَ رفعِهِ ⇒ VERIFY_ARTIFACT_DIGEST_MISMATCH', () => {
  const p = publishScene();
  const tampered = p.artifactText.replace(
    '"attributedToDatabaseUrl": 1',
    '"attributedToDatabaseUrl": 92',
  );
  const { rejections } = verify(p, { artifactText: tampered });
  assert.ok(
    rejections.some((r) => r.startsWith('VERIFY_ARTIFACT_DIGEST_MISMATCH')),
    rejections.join('\n'),
  );
});

test('ع١٣ — كوميتُ الأثرِ بُدِّلَ ⇒ VERIFY_COMMIT_MISMATCH', () => {
  const p = publishScene();
  const other = 'a'.repeat(40);
  const text = p.artifactText.replace(`"commit": "${p.m0}"`, `"commit": "${other}"`);
  const { rejections } = verify(p, {
    artifactText: text,
    expectedArtifactSha256: createHash('sha256').update(text, 'utf8').digest('hex'),
  });
  assert.ok(
    rejections.some((r) => r.startsWith('VERIFY_COMMIT_MISMATCH')),
    rejections.join('\n'),
  );
});

test('ع١٣ب — `mainHeadAtMeasure` بُدِّلَ ⇒ VERIFY_MAIN_HEAD_MISMATCH', () => {
  const p = publishScene();
  const text = p.artifactText.replace(
    `"mainHeadAtMeasure": "${p.m0}"`,
    `"mainHeadAtMeasure": "${'b'.repeat(40)}"`,
  );
  const { rejections } = verify(p, {
    artifactText: text,
    expectedArtifactSha256: createHash('sha256').update(text, 'utf8').digest('hex'),
  });
  assert.ok(
    rejections.some((r) => r.startsWith('VERIFY_MAIN_HEAD_MISMATCH')),
    rejections.join('\n'),
  );
});

test('ع١٤ — `scopeDigest` بُدِّلَ ⇒ PUBLISH_SCOPE_DRIFT', () => {
  const p = publishScene();
  const text = p.artifactText.replace(
    /"scopeDigest": "[0-9a-f]{64}"/,
    `"scopeDigest": "${'c'.repeat(64)}"`,
  );
  const { rejections } = verify(p, {
    artifactText: text,
    expectedArtifactSha256: createHash('sha256').update(text, 'utf8').digest('hex'),
  });
  assert.ok(
    rejections.some((r) => r.startsWith('PUBLISH_SCOPE_DRIFT')),
    rejections.join('\n'),
  );
});

test('ع١٦ — حكمٌ غيرُ معروفٍ ⇒ VERIFY_VERDICT_UNKNOWN', () => {
  const p = publishScene();
  const text = p.artifactText.replace('"verdict": "success"', '"verdict": "forged"');
  const { rejections } = verify(p, {
    artifactText: text,
    expectedArtifactSha256: createHash('sha256').update(text, 'utf8').digest('hex'),
  });
  assert.ok(
    rejections.some((r) => r.startsWith('VERIFY_VERDICT_UNKNOWN')),
    rejections.join('\n'),
  );
});

test('ع١٧ — `contractVersion` مفقودٌ أو أقدمُ ⇒ VERIFY_SHAPE_INVALID (لا نشرَ لأثرٍ بلا عقدِ هويّةٍ)', () => {
  const p = publishScene();
  for (const replacement of ['"contractVersion": 1,', '']) {
    const text = p.artifactText.replace('"contractVersion": 2,', replacement);
    const { rejections } = verify(p, {
      artifactText: text,
      expectedArtifactSha256: createHash('sha256').update(text, 'utf8').digest('hex'),
    });
    assert.ok(
      rejections.some((r) => r.startsWith('VERIFY_SHAPE_INVALID')),
      rejections.join('\n'),
    );
  }
});

test('ع١٧ب — حقلٌ إلزاميٌّ ناقصٌ ⇒ VERIFY_SHAPE_INVALID', () => {
  const p = publishScene();
  const text = p.artifactText.replace(/\s*"testFileCount": 1,/, '');
  const { rejections } = verify(p, {
    artifactText: text,
    expectedArtifactSha256: createHash('sha256').update(text, 'utf8').digest('hex'),
  });
  assert.ok(
    rejections.some((r) => r.includes('testFileCount')),
    rejections.join('\n'),
  );
});

test('ع١٧ج — المقاسُ ليسَ رأسَ main في بيانِ التشغيلةِ ⇒ VERIFY_NOT_MAIN_HEAD', () => {
  const p = publishScene();
  const { rejections } = verify(p, { mainHeadAtMeasure: 'd'.repeat(40) });
  assert.ok(
    rejections.some((r) => r.startsWith('VERIFY_NOT_MAIN_HEAD')),
    rejections.join('\n'),
  );
});

test('ع١٧د — `origin/main` غيرُ مقروءٍ ⇒ PUBLISH_SCOPE_DRIFT (لا مادّةَ ⇒ لا نشرَ)', () => {
  const p = publishScene();
  const { rejections } = verify(p, { mainRef: 'refs/remotes/origin/ghost' });
  assert.ok(
    rejections.some((r) => r.startsWith('PUBLISH_SCOPE_DRIFT')),
    rejections.join('\n'),
  );
});

test('ع١٥أ — المشهدُ السليمُ يَمُرُّ: بلا هذا يكونُ كلُّ ما سبقَ رفضاً عامّاً لا قياساً', () => {
  const p = publishScene();
  const { rejections, mainHeadAtPublish } = verify(p);
  assert.deepEqual(rejections, []);
  assert.equal(mainHeadAtPublish, p.m0);
});

// ════════════════════ لحظاتُ السباقِ الثلاثُ (شرطُ المالكِ) ════════════════════

test('س١ — قياسٌ على M0 ثمَّ تحرُّكُ main **خارجَ** النطاقِ ⇒ النشرُ يَمضي', () => {
  const p = publishScene();
  const m1 = commitFiles(p.trustedRoot, {
    'docs/roadmap/05-work-log.md': '## WL-999\nدفعةٌ أخرى\n',
    'PROJECT_STATUS.md': 'آخر تحديث: بعدَ القياسِ\n',
  });
  setOriginMain(p.trustedRoot, m1);
  assert.notEqual(m1, p.m0);
  const { rejections, mainHeadAtPublish } = verify(p);
  assert.deepEqual(
    rejections,
    [],
    'دفعةٌ وثائقيّةٌ لا تُبطِلُ قياساً — وإلا لَما أمكنَ نشرُ أثرٍ في مستودَعٍ يُوثِّقُ كلَّ دفعةٍ.',
  );
  assert.equal(mainHeadAtPublish, m1, 'ورأسُ main عندَ النشرِ **مختلفٌ** عن المقاسِ ومُعلَنٌ.');
});

test('س٢ — قياسٌ على M0 ثمَّ تحرُّكُ main **داخلَ** النطاقِ ⇒ PUBLISH_SCOPE_DRIFT ولا نشرَ', () => {
  const p = publishScene();
  const m1 = commitFiles(p.trustedRoot, { 'src/core.mjs': 'export const value = 42;\n' });
  setOriginMain(p.trustedRoot, m1);
  const { rejections } = verify(p);
  const drift = rejections.filter((r) => r.startsWith('PUBLISH_SCOPE_DRIFT'));
  assert.equal(drift.length, 1, rejections.join('\n'));
  assert.match(drift[0] ?? '', /src\/core\.mjs/, 'والرفضُ يُسمّي المسارَ المختلفَ فلا يُخمَّنُ.');
});

test('س٢ب — وعدّادُ ملفّاتِ الاختبارِ لم يتغيَّرْ: `R6` وحدَهُ كانَ يَمُرُّ أخضرَ', () => {
  const dir = makeRoot();
  const m0 = initFixtureRepo(dir);
  const m1 = commitFiles(dir, { 'src/core.mjs': 'export const value = 42;\n' });
  const countAt = (/** @type {string} */ sha) =>
    git(dir, ['ls-tree', '-r', '--name-only', sha, 'tests'])
      .split('\n')
      .filter((l) => l.endsWith('.test.mjs')).length;
  assert.equal(countAt(m0), countAt(m1), 'العدّادُ واحدٌ في الشجرتَينِ.');
  assert.notEqual(
    computeScopeDigest(dir, m0),
    computeScopeDigest(dir, m1),
    'والبصمةُ مختلفةٌ — وهذا هوَ ما لا يَقدِرُ عليهِ R6 ويَقدِرُ عليهِ R7.',
  );
});

test('س٣ — طلبُ دمجٍ مفتوحٌ ثمَّ تحرُّكُ main ⇒ R8/BASE-DRIFT، ولا استثناءَ ذاتيَّ لهُ', () => {
  // شجرةُ الفرعِ: main عندَ M0 زائدَ تعديلِ وثائقٍ. ثمَّ يتحرَّكُ origin/main إلى M1
  // على فرعٍ آخرَ، فلا يَبقى محتوىً في الفرعِ.
  const dir = makeRoot();
  const m0 = initFixtureRepo(dir);
  writeFile(dir, ARTIFACT_REL, artifactFor(dir, m0));
  git(dir, ['checkout', '--quiet', '-b', 'pr/baseline']);
  git(dir, ['add', '-A']);
  git(dir, ['commit', '--quiet', '-m', 'pr: أثرٌ']);

  // أساسٌ مُطابِقٌ ⇒ لا انتهاكَ.
  setOriginMain(dir, m0);
  const before = checkSkipBaseline(dir);
  assert.ok(
    !before.violations.some((v) => v.startsWith('R8/')),
    `أساسٌ محتوىً لا يُحمِّرُ طلبَ دمجٍ: ${before.violations.join(' | ')}`,
  );

  // main يتحرَّكُ على فرعٍ لا يَحتويهِ الطلبُ ⇒ R8 يَسقُطُ.
  git(dir, ['checkout', '--quiet', '-b', 'other', m0]);
  const m1 = commitFiles(dir, { 'src/core.mjs': 'export const value = 5;\n' }, 'main: تقدَّمَ');
  setOriginMain(dir, m1);
  git(dir, ['checkout', '--quiet', 'pr/baseline']);

  const after = checkSkipBaseline(dir);
  const baseDrift = after.violations.filter((v) => v.startsWith('R8/BASE-DRIFT'));
  assert.equal(baseDrift.length, 1, after.violations.join(' | '));
  assert.match(baseDrift[0] ?? '', /ولا استثناءَ ذاتيَّ/);
});

/**
 * أثرٌ صالحٌ لشجرةٍ بعينِها — للاختباراتِ التي تَقيسُ الحاجزَ لا المُتحقِّقَ.
 * @param {string} dir
 * @param {string} sha
 * @returns {string}
 */
function artifactFor(dir, sha) {
  return `${JSON.stringify(
    {
      generatedBy: 'npm run measure:skip-baseline',
      contractVersion: 2,
      measurements: [
        {
          engagement: 'M11.05',
          plan: PLAN_REL,
          command: 'env -u DATABASE_URL npm test',
          commit: sha,
          mainHeadAtMeasure: sha,
          scopeDigest: computeScopeDigest(dir, sha),
          measuredOn: '2026-09-22',
          verdict: 'success',
          testFileCount: 1,
          tests: 3,
          pass: 2,
          fail: 0,
          skipped: 1,
          skipLines: 1,
          topLevelSkipPoints: 1,
          attributedToDatabaseUrl: 1,
          otherReasons: [],
        },
      ],
    },
    null,
    2,
  )}\n`;
}

// ════════════════════ الحاجزُ: R7 حاسمٌ، والمُلاحظةُ مُعلَنةٌ ════════════════════

test('ط١ — `R7/SCOPE-DRIFT` **حاسمٌ** حينَ تكونُ مادّتُهُ حاضرةً', () => {
  const dir = makeRoot();
  const m0 = initFixtureRepo(dir);
  writeFile(dir, ARTIFACT_REL, artifactFor(dir, m0));
  commitFiles(dir, { 'src/core.mjs': 'export const value = 99;\n' }, 'تغييرٌ في النطاقِ');
  setOriginMain(dir, git(dir, ['rev-parse', 'HEAD']).trim());
  const { violations } = checkSkipBaseline(dir);
  assert.ok(
    violations.some((v) => v.startsWith('R7/SCOPE-DRIFT')),
    violations.join(' | '),
  );
});

test('ط٢ — تغييرٌ في `docs/` وحدَهُ **يَمُرُّ** — الحدُّ المُعلَنُ لا المستورُ', () => {
  const dir = makeRoot();
  const m0 = initFixtureRepo(dir);
  writeFile(dir, ARTIFACT_REL, artifactFor(dir, m0));
  commitFiles(dir, { 'docs/roadmap/05-work-log.md': '## WL-999\n' }, 'وثائقُ فقط');
  setOriginMain(dir, git(dir, ['rev-parse', 'HEAD']).trim());
  const { violations } = checkSkipBaseline(dir);
  assert.ok(
    !violations.some((v) => v.startsWith('R7/')),
    `الاستثناءُ بنيويٌّ وإلا دارَ الأثرُ: ${violations.join(' | ')}`,
  );
});

test('ط٣ — أثرٌ بلا `scopeDigest`: مُلاحظةٌ مُعلَنةٌ باسمِها لا سكوتٌ', () => {
  const dir = makeRoot();
  const m0 = initFixtureRepo(dir);
  const legacy = JSON.parse(artifactFor(dir, m0));
  delete legacy.contractVersion;
  delete legacy.measurements[0].scopeDigest;
  delete legacy.measurements[0].mainHeadAtMeasure;
  delete legacy.measurements[0].verdict;
  writeFile(dir, ARTIFACT_REL, `${JSON.stringify(legacy, null, 2)}\n`);
  git(dir, ['add', '-A']);
  git(dir, ['commit', '--quiet', '-m', 'أثرٌ بعقدٍ أقدمَ']);
  setOriginMain(dir, git(dir, ['rev-parse', 'HEAD']).trim());
  const { violations, notices } = checkSkipBaseline(dir);
  assert.ok(!violations.some((v) => v.startsWith('R7/')), violations.join(' | '));
  assert.ok(
    notices.some((n) => n.startsWith('R7/PENDING-MIGRATION')),
    `قاعدةٌ لا تُقاسُ ولا يُعلَنُ أنّها لا تُقاسُ هيَ سَترٌ: ${notices.join(' | ')}`,
  );
});

test('ط٤ — `origin/main` غيرُ مجلوبٍ: مُلاحظةُ `R8/NO-BASE` مُعلَنةٌ', () => {
  const dir = makeRoot();
  const m0 = initFixtureRepo(dir);
  writeFile(dir, ARTIFACT_REL, artifactFor(dir, m0));
  git(dir, ['add', '-A']);
  git(dir, ['commit', '--quiet', '-m', 'أثرٌ']);
  const { notices } = checkSkipBaseline(dir);
  assert.ok(
    notices.some((n) => n.startsWith('R8/NO-BASE')),
    notices.join(' | '),
  );
});

// ══════ مرجِعُ الحُكمِ: الأثرُ يُقابَلُ بالشجرةِ التي يَصِفُها (فكُّ الدورانِ) ══════
//
// **الدورانُ الذي تَقيسُهُ هذه المجموعةُ:** الأثرُ يَصِفُ `main`، فلو قُوبِلَ بشجرةِ
// فرعٍ لَسقطَ في كلِّ فرعٍ يُضيفُ ملفَّ اختبارٍ — ثمَّ لا مَخرَجَ، لأنَّ إعادةَ القياسِ
// تَشترطُ رأسَ `main` (`A4`). فالمقيسُ هنا شيئانِ لا شيءٌ: أنَّ الفرعَ لا يُحاكَمُ
// بما لا يَصِفُهُ الأثرُ، **وأنَّ `main` لم يُخفَّفْ عنهُ حرفٌ**.

/**
 * جذرٌ على هيئةِ `main`: `HEAD === origin/main`.
 * @returns {{ dir: string, sha: string }}
 */
function mainLikeRoot() {
  const dir = makeRoot();
  const sha = initFixtureRepo(dir);
  writeFile(dir, ARTIFACT_REL, artifactFor(dir, sha));
  git(dir, ['add', '-A']);
  git(dir, ['commit', '--quiet', '-m', 'أثرٌ']);
  const head = git(dir, ['rev-parse', 'HEAD']).trim();
  writeFile(dir, ARTIFACT_REL, artifactFor(dir, head));
  git(dir, ['add', '-A']);
  git(dir, ['commit', '--quiet', '--amend', '--no-edit']);
  const finalSha = git(dir, ['rev-parse', 'HEAD']).trim();
  writeFile(dir, ARTIFACT_REL, artifactFor(dir, finalSha));
  git(dir, ['add', '-A']);
  git(dir, ['commit', '--quiet', '--amend', '--no-edit']);
  setOriginMain(dir, git(dir, ['rev-parse', 'HEAD']).trim());
  return { dir, sha: git(dir, ['rev-parse', 'HEAD']).trim() };
}

test('ح١ — فرعٌ يُضيفُ ملفَّ اختبارٍ: R6 لا يَسقُطُ، والأساسُ المُحاكَمُ مُعلَنٌ باسمِهِ', () => {
  const { dir } = mainLikeRoot();
  git(dir, ['checkout', '--quiet', '-b', 'feat/tests']);
  commitFiles(dir, { 'tests/beta.test.mjs': "import 'node:test';\n" }, 'feat: ملفُّ اختبارٍ');
  const { violations, notices } = checkSkipBaseline(dir);
  assert.ok(
    !violations.some((v) => v.startsWith('R6/')),
    `أثرٌ يَصِفُ main لا يُحاكَمُ بشجرةِ فرعٍ — وإلّا فلا مَخرَجَ: ${violations.join(' | ')}`,
  );
  assert.ok(
    notices.some((n) => n.startsWith('SCOPE/JUDGED-BASE')),
    `ومرجِعُ الحُكمِ يُعلَنُ ولا يُضمَرُ: ${notices.join(' | ')}`,
  );
});

test('ح٢ — فرعٌ يُغيِّرُ نطاقاً: R7 لا يَسقُطُ على الفرعِ — ويَسقُطُ على main بعدَ الدمجِ', () => {
  const { dir } = mainLikeRoot();
  git(dir, ['checkout', '--quiet', '-b', 'feat/scope']);
  commitFiles(dir, { 'src/core.mjs': 'export const value = 77;\n' }, 'feat: نطاقٌ');
  const onBranch = checkSkipBaseline(dir);
  assert.ok(
    !onBranch.violations.some((v) => v.startsWith('R7/')),
    `على الفرعِ لا حُكمَ: ${onBranch.violations.join(' | ')}`,
  );

  // الدمجُ: يَصيرُ الفرعُ هوَ `main` — فهنا يَصيرُ الانزياحُ حقيقةً ويُحاكَمُ.
  setOriginMain(dir, git(dir, ['rev-parse', 'HEAD']).trim());
  const afterMerge = checkSkipBaseline(dir);
  assert.ok(
    afterMerge.violations.some((v) => v.startsWith('R7/SCOPE-DRIFT')),
    `وعلى main يَسقُطُ — وإلّا كانَ التأجيلُ إلغاءً: ${afterMerge.violations.join(' | ')}`,
  );
});

test('ح٣ — على `main` نفسِهِ: أثرٌ متقادِمٌ يُسقِطُ R6 كما كانَ، بلا حرفِ تخفيفٍ', () => {
  const { dir } = mainLikeRoot();
  commitFiles(dir, { 'tests/gamma.test.mjs': "import 'node:test';\n" }, 'main: ملفٌّ');
  setOriginMain(dir, git(dir, ['rev-parse', 'HEAD']).trim());
  const { violations, notices } = checkSkipBaseline(dir);
  assert.ok(
    violations.some((v) => v.startsWith('R6/STALE')),
    `main يَسقُطُ بالتقادُمِ: ${violations.join(' | ')}`,
  );
  assert.ok(
    !notices.some((n) => n.startsWith('SCOPE/JUDGED-BASE')),
    'ولا تأجيلَ على main: الشجرةُ المُحاكَمةُ هيَ العاملةُ.',
  );
});

test('ح٤ — وعلى `main` أيضاً: انزياحُ نطاقٍ يُسقِطُ R7 كما كانَ', () => {
  const { dir } = mainLikeRoot();
  commitFiles(dir, { 'src/core.mjs': 'export const value = 5;\n' }, 'main: نطاقٌ');
  setOriginMain(dir, git(dir, ['rev-parse', 'HEAD']).trim());
  const { violations } = checkSkipBaseline(dir);
  assert.ok(
    violations.some((v) => v.startsWith('R7/SCOPE-DRIFT')),
    violations.join(' | '),
  );
});

test('ح٥ — بلا `origin/main` مقروءٍ تُحاكَمُ الشجرةُ العاملةُ — الأشدُّ لا الأخفُّ', () => {
  const dir = makeRoot();
  const sha = initFixtureRepo(dir);
  writeFile(dir, ARTIFACT_REL, artifactFor(dir, sha));
  commitFiles(dir, { 'tests/delta.test.mjs': "import 'node:test';\n" }, 'ملفٌّ');
  const { violations, notices } = checkSkipBaseline(dir);
  assert.ok(
    violations.some((v) => v.startsWith('R6/STALE')),
    `غيابُ الأساسِ لا يُقرأُ إذناً: ${violations.join(' | ')}`,
  );
  assert.ok(
    notices.some((n) => n.startsWith('R8/NO-BASE')),
    notices.join(' | '),
  );
});

test('ح٦ — فرعٌ أساسُهُ قديمٌ: التأجيلُ لا يُعطِّلُ R8 — الحارسُ الحقيقيُّ للفرعِ', () => {
  const { dir, sha } = mainLikeRoot();
  git(dir, ['checkout', '--quiet', '-b', 'feat/old']);
  commitFiles(dir, { 'tests/eps.test.mjs': "import 'node:test';\n" }, 'feat: ملفٌّ');
  git(dir, ['checkout', '--quiet', '-b', 'other', sha]);
  const moved = commitFiles(dir, { 'src/core.mjs': 'export const value = 9;\n' }, 'main: تقدَّمَ');
  setOriginMain(dir, moved);
  git(dir, ['checkout', '--quiet', 'feat/old']);
  const { violations } = checkSkipBaseline(dir);
  assert.ok(
    violations.some((v) => v.startsWith('R8/BASE-DRIFT')),
    `فرعٌ لا يَحتوي رأسَ main يَسقُطُ بـR8: ${violations.join(' | ')}`,
  );
});

test('ح٧ — عدُّ ملفّاتِ الاختبارِ في كوميتٍ يَرى المسارَ العربيَّ (‏`DOC-11`)', () => {
  const { dir } = mainLikeRoot();
  git(dir, ['checkout', '--quiet', '-b', 'feat/arabic']);
  commitFiles(dir, { 'tests/ولاية/اختبار.test.mjs': "import 'node:test';\n" }, 'feat: عربيٌّ');
  setOriginMain(dir, git(dir, ['rev-parse', 'HEAD']).trim());
  const { violations } = checkSkipBaseline(dir);
  assert.ok(
    violations.some((v) => v.startsWith('R6/STALE')),
    `ملفُّ اختبارٍ بمسارٍ عربيٍّ يُعَدُّ فعلاً — وإلّا سقطَ من العدِّ صامتاً: ${violations.join(' | ')}`,
  );
});

// ════════════════════ بنيةُ سيرِ العملِ: ع١٨ وما معهُ ════════════════════

/** @param {string} rel */
function workflow(rel) {
  return readFileSync(path.join(REPO_ROOT, '.github', 'workflows', rel), 'utf8');
}

/**
 * سيرُ العملِ **مُحلَّلاً لا نصّاً**.
 *
 * **ولماذا هذا فرقٌ حاكمٌ لا تفصيلٌ:** أوّلُ صياغةٍ لهذه التوكيداتِ كانت تَقرأُ نصَّ
 * الملفِّ، فسقطَت ثلاثةُ اختباراتٍ لأنَّ **تعليقاتِ الملفِّ تَشرحُ ما أُزيلَ** فتَذكُرُ
 * `continue-on-error` و`|| true` و`npm install --no-save` و`contents: write` نثراً.
 * ومقياسٌ يَخلِطُ التعليقَ بالمُنفَّذِ يُنتِجُ إنذاراً كاذباً اليومَ **وإذناً كاذباً**
 * غداً: يَكفي أن يُكتَبَ الشرطُ في تعليقٍ ليَمُرَّ. فالقياسُ على الشجرةِ المُحلَّلةِ.
 *
 * @param {string} rel
 * @returns {any}
 */
function workflowDoc(rel) {
  return parseYaml(workflow(rel));
}

/**
 * أوامرُ الشِّلِّ في نصِّ `run` **بلا أجسادِ الـheredoc**.
 *
 * **ولماذا هذا التمييزُ مقيسٌ لا تجميليٌّ:** متنُ طلبِ الدمجِ يُكتَبُ بـheredoc
 * داخلَ `run`، وهوَ يَشرحُ ما أُزيلَ فيَذكُرُ `|| true` نصّاً. فتوكيدٌ يَقرأُ الجسدَ
 * يَسقُطُ على شرحٍ صادقٍ، **ولو عُومِلَ الجسدُ أمراً لَجازَ عكسُهُ**: كتابةُ الشرطِ
 * في متنٍ لتَمريرِ الحاجزِ. فالمقيسُ ما يُنفِّذُهُ الشِّلُّ وحدَهُ.
 *
 * @param {string} script
 * @returns {string[]}
 */
function shellCommands(script) {
  /** @type {string[]} */
  const out = [];
  /** @type {string | null} */
  let terminator = null;
  for (const line of script.split('\n')) {
    if (terminator !== null) {
      if (line.trim() === terminator) terminator = null;
      continue;
    }
    const opened = /<<-?\s*'?([A-Za-z_][A-Za-z0-9_]*)'?/.exec(line);
    if (opened) {
      out.push(line);
      terminator = opened[1] ?? null;
      continue;
    }
    out.push(line);
  }
  return out;
}

/**
 * كلُّ قيمةٍ لمفتاحٍ بعينِهِ في الشجرةِ المُحلَّلةِ، على أيِّ عمقٍ.
 *
 * @param {unknown} node
 * @param {string} key
 * @returns {unknown[]}
 */
function collect(node, key) {
  /** @type {unknown[]} */
  const found = [];
  /** @param {unknown} current */
  const walk = (current) => {
    if (Array.isArray(current)) {
      for (const item of current) walk(item);
      return;
    }
    if (current === null || typeof current !== 'object') return;
    for (const [k, v] of Object.entries(current)) {
      if (k === key) found.push(v);
      walk(v);
    }
  };
  walk(node);
  return found;
}

test('ع١٨ — سيرُ النشرِ يَفحَصُ أنَّ تعريفَهُ من `refs/heads/main` ويُحرَّكُ بـ`workflow_run`', () => {
  const text = workflow('publish-skip-baseline.yml');
  assert.match(text, /workflow_run:/);
  assert.match(text, /branches:\s*\[main\]/);
  assert.match(text, /publish-skip-baseline\.yml@refs\/heads\/main/);
  assert.match(text, /PUBLISH_WORKFLOW_REF_NOT_MAIN/);
});

test('ب١ — سيرُ القياسِ بلا صلاحيّةِ كتابةٍ في أيِّ موضعٍ مُنفَّذٍ', () => {
  const doc = workflowDoc('measure-skip-baseline.yml');
  assert.equal(doc.permissions?.contents, 'read');
  const permissionBlocks = collect(doc, 'permissions');
  assert.ok(permissionBlocks.length >= 4, 'صلاحيّةٌ مُعلَنةٌ في القمّةِ وفي كلِّ job.');
  for (const block of permissionBlocks) {
    assert.deepEqual(
      block,
      { contents: 'read' },
      'مرحلةُ القياسِ تُنفِّذُ كوداً مقاساً — فلا صلاحيّةَ كتابةٍ في أيِّ job منها.',
    );
  }
  assert.deepEqual(Object.keys(doc.jobs ?? {}), ['resolve', 'produce-tap', 'classify-and-write']);
});

test('ب١ب — ومرحلةُ النشرِ وحدَها تملِكُ الكتابةَ، ولا تُنفِّذُ كوداً مقاساً', () => {
  const doc = workflowDoc('publish-skip-baseline.yml');
  const job = doc.jobs?.publish;
  assert.equal(job?.permissions?.contents, 'write');
  assert.equal(job?.permissions?.['pull-requests'], 'write');
  assert.equal(job?.environment, 'publish-skip-baseline');
  const runs = collect(doc, 'run').map(String).join('\n');
  for (const forbidden of ['npm run build', 'node --test']) {
    assert.ok(
      !runs.includes(forbidden),
      `مرحلةُ النشرِ تملِكُ الكتابةَ، فلا تُنفِّذُ كودَ شجرةٍ مقاسةٍ: ${forbidden}`,
    );
  }
});

test('ب٢ — `input.ref` إلزاميٌّ ولا قيمةَ افتراضيّةَ ثابتةً', () => {
  const doc = workflowDoc('measure-skip-baseline.yml');
  const input = doc.on?.workflow_dispatch?.inputs?.ref;
  assert.equal(
    input?.required,
    true,
    'مُدخلةٌ اختياريّةٌ تعني مرجعاً افتراضيّاً — وهو أصلُ OPS-1.',
  );
  assert.equal(
    input?.default,
    undefined,
    'ولا قيمةَ افتراضيّةَ: القياسُ يُطلَبُ صريحاً أو لا يكونُ.',
  );
  assert.ok(
    !workflow('measure-skip-baseline.yml').includes('eba5afcf'),
    'المرجعُ الثابتُ هوَ أصلُ OPS-1: قياسٌ لكوميتٍ تاريخيٍّ يُنشَرُ كأنّهُ الحاليُّ.',
  );
});

test('ب٣ — لا `continue-on-error` ولا `|| true` في **المُنفَّذِ** من مسارِ القياسِ والنشرِ', () => {
  for (const rel of ['measure-skip-baseline.yml', 'publish-skip-baseline.yml']) {
    const doc = workflowDoc(rel);
    assert.deepEqual(
      collect(doc, 'continue-on-error'),
      [],
      `${rel}: حاجزٌ يُقاسُ ولا يَحكُمُ لا يَحرُسُ.`,
    );
    for (const script of collect(doc, 'run').map(String)) {
      for (const command of shellCommands(script)) {
        assert.ok(
          !/\|\|\s*true/.test(command),
          `${rel}: \`|| true\` يَجعلُ الفشلَ نجاحاً كاذباً في مسارٍ يُنتِجُ أثراً يُعتمَدُ عليهِ:\n${command}`,
        );
      }
    }
  }
});

test('ب٤ — `pkcs11js` يَحكُمُ ولا يُسكَتُ، وبلا `npm install --no-save` في المُنفَّذِ', () => {
  const doc = workflowDoc('measure-skip-baseline.yml');
  const step = collect(doc, 'run')
    .map(String)
    .find((s) => s.includes('pkcs11js'));
  assert.ok(step !== undefined, 'خطوةُ pkcs11js قائمةٌ.');
  assert.match(step, /npm rebuild pkcs11js/);
  assert.match(step, /require\.resolve\('pkcs11js'\)/);
  for (const forbidden of ['npm install --no-save', 'npm install pkcs11js']) {
    assert.ok(
      !step.includes(forbidden),
      `تثبيتٌ خارجَ package-lock.json يُنشئُ انزياحَ مُحيطٍ ويُخفيهِ: ${forbidden}`,
    );
  }
  // وآخرُ أمرٍ في الخطوةِ هوَ الفحصُ نفسُهُ، فرمزُ خروجِ الخطوةِ رمزُ الفحصِ لا رمزُ الإصلاحِ.
  const lines = step.trimEnd().split('\n');
  assert.match(String(lines.at(-1)), /require\.resolve\('pkcs11js'\)/);
});

test('ب٥ — `ci.yml` يَجلِبُ `origin/main` مادّةً لـ`R8` حاسماً', () => {
  const text = readFileSync(path.join(REPO_ROOT, '.github', 'workflows', 'ci.yml'), 'utf8');
  assert.match(text, /git fetch --no-tags origin main:refs\/remotes\/origin\/main/);
  const fetchIndex = text.indexOf('git fetch --no-tags origin main:refs/remotes/origin/main');
  const guardIndex = text.indexOf('npm run guard:skip-baseline');
  const testIndex = text.indexOf('run: npm test');
  assert.ok(fetchIndex > -1 && guardIndex > fetchIndex, 'الجلبُ قبلَ الحاجزِ لا بعدَهُ.');
  assert.ok(
    testIndex > fetchIndex,
    'والجلبُ قبلَ `npm test` أيضاً: الحزمةُ تُشغِّلُ الحاجزَ عمليّةً منفصلةً، فبلا أساسٍ مجلوبٍ يُحاكَمُ الفرعُ بأثرٍ يَصِفُ main — وذاكَ الدورانُ نفسُهُ.',
  );
});

test('ب٦ — مرحلةُ النشرِ تُشغِّلُ الحاجزَ حاسماً والمُتحقِّقَ قبلَ أيِّ كتابةٍ', () => {
  const text = workflow('publish-skip-baseline.yml');
  const verifyIndex = text.indexOf('verify-skip-baseline-artifact.mjs');
  const guardIndex = text.indexOf('npm run guard:skip-baseline');
  const pushIndex = text.indexOf('git push origin');
  const prIndex = text.indexOf('gh pr create');
  assert.ok(verifyIndex > -1 && guardIndex > verifyIndex, 'المُتحقِّقُ ثمَّ الحاجزُ.');
  assert.ok(pushIndex > guardIndex, 'ولا دفعَ قبلَ الحاجزِ.');
  assert.ok(prIndex > pushIndex, 'وطلبُ الدمجِ بعدَ الدفعِ — ودفعٌ بلا طلبٍ أنتجَ REPO-1.');
});

test('ب٣ب — مُعِينُ استخراجِ الأوامرِ مقيسٌ: يُسقِطُ الجسدَ ولا يُسقِطُ أمراً', () => {
  const script = [
    'set -euo pipefail',
    "BODY=\"$(cat <<'EOF'",
    'أُزيلَ `|| true` فصارَ الفشلُ صريحاً',
    'EOF',
    ')"',
    'npm run guard:skip-baseline',
  ].join('\n');
  const commands = shellCommands(script);
  assert.ok(commands.includes('npm run guard:skip-baseline'), 'الأمرُ بعدَ الجسدِ باقٍ.');
  assert.ok(!commands.some((c) => c.includes('أُزيلَ')), 'وجسدُ الـheredoc خارجٌ.');
  assert.ok(
    shellCommands('npm rebuild pkcs11js || true').some((c) => c.includes('|| true')),
    'ولا يُسقِطُ أمراً فيهِ الشرطُ فعلاً — وإلا كانَ الاستثناءُ ثُقباً.',
  );
});
