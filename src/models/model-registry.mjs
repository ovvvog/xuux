import { createHash, randomUUID } from 'node:crypto';
import { MODEL_SPEC } from '../persistence/entities.mjs';
import { ExperimentLedger } from '../knowledge/experiment-ledger.mjs';
import { ModelEvaluationError, ModelEvaluationLedger } from './evaluation.mjs';

/**
 * سجل النماذج — صار **دائماً** في الخطوة `M3.05`.
 *
 * كان `Map` في الذاكرة، ومعه `Map` ثانية للنشط لكل غرض. إعادة التشغيل كانت تمحو
 * النموذجَ المعتمد وبصمة أوزانه معاً، فيُعاد رفع أوزانٍ لا مرجع للتحقق منها.
 * صار المخزن مستودعاً، و«النشط لهذا الغرض» صار عموداً `is_active` تحرسه القاعدة
 * بفهرس جزئي فريد (`models_one_active_per_purpose_idx`) — أي أن قيد «نموذج نشط
 * واحد لكل غرض» لم يبقَ اتفاقاً في الكود بل صار قيداً في القاعدة يرفض المخالف
 * ولو كتب فيها غير هذا الكود.
 *
 * **حدٌّ معلن:** كل العمليات صارت `async`، وحقل نسخة النموذج صار `modelVersion`
 * لأن `version` صار محجوزاً للقفل المتفائل في المستودع. هذا تغييرٌ في العقد
 * أُصلح معه كل مستدعٍ في هذه الخطوة.
 */

/**
 * حالة النموذج، مشتقة من الكائن المُجمَّد فلا تنحرف عنه.
 * @typedef {(typeof ModelState)[keyof typeof ModelState]} ModelStateValue
 */

/**
 * سجل نموذج كما يعود من المستودع. `fingerprint` بصمة الأوزان وقت التسجيل، وهي
 * مرجع التحقّق لاحقاً. `version` نسخة القفل المتفائل، و`modelVersion` نسخة
 * النموذج المُعلنة.
 * @typedef {object} ModelRecord
 * @property {string} id
 * @property {string} name
 * @property {string} provider - جهة النموذج ومصدره
 * @property {string} modelVersion
 * @property {string} purpose - الغرض؛ لكل غرض نموذج نشط واحد على الأكثر
 * @property {string} fingerprint
 * @property {string[]} capabilities
 * @property {ModelStateValue} state
 * @property {boolean} isActive
 * @property {string | null} approvedBy
 * @property {string | null} stateReason
 * @property {Date | null} stateChangedAt
 * @property {number} version
 * @property {Date} createdAt
 * @property {Date} updatedAt
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

/**
 * عقد المستودع الذي يحتاجه هذا السجل.
 * @typedef {object} ModelRepository
 * @property {(record: Record<string, unknown>) => Promise<Record<string, unknown>>} insert
 * @property {(id: string) => Promise<Record<string, unknown> | null>} findById
 * @property {(query?: { filter?: Record<string, unknown>, limit?: number }) => Promise<Array<Record<string, unknown>>>} list
 * @property {(filter?: Record<string, unknown>) => Promise<number>} count
 * @property {(id: string, expectedVersion: number, patch: Record<string, unknown>) => Promise<Record<string, unknown>>} update
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

/**
 * @param {Record<string, unknown>} row
 * @returns {ModelRecord}
 */
function toModel(row) {
  return /** @type {ModelRecord} */ (/** @type {unknown} */ (Object.freeze({ ...row })));
}

