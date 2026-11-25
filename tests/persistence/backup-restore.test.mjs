/**
 * تمرين النسخ والاستعادة الحقيقي — الخطوة M3.07.
 *
 * لا يكفي هنا اختبار دوال وهمية: يُنشأ مخزنان PostgreSQL معزولان، ثم يمر ملف
 * `pg_dump -Fc` الفعلي إلى `pg_restore` الفعلي. تُقايس البيانات والكتالوج
 * والنسخة بعد العودة كي لا يختبئ فقد قيد أو فهرس خلف نجاح رمز الخروج.
 */

import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { harness } from '../helpers/fence-harness.mjs';
import { registerTmpRoot } from '../helpers/tmp-roots.mjs';
import { up } from '../../src/persistence/migrator.mjs';
import {
  COVERAGE_MATRIX,
  MANIFEST_AUTH_REASONS,
  loadSequenceReference,
  signManifestPrototype,
  verifyManifestPrototype,
  catalogSnapshot,
  coverageDiff,
  coverageProbe,
  createIsolatedDatabase,
  skipWithoutDatabase,
} from '../helpers/pg.mjs';
import { createTestEncryptor } from '../helpers/encryption.mjs';
import {
  CONTENT_DIGEST_FORMAT,
  CONTENT_DIGEST_VERSION,
  DIGEST_SETTINGS,
  canonicalJson,
  computeContentDigest,
  contentDigestDifferences,
  validateContentDigest,
} from '../../scripts/backup.mjs';
import { CONTENT_VERIFICATION, restoreBackup } from '../../scripts/restore.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const BACKUP_SCRIPT = path.join(ROOT, 'scripts/backup.mjs');
const RESTORE_SCRIPT = path.join(ROOT, 'scripts/restore.mjs');
const STATE_SCHEMA = 'state';

/**
 * مهلةُ كلِّ اختبارٍ في هذا الملفّ — `WL-601`. الملفُّ يُشغَّلُ وحدَه بمهلةِ ملفٍّ
 * 240 ث (`test:backup-restore` في `package.json`) لا بمهلةِ الحزمةِ 120 ث، لأنَّ مجموعَ
 * اختباراتِه بلغَ 119.1 ث في CI (‏التشغيلة 45216924161). فمهلةُ الملفِّ الأوسعُ يُقابِلُها حدٌّ
 * أضيقُ لكلِّ اختبار: أطولُ اختبارٍ مقيسٍ في CI ‏10.9 ث، فاختبارٌ معلَّقٌ يَسقطُ باسمِه عند
 * 60 ث بدلاً من أن يستهلكَ مهلةَ الملفِّ كلَّها. كلُّ نداءٍ لـ`test()` هنا يحملُ هذه المهلةَ صراحةً.
 */
const PER_TEST_TIMEOUT_MS = 60_000;

/**
 * @typedef {object} CommandResult
 * @property {number} code
 * @property {string} stdout
 * @property {string} stderr
 */

/**
 * شغّل أداة CLI بلا shell كي تبقى الوسائط بيانات لا أوامر.
 * @param {string[]} args
 * @param {string | undefined} databaseUrl
 * @param {Record<string, string>} [extraEnv] بيئةٌ إضافيّةٌ للعمليّةِ الابنةِ وحدَها (‏`WL-586`).
 * @returns {Promise<CommandResult>}
 */
