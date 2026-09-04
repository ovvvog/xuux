#!/usr/bin/env node
// guard:progress — **البوابةُ الثالثةُ والأربعون** — أُضيفت في `WL-063`.
//
// **العطلُ التي تُغلقُه:** تنزّلا **ستَّ مرّاتٍ** في العدّادِ والنسبةِ (`WL-005`
// و`WL-030` و`WL-039` و`WL-052` و`WL-054` و`WL-061`) جرى فيها تحديثُ الرقمَينِ
// يدوّاً في أربعةِ مواضعَ فانحرفا عن عدّادِ الخطواتِ؛ والنسبةُ كانت مُشتقَّةً من
// ثابتٍ محمولٍ لا من الصيغةِ، فخالفتِ المادةَ 8.
//
// الحارسُ **يَنصُّ** على أربعِ قواعدَ، والحكمُ كلُّه **من عدّادِ الخطواتِ** عبرَ
// وحدةِ `progress-facts.mjs` (المصدرِ الواحدِ) لا من رقمٍ محمول:
//   - R0: قراءةُ المصدرَينِ (الخارطةُ + خطُّ الأساسِ) سليمةٌ، وكلُّ مسارٍ موجودٌ.
//   - R1: لوحةُ التقدُّمِ تطابقُ العدّادَ المحسوبَ مساراً مساراً وإجماليّاً.
//   - R2: `version.json.completion.percent` يُطابقُ النسبةَ المحسوبةَ (عددٌ صحيحٌ).
//   - R3: `completion.last_entry` صفٌّ قائمٌ فعلاً في جدولِ `§2.9.1`.
// لا تَعدِيلَ ولا تَخفيفَ: الخروجُ بـ`1` عندَ أيِّ خَرقٍ.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { readProgressFacts } from './progress-facts.mjs';

const rootIndex = process.argv.indexOf('--root');
const root = rootIndex === -1 ? process.cwd() : (process.argv[rootIndex + 1] ?? process.cwd());

const ROADMAP_PATH = path.join(root, 'docs/roadmap/03-roadmap-to-100.md');
const BASELINE_PATH = path.join(root, 'docs/roadmap/02-baseline-audit.md');
const VERSION_PATH = path.join(root, 'version.json');

/** @type {string[]} الخروقاتُ المجمَّعةُ. */
const violations = [];

/**
 * @param {string} absolutePath
 * @returns {string}
 */
