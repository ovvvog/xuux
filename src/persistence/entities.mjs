/**
 * عقود السجلات ومواصفاتها — الخطوة `M3.04`.
 *
 * المواصفة الواحدة هي مصدر الحقيقة لتطبيقَي المستودع كليهما: تطبيق الذاكرة
 * وتطبيق PostgreSQL. والسبب أن تطبيق الذاكرة إن كان **أرخى** من القاعدة صار
 * اختباراً يُطمئن كذباً: يمرّ في الذاكرة ويسقط في الإنتاج. فالتحقّق مكتوب مرة
 * واحدة هنا، ويسري على الاثنين، ويحرسه ملف اختبار عقد واحد يُشغَّل عليهما.
 *
 * والقاعدة تبقى الحرس الأخير: قيود `CHECK` و`UNIQUE` في `migrations/0001` تمنع
 * ما يمنعه هذا الملف حتى لو كتب أحدٌ في الجدول بلا مستودع.
 *
 * **حدٌّ معلن:** الأنواع هنا مواصفة تُفحص وقت التشغيل، لا أنواعاً ثابتة لكل سجل
 * على حدة؛ والسجلات القائمة صارت تُبنى عليها في `M3.05` لكن أنواعها الساكنة ما
 * زالت مشتقّة من `EntityRecord` العام.
 *
 * والمواصفات هنا **صحَّحت** ما كتبه المخطَّط الأول على الورق: الحقول التي يحملها
 * كل سجل فعلي (دورُ الوكيل ومالكه وشهادته، ومصدر أصل البيانات واشتقاقه وجودته،
 * ونطاق القانون ومُقترِحه) أُضيفت في الهجرة `0002` وأُعلنت هنا، وقوائم الحالات
 * صارت هي حالات الكود لا قوائم مُختلقة. من أراد الحكاية كاملة فليقرأ رأس
 * `migrations/0002_align_domain_records.up.sql`.
 */

/** @typedef {Record<string, unknown>} EntityRecord */

/**
 * @typedef {object} FieldSpec
 * @property {string} column اسم العمود في القاعدة.
 * @property {'string' | 'enum' | 'stringArray' | 'integer' | 'boolean' | 'timestamp' | 'json'} type
 * @property {boolean} [required] إلزامي عند الإدخال.
 * @property {boolean} [nullable] يُقبل فراغه صراحةً.
 * @property {boolean} [managed] يديره المستودع لا المستدعي (النسخة والتواريخ).
 * @property {readonly string[]} [values] القيم المسموحة لنوع `enum`.
 * @property {number} [maxLength]
 */

/**
 * @typedef {object} EntitySpec
 * @property {string} name
 * @property {string} table
 * @property {Readonly<Record<string, FieldSpec>>} fields
 * @property {readonly (readonly string[])[]} unique مجموعات الحقول الفريدة (غير المفتاح).
 * @property {readonly string[]} filterable الحقول التي يُسمح بالترشيح بها.
 * @property {ReadonlyArray<{ code: string, check: (record: EntityRecord) => boolean, message: string }>} invariants
 */

export const REPOSITORY_ERRORS = Object.freeze({
  INVALID_RECORD: 'REPOSITORY_INVALID_RECORD',
  DUPLICATE_ID: 'REPOSITORY_DUPLICATE_ID',
  DUPLICATE_UNIQUE: 'REPOSITORY_DUPLICATE_UNIQUE',
  NOT_FOUND: 'REPOSITORY_NOT_FOUND',
  VERSION_CONFLICT: 'REPOSITORY_VERSION_CONFLICT',
  UNKNOWN_FIELD: 'REPOSITORY_UNKNOWN_FIELD',
  UNSUPPORTED_FILTER: 'REPOSITORY_UNSUPPORTED_FILTER',
});

export class RepositoryError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   */
  constructor(code, message) {
    super(message);
    this.name = 'RepositoryError';
    /** @type {string} */
    this.code = code;
  }
}

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/;

/** الحقول التي يديرها المستودع في كل السجلات. */
const MANAGED = Object.freeze({
  version: /** @type {FieldSpec} */ ({
    column: 'version',
    type: 'integer',
    required: false,
    managed: true,
  }),
  createdAt: /** @type {FieldSpec} */ ({
    column: 'created_at',
    type: 'timestamp',
    required: false,
    managed: true,
  }),
  updatedAt: /** @type {FieldSpec} */ ({
    column: 'updated_at',
    type: 'timestamp',
    required: false,
    managed: true,
  }),
});

/** @type {EntitySpec} */
export const AGENT_SPEC = Object.freeze({
  name: 'agents',
  table: 'state.agents',
  // التوكيد لازم: `Object.freeze` يُفقد الحقولَ سياقَ النوع فتُوسَّع `'string'` إلى
  // `string` فلا تطابق `FieldSpec`. والتوكيد لا يُخفي خطأً هنا لأن كل حقل يُتحقَّق
  // منه في `validateRecord` ويُختبر في اختبار العقد.
  fields: /** @type {Readonly<Record<string, FieldSpec>>} */ (
    Object.freeze({
      id: { column: 'id', type: 'string', required: true, maxLength: 128 },
      name: { column: 'name', type: 'string', required: true, maxLength: 200 },
      role: { column: 'role', type: 'string', required: true, maxLength: 120 },
      owner: { column: 'owner', type: 'string', required: true, maxLength: 128 },
      kind: {
        column: 'kind',
        type: 'enum',
        required: true,
        values: Object.freeze(['human', 'service', 'autonomous']),
      },
      state: {
        column: 'status',
        type: 'enum',
        required: true,
        values: Object.freeze([
          'registered',
          'active',
          'suspended',
          'quarantined',
          'revoked',
          'retired',
        ]),
      },
      capabilities: { column: 'capabilities', type: 'stringArray', required: false },
      // الشهادة تُخزَّن كما أصدرها جذر الثقة: وكيلٌ يعود بعد إعادة التشغيل بلا
      // شهادته وكيلٌ بلا إثبات تصريح، فلا تُقبل صلاحيته على الثقة.
      certificate: { column: 'certificate', type: 'json', required: true },
      stateReason: { column: 'suspended_reason', type: 'string', nullable: true },
      stateChangedAt: { column: 'state_changed_at', type: 'timestamp', nullable: true },
      ...MANAGED,
    })
  ),
  unique: Object.freeze([Object.freeze(['name'])]),
  filterable: Object.freeze(['state', 'kind', 'owner']),
  invariants: Object.freeze([
    {
      code: 'AGENT_PUNITIVE_NEEDS_REASON',
      message: 'التعليق أو الحجْر أو الإلغاء يلزمه سبب مسجَّل، والسبب لا يُسجَّل لوكيل غير معاقَب.',
      /** @param {EntityRecord} record */
      check: (record) => {
        const punitive =
          record['state'] === 'suspended' ||
          record['state'] === 'quarantined' ||
          record['state'] === 'revoked';
        const hasReason =
          typeof record['stateReason'] === 'string' && record['stateReason'].trim() !== '';
        return punitive === hasReason;
      },
    },
  ]),
});

/** @type {EntitySpec} */
export const MODEL_SPEC = Object.freeze({
  name: 'models',
  table: 'state.models',
  // التوكيد لازم: `Object.freeze` يُفقد الحقولَ سياقَ النوع فتُوسَّع `'string'` إلى
  // `string` فلا تطابق `FieldSpec`. والتوكيد لا يُخفي خطأً هنا لأن كل حقل يُتحقَّق
  // منه في `validateRecord` ويُختبر في اختبار العقد.
  fields: /** @type {Readonly<Record<string, FieldSpec>>} */ (
    Object.freeze({
      id: { column: 'id', type: 'string', required: true, maxLength: 128 },
      name: { column: 'name', type: 'string', required: true, maxLength: 200 },
      provider: { column: 'provider', type: 'string', required: true, maxLength: 200 },
      // نسخة النموذج نصٌّ يُعلنه المُودِع، وعمود `version` محجوز للقفل المتفائل.
      modelVersion: { column: 'model_version', type: 'string', required: true, maxLength: 60 },
      purpose: { column: 'purpose', type: 'string', required: true, maxLength: 120 },
      fingerprint: { column: 'fingerprint', type: 'string', required: true, maxLength: 64 },
      state: {
        column: 'status',
        type: 'enum',
        required: true,
        values: Object.freeze([
          'registered',
          'sandboxed',
          'evaluated',
          'approved',
          'suspended',
          'retired',
          'rolled-back',
        ]),
      },
      capabilities: { column: 'capabilities', type: 'stringArray', required: false },
      // النشاط قرارٌ مستقل عن الاعتماد: كثيرون يُعتمدون وواحدٌ يُفعَّل لغرضه.
      isActive: { column: 'is_active', type: 'boolean', required: true },
      approvedBy: { column: 'approved_by', type: 'string', nullable: true },
      stateReason: { column: 'state_reason', type: 'string', nullable: true },
      stateChangedAt: { column: 'state_changed_at', type: 'timestamp', nullable: true },
      ...MANAGED,
    })
  ),
  unique: Object.freeze([
    Object.freeze(['fingerprint']),
    Object.freeze(['name', 'provider', 'modelVersion']),
  ]),
  filterable: Object.freeze(['state', 'purpose', 'isActive']),
  invariants: Object.freeze([
    {
      code: 'MODEL_APPROVAL_NEEDS_APPROVER',
      message: 'الاعتماد لا يُعلن بلا معتمِد مسمّى.',
      /** @param {EntityRecord} record */
      check: (record) =>
        record['state'] !== 'approved' ||
        (typeof record['approvedBy'] === 'string' && record['approvedBy'].trim() !== ''),
    },
    {
      code: 'MODEL_ACTIVE_MUST_BE_APPROVED',
      message: 'النشط لغرضه يجب أن يكون معتمداً: هذا حرس `MODEL_ACTIVE_NOT_APPROVED` في المواصفة.',
      /** @param {EntityRecord} record */
      check: (record) => record['isActive'] !== true || record['state'] === 'approved',
    },
    {
      code: 'MODEL_FINGERPRINT_SHAPE',
      message: 'البصمة يجب أن تكون 64 حرفاً ست عشرياً صغيراً.',
      /** @param {EntityRecord} record */
      check: (record) =>
        typeof record['fingerprint'] === 'string' && /^[0-9a-f]{64}$/.test(record['fingerprint']),
    },
  ]),
});

/** @type {EntitySpec} */
export const DATA_ASSET_SPEC = Object.freeze({
  name: 'data_assets',
  table: 'state.data_assets',
  fields: /** @type {Readonly<Record<string, FieldSpec>>} */ (
    Object.freeze({
      id: { column: 'id', type: 'string', required: true, maxLength: 128 },
      name: { column: 'name', type: 'string', required: true, maxLength: 200 },
      owner: { column: 'owner', type: 'string', required: true, maxLength: 128 },
      classification: {
        column: 'classification',
        type: 'enum',
        required: true,
        values: Object.freeze(['public', 'internal', 'sensitive', 'sovereign']),
      },
      source: { column: 'source', type: 'string', required: true, maxLength: 200 },
      // لا حقل `lineage` هنا بعد `M7.04`. كان عموداً `jsonb` يقبل **أي** مصفوفة
      // يُعلنها من يسجّل الأصل، فكان النسب ادّعاءً في الطلب لا واقعاً مقيَّداً.
      // صار النسب صفوفاً في `state.data_lineage` تكتبها المسارات نفسها، ويحرس
      // `scripts/guard-lineage.mjs` أن لا يعود عمود الادّعاء — فالحقيقة في
      // موضعين تنحرف.
      retentionDays: { column: 'retention_days', type: 'integer', required: true },
      quality: {
        column: 'quality',
        type: 'enum',
        required: true,
        values: Object.freeze(['unverified', 'verified', 'degraded', 'rejected']),
      },
      legalHold: { column: 'legal_hold', type: 'boolean', required: true },
      ...MANAGED,
    })
  ),
  unique: Object.freeze([Object.freeze(['name'])]),
  // الترشيح مقصور على ما له فهرس في `0001`: ترشيحٌ بحقل بلا فهرس مسحٌ كامل
  // يُخفي كلفته حتى يكبر الجدول.
  filterable: Object.freeze(['owner', 'classification']),
  invariants: Object.freeze([
    {
      code: 'DATA_HOLD_BLOCKS_ZERO_RETENTION',
      message: 'احتفاظ صفر يعني «يُمحى فوراً»، ولا يقع على أصل محفوظ قانوناً.',
      /** @param {EntityRecord} record */
      check: (record) => record['legalHold'] !== true || Number(record['retentionDays']) > 0,
    },
  ]),
});

/** @type {EntitySpec} */
export const MEMORY_SPEC = Object.freeze({
  name: 'memories',
  table: 'state.memories',
  fields: /** @type {Readonly<Record<string, FieldSpec>>} */ (
    Object.freeze({
      id: { column: 'id', type: 'string', required: true, maxLength: 128 },
      agentId: { column: 'agent_id', type: 'string', required: true, maxLength: 128 },
      // لا ذاكرة بلا عقد بيانات: المرجع إلزامي في المواصفة كما هو في القاعدة.
      datasetId: { column: 'dataset_id', type: 'string', required: true, maxLength: 128 },
      kind: {
        column: 'kind',
        type: 'enum',
        required: true,
        values: Object.freeze(['episodic', 'semantic', 'procedural']),
      },
      // المحتوى يُخزَّن **غلافاً مشفَّراً** بعد `M7.03` (‏`__enc` ومعمّاه ووسمه)، لا
      // `{ value: ... }` نصّاً؛ وقيدُ القاعدة `memories_content_sealed` يرفض صفّاً
      // يحمل `value`. التغليف حدٌّ معلن لا شكلٌ خفي.
      content: { column: 'content', type: 'json', required: true },
      tags: { column: 'tags', type: 'stringArray', required: false },
      legalHold: { column: 'legal_hold', type: 'boolean', required: true },
      expiresAt: { column: 'expires_at', type: 'timestamp', nullable: true },
      ...MANAGED,
    })
  ),
  unique: Object.freeze([]),
  // `datasetId` أُضيف في `M7.06`: دورةُ المحو تسأل «هل ما زالت لهذا الأصل ذاكرةٌ
  // حيّة؟» قبل محوه، وبلا ترشيحٍ به كان الجواب يقتضي مسح الجدول كلّه في الكود —
  // أي إخفاءَ كلفةِ المسح لا منعَها. والفهرس المقابل `memories_dataset_idx` في
  // الهجرة `0009`، فلا يُعلَن ترشيحٌ بلا فهرس.
  filterable: Object.freeze(['agentId', 'datasetId']),
  invariants: Object.freeze([
    {
      code: 'MEMORY_HOLD_HAS_NO_EXPIRY',
      message: 'ذاكرة محفوظة قانوناً لا تحمل تاريخ انتهاء: المحو المؤجَّل محوٌ مضمون.',
      /** @param {EntityRecord} record */
      check: (record) => record['legalHold'] !== true || record['expiresAt'] === null,
    },
    {
      // مرآة قيد الترحيل `memories_expiry_required` (‏`0008`) في المستودع الذاكري،
      // لأن العيب المُغلَق (‏`M7.05`) كان حرفياً: العمود موجود منذ `0001` ولم يُكتب
      // مرّةً. فلو بقي القيد في القاعدة وحدها لمرّت كل اختبارات المستودع الذاكري
      // على ذاكرةٍ أبديّة وهي تقول «نجحنا»، ولانكشف الفرق في التشغيل لا في القياس.
      code: 'MEMORY_EXPIRY_REQUIRED',
      message:
        'مدخل ذاكرة بلا تاريخ انتهاء ولا حفظٍ قانوني: الأبديّة تناقض الاحتفاظ، ودورةُ محوٍ تمرّ على صفر صفوف تُعلن نجاحاً لم يحدث.',
      /** @param {EntityRecord} record */
      check: (record) =>
        record['legalHold'] === true ||
        (record['expiresAt'] !== null && record['expiresAt'] !== undefined),
    },
  ]),
});

