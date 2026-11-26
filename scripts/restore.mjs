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
import {
  BACKUP_ERRORS,
  BackupError,
  computeContentDigest,
  contentDigestDifferences,
  snapshotVerifiedArchive,
} from './backup.mjs';
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
  LEDGER_OUTCOME_UNKNOWN: 'RESTORE_LEDGER_OUTCOME_UNKNOWN',
  DIGEST_MISSING: 'RESTORE_DIGEST_MISSING',
  CONTENT_MISMATCH: 'RESTORE_CONTENT_MISMATCH',
  CONTENT_CHECK_FAILED: 'RESTORE_CONTENT_CHECK_FAILED',
});

/**
 * نتيجةُ التحقّقِ من المحتوى (‏`WL-606`). `VERIFIED`: بصمةُ المستعادِ طابقت بصمةَ لقطةِ النسخِ ضمنَ
 * نطاقِها المعلَن. `NO_DIGEST`: نسخةٌ قديمةٌ بلا بصمة، استُعيدت بـ`--allow-unverified` الصريح — **لا
 * دليلَ محتوى**، والمطبوعُ `[RESTORE_UNVERIFIED]` لا `[RESTORE_OK]`. والفشلُ ليسَ حالةً هنا بل خطأٌ مسمّى.
 */
export const CONTENT_VERIFICATION = Object.freeze({
  VERIFIED: 'VERIFIED',
  NO_DIGEST: 'NO_DIGEST',
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
 * @property {boolean} [allowUnverified] يقبلُ نسخةً بلا بصمةِ محتوى؛ النتيجةُ `NO_DIGEST` لا `VERIFIED`.
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
  const allowUnverified = argv.includes('--allow-unverified');
  const unsupported = argv.filter(
    (value, index) =>
      index > 0 &&
      value !== '--database' &&
      value !== '--force' &&
      value !== '--allow-unverified' &&
      index !== databaseFlag + 1,
  );
  if (dump === undefined || database === undefined || unsupported.length > 0) {
    throw new RestoreError(
      RESTORE_ERRORS.ARGUMENT,
      'الاستخدام: restore.mjs <ملف.dump> --database <قاعدة_الهدف> [--force] [--allow-unverified].',
    );
  }
  if (!/^[A-Za-z_][A-Za-z0-9_]{0,62}$/.test(database)) {
    throw new RestoreError(
      RESTORE_ERRORS.TARGET_NAME_INVALID,
      'اسم قاعدة الهدف يجب أن يبدأ بحرف أو شرطة سفلية وأن يحوي حروفاً وأرقاماً وشرطة سفلية فقط.',
    );
  }
  return { dumpPath: path.resolve(dump), database, force, allowUnverified };
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
 * @param {string} stagingTable الدفترُ المرحليُّ — في `state` حتّى يُركَّب، ولا يُعَدُّ جدولَ حالة.
 * @returns {Promise<Record<string, number>>}
 */
async function readRowCounts(pool, stagingTable) {
  const namesResult = await pool.query(
    `SELECT c.relname
     FROM pg_class AS c
     JOIN pg_namespace AS n ON n.oid = c.relnamespace
     WHERE n.nspname = $1 AND c.relkind = 'r' AND c.relname <> $2
     ORDER BY c.relname`,
    [STATE_SCHEMA, stagingTable],
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
 * ‏`WL-614`: تُقرأُ من الدفترِ المرحليِّ قبلَ تركيبِه، فيُحسَمُ التحقّقُ قبلَ أن يصيرَ الهدفُ قاعدةً مُهاجَرة.
 * @param {import('pg').Pool} pool
 * @param {string} stagingTable
 * @returns {Promise<number>}
 */
async function migrationVersion(pool, stagingTable) {
  const result = await pool.query(
    `SELECT COALESCE(max(version), 0)::integer AS version
     FROM ${quoteIdent(STATE_SCHEMA)}.${quoteIdent(stagingTable)}`,
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
  // ‏`WL-614`: النقلُ وإعادةُ التسميةِ معاملةٌ واحدة — كانا أمرَين مُلتزَمَين، فانقطاعٌ بينَهما يتركُ
  // ‏`public.__backup_schema_migrations_*` بلا `schema_migrations`.
  const client = await pool.connect();
  // ‏`WL-615`: كما في `wipeUnfencedTarget` — انقطاعُ الاتصالِ يُطلِقُ حدثَ `error` على العميلِ المُعار،
  // وبلا مستمعٍ تنهارُ العمليّةُ قبلَ أن يُسمّى الرمز. الخطأُ نفسُه يُعالَجُ من رفضِ الاستعلام.
  const ignoreClientError = () => undefined;
  client.on('error', ignoreClientError);
  let broken = false;
  let commitSent = false;
  try {
    await client.query('BEGIN');
    await client.query(
      `ALTER TABLE ${quoteIdent(STATE_SCHEMA)}.${quoteIdent(table)} SET SCHEMA public`,
    );
    await client.query(
      `ALTER TABLE public.${quoteIdent(table)} RENAME TO ${quoteIdent(MIGRATION_LEDGER)}`,
    );
    commitSent = true;
    await client.query('COMMIT');
  } catch (error) {
    broken = true;
    // ‏`WL-615` (‏`LIVE-78/LEDGER-COMMIT-UNKNOWN`): فشلٌ بعدَ إرسالِ `COMMIT` بلا ردٍّ قطعيٍّ من الخادمِ
    // لا يُعرَفُ معه أَرُكِّبَ الدفترُ أم بقيَ مرحليّاً — فلا يُبلَغُ خطأً خامّاً يُقرأُ فشلاً مؤكّداً، ولا
    // `[RESTORE_OK]`. خطأُ `ERROR` من الخادمِ على `COMMIT` قطعيّ (‏`isDefiniteCommitFailure`) فيبقى كما هو.
    if (commitSent && !isDefiniteCommitFailure(error)) {
      throw new RestoreError(
        RESTORE_ERRORS.LEDGER_OUTCOME_UNKNOWN,
        `نتيجةُ التزامِ تركيبِ دفترِ الهجراتِ مجهولة: أُرسِلَ COMMIT ثمّ فشلَ بلا ردٍّ قطعيٍّ من الخادم (${describe(error)}). اجتازت فحوصُ ما قبلَ التركيبِ كلُّها، لكن قد يكونُ public.${MIGRATION_LEDGER} قد رُكِّبَ وقد يكونُ ${table} باقياً مرحليّاً في state. لا [RESTORE_OK]. افحصِ الهدفَ يدوياً ولا تفترضْ نجاحاً ولا فشلاً؛ والدفترُ إن بقيَ مرحليّاً فأعِدِ الاستعادةَ بـ--force (‏docs/RECOVERY.md).`,
      );
    }
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    // العميلُ المهدومُ يبقى مستمعُه، فحدثُ `error` المتأخّرُ لا يُسقِطُ العمليّة.
    if (!broken) client.off('error', ignoreClientError);
    client.release(broken);
  }
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
 * @typedef {object} RestoreOutcome
 * @property {number} durationMs
 * @property {boolean} created
 * @property {'VERIFIED' | 'NO_DIGEST'} contentVerification
 * @property {number} contentVerifyMs
 * @property {import('./backup.mjs').BackupManifest} manifest البيانُ الذي تحقّقت الاستعادةُ منه (‏`WL-614`).
 */

/**
 * @param {RestoreOptions} options
 * @param {string} databaseUrl
 * @returns {Promise<RestoreOutcome>}
 */
export async function restoreBackup(options, databaseUrl) {
  const url = requireDatabaseUrl(databaseUrl);
  if (!fs.existsSync(options.dumpPath)) {
    throw new BackupError(BACKUP_ERRORS.FILE_MISSING, `ملف النسخة غير موجود: ${options.dumpPath}`);
  }
  // ‏`WL-614` (‏`LIVE-78/ARCHIVE-TOCTOU`): يُقرأُ الأرشيفُ **مرّةً واحدة** إلى نسخةٍ خاصّةٍ يُحسَبُ sha256 على
  // بايتاتِها، و`pg_restore` يقرأُ تلك النسخةَ لا `dumpPath`. كانَ التحقّقُ على المسارِ ثمّ يُعيدُ
  // `pg_restore` قراءتَه بعدَ نافذة، فأرشيفٌ يُستبدَلُ فيها يُستعادُ ببيانٍ شرعيٍّ ويُعلَنُ `[RESTORE_OK]`.
  const verified = await snapshotVerifiedArchive(options.dumpPath);
  try {
    return await restoreVerifiedArchive(options, url, verified);
  } finally {
    verified.cleanup();
  }
}

/**
 * @param {RestoreOptions} options
 * @param {string} url
 * @param {import('./backup.mjs').VerifiedArchive} verified
 * @returns {Promise<RestoreOutcome>}
 */
async function restoreVerifiedArchive(options, url, verified) {
  const { manifest, archivePath } = verified;
  // ‏`WL-606`: بصمةٌ تالفةٌ أو غيرُ مدعومةٍ رُفضت في `snapshotVerifiedArchive` أعلاه، وغيابُها يُرفَضُ هنا — كلاهما
  // قبلَ لمسِ الهدف. الاستعادةُ بلا دليلِ محتوى قرارٌ صريحٌ للمشغّل لا افتراض.
  if (manifest.contentDigest === undefined && options.allowUnverified !== true) {
    throw new RestoreError(
      RESTORE_ERRORS.DIGEST_MISSING,
      'النسخةُ بلا بصمةِ محتوى (‏أُخذت قبلَ WL-606)؛ لا يمكنُ إثباتُ أنّ المستعادَ يطابقُها. الهدفُ لم يُلمَس. لاستعادتِها بلا تحقّقِ محتوى صرّحْ بـ--allow-unverified، والنتيجةُ تُعلَنُ [RESTORE_UNVERIFIED] لا [RESTORE_OK].',
    );
  }
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
    archivePath,
  ]);
  const durationMs = Number((process.hrtime.bigint() - started) / 1_000_000n);
  if (result.code !== 0) {
    throw new RestoreError(
      RESTORE_ERRORS.COMMAND_FAILED,
      `فشل pg_restore برمز ${result.code}: ${result.stderr.trim()}`,
    );
  }

  const verifier = new pg.Pool({ connectionString: targetUrl, max: 1 });
  // انقطاعُ الاتصالِ أثناءَ التحقّق يُطلِقُ `error` على المجمّع؛ بلا مستمعٍ يُسقِطُ العمليّة. الخطأُ
  // نفسُه يصلُ إلى الاستعلامِ المعلَّق فيُسمّى هناك.
  verifier.on('error', () => undefined);
  /** @type {'VERIFIED' | 'NO_DIGEST'} */
  let contentVerification = CONTENT_VERIFICATION.NO_DIGEST;
  let contentVerifyMs = 0;
  try {
    if (manifest.contentDigest !== undefined) {
      // ‏`WL-606`: المقارنةُ **قبلَ تركيبِ الدفتر**. فشلُها يتركُ الدفترَ جدولاً مرحليّاً في `state` ولا
      // ‏`public.schema_migrations` — فلا يُقرأُ الهدفُ قاعدةً مُهاجَرةً سليمة (‏`migrate` يرى دفتراً غائباً).
      const table = `${STATE_SCHEMA}.${manifest.ledgerStagingTable}`;
      const found = await verifier.query('SELECT to_regclass($1) IS NOT NULL AS present', [table]);
      if (
        /** @type {Record<string, unknown> | undefined} */ (found.rows[0])?.['present'] !== true
      ) {
        throw new RestoreError(
          RESTORE_ERRORS.LEDGER_MISSING,
          `لا يحتوي الأرشيف على جدول دفتر الهجرات المرحلي ${manifest.ledgerStagingTable}.`,
        );
      }
      const verifyStarted = process.hrtime.bigint();
      /** @type {import('./backup.mjs').ContentDigest} */
      let actual;
      try {
        const client = await verifier.connect();
        let broken = false;
        try {
          await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
          actual = await computeContentDigest(
            client,
            `${quoteIdent(STATE_SCHEMA)}.${quoteIdent(manifest.ledgerStagingTable)}`,
          );
          await client.query('COMMIT');
        } catch (error) {
          broken = true;
          throw error;
        } finally {
          client.release(broken);
        }
      } catch (error) {
        throw new RestoreError(
          RESTORE_ERRORS.CONTENT_CHECK_FAILED,
          `تعذّرَ التحقّقُ من محتوى المستعاد: ${describe(error)} — لا [RESTORE_OK]. البياناتُ مُحمَّلةٌ لكنّ الدفترَ لم يُركَّب (‏بقيَ ${manifest.ledgerStagingTable} في state)، فالهدفُ ليسَ قاعدةً مُهاجَرةً صالحة؛ أعِدِ الاستعادةَ بـ--force.`,
        );
      }
      contentVerifyMs = Number((process.hrtime.bigint() - verifyStarted) / 1_000_000n);
      const differences = contentDigestDifferences(manifest.contentDigest, actual);
      if (differences.length > 0) {
        throw new RestoreError(
          RESTORE_ERRORS.CONTENT_MISMATCH,
          `محتوى المستعادِ لا يطابقُ بصمةَ النسخة: ${differences.join('؛ ')} — لا [RESTORE_OK]. الدفترُ لم يُركَّب (‏بقيَ ${manifest.ledgerStagingTable} في state)، فالهدفُ ليسَ قاعدةً مُهاجَرةً صالحة.`,
        );
      }
      contentVerification = CONTENT_VERIFICATION.VERIFIED;
    }
    // ‏`WL-614` (‏`LIVE-78/VERIFY-ORDER`): الأعدادُ ونسخةُ الهجرةِ تُحسَمُ **قبلَ** تركيبِ الدفتر، كما
    // تُحسَمُ البصمةُ قبلَه منذُ `WL-606`. كانَ الدفترُ يُركَّبُ أوّلاً، فبعدَ `RESTORE_ROW_COUNT_MISMATCH`
    // أو `RESTORE_MIGRATION_VERSION_MISMATCH` يبقى `public.schema_migrations` كاملاً ويقرأُ `migrate`
    // الهدفَ قاعدةً مُهاجَرةً سليمة (‏مقيس). الآن فشلُ أيِّ فحصٍ يتركُ الدفترَ مرحليّاً في `state`.
    const found = await verifier.query('SELECT to_regclass($1) IS NOT NULL AS present', [
      `${STATE_SCHEMA}.${manifest.ledgerStagingTable}`,
    ]);
    if (/** @type {Record<string, unknown> | undefined} */ (found.rows[0])?.['present'] !== true) {
      throw new RestoreError(
        RESTORE_ERRORS.LEDGER_MISSING,
        `لا يحتوي الأرشيف على جدول دفتر الهجرات المرحلي ${manifest.ledgerStagingTable}.`,
      );
    }
    const actualCounts = await readRowCounts(verifier, manifest.ledgerStagingTable);
    if (!sameCounts(manifest.rowCounts, actualCounts)) {
      throw new RestoreError(
        RESTORE_ERRORS.ROW_COUNT_MISMATCH,
        `عدد الصفوف بعد الاستعادة لا يطابق البيان: المتوقع ${JSON.stringify(manifest.rowCounts)} والفِعلي ${JSON.stringify(actualCounts)}. الدفترُ لم يُركَّب (‏بقيَ ${manifest.ledgerStagingTable} في state).`,
      );
    }
    const actualVersion = await migrationVersion(verifier, manifest.ledgerStagingTable);
    if (actualVersion !== manifest.migrationVersion) {
      throw new RestoreError(
        RESTORE_ERRORS.MIGRATION_VERSION_MISMATCH,
        `نسخة الهجرة بعد الاستعادة ${actualVersion} لا تطابق البيان ${manifest.migrationVersion}. الدفترُ لم يُركَّب (‏بقيَ ${manifest.ledgerStagingTable} في state).`,
      );
    }
    await moveMigrationLedger(verifier, manifest.ledgerStagingTable);
  } finally {
    await verifier.end();
  }
  return { durationMs, created, contentVerification, contentVerifyMs, manifest };
}

/**
 * @param {string[]} argv
 * @param {string} databaseUrl
 * @returns {Promise<void>}
 */
export async function main(argv, databaseUrl) {
  const options = parseArguments(argv);
  const outcome = await restoreBackup(options, databaseUrl);
  // ‏`WL-614`: ما يُطبَعُ من البيانِ المتحقَّقِ منه؛ إعادةُ قراءتِه من القرصِ هنا كانت تطبعُ بيانَ مَن
  // كتبَ فوقَه بعدَ الاستعادة، أو تُسقِطُ عمليّةً نجحَت استعادتُها بخطأِ بيانٍ تالف.
  const { manifest } = outcome;
  // ‏`[RESTORE_OK]` = **تحقّقٌ تمّ**: الأعدادُ ونسخةُ الهجرةِ وبصمةُ المحتوى طابقت. نسخةٌ بلا بصمةٍ
  // تُعلَنُ بعلامةٍ أخرى لا تحوي `RESTORE_OK` كي لا يقرأَها مستهلكٌ آليٌّ تحقّقاً (‏`WL-606`).
  if (outcome.contentVerification === CONTENT_VERIFICATION.VERIFIED) {
    console.log(
      `استُعيدت النسخة [RESTORE_OK] إلى قاعدة ${options.database}${outcome.created ? ' (أُنشئت)' : ''}.`,
    );
    console.log(
      `تحقّقُ المحتوى [CONTENT_VERIFIED]: البصمةُ ${manifest.contentDigest?.sha256} طابقت (‏${outcome.contentVerifyMs} مللي ثانية).`,
    );
  } else {
    console.log(
      `استُعيدت النسخة [RESTORE_UNVERIFIED] إلى قاعدة ${options.database}${outcome.created ? ' (أُنشئت)' : ''} — بلا بصمةِ محتوى؛ طابقت الأعدادُ ونسخةُ الهجرةِ فقط، ولا دليلَ على المحتوى.`,
    );
  }
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
