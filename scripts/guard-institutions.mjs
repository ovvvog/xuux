#!/usr/bin/env node
/**
 * حاجزُ المؤسسات — البوابةُ الحاديةَ والعشرون في `npm run validate` (الخطوة M8.05).
 *
 * الحاجزُ يفحص **المستودعَ** لا التشغيل: يمنع أن تعود المؤسسةُ اسماً في بذرةٍ
 * بلا مهمّةٍ ولا وكيلٍ ولا ميزانيةٍ، وأن يصير «التنفيذُ» عَلَماً يُرفع في عمودٍ
 * بلا أثرٍ مقيس، وأن يصير «نفادُ الميزانية» فحصاً في الكود وحدَه يُلتفُّ عليه
 * بكتابةٍ مباشرةٍ على الجدول. وقواعده:
 *
 *   R1: `config/institutions.yaml` يُحمَّل ويجتاز مخطَّطَه وفحوصَ تماسكه — ومنها
 *       أنّ من يرفع المهمّةَ ليس من يُنفِّذها، وأنّ لكلِّ مؤسسةٍ تجريبيةٍ صفّاً في
 *       `seed/institutions.yaml` باسمها نفسِه.
 *   R2: كلُّ بندِ ضمانٍ يقع رمزُه في وحدةِ إنفاذه — نصّاً حرفياً أو عبر مفتاحه في
 *       `INSTITUTION_ERRORS`. وكلُّ أثرٍ مُعلَنٍ يقع **اسمُه** في منفِّذه، لأنّ
 *       الأثرَ يُطلب بالاسم من فهرس المنفِّذين.
 *   R3: كلُّ ملفٍّ في `enforcedBy` موجودٌ في المستودع.
 *   R4: التقابلُ محروسٌ في **الاتجاهين** بين `INSTITUTION_ERRORS` وبنودِ الوثيقة.
 *   R5: الهجراتُ تحمل أعمدةَ دورةِ التشغيل وقيودَها بأسماءِ ثوابتِ المواصفات
 *       الثلاث، ومعها **الرقمان نفسُهما** لحدِّ الموضوع وحدِّ سبب الرفض — مقروءين
 *       في موضعهما من القيد لا في أيِّ موضعٍ من النصّ.
 *   R6: المواصفاتُ الثلاثُ مركَّبةٌ في `composition.mjs` و`unit-of-work.mjs`،
 *       والتشغيلُ المؤسسيُّ نفسُه مُنشَأٌ في `createRegistries` وسجلُّ الهويات
 *       ممرَّرٌ إليه؛ فمؤسسةٌ ككودٍ غيرِ مركَّبٍ مؤسسةٌ لا مسارَ لها.
 *   R7: كلُّ نوعِ حدثٍ في `INSTITUTION_EVENTS` معلَنٌ عقداً في قناة `institutions`
 *       من `config/events.yaml`، والقناةُ نفسُها معلَنة.
 *   R8: شروطُ الإجراءِ المُعلَنةُ لازمةٌ فعلاً (`true`)، وقيدُ الميزانيةِ قبل
 *       التنفيذِ مُعلَن؛ فشرطٌ يُرفع بتغيير حرفٍ في الوثيقة ليس شرطاً.
 *   R9: توابعُ الدورةِ الخمسةُ موجودةٌ في `src/institutions/operations.mjs`، وفيه
 *       قياسُ الأثرِ ببصمتين ورفضُ التنفيذِ غيرِ المؤثِّر.
 *
 * **حدٌّ معلَن أول:** الحاجزُ لا يشغّل قاعدةً ولا يتحقّق من أنّ الهجرة 0014
 * طُبِّقت على PostgreSQL حقيقيّ — يقرأ نصَّها في `migrations/`. وهو مسجَّلٌ في
 * `docs/REMAINING_WORK.md`.
 *
 * **حدٌّ معلَن ثانٍ:** الحاجزُ لا يُثبت أنّ المخرَجَ صحيحٌ في الواقع، بل أنّ
 * للأثرِ المُعلَنِ منفِّذاً مسمّى. وصحّةُ القياس نفسِها تُثبت في
 * `tests/institutions/operations.test.mjs` بمنفِّذٍ يزعم الإنتاجَ ولا يكتب شيئاً.
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';
import { INSTITUTION_ERRORS, loadInstitutionsPolicy } from '../src/institutions/institutions.mjs';
import { INSTITUTION_EVENTS } from '../src/institutions/operations.mjs';

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

/** @type {import('../src/institutions/institutions.mjs').InstitutionsPolicy | null} */
let policy = null;

