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
//
// دُمِجَ هنا (‏WL-543، حدُّ G1): ما كان tests/tooling/version-guard.test.mjs —
// اختبار حاجز تطابق الإصدار — أُضيف في `WL-046`.
//
// **العيبُ الذي يُغلقه:** كان التحقُّقُ من تطابقِ `package.json` و`version.json`
// خطوةً مكتوبةً داخلَ `ci.yml` وحدَه، فلم يكن ما يُقاس محلّياً هو ما يُقاس في
// المسار: خرجت `npm run validate` صفراً وأخفق الطلبُ `#3` على تلك الخطوةِ
// بالذات. فصار الفحصُ حاجزاً مُسمّىً في سلسلةِ `validate` يُنادى في `ci.yml`
// بنصِّه نفسِه.
//
// **قرارٌ مقصود:** الاختبارُ **يُشغِّل الحاجزَ فعلاً** على نسخةٍ مؤقّتةٍ فيها
// عيبٌ مصنوع، ويقيس خروجَه لا نصَّه: حاجزٌ يُقاس بقراءةِ سطوره قد يكون كلَّه
// طباعةً بلا حكم.
//
// **حدودٌ معلَنة:** يُقاس التطابقُ ووجودُ المُدخلةِ لا صحّةُ الترقيمِ الدلاليّ —
// أن الرفعَ يوافق قواعدَ `versioning` حكمٌ لا يُقاس نصّاً ويبقى شرطَ مُدخلةٍ في
// سجلِّ الأعمال بالمادة 1. والنسخةُ المؤقّتةُ تُنسخ بملفّاتٍ معدودةٍ لا بالشجرة
// كلِّها كي لا يصير الاختبارُ ثقيلاً.
//
// WL-546: دُمِجَ هنا tests/tooling/guard-work-log-ids.test.mjs (‏G1: حاجزا حالةِ المشروعِ وسجلِّ الأعمال)
// اختباراتُ حاجزِ اتّصالِ ترقيمِ سجلِّ الأعمالِ — `WL-178` (إغلاقُ `DOC-8`).
//
// **ما تقيسه:** أنّ الحاجزَ يرفعُ العيبَ الذي أُنشئَ لأجلِه (‏فجوةٌ من حذفٍ سهوٍ،
// وتكرارٌ من لصقٍ مزدوجٍ)، **وأنّه لا يُسكَتُ بعُذرٍ فقدَ محلَّه** (‏القاعدةُ `R4`).

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { registerTmpRoot } from '../helpers/tmp-roots.mjs';
import { readProgressFacts } from '../../scripts/progress-facts.mjs';
import { auditWorkLogIds, collectHeadings } from '../../scripts/guard-work-log-ids.mjs';

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

