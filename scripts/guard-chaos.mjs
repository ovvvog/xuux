#!/usr/bin/env node
/**
 * حاجزُ عقدِ اختباراتِ الفوضى — البوابةُ الثانيةُ والأربعون في تسلسلِ الحواجزِ
 * المُعلَنِ في سجلِّ العمل (الخطوة `M10.09`).
 *
 * **رتبةٌ مقيسةٌ لا مُدَّعاة (المادة 4):** الرتبةُ في العنوانِ أعلاه تتبع
 * التسلسلَ المكتوبَ في سجلِّ العملِ منذ `WL-043`، وهو تسلسلٌ **سرديٌّ** يختلف
 * عن موضعِ الحاجزِ المقيسِ في سلسلةِ `npm run validate`؛ وفارقُهما دَينُ توثيقٍ
 * **سابقٌ** لهذه الخطوةِ مسجَّلٌ في `WL-048` و`WL-050`–`WL-060`، ولا يُصلَح
 * بتعديلِ سجلٍّ قديم.
 *
 * البوابةُ الحاديةُ والأربعون تحرس ما يقع حين **يذهب كلُّ شيءٍ** فتُبنى الدولةُ
 * من نسختِها. وهذه تحرس سؤالاً آخر: ماذا تفعل الدولةُ **أثناءَ** وقوعِ العطبِ؟
 * أن يكون العطبُ **حقيقيّاً** لا مُحاكىً بعلَمٍ، وأن تكون لكلِّ تجربةٍ
 * **فرضيّةٌ مكتوبةٌ** يُقاس صمودُها، وأن يكون كلُّ انحرافٍ **مُقيَّداً مربوطاً
 * بإصلاحِ سببِه**، وأن **لا يخرج صفراً إلا الصمودُ**. وعشرُ قواعد:
 *
 *   R0: `config/chaos.yaml` تُحمَّل بمخطَّطها الصارم؛ ووثيقةٌ تُخالف مخطَّطَها
 *       تُوقف البوابةَ قبل أيِّ فحصٍ آخر.
 *   R1: كلُّ تجربةٍ وحكمٍ وحدثِ تدقيقٍ ورمزِ رفضٍ وضمانٍ وانحرافٍ موثَّقٌ
 *       **بالاسمِ** في `docs/CHAOS.md` (المادة 1).
 *   R2: التقابلُ في الاتجاهين بين `refusalCodes` في الوثيقةِ و`CHAOS_ERRORS`
 *       في `src/chaos/errors.mjs`.
 *   R3: كلُّ رمزِ ضمانٍ (`G-CHAOS-*`) حاضرٌ **نصّاً** في ملفِّ إنفاذِه المُعلَن.
 *   R4: **العطبُ مكتوبٌ بالرقمِ**: مقدارُ كلِّ عطبٍ مكتوبٌ رقماً في
 *       `docs/CHAOS.md` مع أقسامِها اللازمة؛ فعطبٌ يُقال «تأخّرٌ ملحوظٌ» عطبٌ
 *       لا يُقاس فلا تُخلَف فرضيّتُه أبداً.
 *   R5: **الانحرافُ مربوطٌ بإصلاحِ سببِه**: كلُّ مُدخلةِ انحرافٍ تُشير إلى
 *       تجربةٍ معلَنةٍ، وإلى ملفِّ إصلاحٍ **قائمٍ** يحمل `marker` نصّاً، وإلى
 *       مُدخلةِ عملٍ موجودةٍ في `docs/roadmap/05-work-log.md`؛ فانحرافٌ يُكتب
 *       ملاحظةً ثم يُنسى يُخضِّر مساراً ويُبقي عطباً.
 *   R6: **الترتيبُ متتالٍ من واحدٍ** ولكلِّ تجربةٍ فرضيّةٌ ورمزُ انحرافٍ
 *       مُفرَدٌ، و`chaos:resilient` وحدَه يخرج صفراً، **ولا عَلَمَ تخطٍّ في
 *       المنفِّذِ** أصلاً.
 *   R7: **الحكمُ نقيٌّ لا يلمس القرصَ**: وحداتُ `src/chaos/` النقيّةُ **لا
 *       تستورد** `node:fs` ولا `node:child_process` ولا `node:process`، ولا
 *       `Date.now(` ولا `setTimeout(` ولا `setInterval(` — فالضمانان
 *       `G-CHAOS-PURE-JUDGEMENT` و`G-CHAOS-INJECTED-CLOCK` بنيةٌ لا نيّة.
 *   R8: الحاجزُ مربوطٌ بالمسار: `npm run guard:chaos` في `validate` وفي
 *       `.github/workflows/ci.yml` بنصٍّ واحد، و`npm run chaos:drill` مُعلَنٌ
 *       أمراً واحداً؛ فبوابةٌ لا تُشغَّل آلياً ليست بوابةً بل نيّة.
 *   R9: **اختبارُ القبولِ يُشغِّل عمليّاتٍ حقيقيّةً**: يستورد `node:child_process`
 *       ويُنادي `scripts/chaos-drill.mjs` بالاسمِ ويقرأ رمزَ الخروجِ ويقرأ
 *       واقعتَي `chaos.fault.injected` و`chaos.drill.completed` من الدفترِ
 *       ويُثبت أنّ التجاربَ الخمسَ جرت — فمعيارُ «تجاربُ فوضى تُقيَّد انحرافاتُها
 *       وتُربَط بإصلاحٍ موثَّقٍ» لا يُقاس بنداءِ دالّةٍ في العمليّةِ نفسِها ولا
 *       بنصٍّ يُقرأ في حاجز.
 *
 * **حدٌّ معلَن أول:** الحاجزُ يقرأ النصَّ والوثيقةَ **ولا يُجري تجربةَ فوضى**؛
 * ومعيارُ القبولِ سلوكٌ مقيسٌ في `tests/chaos/drill.test.mjs` بعمليّاتٍ أبناءٍ
 * حقيقيّةٍ على عقدٍ حقيقيٍّ وجذرٍ مؤقّت.
 *
 * **حدٌّ معلَن ثانٍ:** R7 يقيس النصَّ لا زمنَ التشغيل: وحدةٌ تلمس القرصَ بنداءٍ
 * ديناميٍّ لا يراه هذا الحاجزُ، وهو دَينٌ معلَنٌ في `docs/REMAINING_WORK.md`.
 *
 * **حدٌّ معلَن ثالث:** الحاجزُ لا يُلزِم بوقوعِ التجاربِ بدوريّةٍ — لا مُجدوِلَ
 * ذاتيَّ في هذه الخطوةِ؛ والتجاربُ تقع في سلسلةِ الاختباراتِ عند كلِّ تشغيلٍ،
 * وذلك دَينٌ معلَن.
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { CHAOS_ERRORS, loadChaosContract } from '../src/chaos/index.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

/** @param {string} relative @returns {string} */
function readOrEmpty(relative) {
  const file = path.join(ROOT, relative);
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
}

