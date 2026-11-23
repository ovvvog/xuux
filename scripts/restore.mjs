#!/usr/bin/env node
/**
 * استعادة نسخة `scripts/backup.mjs` إلى قاعدة نظيفة فقط.
 *
 * العيب الذي يعالجه: تمرير `pg_restore` إلى قاعدة مشغولة قد يخلط حالة قديمة
 * بجديدة ثم يبدو ناجحاً. لذلك تُفحص `state` ودفتر الهجرات أولاً، ولا يُزالان
 * إلا بطلب `--force` صريح.
 *
 * حدٌّ معلن: `--force` يمحو `state` و`public.schema_migrations` فقط، في معاملةٍ واحدة؛ لا يمحو
 * كائنات المخطّطات الأخرى ولا يحوّل هذه الأداة إلى استعادة نقطة-زمن. **والاستعادةُ كلُّها
 * ليست ذرّيّة:** المحوُ يُلتزَمُ قبلَ `pg_restore`، فإن فشلَ هذا أو التحقّقُ بعدَه بقيَ الهدفُ ممحوّاً
 * أو ناقصاً.
 *
 * ‏`WL-597`: **`--force` يرفضُ كلَّ هدفٍ مُسيَّج** (‏`RESTORE_TARGET_FENCED`) قبلَ أيِّ محو، أيّاً
 * كانت حالتُه (‏HALTED وRUNNING وRECOVERY_REQUIRED، ومُهاجَراً بلا إقلاع). نزعُ السياجِ مسارُ
 * الاسترداد/الهجرةِ الموثَّق في `docs/RECOVERY.md`، لا هذه الأداة.
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
const FENCE_SCHEMA = 'fence';
// هجرةُ السياج (`migrations/0024_fence.up.sql`). دفترٌ يقولُ إنّها طُبِّقت وليسَ في الهدفِ مخطّطُ
// `fence` حالٌ لا يُوثَقُ بفحصِها: السياجُ يُنزَعُ موثَّقاً بهجرةِ النزول، وهي تحذفُ صفَّها من الدفتر.
const FENCE_MIGRATION_VERSION = 24;
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
  TARGET_FENCED: 'RESTORE_TARGET_FENCED',
  FENCE_CHECK_FAILED: 'RESTORE_FENCE_CHECK_FAILED',
  WIPE_OUTCOME_UNKNOWN: 'RESTORE_WIPE_OUTCOME_UNKNOWN',
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
 * @param {unknown} error
 * @returns {string}
 */
function describe(error) {
  if (error instanceof Error) {
    const code = /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (error))['code'];
    return typeof code === 'string' ? `${code}: ${error.message}` : error.message;
  }
  return String(error);
}

/**
 * ‏`WL-597`: يقرأُ علاماتِ السياجِ في الهدفِ داخلَ معاملةِ المحو. مخطّطُ `fence` ⇒ مُسيَّج. وقادحُ
 * أحداثٍ `xf_*`، أو دفترٌ يقولُ إنّ هجرةَ السياجِ طُبِّقت، بلا مخطّطِ `fence` ⇒ لا يُوثَقُ بالفحص.
 * وأيُّ خطأٍ في القراءة ⇒ رفضٌ مغلَق. **قراءةٌ وحدَها، فلا تُغلقُ سباقاً:** الإغلاقُ في `claimFenceName`.
 * @param {import('pg').PoolClient} client
 * @returns {Promise<void>}
 */
async function refuseFencedTarget(client) {
  /** @type {{ schema: boolean, triggers: string[], ledgerFence: boolean }} */
  let found;
  try {
    const markers = await client.query(
      `SELECT to_regnamespace($1) IS NOT NULL AS schema,
              ARRAY(SELECT evtname::text FROM pg_catalog.pg_event_trigger
                    WHERE evtname LIKE 'xf\\_%' ORDER BY 1) AS triggers,
              to_regclass($2) IS NOT NULL AS ledger`,
      [FENCE_SCHEMA, `public.${MIGRATION_LEDGER}`],
    );
    const row = /** @type {Record<string, unknown>} */ (markers.rows[0]);
    let ledgerFence = false;
    if (row['ledger'] === true) {
      const applied = await client.query(
        `SELECT EXISTS (SELECT 1 FROM public.${quoteIdent(MIGRATION_LEDGER)} WHERE version >= $1) AS fenced`,
        [FENCE_MIGRATION_VERSION],
      );
      ledgerFence = /** @type {Record<string, unknown>} */ (applied.rows[0])['fenced'] === true;
    }
    found = {
      schema: row['schema'] === true,
      triggers: /** @type {string[]} */ (row['triggers']),
      ledgerFence,
    };
  } catch (error) {
    throw new RestoreError(
      RESTORE_ERRORS.FENCE_CHECK_FAILED,
      `تعذّرَ فحصُ السياجِ في الهدف؛ لا محوَ بلا فحص: ${describe(error)}`,
    );
  }
  if (found.schema) {
    throw new RestoreError(
      RESTORE_ERRORS.TARGET_FENCED,
      'قاعدةُ الهدفِ مُسيَّجة (‏مخطّطُ fence موجود)؛ --force لا يمحو قاعدةً مُسيَّجةً في أيِّ حال. انزعِ السياجَ أوّلاً بمسارِ الاسترداد/الهجرةِ الموثَّق (‏docs/RECOVERY.md)، أو استعِدْ إلى قاعدةٍ نظيفةٍ جديدة.',
    );
  }
  if (found.triggers.length > 0 || found.ledgerFence) {
    throw new RestoreError(
      RESTORE_ERRORS.FENCE_CHECK_FAILED,
      `علاماتُ سياجٍ بلا مخطّطِ fence (${[
        ...found.triggers.map((name) => `قادح ${name}`),
        ...(found.ledgerFence ? [`دفترٌ فيه الهجرة ${FENCE_MIGRATION_VERSION} أو بعدها`] : []),
      ].join('، ')})؛ حالٌ لا يُوثَقُ بفحصِها فلا محو.`,
    );
  }
}