// ── دُمِجَ هنا (‏WL-543، حدُّ G1): ما كان tests/tooling/version-guard.test.mjs — (‏كتلةٌ مستقلّةُ النطاق: أسماءٌ مشتركة) ──
{
  const repoRoot = process.cwd();
  const guard = path.join(repoRoot, 'scripts', 'guard-version.mjs');

  /**
   * يبني نسخةً مؤقّتةً بأقلِّ ما يحتاجه الحاجز، ويُطبِّق تعديلاً عليها.
   *
   * @param {{ packageVersion?: string, stateVersion?: string, lastEntry?: string, logText?: string }} patch
   * @returns {string} مسارُ الجذرِ المؤقَّت.
   */
  function makeRoot(patch) {
    const root = registerTmpRoot(mkdtempSync(path.join(os.tmpdir(), 'version-guard-')));
    const pkg = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
    const state = JSON.parse(readFileSync(path.join(repoRoot, 'version.json'), 'utf8'));
    if (patch.packageVersion !== undefined) pkg.version = patch.packageVersion;
    if (patch.stateVersion !== undefined) state.version = patch.stateVersion;
    if (patch.lastEntry !== undefined) state.completion.last_entry = patch.lastEntry;
    writeFileSync(path.join(root, 'package.json'), JSON.stringify(pkg));
    writeFileSync(path.join(root, 'version.json'), JSON.stringify(state));
    mkdirSync(path.join(root, 'docs', 'roadmap'), { recursive: true });
    writeFileSync(
      path.join(root, 'docs', 'roadmap', '05-work-log.md'),
      patch.logText ?? readFileSync(path.join(repoRoot, 'docs/roadmap/05-work-log.md'), 'utf8'),
    );
    return root;
  }

  /**
   * يُشغِّل الحاجزَ على جذرٍ معيَّنٍ ويُرجع خروجَه ومخرَجَه.
   *
   * @param {string} root
   * @returns {{ status: number, output: string }}
   */
  function runGuard(root) {
    const result = spawnSync(process.execPath, [guard, '--root', root], { encoding: 'utf8' });
    return {
      status: result.status ?? -1,
      output: `${result.stdout ?? ''}${result.stderr ?? ''}`,
    };
  }

  test('الحاجز مفتوح على المستودع كما هو — نسخةٌ واحدةٌ ومُدخلةٌ قائمة', () => {
    const result = runGuard(repoRoot);
    assert.equal(result.status, 0, result.output);
    assert.match(result.output, /✅/u);
  });

  test('نسختان مختلفتان تُغلقان الحاجز — وهو العيبُ الذي أخفق به الطلب #3 فعلاً', () => {
    const root = makeRoot({ packageVersion: '0.40.0', stateVersion: '0.41.0' });
    try {
      const result = runGuard(root);
      assert.equal(result.status, 1);
      assert.match(result.output, /R3/u);
      assert.match(result.output, /0\.40\.0/u);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('مُدخلةُ سجلٍّ مُعلَنةٌ ولا وجودَ لها تُغلق الحاجز (المادة 1)', () => {
    const root = makeRoot({ lastEntry: 'WL-999', logText: '# سجل بلا تلك المُدخلة\n' });
    try {
      const result = runGuard(root);
      assert.equal(result.status, 1);
      assert.match(result.output, /R4/u);
      assert.match(result.output, /WL-999/u);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('إصدارٌ ليس على صيغةِ semver يُغلق الحاجز', () => {
    const root = makeRoot({ packageVersion: '0.41', stateVersion: '0.41' });
    try {
      const result = runGuard(root);
      assert.equal(result.status, 1);
      assert.match(result.output, /R2/u);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
}

// ── WL-546: دُمِجَ هنا tests/tooling/guard-work-log-ids.test.mjs (‏G1: حاجزا حالةِ المشروعِ وسجلِّ الأعمال) (‏كتلةٌ مستقلّةُ النطاق: أسماءٌ مشتركة) ──
{
  /**
   * @param {number} n رقمُ المُدخلةِ.
   * @param {string} extra زيادةٌ على العنوانِ.
   * @returns {string} عنوانُ مُدخلةٍ بقالبٍ صحيحٍ.
   */
  const HEAD = (n, extra = '') =>
    `### [2026-09-15] — WL-${String(n).padStart(3, '0')} — موضوعٌ${extra}\n\n- **المنفّذ:** فلانٌ\n\n---\n`;

  /**
   * @param {number[]} numbers أرقامُ المُدخلاتِ بالترتيبِ.
   * @returns {string} سجلٌّ مُصطنَعٌ للاختبارِ.
   */
  const logOf = (numbers) => numbers.map((n) => HEAD(n)).join('\n');

  const EMPTY_CONFIG = 'allowed_gaps: []\nallowed_duplicates: []\n';

  test('R1: العنوانُ الذي لا يحملُ معرِّفاً في صدرِه ولا في ذيلِه يُرفَضُ', () => {
    const logText = `### [2026-09-15] — بلا معرِّفٍ\n\n---\n${HEAD(1)}`;
    const { failures } = auditWorkLogIds({ logText, configText: EMPTY_CONFIG });
    assert.ok(failures.some((message) => message.startsWith('R1:')));
  });

  test('R1: الشكلُ القديمُ — المعرِّفُ في ذيلِ العنوانِ — مقبولٌ ويُحسَبُ', () => {
    const logText = '### [2026-09-11] — موضوعٌ قديمٌ (WL-001)\n\n---\n';
    const headings = collectHeadings(logText);
    assert.equal(headings.length, 1);
    assert.equal(headings[0]?.id, 1);
    const { failures } = auditWorkLogIds({ logText, configText: EMPTY_CONFIG });
    assert.deepEqual(failures, []);
  });

  test('R1: معرِّفٌ مذكورٌ في عنوانِ تصحيحٍ لا يُملَكُ — الأوّلُ وحدَه هو المُدخلةُ', () => {
    const logText = `### [2026-09-15] — WL-002 — تصحيحُ حقلِ الكوميتِ في \`WL-001\`\n\n---\n${HEAD(1)}`;
    const { failures, unique } = auditWorkLogIds({ logText, configText: EMPTY_CONFIG });
    assert.deepEqual(failures, []);
    assert.equal(unique, 2);
  });

  test('R2: تكرارٌ غيرُ مُعلَنٍ يُرفَضُ — وهو صنفُ عيبِ اللصقِ المزدوجِ', () => {
    const logText = logOf([3, 2, 2, 1]);
    const { failures } = auditWorkLogIds({ logText, configText: EMPTY_CONFIG });
    assert.ok(failures.some((message) => message.startsWith('R2:')));
  });

  test('R2: تكرارٌ مُعلَنٌ بعددِه يُقبَلُ', () => {
    const logText = logOf([3, 2, 2, 1]);
    const configText =
      'allowed_gaps: []\nallowed_duplicates:\n  - id: WL-002\n    count: 2\n    reason: مُدخلةٌ وتصحيحُها\n';
    const { failures } = auditWorkLogIds({ logText, configText });
    assert.deepEqual(failures, []);
  });

  test('R3: فجوةٌ غيرُ مُعلَنةٍ تُرفَضُ — وهي صنفُ عيبِ الحذفِ السهوِ', () => {
    const logText = logOf([4, 2, 1]);
    const { failures } = auditWorkLogIds({ logText, configText: EMPTY_CONFIG });
    assert.ok(failures.some((message) => message.startsWith('R3:') && message.includes('WL-003')));
  });

  test('R3: فجوةٌ مُعلَنةٌ بسببٍ مكتوبٍ تُقبَلُ', () => {
    const logText = logOf([4, 2, 1]);
    const configText =
      'allowed_gaps:\n  - id: WL-003\n    reason: استُهلِكَ في رسالةِ كوميتٍ ووُثِّقَ جماعةً\nallowed_duplicates: []\n';
    const { failures } = auditWorkLogIds({ logText, configText });
    assert.deepEqual(failures, []);
  });

  test('R4: استثناءُ فجوةٍ صارَ له عنوانٌ يُرفَضُ — لا مقبرةَ أعذارٍ', () => {
    const logText = logOf([3, 2, 1]);
    const configText =
      'allowed_gaps:\n  - id: WL-003\n    reason: سببٌ قديمٌ لم يبقَ له محلٌّ\nallowed_duplicates: []\n';
    const { failures } = auditWorkLogIds({ logText, configText });
    assert.ok(failures.some((message) => message.startsWith('R4:')));
  });

  test('R4: تكرارٌ مُعلَنٌ بعددٍ يخالفُ المقيسَ يُرفَضُ', () => {
    const logText = logOf([3, 2, 1]);
    const configText =
      'allowed_gaps: []\nallowed_duplicates:\n  - id: WL-002\n    count: 2\n    reason: سببٌ\n';
    const { failures } = auditWorkLogIds({ logText, configText });
    assert.ok(failures.some((message) => message.startsWith('R4:')));
  });

  test('R5: استثناءٌ بلا سببٍ مكتوبٍ يُرفَضُ', () => {
    const logText = logOf([4, 2, 1]);
    const configText = 'allowed_gaps:\n  - id: WL-003\n    reason: "   "\nallowed_duplicates: []\n';
    const { failures } = auditWorkLogIds({ logText, configText });
    assert.ok(failures.some((message) => message.startsWith('R5:')));
  });

  test('R5: استثناءٌ غيرُ مشروحٍ في خريطةِ المعرِّفاتِ يُرفَضُ', () => {
    const logText = logOf([4, 2, 1]);
    const configText =
      'allowed_gaps:\n  - id: WL-003\n    reason: سببٌ مكتوبٌ\nallowed_duplicates: []\n';
    const withoutMap = auditWorkLogIds({ logText, configText, mapText: 'خريطةٌ لا تذكرُ شيئاً' });
    assert.ok(withoutMap.failures.some((message) => message.includes('WL-003')));
    const withMap = auditWorkLogIds({
      logText,
      configText,
      mapText: 'الفجوةُ `WL-003` مشروحةٌ هنا بسببِها',
    });
    assert.deepEqual(withMap.failures, []);
  });

  test('R6: الترتيبُ التنازليُّ الصحيحُ يُقبَلُ', () => {
    const logText = logOf([5, 4, 3, 2, 1]);
    const { failures } = auditWorkLogIds({ logText, configText: EMPTY_CONFIG });
    assert.deepEqual(failures, []);
  });

  test('R6: طفرةٌ — مُدخلةٌ أحدثُ بعدَ أقدمَ تُرفَضُ', () => {
    // WL-211 يَسبِقُ WL-221 — الترتيبُ مكسورٌ
    const logText = logOf([211, 221]);
    const { failures } = auditWorkLogIds({ logText, configText: EMPTY_CONFIG });
    assert.ok(failures.some((message) => message.startsWith('R6:')));
  });

  test('R6: تكرارٌ مُعلَنٌ في ترتيبٍ تنازليٍّ يُقبَلُ', () => {
    const logText = logOf([3, 2, 2, 1]);
    const configText =
      'allowed_gaps: []\nallowed_duplicates:\n  - id: WL-002\n    count: 2\n    reason: مُدخلةٌ وتصحيحُها\n';
    const { failures } = auditWorkLogIds({ logText, configText });
    assert.deepEqual(failures, []);
  });

  test('R6: تكرارٌ مُعلَنٌ لكن بترتيبٍ مكسورٍ يُرفَضُ', () => {
    // WL-002 ثم WL-003 — الترتيبُ مكسورٌ رغم أنّ التكرارَ مُعلَنٌ
    const logText = logOf([3, 2, 2, 3]);
    const configText =
      'allowed_gaps: []\nallowed_duplicates:\n  - id: WL-002\n    count: 2\n    reason: مُدخلةٌ وتصحيحُها\n';
    const { failures } = auditWorkLogIds({ logText, configText });
    assert.ok(failures.some((message) => message.startsWith('R6:')));
  });

  test('السجلُّ الحقيقيُّ في المستودعِ يمرُّ بالحاجزِ', async () => {
    const { readFile } = await import('node:fs/promises');
    const [logText, configText, mapText] = await Promise.all([
      readFile('docs/roadmap/05-work-log.md', 'utf8'),
      readFile('config/work-log-ids.yaml', 'utf8'),
      readFile('docs/audit/work-log-id-map.md', 'utf8'),
    ]);
    const { failures, total, unique } = auditWorkLogIds({ logText, configText, mapText });
    assert.deepEqual(failures, []);
    assert.ok(total >= unique);
  });
}
