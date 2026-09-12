#!/usr/bin/env node
/**
 * حاجزُ مُوائمِ الاستدلالِ — يحرسُ سدادَ الدَينِ `D-11` من أن يُنقَضَ بعدَ سدادِه.
 *
 * الدَينُ كان: «لا مُوائمَ نموذجٍ: `execute` ثغرةٌ تُحقَنُ من الخارجِ». وسدادُه
 * يُدخِلُ على الدولةِ **مُنفِّذاً يُنادى**، والمُنفِّذُ الذي يُنادى سطحُ ثقةٍ لا
 * ميزةٌ: ما يعودُ منه يُقيَّدُ في السجلِّ ويُخصَمُ من الميزانيّةِ. فالحاجزُ يحرسُ
 * أن يبقى المُوائمُ **مِحبرةً لا فاعلاً**، بخمسِ قواعدَ كلُّها نصٌّ مقروءٌ:
 *
 *   I1: لا سلطةَ في المُوائمِ: لا سياسةَ ولا مستودعَ ولا قاعدةَ ولا سجلَّ تدقيقٍ
 *       في `src/inference/adapters/`؛ ولا `authorize(` ولا `.append(`. فمُوائمٌ
 *       يُفوِّضُ لنفسِه أو يُقيِّدُ لنفسِه أخرجَ الاستدلالَ من العقباتِ الخمسِ.
 *   I2: المُوائمُ الحتميُّ بلا شبكةٍ **مقيساً لا مُصدَّقاً**: لا `node:http` ولا
 *       `node:https` ولا `node:net` ولا `node:tls` ولا `node:dgram` ولا `fetch(`
 *       ولا `node:fs` في نصِّه بعدَ تجريدِ التعليقاتِ — فإعلانُ `disabled` الذي
 *       لا يُقاسُ إعلانٌ لا يُحتَجُّ به.
 *   I3: لا سرَّ في شفرةِ المُوائمِ ولا في إعلانِه: لا قيمةَ تُشبِهُ مفتاحاً، ولا
 *       قراءةَ مفتاحٍ إلا من البيئةِ باسمٍ مُعلَنٍ (`apiKeyEnv`). وكلُّ إعلانٍ
 *       مُصدَّرٍ **يُفحَصُ فعلاً** بـ`assertAdapterDeclaration` هنا لا يُقرأُ نصّاً.
 *   I4: لا طريقَ إلى البوابةِ إلا عبرَ العقدِ: `executorFor` ينادي
 *       `assertAdapterResult`، وحقولُ السلطةِ الممنوعةُ مُعلَنةٌ فيها `policyId`
 *       و`token`، والمُهلةُ تُجهِضُ بإشارةٍ (`AbortController`). فمُنفِّذٌ يُسلَّمُ
 *       إلى البوابةِ بلا فحصٍ يُعيدُ الثغرةَ التي سُدَّتْ.
 *   I5: الاختبارُ موجودٌ ويقيسُ **الرفضَ** لا المرورَ فقط: ادّعاءَ السلطةِ،
 *       والاستهلاكَ الفاسدَ، والنموذجَ المُخالِفَ، وانقضاءَ المُهلةِ بإشارةٍ يراها
 *       المُنفِّذُ، وخصمَ الاستهلاكِ حتّى الرفضِ بتجاوزِ السقفِ.
 *
 * **حدٌّ مُعلَنٌ:** هذا الحاجزُ لا يُنادي مزوّداً ولا يفتحُ مِقبساً؛ فمرورُ
 * الاستدلالِ بالعقباتِ يُقاسُ في `tests/inference/adapters.test.mjs` على بوابةٍ
 * ونقطةِ تفويضٍ وسجلِّ نماذجٍ حقيقيّةٍ، والحاجزُ يحرسُ **ألّا يُنقَضَ ما قاسَه
 * الاختبارُ** لا أن يُنيبَ عنه.
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import {
  assertAdapterDeclaration,
  FORBIDDEN_RESULT_FIELDS,
} from '../src/inference/adapters/contract.mjs';
import { createDeterministicAdapter } from '../src/inference/adapters/deterministic.mjs';

const argv = process.argv.slice(2);
const rootIndex = argv.indexOf('--root');
const rootArg = rootIndex >= 0 ? argv[rootIndex + 1] : undefined;
const ROOT =
  rootArg !== undefined && rootArg !== ''
    ? path.resolve(rootArg)
    : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** @type {string[]} */
const violations = [];

/** @param {string} relative @returns {string} */
function readFile(relative) {
  const full = path.join(ROOT, relative);
  return fs.existsSync(full) ? fs.readFileSync(full, 'utf8') : '';
}

