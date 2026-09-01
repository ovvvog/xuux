/**
 * عارضُ سجلِّ التدقيق — الخطوة `M9.07`.
 *
 * **العيبُ الذي تُغلقه هذه الوحدة:** صار للدولةِ سجلٌّ دائمٌ متسلسلُ التجزئةِ منذ
 * `M2`، وصارت كلُّ طبقةٍ بعده تكتب فيه أثرَها **قبل** فعلِها: `M9.01` تكتب
 * `monitor.read`، و`M9.02` تكتب `api.call`، و`M9.03` و`M9.04` و`M9.05` و`M9.06`
 * تكتب قبولَها ورفضَها. فصار السجلُّ شاهدَ الدولةِ كلِّها — **ولا موضعَ واحدٌ
 * يُقرأ منه**. من أراد أن يعرف من فعل ماذا ومتى فتح ملفَ `.jsonl` بيدِه وقرأ
 * سطراً سطراً، ومن أراد أن يعرف **أصحيحٌ ما يقرأ** حسب التجزئةَ ذهناً أو صدَّق.
 * ومساءلةٌ شرطُها أن يفتح المُساءِلُ الملفَّ بمحرِّرِ نصوصٍ ليست مساءلةً مرئيّةً
 * بل شهادةٌ مكتوبةٌ لا قارئَ لها.
 *
 * **القاعدةُ الحاكمة: لا مشهدَ بلا حكمِ سلامة.** العارضُ لا يُقدِّم صفّاً واحداً
 * إلا ومعه **حكمُ سلامةِ السلسلةِ** التي جاء منها ذاك الصفّ — مقروءاً من نفسِ
 * القراءةِ التي أعطته الصفوفَ لا من فحصٍ ثانٍ قد يُنسى ولا من زرٍّ اختياريٍّ في
 * زاويةٍ. فمن بحث في سجلٍّ مُعبَثٍ به رأى نتيجةَ بحثِه **وتحذيرَ العبثِ معها في
 * الردِّ نفسِه**، لا في مشهدٍ آخرَ لم يفتحه. وهذا عينُ معيارِ قبولِ الخطوةِ
 * بحرفه: «عبثٌ مُصطنعٌ يظهر كتحذيرِ سلامةٍ في الواجهة».
 *
 * **والعارضُ لا يكتب بايتاً واحداً في المفحوص.** القراءةُ كلُّها من
 * `inspectEventLog` — فحصٌ قرائيٌّ محضٌ بلا قفلٍ وبلا اقتطاعٍ وُضع في `M2.06`
 * لهذا الغرضِ بعينه — فلا يفتح العارضُ السجلَّ للكتابةِ كي يقرأه، إذ لو فعل
 * لصار الفحصُ نفسُه تغييراً للمفحوص، ولانتزع قفلَ الكاتبِ من الدولةِ الحيّةِ
 * ليطالع تاريخَها.
 *
 * **ترتيبُ العقباتِ على كلِّ مشهد (لا يُقلب):**
 * 1. **سجلٌّ دائمٌ موصول** — وبلا موضعٍ يُكتب فيه أثرُ القارئِ لا قراءةَ
 *    (`AUDIT_VIEWER_AUDIT_REQUIRED`)؛ فمن طالع سجلَّ التدقيقِ بلا أن يُدقَّق عليه
 *    فتح باباً خلفيّاً على شهادةِ الدولةِ كلِّها.
 * 2. **مشهدٌ معلَنٌ في الوثيقة** (`AUDIT_VIEWER_VIEW_UNDECLARED`).
 * 3. **ساعةٌ صالحة** تُعطي عدداً منتهياً غيرَ سالبٍ (`AUDIT_VIEWER_CLOCK_INVALID`).
 * 4. **مصدرٌ موصول**: ملفُّ سجلٍّ معروفُ المسار (`AUDIT_VIEWER_SOURCE_MISSING`)
 *    وموجودٌ على القرص (`AUDIT_VIEWER_LOG_UNREADABLE`).
 * 5. **معاييرُ المشهدِ صحيحة**: حقلُ بحثٍ معلَنٌ (`AUDIT_VIEWER_FIELD_UNDECLARED`)
 *    ومصطلحٌ مقبولٌ (`AUDIT_VIEWER_TERM_INVALID`) ومدًى زمنيٌّ مقروءٌ
 *    (`AUDIT_VIEWER_RANGE_INVALID`).
 * 6. **قيدُ التدقيقِ في السجلِّ قبل القراءة** — كما في `M9.01` و`M9.02`.
 * 7. **حكمُ السلامةِ يُحسَب أولاً ثم تُبنى الصفوف** — فما من طريقٍ نصّيٍّ يُخرج
 *    صفوفاً بلا حكمٍ يرافقها.
 * 8. **حدُّ الصفوفِ المُعلَن** (`AUDIT_VIEWER_ROWS_EXCEEDED`) — رفضٌ مُسمّىً لا
 *    اقتطاعٌ صامتٌ: من عرض أولَ خمسِمئةٍ من ألفٍ وسمّاها «النتيجة» أخفى نصفَ
 *    الشهادةِ في موضعِ المساءلة.
 *
 * **حدودٌ معلَنة:**
 * 1. **قراءةُ العارضِ تُغيِّر المقروء — بصفٍّ واحدٍ معلَن.** أثرُ القراءةِ يُكتب
 *    في **السجلِّ نفسِه** الذي يُقرأ، فيزيده قيداً. والقيدُ قبل الأثرِ كما في كلِّ
 *    ما سبق، فالحكمُ المُعاد يشمل قيدَ القراءةِ الحالية. وفصلُ سجلِّ القرّاءِ عن
 *    سجلِّ المقروءِ قرارُ تشغيلٍ في `M10` لا يُتَّخذ من طبقةِ العرض.
 * 2. **لا طبقةَ نقلٍ ولا واجهةَ رسوميّة.** «الواجهة» هنا عقدُ نداءٍ مُعلَنٌ
 *    ومُدقَّقٌ كحالِ الديوانِ في `M9.03` ومركزِ العملياتِ في `M9.05`، ومحوِّلُ
 *    النقلِ دَينٌ مُسنَدٌ إلى `M10`.
 * 3. **العارضُ يكشف الانكسارَ ولا يُصلحه ولا يُرجِع.** لا اقتطاعَ ولا إعادةَ
 *    بناءِ رأسٍ ولا استعادةَ نسخةٍ: تلك مقابضُ `PersistentEventLog` ونصوصُ
 *    `scripts/restore.mjs`، ومن جعل مشهدَ المساءلةِ يُصلح ما يُساءَل عنه جعل
 *    الشاهدَ خصماً.
 * 4. **السلامةُ سلامةُ سلسلةٍ لا سلامةُ صدق.** السلسلةُ تُثبت أن الصفوفَ لم
 *    تُبدَّل بعد كتابتِها؛ ولا تُثبت أن ما كُتب كان صادقاً حين كُتب. وتثبيتُ
 *    السجلِّ خارجَ الدولةِ عملُ `src/root-of-trust/anchor.mjs`، وقراءتُه في هذا
 *    المشهدِ لم تُدَّعَ.
 * 5. **البحثُ نصّيٌّ على حقولٍ معلَنة** — لا على `data`. حقولُ الحدثِ المُعلَنةُ
 *    في الوثيقةِ تُقابَل بحقولِ `EventRecord` في الحاجزِ (R2)، وأما جسمُ
 *    `data` فحرٌّ الشكلِ فبحثٌ فيه بحثٌ بلا عقدٍ يُقاس عليه.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import Ajv2020Default from 'ajv/dist/2020.js';

// وحزمةُ Ajv تُصدِّر صنفَها افتراضاً في ESM، فيُقرأ نوعُه صريحاً وإلا صار «غيرَ
// قابلٍ للإنشاء» في الفحصِ الصارم — كما في مركزِ العملياتِ وطبقةِ الواجهة.
const Ajv2020 = /** @type {typeof import('ajv/dist/2020.js').Ajv2020} */ (
  /** @type {unknown} */ (Ajv2020Default)
);
import YAML from 'yaml';

