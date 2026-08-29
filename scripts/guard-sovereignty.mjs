#!/usr/bin/env node
/**
 * حاجزُ السيادةِ القابلةِ للسحب — البوابةُ الرابعةُ والعشرون في `npm run validate`
 * (الخطوة M8.08).
 *
 * البوابةُ 23 تحرس أنّ التفويضَ الترابيَّ **موجودٌ ومُنفَّذ**. وهذه تحرس أنّه
 * **سياديٌّ ومقيس**: أنّ التفعيلَ والسحبَ لا يقعان إلا بأمرٍ ملكيٍّ يمرّ ببوابة
 * التاجِ **قبل** أن تُلمَس الحالة، وأنّ أثرَ كلِّ أمرٍ يُكتب صفّاً في سجلٍّ لا
 * يتكرّر فيه معرّفُ أمر، وأنّ زمنَ نفاذِ السحبِ **مشتقٌّ من وقتين محفوظين** لا
 * مكتوبٌ باليد، وأنّ الحكمَ على المهلةِ محسوبٌ من القياسِ لا مُعلَنٌ استقلالاً.
 * وثماني قواعد:
 *
 *   S1: قسمُ `sovereignty` مُعلَنٌ في `config/federation-delegation.yaml`: فعلا
 *       الأمرِ متمايزان وعلى شكلٍ مقروء، ومهلةُ السحبِ رقمٌ موجَبٌ مُعلَن.
 *   S2: `FEDERATION_REGISTER_SPEC` قائمةٌ بتفرُّدِ `commandId` وبثوابتِ الزمنِ
 *       والمهلةِ والسببِ الأربعة؛ فسجلٌّ بلا تفرُّدٍ سجلٌّ يُكتب فيه أمرٌ مرّتين.
 *   S3: الهجرة 0017 صعوداً ونزولاً موجودةٌ، وتحمل الجدولَ وقيودَه الستةَ
 *       بأسمائها، ونزولُها يرفض التراجعَ إن كان في السجلِّ صفٌّ واحد.
 *   S4: السجلُّ **مركَّبٌ** في `composition.mjs` و`unit-of-work.mjs`، وتُمرَّر
 *       بوابةُ التاجِ والسجلُّ إلى `RegionalDelegation`؛ فسيادةٌ ككودٍ غيرِ
 *       مركَّبٍ سيادةٌ لا مسارَ لها في التشغيل.
 *   S5: نداءُ البوابةِ (`this.#royal(`) يقع **قبل** كلِّ لمسٍ للحالةِ نصّاً في
 *       `delegation.mjs`: قبل `this.delegations.insert(` وقبل
 *       `this.delegations.update(`.
 *   S6: أثرُ الأمرِ يُكتب في السجلِّ في التفعيلِ والسحبِ كليهما
 *       (`this.register.record(` مرّتين على الأقلّ)، وحادثتا التسجيلِ والتجاوزِ
 *       تُنشران نصّاً حرفيّاً في `sovereignty.mjs`.
 *   S7: القياسُ مشتقٌّ لا مُمرَّر: لا موضعَ في `src/` يقرأ `withinDeadline` أو
 *       `latencyMs` من دخلِ مستدعٍ، والحكمُ محسوبٌ من `latencyMs <= deadlineMs`.
 *   S8: ملفُّ اختبارِ السيادةِ موجودٌ ويقيس المهلةَ وتباعدَ السجلِّ والإعادةَ؛
 *       فبوابةٌ تحرس النصَّ بلا اختبارٍ يقيس السلوكَ نصفُ حاجز.
 *
 * **حدٌّ معلَن أول:** الحاجزُ يقرأ المستودعَ ولا يشغّل قاعدةً؛ أنّ الهجرة 0017
 * طُبِّقت على PostgreSQL حقيقيٍّ غيرُ مُثبَتٍ هنا كما في البوابات 21–23، وهو
 * مسجَّلٌ في `docs/REMAINING_WORK.md`.
 *
 * **حدٌّ معلَن ثانٍ:** الحاجزُ يحرس **وقوعَ** النداءِ وترتيبَه نصّاً، لا صحّةَ
 * التوقيعِ ولا منعَ الإعادة — ذاك عملُ بوابةِ التاجِ نفسِها ومقيسٌ في
 * `tests/federation/sovereignty.test.mjs`.
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { FEDERATION_EVENTS, loadDelegationPolicy } from '../src/federation/delegation.mjs';
import { FEDERATION_REGISTER_SPEC } from '../src/persistence/entities.mjs';

const argv = process.argv.slice(2);
const rootIndex = argv.indexOf('--root');
const rootArg = rootIndex >= 0 ? argv[rootIndex + 1] : undefined;
const ROOT =
  rootArg !== undefined && rootArg !== ''
    ? path.resolve(rootArg)
    : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** @type {string[]} */