/** @type {EntitySpec} */
export const LAW_SPEC = Object.freeze({
  name: 'laws',
  table: 'state.laws',
  fields: /** @type {Readonly<Record<string, FieldSpec>>} */ (
    Object.freeze({
      id: { column: 'id', type: 'string', required: true, maxLength: 128 },
      title: { column: 'title', type: 'string', required: true, maxLength: 300 },
      text: { column: 'body', type: 'string', required: true },
      scope: { column: 'scope', type: 'string', required: true, maxLength: 120 },
      proposer: { column: 'proposer', type: 'string', required: true, maxLength: 128 },
      state: {
        column: 'status',
        type: 'enum',
        required: true,
        values: Object.freeze(['draft', 'proposed', 'enacted', 'suspended', 'repealed']),
      },
      enactedBy: { column: 'enacted_by', type: 'string', nullable: true },
      enactedAt: { column: 'enacted_at', type: 'timestamp', nullable: true },
      repealedAt: { column: 'repealed_at', type: 'timestamp', nullable: true },
      stateChangedAt: { column: 'state_changed_at', type: 'timestamp', nullable: true },
      // ربطُ القانون بسنَده وبأداةِ إنفاذه (الخطوة `M8.02`، الهجرة 0011). كانا
      // غائبين، فكان «القانونُ النافذ» صفّاً لا يقرؤه قرارٌ واحد في الدولة.
      articleId: { column: 'article_id', type: 'string', nullable: true, maxLength: 40 },
      policyIds: { column: 'policy_ids', type: 'stringArray', nullable: true },
      ...MANAGED,
    })
  ),
  unique: Object.freeze([Object.freeze(['title', 'version'])]),
  filterable: Object.freeze(['state', 'scope']),
  invariants: Object.freeze([
    {
      code: 'LAW_ENACTMENT_AUTHORITY_RECORDED',
      message: 'النفاذ فعلٌ سياديٌّ مؤرَّخ: لا نفاذ بلا سلطة نفاذ ووقت نفاذ.',
      /** @param {EntityRecord} record */
      check: (record) => {
        const enactedOnce =
          record['state'] === 'enacted' ||
          record['state'] === 'suspended' ||
          record['state'] === 'repealed';
        if (!enactedOnce) return true;
        return (
          typeof record['enactedBy'] === 'string' &&
          record['enactedBy'].trim() !== '' &&
          record['enactedAt'] instanceof Date
        );
      },
    },
    {
      code: 'LAW_ENACTED_REQUIRES_BINDING',
      message:
        'القانونُ النافذُ مربوطٌ بمادةٍ دستوريةٍ وبسياسةٍ تُنفِّذه؛ ونافذٌ بلا ربطٍ نصٌّ لا أثرَ له في قرار.',
      /** @param {EntityRecord} record */
      check: (record) => {
        if (record['state'] !== 'enacted') return true;
        const article = record['articleId'];
        const policies = record['policyIds'];
        return (
          typeof article === 'string' &&
          article.trim() !== '' &&
          Array.isArray(policies) &&
          policies.length > 0
        );
      },
    },
    {
      code: 'LAW_REPEAL_IS_DATED',
      message: 'الإلغاء يُؤرَّخ، والتاريخ لا يُسجَّل لقانون غير ملغى.',
      /** @param {EntityRecord} record */
      check: (record) => (record['state'] === 'repealed') === record['repealedAt'] instanceof Date,
    },
  ]),
});

/**
 * اعتمادات إعادة التصنيف — الخطوة `M7.01`.
 *
 * الاعتماد سجلٌّ لا وسيط: `reclassify` لا تقبل كائن اعتماد يُمرَّر في الطلب بل
 * مُعرّفاً تقرؤه من هذا المستودع. من يستطيع تمرير كائن يستطيع اختراعه، ومن يريد
 * صفّاً في هذا الجدول يحتاج فعل اعتمادٍ منفصلاً بمعتمِدٍ غير الطالب.
 *
 * والقيود التي تُختبر في القاعدة (`migrations/0005`) مُعلنة هنا أيضاً كثوابت،
 * فتطبيق الذاكرة لا يكون أرخى من القاعدة فيُطمئن كذباً.
 */
/** @type {EntitySpec} */
export const CLASSIFICATION_APPROVAL_SPEC = Object.freeze({
  name: 'classification_approvals',
  table: 'state.classification_approvals',
  fields: /** @type {Readonly<Record<string, FieldSpec>>} */ (
    Object.freeze({
      id: { column: 'id', type: 'string', required: true, maxLength: 128 },
      assetId: { column: 'asset_id', type: 'string', required: true, maxLength: 128 },
      fromClassification: {
        column: 'from_classification',
        type: 'enum',
        required: true,
        values: Object.freeze(['public', 'internal', 'sensitive', 'sovereign']),
      },
      toClassification: {
        column: 'to_classification',
        type: 'enum',
        required: true,
        values: Object.freeze(['public', 'internal', 'sensitive', 'sovereign']),
      },
      requestedBy: { column: 'requested_by', type: 'string', required: true, maxLength: 128 },
      approvedBy: { column: 'approved_by', type: 'string', required: true, maxLength: 128 },
      approverRole: { column: 'approver_role', type: 'string', required: true, maxLength: 120 },
      justification: { column: 'justification', type: 'string', required: true, maxLength: 2000 },
      recordVersion: { column: 'record_version', type: 'integer', required: true },
      expiresAt: { column: 'expires_at', type: 'timestamp', required: true },
      consumedAt: { column: 'consumed_at', type: 'timestamp', nullable: true },
      consumedBy: { column: 'consumed_by', type: 'string', nullable: true },
      ...MANAGED,
    })
  ),
  unique: Object.freeze([]),
  filterable: Object.freeze(['assetId']),
  invariants: Object.freeze([
    {
      code: 'CLASSIFICATION_APPROVAL_HAS_DIRECTION',
      message: 'اعتمادٌ من مرتبة إلى نفسها لا يغيّر شيئاً، فليس اعتماداً.',
      /** @param {EntityRecord} record */
      check: (record) => record['fromClassification'] !== record['toClassification'],
    },
    {
      code: 'CLASSIFICATION_APPROVAL_SEPARATION_OF_DUTIES',
      message: 'من طلب إعادة التصنيف لا يعتمدها: الاعتماد الذاتي إلغاءٌ للاعتماد.',
      /** @param {EntityRecord} record */
      check: (record) => record['approvedBy'] !== record['requestedBy'],
    },
    {
      code: 'CLASSIFICATION_APPROVAL_CONSUMER_RECORDED',
      message: 'الاستهلاك يُنسب: وقتٌ بلا مستهلِك، أو مستهلِكٌ بلا وقت، أثرٌ ناقص.',
      /** @param {EntityRecord} record */
      check: (record) =>
        record['consumedAt'] instanceof Date ===
        (typeof record['consumedBy'] === 'string' && record['consumedBy'].trim() !== ''),
    },
  ]),
});

/**
 * قيود نسب البيانات — `M7.04`.
 *
 * دفترٌ **يُكتب فيه ولا يُعدَّل**: لا حقل هنا يُحدَّث بعد الإدراج، والتسلسل
 * `seq` مع `prevHash` يجعلان حذفَ صفٍّ أو تعديله مكشوفاً بـ`verify()`.
 * و`recordedAt` **نصّ** ISO لا عمودٌ زمني، لأن فرق الدقّة بين ساعة القاعدة
 * (ميكروثانية) و`Date` (ميليثانية) كان سيكسر التجزئة على البريء — وهو انحرافٌ
 * سقط فيه المشروع مرّةً في `M3.05`.
 */
export const DATA_LINEAGE_SPEC = Object.freeze({
  name: 'data_lineage',
  table: 'state.data_lineage',
  fields: /** @type {Readonly<Record<string, FieldSpec>>} */ (
    Object.freeze({
      id: { column: 'id', type: 'string', required: true, maxLength: 128 },
      assetId: { column: 'asset_id', type: 'string', required: true, maxLength: 128 },
      seq: { column: 'seq', type: 'integer', required: true },
      kind: {
        column: 'kind',
        type: 'enum',
        required: true,
        values: Object.freeze(['origin', 'derivation', 'read', 'write']),
      },
      actorId: { column: 'actor_id', type: 'string', required: true, maxLength: 128 },
      parents: { column: 'parents', type: 'json', required: true },
      purpose: { column: 'purpose', type: 'string', required: true, maxLength: 200 },
      recordedAt: { column: 'recorded_at', type: 'string', required: true, maxLength: 40 },
      prevHash: { column: 'prev_hash', type: 'string', required: true, maxLength: 64 },
      hash: { column: 'hash', type: 'string', required: true, maxLength: 64 },
      ...MANAGED,
    })
  ),
  // التجزئة فريدة (صفٌّ مُعاد إدراجه يُرفض)، والتسلسل فريد لكل أصل (لا صفّان
  // في نفس الموضع من السلسلة).
  unique: Object.freeze([Object.freeze(['hash']), Object.freeze(['assetId', 'seq'])]),
  filterable: Object.freeze(['assetId', 'kind', 'actorId']),
  invariants: Object.freeze([
    {
      code: 'LINEAGE_SEQ_POSITIVE',
      message: 'التسلسل يبدأ من 1: تسلسلٌ صفريٌّ أو سالب لا موضع له في سلسلة.',
      /** @param {EntityRecord} record */
      check: (record) => Number(record['seq']) >= 1,
    },
    {
      code: 'LINEAGE_GENESIS_IS_FIRST',
      message:
        'الصفّ الأول وحده يحمل `genesis`، وما بعده يحمل تجزئة ما قبله؛ وإلا صار كل صفٍّ بدايةً جديدة فلا تُكشف ثغرة.',
      /** @param {EntityRecord} record */
      check: (record) => (Number(record['seq']) === 1) === (record['prevHash'] === 'genesis'),
    },
    {
      code: 'LINEAGE_PARENTS_IS_ARRAY',
      message: 'الأسلاف مصفوفة معرّفات؛ كائنٌ حرّ هنا هو بعينه الادّعاء الذي أُغلق.',
      /** @param {EntityRecord} record */
      check: (record) => Array.isArray(record['parents']),
    },
    {
      code: 'LINEAGE_KIND_PARENTS_AGREE',
      message:
        'الاشتقاق وحده يحمل أسلافاً: قراءةٌ بأسلاف أو اشتقاقٌ بلا سلف يجعل الاستعلام يخلط التحويل بالوصول.',
      /** @param {EntityRecord} record */
      check: (record) => {
        const parents = Array.isArray(record['parents']) ? record['parents'] : [];
        return record['kind'] === 'derivation' ? parents.length > 0 : parents.length === 0;
      },
    },
    {
      code: 'LINEAGE_NO_SELF_PARENT',
      message: 'أصلٌ سلفُ نفسه يجعل مصدره نفسه ويجعل السلسلة غير منتهية.',
      /** @param {EntityRecord} record */
      check: (record) => {
        const parents = Array.isArray(record['parents']) ? record['parents'] : [];
        return !parents.includes(record['assetId']);
      },
    },
  ]),
});

/**
 * شواهد المحو — `M7.06`.
 *
 * دفترٌ **يُكتب فيه ولا يُعدَّل**: لا حقل هنا يُحدَّث بعد الإدراج، والتسلسل `seq`
 * مع `prevHash` يجعلان حذفَ شاهدٍ أو تعديله مكشوفاً بـ`verify()`.
 *
 * ولا مرجعَ في `targetId` إلى `state.data_assets`: الهدف **زائلٌ بالقصد**، ومرجعٌ
 * إليه يجعل الشاهد يزول مع المشهود عليه — أو يمنع المحو أصلاً وهو نقضُ الغرض.
 *
 * و`recordedAt` **نصّ** ISO لا عمودٌ زمني، لنفس سبب دفتر النسب: التجزئة تُحسب
 * عليه، وفرقُ الدقّة بين ساعة القاعدة و`Date` كان سيكسر السلسلة على البريء.
 */
/** @type {EntitySpec} */
export const ERASURE_RECORD_SPEC = Object.freeze({
  name: 'erasure_records',
  table: 'state.erasure_records',
  fields: /** @type {Readonly<Record<string, FieldSpec>>} */ (
    Object.freeze({
      id: { column: 'id', type: 'string', required: true, maxLength: 128 },
      target: {
        column: 'target',
        type: 'enum',
        required: true,
        values: Object.freeze(['memories', 'data_assets']),
      },
      // نصٌّ لا مرجع: المشهود عليه زائل.
      targetId: { column: 'target_id', type: 'string', required: true, maxLength: 128 },
      reason: {
        column: 'reason',
        type: 'enum',
        required: true,
        values: Object.freeze(['retention', 'directed']),
      },
      actorId: { column: 'actor_id', type: 'string', required: true, maxLength: 128 },
      classification: { column: 'classification', type: 'string', required: true, maxLength: 40 },
      owner: { column: 'owner', type: 'string', required: true, maxLength: 128 },
      // شهادةُ التوابع: عددُ صفوفها ورأسُ سلسلتها قبل زوالها. تُقرأ قبل الحذف
      // ولا تُستنتج بعده، فبعد الحذف لا يبقى ما يُشهد عليه.
      dependents: { column: 'dependents', type: 'json', required: true },
      seq: { column: 'seq', type: 'integer', required: true },
      recordedAt: { column: 'recorded_at', type: 'string', required: true, maxLength: 40 },
      prevHash: { column: 'prev_hash', type: 'string', required: true, maxLength: 64 },
      hash: { column: 'hash', type: 'string', required: true, maxLength: 64 },
      ...MANAGED,
    })
  ),
  unique: Object.freeze([Object.freeze(['hash']), Object.freeze(['seq'])]),
  filterable: Object.freeze(['target', 'reason', 'targetId']),
  invariants: Object.freeze([
    {
      code: 'ERASURE_SEQ_POSITIVE',
      message: 'التسلسل يبدأ من 1: تسلسلٌ صفريٌّ أو سالب لا موضع له في سلسلة.',
      /** @param {EntityRecord} record */
      check: (record) => Number(record['seq']) >= 1,
    },
    {
      code: 'ERASURE_GENESIS_IS_FIRST',
      message:
        'الشاهد الأول وحده يحمل `genesis`، وما بعده يحمل تجزئة ما قبله؛ وإلا صار كل شاهدٍ بدايةً جديدة فلا تُكشف ثغرة.',
      /** @param {EntityRecord} record */
      check: (record) => (Number(record['seq']) === 1) === (record['prevHash'] === 'genesis'),
    },
    {
      code: 'ERASURE_DEPENDENTS_IS_OBJECT',
      message:
        'شهادةُ التوابع كائنٌ من الجدول إلى عدده ورأس سلسلته؛ مصفوفةٌ أو نصٌّ حرٌّ هنا يجعل الشهادة غير مقروءة آلياً.',
      /** @param {EntityRecord} record */
      check: (record) =>
        typeof record['dependents'] === 'object' &&
        record['dependents'] !== null &&
        !Array.isArray(record['dependents']),
    },
    {
      code: 'ERASURE_CARRIES_NO_MATERIAL',
      message:
        'شاهدُ المحو لا يحمل مادّة ما مُحي ولا غلافه: دفترٌ يحمل المادة يُبطل المحو من باب التدقيق فيصير الاحتفاظ نقلاً للبيانات.',
      /** @param {EntityRecord} record */
      check: (record) =>
        !Object.prototype.hasOwnProperty.call(record, 'content') &&
        !Object.prototype.hasOwnProperty.call(record, 'value'),
    },
  ]),
});

