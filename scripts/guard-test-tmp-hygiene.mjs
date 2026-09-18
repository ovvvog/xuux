#!/usr/bin/env node
// حاجزُ نظافةِ الجذورِ المؤقّتةِ في الاختباراتِ — أُضيفَ في `WL-219` تحويلاً
// للدَّينِ `LIVE-9` من **نتيجةٍ مُغلَقةٍ** إلى **سياسةٍ محروسةٍ**.
//
// **العيبُ الذي يُغلقُه، وقد قِيسَ لا افتُرِض:** ثلاثةُ ملفّاتِ اختبارٍ كانت
// تَنسخُ شجرةَ المستودعِ إلى جذرٍ مؤقّتٍ في `/tmp` **ولا تَحذفُه**. وذلكَ
// **لا يظهرُ** على عدّاءٍ عابرٍ تُهدَمُ آلتُه بعدَ كلِّ تشغيلةٍ، **ويَقتُلُ**
// عدّاءً مقيماً يَبقى فيه `/tmp`: نَفِدَتِ المساحةُ فسقطَتْ تشغيلةٌ بـ`125` فشلَ
// `copyfile` برمزِ `EDQUOT` **بلا انحدارٍ في الشفرةِ** (التشغيلةُ `35334036249`،
// `WL-217`).
//
// **ولا يُغلَقُ مثلُ هذا بإصلاحِ الملفّاتِ الثلاثةِ:** الفئةُ تعودُ بأسماءٍ
// وملفّاتٍ جديدةٍ، وقد قِيسَ أنّها **كانت قائمةً فعلاً** في `29` ملفّاً آخرَ
// بـ`43` موضعَ إنشاءٍ، تَركَت `39` جذراً و`~51M` في تشغيلةٍ واحدةٍ على `main`
// (`WL-218`) — و`/tmp` هناك قرصٌ ذاكريٌّ سعتُه `788M` فقط. **فما لا يُقاسُ
// يعودُ**، ولذلك صارَ الشرطُ حاجزاً مُسمّىً في سلسلةِ `npm run validate`.
//
// **ما يقيسُه بالضبطِ — ثلاثةُ نصوصٍ:**
//   • `R1`: كلُّ موضعِ `mkdtempSync` في ملفٍّ متعقَّبٍ تحتَ `tests/` **مُدبَّرُ
//     المحوِ**: إمّا مُغلَّفٌ بـ`registerTmpRoot(...)`، وإمّا في ملفٍّ يَستعملُ
//     `rmSync(` (وهو العُرفُ القائمُ: `cleanup()` تُعيدُها الدالّةُ المُهيِّئةُ).
//   • `R2`: **لا قائمةَ استثناءٍ** — فالحاجزُ لا يُمرَّرُ بتسجيلِ اسمٍ فيه.
//     (هذا نصٌّ على البنيةِ: ليسَ في الحاجزِ مَدخلٌ لاستثناءٍ أصلاً.)
//   • `R3`: مُعِينُ التسجيلِ `tests/helpers/tmp-roots.mjs` **قائمٌ وعاملٌ**:
//     يُركِّبُ مُستمِعَ `process.on('exit')` ويَمحو بـ`rmSync`. فلا يُخرَسُ
//     الحاجزُ بتفريغِ المُعِينِ من عملِه وإبقاءِ اسمِه.
//
// **حدودٌ مُعلَنةٌ لا مستورةٌ:**
//   1. حضورُ `rmSync(` في الملفِّ **قرينةٌ على مستوى الملفِّ لا برهانٌ** على أنّ
//      هذا الجذرَ بعينِه يُمحى. وهذا مقبولٌ لأنّ القياسَ الحاسمَ سلوكيٌّ لا
//      نصّيٌّ: خطوةُ CI تُقايسُ `/tmp` قبلَ الاختباراتِ وبعدَها وتَكشِفُ ما بقيَ
//      **بأيِّ اسمٍ كانَ**.
//   2. لا يَبلغُ ما تُنشئُه **عمليّةٌ فرعيّةٌ** يُشعِلُها اختبارٌ — تلكَ أيضاً
//      يَكشِفُها قياسُ `/tmp` في CI لا هذا الحاجزُ.
//   3. نطاقُه `tests/` وحدَه: هو موضعُ العَطَبِ المقيسِ. وجذورُ `src/` و`scripts/`
//      تَعيشُ في مسارِ الإنتاجِ وتُقاسُ بحُرّاسِها، فتوسيعُ النطاقِ هنا يُنتِجُ
//      ضجيجاً لا يُقابلُهُ عَطَبٌ مقيسٌ.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import { listTrackedFiles } from './lib/git-files.mjs';

const rootIndex = process.argv.indexOf('--root');
const repoRoot = rootIndex === -1 ? process.cwd() : (process.argv[rootIndex + 1] ?? process.cwd());

