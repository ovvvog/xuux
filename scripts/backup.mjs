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
import os from 'node:os';
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
  LEDGER_SNAPSHOT_MISMATCH: 'BACKUP_LEDGER_SNAPSHOT_MISMATCH',
  DIGEST_FAILED: 'BACKUP_DIGEST_FAILED',
  DIGEST_INVALID: 'BACKUP_DIGEST_INVALID',
  DIGEST_UNSUPPORTED: 'BACKUP_DIGEST_UNSUPPORTED',
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
 * @property {ContentDigest} [contentDigest] بصمةُ المحتوى (‏`WL-606`)؛ غيابُها = نسخةٌ قديمةٌ بلا دليلِ محتوى.
 * @property {number} [contentDigestMs] زمنُ حسابِ البصمةِ داخلَ اللقطة.
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
  // `WL-595`: تُرسَلُ الاستعلاماتُ متتابعةً لا بـ`Promise.all`. المُستدعي يمرّرُ عميلاً
  // واحداً داخلَ لقطةِ `REPEATABLE READ`، والعميلُ الواحدُ لا ينفّذُ إلا استعلاماً
  // واحداً؛ فالتوازي كان طابوراً داخليّاً في `pg` يُطلقُ `DeprecationWarning`، وفي `pg@9`
  // يُزالُ الطابور. الترتيبُ على السلكِ هو نفسُه: النسخةُ، ثمّ الدفتر، ثمّ العدّادات.
  const versionResult = await pool.query('SHOW server_version');
  const migrationResult = await pool.query(
    `SELECT COALESCE(max(version), 0)::integer AS version
     FROM public.${quoteIdent(MIGRATION_LEDGER)}`,
  );
  const rowCounts = await readRowCounts(pool);
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
 * ‏`WL-598`: الدفترُ المرحليُّ يُنسَخُ ويُلتزَمُ **قبلَ** لقطةِ النسخ (‏`pg_dump` لا يرى جدولاً
 * لم يُلتزَم)، فهجرةٌ أو تراجعٌ أو تعديلٌ في `public.schema_migrations` بينَ الالتزامِ واللقطةِ
 * يُنتِجُ نسخةً دفترُها المضمَّنُ غيرُ دفترِ اللقطة: البيانُ يقرأُ `max(version)` من اللقطة،
 * والمستعادُ يحملُ الدفترَ المرحليّ ⇒ تنجحُ `create` و`verify` وتسقطُ الاستعادةُ بـ
 * `RESTORE_MIGRATION_VERSION_MISMATCH` (‏مقيس). وقفلُ المُهاجرِ الاستشاريُّ لا يحمي النسخ: النسخُ
 * لا يأخذُه، ومساراتٌ أخرى تكتبُ الدفترَ بلا قفل.
 *
 * فيُقارَنُ هنا، **داخلَ اللقطةِ نفسِها** التي يستعملُها `pg_dump` والبيان، محتوى الدفترِ المرحليِّ
 * بمحتوى الدفترِ الحقيقيِّ صفّاً صفّاً بأعمدتِه الخمسة (‏لا العددُ ولا آخرُ نسخةٍ وحدَهما)،
 * وأيُّ فرقٍ ⇒ رفضٌ قبلَ `pg_dump` فلا ملفَّ ولا بيان. والتطابقُ في اللقطةِ يعني أنّ ما يُنسَخُ
 * من الجدولِ المرحليِّ هو بعينِه دفترُ اللقطةِ التي قُرئ منها البيانُ ونُسِخت منها `state`.
 * @param {import('pg').PoolClient} client
 * @param {string} table
 * @returns {Promise<void>}
 */
async function assertStagedLedgerMatchesSnapshot(client, table) {
  const digest = (/** @type {string} */ relation) =>
    `SELECT count(*)::integer AS n, COALESCE(max(version), 0)::integer AS v,
            md5(COALESCE(string_agg(
              jsonb_build_array(version, name, checksum, applied_at, applied_by)::text,
              E'\\n' ORDER BY version), '')) AS d
     FROM ${relation}`;
  const staged = (await client.query(digest(`${quoteIdent(STATE_SCHEMA)}.${quoteIdent(table)}`)))
    .rows[0];
  const live = (await client.query(digest(`public.${quoteIdent(MIGRATION_LEDGER)}`))).rows[0];
  if (staged?.['d'] !== live?.['d'] || staged?.['n'] !== live?.['n']) {
    throw new BackupError(
      BACKUP_ERRORS.LEDGER_SNAPSHOT_MISMATCH,
      `دفترُ الهجراتِ تغيّرَ بينَ نسخِه ولقطةِ النسخ (‏المنسوخُ ${staged?.['n']} صفّاً حتى ${staged?.['v']}، واللقطةُ ${live?.['n']} صفّاً حتى ${live?.['v']}) — لا نسخةَ تُكتَب؛ أعِدِ النسخَ بعدَ انتهاءِ الهجرة.`,
    );
  }
}

