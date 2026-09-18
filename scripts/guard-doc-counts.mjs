#!/usr/bin/env node
// guard:doc-counts — **البوابةُ الثامنةُ والأربعون** — أُضيفت في `WL-196` إغلاقاً للدَّين `D-5`.
//
// **العطلُ الذي يُغلقُه:** أرقامٌ عدّاديّةٌ تُكتَبُ يداً في الوثائقِ تنحرفُ عن
// مصدرِها حينَ يتغيّرُ الكودُ ولا تُحدَّثُ الوثيقة. عدّادُ النسبةِ أُتمِتَ في
// `WL-063` بحاجزِ `guard:progress`، لكنّ بقيةَ العدّاداتِ اليدويّةِ لم تكن
// محصورة.
//
// **الحاجزُ يَفحَصُ خمسَ قواعدَ** (وكانَ ثلاثةَ عدّاداتٍ يومَ `WL-196`):
//   - R1: عددُ الحواجزِ في `PROJECT_STATUS.md` يُطابقُ عددَ `guard:*` في `validate`.
//   - R2: عددُ ملفاتِ الاختبارِ في `docs/ROOT_OF_TRUST.md` يُطابقُ عددَ `*.test.mjs`.
//   - R3: عددُ البنودِ المفتوحةِ في `PROJECT_STATUS.md` يُطابقُ عددَ البنودِ المفتوحةِ على المنفِّذ.
//   - R4: كلُّ صفٍّ في كلِّ جدولٍ في سجلِّ الدَّينِ يُطابقُ عددَ خلايا ترويستِه — أُضيفَ في `WL-219`
//     إغلاقاً للدَّينِ `DOC-13`، ووُسِّعَ في `WL-220` إغلاقاً للدَّينِ `DOC-14`. **يَنزِعُ ما بينَ علامتَيْ كودٍ قبلَ العدِّ**، فـ`|`
//     داخلَ كودٍ ليسَ فاصلَ خليّةٍ. **ونطاقُهُ كلُّ جداولِ السجلِّ** — ترويسةً وفاصلاً وصفوفاً — لا §4.6 وحدَها.
//   - R5: عمودُ الإغلاقِ في §4.3 من سجلِّ الدَّينِ يُطابقُ سلطةَ الإغلاقِ في `config/external-review.yaml` —
//     أُضيفَ في `WL-221` إغلاقاً للدَّينِ `DOC-15`. فالعقدُ يَنُصُّ `resultAuthority: model-council` وأنّ
//     «إعادةَ الاختبارِ وحكمَ الإغلاقِ يُصدِرُهما المجلسُ»، والمادة 11 §1 تقضي أنّ **المنفِّذَ ليسَ المراجعَ**؛
//     فصفٌّ يُسنِدُ إغلاقَ نتيجةٍ إلى المنفِّذِ يُخالِفُ العقدَ. **يَقرأُ العقدَ بمُفسِّرِ YAML لا بمطابقةِ نصٍّ.**
//
// **حدٌّ مُعلَنٌ:** لا يَفحَصُ كلَّ رقمٍ في كلِّ وثيقة. الأرقامُ التاريخيةُ
// والإصداراتُ والمعرّفاتُ والحدودُ التصميميةُ خارجُ النطاق. وما أرقامُ
// نتائجِ التشغيلِ (نجاح/فشل/تخطّي) فلا تُحفَظُ في الوثيقة — انظر ناتجَ `npm run validate`.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { parse as parseYaml } from 'yaml';
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

// ── R4: سلامةُ بِنيةِ كلِّ جدولٍ في سجلِّ الدَّين ──
// **لماذا:** دَينٌ قُيِّدَ في صفٍّ مُلتصِقٍ بسابقِه لا يُقرأُ صفّاً (‏`DOC-13`)، وصفوفٌ بأعدادِ
// خلايا تُخالِفُ ترويستَها خارجَ §4.6 (‏`DOC-14`). **يَفحَصُ كلَّ جدولٍ في السجلِّ** — ترويسةً وفاصلاً وصفوفاً.
{
  const registerText = readText('docs/roadmap/06-debt-register.md');
  const lines = registerText.split('\n');
  /**
   * عددُ الخلايا بعدَ نزعِ ما بينَ علامتَيْ كودٍ.
   * @param {string} line
   * @returns {number}
   */
  const cellCount = (line) => line.replace(/`[^`]*`/g, '§').split('|').length - 2;
  /** @type {{startLine: number, header: string, rows: [number, string][], separators: [number, string][]}[]} */
  const tables = [];
  /** @type {{startLine: number, header: string, rows: [number, string][], separators: [number, string][]} | null} */
  let current = null;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? '';
    if (line.startsWith('|')) {
      if (!current) {
        current = {
          startLine: i + 1,
          header: line,
          rows: /** @type {[number, string][]} */ ([]),
          separators: /** @type {[number, string][]} */ ([]),
        };
      } else if (
        current.rows.length === 0 &&
        /^\s*[|:\-\s]+\s*$/.test(line.replace(/`[^`]*`/g, ''))
      ) {
        // صفٌّ فاصلٌ (---) — يُفحَصُ عرضُه ولا يُحسَبُ صفَّ بياناتٍ.
        current.separators.push([i + 1, line]);
      } else {
        current.rows.push([i + 1, line]);
      }
    } else if (current) {
      tables.push(current);
      current = null;
    }
  }
  if (current) tables.push(current);

  if (tables.length === 0) {
    violations.push('R4/MISSING: لا جداولَ في سجلِّ الدَّينِ.');
  } else {
    for (const table of tables) {
      const width = cellCount(table.header);
      if (width < 2) {
        violations.push(
          `R4/SHAPE: جدولٌ عندَ السطرِ ${table.startLine}: ترويسةٌ بعرضٍ غيرِ صالحٍ (${width}).`,
        );
        continue;
      }
      for (const [lineNumber, line] of table.separators) {
        const count = cellCount(line);
        if (count !== width) {
          violations.push(
            `R4/SHAPE: سجلُّ الدَّينِ، السطرُ ${lineNumber}: صفٌّ فاصلٌ بعرضٍ ${count} والترويسةُ ${width}.`,
          );
        }
      }
      for (const [lineNumber, line] of table.rows) {
        const count = cellCount(line);
        if (count !== width) {
          violations.push(
            `R4/SHAPE: سجلُّ الدَّينِ، السطرُ ${lineNumber}: ${count} خليّةً والترويسةُ ${width}.`,
          );
        }
      }
    }
  }
}

