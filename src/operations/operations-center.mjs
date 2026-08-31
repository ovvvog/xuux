/**
 * مركزُ العمليات — الخطوة `M9.05`.
 *
 * **العيبُ الذي تُغلقه هذه الوحدة:** كان التشغيلُ **مقروءاً ولا مرئيّاً**.
 * `M9.01` فتحت مشهداً آمناً للقراءة، و`M9.02` أعلنت مساراتٍ مُدقَّقةً، و`M9.03`
 * أجلست الملكَ في ديوانٍ يرى الحالةَ ويُصدر الأمرَ، و`M9.04` حصَّنت سلطتَه
 * بعاملٍ ثانٍ. ولا موضعَ واحدٌ يقول **الآنَ**: هل النظامُ صحيح؟ ما المهامُ
 * الجارية؟ أيُّ حادثةٍ وقعت؟ أين السعةُ من حدِّها؟ وما التكلفةُ المستهلَكة؟
 * فمن أراد أن يعرف قرأ سجلَّ أحداثٍ بيدِه وحسب الحصصَ ذهناً — وذاك ليس تشغيلاً
 * مرئيّاً بل تشغيلٌ يُستنبَط.
 *
 * **القاعدةُ الحاكمة:** المركزُ سطحُ قراءةٍ وحده. لا مِقبضَ كتابةٍ فيه ولا مستودعَ
 * في يدِه: ما كان من لوحاتِه على مسارٍ فمن طبقةِ الواجهةِ المُدقَّقةِ وحدها (فيَرِث
 * الجلسةَ والحدَّ والتفويضَ والتدقيق كما يفعل الديوانُ في `M9.03`)، وما كان
 * داخليّاً فمن مزوِّدٍ مُمرَّرٍ إليه عند التركيبِ لا يخترعه ولا يستبدله بصفرٍ
 * مُطمئنٍ عند غيابِه.
 *
 * **معيارُ قبولِ الخطوةِ بحرفه** («حادثةٌ مُصطنعةٌ تظهر في الواجهةِ خلال مهلةٍ
 * معلَنة») مقيسٌ هنا على **ساعةٍ مُمرَّرة** (`nowMs`) لا على ساعةِ النظامِ المباشرة:
 * الحادثةُ تُقيَّد في السجلِّ الدائمِ ثم تدخل الذاكرةَ بطابعِ زمنِها، وأولُ قراءةٍ
 * للوحةِ الحوادثِ تُثبِّت زمنَ ظهورِها الأولَ فيُحسَب فرقُه بالمهلةِ المُعلَنةِ في
 * `config/operations-center.yaml`. والمهلةُ **رقمٌ في الوثيقةِ** لا ثابتٌ في
 * الكود، والتفويتُ رفضٌ مُسمّىً (`OPERATIONS_VISIBILITY_MISSED`) يُكتب في السجلِّ
 * ولا يُخفي الحادثةَ: تبقى ظاهرةً موسومةً بتأخُّرِها.
 *
 * **ترتيبُ العقباتِ على تسجيلِ حادثة (لا يُقلب):**
 * 1. **سجلٌّ دائمٌ موصول** — وبلا موضعٍ يُشهَد فيه لا حادثةَ (`OPERATIONS_AUDIT_REQUIRED`).
 * 2. **ساعةٌ صالحة** تُعطي عدداً منتهياً غيرَ سالبٍ (`OPERATIONS_CLOCK_INVALID`).
 * 3. **حقولٌ لازمةٌ كاملةٌ** كما تُعلنها الوثيقةُ (`OPERATIONS_INCIDENT_INVALID`).
 * 4. **درجةٌ معلَنةٌ** (`OPERATIONS_SEVERITY_UNDECLARED`).
 * 5. **معرّفٌ لم يُستهلَك** (`OPERATIONS_INCIDENT_REPLAYED`).
 * 6. **سعةٌ باقيةٌ** (`OPERATIONS_INCIDENT_OVERFLOW`) — رفضٌ مُسمّىً لا إسقاطٌ
 *    صامتٌ لأقدمِ حادثة؛ فمن أسقط حادثةً كي يقبل أخرى بنى عمًى في موضعِ الرؤية.
 * 7. **قيدٌ في السجلِّ الدائمِ قبل** دخولِ الحادثةِ الذاكرةَ.
 *
 * **حدودٌ معلَنة:**
 * 1. **سجلُّ الحوادثِ في ذاكرةِ العملية** فيزول بإعادةِ التشغيلِ ولا يعرفه عنقودٌ
 *    من عدّةِ نسخ — وهو نفسُ حدِّ جلسةِ `M9.02` وجلسةِ `M9.04`، والمخزنُ المشتركُ
 *    قرارُ تشغيلٍ في `M10`. والأثرُ الدائمُ للحادثةِ **قيدُها في السجل** لا صفُّها
 *    في اللوحة، فما يزول هو العرضُ لا الشهادة.
 * 2. **لا طبقةَ نقلٍ ولا واجهةَ رسوميّة.** «الواجهة» في هذه الخطوةِ عقدُ نداءٍ
 *    مُعلَنٌ ومُدقَّقٌ كحالِ الديوانِ نفسِه، ومحوِّلُ النقلِ دَينٌ مُسنَدٌ إلى `M10`.
 * 3. **الاستهلاكُ يُقرأ من مزوِّدٍ خارجَ الوحدة.** المركزُ لا يحسب حصّةً ولا يخصم
 *    عليها؛ فإن لم يُمرَّر مزوِّدٌ للسعةِ أو التكلفةِ فاللوحةُ **تُرَدُّ** بـ
 *    `OPERATIONS_SOURCE_MISSING` ولا تُقرأ فارغةً.
 * 4. **لا جدولةَ ولا تصعيدَ ولا إجراءَ طوارئ هنا.** الحادثةُ تُرى ولا تُدار:
 *    غرفةُ الأزماتِ نصُّ `M9.06`، وعارضُ سجلِّ التدقيقِ نصُّ `M9.07`.
 * 5. **مسبارُ الصحةِ الذي يرمي يُقرأ «مُخفِقاً» بنصِّ خطئِه** لا يُسقِط اللوحةَ
 *    كلَّها: لوحةُ صحةٍ تسقط بسقوطِ مسبارٍ واحدٍ تُعمي عن التسعةِ الباقية.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import Ajv2020Default from 'ajv/dist/2020.js';

// وحزمةُ Ajv تُصدِّر صنفَها افتراضاً في ESM، فيُقرأ نوعُه صريحاً وإلا صار «غيرَ
// قابلٍ للإنشاء» في الفحصِ الصارم — كما في طبقةِ الواجهةِ والديوانِ ووحدةِ المراقبة.
const Ajv2020 = /** @type {typeof import('ajv/dist/2020.js').Ajv2020} */ (
  /** @type {unknown} */ (Ajv2020Default)
);
import YAML from 'yaml';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** مجلَّدُ الإعداداتِ الافتراضيُّ لمركزِ العمليات. */
export const DEFAULT_OPERATIONS_CONFIG_DIR = path.resolve(HERE, '..', '..', 'config');

