#!/usr/bin/env node
/**
 * حاجزُ عقدِ الأقاليمِ وتجاوزِ الفشل — البوابةُ الأربعون في تسلسلِ الحواجزِ
 * المُعلَنِ في سجلِّ العمل (الخطوة `M10.07`).
 *
 * **رتبةٌ مقيسةٌ لا مُدَّعاة (المادة 4):** الرتبةُ في العنوانِ أعلاه تتبع
 * التسلسلَ المكتوبَ في سجلِّ العملِ منذ `WL-043`، وهو تسلسلٌ **سرديٌّ** يختلف
 * عن موضعِ الحاجزِ المقيسِ في سلسلةِ `npm run validate`؛ وفارقُهما دَينُ توثيقٍ
 * **سابقٌ** لهذه الخطوةِ مسجَّلٌ في `WL-048` و`WL-050`–`WL-059`، ولا يُصلَح
 * بتعديلِ سجلٍّ قديم.
 *
 * البوابةُ التاسعةُ والثلاثون تحرس **كيف تُستبدَل نسخةٌ بنسخةٍ** وأن يقع
 * التراجعُ بلا تدخّل. وهذه تحرس ما يقع حين **يسقط موضعٌ كاملٌ**: أن تكون
 * الأقاليمُ معلَنةً، وأن يكون **الكاتبُ واحداً** لا اثنين، وأن يُنصَّب البديلُ
 * **بلا تدخّل**، وأن يكون **نموذجُ الاتساقِ مكتوباً صريحاً** لا مفهوماً ضمناً،
 * وأن يكون الأثرُ **مقيساً بالرقمِ** لا مقولاً بعبارةِ «استمرّت الخدمة». وعشرُ
 * قواعد:
 *
 *   R0: `config/regions.yaml` تُحمَّل بمخطَّطها الصارم؛ ووثيقةٌ تُخالف مخطَّطَها
 *       تُوقف البوابةَ قبل أيِّ فحصٍ آخر.
 *   R1: كلُّ إقليمٍ وحكمِ صحّةٍ وحدثِ تدقيقٍ ورمزِ رفضٍ وضمانٍ موثَّقٌ **بالاسمِ**
 *       في `docs/REGIONS.md` (المادة 1).
 *   R2: التقابلُ في الاتجاهين بين `refusalCodes` في الوثيقةِ و`REGION_ERRORS`
 *       في `src/regions/errors.mjs`.
 *   R3: كلُّ رمزِ ضمانٍ (`G-REGION-*`) حاضرٌ **نصّاً** في ملفِّ إنفاذِه المُعلَن.
 *   R4: **نموذجُ الاتساقِ مكتوبٌ صريحاً**: `docs/REGIONS.md` تحمل اسمَ النموذجِ
 *       وعهدَ القارئِ وعهدَ الكاتبِ وسقفَ تأخّرِ النسخِ بالرقمِ؛ فنموذجٌ يُفهَم
 *       ضمناً نموذجٌ يُفهَم خطأً يومَ السقوط.
 *   R5: **نافذةُ الفقدِ مصدرُها واحد**: لا حقلَ لها في `impact` من عقدِ
 *       الأقاليمِ — تُشتقّ من `consistency.maxReplicationLagMs` في
 *       `src/regions/contract.mjs`؛ ومن كتب العتبةَ مرّتين شدّد إحداهما ونسي
 *       الأخرى.
 *   R6: **التجاوزُ آليٌّ في العقدِ لا اختياريّ**: `failover.automatic` يجب أن
 *       يكون `true`، وأحكامُ إطلاقِه تشمل `health:down` و`health:unmeasured`؛
 *       فبوابةٌ تُخضَّر بتعطيلِ تجاوزِها ليست بوابة.
 *   R7: **الحكمُ نقيٌّ لا يلمس القرصَ**: وحداتُ `src/regions/` النقيّةُ **لا
 *       تستورد** `node:fs` ولا `node:child_process` ولا `node:process`، ولا
 *       `Date.now(` ولا `setTimeout(` ولا `setInterval(` — فالضمانان
 *       `G-REGION-PURE-JUDGEMENT` و`G-REGION-INJECTED-CLOCK` بنيةٌ لا نيّة.
 *   R8: الحاجزُ مربوطٌ بالمسار: `npm run guard:regions` في `validate` وفي
 *       `.github/workflows/ci.yml` بنصٍّ واحد؛ فبوابةٌ لا تُشغَّل آلياً ليست
 *       بوابةً بل نيّة.
 *   R9: **اختبارُ القبولِ يُشغِّل عمليّاتٍ حقيقيّةً**: يستورد
 *       `node:child_process` ويُنادي `scripts/region-drill.mjs` بالاسمِ ويقرأ
 *       رمزَ الخروجِ ويقرأ واقعةَ `region.failover.performed` من الدفتر — فمعيارُ
 *       «إسقاط إقليم كامل ⇒ استمرار الخدمة بأثر معلَن ومقبول» لا يُقاس بنداءِ
 *       دالّةٍ في العمليّةِ نفسِها ولا بنصٍّ يُقرأ في حاجز.
 *
 * **حدٌّ معلَن أول:** الحاجزُ يقرأ النصَّ والوثيقةَ **ولا يُسقِط إقليماً ولا
 * يُنصِّب كاتباً**؛ ومعيارُ القبولِ سلوكٌ مقيسٌ في
 * `tests/regions/failover.test.mjs` بعمليّاتٍ أبناءٍ حقيقيّةٍ على عقدٍ حقيقيّ
 * وجذرٍ مؤقّت.
 *
 * **حدٌّ معلَن ثانٍ:** R7 يقيس النصَّ لا زمنَ التشغيل: وحدةٌ تلمس القرصَ بنداءٍ
 * ديناميٍّ لا يراه هذا الحاجزُ، وهو دَينٌ معلَنٌ في `docs/REMAINING_WORK.md`.
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import YAML from 'yaml';

import { REGION_ERRORS, loadRegionsContract } from '../src/regions/index.mjs';

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
  'src/regions/contract.mjs',
  'src/regions/health.mjs',
  'src/regions/failover.mjs',
  'src/regions/impact.mjs',
];

/** الوحداتُ النقيّةُ حكماً — والعقدُ يقرأ الوثيقةَ فيُستثنى من منعِ القرصِ لا من منعِ الساعة. */
const CLOCK_FREE_FILES = [...PURE_FILES];
const DISK_FREE_FILES = PURE_FILES.filter((relative) => relative !== 'src/regions/contract.mjs');

