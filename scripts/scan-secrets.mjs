#!/usr/bin/env node
// فحص الأسرار — المسار M0.08
//
// الغرض:      يمنع دفع أي مفتاح أو توكن أو كلمة سر إلى المستودع (المادة 7 من القاعدة الحاكمة).
// المدخلات:   ملفات المستودع النصية (يتخطى الثنائي والمستثنى).
// المخرجات:   0 إذا لم يُعثر على شيء، و1 مع تقرير عند العثور على مادة سرية.
// التشغيل:    node scripts/scan-secrets.mjs [--path <مسار>]
// الاختبار:   node --test tests/tooling/scan-secrets.test.mjs
// الصلاحيات:  قراءة فقط. لا يمرّ ببوابة التاج.
// المالك:     مسؤول بنية البناء.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, extname, basename } from 'node:path';

/** أنماط المواد السرية. كل نمط له معرّف وسبب حتى يكون التقرير مفهومًا. */
export const PATTERNS = [
  {
    id: 'GITHUB_PAT_CLASSIC',
    reason: 'توكن GitHub شخصي (النمط القديم)',
    re: /ghp_[A-Za-z0-9]{36}/,
  },
  {
    id: 'GITHUB_PAT_FINE_GRAINED',
    reason: 'توكن GitHub دقيق الصلاحيات',
    re: /github_pat_[A-Za-z0-9_]{60,}/,
  },
  {
    id: 'GITHUB_OTHER_TOKEN',
    reason: 'توكن GitHub (تطبيق أو تحديث أو خادم)',
    re: /gh[ousr]_[A-Za-z0-9]{36}/,
  },
  {
    id: 'PRIVATE_KEY_BLOCK',
    reason: 'كتلة مفتاح خاص — سقوط جذر الثقة',
    re: /-----BEGIN(?: [A-Z]+)? PRIVATE KEY-----/,
  },
  {
    id: 'AWS_ACCESS_KEY_ID',
    reason: 'معرّف مفتاح وصول AWS',
    re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/,
  },
  {
    id: 'AWS_SECRET_ACCESS_KEY',
    reason: 'مفتاح AWS السري',
    re: /aws_secret_access_key\s*[=:]\s*['"]?[A-Za-z0-9/+=]{40}/i,
  },
  {
    id: 'SLACK_TOKEN',
    reason: 'توكن Slack',
    re: /xox[abprs]-[A-Za-z0-9-]{10,}/,
  },
  {
    id: 'OPENAI_KEY',
    reason: 'مفتاح واجهة OpenAI',
    re: /\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}\b/,
  },
  {
    id: 'GOOGLE_API_KEY',
    reason: 'مفتاح واجهة Google',
    re: /\bAIza[0-9A-Za-z_-]{35}\b/,
  },
  {
    id: 'JWT',
    reason: 'رمز JWT مكتمل',
    re: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/,
  },
  {
    id: 'GENERIC_SECRET_ASSIGNMENT',
    reason: 'إسناد سر بقيمة حرفية طويلة',
    re: /\b(?:secret|password|passwd|api[_-]?key|access[_-]?token|auth[_-]?token|private[_-]?key)\b\s*[=:]\s*['"][^'"\s]{20,}['"]/i,
  },
  {
    id: 'CONNECTION_STRING_WITH_PASSWORD',
    reason: 'سلسلة اتصال تحتوي كلمة سر',
    re: /\b(?:postgres|postgresql|mysql|mongodb(?:\+srv)?|redis|amqp):\/\/[^:@\s/]+:[^@\s/]{6,}@/i,
  },
];

/** مسارات لا تُفحص: تبعيات وبناء وثنائيات وهذا الملف نفسه (فيه الأنماط). */
const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  'coverage',
  '.cache',
  'tmp',
  '.tmp',
]);

const SKIP_FILES = new Set(['package-lock.json', 'scan-secrets.mjs', 'scan-secrets.test.mjs']);

const BINARY_EXT = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.ico',
  '.pdf',
  '.zip',
  '.gz',
  '.tar',
  '.woff',
  '.woff2',
  '.ttf',
  '.eot',
  '.mp4',
  '.mp3',
  '.wasm',
  '.node',
]);

/** امتدادات ملفات المفاتيح: وجودها في المستودع مخالفة بذاتها. */
const FORBIDDEN_EXT = new Set(['.pem', '.key', '.p12', '.pfx', '.keystore', '.jks']);

const MAX_BYTES = 2 * 1024 * 1024; // الوثائق الكبيرة تُفحص حتى هذا الحد

