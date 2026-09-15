/**
 * التقارير الملكية الدورية — الخطوة `M8.09`.
 *
 * **العيب الذي تُغلقه هذه الوحدة:** لم يكن في المستودع موضعٌ يُولّد تقريراً عن
 * الدولة كلِّها؛ كان الموجودُ تقريرَ مؤسسةٍ واحدةٍ عن دورتها (`M8.05`) لا
 * تقريرَ حالةٍ ومخاطرَ ومخالفاتٍ وتكلفة.
 *
 * **القاعدةُ الحاكمة:** كلُّ حقلٍ في التقرير إمّا **مقيسٌ من صفوف** بمصدرٍ
 * مُسمّىً يُرجِع القيمةَ وعددَ الصفوف التي قِيست منها، وإمّا **تقديريٌّ مُعلَن**
 * (`estimated: true`) قيمتُه غيرُ معروفةٍ ومعه فرضيتُه نصّاً. ولا ثالثَ لهما:
 * حقلٌ بلا مصدرٍ ولا فرضيةٍ يُرفض عند التحميل، وقيمةٌ لم تُقَس ولم تُعلَن
 * تقديريةً تُرفض عند التوليد. وهذا معيارُ القبول: «بلا حقولٍ تقديريةٍ غيرِ
 * معلَنة».
 *
 * **حدودٌ مُعلَنة:**
 * 1. القياسُ يقرأ صفوفَ النافذةِ في الذاكرةِ ثم يُرشِّحها بالزمن، لأن مستودعات
 *    المشروع لا تملك ترشيحاً بمدىً زمنيٍّ مفهرس؛ فالتكلفةُ خطّيةٌ بعددِ الصفوف
 *    ولا تصلح لملايينِ الصفوف بلا فهرسٍ زمنيٍّ يُضاف في مسارٍ لاحق.
 * 2. لا تنشر هذه الوحدةُ أحداثاً على ناقلِ الأحداث؛ عقودُ قناةِ التقارير مؤجَّلةٌ
 *    إلى مسارٍ لاحقٍ ولم تُعلَن في `config/events.yaml` كي لا يُعلَن عقدٌ بلا
 *    مُنتِج.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

import Ajv2020Default from 'ajv/dist/2020.js';

// وحزمةُ Ajv تُصدِّر صنفَها افتراضاً في ESM، فيُقرأ نوعُه صريحاً وإلا صار
// «غيرَ قابلٍ للإنشاء» في الفحصِ الصارم — كما في وحدةِ التفويض.
const Ajv2020 = /** @type {typeof import('ajv/dist/2020.js').Ajv2020} */ (
  /** @type {unknown} */ (Ajv2020Default)
);
import YAML from 'yaml';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** مجلَّدُ الإعداداتِ الافتراضيُّ للتقارير. */
export const DEFAULT_REPORTS_CONFIG_DIR = path.resolve(HERE, '..', '..', 'config');

/** رموزُ أخطاءِ التقارير — كلُّ رمزٍ مربوطٌ بضمانٍ في `config/royal-reports.yaml`. */
export const REPORT_ERRORS = Object.freeze({
  CONFIG_INVALID: 'REPORTS_CONFIG_INVALID',
  MEASURE_MISSING: 'REPORTS_MEASURE_MISSING',
  ROLE_NOT_PERMITTED: 'REPORTS_ROLE_NOT_PERMITTED',
  PERIOD_INVALID: 'REPORTS_PERIOD_INVALID',
  FIELD_UNMEASURED: 'REPORTS_FIELD_UNMEASURED',
  ESTIMATE_UNDECLARED: 'REPORTS_ESTIMATE_UNDECLARED',
  HUMAN_REVIEW_REQUIRED: 'REPORTS_HUMAN_REVIEW_REQUIRED',
  REVIEW_REJECTED: 'REPORTS_REVIEW_REJECTED',
  ROYAL_COMMAND_REQUIRED: 'REPORTS_ROYAL_COMMAND_REQUIRED',
  COMMAND_ACTION_UNKNOWN: 'REPORTS_COMMAND_ACTION_UNKNOWN',
  COMMAND_TARGET_MISMATCH: 'REPORTS_COMMAND_TARGET_MISMATCH',
  NOT_REVIEWED: 'REPORTS_NOT_REVIEWED',
  STALE: 'REPORTS_STALE',
  TOO_SOON: 'REPORTS_TOO_SOON',
});

/** حالاتُ التقرير. */
export const REPORT_STATES = Object.freeze({
  GENERATED: 'generated',
  REVIEWED: 'reviewed',
  REJECTED: 'rejected',
  PUBLISHED: 'published',
});

/** خطأُ تقريرٍ ملكيٍّ برمزٍ مُعلَن. */
export class ReportError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   */
  constructor(code, message) {
    super(message);
    this.name = 'ReportError';
    this.code = code;
  }
}

/**
 * @param {string} message
 * @returns {never}
 */
function invalidConfig(message) {
  throw new ReportError(REPORT_ERRORS.CONFIG_INVALID, message);
}

/**
 * @param {unknown} error
 * @returns {string}
 */
function errorText(error) {
  return error instanceof Error ? error.message : String(error);
}

/**
 * @typedef {object} ReportFieldSpec
 * @property {string} id
 * @property {string} title
 * @property {string | null} measure
 * @property {boolean} estimated
 * @property {string} [assumption]
 */

/**
 * @typedef {object} ReportSectionSpec
 * @property {string} id
 * @property {string} title
 * @property {ReportFieldSpec[]} fields
 */

/**
 * @typedef {object} ReportPolicy
 * @property {number} version
 * @property {string} statement
 * @property {{ windowMs: number, minIntervalMs: number, statement: string }} period
 * @property {{ generate: string, review: string, publish: string }} acts
 * @property {{ requiredType: string, reviewerRoles: string[], minReasonLength: number, statement: string }} review
 * @property {{ publish: string, statement: string }} command
 * @property {ReportSectionSpec[]} sections
 * @property {Array<{ code: string, statement: string, enforcedBy: string }>} guarantees
 */

