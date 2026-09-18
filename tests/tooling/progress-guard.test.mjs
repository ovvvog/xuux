// اختبار حاجز التقدّم — أُضيف في `WL-063`.
//
// **العيبُ الذي يُغلقه:** كانت نسبةُ الإنجازِ في المستودع موثَّقةً `≈95%` مُشتقَّةً
// من ثابتٍ محمولٍ (`87.04`) لا يُشتَقُّ من جدولِ خطّ الأساسِ في `§2.9` — أي
// تقديرٌ يدويٌّ يخالفُ المادةَ الثامنة. فصار الحارسُ `guard:progress` يَحسُبُ النسبةَ
// **آلياً** من عدّادِ الخطواتِ بالصيغةِ المعمّمةِ، ويُغلقُ كلَّ انحرافٍ يدويٍّ
// في اللوحةِ أو `version.json` أو `§2.1` أو `last_entry`.
//
// **قرارٌ مقصود:** الاختبارُ **يُشغِّل الحاجزَ فعلاً** على نسخةٍ مؤقّتةٍ فيها
// عيبٌ مصنوع، ويقيس خروجَه لا نصَّه: حاجزٌ يُقاس بقراءةِ سطوره قد يكون كلَّه
// طباعةً بلا حكم. والنسخةُ المؤقّتةُ تُنسخ فيها ملفّاتُ الخارطةِ وخطّ الأساسِ
// الفعليةُ ثم يُطبَّق عليها التعديل، كي يُقاس ما يُقاس في المسار.
//
// **حدودٌ معلَنة:** يُقاس الاتّساقُ الآليُّ (اللوحة/النسبة/الـlast_entry/§2.1) لا
// صحّةُ الصيغةِ الرياضيّةِ بحدِّ ذاتِها — فالصيغةُ محفورةٌ في `progress-facts.mjs`
// وتُقاس بقراءتِه، ويبقى أيُّ تعديلٍ عليها شرطَ مُدخلةٍ في سجلِّ الأعمال بالمادة 1.

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { registerTmpRoot } from '../helpers/tmp-roots.mjs';
import { readProgressFacts } from '../../scripts/progress-facts.mjs';

const repoRoot = process.cwd();
const guard = path.join(repoRoot, 'scripts', 'guard-progress.mjs');

/**
 * يبني نسخةً مؤقّتةً بأقلِّ ما يحتاجه الحارس، ويُطبِّق تعديلاً عليها.
 *
 * @param {{
 *   panelM10Done?: string,
 *   percent?: number,
 *   lastEntry?: string,
 *   section21?: number,
 * }} patch
 * @returns {string} مسارُ الجذرِ المؤقَّت.
 */
function makeRoot(patch) {
  const root = registerTmpRoot(mkdtempSync(path.join(os.tmpdir(), 'progress-guard-')));
  mkdirSync(path.join(root, 'docs', 'roadmap'), { recursive: true });
  // نسخ ملفّي الخارطة وخطّ الأساس الفعليّين كي يُقاس على الواقع لا على مختبرٍ مُختزل.
  const roadmap = readFileSync(path.join(repoRoot, 'docs/roadmap/03-roadmap-to-100.md'), 'utf8');
  const baseline = readFileSync(path.join(repoRoot, 'docs/roadmap/02-baseline-audit.md'), 'utf8');
  let roadmapPatched = roadmap;
  if (patch.panelM10Done !== undefined) {
    // لوحةُ المسار M10: استبدال «9/9» بـ«patch.panelM10Done/9».
    roadmapPatched = roadmapPatched.replace(/\| M10 \|[^|]*\|[^|]*\|[^|]*\| 9\/9 \|/u, (row) =>
      row.replace('9/9', `${patch.panelM10Done}/9`),
    );
  }
  writeFileSync(path.join(root, 'docs', 'roadmap', '03-roadmap-to-100.md'), roadmapPatched);

  let baselinePatched = baseline;
  if (patch.section21 !== undefined) {
    // العبارةُ نفسُها التي يقرأها الحارس في `R4` — بلا تشكيلٍ وبمسافةٍ محتملةٍ بعدَ «≈».
    const before = baselinePatched;
    baselinePatched = baselinePatched.replace(
      /النسبة المعتمدة الآن\s*:\s*≈?\s*\d+/u,
      `النسبة المعتمدة الآن: ≈ ${patch.section21}`,
    );
    // لو لم يُطبَّق التعديلُ فالاختبارُ سيقيسُ نسخةً سليمةً ويكذبُ نجاحُه — فيُغلَق هنا.
    assert.notEqual(
      baselinePatched,
      before,
      'تعديلُ §2.1 لم يُطبَّق: عبارةُ «النسبة المعتمدة الآن» غيرُ موجودةٍ.',
    );
  }
  writeFileSync(path.join(root, 'docs', 'roadmap', '02-baseline-audit.md'), baselinePatched);

  const state = JSON.parse(readFileSync(path.join(repoRoot, 'version.json'), 'utf8'));
  if (patch.percent !== undefined) state.completion.percent = patch.percent;
  if (patch.lastEntry !== undefined) state.completion.last_entry = patch.lastEntry;
  writeFileSync(path.join(root, 'version.json'), JSON.stringify(state));
  return root;
}