function readText(absolutePath) {
  try {
    return readFileSync(absolutePath, 'utf8');
  } catch (error) {
    throw new Error(
      `${path.relative(root, absolutePath)} لا يُقرأ: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
}

// ── المصدرُ الواحدُ: العدّادُ والنسبةُ من جداولِ الخطواتِ + خطِّ الأساسِ ──
const facts = readProgressFacts({ root });

// ── R0: كلُّ مسارٍ موجودٌ في الخارطةِ وفي خطِّ الأساسِ ──
for (const m of facts.milestones) {
  if (m.weight === 0 && m.baselineContrib === 0) {
    violations.push(
      `R0/MISSING_BASELINE: المسارُ ${m.id} مفقودٌ من جدولِ §2.9 في ${path.relative(root, BASELINE_PATH)}؛ لا يُحسَبُ بدونِ وزنٍ ومساهمةِ خطِّ أساسٍ.`,
    );
  }
}

// ── R1: لوحةُ التقدُّمِ تطابقُ العدّادَ المحسوبَ ──
const roadTxt = readText(ROADMAP_PATH);
const panelRe = /^\|\s*(M\d{1,2})\s*\|[^|]+\|[^|]+\|\s*[^|]*\|\s*(\d+)\s*\/\s*(\d+)\s*\|\s*$/;
/** @type {Map<string, {done:number,total:number}>} */
const panelByMilestone = new Map();
for (const line of roadTxt.split('\n')) {
  const m = line.match(panelRe);
  if (!m) continue;
  panelByMilestone.set(m[1] ?? '', {
    done: Number(m[2]),
    total: Number(m[3]),
  });
}
const totalRowRe = /\*\*(\d+)\s*\/\s*(\d+)\*\*/;
/** @type {{ done: number, total: number } | null} */
let panelTotal = null;
for (const line of roadTxt.split('\n')) {
  if (line.includes('الإجمالي')) {
    const m = line.match(totalRowRe);
    if (m) panelTotal = { done: Number(m[1]), total: Number(m[2]) };
  }
}

for (const m of facts.milestones) {
  const panel = panelByMilestone.get(m.id);
  if (!panel) {
    violations.push(
      `R1/MISSING_PANEL_ROW: المسارُ ${m.id} ليس له صفٌّ في لوحةِ التقدُّمِ (${path.relative(root, ROADMAP_PATH)}).`,
    );
    continue;
  }
  if (panel.done !== m.done || panel.total !== m.total) {
    violations.push(
      `R1/PANEL_DRIFT: المسارُ ${m.id} في اللوحةِ يقولُ ${panel.done}/${panel.total} بينما العدّادُ المحسوبُ يقولُ ${m.done}/${m.total}.`,
    );
  }
}

if (panelTotal) {
  if (panelTotal.done !== facts.stepCounter.done || panelTotal.total !== facts.stepCounter.total) {
    violations.push(
      `R1/TOTAL_DRIFT: إجماليُّ اللوحةِ يقولُ ${panelTotal.done}/${panelTotal.total} بينما العدّادُ المحسوبُ يقولُ ${facts.stepCounter.done}/${facts.stepCounter.total}.`,
    );
  }
} else {
  violations.push('R1/MISSING_TOTAL_ROW: صفُّ الإجماليِّ مفقودٌ من لوحةِ التقدُّمِ.');
}

// ── R2: version.json.completion.percent يُطابقُ النسبةَ المحسوبةَ ──
const versionTxt = readText(VERSION_PATH);
/** @type {{ completion?: { percent?: number, last_entry?: string } }} */
let versionJson;
try {
  versionJson = JSON.parse(versionTxt);
} catch (error) {
  violations.push(
    `R2/INVALID_JSON: version.json غيرُ صالحٍ JSON: ${error instanceof Error ? error.message : String(error)}`,
  );
  versionJson = {};
}

const declaredPercent = versionJson?.completion?.percent;
if (typeof declaredPercent !== 'number') {
  violations.push('R2/MISSING_PERCENT: version.json.completion.percent ليس عدداً صحيحاً.');
} else if (declaredPercent !== facts.percentRounded) {
  violations.push(
    `R2/PERCENT_DRIFT: version.json.completion.percent = ${declaredPercent} بينما النسبةُ المحسوبةُ من عدّادِ الخطواتِ = ${facts.percentRounded} (${facts.percent}%).`,
  );
}

// ── R3: completion.last_entry صفٌّ قائمٌ في §2.9.1 ──
const lastEntry = versionJson?.completion?.last_entry;
const baselineTxt = readText(BASELINE_PATH);
const s291Section = extractSection291(baselineTxt);
const wlIds = new Set();
const wlRe = /`(WL-\d{3})`/g;
let match;
while ((match = wlRe.exec(s291Section)) !== null) wlIds.add(match[1]);

if (!lastEntry) {
  violations.push('R3/MISSING_LAST_ENTRY: version.json.completion.last_entry فارغٌ.');
} else if (!wlIds.has(lastEntry)) {
  violations.push(
    `R3/DANGLING_LAST_ENTRY: version.json.completion.last_entry = ${lastEntry} ليس له صفٌّ في §2.9.1 (الصفوفُ القائمةُ: ${[...wlIds].sort().join(', ') || 'لا أحد'}).`,
  );
}

// ── R4: «النسبة المعتمدة الآن» في §2.1 تطابقُ النسبةَ المحسوبةَ ──
// هذا هو المصدرُ الرابعُ الذي كان ينحرفُ يدوّاً (قال «≈94%» بينما version.json قال 95%).
const adoptedNowRe = /النسبة المعتمدة الآن\s*:\s*≈?\s*(\d+)/;
const adoptedNowMatch = baselineTxt.match(adoptedNowRe);
if (!adoptedNowMatch) {
  violations.push('R4/MISSING_ADOPTED_NOW: عبارة «النسبة المعتمدة الآن» غير موجودةٍ في §2.1.');
} else {
  const adoptedNow = Number(adoptedNowMatch[1]);
  if (adoptedNow !== facts.percentRounded) {
    violations.push(
      `R4/ADOPTED_NOW_DRIFT: «النسبة المعتمدة الآن» في §2.1 تقولُ ≈${adoptedNow}% بينما النسبةُ المحسوبةُ = ${facts.percentRounded} (${facts.percent}%).`,
    );
  }
}

// ── الحكمُ ──
const report = `guard:progress — البوابةُ 43
المصدرُ الواحدُ: ${path.relative(root, facts.sources.roadmap)} + ${path.relative(root, facts.sources.baseline)}
العدّادُ المحسوبُ: ${facts.stepCounter.done}/${facts.stepCounter.total}
النسبةُ المحسوبةُ: ${facts.percent}% (≈${facts.percentRounded}%)
version.json.completion.percent = ${declaredPercent ?? '(مفقود)'}
version.json.completion.last_entry = ${lastEntry ?? '(مفقود)'}
§2.1 «النسبة المعتمدة الآن» = ${adoptedNowMatch ? '≈' + adoptedNowMatch[1] + '%' : '(مفقود)'}`;

if (violations.length === 0) {
  console.log(report);
  console.log('النتيجةُ: ممتازةٌ — العدّادُ والنسبةُ واللوحةُ والـlast_entry متّسقةٌ.');
} else {
  console.error(report);
  console.error(`النتيجةُ: رُفضت (${violations.length} خرقٌ).`);
  for (const v of violations) console.error(`  - ${v}`);
  process.exit(1);
}

/**
 * يستخرجُ نصَّ قسمِ `§2.9.1` من وثيقةِ التدقيقِ (من عنوانِ القسمِ إلى عنوانِ
 * القسمِ التالي). القسمُ هو الجدولُ الذي تُسجَّلُ فيه تحديثاتُ النسبةِ بالمعرّفِ
 * `WL-xxx`.
 *
 * @param {string} txt نصُّ الوثيقةِ.
 * @returns {string} نصُّ القسمِ.
 */
function extractSection291(txt) {
  // ابحث عن عنوانِ القسمِ نفسِه (سطرٌ يبدأُ بـ`###` أو `##` ثمّ `2.9.1`)،
  // لا أوّلِ ظهورٍ لنصِّ «2.9.1» — فقد يَظهرُ هذا النصُّ في سردٍ نثريٍّ قبلَ العنوانِ،
  // فيُؤخذُ السردُ عنواناً خطأً ويُقتطعُ الجدولُ قبلَ أوّلِ صفٍّ فعليٍّ.
  const headerRe = /(^|\n)(#{2,3})\s*2\.9\.1[^\n]*\n/;
  const headerMatch = txt.match(headerRe);
  if (!headerMatch) return '';
  const start = (headerMatch.index ?? 0) + headerMatch[0].length;
  // القسمُ التالي يبدأ بـ `## ` (عنوانُ مستوى ثانٍ) بعدَ عنوانِ `§2.9.1`.
  const afterStart = txt.indexOf('\n## ', start);
  return afterStart < 0 ? txt.slice(start) : txt.slice(start, afterStart);
}
