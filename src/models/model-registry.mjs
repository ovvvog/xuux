import { createHash, randomUUID } from 'node:crypto';

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
    return Object.freeze({ ...record });
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
    m.reason = reason;
    m.changedAt = new Date().toISOString();
    this.log.append(`model.${state}`, 'crown', { id, reason });
    return Object.freeze({ ...m });
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
    return Object.freeze({ ...m });
  }
  /**
   * النموذج النشط لغرض معيّن.
   * @param {string} purpose
   * @returns {ModelRecord | null | undefined} `null` إن لم يُفعَّل شيء لهذا الغرض،
   *   و`undefined` إن كانت الخريطة تشير إلى معرّف غير موجود في السجل. الفرق
   *   بين القيمتين مقصود في التوصيف لأنه واقع الدالة الحالي، وهو خلل مسجَّل
   *   للمعالجة في M2.01 لا يُصلَح هنا لأن إصلاحه تغيير سلوك لا توصيف نوع.
   */
  getActive(purpose) {
    const id = this.activeByPurpose.get(purpose);
    return id ? this.models.get(id) : null;
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
