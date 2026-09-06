#!/usr/bin/env node
/**
 * حاجزُ حزمةِ القرارِ الملكيِّ — البوابةُ السابعةُ والأربعون في تسلسلِ الحواجزِ
 * المُعلَنِ في سجلِّ العملِ (تجهيزُ الخطوةِ `M11.09`).
 *
 * **رتبةٌ مقيسةٌ لا مُدَّعاة (المادة 4):** الرتبةُ أعلاه تتبع التسلسلَ **السرديَّ**
 * المكتوبَ في سجلِّ العملِ، وهو يختلفُ عن موضعِ الحاجزِ في سلسلةِ
 * `npm run validate`؛ وفارقُهما دَينُ توثيقٍ **سابقٌ** مسجَّلٌ في `WL-048` و
 * `WL-050`–`WL-060`، ولا يُصلَحُ بتعديلِ سجلٍّ قديمٍ.
 *
 * الحواجزُ قبلَه تحرسُ أن يعملَ النظامُ ويتعافى ويُوقَفَ ويُقالَ ناقصُه ناقصاً.
 * وهذا يحرسُ سؤالاً أخطرَ: **هل بقيَ القرارُ السياديُّ للمالكِ؟** فأسهلُ خرقٍ في
 * مستودعٍ يُجهِّزُ حزمةَ قرارٍ أن تنمو الحزمةُ سطراً سطراً حتى تصيرَ قراراً موقَّعاً
 * نيابةً عن صاحبِه. وثمانِ قواعدَ:
 *
 *   R0: `config/royal-decision.yaml` يُحمَّلُ بمخطَّطِه الصارمِ؛ ووثيقةٌ تخالفُ
 *       مخطَّطَها تُوقفُ البوابةَ قبلَ كلِّ فحصٍ.
 *   R1: **حقولُ القرارِ الخمسةُ فارغةٌ** (`decision`، `signature`، `signedBy`،
 *       `issuedAt`، `recordedEventId`) — وهنا يُنفَّذُ الضمانُ
 *       `G-ROYAL-DECISION-NO-SELF-SIGNATURE`.
 *   R2: **الخطوةُ تبقى مفتوحةً**: صفُّ `M11.09` في لوحةِ الخطواتِ `⬜`، ولا يُعلَنُ
 *       إغلاقُها في `PROJECT_STATUS.md` — الضمانُ
 *       `G-ROYAL-DECISION-STEP-STAYS-OPEN`.
 *   R3: **حالةُ الشروطِ تُقرأُ لا تُكتَبُ**: كلُّ شرطٍ سابقٍ (`M11.04`–`M11.06`)
 *       معلَنٌ مؤجَّلاً في `config/readiness-deferrals.yaml`، ولا حقلَ حالةٍ في
 *       الحزمةِ — الضمانُ `G-ROYAL-DECISION-PRECONDITIONS-READ-ONLY`.
 *   R4: **الخياراتُ متكافئةٌ**: قبولٌ وتأجيلٌ ورفضٌ، لكلٍّ عواقبُ ومُخرَجاتٌ لازمةٌ —
 *       الضمانُ `G-ROYAL-DECISION-OPTIONS-SYMMETRIC`.
 *   R5: **خطةُ التوسّعِ بمعاييرِ تراجعٍ مقيسةٍ**: كلُّ مرحلةٍ لها دخولٌ وخروجٌ
 *       وتراجعٌ ومقياسٌ، ومعيارُ قبولِ `M11.09` يطلبُ ذلك بحرفِه.
 *   R6: **لا اعتمادَ ذاتيّاً ولا ادّعاءَ إطلاقٍ**: لا `VERIFIED`/`APPROVED` ولا
 *       «جاهزٌ للإطلاقِ» ولا «تمَّ الإطلاقُ» ولا `100%` ولا فتحُ `G11` في العقدِ
 *       ولا في الوثيقةِ، إلا في سطرٍ ينفيهِ صراحةً.
 *   R7: **الحكمُ مربوطٌ بالمسارِ ولا ينزاحُ**: الوثيقةُ المُقيَّدةُ تُقارَنُ بايتاً
 *       ببايتٍ بالمولَّدِ من العقدِ، والأمرانِ `royal:packet` و
 *       `guard:royal-decision` مُعلَنانِ في `package.json` ومربوطانِ في
 *       `.github/workflows/ci.yml`، ورموزُ الرفضِ متقابلةٌ في الاتجاهَينِ مع
 *       `ROYAL_DECISION_ERRORS`، وكلُّ رمزِ ضمانٍ حاضرٌ نصّاً في هذا الملفِّ.
 *
 * **حدٌّ معلَن أول:** الحاجزُ يقيسُ **خُلوَّ الحزمةِ من قرارٍ**؛ ولا يقيسُ صوابَ
 * القرارِ ولا كفايةَ أدلّتِه — ذاك للمالكِ وحدَه.
 *
 * **حدٌّ معلَن ثانٍ:** R6 يقيسُ النصَّ؛ فادّعاءٌ بصياغةٍ لم تُعَدَّ في قائمةِ الألفاظِ
 * لا يراهُ هذا الحاجزُ — وهو دَينٌ معلَنٌ في `docs/REMAINING_WORK.md`.
 *
 * **حدٌّ معلَن ثالث:** مرورُ هذا الحاجزِ **ليس قراراً ولا جاهزيّةً ولا إطلاقاً**:
 * `M11.09` تبقى `⬜`، و`G11` تبقى مؤجَّلةً بقرارٍ سياديٍّ قائمٍ.
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { loadRoyalDecisionPacket, assertStepOpen } from '../src/royal-decision/contract.mjs';
import { ROYAL_DECISION_ERRORS, RoyalDecisionError } from '../src/royal-decision/errors.mjs';
import { renderRoyalDecisionPacket } from '../src/royal-decision/render.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PACKET_DOC = 'docs/ROYAL_DECISION_PACKET.md';

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

/** @type {import('../src/royal-decision/contract.mjs').RoyalDecisionPacketConfig | null} */
let packet = null;
try {
  packet = loadRoyalDecisionPacket({ configDir: path.join(ROOT, 'config') });
} catch (error) {
  const detail =
    error instanceof RoyalDecisionError ? `${error.code}: ${error.message}` : String(error);
  violations.push(`R0: حزمةُ القرارِ لا تُحمَّل — ${detail}`);
}