/** رموزُ رفضِ مركزِ العمليات — كلُّها مُعلَنةٌ في `config/operations-center.yaml`. */
export const OPERATIONS_ERRORS = Object.freeze({
  CONFIG_INVALID: 'OPERATIONS_CONFIG_INVALID',
  AUDIT_REQUIRED: 'OPERATIONS_AUDIT_REQUIRED',
  PANEL_UNDECLARED: 'OPERATIONS_PANEL_UNDECLARED',
  GATEWAY_REQUIRED: 'OPERATIONS_GATEWAY_REQUIRED',
  PANEL_REFUSED: 'OPERATIONS_PANEL_REFUSED',
  SOURCE_MISSING: 'OPERATIONS_SOURCE_MISSING',
  INCIDENT_INVALID: 'OPERATIONS_INCIDENT_INVALID',
  SEVERITY_UNDECLARED: 'OPERATIONS_SEVERITY_UNDECLARED',
  INCIDENT_REPLAYED: 'OPERATIONS_INCIDENT_REPLAYED',
  INCIDENT_OVERFLOW: 'OPERATIONS_INCIDENT_OVERFLOW',
  CLOCK_INVALID: 'OPERATIONS_CLOCK_INVALID',
  VISIBILITY_MISSED: 'OPERATIONS_VISIBILITY_MISSED',
  INCIDENT_UNKNOWN: 'OPERATIONS_INCIDENT_UNKNOWN',
});

/**
 * أوجهُ مركزِ العملياتِ الخمسةُ كما ينصُّ عليها معيارُ الخطوةِ بأسمائها — **حدٌّ في
 * الكودِ يقابله حاجزٌ على الوثيقة**: كلُّ وجهٍ لوحةٌ واحدةٌ لا أكثرَ ولا أقلّ، فمن
 * أعلن أربعةً أعلن مركزَ عملياتٍ أعمى عن وجهٍ سُمِّي في الخطوة.
 */
export const OPERATIONS_FACES = Object.freeze(['health', 'tasks', 'incidents', 'capacity', 'cost']);

/** الأوجهُ التي تُعلن مواردَ حصصٍ بأسمائها من `config/quotas.yaml`. */
export const QUOTA_FACES = Object.freeze(['capacity', 'cost']);

/** خطأُ مركزِ العملياتِ برمزٍ مُعلَن. */
export class OperationsError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   * @param {Record<string, unknown>} [detail]
   * @param {{ cause?: unknown }} [options] سببٌ أصليٌّ يُربَط بالعَرَض، فرفضُ
   *   الطبقةِ الأدنى لا يضيع خلف رمزِ الطبقةِ الأعلى.
   */
  constructor(code, message, detail = {}, options = {}) {
    super(message, 'cause' in options ? { cause: options.cause } : undefined);
    this.name = 'OperationsError';
    this.code = code;
    this.detail = Object.freeze({ ...detail });
  }
}

/**
 * @param {string} message
 * @returns {never}
 */
function invalidConfig(message) {
  throw new OperationsError(OPERATIONS_ERRORS.CONFIG_INVALID, message);
}

/**
 * @param {unknown} error
 * @returns {string}
 */
function errorText(error) {
  return error instanceof Error ? error.message : String(error);
}

/**
 * رمزُ الخطأِ الأصليُّ إن حمله وإلا رأسُ نصِّه: أخطاءُ طبقةِ الواجهةِ ترفع رمزاً،
 * وبعضُ ما تحتها يرفع نصّاً — فيُقرأ الرأسُ رمزاً كي لا يضيع السببُ في التغليف.
 * @param {unknown} error
 * @returns {string}
 */
function codeOf(error) {
  const candidate = /** @type {{ code?: unknown }} */ (error)?.code;
  if (typeof candidate === 'string' && candidate !== '') return candidate;
  const head = errorText(error).split(':')[0] ?? '';
  return /^[A-Z][A-Z_]+$/.test(head) ? head : 'OPERATIONS_CALL_FAILED';
}

/**
 * تجميدٌ عميقٌ للصفوفِ المُعادة: اللوحةُ صورةٌ لا مرجعُ حالةٍ حيّة، فمن قرأها لم
 * يملك بذلك يداً على ما تحتها.
 * @template T
 * @param {T} value
 * @returns {T}
 */
