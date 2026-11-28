#!/usr/bin/env node
/**
 * استعادة نسخة `scripts/backup.mjs` إلى قاعدة نظيفة فقط.
 *
 * العيب الذي يعالجه: تمرير `pg_restore` إلى قاعدة مشغولة قد يخلط حالة قديمة
 * بجديدة ثم يبدو ناجحاً. لذلك تُفحص `state` ودفتر الهجرات أولاً، ولا يُزالان
 * إلا بطلب `--force` صريح.
 *
 * حدٌّ معلن: `--force` يمحو `state` و`public.schema_migrations` فقط؛ لا يمحو كائنات المخطّطات الأخرى
 * ولا يحوّل هذه الأداة إلى استعادة نقطة-زمن.
 *
 * ‏`WL-624` (‏`LIVE-78`): **الاستعادةُ كلُّها معاملةٌ واحدةٌ صريحةٌ في جلسةِ `psql` واحدة** — الفحصُ والحجزُ
 * والمحوُ وخرجُ `pg_restore` والتحقّقُ وتركيبُ الدفتر — و`COMMIT` وحدَه الانتقال، يُرسَلُ بعدَ نجاحِ التحقّق.
 * كانَ المحوُ يُلتزَمُ قبلَ `pg_restore`، فإخفاقُه أو إخفاقُ التحقّقِ يتركُ الهدفَ ممحوّاً أو ناقصاً. حدودُ
 * الضمانِ في `restoreInOneTransaction` و`docs/RECOVERY.md`.
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
import { PsqlSession } from './lib/psql-session.mjs';

const STATE_SCHEMA = 'state';
const MIGRATION_LEDGER = 'schema_migrations';
const FENCE_SCHEMA = 'fence';
// هجرةُ السياج (`migrations/0024_fence.up.sql`). دفترٌ يقولُ إنّها طُبِّقت وليسَ في الهدفِ مخطّطُ
// `fence` حالٌ لا يُوثَقُ بفحصِها: السياجُ يُنزَعُ موثَّقاً بهجرةِ النزول، وهي تحذفُ صفَّها من الدفتر.
const FENCE_MIGRATION_VERSION = 24;
// لا مسار موقّت نصّاً: راجع WL-022 و`scripts/lib/pg-tools.mjs`.
const pgRestore = () => resolvePgTool('pg_restore');
const psqlTool = () => resolvePgTool('psql');
// ‏`WL-624`: اسمُ جلسةِ المعاملةِ الواحدة في `pg_stat_activity` (‏يُرى ويُقاسُ ويُنهى بالاسم).
export const RESTORE_APPLICATION_NAME = 'xuux-restore';
// مهلةُ حسمِ حالِ المعاملةِ بعدَ فقدِ الجلسة (‏الخادمُ يُجهِضُها حينَ يكتشفُ انقطاعَ العميل).
const SETTLE_TIMEOUT_MS = 10_000;

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
  ARCHIVE_UNSUPPORTED: 'RESTORE_ARCHIVE_UNSUPPORTED',
  LOCK_CAPACITY: 'RESTORE_LOCK_CAPACITY',
  COMMIT_FAILED: 'RESTORE_COMMIT_FAILED',
  COMMIT_OUTCOME_UNKNOWN: 'RESTORE_COMMIT_OUTCOME_UNKNOWN',
  DIGEST_MISSING: 'RESTORE_DIGEST_MISSING',
  CONTENT_MISMATCH: 'RESTORE_CONTENT_MISMATCH',
  CONTENT_CHECK_FAILED: 'RESTORE_CONTENT_CHECK_FAILED',
  TARGET_BUSY: 'RESTORE_TARGET_BUSY',
});

/**
 * ‏`WL-627`: مفتاحُ القفلِ الاستشاريِّ لاستعادةٍ إلى هدفٍ باسمِه (‏على قاعدةِ الإدارةِ `postgres`، فكلُّ استعادتين
 * إلى الاسمِ نفسِه في العنقودِ تتسلسلان). تصادمُ `hashtext` يُسلسِلُ استعادتين لا علاقةَ بينَهما — لا ضرر.
 */
