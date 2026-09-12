#!/usr/bin/env node
/**
 * حاجزُ التشريع — البوابة التاسعة عشرة في `npm run validate` (الخطوة M8.02).
 *
 * الحاجزُ يفحص **المستودعَ** لا التشغيل: يمنع أن يعود القانونُ نصّاً حرّاً لا
 * يقرؤه قرار، وأن يعود التعارضُ يُحسم بحرف الاسم. وقواعده:
 *
 *   R1: `config/legislation.yaml` يُحمَّل ويجتاز مخطَّطه وفحوصَ تماسكه.
 *   R2: كلُّ بندِ ضمانٍ يقع رمزُه في وحدة إنفاذه — نصّاً حرفياً أو عبر مفتاحه في
 *       `LEGISLATION_ERRORS` (فالكودُ يرفع `LEGISLATION_ERRORS.BINDING_REQUIRED`
 *       لا نصّاً مكرَّراً، ومطالبتُه بتكرار النصّ تُنشئ نسخةً ثانيةً تنحرف).
 *       وكلُّ نوعِ تعارضٍ يقع **اسمُ نوعه** في محرّكه، لأنّ الرمزَ يُقرأ من
 *       الوثيقة نفسِها فوجودُه في المحرّك لا يُثبت شيئاً؛ والذي يُثبت أنّ النوعَ
 *       مكشوفٌ فعلاً هو موضعُ بلاغه باسمه.
 *   R3: كلُّ ملفٍّ في `enforcedBy` موجودٌ في المستودع.
 *   R4: كلُّ رمزٍ في `LEGISLATION_ERRORS` معلَنٌ في الوثيقة (بندَ ضمانٍ أو رمزَ
 *       تحميلٍ `LEGISLATION_CONFIG_INVALID`)، وكلُّ بندٍ في الوثيقة له رمزٌ في
 *       `LEGISLATION_ERRORS`. أي: التقابلُ محروسٌ في **الاتجاهين**، فلا رمزَ في
 *       الكود بلا سندٍ في الوثيقة ولا بندَ في الوثيقة بلا رمزٍ يقع.
 *   R5: فعلُ النفاذ وفعلُ حلِّ التعارض **معلَنان في الموضعين**: عتبةُ
 *       `config/royal-authority.yaml` وكتالوجُ `config/policies.yaml`. (وهذا هو
 *       الخطأ الذي وقع في الخطوة `M8.01` وسُجِّل في `WL-033`.)
 *   R6: `state.laws` يحمل عمودَي الربط (`article_id` و`policy_ids`) في الهجرات،
 *       ومعهما قيدٌ يمنع النفاذَ بلا ربط؛ فربطٌ في الكود بلا قيدٍ في القاعدة
 *       يُلتفُّ عليه بكتابةٍ مباشرة.
 *   R7: نقطةُ الإنفاذ تقرأ حاجزَ التشريع فعلاً (`legislationGate`) وتردّ الرمزَ
 *       `LEGISLATION_CONFLICT_UNRESOLVED`؛ فكشفٌ لا يمنع تقريرٌ لا حاجز.
 *   R8: كلُّ نوعِ حدثٍ في `LEGISLATION_EVENTS` معلَنٌ عقداً في قناة `law` من
 *       `config/events.yaml`.
 *
 * حدٌّ معلَن: الحاجزُ لا يشغّل قاعدةً ولا يتحقّق من أنّ الهجرة 0011 طُبِّقت على
 * قاعدةٍ حقيقية — يقرأ نصَّها في `migrations/`. تطبيقُها يُقاس في بيئةٍ فيها
 * PostgreSQL، وهو مسجَّل في `docs/REMAINING_WORK.md`.
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';
import { LEGISLATION_ERRORS, loadLegislationPolicy } from '../src/legislation/legislation.mjs';
import { LEGISLATION_EVENTS } from '../src/legislation/legislature.mjs';

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

/** @type {import('../src/legislation/legislation.mjs').LegislationPolicy | null} */
let policy = null;

// ═══ R1 ═══
try {
  policy = loadLegislationPolicy({ dir: path.join(ROOT, 'config') });
} catch (error) {
  violations.push(`R1: ${error instanceof Error ? error.message : String(error)}`);
}