/**
 * دفترُ الإطلاقاتِ المُجدوَلةِ — إغلاقُ الدَينِ `D-4` (‏`WL-191`).
 *
 * جدولٌ **يُكتَبُ فيه ولا يُعدَّلُ**، وهو موضعُ الحقيقةِ لموعدِ كلِّ عملٍ دوريٍّ
 * **وللقفلِ** الذي يمنعُ إطلاقَ الشقِّ نفسِه مرّتَينِ. والتفرّدُ على
 * `[jobId, slotAt, phase]` هو القفلُ نفسُه لا فحصٌ في الكودِ: شرطٌ في الكودِ
 * («اقرأْ ثمّ اكتبْ») يمرُّ منه سباقٌ بين نسختَينِ من المُجدوِلِ بلا أثرٍ يُقرأُ.
 *
 * و`slotAt` **مُعرِّفُ شقٍّ** لا لحظةُ حدثٍ: يُحسَبُ على شبكةٍ ثابتةٍ من مبدأِ
 * الزمنِ فيكونُ لكلِّ شقٍّ اسمٌ واحدٌ تعرفُه كلُّ نسخةٍ. وهو نصٌّ لا عمودٌ زمنيٌّ
 * لأنّ التجزئةَ تُحسَبُ عليه — نفسُ سببِ دفترَي النسبِ والمحوِ.
 */
/** @type {EntitySpec} */
export const SCHEDULED_RUN_SPEC = Object.freeze({
  name: 'scheduled_runs',
  table: 'state.scheduled_runs',
  fields: /** @type {Readonly<Record<string, FieldSpec>>} */ (
    Object.freeze({
      id: { column: 'id', type: 'string', required: true, maxLength: 128 },
      jobId: { column: 'job_id', type: 'string', required: true, maxLength: 64 },
      slotAt: { column: 'slot_at', type: 'string', required: true, maxLength: 40 },
      phase: {
        column: 'phase',
        type: 'enum',
        required: true,
        values: Object.freeze(['dispatched', 'completed', 'failed']),
      },
      actorId: { column: 'actor_id', type: 'string', required: true, maxLength: 128 },
      decisionId: { column: 'decision_id', type: 'string', required: true, maxLength: 128 },
      detail: { column: 'detail', type: 'json', required: true },
      seq: { column: 'seq', type: 'integer', required: true },
      recordedAt: { column: 'recorded_at', type: 'string', required: true, maxLength: 40 },
      prevHash: { column: 'prev_hash', type: 'string', required: true, maxLength: 64 },
      hash: { column: 'hash', type: 'string', required: true, maxLength: 64 },
      ...MANAGED,
    })
  ),
  unique: Object.freeze([
    Object.freeze(['hash']),
    Object.freeze(['seq']),
    Object.freeze(['jobId', 'slotAt', 'phase']),
  ]),
  filterable: Object.freeze(['jobId', 'phase', 'slotAt']),
  invariants: Object.freeze([
    {
      code: 'SCHEDULED_RUN_SEQ_POSITIVE',
      message: 'التسلسلُ يبدأُ من 1: تسلسلٌ صفريٌّ أو سالبٌ لا موضعَ له في سلسلةٍ.',
      /** @param {EntityRecord} record */
      check: (record) => Number(record['seq']) >= 1,
    },
    {
      code: 'SCHEDULED_RUN_GENESIS_IS_FIRST',
      message:
        'الواقعةُ الأولى وحدَها تحملُ `genesis`، وما بعدَها يحملُ تجزئةَ ما قبلَه؛ وإلا صارت كلُّ واقعةٍ بدايةً جديدةً فلا تُكشَفُ ثغرةٌ.',
      /** @param {EntityRecord} record */
      check: (record) => (Number(record['seq']) === 1) === (record['prevHash'] === 'genesis'),
    },
    {
      code: 'SCHEDULED_RUN_SLOT_IS_ISO',
      message:
        'مُعرِّفُ الشقِّ نصُّ ISO بدقّةِ الميلي ثانيةِ؛ ونصٌّ حرٌّ هنا يجعلُ القفلَ يُكتَبُ بصيغتَينِ فيُفتَحُ الشقُّ مرّتَينِ.',
      /** @param {EntityRecord} record */
      check: (record) =>
        typeof record['slotAt'] === 'string' &&
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(record['slotAt']),
    },
    {
      code: 'SCHEDULED_RUN_DETAIL_IS_OBJECT',
      message:
        'التفصيلُ كائنٌ: مصفوفةٌ أو نصٌّ حرٌّ هنا يجعلُ الواقعةَ غيرَ مقروءةٍ آليّاً، والتجزئةَ تعتمدُ ترتيبَ مفاتيحِه المُرتَّبَ.',
      /** @param {EntityRecord} record */
      check: (record) =>
        typeof record['detail'] === 'object' &&
        record['detail'] !== null &&
        !Array.isArray(record['detail']),
    },
  ]),
});

/**
 * رسائلُ قنوات الأحداث — `M7.07`.
 *
 * جدولٌ **يُكتب فيه ولا يُعدَّل**، وسلسلةُ التجزئة فيه **لكل قناة على حدة**:
 * `seq` يبدأ من 1 داخل كل قناة، فالتفرّد على `[channel, seq]` لا على `seq` وحده.
 * ولماذا لا سلسلةٌ واحدة للجدول كلّه؟ لأن القناة هي وحدةُ القراءة، وفحصُ قناةٍ
 * بسلسلةٍ عامّة يقتضي قراءةَ قنواتٍ لا تخليصَ للقارئ عليها — وذلك يهدم البوابة
 * التي بُنيت القنواتُ لإقامتها.
 *
 * و`authorId` منفصلٌ عن `actorId` قصداً: الأولُ فاعلُ الواقعة كما كُتب في سجل
 * جذر الثقة، والثاني من حملها إلى القناة. ودمجُهما يجعل كلَّ حدثٍ منقولٍ يبدو
 * كأن الناقلَ فعله.
 *
 * و`recordedAt` **نصّ** ISO لا عمودٌ زمني، لنفس سبب دفتري النسب والمحو: التجزئة
 * تُحسب عليه، وفرقُ الدقّة بين ساعة القاعدة و`Date` يكسر السلسلة على البريء.
 */
/** @type {EntitySpec} */
export const EVENT_MESSAGE_SPEC = Object.freeze({
  name: 'event_messages',
  table: 'state.event_messages',
  fields: /** @type {Readonly<Record<string, FieldSpec>>} */ (
    Object.freeze({
      id: { column: 'id', type: 'string', required: true, maxLength: 128 },
      channel: { column: 'channel', type: 'string', required: true, maxLength: 40 },
      type: { column: 'type', type: 'string', required: true, maxLength: 120 },
      contractVersion: { column: 'contract_version', type: 'integer', required: true },
      seq: { column: 'seq', type: 'integer', required: true },
      // فاعلُ الواقعة الأصلي، ثم من حملها إلى القناة.
      authorId: { column: 'author_id', type: 'string', required: true, maxLength: 128 },
      actorId: { column: 'actor_id', type: 'string', required: true, maxLength: 128 },
      actorRole: { column: 'actor_role', type: 'string', required: true, maxLength: 60 },
      classification: { column: 'classification', type: 'string', required: true, maxLength: 40 },
      payload: { column: 'payload', type: 'json', required: true },
      relayed: { column: 'relayed', type: 'boolean', required: true },
      recordedAt: { column: 'recorded_at', type: 'string', required: true, maxLength: 40 },
      prevHash: { column: 'prev_hash', type: 'string', required: true, maxLength: 64 },
      hash: { column: 'hash', type: 'string', required: true, maxLength: 64 },
      ...MANAGED,
    })
  ),
  unique: Object.freeze([Object.freeze(['channel', 'seq']), Object.freeze(['hash'])]),
  filterable: Object.freeze(['channel', 'type', 'relayed']),
  invariants: Object.freeze([
    {
      code: 'EVENT_SEQ_POSITIVE',
      message: 'ترقيمُ القناة يبدأ من 1: ترقيمٌ صفريٌّ أو سالب لا موضع له في سلسلة.',
      /** @param {EntityRecord} record */
      check: (record) => Number(record['seq']) >= 1,
    },
    {
      code: 'EVENT_GENESIS_IS_FIRST',
      message:
        'أولُ رسالةٍ في القناة وحدها تحمل `genesis`، وما بعدها يحمل تجزئة ما قبلها؛ وإلا صارت كلُّ رسالةٍ بدايةً فلا تُكشف ثغرة.',
      /** @param {EntityRecord} record */
      check: (record) => (Number(record['seq']) === 1) === (record['prevHash'] === 'genesis'),
    },
    {
      code: 'EVENT_TYPE_IN_CHANNEL',
      message:
        'النوعُ يبدأ بمعرّف قناته: نوعٌ في قناةٍ لا تملكه يجعل القارئ يقرأ مجالاً غير الذي خُلِّص له.',
      /** @param {EntityRecord} record */
      check: (record) => String(record['type']).split('.')[0] === String(record['channel']),
    },
    {
      code: 'EVENT_PAYLOAD_IS_OBJECT',
      message:
        'الحِمل كائنٌ من حقلٍ إلى قيمة؛ مصفوفةٌ أو نصٌّ حرٌّ هنا يجعل العقد غيرَ قابلٍ للقياس.',
      /** @param {EntityRecord} record */
      check: (record) =>
        typeof record['payload'] === 'object' &&
        record['payload'] !== null &&
        !Array.isArray(record['payload']),
    },
    {
      code: 'EVENT_CARRIES_NO_MATERIAL',
      message:
        'الرسالةُ لا تحمل مادّةً ولا سرّاً في جسدها: قناةٌ تحمل المادة تصير طريقاً حول بوابة الوصول وحول التعمية معاً.',
      /** @param {EntityRecord} record */
      check: (record) =>
        !Object.prototype.hasOwnProperty.call(record, 'content') &&
        !Object.prototype.hasOwnProperty.call(record, 'plaintext') &&
        !Object.prototype.hasOwnProperty.call(record, 'secret'),
    },
  ]),
});

/**
 * مواضعُ قراءة القنوات — `M7.07`.
 *
 * صفٌّ لكل «مجموعةِ استهلاكٍ × قناة» يحمل آخرَ ترقيمٍ **عُولج وثُبِّت**. وهو
 * الحقلُ الوحيد في مجال الأحداث الذي **يُحدَّث**، ولذلك يمرّ تحديثُه بالقفل
 * المتفائل: مستهلكان يثبّتان معاً على نسخةٍ واحدة كان أحدُهما سيمحو تقدّمَ الآخر
 * فيُعاد ما عُولج بلا أثر.
 *
 * والمجموعةُ `relay` محفوظةٌ لموضع النقل من سجل جذر الثقة، وقناتُها `*` لأن
 * النقلَ يمشي على ترقيم السجل الواحد لا على ترقيم قناةٍ بعينها.
 */
/** @type {EntitySpec} */
export const EVENT_OFFSET_SPEC = Object.freeze({
  name: 'event_offsets',
  table: 'state.event_offsets',
  fields: /** @type {Readonly<Record<string, FieldSpec>>} */ (
    Object.freeze({
      id: { column: 'id', type: 'string', required: true, maxLength: 128 },
      group: { column: 'consumer_group', type: 'string', required: true, maxLength: 80 },
      channel: { column: 'channel', type: 'string', required: true, maxLength: 40 },
      committedSeq: { column: 'committed_seq', type: 'integer', required: true },
      committedAt: { column: 'committed_at', type: 'string', required: true, maxLength: 40 },
      ...MANAGED,
    })
  ),
  unique: Object.freeze([Object.freeze(['group', 'channel'])]),
  filterable: Object.freeze(['group', 'channel']),
  invariants: Object.freeze([
    {
      code: 'OFFSET_NOT_NEGATIVE',
      message: 'الموضعُ صفرٌ لمن لم يقرأ بعد، ثم يتقدّم؛ وموضعٌ سالب لا يقابل رسالةً في القناة.',
      /** @param {EntityRecord} record */
      check: (record) => Number(record['committedSeq']) >= 0,
    },
  ]),
});

/**
 * الحدُّ الأدنى لطول سببِ الحكم — الخطوة `M8.03`.
 *
 * العددُ مكتوبٌ في ثلاثة مواضع بالضرورة: هنا (ثابتُ المستودعين)، وفي
 * `config/judiciary.yaml` (`procedure.minReasonLength`)، وفي قيد الهجرة 0012
 * (`cases_judgment_reasoned`). والبوابةُ 20 تفحص وقوعَ العدد في الهجرة، وتفحص
 * تساويه هنا مع الوثيقة؛ فمن شدَّد في موضعٍ وترك موضعاً رُدَّ عمله. وتوحيدُه في
 * موضعٍ واحدٍ غيرُ ممكن: القاعدةُ لا تقرأ YAML ولا تستورد JavaScript.
 */
export const JUDGMENT_MIN_REASON_LENGTH = 60;

/** الحدُّ الأدنى لطول سببِ الاستئناف وسببِ التراجع (الخطوة `M8.03`). */
export const CASE_MIN_SECONDARY_REASON_LENGTH = 40;

/**
 * الحدُ الأدنى لطول سببِ المراجعة البشرية — الخطوة `M8.04`.
 *
 * وهو مساوٍ لحدِّ سبب الحكم لا أقلَ منه: مراجعةٌ تُكتب في أقلَ ممّا يُكتب به
 * الحكمُ توقيعٌ لا قراءة، والتساوي مفحوصٌ في البوابة 20 مقابلَ الوثيقة والهجرة 0013.
 */
export const CASE_MIN_REVIEW_REASON_LENGTH = 60;

/** الحدُ الأدنى لطول سببِ التنحي (الخطوة `M8.04`، والهجرة 0013). */
export const CASE_MIN_RECUSAL_REASON_LENGTH = 40;

/**
 * القضايا — الخطوة `M8.03`.
 *
 * **العيبُ الذي تُغلقه هذه المواصفة:** جدولُ `state.cases` كان موجوداً من الهجرة
 * 0001 ولا مواصفةَ له في الكود، فلا مستودعَ يقرؤه ولا يكتب فيه. والقضاءُ الوحيدُ
 * في الدولة (`Court` في `src/governance/law-system.mjs`) كان يفتح القضيةَ في
 * `Map` تُمحى بإعادة التشغيل — وقد حُذِفَ ذلك الصنفُ من الشجرةِ لاحقاً فلا يبقى
 * قضاءانِ، والنافذُ هو `src/judiciary/`. فكان في الدولة جدولُ قضايا فارغٌ أبداً، وقضاءٌ
 * بلا أثرٍ في القاعدة.
 *
 * **اختيارانِ مُعلَنان لا مسكوتٌ عنهما:**
 *
 *   1. `law_id` في الجدول `NOT NULL REFERENCES state.laws(id)`، بينما وصفُ
 *      الخطوة في خارطة الطريق لا يشترط سنداً قانونياً للدعوى. والحُكمُ للجدول:
 *      دعوى بلا سندٍ نافذٍ نزاعٌ بلا مقياسٍ يُفصل به، فأُبقي القيدُ وأُعلن
 *      الشرطُ في `config/judiciary.yaml` (`requireEnactedLaw`).
 *
 *   2. العمودُ القائم `subject` هو **المدّعى عليه**، ويُقرأ في الكود باسم
 *      `respondent`. والاسمُ في الجدول لم يُغيَّر كي لا تُعاد كتابةُ هجرةٍ
 *      مُطبَّقة؛ والاسمُ في الكود مطابقٌ لمفردات المادة 11.
 *
 * وكلُّ قيدٍ يُفحَص في القاعدة (`migrations/0012`) مُعلَنٌ هنا ثابتاً، فتطبيقُ
 * الذاكرة لا يكون أرخى من القاعدة فيُطمئن كذباً.
 */
