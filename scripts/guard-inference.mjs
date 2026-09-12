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
 *   I6: مُوائمُ الشبكةِ لا يُسقِطُ تحقُّقَ الشهادةِ ولا يحفظُ مفتاحاً: خياراتُ
 *       التعميةِ من `secureClientOptions` في `src/transport/tls.mjs` وحدَها، ولا
 *       ذكرَ لـ`rejectUnauthorized` في نصِّه فلا سبيلَ إلى إسقاطِه، ولا
 *       `NODE_TLS_REJECT_UNAUTHORIZED`، والمفتاحُ يُقرأُ من البيئةِ **عندَ كلِّ
 *       نداءٍ** بالاسمِ المُعلَنِ، ولجسمِ الردِّ سقفٌ. ويُقاسُ ذلك ببناءِ مُوائمٍ
 *       فعليٍّ هنا: إعلانُه `https-only`، وعنوانٌ بلا تعميةٍ يُرفَضُ.
 *   I7: اختبارُ مُوائمِ الشبكةِ على **مِقبسٍ حقيقيٍّ** لا دالّةٍ مزيّفةٍ، ويقيسُ
 *       الرفضَ: شهادةً غيرَ موثوقةٍ، ومفتاحاً غائباً، وعنواناً بلا تعميةٍ، ومزوّداً
 *       رادّاً، وردّاً يتجاوزُ السقفَ، وتبديلَ النموذجِ، وانقضاءَ المُهلةِ، وحجبَ
 *       المفتاحِ من رسالةِ الخطأِ.
 *   I8: **لا مزوّدَ إلا مُعلَناً في وثيقةٍ.** `config/inference-providers.yaml`
 *       موجودةٌ ومقروءةٌ بمخطَّطِها، وكلُّ مزوّدٍ فيها **يُبنى مُوائماً فعلاً**
 *       هنا لا نصّاً: عنوانُه `https`، ومفتاحُه اسمُ متغيّرِ بيئةٍ لا قيمتُه.
 *       ولا عنوانَ مزوّدٍ مكتوبٌ في شفرةِ `src/` بعدَ تجريدِ التعليقاتِ — فعنوانٌ
 *       في شفرةٍ مزوّدٌ يُضافُ بلا مراجعةٍ، وهو العَيبُ الذي جاءَ الإعلانُ ليُغلقَه.
 *   I9: اختبارُ الإعلانِ يقيسُ الرفضَ: سرّاً في الوثيقةِ، وعنواناً بلا تعميةٍ،
 *       ومعرّفاً مكرَّراً، ومُهلةً فوقَ سقفِ العقدِ، ومزوّداً غيرَ مُعلَنٍ، ومروراً
 *       بالبوابةِ على مِقبسٍ حقيقيٍّ من وثيقةٍ لا من خيارٍ مكتوبٍ في الاختبارِ.
 *   I10: **لا سقفَ في الشفرةِ.** سقفُ رموزِ الاستدلالِ ونافذتُه من
 *       `config/quotas.yaml` وحدَها: يُقاسُ هنا أنّ `loadInferenceTokenQuota`
 *       تُعيدُ ما في الوثيقةِ حرفاً بحرفٍ، وأنّ غيابَ الحصّةِ **رفضٌ مُسمّىً
 *       يُقاسُ بتشغيلِه** لا سقوطٌ إلى رقمٍ مكتوبٍ، وأنّ بندَ الكلفةِ مربوطٌ
 *       بموردِ الحصّةِ نفسِه، وأنّ ملفَّ البوابةِ خالٍ من رقمِ سقفٍ افتراضيٍّ،
 *       وأنّ نافذةَ الميزانيةِ ليست نافذةَ حدِّ المعدَّلِ في `#budgetFor`.
 *   I11: **استهلاكٌ يقعُ يُقيَّدُ.** البوابةُ تُنادي دفترَ التكلفةِ ببندِ
 *       الاستدلالِ، وفشلُ القيدِ يمنعُ إعادةَ المُخرَجِ برمزٍ مُسمّىً
 *       (`USAGE_UNRECORDED`)؛ وذلك مقيسٌ في `tests/inference/quota-binding.test.mjs`
 *       بدفترٍ حقيقيٍّ لا بدالّةٍ مزيّفةٍ.
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