import { inspectEventLog } from '../root-of-trust/index.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** مجلَّدُ الإعداداتِ الافتراضيُّ لعارضِ سجلِّ التدقيق. */
export const DEFAULT_AUDIT_VIEWER_CONFIG_DIR = path.resolve(HERE, '..', '..', 'config');

/** رموزُ رفضِ العارض — كلُّها مُعلَنةٌ في `config/audit-log-viewer.yaml`. */
export const AUDIT_VIEWER_ERRORS = Object.freeze({
  CONFIG_INVALID: 'AUDIT_VIEWER_CONFIG_INVALID',
  AUDIT_REQUIRED: 'AUDIT_VIEWER_AUDIT_REQUIRED',
  VIEW_UNDECLARED: 'AUDIT_VIEWER_VIEW_UNDECLARED',
  SOURCE_MISSING: 'AUDIT_VIEWER_SOURCE_MISSING',
  LOG_UNREADABLE: 'AUDIT_VIEWER_LOG_UNREADABLE',
  FIELD_UNDECLARED: 'AUDIT_VIEWER_FIELD_UNDECLARED',
  TERM_INVALID: 'AUDIT_VIEWER_TERM_INVALID',
  RANGE_INVALID: 'AUDIT_VIEWER_RANGE_INVALID',
  ROWS_EXCEEDED: 'AUDIT_VIEWER_ROWS_EXCEEDED',
  CLOCK_INVALID: 'AUDIT_VIEWER_CLOCK_INVALID',
  INTEGRITY_BROKEN: 'AUDIT_VIEWER_INTEGRITY_BROKEN',
});

/**
 * أوجهُ العارضِ الثلاثةُ كما سمّاها نصُّ الخطوةِ بحرفه: «بحث، تسلسل زمني، تحقّق
 * سلامة السلسلة داخل الواجهة» — **حدٌّ في الكودِ يقابله حاجزٌ على الوثيقة**:
 * كلُّ وجهٍ مشهدٌ واحدٌ لا أكثرَ ولا أقلّ، فمن أعلن اثنين أعلن عارضاً أعمى عن
 * وجهٍ سُمِّي في الخطوة.
 */
export const AUDIT_VIEWER_FACES = Object.freeze(['search', 'timeline', 'integrity']);