const violations = [];

/**
 * @param {string} relative
 * @returns {string}
 */
function readFile(relative) {
  const full = path.join(ROOT, relative);
  return fs.existsSync(full) ? fs.readFileSync(full, 'utf8') : '';
}

// ═══ S1 ═══
/** @type {import('../src/federation/delegation.mjs').DelegationPolicy | null} */
let policy = null;
try {
  policy = loadDelegationPolicy({
    dir: path.join(ROOT, 'config'),
    seedDir: path.join(ROOT, 'seed'),
  });
} catch (error) {
  violations.push(`S1: ${error instanceof Error ? error.message : String(error)}`);
}

let deadlineMs = 0;
if (policy !== null) {
  const sovereignty = policy.sovereignty;
  const activate = String(sovereignty?.commands?.activate ?? '');
  const revoke = String(sovereignty?.commands?.revoke ?? '');
  const shape = /^[a-z][a-z0-9-]{4,63}$/;
  /** @type {Array<[string, string]>} */
  const actions = [
    ['activate', activate],
    ['revoke', revoke],
  ];
  for (const [name, action] of actions) {
    if (!shape.test(action)) {
      violations.push(
        `S1: فعلُ أمرِ ${name} (${action || 'غائب'}) ليس على شكلِ فعلٍ ملكيٍّ مقروء — وفعلٌ حرُّ الشكلِ يُطابَق بالمصادفة.`,
      );
    }
  }
  if (activate !== '' && activate === revoke) {
    violations.push('S1: فعلُ أمرِ التفويضِ وفعلُ أمرِ سحبِه اسمٌ واحد — أمرٌ يصلح للفعلين.');
  }
  deadlineMs = Number(sovereignty?.revocation?.deadlineMs ?? 0);
  if (!Number.isInteger(deadlineMs) || deadlineMs <= 0) {
    violations.push(
      `S1: مهلةُ نفاذِ السحبِ (${String(sovereignty?.revocation?.deadlineMs)}) ليست رقماً موجَباً — و«مهلةٌ معلَنة» بلا رقمٍ ليست مهلة.`,
    );
  }
}

// ═══ S2 ═══
const uniqueOnCommand = FEDERATION_REGISTER_SPEC.unique.some(
  (group) => group.length === 1 && group[0] === 'commandId',
);
if (!uniqueOnCommand) {
  violations.push(
    'S2: `FEDERATION_REGISTER_SPEC` بلا تفرُّدٍ على `commandId` — سجلٌّ يُكتب فيه أمرٌ ملكيٌّ مرّتين سجلٌّ يُقرأ منه أثرانِ لأمرٍ واحد.',
  );
}
const invariantCodes = new Set(FEDERATION_REGISTER_SPEC.invariants.map((entry) => entry.code));
for (const code of [
  'FEDERATION_REGISTER_TIMES_ORDERED',
  'FEDERATION_REGISTER_LATENCY_MEASURED',
  'FEDERATION_REGISTER_DEADLINE_JUDGED',
  'FEDERATION_REGISTER_REASON_BOUND_TO_EFFECT',
]) {
  if (!invariantCodes.has(code)) {
    violations.push(
      `S2: ثابتُ ${code} غائبٌ عن مواصفةِ السجل — صفٌّ يُقبل بزمنٍ لا يُقرأ منه شيء.`,
    );
  }
}

