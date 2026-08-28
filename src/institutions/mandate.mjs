/**
 * نموذجُ التشغيل المؤسسي النافذ: اختصاصٌ وصلاحياتٌ وسقفُ مدّةٍ ومساءلةٌ ودورةٌ
 * تقريريةٌ — كلُّها بياناتٌ تُقرأ وتُقاس، لا نصٌّ يُقرأ — الخطوة M8.06
 *
 * **العيبُ الذي يُغلقه هذا الملف:** أغلقت `M8.05` دورةَ التشغيل وأعلنت حدَّها
 * صريحاً: أنواعُ المهامِّ المُعلَنةُ لكلِّ مؤسسةٍ **أضيقُ من الاختصاص** ولا
 * تُدَّعى أنّها هو. فكانت المؤسسةُ تعمل ولا شيءَ في المستودع يقول ما لها أن
 * تعمل فيه: لا مجالَ محكوماً، ولا صلاحيةً مسمّاةً تُمنح وتُحجب، ولا جهةَ تُسأل
 * أمامها، ولا سقفَ صرفٍ في مدّة، ولا موعدَ تقريرٍ يُقاس تأخُّرُه. وكان
 * «الاختصاصُ» فقرةً في `docs/INSTITUTIONAL_OPERATING_MODEL.md` لا تمنع فعلاً.
 *
 * والحدُّ هنا يقع في **مسار التشغيل نفسِه** لا في وحدةٍ جانبيةٍ تُستدعى إن
 * أُريد: `InstitutionOperations` تُنشأ بنموذجٍ لازمٍ لا اختياري، فمهمّةٌ ترتفع
 * إلى مؤسسةٍ بمجالٍ خارجِ اختصاصها **تُمنع قبل أن يُفتح لها صفٌّ** ويُسجَّل
 * تجاوزُها صفَّ مخالفةٍ منسوباً إلى جهةِ مساءلتها وجهةِ تصعيدها.
 *
 * والخمسةُ محكومةٌ ببياناتٍ في `config/institutional-mandates.yaml`:
 *
 *   1. **الاختصاص** — مجالاتٌ مُعلَنةٌ ومُستثنياتٌ صريحة. والمهمّةُ تُعلن مجالَها
 *      ويُحفظ في صفِّها: مجالٌ يُستنبَط من نوع المهمّة لا يُقاس تجاوزُه.
 *   2. **الصلاحيات** — منحٌ بالاسم ومحرَّماتٌ بالاسم، والمحرَّمُ يغلب الممنوح.
 *   3. **الميزانية** — سقفُ صرفٍ في مدّةٍ معلومة فوق المُخصَّص الكلّي: مُخصَّصٌ
 *      بلا سقفٍ زمنيٍّ يُستهلَك كلُّه في يوم.
 *   4. **المساءلة** — جهةٌ تُسأل أمامها وجهةُ تصعيد، وكلتاهما من خارج أدوارِ
 *      وكلاء المؤسسة (محروسٌ عند التحميل): لا يُسائل أحدٌ نفسَه.
 *   5. **التقارير الدورية** — مدّةٌ ومهلةُ سماح، وبعدهما يوقف التأخُّرُ قبولَ
 *      المهامِّ الجديدةِ ويُسجَّل مخالفة.
 *
 * **وحدٌّ معلَن أول:** سقفُ المدّة يُحسب بجمعِ كلفِ المهامِّ التي قُيِّدت
 * ميزانيتُها في المدّة من `state.institution_tasks`، لا من دفترِ حصصٍ ذرّيّ.
 * فمحاولتان متزامنتان قد تقرآن المجموعَ نفسَه وتمرّان معاً على السقف الزمني —
 * والذرّيةُ المضمونةُ ذرّيةُ المُخصَّصِ الكلّيِّ وحدَها (تحديثٌ متفائلٌ على
 * `version`). وهو **نفسُ الحدِّ** المُعلَن في `M8.05` ومسجَّلٌ في
 * `docs/REMAINING_WORK.md`.
 *
 * **وحدٌّ معلَن ثانٍ:** الاختصاصُ هنا **ثابتٌ مُنفَذٌ مرّةً** من وثيقةٍ محكومة،
 * لا مُفوَّضٌ ولا مسحوب. ونقلُ الاختصاصِ بأمرٍ ملكيٍّ وسحبُه نصُّ `M8.08`،
 * والإقليمُ والولايةُ والبلديةُ نصُّ `M8.07`، فلا يُدَّعى أيٌّ منهما هنا.
 *
 * **وحدٌّ معلَن ثالث:** المخالفةُ تُسجَّل ولا تُعالَج: لا مسارَ تسويةٍ ولا
 * إغلاقَ مخالفةٍ ولا جزاءَ يقع على المؤسسة. والمساءلةُ المُنفَّذةُ هي **نسبةُ
 * المخالفةِ إلى جهةٍ مسمّاةٍ وقيدُها في صفٍّ يُقرأ في الدورة**، وذلك أضعفُ من
 * مساءلةٍ كاملةٍ ولا يُدَّعى أنّه هي.
 */

import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import Ajv2020Default from 'ajv/dist/2020.js';
import {
  DEFAULT_INSTITUTIONS_CONFIG_DIR,
  DEFAULT_INSTITUTIONS_SEED_DIR,
  INSTITUTION_ERRORS,
  InstitutionError,
  loadInstitutionsPolicy,
} from './institutions.mjs';

const Ajv2020 = /** @type {typeof import('ajv/dist/2020.js').Ajv2020} */ (
  /** @type {unknown} */ (Ajv2020Default)
);

