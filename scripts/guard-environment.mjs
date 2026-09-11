#!/usr/bin/env node
/**
 * حاجزُ عقدِ البيئةِ والإقامةِ بأمرٍ واحد — البوابةُ الثامنةُ والثلاثون في
 * تسلسلِ الحواجزِ المُعلَنِ في سجلِّ العمل (الخطوة `M10.05`).
 *
 * **رتبةٌ مقيسةٌ لا مُدَّعاة (المادة 4):** موضعُ هذا الحاجزِ المقيسُ في سلسلةِ
 * `npm run validate` هو **السادسةُ والثلاثون** بين خطواتِها كلِّها (وهي تسعٌ
 * وثلاثون بعد إضافتِه)، و**الثامنُ والعشرون** بين حواجزِها (وهي ثلاثون)، وهو
 * **السابعُ والعشرون** ترتيباً معجميّاً بين نصوصِ `guard:*` في `package.json`
 * (وهي ثلاثون). والرتبةُ المُعلَنةُ في العنوانِ أعلاه تتبع التسلسلَ المكتوبَ في
 * سجلِّ العملِ منذ `WL-043`، وفارقُهما دَينُ توثيقٍ **سابقٌ** لهذه الخطوةِ
 * مسجَّلٌ في `WL-048` و`WL-050`–`WL-056`، ولا يُصلَح بتعديلِ سجلٍّ قديم.
 *
 * البوابةُ السابعةُ والثلاثون تحرس أن يكون لكلِّ عملٍ ثمنٌ مُعلَنٌ وسقفٌ يُقاس.
 * وهذه تحرس ما هو **أسبقُ من كلِّ ذلك**: أن تكون البيئةُ التي يجري فيها العملُ
 * **مُعلَنةً في وثيقةٍ واحدةٍ**، وأن تُقام **بأمرٍ واحدٍ**، وأن يكون لصلاحِها
 * **فحصٌ يُصدر حكماً** لا تشخيصاً بالفشل. واثنتا عشرةَ قاعدة:
 *
 *   R0: `config/environment.yaml` تُحمَّل بمخطَّطها الصارم؛ ووثيقةٌ تُخالف
 *       مخطَّطَها تُوقف البوابةَ قبل أيِّ فحصٍ آخر.
 *   R1: كلُّ وضعٍ وأداةٍ ومتغيّرٍ ومجلَّدٍ وطورٍ ومجسٍّ ورمزِ رفضٍ وضمانٍ وحكمِ
 *       صحّةٍ موثَّقٌ **بالاسمِ** في `docs/ENVIRONMENT.md` (المادة 1).
 *   R2: التقابلُ في الاتجاهين بين `refusalCodes` في الوثيقةِ و`ENV_ERRORS` في
 *       `src/environment/errors.mjs`.
 *   R3: كلُّ رمزِ ضمانٍ (`G-ENV-*`) حاضرٌ **نصّاً** في ملفِّ إنفاذِه المُعلَن.
 *   R4: **الدرجاتُ من مركزِ العملياتِ لا قائمةً ثانية**: كلُّ `severity` في
 *       المجساتِ معلَنةٌ في `config/operations-center.yaml`.
 *   R5: **الأوامرُ والمهلُ بياناتٌ لا كود**: لا أمرَ طورٍ (`command` مع
 *       `args`) يظهر نصّاً في `scripts/bootstrap.mjs` ولا مهلةَ طورٍ
 *       (`timeoutMs`) — فمن كتب أمرَ الإقامةِ في المُنفِّذِ جعل الوثيقةَ وصفاً
 *       لما يجري في مكانٍ آخر.
 *   R6: الحاجزُ مربوطٌ بالمسار: `npm run guard:environment` في `validate` وفي
 *       `.github/workflows/ci.yml` بنصٍّ واحد؛ فبوابةٌ لا تُشغَّل آلياً ليست
 *       بوابةً بل نيّة.
 *   R7: **الحكمُ نقيٌّ لا يلمس القرصَ**: `src/environment/probes.mjs` و
 *       `src/environment/plan.mjs` و`src/environment/tool-readiness.mjs` و
 *       `src/environment/ledger-chain.mjs`
 *       **لا تستورد** `node:fs` ولا
 *       `node:child_process` ولا `node:process` — فالضمان
 *       `G-ENV-VERIFY-READ-ONLY` بنيةٌ لا نيّة، ووحدةٌ لا تملك المُلحِقَ لا
 *       تستطيع أن تكتب ولو أراد كاتبُها.
 *   R8: **لا ساعةَ نظامٍ ولا مؤقِّتَ ذاتيّ** في وحداتِ المسار: `Date.now(` لا
 *       يظهر إلا مرّةً واحدةً على الأكثرِ (قيمةً افتراضيةً في المُنشئ)، ولا
 *       `setTimeout(` ولا `setInterval(`.
 *   R9: **اختبارُ القبولِ يُشغِّل عمليّاتٍ حقيقيّةً**: يستورد
 *       `node:child_process` ويُنادي السكربتين بالاسمِ ويقرأ رمزَ الخروجِ —
 *       فمعيارُ «تشغيلٌ بأمرٍ واحد» لا يُقاس بنداءِ دالّةٍ في العمليّةِ نفسِها،
 *       ولا بنصٍّ يُقرأ في حاجز.
 *   R10: **سطحُ استدعاءِ العمليّاتِ محصورٌ ومُعلَن** (وُسِّع في `WL-117` ليشمل
 *        التحميلَ الديناميَّ الحرفيَّ، ويَرُدَّ ما لا يُقاس نصّاً): يُحسَب الإغلاقُ التبعيُّ
 *       للاستيراداتِ النسبيّةِ ابتداءً من مدخلَي المسارِ المُعلَنين في
 *       `docs/ENVIRONMENT.md` §١٦، ثم يُقابَل من يستورد `node:child_process`
 *       فيه بالمائدةِ المُعلَنةِ هناك **في الاتجاهين**: جامعٌ ثانٍ يتسلّل يُردّ،
 *       وإعلانٌ بقي بعد زوالِ سببِه يُردّ كذلك. والحكمُ في وحدةٍ نقيّةٍ
 *       (`src/environment/spawn-surface.mjs`) تُحقَن قارئَها فلا تلمس القرصَ.
 *   R11: **حضورُ الأداةِ ليس صلاحيتَها**: كلُّ أداةٍ تُعلِن `readiness` في
 *        العقدِ موثَّقةٌ **باسمِها وبنصِّ أمرِها** في `docs/ENVIRONMENT.md` §١٧
 *        والتقابلُ في الاتجاهين؛ وأمرُ الجاهزيّةِ يخالف أمرَ الإصدارِ وإلاّ
 *        فهو قياسٌ يُعاد بنفسِه ثمّ يُقرأ توكيداً — فـ`--version` يقرأ
 *        الملفَّ التنفيذيَّ وحدَه ولا يمسُّ ما تَعِدُ به الأداةُ. والفصلُ
 *        واجبٌ: الحكمُ في `src/environment/tool-readiness.mjs` النقيّة،
 *        والتشغيلُ في جامعِ الوقائعِ وحدَه (‏`R7` و`R10`).
 *
 * **حدٌّ معلَن أول:** الحاجزُ يقرأ النصَّ والوثيقةَ **ولا يُقيم بيئةً ولا
 * يفحصها**؛ ومعيارُ القبولِ («بيئةٌ نظيفةٌ ⇒ نظامٌ عاملٌ بأمرٍ واحدٍ ⇒ فحصُ
 * صحّةٍ ناجح») سلوكٌ مقيسٌ في `tests/environment/one-command.test.mjs` بعمليّاتٍ
 * أبناءٍ حقيقيّةٍ على عقدٍ حقيقيّ.
 *
 * **حدٌّ معلَن ثانٍ:** R5 يقيس أوامرَ الأطوارِ ومهلَها وحدَها؛ ولا يقيس أسماءَ
 * المجلَّداتِ لأنّها تُنشَأ من `plan.directories` المقروءةِ من الوثيقةِ ولا
 * تُكتب في المُنفِّذ.
 *
 * **حدٌّ معلَن ثالث (ضاق بـR10 ولم يزُل):** كان الحاجزُ لا يفحص حصرَ جمعِ
 * الوقائعِ في `scripts/lib/environment-facts.mjs` أصلاً؛ وR10 تفحصه الآن على
 * **الاستيرادِ الساكنِ داخلَ إغلاقِ المداخلِ المُعلَنة**، ولا تقيس `import()`
 * الديناميَّ ولا `createRequire`، ولا تمتدّ إلى سكربتٍ لا يصله المسار. وأمّا
 * `contract.mjs` فتقرأ الوثيقةَ بحكمِ عملِها ولذلك ليست في قائمةِ النقاء (R7).
 *
 * **حدٌّ معلَنٌ خامس (`ADR 0008`):** رأسُ دفترِ أثرِ الإقامةِ **ذرّيٌّ لا
 * موقَّعٌ**، فالسلسلةُ تكشف الضياعَ والبترَ والتبديلَ الجزئيَّ ولا تصمد أمامَ
 * خصمٍ يملك القرصَ فيُعيد كتابةَ المتنِ والرأسِ معاً. و**`R3-A-01` تبقى
 * مفتوحةً** — ولا يقيس هذا الحاجزُ الدفترَ أصلاً لأنّ الدفترَ أثرُ تشغيلٍ لا
 * نصٌّ في المستودعِ؛ الحكمُ عليه في `verify:env` بالرمزِ `ENV_LEDGER_BROKEN`.
 *
 * **حدٌّ معلَنٌ رابع (R11):** الحاجزُ يقيس **إعلانَ** الجاهزيّةِ وتقابلَه
 * مع الوثيقةِ ومغايرتَه لأمرِ الإصدار؛ **ولا يحكم أنّ أمرَ الجاهزيّةِ المُختارَ
 * هو أصدقُ ما يُقاس به عملُ الأداة** — ذلك حكمٌ هندسيٌّ يُعلَن في `statement`
 * ويُراجَع بالعَين، وحاجزٌ يدّعي قياسَه يدّعي ما لا يقدِر.
 *
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import YAML from 'yaml';

import { ENV_ERRORS, loadEnvironmentContract } from '../src/environment/index.mjs';
import { SPAWN_IMPORT, auditSpawnSurface } from '../src/environment/spawn-surface.mjs';
import {
  auditReadinessSurface,
  toolsDeclaringReadiness,
} from '../src/environment/tool-readiness.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

/** @param {string} relative @returns {string} */
function readOrEmpty(relative) {
  const file = path.join(ROOT, relative);
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
}