/** @type {EntitySpec} */
/**
 * حقلٌ فارغٌ: غائبٌ عن السجل أو مُعلَنٌ فراغَه.
 *
 * والفرقُ بينهما شكليٌّ لا معنويّ، **والثوابتُ تُفحَص قبل ملء الفراغات المُعلَنة**
 * (`validateRecord` ثم `withDeclaredBlanks` في `repository-memory.mjs`). فمن قرأ
 * `=== null` وحدها ردَّ كتابةً صحيحةً لمجرّد أنّ الحقلَ لم يُذكر في الإدراج، وهو
 * ما يجعل الثابتَ يمنع العملَ لا الخطأ.
 * @param {unknown} value
 * @returns {boolean}
 */
const blank = (value) => value === null || value === undefined;

export const CASE_SPEC = Object.freeze({
  name: 'cases',
  table: 'state.cases',
  fields: /** @type {Readonly<Record<string, FieldSpec>>} */ (
    Object.freeze({
      id: { column: 'id', type: 'string', required: true, maxLength: 128 },
      lawId: { column: 'law_id', type: 'string', required: true, maxLength: 128 },
      claimant: { column: 'claimant', type: 'string', required: true, maxLength: 128 },
      respondent: { column: 'subject', type: 'string', required: true, maxLength: 128 },
      claim: { column: 'claim', type: 'string', required: true },
      state: {
        column: 'state',
        type: 'enum',
        required: true,
        values: Object.freeze(['opened', 'heard', 'judged', 'appealed', 'closed']),
      },
      openedAt: { column: 'opened_at', type: 'timestamp', required: true },
      heardAt: { column: 'heard_at', type: 'timestamp', nullable: true },
      judge: { column: 'judge', type: 'string', nullable: true, maxLength: 128 },
      verdict: {
        column: 'verdict',
        type: 'enum',
        nullable: true,
        values: Object.freeze(['guilty', 'innocent', 'dismissed']),
      },
      reason: { column: 'reason', type: 'string', nullable: true },
      judgedAt: { column: 'judged_at', type: 'timestamp', nullable: true },
      executedAt: { column: 'executed_at', type: 'timestamp', nullable: true },
      executedEffect: { column: 'executed_effect', type: 'string', nullable: true, maxLength: 120 },
      executionCommandId: {
        column: 'execution_command_id',
        type: 'string',
        nullable: true,
        maxLength: 128,
      },
      // بصمةُ الأثر قبل التنفيذ: بها وحدها يُقاس أنّ التراجعَ أرجع الحالَ إلى ما
      // كان. تركُها في الذاكرة يجعل التراجعَ بعد إعادة التشغيل غيرَ قابلٍ للقياس.
      executionFingerprintBefore: {
        column: 'execution_fingerprint_before',
        type: 'string',
        nullable: true,
        maxLength: 200,
      },
      reversedAt: { column: 'reversed_at', type: 'timestamp', nullable: true },
      reversalReason: { column: 'reversal_reason', type: 'string', nullable: true },
      reversalCommandId: {
        column: 'reversal_command_id',
        type: 'string',
        nullable: true,
        maxLength: 128,
      },
      appealedAt: { column: 'appealed_at', type: 'timestamp', nullable: true },
      appellant: { column: 'appellant', type: 'string', nullable: true, maxLength: 128 },
      appealReason: { column: 'appeal_reason', type: 'string', nullable: true },
      closedAt: { column: 'closed_at', type: 'timestamp', nullable: true },
      // المراجعةُ البشرية والتنحي — الخطوة `M8.04`. وموضعُها الجدولُ لا الذاكرة:
      // مراجعةٌ تُحفظ في العملية تُمحى بإعادة التشغيل فيُنفّذ الحكمُ بعدها بلا قارئ.
      reviewedAt: { column: 'reviewed_at', type: 'timestamp', nullable: true },
      reviewer: { column: 'reviewer', type: 'string', nullable: true, maxLength: 128 },
      reviewDecision: {
        column: 'review_decision',
        type: 'enum',
        nullable: true,
        values: Object.freeze(['approved', 'rejected']),
      },
      reviewReason: { column: 'review_reason', type: 'string', nullable: true },
      recusedJudges: { column: 'recused_judges', type: 'stringArray', required: false },
      recusalReason: { column: 'recusal_reason', type: 'string', nullable: true },
      ...MANAGED,
    })
  ),
  unique: Object.freeze([]),
  filterable: Object.freeze(['state', 'lawId', 'respondent', 'claimant', 'judge', 'reviewer']),
  invariants: Object.freeze([
    {
      code: 'CASE_JUDGMENT_NEEDS_HEARING',
      message:
        'لا حكمَ قبل جلسةٍ محضورةٍ مسجَّلةِ الوقت؛ وحكمٌ يسبق الجلسةَ يجعلها مراسمَ بعد القرار.',
      /** @param {EntityRecord} record */
      check: (record) => blank(record['verdict']) || record['heardAt'] instanceof Date,
    },
    {
      code: 'CASE_JUDGMENT_REASONED',
      message:
        'الحكمُ مُسبَّبٌ بسببٍ مكتوبٍ يبلغ الحدَّ المُعلَن، ولا سببَ يُسجَّل لقضيةٍ لم يُحكم فيها.',
      /** @param {EntityRecord} record */
      check: (record) => {
        const reason = record['reason'];
        const reasoned = typeof reason === 'string' && reason.trim().length >= 60;
        return !blank(record['verdict']) === reasoned;
      },
    },
    {
      code: 'CASE_JUDGMENT_ATTRIBUTED',
      message: 'الحكمُ مؤرَّخٌ منسوبٌ إلى قاضٍ مسمّى؛ وحكمٌ بلا قاضٍ ولا وقتٍ لا يُراجَع.',
      /** @param {EntityRecord} record */
      check: (record) => {
        const attributed =
          record['judgedAt'] instanceof Date &&
          typeof record['judge'] === 'string' &&
          record['judge'].trim() !== '';
        return !blank(record['verdict']) === attributed;
      },
    },
    {
      code: 'CASE_JUDGE_NOT_PARTY',
      message: 'لا يفصل قاضٍ في قضيةٍ هو مدّعيها أو المدّعى عليه فيها.',
      /** @param {EntityRecord} record */
      check: (record) =>
        blank(record['judge']) ||
        (record['judge'] !== record['claimant'] && record['judge'] !== record['respondent']),
    },
    {
      code: 'CASE_EXECUTION_NEEDS_JUDGMENT',
      message:
        'تنفيذُ الحكم واقعةٌ كاملةٌ: حكمٌ قائم، وأثرٌ مسمّى، وأمرٌ ملكيٌّ، وبصمةٌ قبله يُقاس بها التراجع.',
      /** @param {EntityRecord} record */
      check: (record) => {
        const executed = record['executedAt'] instanceof Date;
        if (!executed) {
          return (
            blank(record['executedEffect']) &&
            blank(record['executionCommandId']) &&
            blank(record['executionFingerprintBefore'])
          );
        }
        return (
          !blank(record['verdict']) &&
          typeof record['executedEffect'] === 'string' &&
          typeof record['executionCommandId'] === 'string' &&
          typeof record['executionFingerprintBefore'] === 'string'
        );
      },
    },
    {
      code: 'CASE_REVERSAL_NEEDS_EXECUTION',
      message: 'لا تراجعَ عن تنفيذٍ لم يقع، ولا تراجعَ بلا سببٍ مكتوبٍ وأمرٍ ملكيٍّ مسجَّل.',
      /** @param {EntityRecord} record */
      check: (record) => {
        const reversedAt = record['reversedAt'];
        const executedAt = record['executedAt'];
        if (!(reversedAt instanceof Date)) {
          return blank(record['reversalReason']) && blank(record['reversalCommandId']);
        }
        const reason = record['reversalReason'];
        return (
          executedAt instanceof Date &&
          reversedAt.getTime() >= executedAt.getTime() &&
          typeof reason === 'string' &&
          reason.trim().length >= 40 &&
          typeof record['reversalCommandId'] === 'string'
        );
      },
    },
    {
      code: 'CASE_APPEAL_NEEDS_JUDGMENT',
      message: 'لا استئنافَ على ما لم يُحكم فيه، ولا استئنافَ بلا مستأنِفٍ مسمّى وسببٍ مكتوب.',
      /** @param {EntityRecord} record */
      check: (record) => {
        const appealed = record['appealedAt'] instanceof Date;
        if (!appealed) return blank(record['appellant']) && blank(record['appealReason']);
        const reason = record['appealReason'];
        return (
          !blank(record['verdict']) &&
          typeof record['appellant'] === 'string' &&
          typeof reason === 'string' &&
          reason.trim().length >= 40
        );
      },
    },
    {
      code: 'CASE_REVIEW_COMPLETE',
      message:
        'المراجعةُ واقعةٌ كاملة: حكمٌ قبلَها، ومراجعٌ مسمّى ليس قاضياً ولا خصماً، وقرارٌ، وسببٌ مكتوبٌ يبلغ الحدَ المُعلن.',
      /** @param {EntityRecord} record */
      check: (record) => {
        const reviewedAt = record['reviewedAt'];
        if (!(reviewedAt instanceof Date)) {
          return (
            blank(record['reviewer']) &&
            blank(record['reviewDecision']) &&
            blank(record['reviewReason'])
          );
        }
        const judgedAt = record['judgedAt'];
        const reason = record['reviewReason'];
        const reviewer = record['reviewer'];
        return (
          judgedAt instanceof Date &&
          reviewedAt.getTime() >= judgedAt.getTime() &&
          !blank(record['reviewDecision']) &&
          typeof reason === 'string' &&
          reason.trim().length >= CASE_MIN_REVIEW_REASON_LENGTH &&
          typeof reviewer === 'string' &&
          reviewer !== record['judge'] &&
          reviewer !== record['claimant'] &&
          reviewer !== record['respondent']
        );
      },
    },
    {
      code: 'CASE_EXECUTION_NOT_REJECTED',
      message: 'لا يُنفّذ حكمٌ رُفضت مراجعتُه؛ وتنفيذٌ بعد رفضٍ يجعل المراجعةَ رأياً يُستأنس به.',
      /** @param {EntityRecord} record */
      check: (record) =>
        !(record['executedAt'] instanceof Date) || record['reviewDecision'] !== 'rejected',
    },
    {
      code: 'CASE_JUDGE_NOT_RECUSED',
      message: 'لا يجلس للقضية من تنحّى عنها؛ وعودتُه تُفرغ التنحي من معناه.',
      /** @param {EntityRecord} record */
      check: (record) => {
        const recused = record['recusedJudges'];
        if (!Array.isArray(recused)) return blank(recused);
        const judge = record['judge'];
        return blank(judge) || !recused.includes(judge);
      },
    },
    {
      code: 'CASE_RECUSAL_REASONED',
      message: 'التنحي مُسبّبٌ بسببٍ مكتوبٍ يبلغ الحدَ المُعلن؛ وتنحٍ بلا سببٍ انسحابٌ لا يُدقّق.',
      /** @param {EntityRecord} record */
      check: (record) => {
        const recused = record['recusedJudges'];
        const any = Array.isArray(recused) && recused.length > 0;
        const reason = record['recusalReason'];
        const reasoned =
          typeof reason === 'string' && reason.trim().length >= CASE_MIN_RECUSAL_REASON_LENGTH;
        return any === reasoned;
      },
    },
    {
      code: 'CASE_STATE_MATCHES_TIMELINE',
      message:
        'حالةُ القضية محسوبةٌ من وقائعها لا مُعلَنةٌ بجانبها؛ وحالةٌ تخالف الوقائعَ حالةٌ تكذب.',
      /** @param {EntityRecord} record */
      check: (record) => {
        const state = record['state'];
        if (state === 'opened') return blank(record['heardAt']) && blank(record['verdict']);
        if (state === 'heard') return record['heardAt'] instanceof Date;
        if (state === 'judged') return !blank(record['verdict']) && blank(record['appealedAt']);
        if (state === 'appealed') return !blank(record['verdict']);
        return record['closedAt'] instanceof Date;
      },
    },
    {
      code: 'CASE_TIMELINE_ORDERED',
      message: 'وقائعُ القضية مرتَّبةٌ زمناً: جلسةٌ بعد فتحٍ، وحكمٌ بعد جلسة، وتنفيذٌ بعد حكم.',
      /** @param {EntityRecord} record */
      check: (record) => {
        const opened = record['openedAt'];
        if (!(opened instanceof Date)) return false;
        /** @type {Array<[string, unknown]>} */
        const ordered = [
          ['heardAt', record['heardAt']],
          ['judgedAt', record['judgedAt']],
          ['executedAt', record['executedAt']],
        ];
        let previous = opened.getTime();
        for (const [, value] of ordered) {
          if (blank(value)) continue;
          if (!(value instanceof Date) || value.getTime() < previous) return false;
          previous = value.getTime();
        }
        return true;
      },
    },
  ]),
});

/**
 * الحدُ الأدنى لطول موضوعِ المهمّة المؤسسية (الخطوة `M8.05`).
 *
 * ونفسُ العددِ مكتوبٌ في `config/institutions.yaml` تحت
 * `procedure.minSubjectLength` وفي قيدِ الهجرة 0014
 * `institution_tasks_subject_measured`، والبوابةُ 21 تفحص وقوعَه **في موضعه** من
 * القيد لا في أيِّ موضعٍ من نصّه. وحدٌّ في الكود بلا قيدٍ في القاعدة يُلتفُّ
 * عليه بكتابةٍ مباشرة، وحدّان مختلفان في الموضعين أسوأ من واحد.
 */
export const INSTITUTION_MIN_SUBJECT_LENGTH = 20;

/** الحدُ الأدنى لطول سببِ رفضِ المهمّة (الخطوة `M8.05`، والهجرة 0014). */
export const INSTITUTION_MIN_REFUSAL_REASON_LENGTH = 20;

/**
 * الحدُ الأدنى لطول تفصيلِ مخالفةِ الاختصاص (الخطوة `M8.06`).
 *
 * ونفسُ العددِ مكتوبٌ في `config/institutional-mandates.yaml` تحت
 * `procedure.minBreachDetailLength` وفي قيدِ الهجرة 0015
 * `institution_breaches_reasoned`، والبوابةُ 22 تفحص وقوعَه **في موضعه** من
 * القيد. ومخالفةٌ بلا تفصيلٍ مكتوبٍ لا يُسأل عليها أحد.
 */
export const INSTITUTION_MANDATE_MIN_BREACH_DETAIL_LENGTH = 20;

/**
 * المؤسسةُ المُشغَّلةُ فعلاً — الخطوة `M8.05`.
 *
 * والميزانيةُ عمودان في هذا الصفِّ لا دفترٌ خارجه: `budgetAllocated` مقروءٌ من
 * عهدِ التشغيل عند التأسيس، و`budgetConsumed` يُزاد **قبل** كلِّ تنفيذٍ
 * بتحديثٍ متفائلٍ على `version`. فالذرّيةُ هي ذرّيةُ التحديث نفسِه: محاولتان
 * متزامنتان تنجح إحداهما وتُخفق الأخرى بتعارض النسخة، فلا يتجاوز المقيَّدُ
 * المُخصَّصَ بمرورِ اثنتين معاً.
 *
 * **وحدٌّ معلَن:** هذا ليس دفتر الحصص الذرّي في `src/policy/quota.mjs` (وفيه
 * `'institution'` معلَنٌ في `SUBJECT_TYPES`) ولا ميزانيةَ المهام في
 * `src/execution/budget.mjs`؛ كلاهما PostgreSQL وحده. وتوحيدُ الدفاتر مسجَّلٌ
 * في `docs/REMAINING_WORK.md`.
 */
