/**
 * نظام الهجرات المُرقَّم — الخطوة `M3.03`.
 *
 * ما يجعل هذا النظام موثوقاً، وكلٌّ منها مُختبر في
 * `tests/persistence/migrator.test.mjs`:
 *
 * 1. **كل هجرة لها تراجع.** ملفٌ `NNNN_name.up.sql` بلا `NNNN_name.down.sql`
 *    يُرفض بـ`MIGRATION_DOWN_MISSING` قبل أن تُنفَّذ أي هجرة. هجرةٌ لا تُتراجع
 *    تُخرج القاعدة من التحكّم عند أول خطأ.
 * 2. **الترقيم متصل بلا ثغرة ولا تكرار.** فرعان يكتبان الرقم نفسه يُكشفان
 *    (`MIGRATION_DUPLICATE`)، وحذفُ ملفٍ من الوسط يُكشف (`MIGRATION_GAP`) —
 *    والقاعدة التي طبّقت هجرةً لم يبقَ لها ملف تُكشف (`MIGRATION_MISSING_FILE`).
 * 3. **بصمة على المُطبَّق.** تعديل هجرة طُبِّقت يُرفض بـ`MIGRATION_CHECKSUM_MISMATCH`؛
 *    وإلا اختلف مخطَّط بيئتين وكلٌّ منهما يقول إنه على نفس الإصدار.
 * 4. **كل هجرة في معاملة واحدة** مع صفّها في `public.schema_migrations`: فشلٌ في
 *    منتصف هجرة لا يُخلّف مخطَّطاً نصف مطبَّق ولا صفَّ نسخةٍ لم تكتمل.
 * 5. **قفل استشاري** يمنع مُهاجرين متزامنين من تطبيق نفس الهجرة مرتين.
 *
 * **حدٌّ معلن:** الهجرات التي تحتوي `CREATE INDEX CONCURRENTLY` أو `VACUUM` لا
 * تعمل داخل معاملة، ولا تُدعم هنا اليوم؛ من احتاجها يُصرّح بها في خطوة قادمة
 * بمسار منفصل معلَن، لا بإسقاط المعاملة عن الجميع.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { withTransaction } from './db.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
/** مجلد الهجرات الافتراضي — جذر المستودع/`migrations`. */
export const DEFAULT_MIGRATIONS_DIR = path.resolve(HERE, '../../migrations');

/** مفتاح القفل الاستشاري: ثابت مشتق من اسم المشروع لا رقم عشوائي. */
const ADVISORY_LOCK_KEY = 8_612_045_119;

const FILE_PATTERN = /^(\d{4})_([a-z0-9][a-z0-9_-]*)\.(up|down)\.sql$/;

export const MIGRATION_ERRORS = Object.freeze({
  DIR_MISSING: 'MIGRATION_DIR_MISSING',
  BAD_NAME: 'MIGRATION_BAD_NAME',
  DUPLICATE: 'MIGRATION_DUPLICATE',
  GAP: 'MIGRATION_GAP',
  DOWN_MISSING: 'MIGRATION_DOWN_MISSING',
  CHECKSUM_MISMATCH: 'MIGRATION_CHECKSUM_MISMATCH',
  MISSING_FILE: 'MIGRATION_MISSING_FILE',
  NOTHING_TO_REVERT: 'MIGRATION_NOTHING_TO_REVERT',
});

export class MigrationError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   */
  constructor(code, message) {
    super(message);
    this.name = 'MigrationError';
    /** @type {string} */
    this.code = code;
  }
}

/**
 * @typedef {object} Migration
 * @property {number} version
 * @property {string} name
 * @property {string} up
 * @property {string} down
 * @property {string} checksum بصمة نصّ التقديم والتراجع معاً.
 */

/**
 * @param {string} value
 * @returns {string}
 */
function sha256(value) {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}

/**
 * اقرأ الهجرات من القرص وتحقّق من تماسك ترقيمها واكتمال تراجعها.
 * @param {string} [dir]
 * @returns {Migration[]} مرتّبة تصاعدياً بالرقم.
 */
