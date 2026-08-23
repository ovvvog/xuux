import { randomUUID } from 'node:crypto';
import { DATA_ASSET_SPEC } from '../persistence/entities.mjs';

/** @typedef {import('../root-of-trust/event-log.mjs').EventLog} EventLog */

/**
 * فهرس البيانات — صار **دائماً** في الخطوة `M3.05`.
 *
 * كان `Map` في الذاكرة: فهرسٌ يُمحى بإعادة التشغيل يجعل كل قرار إتاحةٍ لاحقٍ
 * قراراً بلا مرجع — لأن التصنيف نفسه ضاع. صار المخزن مستودعاً على جدول
 * `state.data_assets`، وقيدُ التصنيف وسلطةُ الاحتفاظ صارا قيدين في القاعدة.
 *
 * **حدٌّ معلن:** كل العمليات صارت `async`، و`records` الداخلية زالت — من كان
 * يقرأ `catalog.records` مباشرة (وقد كان اختبارٌ يفعلها) صار يقرأ `get(id)`.
 */

/**
 * مستويات تصنيف البيانات، مرتّبة تصاعدياً في الحساسية. الترتيب هو أساس قرار
 * الإتاحة، فأي إضافة إلى هذا الكائن يجب أن تُصحب بموضعها في سلّم `RANK` أدناه.
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
 * حالة جودة مجموعة بيانات. `unverified` هي الحالة الابتدائية لكل سجل جديد:
 * البيانات غير موثوقة حتى يُثبت خلاف ذلك، لا العكس.
 * @typedef {'unverified' | 'verified' | 'degraded' | 'rejected'} QualityValue
 */

/**
 * سجل مجموعة بيانات في الفهرس. `createdAt` صار `Date` من القاعدة لا نصّاً.
 * @typedef {object} DataRecord
 * @property {string} id
 * @property {string} name
 * @property {string} owner - الجهة المسؤولة، تُنسب إليها كل أحداث السجل
 * @property {ClassificationValue} classification
 * @property {string} source - أصل البيانات، شرط تسجيل لا حقل وصفي
 * @property {unknown[]} lineage - سلسلة الاشتقاق كما أعلنها المالك
 * @property {number} retentionDays - مدة الاحتفاظ؛ 0 تعني بلا حد معلَن
 * @property {QualityValue} quality
 * @property {boolean} legalHold - حفظٌ قانوني يمنع المحو ولو انتهى الاحتفاظ
 * @property {number} version
 * @property {Date} createdAt
 * @property {Date} updatedAt
 */

/**
 * عقد المستودع الذي يحتاجه هذا الفهرس.
 * @typedef {object} DataRepository
 * @property {(record: Record<string, unknown>) => Promise<Record<string, unknown>>} insert
 * @property {(id: string) => Promise<Record<string, unknown> | null>} findById
 * @property {(query?: { filter?: Record<string, unknown>, limit?: number }) => Promise<Array<Record<string, unknown>>>} list
 * @property {(filter?: Record<string, unknown>) => Promise<number>} count
 * @property {(id: string, expectedVersion: number, patch: Record<string, unknown>) => Promise<Record<string, unknown>>} update
 */

/**
 * سلّم الحساسية: رقم أعلى يعني حساسية أعلى. مستوى التصريح يجب أن يبلغ مستوى
 * التصنيف أو يفوقه، وتصريح غير معروف يُعطى -1 فيسقط دون كل المستويات.
 * @type {Readonly<Record<ClassificationValue, number>>}
 */
const RANK = Object.freeze({ public: 0, internal: 1, sensitive: 2, sovereign: 3 });

/**
 * هل القيمة مستوى تصنيف معروف؟ يُستخدم لتضييق نوع مُدخَل خارجي قبل قراءة سلّمه.
 * @param {unknown} value
 * @returns {value is ClassificationValue}
 */
function isClassification(value) {
  return typeof value === 'string' && Object.hasOwn(RANK, value);
}

/**
 * @param {Record<string, unknown>} row
 * @returns {DataRecord}
 */
function toRecord(row) {
  return /** @type {DataRecord} */ (
    /** @type {unknown} */ (Object.freeze({ ...row, lineage: row['lineage'] ?? [] }))
  );
}