/** @type {EntitySpec} */
export const INSTITUTION_SPEC = Object.freeze({
  name: 'institutions',
  table: 'state.institutions',
  fields: /** @type {Readonly<Record<string, FieldSpec>>} */ (
    Object.freeze({
      id: { column: 'id', type: 'string', required: true, maxLength: 128 },
      // مفتاحُ المؤسسة في عهدِ التشغيل، ومعرِّفُها في البذرة. وكلاهما فريد:
      // مؤسستان بمفتاحٍ واحدٍ تُنادى إحداهما مكانَ الأخرى، ومؤسستان بمعرِّفِ
      // بذرةٍ واحدٍ تُقرآن سنداً واحداً.
      key: { column: 'charter_key', type: 'string', required: true, maxLength: 64 },
      seedId: { column: 'seed_id', type: 'string', required: true, maxLength: 8 },
      name: { column: 'name', type: 'string', required: true, maxLength: 200 },
      agentRoles: { column: 'agent_roles', type: 'stringArray', required: true },
      budgetResource: { column: 'budget_resource', type: 'string', required: true, maxLength: 64 },
      budgetAllocated: { column: 'budget_allocated', type: 'integer', required: true },
      budgetConsumed: { column: 'budget_consumed', type: 'integer', required: true },
      charterVersion: { column: 'charter_version', type: 'integer', required: true },
      commissionedAt: { column: 'commissioned_at', type: 'timestamp', required: true },
      ...MANAGED,
    })
  ),
  unique: Object.freeze([Object.freeze(['key']), Object.freeze(['seedId'])]),
  filterable: Object.freeze(['key', 'seedId']),
  invariants: Object.freeze([
    {
      code: 'INSTITUTION_BUDGET_NOT_OVERDRAWN',
      message:
        'المقيَّدُ من الميزانية لا يتجاوز المُخصَّصَ ولا ينزل عن الصفر؛ ونفادُ الميزانية يوقف المهمّةَ قبل أن تبدأ.',
      /** @param {EntityRecord} record */
      check: (record) => {
        const allocated = record['budgetAllocated'];
        const consumed = record['budgetConsumed'];
        if (typeof allocated !== 'number' || typeof consumed !== 'number') return false;
        return consumed >= 0 && consumed <= allocated;
      },
    },
    {
      code: 'INSTITUTION_ALLOCATION_POSITIVE',
      message: 'مؤسسةٌ بمُخصَّصٍ صفريٍّ لا تُنفِّذ مهمّةً واحدة؛ وتشغيلُها إعلانٌ لا عمل.',
      /** @param {EntityRecord} record */
      check: (record) => {
        const allocated = record['budgetAllocated'];
        return typeof allocated === 'number' && allocated >= 1;
      },
    },
    {
      code: 'INSTITUTION_ROLES_DECLARED',
      message:
        'أدوارُ وكلاءِ المؤسسة مُعلَنةٌ غيرُ فارغةٍ بصيغةِ الأدوار؛ ومؤسسةٌ بلا دورٍ مؤهَّلٍ يُسنَد إليها كلُّ وكيل.',
      /** @param {EntityRecord} record */
      check: (record) => {
        const roles = record['agentRoles'];
        if (!Array.isArray(roles) || roles.length === 0) return false;
        return roles.every((role) => typeof role === 'string' && /^role:[a-z-]+$/.test(role));
      },
    },
  ]),
});

/**
 * مهمّةُ المؤسسة — الخطوة `M8.05`.
 *
 * والصفُّ يحمل الواقعةَ كلَّها: من رفعها، ومن أُسنِدت إليه، وكم قُيِّد لها من
 * الميزانية ومتى، وبصمةَ مخزنِ المخرجات **قبل** التنفيذ وبعده. والبصمتان هما
 * الدليل: تنفيذٌ لا يُغيِّر البصمةَ لا يُسجَّل منفَّذاً بل يُرفض بسببٍ مكتوب.
 */
/** @type {EntitySpec} */
export const INSTITUTION_TASK_SPEC = Object.freeze({
  name: 'institution_tasks',
  table: 'state.institution_tasks',
  fields: /** @type {Readonly<Record<string, FieldSpec>>} */ (
    Object.freeze({
      id: { column: 'id', type: 'string', required: true, maxLength: 128 },
      institutionId: { column: 'institution_id', type: 'string', required: true, maxLength: 128 },
      kind: { column: 'kind', type: 'string', required: true, maxLength: 64 },
      // مجالُ المهمّة المُعلَنُ عند رفعها (الخطوة `M8.06`). ويُحفظ في الصفِّ
      // لأنّ مجالاً مُستنبَطاً من النوعِ وحدَه لا يُقاس تجاوزُه: المتجاوِزُ لا
      // يُعلن، فالإعلانُ نفسُه هو ما يُقاس عليه الاختصاص.
      domain: { column: 'domain', type: 'string', required: true, maxLength: 64 },
      subject: { column: 'subject', type: 'string', required: true },
      submittedBy: { column: 'submitted_by', type: 'string', required: true, maxLength: 128 },
      state: {
        column: 'state',
        type: 'enum',
        required: true,
        values: Object.freeze(['received', 'assigned', 'executed', 'refused']),
      },
      receivedAt: { column: 'received_at', type: 'timestamp', required: true },
      budgetCost: { column: 'budget_cost', type: 'integer', required: true },
      agentId: { column: 'agent_id', type: 'string', nullable: true, maxLength: 128 },
      assignedAt: { column: 'assigned_at', type: 'timestamp', nullable: true },
      budgetDebitedAt: { column: 'budget_debited_at', type: 'timestamp', nullable: true },
      effect: { column: 'effect', type: 'string', nullable: true, maxLength: 120 },
      outputId: { column: 'output_id', type: 'string', nullable: true, maxLength: 128 },
      // البصمتان: بهما وحدهما يُقاس أنّ للتنفيذ أثراً في البيانات. وتركُهما
      // يجعل «منفَّذ» عَلَماً يُرفع في عمودٍ لا واقعةً تُراجَع.
      fingerprintBefore: {
        column: 'fingerprint_before',
        type: 'string',
        nullable: true,
        maxLength: 200,
      },
      fingerprintAfter: {
        column: 'fingerprint_after',
        type: 'string',
        nullable: true,
        maxLength: 200,
      },
      executedAt: { column: 'executed_at', type: 'timestamp', nullable: true },
      refusalCode: { column: 'refusal_code', type: 'string', nullable: true, maxLength: 120 },
      refusalReason: { column: 'refusal_reason', type: 'string', nullable: true },
      refusedAt: { column: 'refused_at', type: 'timestamp', nullable: true },
      ...MANAGED,
    })
  ),
  unique: Object.freeze([]),
  filterable: Object.freeze(['institutionId', 'state', 'kind', 'agentId', 'domain']),
  invariants: Object.freeze([
    {
      code: 'INSTITUTION_TASK_DOMAIN_DECLARED',
      message:
        'مجالُ المهمّة مُعلَنٌ غيرُ فارغٍ؛ ومهمّةٌ بلا مجالٍ معلَنٍ لا يُقاس تجاوزُها اختصاصَ مؤسستها.',
      /** @param {EntityRecord} record */
      check: (record) => {
        const domain = record['domain'];
        return typeof domain === 'string' && domain.trim() !== '';
      },
    },
    {
      code: 'INSTITUTION_TASK_SUBJECT_MEASURED',
      message: 'موضوعُ المهمّة يبلغ الحدَ المُعلن؛ وموضوعٌ أقصرُ منه لا يُعرَف ما طُلب فيه.',
      /** @param {EntityRecord} record */
      check: (record) => {
        const subject = record['subject'];
        return (
          typeof subject === 'string' && subject.trim().length >= INSTITUTION_MIN_SUBJECT_LENGTH
        );
      },
    },
    {
      code: 'INSTITUTION_TASK_COST_POSITIVE',
      message: 'كلفةُ المهمّة وحدةٌ واحدةٌ على الأقل؛ ومهمّةٌ بكلفةٍ صفريةٍ تُنفَّذ بلا حدّ.',
      /** @param {EntityRecord} record */
      check: (record) => {
        const cost = record['budgetCost'];
        return typeof cost === 'number' && cost >= 1;
      },
    },
    {
      code: 'INSTITUTION_TASK_ASSIGNMENT_COMPLETE',
      message: 'الإسنادُ واقعةٌ كاملة: وكيلٌ مسمّى ووقتٌ مسجَّل؛ ونصفُ إسنادٍ لا يُراجَع.',
      /** @param {EntityRecord} record */
      check: (record) => blank(record['agentId']) === blank(record['assignedAt']),
    },
    {
      code: 'INSTITUTION_TASK_BUDGET_BEFORE_EXECUTION',
      message:
        'الميزانيةُ تُقيَّد قبل التنفيذ لا بعده؛ وقيدٌ بعد التنفيذ يسمح بتجاوزِ الحدِّ مرّةً واحدةً — وهي المرّةُ التي تهمّ.',
      /** @param {EntityRecord} record */
      check: (record) => {
        const executedAt = record['executedAt'];
        if (!(executedAt instanceof Date)) return true;
        const debitedAt = record['budgetDebitedAt'];
        return debitedAt instanceof Date && debitedAt.getTime() <= executedAt.getTime();
      },
    },
    {
      code: 'INSTITUTION_TASK_EXECUTION_MEASURED',
      message:
        'التنفيذُ واقعةٌ مقيسة: وكيلٌ، وأثرٌ مسمّى، ومخرَجٌ، وبصمتان مختلفتان قبله وبعده. وبصمتان متساويتان تنفيذٌ بلا أثر.',
      /** @param {EntityRecord} record */
      check: (record) => {
        const executedAt = record['executedAt'];
        if (!(executedAt instanceof Date)) {
          return (
            blank(record['effect']) &&
            blank(record['outputId']) &&
            blank(record['fingerprintAfter'])
          );
        }
        const before = record['fingerprintBefore'];
        const after = record['fingerprintAfter'];
        return (
          !blank(record['agentId']) &&
          typeof record['effect'] === 'string' &&
          typeof record['outputId'] === 'string' &&
          typeof before === 'string' &&
          typeof after === 'string' &&
          before !== after
        );
      },
    },
    {
      code: 'INSTITUTION_TASK_REFUSAL_REASONED',
      message:
        'الرفضُ واقعةٌ كاملة: رمزٌ مُعلَنٌ وسببٌ مكتوبٌ يبلغ حدَّه ووقتٌ مسجَّل؛ ولا تُرفض مهمّةٌ نُفِّذت.',
      /** @param {EntityRecord} record */
      check: (record) => {
        const refusedAt = record['refusedAt'];
        if (!(refusedAt instanceof Date)) {
          return blank(record['refusalCode']) && blank(record['refusalReason']);
        }
        const reason = record['refusalReason'];
        return (
          typeof record['refusalCode'] === 'string' &&
          typeof reason === 'string' &&
          reason.trim().length >= INSTITUTION_MIN_REFUSAL_REASON_LENGTH &&
          !(record['executedAt'] instanceof Date)
        );
      },
    },
    {
      code: 'INSTITUTION_TASK_STATE_MATCHES_TIMELINE',
      message:
        'حالةُ المهمّة محسوبةٌ من وقائعها لا مُعلَنةٌ بجانبها؛ وحالةٌ تخالف الوقائعَ حالةٌ تكذب.',
      /** @param {EntityRecord} record */
      check: (record) => {
        const state = record['state'];
        if (state === 'received') {
          return (
            blank(record['agentId']) && blank(record['executedAt']) && blank(record['refusedAt'])
          );
        }
        if (state === 'assigned') {
          return (
            !blank(record['agentId']) && blank(record['executedAt']) && blank(record['refusedAt'])
          );
        }
        if (state === 'executed') return record['executedAt'] instanceof Date;
        return record['refusedAt'] instanceof Date;
      },
    },
  ]),
});

/**
 * مخرَجُ المؤسسة — الخطوة `M8.05`.
 *
 * وهو مخزنٌ **خارج صفِّ المهمّة** مقصوداً: بصمةُ الأثر لو قُرئت من صفِّ المهمّة
 * نفسِه لتغيّرت بمجرّد كتابةِ الصفِّ، فصار «قياسُ الأثر» يقيس كتابتَه هو. ومن
 * هذه الصفوف — لا من نصٍّ محفوظ — يُشتقُّ تقريرُ المؤسسة.
 *
 * و`taskId` فريد: مخرَجان لمهمّةٍ واحدةٍ يجعلان الكلفةَ المقيَّدةَ مرّةً تُنتج
 * أثرين.
 */
/** @type {EntitySpec} */
export const INSTITUTION_OUTPUT_SPEC = Object.freeze({
  name: 'institution_outputs',
  table: 'state.institution_outputs',
  fields: /** @type {Readonly<Record<string, FieldSpec>>} */ (
    Object.freeze({
      id: { column: 'id', type: 'string', required: true, maxLength: 128 },
      institutionId: { column: 'institution_id', type: 'string', required: true, maxLength: 128 },
      taskId: { column: 'task_id', type: 'string', required: true, maxLength: 128 },
      kind: { column: 'kind', type: 'string', required: true, maxLength: 64 },
      effect: { column: 'effect', type: 'string', required: true, maxLength: 120 },
      payload: { column: 'payload', type: 'json', required: true },
      producedBy: { column: 'produced_by', type: 'string', required: true, maxLength: 128 },
      producedAt: { column: 'produced_at', type: 'timestamp', required: true },
      ...MANAGED,
    })
  ),
  unique: Object.freeze([Object.freeze(['taskId'])]),
  filterable: Object.freeze(['institutionId', 'taskId', 'kind']),
  invariants: Object.freeze([
    {
      code: 'INSTITUTION_OUTPUT_ATTRIBUTED',
      message:
        'المخرَجُ منسوبٌ إلى مهمّةٍ وإلى الوكيل الذي أنتجه؛ ومخرَجٌ بلا نسبةٍ لا يُدقَّق ولا يُقرأ في تقرير.',
      /** @param {EntityRecord} record */
      check: (record) => {
        const task = record['taskId'];
        const by = record['producedBy'];
        return (
          typeof task === 'string' &&
          task.trim() !== '' &&
          typeof by === 'string' &&
          by.trim() !== ''
        );
      },
    },
  ]),
});

/**
 * نموذجُ تشغيلِ المؤسسة النافذ — الخطوة `M8.06`.
 *
 * والصفُّ هو **نفاذُ** الاختصاص لا إعلانُه: المجالاتُ والمُستثنياتُ والصلاحياتُ
 * والمحرَّماتُ وسقفُ المدّةِ وجهةُ المساءلةِ ومدّةُ التقرير تُقرأ من هنا وقتَ
 * الفحص، فلا يُوسَّع اختصاصٌ بتعديلِ وثيقةٍ بعد الإنفاذ بلا صفٍّ جديدٍ وأثرٍ.
 *
 * و`institutionKey` فريد: نموذجان لمؤسسةٍ واحدةٍ حدّان يُقرأ أحدُهما مكانَ الآخر.
 */