/**
 * يقرأ وثيقةَ التقارير ويتحقّق منها بمخطَّطها ثم بفحوصِ تماسكٍ لا يُعبِّر عنها
 * مخطَّط.
 * @param {{ dir?: string }} [options]
 * @returns {ReportPolicy}
 */
export function loadReportPolicy(options = {}) {
  const dir = options.dir ?? DEFAULT_REPORTS_CONFIG_DIR;
  const schemaDir = fs.existsSync(path.join(dir, 'schemas')) ? dir : DEFAULT_REPORTS_CONFIG_DIR;
  const file = path.join(dir, 'royal-reports.yaml');
  if (!fs.existsSync(file)) {
    invalidConfig(
      'وثيقةُ التقاريرِ الملكيةِ غائبة؛ وتقريرٌ بلا وثيقةٍ تُعلن حقولَه ومصادرَها تقريرٌ يُكتب بالتقدير.',
    );
  }
  /** @type {unknown} */
  let raw;
  try {
    raw = YAML.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    invalidConfig(`تعذّرت قراءة royal-reports.yaml: ${errorText(error)}`);
  }
  const schemaPath = path.join(schemaDir, 'schemas', 'royal-reports.schema.json');
  if (!fs.existsSync(schemaPath)) {
    invalidConfig(
      'مخطَّطُ وثيقةِ التقاريرِ غائب؛ وبلا مخطَّطٍ يصير إعلانُ الحقولِ نصّاً حرّاً كالذي جاء ليمنعه.',
    );
  }
  const validate = new Ajv2020({ allErrors: true, strict: false }).compile(
    JSON.parse(fs.readFileSync(schemaPath, 'utf8')),
  );
  if (!validate(raw)) {
    const problems = (validate.errors ?? [])
      .map((/** @type {{ instancePath: string, message?: string }} */ entry) =>
        `${entry.instancePath || '/'} ${entry.message ?? ''}`.trim(),
      )
      .join(' · ');
    invalidConfig(`royal-reports.yaml يخالف مخطَّطه: ${problems}`);
  }
  const parsed = /** @type {ReportPolicy} */ (raw);

  // ── فحوصُ تماسكٍ لا يُعبِّر عنها مخطَّط ──

  /** @type {Set<string>} */
  const sectionIds = new Set();
  /** @type {Set<string>} */
  const fieldIds = new Set();
  /** @type {Set<string>} */
  const measures = new Set();
  for (const section of parsed.sections) {
    if (sectionIds.has(section.id)) {
      invalidConfig(`القسم ${section.id} مُعلَنٌ مرّتين؛ ولا قسمان بمعرّفٍ واحدٍ في تقريرٍ واحد.`);
    }
    sectionIds.add(section.id);
    for (const field of section.fields) {
      if (fieldIds.has(field.id)) {
        invalidConfig(
          `الحقل ${field.id} مُعلَنٌ مرّتين؛ وحقلٌ بمعرّفٍ مكرَّرٍ يُقرأ بأيِّ قياسٍ شاء قارئه.`,
        );
      }
      fieldIds.add(field.id);
      if (field.estimated) {
        if (typeof field.assumption !== 'string' || field.assumption.trim().length < 60) {
          invalidConfig(
            `الحقل ${field.id} تقديريٌّ بلا فرضيةٍ مكتوبة؛ وتقديرٌ بلا فرضيةٍ تقديرٌ غيرُ معلَن.`,
          );
        }
        if (field.measure !== null) {
          invalidConfig(
            `الحقل ${field.id} تقديريٌّ ويُعلن مصدرَ قياسٍ (${field.measure})؛ ولا يكون الحقلُ مقيساً وتقديريّاً معاً.`,
          );
        }
        continue;
      }
      if (typeof field.measure !== 'string' || field.measure === '') {
        invalidConfig(
          `الحقل ${field.id} غيرُ تقديريٍّ ولا مصدرَ قياسٍ له؛ وحقلٌ بلا مصدرٍ ولا فرضيةٍ حقلٌ لا يُعرف من أين جاء.`,
        );
      }
      if (measures.has(field.measure)) {
        invalidConfig(
          `مصدرُ القياس ${field.measure} مُعلَنٌ لحقلين؛ ومصدرٌ واحدٌ لحقلين يُخفي أحدَهما.`,
        );
      }
      measures.add(field.measure);
    }
  }
  for (const id of ['state', 'risks', 'violations', 'cost']) {
    if (!sectionIds.has(id)) {
      invalidConfig(`القسم ${id} غيرُ مُعلَن؛ وتقريرُ الدولةِ حالٌ ومخاطرُ ومخالفاتٌ وتكلفة.`);
    }
  }
  const roles = new Set([
    parsed.acts.generate,
    parsed.acts.review,
    parsed.acts.publish,
    ...parsed.review.reviewerRoles,
  ]);
  const declaredRoles = readDeclaredRoles(dir, schemaDir);
  for (const role of roles) {
    if (!declaredRoles.has(role)) {
      invalidConfig(
        `الدور ${role} غيرُ معلَنٍ في config/roles.yaml؛ ودورٌ يُكتب في وثيقةٍ ولا وجودَ له في سجلِّ الأدوارِ سلطةٌ مُختلَقة.`,
      );
    }
  }
  if (parsed.acts.generate === parsed.acts.review) {
    invalidConfig(
      'دورُ التوليدِ هو دورُ المراجعةِ نفسُه؛ ومن يكتب التقريرَ لا يكون هو من يُصدِّقه.',
    );
  }
  if (!parsed.review.reviewerRoles.includes(parsed.acts.review)) {
    invalidConfig(
      `دورُ المراجعةِ ${parsed.acts.review} ليس من حاملي المراجعةِ المُعلَنين؛ وإعلانٌ يخالف نفسَه لا يُقرأ منه ضمان.`,
    );
  }
  for (const code of Object.values(REPORT_ERRORS)) {
    if (!parsed.guarantees.some((entry) => entry.code === code)) {
      invalidConfig(
        `الرمز ${code} مُنفَّذٌ في الوحدةِ ولا ضمانَ له في الوثيقة؛ ورفضٌ بلا نصٍّ يُقرأ رفضٌ لا يُحاسب عليه أحد.`,
      );
    }
  }
  for (const guarantee of parsed.guarantees) {
    if (!Object.values(REPORT_ERRORS).includes(/** @type {never} */ (guarantee.code))) {
      invalidConfig(
        `الضمان ${guarantee.code} معلَنٌ ولا رمزَ له في الوحدة؛ وضمانٌ لا يُنفَّذ وعدٌ لا يُقاس.`,
      );
    }
  }
  return parsed;
}

