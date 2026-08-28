#!/usr/bin/env node
/**
 * حاجزُ التفويضِ الترابيّ — البوابةُ الثالثةُ والعشرون في `npm run validate`
 * (الخطوة M8.07).
 *
 * الحاجزُ يفحص **المستودعَ** لا التشغيل: يمنع أن يعود «الإقليمُ المستقلُّ» فقرةً
 * في وثيقةٍ لا تُوقف فعلاً ولا تُثبته، وأن يصير سحبُ التفويضِ حرفاً يُغيَّر بلا
 * أثرٍ في القاعدة، وأن يصير «يُمنع ويُسجَّل» رفضاً يُرمى بلا صفٍّ محفوظ. وتِسعُ
 * قواعد:
 *
 *   R1: `config/federation-delegation.yaml` يُحمَّل ويجتاز مخطَّطَه وفحوصَ
 *       تماسكه — ومنها تداخلُ الصلاحياتِ نزولاً وسلسلةُ الأصولِ ومطابقةُ
 *       المفاتيحِ لبذرة `seed/federation.yaml`.
 *   R2: كلُّ بندِ ضمانٍ يقع رمزُه في وحدةِ إنفاذه — نصّاً حرفياً أو عبر مفتاحه
 *       في `FEDERATION_ERRORS`.
 *   R3: كلُّ ملفٍّ في `enforcedBy` موجودٌ في المستودع.
 *   R4: التقابلُ محروسٌ في **الاتجاهين** بين `FEDERATION_ERRORS` وبنودِ الوثيقة.
 *   R5: الهجراتُ تحمل جداولَ التفويضِ وقيودَها بأسمائها، ومعها **الرقمُ نفسُه**
 *       لحدِّ سببِ السحبِ والرفض — مقروءاً في موضعه من القيد لا في أيِّ موضعٍ من
 *       النصّ، ومطابِقاً لثابتِ المواصفات.
 *   R6: المواصفاتُ الثلاثُ مركَّبةٌ في `composition.mjs` و`unit-of-work.mjs`،
 *       والتفويضُ نفسُه مُنشَأٌ في `createRegistries` ومُعادٌ في حقلٍ من بنيةِ
 *       السجلات؛ فسلطةٌ ككودٍ غيرِ مركَّبٍ سلطةٌ لا مسارَ لها في التشغيل.
 *   R7: كلُّ نوعِ حدثٍ في `FEDERATION_EVENTS` معلَنٌ عقداً في قناة `federation`.
 *   R8: شروطُ الإجراءِ المُعلَنةُ لازمةٌ فعلاً (`true`)، والمستوياتُ ثلاثةٌ
 *       والصلاحياتُ المحجوزةُ غيرُ فارغة؛ فشرطٌ يُرفع بتغيير حرفٍ في الوثيقة ليس
 *       شرطاً، وإقليمٌ بلا ولايةٍ وبلديةٍ لا يُقاس به تفويضٌ متداخل.
 *   R9: توابعُ التفويضِ الأربعةُ موجودةٌ في `src/federation/delegation.mjs`،
 *       والمنعُ يقع **قبل** فتحِ صفِّ الفعلِ نصّاً في الملف: فحصُ السحبِ وسلسلةِ
 *       الأصولِ قبل `this.acts.insert(`.
 *
 * **حدٌّ معلَن أول:** الحاجزُ لا يشغّل قاعدةً ولا يتحقّق من أنّ الهجرة 0016
 * طُبِّقت على PostgreSQL حقيقيّ — يقرأ نصَّها في `migrations/`. وهو نفسُ الحدِّ
 * المُعلَن في البوابتين 21 و22 ومسجَّلٌ في `docs/REMAINING_WORK.md`.
 *
 * **حدٌّ معلَن ثانٍ:** الحاجزُ يحرس **وقوعَ** النداءِ وترتيبَه نصّاً في الملف، لا
 * صحّةَ المنعِ في التشغيل. وأنّ سحبَ التفويضِ يُوقف العملَ **فوراً** يُثبت في
 * `tests/federation/delegation.test.mjs` بساعةٍ مُجمَّدةٍ وفعلٍ يُرفض بعدها بلا
 * تقديمِ وقتٍ ولا صفِّ فعلٍ يُكتب.
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';
import {
  FEDERATION_ERRORS,
  FEDERATION_EVENTS,
  loadDelegationPolicy,
} from '../src/federation/delegation.mjs';

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

/** @type {import('../src/federation/delegation.mjs').DelegationPolicy | null} */
let policy = null;

