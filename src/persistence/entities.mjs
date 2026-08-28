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
 * `Map` تُمحى بإعادة التشغيل. فكان في الدولة جدولُ قضايا فارغٌ أبداً، وقضاءٌ
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
  filterable: Object.freeze(['institutionId', 'state', 'kind', 'agentId']),
  invariants: Object.freeze([
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

/** كل المواصفات المُعلنة، للاستعمال في الاختبارات والأدوات. */
export const ENTITY_SPECS = Object.freeze({
  agents: AGENT_SPEC,
  models: MODEL_SPEC,
  data_assets: DATA_ASSET_SPEC,
  memories: MEMORY_SPEC,
  laws: LAW_SPEC,
  classification_approvals: CLASSIFICATION_APPROVAL_SPEC,
  data_lineage: DATA_LINEAGE_SPEC,
  erasure_records: ERASURE_RECORD_SPEC,
  event_messages: EVENT_MESSAGE_SPEC,
  event_offsets: EVENT_OFFSET_SPEC,
  cases: CASE_SPEC,
  institutions: INSTITUTION_SPEC,
  institution_tasks: INSTITUTION_TASK_SPEC,
  institution_outputs: INSTITUTION_OUTPUT_SPEC,
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
