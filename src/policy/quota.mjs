/**
 * دفتر الحصص الذرّي — الخطوة `M4.07`.
 *
 * قبل هذه الخطوة لم تكن الحصّة النافذة إلا `maxAgents` في سجل الوكلاء: تُقرأ
 * بالعدّ ثم يُقرَّر السماح، ولذلك لا تخصم كتابة الذاكرة ولا الإخراج ولا الميزانية
 * شيئاً، كما يمكن لطلبين أن يريا العدد نفسه ثم يتجاوزاه معاً. هذا الدفتر يجعل
 * الاستهلاك صفاً دائماً في `state.quotas` ويجعل قيد القاعدة، لا تذكّر المستدعي،
 * هو الحارس الأخير الذي يوقف التجاوز.
 */

import { randomUUID } from 'node:crypto';

/** @typedef {import('./model.mjs').QuotaDefinition} QuotaDefinition */

/**
 * رموز أخطاء دفتر الحصص. الرمز ثابت لأن مسار التنفيذ يجب أن يوقف الفعل بقرار
 * آلي، لا بتحليل ترجمة رسالة PostgreSQL أو نصٍّ قابل للتغيير.
 */
export const QUOTA_ERRORS = Object.freeze({
  EXCEEDED: 'QUOTA_EXCEEDED',
  RESOURCE_UNDECLARED: 'QUOTA_RESOURCE_UNDECLARED',
  SUBJECT_INVALID: 'QUOTA_SUBJECT_INVALID',
  AMOUNT_INVALID: 'QUOTA_AMOUNT_INVALID',
  DEFINITION_INVALID: 'QUOTA_DEFINITION_INVALID',
  CLOCK_INVALID: 'QUOTA_CLOCK_INVALID',
});

/**
 * خطأ حصّة مسمّى. لا يحمل هذا الخطأ حدّاً أو استهلاكاً تخمينياً عند الرفض، لأن
 * الطلب الرافض لم يكتب صفاً ولا يجوز أن يُقرأ رقم قديم كأنه نتيجة الخصم.
 */
export class QuotaError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   */
  constructor(code, message) {
    super(message);
    this.name = 'QuotaError';
    /** @type {string} */
    this.code = code;
  }
}

/**
 * قراءة مختصرة من دفتر الحصّة. تُعاد الأرقام من `numeric(20,4)` بعد تحويلها إلى
 * `number` لأن حدود ملف السياسة أرقام JavaScript؛ وهذا حدٌّ معلن: حدّ يفوق دقة
 * العدد الآمن في JavaScript ليس مدعوماً في هذه الواجهة ويُرفض عند تعريفه.
 * @typedef {object} QuotaReading
 * @property {string} resource
 * @property {number} consumed
 * @property {number} limit
 * @property {number} remaining
 */

/**
 * واجهة دفتر الحصص التي تعيدها الدالة المنشئة.
 * @typedef {object} QuotaLedger
 * @property {(request: { subjectType: string, subjectId: string, resource: string, amount: number }) => Promise<QuotaReading>} debit
 * @property {(request: { subjectType: string, subjectId: string, resource: string }) => Promise<QuotaReading | null>} read
 */

const SUBJECT_TYPES = new Set(['agent', 'institution', 'region', 'model']);
const SCALE = 10_000;