/** خطأُ عارضِ سجلِّ التدقيقِ برمزٍ مُعلَن. */
export class AuditViewerError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   * @param {Record<string, unknown>} [detail]
   * @param {{ cause?: unknown }} [options] سببٌ أصليٌّ يُربَط بالعَرَض، فرفضُ
   *   الطبقةِ الأدنى لا يضيع خلف رمزِ الطبقةِ الأعلى.
   */
  constructor(code, message, detail = {}, options = {}) {
    super(message, 'cause' in options ? { cause: options.cause } : undefined);
    this.name = 'AuditViewerError';
    this.code = code;
    this.detail = Object.freeze({ ...detail });
  }
}

/**
 * @param {string} message
 * @returns {never}
 */
function invalidConfig(message) {
  throw new AuditViewerError(AUDIT_VIEWER_ERRORS.CONFIG_INVALID, message);
}

/**
 * @param {unknown} error
 * @returns {string}
 */
function errorText(error) {
  return error instanceof Error ? error.message : String(error);
}

/**
 * تجميدٌ عميقٌ للصفوفِ المُعادة: المشهدُ صورةٌ لا مرجعُ حالةٍ حيّة، فمن قرأ
 * شهادةً لم يملك بذلك يداً على تعديلِها في يدِ من بعده.
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
 * @typedef {object} AuditViewSpec
 * @property {string} id
 * @property {'search' | 'timeline' | 'integrity'} face
 * @property {string} source
 * @property {string} purpose
 */

/**
 * @typedef {object} AuditViewerPolicy
 * @property {number} version
 * @property {string} statement
 * @property {{ viewEvent: string, viewRefusedEvent: string, integrityEvent: string, integrityWarnedEvent: string, statement: string }} audit
 * @property {{ fields: readonly string[], maxRows: number, maxTermLength: number, statement: string }} search
 * @property {{ breakReasons: readonly string[], severity: string, statement: string }} integrity
 * @property {readonly string[]} refusalCodes
 * @property {readonly AuditViewSpec[]} views
 * @property {ReadonlyArray<{ id: string, statement: string, enforcedBy: string, codes: readonly string[] }>} guarantees
 */

/**
 * يقرأ وثيقةَ العارضِ ويتحقّق منها بمخطَّطها ثم بفحوصِ تماسكٍ لا يُعبِّر عنها
 * مخطَّط: لا معرّفَ مشهدٍ مكرَّر، والأوجهُ الثلاثةُ كلُّها معلَنةٌ **مرّةً
 * واحدة**، ومصدرُ كلِّ مشهدٍ هو ملفُّ السجلِّ لا مستودعٌ ولا مسارٌ، وحقلا `seq`
 * و`at` لازمانِ في حقولِ البحثِ إذ عليهما يقوم التسلسلُ الزمنيُّ نفسُه، ورموزُ
 * الرفضِ المُعلَنةُ مطابقةٌ لرموزِ الكودِ **في الاتجاهين**.
 * @param {{ dir?: string }} [options]
 * @returns {AuditViewerPolicy}
 */
