#!/usr/bin/env node
/**
 * نسخ احتياطي قابل للاستعادة لمخطّط `state` ودفتر الهجرات.
 *
 * العيب الذي يعالجه هذا البرنامج: نجاح `pg_dump` وحده لا يثبت أن الملف لم يُبدّل
 * بعد إنشائه ولا يصف حجم البيانات التي ينبغي أن تعود. لذلك يُكتب بيان مجاور يحمل
 * البصمة وعدّ الصفوف والنسخة، وتتحقق منه `verify` قبل أن يُعتمد الملف.
 *
 * حدٌّ معلن: هذه الأداة لا تشفّر الملف ولا تنقله خارج الجهاز ولا تلتقط WAL؛ لذلك
 * ليست بديلاً عن PITR أو سياسة حفظ دورية.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import pg from 'pg';
import { fileURLToPath } from 'node:url';

const STATE_SCHEMA = 'state';
const MIGRATION_LEDGER = 'schema_migrations';
const PG_DUMP = '/usr/bin/pg_dump';
const PG_RESTORE = '/usr/bin/pg_restore';

export const BACKUP_ERRORS = Object.freeze({
  ARGUMENT: 'BACKUP_ARGUMENT',
  DATABASE_URL_MISSING: 'BACKUP_DATABASE_URL_MISSING',
  FILE_MISSING: 'BACKUP_FILE_MISSING',
  MANIFEST_MISSING: 'BACKUP_MANIFEST_MISSING',
  MANIFEST_INVALID: 'BACKUP_MANIFEST_INVALID',
  HASH_MISMATCH: 'BACKUP_HASH_MISMATCH',
  DUMP_UNREADABLE: 'BACKUP_DUMP_UNREADABLE',
  COMMAND_FAILED: 'BACKUP_COMMAND_FAILED',
});

/** خطأ مسمّى كي تميّز الأتمتة سبب الفشل من نصه العربي. */
export class BackupError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   */
  constructor(code, message) {
    super(message);
    this.name = 'BackupError';
    /** @type {string} */
    this.code = code;
  }
}

/**
 * @typedef {object} BackupManifest
 * @property {string} startedAt وقت بدء النسخ بصيغة ISO.
 * @property {number} durationMs مدة أمر النسخ بالمللي ثانية.
 * @property {string} databaseVersion إصدار PostgreSQL الذي أجاب به الخادم.
 * @property {number} migrationVersion أعلى هجرة مسجّلة.
 * @property {string} sha256 بصمة ملف النسخة كما كُتب على القرص.
 * @property {Record<string, number>} rowCounts عدّ الصفوف لكل جدول في `state`.
 * @property {string} dumpFile الاسم القاعدي للملف، للمراجعة البشرية فقط.
 * @property {string} ledgerStagingTable جدول مؤقت يحمل دفتر الهجرات داخل الأرشيف.
 */

/**
 * @param {string} identifier
 * @returns {string}
 */
function quoteIdent(identifier) {
  return `"${identifier.replace(/"/g, '""')}"`;
}

/**
 * لا يمكن تعليم اسم الجدول في PostgreSQL؛ لذلك لا يُقبل إلا ما أعاده كتالوج
 * القاعدة، ثم يُقتبس دائماً. لا يدخل نص مستخدم في هذا الاستعلام.
 * @param {import('pg').Pool} pool
 * @returns {Promise<string[]>}
 */
async function stateTables(pool) {
  const result = await pool.query(
    `SELECT c.relname
     FROM pg_class AS c
     JOIN pg_namespace AS n ON n.oid = c.relnamespace
     WHERE n.nspname = $1 AND c.relkind = 'r'
     ORDER BY c.relname`,
    [STATE_SCHEMA],
  );
  return result.rows.map((row) => String(/** @type {Record<string, unknown>} */ (row)['relname']));
}

/**
 * @param {import('pg').Pool} pool
 * @returns {Promise<Record<string, number>>}
 */
async function readRowCounts(pool) {
  const names = await stateTables(pool);
  /** @type {Record<string, number>} */
  const counts = {};
  for (const name of names) {
    const result = await pool.query(
      `SELECT count(*)::bigint AS count FROM ${quoteIdent(STATE_SCHEMA)}.${quoteIdent(name)}`,
    );
    const row = /** @type {Record<string, unknown> | undefined} */ (result.rows[0]);
    counts[name] = Number(row?.['count']);
  }
  return counts;
}

/**
 * @param {import('pg').Pool} pool
 * @returns {Promise<{ databaseVersion: string, migrationVersion: number, rowCounts: Record<string, number> }>}
 */
async function inspectDatabase(pool) {
  const [versionResult, migrationResult, rowCounts] = await Promise.all([
    pool.query('SHOW server_version'),
    pool.query(
      `SELECT COALESCE(max(version), 0)::integer AS version
       FROM public.${quoteIdent(MIGRATION_LEDGER)}`,
    ),
    readRowCounts(pool),
  ]);
  const versionRow = /** @type {Record<string, unknown> | undefined} */ (versionResult.rows[0]);
  const migrationRow = /** @type {Record<string, unknown> | undefined} */ (migrationResult.rows[0]);
  return {
    databaseVersion: String(versionRow?.['server_version']),
    migrationVersion: Number(migrationRow?.['version']),
    rowCounts,
  };
}