function runNode(args, databaseUrl, extraEnv = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      env: {
        ...process.env,
        ...(databaseUrl === undefined ? {} : { DATABASE_URL: databaseUrl }),
        ...extraEnv,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
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
    child.on('close', (code) => {
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}

/**
 * @param {string} name
 * @returns {string}
 */
function quoteIdent(name) {
  return `"${name.replace(/"/g, '""')}"`;
}

/**
 * @param {string} database
 * @returns {string}
 */
function databaseUrlFor(database) {
  const base = process.env.DATABASE_URL;
  if (base === undefined) throw new Error('DATABASE_URL غير معلَنة.');
  const url = new URL(base);
  url.pathname = `/${database}`;
  return url.toString();
}

/**
 * بصمة مرتبة للمحتوى. يُستعمل JSONB لأن ترتيب مفاتيحه ثابت، ثم ترتب الصفوف
 * نصياً كي لا يجعل ترتيب التخزين الفيزيائي النتيجة عشوائية.
 * @param {import('pg').Pool} pool
 * @returns {Promise<string>}
 */
async function contentsDigest(pool) {
  const names = await pool.query(
    `SELECT c.relname
     FROM pg_class AS c
     JOIN pg_namespace AS n ON n.oid = c.relnamespace
     WHERE n.nspname = $1 AND c.relkind = 'r'
     ORDER BY c.relname`,
    [STATE_SCHEMA],
  );
  const hash = crypto.createHash('sha256');
  for (const row of names.rows) {
    const name = String(/** @type {Record<string, unknown>} */ (row)['relname']);
    const rows = await pool.query(
      `SELECT to_jsonb(t)::text AS row
       FROM ${quoteIdent(STATE_SCHEMA)}.${quoteIdent(name)} AS t
       ORDER BY to_jsonb(t)::text`,
    );
    hash.update(`${name}\n`, 'utf8');
    for (const item of rows.rows) {
      hash.update(`${String(/** @type {Record<string, unknown>} */ (item)['row'])}\n`, 'utf8');
    }
  }
  return hash.digest('hex');
}

/**
 * @param {import('pg').Pool} pool
 * @returns {Promise<boolean>}
 */
async function fenceSchemaPresent(pool) {
  const r = await pool.query(`SELECT to_regnamespace('fence') IS NOT NULL AS present`);
  return /** @type {Record<string, unknown>} */ (r.rows[0])['present'] === true;
}

/**
 * ‏`WL-597`/`WL-599`: صورةُ الهدفِ لإثباتِ أنّ الرفضَ لم يمسَّه. **ما تقيسُه بالضبط:** الكتالوجُ
 * (‏`catalogSnapshot` مع الدوالِّ وقوادحِ الأحداث)، ومحتوى `state` (‏`contentsDigest`)، والدفتر،
 * وقوادحُ الجداولِ غيرُ الداخليّة، وصلاحيّاتُ المخطّطات، وبصمةُ كلِّ جدولٍ في `fence`؛ ومنذُ `WL-599`
 * أيضاً: **بصمةُ محتوى كلِّ جدولٍ عاديٍّ أو مقسَّمٍ في كلِّ مخطّطٍ غيرِ نظاميٍّ** (‏`public` وغيرُه خارجَ
 * `state` و`fence`)، و**قيمُ المتسلسلات** (‏`last_value` من `pg_sequences`، وهو NULL قبلَ أوّلِ `nextval`)، و**صلاحيّاتُ الجداولِ
 * والمتسلسلاتِ والأعمدةِ والدوالِّ ومالكوها** والصلاحيّاتُ الافتراضيّة، و**صلاحيّاتُ قاعدةِ البياناتِ
 * ومالكُها وحدُّ اتصالاتِها**، و**عضويّاتُ الأدوارِ وسماتُ الأدوار** (‏على مستوى العنقود؛ الملفُّ
 * يجري تتابعيّاً `--test-concurrency=1`، فلا كاتبَ آخرَ لها أثناءَ الاختبار).
 * **وما لا تقيسُه:** الكائناتُ الكبيرة (‏`pg_largeobject`)، وإعداداتُ القاعدةِ والدورِ
 * (‏`pg_db_role_setting`)، والتعليقاتُ والوسومُ الأمنيّة، والنشرُ والاشتراك، والإحصاءات، وما خارجَ
 * هذه القاعدةِ غيرَ الأدوار. ‏`omitSchema` يُسقِطُ مخطّطاً من الصورةِ وحدَه (‏تداخلٌ يُنشئُه عمداً).
 * @param {import('pg').Pool} pool
 * @param {{ omitSchema?: string }} [options]
 * @returns {Promise<string>}
 */
async function targetImage(pool, options = {}) {
  const catalog = JSON.parse(await catalogSnapshot(pool, { routines: true }));
  if (options.omitSchema !== undefined) {
    catalog.schemas = catalog.schemas.filter(
      (/** @type {{ nspname: string }} */ row) => row.nspname !== options.omitSchema,
    );
  }
  const rows = async (/** @type {string} */ sql) => (await pool.query(sql)).rows;
  const ledger = (await rows(`SELECT to_regclass('public.schema_migrations') IS NOT NULL AS l`))[0]
    .l
    ? await rows('SELECT to_jsonb(m)::text AS m FROM public.schema_migrations m ORDER BY 1')
    : null;
  /** @type {Record<string, string> | null} */
  let fence = null;
  if (options.omitSchema !== 'fence' && (await fenceSchemaPresent(pool))) {
    fence = {};
    // كلُّ جداولِ `fence` بمحتواها (‏التحكّمُ والأحداثُ والقائمةُ والاعتمادات…): رفضٌ يكتبُ حدثاً يظهرُ هنا.
    for (const { t } of await rows(
      `SELECT c.relname::text AS t FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'fence' AND c.relkind = 'r' ORDER BY 1`,
    )) {
      const [{ d }] = await rows(
        `SELECT md5(coalesce(string_agg(to_jsonb(x)::text, E'\\n' ORDER BY to_jsonb(x)::text), '')) AS d
         FROM fence.${quoteIdent(t)} x`,
      );
      fence[t] = d;
    }
  }
  return JSON.stringify({
    catalog,
    contents: await contentsDigest(pool),
    ledger,
    triggers: await rows(
      `SELECT tgrelid::regclass::text AS rel, tgname, tgenabled FROM pg_trigger
       WHERE NOT tgisinternal ORDER BY 1, 2`,
    ),
    acl: (
      await rows(
        `SELECT nspname, coalesce(nspacl::text, '') AS acl FROM pg_namespace
         WHERE nspname NOT LIKE 'pg\\_%' ORDER BY 1`,
      )
    ).filter((row) => row.nspname !== options.omitSchema),
    fence,
    // ‏`WL-599`: ما وراءَ `state` و`fence`.
    tables: await userTableDigests(pool, options.omitSchema),
    sequences: (
      await rows(
        `SELECT schemaname::text AS s, sequencename::text AS q, last_value::text AS v
         FROM pg_sequences ORDER BY 1, 2`,
      )
    ).filter((row) => row.s !== options.omitSchema),
    relacl: (
      await rows(
        `SELECT n.nspname::text AS s, c.relname::text AS r, c.relkind::text AS k,
                pg_get_userbyid(c.relowner)::text AS owner, coalesce(c.relacl::text, '') AS acl,
                coalesce((SELECT string_agg(a.attname || '=' || a.attacl::text, ',' ORDER BY a.attnum)
                          FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attacl IS NOT NULL), '') AS cols
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname NOT LIKE 'pg\\_%' AND n.nspname <> 'information_schema'
           AND c.relkind IN ('r', 'p', 'S', 'v', 'm', 'f')
         ORDER BY 1, 2`,
      )
    ).filter((row) => row.s !== options.omitSchema),
    proacl: (
      await rows(
        `SELECT n.nspname::text AS s, p.oid::regprocedure::text AS f,
                pg_get_userbyid(p.proowner)::text AS owner, coalesce(p.proacl::text, '') AS acl
         FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname NOT LIKE 'pg\\_%' AND n.nspname <> 'information_schema'
         ORDER BY 1, 2`,
      )
    ).filter((row) => row.s !== options.omitSchema),
    defacl: await rows(
      `SELECT pg_get_userbyid(defaclrole)::text AS role, coalesce(defaclnamespace::regnamespace::text, '') AS s,
              defaclobjtype::text AS t, defaclacl::text AS acl
       FROM pg_default_acl ORDER BY 1, 2, 3`,
    ),
    database: await rows(
      `SELECT pg_get_userbyid(datdba)::text AS owner, coalesce(datacl::text, '') AS acl,
              datconnlimit AS lim, datallowconn AS allow
       FROM pg_database WHERE datname = current_database()`,
    ),
    memberships: await rows(
      `SELECT r.rolname::text AS role, m.rolname::text AS member, g.rolname::text AS grantor,
              am.admin_option AS a, am.inherit_option AS i, am.set_option AS st
       FROM pg_auth_members am
       JOIN pg_roles r ON r.oid = am.roleid
       JOIN pg_roles m ON m.oid = am.member
       JOIN pg_roles g ON g.oid = am.grantor
       ORDER BY 1, 2, 3`,
    ),
    roles: await rows(
      `SELECT rolname::text AS n, rolsuper AS su, rolinherit AS inh, rolcreaterole AS cr,
              rolcreatedb AS cd, rolcanlogin AS li, rolreplication AS rp, rolbypassrls AS br,
              rolconnlimit AS cl
       FROM pg_roles WHERE rolname NOT LIKE 'pg\\_%' ORDER BY 1`,
    ),
  });
}

/**
 * ‏`WL-599`: بصمةُ محتوى كلِّ جدولٍ عاديٍّ أو مقسَّمٍ في كلِّ مخطّطٍ غيرِ نظاميّ (‏صفوفٌ مرتّبةٌ بـJSONB).
 * @param {import('pg').Pool} pool
 * @param {string | undefined} omitSchema
 * @returns {Promise<Record<string, string>>}
 */
async function userTableDigests(pool, omitSchema) {
  const names = await pool.query(
    `SELECT n.nspname::text AS s, c.relname::text AS t
     FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname NOT LIKE 'pg\\_%' AND n.nspname <> 'information_schema'
       AND c.relkind IN ('r', 'p') AND NOT c.relispartition
     ORDER BY 1, 2`,
  );
  /** @type {Record<string, string>} */
  const out = {};
  for (const row of names.rows) {
    const { s, t } = /** @type {{ s: string, t: string }} */ (row);
    if (s === omitSchema) continue;
    const r = await pool.query(
      `SELECT count(*)::int AS n,
              md5(coalesce(string_agg(to_jsonb(x)::text, E'\\n' ORDER BY to_jsonb(x)::text), '')) AS d
       FROM ${quoteIdent(s)}.${quoteIdent(t)} x`,
    );
    const d = /** @type {Record<string, unknown>} */ (r.rows[0]);
    out[`${s}.${t}`] = `${String(d['n'])}:${String(d['d'])}`;
  }
  return out;
}

/**
 * ‏`WL-597`: ينتظرُ أن تقفَ جلسةٌ على الهدفِ عندَ قفل (‏`wait_event_type = 'Lock'`) وهي تُنفّذُ ما
 * يطابقُ `pattern`. التداخلُ يُثبَّتُ برصدِ الانتظارِ لا بمهلة؛ والحدُّ الزمنيُّ لكشفِ التعليقِ وحدَه.
 * @param {import('pg').Pool} pool
 * @param {string} database
 * @param {string} pattern
 * @param {number[]} [excludePids]
 * @returns {Promise<boolean>}
 */
async function waitForLockWait(pool, database, pattern, excludePids = []) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const r = await pool.query(
      `SELECT 1 FROM pg_stat_activity
       WHERE datname = $1 AND wait_event_type = 'Lock' AND query LIKE $2 AND NOT (pid = ANY($3::int[]))`,
      [database, pattern, excludePids],
    );
    if ((r.rowCount ?? 0) > 0) return true;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return false;
}

/**
 * @param {import('pg').Pool} pool
 * @returns {Promise<Record<string, number>>}
 */
async function stateRowCounts(pool) {
  const names = await pool.query(
    `SELECT c.relname
     FROM pg_class AS c
     JOIN pg_namespace AS n ON n.oid = c.relnamespace
     WHERE n.nspname = $1 AND c.relkind = 'r'
     ORDER BY c.relname`,
    [STATE_SCHEMA],
  );
  /** @type {Record<string, number>} */
  const counts = {};
  for (const row of names.rows) {
    const name = String(/** @type {Record<string, unknown>} */ (row)['relname']);
    const count = await pool.query(
      `SELECT count(*)::integer AS count FROM ${quoteIdent(STATE_SCHEMA)}.${quoteIdent(name)}`,
    );
    counts[name] = Number(/** @type {Record<string, unknown>} */ (count.rows[0])['count']);
  }
  return counts;
}

/**
 * أدخل صفاً صحيحاً في كل جدول، لا في جدول واحد فقط، لأن العلاقات والأنماط
 * والفهارس لا يبرهن عليها محتوى أحادي بسيط.
 * @param {import('pg').Pool} pool
 * @returns {Promise<void>}
 */
async function seedEveryTable(pool) {
  const encryption = await createTestEncryptor();
  try {
    await pool.query(
      `INSERT INTO state.agents (id, name, kind, status, capabilities, role, owner, certificate)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)`,
      [
        'agent-001',
        'Agent One',
        'service',
        'active',
        ['backup'],
        'operator',
        'owner-001',
        JSON.stringify({ issuer: 'test' }),
      ],
    );
    await pool.query(
      `INSERT INTO state.models (id, name, provider, purpose, fingerprint, status, model_version)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      ['model-001', 'Model One', 'internal', 'operations', 'a'.repeat(64), 'registered', '1.0.0'],
    );
    await pool.query(
      `INSERT INTO state.events (event_id, type, actor, payload, hash, occurred_at)
     VALUES ($1, $2, $3, $4::jsonb, $5, now())`,
      [
        'event-001',
        'backup.created',
        'agent-001',
        JSON.stringify({ source: 'test' }),
        'b'.repeat(64),
      ],
    );
    await pool.query(
      `INSERT INTO state.commands (id, nonce, issued_by, kind, state, payload)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
      [
        'command-001',
        'nonce-123456',
        'agent-001',
        'backup',
        'claimed',
        JSON.stringify({ restore: true }),
      ],
    );
    await pool.query(
      `INSERT INTO state.laws (id, title, body, status, scope, proposer)
     VALUES ($1, $2, $3, $4, $5, $6)`,
      ['law-001', 'Backup Law', 'A test law.', 'draft', 'testing', 'agent-001'],
    );
    await pool.query(
      // `claimant` و`claim` عمودان **إلزاميان** أضافتهما هجرةُ مسار الدعوى
      // (`0012`): دعوى بلا مُدَّعٍ ولا مطلبٍ دعوى لا يُعرف من رفعها ولا بماذا.
      // كان هذا التمهيدُ يُخفق بـ`23502` من يومِ تلك الهجرة، ولم يظهر لأن
      // اختبارات القاعدة كانت متخطّاةً دائماً (`WL-045`).
      `INSERT INTO state.cases (id, law_id, subject, state, claimant, claim)
     VALUES ($1, $2, $3, $4, $5, $6)`,
      ['case-001', 'law-001', 'agent-001', 'opened', 'agent-001', 'مطلبُ تمهيدٍ لتمرين النسخ.'],
    );
    await pool.query(
      `INSERT INTO state.policies (id, name, effect, resource, action, law_id)
     VALUES ($1, $2, $3, $4, $5, $6)`,
      ['policy-001', 'Backup policy', 'allow', 'backup', 'read', 'law-001'],
    );
    await pool.query(
      `INSERT INTO state.quotas (id, subject_type, subject_id, resource, limit_value, window_seconds)
     VALUES ($1, $2, $3, $4, $5, $6)`,
      ['quota-001', 'agent', 'agent-001', 'backup', 10, 60],
    );
    await pool.query(
      `INSERT INTO state.data_assets (id, name, classification, owner, retention_days, source)
     VALUES ($1, $2, $3, $4, $5, $6)`,
      ['asset-001', 'Backup Asset', 'internal', 'agent-001', 30, 'integration-test'],
    );
    await pool.query(
      // تاريخ الانتهاء إلزامي بعد الترحيل `0008` (‏M7.05): مدخلٌ بلا انتهاء ولا
      // حفظٍ قانوني يرفضه القيد `memories_expiry_required`، فالنسخة تُؤخذ لصفٍّ
      // مشروع لا لصفٍّ ما كان ليُكتب.
      // المحتوى **مغلَّفٌ فعلاً** بالمغلِّف نفسه لا بشكلٍ مصطنعٍ يُشبه المغلَّف:
      // هجرةُ التشفير (`0006`) تفرض `memories_content_sealed`، وكان هذا التمهيدُ
      // يكتب نصّاً صريحاً فيُخفق من يومِ تلك الهجرة — لم يظهر لأن اختبارات القاعدة
      // كانت متخطّاةً دائماً (`WL-045`). ولو أُغلق بشكلٍ مُخترعٍ لصار التمرينُ
      // يستعيد ما لا يُفكّ، وهو نسخةٌ لا تُستعاد.
      `INSERT INTO state.memories (id, agent_id, kind, content, tags, dataset_id, expires_at)
     VALUES ($1, $2, $3, $4::jsonb, $5, $6, now() + interval '30 days')`,
      [
        'memory-001',
        'agent-001',
        'episodic',
        JSON.stringify(
          await encryption.encryptor.seal({
            value: { action: 'backup' },
            classification: 'internal',
            binding: { id: 'memory-001', agentId: 'agent-001', datasetId: 'asset-001' },
          }),
        ),
        ['backup'],
        'asset-001',
      ],
    );
  } finally {
    // مادةُ المفاتيح المؤقّتة تُزال دائماً: التمرين يقيس النسخَ والاستعادة لا
    // يترك مفاتيحَ على القرص.
    encryption.cleanup();
  }
}

test(
  'استعادة فعلية إلى قاعدة نظيفة تعيد المحتوى والكتالوج والنسخة وتطبع الزمن',
  { skip: skipWithoutDatabase, timeout: PER_TEST_TIMEOUT_MS },
  async () => {
    const source = await createIsolatedDatabase('backsrc');
    const target = await createIsolatedDatabase('backdst');
    const dump = path.join(
      registerTmpRoot(fs.mkdtempSync(path.join(os.tmpdir(), 'backup-restore-'))),
      'state.dump',
    );
    try {
      await up(source.pool);
      await seedEveryTable(source.pool);
      const sourceUrl = databaseUrlFor(source.name);
      const expectedCounts = await stateRowCounts(source.pool);
      const expectedDigest = await contentsDigest(source.pool);
      const expectedCatalog = await catalogSnapshot(source.pool);
      const expectedVersion = await source.pool.query(
        'SELECT max(version)::integer AS version FROM public.schema_migrations',
      );
      const migrationVersion = Number(
        /** @type {Record<string, unknown>} */ (expectedVersion.rows[0])['version'],
      );

      const serverVersion = await source.pool.query('SHOW server_version');

      // `WL-595`: لا استعلامان متداخلان على عميلٍ واحد (‏‏`pg@9` يُزيلُ الطابورَ الداخليّ).
      // دليلان في العمليّةِ الابنةِ وحدَها، والإنتاجُ بلا تعديل:
      // ١. `--throw-deprecation`: إشارةُ `pg` نفسِها فشلاً — لكنّها لا تنطلقُ إلا والطابورُ
      //    غيرُ فارغ، أي من الاستعلامِ الثالثِ المتزامن؛ فاستعلامان متداخلان ينجوان منها.
      // ٢. مُحمَّلٌ مسبقٌ يرفضُ `query()` وعلى العميلِ استعلامٌ نشِطٌ أو منتظِر. في مسارِ
      //    النجاحِ يُحَلُّ وعدُ الاستعلامِ بعدَ تصفيرِ النشِط (‏`_handleReadyForQuery`)، فالتتابعُ
      //    لا يُرفَض؛ ومسارُ الخطأ (‏يُحَلُّ قبلَ `ReadyForQuery`) خارجَ هذا الاختبار.
      //    وإن تغيّرت بنيةُ `pg` الداخليّةُ رسبَ صراحةً لا صامتاً.
      const overlapDetector = path.join(path.dirname(dump), 'reject-overlapping-queries.mjs');
      fs.writeFileSync(
        overlapDetector,
        [
          "import { createRequire } from 'node:module';",
          `const require = createRequire(${JSON.stringify(path.join(ROOT, 'package.json'))});`,
          "const pg = require('pg');",
          'const original = pg.Client.prototype.query;',
          'pg.Client.prototype.query = function (...args) {',
          "  if (!Array.isArray(this._queryQueue) || !('_activeQuery' in this)) {",
          "    throw new Error('XUUX_OVERLAP_DETECTOR_INCOMPATIBLE');",
          '  }',
          '  if (this._activeQuery != null || this._queryQueue.length > 0) {',
          "    throw new Error('XUUX_OVERLAPPING_QUERY');",
          '  }',
          '  return original.apply(this, args);',
          '};',
          '',
        ].join('\n'),
      );
      const backup = await runNode([BACKUP_SCRIPT, 'create', dump], sourceUrl, {
        NODE_OPTIONS:
          `${process.env['NODE_OPTIONS'] ?? ''} --throw-deprecation --import ${overlapDetector}`.trim(),
      });
      assert.equal(backup.code, 0, backup.stderr);
      assert.doesNotMatch(backup.stderr, /DeprecationWarning|XUUX_OVERLAP/);
      assert.match(backup.stdout, /زمن النسخ المقاس: \d+ مللي ثانية/);
      const manifest = JSON.parse(fs.readFileSync(`${dump}.manifest.json`, 'utf8'));
      assert.deepEqual(manifest.rowCounts, expectedCounts);
      assert.equal(manifest.migrationVersion, migrationVersion);
      assert.equal(
        manifest.databaseVersion,
        String(/** @type {Record<string, unknown>} */ (serverVersion.rows[0])['server_version']),
      );

      const restore = await runNode([RESTORE_SCRIPT, dump, '--database', target.name], sourceUrl);
      assert.equal(restore.code, 0, restore.stderr);
      assert.match(restore.stdout, /زمن الاستعادة المقاس: \d+ مللي ثانية/);
      assert.deepEqual(await stateRowCounts(target.pool), expectedCounts);
      assert.equal(await contentsDigest(target.pool), expectedDigest);
      assert.equal(await catalogSnapshot(target.pool), expectedCatalog);
      const version = await target.pool.query(
        'SELECT max(version)::integer AS version FROM public.schema_migrations',
      );
      assert.equal(
        Number(/** @type {Record<string, unknown>} */ (version.rows[0])['version']),
        migrationVersion,
      );
    } finally {
      await target.drop();
      await source.drop();
    }
  },
);

test(
  'الاستعادة فوق قاعدة مشغولة ترفض بلا --force ولا تغيّرها',
  { skip: skipWithoutDatabase, timeout: PER_TEST_TIMEOUT_MS },
  async () => {
    const source = await createIsolatedDatabase('busysrc');
    const busy = await createIsolatedDatabase('busydst');
    const dump = path.join(
      registerTmpRoot(fs.mkdtempSync(path.join(os.tmpdir(), 'backup-busy-'))),
      'state.dump',
    );
    try {
      await up(source.pool);
      await seedEveryTable(source.pool);
      await up(busy.pool);
      const sourceUrl = databaseUrlFor(source.name);
      const backup = await runNode([BACKUP_SCRIPT, 'create', dump], sourceUrl);
      assert.equal(backup.code, 0, backup.stderr);
      const before = await catalogSnapshot(busy.pool);

      const restore = await runNode([RESTORE_SCRIPT, dump, '--database', busy.name], sourceUrl);
      assert.equal(restore.code, 1);
      assert.match(restore.stderr, /\[RESTORE_TARGET_NOT_CLEAN\]/);
      assert.equal(await catalogSnapshot(busy.pool), before);
    } finally {
      await busy.drop();
      await source.drop();
    }
  },
);

test(
  'verify يرفض ملف نسخة عُدّل بعد كتابة البيان',
  { skip: skipWithoutDatabase, timeout: PER_TEST_TIMEOUT_MS },
  async () => {
    const source = await createIsolatedDatabase('corrupt');
    const dump = path.join(
      registerTmpRoot(fs.mkdtempSync(path.join(os.tmpdir(), 'backup-corrupt-'))),
      'state.dump',
    );
    try {
      await up(source.pool);
      const sourceUrl = databaseUrlFor(source.name);
      const backup = await runNode([BACKUP_SCRIPT, 'create', dump], sourceUrl);
      assert.equal(backup.code, 0, backup.stderr);
      fs.appendFileSync(dump, 'altered', 'utf8');

      const verified = await runNode([BACKUP_SCRIPT, 'verify', dump], sourceUrl);
      assert.equal(verified.code, 1);
      assert.match(verified.stderr, /\[BACKUP_HASH_MISMATCH\]/);
    } finally {
      await source.drop();
    }
  },
);

test(
  'البيانُ والنسخةُ لقطةٌ واحدة: كتاباتٌ متزامنةٌ أثناءَ النسخِ لا تفصلُ بينَهما (`WL-398`)',
  { skip: skipWithoutDatabase, timeout: PER_TEST_TIMEOUT_MS },
  async () => {
    const source = await createIsolatedDatabase('concurrentsrc');
    const target = await createIsolatedDatabase('concurrentdst');
    const dir = registerTmpRoot(fs.mkdtempSync(path.join(os.tmpdir(), 'backup-concurrent-')));
    const dump = path.join(dir, 'state.dump');
    try {
      await up(source.pool);
      await seedEveryTable(source.pool);
      const sourceUrl = databaseUrlFor(source.name);

      // كاتبٌ متزامنٌ: صفٌّ كلَّ ٢٥ مللي ثانيةً في `state.events` طوالَ النسخِ —
      // فلا سكونَ يُخفي الانفصالَ إن وُجدَ: اللقطةُ تقعُ في وسطِ كتابةٍ حيّةٍ.
      // ‏`WL-606`: كانَ كلُّ صفٍّ يحملُ التجزئةَ نفسَها (‏`'c'.repeat(64)`) فيسقطُ كلُّ إدراجٍ بعدَ الأوّلِ
      // على `events_hash_unique` ويُبتلَعُ الخطأ — كاتبٌ «متزامنٌ» بصفٍّ واحد (‏كشفتهُ طفرةُ بصمةٍ خارجَ
      // اللقطةِ نجت). صارت التجزئةُ فريدةً لكلِّ صفّ، والأخطاءُ تُعَدُّ ويُؤكَّدُ أنّ الكتابةَ وقعت أثناءَ النسخ.
      let stop = false;
      let written = 0;
      let failed = 0;
      const writer = (async () => {
        for (let n = 0; !stop; n += 1) {
          await source.pool
            .query(
              `INSERT INTO state.events (event_id, type, actor, payload, hash, occurred_at)
               VALUES ($1, 'backup.concurrent', 'agent-001', '{}'::jsonb, $2, now())`,
              [
                `concurrent-${n}`,
                crypto.createHash('sha256').update(`concurrent-${n}`).digest('hex'),
              ],
            )
            .then(
              () => (written += 1),
              () => (failed += 1),
            );
          await new Promise((resolve) => setTimeout(resolve, 25));
        }
      })();

      const backup = await runNode([BACKUP_SCRIPT, 'create', dump], sourceUrl);
      const writtenDuringBackup = written;
      stop = true;
      await writer;
      assert.equal(backup.code, 0, backup.stderr);
      assert.match(backup.stdout, /\[BACKUP_CREATED\]/);
      assert.equal(failed, 0, 'إدراجاتُ الكاتبِ المتزامنِ فشلت — الاختبارُ لا يقيس');
      assert.ok(writtenDuringBackup >= 5, `كتاباتٌ أثناءَ النسخِ قليلة: ${writtenDuringBackup}`);

      // استعادةٌ إلى نظيفةٍ تنجحُ: عدّاداتُ البيانِ تطابقُ المُستعادَ لأنّهما
      // اللقطةُ نفسُها — بلا هذا الربطِ كانت كتابةٌ واحدةٌ بينَ قراءةِ العدّاداتِ
      // وانطلاقِ النسخِ تُسقِطُ استعادةَ نسخةٍ سليمةٍ (`RESTORE_ROW_COUNT_MISMATCH`).
      const restore = await runNode([RESTORE_SCRIPT, dump, '--database', target.name], sourceUrl);
      assert.equal(restore.code, 0, restore.stderr);
      assert.match(restore.stdout, /\[RESTORE_OK\]/);
      const manifest = JSON.parse(fs.readFileSync(`${dump}.manifest.json`, 'utf8'));
      assert.deepEqual(
        await stateRowCounts(target.pool),
        manifest.rowCounts,
        'البيانُ والاستعادةُ لقطةٌ واحدةٌ متّسقةٌ',
      );

      // والكتاباتُ استمرّت بعدَ اللقطةِ فعلًا: الحيُّ أكثرُ من اللقطةِ — الدليلُ أنّ
      // الاتّساقَ مقيسٌ في وسطِ حركةٍ لا مصادفةَ سكونٍ.
      await source.pool.query(
        `INSERT INTO state.events (event_id, type, actor, payload, hash, occurred_at)
         VALUES ('after-backup', 'backup.concurrent', 'agent-001', '{}'::jsonb, ${'$'}1, now())`,
        ['d'.repeat(64)],
      );
      const live = await source.pool.query('SELECT count(*)::int AS n FROM state.events');
      const liveCount = Number(
        /** @type {Record<string, unknown> | undefined} */ (live.rows[0])?.['n'],
      );
      assert.ok(
        liveCount > manifest.rowCounts['events'],
        `القاعدةُ الحيّةُ (${liveCount}) أكثرُ من اللقطةِ (${manifest.rowCounts['events']}) — الكتابةُ المتزامنةُ وقعت فعلًا`,
      );
    } finally {
      await target.drop();
      await source.drop();
    }
  },
);

test(
  'LIVE-45 (هـ): كتابةٌ مُلتزَمةٌ بينَ قراءةِ البيانِ وانطلاقِ `pg_dump` لا تفصلُهما — حتميّاً لا بتوقيت (`WL-586`)',
  { skip: skipWithoutDatabase, timeout: PER_TEST_TIMEOUT_MS },
  async () => {
    // اختبارُ `WL-398` أعلاه يعتمدُ على أن يقعَ كاتبُه (‏كلَّ ٢٥ مللي ثانية) في الشبّاكِ بينَ
    // عدّاداتِ البيانِ وانطلاقِ `pg_dump` — ونزعُ `--snapshot` نجا منه 8 تشغيلاتٍ من 8 (‏`WL-586`).
    // هنا الشبّاكُ مضمون: `pg_dump` مُغلَّفٌ (‏`PG_DUMP`، `scripts/lib/pg-tools.mjs`) يلتزمُ صفّاً
    // في `state.events` ثمّ يُنادي الأداةَ الحقيقيّة. باللقطةِ المُصدَّرةِ لا يراه النسخُ فيطابقُ
    // البيانَ؛ وبلاها يراه فتَرسبُ الاستعادةُ `RESTORE_ROW_COUNT_MISMATCH`.
    const { resolvePgTool } = await import('../../scripts/lib/pg-tools.mjs');
    const realDump = resolvePgTool('pg_dump');
    const source = await createIsolatedDatabase('snapgapsrc');
    const target = await createIsolatedDatabase('snapgapdst');
    const dir = registerTmpRoot(fs.mkdtempSync(path.join(os.tmpdir(), 'backup-snapgap-')));
    const dump = path.join(dir, 'state.dump');
    const sourceUrl = databaseUrlFor(source.name);
    const inserter = path.join(dir, 'insert-gap-row.mjs');
    fs.writeFileSync(
      inserter,
      [
        "import { createRequire } from 'node:module';",
        `const require = createRequire(${JSON.stringify(path.join(ROOT, 'package.json'))});`,
        "const pg = require('pg');",
        `const client = new pg.Client({ connectionString: ${JSON.stringify(sourceUrl)} });`,
        'await client.connect();',
        'await client.query(',
        "  `INSERT INTO state.events (event_id, type, actor, payload, hash, occurred_at) VALUES ('snapshot-gap', 'backup.snapgap', 'agent-001', '{}'::jsonb, $1, now())`,",
        `  [${JSON.stringify('e'.repeat(64))}],`,
        ');',
        'await client.end();',
        '',
      ].join('\n'),
    );
    const wrapper = path.join(dir, 'pg_dump');
    fs.writeFileSync(
      wrapper,
      [
        '#!/bin/sh',
        'if [ "$1" != "--version" ]; then',
        `  ${JSON.stringify(process.execPath)} ${JSON.stringify(inserter)} || exit 97`,
        'fi',
        `exec ${JSON.stringify(realDump)} "$@"`,
        '',
      ].join('\n'),
      { mode: 0o700 },
    );
    try {
      await up(source.pool);
      await seedEveryTable(source.pool);
      const backup = await runNode([BACKUP_SCRIPT, 'create', dump], sourceUrl, {
        PG_DUMP: wrapper,
      });
      assert.equal(backup.code, 0, backup.stderr);
      assert.match(backup.stdout, /\[BACKUP_CREATED\]/);

      // الشبّاكُ وقعَ فعلاً: الصفُّ مُلتزَمٌ في المصدرِ بعدَ قراءةِ البيانِ وقبلَ النسخ.
      const gap = await source.pool.query(
        "SELECT count(*)::int AS n FROM state.events WHERE event_id = 'snapshot-gap'",
      );
      assert.equal(
        Number(/** @type {Record<string, unknown> | undefined} */ (gap.rows[0])?.['n']),
        1,
        'المُغلِّفُ لم يكتبْ — الشبّاكُ لم يُقَسْ',
      );

      const restore = await runNode([RESTORE_SCRIPT, dump, '--database', target.name], sourceUrl);
      assert.equal(restore.code, 0, `${restore.stdout}\n${restore.stderr}`);
      assert.match(restore.stdout, /\[RESTORE_OK\]/);
      const manifest = JSON.parse(fs.readFileSync(`${dump}.manifest.json`, 'utf8'));
      assert.deepEqual(await stateRowCounts(target.pool), manifest.rowCounts);
      const restoredGap = await target.pool.query(
        "SELECT count(*)::int AS n FROM state.events WHERE event_id = 'snapshot-gap'",
      );
      assert.equal(
        Number(/** @type {Record<string, unknown> | undefined} */ (restoredGap.rows[0])?.['n']),
        0,
        'النسخُ رأى كتابةً بعدَ لقطةِ البيان — ليسا لقطةً واحدة',
      );
    } finally {
      await target.drop();
      await source.drop();
    }
  },
);

// ‏`WL-590`: تمرينُ طفراتٍ على `scripts/restore.mjs` نجت فيه 16 طفرةً من 17 —
// المسارُ السعيدُ وحده كان مُختبَراً. ما يلي يُسقِطُ كلَّ واحدةٍ باسمِها، وأوّلُها عيبٌ
// فعليّ: `--force` كان يمحو `state` قبلَ فحصِ إصدارِ `pg_restore`.

/**
 * مُغلِّفُ `pg_restore` يكذبُ في `--version` ويُسجِّلُ وسائطَه، ثمّ يُنادي الأداةَ الحقيقيّة
 * أو يخرجُ برمزٍ معيّن.
 * @param {string} dir
 * @param {{ version?: string, exitCode?: number }} behaviour
 * @returns {Promise<{ wrapper: string, argsLog: string }>}
 */
async function restoreWrapper(dir, behaviour) {
  const { resolvePgTool } = await import('../../scripts/lib/pg-tools.mjs');
  const real = resolvePgTool('pg_restore');
  const wrapper = path.join(dir, 'pg_restore');
  const argsLog = path.join(dir, 'pg_restore.args');
  const lines = ['#!/bin/sh'];
  if (behaviour.version !== undefined) {
    lines.push(
      'if [ "$1" = "--version" ]; then',
      `  echo ${JSON.stringify(behaviour.version)}`,
      '  exit 0',
      'fi',
    );
  }
  lines.push(
    'if [ "$1" != "--version" ] && [ "$1" != "--list" ]; then',
    `  printf '%s\\n' "$@" > ${JSON.stringify(argsLog)}`,
    ...(behaviour.exitCode === undefined ? [] : [`  exit ${behaviour.exitCode}`]),
    'fi',
    `exec ${JSON.stringify(real)} "$@"`,
    '',
  );
  fs.writeFileSync(wrapper, lines.join('\n'), { mode: 0o700 });
  return { wrapper, argsLog };
}

/**
 * @param {string} file
 * @returns {string}
 */
function sha256Of(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

/**
 * @typedef {object} GoldenBackup
 * @property {string} dir مجلّدُ النسخةِ الذهبيّة (‏ملفّاها للقراءةِ وحدَها).
 * @property {string} dump
 * @property {string} manifest
 * @property {string} dumpSha256 بصمةُ ملفِّ النسخةِ لحظةَ كتابتِه.
 * @property {string} manifestSha256 بصمةُ البيانِ لحظةَ كتابتِه.
 * @property {string} sourceDigest `contentsDigest` لمصدرِها لحظةَ النسخ.
 */

/** @type {Promise<GoldenBackup> | undefined} */
let goldenBackup;

/**
 * ‏`WL-596`: نسخةٌ ذهبيّةٌ واحدةٌ لاختباراتِ `seededBackup`. كانَ كلُّ استدعاءٍ يبني مصدراً مُهاجَراً
 * مُمهَّداً ويأخذُ منه نسخةً بعمليّةٍ ابنة (‏≈ 1.5 ثانية محلّياً، و21 استدعاءً)، وكلُّها النسخةُ نفسُها
 * محتوىً. فتُبنى هنا **مرّةً واحدةً عندَ أوّلِ طلب**، ويُمحى مصدرُها فوراً: **لا تُشارَكُ قاعدةٌ**، بل
 * الملفّان وحدَهما وبصمتاهما وبصمةُ محتوى المصدر.
 *
 * والبناءُ كسولٌ لا في `before()`: أيُّ اختبارٍ يطلبُها أوّلاً يبنيها، والمحتوى واحدٌ أيّاً كانَ الطالب،
 * فلا يتعلّقُ اختبارٌ بترتيبِ التنفيذ ولا بنجاحِ اختبارٍ قبلَه. وفشلُ البناءِ يُسقِطُ كلَّ طالبٍ بالخطأِ نفسِه.
 * @returns {Promise<GoldenBackup>}
 */
function sharedGoldenBackup() {
  goldenBackup ??= (async () => {
    const source = await createIsolatedDatabase('goldensrc');
    try {
      const dir = registerTmpRoot(fs.mkdtempSync(path.join(os.tmpdir(), 'backup-golden-')));
      const dump = path.join(dir, 'state.dump');
      await up(source.pool);
      await seedEveryTable(source.pool);
      const backup = await runNode([BACKUP_SCRIPT, 'create', dump], databaseUrlFor(source.name));
      assert.equal(backup.code, 0, backup.stderr);
      const sourceDigest = await contentsDigest(source.pool);
      const manifest = `${dump}.manifest.json`;
      // النسخةُ الذهبيّةُ مُمهَّدةٌ حقّاً: صفٌّ في كلِّ جدولٍ يملؤه `seedEveryTable`. بلا هذا يمرُّ
      // بناءٌ نسيَ التمهيدَ بصمت (‏مقيسٌ بطفرة: لا اختبارَ من الطالبين يقرأُ المحتوى إلا ببصمته).
      const { rowCounts } = JSON.parse(fs.readFileSync(manifest, 'utf8'));
      for (const table of [
        'agents',
        'models',
        'events',
        'commands',
        'laws',
        'cases',
        'policies',
        'quotas',
        'data_assets',
        'memories',
      ]) {
        assert.ok(rowCounts[table] >= 1, `النسخةُ الذهبيّةُ بلا صفٍّ في state.${table}`);
      }
      // للقراءةِ وحدَها: كتابةٌ عارضةٌ فيهما تسقطُ بـ`EACCES` لا تلوّثٌ صامت. والبصمةُ تكشفُ ما سواها.
      fs.chmodSync(dump, 0o444);
      fs.chmodSync(manifest, 0o444);
      return {
        dir,
        dump,
        manifest,
        dumpSha256: sha256Of(dump),
        manifestSha256: sha256Of(manifest),
        sourceDigest,
      };
    } finally {
      await source.drop();
    }
  })();
  return goldenBackup;
}

/**
 * @param {GoldenBackup} golden
 * @param {string} dump
 * @param {string} where
 */
function assertGoldenIntact(golden, dump, where) {
  assert.equal(sha256Of(dump), golden.dumpSha256, `بصمةُ ملفِّ النسخةِ تغيّرت (${where})`);
  assert.equal(
    sha256Of(`${dump}.manifest.json`),
    golden.manifestSha256,
    `بصمةُ البيانِ تغيّرت (${where})`,
  );
}

test.after(async () => {
  if (goldenBackup === undefined) return;
  const golden = await goldenBackup;
  // لا اختبارَ يكتبُ في الأصل: لو كتبَ أحدُها فيه لظهرَ هنا ولو مرَّ هو.
  assertGoldenIntact(golden, golden.dump, 'الأصلُ بعدَ آخرِ اختبار');
});

/**
 * نسخةٌ خاصّةٌ بالاختبارِ من النسخةِ الذهبيّة، وقاعدةُ اتّصالٍ خاصّةٌ به.
 *
 * ‏`source` قاعدةٌ **فارغةٌ** خاصّةٌ بالاختبار، لا مصدرُ النسخة: `restore.mjs` يتّصلُ بقاعدةِ `postgres`
 * من `DATABASE_URL` وبالهدف، و`verify` لا يتّصلُ أصلاً، فلا يقرأُ أيٌّ منهما قاعدةَ `sourceUrl`. وما يُسألُ
 * عنه بـ`source.pool` في هذه الاختبارات كتالوجُ العنقود (`pg_database`) و`DROP DATABASE`. ومحتوى المصدرِ
 * يُقارَنُ بـ`sourceDigest` المقيسِ لحظةَ النسخ.
 *
 * ‏`startedAt` و`durationMs` في البيانِ صارا من نسخٍ واحدٍ لكلِّ الطالبين. لا اختبارَ هنا يقيسُهما: تعديلُ
 * `durationMs` في نسخةِ الاختبارِ المحلّيّة يبقى محلّيّاً، وزمنُ الاستعادةِ تقيسُه `restore.mjs` بنفسِها.
 * @param {string} label
 * @returns {Promise<{ source: Awaited<ReturnType<typeof createIsolatedDatabase>>, sourceUrl: string, dir: string, dump: string, sourceDigest: string }>}
 */
async function seededBackup(label) {
  const golden = await sharedGoldenBackup();
  assertGoldenIntact(golden, golden.dump, `الأصلُ قبلَ ${label}`);
  const dir = registerTmpRoot(fs.mkdtempSync(path.join(os.tmpdir(), `backup-${label}-`)));
  const dump = path.join(dir, 'state.dump');
  fs.copyFileSync(golden.dump, dump);
  fs.copyFileSync(golden.manifest, `${dump}.manifest.json`);
  // النسخةُ المحلّيّةُ قابلةٌ للكتابة: بعضُ الاختباراتِ يعدّلُها عمداً (‏بصمة، بيان، حذف).
  fs.chmodSync(dump, 0o600);
  fs.chmodSync(`${dump}.manifest.json`, 0o600);
  assertGoldenIntact(golden, dump, `نسخةُ ${label}`);
  const source = await createIsolatedDatabase(`${label}src`);
  return {
    source,
    sourceUrl: databaseUrlFor(source.name),
    dir,
    dump,
    sourceDigest: golden.sourceDigest,
  };
}

/**
 * @param {string} dump
 * @param {(manifest: Record<string, any>) => void} edit
 */
function editManifest(dump, edit) {
  const file = `${dump}.manifest.json`;
  const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
  edit(manifest);
  fs.writeFileSync(file, JSON.stringify(manifest, null, 2));
}

test(
  'WL-590: `--force` مع `pg_restore` أقدمَ من النسخة يرفضُ قبلَ أن يمحوَ قاعدةَ الهدف',
  { skip: skipWithoutDatabase, timeout: PER_TEST_TIMEOUT_MS },
  async () => {
    const { source, sourceUrl, dir, dump } = await seededBackup('oldtool');
    const busy = await createIsolatedDatabase('oldtooldst');
    try {
      await up(busy.pool);
      await seedEveryTable(busy.pool);
      const beforeDigest = await contentsDigest(busy.pool);
      const beforeCatalog = await catalogSnapshot(busy.pool);
      const { wrapper } = await restoreWrapper(dir, { version: 'pg_restore (PostgreSQL) 9.6' });

      const restore = await runNode(
        [RESTORE_SCRIPT, dump, '--database', busy.name, '--force'],
        sourceUrl,
        { PG_RESTORE: wrapper },
      );
      assert.equal(restore.code, 1, restore.stdout);
      assert.match(restore.stderr, /\[RESTORE_TOOL_UNUSABLE\]/);
      // الجوهر: الرفضُ لا يُكلِّفُ الهدفَ شيئاً — لا `state` ممحوّاً ولا دفترَ مُسقَطاً.
      assert.equal(await catalogSnapshot(busy.pool), beforeCatalog);
      assert.equal(await contentsDigest(busy.pool), beforeDigest);
    } finally {
      await busy.drop();
      await source.drop();
    }
  },
);

test(
  'WL-590: `--force` فوقَ قاعدةٍ مُهاجَرةٍ مشغولةٍ يستبدلُها بمحتوى النسخة كاملاً',
  { skip: skipWithoutDatabase, timeout: PER_TEST_TIMEOUT_MS },
  async () => {
    const { source, sourceUrl, dir, dump, sourceDigest } = await seededBackup('forceok');
    const busy = await createIsolatedDatabase('forceokdst');
    try {
      // ‏`WL-597`: `up()` كاملاً يُنشئُ `fence` (‏0024)، و`--force` يرفضُ كلَّ هدفٍ مُسيَّج. فالهدفُ
      // «المُهاجَرُ المشغول» هنا مُهاجَرٌ إلى ما قبلَ السياج — الحالُ الوحيدُ الذي يستبدلُه `--force`.
      await up(busy.pool, { to: 23 });
      assert.equal(await fenceSchemaPresent(busy.pool), false, 'الهدفُ مُسيَّجٌ قبلَ الاستعادة');
      await busy.pool.query(
        `INSERT INTO state.models (id, name, provider, purpose, fingerprint, status, model_version)
         VALUES ('stale-model', 'Stale', 'internal', 'operations', $1, 'registered', '0.0.1')`,
        ['f'.repeat(64)],
      );
      // ‏`WL-596`: بصمةُ المصدرِ لحظةَ النسخ، لا قراءةٌ لاحقةٌ له (‏المصدرُ مُحيَ بعدَ النسخِ الذهبيّ).
      const expectedDigest = sourceDigest;
      const { wrapper, argsLog } = await restoreWrapper(dir, {});
      const restore = await runNode(
        [RESTORE_SCRIPT, dump, '--database', busy.name, '--force'],
        sourceUrl,
        { PG_RESTORE: wrapper },
      );
      assert.equal(restore.code, 0, restore.stderr);
      assert.match(restore.stdout, /\[RESTORE_OK\]/);
      assert.equal(await contentsDigest(busy.pool), expectedDigest);
      // الأعلامُ الثلاثةُ جزءٌ من العقد: التوقّفُ عند أوّل خطأٍ لا الاستمرارُ فوقَه.
      const args = fs.readFileSync(argsLog, 'utf8').split('\n');
      for (const flag of ['--exit-on-error', '--no-owner', '--no-privileges']) {
        assert.ok(args.includes(flag), `pg_restore نُودي بلا ${flag}`);
      }
    } finally {
      await busy.drop();
      await source.drop();
    }
  },
);

test(
  'WL-590: الاستعادةُ تتحقّقُ من البصمةِ قبلَ أن تُنشئَ الهدفَ أو تلمسَه',
  { skip: skipWithoutDatabase, timeout: PER_TEST_TIMEOUT_MS },
  async () => {
    const { source, sourceUrl, dump } = await seededBackup('tamper');
    const name = `tampered_${crypto.randomBytes(4).toString('hex')}`;
    try {
      fs.appendFileSync(dump, 'altered', 'utf8');
      const restore = await runNode([RESTORE_SCRIPT, dump, '--database', name], sourceUrl);
      assert.equal(restore.code, 1);
      assert.match(restore.stderr, /\[BACKUP_HASH_MISMATCH\]/);
      const exists = await source.pool.query('SELECT 1 FROM pg_database WHERE datname = $1', [
        name,
      ]);
      assert.equal(exists.rowCount, 0, 'أُنشئت قاعدةُ الهدف لنسخةٍ مُعدَّلة');
    } finally {
      await source.pool.query(`DROP DATABASE IF EXISTS ${quoteIdent(name)}`);
      await source.drop();
    }
  },
);

for (const [label, edit, code] of /** @type {const} */ ([
  [
    'عدٌّ مُزاد',
    (/** @type {Record<string, any>} */ m) => {
      m.rowCounts.agents += 1;
    },
    'RESTORE_ROW_COUNT_MISMATCH',
  ],
  [
    'آخرُ جدولٍ ناقصٌ من البيان',
    (/** @type {Record<string, any>} */ m) => {
      // الأخيرُ أبجديّاً عمداً: حذفُ الأوّلِ تكشفُه إزاحةُ الأسماء، أمّا الأخيرُ فلا
      // يكشفُه إلا مقارنةُ عددِ الجداول.
      const last = Object.keys(m.rowCounts).sort().at(-1);
      if (last === undefined) throw new Error('بيانٌ بلا جداول');
      delete m.rowCounts[last];
    },
    'RESTORE_ROW_COUNT_MISMATCH',
  ],
  [
    'نسخةُ هجرةٍ مُزادة',
    (/** @type {Record<string, any>} */ m) => {
      m.migrationVersion += 1;
    },
    'RESTORE_MIGRATION_VERSION_MISMATCH',
  ],
  [
    'جدولُ دفترٍ مرحليٌّ غيرُ موجود',
    (/** @type {Record<string, any>} */ m) => {
      m.ledgerStagingTable = '__backup_schema_migrations_000000000000';
    },
    'RESTORE_LEDGER_MISSING',
  ],
])) {
  test(
    `WL-590: بيانٌ لا يطابقُ المُستعادَ (${label}) يُسقِطُ الاستعادةَ بـ${code}`,
    { skip: skipWithoutDatabase, timeout: PER_TEST_TIMEOUT_MS },
    async () => {
      const { source, sourceUrl, dump } = await seededBackup('mismatch');
      const target = await createIsolatedDatabase('mismatchdst');
      try {
        // البصمةُ تغطّي الأرشيفَ لا البيان؛ فالتحقّقُ اللاحقُ للاستعادة هو الحارسُ هنا.
        editManifest(dump, edit);
        const restore = await runNode([RESTORE_SCRIPT, dump, '--database', target.name], sourceUrl);
        assert.equal(restore.code, 1, restore.stdout);
        assert.match(restore.stderr, new RegExp(`\\[${code}\\]`));
      } finally {
        await target.drop();
        await source.drop();
      }
    },
  );
}

test(
  'WL-590: رمزُ خروجٍ غيرُ صفريٍّ من `pg_restore` يُسقِطُ الاستعادةَ',
  { skip: skipWithoutDatabase, timeout: PER_TEST_TIMEOUT_MS },
  async () => {
    const { source, sourceUrl, dir, dump } = await seededBackup('exitcode');
    const target = await createIsolatedDatabase('exitcodedst');
    try {
      // المُغلِّفُ يُنفِّذُ الاستعادةَ الحقيقيّةَ ثمّ يكذبُ برمز 3؟ لا: يخرجُ قبلَها برمز 3،
      // فلا يبقى إلا الرمزُ دليلاً على الفشل.
      const { wrapper } = await restoreWrapper(dir, { exitCode: 3 });
      const restore = await runNode([RESTORE_SCRIPT, dump, '--database', target.name], sourceUrl, {
        PG_RESTORE: wrapper,
      });
      assert.equal(restore.code, 1);
      assert.match(restore.stderr, /\[RESTORE_COMMAND_FAILED\] فشل pg_restore برمز 3/);
    } finally {
      await target.drop();
      await source.drop();
    }
  },
);

for (const [label, ddl] of /** @type {Array<[string, string]>} */ ([
  ['مخطّطُ state وحده', 'CREATE SCHEMA state'],
  ['دفترُ الهجرات وحده', 'CREATE TABLE public.schema_migrations (version integer)'],
])) {
  test(
    `WL-590: هدفٌ فيه ${label} ليس نظيفاً بلا --force`,
    { skip: skipWithoutDatabase, timeout: PER_TEST_TIMEOUT_MS },
    async () => {
      const { source, sourceUrl, dump } = await seededBackup('dirty');
      const target = await createIsolatedDatabase('dirtydst');
      try {
        await target.pool.query(ddl);
        const before = await catalogSnapshot(target.pool);
        const restore = await runNode([RESTORE_SCRIPT, dump, '--database', target.name], sourceUrl);
        assert.equal(restore.code, 1);
        assert.match(restore.stderr, /\[RESTORE_TARGET_NOT_CLEAN\]/);
        assert.equal(await catalogSnapshot(target.pool), before);
      } finally {
        await target.drop();
        await source.drop();
      }
    },
  );
}

for (const [label, args, url, code] of /** @type {Array<[string, string[], string, string]>} */ ([
  [
    'اسمُ هدفٍ بشرطة',
    ['/tmp/none.dump', '--database', 'bad-name'],
    'postgres://x@h/db',
    'RESTORE_TARGET_NAME_INVALID',
  ],
  [
    'وسيطٌ غيرُ مدعوم',
    ['/tmp/none.dump', '--database', 'ok_name', '--bogus'],
    'postgres://x@h/db',
    'RESTORE_ARGUMENT',
  ],
  [
    'DATABASE_URL فارغة',
    ['/tmp/none.dump', '--database', 'ok_name'],
    '',
    'RESTORE_DATABASE_URL_MISSING',
  ],
])) {
  test(
    `WL-590: ${label} يُرفضُ بـ${code} قبلَ أيِّ اتصال`,
    { timeout: PER_TEST_TIMEOUT_MS },
    async () => {
      const result = await runNode([RESTORE_SCRIPT, ...args], url);
      assert.equal(result.code, 1);
      assert.match(result.stderr, new RegExp(`\\[${code}\\]`));
    },
  );
}

// ‏`WL-591`: ملاحظتا مراجعةِ `#607` غيرُ المانعتَين (‏N1 وN2). لا علاقةَ لهما بذرّيّةِ
// الاستعادة: فشلُ `pg_restore` بعدَ محوِ `--force` لا يزالُ يتركُ الهدفَ ممحوّاً (‏خطرٌ معلن).

/**
 * @param {import('pg').Pool} pool
 * @param {string} name
 * @returns {Promise<boolean>}
 */
async function databaseExists(pool, name) {
  const found = await pool.query('SELECT 1 FROM pg_database WHERE datname = $1', [name]);
  return found.rowCount !== 0;
}

for (const force of [false, true]) {
  test(
    `WL-591: رفضُ \`pg_restore\` الأقدمِ لا يُنشئُ قاعدةَ هدفٍ غائبة${force ? ' (‏مع --force)' : ''}`,
    { skip: skipWithoutDatabase, timeout: PER_TEST_TIMEOUT_MS },
    async () => {
      const { source, sourceUrl, dir, dump } = await seededBackup('nocreate');
      const name = `nocreate_${crypto.randomBytes(4).toString('hex')}`;
      try {
        assert.equal(await databaseExists(source.pool, name), false);
        const { wrapper } = await restoreWrapper(dir, { version: 'pg_restore (PostgreSQL) 9.6' });
        const restore = await runNode(
          [RESTORE_SCRIPT, dump, '--database', name, ...(force ? ['--force'] : [])],
          sourceUrl,
          { PG_RESTORE: wrapper },
        );
        assert.equal(restore.code, 1, restore.stdout);
        assert.match(restore.stderr, /\[RESTORE_TOOL_UNUSABLE\]/);
        assert.doesNotMatch(restore.stdout, /RESTORE_OK|أُنشئت/);
        assert.equal(
          await databaseExists(source.pool, name),
          false,
          'أُنشئت قاعدةُ الهدفِ قبلَ رفضِ الأداة',
        );
      } finally {
        await source.pool.query(`DROP DATABASE IF EXISTS ${quoteIdent(name)}`);
        await source.drop();
      }
    },
  );
}

test(
  'WL-591: رفضُ `pg_restore` الأقدمِ بلا --force لا يمسُّ قاعدةَ هدفٍ قائمةً مُهاجَرة',
  { skip: skipWithoutDatabase, timeout: PER_TEST_TIMEOUT_MS },
  async () => {
    const { source, sourceUrl, dir, dump } = await seededBackup('notouch');
    const busy = await createIsolatedDatabase('notouchdst');
    try {
      await up(busy.pool);
      await seedEveryTable(busy.pool);
      const beforeDigest = await contentsDigest(busy.pool);
      const beforeCatalog = await catalogSnapshot(busy.pool);
      const { wrapper } = await restoreWrapper(dir, { version: 'pg_restore (PostgreSQL) 9.6' });
      const restore = await runNode([RESTORE_SCRIPT, dump, '--database', busy.name], sourceUrl, {
        PG_RESTORE: wrapper,
      });
      assert.equal(restore.code, 1, restore.stdout);
      assert.match(restore.stderr, /\[RESTORE_TOOL_UNUSABLE\]/);
      assert.equal(await catalogSnapshot(busy.pool), beforeCatalog);
      assert.equal(await contentsDigest(busy.pool), beforeDigest);
    } finally {
      await busy.drop();
      await source.drop();
    }
  },
);

test(
  'WL-591: علامةُ «(أُنشئت)» تظهرُ حينَ تُنشأُ قاعدةُ الهدفِ وتنجحُ الاستعادةُ وحدَه',
  { skip: skipWithoutDatabase, timeout: PER_TEST_TIMEOUT_MS },
  async () => {
    const { source, sourceUrl, dump } = await seededBackup('created');
    const fresh = `created_${crypto.randomBytes(4).toString('hex')}`;
    const clean = await createIsolatedDatabase('createdclean');
    const busy = await createIsolatedDatabase('createdbusy');
    const marker = /\[RESTORE_OK\] إلى قاعدة (\S+)( \(أُنشئت\))?\./;
    try {
      // (١) هدفٌ غائب ⇒ يُنشأ ⇒ العلامةُ حاضرة، واسمُ القاعدةِ صحيح.
      const created = await runNode([RESTORE_SCRIPT, dump, '--database', fresh], sourceUrl);
      assert.equal(created.code, 0, created.stderr);
      const createdLine = marker.exec(created.stdout);
      assert.ok(createdLine, created.stdout);
      assert.equal(createdLine[1], fresh);
      assert.equal(createdLine[2], ' (أُنشئت)');
      assert.equal(await databaseExists(source.pool, fresh), true);

      // (٢) هدفٌ قائمٌ نظيف ⇒ لا علامة.
      const existing = await runNode([RESTORE_SCRIPT, dump, '--database', clean.name], sourceUrl);
      assert.equal(existing.code, 0, existing.stderr);
      const existingLine = marker.exec(existing.stdout);
      assert.ok(existingLine, existing.stdout);
      assert.equal(existingLine[2], undefined, 'العلامةُ ظهرت لهدفٍ قائم');

      // (٣) هدفٌ قائمٌ مشغولٌ مع --force ⇒ لا علامة (‏المحوُ ليس إنشاءً). ‏`WL-597`: مُهاجَرٌ إلى ما قبلَ
      // السياج، فالمُسيَّجُ يُرفَض (‏الخطوة ٤).
      await up(busy.pool, { to: 23 });
      assert.equal(await fenceSchemaPresent(busy.pool), false, 'الهدفُ مُسيَّجٌ قبلَ الاستعادة');
      const forced = await runNode(
        [RESTORE_SCRIPT, dump, '--database', busy.name, '--force'],
        sourceUrl,
      );
      assert.equal(forced.code, 0, forced.stderr);
      const forcedLine = marker.exec(forced.stdout);
      assert.ok(forcedLine, forced.stdout);
      assert.equal(forcedLine[2], undefined, 'العلامةُ ظهرت مع --force على هدفٍ قائم');

      // (٤) الهدفُ الذي أُنشئَ في (١) قائمٌ الآن ومُسيَّج (‏النسخةُ تحملُ `fence`). ‏`WL-597`: استعادةٌ
      // ثانيةٌ إليه بـ--force تُرفَضُ بـ`RESTORE_TARGET_FENCED` بلا علامةٍ ولا سطرِ نجاح، والهدفُ كما هو.
      // (‏كانت تُقبَلُ وتمحو السياج؛ وأنّ «هدفاً قائماً مع --force لا علامةَ له» تثبتُه الخطوة ٣.)
      const freshPool = new pg.Pool({ connectionString: databaseUrlFor(fresh), max: 1 });
      try {
        assert.equal(await fenceSchemaPresent(freshPool), true, 'الهدفُ المستعادُ بلا fence');
        const beforeAgain = await targetImage(freshPool);
        const again = await runNode(
          [RESTORE_SCRIPT, dump, '--database', fresh, '--force'],
          sourceUrl,
        );
        assert.equal(again.code, 1, again.stdout);
        assert.match(again.stderr, /\[RESTORE_TARGET_FENCED\]/);
        const againLine = marker.exec(again.stdout);
        assert.equal(againLine, null, again.stdout);
        assert.doesNotMatch(again.stdout, /أُنشئت/, 'العلامةُ ظهرت لهدفٍ أنشأته استعادةٌ سابقة');
        assert.equal(await targetImage(freshPool), beforeAgain, 'الرفضُ غيّرَ الهدف');
      } finally {
        await freshPool.end();
      }

      // (٥) فشلٌ بعدَ إنشاءِ الهدف (‏بيانٌ لا يطابق) ⇒ لا سطرَ نجاحٍ ولا علامة.
      const failedName = `createdfail_${crypto.randomBytes(4).toString('hex')}`;
      try {
        editManifest(dump, (m) => {
          m.migrationVersion += 1;
        });
        const failed = await runNode([RESTORE_SCRIPT, dump, '--database', failedName], sourceUrl);
        assert.equal(failed.code, 1);
        assert.match(failed.stderr, /\[RESTORE_MIGRATION_VERSION_MISMATCH\]/);
        assert.doesNotMatch(failed.stdout, /RESTORE_OK|أُنشئت/);
      } finally {
        await source.pool.query(`DROP DATABASE IF EXISTS ${quoteIdent(failedName)}`);
      }
    } finally {
      await source.pool.query(`DROP DATABASE IF EXISTS ${quoteIdent(fresh)}`);
      await busy.drop();
      await clean.drop();
      await source.drop();
    }
  },
);

// ‏`WL-591`: طفراتُ `scripts/backup.mjs`. قبلَ هذه الاختبارات نجت 15 طفرةً من 22؛ كلُّ اختبارٍ
// هنا يُسمّي فرعَ رفضٍ أو عقداً كانت طفرتُه تمرُّ.

/**
 * مُغلِّفُ `pg_dump`: يكذبُ في `--version` أو يخرجُ برمزٍ قبلَ النسخ، ويُسجِّلُ وسائطَه.
 * @param {string} dir
 * @param {{ version?: string, exitCode?: number }} behaviour
 * @returns {Promise<{ wrapper: string, argsLog: string }>}
 */
async function dumpWrapper(dir, behaviour) {
  const { resolvePgTool } = await import('../../scripts/lib/pg-tools.mjs');
  const real = resolvePgTool('pg_dump');
  const wrapper = path.join(dir, 'pg_dump');
  const argsLog = path.join(dir, 'pg_dump.args');
  const lines = ['#!/bin/sh'];
  if (behaviour.version !== undefined) {
    lines.push(
      'if [ "$1" = "--version" ]; then',
      `  echo ${JSON.stringify(behaviour.version)}`,
      '  exit 0',
      'fi',
    );
  }
  lines.push(
    'if [ "$1" != "--version" ]; then',
    `  printf '%s\\n' "$@" > ${JSON.stringify(argsLog)}`,
    ...(behaviour.exitCode === undefined ? [] : [`  exit ${behaviour.exitCode}`]),
    'fi',
    `exec ${JSON.stringify(real)} "$@"`,
    '',
  );
  fs.writeFileSync(wrapper, lines.join('\n'), { mode: 0o700 });
  return { wrapper, argsLog };
}

/**
 * جداولُ `state` المرحليّةُ الباقية — النسخُ يجبُ ألّا يتركَ منها شيئاً نجحَ أو فشل.
 * @param {import('pg').Pool} pool
 * @returns {Promise<string[]>}
 */
async function stagingLeftovers(pool) {
  const found = await pool.query(
    `SELECT c.relname FROM pg_class AS c JOIN pg_namespace AS n ON n.oid = c.relnamespace
     WHERE n.nspname = 'state' AND c.relname LIKE '\\_\\_backup\\_%'`,
  );
  return found.rows.map((row) => String(/** @type {Record<string, unknown>} */ (row)['relname']));
}

for (const [
  label,
  behaviour,
  code,
] of /** @type {Array<[string, { version?: string, exitCode?: number }, string]>} */ ([
  ['`pg_dump` أقدمُ من الخادم', { version: 'pg_dump (PostgreSQL) 9.6' }, 'BACKUP_TOOL_UNUSABLE'],
  ['`pg_dump` يخرجُ برمز 3', { exitCode: 3 }, 'BACKUP_COMMAND_FAILED'],
])) {
  test(
    `WL-591: ${label} ⇒ ${code}، بلا بيانٍ ولا جدولٍ مرحليٍّ باقٍ`,
    { skip: skipWithoutDatabase, timeout: PER_TEST_TIMEOUT_MS },
    async () => {
      const source = await createIsolatedDatabase('dumpfail');
      const dir = registerTmpRoot(fs.mkdtempSync(path.join(os.tmpdir(), 'backup-dumpfail-')));
      const dump = path.join(dir, 'state.dump');
      try {
        await up(source.pool);
        await seedEveryTable(source.pool);
        const before = await catalogSnapshot(source.pool);
        const { wrapper } = await dumpWrapper(dir, behaviour);
        const backup = await runNode([BACKUP_SCRIPT, 'create', dump], databaseUrlFor(source.name), {
          PG_DUMP: wrapper,
        });
        assert.equal(backup.code, 1, backup.stdout);
        assert.match(backup.stderr, new RegExp(`\\[${code}\\]`));
        assert.doesNotMatch(backup.stdout, /BACKUP_CREATED/);
        assert.equal(fs.existsSync(`${dump}.manifest.json`), false, 'كُتبَ بيانٌ لنسخةٍ فاشلة');
        assert.deepEqual(await stagingLeftovers(source.pool), []);
        assert.equal(await catalogSnapshot(source.pool), before);
      } finally {
        await source.drop();
      }
    },
  );
}

// ‏`WL-592`: سجلُّ DDL على `state` بقادحِ أحداث — يرى إنشاءَ الجدولِ المرحليِّ ولو حُذفَ بعدَه،
// فيُفرِّقُ «لم يُنشأ» عن «أُنشئَ ثمّ نُظِّف» وهو ما لا يراه `stagingLeftovers`.
/**
 * @param {import('pg').Pool} pool
 * @returns {Promise<void>}
 */
async function installDdlLog(pool) {
  await pool.query(`
    CREATE TABLE public.wl592_ddl_log (tag text NOT NULL, ident text NOT NULL);
    CREATE FUNCTION public.wl592_log_ddl() RETURNS event_trigger LANGUAGE plpgsql AS $$
    BEGIN
      INSERT INTO public.wl592_ddl_log (tag, ident)
        SELECT command_tag, object_identity FROM pg_event_trigger_ddl_commands()
        WHERE schema_name = 'state';
    END $$;
    CREATE EVENT TRIGGER wl592_ddl_log ON ddl_command_end EXECUTE FUNCTION public.wl592_log_ddl();
  `);
}

/**
 * @param {import('pg').Pool} pool
 * @returns {Promise<string[]>}
 */
async function stagingCreations(pool) {
  const found = await pool.query(
    `SELECT ident FROM public.wl592_ddl_log
     WHERE tag = 'CREATE TABLE' AND ident LIKE 'state.\\_\\_backup\\_%'`,
  );
  return found.rows.map((row) => String(/** @type {Record<string, unknown>} */ (row)['ident']));
}

test(
  'WL-592: رفضُ `pg_dump` الأقدمِ يقعُ قبلَ إنشاءِ الجدولِ المرحليّ — لا مسَّ للمصدر',
  { skip: skipWithoutDatabase, timeout: PER_TEST_TIMEOUT_MS },
  async () => {
    const source = await createIsolatedDatabase('dumpgate');
    const dir = registerTmpRoot(fs.mkdtempSync(path.join(os.tmpdir(), 'backup-dumpgate-')));
    const dump = path.join(dir, 'state.dump');
    try {
      await up(source.pool);
      await installDdlLog(source.pool);
      const { wrapper } = await dumpWrapper(dir, { version: 'pg_dump (PostgreSQL) 9.6' });
      const refused = await runNode([BACKUP_SCRIPT, 'create', dump], databaseUrlFor(source.name), {
        PG_DUMP: wrapper,
      });
      assert.equal(refused.code, 1, refused.stdout);
      assert.match(refused.stderr, /\[BACKUP_TOOL_UNUSABLE\]/);
      assert.deepEqual(await stagingCreations(source.pool), [], 'أُنشئَ جدولٌ مرحليٌّ قبلَ الرفض');
      // شاهدٌ إيجابيّ: السجلُّ يرى الإنشاءَ فعلاً حينَ يقع، فالفراغُ أعلاه ليس عمىً.
      const created = await runNode([BACKUP_SCRIPT, 'create', dump], databaseUrlFor(source.name));
      assert.equal(created.code, 0, created.stderr);
      assert.equal((await stagingCreations(source.pool)).length, 1);
    } finally {
      await source.drop();
    }
  },
);

for (const [
  label,
  behaviour,
  expectCode,
] of /** @type {Array<[string, { exitCode?: number }, string | null]>} */ ([
  ['مع فشلِ `pg_dump` برمز 3', { exitCode: 3 }, 'BACKUP_COMMAND_FAILED'],
  ['مع نجاحِ `pg_dump`', {}, null],
])) {
  test(
    `WL-592: تعذّرُ حذفِ الجدولِ المرحليِّ ${label} لا يحجبُ الخطأَ ولا يُنتجُ بياناً`,
    { skip: skipWithoutDatabase, timeout: PER_TEST_TIMEOUT_MS },
    async () => {
      const source = await createIsolatedDatabase('dropfail');
      const dir = registerTmpRoot(fs.mkdtempSync(path.join(os.tmpdir(), 'backup-dropfail-')));
      const dump = path.join(dir, 'state.dump');
      try {
        await up(source.pool);
        await source.pool.query(`
          CREATE FUNCTION public.wl592_refuse_drop() RETURNS event_trigger LANGUAGE plpgsql AS $$
          BEGIN
            IF EXISTS (SELECT 1 FROM pg_event_trigger_dropped_objects()
                       WHERE object_identity LIKE 'state.\\_\\_backup\\_%') THEN
              RAISE EXCEPTION 'wl592: drop refused';
            END IF;
          END $$;
          CREATE EVENT TRIGGER wl592_refuse_drop ON sql_drop
            EXECUTE FUNCTION public.wl592_refuse_drop();
        `);
        const { wrapper } = await dumpWrapper(dir, behaviour);
        const backup = await runNode([BACKUP_SCRIPT, 'create', dump], databaseUrlFor(source.name), {
          PG_DUMP: wrapper,
        });
        assert.equal(backup.code, 1, backup.stdout);
        assert.doesNotMatch(backup.stdout, /BACKUP_CREATED/);
        assert.equal(
          fs.existsSync(`${dump}.manifest.json`),
          false,
          'كُتبَ بيانٌ وجدولٌ مرحليٌّ باقٍ',
        );
        assert.match(backup.stderr, /wl592: drop refused/);
        const leftovers = await stagingLeftovers(source.pool);
        assert.equal(leftovers.length, 1);
        if (expectCode !== null) {
          assert.match(backup.stderr, new RegExp(`\\[${expectCode}\\]`));
        }
        // الاسمُ الباقي مُسمّىً في الخطأ كي يُزالَ يدوياً — في المسارَين (‏ملاحظةُ المراجعةِ N2).
        assert.ok(backup.stderr.includes(`state.${leftovers[0]}`), backup.stderr);
      } finally {
        await source.drop();
      }
    },
  );
}

// ‏`WL-592` (‏ملاحظةُ المراجعةِ N3): الإنشاءُ والنسخُ كانا عبارتَين مستقلّتَين خارجَ نطاقِ التنظيف،
// ففشلُ `INSERT` بعدَ `CREATE` يُبقي الجدولَ المرحليَّ في `state` — فينتقلُ إلى كلِّ نسخةٍ لاحقة.
for (const [
  label,
  breakLedger,
] of /** @type {Array<[string, (pool: import('pg').Pool) => Promise<void>]>} */ ([
  [
    'دفترُ الهجراتِ غائب',
    async (pool) => {
      await pool.query('DROP TABLE public.schema_migrations');
    },
  ],
  [
    'صفٌّ في الدفترِ يخرقُ قيدَ الجدولِ المرحليّ',
    async (pool) => {
      await pool.query(
        'ALTER TABLE public.schema_migrations DROP CONSTRAINT schema_migrations_checksum_check',
      );
      await pool.query("UPDATE public.schema_migrations SET checksum = 'x' WHERE version = 1");
    },
  ],
])) {
  test(
    `WL-592: فشلُ نسخِ الدفترِ إلى الجدولِ المرحليّ (‏${label}) لا يُبقي جدولاً ولا بياناً`,
    { skip: skipWithoutDatabase, timeout: PER_TEST_TIMEOUT_MS },
    async () => {
      const source = await createIsolatedDatabase('stagefail');
      const dir = registerTmpRoot(fs.mkdtempSync(path.join(os.tmpdir(), 'backup-stagefail-')));
      const dump = path.join(dir, 'state.dump');
      try {
        await up(source.pool);
        await breakLedger(source.pool);
        await installDdlLog(source.pool);
        const backup = await runNode([BACKUP_SCRIPT, 'create', dump], databaseUrlFor(source.name));
        assert.equal(backup.code, 1, backup.stdout);
        assert.doesNotMatch(backup.stdout, /BACKUP_CREATED/);
        // الخطأُ الأصليُّ وحدَه: لا حذفَ لجدولٍ لم يُلتزَم إنشاؤه يُلحِقُ خطأً زائفاً.
        assert.doesNotMatch(backup.stderr, /تعذّرَ حذفُ الجدولِ المرحليِّ/);
        assert.equal(fs.existsSync(`${dump}.manifest.json`), false, 'كُتبَ بيانٌ لنسخةٍ فاشلة');
        assert.deepEqual(await stagingLeftovers(source.pool), [], 'بقيَ جدولٌ مرحليٌّ في state');
        // قادحُ `ddl_command_end` يجري داخلَ المعاملة: إنشاءٌ أُلغيَ لا يُسجَّل؛ فالفراغُ هنا
        // يعني أنّ الإنشاءَ لم يُلتزَم قطّ — لا أنّه التُزِمَ ثمّ حُذف.
        assert.deepEqual(await stagingCreations(source.pool), [], 'التُزِمَ إنشاءُ جدولٍ مرحليّ');
      } finally {
        await source.drop();
      }
    },
  );
}

// ‏`WL-592` (‏الطفرةُ B2): البيانُ والنسخةُ لقطةٌ واحدة **ما بينَ تصديرِ اللقطةِ وقراءةِ العدّادات**.
// اختبارُ `LIVE-45 (هـ)` يحقنُ الكتابةَ بعدَ قراءةِ العدّاداتِ (‏في مُغلِّفِ `pg_dump`) فلا يرى
// استبدالَ `REPEATABLE READ` بـ`BEGIN`: في `READ COMMITTED` تأخذُ كلُّ عبارةٍ لقطةً جديدة.
// والحقنُ هنا حتميٌّ بقفلٍ لا بتوقيت ولا بخطّافٍ في الأداة: جلسةٌ تحجزُ `state.agents` بقفلٍ
// حصريٍّ وتُدخِلُ صفّاً في `state.events` ولا تلتزم؛ فيُصدِّرُ النسخُ لقطتَه ثمّ يقفُ عندَ عدِّ
// ‏`agents`؛ ويُلتزَمُ الصفُّ وهو واقفٌ (‏مقيسٌ من `pg_locks`)، ثمّ يُعَدُّ `events` بعدَه أبجديّاً.
test(
  'WL-592 (B2): كتابةٌ مُلتزَمةٌ بينَ تصديرِ اللقطةِ وقراءةِ العدّاداتِ لا تفصلُ البيانَ عن النسخة — حتميّاً بقفل',
  { skip: skipWithoutDatabase, timeout: PER_TEST_TIMEOUT_MS },
  async () => {
    const source = await createIsolatedDatabase('lockgapsrc');
    const target = await createIsolatedDatabase('lockgapdst');
    const dir = registerTmpRoot(fs.mkdtempSync(path.join(os.tmpdir(), 'backup-lockgap-')));
    const dump = path.join(dir, 'state.dump');
    const sourceUrl = databaseUrlFor(source.name);
    try {
      await up(source.pool);
      await seedEveryTable(source.pool);
      const locker = await source.pool.connect();
      /** @type {Promise<CommandResult> | undefined} */
      let pending;
      let startedAt = 0n;
      try {
        await locker.query('BEGIN');
        await locker.query('LOCK TABLE state.agents IN ACCESS EXCLUSIVE MODE');
        await locker.query(
          `INSERT INTO state.events (event_id, type, actor, payload, hash, occurred_at)
           VALUES ('snapshot-lockgap', 'backup.lockgap', 'agent-001', '{}'::jsonb, $1, now())`,
          ['f'.repeat(64)],
        );
        startedAt = process.hrtime.bigint();
        pending = runNode([BACKUP_SCRIPT, 'create', dump], sourceUrl);
        // الشبّاكُ مقيسٌ لا مفترَض: النسخُ واقفٌ على قفلِ `agents` (‏أي صدّرَ لقطتَه وبدأَ العدّ).
        let waiting = false;
        for (let i = 0; i < 600 && !waiting; i += 1) {
          const probe = await source.pool.query(
            `SELECT count(*)::int AS n FROM pg_locks
             WHERE NOT granted AND relation = 'state.agents'::regclass`,
          );
          waiting = Number(/** @type {Record<string, unknown>} */ (probe.rows[0])['n']) > 0;
          if (!waiting) await new Promise((resolve) => setTimeout(resolve, 50));
        }
        assert.ok(waiting, 'النسخُ لم يقفْ على قفلِ state.agents — الشبّاكُ لم يُقَس');
        await locker.query('COMMIT');
      } finally {
        locker.release();
      }
      const backup = await pending;
      const elapsedMs = Number((process.hrtime.bigint() - startedAt) / 1_000_000n);
      assert.equal(backup?.code, 0, backup?.stderr);
      const manifest = JSON.parse(fs.readFileSync(`${dump}.manifest.json`, 'utf8'));
      // ‏`durationMs` مدّةُ هذا النسخِ لا رقمٌ صحيحٌ أيّاً كان (‏طفرةُ «بدءُ التوقيتِ من الصفر»):
      // لا يزيدُ على الزمنِ المقيسِ من خارجِ العمليّة، والنسخُ وقفَ على القفلِ فعلاً فلا يكونُ صفراً.
      assert.ok(
        manifest.durationMs > 0 && manifest.durationMs <= elapsedMs,
        `durationMs=${manifest.durationMs} خارجَ [1, ${elapsedMs}]`,
      );
      // البيانُ من اللقطةِ المُصدَّرة: الصفُّ المُلتزَمُ بعدَها ليس فيه.
      assert.equal(manifest.rowCounts.events, 1);
      const restore = await runNode([RESTORE_SCRIPT, dump, '--database', target.name], sourceUrl);
      assert.equal(restore.code, 0, `${restore.stdout}\n${restore.stderr}`);
      assert.deepEqual(await stateRowCounts(target.pool), manifest.rowCounts);
    } finally {
      await target.drop();
      await source.drop();
    }
  },
);

// ‏`WL-592` (‏الطفرةُ B28): انقطاعُ اتصالِ النسخِ أثناءَ `pg_dump` — فشلٌ حقيقيٌّ لا خطّافٌ في الأداة.
// المُغلِّفُ يقطعُ اتّصالَ الأداةِ بالقاعدةِ (‏`pg_terminate_backend`) ثمّ يُنادي `pg_dump` الحقيقيَّ
// فيرفضُ لقطةً ماتت معاملتُها. فيفشلُ `ROLLBACK` على العميلِ الميّت، والحذفُ يجري على اتصالٍ
// جديد: الخطأُ الأصليُّ هو المرميّ ولا جدولَ مرحليٌّ يبقى.
test(
  'WL-592 (B28): انقطاعُ الاتصالِ أثناءَ `pg_dump` ⇒ BACKUP_COMMAND_FAILED بلا جدولٍ مرحليٍّ باقٍ ولا بيان',
  { skip: skipWithoutDatabase, timeout: PER_TEST_TIMEOUT_MS },
  async () => {
    const { resolvePgTool } = await import('../../scripts/lib/pg-tools.mjs');
    const realDump = resolvePgTool('pg_dump');
    const source = await createIsolatedDatabase('connlost');
    const dir = registerTmpRoot(fs.mkdtempSync(path.join(os.tmpdir(), 'backup-connlost-')));
    const dump = path.join(dir, 'state.dump');
    const sourceUrl = databaseUrlFor(source.name);
    const killer = path.join(dir, 'terminate-backup.mjs');
    fs.writeFileSync(
      killer,
      [
        "import { createRequire } from 'node:module';",
        `const require = createRequire(${JSON.stringify(path.join(ROOT, 'package.json'))});`,
        "const pg = require('pg');",
        `const client = new pg.Client({ connectionString: ${JSON.stringify(sourceUrl)} });`,
        'await client.connect();',
        'const r = await client.query(',
        '  `SELECT count(*)::int AS n FROM (SELECT pg_terminate_backend(pid) FROM pg_stat_activity',
        '   WHERE datname = current_database() AND pid <> pg_backend_pid()) AS t`,',
        ');',
        'await client.end();',
        'if (r.rows[0].n < 1) process.exit(98);',
        '',
      ].join('\n'),
    );
    const wrapper = path.join(dir, 'pg_dump');
    fs.writeFileSync(
      wrapper,
      [
        '#!/bin/sh',
        'if [ "$1" != "--version" ]; then',
        `  ${JSON.stringify(process.execPath)} ${JSON.stringify(killer)} || exit 97`,
        'fi',
        `exec ${JSON.stringify(realDump)} "$@"`,
        '',
      ].join('\n'),
      { mode: 0o700 },
    );
    try {
      await up(source.pool);
      const backup = await runNode([BACKUP_SCRIPT, 'create', dump], sourceUrl, {
        PG_DUMP: wrapper,
      });
      assert.equal(backup.code, 1, backup.stdout);
      assert.match(backup.stderr, /\[BACKUP_COMMAND_FAILED\]/);
      assert.doesNotMatch(backup.stderr, /تعذّرَ حذفُ الجدولِ المرحليِّ/);
      assert.equal(fs.existsSync(`${dump}.manifest.json`), false, 'كُتبَ بيانٌ لنسخةٍ فاشلة');
      // اتصالاتُ المجمَّعِ الساكنةُ قُطعَت مع اتصالِ الأداة؛ يُعيدُ المجمَّعُ الاتصالَ هنا.
      assert.deepEqual(await stagingLeftovers(source.pool), []);
    } finally {
      await source.drop();
    }
  },
);

test(
  'WL-594: جدولٌ مرحليٌّ متروكٌ في `state` لا يتسمّمُ به النسخ — يُستثنى من `pg_dump` ويُسمّى ولا يُحذَف، والاستعادةُ تنجح',
  { skip: skipWithoutDatabase, timeout: PER_TEST_TIMEOUT_MS },
  async () => {
    const source = await createIsolatedDatabase('backleftsrc');
    const target = await createIsolatedDatabase('backleftdst');
    const dump = path.join(
      registerTmpRoot(fs.mkdtempSync(path.join(os.tmpdir(), 'backup-leftover-'))),
      'state.dump',
    );
    // ‏اسمٌ يطابقُ نمطَ الأداةِ كما يتركُه نسخٌ سابقٌ انقطعَ قبلَ `WL-591`/`WL-592`، أو نسخٌ
    // متزامنٌ التزمَ جدولَه ولم يحذفْه بعد. فيه صفٌّ زائدٌ كي يظهرَ أيُّ تسرّبٍ في العدّ.
    // ‏جدولانِ لا واحد: الاستثناءُ لكلِّ جدولٍ غريبٍ لا لأوّلِه وحدَه.
    const leftovers = [
      '__backup_schema_migrations_0123456789ab',
      '__backup_schema_migrations_ba9876543210',
    ];
    try {
      await up(source.pool);
      await seedEveryTable(source.pool);
      const expectedCounts = await stateRowCounts(source.pool);
      const expectedDigest = await contentsDigest(source.pool);
      for (const leftover of leftovers) {
        await source.pool.query(
          `CREATE TABLE ${quoteIdent(STATE_SCHEMA)}.${quoteIdent(leftover)} AS
           SELECT * FROM public.schema_migrations
           UNION ALL SELECT * FROM public.schema_migrations LIMIT 1`,
        );
      }
      const sourceUrl = databaseUrlFor(source.name);

      const backup = await runNode([BACKUP_SCRIPT, 'create', dump], sourceUrl);
      assert.equal(backup.code, 0, backup.stderr);
      assert.match(backup.stderr, /\[BACKUP_STAGING_EXCLUDED\]/);
      for (const leftover of leftovers) {
        assert.ok(backup.stderr.includes(`${STATE_SCHEMA}.${leftover}`), backup.stderr);
      }
      const manifest = JSON.parse(fs.readFileSync(`${dump}.manifest.json`, 'utf8'));
      assert.deepEqual(manifest.rowCounts, expectedCounts);
      assert.ok(!leftovers.includes(manifest.ledgerStagingTable));

      // ‏الحاويةُ نفسُها لا تحملُ الجدولَ المتروك (‏لا العدُّ وحدَه).
      const list = await new Promise((resolve, reject) => {
        const child = spawn(process.env['PG_RESTORE'] ?? 'pg_restore', ['--list', dump]);
        let out = '';
        child.stdout.on('data', (chunk) => (out += chunk));
        child.on('error', reject);
        child.on('close', (code) =>
          code === 0 ? resolve(out) : reject(new Error(`code ${code}`)),
        );
      });
      for (const leftover of leftovers) {
        assert.ok(!String(list).includes(leftover), `${leftover} في الحاوية`);
      }
      assert.ok(
        String(list).includes(manifest.ledgerStagingTable),
        'دفترُ النسخةِ غائبٌ عن الحاوية',
      );

      const restore = await runNode([RESTORE_SCRIPT, dump, '--database', target.name], sourceUrl);
      assert.equal(restore.code, 0, restore.stderr);
      assert.deepEqual(await stateRowCounts(target.pool), expectedCounts);
      assert.equal(await contentsDigest(target.pool), expectedDigest);

      // ‏لا حذفَ تلقائيّ: قد يكونُ جدولَ نسخٍ متزامنٍ حيّ — حذفُه قرارُ المشغِّل.
      const still = await source.pool.query(
        `SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = $1 AND c.relname = ANY($2::text[])`,
        [STATE_SCHEMA, leftovers],
      );
      assert.equal(still.rowCount, leftovers.length);
    } finally {
      await target.drop();
      await source.drop();
    }
  },
);

test(
  'WL-594: نسخٌ بلا جدولٍ متروكٍ لا يطبعُ تحذيرَ الاستثناء',
  { skip: skipWithoutDatabase, timeout: PER_TEST_TIMEOUT_MS },
  async () => {
    const source = await createIsolatedDatabase('backnoleft');
    const dump = path.join(
      registerTmpRoot(fs.mkdtempSync(path.join(os.tmpdir(), 'backup-noleft-'))),
      'state.dump',
    );
    try {
      await up(source.pool);
      const backup = await runNode([BACKUP_SCRIPT, 'create', dump], databaseUrlFor(source.name));
      assert.equal(backup.code, 0, backup.stderr);
      assert.doesNotMatch(backup.stderr, /BACKUP_STAGING_EXCLUDED/);
    } finally {
      await source.drop();
    }
  },
);

/**
 * ‏`WL-598`: مُحمَّلٌ مسبقٌ (‏`--import`) في عمليّةِ `backup.mjs` وحدَها يقعُ **حتماً** في الشبّاكِ بينَ
 * التزامِ الدفترِ المرحليِّ وتأسيسِ لقطةِ النسخ: يعترضُ `BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ`
 * (‏أوّلَ عبارةٍ بعدَ `COMMIT` الدفترِ المرحليّ)، فيُنفِّذُ فعلَه على اتصالٍ آخرَ ويلتزمُه، ثمّ يُطلِقُ
 * العبارة. لا `sleep` ولا توقيت: الشبّاكُ يقعُ بترتيبِ العبارات. ‏`up` ⇒ هجرةٌ حقيقيّةٌ بالمُهاجر،
 * و`tamper` ⇒ تعديلُ صفٍّ في الدفتر بلا تغييرٍ في عددِه ولا في آخرِ نسخة.
 * @param {string} dir
 * @param {string} sourceUrl
 * @param {'up' | 'tamper'} action
 * @param {number} [to]
 * @returns {string}
 */
function writeLedgerGapHook(dir, sourceUrl, action, to = 0) {
  const hook = path.join(dir, `ledger-gap-${action}.mjs`);
  fs.writeFileSync(
    hook,
    [
      "import { createRequire } from 'node:module';",
      `const require = createRequire(${JSON.stringify(path.join(ROOT, 'package.json'))});`,
      "const pg = require('pg');",
      `const { up } = await import(${JSON.stringify(new URL('../../src/persistence/migrator.mjs', import.meta.url).href)});`,
      'const original = pg.Client.prototype.query;',
      'let fired = false;',
      'pg.Client.prototype.query = function (text, ...rest) {',
      "  const sql = typeof text === 'string' ? text : text?.text;",
      "  if (fired || typeof sql !== 'string' || !sql.startsWith('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ')) {",
      '    return original.call(this, text, ...rest);',
      '  }',
      '  fired = true;',
      '  return (async () => {',
      `    const pool = new pg.Pool({ connectionString: ${JSON.stringify(sourceUrl)}, max: 2 });`,
      '    try {',
      action === 'up'
        ? `      await up(pool, { to: ${to} });`
        : "      await pool.query(`UPDATE public.schema_migrations SET applied_by = 'wl-598-tamper' WHERE version = (SELECT min(version) FROM public.schema_migrations)`);",
      '    } finally {',
      '      await pool.end();',
      '    }',
      "    process.stderr.write('[XUUX_LEDGER_GAP_HOOK_FIRED]\\n');",
      '    return original.call(this, text, ...rest);',
      '  })();',
      '};',
      '',
    ].join('\n'),
  );
  return hook;
}

/**
 * @param {import('pg').Pool} pool
 * @returns {Promise<string[]>}
 */
async function stagingTablesIn(pool) {
  const r = await pool.query(
    `SELECT c.relname::text AS t FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'state' AND c.relname LIKE '\\_\\_backup\\_schema\\_migrations\\_%' ORDER BY 1`,
  );
  return r.rows.map((row) => String(/** @type {Record<string, unknown>} */ (row)['t']));
}

test(
  'WL-598: هجرةٌ تُلتزَمُ بينَ نسخِ الدفترِ ولقطةِ النسخ ⇒ BACKUP_LEDGER_SNAPSHOT_MISMATCH بلا ملفٍّ ولا بيان، ثمّ نسخةٌ بعدَها تُستعادُ بالنسخةِ الجديدة',
  { skip: skipWithoutDatabase, timeout: PER_TEST_TIMEOUT_MS },
  async () => {
    const source = await createIsolatedDatabase('ledgapsrc');
    const target = await createIsolatedDatabase('ledgapdst');
    const dir = registerTmpRoot(fs.mkdtempSync(path.join(os.tmpdir(), 'backup-ledgap-')));
    const dump = path.join(dir, 'state.dump');
    const sourceUrl = databaseUrlFor(source.name);
    try {
      await up(source.pool, { to: 20 });
      const hook = writeLedgerGapHook(dir, sourceUrl, 'up', 21);
      const backup = await runNode([BACKUP_SCRIPT, 'create', dump], sourceUrl, {
        NODE_OPTIONS: `${process.env['NODE_OPTIONS'] ?? ''} --import ${hook}`.trim(),
      });
      // الشبّاكُ وقعَ فعلاً: المُحمَّلُ أطلقَ والمصدرُ صارَ عندَ 21.
      assert.match(backup.stderr, /\[XUUX_LEDGER_GAP_HOOK_FIRED\]/);
      const ledger = await source.pool.query(
        'SELECT max(version)::int AS v FROM public.schema_migrations',
      );
      assert.equal(/** @type {Record<string, unknown>} */ (ledger.rows[0])['v'], 21);
      // الرفضُ مسمّى، ولا ملفَّ ولا بيانَ يُضلِّل، ولا جدولَ مرحليَّ باقٍ في المصدر.
      assert.equal(backup.code, 1, `${backup.stdout}\n${backup.stderr}`);
      assert.match(backup.stderr, /\[BACKUP_LEDGER_SNAPSHOT_MISMATCH\]/);
      assert.match(backup.stderr, /المنسوخُ 20 صفّاً حتى 20، واللقطةُ 21 صفّاً حتى 21/);
      assert.doesNotMatch(backup.stdout, /\[BACKUP_CREATED\]/);
      assert.equal(fs.existsSync(dump), false, 'بقيَ ملفُّ نسخةٍ بعدَ الرفض');
      assert.equal(fs.existsSync(`${dump}.manifest.json`), false, 'بقيَ بيانٌ بعدَ الرفض');
      assert.deepEqual(await stagingTablesIn(source.pool), []);

      // إعادةُ النسخِ بعدَ انتهاءِ الهجرةِ تُنتِجُ نسخةً متّسقةً تُستعادُ فعلاً بالنسخةِ 21.
      const again = await runNode([BACKUP_SCRIPT, 'create', dump], sourceUrl);
      assert.equal(again.code, 0, again.stderr);
      const manifest = JSON.parse(fs.readFileSync(`${dump}.manifest.json`, 'utf8'));
      assert.equal(manifest.migrationVersion, 21);
      const restore = await runNode([RESTORE_SCRIPT, dump, '--database', target.name], sourceUrl);
      assert.equal(restore.code, 0, `${restore.stdout}\n${restore.stderr}`);
      assert.match(restore.stdout, /\[RESTORE_OK\]/);
      const restored = await target.pool.query(
        'SELECT to_jsonb(m)::text AS m FROM public.schema_migrations m ORDER BY version',
      );
      const original = await source.pool.query(
        'SELECT to_jsonb(m)::text AS m FROM public.schema_migrations m ORDER BY version',
      );
      assert.deepEqual(restored.rows, original.rows);
    } finally {
      await target.drop();
      await source.drop();
    }
  },
);

test(
  'WL-598: تعديلُ صفٍّ في الدفترِ في الشبّاكِ نفسِه بلا تغييرِ عددٍ ولا آخرِ نسخة ⇒ رفضٌ بالمحتوى لا بالرقم',
  { skip: skipWithoutDatabase, timeout: PER_TEST_TIMEOUT_MS },
  async () => {
    const source = await createIsolatedDatabase('ledtampsrc');
    const dir = registerTmpRoot(fs.mkdtempSync(path.join(os.tmpdir(), 'backup-ledtamp-')));
    const dump = path.join(dir, 'state.dump');
    const sourceUrl = databaseUrlFor(source.name);
    try {
      await up(source.pool, { to: 20 });
      const hook = writeLedgerGapHook(dir, sourceUrl, 'tamper');
      const backup = await runNode([BACKUP_SCRIPT, 'create', dump], sourceUrl, {
        NODE_OPTIONS: `${process.env['NODE_OPTIONS'] ?? ''} --import ${hook}`.trim(),
      });
      assert.match(backup.stderr, /\[XUUX_LEDGER_GAP_HOOK_FIRED\]/);
      const tampered = await source.pool.query(
        "SELECT count(*)::int AS n FROM public.schema_migrations WHERE applied_by = 'wl-598-tamper'",
      );
      assert.equal(/** @type {Record<string, unknown>} */ (tampered.rows[0])['n'], 1);
      assert.equal(backup.code, 1, `${backup.stdout}\n${backup.stderr}`);
      assert.match(backup.stderr, /\[BACKUP_LEDGER_SNAPSHOT_MISMATCH\]/);
      assert.match(backup.stderr, /المنسوخُ 20 صفّاً حتى 20، واللقطةُ 20 صفّاً حتى 20/);
      assert.equal(fs.existsSync(dump), false);
      assert.equal(fs.existsSync(`${dump}.manifest.json`), false);
      assert.deepEqual(await stagingTablesIn(source.pool), []);
    } finally {
      await source.drop();
    }
  },
);

test(
  'WL-591: النسخُ يُنادي `pg_dump` بـ`--no-owner` و`--no-privileges` و`--snapshot` والمخطّطَين',
  { skip: skipWithoutDatabase, timeout: PER_TEST_TIMEOUT_MS },
  async () => {
    const source = await createIsolatedDatabase('dumpargs');
    const dir = registerTmpRoot(fs.mkdtempSync(path.join(os.tmpdir(), 'backup-dumpargs-')));
    const dump = path.join(dir, 'state.dump');
    try {
      await up(source.pool);
      const { wrapper, argsLog } = await dumpWrapper(dir, {});
      const backup = await runNode([BACKUP_SCRIPT, 'create', dump], databaseUrlFor(source.name), {
        PG_DUMP: wrapper,
      });
      assert.equal(backup.code, 0, backup.stderr);
      // عقدُ وسائطَ لا سلوك: النسخُ والاستعادةُ في الاختبارِ بدورٍ واحدٍ فائق، فلا يُرى
      // فرقُ الملكيّةِ ولا الصلاحيّاتِ سلوكيّاً هنا — حدٌّ مكتوبٌ في `WL-591`.
      const args = fs.readFileSync(argsLog, 'utf8').split('\n');
      for (const flag of ['--format=custom', '--no-owner', '--no-privileges', '--snapshot']) {
        assert.ok(args.includes(flag), `pg_dump نُودي بلا ${flag}`);
      }
      const schemas = args.flatMap((arg, i) => (args[i - 1] === '--schema' ? [arg] : []));
      assert.deepEqual(schemas.sort(), ['fence', 'state']);
    } finally {
      await source.drop();
    }
  },
);

test(
  'WL-591: verify يرفضُ حاويةً لا يقرؤها `pg_restore` ولو طابقت بصمتُها البيان',
  { skip: skipWithoutDatabase, timeout: PER_TEST_TIMEOUT_MS },
  async () => {
    const { source, sourceUrl, dump } = await seededBackup('unreadable');
    try {
      fs.writeFileSync(dump, 'not a custom-format archive\n', 'utf8');
      const digest = crypto.createHash('sha256').update(fs.readFileSync(dump)).digest('hex');
      editManifest(dump, (m) => {
        m.sha256 = digest;
      });
      const verified = await runNode([BACKUP_SCRIPT, 'verify', dump], sourceUrl);
      assert.equal(verified.code, 1, verified.stdout);
      assert.match(verified.stderr, /\[BACKUP_DUMP_UNREADABLE\]/);
    } finally {
      await source.drop();
    }
  },
);

for (const [label, edit] of /** @type {Array<[string, (m: Record<string, any>) => void]>} */ ([
  [
    'بصمةٌ ليست نصّاً',
    (m) => {
      m.sha256 = 123;
    },
  ],
  [
    'اسمُ جدولٍ مرحليٍّ خارجَ النمط',
    (m) => {
      m.ledgerStagingTable = 'schema_migrations"; DROP TABLE x; --';
    },
  ],
  [
    'نسخةُ هجرةٍ نصّيّة',
    (m) => {
      m.migrationVersion = String(m.migrationVersion);
    },
  ],
  [
    'مدّةٌ غيرُ صحيحة',
    (m) => {
      m.durationMs = 1.5;
    },
  ],
  [
    'عدّاداتٌ فارغةُ القيمة',
    (m) => {
      m.rowCounts = null;
    },
  ],
])) {
  test(
    `WL-591: بيانٌ فيه ${label} ⇒ BACKUP_MANIFEST_INVALID`,
    { skip: skipWithoutDatabase, timeout: PER_TEST_TIMEOUT_MS },
    async () => {
      const { source, sourceUrl, dump } = await seededBackup('manifest');
      try {
        editManifest(dump, edit);
        const verified = await runNode([BACKUP_SCRIPT, 'verify', dump], sourceUrl);
        assert.equal(verified.code, 1, verified.stdout);
        assert.match(verified.stderr, /\[BACKUP_MANIFEST_INVALID\]/);
      } finally {
        await source.drop();
      }
    },
  );
}

test(
  'WL-591: verify يُسمّي الغائبَ — النسخةُ (‏FILE_MISSING) أو البيانُ (‏MANIFEST_MISSING)',
  { skip: skipWithoutDatabase, timeout: PER_TEST_TIMEOUT_MS },
  async () => {
    const { source, sourceUrl, dump } = await seededBackup('missing');
    try {
      const manifest = fs.readFileSync(`${dump}.manifest.json`, 'utf8');
      fs.rmSync(`${dump}.manifest.json`);
      const noManifest = await runNode([BACKUP_SCRIPT, 'verify', dump], sourceUrl);
      assert.equal(noManifest.code, 1);
      assert.match(noManifest.stderr, /\[BACKUP_MANIFEST_MISSING\]/);

      fs.writeFileSync(`${dump}.manifest.json`, manifest, 'utf8');
      fs.rmSync(dump);
      const noDump = await runNode([BACKUP_SCRIPT, 'verify', dump], sourceUrl);
      assert.equal(noDump.code, 1);
      assert.match(noDump.stderr, /\[BACKUP_FILE_MISSING\]/);
    } finally {
      await source.drop();
    }
  },
);

for (const [label, args, url, code] of /** @type {Array<[string, string[], string, string]>} */ ([
  ['أمرٌ مجهول', ['bogus', '/tmp/none.dump'], 'postgres://x@h/db', 'BACKUP_ARGUMENT'],
  ['verify بلا مسار', ['verify'], 'postgres://x@h/db', 'BACKUP_ARGUMENT'],
  [
    'create مع DATABASE_URL فارغة',
    ['create', '/tmp/wl591-none.dump'],
    '',
    'BACKUP_DATABASE_URL_MISSING',
  ],
])) {
  test(
    `WL-591: ${label} يُرفضُ بـ${code} قبلَ أيِّ اتصال`,
    { timeout: PER_TEST_TIMEOUT_MS },
    async () => {
      const result = await runNode([BACKUP_SCRIPT, ...args], url);
      assert.equal(result.code, 1);
      assert.match(result.stderr, new RegExp(`\\[${code}\\]`));
    },
  );
}

/**
 * ‏`WL-597`: `--force` على هدفٍ يُفترَضُ رفضُه، والصورةُ قبلُ وبعدُ متطابقة.
 * @param {{ dump: string, sourceUrl: string }} backup
 * @param {string} database
 * @param {import('pg').Pool} pool
 * @param {string} code
 * @param {string} why
 */
async function assertForceRefused(backup, database, pool, code, why) {
  const before = await targetImage(pool);
  const restore = await runNode(
    [RESTORE_SCRIPT, backup.dump, '--database', database, '--force'],
    backup.sourceUrl,
  );
  assert.equal(restore.code, 1, `${why}: ${restore.stdout}`);
  assert.match(restore.stderr, new RegExp(`\\[${code}\\]`), why);
  // السياجُ قائمٌ قبلَ الطلب: يرفضُه الفحصُ نفسُه، لا الحجزُ وحدَه (‏الحجزُ للسباق).
  assert.match(restore.stderr, /مخطّطُ fence موجود/, why);
  assert.doesNotMatch(restore.stdout, /RESTORE_OK/, why);
  assert.equal(await targetImage(pool), before, `${why}: الرفضُ غيّرَ الهدف`);
}

/**
 * @param {import('pg').Pool} pool
 * @returns {Promise<string>}
 */
async function fenceState(pool) {
  const r = await pool.query(`SELECT fence.effective_state()->>'state' AS s`);
  return String(/** @type {Record<string, unknown>} */ (r.rows[0])['s']);
}

test(
  'WL-597: `--force` يرفضُ كلَّ هدفٍ مُسيَّج (‏HALTED وRUNNING وRECOVERY_REQUIRED ومُهاجَراً بلا إقلاع) ولا يمسُّه',
  { skip: skipWithoutDatabase, timeout: PER_TEST_TIMEOUT_MS },
  async () => {
    const backup = await seededBackup('fenced');
    // المُهاجَرُ بلا إقلاعٍ يُنشأُ **قبلَ** الحزام: الحزامُ يحتوي وصولَ PUBLIC إلى قواعدِ العنقودِ القائمة،
    // وقاعدةٌ تُنشأُ بعدَه يراها `check_fenced()` وصولاً فلا يكتملُ الإيقافُ قبلَ الاستئناف.
    const unbooted = await createIsolatedDatabase('fencedunbooted');
    await up(unbooted.pool);
    await seedEveryTable(unbooted.pool);
    const h = await harness('wl597fenced');
    const restoredName = `fencedrr_${crypto.randomBytes(4).toString('hex')}`;
    /** @type {import('pg').Pool | undefined} */
    let restoredPool;
    try {
      // نسخةٌ من الهدفِ المُقلَعِ نفسِه، تُستعادُ إلى قاعدةٍ نظيفةٍ فتصيرُ RECOVERY_REQUIRED (‏بلا --force).
      const haltedDump = path.join(backup.dir, 'halted.dump');
      const taken = await runNode([BACKUP_SCRIPT, 'create', haltedDump], databaseUrlFor(h.db.name));
      assert.equal(taken.code, 0, taken.stderr);

      assert.equal(await fenceState(h.db.pool), 'HALTED');
      await assertForceRefused(backup, h.db.name, h.db.pool, 'RESTORE_TARGET_FENCED', 'HALTED');

      await h.resume();
      assert.equal(await fenceState(h.db.pool), 'RUNNING');
      await assertForceRefused(backup, h.db.name, h.db.pool, 'RESTORE_TARGET_FENCED', 'RUNNING');

      const placed = await runNode(
        [RESTORE_SCRIPT, haltedDump, '--database', restoredName],
        backup.sourceUrl,
      );
      assert.equal(placed.code, 0, placed.stderr);
      restoredPool = new pg.Pool({ connectionString: databaseUrlFor(restoredName), max: 1 });
      assert.equal(await fenceState(restoredPool), 'RECOVERY_REQUIRED');
      await assertForceRefused(
        backup,
        restoredName,
        restoredPool,
        'RESTORE_TARGET_FENCED',
        'RECOVERY_REQUIRED',
      );

      // مُهاجَرٌ إلى 0024 أو بعدَها ولم يُقلَعْ قطّ: مُسيَّجٌ أيضاً، و`--force` لا يستبدلُه.
      assert.equal(await fenceSchemaPresent(unbooted.pool), true);
      await assertForceRefused(
        backup,
        unbooted.name,
        unbooted.pool,
        'RESTORE_TARGET_FENCED',
        'مُهاجَرٌ بلا إقلاع',
      );
    } finally {
      await restoredPool?.end();
      await backup.source.pool.query(
        `DROP DATABASE IF EXISTS ${quoteIdent(restoredName)} WITH (FORCE)`,
      );
      await unbooted.drop();
      await h.close();
      await backup.source.drop();
    }
  },
);

for (const [label, prepare, detail] of /** @type {const} */ ([
  [
    'قادحُ أحداثٍ xf_* بلا مخطّطِ fence',
    async (/** @type {import('pg').Pool} */ pool) => {
      // ‏`WL-599`: جدولٌ جانبيٌّ خارجَ `state` و`fence` بصفٍّ ومتسلسلة، لتقيسَ الصورةُ ما وراءَهما.
      await pool.query(
        `CREATE TABLE public.wl599_side (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, note text)`,
      );
      await pool.query(`INSERT INTO public.wl599_side (note) VALUES ('kept')`);
      await pool.query(
        `CREATE FUNCTION public.wl597_noop() RETURNS event_trigger LANGUAGE plpgsql AS $f$BEGIN END$f$`,
      );
      await pool.query(
        'CREATE EVENT TRIGGER xf_ddl_start ON ddl_command_start EXECUTE FUNCTION public.wl597_noop()',
      );
    },
    /قادح xf_ddl_start/,
  ],
  [
    'دفترٌ فيه الهجرةُ 0024 بلا مخطّطِ fence',
    async (/** @type {import('pg').Pool} */ pool) => {
      await pool.query(
        `INSERT INTO public.schema_migrations (version, name, checksum, applied_by)
         VALUES (24, 'fence', repeat('0', 64), 'wl597-test')`,
      );
    },
    /الهجرة 24/,
  ],
  [
    'فحصٌ يتعذّر (‏دفترٌ بلا عمودِ version)',
    async (/** @type {import('pg').Pool} */ pool) => {
      await pool.query('ALTER TABLE public.schema_migrations RENAME COLUMN version TO v');
    },
    /تعذّرَ فحصُ السياج.*42703/,
  ],
])) {
  test(
    `WL-597: ${label} ⇒ RESTORE_FENCE_CHECK_FAILED، رفضٌ مغلقٌ والهدفُ كما هو`,
    { skip: skipWithoutDatabase, timeout: PER_TEST_TIMEOUT_MS },
    async () => {
      const backup = await seededBackup('fencecheck');
      const target = await createIsolatedDatabase('fencecheckdst');
      try {
        await up(target.pool, { to: 23 });
        await prepare(target.pool);
        assert.equal(await fenceSchemaPresent(target.pool), false);
        const before = await targetImage(target.pool);
        const restore = await runNode(
          [RESTORE_SCRIPT, backup.dump, '--database', target.name, '--force'],
          backup.sourceUrl,
        );
        assert.equal(restore.code, 1, restore.stdout);
        assert.match(restore.stderr, /\[RESTORE_FENCE_CHECK_FAILED\]/);
        assert.match(restore.stderr, detail);
        assert.doesNotMatch(restore.stdout, /RESTORE_OK/);
        assert.equal(await targetImage(target.pool), before, 'الرفضُ المغلقُ غيّرَ الهدف');
      } finally {
        await target.drop();
        await backup.source.drop();
      }
    },
  );
}

/**
 * ‏`WL-597`: هدفٌ غيرُ مُسيَّجٍ مشغول (‏مُهاجَرٌ إلى 23 وفيه صفّ) وجلستان عليه.
 * @param {string} label
 */
async function raceTarget(label) {
  const target = await createIsolatedDatabase(label);
  await up(target.pool, { to: 23 });
  await target.pool.query(
    `INSERT INTO state.models (id, name, provider, purpose, fingerprint, status, model_version)
     VALUES ('stale-model', 'Stale', 'internal', 'operations', $1, 'registered', '0.0.1')`,
    ['f'.repeat(64)],
  );
  const holder = new pg.Client({ connectionString: databaseUrlFor(target.name) });
  const creator = new pg.Client({ connectionString: databaseUrlFor(target.name) });
  await holder.connect();
  await creator.connect();
  const pid = async (/** @type {pg.Client} */ c) =>
    Number((await c.query('SELECT pg_backend_pid() AS p')).rows[0].p);
  return {
    target,
    holder,
    creator,
    pids: [await pid(holder), await pid(creator)],
    close: async () => {
      await holder.end().catch(() => undefined);
      await creator.end().catch(() => undefined);
      await target.drop();
    },
  };
}

test(
  'WL-597 TOCTOU (A): سياجٌ يُنشأُ ويُلتزَمُ بعدَ فحصِ المخطّطِ وقبلَ المحو ⇒ الحجزُ يرفضُ والهدفُ كما هو',
  { skip: skipWithoutDatabase, timeout: PER_TEST_TIMEOUT_MS },
  async () => {
    const backup = await seededBackup('raceA');
    const race = await raceTarget('raceA');
    try {
      const before = await targetImage(race.target.pool);
      // يُعلِّقُ الاستعادةَ عندَ قراءةِ الدفترِ في الفحص — بعدَ أن رأت `to_regnamespace('fence')` غائباً.
      await race.holder.query('BEGIN');
      await race.holder.query('LOCK TABLE public.schema_migrations IN ACCESS EXCLUSIVE MODE');
      const running = runNode(
        [RESTORE_SCRIPT, backup.dump, '--database', race.target.name, '--force'],
        backup.sourceUrl,
      );
      assert.ok(
        await waitForLockWait(
          backup.source.pool,
          race.target.name,
          '%FROM public."schema_migrations" WHERE version%',
          race.pids,
        ),
        'الاستعادةُ لم تقف عندَ قراءةِ الدفترِ في الفحص',
      );
      await race.creator.query('CREATE SCHEMA fence');
      await race.holder.query('COMMIT');
      const restore = await running;
      assert.equal(restore.code, 1, restore.stdout);
      assert.match(restore.stderr, /\[RESTORE_TARGET_FENCED\]/);
      assert.match(restore.stderr, /أثناءَ الفحص/);
      assert.equal(
        await targetImage(race.target.pool, { omitSchema: 'fence' }),
        before,
        'محوٌ بعدَ إنشاءِ السياج',
      );
    } finally {
      await race.close();
      await backup.source.drop();
    }
  },
);

for (const finish of /** @type {const} */ (['COMMIT', 'ROLLBACK'])) {
  test(
    `WL-597 TOCTOU (B-${finish}): \`CREATE SCHEMA fence\` غيرُ مُلتزَمٍ قبلَ الاستعادة ⇒ الحجزُ ينتظرُه، ثمّ ${finish === 'COMMIT' ? 'يرفضُ والهدفُ كما هو' : 'يمضي ويستعيد'}`,
    { skip: skipWithoutDatabase, timeout: PER_TEST_TIMEOUT_MS },
    async () => {
      const backup = await seededBackup(`raceB${finish}`);
      const race = await raceTarget(`raceB${finish}`);
      try {
        const before = await targetImage(race.target.pool);
        await race.creator.query('BEGIN');
        await race.creator.query('CREATE SCHEMA fence');
        const running = runNode(
          [RESTORE_SCRIPT, backup.dump, '--database', race.target.name, '--force'],
          backup.sourceUrl,
        );
        assert.ok(
          await waitForLockWait(
            backup.source.pool,
            race.target.name,
            'CREATE SCHEMA "fence"',
            race.pids,
          ),
          'الحجزُ لم ينتظر إنشاءَ السياجِ غيرَ المُلتزَم',
        );
        await race.creator.query(finish);
        const restore = await running;
        if (finish === 'COMMIT') {
          assert.equal(restore.code, 1, restore.stdout);
          assert.match(restore.stderr, /\[RESTORE_TARGET_FENCED\]/);
          assert.equal(
            await targetImage(race.target.pool, { omitSchema: 'fence' }),
            before,
            'محوٌ بعدَ التزامِ السياج',
          );
        } else {
          assert.equal(restore.code, 0, restore.stderr);
          assert.match(restore.stdout, /\[RESTORE_OK\]/);
          assert.equal(await contentsDigest(race.target.pool), backup.sourceDigest);
        }
      } finally {
        await race.close();
        await backup.source.drop();
      }
    },
  );
}

test(
  'WL-597 TOCTOU (C): بعدَ الحجزِ ينتظرُ إنشاءُ السياجِ التزامَ المحو — ونافذةُ ما بعدَ الالتزامِ قائمة (‏خطرٌ متبقٍّ معلَن)',
  { skip: skipWithoutDatabase, timeout: PER_TEST_TIMEOUT_MS },
  async () => {
    const backup = await seededBackup('raceC');
    const race = await raceTarget('raceC');
    try {
      // يُعلِّقُ الاستعادةَ بعدَ الحجزِ عندَ `DROP SCHEMA state` (‏قفلٌ مشتركٌ على جدولٍ فيه).
      await race.holder.query('BEGIN');
      await race.holder.query('SELECT count(*) FROM state.models');
      const running = runNode(
        [RESTORE_SCRIPT, backup.dump, '--database', race.target.name, '--force'],
        backup.sourceUrl,
      );
      assert.ok(
        await waitForLockWait(
          backup.source.pool,
          race.target.name,
          'DROP SCHEMA IF EXISTS "state"%',
          race.pids,
        ),
        'الاستعادةُ لم تقف عندَ المحوِ بعدَ الحجز',
      );
      /** @type {string[]} */
      const order = [];
      const creating = race.creator.query('CREATE SCHEMA fence').then(
        () => order.push('fence-created'),
        (/** @type {any} */ error) => order.push(`fence-failed:${error.code}`),
      );
      assert.ok(
        await waitForLockWait(backup.source.pool, race.target.name, 'CREATE SCHEMA fence', [
          race.pids[0] ?? 0,
        ]),
        'إنشاءُ السياجِ لم ينتظر الحجز',
      );
      assert.deepEqual(order, [], 'أُنشئَ السياجُ قبلَ التزامِ المحو');
      await race.holder.query('COMMIT');
      await creating;
      const restore = await running;
      // السياجُ أُنشئَ **بعدَ** التزامِ المحو، فلا محوَ بعدَ سياج. لكنّه أُنشئَ قبلَ `pg_restore`: النسخةُ
      // مُسيَّجة، فيسقطُ `pg_restore` عندَ `CREATE SCHEMA fence` ويبقى الهدفُ ممحوّاً. هذه نافذةُ ما بعدَ
      // الالتزام، **غيرُ مغلقة** (‏`WL-597`، خطرٌ متبقٍّ في `docs/RECOVERY.md`)؛ يثبتُها الاختبارُ ولا يُخفيها.
      assert.deepEqual(order, ['fence-created']);
      assert.equal(restore.code, 1, restore.stdout);
      assert.match(restore.stderr, /\[RESTORE_COMMAND_FAILED\]/);
      const stale = await race.target.pool.query(
        `SELECT to_regclass('state.models') IS NOT NULL AS present`,
      );
      if (stale.rows[0].present === true) {
        const row = await race.target.pool.query(
          `SELECT 1 FROM state.models WHERE id = 'stale-model'`,
        );
        assert.equal(row.rowCount, 0, 'الصفُّ القديمُ باقٍ: لم يحدث المحو');
      }
      // الهدفُ ممحوٌّ: لا صفَّ قديم، والسياجُ الفارغُ الذي أُنشئَ في النافذةِ حاضر.
      assert.equal(await fenceSchemaPresent(race.target.pool), true);
      // الحالةُ النهائيّةُ بدقّة (‏`WL-599`): `pg_restore --exit-on-error` يسقطُ عندَ أوّلِ عنصرٍ في النسخة
      // المُسيَّجةِ يصطدمُ بالسياج، فلا يُنشأُ `state` ولا الدفتر، والسياجُ فارغٌ تماماً. هذا ما يصفُه
      // `docs/RECOVERY.md` تحتَ `LIVE-78`؛ النافذةُ مقيسةٌ وغيرُ مغلقة.
      assert.match(restore.stderr, /schema "fence" already exists/);
      const finalState = await race.target.pool.query(
        `SELECT to_regnamespace('state') IS NULL AS state_absent,
                to_regclass('public.schema_migrations') IS NULL AS ledger_absent,
                (SELECT count(*)::int FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                  WHERE n.nspname = 'fence') AS fence_relations,
                (SELECT count(*)::int FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                  WHERE n.nspname = 'fence') AS fence_functions`,
      );
      assert.deepEqual(finalState.rows[0], {
        state_absent: true,
        ledger_absent: true,
        fence_relations: 0,
        fence_functions: 0,
      });
    } finally {
      await race.close();
      await backup.source.drop();
    }
  },
);

/**
 * ‏`WL-600`: مُحمَّلٌ مسبقٌ (‏`--import`) في عمليّةِ `restore.mjs` يعترضُ عبارةً من معاملةِ المحو. حتميٌّ
 * بترتيبِ العبارات، بلا `sleep`:
 *   - `after`: يُنفِّذُ `COMMIT` الحقيقيَّ ثمّ يهدمُ المقبسَ ويرفضُ بخطأِ اتصال ⇒ المحوُ مُلتزَمٌ والأداةُ
 *     لا ترى الردّ (‏انقطاعٌ بعدَ الالتزامِ وقبلَ التأكيد).
 *   - `before`: يهدمُ المقبسَ عندَ `COMMIT` ويرفضُ بلا إرسال ⇒ الخادمُ يُجهِضُ المعاملة، والأداةُ لا تعرف.
 *   - `fatal`: يستبدلُ بـ`COMMIT` إنهاءَ الجلسةِ نفسِها ⇒ ردٌّ بدرجةِ `FATAL` (‏`57P01`) لا يُقطَعُ معه.
 *   - `error`: يستبدلُ بـ`COMMIT` عبارةَ `SELECT 1/0` ⇒ ردٌّ قطعيٌّ بدرجةِ `ERROR` (‏`22012`).
 *   - `drop`: يهدمُ المقبسَ عندَ `DROP TABLE … schema_migrations` قبلَ `COMMIT` ⇒ فشلٌ قطعيّ.
 * @param {string} dir
 * @param {'after' | 'before' | 'fatal' | 'error' | 'drop'} mode
 * @returns {string}
 */
function writeCommitOutcomeHook(dir, mode) {
  const hook = path.join(dir, `commit-outcome-${mode}.mjs`);
  const trigger =
    mode === 'drop'
      ? 'sql.startsWith(\'DROP TABLE IF EXISTS public."schema_migrations"\')'
      : "sql === 'COMMIT'";
  const action = {
    after:
      '  return original.call(this, text).then(() => { this.connection.stream.destroy(); throw lost(); });',
    before: '  this.connection.stream.destroy(); return Promise.reject(lost());',
    drop: '  this.connection.stream.destroy(); return Promise.reject(lost());',
    fatal: "  return original.call(this, 'SELECT pg_terminate_backend(pg_backend_pid())');",
    error: "  return original.call(this, 'SELECT 1/0');",
  }[mode];
  fs.writeFileSync(
    hook,
    [
      "import { createRequire } from 'node:module';",
      `const require = createRequire(${JSON.stringify(path.join(ROOT, 'package.json'))});`,
      "const pg = require('pg');",
      'const original = pg.Client.prototype.query;',
      'let fired = false;',
      'pg.Client.prototype.query = function (text, ...rest) {',
      "  const sql = typeof text === 'string' ? text : text?.text;",
      `  if (fired || typeof sql !== 'string' || !(${trigger})) return original.call(this, text, ...rest);`,
      '  fired = true;',
      `  process.stderr.write('[XUUX_COMMIT_HOOK_FIRED:${mode}]\\n');`,
      "  const lost = () => new Error('Connection terminated unexpectedly');",
      action,
      '};',
      '',
    ].join('\n'),
  );
  return hook;
}

/**
 * ‏`WL-600`: ينتظرُ ألّا تبقى على الهدفِ جلسةٌ تحملُ معاملةً (‏`backend_xid`) — جلسةُ الأداةِ بعدَ هدمِ
 * مقبسِها. رصدُ حالٍ لا مهلة؛ والحدُّ الزمنيُّ لكشفِ التعليقِ وحدَه.
 * @param {import('pg').Pool} pool
 * @param {string} database
 * @returns {Promise<boolean>}
 */
async function waitForNoOpenTransaction(pool, database) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const r = await pool.query(
      `SELECT 1 FROM pg_stat_activity
       WHERE datname = $1 AND pid <> pg_backend_pid() AND backend_xid IS NOT NULL`,
      [database],
    );
    if ((r.rowCount ?? 0) === 0) return true;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return false;
}

/**
 * ‏`WL-600`: هدفٌ غيرُ مُسيَّجٍ مُهاجَرٌ إلى 23 وفيه صفّ، و`restore --force` عليه بمُحمَّلِ `mode`.
 * @param {{ dump: string, dir: string, sourceUrl: string, source: { pool: import('pg').Pool } }} backup
 * @param {{ name: string }} target
 * @param {'after' | 'before' | 'fatal' | 'error' | 'drop'} mode
 */
async function forceWithCommitHook(backup, target, mode) {
  const restore = await runNode(
    [RESTORE_SCRIPT, backup.dump, '--database', target.name, '--force'],
    backup.sourceUrl,
    {
      NODE_OPTIONS:
        `${process.env['NODE_OPTIONS'] ?? ''} --import ${writeCommitOutcomeHook(backup.dir, mode)}`.trim(),
    },
  );
  assert.match(restore.stderr, new RegExp(`\\[XUUX_COMMIT_HOOK_FIRED:${mode}\\]`), mode);
  assert.equal(restore.code, 1, `${mode}: ${restore.stdout}`);
  assert.doesNotMatch(restore.stdout, /RESTORE_OK/, mode);
  // لا انهيارَ بحدثِ `error` غيرِ مُعالَج: الرمزُ يُسمّى دائماً.
  assert.doesNotMatch(restore.stderr, /Unhandled 'error' event/, mode);
  assert.match(restore.stderr, /⛔ \[/, mode);
  assert.ok(
    await waitForNoOpenTransaction(backup.source.pool, target.name),
    `${mode}: بقيت معاملةُ الأداةِ مفتوحةً على الهدف`,
  );
  return restore;
}

/**
 * @param {import('pg').Pool} pool
 */
async function seedStaleTarget(pool) {
  await up(pool, { to: 23 });
  await pool.query(
    `INSERT INTO state.models (id, name, provider, purpose, fingerprint, status, model_version)
     VALUES ('stale-model', 'Stale', 'internal', 'operations', $1, 'registered', '0.0.1')`,
    ['f'.repeat(64)],
  );
}

const WIPE_UNKNOWN = /\[RESTORE_WIPE_OUTCOME_UNKNOWN\]/;

test(
  'WL-600: انقطاعٌ بعدَ التزامِ المحوِ وقبلَ تأكيدِه ⇒ RESTORE_WIPE_OUTCOME_UNKNOWN، والهدفُ ممحوٌّ فعلاً فلا يُدَّعى سليماً',
  { skip: skipWithoutDatabase, timeout: PER_TEST_TIMEOUT_MS },
  async () => {
    const backup = await seededBackup('commitafter');
    const target = await createIsolatedDatabase('commitafter');
    try {
      await seedStaleTarget(target.pool);
      const restore = await forceWithCommitHook(backup, target, 'after');
      assert.match(restore.stderr, WIPE_UNKNOWN);
      assert.match(restore.stderr, /لم يُشغَّلْ pg_restore/);
      assert.match(restore.stderr, /لا تفترضْ أنّه سليم/);
      assert.doesNotMatch(restore.stderr, /\[RESTORE_COMMAND_FAILED\]/);
      // المحوُ التُزِمَ فعلاً: لا `state` ولا دفترَ ولا `fence` المحجوز — فافتراضُ التراجعِ كانَ يكذب.
      const wiped = await target.pool.query(
        `SELECT to_regnamespace('state') IS NULL AS state_absent,
                to_regclass('public.schema_migrations') IS NULL AS ledger_absent,
                to_regnamespace('fence') IS NULL AS fence_absent`,
      );
      assert.deepEqual(wiped.rows[0], {
        state_absent: true,
        ledger_absent: true,
        fence_absent: true,
      });
    } finally {
      await target.drop();
      await backup.source.drop();
    }
  },
);

test(
  'WL-600: COMMIT لم يصل أو أُنهيَت الجلسةُ (‏FATAL) ⇒ RESTORE_WIPE_OUTCOME_UNKNOWN؛ وخطأُ ERROR على COMMIT أو انقطاعٌ قبلَه ⇒ فشلٌ قطعيّ — والهدفُ كما هو في الأربع',
  { skip: skipWithoutDatabase, timeout: PER_TEST_TIMEOUT_MS },
  async () => {
    const backup = await seededBackup('commitkeep');
    const target = await createIsolatedDatabase('commitkeep');
    try {
      await seedStaleTarget(target.pool);
      const before = await targetImage(target.pool);
      for (const mode of /** @type {const} */ (['before', 'fatal', 'error', 'drop'])) {
        const restore = await forceWithCommitHook(backup, target, mode);
        if (mode === 'before' || mode === 'fatal') {
          // لم يُلتزَمْ شيءٌ فعلاً، لكنّ الأداةَ لا تستطيعُ معرفةَ ذلك: لا تدّعي السلامة.
          assert.match(restore.stderr, WIPE_UNKNOWN, mode);
          assert.match(restore.stderr, /لا تفترضْ أنّه سليم/, mode);
        } else {
          assert.doesNotMatch(restore.stderr, WIPE_UNKNOWN, mode);
          assert.match(
            restore.stderr,
            mode === 'error' ? /\[22012\]/ : /Connection terminated unexpectedly/,
            mode,
          );
        }
        assert.equal(await targetImage(target.pool), before, `${mode}: الهدفُ تغيّر`);
      }
    } finally {
      await target.drop();
      await backup.source.drop();
    }
  },
);

// ═══ ‏`WL-606` — بصمةُ المحتوى (‏`LIVE-78/CONTENT-INTEGRITY`) ═══════════════════════════════════
// العقد: ‏`[RESTORE_OK]` = الأعدادُ ونسخةُ الهجرةِ **وبصمةُ المحتوى** طابقت. نسخةٌ بلا بصمة ⇒ رفضٌ قبلَ
// اللمس إلا بـ`--allow-unverified`، وحينَها `[RESTORE_UNVERIFIED]` لا يحوي `RESTORE_OK`. بصمةٌ تالفة ⇒
// ‏`BACKUP_DIGEST_INVALID`؛ صيغةٌ/إصدارٌ غيرُ مدعوم ⇒ `BACKUP_DIGEST_UNSUPPORTED`؛ مخالفةٌ بعدَ الاستعادة ⇒
// ‏`RESTORE_CONTENT_MISMATCH` والدفترُ غيرُ مُركَّب. اختباراتُ فشلِ الحسابِ وانقطاعِ الاتصال في
// ‏`tests/persistence/atomicity.test.mjs` (‏تحتاجُ جدولاً كبيراً، فلا تُثقِلُ مهلةَ هذا الملفّ).

/**
 * @param {import('pg').Pool} pool
 * @returns {Promise<boolean>}
 */
async function ledgerInstalled(pool) {
  const found = await pool.query(`SELECT to_regclass('public.schema_migrations') IS NOT NULL AS l`);
  return /** @type {Record<string, unknown>} */ (found.rows[0])['l'] === true;
}

/**
 * يعيدُ حسابَ البصمةِ العليا بعدَ تعديلٍ متعمَّد — يحاكي مَن يزوّرُ البيانَ متّسقاً مع نفسِه.
 * @param {Record<string, any>} digest
 */
function resealDigest(digest) {
  const { sha256: _old, ...body } = digest;
  digest.sha256 = crypto.createHash('sha256').update(canonicalJson(body), 'utf8').digest('hex');
}

test(
  'WL-606: نسخةٌ حديثةٌ تحملُ بصمةَ محتوىً سليمة، والاستعادةُ تعلنُ [RESTORE_OK] و[CONTENT_VERIFIED] معاً',
  { skip: skipWithoutDatabase, timeout: PER_TEST_TIMEOUT_MS },
  async () => {
    const { source, sourceUrl, dump } = await seededBackup('digestok');
    const target = await createIsolatedDatabase('digestokdst');
    try {
      const manifest = JSON.parse(fs.readFileSync(`${dump}.manifest.json`, 'utf8'));
      const digest = validateContentDigest(manifest.contentDigest);
      assert.ok(digest, 'النسخةُ الحديثةُ بلا بصمة');
      assert.equal(digest.format, CONTENT_DIGEST_FORMAT);
      assert.equal(digest.version, CONTENT_DIGEST_VERSION);
      // النطاقُ مُعلَنٌ في البيانِ نفسِه، ومعه ما لا يغطّيه.
      assert.ok(Array.isArray(digest.scope['notCovered']));
      assert.ok(
        /** @type {string[]} */ (digest.scope['notCovered']).some((s) => /privileges/.test(s)),
      );
      // الجداولُ في البصمةِ هي جداولُ عدّاداتِ البيانِ نفسُها، بالأعدادِ نفسِها.
      assert.deepEqual(Object.keys(digest.tables).sort(), Object.keys(manifest.rowCounts).sort());
      for (const [name, entry] of Object.entries(digest.tables)) {
        assert.equal(Number(entry.rows), manifest.rowCounts[name], name);
      }
      const verify = await runNode([BACKUP_SCRIPT, 'verify', dump], sourceUrl);
      assert.equal(verify.code, 0, verify.stderr);
      assert.match(verify.stdout, /\[CONTENT_DIGEST_PRESENT\]/);
      const restore = await runNode([RESTORE_SCRIPT, dump, '--database', target.name], sourceUrl);
      assert.equal(restore.code, 0, restore.stderr);
      assert.match(restore.stdout, /\[RESTORE_OK\]/);
      assert.match(restore.stdout, new RegExp(`\\[CONTENT_VERIFIED\\].*${digest.sha256}`));
      assert.equal(await ledgerInstalled(target.pool), true);
    } finally {
      await target.drop();
      await source.drop();
    }
  },
);

test(
  'WL-606 انحدار: محتوىً مختلفٌ بعددِ الصفوفِ نفسِه لا يمرُّ (‏كانَ يمرُّ [RESTORE_OK] قبلَ البصمة)',
  { skip: skipWithoutDatabase, timeout: PER_TEST_TIMEOUT_MS },
  async () => {
    const source = await createIsolatedDatabase('digestswap');
    const target = await createIsolatedDatabase('digestswapdst');
    const dir = registerTmpRoot(fs.mkdtempSync(path.join(os.tmpdir(), 'backup-digestswap-')));
    const before = path.join(dir, 'before.dump');
    const after = path.join(dir, 'after.dump');
    try {
      await up(source.pool);
      await seedEveryTable(source.pool);
      const sourceUrl = databaseUrlFor(source.name);
      assert.equal((await runNode([BACKUP_SCRIPT, 'create', before], sourceUrl)).code, 0);
      // تغييرُ محتوىً بلا تغييرِ عدد: الأعدادُ ونسخةُ الهجرةِ متطابقتان في النسختين.
      await source.pool.query(`UPDATE state.agents SET name = 'Agent Changed'`);
      assert.equal((await runNode([BACKUP_SCRIPT, 'create', after], sourceUrl)).code, 0);
      const mBefore = JSON.parse(fs.readFileSync(`${before}.manifest.json`, 'utf8'));
      const mAfter = JSON.parse(fs.readFileSync(`${after}.manifest.json`, 'utf8'));
      assert.deepEqual(
        mAfter.rowCounts,
        mBefore.rowCounts,
        'الأعدادُ يجبُ أن تتطابقَ كي يقيسَ الاختبار',
      );
      assert.notEqual(
        mAfter.contentDigest.tables.agents.sha256,
        mBefore.contentDigest.tables.agents.sha256,
      );
      // أرشيفٌ لا يطابقُ بصمتَه: محتوى «بعد» مع بصمةِ «قبل» (‏وتجزئةُ الملفِّ صحيحة، فلا يكشفُه `verify`).
      editManifest(after, (m) => {
        m.contentDigest = mBefore.contentDigest;
      });
      const verify = await runNode([BACKUP_SCRIPT, 'verify', after], sourceUrl);
      assert.equal(verify.code, 0, verify.stderr);
      const restore = await runNode([RESTORE_SCRIPT, after, '--database', target.name], sourceUrl);
      assert.equal(restore.code, 1, restore.stdout);
      assert.doesNotMatch(restore.stdout, /RESTORE_OK/);
      assert.match(restore.stderr, /\[RESTORE_CONTENT_MISMATCH\].*table agents: sha256/);
      // وعدّاداتُ المستعادِ تطابقُ البيان — أي أنَّ التحقّقَ القديمَ وحدَه كانَ سيقبلُه.
      // (‏الجدولُ المرحليُّ ما زالَ في `state` لأنّ الدفترَ لم يُركَّب، فيُستثنى من المقارنة.)
      const restoredCounts = await stateRowCounts(target.pool);
      for (const name of Object.keys(restoredCounts)) {
        if (name.startsWith('__backup_schema_migrations_')) delete restoredCounts[name];
      }
      assert.deepEqual(restoredCounts, mBefore.rowCounts);
      // الهدفُ لا يُقرأُ مُهاجَراً سليماً: الدفترُ بقيَ مرحليّاً في `state`.
      assert.equal(await ledgerInstalled(target.pool), false);
      assert.equal((await stagingTablesIn(target.pool)).length, 1);
    } finally {
      await target.drop();
      await source.drop();
    }
  },
);

for (const [
  label,
  edit,
  code,
] of /** @type {Array<[string, (m: Record<string, any>) => void, string]>} */ ([
  [
    'قيمةُ تجزئةِ جدولٍ مُعدَّلةٌ بلا إعادةِ ختم',
    (m) => {
      m.contentDigest.tables.agents.sha256 = '0'.repeat(64);
    },
    'BACKUP_DIGEST_INVALID',
  ],
  [
    'البصمةُ ليست كائناً',
    (m) => {
      m.contentDigest = 'sha256:abc';
    },
    'BACKUP_DIGEST_INVALID',
  ],
  [
    'الجداولُ غائبةٌ من البصمة',
    (m) => {
      delete m.contentDigest.tables;
      resealDigest(m.contentDigest);
    },
    'BACKUP_DIGEST_INVALID',
  ],
  [
    'عددُ صفوفٍ ليس عدداً عشريّاً',
    (m) => {
      m.contentDigest.tables.agents.rows = 1;
      resealDigest(m.contentDigest);
    },
    'BACKUP_DIGEST_INVALID',
  ],
  [
    'إصدارٌ أحدثُ غيرُ مدعوم',
    (m) => {
      m.contentDigest.version = 2;
      resealDigest(m.contentDigest);
    },
    'BACKUP_DIGEST_UNSUPPORTED',
  ],
  [
    'صيغةٌ غريبة',
    (m) => {
      m.contentDigest.format = 'other.digest';
    },
    'BACKUP_DIGEST_UNSUPPORTED',
  ],
])) {
  test(
    `WL-606: بصمةٌ في البيان — ${label} ⇒ ${code} في verify والاستعادة، والهدفُ لا يُنشأ`,
    { skip: skipWithoutDatabase, timeout: PER_TEST_TIMEOUT_MS },
    async () => {
      const { source, sourceUrl, dump } = await seededBackup(`dg${code.slice(14, 18)}`);
      const targetName = `wl606_absent_${crypto.randomBytes(4).toString('hex')}`;
      try {
        editManifest(dump, edit);
        const verify = await runNode([BACKUP_SCRIPT, 'verify', dump], sourceUrl);
        assert.equal(verify.code, 1, verify.stdout);
        assert.match(verify.stderr, new RegExp(`\\[${code}\\]`));
        for (const extra of [[], ['--allow-unverified']]) {
          const restore = await runNode(
            [RESTORE_SCRIPT, dump, '--database', targetName, ...extra],
            sourceUrl,
          );
          assert.equal(restore.code, 1, restore.stdout);
          assert.match(restore.stderr, new RegExp(`\\[${code}\\]`));
          assert.doesNotMatch(restore.stdout, /RESTORE_OK|RESTORE_UNVERIFIED/);
          // ‏`--allow-unverified` يخصُّ الغيابَ وحدَه؛ لا يُسكِتُ بصمةً حاضرةً تالفة.
          assert.equal(await databaseExists(source.pool, targetName), false);
        }
      } finally {
        await source.pool.query(`DROP DATABASE IF EXISTS ${quoteIdent(targetName)}`);
        await source.drop();
      }
    },
  );
}

test(
  'WL-606: بيانٌ مُزوَّرٌ متّسقٌ مع نفسِه يجتازُ verify ثمّ يُرفَضُ RESTORE_CONTENT_MISMATCH (‏الختمُ ليس توقيعاً)',
  { skip: skipWithoutDatabase, timeout: PER_TEST_TIMEOUT_MS },
  async () => {
    const { source, sourceUrl, dump } = await seededBackup('digestforge');
    const target = await createIsolatedDatabase('digestforgedst');
    try {
      editManifest(dump, (m) => {
        m.contentDigest.tables.agents.sha256 = 'f'.repeat(64);
        resealDigest(m.contentDigest);
      });
      assert.equal((await runNode([BACKUP_SCRIPT, 'verify', dump], sourceUrl)).code, 0);
      const restore = await runNode([RESTORE_SCRIPT, dump, '--database', target.name], sourceUrl);
      assert.equal(restore.code, 1, restore.stdout);
      assert.match(restore.stderr, /\[RESTORE_CONTENT_MISMATCH\].*table agents: sha256/);
      assert.equal(await ledgerInstalled(target.pool), false);
    } finally {
      await target.drop();
      await source.drop();
    }
  },
);

test(
  'WL-606: نسخةٌ قديمةٌ بلا بصمة ⇒ RESTORE_DIGEST_MISSING قبلَ اللمس؛ وبـ--allow-unverified ⇒ [RESTORE_UNVERIFIED] لا [RESTORE_OK]',
  { skip: skipWithoutDatabase, timeout: PER_TEST_TIMEOUT_MS },
  async () => {
    const { source, sourceUrl, dump, sourceDigest } = await seededBackup('digestlegacy');
    const busy = await createIsolatedDatabase('digestlegacybusy');
    const fresh = await createIsolatedDatabase('digestlegacydst');
    try {
      // بيانٌ بصيغةِ ما قبلَ `WL-606` حرفيّاً: لا `contentDigest` ولا `contentDigestMs`.
      editManifest(dump, (m) => {
        delete m.contentDigest;
        delete m.contentDigestMs;
      });
      const verify = await runNode([BACKUP_SCRIPT, 'verify', dump], sourceUrl);
      assert.equal(verify.code, 0, verify.stderr);
      assert.match(verify.stdout, /\[CONTENT_DIGEST_ABSENT\]/);

      // الرفضُ قبلَ اللمس، حتّى مع `--force` فوقَ قاعدةٍ مشغولة.
      await up(busy.pool);
      await seedEveryTable(busy.pool);
      const busyBefore = await contentsDigest(busy.pool);
      const refused = await runNode(
        [RESTORE_SCRIPT, dump, '--database', busy.name, '--force'],
        sourceUrl,
      );
      assert.equal(refused.code, 1, refused.stdout);
      assert.match(refused.stderr, /\[RESTORE_DIGEST_MISSING\]/);
      assert.doesNotMatch(refused.stdout, /RESTORE_OK/);
      assert.equal(await contentsDigest(busy.pool), busyBefore, 'الرفضُ لمسَ الهدف');

      // القرارُ الصريح: تُستعادُ، والعلامةُ تقولُ إنّها غيرُ متحقَّقة — ولا تحوي `RESTORE_OK`.
      const allowed = await runNode(
        [RESTORE_SCRIPT, dump, '--database', fresh.name, '--allow-unverified'],
        sourceUrl,
      );
      assert.equal(allowed.code, 0, allowed.stderr);
      assert.match(allowed.stdout, /\[RESTORE_UNVERIFIED\]/);
      assert.doesNotMatch(allowed.stdout, /RESTORE_OK|CONTENT_VERIFIED/);
      assert.equal(
        await contentsDigest(fresh.pool),
        sourceDigest,
        'الاستعادةُ القديمةُ تبقى صالحة',
      );
      assert.equal(await ledgerInstalled(fresh.pool), true);
      // والعقدُ البرمجيّ يميّزُها آليّاً لا بنصّ.
      const second = await createIsolatedDatabase('digestlegacyapi');
      try {
        const outcome = await restoreBackup(
          { dumpPath: dump, database: second.name, force: false, allowUnverified: true },
          sourceUrl,
        );
        assert.equal(outcome.contentVerification, CONTENT_VERIFICATION.NO_DIGEST);
      } finally {
        await second.drop();
      }
    } finally {
      await fresh.drop();
      await busy.drop();
      await source.drop();
    }
  },
);

/**
 * قاعدةٌ صغيرةٌ بمخطّطِ `state` يدويٍّ ودفترٍ أدنى — لفحصِ حساسيّةِ البصمةِ وحتميّتِها مباشرة.
 * @param {string} label
 * @param {string[]} statements
 */
async function digestScratch(label, statements) {
  const db = await createIsolatedDatabase(label);
  await db.pool.query(`CREATE SCHEMA state`);
  await db.pool.query(`CREATE TABLE public.schema_migrations (version integer, name text,
    checksum text, applied_at timestamptz, applied_by text)`);
  await db.pool.query(
    `INSERT INTO public.schema_migrations VALUES (1, 'init', '${'a'.repeat(64)}', '2026-01-01T00:00:00Z', 'test')`,
  );
  for (const sql of statements) await db.pool.query(sql);
  const client = await db.pool.connect();
  try {
    // إعداداتُ جلسةٍ مُختلفةٌ عمداً: البصمةُ تُثبِّتُ إعداداتِها فلا تتأثّر.
    await client.query(
      `SET TimeZone = 'Asia/Riyadh'; SET DateStyle = 'SQL, DMY'; SET extra_float_digits = 0; SET bytea_output = 'escape'`,
    );
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const digest = await computeContentDigest(client, 'public.schema_migrations');
    await client.query('COMMIT');
    return digest;
  } finally {
    client.release();
    await db.drop();
  }
}

test(
  'WL-606: حساسيّةُ البصمةِ وحتميّتُها — فراغ، NULL مقابلَ نصٍّ فارغ، bytea، ترتيبُ الإدراج، تبادلُ قيمٍ، تكرار، نوعُ عمود',
  { skip: skipWithoutDatabase, timeout: PER_TEST_TIMEOUT_MS },
  async () => {
    const table = `CREATE TABLE state.t (id integer, a text, b bytea, f double precision, ts timestamptz)`;
    /** @type {[string, string, string]} */
    const rows = [
      `(1, 'x', '\\x00ff'::bytea, 0.1, '2026-05-05T10:00:00Z')`,
      `(2, '', '\\x'::bytea, 1e-300, '1999-12-31T23:59:59.123456Z')`,
      `(3, NULL, NULL, NULL, NULL)`,
    ];
    const ins = (/** @type {string[]} */ r) => `INSERT INTO state.t VALUES ${r.join(', ')}`;
    const base = await digestScratch('dgbase', [table, ins(rows)]);

    // حتميّة: ترتيبُ إدراجٍ معكوسٌ وقاعدةٌ أخرى وإعداداتُ جلسة ⇒ البصمةُ نفسُها.
    const reversed = await digestScratch('dgrev', [table, ins([...rows].reverse())]);
    assert.deepEqual(contentDigestDifferences(base, reversed), []);
    assert.equal(reversed.sha256, base.sha256);
    // وصفوفٌ «ميّتة» بعدَ تحديثٍ يعيدُ القيمةَ نفسَها لا تغيّرُ شيئاً.
    const churned = await digestScratch('dgchurn', [
      table,
      ins(rows),
      `UPDATE state.t SET a = a || '' WHERE id = 1`,
    ]);
    assert.equal(churned.sha256, base.sha256);

    // جدولٌ فارغ: صفر صفوف وتجزئةُ الفراغ.
    const empty = await digestScratch('dgempty', [table]);
    assert.equal(empty.tables['t']?.rows, '0');
    assert.equal(empty.tables['t']?.sha256, crypto.createHash('sha256').update('').digest('hex'));
    assert.deepEqual(contentDigestDifferences(base, empty), ['table t: rows+sha256']);

    /** @type {Array<[string, string[]]>} */
    const variants = [
      [
        'NULL بدلَ النصِّ الفارغ',
        [rows[0], `(2, NULL, '\\x'::bytea, 1e-300, '1999-12-31T23:59:59.123456Z')`, rows[2]],
      ],
      ['نصٌّ فارغٌ بدلَ NULL', [rows[0], rows[1], `(3, '', NULL, NULL, NULL)`]],
      [
        'بايتٌ واحدٌ في bytea',
        [`(1, 'x', '\\x00fe'::bytea, 0.1, '2026-05-05T10:00:00Z')`, rows[1], rows[2]],
      ],
      ['bytea فارغٌ بدلَ NULL', [rows[0], rows[1], `(3, NULL, '\\x'::bytea, NULL, NULL)`]],
      [
        'آخرُ رقمٍ في عددٍ عشريّ',
        [
          `(1, 'x', '\\x00ff'::bytea, 0.10000000000000002, '2026-05-05T10:00:00Z')`,
          rows[1],
          rows[2],
        ],
      ],
      [
        'ميكروثانيةٌ في الزمن',
        [rows[0], `(2, '', '\\x'::bytea, 1e-300, '1999-12-31T23:59:59.123457Z')`, rows[2]],
      ],
      [
        'تبادلُ قيمتَين بينَ صفَّين',
        [
          `(1, '', '\\x00ff'::bytea, 0.1, '2026-05-05T10:00:00Z')`,
          `(2, 'x', '\\x'::bytea, 1e-300, '1999-12-31T23:59:59.123456Z')`,
          rows[2],
        ],
      ],
      ['صفٌّ مكرَّرٌ بدلَ آخرَ (‏العددُ نفسُه)', [rows[0], rows[0], rows[2]]],
      [
        'فاصلةٌ داخلَ نصٍّ تحاكي حدودَ الحقول',
        [`(1, 'x,\\\\x00ff', NULL, 0.1, '2026-05-05T10:00:00Z')`, rows[1], rows[2]],
      ],
    ];
    for (const [why, variant] of variants) {
      const other = await digestScratch('dgvar', [table, ins(variant)]);
      assert.equal(other.tables['t']?.rows, '3', why);
      assert.deepEqual(contentDigestDifferences(base, other), ['table t: sha256'], why);
    }
    // نوعُ عمودٍ مختلفٌ بالقيمِ النصّيّةِ نفسِها: توقيعُ الأعمدةِ يكشفُه.
    const retyped = await digestScratch('dgtype', [
      table.replace('a text', 'a varchar(10)'),
      ins(rows),
    ]);
    assert.deepEqual(contentDigestDifferences(base, retyped), ['table t: columns']);
    // جدولٌ زائدٌ أو ناقص، ودفترٌ مختلف.
    const extra = await digestScratch('dgextra', [
      table,
      ins(rows),
      `CREATE TABLE state.u (x int)`,
    ]);
    assert.deepEqual(contentDigestDifferences(base, extra), ['table u: غيرُ موجودٍ في النسخة']);
    const ledger = await digestScratch('dgledger', [
      table,
      ins(rows),
      `UPDATE public.schema_migrations SET applied_by = 'other'`,
    ]);
    assert.deepEqual(contentDigestDifferences(base, ledger), ['ledger']);
  },
);

test(
  'WL-606: المتسلسلات — تقدّمٌ مقبول (‏خارجَ MVCC)، وتراجعٌ أو زيادةٌ مختلفة مرفوضان',
  { skip: skipWithoutDatabase, timeout: PER_TEST_TIMEOUT_MS },
  async () => {
    const seq = (/** @type {string} */ setval) => [
      `CREATE SEQUENCE state.s`,
      `SELECT setval('state.s', ${setval})`,
    ];
    const base = await digestScratch('dgseq', seq('10'));
    assert.deepEqual(base.sequences['s'], { lastValue: '10', isCalled: true, increment: '1' });
    assert.deepEqual(contentDigestDifferences(base, await digestScratch('dgseqa', seq('12'))), []);
    assert.deepEqual(contentDigestDifferences(base, await digestScratch('dgseqb', seq('9'))), [
      'sequence s: behind snapshot',
    ]);
    // ‏`is_called = false` عندَ 10 تعني أنّ التاليةَ 10 لا 11 ⇒ خلفَ اللقطة.
    assert.deepEqual(
      contentDigestDifferences(base, await digestScratch('dgseqc', seq('10, false'))),
      ['sequence s: behind snapshot'],
    );
    const decreasing = await digestScratch('dgseqd', [
      `CREATE SEQUENCE state.s INCREMENT BY -1 MINVALUE -100 MAXVALUE 100 START WITH 10`,
    ]);
    assert.deepEqual(contentDigestDifferences(base, decreasing), ['sequence s: increment']);
    assert.deepEqual(contentDigestDifferences(base, await digestScratch('dgseqe', [])), [
      'sequence s: غائبٌ عن المستعاد',
    ]);
  },
);

// ═══ ‏`WL-608` — ‏`LIVE-78/DIGEST-COVERAGE`: ما تغطّيه البصمةُ وما لا تغطّيه، مقيساً ═══════════════════
// نموذجٌ مختبريّ (‏`coverageProbe` في `tests/helpers/pg.mjs`) لا يلمسُ بيانَ الإنتاج. يُقاسُ بنسخٍ واستعادةٍ
// حقيقيّين: (‏1) أيُّ فئةٍ تعبرُ النسخةَ وأيُّها تضيعُ تصميماً؛ (‏2) تلاعبٌ بكلِّ فئةٍ داخلَ الأرشيفِ بعدَ
// الاستعادة لا تراه بصمةُ `WL-606` (‏فـ`[CONTENT_VERIFIED]` كانَ سيُعلَن) ويراه النموذجُ في فئتِه وحدَها؛
// (‏3) الثبات: تكرار، ‏VACUUM/REINDEX، إعادةُ إنشاءِ قيدٍ بـOID جديد؛ (‏4) الكلفة. ‏`LIVE-78/DIGEST-COVERAGE` يبقى OPEN.

const WL608_ROLE = `wl608_reader_${process.pid}`;
const WL608_OBJECTS = [
  `CREATE TYPE state.wl608_mood AS ENUM ('a', 'b')`,
  `CREATE DOMAIN state.wl608_pos AS integer CHECK (VALUE > 0)`,
  `CREATE TABLE state.wl608_cov (id integer PRIMARY KEY, n state.wl608_pos NOT NULL DEFAULT 1,
     m state.wl608_mood, CONSTRAINT wl608_n_small CHECK (n < 1000))`,
  `CREATE INDEX wl608_cov_m ON state.wl608_cov (m)`,
  `CREATE FUNCTION state.wl608_fn() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RETURN NEW; END$$`,
  `CREATE TRIGGER wl608_trg BEFORE INSERT ON state.wl608_cov FOR EACH ROW EXECUTE FUNCTION state.wl608_fn()`,
  `ALTER TABLE state.wl608_cov ENABLE ROW LEVEL SECURITY`,
  `CREATE POLICY wl608_pol ON state.wl608_cov USING (n > 0)`,
  `CREATE VIEW state.wl608_v AS SELECT id, n FROM state.wl608_cov WHERE n > 1`,
  `COMMENT ON TABLE state.wl608_cov IS 'wl608'`,
  `INSERT INTO state.wl608_cov VALUES (1, 5, 'a'), (2, 7, 'b')`,
  `GRANT SELECT ON state.wl608_cov TO ${WL608_ROLE}`,
  `SELECT lo_from_bytea(0, '\\x776c363038'::bytea)`,
];

/**
 * مصدرٌ مُهاجَرٌ بكائناتِ كلِّ فئة، ونسخةٌ حقيقيّة، واستعادةٌ حقيقيّةٌ في هدفٍ جديد.
 * @param {string} label
 */
async function wl608RoundTrip(label) {
  /** @type {Awaited<ReturnType<typeof coverageProbe>> | undefined} */
  let preBackup;
  const source = await createIsolatedDatabase(`${label}src`);
  const target = await createIsolatedDatabase(`${label}dst`);
  const dir = registerTmpRoot(fs.mkdtempSync(path.join(os.tmpdir(), `backup-${label}-`)));
  const dump = path.join(dir, 'state.dump');
  await source.pool.query(`DROP ROLE IF EXISTS ${WL608_ROLE}`);
  await source.pool.query(`CREATE ROLE ${WL608_ROLE} NOLOGIN`);
  const cleanup = async () => {
    await target.drop();
    await source.drop();
    await target.pool.end().catch(() => {});
    const admin = new pg.Client({ connectionString: process.env['DATABASE_URL'] });
    await admin.connect();
    try {
      await admin.query(`DROP ROLE IF EXISTS ${WL608_ROLE}`);
    } finally {
      await admin.end();
    }
  };
  try {
    await up(source.pool);
    await seedEveryTable(source.pool);
    for (const sql of WL608_OBJECTS) await source.pool.query(sql);
    preBackup = await coverageProbe(source.pool, { settings: DIGEST_SETTINGS });
    const sourceUrl = databaseUrlFor(source.name);
    const backup = await runNode([BACKUP_SCRIPT, 'create', dump], sourceUrl);
    assert.equal(backup.code, 0, backup.stderr);
    const restore = await runNode([RESTORE_SCRIPT, dump, '--database', target.name], sourceUrl);
    assert.equal(restore.code, 0, restore.stderr);
    assert.match(restore.stdout, /\[CONTENT_VERIFIED\]/);
    const manifest = JSON.parse(fs.readFileSync(`${dump}.manifest.json`, 'utf8'));
    return { source, target, manifest, cleanup, preBackup };
  } catch (error) {
    await cleanup();
    throw error;
  }
}

/** بصمةُ الإنتاجِ (‏`WL-606`) على الهدف مقارنةً ببيانِ النسخة. @param {import('pg').Pool} pool @param {Record<string, any>} manifest */
async function productionDigestDiff(pool, manifest) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const digest = await computeContentDigest(client, 'public.schema_migrations');
    await client.query('ROLLBACK');
    return contentDigestDifferences(manifest.contentDigest, digest);
  } finally {
    client.release();
  }
}

test(
  'WL-608 DIGEST-COVERAGE: نسخٌ/استعادةٌ حقيقيّان — فئاتُ الأرشيفِ تعبرُ متطابقة، والمالكون والصلاحيّاتُ والكائناتُ الكبيرةُ وقوادحُ الأحداثِ تضيعُ تصميماً',
  { skip: skipWithoutDatabase, timeout: PER_TEST_TIMEOUT_MS },
  async (t) => {
    const rt = await wl608RoundTrip('cov608rt');
    try {
      const before = await coverageProbe(rt.source.pool, { settings: DIGEST_SETTINGS });
      const after = await coverageProbe(rt.target.pool, { settings: DIGEST_SETTINGS });
      // النسخُ نفسُه يكتبُ في المصدر: ‏fence.ddl_audit يسجّلُ إنشاءَ الجدولِ المرحليِّ وحذفَه. يُقاسُ السببُ لا يُفترَض:
      // المصدرُ قبلَ النسخِ وبعدَه يختلفُ في هذا الجدولِ وحدَه، والهدفُ يطابقُ أحدَهما أو يقعُ بينَهما بعددِ صفوفِه.
      assert.deepEqual(coverageDiff(/** @type {any} */ (rt.preBackup), before), {
        fenceRows: ['ddl_audit'],
      });
      const audit = (/** @type {any} */ p) =>
        Number(new Map(p.categories['fenceRows'].entries).get('ddl_audit')[0]);
      assert.ok(
        audit(rt.preBackup) <= audit(after) && audit(after) <= audit(before),
        'ddl_audit بينَ لقطتَي المصدر',
      );
      const diff = coverageDiff(before, after);
      if (diff['fenceRows']?.join() === 'ddl_audit') delete diff['fenceRows'];
      t.diagnostic(`PG${before.pgMajor} diff=${JSON.stringify(diff)}`);
      for (const [name, row] of Object.entries(COVERAGE_MATRIX)) {
        const entries = before.categories[name]?.entries ?? [];
        if (row.roundTrip === 'equal') {
          assert.ok(entries.length > 0 || name === 'comments', `${name}: المصدرُ بلا كائنٍ يُقاس`);
          assert.equal(diff[name], undefined, `${name} في الأرشيفِ ويجبُ أن يعبر: ${diff[name]}`);
        }
      }
      // ما يضيعُ تصميماً — مقيساً لا موصوفاً:
      const entry = (/** @type {any} */ p, /** @type {string} */ c, /** @type {string} */ k) =>
        JSON.stringify(new Map(p.categories[c].entries).get(k));
      assert.match(entry(before, 'grants', 'rel:state.wl608_cov'), new RegExp(WL608_ROLE));
      assert.doesNotMatch(
        entry(after, 'grants', 'rel:state.wl608_cov'),
        new RegExp(WL608_ROLE),
        'GRANT لا يعبرُ (‏--no-privileges)',
      );
      assert.ok(
        diff['owners'],
        'المالكون لا يعبرون (‏--no-owner): المالكُ في الهدفِ مُنفِّذُ الاستعادة',
      );
      assert.ok(diff['largeObjects'], 'الكائنُ الكبيرُ لا يعبرُ (‏--schema)');
      assert.equal(after.categories['largeObjects']?.entries.length, 0);
      assert.ok(
        (before.categories['eventTriggers']?.entries.length ?? 0) > 0,
        'السياجُ يُثبِّتُ قوادحَ أحداثٍ في المصدر',
      );
      assert.equal(after.categories['eventTriggers']?.entries.length, 0, 'قوادحُ الأحداثِ لا تعبر');
      // الأدوارُ على مستوى العنقود: تطابقُها هنا لأنّ الاختبارَ على العنقودِ نفسِه، لا لأنّ النسخةَ نقلتها.
      assert.equal(diff['roles'] === undefined || Array.isArray(diff['roles']), true);
      // ولا شيءَ آخرُ يختلف: الفروقُ كلُّها في فئاتٍ خارجَ الأرشيف.
      for (const name of Object.keys(diff)) {
        assert.equal(
          /** @type {Record<string, { inArchive: boolean }>} */ (COVERAGE_MATRIX)[name]?.inArchive,
          false,
          `${name} اختلفت وهي في الأرشيف`,
        );
      }
    } finally {
      await rt.cleanup();
    }
  },
);

test(
  'WL-608 DIGEST-COVERAGE: تلاعبٌ بكلِّ فئةٍ بنيويّةٍ بعدَ الاستعادة لا تراه بصمةُ WL-606 (‏فـCONTENT_VERIFIED كانَ يُعلَن) ويراه النموذجُ في فئتِه وحدَها',
  { skip: skipWithoutDatabase, timeout: PER_TEST_TIMEOUT_MS },
  async (t) => {
    const rt = await wl608RoundTrip('cov608gap');
    try {
      const tampers = /** @type {Array<[string, string]>} */ ([
        ['constraints', `ALTER TABLE state.wl608_cov DROP CONSTRAINT wl608_n_small`],
        ['indexes', `DROP INDEX state.wl608_cov_m`],
        ['triggers', `ALTER TABLE state.wl608_cov DISABLE TRIGGER wl608_trg`],
        [
          'routines',
          `CREATE OR REPLACE FUNCTION state.wl608_fn() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN NEW.n := 999; RETURN NEW; END$$`,
        ],
        ['policies', `ALTER POLICY wl608_pol ON state.wl608_cov USING (true)`],
        ['relations', `ALTER TABLE state.wl608_cov DISABLE ROW LEVEL SECURITY`],
        ['columns', `ALTER TABLE state.wl608_cov ALTER COLUMN n SET DEFAULT 2`],
        [
          'views',
          `CREATE OR REPLACE VIEW state.wl608_v AS SELECT id, n FROM state.wl608_cov WHERE n > 2`,
        ],
        ['types', `ALTER TYPE state.wl608_mood ADD VALUE 'c'`],
        ['comments', `COMMENT ON TABLE state.wl608_cov IS 'tampered'`],
      ]);
      let prev = await coverageProbe(rt.target.pool, { settings: DIGEST_SETTINGS });
      assert.deepEqual(await productionDigestDiff(rt.target.pool, rt.manifest), []);
      for (const [category, sql] of tampers) {
        await rt.target.pool.query(sql);
        const next = await coverageProbe(rt.target.pool, { settings: DIGEST_SETTINGS });
        assert.deepEqual(Object.keys(coverageDiff(prev, next)), [category], `${category}: ${sql}`);
        assert.deepEqual(
          await productionDigestDiff(rt.target.pool, rt.manifest),
          [],
          `${category}: بصمةُ الإنتاجِ لا تغطّي الفئة — لو رأتها لكانَ هذا الاختبارُ خاطئاً`,
        );
        prev = next;
      }
      t.diagnostic(
        `${tampers.length}/${tampers.length} فئاتٍ: بصمةُ WL-606 صامتة، والنموذجُ يحدّدُ الفئة`,
      );
    } finally {
      await rt.cleanup();
    }
  },
);

test(
  'WL-608 DIGEST-COVERAGE: الثباتُ والكلفة — تكرار، VACUUM ANALYZE وREINDEX، وإعادةُ إنشاءِ قيدٍ/فهرسٍ بـOID جديد لا تغيّرُ التمثيل',
  { skip: skipWithoutDatabase, timeout: PER_TEST_TIMEOUT_MS },
  async (t) => {
    const rt = await wl608RoundTrip('cov608det');
    try {
      const probe = () => coverageProbe(rt.target.pool, { settings: DIGEST_SETTINGS });
      const a = await probe();
      const b = await probe();
      assert.deepEqual(coverageDiff(a, b), {});
      await rt.target.pool.query('VACUUM ANALYZE');
      await rt.target.pool.query('REINDEX TABLE state.wl608_cov');
      assert.deepEqual(coverageDiff(a, await probe()), {}, 'الصيانةُ لا تغيّرُ التمثيل');
      const oids = async () =>
        (
          await rt.target.pool.query(
            `SELECT (SELECT oid FROM pg_constraint WHERE conname = 'wl608_n_small')::text AS c,
                    'state.wl608_cov_m'::regclass::oid::text AS i`,
          )
        ).rows[0];
      const o1 = await oids();
      await rt.target.pool.query(`ALTER TABLE state.wl608_cov DROP CONSTRAINT wl608_n_small,
        ADD CONSTRAINT wl608_n_small CHECK (n < 1000)`);
      await rt.target.pool.query(
        `DROP INDEX state.wl608_cov_m; CREATE INDEX wl608_cov_m ON state.wl608_cov (m)`,
      );
      const o2 = await oids();
      assert.notEqual(o1?.['c'], o2?.['c']);
      assert.notEqual(o1?.['i'], o2?.['i']);
      assert.deepEqual(
        coverageDiff(a, await probe()),
        {},
        'OID جديدٌ بالتعريفِ نفسِه ⇒ التمثيلُ نفسُه',
      );
      // الكلفة: زمنُ اللقطةِ وعددُ العناصر (‏تُطبَعُ للتقرير؛ القاعدةُ مُهاجَرةٌ بكاملِ السياج).
      const counts = Object.fromEntries(
        Object.entries(a.categories).map(([k, v]) => [k, v.entries.length]),
      );
      t.diagnostic(`PG${a.pgMajor} probe=${a.ms}ms/${b.ms}ms counts=${JSON.stringify(counts)}`);
    } finally {
      await rt.cleanup();
    }
  },
);

/**
 * مرجعُ تسلسلٍ في الذاكرة (‏`WL-610`): ‏`issued` رقم ⇒ [backupId, dumpSha256].
 * @param {number} floor @param {number} latestIssued @param {Record<number, [string, string]>} issued
 */
function sequenceReferenceOf(floor, latestIssued, issued) {
  return {
    floor,
    latestIssued,
    issued: new Map(
      Object.entries(issued).map(([k, [backupId, dumpSha256]]) => [
        Number(k),
        { backupId, dumpSha256 },
      ]),
    ),
  };
}

// ═══ ‏`WL-608` — أصالةُ البيان: السلامةُ (‏WL-606) مقابلَ المصدر (‏نموذجُ توقيعٍ مختبريّ) ═══════════════════════
// خمسةُ هجمات، ولكلٍّ ما يفعلُه الإنتاجُ اليومَ وما يفعلُه التوقيع. المفاتيحُ مُولَّدةٌ هنا وتموتُ مع العمليّة.

test(
  'WL-608 أصالة: تلفٌ عرضيّ، وتعديلٌ متعمَّدٌ للبيان، وبيانٌ من نسخةٍ أخرى — الإنتاجُ يرفضُها؛ والتوقيعُ يرفضُها أيضاً بسببٍ مُسمّى',
  { skip: skipWithoutDatabase, timeout: PER_TEST_TIMEOUT_MS },
  async () => {
    const legit = await seededBackup('auth608a');
    const other = await seededBackup('auth608b');
    const target = await createIsolatedDatabase('auth608adst');
    try {
      const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
      const policy = {
        trustedKeys: new Map([['k1', publicKey]]),
        database: 'prod-a',
        sequenceReference: sequenceReferenceOf(1, 1, { 1: ['b-1', sha256Of(legit.dump)] }),
      };
      const read = (/** @type {string} */ d) =>
        JSON.parse(fs.readFileSync(`${d}.manifest.json`, 'utf8'));
      const envelope = signManifestPrototype(read(legit.dump), sha256Of(legit.dump), {
        keyId: 'k1',
        backupId: 'b-1',
        sequence: 1,
        database: 'prod-a',
        privateKey,
      });
      assert.deepEqual(
        verifyManifestPrototype(read(legit.dump), sha256Of(legit.dump), envelope, policy),
        { ok: true, replayProtected: true },
      );

      // (‏1) تلفٌ عرضيّ: بايتٌ مقلوبٌ في وسطِ الأرشيف.
      const bytes = fs.readFileSync(other.dump);
      const mid = Math.floor(bytes.length / 2);
      bytes[mid] = Number(bytes[mid]) ^ 0xff;
      fs.writeFileSync(other.dump, bytes);
      const corrupt = await runNode([BACKUP_SCRIPT, 'verify', other.dump], other.sourceUrl);
      assert.notEqual(corrupt.code, 0);
      assert.match(corrupt.stderr + corrupt.stdout, /BACKUP_HASH_MISMATCH/);
      assert.equal(
        /** @type {any} */ (
          verifyManifestPrototype(read(legit.dump), sha256Of(other.dump), envelope, policy)
        ).reason,
        MANIFEST_AUTH_REASONS.BINDING,
      );
      fs.copyFileSync(legit.dump, other.dump);

      // (‏2) تعديلٌ متعمَّدٌ للبيان: بصمةُ محتوىً مُعدَّلةٌ بلا إعادةِ ختم ⇒ ‏DIGEST_INVALID؛ بإعادةِ ختم ⇒ تُكشَفُ بعدَ الاستعادة.
      editManifest(other.dump, (m) => {
        const first = String(Object.keys(m.contentDigest.tables)[0]);
        m.contentDigest.tables[first].sha256 = '0'.repeat(64);
      });
      const unsealed = await runNode([BACKUP_SCRIPT, 'verify', other.dump], other.sourceUrl);
      assert.notEqual(unsealed.code, 0);
      assert.match(unsealed.stderr + unsealed.stdout, /BACKUP_DIGEST_INVALID/);
      editManifest(other.dump, (m) => resealDigest(m.contentDigest));
      const resealed = await runNode(
        [RESTORE_SCRIPT, other.dump, '--database', target.name],
        other.sourceUrl,
      );
      assert.notEqual(resealed.code, 0);
      assert.match(resealed.stderr + resealed.stdout, /RESTORE_CONTENT_MISMATCH/);
      assert.equal(
        /** @type {any} */ (
          verifyManifestPrototype(read(other.dump), sha256Of(other.dump), envelope, policy)
        ).reason,
        MANIFEST_AUTH_REASONS.BINDING,
        'التوقيعُ يرفضُ قبلَ لمسِ الهدف — لا بعدَ الاستعادة',
      );

      // (‏3) بيانٌ من نسخةٍ أخرى مع هذا الأرشيف: بصمةُ الملفِّ لا تطابق.
      fs.copyFileSync(legit.dump, other.dump);
      const foreign = JSON.parse(fs.readFileSync(`${legit.dump}.manifest.json`, 'utf8'));
      foreign.sha256 = 'f'.repeat(64);
      fs.writeFileSync(`${other.dump}.manifest.json`, `${JSON.stringify(foreign, null, 2)}\n`);
      const reused = await runNode([BACKUP_SCRIPT, 'verify', other.dump], other.sourceUrl);
      assert.notEqual(reused.code, 0);
      assert.match(reused.stderr + reused.stdout, /BACKUP_HASH_MISMATCH/);
      assert.equal(
        /** @type {any} */ (
          verifyManifestPrototype(foreign, sha256Of(other.dump), envelope, policy)
        ).reason,
        MANIFEST_AUTH_REASONS.BINDING,
      );
    } finally {
      await target.drop();
      await other.source.drop();
      await legit.source.drop();
    }
  },
);

test(
  'WL-608 أصالة: استبدالُ الأرشيفِ والبيانِ معاً بنسخةٍ حقيقيّةٍ من قاعدةِ المهاجم ⇒ الإنتاجُ يُعلنُ [CONTENT_VERIFIED]؛ والتوقيعُ وحدَه يرفض — وإعادةُ تشغيلِ نسخةٍ قديمةٍ موقَّعةٍ لا يرفضُها إلا الرقمُ المتسلسل',
  { skip: skipWithoutDatabase, timeout: PER_TEST_TIMEOUT_MS },
  async () => {
    const legit = await seededBackup('auth608c');
    const attacker = await createIsolatedDatabase('auth608evil');
    const target = await createIsolatedDatabase('auth608cdst');
    const replayTarget = await createIsolatedDatabase('auth608rdst');
    const dir = registerTmpRoot(fs.mkdtempSync(path.join(os.tmpdir(), 'backup-auth608-')));
    const evilDump = path.join(dir, 'state.dump');
    try {
      const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
      const evilKey = crypto.generateKeyPairSync('ed25519');
      const legitSha = sha256Of(legit.dump);
      const policy = {
        trustedKeys: new Map([['k1', publicKey]]),
        database: 'prod-a',
        sequenceReference: sequenceReferenceOf(1, 1, { 1: ['b-1', legitSha] }),
      };
      const read = (/** @type {string} */ d) =>
        JSON.parse(fs.readFileSync(`${d}.manifest.json`, 'utf8'));
      const legitEnvelope = signManifestPrototype(read(legit.dump), legitSha, {
        keyId: 'k1',
        backupId: 'b-1',
        sequence: 1,
        database: 'prod-a',
        privateKey,
      });
      // المهاجمُ يملكُ قاعدةً بالمخطّطِ نفسِه ومحتوىً من اختيارِه، وأداةَ النسخِ نفسَها.
      await up(attacker.pool);
      await seedEveryTable(attacker.pool);
      await attacker.pool.query(`UPDATE state.agents SET name = 'Attacker Chosen'`);
      assert.equal(
        (await runNode([BACKUP_SCRIPT, 'create', evilDump], databaseUrlFor(attacker.name))).code,
        0,
      );
      // يضعُها في موضعِ النسخةِ الشرعيّة: الأرشيفُ والبيانُ معاً.
      fs.copyFileSync(evilDump, legit.dump);
      fs.copyFileSync(`${evilDump}.manifest.json`, `${legit.dump}.manifest.json`);
      const restore = await runNode(
        [RESTORE_SCRIPT, legit.dump, '--database', target.name],
        legit.sourceUrl,
      );
      assert.equal(restore.code, 0, restore.stderr);
      assert.match(restore.stdout, /\[RESTORE_OK\]/);
      assert.match(
        restore.stdout,
        /\[CONTENT_VERIFIED\]/,
        'السلامةُ لا تُثبتُ المصدر: المزوَّرُ المتّسقُ يمرّ',
      );
      const names = await target.pool.query(`SELECT DISTINCT name FROM state.agents`);
      assert.deepEqual(
        names.rows.map((r) => r['name']),
        ['Attacker Chosen'],
        'المستعادُ محتوى المهاجم',
      );
      // التوقيع: غائب، أو بمفتاحِ المهاجم، أو توقيعٌ شرعيٌّ منقول — كلُّها تُرفَضُ قبلَ الاستعادة.
      const m = read(legit.dump);
      const sha = sha256Of(legit.dump);
      const reason = (/** @type {any} */ env) =>
        /** @type {any} */ (verifyManifestPrototype(m, sha, env, policy)).reason;
      assert.equal(reason(undefined), MANIFEST_AUTH_REASONS.MISSING);
      assert.equal(
        reason(
          signManifestPrototype(m, sha, {
            keyId: 'k1',
            backupId: 'b-9',
            sequence: 9,
            database: 'prod-a',
            privateKey: evilKey.privateKey,
          }),
        ),
        MANIFEST_AUTH_REASONS.INVALID,
        'مفتاحُ المهاجمِ بمعرّفِ المفتاحِ الموثوق',
      );
      assert.equal(
        reason(
          signManifestPrototype(m, sha, {
            keyId: 'evil',
            backupId: 'b-9',
            sequence: 9,
            database: 'prod-a',
            privateKey: evilKey.privateKey,
          }),
        ),
        MANIFEST_AUTH_REASONS.UNTRUSTED_KEY,
      );
      assert.equal(
        reason(legitEnvelope),
        MANIFEST_AUTH_REASONS.BINDING,
        'توقيعٌ شرعيٌّ لا ينتقلُ إلى أرشيفٍ آخر',
      );
      // توقيعٌ صحيحٌ من قاعدةٍ شرعيّةٍ أخرى (‏مثلاً staging بالمفتاحِ نفسِه) ⇒ هويّةُ القاعدةِ ترفض.
      const staging = signManifestPrototype(m, sha, {
        keyId: 'k1',
        backupId: 'b-5',
        sequence: 5,
        database: 'staging',
        privateKey,
      });
      assert.equal(reason(staging), MANIFEST_AUTH_REASONS.DATABASE);

      // (‏5) إعادةُ التشغيل: النسخةُ الشرعيّةُ القديمةُ (‏sequence 1) بعدَ أن رأى المخزنُ الموثوقُ 2.
      const golden = await sharedGoldenBackup();
      fs.copyFileSync(golden.dump, legit.dump);
      fs.copyFileSync(golden.manifest, `${legit.dump}.manifest.json`);
      fs.chmodSync(`${legit.dump}.manifest.json`, 0o600);
      const old = read(legit.dump);
      const oldSha = sha256Of(legit.dump);
      assert.deepEqual(
        verifyManifestPrototype(old, oldSha, legitEnvelope, {
          ...policy,
          sequenceReference: null,
          allowUnprotectedReplay: true,
        }),
        { ok: true, replayProtected: false },
        'التوقيعُ وحدَه يقبلُ القديم — ويُعلنُ أنّه بلا حمايةٍ من الإعادة',
      );
      assert.deepEqual(
        verifyManifestPrototype(old, oldSha, legitEnvelope, policy),
        { ok: true, replayProtected: true },
        'والمرجعُ الذي لم يرَ أحدثَ منه يقبلُه',
      );
      assert.deepEqual(
        verifyManifestPrototype(old, oldSha, legitEnvelope, {
          ...policy,
          sequenceReference: sequenceReferenceOf(2, 2, {
            1: ['b-1', legitSha],
            2: ['b-2', 'e'.repeat(64)],
          }),
        }),
        { ok: false, reason: MANIFEST_AUTH_REASONS.REPLAY },
        'الرقمُ المتسلسلُ في مخزنٍ موثوقٍ وحدَه يرفضُ القديم',
      );
      const replay = await runNode(
        [RESTORE_SCRIPT, legit.dump, '--database', replayTarget.name],
        legit.sourceUrl,
      );
      assert.equal(replay.code, 0, replay.stderr);
      assert.match(replay.stdout, /\[CONTENT_VERIFIED\]/, 'الإنتاجُ لا يعرفُ أنّ النسخةَ قديمة');
    } finally {
      await replayTarget.drop();
      await target.drop();
      await attacker.drop();
      await legit.source.drop();
    }
  },
);

// ═══ ‏`WL-610` — أصالةُ النسخِ ومنعُ إعادةِ التشغيلِ بمرجعٍ مستقلّ (‏نموذجٌ مختبريّ، بلا قاعدةٍ ولا مفاتيحِ إنتاج) ═══
// أرشيفٌ وبيانٌ اصطناعيّان يكفيان لمنطقِ التحقّق: الحمولةُ تُقرأُ من البيانِ وبصمةُ الأرشيفِ تُحسَبُ من الملفّ.

/** مجلّدُ نسخٍ ومجلّدُ مرجعٍ منفصلان، ونسخةٌ موقَّعةٌ أولى. */
function wl610Lab() {
  const root = registerTmpRoot(fs.mkdtempSync(path.join(os.tmpdir(), 'backup-auth610-')));
  const backups = path.join(root, 'backups');
  const refDir = path.join(root, 'sequence-authority');
  fs.mkdirSync(backups);
  fs.mkdirSync(refDir);
  const k1 = crypto.generateKeyPairSync('ed25519');
  const k2 = crypto.generateKeyPairSync('ed25519');
  const evil = crypto.generateKeyPairSync('ed25519');
  /** @param {string} name @param {string} body */
  const backup = (name, body) => {
    const dump = path.join(backups, name);
    fs.writeFileSync(dump, body);
    const manifest = {
      sha256: sha256Of(dump),
      contentDigest: { sha256: crypto.createHash('sha256').update(`c:${body}`).digest('hex') },
      startedAt: '2026-11-25T00:00:00.000Z',
      migrationVersion: 32,
    };
    fs.writeFileSync(`${dump}.manifest.json`, `${JSON.stringify(manifest, null, 2)}\n`);
    return { dump, manifest, sha: sha256Of(dump) };
  };
  /** @param {string} file @param {Record<string, unknown>} body */
  const writeRef = (file, body) => {
    fs.writeFileSync(
      file,
      JSON.stringify({ format: 'xuux.backup-sequence-reference', version: 1, ...body }),
    );
    return file;
  };
  return { root, backups, refDir, k1, k2, evil, backup, writeRef };
}

test(
  'WL-610 أصالة: الصحيحُ يُقبَل، والنسخُ المكرَّرةُ تُقبَل، وتعديلُ البيان، واستبدالُ الأرشيفِ وحدَه، واستبدالُهما معاً بلا توقيعٍ موثوق، والتوقيعُ التالف — كلُّها تُرفَضُ بسببٍ مُسمّى',
  { timeout: PER_TEST_TIMEOUT_MS },
  () => {
    const lab = wl610Lab();
    const b1 = lab.backup('state-1.dump', 'legit-content-1');
    const sign = (/** @type {any} */ m, /** @type {string} */ sha, /** @type {any} */ over = {}) =>
      signManifestPrototype(m, sha, {
        keyId: 'k1',
        backupId: 'b-1',
        sequence: 1,
        database: 'prod-a',
        privateKey: lab.k1.privateKey,
        ...over,
      });
    const policy = {
      trustedKeys: new Map([['k1', lab.k1.publicKey]]),
      database: 'prod-a',
      sequenceReference: sequenceReferenceOf(1, 1, { 1: ['b-1', b1.sha] }),
    };
    const env = sign(b1.manifest, b1.sha);
    const v = (/** @type {any} */ m, /** @type {string} */ sha, /** @type {any} */ e) =>
      verifyManifestPrototype(m, sha, e, policy);
    assert.deepEqual(v(b1.manifest, b1.sha, env), { ok: true, replayProtected: true });
    assert.equal(env.payload['backupId'], 'b-1', 'هويّةُ النسخةِ في الحمولةِ الموقَّعة');
    assert.equal(env.payload['dumpSha256'], b1.sha, 'بصمةُ الأرشيفِ في الحمولةِ الموقَّعة');

    // نسخةٌ مكرَّرةٌ بايتاً ببايت في موضعٍ آخر: النسخُ مشروعٌ ولا يُعَدُّ إعادةً ولا تعارضاً.
    const copyDir = path.join(lab.root, 'offsite');
    fs.mkdirSync(copyDir);
    fs.copyFileSync(b1.dump, path.join(copyDir, 'state-1.dump'));
    fs.copyFileSync(`${b1.dump}.manifest.json`, path.join(copyDir, 'state-1.dump.manifest.json'));
    const copied = JSON.parse(
      fs.readFileSync(path.join(copyDir, 'state-1.dump.manifest.json'), 'utf8'),
    );
    assert.deepEqual(v(copied, sha256Of(path.join(copyDir, 'state-1.dump')), env), {
      ok: true,
      replayProtected: true,
    });

    // (‏1) بيانٌ مُعدَّل: أيُّ حقلٍ في الحمولة.
    for (const edit of [
      (/** @type {any} */ m) => (m.startedAt = '2026-11-26T00:00:00.000Z'),
      (/** @type {any} */ m) => (m.migrationVersion = 31),
      (/** @type {any} */ m) => (m.contentDigest.sha256 = '0'.repeat(64)),
      (/** @type {any} */ m) => (m.sha256 = 'f'.repeat(64)),
    ]) {
      const m = structuredClone(b1.manifest);
      edit(m);
      assert.deepEqual(v(m, b1.sha, env), {
        ok: false,
        reason: MANIFEST_AUTH_REASONS.BINDING,
      });
    }
    // (‏2) الأرشيفُ مُستبدَلٌ والبيانُ باقٍ: البصمةُ تُحسَبُ من الملفِّ لا تُنقَلُ من البيان.
    fs.writeFileSync(b1.dump, 'attacker-content');
    assert.deepEqual(v(b1.manifest, sha256Of(b1.dump), env), {
      ok: false,
      reason: MANIFEST_AUTH_REASONS.BINDING,
    });
    // (‏3) الاثنانِ مُستبدَلان بنسخةٍ متّسقة: بلا توقيع، أو بمفتاحِ المهاجمِ باسمِه أو باسمِ المفتاحِ الموثوق،
    // أو بالتوقيعِ الشرعيِّ منقولاً.
    const evilB = lab.backup('state-1.dump', 'attacker-content');
    assert.deepEqual(v(evilB.manifest, evilB.sha, undefined), {
      ok: false,
      reason: MANIFEST_AUTH_REASONS.MISSING,
    });
    assert.equal(
      /** @type {any} */ (
        v(
          evilB.manifest,
          evilB.sha,
          sign(evilB.manifest, evilB.sha, { keyId: 'evil', privateKey: lab.evil.privateKey }),
        )
      ).reason,
      MANIFEST_AUTH_REASONS.UNTRUSTED_KEY,
    );
    assert.equal(
      /** @type {any} */ (
        v(
          evilB.manifest,
          evilB.sha,
          sign(evilB.manifest, evilB.sha, { privateKey: lab.evil.privateKey }),
        )
      ).reason,
      MANIFEST_AUTH_REASONS.INVALID,
    );
    assert.equal(
      /** @type {any} */ (v(evilB.manifest, evilB.sha, env)).reason,
      MANIFEST_AUTH_REASONS.BINDING,
    );
    // (‏4) توقيعٌ تالف: بتٌّ مقلوب، ونصٌّ ليس base64، وحمولةٌ عُدِّلَ رقمُها بعدَ التوقيع.
    const flipped = Buffer.from(env.signature, 'base64');
    flipped[0] = Number(flipped[0]) ^ 1;
    for (const bad of [
      { ...env, signature: flipped.toString('base64') },
      { ...env, signature: '%%%not-base64%%%' },
      { ...env, payload: { ...env.payload, sequence: 2 } },
      { ...env, payload: { ...env.payload, backupId: 'b-2' } },
    ]) {
      fs.copyFileSync(path.join(copyDir, 'state-1.dump'), b1.dump);
      assert.deepEqual(v(b1.manifest, sha256Of(b1.dump), bad), {
        ok: false,
        reason: MANIFEST_AUTH_REASONS.INVALID,
      });
    }
  },
);

test(
  'WL-610 إعادةُ التشغيل: الرقمُ داخلَ البيانِ لا يكفي — المرجعُ المستقلُّ يرفضُ القديمَ والمستقبليَّ وغيرَ المُسجَّلِ والمتعارض، ومرجعٌ غائبٌ أو داخلَ مجلّدِ النسخِ يُرفَضُ إلا بإذنٍ صريحٍ يُعلَنُ بلا حماية',
  { timeout: PER_TEST_TIMEOUT_MS },
  () => {
    const lab = wl610Lab();
    const b1 = lab.backup('state-1.dump', 'content-1');
    const b2 = lab.backup('state-2.dump', 'content-2');
    const sign = (
      /** @type {any} */ b,
      /** @type {number} */ sequence,
      /** @type {string} */ backupId,
    ) =>
      signManifestPrototype(b.manifest, b.sha, {
        keyId: 'k1',
        backupId,
        sequence,
        database: 'prod-a',
        privateKey: lab.k1.privateKey,
      });
    const e1 = sign(b1, 1, 'b-1');
    const e2 = sign(b2, 2, 'b-2');
    const refFile = path.join(lab.refDir, 'sequence.json');
    lab.writeRef(refFile, {
      floor: 1,
      latestIssued: 1,
      issued: { 1: { backupId: 'b-1', dumpSha256: b1.sha } },
    });
    const load = (/** @type {string} */ f) => loadSequenceReference(f, lab.backups);
    const at = (/** @type {string} */ f) => {
      const r = load(f);
      assert.equal(r.ok, true, JSON.stringify(r));
      return /** @type {any} */ (r).reference;
    };
    const policy = (/** @type {any} */ sequenceReference, /** @type {any} */ over = {}) => ({
      trustedKeys: new Map([['k1', lab.k1.publicKey]]),
      database: 'prod-a',
      sequenceReference,
      ...over,
    });
    assert.deepEqual(verifyManifestPrototype(b1.manifest, b1.sha, e1, policy(at(refFile))), {
      ok: true,
      replayProtected: true,
    });
    // صدرت النسخةُ 2 ورُفِعَ الحدُّ في المرجع: القديمةُ الموقَّعةُ الصحيحةُ تُرفَض، والجديدةُ تُقبَل.
    lab.writeRef(refFile, {
      floor: 2,
      latestIssued: 2,
      issued: {
        1: { backupId: 'b-1', dumpSha256: b1.sha },
        2: { backupId: 'b-2', dumpSha256: b2.sha },
      },
    });
    const ref2 = at(refFile);
    assert.deepEqual(verifyManifestPrototype(b1.manifest, b1.sha, e1, policy(ref2)), {
      ok: false,
      reason: MANIFEST_AUTH_REASONS.REPLAY,
    });
    assert.deepEqual(verifyManifestPrototype(b2.manifest, b2.sha, e2, policy(ref2)), {
      ok: true,
      replayProtected: true,
    });
    // الرقمُ في البيانِ وحدَه: المهاجمُ يضعُ بجانبِ النسخةِ القديمةِ «مرجعاً» يقولُ إنّها الأحدث.
    const forged = lab.writeRef(path.join(lab.backups, 'sequence.json'), {
      floor: 1,
      latestIssued: 1,
      issued: { 1: { backupId: 'b-1', dumpSha256: b1.sha } },
    });
    assert.deepEqual(load(forged), {
      ok: false,
      reason: MANIFEST_AUTH_REASONS.SEQUENCE_REFERENCE_NOT_INDEPENDENT,
    });
    // ولو كانَ رابطاً داخلَ المجلّدِ إلى المرجعِ الحقيقيّ: الرابطُ نفسُه في يدِ من يكتبُ النسخ.
    const link = path.join(lab.backups, 'ref-link.json');
    fs.symlinkSync(refFile, link);
    assert.equal(
      /** @type {any} */ (load(link)).reason,
      MANIFEST_AUTH_REASONS.SEQUENCE_REFERENCE_NOT_INDEPENDENT,
    );
    // ورابطٌ خارجَه يُشيرُ إلى داخلِه.
    const outLink = path.join(lab.root, 'out-link.json');
    fs.symlinkSync(forged, outLink);
    assert.equal(
      /** @type {any} */ (load(outLink)).reason,
      MANIFEST_AUTH_REASONS.SEQUENCE_REFERENCE_NOT_INDEPENDENT,
    );
    // غائب، تالف، أو بلا حدٍّ صالح ⇒ لا يُقرأُ «لا حدّ».
    for (const body of ['', '{', '[]', JSON.stringify({ format: 'x', version: 1 })]) {
      fs.writeFileSync(path.join(lab.refDir, 'bad.json'), body);
      assert.equal(
        /** @type {any} */ (load(path.join(lab.refDir, 'bad.json'))).reason,
        MANIFEST_AUTH_REASONS.SEQUENCE_REFERENCE_UNAVAILABLE,
      );
    }
    for (const body of [
      { floor: 0, latestIssued: 1, issued: {} },
      { floor: 2, latestIssued: 1, issued: {} },
      { floor: 1, latestIssued: 1, issued: [] },
      { floor: 1, latestIssued: 1, issued: { '01': { backupId: 'b', dumpSha256: 'x' } } },
      { floor: 1.5, latestIssued: 2, issued: {} },
    ]) {
      lab.writeRef(path.join(lab.refDir, 'bad.json'), body);
      assert.equal(
        /** @type {any} */ (load(path.join(lab.refDir, 'bad.json'))).reason,
        MANIFEST_AUTH_REASONS.SEQUENCE_REFERENCE_UNAVAILABLE,
        JSON.stringify(body),
      );
    }
    assert.equal(
      /** @type {any} */ (load(path.join(lab.refDir, 'missing.json'))).reason,
      MANIFEST_AUTH_REASONS.SEQUENCE_REFERENCE_UNAVAILABLE,
    );
    assert.deepEqual(verifyManifestPrototype(b1.manifest, b1.sha, e1, policy(null)), {
      ok: false,
      reason: MANIFEST_AUTH_REASONS.SEQUENCE_REFERENCE_UNAVAILABLE,
    });
    assert.deepEqual(
      verifyManifestPrototype(
        b1.manifest,
        b1.sha,
        e1,
        policy(null, { allowUnprotectedReplay: true }),
      ),
      { ok: true, replayProtected: false },
      'الإذنُ الصريحُ لا يُخفي غيابَ الحماية',
    );
    // مستقبليّ: موقَّعٌ صحيحاً برقمٍ لم يُصدِرْه المرجعُ بعد (‏مفتاحٌ مسروقٌ أو مرجعٌ متأخّر).
    const b3 = lab.backup('state-3.dump', 'content-3');
    assert.deepEqual(
      verifyManifestPrototype(b3.manifest, b3.sha, sign(b3, 3, 'b-3'), policy(ref2)),
      {
        ok: false,
        reason: MANIFEST_AUTH_REASONS.FUTURE,
      },
    );
    // ضمنَ المدى بلا سجلّ.
    const gap = sequenceReferenceOf(1, 3, { 1: ['b-1', b1.sha], 3: ['b-3', b3.sha] });
    assert.deepEqual(verifyManifestPrototype(b2.manifest, b2.sha, e2, policy(gap)), {
      ok: false,
      reason: MANIFEST_AUTH_REASONS.UNKNOWN,
    });
    // تعارض: الرقمُ نفسُه لنسخةٍ أخرى، أو الهويّةُ نفسُها برقمٍ آخر، أو الرقمُ والهويّةُ بأرشيفٍ آخر.
    const ref3 = sequenceReferenceOf(1, 3, {
      1: ['b-1', b1.sha],
      2: ['b-2', b2.sha],
      3: ['b-3', b3.sha],
    });
    for (const [b, seq, id] of /** @type {Array<[any, number, string]>} */ ([
      [b3, 2, 'b-3'],
      [b2, 3, 'b-2'],
      [b3, 2, 'b-2'],
    ])) {
      assert.deepEqual(verifyManifestPrototype(b.manifest, b.sha, sign(b, seq, id), policy(ref3)), {
        ok: false,
        reason: MANIFEST_AUTH_REASONS.CONFLICT,
      });
    }
    // الأرشيفُ والرقمُ صحيحان والهويّةُ وحدَها مختلفة.
    assert.deepEqual(
      verifyManifestPrototype(b2.manifest, b2.sha, sign(b2, 2, 'b-x'), policy(ref3)),
      { ok: false, reason: MANIFEST_AUTH_REASONS.CONFLICT },
    );
    // مرجعٌ يُسجِّلُ الهويّةَ نفسَها برقمَين: السجلُّ المطابقُ لا يكفي.
    const dup = sequenceReferenceOf(1, 3, { 2: ['b-2', b2.sha], 3: ['b-2', b3.sha] });
    assert.deepEqual(verifyManifestPrototype(b2.manifest, b2.sha, e2, policy(dup)), {
      ok: false,
      reason: MANIFEST_AUTH_REASONS.CONFLICT,
    });
  },
);

test(
  'WL-610 المفاتيح: فقدُ مفتاحِ التحقّقِ يُغلِقُ الحكم، والتدويرُ يُبقي القديمَ قابلاً للتحقّقِ ما دامَ موثوقاً، والإلغاءُ يرفضُ ولو بقيَ المفتاحُ في القائمة',
  { timeout: PER_TEST_TIMEOUT_MS },
  () => {
    const lab = wl610Lab();
    const b1 = lab.backup('state-1.dump', 'content-1');
    const b2 = lab.backup('state-2.dump', 'content-2');
    const e1 = signManifestPrototype(b1.manifest, b1.sha, {
      keyId: 'k1',
      backupId: 'b-1',
      sequence: 1,
      database: 'prod-a',
      privateKey: lab.k1.privateKey,
    });
    const e2 = signManifestPrototype(b2.manifest, b2.sha, {
      keyId: 'k2',
      backupId: 'b-2',
      sequence: 2,
      database: 'prod-a',
      privateKey: lab.k2.privateKey,
    });
    const ref = sequenceReferenceOf(1, 2, { 1: ['b-1', b1.sha], 2: ['b-2', b2.sha] });
    const v = (
      /** @type {any} */ b,
      /** @type {any} */ e,
      /** @type {any} */ keys,
      /** @type {any} */ over = {},
    ) =>
      verifyManifestPrototype(b.manifest, b.sha, e, {
        trustedKeys: keys,
        database: 'prod-a',
        sequenceReference: ref,
        ...over,
      });
    // فقدُ مفتاحِ التحقّق: لا قائمةَ أو قائمةٌ فارغة ⇒ رفضٌ لا قبول.
    for (const keys of [new Map(), undefined, null]) {
      assert.deepEqual(v(b1, e1, keys), {
        ok: false,
        reason: MANIFEST_AUTH_REASONS.NO_TRUSTED_KEYS,
      });
    }
    // فُقِدَ k1 وبقيَ k2: نسخُ k1 لا تُقبَلُ حتّى يُستعادَ مفتاحُها العامُّ من مصدرٍ مستقلّ.
    assert.deepEqual(v(b1, e1, new Map([['k2', lab.k2.publicKey]])), {
      ok: false,
      reason: MANIFEST_AUTH_REASONS.UNTRUSTED_KEY,
    });
    // مفتاحٌ عامٌّ مستعادٌ خطأً (‏مفتاحٌ آخرُ بالمعرّفِ نفسِه) ⇒ التوقيعُ لا يُطابق.
    assert.deepEqual(v(b1, e1, new Map([['k1', lab.evil.publicKey]])), {
      ok: false,
      reason: MANIFEST_AUTH_REASONS.INVALID,
    });
    // التدوير: k2 يوقِّعُ الجديد، وk1 باقٍ للتحقّقِ من القديم.
    const both = new Map([
      ['k1', lab.k1.publicKey],
      ['k2', lab.k2.publicKey],
    ]);
    assert.deepEqual(v(b1, e1, both), { ok: true, replayProtected: true });
    assert.deepEqual(v(b2, e2, both), { ok: true, replayProtected: true });
    // الإلغاء (‏تسريبُ k1): يُرفَضُ ما وقَّعَه ولو بقيَ في القائمة؛ وما وقَّعَه k2 لا يتأثّر.
    const revokedKeys = new Set(['k1']);
    assert.deepEqual(v(b1, e1, both, { revokedKeys }), {
      ok: false,
      reason: MANIFEST_AUTH_REASONS.KEY_REVOKED,
    });
    assert.deepEqual(v(b2, e2, both, { revokedKeys }), { ok: true, replayProtected: true });
  },
);

test(
  'WL-611 احتواءُ مرجعِ التسلسل: مقطعُ `..` كاملٌ لا بادئةٌ نصّيّة — مجلّدٌ أو ملفٌّ داخليٌّ اسمُه يبدأُ بـ`..` داخلَ مجلّدِ النسخِ يُرفَض مباشرةً وعبرَ الروابط، والخارجُ الحقيقيُّ وشقيقٌ يشاركُ البادئةَ يُقبَلان',
  { timeout: PER_TEST_TIMEOUT_MS },
  () => {
    const lab = wl610Lab();
    const body = {
      floor: 1,
      latestIssued: 1,
      issued: { 1: { backupId: 'b-1', dumpSha256: 'x' } },
    };
    const put = (/** @type {string} */ file) => {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      return lab.writeRef(file, body);
    };
    const load = (/** @type {string} */ f) => loadSequenceReference(f, lab.backups);
    const reason = (/** @type {string} */ f) => {
      const r = load(f);
      return r.ok ? 'ACCEPTED' : r.reason;
    };
    const NOT_INDEPENDENT = MANIFEST_AUTH_REASONS.SEQUENCE_REFERENCE_NOT_INDEPENDENT;
    // خارجَ المجلّدِ فعلاً: يُقبَل — ومنه شقيقٌ يشاركُ اسمَ المجلّدِ بادئةً، ومسارٌ يخرجُ بـ`..` حقيقيّ.
    const real = put(path.join(lab.refDir, 'sequence.json'));
    assert.equal(reason(real), 'ACCEPTED');
    assert.equal(reason(put(path.join(lab.root, 'backups-sibling', 'sequence.json'))), 'ACCEPTED');
    assert.equal(
      reason(path.join(lab.backups, '..', path.basename(lab.refDir), 'sequence.json')),
      'ACCEPTED',
    );
    // داخلَ المجلّدِ باسمٍ يبدأُ بـ`..`: كانَ `startsWith('..')` يعدُّه خارجاً فيقبلُه.
    const inDir = put(path.join(lab.backups, '..trusted', 'sequence.json'));
    assert.equal(reason(inDir), NOT_INDEPENDENT);
    assert.equal(reason(put(path.join(lab.backups, '..sequence.json'))), NOT_INDEPENDENT);
    assert.equal(reason(put(path.join(lab.backups, '...', 'sequence.json'))), NOT_INDEPENDENT);
    // رابطٌ داخليٌّ تحتَ `..x/` إلى المرجعِ الحقيقيّ: يُرفَضُ لفظيّاً.
    const linkIn = path.join(lab.backups, '..link', 'ref.json');
    fs.mkdirSync(path.dirname(linkIn));
    fs.symlinkSync(real, linkIn);
    assert.equal(reason(linkIn), NOT_INDEPENDENT);
    // رابطُ ملفٍّ ورابطُ مجلّدٍ خارجَ المجلّدِ يُشيرانِ إلى `..trusted/`: يُرفَضانِ بعدَ حلِّ الروابط.
    const outLink = path.join(lab.root, 'out-link.json');
    fs.symlinkSync(inDir, outLink);
    assert.equal(reason(outLink), NOT_INDEPENDENT);
    const dirLink = path.join(lab.root, 'escape-dir');
    fs.symlinkSync(path.dirname(inDir), dirLink);
    assert.equal(reason(path.join(dirLink, 'sequence.json')), NOT_INDEPENDENT);
    // مجلّدُ النسخِ نفسُه ليس مرجعاً مستقلّاً (‏لا «غيرُ متاح»).
    assert.equal(reason(lab.backups), NOT_INDEPENDENT);
    // غائبٌ تحتَ `..x/` داخلَ المجلّد: الاحتواءُ اللفظيُّ يسبقُ القراءة؛ وغائبٌ خارجَه ⇒ غيرُ متاح.
    assert.equal(reason(path.join(lab.backups, '..ghost', 'none.json')), NOT_INDEPENDENT);
    assert.equal(
      reason(path.join(lab.refDir, 'none.json')),
      MANIFEST_AUTH_REASONS.SEQUENCE_REFERENCE_UNAVAILABLE,
    );
  },
);

test(
  'WL-612 ربطُ التوقيعِ بالبيانِ كلِّه (‏LIVE-78/SIGNATURE-BINDING): تعديلُ أيِّ حقلٍ — rowCounts أو contentDigest.tables أو durationMs أو dumpFile — أو إضافتُه أو حذفُه يُرفَض، وإعادةُ ترتيبِ المفاتيحِ والمرورُ بـJSON لا يُغيِّران الحكم، والحمولةُ القديمةُ بلا بصمةِ البيانِ تُرفَض',
  { timeout: PER_TEST_TIMEOUT_MS },
  () => {
    const sha = 'a'.repeat(64);
    // حقولُ البيانِ الإنتاجيّة (‏scripts/backup.mjs) بقيمٍ تمثيليّة.
    const manifest = {
      startedAt: '2026-11-25T00:00:00.000Z',
      durationMs: 1200,
      databaseVersion: 'PostgreSQL 18',
      migrationVersion: 35,
      sha256: sha,
      rowCounts: { 'state.ledger': 3, 'state.events': 7 },
      dumpFile: 'state-20261125.dump',
      ledgerStagingTable: 'ledger_staging',
      contentDigestMs: 40,
      contentDigest: {
        version: 1,
        sha256: 'b'.repeat(64),
        tables: { 'state.ledger': { rows: '3', sha256: 'c'.repeat(64) } },
      },
    };
    const keys = crypto.generateKeyPairSync('ed25519');
    const envelope = signManifestPrototype(manifest, sha, {
      keyId: 'k1',
      backupId: 'b-1',
      sequence: 1,
      database: 'db',
      privateKey: keys.privateKey,
    });
    const policy = {
      trustedKeys: new Map([['k1', keys.publicKey]]),
      database: 'db',
      sequenceReference: {
        floor: 1,
        latestIssued: 1,
        issued: new Map([[1, { backupId: 'b-1', dumpSha256: sha }]]),
      },
    };
    const verdict = (/** @type {any} */ m, env = envelope) => {
      const r = verifyManifestPrototype(m, sha, env, policy);
      return r.ok ? 'OK' : r.reason;
    };
    const BINDING = MANIFEST_AUTH_REASONS.BINDING;
    const clone = () => JSON.parse(JSON.stringify(manifest));
    assert.equal(verdict(manifest), 'OK');
    // المرورُ بملفٍّ وإعادةُ ترتيبِ المفاتيحِ لا يُغيِّرانِ البصمةَ القانونيّة.
    assert.equal(verdict(clone()), 'OK');
    const reordered = Object.fromEntries(Object.entries(clone()).reverse());
    reordered.contentDigest = Object.fromEntries(Object.entries(manifest.contentDigest).reverse());
    assert.equal(verdict(reordered), 'OK');
    // كلُّ حقلٍ داخلَ التوقيع: ما كانَ يمرُّ قبلَ WL-612 (‏rowCounts، tables، durationMs، حقلٌ مضاف).
    /** @type {Array<[string, (m: any) => void]>} */
    const mutations = [
      ['rowCounts', (m) => (m.rowCounts['state.ledger'] = 999)],
      ['contentDigest.tables', (m) => (m.contentDigest.tables['state.ledger'].rows = '999')],
      ['durationMs', (m) => (m.durationMs = 1)],
      ['dumpFile', (m) => (m.dumpFile = 'other.dump')],
      ['databaseVersion', (m) => (m.databaseVersion = 'PostgreSQL 9')],
      ['ledgerStagingTable', (m) => (m.ledgerStagingTable = 'evil')],
      ['حقلٌ مضاف', (m) => (m.injected = true)],
      ['حقلٌ محذوف', (m) => delete m.rowCounts],
      ['جدولٌ مضاف', (m) => (m.contentDigest.tables['state.x'] = { rows: '0', sha256: 'd' })],
      ['sha256', (m) => (m.sha256 = 'f'.repeat(64))],
    ];
    for (const [name, mutate] of mutations) {
      const m = clone();
      mutate(m);
      assert.equal(verdict(m), BINDING, name);
    }
    // حقلٌ `undefined` يُسقطُه JSON: يُوقَّعُ كما يُكتَبُ في الملفّ فيُقبَلُ بعدَ القراءة.
    const withUndefined = { ...clone(), note: undefined };
    const envU = signManifestPrototype(withUndefined, sha, {
      keyId: 'k1',
      backupId: 'b-1',
      sequence: 1,
      database: 'db',
      privateKey: keys.privateKey,
    });
    assert.equal(verdict(clone(), envU), 'OK');
    // بيانٌ لا يُسلسَلُ JSON يُرفَضُ بسببٍ مُسمّى ولا يرمي.
    assert.equal(verdict({ ...clone(), rowCounts: 1n }), BINDING);
    // خفضُ الإصدار: حمولةُ الإصدارِ 2 (‏بلا manifestSha256) موقَّعةٌ بمفتاحٍ موثوقٍ تُرفَض.
    const { manifestSha256: _dropped, ...v3rest } = envelope.payload;
    assert.match(_dropped, /^[0-9a-f]{64}$/u);
    const legacy = { ...v3rest, version: 2 };
    const legacySig = crypto
      .sign(null, Buffer.from(canonicalForTest(legacy), 'utf8'), keys.privateKey)
      .toString('base64');
    assert.equal(
      verdict(manifest, /** @type {any} */ ({ payload: legacy, signature: legacySig })),
      BINDING,
    );
  },
);

/** @param {unknown} value @returns {string} نسخةٌ مستقلّةٌ من التسلسلِ القانونيِّ لتوقيعِ حمولةٍ قديمة */
function canonicalForTest(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalForTest).join(',')}]`;
  const record = /** @type {Record<string, unknown>} */ (value);
  return `{${Object.keys(record)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonicalForTest(record[k])}`)
    .join(',')}}`;
}