// النص ثابت تماماً؛ لا يدخل فيه أي اسم علاقة أو عمود أو قيمة من المستدعي. يحمل
// `EXCLUDED.window_started_at` لحظة الخصم الممرّرة كمعامل، فتُدوَّر النافذة في
// الذرّة نفسها التي تزيد الاستهلاك. ولو قُرئت النافذة ثم حُدّثت في استعلام ثانٍ
// لتنافس طلبان عند حدودها وسمحا باستهلاك لا يثبته أيّ منهما وحده.
const DEBIT_SQL = `
  INSERT INTO state.quotas (
    id,
    subject_type,
    subject_id,
    resource,
    limit_value,
    window_seconds,
    consumed,
    window_started_at,
    updated_at
  )
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)
  ON CONFLICT (subject_type, subject_id, resource) DO UPDATE
  SET
    limit_value = EXCLUDED.limit_value,
    window_seconds = EXCLUDED.window_seconds,
    consumed = CASE
      WHEN state.quotas.window_started_at + state.quotas.window_seconds * INTERVAL '1 second'
           <= EXCLUDED.window_started_at
      THEN EXCLUDED.consumed
      ELSE state.quotas.consumed + EXCLUDED.consumed
    END,
    window_started_at = CASE
      WHEN state.quotas.window_started_at + state.quotas.window_seconds * INTERVAL '1 second'
           <= EXCLUDED.window_started_at
      THEN EXCLUDED.window_started_at
      ELSE state.quotas.window_started_at
    END,
    updated_at = EXCLUDED.updated_at
  RETURNING resource, consumed, limit_value
`;

const READ_SQL = `
  SELECT resource, consumed, limit_value
  FROM state.quotas
  WHERE subject_type = $1 AND subject_id = $2 AND resource = $3
`;

/**
 * @param {number} value
 * @returns {boolean}
 */
function isSupportedDecimal(value) {
  if (!Number.isFinite(value) || value <= 0 || !Number.isSafeInteger(value * SCALE)) return false;
  return value <= Number.MAX_SAFE_INTEGER / SCALE;
}

/**
 * لا تترك تعريفاً فاسداً يصل إلى الاستعلام: رقم يتجاوز أربع خانات عشرية يُقرّبه
 * PostgreSQL في `numeric(20,4)`، والتقريب الصامت يغيّر مقدار الخصم الذي طلبه
 * صاحب الفعل. الرفض هنا يعلن العيب بدلاً من تحويله إلى سماح أقلّ من المطلوب.
 * @param {readonly QuotaDefinition[]} definitions
 * @returns {Map<string, QuotaDefinition>}
 */
function indexDefinitions(definitions) {
  /** @type {Map<string, QuotaDefinition>} */
  const index = new Map();
  for (const definition of definitions) {
    if (
      !SUBJECT_TYPES.has(definition.subjectType) ||
      definition.resource.trim() === '' ||
      !isSupportedDecimal(definition.limit) ||
      !Number.isSafeInteger(definition.windowSeconds) ||
      definition.windowSeconds <= 0
    ) {
      throw new QuotaError(
        QUOTA_ERRORS.DEFINITION_INVALID,
        `تعريف حصّة فاسد للمورد ${definition.resource || 'غير المسمّى'}؛ لا يُشغَّل حدّ مقرّب أو بلا نافذة معلنة.`,
      );
    }
    const key = `${definition.subjectType}\u0000${definition.resource}`;
    if (index.has(key)) {
      throw new QuotaError(
        QUOTA_ERRORS.DEFINITION_INVALID,
        `تعريف حصّة مكرّر: ${definition.subjectType}/${definition.resource} — حدّان لنفس المورد يخلقان قراراً متناقضاً.`,
      );
    }
    index.set(key, definition);
  }
  return index;
}

/**
 * @param {Map<string, QuotaDefinition>} definitions
 * @param {string} subjectType
 * @param {string} resource
 * @returns {QuotaDefinition}
 */
function declaredDefinition(definitions, subjectType, resource) {
  const definition = definitions.get(`${subjectType}\u0000${resource}`);
  if (definition === undefined) {
    throw new QuotaError(
      QUOTA_ERRORS.RESOURCE_UNDECLARED,
      `المورد ${resource} غير معلَن للحساب ${subjectType}؛ لا توجد حصّة افتراضية تسمح به.`,
    );
  }
  return definition;
}

/**
 * @param {string} subjectType
 * @param {string} subjectId
 * @param {string} resource
 * @returns {void}
 */
