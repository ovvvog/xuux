#!/usr/bin/env node
/**
 * حاجزُ مستوياتِ الخدمة — البوابةُ الخامسةُ والثلاثون في تسلسلِ الحواجزِ
 * المُعلَنِ في سجلِّ العمل (الخطوة `M10.02`).
 *
 * **رتبةٌ مقيسةٌ لا مُدَّعاة (المادة 4):** موضعُ هذا الحاجزِ المقيسُ في سلسلةِ
 * `npm run validate` هو **الثالثةُ والثلاثون** بين خطواتِها كلِّها،
 * و**الخامسُ والعشرون** بين حواجزِها؛ وهو **السابعُ والعشرون** عدداً بين نصوصِ
 * `guard:*` في `package.json` (وهي سبعةٌ وعشرون نصّاً بعد إضافتِه). والرتبةُ
 * المُعلَنةُ في العنوانِ أعلاه تتبع التسلسلَ المكتوبَ في سجلِّ العملِ منذ
 * `WL-043`، وفارقُهما دَينُ توثيقٍ **سابقٌ** لهذه الخطوةِ مسجَّلٌ في `WL-048`
 * و`WL-050` و`WL-051` و`WL-052` و`WL-053` ولا يُصلَح بتعديلِ سجلٍّ قديم.
 *
 * البوابةُ الرابعةُ والثلاثون تحرس أن يكون للنداءِ الواحدِ **معرّفُ ارتباطٍ
 * واحد** وأن لا تخرج إشارةٌ باسمٍ لا تعرفه وثيقتُها. وهذه تحرس أن يكون لكلِّ
 * إشارةٍ **هدفٌ مُعلَنٌ تُقاس عليه**، وأن يكون الهدفُ **بياناً لا كوداً**، وأن
 * تقرأ اللوحةُ **مصدرَ الحقيقةِ الواحدَ** لا عدّاداً ثانياً تحفظه لنفسها. وعشرُ
 * قواعد:
 *
 *   R0: `config/service-levels.yaml` تُحمَّل بمخطَّطها الصارم؛ ووثيقةٌ تُخالف
 *       مخطَّطَها تُوقف البوابةَ قبل أيِّ فحصٍ آخر.
 *   R1: **كلُّ مؤشِّرٍ يقرأ مقياساً مُعلَناً بنوعِه**: كلُّ اسمِ مقياسٍ في هدفٍ
 *       حاضرٌ في `config/telemetry.yaml` بالنوعِ الذي يقرؤه (عدّادٌ للمجموعِ
 *       والمُخفِق، ومدرجٌ للمدّة)؛ فهدفٌ على مقياسٍ لا وجودَ له يُقرأ «غيرَ
 *       مقيسٍ» أبداً فيبدو بريئاً.
 *   R2: كلُّ قدرةٍ وكلُّ هدفٍ وكلُّ رمزِ رفضٍ وكلُّ ضمانٍ موثَّقٌ بالاسمِ في
 *       `docs/SERVICE_LEVELS.md`؛ فهدفٌ يُنفَّذ ولا يُوثَّق هدفٌ يُحاسَب عليه
 *       من لا يعرفه.
 *   R3: التقابلُ في الاتجاهين بين `refusalCodes` في الوثيقةِ و`SLO_ERRORS` في
 *       `src/service-levels/service-levels.mjs`.
 *   R4: كلُّ رمزِ ضمانٍ (`G-SLO-*`) حاضرٌ **نصّاً** في ملفِّ إنفاذِه المُعلَن.
 *   R5: **الأهدافُ بياناتٌ لا كود**: كلُّ رقمِ هدفٍ وكلُّ عتبةِ زمنٍ مُعلَنةٍ في
 *       الوثيقةِ **لا يظهر نصّاً** في محرِّكِ اللوحةِ ولا في وحدةِ الميزانية؛
 *       فرقمٌ مكتوبٌ في الكودِ ومكتوبٌ في الوثيقةِ مصدرا حقيقةٍ لشيءٍ واحد،
 *       يُشدَّد أحدهما ويبقى الآخر فتُقرأ اللوحةُ على هدفٍ لم يعد قائماً.
 *   R6: **الساعةُ مُمرَّرةٌ لا ساعةُ النظام**: `Date.now(` لا يظهر في محرِّكِ
 *       اللوحةِ إلا مرّةً واحدةً على الأكثرِ (قيمةً افتراضيةً في المُنشئ)، وكلُّ
 *       قراءةِ زمنٍ تمرّ من `#readClock(` المتحقِّقة، ورمزُ `SLO_CLOCK_INVALID`
 *       حاضرٌ فيه.
 *   R7: الحاجزُ مربوطٌ بالمسار: `npm run guard:service-levels` في `validate`
 *       وفي `.github/workflows/ci.yml`؛ فبوابةٌ لا تُشغَّل آلياً ليست بوابةً بل
 *       نيّة.
 *   R8: **اللوحةُ تقرأ ولا تكتب ولا تستورد**: لا `addCounter(` ولا
 *       `recordHistogram(` ولا `.clear(` في محرِّكِها، ولا استيرادَ من
 *       `../telemetry/` — سجلُّ المقاييسِ **يُحقَن** لا يُستورَد، وإلا صار في
 *       التركيبِ سجلّان.
 *   R9: **لا مقياسَ يتيمٌ ساكناً**: كلُّ مقياسٍ معلَنٍ في وثيقةِ القياسِ يقرؤه
 *       هدفٌ واحدٌ على الأقلِّ (مرآةٌ ساكنةٌ لِـ`SLO_METRIC_ORPHANED` الذي
 *       يُرَدُّ به التركيبُ زمنَ التشغيل)، وملفّا الاختبارِ موجودان، ووحدةُ
 *       الميزانيةِ موجودة.
 *
 * **حدٌّ معلَن أول:** الحاجزُ يقرأ النصَّ والوثيقةَ ولا يقيس نسبةَ التزامٍ ولا
 * يستهلك ميزانية؛ ومعيارُ القبولِ («لوحةٌ تُظهر الأهدافَ والانحرافَ بأرقام»)
 * سلوكٌ مقيسٌ في `tests/service-levels/dashboard.test.mjs` على تركيبٍ حقيقيٍّ لا
 * نصٍّ مقروء.
 *
 * **حدٌّ معلَن ثانٍ:** R5 يقيس **غيابَ الرقمِ نصّاً**؛ فمن كتب الهدفَ حساباً
 * مكافئاً بأرقامٍ أخرى (كسرٍ أو طرحٍ) مرَّ من هذه القاعدة — ويُمسكه اختبارُ
 * الوثيقةِ المُبدَّلةِ في `tests/service-levels/service-levels.test.mjs` لأنه
 * يُشدِّد هدفاً في وثيقةٍ ويقيس أثرَ تشديدِه في الفرق.
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { SLO_ERRORS, loadServiceLevelPolicy } from '../src/service-levels/index.mjs';
import { loadTelemetryPolicy } from '../src/telemetry/index.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

const ENGINE = 'src/service-levels/service-levels.mjs';
const BUDGET = 'src/service-levels/budget.mjs';

/** @type {string[]} */
const violations = [];