// ═══ ‏`WL-613` — معيارُ إغلاقِ `LIVE-78/SIGNATURE-BINDING`: كلُّ حقلٍ في البيانِ الإنتاجيِّ حاضراً ومستقبلاً ═══════
// طبقتان: (١) ثابتةٌ بلا قاعدة — تعريفا `BackupManifest` و`ContentDigest` في `scripts/backup.mjs` (‏بما فيها الأنواعُ
// المضمَّنةُ المتداخلة) يطابقانِ الكائنَين المكتوبَين فعلاً، والتمثيليُّ يطابقُ التعريفَ في كلِّ عمق؛ (٢) حقيقيّةٌ —
// بيانٌ أنتجَه `scripts/backup.mjs` نفسُه يُطابَقُ بالتعريف، ثمّ **كلُّ مفتاحٍ في كلِّ عمق** يُغيَّرُ ويُحذَف، ويُضافُ
// مفتاحٌ إلى كلِّ كائن ⇒ `BINDING`. حقلٌ إنتاجيٌّ جديدٌ لا يُعلَنُ في التعريفِ يُسقِطُ (٢)، ومُعلَنٌ لا يُكتَبُ يُسقِطُ (١).

const BACKUP_SOURCE = path.join(HERE, '..', '..', 'scripts', 'backup.mjs');

