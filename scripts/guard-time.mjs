#!/usr/bin/env node
// حاجزُ الوقتِ المُبرهَنِ — إغلاقُ الدَّينِ `D-7` (‏`WL-192`).
//
// الغرضُ: أن يسقطَ البناءُ إذا عادَ **الطريقُ** الذي كانَ يجعلُ الوقتَ السياديَّ
// ما تقولُه ساعةُ الجهازِ. والسلوكُ نفسُه مقيسٌ في `tests/time/`؛ وهذا الحاجزُ
// يحرسُ ما لا يحرسُه اختبارُ سلوكٍ: أن لا يُفتحَ المسارُ من موضعٍ آخرَ بعدَ
// إغلاقِه. وثمانُ قواعدَ:
//
//   T1 — السياسةُ تتماسكُ أو يسقطُ الحاجزُ: التحميلُ نفسُه هو الفحصُ
//        (‏`loadTimePolicy` يقرأُ `config/time.yaml` ومخطَّطَه)، فلا تُكرَّرُ
//        قواعدُه هنا كي لا تنحرفَ نسخةُ الحاجزِ عن الكودِ.
//   T2 — **النِّصابُ اثنانِ على الأقلِّ ومصادرُ مستقلّةٌ**: مصدرٌ واحدٌ موقَّعٌ
//        يكشفُ من على المسارِ ولا يكشفُ المصدرَ نفسَه إن كذبَ. ومصادرُ سياسةٍ
//        تشتركُ في مضيفٍ واحدٍ نِصابٌ صوريٌّ.
//   T3 — **لا مِفتاحَ شاهدٍ محليٍّ في السياسةِ**: الشاهدُ يوقِّعُ بمفتاحٍ عابرٍ
//        ويقولُ ما تقولُه ساعتُه؛ فمصدرٌ عنوانُه محليٌّ (‏`127.0.0.1` أو
//        `localhost`) في سياسةِ المستودعِ يجعلُ «البُرهانَ» شهادةَ الجهازِ لنفسِه.
//   T4 — **كلُّ رمزِ رفضٍ مُعلَنٍ يُرفَعُ فعلاً**: كلُّ مفتاحٍ في `TIME_ERRORS`
//        يجبُ أن يُرفَعَ في `src/time/` أو في جذرِ الثقةِ. ورمزٌ مُعلَنٌ لا يُرفَعُ
//        وعدٌ برفضٍ لا يقعُ، وهو أسوأُ من عدمِه لأنّه يُقرأُ ضماناً.
//   T5 — **لا مَخرَجَ عبرَ البيئةِ في حزمةِ الوقتِ**: لا `process.env` في
//        `src/time/`. وحدٌّ يُقرأُ من متغيّرِ بيئةٍ يُطفئُه من يملكُ الجهازَ بلا
//        فرقٍ يُراجَعُ.
//   T6 — **البوابةُ ترفضُ الساعةَ غيرَ المُبرهَنةِ**: `crown.mts` يحملُ
//        `requireAttestedTime`، ويُلزَمُ في الإنتاجِ، ويرفعُ
//        `ATTESTED_TIME_REQUIRED`، والرمزُ مُعلَنٌ في `clock.mts`.
//   T7 — **الطزاجةُ بمقياسٍ رتيبٍ لا بساعةِ الجهازِ**: `attested-clock.mjs`
//        يحسبُ العمرَ من `monotonic` ولا يقرأُ `Date.now()` في حسابِ `now()`.
//        ولو قيسَ العمرُ بساعةِ الجهازِ لأمكنَ إبقاءُ بُرهانٍ قديمٍ «طازَجاً»
//        بإرجاعِ الساعةِ.
//   T8 — **المتَّجهاتُ الخارجيّةُ موصولةٌ ومنسوبةٌ**: ملفَّا المتَّجهاتِ موجودانِ،
//        ولهما ملفُّ نسبةٍ يذكرُ المصدرَ ورخصتَه، والاختبارُ يقرؤهما. ومتَّجهٌ
//        بلا نسبةٍ لا يُعرَفُ من أينَ جاءَ، فلا يصلحُ دليلاً.
//
// ورمزُ الخروجِ 1 عندَ أيِّ مخالفةٍ، ولا يُسكَتُ الحاجزُ ببيئةٍ ولا بوسيطٍ.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootArg = process.argv.includes('--root')
  ? process.argv[process.argv.indexOf('--root') + 1]
  : undefined;
const ROOT = path.resolve(rootArg ?? path.join(path.dirname(fileURLToPath(import.meta.url)), '..'));

/** @type {string[]} */
const violations = [];

/**
 * @param {string} relative
 * @returns {string}
 */
function read(relative) {
  return fs.readFileSync(path.join(ROOT, relative), 'utf8');
}

/**
 * @param {string} source
 * @returns {string}
 */
function withoutComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//') && !line.trim().startsWith('*'))
    .join('\n');
}

