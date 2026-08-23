#!/usr/bin/env node
// فحص مادة المفاتيح الخاصة — الخطوة M2.03 (الفجوة G1)
//
// الغرض:      يفشل عند اكتشاف مادة مفتاح خاص في أي مسار: في المستودع أو على
//             قرص الخدمة. هو الدليل الآلي لمعيار M2.03، لا وعدٌ في وثيقة.
// المدخلات:   مسار أو أكثر (--path يتكرر). الافتراضي: المستودع ومسارات
//             التشغيل المعلَنة أدناه إن وُجدت.
// المخرجات:   0 إذا لم توجد مخالفة، و1 مع تقرير محجوب عند وجودها.
// التشغيل:    node scripts/scan-private-keys.mjs [--path <مسار>]... [--production]
// الاختبار:   node --test tests/tooling/scan-private-keys.test.mjs
// الصلاحيات:  قراءة فقط. لا يمرّ ببوابة التاج.
// المالك:     مسؤول جذر الثقة.
//
// لماذا فاحص ثانٍ مع وجود scan-secrets؟ لأن سؤالهما مختلف: الأول يمنع دفع
// **سرّ** إلى المستودع، وهذا يمنع **إقامة مادة مفتاح خاص** في أي مسار يقرأه
// جذر الثقة — ومنه قرص الخدمة الذي لا يدخل Git أصلاً فلا يراه الأول. وأدوات
// القراءة والحجب مشتركة بينهما (تُستورد من الأول) فلا تنفيذان للحجب يتفارقان.

import { existsSync, readFileSync, statSync } from 'node:fs';
import { basename, extname, relative, resolve } from 'node:path';
import { collectFiles, redact } from './scan-secrets.mjs';

// الأنماط تُركَّب من قِطع لأن كتابة رأس PEM كاملاً في ملف الفاحص يجعله يُبلّغ
// عن نفسه. والتركيب هنا ليس تحايلاً على الفاحص: هذا الملف مستثنى صراحةً أدناه،
// والتركيب يبقي الأنماط مقروءة لمن يراجعها.
const B = '-----BEGIN';
const PK = 'PRIVATE KEY-----';

/**
 * كاشف واحد: معرّف وسبب وتعبير ودرجة خطورة.
 * الخطورة `error` تُفشل الفحص دائماً، و`production` تُفشله في وضع الإنتاج فقط.
 * @typedef {{ id: string, reason: string, re: RegExp, severity: 'error' | 'production' }} Detector
 */

/** @type {Detector[]} */
export const DETECTORS = [
  {
    id: 'PEM_PRIVATE_KEY',
    reason: 'كتلة مفتاح خاص بترميز PEM',
    re: new RegExp(`${B}(?: [A-Z0-9]+)? ${PK}`),
    severity: 'error',
  },
  {
    id: 'OPENSSH_PRIVATE_KEY',
    reason: 'مفتاح OpenSSH خاص',
    re: new RegExp(`${B} OPENSSH ${PK}`),
    severity: 'error',
  },
  {
    id: 'PKCS8_ED25519_DER',
    reason: 'مفتاح Ed25519 خاص بترميز PKCS8 مُصمَّت (base64) — رأس معروف',
    re: /MC4CAQAwBQYDK2Vw/,
    severity: 'error',
  },
  {
    // رؤوس base64 دقيقة لا تخمينية: كل واحد منها هو ترميز رأس DER لنوع مفتاح
    // خاص بعينه. التخمين بأنماط فضفاضة على كتل base64 كان يُنتج إنذارات كاذبة
    // على كل تجزئة وتوقيع في المستودع، وفاحصٌ يصيح كذباً يُعطَّل بعد أسبوع.
    id: 'DER_PRIVATE_KEY_HEADER',
    reason: 'مفتاح خاص بترميز DER مُصمَّت (base64) — رأس نوع معروف',
    re: new RegExp(
      [
        'MII[A-Za-z0-9+/]{2,4}IBADANBgkqhkiG9w0BAQ', // RSA بترميز PKCS8
        'MII[A-Za-z0-9+/]{2,4}IBAAKCAQEA', // RSA بترميز PKCS1
        'MIGHAgEAMBMGByqGSM49', // منحنى إهليلجي بترميز PKCS8
        'MHcCAQEE[A-Za-z0-9+/]{20,}', // منحنى إهليلجي بترميز SEC1
      ].join('|'),
    ),
    severity: 'error',
  },
  {
    id: 'JWK_PRIVATE_KEY',
    reason: 'مفتاح JWK يحمل المُركّب الخاص "d"',
    // الترتيبان معاً: Node يُصدِّر JWK وفيه `kty` بعد `d`، وغيره يعكس، وحارسٌ
    // يشترط ترتيباً واحداً يمرّ عليه أشهر مُصدِّر في المشروع نفسه.
    re: /"kty"\s*:\s*"(?:OKP|EC|RSA)"[^}]{0,400}?"d"\s*:\s*"[A-Za-z0-9_-]{20,}"|"d"\s*:\s*"[A-Za-z0-9_-]{20,}"[^}]{0,400}?"kty"\s*:\s*"(?:OKP|EC|RSA)"/,
    severity: 'error',
  },
  {
    id: 'RAW_PRIVATE_MATERIAL_ASSIGNMENT',
    reason: 'إسناد مادة خاصة خامّة (بذرة أو مفتاح توقيع) بقيمة حرفية',
    re: /\b(?:private_?key|privateKey|signing_?key|signingKey|key_?seed|keySeed|ed25519_?seed)\b\s*[=:]\s*['"][A-Za-z0-9+/_=-]{40,}['"]/,
    severity: 'error',
  },
  {
    id: 'ENCRYPTED_KEY_AT_REST',
    reason:
      'مادة مفتاح مشفَّرة على القرص (شكل EncryptedKeyStore) — مقبولة للتطوير، ممنوعة في الإنتاج',
    re: /"salt"\s*:\s*"[^"]+"\s*,\s*"iv"\s*:\s*"[^"]+"\s*,\s*"tag"\s*:/,
    severity: 'production',
  },
];