/** @type {string[]} */
const violations = [];

/** الوحداتُ التي يجب أن تبقى نقيّةً تماماً (R7). */
const PURE_FILES = [
  'src/chaos/contract.mjs',
  'src/chaos/deviation.mjs',
  'src/chaos/experiment-plan.mjs',
  'src/chaos/judgement.mjs',
];

/** العقدُ يقرأ الوثيقةَ فيُستثنى من منعِ القرصِ لا من منعِ الساعة. */
const CLOCK_FREE_FILES = [...PURE_FILES];
const DISK_FREE_FILES = PURE_FILES.filter((relative) => relative !== 'src/chaos/contract.mjs');

// ── R0: الوثيقةُ تُحمَّل بمخطَّطها ──
/** @type {import('../src/chaos/contract.mjs').ChaosContract | null} */
let contract = null;
try {
  contract = loadChaosContract();
} catch (error) {
  violations.push(
    `R0: عقدُ الفوضى لا يُحمَّل: ${error instanceof Error ? error.message : String(error)}`,
  );
}

if (contract !== null) {
  const doc = readOrEmpty('docs/CHAOS.md');

  // ── R1: كلُّ معرّفٍ موثَّقٌ بالاسم ──
  /** @type {Array<[string, string]>} */
  const documented = [
    ...contract.experiments.map(
      (experiment) => /** @type {[string, string]} */ (['التجربة', experiment.id]),
    ),
    ...contract.verdicts.map((verdict) => /** @type {[string, string]} */ (['الحكم', verdict.id])),
    ...contract.events.map((event) => /** @type {[string, string]} */ (['حدث المساءلة', event])),
    ...contract.refusalCodes.map(
      (entry) => /** @type {[string, string]} */ (['رمز الرفض', entry.code]),
    ),
    ...contract.guarantees.map(
      (guarantee) => /** @type {[string, string]} */ (['الضمان', guarantee.id]),
    ),
    ...contract.deviations.map(
      (deviation) => /** @type {[string, string]} */ (['الانحراف', deviation.code]),
    ),
  ];
  for (const [kind, id] of documented) {
    if (!doc.includes(id)) {
      violations.push(
        `R1: ${kind} «${id}» غيرُ موثَّقٍ بالاسمِ في docs/CHAOS.md — ولا عملَ بلا توثيقٍ (المادة 1).`,
      );
    }
  }

  // ── R2: تقابلُ رموزِ الرفضِ في الاتجاهين ──
  const declaredCodes = new Set(contract.refusalCodes.map((entry) => entry.code));
  const implementedCodes = new Set(/** @type {string[]} */ (Object.values(CHAOS_ERRORS)));
  for (const code of declaredCodes) {
    if (!implementedCodes.has(code)) {
      violations.push(
        `R2: الرمز «${code}» معلَنٌ في الوثيقةِ ولا وجودَ له في CHAOS_ERRORS — وعدٌ لا يُنفَّذ.`,
      );
    }
  }
  for (const code of implementedCodes) {
    if (!declaredCodes.has(code)) {
      violations.push(
        `R2: الرمز «${code}» في CHAOS_ERRORS ولا إعلانَ له في الوثيقةِ — رمزٌ لا يجده قارئُ الوثيقة.`,
      );
    }
  }

  // ── R3: كلُّ ضمانٍ حاضرٌ نصّاً في ملفِّ إنفاذِه ──
  for (const guarantee of contract.guarantees) {
    const enforcing = readOrEmpty(guarantee.enforcedIn);
    if (enforcing === '') {
      violations.push(`R3: ملفُّ إنفاذِ الضمان «${guarantee.id}» (${guarantee.enforcedIn}) غائب.`);
      continue;
    }
    if (!enforcing.includes(guarantee.id)) {
      violations.push(
        `R3: الضمان «${guarantee.id}» ليس حاضراً نصّاً في ملفِّ إنفاذِه ${guarantee.enforcedIn} — وضمانٌ لا يُشار إليه في منفِّذِه ضمانٌ يُنسى عند أوّلِ إعادةِ كتابة.`,
      );
    }
  }

  // ── R4: العطبُ مكتوبٌ بالرقم ──
  for (const experiment of contract.experiments) {
    const magnitude = String(experiment.fault.magnitude);
    if (!doc.includes(magnitude)) {
      violations.push(
        `R4: مقدارُ عطبِ «${experiment.id}» (${magnitude}) غيرُ مكتوبٍ رقماً في docs/CHAOS.md — وعطبٌ يُقال «ملحوظٌ» عطبٌ لا تُخلَف فرضيّتُه أبداً لأنه لا يُقاس أبداً.`,
      );
    }
  }
  for (const section of ['العطب المحقون', 'الفرضيّة', 'دفتر الانحرافات', 'حدود معلَنة']) {
    if (!doc.includes(section)) {
      violations.push(
        `R4: قسمُ «${section}» غائبٌ عن docs/CHAOS.md — والفرضيّةُ تُكتب لا تُفترَض.`,
      );
    }
  }

  // ── R5: كلُّ انحرافٍ مربوطٌ بإصلاحِ سببِه ──
  const workLog = readOrEmpty('docs/roadmap/05-work-log.md');
  const declaredExperiments = new Set(contract.experiments.map((entry) => entry.id));
  const declaredDeviationCodes = new Set(contract.experiments.map((entry) => entry.deviationCode));
  for (const deviation of contract.deviations) {
    if (!declaredDeviationCodes.has(deviation.code)) {
      violations.push(
        `R5: الانحراف «${deviation.code}» لا يقابل رمزَ انحرافٍ لتجربةٍ معلَنةٍ — وانحرافٌ بلا تجربةٍ انحرافٌ لا يُعاد قياسُه.`,
      );
    }
    if (!declaredExperiments.has(deviation.experiment)) {
      violations.push(
        `R5: الانحراف «${deviation.code}» يُشير إلى تجربةٍ غيرِ معلَنةٍ «${deviation.experiment}».`,
      );
    }
    const fix = readOrEmpty(deviation.fixedIn);
    if (fix === '') {
      violations.push(
        `R5: ملفُّ إصلاحِ الانحراف «${deviation.code}» (${deviation.fixedIn}) غائبٌ — ولا إغلاقَ بإصلاحٍ لا وجودَ له.`,
      );
    } else if (!fix.includes(deviation.marker)) {
      violations.push(
        `R5: علامةُ الانحراف «${deviation.marker}» ليست حاضرةً نصّاً في ${deviation.fixedIn} — وإصلاحٌ لا يُرى في الملفِّ دعوى.`,
      );
    } else if (!fix.includes(deviation.code)) {
      violations.push(
        `R5: رمزُ الانحراف «${deviation.code}» ليس حاضراً نصّاً في ملفِّ إصلاحِه ${deviation.fixedIn} — فمن حذف الإصلاحَ غداً لا يجد ما يُذكِّره بسببِه.`,
      );
    }
    if (!workLog.includes(deviation.closedBy)) {
      violations.push(
        `R5: مُدخلةُ العملِ «${deviation.closedBy}» التي تُغلِق الانحراف «${deviation.code}» غيرُ موجودةٍ في docs/roadmap/05-work-log.md — وانحرافٌ مفتوحٌ رفضٌ لا ملاحظةٌ تُقرأ وتُنسى (${CHAOS_ERRORS.DEVIATION_UNCLOSED}).`,
      );
    }
  }

  // ── R6: الترتيبُ والفرضيّاتُ ورموزُ الخروجِ ومنعُ أعلامِ التخطّي ──
  if (contract.experiments.length < 5) {
    violations.push(
      `R6: التجاربُ ${String(contract.experiments.length)} والعقدُ يوجب خمساً على الأقل — وفوضى تجربةٍ واحدةٍ ليست قياسَ صمود.`,
    );
  }
  const orders = contract.experiments
    .map((entry) => entry.order)
    .sort((left, right) => left - right);
  for (let index = 0; index < orders.length; index += 1) {
    if (orders[index] !== index + 1) {
      violations.push(
        `R6: ترتيبُ التجاربِ ليس متتالياً من واحدٍ بلا فجوةٍ ولا تكرارٍ: ${orders.join('، ')}.`,
      );
      break;
    }
  }
  /** @type {Set<string>} */
  const seenDeviationCodes = new Set();
  for (const experiment of contract.experiments) {
    if (experiment.hypothesis.trim().length < 40) {
      violations.push(
        `R6: فرضيّةُ «${experiment.id}» أقصرُ من أن تكون دعوىً تُقاس — وتجربةٌ بلا فرضيّةٍ عرضٌ لا قياس.`,
      );
    }
    if (seenDeviationCodes.has(experiment.deviationCode)) {
      violations.push(
        `R6: رمزُ الانحراف «${experiment.deviationCode}» مكرَّرٌ بين تجربتَين — وانحرافٌ برمزٍ مشتركٍ لا يُعرَف أيُّ تجربةٍ أخلفت.`,
      );
    }
    seenDeviationCodes.add(experiment.deviationCode);
  }
  for (const verdict of contract.verdicts) {
    if (verdict.id === 'chaos:resilient' && verdict.exitCode !== 0) {
      violations.push('R6: حكمُ الصمودِ لا يخرج صفراً — والمسارُ الآليُّ يقرأ الصفرَ نجاحاً.');
    }
    if (verdict.id !== 'chaos:resilient' && verdict.exitCode === 0) {
      violations.push(
        `R6: الحكم «${verdict.id}» يخرج صفراً — وحكمٌ بالانحرافِ يخرج صفراً حكمٌ لا يقرؤه مسارٌ آليّ.`,
      );
    }
  }
  const drill = readOrEmpty('scripts/chaos-drill.mjs');
  for (const forbidden of [
    '--skip-experiment',
    '--skip-',
    '--no-verify',
    '--force-pass',
    'readlineSync',
    'confirm(',
  ]) {
    if (drill.includes(forbidden)) {
      violations.push(
        `R6: منفِّذُ الفوضى يحمل «${forbidden}» — وتجربةٌ يمكن إسكاتُها ستُسكَت في أوّلِ يومٍ ضيّق (${CHAOS_ERRORS.RESULT_MISSING}).`,
      );
    }
  }

  // ── R7: الحكمُ نقيٌّ لا يلمس القرصَ ولا الساعةَ ──
  const FORBIDDEN_IMPORTS = ['node:fs', 'node:child_process', 'node:process'];
  for (const relative of DISK_FREE_FILES) {
    const source = readOrEmpty(relative);
    if (source === '') {
      violations.push(`R7: الوحدة ${relative} غائبةٌ فلا يُقاس نقاؤها.`);
      continue;
    }
    for (const specifier of FORBIDDEN_IMPORTS) {
      if (source.includes(`'${specifier}'`)) {
        violations.push(
          `R7: الوحدة ${relative} تستورد «${specifier}» — والحكمُ يجب أن يكون نقيّاً: وحدةٌ تملك حقنَ العطبِ تستطيع أن تُلطِّفه ثم تُثني على صمودِه.`,
        );
      }
    }
  }
  for (const relative of CLOCK_FREE_FILES) {
    const source = readOrEmpty(relative);
    if (source === '') {
      continue;
    }
    if (source.includes('Date.now(')) {
      violations.push(
        `R7: ${relative} يُنادي Date.now( — والساعةُ تُحقَن، فمن قرأها في متنِ منطقِه كتب اختباراً لا يُثبَّت زمنُه.`,
      );
    }
    for (const timer of ['setTimeout(', 'setInterval(']) {
      if (source.includes(timer)) {
        violations.push(
          `R7: ${relative} يستخدم ${timer} — ومؤقِّتٌ يعمل بنفسِه يُخفي أثرَه عن كلِّ اختبار.`,
        );
      }
    }
  }

  // ── R8: الحاجزُ مربوطٌ بالمسارِ بنصٍّ واحد ──
  const WIRE = 'npm run guard:chaos';
  const manifest = readOrEmpty('package.json');
  if (!manifest.includes(WIRE)) {
    violations.push(`R8: «${WIRE}» غيرُ مربوطٍ في سلسلةِ validate — وبوابةٌ لا تُشغَّل نيّة.`);
  }
  if (!readOrEmpty('.github/workflows/ci.yml').includes(WIRE)) {
    violations.push(
      `R8: «${WIRE}» غيرُ مربوطٍ في .github/workflows/ci.yml — والأخضرُ المحليُّ ليس حكماً (المادة 2).`,
    );
  }
  if (!manifest.includes('"chaos:drill"')) {
    violations.push(
      'R8: أمرُ «chaos:drill» غيرُ مُعلَنٍ في package.json — وتجربةٌ تحتاج سلسلةَ أوامرَ يدويّةٍ تجربةٌ لا تقع.',
    );
  }

  // ── R9: اختبارُ القبولِ يُشغِّل عمليّاتٍ حقيقيّة ──
  const acceptance = readOrEmpty('tests/chaos/drill.test.mjs');
  if (acceptance === '') {
    violations.push(
      'R9: tests/chaos/drill.test.mjs غائب — ومعيارُ «تجاربُ فوضى تُقيَّد انحرافاتُها وتُربَط بإصلاحٍ موثَّقٍ» بلا اختبارِ قبولٍ ادّعاء.',
    );
  } else {
    /** @type {Array<[string, string]>} */
    const required = [
      [
        'node:child_process',
        'نداءُ دالّةٍ في العمليّةِ نفسِها لا يقيس قتلَ عمليّةٍ ولا امتلاءَ قرص.',
      ],
      ['scripts/chaos-drill.mjs', 'المنفِّذُ هو ما يُقاس لا محاكاتُه.'],
      ['status', 'رمزُ الخروجِ هو ما يقرؤه المسارُ الآليّ.'],
      [
        'chaos.fault.injected',
        'رمزُ خروجٍ وحدَه لا يُثبت أنّ عطباً وقع فعلاً وكُتب في الدفترِ بتاريخِه.',
      ],
      [
        'chaos.drill.completed',
        'تشغيلٌ لا يُختَم في الدفترِ بحكمِه تشغيلٌ لا يُقرأ منه حكمٌ لاحقاً.',
      ],
      ['isoDate', 'تجربةٌ «موثَّقةٌ» تُكتب بتاريخِها لا برقمٍ لا يُقرأ.'],
    ];
    for (const [needle, why] of required) {
      if (!acceptance.includes(needle)) {
        violations.push(`R9: اختبارُ القبولِ لا يذكر «${needle}» — ${why}`);
      }
    }
    for (const experiment of contract.experiments) {
      if (!acceptance.includes(experiment.id)) {
        violations.push(
          `R9: اختبارُ القبولِ لا يذكر التجربة «${experiment.id}» — واختبارٌ يُثبت أربعاً من خمسٍ يُخضِّر تجربةً لم تقع.`,
        );
      }
    }
  }
}