export class ModelRegistry {
  /**
   * الاعتماديات اختيارية في النوع لأن التوقيع يقبل الاستدعاء بلا وسائط ويردّ
   * بخطأ مُسمّى `MODEL_REGISTRY_DEPENDENCY_MISSING`؛ التحقّق بعده يضيّق النوع.
   * @param {{ log?: import('../root-of-trust/event-log.mjs').EventLog, repository?: ModelRepository, maxModels?: number, transaction?: import('../persistence/composition.mjs').StateTransaction | null, weightStore?: import('./weight-store.mjs').WeightStore | null, evaluationLedger?: import('./evaluation.mjs').ModelEvaluationLedger | null, quarantine?: { report: (signal: object) => unknown } | null }} [deps]
   */
  constructor({
    log,
    repository,
    maxModels = 10000,
    transaction = null,
    weightStore = null,
    evaluationLedger = null,
    quarantine = null,
  } = {}) {
    if (!log || !repository) throw new Error('MODEL_REGISTRY_DEPENDENCY_MISSING');
    this.log = log;
    /**
     * مخزن الأوزان المعنوَن بالمحتوى (M6.06). بغيره لا يُنشَّط نموذج: التنشيط
     * بلا إعادة حساب البصمة ثقةٌ بوصفٍ محفوظ، وهو ما كان العيب.
     * @type {import('./weight-store.mjs').WeightStore | null}
     */
    this.weightStore = weightStore;
    /**
     * سجل التقييم شرط تنشيط لا تحسين اختياري. يُنشأ سجل ذاكرة عند عدم حقنه،
     * فتظل النتيجة المفقودة رفضاً صريحاً ولا يصبح تركيبٌ ناقص طريقاً جانبياً.
     * تمرّر طبقة التشغيل سجلاً دائماً حين تحتاج النتيجة إلى عبور إعادة التشغيل.
     *
     * ومنذ `M7.08` لا يُبنى سجلُّ التقييم بلا سجل تجارب (البند ME-3)، فالسجلُّ
     * الافتراضيُّ هنا يحمل سجلَّ تجاربَ في الذاكرة: لا نتيجةَ بلا تجربةٍ مسجَّلة،
     * ولا تنشيطَ بلا نتيجة. والذاكرةُ حدٌّ معلَن: تجاربُ هذا السجل لا تعبر إعادةَ
     * التشغيل إلا إذا مرّرت طبقةُ التركيب سجلاً بملفّ.
     * @type {import('./evaluation.mjs').ModelEvaluationLedger}
     */
    this.evaluationLedger =
      evaluationLedger ??
      new ModelEvaluationLedger({ log, experiments: new ExperimentLedger({ log }) });
    /** @type {{ report: (signal: object) => unknown } | null} */
    this.quarantine = quarantine;
    /** @type {ModelRepository} */
    this.repository = repository;
    this.maxModels = maxModels;
    /**
     * مُشغّل معاملة يُمرَّر من طبقة التركيب (`M3.06`). إن كان `null` فالتفعيل
     * كتابتان غير ذرّيتين — حدٌّ معلن لا مسكوتٌ عنه.
     * @type {import('../persistence/composition.mjs').StateTransaction | null}
     */
    this.transaction = transaction;
  }

  /** @returns {import('../persistence/entities.mjs').EntitySpec} */
  static get spec() {
    return MODEL_SPEC;
  }

  /**
   * يسجّل نموذجاً ويحسب بصمة أوزانه. القدرات المحرّمة تُرفض قبل حساب البصمة،
   * فلا يدخل السجل نموذج بقدرة ممنوعة.
   * @param {object} manifest
   * @param {string} manifest.name
   * @param {string} manifest.modelVersion
   * @param {string} manifest.purpose
   * @param {string} manifest.provider
   * @param {import('node:crypto').BinaryLike} manifest.weights
   * @param {string[]} [manifest.capabilities=[]]
   * @returns {Promise<ModelRecord>}
   */
  async register({ name, modelVersion, purpose, provider, weights, capabilities = [] }) {
    if (!name || !modelVersion || !purpose || !provider || !weights)
      throw new Error('MODEL_MANIFEST_REQUIRED');
    if ((await this.repository.count()) >= this.maxModels) throw new Error('MODEL_QUOTA_EXCEEDED');
    if (capabilities.some((x) => FORBIDDEN_CAPABILITIES.has(x)))
      throw new Error('FORBIDDEN_MODEL_CAPABILITY');
    const fingerprint = createHash('sha256').update(weights).digest('hex');
    // الأوزان تُخزَّن معنوَنةً بمحتواها كي تُعاد قراءتها عند كل تنشيط (M6.06).
    if (this.weightStore !== null) {
      const stored = this.weightStore.put(weights);
      if (stored !== fingerprint) throw new Error('MODEL_FINGERPRINT_MISMATCH');
    }
    const id = 'model:' + randomUUID();
    const row = await this.repository.insert({
      id,
      name,
      provider,
      modelVersion,
      purpose,
      fingerprint,
      capabilities: [...capabilities],
      state: ModelState.REGISTERED,
      isActive: false,
    });
    this.log.append('model.registered', 'crown', { id, name, modelVersion, fingerprint });
    return toModel(row);
  }

