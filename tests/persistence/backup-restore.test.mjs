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
import { catalogSnapshot, createIsolatedDatabase, skipWithoutDatabase } from '../helpers/pg.mjs';
import { createTestEncryptor } from '../helpers/encryption.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const BACKUP_SCRIPT = path.join(ROOT, 'scripts/backup.mjs');
const RESTORE_SCRIPT = path.join(ROOT, 'scripts/restore.mjs');
const STATE_SCHEMA = 'state';

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
 * ‏`WL-597`: صورةُ الهدفِ كلِّه لإثباتِ أنّ الرفضَ لم يمسَّه: الكتالوجُ مع الدوالِّ وقوادحِ الأحداث،
 * ومحتوى `state`، والدفتر، وقوادحُ الجداولِ (‏`xf_guard`)، وصلاحيّاتُ المخطّطات، وصفُّ التحكّمِ
 * وأحداثُ السياجِ إن وُجد. ‏`omitSchema` يُسقِطُ مخطّطاً من الصورةِ وحدَه (‏تداخلٌ يُنشئُه عمداً).
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
  });
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
  { skip: skipWithoutDatabase },
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
  { skip: skipWithoutDatabase },
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

test('verify يرفض ملف نسخة عُدّل بعد كتابة البيان', { skip: skipWithoutDatabase }, async () => {
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
});

test(
  'البيانُ والنسخةُ لقطةٌ واحدة: كتاباتٌ متزامنةٌ أثناءَ النسخِ لا تفصلُ بينَهما (`WL-398`)',
  { skip: skipWithoutDatabase, timeout: 120_000 },
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
      let stop = false;
      const writer = (async () => {
        for (let n = 0; !stop; n += 1) {
          await source.pool
            .query(
              `INSERT INTO state.events (event_id, type, actor, payload, hash, occurred_at)
               VALUES ($1, 'backup.concurrent', 'agent-001', '{}'::jsonb, $2, now())`,
              [`concurrent-${n}`, 'c'.repeat(64)],
            )
            .catch(() => undefined);
          await new Promise((resolve) => setTimeout(resolve, 25));
        }
      })();

      const backup = await runNode([BACKUP_SCRIPT, 'create', dump], sourceUrl);
      stop = true;
      await writer;
      assert.equal(backup.code, 0, backup.stderr);
      assert.match(backup.stdout, /\[BACKUP_CREATED\]/);

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
  { skip: skipWithoutDatabase, timeout: 120_000 },
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
  { skip: skipWithoutDatabase, timeout: 120_000 },
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
  { skip: skipWithoutDatabase, timeout: 120_000 },
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
  { skip: skipWithoutDatabase, timeout: 120_000 },
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
    { skip: skipWithoutDatabase, timeout: 120_000 },
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
  { skip: skipWithoutDatabase, timeout: 120_000 },
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
    { skip: skipWithoutDatabase, timeout: 120_000 },
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
  test(`WL-590: ${label} يُرفضُ بـ${code} قبلَ أيِّ اتصال`, async () => {
    const result = await runNode([RESTORE_SCRIPT, ...args], url);
    assert.equal(result.code, 1);
    assert.match(result.stderr, new RegExp(`\\[${code}\\]`));
  });
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
    { skip: skipWithoutDatabase, timeout: 120_000 },
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
  { skip: skipWithoutDatabase, timeout: 120_000 },
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
  { skip: skipWithoutDatabase, timeout: 180_000 },
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
    { skip: skipWithoutDatabase, timeout: 120_000 },
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
  { skip: skipWithoutDatabase, timeout: 120_000 },
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
    { skip: skipWithoutDatabase, timeout: 120_000 },
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
    { skip: skipWithoutDatabase, timeout: 120_000 },
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
  { skip: skipWithoutDatabase, timeout: 120_000 },
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
  { skip: skipWithoutDatabase, timeout: 120_000 },
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
  { skip: skipWithoutDatabase },
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
  { skip: skipWithoutDatabase },
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

test(
  'WL-591: النسخُ يُنادي `pg_dump` بـ`--no-owner` و`--no-privileges` و`--snapshot` والمخطّطَين',
  { skip: skipWithoutDatabase, timeout: 120_000 },
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
  { skip: skipWithoutDatabase, timeout: 120_000 },
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
    { skip: skipWithoutDatabase, timeout: 120_000 },
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
  { skip: skipWithoutDatabase, timeout: 120_000 },
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
  test(`WL-591: ${label} يُرفضُ بـ${code} قبلَ أيِّ اتصال`, async () => {
    const result = await runNode([BACKUP_SCRIPT, ...args], url);
    assert.equal(result.code, 1);
    assert.match(result.stderr, new RegExp(`\\[${code}\\]`));
  });
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
  { skip: skipWithoutDatabase, timeout: 120_000 },
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
    { skip: skipWithoutDatabase, timeout: 120_000 },
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
  { skip: skipWithoutDatabase, timeout: 120_000 },
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
    { skip: skipWithoutDatabase, timeout: 120_000 },
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
  { skip: skipWithoutDatabase, timeout: 120_000 },
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
    } finally {
      await race.close();
      await backup.source.drop();
    }
  },
);
