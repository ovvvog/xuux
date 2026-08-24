/**
 * سلّم التصنيف وقواعد الاتجاه — M7.01.
 *
 * العيب الذي يعالجه: سلّم الحساسية كان **مكرّراً في الكود**. `RANK` في
 * `src/data/data-catalog.mjs` يعرف أربع مراتب آخرها `sovereign`، وبوابة الاستدلال
 * في `src/inference/inference-gate.mjs` تحجب نصّ `sensitive` و`secret` عن سجل
 * التدقيق — و`secret` مرتبةٌ لا وجود لها في الفهرس، بينما `sovereign` لم تُذكر
 * في ذلك الفحص. فكان أعلى تصنيفٍ في الدولة يُكتب نصّه كاملاً في السجل، لا لعيبٍ
 * في القرار بل لأن السلّم كُتب مرّتين فاختلفت المرّتان.
 *
 * فصار السلّم بياناً واحداً في `config/classification.yaml`، ويتحقّق المحمّل أن
 * مراتب الملف تطابق تعداد الكود تطابقاً تامّاً: أي مرتبة في أحدهما وليست في
 * الآخر تُسقط التحميل بـ`CLASSIFICATION_ENUM_DRIFT`. والمترادفات تُحَلّ ولا
 * تُخزَّن، فـ`secret` تُقرأ `sovereign` ولا تصير مرتبةً خامسة.
 *
 * وظيفة هذا الملف **الحكم على الاتجاه** لا تنفيذه: هو يجيب «هل هذا رفعٌ أم
 * إنزال؟ وكم درجة؟ وهل المرتبة مختومة؟»، أما اشتراط الاعتماد والتحقّق منه فهما
 * في `src/data/approvals.mjs` و`src/data/data-catalog.mjs`.
 *
 * حدٌّ معلن: هذا الملف لا يقرأ ولا يكتب أصلاً واحداً من أصول البيانات، ولا يعرف
 * من الفاعل؛ فلا يُنتظر منه قرار إتاحة. قرار الإتاحة على كل قراءة وكتابة موضعه
 * الخطوة M7.02.
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
const DEFAULT_CONFIG_DIR = path.join(ROOT, 'config');

export const CLASSIFICATION_ERRORS = Object.freeze({
  CONFIG_MISSING: 'CLASSIFICATION_CONFIG_MISSING',
  CONFIG_UNPARSABLE: 'CLASSIFICATION_CONFIG_UNPARSABLE',
  SCHEMA_MISSING: 'CLASSIFICATION_SCHEMA_MISSING',
  CONFIG_INVALID: 'CLASSIFICATION_CONFIG_INVALID',
  LATTICE_INCOHERENT: 'CLASSIFICATION_LATTICE_INCOHERENT',
  ENUM_DRIFT: 'CLASSIFICATION_ENUM_DRIFT',
  TIER_UNKNOWN: 'CLASSIFICATION_TIER_UNKNOWN',
});

/** خطأ مُسمّى: الرمز للأتمتة والنص العربي لمراجع قرار الرفض. */
export class ClassificationError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   */
  constructor(code, message) {
    super(message);
    this.name = 'ClassificationError';
    /** @type {string} */
    this.code = code;
  }
}

/**
 * مستويات تصنيف البيانات، مرتّبة تصاعدياً في الحساسية. هذا الكائن هو تعداد
 * الكود، و`config/classification.yaml` هو سلّم البيانات؛ والمحمّل يشترط تطابقهما
 * فلا تُضاف مرتبة هنا بلا موضعٍ ورتبةٍ هناك.
 */
export const Classification = Object.freeze({
  PUBLIC: 'public',
  INTERNAL: 'internal',
  SENSITIVE: 'sensitive',
  SOVEREIGN: 'sovereign',
});

/**
 * قيمة تصنيف واحدة، مشتقة من الكائن المُجمَّد فلا تنحرف عنه.
 * @typedef {(typeof Classification)[keyof typeof Classification]} ClassificationValue
 */