/** @type {EntitySpec} */
export const INSTITUTION_MANDATE_SPEC = Object.freeze({
  name: 'institution_mandates',
  table: 'state.institution_mandates',
  fields: /** @type {Readonly<Record<string, FieldSpec>>} */ (
    Object.freeze({
      id: { column: 'id', type: 'string', required: true, maxLength: 128 },
      institutionId: { column: 'institution_id', type: 'string', required: true, maxLength: 128 },
      institutionKey: { column: 'charter_key', type: 'string', required: true, maxLength: 64 },
      domains: { column: 'domains', type: 'stringArray', required: true },
      excludedDomains: { column: 'excluded_domains', type: 'stringArray', required: true },
      powers: { column: 'powers', type: 'stringArray', required: true },
      prohibitions: { column: 'prohibitions', type: 'stringArray', required: true },
      budgetPeriodDays: { column: 'budget_period_days', type: 'integer', required: true },
      budgetCeiling: { column: 'budget_ceiling', type: 'integer', required: true },
      accountableTo: { column: 'accountable_to', type: 'string', required: true, maxLength: 64 },
      escalateTo: { column: 'escalate_to', type: 'string', required: true, maxLength: 64 },
      reportingPeriodDays: { column: 'reporting_period_days', type: 'integer', required: true },
      reportingGraceDays: { column: 'reporting_grace_days', type: 'integer', required: true },
      modelVersion: { column: 'model_version', type: 'integer', required: true },
      enactedAt: { column: 'enacted_at', type: 'timestamp', required: true },
      ...MANAGED,
    })
  ),
  unique: Object.freeze([Object.freeze(['institutionKey'])]),
  filterable: Object.freeze(['institutionKey', 'institutionId']),
  invariants: Object.freeze([
    {
      code: 'INSTITUTION_MANDATE_JURISDICTION_DECLARED',
      message:
        'الاختصاصُ مجالٌ واحدٌ على الأقل، ولا مجالَ مُعلَنٌ ومُستثنىً معاً؛ ونموذجٌ بلا مجالٍ يُقرأ إباحةً مطلقةً أو منعاً مطلقاً بحسب من يقرؤه.',
      /** @param {EntityRecord} record */
      check: (record) => {
        const domains = record['domains'];
        const excluded = record['excludedDomains'];
        if (!Array.isArray(domains) || domains.length === 0) return false;
        if (!Array.isArray(excluded)) return false;
        return !excluded.some((entry) => domains.includes(entry));
      },
    },
    {
      code: 'INSTITUTION_MANDATE_POWERS_DECLARED',
      message:
        'الصلاحياتُ الممنوحةُ صلاحيةٌ واحدةٌ على الأقل، ولا صلاحيةَ ممنوحةٌ ومحرَّمةٌ معاً؛ والمحرَّمُ يغلب الممنوحَ فلا يجتمعان في صفٍّ واحد.',
      /** @param {EntityRecord} record */
      check: (record) => {
        const powers = record['powers'];
        const prohibitions = record['prohibitions'];
        if (!Array.isArray(powers) || powers.length === 0) return false;
        if (!Array.isArray(prohibitions)) return false;
        return !prohibitions.some((entry) => powers.includes(entry));
      },
    },
    {
      code: 'INSTITUTION_MANDATE_ACCOUNTABILITY_EXTERNAL',
      message:
        'جهةُ المساءلةِ وجهةُ التصعيد دوران مُعلَنان مختلفان؛ وتصعيدٌ إلى نفس الجهة ليس تصعيداً، ولا يُسائل أحدٌ نفسَه.',
      /** @param {EntityRecord} record */
      check: (record) => {
        const accountableTo = record['accountableTo'];
        const escalateTo = record['escalateTo'];
        if (typeof accountableTo !== 'string' || typeof escalateTo !== 'string') return false;
        if (!/^role:[a-z-]+$/.test(accountableTo) || !/^role:[a-z-]+$/.test(escalateTo))
          return false;
        return accountableTo !== escalateTo;
      },
    },
    {
      code: 'INSTITUTION_MANDATE_PERIODS_POSITIVE',
      message:
        'مدّةُ الميزانيةِ وسقفُها ومدّةُ التقرير أعدادٌ موجبةٌ ومهلةُ السماح غيرُ سالبة؛ وسقفٌ صفريٌّ يمنع كلَّ عملٍ ومدّةٌ صفريةٌ تجعل التقريرَ مستحقّاً دائماً.',
      /** @param {EntityRecord} record */
      check: (record) => {
        const positive = ['budgetPeriodDays', 'budgetCeiling', 'reportingPeriodDays'].every(
          (key) => {
            const value = record[key];
            return typeof value === 'number' && value >= 1;
          },
        );
        const grace = record['reportingGraceDays'];
        return positive && typeof grace === 'number' && grace >= 0;
      },
    },
  ]),
});

/**
 * مخالفةُ اختصاصٍ أو صلاحيةٍ أو سقفٍ أو موعدِ تقرير — الخطوة `M8.06`.
 *
 * والصفُّ **مادّةُ المساءلة**: مُنِعَ ولم يُسجَّل يعني أنّ الجهةَ المسؤولةَ لا
 * تُسأل عن شيء، وأنّ الدورةَ التقريريةَ تُقرأ خاليةً من مخالفةٍ وقعت. ولذلك
 * يُنسَب الصفُّ إلى جهةِ المساءلةِ وجهةِ التصعيد وقتَ الوقوع لا وقتَ القراءة.
 *
 * **وحدٌّ معلَن:** المخالفةُ تُسجَّل ولا تُعالَج: لا تسويةَ ولا إغلاقَ ولا جزاءً
 * يقع على المؤسسة. وذلك أضعفُ من مساءلةٍ كاملةٍ ولا يُدَّعى أنّه هي.
 */
/** @type {EntitySpec} */
export const INSTITUTION_BREACH_SPEC = Object.freeze({
  name: 'institution_breaches',
  table: 'state.institution_breaches',
  fields: /** @type {Readonly<Record<string, FieldSpec>>} */ (
    Object.freeze({
      id: { column: 'id', type: 'string', required: true, maxLength: 200 },
      institutionId: { column: 'institution_id', type: 'string', required: true, maxLength: 128 },
      institutionKey: { column: 'charter_key', type: 'string', required: true, maxLength: 64 },
      taskId: { column: 'task_id', type: 'string', nullable: true, maxLength: 128 },
      code: { column: 'code', type: 'string', required: true, maxLength: 120 },
      domain: { column: 'domain', type: 'string', nullable: true, maxLength: 64 },
      power: { column: 'power', type: 'string', nullable: true, maxLength: 64 },
      detail: { column: 'detail', type: 'string', required: true },
      accountableTo: { column: 'accountable_to', type: 'string', required: true, maxLength: 64 },
      escalateTo: { column: 'escalate_to', type: 'string', required: true, maxLength: 64 },
      detectedAt: { column: 'detected_at', type: 'timestamp', required: true },
      ...MANAGED,
    })
  ),
  unique: Object.freeze([]),
  filterable: Object.freeze(['institutionId', 'institutionKey', 'code', 'taskId']),
  invariants: Object.freeze([
    {
      code: 'INSTITUTION_BREACH_REASONED',
      message:
        'المخالفةُ مكتوبةُ التفصيلِ بحدِّه المُعلَن؛ ومخالفةٌ بلا تفصيلٍ رمزٌ في عمودٍ لا يُسأل عليه أحد.',
      /** @param {EntityRecord} record */
      check: (record) => {
        const detail = record['detail'];
        return (
          typeof detail === 'string' &&
          detail.trim().length >= INSTITUTION_MANDATE_MIN_BREACH_DETAIL_LENGTH
        );
      },
    },
    {
      code: 'INSTITUTION_BREACH_CODE_DECLARED',
      message:
        'رمزُ المخالفةِ من رموزِ نموذجِ التشغيل المُعلَنة؛ ورمزٌ حرٌّ يجعل عدَّ المخالفاتِ في التقرير عدَّ نصوصٍ لا وقائع.',
      /** @param {EntityRecord} record */
      check: (record) => {
        const code = record['code'];
        return typeof code === 'string' && code.startsWith('MANDATE_');
      },
    },
    {
      code: 'INSTITUTION_BREACH_ATTRIBUTED',
      message:
        'المخالفةُ منسوبةٌ إلى جهةِ مساءلةٍ وجهةِ تصعيدٍ مختلفتين؛ ومخالفةٌ بلا جهةٍ تُسأل عنها واقعةٌ تُقرأ ولا تُحاسَب.',
      /** @param {EntityRecord} record */
      check: (record) => {
        const accountableTo = record['accountableTo'];
        const escalateTo = record['escalateTo'];
        return (
          typeof accountableTo === 'string' &&
          typeof escalateTo === 'string' &&
          accountableTo.trim() !== '' &&
          escalateTo.trim() !== '' &&
          accountableTo !== escalateTo
        );
      },
    },
  ]),
});

/**
 * دورةٌ تقريريةٌ مُغلَقة — الخطوة `M8.06`.
 *
 * والتقريرُ **مُشتقٌّ** من صفوفِ المدّة: عددُ مهامِّها ومنفَّذِها ومرفوضِها وما
 * صُرف فيها وعددُ مخالفاتها. ولا نصَّ يُخزَّن ثم يُقرأ تقريراً، فنصٌّ مخزَّنٌ
 * يُكتب مرّةً ويصدق مرّةً.
 *
 * و(المؤسسة، بدايةُ المدّة) فريدٌ: دورتان لمدّةٍ واحدةٍ تقريران يُحتسب بهما
 * العملُ مرّتين.
 */
/** @type {EntitySpec} */
export const INSTITUTION_REPORT_CYCLE_SPEC = Object.freeze({
  name: 'institution_report_cycles',
  table: 'state.institution_report_cycles',
  fields: /** @type {Readonly<Record<string, FieldSpec>>} */ (
    Object.freeze({
      id: { column: 'id', type: 'string', required: true, maxLength: 200 },
      institutionId: { column: 'institution_id', type: 'string', required: true, maxLength: 128 },
      institutionKey: { column: 'charter_key', type: 'string', required: true, maxLength: 64 },
      periodStart: { column: 'period_start', type: 'timestamp', required: true },
      periodEnd: { column: 'period_end', type: 'timestamp', required: true },
      dueAt: { column: 'due_at', type: 'timestamp', required: true },
      closedAt: { column: 'closed_at', type: 'timestamp', required: true },
      closedBy: { column: 'closed_by', type: 'string', required: true, maxLength: 64 },
      tasksTotal: { column: 'tasks_total', type: 'integer', required: true },
      tasksExecuted: { column: 'tasks_executed', type: 'integer', required: true },
      tasksRefused: { column: 'tasks_refused', type: 'integer', required: true },
      breachCount: { column: 'breach_count', type: 'integer', required: true },
      budgetConsumed: { column: 'budget_consumed', type: 'integer', required: true },
      ...MANAGED,
    })
  ),
  unique: Object.freeze([Object.freeze(['institutionKey', 'periodStart'])]),
  filterable: Object.freeze(['institutionId', 'institutionKey']),
  invariants: Object.freeze([
    {
      code: 'INSTITUTION_CYCLE_WINDOW_ORDERED',
      message:
        'مدّةُ الدورةِ تبدأ قبل أن تنتهي، واستحقاقُها بعد انتهائها؛ ومدّةٌ مقلوبةُ الحدَّين لا يُقرأ فيها شيء.',
      /** @param {EntityRecord} record */
      check: (record) => {
        const start = record['periodStart'];
        const end = record['periodEnd'];
        const dueAt = record['dueAt'];
        if (!(start instanceof Date) || !(end instanceof Date) || !(dueAt instanceof Date)) {
          return false;
        }
        return start.getTime() < end.getTime() && end.getTime() <= dueAt.getTime();
      },
    },
    {
      code: 'INSTITUTION_CYCLE_CLOSED_AFTER_PERIOD',
      message:
        'الدورةُ تُغلَق بعد انقضاء مدّتها؛ وإغلاقٌ قبلها يُنتج تقريراً عن مدّةٍ لم تكتمل فيُقرأ أداءً كاملاً وهو جزءٌ منه.',
      /** @param {EntityRecord} record */
      check: (record) => {
        const end = record['periodEnd'];
        const closedAt = record['closedAt'];
        if (!(end instanceof Date) || !(closedAt instanceof Date)) return false;
        return closedAt.getTime() >= end.getTime();
      },
    },
    {
      code: 'INSTITUTION_CYCLE_COUNTS_COHERENT',
      message:
        'أعدادُ الدورةِ غيرُ سالبةٍ ومجموعُ المنفَّذِ والمرفوضِ لا يتجاوز مهامَّها؛ وعددٌ يتجاوز مجموعَه تقريرٌ يُقرأ ولا يُصدَّق.',
      /** @param {EntityRecord} record */
      check: (record) => {
        const counts = [
          'tasksTotal',
          'tasksExecuted',
          'tasksRefused',
          'breachCount',
          'budgetConsumed',
        ].map((key) => record[key]);
        if (!counts.every((value) => typeof value === 'number' && value >= 0)) return false;
        const [total = 0, executed = 0, refused = 0] = /** @type {number[]} */ (counts);
        return executed + refused <= total;
      },
    },
  ]),
});

/**
 * حدُّ سببِ الرفضِ الترابيِّ وسببِ سحبِ التفويض — الخطوة `M8.07`. ونفسُ الرقمِ
 * قيدٌ في الهجرة 0016 ومُعلَنٌ في `config/federation-delegation.yaml`، والبوابةُ
 * 23 تفحص وقوعَه في موضعه من القيد.
 */
export const FEDERATION_MIN_REASON_LENGTH = 20;

/** حدُّ موضوعِ الفعلِ الترابي: فعلٌ بلا موضوعٍ مكتوبٍ لا يُراجَع ولا يُنسَب. */
export const FEDERATION_MIN_SUBJECT_LENGTH = 20;

/**
 * تفويضُ ترابٍ نافذٌ أو مسحوب — الخطوة `M8.07`.
 *
 * والصفُّ **سندُ السلطة**: صلاحياتُ المستوى ودورُ ممارستها وأصلُه الترابيُّ ووقتُ
 * نفاذِ التفويضِ ووقتُ سحبه. وسحبُ التفويضِ يُكتب في الصفِّ نفسِه لا في جدولٍ
 * آخر: حالٌ تُقرأ من موضعين تُقرأ متعارضةً في اللحظة التي يهمّ فيها الفرق.
 *
 * **وحدٌّ معلَن:** لا مُخصَّصَ ولا سقفَ صرفٍ ترابيّاً في هذا الصفّ: ميزانيةُ
 * الترابِ ليست في `M8.07`.
 */
