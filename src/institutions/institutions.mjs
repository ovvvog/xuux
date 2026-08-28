/**
 * عهدُ التشغيل المؤسسي: تحميلُه والتحقّقُ منه ورموزُ رفضه — الخطوة M8.05
 *
 * **العيبُ الذي يُغلقه هذا الملف:** لم يكن في المستودع موضعٌ واحدٌ يقول «ما
 * الذي يصير به الاسمُ في `seed/institutions.yaml` مؤسسةً تعمل». البذرةُ تُعلن
 * 143 مؤسسةً كلُّها `planned`، و`src/registry/loader.mjs` يقيس عدّادَها وتفرُّدَ
 * مساراتها ولا يسأل عن مهمّةٍ ولا وكيلٍ ولا ميزانيةٍ ولا تقرير. فكانت «المؤسسة»
 * صفّاً في ملفٍ لا كياناً له مدخلٌ ومخرَجٌ وحدٌّ مالي.
 *
 * وهذا الملفُّ يقرأ الشرطَ من `config/institutions.yaml`، ويرفض الوثيقةَ
 * المخالفةَ لمخطَّطها أو لتماسكها برمزٍ مُسمّى، **ويقيس سندَ كلِّ مؤسسةٍ
 * مُشغَّلةٍ في البذرة نفسِها** — فلا تُخترع هنا مؤسسةٌ لا وجودَ لها في سجلّ
 * الدولة.
 *
 * ورموزُ الرفض `INSTITUTION_ERRORS` مُقابِلةٌ لبنود الضمان في الوثيقة، وحاجزُ
 * البوابة 21 (`scripts/guard-institutions.mjs`) يحرس التقابلَ في الاتجاهين:
 * لا رمزَ في الكود بلا بندٍ يُعلِنه، ولا بندَ في الوثيقة بلا رمزٍ يقع.
 *
 * **حدٌّ معلَن:** هذا الملفُّ يُحمِّل ويتحقّق ولا يُشغِّل. المسارُ الفعليُّ —
 * استقبالُ المهمّة وإسنادُها وقيدُ الميزانية والتنفيذُ المقيسُ والتقريرُ
 * المشتقّ — في `src/institutions/operations.mjs`.
 */

import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import Ajv2020Default from 'ajv/dist/2020.js';

const Ajv2020 = /** @type {typeof import('ajv/dist/2020.js').Ajv2020} */ (
  /** @type {unknown} */ (Ajv2020Default)
);

/** المجلدُ الافتراضيُّ للوثائق الحاكمة. */
export const DEFAULT_INSTITUTIONS_CONFIG_DIR = path.join(process.cwd(), 'config');

/** مجلدُ البذرة الافتراضي — منه يُقرأ سندُ المؤسسة المُشغَّلة. */
export const DEFAULT_INSTITUTIONS_SEED_DIR = path.join(process.cwd(), 'seed');

/**
 * رموزُ الرفض في مسار التشغيل المؤسسي. كلُّ رمزٍ هنا بندُ ضمانٍ في
 * `config/institutions.yaml`، والبوابةُ 21 تحرس التقابل في الاتجاهين.
 */
export const INSTITUTION_ERRORS = Object.freeze({
  CONFIG_INVALID: 'INSTITUTION_CONFIG_INVALID',
  UNKNOWN: 'INSTITUTION_UNKNOWN',
  SEED_MISSING: 'INSTITUTION_SEED_MISSING',
  NOT_COMMISSIONED: 'INSTITUTION_NOT_COMMISSIONED',
  ALREADY_COMMISSIONED: 'INSTITUTION_ALREADY_COMMISSIONED',
  ROLE_NOT_PERMITTED: 'INSTITUTION_ROLE_NOT_PERMITTED',
  TASK_KIND_NOT_DECLARED: 'INSTITUTION_TASK_KIND_NOT_DECLARED',
  SUBJECT_TOO_SHORT: 'INSTITUTION_SUBJECT_TOO_SHORT',
  TASK_NOT_FOUND: 'INSTITUTION_TASK_NOT_FOUND',
  TASK_STATE_INVALID: 'INSTITUTION_TASK_STATE_INVALID',
  AGENT_NOT_ELIGIBLE: 'INSTITUTION_AGENT_NOT_ELIGIBLE',
  BUDGET_EXHAUSTED: 'INSTITUTION_BUDGET_EXHAUSTED',
  EXECUTION_INEFFECTIVE: 'INSTITUTION_EXECUTION_INEFFECTIVE',
  EFFECT_NOT_REGISTERED: 'INSTITUTION_EFFECT_NOT_REGISTERED',
  REPORT_EMPTY: 'INSTITUTION_REPORT_EMPTY',
});

