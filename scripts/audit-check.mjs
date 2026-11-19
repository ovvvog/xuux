#!/usr/bin/env node
// فاحص الثغرات — M11.02
//
// يُشغّل `npm audit` ويُخرج تقريرًا بتنسيق JSON إلى `audit-report.json`.
// يُفشل البناء عند وجود ثغرات حرجة أو عالية — إلا ما أعذرَه `AUDIT_EXCEPTIONS` (‏WL-557) بشروطِه كلِّها.
// ‏WL-574: يُزيلُ التقريرَ السابقَ قبلَ التدقيق، ولا يكتبُ تقريراً إلا لتدقيقٍ ناجحٍ لم يتغيّرْ قفلُه أثناءَه — كتابةً ذرّيّةً
// ‏(‏ملفٌّ مؤقّتٌ ثمّ rename) مختومةً بـ `xuuxAudit` (‏وقتُ البدءِ UTC وSHA-256 لبايتاتِ `package-lock.json` الخام)؛
// ‏و R3 في guard:supply-chain يرفضُ تقريراً بلا ختمٍ صالح أو أقدمَ من 7 أيّام أو لقفلٍ آخر (‏`checkProvenance`).

import { readFileSync, writeFileSync, renameSync, rmSync, statSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

// WL-571 (‏2026-11-19): أُزيلَ إعذارُ GHSA-fc5q-39xc-vjpf (‏picomatch، WL-557) — سُحِبَ التبليغُ (‏withdrawn_at
// 2026-11-18T15:38:56Z) و`npm audit --json` على القفلِ نفسِه لا يُبلِّغُه (‏0 ثغرات). القائمةُ فارغة: كلُّ ثغرةٍ حرجةٍ أو عاليةٍ
// تُسقِطُ الفحص؛ والآليّةُ باقيةٌ بشروطِها لإعذارٍ مستقبليٍّ بقرارٍ مُسجَّل.
/**
 * WL-557: إعذاراتٌ ضيّقةٌ مؤقّتة — لثغرةٍ **لا إصدارَ مُصلَحاً لها** وحدَها (‏الترقيةُ أوّلاً حيث وُجدت). الإعذارُ بمعرّفِ
 * التبليغ (‏`url`) لا باسمِ الحزمة، ولا يشملُ إلا عقدةً تطويريّةً (‏`dev: true` لكلِّ مسارٍ لها في `package-lock.json` — فلا
 * تصلُ إلى شجرةِ الإنتاج)، بشدّةٍ لا تتجاوزُ `maxSeverity`، وقبلَ `expires` (‏UTC، شهرٌ على الأكثر — يُعادُ النظرُ أو يُجدَّدُ
 * بقرارٍ مُسجَّل). عقدةٌ عاليةٌ تُعذَرُ إن كانت كلُّ تبليغاتِها العاليةِ في سلسلتِها (‏via) مُعذَرة؛ وأيُّ تبليغٍ عالٍ آخر، أو اسمٌ
 * غيرُ محلول، أو عقدةٌ إنتاجيّة، يُسقِطُ الإعذار.
 * @type {ReadonlyArray<{ advisory: string, package: string, maxSeverity: 'high' | 'critical', expires: string, why: string }>}
 */
export const AUDIT_EXCEPTIONS = Object.freeze([]);

/** @param {string} s @returns {number} رتبةُ الشدّة؛ المجهولةُ حرجةٌ (‏فشلٌ مغلق). */
const rank = (s) =>
  /** @type {Record<string, number>} */ ({ info: 0, low: 1, moderate: 2, high: 3, critical: 4 })[
    s
  ] ?? 4;

/**
 * WL-557: يحكمُ على تقريرِ `npm audit --json` بملفِّ القفل.
 * @param {any} audit تقريرُ `npm audit --json` كما هو (‏شكلُه يُتحقَّقُ منه — WL-572)
 * @param {{ lockfileVersion?: number, packages?: Record<string, { version?: string, dev?: boolean }> }} lock
 * @param {Date} now
 * @param {ReadonlyArray<{ advisory: string, maxSeverity: string, expires: string }>} [exceptions]
 * @returns {{ blocking: Array<{ name: string, severity: string, reason: string }>,
 *             excused: Array<{ name: string, severity: string, advisories: string[] }> }}
 */
export function evaluateAudit(audit, lock, now, exceptions = AUDIT_EXCEPTIONS) {
  // WL-572: تقريرٌ لا يُفهَمُ لا يُقرأُ «لا ثغرات» — خطأُ npm (‏`{message, error}` حينَ لا يُجيبُ السجلّ)، أو `vulnerabilities`
  // غائبةٌ أو ليست كائناً، يُسقِطُ الفحص (‏فشلٌ مغلق). كانَ يُقرأُ 0 ثغراتٍ فيخرجُ ✅ بصفر.
  const shape =
    typeof audit !== 'object' || audit === null || Array.isArray(audit)
      ? 'ليس كائناً'
      : 'error' in audit
        ? `خطأُ npm: ${String(/** @type {any} */ (audit).message ?? '').slice(0, 200)}`
        : typeof audit.vulnerabilities !== 'object' ||
            audit.vulnerabilities === null ||
            Array.isArray(audit.vulnerabilities)
          ? 'vulnerabilities غائبةٌ أو ليست كائناً'
          : '';
  if (shape !== '') {
    return {
      blocking: [
        { name: '(التقرير)', severity: 'critical', reason: `تقريرُ تدقيقٍ غيرُ صالح: ${shape}` },
      ],
      excused: [],
    };
  }
  const vulns = /** @type {Record<string, any>} */ (audit.vulnerabilities);
  const packages = lock?.packages ?? {};
  const live = exceptions.filter((e) => now.getTime() < Date.parse(`${e.expires}T00:00:00Z`));
  /** @param {any} v */
  const isDev = (v) =>
    Array.isArray(v?.nodes) &&
    v.nodes.length > 0 &&
    v.nodes.every((/** @type {string} */ n) => packages[n]?.dev === true);
  /**
   * التبليغاتُ العاليةُ فما فوقُ في سلسلةِ عقدة، أو null إن تعذّرَ الحلّ (‏اسمٌ غائب).
   * @param {string} name @param {Set<string>} seen @returns {Array<{ url: string, severity: string, node: any }> | null}
   */
  const leaves = (name, seen) => {
    const v = vulns[name];
    if (typeof v !== 'object' || v === null) return null;
    if (seen.has(name)) return [];
    seen.add(name);
    /** @type {Array<{ url: string, severity: string, node: any }>} */
    const out = [];
    for (const x of Array.isArray(v.via) ? v.via : []) {
      if (typeof x === 'string') {
        const sub = leaves(x, seen);
        if (sub === null) return null;
        out.push(...sub);
      } else if (rank(String(x?.severity)) >= rank('high')) {
        out.push({ url: String(x?.url ?? ''), severity: String(x?.severity), node: v });
      }
    }
    return out;
  };
  /** @type {ReturnType<typeof evaluateAudit>} */
  const result = { blocking: [], excused: [] };
  for (const [name, v] of Object.entries(vulns)) {
    const severity = String(v?.severity);
    // WL-572: الشدّةُ غيرُ المعروفةِ حرجةٌ (‏`rank`) — كانت تُتخطّى («Critical»، «HIGH»، فارغة، غائبة) فتمرّ.
    if (rank(severity) < rank('high')) continue;
    const ls = leaves(name, new Set());
    let reason = '';
    if (ls === null) reason = 'سلسلةٌ غيرُ محلولة';
    else if (ls.length === 0) reason = 'لا تبليغَ عالياً محلولاً في السلسلة';
    else if (!isDev(v)) reason = 'عقدةٌ غيرُ تطويريّةٍ في ملفِّ القفل';
    else {
      for (const l of ls) {
        const e = live.find((x) => x.advisory === l.url);
        if (e === undefined) reason = `تبليغٌ غيرُ مُعذَر: ${l.url || '(بلا معرّف)'}`;
        else if (rank(l.severity) > rank(e.maxSeverity) || rank(severity) > rank(e.maxSeverity))
          reason = `شدّةٌ فوقَ المُعذَر: ${l.url}`;
        else if (!isDev(l.node)) reason = `مصدرُ التبليغِ غيرُ تطويريّ: ${l.url}`;
        if (reason !== '') break;
      }
    }
    if (reason === '') {
      result.excused.push({
        name,
        severity,
        advisories: [...new Set((ls ?? []).map((l) => l.url))],
      });
    } else {
      result.blocking.push({ name, severity, reason });
    }
  }
  result.blocking.sort((a, b) => a.name.localeCompare(b.name));
  result.excused.sort((a, b) => a.name.localeCompare(b.name));
  return result;
}

/** WL-574: أقصى عمرٍ لتقريرٍ يقبلُه R3 (‏الحدُّ نفسُه مقبول). */
export const AUDIT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
/** WL-574: سماحيّةُ انحرافِ الساعةِ لوقتٍ مستقبليّ — ما دونَها (‏والحدُّ نفسُه) مقبول، وما فوقَها مرفوض. */
export const AUDIT_FUTURE_SKEW_MS = 5 * 60 * 1000;
const ISO_UTC_MS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const SHA256_HEX = /^[0-9a-f]{64}$/;
const PROVENANCE_KEYS = '["generatedAt","lockfileSha256","version"]';

/** WL-574: بصمةُ SHA-256 (‏hex صغيرة) لبايتاتِ الملفِّ الخام — لا لـ JSON بعدَ تحليلِه وإعادةِ تسلسلِه. @param {Buffer} bytes */
export const lockDigest = (bytes) => createHash('sha256').update(bytes).digest('hex');

/**
 * WL-574: يُرفِقُ بالتقريرِ حقلَ `xuuxAudit` (‏لا تحتَ `metadata` التي يملكُها npm) دونَ مسِّ بقيّتِه.
 * @param {Record<string, unknown>} audit @param {Buffer} lockBytes بايتاتُ القفلِ الذي دُقِّقَ فعلاً @param {Date} at وقتُ بدءِ التدقيق
 */
export const stampProvenance = (audit, lockBytes, at) => ({
  ...audit,
  xuuxAudit: { version: 1, generatedAt: at.toISOString(), lockfileSha256: lockDigest(lockBytes) },
});

/**
 * WL-574: هل التقريرُ حديثٌ ومربوطٌ بالقفلِ الحاليّ؟ يُرجِعُ '' أو سببَ الرفض؛ أيُّ حقلٍ مفقودٍ أو مشوّهٍ أو زائدٍ يُرفَض.
 * @param {any} audit @param {Buffer | null} lockBytes بايتاتُ `package-lock.json` الحاليّ (‏null إن غاب) @param {Date} now
 * @returns {string}
 */
export function checkProvenance(audit, lockBytes, now) {
  /** @param {unknown} x */
  const isObj = (x) => typeof x === 'object' && x !== null && !Array.isArray(x);
  if (!isObj(audit)) return 'التقريرُ ليس كائناً';
  const p = audit.xuuxAudit;
  if (!isObj(p)) return '`xuuxAudit` غائبٌ أو ليس كائناً';
  if (JSON.stringify(Object.keys(p).sort()) !== PROVENANCE_KEYS) {
    return '`xuuxAudit` بحقولٍ ناقصةٍ أو غيرِ متوقَّعة (‏المتوقَّع: version، generatedAt، lockfileSha256)';
  }
  if (p.version !== 1) return '`xuuxAudit.version` غيرُ معروف';
  const g = p.generatedAt;
  if (
    typeof g !== 'string' ||
    !ISO_UTC_MS.test(g) ||
    Number.isNaN(Date.parse(g)) ||
    new Date(g).toISOString() !== g
  ) {
    return '`xuuxAudit.generatedAt` ليس وقتاً UTC صريحاً صالحاً (‏YYYY-MM-DDTHH:mm:ss.sssZ)';
  }
  const age = now.getTime() - Date.parse(g);
  if (age < -AUDIT_FUTURE_SKEW_MS)
    return `\`xuuxAudit.generatedAt\` في المستقبلِ فوقَ سماحيّةِ 5 دقائق: ${g}`;
  if (age > AUDIT_MAX_AGE_MS) return `التقريرُ أقدمُ من 7 أيّام: ${g}`;
  if (typeof p.lockfileSha256 !== 'string' || !SHA256_HEX.test(p.lockfileSha256)) {
    return '`xuuxAudit.lockfileSha256` ليس SHA-256 بـ 64 حرفاً hex صغيراً';
  }
  if (lockBytes === null) return '`package-lock.json` غائبٌ فلا يُطابَق';
  if (p.lockfileSha256 !== lockDigest(lockBytes)) {
    return 'بصمةُ التقريرِ لا تطابقُ `package-lock.json` الحاليّ (‏دُقِّقَ قفلٌ آخر)';
  }
  return '';
}

/**
 * @param {string} repoRoot @param {any} audit @param {Buffer} lockBytes القفلُ الذي دُقِّقَ (‏ثابتٌ طوالَ التدقيق)
 * @param {Date} startedAt
 */
function judge(repoRoot, audit, lockBytes, startedAt) {
  const lock = JSON.parse(lockBytes.toString('utf8'));
  const { blocking, excused } = evaluateAudit(audit, lock, new Date());
  for (const x of excused) {
    console.log(
      `   ⚠ مُعذَرٌ مؤقّتاً (‏WL-557): ${x.name}: ${x.severity} — ${x.advisories.join(', ')}`,
    );
  }
  if (blocking.length > 0) {
    console.error(`\n⛔ ${blocking.length} ثغرةٌ حرجة/عالية:`);
    for (const x of blocking) console.error(`   - ${x.name}: ${x.severity} (${x.reason})`);
    process.exit(1);
  }
  // ‏WL-574: الكتابةُ للناجحِ وحدَه، ذرّيّةً — فلا يُرى تقريرٌ نصفُ مكتوبٍ ولا تقريرٌ لتدقيقٍ فاشل.
  const reportPath = path.join(repoRoot, 'audit-report.json');
  const tmpPath = `${reportPath}.${process.pid}.tmp`;
  writeFileSync(
    tmpPath,
    JSON.stringify(stampProvenance(audit, lockBytes, startedAt), null, 2) + '\n',
  );
  renameSync(tmpPath, reportPath);
  const total = Object.keys(audit.vulnerabilities ?? {}).length;
  console.log(
    `\n✅ لا ثغراتٍ حرجة/عالية غيرَ مُعذَرة (${total} ثغرةً في التقرير، ${excused.length} مُعذَرةٌ مؤقّتاً).`,
  );
}

function main() {
  const rootIndex = process.argv.indexOf('--root');
  const repoRoot =
    rootIndex === -1 ? process.cwd() : (process.argv[rootIndex + 1] ?? process.cwd());
  console.log('═══ فحص الثغرات (M11.02) ═══');
  // ‏WL-574: أبطِلِ التقريرَ السابقَ قبلَ أيِّ شيء — فشلٌ لاحقٌ لا يتركُ تقريراً قديماً يبدو صالحاً (‏rmSync يرمي إن تعذّر).
  rmSync(path.join(repoRoot, 'audit-report.json'), { force: true });
  const lockPath = path.join(repoRoot, 'package-lock.json');
  /** @param {import('node:fs').Stats} s */
  const sig = (s) => `${s.size}:${s.mtimeMs}:${s.ino}`;
  const statBefore = sig(statSync(lockPath));
  const lockBytes = readFileSync(lockPath);
  const startedAt = new Date();
  /** @type {string} */
  let output;
  try {
    output = execSync('npm audit --json', {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch (error) {
    // npm audit returns non-zero exit when vulnerabilities found
    const err = /** @type {Error & { stdout?: string }} */ (error);
    if (!err.stdout) {
      console.error('⛔ فشل npm audit:', error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
    output = err.stdout;
  }
  /** @type {any} */
  let audit;
  try {
    audit = JSON.parse(output);
  } catch (error) {
    console.error(
      '⛔ فشل تحليل تقرير npm audit:',
      error instanceof Error ? error.message : String(error),
    );
    process.exit(1);
  }
  // ‏WL-574: القفلُ الذي قُرِئَ قبلَ التدقيقِ هو نفسُه بعدَه (‏بصمةً وحجماً ووقتَ تعديلٍ وinode) — وإلا فالتقريرُ لا يُنسَبُ لقفل.
  /** @type {boolean} */
  let changed;
  try {
    changed =
      sig(statSync(lockPath)) !== statBefore ||
      lockDigest(readFileSync(lockPath)) !== lockDigest(lockBytes);
  } catch {
    changed = true;
  }
  if (changed) {
    console.error(
      '⛔ package-lock.json تغيّرَ أثناءَ التدقيق — لا تقرير. أعِدْ `npm run audit:check` بعدَ استقرارِ القفل.',
    );
    process.exit(1);
  }
  judge(repoRoot, audit, lockBytes, startedAt);
}

if (
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main();
}