/**
 * @typedef {object} ClassificationTier
 * @property {ClassificationValue} id
 * @property {number} rank
 * @property {boolean} redactInLogs - نصّ المادة لا يُكتب في السجل، بل بصمتها وطولها
 * @property {boolean} encryptAtRest - مادة هذه المرتبة لا تُخزَّن نصّاً (M7.03)
 * @property {boolean} sealed - لا تُخفَّض بأي اعتماد تشغيلي
 * @property {string} description
 */

/**
 * @typedef {object} PromotionRules
 * @property {boolean} requiresApproval
 * @property {boolean} requiresJustification
 * @property {number} minJustificationChars
 */

/**
 * @typedef {object} DemotionRules
 * @property {boolean} requiresApproval
 * @property {boolean} requiresJustification
 * @property {number} minJustificationChars
 * @property {number} maxStepDown
 * @property {number} approvalTtlMs
 * @property {readonly string[]} approverRoles
 */

/**
 * @typedef {'promotion' | 'demotion' | 'unchanged'} ClassificationDirection
 */

/**
 * سلّم التصنيف: يعرف المراتب وترتيبها وقواعد الانتقال بينها. لا يعرف الأصول ولا
 * الفاعلين، فكل أجوبته عن السلّم وحده.
 */
export class ClassificationLattice {
  /**
   * @param {{ version: number, owner: string, tiers: readonly ClassificationTier[], aliases: ReadonlyMap<string, ClassificationValue>, clearances?: ReadonlyMap<string, ClassificationValue>, promotion: PromotionRules, demotion: DemotionRules }} parts
   */
  constructor({ version, owner, tiers, aliases, clearances = new Map(), promotion, demotion }) {
    /** @type {number} */
    this.version = version;
    /** @type {string} */
    this.owner = owner;
    /** @type {readonly ClassificationTier[]} */
    this.tiers = Object.freeze([...tiers].sort((a, b) => a.rank - b.rank));
    /** @type {ReadonlyMap<string, ClassificationValue>} */
    this.aliases = aliases;
    /**
     * التخليص الأمني لكل دور — بيانٌ في `config/classification.yaml` (الخطوة
     * `M7.02`)، لا قيمةٌ يمرّرها الطالب. دورٌ غير مذكور لا تخليص له، ويردّ
     * `clearanceFor` عنه `null` فيُرفض وصولُه بدل أن يُفترض له أدنى مرتبة.
     * @type {ReadonlyMap<string, ClassificationValue>}
     */
    this.clearances = clearances;
    /** @type {PromotionRules} */
    this.promotion = Object.freeze({ ...promotion });
    /** @type {DemotionRules} */
    this.demotion = Object.freeze({
      ...demotion,
      approverRoles: Object.freeze([...demotion.approverRoles]),
    });
    /** @type {ReadonlyMap<ClassificationValue, ClassificationTier>} */
    this.byId = new Map(this.tiers.map((tier) => [tier.id, tier]));
  }

  /** @returns {readonly ClassificationValue[]} المراتب بأسمائها من الأدنى للأعلى */
  get ids() {
    return Object.freeze(this.tiers.map((tier) => tier.id));
  }

  /**
   * يحلّ مُدخلاً خارجياً إلى مرتبة معروفة، أو `null` إن لم يكن مرتبة ولا مترادفاً.
   * المترادف يُحَلّ ولا يُعاد بنصّه، فلا يدخل التخزين اسمٌ ثانٍ للمرتبة نفسها.
   * @param {unknown} value
   * @returns {ClassificationValue | null}
   */
  normalize(value) {
    if (typeof value !== 'string') return null;
    if (this.byId.has(/** @type {ClassificationValue} */ (value))) {
      return /** @type {ClassificationValue} */ (value);
    }
    return this.aliases.get(value) ?? null;
  }

  /**
   * هل تُشفَّر مادة هذه المرتبة عند التخزين؟ (الخطوة `M7.03`.)
   *
   * والمجهول يُشفَّر: مرتبةٌ لا تُعرف ليست إذناً بالنصّ الصريح، فالجواب عن غير
   * المعروف `true` لا `false` — والقرار المبني عليه يرفض قبل أن يكتب، لأن
   * `encryptorFor` لا يجد لها مفتاحاً معلَناً.
   * @param {unknown} value
   * @returns {boolean}
   */
  requiresEncryption(value) {
    const id = this.normalize(value);
    if (id === null) return true;
    return /** @type {ClassificationTier} */ (this.byId.get(id)).encryptAtRest === true;
  }