import YAML from 'yaml';

import {
  assertAdapterDeclaration,
  FORBIDDEN_RESULT_FIELDS,
} from '../src/inference/adapters/contract.mjs';
import {
  INFERENCE_QUOTA_ERRORS,
  INFERENCE_TOKENS_RESOURCE,
  inferenceCostItem,
  InferenceQuotaError,
  loadInferenceTokenQuota,
} from '../src/inference/quota.mjs';
import { createDeterministicAdapter } from '../src/inference/adapters/deterministic.mjs';
import { createHttpsAdapter } from '../src/inference/adapters/https.mjs';
import {
  createDeclaredHttpsAdapter,
  INFERENCE_PROVIDERS_FILE,
  loadInferenceProviders,
} from '../src/inference/providers.mjs';

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

// ── I6: مُوائمُ الشبكةِ بلا سبيلٍ إلى إسقاطِ التحقُّقِ ولا مفتاحٍ محفوظٍ ──
const HTTPS_FILE = path.join(ADAPTER_DIR, 'https.mjs');
const httpsCode = codeOf(readFile(HTTPS_FILE));
if (httpsCode === '') {
  violations.push(
    'I6: `https.mjs` غائبٌ — و«لا مُوائمَ مزوّدٍ حقيقيٍّ» هو الشوطُ الثاني من `D-11` بنصِّه.',
  );
} else {
  for (const [needle, why] of /** @type {Array<[string, string]>} */ ([
    [
      'secureClientOptions',
      'خياراتُ التعميةِ لا تُؤخَذُ من موضعِ التعميةِ الواحدِ، فيصيرُ للتحقُّقِ من الشهادةِ مقياسانِ',
    ],
    ['env[apiKeyEnv]', 'المفتاحُ لا يُقرأُ من البيئةِ بالاسمِ المُعلَنِ عندَ النداءِ'],
    ['HTTPS_ADAPTER_MAX_RESPONSE_BYTES', 'لا سقفَ لجسمِ الردِّ، وردٌّ بلا سقفٍ استنزافُ ذاكرةٍ'],
    ['redact(', 'لا حجبَ للمفتاحِ في نصٍّ يُخرَجُ، ومزوّدٌ يُرَدِّدُ المفتاحَ يُذيعُه في سجلٍّ'],
  ])) {
    if (!httpsCode.includes(needle)) violations.push(`I6: ${why} (${needle}).`);
  }
  for (const [needle, why] of /** @type {Array<[string, string]>} */ ([
    ['rejectUnauthorized', 'ذكرُ `rejectUnauthorized` في المُوائمِ سبيلٌ إلى إسقاطِ التحقُّقِ فيه'],
    ['NODE_TLS_REJECT_UNAUTHORIZED', 'إسقاطُ التحقُّقِ من البيئةِ في يدِ المُوائمِ'],
    ["'http://", 'عنوانٌ بلا تعميةٍ مكتوبٌ في المُوائمِ'],
  ])) {
    if (httpsCode.includes(needle)) violations.push(`I6: ${why} (${needle}).`);
  }
  try {
    const built = createHttpsAdapter({
      id: 'adapter:guard-probe',
      provider: 'حاجزٌ',
      endpoint: 'https://provider.invalid/v1/infer',
      apiKeyEnv: 'GUARD_PROBE_API_KEY',
      outputPath: ['output'],
    });
    if (built.declaration.network !== 'https-only' || built.declaration.transport !== 'https') {
      violations.push('I6: إعلانُ مُوائمِ الشبكةِ لا يُعلنُ `https`/`https-only`.');
    }
    let refusedInsecure = false;
    try {
      createHttpsAdapter({
        id: 'adapter:guard-probe',
        provider: 'حاجزٌ',
        endpoint: 'http://provider.invalid/v1/infer',
        apiKeyEnv: 'GUARD_PROBE_API_KEY',
        outputPath: ['output'],
      });
    } catch {
      refusedInsecure = true;
    }
    if (!refusedInsecure) {
      violations.push(
        'I6: عنوانٌ بلا تعميةٍ قُبِلَ في مُوائمِ الشبكةِ — ومفتاحٌ يُرسَلُ بلا تعميةٍ مفتاحٌ مقروءٌ على الطريقِ.',
      );
    }
  } catch (error) {
    violations.push(
      `I6: مُوائمُ الشبكةِ لا يُبنى بإعلانٍ صحيحٍ: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!httpsCode.includes('executorFor')) {
    violations.push(
      'I6: مُوائمُ الشبكةِ لا يُغلَّفُ بـ`executorFor` فيَصِلُ إلى البوابةِ بلا عقدٍ.',
    );
  }
}

// ── I7: اختبارُ مُوائمِ الشبكةِ على مِقبسٍ حقيقيٍّ ──
const httpsTest = readFile(path.join('tests', 'inference', 'https-adapter.test.mjs'));
if (httpsTest === '') {
  violations.push(
    'I7: `tests/inference/https-adapter.test.mjs` غائبٌ — ومُوائمُ شبكةٍ بلا مِقبسٍ مقيسٍ ادّعاءٌ لا سدادٌ.',
  );
} else {
  /** @type {Array<[string, string]>} */
  const NETWORK_MEASURED = [
    ["from 'node:https'", 'ما قِيسَ ليس مِقبساً حقيقيّاً بل دالّةٌ مزيّفةٌ'],
    ['TRANSPORT_FAILED', 'ردُّ شهادةٍ من جهةٍ غيرِ موثوقةٍ غيرُ مقيسٍ'],
    ['KEY_ABSENT', 'رفضُ نداءٍ بلا مفتاحٍ في البيئةِ غيرُ مقيسٍ'],
    ['ENDPOINT_INSECURE', 'رفضُ عنوانٍ بلا تعميةٍ غيرُ مقيسٍ'],
    ['PROVIDER_REFUSED', 'ردُّ المزوّدِ بحالةِ خطأٍ غيرُ مقيسٍ'],
    ['RESPONSE_TOO_LARGE', 'قطعُ ردٍّ يتجاوزُ السقفَ غيرُ مقيسٍ'],
    ['RESPONSE_UNREADABLE', 'رفضُ ردٍّ لا يُطابِقُ المسارَ المُعلَنَ غيرُ مقيسٍ'],
    ['MODEL_MISMATCH', 'كشفُ تبديلِ المزوّدِ للنموذجِ غيرُ مقيسٍ'],
    ['TIMED_OUT', 'انقضاءُ المُهلةِ على مِقبسٍ حقيقيٍّ غيرُ مقيسٍ'],
    ['REDACTION_MARK', 'حجبُ المفتاحِ من رسالةِ الخطأِ غيرُ مقيسٍ'],
    ['gateWithAdapter', 'ما قِيسَ ليس مروراً بالبوابةِ إلى الشبكةِ بل نداءُ مُوائمٍ وحدَه'],
  ];
  for (const [needle, why] of NETWORK_MEASURED) {
    if (!httpsTest.includes(needle)) violations.push(`I7: ${why} (${needle}).`);
  }
}

// ── I8: لا مزوّدَ إلا مُعلَناً في وثيقةٍ ──
// والقياسُ بناءٌ لا قراءةُ نصٍ؛ فوثيقةٌ تُقرأُ ولا يُبنى منها مُوائمٌ وثيقةٌ
// يُقالُ إنّها نافذةٌ ولا يُعرَفُ أنّها كذلك.
const providersFile = path.join(ROOT, 'config', INFERENCE_PROVIDERS_FILE);
if (!fs.existsSync(providersFile)) {
  violations.push(
    `I8: وثيقةُ المزوّدينَ \`config/${INFERENCE_PROVIDERS_FILE}\` غائبةٌ — ومزوّدٌ يُنادى بلا وثيقةٍ تُعلنُ عنوانَه مزوّدٌ يُضافُ بلا مراجعةٍ.`,
  );
} else {
  try {
    const document = loadInferenceProviders({ dir: path.join(ROOT, 'config') });
    if (document.providers.length === 0) {
      violations.push('I8: وثيقةُ المزوّدينَ بلا مزوّدٍ واحدٍ مُعلَنٍ.');
    }
    for (const entry of document.providers) {
      const adapter = createDeclaredHttpsAdapter({
        id: entry.id,
        document,
        env: { [entry.apiKeyEnv]: 'قيمةٌ لا تُنادَى بها شبكةٌ في حاجزٍ' },
      });
      if (adapter.endpoint.protocol !== 'https:') {
        violations.push(`I8: عنوانُ المزوّدِ «${entry.id}» ليس بتعميةٍ.`);
      }
      if (adapter.declaration.apiKeyEnv !== entry.apiKeyEnv) {
        violations.push(
          `I8: مفتاحُ المزوّدِ «${entry.id}» لا يُقرأُ بالاسمِ المُعلَنِ في الوثيقةِ.`,
        );
      }
    }
  } catch (error) {
    violations.push(
      `I8: وثيقةُ المزوّدينَ لا تُحمَّلُ ولا يُبنى منها مُوائمٌ: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

// ولا عنوانَ مزوّدٍ مكتوبٌ في شفرةِ الإنتاجِ: العنوانُ من الوثيقةِ وحدَها.
const ENDPOINT_LITERAL = /(['"`])https:\/\//u;
/** @param {string} dir @returns {string[]} */
function sourceFilesUnder(dir) {
  const full = path.join(ROOT, dir);
  if (!fs.existsSync(full)) return [];
  /** @type {string[]} */
  const found = [];
  for (const entry of fs.readdirSync(full, { withFileTypes: true })) {
    const relative = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...sourceFilesUnder(relative));
    else if (entry.name.endsWith('.mjs')) found.push(relative);
  }
  return found;
}
for (const file of sourceFilesUnder('src')) {
  if (ENDPOINT_LITERAL.test(codeOf(readFile(file)))) {
    violations.push(
      `I8: عنوانٌ مكتوبٌ في \`${file}\` — وعنوانُ مزوّدٍ في شفرةٍ مزوّدٌ يُضافُ بلا مراجعةٍ؛ والعنوانُ من \`config/${INFERENCE_PROVIDERS_FILE}\` وحدَها.`,
    );
  }
}

// ── I9: اختبارُ الإعلانِ يقيسُ الرفضَ ──
const providersTest = readFile(path.join('tests', 'inference', 'providers.test.mjs'));
if (providersTest === '') {
  violations.push(
    'I9: `tests/inference/providers.test.mjs` غائبٌ — وإعلانٌ بلا قياسِ رفضِه إعلانٌ يُقرأُ ولا يُحكَمُ به.',
  );
} else {
  /** @type {Array<[string, string]>} */
  const DECLARATION_MEASURED = [
    ['loadInferenceProviders()', 'الوثيقةُ النافذةُ في `config/` غيرُ مقروءةٍ في الاختبارِ'],
    ['SECRET_INLINE', 'رفضُ سرٍّ مكتوبٍ في الوثيقةِ غيرُ مقيسٍ'],
    ['DECLARATION_INVALID', 'رفضُ وثيقةٍ مخالفةٍ غيرُ مقيسٍ'],
    ["'http://", 'رفضُ عنوانٍ بلا تعميةٍ في الوثيقةِ غيرُ مقيسٍ'],
    ['MAX_ADAPTER_TIMEOUT_MS', 'رفضُ مُهلةٍ فوقَ سقفِ العقدِ غيرُ مقيسٍ'],
    ['adapter:not-declared', 'رفضُ مزوّدٍ غيرَ مُعلَنٍ غيرُ مقيسٍ'],
    ['describeInferenceProviders', 'خلوُ وصفِ المزوّدينَ من قيمةِ المفتاحِ غيرُ مقيسٍ'],
    ["from 'node:https'", 'ما قِيسَ من إعلانٍ ليس نداءً على مِقبسٍ حقيقيٍّ'],
    ['gateWithAdapter', 'ما قِيسَ ليس مروراً بالبوابةِ من مزوّدٍ مُعلَنٍ'],
  ];
  for (const [needle, why] of DECLARATION_MEASURED) {
    if (!providersTest.includes(needle)) violations.push(`I9: ${why} (${needle}).`);
  }
}

// ── I5: الاختبارُ يقيسُ الرفضَ لا المرورَ فقط ──
// ومِسنَدُ البوابةِ موضعٌ واحدٌ يُنادِيه الاختباران، فيُقاسُ فيه بناءُ البوابةِ
// ونقطةِ التفويضِ، ويُقاسُ في كلِّ اختبارٍ أنّه يُنادِيه فعلاً.
const harnessCode = readFile(path.join('tests', 'helpers', 'inference-gate.mjs'));
for (const [needle, why] of /** @type {Array<[string, string]>} */ ([
  ['createInferenceGate', 'مِسنَدُ الاختبارِ لا يبني بوابةً حقيقيّةً'],
  ['EnforcementPoint', 'مِسنَدُ الاختبارِ لا يبني نقطةَ تفويضٍ حقيقيّةً'],
  ['ModelState.APPROVED', 'مِسنَدُ الاختبارِ لا يُنفِّذُ نموذجاً بمسارِ حالاتِه'],
])) {
  if (!harnessCode.includes(needle)) violations.push(`I5: ${why} (${needle}).`);
}
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
    ['gateWithAdapter', 'ما قِيسَ ليس مروراً بالبوابةِ بل نداءُ دالّةٍ'],
  ];
  for (const [needle, why] of MEASURED) {
    if (!testCode.includes(needle)) violations.push(`I5: ${why} (${needle}).`);
  }
}

