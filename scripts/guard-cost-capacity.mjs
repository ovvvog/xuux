#!/usr/bin/env node
/**
 * حاجزُ تتبّعِ التكلفةِ والسعة — البوابةُ السابعةُ والثلاثون في تسلسلِ الحواجزِ
 * المُعلَنِ في سجلِّ العمل (الخطوة `M10.04`).
 *
 * **رتبةٌ مقيسةٌ لا مُدَّعاة (المادة 4):** موضعُ هذا الحاجزِ المقيسُ في سلسلةِ
 * `npm run validate` هو **الخامسةُ والثلاثون** بين خطواتِها كلِّها (وهي ثمانٍ
 * وثلاثون بعد إضافتِه)، و**السابعُ والعشرون** بين حواجزِها (وهي تسعٌ وعشرون)،
 * وهو **التاسعُ والعشرون** عدداً بين نصوصِ `guard:*` في `package.json`.
 * والرتبةُ المُعلَنةُ في العنوانِ أعلاه تتبع التسلسلَ المكتوبَ في سجلِّ العملِ
 * منذ `WL-043`، وفارقُهما دَينُ توثيقٍ **سابقٌ** لهذه الخطوةِ مسجَّلٌ في
 * `WL-048` و`WL-050`–`WL-055`، ولا يُصلَح بتعديلِ سجلٍّ قديم (المادة 4).
 *
 * البوابةُ السادسةُ والثلاثون تحرس أن يكون لكلِّ هدفٍ مسارُ استجابةٍ مكتوب.
 * وهذه تحرس أن يكون لكلِّ عملٍ **ثمنٌ مُعلَنٌ وصاحبٌ يُسنَد إليه وسقفٌ يُقاس
 * عليه**. وعشرُ قواعد:
 *
 *   R0: `config/cost-capacity.yaml` تُحمَّل بمخطَّطها الصارم؛ ووثيقةٌ تُخالف
 *       مخطَّطَها تُوقف البوابةَ قبل أيِّ فحصٍ آخر.
 *   R1: **مصدرُ حقيقةٍ واحدٌ للموارد**: كلُّ `resource` في بنودِ الكلفةِ معلَنٌ
 *       في `config/quotas.yaml` — فالحصّةُ تمنع التجاوزَ وهذه تُسعِّر ما وقع
 *       تحتَها، ولا قائمةَ مواردَ ثانيةً تُصان في موضعين فتتباعدان.
 *   R2: كلُّ بندٍ وبُعدٍ وحدٍّ وقاعدةٍ ورمزِ رفضٍ وضمانٍ موثَّقٌ بالاسمِ في
 *       `docs/COST_CAPACITY.md` (المادة 1).
 *   R3: التقابلُ في الاتجاهين بين `refusalCodes` في الوثيقةِ و`COST_ERRORS` في
 *       `src/cost-capacity/errors.mjs`.
 *   R4: كلُّ رمزِ ضمانٍ (`G-COST-*`) حاضرٌ **نصّاً** في ملفِّ إنفاذِه المُعلَن.
 *   R5: **الأثمانُ والسقوفُ وخطوطُ الأساسِ بياناتٌ لا كود** (الضمان
 *       `G-COST-PRICES-ARE-DATA`): كلُّ رقمٍ منها
 *       (‏`unitPriceMilli` و`perUnits` و`limitUnits` و`baselineUnits`، من ١٠٠
 *       فما فوق) **لا يظهر نصّاً** في وحداتِ المسار؛ فرقمٌ في الوثيقةِ وفي
 *       الكودِ مصدرا حقيقةٍ لشيءٍ واحدٍ يُشدَّد أحدُهما ويبقى الآخر.
 *   R6: **الدرجاتُ من مركزِ العملياتِ لا قائمةً ثانية**: كلُّ `severity` في
 *       الحدودِ والقواعدِ معلَنةٌ في `config/operations-center.yaml`، وكلُّ
 *       `channel` معلَنٌ في `config/incident-response.yaml`.
 *   R7: الحاجزُ مربوطٌ بالمسار: `npm run guard:cost-capacity` في `validate` وفي
 *       `.github/workflows/ci.yml` بنصٍّ واحد؛ فبوابةٌ لا تُشغَّل آلياً ليست
 *       بوابةً بل نيّة.
 *   R8: **الدفترُ يقرأ ويُسنِد ولا يقيس ولا يستورد**: لا `addCounter(` ولا
 *       `recordHistogram(` في وحداتِه، ولا استيرادَ من `../telemetry/` ولا
 *       `../service-levels/` ولا `../operations/` ولا `../incident-response/`
 *       — المركزُ **يُحقَن** لا يُستورَد، وإلا صار في التركيبِ مركزان.
 *       و**لا سجلَّ حوادثَ ثانياً**: تقييدُ الحادثةِ من `operations.record(`
 *       وحدَه.
 *   R9: **لا ساعةَ نظامٍ ولا مؤقِّتَ ذاتيّ**: `Date.now(` لا يظهر إلا مرّةً
 *       واحدةً على الأكثرِ (قيمةً افتراضيةً في المُنشئ)، ولا `setTimeout(` ولا
 *       `setInterval(`؛ **واختبارُ القبولِ يقرأ ملفَّ السجلِّ من القرصِ**
 *       (`readFileSync`) ويُنادي `report(` — فمعيارُ «تقريرٍ مُولَّدٍ فعلاً» لا
 *       يُقاس بنصٍّ يُقرأ في حاجزٍ بل بسلوكٍ يُشغَّل.
 *
 * **حدٌّ معلَن أول:** الحاجزُ يقرأ النصَّ والوثيقةَ ولا يُسعِّر شيئاً ولا يُولّد
 * تقريراً؛ ومعيارُ القبولِ («تقرير تكلفة شهري مُولَّد فعلياً») سلوكٌ مقيسٌ في
 * `tests/cost-capacity/monthly-report.test.mjs` على تركيبٍ حقيقيٍّ بسجلٍّ دائمٍ
 * على القرصِ ومركزِ عملياتٍ حقيقيّ.
 *
 * **حدٌّ معلَن ثانٍ:** R5 يقيس الأرقامَ من ١٠٠ فما فوقَ وحدَها؛ فالأعدادُ
 * الصغيرةُ تظهر في أيِّ كودٍ لأسبابٍ أخرى (فهارسُ ومُعامِلاتُ تقريبٍ)، وفحصُها
 * نصّاً كان سيُنتج ضجيجاً لا حراسة.
 *
 * **حدٌّ معلَن ثالث:** الحاجزُ لا يفحص وجودَ الوكيلِ ولا النموذجِ في سجلَّيهما
 * لأنّ عضويتَهما **ديناميكيةٌ مُعلَنةٌ** في الوثيقة؛ وذلك حدٌّ مسجَّلٌ في
 * `docs/REMAINING_WORK.md` لا سهوٌ يُكتشَف.
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import YAML from 'yaml';

import { COST_ERRORS, loadCostCapacityPolicy } from '../src/cost-capacity/index.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

/** @param {string} relative @returns {string} */
function readOrEmpty(relative) {
  const file = path.join(ROOT, relative);
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
}

