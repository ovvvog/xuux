#!/usr/bin/env node
/**
 * استعادة نسخة `scripts/backup.mjs` إلى قاعدة نظيفة فقط.
 *
 * العيب الذي يعالجه: تمرير `pg_restore` إلى قاعدة مشغولة قد يخلط حالة قديمة
 * بجديدة ثم يبدو ناجحاً. لذلك تُفحص `state` ودفتر الهجرات أولاً، ولا يُزالان
 * إلا بطلب `--force` صريح.
 *
 * حدٌّ معلن: `--force` يمحو `state` و`public.schema_migrations` فقط؛ لا يمحو
 * كائنات المخطّطات الأخرى ولا يحوّل هذه الأداة إلى استعادة نقطة-زمن.
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import pg from 'pg';
import { fileURLToPath } from 'node:url';
import { BACKUP_ERRORS, BackupError, readManifest, verifyBackup } from './backup.mjs';
import { assertClientNotOlder, readToolVersion, resolvePgTool } from './lib/pg-tools.mjs';

const STATE_SCHEMA = 'state';
const MIGRATION_LEDGER = 'schema_migrations';
// لا مسار موقّت نصّاً: راجع WL-022 و`scripts/lib/pg-tools.mjs`.
const pgRestore = () => resolvePgTool('pg_restore');

export const RESTORE_ERRORS = Object.freeze({
  ARGUMENT: 'RESTORE_ARGUMENT',
  DATABASE_URL_MISSING: 'RESTORE_DATABASE_URL_MISSING',
  TARGET_NAME_INVALID: 'RESTORE_TARGET_NAME_INVALID',
  TARGET_NOT_CLEAN: 'RESTORE_TARGET_NOT_CLEAN',
  COMMAND_FAILED: 'RESTORE_COMMAND_FAILED',
  LEDGER_MISSING: 'RESTORE_LEDGER_MISSING',
  ROW_COUNT_MISMATCH: 'RESTORE_ROW_COUNT_MISMATCH',
  MIGRATION_VERSION_MISMATCH: 'RESTORE_MIGRATION_VERSION_MISMATCH',
  TOOL_UNUSABLE: 'RESTORE_TOOL_UNUSABLE',
});

/** خطأ مسمّى يجعل فشل الاستعادة صالحاً للبوابات والأتمتة. */
export class RestoreError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   */
  constructor(code, message) {
    super(message);
    this.name = 'RestoreError';
    /** @type {string} */
    this.code = code;
  }
}

/**
 * @typedef {object} RestoreOptions
 * @property {string} dumpPath
 * @property {string} database
 * @property {boolean} force
 */

/**
 * قاعدة تسمية ضيقة لأن اسم القاعدة معرّف SQL لا يمكن تعليمه كقيمة. بعدها يبقى
 * الاقتباس إلزامياً في موضع CREATE DATABASE وDROP/التحقق.
 * @param {string} identifier
 * @returns {string}
 */
function quoteIdent(identifier) {
  return `"${identifier.replace(/"/g, '""')}"`;
}

/**
 * @param {string[]} argv
 * @returns {RestoreOptions}
 */
function parseArguments(argv) {
  const dump = argv[0];
  const databaseFlag = argv.indexOf('--database');
  const database = databaseFlag === -1 ? undefined : argv[databaseFlag + 1];
  const force = argv.includes('--force');
  const unsupported = argv.filter(
    (value, index) =>
      index > 0 && value !== '--database' && value !== '--force' && index !== databaseFlag + 1,
  );
  if (dump === undefined || database === undefined || unsupported.length > 0) {
    throw new RestoreError(
      RESTORE_ERRORS.ARGUMENT,
      'الاستخدام: restore.mjs <ملف.dump> --database <قاعدة_الهدف> [--force].',
    );
  }
  if (!/^[A-Za-z_][A-Za-z0-9_]{0,62}$/.test(database)) {
    throw new RestoreError(
      RESTORE_ERRORS.TARGET_NAME_INVALID,
      'اسم قاعدة الهدف يجب أن يبدأ بحرف أو شرطة سفلية وأن يحوي حروفاً وأرقاماً وشرطة سفلية فقط.',
    );
  }
  return { dumpPath: path.resolve(dump), database, force };
}

/**
 * @param {string} raw
 * @returns {string}
 */
function requireDatabaseUrl(raw) {
  if (raw.trim() === '') {
    throw new RestoreError(
      RESTORE_ERRORS.DATABASE_URL_MISSING,
      'DATABASE_URL غير معلَنة؛ الاستعادة ترفض اختيار خادم افتراضي.',
    );
  }
  return raw;
}

/**
 * @param {string} databaseUrl
 * @param {string} database
 * @returns {string}
 */
function urlForDatabase(databaseUrl, database) {
  const url = new URL(databaseUrl);
  url.pathname = `/${database}`;
  return url.toString();
}

/**
 * قاعدة `postgres` الإدارية هي وجهة إنشاء قاعدة غير موجودة. حدٌّ معلن: الخادم
 * يجب أن يتيح الاتصال بقاعدة postgres، كما في بيئة المشروع المحلية وCI.
 * @param {string} databaseUrl
 * @returns {string}
 */