/**
 * الأدوارُ المعلَنةُ في `config/roles.yaml`، ليُرفض دورٌ لا وجودَ له.
 * @param {string} dir
 * @param {string} fallbackDir
 * @returns {Set<string>}
 */
function readDeclaredRoles(dir, fallbackDir) {
  const candidates = [path.join(dir, 'roles.yaml'), path.join(fallbackDir, 'roles.yaml')];
  const file = candidates.find((entry) => fs.existsSync(entry));
  if (file === undefined) {
    invalidConfig('سجلُّ الأدوارِ غائب؛ ولا تُقاس صحةُ دورٍ بلا سجلٍّ يُقرأ منه.');
  }
  /** @type {unknown} */
  let raw;
  try {
    raw = YAML.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    invalidConfig(`تعذّرت قراءة roles.yaml: ${errorText(error)}`);
  }
  const roles = /** @type {{ roles?: Array<{ id?: unknown }> }} */ (raw)?.roles;
  if (!Array.isArray(roles) || roles.length === 0) {
    invalidConfig(
      'سجلُّ الأدوارِ فارغٌ أو غيرُ مقروء؛ ودولةٌ بلا أدوارٍ معلَنةٍ لا تُوزَّع فيها سلطة.',
    );
  }
  /** @type {Set<string>} */
  const ids = new Set();
  for (const role of roles) {
    // ومعرّفُ الدورِ في `config/roles.yaml` يحمل بادئتَه أصلاً (`role:king`)،
    // فيُقرأ كما هو ولا تُضاف بادئةٌ ثانيةٌ تُخفي دوراً معلَناً.
    if (typeof role?.id === 'string' && role.id.startsWith('role:')) ids.add(role.id);
  }
  return ids;
}

/**
 * @typedef {object} Measurement
 * @property {number | string | null} value
 * @property {number} rowCount
 * @property {string} measuredFrom
 */

/**
 * @typedef {(window: { start: Date, end: Date, now: Date }) => Promise<Measurement>} MeasureFn
 */

/**
 * وأنواعُ الوحداتِ الحقيقيةِ (سجلُّ التفويض، سجلُّ الهويات، بوابةُ التاج،
 * مستودعُ التقارير) تقرأ وتكتب `Readonly<Record>` لا `object`؛ فتُكتب هنا بشكلِها
 * الحقيقيِّ حتى يُقبل تركيبُ الدولةِ نفسِه في الفحصِ الصارم.
 * @typedef {{ insert: (input: Readonly<Record<string, unknown>>) => Promise<Readonly<Record<string, unknown>>>, findById: (id: string) => Promise<Readonly<Record<string, unknown>> | null>, update: (id: string, version: number, patch: Readonly<Record<string, unknown>>) => Promise<Readonly<Record<string, unknown>>>, list: (query?: Readonly<Record<string, unknown>>) => Promise<ReadonlyArray<Readonly<Record<string, unknown>>>> }} ReportsRepository
 */

/**
 * @typedef {{ effective: () => Promise<ReadonlyMap<string, Readonly<Record<string, unknown>>>>, entries: (filter?: Readonly<Record<string, unknown>>) => Promise<ReadonlyArray<Readonly<Record<string, unknown>>>> }} RegisterLike
 */

/**
 * @typedef {{ get: (id: string) => Promise<Readonly<Record<string, unknown>> | null> }} AgentsLike
 */

/**
 * الأمرُ الملكيُّ كما تقرؤه هذه الوحدةُ: تمرّره إلى البوابةِ ولا تتحقّق من
 * توقيعِه بنفسها — كما في وحدةِ التفويض.
 * @typedef {Readonly<{ id: string, action: string, target: string, issuedAt: string, payload: object }>} RoyalCommandLike
 */

/**
 * @typedef {{ command: (command: RoyalCommandLike, signature: string) => unknown }} CrownLike
 */

/**
 * مستودعٌ يُقرأ منه فحسب. وأنواعُ المستودعاتِ الحقيقيةِ تقرأ `Readonly<Record>`،
 * فلو كُتب هنا `object` لصار المستودعُ الحقيقيُّ غيرَ مقبولٍ في هذا الموضع.
 * @typedef {{ list: (query?: Readonly<Record<string, unknown>>) => Promise<ReadonlyArray<Readonly<Record<string, unknown>>>> }} ListableRepository
 */

/**
 * @typedef {object} ReportRepositories
 * @property {ListableRepository} institutions
 * @property {ListableRepository} institutionMandates
 * @property {ListableRepository} institutionTasks
 * @property {ListableRepository} institutionBreaches
 * @property {ListableRepository} institutionReportCycles
 * @property {ListableRepository} federationActs
 * @property {ListableRepository} federationRefusals
 */

