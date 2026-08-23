import { createHash, randomUUID } from 'node:crypto';
import { snapshot } from '../lib/snapshot.mjs';

/**
 * حالة النموذج، مشتقة من الكائن المُجمَّد فلا تنحرف عنه.
 * @typedef {(typeof ModelState)[keyof typeof ModelState]} ModelStateValue
 */

/**
 * سجل نموذج. `digest` بصمة الأوزان وقت التسجيل، وهي مرجع التحقّق لاحقاً.
 * @typedef {object} ModelRecord
 * @property {string} id
 * @property {string} name
 * @property {string} version
 * @property {string} purpose - الغرض؛ لكل غرض نموذج نشط واحد على الأكثر
 * @property {string} source
 * @property {string} digest
 * @property {string[]} capabilities
 * @property {ModelStateValue} state
 * @property {string} createdAt
 * @property {string | undefined} [reason] - سبب آخر انتقال، يُكتب كما ورد ولو غاب
 * @property {string} [changedAt]
 */

/**
 * ناتج تشغيل في الصندوق المعزول. الشبكة والكتابة معطّلتان بالإعلان، وهذا
 * الإعلان هو ما تتحقّق منه البوابات لاحقاً.
 * @typedef {object} SandboxRun
 * @property {string} modelId
 * @property {string} inputHash
 * @property {number} timeoutMs
 * @property {'disabled'} network
 * @property {'disabled'} writes
 * @property {string} output
 */

