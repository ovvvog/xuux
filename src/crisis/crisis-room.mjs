// غرفةُ الأزمات — الخطوة `M9.06`.
//
// ما تفعله بدقة: تُحوِّل «إجراءَ الطوارئ» من ذاكرةِ مُشغِّلٍ إلى **بياناتٍ
// مُنفَّذةٍ بترتيبٍ محفوظ**. فتُفتَح جلسةُ تمرينٍ على إجراءٍ معلَنٍ في
// `config/crisis-room.yaml`، ثم لا تُنفَّذ خطوةٌ إلا وهي الخطوةُ التالية بعينها،
// ولا تُغلَق الجلسةُ إلا وقد شهد **ملفُّ السجلِّ على القرصِ** بقيدِ تنفيذٍ لكلِّ
// خطوةٍ معلَنةٍ، وأُقرّ كلُّ تصعيدٍ رُفع فيها من بشريٍّ غيرِ رافعِه.
//
// وما لا تفعله — وهذا حدُّها المقصود: لا تملك مفتاحاً ولا توقّع أمراً ولا تلمس
// زرَّ الإيقافِ ولا بوابةَ التاجِ. الأثرُ السياديُّ كلُّه يمرّ بالديوانِ الملكيِّ
// (`src/console/royal-console.mjs`) أمراً موقَّعاً بمفتاحِ الملكِ يقدّمه المُنادي،
// فتبقى عقباتُ `M9.03` و`M9.04` — التوقيعُ والتاجُ والجلسةُ القوية — قائمةً كما
// هي، ولا يصير وجودُ «غرفةِ أزمات» طريقاً حول الحواجزِ التي بُنيت قبلها. ولو
// كانت هذه الغرفةُ تنادي زرَّ الإيقافِ مباشرةً لكانت أخطرَ ممّا تحمي منه — والحاجزُ
// `scripts/guard-crisis.mjs` يقرأ نصَّها ليمنع ذلك في أيِّ تعديلٍ قادم.
//
// والحجْرُ فيها ليس علماً في ذاكرتها: هو `transition(id, 'quarantined', reason)`
// في سجلِّ الهوياتِ — وتلك حالةٌ يقرأها `requireActiveIdentity` في
// `src/api/session-store.mjs` عند كلِّ نداءٍ فيرُدُّ صاحبَها بـ
// `API_IDENTITY_UNVERIFIED` ولو كانت جلستُه مفتوحةً قبل حجْره. فأثرُ الحجْرِ
// مقيسٌ على المسارِ الحقيقيِّ لا مُعلَنٌ في حقلٍ لا يمنع شيئاً.
//
// **حدٌّ معلَنٌ أول:** لا نقلَ شبكيّاً ولا واجهةَ رسوميّةً هنا — الغرفةُ نداءٌ
// داخليٌّ كالديوان، وطبقةُ النقلِ دَينٌ مملوكٌ للمسار `M10` مسجَّلٌ في
// `docs/REMAINING_WORK.md`. فما يُقاس «يُنفَّذ من الواجهةِ كاملاً» بمعنى: من
// مِقبضِ الديوانِ وحدَه لا من نداءٍ مباشرٍ على المحرّكاتِ تحته.
//
// **حدٌّ معلَنٌ ثانٍ:** جلساتُ التمرينِ في الذاكرةِ لا على القرص، فإعادةُ تشغيلِ
// العمليةِ تُنسي «تمريناً مفتوحاً». والدليلُ — وهو ما يُبنى عليه الإغلاق — يُقرأ
// من القرصِ لا من الذاكرة، فلا يُكسَب بالنسيان: تمرينٌ نُسي لا يُغلَق أصلاً.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import Ajv2020Default from 'ajv/dist/2020.js';

/** @type {typeof import('ajv/dist/2020.js').Ajv2020} */
const Ajv2020 = /** @type {typeof import('ajv/dist/2020.js').Ajv2020} */ (
  /** @type {unknown} */ (
    /** @type {{ default?: unknown }} */ (Ajv2020Default).default ?? Ajv2020Default
  )
);

import YAML from 'yaml';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** مجلدُ الوثائقِ الافتراضيُّ — يُوسَّع بالحقنِ في الاختبارِ لا بتعديلِ الكود. */
export const DEFAULT_CRISIS_CONFIG_DIR = path.resolve(HERE, '..', '..', 'config');

/**
 * رموزُ الرفض — تُقابَل بالمُعلَنِ في الوثيقةِ في الاتجاهين على الحاجز
 * `scripts/guard-crisis.mjs`: فلا رمزٌ في الكودِ بلا إعلانٍ، ولا رمزٌ مُعلَنٌ بلا
 * موضعِ إنفاذٍ يرفعه.
 */
export const CRISIS_ERRORS = Object.freeze({
  CONFIG_INVALID: 'CRISIS_CONFIG_INVALID',
  AUDIT_REQUIRED: 'CRISIS_AUDIT_REQUIRED',
  PROCEDURE_UNDECLARED: 'CRISIS_PROCEDURE_UNDECLARED',
  DRILL_REQUIRED: 'CRISIS_DRILL_REQUIRED',
  DRILL_ACTIVE: 'CRISIS_DRILL_ACTIVE',
  DRILL_EXPIRED: 'CRISIS_DRILL_EXPIRED',
  STEP_UNDECLARED: 'CRISIS_STEP_UNDECLARED',
  STEP_OUT_OF_ORDER: 'CRISIS_STEP_OUT_OF_ORDER',
  CONSOLE_REQUIRED: 'CRISIS_CONSOLE_REQUIRED',
  COMMAND_REFUSED: 'CRISIS_COMMAND_REFUSED',
  OPERATIONS_REQUIRED: 'CRISIS_OPERATIONS_REQUIRED',
  INCIDENT_REFUSED: 'CRISIS_INCIDENT_REFUSED',
  REGISTRY_REQUIRED: 'CRISIS_REGISTRY_REQUIRED',
  QUARANTINE_REASON_REQUIRED: 'CRISIS_QUARANTINE_REASON_REQUIRED',
  QUARANTINE_SCOPE_UNDECLARED: 'CRISIS_QUARANTINE_SCOPE_UNDECLARED',
  QUARANTINE_REFUSED: 'CRISIS_QUARANTINE_REFUSED',
  ESCALATION_CONTACT_UNKNOWN: 'CRISIS_ESCALATION_CONTACT_UNKNOWN',
  ESCALATION_SELF_ACK: 'CRISIS_ESCALATION_SELF_ACK',
  ESCALATION_DEADLINE_MISSED: 'CRISIS_ESCALATION_DEADLINE_MISSED',
  ESCALATION_PENDING: 'CRISIS_ESCALATION_PENDING',
  EVIDENCE_MISSING: 'CRISIS_EVIDENCE_MISSING',
  CLOCK_INVALID: 'CRISIS_CLOCK_INVALID',
});

/** أنواعُ الخطواتِ المكتوبةُ في الكود — يقابلها `enum` في مخطَّطِ الوثيقة. */
export const CRISIS_STEP_KINDS = Object.freeze([
  'incident',
  'quarantine',
  'command',
  'escalation',
  'release',
]);