/** @type {EntitySpec} */
export const FEDERATION_DELEGATION_SPEC = Object.freeze({
  name: 'federation_delegations',
  table: 'state.federation_delegations',
  fields: /** @type {Readonly<Record<string, FieldSpec>>} */ (
    Object.freeze({
      id: { column: 'id', type: 'string', required: true, maxLength: 128 },
      territoryKey: { column: 'territory_key', type: 'string', required: true, maxLength: 32 },
      level: {
        column: 'level',
        type: 'enum',
        required: true,
        values: Object.freeze(['region', 'province', 'municipality']),
      },
      parentKey: { column: 'parent_key', type: 'string', nullable: true, maxLength: 32 },
      exercisedBy: { column: 'exercised_by', type: 'string', required: true, maxLength: 64 },
      powers: { column: 'powers', type: 'stringArray', required: true },
      kinds: { column: 'kinds', type: 'stringArray', required: true },
      modelVersion: { column: 'model_version', type: 'integer', required: true },
      activatedAt: { column: 'activated_at', type: 'timestamp', required: true },
      activatedBy: { column: 'activated_by', type: 'string', required: true, maxLength: 64 },
      revokedAt: { column: 'revoked_at', type: 'timestamp', nullable: true },
      revokedBy: { column: 'revoked_by', type: 'string', nullable: true, maxLength: 64 },
      revocationReason: { column: 'revocation_reason', type: 'string', nullable: true },
      ...MANAGED,
    })
  ),
  unique: Object.freeze([Object.freeze(['territoryKey'])]),
  filterable: Object.freeze(['territoryKey', 'level', 'parentKey']),
  invariants: Object.freeze([
    {
      code: 'FEDERATION_DELEGATION_LEVEL_KEY_SHAPED',
      message:
        'مفتاحُ الترابِ يطابق مرتبتَه: الإقليمُ `Rnnn`، والولايةُ `Pnnn-nn`، والبلديةُ `Pnnn-nn-nnn`؛ ومفتاحٌ لا يقول مرتبتَه يُقرأ في غيرِ موضعه من الشجرة.',
      /** @param {EntityRecord} record */
      check: (record) => {
        const key = record['territoryKey'];
        const level = record['level'];
        if (typeof key !== 'string' || typeof level !== 'string') return false;
        if (level === 'region') return /^R[0-9]{3}$/.test(key);
        if (level === 'province') return /^P[0-9]{3}-[0-9]{2}$/.test(key);
        return /^P[0-9]{3}-[0-9]{2}-[0-9]{3}$/.test(key);
      },
    },
    {
      code: 'FEDERATION_DELEGATION_PARENT_COHERENT',
      message:
        'الإقليمُ بلا أصلٍ ترابيٍّ وفوقَه المركز، وما دونه أصلُه مُعلَنٌ وهو من ترابه بحسب مفتاحه؛ وفرعٌ بلا أصلٍ سلطةٌ بلا مصدر.',
      /** @param {EntityRecord} record */
      check: (record) => {
        const key = record['territoryKey'];
        const level = record['level'];
        const parent = record['parentKey'];
        if (typeof key !== 'string' || typeof level !== 'string') return false;
        if (level === 'region') return parent === null;
        if (typeof parent !== 'string' || parent === '') return false;
        // أصلُ الولايةِ إقليمٌ مفتاحُه `Rnnn` ومفتاحُها `Pnnn-nn`: القرابةُ بالرقم
        // لا بالحرف. وأصلُ البلديةِ ولايةٌ فمفتاحُها امتدادُ مفتاحِ أصله نصّاً.
        if (/^R[0-9]{3}$/.test(parent)) return key.startsWith(`P${parent.slice(1)}-`);
        return key.startsWith(`${parent}-`);
      },
    },
    {
      code: 'FEDERATION_DELEGATION_POWERS_DECLARED',
      message:
        'التفويضُ صلاحيةٌ واحدةٌ على الأقلّ ونوعُ فعلٍ واحدٌ على الأقلّ؛ وتفويضٌ بلا صلاحيةٍ إعلانُ سلطةٍ لا تُمارَس فلا يُقاس سحبُها.',
      /** @param {EntityRecord} record */
      check: (record) => {
        const powers = record['powers'];
        const kinds = record['kinds'];
        return (
          Array.isArray(powers) && powers.length > 0 && Array.isArray(kinds) && kinds.length > 0
        );
      },
    },
    {
      code: 'FEDERATION_DELEGATION_REVOCATION_COMPLETE',
      message:
        'السحبُ وقتٌ وفاعلٌ وسببٌ مكتوبٌ يبلغ الحدَّ المُعلَن، والثلاثةُ تحضر معاً أو تغيب معاً؛ وسحبٌ بلا سببٍ قرارٌ لا يُراجَع، وسببٌ بلا وقتٍ سحبٌ لا يُعرَف متى نفَذ.',
      /** @param {EntityRecord} record */
      check: (record) => {
        const at = record['revokedAt'];
        const by = record['revokedBy'];
        const reason = record['revocationReason'];
        if (at === null) return by === null && reason === null;
        if (!(at instanceof Date)) return false;
        if (typeof by !== 'string' || by === '') return false;
        return typeof reason === 'string' && reason.trim().length >= FEDERATION_MIN_REASON_LENGTH;
      },
    },
    {
      code: 'FEDERATION_DELEGATION_REVOKED_AFTER_ACTIVATION',
      message: 'السحبُ لا يسبق التفويض؛ وسحبٌ قبل نفاذِه يُقرأ سلطةً سُحبت قبل أن تُمنح.',
      /** @param {EntityRecord} record */
      check: (record) => {
        const at = record['revokedAt'];
        const from = record['activatedAt'];
        if (at === null) return true;
        return at instanceof Date && from instanceof Date && at.getTime() >= from.getTime();
      },
    },
  ]),
});

/**
 * سجلُّ التفويضاتِ النافذة — الخطوة `M8.08`.
 *
 * **العيبُ الذي يعالجه هذا الصف:** في `M8.07` كان أثرُ التفويضِ يُقرأ من صفِّ
 * التفويضِ وحدَه، فلا يُعرَف **بأيِّ أمرٍ** فُوِّض الترابُ ولا بأيِّ أمرٍ سُحب، ولا
 * كم استغرق نفاذُ السحبِ من لحظةِ إصدارِ أمره. وهذا الصفُّ **أثرُ أمرٍ ملكيٍّ واحد**:
 * معرّفُه لا يتكرّر، ووقتُ إصداره ووقتُ نفاذه محفوظان، والزمنُ بينهما مقيسٌ
 * ومقابَلٌ بمهلةٍ مُعلَنة. والصفوفُ **لا تُحدَّث**: تسلسلُ الأوامرِ هو السجل.
 */
/** @type {EntitySpec} */
export const FEDERATION_REGISTER_SPEC = Object.freeze({
  name: 'federation_delegation_register',
  table: 'state.federation_delegation_register',
  fields: /** @type {Readonly<Record<string, FieldSpec>>} */ (
    Object.freeze({
      id: { column: 'id', type: 'string', required: true, maxLength: 128 },
      commandId: { column: 'command_id', type: 'string', required: true, maxLength: 128 },
      action: { column: 'action', type: 'string', required: true, maxLength: 64 },
      effect: {
        column: 'effect',
        type: 'enum',
        required: true,
        values: Object.freeze(['GRANT', 'REVOKE']),
      },
      territoryKey: { column: 'territory_key', type: 'string', required: true, maxLength: 32 },
      level: {
        column: 'level',
        type: 'enum',
        required: true,
        values: Object.freeze(['region', 'province', 'municipality']),
      },
      actorRole: { column: 'actor_role', type: 'string', required: true, maxLength: 64 },
      issuedAt: { column: 'issued_at', type: 'timestamp', required: true },
      acceptedAt: { column: 'accepted_at', type: 'timestamp', required: true },
      effectiveAt: { column: 'effective_at', type: 'timestamp', required: true },
      latencyMs: { column: 'latency_ms', type: 'integer', required: true },
      deadlineMs: { column: 'deadline_ms', type: 'integer', nullable: true },
      withinDeadline: { column: 'within_deadline', type: 'boolean', nullable: true },
      reason: { column: 'reason', type: 'string', nullable: true },
      ...MANAGED,
    })
  ),
  unique: Object.freeze([Object.freeze(['commandId'])]),
  filterable: Object.freeze(['commandId', 'territoryKey', 'effect', 'level']),
  invariants: Object.freeze([
    {
      code: 'FEDERATION_REGISTER_TIMES_ORDERED',
      message:
        'وقتُ الإصدارِ ثم القبولِ ثم النفاذ، بهذا الترتيبِ لا غيره؛ وأمرٌ نفَذ قبل أن يُقبل أو قُبل قبل أن يُصدر زمنٌ لا يُقرأ منه سببٌ ولا يُقاس منه تأخُّر.',
      /** @param {EntityRecord} record */
      check: (record) => {
        const issued = record['issuedAt'];
        const accepted = record['acceptedAt'];
        const effective = record['effectiveAt'];
        if (!(issued instanceof Date) || !(accepted instanceof Date)) return false;
        if (!(effective instanceof Date)) return false;
        return accepted.getTime() >= issued.getTime() && effective.getTime() >= accepted.getTime();
      },
    },
    {
      code: 'FEDERATION_REGISTER_LATENCY_MEASURED',
      message:
        'الزمنُ المقيسُ هو الفارقُ بين إصدارِ الأمرِ ونفاذِ أثره بالميلي ثانية، غيرَ سالبٍ ومطابقاً للوقتين المحفوظين؛ ورقمٌ لا يُشتقّ من وقتين محفوظين رقمٌ يُكتب باليد.',
      /** @param {EntityRecord} record */
      check: (record) => {
        const issued = record['issuedAt'];
        const effective = record['effectiveAt'];
        const latency = record['latencyMs'];
        if (!(issued instanceof Date) || !(effective instanceof Date)) return false;
        if (typeof latency !== 'number' || !Number.isInteger(latency) || latency < 0) return false;
        return latency === effective.getTime() - issued.getTime();
      },
    },
    {
      code: 'FEDERATION_REGISTER_DEADLINE_JUDGED',
      message:
        'السحبُ وحدَه له مهلةٌ مُعلَنةٌ وحكمٌ عليها، والحكمُ محسوبٌ من الزمنِ المقيسِ لا مكتوبٌ استقلالاً؛ ومنحٌ بمهلةٍ أو سحبٌ بلا حكمٍ على مهلته سجلٌّ يُقرأ منه ما لم يُقَس.',
      /** @param {EntityRecord} record */
      check: (record) => {
        const effect = record['effect'];
        const deadline = record['deadlineMs'];
        const within = record['withinDeadline'];
        const latency = record['latencyMs'];
        if (effect === 'GRANT') return deadline === null && within === null;
        if (typeof deadline !== 'number' || !Number.isInteger(deadline) || deadline <= 0)
          return false;
        if (typeof latency !== 'number') return false;
        return within === latency <= deadline;
      },
    },
    {
      code: 'FEDERATION_REGISTER_REASON_BOUND_TO_EFFECT',
      message:
        'لكلِّ سحبٍ سببٌ مكتوبٌ يبلغ الحدَّ المُعلَن، ولا سببَ لمنحٍ؛ وسحبٌ بلا سببٍ في السجلِّ سيادةٌ سُحبت بلا موجبٍ يُقرأ.',
      /** @param {EntityRecord} record */
      check: (record) => {
        const effect = record['effect'];
        const reason = record['reason'];
        if (effect === 'GRANT') return reason === null;
        return typeof reason === 'string' && reason.trim().length >= FEDERATION_MIN_REASON_LENGTH;
      },
    },
  ]),
});

/**
 * فعلٌ ترابيٌّ مُمارَسٌ فعلاً — الخطوة `M8.07`.
 *
 * والصفُّ **دليلُ الاستقلال**: فعلٌ وقع في ترابٍ بدورِ مستواه، لا بإذنٍ مركزيٍّ
 * لكلِّ فعل. ويحمل الترابَ المعمولَ فيه والمستوى الذي مارسه، وهما قد يختلفان:
 * الأصلُ يعمل في فرعه ولا يعمل الفرعُ في غيرِ ترابه.
 *
 * **وحدٌّ معلَن:** المخرَجُ نصُّ الموضوعِ في الصفِّ نفسِه، فلا منفِّذَ أثرٍ خارجيٌّ
 * ولا مخرَجٌ في مخزنٍ مستقلٍّ كما في `M8.05`.
 */
/** @type {EntitySpec} */
export const FEDERATION_ACT_SPEC = Object.freeze({
  name: 'federation_local_acts',
  table: 'state.federation_local_acts',
  fields: /** @type {Readonly<Record<string, FieldSpec>>} */ (
    Object.freeze({
      id: { column: 'id', type: 'string', required: true, maxLength: 128 },
      territoryKey: { column: 'territory_key', type: 'string', required: true, maxLength: 32 },
      actingKey: { column: 'acting_key', type: 'string', required: true, maxLength: 32 },
      level: {
        column: 'level',
        type: 'enum',
        required: true,
        values: Object.freeze(['region', 'province', 'municipality']),
      },
      kind: { column: 'kind', type: 'string', required: true, maxLength: 64 },
      power: { column: 'power', type: 'string', required: true, maxLength: 64 },
      subject: { column: 'subject', type: 'string', required: true, maxLength: 2000 },
      exercisedBy: { column: 'exercised_by', type: 'string', required: true, maxLength: 64 },
      exercisedAt: { column: 'exercised_at', type: 'timestamp', required: true },
      ...MANAGED,
    })
  ),
  unique: Object.freeze([]),
  filterable: Object.freeze(['territoryKey', 'actingKey', 'level', 'kind']),
  invariants: Object.freeze([
    {
      code: 'FEDERATION_ACT_SUBJECT_SUBSTANTIAL',
      message:
        'موضوعُ الفعلِ مكتوبٌ بحدٍّ معلَن؛ وفعلٌ بموضوعٍ فارغٍ أو حرفين لا يُراجَع ولا يُعرَف ما وقع به.',
      /** @param {EntityRecord} record */
      check: (record) => {
        const subject = record['subject'];
        return (
          typeof subject === 'string' && subject.trim().length >= FEDERATION_MIN_SUBJECT_LENGTH
        );
      },
    },
    {
      code: 'FEDERATION_ACT_WITHIN_ACTING_TERRITORY',
      message:
        'الفعلُ في ترابِ من مارسه أو في فرعٍ منه؛ وفعلٌ خارجَ ترابِ صاحبه سلطةٌ عبرت حدَّها فلا يبقى للعزلِ معنى.',
      /** @param {EntityRecord} record */
      check: (record) => {
        const territory = record['territoryKey'];
        const acting = record['actingKey'];
        if (typeof territory !== 'string' || typeof acting !== 'string') return false;
        if (territory === acting) return true;
        if (/^R[0-9]{3}$/.test(acting)) return territory.startsWith(`P${acting.slice(1)}-`);
        return territory.startsWith(`${acting}-`);
      },
    },
  ]),
});

/**
 * رفضُ فعلٍ ترابيٍّ — الخطوة `M8.07`.
 *
 * والصفُّ **مادّةُ مراجعةِ العزل**: مُنِعَ ولم يُسجَّل يعني أنّ الترابَ المتجاوِزَ
 * لا يُقرأ في أيِّ جدول، وأنّ سحبَ التفويضِ لا يُعرَف أنّه أوقف عملاً. ويُحفظ فيه
 * **الترابُ المطلوبُ** مع ترابِ من طلبه: الفرقُ بينهما هو الخروجُ من الحدّ.
 *
 * **وحدٌّ معلَن:** الرفضُ يُسجَّل ولا يُعالَج: لا تصعيدَ ولا إشعارَ لجهةٍ ولا جزاءَ
 * يقع. وذلك أضعفُ من مساءلةٍ كاملةٍ ولا يُدَّعى أنّه هي.
 */