export const ModelState = Object.freeze({
  REGISTERED: 'registered',
  SANDBOXED: 'sandboxed',
  APPROVED: 'approved',
  SUSPENDED: 'suspended',
  ROLLED_BACK: 'rolled-back',
});
const FORBIDDEN_CAPABILITIES = new Set([
  'self-modify',
  'spawn-unbounded',
  'external-write',
  'bypass-crown',
]);
export class ModelRegistry {
  /**
   * السجل اختياري في النوع لأن التوقيع يقبل الاستدعاء بلا وسائط ويردّ بخطأ
   * مُسمّى `MODEL_REGISTRY_DEPENDENCY_MISSING`؛ التحقّق بعده يضيّق النوع.
   * @param {{ log?: import('../root-of-trust/event-log.mjs').EventLog, maxModels?: number }} [deps]
   */
  constructor({ log, maxModels = 10000 } = {}) {
    if (!log) throw new Error('MODEL_REGISTRY_DEPENDENCY_MISSING');
    this.log = log;
    this.maxModels = maxModels;
    /** @type {Map<string, ModelRecord>} */
    this.models = new Map();
    /** @type {Map<string, string>} خريطة الغرض إلى معرّف النموذج النشط له */
    this.activeByPurpose = new Map();
  }
  /**
   * يسجّل نموذجاً ويحسب بصمة أوزانه. القدرات المحرّمة تُرفض قبل حساب البصمة،
   * فلا يدخل السجل نموذج بقدرة ممنوعة.
   * @param {object} manifest
   * @param {string} manifest.name
   * @param {string} manifest.version
   * @param {string} manifest.purpose
   * @param {string} manifest.source
   * @param {import('node:crypto').BinaryLike} manifest.weights
   * @param {string[]} [manifest.capabilities=[]]
   * @returns {Readonly<ModelRecord>}
   */
  register({ name, version, purpose, source, weights, capabilities = [] }) {
    if (!name || !version || !purpose || !source || !weights)
      throw new Error('MODEL_MANIFEST_REQUIRED');
    if (this.models.size >= this.maxModels) throw new Error('MODEL_QUOTA_EXCEEDED');
    if (capabilities.some((x) => FORBIDDEN_CAPABILITIES.has(x)))
      throw new Error('FORBIDDEN_MODEL_CAPABILITY');
    const digest = createHash('sha256').update(weights).digest('hex');
    const id = 'model:' + randomUUID();
    /** @type {ModelRecord} */
    const record = {
      id,
      name,
      version,
      purpose,
      source,
      digest,
      capabilities: [...capabilities],
      state: ModelState.REGISTERED,
      createdAt: new Date().toISOString(),
    };
    this.models.set(id, record);
    this.log.append('model.registered', 'crown', { id, name, version, digest });
    return snapshot(record);
  }
  /**
   * ينقل النموذج إلى حالة أخرى. المُرجَع عنه لا يُعاد تفعيله.
   * @param {string} id
   * @param {ModelStateValue} state
   * @param {string} [reason]
   * @returns {Readonly<ModelRecord>}
   */
  transition(id, state, reason) {
    const m = this.models.get(id);
    if (!m) throw new Error('MODEL_NOT_FOUND');
    if (!Object.values(ModelState).includes(state)) throw new Error('INVALID_MODEL_STATE');
    if (m.state === ModelState.ROLLED_BACK && state !== ModelState.ROLLED_BACK)
      throw new Error('ROLLED_BACK_MODEL_IMMUTABLE');
    m.state = state;
    // سببٌ غائب لا يُكتب فوق سببٍ معلن: `m.reason = undefined` كان يمحو سبب
    // الانتقال السابق فيبدو أن انتقالاً وقع بلا سبب قطّ. الحقل يبقى، ووقتُ
    // التغيير هو ما يتقدّم، والحدث يحمل السبب كما ورد أو غيابه.
    if (reason !== undefined) m.reason = reason;
    m.changedAt = new Date().toISOString();
    this.log.append(`model.${state}`, 'crown', { id, reason });
    // العيب `D3`: مؤشّر «النشط لهذا الغرض» لم يكن يُنظَّف، فنموذجٌ عُلِّق أو
    // أُرجع عنه يبقى **هو النشط** لغرضه — تجاوزٌ للبوابة لا يحتاج مستدعياً
    // سيّئاً، يكفي أن يُعلَّق نموذج ثم يُسأل السجل. والعودة إلى الخدمة قرارٌ
    // يُعلن بـ`activate` لا أثرٌ جانبي لانتقال حالة.
    if (state !== ModelState.APPROVED && this.activeByPurpose.get(m.purpose) === id) {
      this.activeByPurpose.delete(m.purpose);
      this.log.append('model.deactivated', 'crown', { id, purpose: m.purpose, state, reason });
    }
    return snapshot(m);
  }
  /**
   * يجعل نموذجاً معتمداً هو النشط لغرضه. غير المعتمد لا يُفعَّل.
   * @param {string} id
   * @returns {Readonly<ModelRecord>}
   */
  activate(id) {
    const m = this.models.get(id);
    if (!m || m.state !== ModelState.APPROVED) throw new Error('MODEL_NOT_APPROVED');
    const previous = this.activeByPurpose.get(m.purpose);
    this.activeByPurpose.set(m.purpose, id);
    this.log.append('model.activated', 'crown', { id, purpose: m.purpose, previous });
    return snapshot(m);
  }
  /**
   * النموذج النشط لغرض معيّن، **صورةً عميقة مُجمَّدة**.
   *
   * كانت هذه الدالة تُرجع المرجع الداخلي غير مُجمَّد (العيب `D4`)، فمن نادى
   * `getActive` قدر أن يُغيّر حالة النموذج بيده متجاوزاً `transition` كلها —
   * بوابةٌ تُحرَس من الأمام وبابها الخلفي مفتوح. وكانت تخلط `null` بـ`undefined`
   * فلا يفرّق المستدعي بين **فراغ** (لا نشط لهذا الغرض) وبين **فساد حالة**
   * (مؤشّرٌ يشير إلى معرّف غير موجود) — والفساد الذي يُقرأ فراغاً يُبنى عليه.
   * فصار الفراغ `null` صريحة، والفساد خطأً مُسمّى يفشل مُغلقاً.
   * @param {string} purpose
   * @returns {Readonly<ModelRecord> | null} `null` إن لم يُفعَّل شيء لهذا الغرض
   * @throws {Error} `MODEL_ACTIVE_POINTER_DANGLING` إن أشار المؤشّر إلى معرّف غير
   *   موجود، و`MODEL_ACTIVE_NOT_APPROVED` إن كان المشار إليه غير معتمد
   */
  getActive(purpose) {
    const id = this.activeByPurpose.get(purpose);
    if (id === undefined) return null;
    const m = this.models.get(id);
    if (!m) throw new Error('MODEL_ACTIVE_POINTER_DANGLING');
    // حرسُ ثباتٍ لا يقع في المسار العادي بعد إصلاح `D3`؛ وموضعه هنا لأن الفشل
    // المُغلق لا يُبنى على ثقةٍ بأن المسار العادي هو المسار الوحيد.
    if (m.state !== ModelState.APPROVED) throw new Error('MODEL_ACTIVE_NOT_APPROVED');
    return snapshot(m);
  }
  /**
   * يقارن بصمة أوزان مُقدَّمة ببصمة وقت التسجيل.
   * @param {string} id
   * @param {import('node:crypto').BinaryLike} weights
   * @returns {boolean}
   */
  verifyWeights(id, weights) {
    const m = this.models.get(id);
    if (!m) throw new Error('MODEL_NOT_FOUND');
    return createHash('sha256').update(weights).digest('hex') === m.digest;
  }
}
export class ModelSandbox {
  /**
   * يشغّل نموذجاً في عزل معلَن. غير المعزول وغير المعتمد لا يُشغَّل.
   * @param {Pick<ModelRecord, 'id' | 'state'>} model
   * @param {unknown} input
   * @param {{ timeoutMs?: number }} [options]
   * @returns {SandboxRun}
   */
  run(model, input, { timeoutMs = 1000 } = {}) {
    if (model.state !== ModelState.SANDBOXED && model.state !== ModelState.APPROVED)
      throw new Error('MODEL_NOT_SANDBOXED');
    return {
      modelId: model.id,
      inputHash: createHash('sha256').update(JSON.stringify(input)).digest('hex'),
      timeoutMs,
      network: 'disabled',
      writes: 'disabled',
      output: 'sandbox-result',
    };
  }
}