  /**
   * ينقل النموذج إلى حالة أخرى. المُرجَع عنه لا يُعاد تفعيله.
   *
   * العيب `D3` كان: مؤشّر «النشط لهذا الغرض» لا يُنظَّف، فنموذجٌ عُلِّق أو أُرجع
   * عنه يبقى **هو النشط** لغرضه. الإصلاح باقٍ هنا، لكنه صار **كتابةً في عمود**:
   * إسقاط `is_active` عند الخروج من الاعتماد. والعودة إلى الخدمة قرارٌ يُعلن
   * بـ`activate` لا أثرٌ جانبي لانتقال حالة.
   * @param {string} id
   * @param {ModelStateValue} state
   * @param {string} [reason]
   * @returns {Promise<ModelRecord>}
   */
  async transition(id, state, reason) {
    const row = await this.repository.findById(id);
    if (row === null) throw new Error('MODEL_NOT_FOUND');
    const current = toModel(row);
    if (!Object.values(ModelState).includes(state)) throw new Error('INVALID_MODEL_STATE');
    if (current.state === ModelState.ROLLED_BACK && state !== ModelState.ROLLED_BACK)
      throw new Error('ROLLED_BACK_MODEL_IMMUTABLE');
    const deactivating = state !== ModelState.APPROVED && current.isActive;
    /** @type {Record<string, unknown>} */
    const patch = {
      state,
      stateChangedAt: new Date(),
      // القاعدة تحرس: `models_active_must_be_approved` يرفض نشطاً غير معتمد،
      // فالإسقاط هنا ليس تجميلاً بل شرط قبول الكتابة.
      isActive: state === ModelState.APPROVED ? current.isActive : false,
    };
    // سببٌ غائب لا يُكتب فوق سببٍ معلن: محوُ سبب الانتقال السابق يُظهر انتقالاً
    // وقع بلا سبب قطّ. فلا يُلمس الحقل إلا إن ورد سبب.
    if (reason !== undefined) patch['stateReason'] = reason;
    // الاعتماد لا يُعلن بلا معتمِد مسمّى (قيد `models_approval_has_approver`)،
    // والسلطة الوحيدة المعلنة في هذه المرحلة هي التاج.
    if (state === ModelState.APPROVED && current.approvedBy === null) patch['approvedBy'] = 'crown';
    const updated = await this.repository.update(id, current.version, patch);
    this.log.append(`model.${state}`, 'crown', { id, reason });
    if (deactivating) {
      this.log.append('model.deactivated', 'crown', {
        id,
        purpose: current.purpose,
        state,
        reason,
      });
    }
    return toModel(updated);
  }

  /**
   * يجعل نموذجاً معتمداً هو النشط لغرضه. غير المعتمد لا يُفعَّل.
   *
   * **حدٌّ معلن:** التفعيل كتابتان — إسقاط النشط السابق ثم رفع الجديد — لأن
   * الفهرس الفريد الجزئي يرفض نشطين لغرض واحد ولو للحظة. والترتيب مقصود: إن
   * انقطع التنفيذ بين الكتابتين بقي الغرض **بلا نشط**، وهذا فشل مُغلق لا
   * تجاوزٌ للبوابة. وقد رُبطتا في معاملة واحدة في `M3.06`: إن مُرِّر مُشغّل
   * معاملة فالكتابتان كلّهما أو لا شيء، وإن لم يُمرَّر (مستودع ذاكرة) بقي الحدّ
   * كما هو معلناً.
   * @param {string} id
   * @returns {Promise<ModelRecord>}
   */
  async activate(id) {
    if (this.transaction === null) return this.#activate(id);
    return this.transaction(
      /** @param {import('../persistence/composition.mjs').StateRegistries} registries */
      (registries) => registries.models.#activate(id),
    );
  }

