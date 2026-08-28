#!/usr/bin/env node
/**
 * حاجزُ نموذجِ التشغيل المؤسسي — البوابةُ الثانيةُ والعشرون في `npm run validate`
 * (الخطوة M8.06).
 *
 * الحاجزُ يفحص **المستودعَ** لا التشغيل: يمنع أن يعود الاختصاصُ فقرةً في وثيقةٍ
 * لا تمنع، وأن يصير «تُمنع وتُسجَّل» رفضاً يُرمى بلا صفِّ مخالفةٍ محفوظ، وأن
 * يصير حدُّ المدّةِ رقماً في وثيقةٍ لا يُسأل عنه أحدٌ قبل القيد. وتِسعُ قواعد:
 *
 *   R1: `config/institutional-mandates.yaml` يُحمَّل ويجتاز مخطَّطَه وفحوصَ
 *       تماسكه — ومنها التقابلُ في الاتجاهين مع عهدِ التشغيل: مؤسسةٌ مُشغَّلةٌ
 *       بلا نموذجٍ تعمل بلا حدّ، ونموذجٌ لمن لا يعمل إعلانٌ لا محلَّ له.
 *   R2: كلُّ بندِ ضمانٍ يقع رمزُه في وحدةِ إنفاذه — نصّاً حرفياً أو عبر مفتاحه
 *       في `MANDATE_ERRORS`.
 *   R3: كلُّ ملفٍّ في `enforcedBy` موجودٌ في المستودع.
 *   R4: التقابلُ محروسٌ في **الاتجاهين** بين `MANDATE_ERRORS` وبنودِ الوثيقة.
 *   R5: الهجراتُ تحمل جداولَ النموذجِ وقيودَها بأسمائها، ومعها **الرقمُ نفسُه**
 *       لحدِّ تفصيلِ المخالفة — مقروءاً في موضعه من القيد لا في أيِّ موضعٍ من
 *       النصّ، ومطابِقاً لثابتِ المواصفات.
 *   R6: المواصفاتُ الثلاثُ مركَّبةٌ في `composition.mjs` و`unit-of-work.mjs`،
 *       ونموذجُ التشغيل نفسُه مُنشَأٌ في `createRegistries` ومُمرَّرٌ إلى
 *       `new InstitutionOperations(`؛ فحدٌّ ككودٍ غيرِ مركَّبٍ حدٌّ لا مسارَ له.
 *   R7: كلُّ نوعِ حدثٍ في `MANDATE_EVENTS` معلَنٌ عقداً في قناة `institutions`.
 *   R8: شروطُ الإجراءِ المُعلَنةُ لازمةٌ فعلاً (`true`)؛ فشرطٌ يُرفع بتغيير حرفٍ
 *       في الوثيقة ليس شرطاً.
 *   R9: توابعُ النموذجِ الخمسةُ موجودةٌ في `src/institutions/mandate.mjs`، وهي
 *       **مستدعاةٌ فعلاً** في `src/institutions/operations.mjs` بالترتيب المُعلَن:
 *       الإجازةُ قبل فتحِ صفِّ المهمّة، وسقفُ المدّةِ قبل قيدِ الميزانية.
 *
 * **حدٌّ معلَن أول:** الحاجزُ لا يشغّل قاعدةً ولا يتحقّق من أنّ الهجرة 0015
 * طُبِّقت على PostgreSQL حقيقيّ — يقرأ نصَّها في `migrations/`. وهو نفسُ الحدِّ
 * المُعلَن في البوابة 21 ومسجَّلٌ في `docs/REMAINING_WORK.md`.
 *
 * **حدٌّ معلَن ثانٍ:** الحاجزُ يحرس **وقوعَ** النداءِ وترتيبَه نصّاً في الملف، لا
 * صحّةَ المنعِ في التشغيل. وصحّةُ المنعِ والتسجيلِ تُثبت في
 * `tests/institutions/mandate.test.mjs` بمؤسسةٍ تتجاوز اختصاصَها فتُمنع ويُقرأ
 * صفُّ مخالفتها.
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';
import {
  MANDATE_ERRORS,
  MANDATE_EVENTS,
  loadMandatesPolicy,
} from '../src/institutions/mandate.mjs';

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

/** @type {import('../src/institutions/mandate.mjs').MandatesPolicy | null} */
let policy = null;

