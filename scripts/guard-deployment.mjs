#!/usr/bin/env node
/**
 * حاجزُ عقدِ النشرِ القابلِ للتراجع — البوابةُ التاسعةُ والثلاثون في تسلسلِ
 * الحواجزِ المُعلَنِ في سجلِّ العمل (الخطوة `M10.06`).
 *
 * **رتبةٌ مقيسةٌ لا مُدَّعاة (المادة 4):** الرتبةُ في العنوانِ أعلاه تتبع
 * التسلسلَ المكتوبَ في سجلِّ العملِ منذ `WL-043`، وهو تسلسلٌ **سرديٌّ** يختلف
 * عن موضعِ الحاجزِ المقيسِ في سلسلةِ `npm run validate`؛ وفارقُهما دَينُ توثيقٍ
 * **سابقٌ** لهذه الخطوةِ مسجَّلٌ في `WL-048` و`WL-050`–`WL-058`، ولا يُصلَح
 * بتعديلِ سجلٍّ قديم.
 *
 * البوابةُ الثامنةُ والثلاثون تحرس أن تكون البيئةُ مُعلَنةً وتُقام بأمرٍ واحد.
 * وهذه تحرس ما يقع **بعد** أن تصحّ البيئةُ وتصحّ النسخة: **كيف تُستبدَل نسخةٌ
 * بنسخةٍ**، وأن يكون لكلِّ موجةٍ بوابةٌ من **عهدٍ مقيسٍ** لا من رقمٍ يُكتب هنا،
 * وأن يقع التراجعُ **بلا تدخّل**. وعشرُ قواعد:
 *
 *   R0: `config/deployment.yaml` تُحمَّل بمخطَّطها الصارم وتُبنى منها خطّةٌ؛
 *       ووثيقةٌ تُخالف مخطَّطَها أو خطّةٌ لا تتّسع موجاتُها تُوقف البوابةَ قبل
 *       أيِّ فحصٍ آخر.
 *   R1: كلُّ موجةٍ وحكمٍ وحدثِ تدقيقٍ ورمزِ رفضٍ وضمانٍ موثَّقٌ **بالاسمِ** في
 *       `docs/DEPLOYMENT.md` (المادة 1).
 *   R2: التقابلُ في الاتجاهين بين `refusalCodes` في الوثيقةِ و`DEPLOY_ERRORS`
 *       في `src/deployment/errors.mjs`.
 *   R3: كلُّ رمزِ ضمانٍ (`G-DEPLOY-*`) حاضرٌ **نصّاً** في ملفِّ إنفاذِه المُعلَن.
 *   R4: **العتباتُ من أهدافِ الخدمةِ لا قائمةً ثانية**: كلُّ هدفٍ تُشير إليه
 *       بوابةُ موجةٍ معلَنٌ في `config/service-levels.yaml`، **ولا رقمَ هدفٍ
 *       مكتوبٌ في `config/deployment.yaml`** — مصدرُ حقيقةٍ واحدٌ للعتبة.
 *   R5: **التراجعُ آليٌّ في العقدِ لا اختياريّ**: `rollback.automatic` يجب أن
 *       يكون `true`، وأحكامُ إطلاقِه تشمل `verdict:broken` و
 *       `verdict:unmeasured`؛ فبوابةٌ تُخضَّر بتعطيلِ تراجعِها ليست بوابة.
 *   R6: الحاجزُ مربوطٌ بالمسار: `npm run guard:deployment` في `validate` وفي
 *       `.github/workflows/ci.yml` بنصٍّ واحد؛ فبوابةٌ لا تُشغَّل آلياً ليست
 *       بوابةً بل نيّة.
 *   R7: **الحكمُ نقيٌّ لا يلمس القرصَ**: `src/deployment/plan.mjs` و
 *       `rollout.mjs` و`releases.mjs` **لا تستورد** `node:fs` ولا
 *       `node:child_process` ولا `node:process` — فالضمانُ
 *       `G-DEPLOY-PURE-JUDGEMENT` بنيةٌ لا نيّة.
 *   R8: **لا ساعةَ نظامٍ ولا مؤقِّتَ ذاتيّ** في وحداتِ المسارِ النقيّة: لا
 *       `Date.now(` ولا `setTimeout(` ولا `setInterval(`.
 *   R9: **اختبارُ القبولِ يُشغِّل عمليّاتٍ حقيقيّةً**: يستورد
 *       `node:child_process` ويُنادي `scripts/deploy.mjs` بالاسمِ ويقرأ رمزَ
 *       الخروجِ ويقرأ واقعةَ `deploy.rollback.performed` من الدفتر — فمعيارُ
 *       «إصدارٌ معيوبٌ ⇒ تراجعٌ تلقائيٌّ بلا تدخّل» لا يُقاس بنداءِ دالّةٍ في
 *       العمليّةِ نفسِها ولا بنصٍّ يُقرأ في حاجز.
 *
 * **حدٌّ معلَن أول:** الحاجزُ يقرأ النصَّ والوثيقةَ **ولا يُنفِّذ نشراً ولا
 * تراجعاً**؛ ومعيارُ القبولِ سلوكٌ مقيسٌ في `tests/deployment/rollback.test.mjs`
 * بعمليّاتٍ أبناءٍ حقيقيّةٍ على عقدٍ حقيقيّ وجذرٍ مؤقّت.
 *
 * **حدٌّ معلَن ثانٍ:** R4 يقيس أنّ الأهدافَ معلَنةٌ وأنّ العقدَ لا يحمل رقمَ
 * هدفٍ؛ ولا يقيس أنّ الهدفَ نفسَه صحيحُ الرقمِ — فذاك عهدُ `M10.02` وحاجزُه.
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import YAML from 'yaml';

import {
  DEPLOY_ERRORS,
  buildRolloutPlan,
  loadDeploymentContract,
} from '../src/deployment/index.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

/** @param {string} relative @returns {string} */
function readOrEmpty(relative) {
  const file = path.join(ROOT, relative);
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
}

