/**
 * التشفير عند التخزين وعند النقل — M7.03.
 *
 * العيب الذي تُغلقه هذه الوحدة، بنصّه لا بتقريبه: بعد `M7.01` صار التصنيف
 * سلّماً واحداً، وبعد `M7.02` صار كل قراءة وكتابة تمرّ ببوابة تُقيّم السياسة
 * وتشتقّ التخليص من الدور وتتحقّق من تذكرة القرار قبل الأثر. وكلُّ ذلك يعترض من
 * جاء **من طريق الكود**. أما مادة الذاكرة فكانت تُخزَّن نصّاً صريحاً في عمود
 * `content`: فمن قرأ القاعدة بحساب صيانة، أو نسخ نسخةً احتياطية، أو حمل القرص،
 * قرأ السيادي كما هو — والبوابة لم تُستدعَ أصلاً. أي أن الحماية كانت في المسار
 * لا في المادة، ومن ترك المسار لم يجد ما يمنعه.
 *
 * فصار المخزون **معمّى**: مفتاح بيانات عشوائي لكل مدخل (DEK)، مغلَّف بمفتاح
 * المرتبة (KEK) المقيم في **مزوّد المفاتيح** لا في الكود ولا في الإعدادات ولا في
 * متغيّر بيئة يحمل المادة نفسها. ومن قرأ القاعدة قرأ معمّى، ومن أراد فكّه احتاج
 * المزوّد — وهذا هو الفرق بين «قرار إتاحة» و«سرّية».
 *
 * ثلاثة قرارات تستحقّ التسبيب:
 *
 *  1. **التغليف على طبقتين** لا مفتاحٌ واحد للمرتبة يُشفَّر به كل مدخل: تدوير
 *     المفتاح في الحالة الثانية يعني فكّ كل المداخل وإعادة تشفيرها، وهو عملٌ لا
 *     يُنجَز على قاعدة حيّة فيُؤجَّل التدوير إلى «لاحقاً» ولا يقع أبداً.
 *  2. **البيانات المصادَقة الإضافية (AAD)** تربط المعمّى بهويّة صفّه: معرّف
 *     المدخل ومالكه وعقد بياناته. فنقلُ معمّى من صفٍّ إلى صفٍّ — وهو ما يفعله من
 *     يريد أن يقرأ ذاكرة غيره بلا مفتاح — يُخفق عند الفكّ بـ
 *     `ENCRYPTION_ENVELOPE_TAMPERED` ولا يُعاد نصّاً محرَّفاً.
 *  3. **المفاتيح لا تُنشأ عند الكتابة.** مخزنٌ فقد مفتاحه يجب أن يُخفق، لا أن
 *     يولّد مفتاحاً جديداً فيصير كل ما قبله غير قابل للفكّ بلا أن يشتكي أحد.
 *     الإنشاء فعلٌ صريح في `ensureTierKey` يُنادى في التمهيد.
 *
 * **حدود معلنة:**
 *  - الفكّ يُعيد المادة إلى ذاكرة العملية، فمن ملك العملية ملك المادة بعد الفكّ.
 *    هذه الوحدة لا تدّعي حماية من قراءة ذاكرة العملية.
 *  - تدوير مفاتيح المراتب **غير آلي** هنا: `describeKey` يقول العمر، وسياسة
 *    `maxAgeDays` تُقاس ولا تُنفَّذ تلقائياً. موضع التنفيذ M7.06.
 *  - إعادةُ تصنيف مادةٍ مغلَّفة (رفعٌ أو إنزال) تُوجب إعادة تغليفها بمفتاح
 *    المرتبة الجديدة، وهذا المسار **غير موصول** بـ`reclassify`؛ ولذلك يفحص
 *    `scripts/guard-encryption.mjs` تطابق مفتاح الغلاف مع تصنيف الأصل فيصير
 *    النقص **مكشوفاً** لا صامتاً.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  timingSafeEqual,
  createHash,
} from 'node:crypto';
import YAML from 'yaml';
import Ajv2020Default from 'ajv/dist/2020.js';

import { LocalEncryptedKeyProvider } from '../root-of-trust/key-provider-local.mjs';
import { RemoteSecretStoreKeyProvider } from '../root-of-trust/key-provider-remote.mjs';

const Ajv2020 = /** @type {typeof import('ajv/dist/2020.js').Ajv2020} */ (
  /** @type {unknown} */ (Ajv2020Default)
);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DEFAULT_CONFIG_DIR = path.join(ROOT, 'config');

/** إصدار شكل الغلاف. رقمٌ في المادة نفسها كي يُعرف كيف يُفكّ ما كُتب قبل تغييره. */
export const ENVELOPE_VERSION = 1;

/** الحقل الذي يُميّز الغلاف عن أي كائن آخر في عمود `jsonb`؛ يقرؤه قيد القاعدة أيضاً. */
export const ENVELOPE_MARKER = '__enc';