/**
 * @param {string} value
 * @returns {string}
 */
function sha256File(value) {
  return crypto.createHash('sha256').update(fs.readFileSync(value)).digest('hex');
}

// ═══ بصمةُ المحتوى (‏`WL-606`، `LIVE-78/CONTENT-INTEGRITY`) ═══════════════════════════════════
// المشكلة: تحقّقُ الاستعادةِ كانَ عدَّ صفوفٍ ونسخةَ هجرة؛ محتوىً مُبدَّلٌ بالأعدادِ نفسِها يمرُّ
// ‏`RESTORE_OK` (‏مقيسٌ في `WL-603`). البصمةُ تُحسَبُ **داخلَ لقطةِ `pg_dump` نفسِها** (‏العميلُ الذي
// صدّرَ اللقطةَ، قبلَ `pg_dump --snapshot`)، فلا نافذةَ زمنيّةَ بينَ ما تصفُه وما في الأرشيف، وتُعادُ
// في الهدفِ بعدَ `pg_restore` وتُقارَنُ قبلَ إعلانِ النجاح.
//
// **التمثيل (‏حتميٌّ غيرُ ملتبس):** لكلِّ صفٍّ `sha256(convert_to(record_out(row), 'UTF8'))` — نصُّ
// السجلِّ المركّبِ يميّزُ NULL (‏حقلٌ فارغٌ بلا علامات) من النصِّ الفارغ (‏`""`) ويقتبسُ الفواصل؛
// والإعداداتُ التي تغيّرُ نصَّ القيمِ مثبَّتةٌ محلّيّاً في المعاملة (‏`DIGEST_SETTINGS`). الصفوفُ
// multiset: تُجمَّعُ تجزئاتُها في 256 دلواً بأوّلِ بايت، مرتّبةً بايتيّاً داخلَ الدلو (‏`bytea`، لا
// ترتيبَ لغويّ)، ثمّ sha256 لسلسلةِ (‏بايتُ الدلو ‖ تجزئتُه) بترتيبِ الدلاء — فلا يتعلّقُ الناتجُ
// بترتيبِ التخزينِ ولا بالفهارسِ ولا بـcollation، والذاكرةُ لكلِّ دلوٍ ‎N×32/256‎ بايتاً. ولكلِّ جدولٍ
// توقيعُ أعمدتِه (‏الاسم، `format_type`، NOT NULL) بترتيبِها — فنصُّ الصفِّ يُفسَّرُ بنوعِه.
//
// **النطاقُ المعلَن (‏`scope`):** جداولُ `state` العاديّةُ (‏relkind r) عدا `__backup_schema_migrations_*`،
// ومتسلسلاتُ `state` (‏وجودٌ وتقدّمٌ لا مساواة — خارجَ MVCC، انظر `sequenceRegression`)، وصفوفُ دفترِ الهجراتِ بأعمدتِه الخمسة.
// **خارجَه — لا تُثبتُ البصمةُ سلامتَه:** القيودُ والفهارسُ والقوادحُ والسياساتُ والدوالُّ والعروضُ والأنواع
// (‏البنيةُ عدا توقيعِ الأعمدة)، والمالكون والصلاحيّاتُ والأدوار (‏الاستعادةُ `--no-owner --no-privileges`)،
// والتعليقات، والإحصاءات، والكائناتُ الكبيرة، والمخطّطاتُ الأخرى ومنها `fence`، و`log_cnt`. (‏دَينُ
// ‏`LIVE-78/DIGEST-COVERAGE`.)
//
// **ليست توقيعاً:** البيانُ غيرُ موقَّع؛ مَن يكتبُ الأرشيفَ والبيانَ معاً يزوّرُهما. ما تضمنُه: أنّ
// المستعادَ يطابقُ اللقطةَ التي نُسخت (‏ضمنَ النطاق)، لا أنَّ الأرشيفَ أصيل.

export const CONTENT_DIGEST_FORMAT = 'xuux.content-digest';
export const CONTENT_DIGEST_VERSION = 1;