/** @type {string[]} */
const violations = [];

/** الوحداتُ التي يجب أن تبقى نقيّةً تماماً (R7 وR8). */
const PURE_FILES = [
  'src/deployment/plan.mjs',
  'src/deployment/rollout.mjs',
  'src/deployment/releases.mjs',
];

// ── R0: الوثيقةُ تُحمَّل بمخطَّطها وتُبنى منها خطّة ──
/** @type {import('../src/deployment/contract.mjs').DeploymentContract | null} */
let contract = null;
/** @type {ReadonlyArray<import('../src/deployment/plan.mjs').PlannedWave>} */
let plan = [];
try {
  contract = loadDeploymentContract();
  plan = buildRolloutPlan(contract);
} catch (error) {
  violations.push(
    `R0: عقدُ النشرِ لا يُحمَّل أو لا تُبنى منه خطّةٌ: ${error instanceof Error ? error.message : String(error)}`,
  );
}

if (contract !== null) {
  const doc = readOrEmpty('docs/DEPLOYMENT.md');

  // ── R1: كلُّ معرّفٍ موثَّقٌ بالاسم ──
  /** @type {Array<[string, string]>} */
  const documented = [
    ...contract.waves.map((wave) => /** @type {[string, string]} */ (['الموجة', wave.id])),
    ...contract.verdicts.map(
      (verdict) => /** @type {[string, string]} */ (['حكم النشر', verdict.id]),
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
        `R1: ${kind} «${id}» غيرُ موثَّقٍ بالاسمِ في docs/DEPLOYMENT.md — ولا عملَ بلا توثيقٍ (المادة 1).`,
      );
    }
  }

  // ── R2: تقابلُ رموزِ الرفضِ في الاتجاهين ──
  /** @type {Set<string>} */
  const declaredCodes = new Set(contract.refusalCodes.map((entry) => entry.code));
  /** @type {Set<string>} */
  const implementedCodes = new Set(Object.values(DEPLOY_ERRORS));
  for (const code of declaredCodes) {
    if (!implementedCodes.has(code)) {
      violations.push(
        `R2: الرمز «${code}» معلَنٌ في الوثيقةِ ولا وجودَ له في DEPLOY_ERRORS — وعدٌ لا يُنفَّذ.`,
      );
    }
  }
  for (const code of implementedCodes) {
    if (!declaredCodes.has(code)) {
      violations.push(
        `R2: الرمز «${code}» في DEPLOY_ERRORS ولا إعلانَ له في الوثيقةِ — رمزٌ لا يجده قارئُ الوثيقة.`,
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

  // ── R4: العتباتُ من أهدافِ الخدمةِ لا قائمةً ثانية ──
  /** @type {Set<string>} */
  const declaredObjectives = new Set();
  try {
    const policy = YAML.parse(readOrEmpty('config/service-levels.yaml'));
    for (const capability of policy?.capabilities ?? []) {
      for (const objective of capability?.objectives ?? []) {
        declaredObjectives.add(String(objective.id));
      }
    }
  } catch (error) {
    violations.push(
      `R4: وثيقةُ أهدافِ الخدمةِ لا تُقرأ فلا يُقاس تقابلُ العتبات: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (declaredObjectives.size > 0) {
    for (const wave of contract.waves) {
      for (const objectiveId of wave.objectives) {
        if (!declaredObjectives.has(objectiveId)) {
          violations.push(
            `R4: بوابةُ الموجةِ «${wave.id}» تُشير إلى الهدف «${objectiveId}» وهو غيرُ معلَنٍ في config/service-levels.yaml — وعتبةٌ بلا عهدٍ خلفَها رقمٌ بلا مصدر.`,
          );
        }
      }
    }
  }
  const contractText = readOrEmpty('config/deployment.yaml');
  for (const forbidden of ['target:', 'thresholdMs:']) {
    if (contractText.includes(`\n    ${forbidden}`) || contractText.includes(`\n  ${forbidden}`)) {
      violations.push(
        `R4: عقدُ النشرِ يحمل حقلَ «${forbidden}» — والعتبةُ تُقرأ من أهدافِ الخدمةِ بمعرّفِها، ومن كتبها مرّتين شدّد إحداهما ونسي الأخرى.`,
      );
    }
  }

  // ── R5: التراجعُ آليٌّ في العقدِ لا اختياريّ ──
  if (contract.rollback.automatic !== true) {
    violations.push(
      'R5: rollback.automatic ليس true — وتعطيلُ التراجعِ الآليِّ تعطيلٌ للضمانِ G-DEPLOY-ROLLBACK-AUTOMATIC لا تهيئةٌ، ومعيارُ القبولِ نصُّه «بلا تدخل».',
    );
  }
  for (const required of ['verdict:broken', 'verdict:unmeasured']) {
    if (!contract.rollback.triggerOn.includes(required)) {
      violations.push(
        `R5: «${required}» ليس من أحكامِ إطلاقِ التراجعِ — وموجةٌ بلا قياسٍ كافٍ لا تُقرأ نجاحاً (G-DEPLOY-NO-EMPTY-SUCCESS).`,
      );
    }
  }

  // ── R6: الحاجزُ مربوطٌ بالمسارِ بنصٍّ واحد ──
  const WIRE = 'npm run guard:deployment';
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
          `R7: الوحدة ${relative} تستورد «${specifier}» — والحكمُ يجب أن يكون نقيّاً: وحدةٌ لا تملك المُلحِقَ لا تستطيع أن تُصلح ما تفحص.`,
        );
      }
    }
  }

  // ── R8: لا ساعةَ نظامٍ ولا مؤقِّتَ ذاتيّ ──
  for (const relative of PURE_FILES) {
    const source = readOrEmpty(relative);
    if (source === '') continue;
    if (source.includes('Date.now(')) {
      violations.push(
        `R8: ${relative} يُنادي Date.now( — والساعةُ تُحقَن، فمن قرأها في متنِ منطقِه كتب اختباراً لا يُثبَّت زمنُه.`,
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
  const acceptance = readOrEmpty('tests/deployment/rollback.test.mjs');
  if (acceptance === '') {
    violations.push(
      'R9: tests/deployment/rollback.test.mjs غائب — ومعيارُ «إصدارٌ معيوبٌ ⇒ تراجعٌ تلقائيٌّ بلا تدخّل» بلا اختبارِ قبولٍ ادّعاء.',
    );
  } else {
    if (!acceptance.includes('node:child_process')) {
      violations.push(
        'R9: اختبارُ القبولِ لا يستورد node:child_process — ونداءُ دالّةٍ في العمليّةِ نفسِها لا يقيس نشراً.',
      );
    }
    if (!acceptance.includes('scripts/deploy.mjs')) {
      violations.push(
        'R9: اختبارُ القبولِ لا يُنادي scripts/deploy.mjs بالاسمِ — والمنفِّذُ هو ما يُقاس لا محاكاتُه.',
      );
    }
    if (!acceptance.includes('status')) {
      violations.push(
        'R9: اختبارُ القبولِ لا يقرأ رمزَ خروجِ العمليّةِ الابنةِ — ورمزُ الخروجِ هو ما يقرؤه المسارُ الآليّ.',
      );
    }
    if (!acceptance.includes('deploy.rollback.performed')) {
      violations.push(
        'R9: اختبارُ القبولِ لا يقرأ واقعةَ deploy.rollback.performed من الدفترِ — ورمزُ خروجٍ وحدَه لا يُثبت أنّ الإصدارَ السليمَ أُعيد فعلاً.',
      );
    }
  }
}

if (violations.length > 0) {
  console.error('⛔ حاجز عقد النشر القابل للتراجع رفض:');
  for (const violation of violations) console.error(`   • ${violation}`);
  process.exit(1);
}

const waveCount = plan.length;
const verdictCount = contract === null ? 0 : contract.verdicts.length;
const objectiveCount =
  contract === null ? 0 : new Set(contract.waves.flatMap((wave) => wave.objectives)).size;
const eventCount = contract === null ? 0 : contract.audit.events.length;
const codeCount = contract === null ? 0 : contract.refusalCodes.length;
const guaranteeCount = contract === null ? 0 : contract.guarantees.length;
console.log(
  `✅ حاجز عقد النشر القابل للتراجع: ${waveCount} موجاتِ نشرٍ نصيبُها يتّسع ولا يضيق وينتهي بالحِمل كلِّه، وبواباتُها ${objectiveCount} أهدافِ خدمةٍ مقروءةً من config/service-levels.yaml بمعرّفاتِها لا برقمٍ يُكتب ثانيةً في عقدِ النشر، و${verdictCount} أحكامٍ لكلٍّ رمزُ خروجٍ مُفرَدٌ يقرؤه المسارُ الآليُّ لا الإنسان، والتراجعُ آليٌّ مُعلَنٌ يُطلَق على العطبِ وعلى غيابِ القياسِ معاً فلا يُقرأ صمتُ الموجةِ نجاحاً، و${eventCount} أحداثِ تدقيقٍ تُكتب في دفترٍ بإضافةٍ سطريّةٍ منه يُشتقّ هدفُ التراجعِ لا من ذاكرةِ منفِّذٍ، و${codeCount} رمزَ رفضٍ متقابلةً في الاتجاهين مع \`DEPLOY_ERRORS\`، و${guaranteeCount} ضماناتٍ كلٌّ برمزٍ حاضرٍ في ملفِّ إنفاذِه، والحكمُ نقيٌّ لا يستورد قرصاً ولا عمليّةً، ومعيارُ «إصدارٌ معيوبٌ ⇒ تراجعٌ تلقائيٌّ بلا تدخّل» مقيسٌ بعمليّاتٍ أبناءٍ حقيقيّةٍ لا بنصٍّ يُقرأ.`,
);