/**
 * مصدرُ قيودِ دفترِ التكلفةِ (`D-6`) — يُقرأُ منه عدّادُ وحداتِ الحسابِ. صفوفُه
 * قيودُ استهلاكٍ صحيحةٌ كما يُخرِجُها الدفترُ نفسُه (`CostCapacity.usageEntries()`),
 * فمنطقُ التحقّقِ من القيدِ في الدفترِ لا في التقرير — والتقريرُ يقرأُ ولا يُرمِّم
 * قيداً. **وهو إلزاميّ:** من يُعلن حقلاً مقيساً من الدفترِ ولا يُمرِّر دفتراً يقرأُ
 * منه يُردُّ عند بناءِ المقاييسِ لا عند أولِ توليدٍ يخرجُ صفراً فيُقرأ قياساً — فصفرٌ
 * بلا مصدرٍ أخضرُ فارغٌ يُطمئنُ إلى لا شيء.
 * @typedef {{ list: (query?: Readonly<Record<string, unknown>>) => Promise<ReadonlyArray<{ item: string, institution: string, agent: string, model: string, quantity: number, costMilli: number, atMs: number }>> }} CostUsageRepository
 */

/**
 * @param {Record<string, unknown>} row
 * @param {string} field
 * @returns {Date | null}
 */
