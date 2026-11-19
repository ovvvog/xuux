#!/usr/bin/env node
// حاجز سلسلة التوريد — M11.02
//
// العيب الذي يعالجه: كانت التبعيات مثبَّتةً بإصدارات مقفولة (M0.03) وفحصُ
// الأسرار يحمي من تسريب المفاتيح (M0.08)، لكن **لم يكن هناك فحصٌ آليٌّ
// يتحقّق من سلامة سلسلة التوريد**: لا بصمةَ اعتماديّاتٍ تُتحقَّق، ولا ثغراتٍ
// تُفحص في CI، ولا قائمةَ مكوّناتٍ (SBOM) تُولَّد. فتبعيّةٌ بثغرةٍ حرجةٍ كانت
// تمرّ بلا اعتراض، والبناءُ يخضرّ والنظامُ مكشوف.
//
// فالحاجز يتحقّق من سبعة شروط:
//   R0: `package-lock.json` موجود وصالح.
//   R1: كلُّ تبعيّات `package.json` مثبَّتةٌ بإصدارٍ دقيقٍ (لا `^` ولا `~`).
//   R2: ملفُّ SBOM (`sbom.cdx.json`) موجودٌ وصالح، ومربوطٌ بالقفلِ الحاليّ (‏WL-575): خاصّيّةُ
//       `xuux:lockfileSha256` في `metadata.properties` = SHA-256 لبايتاتِ `package-lock.json`.
//   R3: لا تبعيّةً بثغرةٍ حرجةٍ أو عاليةٍ في `npm audit` — في تقريرٍ مختومٍ بـ `xuuxAudit` (‏WL-574):
//       مولَّدٍ خلالَ 7 أيّام (‏وليس في المستقبلِ فوقَ 5 دقائق)، وبصمتُه SHA-256 لبايتاتِ `package-lock.json` الحاليّ.
//   R4: لا وحداتٍ في `node_modules/` مُلتزَمةً في المستودع.
//   R5 (‏WL-565): لا نسخةَ في ملفِّ القفلِ (‏بأيِّ عمقٍ) داخلَ مدى تبليغٍ سُدَّ — أرضيّةٌ لا ترجعُ
//       بتحديثِ قفلٍ لاحقٍ ولو كانت شدّتُه دونَ «عالية» فلا يراها R3.
//   R6 (‏WL-568): كلُّ حزمةٍ تستوردُها شفرةُ التشغيلِ (‏`src/`) مُعلَنةٌ في `dependencies` أو
//       `optionalDependencies` — لا في `devDependencies` وحدَها فيُسقِطَها `npm ci --omit=dev`.
//
// حدٌّ معلن: الحاجزُ يقرأ النصَّ لا زمنَ التشغيل؛ و`npm audit` يُشغَّلُ كخطوةِ
// CI منفصلةٍ لا هنا، لأنَّه يحتاجُ شبكةً وقد يبطئُ `validate` المحلّي. هنا
// يُتحقَّقُ من وجودِ ملفِّ التدقيقِ الأخيرِ (`audit-report.json`) وحداثتِهِ وارتباطِه بالقفلِ الحاليّ (‏WL-574).
// ولا يُدَّعى أنَّ هذا بديلٌ عن الفحصِ الخارجيِّ (M11.04) — هو فحصٌ آليٌّ
// داخليٌّ لا أكثر.

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { builtinModules } from 'node:module';
import path from 'node:path';
import process from 'node:process';

import { checkProvenance, evaluateAudit } from './audit-check.mjs';
import {
  checkSbomBinding,
  checkSbomComponents,
  formatComponentProblems,
} from './generate-sbom.mjs';

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

/** امتداداتُ شفرةِ التشغيلِ التي يقرؤها R6. */
const SOURCE_EXTENSIONS = Object.freeze(['.mjs', '.js', '.cjs', '.mts']);

/** اسمُ حزمةِ npm (‏مع النطاقِ أو بدونه) في أوّلِ المواصفة. */
const PACKAGE_NAME = /^(?:@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*/;

/**
 * المواصفاتُ الحرفيّةُ في نصٍّ: `from '…'`، و`import '…'`، و`import('…')`، و`require('…')`.
 *
 * @param {string} text
 * @returns {string[]}
 */
function importSpecifiers(text) {
  const out = [];
  const pattern =
    /\bfrom\s*(['"])([^'"\n]+)\1|\bimport\s*(['"])([^'"\n]+)\3|\b(?:import|require)\s*\(\s*(['"])([^'"\n]+)\5\s*\)/g;
  for (const match of text.matchAll(pattern)) out.push(match[2] ?? match[4] ?? match[6] ?? '');
  return out;
}

/**
 * اسمُ الحزمةِ الخارجيّةِ لمواصفةٍ، أو null لمسارٍ نسبيٍّ أو مطلقٍ أو وحدةٍ مدمجة.
 *
 * @param {string} specifier
 * @returns {string | null}
 */
function externalPackage(specifier) {
  if (specifier.startsWith('.') || specifier.startsWith('/') || specifier.startsWith('node:'))
    return null;
  const name = PACKAGE_NAME.exec(specifier)?.[0];
  if (!name) return null;
  if (builtinModules.includes(name) || builtinModules.includes(specifier)) return null;
  const rest = specifier.slice(name.length);
  return rest === '' || rest.startsWith('/') ? name : null;
}

/**
 * كلُّ ملفٍّ مصدريٍّ تحتَ مجلّد (‏تكراريّاً).
 *
 * @param {string} dir
 * @returns {string[]}
 */