function deepFreeze(value) {
  if (value === null || typeof value !== 'object') return value;
  if (Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const key of Object.keys(value)) {
    deepFreeze(/** @type {Record<string, unknown>} */ (value)[key]);
  }
  return value;
}

/**
 * @typedef {object} OperationsPanelSpec
 * @property {string} id
 * @property {'health' | 'tasks' | 'incidents' | 'capacity' | 'cost'} face
 * @property {string} source
 * @property {string} purpose
 * @property {readonly string[]} [resources]
 */

/**
 * @typedef {object} OperationsPolicy
 * @property {number} version
 * @property {string} statement
 * @property {{ panelEvent: string, panelRefusedEvent: string, incidentEvent: string, incidentRefusedEvent: string, statement: string }} audit
 * @property {{ deadlineMs: number, statement: string }} visibility
 * @property {{ maxOpen: number, severities: readonly string[], requiredFields: readonly string[], statement: string }} incidents
 * @property {readonly string[]} refusalCodes
 * @property {readonly OperationsPanelSpec[]} panels
 * @property {ReadonlyArray<{ id: string, statement: string, enforcedBy: string, codes: readonly string[] }>} guarantees
 */

/**
 * يقرأ وثيقةَ مركزِ العملياتِ ويتحقّق منها بمخطَّطها ثم بفحوصِ تماسكٍ لا يُعبِّر
 * عنها مخطَّط: لا معرّفَ لوحةٍ مكرَّر، والأوجهُ الخمسةُ كلُّها معلَنةٌ **مرّةً
 * واحدة**، ومصدرُ اللوحةِ الداخليةِ يطابق وجهَها، ولوحاتُ الحصصِ وحدَها تُعلن
 * مواردَ، ورموزُ الرفضِ المُعلَنةُ مطابقةٌ لرموزِ الكودِ **في الاتجاهين**، وحقلا
 * `id` و`severity` لازمانِ في كلِّ حادثة.
 * @param {{ dir?: string }} [options]
 * @returns {OperationsPolicy}
 */
