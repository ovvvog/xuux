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
  filterable: Object.freeze(['agentId']),
  invariants: Object.freeze([
    {
      code: 'MEMORY_HOLD_HAS_NO_EXPIRY',
      message: 'ذاكرة محفوظة قانوناً لا تحمل تاريخ انتهاء: المحو المؤجَّل محوٌ مضمون.',
      /** @param {EntityRecord} record */
      check: (record) => record['legalHold'] !== true || record['expiresAt'] === null,
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

/** كل المواصفات المُعلنة، للاستعمال في الاختبارات والأدوات. */
export const ENTITY_SPECS = Object.freeze({
  agents: AGENT_SPEC,
  models: MODEL_SPEC,
  data_assets: DATA_ASSET_SPEC,
  memories: MEMORY_SPEC,
  laws: LAW_SPEC,
  classification_approvals: CLASSIFICATION_APPROVAL_SPEC,
  data_lineage: DATA_LINEAGE_SPEC,
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