// ═══ R1 ═══
try {
  policy = loadMandatesPolicy({
    dir: path.join(ROOT, 'config'),
    seedDir: path.join(ROOT, 'seed'),
  });
} catch (error) {
  violations.push(`R1: ${error instanceof Error ? error.message : String(error)}`);
}

if (policy !== null) {
  // ═══ R2 و R3 ═══
  /** @type {Map<string, string>} */
  const keyOf = new Map(Object.entries(MANDATE_ERRORS).map(([key, value]) => [String(value), key]));
  for (const entry of policy.guarantees) {
    const key = keyOf.get(entry.code);
    const indirect = key === undefined ? null : `MANDATE_ERRORS.${key}`;
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
  declared.add(MANDATE_ERRORS.CONFIG_INVALID);
  for (const code of Object.values(MANDATE_ERRORS)) {
    if (!declared.has(code)) {
      violations.push(
        `R4: الرمز ${code} يقع في MANDATE_ERRORS ولا بندَ ضمانٍ يُعلِنه في config/institutional-mandates.yaml.`,
      );
    }
  }
  /** @type {Set<string>} */
  const inCode = new Set(Object.values(MANDATE_ERRORS).map((code) => String(code)));
  for (const entry of policy.guarantees) {
    if (!inCode.has(entry.code)) {
      violations.push(
        `R4: بندُ الضمان ${entry.code} معلَنٌ في الوثيقة ولا مقابلَ له في MANDATE_ERRORS.`,
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
    'state.institution_mandates',
    'state.institution_breaches',
    'state.institution_report_cycles',
    'institution_mandates_jurisdiction_declared',
    'institution_mandates_powers_declared',
    'institution_mandates_accountability_external',
    'institution_mandates_periods_positive',
    'institution_mandates_charter_key_unique',
    'institution_breaches_reasoned',
    'institution_breaches_code_declared',
    'institution_breaches_attributed',
    'institution_report_cycles_window_ordered',
    'institution_report_cycles_closed_after_period',
    'institution_report_cycles_counts_coherent',
    'institution_report_cycles_period_unique',
    'institution_tasks_domain_declared',
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
  const detailLimit = String(policy.procedure.minBreachDetailLength);
  if (
    !new RegExp(String.raw`length\(btrim\(detail\)\)\s*>=\s*` + detailLimit + String.raw`\b`).test(
      migrations,
    )
  ) {
    violations.push(
      `R5: قيدُ detail في الهجرات لا يقرأ الحدَّ ${detailLimit} — حدٌّ في الوثيقة وقيدٌ آخرُ في القاعدة شرطان لا شرط.`,
    );
  }
  const entities = readFile('src/persistence/entities.mjs');
  if (
    !new RegExp(
      String.raw`INSTITUTION_MANDATE_MIN_BREACH_DETAIL_LENGTH\s*=\s*` +
        detailLimit +
        String.raw`\b`,
    ).test(entities)
  ) {
    violations.push(
      `R5: INSTITUTION_MANDATE_MIN_BREACH_DETAIL_LENGTH في src/persistence/entities.mjs لا يساوي ${detailLimit} — ثابتُ المستودع الذاكري ينحرف عن الوثيقة.`,
    );
  }

  // ═══ R6 ═══
  const composition = readFile('src/persistence/composition.mjs');
  for (const needle of [
    'INSTITUTION_MANDATE_SPEC',
    'INSTITUTION_BREACH_SPEC',
    'INSTITUTION_REPORT_CYCLE_SPEC',
    'new InstitutionMandate(',
    'loadMandatesPolicy(',
    'repositories.institutionMandates',
    'repositories.institutionBreaches',
    'repositories.institutionReportCycles',
  ]) {
    if (!composition.includes(needle)) {
      violations.push(
        `R6: ${needle} غيرُ موجودٍ في src/persistence/composition.mjs — حدٌّ ككودٍ غيرِ مركَّبٍ حدٌّ لا مسارَ له في التشغيل.`,
      );
    }
  }
  // و`mandate` يُقرأ **حقلاً مُمرَّراً** في كتلةِ إنشاء التشغيل لا مجرَّدَ كلمةٍ
  // في الملف: نموذجٌ مُنشَأٌ ولا يُمرَّر نموذجٌ لا يمنع شيئاً.
  const wiring = composition.match(/new InstitutionOperations\(\{[\s\S]*?\n\s*\}\)/);
  if (wiring === null || !/\bmandate\s*:/.test(wiring[0])) {
    violations.push(
      'R6: `mandate` غيرُ ممرَّرٍ إلى `new InstitutionOperations(` في src/persistence/composition.mjs — مؤسسةٌ تعمل بلا اختصاصٍ يمنع.',
    );
  }
  const unitOfWork = readFile('src/persistence/unit-of-work.mjs');
  for (const needle of [
    'INSTITUTION_MANDATE_SPEC',
    'INSTITUTION_BREACH_SPEC',
    'INSTITUTION_REPORT_CYCLE_SPEC',
  ]) {
    const rx = new RegExp(
      String.raw`createPostgresRepository\(\s*client\s*,\s*` + needle + String.raw`\s*\)`,
    );
    if (!rx.test(unitOfWork)) {
      violations.push(
        `R6: ${needle} غيرُ مربوطٍ بوصلة المعاملة في src/persistence/unit-of-work.mjs — صفُّ مخالفةٍ يُكتب خارج المعاملة ينجو من تراجعها أو يُفقَد معها.`,
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
  const channel = channels.find((entry) => entry.id === 'institutions');
  if (channel === undefined) {
    violations.push(
      'R7: قناةُ institutions غيرُ معلَنةٍ في config/events.yaml — مخالفةُ اختصاصٍ تُنشر بلا عقدٍ ولا قارئ.',
    );
  }
  const types = new Set(
    (Array.isArray(channel?.types)
      ? /** @type {Array<{ type?: unknown }>} */ (channel.types)
      : []
    ).map((entry) => String(entry.type)),
  );
  for (const type of Object.values(MANDATE_EVENTS)) {
    if (!types.has(type)) {
      violations.push(
        `R7: نوعُ الحدث ${type} يُنشر في الكود ولا عقدَ له في قناة institutions من config/events.yaml.`,
      );
    }
  }

  // ═══ R8 ═══
  for (const [name, value] of Object.entries(policy.procedure)) {
    if (typeof value === 'boolean' && value !== true) {
      violations.push(
        `R8: \`procedure.${name}\` ليس true في config/institutional-mandates.yaml — شرطٌ يُرفع بتغيير حرفٍ في الوثيقة ليس شرطاً.`,
      );
    }
  }
  if (policy.mandates.length < 2) {
    violations.push(
      `R8: الوثيقةُ تُعلن ${policy.mandates.length} نموذجاً والخطوةُ M8.06 تشترط نموذجين — نموذجٌ واحدٌ لا يُثبت أنّ مجالَ مؤسسةٍ ممنوعٌ على أخرى.`,
    );
  }
  // ومجالُ كلِّ مؤسسةٍ مُستثنىً عند غيرِها في نموذجٍ واحدٍ على الأقل: نموذجان
  // لا يتقاطع منعُهما لا يُقاس بهما تجاوزُ اختصاص.
  const excludedSomewhere = policy.mandates.some((entry) => entry.jurisdiction.excludes.length > 0);
  if (!excludedSomewhere) {
    violations.push(
      'R8: لا مجالَ مُستثنىً في أيِّ نموذج — واختصاصٌ بلا استثناءٍ صريحٍ لا يُقاس تجاوزُه.',
    );
  }

  // ═══ R9 ═══
  const mandate = readFile('src/institutions/mandate.mjs');
  for (const needle of [
    'async enact(',
    'async authorize(',
    'async assertReportingCurrent(',
    'async assertWithinPeriodCeiling(',
    'async closeCycle(',
  ]) {
    if (!mandate.includes(needle)) {
      violations.push(
        `R9: ${needle} غيرُ موجودٍ في src/institutions/mandate.mjs — وثيقةٌ تُعلن حدّاً بلا تابعٍ ينفّذه وعدٌ.`,
      );
    }
  }
  // والنداءُ يقع **في مسار التشغيل** لا في وحدةٍ جانبية: تابعٌ موجودٌ لا يُستدعى
  // حدٌّ مكتوبٌ لا يمنع. وهذا هو ما التفَّ عليه الاختصاصُ نصّاً في وثيقةٍ قبل
  // هذه الخطوة.
  const operations = readFile('src/institutions/operations.mjs');
  for (const needle of [
    'this.mandate.authorize(',
    'this.mandate.assertReportingCurrent(',
    'this.mandate.assertWithinPeriodCeiling(',
  ]) {
    if (!operations.includes(needle)) {
      violations.push(
        `R9: ${needle} غيرُ مستدعىً في src/institutions/operations.mjs — حدٌّ مكتوبٌ لا يُسأل عنه لا يمنع.`,
      );
    }
  }
  // والترتيبُ نصّاً في الملف هو الشرطُ نفسُه: إجازةٌ بعد فتحِ صفِّ المهمّة تجعل
  // التجاوزَ يقع ثم يُلغى، وسقفٌ يُسأل بعد القيد يُقاس بعد استهلاكه.
  const authorizeAt = operations.indexOf('this.mandate.authorize(');
  const insertAt = operations.indexOf('await this.tasks.insert(');
  if (authorizeAt < 0 || insertAt < 0 || authorizeAt > insertAt) {
    violations.push(
      'R9: الإجازةُ لا تقع قبل فتحِ صفِّ المهمّة في src/institutions/operations.mjs — تجاوزٌ يقع ثم يُلغى تجاوزٌ وقع.',
    );
  }
  const ceilingAt = operations.indexOf('this.mandate.assertWithinPeriodCeiling(');
  const debitAt = operations.indexOf('budgetConsumed: consumed + cost');
  if (ceilingAt < 0 || debitAt < 0 || ceilingAt > debitAt) {
    violations.push(
      'R9: سقفُ المدّةِ لا يُسأل قبل قيدِ الميزانية في src/institutions/operations.mjs — حدٌّ يُقاس بعد استهلاكه ليس حدّاً.',
    );
  }
}

if (violations.length > 0) {
  console.error('⛔ حاجز نموذج التشغيل المؤسسي رفض:');
  for (const violation of violations) console.error(`   • ${violation}`);
  process.exit(1);
}

const guarantees = policy ? policy.guarantees.length : 0;
const mandates = policy ? policy.mandates.length : 0;
const domains = policy
  ? policy.mandates.reduce((total, entry) => total + entry.jurisdiction.domains.length, 0)
  : 0;
const detail = policy ? policy.procedure.minBreachDetailLength : 0;
console.log(
  `✅ حاجز نموذج التشغيل المؤسسي: ${guarantees} بندَ ضمانٍ مربوطاً برمزِ رفضٍ واقع، و${mandates} نموذجاً لكلٍّ مؤسسةٌ مُشغَّلةٌ بمفتاحه، و${domains} مجالَ اختصاصٍ مع مُستثنياتٍ صريحة، وحدُّ تفصيل المخالفة ${detail} حرفاً في الوثيقة والقاعدة والمواصفة، والإجازةُ تقع قبل فتحِ صفِّ المهمّة وسقفُ المدّةِ قبل قيدِ الميزانية نصّاً في الكود.`,
);