export function loadAuditViewerPolicy(options = {}) {
  const dir = options.dir ?? DEFAULT_AUDIT_VIEWER_CONFIG_DIR;
  const schemaDir = fs.existsSync(path.join(dir, 'schemas'))
    ? dir
    : DEFAULT_AUDIT_VIEWER_CONFIG_DIR;
  const file = path.join(dir, 'audit-log-viewer.yaml');
  if (!fs.existsSync(file)) {
    invalidConfig(
      'وثيقةُ عارضِ سجلِّ التدقيقِ غائبة؛ وعارضٌ بلا وثيقةٍ تُعلن مشاهدَه وحقولَ بحثِه وحدَّ صفوفِه عارضٌ حدُّه نيّةُ كاتبِه.',
    );
  }
  /** @type {unknown} */
  let raw;
  try {
    raw = YAML.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    invalidConfig(`تعذّرت قراءة audit-log-viewer.yaml: ${errorText(error)}`);
  }
  const schemaPath = path.join(schemaDir, 'schemas', 'audit-log-viewer.schema.json');
  if (!fs.existsSync(schemaPath)) {
    invalidConfig(
      'مخطَّطُ وثيقةِ العارضِ غائب؛ وبلا مخطَّطٍ يصير إعلانُ المشاهدِ نصّاً حرّاً كالذي جاء ليمنعه.',
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
    invalidConfig(`audit-log-viewer.yaml يخالف مخطَّطه: ${problems}`);
  }
  const parsed = /** @type {AuditViewerPolicy} */ (raw);

  // ── فحوصُ تماسكٍ لا يُعبِّر عنها مخطَّط ──

  /** @type {Set<string>} */
  const viewIds = new Set();
  /** @type {Map<string, string>} */
  const faceView = new Map();
  for (const view of parsed.views) {
    if (viewIds.has(view.id)) {
      invalidConfig(
        `المشهد ${view.id} مُعلَنٌ مرّتين؛ ولا مشهدانِ بمعرّفٍ واحدٍ يُقرأ أحدُهما بالآخر.`,
      );
    }
    viewIds.add(view.id);
    const already = faceView.get(view.face);
    if (already !== undefined) {
      invalidConfig(
        `الوجه «${view.face}» له مشهدان (${already} و${view.id})؛ ووجهٌ بمشهدين وجهٌ لا يُعرف أيُّهما يُقرأ عند سؤالٍ واحد.`,
      );
    }
    faceView.set(view.face, view.id);
    if (view.source !== 'log:events') {
      invalidConfig(
        `المشهد ${view.id} مصدرُه «${view.source}»؛ ومصدرُ العارضِ ملفُّ السجلِّ وحدَه (log:events) — فمن قرأ من مستودعٍ قرأ حالاً لا شهادة.`,
      );
    }
  }
  for (const face of AUDIT_VIEWER_FACES) {
    if (!faceView.has(face)) {
      invalidConfig(
        `الوجه «${face}» بلا مشهدٍ معلَن؛ ونصُّ الخطوةِ يُسمّي الأوجهَ الثلاثةَ (${AUDIT_VIEWER_FACES.join('، ')}) فعارضٌ ناقصُ وجهٍ عارضٌ أعمى عمًى مُعلَناً.`,
      );
    }
  }

  for (const field of ['seq', 'at']) {
    if (!parsed.search.fields.includes(field)) {
      invalidConfig(
        `الحقل «${field}» غيرُ معلَنٍ في حقولِ البحث؛ وعليه يقوم التسلسلُ الزمنيُّ نفسُه فحذفُه يُعمي وجهاً سُمِّي في الخطوة.`,
      );
    }
  }
  if (parsed.integrity.breakReasons.length === 0) {
    invalidConfig(
      'وثيقةُ السلامةِ بلا أسبابِ انكسارٍ معلَنة؛ وتحذيرٌ بلا سببٍ مُسمّىً تحذيرٌ لا يُتصرَّف عليه.',
    );
  }

  /** @type {Set<string>} */
  const declared = new Set(Object.values(AUDIT_VIEWER_ERRORS));
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
    search: Object.freeze({
      fields: Object.freeze([...parsed.search.fields]),
      maxRows: parsed.search.maxRows,
      maxTermLength: parsed.search.maxTermLength,
      statement: parsed.search.statement,
    }),
    integrity: Object.freeze({
      breakReasons: Object.freeze([...parsed.integrity.breakReasons]),
      severity: parsed.integrity.severity,
      statement: parsed.integrity.statement,
    }),
    refusalCodes: Object.freeze([...parsed.refusalCodes]),
    views: Object.freeze(parsed.views.map((view) => Object.freeze({ ...view }))),
    guarantees: Object.freeze(
      parsed.guarantees.map((entry) =>
        Object.freeze({ ...entry, codes: Object.freeze([...entry.codes]) }),
      ),
    ),
  });
}

/**
 * @typedef {object} AuditViewerLogLike
 * @property {(type: string, actor: string, data: Record<string, unknown>) => unknown} append
 * @property {string} [file]
 */

/**
 * حكمُ سلامةِ السلسلةِ كما يُعرَض في الواجهة.
 * @typedef {object} AuditIntegrityVerdict
 * @property {boolean} ok سلامةُ التسلسلِ والتجزئةِ وحدَها.
 * @property {boolean} warned تحذيرٌ ظاهرٌ في الواجهة — يجمع الانكسارَ والذيلَ
 *   الناقصَ ورأساً لا يوافق ومشكلةً يرفعها السجلُّ الدائم.
 * @property {string} severity
 * @property {number} count
 * @property {string} lastHash
 * @property {boolean} tailComplete
 * @property {boolean} headAgrees
 * @property {number | null} brokenAt
 * @property {string | null} reason
 * @property {string | null} problem
 * @property {number} checkedAtMs
 */

/**
 * عارضُ سجلِّ التدقيق: ثلاثةُ مقابضَ عامّةٍ لأوجهِ الخطوةِ الثلاثةِ (`search`
 * و`timeline` و`integrity`) كلُّها تمرّ بمِقبضٍ واحدٍ (`view`)، ومِقبضُ قياسِ
 * معيارِ القبولِ (`assertIntact`) — ولا خامسَ. ولا مستودعَ في حقولِه ولا نداءَ
 * كتابةٍ واحدٌ على المفحوص.
 */
export class AuditLogViewer {
  /** @type {AuditViewerPolicy} */
  #policy;
  /** @type {Map<string, AuditViewSpec>} */
  #views = new Map();
  /** @type {AuditViewerLogLike | null} */
  #log;
  /** @type {string | null} */
  #logFile;
  /** @type {() => number} */
  #nowMs;

