import { randomUUID } from 'node:crypto';

/** @typedef {import('../root-of-trust/event-log.mjs').EventLog} EventLog */

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
 * سجل مجموعة بيانات في الفهرس.
 * @typedef {object} DataRecord
 * @property {string} id
 * @property {string} name
 * @property {string} owner - الجهة المسؤولة، تُنسب إليها كل أحداث السجل
 * @property {ClassificationValue} classification
 * @property {string} source - أصل البيانات، شرط تسجيل لا حقل وصفي
 * @property {unknown[]} lineage - سلسلة الاشتقاق كما أعلنها المالك
 * @property {number} retentionDays - مدة الاحتفاظ؛ 0 تعني بلا حد معلَن
 * @property {QualityValue} quality
 * @property {string} createdAt
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

export class DataCatalog {
  /**
   * السجل موصوف كاختياري في النوع لأن التوقيع يقبل الاستدعاء بلا وسائط ويردّ
   * بخطأ مُسمّى `DATA_CATALOG_DEPENDENCY_MISSING`؛ التحقّق بعده يضيّق النوع.
   * @param {{ log?: EventLog }} [deps]
   */
  constructor({ log } = {}) {
    if (!log) throw new Error('DATA_CATALOG_DEPENDENCY_MISSING');
    this.log = log;
    /** @type {Map<string, DataRecord>} */
    this.records = new Map();
  }

  /**
   * يسجّل مجموعة بيانات جديدة. الاسم والمالك والمصدر شروط تسجيل: بيانات بلا
   * مالك معلَن ولا مصدر معلَن لا يجوز أن تدخل الفهرس.
   * @param {object} contract
   * @param {string} contract.name
   * @param {string} contract.owner
   * @param {ClassificationValue} [contract.classification=Classification.INTERNAL]
   * @param {string} contract.source
   * @param {unknown[]} [contract.lineage=[]]
   * @param {number} [contract.retentionDays=0]
   * @returns {Readonly<DataRecord>}
   */
  register({
    name,
    owner,
    classification = Classification.INTERNAL,
    source,
    lineage = [],
    retentionDays = 0,
  }) {
    if (!name || !owner || !source) throw new Error('DATA_CONTRACT_REQUIRED');
    if (!Object.values(Classification).includes(classification)) {
      throw new Error('INVALID_CLASSIFICATION');
    }
    const id = 'data:' + randomUUID();
    /** @type {DataRecord} */
    const r = {
      id,
      name,
      owner,
      classification,
      source,
      lineage: [...lineage],
      retentionDays,
      quality: 'unverified',
      createdAt: new Date().toISOString(),
    };
    this.records.set(id, r);
    this.log.append('data.registered', owner, { id, name, classification });
    return Object.freeze({ ...r });
  }

  /**
   * يُعلن نتيجة تدقيق جودة. لا يقبل `unverified` لأنها حالة ابتدائية لا حكم.
   * @param {string} id
   * @param {'verified' | 'degraded' | 'rejected'} quality
   * @returns {Readonly<DataRecord>}
   */
  markQuality(id, quality) {
    const r = this.records.get(id);
    if (!r) throw new Error('DATASET_NOT_FOUND');
    if (!['verified', 'degraded', 'rejected'].includes(quality)) {
      throw new Error('INVALID_QUALITY');
    }
    r.quality = quality;
    this.log.append('data.quality.changed', r.owner, { id, quality });
    return Object.freeze({ ...r });
  }

  /**
   * يقرّر إتاحة القراءة بمقارنة مستوى التصريح بمستوى التصنيف، ويسجّل الإتاحة
   * عند القبول. الرفض يُرفع كخطأ لا يُرجَع كقيمة، فلا يمكن تجاهله بالإهمال.
   * @param {string} id
   * @param {string} actor - من يطلب القراءة، يُسجَّل عند الإتاحة
   * @param {unknown} clearance - مستوى التصريح؛ غير المعروف يسقط دون كل المستويات
   * @returns {true}
   */
  canRead(id, actor, clearance) {
    const r = this.records.get(id);
    if (!r) throw new Error('DATASET_NOT_FOUND');
    const granted = isClassification(clearance) ? RANK[clearance] : -1;
    if (granted < RANK[r.classification]) throw new Error('DATA_ACCESS_DENIED');
    this.log.append('data.read.authorized', actor, { id });
    return true;
  }

  /**
   * @param {string} id
   * @returns {Readonly<DataRecord> | null} صورة مُجمَّدة، أو null إن لم يوجد السجل
   */
  get(id) {
    const r = this.records.get(id);
    return r ? Object.freeze({ ...r }) : null;
  }
}