function administrationUrl(databaseUrl) {
  return urlForDatabase(databaseUrl, 'postgres');
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
 * @param {string} databaseUrl
 * @param {string} database
 * @returns {Promise<void>}
 */
async function ensureDatabase(databaseUrl, database) {
  const admin = new pg.Pool({ connectionString: administrationUrl(databaseUrl), max: 1 });
  try {
    const exists = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [database]);
    if (exists.rowCount === 0) {
      await admin.query(`CREATE DATABASE ${quoteIdent(database)}`);
    }
  } finally {
    await admin.end();
  }
}

/**
 * @param {import('pg').Pool} pool
 * @returns {Promise<{ hasState: boolean, hasLedger: boolean }>}
 */
async function targetContents(pool) {
  const [schemaResult, ledgerResult] = await Promise.all([
    pool.query('SELECT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = $1) AS present', [
      STATE_SCHEMA,
    ]),
    pool.query('SELECT to_regclass($1) IS NOT NULL AS present', [`public.${MIGRATION_LEDGER}`]),
  ]);
  const schemaRow = /** @type {Record<string, unknown> | undefined} */ (schemaResult.rows[0]);
  const ledgerRow = /** @type {Record<string, unknown> | undefined} */ (ledgerResult.rows[0]);
  return {
    hasState: schemaRow?.['present'] === true,
    hasLedger: ledgerRow?.['present'] === true,
  };
}

/**
 * @param {import('pg').Pool} pool
 * @returns {Promise<Record<string, number>>}
 */
async function readRowCounts(pool) {
  const namesResult = await pool.query(
    `SELECT c.relname
     FROM pg_class AS c
     JOIN pg_namespace AS n ON n.oid = c.relnamespace
     WHERE n.nspname = $1 AND c.relkind = 'r'
     ORDER BY c.relname`,
    [STATE_SCHEMA],
  );
  /** @type {Record<string, number>} */
  const counts = {};
  for (const row of namesResult.rows) {
    const name = String(/** @type {Record<string, unknown>} */ (row)['relname']);
    const result = await pool.query(
      `SELECT count(*)::bigint AS count FROM ${quoteIdent(STATE_SCHEMA)}.${quoteIdent(name)}`,
    );
    const countRow = /** @type {Record<string, unknown> | undefined} */ (result.rows[0]);
    counts[name] = Number(countRow?.['count']);
  }
  return counts;
}

/**
 * @param {import('pg').Pool} pool
 * @returns {Promise<number>}
 */
async function migrationVersion(pool) {
  const result = await pool.query(
    `SELECT COALESCE(max(version), 0)::integer AS version
     FROM public.${quoteIdent(MIGRATION_LEDGER)}`,
  );
  const row = /** @type {Record<string, unknown> | undefined} */ (result.rows[0]);
  return Number(row?.['version']);
}

/**
 * ينقل الجدول المرحلي الذي حمله أرشيف مخطّط `state` إلى موضع دفتر الهجرات.
 * الأسماء في البيان مولّدة داخل أداة النسخ ومقيدة عند قراءته، ثم تُقتبس هنا.
 * @param {import('pg').Pool} pool
 * @param {string} table
 * @returns {Promise<void>}
 */
async function moveMigrationLedger(pool, table) {
  const found = await pool.query('SELECT to_regclass($1) IS NOT NULL AS present', [
    `${STATE_SCHEMA}.${table}`,
  ]);
  const row = /** @type {Record<string, unknown> | undefined} */ (found.rows[0]);
  if (row?.['present'] !== true) {
    throw new RestoreError(
      RESTORE_ERRORS.LEDGER_MISSING,
      `لا يحتوي الأرشيف على جدول دفتر الهجرات المرحلي ${table}.`,
    );
  }
  await pool.query(
    `ALTER TABLE ${quoteIdent(STATE_SCHEMA)}.${quoteIdent(table)} SET SCHEMA public`,
  );
  await pool.query(
    `ALTER TABLE public.${quoteIdent(table)} RENAME TO ${quoteIdent(MIGRATION_LEDGER)}`,
  );
}

/**
 * @param {Record<string, number>} expected
 * @param {Record<string, number>} actual
 * @returns {boolean}
 */
function sameCounts(expected, actual) {
  const expectedNames = Object.keys(expected).sort();
  const actualNames = Object.keys(actual).sort();
  return (
    expectedNames.length === actualNames.length &&
    expectedNames.every(
      (name, index) => name === actualNames[index] && expected[name] === actual[name],
    )
  );
}

/**
 * يختار `pg_restore` ويرفض ما إصداره أقدم من الخادم الذي أنشأ النسخة.
 * @param {string} dumpServerVersion إصدار الخادم المسجّل في بيان النسخة.
 * @returns {Promise<string>}
 */
