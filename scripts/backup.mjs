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
import { assertClientNotOlder, readToolVersion, resolvePgTool } from './lib/pg-tools.mjs';

const STATE_SCHEMA = 'state';
const MIGRATION_LEDGER = 'schema_migrations';
/**
 * الجدولُ المرحليُّ الذي يحملُ دفترَ الهجراتِ داخلَ الأرشيفِ — يُستثنى من عدّاداتِ
 * البيانِ: هو عضوُ الأرشيفِ لا عضوَ الحالةِ، يُنقلُ عندَ الاستعادةِ إلى
 * `public.schema_migrations` فلا يكونُ للمستعادِ حقيقةً قابلةً للعدِّ. ولولا
 * الاستثناءُ لَفشلَ تحقّقُ الاستعادةِ (عدّاداتُ بيانٍ لا يُجدِّدُها المستعادُ).
 */
const BACKUP_STAGING_TABLE = /^__backup_schema_migrations_[0-9a-f]{12}$/;
// المسار لا يُثبَّت نصّاً: عميلٌ أقدم من الخادم يرفض القراءة، وقد أسقط ذلك بوابة
// الفحص كلها في WL-022. فالأداة تُختار من أعلى إصدار مثبَّت فعلاً.
const pgDump = () => resolvePgTool('pg_dump');
const pgRestore = () => resolvePgTool('pg_restore');

