/**
 * أدلة سياسة الاحتفاظ والمحو — الخطوة `M3.08`.
 *
 * كل دليل يستعمل قاعدة معزولة: المحو الحقيقي لا يُختبر بمحاكاة، ولا يجوز أن يلمس
 * قاعدة مطوّر أو اختباراً موازياً. عند غياب الوصلة يظهر سبب التخطّي من المساعد.
 *
 * **ومنذ `R6-A-11`** لا تحذفُ هذه الوحدةُ صفّاً: `purge` بلا `dryRun` و`eraseById`
 * تُرفَضانِ برمزِ `RETENTION_PURGE_UNAUTHORIZED`، إذ كانتا مسارَ محوٍ خارجَ سلطةِ
 * `purge-data` وبلا سجلِّ محوٍ. فالأدلّةُ التي كانت تقيسُ «المحوَ الخامَ يقع»
 * صارت تقيسُ «الرفضَ يقعُ والصفُّ باقٍ»، والعدُّ (`plan`) يبقى مقيساً كما كان.
 * والمحوُ مع السلطةِ مقيسٌ على المسارِ المحكومِ وحدَه: `RetentionCycle.run`
 * في `tests/data/retention-authorization.test.mjs` و`tests/data/retention-cycle.test.mjs`.
 */

import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import { up } from '../../src/persistence/migrator.mjs';
import { eraseById, plan, purge, RETENTION_ERRORS } from '../../src/persistence/retention.mjs';
import { createIsolatedDatabase, skipWithoutDatabase } from '../helpers/pg.mjs';
import { createTestEncryptor } from '../helpers/encryption.mjs';

/** @type {{ pool: import('pg').Pool, drop: () => Promise<void> } | null} */
let db = null;

const NOW = new Date('2026-08-24T00:00:00.000Z');
const OLD = new Date('2026-08-20T00:00:00.000Z');
const OLDER = new Date('2026-08-19T00:00:00.000Z');
const RECENT = new Date('2026-08-23T12:00:00.000Z');

before(async () => {
  if (skipWithoutDatabase !== false) return;
  const created = await createIsolatedDatabase('retention');
  db = created;
  await up(created.pool);
  await created.pool.query(
    `INSERT INTO state.agents (id, name, role, owner, kind, status, certificate)
     VALUES ('agent-retention-001', 'وكيل الاحتفاظ', 'auditor', 'crown', 'service', 'active', '{}'::jsonb)`,
  );
});

after(async () => {
  if (db !== null) await db.drop();
});

/** @returns {import('pg').Pool} */
function pool() {
  if (db === null) throw new Error('لا قاعدة — كان يجب أن يُتخطّى الاختبار.');
  return db.pool;
}

/**
 * @param {string} id
 * @returns {Promise<void>}
 */
async function insertExpiredAsset(id) {
  await pool().query(
    `INSERT INTO state.data_assets
       (id, name, classification, owner, source, retention_days, legal_hold, created_at)
     VALUES ($1, $2, 'internal', 'owner-retention-001', 'crown', $3, FALSE, $4)`,
    [id, `أصل ${id}`, 1, OLD],
  );
}

/**
 * عقد بيانات حديث باحتفاظ طويل — لا يستحق المحو أبداً في هذه الاختبارات.
 * @param {string} id
 * @returns {Promise<void>}
 */
async function insertLongLivedAsset(id) {
  await pool().query(
    `INSERT INTO state.data_assets
       (id, name, classification, owner, source, retention_days, legal_hold, created_at)
     VALUES ($1, $2, 'internal', 'owner-retention-001', 'crown', 3650, FALSE, $3)`,
    [id, `عقد ${id}`, RECENT],
  );
}

/**
 * @param {string} id
 * @returns {Promise<void>}
 */
