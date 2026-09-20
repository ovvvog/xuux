// اختباراتُ خطِّ أساسِ التخطّي — النتيجةُ `R5-A-06` (مجلسُ `M11.05`، تقريرُ `R5-A-01`).
//
// **ما تُثبِتُه:** أنَّ عددَ التخطّي المُعلَنَ في خُطَطِ المراجعةِ **مقيسٌ بأمرٍ يُشغَّلُ**
// ومنسوبٌ إلى كوميتٍ، وأنَّ الحاجزَ **يَرفُضُ** إن كُتِبَ بيدٍ أو بَليَ أو خُلِطَ بغيرِه.
// وكلُّ توكيدٍ هنا يُقاسُ على **شجرةٍ مصنوعةٍ** لا على شجرةِ المستودعِ، فلا يُفسِدُ
// قياسُ الرفضِ ملفّاً قائماً.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { checkSkipBaseline, normalizeDigits } from '../../scripts/guard-skip-baseline.mjs';
import { parseTap } from '../../scripts/measure-skip-baseline.mjs';

const REPO = path.resolve(import.meta.dirname, '../..');
const GUARD = path.join(REPO, 'scripts/guard-skip-baseline.mjs');
const ARTIFACT = 'docs/external-review/skip-baseline.json';
const PLAN = 'docs/external-review/M11.05-round-1-plan.md';

/** @type {string[]} */
const roots = [];

/**
 * يَبنيَ شجرةً صغيرةً تحملُ خطّةً وأثرَ قياسٍ متطابقَينِ.
 * @param {{ declared?: string, artifactPatch?: Record<string, unknown>, omitCommand?: boolean,
 *   omitCommit?: boolean, omitArtifact?: boolean, testFileCount?: number }} [opts]
 * @returns {string}
 */
function makeTree(opts = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'skip-baseline-'));
  roots.push(root);
  mkdirSync(path.join(root, 'docs/external-review'), { recursive: true });
  mkdirSync(path.join(root, 'tests'), { recursive: true });
  // أنشئ ملفَّ اختبارٍ وهميّاً ليُطابقَ testFileCount
  const tfc = opts.testFileCount ?? 1;
  for (let i = 0; i < tfc; i++) {
    writeFileSync(
      path.join(root, `tests/synthetic-${i}.test.mjs`),
      "import {test} from 'node:test';\ntest('synthetic', () => {});\n",
      'utf8',
    );
  }
  const declared = opts.declared ?? '٩٢';
  const cmd = opts.omitCommand ? 'أمرٌ آخرُ' : 'env -u DATABASE_URL npm test';
  const commit = opts.omitCommit ? 'deadbeef' : 'fba8c10f';
  writeFileSync(
    path.join(root, PLAN),
    '# خطّةٌ مصنوعةٌ للقياسِ\n\n> بلا `DATABASE_URL` تتخطّى الحزمةُ ' +
      declared +
      ' اختباراً.\n>\n> الأمرُ: `' +
      cmd +
      '` · الكوميتُ: `' +
      commit +
      '`\n',
    'utf8',
  );
  if (!opts.omitArtifact) {
    const entry = {
      engagement: 'M11.05',
      plan: PLAN,
      command: 'env -u DATABASE_URL npm test',
      commit: 'fba8c10f000000000000000000000000000000000',
      measuredOn: '2026-09-20',
      testFileCount: tfc,
      tests: 2127,
      pass: 2001,
      fail: 0,
      skipped: 126,
      skipLines: 128,
      topLevelSkipPoints: 121,
      attributedToDatabaseUrl: 92,
      otherReasons: [{ reason: 'swtpm unavailable', count: 25 }],
      ...(opts.artifactPatch ?? {}),
    };
    writeFileSync(
      path.join(root, ARTIFACT),
      JSON.stringify(
        { generatedBy: 'npm run measure:skip-baseline', measurements: [entry] },
        null,
        2,
      ) + '\n',
      'utf8',
    );
  }
  return root;
}

test.after(() => {
  for (const r of roots) rmSync(r, { recursive: true, force: true });
});

test('R5-A-06: شجرةٌ عددُها مقيسٌ ومنسوبٌ ⇒ لا انتهاكَ', () => {
  const { violations } = checkSkipBaseline(makeTree());
  assert.deepEqual(violations, []);
});

test('R5-A-06: عددٌ مكتوبٌ بيدٍ بلا أثرِ قياسٍ ⇒ مردودٌ بـR3', () => {
  const { violations } = checkSkipBaseline(makeTree({ omitArtifact: true }));
  assert.equal(violations.length, 1);
  assert.match(violations.join(' | '), /R1\/MISSING/);
});