/**
 * `pg_dump --schema state --table public.schema_migrations` لا ينتج اتحاداً؛
 * ولذلك ينشأ هذا الجدول المؤقت في `state`، ثم يُنقل إلى `public` عند الاستعادة.
 * أسماء القيود تطابق دفتر المُهاجر حرفياً كي تعود صورة الكتالوج كما كانت.
 * @param {import('pg').Pool} pool
 * @param {string} table
 * @returns {Promise<void>}
 */
async function stageMigrationLedger(pool, table) {
  await pool.query(`
    CREATE TABLE ${quoteIdent(STATE_SCHEMA)}.${quoteIdent(table)} (
      version integer CONSTRAINT schema_migrations_version_not_null NOT NULL
        CONSTRAINT schema_migrations_version_check CHECK (version >= 1),
      name text CONSTRAINT schema_migrations_name_not_null NOT NULL
        CONSTRAINT schema_migrations_name_check CHECK (length(btrim(name)) > 0),
      checksum text CONSTRAINT schema_migrations_checksum_not_null NOT NULL
        CONSTRAINT schema_migrations_checksum_check CHECK (checksum ~ '^[0-9a-f]{64}$'),
      applied_at timestamptz CONSTRAINT schema_migrations_applied_at_not_null NOT NULL DEFAULT now(),
      applied_by text CONSTRAINT schema_migrations_applied_by_not_null NOT NULL
        CONSTRAINT schema_migrations_applied_by_check CHECK (length(btrim(applied_by)) > 0),
      CONSTRAINT schema_migrations_pkey PRIMARY KEY (version)
    )
  `);
  await pool.query(
    `INSERT INTO ${quoteIdent(STATE_SCHEMA)}.${quoteIdent(table)}
       (version, name, checksum, applied_at, applied_by)
     SELECT version, name, checksum, applied_at, applied_by
     FROM public.${quoteIdent(MIGRATION_LEDGER)}`,
  );
}

/**
 * @param {string} value
 * @returns {string}
 */
function sha256File(value) {
  return crypto.createHash('sha256').update(fs.readFileSync(value)).digest('hex');
}

/**
 * @param {string} dumpPath
 * @returns {string}
 */
export function manifestPathFor(dumpPath) {
  return `${dumpPath}.manifest.json`;
}

/**
 * @param {string} executable
 * @param {string[]} args
 * @returns {Promise<{ code: number, stderr: string }>}
 */
function run(executable, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('close', (code) => {
      resolve({ code: code ?? 1, stderr });
    });
  });
}

/**
 * @param {string} raw
 * @returns {string}
 */
function requireDatabaseUrl(raw) {
  if (raw.trim() === '') {
    throw new BackupError(
      BACKUP_ERRORS.DATABASE_URL_MISSING,
      'DATABASE_URL غير معلَنة؛ النسخ يرفض اختيار قاعدة افتراضية.',
    );
  }
  return raw;
}

/**
 * @returns {string}
 */
function defaultDumpPath() {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  return path.resolve('backups', `state-${timestamp}.dump`);
}

/**
 * @param {string[]} argv
 * @returns {{ command: 'create' | 'verify', dumpPath: string }}
 */
function parseArguments(argv) {
  const command = argv[0];
  const suppliedPath = argv[1];
  if (
    (command !== 'create' && command !== 'verify') ||
    (command === 'verify' && suppliedPath === undefined)
  ) {
    throw new BackupError(
      BACKUP_ERRORS.ARGUMENT,
      'الاستخدام: backup.mjs create [ملف.dump] | backup.mjs verify <ملف.dump>.',
    );
  }
  return {
    command,
    dumpPath: path.resolve(suppliedPath ?? defaultDumpPath()),
  };
}

/**
 * أنشئ نسخة بصيغة PostgreSQL المخصّصة وبيانها المجاور.
 * @param {string} dumpPath
 * @param {string} databaseUrl
 * @returns {Promise<BackupManifest>}
 */