async function insertExpiredMemory(id) {
  // الذاكرة تحيل إلى عقد بيانات (مفتاح خارجي أُضيف في الهجرة `0002`)، والعقد
  // هنا **بعيد الانتهاء وحديث** كي لا يدخل في عدّ ما يستحق المحو فيُشوّش القياس.
  await insertLongLivedAsset(`dataset-${id}`);
  // والمحتوى **مغلَّفٌ بالمغلِّف نفسه**: قيدُ `memories_content_sealed` (الهجرة
  // `0006`) يرفض `'{}'` رفضاً محتوماً بـ`23514`. فكان هذا التمهيدُ يُخفق من يومِ
  // تلك الهجرة، ولم يظهر لأن اختبارات القاعدة متخطّاةٌ بغياب `DATABASE_URL`
  // ومسارُ CI يموت قبلها في خطوة الهجرات (`WL-045`). ولا يُغلَق بشكلٍ مُخترعٍ
  // يُشبه المغلَّف: دورةُ الاحتفاظ تمحو صفوفاً حقيقيةً لا أشكالاً.
  const encryption = await createTestEncryptor();
  try {
    const sealed = await encryption.encryptor.seal({
      value: { note: `ذاكرةٌ منتهيةٌ ${id}` },
      classification: 'internal',
      binding: { id, agentId: 'agent-retention-001', datasetId: `dataset-${id}` },
    });
    await pool().query(
      `INSERT INTO state.memories (id, agent_id, dataset_id, kind, content, legal_hold, created_at, expires_at)
     VALUES ($1, 'agent-retention-001', $4, 'episodic', $5::jsonb, FALSE, $2, $3)`,
      [id, OLDER, OLD, `dataset-${id}`, JSON.stringify(sealed)],
    );
  } finally {
    encryption.cleanup();
  }
}

/**
 * @param {unknown} error
 * @returns {boolean}
 */
function unauthorized(error) {
  return (
    typeof error === 'object' &&
    error !== null &&
    /** @type {Record<string, unknown>} */ (error)['code'] === RETENTION_ERRORS.PURGE_UNAUTHORIZED
  );
}

/**
 * @param {string} id
 * @returns {Promise<number>}
 */
async function rowCount(id) {
  const result = await pool().query(
    `SELECT
       (SELECT count(*)::int FROM state.data_assets WHERE id = $1) +
       (SELECT count(*)::int FROM state.memories WHERE id = $1) AS "n"`,
    [id],
  );
  const row = /** @type {Record<string, unknown> | undefined} */ (result.rows[0]);
  return row === undefined ? 0 : Number(row['n']);
}

test(
  'أصل بيانات انتهى احتفاظه يُعَدّ مستحقّاً، ومحوُه الخامُ بلا سلطةٍ يُرفَض ولا يمسّ صفّاً (R6-A-11)',
  { skip: skipWithoutDatabase },
  async () => {
    await insertExpiredAsset('asset-expired-001');
    await pool().query(
      `INSERT INTO state.data_assets
         (id, name, classification, owner, source, retention_days, created_at)
       VALUES ($1, $2, 'internal', 'owner-retention-001', 'crown', $3, $4)`,
      ['asset-fresh-001', 'أصل حديث', 30, RECENT],
    );

    const simulated = await purge(pool(), { now: NOW, tables: ['data_assets'], dryRun: true });
    assert.deepEqual(simulated.tables, [
      {
        table: 'state.data_assets',
        eligible: 1,
        legalHoldProtected: 0,
        deleted: 0,
      },
    ]);
    await assert.rejects(() => purge(pool(), { now: NOW, tables: ['data_assets'] }), unauthorized);
    await assert.rejects(() => eraseById(pool(), 'data_assets', 'asset-expired-001'), unauthorized);
    assert.equal(
      await rowCount('asset-expired-001'),
      1,
      'الأصل المنتهي باقٍ: المحوُ الخامُ رُفِض، والمحوُ المحكومُ عبرَ RetentionCycle.',
    );
    assert.equal(await rowCount('asset-fresh-001'), 1, 'الأصل غير المنتهي بقي.');
  },
);