/**
 * @param {string} relative
 * @returns {string}
 */
function readOrEmpty(relative) {
  const file = path.join(ROOT, relative);
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
}

/**
 * @param {string} haystack
 * @param {string} needle
 * @returns {number}
 */
function countOf(haystack, needle) {
  if (needle === '') return 0;
  let total = 0;
  let index = haystack.indexOf(needle);
  while (index !== -1) {
    total += 1;
    index = haystack.indexOf(needle, index + needle.length);
  }
  return total;
}

/**
 * @param {unknown} error
 * @returns {string}
 */
function errorText(error) {
  return error instanceof Error ? error.message : String(error);
}

// ── R0: الوثيقتان تُحمَّلان بمخطَّطَيهما، وإلا وقفت البوابة ──

/** @type {import('../src/service-levels/service-levels.mjs').ServiceLevelPolicy | null} */
let policy = null;
try {
  policy = loadServiceLevelPolicy();
} catch (error) {
  violations.push(`R0: وثيقةُ مستوياتِ الخدمةِ لا تُحمَّل بمخطَّطها: ${errorText(error)}`);
}

/** @type {import('../src/telemetry/telemetry.mjs').TelemetryPolicy | null} */
let telemetryPolicy = null;
try {
  telemetryPolicy = loadTelemetryPolicy();
} catch (error) {
  violations.push(
    `R0: وثيقةُ القياسِ الموحّدِ لا تُحمَّل، ولا هدفَ يُقاس على مقياسٍ لا تُقرأ وثيقتُه: ${errorText(error)}`,
  );
}

