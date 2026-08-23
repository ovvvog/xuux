/**
 * اختبارات نظام الهجرات — الخطوة `M3.03`.
 *
 * معيار القبول في خارطة الطريق: «`migrate up` ثم `migrate down` يعودان بالقاعدة
 * إلى حالتها الأصلية». وهذا يُقاس هنا **بصورة من كتالوج القاعدة** قبل التقديم
 * وبعد التراجع، لا بالثقة بأن `DROP` نظّف. ومعها اختبارات ما يُفشل النظام: بصمة
 * تغيّرت، وثغرة ترقيم، وهجرة بلا تراجع، وهجرة تسقط في منتصفها.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  DEFAULT_MIGRATIONS_DIR,
  MIGRATION_ERRORS,
  down,
  loadMigrations,
  readApplied,
  status,
  up,
} from '../../src/persistence/migrator.mjs';
import { catalogSnapshot, createIsolatedDatabase, skipWithoutDatabase } from '../helpers/pg.mjs';

/** أنشئ مجلد هجرات مؤقتاً بمحتوى معطى. */
/**
 * @param {Record<string, string>} files
 * @returns {string}
 */
function tempMigrationsDir(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'migrations-'));
  for (const [name, body] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, name), body, 'utf8');
  }
  return dir;
}

// ── قراءة الهجرات والتحقّق من تماسكها (لا تحتاج قاعدة) ────────────────────────

test('هجرات المستودع الحقيقية تُقرأ ولكل واحدة تراجع', () => {
  const migrations = loadMigrations(DEFAULT_MIGRATIONS_DIR);
  assert.ok(migrations.length >= 1, 'لا هجرة في المستودع');
  assert.equal(migrations[0]?.version, 1);
  for (const migration of migrations) {
    assert.ok(migration.down.trim().length > 0, `الهجرة ${migration.version} بلا تراجع`);
    assert.match(migration.checksum, /^[0-9a-f]{64}$/);
  }
});

test('هجرة بلا ملف تراجع تُرفض قبل أن تُنفَّذ', () => {
  const dir = tempMigrationsDir({ '0001_only_up.up.sql': 'SELECT 1;' });
  assert.throws(
    () => loadMigrations(dir),
    (/** @type {unknown} */ error) =>
      /** @type {{ code?: string }} */ (error).code === MIGRATION_ERRORS.DOWN_MISSING,
  );
});

test('ثغرة في الترقيم تُكشف', () => {
  const dir = tempMigrationsDir({
    '0001_a.up.sql': 'SELECT 1;',
    '0001_a.down.sql': 'SELECT 1;',
    '0003_c.up.sql': 'SELECT 1;',
    '0003_c.down.sql': 'SELECT 1;',
  });
  assert.throws(
    () => loadMigrations(dir),
    (/** @type {unknown} */ error) =>
      /** @type {{ code?: string }} */ (error).code === MIGRATION_ERRORS.GAP,
  );
});

test('رقم واحد لاسمين — تصادم فرعين — يُكشف', () => {
  const dir = tempMigrationsDir({
    '0001_a.up.sql': 'SELECT 1;',
    '0001_a.down.sql': 'SELECT 1;',
    '0001_b.up.sql': 'SELECT 1;',
    '0001_b.down.sql': 'SELECT 1;',
  });
  assert.throws(
    () => loadMigrations(dir),
    (/** @type {unknown} */ error) =>
      /** @type {{ code?: string }} */ (error).code === MIGRATION_ERRORS.DUPLICATE,
  );
});

test('اسم لا يطابق الصيغة يُرفض', () => {
  const dir = tempMigrationsDir({ 'schema.sql': 'SELECT 1;' });
  assert.throws(
    () => loadMigrations(dir),
    (/** @type {unknown} */ error) =>
      /** @type {{ code?: string }} */ (error).code === MIGRATION_ERRORS.BAD_NAME,
  );
});

// ── ما لا يُبرهن إلا على قاعدة حقيقية ────────────────────────────────────────