/** مليّةُ اليوم بالمللي ثانية — تُحسب بها المدّةُ ومهلةُ السماح. */
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * رموزُ الرفض في نموذج التشغيل المؤسسي. كلُّ رمزٍ هنا بندُ ضمانٍ في
 * `config/institutional-mandates.yaml`، والبوابةُ 22 تحرس التقابل في الاتجاهين.
 */
export const MANDATE_ERRORS = Object.freeze({
  CONFIG_INVALID: 'MANDATE_CONFIG_INVALID',
  UNKNOWN: 'MANDATE_UNKNOWN',
  NOT_ENACTED: 'MANDATE_NOT_ENACTED',
  ALREADY_ENACTED: 'MANDATE_ALREADY_ENACTED',
  ROLE_NOT_PERMITTED: 'MANDATE_ROLE_NOT_PERMITTED',
  DOMAIN_NOT_DECLARED: 'MANDATE_DOMAIN_NOT_DECLARED',
  OUT_OF_JURISDICTION: 'MANDATE_OUT_OF_JURISDICTION',
  ACT_DOMAIN_MISMATCH: 'MANDATE_ACT_DOMAIN_MISMATCH',
  POWER_NOT_GRANTED: 'MANDATE_POWER_NOT_GRANTED',
  ACT_PROHIBITED: 'MANDATE_ACT_PROHIBITED',
  PERIOD_CEILING_EXCEEDED: 'MANDATE_PERIOD_CEILING_EXCEEDED',
  REPORTING_OVERDUE: 'MANDATE_REPORTING_OVERDUE',
  CYCLE_NOT_DUE: 'MANDATE_CYCLE_NOT_DUE',
  CYCLE_ALREADY_CLOSED: 'MANDATE_CYCLE_ALREADY_CLOSED',
});

/** أنواعُ حوادثِ نموذج التشغيل. وكلُّ نوعٍ عقدٌ في قناة `institutions`. */
// ومواضعُ النشر تكتب النوعَ **نصّاً حرفياً** لا `MANDATE_EVENTS.X`: حاجزُ القنوات
// يقرأ الوسيطَ الأول من شجرة الإعراب لا من قيمةٍ تُحلّ بالتشغيل، فمرجعٌ رمزيٌّ
// هناك يجعل العقدَ بلا موضعِ نشرٍ في القياس. والتقابلُ بين هذا السجلِّ والعقود
// تحرسه البوابةُ 22.
export const MANDATE_EVENTS = Object.freeze({
  ENACTED: 'institutions.mandate.enacted',
  EXCEEDED: 'institutions.mandate.exceeded',
  CYCLE_CLOSED: 'institutions.report.cycle.closed',
});

/** رفضٌ في نموذج التشغيل المؤسسي: يحمل رمزَه وتفصيلَه. */
export class MandateError extends Error {
  /**
   * @param {string} code
   * @param {string} detail
   */
  constructor(code, detail) {
    super(`${code}: ${detail}`);
    this.name = 'MandateError';
    /** @type {string} */
    this.code = code;
    /** @type {string} */
    this.detail = detail;
  }
}

/**
 * @typedef {Readonly<{ kind: string, domain: string, power: string }>} MandateAct
 */

/**
 * @typedef {Readonly<{
 *   key: string,
 *   jurisdiction: Readonly<{ domains: readonly string[], excludes: readonly string[], statement: string }>,
 *   powers: readonly string[],
 *   prohibitions: readonly string[],
 *   acts: readonly MandateAct[],
 *   budget: Readonly<{ periodDays: number, ceiling: number }>,
 *   accountability: Readonly<{ accountableTo: string, escalateTo: string, statement: string }>,
 *   reporting: Readonly<{ periodDays: number, graceDays: number }>,
 * }>} InstitutionMandateEntry
 */

/**
 * @typedef {Readonly<{
 *   version: number,
 *   acts: Readonly<{ enact: string, closeCycle: string }>,
 *   procedure: Readonly<{
 *     requireEnactedMandate: true,
 *     requireDeclaredDomain: true,
 *     requireGrantedPower: true,
 *     recordBreach: true,
 *     enforcePeriodCeiling: true,
 *     blockOverdueReporting: true,
 *     minBreachDetailLength: number,
 *   }>,
 *   mandates: readonly InstitutionMandateEntry[],
 *   guarantees: readonly Readonly<{ code: string, statement: string, enforcedBy: readonly string[] }>[],
 * }>} MandatesPolicy
 */

/**
 * @param {string} detail
 * @returns {never}
 */
function invalidConfig(detail) {
  throw new MandateError(MANDATE_ERRORS.CONFIG_INVALID, detail);
}

/**
 * يقرأ نموذجَ التشغيل المؤسسي ويتحقّق منه مخطَّطاً وتماسكاً **ومقابلةً بعهد
 * التشغيل**: مؤسسةٌ مُشغَّلةٌ بلا نموذجٍ مؤسسةٌ بلا حدّ، ونموذجٌ لمؤسسةٍ غيرِ
 * مُشغَّلةٍ إعلانٌ لا محلَّ له.
 * @param {{ dir?: string, seedDir?: string, institutions?: import('./institutions.mjs').InstitutionsPolicy }} [options]
 * @returns {MandatesPolicy}
 */