/** @param {string} text @param {number} open موضعُ قوسٍ فاتح @returns {number} موضعُ مقابلِه */
function matchingBrace(text, open) {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}' && --depth === 0) return i;
  }
  throw new Error(`قوسٌ بلا مقابل عندَ ${open}`);
}

/**
 * خصائصُ `@typedef {object} name` بأنواعِها — بموازنةِ الأقواسِ لا `[^}]+` (‏الأنواعُ المضمَّنةُ فيها أقواس).
 * @param {string} source @param {string} name @returns {Map<string, string>}
 */
function typedefProperties(source, name) {
  const head = `@typedef {object} ${name}\n`;
  const start = source.indexOf(head);
  assert.ok(start >= 0, `التعريفُ ${name} غيرُ موجود`);
  const block = source.slice(start + head.length, source.indexOf('*/', start));
  /** @type {Map<string, string>} */
  const props = new Map();
  let at = 0;
  for (;;) {
    const tag = block.indexOf('@property {', at);
    if (tag < 0) break;
    const open = tag + '@property '.length;
    const close = matchingBrace(block, open);
    const m = /^\s+\[?([A-Za-z0-9_]+)\]?/u.exec(block.slice(close + 1));
    assert.ok(m, `خاصّيّةٌ بلا اسمٍ في ${name}`);
    props.set(String(m[1]), block.slice(open + 1, close).trim());
    at = close + 1;
  }
  assert.ok(props.size > 0, `${name} بلا خصائص`);
  return props;
}