export function loadOperationsPolicy(options = {}) {
  const dir = options.dir ?? DEFAULT_OPERATIONS_CONFIG_DIR;
  const schemaDir = fs.existsSync(path.join(dir, 'schemas')) ? dir : DEFAULT_OPERATIONS_CONFIG_DIR;
  const file = path.join(dir, 'operations-center.yaml');
  if (!fs.existsSync(file)) {
    invalidConfig(
      'وثيقةُ مركزِ العملياتِ غائبة؛ ومركزٌ بلا وثيقةٍ تُعلن لوحاتَه ومهلتَه مركزٌ حدُّه نيّةُ كاتبِه.',
    );
  }
  /** @type {unknown} */
  let raw;
  try {
    raw = YAML.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    invalidConfig(`تعذّرت قراءة operations-center.yaml: ${errorText(error)}`);
  }
  const schemaPath = path.join(schemaDir, 'schemas', 'operations-center.schema.json');
  if (!fs.existsSync(schemaPath)) {
    invalidConfig(
      'مخطَّطُ وثيقةِ مركزِ العملياتِ غائب؛ وبلا مخطَّطٍ يصير إعلانُ اللوحاتِ نصّاً حرّاً كالذي جاء ليمنعه.',
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
    invalidConfig(`operations-center.yaml يخالف مخطَّطه: ${problems}`);
  }
  const parsed = /** @type {OperationsPolicy} */ (raw);

  // ── فحوصُ تماسكٍ لا يُعبِّر عنها مخطَّط ──

  /** @type {Set<string>} */
  const panelIds = new Set();
  /** @type {Map<string, string>} */
  const facePanel = new Map();
  for (const panel of parsed.panels) {
    if (panelIds.has(panel.id)) {
      invalidConfig(
        `اللوحة ${panel.id} مُعلَنةٌ مرّتين؛ ولا لوحتانِ بمعرّفٍ واحدٍ تُقرأ إحداهما بالأخرى.`,
      );
    }
    panelIds.add(panel.id);
    const already = facePanel.get(panel.face);
    if (already !== undefined) {
      invalidConfig(
        `الوجه «${panel.face}» له لوحتان (${already} و${panel.id})؛ ووجهٌ بلوحتين وجهٌ لا يُعرف أيُّهما يُقرأ عند سؤالٍ واحد.`,
      );
    }
    facePanel.set(panel.face, panel.id);
    if (panel.source.startsWith('internal:')) {
      const internalFace = panel.source.slice('internal:'.length);
      if (internalFace !== panel.face) {
        invalidConfig(
          `اللوحة ${panel.id} وجهُها «${panel.face}» ومصدرُها الداخليُّ «${internalFace}»؛ ومصدرٌ يخالف وجهَه يعرض شيئاً باسمِ شيءٍ آخر.`,
        );
      }
    } else if (!panel.source.startsWith('route:')) {
      invalidConfig(
        `اللوحة ${panel.id} مصدرُها «${panel.source}» وهو ليس مساراً ولا مزوِّداً داخليّاً معلَناً.`,
      );
    }
    const needsResources = QUOTA_FACES.includes(panel.face);
    const hasResources = Array.isArray(panel.resources) && panel.resources.length > 0;
    if (needsResources && !hasResources) {
      invalidConfig(
        `اللوحة ${panel.id} وجهُها «${panel.face}» ولا تُعلن مواردَ حصصٍ؛ ولوحةُ حصصٍ بلا مواردَ معلَنةٍ تقسِم الحصصَ بحدسِ الكودِ لا بالوثيقة.`,
      );
    }
    if (!needsResources && hasResources) {
      invalidConfig(
        `اللوحة ${panel.id} وجهُها «${panel.face}» وتُعلن مواردَ حصصٍ؛ ومواردُ على وجهٍ لا يقرأها إعلانٌ لا أثرَ له.`,
      );
    }
  }
  for (const face of OPERATIONS_FACES) {
    if (!facePanel.has(face)) {
      invalidConfig(
        `الوجه «${face}» بلا لوحةٍ معلَنة؛ ونصُّ الخطوةِ يُسمّي الأوجهَ الخمسةَ (${OPERATIONS_FACES.join('، ')}) فمركزٌ ناقصُ وجهٍ مركزٌ أعمى عمًى مُعلَناً.`,
      );
    }
  }

  /** @type {Set<string>} */
  const declaredResources = new Set();
  for (const panel of parsed.panels) {
    for (const resource of panel.resources ?? []) {
      if (declaredResources.has(resource)) {
        invalidConfig(
          `الموردُ «${resource}» معلَنٌ على لوحتين؛ وحصّةٌ تُعرَض مرّتين تُحسَب مرّتين في عينِ قارئها.`,
        );
      }
      declaredResources.add(resource);
    }
  }

  for (const field of ['id', 'severity']) {
    if (!parsed.incidents.requiredFields.includes(field)) {
      invalidConfig(
        `الحقل «${field}» غيرُ لازمٍ في وثيقةِ الحوادث؛ وحادثةٌ بلا ${field} لا تُميَّز ولا تُدرَج في درجةٍ.`,
      );
    }
  }

  /** @type {Set<string>} */
  const declared = new Set(Object.values(OPERATIONS_ERRORS));
  /** @type {Set<string>} */
  const listed = new Set(parsed.refusalCodes);
  for (const code of declared) {
    if (!listed.has(code)) {
      invalidConfig(
        `الرمز ${code} يرفعه الكودُ ولا إعلانَ له في الوثيقة؛ ورفضٌ بلا نصٍّ يُعلنه رفضٌ يُفاجئ قارئه.`,
      );
    }
  }
  for (const code of listed) {
    if (!declared.has(code)) {
      invalidConfig(
        `الرمز ${code} مُعلَنٌ في الوثيقةِ ولا يرفعه كودٌ؛ ووثيقةٌ تَعِد برفضٍ لا يقع وثيقةٌ تكذب.`,
      );
    }
  }
  for (const guarantee of parsed.guarantees) {
    for (const code of guarantee.codes) {
      if (!listed.has(code)) {
        invalidConfig(
          `الضمان ${guarantee.id} يُشير إلى الرمز ${code} وهو غيرُ مُعلَنٍ في refusalCodes.`,
        );
      }
    }
  }

  return Object.freeze({
    version: parsed.version,
    statement: parsed.statement,
    audit: Object.freeze({ ...parsed.audit }),
    visibility: Object.freeze({ ...parsed.visibility }),
    incidents: Object.freeze({
      maxOpen: parsed.incidents.maxOpen,
      severities: Object.freeze([...parsed.incidents.severities]),
      requiredFields: Object.freeze([...parsed.incidents.requiredFields]),
      statement: parsed.incidents.statement,
    }),
    refusalCodes: Object.freeze([...parsed.refusalCodes]),
    panels: Object.freeze(
      parsed.panels.map((panel) =>
        Object.freeze(
          panel.resources === undefined
            ? { ...panel }
            : { ...panel, resources: Object.freeze([...panel.resources]) },
        ),
      ),
    ),
    guarantees: Object.freeze(
      parsed.guarantees.map((entry) =>
        Object.freeze({ ...entry, codes: Object.freeze([...entry.codes]) }),
      ),
    ),
  });
}

/**
 * والعقدُ يُكتب بأنواعِ الطرفِ الحقيقيِّ نفسِه لا بنوعٍ فضفاضٍ يشبهه — كما في
 * الديوانِ الملكيّ.
 *
 * @typedef {object} OperationsGatewayLike
 * @property {(request: { route: string, token?: string, params?: Record<string, unknown> }) => Promise<{ route: string, policyId: string | null, session: string, data: unknown }>} call
 */

/**
 * @typedef {object} OperationsLogLike
 * @property {(type: string, actor: string, data: Record<string, unknown>) => unknown} append
 */

/**
 * مسبارُ صحةٍ: اسمٌ ونداءٌ يعيد حالاً. والمركزُ لا يعرف كيف يُقاس شيءٌ، يعرف أن
 * يسأل ويعرض ما قيل له.
 * @typedef {object} HealthProbeLike
 * @property {string} id
 * @property {() => { status: string, detail?: string } | Promise<{ status: string, detail?: string }>} check
 */

/**
 * مزوِّدُ استهلاكِ الحصص: يُسأل عن موردٍ معلَنٍ فيعيد حدَّه ومستهلَكَه؛ ومستهلَكٌ
 * غيرُ مقيسٍ يُعاد `null` صريحاً لا صفراً مُطمئناً.
 * @typedef {object} QuotaReaderLike
 * @property {(resource: string) => { resource: string, limit: number, consumed: number | null, unit: string | null, windowSeconds: number }} read
 */

/**
 * مركزُ العمليات: مِقبضُ قراءةٍ واحدٌ (`panel`)، ومِقبضُ تسجيلِ حادثةٍ واحدٌ
 * (`record`)، ومِقبضُ قياسِ مهلةٍ واحدٌ (`assertVisible`)، ولا رابعَ. ولا مستودعَ
 * في حقولِه ولا مِقبضَ كتابةٍ في شيءٍ تحته.
 */
export class OperationsCenter {
  /** @type {OperationsPolicy} */
  #policy;
  /** @type {Map<string, OperationsPanelSpec>} */
  #panels = new Map();
  /** @type {OperationsGatewayLike | null} */
  #gateway;
  /** @type {OperationsLogLike | null} */
  #log;
  /** @type {readonly HealthProbeLike[] | null} */
  #probes;
  /** @type {QuotaReaderLike | null} */
  #quotas;
  /** @type {() => number} */
  #nowMs;
  /** @type {Map<string, { id: string, severity: string, title: string, source: string, detail: Record<string, unknown>, recordedAtMs: number, firstSeenAtMs: number | null }>} */
  #incidents = new Map();

  /**
   * @param {{ policy?: OperationsPolicy, dir?: string, gateway?: OperationsGatewayLike | null, log?: OperationsLogLike | null, healthProbes?: readonly HealthProbeLike[] | null, quotaReader?: QuotaReaderLike | null, nowMs?: () => number }} [deps]
   */
  constructor(deps = {}) {
    this.#policy =
      deps.policy ?? loadOperationsPolicy(deps.dir === undefined ? {} : { dir: deps.dir });
    this.#gateway = deps.gateway ?? null;
    this.#log = deps.log ?? null;
    this.#probes = deps.healthProbes ?? null;
    this.#quotas = deps.quotaReader ?? null;
    this.#nowMs = deps.nowMs ?? (() => Date.now());
    for (const panel of this.#policy.panels) this.#panels.set(panel.id, panel);
  }

  /** @returns {OperationsPolicy} */
  get policy() {
    return this.#policy;
  }

  /** @returns {number} المهلةُ المُعلَنةُ لظهورِ الحادثةِ — من الوثيقةِ لا من الكود. */
  get deadlineMs() {
    return this.#policy.visibility.deadlineMs;
  }

  /**
   * وصفُ ما يملكه المركزُ من لوحاتٍ ومهلةٍ ودرجاتٍ — بياناتٌ تُقرأ لا مِقبضٌ
   * يُنفَّذ به شيء.
   * @returns {{ panels: ReadonlyArray<{ id: string, face: string, source: string, purpose: string, resources: readonly string[] }>, deadlineMs: number, severities: readonly string[], maxOpen: number, openIncidents: number }}
   */
  describe() {
    return deepFreeze({
      panels: [...this.#panels.values()].map((panel) => ({
        id: panel.id,
        face: panel.face,
        source: panel.source,
        purpose: panel.purpose,
        resources: [...(panel.resources ?? [])],
      })),
      deadlineMs: this.deadlineMs,
      severities: [...this.#policy.incidents.severities],
      maxOpen: this.#policy.incidents.maxOpen,
      openIncidents: this.#incidents.size,
    });
  }

  /**
   * السجلُّ الدائمُ أو رفضٌ مُسمّى — العقبةُ الأولى على كلِّ مِقبض.
   * @returns {OperationsLogLike}
   */
  #requireLog() {
    const log = this.#log;
    if (log === null) {
      throw new OperationsError(
        OPERATIONS_ERRORS.AUDIT_REQUIRED,
        'السجلُّ الدائمُ غيرُ موصولٍ بمركزِ العمليات؛ وتشغيلٌ يُرى بلا أثرٍ يشهد على من رآه ومتى ليس تشغيلاً مُدقَّقاً.',
      );
    }
    return log;
  }

  /**
   * قراءةُ الساعةِ المُمرَّرةِ مع التحقُّق: ساعةٌ تُعطي غيرَ عددٍ منتهٍ غيرِ سالبٍ
   * تُرَدُّ برمزٍ مُعلَنٍ ولا يُقاس عليها ظهورٌ ولا تأخُّر.
   * @param {string} where
   * @returns {number}
   */
  #clock(where) {
    const value = this.#nowMs();
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
      throw new OperationsError(
        OPERATIONS_ERRORS.CLOCK_INVALID,
        `الساعةُ المُمرَّرةُ أعطت «${String(value)}» عند ${where}؛ ومهلةٌ تُقاس بساعةٍ لا تُعطي عدداً منتهياً غيرَ سالبٍ مهلةٌ لا معنى لقياسِها.`,
        { where, value: String(value) },
      );
    }
    return value;
  }

  /**
   * قيدُ رفضٍ في السجلِّ الدائمِ ثم رفعُ الخطأ: الرفضُ يُكتب كما يُكتب القبول.
   * @param {'panel' | 'incident'} kind
   * @param {string} actor
   * @param {OperationsError} error
   * @param {Record<string, unknown>} data
   * @returns {never}
   */
  #refuse(kind, actor, error, data) {
    const log = this.#log;
    if (log !== null) {
      const type =
        kind === 'panel'
          ? this.#policy.audit.panelRefusedEvent
          : this.#policy.audit.incidentRefusedEvent;
      log.append(type, actor, { ...data, code: error.code, reason: error.message });
    }
    throw error;
  }

  /**
   * تسجيلُ حادثة — بترتيبِ العقباتِ المُعلَنِ في رأسِ الملفّ، والقيدُ قبل الأثر.
   * @param {{ id?: unknown, severity?: unknown, title?: unknown, source?: unknown, detail?: Record<string, unknown> }} incident
   * @param {{ actor?: string }} [context]
   * @returns {{ id: string, severity: string, title: string, source: string, recordedAtMs: number, deadlineMs: number }}
   */
  record(incident, context = {}) {
    const actor = context.actor ?? 'operations:center';
    this.#requireLog();
    const recordedAtMs = this.#clock('تسجيلِ حادثة');

    if (incident === null || typeof incident !== 'object') {
      this.#refuse(
        'incident',
        actor,
        new OperationsError(
          OPERATIONS_ERRORS.INCIDENT_INVALID,
          'الحادثةُ ليست كائناً؛ وحادثةٌ بلا حقولٍ حادثةٌ لا يُقرأ منها شيء.',
        ),
        {},
      );
    }
    /** @type {Record<string, unknown>} */
    const raw = /** @type {Record<string, unknown>} */ (incident);
    for (const field of this.#policy.incidents.requiredFields) {
      const value = raw[field];
      if (typeof value !== 'string' || value.trim() === '') {
        this.#refuse(
          'incident',
          actor,
          new OperationsError(
            OPERATIONS_ERRORS.INCIDENT_INVALID,
            `الحادثةُ بلا الحقلِ اللازمِ «${field}»؛ والحقولُ اللازمةُ معلَنةٌ في وثيقةِ مركزِ العملياتِ لا تُستنبَط.`,
            { field },
          ),
          { field },
        );
      }
    }
    const id = String(raw['id']).trim();
    const severity = String(raw['severity']).trim();
    const title = String(raw['title']).trim();
    const source = String(raw['source']).trim();

    if (!this.#policy.incidents.severities.includes(severity)) {
      this.#refuse(
        'incident',
        actor,
        new OperationsError(
          OPERATIONS_ERRORS.SEVERITY_UNDECLARED,
          `الدرجة «${severity}» غيرُ معلَنةٍ في وثيقةِ مركزِ العمليات؛ والدرجاتُ المُعلَنةُ ${this.#policy.incidents.severities.join('، ')} — ودرجةٌ يخترعها المُنادي درجةٌ لا يُعرف ثقلُها.`,
          { severity },
        ),
        { incident: id, severity },
      );
    }
    if (this.#incidents.has(id)) {
      this.#refuse(
        'incident',
        actor,
        new OperationsError(
          OPERATIONS_ERRORS.INCIDENT_REPLAYED,
          `الحادثة «${id}» مُسجَّلةٌ سابقاً؛ ومعرّفٌ يُعاد يُخفي حادثةً بأخرى ويُفسِد قياسَ زمنِ ظهورِ الأولى.`,
          { incident: id },
        ),
        { incident: id },
      );
    }
    if (this.#incidents.size >= this.#policy.incidents.maxOpen) {
      this.#refuse(
        'incident',
        actor,
        new OperationsError(
          OPERATIONS_ERRORS.INCIDENT_OVERFLOW,
          `سجلُّ الحوادثِ بلغ سعتَه المُعلَنةَ (${this.#policy.incidents.maxOpen})؛ والرفضُ مُسمّىً لا إسقاطَ أقدمِ حادثةٍ بصمت — فمن أسقط حادثةً كي يقبل أخرى بنى عمًى في موضعِ الرؤية.`,
          { maxOpen: this.#policy.incidents.maxOpen },
        ),
        { incident: id, maxOpen: this.#policy.incidents.maxOpen },
      );
    }

    // القيدُ قبل الأثر: تُكتب الشهادةُ في السجلِّ الدائمِ ثم تدخل الحادثةُ الذاكرةَ.
    const log = this.#requireLog();
    log.append(this.#policy.audit.incidentEvent, actor, {
      incident: id,
      severity,
      title,
      source,
      recordedAtMs,
      deadlineMs: this.deadlineMs,
    });
    this.#incidents.set(id, {
      id,
      severity,
      title,
      source,
      detail: {
        ...(raw['detail'] === undefined
          ? {}
          : /** @type {Record<string, unknown>} */ (raw['detail'])),
      },
      recordedAtMs,
      firstSeenAtMs: null,
    });

    return deepFreeze({ id, severity, title, source, recordedAtMs, deadlineMs: this.deadlineMs });
  }

  /**
   * قراءةُ لوحةٍ معلَنةٍ — والقيدُ يُكتب قبل القراءةِ كما في وحدةِ المراقبةِ
   * (`M9.01`): قيدٌ زائدٌ لقراءةٍ أخفقت بعده ثمنٌ مُعلَنٌ، وقراءةٌ بلا قيدٍ عمًى.
   * @param {{ panel: string, token?: string, params?: Record<string, unknown>, actor?: string }} request
   * @returns {Promise<{ panel: string, face: string, source: string, observedAtMs: number, deadlineMs: number, rows: readonly Record<string, unknown>[] }>}
   */
  async panel(request) {
    const actor = request?.actor ?? 'operations:center';
    this.#requireLog();
    const panelId = typeof request?.panel === 'string' ? request.panel.trim() : '';
    const spec = this.#panels.get(panelId);
    if (spec === undefined) {
      this.#refuse(
        'panel',
        actor,
        new OperationsError(
          OPERATIONS_ERRORS.PANEL_UNDECLARED,
          `اللوحة «${panelId}» غيرُ معلَنةٍ في وثيقةِ مركزِ العمليات؛ واللوحاتُ بياناتٌ في الوثيقةِ لا أسماءٌ يخترعها المُنادي.`,
          { panel: panelId },
        ),
        { panel: panelId },
      );
      throw new Error('unreachable');
    }
    const observedAtMs = this.#clock(`قراءةِ اللوحة ${spec.id}`);
    const log = this.#requireLog();
    log.append(this.#policy.audit.panelEvent, actor, {
      panel: spec.id,
      face: spec.face,
      source: spec.source,
      observedAtMs,
    });

    /** @type {readonly Record<string, unknown>[]} */
    let rows;
    if (spec.source.startsWith('route:')) {
      rows = await this.#readRoute(spec, actor, request);
    } else if (spec.source === 'internal:health') {
      rows = await this.#readHealth(spec, actor);
    } else if (spec.source === 'internal:incidents') {
      rows = this.#readIncidents(observedAtMs);
    } else {
      rows = this.#readQuotas(spec, actor);
    }

    return deepFreeze({
      panel: spec.id,
      face: spec.face,
      source: spec.source,
      observedAtMs,
      deadlineMs: this.deadlineMs,
      rows,
    });
  }

  /**
   * لوحةٌ على مسارٍ تُقرأ من طبقةِ الواجهةِ وحدها — لا مستودعَ في يدِ المركز.
   * @param {OperationsPanelSpec} spec
   * @param {string} actor
   * @param {{ token?: string, params?: Record<string, unknown> }} request
   * @returns {Promise<readonly Record<string, unknown>[]>}
   */
  async #readRoute(spec, actor, request) {
    const route = spec.source.slice('route:'.length);
    const gateway = this.#gateway;
    if (gateway === null) {
      this.#refuse(
        'panel',
        actor,
        new OperationsError(
          OPERATIONS_ERRORS.GATEWAY_REQUIRED,
          `اللوحة ${spec.id} مصدرُها المسار «${route}» وطبقةُ الواجهةِ غيرُ موصولةٍ بالمركز؛ ولا مسارَ قراءةٍ جانبيٌّ يتجاوز الجلسةَ والحدَّ والتفويض.`,
          { panel: spec.id, route },
        ),
        { panel: spec.id, route },
      );
    }
    /** @type {{ route: string, policyId: string | null, session: string, data: unknown }} */
    let answer;
    try {
      answer = await /** @type {OperationsGatewayLike} */ (gateway).call({
        route,
        ...(request.token === undefined ? {} : { token: request.token }),
        ...(request.params === undefined ? {} : { params: request.params }),
      });
    } catch (error) {
      // ردُّ الطبقةِ الأدنى يُغلَّف برمزٍ مُعلَنٍ ويحفظ رمزَها الأصليَّ في تفصيلِه
      // **وسببَها الأصليَّ في `cause`**: عَرَضٌ بلا سببٍ يُقطع سلسلةَ التشخيص.
      const refusal = new OperationsError(
        OPERATIONS_ERRORS.PANEL_REFUSED,
        `طبقةُ الواجهةِ ردَّت قراءةَ اللوحة ${spec.id}: ${errorText(error)}`,
        { panel: spec.id, route, cause: codeOf(error) },
        { cause: error },
      );
      this.#refuse('panel', actor, refusal, { panel: spec.id, route, cause: codeOf(error) });
      throw refusal;
    }
    const data = answer.data;
    if (Array.isArray(data)) {
      return data.map((entry) => ({ .../** @type {Record<string, unknown>} */ (entry) }));
    }
    return [{ .../** @type {Record<string, unknown>} */ (data ?? {}) }];
  }

  /**
   * صحةُ النظامِ من مسابرَ مُعلَنةٍ عند التركيب — ومسبارٌ يرمي يُقرأ «مُخفِقاً»
   * بنصِّ خطئِه ولا يُسقِط اللوحةَ كلَّها.
   * @param {OperationsPanelSpec} spec
   * @param {string} actor
   * @returns {Promise<readonly Record<string, unknown>[]>}
   */
  async #readHealth(spec, actor) {
    const probes = this.#probes;
    if (probes === null || probes.length === 0) {
      this.#refuse(
        'panel',
        actor,
        new OperationsError(
          OPERATIONS_ERRORS.SOURCE_MISSING,
          `اللوحة ${spec.id} بلا مسابرَ موصولةٍ؛ ولوحةُ صحةٍ فارغةٌ تُقرأ «صحيحةً» كذبٌ مُطمئنٌ أسوأُ من رفضٍ مُسمّى.`,
          { panel: spec.id },
        ),
        { panel: spec.id },
      );
    }
    /** @type {Record<string, unknown>[]} */
    const rows = [];
    for (const probe of /** @type {readonly HealthProbeLike[]} */ (probes)) {
      try {
        const result = await probe.check();
        rows.push({
          id: probe.id,
          status: result.status,
          detail: result.detail === undefined ? null : result.detail,
        });
      } catch (error) {
        rows.push({ id: probe.id, status: 'failing', detail: errorText(error) });
      }
    }
    return rows;
  }

  /**
   * لوحةُ الحوادث — وهنا يُثبَّت **زمنُ الظهورِ الأول** لكلِّ حادثةٍ مرّةً واحدةً
   * ولا يُعاد كتابتُه: من أعاد كتابتَه في كلِّ قراءةٍ جعل كلَّ حادثةٍ «ظهرت
   * الآنَ» فأبطل قياسَ المهلةِ من أصلِه.
   * @param {number} observedAtMs
   * @returns {readonly Record<string, unknown>[]}
   */
  #readIncidents(observedAtMs) {
    /** @type {Record<string, unknown>[]} */
    const rows = [];
    for (const incident of this.#incidents.values()) {
      if (incident.firstSeenAtMs === null) incident.firstSeenAtMs = observedAtMs;
      const visibilityMs = incident.firstSeenAtMs - incident.recordedAtMs;
      rows.push({
        id: incident.id,
        severity: incident.severity,
        title: incident.title,
        source: incident.source,
        detail: { ...incident.detail },
        recordedAtMs: incident.recordedAtMs,
        firstSeenAtMs: incident.firstSeenAtMs,
        visibilityMs,
        withinDeadline: visibilityMs <= this.deadlineMs,
      });
    }
    return rows;
  }

  /**
   * لوحتا السعةِ والتكلفةِ على المواردِ المُعلَنةِ بأسمائها — والمستهلَكُ من
   * مزوِّدٍ خارجَ الوحدةِ، وغيابُه رفضٌ مُسمّىً لا صفرٌ مُطمئن.
   * @param {OperationsPanelSpec} spec
   * @param {string} actor
   * @returns {readonly Record<string, unknown>[]}
   */
  #readQuotas(spec, actor) {
    const reader = this.#quotas;
    if (reader === null) {
      this.#refuse(
        'panel',
        actor,
        new OperationsError(
          OPERATIONS_ERRORS.SOURCE_MISSING,
          `اللوحة ${spec.id} بلا مزوِّدِ حصصٍ موصولٍ؛ وسعةٌ أو تكلفةٌ تُعرَض صفراً بلا مصدرٍ تُطمئن على ما لم يُقَس.`,
          { panel: spec.id },
        ),
        { panel: spec.id },
      );
    }
    /** @type {Record<string, unknown>[]} */
    const rows = [];
    for (const resource of spec.resources ?? []) {
      try {
        const reading = /** @type {QuotaReaderLike} */ (reader).read(resource);
        rows.push({
          resource: reading.resource,
          limit: reading.limit,
          consumed: reading.consumed,
          unit: reading.unit,
          windowSeconds: reading.windowSeconds,
          remaining: reading.consumed === null ? null : reading.limit - reading.consumed,
        });
      } catch (error) {
        this.#refuse(
          'panel',
          actor,
          new OperationsError(
            OPERATIONS_ERRORS.SOURCE_MISSING,
            `الموردُ «${resource}» معلَنٌ في اللوحة ${spec.id} ولا يقرأه المزوِّد: ${errorText(error)}`,
            { panel: spec.id, resource },
          ),
          { panel: spec.id, resource },
        );
      }
    }
    return rows;
  }

  /**
   * **قياسُ معيارِ القبولِ بحرفه:** هل ظهرت الحادثةُ في اللوحةِ خلال المهلةِ
   * المُعلَنة؟ يقرأ لوحةَ الحوادثِ (فيُثبِّت زمنَ الظهورِ إن لم يكن قد ثُبِّت)،
   * ثم يقيس. وغيابُ الحادثةِ رفضٌ مُسمّى، وتأخُّرُها رفضٌ مُسمّىً يُكتب في السجلِّ
   * ولا يُخفي الحادثةَ: تبقى ظاهرةً موسومةً بتأخُّرِها.
   * @param {string} incidentId
   * @param {{ actor?: string }} [context]
   * @returns {Promise<{ incident: string, visibilityMs: number, deadlineMs: number, withinDeadline: true }>}
   */
  async assertVisible(incidentId, context = {}) {
    const actor = context.actor ?? 'operations:center';
    const id = typeof incidentId === 'string' ? incidentId.trim() : '';
    const incidentsPanel = [...this.#panels.values()].find((panel) => panel.face === 'incidents');
    const view = await this.panel({
      panel: /** @type {OperationsPanelSpec} */ (incidentsPanel).id,
      actor,
    });
    const row = view.rows.find((entry) => entry['id'] === id);
    if (row === undefined) {
      this.#refuse(
        'incident',
        actor,
        new OperationsError(
          OPERATIONS_ERRORS.INCIDENT_UNKNOWN,
          `الحادثة «${id}» لا تظهر في لوحةِ الحوادث؛ وحادثةٌ سُجِّلت ولا تُرى حادثةٌ لم تصل إلى الواجهةِ أصلاً.`,
          { incident: id },
        ),
        { incident: id },
      );
    }
    const visibilityMs = Number(/** @type {Record<string, unknown>} */ (row)['visibilityMs']);
    if (visibilityMs > this.deadlineMs) {
      this.#refuse(
        'incident',
        actor,
        new OperationsError(
          OPERATIONS_ERRORS.VISIBILITY_MISSED,
          `الحادثة «${id}» ظهرت بعد ${visibilityMs} ملي ثانية والمهلةُ المُعلَنةُ ${this.deadlineMs}؛ والمهلةُ في الوثيقةِ دعوى تُقاس لا وعدٌ يُقال.`,
          { incident: id, visibilityMs, deadlineMs: this.deadlineMs },
        ),
        { incident: id, visibilityMs, deadlineMs: this.deadlineMs },
      );
    }
    return deepFreeze({
      incident: id,
      visibilityMs,
      deadlineMs: this.deadlineMs,
      withinDeadline: /** @type {true} */ (true),
    });
  }
}