/** @type {string[]} */
const violations = [];

/** عددُ مُطلِقي العمليّاتِ ومقاسُ الإغلاقِ — يُملآن في R10 ويُذكران في الحكم. */
let spawnSurfaceSize = 0;
let spawnClosureSize = 0;
let readinessSurfaceSize = 0;

/**
 * قارئٌ يُميّز الغيابَ من الفراغِ — يُحقَن في وحدةِ الحكمِ النقيّةِ (R10).
 *
 * @param {string} relative
 * @returns {string | null}
 */
function sourceOf(relative) {
  const file = path.join(ROOT, relative);
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
}

/**
 * نصُّ قسمٍ من وثيقةٍ بين عنوانِه والعنوانِ التالي من رتبتِه.
 *
 * @param {string} document
 * @param {string} heading
 * @returns {string}
 */
function sectionOf(document, heading) {
  const start = document.indexOf(heading);
  if (start === -1) return '';
  const rest = document.slice(start + heading.length);
  const end = rest.indexOf('\n## ');
  return end === -1 ? rest : rest.slice(0, end);
}

/**
 * المساراتُ المُقتبَسةُ بعلامةِ الشيفرةِ في سطورٍ تُطابق نمطاً.
 *
 * @param {string} text
 * @param {RegExp} pattern
 * @returns {string[]}
 */