export class DataCatalog {
  /**
   * الاعتماديات اختيارية في النوع لأن التوقيع يقبل الاستدعاء بلا وسائط ويردّ
   * بخطأ مُسمّى `DATA_CATALOG_DEPENDENCY_MISSING`؛ التحقّق بعده يضيّق النوع.
   * @param {{ log?: EventLog, repository?: DataRepository }} [deps]
   */
  constructor({ log, repository } = {}) {
    if (!log || !repository) throw new Error('DATA_CATALOG_DEPENDENCY_MISSING');
    this.log = log;
    /** @type {DataRepository} */
    this.repository = repository;
  }

  /** @returns {import('../persistence/entities.mjs').EntitySpec} */
  static get spec() {
    return DATA_ASSET_SPEC;
  }

  /**
   * يسجّل مجموعة بيانات جديدة. الاسم والمالك والمصدر شروط تسجيل: بيانات بلا
   * مالك معلَن ولا مصدر معلَن لا يجوز أن تدخل الفهرس. والاسم **فريد** في
   * القاعدة، فمن سجّل اسماً مكرّراً أخذ `REPOSITORY_DUPLICATE_UNIQUE`.
   * @param {object} contract
   * @param {string} contract.name
   * @param {string} contract.owner
   * @param {ClassificationValue} [contract.classification=Classification.INTERNAL]
   * @param {string} contract.source
   * @param {unknown[]} [contract.lineage=[]]
   * @param {number} [contract.retentionDays=0]
   * @param {boolean} [contract.legalHold=false]
   * @returns {Promise<DataRecord>}
   */
  async register({
    name,
    owner,
    classification = Classification.INTERNAL,
    source,
    lineage = [],
    retentionDays = 0,
    legalHold = false,
  }) {
    if (!name || !owner || !source) throw new Error('DATA_CONTRACT_REQUIRED');
    if (!Object.values(Classification).includes(classification)) {
      throw new Error('INVALID_CLASSIFICATION');
    }
    const id = 'data:' + randomUUID();
    const row = await this.repository.insert({
      id,
      name,
      owner,
      classification,
      source,
      lineage: [...lineage],
      retentionDays,
      quality: 'unverified',
      legalHold,
    });
    this.log.append('data.registered', owner, { id, name, classification });
    return toRecord(row);
  }

  /**
   * يُعلن نتيجة تدقيق جودة. لا يقبل `unverified` لأنها حالة ابتدائية لا حكم.
   * @param {string} id
   * @param {'verified' | 'degraded' | 'rejected'} quality
   * @returns {Promise<DataRecord>}
   */
  async markQuality(id, quality) {
    const row = await this.repository.findById(id);
    if (row === null) throw new Error('DATASET_NOT_FOUND');
    if (!['verified', 'degraded', 'rejected'].includes(quality)) {
      throw new Error('INVALID_QUALITY');
    }
    const current = toRecord(row);
    const updated = await this.repository.update(id, current.version, { quality });
    this.log.append('data.quality.changed', current.owner, { id, quality });
    return toRecord(updated);
  }

  /**
   * يقرّر إتاحة القراءة بمقارنة مستوى التصريح بمستوى التصنيف، ويسجّل الإتاحة
   * عند القبول. الرفض يُرفع كخطأ لا يُرجَع كقيمة، فلا يمكن تجاهله بالإهمال.
   * @param {string} id
   * @param {string} actor - من يطلب القراءة، يُسجَّل عند الإتاحة
   * @param {unknown} clearance - مستوى التصريح؛ غير المعروف يسقط دون كل المستويات
   * @returns {Promise<true>}
   */
  async canRead(id, actor, clearance) {
    const row = await this.repository.findById(id);
    if (row === null) throw new Error('DATASET_NOT_FOUND');
    const record = toRecord(row);
    const granted = isClassification(clearance) ? RANK[clearance] : -1;
    if (granted < RANK[record.classification]) throw new Error('DATA_ACCESS_DENIED');
    this.log.append('data.read.authorized', actor, { id });
    return true;
  }

  /**
   * @param {string} id
   * @returns {Promise<DataRecord | null>} صورة مُجمَّدة، أو null إن لم يوجد السجل
   */
  async get(id) {
    const row = await this.repository.findById(id);
    return row === null ? null : toRecord(row);
  }
}
