// حرسُ صدقِ وثيقةِ الاحتواءِ في شرطِ «التقييمِ قبلَ التنشيطِ» — النتيجة `R6-B-02`.
//
// العيبُ الذي يُغلقه: `docs/AGENT_CONTAINMENT.md §6` بندُها الرابعُ كان يُقرّ أنّ
// التقييمَ قبلَ التنشيطِ **غيرُ منفَّذٍ** وأنّ شرطَ البوّابةِ «بصمةٌ وتقييمٌ» نصفُه
// قائمٌ ونصفُه لا — بينما `ModelRegistry.activate` كان **يرفضُ** التنشيطَ بلا نتيجةِ
// تقييمٍ ناجحةٍ فعلاً. فالوثيقةُ الحيّةُ كانت تصفُ ماضياً، والقارئُ يبني على نصٍّ
// أضعفَ ممّا في الشفرةِ — وهو كذبٌ في الاتّجاهِ المعاكسِ لا يقلُّ ضرراً.
//
// وليسَ العلاجُ تحريرَ سطرٍ مرّةً واحدةً: هذا الملفُّ يقيسُ **السلوكَ أولاً** ثمَّ
// يُلزمُ الوثيقةَ به في الاتّجاهينِ معاً:
//   • إن رُفعَ حارسُ التقييمِ من الشفرةِ ⇒ يسقطُ قياسُ السلوكِ.
//   • وإن أُعيدَ إلى الوثيقةِ إقرارُ «غيرِ منفَّذٍ» والحارسُ قائمٌ ⇒ يسقطُ قياسُ النصِّ.
//
// التشغيل: node --test tests/docs/agent-containment-claims.test.mjs

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { registerTmpRoot } from '/home/user/workspace/xuux-review-284f74d0/tests/helpers/tmp-roots.mjs';

import { ModelEvaluationLedger } from '/home/user/workspace/xuux-review-284f74d0/src/models/evaluation.mjs';
import { ModelRegistry, ModelState } from '/home/user/workspace/xuux-review-284f74d0/src/models/model-registry.mjs';
import { createWeightStore } from '/home/user/workspace/xuux-review-284f74d0/src/models/weight-store.mjs';
import { createMemoryRepository } from '/home/user/workspace/xuux-review-284f74d0/src/persistence/repository-memory.mjs';
import { EventLog } from '/home/user/workspace/xuux-review-284f74d0/src/root-of-trust/event-log.mjs';
import { experimentLedgerFor } from '/home/user/workspace/xuux-review-284f74d0/tests/helpers/experiment-support.mjs';
import { createInferenceGate, INFERENCE_ERRORS } from '/home/user/workspace/xuux-review-284f74d0/src/inference/inference-gate.mjs';

const ROOT = '/home/user/workspace/xuux-review-284f74d0';
const CONTAINMENT = '/tmp/council-gpt-6-astra/AGENT_CONTAINMENT-mutant.md';

/**
 * يقيسُ هل حارسُ التقييمِ قبلَ التنشيطِ قائمٌ في الشفرةِ فعلاً.
 * @returns {Promise<boolean>} صحيحٌ إن رُفضَ تنشيطُ نموذجٍ معتمَدٍ بلا نتيجةِ تقييمٍ
 */
async function evaluationGateEnforced() {
  const log = new EventLog();
  const weightStore = createWeightStore({
    root: registerTmpRoot(fs.mkdtempSync(path.join(os.tmpdir(), 'containment-claims-'))),
  });
  const registry = new ModelRegistry({
    log,
    repository: createMemoryRepository(ModelRegistry.spec),
    weightStore,
    evaluationLedger: new ModelEvaluationLedger({ log, experiments: experimentLedgerFor(log) }),
  });
  const model = await registry.register({
    name: 'نموذجُ قياسِ الحارسِ',
    modelVersion: 'r6-b-02',
    purpose: 'classify',
    provider: 'اختبار',
    weights: 'أوزانُ قياسٍ',
  });
  await registry.transition(model.id, ModelState.SANDBOXED, 'عزلٌ قبلَ الاعتمادِ');
  await registry.transition(model.id, ModelState.APPROVED, 'اعتمادٌ مشروطٌ بالتقييمِ');
  try {
    await registry.activate(model.id);
    return false;
  } catch (error) {
    return /** @type {{ code?: string }} */ (error).code === 'MODEL_EVALUATION_MISSING';
  }
}