export const ENCRYPTION_ERRORS = Object.freeze({
  CONFIG_MISSING: 'ENCRYPTION_CONFIG_MISSING',
  CONFIG_UNPARSABLE: 'ENCRYPTION_CONFIG_UNPARSABLE',
  SCHEMA_MISSING: 'ENCRYPTION_SCHEMA_MISSING',
  CONFIG_INVALID: 'ENCRYPTION_CONFIG_INVALID',
  TIER_KEY_UNDECLARED: 'ENCRYPTION_TIER_KEY_UNDECLARED',
  KEY_MATERIAL_IN_CONFIG: 'ENCRYPTION_KEY_MATERIAL_IN_CONFIG',
  PROVIDER_REQUIRED: 'ENCRYPTION_PROVIDER_REQUIRED',
  PROVIDER_NOT_PRODUCTION_READY: 'ENCRYPTION_PROVIDER_NOT_PRODUCTION_READY',
  KEY_STORE_NOT_CONFIGURED: 'ENCRYPTION_KEY_STORE_NOT_CONFIGURED',
  KEY_UNAVAILABLE: 'ENCRYPTION_KEY_UNAVAILABLE',
  KEY_MATERIAL_INVALID: 'ENCRYPTION_KEY_MATERIAL_INVALID',
  BINDING_REQUIRED: 'ENCRYPTION_BINDING_REQUIRED',
  ENVELOPE_INVALID: 'ENCRYPTION_ENVELOPE_INVALID',
  ENVELOPE_TAMPERED: 'ENCRYPTION_ENVELOPE_TAMPERED',
  ENVELOPE_TIER_MISMATCH: 'ENCRYPTION_ENVELOPE_TIER_MISMATCH',
  PLAINTEXT_AT_REST: 'ENCRYPTION_PLAINTEXT_AT_REST',
  TRANSPORT_INSECURE: 'ENCRYPTION_TRANSPORT_INSECURE',
});

/** خطأ مُسمّى. الرسالة عربية للمراجع، والرمز للأتمتة — ولا تحمل واحدةٌ منهما مادة مفتاح. */
export class EncryptionError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   */
  constructor(code, message) {
    super(message);
    this.name = 'EncryptionError';
    /** @type {string} */
    this.code = code;
  }
}

/**
 * @typedef {object} EncryptionCipherSpec
 * @property {'aes-256-gcm'} algorithm
 * @property {number} keyBytes
 * @property {number} ivBytes
 * @property {number} tagBytes
 */

/**
 * @typedef {object} EncryptionStoreSpec
 * @property {string} name - اسم الجدول كما في القاعدة
 * @property {string} field - العمود الذي لا يُخزَّن نصّاً
 * @property {string} writer - مسار الوحدة التي تكتبه؛ يقرؤه الحاجب
 * @property {boolean} alwaysEncrypt
 * @property {string} dbConstraint - اسم القيد الذي يفرض الغلاف في القاعدة
 */

/**
 * @typedef {object} EncryptionTransportSpec
 * @property {boolean} requireTls
 * @property {boolean} allowPlaintextToLoopback
 * @property {readonly string[]} loopbackHosts
 */

/**
 * سياسة التشفير: بيانٌ محمَّل ومتحقَّق منه، لا قيمٌ في الكود.
 */
export class EncryptionPolicy {
  /**
   * @param {{ version: number, owner: string, cipher: EncryptionCipherSpec, keyNames: ReadonlyMap<string, string>, createOnDemand: boolean, maxAgeDays: number, stores: readonly EncryptionStoreSpec[], transport: EncryptionTransportSpec, requireProductionReadyIn: readonly string[], environmentVariables: { remote: readonly string[], local: readonly string[] } }} parts
   */
  constructor(parts) {
    /** @type {number} */
    this.version = parts.version;
    /** @type {string} */
    this.owner = parts.owner;
    /** @type {EncryptionCipherSpec} */
    this.cipher = Object.freeze({ ...parts.cipher });
    /** @type {ReadonlyMap<string, string>} */
    this.keyNames = parts.keyNames;
    /** @type {boolean} */
    this.createOnDemand = parts.createOnDemand;
    /** @type {number} */
    this.maxAgeDays = parts.maxAgeDays;
    /** @type {readonly EncryptionStoreSpec[]} */
    this.stores = Object.freeze(parts.stores.map((store) => Object.freeze({ ...store })));
    /** @type {EncryptionTransportSpec} */
    this.transport = Object.freeze({
      ...parts.transport,
      loopbackHosts: Object.freeze([...parts.transport.loopbackHosts]),
    });
    /** @type {readonly string[]} */
    this.requireProductionReadyIn = Object.freeze([...parts.requireProductionReadyIn]);
    /** @type {{ remote: readonly string[], local: readonly string[] }} */
    this.environmentVariables = Object.freeze({
      remote: Object.freeze([...parts.environmentVariables.remote]),
      local: Object.freeze([...parts.environmentVariables.local]),
    });
  }

  /**
   * اسم مفتاح المرتبة في المزوّد.
   * @param {string} tier
   * @returns {string}
   * @throws {EncryptionError} `ENCRYPTION_TIER_KEY_UNDECLARED` لمرتبةٍ بلا مفتاح معلَن
   */
  keyNameFor(tier) {
    const name = this.keyNames.get(tier);
    if (name === undefined) {
      throw new EncryptionError(
        ENCRYPTION_ERRORS.TIER_KEY_UNDECLARED,
        `المرتبة «${tier}» تحتاج تشفيراً ولا مفتاح معلَن لها في config/encryption.yaml. الجهل باسم المفتاح رفضٌ للكتابة، لا كتابةٌ بمفتاح مرتبةٍ أخرى ولا كتابةٌ نصّاً.`,
      );
    }
    return name;
  }