test('R5-A-06: الرقمُ الذي بَليَ (١٢١ مقابلَ المقيسِ) ⇒ مردودٌ بـR4 — وهو العطبُ بعينِه', () => {
  const { violations } = checkSkipBaseline(makeTree({ declared: '١٢١' }));
  const drift = violations.filter((v) => v.startsWith('R4/DRIFT'));
  assert.equal(drift.length, 1, `تُوقَّعَ انحرافٌ واحدٌ، والذي وقعَ: ${violations.join(' | ')}`);
  assert.match(drift.join(' | '), /يُعلِنُ 121 .*والقياسُ 92/);
});

test('R5-A-06: خلطُ عدّادِ التخطّي الكلّيِّ (١٢٦) بالمنسوبِ إلى DATABASE_URL ⇒ مردودٌ بـR4', () => {
  const { violations } = checkSkipBaseline(makeTree({ declared: '١٢٦' }));
  assert.ok(violations.some((v) => /R4\/DRIFT/.test(v) && /يُعلِنُ 126/.test(v)));
});

test('R5-A-06: عددٌ بلا أمرٍ يُنتِجُه ⇒ مردودٌ بـR5/NO-COMMAND', () => {
  const { violations } = checkSkipBaseline(makeTree({ omitCommand: true }));
  assert.ok(violations.some((v) => v.startsWith('R5/NO-COMMAND')));
});

test('R5-A-06: عددٌ بلا كوميتٍ يُنسَبُ إليه ⇒ مردودٌ بـR5/NO-COMMIT', () => {
  const { violations } = checkSkipBaseline(makeTree({ omitCommit: true }));
  assert.ok(violations.some((v) => v.startsWith('R5/NO-COMMIT')));
});

test('R5-A-06: نسبةٌ إلى DATABASE_URL أكبرُ من عدّادِ التخطّي ⇒ مردودةٌ بـR1/SANITY', () => {
  const { violations } = checkSkipBaseline(
    makeTree({ declared: '٢٠٠', artifactPatch: { attributedToDatabaseUrl: 200 } }),
  );
  assert.ok(violations.some((v) => v.startsWith('R1/SANITY')));
});

test('R5-A-06: حقلٌ غيرُ عددٍ صحيحٍ في الأثرِ ⇒ مردودٌ بـR1/FIELD', () => {
  const { violations } = checkSkipBaseline(
    makeTree({ artifactPatch: { skipped: 'مئةٌ وستةٌ وعشرون' } }),
  );
  assert.ok(violations.some((v) => v.startsWith('R1/FIELD')));
});

test('LIVE-15: الأثرُ بعددِ ملفّاتٍ قديمٍ والشجرةُ نَمَتْ ⇒ مردودٌ بـR6/STALE', () => {
  const root = makeTree({ testFileCount: 3 });
  // الأثرُ يقولُ 3 ملفّاتٍ لكنَّ الشجرةَ فيها 3 فعلاً — فلا انتهاكَ
  let { violations } = checkSkipBaseline(root);
  assert.ok(
    !violations.some((v) => v.startsWith('R6/STALE')),
    `لا ينبغي أن يكونَ R6/STALE: ${violations.join(' | ')}`,
  );

  // أضف ملفَّ اختبارٍ رابعاً — فالأثرُ يقولُ 3 والشجرةُ فيها 4
  writeFileSync(
    path.join(root, 'tests/extra.test.mjs'),
    "import {test} from 'node:test';\ntest('extra', () => {});\n",
    'utf8',
  );
  violations = checkSkipBaseline(root).violations;
  const stale = violations.filter((v) => v.startsWith('R6/STALE'));
  assert.equal(stale.length, 1, `تُوقِّعَ انتهاكٌ واحدٌ، والذي وقعَ: ${violations.join(' | ')}`);
  assert.match(stale.join(' | '), /3.*4/);
});

test('LIVE-15: الأثرُ بعددِ ملفّاتٍ مطابِقٍ ⇒ لا انتهاكَ بـR6', () => {
  const root = makeTree({ testFileCount: 2 });
  const { violations } = checkSkipBaseline(root);
  assert.ok(
    !violations.some((v) => v.startsWith('R6/STALE')),
    `لا ينبغي أن يكونَ R6/STALE: ${violations.join(' | ')}`,
  );
});