// ═══ S3 ═══
const up = readFile('migrations/0017_federation_sovereignty.up.sql');
const down = readFile('migrations/0017_federation_sovereignty.down.sql');
if (up === '' || down === '') {
  violations.push(
    'S3: الهجرة 0017 صعوداً أو نزولاً غائبة — سجلٌّ في الكودِ بلا جدولٍ في القاعدة سجلٌّ يُفقَد بإعادةِ التشغيل.',
  );
} else {
  if (!up.includes('CREATE TABLE state.federation_delegation_register')) {
    violations.push('S3: الهجرة 0017 لا تُنشئ `state.federation_delegation_register`.');
  }
  for (const constraint of [
    'federation_register_command_once',
    'federation_register_level_key_shaped',
    'federation_register_times_ordered',
    'federation_register_latency_measured',
    'federation_register_deadline_judged',
    'federation_register_reason_bound_to_effect',
  ]) {
    if (!up.includes(constraint)) {
      violations.push(
        `S3: القيد ${constraint} غائبٌ عن الهجرة 0017 — ثابتٌ في الكودِ وحدَه يُخترَق بأولِ كتابةٍ مباشرةٍ في القاعدة.`,
      );
    }
  }
  // والحكمُ على المهلةِ مفروضٌ في القاعدةِ محسوباً لا مكتوباً: نصُّ القيدِ نفسُه
  // يقابل العمودَ بالقياس.
  if (!/within_deadline\s*=\s*\(latency_ms\s*<=\s*deadline_ms\)/.test(up)) {
    violations.push(
      'S3: قيدُ المهلةِ في الهجرة 0017 لا يفرض `within_deadline = (latency_ms <= deadline_ms)` — حكمٌ يُكتب استقلالاً عن قياسه يُخضِّر مهلةً لم تُحترَم.',
    );
  }
  if (!down.includes('RAISE EXCEPTION')) {
    violations.push(
      'S3: تراجعُ الهجرة 0017 لا يرفض إسقاطَ جدولٍ فيه أوامرُ منفَّذة — محوُ السجلِّ محوُ الدليلِ على التأخُّر.',
    );
  }
}

// ═══ S4 ═══
const composition = readFile('src/persistence/composition.mjs');
const unitOfWork = readFile('src/persistence/unit-of-work.mjs');
/** @type {Array<[string, string]>} */
const composed = [
  ['src/persistence/composition.mjs', composition],
  ['src/persistence/unit-of-work.mjs', unitOfWork],
];
for (const [file, source] of composed) {
  if (!source.includes('FEDERATION_REGISTER_SPEC')) {
    violations.push(
      `S4: مواصفةُ السجلِّ غيرُ مركَّبةٍ في ${file} — جدولٌ بلا مستودعٍ لا يُكتب فيه.`,
    );
  }
}
if (!composition.includes('new DelegationRegister(')) {
  violations.push('S4: `DelegationRegister` غيرُ مُنشَأٍ في composition.mjs.');
}
for (const needle of ['register: delegationRegister', 'crown,']) {
  if (!composition.includes(needle)) {
    violations.push(
      `S4: \`${needle}\` غيرُ مُمرَّرٍ إلى RegionalDelegation في composition.mjs — تفويضٌ بلا بوابةِ تاجٍ أو بلا سجلٍّ يعود سلطةً بمقارنةِ اسمِ دور.`,
    );
  }
}