/** رفضٌ في مسار التشغيل المؤسسي: يحمل رمزَه وتفصيلَه. */
export class InstitutionError extends Error {
  /**
   * @param {string} code
   * @param {string} detail
   */
  constructor(code, detail) {
    super(`${code}: ${detail}`);
    this.name = 'InstitutionError';
    /** @type {string} */
    this.code = code;
    /** @type {string} */
    this.detail = detail;
  }
}

/** @typedef {'submit' | 'assign' | 'execute' | 'report'} InstitutionalAct */

/**
 * @typedef {Readonly<{ role: string, may: readonly InstitutionalAct[], reason: string }>} InstitutionHolder
 */

/**
 * @typedef {Readonly<{
 *   requireSeedInstitution: true,
 *   requireDeclaredTaskKind: true,
 *   requireEligibleAgent: true,
 *   requireBudgetBeforeExecution: true,
 *   requireMeasuredEffect: true,
 *   minSubjectLength: number,
 *   minRefusalReasonLength: number,
 * }>} InstitutionProcedure
 */

/**
 * @typedef {Readonly<{
 *   resource: string,
 *   debitBeforeExecution: true,
 *   refundOnIneffectiveExecution: false,
 * }>} InstitutionBudgetPolicy
 */

/**
 * @typedef {Readonly<{ name: string, statement: string, enforcedBy: readonly string[] }>} InstitutionEffect
 */

/**
 * @typedef {Readonly<{ kind: string, effect: string, cost: number, statement: string }>} InstitutionTaskKind
 */

/**
 * @typedef {Readonly<{
 *   key: string,
 *   seedId: string,
 *   name: string,
 *   agentRoles: readonly string[],
 *   budget: Readonly<{ allocation: number }>,
 *   tasks: readonly InstitutionTaskKind[],
 * }>} InstitutionPilot
 */

/**
 * @typedef {Readonly<{ code: string, statement: string, enforcedBy: readonly string[] }>} InstitutionGuarantee
 */

/**
 * @typedef {Readonly<{
 *   version: number,
 *   holders: readonly InstitutionHolder[],
 *   procedure: InstitutionProcedure,
 *   budget: InstitutionBudgetPolicy,
 *   effects: readonly InstitutionEffect[],
 *   pilots: readonly InstitutionPilot[],
 *   guarantees: readonly InstitutionGuarantee[],
 * }>} InstitutionsPolicy
 */

/**
 * @param {unknown} error
 * @returns {string}
 */
function errorText(error) {
  return error instanceof Error ? error.message : String(error);
}

/**
 * @param {string} detail
 * @returns {never}
 */
function invalidConfig(detail) {
  throw new InstitutionError(INSTITUTION_ERRORS.CONFIG_INVALID, detail);
}

/**
 * معرِّفاتُ المؤسسات في البذرة. تُقرأ من الملفِّ نفسِه الذي يقرؤه
 * `src/registry/loader.mjs`، فلا تُنسَخ القائمةُ هنا ولا تتخلّف عن مصدرها.
 * @param {string} seedDir
 * @returns {Map<string, string>} المعرِّف → الاسم العربي
 */
function seedInstitutions(seedDir) {
  const file = path.join(seedDir, 'institutions.yaml');
  if (!fs.existsSync(file)) {
    throw new InstitutionError(
      INSTITUTION_ERRORS.SEED_MISSING,
      `بذرةُ المؤسسات غائبةٌ في ${file}؛ ومؤسسةٌ بلا سندٍ في سجلّ الدولة لا تُشغَّل.`,
    );
  }
  /** @type {unknown} */
  let raw;
  try {
    raw = YAML.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    throw new InstitutionError(
      INSTITUTION_ERRORS.SEED_MISSING,
      `تعذّرت قراءة بذرة المؤسسات: ${errorText(error)}`,
    );
  }
  const list = /** @type {{ institutions?: unknown }} */ (raw)?.institutions;
  /** @type {Map<string, string>} */
  const found = new Map();
  if (!Array.isArray(list)) return found;
  for (const entry of list) {
    const row = /** @type {Record<string, unknown>} */ (entry);
    const id = row['id'];
    if (typeof id !== 'string') continue;
    found.set(id, typeof row['name_ar'] === 'string' ? row['name_ar'] : '');
  }
  return found;
}

/**
 * يقرأ عهدَ التشغيل المؤسسي ويتحقّق منه مخطَّطاً وتماسكاً وسنداً في البذرة.
 * @param {{ dir?: string, seedDir?: string }} [options]
 * @returns {InstitutionsPolicy}
 */