test(
  'up ثم down يعودان بالقاعدة إلى حالتها الأصلية — بمقايسة الكتالوج',
  { skip: skipWithoutDatabase },
  async () => {
    const db = await createIsolatedDatabase('roundtrip');
    try {
      const before = await catalogSnapshot(db.pool);

      // الأرقام تُقرأ من المستودع لا تُثبَّت في الاختبار: تثبيتُ «[1]» يعني أن
      // إضافة أي هجرة تُفشل اختباراً لا علاقة له بصحّتها.
      const versions = (await loadMigrations()).map((migration) => migration.version);
      const latest = versions[versions.length - 1];
      assert.ok(latest !== undefined, 'لا هجرات في المستودع');

      const applied = await up(db.pool);
      assert.deepEqual(applied.applied, versions);
      assert.equal(applied.current, latest);

      const tables = await db.pool.query(
        `SELECT table_name FROM information_schema.tables WHERE table_schema = 'state' ORDER BY table_name`,
      );
      assert.deepEqual(
        tables.rows.map((row) => /** @type {Record<string, unknown>} */ (row)['table_name']),
        [
          'agents',
          'cases',
          'commands',
          'data_assets',
          'events',
          'laws',
          'memories',
          'models',
          'policies',
          'quotas',
        ],
        'المخطَّط الأول يجب أن يحمل الجداول العشرة المذكورة في M3.02',
      );

      // التراجع خطوةً خطوة حتى الصفر: `down` تتراجع عن الأخيرة وحدها.
      for (let step = versions.length; step > 0; step -= 1) {
        const reverted = await down(db.pool);
        assert.deepEqual(reverted.reverted, [versions[step - 1]]);
        assert.equal(reverted.current, step === 1 ? 0 : versions[step - 2]);
      }

      // دفتر النسخ يبقى موجوداً بعد التراجع (يملكه المُهاجر لا الهجرة)، لكنه فارغ؛
      // فيُستثنى من المقايسة بحذفه، ثم تُقايس القاعدة صورةً بصورة.
      await db.pool.query('DROP TABLE public.schema_migrations');
      const after = await catalogSnapshot(db.pool);
      assert.equal(after, before, 'التراجع لم يُعِد القاعدة إلى حالتها الأصلية');
    } finally {
      await db.drop();
    }
  },
);

test('up مرتين لا يُطبّق شيئاً في الثانية', { skip: skipWithoutDatabase }, async () => {
  const db = await createIsolatedDatabase('idempotent');
  try {
    await up(db.pool);
    const versions = (await loadMigrations()).map((migration) => migration.version);
    const second = await up(db.pool);
    assert.deepEqual(second.applied, []);
    assert.equal(second.current, versions[versions.length - 1]);
    const state = await status(db.pool);
    assert.equal(
      state.rows.every((row) => row.isApplied),
      true,
    );
  } finally {
    await db.drop();
  }
});

test('تعديل هجرة بعد تطبيقها يُرفض ببصمة لا تطابق', { skip: skipWithoutDatabase }, async () => {
  const db = await createIsolatedDatabase('checksum');
  try {
    await up(db.pool);
    // محاكاة تعديل الملف بعد التطبيق: البصمة المسجَّلة لم تبقَ تطابق القرص.
    await db.pool.query(`UPDATE public.schema_migrations SET checksum = repeat('a', 64)`);
    await assert.rejects(
      () => up(db.pool),
      (/** @type {unknown} */ error) =>
        /** @type {{ code?: string }} */ (error).code === MIGRATION_ERRORS.CHECKSUM_MISMATCH,
    );
  } finally {
    await db.drop();
  }
});

test('هجرة مُطبَّقة لا ملف لها تُكشف', { skip: skipWithoutDatabase }, async () => {
  const db = await createIsolatedDatabase('orphan');
  try {
    await up(db.pool);
    // رقمٌ بعد آخر هجرة في المستودع، فلا يتعارض مع دفتر النسخ حين تُضاف هجرات.
    const versions = (await loadMigrations()).map((migration) => migration.version);
    const ghost = Number(versions[versions.length - 1] ?? 0) + 1;
    await db.pool.query(
      `INSERT INTO public.schema_migrations (version, name, checksum, applied_by)
       VALUES ($1, 'ghost', repeat('b', 64), 'test')`,
      [ghost],
    );
    await assert.rejects(
      () => status(db.pool),
      (/** @type {unknown} */ error) =>
        /** @type {{ code?: string }} */ (error).code === MIGRATION_ERRORS.MISSING_FILE,
    );
  } finally {
    await db.drop();
  }
});

test(
  'هجرة تسقط في منتصفها لا تُخلّف مخطَّطاً نصف مطبَّق ولا صفَّ نسخة',
  { skip: skipWithoutDatabase },
  async () => {
    const dir = tempMigrationsDir({
      // الجدول الأول ينجح ثم يأتي خطأ صريح: بلا معاملة كان الجدول سيبقى.
      '0001_partial.up.sql': 'CREATE TABLE public.half_done (id int PRIMARY KEY);\nSELECT 1/0;',
      '0001_partial.down.sql': 'DROP TABLE IF EXISTS public.half_done;',
    });
    const db = await createIsolatedDatabase('atomic');
    try {
      await assert.rejects(() => up(db.pool, { dir }));
      const table = await db.pool.query(
        `SELECT to_regclass('public.half_done') IS NOT NULL AS present`,
      );
      assert.equal(
        /** @type {Record<string, unknown>} */ (table.rows[0])['present'],
        false,
        'الجدول بقي بعد إخفاق الهجرة — الهجرة ليست ذرية',
      );
      assert.deepEqual(await readApplied(db.pool), []);
    } finally {
      await db.drop();
    }
  },
);

test('down بلا هجرة مُطبَّقة يُرفض برمز مسمّى', { skip: skipWithoutDatabase }, async () => {
  const db = await createIsolatedDatabase('nothing');
  try {
    await assert.rejects(
      () => down(db.pool),
      (/** @type {unknown} */ error) =>
        /** @type {{ code?: string }} */ (error).code === MIGRATION_ERRORS.NOTHING_TO_REVERT,
    );
  } finally {
    await db.drop();
  }
});
