/**
 * تطبيق PostgreSQL لعقد المستودع — الخطوة `M3.04`.
 *
 * ثلاث قواعد في هذا الملف:
 *
 * 1. **لا نصّ SQL مبنيّ من مُدخل المستدعي.** أسماء الجداول والأعمدة تُقرأ من
 *    المواصفة المُعلنة في `entities.mjs` وحدها، والقيم تُمرَّر معاملات مرقَّمة.
 *    والترشيح مقصور على حقول مُعلنة في المواصفة، فلا يُبنى شرطٌ من نصٍّ قادم.
 * 2. **القفل متفائل بشرطٍ في `WHERE`** لا بقراءة ثم كتابة: `WHERE id = $ AND
 *    version = $` تجعل الفحص والكتابة فعلاً واحداً، فلا تنفذ كتابةٌ بين
 *    القراءة والتحديث.
 * 3. **أخطاء القاعدة تُترجَم إلى رموز العقد** فلا يرى المستدعي رمز PostgreSQL
 *    الخام؛ ولو أخفق التحقّق في الكود فقيدُ القاعدة يمسكه ويصير خطأً مسمّى.
 */

import { withTransaction } from './db.mjs';
import {
  REPOSITORY_ERRORS,
  RepositoryError,
  validateRecord,
  withDeclaredBlanks,
} from './entities.mjs';

/** @typedef {import('./entities.mjs').EntitySpec} EntitySpec */
/** @typedef {import('./entities.mjs').EntityRecord} EntityRecord */

/**
 * ترجمة أخطاء PostgreSQL إلى رموز العقد.
 * @param {unknown} error
 * @param {EntitySpec} spec
 * @returns {never}
 */
function translate(error, spec) {
  if (error instanceof RepositoryError) throw error;
  // تُقرأ الحقول من الخطأ نفسه: `pg` يضع `code` و`constraint` عليه، ونسخُه إلى
  // كائن جديد يفقد ما ليس عدّاً منها.
  const source = /** @type {Record<string, unknown>} */ (
    typeof error === 'object' && error !== null ? error : {}
  );
  const code = typeof source['code'] === 'string' ? source['code'] : undefined;
  const constraint = typeof source['constraint'] === 'string' ? source['constraint'] : '';
  const detail = error instanceof Error ? error.message : String(error);
  if (code === '23505') {
    const isPrimaryKey = constraint.endsWith('_pkey');
    throw new RepositoryError(
      isPrimaryKey ? REPOSITORY_ERRORS.DUPLICATE_ID : REPOSITORY_ERRORS.DUPLICATE_UNIQUE,
      `تعارض تفرّد في ${spec.name} (${constraint || 'قيد غير مسمّى'}).`,
    );
  }
  if (code === '23514' || code === '23503' || code === '22P02' || code === '22001') {
    throw new RepositoryError(
      REPOSITORY_ERRORS.INVALID_RECORD,
      `قيد قاعدة مرفوض في ${spec.name} (${constraint || code}): ${detail}`,
    );
  }
  throw error instanceof Error ? error : new Error(detail);
}

/**
 * حوّل صفّاً من القاعدة إلى سجل بأسماء حقول العقد.
 * @param {EntitySpec} spec
 * @param {Record<string, unknown>} row
 * @returns {EntityRecord}
 */
function toRecord(spec, row) {
  /** @type {EntityRecord} */
  const record = {};
  for (const [field, fieldSpec] of Object.entries(spec.fields)) {
    const value = row[fieldSpec.column];
    if (fieldSpec.type === 'integer' && value !== null && value !== undefined) {
      record[field] = Number(value);
    } else {
      record[field] = value === undefined ? null : value;
    }
  }
  return Object.freeze(record);
}

/**
 * @param {EntitySpec} spec
 * @param {Record<string, unknown>} filter
 * @returns {{ clause: string, values: unknown[] }}
 */
function buildFilter(spec, filter) {
  /** @type {string[]} */
  const conditions = [];
  /** @type {unknown[]} */
  const values = [];
  for (const [field, value] of Object.entries(filter)) {
    if (!spec.filterable.includes(field)) {
      throw new RepositoryError(
        REPOSITORY_ERRORS.UNSUPPORTED_FILTER,
        `الترشيح بالحقل ${field} غير مدعوم في ${spec.name}. المدعوم: ${spec.filterable.join(', ')} — والترشيح بحقل بلا فهرس مسحٌ كامل يُخفي كلفته.`,
      );
    }
    const fieldSpec = spec.fields[field];
    if (fieldSpec === undefined) continue;
    values.push(value);
    conditions.push(`${fieldSpec.column} = $${values.length}`);
  }
  return {
    clause: conditions.length === 0 ? '' : ` WHERE ${conditions.join(' AND ')}`,
    values,
  };
}

/**
 * أنشئ مستودع PostgreSQL لمواصفة سجل.
 * @param {import('pg').Pool} pool
 * @param {EntitySpec} spec
 */