/** @type {EntitySpec} */
export const FEDERATION_REFUSAL_SPEC = Object.freeze({
  name: 'federation_refusals',
  table: 'state.federation_refusals',
  fields: /** @type {Readonly<Record<string, FieldSpec>>} */ (
    Object.freeze({
      id: { column: 'id', type: 'string', required: true, maxLength: 200 },
      territoryKey: { column: 'territory_key', type: 'string', nullable: true, maxLength: 32 },
      requestedTerritoryKey: {
        column: 'requested_territory_key',
        type: 'string',
        required: true,
        maxLength: 32,
      },
      level: { column: 'level', type: 'string', nullable: true, maxLength: 32 },
      kind: { column: 'kind', type: 'string', nullable: true, maxLength: 64 },
      power: { column: 'power', type: 'string', nullable: true, maxLength: 64 },
      code: { column: 'code', type: 'string', required: true, maxLength: 120 },
      reason: { column: 'reason', type: 'string', required: true, maxLength: 2000 },
      actorRole: { column: 'actor_role', type: 'string', nullable: true, maxLength: 64 },
      refusedAt: { column: 'refused_at', type: 'timestamp', required: true },
      ...MANAGED,
    })
  ),
  unique: Object.freeze([]),
  filterable: Object.freeze(['territoryKey', 'requestedTerritoryKey', 'code', 'level']),
  invariants: Object.freeze([
    {
      code: 'FEDERATION_REFUSAL_REASON_SUBSTANTIAL',
      message:
        'سببُ الرفضِ مكتوبٌ بحدٍّ معلَن؛ ورفضٌ بلا سببٍ مكتوبٍ يُقرأ بعد حينٍ منعاً بلا موجبٍ فلا يُراجَع ولا يُنقَض.',
      /** @param {EntityRecord} record */
      check: (record) => {
        const reason = record['reason'];
        return typeof reason === 'string' && reason.trim().length >= FEDERATION_MIN_REASON_LENGTH;
      },
    },
    {
      code: 'FEDERATION_REFUSAL_CODE_DECLARED',
      message:
        'رمزُ الرفضِ رمزٌ من رموزِ التفويض الترابي المُعلَنة؛ ورمزٌ حرٌّ يجعل جدولَ الرفوضِ نصّاً لا يُصنَّف.',
      /** @param {EntityRecord} record */
      check: (record) => {
        const code = record['code'];
        return typeof code === 'string' && /^FEDERATION_[A-Z_]+$/.test(code);
      },
    },
  ]),
});

/** كل المواصفات المُعلنة، للاستعمال في الاختبارات والأدوات. */
/**
 * التقريرُ الملكيُّ الدوريُّ — الخطوة `M8.09`.
 *
 * الصفُّ يحفظ **النافذةَ** التي قِيس عليها، و**عددَ الحقولِ** المعلَنةِ والمقيسةِ
 * والتقديرية، و**بصمةَ القياس** كي يُعاد القياسُ عند النشر فيُردَّ التقريرُ إن
 * تغيّرت الصفوف، و**أقسامَه** بحقولها كما قِيست: كلُّ حقلٍ بقيمتِه ومصدرِه وعددِ
 * الصفوف، أو بفرضيتِه إن كان تقديريّاً معلَناً.
 */
export const ROYAL_REPORT_SPEC = Object.freeze({
  name: 'royal_reports',
  table: 'state.royal_reports',
  fields: /** @type {Readonly<Record<string, FieldSpec>>} */ (
    Object.freeze({
      id: { column: 'id', type: 'string', required: true, maxLength: 128 },
      reportId: { column: 'report_id', type: 'string', required: true, maxLength: 128 },
      periodStart: { column: 'period_start', type: 'timestamp', required: true },
      periodEnd: { column: 'period_end', type: 'timestamp', required: true },
      generatedBy: { column: 'generated_by', type: 'string', required: true, maxLength: 64 },
      generatedAt: { column: 'generated_at', type: 'timestamp', required: true },
      state: {
        column: 'state',
        type: 'enum',
        required: true,
        values: Object.freeze(['generated', 'reviewed', 'rejected', 'published']),
      },
      fieldsDeclared: { column: 'fields_declared', type: 'integer', required: true },
      fieldsMeasured: { column: 'fields_measured', type: 'integer', required: true },
      fieldsEstimated: { column: 'fields_estimated', type: 'integer', required: true },
      digest: { column: 'digest', type: 'string', required: true, maxLength: 64 },
      sections: { column: 'sections', type: 'json', required: true },
      reviewer: { column: 'reviewer', type: 'string', nullable: true, maxLength: 128 },
      reviewDecision: {
        column: 'review_decision',
        type: 'enum',
        nullable: true,
        values: Object.freeze(['accept', 'reject']),
      },
      reviewReason: { column: 'review_reason', type: 'string', nullable: true },
      reviewedAt: { column: 'reviewed_at', type: 'timestamp', nullable: true },
      publishCommandId: {
        column: 'publish_command_id',
        type: 'string',
        nullable: true,
        maxLength: 128,
      },
      publishedAt: { column: 'published_at', type: 'timestamp', nullable: true },
      modelVersion: { column: 'model_version', type: 'integer', required: true },
      ...MANAGED,
    })
  ),
  unique: Object.freeze([Object.freeze(['reportId'])]),
  filterable: Object.freeze(['reportId', 'state', 'generatedBy']),
  invariants: Object.freeze([
    {
      code: 'ROYAL_REPORT_PERIOD_ORDERED',
      message:
        'نافذةُ التقريرِ تبدأُ قبل أن تنتهي، والتوليدُ بعد انتهائها؛ ونافذةٌ مقلوبةٌ أو تقريرٌ يُولَّد قبل انقضاءِ مدّته تقريرٌ عن مدّةٍ لم تكتمل.',
      /** @param {EntityRecord} record */
      check: (record) => {
        const start = record['periodStart'];
        const end = record['periodEnd'];
        const generated = record['generatedAt'];
        if (!(start instanceof Date) || !(end instanceof Date)) return false;
        if (!(generated instanceof Date)) return false;
        return end.getTime() > start.getTime() && generated.getTime() >= end.getTime();
      },
    },
    {
      code: 'ROYAL_REPORT_FIELDS_MEASURED',
      message:
        'مجموعُ المقيسِ والتقديريِّ هو عددُ الحقولِ المعلَنة، وكلُّها موجبة؛ وتقريرٌ تُعلَن حقولُه ولا تُغطّى تقريرٌ ناقصٌ يُقرأ كاملاً.',
      /** @param {EntityRecord} record */
      check: (record) => {
        const declared = record['fieldsDeclared'];
        const measured = record['fieldsMeasured'];
        const estimated = record['fieldsEstimated'];
        if (typeof declared !== 'number' || !Number.isInteger(declared) || declared <= 0) {
          return false;
        }
        if (typeof measured !== 'number' || !Number.isInteger(measured) || measured < 0) {
          return false;
        }
        if (typeof estimated !== 'number' || !Number.isInteger(estimated) || estimated < 0) {
          return false;
        }
        return measured + estimated === declared;
      },
    },
    {
      code: 'ROYAL_REPORT_ESTIMATES_DECLARED',
      message:
        'كلُّ حقلٍ في الأقسامِ إمّا مقيسٌ بمصدرٍ مُسمّى، وإمّا تقديريٌّ بفرضيةٍ مكتوبةٍ وقيمةٍ غيرِ معروفة؛ وحقلٌ ثالثٌ حقلٌ تقديريٌّ غيرُ معلَن.',
      /** @param {EntityRecord} record */
      check: (record) => {
        const sections = record['sections'];
        if (!Array.isArray(sections) || sections.length === 0) return false;
        let estimated = 0;
        let measured = 0;
        for (const entry of sections) {
          if (entry === null || typeof entry !== 'object') return false;
          const field = /** @type {Record<string, unknown>} */ (entry);
          if (typeof field['id'] !== 'string' || field['id'] === '') return false;
          if (field['estimated'] === true) {
            if (typeof field['assumption'] !== 'string' || field['assumption'].length < 60) {
              return false;
            }
            if (field['value'] !== null) return false;
            estimated += 1;
            continue;
          }
          if (field['estimated'] !== false) return false;
          if (typeof field['measuredFrom'] !== 'string' || field['measuredFrom'] === '') {
            return false;
          }
          const value = field['value'];
          const rowCount = field['rowCount'];
          if (typeof rowCount !== 'number' || !Number.isInteger(rowCount) || rowCount < 0) {
            return false;
          }
          if (value === null && rowCount !== 0) return false;
          if (value !== null && typeof value !== 'number' && typeof value !== 'string') {
            return false;
          }
          measured += 1;
        }
        return measured === record['fieldsMeasured'] && estimated === record['fieldsEstimated'];
      },
    },
    {
      code: 'ROYAL_REPORT_REVIEW_BOUND',
      message:
        'المراجعةُ إمّا كاملةٌ (مراجعٌ وقرارٌ وسببٌ ووقت) وإمّا غائبةٌ كلُّها؛ ومراجعةٌ نصفُها مكتوبٌ مراجعةٌ لا يُعرف من أجراها.',
      /** @param {EntityRecord} record */
      check: (record) => {
        const parts = [
          record['reviewer'],
          record['reviewDecision'],
          record['reviewReason'],
          record['reviewedAt'],
        ];
        const filled = parts.filter((part) => part !== null && part !== undefined).length;
        if (filled !== 0 && filled !== parts.length) return false;
        if (filled === 0) return record['state'] === 'generated';
        return true;
      },
    },
    {
      code: 'ROYAL_REPORT_PUBLISH_REQUIRES_REVIEW',
      message:
        'التقريرُ المنشورُ له أمرُ نشرٍ ووقتُ نشرٍ ومراجعةٌ قابلة، وغيرُ المنشورِ لا أمرَ نشرٍ له؛ ونشرٌ بلا أمرٍ نشرٌ بلا سلطة.',
      /** @param {EntityRecord} record */
      check: (record) => {
        const published = record['state'] === 'published';
        const command = record['publishCommandId'];
        const when = record['publishedAt'];
        if (!published) return command === null && when === null;
        if (typeof command !== 'string' || command === '') return false;
        if (!(when instanceof Date)) return false;
        return record['reviewDecision'] === 'accept';
      },
    },
  ]),
});

export const ENTITY_SPECS = Object.freeze({
  agents: AGENT_SPEC,
  models: MODEL_SPEC,
  data_assets: DATA_ASSET_SPEC,
  memories: MEMORY_SPEC,
  laws: LAW_SPEC,
  classification_approvals: CLASSIFICATION_APPROVAL_SPEC,
  data_lineage: DATA_LINEAGE_SPEC,
  erasure_records: ERASURE_RECORD_SPEC,
  scheduled_runs: SCHEDULED_RUN_SPEC,
  event_messages: EVENT_MESSAGE_SPEC,
  event_offsets: EVENT_OFFSET_SPEC,
  cases: CASE_SPEC,
  institutions: INSTITUTION_SPEC,
  institution_tasks: INSTITUTION_TASK_SPEC,
  institution_outputs: INSTITUTION_OUTPUT_SPEC,
  institution_mandates: INSTITUTION_MANDATE_SPEC,
  institution_breaches: INSTITUTION_BREACH_SPEC,
  institution_report_cycles: INSTITUTION_REPORT_CYCLE_SPEC,
  federation_delegations: FEDERATION_DELEGATION_SPEC,
  federation_local_acts: FEDERATION_ACT_SPEC,
  federation_refusals: FEDERATION_REFUSAL_SPEC,
  federation_delegation_register: FEDERATION_REGISTER_SPEC,
  royal_reports: ROYAL_REPORT_SPEC,
});

/**
 * @param {string} code
 * @param {string} message
 * @returns {never}
 */
function invalid(code, message) {
  throw new RepositoryError(REPOSITORY_ERRORS.INVALID_RECORD, `${code}: ${message}`);
}

/**
 * تحقّق من قيمة حقل واحد بحسب مواصفته.
 * @param {string} field
 * @param {FieldSpec} spec
 * @param {unknown} value
 * @returns {void}
 */
function checkField(field, spec, value) {
  if (value === null) {
    if (spec.nullable !== true) invalid('FIELD_NULL', `الحقل ${field} لا يُقبل فراغه.`);
    return;
  }
  switch (spec.type) {
    case 'string':
      if (typeof value !== 'string' || value.trim() === '') {
        invalid('FIELD_TYPE', `الحقل ${field} يجب أن يكون نصاً غير فارغ.`);
      } else if (spec.maxLength !== undefined && value.length > spec.maxLength) {
        invalid('FIELD_LENGTH', `الحقل ${field} أطول من ${spec.maxLength}.`);
      }
      return;
    case 'enum':
      if (typeof value !== 'string' || spec.values === undefined || !spec.values.includes(value)) {
        invalid('FIELD_ENUM', `الحقل ${field} خارج القيم المسموحة: ${String(value)}.`);
      }
      return;
    case 'stringArray':
      if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
        invalid('FIELD_ARRAY', `الحقل ${field} يجب أن يكون مصفوفة نصوص.`);
      }
      return;
    case 'integer':
      if (typeof value !== 'number' || !Number.isInteger(value)) {
        invalid('FIELD_INTEGER', `الحقل ${field} يجب أن يكون عدداً صحيحاً.`);
      }
      return;
    case 'boolean':
      if (typeof value !== 'boolean') invalid('FIELD_BOOLEAN', `الحقل ${field} منطقي.`);
      return;
    case 'timestamp':
      if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
        invalid('FIELD_TIMESTAMP', `الحقل ${field} يجب أن يكون تاريخاً صالحاً.`);
      }
      return;
    case 'json':
      if (typeof value !== 'object') invalid('FIELD_JSON', `الحقل ${field} كائن.`);
      return;
    default:
      invalid('FIELD_UNKNOWN_TYPE', `نوع غير معروف للحقل ${field}.`);
  }
}

/**
 * تحقّق من سجل كامل: الحقول المعروفة، والإلزامية، والقيم، ثم الثوابت المركّبة.
 * يُستدعى في تطبيقَي المستودع معاً فيتطابق سلوكهما عند الرفض لا عند القبول وحده.
 * @param {EntitySpec} spec
 * @param {EntityRecord} record
 * @param {object} [options]
 * @param {boolean} [options.partial] لا تفحص الإلزامية (للتحديث الجزئي).
 * @returns {void}
 */
export function validateRecord(spec, record, options = {}) {
  for (const key of Object.keys(record)) {
    if (!Object.hasOwn(spec.fields, key)) {
      throw new RepositoryError(
        REPOSITORY_ERRORS.UNKNOWN_FIELD,
        `حقل غير معروف في ${spec.name}: ${key}`,
      );
    }
  }
  for (const [field, fieldSpec] of Object.entries(spec.fields)) {
    const present = Object.hasOwn(record, field);
    if (!present) {
      if (options.partial !== true && fieldSpec.required === true && fieldSpec.managed !== true) {
        invalid('FIELD_MISSING', `الحقل الإلزامي ${field} غائب في ${spec.name}.`);
      }
      continue;
    }
    checkField(field, fieldSpec, record[field]);
  }
  if (Object.hasOwn(record, 'id')) {
    const id = record['id'];
    if (typeof id !== 'string' || !ID_PATTERN.test(id)) {
      invalid('ID_SHAPE', 'المعرّف يجب أن يطابق نمط معرّفات الدولة (3–128 محرفاً).');
    }
  }
  if (options.partial === true) return;
  for (const invariant of spec.invariants) {
    if (!invariant.check(record)) invalid(invariant.code, invariant.message);
  }
}

/**
 * أعِد السجل بالحقول الاختيارية الغائبة مملوءة بفراغها المُعلن، كي لا يختلف شكل
 * ما تُرجعه الذاكرة عن شكل ما تُرجعه القاعدة.
 * @param {EntitySpec} spec
 * @param {EntityRecord} record
 * @returns {EntityRecord}
 */
export function withDeclaredBlanks(spec, record) {
  /** @type {EntityRecord} */
  const filled = { ...record };
  for (const [field, fieldSpec] of Object.entries(spec.fields)) {
    if (Object.hasOwn(filled, field)) continue;
    if (fieldSpec.type === 'stringArray') filled[field] = [];
    else if (fieldSpec.nullable === true) filled[field] = null;
  }
  return filled;
}