// ═══ R1 ═══
try {
  policy = loadInstitutionsPolicy({
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
    Object.entries(INSTITUTION_ERRORS).map(([key, value]) => [String(value), key]),
  );
  /** @type {Array<{ needle: string, shown: string, enforcedBy: readonly string[], label: string }>} */
  const bound = [
    ...policy.guarantees.map((entry) => ({
      needle: entry.code,
      shown: entry.code,
      enforcedBy: entry.enforcedBy,
      label: 'بندُ ضمان',
    })),
    ...policy.effects.map((entry) => ({
      needle: `'${entry.name}'`,
      shown: `الأثر ${entry.name}`,
      enforcedBy: entry.enforcedBy,
      label: 'أثرٌ مُعلَن',
    })),
  ];
  for (const entry of bound) {
    const key = keyOf.get(entry.needle);
    const indirect = key === undefined ? null : `INSTITUTION_ERRORS.${key}`;
    let seen = false;
    for (const holder of entry.enforcedBy) {
      const source = readFile(holder);
      if (source === '') {
        violations.push(`R3: ${entry.label} ${entry.shown} يُحيل إلى ${holder} وهو غير موجود.`);
        continue;
      }
      if (source.includes(entry.needle)) seen = true;
      if (indirect !== null && source.includes(indirect)) seen = true;
    }
    if (!seen) {
      violations.push(
        `R2: ${entry.label} ${entry.shown} لا يقع في أيٍّ من وحدات إنفاذه (${entry.enforcedBy.join('، ')}) — وعدٌ لا ضمان.`,
      );
    }
  }

  // ═══ R4 ═══
  /** @type {Set<string>} */
  const declared = new Set(policy.guarantees.map((entry) => String(entry.code)));
  declared.add(INSTITUTION_ERRORS.CONFIG_INVALID);
  for (const code of Object.values(INSTITUTION_ERRORS)) {
    if (!declared.has(code)) {
      violations.push(
        `R4: الرمز ${code} يقع في INSTITUTION_ERRORS ولا بندَ ضمانٍ يُعلِنه في config/institutions.yaml.`,
      );
    }
  }
  /** @type {Set<string>} */
  const inCode = new Set(Object.values(INSTITUTION_ERRORS).map((code) => String(code)));
  for (const entry of policy.guarantees) {
    if (!inCode.has(entry.code)) {
      violations.push(
        `R4: بندُ الضمان ${entry.code} معلَنٌ في الوثيقة ولا مقابلَ له في INSTITUTION_ERRORS.`,
      );
    }
  }

  // ═══ R5 ═══
  const migrations = fs
    .readdirSync(path.join(ROOT, 'migrations'))
    .filter((name) => name.endsWith('.up.sql'))
    .map((name) => readFile(path.join('migrations', name)))
    .join('\n');
  // أسماءُ القيود هي أسماءُ ثوابتِ المواصفات مُصغَّرةً: قيدٌ في المستودع الذاكري
  // بلا نظيرٍ في القاعدة يُلتَفُّ عليه بكتابةٍ مباشرةٍ على الجدول.
  const required = [
    'state.institutions',
    'state.institution_tasks',
    'state.institution_outputs',
    'charter_key',
    'budget_allocated',
    'budget_consumed',
    'budget_cost',
    'budget_debited_at',
    'fingerprint_before',
    'fingerprint_after',
    'refusal_code',
    'refusal_reason',
    'institutions_budget_not_overdrawn',
    'institutions_allocation_positive',
    'institutions_roles_declared',
    'institution_tasks_subject_measured',
    'institution_tasks_cost_positive',
    'institution_tasks_assignment_complete',
    'institution_tasks_budget_before_execution',
    'institution_tasks_execution_measured',
    'institution_tasks_refusal_reasoned',
    'institution_tasks_state_matches_timeline',
    'institution_outputs_attributed',
  ];
  for (const needle of required) {
    if (!migrations.includes(needle)) {
      violations.push(
        `R5: ${needle} غيرُ موجودٍ في الهجرات — قيدٌ في الكود بلا قيدٍ في القاعدة يُلتفُّ عليه بكتابةٍ مباشرة.`,
      );
    }
  }
  // والرقمُ يُقرأ **في موضعه من القيد** لا في أيِّ موضعٍ من النصّ: البحثُ عن «20»
  // مجرَّداً يمرُّ لأنّ الرقمَ يقع في هجرةٍ أخرى أو في تعليق، فيصير الحاجزُ
  // يُصدِّق تطابقاً لم يفحصه — وهو عيبٌ وقع مرّتين في هذا المستودع.
  const entities = readFile('src/persistence/entities.mjs');
  const limits = [
    {
      column: 'subject',
      limit: String(policy.procedure.minSubjectLength),
      constant: 'INSTITUTION_MIN_SUBJECT_LENGTH',
    },
    {
      column: 'refusal_reason',
      limit: String(policy.procedure.minRefusalReasonLength),
      constant: 'INSTITUTION_MIN_REFUSAL_REASON_LENGTH',
    },
  ];
  for (const { column, limit, constant } of limits) {
    const inMigration = new RegExp(
      String.raw`length\(btrim\(` + column + String.raw`\)\)\s*>=\s*` + limit + String.raw`\b`,
    );
    if (!inMigration.test(migrations)) {
      violations.push(
        `R5: قيدُ ${column} في الهجرات لا يقرأ الحدَّ ${limit} — حدٌّ في الوثيقة وقيدٌ آخرُ في القاعدة شرطان لا شرط.`,
      );
    }
    if (!new RegExp(constant + String.raw`\s*=\s*` + limit + String.raw`\b`).test(entities)) {
      violations.push(
        `R5: ${constant} في src/persistence/entities.mjs لا يساوي ${limit} — ثابتُ المستودع الذاكري ينحرف عن الوثيقة.`,
      );
    }
  }
  // وكلفةُ كلِّ نوعِ مهمّةٍ لا تتجاوز مُخصَّصَ مؤسستها: مهمّةٌ أغلى من المُخصَّص
  // كلِّه تُرفض دائماً، فيصير النوعُ معلَناً ولا يُنفَّذ مرّةً واحدة.
  for (const pilot of policy.pilots) {
    for (const task of pilot.tasks) {
      if (task.cost > pilot.budget.allocation) {
        violations.push(
          `R5: كلفةُ النوع ${task.kind} (${task.cost}) تتجاوز مُخصَّصَ ${pilot.key} (${pilot.budget.allocation}) — نوعٌ معلَنٌ لا يُنفَّذ مرّةً واحدة.`,
        );
      }
    }
  }

  // ═══ R6 ═══
  const composition = readFile('src/persistence/composition.mjs');
  for (const needle of [
    'INSTITUTION_SPEC',
    'INSTITUTION_TASK_SPEC',
    'INSTITUTION_OUTPUT_SPEC',
    'new InstitutionOperations(',
    'repositories.institutions',
    'repositories.institutionTasks',
    'repositories.institutionOutputs',
  ]) {
    if (!composition.includes(needle)) {
      violations.push(
        `R6: ${needle} غيرُ موجودٍ في src/persistence/composition.mjs — مؤسسةٌ ككودٍ غيرِ مركَّبٍ مؤسسةٌ لا مسارَ لها في التشغيل.`,
      );
    }
  }
  // و`agents` يُقرأ **حقلاً مُمرَّراً** في كتلةِ الإنشاء لا مجرَّدَ كلمةٍ في
  // الملف: كلمةُ `agents` تقع في الملف مراتٍ كثيرة، فبحثٌ عن الكلمة يمرُّ ولو
  // نُزع الحقلُ فصار الإسنادُ اسماً في عمودٍ بلا أهليّةٍ مقروءة.
  const wiring = composition.match(/new InstitutionOperations\(\{[\s\S]*?\n\s*\}\)/);
  if (wiring === null || !/\bagents\s*[,:]/.test(wiring[0])) {
    violations.push(
      'R6: `agents` غيرُ ممرَّرٍ إلى `new InstitutionOperations(` في src/persistence/composition.mjs — إسنادٌ بلا سجلِّ هوياتٍ مركَّبٍ إسنادٌ بلا أهليّة.',
    );
  }
  if (wiring !== null && !/\beffects\s*:/.test(wiring[0])) {
    violations.push(
      'R6: فهرسُ المنفِّذين غيرُ ممرَّرٍ إلى `new InstitutionOperations(` — أثرٌ بلا يدٍ تُحدثه.',
    );
  }
  // والمواصفةُ تُقرأ **في موضعِ إنشاء المستودع** لا في أيِّ موضعٍ من الملف:
  // اسمُ المواصفة يقع في كتلةِ الاستيراد أيضاً، فبحثٌ عن الاسم يمرُّ ولو نُزع
  // إنشاءُ المستودع نفسُه فصارت الكتابةُ تقع خارج المعاملة. (عيبٌ كشفه مسبارُ
  // تزييفٍ مقصود: نزعُ سطرِ الإنشاء لم يُسقِط الحاجز في أول صياغة.)
  const unitOfWork = readFile('src/persistence/unit-of-work.mjs');
  for (const needle of ['INSTITUTION_SPEC', 'INSTITUTION_TASK_SPEC', 'INSTITUTION_OUTPUT_SPEC']) {
    const rx = new RegExp(
      String.raw`createPostgresRepository\(\s*client\s*,\s*` + needle + String.raw`\s*\)`,
    );
    if (!rx.test(unitOfWork)) {
      violations.push(
        `R6: ${needle} غيرُ مربوطٍ بوصلة المعاملة في src/persistence/unit-of-work.mjs — كتابةٌ خارج المعاملة تنجو من تراجعها.`,
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
      'R7: قناةُ institutions غيرُ معلَنةٍ في config/events.yaml — حوادثُ التشغيل تُنشر بلا عقدٍ ولا تصنيفٍ ولا قارئ.',
    );
  }
  const types = new Set(
    (Array.isArray(channel?.types)
      ? /** @type {Array<{ type?: unknown }>} */ (channel.types)
      : []
    ).map((entry) => String(entry.type)),
  );
  for (const type of Object.values(INSTITUTION_EVENTS)) {
    if (!types.has(type)) {
      violations.push(
        `R7: نوعُ الحدث ${type} يُنشر في الكود ولا عقدَ له في قناة institutions من config/events.yaml.`,
      );
    }
  }

  // ═══ R8 ═══
  // شرطٌ مُعلَنٌ غيرُ لازمٍ ليس شرطاً: يُرفع بتغيير حرفٍ في الوثيقة بلا أن يسقط
  // اختبارٌ واحد. فاللزومُ نفسُه محروسٌ هنا.
  for (const [name, value] of Object.entries(policy.procedure)) {
    if (typeof value === 'boolean' && value !== true) {
      violations.push(
        `R8: \`procedure.${name}\` ليس true في config/institutions.yaml — شرطٌ يُرفع بتغيير حرفٍ في الوثيقة ليس شرطاً.`,
      );
    }
  }
  if (policy.budget.debitBeforeExecution !== true) {
    violations.push(
      'R8: `budget.debitBeforeExecution` ليس true — وقيدٌ بعد التنفيذ يسمح بتجاوزِ الحدِّ مرّةً واحدةً، وهي المرّةُ التي تهمّ.',
    );
  }
  if (policy.pilots.length < 2) {
    violations.push(
      `R8: العهدُ يُعلن ${policy.pilots.length} مؤسسةً تجريبيةً والخطوةُ M8.05 تشترط مؤسستين — دورةٌ واحدةٌ لا تُثبت أنّ المؤسستين مستقلّتان.`,
    );
  }

  // ═══ R9 ═══
  const operations = readFile('src/institutions/operations.mjs');
  for (const needle of [
    'async commission(',
    'async submit(',
    'async assign(',
    'async execute(',
    'async report(',
  ]) {
    if (!operations.includes(needle)) {
      violations.push(
        `R9: ${needle} غيرُ موجودٍ في src/institutions/operations.mjs — عهدٌ يُعلن دورةَ تشغيلٍ بلا تابعٍ ينفّذها وعدٌ.`,
      );
    }
  }
  // وقياسُ الأثر يقع **قبلَ الإنتاجِ وبعده** ويُقارَن: مقارنةٌ غائبةٌ تجعل
  // «منفَّذ» عَلَماً يُرفع بنجاحِ النداء لا واقعةً في البيانات.
  if (!/const before = await executor\.fingerprint\(/.test(operations)) {
    violations.push(
      'R9: بصمةُ ما قبلَ التنفيذِ غيرُ مقروءةٍ في src/institutions/operations.mjs — أثرٌ بلا قياسٍ قبليٍّ لا يُقاس.',
    );
  }
  if (!/if \(before === after\)/.test(operations)) {
    violations.push(
      'R9: مقارنةُ البصمتين غائبةٌ في src/institutions/operations.mjs — تنفيذٌ بلا أثرٍ يُسجَّل منفَّذاً.',
    );
  }
  // والقيدُ يقع قبل الإنتاج نصّاً في الملف: ترتيبُ السطرين هو الشرطُ نفسُه، لا
  // تعليقاً فوقه. فقيدٌ بعد الإنتاج يجعل الحدَّ يُقاس بعد استهلاكه.
  const debitAt = operations.indexOf('budgetConsumed: consumed + cost');
  const produceAt = operations.indexOf('await executor.produce(');
  if (debitAt < 0 || produceAt < 0 || debitAt > produceAt) {
    violations.push(
      'R9: قيدُ الميزانية لا يقع قبل الإنتاج في src/institutions/operations.mjs — والوثيقةُ تُعلن `budget.debitBeforeExecution: true`.',
    );
  }
}

if (violations.length > 0) {
  console.error('⛔ حاجز المؤسسات رفض:');
  for (const violation of violations) console.error(`   • ${violation}`);
  process.exit(1);
}

const guarantees = policy ? policy.guarantees.length : 0;
const effects = policy ? policy.effects.length : 0;
const pilots = policy ? policy.pilots.length : 0;
const minSubject = policy ? policy.procedure.minSubjectLength : 0;
console.log(
  `✅ حاجز المؤسسات: ${guarantees} بندَ ضمانٍ مربوطاً برمزِ رفضٍ واقع، و${effects} أثراً لكلٍّ منفِّذٌ مسمّى، و${pilots} مؤسسةً تجريبيةً لكلٍّ صفٌّ في البذرة ومُخصَّصٌ يحمل مهامَّها، وحدُّ الموضوع ${minSubject} حرفاً في الوثيقة والقاعدة والمواصفة، والميزانيةُ تُقيَّد قبل الإنتاج نصّاً في الكود، ودورةُ التشغيل مركَّبةٌ على مستودعاتٍ وسجلِّ هويات.`,
);