/** خطأُ غرفةِ الأزماتِ برمزٍ مُعلَنٍ وتفصيلٍ يُقيَّد في السجل. */
export class CrisisError extends Error {
  /** @type {string} */
  code;
  /** @type {Record<string, unknown>} */
  detail;

  /**
   * @param {string} code
   * @param {string} message
   * @param {Record<string, unknown>} [detail]
   * @param {{ cause?: unknown }} [options]
   */
  constructor(code, message, detail = {}, options = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'CrisisError';
    this.code = code;
    this.detail = detail;
  }
}

/**
 * @param {string} message
 * @returns {never}
 */
function invalidConfig(message) {
  throw new CrisisError(CRISIS_ERRORS.CONFIG_INVALID, message);
}

/**
 * @param {unknown} error
 * @returns {string}
 */
function errorText(error) {
  return error instanceof Error ? error.message : String(error);
}

/**
 * @param {unknown} error
 * @returns {string}
 */
function codeOf(error) {
  if (error !== null && typeof error === 'object' && 'code' in error) {
    return String(/** @type {{ code: unknown }} */ (error).code);
  }
  return errorText(error);
}

/**
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
 * @typedef {object} CrisisStepSpec
 * @property {string} id
 * @property {'incident' | 'quarantine' | 'command' | 'escalation' | 'release'} kind
 * @property {string} purpose
 * @property {string} [severity]
 * @property {string} [scope]
 * @property {string} [command]
 * @property {string} [contact]
 */

/**
 * @typedef {object} CrisisProcedureSpec
 * @property {string} id
 * @property {string} title
 * @property {string} trigger
 * @property {readonly CrisisStepSpec[]} steps
 */

/**
 * @typedef {object} CrisisContactSpec
 * @property {string} id
 * @property {string} role
 * @property {string} channel
 * @property {string} purpose
 */

/**
 * @typedef {object} CrisisPolicy
 * @property {number} version
 * @property {string} statement
 * @property {{ drillOpenedEvent: string, stepExecutedEvent: string, stepRefusedEvent: string, escalationRaisedEvent: string, escalationAcknowledgedEvent: string, drillClosedEvent: string, statement: string }} audit
 * @property {readonly string[]} refusalCodes
 * @property {{ scopes: readonly string[], state: string, releaseState: string, maxActive: number, reasonMinLength: number, releaseRequiresAcknowledgedEscalation: boolean, statement: string }} quarantine
 * @property {{ contacts: readonly CrisisContactSpec[], acknowledgmentDeadlineMs: number, minAcknowledgers: number, selfAcknowledgeForbidden: boolean, statement: string }} escalation
 * @property {{ requireAllSteps: boolean, evidence: string, maxDurationMs: number, statement: string }} drill
 * @property {readonly CrisisProcedureSpec[]} procedures
 * @property {ReadonlyArray<{ id: string, statement: string, enforcedBy: string, codes: readonly string[] }>} guarantees
 */

/**
 * تحميلُ وثيقةِ غرفةِ الأزماتِ ثم فحصُها بمخطَّطٍ صارمٍ ثم فحوصُ تماسكٍ لا
 * يُعبِّر عنها المخطَّط: فمخطَّطٌ يقبل إجراءً بخطوتين متطابقتي المعرّفِ يقبل
 * إجراءً لا يُعرَف أيُّهما التالية.
 *
 * @param {{ dir?: string }} [options]
 * @returns {CrisisPolicy}
 */
