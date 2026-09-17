#!/usr/bin/env node
// حاجز القوالب — M1.08
// يمنع عودة ملفات القوالب الفارغة إلى المستودع. يفشل عند أي ملف يُصنّف template
// خارج قائمة الاستثناءات المعلنة في docs/audit/template-allowlist.txt.
// الاستخدام: node scripts/guard-templates.mjs [--path <مسار>]
//
// مخرج هروب صريح: ملف يحتوي السطر `template-guard:allow` يُستثنى، ويُعدّ ويُطبع
// عدده حتى لا يكون الاستثناء صامتاً. هذا ضروري للوثائق التي **تشرح** أنماط
// الكشف نفسها (كسجل الأعمال ووثيقة التدقيق)، فذكر النمط فيها ليس قالباً.
// النمط نفسه مقصود من فاحص الأسرار `secret-scan:allow` — قاعدة واحدة في المشروع.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { classify, SKIP_DIRS } from './lib/classify.mjs';
import { listTrackedFiles } from './lib/git-files.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const args = process.argv.slice(2);
const i = args.indexOf('--path');
// تُقرأ القيمة في متغيّر أولاً: القراءة بمؤشّر قد تُرجع undefined، والفحص الصريح
// هنا هو ما يضمن أن ما يُمرَّر إلى path.resolve نصّ مؤكد لا احتمال.
const pathArg = args[i + 1];
const TARGET = path.resolve(i !== -1 && pathArg ? pathArg : ROOT);

const ALLOWLIST_FILE = path.join(ROOT, 'docs/audit/template-allowlist.txt');
const ESCAPE_MARKER = 'template-guard:allow';

function readAllowlist() {
  if (!fs.existsSync(ALLOWLIST_FILE)) return new Set();
  return new Set(
    fs
      .readFileSync(ALLOWLIST_FILE, 'utf8')
      .split(/\r?\n/)
      .map((/** @type {string} */ l) => l.trim())
      .filter((/** @type {string} */ l) => l.length > 0 && !l.startsWith('#')),
  );
}

/**
 * يمشي الشجرة مشياً عميقاً ويجمع مسارات الملفات فقط، متجاوزاً مجلدات البنية التحتية.
 * @param {string} dir - المجلد المراد فحصه
 * @param {string[]} [acc=[]] - مُجمِّع تُدفع إليه النتائج عبر الاستدعاءات المتداخلة
 * @returns {string[]} مسارات مطلقة لكل ملف تحت `dir`
 */
function walk(dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      walk(path.join(dir, e.name), acc);
    } else if (e.isFile()) {
      acc.push(path.join(dir, e.name));
    }
  }
  return acc;
}

const allow = readAllowlist();
const offenders = [];
const escaped = [];
let scanned = 0;
let allowed = 0;

for (const abs of walk(TARGET)) {
  const rel = path.relative(ROOT, abs).split(path.sep).join('/');
  scanned += 1;
  let text;
  try {
    text = fs.readFileSync(abs, 'utf8');
  } catch {
    continue; // ملف ثنائي: ليس قالباً نصياً
  }
  const { category, reason } = classify(rel, text);
  if (category !== 'template') continue;
  if (allow.has(rel)) {
    allowed += 1;
    continue;
  }
  if (text.includes(ESCAPE_MARKER)) {
    escaped.push(rel);
    continue;
  }
  offenders.push({ rel, reason });
}

// ── إذنٌ لا مأذونَ له إذنٌ متروكٌ — إغلاقُ الدَّينِ `DOC-11` ──
// **قائمةُ إذنٍ أوسعُ من واقعِها تأذنُ لما يُعادُ خلقُه باسمٍ قديمٍ**: مسارٌ مأذونٌ
// حُذِفَ ملفُّه يبقى إذناً نائماً، فإن رجعَ الملفُّ قالبياً مرَّ بلا سؤالٍ. فيُقاسُ
// الترهُّلُ: كلُّ مسارٍ في القائمةِ **موجودٌ على القرصِ ومتعقَّبٌ في Git**.
// والقراءةُ بـ`-z` لا سطراً سطراً: `git ls-files` يَهرُبُ المساراتِ غيرَ ASCII
// فيُخفيها عن كلِّ نمطٍ — وبذلك أُنتِجَ هذا الدَّينُ كاذباً في `WL-200`.
/** @type {string[]} */
const staleAllowances = [];
if (TARGET === ROOT) {
  const tracked = new Set(listTrackedFiles({ cwd: ROOT }));
  for (const rel of allow) {
    if (!fs.existsSync(path.join(ROOT, rel))) {
      staleAllowances.push(`${rel} — لا وجودَ له على القرصِ`);
    } else if (!tracked.has(rel)) {
      staleAllowances.push(`${rel} — موجودٌ وغيرُ متعقَّبٍ في Git`);
    }
  }
}

console.log('═══ حاجز القوالب (M1.08) ═══');
console.log(`ملفات مفحوصة: ${scanned}`);
console.log(`استثناءات معلنة ومطابقة: ${allowed}`);
if (escaped.length > 0) {
  console.log(`ملفات بمخرج هروب معلَن (${ESCAPE_MARKER}): ${escaped.length}`);
  for (const e of escaped) console.log(`  · ${e}`);
}
console.log(`مداخل إذنٍ متروكة (لا ملفَّ لها أو غير متعقَّبة): ${staleAllowances.length}`);
console.log(`مخالفات: ${offenders.length}`);

if (staleAllowances.length > 0) {
  console.error('\n❌ قائمة الإذن أوسع من واقعها — إذنٌ نائم يأذن لما يُعاد خلقه باسم قديم:');
  for (const stale of staleAllowances) console.error(`  - ${stale}`);
  console.error(
    '\nالعلاج: قلِّم docs/audit/template-allowlist.txt إلى ما هو على القرص ومتعقَّب، وسجِّل التقليم في مُدخلة سجلٍّ.',
  );
  process.exit(1);
}

if (offenders.length > 0) {
  console.error('\n❌ ملفات قالبية فارغة ممنوعة في المستودع:');
  for (const o of offenders.slice(0, 60)) console.error(`  - ${o.rel} — ${o.reason}`);
  if (offenders.length > 60) console.error(`  … و${offenders.length - 60} ملفاً آخر`);
  console.error(
    `\nالعلاج: احذف الملف، أو املأه بمحتوى فعلي، أو أضف مساره صراحةً إلى docs/audit/template-allowlist.txt مع تعليق يشرح السبب.\nوإن كان الملف وثيقة تشرح أنماط الكشف نفسها فأضف فيه السطر: ${ESCAPE_MARKER}`,
  );
  process.exit(1);
}
console.log('\n✅ لا ملفات قالبية فارغة في المستودع.');