  /**
   * جسم التفعيل بلا معاملة — يُنادى مباشرةً أو داخل وحدة عمل.
   * @param {string} id
   * @returns {Promise<ModelRecord>}
   */
  async #activate(id) {
    const model = await this.assertActivatable(id);
    const previous = await this.getActive(model.purpose);
    if (previous !== null && previous.id === id) return model;
    if (previous !== null) {
      await this.repository.update(previous.id, previous.version, { isActive: false });
    }
    const updated = toModel(await this.repository.update(id, model.version, { isActive: true }));
    this.log.append('model.activated', 'crown', {
      id,
      purpose: model.purpose,
      previous: previous === null ? undefined : previous.id,
    });
    return updated;
  }

  /**
   * النموذج النشط لغرض معيّن.
   *
   * كانت هذه الدالة تُرجع المرجع الداخلي غير مُجمَّد (العيب `D4`)، وكانت تخلط
   * `null` بـ`undefined` فلا يفرّق المستدعي بين **فراغ** (لا نشط لهذا الغرض)
   * وبين **فساد حالة**. فصار الفراغ `null` صريحة، والفساد خطأً مُسمّى يفشل
   * مُغلقاً. والفساد نفسه صار أصعب: القاعدة ترفض أكثر من نشط لغرض.
   * @param {string} purpose
   * @returns {Promise<ModelRecord | null>} `null` إن لم يُفعَّل شيء لهذا الغرض
   * @throws {Error} `MODEL_ACTIVE_AMBIGUOUS` إن وُجد أكثر من نشط لغرض واحد،
   *   و`MODEL_ACTIVE_NOT_APPROVED` إن كان النشط غير معتمد
   */
  async getActive(purpose) {
    const rows = await this.repository.list({ filter: { purpose, isActive: true } });
    if (rows.length === 0) return null;
    if (rows.length > 1) throw new Error('MODEL_ACTIVE_AMBIGUOUS');
    const model = toModel(/** @type {Record<string, unknown>} */ (rows[0]));
    // حرسُ ثباتٍ لا يقع في المسار العادي؛ وموضعه هنا لأن الفشل المُغلق لا يُبنى
    // على ثقةٍ بأن المسار العادي هو المسار الوحيد إلى الجدول.
    if (model.state !== ModelState.APPROVED) throw new Error('MODEL_ACTIVE_NOT_APPROVED');
    return model;
  }

  /**
   * يتحقق من كل بوابات التفعيل بلا كتابة. يستعمله التراجع قبل إرجاع الحالي، ثم
   * يعيد `activate` الفحص نفسه عند لحظة الكتابة فلا تتحول المعاينة إلى تصريح.
   * @param {string} id
   * @returns {Promise<ModelRecord>}
   */
  async assertActivatable(id) {
    const row = await this.repository.findById(id);
    if (row === null) throw new Error('MODEL_NOT_APPROVED');
    const model = toModel(row);
    if (model.state !== ModelState.APPROVED) throw new Error('MODEL_NOT_APPROVED');
    this.#verifyFingerprintOrRefuse(model);
    this.#verifyEvaluationOrRefuse(model);
    return model;
  }

  /**
   * النماذج المسجلة لغرض واحد، مرتبة كما يعيدها المستودع. يستعمله التراجع لاختيار
   * المعتمد السابق؛ لا يُعرض مخزن المستودع نفسه كي لا يُكتب حول بوابات السجل.
   * @param {string} purpose
   * @returns {Promise<ModelRecord[]>}
   */
  async listByPurpose(purpose) {
    const rows = await this.repository.list({ filter: { purpose } });
    return rows.map((row) => toModel(row));
  }

  /**
   * @param {string} id
   * @returns {Promise<ModelRecord | null>}
   */
  async get(id) {
    const row = await this.repository.findById(id);
    return row === null ? null : toModel(row);
  }

  /**
   * يفرض نتيجة تقييم ناجحة مرتبطة ببصمة الأوزان ذاتها. التقييم مفقود وفاشل هما
   * قراران مختلفان تشغيلياً، ولذلك يحمل كل منهما رمزاً مستقلاً ويُسجّل كلاهما.
   * @param {ModelRecord} model
   * @returns {void}
   */
  #verifyEvaluationOrRefuse(model) {
    const result = this.evaluationLedger.latestFor(model.id, model.fingerprint);
    if (result?.state === this.evaluationLedger.catalog.passedState) return;
    const code = result === null ? 'MODEL_EVALUATION_MISSING' : 'MODEL_EVALUATION_FAILED';
    const reason =
      code === 'MODEL_EVALUATION_MISSING'
        ? 'لا توجد نتيجة تقييم لهذه البصمة؛ اعتمادٌ بلا دليل لا يسمح بتنشيط النموذج.'
        : 'نتيجة التقييم لهذه البصمة فاشلة؛ لا تعوّضها حالة اعتماد يدوية.';
    this.log.append('model.activation-refused', 'crown', {
      id: model.id,
      fingerprint: model.fingerprint,
      code,
      evaluationState: result?.state ?? null,
      reason,
    });
    throw new ModelEvaluationError(code, reason);
  }

  /**
   * يعيد حساب بصمة الأوزان المخزَّنة قبل كل تنشيط — M6.06.
   *
   * الفحص قبل الكتابة لا بعدها: تنشيطٌ يُلغى لاحقاً يعني أن النموذج كان نشطاً
   * لحظةً، ولحظةٌ واحدة تكفي لاستدلالات. والرفض يُسجَّل ويُبلَّغ الحجر الصحّي
   * (M6.09): تبدّل أوزانٍ بعد الاعتماد شذوذٌ لا خطأ مستخدم.
   * @param {ModelRecord} model
   * @returns {void}
   */
  #verifyFingerprintOrRefuse(model) {
    if (this.weightStore === null) {
      this.log.append('model.activation-refused', 'crown', {
        id: model.id,
        code: 'MODEL_WEIGHT_STORE_MISSING',
      });
      throw new Error('MODEL_WEIGHT_STORE_MISSING');
    }
    try {
      const { bytes } = this.weightStore.verify(model.fingerprint);
      this.log.append('model.fingerprint-verified', 'crown', {
        id: model.id,
        fingerprint: model.fingerprint,
        bytes,
      });
    } catch (error) {
      const code = /** @type {{ code?: string }} */ (error).code ?? 'MODEL_FINGERPRINT_MISMATCH';
      this.log.append('model.activation-refused', 'crown', {
        id: model.id,
        code,
        fingerprint: model.fingerprint,
      });
      if (this.quarantine !== null) {
        this.quarantine.report({
          kind: 'model-fingerprint-mismatch',
          subject: model.id,
          detail: { code, fingerprint: model.fingerprint },
        });
      }
      // السبب يُرفق: رمز الخطأ للأتمتة والسبب الأصلي لمن يقرأ الأثر.
      throw new Error(code, { cause: error });
    }
  }

  /**
   * يقارن بصمة أوزان مُقدَّمة ببصمة وقت التسجيل.
   * @param {string} id
   * @param {import('node:crypto').BinaryLike} weights
   * @returns {Promise<boolean>}
   */
  async verifyWeights(id, weights) {
    const row = await this.repository.findById(id);
    if (row === null) throw new Error('MODEL_NOT_FOUND');
    return createHash('sha256').update(weights).digest('hex') === toModel(row).fingerprint;
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