/** @type {string[]} */
const violations = [];

/** وحداتُ المسارِ التي تُفحَص نصّاً — تُعلَن هنا كي لا يُفلت ملفٌّ بإضافتِه. */
const MODULE_FILES = [
  'src/cost-capacity/cost-capacity.mjs',
  'src/cost-capacity/pricing.mjs',
  'src/cost-capacity/deviation.mjs',
  'src/cost-capacity/errors.mjs',
  'src/cost-capacity/index.mjs',
];

// ── R0: الوثيقةُ تُحمَّل بمخطَّطها ──
/** @type {import('../src/cost-capacity/cost-capacity.mjs').CostCapacityPolicy | null} */
let policy = null;
try {
  policy = loadCostCapacityPolicy();
} catch (error) {
  violations.push(
    `R0: وثيقةُ التكلفةِ والسعةِ لا تُحمَّل: ${error instanceof Error ? error.message : String(error)}`,
  );
}

if (policy !== null) {
  const doc = readOrEmpty('docs/COST_CAPACITY.md');

  // ── R1: المواردُ من وثيقةِ الحصصِ لا من قائمةٍ ثانية ──
  /** @type {Set<string>} */
  const quotaResources = new Set();
  try {
    const quotas = YAML.parse(readOrEmpty('config/quotas.yaml'));
    for (const quota of quotas?.quotas ?? []) quotaResources.add(String(quota.resource));
  } catch (error) {
    violations.push(
      `R1: وثيقةُ الحصصِ لا تُقرأ فلا يُقاس تقابلُ المواردِ: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  for (const item of policy.costItems) {
    if (quotaResources.size > 0 && !quotaResources.has(item.resource)) {
      violations.push(
        `R1: المورد «${item.resource}» في البند «${item.id}» غيرُ معلَنٍ في config/quotas.yaml — ومصدرا حقيقةٍ لموردٍ واحدٍ يتباعدان عند أوّلِ تعديل.`,
      );
    }
  }

  // ── R2: كلُّ معرّفٍ موثَّقٌ بالاسم ──
  /** @type {Array<[string, string]>} */
  const documented = [
    ...policy.costItems.map((item) => /** @type {[string, string]} */ (['بند الكلفة', item.id])),
    ...policy.dimensions.map(
      (dimension) => /** @type {[string, string]} */ (['بُعد الإسناد', dimension.id]),
    ),
    ...policy.capacityLimits.map(
      (limit) => /** @type {[string, string]} */ (['حدُّ السعة', limit.id]),
    ),
    ...policy.deviationRules.map(
      (rule) => /** @type {[string, string]} */ (['قاعدة الانحراف', rule.id]),
    ),
    ...policy.refusalCodes.map((code) => /** @type {[string, string]} */ (['رمز الرفض', code])),
    ...policy.guarantees.map(
      (guarantee) => /** @type {[string, string]} */ (['الضمان', guarantee.id]),
    ),
  ];
  for (const [kind, id] of documented) {
    if (!doc.includes(id)) {
      violations.push(
        `R2: ${kind} «${id}» غيرُ موثَّقٍ بالاسمِ في docs/COST_CAPACITY.md — ولا عملَ بلا توثيقٍ (المادة 1).`,
      );
    }
  }

  // ── R3: تقابلُ رموزِ الرفضِ في الاتجاهين ──
  /** @type {Set<string>} */
  const declaredCodes = new Set(policy.refusalCodes);
  /** @type {Set<string>} */
  const implementedCodes = new Set(Object.values(COST_ERRORS));
  for (const code of declaredCodes) {
    if (!implementedCodes.has(code)) {
      violations.push(
        `R3: الرمز «${code}» معلَنٌ في الوثيقةِ ولا وجودَ له في COST_ERRORS — وعدٌ لا يُنفَّذ.`,
      );
    }
  }
  for (const code of implementedCodes) {
    if (!declaredCodes.has(code)) {
      violations.push(
        `R3: الرمز «${code}» في COST_ERRORS ولا إعلانَ له في الوثيقةِ — رمزٌ لا يجده قارئُ الوثيقة.`,
      );
    }
  }

  // ── R4: كلُّ ضمانٍ حاضرٌ نصّاً في ملفِّ إنفاذِه ──
  for (const guarantee of policy.guarantees) {
    const enforcing = readOrEmpty(guarantee.enforcedIn);
    if (enforcing === '') {
      violations.push(`R4: ملفُّ إنفاذِ الضمان «${guarantee.id}» (${guarantee.enforcedIn}) غائب.`);
      continue;
    }
    if (!enforcing.includes(guarantee.id)) {
      violations.push(
        `R4: الضمان «${guarantee.id}» ليس حاضراً نصّاً في ملفِّ إنفاذِه ${guarantee.enforcedIn} — وضمانٌ لا يُشار إليه في منفِّذِه ضمانٌ يُنسى عند أوّلِ إعادةِ كتابة.`,
      );
    }
  }

  // ── R5: الأثمانُ والسقوفُ بياناتٌ لا كود ──
  /** @type {Set<number>} */
  const numbers = new Set();
  for (const item of policy.costItems) {
    numbers.add(item.unitPriceMilli);
    numbers.add(item.perUnits);
  }
  for (const limit of policy.capacityLimits) numbers.add(limit.limitUnits);
  for (const rule of policy.deviationRules) numbers.add(rule.baselineUnits);
  for (const relative of MODULE_FILES) {
    const source = readOrEmpty(relative);
    for (const value of numbers) {
      if (value < 100) continue;
      if (new RegExp(`(?<![\\d_])${value}(?![\\d_])`).test(source)) {
        violations.push(
          `R5: الرقم ${value} من وثيقةِ التكلفةِ مكتوبٌ نصّاً في ${relative} — ورقمٌ في الوثيقةِ وفي الكودِ مصدرا حقيقةٍ لشيءٍ واحدٍ يُشدَّد أحدُهما ويبقى الآخرُ يعمل بالقديم.`,
        );
      }
    }
  }

  // ── R6: الدرجاتُ والقنواتُ من وثائقِها النافذة ──
  /** @type {Set<string>} */
  const severities = new Set();
  /** @type {Set<string>} */
  const channels = new Set();
  try {
    const operations = YAML.parse(readOrEmpty('config/operations-center.yaml'));
    for (const severity of operations?.incidents?.severities ?? [])
      severities.add(String(severity));
  } catch {
    violations.push('R6: وثيقةُ مركزِ العملياتِ لا تُقرأ فلا يُقاس تقابلُ الدرجات.');
  }
  const incidentResponseText = readOrEmpty('config/incident-response.yaml');
  for (const match of incidentResponseText.matchAll(/channel:[a-z][a-z0-9-]*/g)) {
    channels.add(match[0]);
  }
  for (const entry of [...policy.capacityLimits, ...policy.deviationRules]) {
    if (severities.size > 0 && !severities.has(entry.severity)) {
      violations.push(
        `R6: الدرجة «${entry.severity}» في «${entry.id}» غيرُ معلَنةٍ في config/operations-center.yaml — ودرجةٌ ثانيةٌ تُخترَع هنا درجةٌ لا يُعرف ثقلُها في المركز.`,
      );
    }
  }
  for (const rule of policy.deviationRules) {
    if (channels.size > 0 && !channels.has(rule.channel)) {
      violations.push(
        `R6: القناة «${rule.channel}» في القاعدة «${rule.id}» غيرُ معلَنةٍ في config/incident-response.yaml — ولا قائمةَ قنواتٍ ثانيةً تُصان هنا.`,
      );
    }
  }

  // ── R7: الحاجزُ مربوطٌ بالمسار ──
  const packageJson = readOrEmpty('package.json');
  const workflow = readOrEmpty('.github/workflows/ci.yml');
  if (!packageJson.includes('guard:cost-capacity')) {
    violations.push('R7: نصُّ guard:cost-capacity غيرُ معلَنٍ في package.json.');
  }
  if (!packageJson.includes('npm run guard:cost-capacity')) {
    violations.push(
      'R7: الحاجزُ ليس في سلسلةِ npm run validate — وبوابةٌ لا تُشغَّل آلياً ليست بوابةً بل نيّة.',
    );
  }
  if (!workflow.includes('npm run guard:cost-capacity')) {
    violations.push(
      'R7: الحاجزُ ليس في .github/workflows/ci.yml — والأخضرُ المحليُّ ليس حكمَ CI (المادة 2).',
    );
  }

  // ── R8: الدفترُ يقرأ ويُسنِد ولا يقيس ولا يستورد ──
  for (const relative of MODULE_FILES) {
    const source = readOrEmpty(relative);
    if (source === '') {
      violations.push(`R8: وحدةُ المسار ${relative} غائبة.`);
      continue;
    }
    for (const forbidden of ['addCounter(', 'recordHistogram(']) {
      if (source.includes(forbidden)) {
        violations.push(
          `R8: ${relative} يقيس بنفسِه (${forbidden}) — والدفترُ يُسنِد ويقرأ، ومقياسٌ ثانٍ رقمٌ ثانٍ لشيءٍ واحد.`,
        );
      }
    }
    for (const forbidden of [
      "from '../telemetry/",
      "from '../service-levels/",
      "from '../operations/",
      "from '../incident-response/",
    ]) {
      if (source.includes(forbidden)) {
        violations.push(
          `R8: ${relative} يستورد ${forbidden} — والمركزُ واللوحةُ يُحقَنان لا يُستورَدان، وإلا صار في التركيبِ مثيلان.`,
        );
      }
    }
  }
  const engine = readOrEmpty('src/cost-capacity/cost-capacity.mjs');
  if (!engine.includes('operations.record(')) {
    violations.push(
      'R8: تقييدُ الحادثةِ لا يمرّ من operations.record( في محرِّكِ الدفتر — ولا يُنشأ سجلُّ حوادثَ ثانٍ بديلاً عن مركزِ العمليات.',
    );
  }
  if (!engine.includes('#clock(')) {
    violations.push(
      'R9: محرِّكُ الدفترِ بلا مِقبضِ ساعةٍ متحقِّقةٍ (#clock) — وزمنٌ لا يُفحَص زمنٌ يَنقل قيداً من شهرٍ إلى شهر.',
    );
  }

  // ── R9: لا ساعةَ نظامٍ ولا مؤقِّتَ ذاتيّ، والقبولُ سلوكٌ لا نصّ ──
  for (const relative of MODULE_FILES) {
    const source = readOrEmpty(relative);
    const systemClocks = source.split('Date.now(').length - 1;
    if (systemClocks > 1) {
      violations.push(
        `R9: ${relative} يقرأ ساعةَ النظامِ ${systemClocks} مرّاتٍ — والمسموحُ موضعٌ واحدٌ قيمةً افتراضيةً في المُنشئ.`,
      );
    }
    for (const forbidden of ['setTimeout(', 'setInterval(']) {
      if (source.includes(forbidden)) {
        violations.push(
          `R9: ${relative} فيه ${forbidden} — ولا جدولةَ ذاتيةَ التشغيلِ في هذه الخطوة؛ التقريرُ يُولَّد بنداءٍ وساعتُه مُمرَّرة.`,
        );
      }
    }
  }
  for (const relative of [
    'config/cost-capacity.yaml',
    'config/schemas/cost-capacity.schema.json',
    'tests/cost-capacity/cost-capacity.test.mjs',
    'tests/cost-capacity/monthly-report.test.mjs',
    'docs/COST_CAPACITY.md',
  ]) {
    if (readOrEmpty(relative) === '') {
      violations.push(`R9: الملفُّ ${relative} غائبٌ — ولا ادّعاءَ بلا دليلٍ يُشغَّل (المادة 2).`);
    }
  }
  const acceptance = readOrEmpty('tests/cost-capacity/monthly-report.test.mjs');
  if (acceptance !== '') {
    if (!acceptance.includes('readFileSync')) {
      violations.push(
        'R9: اختبارُ القبولِ لا يقرأ ملفَّ السجلِّ من القرصِ (readFileSync غائب) — وتقريرٌ يُبنى على ذاكرةِ العمليةِ عن نفسِها ليس تقريراً مُولَّداً من دفتر.',
      );
    }
    if (!acceptance.includes('PersistentEventLog')) {
      violations.push(
        'R9: اختبارُ القبولِ لا يُركِّب سجلًّا دائماً حقيقيّاً (PersistentEventLog غائب) — وسجلٌّ ذاكريٌّ يُسقِط معنى «الدليلِ من القرص».',
      );
    }
    if (!acceptance.includes('.report(')) {
      violations.push(
        'R9: اختبارُ القبولِ لا يُنادي report( — ومعيارُ «تقريرِ تكلفةٍ شهريٍّ مُولَّدٍ فعلياً» لا يُقاس بنصٍّ يُقرأ.',
      );
    }
  }
}

if (violations.length > 0) {
  console.error('⛔ حاجز تتبّع التكلفة والسعة رفض:');
  for (const violation of violations) console.error(`   • ${violation}`);
  process.exit(1);
}

const itemCount = policy === null ? 0 : policy.costItems.length;
const dimensionCount = policy === null ? 0 : policy.dimensions.length;
const limitCount = policy === null ? 0 : policy.capacityLimits.length;
const ruleCount = policy === null ? 0 : policy.deviationRules.length;
const sectionCount = policy === null ? 0 : policy.report.requiredSections.length;
const codeCount = policy === null ? 0 : policy.refusalCodes.length;
const guaranteeCount = policy === null ? 0 : policy.guarantees.length;
console.log(
  `✅ حاجز تتبّع التكلفة والسعة: ${itemCount} بنودِ كلفةٍ كلٌّ مربوطٌ بموردِ حصّةٍ معلَنٍ في config/quotas.yaml لا بقائمةِ مواردَ ثانية، و${dimensionCount} أبعادِ إسنادٍ — مؤسسةٌ ووكيلٌ ونموذجٌ — لكلٍّ بادئتُه ومصدرُ عضويتِه المُعلَن، و${limitCount} حدودِ سعةٍ و${ruleCount} قواعدِ انحرافٍ درجاتُها من وثيقةِ مركزِ العملياتِ وقنواتُها من وثيقةِ مسارِ الاستجابةِ لا من قائمتين ثانيتين، و${sectionCount} أقسامٍ لازمةٍ في تقريرِ شهرٍ يُولَّد من قيودِ السجلِّ على القرصِ لا من ذاكرةِ كاتبِه، و${codeCount} رمزَ رفضٍ متقابلةً في الاتجاهين مع \`COST_ERRORS\`، و${guaranteeCount} ضماناتٍ كلٌّ برمزٍ حاضرٍ في ملفِّ إنفاذِه، والأثمانُ والسقوفُ وخطوطُ الأساسِ كلُّها من الوثيقةِ لا من الكودِ، والساعةُ مُمرَّرةٌ ولا مؤقِّتَ يعمل بنفسِه، والدفترُ يُسنِد ويقرأ ولا يقيس ولا يستورد طبقةً يُحقَن مثيلُها ولا يُنشئ سجلَّ حوادثَ ثانياً.`,
);