// ── I10: لا سقفَ في الشفرةِ — السقفُ والنافذةُ من وثيقةِ الحصصِ وحدَها ──
// القياسُ **بالتشغيلِ** لا بقراءةِ نصٍّ: تُقرأُ الوثيقةُ خاماً وتُقابَلُ بما
// تُعيدُه الدالّةُ، ويُشغَّلُ غيابُ الحصّةِ ليُرى أنّه رفضٌ مُسمّىً.
{
  const quotasRaw = readFile(path.join('config', 'quotas.yaml'));
  /** @type {Record<string, unknown> | undefined} */
  let declaredQuota;
  if (quotasRaw === '') {
    violations.push('I10: `config/quotas.yaml` غائبةٌ — وسقفٌ بلا وثيقةٍ سقفٌ يُكتَبُ في الشفرةِ.');
  } else {
    const parsed = YAML.parse(quotasRaw);
    const quotas = Array.isArray(parsed?.quotas) ? parsed.quotas : [];
    declaredQuota = quotas.find(
      (/** @type {Record<string, unknown>} */ entry) =>
        entry?.['resource'] === INFERENCE_TOKENS_RESOURCE,
    );
    if (declaredQuota === undefined) {
      violations.push(
        `I10: لا حصّةَ مُعلَنةً للموردِ \`${INFERENCE_TOKENS_RESOURCE}\` في وثيقةِ الحصصِ — والبوابةُ بلا حصّةٍ بوابةٌ بسقفٍ مكتوبٍ في يدِها.`,
      );
    }
  }
  try {
    const quota = loadInferenceTokenQuota();
    if (declaredQuota !== undefined) {
      if (quota.tokensPerWindow !== declaredQuota['limit']) {
        violations.push(
          `I10: السقفُ النافذُ ${quota.tokensPerWindow} لا يساوي المُعلَنَ ${String(declaredQuota['limit'])} — وسقفانِ لموردٍ واحدٍ أحدُهما لا يُقرأُ.`,
        );
      }
      if (quota.budgetWindowMs !== Number(declaredQuota['windowSeconds']) * 1000) {
        violations.push(
          `I10: نافذةُ الميزانيةِ ${quota.budgetWindowMs} مللي لا تساوي المُعلَنَةَ ${String(declaredQuota['windowSeconds'])} ثانيةً.`,
        );
      }
    }
    const costItem = inferenceCostItem();
    if (costItem.resource !== INFERENCE_TOKENS_RESOURCE) {
      violations.push('I10: بندُ كلفةِ الاستدلالِ مربوطٌ بموردٍ غيرِ موردِ الحصّةِ.');
    }
  } catch (error) {
    violations.push(
      `I10: حصّةُ الاستدلالِ أو بندُ كلفتِها لا يُقرآنِ من الوثيقةِ: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  /** @type {unknown} */
  let refusal = null;
  try {
    loadInferenceTokenQuota({ bundle: { quotas: [] } });
  } catch (error) {
    refusal = error;
  }
  if (
    !(refusal instanceof InferenceQuotaError) ||
    refusal.code !== INFERENCE_QUOTA_ERRORS.QUOTA_UNDECLARED
  ) {
    violations.push(
      'I10: غيابُ الحصّةِ لا يُرفَضُ برمزٍ مُسمّىً — وسقوطٌ صامتٌ إلى رقمٍ مكتوبٍ يجعلُ حذفَ الحصّةِ من الوثيقةِ بلا أثرٍ.',
    );
  }
  const gateCode = codeOf(readFile(path.join('src', 'inference', 'inference-gate.mjs')));
  if (/DEFAULT_TOKENS_PER_WINDOW/.test(gateCode)) {
    violations.push(
      'I10: `DEFAULT_TOKENS_PER_WINDOW` عادَ إلى شفرةِ البوابةِ — وسقفٌ افتراضيٌّ في الشفرةِ يُغني عن الوثيقةِ.',
    );
  }
  const budgetBody = gateCode.slice(gateCode.indexOf('#budgetFor('));
  if (budgetBody === '' || !budgetBody.slice(0, 400).includes('this.budgetWindowMs')) {
    violations.push(
      'I10: نافذةُ الميزانيةِ في `#budgetFor` ليست `budgetWindowMs` — وخلطُها بنافذةِ حدِّ المعدَّلِ يُنفِذُ سقفَ ساعةٍ في دقيقةٍ.',
    );
  }
}