/**
 * مفاتيحُ أوّلِ نوعِ كائنٍ مضمَّنٍ في نوع (‏`{ a: X, b: Y }` أو `Record<string, { a: X }>`)، أو `null` إن لم يكن.
 * @param {string} type @returns {string[] | null}
 */
function inlineObjectKeys(type) {
  const open = type.indexOf('{');
  if (open < 0) return null;
  const body = type.slice(open + 1, matchingBrace(type, open));
  /** @type {string[]} */
  const keys = [];
  let depth = 0;
  let piece = '';
  for (const ch of `${body},`) {
    if ('{<[('.includes(ch)) depth++;
    if ('}>])'.includes(ch)) depth--;
    if (ch === ',' && depth === 0) {
      const m = /^\s*([A-Za-z0-9_]+)\??\s*:/u.exec(piece);
      if (m) keys.push(String(m[1]));
      piece = '';
    } else piece += ch;
  }
  return keys;
}

/**
 * مفاتيحُ كائنٍ حرفيٍّ يبدأُ بـ`marker` في المصدر (‏الاختصارُ `a,` والصريحُ `a:` والانتشارُ `...x` يُرفَض).
 * @param {string} source @param {string} marker @returns {string[]}
 */
function literalKeys(source, marker) {
  const at = source.indexOf(marker);
  assert.ok(at >= 0, `الكائنُ «${marker}» غيرُ موجود`);
  const open = source.indexOf('{', at + marker.length - 1);
  const body = source.slice(open + 1, matchingBrace(source, open));
  /** @type {string[]} */
  const keys = [];
  let depth = 0;
  let piece = '';
  for (const ch of `${body},`) {
    if ('{<[('.includes(ch)) depth++;
    if ('}>])'.includes(ch)) depth--;
    if (ch === ',' && depth === 0) {
      const t = piece.trim();
      if (t) {
        assert.ok(!t.startsWith('...'), `انتشارٌ في «${marker}» لا يُعَدُّ حقلاً: ${t}`);
        const m = /^([A-Za-z0-9_]+)\s*(?::|$)/u.exec(t);
        assert.ok(m, `مفتاحٌ غيرُ مقروءٍ في «${marker}»: ${t}`);
        keys.push(String(m[1]));
      }
      piece = '';
    } else piece += ch;
  }
  return keys;
}

