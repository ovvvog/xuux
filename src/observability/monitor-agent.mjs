/**
 * وكيل المراقبة للقراءة فقط — الخطوة `M9.01` (بند P1).
 *
 * **العيب الذي تُغلقه هذه الوحدة:** لم يكن في المستودع مسارُ مراقبةٍ واحدٌ يقرأ
 * حالَ الدولة؛ كان القارئُ يأخذ سجلاتَ `createRegistries` كما هي — وفيها الكتابةُ
 * بجوار القراءة — أو يأخذ المستودعاتَ نفسَها. فوكيلُ مراقبةٍ يُبنى بهذه الطريقة
 * وكيلٌ **يملك** الكتابةَ وإن لم يستعملها، والقدرةُ غيرُ المستعملةِ قدرة: تُستعمل
 * بأولِ خطأٍ أو أولِ استدعاءٍ من موضعٍ آخر. وأسوأُ من ذلك أن القراءةَ كانت تقع بلا
 * أثرٍ في سجلِّ الأحداث: من قرأ سجلَّ الهوياتِ كلَّه لم يُسجَّل أنه قرأ.
 *
 * **القاعدةُ الحاكمة:** لا سطحَ ثالث. المراقبةُ تمرّ من **نداءٍ واحد** هو
 * `read`، ولا يُصدَّر مشهدٌ إلى المستدعي كي لا تقعَ قراءةٌ خارجَ التدقيق. وكلُّ
 * ما يُقرأ مُعلَنٌ بياناتٍ في `config/monitoring.yaml`: الدورُ وقدراتُه المسموحة،
 * وأسماءُ النداءاتِ المقروءة، والمشاهدُ بمستوداتها وجداولها، والحدُّ الأعلى
 * للصفوف. والقدرةُ تُقاس على `config/roles.yaml` في الاتجاهين عند التركيب: قدرةٌ
 * زائدةٌ في الدور تمنع التركيب، وقدرةٌ معلَنةٌ لا يحملها الدور تمنعه أيضاً.
 *
 * **الفشلُ مغلق (المادة 9):** سجلُّ أحداثٍ غيرُ موصولٍ يرفض **كلَّ** قراءة
 * (`MONITOR_AUDIT_REQUIRED`)، وسجلُّ هوياتٍ غيرُ موصولٍ يرفضها كذلك
 * (`MONITOR_IDENTITY_UNVERIFIED`). ولا مسارَ يسقط إلى قراءةٍ بلا تدقيقٍ ولا إلى
 * قراءةٍ بلا هويةٍ محقَّقة.
 *
 * **حدودٌ مُعلَنة:**
 * 1. القيدُ يُكتب **قبل** القراءة لا بعدها. والثمنُ مُعلَن: قد يُكتب قيدٌ لقراءةٍ
 *    أخفقت بعده، فنسجّل زائداً لا ناقصاً — وقيدٌ ناقصٌ يعني قراءةً وقعت ولا يعلم
 *    بها أحد، وذلك أسوأ.
 * 2. المنعُ بنيويٌّ **لهذا المسار** كما ينصّ معيارُ القبول: من يملك المستودعاتَ
 *    أصلاً يكتب بها مباشرةً، وليس في هذه الوحدةِ حجرٌ عامٌّ على بقيةِ المستودع.
 * 3. لا تنشر هذه الوحدةُ أحداثاً على ناقلِ الأحداث؛ عقودُ قناةِ المراقبةِ مؤجَّلةٌ
 *    إلى مسارٍ لاحق كي لا يُعلَن عقدٌ بلا مُنتِج. والتدقيقُ يُكتب في سجلِّ
 *    الأحداثِ المتسلسلِ تشفيرياً.
 * 4. الترشيحُ محدودٌ بحقولِ `filterable` في مواصفةِ السجل، والحدُّ الأعلى للصفوف
 *    محدودٌ بـ `maxRows`. فلا مسحَ كاملٍ يُخفي كلفتَه من هذا المسار، ولا ترشيحَ
 *    بحقلٍ غيرِ مفهرسٍ ولا مُعلَن.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import Ajv2020Default from 'ajv/dist/2020.js';

// وحزمةُ Ajv تُصدِّر صنفَها افتراضاً في ESM، فيُقرأ نوعُه صريحاً وإلا صار «غيرَ
// قابلٍ للإنشاء» في الفحصِ الصارم — كما في وحدةِ التقارير ووحدةِ التفويض.
const Ajv2020 = /** @type {typeof import('ajv/dist/2020.js').Ajv2020} */ (
  /** @type {unknown} */ (Ajv2020Default)
);
import YAML from 'yaml';