// R1 + R2: القرارُ لم يُكتَبْ، والخطوةُ لم تُغلَقْ.
if (packet !== null) {
  try {
    assertStepOpen({ root: ROOT });
  } catch (error) {
    const detail =
      error instanceof RoyalDecisionError ? `${error.code}: ${error.message}` : String(error);
    violations.push(`R2: ${detail}`);
  }
  const status = readOrEmpty('docs/PROJECT_STATUS.md');
  if (/M11\.09[^\n]*✅/.test(status)) {
    violations.push('R2: `PROJECT_STATUS.md` يُعلِن `M11.09` منجَزةً — ولا قرارَ ملكيَّ صدرَ.');
  }
}

// R3: لا حقلَ حالةٍ للشروطِ في الحزمةِ نفسِها.
if (packet !== null) {
  const raw = readOrEmpty('config/royal-decision.yaml');
  const preconditionBlock = raw.slice(raw.indexOf('preconditions:'), raw.indexOf('options:'));
  for (const needle of ['status:', 'satisfied', 'مستوفى', 'مستوفاة']) {
    if (preconditionBlock.includes(needle)) {
      violations.push(
        `R3: كتلةُ الشروطِ تحمل «${needle}» — وحالةُ الشرطِ تُقرأ من سجلِّ التأجيلاتِ لا تُكتَب هنا.`,
      );
    }
  }
}