function sourceFiles(dir) {
  if (!existsSync(dir)) return [];
  /** @type {string[]} */
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(full));
    else if (SOURCE_EXTENSIONS.some((ext) => entry.name.endsWith(ext))) out.push(full);
  }
  return out.sort();
}

/**
 * حزمٌ تستوردُها شفرةُ التشغيلِ وليست في `dependencies` ولا `optionalDependencies`.
 *
 * @param {string} root
 * @param {Record<string, unknown>} pkg
 * @returns {string[]} `حزمة (‏أوّلُ ملفٍّ، وعددُ الملفّات)`.
 */
function runtimeImportViolations(root, pkg) {
  const declared = new Set([
    ...Object.keys(/** @type {Record<string, string>} */ (pkg.dependencies ?? {})),
    ...Object.keys(/** @type {Record<string, string>} */ (pkg.optionalDependencies ?? {})),
  ]);
  /** @type {Map<string, string[]>} */
  const missing = new Map();
  for (const file of sourceFiles(path.join(root, 'src'))) {
    for (const specifier of importSpecifiers(readFileSync(file, 'utf8'))) {
      const name = externalPackage(specifier);
      if (!name || name === pkg.name || declared.has(name)) continue;
      const files = missing.get(name) ?? [];
      const rel = path.relative(root, file);
      if (!files.includes(rel)) files.push(rel);
      missing.set(name, files);
    }
  }
  return [...missing].map(
    ([name, files]) => `${name} (‏${files[0] ?? ''}، ${String(files.length)} ملفّاً)`,
  );
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

  // R2: ملف SBOM موجود وصالح ومربوطٌ بالقفلِ الحاليّ (‏WL-575)
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
      // ‏WL-575: حكمٌ مستقلٌّ إضافيّ — لا يُغيّرُ الشرطَين السابقَين ولا رسالتَيهما.
      const sbomLockPath = path.join(repoRoot, 'package-lock.json');
      // ‏WL-576: قراءةٌ واحدةٌ للقفلِ يشتركُ فيها حكمُ الربطِ وحكمُ المطابقة.
      const sbomLockBytes = existsSync(sbomLockPath) ? readFileSync(sbomLockPath) : null;
      const binding = checkSbomBinding(sbom, sbomLockBytes);
      if (binding !== '') {
        violations.push(`R2: SBOM غيرُ مربوطٍ بالقفل (‏WL-575): ${binding}.`);
      }
      // ‏WL-576: حكمٌ مستقلٌّ ثالث — مكوّناتُ SBOM وإصداراتُها ممثَّلةٌ في شجرةِ القفلِ والعكس. لا يرمي.
      let lockTree = null;
      try {
        lockTree = sbomLockBytes ? JSON.parse(sbomLockBytes.toString('utf8')) : null;
      } catch {
        lockTree = null;
      }
      const tree = checkSbomComponents(sbom, lockTree);
      if (tree.problems.length > 0) {
        violations.push(
          `R2: مكوّناتُ SBOM لا تطابقُ شجرةَ القفل (‏WL-576): ${formatComponentProblems(tree.problems)}.`,
        );
      }
      if (tree.omittedOptional.length > 0) {
        console.log(
          `ℹ️ R2 (‏WL-576): مدخلاتٌ اختياريّةٌ في القفلِ غائبةٌ عن SBOM (‏غيرُ مثبَّتةٍ على هذه المنصّة): ${tree.omittedOptional.join('، ')}`,
        );
      }
    } catch {
      violations.push('R2: `sbom.cdx.json` ليس JSON صالح.');
    }
  }

  // R3: تقرير تدقيق الثغرات موجود وحديث (خلال آخر 7 أيام) ومربوطٌ بالقفلِ الحاليّ (‏WL-574)
  const auditPath = path.join(repoRoot, 'audit-report.json');
  if (!existsSync(auditPath)) {
    violations.push('R3: `audit-report.json` غائبٌ — شغّل `npm run audit:check` في CI.');
  } else {
    try {
      const audit = JSON.parse(readFileSync(auditPath, 'utf8'));
      // WL-557: الحكمُ نفسُه الذي يُطبِّقُه audit:check (‏الإعذارُ الضيّقُ المؤقّتُ بملفِّ القفلِ في الجذرِ نفسِه).
      const lockPath = path.join(repoRoot, 'package-lock.json');
      const lockBytes = existsSync(lockPath) ? readFileSync(lockPath) : null;
      const lock = lockBytes ? JSON.parse(lockBytes.toString('utf8')) : {};
      const now = new Date();
      const { blocking } = evaluateAudit(audit, lock, now);
      if (blocking.length > 0) {
        violations.push(`R3: ${blocking.length} ثغرة حرجة/عالية في audit-report.json.`);
      }
      // ‏WL-574: حكمٌ مستقلٌّ إضافيّ — لا يُغيّرُ حكمَ evaluateAudit ولا رسالتَه.
      const provenance = checkProvenance(audit, lockBytes, now);
      if (provenance !== '') {
        violations.push(`R3: تقريرُ التدقيقِ غيرُ موثوقِ المنشأ (‏WL-574): ${provenance}.`);
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

  // R6 (‏WL-568): استيراداتُ شفرةِ التشغيلِ مُعلَنةٌ تبعيّاتِ تشغيل
  const undeclared = runtimeImportViolations(repoRoot, pkg);
  if (undeclared.length > 0) {
    violations.push(
      `R6: حزمٌ تستوردُها \`src/\` وليست في \`dependencies\`/\`optionalDependencies\` (‏\`npm ci --omit=dev\` يُسقِطُها): ${undeclared.join('، ')}.`,
    );
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
