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
const getArg = (name, fallback) => {
  const i = args.indexOf(name);
  return i !== -1 && args[i + 1] ? args[i + 1] : fallback;
};
const ROOT = path.resolve(getArg('--root', '.'));
const OUT = path.resolve(getArg('--out', 'docs/audit/file-inventory.csv'));

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

const csvCell = (v) => {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

const files = walk(ROOT).sort();
const rows = [];
const counts = { real: 0, data: 0, doc: 0, template: 0 };
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
  const e = byExt.get(ext);
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
  const byRoot = new Map();
  for (const r of rows) {
    const root = r[0].includes('/') ? r[0].split('/')[0] : '(الجذر)';
    if (!byRoot.has(root)) byRoot.set(root, { real: 0, data: 0, doc: 0, template: 0, total: 0 });
    const e = byRoot.get(root);
    e[r[5]] += 1;
    e.total += 1;
  }
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
  for (const k of ['real', 'data', 'doc', 'template']) {
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