const TARGET_LOCK_CLASS = 0x5875_7578;
/** ‏`WL-627`: حدُّ انتظارِ استعادةٍ أخرى إلى الهدفِ نفسِه قبلَ `RESTORE_TARGET_BUSY`. */
const TARGET_LOCK_TIMEOUT = /^[1-9][0-9]{0,6}$/.test(
  process.env['RESTORE_TARGET_LOCK_TIMEOUT_MS'] ?? '',
)
  ? `${String(process.env['RESTORE_TARGET_LOCK_TIMEOUT_MS'])}ms`
  : '30s';

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
 * ‏`WL-627`: يُنشئُ الهدفَ إن غابَ، و**يُبلِغُ هل أنشأَه هو**. كانَ «أُنشئَ» يُحسَبُ بفحصٍ منفصلٍ قبلَ هذا، فقاعدةٌ
 * أنشأَها غيرُه بينَهما تُعَدُّ «مُنشأةً» ثمّ تُحذَفُ عندَ الفشل (‏مقيسٌ: قاعدةُ طرفٍ آخرَ بمحتواها حُذِفت، واستعادةٌ
 * متزامنةٌ أعلنت `[RESTORE_OK]` ثمّ حُذِفت قاعدتُها). الآنَ «أُنشئَ» = نجاحُ `CREATE DATABASE` في هذه العمليّة،
 * ومعه `oid` القاعدةِ المُنشأة كي لا يُحذَفَ إلّا هي. سبقُ غيرِه إلى الإنشاء (‏`42P04`، أو `23505` على فهرسِ
 * الأسماء) يعني هدفاً موجوداً لم نُنشئْه.
 * @param {import('pg').Pool | import('pg').PoolClient} admin
 * @param {string} database
 * @returns {Promise<{ created: boolean, oid: string | null }>}
 */
async function ensureDatabase(admin, database) {
  const exists = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [database]);
  if ((exists.rowCount ?? 0) > 0) return { created: false, oid: null };
  try {
    await admin.query(`CREATE DATABASE ${quoteIdent(database)}`);
  } catch (error) {
    const code = /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (error))['code'];
    if (code === '42P04' || code === '23505') return { created: false, oid: null };
    throw error;
  }
  const row = /** @type {Record<string, unknown> | undefined} */ (
    (await admin.query('SELECT oid::text AS oid FROM pg_database WHERE datname = $1', [database]))
      .rows[0]
  );
  return { created: true, oid: row === undefined ? null : String(row['oid']) };
}

/**
 * ‏`WL-627`: يحجزُ اسمَ الهدفِ لهذه الاستعادةِ وحدَها حتى نهايتِها (‏قفلٌ استشاريٌّ على مستوى الجلسةِ في قاعدةِ
 * الإدارة). استعادتان متزامنتان إلى الاسمِ نفسِه كانتا تُنشئانِ وتحذفانِ قاعدةَ إحداهما الأخرى.
 * @param {import('pg').PoolClient} admin
 * @param {string} database
 */
async function lockTarget(admin, database) {
  await admin.query(`SET lock_timeout = '${TARGET_LOCK_TIMEOUT}'`);
  try {
    await admin.query('SELECT pg_catalog.pg_advisory_lock($1, pg_catalog.hashtext($2))', [
      TARGET_LOCK_CLASS,
      database,
    ]);
  } catch (error) {
    const code = /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (error))['code'];
    if (code === '55P03') {
      throw new RestoreError(
        RESTORE_ERRORS.TARGET_BUSY,
        `استعادةٌ أخرى إلى ${database} جاريةٌ منذُ أكثرَ من ${TARGET_LOCK_TIMEOUT}؛ الهدفُ لم يُلمَس.`,
      );
    }
    throw error;
  }
  await admin.query('RESET lock_timeout');
}

/**
 * @param {import('./lib/psql-session.mjs').Queryable} pool
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
 * @param {import('./lib/psql-session.mjs').Queryable} client
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
 * @param {import('./lib/psql-session.mjs').Queryable} client
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
 * @param {import('./lib/psql-session.mjs').Queryable} pool
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
 * ‏`WL-614`: كانت تُقرأُ من الدفترِ المرحليِّ قبلَ تركيبِه. ‏`WL-627`: من الدفترِ المُركَّبِ نفسِه داخلَ المعاملة —
 * لا يُرى قبلَ `COMMIT`، فالترتيبُ داخلَها لا يكشفُ شيئاً، والمتحقَّقُ منه صارَ ما يُلتزَم.
 * @param {import('./lib/psql-session.mjs').Queryable} pool
 * @param {string} ledgerRelation اسمٌ مؤهَّلٌ مُقتبَس.
 * @returns {Promise<number>}
 */