/** إعداداتٌ تُثبَّتُ محلّيّاً للمعاملةِ قبلَ أيِّ حساب: كلُّها تغيّرُ نصَّ قيمٍ قد تكونُ في `state`. */
export const DIGEST_SETTINGS = Object.freeze({
  search_path: '',
  TimeZone: 'UTC',
  DateStyle: 'ISO, YMD',
  IntervalStyle: 'postgres',
  extra_float_digits: '1',
  bytea_output: 'hex',
  lc_monetary: 'C',
});

const DIGEST_SCOPE = Object.freeze({
  tables: 'state.* relkind r, excluding __backup_schema_migrations_*',
  sequences:
    'state.* relkind S: presence and monotonic progress (restored next value not behind the snapshot read); not equality — sequences are non-transactional',
  ledger: 'public.schema_migrations rows (version, name, checksum, applied_at, applied_by)',
  notCovered: [
    'constraints, indexes, triggers, policies, functions, views, types (structure beyond column signatures)',
    'owners, privileges, roles',
    'comments, statistics, large objects',
    'schemas other than state (including fence)',
    'sequence log_cnt',
  ],
});

const DIGEST_ROW_RULE =
  'row=sha256(convert_to(record_out(row),UTF8)); bucket=get_byte(row,0); bucketHash=sha256(concat rows ORDER BY bytea); table=sha256(concat(byte(bucket)||bucketHash) ORDER BY bucket)';

/**
 * JSON قانونيّ: مفاتيحُ مرتّبةٌ بنقاطِ الترميز، بلا مسافات — أساسُ البصمةِ العليا.
 * @param {unknown} value
 * @returns {string}
 */