/** @param {Iterable<string>} xs */
const sorted = (xs) => [...xs].sort();

/**
 * الشكلُ المُعلَنُ في الإنتاج: حقولُ البيان، وحقولُ البصمة، والأشكالُ المتداخلةُ المضمَّنة.
 * @returns {{ manifest: string[], digest: string[], nested: Record<string, { keys: string[], record: boolean }> }}
 */
function declaredManifestShape() {
  const source = fs.readFileSync(BACKUP_SOURCE, 'utf8');
  const manifestProps = typedefProperties(source, 'BackupManifest');
  const digestProps = typedefProperties(source, 'ContentDigest');
  // المكتوبُ فعلاً يطابقُ المُعلَن: كائنُ البيانِ في `backup()`، وجسمُ البصمةِ + `sha256` في `computeContentDigest`.
  assert.deepEqual(sorted(literalKeys(source, 'const manifest = {')), sorted(manifestProps.keys()));
  const bodyKeys = literalKeys(source, 'const body = {');
  assert.match(source, /return \{ \.\.\.body, sha256: digestBodySha256\(body\) \};/u);
  assert.deepEqual(sorted([...bodyKeys, 'sha256']), sorted(digestProps.keys()));
  /** @type {Record<string, { keys: string[], record: boolean }>} */
  const nested = {};
  for (const [field, type] of digestProps) {
    const keys = inlineObjectKeys(type);
    if (keys) nested[`contentDigest.${field}`] = { keys, record: type.startsWith('Record<') };
  }
  return { manifest: sorted(manifestProps.keys()), digest: sorted(digestProps.keys()), nested };
}

