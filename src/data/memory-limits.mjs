/**
 * حدود ذاكرة الوكلاء وعزلها — M7.05.
 *
 * **العيوب التي تُغلقها هذه الوحدة، بنصّها كما كانت:**
 *
 *  1. **حصّةٌ عالمية لا لكل وكيل.** كان `AgentMemoryStore.remember` يقيس
 *     `repository.count()` — بلا مرشِّح — على `maxEntries` واحدٍ للمخزن كله.
 *     فوكيلٌ واحد يكتب حتى السقف يمنع **كل** الوكلاء من التذكّر. وهذا عبورٌ
 *     لحدّ الوكيل بالحجب، ولا يحتاج قراءةَ حرفٍ من ذاكرة غيره. ولا كان هناك
 *     حدٌّ لحجم المدخل الواحد: مدخلٌ بحجم ميغابايتات يمرّ لأن العدد واحد.
 *  2. **انتهاءٌ معلَنٌ لا يُكتب.** العمود `state.memories.expires_at` قائمٌ
 *     منذ الترحيل الأول، و`RETENTION_POLICIES.memories.endsBy = 'expires_at'`،
 *     و`remember` **لم يكتبه ولا مرّة**. فكل ذاكرةٍ أبدية، ودورةُ المحو تمرّ
 *     على صفر صفوف ثم تُعلن نجاحها — وهو أسوأ من غياب المحو: غيابٌ يُظنّ حضوراً.
 *  3. **ملكيةٌ تُمرَّر وسيطاً.** `remember(agentId, …)` كان يكتب باسم أي وكيل
 *     يذكره المنادي، و`forget(agentId, id)` يحذف ذاكرة أي وكيلٍ يُعرَف معرّفه
 *     — بلا فاعل، بلا بوابة، بلا قيد نسب. فالعزل كان يقوم على أدب المنادي،
 *     وهو بعينه نمطُ «الادّعاء في الطلب» المُغلَق في M7.01 وM7.02 وM7.04.
 *  4. **لا مسار تصفّحٍ محكوم.** لم يكن في المخزن `list`، ومستودع الذاكرة يقبل
 *     `agentId` مرشِّحاً، فمن أراد ذاكرة غيره لم يكن يحتاج ثغرة بل مساراً
 *     أقصر: المستودع مباشرةً.
 *
 * وهذه الوحدة **لا تنفّذ** المخزن؛ هي السياسة المُعلَنة بياناً وحسابُها: الحصص،
 * ومدد الانتهاء، وقواعد العزل، وعدّادُ محاولات العبور. والفرضُ في
 * `memory-store.mjs`، والفحصُ على النصّ في `scripts/guard-memory.mjs`.
 *
 * **حدٌّ معلَن:** حصّة البايتات تُقاس على **بايتات المخزون** — أي حجم الغلاف
 * المشفَّر كما يُخزَّن — لا على المادة المفكوكة. والسبب أن المخزون هو المستهلك
 * فعلاً، وأنه القيمة الوحيدة التي تستطيع القاعدة قياسها بنفسها
 * (`pg_column_size`) فلا يصير الحدُّ رقماً يعرفه الكود وحده.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';
import Ajv2020Default from 'ajv/dist/2020.js';

const Ajv2020 = /** @type {typeof import('ajv/dist/2020.js').Ajv2020} */ (
  /** @type {unknown} */ (Ajv2020Default)
);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** مجلد الإعدادات الافتراضي. */
export const DEFAULT_MEMORY_CONFIG_DIR = path.join(ROOT, 'config');

/** أنواع الذاكرة المعلَنة في مواصفة السجل؛ تُعاد هنا لربط المدد بها. */
export const MEMORY_KINDS = Object.freeze(['episodic', 'semantic', 'procedural']);

export const MEMORY_LIMIT_ERRORS = Object.freeze({
  CONFIG_INVALID: 'MEMORY_CONFIG_INVALID',
  INPUT_INVALID: 'MEMORY_INPUT_INVALID',
  ENTRY_TOO_LARGE: 'MEMORY_ENTRY_TOO_LARGE',
  AGENT_QUOTA_EXCEEDED: 'MEMORY_AGENT_QUOTA_EXCEEDED',
  AGENT_BYTES_EXCEEDED: 'MEMORY_AGENT_BYTES_EXCEEDED',
  QUOTA_EXCEEDED: 'MEMORY_QUOTA_EXCEEDED',
  OWNER_CLAIM_REFUSED: 'MEMORY_OWNER_CLAIM_REFUSED',
  ISOLATION_REFUSED: 'MEMORY_ISOLATION_REFUSED',
  EXPIRED: 'MEMORY_EXPIRED',
  SWEEP_REFUSED: 'MEMORY_SWEEP_REFUSED',
  // `LIM-3`: رمزانِ للتطهيرِ المحكومِ. الأوّلُ للتركيبِ الناقصِ (‏نقطةُ تفويضٍ
  // غائبةٌ أو بلا بوابةِ هويةٍ)، والثاني لقرارٍ رفضَ. وتركُهما بلا اسمَينِ يجعلُ
  // كلَّ رفضٍ يُقرأُ «رفضَ الدورُ» وهو ليس السببَ.
  PURGE_AUTHORIZER_REQUIRED: 'MEMORY_PURGE_AUTHORIZER_REQUIRED',
  PURGE_NOT_AUTHORIZED: 'MEMORY_PURGE_NOT_AUTHORIZED',
});

