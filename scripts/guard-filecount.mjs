#!/usr/bin/env node
// حاجز عدد الملفات — بوابة G1
//
// المرجع: docs/roadmap/03-roadmap-to-100.md — البوابة G1.
// السبب: المستودع كان يحوي 33,456 ملفاً، 99.77% منها قوالب فارغة. بعد
// تصفية M1 صار 201 ملفاً. هذا الحاجز يمنع عودة الانتفاخ: أي نمو يجب أن
// يكون نمواً في محتوى حقيقي، لا في عُقد فارغة مولَّدة.
//
// الحد ليس رقماً تعسفياً: 3,000 هو ما نصّت عليه البوابة G1، وهو أكبر من
// العدد الحالي بخمسة عشر ضعفاً — أي أنه لا يعيق أي بناء حقيقي متوقّع في
// المسارات M2–M11، ويصرخ فقط إذا عاد أحدهم إلى توليد شجرة قوالب.
//
// عند الحاجة إلى رفع الحد: يُرفع بقرار موثّق في سجل WL مع بيان السبب،
// لا بتعديل صامت لهذا الملف.

import fs from 'node:fs';
import path from 'node:path';

const LIMIT = Number(process.env.FILE_COUNT_LIMIT ?? 3000);
// الوسيط يُقرأ في متغيّر ثم يُفحص صراحةً: `--root` قد يُمرَّر بلا قيمة بعده،
// وحينها تكون القراءة بمؤشّر undefined، فالسقوط إلى مجلد العمل هو السلوك الصحيح.
const rootArg = process.argv.includes('--root')
  ? process.argv[process.argv.indexOf('--root') + 1]
  : undefined;
const ROOT = rootArg ?? process.cwd();

const SKIP = new Set(['.git', 'node_modules', 'dist', 'coverage', '.next']);

/**
 * يعدّ الملفات المتعقَّبة فعلياً، ويستثني ما لا يُلتزم في Git.
 * @param {string} dir
 * @returns {number}
 */
function countFiles(dir) {
  let n = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) n += countFiles(abs);
    else if (entry.isFile()) n += 1;
  }
  return n;
}

const total = countFiles(ROOT);
const pct = ((total / LIMIT) * 100).toFixed(1);

console.log('═══ حاجز عدد الملفات (البوابة G1) ═══');
console.log(`الجذر المفحوص: ${ROOT}`);
console.log(`عدد الملفات:   ${total}`);
console.log(`الحد المسموح:  ${LIMIT}  (الاستهلاك: ${pct}%)`);

if (total > LIMIT) {
  console.error('');
  console.error(`❌ البوابة G1 مغلقة: ${total} ملفاً يتجاوز الحد ${LIMIT}.`);
  console.error('   إن كان النمو محتوى حقيقياً فارفع الحد بقرار موثّق في سجل WL.');
  console.error(
    '   وإن كان قوالب مولَّدة فهذا ارتداد — راجع docs/roadmap/03-roadmap-to-100.md §M1.',
  );
  process.exit(1);
}

console.log('');
console.log('✅ البوابة G1 مفتوحة: حجم المستودع تحت الحد.');
