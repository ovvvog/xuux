/**
 * جذورٌ مصنوعةٌ لقياسِ عقدِ هويّةِ خطِّ أساسِ التخطّي (‏`OPS-1`).
 *
 * **لماذا مستودَعاتٌ حقيقيّةٌ لا كائناتٌ مُزيَّفةٌ:** ما يُقاسُ هنا هويّةُ شجرةِ
 * `git` — `rev-parse HEAD` و`status --porcelain` و`ls-tree -r -z` و
 * `merge-base --is-ancestor`. ومُزيَّفٌ يُحاكي هذه الأربعةَ **يُثبِتُ أنَّ وصفَها
 * صحيحٌ ولا يُثبِتُ أنّها تَحرُسُ**. فالجذورُ هنا مستودَعاتٌ فعليّةٌ صغيرةٌ.
 *
 * ولا تُنشِئُ هذه الوحدةُ جذراً مؤقّتاً بنفسِها: الجذرُ يُنشَأُ في ملفِّ الاختبارِ
 * ويُسجَّلُ بـ`registerTmpRoot` هناكَ — سياسةُ `LIVE-9` و`guard:test-tmp-hygiene`.
 *
 * @module tests/helpers/skip-baseline-fixture
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';

/**
 * يُطبِّقُ `git` في جذرٍ صريحٍ بهويّةٍ محلّيّةٍ — بلا اعتمادٍ على إعدادٍ عامٍّ.
 *
 * @param {string} dir
 * @param {string[]} args
 * @returns {string}
 */
export function git(dir, args) {
  return execFileSync('git', ['-C', dir, ...args], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
}

/** إعلانُ النطاقِ الافتراضيُّ في الجذورِ المصنوعةِ — نسخةُ عقدِ المستودعِ. */
export const DEFAULT_SCOPE_YAML = 'version: 1\nnonScope:\n  - docs/\n  - PROJECT_STATUS.md\n';

/**
 * يُنشئُ مستودَعاً صغيراً فيه عقدُ نطاقٍ وخطّةُ مراجعةٍ وملفُّ مصدرٍ وملفُّ اختبارٍ.
 *
 * @param {string} dir جذرٌ موجودٌ (مُسجَّلٌ بـ`registerTmpRoot` في ملفِّ الاختبارِ).
 * @param {{ scopeYaml?: string, extraFiles?: Record<string, string> }} [options]
 * @returns {string} بصمةُ الكوميتِ الأوّلِ (أربعونَ محرفاً).
 */
export function initFixtureRepo(dir, options = {}) {
  git(dir, ['init', '--quiet', '-b', 'main']);
  git(dir, ['config', 'user.email', 'fixture@example.invalid']);
  git(dir, ['config', 'user.name', 'fixture']);
  git(dir, ['config', 'commit.gpgsign', 'false']);
  writeFile(dir, 'config/skip-baseline-scope.yaml', options.scopeYaml ?? DEFAULT_SCOPE_YAML);
  writeFile(dir, 'docs/external-review/M11.05-round-1-plan.md', '# خطّةُ الجولةِ الأولى\n');
  writeFile(dir, 'src/core.mjs', 'export const value = 1;\n');
  writeFile(dir, 'tests/alpha.test.mjs', "import 'node:test';\n");
  for (const [rel, body] of Object.entries(options.extraFiles ?? {})) {
    writeFile(dir, rel, body);
  }
  git(dir, ['add', '-A']);
  git(dir, ['commit', '--quiet', '-m', 'fixture: أساسٌ']);
  return git(dir, ['rev-parse', 'HEAD']).trim();
}

/**
 * يَكتُبُ ملفّاً وينشئُ مجلَّداتِهِ.
 *
 * @param {string} dir
 * @param {string} rel
 * @param {string} body
 * @returns {void}
 */
export function writeFile(dir, rel, body) {
  const full = path.join(dir, rel);
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, body, 'utf8');
}