export function createPostgresRepository(pool, spec) {
  /** الأعمدة التي يكتبها المستدعي (ما ليس مُداراً). */
  const writable = Object.entries(spec.fields).filter(([, field]) => field.managed !== true);

  return {
    kind: /** @type {'postgres'} */ ('postgres'),
    spec,

    /**
     * @param {EntityRecord} input
     * @returns {Promise<EntityRecord>}
     */
    async insert(input) {
      validateRecord(spec, input);
      const filled = withDeclaredBlanks(spec, input);
      /** @type {string[]} */
      const columns = [];
      /** @type {unknown[]} */
      const values = [];
      for (const [field, fieldSpec] of writable) {
        if (!Object.hasOwn(filled, field)) continue;
        columns.push(fieldSpec.column);
        values.push(filled[field]);
      }
      const placeholders = columns.map((_, index) => `$${index + 1}`);
      try {
        const result = await pool.query(
          `INSERT INTO ${spec.table} (${columns.join(', ')}) VALUES (${placeholders.join(', ')}) RETURNING *`,
          values,
        );
        const row = result.rows[0];
        if (row === undefined) throw new Error('الإدخال لم يُعِد صفّاً — حالة غير متوقعة.');
        return toRecord(spec, row);
      } catch (error) {
        return translate(error, spec);
      }
    },

    /**
     * @param {string} id
     * @returns {Promise<EntityRecord | null>}
     */
    async findById(id) {
      const result = await pool.query(`SELECT * FROM ${spec.table} WHERE id = $1`, [id]);
      const row = result.rows[0];
      return row === undefined ? null : toRecord(spec, row);
    },

    /**
     * @param {object} [query]
     * @param {Record<string, unknown>} [query.filter]
     * @param {number} [query.limit]
     * @returns {Promise<EntityRecord[]>}
     */
    async list(query = {}) {
      const { clause, values } = buildFilter(spec, query.filter ?? {});
      // نفس ترتيب تطبيق الذاكرة: بالإنشاء ثم بالمعرّف، كي لا يمرّ اختبار العقد
      // على أحدهما ويسقط على الآخر لاختلاف ترتيب غير مُعلن.
      let sql = `SELECT * FROM ${spec.table}${clause} ORDER BY created_at ASC, id ASC`;
      if (query.limit !== undefined) {
        values.push(query.limit);
        sql += ` LIMIT $${values.length}`;
      }
      const result = await pool.query(sql, values);
      return result.rows.map((row) => toRecord(spec, row));
    },

    /**
     * @param {Record<string, unknown>} [filter]
     * @returns {Promise<number>}
     */
    async count(filter = {}) {
      const { clause, values } = buildFilter(spec, filter);
      const result = await pool.query(
        `SELECT count(*)::int AS n FROM ${spec.table}${clause}`,
        values,
      );
      const row = /** @type {Record<string, unknown> | undefined} */ (result.rows[0]);
      return row === undefined ? 0 : Number(row['n']);
    },

    /**
     * @param {string} id
     * @param {number} expectedVersion
     * @param {EntityRecord} patch
     * @returns {Promise<EntityRecord>}
     */
    async update(id, expectedVersion, patch) {
      validateRecord(spec, patch, { partial: true });
      for (const key of Object.keys(patch)) {
        const field = spec.fields[key];
        if (field !== undefined && field.managed === true) {
          throw new RepositoryError(
            REPOSITORY_ERRORS.UNKNOWN_FIELD,
            `الحقل ${key} يديره المستودع ولا يُكتب من المستدعي.`,
          );
        }
      }
      try {
        return await withTransaction(pool, async (client) => {
          // القراءة تحت `FOR UPDATE` كي لا تتغيّر الحالة بين التحقّق والكتابة؛
          // والقفل المتفائل يبقى في شرط النسخة فلا يُعتمد على القفل وحده.
          const currentResult = await client.query(
            `SELECT * FROM ${spec.table} WHERE id = $1 FOR UPDATE`,
            [id],
          );
          const currentRow = currentResult.rows[0];
          if (currentRow === undefined) {
            throw new RepositoryError(
              REPOSITORY_ERRORS.NOT_FOUND,
              `لا سجل بالمعرّف ${id} في ${spec.name}.`,
            );
          }
          const current = toRecord(spec, currentRow);
          if (Number(current['version']) !== expectedVersion) {
            throw new RepositoryError(
              REPOSITORY_ERRORS.VERSION_CONFLICT,
              `تعارض نسخ في ${spec.name}: النسخة ${String(current['version'])} والمُرسَل ${expectedVersion}.`,
            );
          }
          const merged = withDeclaredBlanks(spec, { ...current, ...patch, id });
          validateRecord(spec, merged);

          /** @type {string[]} */
          const assignments = [];
          /** @type {unknown[]} */
          const values = [];
          for (const [field, fieldSpec] of writable) {
            if (!Object.hasOwn(patch, field)) continue;
            values.push(merged[field]);
            assignments.push(`${fieldSpec.column} = $${values.length}`);
          }
          assignments.push('version = version + 1', 'updated_at = now()');
          values.push(id, expectedVersion);
          const result = await client.query(
            `UPDATE ${spec.table} SET ${assignments.join(', ')} WHERE id = $${values.length - 1} AND version = $${values.length} RETURNING *`,
            values,
          );
          const row = result.rows[0];
          if (row === undefined) {
            throw new RepositoryError(
              REPOSITORY_ERRORS.VERSION_CONFLICT,
              `تعارض نسخ في ${spec.name} عند التحديث.`,
            );
          }
          return toRecord(spec, row);
        });
      } catch (error) {
        return translate(error, spec);
      }
    },

    /**
     * @param {string} id
     * @param {number} expectedVersion
     * @returns {Promise<void>}
     */
    async remove(id, expectedVersion) {
      const result = await pool.query(
        `DELETE FROM ${spec.table} WHERE id = $1 AND version = $2 RETURNING id`,
        [id, expectedVersion],
      );
      if (result.rowCount === 1) return;
      const exists = await pool.query(`SELECT version FROM ${spec.table} WHERE id = $1`, [id]);
      if (exists.rows.length === 0) {
        throw new RepositoryError(
          REPOSITORY_ERRORS.NOT_FOUND,
          `لا سجل بالمعرّف ${id} في ${spec.name}.`,
        );
      }
      throw new RepositoryError(
        REPOSITORY_ERRORS.VERSION_CONFLICT,
        `تعارض نسخ في ${spec.name} عند الحذف.`,
      );
    },
  };
}