if (violations.length > 0) {
  console.error('⛔ حاجز عقد اختبارات الفوضى رفض:');
  for (const violation of violations) {
    console.error(`   • ${violation}`);
  }
  process.exit(1);
}

const experimentCount = contract === null ? 0 : contract.experiments.length;
const verdictCount = contract === null ? 0 : contract.verdicts.length;
const eventCount = contract === null ? 0 : contract.events.length;
const codeCount = contract === null ? 0 : contract.refusalCodes.length;
const guaranteeCount = contract === null ? 0 : contract.guarantees.length;
const deviationCount = contract === null ? 0 : contract.deviations.length;
const deviatedCode =
  contract === null
    ? '—'
    : String(contract.verdicts.find((entry) => entry.id === 'chaos:deviated')?.exitCode ?? '—');
const unmeasuredCode =
  contract === null
    ? '—'
    : String(contract.verdicts.find((entry) => entry.id === 'chaos:unmeasured')?.exitCode ?? '—');
const magnitudes =
  contract === null
    ? ''
    : contract.experiments
        .map((entry) => `${entry.id}=${String(entry.fault.magnitude)}${entry.fault.unit}`)
        .join('، ');
console.log(
  `✅ حاجز عقد اختبارات الفوضى: ${experimentCount} تجاربَ مرتَّبةً متتاليةً من واحدٍ لكلٍّ عطبٌ **مكتوبٌ بالرقمِ** (${magnitudes}) وفرضيّةٌ مكتوبةٌ يُقاس صمودُها ورمزُ انحرافٍ مُفرَدٌ يُقيَّد به إخلافُها، و${verdictCount} أحكامٍ لكلٍّ رمزُ خروجٍ مُفرَدٌ لا يخرج صفراً إلا الصمودُ وحدَه فيخرج الانحرافُ ${deviatedCode} وغيرُ المقيسِ ${unmeasuredCode} ولا يُقرأ الصمتُ صموداً، و${deviationCount} انحرافاً مُقيَّداً كلٌّ مربوطٌ بتجربتِه وبملفِّ إصلاحٍ قائمٍ يحمل علامتَه نصّاً وبمُدخلةِ عملٍ موجودةٍ تشرح إصلاحَ سببِه لا عرضِه، و${eventCount} أحداثِ تدقيقٍ تُكتب في دفترٍ بإضافةٍ سطريّةٍ بتاريخٍ مقروءٍ، و${codeCount} رمزَ رفضٍ متقابلةً في الاتجاهين مع \`CHAOS_ERRORS\`، و${guaranteeCount} ضماناتٍ كلٌّ برمزٍ حاضرٍ في ملفِّ إنفاذِه، والحكمُ نقيٌّ لا يستورد قرصاً ولا عمليّةً ولا يقرأ ساعةَ جهازٍ فحاقنُ العطبِ ليس هو الحاكمَ على صمودِه، ولا عَلَمَ تخطٍّ ولا إسكاتٍ ولا إنجاحٍ قسريٍّ في المنفِّذِ أصلاً، ومعيارُ القبولِ مقيسٌ بعمليّاتٍ أبناءٍ حقيقيّةٍ تُقتَل بإشارةٍ وتُردُّ كتابتُها بجهازٍ لا يقبل بايتاً لا بنصٍّ يُقرأ في حاجز.`,
);
