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
import { execFileSync } from 'node:child_process';

const LIMIT = Number(process.env.FILE_COUNT_LIMIT ?? 3000);
// الوسيط يُقرأ في متغيّر ثم يُفحص صراحةً: `--root` قد يُمرَّر بلا قيمة بعده،
// وحينها تكون القراءة بمؤشّر undefined، فالسقوط إلى مجلد العمل هو السلوك الصحيح.
const rootArg = process.argv.includes('--root')
  ? process.argv[process.argv.indexOf('--root') + 1]
  : undefined;
const ROOT = rootArg ?? process.cwd();

const SKIP = new Set(['.git', 'node_modules', 'dist', 'coverage', '.next']);

/**
 * يعدّ ما يتعقّبه Git فعلاً. صُحّح في M2.01: كان الترويسة تَدّعي عدّ المتعقَّب
 * بينما التنفيذ يمشي على نظام الملفات، فيَعُدّ المولَّد والمتجاهَل معه. صار
 * ناتج خطوة البناء يقع بجوار المصادر داخل src/root-of-trust، فبقاء الخلل
 * يعني تضخيم العدد بملفات لا تدخل المستودع أصلاً.
 * @param {string} dir
 * @returns {number | null} العدد، أو `null` إن لم يكن المسار مستودع Git
 */
function countTrackedFiles(dir) {
  try {
    const out = execFileSync('git', ['-C', dir, 'ls-files', '--cached', '--exclude-standard'], {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });
    return out.split('\n').filter(Boolean).length;
  } catch {
    // لا مستودع Git (أرشيف منسوخ مثلاً): يسقط النداء إلى مسح نظام الملفات.
    return null;
  }
}

/**
 * يعدّ ملفات الشجرة على نظام الملفات — بديل احتياطي حين لا يتوفر Git.
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

const tracked = countTrackedFiles(ROOT);
const total = tracked ?? countFiles(ROOT);
const basis = tracked === null ? 'مسح نظام الملفات (لا مستودع Git)' : 'ملفات Git المتعقَّبة';
const pct = ((total / LIMIT) * 100).toFixed(1);

console.log('═══ حاجز عدد الملفات (البوابة G1) ═══');
console.log(`الجذر المفحوص: ${ROOT}`);
console.log(`أساس العدّ:    ${basis}`);
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
