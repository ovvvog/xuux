/**
 * اختباراتُ فاحصِ انزياحِ النطاقِ (`OPS-1/MAIN-DRIFT-WINDOW`).
 *
 * **ما يُقاسُ هنا:** القرارُ — هل تَرجِعُ `drifted: true` حينَ يُوجَدُ انزياحٌ،
 * و`false` حينَ لا يُوجَدُ؟ وهل تَرفُضُ الأثرَ الفاسدَ أو الغائبَ؟ وهل تَقرأُ
 * الإعلانَ من الكوميتِ لا من الشجرةِ العاملةِ (سابقةُ `SCOPE-BLIND`)؟
 *
 * **وما لا يُقاسُ هنا:** القياسُ نفسُهُ — ذلكَ في `measure-skip-baseline.mjs`
 * واختباراتِه. وهنا القرارُ وحدَهُ.
 *
 * @module tests/external-review/scope-drift-check.test.mjs
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  initFixtureRepo,
  commitFiles,
  setOriginMain,
  writeFile,
  DEFAULT_SCOPE_YAML,
  git,
} from '../helpers/skip-baseline-fixture.mjs';
import {
  computeScopeDigest,
  loadScopeExclusionsAt,
} from '../../scripts/lib/skip-baseline-scope.mjs';
import { checkScopeDrift } from '../../scripts/check-scope-drift.mjs';

/** يَكتُبُ أثراً منشوراً في مستودعِ الاختبارِ. */
function writeArtifact(
  /** @type {string} */ dir,
  /** @type {string} */ scopeDigest,
  /** @type {string} */ commit,
) {
  const art = {
    generatedBy: 'npm run measure:skip-baseline',
    measurements: [
      {
        engagement: 'M11.05',
        plan: 'docs/external-review/M11.05-round-1-plan.md',
        command: 'env -u DATABASE_URL npm test',
        commit,
        mainHeadAtMeasure: commit,
        scopeDigest,
        measuredOn: '2026-09-24',
        verdict: 'success',
        testFileCount: 1,
        tests: 1,
        pass: 1,
        fail: 0,
        skipped: 0,
      },
    ],
  };
  writeFile(dir, 'docs/external-review/skip-baseline.json', JSON.stringify(art, null, 2) + '\n');
}

describe('فاحصُ انزياحِ النطاقِ (OPS-1/MAIN-DRIFT-WINDOW)', () => {
  const tmpRoot = mkdtempSync(path.join(os.tmpdir(), 'xuux-drift-'));
  const dir = path.join(tmpRoot, 'repo');

  before(() => {
    mkdirSync(dir, { recursive: true });
    const sha = initFixtureRepo(dir);
    setOriginMain(dir, sha);
  });

  after(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('يَرجِعُ `drifted: false` حينَ لا انزياحَ — البصمةُ مطابِقةٌ', () => {
    const sha = git(dir, ['rev-parse', 'HEAD']).trim();
    const excl = loadScopeExclusionsAt(dir, sha);
    const digest = computeScopeDigest(dir, sha, excl);
    writeArtifact(dir, digest, sha);
    const result = checkScopeDrift(dir);
    assert.equal(result.drifted, false, `drifted=${result.drifted}: ${result.reason}`);
  });

  it('يَرجِعُ `drifted: true` حينَ يُوجَدُ انزياحٌ — البصمةُ اختلفتْ', () => {
    const sha = git(dir, ['rev-parse', 'HEAD']).trim();
    writeArtifact(dir, '0'.repeat(64), sha);
    const result = checkScopeDrift(dir);
    assert.equal(result.drifted, true, `drifted=${result.drifted}: ${result.reason}`);
    assert.match(result.reason, /انزياح/);
  });

  it('يَرجِعُ `drifted: true` حينَ لا أثرَ منشوراً', () => {
    rmSync(path.join(dir, 'docs/external-review/skip-baseline.json'), { force: true });
    const result = checkScopeDrift(dir);
    assert.equal(result.drifted, true, `drifted=${result.drifted}: ${result.reason}`);
    assert.match(result.reason, /لا أثرَ/);
  });

  it('يَرجِعُ `drifted: true` حينَ الأثرُ فاسدٌ', () => {
    writeFile(dir, 'docs/external-review/skip-baseline.json', 'not json');
    const result = checkScopeDrift(dir);
    assert.equal(result.drifted, true, `drifted=${result.drifted}: ${result.reason}`);
  });

  it('يَقرأُ الإعلانَ من الكوميتِ لا من الشجرةِ العاملةِ (SCOPE-BLIND)', () => {
    const sha = git(dir, ['rev-parse', 'HEAD']).trim();
    const excl = loadScopeExclusionsAt(dir, sha);
    const digest = computeScopeDigest(dir, sha, excl);
    writeArtifact(dir, digest, sha);

    // عدِّل الإعلانَ في الشجرةِ العاملةِ (بلا كوميتٍ) — يجبُ أن تَبقى البصمةُ كما هي
    writeFile(dir, 'config/skip-baseline-scope.yaml', DEFAULT_SCOPE_YAML + '\n# تعديلٌ محلّيٌّ');
    const result = checkScopeDrift(dir);
    assert.equal(
      result.drifted,
      false,
      `قرأَ الإعلانَ من الشجرةِ العاملةِ لا من الكوميتِ: ${result.reason}`,
    );

    // أصلِح الشجرةَ
    writeFile(dir, 'config/skip-baseline-scope.yaml', DEFAULT_SCOPE_YAML);
  });

  it('يَكتشِفُ الانزياحَ بعدَ تعديلِ ملفٍّ في النطاقِ', () => {
    const sha = git(dir, ['rev-parse', 'HEAD']).trim();
    const excl = loadScopeExclusionsAt(dir, sha);
    const digest = computeScopeDigest(dir, sha, excl);
    writeArtifact(dir, digest, sha);

    // أضِف ملفَّ مصدرٍ جديداً وقيِّدْهُ
    const newSha = commitFiles(dir, { 'src/new.mjs': 'export const x = 2;\n' });
    setOriginMain(dir, newSha);

    const result = checkScopeDrift(dir);
    assert.equal(result.drifted, true, `لم يَكتشِفِ الانزياحَ: ${result.reason}`);
    assert.match(result.reason, /انزياح/);
  });

  it('لا يَكتشِفُ انزياحاً بعدَ تعديلِ ملفٍّ مُستثنىً (سجلِّ الأعمالِ)', () => {
    const sha = git(dir, ['rev-parse', 'HEAD']).trim();
    const excl = loadScopeExclusionsAt(dir, sha);
    const digest = computeScopeDigest(dir, sha, excl);
    writeArtifact(dir, digest, sha);

    // عدِّل ملفّاً مُستثنىً — لا يُبدِّلُ البصمةَ
    const newSha = commitFiles(dir, {
      'docs/roadmap/05-work-log.md': '# تعديلٌ في السجلِّ\n',
    });
    setOriginMain(dir, newSha);

    const result = checkScopeDrift(dir);
    assert.equal(result.drifted, false, `اكتشفَ انزياحاً في ملفٍّ مُستثنىً: ${result.reason}`);
  });
});