function matchAllPaths(text, pattern) {
  /** @type {string[]} */
  const found = [];
  for (const match of text.matchAll(pattern)) {
    const value = match[1];
    if (value !== undefined && value.includes('/')) found.push(value);
  }
  return [...new Set(found)];
}

/** وحداتُ المسارِ التي تُفحَص نصّاً — تُعلَن هنا كي لا يُفلت ملفٌّ بإضافتِه. */
const MODULE_FILES = [
  'src/environment/environment.mjs',
  'src/environment/contract.mjs',
  'src/environment/plan.mjs',
  'src/environment/probes.mjs',
  'src/environment/errors.mjs',
  'src/environment/index.mjs',
  'src/environment/spawn-surface.mjs',
  'src/environment/tool-readiness.mjs',
  'src/environment/ledger-chain.mjs',
];

/** الوحداتُ التي يجب أن تبقى نقيّةً تماماً (R7). */
const PURE_FILES = [
  'src/environment/probes.mjs',
  'src/environment/plan.mjs',
  'src/environment/tool-readiness.mjs',
  'src/environment/ledger-chain.mjs',
];

// ── R0: الوثيقةُ تُحمَّل بمخطَّطها ──
/** @type {import('../src/environment/contract.mjs').EnvironmentContract | null} */
let contract = null;
try {
  contract = loadEnvironmentContract();
} catch (error) {
  violations.push(
    `R0: عقدُ البيئةِ لا يُحمَّل: ${error instanceof Error ? error.message : String(error)}`,
  );
}

