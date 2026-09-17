#!/usr/bin/env node
// guard:doc-counts — **البوابةُ الثامنةُ والأربعون** — أُضيفت في `WL-196` إغلاقاً للدَّين `D-5`.
//
// **العطلُ الذي يُغلقُه:** أرقامٌ عدّاديّةٌ تُكتَبُ يداً في الوثائقِ تنحرفُ عن
// مصدرِها حينَ يتغيّرُ الكودُ ولا تُحدَّثُ الوثيقة. عدّادُ النسبةِ أُتمِتَ في
// `WL-063` بحاجزِ `guard:progress`، لكنّ بقيةَ العدّاداتِ اليدويّةِ لم تكن
// محصورة.
//
// **الحاجزُ يَفحَصُ ثلاثةَ عدّادات:**
//   - R1: عددُ الحواجزِ في `PROJECT_STATUS.md` يُطابقُ عددَ `guard:*` في `validate`.
//   - R2: عددُ ملفاتِ الاختبارِ في `docs/ROOT_OF_TRUST.md` يُطابقُ عددَ `*.test.mjs`.
//   - R3: عددُ البنودِ المفتوحةِ في `PROJECT_STATUS.md` يُطابقُ عددَ البنودِ المفتوحةِ على المنفِّذ.
//
// **حدٌّ مُعلَنٌ:** لا يَفحَصُ كلَّ رقمٍ في كلِّ وثيقة. الأرقامُ التاريخيةُ
// والإصداراتُ والمعرّفاتُ والحدودُ التصميميةُ خارجُ النطاق. وما أرقامُ
// نتائجِ التشغيلِ (نجاح/فشل/تخطّي) فلا تُحفَظُ في الوثيقة — انظر ناتجَ `npm run validate`.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { readDocCountFacts } from './lib/doc-count-facts.mjs';

const rootIndex = process.argv.indexOf('--root');
const root = rootIndex === -1 ? process.cwd() : (process.argv[rootIndex + 1] ?? process.cwd());

/** @type {string[]} */
const violations = [];

/**
 * @param {string} file
 * @returns {string}
 */
function readText(file) {
  try {
    return readFileSync(path.join(root, file), 'utf8');
  } catch {
    return '';
  }
}

/**
 * يَعدّ المعرّفاتِ في القائمةِ بعد «المفتوح...:» وأوّلِ نقطةٍ بعدَها.
 * @param {string} line
 * @returns {number}
 */
function countIdsInList(line) {
  const maftuhIdx = line.lastIndexOf('المفتوح');
  if (maftuhIdx === -1) return 0;
  const afterMaftuh = line.slice(maftuhIdx);
  const colonIdx = afterMaftuh.indexOf(':');
  if (colonIdx === -1) return 0;
  const afterColon = afterMaftuh.slice(colonIdx + 1);
  const periodIdx = afterColon.indexOf('.');
  const listBlock = periodIdx === -1 ? afterColon : afterColon.slice(0, periodIdx);
  const ids = listBlock.match(/`[A-Z0-9-]+`/g);
  return ids ? new Set(ids).size : 0;
}

const facts = readDocCountFacts(root);

// ── R1: عددُ الحواجزِ في PROJECT_STATUS.md ──
{
  const statusText = readText('PROJECT_STATUS.md');
  const match = statusText.match(/(\d+)\s*حاجزاً/);
  if (!match) {
    violations.push(`R1/MISSING: PROJECT_STATUS.md لا يَذكُر عددَ الحواجزِ بصيغةِ «N حاجزاً».`);
  } else {
    const declared = Number(match[1]);
    if (declared !== facts.guardCount) {
      violations.push(
        `R1/DRIFT: PROJECT_STATUS.md يَقولُ ${declared} حاجزاً والمصدرُ ${facts.guardCount}.`,
      );
    }
  }
}

// ── R2: عددُ ملفاتِ الاختبارِ في docs/ROOT_OF_TRUST.md ──
{
  const rotText = readText('docs/ROOT_OF_TRUST.md');
  const match = rotText.match(/(\d+)\s*ملف اختبار/);
  if (!match) {
    violations.push(
      `R2/MISSING: docs/ROOT_OF_TRUST.md لا يَذكُر عددَ ملفاتِ الاختبارِ بصيغةِ «N ملف اختبار».`,
    );
  } else {
    const declared = Number(match[1]);
    if (declared !== facts.testFileCount) {
      violations.push(
        `R2/DRIFT: docs/ROOT_OF_TRUST.md يَقولُ ${declared} ملفَ اختبارٍ والمصدرُ ${facts.testFileCount}.`,
      );
    }
  }
}

// ── R3: عددُ البنودِ المفتوحةِ في PROJECT_STATUS.md ──
// نَعدّ المعرّفاتِ المذكورةَ بعد «المفتوحُ على المنفِّذِ» في PROJECT_STATUS.md
// ونُقارنُها بعددِ البنودِ المفتوحةِ في سجلِّ الدَّين.
{
  const statusText = readText('PROJECT_STATUS.md');
  const statusLines = statusText.split('\n');
  let found = false;
  for (const line of statusLines) {
    if (
      line.includes('المفتوح') &&
      line.includes('بنود') &&
      (line.includes('`D-') ||
        line.includes('`LIM-') ||
        line.includes('`REPO-') ||
        line.includes('`LIVE-') ||
        line.includes('`R3-A-'))
    ) {
      const declared = countIdsInList(line);
      if (declared !== facts.openDebtCount) {
        violations.push(
          `R3/DRIFT: PROJECT_STATUS.md يَذكُرُ ${declared} بنودٍ والمصدرُ ${facts.openDebtCount}.`,
        );
      }
      found = true;
      break;
    }
  }
  if (!found) {
    violations.push(
      `R3/MISSING: PROJECT_STATUS.md لا يَذكُرُ البنودَ المفتوحةَ على المنفِّذِ بمعرّفاتٍ.`,
    );
  }
}

if (violations.length > 0) {
  console.error('⛔ حاجزُ عدّاداتِ الوثائق: انحرافٌ عن المصدر.');
  for (const v of violations) {
    console.error(`   - ${v}`);
  }
  process.exit(1);
}

console.log(
  `✅ حاجزُ عدّاداتِ الوثائق: ${facts.guardCount} حاجزاً، و${facts.testFileCount} ملفَ اختبارٍ، و${facts.openDebtCount} بنودٍ مفتوحة — كلُّها مطابقةٌ لمصدرِها.`,
);