export function loadInstitutionsPolicy(options = {}) {
  const dir = options.dir ?? DEFAULT_INSTITUTIONS_CONFIG_DIR;
  const schemaDir = fs.existsSync(path.join(dir, 'schemas'))
    ? dir
    : DEFAULT_INSTITUTIONS_CONFIG_DIR;
  const file = path.join(dir, 'institutions.yaml');
  if (!fs.existsSync(file)) {
    invalidConfig(
      'عهدُ التشغيل المؤسسي غائب؛ ودولةٌ بلا شرطٍ معلَنٍ للتشغيل تُشغَّل فيها كلُّ مؤسسةٍ بلا حدّ.',
    );
  }
  /** @type {unknown} */
  let raw;
  try {
    raw = YAML.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    invalidConfig(`تعذّرت قراءة institutions.yaml: ${errorText(error)}`);
  }
  const schemaPath = path.join(schemaDir, 'schemas', 'institutions.schema.json');
  if (!fs.existsSync(schemaPath)) {
    invalidConfig(
      'مخطَّطُ التشغيل المؤسسي غائب؛ وبلا مخطَّطٍ تصير الوثيقةُ نصّاً حرّاً كالذي جاءت لتمنعه.',
    );
  }
  const validate = new Ajv2020({ allErrors: true, strict: false }).compile(
    JSON.parse(fs.readFileSync(schemaPath, 'utf8')),
  );
  if (!validate(raw)) {
    const problems = (validate.errors ?? [])
      .map((entry) => `${entry.instancePath || '/'} ${entry.message ?? ''}`.trim())
      .join(' · ');
    invalidConfig(`institutions.yaml يخالف مخطَّطه: ${problems}`);
  }
  const parsed = /** @type {InstitutionsPolicy} */ (raw);

  // ── فحوصُ تماسكٍ لا يُعبِّر عنها مخطَّط ──

  const guarantees = new Set(parsed.guarantees.map((entry) => entry.code));
  if (guarantees.size !== parsed.guarantees.length) {
    invalidConfig('بندُ ضمانٍ مكرَّرُ الرمز؛ والتكرارُ يجعل الواقعةَ مبهمة.');
  }
  const effects = new Set(parsed.effects.map((entry) => entry.name));
  if (effects.size !== parsed.effects.length) {
    invalidConfig('أثرُ تنفيذٍ مكرَّرُ الاسم؛ والاسمُ هو ما يُطلب به المُنفِّذ.');
  }

  // الفصلُ بين الحاملين: من يرفع المهمّةَ لا يُنفِّذها — وإلا صار الطلبُ
  // والتنفيذُ فعلاً واحداً بلا وسيطٍ يقيسه. ومن يُنفِّذ لا يُقرّ عن نفسه تقريراً.
  const submitters = rolesFor(parsed, 'submit');
  const assigners = rolesFor(parsed, 'assign');
  const executors = rolesFor(parsed, 'execute');
  const reporters = rolesFor(parsed, 'report');
  for (const [set, label] of /** @type {Array<[ReadonlySet<string>, string]>} */ ([
    [submitters, 'رفعِ المهمّة'],
    [assigners, 'إسنادِ المهمّة'],
    [executors, 'تنفيذِ المهمّة'],
    [reporters, 'استخراجِ التقرير'],
  ])) {
    if (set.size === 0) {
      invalidConfig(`لا حاملَ لسلطة ${label} في الوثيقة؛ وسلطةٌ بلا حاملٍ معلَنٍ سلطةٌ لكل أحد.`);
    }
  }
  for (const role of submitters) {
    if (executors.has(role)) {
      invalidConfig(
        `الدور ${role} يرفع المهمّةَ ويُنفِّذها معاً؛ ومن ينفّذ طلبَ نفسه لا وسيطَ يقيسه.`,
      );
    }
  }
  for (const role of executors) {
    if (reporters.has(role)) {
      invalidConfig(`الدور ${role} يُنفِّذ ويُقرّ عن التنفيذ تقريراً؛ ولا يُراجع أحدٌ عملَ نفسه.`);
    }
  }

  // سندُ كلِّ مؤسسةٍ مُشغَّلةٍ في البذرة، وتفرُّدُ مفاتيحها ومعرِّفاتها.
  const seeded = seedInstitutions(options.seedDir ?? DEFAULT_INSTITUTIONS_SEED_DIR);
  /** @type {Set<string>} */
  const keys = new Set();
  /** @type {Set<string>} */
  const seedIds = new Set();
  for (const pilot of parsed.pilots) {
    if (keys.has(pilot.key)) {
      invalidConfig(`مفتاحُ مؤسسةٍ مكرَّر: ${pilot.key}؛ والمفتاحُ هو ما تُنادى به.`);
    }
    keys.add(pilot.key);
    if (seedIds.has(pilot.seedId)) {
      invalidConfig(
        `معرِّفُ بذرةٍ مكرَّر: ${pilot.seedId}؛ ومؤسستان بمعرِّفٍ واحدٍ صفٌّ واحدٌ في القاعدة.`,
      );
    }
    seedIds.add(pilot.seedId);
    if (parsed.procedure.requireSeedInstitution && !seeded.has(pilot.seedId)) {
      throw new InstitutionError(
        INSTITUTION_ERRORS.SEED_MISSING,
        `المؤسسة ${pilot.key} تُحيل إلى المعرِّف ${pilot.seedId} ولا صفَّ له في seed/institutions.yaml.`,
      );
    }
    const seedName = seeded.get(pilot.seedId);
    if (seedName !== undefined && seedName !== '' && seedName !== pilot.name) {
      invalidConfig(
        `اسمُ المؤسسة ${pilot.key} في وثيقة التشغيل يخالف اسمَها في البذرة (${seedName})؛ واسمان لكيانٍ واحدٍ يجعلان التقريرَ يُقرأ على غير مصدره.`,
      );
    }
    /** @type {Set<string>} */
    const kinds = new Set();
    for (const task of pilot.tasks) {
      if (kinds.has(task.kind)) {
        invalidConfig(
          `نوعُ مهمّةٍ مكرَّرٌ في المؤسسة ${pilot.key}: ${task.kind}؛ والنوعُ هو ما تُطلب به الكلفةُ والأثر.`,
        );
      }
      kinds.add(task.kind);
      if (!effects.has(task.effect)) {
        invalidConfig(
          `النوع ${task.kind} في المؤسسة ${pilot.key} يُحيل إلى الأثر ${task.effect} وهو غيرُ معلَنٍ في effects.`,
        );
      }
      // كلفةٌ تتجاوز المُخصَّص تجعل النوعَ غيرَ قابلٍ للتنفيذ أبداً: يُرفض عند
      // كلِّ محاولةٍ برمز نفادِ الميزانية، فيُقرأ العيبُ خطأَ تشغيلٍ لا خطأَ إعلان.
      if (task.cost > pilot.budget.allocation) {
        invalidConfig(
          `كلفةُ النوع ${task.kind} (${task.cost}) تتجاوز مُخصَّصَ المؤسسة ${pilot.key} (${pilot.budget.allocation})؛ ونوعٌ لا يُنفَّذ أبداً إعلانٌ ميّت.`,
        );
      }
    }
  }

  return Object.freeze(parsed);
}

