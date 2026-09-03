#!/usr/bin/env node
/**
 * حاجزُ عقدِ تجاربِ التعافي الدوريّة — البوابةُ الحاديةُ والأربعون في تسلسلِ
 * الحواجزِ المُعلَنِ في سجلِّ العمل (الخطوة `M10.08`).
 *
 * **رتبةٌ مقيسةٌ لا مُدَّعاة (المادة 4):** الرتبةُ في العنوانِ أعلاه تتبع
 * التسلسلَ المكتوبَ في سجلِّ العملِ منذ `WL-043`، وهو تسلسلٌ **سرديٌّ** يختلف
 * عن موضعِ الحاجزِ المقيسِ في سلسلةِ `npm run validate`؛ وفارقُهما دَينُ توثيقٍ
 * **سابقٌ** لهذه الخطوةِ مسجَّلٌ في `WL-048` و`WL-050`–`WL-060`، ولا يُصلَح
 * بتعديلِ سجلٍّ قديم.
 *
 * البوابةُ الأربعون تحرس ما يقع حين **يسقط موضعٌ كاملٌ** فيُنصَّب بديلُه. وهذه
 * تحرس ما يقع حين **يذهب كلُّ شيءٍ** فلا بديلَ يُنصَّب بل تُبنى الدولةُ من
 * نسختِها في بيئةٍ خاليةٍ: أن يكون زمنُ التعافي **رقماً مُعلَناً** يُحاسَب عليه،
 * وأن تكون الدوريّةُ **عدداً** لا عبارةَ «دوريّاً»، وأن تكون الأطوارُ **مرتَّبةً
 * لا تُتخطّى**، وأن تكون البيئةُ **خاليةً فعلاً** قبل الاستعادة، وأن يكون النجاحُ
 * **مطابقةَ بصمةٍ** لا غيابَ خطأ. وعشرُ قواعد:
 *
 *   R0: `config/recovery.yaml` تُحمَّل بمخطَّطها الصارم؛ ووثيقةٌ تُخالف مخطَّطَها
 *       تُوقف البوابةَ قبل أيِّ فحصٍ آخر.
 *   R1: كلُّ طورٍ وحكمٍ وحدثِ تدقيقٍ ورمزِ رفضٍ وضمانٍ موثَّقٌ **بالاسمِ** في
 *       `docs/RECOVERY.md` (المادة 1).
 *   R2: التقابلُ في الاتجاهين بين `refusalCodes` في الوثيقةِ و`RECOVERY_ERRORS`
 *       في `src/recovery/errors.mjs`.
 *   R3: كلُّ رمزِ ضمانٍ (`G-RECOVERY-*`) حاضرٌ **نصّاً** في ملفِّ إنفاذِه المُعلَن.
 *   R4: **العهدُ مكتوبٌ بالرقمِ**: زمنُ التعافي المستهدَفُ ودوريّةُ التجربةِ
 *       وسماحُها مكتوبةٌ أرقاماً في `docs/RECOVERY.md`؛ فعهدٌ يُقال بعبارةِ
 *       «سريعاً» عهدٌ لا يُخلَف أبداً لأنه لا يُقاس أبداً.
 *   R5: **نافذةُ الفقدِ مصدرُها واحدٌ خارجَ هذا العقد**: لا رقمَ لها في
 *       `config/recovery.yaml` أصلاً — تُشتقُّ من `consistency.maxReplicationLagMs`
 *       في عقدِ الأقاليمِ عبر `src/recovery/contract.mjs`؛ ومن كتب النافذةَ
 *       مرَّتين شدَّد إحداهما ونسي الأخرى ثم احتجَّ بالرقمِ الذي يُريحه.
 *   R6: **الأطوارُ أربعةٌ مرتَّبةٌ والتفريغُ قبل الاستعادة**، و`recovery:met` وحدَه
 *       يخرج صفراً؛ فحكمٌ بالإخفاقِ يخرج صفراً حكمٌ لا يقرؤه مسارٌ آليّ.
 *   R7: **الحكمُ نقيٌّ لا يلمس القرصَ**: وحداتُ `src/recovery/` النقيّةُ **لا
 *       تستورد** `node:fs` ولا `node:child_process` ولا `node:process`، ولا
 *       `Date.now(` ولا `setTimeout(` ولا `setInterval(` — فالضمانان
 *       `G-RECOVERY-PURE-JUDGEMENT` و`G-RECOVERY-INJECTED-CLOCK` بنيةٌ لا نيّة.
 *   R8: الحاجزُ مربوطٌ بالمسار: `npm run guard:recovery` في `validate` وفي
 *       `.github/workflows/ci.yml` بنصٍّ واحد، و`npm run recovery:drill` مُعلَنٌ
 *       أمراً واحداً؛ فبوابةٌ لا تُشغَّل آلياً ليست بوابةً بل نيّة.
 *   R9: **اختبارُ القبولِ يُشغِّل عمليّاتٍ حقيقيّةً**: يستورد `node:child_process`
 *       ويُنادي `scripts/recovery-drill.mjs` بالاسمِ ويقرأ رمزَ الخروجِ ويقرأ
 *       واقعةَ `recovery.drill.completed` من الدفترِ بتاريخِها — فمعيارُ «تجربة
 *       ربع سنوية موثَّقة تحقّق زمن التعافي المعلَن» لا يُقاس بنداءِ دالّةٍ في
 *       العمليّةِ نفسِها ولا بنصٍّ يُقرأ في حاجز.
 *
 * **حدٌّ معلَن أول:** الحاجزُ يقرأ النصَّ والوثيقةَ **ولا يُجري تجربةَ تعافٍ**؛
 * ومعيارُ القبولِ سلوكٌ مقيسٌ في `tests/recovery/drill.test.mjs` بعمليّاتٍ أبناءٍ
 * حقيقيّةٍ على عقدٍ حقيقيٍّ وجذرٍ مؤقّت.
 *
 * **حدٌّ معلَن ثانٍ:** R7 يقيس النصَّ لا زمنَ التشغيل: وحدةٌ تلمس القرصَ بنداءٍ
 * ديناميٍّ لا يراه هذا الحاجزُ، وهو دَينٌ معلَنٌ في `docs/REMAINING_WORK.md`.
 *
 * **حدٌّ معلَن ثالث:** الحاجزُ لا يُلزِم بوقوعِ التجربةِ كلَّ تسعين يوماً — لا
 * مُجدوِلَ ذاتيَّ في هذه الخطوةِ؛ الدوريّةُ عهدٌ يُقاس فواتُه من الدفترِ
 * (‏`G-RECOVERY-DUE-FROM-LEDGER`) ويُعرَض بـ`--json`، وذلك دَينٌ معلَن.
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import YAML from 'yaml';

import { RECOVERY_ERRORS, loadRecoveryContract } from '../src/recovery/index.mjs';

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
  'src/recovery/contract.mjs',
  'src/recovery/drill-plan.mjs',
  'src/recovery/integrity.mjs',
  'src/recovery/judgement.mjs',
  'src/recovery/schedule.mjs',
];

/** العقدُ يقرأ الوثيقةَ فيُستثنى من منعِ القرصِ لا من منعِ الساعة. */
const CLOCK_FREE_FILES = [...PURE_FILES];
const DISK_FREE_FILES = PURE_FILES.filter((relative) => relative !== 'src/recovery/contract.mjs');