const HELPER = 'tests/helpers/tmp-roots.mjs';
const CREATOR = /\b(?:[A-Za-z_$][\w$]*\.)?mkdtempSync\s*\(/g;
const WRAPPER = 'registerTmpRoot(';

/** @type {string[]} */
const violations = [];

/**
 * رقمُ السطرِ لموضعٍ في نصٍّ — ليكونَ الإبلاغُ `ملفّ:سطر` يُفتَحُ لا وصفاً عامّاً.
 *
 * @param {string} text النصُّ الكاملُ.
 * @param {number} index موضعُ المِحرفِ.
 * @returns {number} رقمُ السطرِ مبدوءاً بواحدٍ.
 */
function lineOf(text, index) {
  let line = 1;
  for (let i = 0; i < index && i < text.length; i += 1) if (text[i] === '\n') line += 1;
  return line;
}

/**
 * هل موضعُ الإنشاءِ مُغلَّفٌ بـ`registerTmpRoot(` مباشرةً قبلَه؟ يُقاسُ نصّاً
 * بتجاهُلِ الفراغِ، فالمُنسِّقُ قد يَكسِرُ السطرَ بينَ الغلافِ والنداءِ.
 *
 * @param {string} text نصُّ الملفِّ.
 * @param {number} start موضعُ بدايةِ نداءِ الإنشاءِ.
 * @returns {boolean}
 */
function isWrapped(text, start) {
  let i = start - 1;
  while (i >= 0 && /\s/.test(String(text[i]))) i -= 1;
  return text.slice(Math.max(0, i + 1 - WRAPPER.length), i + 1) === WRAPPER;
}

try {
  // R3: المُعِينُ قائمٌ وعاملٌ — لا اسمٌ مُفرَّغٌ من عملِه.
  let helperText = '';
  try {
    helperText = readFileSync(path.join(repoRoot, HELPER), 'utf8');
  } catch {
    violations.push(
      `R3: \`${HELPER}\` لا يُقرأُ — ومُعِينٌ غائبٌ يَجعلُ كلَّ تغليفٍ في الاختباراتِ وعداً بلا مُنفِّذٍ.`,
    );
  }
  if (helperText !== '') {
    if (!/process\.on\(\s*'exit'/.test(helperText)) {
      violations.push(
        `R3: \`${HELPER}\` لا يُركِّبُ \`process.on('exit', …)\` — فالتسجيلُ يقعُ والمحوُ لا يقعُ، وهذا أسوأُ من لا حاجزٍ لأنّه يَطمْئنُ بلا سببٍ.`,
      );
    }
    if (!/\brmSync\s*\(/.test(helperText)) {
      violations.push(`R3: \`${HELPER}\` لا يَمحو بـ\`rmSync\` — فلا محوَ أصلاً.`);
    }
  }

  // R1: كلُّ موضعِ إنشاءٍ مُدبَّرُ المحوِ.
  const files = listTrackedFiles({ cwd: repoRoot, args: ['tests'] }).filter((entry) =>
    entry.endsWith('.mjs'),
  );
  let created = 0;
  let scanned = 0;
  for (const relative of files) {
    let text = '';
    try {
      text = readFileSync(path.join(repoRoot, relative), 'utf8');
    } catch (error) {
      violations.push(
        `R1: \`${relative}\` متعقَّبٌ ولا يُقرأُ: ${error instanceof Error ? error.message : String(error)}`,
      );
      continue;
    }
    scanned += 1;
    const fileHasRm = /\brmSync\s*\(/.test(text);
    CREATOR.lastIndex = 0;
    for (const match of text.matchAll(CREATOR)) {
      created += 1;
      const start = Number(match.index);
      if (fileHasRm || isWrapped(text, start)) continue;
      violations.push(
        `R1: \`${relative}:${lineOf(text, start)}\` يُنشئُ جذراً مؤقّتاً ولا يُدبِّرُ محوَهُ — لا تغليفَ بـ\`registerTmpRoot(…)\` ولا \`rmSync(\` في الملفِّ.`,
      );
    }
  }
  console.log(
    `  فُحِصَ ${scanned} ملفَّ اختبارٍ متعقَّباً، وفيها ${created} موضعَ إنشاءِ جذرٍ مؤقّتٍ.`,
  );
} catch (error) {
  violations.push(error instanceof Error ? error.message : String(error));
}

if (violations.length > 0) {
  console.error('\n❌ الحكمُ: جذرٌ مؤقّتٌ يُنشَأُ في الاختباراتِ بلا تدبيرِ محوٍ:');
  for (const violation of violations) console.error(`  • ${violation}`);
  console.error(
    '\nالإصلاحُ: غلِّفْ موضعَ الإنشاءِ ولا تَستبدِلْهُ، فلا يُمَسُّ منطقُ اختبارٍ:\n' +
      "  import { registerTmpRoot } from '../helpers/tmp-roots.mjs';\n" +
      "  const dir = registerTmpRoot(fs.mkdtempSync(path.join(os.tmpdir(), 'x-')));\n" +
      'أو أعِدْ `cleanup()` تَمحو بـ`rmSync` كما يَفعلُ العُرفُ القائمُ في سائرِ الملفّاتِ.\n' +
      '**ولا قائمةَ استثناءٍ في هذا الحاجزِ:** العدّاءُ مقيمٌ و`/tmp` عندَه `788M` فقط، وجذرٌ باقٍ اليومَ سقوطٌ بعدَ أربعةَ عشرَ يوماً بلا سببٍ ظاهرٍ.',
  );
  process.exit(1);
}

console.log(
  '✅ الحكمُ: كلُّ جذرٍ مؤقّتٍ في الاختباراتِ مُدبَّرُ المحوِ، والمُعِينُ يَمحو فعلاً عندَ الخروجِ. **وحدٌّ مُعلَنٌ: حضورُ `rmSync` قرينةٌ على مستوى الملفِّ لا برهانٌ لكلِّ جذرٍ — والقياسُ الحاسمُ سلوكيٌّ في CI بمقايسةِ `/tmp` قبلَ الاختباراتِ وبعدَها.**',
);