/** خطأ حدٍّ مُسمّى: الرمز للأتمتة والنص لمن يقرأ الرفض. */
export class MemoryLimitError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   * @param {Record<string, unknown>} [detail]
   */
  constructor(code, message, detail = {}) {
    super(`${code}: ${message}`);
    this.name = 'MemoryLimitError';
    this.code = code;
    this.detail = Object.freeze({ ...detail });
  }
}

/**
 * @typedef {object} MemoryQuotaSpec
 * @property {number} perAgentEntries
 * @property {number} perAgentStoredBytes
 * @property {number} maxEntryBytes
 * @property {number} globalEntries
 */

/**
 * @typedef {object} MemoryExpirySpec
 * @property {true} required
 * @property {Record<string, number>} defaultDays
 * @property {number} maxDays
 * @property {true} refuseRecallAfterExpiry
 * @property {string[]} sweeperRoles
 */

/**
 * @typedef {object} MemoryIsolationSpec
 * @property {true} ownerFromActor
 * @property {string} ownerRole
 * @property {true} crossAgentNeedsGate
 * @property {true} refuseSharedNamespace
 */

/**
 * @typedef {object} MemoryPolicyShape
 * @property {number} version
 * @property {string} owner
 * @property {MemoryQuotaSpec} quotas
 * @property {MemoryExpirySpec} expiry
 * @property {MemoryIsolationSpec} isolation
 * @property {{ crossAgentAttemptsBeforeSignal: number, signalKind: string }} anomaly
 * @property {{ table: string, dbConstraints: string[] }} store
 * @property {Array<{ module: string, methods: string[] }>} guardedPaths
 * @property {string[]} repositoryHolders
 */

/** سياسة ذاكرةٍ محمَّلة ومُتحقَّقة. */
export class MemoryPolicy {
  /** @param {MemoryPolicyShape} shape */
  constructor(shape) {
    this.version = shape.version;
    this.owner = shape.owner;
    this.quotas = Object.freeze({ ...shape.quotas });
    this.expiry = Object.freeze({
      ...shape.expiry,
      defaultDays: Object.freeze({ ...shape.expiry.defaultDays }),
      sweeperRoles: Object.freeze([...shape.expiry.sweeperRoles]),
    });
    this.isolation = Object.freeze({ ...shape.isolation });
    this.anomaly = Object.freeze({ ...shape.anomaly });
    this.store = Object.freeze({
      table: shape.store.table,
      dbConstraints: Object.freeze([...shape.store.dbConstraints]),
    });
    this.guardedPaths = Object.freeze(
      shape.guardedPaths.map((entry) =>
        Object.freeze({ module: entry.module, methods: Object.freeze([...entry.methods]) }),
      ),
    );
    this.repositoryHolders = Object.freeze([...shape.repositoryHolders]);
    Object.freeze(this);
  }

  /**
   * مدّة الاحتفاظ لنوعٍ من الذاكرة. نوعٌ لا مدّة له **يُرفض** ولا يأخذ مدّةً
   * افتراضية: مدّةٌ مخترعة لنوعٍ غير معلَن هي أبديّةٌ بمسمّى آخر.
   * @param {string} kind
   * @returns {number}
   */
  daysFor(kind) {
    const days = this.expiry.defaultDays[kind];
    if (typeof days !== 'number') {
      throw new MemoryLimitError(
        MEMORY_LIMIT_ERRORS.CONFIG_INVALID,
        `نوع الذاكرة «${kind}» لا مدّة انتهاءٍ معلَنة له؛ ولا تُخترع له مدّة، فمدّةٌ مخترعة تجعل الاحتفاظ رقماً يقوله الكود لا السياسة.`,
        { kind },
      );
    }
    return days;
  }