/**
 * الأدوارُ التي تملك فعلاً مؤسسياً بعينه.
 * @param {InstitutionsPolicy} policy
 * @param {InstitutionalAct} act
 * @returns {ReadonlySet<string>}
 */
export function rolesFor(policy, act) {
  return new Set(policy.holders.filter((h) => h.may.includes(act)).map((h) => h.role));
}

/**
 * المؤسسةُ المُشغَّلةُ بمفتاحها، أو رفضٌ برمزٍ مُعلَن.
 * @param {InstitutionsPolicy} policy
 * @param {string} key
 * @returns {InstitutionPilot}
 */
export function pilotOf(policy, key) {
  const found = policy.pilots.find((entry) => entry.key === key);
  if (found === undefined) {
    throw new InstitutionError(
      INSTITUTION_ERRORS.UNKNOWN,
      `لا مؤسسةَ مُشغَّلةً بالمفتاح ${key}؛ والمُشغَّلُ ما أعلنته الوثيقةُ لا ما يُنادى به.`,
    );
  }
  return found;
}

/**
 * نوعُ المهمّة المُعلَن لهذه المؤسسة، أو رفضٌ برمزٍ مُعلَن.
 * @param {InstitutionPilot} pilot
 * @param {string} kind
 * @returns {InstitutionTaskKind}
 */
export function taskKindOf(pilot, kind) {
  const found = pilot.tasks.find((entry) => entry.kind === kind);
  if (found === undefined) {
    throw new InstitutionError(
      INSTITUTION_ERRORS.TASK_KIND_NOT_DECLARED,
      `النوع ${kind} غيرُ معلَنٍ للمؤسسة ${pilot.key}؛ ونوعٌ مفتوحٌ يُلغي معنى الإسناد المؤسسي.`,
    );
  }
  return found;
}