function assertSubject(subjectType, subjectId, resource) {
  if (!SUBJECT_TYPES.has(subjectType) || subjectId.trim() === '') {
    throw new QuotaError(
      QUOTA_ERRORS.SUBJECT_INVALID,
      'صاحب الحصّة غير صالح؛ الخصم بلا نوع ومعرّف معلنين لا يُسجَّل على حساب مجهول.',
    );
  }
  if (resource.trim() === '') {
    throw new QuotaError(
      QUOTA_ERRORS.RESOURCE_UNDECLARED,
      'المورد الفارغ غير معلَن؛ لا توجد حصّة عامة أو سماح ضمني.',
    );
  }
}

/**
 * @param {Record<string, unknown> | undefined} row
 * @returns {QuotaReading}
 */
function toReading(row) {
  if (row === undefined) throw new Error('QUOTA_ROW_MISSING_AFTER_RETURNING');
  const resource = row['resource'];
  const consumed = Number(row['consumed']);
  const limit = Number(row['limit_value']);
  if (typeof resource !== 'string' || !Number.isFinite(consumed) || !Number.isFinite(limit)) {
    throw new Error('QUOTA_ROW_CORRUPT');
  }
  return Object.freeze({
    resource,
    consumed,
    limit,
    remaining: Math.max(0, limit - consumed),
  });
}

/**
 * أنشئ دفتر الحصص على مجمّع PostgreSQL موجود.
 *
 * `definitions` هي `loadPolicyBundle().quotas`: تمريرها صراحةً يمنع أن يحمّل
 * الدفتر ملف سياسة مختلفاً عن نقطة القرار التي استدعت الخصم. ما كان ناقصاً قبل
 * M4.07 هو هذا الربط الدائم؛ كان `maxAgents` عدّاً في سجل الوكلاء لا خصماً
 * ذرّياً، ولم يكن لبيانات الوكيل أو ميزانية المؤسسة دفتر نافذ أصلاً.
 *
 * @param {{ pool: import('pg').Pool, definitions: readonly QuotaDefinition[], now?: () => Date }} options
 * @returns {QuotaLedger}
 */
export function createQuotaLedger({ pool, definitions, now = () => new Date() }) {
  const declared = indexDefinitions(definitions);

  return Object.freeze({
    async debit({ subjectType, subjectId, resource, amount }) {
      assertSubject(subjectType, subjectId, resource);
      const definition = declaredDefinition(declared, subjectType, resource);
      if (!isSupportedDecimal(amount)) {
        throw new QuotaError(
          QUOTA_ERRORS.AMOUNT_INVALID,
          'مقدار الخصم يجب أن يكون عدداً موجباً ذا أربع خانات عشرية على الأكثر؛ التقريب الصامت ممنوع.',
        );
      }
      const current = now();
      if (!(current instanceof Date) || Number.isNaN(current.getTime())) {
        throw new QuotaError(
          QUOTA_ERRORS.CLOCK_INVALID,
          'ساعة دفتر الحصص غير صالحة؛ نافذة بلا لحظة موثوقة لا يجوز تدويرها.',
        );
      }

      try {
        const result = await pool.query(DEBIT_SQL, [
          `quota:${randomUUID()}`,
          subjectType,
          subjectId,
          resource,
          definition.limit,
          definition.windowSeconds,
          amount,
          current,
        ]);
        return toReading(/** @type {Record<string, unknown> | undefined} */ (result.rows[0]));
      } catch (error) {
        const source = /** @type {Record<string, unknown>} */ (
          typeof error === 'object' && error !== null ? error : {}
        );
        if (source['code'] === '23514' && source['constraint'] === 'quotas_consumed_within_limit') {
          throw new QuotaError(
            QUOTA_ERRORS.EXCEEDED,
            `تجاوزت حصّة ${resource} لصاحب ${subjectType}/${subjectId}؛ قيد القاعدة أوقف الخصم قبل تسجيله.`,
          );
        }
        throw error;
      }
    },

    async read({ subjectType, subjectId, resource }) {
      assertSubject(subjectType, subjectId, resource);
      declaredDefinition(declared, subjectType, resource);
      const result = await pool.query(READ_SQL, [subjectType, subjectId, resource]);
      if (result.rows.length === 0) return null;
      return toReading(/** @type {Record<string, unknown> | undefined} */ (result.rows[0]));
    },
  });
}