// ── I11: استهلاكٌ يقعُ يُقيَّدُ، وقيدٌ يفشلُ يمنعُ المُخرَجَ ──
{
  const gateCode = codeOf(readFile(path.join('src', 'inference', 'inference-gate.mjs')));
  for (const [needle, why] of /** @type {Array<[string, string]>} */ ([
    ['costLedger.record(', 'البوابةُ لا تُقيِّدُ استهلاكَها في دفترِ التكلفةِ'],
    ['USAGE_UNRECORDED', 'فشلُ القيدِ بلا رمزِ رفضٍ مُسمّىً'],
    ['inferenceCostItem', 'بندُ الكلفةِ مكتوبٌ في الشفرةِ لا مقروءٌ من الوثيقةِ'],
  ])) {
    if (!gateCode.includes(needle)) violations.push(`I11: ${why} (${needle}).`);
  }
  const quotaTest = readFile(path.join('tests', 'inference', 'quota-binding.test.mjs'));
  if (quotaTest === '') {
    violations.push(
      'I11: `tests/inference/quota-binding.test.mjs` غائبٌ — وقيدُ استهلاكٍ بلا قياسِ فشلِه قيدٌ يُدَّعى.',
    );
  } else {
    for (const [needle, why] of /** @type {Array<[string, string]>} */ ([
      ['CostCapacity', 'ما قِيسَ ليس دفتراً حقيقيّاً بل دالّةٌ مزيّفةٌ'],
      ['cost.usage.recorded', 'قيدُ الاستهلاكِ في السجلِّ غيرُ مقيسٍ'],
      ['USAGE_UNRECORDED', 'منعُ المُخرَجِ عندَ فشلِ القيدِ غيرُ مقيسٍ'],
      ['budgetWindowMs', 'استقلالُ نافذةِ الميزانيةِ عن نافذةِ المعدَّلِ غيرُ مقيسٍ'],
      ['QUOTA_UNDECLARED', 'رفضُ غيابِ الحصّةِ غيرُ مقيسٍ'],
      ['COST_ITEM_MISMATCH', 'مقابلةُ بندِ الكلفةِ بموردِ الحصّةِ غيرُ مقيسةٍ'],
    ])) {
      if (!quotaTest.includes(needle)) violations.push(`I11: ${why} (${needle}).`);
    }
  }
}

