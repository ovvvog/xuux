// عقدُ الـAPI لمقياسِ خطِّ أساسِ التخطّي — جذرانِ لا جذرٌ واحدٌ (‏`OPS-1`).
//
// **ما يُقاسُ هنا:** أنَّ الكوميتَ **مُشتَقٌّ** من جذرِ القياسِ لا مُمَرَّرٌ، وأنَّ
// جذرَ القياسِ **لا يُكتَبُ فيهِ بايتٌ**، وأنَّ الأثرَ يُكتَبُ في الجذرِ الموثوقِ
// وحدَهُ، وأنَّ الأثرَ **قابلٌ لإعادةِ التوليدِ حرفيّاً** فلا حقلَ يَتغيَّرُ بكلِّ
// تشغيلةٍ، وأنَّ الحكمَ (`verdict`) يُقاسُ لا يُوصَفُ.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { registerTmpRoot } from '../helpers/tmp-roots.mjs';
import {
  initFixtureRepo,
  commitFiles,
  tapText,
  guardFailureBlock,
  git,
} from '../helpers/skip-baseline-fixture.mjs';
import { computeScopeDigest } from '../../scripts/lib/skip-baseline-scope.mjs';
import {
  assertMeasuredIdentity,
  assertExitAgreesWithTap,
  CONTRACT_VERSION,
  classifyFailures,
} from '../../scripts/measure-skip-baseline.mjs';

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');
const TOOL = path.join(REPO_ROOT, 'scripts', 'measure-skip-baseline.mjs');
const ARTIFACT_REL = 'docs/external-review/skip-baseline.json';

/** @returns {string} */
function makeRoot() {
  return registerTmpRoot(mkdtempSync(path.join(os.tmpdir(), 'xuux-measure-')));
}

/**
 * جذرانِ جاهزانِ: مقاسٌ وموثوقٌ، وملفُّ TAP.
 * @param {{ tap?: string }} [options]
 */
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
 * يُشغِّلُ الأداةَ ويُعيدُ الرمزَ والمُخرَجَ — لا يَرمي، فالرفضُ مقيسٌ.
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

/**
 * @param {{ measuredRoot: string, artifactRoot: string, measuredSha: string, tapPath: string }} s
 * @param {Record<string, string>} [overrides]
 * @returns {string[]}
 */
function baseArgs(s, overrides = {}) {
  /** @type {Record<string, string>} */
  const flags = {
    engagement: 'M11.05',
    plan: 'docs/external-review/M11.05-round-1-plan.md',
    command: 'env -u DATABASE_URL npm test',
    'measured-root': s.measuredRoot,
    'artifact-root': s.artifactRoot,
    'expect-commit': s.measuredSha,
    'expect-main-head': s.measuredSha,
    'test-exit': '0',
    date: '2026-09-22',
    ...overrides,
  };
  const args = [s.tapPath];
  for (const [k, v] of Object.entries(flags)) {
    if (v === '') continue;
    args.push(`--${k}`, v);
  }
  return args;
}

test('ك١ — مسلكٌ سليمٌ: أثرٌ بعقدِ الهويّةِ كاملاً', () => {
  const s = scene();
  const run = runTool(baseArgs(s));
  assert.equal(run.status, 0, run.stderr);
  const artifact = JSON.parse(readFileSync(path.join(s.artifactRoot, ARTIFACT_REL), 'utf8'));
  assert.equal(artifact.contractVersion, CONTRACT_VERSION);
  assert.equal(artifact.measurements.length, 1);
  const entry = artifact.measurements[0];
  assert.equal(entry.commit, s.measuredSha, 'الكوميتُ مُشتَقٌّ من جذرِ القياسِ.');
  assert.equal(entry.mainHeadAtMeasure, s.measuredSha);
  assert.equal(entry.scopeDigest, computeScopeDigest(s.measuredRoot, s.measuredSha));
  assert.equal(entry.verdict, 'success');
  assert.equal(entry.testFileCount, 1);
  assert.equal(entry.attributedToDatabaseUrl, 1);
});