async function migrationVersion(pool, ledgerRelation) {
  const result = await pool.query(
    `SELECT COALESCE(max(version), 0)::integer AS version
     FROM ${ledgerRelation}`,
  );
  const row = /** @type {Record<string, unknown> | undefined} */ (result.rows[0]);
  return Number(row?.['version']);
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
 * ‏`WL-624` (‏`LIVE-78`): هل يحوي الأرشيفُ مخطّطَ `fence`؟ وهل فيه ما يُصدِرُ تحكّماً بالمعاملات؟ يُقرأُ فهرسُ
 * الأرشيفِ (‏`pg_restore --list`) من النسخةِ الخاصّةِ المتحقَّقِ منها نفسِها. الكائناتُ الكبيرةُ (‏`BLOB`/
 * `LARGE OBJECT`) يُصدِرُ لها `pg_restore` في خرجِه النصّيِّ `BEGIN`/`COMMIT` خاصّةً بها، فتلتزمُ ما قبلَها
 * من معاملةِ الاستعادة — فتُرفَضُ قبلَ اللمس. (‏نسخُ `scripts/backup.mjs` بـ`--schema` لا يحويها أصلاً.)
 * @param {string} restoreTool
 * @param {string} archivePath
 * @returns {Promise<{ hasFence: boolean, entries: number }>}
 */
async function readArchiveToc(restoreTool, archivePath) {
  const result = await runCapture(restoreTool, ['--list', archivePath]);
  if (result.code !== 0) {
    throw new RestoreError(
      RESTORE_ERRORS.COMMAND_FAILED,
      `فشل pg_restore --list برمز ${result.code}: ${result.stderr.trim()}`,
    );
  }
  const entries = result.stdout.split('\n').filter((line) => /^\d+;/.test(line));
  if (entries.some((line) => /\s(BLOB|BLOBS|LARGE OBJECT|BLOB METADATA)\s/.test(line))) {
    throw new RestoreError(
      RESTORE_ERRORS.ARCHIVE_UNSUPPORTED,
      'الأرشيفُ يحوي كائناتٍ كبيرة (‏BLOB)؛ خرجُ pg_restore لها يحملُ BEGIN/COMMIT خاصّةً يكسرُ ذرّيّةَ المعاملةِ الواحدة. الهدفُ لم يُلمَس.',
    );
  }
  return {
    hasFence: entries.some((line) => new RegExp(`\\sSCHEMA - ${FENCE_SCHEMA}(\\s|$)`).test(line)),
    entries: entries.length,
  };
}

/**
 * ‏`WL-624` (‏`LIVE-78`): المعاملةُ الواحدةُ تمسكُ قفلاً لكلِّ كائنٍ تُنشئُه أو تمحوه حتّى `COMMIT`، وجدولُ الأقفالِ
 * مشتركٌ في العنقود (‏`max_locks_per_transaction × (max_connections + max_prepared_transactions)`). نفادُه
 * (‏`53200`) لا يُسقِطُ الاستعادةَ وحدَها — يُسقِطُ **جلساتٍ أخرى** (‏مقيسٌ في `WL-603`). فيُقدَّرُ الطلبُ قبلَ أيِّ
 * لمسٍ وتُرفَضُ الاستعادةُ إن تجاوزَ **نصفَ** السعة؛ **لا يُرفَعُ أيُّ إعدادٍ في الخادم** (‏قرارُ `WL-606`).
 * التقدير: 4 لكلِّ مدخلٍ في فهرسِ الأرشيف + 3 لكلِّ علاقةٍ في `state` تُمحى. مقيسٌ على مخطّطِ XUUX
 * (‏557 مدخلاً، 162 علاقةً): الفعليُّ 2151 قفلاً قبيلَ `COMMIT` والتقديرُ 2714 — حدٌّ أعلى لا تقديرٌ دقيق.
 */
export const LOCKS_PER_ARCHIVE_ENTRY = 4;
export const LOCKS_PER_WIPED_RELATION = 3;

/**
 * @param {import('./lib/psql-session.mjs').Queryable} session
 * @param {number} archiveEntries
 * @param {boolean} force
 * @returns {Promise<void>}
 */
async function refuseLockExhaustion(session, archiveEntries, force) {
  const found = await session.query(
    `SELECT pg_catalog.current_setting('max_locks_per_transaction')::int AS per_tx,
            pg_catalog.current_setting('max_connections')::int AS connections,
            pg_catalog.current_setting('max_prepared_transactions')::int AS prepared,
            (SELECT count(*)::int FROM pg_catalog.pg_class c
               JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
              WHERE n.nspname = $1) AS wiped`,
    [STATE_SCHEMA],
  );
  const row = /** @type {Record<string, number>} */ (found.rows[0]);
  const capacity = Number(row['per_tx']) * (Number(row['connections']) + Number(row['prepared']));
  const needed =
    LOCKS_PER_ARCHIVE_ENTRY * archiveEntries +
    (force ? LOCKS_PER_WIPED_RELATION * Number(row['wiped']) : 0);
  if (needed > capacity / 2) {
    throw new RestoreError(
      RESTORE_ERRORS.LOCK_CAPACITY,
      `الاستعادةُ معاملةٌ واحدةٌ تحتاجُ نحوَ ${needed} قفلاً (‏${archiveEntries} مدخلاً في الأرشيف)، وسعةُ جدولِ الأقفالِ المشتركِ ${capacity} (‏max_locks_per_transaction × (max_connections + max_prepared_transactions)). تجاوزُ نصفِها يُعرِّضُ جلساتٍ أخرى لـ53200؛ فلا لمس: الهدفُ كما كان. لا تُرفَعُ الإعداداتُ من هذه الأداة (‏docs/RECOVERY.md).`,
    );
  }
}

/**
 * @param {string} executable
 * @param {string[]} args
 * @returns {Promise<{ code: number, stdout: string, stderr: string }>}
 */
function runCapture(executable, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

/**
 * يختار `psql` ويرفض ما إصداره أقدم من الخادم الذي أنشأ النسخة (‏كـ`pg_restore`).
 * @param {string} dumpServerVersion
 * @returns {Promise<string>}
 */
export async function resolveVerifiedPsqlTool(dumpServerVersion) {
  try {
    const toolPath = psqlTool();
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
 * ‏`WL-624` (‏`LIVE-78`): حالةُ المعاملةِ عندَ الخادمِ بعدَ أن فقدَت الأداةُ الجلسة. `in progress` يعني أنّ
 * الخلفيّةَ لم تُنهِ بعد (‏تُجهِضُها عندَ اكتشافِ انقطاعِ العميل)؛ يُنتظَرُ حسمُها حتى المهلة.
 * @param {string} targetUrl
 * @param {string} xid
 * @returns {Promise<string | null>}
 */
async function settleTransaction(targetUrl, xid) {
  const probe = new pg.Client({ connectionString: targetUrl });
  probe.on('error', () => undefined);
  try {
    await probe.connect();
    const deadline = Date.now() + SETTLE_TIMEOUT_MS;
    for (;;) {
      const row = /** @type {Record<string, unknown> | undefined} */ (
        (await probe.query('SELECT pg_catalog.pg_xact_status($1::xid8) AS s', [xid])).rows[0]
      );
      const status = row?.['s'] === null || row?.['s'] === undefined ? null : String(row['s']);
      if (status !== 'in progress' || Date.now() > deadline) return status;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  } catch {
    return null;
  } finally {
    await probe.end().catch(() => undefined);
  }
}

/**
 * ‏`WL-624` (‏`LIVE-78`): يُحوِّلُ إخفاقاً داخلَ المعاملةِ إلى خطأٍ مسمّى. `RestoreError` يمرُّ كما هو؛ وغيرُه
 * (‏سقوطُ عبارةٍ من خرجِ `pg_restore`، أو انقطاعُ الجلسة) ⇒ `RESTORE_COMMAND_FAILED`.
 * @param {unknown} error
 * @param {PsqlSession} session
 * @returns {Error}
 */
function namedFailure(error, session) {
  if (error instanceof RestoreError || error instanceof BackupError) return error;
  const context = /CONTEXT:\s+([^\n]*)/.exec(session.stderr);
  return new RestoreError(
    RESTORE_ERRORS.COMMAND_FAILED,
    `فشلت استعادةُ pg_restore داخلَ المعاملة (${describe(error)})${context === null ? '' : ` [${String(context[1])}]`} — لا COMMIT: الهدفُ كما كان.`,
  );
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
  // الهدف وقبل محو `--force`. و`psql` (‏`WL-624`) كذلك: هو حاملُ المعاملة.
  const restoreTool = await resolveVerifiedRestoreTool(manifest.databaseVersion);
  const psql = await resolveVerifiedPsqlTool(manifest.databaseVersion);
  const toc = await readArchiveToc(restoreTool, archivePath);
  const adminPool = new pg.Pool({ connectionString: administrationUrl(url), max: 1 });
  adminPool.on('error', () => undefined);
  const admin = await adminPool.connect();
  admin.on('error', () => undefined);
  try {
    await lockTarget(admin, options.database);
    const { created, oid } = await ensureDatabase(admin, options.database);
    const targetUrl = urlForDatabase(url, options.database);
    try {
      return await restoreInOneTransaction(options, targetUrl, verified, {
        restoreTool,
        psql,
        hasFence: toc.hasFence,
        archiveEntries: toc.entries,
        created,
      });
    } catch (error) {
      // ‏`WL-624`: هدفٌ أنشأته هذه الاستعادةُ ثمّ فشلت ⇒ يُحذَفُ فيعودُ «كما كان» (‏غائباً). ‏`WL-627`: **عندَ فشلٍ
      // مُثبَتٍ وحدَه** — ‏`RESTORE_COMMIT_OUTCOME_UNKNOWN` قد يكونُ التزاماً (‏مقيسٌ: `pg_xact_status = committed`
      // والقاعدةُ محذوفة)، فلا يُحذَف. ويُحذَفُ بـ`oid` الذي أنشأناه لا بالاسمِ وحدَه. ‏`DROP DATABASE` بلا `FORCE`:
      // إن اتّصلَ به أحدٌ في الأثناءِ بقيَ.
      const unknown =
        error instanceof RestoreError && error.code === RESTORE_ERRORS.COMMIT_OUTCOME_UNKNOWN;
      if (created && oid !== null && !unknown) {
        await dropCreatedTarget(admin, options.database, oid).catch(() => undefined);
      }
      throw error;
    }
  } finally {
    admin.release(true);
    await adminPool.end().catch(() => undefined);
  }
}

/**
 * ‏`WL-627`: يحذفُ الهدفَ الذي أنشأته هذه الاستعادةُ — إن كانَ الاسمُ ما يزالُ لـ`oid` نفسِه.
 * @param {import('pg').PoolClient} admin
 * @param {string} database
 * @param {string} oid
 */
async function dropCreatedTarget(admin, database, oid) {
  const still = await admin.query(
    'SELECT 1 FROM pg_database WHERE datname = $1 AND oid = $2::oid',
    [database, oid],
  );
  if ((still.rowCount ?? 0) === 0) return;
  await admin.query(`DROP DATABASE IF EXISTS ${quoteIdent(database)}`);
}

/**
 * ‏`WL-624` (‏`LIVE-78`): **الاستعادةُ كلُّها معاملةٌ واحدة، و`COMMIT` هو الانتقالُ الوحيد.** الترتيب:
 *   ‏`BEGIN` ← رقمُ المعاملة ← فحصُ السياجِ والنظافة ← حجزُ `fence` ← المحو (‏`--force`) ← خرجُ `pg_restore`
 *   ← تحقّقٌ أنّ المعاملةَ لم تتبدّل ← التحقّقُ (‏البصمة، الأعداد، نسخةُ الهجرة) ← تركيبُ الدفتر ← `COMMIT`.
 * أيُّ إخفاقٍ قبلَ `COMMIT` — رفضٌ، أو سقوطُ `pg_restore` أو عبارةٍ من خرجِه، أو تحقّقٌ لا يطابق، أو موتُ
 * الأداةِ أو psql أو انقطاعُ الاتصال — ⇒ لا `COMMIT` يُرسَل ⇒ يُجهِضُ الخادمُ المعاملةَ والهدفُ كما كانَ
 * بالضبط. وبعدَ إرسالِ `COMMIT` بلا ردٍّ تُحسَمُ النتيجةُ من الخادمِ (‏`pg_xact_status`) لا تُفترَض.
 * @param {RestoreOptions} options
 * @param {string} targetUrl
 * @param {import('./backup.mjs').VerifiedArchive} verified
 * @param {{ restoreTool: string, psql: string, hasFence: boolean, archiveEntries: number, created: boolean }} tools
 * @returns {Promise<RestoreOutcome>}
 */
async function restoreInOneTransaction(options, targetUrl, verified, tools) {
  const { manifest, archivePath } = verified;
  const sessionUrl = new URL(targetUrl);
  sessionUrl.searchParams.set('application_name', RESTORE_APPLICATION_NAME);
  const child = spawn(
    tools.psql,
    ['-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-d', sessionUrl.toString()],
    { stdio: ['pipe', 'pipe', 'pipe'] },
  );
  const session = new PsqlSession(child);
  /** @type {import('node:child_process').ChildProcess | null} */
  let dumper = null;
  let commitSent = false;
  /** @type {string | null} */
  let xid = null;
  const started = process.hrtime.bigint();
  /** @type {'VERIFIED' | 'NO_DIGEST'} */
  let contentVerification = CONTENT_VERIFICATION.NO_DIGEST;
  let contentVerifyMs = 0;
  try {
    session.write('\\set VERBOSITY verbose\nSET client_min_messages = warning;\n');
    await session.mark('BEGIN');
    const ident = await session.mark(null, `pg_catalog.pg_current_xact_id()::text`);
    xid = ident;
    // فحصُ النظافةِ داخلَ المعاملة (‏كانَ قبلَها وحدَه): ‏`state` أو دفترٌ أُنشئا بينَ الفحصِ و`BEGIN` لا يُخلَطانِ بالمستعاد.
    const contents = await targetContents(session);
    if ((contents.hasState || contents.hasLedger) && !options.force) {
      throw new RestoreError(
        RESTORE_ERRORS.TARGET_NOT_CLEAN,
        'قاعدة الهدف ليست نظيفة: وُجد مخطّط state أو دفتر public.schema_migrations؛ أعد الطلب مع --force صراحةً.',
      );
    }
    await refuseLockExhaustion(session, tools.archiveEntries, options.force === true);
    // ‏`WL-597`: كلُّ هدفٍ مُسيَّجٍ يُرفَضُ قبلَ أيِّ محو، وحجزُ اسمِ `fence` يُمسَكُ حتى `COMMIT` (‏كانَ حتى
    // التزامِ المحوِ وحدَه، فنافذةُ ما بعدَه — التداخلُ C — مفتوحة؛ الآنَ لا «ما بعد» قبلَ الالتزام).
    await refuseFencedTarget(session);
    await claimFenceName(session);
    if (options.force) {
      // لا يُدخل اسمٌ من المستخدم هنا؛ الأسماءُ ثابتةٌ ومقتبسة.
      await session.query(`DROP SCHEMA IF EXISTS ${quoteIdent(STATE_SCHEMA)} CASCADE`);
      await session.query(`DROP TABLE IF EXISTS public.${quoteIdent(MIGRATION_LEDGER)}`);
    }
    // نسخةٌ مُسيَّجةٌ تُنشئُ `fence` بنفسِها: يُسقَطُ المحجوزُ (‏فارغ: `RESTRICT`) قبلَها، والصفُّ المحذوفُ غيرُ
    // المُلتزَمِ يُبقي كلَّ إنشاءٍ متزامنٍ منتظراً هذه المعاملة. وإلّا يُسقَطُ بعدَ التحقّق.
    if (tools.hasFence) await session.query(`DROP SCHEMA ${quoteIdent(FENCE_SCHEMA)} RESTRICT`);

    // خرجُ `pg_restore` النصّيُّ يُضَخُّ في الجلسةِ نفسِها؛ لا يُشغَّلُ على الهدفِ مباشرةً.
    const restoreProcess = spawn(
      tools.restoreTool,
      ['--exit-on-error', '--no-owner', '--no-privileges', '--file', '-', archivePath],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    dumper = restoreProcess;
    let restoreStderr = '';
    restoreProcess.stderr.setEncoding('utf8');
    restoreProcess.stderr.on('data', (chunk) => {
      restoreStderr += chunk;
    });
    const restoreExit = new Promise((resolve) => {
      restoreProcess.on('error', () => resolve(1));
      restoreProcess.on('close', (code) => resolve(code ?? 1));
    });
    restoreProcess.stdout.pipe(child.stdin, { end: false });
    // ‏psql إن خرجَ (‏عبارةٌ سقطت) فلا قارئَ للأنبوب: يُقتَلُ `pg_restore` كي لا يعلقَ عليه.
    void session.exited.then(() => {
      restoreProcess.stdout.unpipe();
      restoreProcess.stdout.resume();
      restoreProcess.kill('SIGKILL');
    });
    const restoreCode = /** @type {number} */ (await restoreExit);
    if (!session.alive) throw session.failure();
    if (restoreCode !== 0) {
      throw new RestoreError(
        RESTORE_ERRORS.COMMAND_FAILED,
        `فشل pg_restore برمز ${restoreCode}: ${restoreStderr.trim()}`,
      );
    }
    // أعادَ خرجُ `pg_restore` ضبطَ `search_path` فارغاً؛ عباراتُ ما بعدَه مؤهَّلةٌ كلُّها.
    const after = await session.mark(null, `pg_catalog.pg_current_xact_id()::text`);
    if (after !== ident) {
      // دفاعٌ ثانٍ بعدَ فهرسِ الأرشيف: خرجٌ فيه `COMMIT` أنهى المعاملةَ الأولى. ما قبلَه **قد التُزِم**.
      throw new RestoreError(
        RESTORE_ERRORS.COMMAND_FAILED,
        `تبدّلت معاملةُ الاستعادة أثناءَ pg_restore (${ident} ⇐ ${after}): خرجُه أنهى المعاملة، وما قبلَه قد التُزِم. افحصِ الهدفَ يدوياً (‏docs/RECOVERY.md).`,
      );
    }
    const durationMs = Number((process.hrtime.bigint() - started) / 1_000_000n);
    if (!tools.hasFence) await session.query(`DROP SCHEMA ${quoteIdent(FENCE_SCHEMA)} RESTRICT`);

    const stagingRelation = `${STATE_SCHEMA}.${manifest.ledgerStagingTable}`;
    const ledgerFound = await session.query('SELECT to_regclass($1) IS NOT NULL AS present', [
      stagingRelation,
    ]);
    if (ledgerFound.rows[0]?.['present'] !== true) {
      throw new RestoreError(
        RESTORE_ERRORS.LEDGER_MISSING,
        `لا يحتوي الأرشيف على جدول دفتر الهجرات المرحلي ${manifest.ledgerStagingTable}. لا COMMIT: الهدفُ كما كان.`,
      );
    }
    // تركيبُ الدفترِ في المعاملةِ نفسِها (‏كانَ معاملةً ثانيةً بعدَ التحقّق — `WL-614`/`WL-615`). ‏`WL-627`:
    // **قبلَ التحقّق** لا بعدَه، ثمّ تُطلَقُ القيودُ المؤجَّلةُ كلُّها الآن (‏`SET CONSTRAINTS ALL IMMEDIATE`): كانَ
    // التحقّقُ يسبقُ خطوةً كاتبةً (‏التركيب — يُطلِقُ قوادحَ أحداثِ `ALTER TABLE`) ويسبقُ القوادحَ المؤجَّلةَ إلى
    // `COMMIT`، فمحتوىً بُدِّلَ بعدَ البصمةِ أُعلِنَ `[CONTENT_VERIFIED]` (‏مقيس). الآنَ ما يُتحقَّقُ منه هو ما
    // يُلتزَم: بعدَ البصمةِ لا عبارةٌ كاتبةٌ ولا قادحٌ مؤجَّلٌ معلَّق.
    await session.query(
      `ALTER TABLE ${quoteIdent(STATE_SCHEMA)}.${quoteIdent(manifest.ledgerStagingTable)} SET SCHEMA public`,
    );
    await session.query(
      `ALTER TABLE public.${quoteIdent(manifest.ledgerStagingTable)} RENAME TO ${quoteIdent(MIGRATION_LEDGER)}`,
    );
    try {
      await session.query('SET CONSTRAINTS ALL IMMEDIATE');
    } catch (error) {
      // قيدٌ مؤجَّلٌ يرفضُ ⇒ هو ما كانَ سيرفضُ `COMMIT` (‏`WL-624`)؛ يُطلَقُ الآنَ قبلَ التحقّقِ فيُسمّى باسمِه نفسِه.
      throw new RestoreError(
        RESTORE_ERRORS.COMMIT_FAILED,
        `رُفِضَ الالتزامُ بقيدٍ مؤجَّلٍ أُطلِقَ قبلَ التحقّق (${describe(error)}): لا COMMIT أُرسِل فالهدفُ كما كانَ بالضبط. لا [RESTORE_OK].`,
      );
    }
    if (manifest.contentDigest !== undefined) {
      // ‏`WL-606`: البصمةُ بالشيفرةِ نفسِها (‏`computeContentDigest`) على المعاملةِ نفسِها قبلَ أن تُرى.
      const verifyStarted = process.hrtime.bigint();
      /** @type {import('./backup.mjs').ContentDigest} */
      let actual;
      try {
        actual = await computeContentDigest(
          /** @type {any} */ (session),
          `public.${quoteIdent(MIGRATION_LEDGER)}`,
        );
      } catch (error) {
        throw new RestoreError(
          RESTORE_ERRORS.CONTENT_CHECK_FAILED,
          `تعذّرَ التحقّقُ من محتوى المستعاد: ${describe(error)} — لا [RESTORE_OK]. لا COMMIT: الهدفُ كما كان.`,
        );
      }
      contentVerifyMs = Number((process.hrtime.bigint() - verifyStarted) / 1_000_000n);
      const differences = contentDigestDifferences(manifest.contentDigest, actual);
      if (differences.length > 0) {
        throw new RestoreError(
          RESTORE_ERRORS.CONTENT_MISMATCH,
          `محتوى المستعادِ لا يطابقُ بصمةَ النسخة: ${differences.join('؛ ')} — لا [RESTORE_OK]. لا COMMIT: الهدفُ كما كان.`,
        );
      }
      contentVerification = CONTENT_VERIFICATION.VERIFIED;
    }
    const actualCounts = await readRowCounts(session, manifest.ledgerStagingTable);
    if (!sameCounts(manifest.rowCounts, actualCounts)) {
      throw new RestoreError(
        RESTORE_ERRORS.ROW_COUNT_MISMATCH,
        `عدد الصفوف بعد الاستعادة لا يطابق البيان: المتوقع ${JSON.stringify(manifest.rowCounts)} والفِعلي ${JSON.stringify(actualCounts)}. لا COMMIT: الهدفُ كما كان.`,
      );
    }
    const actualVersion = await migrationVersion(session, `public.${quoteIdent(MIGRATION_LEDGER)}`);
    if (actualVersion !== manifest.migrationVersion) {
      throw new RestoreError(
        RESTORE_ERRORS.MIGRATION_VERSION_MISMATCH,
        `نسخة الهجرة بعد الاستعادة ${actualVersion} لا تطابق البيان ${manifest.migrationVersion}. لا COMMIT: الهدفُ كما كان.`,
      );
    }
    await session.mark(null, `'verified'`);
    commitSent = true;
    // العلامةُ بعدَ `COMMIT` تسألُ الخادمَ عن المعاملةِ نفسِها: `COMMIT` على معاملةٍ مُجهَضةٍ يردُّ `ROLLBACK`
    // بلا خطأ، فنجاحُ العبارةِ وحدَه ليس دليلاً — الدليلُ `pg_xact_status = committed`.
    const committed = session.mark('COMMIT', `pg_catalog.pg_xact_status('${xid}'::xid8)::text`);
    session.abandon();
    const ack = await committed.catch(() => null);
    await session.exited;
    if (session.exitCode === 0 && ack === 'committed') {
      return {
        durationMs,
        created: tools.created,
        contentVerification,
        contentVerifyMs,
        manifest,
      };
    }
    throw session.failure();
  } catch (error) {
    session.abandon();
    dumper?.kill('SIGKILL');
    await session.exited;
    if (!commitSent) {
      // ‏لا `COMMIT` أُرسِل ⇒ الخادمُ يُجهِضُ. يُنتظَرُ حسمُه كي لا يُرى الهدفُ (‏أو يُحذَفَ المُنشأُ) والخلفيّةُ
      // بعدُ ممسكةٌ بأقفالِها.
      if (xid !== null) await settleTransaction(targetUrl, xid);
      throw namedFailure(error, session);
    }
    // ‏`COMMIT` أُرسِلَ ولم يُؤكَّد: الحسمُ من الخادم.
    const status = xid === null ? null : await settleTransaction(targetUrl, xid);
    if (status === 'committed') {
      return {
        durationMs: Number((process.hrtime.bigint() - started) / 1_000_000n),
        created: tools.created,
        contentVerification,
        contentVerifyMs,
        manifest,
      };
    }
    if (status === 'aborted') {
      throw new RestoreError(
        RESTORE_ERRORS.COMMIT_FAILED,
        `رُفِضَ COMMIT الاستعادة (${describe(error)}): المعاملةُ أُجهِضت فالهدفُ كما كانَ بالضبط. لا [RESTORE_OK].`,
      );
    }
    throw new RestoreError(
      RESTORE_ERRORS.COMMIT_OUTCOME_UNKNOWN,
      `نتيجةُ COMMIT الاستعادةِ مجهولة: أُرسِلَ ثمّ فُقِدَت الجلسة (${describe(error)})، وحالُ المعاملة ${xid ?? '؟'} عندَ الخادم ${status ?? 'لم تُقرأ'}. إمّا الهدفُ كما كانَ وإمّا المستعادُ كاملاً متحقَّقاً — لا حالَ بينَهما. افحصْ pg_xact_status('${xid ?? '?'}') يدوياً (‏docs/RECOVERY.md). لا [RESTORE_OK].`,
    );
  }
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
