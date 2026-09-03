#!/usr/bin/env node
// وحدةُ حقائقِ التقدُّمِ — أُضيفت في `WL-063` لإغلاقِ دَينِ المادةِ 8.
//
// **العيبُ الذي تُغلقه:** عدّادُ الخطواتِ والنسبةُ كانا يُحدَّثانِ يدوّاً في
// أربعةِ مواضعَ (لوحةُ التقدُّمِ و`§2.9.1` و`version.json` و`PROJECT_STATUS.md`)
// فانحرفا ستَّ مرّاتٍ (`WL-005` و`WL-030` و`WL-039` و`WL-052` و`WL-054`
// و`WL-061`)؛ والنسبةُ الموثَّقةُ كانت مُشتقَّةً من ثابتٍ محمولٍ (`87.04`) لا
// من عدّادِ الخطواتِ، فخالفتِ المادةَ 8 («تُحسَبُ آلياً من عدّادِ الخطواتِ...
// ولا تُقدَّرُ تقديراً»).
//
// هذه الوحدةُ **قارئٌ نقيٌّ** لا يكتبُ ولا يُغيِّرُ: تقرأُ جداولَ خطواتِ
// الخارطةِ وجدولَ خطِّ الأساسِ، وتُطبِّقُ الصيغةَ المعمَّمةَ **نصّاً كما هو
// مكتوبةٌ**، فيَخرُجُ العدّادُ والنسبةُ من المصدرِ الواحدِ لا من أربعةٍ.
// والحاجزُ `guard-progress.mjs` يَنصُّ على اتّساقِ المواضعِ الأربعةِ معها.

import { readFileSync } from 'node:fs';
import path from 'node:path';

/** العلاماتُ التي تُعدُّ «منجزةً» في عمودِ الحالةِ من جدولِ الخطواتِ. */
const DONE_MARKER = '✅';
/**
 * العلاماتُ التي تُعدُّ «غيرَ منجزةٍ»: تَدخُلُ في المقامِ (إجماليِّ الخطوات)
 * لا في البسطِ (المنجز). `⛔` محجوبٌ للمالكِ، و`⬜` لم يُبدَأ، و`🟨` قيدُ
 * التنفيذِ، و`🟩`/`⏳`/`🔘` حالاتٌ أخرى لا تُعدُّ منجزةً.
 */

/** ترتيبُ المساراتِ كما في الخارطةِ (M0 → M11). */
const MILESTONE_ORDER = ['M0', 'M1', 'M2', 'M3', 'M4', 'M5', 'M6', 'M7', 'M8', 'M9', 'M10', 'M11'];

/**
 * يقرأُ ملفَّ نصٍّ من جذرِ المستودعِ، ويرمي خطأً مُسمّىً إن تعذّر.
 *
 * @param {string} repoRoot جذرُ المستودعِ.
 * @param {string} relativePath مسارٌ نسبيٌّ من الجذرِ.
 * @returns {string} محتوى الملفِّ.
 */