/**
 * قسمُ «حدودٍ معلنةٍ» وحدَه: القياسُ على ما تُقرُّه الوثيقةُ اليومَ لا على
 * فقراتِها التاريخيّةِ.
 * @returns {string} نصُّ القسمِ
 */
function declaredLimitsSection() {
  const text = fs.readFileSync(CONTAINMENT, 'utf8');
  const start = text.indexOf('## 6.');
  assert.notEqual(start, -1, 'قسمُ الحدودِ المعلنةِ غائبٌ عن وثيقةِ الاحتواءِ');
  const after = text.indexOf('\n## ', start + 1);
  return after === -1 ? text.slice(start) : text.slice(start, after);
}

test('R6-B-02: وثيقةُ الاحتواءِ لا تُقرُّ بغيابِ حارسٍ قائمٍ في الشفرةِ', async () => {
  const enforced = await evaluationGateEnforced();
  // القياسُ سلوكٌ لا نصٌّ: الحارسُ يُرفَضُ به التنشيطُ برمزٍ مسمّىً.
  assert.equal(enforced, true, 'تنشيطٌ بلا نتيجةِ تقييمٍ لم يُرفَضْ بـ`MODEL_EVALUATION_MISSING`');

  const section = declaredLimitsSection();
  const claimsMissing = /`M6\.08`[^\n]*غير\s*منفَّ?ذ/u.test(section);
  assert.equal(
    claimsMissing,
    false,
    'الحارسُ قائمٌ في الشفرةِ والوثيقةُ تُقرُّ أنّه غيرُ منفَّذٍ — نصٌّ يصفُ ماضياً',
  );
});

test('R6-B-02: قسمُ الحدودِ المعلنةِ يذكرُ الحدَّ القائمَ في سندِ التقييمِ لا ينفيه', () => {
  const section = declaredLimitsSection();
  // الحدُّ الحقيقيُّ الباقي: سندُ النتيجةِ مخزنُه ملفٌّ أو ذاكرةٌ لا جدولٌ، وهو
  // دَينٌ مكتوبٌ؛ فإن حُذفَ ذكرُه صارتِ الوثيقةُ تُطمئنُ أكثرَ ممّا تَملِك.
  assert.match(
    section,
    /`M6\.08`/u,
    'شرطُ التقييمِ قبلَ التنشيطِ سقطَ من قسمِ الحدودِ المعلنةِ بلا بديلٍ',
  );
});