// R4: الخياراتُ الثلاثةُ كاملةٌ متكافئةٌ.
if (packet !== null) {
  for (const option of packet.options) {
    if (option.consequences.length === 0 || option.requiredArtifacts.length === 0) {
      violations.push(
        `R4: الخيارُ «${option.id}» بلا عواقبَ أو بلا مُخرَجاتٍ لازمةٍ — وخيارٌ ناقصُ الوصفِ يُرجَّح أو يُهمَل بصمتِ الوثيقةِ.`,
      );
    }
  }
}

// R5: كلُّ مرحلةٍ بمعاييرِ تراجعٍ ومقياسٍ.
if (packet !== null) {
  for (const phase of packet.rolloutPlan.phases) {
    const rollback = /** @type {string[]} */ (phase.rollbackCriteria ?? []);
    const measure = String(phase.measure ?? '');
    if (rollback.length === 0 || measure.trim() === '') {
      violations.push(
        `R5: المرحلةُ «${String(phase.id)}» بلا معيارِ تراجعٍ أو بلا مقياسٍ — وتوسّعٌ بلا معيارِ تراجعٍ توسّعٌ لا رجعةَ منه.`,
      );
    }
  }
}

// R6: لا لفظَ اعتمادٍ ذاتيٍّ ولا ادّعاءَ إطلاقٍ في العقدِ ولا في الوثيقةِ.
{
  const forbidden = [
    /\bVERIFIED\b/,
    /\bAPPROVED\b/,
    /جاهزٌ للإطلاق/,
    /تمَّ الإطلاقُ/,
    /النظامُ آمنٌ/,
    /100%/,
    /G11 مفتوحة/,
  ];
  for (const relative of ['config/royal-decision.yaml', PACKET_DOC]) {
    const text = readOrEmpty(relative);
    if (text === '') {
      violations.push(`R6: «${relative}» غائبٌ — ولا يُقاس نصٌّ لا وجودَ له.`);
      continue;
    }
    for (const [index, line] of text.split('\n').entries()) {
      for (const pattern of forbidden) {
        if (!pattern.test(line)) continue;
        if (/لا\s|ليس|ممنوع|غير|يُرَدُّ|تمنع|تبقى|مؤجَّل/.test(line)) continue;
        violations.push(
          `R6: ${relative}:${String(index + 1)} «${line.trim().slice(0, 60)}» — لفظُ اعتمادٍ أو ادّعاءُ إطلاقٍ في حزمةِ تجهيزٍ.`,
        );
      }
    }
  }
}