test('ك٢ — **لا بايتَ يُكتَبُ في جذرِ القياسِ**: الجذرُ نقيٌّ قبلَ النداءِ وبعدَهُ', () => {
  const s = scene();
  const before = computeScopeDigest(s.measuredRoot, 'HEAD');
  const run = runTool(baseArgs(s));
  assert.equal(run.status, 0, run.stderr);
  assert.equal(computeScopeDigest(s.measuredRoot, 'HEAD'), before);
  assert.equal(
    git(s.measuredRoot, ['status', '--porcelain', '--untracked-files=all']).trim(),
    '',
    'جذرُ القياسِ بياناتٌ تُقرأُ — لا يُكتَبُ فيهِ ولو ملفٌّ غيرُ متعقَّبٍ.',
  );
  assert.equal(existsSync(path.join(s.measuredRoot, ARTIFACT_REL)), false);
});

test('ك٣ — الأثرُ يُكتَبُ في الجذرِ الموثوقِ وحدَهُ', () => {
  const s = scene();
  const run = runTool(baseArgs(s));
  assert.equal(run.status, 0, run.stderr);
  assert.equal(existsSync(path.join(s.artifactRoot, ARTIFACT_REL)), true);
});

test('ك٤ — قابليّةُ إعادةِ التوليدِ: نداءانِ بنفسِ المُدخلاتِ ⇒ **تطابُقُ بايتٍ**', () => {
  const s = scene();
  assert.equal(runTool(baseArgs(s)).status, 0);
  const first = readFileSync(path.join(s.artifactRoot, ARTIFACT_REL), 'utf8');
  assert.equal(runTool(baseArgs(s)).status, 0);
  const second = readFileSync(path.join(s.artifactRoot, ARTIFACT_REL), 'utf8');
  assert.equal(first, second, 'حقلٌ يَتغيَّرُ بكلِّ تشغيلةٍ يُنشئُ انزياحاً كاذباً.');
});

test('ك٥ — لا `run_id` ولا `run_attempt` ولا `workflow_sha` في الأثرِ — بيانُ منشأٍ لا حقلُ أثرٍ', () => {
  const s = scene();
  assert.equal(runTool(baseArgs(s)).status, 0);
  const text = readFileSync(path.join(s.artifactRoot, ARTIFACT_REL), 'utf8');
  for (const forbidden of ['run_id', 'runId', 'run_attempt', 'runAttempt', 'workflow_sha']) {
    assert.ok(!text.includes(forbidden), `الحقلُ ${forbidden} يَمنعُ مقابلةَ بايتٍ.`);
  }
});

test('ك٦ — `verdict: self-stale-only` عندَ `R6/STALE` وحدَهُ (‏منفَذُ `LIVE-16` باقٍ)', () => {
  const tap = tapText({
    tests: 4,
    pass: 2,
    fail: 1,
    skipped: 1,
    extraLines: guardFailureBlock(4, 'R6/STALE'),
  });
  const s = scene({ tap });
  const run = runTool(baseArgs(s, { 'test-exit': '1' }));
  assert.equal(run.status, 0, run.stderr);
  const artifact = JSON.parse(readFileSync(path.join(s.artifactRoot, ARTIFACT_REL), 'utf8'));
  assert.equal(artifact.measurements[0].verdict, 'self-stale-only');
});

test('ك٧ — `verdict: self-stale-only` عندَ `R7/SCOPE-DRIFT` وحدَهُ — وإلا عادَ الجمودُ', () => {
  const tap = tapText({
    tests: 4,
    pass: 2,
    fail: 1,
    skipped: 1,
    extraLines: guardFailureBlock(4, 'R7/SCOPE-DRIFT'),
  });
  const s = scene({ tap });
  const run = runTool(baseArgs(s, { 'test-exit': '1' }));
  assert.equal(run.status, 0, run.stderr);
  const artifact = JSON.parse(readFileSync(path.join(s.artifactRoot, ARTIFACT_REL), 'utf8'));
  assert.equal(artifact.measurements[0].verdict, 'self-stale-only');
  assert.match(run.stdout, /R7\/SCOPE-DRIFT/);
});