/**
 * يُرجع نسبةً تُخالف المحسوبةَ حتماً — لا رقماً محفوراً قد يصيرُ صحيحاً لاحقاً.
 *
 * @returns {number}
 */
function driftedPercent() {
  const facts = readProgressFacts({ root: repoRoot });
  return facts.percentRounded >= 100 ? facts.percentRounded - 1 : facts.percentRounded + 1;
}

/**
 * يُشغِّل الحاجزَ على جذرٍ معيَّنٍ ويُرجع خروجَه ومخرَجَه.
 *
 * @param {string} root
 * @returns {{ status: number, output: string }}
 */
function runGuard(root) {
  const result = spawnSync(process.execPath, [guard, '--root', root], {
    encoding: 'utf8',
  });
  return {
    status: result.status ?? -1,
    output: `${result.stdout ?? ''}${result.stderr ?? ''}`,
  };
}

test('الحاجز مفتوح على المستودع كما هو — العدّادُ والنسبةُ واللوحةُ والـlast_entry متّسقةٌ', () => {
  const result = runGuard(repoRoot);
  assert.equal(result.status, 0, result.output);
  assert.match(result.output, /النتيجةُ: ممتازةٌ/u);
});

test('انحرافُ اللوحةِ (M10 9/9 → 8/9) يُغلق الحاجزَ — العيبُ المحمولُ يُخالف المادةَ 8', () => {
  const root = makeRoot({ panelM10Done: '8' });
  try {
    const result = runGuard(root);
    assert.equal(result.status, 1);
    assert.match(result.output, /R1/u);
    assert.match(result.output, /اللوحة/u);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('انحرافُ النسبةِ في version.json يُغلق الحاجزَ — القيمةُ المقدَّرةُ تقديراً تُرفض', () => {
  // الانحرافُ **يُشتَقُّ من القيمةِ المحسوبةِ** لا من رقمٍ محفورٍ: رقمٌ محفورٌ يصيرُ يوماً
  // هو القيمةَ الصحيحةَ فيمرُّ الاختبارُ بلا عيبٍ مصنوعٍ — وهو ما حدثَ في `WL-067`.
  const root = makeRoot({ percent: driftedPercent() });
  try {
    const result = runGuard(root);
    assert.equal(result.status, 1);
    assert.match(result.output, /R2/u);
    assert.match(result.output, /version\.json\.completion\.percent/u);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('last_entry معلَّقٌ (WL-999 غيرُ موجودٍ في §2.9.1) يُغلق الحاجزَ — الخيطُ المحمولُ لا سندَ له', () => {
  const root = makeRoot({ lastEntry: 'WL-999' });
  try {
    const result = runGuard(root);
    assert.equal(result.status, 1);
    assert.match(result.output, /R3/u);
    assert.match(result.output, /WL-999/u);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('انحرافُ §2.1 «النسبة المعتمدة الآن» يُغلق الحاجزَ — R4 مقيسٌ لا مقروءٌ', () => {
  const root = makeRoot({ section21: driftedPercent() });
  try {
    const result = runGuard(root);
    assert.equal(result.status, 1);
    assert.match(result.output, /R4/u);
    assert.match(result.output, /النسبة المعتمدة الآن/u);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