/** امتدادات ملفات مواد المفاتيح: وجود الملف بذاته مخالفة، بلا قراءة محتواه. */
const FORBIDDEN_EXT = new Set(['.pem', '.key', '.p8', '.p12', '.pfx', '.keystore', '.jks', '.ppk']);

/** ملفات تحمل الأنماط بحكم وظيفتها: الفاحصان واختباراهما. */
const SKIP_FILES = new Set([
  'scan-private-keys.mjs',
  'scan-private-keys.test.mjs',
  'scan-secrets.mjs',
  'scan-secrets.test.mjs',
  'package-lock.json',
]);

const SKIP_EXT = new Set([
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
  '.mp4',
  '.mp3',
  '.wasm',
  '.node',
]);

const MAX_BYTES = 4 * 1024 * 1024;

/** علامة تجاوز سطرٍ صُرّح أنه توثيق لا مادة. */
const ALLOW_MARKER = 'private-key-scan:allow';

/**
 * مسارات التشغيل التي قد تسكن فيها مادة مفتاح على قرص الخدمة. تُفحص إن وُجدت.
 * الغرض أن الفحص لا يقتصر على ما يدخل Git: قرص الخدمة لا يدخله أصلاً، وهو
 * موضع الفجوة G1 نفسها.
 */
export const RUNTIME_PATHS = ['var', 'data', 'state', '.state', 'secrets', 'keys', '.keys'];

/** متغيّرات بيئة قد تُشير إلى مجلد مفاتيح؛ تُفحص قيمتها إن كانت موجودة. */
export const RUNTIME_ENV_VARS = ['KING_KEY_DIR', 'XUUX_KEY_DIR', 'KEY_STORE_DIR'];

/**
 * مخالفة واحدة.
 * @typedef {{ file: string, line: number, id: string, reason: string, excerpt: string, severity: 'error' | 'production' }} KeyFinding
 */

/**
 * يفحص نصاً واحداً.
 * @param {string} text - النص المفحوص
 * @param {string} [label='<نص>'] - اسم يُنسب إليه الاكتشاف
 * @returns {KeyFinding[]}
 */
export function scanTextForKeys(text, label = '<نص>') {
  /** @type {KeyFinding[]} */
  const findings = [];
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? '';
    if (line.includes(ALLOW_MARKER)) continue;
    for (const d of DETECTORS) {
      const m = d.re.exec(line);
      if (m) {
        findings.push({
          file: label,
          line: i + 1,
          id: d.id,
          reason: d.reason,
          excerpt: redact(m[0]),
          severity: d.severity,
        });
      }
    }
  }
  return findings;
}

/**
 * يفحص جذراً واحداً: كل ملف تحته، وامتداداته الممنوعة، ومحتواه النصي.
 * @param {string} root - الجذر المفحوص
 * @returns {KeyFinding[]}
 */