test('ك٨ — مُدخلتانِ لارتباطَينِ: الأثرُ يَجمعُهما مرتَّبتَينِ بالخطّةِ', () => {
  const s = scene();
  commitFiles(s.artifactRoot, {
    'docs/external-review/M11.06-round-2-plan.md': '# خطّةُ الجولةِ الثانيةِ\n',
  });
  assert.equal(runTool(baseArgs(s)).status, 0);
  const second = runTool(
    baseArgs(s, {
      engagement: 'M11.06',
      plan: 'docs/external-review/M11.06-round-2-plan.md',
    }),
  );
  assert.equal(second.status, 0, second.stderr);
  const artifact = JSON.parse(readFileSync(path.join(s.artifactRoot, ARTIFACT_REL), 'utf8'));
  assert.equal(artifact.measurements.length, 2);
  assert.deepEqual(
    artifact.measurements.map((/** @type {any} */ m) => m.engagement),
    ['M11.05', 'M11.06'],
  );
});

test('ك٩ — الوسائطُ الثمانيةُ إلزاميّةٌ: نقصُ أيٍّ منها يُسقِطُ الأداةَ', () => {
  const s = scene();
  for (const missing of [
    'engagement',
    'plan',
    'command',
    'measured-root',
    'artifact-root',
    'expect-commit',
    'expect-main-head',
    'test-exit',
  ]) {
    const run = runTool(baseArgs(s, { [missing]: '' }));
    assert.notEqual(run.status, 0, `نقصُ --${missing} يجبُ أن يُسقِطَ الأداةَ.`);
    assert.match(run.stderr, new RegExp(`--${missing}`));
  }
});

test('ك١٠ — `assertMeasuredIdentity` دالّةٌ نقيّةٌ تُعيدُ البصمةَ المُشتَقّةَ', () => {
  const dir = makeRoot();
  const sha = initFixtureRepo(dir);
  const result = assertMeasuredIdentity({
    measuredRoot: dir,
    expectCommit: sha,
    expectMainHead: sha,
  });
  assert.equal(result.measuredSha, sha);
});

test('ك١١ — `assertExitAgreesWithTap` يُجيزُ المتوافقَ ويَرُدُّ المتناقضَ', () => {
  assert.doesNotThrow(() => assertExitAgreesWithTap(0, 0));
  assert.doesNotThrow(() => assertExitAgreesWithTap(1, 3));
  assert.throws(() => assertExitAgreesWithTap(0, 3), /MEASURE_EXIT_TAP_DIVERGENT/);
  assert.throws(() => assertExitAgreesWithTap(1, 0), /MEASURE_EXIT_TAP_DIVERGENT/);
});

test('ك١٢ — المُصنِّفُ يَعُدُّ `R7` ذاتيّاً و`R8` أجنبيّاً — وهذا هوَ حدُّ المنفَذِ', () => {
  const selfR6 = classifyFailures(guardFailureBlock(1, 'R6/STALE').join('\n'));
  assert.deepEqual([selfR6.selfStale, selfR6.other], [1, 0]);

  const selfR7 = classifyFailures(guardFailureBlock(1, 'R7/SCOPE-DRIFT').join('\n'));
  assert.deepEqual([selfR7.selfStale, selfR7.other], [1, 0]);

  const baseR8 = classifyFailures(guardFailureBlock(1, 'R8/BASE-DRIFT').join('\n'));
  assert.deepEqual(
    [baseR8.selfStale, baseR8.other],
    [0, 1],
    '`R8` يقولُ «الأساسُ تحرَّكَ» لا «الأثرُ متقادِمٌ» — واستثناؤُهُ يَفتحُ المنفَذَ الذي أُغلِقَ.',
  );
});