  /**
   * مواصفة مخزنٍ معلَن بالاسم، أو `null`.
   * @param {string} name
   * @returns {EncryptionStoreSpec | null}
   */
  storeFor(name) {
    return this.stores.find((store) => store.name === name) ?? null;
  }
}

/**
 * @param {string} dir
 * @returns {unknown}
 */
function readConfig(dir) {
  const configPath = path.join(dir, 'encryption.yaml');
  if (!fs.existsSync(configPath)) {
    throw new EncryptionError(
      ENCRYPTION_ERRORS.CONFIG_MISSING,
      `سياسة التشفير مفقودة: ${configPath}. بلا سياسة معلَنة لا يُعرف أي معمّى ولا أي مفتاح، فيسقط التحميل ولا يُفترض تشفيرٌ في الكود.`,
    );
  }
  try {
    return YAML.parse(fs.readFileSync(configPath, 'utf8'));
  } catch (error) {
    throw new EncryptionError(
      ENCRYPTION_ERRORS.CONFIG_UNPARSABLE,
      `سياسة التشفير غير قابلة للتحليل: ${configPath}. ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * @param {string} dir
 * @returns {Record<string, unknown>}
 */
function readSchema(dir) {
  const schemaPath = path.join(dir, 'schemas', 'encryption.schema.json');
  if (!fs.existsSync(schemaPath)) {
    throw new EncryptionError(
      ENCRYPTION_ERRORS.SCHEMA_MISSING,
      `مخطط سياسة التشفير مفقود: ${schemaPath}. تحميل إعداد تشفير بلا مخطط يقبل معمّى غير مصادق ومقاساتٍ لا تحمي.`,
    );
  }
  return /** @type {Record<string, unknown>} */ (JSON.parse(fs.readFileSync(schemaPath, 'utf8')));
}

/**
 * يحمّل سياسة التشفير ويتحقّق منها مخطَّطاً وتماسكاً **مع سلّم التصنيف**: كل
 * مرتبة `encryptAtRest` لها مفتاح معلَن، وكل مفتاح معلَن يحيل إلى مرتبة قائمة
 * تحتاج تشفيراً. فمفتاحٌ لمرتبةٍ لا تُشفَّر يقول إنّ أحد الملفين تغيّر ولم يتبعه
 * الآخر، وهو الانحراف نفسه الذي عالجته M7.01.
 * @param {{ dir?: string, lattice: import('./classification.mjs').ClassificationLattice }} options
 * @returns {EncryptionPolicy}
 */
export function loadEncryptionPolicy({ dir = DEFAULT_CONFIG_DIR, lattice }) {
  if (lattice === undefined || typeof lattice.requiresEncryption !== 'function') {
    throw new EncryptionError(
      ENCRYPTION_ERRORS.CONFIG_INVALID,
      'تحميل سياسة التشفير يشترط سلّم التصنيف: سؤال «أي مرتبة تُشفَّر» جوابُه في السلّم، وسياسةٌ تُحمَّل بلا سلّم كانت ستقرّر عن مراتب لا تعرفها.',
    );
  }
  const raw = readConfig(dir);
  const schema = readSchema(dir);
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  const validate = ajv.compile(schema);
  if (!validate(raw)) {
    const detail = (validate.errors ?? [])
      .map((error) => `${error.instancePath || '/'} ${error.message ?? ''}`.trim())
      .join('؛ ');
    throw new EncryptionError(
      ENCRYPTION_ERRORS.CONFIG_INVALID,
      `سياسة التشفير لا تطابق مخططها: ${detail}`,
    );
  }

  const parsed =
    /** @type {{ version: number, owner: string, cipher: EncryptionCipherSpec, keys: { perTier: Array<{ tier: string, name: string }>, createOnDemand: boolean, maxAgeDays: number }, stores: EncryptionStoreSpec[], transport: EncryptionTransportSpec, provider: { requireProductionReadyIn: string[], environmentVariables: { remote: string[], local: string[] } } }} */ (
      raw
    );

  assertNoKeyMaterial(parsed);

  const keyNames = new Map();
  for (const entry of parsed.keys.perTier) {
    if (keyNames.has(entry.tier)) {
      throw new EncryptionError(
        ENCRYPTION_ERRORS.CONFIG_INVALID,
        `مفتاحان معلَنان للمرتبة «${entry.tier}»؛ مرتبةٌ بمفتاحين تجعل الفكّ رهنَ ترتيب القراءة.`,
      );
    }
    if (!lattice.requiresEncryption(entry.tier)) {
      throw new EncryptionError(
        ENCRYPTION_ERRORS.CONFIG_INVALID,
        `مفتاح معلَن للمرتبة «${entry.tier}» وهي لا تُشفَّر في config/classification.yaml؛ أحد الملفين تغيّر ولم يتبعه الآخر، وهذا الانحراف لا يمرّ صامتاً.`,
      );
    }
    keyNames.set(entry.tier, entry.name);
  }
  const uniqueNames = new Set(keyNames.values());
  if (uniqueNames.size !== keyNames.size) {
    throw new EncryptionError(
      ENCRYPTION_ERRORS.CONFIG_INVALID,
      'مرتبتان تتشاركان اسم مفتاح واحد؛ فمن ملك مفتاح المرتبة الأدنى فكّ مادة الأعلى — وهو إبطالٌ للسلّم كلّه من باب الإعداد.',
    );
  }
  for (const tier of lattice.ids) {
    if (lattice.requiresEncryption(tier) && !keyNames.has(tier)) {
      throw new EncryptionError(
        ENCRYPTION_ERRORS.TIER_KEY_UNDECLARED,
        `المرتبة «${tier}» معلَنة `.concat(
          `encryptAtRest في سلّم التصنيف ولا مفتاح لها في سياسة التشفير. مرتبةٌ يُنسى مفتاحها كانت ستُكتب نصّاً، فيسقط التحميل.`,
        ),
      );
    }
  }

  return new EncryptionPolicy({
    version: parsed.version,
    owner: parsed.owner,
    cipher: parsed.cipher,
    keyNames,
    createOnDemand: parsed.keys.createOnDemand,
    maxAgeDays: parsed.keys.maxAgeDays,
    stores: parsed.stores,
    transport: parsed.transport,
    requireProductionReadyIn: parsed.provider.requireProductionReadyIn,
    environmentVariables: parsed.provider.environmentVariables,
  });
}

/**
 * يرفض أي قيمة في السياسة تشبه **مادة مفتاح**. المفاتيح تأتي من المزوّد، وملف
 * الإعداد مقروءٌ في المستودع ومنسوخ في كل نسخة احتياطية: مفتاحٌ يقع فيه سهواً
 * يصير مفتاحاً منشوراً. والفحص على الشكل (طولٌ وعشوائيةُ حروف) لا على اسم
 * الحقل، لأن من يضع سرّاً سهواً لا يسمّي الحقل `secret`.
 * @param {unknown} node
 * @param {string} [at]
 * @returns {void}
 */
export function assertNoKeyMaterial(node, at = '/') {
  if (typeof node === 'string') {
    const trimmed = node.trim();
    const base64ish = /^[A-Za-z0-9+/=_-]{32,}$/.test(trimmed);
    const hexish = /^[0-9a-fA-F]{32,}$/.test(trimmed);
    if (base64ish || hexish) {
      throw new EncryptionError(
        ENCRYPTION_ERRORS.KEY_MATERIAL_IN_CONFIG,
        `قيمة في ${at} تشبه مادة مفتاح (طولها ${trimmed.length} وحروفها ترميز خام). المفاتيح تأتي من مزوّد المفاتيح؛ وملف الإعداد يُدفع إلى المستودع ويُنسخ في كل نسخة احتياطية، فمادةٌ فيه مادةٌ منشورة.`,
      );
    }
    return;
  }
  if (Array.isArray(node)) {
    node.forEach((item, index) => assertNoKeyMaterial(item, `${at}${index}/`));
    return;
  }
  if (node !== null && typeof node === 'object') {
    for (const [key, value] of Object.entries(node)) assertNoKeyMaterial(value, `${at}${key}/`);
  }
}

/**
 * غلافُ مادةٍ مشفَّرة. كل حقوله ترميز `base64url` عدا العدد والاسم. ولا يحمل
 * الغلاف قيم الربط (`binding`) بل **بصمتها**: لو حملها لصار من يعدّلها يعدّلهما
 * معاً فيمرّ.
 * @typedef {object} SealedEnvelope
 * @property {number} __enc - إصدار شكل الغلاف
 * @property {'aes-256-gcm'} alg
 * @property {string} kek - اسم مفتاح المرتبة في المزوّد
 * @property {string} tier - المرتبة التي غُلِّفت بها المادة
 * @property {string} dek - مفتاح المدخل مغلَّفاً
 * @property {string} dekIv
 * @property {string} dekTag
 * @property {string} iv
 * @property {string} tag
 * @property {string} ct
 * @property {string} bindingHash - بصمة الربط، تُقارن قبل الفكّ لتعطي خطأً مفهوماً
 * @property {string} sealedAt
 */

/**
 * @param {Buffer} buffer
 * @returns {string}
 */
function encode(buffer) {
  return buffer.toString('base64url');
}

/**
 * @param {string} value
 * @param {string} field
 * @returns {Buffer}
 */
function decode(value, field) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new EncryptionError(
      ENCRYPTION_ERRORS.ENVELOPE_INVALID,
      `غلافٌ ناقص: الحقل «${field}» غائب أو ليس نصّاً. غلافٌ ناقص لا يُعامل معاملة النصّ الصريح، بل يُرفض.`,
    );
  }
  return Buffer.from(value, 'base64url');
}

/**
 * يبني نصّ الربط من هويّة الصفّ. الترتيب مثبَّت والفواصل مثبَّتة: نصٌّ يُبنى
 * بترتيبٍ متغيّر يُنتج ربطاً لا يُطابق نفسه.
 * @param {Record<string, string>} binding
 * @returns {string}
 */
function bindingString(binding) {
  const keys = Object.keys(binding).sort();
  if (keys.length === 0) {
    throw new EncryptionError(
      ENCRYPTION_ERRORS.BINDING_REQUIRED,
      'التغليف يشترط ربطاً بهويّة الصفّ (المعرّف والمالك وعقد البيانات). معمّى بلا ربط يُنقل من صفٍّ إلى صفٍّ فيُقرأ بمفتاحٍ لا يملكه قارئه.',
    );
  }
  for (const key of keys) {
    const value = binding[key];
    if (typeof value !== 'string' || value.length === 0) {
      throw new EncryptionError(
        ENCRYPTION_ERRORS.BINDING_REQUIRED,
        `قيمة الربط «${key}» فارغة؛ ربطٌ فارغ يُطابق كل صفّ فلا يربط شيئاً.`,
      );
    }
    if (value.includes('\u0000')) {
      throw new EncryptionError(
        ENCRYPTION_ERRORS.BINDING_REQUIRED,
        `قيمة الربط «${key}» تحمل فاصل الربط نفسه؛ قيمةٌ كهذه تُنتج نصّ ربطٍ غامضاً يُطابق تركيبتين مختلفتين.`,
      );
    }
  }
  return keys.map((key) => `${key}\u0000${binding[key]}`).join('\u0001');
}

/**
 * مغلِّف مادة البيانات. عقده الوحيد مع الخارج: `seal` و`open`، وما بينهما لا
 * يخرج مفتاحٌ ولا يُطبع.
 */
export class DataEncryptor {
  /**
   * @param {{ policy: EncryptionPolicy, lattice: import('./classification.mjs').ClassificationLattice, keyProvider: import('../root-of-trust/key-provider.mjs').KeyProvider, environment?: string }} parts
   */
  constructor({ policy, lattice, keyProvider, environment = 'development' }) {
    if (policy === undefined || lattice === undefined) {
      throw new EncryptionError(
        ENCRYPTION_ERRORS.CONFIG_INVALID,
        'المغلِّف يشترط سياسةً وسلّماً معلَنين؛ تشفيرٌ بمقاساتٍ مضمَرة في الكود هو ما تمنعه هذه الخطوة.',
      );
    }
    if (keyProvider === undefined || keyProvider === null) {
      throw new EncryptionError(
        ENCRYPTION_ERRORS.PROVIDER_REQUIRED,
        'المغلِّف يشترط مزوّد مفاتيح. ولا مزوّد افتراضي ولا مفتاح مولَّد في الذاكرة: مفتاحٌ في الذاكرة يضيع عند الإقلاع فيصير كل ما كُتب غير قابل للفكّ، وهو فقدُ بيانات باسم التشفير.',
      );
    }
    const description = keyProvider.describe();
    if (policy.requireProductionReadyIn.includes(environment) && !description.productionReady) {
      throw new EncryptionError(
        ENCRYPTION_ERRORS.PROVIDER_NOT_PRODUCTION_READY,
        `مزوّد المفاتيح «${description.kind}» يُعلن أنه غير صالح للإنتاج، والبيئة «${environment}» تشترط مزوّداً صالحاً. مادةُ مفتاحٍ على قرص الخدمة نفسها هي الفجوة G1 في وثيقة التدقيق، ولا يُغلقها إلا مخزن أسرار خارجي.`,
      );
    }
    /** @type {EncryptionPolicy} */
    this.policy = policy;
    /** @type {import('./classification.mjs').ClassificationLattice} */
    this.lattice = lattice;
    /** @type {import('../root-of-trust/key-provider.mjs').KeyProvider} */
    this.keyProvider = keyProvider;
    /** @type {string} */
    this.environment = environment;
    /**
     * ذاكرةٌ مؤقتة لمادة المفاتيح داخل العملية. لماذا لا يُطلب المفتاح من
     * المزوّد عند كل مدخل: لأن المزوّد الخارجي شبكة، وطلبٌ لكل كتابة يجعل كل
     * كتابةٍ رهنَ توفّر الشبكة. والحدّ المعلن: المادة تقيم في ذاكرة العملية
     * حتى `forgetKeys()`.
     * @type {Map<string, Buffer>}
     */
    this.keyCache = new Map();
  }

  /** @returns {{ algorithm: string, provider: string, productionReady: boolean, tiers: string[] }} */
  describe() {
    const provider = this.keyProvider.describe();
    return {
      algorithm: this.policy.cipher.algorithm,
      provider: provider.kind,
      productionReady: provider.productionReady,
      tiers: [...this.policy.keyNames.keys()],
    };
  }

  /**
   * هل تُشفَّر مادة هذه المرتبة؟ الجواب من السلّم لا من هذه الوحدة.
   * @param {unknown} classification
   * @returns {boolean}
   */
  requiresEncryption(classification) {
    return this.lattice.requiresEncryption(classification);
  }

  /** يُفرغ مادة المفاتيح من ذاكرة العملية؛ الطلب التالي يُعيد جلبها من المزوّد. */
  forgetKeys() {
    for (const material of this.keyCache.values()) material.fill(0);
    this.keyCache.clear();
  }

  /**
   * يُنشئ مفتاح المرتبة في المزوّد إن لم يكن موجوداً — **فعلٌ صريح** في التمهيد،
   * لا سقوطٌ تلقائي عند أول كتابة.
   * @param {string} tier
   * @returns {Promise<{ name: string, created: boolean }>}
   */
  async ensureTierKey(tier) {
    const name = this.policy.keyNameFor(tier);
    if (await this.keyProvider.has(name)) return { name, created: false };
    const material = randomBytes(this.policy.cipher.keyBytes);
    // `overwrite` متروك على افتراضه (ممنوع): مفتاحٌ موجود لا يُطمس هنا بحال،
    // لأن طمسه يُفقد كل ما غُلِّف به.
    await this.keyProvider.put(name, material.toString('base64'));
    material.fill(0);
    return { name, created: true };
  }

  /**
   * مادة مفتاح المرتبة من المزوّد، بطولها المُعلَن. ولا إنشاء عند الطلب.
   * @param {string} tier
   * @returns {Promise<Buffer>}
   */
  async #kek(tier) {
    const name = this.policy.keyNameFor(tier);
    const cached = this.keyCache.get(name);
    if (cached !== undefined) return cached;
    let raw;
    try {
      raw = await this.keyProvider.get(name);
    } catch (error) {
      const code = /** @type {{ code?: string }} */ (error)?.code ?? 'UNKNOWN';
      throw new EncryptionError(
        ENCRYPTION_ERRORS.KEY_UNAVAILABLE,
        `مفتاح المرتبة «${tier}» غير متاح من المزوّد (${code}). الكتابة تُرفض والقراءة تُرفض: توليد مفتاح بديل هنا كان سيجعل كل ما غُلِّف قبله غير قابل للفكّ بلا أن يشتكي أحد.`,
      );
    }
    const material = Buffer.from(raw, 'base64');
    if (material.length !== this.policy.cipher.keyBytes) {
      throw new EncryptionError(
        ENCRYPTION_ERRORS.KEY_MATERIAL_INVALID,
        `مادة مفتاح المرتبة «${tier}» بطول ${material.length} بايت والمعلَن ${this.policy.cipher.keyBytes}. مفتاحٌ بطول غير معلَن يُنتج تشفيراً بقوّة غير معلومة، فيُرفض.`,
      );
    }
    this.keyCache.set(name, material);
    return material;
  }

  /**
   * يغلّف قيمةً: مفتاحٌ عشوائي للمدخل يشفّر المادة، ومفتاح المرتبة يغلّف مفتاح
   * المدخل. والربط يدخل في المصادقة فلا يُنقل الغلاف إلى صفٍّ آخر.
   * @param {{ value: unknown, classification: string, binding: Record<string, string> }} request
   * @returns {Promise<SealedEnvelope>}
   */
  async seal({ value, classification, binding }) {
    const tier = this.lattice.normalize(classification);
    if (tier === null) {
      throw new EncryptionError(
        ENCRYPTION_ERRORS.TIER_KEY_UNDECLARED,
        `تصنيفٌ غير معروف «${String(classification)}» لا يُغلَّف بمفتاحٍ مفترض ولا يُخزَّن نصّاً؛ يُرفض.`,
      );
    }
    const aad = Buffer.from(bindingString(binding), 'utf8');
    const kek = await this.#kek(tier);
    const { ivBytes, keyBytes, algorithm } = this.policy.cipher;

    const dek = randomBytes(keyBytes);
    const iv = randomBytes(ivBytes);
    const cipher = createCipheriv(algorithm, dek, iv);
    cipher.setAAD(aad);
    // التغليف `{ value }` يُبقي القيمة `undefined` و`null` مميَّزتين بعد الفكّ.
    const ct = Buffer.concat([
      cipher.update(JSON.stringify({ value: value ?? null }), 'utf8'),
      cipher.final(),
    ]);
    const tag = cipher.getAuthTag();

    const dekIv = randomBytes(ivBytes);
    const wrapper = createCipheriv(algorithm, kek, dekIv);
    // مفتاح المدخل مغلَّف **بنفس الربط**: غلافٌ يُنقل بمفتاحه المغلَّف معاً لا
    // يمرّ، لأن فكّ المفتاح نفسه يُخفق عند اختلاف الربط.
    wrapper.setAAD(aad);
    const wrappedDek = Buffer.concat([wrapper.update(dek), wrapper.final()]);
    const dekTag = wrapper.getAuthTag();
    dek.fill(0);

    return {
      [ENVELOPE_MARKER]: ENVELOPE_VERSION,
      alg: algorithm,
      kek: this.policy.keyNameFor(tier),
      tier,
      dek: encode(wrappedDek),
      dekIv: encode(dekIv),
      dekTag: encode(dekTag),
      iv: encode(iv),
      tag: encode(tag),
      ct: encode(ct),
      bindingHash: createHash('sha256').update(aad).digest('base64url'),
      sealedAt: new Date().toISOString(),
    };
  }

  /**
   * يفكّ غلافاً. يشترط أن يكون غلافاً فعلاً — نصٌّ صريح في موضع الغلاف **لا
   * يُعاد** بل يُرفض بـ`ENCRYPTION_PLAINTEXT_AT_REST`، لأن إعادته كانت ستجعل
   * إسقاط التشفير مساراً صامتاً يعمل.
   * @param {{ envelope: unknown, binding: Record<string, string>, classification?: string }} request
   * @returns {Promise<unknown>}
   */
  async open({ envelope, binding, classification }) {
    if (!isSealedEnvelope(envelope)) {
      throw new EncryptionError(
        ENCRYPTION_ERRORS.PLAINTEXT_AT_REST,
        'المادة في المخزون ليست غلافاً مشفَّراً. لا تُعاد نصّاً: من أسقط التشفير — بترحيلٍ ناقص أو كتابةٍ من خارج الكود — يجب أن يُخفق عند القراءة لا أن ينجح صامتاً.',
      );
    }
    const sealed = /** @type {SealedEnvelope} */ (envelope);
    if (
      sealed[ENVELOPE_MARKER] !== ENVELOPE_VERSION ||
      sealed.alg !== this.policy.cipher.algorithm
    ) {
      throw new EncryptionError(
        ENCRYPTION_ERRORS.ENVELOPE_INVALID,
        `غلافٌ بإصدار «${String(sealed[ENVELOPE_MARKER])}» ومعمّى «${String(sealed.alg)}» لا يطابق المعلَن (${ENVELOPE_VERSION}/${this.policy.cipher.algorithm}). لا يُفكّ بمعمّى مختلف عن معمّاه.`,
      );
    }
    if (classification !== undefined) {
      const expected = this.lattice.normalize(classification);
      if (expected !== null && expected !== sealed.tier) {
        throw new EncryptionError(
          ENCRYPTION_ERRORS.ENVELOPE_TIER_MISMATCH,
          `غلافٌ مبنيٌّ بمفتاح مرتبة «${sealed.tier}» ومادّته مصنَّفة اليوم «${expected}». إعادةُ التصنيف تُوجب إعادة التغليف بمفتاح المرتبة الجديدة، وهذا المسار غير موصول بعد — فيُرفض الفكّ ولا يُقرأ السيادي بمفتاح مرتبةٍ أدنى.`,
        );
      }
    }
    const aad = Buffer.from(bindingString(binding), 'utf8');
    const expectedHash = createHash('sha256').update(aad).digest('base64url');
    const givenHash = String(sealed.bindingHash ?? '');
    if (
      givenHash.length !== expectedHash.length ||
      !timingSafeEqual(Buffer.from(givenHash), Buffer.from(expectedHash))
    ) {
      throw new EncryptionError(
        ENCRYPTION_ERRORS.ENVELOPE_TAMPERED,
        'ربطُ الغلاف لا يطابق هويّة الصفّ الذي يسكنه: معمّى نُقل من صفٍّ إلى صفٍّ، أو صفٌّ عُدّلت هويّته. لا يُفكّ.',
      );
    }

    const kek = await this.#kek(sealed.tier);
    const { algorithm } = this.policy.cipher;
    /** @type {Buffer} */
    let dek;
    try {
      const unwrapper = createDecipheriv(algorithm, kek, decode(sealed.dekIv, 'dekIv'));
      unwrapper.setAAD(aad);
      unwrapper.setAuthTag(decode(sealed.dekTag, 'dekTag'));
      dek = Buffer.concat([unwrapper.update(decode(sealed.dek, 'dek')), unwrapper.final()]);
    } catch (error) {
      if (error instanceof EncryptionError) throw error;
      throw new EncryptionError(
        ENCRYPTION_ERRORS.ENVELOPE_TAMPERED,
        'فكّ مفتاح المدخل أخفق: الغلاف أو ربطُه أو مفتاح المرتبة غير متطابقين. والرسالة لا تفصّل أيّها، فتفصيلُها يهدي من يجرّب.',
      );
    }
    try {
      const decipher = createDecipheriv(algorithm, dek, decode(sealed.iv, 'iv'));
      decipher.setAAD(aad);
      decipher.setAuthTag(decode(sealed.tag, 'tag'));
      const plain = Buffer.concat([
        decipher.update(decode(sealed.ct, 'ct')),
        decipher.final(),
      ]).toString('utf8');
      return /** @type {{ value: unknown }} */ (JSON.parse(plain)).value;
    } catch (error) {
      if (error instanceof EncryptionError) throw error;
      throw new EncryptionError(
        ENCRYPTION_ERRORS.ENVELOPE_TAMPERED,
        'فكّ المادة أخفق بعد فكّ مفتاحها: المعمّى أو وسمُه مُعدَّل. المصادقة هي ما جعل التعديل يُكشف بدل أن يُعاد نصّاً محرَّفاً.',
      );
    } finally {
      dek.fill(0);
    }
  }
}

/**
 * هل هذه القيمة غلافٌ مشفَّر بشكله المُعلَن؟ فحصُ الشكل قبل أي محاولة فكّ، وهو
 * نفس الفحص الذي يفرضه قيد القاعدة `memories_content_sealed`.
 * @param {unknown} value
 * @returns {boolean}
 */
export function isSealedEnvelope(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = /** @type {Record<string, unknown>} */ (value);
  if (typeof candidate[ENVELOPE_MARKER] !== 'number') return false;
  for (const field of ['alg', 'kek', 'tier', 'dek', 'dekIv', 'dekTag', 'iv', 'tag', 'ct']) {
    if (typeof candidate[field] !== 'string' || candidate[field] === '') return false;
  }
  // `value` هو حقل النصّ الصريح في الشكل القديم؛ وجودُه مع الغلاف يعني نصّاً
  // باقياً بجانب معمّاه، وهو أسوأ الحالتين: تشفيرٌ يُقرأ كأنه قائم والمادة مكشوفة.
  return !('value' in candidate);
}

/**
 * **فحص القبول** لهذه الخطوة: «صفر بيانات مصنَّفة مخزَّنة بلا تشفير». يُنادى من
 * الحاجب على مخزون القاعدة، ومن الاختبارات على مخزون حقيقي كُتب لحظتَه.
 *
 * ولا يعدّ «ما لم يُشفَّر» فقط: يعدّ أيضاً من غُلِّف بمفتاح مرتبةٍ لا تطابق
 * تصنيف أصله اليوم — لأن غلافاً بمفتاح `internal` لمادةٍ صارت `sovereign` هو
 * سيادي محمي بمفتاح داخلي.
 * @param {{ rows: Array<{ id: string, content: unknown, classification?: string | null }>, store?: string }} input
 * @returns {{ scanned: number, violations: Array<{ id: string, reason: string }> }}
 */
export function scanForPlaintextAtRest({ rows, store = 'state.memories' }) {
  /** @type {Array<{ id: string, reason: string }>} */
  const violations = [];
  for (const row of rows) {
    if (!isSealedEnvelope(row.content)) {
      violations.push({
        id: row.id,
        reason: `مادة مخزَّنة بلا غلاف مشفَّر في ${store}`,
      });
      continue;
    }
    const sealed = /** @type {SealedEnvelope} */ (row.content);
    if (
      row.classification !== undefined &&
      row.classification !== null &&
      row.classification !== sealed.tier
    ) {
      violations.push({
        id: row.id,
        reason: `غلافٌ بمفتاح مرتبة «${sealed.tier}» ومادّته مصنَّفة «${row.classification}» في ${store}`,
      });
    }
  }
  return { scanned: rows.length, violations };
}

/**
 * يشترط نقلاً مشفَّراً إلى أي مضيف غير محلي — **في كل بيئة**. القاعدة القائمة
 * كانت تشترط TLS في الإنتاج وحده، فبيئةٌ اسمها `staging` تحمل بيانات حقيقية
 * كانت تنقلها نصّاً على الشبكة؛ والاسمُ ليس هو ما يحمي الأسلاك.
 * @param {{ host: string, tls: boolean, environment?: string, policy: EncryptionPolicy }} input
 * @returns {void}
 * @throws {EncryptionError} `ENCRYPTION_TRANSPORT_INSECURE`
 */
export function assertSecureTransport({ host, tls, environment = 'development', policy }) {
  if (tls) return;
  const loopback = policy.transport.loopbackHosts.includes(host);
  if (loopback && policy.transport.allowPlaintextToLoopback && !isProductionLike(environment)) {
    return;
  }
  throw new EncryptionError(
    ENCRYPTION_ERRORS.TRANSPORT_INSECURE,
    loopback
      ? `وصلةٌ بلا TLS إلى ${host} في بيئة «${environment}»: الاستثناء المحلي للتطوير وحده، والإنتاج لا يُستثنى ولو كان المضيف محلياً.`
      : `وصلةٌ بلا TLS إلى مضيف غير محلي (${host}): بياناتٌ مصنَّفة تُنقل نصّاً على الشبكة. أضف sslmode=require — والشرط في كل بيئة لا في الإنتاج وحده، فاسم البيئة لا يحمي الأسلاك.`,
  );
}

/**
 * @param {string} environment
 * @returns {boolean}
 */
function isProductionLike(environment) {
  return environment === 'production';
}

/**
 * يختار مزوّد مفاتيح البيانات **من البيئة** لا من الكود — نفس عقد
 * `kingKeyProviderFromEnv` في جذر الثقة، فلا يُعدَّل كودٌ للانتقال من التطوير
 * إلى الإنتاج، ولا يسقط قرصُ التطوير إلى الإنتاج سهواً.
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {import('../root-of-trust/key-provider.mjs').KeyProvider}
 */
export function dataKeyProviderFromEnv(env = process.env) {
  const production = (env.STATE_ENV ?? env.NODE_ENV) === 'production';
  const endpoint = env.DATA_KEY_STORE_ENDPOINT;
  const token = env.DATA_KEY_STORE_TOKEN;
  if (endpoint !== undefined && endpoint !== '' && token !== undefined && token !== '') {
    const timeout = Number(env.DATA_KEY_STORE_TIMEOUT_MS ?? '');
    return new RemoteSecretStoreKeyProvider({
      endpoint,
      token,
      ...(Number.isFinite(timeout) && timeout > 0 ? { timeoutMs: timeout } : {}),
      allowInsecureTransport: !production && env.DATA_KEY_STORE_ALLOW_INSECURE === 'true',
    });
  }
  const directory = env.DATA_KEY_DIR;
  const master = env.DATA_KEY_MASTER;
  if (directory !== undefined && directory !== '' && master !== undefined && master !== '') {
    if (production) {
      throw new EncryptionError(
        ENCRYPTION_ERRORS.PROVIDER_NOT_PRODUCTION_READY,
        'قرصٌ محلي مشفَّر مرفوض في الإنتاج: مادةُ المفتاح تقيم على قرص الخدمة نفسها التي تحمل المعمّى، فمن حمل القرص حمل الاثنين.',
      );
    }
    return new LocalEncryptedKeyProvider(directory, master);
  }
  throw new EncryptionError(
    ENCRYPTION_ERRORS.KEY_STORE_NOT_CONFIGURED,
    'مزوّد مفاتيح البيانات غير معلَن: أعلن DATA_KEY_STORE_ENDPOINT وDATA_KEY_STORE_TOKEN، أو DATA_KEY_DIR وDATA_KEY_MASTER للتطوير. ولا سقوط إلى مفتاح مولَّد في الذاكرة: كان سيُنتج مفتاحاً جديداً كل إقلاع فتصير كل ذاكرةٍ قديمة غير قابلة للفكّ.',
  );
}