export function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((v) => canonicalJson(v)).join(',')}]`;
  const record = /** @type {Record<string, unknown>} */ (value);
  const keys = Object.keys(record).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(record[k])}`).join(',')}}`;
}

/**
 * @typedef {object} ContentDigest
 * @property {string} format
 * @property {number} version
 * @property {{ settings: Record<string, string>, row: string }} canonicalization
 * @property {Record<string, unknown>} scope
 * @property {Record<string, { columns: Array<[string, string, boolean]>, rows: string, sha256: string }>} tables
 * @property {Record<string, { lastValue: string, isCalled: boolean, increment: string }>} sequences
 * @property {{ rows: string, sha256: string }} ledger
 * @property {string} sha256 بصمةُ `canonicalJson` لكلِّ ما سبق.
 */

/**
 * @param {Omit<ContentDigest, 'sha256'>} body
 * @returns {string}
 */
function digestBodySha256(body) {
  return crypto.createHash('sha256').update(canonicalJson(body), 'utf8').digest('hex');
}

/**
 * يحسبُ البصمةَ على `client` **داخلَ معاملةٍ مفتوحةٍ** (‏المُستدعي يملكُها): في النسخِ معاملةُ اللقطةِ
 * المُصدَّرة، وفي الاستعادةِ معاملةُ قراءةٍ `REPEATABLE READ`. الإعداداتُ محلّيّةٌ للمعاملة فلا تتسرّب.
 * @param {import('pg').PoolClient | import('pg').Client} client
 * @param {string} ledgerRelation علاقةُ الدفترِ مقتبَسةً (‏`public."schema_migrations"` أو الجدولُ المرحليّ).
 * @returns {Promise<ContentDigest>}
 */
export async function computeContentDigest(client, ledgerRelation) {
  for (const [name, value] of Object.entries(DIGEST_SETTINGS)) {
    await client.query('SELECT pg_catalog.set_config($1, $2, true)', [name, value]);
  }
  // ‏`set_config(…, true)` خارجَ معاملةٍ يسري على عبارتِه وحدَها، فتُحسَبُ البصمةُ بإعداداتِ الجلسة
  // (‏مقيسٌ بطفرة: `format_type` تغيّرَ لكلِّ جدول). فشلٌ مغلق: الإعداداتُ تُقرأُ وتُطابَقُ قبلَ أيِّ حساب.
  for (const [name, value] of Object.entries(DIGEST_SETTINGS)) {
    const got = (await client.query('SELECT pg_catalog.current_setting($1) AS v', [name]))
      .rows[0]?.['v'];
    if (got !== value && !(name === 'search_path' && got === '""')) {
      throw new Error(
        `إعدادُ البصمة ${name} لم يسرِ (‏${String(got)} بدلَ ${value}) — البصمةُ تُحسَبُ داخلَ معاملةٍ وحدَها.`,
      );
    }
  }
  const relations = await client.query(
    `SELECT c.oid::bigint AS oid, c.relname, c.relkind
       FROM pg_catalog.pg_class AS c
       JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
      WHERE n.nspname = $1 AND c.relkind IN ('r', 'S')
      ORDER BY c.relname COLLATE "C"`,
    [STATE_SCHEMA],
  );
  /** @type {ContentDigest['tables']} */
  const tables = {};
  /** @type {ContentDigest['sequences']} */
  const sequences = {};
  for (const row of relations.rows) {
    const name = String(row['relname']);
    const relation = `${quoteIdent(STATE_SCHEMA)}.${quoteIdent(name)}`;
    if (row['relkind'] === 'S') {
      const seq = (
        await client.query(
          `SELECT s.last_value::text AS v, s.is_called AS c, p.seqincrement::text AS i
             FROM ${relation} AS s, pg_catalog.pg_sequence AS p WHERE p.seqrelid = $1::oid`,
          [row['oid']],
        )
      ).rows[0];
      sequences[name] = {
        lastValue: String(seq?.['v']),
        isCalled: seq?.['c'] === true,
        increment: String(seq?.['i']),
      };
      continue;
    }
    if (BACKUP_STAGING_TABLE.test(name)) continue;
    const columns = await client.query(
      `SELECT attname, pg_catalog.format_type(atttypid, atttypmod) AS t, attnotnull
         FROM pg_catalog.pg_attribute
        WHERE attrelid = $1::oid AND attnum > 0 AND NOT attisdropped
        ORDER BY attnum`,
      [row['oid']],
    );
    const content = (
      await client.query(
        `SELECT coalesce(sum(n), 0)::text AS rows,
                encode(pg_catalog.sha256(coalesce(
                  string_agg(pg_catalog.set_byte('\\x00'::bytea, 0, k) || b, ''::bytea ORDER BY k),
                  ''::bytea)), 'hex') AS sha
           FROM (SELECT pg_catalog.get_byte(h, 0) AS k, count(*) AS n,
                        pg_catalog.sha256(string_agg(h, ''::bytea ORDER BY h)) AS b
                   FROM (SELECT pg_catalog.sha256(convert_to(t::text, 'UTF8')) AS h FROM ${relation} AS t) AS s0
                  GROUP BY 1) AS s1`,
      )
    ).rows[0];
    tables[name] = {
      columns: columns.rows.map((c) => [
        String(c['attname']),
        String(c['t']),
        c['attnotnull'] === true,
      ]),
      rows: String(content?.['rows']),
      sha256: String(content?.['sha']),
    };
  }
  const led = (
    await client.query(
      `SELECT count(*)::text AS rows,
              encode(pg_catalog.sha256(convert_to(coalesce(string_agg(
                ROW(version, name, checksum, applied_at, applied_by)::text, E'\\n' ORDER BY version), ''),
                'UTF8')), 'hex') AS sha
         FROM ${ledgerRelation}`,
    )
  ).rows[0];
  /** @type {Omit<ContentDigest, 'sha256'>} */
  const body = {
    format: CONTENT_DIGEST_FORMAT,
    version: CONTENT_DIGEST_VERSION,
    canonicalization: { settings: { ...DIGEST_SETTINGS }, row: DIGEST_ROW_RULE },
    scope: /** @type {Record<string, unknown>} */ (JSON.parse(JSON.stringify(DIGEST_SCOPE))),
    tables,
    sequences,
    ledger: { rows: String(led?.['rows']), sha256: String(led?.['sha']) },
  };
  return { ...body, sha256: digestBodySha256(body) };
}

/**
 * يفحصُ بصمةً مقروءةً من البيان. الغيابُ (‏`undefined`) ليس خطأً هنا — نسخةٌ قديمةٌ يقرّرُ المستهلكُ أمرَها.
 * صيغةٌ أو إصدارٌ غيرُ معروفَين ⇒ `BACKUP_DIGEST_UNSUPPORTED`؛ بنيةٌ ناقصةٌ أو بصمةٌ عليا لا تطابقُ
 * محتواها ⇒ `BACKUP_DIGEST_INVALID`. (‏الفحصُ الذاتيُّ يكشفُ التلفَ لا التزوير — البيانُ غيرُ موقَّع.)
 * @param {unknown} raw
 * @returns {ContentDigest | undefined}
 */
export function validateContentDigest(raw) {
  if (raw === undefined) return undefined;
  const invalid = (/** @type {string} */ why) =>
    new BackupError(BACKUP_ERRORS.DIGEST_INVALID, `بصمةُ المحتوى في البيان تالفة: ${why}.`);
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw invalid('ليست كائناً');
  const d = /** @type {Record<string, unknown>} */ (raw);
  if (d['format'] !== CONTENT_DIGEST_FORMAT || d['version'] !== CONTENT_DIGEST_VERSION) {
    throw new BackupError(
      BACKUP_ERRORS.DIGEST_UNSUPPORTED,
      `صيغةُ بصمةِ المحتوى ${JSON.stringify(d['format'])} بالإصدار ${JSON.stringify(d['version'])} غيرُ مدعومة (‏المدعوم ${CONTENT_DIGEST_FORMAT} v${CONTENT_DIGEST_VERSION}) — لا تحقّقَ ممكن، فلا استعادة.`,
    );
  }
  const hex = (/** @type {unknown} */ v) => typeof v === 'string' && /^[0-9a-f]{64}$/.test(v);
  const count = (/** @type {unknown} */ v) => typeof v === 'string' && /^(0|[1-9][0-9]*)$/.test(v);
  const isObj = (/** @type {unknown} */ v) =>
    typeof v === 'object' && v !== null && !Array.isArray(v);
  if (!hex(d['sha256'])) throw invalid('البصمةُ العليا ليست sha256');
  if (!isObj(d['tables']) || !isObj(d['sequences']) || !isObj(d['ledger'])) {
    throw invalid('الجداولُ أو المتسلسلاتُ أو الدفترُ ناقص');
  }
  for (const [name, t] of Object.entries(/** @type {Record<string, any>} */ (d['tables']))) {
    if (
      !isObj(t) ||
      !hex(t.sha256) ||
      !count(t.rows) ||
      !Array.isArray(t.columns) ||
      !t.columns.every(
        (/** @type {unknown} */ c) =>
          Array.isArray(c) &&
          c.length === 3 &&
          typeof c[0] === 'string' &&
          typeof c[1] === 'string' &&
          typeof c[2] === 'boolean',
      )
    ) {
      throw invalid(`مُدخلةُ الجدول ${name}`);
    }
  }
  for (const [name, s] of Object.entries(/** @type {Record<string, any>} */ (d['sequences']))) {
    if (
      !isObj(s) ||
      typeof s.lastValue !== 'string' ||
      !/^-?[0-9]+$/.test(s.lastValue) ||
      typeof s.increment !== 'string' ||
      !/^-?[1-9][0-9]*$/.test(s.increment) ||
      typeof s.isCalled !== 'boolean'
    ) {
      throw invalid(`مُدخلةُ المتسلسلة ${name}`);
    }
  }
  const ledger = /** @type {Record<string, unknown>} */ (d['ledger']);
  if (!hex(ledger['sha256']) || !count(ledger['rows'])) throw invalid('مُدخلةُ الدفتر');
  const { sha256: claimed, ...body } = d;
  if (digestBodySha256(/** @type {Omit<ContentDigest, 'sha256'>} */ (body)) !== claimed) {
    throw invalid('البصمةُ العليا لا تطابقُ محتواها');
  }
  return /** @type {ContentDigest} */ (raw);
}

/**
 * فروقُ بصمتَين ضمنَ النطاق — مصفوفةٌ فارغةٌ = تطابق. الأسماءُ وحدَها، بلا قيم.
 * @param {ContentDigest} expected
 * @param {ContentDigest} actual
 * @returns {string[]}
 */
export function contentDigestDifferences(expected, actual) {
  /** @type {string[]} */
  const out = [];
  const names = (/** @type {Record<string, unknown>} */ o) => Object.keys(o);
  for (const [
    kind,
    a,
    b,
  ] of /** @type {Array<[string, Record<string, unknown>, Record<string, unknown>]>} */ ([
    ['table', expected.tables, actual.tables],
    ['sequence', expected.sequences, actual.sequences],
  ])) {
    for (const n of new Set([...names(a), ...names(b)])) {
      if (!(n in a)) out.push(`${kind} ${n}: غيرُ موجودٍ في النسخة`);
      else if (!(n in b)) out.push(`${kind} ${n}: غائبٌ عن المستعاد`);
      else if (canonicalJson(a[n]) !== canonicalJson(b[n])) {
        const ea = /** @type {Record<string, unknown>} */ (a[n]);
        const eb = /** @type {Record<string, unknown>} */ (b[n]);
        if (kind === 'sequence') {
          const why = sequenceRegression(
            /** @type {ContentDigest['sequences'][string]} */ (ea),
            /** @type {ContentDigest['sequences'][string]} */ (eb),
          );
          if (why !== undefined) out.push(`${kind} ${n}: ${why}`);
          continue;
        }
        const parts = Object.keys(ea).filter((k) => canonicalJson(ea[k]) !== canonicalJson(eb[k]));
        out.push(`${kind} ${n}: ${parts.join('+')}`);
      }
    }
  }
  if (canonicalJson(expected.ledger) !== canonicalJson(actual.ledger)) out.push('ledger');
  if (
    canonicalJson(expected.canonicalization) !== canonicalJson(actual.canonicalization) ||
    canonicalJson(expected.scope) !== canonicalJson(actual.scope)
  ) {
    out.push('canonicalization/scope');
  }
  return out;
}

/**
 * المتسلسلاتُ خارجَ MVCC: `pg_dump` يقرأُ قيمتَها **خارجَ اللقطة** (‏بعدَ البصمة)، فكاتبٌ متزامنٌ
 * يجعلُ المساواةَ مستحيلةً ضمناً (‏مقيسٌ: اختبارا `WL-398`/`WL-586` فشلا بالمساواة). القاعدةُ المعلَنة:
 * الزيادةُ نفسُها، والقيمةُ التاليةُ في المستعادِ **ليست خلفَ** المقروءةِ في اللقطة باتّجاهِ الزيادة — وهو
 * ما يمنعُ تصادمَ مفاتيحَ مع صفوفٍ مُستعادة. لا يكشفُ متسلسلةً تقدّمت زيادةً؛ و`setval` تراجعيٌّ أثناءَ
 * النسخِ يُرفَضُ (‏إنذارٌ كاذبٌ آمنُ الاتّجاه: لا `RESTORE_OK`).
 * @param {ContentDigest['sequences'][string]} expected
 * @param {ContentDigest['sequences'][string]} actual
 * @returns {string | undefined}
 */
function sequenceRegression(expected, actual) {
  if (expected.increment !== actual.increment) return 'increment';
  const step = BigInt(expected.increment);
  const next = (/** @type {ContentDigest['sequences'][string]} */ s) =>
    s.isCalled ? BigInt(s.lastValue) + step : BigInt(s.lastValue);
  const behind = step > 0n ? next(actual) < next(expected) : next(actual) > next(expected);
  return behind ? 'behind snapshot' : undefined;
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
    /** @type {ContentDigest | undefined} */
    let contentDigest;
    let contentDigestMs = 0;
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
      await assertStagedLedgerMatchesSnapshot(client, ledgerStagingTable);
      snapshot = await inspectDatabase(client);
      // ‏`WL-606`: البصمةُ على **هذا العميلِ في هذه المعاملة** — اللقطةُ نفسُها التي يقرؤها `pg_dump`
      // بـ`--snapshot` أدناه؛ فلا نافذةَ بينَ ما تصفُه وما في الأرشيف. فشلُها ⇒ لا `pg_dump` ولا بيان.
      const digestStarted = process.hrtime.bigint();
      try {
        contentDigest = await computeContentDigest(
          client,
          `public.${quoteIdent(MIGRATION_LEDGER)}`,
        );
      } catch (error) {
        throw new BackupError(
          BACKUP_ERRORS.DIGEST_FAILED,
          `تعذّرَ حسابُ بصمةِ المحتوى داخلَ لقطةِ النسخ: ${error instanceof Error ? error.message : String(error)} — لا نسخةَ تُكتَب.`,
        );
      }
      contentDigestMs = Number((process.hrtime.bigint() - digestStarted) / 1_000_000n);
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
      // ‏`WL-594`: جدولٌ مرحليٌّ آخرُ مُلتزَمٌ في `state` (‏متروكٌ من نسخٍ انقطعَ، أو لنسخٍ
      // متزامنٍ لم يحذفْه بعد) كانَ يدخلُ الحاويةَ مع `--schema state`، والعدّاداتُ تستثنيه،
      // فتنجحُ `create` و`verify` وتسقطُ الاستعادةُ بـ`RESTORE_ROW_COUNT_MISMATCH` — نسخةٌ
      // «سليمةٌ» لا تُستعاد. يُقرأُ من اللقطةِ نفسِها التي يقرؤها `pg_dump` فيُستثنى بعينِه؛ ولا
      // يُحذَف: قد يكونُ لنسخٍ حيّ، وحذفُه قرارُ المشغِّل. ويُسمّى على stderr ليُرى ويُزال.
      const foreignStaging = (await stateTables(client)).filter(
        (name) => BACKUP_STAGING_TABLE.test(name) && name !== ledgerStagingTable,
      );
      const excludeArgs = foreignStaging.flatMap((name) => [
        '--exclude-table',
        `${quoteIdent(STATE_SCHEMA)}.${quoteIdent(name)}`,
      ]);
      for (const name of foreignStaging) {
        console.error(
          `⚠️ [BACKUP_STAGING_EXCLUDED] ${STATE_SCHEMA}.${name}: جدولٌ مرحليٌّ ليس لهذا النسخ — استُثنيَ من النسخةِ ولم يُحذَف؛ إن لم يكنْ نسخٌ آخرُ جارياً فأزِلْه يدوياً.`,
        );
      }
      result = await run(dumpTool, [
        '--format=custom',
        '--file',
        dumpPath,
        '--schema',
        STATE_SCHEMA,
        ...fenceSchemaArgs,
        ...excludeArgs,
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
      contentDigestMs,
      contentDigest,
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
    // ‏`WL-606`: بصمةٌ حاضرةٌ تُفحَصُ هنا (‏تالفةٌ أو إصدارٌ غيرُ مدعوم ⇒ خطأٌ مسمّى)، وغيابُها يُترَكُ للمستهلك.
    validateContentDigest(/** @type {Record<string, unknown>} */ (parsed)['contentDigest']);
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
 *
 * ‏`WL-615` (‏`LIVE-78/VERIFY-CLI-TOCTOU`): كانَ يحسبُ sha256 على `dumpPath` ثمّ يُشغِّلُ `--list` على
 * **المسارِ نفسِه** قراءةً ثانية، فكاتبٌ متزامنٌ يُبدِّلُ الملفَّ بينَهما (‏في مكانِه، الـinode نفسُه) يُنتِجُ
 * `[BACKUP_OK]` ببصمةِ الأصلِ لأرشيفٍ آخرَ فُحِصَ (‏مقيسٌ في `WL-614`). الآن يمرُّ عبرَ
 * `snapshotVerifiedArchive` نفسِها: البصمةُ و`--list` على البايتاتِ المنسوخةِ ذاتِها، ثمّ تُزالُ النسخة.
 * **ما يعنيه `[BACKUP_OK]` بعدَه:** أنّ بايتاتٍ قُرِئَت من `dumpPath` مرّةً واحدةً طابقت البيانَ وقرأَها
 * `pg_restore`؛ لا أنّ الملفَّ باقٍ كذلك بعدَ الأمر — من يكتبُ عليه لاحقاً يكتب، والاستعادةُ تتحقّقُ من
 * جديدٍ على نسختِها. والكلفةُ مساحةٌ مؤقّتةٌ بحجمِ الأرشيفِ وكتابتُه مرّةً.
 * @param {string} dumpPath
 * @returns {Promise<BackupManifest>}
 */
export async function verifyBackup(dumpPath) {
  const verified = await snapshotVerifiedArchive(dumpPath);
  verified.cleanup();
  return verified.manifest;
}

/**
 * @typedef {object} VerifiedArchive
 * @property {BackupManifest} manifest البيانُ كما قُرِئَ مرّةً واحدةً وتُحقِّقَ منه.
 * @property {string} archivePath نسخةٌ خاصّةٌ بايتاتُها هي ما حُسِبَ sha256 عليه.
 * @property {() => void} cleanup يُزيلُ النسخةَ الخاصّةَ ومجلّدَها (‏آمنٌ للتكرار).
 */

/**
 * ‏`WL-614` (‏`LIVE-78/ARCHIVE-TOCTOU`): يأخذُ نسخةً خاصّةً من الأرشيفِ ويحسبُ sha256 **على البايتاتِ
 * المنسوخةِ نفسِها** في تمريرةٍ واحدة، ثمّ يقارنُها بالبيانِ ويفحصُها بـ`pg_restore --list`.
 *
 * **العيبُ الذي يُغلِقُه:** كانت الاستعادةُ تتحقّقُ من `dumpPath` (‏`verifyBackup`) ثمّ تُسلِّمُ
 * **المسارَ نفسَه** لـ`pg_restore` بعدَ اتّصالاتٍ ومحوٍ محتمل، فيقرأُ الأداةُ الملفَّ من جديد. مَن يكتبُ
 * على مجلّدِ النسخِ في تلك النافذةِ يُبدِّلُ الأرشيفَ — في مكانِه، على الـinode نفسِه — فيُستعادُ ما لم
 * يُتحقَّقْ منه: قادحٌ أو دالّةٌ خارجَ تغطيةِ البصمةِ (‏`LIVE-78/DIGEST-COVERAGE`) يمرُّ `[RESTORE_OK]`
 * و`[CONTENT_VERIFIED]` مع البيانِ **الشرعيِّ** (‏مقيسٌ في `WL-614`). وهذا يُبطِلُ مقدَّماً أيَّ توقيعٍ
 * للبيان: التوقيعُ يُثبِتُ بايتاتٍ لم تَعُدْ هي المستعادة.
 *
 * **ما لا يُغلِقُه (‏مُعلَن):** النسخةُ في `os.tmpdir()` بمجلّدٍ `0700` وملفٍّ `0600` — تحمي من كاتبٍ
 * على مجلّدِ النسخِ لا من عمليّةٍ بالـUID نفسِه أو بصلاحيّةِ الجذر. والكلفةُ مساحةٌ مؤقّتةٌ بحجمِ
 * الأرشيفِ وقراءةٌ إضافيّةٌ له. ولا يُثبِتُ **أصالةَ** البيان (‏ذاك `LIVE-78` بقرارِ المالك)، بل يجعلُ ما
 * يُستعادُ هو ما تحقّقَ منه بايتاً ببايت.
 * @param {string} dumpPath
 * @returns {Promise<VerifiedArchive>}
 */
export async function snapshotVerifiedArchive(dumpPath) {
  if (!fs.existsSync(dumpPath)) {
    throw new BackupError(BACKUP_ERRORS.FILE_MISSING, `ملف النسخة غير موجود: ${dumpPath}`);
  }
  const manifest = readManifest(dumpPath);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xuux-restore-'));
  fs.chmodSync(dir, 0o700);
  const cleanup = () => fs.rmSync(dir, { recursive: true, force: true });
  try {
    const archivePath = path.join(dir, 'archive.dump');
    const hash = crypto.createHash('sha256');
    const source = fs.openSync(dumpPath, 'r');
    try {
      const target = fs.openSync(archivePath, 'wx', 0o600);
      try {
        const buffer = Buffer.allocUnsafe(1 << 20);
        for (;;) {
          const read = fs.readSync(source, buffer, 0, buffer.length, null);
          if (read === 0) break;
          const chunk = buffer.subarray(0, read);
          hash.update(chunk);
          let written = 0;
          while (written < read) written += fs.writeSync(target, chunk, written, read - written);
        }
      } finally {
        fs.closeSync(target);
      }
    } finally {
      fs.closeSync(source);
    }
    const actual = hash.digest('hex');
    if (actual !== manifest.sha256) {
      throw new BackupError(
        BACKUP_ERRORS.HASH_MISMATCH,
        `تجزئة النسخة لا تطابق البيان: المتوقعة ${manifest.sha256} والفعلية ${actual}.`,
      );
    }
    const result = await run(pgRestore(), ['--list', archivePath]);
    if (result.code !== 0) {
      throw new BackupError(
        BACKUP_ERRORS.DUMP_UNREADABLE,
        `pg_restore لا يقرأ النسخة برمز ${result.code}: ${result.stderr.trim()}`,
      );
    }
    return { manifest, archivePath, cleanup };
  } catch (error) {
    cleanup();
    throw error;
  }
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
    console.log(
      manifest.contentDigest === undefined
        ? 'بصمةُ المحتوى [CONTENT_DIGEST_ABSENT]: نسخةٌ قديمةٌ بلا دليلِ محتوى؛ استعادتُها تتطلّبُ --allow-unverified.'
        : `بصمةُ المحتوى [CONTENT_DIGEST_PRESENT] ${manifest.contentDigest.format} v${manifest.contentDigest.version}: ${manifest.contentDigest.sha256}`,
    );
    return;
  }
  const manifest = await createBackup(dumpPath, databaseUrl);
  console.log(`نُسخت القاعدة [BACKUP_CREATED]: ${dumpPath}`);
  console.log(`البيان: ${manifestPathFor(dumpPath)}`);
  console.log(
    `زمن النسخ المقاس: ${manifest.durationMs} مللي ثانية (‏منها بصمةُ المحتوى ${manifest.contentDigestMs}).`,
  );
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