  /**
   * @param {{ policy?: AuditViewerPolicy, dir?: string, log?: AuditViewerLogLike | null, logFile?: string | null, nowMs?: () => number }} [deps]
   */
  constructor(deps = {}) {
    this.#policy =
      deps.policy ?? loadAuditViewerPolicy(deps.dir === undefined ? {} : { dir: deps.dir });
    this.#log = deps.log ?? null;
    // مسارُ المفحوصِ يُؤخذ صريحاً إن أُعطي، وإلا فمن السجلِّ الموصولِ نفسِه: فما
    // يُقرأ هو **عينُ** ما يُكتب فيه أثرُ القراءة، ولا يُخترَع مسارٌ ثانٍ يُقرأ
    // سجلّاً غيرَ الذي تشهد عليه الدولة.
    const fromLog = deps.log?.file;
    this.#logFile =
      deps.logFile ?? (typeof fromLog === 'string' && fromLog !== '' ? fromLog : null);
    this.#nowMs = deps.nowMs ?? (() => Date.now());
    for (const view of this.#policy.views) this.#views.set(view.id, view);
  }

  /** @returns {AuditViewerPolicy} */
  get policy() {
    return this.#policy;
  }

  /** @returns {number} حدُّ الصفوفِ المُعلَن — من الوثيقةِ لا من الكود. */
  get maxRows() {
    return this.#policy.search.maxRows;
  }

  /**
   * وصفُ ما يملكه العارضُ من مشاهدَ وحقولِ بحثٍ وحدود — بياناتٌ تُقرأ لا مِقبضٌ
   * يُنفَّذ به شيء.
   * @returns {{ views: ReadonlyArray<{ id: string, face: string, source: string, purpose: string }>, fields: readonly string[], maxRows: number, maxTermLength: number, breakReasons: readonly string[], logFile: string | null }}
   */
  describe() {
    return deepFreeze({
      views: [...this.#views.values()].map((view) => ({
        id: view.id,
        face: view.face,
        source: view.source,
        purpose: view.purpose,
      })),
      fields: [...this.#policy.search.fields],
      maxRows: this.maxRows,
      maxTermLength: this.#policy.search.maxTermLength,
      breakReasons: [...this.#policy.integrity.breakReasons],
      logFile: this.#logFile,
    });
  }

  /**
   * السجلُّ الدائمُ أو رفضٌ مُسمّى — العقبةُ الأولى على كلِّ مِقبض.
   * @returns {AuditViewerLogLike}
   */
  #requireLog() {
    const log = this.#log;
    if (log === null) {
      throw new AuditViewerError(
        AUDIT_VIEWER_ERRORS.AUDIT_REQUIRED,
        'السجلُّ الدائمُ غيرُ موصولٍ بعارضِ سجلِّ التدقيق؛ ومن طالع شهادةَ الدولةِ بلا أن يُكتب أثرُ مطالعتِه فتح باباً خلفيّاً على أخطرِ ما فيها.',
      );
    }
    return log;
  }