  /**
   * تاريخ انتهاء مدخلٍ يُنشأ الآن. القيمة تُحسب من السياسة لا من الطلب: تاريخُ
   * انتهاءٍ يُمرَّره من يكتب هو تمديدٌ بلا حدّ بيد المستفيد منه.
   * @param {{ kind: string, now?: Date }} input
   * @returns {Date}
   */
  expiresAt({ kind, now = new Date() }) {
    const days = Math.min(this.daysFor(kind), this.expiry.maxDays);
    return new Date(now.getTime() + days * 86400000);
  }

  /**
   * هل الدور دورُ الوكيل المحصور في ذاكرته؟
   * @param {string} role
   * @returns {boolean}
   */
  isOwnerRole(role) {
    return role === this.isolation.ownerRole;
  }

  /**
   * هل يجوز لهذا الدور تشغيل المطهِّر؟ وكيلٌ يطهّر يمحو أثره بنفسه.
   *
   * **حدٌّ مُعلَنٌ في موضعِ القراءةِ (‏`LIM-3`، `WL-190`):** هذه الدالّةُ تقيسُ
   * **أهليّةً لا سلطةً**. صدقُها يعني «يجوزُ لهذا الدورِ أن يُشغِّلَ أداةَ
   * المحوِ»، **ولا يعني** أنّ المحوَ يقعُ بقرارِه: الفعلُ `purge-data` مُعلَنٌ
   * فوقَ العتبةِ السياديّةِ في `config/royal-authority.yaml` (‏`delegable: false`)
   * فلا يبلغُها `role:operator` ولا غيرُه بدورِه، ويلزمُ أمرٌ ملكيٌّ لكلِّ محوٍ —
   * ويُفرَضُ ذلك في `assertRoyalCommandForPurge` (‏`./purge-authority.mjs`).
   * فمن جعلَ صدقَ هذه الدالّةِ إذناً بالحذفِ أعادَ العيبَ الذي أُغلق.
   * @param {string} role
   * @returns {boolean}
   */
  isSweeper(role) {
    return this.expiry.sweeperRoles.includes(role);
  }
}

/**
 * بايتات المخزون لغلافٍ كما يُخزَّن. تُقاس على تمثيله النصّي: هو ما يُكتب في
 * عمود `jsonb` وما يُنقل في الشبكة، وقياسٌ على شيءٍ آخر يجعل الحدّ تقديراً.
 * @param {unknown} value
 * @returns {number}
 */
export function storedBytesOf(value) {
  if (value === undefined) return 0;
  return Buffer.byteLength(JSON.stringify(value) ?? 'null', 'utf8');
}

/**
 * عدّاد محاولات العبور بين الوكلاء. محاولةٌ واحدة قد تكون معرّفاً خاطئاً؛
 * وتكرارُها من نفس الفاعل قصدٌ يُبلَّغ عنه.
 *
 * **حدٌّ معلَن:** العدّاد في الذاكرة الحيّة لا في القاعدة، فيُصفَّر بإعادة
 * التشغيل. أي أن الإشارة تُرفع للنمط داخل عمرِ العملية، ورفعُها عبر إعادات
 * التشغيل يقتضي عدّاداً دائماً وهو عملُ M7.06 مع الاحتفاظ.
 */
export class MemoryIsolationMonitor {
  /** @param {{ threshold?: number }} [options] */
  constructor({ threshold = 3 } = {}) {
    if (!Number.isInteger(threshold) || threshold < 1) {
      throw new MemoryLimitError(
        MEMORY_LIMIT_ERRORS.INPUT_INVALID,
        'عتبة محاولات العبور يجب أن تكون عدداً صحيحاً موجباً؛ عتبةٌ صفرية تُغرق المراقبة بإشارةٍ لكل معرّفٍ خاطئ.',
        { threshold },
      );
    }
    this.threshold = threshold;
    /** @type {Map<string, number>} */
    this.attempts = new Map();
  }

  /**
   * يسجّل محاولةً ويقول: هل بلغت العتبة؟
   * @param {string} actorId
   * @returns {{ count: number, reached: boolean }}
   */
  attempt(actorId) {
    const count = (this.attempts.get(actorId) ?? 0) + 1;
    this.attempts.set(actorId, count);
    return { count, reached: count >= this.threshold };
  }
}

/**
 * @param {string} dir
 * @returns {unknown}
 */
function readMemoryConfig(dir) {
  const file = path.join(dir, 'memory.yaml');
  if (!fs.existsSync(file)) {
    throw new MemoryLimitError(
      MEMORY_LIMIT_ERRORS.CONFIG_INVALID,
      `سياسة الذاكرة مفقودة: ${file}. ومخزنٌ بلا سياسةٍ معلَنة يعود إلى أرقامٍ في الكود، وهو ما أُخرج منه.`,
    );
  }
  return YAML.parse(fs.readFileSync(file, 'utf8'));
}

