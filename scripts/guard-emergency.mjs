#!/usr/bin/env node
/**
 * حاجزُ عقدِ تمرينِ الطوارئ الكامل — البوابةُ الخامسةُ والأربعون في تسلسلِ
 * الحواجزِ المُعلَنِ في سجلِّ العمل (الخطوة `M11.07`).
 *
 * **رتبةٌ مقيسةٌ لا مُدَّعاة (المادة 4):** الرتبةُ أعلاه تتبع التسلسلَ المكتوبَ في
 * سجلِّ العملِ منذ `WL-043`، وهو تسلسلٌ **سرديٌّ** يختلف عن موضعِ الحاجزِ المقيسِ
 * في سلسلةِ `npm run validate`؛ وفارقُهما دَينُ توثيقٍ **سابقٌ** لهذه الخطوةِ
 * مسجَّلٌ في `WL-048` و`WL-050`–`WL-060`، ولا يُصلَح بتعديلِ سجلٍّ قديم.
 *
 * البوابةُ الحاديةُ والأربعون تحرس عودةَ الدولةِ حين يذهب كلُّ شيءٍ، والثانيةُ
 * والأربعون تحرس سلوكَها **أثناءَ** العطب. وهذه تحرس السؤالَ الثالثَ: **هل تمشي
 * سلسلةُ الطوارئ كاملةً بأمرٍ واحدٍ؟** فمعيارُ `M11.07` بحرفِه «تمرينٌ موثَّقٌ
 * بزمنِ كلِّ مرحلةٍ، وصفرُ خطوةٍ يدويّةٍ غيرِ موثّقةٍ» — وعشرُ قواعد:
 *
 *   R0: `config/emergency-drill.yaml` تُحمَّل بمخطَّطها الصارمِ وبفحصِ ترابطِها؛
 *       ووثيقةٌ تُخالف مخطَّطَها تُوقف البوابةَ قبل أيِّ فحصٍ آخر.
 *   R1: كلُّ طورٍ وحكمٍ وحدثِ تدقيقٍ ورمزِ رفضٍ وضمانٍ موثَّقٌ **بالاسمِ** في
 *       `docs/EMERGENCY_DRILL.md` (المادة 1).
 *   R2: التقابلُ في الاتجاهين بين `refusalCodes` في العقدِ و`EMERGENCY_ERRORS`
 *       في `src/emergency/errors.mjs`.
 *   R3: كلُّ رمزِ ضمانٍ (`G-EMERGENCY-*`) حاضرٌ **نصّاً** في ملفِّ إنفاذِه المُعلَن.
 *   R4: **زمنُ كلِّ مرحلةٍ مكتوبٌ بالرقمِ** في `docs/EMERGENCY_DRILL.md`: عهدُ
 *       التمرينِ كلِّه وعهدُ كلِّ طورٍ على حِدة؛ فمعيارٌ يقول «بزمنِ كلِّ مرحلةٍ»
 *       لا يُوفى بعبارةِ «سريعاً» لأنها لا تُقاس أبداً.
 *   R5: **الأطوارُ خمسةٌ بترتيبٍ ذي معنى**: الإيقافُ قبل الحجْرِ، والحجْرُ قبل
 *       التعافي، والتعافي قبل الاستئنافِ، والاستئنافُ قبل التقريرِ — ومن استأنف
 *       قبل أن يتعافى استأنف فوقَ حالةٍ لم تُستعَد. ولكلِّ طورٍ ملفُّ إنفاذٍ
 *       موجودٌ يذكره بالاسم.
 *   R6: `emergency:ready` وحدَه يخرج صفراً؛ فحكمٌ بالإخفاقِ يخرج صفراً حكمٌ لا
 *       يقرؤه مسارٌ آليّ. ولا فرقَ بين «مُخفِقٍ» و«غيرِ مقيسٍ» يُمحى بدمجِ رمزٍ.
 *   R7: **الحكمُ نقيٌّ لا يلمس القرصَ ولا الساعةَ**: وحداتُ `src/emergency/`
 *       النقيّةُ لا تستورد `node:fs` ولا `node:child_process` ولا `node:process`،
 *       ولا تُنادي `Date.now(` ولا `setTimeout(` ولا `setInterval(` — فالضمانُ
 *       `G-EMERGENCY-PURE-JUDGEMENT` بنيةٌ لا نيّة.
 *   R8: الحاجزُ مربوطٌ بالمسار: `npm run guard:emergency` في `validate` وفي
 *       `.github/workflows/ci.yml` بنصٍّ واحدٍ، و`npm run emergency:drill` مُعلَنٌ
 *       أمراً واحداً؛ فبوابةٌ لا تُشغَّل آلياً ليست بوابةً بل نيّة.
 *   R9: **صفرُ خطوةٍ يدويّةٍ مقيسٌ في المنفِّذِ نفسِه**: لا عَلَمَ تخطٍّ ولا إنجاحٍ
 *       قسريٍّ ولا قراءةَ مَدخلٍ قياسيٍّ ولا سؤالَ تأكيدٍ في
 *       `scripts/emergency-drill.mjs`؛ واختبارُ القبولِ يُنادي المنفِّذَ **عمليّةً
 *       ابنةً** ويقرأ رمزَ خروجِه وواقعةَ `emergency.drill.completed` بتاريخِها.
 *
 * **حدٌّ معلَن أول:** الحاجزُ يقرأ النصَّ والعقدَ **ولا يُجري تمرينَ طوارئ**؛
 * ومعيارُ القبولِ سلوكٌ مقيسٌ في `tests/emergency/drill.test.mjs` بعمليّةٍ ابنةٍ
 * حقيقيّةٍ على جذرٍ مؤقّت.
 *
 * **حدٌّ معلَن ثانٍ:** R7 و R9 يقيسان النصَّ لا زمنَ التشغيل: وحدةٌ تلمس القرصَ
 * بنداءٍ ديناميٍّ، أو خطوةٌ يدويّةٌ تُطلَب باستدعاءٍ غيرِ مذكورٍ نصّاً، لا يراهما
 * هذا الحاجزُ — وهو دَينٌ معلَنٌ في `docs/REMAINING_WORK.md`.
 *
 * **حدٌّ معلَن ثالث:** التمرينُ يُثبت **جاهزيّةَ الآلةِ** لا سلامةَ النظامِ؛ ونجاحُه
 * لا يُقرأ مراجعةً مستقلّةً (`M11.04`–`M11.06`) ولا قراراً ملكيّاً (`M11.09`) ولا
 * إذناً بإطلاق.
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { EMERGENCY_ERRORS, loadEmergencyContract } from '../src/emergency/index.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

/** @param {string} relative @returns {string} */
function readOrEmpty(relative) {
  const file = path.join(ROOT, relative);
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
}