export function loadMigrations(dir = DEFAULT_MIGRATIONS_DIR) {
  if (!fs.existsSync(dir)) {
    throw new MigrationError(MIGRATION_ERRORS.DIR_MISSING, `مجلد الهجرات غير موجود: ${dir}`);
  }

  /** @type {Map<number, { name: string, up?: string, down?: string }>} */
  const found = new Map();
  for (const entry of fs.readdirSync(dir).sort()) {
    if (!entry.endsWith('.sql')) continue;
    const match = FILE_PATTERN.exec(entry);
    if (!match) {
      throw new MigrationError(
        MIGRATION_ERRORS.BAD_NAME,
        `اسم هجرة غير مطابق للصيغة NNNN_name.(up|down).sql: ${entry}`,
      );
    }
    const [, rawVersion, name, direction] = match;
    // القراءة بمؤشّرٍ قد تُرجع undefined في وضع الصرامة، فتُثبَّت القيم أولاً.
    if (rawVersion === undefined || name === undefined || direction === undefined) {
      throw new MigrationError(MIGRATION_ERRORS.BAD_NAME, `تعذّر تفكيك اسم الهجرة: ${entry}`);
    }
    const version = Number(rawVersion);
    const existing = found.get(version);
    if (existing !== undefined && existing.name !== name) {
      throw new MigrationError(
        MIGRATION_ERRORS.DUPLICATE,
        `الرقم ${rawVersion} مستعمل لاسمين: ${existing.name} و ${name} — فرعان كتبا نفس الرقم.`,
      );
    }
    const record = existing ?? { name };
    const sql = fs.readFileSync(path.join(dir, entry), 'utf8');
    if (direction === 'up') record.up = sql;
    else record.down = sql;
    found.set(version, record);
  }

  const versions = [...found.keys()].sort((a, b) => a - b);
  /** @type {Migration[]} */
  const migrations = [];
  for (const [index, version] of versions.entries()) {
    if (version !== index + 1) {
      throw new MigrationError(
        MIGRATION_ERRORS.GAP,
        `ثغرة في الترقيم: توقّعتُ ${index + 1} فوجدتُ ${version}. الترقيم يبدأ من 0001 ويتصل بلا فراغ.`,
      );
    }
    const record = found.get(version);
    if (record === undefined) continue;
    if (record.up === undefined) {
      throw new MigrationError(
        MIGRATION_ERRORS.BAD_NAME,
        `الهجرة ${version} (${record.name}) بلا ملف تقديم.`,
      );
    }
    if (record.down === undefined) {
      throw new MigrationError(
        MIGRATION_ERRORS.DOWN_MISSING,
        `الهجرة ${version} (${record.name}) بلا ملف تراجع — هجرة لا تُتراجع مرفوضة (M3.03).`,
      );
    }
    migrations.push({
      version,
      name: record.name,
      up: record.up,
      down: record.down,
      checksum: sha256(`${record.up}\u0000${record.down}`),
    });
  }
  return migrations;
}

/**
 * @param {import('pg').PoolClient | import('pg').Pool} client
 * @returns {Promise<void>}
 */