if (violations.length > 0) {
  console.error('⛔ حاجز مُوائم الاستدلال رفض:');
  for (const violation of violations) console.error(`   • ${violation}`);
  process.exit(1);
}

console.log(
  `✅ حاجز مُوائم الاستدلال: ${adapterFiles.length} ملفَّ مُوائمٍ بلا سياسةٍ ولا مستودعٍ ولا سجلٍّ في يدِه ولا تفويضٍ يمنحُه لنفسِه، ومُوائمٌ حتميٌّ لا يستعملُ شبكةً ولا نظامَ ملفّاتٍ فإعلانُ \`disabled\` مقيسٌ لا مُصدَّقٌ، وبلا قيمةٍ تُشبِهُ مفتاحاً في الشفرةِ والمفتاحُ باسمِ متغيّرِ بيئةٍ وحدَه، و${FORBIDDEN_RESULT_FIELDS.length} حقلَ سلطةٍ مرفوضاً في الناتجِ، وكلُّ ناتجٍ يمرُّ بـ\`assertAdapterResult\` بمُهلةٍ تُجهِضُ بإشارةٍ لا تُهمِلُ النداءَ، ومُوائمُ \`https\` يأخذُ خياراتَ تعميتِه من موضعِ التعميةِ الواحدِ بلا ذكرٍ لـ\`rejectUnauthorized\` في نصِّه، ويقرأُ مفتاحَه من البيئةِ عندَ كلِّ نداءٍ، ولجسمِ ردِّه سقفٌ، ومقيسٌ على مِقبسٍ حقيقيٍّ في \`tests/inference/https-adapter.test.mjs\`؛ ولا مزوّدَ إلا مُعلَناً في \`config/${INFERENCE_PROVIDERS_FILE}\` — **مَقيساً ببناءِ مُوائمٍ لكلِّ مزوّدٍ مُعلَنٍ هنا لا بقراءةِ نصِّها** — وبلا عنوانٍ مكتوبٍ في شفرةِ \`src/\`، ورفضُ الإعلانِ الفاسدِ مقيسٌ في \`tests/inference/providers.test.mjs\`؛ ولا سقفَ رموزٍ في الشفرةِ — الحدُّ والنافذةُ من \`config/quotas.yaml\` **مقابَلَينِ بها هنا** وغيابُ الحصّةِ رفضٌ مُسمّىً مقيسٌ بتشغيلِه، ونافذةُ الميزانيةِ مستقلّةٌ عن نافذةِ حدِّ المعدَّلِ، والاستهلاكُ يُقيَّدُ في دفترِ التكلفةِ ببندِ الوثيقةِ وفشلُ القيدِ يمنعُ المُخرَجَ.`,
);