import { createReadOnlyView, ReadOnlyViewError, VIEW_ERRORS } from './read-only-view.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** مجلَّدُ الإعداداتِ الافتراضيُّ للمراقبة. */
export const DEFAULT_MONITORING_CONFIG_DIR = path.resolve(HERE, '..', '..', 'config');

/**
 * أسماءُ النداءاتِ الكاتبةِ في مستودعاتِ المشروع. القائمةُ هنا **حدٌّ على
 * البيانات** لا سلوكٌ مكتوبٌ في كود: من أعلن `insert` اسماً «مقروءاً» في
 * `config/monitoring.yaml` أُوقف عند التحميل، فلا يُوسَّع السطحُ بتعديلِ ملفِ
 * إعدادٍ بلا مراجعةِ كود.
 */
const WRITE_METHOD_NAMES = Object.freeze(['insert', 'update', 'remove', 'delete', 'upsert']);

/** رموزُ أخطاءِ المراقبة — كلُّ رمزٍ مربوطٌ بضمانٍ في `config/monitoring.yaml`. */
export const MONITOR_ERRORS = Object.freeze({
  CONFIG_INVALID: 'MONITOR_CONFIG_INVALID',
  VIEW_NOT_COMPOSED: 'MONITOR_VIEW_NOT_COMPOSED',
  ENTITY_MISMATCH: 'MONITOR_ENTITY_MISMATCH',
  WRITE_FORBIDDEN: VIEW_ERRORS.WRITE_FORBIDDEN,
  CAPABILITY_FORBIDDEN: 'MONITOR_CAPABILITY_FORBIDDEN',
  CAPABILITY_UNDECLARED: 'MONITOR_CAPABILITY_UNDECLARED',
  IDENTITY_UNVERIFIED: 'MONITOR_IDENTITY_UNVERIFIED',
  AUDIT_REQUIRED: 'MONITOR_AUDIT_REQUIRED',
  VIEW_UNKNOWN: 'MONITOR_VIEW_UNKNOWN',
  QUERY_UNSUPPORTED: 'MONITOR_QUERY_UNSUPPORTED',
});

/** خطأُ مراقبةٍ برمزٍ مُعلَن. */
export class MonitorError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   */
  constructor(code, message) {
    super(message);
    this.name = 'MonitorError';
    this.code = code;
  }
}

/**
 * @param {string} message
 * @returns {never}
 */
function invalidConfig(message) {
  throw new MonitorError(MONITOR_ERRORS.CONFIG_INVALID, message);
}

/**
 * @param {unknown} error
 * @returns {string}
 */
function errorText(error) {
  return error instanceof Error ? error.message : String(error);
}

/**
 * @typedef {object} MonitorViewSpec
 * @property {string} id
 * @property {string} registry
 * @property {string} entity
 * @property {string} purpose
 */

/**
 * @typedef {object} MonitoringPolicy
 * @property {number} version
 * @property {string} statement
 * @property {string} role
 * @property {readonly string[]} allowedCapabilities
 * @property {readonly string[]} readMethods
 * @property {number} maxRows
 * @property {{ readEvent: string, refusalEvent: string, statement: string }} audit
 * @property {readonly MonitorViewSpec[]} views
 * @property {ReadonlyArray<{ code: string, statement: string, enforcedBy: string }>} guarantees
 */

/**
 * يقرأ وثيقةَ المراقبةِ ويتحقّق منها بمخطَّطها ثم بفحوصِ تماسكٍ لا يُعبِّر عنها
 * مخطَّط: لا مشهدين بمعرّفٍ واحد، ولا مشهدين على مستودعٍ واحد، ولا اسمَ نداءٍ
 * كاتبٍ في قائمةِ المقروء، وكلُّ رمزٍ في الضماناتِ مُعلَنٌ في رموزِ هذه الوحدة.
 * @param {{ dir?: string }} [options]
 * @returns {MonitoringPolicy}
 */
