#!/usr/bin/env node
// حاجز حداثة لوحة الحالة — أُضيف في `WL-171` إغلاقاً للدَينِ `DOC-1`.
//
// **العيبُ الذي يُغلقه، وقد قِيس لا افتُرض:** كانت `PROJECT_STATUS.md` — وهي
// أوّلُ ما يقرأه القادمُ الجديدُ إلى المستودعِ، وأحدُ مصادرِ دليلِ الجاهزيّةِ —
// **متجمِّدةً على `WL-092`** حينَ كان سجلُّ الأعمالِ قد بلغَ `WL-169`: ستٌّ
// وسبعونَ مُدخلةً جرت ولم تظهرْ في اللوحةِ. فمن قرأَ اللوحةَ وحدَها ظنَّ العملَ
// واقفاً عندَ `M10.09` وهو قد جاوزَه بمسارٍ كاملٍ وستِّ جولاتِ مراجعةٍ.
//
// **ولا يُغلَقُ مثلُ هذا بتحديثٍ يدويٍّ مرّةً واحدةً:** الانحرافُ عادَ لأنّه لم
// يكن مقيساً، فما لا يُقاسُ يعودُ. فصارَ التطابقُ حاجزاً مُسمّىً في سلسلةِ
// `npm run validate`، يمنعُ دفعةً تُقيِّدُ مُدخلةً جديدةً وتتركُ اللوحةَ خلفَها.
//
// **ما يقيسه بالضبطِ:** أنّ سطرَ «آخر تحديث» في `PROJECT_STATUS.md` يحملُ
// **معرِّفَ أحدثِ مُدخلةٍ** في `docs/roadmap/05-work-log.md` **وتاريخَها** نفسَه.
//
// **حدٌّ معلَنٌ لا يُتجاوَزُ:** هذا حاجزُ **حداثةٍ** لا حاجزُ **صدقٍ**: يقيسُ أنّ
// اللوحةَ تشيرُ إلى أحدثِ قيدٍ، ولا يقيسُ أنّ نصَّها يصفُ ما جرى فيه وصفاً
// صحيحاً — وذاك حكمٌ لا يُقاسُ نصّاً ويبقى شرطَ المادة 1 والمادة 4 على المنفِّذِ.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const rootIndex = process.argv.indexOf('--root');
const repoRoot = rootIndex === -1 ? process.cwd() : (process.argv[rootIndex + 1] ?? process.cwd());

const WORK_LOG = 'docs/roadmap/05-work-log.md';
const STATUS = 'PROJECT_STATUS.md';

/**
 * يقرأ ملفّاً نصّيّاً من جذرِ المستودعِ، ويرمي خطأً مُسمّىً إن تعذّر.
 *
 * @param {string} relativePath مسارٌ نسبيٌّ من جذرِ المستودع.
 * @returns {string} نصُّ الملفّ.
 */
function readText(relativePath) {
  try {
    return readFileSync(path.join(repoRoot, relativePath), 'utf8');
  } catch (error) {
    throw new Error(
      `${relativePath} لا يُقرأ: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
}

/**
 * يستخرج أحدثَ مُدخلةٍ من سجلِّ الأعمالِ: الأكبرَ رقماً لا الأولَ موضعاً،
 * فترتيبُ الموضعِ اتفاقٌ يُخالَفُ سهواً والرقمُ حقيقةٌ تُقاس.
 *
 * @param {string} logText نصُّ سجلِّ الأعمال.
 * @returns {{ id: string, date: string } | null} أحدثُ مُدخلةٍ أو `null` إن لا مُدخلةَ.
 */
function newestEntry(logText) {
  const pattern = /^###\s*\[(\d{4}-\d{2}-\d{2})\]\s*—\s*(WL-\d{3})\s*—/gm;
  /** @type {{ id: string, date: string } | null} */
  let newest = null;
  for (const match of String(logText).matchAll(pattern)) {
    const date = String(match[1]);
    const id = String(match[2]);
    if (newest === null || Number(id.slice(3)) > Number(newest.id.slice(3))) {
      newest = { id, date };
    }
  }
  return newest;
}

/** @type {string[]} */
const violations = [];

console.log('═══ حاجز حداثة لوحة الحالة ═══');

try {
  const logText = readText(WORK_LOG);
  const statusText = readText(STATUS);
  const newest = newestEntry(logText);

  if (newest === null) {
    violations.push(`R1: لا مُدخلةَ عملٍ واحدةً بقالبِ المادة 6 في \`${WORK_LOG}\`.`);
  } else {
    const headerMatch = /^آخر تحديث:\s*\*\*(\d{4}-\d{2}-\d{2})\*\*(.*)$/m.exec(statusText);
    if (headerMatch === null) {
      violations.push(
        `R2: \`${STATUS}\` بلا سطرِ «آخر تحديث: **YYYY-MM-DD**» — فلا موضعَ يُقاسُ فيه التطابقُ.`,
      );
    } else {
      const statusDate = String(headerMatch[1]);
      const headerTail = String(headerMatch[2]);
      const idMatch = /WL-\d{3}/.exec(headerTail);
      if (idMatch === null) {
        violations.push(
          `R3: سطرُ «آخر تحديث» في \`${STATUS}\` لا يُسمّي مُدخلةَ عملٍ (\`WL-###\`) — ولوحةٌ بلا قيدٍ تُنسَبُ إليه دعوىً لا دليلاً.`,
        );
      } else if (String(idMatch[0]) !== newest.id) {
        violations.push(
          `R4: انحرافُ لوحةٍ: \`${STATUS}\` يُشيرُ إلى «${String(idMatch[0])}» وأحدثُ مُدخلةٍ في السجلِّ «${newest.id}» — فمن قرأَ اللوحةَ وحدَها قرأَ ماضياً.`,
        );
      }
      if (statusDate !== newest.date) {
        violations.push(
          `R5: انحرافُ تاريخٍ: \`${STATUS}\` يقولُ «${statusDate}» وتاريخُ ${newest.id} «${newest.date}».`,
        );
      }
    }
  }
} catch (error) {
  violations.push(error instanceof Error ? error.message : String(error));
}

if (violations.length > 0) {
  console.error('\n❌ الحكمُ: انحرافُ لوحةِ الحالةِ عن سجلِّ الأعمالِ:');
  for (const violation of violations) console.error(`  • ${violation}`);
  console.error(
    '\nالإصلاحُ: حدِّثْ سطرَ «آخر تحديث» في `PROJECT_STATUS.md` بمعرِّفِ أحدثِ مُدخلةٍ وتاريخِها، **ووصفِ ما جرى فيها** — لا بالمعرِّفِ وحدَه.',
  );
  process.exit(1);
}

console.log(
  '✅ الحكمُ: لوحةُ الحالةِ تُشيرُ إلى أحدثِ مُدخلةٍ بتاريخِها. **حداثةٌ مقيسةٌ لا صدقُ وصفٍ: صحّةُ النصِّ تبقى شرطَ المادة 4 على المنفِّذِ.**',
);