// ── T1: السياسةُ تتماسكُ أو يسقطُ الحاجزُ ──
const { loadTimePolicy } = await import(
  new URL(`file://${path.join(ROOT, 'src/time/policy.mjs')}`).href
);
/** @type {import('../src/time/policy.mjs').TimePolicy} */
let policy;
try {
  policy = loadTimePolicy({ dir: path.join(ROOT, 'config') });
} catch (error) {
  console.error(`⛔ T1: ${error instanceof Error ? error.message : String(error)}`);
  console.error('\n⛔ حاجز الوقت: سياسةُ الوقتِ لا تُحمَّلُ، فلا معنى لبقيّةِ الفحوصِ.');
  process.exit(1);
}

// ── T2: النِّصابُ ومصادرُ مستقلّةٌ ──
if (policy.quorum < 2) {
  violations.push(
    `T2: النِّصابُ ${policy.quorum}؛ ومصدرٌ واحدٌ موقَّعٌ لا يُكشَفُ كذبُه إلا بخلافِ ثانٍ.`,
  );
}
if (!policy.requireAttestedTime) {
  violations.push(
    'T2: `sovereign.requireAttestedTime` مطفأةٌ في السياسةِ؛ ومعيارُ إغلاقِ `D-7` رفضُ الساعةِ غيرِ المُبرهَنةِ في المسارِ السياديِّ.',
  );
}
const hosts = new Set(policy.sources.map((source) => source.host));
if (hosts.size < policy.quorum) {
  violations.push(
    `T2: مضيفاتٌ مستقلّةٌ (${hosts.size}) أقلُّ من النِّصابِ (${policy.quorum})؛ فالنِّصابُ يُستوفى من خادمٍ واحدٍ — اتّفاقٌ متوهَّمٌ.`,
  );
}

// ── T3: لا شاهدَ محليٌّ في السياسةِ ──
for (const source of policy.sources) {
  if (/^(127\.|localhost$|0\.0\.0\.0$|::1$)/.test(source.host)) {
    violations.push(
      `T3: المصدرُ «${source.id}» عنوانُه محليٌّ (${source.host})؛ وشهادةُ الجهازِ لنفسِه ليست بُرهاناً.`,
    );
  }
}
const witnessSource = read('src/time/witness.mjs');
if (!witnessSource.includes('generateKeyPairSync')) {
  violations.push(
    'T3: الشاهدُ المحليُّ لا يولِّدُ مِفتاحاً عابراً؛ ومِفتاحٌ مثبَّتٌ للشاهدِ يجعلُه مصدراً يُقبَلُ في الإنتاجِ.',
  );
}

// ── T4: كلُّ رمزٍ مُعلَنٍ يُرفَعُ فعلاً ──
const timeDir = path.join(ROOT, 'src/time');
const timeFiles = fs
  .readdirSync(timeDir)
  .filter((name) => name.endsWith('.mjs'))
  .map((name) => ({ name, source: read(path.join('src/time', name)) }));
const errorsSource = read('src/time/errors.mjs');
const declared = [...errorsSource.matchAll(/^ {2}([A-Z_]+):\s*'TIME_([A-Z_]+)'/gm)].map((match) =>
  String(match[1]),
);
if (declared.length === 0) {
  violations.push(
    'T4: لم تُقرأ أيُّ رموزِ رفضٍ من `src/time/errors.mjs`؛ والقراءةُ نفسُها معطوبةٌ.',
  );
}
const crownSource = read('src/root-of-trust/crown.mts');
const raisedIn = timeFiles
  .filter((file) => file.name !== 'errors.mjs')
  .map((file) => file.source)
  .concat([crownSource])
  .join('\n');
for (const code of declared) {
  const raisedByMap = raisedIn.includes(`TIME_ERRORS.${code}`);
  const raisedByLiteral = raisedIn.includes(`'${code}'`);
  if (!raisedByMap && !raisedByLiteral) {
    violations.push(
      `T4: الرمزُ \`TIME_${code}\` مُعلَنٌ ولا يُرفَعُ في أيِّ موضعٍ؛ ووعدُ رفضٍ لا يقعُ يُقرأُ ضماناً.`,
    );
  }
}

// ── T5: لا مَخرَجَ عبرَ البيئةِ في حزمةِ الوقتِ ──
for (const file of timeFiles) {
  if (withoutComments(file.source).includes('process.env')) {
    violations.push(
      `T5: \`src/time/${file.name}\` يقرأُ \`process.env\`؛ وحدٌّ يُطفَأُ بمتغيّرِ بيئةٍ لا يُراجَعُ في فرقٍ.`,
    );
  }
}