// ═══ R1 ═══
try {
  policy = loadDelegationPolicy({
    dir: path.join(ROOT, 'config'),
    seedDir: path.join(ROOT, 'seed'),
  });
} catch (error) {
  violations.push(`R1: ${error instanceof Error ? error.message : String(error)}`);
}

if (policy !== null) {
  // ═══ R2 و R3 ═══
  /** @type {Map<string, string>} */
  const keyOf = new Map(
    Object.entries(FEDERATION_ERRORS).map(([key, value]) => [String(value), key]),
  );
  for (const entry of policy.guarantees) {
    const key = keyOf.get(entry.code);
    const indirect = key === undefined ? null : `FEDERATION_ERRORS.${key}`;
    let seen = false;
    for (const holder of entry.enforcedBy) {
      const source = readFile(holder);
      if (source === '') {
        violations.push(`R3: بندُ الضمان ${entry.code} يُحيل إلى ${holder} وهو غير موجود.`);
        continue;
      }
      if (source.includes(entry.code)) seen = true;
      if (indirect !== null && source.includes(indirect)) seen = true;
    }
    if (!seen) {
      violations.push(
        `R2: بندُ الضمان ${entry.code} لا يقع في أيٍّ من وحدات إنفاذه (${entry.enforcedBy.join('، ')}) — وعدٌ لا ضمان.`,
      );
    }
  }

  // ═══ R4 ═══
  /** @type {Set<string>} */
  const declared = new Set(policy.guarantees.map((entry) => String(entry.code)));
  // ورمزُ فسادِ الوثيقةِ لا بندَ ضمانٍ له: وثيقةٌ فاسدةٌ لا تُقرأ منها ضماناتُها،
  // فالضمانُ عليها يقع في الكود وحدَه ويُعلَن هنا.
  declared.add(FEDERATION_ERRORS.CONFIG_INVALID);
  for (const code of Object.values(FEDERATION_ERRORS)) {
    if (!declared.has(code)) {
      violations.push(
        `R4: الرمز ${code} يقع في FEDERATION_ERRORS ولا بندَ ضمانٍ يُعلِنه في config/federation-delegation.yaml.`,
      );
    }
  }
  /** @type {Set<string>} */
  const inCode = new Set(Object.values(FEDERATION_ERRORS).map((code) => String(code)));
  for (const entry of policy.guarantees) {
    if (!inCode.has(entry.code)) {
      violations.push(
        `R4: بندُ الضمان ${entry.code} معلَنٌ في الوثيقة ولا مقابلَ له في FEDERATION_ERRORS.`,
      );
    }
  }

  // ═══ R5 ═══
  const migrations = fs
    .readdirSync(path.join(ROOT, 'migrations'))
    .filter((name) => name.endsWith('.up.sql'))
    .map((name) => readFile(path.join('migrations', name)))
    .join('\n');
  const required = [
    'state.federation_delegations',
    'state.federation_local_acts',
    'state.federation_refusals',
    'federation_delegations_level_key_shaped',
    'federation_delegations_parent_coherent',
    'federation_delegations_powers_declared',
    'federation_delegations_revocation_complete',
    'federation_delegations_revoked_after_activation',
    'federation_delegations_territory_unique',
    'federation_local_acts_subject_substantial',
    'federation_local_acts_within_acting_territory',
    'federation_refusals_reason_substantial',
    'federation_refusals_code_declared',
  ];
  for (const needle of required) {
    if (!migrations.includes(needle)) {
      violations.push(
        `R5: ${needle} غيرُ موجودٍ في الهجرات — قيدٌ في الكود بلا قيدٍ في القاعدة يُلتفُّ عليه بكتابةٍ مباشرة.`,
      );
    }
  }
  // والرقمُ يُقرأ **في موضعه من القيد** لا في أيِّ موضعٍ من النصّ: البحثُ عن
  // «20» مجرَّداً يمرُّ لأنّ الرقمَ يقع في هجرةٍ أخرى أو في تعليق، فيصير الحاجزُ
  // يُصدِّق تطابقاً لم يفحصه.
  const reasonLimit = String(policy.procedure.minRefusalReasonLength);
  for (const [column, label] of [
    ['revocation_reason', 'سببُ سحبِ التفويض'],
    ['reason', 'سببُ الرفض'],
    ['subject', 'موضوعُ الفعل'],
  ]) {
    const rx = new RegExp(
      String.raw`length\(btrim\(` + String(column) + String.raw`\)\)\s*>=\s*` + reasonLimit + '\\b',
    );
    if (!rx.test(migrations)) {
      violations.push(
        `R5: قيدُ ${String(label)} (${String(column)}) في الهجرات لا يقرأ الحدَّ ${reasonLimit} — حدٌّ في الوثيقة وقيدٌ آخرُ في القاعدة شرطان لا شرط.`,
      );
    }
  }
  const entities = readFile('src/persistence/entities.mjs');
  for (const constant of ['FEDERATION_MIN_REASON_LENGTH', 'FEDERATION_MIN_SUBJECT_LENGTH']) {
    if (!new RegExp(constant + String.raw`\s*=\s*` + reasonLimit + '\\b').test(entities)) {
      violations.push(
        `R5: ${constant} في src/persistence/entities.mjs لا يساوي ${reasonLimit} — ثابتُ المستودع الذاكري ينحرف عن الوثيقة.`,
      );
    }
  }

  // ═══ R6 ═══
  const composition = readFile('src/persistence/composition.mjs');
  for (const needle of [
    'FEDERATION_DELEGATION_SPEC',
    'FEDERATION_ACT_SPEC',
    'FEDERATION_REFUSAL_SPEC',
    'new RegionalDelegation(',
    'loadDelegationPolicy(',
    'repositories.federationDelegations',
    'repositories.federationActs',
    'repositories.federationRefusals',
  ]) {
    if (!composition.includes(needle)) {
      violations.push(
        `R6: ${needle} غيرُ موجودٍ في src/persistence/composition.mjs — سلطةٌ ككودٍ غيرِ مركَّبٍ سلطةٌ لا مسارَ لها في التشغيل.`,
      );
    }
  }
  // والتفويضُ يُقرأ **حقلاً مُعاداً** في بنيةِ السجلات لا مجرَّدَ متغيّرٍ مُنشَأٍ
  // في الدالة: مُنشَأٌ ولا يُعاد لا يبلغه مستدعٍ فلا يُمارَس فعلٌ ولا يُوقفه سحب.
  if (!/\n\s*federation:\s*regionalDelegation\s*,/.test(composition)) {
    violations.push(
      'R6: `federation` غيرُ مُعادٍ في بنيةِ السجلات من src/persistence/composition.mjs — تفويضٌ مُنشَأٌ لا يبلغه مستدعٍ.',
    );
  }
  const unitOfWork = readFile('src/persistence/unit-of-work.mjs');
  for (const needle of [
    'FEDERATION_DELEGATION_SPEC',
    'FEDERATION_ACT_SPEC',
    'FEDERATION_REFUSAL_SPEC',
  ]) {
    const rx = new RegExp(
      String.raw`createPostgresRepository\(\s*client\s*,\s*` + needle + String.raw`\s*\)`,
    );
    if (!rx.test(unitOfWork)) {
      violations.push(
        `R6: ${needle} غيرُ مربوطٍ بوصلة المعاملة في src/persistence/unit-of-work.mjs — صفُّ رفضٍ يُكتب خارج المعاملة ينجو من تراجعها أو يُفقَد معها.`,
      );
    }
  }

  // ═══ R7 ═══
  /** @type {unknown} */
  let events;
  try {
    events = YAML.parse(readFile('config/events.yaml'));
  } catch (error) {
    violations.push(`R7: تعذّرت قراءة config/events.yaml: ${String(error)}`);
  }
  const channels = Array.isArray(/** @type {{ channels?: unknown }} */ (events)?.channels)
    ? /** @type {Array<{ id?: unknown, types?: unknown }>} */ (
        /** @type {{ channels: unknown[] }} */ (events).channels
      )
    : [];
  const channel = channels.find((entry) => entry.id === 'federation');
  if (channel === undefined) {
    violations.push(
      'R7: قناةُ federation غيرُ معلَنةٍ في config/events.yaml — سحبُ تفويضٍ يُنشر بلا عقدٍ ولا قارئ.',
    );
  }
  const types = new Set(
    (Array.isArray(channel?.types)
      ? /** @type {Array<{ type?: unknown }>} */ (channel.types)
      : []
    ).map((entry) => String(entry.type)),
  );
  for (const type of Object.values(FEDERATION_EVENTS)) {
    if (!types.has(type)) {
      violations.push(
        `R7: نوعُ الحدث ${type} يُنشر في الكود ولا عقدَ له في قناة federation من config/events.yaml.`,
      );
    }
  }

  // ═══ R8 ═══
  for (const [name, value] of Object.entries(policy.procedure)) {
    if (typeof value === 'boolean' && value !== true) {
      violations.push(
        `R8: \`procedure.${name}\` ليس true في config/federation-delegation.yaml — شرطٌ يُرفع بتغيير حرفٍ في الوثيقة ليس شرطاً.`,
      );
    }
  }
  if (policy.levels.length !== 3) {
    violations.push(
      `R8: الوثيقةُ تُعلن ${policy.levels.length} مستوىً والخطوةُ M8.07 تشترط ثلاثةً (إقليمٌ وولايةٌ وبلدية) — بلا مستوىً ثالثٍ لا تُقاس سلسلةُ التفويضِ ولا انكسارُها بسحبِ الأصل.`,
    );
  }
  if (policy.reserved.powers.length === 0) {
    violations.push(
      'R8: لا صلاحيةَ محجوزةً للمركز في config/federation-delegation.yaml — تفويضٌ بلا محجوزٍ يُقرأ تنازلاً عن السلطةِ لا تفويضاً لها.',
    );
  }
  // وكلُّ مستوىً يمارِس بدورٍ **غيرِ** دورِ التفويضِ والسحب: مستوىً يمارِس بدورِ
  // من يفوّضه لا يُقاس به استقلالٌ ولا نفاذُ سحب.
  for (const level of policy.levels) {
    if (level.exercisedBy === policy.acts.activate || level.exercisedBy === policy.acts.revoke) {
      violations.push(
        `R8: المستوى ${level.key} يمارِس بدورِ التفويضِ أو السحبِ نفسِه (${level.exercisedBy}) — سلطةٌ تُفوَّض إلى مانحها ليست تفويضاً.`,
      );
    }
  }

  // ═══ R9 ═══
  const delegation = readFile('src/federation/delegation.mjs');
  for (const needle of ['async activate(', 'async revoke(', 'async exercise(', 'async status(']) {
    if (!delegation.includes(needle)) {
      violations.push(
        `R9: ${needle} غيرُ موجودٍ في src/federation/delegation.mjs — وثيقةٌ تُعلن حدّاً بلا تابعٍ ينفّذه وعدٌ.`,
      );
    }
  }
  // والمنعُ يقع **قبل** فتحِ صفِّ الفعل: رفضٌ بعد الكتابة يُبقي أثرَ فعلٍ وقع في
  // ترابٍ مسحوبِ التفويض، وهو نقضُ معيارِ القبولِ بعينه.
  const insertAt = delegation.indexOf('this.acts.insert(');
  const revokedAt = delegation.indexOf('FEDERATION_ERRORS.DELEGATION_REVOKED');
  const chainAt = delegation.indexOf('FEDERATION_ERRORS.CHAIN_BROKEN');
  if (insertAt < 0) {
    violations.push('R9: `this.acts.insert(` غيرُ موجودٍ — فعلٌ يُمارَس بلا صفٍّ محفوظٍ لا يُقاس.');
  } else if (revokedAt < 0 || revokedAt > insertAt || chainAt < 0 || chainAt > insertAt) {
    violations.push(
      'R9: فحصُ السحبِ أو سلسلةِ الأصولِ لا يقع قبل `this.acts.insert(` في src/federation/delegation.mjs — منعٌ بعد الكتابة يُبقي أثرَ فعلٍ وقع بعد سحبِ التفويض.',
    );
  }
  // والرفضُ يُسجَّل صفّاً قبل أن يُرمى: منعٌ بلا صفٍّ لا يُعرَف أنّه وقع.
  if (!/this\.refusals\.insert\(/.test(delegation)) {
    violations.push(
      'R9: `this.refusals.insert(` غيرُ موجودٍ في src/federation/delegation.mjs — «يُمنع ويُسجَّل» بلا صفٍّ محفوظٍ منعٌ لا يُراجَع.',
    );
  }
}

if (violations.length > 0) {
  console.error('⛔ حاجز التفويض الترابي رفض:');
  for (const violation of violations) console.error(`   • ${violation}`);
  process.exit(1);
}

const guarantees = policy ? policy.guarantees.length : 0;
const levels = policy ? policy.levels.length : 0;
const powers = policy
  ? new Set(policy.levels.flatMap((level) => level.powers.map((power) => String(power)))).size
  : 0;
const reserved = policy ? policy.reserved.powers.length : 0;
const limit = policy ? policy.procedure.minRefusalReasonLength : 0;
console.log(
  `✅ حاجز التفويض الترابي: ${guarantees} بندَ ضمانٍ مربوطاً برمزِ رفضٍ واقع، و${levels} مستوىً في إقليمٍ واحدٍ معزولٍ بصلاحياتٍ متداخلةٍ نزولاً (${powers} صلاحيةً مفوَّضةً و${reserved} محجوزةً للمركز)، وحدُّ سببِ السحبِ والرفض ${limit} حرفاً في الوثيقة والقاعدة والمواصفة، وفحصُ السحبِ وسلسلةِ الأصولِ يقع قبل فتحِ صفِّ الفعل نصّاً في الكود.`,
);
