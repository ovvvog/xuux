#!/usr/bin/env node
// guard:doc-counts — **البوابةُ الثامنةُ والأربعون** — أُضيفت في `WL-196` إغلاقاً للدَّين `D-5`.
//
// **العطلُ الذي يُغلقُه:** أرقامٌ عدّاديّةٌ تُكتَبُ يداً في الوثائقِ تنحرفُ عن
// مصدرِها حينَ يتغيّرُ الكودُ ولا تُحدَّثُ الوثيقة. عدّادُ النسبةِ أُتمِتَ في
// `WL-063` بحاجزِ `guard:progress`، لكنّ بقيةَ العدّاداتِ اليدويّةِ لم تكن
// محصورة.
//
// **الحاجزُ يَفحَصُ سبعَ قواعدَ** (وكانَ ثلاثةَ عدّاداتٍ يومَ `WL-196`):
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
//   - R6: كلُّ نتيجةٍ في `config/external-review.yaml` لها صفٌّ في جدولِ §4.3 من سجلِّ الدَّينِ —
//     أُضيفَ في `WL-240` (‏ولم يكنْ لذلكَ الدَّينِ معرِّفٌ في السجلِّ؛ و`DOC-17` معرِّفُ دَينٍ آخرَ من `WL-268` — `DOC-18`). 17 نتيجةً (سلسلةُ `R5-*` و`UF-16`) كانت في العقدِ
//     وغابت عن الجدولِ، فصارَ الدَّينُ غيرَ مرئيٍّ. هذه القاعدةُ تَقيسُ الاكتمالَ لا الصحّةَ: كلُّ معرِّفٍ في
//     `findings[].id` يجبُ أن يظهرَ في عمودِ المعرِّفِ في الجدول. وتُستخرَجُ المعرّفاتُ من العقدِ بمُفسِّرِ YAML.
//   - R7: أقسامُ سجلِّ الدَّينِ من المستوى الثاني (`## `) فريدةٌ وغيرُ فارغةٍ، ولكلِّ جدولٍ صفٌّ فاصلٌ
//     بعدَ ترويستِه (`R4/NO-SEPARATOR`) — أُضيفا في `WL-273` إغلاقاً لـ`DOC-18`.
//   - R8: علامةُ الإغلاقِ الموحَّدةُ (‏`~~ID~~` + 🟢) — أُضيفَ في `WL-330` لـ`DOC-23`. ونطاقُه §4 و§6 منذ `WL-344`. ووُسِّعَ في `WL-338`
//     لـ`DOC-29`: في §4.3 **مصدرُ الحالةِ هو `config/external-review.yaml` لا الصفُّ** — نتيجةٌ `closed`
//     في العقدِ بلا علامةٍ في صفِّها ⇒ `R8/YAML-CLOSED-UNMARKED`، ونتيجةٌ غيرُ `closed` بعلامةِ إغلاقٍ
//     ⇒ `R8/YAML-OPEN-MARKED`. فالحاجزُ يقيسُ الصفَّ بالعقدِ ولا يُغيِّرُ العقد.
//   - R9: معرِّفُ الدَّينِ يرِدُ صفّاً مرّةً واحدةً في الجدولِ الواحدِ (`R9/DUP-ROW`) — أُضيفَ في
//     `WL-336` لـ`DOC-28`.
//
// **حدٌّ مُعلَنٌ:** لا يَفحَصُ كلَّ رقمٍ في كلِّ وثيقة. الأرقامُ التاريخيةُ
// والإصداراتُ والمعرّفاتُ والحدودُ التصميميةُ خارجُ النطاق. وما أرقامُ
// نتائجِ التشغيلِ (نجاح/فشل/تخطّي) فلا تُحفَظُ في الوثيقة — انظر ناتجَ `npm run validate`.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { parse as parseYaml } from 'yaml';
import { readDocCountFacts, openIdsInList } from './lib/doc-count-facts.mjs';

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
  return new Set(openIdsInList(listBlock)).size;
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
      // **جدولٌ بلا صفٍّ فاصلٍ ليسَ جدولاً** (‏`DOC-18`، `WL-273`): Markdown لا يَعرضُه صفوفاً بل
      // نصّاً فيه `|`، فأوّلُ صفِّ بياناتٍ فيه يُقرأُ ترويسةً ويُعَدُّ ما تحتَه على عرضِه فيَمُرُّ.
      // قِيسَ أنّ سطرَ `---` مُقحَماً في §4.6 شطرَ الجدولَ فصارَ أحدَ عشرَ صفّاً (منها `LIVE-17`
      // المفتوحُ) بلا ترويسةٍ، والحاجزُ أخضرُ. فالفاصلُ يَلي الترويسةَ مباشرةً أو يَسقُطُ الجدولُ.
      if (table.separators.length === 0) {
        violations.push(
          `R4/NO-SEPARATOR: سجلُّ الدَّينِ، السطرُ ${table.startLine}: جدولٌ بلا صفٍّ فاصلٍ بعدَ ترويستِه — لا يُعرَضُ جدولاً، وأوّلُ صفٍّ فيه يُقرأُ ترويسةً.`,
        );
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
      // ── R9: معرِّفُ الدَّينِ يرِدُ صفّاً مرّةً واحدةً في الجدولِ الواحدِ (‏`WL-336`، `DOC-28`) ──
      // **لماذا:** حلُّ تعارضٍ بالاتّحادِ في `#256` أبقى نسختَي صفَّي `LIVE-40` و`DOC-23` (‏القديمةَ
      // والجديدةَ) في §4.6، و`R4` أخضرُ لأنَّ كلَّ نسخةٍ بعرضٍ صحيحٍ. فقارئُ الصفِّ الأوّلِ يقرأُ
      // حالاً قديمةً. والنطاقُ الجدولُ الواحدُ: §6 يُحيلُ إلى معرِّفاتِ §4 قصداً (‏`REPO-4`/`REPO-5`).
      /** @type {Map<string, number>} */
      const seen = new Map();
      for (const [lineNumber, line] of table.rows) {
        const id = /^\|\s*(?:~~)?`([^`]+)`/.exec(line)?.[1];
        if (!id) continue;
        const first = seen.get(id);
        if (first === undefined) {
          seen.set(id, lineNumber);
        } else {
          violations.push(
            `R9/DUP-ROW: سجلُّ الدَّينِ، السطرُ ${lineNumber}: المعرِّفُ «${id}» صفٌّ مكرَّرٌ في جدولِه — وردَ أوّلاً في السطرِ ${first}. يبقى صفٌّ واحدٌ بأحدثِ نصٍّ.`,
          );
        }
      }
    }
  }
}

// ── R7: أقسامُ سجلِّ الدَّينِ من المستوى الثاني فريدةٌ وغيرُ فارغةٍ ──
// **لماذا (‏`DOC-18`، `WL-273`):** قِيسَ أنّ دفعةَ `WL-268` نسخَت §5 كاملاً فصارَ في السجلِّ
// قسمانِ «## 5» متطابقانِ حرفاً، وبينَهما ترويسةُ «## 6» **فارغةٌ** — فمَن قرأَ أوّلَ §6 رأى
// «ما لا يملكُ المنفِّذُ إغلاقَه» بلا بندٍ واحدٍ، والبنودُ في نسخةٍ ثانيةٍ تحتَه. والحواجزُ كلُّها
// خضراءُ لأنَّ `R4` يَقيسُ الصفوفَ لا الأقسامَ. فالقسمُ يَرِدُ مرّةً، ولا يَخلو من مضمونٍ.
{
  const lines = readText('docs/roadmap/06-debt-register.md').split('\n');
  /** @type {Map<string, number>} */
  const seen = new Map();
  /** @type {{title: string, line: number, body: string[]}[]} */
  const sections = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? '';
    if (/^## /.test(line)) {
      const title = line.trim();
      const first = seen.get(title);
      if (first !== undefined) {
        violations.push(
          `R7/DUP-SECTION: سجلُّ الدَّينِ، السطرُ ${i + 1}: القسمُ «${title}» مكرَّرٌ — وردَ أوّلاً في السطرِ ${first}.`,
        );
      } else {
        seen.set(title, i + 1);
      }
      sections.push({ title, line: i + 1, body: [] });
    } else if (sections.length > 0) {
      sections[sections.length - 1]?.body.push(line);
    }
  }
  if (sections.length === 0) {
    violations.push('R7/MISSING: لا أقسامَ من المستوى الثاني في سجلِّ الدَّينِ.');
  }
  for (const section of sections) {
    const content = section.body.filter((l) => l.trim() !== '' && l.trim() !== '---');
    if (content.length === 0) {
      violations.push(
        `R7/EMPTY-SECTION: سجلُّ الدَّينِ، السطرُ ${section.line}: القسمُ «${section.title}» بلا مضمونٍ.`,
      );
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

// ── R6: اكتمالُ جدولِ §4.3 مقابلَ العقدِ ──
// 17 نتيجةً كانت في العقدِ وغابت عن الجدولِ — فصارَ الدَّينُ غيرَ مرئيٍّ.
// هذه القاعدةُ تَقيسُ أنّ كلَّ معرِّفٍ في `findings[].id` يظهرُ في الجدول.
{
  const contractText = readText('config/external-review.yaml');
  if (contractText.trim() !== '') {
    /** @type {unknown} */
    let contract = null;
    try {
      contract = parseYaml(contractText);
    } catch {
      // R5 already reports parse errors
    }
    if (contract && typeof contract === 'object') {
      const findings = /** @type {{findings?: unknown}} */ (contract).findings;
      if (Array.isArray(findings)) {
        const yamlIds = new Set();
        for (const f of findings) {
          if (f && typeof f === 'object' && 'id' in f) {
            const id = /** @type {{id: unknown}} */ (f).id;
            if (typeof id === 'string') yamlIds.add(id);
          }
        }
        const lines = readText('docs/roadmap/06-debt-register.md').split('\n');
        const start = lines.findIndex((l) => l.startsWith('### 4.3'));
        if (start !== -1) {
          const tableIds = new Set();
          for (let i = start + 1; i < lines.length; i += 1) {
            const line = lines[i] ?? '';
            if (line.startsWith('### ')) break;
            if (!line.startsWith('|')) continue;
            const m = line.match(/`([A-Z0-9][A-Z0-9.-]*)`/);
            if (m) tableIds.add(m[1]);
          }
          const missing = [...yamlIds].filter((id) => !tableIds.has(id));
          if (missing.length > 0) {
            violations.push(
              `R6/MISSING: ${missing.length} نتيجةً في العقدِ بلا صفٍّ في جدولِ §4.3: ${missing.join('، ')}`,
            );
          }
        }
      }
    }
  }
}

// ── R8: توحيدُ علامةِ الإغلاقِ — أُضيفَ في `WL-330` إغلاقاً للدَّين `DOC-23`.
//   كلُّ صفٍّ مُغلَقٍ في جداولِ §4 (‏4.1…4.6) يجبُ أن يحملَ في خليّةِ المعرِّفِ: ~~`ID`~~ + 🟢.
//   **ما يُنفِذُه هذا الشطرُ فعلاً (‏تصحيحُ وصفٍ في `WL-338`، `DOC-29`):** صفٌّ معرِّفُه مشطوبٌ بلا 🟢
//   يُرَدُّ (‏`R8/UNMARKED`). وكانَ هذا التعليقُ يَعِدُ بأنّ «المُغلَقَ ما يذكرُ مُغلَق أو يحملُ 🟢 في أيِّ
//   خليّة»، والشفرةُ لا تقرأُ إلّا الشطبَ — فصفٌّ مُغلَقٌ بلا شطبٍ لم يكنْ يراه أحد. **حدٌّ معلَنٌ:**
//   خارجَ §4.3 لا مصدرَ آليّاً للحالةِ غيرُ الصفِّ نفسِه، فلا يُستدَلُّ على الإغلاقِ من نصِّ خليّة.
//   وفي §4.3 المصدرُ هو العقدُ — الشطرُ التالي.
{
  const debtText = readText('docs/roadmap/06-debt-register.md');
  const debtLines = debtText.split('\n');
  // ‏`WL-344` (‏الشقُّ الثالثُ من `DOC-30`): §6 جدولُ معرِّفاتٍ كـ§4 — كانَ النطاقُ §4 وحدَه، فبقيَ
  // `OPS-1/R6-REMEASURE` مشطوباً بلا 🟢 في خليّتِه لا يراه أحد. §5 و§7 بلا جداول.
  for (const [from, to] of [
    ['## 4 —', '## 5 —'],
    ['## 6 —', '## 7 —'],
  ]) {
    const tableStart = debtLines.findIndex((l) => l.startsWith(from));
    if (tableStart === -1) continue;
    const tableEnd = debtLines.findIndex((l, i) => i > tableStart && l.startsWith(to));
    const sectionEnd = tableEnd === -1 ? debtLines.length : tableEnd;
    for (let i = tableStart; i < sectionEnd; i += 1) {
      const line = debtLines[i] ?? '';
      if (!line.startsWith('|')) continue;
      if (line.includes('| ---')) continue;
      const cells = line
        .split('|')
        .map((c) => c.trim())
        .filter(Boolean);
      if (cells.length < 2) continue;
      const idCell = cells[0];
      if (!idCell) continue;
      // تحديدُ ما إذا كانَ الصفُّ مُغلَقاً: المعرِّفُ مشطوبٌ بـ~~
      const isClosed = idCell.includes('~~');
      if (!isClosed) continue;
      // تخطّي صفوفِ الترويسةِ والملخصِ
      if (
        idCell.startsWith('الديون') ||
        idCell.startsWith('الحدود') ||
        idCell.startsWith('نتائج') ||
        idCell.startsWith('ديون') ||
        idCell.startsWith('المعرِّف')
      )
        continue;
      const hasStrikethrough = idCell.includes('~~');
      const hasEmoji = idCell.includes('🟢');
      if (!hasStrikethrough || !hasEmoji) {
        const idMatch = idCell.match(/`([^`]+)`/);
        const idName = idMatch ? idMatch[1] : idCell.slice(0, 30);
        violations.push(
          `R8/UNMARKED: الصفُّ «${idName}» مُغلَقٌ بلا علامةِ إغلاقٍ موحَّدةٍ (~~ID~~ + 🟢) في خليّةِ المعرِّفِ — سطر ${i + 1}.`,
        );
      }
    }
  }
}

