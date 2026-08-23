/**
 * تطبيق الذاكرة لعقد المستودع — الخطوة `M3.04`.
 *
 * غرضه الاختبار السريع لا التشغيل: بيانه أنه **يُمحى بإعادة التشغيل**، وهذا
 * بعينه ما يعالجه تطبيق PostgreSQL. ويجري عليه نفس اختبار العقد الذي يجري على
 * القاعدة، فإن رخُص في قيدٍ سقط في الاختبار لا في الإنتاج.
 *
 * الصور المُعادة **مُجمَّدة تجميداً عميقاً** بـ`src/lib/snapshot.mjs` — نفس ضابط
 * العيب `D1` من `M2.11`: من أخذ سجلاً لا يقدر أن يعدّل ما في المخزن بيده.
 */

import { snapshot } from '../lib/snapshot.mjs';
import {
  REPOSITORY_ERRORS,
  RepositoryError,
  validateRecord,
  withDeclaredBlanks,
} from './entities.mjs';

/** @typedef {import('./entities.mjs').EntitySpec} EntitySpec */
/** @typedef {import('./entities.mjs').EntityRecord} EntityRecord */

/**
 * @param {EntitySpec} spec
 * @param {readonly string[]} fields
 * @param {EntityRecord} record
 * @returns {string}
 */
function uniqueKey(spec, fields, record) {
  return `${spec.name}|${fields.join(',')}|${fields.map((field) => String(record[field])).join('\u0000')}`;
}

/**
 * @param {Record<string, unknown>} filter
 * @param {EntitySpec} spec
 * @returns {void}
 */
function assertFilterable(filter, spec) {
  for (const field of Object.keys(filter)) {
    if (!spec.filterable.includes(field)) {
      throw new RepositoryError(
        REPOSITORY_ERRORS.UNSUPPORTED_FILTER,
        `الترشيح بالحقل ${field} غير مدعوم في ${spec.name}. المدعوم: ${spec.filterable.join(', ')} — والترشيح بحقل بلا فهرس مسحٌ كامل يُخفي كلفته.`,
      );
    }
  }
}

/**
 * أنشئ مستودعاً في الذاكرة لمواصفة سجل.
 * @param {EntitySpec} spec
 * @param {object} [options]
 * @param {() => Date} [options.now] ساعة قابلة للحقن، فلا يتعلق الاختبار بساعة الجهاز.
 */
export function createMemoryRepository(spec, options = {}) {
  const now = options.now ?? (() => new Date());
  /** @type {Map<string, EntityRecord>} */
  const rows = new Map();

  /**
   * @param {EntityRecord} candidate
   * @param {string | null} ignoreId
   * @returns {void}
   */
  function assertUnique(candidate, ignoreId) {
    for (const fields of spec.unique) {
      const key = uniqueKey(spec, fields, candidate);
      for (const [id, existing] of rows) {
        if (id === ignoreId) continue;
        if (uniqueKey(spec, fields, existing) === key) {
          throw new RepositoryError(
            REPOSITORY_ERRORS.DUPLICATE_UNIQUE,
            `قيمة مكرّرة في ${spec.name} للحقول (${fields.join(', ')}).`,
          );
        }
      }
    }
  }

  return {
    kind: /** @type {'memory'} */ ('memory'),
    spec,

    /**
     * @param {EntityRecord} input
     * @returns {Promise<EntityRecord>}
     */
    async insert(input) {
      validateRecord(spec, input);
      const id = String(input['id']);
      if (rows.has(id)) {
        throw new RepositoryError(
          REPOSITORY_ERRORS.DUPLICATE_ID,
          `المعرّف ${id} مسجَّل في ${spec.name}.`,
        );
      }
      const stamp = now();
      const record = withDeclaredBlanks(spec, {
        ...input,
        version: 1,
        createdAt: stamp,
        updatedAt: stamp,
      });
      assertUnique(record, null);
      rows.set(id, record);
      return snapshot(record);
    },

    /**
     * @param {string} id
     * @returns {Promise<EntityRecord | null>}
     */
    async findById(id) {
      const record = rows.get(id);
      return record === undefined ? null : snapshot(record);
    },

    /**
     * @param {object} [query]
     * @param {Record<string, unknown>} [query.filter]
     * @param {number} [query.limit]
     * @returns {Promise<EntityRecord[]>}
     */
    async list(query = {}) {
      const filter = query.filter ?? {};
      assertFilterable(filter, spec);
      const matched = [...rows.values()]
        .filter((record) => Object.entries(filter).every(([key, value]) => record[key] === value))
        // ترتيب مثبَّت: بالإنشاء ثم بالمعرّف. الترتيب غير المثبَّت يجعل اختبار
        // القائمة يمرّ أو يسقط بحسب ترتيب الإدراج، وذاك اختبار كاذب.
        .sort((a, b) => {
          const left = /** @type {Date} */ (a['createdAt']).getTime();
          const right = /** @type {Date} */ (b['createdAt']).getTime();
          if (left !== right) return left - right;
          return String(a['id']).localeCompare(String(b['id']));
        });
      const limited = query.limit === undefined ? matched : matched.slice(0, query.limit);
      return limited.map((record) => snapshot(record));
    },

    /**
     * @param {Record<string, unknown>} [filter]
     * @returns {Promise<number>}
     */
    async count(filter = {}) {
      assertFilterable(filter, spec);
      return [...rows.values()].filter((record) =>
        Object.entries(filter).every(([key, value]) => record[key] === value),
      ).length;
    },

    /**
     * تحديث بقفل متفائل: من كتب على نسخة قديمة يُرفض بدل أن يمحو كتابة غيره.
     * @param {string} id
     * @param {number} expectedVersion
     * @param {EntityRecord} patch
     * @returns {Promise<EntityRecord>}
     */
    async update(id, expectedVersion, patch) {
      const current = rows.get(id);
      if (current === undefined) {
        throw new RepositoryError(
          REPOSITORY_ERRORS.NOT_FOUND,
          `لا سجل بالمعرّف ${id} في ${spec.name}.`,
        );
      }
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
      if (current['version'] !== expectedVersion) {
        throw new RepositoryError(
          REPOSITORY_ERRORS.VERSION_CONFLICT,
          `تعارض نسخ في ${spec.name}: النسخة ${String(current['version'])} والمُرسَل ${expectedVersion}.`,
        );
      }
      const merged = withDeclaredBlanks(spec, {
        ...current,
        ...patch,
        id,
        version: expectedVersion + 1,
        updatedAt: now(),
      });
      validateRecord(spec, merged);
      assertUnique(merged, id);
      rows.set(id, merged);
      return snapshot(merged);
    },

    /**
     * @param {string} id
     * @param {number} expectedVersion
     * @returns {Promise<void>}
     */
    async remove(id, expectedVersion) {
      const current = rows.get(id);
      if (current === undefined) {
        throw new RepositoryError(
          REPOSITORY_ERRORS.NOT_FOUND,
          `لا سجل بالمعرّف ${id} في ${spec.name}.`,
        );
      }
      if (current['version'] !== expectedVersion) {
        throw new RepositoryError(
          REPOSITORY_ERRORS.VERSION_CONFLICT,
          `تعارض نسخ في ${spec.name} عند الحذف.`,
        );
      }
      rows.delete(id);
    },
  };
}

/** @typedef {ReturnType<typeof createMemoryRepository>} Repository */