/**
 * مخالفة واحدة: الملف والسطر ومعرّف النمط وسببه ومقتطف محجوب.
 * يُسمّى النوع مرة واحدة هنا لأنه عقد مشترك بين الفحص النصي وفحص المستودع
 * والاختبارات، فلا يُعاد وصف شكله في كل موضع.
 * @typedef {{ file: string, line: number, id: string, reason: string, excerpt: string }} Finding
 */

/**
 * يفحص نصًا واحدًا ويعيد قائمة المخالفات.
 * @param {string} text - النص المفحوص
 * @param {string} [label='<نص>'] - اسم يُنسب إليه الاكتشاف في التقرير
 * @returns {Finding[]}
 */
export function scanText(text, label = '<نص>') {
  /** @type {Finding[]} */
  const findings = [];
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? '';
    // سطر مُعلَّم صراحةً كمثال غير حقيقي يُتجاوز، ليبقى التوثيق ممكنًا
    if (line.includes('secret-scan:allow')) continue;
    for (const p of PATTERNS) {
      const m = p.re.exec(line);
      if (m) {
        findings.push({
          file: label,
          line: i + 1,
          id: p.id,
          reason: p.reason,
          excerpt: redact(m[0]),
        });
      }
    }
  }
  return findings;
}

/**
 * يحجب وسط المطابقة حتى لا يُطبع السر في السجلات.
 * @param {string} value - النص المطابِق كما وُجد في الملف
 * @returns {string} نصّ محجوب يُظهر أربعة أحرف من كل طرف فقط
 */
export function redact(value) {
  if (value.length <= 10) return '*'.repeat(value.length);
  return `${value.slice(0, 4)}${'*'.repeat(Math.min(24, value.length - 8))}${value.slice(-4)}`;
}

/**
 * يجمع الملفات القابلة للفحص تحت جذر معيّن.
 * @param {string} root - الجذر المراد فحصه
 * @returns {string[]} مسارات مطلقة لكل ملف قابل للفحص
 */
export function collectFiles(root) {
  /** @type {string[]} */
  const out = [];
  /** @param {string} dir */
  const walk = (dir) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return; // مجلد غير مقروء: يُسجَّل بالتجاوز لا بالفشل الصامت للمحتوى
    }
    for (const e of entries) {
      const full = join(dir, e.name);
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name)) continue;
        walk(full);
      } else if (e.isFile()) {
        out.push(full);
      }
    }
  };
  walk(root);
  return out;
}

/**
 * الفحص الكامل لمستودع.
 * @param {string} root - جذر المستودع
 * @returns {Finding[]} كل المطابقات المشتبهة بعد استثناء ما أُعلن تجاوزه
 */
export function scanRepository(root) {
  /** @type {Finding[]} */
  const findings = [];
  for (const file of collectFiles(root)) {
    const rel = relative(root, file);
    const ext = extname(file).toLowerCase();

    if (FORBIDDEN_EXT.has(ext)) {
      findings.push({
        file: rel,
        line: 0,
        id: 'FORBIDDEN_KEY_FILE',
        reason: `ملف بامتداد مواد مفاتيح (${ext}) لا يجوز وجوده في المستودع`,
        excerpt: basename(file),
      });
      continue;
    }
    if (SKIP_FILES.has(basename(file)) || BINARY_EXT.has(ext)) continue;

    let size;
    try {
      size = statSync(file).size;
    } catch {
      continue;
    }
    if (size > MAX_BYTES) continue;

    let text;
    try {
      text = readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    if (text.includes('\u0000')) continue; // ثنائي

    findings.push(...scanText(text, rel));
  }
  return findings;
}

// ── التشغيل من سطر الأوامر ──
const isMain = process.argv[1] && import.meta.url.endsWith(basename(process.argv[1]));
if (isMain) {
  const idx = process.argv.indexOf('--path');
  const root = idx !== -1 ? (process.argv[idx + 1] ?? '.') : '.';
  const findings = scanRepository(root);

  if (findings.length === 0) {
    console.log('✅ فحص الأسرار: لا مادة سرية مكتشفة.');
    process.exit(0);
  }

  console.error(`⛔ فحص الأسرار: ${findings.length} مخالفة.\n`);
  for (const f of findings) {
    console.error(`  ${f.file}:${f.line}  [${f.id}]  ${f.reason}`);
    console.error(`      المقتطف المحجوب: ${f.excerpt}`);
  }
  console.error(
    '\nالمطلوب: أزل المادة السرية من الملف ومن تاريخ Git، وأبطل المفتاح المكشوف وأصدر غيره.',
  );
  console.error('إن كان المقتطف مثالًا توثيقيًا لا سرًا، أضف في نهاية السطر: secret-scan:allow');
  process.exit(1);
}
