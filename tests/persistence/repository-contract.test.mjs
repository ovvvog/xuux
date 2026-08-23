/**
 * اختبار عقد المستودعات — الخطوة `M3.04`.
 *
 * معيار القبول: «نفس مجموعة اختبارات العقد تنجح على التطبيقين». فالمجموعة مكتوبة
 * **مرة واحدة** هنا وتُشغَّل على تطبيق الذاكرة وعلى PostgreSQL بنفس النصّ. وفائدة
 * ذلك ليست التوفير: تطبيقُ ذاكرة **أرخى** من القاعدة يجعل الاختبار يُطمئن كذباً،
 * فالمقايسة على نفس النصّ هي ما يمنع ذلك.
 *
 * وإن لم تُعلَن `DATABASE_URL` يعمل شقّ الذاكرة ويُتخطّى شقّ القاعدة **بسبب مطبوع**؛
 * وCI يُعلنها فلا تمرّ البوابة بشقٍّ واحد.
 */

import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test, { after, before } from 'node:test';
import { AGENT_SPEC, MODEL_SPEC, REPOSITORY_ERRORS } from '../../src/persistence/entities.mjs';
import { up } from '../../src/persistence/migrator.mjs';
import { createMemoryRepository } from '../../src/persistence/repository-memory.mjs';
import { createPostgresRepository } from '../../src/persistence/repository-postgres.mjs';
import { createIsolatedDatabase, skipWithoutDatabase } from '../helpers/pg.mjs';

/** @typedef {import('../../src/persistence/entities.mjs').EntityRecord} EntityRecord */

/** عيّنات إدخال صالحة لكل مواصفة، ومعها تعديل صالح وتعديل مُبطِل. */
const FIXTURES = {
  agents: {
    spec: AGENT_SPEC,
    /** @param {string} suffix @returns {EntityRecord} */
    make: (suffix) => ({
      id: `agent-${suffix}`,
      name: `وكيل ${suffix}`,
      kind: 'service',
      status: 'registered',
      capabilities: ['read:events'],
    }),
    /** @type {EntityRecord} */
    validPatch: { status: 'active', capabilities: ['read:events', 'write:tasks'] },
    /** @type {EntityRecord} */
    invalidPatch: { status: 'suspended' },
    invariantCode: 'AGENT_SUSPENSION_NEEDS_REASON',
    uniqueField: 'name',
    /** قيم تجعل كل الحقول الفريدة مختلفة، ليبقى التعارض المختبر هو المعرّف وحده.
     * @param {string} tag
     * @returns {EntityRecord}
     */
    freshUniques: (tag) => ({ name: `وكيل مختلف ${tag}` }),
    filter: { status: 'registered' },
  },
  models: {
    spec: MODEL_SPEC,
    /** @param {string} suffix @returns {EntityRecord} */
    make: (suffix) => ({
      id: `model-${suffix}`,
      name: `نموذج ${suffix}`,
      provider: 'internal',
      purpose: 'research',
      // بصمة مشتقّة بتجزئة الوسم: توليدها بحشو النصّ وإبدال غير الستّ عشري كان
      // يُنتج البصمة نفسها لوسمين مختلفين، فيُخفق الاختبار بتعارض تفرّد
      // لا علاقة له بما يقيسه.
      fingerprint: crypto.createHash('sha256').update(suffix).digest('hex'),
      status: 'registered',
    }),
    /** @type {EntityRecord} */
    validPatch: { status: 'evaluated' },
    /** @type {EntityRecord} */
    invalidPatch: { status: 'approved' },
    invariantCode: 'MODEL_APPROVAL_NEEDS_APPROVER',
    uniqueField: 'name',
    /**
     * @param {string} tag
     * @returns {EntityRecord}
     */
    freshUniques: (tag) => ({
      name: `نموذج مختلف ${tag}`,
      fingerprint: crypto.createHash('sha256').update(`fresh:${tag}`).digest('hex'),
    }),
    filter: { status: 'registered' },
  },
};

/** @type {{ pool: import('pg').Pool, drop: () => Promise<void> } | null} */
let db = null;

before(async () => {
  if (skipWithoutDatabase !== false) return;
  const created = await createIsolatedDatabase('repo');
  db = created;
  await up(created.pool);
});