/** @type {string[]} */
const violations = [];

/** الوحداتُ التي يجب أن تبقى نقيّةً (R7). */
const PURE_FILES = [
  'src/emergency/errors.mjs',
  'src/emergency/phase-plan.mjs',
  'src/emergency/judgement.mjs',
  'src/emergency/contract.mjs',
];

/** العقدُ يقرأ الوثيقةَ فيُستثنى من منعِ القرصِ لا من منعِ الساعة. */
const CLOCK_FREE_FILES = [...PURE_FILES];
const DISK_FREE_FILES = PURE_FILES.filter((relative) => relative !== 'src/emergency/contract.mjs');

// ── R0: العقدُ يُحمَّل بمخطَّطه وبفحصِ ترابطِه ──
/** @type {import('../src/emergency/contract.mjs').EmergencyContract | null} */
let contract = null;
try {
  contract = loadEmergencyContract();
} catch (error) {
  violations.push(
    `R0: عقدُ تمرينِ الطوارئ لا يُحمَّل: ${error instanceof Error ? error.message : String(error)}`,
  );
}

if (contract !== null) {
  const doc = readOrEmpty('docs/EMERGENCY_DRILL.md');

  // ── R1: كلُّ معرَّفٍ موثَّقٌ بالاسم ──
  /** @type {Array<[string, string]>} */
  const documented = [
    ...contract.phases.map((phase) => /** @type {[string, string]} */ (['الطور', phase.id])),
    ...contract.verdicts.map((verdict) => /** @type {[string, string]} */ (['الحكم', verdict.id])),
    ...contract.events.map((event) => /** @type {[string, string]} */ (['حدث المساءلة', event])),
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
        `R1: ${kind} «${id}» غيرُ موثَّقٍ بالاسمِ في docs/EMERGENCY_DRILL.md — ولا عملَ بلا توثيقٍ (المادة 1).`,
      );
    }
  }

  // ── R2: تقابلُ رموزِ الرفضِ في الاتجاهين ──
  const declaredCodes = new Set(contract.refusalCodes.map((entry) => entry.code));
  const implementedCodes = new Set(/** @type {string[]} */ (Object.values(EMERGENCY_ERRORS)));
  for (const code of declaredCodes) {
    if (!implementedCodes.has(code)) {
      violations.push(
        `R2: الرمز «${code}» معلَنٌ في العقدِ ولا وجودَ له في EMERGENCY_ERRORS — وعدٌ لا يُرَدُّ به شيء.`,
      );
    }
  }
  for (const code of implementedCodes) {
    if (!declaredCodes.has(code)) {
      violations.push(
        `R2: الرمز «${code}» في EMERGENCY_ERRORS ولا إعلانَ له في العقدِ — رفضٌ لا يجد قارئُ العقدِ معناه.`,
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

  // ── R4: زمنُ كلِّ مرحلةٍ مكتوبٌ بالرقم ──
  /** @type {string[]} */
  const numbers = [
    String(contract.objective.maxDrillMs),
    ...contract.phases.map((phase) => String(phase.maxMs)),
  ];
  for (const required of numbers) {
    if (!doc.includes(required)) {
      violations.push(
        `R4: الرقم «${required}» غيرُ مكتوبٍ في docs/EMERGENCY_DRILL.md — ومعيارٌ يقول «بزمنِ كلِّ مرحلةٍ» لا يُوفى بعبارةٍ لا تُقاس.`,
      );
    }
  }
  for (const section of ['زمن كل مرحلة', 'صفر خطوة يدويّة', 'حدود معلَنة']) {
    if (!doc.includes(section)) {
      violations.push(
        `R4: قسمُ «${section}» غائبٌ عن docs/EMERGENCY_DRILL.md — والعهدُ يُكتب لا يُفترَض.`,
      );
    }
  }

  // ── R5: خمسةُ أطوارٍ بترتيبٍ ذي معنى، ولكلٍّ ملفُّ إنفاذٍ يذكره ──
  const orderOf = (/** @type {string} */ id) =>
    contract === null ? 0 : (contract.phases.find((phase) => phase.id === id)?.order ?? 0);
  if (contract.phases.length < 5) {
    violations.push(
      `R5: الأطوارُ ${String(contract.phases.length)} والعقدُ يوجب خمسةً على الأقل — وسلسلةُ طوارئ تنقصها حلقةٌ ليست تمريناً كاملاً.`,
    );
  }
  /** @type {Array<[string, string, string]>} */
  const precedence = [
    ['phase:halt', 'phase:quarantine', 'من حجَر قبل أن يُوقِف حجَر في دولةٍ ما زالت تعمل.'],
    ['phase:quarantine', 'phase:recovery', 'ومن تعافى قبل أن يعزل استعاد الشذوذَ معه.'],
    ['phase:recovery', 'phase:resume', 'ومن استأنف قبل أن يتعافى استأنف فوقَ حالةٍ لم تُستعَد.'],
    ['phase:resume', 'phase:report', 'ومن رفع التقريرَ قبل الاستئنافِ رفع تقريراً عن نصفِ سلسلة.'],
  ];
  for (const [before, after, why] of precedence) {
    if (orderOf(before) === 0 || orderOf(after) === 0) {
      violations.push(`R5: الطورُ «${before}» أو «${after}» غيرُ معلَنٍ في العقدِ — ${why}`);
      continue;
    }
    if (orderOf(before) >= orderOf(after)) {
      violations.push(`R5: «${before}» ليس قبل «${after}» في ترتيبِ الأطوارِ — ${why}`);
    }
  }
  for (const phase of contract.phases) {
    const enforcing = readOrEmpty(phase.enforcedBy);
    if (enforcing === '') {
      violations.push(`R5: ملفُّ إنفاذِ الطورِ «${phase.id}» (${phase.enforcedBy}) غائب.`);
      continue;
    }
    if (!enforcing.includes(phase.id)) {
      violations.push(
        `R5: الطورُ «${phase.id}» غيرُ مذكورٍ نصّاً في ملفِّ إنفاذِه ${phase.enforcedBy} — وطورٌ معلَنٌ بلا مُنفِّذٍ وعدُ عملٍ لا يقع.`,
      );
    }
  }

  // ── R6: الجاهزيّةُ وحدَها تخرج صفراً، والأحكامُ الثلاثةُ متمايزة ──
  for (const verdict of contract.verdicts) {
    if (verdict.id === 'emergency:ready' && verdict.exitCode !== 0) {
      violations.push('R6: حكمُ الجاهزيّةِ لا يخرج صفراً — والمسارُ الآليُّ يقرأ الصفرَ نجاحاً.');
    }
    if (verdict.id !== 'emergency:ready' && verdict.exitCode === 0) {
      violations.push(
        `R6: الحكم «${verdict.id}» يخرج صفراً — وحكمٌ بالإخفاقِ يخرج صفراً حكمٌ لا يقرؤه مسارٌ آليّ.`,
      );
    }
  }
  const failedCode = contract.verdicts.find((entry) => entry.id === 'emergency:failed')?.exitCode;
  const unmeasuredCode = contract.verdicts.find(
    (entry) => entry.id === 'emergency:unmeasured',
  )?.exitCode;
  if (failedCode === undefined || unmeasuredCode === undefined) {
    violations.push(
      'R6: حكمُ الإخفاقِ أو حكمُ انعدامِ القياسِ غيرُ معلَنٍ — ودمجُ «قِسنا فوجدنا خللاً» مع «لم نَقِس» يُخفي أخطرَهما.',
    );
  } else if (failedCode === unmeasuredCode) {
    violations.push(
      `R6: «emergency:failed» و«emergency:unmeasured» يخرجان بالرمزِ ${String(failedCode)} نفسِه — والفرقُ بينهما جوهريٌّ في الطوارئ.`,
    );
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
          `R7: الوحدة ${relative} تستورد «${specifier}» — والحكمُ الذي يملك أن يكتب على ما يفحصه يملك أن يُصلِحه ثم يُثني عليه.`,
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
        `R7: ${relative} يُنادي Date.now( — والساعةُ تُحقَن، فمن قرأها في متنِ منطقِه كتب حكماً لا يُثبَّت زمنُه.`,
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
  const WIRE = 'npm run guard:emergency';
  const manifest = readOrEmpty('package.json');
  if (!manifest.includes(WIRE)) {
    violations.push(`R8: «${WIRE}» غيرُ مربوطٍ في سلسلةِ validate — وبوابةٌ لا تُشغَّل نيّة.`);
  }
  if (!readOrEmpty('.github/workflows/ci.yml').includes(WIRE)) {
    violations.push(
      `R8: «${WIRE}» غيرُ مربوطٍ في .github/workflows/ci.yml — والأخضرُ المحليُّ ليس حكماً (المادة 2).`,
    );
  }
  if (!manifest.includes('"emergency:drill"')) {
    violations.push(
      'R8: أمرُ «emergency:drill» غيرُ مُعلَنٍ في package.json — وتمرينٌ يحتاج سلسلةَ أوامرَ يدويّةٍ تمرينٌ لا يقع.',
    );
  }

  // ── R9: صفرُ خطوةٍ يدويّةٍ، واختبارُ قبولٍ بعمليّةٍ ابنة ──
  const drill = readOrEmpty('scripts/emergency-drill.mjs');
  if (drill === '') {
    violations.push('R9: scripts/emergency-drill.mjs غائب — ولا تمرينَ بلا منفِّذ.');
  } else {
    /** @type {Array<[string, string]>} */
    const forbidden = [
      ['skip-halt', 'عَلَمُ تخطٍّ يجعل التمرينَ يُخضِّر نفسَه بما لم يُنفِّذه.'],
      ['skip-phase', 'وطورٌ يُسكَت بعلمٍ طورٌ لم يُقَس.'],
      ['force-pass', 'وإنجاحٌ قسريٌّ ليس قياساً بل إعلاناً.'],
      ['readline', 'ومُدخلَةُ إنسانٍ بين طورٍ وطورٍ تنقض «صفرَ خطوةٍ يدويّةٍ».'],
      ['process.stdin', 'وقراءةُ مَدخلٍ قياسيٍّ انتظارُ إذنٍ لا أمرٌ واحد.'],
      ['prompt(', 'وسؤالُ تأكيدٍ خطوةٌ يدويّةٌ ولو كانت سطراً واحداً.'],
    ];
    for (const [needle, why] of forbidden) {
      if (drill.includes(needle)) {
        violations.push(`R9: منفِّذُ التمرينِ يحمل «${needle}» — ${why}`);
      }
    }
  }
  const acceptance = readOrEmpty('tests/emergency/drill.test.mjs');
  if (acceptance === '') {
    violations.push(
      'R9: tests/emergency/drill.test.mjs غائب — ومعيارُ «تمرينٌ موثَّقٌ بزمنِ كلِّ مرحلةٍ وصفرُ خطوةٍ يدويّةٍ» بلا اختبارِ قبولٍ ادّعاء.',
    );
  } else {
    /** @type {Array<[string, string]>} */
    const required = [
      [
        'node:child_process',
        'نداءُ دالّةٍ في العمليّةِ نفسِها لا يقيس أمراً واحداً يمشي بلا تدخّل.',
      ],
      ['scripts/emergency-drill.mjs', 'المنفِّذُ هو ما يُقاس لا محاكاتُه.'],
      ['status', 'رمزُ الخروجِ هو ما يقرؤه المسارُ الآليّ.'],
      [
        'emergency.drill.completed',
        'رمزُ خروجٍ وحدَه لا يُثبت أنّ تمريناً وقع وكُتب في الدفترِ بتاريخِه.',
      ],
      ['isoDate', 'وتمرينٌ «موثَّقٌ» يُكتب بتاريخِه لا برقمٍ لا يُقرأ.'],
    ];
    for (const [needle, why] of required) {
      if (!acceptance.includes(needle)) {
        violations.push(`R9: اختبارُ القبولِ لا يذكر «${needle}» — ${why}`);
      }
    }
  }
}

if (violations.length > 0) {
  console.error('⛔ حاجز عقد تمرين الطوارئ الكامل رفض:');
  for (const violation of violations) {
    console.error(`   • ${violation}`);
  }
  process.exit(1);
}

const phaseCount = contract === null ? 0 : contract.phases.length;
const verdictCount = contract === null ? 0 : contract.verdicts.length;
const eventCount = contract === null ? 0 : contract.events.length;
const codeCount = contract === null ? 0 : contract.refusalCodes.length;
const guaranteeCount = contract === null ? 0 : contract.guarantees.length;
const drillMs = contract === null ? 0 : contract.objective.maxDrillMs;
const failedExit =
  contract === null
    ? '—'
    : String(contract.verdicts.find((entry) => entry.id === 'emergency:failed')?.exitCode ?? '—');
const unmeasuredExit =
  contract === null
    ? '—'
    : String(
        contract.verdicts.find((entry) => entry.id === 'emergency:unmeasured')?.exitCode ?? '—',
      );
console.log(
  `✅ حاجز عقد تمرين الطوارئ الكامل: ${phaseCount} أطوارٍ مرتَّبةً — إيقافٌ فحجْرٌ فتعافٍ فاستئنافٌ فتقريرٌ — لكلٍّ عهدُ زمنٍ مكتوبٌ رقماً في docs/EMERGENCY_DRILL.md ضمنَ عهدٍ كلّيٍّ قدرُه ${drillMs} ملّي ثانية، وكلُّ طورٍ يُقبَل بوقوعِ إنفاذِه المعلَنِ فعلاً — استئنافٌ يُرَدُّ قبل الإقرارِ، ومحجورٌ تَرُدُّه بوابةُ الهويّةِ، وتعافٍ يخرج بصفرٍ في عمليّةٍ ابنةٍ، وعهدٌ يتقدّم عند الاستئنافِ، وتقريرٌ يُقرأ من القرصِ بزمنِ الأطوارِ الخمسةِ — لا بغيابِ خطأٍ، و${verdictCount} أحكامٍ لكلٍّ رمزُ خروجٍ مُفرَدٌ لا يخرج صفراً إلا الجاهزيّةُ وحدَها ويتمايز فيها الإخفاقُ (${failedExit}) عن انعدامِ القياسِ (${unmeasuredExit}) فلا يُخفي أحدُهما الآخرَ، و${eventCount} أحداثِ تدقيقٍ تُكتب في دفترٍ بإضافةٍ سطريّةٍ بتاريخٍ مقروءٍ، و${codeCount} رمزَ رفضٍ متقابلةً في الاتجاهين مع \`EMERGENCY_ERRORS\`، و${guaranteeCount} ضماناتٍ كلٌّ برمزٍ حاضرٍ نصّاً في ملفِّ إنفاذِه، والحكمُ نقيٌّ لا يستورد قرصاً ولا عمليّةً ولا يقرأ ساعةَ جهازٍ، ومنفِّذُ التمرينِ بلا عَلَمِ تخطٍّ ولا قراءةِ مَدخلٍ قياسيٍّ ولا سؤالِ تأكيدٍ فيمشي بأمرٍ واحدٍ من الإيقافِ إلى التقريرِ، ومعيارُ «تمرينٌ موثَّقٌ بزمنِ كلِّ مرحلةٍ وصفرُ خطوةٍ يدويّةٍ غيرِ موثّقةٍ» مقيسٌ بعمليّةٍ ابنةٍ حقيقيّةٍ تُوقف وتحجُر وتتعافى وتستأنف وتكتب تقريرَها ثم يُقرأ رمزُ خروجِها ودفترُها من القرصِ لا بنصٍّ يُقرأ في حاجز. وحدٌّ معلَنٌ: التمرينُ يُثبت جاهزيّةَ الآلةِ لا سلامةَ النظامِ، ولا يُقرأ مراجعةً مستقلّةً (M11.04–M11.06) ولا قراراً ملكيّاً (M11.09) ولا إذناً بإطلاق.`,
);
