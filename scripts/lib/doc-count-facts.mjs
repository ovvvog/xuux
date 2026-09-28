// doc-count-facts — المصدرُ الواحدُ للعدّاداتِ القابلةِ للانحرافِ في الوثائق.
//
// **العطلُ الذي يُغلقُه (D-5):** أرقامٌ عدّاديّةٌ تُكتَبُ يداً في الوثائقِ
// (عددُ الحواجز، عددُ ملفاتِ الاختبار، عددُ البنودِ المفتوحة) تنحرفُ عن
// مصدرِها حينَ يتغيّرُ الكودُ ولا تُحدَّثُ الوثيقة. هذه الوحدةُ تَحسُبُها من
// مصدرِها الأصليِّ لا من نصٍّ محمول.
//
// **حدٌّ مُعلَنٌ:** لا تَحسُبُ كلَّ رقمٍ في كلِّ وثيقة — تَحسُبُ العدّاداتِ
// القابلةَ للانحرافِ وحدَها. التواريخُ والإصداراتُ والمعرّفاتُ والحدودُ
// التصميميةُ خارجُ النطاق.

import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

/**
 * يَحسُبُ عددَ خطواتِ `guard:*` في سكربتِ `validate` من `package.json`.
 * @param {string} root
 * @returns {number}
 */
export function countGuards(root) {
  const pkgPath = path.join(root, 'package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  const validate = pkg.scripts?.validate ?? '';
  const steps = validate.split(' && ').map((/** @type {string} */ s) => s.trim());
  return steps.filter((/** @type {string} */ s) => s.startsWith('npm run guard:')).length;
}

/**
 * يَحسُبُ عددَ ملفاتِ الاختبارِ `*.test.mjs` تحتَ `tests/`.
 * @param {string} root
 * @returns {number}
 */
export function countTestFiles(root) {
  const testsDir = path.join(root, 'tests');
  return countFilesRecursive(testsDir, '.test.mjs');
}

/**
 * @param {string} dir
 * @param {string} ext
 * @returns {number}
 */
function countFilesRecursive(dir, ext) {
  let count = 0;
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      count += countFilesRecursive(full, ext);
    } else if (entry.name.endsWith(ext)) {
      count += 1;
    }
  }
  return count;
}

/**
 * المعرّفاتُ **المفتوحةُ** في قائمةٍ: يُسقِطُ كلَّ ما بينَ `~~…~~` قبلَ العدِّ.
 *
 * **علّةُ وجودِها (`WL-268`):** كانَ العدُّ يَلتقطُ كلَّ معرِّفٍ بينَ علامتَيْ كودٍ،
 * فعَدَّ `~~\`LIVE-14\`~~ 🟢` مفتوحاً وهوَ مُغلَقٌ بشطبِه، فقالَ الحاجزُ «5 بنودٍ
 * مفتوحةٍ» والمفتوحُ منها اثنانِ — **حاجزٌ يَخضَرُّ على رقمٍ كاذبٍ**. والشطبُ هوَ
 * عُرفُ الإغلاقِ في السجلِّ كلِّهِ، فالمشطوبُ لا يُعَدُّ.
 * والمعرِّفُ قد يَحمِلُ `/` لفرعٍ (`OPS-1/MAIN-DRIFT-WINDOW`).
 *
 * @param {string} listBlock
 * @returns {string[]}
 */
export function openIdsInList(listBlock) {
  const unstruck = listBlock.replace(/~~[^~]*~~/g, ' ');
  return unstruck.match(/`[A-Z0-9][A-Z0-9/-]*`/g) ?? [];
}

/**
 * يَحسُبُ عددَ البنودِ المفتوحةِ على المنفِّذِ من سجلِّ الدَّين.
 * يَعدّ المعرّفاتِ المذكورةَ في جملةِ «والمفتوحُ على المنفِّذِ ... بنودٍ: `D-5` و`LIM-1` و...».
 * @param {string} root
 * @returns {number}
 */
export function countOpenExecutorDebts(root) {
  const debtPath = path.join(root, 'docs/roadmap/06-debt-register.md');
  const text = readFileSync(debtPath, 'utf8');
  // ابحث عن السطرِ الذي يَذكُرُ البنودَ المفتوحةَ على المنفِّذِ بالمعرّفات.
  const lines = text.split('\n');
  for (const line of lines) {
    if (
      line.includes('المفتوح') &&
      line.includes('بنود') &&
      (line.includes('`D-') ||
        line.includes('`LIM-') ||
        line.includes('`REPO-') ||
        line.includes('`LIVE-') ||
        line.includes('`R3-A-'))
    ) {
      // اعدّ المعرّفاتِ في القائمةِ فقط — بعد «المفتوح...:» وأوّلِ نقطةٍ.
      const maftuhIdx = line.lastIndexOf('المفتوح');
      if (maftuhIdx === -1) continue;
      const afterMaftuh = line.slice(maftuhIdx);
      const colonIdx = afterMaftuh.indexOf(':');
      if (colonIdx === -1) continue;
      const afterColon = afterMaftuh.slice(colonIdx + 1);
      const periodIdx = afterColon.indexOf('.');
      const listBlock = periodIdx === -1 ? afterColon : afterColon.slice(0, periodIdx);
      const ids = openIdsInList(listBlock);
      if (ids.length === 0) continue;
      return new Set(ids).size;
    }
  }
  return 0;
}

/**
 * يَجمعُ كلَّ العدّاداتِ من مصادرِها.
 * @param {string} root
 * @returns {{ guardCount: number, testFileCount: number, openDebtCount: number }}
 */
export function readDocCountFacts(root) {
  return {
    guardCount: countGuards(root),
    testFileCount: countTestFiles(root),
    openDebtCount: countOpenExecutorDebts(root),
  };
}