test(
  'الحفظ القانوني يُعَدّ محميّاً، والمحو الدوري والموجّه الخامُ مرفوضانِ برمز مسمّى (R6-A-11)',
  { skip: skipWithoutDatabase },
  async () => {
    await pool().query(
      `INSERT INTO state.data_assets
         (id, name, classification, owner, source, retention_days, legal_hold, created_at)
       VALUES ($1, $2, 'sensitive', 'owner-retention-001', 'crown', $3, TRUE, $4)`,
      ['asset-hold-001', 'أصل محفوظ قانوناً', 1, OLD],
    );

    const report = await plan(pool(), { now: NOW });
    const assetReport = report.tables.find((row) => row.table === 'state.data_assets');
    assert.ok(assetReport !== undefined);
    assert.equal(assetReport.legalHoldProtected, 1);

    const periodic = await purge(pool(), { now: NOW, tables: ['data_assets'], dryRun: true });
    assert.equal(periodic.tables[0]?.deleted, 0);
    assert.equal(periodic.tables[0]?.legalHoldProtected, 1);
    await assert.rejects(() => purge(pool(), { now: NOW, tables: ['data_assets'] }), unauthorized);
    assert.equal(await rowCount('asset-hold-001'), 1);
    await assert.rejects(() => eraseById(pool(), 'data_assets', 'asset-hold-001'), unauthorized);
    assert.equal(await rowCount('asset-hold-001'), 1);
  },
);

test(
  'ذاكرة منتهية تُعَدّ مستحقّةً، ومحوُها الخامُ يُرفَض ولا يمسّ صفّاً (R6-A-11)',
  { skip: skipWithoutDatabase },
  async () => {
    await insertExpiredMemory('memory-expired-001');
    await insertLongLivedAsset('dataset-memory-hold-001');
    // ومحتوى ذاكرةِ الحفظ القانوني مغلَّفٌ كذلك: نفسُ القيد ونفسُ السبب (`WL-045`).
    const hold = await createTestEncryptor();
    try {
      await pool().query(
        `INSERT INTO state.memories (id, agent_id, dataset_id, kind, content, legal_hold, created_at)
       VALUES ($1, 'agent-retention-001', 'dataset-memory-hold-001', 'semantic', $3::jsonb, TRUE, $2)`,
        [
          'memory-hold-001',
          OLD,
          JSON.stringify(
            await hold.encryptor.seal({
              value: { note: 'ذاكرةٌ محفوظةٌ قانوناً' },
              classification: 'internal',
              binding: {
                id: 'memory-hold-001',
                agentId: 'agent-retention-001',
                datasetId: 'dataset-memory-hold-001',
              },
            }),
          ),
        ],
      );
    } finally {
      hold.cleanup();
    }

    const simulated = await purge(pool(), { now: NOW, tables: ['memories'], dryRun: true });
    assert.equal(simulated.tables[0]?.eligible, 1);
    assert.equal(simulated.tables[0]?.legalHoldProtected, 1);
    assert.equal(simulated.tables[0]?.deleted, 0);
    await assert.rejects(() => purge(pool(), { now: NOW, tables: ['memories'] }), unauthorized);
    assert.equal(await rowCount('memory-expired-001'), 1, 'المحوُ الخامُ رُفِض والصفُّ باقٍ.');
    assert.equal(await rowCount('memory-hold-001'), 1);
    await assert.rejects(() => eraseById(pool(), 'memories', 'memory-expired-001'), unauthorized);
    await assert.rejects(() => eraseById(pool(), 'memories', 'memory-hold-001'), unauthorized);
    assert.equal(await rowCount('memory-expired-001'), 1);
    assert.equal(await rowCount('memory-hold-001'), 1);
  },
);

test('التقرير الجاف لا يحذف أي صف', { skip: skipWithoutDatabase }, async () => {
  await insertExpiredAsset('asset-dry-run-001');
  await insertExpiredMemory('memory-dry-run-001');
  const before = await pool().query(
    `SELECT
       (SELECT count(*)::int FROM state.data_assets) AS "assets",
       (SELECT count(*)::int FROM state.memories) AS "memories"`,
  );
  const planned = await plan(pool(), { now: NOW });
  const simulated = await purge(pool(), { now: NOW, dryRun: true });
  const after = await pool().query(
    `SELECT
       (SELECT count(*)::int FROM state.data_assets) AS "assets",
       (SELECT count(*)::int FROM state.memories) AS "memories"`,
  );
  assert.deepEqual(after.rows, before.rows);
  assert.equal(planned.tables.find((row) => row.table === 'state.data_assets')?.eligible, 1);
  assert.equal(simulated.tables.find((row) => row.table === 'state.memories')?.deleted, 0);
});