// ── R0: الوثيقةُ تُحمَّل بمخطَّطها ──
/** @type {import('../src/recovery/contract.mjs').RecoveryContract | null} */
let contract = null;
try {
  contract = loadRecoveryContract();
} catch (error) {
  violations.push(
    `R0: عقدُ التعافي لا يُحمَّل: ${error instanceof Error ? error.message : String(error)}`,
  );
}

if (contract !== null) {
  const doc = readOrEmpty('docs/RECOVERY.md');

  // ── R1: كلُّ معرّفٍ موثَّقٌ بالاسم ──
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
        `R1: ${kind} «${id}» غيرُ موثَّقٍ بالاسمِ في docs/RECOVERY.md — ولا عملَ بلا توثيقٍ (المادة 1).`,
      );
    }
  }

  // ── R2: تقابلُ رموزِ الرفضِ في الاتجاهين ──
  const declaredCodes = new Set(contract.refusalCodes.map((entry) => entry.code));
  const implementedCodes = new Set(/** @type {string[]} */ (Object.values(RECOVERY_ERRORS)));
  for (const code of declaredCodes) {
    if (!implementedCodes.has(code)) {
      violations.push(
        `R2: الرمز «${code}» معلَنٌ في الوثيقةِ ولا وجودَ له في RECOVERY_ERRORS — وعدٌ لا يُنفَّذ.`,
      );
    }
  }
  for (const code of implementedCodes) {
    if (!declaredCodes.has(code)) {
      violations.push(
        `R2: الرمز «${code}» في RECOVERY_ERRORS ولا إعلانَ له في الوثيقةِ — رمزٌ لا يجده قارئُ الوثيقة.`,
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

  // ── R4: العهدُ مكتوبٌ بالرقم ──
  for (const required of [
    String(contract.objective.maxRecoveryMs),
    String(contract.cadence.everyDays),
    String(contract.cadence.graceDays),
  ]) {
    if (!doc.includes(required)) {
      violations.push(
        `R4: الرقم «${required}» غيرُ مكتوبٍ في docs/RECOVERY.md — وعهدٌ يُقال بعبارةِ «سريعاً» عهدٌ لا يُخلَف أبداً لأنه لا يُقاس أبداً.`,
      );
    }
  }
  for (const section of ['زمن التعافي المعلَن', 'الدوريّة', 'حدود معلَنة']) {
    if (!doc.includes(section)) {
      violations.push(
        `R4: قسمُ «${section}» غائبٌ عن docs/RECOVERY.md — والعهدُ يُكتب لا يُفترَض.`,
      );
    }
  }

  // ── R5: نافذةُ الفقدِ مصدرُها واحدٌ خارجَ هذا العقد ──
  /** @type {unknown} */
  let rawContract = null;
  try {
    rawContract = YAML.parse(readOrEmpty('config/recovery.yaml'));
  } catch (error) {
    violations.push(
      `R5: عقدُ التعافي لا يُقرأ نصّاً: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const rawObjective = /** @type {Record<string, unknown>} */ (
    /** @type {Record<string, unknown>} */ (rawContract ?? {}).objective ?? {}
  );
  for (const forbidden of ['maxDataLossMs', 'maxReplicationLagMs', 'rpoMs', 'dataLossMs']) {
    if (Object.hasOwn(rawObjective, forbidden)) {
      violations.push(
        `R5: قسمُ العهدِ يحمل حقلَ «${forbidden}» — ونافذةُ الفقدِ تُشتقُّ من عقدِ الأقاليمِ وحدَه (G-RECOVERY-SINGLE-SOURCE-RPO).`,
      );
    }
  }
  const rawText = readOrEmpty('config/recovery.yaml');
  for (const forbidden of ['maxDataLossMs:', 'maxReplicationLagMs:', 'rpoMs:']) {
    if (rawText.includes(forbidden)) {
      violations.push(
        `R5: «${forbidden}» مكتوبٌ في config/recovery.yaml — ورقمُ نافذةِ الفقدِ لا يُكتب هنا أصلاً بل يُشتقّ.`,
      );
    }
  }
  if (!readOrEmpty('src/recovery/contract.mjs').includes('regions.maxDataLossMs')) {
    violations.push(
      'R5: src/recovery/contract.mjs لا يشتقُّ نافذةَ الفقدِ من عقدِ الأقاليمِ — ومصدرانِ لعتبةٍ واحدةٍ عتبتانِ تتباعدان.',
    );
  }

  // ── R6: الأطوارُ أربعةٌ مرتَّبةٌ وأحكامُ الخروجِ مقروءة ──
  const orderOf = (/** @type {string} */ id) =>
    contract === null ? 0 : (contract.phases.find((phase) => phase.id === id)?.order ?? 0);
  if (contract.phases.length < 4) {
    violations.push(
      `R6: الأطوارُ ${String(contract.phases.length)} والعقدُ يوجب أربعةً على الأقل — واستعادةٌ بلا تفريغٍ ولا مطابقةٍ ليست تجربةَ تعافٍ.`,
    );
  }
  if (orderOf('phase:wipe') >= orderOf('phase:restore')) {
    violations.push(
      'R6: التفريغُ ليس قبل الاستعادةِ في ترتيبِ الأطوارِ — ومن استعاد فوقَ حالةٍ قائمةٍ قاس بقاءَ ما كان لا عودةَ ما ذهب.',
    );
  }
  for (const verdict of contract.verdicts) {
    if (verdict.id === 'recovery:met' && verdict.exitCode !== 0) {
      violations.push('R6: حكمُ البلوغِ لا يخرج صفراً — والمسارُ الآليُّ يقرأ الصفرَ نجاحاً.');
    }
    if (verdict.id !== 'recovery:met' && verdict.exitCode === 0) {
      violations.push(
        `R6: الحكم «${verdict.id}» يخرج صفراً — وحكمٌ بالإخفاقِ يخرج صفراً حكمٌ لا يقرؤه مسارٌ آليّ.`,
      );
    }
  }
  const drill = readOrEmpty('scripts/recovery-drill.mjs');
  for (const forbidden of [
    '--skip-wipe',
    '--no-verify',
    '--force-pass',
    'readlineSync',
    'confirm(',
  ]) {
    if (drill.includes(forbidden)) {
      violations.push(
        `R6: منفِّذُ التجربةِ يحمل «${forbidden}» — وتجربةٌ يُسكَت طورٌ منها بعلمٍ تجربةٌ تُخضِّر نفسَها لا تقيس تعافياً.`,
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
          `R7: الوحدة ${relative} تستورد «${specifier}» — والحكمُ يجب أن يكون نقيّاً: وحدةٌ لا تملك المُلحِقَ لا تستطيع أن تُصلح ما تفحص.`,
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
  const WIRE = 'npm run guard:recovery';
  const manifest = readOrEmpty('package.json');
  if (!manifest.includes(WIRE)) {
    violations.push(`R8: «${WIRE}» غيرُ مربوطٍ في سلسلةِ validate — وبوابةٌ لا تُشغَّل نيّة.`);
  }
  if (!readOrEmpty('.github/workflows/ci.yml').includes(WIRE)) {
    violations.push(
      `R8: «${WIRE}» غيرُ مربوطٍ في .github/workflows/ci.yml — والأخضرُ المحليُّ ليس حكماً (المادة 2).`,
    );
  }
  if (!manifest.includes('"recovery:drill"')) {
    violations.push(
      'R8: أمرُ «recovery:drill» غيرُ مُعلَنٍ في package.json — وتجربةٌ تحتاج سلسلةَ أوامرَ يدويّةٍ تجربةٌ لا تقع.',
    );
  }

  // ── R9: اختبارُ القبولِ يُشغِّل عمليّاتٍ حقيقيّة ──
  const acceptance = readOrEmpty('tests/recovery/drill.test.mjs');
  if (acceptance === '') {
    violations.push(
      'R9: tests/recovery/drill.test.mjs غائب — ومعيارُ «تجربة ربع سنوية موثَّقة تحقّق زمن التعافي المعلَن» بلا اختبارِ قبولٍ ادّعاء.',
    );
  } else {
    /** @type {Array<[string, string]>} */
    const required = [
      ['node:child_process', 'نداءُ دالّةٍ في العمليّةِ نفسِها لا يقيس استعادةً كاملة.'],
      ['scripts/recovery-drill.mjs', 'المنفِّذُ هو ما يُقاس لا محاكاتُه.'],
      ['status', 'رمزُ الخروجِ هو ما يقرؤه المسارُ الآليّ.'],
      [
        'recovery.drill.completed',
        'رمزُ خروجٍ وحدَه لا يُثبت أنّ تجربةً وقعت وكُتبت في الدفترِ بتاريخِها.',
      ],
      ['isoDate', 'تجربةٌ «موثَّقةٌ» تُكتب بتاريخِها لا برقمٍ لا يُقرأ.'],
    ];
    for (const [needle, why] of required) {
      if (!acceptance.includes(needle)) {
        violations.push(`R9: اختبارُ القبولِ لا يذكر «${needle}» — ${why}`);
      }
    }
  }
}

if (violations.length > 0) {
  console.error('⛔ حاجز عقد تجارب التعافي الدوريّة رفض:');
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
const rto = contract === null ? 0 : contract.objective.maxRecoveryMs;
const rpo = contract === null ? 0 : contract.maxDataLossMs;
const everyDays = contract === null ? 0 : contract.cadence.everyDays;
const graceDays = contract === null ? 0 : contract.cadence.graceDays;
const missedCode =
  contract === null
    ? '—'
    : String(contract.verdicts.find((entry) => entry.id === 'recovery:missed')?.exitCode ?? '—');
console.log(
  `✅ حاجز عقد تجارب التعافي الدوريّة: زمنُ تعافٍ مُعلَنٌ قدرُه ${rto} ملّي ثانية مكتوبٌ رقماً في docs/RECOVERY.md ويُحاسَب عليه بحكمٍ يخرج ${missedCode} عند تجاوزِه لا بتحذيرٍ يُقرأ ويُنسى، ودوريّةٌ قدرُها ${everyDays} يوماً بسماحِ ${graceDays} يوماً يُقاس فواتُها من دفترِ التجاربِ لا من ذاكرةِ منفِّذٍ، ونافذةُ فقدٍ قدرُها ${rpo} ملّي ثانية **مشتقّةٌ** من عقدِ الأقاليمِ فلا رقمَ لها في عقدِ التعافي أصلاً، و${phaseCount} أطوارٍ مرتَّبةٍ يُرَدُّ تخطّيها ويقع التفريغُ فيها قبل الاستعادةِ فلا تُستعاد حالةٌ فوقَ حالةٍ باقية، و${verdictCount} أحكامٍ لكلٍّ رمزُ خروجٍ مُفرَدٌ لا يخرج صفراً إلا البلوغُ وحدَه، و${eventCount} أحداثِ تدقيقٍ تُكتب في دفترٍ بإضافةٍ سطريّةٍ بتاريخٍ مقروءٍ، و${codeCount} رمزَ رفضٍ متقابلةً في الاتجاهين مع \`RECOVERY_ERRORS\`، و${guaranteeCount} ضماناتٍ كلٌّ برمزٍ حاضرٍ في ملفِّ إنفاذِه، والحكمُ نقيٌّ لا يستورد قرصاً ولا عمليّةً ولا يقرأ ساعةَ جهازٍ، ومعيارُ «تجربة ربع سنوية موثَّقة تحقّق زمن التعافي المعلَن» مقيسٌ بعمليّاتٍ أبناءٍ حقيقيّةٍ تُفرِّغ جذراً وتستعيده وتُطابِقه بالبصمةِ ملفّاً ملفّاً لا بنصٍّ يُقرأ في حاجز.`,
);
