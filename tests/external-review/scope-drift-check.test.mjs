/**
 * اختباراتُ فاحصِ انزياحِ النطاقِ وسيرِ الإطلاقِ الآليِّ (`OPS-1/MAIN-DRIFT-WINDOW`).
 *
 * **ما يُقاسُ هنا:** القرارُ ثلاثيٌّ لا ثنائيٌّ — `clean` و`drift` وخطأٌ مُسمّىً —
 * **والعجزُ عنِ الحُكمِ لا يُقرَأُ انزياحاً**؛ ومرشحُ موضعِ السقوطِ في التشغيلةِ
 * المُحرِّكةِ؛ ورموزُ الخروجِ من عمليّةٍ منفصلةٍ؛ وبنيةُ سيرِ العملِ مُحلَّلةً لا نصّاً.
 *
 * **وما لا يُقاسُ هنا:** القياسُ نفسُهُ — ذلكَ في `measure-skip-baseline.mjs`
 * واختباراتِه.
 *
 * @module tests/external-review/scope-drift-check.test.mjs
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import { parse as parseYaml } from 'yaml';
import { registerTmpRoot } from '../helpers/tmp-roots.mjs';
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
import { checkScopeDrift, classifyTriggerJobs, EXIT } from '../../scripts/check-scope-drift.mjs';

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');
const SCRIPT = path.join(REPO_ROOT, 'scripts', 'check-scope-drift.mjs');
const WORKFLOW = path.join(REPO_ROOT, '.github', 'workflows', 'auto-measure-skip-baseline.yml');
const ARTIFACT = 'docs/external-review/skip-baseline.json';

/**
 * يَكتُبُ أثراً منشوراً في مستودعِ الاختبارِ.
 *
 * @param {string} dir
 * @param {string} scopeDigest
 * @param {string} commit
 */
function writeArtifact(dir, scopeDigest, commit) {
  const art = {
    generatedBy: 'npm run measure:skip-baseline',
    measurements: [
      {
        engagement: 'M11.05',
        commit,
        mainHeadAtMeasure: commit,
        scopeDigest,
        verdict: 'success',
      },
    ],
  };
  writeFile(dir, ARTIFACT, JSON.stringify(art, null, 2) + '\n');
}

/** @param {string} dir */
function head(dir) {
  return git(dir, ['rev-parse', 'HEAD']).trim();
}

/** @param {string} dir */
function publishMatching(dir) {
  const sha = head(dir);
  writeArtifact(dir, computeScopeDigest(dir, sha, loadScopeExclusionsAt(dir, sha)), sha);
  return sha;
}

/**
 * @param {string} cwd
 * @param {string[]} args
 */
function runCli(cwd, args = []) {
  return spawnSync(process.execPath, [SCRIPT, ...args], { cwd, encoding: 'utf8' });
}

/**
 * وظائفُ تشغيلةِ CI كما تُعيدُها الواجهةُ.
 *
 * @param {Array<[string, string]>} validateSteps
 * @param {{ preflight?: string, validate?: string }} [c]
 */
function jobs(validateSteps, c = {}) {
  return {
    jobs: [
      { name: 'فحص العدّاء المسبق (LIVE-18)', conclusion: c.preflight ?? 'success', steps: [] },
      {
        name: 'فحص الجودة الكامل',
        conclusion: c.validate ?? 'failure',
        steps: validateSteps.map(([name, conclusion]) => ({ name, conclusion })),
      },
      {
        name: 'تقرير البوابتين G0 و G1',
        conclusion: 'failure',
        steps: [{ name: 'خلاصة النتيجة', conclusion: 'failure' }],
      },
    ],
  };
}

