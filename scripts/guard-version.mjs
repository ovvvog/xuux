#!/usr/bin/env node
// حاجز تطابق الإصدار — أُضيف في `WL-046`.
//
// **العيبُ الذي يُغلقه، وقد قِيس لا افتُرض:** كان التحقُّقُ من تطابقِ
// `package.json` و`version.json` **خطوةً مكتوبةً داخلَ `ci.yml` وحدَه**، ولا
// نصَّ لها في `package.json` ولا في سلسلةِ `npm run validate`. فالمقيسُ محلّياً
// لم يكن هو المُقاسُ في المسار: شُغِّلت `npm run validate` بقاعدةٍ حقيقيةٍ فخرجت
// صفراً بـ886 اختباراً ناجحاً، ثم **أخفق المسارُ في الطلب `#3`** على هذه الخطوةِ
// بالذات لأن `version.json` رُفع إلى `0.41.0` و`package.json` بقي `0.40.0`.
//
// وهذا هو **درسُ `WL-045` مكرَّراً في موضعٍ آخر**: بوابةٌ تعيش في المسارِ وحدَه
// تجعل «أخضرَ محلّياً» دعوىً لا تُقابِل شيئاً. فصار الفحصُ حاجزاً مُسمّىً
// (`npm run guard:version`) في سلسلةِ `validate`، ويُنادى في `ci.yml` بنصِّه
// نفسِه — فما يُقاس على الجهازِ هو ما يُقاس في المسار.
//
// **حدٌّ معلَن:** يقيس **التطابقَ** لا صحّةَ الترقيم: أن الرفعَ يوافق قواعدَ
// `versioning` في `version.json` (خرقٌ/قدرةٌ/إصلاح) حكمٌ لا يُقاس نصّاً، ويبقى
// شرطَ مُدخلةٍ في سجلِّ الأعمال بالمادة 1.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const rootIndex = process.argv.indexOf('--root');
const repoRoot = rootIndex === -1 ? process.cwd() : (process.argv[rootIndex + 1] ?? process.cwd());

/**
 * يقرأ ملفَّ JSON ويُرجع كائنَه، ويرمي خطأً مُسمّىً إن تعذّر.
 *
 * @param {string} relativePath مسارٌ نسبيٌّ من جذرِ المستودع.
 * @returns {Record<string, unknown>} الكائنُ المقروء.
 */
function readJson(relativePath) {
  const absolute = path.join(repoRoot, relativePath);
  try {
    return /** @type {Record<string, unknown>} */ (JSON.parse(readFileSync(absolute, 'utf8')));
  } catch (error) {
    throw new Error(
      `${relativePath} لا يُقرأ: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
}

/** @type {string[]} */
const violations = [];

console.log('═══ حاجز تطابق الإصدار ═══');

let packageVersion = '';
let stateVersion = '';

try {
  const pkg = readJson('package.json');
  const state = readJson('version.json');
  packageVersion = typeof pkg.version === 'string' ? pkg.version : '';
  stateVersion = typeof state.version === 'string' ? state.version : '';

  if (packageVersion === '') {
    violations.push('R1: `package.json` بلا حقلِ `version` نصّيّ.');
  }
  if (stateVersion === '') {
    violations.push('R1: `version.json` بلا حقلِ `version` نصّيّ.');
  }
  if (packageVersion !== '' && !/^\d+\.\d+\.\d+$/.test(packageVersion)) {
    violations.push(`R2: إصدارُ package.json «${packageVersion}» ليس على صيغةِ semver.`);
  }
  if (stateVersion !== '' && !/^\d+\.\d+\.\d+$/.test(stateVersion)) {
    violations.push(`R2: إصدارُ version.json «${stateVersion}» ليس على صيغةِ semver.`);
  }
  if (packageVersion !== '' && stateVersion !== '' && packageVersion !== stateVersion) {
    violations.push(
      `R3: تعارضُ إصدار: package.json=${packageVersion} و version.json=${stateVersion}؛ ونسختان مختلفتان في مستودعٍ واحدٍ تجعلان أثرَ العملِ غيرَ منسوبٍ إلى إصدارٍ واحد.`,
    );
  }

  const completion = /** @type {Record<string, unknown>} */ (state.completion ?? {});
  const lastEntry = completion.last_entry;
  if (typeof lastEntry !== 'string' || !/^WL-\d{3}$/.test(lastEntry)) {
    violations.push(
      'R4: `completion.last_entry` غائبٌ أو ليس على صيغةِ `WL-###`؛ وإصدارٌ بلا مُدخلةِ سجلٍّ يُخالف المادة 1.',
    );
  } else {
    const log = readFileSync(path.join(repoRoot, 'docs/roadmap/05-work-log.md'), 'utf8');
    if (!log.includes(lastEntry)) {
      violations.push(
        `R4: المُدخلة ${lastEntry} المُعلَنةُ في version.json لا وجودَ لها في سجلِّ الأعمال.`,
      );
    }
  }
} catch (error) {
  violations.push(error instanceof Error ? error.message : String(error));
}

console.log(`package.json = ${packageVersion || '—'}`);
console.log(`version.json = ${stateVersion || '—'}`);

if (violations.length > 0) {
  console.error('\n⛔ حاجز تطابق الإصدار مغلق:');
  for (const violation of violations) console.error(`   - ${violation}`);
  process.exit(1);
}

console.log('\n✅ حاجز تطابق الإصدار مفتوح: نسخةٌ واحدةٌ ومُدخلةٌ قائمة.');