export function scanPathForKeys(root) {
  /** @type {KeyFinding[]} */
  const findings = [];
  if (!existsSync(root)) return findings;
  for (const file of collectFiles(root)) {
    const rel = relative(root, file) || basename(file);
    const ext = extname(file).toLowerCase();

    if (FORBIDDEN_EXT.has(ext)) {
      findings.push({
        file: rel,
        line: 0,
        id: 'FORBIDDEN_KEY_FILE',
        reason: `ملف بامتداد مواد مفاتيح (${ext}) لا يجوز وجوده في أي مسار للخدمة`,
        excerpt: basename(file),
        severity: 'error',
      });
      continue;
    }
    if (SKIP_FILES.has(basename(file)) || SKIP_EXT.has(ext)) continue;

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
    // الثنائي يُتخطى بعد فحص امتداده: المادة الخاصة تُخزَّن نصاً في كل شكل
    // يعرفه هذا المشروع (PEM أو JSON)، والبحث في الثنائي يولّد ضجيجاً لا حراسة.
    if (text.includes('\u0000')) continue;

    findings.push(...scanTextForKeys(text, rel));
  }
  return findings;
}

/**
 * يجمع الجذور المطلوبة: ما طُلب صراحة، ومسارات التشغيل المعلَنة، وما تُشير
 * إليه متغيّرات البيئة.
 * @param {string[]} explicit - مسارات مطلوبة صراحة
 * @returns {string[]} جذور موجودة فعلاً بلا تكرار
 */
export function resolveScanRoots(explicit = []) {
  const roots = explicit.length > 0 ? [...explicit] : ['.'];
  for (const p of RUNTIME_PATHS) roots.push(p);
  for (const v of RUNTIME_ENV_VARS) {
    const value = process.env[v];
    if (value) roots.push(value);
  }
  /** @type {string[]} */
  const out = [];
  for (const r of roots) {
    const abs = resolve(r);
    if (existsSync(abs) && !out.includes(abs)) out.push(abs);
  }
  return out;
}

/**
 * الفحص الكامل عبر عدة جذور.
 * @param {string[]} roots - الجذور المفحوصة
 * @returns {KeyFinding[]}
 */
export function scanAll(roots) {
  /** @type {KeyFinding[]} */
  const findings = [];
  for (const root of roots) {
    for (const f of scanPathForKeys(root)) {
      findings.push({ ...f, file: `${relative(process.cwd(), root) || '.'}/${f.file}` });
    }
  }
  return findings;
}

/**
 * يفصل ما يُفشل الفحص عمّا يُذكر فقط، حسب وضع التشغيل.
 * @param {KeyFinding[]} findings - كل المخالفات
 * @param {boolean} production - هل الفحص بوضع الإنتاج
 * @returns {{ blocking: KeyFinding[], noted: KeyFinding[] }}
 */
export function partitionBySeverity(findings, production) {
  /** @type {KeyFinding[]} */
  const blocking = [];
  /** @type {KeyFinding[]} */
  const noted = [];
  for (const f of findings) {
    if (f.severity === 'error' || production) blocking.push(f);
    else noted.push(f);
  }
  return { blocking, noted };
}

// ── التشغيل من سطر الأوامر ──
const isMain = process.argv[1] && import.meta.url.endsWith(basename(process.argv[1]));
if (isMain) {
  /** @type {string[]} */
  const explicit = [];
  for (let i = 2; i < process.argv.length; i += 1) {
    if (process.argv[i] === '--path' && process.argv[i + 1]) {
      explicit.push(/** @type {string} */ (process.argv[i + 1]));
      i += 1;
    }
  }
  const production = process.argv.includes('--production') || process.env.NODE_ENV === 'production';
  const roots = resolveScanRoots(explicit);
  const { blocking, noted } = partitionBySeverity(scanAll(roots), production);

  console.log(`═══ فحص مادة المفاتيح الخاصة (M2.03) ═══`);
  console.log(
    `الجذور المفحوصة: ${roots.map((r) => relative(process.cwd(), r) || '.').join(' · ')}`,
  );
  console.log(`الوضع: ${production ? 'إنتاج (المشفَّر على القرص ممنوع أيضاً)' : 'تطوير'}`);

  for (const f of noted) {
    console.log(`  ℹ ${f.file}:${f.line}  [${f.id}]  ${f.reason}`);
  }

  if (blocking.length === 0) {
    console.log('✅ لا مادة مفتاح خاص في أي مسار مفحوص.');
    process.exit(0);
  }

  console.error(`\n⛔ ${blocking.length} مخالفة مادة مفتاح خاص.\n`);
  for (const f of blocking) {
    console.error(`  ${f.file}:${f.line}  [${f.id}]  ${f.reason}`);
    console.error(`      المقتطف المحجوب: ${f.excerpt}`);
  }
  console.error(
    '\nالمطلوب: أزل المادة من المسار، وأبطل المفتاح المكشوف، وزوّد غيره في المخزن الخارجي',
  );
  console.error('عبر `provisionKingKey` (‏src/root-of-trust/king-key.mts).');
  console.error(`إن كان السطر توثيقاً لا مادة، أضف في نهايته: ${ALLOW_MARKER}`);
  process.exit(1);
}