  /**
   * رتبة الحساسية. غير المعروف يأخذ `-1` فيسقط دون كل المراتب — تصريحٌ مجهول
   * لا يُقرأ عاماً بل أدنى من العام.
   * @param {unknown} value
   * @returns {number}
   */
  rank(value) {
    const id = this.normalize(value);
    return id === null ? -1 : /** @type {ClassificationTier} */ (this.byId.get(id)).rank;
  }

  /**
   * @param {unknown} value
   * @returns {ClassificationTier}
   * @throws {ClassificationError} `CLASSIFICATION_TIER_UNKNOWN` لمرتبة غير معروفة
   */
  tier(value) {
    const id = this.normalize(value);
    if (id === null) {
      throw new ClassificationError(
        CLASSIFICATION_ERRORS.TIER_UNKNOWN,
        `مرتبة تصنيف غير معروفة: ${typeof value === 'string' ? value : typeof value}. المراتب المعلنة: ${this.ids.join('، ')}.`,
      );
    }
    return /** @type {ClassificationTier} */ (this.byId.get(id));
  }

  /**
   * هل التصريح يبلغ التصنيف أو يفوقه؟ الرفض هو الافتراض عند الجهل بأي طرف.
   * @param {unknown} clearance
   * @param {unknown} classification
   * @returns {boolean}
   */
  dominates(clearance, classification) {
    const required = this.rank(classification);
    if (required < 0) return false;
    return this.rank(clearance) >= required;
  }

  /**
   * التخليص المعلَن لدور. **الجهل رفضٌ لا افتراض:** دورٌ لا تُعلن له مرتبة يردّ
   * `null`، والمُنادي يرفض به — ومن أعاد «public» هنا لدورٍ مجهول جعل كل مجهولٍ
   * قارئاً.
   * @param {unknown} role
   * @returns {ClassificationValue | null}
   */
  clearanceFor(role) {
    if (typeof role !== 'string') return null;
    return this.clearances.get(role) ?? null;
  }

  /** @returns {readonly string[]} الأدوار التي أُعلن لها تخليص */
  get clearedRoles() {
    return Object.freeze([...this.clearances.keys()]);
  }

  /**
   * @param {unknown} value
   * @returns {boolean} هل تُحجب مادة هذه المرتبة عن نصّ السجلات؟
   */
  redactInLogs(value) {
    return this.tier(value).redactInLogs;
  }

  /**
   * @param {unknown} value
   * @returns {boolean} هل المرتبة مختومة فلا تُخفَّض بأي اعتماد تشغيلي؟
   */
  isSealed(value) {
    return this.tier(value).sealed;
  }

  /**
   * اتجاه الانتقال بين مرتبتين: رفعٌ للحساسية أم إنزال أم لا تغيير.
   * @param {unknown} from
   * @param {unknown} to
   * @returns {ClassificationDirection}
   */
  direction(from, to) {
    const before = this.tier(from).rank;
    const after = this.tier(to).rank;
    if (after > before) return 'promotion';
    if (after < before) return 'demotion';
    return 'unchanged';
  }

  /**
   * عدد الدرجات المقطوعة، موجباً دائماً. يُستخدم لمنع الهبوط قفزاً بقرار واحد.
   * @param {unknown} from
   * @param {unknown} to
   * @returns {number}
   */
  steps(from, to) {
    return Math.abs(this.tier(to).rank - this.tier(from).rank);
  }
}

/**
 * @param {string} dir
 * @returns {unknown}
 */