describe('فاحصُ انزياحِ النطاقِ (OPS-1/MAIN-DRIFT-WINDOW)', () => {
  const tmpRoot = registerTmpRoot(mkdtempSync(path.join(os.tmpdir(), 'xuux-drift-')));
  const dir = path.join(tmpRoot, 'repo');

  before(() => {
    mkdirSync(dir, { recursive: true });
    setOriginMain(dir, initFixtureRepo(dir));
  });

  after(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('د١ — بصمةٌ مطابِقةٌ ⇒ `clean`', () => {
    publishMatching(dir);
    assert.equal(checkScopeDrift(dir).decision, 'clean');
  });

  it('د٢ — بصمةٌ مختلفةٌ ⇒ `drift`', () => {
    writeArtifact(dir, '0'.repeat(64), head(dir));
    const r = checkScopeDrift(dir);
    assert.equal(r.decision, 'drift', r.reason);
  });

  it('د٣ — لا أثرَ ⇒ خطأٌ مُسمّىً لا انزياحٌ', () => {
    rmSync(path.join(dir, ARTIFACT), { force: true });
    assert.throws(() => checkScopeDrift(dir), /SCOPE_DRIFT_NO_ARTIFACT/);
  });

  it('د٤ — أثرٌ فاسدٌ ⇒ خطأٌ مُسمّىً لا انزياحٌ', () => {
    writeFile(dir, ARTIFACT, 'not json');
    assert.throws(() => checkScopeDrift(dir), /SCOPE_DRIFT_NO_ARTIFACT/);
  });

  it('د٥ — الإعلانُ يُقرَأُ من الكوميتِ لا من الشجرةِ العاملةِ (SCOPE-BLIND)', () => {
    publishMatching(dir);
    writeFile(dir, 'config/skip-baseline-scope.yaml', DEFAULT_SCOPE_YAML + '\n# تعديلٌ محلّيٌّ\n');
    try {
      assert.equal(checkScopeDrift(dir).decision, 'clean');
    } finally {
      writeFile(dir, 'config/skip-baseline-scope.yaml', DEFAULT_SCOPE_YAML);
    }
  });

  it('د٦ — ملفٌّ في النطاقِ يُقيَّدُ ⇒ `drift`', () => {
    publishMatching(dir);
    setOriginMain(dir, commitFiles(dir, { 'src/new.mjs': 'export const x = 2;\n' }));
    assert.equal(checkScopeDrift(dir).decision, 'drift');
  });

  it('د٧ — ملفٌّ مُستثنىً (سجلُّ الأعمالِ) ⇒ `clean`', () => {
    publishMatching(dir);
    setOriginMain(dir, commitFiles(dir, { 'docs/roadmap/05-work-log.md': '# تعديلٌ\n' }));
    assert.equal(checkScopeDrift(dir).decision, 'clean');
  });

  it('د٨ — تشغيلةٌ مُحرِّكةٌ على غيرِ رأسِ `main` ⇒ `clean` (الأحدثُ يَحكُمُ) ولو انزاحَ النطاقُ', () => {
    writeArtifact(dir, '0'.repeat(64), head(dir));
    const r = checkScopeDrift(dir, { expectHead: 'a'.repeat(40) });
    assert.equal(r.decision, 'clean');
    assert.match(r.reason, /SCOPE_DRIFT_SUPERSEDED/);
    assert.equal(checkScopeDrift(dir, { expectHead: head(dir) }).decision, 'drift');
  });

  it('د٩ — رموزُ الخروجِ من عمليّةٍ منفصلةٍ: 0 · 1 · 2، والخطأُ ليسَ 1', () => {
    publishMatching(dir);
    assert.equal(runCli(dir).status, EXIT.clean);
    writeArtifact(dir, '0'.repeat(64), head(dir));
    assert.equal(runCli(dir).status, EXIT.drift);
    rmSync(path.join(dir, ARTIFACT), { force: true });
    const missing = runCli(dir);
    assert.equal(missing.status, EXIT.error);
    assert.match(missing.stderr, /SCOPE_DRIFT_NO_ARTIFACT/);
    assert.equal(runCli(dir, ['--bogus']).status, EXIT.error);
    assert.equal(runCli(dir, ['--expect-head', 'abc']).status, EXIT.error);
  });

  it('د١٠ — مرشحُ الموضعِ عبرَ السطرِ: سقوطٌ أجنبيٌّ ⇒ 0 ولو انزاحَ النطاقُ', () => {
    writeArtifact(dir, '0'.repeat(64), head(dir));
    const jobsFile = path.join(tmpRoot, 'jobs.json');
    writeFile(tmpRoot, 'jobs.json', JSON.stringify(jobs([['فحص الأسلوب (ESLint)', 'failure']])));
    assert.equal(runCli(dir, ['--trigger-jobs', jobsFile]).status, EXIT.clean);
    writeFile(tmpRoot, 'jobs.json', JSON.stringify(jobs([['الاختبارات', 'failure']])));
    assert.equal(runCli(dir, ['--trigger-jobs', jobsFile]).status, EXIT.drift);
    writeFile(tmpRoot, 'jobs.json', '{}');
    assert.equal(runCli(dir, ['--trigger-jobs', jobsFile]).status, EXIT.error);
  });
});

describe('مرشحُ موضعِ السقوطِ (classifyTriggerJobs)', () => {
  it('م١ — سقوطُ الاختباراتِ وحدَها ⇒ مؤهَّلٌ', () => {
    assert.equal(classifyTriggerJobs(jobs([['الاختبارات', 'failure']])).eligible, true);
  });

  it('م٢ — سقوطُ خطوةِ الحاجزِ وحدَها ⇒ مؤهَّلٌ', () => {
    const step = 'حاجز خطّ أساس التخطّي (R5-A-06 · OPS-1) — لا عددَ تخطٍّ مكتوباً بيدٍ';
    assert.equal(classifyTriggerJobs(jobs([[step, 'failure']])).eligible, true);
  });

  it('م٣ — سقوطُ خطوةٍ أخرى ⇒ غيرُ مؤهَّلٍ باسمِها', () => {
    const v = classifyTriggerJobs(
      jobs([
        ['الاختبارات', 'failure'],
        ['فحص الأنواع (TypeScript)', 'failure'],
      ]),
    );
    assert.equal(v.eligible, false);
    assert.match(v.reason, /SCOPE_DRIFT_FOREIGN_TRIGGER/);
    assert.match(v.reason, /TypeScript/);
  });

  it('م٤ — سقوطُ الفحصِ المُسبَقِ أو إلغاؤُهُ ⇒ غيرُ مؤهَّلٍ', () => {
    for (const preflight of ['failure', 'cancelled']) {
      const v = classifyTriggerJobs(jobs([], { preflight, validate: 'skipped' }));
      assert.equal(v.eligible, false, preflight);
    }
  });

  it('م٥ — خطوةٌ مُلغاةٌ في `validate` ⇒ غيرُ مؤهَّلٍ', () => {
    assert.equal(classifyTriggerJobs(jobs([['الاختبارات', 'cancelled']])).eligible, false);
  });

  it('م٦ — لا خطوةَ ساقطةً ⇒ غيرُ مؤهَّلٍ', () => {
    const v = classifyTriggerJobs(jobs([['الاختبارات', 'success']]));
    assert.equal(v.eligible, false);
    assert.match(v.reason, /SCOPE_DRIFT_NO_SELF_FAILURE/);
  });

  it('م٧ — حمولةٌ بلا وظائفَ ⇒ خطأٌ مُسمّىً', () => {
    assert.throws(() => classifyTriggerJobs({}), /SCOPE_DRIFT_TRIGGER_JOBS_INVALID/);
    assert.throws(() => classifyTriggerJobs(null), /SCOPE_DRIFT_TRIGGER_JOBS_INVALID/);
  });

  it('م٨ — أسماءُ المرشحِ حاضرةٌ فعلاً في `ci.yml` (لا مرشحَ على أسماءٍ مُتخيَّلةٍ)', () => {
    const ci = parseYaml(readFileSync(path.join(REPO_ROOT, '.github/workflows/ci.yml'), 'utf8'));
    assert.equal(ci.jobs.validate.name, 'فحص الجودة الكامل');
    assert.match(ci.jobs['gate-report'].name, /^تقرير البوابتين/);
    const names = ci.jobs.validate.steps.map((/** @type {{ name?: string }} */ s) => s.name ?? '');
    assert.ok(names.includes('الاختبارات'));
    assert.ok(names.some((/** @type {string} */ n) => n.startsWith('حاجز خطّ أساس التخطّي')));
  });
});

describe('سيرُ الإطلاقِ الآليِّ مُحلَّلاً لا نصّاً', () => {
  const doc = parseYaml(readFileSync(WORKFLOW, 'utf8'));
  const job = doc.jobs['check-and-dispatch'];

  it('س١ — لا `continue-on-error` في أيِّ موضعٍ', () => {
    assert.ok(!JSON.stringify(doc).includes('continue-on-error'));
  });

  it('س٢ — يُحرَّكُ بسقوطِ CI على `main` وحدَهُ', () => {
    assert.deepEqual(doc.on.workflow_run.workflows, ['CI']);
    assert.deepEqual(doc.on.workflow_run.branches, ['main']);
    assert.equal(job.if, "github.event.workflow_run.conclusion == 'failure'");
  });

  it('س٣ — بلا صلاحيّةِ كتابةٍ على المحتوى', () => {
    assert.deepEqual(doc.permissions, { contents: 'read', actions: 'write' });
  });

  it('س٤ — الإطلاقُ مشروطٌ بمُخرَجِ الانزياحِ لا بنتيجةِ الخطوةِ', () => {
    const dispatch = job.steps.find((/** @type {{ name?: string }} */ s) =>
      String(s.name).startsWith('إطلاقُ القياسِ'),
    );
    assert.equal(dispatch.if, "steps.drift.outputs.drifted == 'true'");
    const drift = job.steps.find((/** @type {{ id?: string }} */ s) => s.id === 'drift');
    assert.match(drift.run, /--expect-head/);
    assert.match(drift.run, /--trigger-jobs/);
    assert.match(drift.run, /\*\)[\s\S]*exit "\$code"/, 'ما سوى 0 و1 يُسقِطُ الخطوةَ.');
  });
});