export function loadCrisisPolicy(options = {}) {
  const dir = options.dir ?? DEFAULT_CRISIS_CONFIG_DIR;
  const schemaDir = fs.existsSync(path.join(dir, 'schemas')) ? dir : DEFAULT_CRISIS_CONFIG_DIR;
  const file = path.join(dir, 'crisis-room.yaml');
  if (!fs.existsSync(file)) {
    invalidConfig(
      'وثيقةُ غرفةِ الأزماتِ غائبة؛ وغرفةٌ بلا وثيقةٍ تُعلن إجراءاتِها وترتيبَها غرفةٌ حدُّها ذاكرةُ من دخلها.',
    );
  }
  /** @type {unknown} */
  let raw;
  try {
    raw = YAML.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    invalidConfig(`تعذّرت قراءة crisis-room.yaml: ${errorText(error)}`);
  }
  const schemaPath = path.join(schemaDir, 'schemas', 'crisis-room.schema.json');
  if (!fs.existsSync(schemaPath)) {
    invalidConfig(
      'مخطَّطُ وثيقةِ غرفةِ الأزماتِ غائب؛ وبلا مخطَّطٍ يصير إعلانُ الإجراءِ نصّاً حرّاً كالعُرفِ الذي جاء ليمنعه.',
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
    invalidConfig(`crisis-room.yaml يخالف مخطَّطه: ${problems}`);
  }
  const parsed = /** @type {CrisisPolicy} */ (raw);

  // ── فحوصُ تماسكٍ لا يُعبِّر عنها مخطَّط ──

  /** @type {Set<string>} */
  const contactIds = new Set();
  for (const contact of parsed.escalation.contacts) {
    if (contactIds.has(contact.id)) {
      invalidConfig(
        `جهةُ التصعيد ${contact.id} مُعلَنةٌ مرّتين؛ وجهتانِ بمعرّفٍ واحدٍ لا يُعرَف أيُّهما أُبلِغت.`,
      );
    }
    contactIds.add(contact.id);
  }
  if (parsed.escalation.minAcknowledgers > contactIds.size) {
    invalidConfig(
      `الوثيقةُ تطلب ${parsed.escalation.minAcknowledgers} مُقرّاً ولا تُعلن إلا ${contactIds.size} جهةً؛ وشرطٌ لا يمكن استيفاؤه شرطٌ يُقفل الإجراءَ لا يحميه.`,
    );
  }
  if (parsed.escalation.selfAcknowledgeForbidden && contactIds.size < 2) {
    invalidConfig('الوثيقةُ تمنع الإقرارَ الذاتيَّ ولا تُعلن إلا جهةً واحدة؛ فلا يبقى من يُقرّ.');
  }

  /** @type {Set<string>} */
  const procedureIds = new Set();
  /** @type {Set<string>} */
  const declaredCodes = new Set(parsed.refusalCodes);
  for (const procedure of parsed.procedures) {
    if (procedureIds.has(procedure.id)) {
      invalidConfig(
        `الإجراء ${procedure.id} مُعلَنٌ مرّتين؛ وإجراءانِ بمعرّفٍ واحدٍ يُنفَّذ أحدُهما باسمِ الآخر.`,
      );
    }
    procedureIds.add(procedure.id);
    /** @type {Set<string>} */
    const stepIds = new Set();
    let commands = 0;
    let quarantines = 0;
    let releases = 0;
    for (const step of procedure.steps) {
      if (stepIds.has(step.id)) {
        invalidConfig(
          `الخطوة ${step.id} مُعلَنةٌ مرّتين في ${procedure.id}؛ وخطوتانِ بمعرّفٍ واحدٍ لا يُعرَف أيُّهما التالية.`,
        );
      }
      stepIds.add(step.id);
      if (step.kind === 'command') commands += 1;
      if (step.kind === 'quarantine') quarantines += 1;
      if (step.kind === 'release') releases += 1;
      if (step.kind === 'escalation' && !contactIds.has(String(step.contact))) {
        invalidConfig(
          `الخطوة ${step.id} تُصعِّد إلى «${String(step.contact)}» وهي جهةٌ غيرُ معلَنة؛ وتصعيدٌ إلى جهةٍ لا وجودَ لها تصعيدٌ يقع في الفراغ.`,
        );
      }
      if (
        (step.kind === 'quarantine' || step.kind === 'release') &&
        !parsed.quarantine.scopes.includes(String(step.scope))
      ) {
        invalidConfig(
          `الخطوة ${step.id} نطاقُها «${String(step.scope)}» وهو غيرُ معلَنٍ في نطاقاتِ الحجْر؛ ونطاقٌ يُخترع في الإجراءِ يُوسِّع العقوبةَ بلا قرار.`,
        );
      }
    }
    if (commands === 0) {
      invalidConfig(
        `الإجراء ${procedure.id} بلا خطوةِ أمرٍ واحدةٍ من الديوان؛ وإجراءُ أزمةٍ لا يُصدر أمراً وثيقةُ نصائحَ لا إجراءُ إدارةِ أزمة.`,
      );
    }
    if (releases > quarantines) {
      invalidConfig(
        `الإجراء ${procedure.id} يرفع حجْراً لم يُوقِعه؛ ورفعُ ما لم يقع خطوةٌ بلا أثرٍ تُقرأ إنجازاً.`,
      );
    }
  }

  for (const guarantee of parsed.guarantees) {
    for (const code of guarantee.codes) {
      if (!declaredCodes.has(code)) {
        invalidConfig(
          `الضمان ${guarantee.id} يستند إلى الرمز «${code}» وهو غيرُ معلَنٍ في رموزِ الرفض؛ وضمانٌ برمزٍ لا وجودَ له ضمانٌ لا يُقاس.`,
        );
      }
    }
  }

  return deepFreeze(parsed);
}

/**
 * @typedef {object} CrisisLogLike
 * @property {(type: string, actor: string, data: Record<string, unknown>) => unknown} append
 */

/**
 * @typedef {object} CrisisConsoleLike
 * @property {(request: { command: string, royalCommand: Record<string, unknown>, signature: string, sovereignSession?: string }) => Promise<{ command: string, action: string, kind: string, path: string, commandId: string, status: string, effect: Record<string, unknown> }>} issue
 */

/**
 * @typedef {object} CrisisOperationsLike
 * @property {(incident: Record<string, unknown>, context?: { actor?: string }) => { id: string, severity: string, recordedAtMs: number }} record
 */

/**
 * @typedef {object} CrisisRegistryLike
 * @property {(id: string, state: import('../identity/agent-registry.mjs').AgentStateValue, reason?: string) => Promise<unknown>} transition
 */

/**
 * @typedef {object} CrisisDrillState
 * @property {string} id
 * @property {CrisisProcedureSpec} procedure
 * @property {number} index
 * @property {number} openedAtMs
 * @property {string} actor
 * @property {Map<string, { id: string, contact: string, raisedBy: string, raisedAtMs: number, acknowledgedBy: string | null, acknowledgedAtMs: number | null }>} escalations
 * @property {Set<string>} quarantined
 */

/**
 * غرفةُ الأزمات: خمسةُ مقابضَ لا سادس — وصفٌ، وفتحُ تمرين، وتنفيذُ خطوة، وإقرارُ
 * تصعيد، وإغلاقُ تمرين. ولا مِقبضَ يقع به أثرٌ سياديٌّ إلا عبر الديوانِ المُمرَّر.
 */
export class CrisisRoom {
  /** @type {CrisisPolicy} */
  #policy;
  /** @type {Map<string, CrisisProcedureSpec>} */
  #procedures = new Map();
  /** @type {Map<string, CrisisContactSpec>} */
  #contacts = new Map();
  /** @type {CrisisConsoleLike | null} */
  #console;
  /** @type {CrisisOperationsLike | null} */
  #operations;
  /** @type {CrisisRegistryLike | null} */
  #agents;
  /** @type {CrisisLogLike | null} */
  #log;
  /** @type {(() => ReadonlyArray<{ type: string, actor: string, data: Record<string, unknown> }>) | null} */
  #evidence;
  /** @type {() => number} */
  #nowMs;
  /** @type {Map<string, CrisisDrillState>} */
  #drills = new Map();
  /** @type {number} */
  #sequence = 0;

  /**
   * @param {{ policy?: CrisisPolicy, dir?: string, console?: CrisisConsoleLike | null, operations?: CrisisOperationsLike | null, agents?: CrisisRegistryLike | null, log?: CrisisLogLike | null, evidence?: (() => ReadonlyArray<{ type: string, actor: string, data: Record<string, unknown> }>) | null, nowMs?: () => number }} [deps]
   */
  constructor(deps = {}) {
    this.#policy = deps.policy ?? loadCrisisPolicy(deps.dir === undefined ? {} : { dir: deps.dir });
    this.#console = deps.console ?? null;
    this.#operations = deps.operations ?? null;
    this.#agents = deps.agents ?? null;
    this.#log = deps.log ?? null;
    this.#evidence = deps.evidence ?? null;
    this.#nowMs = deps.nowMs ?? (() => Date.now());
    for (const procedure of this.#policy.procedures) this.#procedures.set(procedure.id, procedure);
    for (const contact of this.#policy.escalation.contacts) this.#contacts.set(contact.id, contact);
  }

  /** @returns {CrisisPolicy} */
  get policy() {
    return this.#policy;
  }

  /**
   * وصفُ ما تملكه الغرفةُ من إجراءاتٍ وجهاتٍ ومهلٍ — بياناتٌ تُقرأ لا مِقبضٌ يقع
   * به أثر. وترتيبُ الخطواتِ مُعلَنٌ في المُعاد كي يُقرأ الإجراءُ قبل تنفيذِه.
   * @returns {{ procedures: ReadonlyArray<{ id: string, title: string, trigger: string, steps: ReadonlyArray<{ id: string, kind: string, purpose: string }> }>, contacts: ReadonlyArray<{ id: string, role: string, channel: string }>, acknowledgmentDeadlineMs: number, maxDurationMs: number, quarantineState: string, openDrills: number }}
   */
  describe() {
    return deepFreeze({
      procedures: [...this.#procedures.values()].map((procedure) => ({
        id: procedure.id,
        title: procedure.title,
        trigger: procedure.trigger,
        steps: procedure.steps.map((step) => ({
          id: step.id,
          kind: step.kind,
          purpose: step.purpose,
        })),
      })),
      contacts: [...this.#contacts.values()].map((contact) => ({
        id: contact.id,
        role: contact.role,
        channel: contact.channel,
      })),
      acknowledgmentDeadlineMs: this.#policy.escalation.acknowledgmentDeadlineMs,
      maxDurationMs: this.#policy.drill.maxDurationMs,
      quarantineState: this.#policy.quarantine.state,
      openDrills: this.#drills.size,
    });
  }

  /**
   * السجلُّ الدائمُ أو رفضٌ مُسمّى — العقبةُ الأولى على كلِّ مِقبض؛ فخطوةُ أزمةٍ
   * تقع بلا قيدٍ دائمٍ يشهد عليها أسوأُ من خطوةٍ مرفوضة.
   * @returns {CrisisLogLike}
   */
  #requireLog() {
    const log = this.#log;
    if (log === null) {
      throw new CrisisError(
        CRISIS_ERRORS.AUDIT_REQUIRED,
        'السجلُّ الدائمُ غيرُ موصولٍ بغرفةِ الأزمات؛ وتمرينٌ يُدار بلا قيدٍ دائمٍ تمرينٌ لا يُراجَع ولا يُصدَّق.',
      );
    }
    return log;
  }

  /**
   * قراءةُ الساعةِ المُمرَّرة: مهلةُ الإقرارِ ومدّةُ التمرينِ تُقاسانِ عليها، فساعةٌ
   * تُعطي غيرَ عددٍ منتهٍ غيرِ سالبٍ تُرَدُّ برمزٍ مُعلَن.
   * @param {string} where
   * @returns {number}
   */
  #clock(where) {
    const value = this.#nowMs();
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
      throw new CrisisError(
        CRISIS_ERRORS.CLOCK_INVALID,
        `الساعةُ المُمرَّرةُ أعطت «${String(value)}» عند ${where}؛ ومهلةٌ تُقاس بساعةٍ لا تُعطي عدداً منتهياً غيرَ سالبٍ مهلةٌ لا معنى لقياسِها.`,
        { where, value: String(value) },
      );
    }
    return value;
  }

  /**
   * قيدُ رفضٍ في السجلِّ الدائمِ ثم رفعُ الخطأ: الرفضُ يُكتب كما يُكتب القبول،
   * فمن قرأ السجلَّ ميَّز «خطوةٌ رُفضت» من «خطوةٌ لم تُحاوَل».
   * @param {string} actor
   * @param {CrisisError} error
   * @param {Record<string, unknown>} data
   * @returns {never}
   */
  #refuse(actor, error, data) {
    const log = this.#log;
    if (log !== null) {
      log.append(this.#policy.audit.stepRefusedEvent, actor, {
        ...data,
        code: error.code,
        reason: error.message,
      });
    }
    throw error;
  }

  /**
   * جلسةُ تمرينٍ قائمةٌ داخلَ مدّتِها المُعلَنة، أو رفضٌ مُسمّى.
   * @param {unknown} drillId
   * @param {string} actor
   * @param {number} atMs
   * @returns {CrisisDrillState}
   */
  #requireDrill(drillId, actor, atMs) {
    const id = typeof drillId === 'string' ? drillId.trim() : '';
    const drill = id === '' ? undefined : this.#drills.get(id);
    if (drill === undefined) {
      this.#refuse(
        actor,
        new CrisisError(
          CRISIS_ERRORS.DRILL_REQUIRED,
          `لا تمرينَ مفتوحاً بالمعرّف «${id}»؛ وخطوةُ أزمةٍ بلا جلسةٍ تنتظمها خطوةٌ لا تُقاس ولا تُغلَق.`,
          { drill: id },
        ),
        { drill: id },
      );
    }
    if (atMs - drill.openedAtMs > this.#policy.drill.maxDurationMs) {
      this.#refuse(
        actor,
        new CrisisError(
          CRISIS_ERRORS.DRILL_EXPIRED,
          `التمرين ${drill.id} تجاوز مدّتَه المُعلَنة (${this.#policy.drill.maxDurationMs}ms)؛ وتمرينٌ يُفتَح ويُترك ثم يُكمَل بعد يومٍ تمرينٌ لا يقيس استجابةَ أزمة.`,
          { drill: drill.id, openedAtMs: drill.openedAtMs, atMs },
        ),
        { drill: drill.id },
      );
    }
    return drill;
  }

  /**
   * فتحُ تمرينٍ على إجراءٍ معلَنٍ — والقيدُ قبل الأثر، ولا تمرينانِ مفتوحانِ معاً
   * فإجراءانِ متزامنانِ على دولةٍ واحدةٍ يتنازعانِ الإيقافَ والاستئناف.
   * @param {{ procedure?: unknown, actor?: string, reason?: unknown }} request
   * @returns {{ drill: string, procedure: string, steps: readonly string[], openedAtMs: number }}
   */
  openDrill(request = {}) {
    const actor =
      typeof request.actor === 'string' && request.actor !== '' ? request.actor : 'crisis:room';
    this.#requireLog();
    const openedAtMs = this.#clock('فتحِ تمرين');
    const procedureId = typeof request.procedure === 'string' ? request.procedure.trim() : '';
    const procedure = procedureId === '' ? undefined : this.#procedures.get(procedureId);
    if (procedure === undefined) {
      this.#refuse(
        actor,
        new CrisisError(
          CRISIS_ERRORS.PROCEDURE_UNDECLARED,
          `الإجراء «${procedureId}» غيرُ معلَنٍ في وثيقةِ غرفةِ الأزمات؛ والإجراءاتُ بياناتٌ في الوثيقةِ لا أسماءٌ يخترعها من دخل الغرفة.`,
          { procedure: procedureId },
        ),
        { procedure: procedureId },
      );
    }
    for (const open of this.#drills.values()) {
      this.#refuse(
        actor,
        new CrisisError(
          CRISIS_ERRORS.DRILL_ACTIVE,
          `التمرين ${open.id} على ${open.procedure.id} ما زال مفتوحاً؛ وتمرينانِ معاً يتنازعانِ إيقافَ الدولةِ واستئنافَها فيُلغي أحدُهما أثرَ الآخر.`,
          { open: open.id, procedure: procedureId },
        ),
        { procedure: procedureId },
      );
    }
    this.#sequence += 1;
    const id = `drill:${openedAtMs}:${this.#sequence}`;
    // القيدُ قبل الأثر: يُكتب فتحُ التمرينِ في السجلِّ ثم يُثبَّت في الذاكرة.
    this.#requireLog().append(this.#policy.audit.drillOpenedEvent, actor, {
      drill: id,
      procedure: procedure.id,
      steps: procedure.steps.map((step) => step.id),
      openedAtMs,
      reason: typeof request.reason === 'string' ? request.reason : null,
    });
    this.#drills.set(id, {
      id,
      procedure,
      index: 0,
      openedAtMs,
      actor,
      escalations: new Map(),
      quarantined: new Set(),
    });
    return deepFreeze({
      drill: id,
      procedure: procedure.id,
      steps: procedure.steps.map((step) => step.id),
      openedAtMs,
    });
  }

  /**
   * تنفيذُ الخطوةِ التاليةِ بعينِها من الإجراء — لا خطوةً أخرى ولو كانت معلَنةً في
   * الإجراءِ نفسِه. وترتيبُ العقباتِ: سجلٌّ ⇒ ساعةٌ ⇒ تمرينٌ قائمٌ ⇒ خطوةٌ معلَنةٌ ⇒
   * موضعُها من الترتيبِ ⇒ قيدٌ في السجلِّ ⇒ أثرٌ في العالم.
   * @param {{ drill?: unknown, step?: unknown, actor?: string, incident?: Record<string, unknown>, target?: unknown, reason?: unknown, royalCommand?: Record<string, unknown>, signature?: string, sovereignSession?: string }} request
   * @returns {Promise<{ drill: string, step: string, kind: string, status: 'executed', executedAtMs: number, effect: Record<string, unknown>, remaining: readonly string[] }>}
   */
  async executeStep(request = {}) {
    const actor =
      typeof request.actor === 'string' && request.actor !== '' ? request.actor : 'crisis:room';
    const log = this.#requireLog();
    const executedAtMs = this.#clock('تنفيذِ خطوة');
    const drill = this.#requireDrill(request.drill, actor, executedAtMs);
    const stepId = typeof request.step === 'string' ? request.step.trim() : '';
    const declared = drill.procedure.steps.find((entry) => entry.id === stepId);
    if (declared === undefined) {
      this.#refuse(
        actor,
        new CrisisError(
          CRISIS_ERRORS.STEP_UNDECLARED,
          `الخطوة «${stepId}» غيرُ معلَنةٍ في ${drill.procedure.id}؛ وخطوةٌ تُخترع في الأزمةِ هي بعينها ما جاءت الغرفةُ لتمنعه.`,
          { drill: drill.id, step: stepId },
        ),
        { drill: drill.id, step: stepId },
      );
    }
    const expected = drill.procedure.steps[drill.index];
    if (expected === undefined || expected.id !== declared.id) {
      this.#refuse(
        actor,
        new CrisisError(
          CRISIS_ERRORS.STEP_OUT_OF_ORDER,
          `التاليةُ في ${drill.procedure.id} هي «${expected?.id ?? 'لا شيء — اكتملت الخطوات'}» لا «${declared.id}»؛ وترتيبُ الإجراءِ حمايةٌ لا تنسيق: من أوقف قبل أن يحجُر أعطى المُشتبَهَ نافذةَ التوقّف.`,
          { drill: drill.id, step: declared.id, expected: expected?.id ?? null },
        ),
        { drill: drill.id, step: declared.id },
      );
    }

    // ── القيدُ قبل الأثر ──
    log.append(this.#policy.audit.stepExecutedEvent, actor, {
      drill: drill.id,
      procedure: drill.procedure.id,
      step: declared.id,
      kind: declared.kind,
      position: drill.index + 1,
      executedAtMs,
    });

    /** @type {Record<string, unknown>} */
    let effect;
    switch (declared.kind) {
      case 'incident':
        effect = this.#recordIncident(declared, request, actor, drill);
        break;
      case 'quarantine':
        effect = await this.#quarantine(declared, request, actor, drill);
        break;
      case 'release':
        effect = await this.#release(declared, request, actor, drill);
        break;
      case 'command':
        effect = await this.#issueCommand(declared, request, actor, drill);
        break;
      case 'escalation':
        effect = this.#raiseEscalation(declared, actor, drill, executedAtMs);
        break;
      default:
        this.#refuse(
          actor,
          new CrisisError(
            CRISIS_ERRORS.STEP_UNDECLARED,
            `نوعُ الخطوة «${String(declared.kind)}» بلا أثرٍ مكتوبٍ في الكود؛ ونوعٌ يُعلَن ولا يُنفَّذ وعدٌ لا يقع.`,
            { drill: drill.id, step: declared.id },
          ),
          { drill: drill.id, step: declared.id },
        );
    }

    drill.index += 1;
    return deepFreeze({
      drill: drill.id,
      step: declared.id,
      kind: declared.kind,
      status: /** @type {'executed'} */ ('executed'),
      executedAtMs,
      effect,
      remaining: drill.procedure.steps.slice(drill.index).map((step) => step.id),
    });
  }

  /**
   * قيدُ الحادثةِ في مركزِ العملياتِ (`M9.05`) — لا سجلَّ حوادثَ ثانياً هنا، فحادثةٌ
   * في مكانين حادثةٌ تُغلَق في أحدِهما وتبقى مفتوحةً في الآخر.
   * @param {CrisisStepSpec} step
   * @param {{ incident?: Record<string, unknown> }} request
   * @param {string} actor
   * @param {CrisisDrillState} drill
   * @returns {Record<string, unknown>}
   */
  #recordIncident(step, request, actor, drill) {
    const operations = this.#operations;
    if (operations === null) {
      this.#refuse(
        actor,
        new CrisisError(
          CRISIS_ERRORS.OPERATIONS_REQUIRED,
          'مركزُ العملياتِ غيرُ موصولٍ بغرفةِ الأزمات؛ وحادثةٌ تُدار ولا تُرى في لوحةٍ إدارةٌ في الظلام.',
          { drill: drill.id, step: step.id },
        ),
        { drill: drill.id, step: step.id },
      );
    }
    const incoming = request.incident ?? {};
    /** @type {Record<string, unknown>} */
    const incident = {
      id: typeof incoming['id'] === 'string' ? incoming['id'] : `${drill.id}:${step.id}`,
      // الدرجةُ من الوثيقةِ لا من المُنادي: خطوةٌ أُعلنت `critical` لا تُقيَّد `info`
      // بتمريرِ حقلٍ في النداء، وإلا صار إعلانُ الدرجةِ زينة.
      severity: String(step.severity),
      title: typeof incoming['title'] === 'string' ? incoming['title'] : drill.procedure.title,
      source: typeof incoming['source'] === 'string' ? incoming['source'] : 'crisis:room',
      detail: {
        ...(incoming['detail'] !== null && typeof incoming['detail'] === 'object'
          ? /** @type {Record<string, unknown>} */ (incoming['detail'])
          : {}),
        drill: drill.id,
        procedure: drill.procedure.id,
        step: step.id,
      },
    };
    try {
      const recorded = operations.record(incident, { actor });
      return { incident: recorded.id, severity: recorded.severity };
    } catch (error) {
      this.#refuse(
        actor,
        new CrisisError(
          CRISIS_ERRORS.INCIDENT_REFUSED,
          `مركزُ العملياتِ رفض قيدَ الحادثةِ (${codeOf(error)}): ${errorText(error)}؛ وخطوةٌ أُعلنت منفَّذةً ومركزُ العملياتِ لا يعرف حادثتَها خطوةٌ بلا أثر.`,
          { drill: drill.id, step: step.id, cause: codeOf(error) },
          { cause: error },
        ),
        { drill: drill.id, step: step.id },
      );
    }
  }

  /**
   * الحجْر: حالةٌ في سجلِّ الهوياتِ بسببٍ يبلغ الحدَّ المُعلَن — فيُرَدُّ المحجورُ
   * من طبقةِ الواجهةِ نفسِها عند أوّلِ نداءٍ بعده.
   * @param {CrisisStepSpec} step
   * @param {{ target?: unknown, reason?: unknown }} request
   * @param {string} actor
   * @param {CrisisDrillState} drill
   * @returns {Promise<Record<string, unknown>>}
   */
  async #quarantine(step, request, actor, drill) {
    const agents = this.#requireRegistry(step, actor, drill);
    const scope = String(step.scope);
    if (!this.#policy.quarantine.scopes.includes(scope)) {
      this.#refuse(
        actor,
        new CrisisError(
          CRISIS_ERRORS.QUARANTINE_SCOPE_UNDECLARED,
          `نطاقُ الحجْر «${scope}» غيرُ معلَنٍ في الوثيقة؛ ونطاقٌ يُخترع في زمنِ التشغيلِ يُوسِّع العقوبةَ بلا قرار.`,
          { drill: drill.id, step: step.id, scope },
        ),
        { drill: drill.id, step: step.id },
      );
    }
    const target = typeof request.target === 'string' ? request.target.trim() : '';
    const reason = typeof request.reason === 'string' ? request.reason.trim() : '';
    if (target === '') {
      this.#refuse(
        actor,
        new CrisisError(
          CRISIS_ERRORS.QUARANTINE_REFUSED,
          'الحجْرُ بلا هدفٍ مُسمّى؛ وعزلٌ لا يُعرَف من وقع عليه عزلٌ لا يُراجَع ولا يُرفَع.',
          { drill: drill.id, step: step.id },
        ),
        { drill: drill.id, step: step.id },
      );
    }
    if (reason.length < this.#policy.quarantine.reasonMinLength) {
      this.#refuse(
        actor,
        new CrisisError(
          CRISIS_ERRORS.QUARANTINE_REASON_REQUIRED,
          `سببُ الحجْرِ ${reason.length} حرفاً والحدُّ المُعلَنُ ${this.#policy.quarantine.reasonMinLength}؛ وسببٌ لا يُقرأ بعد شهرٍ يجعل مراجعةَ العقوبةِ صورية.`,
          { drill: drill.id, step: step.id, target, length: reason.length },
        ),
        { drill: drill.id, step: step.id },
      );
    }
    if (drill.quarantined.size >= this.#policy.quarantine.maxActive) {
      this.#refuse(
        actor,
        new CrisisError(
          CRISIS_ERRORS.QUARANTINE_REFUSED,
          `المحجورونَ في هذا التمرينِ بلغوا الحدَّ المُعلَن (${this.#policy.quarantine.maxActive})؛ وحجْرٌ بلا سقفٍ يصير إيقافاً شاملاً بلا أمرٍ موقَّع.`,
          { drill: drill.id, step: step.id, active: drill.quarantined.size },
        ),
        { drill: drill.id, step: step.id },
      );
    }
    try {
      await agents.transition(
        target,
        // الحالةُ قيمةٌ من الوثيقةِ، والحاجزُ (R7) يقابلها بـ`AgentState` نصّاً فلا
        // تُعلَن حالةٌ لا وجودَ لها في سجلِّ الهويات؛ فالتحويلُ هنا مقيسٌ لا مُدَّعى.
        /** @type {import('../identity/agent-registry.mjs').AgentStateValue} */ (
          this.#policy.quarantine.state
        ),
        reason,
      );
    } catch (error) {
      this.#refuse(
        actor,
        new CrisisError(
          CRISIS_ERRORS.QUARANTINE_REFUSED,
          `سجلُّ الهوياتِ رفض الحجْر (${codeOf(error)}): ${errorText(error)}؛ وحجْرٌ يُعلَن ولا تُكتب حالتُه في السجلِّ حجْرٌ لا يمنع نداءً واحداً.`,
          { drill: drill.id, step: step.id, target, cause: codeOf(error) },
          { cause: error },
        ),
        { drill: drill.id, step: step.id },
      );
    }
    drill.quarantined.add(target);
    return { target, state: this.#policy.quarantine.state, scope };
  }

  /**
   * رفعُ الحجْر: لا يقع إلا على من حُجِر في هذا التمرينِ، وبعد إقرارٍ بشريٍّ إن
   * اشترطته الوثيقة — فمن حجَر لا يُعيد وحدَه.
   * @param {CrisisStepSpec} step
   * @param {{ target?: unknown, reason?: unknown }} request
   * @param {string} actor
   * @param {CrisisDrillState} drill
   * @returns {Promise<Record<string, unknown>>}
   */
  async #release(step, request, actor, drill) {
    const agents = this.#requireRegistry(step, actor, drill);
    const target = typeof request.target === 'string' ? request.target.trim() : '';
    if (!drill.quarantined.has(target)) {
      this.#refuse(
        actor,
        new CrisisError(
          CRISIS_ERRORS.QUARANTINE_REFUSED,
          `«${target}» لم يُحجَر في التمرين ${drill.id}؛ ورفعُ حجْرٍ لم يقع تغييرُ حالةِ هويةٍ بحجّةِ إجراءٍ لم يمسّها.`,
          { drill: drill.id, step: step.id, target },
        ),
        { drill: drill.id, step: step.id },
      );
    }
    if (this.#policy.quarantine.releaseRequiresAcknowledgedEscalation) {
      const acknowledged = [...drill.escalations.values()].some(
        (entry) => entry.acknowledgedBy !== null,
      );
      if (!acknowledged) {
        this.#refuse(
          actor,
          new CrisisError(
            CRISIS_ERRORS.ESCALATION_PENDING,
            `رفعُ الحجْرِ يشترط إقراراً بشريّاً على تصعيدٍ قائمٍ في التمرين ${drill.id}، ولا إقرارَ بعد؛ ومن حجَر ثم رفع وحدَه أدار الأزمةَ بلا شاهد.`,
            { drill: drill.id, step: step.id, target },
          ),
          { drill: drill.id, step: step.id },
        );
      }
    }
    try {
      await agents.transition(
        target,
        /** @type {import('../identity/agent-registry.mjs').AgentStateValue} */ (
          this.#policy.quarantine.releaseState
        ),
      );
    } catch (error) {
      this.#refuse(
        actor,
        new CrisisError(
          CRISIS_ERRORS.QUARANTINE_REFUSED,
          `سجلُّ الهوياتِ رفض رفعَ الحجْر (${codeOf(error)}): ${errorText(error)}.`,
          { drill: drill.id, step: step.id, target, cause: codeOf(error) },
          { cause: error },
        ),
        { drill: drill.id, step: step.id },
      );
    }
    drill.quarantined.delete(target);
    return { target, state: this.#policy.quarantine.releaseState };
  }

  /**
   * @param {CrisisStepSpec} step
   * @param {string} actor
   * @param {CrisisDrillState} drill
   * @returns {CrisisRegistryLike}
   */
  #requireRegistry(step, actor, drill) {
    const agents = this.#agents;
    if (agents === null) {
      this.#refuse(
        actor,
        new CrisisError(
          CRISIS_ERRORS.REGISTRY_REQUIRED,
          'سجلُّ الهوياتِ غيرُ موصولٍ بغرفةِ الأزمات؛ وحجْرٌ لا يُكتب في السجلِّ علمٌ في ذاكرةِ عمليةٍ لا يمنع نداءً.',
          { drill: drill.id, step: step.id },
        ),
        { drill: drill.id, step: step.id },
      );
    }
    return agents;
  }

  /**
   * الأمرُ السياديُّ من الديوانِ وحدَه: الغرفةُ تُمرِّر الأمرَ الموقَّعَ والجلسةَ
   * القويةَ كما جاءا من المُنادي، ولا توقّع ولا تلمس محرّكاً تحت الديوان.
   * @param {CrisisStepSpec} step
   * @param {{ royalCommand?: Record<string, unknown>, signature?: string, sovereignSession?: string }} request
   * @param {string} actor
   * @param {CrisisDrillState} drill
   * @returns {Promise<Record<string, unknown>>}
   */
  async #issueCommand(step, request, actor, drill) {
    const royalConsole = this.#console;
    if (royalConsole === null) {
      this.#refuse(
        actor,
        new CrisisError(
          CRISIS_ERRORS.CONSOLE_REQUIRED,
          'الديوانُ الملكيُّ غيرُ موصولٍ بغرفةِ الأزمات؛ ولا أثرَ سياديٌّ من هذه الغرفةِ بغيرِ أمرٍ موقَّعٍ يمرّ به — وطريقٌ حولَه طريقٌ حولَ التوقيعِ والتاجِ والجلسةِ القوية.',
          { drill: drill.id, step: step.id, command: String(step.command) },
        ),
        { drill: drill.id, step: step.id },
      );
    }
    const royal = request.royalCommand;
    if (royal === null || typeof royal !== 'object') {
      this.#refuse(
        actor,
        new CrisisError(
          CRISIS_ERRORS.COMMAND_REFUSED,
          `الخطوة ${step.id} أمرٌ ملكيٌّ ولم يُقدَّم أمرٌ موقَّعٌ معها؛ والغرفةُ لا توقّع بالنيابةِ عن الملك.`,
          { drill: drill.id, step: step.id, command: String(step.command) },
        ),
        { drill: drill.id, step: step.id },
      );
    }
    /** @type {{ command: string, royalCommand: Record<string, unknown>, signature: string, sovereignSession?: string }} */
    const issue = {
      command: String(step.command),
      royalCommand: royal,
      signature: typeof request.signature === 'string' ? request.signature : '',
    };
    if (typeof request.sovereignSession === 'string')
      issue.sovereignSession = request.sovereignSession;
    try {
      const result = await royalConsole.issue(issue);
      return {
        command: result.command,
        commandId: result.commandId,
        path: result.path,
        status: result.status,
        effect: result.effect,
      };
    } catch (error) {
      this.#refuse(
        actor,
        new CrisisError(
          CRISIS_ERRORS.COMMAND_REFUSED,
          `الديوانُ رفض الأمر «${String(step.command)}» (${codeOf(error)}): ${errorText(error)}؛ ورفضُ الديوانِ يُنقل كما هو ولا يُبتلَع في الغرفة.`,
          { drill: drill.id, step: step.id, command: String(step.command), cause: codeOf(error) },
          { cause: error },
        ),
        { drill: drill.id, step: step.id },
      );
    }
  }

  /**
   * رفعُ تصعيدٍ إلى جهةٍ معلَنة — ومن رفعه مسجَّلٌ كي لا يُقرّه بنفسه.
   * @param {CrisisStepSpec} step
   * @param {string} actor
   * @param {CrisisDrillState} drill
   * @param {number} atMs
   * @returns {Record<string, unknown>}
   */
  #raiseEscalation(step, actor, drill, atMs) {
    const contactId = String(step.contact);
    const contact = this.#contacts.get(contactId);
    if (contact === undefined) {
      this.#refuse(
        actor,
        new CrisisError(
          CRISIS_ERRORS.ESCALATION_CONTACT_UNKNOWN,
          `جهةُ التصعيد «${contactId}» غيرُ معلَنةٍ في الوثيقة؛ وتصعيدٌ إلى جهةٍ لا وجودَ لها تصعيدٌ يقع في الفراغ ويُقرأ إنجازاً.`,
          { drill: drill.id, step: step.id, contact: contactId },
        ),
        { drill: drill.id, step: step.id },
      );
    }
    const id = `escalation:${drill.id}:${step.id}`;
    this.#requireLog().append(this.#policy.audit.escalationRaisedEvent, actor, {
      drill: drill.id,
      step: step.id,
      escalation: id,
      contact: contact.id,
      role: contact.role,
      channel: contact.channel,
      raisedAtMs: atMs,
      deadlineMs: this.#policy.escalation.acknowledgmentDeadlineMs,
    });
    drill.escalations.set(id, {
      id,
      contact: contact.id,
      raisedBy: actor,
      raisedAtMs: atMs,
      acknowledgedBy: null,
      acknowledgedAtMs: null,
    });
    return {
      escalation: id,
      contact: contact.id,
      role: contact.role,
      channel: contact.channel,
      deadlineMs: this.#policy.escalation.acknowledgmentDeadlineMs,
    };
  }

  /**
   * إقرارُ التصعيدِ من بشريٍّ غيرِ رافعِه وداخلَ المهلةِ المُعلَنةِ مقيسةً على
   * الساعةِ المُمرَّرة.
   * @param {{ drill?: unknown, escalation?: unknown, actor?: string }} request
   * @returns {{ drill: string, escalation: string, acknowledgedBy: string, acknowledgedAtMs: number, elapsedMs: number }}
   */
  acknowledge(request = {}) {
    const actor = typeof request.actor === 'string' && request.actor !== '' ? request.actor : '';
    this.#requireLog();
    const atMs = this.#clock('إقرارِ تصعيد');
    const drill = this.#requireDrill(request.drill, actor === '' ? 'crisis:room' : actor, atMs);
    const escalationId = typeof request.escalation === 'string' ? request.escalation.trim() : '';
    const escalation = escalationId === '' ? undefined : drill.escalations.get(escalationId);
    if (escalation === undefined) {
      this.#refuse(
        actor === '' ? 'crisis:room' : actor,
        new CrisisError(
          CRISIS_ERRORS.ESCALATION_CONTACT_UNKNOWN,
          `لا تصعيدَ بالمعرّف «${escalationId}» في التمرين ${drill.id}؛ وإقرارٌ على تصعيدٍ لم يُرفع إقرارٌ على لا شيء.`,
          { drill: drill.id, escalation: escalationId },
        ),
        { drill: drill.id, escalation: escalationId },
      );
    }
    if (actor === '' || !this.#contacts.has(actor)) {
      this.#refuse(
        actor === '' ? 'crisis:room' : actor,
        new CrisisError(
          CRISIS_ERRORS.ESCALATION_CONTACT_UNKNOWN,
          `المُقِرُّ «${actor}» ليس جهةً معلَنةً في الوثيقة؛ وإقرارٌ من غيرِ جهةٍ معلَنةٍ إقرارٌ لا يُعرَف صاحبُه فلا يُحاسَب.`,
          { drill: drill.id, escalation: escalation.id, actor },
        ),
        { drill: drill.id, escalation: escalation.id },
      );
    }
    if (this.#policy.escalation.selfAcknowledgeForbidden && actor === escalation.raisedBy) {
      this.#refuse(
        actor,
        new CrisisError(
          CRISIS_ERRORS.ESCALATION_SELF_ACK,
          `من رفع التصعيدَ لا يُقرّه: «${actor}» رفعه وأقرَّه؛ وتصعيدٌ بشريٌّ يُقرّه رافعُه توقيعٌ على مرآةٍ لا رقابةٌ من بشر.`,
          { drill: drill.id, escalation: escalation.id, actor },
        ),
        { drill: drill.id, escalation: escalation.id },
      );
    }
    const elapsedMs = atMs - escalation.raisedAtMs;
    if (elapsedMs > this.#policy.escalation.acknowledgmentDeadlineMs) {
      this.#refuse(
        actor,
        new CrisisError(
          CRISIS_ERRORS.ESCALATION_DEADLINE_MISSED,
          `الإقرارُ جاء بعد ${elapsedMs}ms والمهلةُ المُعلَنةُ ${this.#policy.escalation.acknowledgmentDeadlineMs}ms؛ وإقرارٌ يُقبل بعد المهلةِ يجعل المهلةَ رقماً في وثيقةٍ لا شرطاً في نظام.`,
          { drill: drill.id, escalation: escalation.id, elapsedMs },
        ),
        { drill: drill.id, escalation: escalation.id },
      );
    }
    this.#requireLog().append(this.#policy.audit.escalationAcknowledgedEvent, actor, {
      drill: drill.id,
      escalation: escalation.id,
      contact: escalation.contact,
      raisedBy: escalation.raisedBy,
      acknowledgedAtMs: atMs,
      elapsedMs,
    });
    escalation.acknowledgedBy = actor;
    escalation.acknowledgedAtMs = atMs;
    return deepFreeze({
      drill: drill.id,
      escalation: escalation.id,
      acknowledgedBy: actor,
      acknowledgedAtMs: atMs,
      elapsedMs,
    });
  }

  /**
   * إغلاقُ التمرين — وهو موضعُ معيارِ القبول: لا يُغلَق إلا وقد نُفِّذت كلُّ خطوةٍ
   * معلَنةٍ، وأُقرّ كلُّ تصعيدٍ رُفع، وشهد **ملفُّ السجلِّ المقروءُ من القرصِ**
   * بقيدِ تنفيذٍ لكلِّ خطوةٍ باسمِها. فشهادةُ الذاكرةِ عن نفسِها ليست دليلاً.
   * @param {{ drill?: unknown, actor?: string }} request
   * @returns {{ drill: string, procedure: string, steps: readonly string[], escalations: ReadonlyArray<{ id: string, contact: string, acknowledgedBy: string }>, closedAtMs: number, durationMs: number, evidence: 'on-disk-log' }}
   */
  closeDrill(request = {}) {
    const actor =
      typeof request.actor === 'string' && request.actor !== '' ? request.actor : 'crisis:room';
    const log = this.#requireLog();
    const closedAtMs = this.#clock('إغلاقِ تمرين');
    const drill = this.#requireDrill(request.drill, actor, closedAtMs);

    const pending = [...drill.escalations.values()].filter(
      (entry) => entry.acknowledgedBy === null,
    );
    if (pending.length > 0) {
      this.#refuse(
        actor,
        new CrisisError(
          CRISIS_ERRORS.ESCALATION_PENDING,
          `التمرين ${drill.id} فيه ${pending.length} تصعيداً بلا إقرارٍ بشريّ؛ وتمرينٌ يُغلَق «ناجحاً» وأحدُ تصعيداتِه معلَّقٌ يُعلِّم أن التصعيدَ خطوةٌ شكلية.`,
          { drill: drill.id, pending: pending.map((entry) => entry.id) },
        ),
        { drill: drill.id },
      );
    }

    const evidence = this.#evidence;
    if (evidence === null) {
      this.#refuse(
        actor,
        new CrisisError(
          CRISIS_ERRORS.EVIDENCE_MISSING,
          'قارئُ الدليلِ غيرُ موصولٍ بالغرفة؛ وإغلاقُ تمرينٍ على شهادةِ ذاكرتِه عن نفسِها هو بعينه ما جاء معيارُ «تمرينٍ موثَّق» ليمنعه.',
          { drill: drill.id },
        ),
        { drill: drill.id },
      );
    }
    /** @type {ReadonlyArray<{ type: string, actor: string, data: Record<string, unknown> }>} */
    let entries;
    try {
      entries = evidence();
    } catch (error) {
      this.#refuse(
        actor,
        new CrisisError(
          CRISIS_ERRORS.EVIDENCE_MISSING,
          `تعذّرت قراءةُ دليلِ التمرينِ من السجلِّ الدائم: ${errorText(error)}.`,
          { drill: drill.id },
          { cause: error },
        ),
        { drill: drill.id },
      );
    }
    const witnessed = new Set(
      entries
        .filter(
          (entry) =>
            entry.type === this.#policy.audit.stepExecutedEvent && entry.data['drill'] === drill.id,
        )
        .map((entry) => String(entry.data['step'])),
    );
    const missing = drill.procedure.steps
      .map((step) => step.id)
      .filter((step) => !witnessed.has(step));
    if (this.#policy.drill.requireAllSteps && missing.length > 0) {
      this.#refuse(
        actor,
        new CrisisError(
          CRISIS_ERRORS.EVIDENCE_MISSING,
          `خطواتٌ معلَنةٌ في ${drill.procedure.id} لا يشهد بها السجلُّ الدائم: ${missing.join(' · ')}؛ وتمرينٌ يُغلَق ولا دليلَ على خطوةٍ منه تمرينٌ غيرُ موثَّق.`,
          { drill: drill.id, missing },
        ),
        { drill: drill.id },
      );
    }

    const durationMs = closedAtMs - drill.openedAtMs;
    log.append(this.#policy.audit.drillClosedEvent, actor, {
      drill: drill.id,
      procedure: drill.procedure.id,
      steps: drill.procedure.steps.map((step) => step.id),
      escalations: [...drill.escalations.values()].map((entry) => ({
        id: entry.id,
        contact: entry.contact,
        raisedBy: entry.raisedBy,
        acknowledgedBy: entry.acknowledgedBy,
      })),
      closedAtMs,
      durationMs,
      evidence: this.#policy.drill.evidence,
    });
    this.#drills.delete(drill.id);
    return deepFreeze({
      drill: drill.id,
      procedure: drill.procedure.id,
      steps: drill.procedure.steps.map((step) => step.id),
      escalations: [...drill.escalations.values()].map((entry) => ({
        id: entry.id,
        contact: entry.contact,
        acknowledgedBy: String(entry.acknowledgedBy),
      })),
      closedAtMs,
      durationMs,
      evidence: /** @type {'on-disk-log'} */ (this.#policy.drill.evidence),
    });
  }
}
