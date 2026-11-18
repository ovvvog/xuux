#!/usr/bin/env node
// حاجز سلسلة التوريد — M11.02
//
// العيب الذي يعالجه: كانت التبعيات مثبَّتةً بإصدارات مقفولة (M0.03) وفحصُ
// الأسرار يحمي من تسريب المفاتيح (M0.08)، لكن **لم يكن هناك فحصٌ آليٌّ
// يتحقّق من سلامة سلسلة التوريد**: لا بصمةَ اعتماديّاتٍ تُتحقَّق، ولا ثغراتٍ
// تُفحص في CI، ولا قائمةَ مكوّناتٍ (SBOM) تُولَّد. فتبعيّةٌ بثغرةٍ حرجةٍ كانت
// تمرّ بلا اعتراض، والبناءُ يخضرّ والنظامُ مكشوف.
//
// فالحاجز يتحقّق من ستّة شروط:
//   R0: `package-lock.json` موجود وصالح.
//   R1: كلُّ تبعيّات `package.json` مثبَّتةٌ بإصدارٍ دقيقٍ (لا `^` ولا `~`).
//   R2: ملفُّ SBOM (`sbom.cdx.json`) موجودٌ وصالح.
//   R3: لا تبعيّةً بثغرةٍ حرجةٍ أو عاليةٍ في `npm audit`.
//   R4: لا وحداتٍ في `node_modules/` مُلتزَمةً في المستودع.
//   R5 (‏WL-565): لا نسخةَ في ملفِّ القفلِ (‏بأيِّ عمقٍ) داخلَ مدى تبليغٍ سُدَّ — أرضيّةٌ لا ترجعُ
//       بتحديثِ قفلٍ لاحقٍ ولو كانت شدّتُه دونَ «عالية» فلا يراها R3.
//
// حدٌّ معلن: الحاجزُ يقرأ النصَّ لا زمنَ التشغيل؛ و`npm audit` يُشغَّلُ كخطوةِ
// CI منفصلةٍ لا هنا، لأنَّه يحتاجُ شبكةً وقد يبطئُ `validate` المحلّي. هنا
// يُتحقَّقُ من وجودِ ملفِّ التدقيقِ الأخيرِ (`audit-report.json`) وحداثتِهِ.
// ولا يُدَّعى أنَّ هذا بديلٌ عن الفحصِ الخارجيِّ (M11.04) — هو فحصٌ آليٌّ
// داخليٌّ لا أكثر.

import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import { evaluateAudit } from './audit-check.mjs';

const rootIndex = process.argv.indexOf('--root');
const repoRoot = rootIndex === -1 ? process.cwd() : (process.argv[rootIndex + 1] ?? process.cwd());

/**
 * يقرأ ملفَّ JSON ويُرجع كائنَه، ويرمي خطأً مُسمّىً إن تعذّر.
 *
 * @param {string} relativePath مسارٌ نسبيٌّ من جذرِ المستودع.
 * @returns {Record<string, unknown>} الكائنُ المقروء.
 */