// ── R6-A-13/R6-B-05: حارسُ M6.07 (مُنتِجُ `budget-exceeded`) يقيسُ الصدقَ لا لفظاً واحداً ──
//
// العيبُ الذي يُعالَجُ هنا: الحارسُ السابقُ كان يصطادُ لفظَ «غير منفَّذ» على سطرِ
// `M6.07` وحدَه، ويشترطُ ذِكرَ الرمزِ `budget-exceeded` في القسمِ. فكلُّ عبارةٍ أخرى
// تُعيدُ إقرارَ الغيابِ — «`budget-exceeded` بلا مُنتِجٍ»، «لا مُنتِجَ لها»، «غيرُ
// موجودةٍ»، «لم تُنفَّذْ»، «غائبةٌ»، «مفقودةٌ» — كانت تمرُّ والاختبارُ يخرجُ `0`،
// لأنّ الرمزَ باقٍ في النصِّ والنفيُ جاءَ بلفظٍ لم يُحصَ.
//
// والعلاجُ ليسَ إضافةَ لفظٍ ثالثٍ إلى القائمةِ، بل أمرانِ معاً:
//   ١. **قياسُ السلوكِ أولاً:** بوابةُ الاستدلالِ تُبنى بتبعياتٍ دنيا وسقفِ رموزٍ ضيّقٍ،
//      ويُطلَبُ منها ما يتجاوزُه؛ فإن لم يصلِ الحجرَ بلاغٌ نوعُه `budget-exceeded`
//      سقطَ القياسُ — فالمُنتِجُ يُقاسُ قائماً لا يُفترَضُ.
//   ٢. **مفرداتُ نفيٍ مُطبَّعةٌ:** يُجرَّدُ النصُّ من التشكيلِ والتطويلِ وعلاماتِ الاتّجاهِ
//      وتُوحَّدُ الألفاتُ والتاءُ المربوطةُ، ثمّ يُرفَضُ كلُّ أداةِ نفيٍ (بلا/لا/غير/لم/
//      لن/ليس/دون/عدم…) يليها في ثلاثِ كلماتٍ جذعُ إنتاجٍ أو وجودٍ أو تنفيذٍ، وكلُّ
//      لفظِ غيابٍ مستقلٍّ (غائب/مفقود/معدوم/منتفٍ…) — في بندِ `M6.07` كلِّه، وفي كلِّ
//      جملةٍ من الوثيقةِ تذكرُ `budget-exceeded` أينما وقعتْ.
//
// والحدُّ المعلَنُ: المفرداتُ حصرٌ لا فهمٌ للّغةِ؛ نفيٌ بتركيبٍ بعيدٍ (جملةٌ تفصلُ
// الأداةَ عن الجذعِ بأكثرَ من ثلاثِ كلماتٍ، أو مجازٌ) قد ينجو. والطفراتُ أدناه تُثبتُ
// ما يُقتَلُ اليومَ لا ما لا يمكنُ أن ينجوَ.

const PRODUCER_FILE = path.join(ROOT, 'src/inference/inference-gate.mjs');

/**
 * يقيسُ هل بوابةُ الاستدلالِ تُنتِجُ إشارةَ `budget-exceeded` إلى الحجرِ فعلاً.
 * @returns {Promise<boolean>} صحيحٌ إن رُفضَ الطلبُ بـ`BUDGET_EXCEEDED` ووصلَ الحجرَ بلاغُه
 */
async function budgetExceededProduced() {
  /** @type {Array<{ kind: string, subject: string }>} */
  const signals = [];
  const gate = createInferenceGate({
    modelRegistry: { getActive: async (purpose) => ({ id: 'model:containment-measure', purpose }) },
    // التفويضُ لا يُبلَغُ: الميزانيّةُ تُقاسُ قبلَه، فبلوغُه هنا خللٌ يُسقِطُ القياسَ.
    enforcementPoint: /** @type {never} */ ({
      authorize() {
        throw new Error('بلغَ الطلبُ التفويضَ قبلَ قياسِ الميزانيّةِ');
      },
    }),
    log: { append() {} },
    execute: async () => ({ output: '' }),
    quarantine: {
      report(signal) {
        signals.push(signal);
      },
    },
    tokensPerWindow: 1,
    budgetWindowMs: 60_000,
    budgetStore: { load: () => [], save() {} },
    costLedger: { record() {} },
    costInstitution: 'institution:containment-measure',
  });
  try {
    await gate.infer({
      actor: { id: 'agent:containment-measure', role: 'role:minister', state: 'active' },
      purpose: 'measure',
      input: 'طلبٌ يتجاوزُ السقفَ',
      estimatedInputTokens: 2,
    });
    return false;
  } catch (error) {
    if (/** @type {{ code?: string }} */ (error).code !== INFERENCE_ERRORS.BUDGET_EXCEEDED) {
      return false;
    }
  }
  return signals.some(
    (signal) => signal.kind === 'budget-exceeded' && signal.subject === 'agent:containment-measure',
  );
}

// التشكيلُ وعلاماتُ القرآنِ والتطويلُ وعلاماتُ الاتّجاهِ والوصلِ الصفريِّ.
const ARABIC_MARKS =
  /[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED\u0640\u200B-\u200F\u2066-\u2069]/gu;

/**
 * يُطبِّعُ النصَّ العربيَّ ليُقاسَ اللفظُ لا رسمُه.
 * @param {string} text
 * @returns {string}
 */