if (contract !== null) {
  const doc = readOrEmpty('docs/ENVIRONMENT.md');

  // ── R1: كلُّ معرّفٍ موثَّقٌ بالاسم ──
  /** @type {Array<[string, string]>} */
  const documented = [
    ...contract.profiles.map(
      (profile) => /** @type {[string, string]} */ (['وضع البيئة', profile.id]),
    ),
    ...contract.toolchain.map((tool) => /** @type {[string, string]} */ (['الأداة', tool.id])),
    ...contract.variables.map(
      (variable) => /** @type {[string, string]} */ (['المتغيّر', variable.id]),
    ),
    ...contract.directories.map(
      (directory) => /** @type {[string, string]} */ (['المجلَّد', directory.path]),
    ),
    ...contract.phases.map((phase) => /** @type {[string, string]} */ (['الطور', phase.id])),
    ...contract.probes.map((probe) => /** @type {[string, string]} */ (['المجسّ', probe.id])),
    ...contract.healthCheck.verdicts.map(
      (verdict) => /** @type {[string, string]} */ (['حكم الصحّة', verdict.id]),
    ),
    ...contract.audit.events.map(
      (event) => /** @type {[string, string]} */ (['حدث المساءلة', event.type]),
    ),
    ...contract.refusalCodes.map(
      (entry) => /** @type {[string, string]} */ (['رمز الرفض', entry.code]),
    ),
    ...contract.guarantees.map(
      (guarantee) => /** @type {[string, string]} */ (['الضمان', guarantee.id]),
    ),
  ];
  for (const [kind, id] of documented) {
    if (!doc.includes(id)) {
      violations.push(
        `R1: ${kind} «${id}» غيرُ موثَّقٍ بالاسمِ في docs/ENVIRONMENT.md — ولا عملَ بلا توثيقٍ (المادة 1).`,
      );
    }
  }

  // ── R2: تقابلُ رموزِ الرفضِ في الاتجاهين ──
  /** @type {Set<string>} */
  const declaredCodes = new Set(contract.refusalCodes.map((entry) => entry.code));
  /** @type {Set<string>} */
  const implementedCodes = new Set(Object.values(ENV_ERRORS));
  for (const code of declaredCodes) {
    if (!implementedCodes.has(code)) {
      violations.push(
        `R2: الرمز «${code}» معلَنٌ في الوثيقةِ ولا وجودَ له في ENV_ERRORS — وعدٌ لا يُنفَّذ.`,
      );
    }
  }
  for (const code of implementedCodes) {
    if (!declaredCodes.has(code)) {
      violations.push(
        `R2: الرمز «${code}» في ENV_ERRORS ولا إعلانَ له في الوثيقةِ — رمزٌ لا يجده قارئُ الوثيقة.`,
      );
    }
  }

  // ── R3: كلُّ ضمانٍ حاضرٌ نصّاً في ملفِّ إنفاذِه ──
  for (const guarantee of contract.guarantees) {
    const enforcing = readOrEmpty(guarantee.file);
    if (enforcing === '') {
      violations.push(`R3: ملفُّ إنفاذِ الضمان «${guarantee.id}» (${guarantee.file}) غائب.`);
      continue;
    }
    if (!enforcing.includes(guarantee.id)) {
      violations.push(
        `R3: الضمان «${guarantee.id}» ليس حاضراً نصّاً في ملفِّ إنفاذِه ${guarantee.file} — وضمانٌ لا يُشار إليه في منفِّذِه ضمانٌ يُنسى عند أوّلِ إعادةِ كتابة.`,
      );
    }
  }

  // ── R4: الدرجاتُ من مركزِ العملياتِ لا قائمةً ثانية ──
  /** @type {Set<string>} */
  const declaredSeverities = new Set();
  try {
    const operations = YAML.parse(readOrEmpty('config/operations-center.yaml'));
    for (const severity of operations?.severities ?? []) {
      declaredSeverities.add(String(typeof severity === 'string' ? severity : severity.id));
    }
  } catch (error) {
    violations.push(
      `R4: وثيقةُ مركزِ العملياتِ لا تُقرأ فلا يُقاس تقابلُ الدرجاتِ: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (declaredSeverities.size > 0) {
    for (const probe of contract.probes) {
      if (!declaredSeverities.has(probe.severity)) {
        violations.push(
          `R4: درجةُ المجسِّ «${probe.id}» (${probe.severity}) غيرُ معلَنةٍ في config/operations-center.yaml — وقائمةُ درجاتٍ ثانيةٌ تتباعد عن الأولى عند أوّلِ تعديل.`,
        );
      }
    }
  }

  // ── R5: الأوامرُ والمهلُ بياناتٌ لا كود ──
  const bootstrapSource = readOrEmpty('scripts/bootstrap.mjs');
  if (bootstrapSource === '') {
    violations.push('R5: scripts/bootstrap.mjs غائب — ولا إقامةَ بأمرٍ واحدٍ بلا مُنفِّذ.');
  } else {
    for (const phase of contract.phases) {
      if (phase.command !== undefined && bootstrapSource.includes(`'${String(phase.command)}'`)) {
        violations.push(
          `R5: أمرُ الطورِ «${phase.id}» (${phase.command}) مكتوبٌ نصّاً في scripts/bootstrap.mjs — والأوامرُ بياناتٌ في config/environment.yaml لا كودٌ في المُنفِّذ.`,
        );
      }
      if (bootstrapSource.includes(String(phase.timeoutMs))) {
        violations.push(
          `R5: مهلةُ الطورِ «${phase.id}» (${String(phase.timeoutMs)}) مكتوبةٌ نصّاً في scripts/bootstrap.mjs — والمهلُ بياناتٌ لا كود.`,
        );
      }
    }
  }

  // ── R6: الحاجزُ مربوطٌ بالمسارِ بنصٍّ واحد ──
  const WIRE = 'npm run guard:environment';
  const pkg = readOrEmpty('package.json');
  const ci = readOrEmpty('.github/workflows/ci.yml');
  if (!pkg.includes(WIRE)) {
    violations.push(`R6: «${WIRE}» غيرُ مربوطٍ في سلسلةِ validate — وبوابةٌ لا تُشغَّل نيّة.`);
  }
  if (!ci.includes(WIRE)) {
    violations.push(
      `R6: «${WIRE}» غيرُ مربوطٍ في .github/workflows/ci.yml — والأخضرُ المحليُّ ليس حكماً (المادة 2).`,
    );
  }

  // ── R7: الحكمُ نقيٌّ لا يلمس القرصَ ──
  const FORBIDDEN_IMPORTS = ['node:fs', 'node:child_process', 'node:process'];
  for (const relative of PURE_FILES) {
    const source = readOrEmpty(relative);
    if (source === '') {
      violations.push(`R7: الوحدة ${relative} غائبةٌ فلا يُقاس نقاؤها.`);
      continue;
    }
    for (const specifier of FORBIDDEN_IMPORTS) {
      if (source.includes(`'${specifier}'`)) {
        violations.push(
          `R7: الوحدة ${relative} تستورد «${specifier}» — والحكمُ يجب أن يكون نقيّاً: وحدةٌ لا تملك المُلحِقَ لا تستطيع أن تكتب ولو أراد كاتبُها.`,
        );
      }
    }
  }

  // ── R8: لا ساعةَ نظامٍ ولا مؤقِّتَ ذاتيّ ──
  for (const relative of MODULE_FILES) {
    const source = readOrEmpty(relative);
    if (source === '') continue;
    const clocks = source.split('Date.now(').length - 1;
    if (clocks > 1) {
      violations.push(
        `R8: ${relative} يُنادي Date.now( ${String(clocks)} مرّاتٍ — والساعةُ تُحقَن، فمن قرأها في متنِ منطقِه كتب اختباراً لا يُثبَّت زمنُه.`,
      );
    }
    for (const timer of ['setTimeout(', 'setInterval(']) {
      if (source.includes(timer)) {
        violations.push(
          `R8: ${relative} يستخدم ${timer} — ومؤقِّتٌ يعمل بنفسِه يُخفي أثرَه عن كلِّ اختبار.`,
        );
      }
    }
  }

  // ── R9: اختبارُ القبولِ يُشغِّل عمليّاتٍ حقيقيّة ──
  const acceptance = readOrEmpty('tests/environment/one-command.test.mjs');
  if (acceptance === '') {
    violations.push(
      'R9: tests/environment/one-command.test.mjs غائب — ومعيارُ «تشغيلٌ بأمرٍ واحد» بلا اختبارِ قبولٍ ادّعاء.',
    );
  } else {
    if (!acceptance.includes('node:child_process')) {
      violations.push(
        'R9: اختبارُ القبولِ لا يستورد node:child_process — ونداءُ دالّةٍ في العمليّةِ نفسِها لا يقيس «أمراً واحداً».',
      );
    }
    for (const script of ['scripts/bootstrap.mjs', 'scripts/verify-environment.mjs']) {
      if (!acceptance.includes(script)) {
        violations.push(
          `R9: اختبارُ القبولِ لا يُنادي ${script} بالاسمِ — ومعيارُ القبولِ ثلاثةُ أجزاءٍ: إقامةٌ ثم عملٌ ثم فحصُ صحّةٍ ناجح.`,
        );
      }
    }
    if (!acceptance.includes('status')) {
      violations.push(
        'R9: اختبارُ القبولِ لا يقرأ رمزَ خروجِ العمليّةِ الابنةِ — ورمزُ الخروجِ هو ما يقرؤه المسارُ الآليّ.',
      );
    }
  }

  // ── R10: سطحُ استدعاءِ العمليّاتِ محصورٌ ومُعلَنٌ في الوثيقة ──
  const surfaceSection = sectionOf(doc, '## ١٦.');
  if (surfaceSection === '') {
    violations.push(
      'R10: القسم «١٦. سطحُ استدعاءِ العمليّات» غائبٌ من docs/ENVIRONMENT.md — ولا يُقاس سطحٌ بلا إعلان.',
    );
  } else {
    const entries = matchAllPaths(surfaceSection, /^- `([^`]+)`/gmu);
    const declaredSpawners = matchAllPaths(surfaceSection, /^\| `([^`]+)` \|/gmu);
    if (entries.length === 0 || declaredSpawners.length === 0) {
      violations.push(
        'R10: القسم ١٦ لا يُعلن مداخلَ المسارِ أو مائدةَ الملفّاتِ المسموحِ لها — وقسمٌ بلا قائمتين لا يُقابَل.',
      );
    } else {
      const audit = auditSpawnSurface({ entries, declared: declaredSpawners, sourceOf });
      for (const file of audit.missing) {
        violations.push(
          `R10: الملفُّ «${file}» معلَنٌ في المسارِ ولا وجودَ له — ووثيقةٌ تصف مستودعاً آخر.`,
        );
      }
      for (const file of audit.undeclared) {
        violations.push(
          `R10: «${file}» يستورد ${SPAWN_IMPORT} داخلَ إغلاقِ مسارِ البيئةِ ولا إعلانَ له في docs/ENVIRONMENT.md §١٦ — وجمعُ وقائعَ ثانٍ لا تعرفه الوثيقةُ يُبطِل حصرَ السطح.`,
        );
      }
      for (const file of audit.stale) {
        violations.push(
          `R10: «${file}» معلَنٌ في §١٦ ولم يعد يستورد ${SPAWN_IMPORT} — وإذنٌ بقي بعد زوالِ سببِه يُوسِّع السطحَ بلا حاجةٍ ويُعلِّم القارئَ خطأً.`,
        );
      }
      for (const { file, reasons } of audit.opaque) {
        violations.push(
          `R10: «${file}» يحمل ما لا يُقاس نصّاً (${reasons.join('؛ ')}) داخلَ إغلاقِ مسارِ البيئةِ — وحاجزٌ عجز عن قياسِ ملفٍّ لا يُمرِّرُه، فالمرورُ عند العجزِ يقول «قِستُ فلم أجد» وهو لم يَقِس.`,
        );
      }
      spawnSurfaceSize = audit.spawners.length;
      spawnClosureSize = audit.closure.length;
    }
  }

  // ── R11: حضورُ الأداةِ ليس صلاحيتَها ──
  const readinessTools = toolsDeclaringReadiness(contract);
  for (const tool of readinessTools) {
    const version = contract.toolchain.find((entry) => entry.id === tool.id);
    if (
      version !== undefined &&
      version.args.join('\u0000') === tool.readiness.args.join('\u0000')
    ) {
      violations.push(
        `R11: أمرُ جاهزيّةِ «${tool.id}» هو أمرُ إصدارِها نفسُه — وقياسٌ يُعاد بنفسِه ثمّ يُقرأ توكيداً أسوأُ من بُعدٍ لم يُقَس أصلاً.`,
      );
    }
  }
  const readinessSection = sectionOf(doc, '## ١٧.');
  if (readinessTools.length > 0 && readinessSection === '') {
    violations.push(
      'R11: القسم «١٧. جاهزيّةُ الأدوات» غائبٌ من docs/ENVIRONMENT.md والعقدُ يُعلِن جاهزيّاتٍ — وبُعدٌ يُقاس ولا يُعلَن يُفاجئ قارئَه بحكمٍ لا يعرف من أين جاء.',
    );
  } else {
    /** @type {{ tool: string, command: string }[]} */
    const documentedReadiness = [];
    for (const match of readinessSection.matchAll(/^\| `([^`]+)` \| `([^`]+)` \|/gmu)) {
      const id = match[1];
      const command = match[2];
      if (id !== undefined && command !== undefined)
        documentedReadiness.push({ tool: id, command });
    }
    const audit = auditReadinessSurface({
      tools: readinessTools,
      documented: documentedReadiness,
    });
    for (const id of audit.undeclared) {
      violations.push(
        `R11: الأداةُ «${id}» تُعلِن جاهزيّةً في العقدِ ولا مُدخَلةَ لها في docs/ENVIRONMENT.md §١٧ — وقياسٌ يُغيّر حكمَ البيئةِ ولا تعرفُه الوثيقةُ مُخالفةٌ للمادّة 1.`,
      );
    }
    for (const id of audit.stale) {
      violations.push(
        `R11: «${id}» مُعلَنٌ في §١٧ ولم يعد يُعلِن جاهزيّةً في العقدِ — ومُدخَلةٌ بقيت بعدَ زوالِ سببِها تُعلِّم القارئَ أنّ الأداةَ تُقاس وهي لا تُقاس.`,
      );
    }
    for (const entry of audit.mismatched) {
      violations.push(
        `R11: أمرُ جاهزيّةِ «${entry.tool}» في العقدِ «${entry.contract}» وفي الوثيقةِ «${entry.documented}» — ووثيقةٌ تصف أمراً غيرَ الذي يجري أسوأُ من صمتِها.`,
      );
    }
    readinessSurfaceSize = audit.measured;
  }
}

if (violations.length > 0) {
  console.error('⛔ حاجز عقد البيئة والإقامة بأمر واحد رفض:');
  for (const violation of violations) console.error(`   • ${violation}`);
  process.exit(1);
}

const profileCount = contract === null ? 0 : contract.profiles.length;
const toolCount = contract === null ? 0 : contract.toolchain.length;
const variableCount = contract === null ? 0 : contract.variables.length;
const directoryCount = contract === null ? 0 : contract.directories.length;
const phaseCount = contract === null ? 0 : contract.phases.length;
const probeCount = contract === null ? 0 : contract.probes.length;
const verdictCount = contract === null ? 0 : contract.healthCheck.verdicts.length;
const codeCount = contract === null ? 0 : contract.refusalCodes.length;
const guaranteeCount = contract === null ? 0 : contract.guarantees.length;
console.log(
  `✅ حاجز عقد البيئة والإقامة بأمر واحد: ${profileCount} أوضاعِ بيئةٍ و${toolCount} أدواتٍ لكلٍّ مجالُ إصدارٍ معلَنٌ و${variableCount} متغيّراتٍ لكلٍّ صيغتُه ومَن يلزمُه، و${directoryCount} مجلَّداتِ زمنِ تشغيلٍ تُنشَأ من الوثيقةِ لا من الكودِ، و${phaseCount} أطوارِ إقامةٍ مرتَّبةٍ متكافئةٍ كلُّ تخطٍّ فيها بسببٍ مُسمّى، و${probeCount} مجسّاتٍ درجاتُها من وثيقةِ مركزِ العملياتِ لا من قائمةٍ ثانيةٍ تُصدِر ${verdictCount} أحكامِ صحّةٍ برموزِ خروجٍ من الوثيقةِ، و${codeCount} رمزَ رفضٍ متقابلةً في الاتجاهين مع \`ENV_ERRORS\`، و${guaranteeCount} ضماناتٍ كلٌّ برمزٍ حاضرٍ في ملفِّ إنفاذِه، والحكمُ نقيٌّ لا يستورد قرصاً ولا عمليّةً فلا يستطيع أن يُصلِح ما يفحص، والساعةُ مُمرَّرةٌ ولا مؤقِّتَ يعمل بنفسِه، ومعيارُ «الأمرِ الواحدِ» مقيسٌ بعمليّاتٍ أبناءٍ حقيقيّةٍ لا بنصٍّ يُقرأ، وسطحُ استدعاءِ العمليّاتِ محصورٌ في ${spawnSurfaceSize} ملفّاتٍ معلَنةٍ في الوثيقةِ داخلَ إغلاقٍ تبعيٍّ مقيسٍ من ${spawnClosureSize} ملفّاتٍ، و${readinessSurfaceSize} أداةً تُقاس **صلاحيتُها لا حضورُها وحدَه** بأمرٍ ثانٍ يخالف أمرَ الإصدارِ ومُتقابِلٍ في الاتجاهين مع §١٧ من الوثيقة.`,
);