if (policy !== null) {
  // ═══ R2 و R3 ═══
  // مفتاحُ كل رمزٍ في `LEGISLATION_ERRORS`، كي يُقبل الاستدعاءُ بالمفتاح لا
  // بتكرار النصّ (انظر R2 في الرأس).
  /** @type {Map<string, string>} */
  const keyOf = new Map(
    Object.entries(LEGISLATION_ERRORS).map(([key, value]) => [String(value), key]),
  );
  /** @type {Array<{ needle: string, shown: string, enforcedBy: readonly string[], label: string }>} */
  const bound = [
    ...policy.guarantees.map((entry) => ({
      needle: entry.code,
      shown: entry.code,
      enforcedBy: entry.enforcedBy,
      label: 'بندُ ضمان',
    })),
    ...policy.conflictKinds.map((entry) => ({
      needle: `'${entry.kind}'`,
      shown: `${entry.code} (النوع ${entry.kind})`,
      enforcedBy: entry.enforcedBy,
      label: 'نوعُ تعارض',
    })),
  ];
  for (const entry of bound) {
    const key = keyOf.get(entry.needle);
    const indirect = key === undefined ? null : `LEGISLATION_ERRORS.${key}`;
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
  declared.add(LEGISLATION_ERRORS.CONFIG_INVALID);
  for (const code of Object.values(LEGISLATION_ERRORS)) {
    if (!declared.has(code)) {
      violations.push(
        `R4: الرمز ${code} يقع في LEGISLATION_ERRORS ولا بندَ ضمانٍ يُعلِنه في config/legislation.yaml.`,
      );
    }
  }
  /** @type {Set<string>} */
  const inCode = new Set(Object.values(LEGISLATION_ERRORS).map((code) => String(code)));
  for (const entry of policy.guarantees) {
    if (!inCode.has(entry.code)) {
      violations.push(
        `R4: بندُ الضمان ${entry.code} معلَنٌ في الوثيقة ولا مقابلَ له في LEGISLATION_ERRORS.`,
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
  for (const action of [policy.binding.enactAction, policy.binding.resolveAction]) {
    if (!thresholdActions.has(action)) {
      violations.push(
        `R5: الفعل ${action} غيرُ معلَنٍ في عتبة config/royal-authority.yaml — فعلٌ تشريعيٌّ بلا عتبةٍ سيادية.`,
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
  for (const needle of ['article_id', 'policy_ids', 'laws_enacted_requires_binding']) {
    if (!migrations.includes(needle)) {
      violations.push(
        `R6: ${needle} غيرُ موجودٍ في الهجرات — ربطٌ في الكود بلا قيدٍ في القاعدة يُلتفُّ عليه بكتابةٍ مباشرة.`,
      );
    }
  }

  // ═══ R7 ═══
  const enforcement = readFile('src/policy/enforcement-point.mjs');
  if (!enforcement.includes('legislationGate')) {
    violations.push('R7: نقطةُ الإنفاذ لا تقرأ حاجزَ التشريع؛ وكشفٌ لا يمنع تقريرٌ لا حاجز.');
  }
  if (!enforcement.includes(LEGISLATION_ERRORS.CONFLICT_UNRESOLVED)) {
    violations.push(
      `R7: نقطةُ الإنفاذ لا تردّ الرمز ${LEGISLATION_ERRORS.CONFLICT_UNRESOLVED}؛ فالمنعُ بلا رمزٍ رفضٌ لا يُفرَز عليه.`,
    );
  }

  // ═══ R9 ═══ وصلُ السلطةِ بالتركيبِ الدائمِ ونفيُ «القضاءينِ».
  //
  // كانت `Legislature` مبنيّةً ومُختبَرةً ولا مسارَ إنتاجيَّ لها: سلطةٌ تكشفُ
  // التعارضَ ولا يقرأُها إنفاذٌ. والقاعدةُ تُثبِّت الوصلَ في موضعينِ لا في وعدٍ:
  // التركيبُ الرسميُّ يبنيها ويُخرِج حاجزَها، والخادمُ الحيُّ يُمرِّرُ الحاجزَ إلى
  // نقطةِ الإنفاذ. وتمنعُ كذلك عودةَ قضاءٍ ثانٍ إلى `src/governance`.
  const composition = readFile('src/persistence/composition.mjs');
  for (const needle of ['new Legislature({', 'legislationGate: enforcementGate(legislature)']) {
    if (!composition.includes(needle)) {
      violations.push(
        `R9: ${needle} غيرُ موجودٍ في src/persistence/composition.mjs — سلطةٌ غيرُ مُركَّبةٍ دائماً تصيرُ سلطةً بلا مسارٍ في التشغيل.`,
      );
    }
  }
  const server = readFile('scripts/serve-state.mjs');
  if (!server.includes('legislationGate: enforcementGate(legislature)')) {
    violations.push(
      'R9: الخادمُ الحيُّ لا يُمرِّرُ حاجزَ التشريعِ إلى نقطةِ الإنفاذ؛ فالكشفُ يبقى تقريراً لا مَنعاً في المسارِ الواقع.',
    );
  }
  const lawSystem = readFile('src/governance/law-system.mjs');
  for (const dead of ['export class Court', 'export const CaseState']) {
    if (lawSystem.includes(dead)) {
      violations.push(
        `R9: ${dead} عادَ إلى src/governance/law-system.mjs — قضاءانِ في المستودعِ يجعلانِ القارئَ لا يعلمُ أيُّهما الحاكم؛ والقضاءُ النافذُ في src/judiciary/.`,
      );
    }
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
  const lawChannel = channels.find((channel) => channel.id === 'law');
  const lawTypes = new Set(
    (Array.isArray(lawChannel?.types)
      ? /** @type {Array<{ type?: unknown }>} */ (lawChannel.types)
      : []
    ).map((entry) => String(entry.type)),
  );
  for (const type of Object.values(LEGISLATION_EVENTS)) {
    if (!lawTypes.has(type)) {
      violations.push(
        `R8: نوعُ الحدث ${type} يُنشر في الكود ولا عقدَ له في قناة law من config/events.yaml.`,
      );
    }
  }
}

if (violations.length > 0) {
  console.error('⛔ حاجز التشريع رفض:');
  for (const violation of violations) console.error(`   • ${violation}`);
  process.exit(1);
}

const kinds = policy ? policy.conflictKinds.length : 0;
const blocking = policy ? policy.conflictKinds.filter((entry) => entry.blocking).length : 0;
const guarantees = policy ? policy.guarantees.length : 0;
console.log(
  `✅ حاجز التشريع: ${kinds} نوعَ تعارضٍ (منها ${blocking} مانعة) و${guarantees} بندَ ضمانٍ مربوطاً برمزِ رفضٍ واقع، وفعلا النفاذ والحلّ معلَنان في العتبة والكتالوج، والقاعدةُ تمنع نفاذاً بلا ربط.`,
);