/**
 * مزوِّدُ حصصٍ يقرأ الحدودَ من `config/quotas.yaml` نفسِها ويأخذ المستهلَكَ من
 * دالّةٍ مُمرَّرةٍ — فالحدُّ من الوثيقةِ الأصلِ لا من نسخةٍ في مركزِ العمليات،
 * والمستهلَكُ غيرُ المقيسِ `null` صريحٌ لا صفرٌ مُطمئن.
 * @param {{ quotas: ReadonlyArray<{ resource: string, limit: number, unit?: string, windowSeconds: number }>, consumed?: (resource: string) => number | null }} options
 * @returns {QuotaReaderLike}
 */
export function quotaReaderFromPolicy(options) {
  /** @type {Map<string, { resource: string, limit: number, unit?: string, windowSeconds: number }>} */
  const byResource = new Map(options.quotas.map((quota) => [quota.resource, quota]));
  const consumed = options.consumed;
  return Object.freeze({
    /**
     * @param {string} resource
     * @returns {{ resource: string, limit: number, consumed: number | null, unit: string | null, windowSeconds: number }}
     */
    read(resource) {
      const quota = byResource.get(resource);
      if (quota === undefined) {
        throw new OperationsError(
          OPERATIONS_ERRORS.SOURCE_MISSING,
          `الموردُ «${resource}» غيرُ معلَنٍ في وثيقةِ الحصص؛ ولوحةٌ تعرض حدّاً لا أصلَ له تعرض رقماً مخترَعاً.`,
          { resource },
        );
      }
      return Object.freeze({
        resource: quota.resource,
        limit: quota.limit,
        consumed: consumed === undefined ? null : consumed(resource),
        unit: quota.unit ?? null,
        windowSeconds: quota.windowSeconds,
      });
    },
  });
}