/**
 * ‏`WL-597`: يحجزُ اسمَ `fence` في الهدفِ حتى تُلتزَمَ معاملةُ المحو. كلُّ إنشاءٍ للسياجِ يبدأُ بـ
 * `CREATE SCHEMA fence` (‏هجرةُ 0024، أو `pg_restore` لنسخةٍ مُسيَّجة، أو يدوياً)، أو بإعادةِ تسميةِ
 * مخطّطٍ إليه، وكلاهما صفٌّ في `pg_namespace` بفهرسٍ فريدٍ على الاسم. فإنشاءُ المخطّطِ هنا:
 *   - إن كانَ إنشاءٌ آخرُ **غيرُ مُلتزَمٍ** سبقَه ⇒ ينتظرُه هنا؛ فإن التُزِمَ ⇒ `23505` ⇒ رفض، وإن
 *     تراجعَ ⇒ يمضي.
 *   - وإن سبقَ هو ⇒ ينتظرُ كلُّ إنشاءٍ آخرَ التزامَ هذه المعاملة؛ والمحوُ فيها، فلا محوَ بعدَ سياج.
 * ويُحذَفُ المخطّطُ الفارغُ قبلَ الالتزامِ فلا يبقى منه أثر. **حدّه:** ما بعدَ الالتزامِ (‏أثناءَ
 * `pg_restore`) خارجَه، وsuperuser يعدّلُ الكتالوجَ مباشرةً خارجَه (‏`T-OWN-04`).
 * @param {import('pg').PoolClient} client
 * @returns {Promise<void>}
 */
async function claimFenceName(client) {
  try {
    await client.query(`CREATE SCHEMA ${quoteIdent(FENCE_SCHEMA)}`);
  } catch (error) {
    const code = /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (error))['code'];
    if (code === '23505' || code === '42P06') {
      throw new RestoreError(
        RESTORE_ERRORS.TARGET_FENCED,
        'أُنشئَ مخطّطُ fence في الهدفِ أثناءَ الفحص؛ --force لا يمحو قاعدةً مُسيَّجة.',
      );
    }
    throw new RestoreError(
      RESTORE_ERRORS.FENCE_CHECK_FAILED,
      `تعذّرَ حجزُ اسمِ fence في الهدف؛ لا محوَ بلا حجز: ${describe(error)}`,
    );
  }
}

/**
 * ‏`WL-600`: هل فشلُ `COMMIT` قطعيٌّ (‏الخادمُ رفضَه فتراجعت المعاملة)؟ قطعيٌّ فقط حينَ ردَّ الخادمُ
 * بخطأٍ من درجةِ `ERROR` (‏`pg.DatabaseError`): الجلسةُ باقيةٌ والمعاملةُ مُجهَضة. أمّا انقطاعُ
 * الاتصالِ أو انتهاءُ المهلةِ أو `FATAL`/`PANIC` (‏كإنهاءِ الجلسةِ بعدَ الالتزامِ وقبلَ الردّ) فلا يُعرَفُ
 * معه أَالتزمَ الخادمُ أم لا.
 * @param {unknown} error
 * @returns {boolean}
 */
function isDefiniteCommitFailure(error) {
  return error instanceof pg.DatabaseError && error.severity === 'ERROR';
}

/**
 * ‏`--force`: فحصُ السياجِ وحجزُ اسمِه والمحوُ في معاملةٍ واحدة. **المعاملةُ تحمي المحوَ وحدَه، لا
 * الاستعادة.** رفضٌ أو خطأٌ **قبلَ إرسالِ `COMMIT`** ⇒ لم يُلتزَمْ شيء: `ROLLBACK`، أو يُجهِضُها الخادمُ
 * إن انقطعَ الاتصال، فالهدفُ كما كان. وكذلك خطأٌ من الخادمِ على `COMMIT` نفسِه (‏`isDefiniteCommitFailure`).
 * ‏`WL-600`: **أمّا فشلٌ بعدَ إرسالِ `COMMIT` بلا ردٍّ قطعيٍّ فنتيجتُه مجهولة** — قد يكونُ المحوُ
 * التُزِم — فلا يُفترَضُ التراجع: `RESTORE_WIPE_OUTCOME_UNKNOWN`، ولا `pg_restore`، ولا ادّعاءَ أنّ
 * الهدفَ سليم.
 * @param {import('pg').Pool} pool
 * @returns {Promise<void>}
 */