// ── R8 (‏§4.3): حالةُ النتيجةِ من العقدِ لا من الصفِّ — `WL-338` لـ`DOC-29` ──
//   **الحادثةُ:** 21 نتيجةً `closed` في `config/external-review.yaml` (‏بحكمِ المجلسِ وسجلِّ إغلاقِها)
//   كانت صفوفُها في §4.3 بلا علامةٍ، فعرضَها `docs/HANDOFF.md` «بلا علامةِ إغلاقٍ» تحتَ المجلس،
//   والحاجزُ أخضر. فالقاعدةُ هنا تقرأُ `findings[].status` بمُفسِّرِ YAML وتُقابِلُ به خليّةَ المعرِّف:
//   `closed` ⇐ `~~ID~~ 🟢` لزاماً، وما سواه ⇐ لا شطبَ ولا 🟢. **لا تكتبُ في العقدِ ولا تُغلِقُ شيئاً.**
{
  const contractText = readText('config/external-review.yaml');
  /** @type {unknown} */
  let contract = null;
  try {
    contract = contractText.trim() === '' ? null : parseYaml(contractText);
  } catch {
    // R5 يُبلِّغُ عن عطبِ التفسير.
  }
  const findings =
    contract && typeof contract === 'object'
      ? /** @type {{findings?: unknown}} */ (contract).findings
      : undefined;
  if (Array.isArray(findings)) {
    /** @type {Map<string, string>} */
    const statusOf = new Map();
    for (const f of findings) {
      if (f && typeof f === 'object' && 'id' in f) {
        const { id, status } = /** @type {{id: unknown, status?: unknown}} */ (f);
        if (typeof id === 'string') statusOf.set(id, String(status ?? ''));
      }
    }
    const lines = readText('docs/roadmap/06-debt-register.md').split('\n');
    const start = lines.findIndex((l) => l.startsWith('### 4.3'));
    if (start !== -1) {
      for (let i = start + 1; i < lines.length; i += 1) {
        const line = lines[i] ?? '';
        if (line.startsWith('### ') || line.startsWith('## ')) break;
        if (!line.startsWith('|') || line.includes('| ---')) continue;
        const idCell = (line.split('|')[1] ?? '').trim();
        const m = /^(~~)?`([^`]+)`(~~)?\s*(🟢)?\s*$/u.exec(idCell);
        if (m === null) continue;
        const id = String(m[2]);
        const status = statusOf.get(id);
        if (status === undefined) continue; // غيابُه عن العقدِ ليس حكماً هنا (‏`R6` للاتّجاهِ الآخر).
        const struck = m[1] === '~~' && m[3] === '~~';
        const marked = struck && m[4] === '🟢';
        const anyMark = m[1] === '~~' || m[3] === '~~' || m[4] === '🟢';
        if (status === 'closed' && !marked) {
          violations.push(
            `R8/YAML-CLOSED-UNMARKED: «${id}» حالتُها \`closed\` في \`config/external-review.yaml\` وصفُّها في §4.3 بلا علامةِ الإغلاقِ الموحَّدةِ (~~ID~~ + 🟢) — سطر ${i + 1}.`,
          );
        } else if (status !== 'closed' && anyMark) {
          violations.push(
            `R8/YAML-OPEN-MARKED: «${id}» حالتُها \`${status}\` في \`config/external-review.yaml\` وصفُّها في §4.3 يحملُ علامةَ إغلاقٍ — لا تُغلَقُ نتيجةٌ في السجلِّ وهي مفتوحةٌ في العقد — سطر ${i + 1}.`,
          );
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