if (policy !== null) {
  const engine = readOrEmpty(ENGINE);
  const budget = readOrEmpty(BUDGET);

  /** @type {Array<{ capability: string, objective: import('../src/service-levels/service-levels.mjs').ServiceLevelObjective }>} */
  const objectives = [];
  for (const capability of policy.capabilities) {
    for (const objective of capability.objectives) {
      objectives.push({ capability: capability.id, objective });
    }
  }

  // ── R1: كلُّ مؤشِّرٍ يقرأ مقياساً مُعلَناً بنوعِه ──

  /** @type {Set<string>} */
  const referencedMetrics = new Set();
  if (telemetryPolicy !== null) {
    /** @type {Map<string, string>} */
    const declaredMetrics = new Map();
    for (const metric of telemetryPolicy.metrics) declaredMetrics.set(metric.name, metric.kind);

    /**
     * @param {string} objectiveId
     * @param {string | undefined} name
     * @param {'counter' | 'histogram'} kind
     */
    const expect = (objectiveId, name, kind) => {
      if (name === undefined) return;
      referencedMetrics.add(name);
      const actual = declaredMetrics.get(name);
      if (actual === undefined) {
        violations.push(
          `R1: الهدف ${objectiveId} يقرأ المقياس «${name}» وهو غيرُ مُعلَنٍ في config/telemetry.yaml — وهدفٌ على مقياسٍ لا وجودَ له يُقرأ «غيرَ مقيسٍ» أبداً فيبدو بريئاً.`,
        );
        return;
      }
      if (actual !== kind) {
        violations.push(
          `R1: الهدف ${objectiveId} يقرأ «${name}» على أنه ${kind} وهو مُعلَنٌ ${actual}.`,
        );
      }
    };

    for (const { objective } of objectives) {
      expect(objective.id, objective.totalMetric, 'counter');
      expect(objective.id, objective.badMetric, 'counter');
      expect(objective.id, objective.durationMetric, 'histogram');
    }
  }

  // ── R2: كلُّ ما يُنفَّذ موثَّقٌ بالاسم ──

  const doc = readOrEmpty('docs/SERVICE_LEVELS.md');
  if (doc === '') {
    violations.push(
      'R2: docs/SERVICE_LEVELS.md غائبةٌ — وأهدافٌ تُنفَّذ ولا تُوثَّق أهدافٌ يُحاسَب عليها من لا يعرفها.',
    );
  } else {
    for (const capability of policy.capabilities) {
      if (!doc.includes(capability.id)) {
        violations.push(`R2: القدرة ${capability.id} غيرُ موثَّقةٍ.`);
      }
    }
    for (const { objective } of objectives) {
      if (!doc.includes(objective.id)) violations.push(`R2: الهدف ${objective.id} غيرُ موثَّقٍ.`);
    }
    for (const code of policy.refusalCodes) {
      if (!doc.includes(code)) violations.push(`R2: الرمز ${code} غيرُ موثَّقٍ.`);
    }
    for (const guarantee of policy.guarantees) {
      if (!doc.includes(guarantee.id)) violations.push(`R2: الضمان ${guarantee.id} غيرُ موثَّقٍ.`);
    }
  }

  // ── R3: التقابلُ في الاتجاهين بين الوثيقةِ والكتالوج ──

  const catalogCodes = new Set(/** @type {string[]} */ (Object.values(SLO_ERRORS)));
  const declaredCodes = new Set(/** @type {string[]} */ (policy.refusalCodes));
  for (const code of declaredCodes) {
    if (!catalogCodes.has(code)) {
      violations.push(
        `R3: الرمز ${code} مُعلَنٌ في الوثيقةِ وغائبٌ عن SLO_ERRORS — وعدٌ لا يُنفَّذ.`,
      );
    }
  }
  for (const code of catalogCodes) {
    if (!declaredCodes.has(code)) {
      violations.push(
        `R3: الرمز ${code} في SLO_ERRORS وغائبٌ عن refusalCodes — رمزٌ لا يجده قارئُ الوثيقة.`,
      );
    }
  }

  // ── R4: كلُّ ضمانٍ حاضرٌ نصّاً في ملفِّ إنفاذِه ──

  for (const guarantee of policy.guarantees) {
    const source = readOrEmpty(guarantee.enforcedIn);
    if (source === '') {
      violations.push(`R4: ملفُّ إنفاذِ الضمان ${guarantee.id} (${guarantee.enforcedIn}) غائبٌ.`);
      continue;
    }
    if (!source.includes(guarantee.id)) {
      violations.push(
        `R4: الضمان ${guarantee.id} غيرُ حاضرٍ نصّاً في ${guarantee.enforcedIn} — ضمانٌ يُقرأ ولا يُقاس.`,
      );
    }
    for (const code of guarantee.codes) {
      if (!source.includes(code)) {
        violations.push(
          `R4: الضمان ${guarantee.id} يَعِد بالرمز ${code} وهو غيرُ حاضرٍ في ${guarantee.enforcedIn}.`,
        );
      }
    }
  }

  // ── R5: الأهدافُ بياناتٌ لا كود ──

  /** @type {Set<string>} */
  const objectiveNumbers = new Set();
  for (const { objective } of objectives) {
    objectiveNumbers.add(String(objective.target));
    if (objective.thresholdMs !== undefined) objectiveNumbers.add(String(objective.thresholdMs));
  }
  for (const literal of objectiveNumbers) {
    for (const [relative, source] of /** @type {[string, string][]} */ ([
      [ENGINE, engine],
      [BUDGET, budget],
    ])) {
      if (source.includes(literal)) {
        violations.push(
          `R5: الرقم ${literal} من وثيقةِ الأهدافِ مكتوبٌ نصّاً في ${relative} — مصدرا حقيقةٍ لرقمٍ واحدٍ ينحرف أحدهما بأوّل تشديد.`,
        );
      }
    }
  }

  // ── R6: الساعةُ مُمرَّرةٌ لا ساعةُ النظام ──

  const systemClock = countOf(engine, 'Date.now(');
  if (systemClock > 1) {
    violations.push(
      `R6: ساعةُ النظامِ تُنادى ${systemClock} مرّةً في ${ENGINE} — والمسموحُ مرّةٌ واحدةٌ قيمةً افتراضيةً في المُنشئ.`,
    );
  }
  if (!engine.includes('#readClock(')) {
    violations.push(`R6: قراءةُ الزمنِ في ${ENGINE} لا تمرّ من #readClock( المتحقِّقة.`);
  }
  if (!engine.includes(SLO_ERRORS.CLOCK_INVALID)) {
    violations.push(`R6: الرمز ${SLO_ERRORS.CLOCK_INVALID} غائبٌ عن ${ENGINE}.`);
  }

  // ── R7: الحاجزُ مربوطٌ بالمسار ──

  const packageJson = readOrEmpty('package.json');
  if (!packageJson.includes('"guard:service-levels"')) {
    violations.push('R7: النص guard:service-levels غيرُ معلَنٍ في package.json.');
  }
  if (!packageJson.includes('npm run guard:service-levels')) {
    violations.push(
      'R7: الحاجزُ غيرُ مربوطٍ بسلسلةِ validate — وبوابةٌ لا تُشغَّل آلياً ليست بوابةً بل نيّة.',
    );
  }
  const workflow = readOrEmpty('.github/workflows/ci.yml');
  if (!workflow.includes('npm run guard:service-levels')) {
    violations.push('R7: الحاجزُ غيرُ مربوطٍ بمسارِ CI في .github/workflows/ci.yml.');
  }

  // ── R8: اللوحةُ تقرأ ولا تكتب ولا تستورد ──

  for (const forbidden of ['addCounter(', 'recordHistogram(', '.clear(']) {
    if (engine.includes(forbidden)) {
      violations.push(
        `R8: ${ENGINE} ينادي «${forbidden}» — ولوحةٌ تُبدّل ما تعرضه تجعل القارئَ الثانيَ يرى غيرَ ما رأى الأوّل.`,
      );
    }
  }
  if (engine.includes("from '../telemetry/")) {
    violations.push(
      `R8: ${ENGINE} يستورد من طبقةِ القياس — والسجلُّ يُحقَن لا يُستورَد، وإلا صار في التركيبِ سجلّان لرقمٍ واحد.`,
    );
  }

  // ── R9: لا مقياسَ يتيمٌ ساكناً، والأدلّةُ موجودة ──

  if (telemetryPolicy !== null) {
    for (const metric of telemetryPolicy.metrics) {
      if (!referencedMetrics.has(metric.name)) {
        violations.push(
          `R9: المقياس «${metric.name}» مُعلَنٌ في وثيقةِ القياسِ ولا هدفَ يقرؤه — عمودٌ في لوحةٍ يُملأ ولا يُقرأ.`,
        );
      }
    }
  }
  for (const relative of [
    BUDGET,
    'src/service-levels/index.mjs',
    'config/schemas/service-levels.schema.json',
    'tests/service-levels/service-levels.test.mjs',
    'tests/service-levels/dashboard.test.mjs',
  ]) {
    if (readOrEmpty(relative) === '') {
      violations.push(`R9: الملفُّ ${relative} غائبٌ — ولا ادّعاءَ بلا دليلٍ يُشغَّل (المادة 2).`);
    }
  }

  const composition = readOrEmpty('src/persistence/composition.mjs');
  if (!composition.includes('createServiceLevels')) {
    violations.push(
      'R9: اللوحةُ غيرُ مركَّبةٍ في src/persistence/composition.mjs — ولوحةٌ لا تُركَّب لوحةٌ لا يقرؤها أحد.',
    );
  }
  if (!composition.includes('metrics: telemetry.metrics')) {
    violations.push(
      'R9: اللوحةُ لا تُركَّب على سجلِّ مقاييسِ المثيلِ نفسِه — ومثيلان للمقاييسِ رقمان لشيءٍ واحد.',
    );
  }
}