  /**
   * قراءةُ الساعةِ المُمرَّرةِ مع التحقُّق: ساعةٌ تُعطي غيرَ عددٍ منتهٍ غيرِ سالبٍ
   * تُرَدُّ برمزٍ مُعلَنٍ ولا يُختم بها قيدُ تدقيقٍ ولا حكمُ سلامة.
   * @param {string} where
   * @returns {number}
   */
  #clock(where) {
    const value = this.#nowMs();
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
      throw new AuditViewerError(
        AUDIT_VIEWER_ERRORS.CLOCK_INVALID,
        `الساعةُ المُمرَّرةُ أعطت «${String(value)}» عند ${where}؛ وحكمُ سلامةٍ يُختم بزمنٍ لا يُقرأ حكمٌ لا يُعرف متى صدر.`,
        { where, value: String(value) },
      );
    }
    return value;
  }

  /**
   * قيدُ رفضٍ في السجلِّ الدائمِ ثم رفعُ الخطأ: الرفضُ يُكتب كما يُكتب القبول.
   * @param {string} actor
   * @param {AuditViewerError} error
   * @param {Record<string, unknown>} data
   * @returns {never}
   */
  #refuse(actor, error, data) {
    const log = this.#log;
    if (log !== null) {
      log.append(this.#policy.audit.viewRefusedEvent, actor, {
        ...data,
        code: error.code,
        reason: error.message,
      });
    }
    throw error;
  }

  /**
   * الفحصُ القرائيُّ المحضُ للمفحوص — بلا قفلٍ وبلا كتابةِ بايتٍ واحد
   * (`inspectEventLog` من `M2.06`).
   * @param {string} actor
   * @returns {import('../root-of-trust/persistent-log.mjs').EventLogInspection}
   */
  #inspect(actor) {
    const file = this.#logFile;
    if (file === null) {
      this.#refuse(
        actor,
        new AuditViewerError(
          AUDIT_VIEWER_ERRORS.SOURCE_MISSING,
          'مسارُ ملفِّ السجلِّ غيرُ معروفٍ للعارض؛ وعارضٌ بلا مفحوصٍ يُعيد صفراً من الصفوفِ فيُقرأ «لا شيءَ وقع» — وذاك كذبٌ مُطمئنٌ أسوأُ من رفضٍ مُسمّى.',
        ),
        {},
      );
      throw new Error('unreachable');
    }
    if (!fs.existsSync(file)) {
      this.#refuse(
        actor,
        new AuditViewerError(
          AUDIT_VIEWER_ERRORS.LOG_UNREADABLE,
          `ملفُّ السجلِّ «${file}» غيرُ موجودٍ على القرص؛ وغيابُ الشاهدِ خبرٌ يُرفَع لا سكوتٌ يُقرأ سلامة.`,
          { file },
        ),
        { file },
      );
      throw new Error('unreachable');
    }
    try {
      return inspectEventLog(file);
    } catch (error) {
      const refusal = new AuditViewerError(
        AUDIT_VIEWER_ERRORS.LOG_UNREADABLE,
        `تعذّر فحصُ ملفِّ السجلِّ «${file}»: ${errorText(error)}`,
        { file },
        { cause: error },
      );
      this.#refuse(actor, refusal, { file });
      throw refusal;
    }
  }

  /**
   * حكمُ السلامةِ من نتيجةِ الفحصِ نفسِها. والتحذيرُ **أوسعُ من انكسارِ
   * السلسلة**: ذيلٌ ناقصٌ أو رأسٌ لا يوافق عددَ الأحداثِ وتجزئتَها عبثٌ أو
   * تعطُّلٌ في الحالين، وكلاهما يستحقّ أن يُرى في موضعِ المساءلة.
   * @param {import('../root-of-trust/persistent-log.mjs').EventLogInspection} inspection
   * @param {number} checkedAtMs
   * @returns {AuditIntegrityVerdict}
   */
  #verdict(inspection, checkedAtMs) {
    const ok = inspection.chainOk;
    const warned =
      !ok || !inspection.tailComplete || !inspection.headAgrees || inspection.problem !== undefined;
    return {
      ok,
      warned,
      severity: this.#policy.integrity.severity,
      count: inspection.count,
      lastHash: inspection.lastHash,
      tailComplete: inspection.tailComplete,
      headAgrees: inspection.headAgrees,
      brokenAt: inspection.brokenAt ?? null,
      reason: inspection.reason ?? null,
      problem: inspection.problem ?? null,
      checkedAtMs,
    };
  }

  /**
   * قراءةُ مشهدٍ معلَنٍ — والقيدُ يُكتب **قبل** القراءةِ كما في وحدةِ المراقبةِ
   * (`M9.01`) وطبقةِ الواجهةِ (`M9.02`): قيدٌ زائدٌ لقراءةٍ أخفقت بعده ثمنٌ
   * مُعلَنٌ، وقراءةٌ بلا قيدٍ عمًى في أخطرِ موضع. وحكمُ السلامةِ يُحسَب **قبل**
   * بناءِ الصفوفِ ويُعاد معها في ردٍّ واحدٍ، فما من طريقٍ يُخرج صفوفاً بلا حكم.
   * @param {{ view: string, field?: string, term?: string, from?: string, to?: string, actor?: string }} request
   * @returns {{ view: string, face: string, source: string, observedAtMs: number, integrity: AuditIntegrityVerdict, rows: readonly Record<string, unknown>[] }}
   */
  view(request) {
    const actor = request?.actor ?? 'audit:viewer';
    this.#requireLog();
    const viewId = typeof request?.view === 'string' ? request.view.trim() : '';
    const spec = this.#views.get(viewId);
    if (spec === undefined) {
      this.#refuse(
        actor,
        new AuditViewerError(
          AUDIT_VIEWER_ERRORS.VIEW_UNDECLARED,
          `المشهد «${viewId}» غيرُ معلَنٍ في وثيقةِ عارضِ سجلِّ التدقيق؛ والمشاهدُ بياناتٌ في الوثيقةِ لا أسماءٌ يخترعها المُنادي.`,
          { view: viewId },
        ),
        { view: viewId },
      );
      throw new Error('unreachable');
    }
    const observedAtMs = this.#clock(`قراءةِ المشهد ${spec.id}`);
    const criteria = this.#criteria(spec, actor, request);

    // القيدُ قبل الأثر: تُكتب الشهادةُ في السجلِّ الدائمِ ثم يُفتح المفحوص.
    const log = this.#requireLog();
    log.append(this.#policy.audit.viewEvent, actor, {
      view: spec.id,
      face: spec.face,
      source: spec.source,
      observedAtMs,
      ...criteria,
    });

    const inspection = this.#inspect(actor);
    const verdict = this.#verdict(inspection, observedAtMs);
    if (verdict.warned) {
      log.append(this.#policy.audit.integrityWarnedEvent, actor, {
        view: spec.id,
        severity: verdict.severity,
        brokenAt: verdict.brokenAt,
        reason: verdict.reason,
        problem: verdict.problem,
        tailComplete: verdict.tailComplete,
        headAgrees: verdict.headAgrees,
      });
    } else {
      log.append(this.#policy.audit.integrityEvent, actor, {
        view: spec.id,
        count: verdict.count,
        lastHash: verdict.lastHash,
      });
    }

    const rows =
      spec.face === 'integrity'
        ? this.#integrityRows(inspection, verdict)
        : this.#eventRows(spec, actor, inspection, criteria);

    return deepFreeze({
      view: spec.id,
      face: spec.face,
      source: spec.source,
      observedAtMs,
      integrity: verdict,
      rows,
    });
  }

  /**
   * تحقُّقُ معاييرِ المشهدِ **قبل** كتابةِ القيدِ وقبل فتحِ المفحوص: حقلُ بحثٍ
   * معلَنٌ ومصطلحٌ مقبولٌ ومدًى زمنيٌّ مقروء.
   * @param {AuditViewSpec} spec
   * @param {string} actor
   * @param {{ field?: string, term?: string, from?: string, to?: string }} request
   * @returns {Record<string, unknown>}
   */
  #criteria(spec, actor, request) {
    if (spec.face === 'search') {
      const field = typeof request.field === 'string' ? request.field.trim() : '';
      if (!this.#policy.search.fields.includes(field)) {
        this.#refuse(
          actor,
          new AuditViewerError(
            AUDIT_VIEWER_ERRORS.FIELD_UNDECLARED,
            `الحقل «${field}» غيرُ معلَنٍ في حقولِ البحث؛ والمُعلَنةُ ${this.#policy.search.fields.join('، ')} — وبحثٌ على حقلٍ يخترعه المُنادي بحثٌ بلا عقدٍ يُقاس عليه.`,
            { view: spec.id, field },
          ),
          { view: spec.id, field },
        );
      }
      const term = typeof request.term === 'string' ? request.term.trim() : '';
      if (term === '' || term.length > this.#policy.search.maxTermLength) {
        this.#refuse(
          actor,
          new AuditViewerError(
            AUDIT_VIEWER_ERRORS.TERM_INVALID,
            `مصطلحُ البحثِ فارغٌ أو يتجاوز الحدَّ المُعلَنَ (${this.#policy.search.maxTermLength} حرفاً)؛ ومصطلحٌ فارغٌ مسحٌ كاملٌ باسمِ بحث.`,
            { view: spec.id, length: term.length },
          ),
          { view: spec.id, length: term.length },
        );
      }
      return { field, term };
    }
    if (spec.face === 'timeline') {
      const from = this.#instant(spec, actor, request.from, 'from');
      const to = this.#instant(spec, actor, request.to, 'to');
      if (from !== null && to !== null && from > to) {
        this.#refuse(
          actor,
          new AuditViewerError(
            AUDIT_VIEWER_ERRORS.RANGE_INVALID,
            `المدى الزمنيُّ مقلوبٌ: بدايتُه «${String(request.from)}» بعد نهايتِه «${String(request.to)}»؛ ومدًى مقلوبٌ يُعيد صفراً من الصفوفِ فيُقرأ «لا شيءَ وقع».`,
            { view: spec.id },
          ),
          { view: spec.id },
        );
      }
      return {
        from: request.from === undefined ? null : String(request.from),
        to: request.to === undefined ? null : String(request.to),
      };
    }
    return {};
  }

  /**
   * @param {AuditViewSpec} spec
   * @param {string} actor
   * @param {string | undefined} value
   * @param {'from' | 'to'} edge
   * @returns {number | null}
   */
  #instant(spec, actor, value, edge) {
    if (value === undefined) return null;
    const parsed = Date.parse(String(value));
    if (!Number.isFinite(parsed)) {
      this.#refuse(
        actor,
        new AuditViewerError(
          AUDIT_VIEWER_ERRORS.RANGE_INVALID,
          `حدُّ المدى «${edge}» قيمتُه «${String(value)}» وليست زمناً مقروءاً بصيغةِ ISO؛ وحدٌّ لا يُقرأ يُطبَّق صامتاً فيُخفي ما بين يديه.`,
          { view: spec.id, edge, value: String(value) },
        ),
        { view: spec.id, edge, value: String(value) },
      );
    }
    return parsed;
  }

  /**
   * صفوفُ وجهِ السلامة: حكمٌ واحدٌ مفصَّلٌ يُقرأ سطراً، لا قائمةَ أحداث.
   * @param {import('../root-of-trust/persistent-log.mjs').EventLogInspection} inspection
   * @param {AuditIntegrityVerdict} verdict
   * @returns {readonly Record<string, unknown>[]}
   */
  #integrityRows(inspection, verdict) {
    return [
      {
        file: inspection.file,
        exists: inspection.exists,
        count: verdict.count,
        lastHash: verdict.lastHash,
        chainOk: verdict.ok,
        tailComplete: verdict.tailComplete,
        headAgrees: verdict.headAgrees,
        brokenAt: verdict.brokenAt,
        reason: verdict.reason,
        problem: verdict.problem,
        warned: verdict.warned,
        severity: verdict.severity,
        declaredBreakReasons: [...this.#policy.integrity.breakReasons],
      },
    ];
  }

  /**
   * صفوفُ وجهَي البحثِ والتسلسل — مرشَّحةً بالمعاييرِ المُعلَنةِ ومرتَّبةً
   * بالتسلسلِ صعوداً، وفوقَ الحدِّ المُعلَنِ رفضٌ مُسمّىً لا اقتطاعٌ صامت.
   * @param {AuditViewSpec} spec
   * @param {string} actor
   * @param {import('../root-of-trust/persistent-log.mjs').EventLogInspection} inspection
   * @param {Record<string, unknown>} criteria
   * @returns {readonly Record<string, unknown>[]}
   */
  #eventRows(spec, actor, inspection, criteria) {
    /** @type {Record<string, unknown>[]} */
    const rows = [];
    const field = typeof criteria['field'] === 'string' ? criteria['field'] : null;
    const term = typeof criteria['term'] === 'string' ? criteria['term'].toLowerCase() : null;
    const from = typeof criteria['from'] === 'string' ? Date.parse(criteria['from']) : null;
    const to = typeof criteria['to'] === 'string' ? Date.parse(criteria['to']) : null;
    for (const event of inspection.events) {
      if (field !== null && term !== null) {
        const value = String(
          /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (event))[field] ?? '',
        );
        if (!value.toLowerCase().includes(term)) continue;
      }
      if (from !== null || to !== null) {
        const at = Date.parse(event.at);
        if (!Number.isFinite(at)) continue;
        if (from !== null && at < from) continue;
        if (to !== null && at > to) continue;
      }
      rows.push({
        id: event.id,
        seq: event.seq,
        type: event.type,
        actor: event.actor,
        at: event.at,
        previousHash: event.previousHash,
        hash: event.hash,
        data: { ...event.data },
      });
    }
    rows.sort((left, right) => Number(left['seq']) - Number(right['seq']));
    if (rows.length > this.maxRows) {
      this.#refuse(
        actor,
        new AuditViewerError(
          AUDIT_VIEWER_ERRORS.ROWS_EXCEEDED,
          `المشهد ${spec.id} يُطابقه ${rows.length} صفّاً والحدُّ المُعلَنُ ${this.maxRows}؛ والرفضُ مُسمّىً لا اقتطاعٌ صامتٌ — فمن عرض أوّلَ ${this.maxRows} وسمّاها «النتيجة» أخفى بقيةَ الشهادةِ في موضعِ المساءلة.`,
          { view: spec.id, matched: rows.length, maxRows: this.maxRows },
        ),
        { view: spec.id, matched: rows.length, maxRows: this.maxRows },
      );
    }
    return rows;
  }

  /**
   * وجهُ البحث: مصطلحٌ على حقلٍ معلَن.
   * @param {{ field: string, term: string, actor?: string }} request
   * @returns {{ view: string, face: string, source: string, observedAtMs: number, integrity: AuditIntegrityVerdict, rows: readonly Record<string, unknown>[] }}
   */
  search(request) {
    return this.view({ view: this.#viewOf('search'), ...request });
  }

  /**
   * وجهُ التسلسلِ الزمنيّ: مدًى اختياريُّ الحدّين، والصفوفُ مرتَّبةٌ بالتسلسل.
   * @param {{ from?: string, to?: string, actor?: string }} [request]
   * @returns {{ view: string, face: string, source: string, observedAtMs: number, integrity: AuditIntegrityVerdict, rows: readonly Record<string, unknown>[] }}
   */
  timeline(request = {}) {
    return this.view({ view: this.#viewOf('timeline'), ...request });
  }

  /**
   * وجهُ السلامة: حكمُ السلسلةِ مفصَّلاً — وهو نفسُه الحكمُ الذي يرافق الوجهين
   * الآخرين، لا فحصٌ ثانٍ بقاعدةٍ أخرى.
   * @param {{ actor?: string }} [context]
   * @returns {{ view: string, face: string, source: string, observedAtMs: number, integrity: AuditIntegrityVerdict, rows: readonly Record<string, unknown>[] }}
   */
  integrity(context = {}) {
    return this.view({ view: this.#viewOf('integrity'), ...context });
  }

  /**
   * **قياسُ معيارِ القبولِ بحرفه:** هل ظهر العبثُ تحذيرَ سلامةٍ في الواجهة؟
   * يقرأ وجهَ السلامةِ ثم يُرَدُّ برمزٍ مُعلَنٍ إن كان الحكمُ مُحذِّراً — والرفضُ
   * يحمل موضعَ الانكسارِ وسببَه في تفصيلِه، ويُكتب في السجلِّ ولا يُخفي المشهدَ:
   * الصفوفُ تبقى مقروءةً موسومةً بتحذيرِها.
   * @param {{ actor?: string }} [context]
   * @returns {AuditIntegrityVerdict}
   */
  assertIntact(context = {}) {
    const actor = context.actor ?? 'audit:viewer';
    const shown = this.integrity({ actor });
    const verdict = shown.integrity;
    if (verdict.warned) {
      this.#refuse(
        actor,
        new AuditViewerError(
          AUDIT_VIEWER_ERRORS.INTEGRITY_BROKEN,
          `سلسلةُ سجلِّ التدقيقِ مُحذِّرة: ${verdict.reason ?? verdict.problem ?? 'ذيلٌ ناقصٌ أو رأسٌ لا يوافق'}${verdict.brokenAt === null ? '' : ` عند الحدث ${verdict.brokenAt}`}؛ والشهادةُ التي لا تُثبت أنها لم تُبدَّل ليست شهادة.`,
          {
            brokenAt: verdict.brokenAt,
            reason: verdict.reason,
            problem: verdict.problem,
            severity: verdict.severity,
          },
        ),
        { brokenAt: verdict.brokenAt, reason: verdict.reason, problem: verdict.problem },
      );
    }
    return verdict;
  }

  /**
   * معرّفُ المشهدِ من وجهِه — والأوجهُ محروسةٌ عند التحميلِ وجهاً بمشهدٍ واحد.
   * @param {'search' | 'timeline' | 'integrity'} face
   * @returns {string}
   */
  #viewOf(face) {
    const spec = [...this.#views.values()].find((view) => view.face === face);
    return spec === undefined ? face : spec.id;
  }
}
