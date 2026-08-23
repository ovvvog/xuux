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
 * على حدة. تثبيت الأنواع الساكنة يجري في `M3.05` حين تتحوّل السجلات القائمة
 * (`agent-registry` و`model-registry` وغيرها) من الذاكرة إلى هذه المستودعات.
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
      kind: {
        column: 'kind',
        type: 'enum',
        required: true,
        values: Object.freeze(['human', 'service', 'autonomous']),
      },
      status: {
        column: 'status',
        type: 'enum',
        required: true,
        values: Object.freeze(['registered', 'active', 'suspended', 'quarantined', 'retired']),
      },
      capabilities: { column: 'capabilities', type: 'stringArray', required: false },
      suspendedReason: { column: 'suspended_reason', type: 'string', nullable: true },
      ...MANAGED,
    })
  ),
  unique: Object.freeze([Object.freeze(['name'])]),
  filterable: Object.freeze(['status', 'kind']),
  invariants: Object.freeze([
    {
      code: 'AGENT_SUSPENSION_NEEDS_REASON',
      message: 'التعليق أو الحجْر يلزمه سبب مسجَّل، والسبب لا يُسجَّل لوكيل غير معلَّق.',
      /** @param {EntityRecord} record */
      check: (record) => {
        const suspended = record['status'] === 'suspended' || record['status'] === 'quarantined';
        const hasReason =
          typeof record['suspendedReason'] === 'string' && record['suspendedReason'].trim() !== '';
        return suspended === hasReason;
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
      purpose: {
        column: 'purpose',
        type: 'enum',
        required: true,
        values: Object.freeze([
          'governance',
          'operations',
          'research',
          'education',
          'safety',
          'registry',
        ]),
      },
      fingerprint: { column: 'fingerprint', type: 'string', required: true, maxLength: 64 },
      status: {
        column: 'status',
        type: 'enum',
        required: true,
        values: Object.freeze(['registered', 'evaluated', 'approved', 'suspended', 'retired']),
      },
      approvedBy: { column: 'approved_by', type: 'string', nullable: true },
      ...MANAGED,
    })
  ),
  unique: Object.freeze([Object.freeze(['fingerprint']), Object.freeze(['name', 'provider'])]),
  filterable: Object.freeze(['status', 'purpose']),
  invariants: Object.freeze([
    {
      code: 'MODEL_APPROVAL_NEEDS_APPROVER',
      message: 'الاعتماد لا يُعلن بلا معتمِد مسمّى.',
      /** @param {EntityRecord} record */
      check: (record) =>
        record['status'] !== 'approved' ||
        (typeof record['approvedBy'] === 'string' && record['approvedBy'].trim() !== ''),
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

/** كل المواصفات المُعلنة، للاستعمال في الاختبارات والأدوات. */
export const ENTITY_SPECS = Object.freeze({ agents: AGENT_SPEC, models: MODEL_SPEC });

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