// ═══ S5 و S6 و S7 ═══
const delegation = readFile('src/federation/delegation.mjs');
const sovereigntySource = readFile('src/federation/sovereignty.mjs');
if (sovereigntySource === '') {
  violations.push('S6: `src/federation/sovereignty.mjs` غائب.');
}
const royalAt = delegation.indexOf('this.#royal(');
const insertAt = delegation.indexOf('this.delegations.insert(');
const updateAt = delegation.indexOf('this.delegations.update(');
if (royalAt < 0) {
  violations.push(
    'S5: `this.#royal(` غيرُ موجودٍ في delegation.mjs — تفعيلٌ أو سحبٌ بلا نداءِ بوابةِ التاجِ فعلٌ بلا أمرٍ ملكيّ.',
  );
} else {
  if (insertAt >= 0 && royalAt > insertAt) {
    violations.push(
      'S5: نداءُ بوابةِ التاجِ يقع بعد `this.delegations.insert(` — سلطةٌ كُتبت ثم استُؤذِن التاجُ فيها.',
    );
  }
  if (updateAt >= 0 && royalAt > updateAt) {
    violations.push(
      'S5: نداءُ بوابةِ التاجِ يقع بعد `this.delegations.update(` — سحبٌ نفَذ ثم استُؤذِن التاجُ فيه.',
    );
  }
}
const records = delegation.split('this.register.record(').length - 1;
if (records < 2) {
  violations.push(
    `S6: أثرُ الأمرِ يُكتب في السجلِّ ${records} مرّةً والسيادةُ فعلان (منحٌ وسحب) — فعلٌ سياديٌّ بلا صفٍّ في السجلِّ سيادةٌ لا تُراجَع.`,
  );
}
for (const type of [FEDERATION_EVENTS.REGISTERED, FEDERATION_EVENTS.OVERDUE]) {
  if (!sovereigntySource.includes(`'${type}'`)) {
    violations.push(
      `S6: الحدث ${type} لا يُنشر نصّاً حرفيّاً في sovereignty.mjs — حدثٌ يُبنى بالتركيبِ لا يُقرأ في عقدٍ ولا يُحرَس.`,
    );
  }
}
if (!/latencyMs\s*<=\s*(input\.)?deadlineMs/.test(sovereigntySource)) {
  violations.push(
    'S7: الحكمُ على المهلةِ غيرُ محسوبٍ من القياسِ في sovereignty.mjs — حكمٌ يُمرَّر جاهزاً حكمٌ يُكتب باليد.',
  );
}
for (const forbidden of ['input.withinDeadline', 'input.latencyMs']) {
  if (sovereigntySource.includes(forbidden)) {
    violations.push(
      `S7: \`${forbidden}\` يُقرأ من دخلِ المستدعي — قياسٌ يُمرَّر جاهزاً ليس قياساً.`,
    );
  }
}

// ═══ S8 ═══
const test = readFile('tests/federation/sovereignty.test.mjs');
if (test === '') {
  violations.push(
    'S8: `tests/federation/sovereignty.test.mjs` غائب — حاجزٌ يقرأ النصَّ بلا اختبارٍ يقيس السلوكَ نصفُ حاجز.',
  );
} else {
  /** @type {Array<[string, string]>} */
  const measured = [
    ['REVOCATION_DEADLINE_MISSED', 'مهلةُ السحبِ غيرُ مقيسةٍ في الاختبار'],
    ['REGISTER_DIVERGED', 'تباعدُ السجلِّ عن الصفوفِ غيرُ مقيس'],
    ['REPLAYED_COMMAND', 'إعادةُ الأمرِ الملكيِّ غيرُ مقيسة'],
    ['INVALID_ROYAL_SIGNATURE', 'توقيعُ الأمرِ غيرُ مقيس'],
  ];
  for (const [needle, why] of measured) {
    if (!test.includes(needle)) violations.push(`S8: ${why} (${needle}).`);
  }
}

if (violations.length > 0) {
  console.error('⛔ حاجز السيادة القابلة للسحب رفض:');
  for (const violation of violations) console.error(`   • ${violation}`);
  process.exit(1);
}

console.log(
  `✅ حاجز السيادة القابلة للسحب: التفعيلُ والسحبُ أمرانِ ملكيّانِ يمرّانِ ببوابة التاج قبل لمسِ الحالة، وأثرُهما ${records} صفّاً في سجلٍّ لا يتكرّر فيه معرّفُ أمرٍ (${FEDERATION_REGISTER_SPEC.invariants.length} ثوابتَ و6 قيوداً مسمَّاةً في الهجرة 0017)، ومهلةُ نفاذِ السحبِ ${deadlineMs}ms مقيسةً من وقتين محفوظين وحكمُها محسوبٌ منها لا مكتوبٌ باليد.`,
);