function readConfig(dir) {
  const configPath = path.join(dir, 'classification.yaml');
  if (!fs.existsSync(configPath)) {
    throw new ClassificationError(
      CLASSIFICATION_ERRORS.CONFIG_MISSING,
      `سلّم التصنيف مفقود: ${configPath}. بلا سلّم معلَن لا يُعرف اتجاه أي إعادة تصنيف، فيسقط التحميل ولا يُفترض سلّم في الكود.`,
    );
  }
  try {
    return YAML.parse(fs.readFileSync(configPath, 'utf8'));
  } catch (error) {
    throw new ClassificationError(
      CLASSIFICATION_ERRORS.CONFIG_UNPARSABLE,
      `سلّم التصنيف غير قابل للتحليل: ${configPath}. ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * @param {string} dir
 * @returns {Record<string, unknown>}
 */
function readSchema(dir) {
  const schemaPath = path.join(dir, 'schemas', 'classification.schema.json');
  if (!fs.existsSync(schemaPath)) {
    throw new ClassificationError(
      CLASSIFICATION_ERRORS.SCHEMA_MISSING,
      `مخطط سلّم التصنيف مفقود: ${schemaPath}. تحميل إعدادات بلا مخطط يقبل أي شكل، وهو ما لا يجوز في قرار حساسية.`,
    );
  }
  return /** @type {Record<string, unknown>} */ (JSON.parse(fs.readFileSync(schemaPath, 'utf8')));
}

/**
 * فحوص تماسك لا يبلغها المخطط: تفرّد المُعرّفات والرتب، وتلاصق السلّم من الصفر،
 * وتطابق البيانات مع تعداد الكود، وسلامة المترادفات.
 * @param {{ tiers: ClassificationTier[], aliasEntries: Array<{ from: string, to: string }>, clearanceEntries?: Array<{ role: string, tier: string }> }} parts
 * @returns {void}
 */
function assertCoherent({ tiers, aliasEntries, clearanceEntries = [] }) {
  /** @param {string} message @returns {never} */
  const fail = (message) => {
    throw new ClassificationError(CLASSIFICATION_ERRORS.LATTICE_INCOHERENT, message);
  };

  const ids = tiers.map((tier) => tier.id);
  if (new Set(ids).size !== ids.length) fail('مُعرّف مرتبة مكرّر في سلّم التصنيف.');

  const ranks = tiers.map((tier) => tier.rank).sort((a, b) => a - b);
  if (new Set(ranks).size !== ranks.length) {
    fail('رتبتان متساويتان في سلّم التصنيف؛ سلّمٌ برتبتين متساويتين لا يُقرأ منه اتجاه.');
  }
  for (const [index, rank] of ranks.entries()) {
    if (rank !== index) {
      fail(
        `رتب سلّم التصنيف يجب أن تكون متلاصقة من 0: وُجد ${ranks.join('،')}. الفراغ في السلّم يجعل «درجة واحدة» عبارةً غامضة.`,
      );
    }
  }

  const sorted = [...tiers].sort((a, b) => a.rank - b.rank);
  const top = /** @type {ClassificationTier} */ (sorted[sorted.length - 1]);
  if (!top.sealed) {
    fail(
      `أعلى مرتبة (${top.id}) غير مختومة؛ إنزال أعلى تصنيف يجب أن يكون مساراً دستورياً لا قراراً تشغيلياً.`,
    );
  }
  for (const tier of sorted) {
    if (tier.sealed && tier.rank !== top.rank) {
      fail(`مرتبة مختومة في وسط السلّم (${tier.id})؛ الختم للقمّة وحدها كي لا ينقسم السلّم.`);
    }
  }

  // التشفير عند التخزين مُطّرد صعوداً: إن شُفِّرت مرتبةٌ فكل ما فوقها مشفَّر.
  // بلا هذا الفحص كان ملفٌ يقول «الحساس مشفَّر والسيادي نصّ» يُقبل بلا شكوى —
  // وهو أسوأ من «لا تشفير» لأنه يقرأ كأنّ الحماية قائمة.
  for (const tier of sorted) {
    if (!tier.encryptAtRest) continue;
    const plainAbove = sorted.filter((other) => other.rank > tier.rank && !other.encryptAtRest);
    if (plainAbove.length > 0) {
      fail(
        `مرتبة «${tier.id}» تُشفَّر عند التخزين ومرتبةٌ أعلى منها لا تُشفَّر (${plainAbove.map((other) => other.id).join('، ')})؛ حمايةٌ تنقص كلما زادت الحساسية ليست حماية.`,
      );
    }
  }

  const declared = new Set(ids);
  const expected = new Set(Object.values(Classification));
  const missing = [...expected].filter((id) => !declared.has(/** @type {never} */ (id)));
  const extra = [...declared].filter((id) => !expected.has(/** @type {never} */ (id)));
  if (missing.length > 0 || extra.length > 0) {
    throw new ClassificationError(
      CLASSIFICATION_ERRORS.ENUM_DRIFT,
      `سلّم البيانات وتعداد الكود مختلفان — ناقص في الملف: [${missing.join('، ') || 'لا شيء'}]، زائد على التعداد: [${extra.join('، ') || 'لا شيء'}]. هذا الانحراف بعينه هو ما جعل مرتبةً عليا تُسجَّل بنصّها، فلا يمرّ صامتاً.`,
    );
  }

  const seenAlias = new Set();
  for (const alias of aliasEntries) {
    if (declared.has(/** @type {never} */ (alias.from))) {
      fail(`المترادف «${alias.from}» هو نفسه مرتبة معلنة؛ اسمٌ واحد لا يكون مرتبةً ومترادفاً.`);
    }
    if (!declared.has(/** @type {never} */ (alias.to))) {
      fail(`المترادف «${alias.from}» يحيل إلى مرتبة غير معلنة «${alias.to}».`);
    }
    if (seenAlias.has(alias.from)) fail(`مترادف مكرّر: ${alias.from}.`);
    seenAlias.add(alias.from);
  }

  const seenRole = new Set();
  for (const entry of clearanceEntries) {
    if (!declared.has(/** @type {never} */ (entry.tier))) {
      fail(`تخليص الدور «${entry.role}» يحيل إلى مرتبة غير معلنة «${entry.tier}».`);
    }
    if (seenRole.has(entry.role)) {
      fail(
        `تخليص مكرّر للدور «${entry.role}»؛ دورٌ بتخليصين يجعل قرار الإتاحة رهنَ ترتيب القراءة.`,
      );
    }
    seenRole.add(entry.role);
  }
}

/**
 * يحمّل سلّم التصنيف من الإعدادات ويتحقّق منه مخطَّطاً وتماسكاً.
 * @param {{ dir?: string }} [options]
 * @returns {ClassificationLattice}
 */
export function loadClassificationLattice({ dir = DEFAULT_CONFIG_DIR } = {}) {
  const raw = readConfig(dir);
  const schema = readSchema(dir);
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  const validate = ajv.compile(schema);
  if (!validate(raw)) {
    const detail = (validate.errors ?? [])
      .map((error) => `${error.instancePath || '/'} ${error.message ?? ''}`.trim())
      .join('؛ ');
    throw new ClassificationError(
      CLASSIFICATION_ERRORS.CONFIG_INVALID,
      `سلّم التصنيف لا يطابق مخططه: ${detail}`,
    );
  }

  const parsed =
    /** @type {{ version: number, owner: string, tiers: ClassificationTier[], aliases?: Array<{ from: string, to: string }>, clearances?: Array<{ role: string, tier: string }>, promotion: PromotionRules, demotion: DemotionRules }} */ (
      raw
    );
  const aliasEntries = parsed.aliases ?? [];
  const clearanceEntries = parsed.clearances ?? [];
  const tiers = parsed.tiers.map((tier) => Object.freeze({ ...tier }));
  assertCoherent({ tiers: [...tiers], aliasEntries, clearanceEntries });

  return new ClassificationLattice({
    version: parsed.version,
    owner: parsed.owner,
    tiers,
    aliases: new Map(
      aliasEntries.map((alias) => [alias.from, /** @type {ClassificationValue} */ (alias.to)]),
    ),
    clearances: new Map(
      clearanceEntries.map((entry) => [
        entry.role,
        /** @type {ClassificationValue} */ (entry.tier),
      ]),
    ),
    promotion: parsed.promotion,
    demotion: parsed.demotion,
  });
}