export async function createBackup(dumpPath, databaseUrl) {
  const startedAt = new Date().toISOString();
  const pool = new pg.Pool({ connectionString: requireDatabaseUrl(databaseUrl), max: 1 });
  try {
    const before = await inspectDatabase(pool);
    fs.mkdirSync(path.dirname(dumpPath), { recursive: true });
    const ledgerStagingTable = `__backup_schema_migrations_${crypto.randomBytes(6).toString('hex')}`;
    await stageMigrationLedger(pool, ledgerStagingTable);
    const started = process.hrtime.bigint();
    /** @type {{ code: number, stderr: string }} */
    let result;
    try {
      result = await run(PG_DUMP, [
        '--format=custom',
        '--file',
        dumpPath,
        '--schema',
        STATE_SCHEMA,
        '--no-owner',
        '--no-privileges',
        databaseUrl,
      ]);
    } finally {
      await pool.query(`DROP TABLE ${quoteIdent(STATE_SCHEMA)}.${quoteIdent(ledgerStagingTable)}`);
    }
    const durationMs = Number((process.hrtime.bigint() - started) / 1_000_000n);
    if (result.code !== 0) {
      throw new BackupError(
        BACKUP_ERRORS.COMMAND_FAILED,
        `فشل pg_dump برمز ${result.code}: ${result.stderr.trim()}`,
      );
    }
    const manifest = {
      startedAt,
      durationMs,
      databaseVersion: before.databaseVersion,
      migrationVersion: before.migrationVersion,
      sha256: sha256File(dumpPath),
      rowCounts: before.rowCounts,
      dumpFile: path.basename(dumpPath),
      ledgerStagingTable,
    };
    fs.writeFileSync(manifestPathFor(dumpPath), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    return manifest;
  } finally {
    await pool.end();
  }
}

/**
 * @param {string} dumpPath
 * @returns {BackupManifest}
 */
export function readManifest(dumpPath) {
  const manifestPath = manifestPathFor(dumpPath);
  if (!fs.existsSync(manifestPath)) {
    throw new BackupError(BACKUP_ERRORS.MANIFEST_MISSING, `بيان النسخة غير موجود: ${manifestPath}`);
  }
  try {
    const parsed = /** @type {unknown} */ (JSON.parse(fs.readFileSync(manifestPath, 'utf8')));
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      typeof (/** @type {Record<string, unknown>} */ (parsed)['sha256']) !== 'string' ||
      typeof (/** @type {Record<string, unknown>} */ (parsed)['rowCounts']) !== 'object' ||
      /** @type {Record<string, unknown>} */ (parsed)['rowCounts'] === null ||
      !Number.isInteger(/** @type {Record<string, unknown>} */ (parsed)['durationMs']) ||
      !Number.isInteger(/** @type {Record<string, unknown>} */ (parsed)['migrationVersion']) ||
      !/^__backup_schema_migrations_[0-9a-f]{12}$/.test(
        String(/** @type {Record<string, unknown>} */ (parsed)['ledgerStagingTable']),
      )
    ) {
      throw new Error('البنية ناقصة');
    }
    return /** @type {BackupManifest} */ (parsed);
  } catch (error) {
    if (error instanceof BackupError) throw error;
    throw new BackupError(
      BACKUP_ERRORS.MANIFEST_INVALID,
      `بيان النسخة غير صالح: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * تحقق من البصمة ومن قابلية `pg_restore --list` لقراءة حاوية النسخة.
 * @param {string} dumpPath
 * @returns {Promise<BackupManifest>}
 */
export async function verifyBackup(dumpPath) {
  if (!fs.existsSync(dumpPath)) {
    throw new BackupError(BACKUP_ERRORS.FILE_MISSING, `ملف النسخة غير موجود: ${dumpPath}`);
  }
  const manifest = readManifest(dumpPath);
  const actual = sha256File(dumpPath);
  if (actual !== manifest.sha256) {
    throw new BackupError(
      BACKUP_ERRORS.HASH_MISMATCH,
      `تجزئة النسخة لا تطابق البيان: المتوقعة ${manifest.sha256} والفعلية ${actual}.`,
    );
  }
  const result = await run(PG_RESTORE, ['--list', dumpPath]);
  if (result.code !== 0) {
    throw new BackupError(
      BACKUP_ERRORS.DUMP_UNREADABLE,
      `pg_restore لا يقرأ النسخة برمز ${result.code}: ${result.stderr.trim()}`,
    );
  }
  return manifest;
}

/**
 * @param {string[]} argv
 * @param {string} databaseUrl
 * @returns {Promise<void>}
 */
export async function main(argv, databaseUrl) {
  const { command, dumpPath } = parseArguments(argv);
  if (command === 'verify') {
    const manifest = await verifyBackup(dumpPath);
    console.log(`تحقّق [BACKUP_OK]: ${dumpPath}`);
    console.log(`تجزئة sha256: ${manifest.sha256}`);
    return;
  }
  const manifest = await createBackup(dumpPath, databaseUrl);
  console.log(`نُسخت القاعدة [BACKUP_CREATED]: ${dumpPath}`);
  console.log(`البيان: ${manifestPathFor(dumpPath)}`);
  console.log(`زمن النسخ المقاس: ${manifest.durationMs} مللي ثانية.`);
  console.log(
    `عدد الجداول: ${Object.keys(manifest.rowCounts).length}؛ نسخة الهجرة: ${manifest.migrationVersion}.`,
  );
}

const invokedPath = process.argv[1];
if (invokedPath !== undefined && path.resolve(invokedPath) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2), process.env.DATABASE_URL ?? '').catch(
    (/** @type {unknown} */ error) => {
      const message = error instanceof Error ? error.message : String(error);
      const code =
        typeof error === 'object' && error !== null
          ? /** @type {Record<string, unknown>} */ (error)['code']
          : undefined;
      console.error(`⛔ [${typeof code === 'string' ? code : 'BACKUP_UNEXPECTED'}] ${message}`);
      process.exitCode = 1;
    },
  );
}
