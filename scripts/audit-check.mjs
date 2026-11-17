#!/usr/bin/env node
// فاحص الثغرات — M11.02
//
// يُشغّل `npm audit` ويُخرج تقريرًا بتنسيق JSON إلى `audit-report.json`.
// يُفشل البناء عند وجود ثغرات حرجة أو عالية — إلا ما أعذرَه `AUDIT_EXCEPTIONS` (‏WL-557) بشروطِه كلِّها.

import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

/**
 * WL-557: إعذاراتٌ ضيّقةٌ مؤقّتة — لثغرةٍ **لا إصدارَ مُصلَحاً لها** وحدَها (‏الترقيةُ أوّلاً حيث وُجدت). الإعذارُ بمعرّفِ
 * التبليغ (‏`url`) لا باسمِ الحزمة، ولا يشملُ إلا عقدةً تطويريّةً (‏`dev: true` لكلِّ مسارٍ لها في `package-lock.json` — فلا
 * تصلُ إلى شجرةِ الإنتاج)، بشدّةٍ لا تتجاوزُ `maxSeverity`، وقبلَ `expires` (‏UTC، شهرٌ على الأكثر — يُعادُ النظرُ أو يُجدَّدُ
 * بقرارٍ مُسجَّل). عقدةٌ عاليةٌ تُعذَرُ إن كانت كلُّ تبليغاتِها العاليةِ في سلسلتِها (‏via) مُعذَرة؛ وأيُّ تبليغٍ عالٍ آخر، أو اسمٌ
 * غيرُ محلول، أو عقدةٌ إنتاجيّة، يُسقِطُ الإعذار.
 * @type {ReadonlyArray<{ advisory: string, package: string, maxSeverity: 'high' | 'critical', expires: string, why: string }>}
 */
export const AUDIT_EXCEPTIONS = Object.freeze([
  Object.freeze({
    advisory: 'https://github.com/advisories/GHSA-fc5q-39xc-vjpf',
    package: 'picomatch',
    maxSeverity: /** @type {const} */ ('high'),
    expires: '2026-12-02',
    why:
      'picomatch ≤ 4.0.7 (‏ReDoS بأنماطِ extglob، نُشرَ 2026-10-19): «Patched versions: None» — لا ترقيةَ تسدُّه، ' +
      'وtypescript-eslint 8.73.0 ما زالَ يجرُّه عبرَ tinyglobby. تبعيّةٌ تطويريّةٌ لـeslint/typescript-eslint وحدَهما ' +
      '(‏`npm ls --omit=dev picomatch` فارغ)، والأنماطُ من إعدادِ المستودعِ لا من دخلٍ خارجيّ.',
  }),
]);

/** @param {string} s @returns {number} رتبةُ الشدّة؛ المجهولةُ حرجةٌ (‏فشلٌ مغلق). */
const rank = (s) =>
  /** @type {Record<string, number>} */ ({ info: 0, low: 1, moderate: 2, high: 3, critical: 4 })[
    s
  ] ?? 4;

/**
 * WL-557: يحكمُ على تقريرِ `npm audit --json` بملفِّ القفل.
 * @param {{ vulnerabilities?: Record<string, any> }} audit
 * @param {{ lockfileVersion?: number, packages?: Record<string, { version?: string, dev?: boolean }> }} lock
 * @param {Date} now
 * @param {ReadonlyArray<{ advisory: string, maxSeverity: string, expires: string }>} [exceptions]
 * @returns {{ blocking: Array<{ name: string, severity: string, reason: string }>,
 *             excused: Array<{ name: string, severity: string, advisories: string[] }> }}
 */
export function evaluateAudit(audit, lock, now, exceptions = AUDIT_EXCEPTIONS) {
  const vulns = audit?.vulnerabilities ?? {};
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
    if (!(severity === 'high' || severity === 'critical')) continue;
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

/** @param {string} repoRoot @param {any} audit */
function judge(repoRoot, audit) {
  writeFileSync(`${repoRoot}/audit-report.json`, JSON.stringify(audit, null, 2) + '\n');
  const lock = JSON.parse(readFileSync(path.join(repoRoot, 'package-lock.json'), 'utf8'));
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
  judge(repoRoot, audit);
}

if (
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main();
}