export function loadMonitoringPolicy(options = {}) {
  const dir = options.dir ?? DEFAULT_MONITORING_CONFIG_DIR;
  const schemaDir = fs.existsSync(path.join(dir, 'schemas')) ? dir : DEFAULT_MONITORING_CONFIG_DIR;
  const file = path.join(dir, 'monitoring.yaml');
  if (!fs.existsSync(file)) {
    invalidConfig(
      'وثيقةُ المراقبةِ غائبة؛ ووكيلُ مراقبةٍ بلا وثيقةٍ تُعلن مشاهدَه ونداءاتِه المقروءة وكيلٌ حدُّه نيّةُ كاتبه.',
    );
  }
  /** @type {unknown} */
  let raw;
  try {
    raw = YAML.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    invalidConfig(`تعذّرت قراءة monitoring.yaml: ${errorText(error)}`);
  }
  const schemaPath = path.join(schemaDir, 'schemas', 'monitoring.schema.json');
  if (!fs.existsSync(schemaPath)) {
    invalidConfig(
      'مخطَّطُ وثيقةِ المراقبةِ غائب؛ وبلا مخطَّطٍ يصير إعلانُ المشاهدِ نصّاً حرّاً كالذي جاء ليمنعه.',
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
    invalidConfig(`monitoring.yaml يخالف مخطَّطه: ${problems}`);
  }
  const parsed = /** @type {MonitoringPolicy} */ (raw);

  // ── فحوصُ تماسكٍ لا يُعبِّر عنها مخطَّط ──

  for (const name of parsed.readMethods) {
    if (WRITE_METHOD_NAMES.includes(name)) {
      invalidConfig(
        `النداء «${name}» نداءُ كتابةٍ وقد أُعلن مقروءاً؛ ووثيقةٌ تُعلن الكتابةَ قراءةً تفتح المسارَ الذي جاءت لتغلقه.`,
      );
    }
  }

  /** @type {Set<string>} */
  const viewIds = new Set();
  /** @type {Set<string>} */
  const registries = new Set();
  /** @type {Set<string>} */
  const entities = new Set();
  for (const view of parsed.views) {
    if (viewIds.has(view.id)) {
      invalidConfig(
        `المشهد ${view.id} مُعلَنٌ مرّتين؛ ولا مشهدان بمعرّفٍ واحدٍ يُقرأ أحدُهما بالآخر.`,
      );
    }
    viewIds.add(view.id);
    if (registries.has(view.registry)) {
      invalidConfig(
        `المستودع ${view.registry} مُعلَنٌ لمشهدين؛ ومستودعٌ واحدٌ بمشهدين يجعل قيدَ التدقيقِ لا يُعرَف من أيِّهما جاء.`,
      );
    }
    registries.add(view.registry);
    if (entities.has(view.entity)) {
      invalidConfig(`الجدول ${view.entity} مُعلَنٌ لمشهدين؛ وجدولٌ بمشهدين يُخفي أحدَهما.`);
    }
    entities.add(view.entity);
  }

  /** @type {Set<string>} */
  const declaredCodes = new Set(Object.values(MONITOR_ERRORS));
  /** @type {Set<string>} */
  const guaranteedCodes = new Set();
  for (const guarantee of parsed.guarantees) {
    if (!declaredCodes.has(guarantee.code)) {
      invalidConfig(
        `الضمان ${guarantee.code} غيرُ مُعلَنٍ في رموزِ الوحدة؛ وضمانٌ برمزٍ لا يرفعه كودٌ ضمانٌ لا يُقاس.`,
      );
    }
    if (guaranteedCodes.has(guarantee.code)) {
      invalidConfig(
        `الضمان ${guarantee.code} مُعلَنٌ مرّتين؛ ونصّان لضمانٍ واحدٍ يفترقان بأولِ تعديل.`,
      );
    }
    guaranteedCodes.add(guarantee.code);
  }
  for (const code of declaredCodes) {
    if (!guaranteedCodes.has(code)) {
      invalidConfig(
        `الرمز ${code} يرفعه الكودُ ولا ضمانَ له في الوثيقة؛ ورفضٌ بلا نصٍّ يُعلنه رفضٌ يُفاجئ قارئه.`,
      );
    }
  }

  return Object.freeze({
    version: parsed.version,
    statement: parsed.statement,
    role: parsed.role,
    allowedCapabilities: Object.freeze([...parsed.allowedCapabilities]),
    readMethods: Object.freeze([...parsed.readMethods]),
    maxRows: parsed.maxRows,
    audit: Object.freeze({ ...parsed.audit }),
    views: Object.freeze(parsed.views.map((view) => Object.freeze({ ...view }))),
    guarantees: Object.freeze(parsed.guarantees.map((entry) => Object.freeze({ ...entry }))),
  });
}

/**
 * يقرأ قدراتِ دورٍ من `config/roles.yaml` نصّاً — لا عبر محمّلِ السياساتِ الكامل،
 * كي لا يصير تركيبُ المراقبةِ مرهوناً بصحّةِ كلِّ ملفاتِ السياسة (نفسُ اختيارِ
 * `capability-catalog`). ودورٌ غيرُ موجودٍ خطأُ إعدادٍ لا قائمةٌ فارغة: القائمةُ
 * الفارغةُ كانت ستُمرِّر كلَّ الفحوصِ بلا قدرةٍ واحدة.
 * @param {{ dir?: string, role: string }} options
 * @returns {readonly string[]}
 */
export function readRoleCapabilities({ dir, role }) {
  const base = dir ?? DEFAULT_MONITORING_CONFIG_DIR;
  const rolesFile = path.join(base, 'roles.yaml');
  if (!fs.existsSync(rolesFile)) {
    invalidConfig(
      'وثيقةُ الأدوارِ غائبة؛ وقدراتُ دورِ المراقبةِ لا تُفترض — بلا ملفِ أدوارٍ لا يُعرَف ما يملكه الدور.',
    );
  }
  /** @type {unknown} */
  let raw;
  try {
    raw = YAML.parse(fs.readFileSync(rolesFile, 'utf8'));
  } catch (error) {
    invalidConfig(`تعذّرت قراءة roles.yaml: ${errorText(error)}`);
  }
  const doc = /** @type {{ roles?: Array<{ id?: string, capabilities?: string[] }> }} */ (
    raw === null || typeof raw !== 'object' ? {} : raw
  );
  const entry = (doc.roles ?? []).find((candidate) => candidate.id === role);
  if (entry === undefined) {
    invalidConfig(
      `دورُ المراقبة ${role} غيرُ مُعلَنٍ في roles.yaml؛ ودورٌ لا وجودَ له لا تُقاس قدراتُه ولا يُحدَّ بها وكيل.`,
    );
  }
  return Object.freeze([...(entry.capabilities ?? [])]);
}

/**
 * @typedef {object} MonitorReadRequest
 * @property {string} actor معرّفُ الهويةِ القارئة — يُحقَّق في سجلِّ الهويات.
 * @property {string} [method] اسمُ النداءِ المقروء؛ افتراضُه `list`.
 * @property {string} [id] معرّفُ الصفِّ في `findById`.
 * @property {Record<string, unknown>} [filter] ترشيحٌ بحقولِ `filterable` وحدها.
 * @property {number} [limit] حدُّ الصفوفِ — لا يتجاوز `maxRows`.
 */

/**
 * @typedef {object} MonitorRepositoryLike
 * @property {{ name: string, table: string, filterable: readonly string[] }} spec
 */

/**
 * @typedef {object} MonitorLogLike
 * @property {(type: string, actor: string, data: Record<string, unknown>) => unknown} append
 */

/**
 * @typedef {object} MonitorAgentsLike
 * @property {(id: string) => Promise<Record<string, unknown> | null>} get
 */

/**
 * عقدُ القياسِ الموحَّدِ (`M10.01`) مكتوباً بنُيةِ الطرفِ لا باسمِ وحدتِه؛ فلا
 * تستورد طبقةُ الرصدِ من `src/telemetry/` شيئاً، ويبقى القياسُ محقوناً يُوصَل
 * في التركيب ويُرفَع في الاختبار. **والقياسُ يُضاف ولا يَحكم.**
 *
 * @typedef {object} MonitorSpanLike
 * @property {(key: string, value: string | number | boolean) => unknown} setAttribute
 */

/**
 * @typedef {object} MonitorTelemetryLike
 * @property {<T>(name: string, options: { attributes?: Record<string, string | number | boolean> }, fn: (span: MonitorSpanLike) => Promise<T>) => Promise<T>} span
 * @property {{ addCounter: (name: string, value?: number, attributes?: Record<string, string | number | boolean>) => void, recordHistogram: (name: string, value: number, attributes?: Record<string, string | number | boolean>) => void }} metrics
 */

/**
 * وكيلُ مراقبةٍ يقرأ ولا يكتب. لا يُصدِّر مشهداً ولا مستودعاً: المستودعاتُ في
 * حقلٍ خاصٍّ لا يُقرأ من خارجِ الصنف، والمشاهدُ أسطحٌ لا تحمل إلا القراءة، والقراءةُ
 * كلُّها تمرّ من `read` وحده — فلا قراءةَ بلا قيدِ تدقيق.
 */
export class MonitorAgent {
  /** @type {MonitoringPolicy} */
  #policy;
  /** @type {Map<string, import('./read-only-view.mjs').ReadOnlyView>} */
  #views = new Map();
  /** @type {Map<string, { name: string, table: string, filterable: readonly string[] }>} */
  #specs = new Map();
  /** @type {MonitorLogLike | null} */
  #log;
  /** @type {MonitorAgentsLike | null} */
  #agents;
  /** @type {MonitorTelemetryLike | null} */
  #telemetry;
  /** @type {() => Date} */
  #now;

  /**
   * @param {{ policy?: MonitoringPolicy, repositories?: Record<string, unknown>, agents?: MonitorAgentsLike | null, log?: MonitorLogLike | null, roleCapabilities?: readonly string[], telemetry?: MonitorTelemetryLike | null, now?: () => Date, dir?: string }} [deps]
   */
  constructor(deps = {}) {
    const policy =
      deps.policy ?? loadMonitoringPolicy(deps.dir === undefined ? {} : { dir: deps.dir });
    this.#policy = policy;
    this.#log = deps.log ?? null;
    this.#agents = deps.agents ?? null;
    this.#telemetry = deps.telemetry ?? null;
    this.#now = deps.now ?? (() => new Date());

    // ── حدُّ القدرات: يقع عند التركيب، وفي الاتجاهين ──
    const capabilities =
      deps.roleCapabilities ??
      readRoleCapabilities(
        deps.dir === undefined ? { role: policy.role } : { dir: deps.dir, role: policy.role },
      );
    const allowed = new Set(policy.allowedCapabilities);
    for (const capability of capabilities) {
      if (!allowed.has(capability)) {
        throw new MonitorError(
          MONITOR_ERRORS.CAPABILITY_FORBIDDEN,
          `دورُ المراقبة ${policy.role} يحمل القدرة «${capability}» وهي خارجُ القدراتِ المسموحة؛ ووكيلُ مراقبةٍ يملك قدرةً غيرَ مقروءةٍ لا يُركَّب — القدرةُ غيرُ المستعملةِ قدرة.`,
        );
      }
    }
    const held = new Set(capabilities);
    for (const capability of policy.allowedCapabilities) {
      if (!held.has(capability)) {
        throw new MonitorError(
          MONITOR_ERRORS.CAPABILITY_UNDECLARED,
          `القدرة «${capability}» معلَنةٌ في وثيقةِ المراقبةِ ولا يحملها الدور ${policy.role} في roles.yaml؛ والتقابلُ في الاتجاهين، فوثيقةٌ تَعِد بما لا يُملَك وثيقةٌ تكذب.`,
        );
      }
    }

    // ── تركيبُ المشاهد: مشهدٌ بلا مستودعٍ يمنع التركيب لا يُؤجَّل إلى أولِ قراءة ──
    const repositories = deps.repositories ?? {};
    for (const view of policy.views) {
      const repository = Object.hasOwn(repositories, view.registry)
        ? repositories[view.registry]
        : undefined;
      if (repository === null || typeof repository !== 'object') {
        throw new MonitorError(
          MONITOR_ERRORS.VIEW_NOT_COMPOSED,
          `المشهد «${view.id}» يُعلن المستودع «${view.registry}» وهو غيرُ مركَّب؛ ومشهدٌ يُعلَن ولا يُقرأ منه شيءٌ وعدٌ لا يُقاس.`,
        );
      }
      const bag = /** @type {Record<string, unknown>} */ (repository);
      const spec = bag['spec'];
      if (spec === null || typeof spec !== 'object') {
        throw new MonitorError(
          MONITOR_ERRORS.VIEW_NOT_COMPOSED,
          `المستودع «${view.registry}» بلا مواصفةٍ (‏spec)؛ وبلا مواصفةٍ لا يُعرَف جدولُه ولا حقولُ ترشيحه فلا يُحَدُّ سؤالٌ عليه.`,
        );
      }
      const specBag = /** @type {Record<string, unknown>} */ (spec);
      const table = specBag['table'];
      if (table !== view.entity) {
        throw new MonitorError(
          MONITOR_ERRORS.ENTITY_MISMATCH,
          `المشهد «${view.id}» يُعلن الجدول «${view.entity}» ومستودعُه يقرأ «${String(table)}»؛ واسمٌ في وثيقةٍ يخالف الجدولَ المقروءَ فعلاً يجعل قيدَ التدقيقِ يكذب على قارئه.`,
        );
      }
      const filterable = specBag['filterable'];
      /** @type {Record<string, import('./read-only-view.mjs').ReaderFn>} */
      const readers = {};
      for (const name of policy.readMethods) {
        const candidate = bag[name];
        if (typeof candidate !== 'function') {
          throw new MonitorError(
            MONITOR_ERRORS.VIEW_NOT_COMPOSED,
            `المستودع «${view.registry}» لا يملك النداءَ المقروء «${name}»؛ ومشهدٌ ينقصه نداءٌ مُعلَنٌ مشهدٌ يُخفق عند أولِ سؤالٍ صحيح.`,
          );
        }
        const fn = /** @type {(...args: unknown[]) => unknown} */ (candidate);
        // وهذا هو **حدُّ التخزينِ الحقيقيُّ**: الموضعُ الذي ينتقل فيه النداءُ
        // من وكيلِ المراقبةِ إلى المستودعِ نفسِه. وقياسُه هنا لا فيما فوقه يجعل
        // الزمنَ المقيسَ زمنَ المستودعِ وحدَه لا زمنَ الطبقةِ التي تحتويه؛ فمن قاس
        // الطبقةَ الفوقيةَ وحدَها رأى البطءَ ولم يرَ من سبَّبَه.
        const registry = view.registry;
        const entity = view.entity;
        readers[name] = async (/** @type {unknown[]} */ ...args) => {
          const telemetry = this.#telemetry;
          if (telemetry === null) return fn.apply(repository, args);
          /** @type {Record<string, string>} */
          const labels = { 'storage.registry': registry, 'storage.method': name };
          const startedMs = this.#now().getTime();
          try {
            return await telemetry.span(
              'storage.read',
              {
                attributes: {
                  'storage.registry': registry,
                  'storage.entity': entity,
                  'storage.method': name,
                },
              },
              async () => fn.apply(repository, args),
            );
          } finally {
            // العدُّ والمدَّةُ يُسجَّلان نجحَ النداءُ أم أخفق؛ فقراءةٌ أخفقت بعد
            // ثانيتين حملت المستودعَ ثانيتين، وإسقاطُها من القياسِ يُري التخزينَ
            // أسرعَ ممّا هو كلّما اشتدَّ عليه الضغط.
            telemetry.metrics.addCounter('storage.read.count', 1, labels);
            telemetry.metrics.recordHistogram(
              'storage.read.duration',
              this.#now().getTime() - startedMs,
              labels,
            );
          }
        };
      }
      this.#views.set(
        view.id,
        createReadOnlyView({
          viewId: view.id,
          entity: view.entity,
          readers: Object.freeze(readers),
        }),
      );
      this.#specs.set(view.id, {
        name: typeof specBag['name'] === 'string' ? specBag['name'] : view.registry,
        table: view.entity,
        filterable: Array.isArray(filterable)
          ? Object.freeze([...filterable].map(String))
          : Object.freeze([]),
      });
    }
  }

  /** @returns {MonitoringPolicy} */
  get policy() {
    return this.#policy;
  }

  /**
   * معرّفاتُ المشاهدِ المتاحة. لا يُعاد المشهدُ نفسُه: مشهدٌ في يدِ المستدعي قراءةٌ
   * تقع خارجَ التدقيق، وهو المسارُ الثاني الذي تمنعه هذه الوحدة.
   * @returns {readonly string[]}
   */
  views() {
    return Object.freeze([...this.#views.keys()]);
  }

  /**
   * قراءةٌ محكومة: تدقيقٌ ثم هويةٌ ثم مشهدٌ ثم نداءٌ ثم سؤالٌ محدود، ثم قيدٌ في
   * السجل، ثم القراءة. وكلُّ رفضٍ يُسجَّل برمزه قبل رميه — إلا رفضَ غيابِ السجلِّ
   * نفسِه، ولا موضعَ يُسجَّل فيه.
   * @param {string} viewId
   * @param {MonitorReadRequest} request
   * @returns {Promise<unknown>}
   */
  async read(viewId, request) {
    const telemetry = this.#telemetry;
    if (telemetry === null) return this.#readTraced(viewId, request, null);
    // مدًى ابنٌ حين يأتي النداءُ من البوابة (فيرث معرّفَ الأثرِ من السياقِ
    // الضمنيَّ بلا تمريرٍ يُنسَى)، ومدًى جذرٌ حين يُنادَى المشهدُ مباشرةً —
    // وكلتا الحالتين مُعلَنةٌ في `config/telemetry.yaml`.
    return telemetry.span(
      'monitor.read',
      {
        attributes: {
          'monitor.view': viewId,
          'monitor.method': typeof request?.method === 'string' ? request.method : 'list',
        },
      },
      (span) => this.#readTraced(viewId, request, span),
    );
  }

  /**
   * @param {string} viewId
   * @param {MonitorReadRequest} request
   * @param {MonitorSpanLike | null} span
   * @returns {Promise<unknown>}
   */
  async #readTraced(viewId, request, span) {
    const log = this.#log;
    if (log === null) {
      throw new MonitorError(
        MONITOR_ERRORS.AUDIT_REQUIRED,
        'سجلُّ الأحداثِ غيرُ موصولٍ بوكيلِ المراقبة؛ وقراءةٌ بلا أثرِ تدقيقٍ أسوأُ من قراءةٍ مرفوضة لأنها تقع ولا تُرى.',
      );
    }
    const actor = typeof request?.actor === 'string' ? request.actor.trim() : '';
    if (span !== null && actor !== '') span.setAttribute('monitor.actor', actor);
    try {
      return await this.#readChecked(viewId, request, actor, log);
    } catch (error) {
      const code =
        error instanceof MonitorError || error instanceof ReadOnlyViewError
          ? error.code
          : 'MONITOR_READ_FAILED';
      try {
        span?.setAttribute('monitor.refusal.code', code);
      } catch {
        // وسمٌ أخفق لا يُبدِّل الرفض؛ والقياسُ لا يَحكم.
      }
      try {
        log.append(this.#policy.audit.refusalEvent, actor === '' ? 'unknown' : actor, {
          view: viewId,
          method: typeof request?.method === 'string' ? request.method : 'list',
          code,
          reason: errorText(error),
        });
      } catch {
        // قيدُ الرفضِ لا يُبدِّل الرفض: من أخفق تسجيلُ رفضِه يبقى مرفوضاً، ولا
        // يُستبدَل خطأُ التسجيلِ بخطأِ السببِ فيُخفيه.
      }
      throw error;
    }
  }

  /**
   * @param {string} viewId
   * @param {MonitorReadRequest} request
   * @param {string} actor
   * @param {MonitorLogLike} log
   * @returns {Promise<unknown>}
   */
  async #readChecked(viewId, request, actor, log) {
    const policy = this.#policy;
    const agents = this.#agents;
    if (agents === null) {
      throw new MonitorError(
        MONITOR_ERRORS.IDENTITY_UNVERIFIED,
        'سجلُّ الهوياتِ غيرُ موصولٍ بوكيلِ المراقبة؛ وقراءةٌ بهويةٍ لا تُحقَّق قراءةٌ بلا فاعلٍ معروف (المادة 9).',
      );
    }
    if (actor === '') {
      throw new MonitorError(
        MONITOR_ERRORS.IDENTITY_UNVERIFIED,
        'القراءةُ بلا معرّفِ هويةٍ مرفوضة؛ وقيدُ تدقيقٍ بلا فاعلٍ قيدٌ لا يُسأل عنه أحد.',
      );
    }
    const view = this.#views.get(viewId);
    const spec = this.#specs.get(viewId);
    if (view === undefined || spec === undefined) {
      throw new MonitorError(
        MONITOR_ERRORS.VIEW_UNKNOWN,
        `المشهد «${viewId}» غيرُ مُعلَنٍ في وثيقةِ المراقبة؛ والمشاهدُ بياناتٌ في الوثيقةِ لا أسماءٌ يخترعها المستدعي.`,
      );
    }
    const method = typeof request.method === 'string' ? request.method : 'list';
    if (!policy.readMethods.includes(method)) {
      throw new MonitorError(
        MONITOR_ERRORS.WRITE_FORBIDDEN,
        `النداء «${method}» غيرُ مُعلَنٍ مقروءاً؛ وكلُّ ما ليس قراءةً مُعلَنةً مرفوضٌ من هذا المسارِ بنيوياً — بما فيه كلُّ كتابة.`,
      );
    }
    const args = this.#buildArgs(method, request, spec);

    // ── الهوية: مسجَّلةٌ، عاملةٌ الآن، وبدورِ المراقبةِ نفسِه ──
    const record = await agents.get(actor);
    if (record === null) {
      throw new MonitorError(
        MONITOR_ERRORS.IDENTITY_UNVERIFIED,
        `الهوية «${actor}» غيرُ مسجَّلةٍ في سجلِّ الهويات؛ ومن ليس هويةً مسجَّلةً لا يقرأ حالَ الدولة.`,
      );
    }
    const state = record['state'];
    if (state !== 'active') {
      throw new MonitorError(
        MONITOR_ERRORS.IDENTITY_UNVERIFIED,
        `الهوية «${actor}» حالُها «${String(state)}» لا «active»؛ ومن عُلِّق أو حُجِر أو سُحبت صلاحيتُه لا يقرأ.`,
      );
    }
    const role = record['role'];
    if (role !== policy.role) {
      throw new MonitorError(
        MONITOR_ERRORS.IDENTITY_UNVERIFIED,
        `الهوية «${actor}» دورُها «${String(role)}» لا دورَ المراقبة «${policy.role}»؛ ومسارُ المراقبةِ لدورِه المُعلَنِ وحده.`,
      );
    }

    // ── القيدُ قبل الأثر: الحدُّ المُعلَن رقم 1 في رأسِ هذه الوحدة ──
    log.append(policy.audit.readEvent, actor, {
      view: viewId,
      entity: spec.table,
      method,
      ...(request.id === undefined ? {} : { id: request.id }),
      ...(request.filter === undefined ? {} : { filterKeys: Object.keys(request.filter) }),
      ...(request.limit === undefined ? {} : { limit: request.limit }),
    });

    return view.read(method, args);
  }

  /**
   * يبني وسائطَ النداءِ المقروءِ ويحدُّها. ونداءٌ مقروءٌ بلا بناءِ وسائطَ مُعلَنٍ
   * يُردّ: السقوطُ إلى «بلا وسائط» كان سيعني مسحاً كاملاً بلا حدٍّ ولا ترشيح.
   * @param {string} method
   * @param {MonitorReadRequest} request
   * @param {{ filterable: readonly string[] }} spec
   * @returns {readonly unknown[]}
   */
  #buildArgs(method, request, spec) {
    const policy = this.#policy;
    if (method === 'findById') {
      const id = typeof request.id === 'string' ? request.id.trim() : '';
      if (id === '') {
        throw new MonitorError(
          MONITOR_ERRORS.QUERY_UNSUPPORTED,
          'النداء findById بلا معرّفٍ نصّيٍّ غيرِ فارغ؛ ومعرّفٌ غائبٌ سؤالٌ لا جواب له.',
        );
      }
      return Object.freeze([id]);
    }
    const filter = this.#checkFilter(request.filter, spec);
    if (method === 'count') {
      return Object.freeze([filter]);
    }
    if (method === 'list') {
      const limit = request.limit === undefined ? policy.maxRows : request.limit;
      if (!Number.isInteger(limit) || limit < 1 || limit > policy.maxRows) {
        throw new MonitorError(
          MONITOR_ERRORS.QUERY_UNSUPPORTED,
          `الحدّ ${String(request.limit)} غيرُ مقبول؛ والمقبولُ عددٌ صحيحٌ بين 1 و${policy.maxRows} — ومسحٌ بلا حدٍّ يُخفي كلفتَه ليس قراءةً محكومة.`,
        );
      }
      return Object.freeze([Object.freeze({ filter, limit })]);
    }
    throw new MonitorError(
      MONITOR_ERRORS.QUERY_UNSUPPORTED,
      `النداء «${method}» مُعلَنٌ مقروءاً ولا بناءَ وسائطَ له في هذه الوحدة؛ والفشلُ مغلق: لا يُنادى نداءٌ بوسائطَ مُخمَّنة.`,
    );
  }

  /**
   * @param {Record<string, unknown> | undefined} filter
   * @param {{ filterable: readonly string[] }} spec
   * @returns {Record<string, unknown>}
   */
  #checkFilter(filter, spec) {
    if (filter === undefined) return {};
    if (filter === null || typeof filter !== 'object' || Array.isArray(filter)) {
      throw new MonitorError(
        MONITOR_ERRORS.QUERY_UNSUPPORTED,
        'الترشيحُ يجب أن يكون كائناً بحقولٍ مُعلَنةٍ قابلةٍ للترشيح؛ وترشيحٌ بشكلٍ آخر سؤالٌ لا تُقرأ حدودُه.',
      );
    }
    for (const key of Object.keys(filter)) {
      if (!spec.filterable.includes(key)) {
        throw new MonitorError(
          MONITOR_ERRORS.QUERY_UNSUPPORTED,
          `الترشيحُ بالحقل «${key}» غيرُ مسموح؛ والمسموحُ حقولُ filterable في مواصفةِ السجل: ${spec.filterable.join(', ') || '—'}.`,
        );
      }
    }
    return { ...filter };
  }
}