function normalizeArabic(text) {
  return text
    .normalize('NFC')
    .replace(ARABIC_MARKS, '')
    .replace(/[أإآٱ]/gu, 'ا')
    .replace(/ى/gu, 'ي')
    .replace(/ة/gu, 'ه')
    .toLocaleLowerCase('en-US');
}

// أداةُ نفيٍ كلمةً تامّةً، وقد تسبقُها واوٌ أو فاءٌ.
const NEGATOR = /^[وف]?(?:ب?لا|بغير|غير|لم|لن|ليس|ليست|بدون|دون|عدم|عديم|عديمه)$/u;
// سوابقُ تُقشَرُ قبلَ الجذعِ: حرفُ عطفٍ، حرفُ جرٍّ، أداةُ تعريفٍ.
const CLITICS = '(?:[وف])?(?:[بلك])?(?:ال)?';
// جذوعُ الإنتاجِ والإصدارِ والتنفيذِ والوجودِ: نفيُها إقرارُ غيابِ المُنتِجِ.
const PRODUCER_STEM = new RegExp(
  `^${CLITICS}(?:منتج|انتاج|ينتج|تنتج|منفذ|تنفيذ|ينفذ|تنفذ|مصدر|يصدر|تصدر|اصدار|يطلق|تطلق|اطلاق|باعث|يبعث|تبعث|مولد|يولد|تولد|توليد|موجود|يوجد|توجد|وجود)`,
  'u',
);
// ألفاظُ غيابٍ مستقلّةٌ لا تحتاجُ أداةَ نفيٍ.
const ABSENCE_WORD = new RegExp(
  `^${CLITICS}(?:غائب|غياب|يغيب|تغيب|مفقود|فقدان|يفتقد|تفتقد|يفتقر|تفتقر|مفتقر|معدوم|منعدم|انعدام|منتف|ينتفي|تنتفي)`,
  'u',
);
const ENGLISH_ABSENCE =
  /\b(?:absent|missing|unimplemented|not\s+(?:yet\s+)?(?:implemented|produced|emitted)|no\s+producer|without\s+(?:a\s+)?producer)\b/u;
const NEGATION_WINDOW = 3;

/**
 * يجدُ في جملةٍ واحدةٍ إقرارَ غيابٍ: نفياً يليه جذعُ إنتاجٍ، أو لفظَ غيابٍ مستقلّاً.
 * @param {string} sentence
 * @returns {string | null} العبارةُ المُطبَّعةُ التي أقرّتِ الغيابَ، أو لا شيءَ
 */
function absenceMarker(sentence) {
  const normalized = normalizeArabic(sentence);
  const english = ENGLISH_ABSENCE.exec(normalized);
  if (english) return english[0];
  const tokens = normalized.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  for (let i = 0; i < tokens.length; i += 1) {
    const token = /** @type {string} */ (tokens[i]);
    if (ABSENCE_WORD.test(token)) return token;
    if (!NEGATOR.test(token)) continue;
    const window = tokens.slice(i + 1, i + 1 + NEGATION_WINDOW);
    const hit = window.findIndex((next) => PRODUCER_STEM.test(next));
    if (hit !== -1) return tokens.slice(i, i + 2 + hit).join(' ');
  }
  return null;
}

/**
 * يقسمُ نصّاً إلى جملٍ: الفقرةُ تُجمَعُ أسطرُها، والجملةُ تنتهي بعلامةِ وقفٍ يليها فراغٌ.
 * @param {string} text
 * @returns {string[]}
 */
function sentencesOf(text) {
  return text
    .split(/\n\s*\n/u)
    .flatMap((paragraph) => paragraph.replace(/\s*\n\s*/gu, ' ').split(/(?<=[.!?؟؛])\s+/u))
    .filter((sentence) => sentence.trim() !== '');
}

/**
 * قسمُ «حدودٍ معلنةٍ» من نصٍّ مُعطىً (للقياسِ على النسخةِ في الذاكرةِ).
 * @param {string} text
 * @returns {string}
 */
function limitsSectionOf(text) {
  const start = text.indexOf('## 6.');
  if (start === -1) return '';
  const after = text.indexOf('\n## ', start + 1);
  return after === -1 ? text.slice(start) : text.slice(start, after);
}