test('LIVE-15: حقلُ testFileCount مفقودٌ في الأثرِ ⇒ لا انتهاكَ بـR6 (تسامحٌ مع الأثرِ القديمِ)', () => {
  const root = makeTree({ artifactPatch: { testFileCount: undefined } });
  const { violations } = checkSkipBaseline(root);
  // testFileCount غيرُ موجودٍ في الأثرِ — فالحاجزُ لا يَسقُطُ (الأثرُ القديمُ لا يُعاقَبُ)
  assert.ok(!violations.some((v) => v.startsWith('R6/STALE')));
});

test('قارئُ TAP يُفرِّقُ ثلاثةَ مقاييسَ ولا يَخلِطُها', () => {
  const tap = [
    'TAP version 13',
    'ok 1 - ناجحٌ',
    'ok 2 - متخطّىً # SKIP DATABASE_URL غير معلَنة',
    '    ok 1 - فرعيٌّ متخطّىً # SKIP DATABASE_URL غير معلَنة',
    'ok 3 - متخطّىً # SKIP swtpm unavailable',
    '1..3',
    '# tests 3',
    '# suites 1',
    '# pass 1',
    '# fail 0',
    '# skipped 2',
    '# todo 0',
  ].join('\n');
  const m = parseTap(tap);
  assert.equal(m.skipped, 2, 'عدّادُ node الختاميُّ');
  assert.equal(m.skipLines, 3, 'كلُّ أسطرِ # SKIP على أيِّ عمقٍ');
  assert.equal(m.topLevelSkipPoints, 2, 'نقاطُ المستوى الأعلى وحدَها');
  assert.equal(m.attributedToDatabaseUrl, 2, 'المنسوبُ إلى DATABASE_URL');
  assert.deepEqual(m.otherReasons, [{ reason: 'swtpm unavailable', count: 1 }]);
});

test('مُحوِّلُ الأرقامِ العربيّةِ الشرقيّةِ يُقرأُ لا يُخمَّنُ', () => {
  assert.equal(normalizeDigits('١٢٦'), '126');
  assert.equal(normalizeDigits('٩٢ اختباراً'), '92 اختباراً');
  assert.equal(normalizeDigits('126'), '126');
});

test('الحاجزُ عمليّةً منفصلةً: يَخرُجُ بـ0 على المستودعِ وبـ1 على شجرةٍ مُطفَّرةٍ', () => {
  const clean = execFileSync('node', [GUARD], { cwd: REPO, encoding: 'utf8' });
  assert.match(clean, /✅ حاجزُ خطِّ أساسِ التخطّي/);

  const root = mkdtempSync(path.join(tmpdir(), 'skip-baseline-proc-'));
  roots.push(root);
  mkdirSync(path.join(root, 'docs/external-review'), { recursive: true });
  mkdirSync(path.join(root, 'tests'), { recursive: true });
  cpSync(path.join(REPO, ARTIFACT), path.join(root, ARTIFACT));
  for (const rel of [PLAN, 'docs/external-review/M11.06-round-2-plan.md']) {
    cpSync(path.join(REPO, rel), path.join(root, rel));
  }
  // أنشئ 218 ملفَّ اختبارٍ ليُطابقَ testFileCount في الأثرِ
  for (let i = 0; i < 218; i++) {
    writeFileSync(
      path.join(root, `tests/synthetic-${i}.test.mjs`),
      "import {test} from 'node:test';\ntest('synthetic', () => {});\n",
      'utf8',
    );
  }
  // الطفرةُ: إعادةُ الرقمِ إلى ما كانَ قبلَ الإصلاحِ.
  const planPath = path.join(root, PLAN);
  const mutated = readFileSync(planPath, 'utf8').replace(
    'تتخطّى الحزمةُ ٩٢ اختباراً',
    'تتخطّى الحزمةُ ١٢١ اختباراً',
  );
  assert.ok(mutated.includes('١٢١ اختباراً'), 'الطفرةُ لم تُطبَّقْ — راجِعْ نصَّ الخطّةِ');
  writeFileSync(planPath, mutated, 'utf8');

  let code = 0;
  let stderr = '';
  try {
    execFileSync('node', [GUARD], { cwd: root, encoding: 'utf8', stdio: 'pipe' });
  } catch (err) {
    const e = /** @type {{ status: number, stderr: string }} */ (err);
    code = e.status;
    stderr = e.stderr;
  }
  assert.equal(code, 1, 'حاجزٌ لا يَسقُطُ عندَ نقضِه ليسَ مُنفَذاً');
  assert.match(stderr, /R4\/DRIFT/);
});