export async function resolveVerifiedRestoreTool(dumpServerVersion) {
  try {
    const toolPath = pgRestore();
    const clientVersion = await readToolVersion(toolPath);
    assertClientNotOlder({ toolPath, clientVersion, serverVersion: dumpServerVersion });
    return toolPath;
  } catch (error) {
    throw new RestoreError(
      RESTORE_ERRORS.TOOL_UNUSABLE,
      error instanceof Error ? error.message : String(error),
    );
  }
}

/**
 * @param {RestoreOptions} options
 * @param {string} databaseUrl
 * @returns {Promise<{ durationMs: number, created: boolean }>}
 */
export async function restoreBackup(options, databaseUrl) {
  const url = requireDatabaseUrl(databaseUrl);
  if (!fs.existsSync(options.dumpPath)) {
    throw new BackupError(BACKUP_ERRORS.FILE_MISSING, `ملف النسخة غير موجود: ${options.dumpPath}`);
  }
  const manifest = await verifyBackup(options.dumpPath);
  const admin = new pg.Pool({ connectionString: administrationUrl(url), max: 1 });
  let created = false;
  try {
    const exists = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [
      options.database,
    ]);
    if (exists.rowCount === 0) created = true;
  } finally {
    await admin.end();
  }
  await ensureDatabase(url, options.database);

  const targetUrl = urlForDatabase(url, options.database);
  const pool = new pg.Pool({ connectionString: targetUrl, max: 1 });
  try {
    const contents = await targetContents(pool);
    if ((contents.hasState || contents.hasLedger) && !options.force) {
      throw new RestoreError(
        RESTORE_ERRORS.TARGET_NOT_CLEAN,
        'قاعدة الهدف ليست نظيفة: وُجد مخطّط state أو دفتر public.schema_migrations؛ أعد الطلب مع --force صراحةً.',
      );
    }
    if (options.force) {
      // لا يُدخل اسمٌ من المستخدم هنا؛ الاسمان ثابتان ومقتبسان لإبقاء الحرس واضحاً.
      await pool.query(`DROP SCHEMA IF EXISTS ${quoteIdent(STATE_SCHEMA)} CASCADE`);
      await pool.query(`DROP TABLE IF EXISTS public.${quoteIdent(MIGRATION_LEDGER)}`);
    }
  } finally {
    await pool.end();
  }

  // إصدار الأداة يُفحص قبل اللمس: عميلٌ أقدم من النسخة يترك قاعدةً ناقصة تُظنّ
  // مستعادة، وذلك أسوأ من الفشل المعلن.
  const restoreTool = await resolveVerifiedRestoreTool(manifest.databaseVersion);
  const started = process.hrtime.bigint();
  const result = await run(restoreTool, [
    '--exit-on-error',
    '--no-owner',
    '--no-privileges',
    '--dbname',
    targetUrl,
    options.dumpPath,
  ]);
  const durationMs = Number((process.hrtime.bigint() - started) / 1_000_000n);
  if (result.code !== 0) {
    throw new RestoreError(
      RESTORE_ERRORS.COMMAND_FAILED,
      `فشل pg_restore برمز ${result.code}: ${result.stderr.trim()}`,
    );
  }

  const verifier = new pg.Pool({ connectionString: targetUrl, max: 1 });
  try {
    await moveMigrationLedger(verifier, manifest.ledgerStagingTable);
    const actualCounts = await readRowCounts(verifier);
    if (!sameCounts(manifest.rowCounts, actualCounts)) {
      throw new RestoreError(
        RESTORE_ERRORS.ROW_COUNT_MISMATCH,
        `عدد الصفوف بعد الاستعادة لا يطابق البيان: المتوقع ${JSON.stringify(manifest.rowCounts)} والفِعلي ${JSON.stringify(actualCounts)}.`,
      );
    }
    const actualVersion = await migrationVersion(verifier);
    if (actualVersion !== manifest.migrationVersion) {
      throw new RestoreError(
        RESTORE_ERRORS.MIGRATION_VERSION_MISMATCH,
        `نسخة الهجرة بعد الاستعادة ${actualVersion} لا تطابق البيان ${manifest.migrationVersion}.`,
      );
    }
  } finally {
    await verifier.end();
  }
  return { durationMs, created };
}

/**
 * @param {string[]} argv
 * @param {string} databaseUrl
 * @returns {Promise<void>}
 */
export async function main(argv, databaseUrl) {
  const options = parseArguments(argv);
  const outcome = await restoreBackup(options, databaseUrl);
  const manifest = readManifest(options.dumpPath);
  console.log(
    `استُعيدت النسخة [RESTORE_OK] إلى قاعدة ${options.database}${outcome.created ? ' (أُنشئت)' : ''}.`,
  );
  console.log(`زمن الاستعادة المقاس: ${outcome.durationMs} مللي ثانية.`);
  console.log(
    `قايس البيان ${Object.keys(manifest.rowCounts).length} جدولاً ونسخة الهجرة ${manifest.migrationVersion}.`,
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
      console.error(`⛔ [${typeof code === 'string' ? code : 'RESTORE_UNEXPECTED'}] ${message}`);
      process.exitCode = 1;
    },
  );
}