function readText(repoRoot, relativePath) {
  const absolute = path.join(repoRoot, relativePath);
  try {
    return readFileSync(absolute, 'utf8');
  } catch (error) {
    throw new Error(
      `${relativePath} لا يُقرأ: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
}

/**
 * يُحلِّلُ جداولَ خطواتِ `03-roadmap-to-100.md` ويَعُدُّ المنجزَ والإجماليَّ
 * لكلِّ مسارٍ. **المصدرُ الواحدُ للحقيقةِ** لِعدّادِ الخطواتِ: ما يُكتَبُ في
 * عمودِ الحالةِ بيدِ المنفِّذِ هو ما يُحسَبُ، فلا يُنقَلُ رقمٌ ولا يُقدَّرُ.
 *
 * @param {string} roadTxt نصُّ الخارطةِ.
 * @returns {Record<string, { done: number, total: number }>} عدّادٌ لكلِّ مسارٍ.
 */
function parseStepCounts(roadTxt) {
  /** @type {Record<string, { done: number, total: number }>} */
  const counts = {};
  for (const mile of MILESTONE_ORDER) counts[mile] = { done: 0, total: 0 };
  // صفٌّ مثلُ: | M10.01 | وصف | فئة | معيار القبول | ✅ |
  const rowRe = /^\|\s*(M\d{1,2}\.\d{2})\s*\|.*\|\s*([^|]*?)\s*\|\s*$/;
  for (const line of roadTxt.split('\n')) {
    const m = line.match(rowRe);
    if (!m) continue;
    const id = m[1] ?? '';
    const mile = id.split('.')[0] ?? '';
    if (!counts[mile]) continue; // مسارٌ خارجُ M0–M11 (لا يُنتظَر)
    const status = (m[2] ?? '').trim();
    counts[mile].total += 1;
    if (status === DONE_MARKER) counts[mile].done += 1;
  }
  return counts;
}

/**
 * يُحلِّلُ جدولَ خطِّ الأساسِ `§2.9` في `02-baseline-audit.md` ويَستخرجُ الوزنَ
 * ومساهمةَ خطِّ الأساسِ لكلِّ مسارٍ. الجدولُ **محفورٌ تاريخيّاً «لا يُعدَّل»**
 * — تقرؤُه هذه الوحدةُ نصّاً ولا تُغيِّرُه.
 *
 * @param {string} baselineTxt نصُّ وثيقةِ التدقيقِ.
 * @returns {Record<string, { weight: number, baselineContrib: number }>} وزنٌ ومساهمةٌ لكلِّ مسارٍ.
 */
function parseBaselineTable(baselineTxt) {
  /** @type {Record<string, { weight: number, baselineContrib: number }>} */
  const table = {};
  // صفٌّ مثلُ: | M0 البنية الهندسية | 5% | 5% | 0.25% |
  // العمودُ الثاني = الوزنُ، والرابعُ = مساهمةُ خطِّ الأساسِ.
  const rowRe =
    /^\|\s*(M\d{1,2})\s+[^|]+\|\s*(\d+(?:\.\d+)?)%\s*\|\s*\d+(?:\.\d+)?%\s*\|\s*(\d+(?:\.\d+)?)%\s*\|\s*$/;
  for (const line of baselineTxt.split('\n')) {
    const m = line.match(rowRe);
    if (!m) continue;
    const id = m[1] ?? '';
    if (!id) continue;
    table[id] = {
      weight: Number.parseFloat(m[2] ?? '0'),
      baselineContrib: Number.parseFloat(m[3] ?? '0'),
    };
  }
  return table;
}

/**
 * الصيغةُ المعمَّمةُ كما هي مكتوبةٌ في `§2.9`:
 * `مساهمةُ المسارِ = مساهمتُه في خطِّ الأساسِ + (وزنُه − مساهمتُه) × (المنجزَ ÷ إجماليَّه)`.
 * لا تَعدِيلَ ولا تخفيفَ: تُطبَّقُ نصّاً.
 *
 * @param {number} weight وزنُ المسارِ.
 * @param {number} baselineContrib مساهمتُه في خطِّ الأساسِ.
 * @param {number} done الخطواتُ المنجزةُ.
 * @param {number} total إجماليُّ الخطواتِ.
 * @returns {number} مساهمةُ المسارِ في النسبةِ.
 */
function milestoneContribution(weight, baselineContrib, done, total) {
  if (total <= 0) return baselineContrib;
  const fraction = done / total;
  return baselineContrib + (weight - baselineContrib) * fraction;
}

/**
 * يقرأُ حقائقَ التقدُّمِ من المصدرَينِ المعلَنَينِ ويُطبِّقُ الصيغةَ المعمَّمةَ.
 *
 * @param {object} opts خياراتُ القراءةِ.
 * @param {string} [opts.root] جذرُ المستودعِ (افتراضيّاً `process.cwd()`).
 * @returns {{
 *   milestones: Array<{ id: string, weight: number, baselineContrib: number, done: number, total: number, contribution: number }>,
 *   stepCounter: { done: number, total: number },
 *   percent: number,
 *   percentRounded: number,
 *   sources: { roadmap: string, baseline: string },
 * }} العدّادُ والنسبةُ المحسوبانِ من المصدرِ الواحدِ.
 */
export function readProgressFacts(opts = {}) {
  const root = opts.root ?? process.cwd();
  const roadmapPath = 'docs/roadmap/03-roadmap-to-100.md';
  const baselinePath = 'docs/roadmap/02-baseline-audit.md';

  const roadTxt = readText(root, roadmapPath);
  const baselineTxt = readText(root, baselinePath);

  const counts = parseStepCounts(roadTxt);
  const baseline = parseBaselineTable(baselineTxt);

  /** @type {Array<{ id: string, weight: number, baselineContrib: number, done: number, total: number, contribution: number }>} */
  const milestones = [];
  let totalDone = 0;
  let totalAll = 0;
  let percent = 0;

  for (const id of MILESTONE_ORDER) {
    const b = baseline[id];
    const c = counts[id] ?? { done: 0, total: 0 };
    const weight = b ? b.weight : 0;
    const baselineContrib = b ? b.baselineContrib : 0;
    const contribution = milestoneContribution(weight, baselineContrib, c.done, c.total);
    milestones.push({
      id,
      weight,
      baselineContrib,
      done: c.done,
      total: c.total,
      contribution: Number(contribution.toFixed(6)),
    });
    totalDone += c.done;
    totalAll += c.total;
    percent += contribution;
  }

  return {
    milestones,
    stepCounter: { done: totalDone, total: totalAll },
    percent: Number(percent.toFixed(6)),
    percentRounded: Math.round(percent),
    sources: { roadmap: roadmapPath, baseline: baselinePath },
  };
}

// عندَ التشغيلِ المباشرِ (`node scripts/progress-facts.mjs`) يُطبَعُ الملخّصُ.
if (import.meta.url === `file://${process.argv[1]}`) {
  const facts = readProgressFacts();
  for (const m of facts.milestones) {
    console.log(
      `${m.id}: ${m.done}/${m.total}  وزن=${m.weight}%  مساهمة=${m.contribution.toFixed(4)}%`,
    );
  }
  console.log(
    `العدّاد: ${facts.stepCounter.done}/${facts.stepCounter.total}  النسبة=${facts.percent}% (≈${facts.percentRounded}%)`,
  );
}