export const BACKUP_ERRORS = Object.freeze({
  ARGUMENT: 'BACKUP_ARGUMENT',
  DATABASE_URL_MISSING: 'BACKUP_DATABASE_URL_MISSING',
  FILE_MISSING: 'BACKUP_FILE_MISSING',
  MANIFEST_MISSING: 'BACKUP_MANIFEST_MISSING',
  MANIFEST_INVALID: 'BACKUP_MANIFEST_INVALID',
  HASH_MISMATCH: 'BACKUP_HASH_MISMATCH',
  DUMP_UNREADABLE: 'BACKUP_DUMP_UNREADABLE',
  COMMAND_FAILED: 'BACKUP_COMMAND_FAILED',
  TOOL_UNUSABLE: 'BACKUP_TOOL_UNUSABLE',
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
 * @param {import('pg').Pool | import('pg').PoolClient} pool
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
 * @param {import('pg').Pool | import('pg').PoolClient} pool
 * @returns {Promise<Record<string, number>>}
 */
async function readRowCounts(pool) {
  const names = (await stateTables(pool)).filter((name) => !BACKUP_STAGING_TABLE.test(name));
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
 * @param {import('pg').Pool | import('pg').PoolClient} pool
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
 *
 * **ذرّيٌّ (‏`WL-592`):** الإنشاءُ والنسخُ في معاملةٍ واحدة. كانا عبارتَين مستقلّتَين خارجَ
 * نطاقِ التنظيف، ففشلُ `INSERT` (‏مثلاً دفترٌ غائب) بعدَ نجاحِ `CREATE` يُبقي جدولاً مرحليّاً
 * في `state` ينتقلُ إلى كلِّ نسخةٍ لاحقة. فإمّا الجدولُ كاملاً وإمّا لا جدول.
 * @param {import('pg').PoolClient} client
 * @param {string} table
 * @returns {Promise<void>}
 */
async function stageMigrationLedger(client, table) {
  await client.query('BEGIN');
  try {
    await client.query(`
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
    await client.query(
      `INSERT INTO ${quoteIdent(STATE_SCHEMA)}.${quoteIdent(table)}
         (version, name, checksum, applied_at, applied_by)
       SELECT version, name, checksum, applied_at, applied_by
       FROM public.${quoteIdent(MIGRATION_LEDGER)}`,
    );
    await client.query('COMMIT');
  } catch (error) {
    // فشلُ الإلغاءِ نفسِه يُبقي الأصليَّ هو المرميّ؛ والمعاملةُ غيرُ المُلتزَمةِ لا تُبقي جدولاً.
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  }
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
 * يختار الأداة ويتحقّق أنّ إصدارها لا يقلّ عن إصدار الخادم **قبل** التنفيذ.
 *
 * الفحص قبليّ لا بعديّ لأن الفشل بعد التنفيذ يترك ملفاً ناقصاً يُظنّ نسخة،
 * ولأن رمز الخروج 1 من أداة خارجيّة لا يقول للقارئ إنّ السبب فرقُ إصدار.
 * @param {string} serverVersion إصدار الخادم كما أجاب به.
 * @returns {Promise<string>} مسار `pg_dump` القابل للاستخدام.
 */
export async function resolveVerifiedDumpTool(serverVersion) {
  try {
    const toolPath = pgDump();
    const clientVersion = await readToolVersion(toolPath);
    assertClientNotOlder({ toolPath, clientVersion, serverVersion });
    return toolPath;
  } catch (error) {
    throw new BackupError(
      BACKUP_ERRORS.TOOL_UNUSABLE,
      error instanceof Error ? error.message : String(error),
    );
  }
}

/**
 * أنشئ نسخة بصيغة PostgreSQL المخصّصة وبيانها المجاور.
 *
 * **البيانُ والنسخةُ لقطةٌ واحدةٌ (`WL-398`):** عدّاداتُ البيانِ تُقرأُ من معاملةٍ
 * واحدةٍ بمستوى عزلٍ `REPEATABLE READ` تُصدِّرُ لقطتَها بـ`pg_export_snapshot()`،
 * ثمّ يستعملُ `pg_dump` اللقطةَ نفسَها بـ`--snapshot`. فلولا هذا الربطُ كانت
 * أرقامُ البيانِ تُقرأُ قبلَ انطلاقِ النسخِ — فكتابةٌ متزامنةٌ بينَهما تُنتِجُ بيانًا
 * لا يطابقُ محتوى الملفِّ، وتُسقِطُ استعادةَ نسخةٍ سليمةٍ عندَ تحقُّقِ العدّاداتِ
 * (`RESTORE_ROW_COUNT_MISMATCH`) — عطلٌ في لحظةِ التعافي هي أسوأُ لحظةٍ لعطلٍ.
 * والقراءةُ داخلَ المعاملةِ مقصودةٌ: في `READ COMMITTED` تأخذُ كلُّ عبارةٍ
 * لقطةً جديدةً فيعودَ الانفصالُ من الشباكِ الآخرِ.
 * @param {string} dumpPath
 * @param {string} databaseUrl
 * @returns {Promise<BackupManifest>}
 */
export async function createBackup(dumpPath, databaseUrl) {
  const startedAt = new Date().toISOString();
  const pool = new pg.Pool({ connectionString: requireDatabaseUrl(databaseUrl), max: 1 });
  try {
    fs.mkdirSync(path.dirname(dumpPath), { recursive: true });
    // ‏`WL-592`: الفحصُ قبلَ المسّ — تُرفضُ الأداةُ القاصرةُ قبلَ إنشاءِ الجدولِ المرحليِّ
    // في `state`، فلا يمسُّ الرفضُ القاعدةَ المصدرَ أصلاً (كما فعلَ `WL-590` في الاستعادة).
    const serverVersion = await pool.query('SHOW server_version');
    const dumpTool = await resolveVerifiedDumpTool(
      String(
        /** @type {Record<string, unknown> | undefined} */ (serverVersion.rows[0])?.[
          'server_version'
        ],
      ),
    );
    const ledgerStagingTable = `__backup_schema_migrations_${crypto.randomBytes(6).toString('hex')}`;
    /** @type {bigint} */
    let started = 0n;
    /** @type {{ code: number, stderr: string }} */
    let result;
    /** @type {{ databaseVersion: string, migrationVersion: number, rowCounts: Record<string, number> }} */
    let snapshot;
    /** @type {{ error: unknown } | undefined} */
    let primaryFailure;
    /** @type {unknown} */
    let cleanupFailure;
    // ‏`WL-592`: الاتصالُ قبلَ الإنشاء، والإنشاءُ داخلَ نطاقِ التنظيف — كانَ الإنشاءُ قبلَ
    // ‏`pool.connect()` وخارجَ `try`، ففشلُ الاتصالِ أو النسخِ بعدَه يُبقي الجدولَ بلا حذف.
    // ‏`staged` يمنعُ `DROP` جدولٍ لم يُلتزَم إنشاؤه (‏خطأٌ زائفٌ يُلحَقُ بالأصليّ).
    let staged = false;
    const client = await pool.connect();
    // ‏`WL-592`: انقطاعُ الاتصالِ أثناءَ النسخ (‏إعادةُ تشغيلِ الخادم، `pg_terminate_backend`،
    // ‏`idle_in_transaction_session_timeout` والاتصالُ ساكنٌ في معاملتِه طوالَ `pg_dump`) يُطلِقُ
    // حدثَ `error` على العميلِ المُستعار — و`pg-pool` لا يستمعُ إليه إلا والعميلُ ساكنٌ في المجمَّع.
    // فبلا مستمعٍ تنهارُ العمليّةُ بحدثٍ غيرِ مُلتقَط قبلَ `finally`: يبقى الجدولُ المرحليُّ في
    // ‏`state` ويضيعُ الخطأُ الأصليّ. المستمعُ لا يبتلعُ شيئاً: العبارةُ التاليةُ على العميلِ تفشلُ
    // بخطئِها فيُتلَفُ العميلُ (‏`release(error)`) ويجري الحذفُ على اتصالٍ جديد.
    const onClientError = () => undefined;
    client.on('error', onClientError);
    try {
      await stageMigrationLedger(client, ledgerStagingTable);
      staged = true;
      started = process.hrtime.bigint();
      await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ');
      const exported = await client.query('SELECT pg_export_snapshot() AS snapshot');
      const snapshotId = String(
        /** @type {Record<string, unknown> | undefined} */ (exported.rows[0])?.['snapshot'],
      );
      snapshot = await inspectDatabase(client);
      // `WL-532`: إن كانت القاعدةُ مُسيَّجةً نُسخَ مخطّطُ `fence` معها؛ وإلا حملت النسخةُ
      // قوادحَ `xf_guard` وسياساتِ `xf_read` بلا دوالِّها فتفشلُ الاستعادة. والمستعادُ
      // يبدأ مغلقاً: صفُّ التحكّمِ مربوطٌ بهويّةِ العنقودِ الأصليّ (`sysid`/`dbname`/
      // زمنِ الإقلاع) فيُقرأُ `RECOVERY_REQUIRED`، وقوادحُ الأحداثِ (على مستوى القاعدة)
      // لا تُنسخ فيرفضُ `check_fenced()` الاستئنافَ حتى يُعيدَ المالكُ تركيبَ السياج.
      const fenced = await client.query(
        "SELECT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'fence') AS present",
      );
      const fenceSchemaArgs =
        /** @type {Record<string, unknown> | undefined} */ (fenced.rows[0])?.['present'] === true
          ? ['--schema', 'fence']
          : [];
      result = await run(dumpTool, [
        '--format=custom',
        '--file',
        dumpPath,
        '--schema',
        STATE_SCHEMA,
        ...fenceSchemaArgs,
        '--no-owner',
        '--no-privileges',
        '--snapshot',
        snapshotId,
        databaseUrl,
      ]);
      if (result.code !== 0) {
        throw new BackupError(
          BACKUP_ERRORS.COMMAND_FAILED,
          `فشل pg_dump برمز ${result.code}: ${result.stderr.trim()}`,
        );
      }
    } catch (error) {
      primaryFailure = { error };
      throw error;
    } finally {
      // معاملةُ قراءةٍ لا كتابةَ فيها: تُلغى بلا أثرٍ — واللقطاتُ المُصدَّرةُ تموتُ
      // بنهايةِ معاملتِها، فلا يبقى للنسخةِ أثرٌ حيٌّ في القاعدةِ بعدَ انتهائها.
      // الإلغاءُ في `finally` لا في مسارِ النجاحِ وحدَه (‏`WL-591`): رفضُ `pg_dump` الأقدمِ
      // كانَ يُعيدُ العميلَ إلى المجمَّعِ ومعاملتُه مفتوحة، فيجري `DROP` الجدولِ المرحليِّ
      // داخلَها ويُلغى بإغلاقِ الاتصال — فيبقى `__backup_schema_migrations_*` في `state`.
      // وإن فشلَ الإلغاءُ نفسُه أُتلِفَ العميلُ كي لا يُعادَ استعمالُه للحذف.
      /** @type {Error | undefined} */
      let rollbackFailure;
      try {
        await client.query('ROLLBACK');
      } catch (error) {
        rollbackFailure = error instanceof Error ? error : new Error(String(error));
      }
      client.removeListener('error', onClientError);
      client.release(rollbackFailure);
      // ‏`WL-592`: فشلُ الحذفِ لا يحجبُ الخطأَ الأصليّ — كانَ رميُه من `finally` يُبدِّلُ
      // ‏`BACKUP_COMMAND_FAILED` بخطأِ `DROP` خامٍ فيضيعُ سببُ الفشل. يبقى الأصليُّ هو المرميّ
      // ويُلحَقُ به اسمُ الجدولِ الباقي كي يُزالَ يدوياً؛ وبلا خطأٍ أصليٍّ يُرمى خطأُ الحذفِ مُسمّياً الجدول.
      if (staged) {
        try {
          await pool.query(
            `DROP TABLE ${quoteIdent(STATE_SCHEMA)}.${quoteIdent(ledgerStagingTable)}`,
          );
        } catch (dropFailure) {
          // الاسمُ الباقي مُسمّىً في المسارَين (‏ملاحظةُ المراجعةِ N2): من دونه لا يعرفُ المشغِّلُ
          // أيَّ جدولٍ يُزيل. والأصليُّ — ‏`Error` أو غيرُه (‏N1) — يبقى هو المرميّ.
          const leftover = `تعذّرَ حذفُ الجدولِ المرحليِّ ${STATE_SCHEMA}.${ledgerStagingTable}: ${
            dropFailure instanceof Error ? dropFailure.message : String(dropFailure)
          }`;
          if (primaryFailure === undefined) {
            if (dropFailure instanceof Error) dropFailure.message = leftover;
            cleanupFailure = dropFailure;
          } else if (primaryFailure.error instanceof Error) {
            primaryFailure.error.message += `؛ و${leftover}`;
          } else {
            // مرميٌّ ليسَ `Error` لا يحملُ رسالةً تُلحَق؛ فيُكتَبُ الاسمُ إلى stderr كي لا يضيع.
            console.error(`⛔ [BACKUP_STAGING_LEFTOVER] ${leftover}`);
          }
        }
      }
    }
    // لا يُبلَغُ هذا إلا والمسارُ ناجح؛ فخطأُ الحذفِ هنا هو الخطأُ الوحيد.
    if (cleanupFailure !== undefined) throw cleanupFailure;
    const durationMs = Number((process.hrtime.bigint() - started) / 1_000_000n);
    const manifest = {
      startedAt,
      durationMs,
      databaseVersion: snapshot.databaseVersion,
      migrationVersion: snapshot.migrationVersion,
      sha256: sha256File(dumpPath),
      rowCounts: snapshot.rowCounts,
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
  const result = await run(pgRestore(), ['--list', dumpPath]);
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