function at(row, field) {
  const value = row[field];
  if (value instanceof Date) return value;
  if (typeof value === 'string' && value !== '') {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
}

/**
 * @param {Record<string, unknown>} row
 * @param {string} field
 * @param {{ start: Date, end: Date }} window
 * @returns {boolean}
 */
function inWindow(row, field, window) {
  const when = at(row, field);
  if (when === null) return false;
  return when.getTime() >= window.start.getTime() && when.getTime() <= window.end.getTime();
}

/**
 * @param {Record<string, unknown>} row
 * @param {string} field
 * @returns {number}
 */
function number(row, field) {
  const value = row[field];
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/**
 * يبني مقاييسَ الحقولِ من المستودعاتِ الحقيقيةِ وسجلِّ السيادةِ ودفترِ التكلفةِ.
 * @param {object} deps
 * @param {ReportRepositories} deps.repositories
 * @param {RegisterLike} deps.register
 * @param {CostUsageRepository} deps.costUsage قيودُ دفترِ التكلفةِ — **إلزاميّةٌ** (`D-6`)
 * @returns {Record<string, MeasureFn>}
 */
export function createReportMeasures({ repositories, register, costUsage }) {
  if (costUsage === null || typeof costUsage !== 'object' || typeof costUsage.list !== 'function') {
    throw new ReportError(
      REPORT_ERRORS.MEASURE_MISSING,
      'قيودُ دفترِ التكلفةِ غائبةٌ عن المقاييسِ؛ وحقلٌ مُعلَنٌ مقيساً من الدفترِ بلا دفترٍ يُقرأُ منه يُقرأُ صفراً فيُظنَّ قياساً — فغيابُ الدفترِ رفضٌ عند البناءِ لا صفرٌ عند التوليد.',
    );
  }
  const repo = repositories;
  return {
    'institutions.activeCount': async () => {
      const rows = await repo.institutionMandates.list({});
      return {
        value: rows.length,
        rowCount: rows.length,
        measuredFrom: 'state.institution_mandates',
      };
    },
    'institutions.taskCount': async (window) => {
      const rows = await repo.institutionTasks.list({});
      const matched = rows.filter((row) => inWindow(row, 'receivedAt', window));
      return {
        value: matched.length,
        rowCount: rows.length,
        measuredFrom: 'state.institution_tasks',
      };
    },
    'federation.effectiveCount': async () => {
      const effective = await register.effective();
      const entries = await register.entries();
      return {
        value: effective.size,
        rowCount: entries.length,
        measuredFrom: 'state.federation_delegation_register',
      };
    },
    'federation.actCount': async (window) => {
      const rows = await repo.federationActs.list({});
      const matched = rows.filter((row) => inWindow(row, 'exercisedAt', window));
      return {
        value: matched.length,
        rowCount: rows.length,
        measuredFrom: 'state.federation_acts',
      };
    },
    'risks.overdueRevocationCount': async (window) => {
      const rows = await register.entries();
      const matched = rows.filter(
        (row) =>
          row['effect'] === 'REVOKE' &&
          row['withinDeadline'] === false &&
          inWindow(row, 'effectiveAt', window),
      );
      return {
        value: matched.length,
        rowCount: rows.length,
        measuredFrom: 'state.federation_delegation_register',
      };
    },
    'risks.lateCycleCount': async (window) => {
      const rows = await repo.institutionReportCycles.list({});
      const matched = rows.filter((row) => {
        const due = at(row, 'dueAt');
        if (due === null) return false;
        const closed = at(row, 'closedAt');
        if (closed === null) {
          return due.getTime() < window.now.getTime() && due.getTime() <= window.end.getTime();
        }
        return closed.getTime() > due.getTime() && inWindow(row, 'closedAt', window);
      });
      return {
        value: matched.length,
        rowCount: rows.length,
        measuredFrom: 'state.institution_report_cycles',
      };
    },
    'risks.budgetExhaustedCount': async () => {
      const rows = await repo.institutions.list({});
      const matched = rows.filter(
        (row) => number(row, 'budgetConsumed') >= number(row, 'budgetAllocated'),
      );
      return { value: matched.length, rowCount: rows.length, measuredFrom: 'state.institutions' };
    },
    'risks.refusedTaskCount': async (window) => {
      const rows = await repo.institutionTasks.list({});
      const matched = rows.filter(
        (row) => row['state'] === 'refused' && inWindow(row, 'refusedAt', window),
      );
      return {
        value: matched.length,
        rowCount: rows.length,
        measuredFrom: 'state.institution_tasks',
      };
    },
    'violations.breachCount': async (window) => {
      const rows = await repo.institutionBreaches.list({});
      const matched = rows.filter((row) => inWindow(row, 'detectedAt', window));
      return {
        value: matched.length,
        rowCount: rows.length,
        measuredFrom: 'state.institution_breaches',
      };
    },
    'violations.refusalCount': async (window) => {
      const rows = await repo.federationRefusals.list({});
      const matched = rows.filter((row) => inWindow(row, 'refusedAt', window));
      return {
        value: matched.length,
        rowCount: rows.length,
        measuredFrom: 'state.federation_refusals',
      };
    },
    'violations.topRefusalCode': async (window) => {
      const rows = await repo.federationRefusals.list({});
      const matched = rows.filter((row) => inWindow(row, 'refusedAt', window));
      /** @type {Map<string, number>} */
      const tally = new Map();
      for (const row of matched) {
        const code = typeof row['code'] === 'string' ? row['code'] : '';
        if (code === '') continue;
        tally.set(code, (tally.get(code) ?? 0) + 1);
      }
      const ranked = [...tally.entries()].sort(
        (left, right) => right[1] - left[1] || left[0].localeCompare(right[0]),
      );
      const top = ranked.at(0);
      return {
        // لا صفوفَ في النافذةِ ⇒ لا رمزَ أكثرَ تكراراً، و`null` هنا **قياسٌ**
        // نتيجتُه الخلوّ لا قيمةٌ فائتة: عددُ الصفوفِ المقيسِ صفرٌ يُثبت ذلك.
        value: top === undefined ? null : top[0],
        rowCount: matched.length,
        measuredFrom: 'state.federation_refusals',
      };
    },
    'cost.debitedTotal': async (window) => {
      const rows = await repo.institutionTasks.list({});
      const matched = rows.filter((row) => inWindow(row, 'budgetDebitedAt', window));
      const total = matched.reduce((sum, row) => sum + number(row, 'budgetCost'), 0);
      return { value: total, rowCount: rows.length, measuredFrom: 'state.institution_tasks' };
    },
    'cost.remainingTotal': async () => {
      const rows = await repo.institutions.list({});
      const total = rows.reduce(
        (sum, row) => sum + (number(row, 'budgetAllocated') - number(row, 'budgetConsumed')),
        0,
      );
      return { value: total, rowCount: rows.length, measuredFrom: 'state.institutions' };
    },
    // عدّادُ وحداتِ الحسابِ (`D-6`): مجموعُ ما استُهلِكَ من دفترِ التكلفةِ في النافذةِ
    // بـ«مِلّي‑وحدةٍ محاسبيةٍ» — وحدةِ الدفترِ المُعلَنةِ — لا بكمّياتٍ خامٍ مختلطةٍ
    // (رموزٌ وبايتاتٌ وكتاباتٌ ومهامّ لا يُجمَعُ بعضُها إلى بعضٍ بلا تسعيرٍ فيُقرأُ
    // مجموعُها معنى وهو لا معنى له). والقيودُ تُقرأُ من الدفترِ مُتحقَّقاً منها
    // (`CostCapacity.usageEntries()`) — والتقريرُ يُرشِّحُها بنافذتِهِ هو، فزمنُ النافذةِ
    // سؤالُ التقريرِ لا سؤالَ الدفترِ.
    'cost.consumedMilli': async (window) => {
      const rows = await costUsage.list({});
      const startMs = window.start.getTime();
      const endMs = window.end.getTime();
      let total = 0;
      for (const entry of rows) {
        if (entry.atMs < startMs || entry.atMs > endMs) continue;
        total += entry.costMilli;
      }
      return {
        value: total,
        rowCount: rows.length,
        measuredFrom: 'cost.usage.recorded',
      };
    },
  };
}

/**
 * @param {Array<{ id: string, value: number | string | null, estimated: boolean, rowCount: number, measuredFrom: string | null, assumption: string | null }>} fields
 * @param {{ start: Date, end: Date }} window
 * @returns {string}
 */
function digestOf(fields, window) {
  const canonical = JSON.stringify({
    periodStart: window.start.toISOString(),
    periodEnd: window.end.toISOString(),
    fields: [...fields]
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((field) => [field.id, field.value, field.estimated, field.rowCount, field.measuredFrom]),
  });
  return crypto.createHash('sha256').update(canonical).digest('hex');
}

/**
 * مُولِّدُ التقاريرِ الملكيةِ الدورية: يُولِّد ويُراجَع ويُنشَر بأمرٍ ملكيٍّ.
 */
export class RoyalReportGenerator {
  /**
   * @param {object} deps
   * @param {ReportPolicy} deps.policy
   * @param {ReportsRepository} deps.reports
   * @param {Record<string, MeasureFn>} deps.measures
   * @param {AgentsLike | null} [deps.agents]
   * @param {CrownLike | null} [deps.crown]
   * @param {() => Date} [deps.now]
   */
  constructor({ policy, reports, measures, agents = null, crown = null, now = () => new Date() }) {
    this.policy = policy;
    this.reports = reports;
    this.measures = measures;
    this.agents = agents;
    this.crown = crown;
    this.now = now;

    // تقابلُ المعلَنِ بالمنفَّذِ **في الاتجاهين** عند التركيب لا عند أول توليد:
    // حقلٌ يُعلن مصدراً غيرَ منفَّذٍ خللٌ يُكتشف الآن، ومقياسٌ منفَّذٌ لا حقلَ له
    // كودٌ لا يُقرأ منه شيء.
    /** @type {string[]} */
    const declared = [];
    for (const section of policy.sections) {
      for (const field of section.fields) {
        if (field.estimated) continue;
        declared.push(/** @type {string} */ (field.measure));
      }
    }
    for (const measure of declared) {
      if (typeof measures[measure] !== 'function') {
        throw new ReportError(
          REPORT_ERRORS.MEASURE_MISSING,
          `مصدرُ القياس ${measure} معلَنٌ في الوثيقةِ وغيرُ منفَّذٍ في الوحدة؛ وحقلٌ بمصدرٍ لا وجودَ له حقلٌ سيُملأ بالتقدير.`,
        );
      }
    }
    for (const measure of Object.keys(measures)) {
      if (!declared.includes(measure)) {
        throw new ReportError(
          REPORT_ERRORS.MEASURE_MISSING,
          `مقياسٌ منفَّذٌ ${measure} لا حقلَ معلَنٌ له؛ ومقياسٌ لا يُقرأ منه حقلٌ كودٌ يُطمئن ولا يُقاس.`,
        );
      }
    }
  }

  /**
   * @param {string} actorRole
   * @param {'generate' | 'review'} act
   */
  #assertRole(actorRole, act) {
    const expected = this.policy.acts[act];
    if (actorRole !== expected) {
      throw new ReportError(
        REPORT_ERRORS.ROLE_NOT_PERMITTED,
        `الدور ${actorRole} ليس حاملَ فعلِ ${act} المُعلَن (${expected})؛ وفعلٌ يقع بغيرِ حاملِه سلطةٌ تُنتزع لا تُمارَس.`,
      );
    }
  }

  /**
   * @param {unknown} periodStart
   * @param {unknown} periodEnd
   * @returns {{ start: Date, end: Date, now: Date }}
   */
  #window(periodStart, periodEnd) {
    const start = periodStart instanceof Date ? periodStart : new Date(String(periodStart));
    const end = periodEnd instanceof Date ? periodEnd : new Date(String(periodEnd));
    const now = this.now();
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      throw new ReportError(
        REPORT_ERRORS.PERIOD_INVALID,
        'نافذةُ التقريرِ غيرُ مقروءةٍ زمناً؛ ونافذةٌ لا تُقرأ لا يُعاد القياسُ عليها.',
      );
    }
    if (end.getTime() <= start.getTime()) {
      throw new ReportError(
        REPORT_ERRORS.PERIOD_INVALID,
        'نهايةُ النافذةِ ليست بعد بدايتها؛ ونافذةٌ مقلوبةٌ أو صفريةٌ لا يُقاس فيها شيء.',
      );
    }
    if (end.getTime() - start.getTime() > this.policy.period.windowMs) {
      throw new ReportError(
        REPORT_ERRORS.PERIOD_INVALID,
        `النافذةُ ${end.getTime() - start.getTime()} مللي أطولُ من المُعلَن (${this.policy.period.windowMs})؛ وتقريرٌ يمدّ نافذتَه يُخفي مقارنةً بين دورتين.`,
      );
    }
    if (end.getTime() > now.getTime()) {
      throw new ReportError(
        REPORT_ERRORS.PERIOD_INVALID,
        'نهايةُ النافذةِ في المستقبل؛ والتقريرُ عن مدّةٍ مضت لا عن مدّةٍ لم تأتِ.',
      );
    }
    return { start, end, now };
  }

  /**
   * يقيس كلَّ الحقولِ المعلَنةِ على نافذةٍ بعينها.
   * @param {{ start: Date, end: Date, now: Date }} window
   * @returns {Promise<{ fields: Array<{ id: string, section: string, title: string, value: number | string | null, estimated: boolean, rowCount: number, measuredFrom: string | null, assumption: string | null }>, measured: number, estimated: number, digest: string }>}
   */
  async #measureAll(window) {
    /** @type {Array<{ id: string, section: string, title: string, value: number | string | null, estimated: boolean, rowCount: number, measuredFrom: string | null, assumption: string | null }>} */
    const fields = [];
    let measured = 0;
    let estimated = 0;
    for (const section of this.policy.sections) {
      for (const spec of section.fields) {
        if (spec.estimated) {
          estimated += 1;
          fields.push({
            id: spec.id,
            section: section.id,
            title: spec.title,
            value: null,
            estimated: true,
            rowCount: 0,
            measuredFrom: null,
            assumption: /** @type {string} */ (spec.assumption),
          });
          continue;
        }
        const measure = /** @type {MeasureFn} */ (
          this.measures[/** @type {string} */ (spec.measure)]
        );
        const result = await measure(window);
        const ok =
          typeof result?.rowCount === 'number' &&
          Number.isInteger(result.rowCount) &&
          result.rowCount >= 0 &&
          typeof result?.measuredFrom === 'string' &&
          result.measuredFrom !== '' &&
          (typeof result.value === 'number' ||
            typeof result.value === 'string' ||
            (result.value === null && result.rowCount === 0));
        // والترتيبُ مقصود: «لا قيمةَ مع صفوفٍ مقيسة» تقديرٌ غيرُ معلَنٌ بعينه،
        // فيُردّ برمزِه هو، ولو رُدّ برمزِ القياسِ الفائتِ لضاع تمييزُ الحالتين.
        if (
          result !== null &&
          typeof result === 'object' &&
          result.value === null &&
          result.rowCount !== 0
        ) {
          throw new ReportError(
            REPORT_ERRORS.ESTIMATE_UNDECLARED,
            `الحقل ${spec.id} بلا قيمةٍ مع وجودِ صفوفٍ مقيسة؛ وقيمةٌ لم تُقَس ولم تُعلَن تقديريةً حقلٌ تقديريٌّ غيرُ معلَن.`,
          );
        }
        if (!ok) {
          throw new ReportError(
            REPORT_ERRORS.FIELD_UNMEASURED,
            `الحقل ${spec.id} معلَنٌ مقيساً ولم يُرجِع مصدرُه قيمةً ومصدراً وعددَ صفوفٍ مقروءاً؛ وصفرٌ مكتوبٌ مكانَ قياسٍ فائتٍ كذبةٌ أهدأُ من الفشل.`,
          );
        }
        measured += 1;
        fields.push({
          id: spec.id,
          section: section.id,
          title: spec.title,
          value: result.value,
          estimated: false,
          rowCount: result.rowCount,
          measuredFrom: result.measuredFrom,
          assumption: null,
        });
      }
    }
    const declared = this.policy.sections.reduce((sum, section) => sum + section.fields.length, 0);
    if (measured + estimated !== declared) {
      throw new ReportError(
        REPORT_ERRORS.FIELD_UNMEASURED,
        `الحقولُ المعلَنةُ ${declared} والمقيسةُ ${measured} والتقديريةُ ${estimated}؛ وتقريرٌ لا يُغطّي حقولَه المعلَنةَ تقريرٌ ناقصٌ يُقرأ كاملاً.`,
      );
    }
    return { fields, measured, estimated, digest: digestOf(fields, window) };
  }

  /**
   * يُولّد تقريراً على نافذةٍ مُعلَنةٍ من صفوفٍ حقيقية.
   * @param {object} input
   * @param {string} input.actorRole
   * @param {Date | string} input.periodStart
   * @param {Date | string} input.periodEnd
   * @param {string} [input.reportId]
   * @returns {Promise<Record<string, unknown>>}
   */
  async generate({ actorRole, periodStart, periodEnd, reportId }) {
    this.#assertRole(actorRole, 'generate');
    const window = this.#window(periodStart, periodEnd);

    const published =
      (await this.reports.list({ filter: { state: REPORT_STATES.PUBLISHED } })) ?? [];
    for (const row of published) {
      const previousEnd = at(row, 'periodEnd');
      if (previousEnd === null) continue;
      if (previousEnd.getTime() === window.end.getTime()) {
        throw new ReportError(
          REPORT_ERRORS.TOO_SOON,
          `تقريرٌ منشورٌ يغطّي النافذةَ المنتهيةَ في ${window.end.toISOString()}؛ ولا تقريران على نافذةٍ واحدةٍ يُقرأ أحدُهما تصحيحاً للآخر بلا إعلان.`,
        );
      }
      if (window.now.getTime() - previousEnd.getTime() < this.policy.period.minIntervalMs) {
        throw new ReportError(
          REPORT_ERRORS.TOO_SOON,
          `آخرُ نافذةٍ منشورةٍ انتهت قبل ${window.now.getTime() - previousEnd.getTime()} مللي، وأدنى المدةِ المعلَنةِ ${this.policy.period.minIntervalMs}؛ ودوريّةٌ تُخالف إعلانَها دوريّةٌ لا يُبنى عليها.`,
        );
      }
    }

    const measurement = await this.#measureAll(window);
    const id = reportId ?? `report:${window.end.toISOString()}`;
    return await this.reports.insert({
      id,
      reportId: id,
      periodStart: window.start,
      periodEnd: window.end,
      generatedBy: actorRole,
      generatedAt: window.now,
      state: REPORT_STATES.GENERATED,
      fieldsDeclared: measurement.fields.length,
      fieldsMeasured: measurement.measured,
      fieldsEstimated: measurement.estimated,
      digest: measurement.digest,
      sections: measurement.fields,
      reviewer: null,
      reviewDecision: null,
      reviewReason: null,
      reviewedAt: null,
      publishCommandId: null,
      publishedAt: null,
      modelVersion: this.policy.version,
    });
  }

  /**
   * مراجعةٌ بشريةٌ مقروءةٌ من سجلِّ الهويات.
   * @param {object} input
   * @param {string} input.reportId
   * @param {string} input.reviewer
   * @param {'accept' | 'reject'} input.decision
   * @param {string} input.reason
   * @returns {Promise<Record<string, unknown>>}
   */
  async review({ reportId, reviewer, decision, reason }) {
    const row = await this.reports.findById(reportId);
    if (row === null) {
      throw new ReportError(
        REPORT_ERRORS.NOT_REVIEWED,
        `التقرير ${reportId} غيرُ مسجَّل؛ ولا تُراجَع ورقةٌ لا صفَّ لها.`,
      );
    }
    if (row['state'] !== REPORT_STATES.GENERATED) {
      throw new ReportError(
        REPORT_ERRORS.NOT_REVIEWED,
        `التقرير ${reportId} حالُه ${String(row['state'])} لا ${REPORT_STATES.GENERATED}؛ ولا تُعاد مراجعةُ ما رُوجع.`,
      );
    }
    if (this.agents === null) {
      throw new ReportError(
        REPORT_ERRORS.HUMAN_REVIEW_REQUIRED,
        'لا سجلَّ هوياتٍ مركَّبٌ تُقرأ منه بشريةُ المراجع؛ وفحصٌ لا سبيلَ إلى إجرائه لا يُفترض نجاحُه.',
      );
    }
    if (typeof reason !== 'string' || reason.trim().length < this.policy.review.minReasonLength) {
      throw new ReportError(
        REPORT_ERRORS.HUMAN_REVIEW_REQUIRED,
        `سببُ المراجعةِ أقصرُ من ${this.policy.review.minReasonLength} حرفاً؛ والمراجعةُ حكمٌ مكتوبٌ لا ختمٌ صامت.`,
      );
    }
    // وهويةٌ مجهولةٌ في السجلِّ ترجع `null` أو ترفع خطأً بحسبِ تركيبِه، فيُسوّى
    // الاثنانِ إلى «لا هوية» ولا يُقرأ غيابُها نجاحاً.
    /** @type {Readonly<Record<string, unknown>> | null} */
    const identity = await this.agents.get(reviewer).catch(() => null);
    if (identity === null) {
      throw new ReportError(
        REPORT_ERRORS.HUMAN_REVIEW_REQUIRED,
        `المراجع ${reviewer} غيرُ مسجَّلٍ في سجلِّ الهويات؛ واسمٌ بلا هويةٍ لا تُقاس بشريتُه.`,
      );
    }
    if (identity['kind'] !== this.policy.review.requiredType) {
      throw new ReportError(
        REPORT_ERRORS.HUMAN_REVIEW_REQUIRED,
        `المراجع ${reviewer} نوعُه ${String(identity['kind'])} لا ${this.policy.review.requiredType}؛ ومراجعةٌ يوقّعها وكيلٌ ليست مراجعةً بشرية.`,
      );
    }
    if (identity['state'] !== 'active') {
      throw new ReportError(
        REPORT_ERRORS.HUMAN_REVIEW_REQUIRED,
        `المراجع ${reviewer} حالُه ${String(identity['state'])} لا active؛ وهويةٌ موقوفةٌ لا تملك تصديقاً تمنحه.`,
      );
    }
    const role = String(identity['role']);
    if (!this.policy.review.reviewerRoles.includes(role)) {
      throw new ReportError(
        REPORT_ERRORS.ROLE_NOT_PERMITTED,
        `دورُ المراجع ${role} ليس من حاملي المراجعةِ المُعلَنين (${this.policy.review.reviewerRoles.join('، ')}).`,
      );
    }
    if (role === String(row['generatedBy'])) {
      throw new ReportError(
        REPORT_ERRORS.ROLE_NOT_PERMITTED,
        `المراجع ${reviewer} بدورِ من ولّد التقرير (${String(row['generatedBy'])})؛ ولا يُراجع أحدٌ عملَ نفسه.`,
      );
    }
    if (decision !== 'accept' && decision !== 'reject') {
      throw new ReportError(
        REPORT_ERRORS.HUMAN_REVIEW_REQUIRED,
        `قرارُ المراجعةِ ${String(decision)} غيرُ معروف؛ والمراجعةُ قبولٌ أو رفضٌ لا ثالثَ لهما.`,
      );
    }
    const version = Number(row['version']);
    const updated = await this.reports.update(reportId, version, {
      state: decision === 'accept' ? REPORT_STATES.REVIEWED : REPORT_STATES.REJECTED,
      reviewer,
      reviewDecision: decision,
      reviewReason: reason.trim(),
      reviewedAt: this.now(),
    });
    if (decision === 'reject') {
      throw new ReportError(
        REPORT_ERRORS.REVIEW_REJECTED,
        `مراجعةُ ${reportId} رُفضت من ${reviewer}: ${reason.trim()}؛ والرفضُ مُثبَتٌ في الصفِّ ولا يُنشر بعده تقرير.`,
      );
    }
    return updated;
  }

  /**
   * نشرٌ بأمرٍ ملكيٍّ بعد إعادةِ القياسِ على النافذةِ المحفوظة.
   * @param {object} input
   * @param {string} input.reportId
   * @param {RoyalCommandLike} [input.command]
   * @param {string} [input.signature]
   * @returns {Promise<Record<string, unknown>>}
   */
  async publish({ reportId, command, signature }) {
    if (this.crown === null) {
      throw new ReportError(
        REPORT_ERRORS.ROYAL_COMMAND_REQUIRED,
        'لا بوابةَ تاجٍ مركَّبةٌ في مُولّدِ التقارير؛ ونشرٌ بلا بوابةٍ فعلٌ يقع بمقارنةِ اسمِ دورٍ بالنصّ.',
      );
    }
    if (command === undefined || command === null || typeof signature !== 'string') {
      throw new ReportError(
        REPORT_ERRORS.ROYAL_COMMAND_REQUIRED,
        `نشرُ ${reportId} يقتضي أمراً ملكيّاً موقَّعاً؛ ونداءٌ بلا أمرٍ نداءٌ بلا سلطة.`,
      );
    }
    if (command.action !== this.policy.command.publish) {
      throw new ReportError(
        REPORT_ERRORS.COMMAND_ACTION_UNKNOWN,
        `فعلُ الأمر ${String(command.action)} ليس فعلَ النشرِ المُعلَن (${this.policy.command.publish})؛ وأمرٌ يُقبل على غيرِ فعلِه أمرٌ يُنقل بتوقيعٍ صحيح.`,
      );
    }
    if (command.target !== reportId) {
      throw new ReportError(
        REPORT_ERRORS.COMMAND_TARGET_MISMATCH,
        `هدفُ الأمر ${String(command.target)} ليس التقريرَ ${reportId}؛ وأثرٌ يقع في تقريرٍ لم يأمر به أمرٌ لم يُصدَر.`,
      );
    }
    // البوابةُ **قبل** لمسِ الحال: أمرٌ مرفوضٌ لا يُغيّر صفّاً.
    this.crown.command(command, signature);

    const row = await this.reports.findById(reportId);
    if (row === null) {
      throw new ReportError(
        REPORT_ERRORS.NOT_REVIEWED,
        `التقرير ${reportId} غيرُ مسجَّل؛ ولا يُنشر ما لا صفَّ له.`,
      );
    }
    if (row['state'] !== REPORT_STATES.REVIEWED) {
      throw new ReportError(
        REPORT_ERRORS.NOT_REVIEWED,
        `التقرير ${reportId} حالُه ${String(row['state'])} لا ${REPORT_STATES.REVIEWED}؛ ولا نشرَ قبل مراجعةٍ بشريةٍ قابلة.`,
      );
    }
    const start = at(row, 'periodStart');
    const end = at(row, 'periodEnd');
    if (start === null || end === null) {
      throw new ReportError(
        REPORT_ERRORS.PERIOD_INVALID,
        `نافذةُ ${reportId} غيرُ مقروءةٍ من الصفّ؛ ولا يُعاد قياسٌ على نافذةٍ لا تُقرأ.`,
      );
    }
    const measurement = await this.#measureAll({ start, end, now: this.now() });
    if (measurement.digest !== String(row['digest'])) {
      throw new ReportError(
        REPORT_ERRORS.STALE,
        `قياسُ ${reportId} تغيّر بين التوليدِ والنشر (${String(row['digest']).slice(0, 12)} ⇢ ${measurement.digest.slice(0, 12)})؛ وتقريرٌ يُنشر بعد أن تغيّرت الصفوفُ تقريرٌ عن دولةٍ أخرى.`,
      );
    }
    return await this.reports.update(reportId, Number(row['version']), {
      state: REPORT_STATES.PUBLISHED,
      publishCommandId: String(command.id),
      publishedAt: this.now(),
    });
  }
}