// ── R0: الوثيقةُ تُحمَّل بمخطَّطها ──
/** @type {import('../src/regions/contract.mjs').RegionsContract | null} */
let contract = null;
try {
  contract = loadRegionsContract();
} catch (error) {
  violations.push(
    `R0: عقدُ الأقاليمِ لا يُحمَّل: ${error instanceof Error ? error.message : String(error)}`,
  );
}

if (contract !== null) {
  const doc = readOrEmpty('docs/REGIONS.md');

  // ── R1: كلُّ معرّفٍ موثَّقٌ بالاسم ──
  /** @type {Array<[string, string]>} */
  const documented = [
    ...contract.regions.map((region) => /** @type {[string, string]} */ (['الإقليم', region.id])),
    ...contract.health.map(
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
        `R1: ${kind} «${id}» غيرُ موثَّقٍ بالاسمِ في docs/REGIONS.md — ولا عملَ بلا توثيقٍ (المادة 1).`,
      );
    }
  }

  // ── R2: تقابلُ رموزِ الرفضِ في الاتجاهين ──
  const declaredCodes = new Set(contract.refusalCodes.map((entry) => entry.code));
  const implementedCodes = new Set(/** @type {string[]} */ (Object.values(REGION_ERRORS)));
  for (const code of declaredCodes) {
    if (!implementedCodes.has(code)) {
      violations.push(
        `R2: الرمز «${code}» معلَنٌ في الوثيقةِ ولا وجودَ له في REGION_ERRORS — وعدٌ لا يُنفَّذ.`,
      );
    }
  }
  for (const code of implementedCodes) {
    if (!declaredCodes.has(code)) {
      violations.push(
        `R2: الرمز «${code}» في REGION_ERRORS ولا إعلانَ له في الوثيقةِ — رمزٌ لا يجده قارئُ الوثيقة.`,
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

  // ── R4: نموذجُ الاتساقِ مكتوبٌ صريحاً ──
  for (const required of [
    contract.consistency.model,
    String(contract.consistency.maxReplicationLagMs),
  ]) {
    if (!doc.includes(required)) {
      violations.push(
        `R4: «${required}» غيرُ مكتوبٍ في docs/REGIONS.md — ونموذجُ اتساقٍ يُفهَم ضمناً نموذجٌ يُفهَم خطأً يومَ السقوط.`,
      );
    }
  }
  for (const section of ['نموذج الاتساق', 'عهد القارئ', 'عهد الكاتب']) {
    if (!doc.includes(section)) {
      violations.push(`R4: قسمُ «${section}» غائبٌ عن docs/REGIONS.md — والعهدُ يُكتب لا يُفترَض.`);
    }
  }

  // ── R5: نافذةُ الفقدِ مصدرُها واحد ──
  /** @type {unknown} */
  let rawContract = null;
  try {
    rawContract = YAML.parse(readOrEmpty('config/regions.yaml'));
  } catch (error) {
    violations.push(
      `R5: عقدُ الأقاليمِ لا يُقرأ نصّاً: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const rawImpact = /** @type {Record<string, unknown>} */ (
    /** @type {Record<string, unknown>} */ (rawContract ?? {}).impact ?? {}
  );
  for (const forbidden of ['maxDataLossMs', 'maxReplicationLagMs', 'dataLossMs']) {
    if (Object.hasOwn(rawImpact, forbidden)) {
      violations.push(
        `R5: قسمُ الأثرِ يحمل حقلَ «${forbidden}» — ونافذةُ الفقدِ تُشتقّ من عهدِ الاتساقِ وحدَه (G-REGION-SINGLE-SOURCE-BUDGET).`,
      );
    }
  }
  if (contract.maxDataLossMs !== contract.consistency.maxReplicationLagMs) {
    violations.push(
      'R5: نافذةُ الفقدِ المشتقّةُ لا تساوي سقفَ تأخّرِ النسخِ — ومصدرانِ لعتبةٍ واحدةٍ عتبتانِ تتباعدان.',
    );
  }
  if (!readOrEmpty('src/regions/impact.mjs').includes('contract.maxDataLossMs')) {
    violations.push(
      'R5: src/regions/impact.mjs لا يقرأ نافذةَ الفقدِ من العقدِ المشتقِّ — ورقمٌ يُكتب في الحاسبِ رقمٌ لا يحرسه مخطَّط.',
    );
  }

  // ── R6: التجاوزُ آليٌّ في العقدِ لا اختياريّ ──
  if (contract.failover.automatic !== true) {
    violations.push(
      'R6: failover.automatic ليس true — وتعطيلُ التجاوزِ الآليِّ تعطيلٌ للضمانِ G-REGION-FAILOVER-AUTOMATIC لا تهيئةٌ، ومعيارُ القبولِ نصُّه «استمرار الخدمة».',
    );
  }
  for (const required of ['health:down', 'health:unmeasured']) {
    if (!contract.failover.triggerOn.includes(required)) {
      violations.push(
        `R6: «${required}» ليس من أحكامِ إطلاقِ التجاوزِ — وإقليمٌ بلا قياسٍ لا يُقرأ سليماً (G-REGION-NO-EMPTY-SUCCESS).`,
      );
    }
  }
  const drill = readOrEmpty('scripts/region-drill.mjs');
  for (const forbidden of ['--no-failover', '--manual', 'readlineSync', 'confirm(']) {
    if (drill.includes(forbidden)) {
      violations.push(
        `R6: منفِّذُ التمرينِ يحمل «${forbidden}» — وتجاوزٌ يحتاج إذناً ليس تجاوزاً بل إشعارٌ يصل بعد أن يقع الضرر.`,
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
  const WIRE = 'npm run guard:regions';
  if (!readOrEmpty('package.json').includes(WIRE)) {
    violations.push(`R8: «${WIRE}» غيرُ مربوطٍ في سلسلةِ validate — وبوابةٌ لا تُشغَّل نيّة.`);
  }
  if (!readOrEmpty('.github/workflows/ci.yml').includes(WIRE)) {
    violations.push(
      `R8: «${WIRE}» غيرُ مربوطٍ في .github/workflows/ci.yml — والأخضرُ المحليُّ ليس حكماً (المادة 2).`,
    );
  }

  // ── R9: اختبارُ القبولِ يُشغِّل عمليّاتٍ حقيقيّة ──
  const acceptance = readOrEmpty('tests/regions/failover.test.mjs');
  if (acceptance === '') {
    violations.push(
      'R9: tests/regions/failover.test.mjs غائب — ومعيارُ «إسقاط إقليم كامل ⇒ استمرار الخدمة بأثر معلَن ومقبول» بلا اختبارِ قبولٍ ادّعاء.',
    );
  } else {
    /** @type {Array<[string, string]>} */
    const required = [
      ['node:child_process', 'نداءُ دالّةٍ في العمليّةِ نفسِها لا يقيس سقوطَ إقليم.'],
      ['scripts/region-drill.mjs', 'المنفِّذُ هو ما يُقاس لا محاكاتُه.'],
      ['status', 'رمزُ الخروجِ هو ما يقرؤه المسارُ الآليّ.'],
      [
        'region.failover.performed',
        'رمزُ خروجٍ وحدَه لا يُثبت أنّ كاتباً جديداً نُصِّب فعلاً وقُبِلت فيه كتابة.',
      ],
    ];
    for (const [needle, why] of required) {
      if (!acceptance.includes(needle)) {
        violations.push(`R9: اختبارُ القبولِ لا يذكر «${needle}» — ${why}`);
      }
    }
  }
}

if (violations.length > 0) {
  console.error('⛔ حاجز عقد الأقاليم وتجاوز الفشل رفض:');
  for (const violation of violations) {
    console.error(`   • ${violation}`);
  }
  process.exit(1);
}

const regionCount = contract === null ? 0 : contract.regions.length;
const healthCount = contract === null ? 0 : contract.health.length;
const eventCount = contract === null ? 0 : contract.audit.events.length;
const codeCount = contract === null ? 0 : contract.refusalCodes.length;
const guaranteeCount = contract === null ? 0 : contract.guarantees.length;
const lagBudget = contract === null ? 0 : contract.consistency.maxReplicationLagMs;
console.log(
  `✅ حاجز عقد الأقاليم وتجاوز الفشل: ${regionCount} أقاليمَ معلَنةً لكلٍّ دورٌ وأولويّةٌ مُفرَدةٌ وجذرُ حالةٍ لا يتداخل مع جذرِ غيرِه، وكاتبٌ **واحدٌ** يُرفَض ثانيه عند تحميلِ العقدِ لا في منتصفِ السقوط، و${healthCount} أحكامِ صحّةٍ لكلٍّ رمزُ خروجٍ مُفرَدٌ يقرؤه المسارُ الآليُّ لا الإنسان، ونموذجُ الاتساق «${contract === null ? '—' : contract.consistency.model}» مكتوبٌ صريحاً في docs/REGIONS.md بعهدِ قارئِه وعهدِ كاتبِه وسقفِ تأخّرِ نسخِه ${lagBudget} ملّي ثانية، ونافذةُ الفقدِ مشتقّةٌ من ذلك السقفِ وحدَه فلا رقمَ لها في قسمِ الأثر، والتجاوزُ آليٌّ مُعلَنٌ يُطلَق على السقوطِ وعلى غيابِ القياسِ معاً فلا يُقرأ صمتُ الإقليمِ سلامةً، و${eventCount} أحداثِ تدقيقٍ تُكتب في دفترٍ بإضافةٍ سطريّةٍ منه يُقرأ من نُصِّب ومتى، و${codeCount} رمزَ رفضٍ متقابلةً في الاتجاهين مع \`REGION_ERRORS\`، و${guaranteeCount} ضماناتٍ كلٌّ برمزٍ حاضرٍ في ملفِّ إنفاذِه، والحكمُ نقيٌّ لا يستورد قرصاً ولا عمليّةً ولا يقرأ ساعةَ جهازٍ، ومعيارُ «إسقاط إقليم كامل ⇒ استمرار الخدمة بأثر معلَن ومقبول» مقيسٌ بعمليّاتٍ أبناءٍ حقيقيّةٍ لا بنصٍّ يُقرأ.`,
);