async function wipeUnfencedTarget(pool) {
  const client = await pool.connect();
  // ‏`WL-600`: انقطاعُ الاتصالِ يصلُ رفضاً للاستعلامِ الجاري، ويُطلِقُ `pg` معه حدثَ `error` على العميلِ
  // المُعار؛ وبلا مستمعٍ تنهارُ العمليّةُ (‏`Unhandled 'error' event`) قبلَ أن يُسمّى الرمز. الخطأُ نفسُه
  // يُعالَجُ من رفضِ الاستعلام.
  const ignoreClientError = () => undefined;
  client.on('error', ignoreClientError);
  /** @type {unknown} */
  let failure;
  let commitSent = false;
  try {
    await client.query('BEGIN');
    await refuseFencedTarget(client);
    await claimFenceName(client);
    // لا يُدخل اسمٌ من المستخدم هنا؛ الأسماءُ ثابتةٌ ومقتبسة.
    await client.query(`DROP SCHEMA IF EXISTS ${quoteIdent(STATE_SCHEMA)} CASCADE`);
    await client.query(`DROP TABLE IF EXISTS public.${quoteIdent(MIGRATION_LEDGER)}`);
    // المخطّطُ المحجوزُ فارغ: `RESTRICT` لا `CASCADE`، فلا يُسقَطُ ما ليسَ له.
    await client.query(`DROP SCHEMA ${quoteIdent(FENCE_SCHEMA)} RESTRICT`);
    commitSent = true;
    await client.query('COMMIT');
  } catch (error) {
    failure = error;
    if (commitSent && !isDefiniteCommitFailure(error)) {
      throw new RestoreError(
        RESTORE_ERRORS.WIPE_OUTCOME_UNKNOWN,
        `نتيجةُ التزامِ المحوِ مجهولة: أُرسِلَ COMMIT ثمّ فشلَ بلا ردٍّ قطعيٍّ من الخادم (${describe(error)})، فقد يكونُ مخطّطُ state ودفترُ public.schema_migrations قد مُحِيا وقد لا يكونان. لم يُشغَّلْ pg_restore. افحصِ الهدفَ يدوياً قبلَ أيِّ إعادةٍ ولا تفترضْ أنّه سليم (‏docs/RECOVERY.md).`,
      );
    }
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    // العميلُ المهدومُ يبقى مستمعُه، فحدثُ `error` المتأخّرُ لا يُسقِطُ العمليّة.
    if (failure === undefined) client.off('error', ignoreClientError);
    client.release(failure === undefined ? undefined : true);
  }
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
  // إصدار الأداة يُفحص قبل اللمس: عميلٌ أقدم من النسخة يترك قاعدةً ناقصة تُظنّ
  // مستعادة، وذلك أسوأ من الفشل المعلن. و«قبل اللمس» حرفيّاً (‏`WL-590`): قبل إنشاء
  // الهدف وقبل محو `--force` — كان الفحصُ بعدهما، فيمحو `--force` مخطّطَ `state`
  // ودفترَ الهجرات ثمّ يرفضُ الأداة، فتضيعُ قاعدةُ الهدف بلا استعادةٍ تحلُّ محلّها.
  const restoreTool = await resolveVerifiedRestoreTool(manifest.databaseVersion);
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
      // ‏`WL-597`: كانَ هنا ثلاثةُ أوامرَ مُلتزَمةٍ منفصلة، آخرُها `DROP SCHEMA fence CASCADE`، وتعليقٌ
      // يقولُ إنّ قادحَ `xf_ddl_drop` يرفضُه على قاعدةٍ مُسيَّجة. المقيسُ (‏حزمةُ قرارِ `--force`):
      // تحتَ RUNNING يرفضُ `xf_ddl_start` (‏`XF201`) أوّلَ أمرٍ (‏`DROP SCHEMA state`) قبلَ أيِّ حذف؛
      // وتحتَ HALTED وRECOVERY_REQUIRED، ومُهاجَراً بلا إقلاع، كانَ المحوُ **يُقبَل**: `CASCADE` يُسقِطُ
      // دوالَّ القوادحِ نفسَها فتزولُ قوادحُ DDL الثلاثة، ويبقى `xf_guard` على الجداولِ المستعادةِ
      // **بلا حراسةِ DDL**. صارَ الرفضُ لكلِّ هدفٍ مُسيَّجٍ قبلَ أيِّ محو.
      await wipeUnfencedTarget(pool);
    }
  } finally {
    await pool.end();
  }

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
