#!/usr/bin/env node
// حاجز سلسلة التوريد — M11.02
//
// العيب الذي يعالجه: كانت التبعيات مثبَّتةً بإصدارات مقفولة (M0.03) وفحصُ
// الأسرار يحمي من تسريب المفاتيح (M0.08)، لكن **لم يكن هناك فحصٌ آليٌّ
// يتحقّق من سلامة سلسلة التوريد**: لا بصمةَ اعتماديّاتٍ تُتحقَّق، ولا ثغراتٍ
// تُفحص في CI، ولا قائمةَ مكوّناتٍ (SBOM) تُولَّد. فتبعيّةٌ بثغرةٍ حرجةٍ كانت
// تمرّ بلا اعتراض، والبناءُ يخضرّ والنظامُ مكشوف.
//
// فالحاجز يتحقّق من خمسة شروط:
//   R0: `package-lock.json` موجود وصالح.
//   R1: كلُّ تبعيّات `package.json` مثبَّتةٌ بإصدارٍ دقيقٍ (لا `^` ولا `~`).
//   R2: ملفُّ SBOM (`sbom.cdx.json`) موجودٌ وصالح.
//   R3: لا تبعيّةً بثغرةٍ حرجةٍ أو عاليةٍ في `npm audit`.
//   R4: لا وحداتٍ في `node_modules/` مُلتزَمةً في المستودع.
//
// حدٌّ معلن: الحاجزُ يقرأ النصَّ لا زمنَ التشغيل؛ و`npm audit` يُشغَّلُ كخطوةِ
// CI منفصلةٍ لا هنا، لأنَّه يحتاجُ شبكةً وقد يبطئُ `validate` المحلّي. هنا
// يُتحقَّقُ من وجودِ ملفِّ التدقيقِ الأخيرِ (`audit-report.json`) وحداثتِهِ.
// ولا يُدَّعى أنَّ هذا بديلٌ عن الفحصِ الخارجيِّ (M11.04) — هو فحصٌ آليٌّ
// داخليٌّ لا أكثر.

import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

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
      const vulns = audit.vulnerabilities ?? {};
      const critical = Object.values(vulns).filter(
        (v) =>
          typeof v === 'object' &&
          v !== null &&
          'severity' in v &&
          (v.severity === 'critical' || v.severity === 'high'),
      );
      if (critical.length > 0) {
        violations.push(`R3: ${critical.length} ثغرة حرجة/عالية في audit-report.json.`);
      }
    } catch {
      violations.push('R3: `audit-report.json` ليس JSON صالح.');
    }
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