/**
 * يحمّل سياسة الذاكرة ويتحقّق منها ضدّ مخطَّطها، ثم يفحص تماسكها.
 * @param {{ dir?: string }} [options]
 * @returns {MemoryPolicy}
 */
export function loadMemoryPolicy({ dir = DEFAULT_MEMORY_CONFIG_DIR } = {}) {
  const raw = readMemoryConfig(dir);
  const schemaFile = path.join(dir, 'schemas', 'memory.schema.json');
  if (!fs.existsSync(schemaFile)) {
    throw new MemoryLimitError(
      MEMORY_LIMIT_ERRORS.CONFIG_INVALID,
      `مخطَّط سياسة الذاكرة مفقود: ${schemaFile}.`,
    );
  }
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  const validate = ajv.compile(JSON.parse(fs.readFileSync(schemaFile, 'utf8')));
  if (!validate(raw)) {
    const detail = (validate.errors ?? [])
      .map((error) => `${error.instancePath || '/'} ${error.message ?? ''}`.trim())
      .join('؛ ');
    throw new MemoryLimitError(
      MEMORY_LIMIT_ERRORS.CONFIG_INVALID,
      `سياسة الذاكرة لا تطابق مخططها: ${detail}`,
    );
  }
  const parsed = /** @type {MemoryPolicyShape} */ (raw);
  for (const kind of MEMORY_KINDS) {
    if (typeof parsed.expiry.defaultDays[kind] !== 'number') {
      throw new MemoryLimitError(
        MEMORY_LIMIT_ERRORS.CONFIG_INVALID,
        `النوع «${kind}» معلَن في مواصفة السجل ولا مدّة انتهاءٍ له في السياسة؛ فذاكرةٌ من هذا النوع كانت ستُرفض عند الكتابة أو تبقى أبدية.`,
        { kind },
      );
    }
  }
  for (const [kind, days] of Object.entries(parsed.expiry.defaultDays)) {
    if (days > parsed.expiry.maxDays) {
      throw new MemoryLimitError(
        MEMORY_LIMIT_ERRORS.CONFIG_INVALID,
        `مدّة النوع «${kind}» (${days} يوماً) تتجاوز السقف المعلَن (${parsed.expiry.maxDays})؛ سياسةٌ تتجاوز سقفَ نفسها تجعل السقف زينة.`,
        { kind, days },
      );
    }
  }
  if (parsed.quotas.maxEntryBytes > parsed.quotas.perAgentStoredBytes) {
    throw new MemoryLimitError(
      MEMORY_LIMIT_ERRORS.CONFIG_INVALID,
      'حدّ المدخل الواحد أكبر من حصّة الوكيل كلها؛ فمدخلٌ واحد مقبولٌ يتجاوز الحصّة، ويصير أحد الحدّين كذباً.',
    );
  }
  if (parsed.quotas.perAgentEntries > parsed.quotas.globalEntries) {
    throw new MemoryLimitError(
      MEMORY_LIMIT_ERRORS.CONFIG_INVALID,
      'حصّة الوكيل الواحد أكبر من السقف العالمي؛ فحصّةُ الوكيل لا تُبلغ أبداً ويعود الحجب عالمياً كما كان.',
    );
  }
  if (parsed.expiry.sweeperRoles.includes(parsed.isolation.ownerRole)) {
    throw new MemoryLimitError(
      MEMORY_LIMIT_ERRORS.CONFIG_INVALID,
      `دور المالك «${parsed.isolation.ownerRole}» معلَنٌ في أدوار المطهِّر؛ ووكيلٌ يطهّر يمحو أثره بنفسه فيسقط معنى الاحتفاظ.`,
    );
  }
  // الجذر يُشتقّ من مجلد الإعدادات المُمرَّر لا من موضع هذه الوحدة: حاجزٌ يفحص
  // شجرةً منسوخة كان سيقيس أسماء الملفات على شجرته هو فيصير نصفُ فحصه أعمى —
  // وهو خطأٌ وقع فعلاً في حاجز M7.04 قبل تصحيحه.
  const treeRoot = path.resolve(dir, '..');
  for (const holder of parsed.repositoryHolders) {
    if (!fs.existsSync(path.join(treeRoot, holder))) {
      throw new MemoryLimitError(
        MEMORY_LIMIT_ERRORS.CONFIG_INVALID,
        `الوحدة المصرَّح لها بلمس المستودع «${holder}» غير موجودة؛ وقائمةٌ فيها أسماءُ ملفاتٍ زائلة تُصبح إذناً مفتوحاً بعد أول نقلٍ للملف.`,
        { holder },
      );
    }
  }
  return new MemoryPolicy(parsed);
}
