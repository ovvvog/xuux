#!/usr/bin/env node
/**
 * حاجزُ القضاء — البوابة العشرون في `npm run validate` (الخطوة M8.03).
 *
 * الحاجزُ يفحص **المستودعَ** لا التشغيل: يمنع أن يعود القضاءُ سجلّاً في الذاكرة،
 * وأن يعود الحكمُ يصدر بلا سببٍ مكتوب، وأن يصير «تنفيذُ الحكم» عَلَماً يُرفع في
 * عمودٍ بلا أثرٍ مقيس. وقواعده:
 *
 *   R1: `config/judiciary.yaml` يُحمَّل ويجتاز مخطَّطه وفحوصَ تماسكه — ومنها أن
 *       من يحكم ليس من يُنفِّذ.
 *   R2: كلُّ بندِ ضمانٍ يقع رمزُه في وحدة إنفاذه — نصّاً حرفياً أو عبر مفتاحه في
 *       `JUDICIARY_ERRORS`. وكلُّ أثرِ تنفيذٍ يقع **اسمُه** في منفِّذه، لأنّ
 *       الأثرَ يُطلب بالاسم من فهرس المنفِّذين، فوجودُ الاسم في المنفِّذ هو
 *       الدليلُ على أنّ الأثرَ المُعلَن له يدٌ تُحدثه.
 *   R3: كلُّ ملفٍّ في `enforcedBy` موجودٌ في المستودع.
 *   R4: التقابلُ محروسٌ في **الاتجاهين** بين `JUDICIARY_ERRORS` وبنود الوثيقة:
 *       لا رمزَ في الكود بلا سندٍ في الوثيقة، ولا بندَ في الوثيقة بلا رمزٍ يقع.
 *   R5: فعلُ التنفيذ وفعلُ التراجع **معلَنان في الموضعين**: عتبةُ
 *       `config/royal-authority.yaml` وكتالوجُ `config/policies.yaml`. (وهذا هو
 *       الخطأ الذي وقع في الخطوة `M8.01` وسُجِّل في `WL-033`.)
 *   R6: الهجراتُ تحمل أعمدةَ مسار القضية وقيودَه، ومعها **الرقمُ نفسُه** لحدِّ
 *       سبب الحكم المُعلَن في الوثيقة. فحدٌّ في الكود لا يقابله قيدٌ في القاعدة
 *       يُلتفُّ عليه بكتابةٍ مباشرة، وحدّان مختلفان في الموضعين أسوأ من واحد.
 *   R7: `cases` مركَّبٌ في `composition.mjs` و`unit-of-work.mjs`، والقضاءُ نفسُه
 *       مُنشَأٌ في `createRegistries`؛ فسلطةٌ ككودٍ غيرِ مركَّبٍ سلطةٌ لا مسارَ لها.
 *   R8: كلُّ نوعِ حدثٍ في `JUDICIARY_EVENTS` معلَنٌ عقداً في قناة `court` من
 *       `config/events.yaml`.
 *
 * **حدٌّ معلَن أول:** الحاجزُ لا يشغّل قاعدةً ولا يتحقّق من أنّ الهجرة 0012
 * طُبِّقت على قاعدةٍ حقيقية — يقرأ نصَّها في `migrations/`. تطبيقُها يُقاس في
 * بيئةٍ فيها PostgreSQL، وهو مسجَّل في `docs/REMAINING_WORK.md`.
 *
 * **حدٌّ معلَن ثانٍ:** الحاجزُ لا يُثبت أنّ الأثرَ المُنفَّذ صحيحٌ في الواقع، بل
 * أنّ للأثر المُعلَن منفِّذاً مسمّى. وصحّةُ القياس نفسِها تُثبت في
 * `tests/judiciary/court.test.mjs` بمنفِّذٍ يقيس حالةَ هويةٍ حقيقيةً في السجل.
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';
import { JUDICIARY_ERRORS, loadJudiciaryPolicy } from '../src/judiciary/judiciary.mjs';
import { JUDICIARY_EVENTS } from '../src/judiciary/court.mjs';

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

/** @type {import('../src/judiciary/judiciary.mjs').JudiciaryPolicy | null} */
let policy = null;

// ═══ R1 ═══
try {
  policy = loadJudiciaryPolicy({ dir: path.join(ROOT, 'config') });
} catch (error) {
  violations.push(`R1: ${error instanceof Error ? error.message : String(error)}`);
}