// ── T6: البوابةُ ترفضُ الساعةَ غيرَ المُبرهَنةِ ──
/** @type {Array<[string, string]>} */
const crownRules = [
  [
    'requireAttestedTime',
    'بوابةُ التاجِ لا تحملُ `requireAttestedTime`؛ فلا موضعَ يُلزِمُ فيه الوقتُ المُبرهَنُ.',
  ],
  [
    "['requireAttestedTime', options.requireAttestedTime]",
    'إلزامُ الوقتِ المُبرهَنِ يُطفَأُ بخيارٍ في الإنتاجِ؛ وضمانٌ يُطفئُه المستهلِكُ ليس ضماناً.',
  ],
  [
    "ClockError('ATTESTED_TIME_REQUIRED'",
    'البوابةُ لا ترفعُ `ATTESTED_TIME_REQUIRED`؛ ورفضٌ بلا رمزٍ لا يُقرأُ آلياً.',
  ],
  [
    'this.assertAttestedTime();',
    'قراءةُ الوقتِ في البوابةِ لا تمرُّ بفحصِ البُرهانِ؛ فيُحسَبُ عمرُ أمرٍ على ساعةٍ لا شاهدَ لها.',
  ],
];
for (const [needle, message] of crownRules) {
  if (!crownSource.includes(needle)) violations.push(`T6: ${message}`);
}
if (!read('src/root-of-trust/clock.mts').includes("'ATTESTED_TIME_REQUIRED'")) {
  violations.push(
    'T6: الرمزُ `ATTESTED_TIME_REQUIRED` غيرُ مُعلَنٍ في `clock.mts`؛ ورمزٌ يُرفَعُ ولا يُعلَنُ لا يُوازَنُ في اختبارٍ.',
  );
}

// ── T7: الطزاجةُ بمقياسٍ رتيبٍ ──
const clockSource = withoutComments(read('src/time/attested-clock.mjs'));
if (!clockSource.includes('this.monotonic()')) {
  violations.push(
    'T7: الساعةُ المُبرهَنةُ لا تقيسُ عمرَ البُرهانِ بمقياسٍ رتيبٍ؛ فيُبقى بُرهانٌ قديمٌ طازَجاً بإرجاعِ ساعةِ الجهازِ.',
  );
}
const nowBody = /now\(\)\s*\{([\s\S]*?)\n {2}\}/.exec(clockSource);
if (nowBody === null) {
  violations.push(
    'T7: تعذَّرَ قراءةُ جسمِ `now()` في الساعةِ المُبرهَنةِ؛ والقراءةُ نفسُها معطوبةٌ.',
  );
} else if (/Date\.now\(\)|this\.wallClock\(\)/.test(String(nowBody[1]))) {
  violations.push(
    'T7: `now()` في الساعةِ المُبرهَنةِ يقرأُ ساعةَ الجهازِ؛ وهو العيبُ الذي أُغلِقَ لا إصلاحُه.',
  );
}

// ── T8: المتَّجهاتُ الخارجيّةُ موصولةٌ ومنسوبةٌ ──
const vectorFiles = [
  'tests/fixtures/roughtime/roughtime_response.vec',
  'tests/fixtures/roughtime/roughtime_request.vec',
  'tests/fixtures/roughtime/PROVENANCE.md',
];
for (const relative of vectorFiles) {
  if (!fs.existsSync(path.join(ROOT, relative))) {
    violations.push(
      `T8: ملفُّ متَّجهاتٍ مفقودٌ: ${relative}؛ وبلا متَّجهٍ خارجيٍّ يبقى التحقُّقُ يشهدُ لنفسِه.`,
    );
  }
}
if (fs.existsSync(path.join(ROOT, 'tests/fixtures/roughtime/PROVENANCE.md'))) {
  const provenance = read('tests/fixtures/roughtime/PROVENANCE.md');
  if (!provenance.includes('https://')) {
    violations.push('T8: ملفُّ النسبةِ لا يذكرُ مصدراً بعنوانٍ؛ ونسبةٌ بلا عنوانٍ لا تُتحقَّقُ.');
  }
}
if (fs.existsSync(path.join(ROOT, 'tests/time/roughtime.test.mjs'))) {
  const vectorTest = read('tests/time/roughtime.test.mjs');
  if (!vectorTest.includes('roughtime_response.vec')) {
    violations.push(
      'T8: اختبارُ الوقتِ لا يقرأُ متَّجهاتِ الرُّدودِ؛ ومتَّجهٌ محفوظٌ لا يُقرأُ ليس دليلاً.',
    );
  }
} else {
  violations.push('T8: `tests/time/roughtime.test.mjs` مفقودٌ؛ فلا موضعَ تُقاسُ فيه المتَّجهاتُ.');
}

if (violations.length > 0) {
  for (const violation of violations) console.error(`⛔ ${violation}`);
  console.error(`\n⛔ حاجز الوقت: ${violations.length} مخالفةً.`);
  process.exit(1);
}

console.log(
  `✅ حاجز الوقت: ${policy.sources.length} مصدراً موقَّعاً على ${hosts.size} مضيفاً مستقلّاً بنِصابِ ${policy.quorum}، و${declared.length} رمزَ رفضٍ كلُّها مرفوعةٌ، والبوابةُ ترفضُ الساعةَ غيرَ المُبرهَنةِ، والعمرُ بمقياسٍ رتيبٍ، والمتَّجهاتُ الخارجيّةُ منسوبةٌ.`,
);