/**
 * يُقيِّدُ كوميتاً جديداً بعدَ تعديلٍ.
 *
 * @param {string} dir
 * @param {Record<string, string>} files
 * @param {string} [message]
 * @returns {string} بصمةُ الكوميتِ الجديدِ.
 */
export function commitFiles(dir, files, message = 'fixture: تعديلٌ') {
  for (const [rel, body] of Object.entries(files)) writeFile(dir, rel, body);
  git(dir, ['add', '-A']);
  git(dir, ['commit', '--quiet', '-m', message]);
  return git(dir, ['rev-parse', 'HEAD']).trim();
}

/**
 * يَحذفُ مساراً متعقَّباً ويُقيِّدُ الحذفَ.
 *
 * @param {string} dir
 * @param {string} rel
 * @returns {string}
 */
export function removeAndCommit(dir, rel) {
  rmSync(path.join(dir, rel), { force: true, recursive: true });
  git(dir, ['add', '-A']);
  git(dir, ['commit', '--quiet', '-m', `fixture: حذفُ ${rel}`]);
  return git(dir, ['rev-parse', 'HEAD']).trim();
}

/**
 * يُثبِّتُ `refs/remotes/origin/main` على بصمةٍ بعينِها — **بهِ تُحاكى لحظةُ
 * تحرُّكِ `main`** بلا مستودَعٍ بعيدٍ حقيقيٍّ.
 *
 * @param {string} dir
 * @param {string} sha
 * @returns {void}
 */
export function setOriginMain(dir, sha) {
  git(dir, ['update-ref', 'refs/remotes/origin/main', sha]);
}

/**
 * نصُّ TAP أدنى صالحٍ — بمُلخَّصٍ ختاميٍّ وأسبابِ تخطٍّ مُسمَّاةٍ.
 *
 * @param {{ tests?: number, pass?: number, fail?: number, skipped?: number,
 *   extraLines?: string[] }} [options]
 * @returns {string}
 */
export function tapText(options = {}) {
  const tests = options.tests ?? 3;
  const pass = options.pass ?? 2;
  const failed = options.fail ?? 0;
  const skipped = options.skipped ?? 1;
  const lines = [
    'TAP version 13',
    'ok 1 - alpha',
    'ok 2 - beta',
    'ok 3 - gamma # SKIP DATABASE_URL غيرُ مُعرَّفٍ',
    ...(options.extraLines ?? []),
    `# tests ${tests}`,
    `# pass ${pass}`,
    `# fail ${failed}`,
    `# skipped ${skipped}`,
  ];
  return `${lines.join('\n')}\n`;
}

/**
 * كتلةُ إخفاقٍ ذاتيٍّ مرجعيٍّ برمزٍ بعينِهِ — لقياسِ منفَذِ `LIVE-16` وحدودِهِ.
 *
 * @param {number} index
 * @param {string} code مثلُ `R6/STALE` أو `R7/SCOPE-DRIFT` أو `R8/BASE-DRIFT`.
 * @returns {string[]}
 */
export function guardFailureBlock(index, code) {
  return [
    `not ok ${index} - tests/external-review/skip-baseline.test.mjs`,
    '  ---',
    "  error: 'حاجزُ خطِّ أساسِ التخطّي سقطَ'",
    '  code: ERR_TEST_FAILURE',
    `  stderr: |-`,
    `    - ${code}: من guard-skip-baseline`,
    '  ...',
  ];
}

/**
 * كتلةُ إخفاقٍ أجنبيٍّ — لا علاقةَ لها بالأثرِ.
 *
 * @param {number} index
 * @returns {string[]}
 */
export function foreignFailureBlock(index) {
  return [
    `not ok ${index} - tests/authn/king-auth.test.mjs`,
    '  ---',
    "  error: 'توقيعٌ غيرُ صالحٍ'",
    '  code: ERR_TEST_FAILURE',
    '  ...',
  ];
}