/**
 * يطابقُ بياناً بالشكلِ المُعلَن في كلِّ عمقٍ مُعلَن؛ `record` ⇒ كلُّ قيمةٍ في السجلِّ بالمفاتيحِ نفسِها.
 * @param {Record<string, any>} m @param {ReturnType<typeof declaredManifestShape>} shape @param {string} label
 */
function assertManifestMatchesShape(m, shape, label) {
  assert.deepEqual(sorted(Object.keys(m)), shape.manifest, `${label}: حقولُ البيان`);
  assert.deepEqual(sorted(Object.keys(m['contentDigest'])), shape.digest, `${label}: حقولُ البصمة`);
  for (const [where, { keys, record }] of Object.entries(shape.nested)) {
    const value = m['contentDigest'][where.slice('contentDigest.'.length)];
    const entries = record ? Object.values(value) : [value];
    assert.ok(entries.length > 0, `${label}: ${where} فارغٌ فلا يُقاسُ شكلُه`);
    for (const e of entries)
      assert.deepEqual(sorted(Object.keys(e)), sorted(keys), `${label}: ${where}`);
  }
}

/**
 * كلُّ مسارٍ في الشجرة (‏مفاتيحُ الكائناتِ وفهارسُ المصفوفات)، والكائناتُ نفسُها لإضافةِ مفتاح.
 * @param {unknown} node @param {Array<string | number>} at
 * @returns {{ leaves: Array<Array<string | number>>, objects: Array<Array<string | number>> }}
 */