// ── R5: عمودُ الإغلاقِ في §4.3 يُطابقُ سلطةَ الإغلاقِ في العقدِ ──
// **لماذا:** قِيسَ في `WL-221` أنّ خمسةَ صفوفٍ (`R6-A-12`،`R6-A-13`،`R6-B-03`،`R6-B-04`،`R6-B-05`)
// كانت تُسنِدُ الإغلاقَ إلى «منفِّذ» بينما العقدُ يَحصُرُه في المجلسِ ونصُّ §4.3 نفسُه يقولُ ذلك —
// فالجدولُ كان يَنقُضُ نصَّه وعقدَه. هذا الحاجزُ يَمنعُ رجوعَه.
{
  const contractText = readText('config/external-review.yaml');
  if (contractText.trim() === '') {
    violations.push('R5/MISSING: لا يمكنُ قراءةُ `config/external-review.yaml`.');
  } else {
    /** @type {unknown} */
    let contract = null;
    try {
      contract = parseYaml(contractText);
    } catch {
      violations.push('R5/PARSE: `config/external-review.yaml` ليسَ YAML صالحاً.');
    }
    const authority =
      contract && typeof contract === 'object'
        ? /** @type {{resultAuthority?: unknown}} */ (contract).resultAuthority
        : undefined;
    if (authority !== 'model-council') {
      violations.push(
        `R5/CONTRACT: العقدُ يَذكُرُ سلطةَ نتائجٍ «${String(authority)}» والمُتوقَّعُ «model-council».`,
      );
    } else {
      const lines = readText('docs/roadmap/06-debt-register.md').split('\n');
      const start = lines.findIndex((l) => l.startsWith('### 4.3'));
      if (start === -1) {
        violations.push('R5/MISSING: لا قسمَ §4.3 في سجلِّ الدَّينِ.');
      } else {
        let dataRows = 0;
        for (let i = start + 1; i < lines.length; i += 1) {
          const line = lines[i] ?? '';
          if (line.startsWith('### ')) break;
          if (!line.startsWith('|')) continue;
          const cells = line
            .replace(/`[^`]*`/g, '§')
            .split('|')
            .slice(1, -1)
            .map((c) => c.trim());
          if (cells.length < 4) continue;
          if (/^[:\-\s§]+$/.test(cells.join(''))) continue;
          const raw = line
            .split('|')
            .slice(1, -1)
            .map((c) => c.trim());
          const id = raw[0] ?? '';
          const closure = raw[raw.length - 1] ?? '';
          if (closure === 'الإغلاقُ') continue;
          dataRows += 1;
          if (closure.includes('منفِّذ') || closure.includes('منفذ')) {
            violations.push(
              `R5/AUTHORITY: سجلُّ الدَّينِ، السطرُ ${i + 1} (${id}): عمودُ الإغلاقِ «${closure}» يُسنِدُ إغلاقَ نتيجةِ مراجعةٍ إلى المنفِّذِ، والعقدُ يَحصُرُه في المجلسِ (المادة 11 §1).`,
            );
          } else if (!closure.includes('مجلس')) {
            violations.push(
              `R5/AUTHORITY: سجلُّ الدَّينِ، السطرُ ${i + 1} (${id}): عمودُ الإغلاقِ «${closure}» لا يَذكُرُ المجلسَ.`,
            );
          }
        }
        if (dataRows === 0) {
          violations.push('R5/MISSING: جدولُ §4.3 بلا صفوفِ نتائجٍ.');
        }
      }
    }
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