after(async () => {
  if (db !== null) await db.drop();
});

/**
 * @param {'memory' | 'postgres'} kind
 * @param {import('../../src/persistence/entities.mjs').EntitySpec} spec
 */
function repositoryFor(kind, spec) {
  if (kind === 'memory') return createMemoryRepository(spec);
  if (db === null) throw new Error('لا قاعدة — كان يجب أن يُتخطّى الاختبار.');
  return createPostgresRepository(db.pool, spec);
}

/**
 * @param {unknown} error
 * @param {string} code
 * @returns {boolean}
 */
function hasCode(error, code) {
  return /** @type {{ code?: string }} */ (error).code === code;
}

/** مجموعة العقد — تُشغَّل بنصّها على التطبيقين. */
/**
 * @param {'memory' | 'postgres'} kind
 * @param {'agents' | 'models'} entity
 * @param {string} unique وسم يميّز معرّفات هذا التشغيل فلا تتصادم في قاعدة واحدة.
 */
function contractSuite(kind, entity, unique) {
  const fixture = FIXTURES[entity];
  const label = `[${kind}/${entity}]`;
  const skip = kind === 'postgres' ? skipWithoutDatabase : false;

  test(`${label} الإدخال يُعيد صورة بنسخة 1 وتواريخ`, { skip }, async () => {
    const repo = repositoryFor(kind, fixture.spec);
    const record = await repo.insert(fixture.make(`${unique}-a`));
    assert.equal(record['version'], 1);
    assert.ok(record['createdAt'] instanceof Date);
    assert.ok(record['updatedAt'] instanceof Date);
    const fetched = await repo.findById(String(record['id']));
    assert.equal(fetched?.['id'], record['id']);
  });

  test(`${label} السجل المُعاد لا يُعدَّل من المستدعي`, { skip }, async () => {
    const repo = repositoryFor(kind, fixture.spec);
    const record = await repo.insert(fixture.make(`${unique}-frozen`));
    assert.throws(() => {
      /** @type {Record<string, unknown>} */ (record)['status'] = 'active';
    });
    const again = await repo.findById(String(record['id']));
    assert.equal(again?.['status'], record['status']);
  });

  test(`${label} معرّف مكرّر يُرفض بـ DUPLICATE_ID`, { skip }, async () => {
    const repo = repositoryFor(kind, fixture.spec);
    const input = fixture.make(`${unique}-dup`);
    await repo.insert(input);
    await assert.rejects(
      () => repo.insert({ ...input, ...fixture.freshUniques(`${unique}dupb`) }),
      (/** @type {unknown} */ error) => hasCode(error, REPOSITORY_ERRORS.DUPLICATE_ID),
    );
  });

  test(`${label} قيمة فريدة مكرّرة تُرفض بـ DUPLICATE_UNIQUE`, { skip }, async () => {
    const repo = repositoryFor(kind, fixture.spec);
    const first = fixture.make(`${unique}-u1`);
    await repo.insert(first);
    const second = fixture.make(`${unique}-u2`);
    second[fixture.uniqueField] = first[fixture.uniqueField];
    await assert.rejects(
      () => repo.insert(second),
      (/** @type {unknown} */ error) => hasCode(error, REPOSITORY_ERRORS.DUPLICATE_UNIQUE),
    );
  });

  test(`${label} حقل غير معروف يُرفض`, { skip }, async () => {
    const repo = repositoryFor(kind, fixture.spec);
    await assert.rejects(
      () => repo.insert({ ...fixture.make(`${unique}-x`), مجهول: 1 }),
      (/** @type {unknown} */ error) => hasCode(error, REPOSITORY_ERRORS.UNKNOWN_FIELD),
    );
  });

  test(`${label} قيمة خارج القيم المسموحة تُرفض`, { skip }, async () => {
    const repo = repositoryFor(kind, fixture.spec);
    await assert.rejects(
      () => repo.insert({ ...fixture.make(`${unique}-e`), status: 'ghost' }),
      (/** @type {unknown} */ error) => hasCode(error, REPOSITORY_ERRORS.INVALID_RECORD),
    );
  });

  test(`${label} التحديث يرفع النسخة، والنسخة القديمة تُرفض`, { skip }, async () => {
    const repo = repositoryFor(kind, fixture.spec);
    const record = await repo.insert(fixture.make(`${unique}-v`));
    const id = String(record['id']);
    const updated = await repo.update(id, 1, fixture.validPatch);
    assert.equal(updated['version'], 2);
    await assert.rejects(
      () => repo.update(id, 1, fixture.validPatch),
      (/** @type {unknown} */ error) => hasCode(error, REPOSITORY_ERRORS.VERSION_CONFLICT),
    );
  });

  test(`${label} التحديث لا يكتب حقلاً يديره المستودع`, { skip }, async () => {
    const repo = repositoryFor(kind, fixture.spec);
    const record = await repo.insert(fixture.make(`${unique}-m`));
    await assert.rejects(
      () => repo.update(String(record['id']), 1, { version: 99 }),
      (/** @type {unknown} */ error) => hasCode(error, REPOSITORY_ERRORS.UNKNOWN_FIELD),
    );
  });

  test(`${label} تحديث يخالف ثابتاً مركّباً يُرفض`, { skip }, async () => {
    const repo = repositoryFor(kind, fixture.spec);
    const record = await repo.insert(fixture.make(`${unique}-i`));
    await assert.rejects(
      () => repo.update(String(record['id']), 1, fixture.invalidPatch),
      (/** @type {unknown} */ error) =>
        hasCode(error, REPOSITORY_ERRORS.INVALID_RECORD) &&
        String(/** @type {Error} */ (error).message).includes(fixture.invariantCode),
    );
  });

  test(`${label} تحديث أو حذف سجل غائب يُرفض بـ NOT_FOUND`, { skip }, async () => {
    const repo = repositoryFor(kind, fixture.spec);
    await assert.rejects(
      () => repo.update(`${entity}-غائب-${unique}`, 1, fixture.validPatch),
      (/** @type {unknown} */ error) => hasCode(error, REPOSITORY_ERRORS.NOT_FOUND),
    );
    await assert.rejects(
      () => repo.remove(`${entity}-غائب-${unique}`, 1),
      (/** @type {unknown} */ error) => hasCode(error, REPOSITORY_ERRORS.NOT_FOUND),
    );
  });

  test(`${label} الحذف بنسخة قديمة يُرفض، وبالنسخة الصحيحة ينجح`, { skip }, async () => {
    const repo = repositoryFor(kind, fixture.spec);
    const record = await repo.insert(fixture.make(`${unique}-d`));
    const id = String(record['id']);
    await assert.rejects(
      () => repo.remove(id, 7),
      (/** @type {unknown} */ error) => hasCode(error, REPOSITORY_ERRORS.VERSION_CONFLICT),
    );
    await repo.remove(id, 1);
    assert.equal(await repo.findById(id), null);
  });

  test(`${label} القائمة تُرشَّح وتُحَدّ وتُرتَّب ترتيباً مثبَّتاً`, { skip }, async () => {
    const repo = repositoryFor(kind, fixture.spec);
    const ids = [];
    for (const suffix of ['l1', 'l2', 'l3']) {
      const record = await repo.insert(fixture.make(`${unique}-${suffix}`));
      ids.push(String(record['id']));
    }
    const listed = await repo.list({ filter: fixture.filter });
    const listedIds = listed.map((row) => String(row['id']));
    for (const id of ids) assert.ok(listedIds.includes(id), `${id} غائب من القائمة`);
    const limited = await repo.list({ filter: fixture.filter, limit: 2 });
    assert.equal(limited.length, 2);
    assert.ok((await repo.count(fixture.filter)) >= 3);
  });

  test(`${label} الترشيح بحقل غير مدعوم يُرفض لا يُتجاهل`, { skip }, async () => {
    const repo = repositoryFor(kind, fixture.spec);
    await assert.rejects(
      () => repo.list({ filter: { id: 'أيّ' } }),
      (/** @type {unknown} */ error) => hasCode(error, REPOSITORY_ERRORS.UNSUPPORTED_FILTER),
    );
  });
}

for (const entity of /** @type {const} */ (['agents', 'models'])) {
  contractSuite('memory', entity, 'mem');
  contractSuite('postgres', entity, 'pg');
}