if (policy !== null) {
  // ═══ R2 و R3 ═══
  /** @type {Map<string, string>} */
  const keyOf = new Map(
    Object.entries(JUDICIARY_ERRORS).map(([key, value]) => [String(value), key]),
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
      label: 'أثرُ تنفيذ',
    })),
  ];
  for (const entry of bound) {
    const key = keyOf.get(entry.needle);
    const indirect = key === undefined ? null : `JUDICIARY_ERRORS.${key}`;
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
  declared.add(JUDICIARY_ERRORS.CONFIG_INVALID);
  for (const code of Object.values(JUDICIARY_ERRORS)) {
    if (!declared.has(code)) {
      violations.push(
        `R4: الرمز ${code} يقع في JUDICIARY_ERRORS ولا بندَ ضمانٍ يُعلِنه في config/judiciary.yaml.`,
      );
    }
  }
  /** @type {Set<string>} */
  const inCode = new Set(Object.values(JUDICIARY_ERRORS).map((code) => String(code)));
  for (const entry of policy.guarantees) {
    if (!inCode.has(entry.code)) {
      violations.push(
        `R4: بندُ الضمان ${entry.code} معلَنٌ في الوثيقة ولا مقابلَ له في JUDICIARY_ERRORS.`,
      );
    }
  }

  // ═══ R5 ═══
  /** @type {unknown} */
  let authority;
  /** @type {unknown} */
  let policies;
  try {
    authority = YAML.parse(readFile('config/royal-authority.yaml'));
    policies = YAML.parse(readFile('config/policies.yaml'));
  } catch (error) {
    violations.push(`R5: تعذّرت قراءة وثائق الصلاحيات: ${String(error)}`);
  }
  const thresholdActions = new Set(
    (Array.isArray(/** @type {{ threshold?: unknown }} */ (authority)?.threshold)
      ? /** @type {Array<{ action?: unknown }>} */ (
          /** @type {{ threshold: unknown[] }} */ (authority).threshold
        )
      : []
    ).map((entry) => String(entry.action)),
  );
  const catalogActions = new Set(
    (Array.isArray(/** @type {{ actions?: unknown }} */ (policies)?.actions)
      ? /** @type {Array<{ id?: unknown }>} */ (
          /** @type {{ actions: unknown[] }} */ (policies).actions
        )
      : []
    ).map((entry) => String(entry.id)),
  );
  for (const action of [policy.procedure.executeAction, policy.procedure.reverseAction]) {
    if (!thresholdActions.has(action)) {
      violations.push(
        `R5: الفعل ${action} غيرُ معلَنٍ في عتبة config/royal-authority.yaml — تنفيذُ حكمٍ بلا عتبةٍ سيادية.`,
      );
    }
    if (!catalogActions.has(action)) {
      violations.push(
        `R5: الفعل ${action} غيرُ معلَنٍ في كتالوج config/policies.yaml — وهذا عينُ خطأ WL-033.`,
      );
    }
  }

  // ═══ R6 ═══
  const migrations = fs
    .readdirSync(path.join(ROOT, 'migrations'))
    .filter((name) => name.endsWith('.up.sql'))
    .map((name) => readFile(path.join('migrations', name)))
    .join('\n');
  const required = [
    'claimant',
    'claim',
    'judge',
    'reason',
    'judged_at',
    'executed_at',
    'executed_effect',
    'execution_command_id',
    'execution_fingerprint_before',
    'reversed_at',
    'reversal_reason',
    'reversal_command_id',
    'appealed_at',
    'appellant',
    'appeal_reason',
    'cases_judgment_reasoned',
    'cases_judgment_attributed',
    'cases_judge_not_party',
    'cases_execution_needs_judgment',
    'cases_reversal_needs_execution',
    'cases_appeal_needs_judgment',
  ];
  for (const needle of required) {
    if (!migrations.includes(needle)) {
      violations.push(
        `R6: ${needle} غيرُ موجودٍ في الهجرات — قيدٌ في الكود بلا قيدٍ في القاعدة يُلتفُّ عليه بكتابةٍ مباشرة.`,
      );
    }
  }
  // الحدُّ العدديُّ نفسُه في الوثيقة والقاعدة والمواصفة: حدّان مختلفان يجعلان
  // «الحكمَ المُسبَّب» شرطاً مختلفاً حسب طريق الكتابة.
  // ويُقرأ الرقمُ **في موضعه من القيد**، لا في أيّ مكانٍ من النصّ: البحثُ عن
  // «60» مجرَّداً يمرُّ لأنّ الرقمَ يقع في هجرةٍ أخرى أو في تعليق، فيصير الحاجزُ
  // يُصدِّق تطابقاً لم يفحصه. (وهذا عيبٌ وقع في أول صياغةٍ لهذه القاعدة وكُشِف
  // بتزييفٍ مقصودٍ: تغييرُ حدِّ القيد من 60 إلى 40 لم يُسقِط الحاجز.)
  const minReason = String(policy.procedure.minReasonLength);
  const reasonConstraint = new RegExp(
    String.raw`length\(btrim\(reason\)\)\s*>=\s*` + minReason + String.raw`\b`,
  );
  if (!reasonConstraint.test(migrations)) {
    violations.push(
      `R6: قيدُ سبب الحكم في الهجرات لا يقرأ الحدَّ ${minReason} (length(btrim(reason)) >= ${minReason}) — قيدُ القاعدة لا يقرأ config/judiciary.yaml.`,
    );
  }
  const entities = readFile('src/persistence/entities.mjs');
  if (
    !new RegExp(String.raw`JUDGMENT_MIN_REASON_LENGTH\s*=\s*` + minReason + String.raw`\b`).test(
      entities,
    )
  ) {
    violations.push(
      `R6: JUDGMENT_MIN_REASON_LENGTH في src/persistence/entities.mjs لا يساوي ${minReason} — ثابتُ المستودع الذاكري ينحرف عن القاعدة.`,
    );
  }
  const minSecondary = String(policy.procedure.minReversalReasonLength);
  if (policy.procedure.minAppealReasonLength !== policy.procedure.minReversalReasonLength) {
    violations.push(
      'R6: حدُّ سبب الاستئناف وحدُّ سبب التراجع مختلفان في الوثيقة، وقيدُ القاعدة يكتبهما رقماً واحداً — فمن غيَّر أحدَهما كسر الآخر بلا إشعار.',
    );
  }
  for (const column of ['reversal_reason', 'appeal_reason']) {
    const rx = new RegExp(
      String.raw`length\(btrim\(` +
        column +
        String.raw`\)\)\s*>=\s*` +
        minSecondary +
        String.raw`\b`,
    );
    if (!rx.test(migrations)) {
      violations.push(
        `R6: قيدُ ${column} في الهجرات لا يقرأ الحدَّ ${minSecondary} — حدٌّ في الكود بلا قيدٍ في القاعدة يُلتفُّ عليه بكتابةٍ مباشرة.`,
      );
    }
  }
  if (
    !new RegExp(
      String.raw`CASE_MIN_SECONDARY_REASON_LENGTH\s*=\s*` + minSecondary + String.raw`\b`,
    ).test(entities)
  ) {
    violations.push(
      `R6: CASE_MIN_SECONDARY_REASON_LENGTH في src/persistence/entities.mjs لا يساوي ${minSecondary}.`,
    );
  }

  // ═══ R7 ═══
  const composition = readFile('src/persistence/composition.mjs');
  for (const needle of ['CASE_SPEC', 'new Judiciary(', 'repositories.cases']) {
    if (!composition.includes(needle)) {
      violations.push(
        `R7: ${needle} غيرُ موجودٍ في src/persistence/composition.mjs — سلطةٌ ككودٍ غيرِ مركَّبٍ سلطةٌ لا مسارَ لها.`,
      );
    }
  }
  const unitOfWork = readFile('src/persistence/unit-of-work.mjs');
  if (!unitOfWork.includes('CASE_SPEC')) {
    violations.push(
      'R7: مستودعُ القضايا غيرُ مربوطٍ بوصلة المعاملة في src/persistence/unit-of-work.mjs — كتابةٌ خارج المعاملة تنجو من تراجعها.',
    );
  }

  // ═══ R8 ═══
  /** @type {unknown} */
  let events;
  try {
    events = YAML.parse(readFile('config/events.yaml'));
  } catch (error) {
    violations.push(`R8: تعذّرت قراءة config/events.yaml: ${String(error)}`);
  }
  const channels = Array.isArray(/** @type {{ channels?: unknown }} */ (events)?.channels)
    ? /** @type {Array<{ id?: unknown, types?: unknown }>} */ (
        /** @type {{ channels: unknown[] }} */ (events).channels
      )
    : [];
  const courtChannel = channels.find((channel) => channel.id === 'court');
  const courtTypes = new Set(
    (Array.isArray(courtChannel?.types)
      ? /** @type {Array<{ type?: unknown }>} */ (courtChannel.types)
      : []
    ).map((entry) => String(entry.type)),
  );
  for (const type of Object.values(JUDICIARY_EVENTS)) {
    if (!courtTypes.has(type)) {
      violations.push(
        `R8: نوعُ الحدث ${type} يُنشر في الكود ولا عقدَ له في قناة court من config/events.yaml.`,
      );
    }
  }
}

if (violations.length > 0) {
  console.error('⛔ حاجز القضاء رفض:');
  for (const violation of violations) console.error(`   • ${violation}`);
  process.exit(1);
}

const guarantees = policy ? policy.guarantees.length : 0;
const effects = policy ? policy.effects.length : 0;
const minReason = policy ? policy.procedure.minReasonLength : 0;
console.log(
  `✅ حاجز القضاء: ${guarantees} بندَ ضمانٍ مربوطاً برمزِ رفضٍ واقع، و${effects} أثرَ تنفيذٍ لكلٍّ منفِّذٌ مسمّى، وحدُّ سبب الحكم ${minReason} حرفاً في الوثيقة والقاعدة والمواصفة، وفعلا التنفيذ والتراجع معلَنان في العتبة والكتالوج.`,
);