export function loadMandatesPolicy(options = {}) {
  const dir = options.dir ?? DEFAULT_INSTITUTIONS_CONFIG_DIR;
  const schemaDir = fs.existsSync(path.join(dir, 'schemas'))
    ? dir
    : DEFAULT_INSTITUTIONS_CONFIG_DIR;
  const file = path.join(dir, 'institutional-mandates.yaml');
  if (!fs.existsSync(file)) {
    invalidConfig(
      'نموذجُ التشغيل المؤسسي غائب؛ ومؤسسةٌ تعمل بلا اختصاصٍ معلَنٍ حدُّها حدُّ من يستدعيها.',
    );
  }
  /** @type {unknown} */
  let raw;
  try {
    raw = YAML.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    invalidConfig(
      `تعذّرت قراءة institutional-mandates.yaml: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const schemaPath = path.join(schemaDir, 'schemas', 'institutional-mandates.schema.json');
  if (!fs.existsSync(schemaPath)) {
    invalidConfig(
      'مخطَّطُ نموذجِ التشغيل غائب؛ وبلا مخطَّطٍ يصير الاختصاصُ نصّاً حرّاً كالذي جاء ليمنعه.',
    );
  }
  const validate = new Ajv2020({ allErrors: true, strict: false }).compile(
    JSON.parse(fs.readFileSync(schemaPath, 'utf8')),
  );
  if (!validate(raw)) {
    const problems = (validate.errors ?? [])
      .map((entry) => `${entry.instancePath || '/'} ${entry.message ?? ''}`.trim())
      .join(' · ');
    invalidConfig(`institutional-mandates.yaml يخالف مخطَّطه: ${problems}`);
  }
  const parsed = /** @type {MandatesPolicy} */ (raw);

  // ── فحوصُ تماسكٍ لا يُعبِّر عنها مخطَّط ──

  const guarantees = new Set(parsed.guarantees.map((entry) => entry.code));
  if (guarantees.size !== parsed.guarantees.length) {
    invalidConfig('بندُ ضمانٍ مكرَّرُ الرمز؛ والتكرارُ يجعل الواقعةَ مبهمة.');
  }
  if (parsed.acts.enact === parsed.acts.closeCycle) {
    invalidConfig(
      `الدور ${parsed.acts.enact} يُنفِذ الاختصاصَ ويُغلق الدورةَ التقريريةَ معاً؛ ومن يُوسِّع الحدَّ لا يُقرّ تقريرَ من يعمل تحته.`,
    );
  }

  const institutions =
    options.institutions ??
    loadInstitutionsPolicy({ dir, seedDir: options.seedDir ?? DEFAULT_INSTITUTIONS_SEED_DIR });
  /** @type {Set<string>} */
  const seen = new Set();
  for (const mandate of parsed.mandates) {
    if (seen.has(mandate.key)) {
      invalidConfig(
        `نموذجُ تشغيلٍ مكرَّرُ المفتاح: ${mandate.key}؛ ونموذجان لمؤسسةٍ حدّان لا حدّ.`,
      );
    }
    seen.add(mandate.key);
    const pilot = institutions.pilots.find((entry) => entry.key === mandate.key);
    if (pilot === undefined) {
      invalidConfig(
        `النموذج ${mandate.key} لا مؤسسةَ مُشغَّلةً بمفتاحه في config/institutions.yaml؛ واختصاصٌ لمن لا يعمل إعلانٌ لا محلَّ له.`,
      );
    }
    // الاستثناءُ لا يكون مجالاً في الوقت نفسِه: نصّان متعارضان في وثيقةٍ واحدةٍ
    // يجعلان الحدَّ يُقرأ على وجهين، ويصير النفاذُ رهنَ ترتيبِ الفحص.
    for (const domain of mandate.jurisdiction.excludes) {
      if (mandate.jurisdiction.domains.includes(domain)) {
        invalidConfig(
          `المجال ${domain} مُعلَنٌ اختصاصاً ومُستثنىً معاً في ${mandate.key}؛ وحدٌّ يُقرأ على وجهين ليس حدّاً.`,
        );
      }
    }
    for (const power of mandate.prohibitions) {
      if (mandate.powers.includes(power)) {
        invalidConfig(
          `الصلاحية ${power} ممنوحةٌ ومحرَّمةٌ معاً في ${mandate.key}؛ والمحرَّمُ يغلب الممنوحَ فلا يجتمعان في إعلانٍ صحيح.`,
        );
      }
    }
    // ولكلِّ نوعِ مهمّةٍ **مُعلَنٍ في عهد التشغيل** حدٌّ حاكمٌ هنا: نوعٌ يُنفَّذ
    // ولا مجالَ له ولا صلاحيةَ نوعٌ خارجُ النموذج يمرّ بلا قياس.
    /** @type {Set<string>} */
    const kinds = new Set();
    for (const act of mandate.acts) {
      if (kinds.has(act.kind)) {
        invalidConfig(
          `نوعُ مهمّةٍ مكرَّرٌ في نموذج ${mandate.key}: ${act.kind}؛ ونوعٌ بحدّين لا حدَّ له.`,
        );
      }
      kinds.add(act.kind);
      if (!mandate.jurisdiction.domains.includes(act.domain)) {
        invalidConfig(
          `النوع ${act.kind} في ${mandate.key} يُحيل إلى المجال ${act.domain} وهو خارجُ اختصاصها المُعلَن.`,
        );
      }
      if (mandate.prohibitions.includes(act.power)) {
        invalidConfig(
          `النوع ${act.kind} في ${mandate.key} يقتضي الصلاحية ${act.power} وهي محرَّمةٌ عليها؛ ونوعٌ لا يُنفَّذ أبداً إعلانٌ ميّت.`,
        );
      }
      if (!mandate.powers.includes(act.power)) {
        invalidConfig(
          `النوع ${act.kind} في ${mandate.key} يقتضي الصلاحية ${act.power} وهي غيرُ ممنوحةٍ لها.`,
        );
      }
    }
    for (const task of pilot.tasks) {
      if (!kinds.has(task.kind)) {
        invalidConfig(
          `النوع ${task.kind} مُعلَنٌ للمؤسسة ${pilot.key} في عهد التشغيل ولا حدَّ حاكماً له في نموذجها؛ ونوعٌ بلا مجالٍ ولا صلاحيةٍ يمرّ بلا قياس.`,
        );
      }
      // كلفةٌ تتجاوز سقفَ المدّةِ تجعل النوعَ غيرَ قابلٍ للتنفيذ أبداً: يُرفض عند
      // كلِّ محاولةٍ برمز تجاوزِ السقف، فيُقرأ العيبُ خطأَ تشغيلٍ لا خطأَ إعلان.
      if (task.cost > mandate.budget.ceiling) {
        invalidConfig(
          `كلفةُ النوع ${task.kind} (${task.cost}) تتجاوز سقفَ مدّةِ ${mandate.key} (${mandate.budget.ceiling})؛ ونوعٌ لا يُنفَّذ أبداً إعلانٌ ميّت.`,
        );
      }
    }
    // والسقفُ الزمنيُّ لا يتجاوز المُخصَّصَ الكلّي: سقفٌ أعلى من المُخصَّصِ سقفٌ
    // لا يُلمَس، فيُعلَن حدّاً وهو رقمٌ لا يمنع شيئاً.
    if (mandate.budget.ceiling > pilot.budget.allocation) {
      invalidConfig(
        `سقفُ مدّةِ ${mandate.key} (${mandate.budget.ceiling}) يتجاوز مُخصَّصَها الكلّي (${pilot.budget.allocation})؛ وسقفٌ لا يُلمَس ليس حدّاً.`,
      );
    }
    // والمساءلةُ من خارج المؤسسة: جهةٌ من أدوارِ وكلائها تُسائل نفسَها، وذاك
    // إلغاءُ المساءلةِ بصيغةِ إعلانها.
    for (const [role, label] of /** @type {Array<[string, string]>} */ ([
      [mandate.accountability.accountableTo, 'جهةُ المساءلة'],
      [mandate.accountability.escalateTo, 'جهةُ التصعيد'],
    ])) {
      if (pilot.agentRoles.includes(role)) {
        invalidConfig(
          `${label} ${role} في ${mandate.key} من أدوارِ وكلائها؛ ولا يُسائل أحدٌ نفسَه.`,
        );
      }
    }
    if (mandate.accountability.accountableTo === mandate.accountability.escalateTo) {
      invalidConfig(
        `جهةُ المساءلةِ وجهةُ التصعيد في ${mandate.key} دورٌ واحد؛ وتصعيدٌ إلى نفس الجهة ليس تصعيداً.`,
      );
    }
  }
  // والتقابلُ في الاتجاه الآخر: مؤسسةٌ مُشغَّلةٌ بلا نموذجٍ تعمل بلا حدّ.
  for (const pilot of institutions.pilots) {
    if (!seen.has(pilot.key)) {
      invalidConfig(
        `المؤسسة ${pilot.key} مُشغَّلةٌ في عهد التشغيل ولا نموذجَ تشغيلٍ لها في هذه الوثيقة؛ ومؤسسةٌ بلا اختصاصٍ معلَنٍ مؤسسةٌ بلا حدّ.`,
      );
    }
  }

  return Object.freeze(parsed);
}

/**
 * نموذجُ تشغيلِ مؤسسةٍ بمفتاحها، أو رفضٌ برمزٍ مُعلَن.
 * @param {MandatesPolicy} policy
 * @param {string} key
 * @returns {InstitutionMandateEntry}
 */
export function mandateFor(policy, key) {
  const found = policy.mandates.find((entry) => entry.key === key);
  if (found === undefined) {
    throw new MandateError(
      MANDATE_ERRORS.UNKNOWN,
      `لا نموذجَ تشغيلٍ للمؤسسة ${key}؛ واختصاصٌ غيرُ معلَنٍ لا يُشتقّ من مؤسسةٍ أخرى.`,
    );
  }
  return found;
}

/**
 * @param {unknown} record
 * @param {string} key
 * @returns {unknown}
 */
function read(record, key) {
  return /** @type {Record<string, unknown>} */ (record ?? {})[key];
}

/**
 * @param {unknown} record
 * @param {string} key
 * @returns {number}
 */
function readInt(record, key) {
  const value = read(record, key);
  return typeof value === 'number' ? value : 0;
}

/**
 * @param {unknown} record
 * @param {string} key
 * @returns {string}
 */
function readText(record, key) {
  const value = read(record, key);
  return typeof value === 'string' ? value : '';
}

/**
 * @param {unknown} record
 * @param {string} key
 * @returns {Date | null}
 */
function readDate(record, key) {
  const value = read(record, key);
  return value instanceof Date ? value : null;
}

/**
 * أهو خطأُ تفرُّدٍ من المستودع؟ المستودعُ الذاكريُّ يرفض المعرِّفَ المكرَّر برمزه،
 * وPostgreSQL يرفض خرقَ التفرُّدِ بالرمز `23505`. والاثنان واقعةٌ واحدةٌ في المعنى.
 * @param {unknown} error
 * @returns {boolean}
 */
function isDuplicate(error) {
  const code = String(read(error, 'code') ?? '');
  if (code === 'REPOSITORY_DUPLICATE_ID' || code === '23505') return true;
  return error instanceof Error && /DUPLICATE|23505|unique/i.test(error.message);
}

/**
 * @param {Date} from
 * @param {number} days
 * @returns {Date}
 */
function addDays(from, days) {
  return new Date(from.getTime() + days * DAY_MS);
}

/** نموذجُ التشغيل المؤسسي النافذ: يُنفَذ، ويُجيز أو يمنع ويُسجِّل، ويُغلق دورةً. */
export class InstitutionMandate {
  /**
   * @param {object} deps
   * @param {MandatesPolicy} deps.policy نموذجُ التشغيل المُحمَّل.
   * @param {import('../root-of-trust/event-log.mjs').EventLog} deps.log
   * @param {import('../persistence/repository-memory.mjs').Repository} deps.institutions
   * @param {import('../persistence/repository-memory.mjs').Repository} deps.mandates
   * @param {import('../persistence/repository-memory.mjs').Repository} deps.breaches
   * @param {import('../persistence/repository-memory.mjs').Repository} deps.cycles
   * @param {import('../persistence/repository-memory.mjs').Repository} deps.tasks
   * @param {() => Date} [deps.now]
   */
  constructor({ policy, log, institutions, mandates, breaches, cycles, tasks, now }) {
    if (!policy) throw new Error('MANDATE_POLICY_REQUIRED');
    if (!log) throw new Error('MANDATE_EVENT_LOG_REQUIRED');
    // مستودعُ المخالفات لازمٌ لا اختياري: بلا صفٍّ تُكتب فيه المخالفةُ يصير
    // «تُمنع وتُسجَّل» نصفَ شرطٍ، والمنعُ بلا سجلٍّ مساءلةٌ بلا مادّة.
    if (!institutions || !mandates || !breaches || !cycles || !tasks) {
      throw new Error('MANDATE_REPOSITORY_REQUIRED');
    }
    this.policy = policy;
    this.log = log;
    this.institutions = institutions;
    this.mandates = mandates;
    this.breaches = breaches;
    this.cycles = cycles;
    this.tasks = tasks;
    this.now = now ?? (() => new Date());
  }

  /**
   * يتحقّق أنّ الدورَ حاملُ الفعل في الوثيقة.
   * @param {'enact' | 'closeCycle'} act
   * @param {string} role
   * @returns {void}
   */
  #permit(act, role) {
    const holder = this.policy.acts[act];
    if (holder !== role) {
      throw new MandateError(
        MANDATE_ERRORS.ROLE_NOT_PERMITTED,
        `الدور ${role} لا يملك الفعل ${act}؛ وحاملُه المُعلَن ${holder}.`,
      );
    }
  }

  /**
   * صفُّ النموذجِ المُنفَذِ للمؤسسة، أو رفضٌ إن لم يُنفَذ.
   * @param {string} institutionKey
   * @returns {Promise<import('../persistence/entities.mjs').EntityRecord>}
   */
  async #enacted(institutionKey) {
    // `mandateFor` أولاً: مفتاحٌ لا نموذجَ له في الوثيقة يُرفض برمزه الخاص لا
    // برمز «لم يُنفَذ»، فالرمزان يفرِّقان بين اختصاصٍ لا وجودَ له واختصاصٍ لم
    // يُفتح له صفٌّ بعد.
    mandateFor(this.policy, institutionKey);
    const [row] = await this.mandates.list({ filter: { institutionKey }, limit: 1 });
    if (row === undefined) {
      throw new MandateError(
        MANDATE_ERRORS.NOT_ENACTED,
        `نموذجُ تشغيلِ ${institutionKey} لم يُنفَذ بعد؛ ولا تُستقبَل مهمّةٌ قبل أن يكون للاختصاصِ صفٌّ محفوظ.`,
      );
    }
    return row;
  }

  /**
   * يُنفِذ نموذجَ تشغيلِ المؤسسة: الاختصاصُ والصلاحياتُ والسقفُ والمساءلةُ
   * ومدّةُ التقرير تُكتب صفّاً واحداً مقروءاً، لا تبقى نصّاً في وثيقة.
   *
   * والإنفاذُ فعلٌ سياديٌّ: من يملك أن يُنفِذ اختصاصاً يملك أن يُوسِّعه، فلا
   * يكون ذلك لمن يُشغِّل المؤسسة.
   * @param {{ institutionKey: string, actorRole: string }} input
   * @returns {Promise<import('../persistence/entities.mjs').EntityRecord>}
   */
  async enact({ institutionKey, actorRole }) {
    this.#permit('enact', actorRole);
    const mandate = mandateFor(this.policy, institutionKey);
    const [institution] = await this.institutions.list({
      filter: { key: institutionKey },
      limit: 1,
    });
    if (institution === undefined) {
      // الرمزُ من عهد التشغيل لا من هذه الوثيقة: المؤسسةُ لم تُؤسَّس بعد، وذاك
      // شرطُ `M8.05` لا شرطُ الاختصاص.
      throw new InstitutionError(
        INSTITUTION_ERRORS.NOT_COMMISSIONED,
        `المؤسسة ${institutionKey} لم تُؤسَّس بعد؛ ولا يُنفَذ اختصاصٌ لكيانٍ لا صفَّ له ولا ميزانية.`,
      );
    }
    const existing = await this.mandates.list({ filter: { institutionKey }, limit: 1 });
    if (existing.length > 0) {
      throw new MandateError(
        MANDATE_ERRORS.ALREADY_ENACTED,
        `نموذجُ تشغيلِ ${institutionKey} مُنفَذٌ فعلاً؛ وإنفاذٌ ثانٍ يُعيد كتابةَ الاختصاصِ فيمحو حدَّه الأول بلا مسارٍ ولا أثر.`,
      );
    }
    const record = await this.mandates.insert({
      id: `mandate:${institutionKey}`,
      institutionKey,
      institutionId: String(institution['id']),
      domains: [...mandate.jurisdiction.domains],
      excludedDomains: [...mandate.jurisdiction.excludes],
      powers: [...mandate.powers],
      prohibitions: [...mandate.prohibitions],
      budgetPeriodDays: mandate.budget.periodDays,
      budgetCeiling: mandate.budget.ceiling,
      accountableTo: mandate.accountability.accountableTo,
      escalateTo: mandate.accountability.escalateTo,
      reportingPeriodDays: mandate.reporting.periodDays,
      reportingGraceDays: mandate.reporting.graceDays,
      modelVersion: this.policy.version,
      enactedAt: this.now(),
    });
    this.log.append('institutions.mandate.enacted', 'role:king', {
      institutionId: String(institution['id']),
      key: institutionKey,
      domains: [...mandate.jurisdiction.domains].join(','),
      powers: [...mandate.powers].join(','),
      accountableTo: mandate.accountability.accountableTo,
    });
    return record;
  }

  /**
   * يُسجِّل المخالفةَ صفّاً منسوباً إلى جهةِ المساءلةِ وجهةِ التصعيد، ثم يرفض.
   *
   * والتسجيلُ **قبل** الرفض: رفضٌ يُرمى بلا صفٍّ محفوظٍ يجعل «تُمنع وتُسجَّل»
   * نصفَ شرطٍ، ويجعل الدورةَ التقريريةَ تُقرأ خاليةً من مخالفةٍ وقعت.
   * @param {import('../persistence/entities.mjs').EntityRecord} mandateRow
   * @param {{ code: string, detail: string, taskId?: string, domain?: string, power?: string }} input
   * @returns {Promise<never>}
   */
  async #record(mandateRow, { code, detail, taskId = '', domain = '', power = '' }) {
    const institutionKey = readText(mandateRow, 'institutionKey');
    const institutionId = readText(mandateRow, 'institutionId');
    const at = this.now();
    const id = `breach:${institutionKey}:${at.getTime()}:${code}`;
    await this.breaches.insert({
      id,
      institutionId,
      institutionKey,
      taskId: taskId === '' ? null : taskId,
      code,
      domain: domain === '' ? null : domain,
      power: power === '' ? null : power,
      detail,
      accountableTo: readText(mandateRow, 'accountableTo'),
      escalateTo: readText(mandateRow, 'escalateTo'),
      detectedAt: at,
    });
    this.log.append('institutions.mandate.exceeded', 'role:auditor', {
      institutionId,
      key: institutionKey,
      code,
      accountableTo: readText(mandateRow, 'accountableTo'),
      escalateTo: readText(mandateRow, 'escalateTo'),
      taskId,
      domain,
      power,
    });
    throw new MandateError(code, detail);
  }

  /**
   * يُجيز فعلاً مؤسسياً في مجالٍ بعينه، أو **يمنعه ويُسجِّله**.
   *
   * وهذا هو معيارُ قبولِ الخطوة: مؤسسةٌ تتجاوز اختصاصَها تُمنع وتُسجَّل. والمنعُ
   * يقع **قبل أن يُفتح للمهمّة صفٌّ**، فلا تُقرأ مهمّةٌ خارجةُ الاختصاص في عدّادِ
   * مهامِّ المؤسسة أصلاً؛ والمخالفةُ تُقرأ في جدولها منسوبةً إلى جهةِ مساءلتها.
   * @param {{ institutionKey: string, kind: string, domain: string, taskId?: string }} input
   * @returns {Promise<Readonly<{ domain: string, power: string }>>}
   */
  async authorize({ institutionKey, kind, domain, taskId = '' }) {
    const row = await this.#enacted(institutionKey);
    const mandate = mandateFor(this.policy, institutionKey);
    const declared = typeof domain === 'string' ? domain.trim() : '';
    if (declared === '') {
      return this.#record(row, {
        code: MANDATE_ERRORS.DOMAIN_NOT_DECLARED,
        detail: `المهمّة ${taskId === '' ? `من النوع ${kind}` : taskId} رُفعت إلى ${institutionKey} بلا مجالٍ معلَن؛ ومجالٌ غيرُ معلَنٍ لا يُقاس تجاوزُه.`,
        taskId,
      });
    }
    if (
      mandate.jurisdiction.excludes.includes(declared) ||
      !mandate.jurisdiction.domains.includes(declared)
    ) {
      return this.#record(row, {
        code: MANDATE_ERRORS.OUT_OF_JURISDICTION,
        detail: `المؤسسة ${institutionKey} لا اختصاصَ لها في المجال ${declared}؛ واختصاصُها المُعلَن: ${mandate.jurisdiction.domains.join('، ')}، والمُستثنى صراحةً: ${mandate.jurisdiction.excludes.join('، ') || 'لا شيء'}.`,
        taskId,
        domain: declared,
      });
    }
    const act = mandate.acts.find((entry) => entry.kind === kind);
    if (act === undefined) {
      return this.#record(row, {
        code: MANDATE_ERRORS.POWER_NOT_GRANTED,
        detail: `النوع ${kind} لا صلاحيةَ معلَنةً له في نموذج ${institutionKey}؛ ونوعٌ بلا صلاحيةٍ مسمّاةٍ فعلٌ بلا سند.`,
        taskId,
        domain: declared,
      });
    }
    if (act.domain !== declared) {
      return this.#record(row, {
        code: MANDATE_ERRORS.ACT_DOMAIN_MISMATCH,
        detail: `النوع ${kind} مجالُه المُعلَن ${act.domain} ورُفع تحت المجال ${declared}؛ ونوعٌ يُرفع تحت مجالٍ آخرَ داخلِ الاختصاص التفافٌ على الحدّ.`,
        taskId,
        domain: declared,
        power: act.power,
      });
    }
    if (mandate.prohibitions.includes(act.power)) {
      return this.#record(row, {
        code: MANDATE_ERRORS.ACT_PROHIBITED,
        detail: `الصلاحية ${act.power} محرَّمةٌ على ${institutionKey} صراحةً؛ والمحرَّمُ يغلب الممنوحَ ولا يُشتقّ من نوعِ مهمّةٍ ولا من دورِ وكيل.`,
        taskId,
        domain: declared,
        power: act.power,
      });
    }
    if (!mandate.powers.includes(act.power)) {
      return this.#record(row, {
        code: MANDATE_ERRORS.POWER_NOT_GRANTED,
        detail: `الصلاحية ${act.power} غيرُ ممنوحةٍ لـ${institutionKey}؛ والممنوحُ لها: ${mandate.powers.join('، ')}.`,
        taskId,
        domain: declared,
        power: act.power,
      });
    }
    return Object.freeze({ domain: declared, power: act.power });
  }

  /**
   * موعدُ الدورةِ القائمةِ ومهلتُها، محسوبةً من آخرِ دورةٍ مُغلَقةٍ أو من الإنفاذ.
   * @param {import('../persistence/entities.mjs').EntityRecord} mandateRow
   * @returns {Promise<Readonly<{ periodStart: Date, periodEnd: Date, dueAt: Date }>>}
   */
  async #window(mandateRow) {
    const institutionKey = readText(mandateRow, 'institutionKey');
    const rows = await this.cycles.list({ filter: { institutionKey } });
    let start = readDate(mandateRow, 'enactedAt') ?? this.now();
    for (const row of rows) {
      const end = readDate(row, 'periodEnd');
      if (end !== null && end.getTime() > start.getTime()) start = end;
    }
    const periodEnd = addDays(start, readInt(mandateRow, 'reportingPeriodDays'));
    return Object.freeze({
      periodStart: start,
      periodEnd,
      dueAt: addDays(periodEnd, readInt(mandateRow, 'reportingGraceDays')),
    });
  }

  /**
   * يتحقّق أنّ المؤسسةَ ليست متأخّرةً عن تقريرها الدوري، **وإلا مُنعت وسُجِّلت**.
   *
   * وتقريرٌ دوريٌّ يتأخّر بلا أثرٍ ليس دورياً: موعدٌ في وثيقةٍ لا التزام.
   * @param {{ institutionKey: string, at?: Date }} input
   * @returns {Promise<Readonly<{ periodEnd: Date, dueAt: Date }>>}
   */
  async assertReportingCurrent({ institutionKey, at }) {
    const row = await this.#enacted(institutionKey);
    const window = await this.#window(row);
    const moment = at ?? this.now();
    if (moment.getTime() > window.dueAt.getTime()) {
      return this.#record(row, {
        code: MANDATE_ERRORS.REPORTING_OVERDUE,
        detail: `المؤسسة ${institutionKey} تأخّرت عن تقريرها الدوريِّ المستحقِّ ${window.dueAt.toISOString()}؛ ولا تُستقبَل مهمّةٌ جديدةٌ حتى تُغلَق دورتُها.`,
      });
    }
    return Object.freeze({ periodEnd: window.periodEnd, dueAt: window.dueAt });
  }

  /**
   * يتحقّق أنّ كلفةَ المهمّةِ تقع تحت سقفِ الصرفِ في المدّة المعلَنة.
   *
   * والمجموعُ محسوبٌ من أوقاتِ قيدِ الميزانية في صفوف المهام: سقفٌ مُعلَنٌ لا
   * يُجمَع له صرفٌ واقعٌ رقمٌ في وثيقة.
   * @param {{ institutionKey: string, institutionId: string, cost: number, taskId?: string, at?: Date }} input
   * @returns {Promise<Readonly<{ spent: number, ceiling: number, remaining: number }>>}
   */
  async assertWithinPeriodCeiling({ institutionKey, institutionId, cost, taskId = '', at }) {
    const row = await this.#enacted(institutionKey);
    const moment = at ?? this.now();
    const since = addDays(moment, -readInt(row, 'budgetPeriodDays'));
    const rows = await this.tasks.list({ filter: { institutionId } });
    let spent = 0;
    for (const task of rows) {
      const debitedAt = readDate(task, 'budgetDebitedAt');
      if (debitedAt === null) continue;
      if (debitedAt.getTime() < since.getTime()) continue;
      spent += readInt(task, 'budgetCost');
    }
    const ceiling = readInt(row, 'budgetCeiling');
    if (spent + cost > ceiling) {
      return this.#record(row, {
        code: MANDATE_ERRORS.PERIOD_CEILING_EXCEEDED,
        detail: `صرفُ ${institutionKey} في ${readInt(row, 'budgetPeriodDays')} يوماً بلغ ${spent} وسقفُه ${ceiling} وكلفةُ المهمّة ${cost}؛ ومُخصَّصٌ بلا سقفٍ زمنيٍّ يُستهلَك كلُّه في يومٍ واحد.`,
        taskId,
      });
    }
    return Object.freeze({ spent, ceiling, remaining: ceiling - spent - cost });
  }

  /**
   * @typedef {Readonly<{
   *   institution: Readonly<{ key: string, id: string }>,
   *   period: Readonly<{ start: Date, end: Date, dueAt: Date, closedAt: Date }>,
   *   tasks: Readonly<{ total: number, executed: number, refused: number }>,
   *   budget: Readonly<{ consumed: number, ceiling: number }>,
   *   breaches: readonly Readonly<{ code: string, detail: string }>[],
   *   accountability: Readonly<{ accountableTo: string, escalateTo: string }>,
   * }>} CycleReport
   */

  /**
   * يُغلق الدورةَ التقريريةَ بتقريرٍ **مُشتقٍّ** من صفوفِ المدّة: مهامُّها
   * ومخالفاتُها وما صُرف فيها.
   *
   * ولا تُغلَق دورةٌ قبل انقضاء مدّتها، ولا تُغلَق مدّةٌ مرّتين: تقريران لمدّةٍ
   * واحدةٍ يُحتسب بهما العملُ مرّتين.
   * @param {{ institutionKey: string, actorRole: string, at?: Date }} input
   * @returns {Promise<CycleReport>}
   */
  async closeCycle({ institutionKey, actorRole, at }) {
    this.#permit('closeCycle', actorRole);
    const row = await this.#enacted(institutionKey);
    const window = await this.#window(row);
    const moment = at ?? this.now();
    if (moment.getTime() < window.periodEnd.getTime()) {
      throw new MandateError(
        MANDATE_ERRORS.CYCLE_NOT_DUE,
        `دورةُ ${institutionKey} تنتهي ${window.periodEnd.toISOString()} ولم تنقضِ بعد؛ وإغلاقٌ مبكرٌ يُنتج تقريراً عن مدّةٍ لم تكتمل.`,
      );
    }
    const institutionId = readText(row, 'institutionId');
    const existing = await this.cycles.list({ filter: { institutionKey } });
    for (const cycle of existing) {
      const start = readDate(cycle, 'periodStart');
      if (start !== null && start.getTime() === window.periodStart.getTime()) {
        throw new MandateError(
          MANDATE_ERRORS.CYCLE_ALREADY_CLOSED,
          `دورةُ ${institutionKey} التي تبدأ ${window.periodStart.toISOString()} مُغلَقةٌ فعلاً في ${String(cycle['id'])}؛ ودورتان لمدّةٍ واحدةٍ تقريران يُحتسب بهما العملُ مرّتين.`,
        );
      }
    }
    /** @param {Date | null} when */
    const inWindow = (when) =>
      when !== null &&
      when.getTime() >= window.periodStart.getTime() &&
      when.getTime() < window.periodEnd.getTime();
    const taskRows = (await this.tasks.list({ filter: { institutionId } })).filter((task) =>
      inWindow(readDate(task, 'receivedAt')),
    );
    const breachRows = (await this.breaches.list({ filter: { institutionKey } })).filter((breach) =>
      inWindow(readDate(breach, 'detectedAt')),
    );
    let consumed = 0;
    for (const task of taskRows) {
      if (readDate(task, 'budgetDebitedAt') !== null) consumed += readInt(task, 'budgetCost');
    }
    /** @param {string} state */
    const countOf = (state) => taskRows.filter((task) => task['state'] === state).length;
    const id = `cycle:${institutionKey}:${window.periodStart.getTime()}`;
    // والفحصُ السابقُ يقرأ الصفوفَ ثم يكتب، وبين القراءةِ والكتابةِ متَّسعٌ لإغلاقٍ
    // ثانٍ متزامن. فتفرُّدُ (المفتاح، بدايةُ المدّة) في القاعدة هو الحاجزُ الفعليّ،
    // ويُترجَم هنا إلى الرمز المُعلَن: خطأُ تفرُّدٍ خامٌّ يُقرأ انهيارَ مستودعٍ لا
    // رفضَ شرطٍ محكوم، فتضيع المخالفةُ في سجلِّ الأخطاء.
    await this.cycles
      .insert({
        id,
        institutionId,
        institutionKey,
        periodStart: window.periodStart,
        periodEnd: window.periodEnd,
        dueAt: window.dueAt,
        closedAt: moment,
        closedBy: actorRole,
        tasksTotal: taskRows.length,
        tasksExecuted: countOf('executed'),
        tasksRefused: countOf('refused'),
        breachCount: breachRows.length,
        budgetConsumed: consumed,
      })
      .catch((error) => {
        if (isDuplicate(error)) {
          throw new MandateError(
            MANDATE_ERRORS.CYCLE_ALREADY_CLOSED,
            `دورةُ ${institutionKey} التي تبدأ ${window.periodStart.toISOString()} مُغلَقةٌ فعلاً بالمعرِّف ${id}؛ ودورتان لمدّةٍ واحدةٍ تقريران يُحتسب بهما العملُ مرّتين.`,
          );
        }
        throw error;
      });
    this.log.append('institutions.report.cycle.closed', 'role:auditor', {
      institutionId,
      key: institutionKey,
      periodStart: window.periodStart.toISOString(),
      periodEnd: window.periodEnd.toISOString(),
      tasks: taskRows.length,
      breaches: breachRows.length,
      consumed,
    });
    return Object.freeze({
      institution: Object.freeze({ key: institutionKey, id: institutionId }),
      period: Object.freeze({
        start: window.periodStart,
        end: window.periodEnd,
        dueAt: window.dueAt,
        closedAt: moment,
      }),
      tasks: Object.freeze({
        total: taskRows.length,
        executed: countOf('executed'),
        refused: countOf('refused'),
      }),
      budget: Object.freeze({ consumed, ceiling: readInt(row, 'budgetCeiling') }),
      breaches: Object.freeze(
        breachRows.map((breach) =>
          Object.freeze({ code: readText(breach, 'code'), detail: readText(breach, 'detail') }),
        ),
      ),
      accountability: Object.freeze({
        accountableTo: readText(row, 'accountableTo'),
        escalateTo: readText(row, 'escalateTo'),
      }),
    });
  }

  /**
   * حالةُ المساءلةِ مُشتقّةً من الصفوف: جهةُ المساءلةِ والتصعيد، وعددُ
   * المخالفاتِ المسجَّلة، وموعدُ الدورةِ القائمة.
   * @param {{ institutionKey: string }} input
   * @returns {Promise<Readonly<{ accountableTo: string, escalateTo: string, breaches: number, periodEnd: Date, dueAt: Date, cycles: number }>>}
   */
  async accountability({ institutionKey }) {
    const row = await this.#enacted(institutionKey);
    const window = await this.#window(row);
    const breachRows = await this.breaches.list({ filter: { institutionKey } });
    const cycleRows = await this.cycles.list({ filter: { institutionKey } });
    return Object.freeze({
      accountableTo: readText(row, 'accountableTo'),
      escalateTo: readText(row, 'escalateTo'),
      breaches: breachRows.length,
      periodEnd: window.periodEnd,
      dueAt: window.dueAt,
      cycles: cycleRows.length,
    });
  }
}