test(
  'المحو الخام متعدّد الجداول يُرفَض قبل أي حذف فلا حالة جزئية (R6-A-11)',
  { skip: skipWithoutDatabase },
  async () => {
    await insertExpiredAsset('asset-atomic-001');
    await insertExpiredMemory('memory-atomic-001');
    await pool().query(
      `CREATE FUNCTION state.retention_fail_memory_delete()
     RETURNS trigger
     LANGUAGE plpgsql
     AS $$ BEGIN RAISE EXCEPTION 'فشل مقصود لاختبار التراجع'; END $$`,
    );
    await pool().query(
      `CREATE TRIGGER retention_fail_memory_delete
     BEFORE DELETE ON state.memories
     FOR EACH ROW EXECUTE FUNCTION state.retention_fail_memory_delete()`,
    );
    try {
      await assert.rejects(
        () => purge(pool(), { now: NOW, tables: ['data_assets', 'memories'] }),
        unauthorized,
      );
      assert.equal(await rowCount('asset-atomic-001'), 1, 'الأصل باقٍ: لم يُحذَف شيءٌ قبل الرفض.');
      assert.equal(await rowCount('memory-atomic-001'), 1, 'صف الفشل بقي.');
    } finally {
      await pool().query('DROP TRIGGER IF EXISTS retention_fail_memory_delete ON state.memories');
      await pool().query('DROP FUNCTION IF EXISTS state.retention_fail_memory_delete()');
    }
  },
);

test(
  'الأحداث مرفوضة من المحو كي لا تنقطع سلسلة التجزئة',
  { skip: skipWithoutDatabase },
  async () => {
    const hash1 = '1'.repeat(64);
    const hash2 = '2'.repeat(64);
    const hash3 = '3'.repeat(64);
    await pool().query(
      `INSERT INTO state.events (event_id, type, actor, payload, hash, prev_hash, occurred_at, recorded_at)
       VALUES
         ($1, 'state.retention', 'agent-retention-001', '{}'::jsonb, $2, NULL, $3, $3),
         ($4, 'state.retention', 'agent-retention-001', '{}'::jsonb, $5, $2, $3, $3),
         ($6, 'state.retention', 'agent-retention-001', '{}'::jsonb, $7, $5, $3, $3)`,
      [
        'event-retention-001',
        hash1,
        OLD,
        'event-retention-002',
        hash2,
        'event-retention-003',
        hash3,
      ],
    );
    await assert.rejects(
      () => purge(pool(), { now: NOW, tables: ['events'] }),
      (error) =>
        typeof error === 'object' &&
        error !== null &&
        /** @type {Record<string, unknown>} */ (error)['code'] ===
          RETENTION_ERRORS.EVENTS_IMMUTABLE,
    );
    await assert.rejects(
      () => eraseById(pool(), 'events', 'event-retention-001'),
      (error) =>
        typeof error === 'object' &&
        error !== null &&
        /** @type {Record<string, unknown>} */ (error)['code'] ===
          RETENTION_ERRORS.EVENTS_IMMUTABLE,
    );
    const continuity = await pool().query(
      `SELECT count(*)::int AS "broken"
       FROM state.events current_event
       WHERE current_event.prev_hash IS NOT NULL
         AND NOT EXISTS (
           SELECT 1 FROM state.events previous_event WHERE previous_event.hash = current_event.prev_hash
         )`,
    );
    const row = /** @type {Record<string, unknown> | undefined} */ (continuity.rows[0]);
    assert.equal(Number(row?.['broken']), 0, 'السلسلة بقيت متصلة لأن المحو رُفض.');
  },
);