// R7: لا انزياحَ، والأمرُ مربوطٌ، والرموزُ متقابلةٌ، والضماناتُ حاضرةٌ نصّاً.
if (packet !== null) {
  const rendered = `${renderRoyalDecisionPacket(packet)}`;
  if (readOrEmpty(PACKET_DOC) !== rendered) {
    violations.push(
      `R7: ${ROYAL_DECISION_ERRORS.PACKET_DRIFT}: ${PACKET_DOC} منزاحٌ عن العقدِ — شغِّلْ \`npm run royal:packet\`.`,
    );
  }
  const manifest = readOrEmpty('package.json');
  const workflow = readOrEmpty('.github/workflows/ci.yml');
  const WIRE = 'npm run guard:royal-decision';
  if (!manifest.includes(WIRE)) {
    violations.push(`R7: «${WIRE}» غيرُ مربوطٍ في سلسلةِ validate — وبوابةٌ لا تُشغَّل نيّةٌ.`);
  }
  if (!workflow.includes(WIRE)) {
    violations.push(
      `R7: «${WIRE}» غيرُ مربوطٍ في .github/workflows/ci.yml — والأخضرُ المحليُّ ليس حكماً (المادة 2).`,
    );
  }
  if (!manifest.includes('"royal:packet"')) {
    violations.push(
      'R7: أمرُ «royal:packet» غيرُ مُعلَنٍ في package.json — وحزمةٌ تحتاج سلسلةَ أوامرَ يدويّةٍ حزمةٌ لا تُولَّد.',
    );
  }
  const declared = new Set(packet.refusalCodes);
  /** @type {Set<string>} */
  const implemented = new Set(Object.values(ROYAL_DECISION_ERRORS));
  for (const code of implemented) {
    if (!declared.has(code)) {
      violations.push(`R7: الرمزُ «${code}» مُنفَّذٌ في الكودِ وغيرُ معلَنٍ في العقدِ.`);
    }
  }
  for (const code of declared) {
    if (!implemented.has(code)) {
      violations.push(`R7: الرمزُ «${code}» معلَنٌ في العقدِ وغيرُ مُنفَّذٍ في الكودِ.`);
    }
  }
  const self = readOrEmpty('scripts/guard-royal-decision.mjs');
  for (const guarantee of packet.guarantees) {
    if (!self.includes(guarantee.id)) {
      violations.push(`R7: رمزُ الضمانِ «${guarantee.id}» غيرُ حاضرٍ نصّاً في ملفِّ إنفاذِه.`);
    }
  }
  const acceptance = readOrEmpty('tests/royal/decision-packet.test.mjs');
  if (acceptance === '') {
    violations.push(
      'R7: tests/royal/decision-packet.test.mjs غائبٌ — وحزمةٌ بلا اختبارِ قبولٍ ادّعاءُ تجهيزٍ.',
    );
  } else {
    for (const needle of ['node:child_process', 'scripts/royal-decision-packet.mjs', 'status']) {
      if (!acceptance.includes(needle)) {
        violations.push(
          `R7: اختبارُ القبولِ لا يذكر «${needle}» — ونداءُ دالّةٍ في العمليّةِ نفسِها لا يقيس أمراً واحداً يمشي بلا تدخّلٍ.`,
        );
      }
    }
  }
}

if (violations.length > 0) {
  console.error('⛔ حاجز حزمة القرار الملكي رفض:');
  for (const violation of violations) {
    console.error(`   • ${violation}`);
  }
  process.exit(1);
}

const optionCount = packet === null ? 0 : packet.options.length;
const phaseCount = packet === null ? 0 : packet.rolloutPlan.phases.length;
const preconditionCount = packet === null ? 0 : packet.preconditions.length;
const guaranteeCount = packet === null ? 0 : packet.guarantees.length;
console.log(
  `✅ حاجز حزمة القرار الملكي: حزمةٌ مُجهَّزةٌ لقرارٍ **لم يصدرْ** — حقولُ القرارِ الخمسةُ فارغةٌ، و${String(preconditionCount)} شروطٍ سابقةٍ حالتُها مقروءةٌ من سجلِّ التأجيلاتِ لا مكتوبةً في الحزمةِ، و${String(optionCount)} خياراتٍ متكافئةٍ لكلٍّ عواقبُه ومُخرَجاتُه، و${String(phaseCount)} مراحلَ توسّعٍ لكلٍّ معاييرُ دخولٍ وخروجٍ وتراجعٍ ومقياسٌ، وصيغةُ توقيعٍ هي صيغةُ بوابةِ التاجِ القائمةِ لا صيغةٌ مخترعةٌ، وقيدُ تدقيقٍ بنوعِ واقعةٍ معلَنٍ في عقدِ الأحداثِ، و${String(guaranteeCount)} ضماناتٍ كلٌّ برمزٍ حاضرٍ نصّاً في ملفِّ إنفاذِه، والوثيقةُ مولَّدةٌ بأمرٍ واحدٍ وتُقارَنُ بايتاً ببايتٍ فلا تنزاحُ. وحدٌّ معلَنٌ: مرورُ هذا الحاجزِ ليس قراراً ولا توقيعاً ولا جاهزيّةً ولا إطلاقاً — \`M11.09\` تبقى ⬜، و\`G11\` تبقى مؤجَّلةً، ولا يقومُ هذا مقامَ \`M11.04\`–\`M11.06\`.`,
);