if (violations.length > 0) {
  console.error('⛔ حاجز مستويات الخدمة رفض:');
  for (const violation of violations) console.error(`   • ${violation}`);
  process.exit(1);
}

const capabilityCount = policy === null ? 0 : policy.capabilities.length;
const objectiveCount =
  policy === null
    ? 0
    : policy.capabilities.reduce((total, capability) => total + capability.objectives.length, 0);
const codeCount = policy === null ? 0 : policy.refusalCodes.length;
const guaranteeCount = policy === null ? 0 : policy.guarantees.length;
const metricCount = telemetryPolicy === null ? 0 : telemetryPolicy.metrics.length;
console.log(
  `✅ حاجز مستويات الخدمة: ${capabilityCount} قدراتٍ أساسيةٍ و${objectiveCount} أهدافاً كلٌّ يقرأ مقياساً مُعلَناً بنوعِه في وثيقةِ القياس، و${metricCount} مقاييسَ مُعلَنةً كلٌّ يقرؤه هدفٌ فلا مقياسَ يتيمٌ يُجمَع ولا يُقاس عليه، و${codeCount} رمزَ رفضٍ متقابلةً في الاتجاهين مع \`SLO_ERRORS\`، و${guaranteeCount} ضماناتٍ كلٌّ برمزٍ حاضرٍ في ملفِّ إنفاذِه، وأرقامُ الأهدافِ والعتباتِ من الوثيقةِ لا من الكودِ (لا رقمَ منها مكتوبٌ نصّاً في المحرِّكِ ولا في وحدةِ الميزانية)، والساعةُ مُمرَّرةٌ لا ساعةَ نظام، واللوحةُ تقرأ ولا تكتب ولا تستورد طبقةَ القياسِ بل يُحقَن فيها سجلُّها، وهي مركَّبةٌ على سجلِّ مقاييسِ المثيلِ نفسِه.`,
);