/**
 * بندُ `M6.07` في قسمِ الحدودِ: من سطرِه المرقَّمِ إلى البندِ المرقَّمِ التالي.
 * @param {string} text
 * @returns {string} نصُّ البندِ، أو فراغٌ إن غابَ
 */
function m607ItemOf(text) {
  const section = limitsSectionOf(text);
  const start = section.search(/^\d+\.\s[^\n]*`M6\.07`/mu);
  if (start === -1) return '';
  const rest = section.slice(start);
  const next = rest.slice(1).search(/^\d+\.\s/mu);
  return next === -1 ? rest : rest.slice(0, next + 1);
}

/**
 * كلُّ إقرارٍ بغيابِ مُنتِجِ `budget-exceeded` في الوثيقةِ.
 * @param {string} text نصُّ الوثيقةِ
 * @returns {string[]} وصفُ كلِّ مخالفةٍ؛ الفراغُ = الوثيقةُ لا تنفي المُنتِجَ
 */
function producerAbsenceClaims(text) {
  /** @type {string[]} */
  const findings = [];
  const item = m607ItemOf(text);
  if (item === '') findings.push('بندُ `M6.07` غائبٌ عن قسمِ الحدودِ المعلنةِ');
  else if (!item.includes('budget-exceeded'))
    findings.push('بندُ `M6.07` لا يذكرُ `budget-exceeded`');
  else if (!item.includes('src/inference/inference-gate.mjs')) {
    findings.push('بندُ `M6.07` لا يُسنِدُ المُنتِجَ إلى `src/inference/inference-gate.mjs`');
  }
  for (const sentence of sentencesOf(item)) {
    const marker = absenceMarker(sentence);
    if (marker !== null) findings.push(`بندُ M6.07 يُقرُّ غياباً «${marker}»: ${sentence.trim()}`);
  }
  // وخارجَ البندِ: كلُّ جملةٍ في الوثيقةِ تذكرُ الإشارةَ لا تنفي مُنتِجَها.
  for (const sentence of sentencesOf(text)) {
    if (!sentence.includes('budget-exceeded') || item.includes(sentence.trim())) continue;
    const marker = absenceMarker(sentence);
    if (marker !== null)
      findings.push(`جملةٌ تُقرُّ غيابَ المُنتِجِ «${marker}»: ${sentence.trim()}`);
  }
  return findings;
}

test('R6-A-13/R6-B-05: مُنتِجُ budget-exceeded قائمٌ في الشفرةِ بالسلوكِ لا بالنصِّ', async () => {
  assert.ok(fs.existsSync(PRODUCER_FILE), 'الملفُّ الذي تُسنِدُ إليه الوثيقةُ المُنتِجَ غائبٌ');
  assert.equal(
    await budgetExceededProduced(),
    true,
    'تجاوزُ الميزانيّةِ لم يُبلِغِ الحجرَ إشارةَ `budget-exceeded` — الوثيقةُ تصفُ مُنتِجاً غيرَ مَقيسٍ',
  );
});

test('R6-A-13/R6-B-05: وثيقةُ الاحتواءِ لا تُقرُّ بغيابِ مُنتِجِ budget-exceeded وهو قائمٌ', async () => {
  assert.equal(await budgetExceededProduced(), true, 'المُنتِجُ لم يُقَسْ قائماً');
  assert.deepEqual(
    producerAbsenceClaims(fs.readFileSync(CONTAINMENT, 'utf8')),
    [],
    'الوثيقةُ تُقرُّ غيابَ مُنتِجٍ قائمٍ في الشفرةِ',
  );
});

test('R6-A-13/R6-B-05: قسمُ الحدودِ المعلنةِ يذكرُ مُنتِجَ budget-exceeded لا ينفيه', () => {
  const section = declaredLimitsSection();
  // فإن حُذفَ ذكرُ الإشارةِ صارتِ الوثيقةُ تُطمئنُ أكثرَ ممّا تَملِك.
  assert.match(
    section,
    /budget-exceeded/u,
    'مُنتِجُ budget-exceeded سقطَ من قسمِ الحدودِ المعلنةِ',
  );
});

