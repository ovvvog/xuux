#!/usr/bin/env node
// حاجز القوالب — M1.08
// يمنع عودة ملفات القوالب الفارغة إلى المستودع. يفشل عند أي ملف يُصنّف template
// خارج قائمة الاستثناءات المعلنة في docs/audit/template-allowlist.txt.
// الاستخدام: node scripts/guard-templates.mjs [--path <مسار>]

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { classify, SKIP_DIRS } from './lib/classify.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const args = process.argv.slice(2);
const i = args.indexOf('--path');
const TARGET = path.resolve(i !== -1 && args[i + 1] ? args[i + 1] : ROOT);

const ALLOWLIST_FILE = path.join(ROOT, 'docs/audit/template-allowlist.txt');

function readAllowlist() {
  if (!fs.existsSync(ALLOWLIST_FILE)) return new Set();
  return new Set(
    fs
      .readFileSync(ALLOWLIST_FILE, 'utf8')
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && !l.startsWith('#')),
  );
}

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
  offenders.push({ rel, reason });
}

console.log('═══ حاجز القوالب (M1.08) ═══');
console.log(`ملفات مفحوصة: ${scanned}`);
console.log(`استثناءات معلنة ومطابقة: ${allowed}`);
console.log(`مخالفات: ${offenders.length}`);

if (offenders.length > 0) {
  console.error('\n❌ ملفات قالبية فارغة ممنوعة في المستودع:');
  for (const o of offenders.slice(0, 60)) console.error(`  - ${o.rel} — ${o.reason}`);
  if (offenders.length > 60) console.error(`  … و${offenders.length - 60} ملفاً آخر`);
  console.error(
    '\nالعلاج: احذف الملف، أو املأه بمحتوى فعلي، أو أضف مساره صراحةً إلى docs/audit/template-allowlist.txt مع تعليق يشرح السبب.',
  );
  process.exit(1);
}
console.log('\n✅ لا ملفات قالبية فارغة في المستودع.');
