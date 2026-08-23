#!/usr/bin/env node
// أداة الجرد الآلي — M1.01
// الغرض: تصنيف كل ملف في شجرة المستودع إلى أربع فئات حصرية:
//   real     = كود قابل للتنفيذ فيه منطق فعلي
//   data     = بيانات/إعدادات فيها قيم فعلية (لا تعليقات فقط)
//   doc      = وثيقة يقرأها إنسان
//   template = ملف لا يحتوي إلا تعليقات/عبارات قالبية مولّدة
// الاستخدام: node scripts/inventory.mjs [--root <مسار>] [--out <ملف csv>]
// المخرجات: CSV + ملخّص على stdout. رمز الخروج 1 إذا لم يساوِ مجموع الفئات إجمالي الملفات.

import fs from 'node:fs';
import path from 'node:path';
import { classify, substantiveLines, SKIP_DIRS } from './lib/classify.mjs';

const args = process.argv.slice(2);
/**
 * يقرأ وسيط سطر أوامر بصيغة `--name value`، ويسقط إلى قيمة افتراضية.
 * @param {string} name - اسم الوسيط كما يُكتب في السطر، مع الشرطتين
 * @param {string} fallback - القيمة المستخدمة إن غاب الوسيط أو جاء بلا قيمة بعده
 * @returns {string}
 */
const getArg = (name, fallback) => {
  const i = args.indexOf(name);
  const value = args[i + 1];
  return i !== -1 && value ? value : fallback;
};
const ROOT = path.resolve(getArg('--root', '.'));
const OUT = path.resolve(getArg('--out', 'docs/audit/file-inventory.csv'));

/**
 * يمشي الشجرة مشياً عميقاً ويجمع مسارات الملفات فقط، متجاوزاً مجلدات البنية التحتية.
 * @param {string} dir - المجلد المراد فحصه
 * @param {string[]} [acc=[]] - مُجمِّع تُدفع إليه النتائج عبر الاستدعاءات المتداخلة
 * @returns {string[]} مسارات مطلقة لكل ملف تحت `dir`
 */
function walk(dir, acc = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walk(path.join(dir, entry.name), acc);
    } else if (entry.isFile()) {
      acc.push(path.join(dir, entry.name));
    }
  }
  return acc;
}

/**
 * يُهرّب خلية CSV: يُحيط بعلامتي تنصيص ويُضاعف التنصيص الداخلي عند وجود فاصلة أو سطر جديد.
 * @param {string | number} v - القيمة الخام
 * @returns {string}
 */