// ── الطفراتُ: نسخةٌ في الذاكرةِ من الوثيقةِ، ولا يُمَسُّ الملفُّ ──
// `M3` و`M4` من تقريرَي المجلسِ، وما بعدَهما مرادفاتٌ وتراكيبُ إضافيّةٌ للغيابِ نفسِه.
const ORIGINAL = fs.readFileSync(CONTAINMENT, 'utf8');
const PRODUCED = 'تُنتَجُ فعلاً في';
const MUTANTS = /** @type {ReadonlyArray<readonly [string, string, string]>} */ ([
  ['M3', 'منفَّذةٌ جزئيّاً.**', 'منفَّذةٌ جزئيّاً، و`budget-exceeded` بلا مُنتِجٍ.**'],
  ['M4-لا-منتج', PRODUCED, 'لا مُنتِجَ لها في'],
  ['M4-غير-موجود', PRODUCED, 'غيرُ موجودةٍ في'],
  ['M4-لم-ينفذ', PRODUCED, 'لم تُنفَّذْ بعدُ في'],
  ['M4-غائب', PRODUCED, 'غائبةٌ عن'],
  ['M4-مفقود', PRODUCED, 'مفقودةٌ من'],
  ['M4-بلا-منتج', PRODUCED, 'بلا منتج في'],
  ['X-ليس-لها-منتج', PRODUCED, 'ليس لها مُنتِجٌ في'],
  ['X-لا-تنتج', PRODUCED, 'لا تُنتَجُ في'],
  ['X-معدوم', PRODUCED, 'معدومةُ المصدرِ في'],
  ['X-دون-مصدر', PRODUCED, 'تبقى دونَ مصدرٍ في'],
  ['X-ولا-منتج', PRODUCED, 'مُعلَنةٌ ولا مُنتِجَ لها في'],
  ['X-إنجليزي', PRODUCED, '(not implemented) في'],
  ['X-خارج-القسم', '\n## 6.', '\nإشارةُ `budget-exceeded` بلا مُنتِجٍ حتى الآن.\n\n## 6.'],
  // والطفرتانِ اللتانِ قتلَهما الحارسُ السابقُ تبقيانِ مقتولتَينِ.
  ['K-غير-منفذ', 'منفَّذةٌ جزئيّاً.**', 'غيرُ منفَّذةٍ.**'],
  ['K-حذف-الرمز', 'وإشارةُ `budget-exceeded` تُنتَجُ', 'وإشارةُ الميزانيّةِ تُنتَجُ'],
  ['X-حذف-الإسناد', 'في `src/inference/inference-gate.mjs` عندَ', 'عندَ'],
]);

for (const [id, from, to] of MUTANTS) {
  test(`R6-A-13/R6-B-05 طفرة ${id}: الحارسُ يرفضُ إعادةَ إقرارِ الغيابِ`, () => {
    assert.ok(ORIGINAL.includes(from), `موضعُ الطفرةِ ${id} غائبٌ عن الوثيقةِ — الطفرةُ لا تُقاسُ`);
    const mutant = ORIGINAL.replace(from, to);
    assert.notEqual(producerAbsenceClaims(mutant).length, 0, `الطفرةُ ${id} نجتْ`);
  });
}

test('R6-A-13/R6-B-05: النفيُ الصادقُ في البندِ (حدودٌ معلنةٌ) لا يُقرأُ نفياً للمُنتِجِ', () => {
  // ضابطٌ مقابلٌ: «بلا تمريرِ مخزنٍ» و«لا حارسَ تصنيفٍ» و«لا تُخفِّضُ» حدودٌ حقيقيّةٌ
  // في البندِ نفسِه؛ فحارسٌ يرفضُها يُكرِهُ الوثيقةَ على كتمِ حدودِها.
  const item = m607ItemOf(ORIGINAL);
  assert.match(item, /بلا تمريرِ مخزنٍ/u);
  assert.match(item, /لا حارسَ تصنيفٍ/u);
  assert.deepEqual(producerAbsenceClaims(ORIGINAL), []);
});