function treePaths(node, at = []) {
  /** @type {Array<Array<string | number>>} */
  const leaves = [];
  /** @type {Array<Array<string | number>>} */
  const objects = [];
  if (Array.isArray(node)) {
    node.forEach((v, i) => {
      leaves.push([...at, i]);
      const sub = treePaths(v, [...at, i]);
      leaves.push(...sub.leaves);
      objects.push(...sub.objects);
    });
  } else if (node !== null && typeof node === 'object') {
    objects.push(at);
    for (const [k, v] of Object.entries(node)) {
      leaves.push([...at, k]);
      const sub = treePaths(v, [...at, k]);
      leaves.push(...sub.leaves);
      objects.push(...sub.objects);
    }
  }
  return { leaves, objects };
}

/** @param {unknown} v */
function alteredValue(v) {
  if (typeof v === 'string') return `${v}x`;
  if (typeof v === 'number') return v + 1;
  if (typeof v === 'boolean') return !v;
  if (v === null) return 0;
  if (Array.isArray(v)) return [...v, 'x'];
  return { .../** @type {object} */ (v), injected: 1 };
}

/**
 * يوقّعُ البيانَ ثمّ يُغيّرُ كلَّ مسارٍ ويحذفُه ويُضيفُ مفتاحاً إلى كلِّ كائن؛ كلٌّ ⇒ `BINDING`. يُعيدُ عددَ الطفرات.
 * @param {Record<string, any>} manifest @param {string} dumpSha
 */
function assertEveryPathBound(manifest, dumpSha) {
  const keys = crypto.generateKeyPairSync('ed25519');
  const envelope = signManifestPrototype(manifest, dumpSha, {
    keyId: 'k1',
    backupId: 'b-1',
    sequence: 1,
    database: 'db',
    privateKey: keys.privateKey,
  });
  const policy = {
    trustedKeys: new Map([['k1', keys.publicKey]]),
    database: 'db',
    sequenceReference: {
      floor: 1,
      latestIssued: 1,
      issued: new Map([[1, { backupId: 'b-1', dumpSha256: dumpSha }]]),
    },
  };
  const verdict = (/** @type {any} */ m) => {
    const r = verifyManifestPrototype(m, dumpSha, envelope, policy);
    return r.ok ? 'OK' : r.reason;
  };
  const copy = () => JSON.parse(JSON.stringify(manifest));
  assert.equal(verdict(copy()), 'OK', 'البيانُ نفسُه بعدَ المرورِ بـJSON');
  /** @param {any} root @param {Array<string | number>} p */
  const parentOf = (root, p) => p.slice(0, -1).reduce((o, k) => o[k], root);
  const { leaves, objects } = treePaths(copy());
  let mutations = 0;
  for (const p of leaves) {
    const label = p.join('.');
    const changed = copy();
    const parent = parentOf(changed, p);
    const last = /** @type {any} */ (p[p.length - 1]);
    parent[last] = alteredValue(parent[last]);
    assert.equal(verdict(changed), MANIFEST_AUTH_REASONS.BINDING, `تغييرُ ${label}`);
    const removed = copy();
    const rParent = parentOf(removed, p);
    if (Array.isArray(rParent)) rParent.splice(Number(last), 1);
    else delete rParent[last];
    assert.equal(verdict(removed), MANIFEST_AUTH_REASONS.BINDING, `حذفُ ${label}`);
    mutations += 2;
  }
  for (const p of objects) {
    const added = copy();
    const target = p.reduce((o, k) => o[k], added);
    target['__wl613_added'] = 'x';
    assert.equal(
      verdict(added),
      MANIFEST_AUTH_REASONS.BINDING,
      `إضافةٌ في ${p.join('.') || '<الجذر>'}`,
    );
    mutations += 1;
  }
  return mutations;
}

test(
  'WL-613 الطبقةُ الثابتة (‏بلا قاعدة): تعريفا BackupManifest وContentDigest بأنواعِهما المتداخلة يطابقانِ المكتوبَ فعلاً في scripts/backup.mjs، والبيانُ التمثيليُّ يطابقُهما في كلِّ عمق، وكلُّ مسارٍ فيه يُغيَّرُ ويُحذَفُ وكلُّ كائنٍ يُزادُ ⇒ BINDING',
  { timeout: PER_TEST_TIMEOUT_MS },
  () => {
    const shape = declaredManifestShape();
    assert.ok(shape.manifest.length >= 10, `حقولُ البيانِ أقلُّ من المتوقَّع: ${shape.manifest}`);
    assert.ok(shape.digest.length >= 8, `حقولُ البصمةِ أقلُّ من المتوقَّع: ${shape.digest}`);
    const sha = 'a'.repeat(64);
    /** @type {Record<string, any>} */
    const manifest = {
      startedAt: '2026-11-25T00:00:00.000Z',
      durationMs: 1200,
      databaseVersion: 'PostgreSQL 18',
      migrationVersion: 35,
      sha256: sha,
      rowCounts: { 'state.ledger': 3 },
      dumpFile: 'state.dump',
      ledgerStagingTable: '__backup_schema_migrations_abc',
      contentDigestMs: 40,
      contentDigest: {
        format: 'xuux.content-digest',
        version: 1,
        canonicalization: { settings: { DateStyle: 'ISO, YMD' }, row: 'row-rule' },
        scope: { schema: 'state', excludes: ['__backup_schema_migrations_*'] },
        tables: {
          'state.ledger': { columns: [['id', 'bigint', true]], rows: '3', sha256: 'c'.repeat(64) },
        },
        sequences: { 'state.ledger_id_seq': { lastValue: '3', isCalled: true, increment: '1' } },
        ledger: { rows: '35', sha256: 'd'.repeat(64) },
        sha256: 'b'.repeat(64),
      },
    };
    assertManifestMatchesShape(manifest, shape, 'التمثيليّ');
    const n = assertEveryPathBound(manifest, sha);
    assert.ok(n > 60, `طفراتٌ أقلُّ من المتوقَّع: ${n}`);
  },
);

test(
  'WL-613 الطبقةُ الحقيقيّة: بيانٌ أنتجَه scripts/backup.mjs يطابقُ التعريفَ في كلِّ عمقٍ مُعلَن، وكلُّ مفتاحٍ فيه في كلِّ عمقٍ يُغيَّرُ ويُحذَف، ويُضافُ مفتاحٌ إلى كلِّ كائن ⇒ BINDING',
  { skip: skipWithoutDatabase, timeout: PER_TEST_TIMEOUT_MS },
  async (t) => {
    const golden = await sharedGoldenBackup();
    const manifest = JSON.parse(fs.readFileSync(golden.manifest, 'utf8'));
    assertManifestMatchesShape(manifest, declaredManifestShape(), 'الحقيقيّ');
    const n = assertEveryPathBound(manifest, sha256Of(golden.dump));
    t.diagnostic(`WL-613 real manifest: ${n} mutations, all BINDING`);
  },
);