/**
 * تجريدُ التعليقاتِ: الوثيقةُ تذكرُ ما تمنعُه بالاسمِ، فقياسٌ على النصِّ كاملاً
 * يقيسُ الكلامَ عن المنعِ لا المنعَ.
 * @param {string} source
 * @returns {string}
 */
function codeOf(source) {
  return source.replace(/\/\*[\s\S]*?\*\//gu, '').replace(/(^|[^:])\/\/.*$/gmu, '$1');
}

const ADAPTER_DIR = path.join('src', 'inference', 'adapters');
const adapterFiles = fs.existsSync(path.join(ROOT, ADAPTER_DIR))
  ? fs
      .readdirSync(path.join(ROOT, ADAPTER_DIR))
      .filter((name) => name.endsWith('.mjs'))
      .sort()
  : [];

if (adapterFiles.length === 0) {
  violations.push(
    `I1: لا مُوائمَ في «${ADAPTER_DIR}» — والدَينُ \`D-11\` هو غيابُ المُوائمِ نفسُه.`,
  );
}

// ── I1: لا سلطةَ في المُوائمِ ──
/** @type {Array<[string, string]>} */
const AUTHORITY_MARKERS = [
  ['../policy/', 'سياسةٌ في يدِ المُوائمِ'],
  ['../persistence/', 'مستودعٌ في يدِ المُوائمِ'],
  ['../root-of-trust/', 'سجلُّ جذرِ الثقةِ في يدِ المُوائمِ'],
  ['../api/', 'بوابةُ الواجهةِ في يدِ المُوائمِ'],
  ['authorize(', 'المُوائمُ يُفوِّضُ لنفسِه'],
  ['.append(', 'المُوائمُ يُقيِّدُ لنفسِه في السجلِّ'],
];
for (const file of adapterFiles) {
  const code = codeOf(readFile(path.join(ADAPTER_DIR, file)));
  for (const [needle, why] of AUTHORITY_MARKERS) {
    if (code.includes(needle)) {
      violations.push(
        `I1: ${why} في \`${file}\` (${needle}) — والمُوائمُ مِحبرةٌ لا فاعلٌ: القرارُ والقيدُ من البوابةِ وحدَها.`,
      );
    }
  }
}

// ── I2: المُوائمُ الحتميُّ بلا شبكةٍ ولا نظامِ ملفّاتٍ ──
const deterministicCode = codeOf(readFile(path.join(ADAPTER_DIR, 'deterministic.mjs')));
if (deterministicCode === '') {
  violations.push('I2: `deterministic.mjs` غائبٌ — ومُوائمٌ حتميٌّ هو ما يُقاسُ عليه بلا شبكةٍ.');
} else {
  for (const forbidden of [
    'node:http',
    'node:https',
    'node:net',
    'node:tls',
    'node:dgram',
    'node:fs',
    'fetch(',
  ]) {
    if (deterministicCode.includes(forbidden)) {
      violations.push(
        `I2: المُوائمُ الحتميُّ يستعملُ «${forbidden}» بينما يُعلنُ \`network: 'disabled'\` — وإعلانٌ يُخالِفُ نصَّه إعلانٌ لا يُحتَجُّ به.`,
      );
    }
  }
}

// ── I3: لا سرَّ في الشفرةِ، وكلُّ إعلانٍ يُفحَصُ فعلاً ──
const SECRET_LOOKING = /(['"`])(sk-|pk-|xoxb-|ghp_|AIza|Bearer\s)[A-Za-z0-9._-]{6,}\1/u;
for (const file of adapterFiles) {
  const code = codeOf(readFile(path.join(ADAPTER_DIR, file)));
  if (SECRET_LOOKING.test(code)) {
    violations.push(
      `I3: قيمةٌ تُشبِهُ مفتاحاً في \`${file}\` — والمفاتيحُ من البيئةِ باسمٍ مُعلَنٍ لا من الشفرةِ.`,
    );
  }
}
try {
  const declaration = assertAdapterDeclaration(createDeterministicAdapter().declaration);
  if (declaration.network !== 'disabled' || declaration.apiKeyEnv !== null) {
    violations.push(
      'I3: إعلانُ المُوائمِ الحتميِّ يطلبُ شبكةً أو مفتاحاً؛ ومُوائمٌ داخليٌّ لا يحتاجُ أيّاً منهما.',
    );
  }
} catch (error) {
  violations.push(
    `I3: إعلانُ المُوائمِ الحتميِّ لا يمرُّ بعقدِه: ${error instanceof Error ? error.message : String(error)}`,
  );
}

// ── I4: لا طريقَ إلى البوابةِ إلا عبرَ العقدِ ──
const contractCode = codeOf(readFile(path.join(ADAPTER_DIR, 'contract.mjs')));
/** @type {Array<[string, string]>} */
const CONTRACT_MARKERS = [
  ['assertAdapterResult(raw', 'ناتجُ المُوائمِ يُسلَّمُ بلا فحصٍ فتعودُ الثغرةُ التي سُدَّتْ'],
  ['new AbortController()', 'لا إشارةَ إجهاضٍ فالمُهلةُ تُهمِلُ النداءَ ولا تُلغيه'],
  ['clearTimeout(timer)', 'مُؤقِّتُ المُهلةِ لا يُبطَلُ فيتراكمُ في كلِّ نداءٍ'],
];
for (const [needle, why] of CONTRACT_MARKERS) {
  if (!contractCode.includes(needle)) violations.push(`I4: ${why} (${needle}).`);
}
for (const field of ['policyId', 'token', 'decision', 'allowed']) {
  if (!FORBIDDEN_RESULT_FIELDS.includes(field)) {
    violations.push(
      `I4: حقلُ السلطةِ «${field}» ليس في \`FORBIDDEN_RESULT_FIELDS\` — فمُوائمٌ يدّعيه يمرُّ إلى السجلِّ كأنّه قرارُ نقطةِ التفويضِ.`,
    );
  }
}
if (!codeOf(readFile(path.join(ADAPTER_DIR, 'deterministic.mjs'))).includes('executorFor')) {
  violations.push(
    'I4: المُوائمُ الحتميُّ لا يُغلَّفُ بـ`executorFor` فيَصِلُ إلى البوابةِ بلا عقدٍ.',
  );
}

// ── I5: الاختبارُ يقيسُ الرفضَ لا المرورَ فقط ──
const testCode = readFile(path.join('tests', 'inference', 'adapters.test.mjs'));
if (testCode === '') {
  violations.push('I5: `tests/inference/adapters.test.mjs` غائبٌ — وحاجزٌ بلا قياسٍ نصفُ حاجزٍ.');
} else {
  /** @type {Array<[string, string]>} */
  const MEASURED = [
    ['AUTHORITY_CLAIMED', 'ادّعاءُ المُوائمِ للقرارِ غيرُ مقيسٍ'],
    ['USAGE_INVALID', 'رفضُ الاستهلاكِ الفاسدِ غيرُ مقيسٍ'],
    ['MODEL_MISMATCH', 'رفضُ نموذجٍ غيرِ المُوجَّهِ إليه غيرُ مقيسٍ'],
    ['TIMED_OUT', 'انقضاءُ المُهلةِ غيرُ مقيسٍ'],
    ["addEventListener('abort'", 'وصولُ إشارةِ الإجهاضِ إلى المُنفِّذِ غيرُ مقيسٍ'],
    ['SECRET_INLINE', 'رفضُ سرٍّ في الإعلانِ غيرُ مقيسٍ'],
    ['inference.completed', 'قيدُ الإتمامِ في السجلِّ غيرُ مقيسٍ'],
    ['BUDGET_EXCEEDED', 'خصمُ الاستهلاكِ حتّى تجاوزِ السقفِ غيرُ مقيسٍ'],
    ['createInferenceGate', 'ما قِيسَ ليس مروراً بالبوابةِ بل نداءُ دالّةٍ'],
  ];
  for (const [needle, why] of MEASURED) {
    if (!testCode.includes(needle)) violations.push(`I5: ${why} (${needle}).`);
  }
}

if (violations.length > 0) {
  console.error('⛔ حاجز مُوائم الاستدلال رفض:');
  for (const violation of violations) console.error(`   • ${violation}`);
  process.exit(1);
}

console.log(
  `✅ حاجز مُوائم الاستدلال: ${adapterFiles.length} ملفَّ مُوائمٍ بلا سياسةٍ ولا مستودعٍ ولا سجلٍّ في يدِه ولا تفويضٍ يمنحُه لنفسِه، ومُوائمٌ حتميٌّ لا يستعملُ شبكةً ولا نظامَ ملفّاتٍ فإعلانُ \`disabled\` مقيسٌ لا مُصدَّقٌ، وبلا قيمةٍ تُشبِهُ مفتاحاً في الشفرةِ والمفتاحُ باسمِ متغيّرِ بيئةٍ وحدَه، و${FORBIDDEN_RESULT_FIELDS.length} حقلَ سلطةٍ مرفوضاً في الناتجِ، وكلُّ ناتجٍ يمرُّ بـ\`assertAdapterResult\` بمُهلةٍ تُجهِضُ بإشارةٍ لا تُهمِلُ النداءَ.`,
);