async function ensureLedger(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS public.schema_migrations (
      version integer PRIMARY KEY CHECK (version >= 1),
      name text NOT NULL CHECK (length(btrim(name)) > 0),
      checksum text NOT NULL CHECK (checksum ~ '^[0-9a-f]{64}$'),
      applied_at timestamptz NOT NULL DEFAULT now(),
      applied_by text NOT NULL CHECK (length(btrim(applied_by)) > 0)
    )
  `);
}

/**
 * @typedef {object} AppliedMigration
 * @property {number} version
 * @property {string} name
 * @property {string} checksum
 * @property {Date} appliedAt
 */

/**
 * اقرأ الهجرات المُطبَّقة في القاعدة.
 * @param {import('pg').Pool} pool
 * @returns {Promise<AppliedMigration[]>}
 */
export async function readApplied(pool) {
  await ensureLedger(pool);
  const result = await pool.query(
    'SELECT version, name, checksum, applied_at FROM public.schema_migrations ORDER BY version',
  );
  return result.rows.map((row) => {
    const record = /** @type {Record<string, unknown>} */ (row);
    return {
      version: Number(record['version']),
      name: String(record['name']),
      checksum: String(record['checksum']),
      appliedAt: /** @type {Date} */ (record['applied_at']),
    };
  });
}

/**
 * قايس القرص على القاعدة: بصمة كل مُطبَّق يجب أن تطابق ملفه، وكل مُطبَّق يجب أن
 * يبقى له ملف. هذا ما يمنع «بيئتان على نفس الإصدار ومخطَّطاهما مختلفان».
 * @param {Migration[]} migrations
 * @param {AppliedMigration[]} applied
 * @returns {void}
 */
export function assertConsistent(migrations, applied) {
  const byVersion = new Map(migrations.map((migration) => [migration.version, migration]));
  for (const row of applied) {
    const migration = byVersion.get(row.version);
    if (migration === undefined) {
      throw new MigrationError(
        MIGRATION_ERRORS.MISSING_FILE,
        `الهجرة ${row.version} (${row.name}) مُطبَّقة في القاعدة ولا ملف لها على القرص.`,
      );
    }
    if (migration.checksum !== row.checksum) {
      throw new MigrationError(
        MIGRATION_ERRORS.CHECKSUM_MISMATCH,
        `الهجرة ${row.version} (${row.name}) تغيّرت بعد تطبيقها: البصمة على القرص ${migration.checksum.slice(0, 12)}… وفي القاعدة ${row.checksum.slice(0, 12)}…`,
      );
    }
  }
}

/**
 * نفّذ عملاً تحت قفل استشاري، فلا يتسابق مُهاجران على نفس القاعدة.
 * @template T
 * @param {import('pg').Pool} pool
 * @param {() => Promise<T>} work
 * @returns {Promise<T>}
 */
async function withMigrationLock(pool, work) {
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [ADVISORY_LOCK_KEY]);
    return await work();
  } finally {
    try {
      await client.query('SELECT pg_advisory_unlock($1)', [ADVISORY_LOCK_KEY]);
    } finally {
      client.release();
    }
  }
}

/**
 * @typedef {object} MigrationOutcome
 * @property {number[]} applied الأرقام التي طُبِّقت في هذا النداء.
 * @property {number[]} reverted الأرقام التي تُراجع عنها في هذا النداء.
 * @property {number} current أعلى رقم مُطبَّق بعد النداء (صفر إن لا شيء).
 */

/**
 * @param {AppliedMigration[]} applied
 * @returns {number}
 */
function currentVersion(applied) {
  return applied.reduce((max, row) => (row.version > max ? row.version : max), 0);
}

/**
 * قدّم الهجرات غير المُطبَّقة حتى `to` (أو حتى آخرها).
 * @param {import('pg').Pool} pool
 * @param {object} [options]
 * @param {string} [options.dir]
 * @param {number} [options.to]
 * @param {string} [options.appliedBy]
 * @returns {Promise<MigrationOutcome>}
 */
export async function up(pool, options = {}) {
  const migrations = loadMigrations(options.dir ?? DEFAULT_MIGRATIONS_DIR);
  const appliedBy = options.appliedBy ?? `${process.env.USER ?? 'unknown'}@migrate`;
  return withMigrationLock(pool, async () => {
    const applied = await readApplied(pool);
    assertConsistent(migrations, applied);
    const appliedVersions = new Set(applied.map((row) => row.version));
    const target = options.to ?? Number.POSITIVE_INFINITY;
    /** @type {number[]} */
    const done = [];
    for (const migration of migrations) {
      if (migration.version > target) break;
      if (appliedVersions.has(migration.version)) continue;
      // الهجرة وصفّها في دفتر النسخ في معاملة واحدة: لا مخطَّط نصف مطبَّق، ولا
      // صفُّ نسخةٍ لهجرة لم تكتمل.
      await withTransaction(pool, async (client) => {
        await client.query(migration.up);
        await client.query(
          'INSERT INTO public.schema_migrations (version, name, checksum, applied_by) VALUES ($1, $2, $3, $4)',
          [migration.version, migration.name, migration.checksum, appliedBy],
        );
      });
      done.push(migration.version);
    }
    const after = await readApplied(pool);
    return { applied: done, reverted: [], current: currentVersion(after) };
  });
}

/**
 * تراجَع عن آخر `steps` هجرة مُطبَّقة، الأحدث أولاً.
 * @param {import('pg').Pool} pool
 * @param {object} [options]
 * @param {string} [options.dir]
 * @param {number} [options.steps]
 * @returns {Promise<MigrationOutcome>}
 */
export async function down(pool, options = {}) {
  const migrations = loadMigrations(options.dir ?? DEFAULT_MIGRATIONS_DIR);
  const steps = options.steps ?? 1;
  return withMigrationLock(pool, async () => {
    const applied = await readApplied(pool);
    assertConsistent(migrations, applied);
    if (applied.length === 0) {
      throw new MigrationError(
        MIGRATION_ERRORS.NOTHING_TO_REVERT,
        'لا هجرة مُطبَّقة يُتراجع عنها.',
      );
    }
    const byVersion = new Map(migrations.map((migration) => [migration.version, migration]));
    const order = [...applied].sort((a, b) => b.version - a.version).slice(0, steps);
    /** @type {number[]} */
    const reverted = [];
    for (const row of order) {
      const migration = byVersion.get(row.version);
      if (migration === undefined) {
        throw new MigrationError(
          MIGRATION_ERRORS.MISSING_FILE,
          `لا ملف تراجع للهجرة ${row.version} (${row.name}).`,
        );
      }
      await withTransaction(pool, async (client) => {
        await client.query(migration.down);
        await client.query('DELETE FROM public.schema_migrations WHERE version = $1', [
          migration.version,
        ]);
      });
      reverted.push(migration.version);
    }
    const after = await readApplied(pool);
    return { applied: [], reverted, current: currentVersion(after) };
  });
}

/**
 * @typedef {object} MigrationStatusRow
 * @property {number} version
 * @property {string} name
 * @property {boolean} isApplied
 * @property {Date | null} appliedAt
 */

/**
 * حالة كل هجرة: مُطبَّقة أم لا، ومتى.
 * @param {import('pg').Pool} pool
 * @param {object} [options]
 * @param {string} [options.dir]
 * @returns {Promise<{ current: number, rows: MigrationStatusRow[] }>}
 */
export async function status(pool, options = {}) {
  const migrations = loadMigrations(options.dir ?? DEFAULT_MIGRATIONS_DIR);
  const applied = await readApplied(pool);
  assertConsistent(migrations, applied);
  const appliedByVersion = new Map(applied.map((row) => [row.version, row]));
  return {
    current: currentVersion(applied),
    rows: migrations.map((migration) => {
      const row = appliedByVersion.get(migration.version);
      return {
        version: migration.version,
        name: migration.name,
        isApplied: row !== undefined,
        appliedAt: row === undefined ? null : row.appliedAt,
      };
    }),
  };
}