const csvCell = (v) => {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/**
 * فئات التصنيف الأربع، مستوردة من مصدر الحقيقة الواحد في منطق التصنيف.
 * @typedef {import('./lib/classify.mjs').FileCategory} FileCategory
 */

/**
 * عدّاد لكل فئة، يُستخدم للإجمالي وللتوزيع حسب الامتداد وحسب المجلد الجذري.
 * @typedef {{ real: number, data: number, doc: number, template: number }} CategoryCounts
 */

/**
 * عدّاد فئات مع مجموع، للتوزيعات الفرعية.
 * @typedef {CategoryCounts & { total: number }} CountsWithTotal
 */

/**
 * صف الجرد كصفّ ثابت الترتيب — هو نفسه ترتيب أعمدة CSV المعلَن في `header`.
 * إعلانه كصفّ ثابت (لا كمصفوفة فضفاضة) هو ما يجعل الفاحص يعرف أن العمود 0 نصّ
 * والعمود 5 فئة تصنيف، فلا تُقرأ الأعمدة بأنواع خاطئة عند بناء الملخّص.
 * @typedef {[string, string, number, number, number, FileCategory, string]} InventoryRow
 */

const files = walk(ROOT).sort();
/** @type {InventoryRow[]} */
const rows = [];
/** @type {CategoryCounts} */
const counts = { real: 0, data: 0, doc: 0, template: 0 };
/** @type {Map<string, CountsWithTotal>} */
const byExt = new Map();

for (const abs of files) {
  const rel = path.relative(ROOT, abs).split(path.sep).join('/');
  const stat = fs.statSync(abs);
  let text;
  try {
    text = fs.readFileSync(abs, 'utf8');
  } catch {
    text = '';
  }
  const lines = text.length === 0 ? 0 : text.split(/\r?\n/).length;
  const ext = path.extname(rel).toLowerCase() || '(بلا امتداد)';
  const { category, reason } = classify(rel, text);
  counts[category] += 1;
  if (!byExt.has(ext)) byExt.set(ext, { real: 0, data: 0, doc: 0, template: 0, total: 0 });
  // الغياب مستحيل: السطر السابق يضمن وجود المفتاح، والفحص الصريح هنا هو ما
  // يُثبت ذلك للفاحص بلا افتراض.
  const e = byExt.get(ext);
  if (e === undefined) throw new Error(`EXT_COUNTER_MISSING: ${ext}`);
  e[category] += 1;
  e.total += 1;
  rows.push([
    rel,
    ext,
    stat.size,
    lines,
    substantiveLines(text, path.extname(rel)).length,
    category,
    reason,
  ]);
}

fs.mkdirSync(path.dirname(OUT), { recursive: true });
const header = 'path,ext,bytes,lines,substantive_lines,category,reason';
fs.writeFileSync(
  OUT,
  header + '\n' + rows.map((r) => r.map(csvCell).join(',')).join('\n') + '\n',
  'utf8',
);

const total = files.length;
const sum = counts.real + counts.data + counts.doc + counts.template;

console.log('═══ جرد ملفات المستودع (M1.01) ═══');
console.log(`الجذر المفحوص: ${ROOT}`);
console.log(`إجمالي الملفات: ${total}`);
console.log(`  real     (كود فيه منطق): ${counts.real}`);
console.log(`  data     (بيانات فعلية): ${counts.data}`);
console.log(`  doc      (وثيقة بشرية): ${counts.doc}`);
console.log(`  template (قالب فارغ):   ${counts.template}`);
console.log(`مجموع الفئات: ${sum} ${sum === total ? '✅ مطابق' : '❌ غير مطابق'}`);
console.log(`نسبة القوالب: ${((counts.template / total) * 100).toFixed(2)}%`);
console.log('\n─── التوزيع حسب الامتداد ───');
const sorted = [...byExt.entries()].sort((a, b) => b[1].total - a[1].total);
console.log(
  'الامتداد'.padEnd(14) +
    'الإجمالي'.padEnd(10) +
    'real'.padEnd(8) +
    'data'.padEnd(8) +
    'doc'.padEnd(8) +
    'template',
);
for (const [ext, e] of sorted) {
  console.log(
    ext.padEnd(14) +
      String(e.total).padEnd(10) +
      String(e.real).padEnd(8) +
      String(e.data).padEnd(8) +
      String(e.doc).padEnd(8) +
      String(e.template),
  );
}
console.log(`\nملف الجرد: ${OUT}`);

// ═══ ملخّص markdown يُلتزم في المستودع (CSV الكامل يُعاد توليده بالأمر) ═══
const SUMMARY = getArg('--summary', '');
if (SUMMARY) {
  /** @type {Map<string, CountsWithTotal>} */
  const byRoot = new Map();
  for (const row of rows) {
    const rel = row[0];
    // المجلد الجذري هو ما قبل أول شرطة مائلة؛ وإن لم توجد فالملف في جذر المستودع.
    const root = rel.includes('/') ? (rel.split('/')[0] ?? '(الجذر)') : '(الجذر)';
    if (!byRoot.has(root)) byRoot.set(root, { real: 0, data: 0, doc: 0, template: 0, total: 0 });
    const e = byRoot.get(root);
    if (e === undefined) throw new Error(`ROOT_COUNTER_MISSING: ${root}`);
    e[row[5]] += 1;
    e.total += 1;
  }
  /** @type {string[]} */
  const M = [];
  M.push('# جرد ملفات المستودع');
  M.push('');
  M.push('> ⚠️ ملف مولّد آلياً بـ `node scripts/inventory.mjs --summary <ملف>`. لا تحرّره يدوياً.');
  M.push('');
  M.push(
    'التصنيف بالمحتوى لا بالاسم: تُحذف التعليقات والأسطر الفارغة، فما بقي هو المحتوى الجوهري.',
  );
  M.push('');
  M.push('| الفئة | العدد | النسبة |');
  M.push('| --- | --- | --- |');
  // النوع معلَن صراحةً حتى تكون قراءة العدّاد بمفتاح من الفئات الأربع فقط،
  // فلا يمكن قراءته بمفتاح نصي فضفاض لا وجود له.
  /** @type {import('./lib/classify.mjs').FileCategory[]} */
  const categories = ['real', 'data', 'doc', 'template'];
  for (const k of categories) {
    M.push(`| \`${k}\` | ${counts[k]} | ${((counts[k] / total) * 100).toFixed(2)}% |`);
  }
  M.push(`| **المجموع** | **${total}** | 100% |`);
  M.push('');
  M.push('## التوزيع حسب الامتداد');
  M.push('');
  M.push('| الامتداد | المجموع | real | data | doc | template |');
  M.push('| --- | --- | --- | --- | --- | --- |');
  for (const [ext, e] of sorted) {
    M.push(`| \`${ext}\` | ${e.total} | ${e.real} | ${e.data} | ${e.doc} | ${e.template} |`);
  }
  M.push('');
  M.push('## التوزيع حسب مجلد الجذر');
  M.push('');
  M.push('| المجلد | المجموع | real | data | doc | template |');
  M.push('| --- | --- | --- | --- | --- | --- |');
  for (const [root, e] of [...byRoot.entries()].sort((a, b) => b[1].total - a[1].total)) {
    M.push(`| \`${root}\` | ${e.total} | ${e.real} | ${e.data} | ${e.doc} | ${e.template} |`);
  }
  M.push('');
  M.push('## الملفات الجوهرية كاملة (غير القالبية)');
  M.push('');
  M.push('| الملف | الفئة | بايت | أسطر جوهرية |');
  M.push('| --- | --- | --- | --- |');
  for (const r of rows.filter((x) => x[5] !== 'template')) {
    M.push(`| \`${r[0]}\` | ${r[5]} | ${r[2]} | ${r[4]} |`);
  }
  M.push('');
  fs.mkdirSync(path.dirname(path.resolve(SUMMARY)), { recursive: true });
  fs.writeFileSync(path.resolve(SUMMARY), M.join('\n'), 'utf8');
  console.log(`ملخّص الجرد: ${SUMMARY}`);
}

if (sum !== total) {
  console.error('\n❌ فشل معيار القبول: مجموع الفئات لا يساوي إجمالي الملفات.');
  process.exit(1);
}