function readJson(relativePath) {
  const absolute = path.join(repoRoot, relativePath);
  try {
    return /** @type {Record<string, unknown>} */ (JSON.parse(readFileSync(absolute, 'utf8')));
  } catch (error) {
    throw new Error(
      `${relativePath} لا يُقرأ: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
}

/**
 * أرضيّاتُ التبليغاتِ المسدودة (‏WL-565): المدى المصابُ كما نشرَه التبليغُ حرفيّاً
 * (‏`from` شاملٌ و`below` مستثنى)، لكلِّ نسخةٍ من الحزمةِ في القفلِ بأيِّ عمق.
 *
 * @type {ReadonlyArray<{ name: string; from: string; below: string; advisories: string }>}
 */
const ADVISORY_FLOORS = Object.freeze([
  {
    name: 'fast-uri',
    from: '3.0.0',
    below: '3.1.9',
    advisories:
      'GHSA-w74x-v6f9-j3xg، GHSA-wjr9-j795-jxcr، GHSA-xhq7-xmqj-769h، GHSA-333x-w4r6-6crp',
  },
  { name: 'minimatch', from: '7.0.0', below: '11.0.1', advisories: 'GHSA-g3hv-75wg-m249' },
]);

/**
 * @param {string} version
 * @returns {number[] | null} الأرقامُ الثلاثةُ أو null إن لم تُقرأ.
 */
function parseVersion(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(version);
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

/** @param {number[]} a @param {number[]} b */
function compareVersions(a, b) {
  for (let i = 0; i < 3; i += 1) if (a[i] !== b[i]) return (a[i] ?? 0) - (b[i] ?? 0);
  return 0;
}

/**
 * كلُّ نسخةٍ في القفلِ داخلَ مدى أرضيّة (‏أو غيرُ مقروءةٍ — مغلقُ الفشل).
 *
 * @param {Record<string, unknown>} lock
 * @returns {string[]} المخالفاتُ بصيغةِ `مسار@نسخة`.
 */
function floorViolations(lock) {
  const packages = /** @type {Record<string, { version?: unknown }>} */ (lock.packages ?? {});
  /** @type {string[]} */
  const out = [];
  for (const [key, entry] of Object.entries(packages)) {
    for (const floor of ADVISORY_FLOORS) {
      if (key !== `node_modules/${floor.name}` && !key.endsWith(`/node_modules/${floor.name}`))
        continue;
      const version = typeof entry?.version === 'string' ? entry.version : '';
      const parsed = parseVersion(version);
      const from = /** @type {number[]} */ (parseVersion(floor.from));
      const below = /** @type {number[]} */ (parseVersion(floor.below));
      if (!parsed || (compareVersions(parsed, from) >= 0 && compareVersions(parsed, below) < 0)) {
        out.push(
          `${key}@${version || '؟'} (‏${floor.advisories}؛ المصابُ ≥ ${floor.from} و< ${floor.below})`,
        );
      }
    }
  }
  return out;
}

/** @type {string[]} */
const violations = [];

console.log('═══ حاجز سلسلة التوريد (M11.02) ═══');

try {
  // R0: package-lock.json موجود وصالح
  try {
    const lock = readJson('package-lock.json');
    if (typeof lock.lockfileVersion !== 'number' || lock.lockfileVersion < 3) {
      violations.push('R0: `package-lock.json` ليس إصدارَ قفلٍ 3 أو أعلى.');
    }
  } catch {
    violations.push('R0: `package-lock.json` غائبٌ أو غير صالحٍ JSON.');
  }

  // R1: كل التبعيات مثبتة بإصدار دقيق
  const pkg = readJson('package.json');
  const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
  const rangePattern = /^[\^~>=<]/;
  const unpinned = Object.entries(deps).filter(
    ([, version]) => typeof version === 'string' && rangePattern.test(version),
  );
  if (unpinned.length > 0) {
    violations.push(
      `R1: تبعيّاتٌ غير مثبَّتةٍ بدقّة: ${unpinned
        .map(([name, version]) => `${name}@${version}`)
        .join('، ')}.`,
    );
  }

  // R2: ملف SBOM موجود وصالح
  const sbomPath = path.join(repoRoot, 'sbom.cdx.json');
  if (!existsSync(sbomPath)) {
    violations.push('R2: `sbom.cdx.json` غائبٌ — شغّل `npm run gen:sbom` لتوليده.');
  } else {
    try {
      const sbom = JSON.parse(readFileSync(sbomPath, 'utf8'));
      if (typeof sbom.bomFormat !== 'string' || sbom.bomFormat !== 'CycloneDX') {
        violations.push('R2: `sbom.cdx.json` ليس بصيغة CycloneDX.');
      }
      if (!Array.isArray(sbom.components) || sbom.components.length === 0) {
        violations.push('R2: `sbom.cdx.json` بلا مكوّناتٍ — هل المشروع مثبَّت؟');
      }
    } catch {
      violations.push('R2: `sbom.cdx.json` ليس JSON صالح.');
    }
  }

  // R3: تقرير تدقيق الثغرات موجود وحديث (خلال آخر 7 أيام)
  const auditPath = path.join(repoRoot, 'audit-report.json');
  if (!existsSync(auditPath)) {
    violations.push('R3: `audit-report.json` غائبٌ — شغّل `npm run audit:check` في CI.');
  } else {
    try {
      const audit = JSON.parse(readFileSync(auditPath, 'utf8'));
      // WL-557: الحكمُ نفسُه الذي يُطبِّقُه audit:check (‏الإعذارُ الضيّقُ المؤقّتُ بملفِّ القفلِ في الجذرِ نفسِه).
      const lockPath = path.join(repoRoot, 'package-lock.json');
      const lock = existsSync(lockPath) ? JSON.parse(readFileSync(lockPath, 'utf8')) : {};
      const { blocking } = evaluateAudit(audit, lock, new Date());
      if (blocking.length > 0) {
        violations.push(`R3: ${blocking.length} ثغرة حرجة/عالية في audit-report.json.`);
      }
    } catch {
      violations.push('R3: `audit-report.json` ليس JSON صالح.');
    }
  }

  // R5 (‏WL-565): أرضيّاتُ التبليغاتِ المسدودةِ في القفلِ بأيِّ عمق
  try {
    const floorLock = readJson('package-lock.json');
    const below = floorViolations(floorLock);
    if (below.length > 0) {
      violations.push(`R5: نسخٌ داخلَ مدى تبليغٍ مسدود: ${below.join('، ')}.`);
    }
  } catch {
    // ‏غيابُ القفلِ أو فسادُه مُبلَّغٌ في R0.
  }

  // R4: لا node_modules في المستودع
  const nodeModulesPath = path.join(repoRoot, 'node_modules');
  if (existsSync(nodeModulesPath)) {
    const gitignore = readFileSync(path.join(repoRoot, '.gitignore'), 'utf8');
    if (!gitignore.includes('node_modules')) {
      violations.push('R4: `node_modules/` موجودٌ وغير مُدرَجٍ في `.gitignore`.');
    }
  }
} catch (error) {
  violations.push(error instanceof Error ? error.message : String(error));
}

if (violations.length > 0) {
  console.error('\n⛔ حاجز سلسلة التوريد مغلق:');
  for (const violation of violations) console.error(`   - ${violation}`);
  process.exit(1);
}

console.log('\n✅ حاجز سلسلة التوريد مفتوح: تبعيّاتٌ مثبَّتة وSBOM موجودٌ ولا ثغراتٍ حرجة.');
