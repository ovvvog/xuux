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
import { up } from '../../src/persistence/migrator.mjs';
import { catalogSnapshot, createIsolatedDatabase, skipWithoutDatabase } from '../helpers/pg.mjs';

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
 * @returns {Promise<CommandResult>}
 */
function runNode(args, databaseUrl) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      env: {
        ...process.env,
        ...(databaseUrl === undefined ? {} : { DATABASE_URL: databaseUrl }),
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
    `INSERT INTO state.cases (id, law_id, subject, state)
     VALUES ($1, $2, $3, $4)`,
    ['case-001', 'law-001', 'agent-001', 'opened'],
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
    `INSERT INTO state.memories (id, agent_id, kind, content, tags, dataset_id, expires_at)
     VALUES ($1, $2, $3, $4::jsonb, $5, $6, now() + interval '30 days')`,
    [
      'memory-001',
      'agent-001',
      'episodic',
      JSON.stringify({ action: 'backup' }),
      ['backup'],
      'asset-001',
    ],
  );
}

test(
  'استعادة فعلية إلى قاعدة نظيفة تعيد المحتوى والكتالوج والنسخة وتطبع الزمن',
  { skip: skipWithoutDatabase },
  async () => {
    const source = await createIsolatedDatabase('backsrc');
    const target = await createIsolatedDatabase('backdst');
    const dump = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'backup-restore-')), 'state.dump');
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

      const backup = await runNode([BACKUP_SCRIPT, 'create', dump], sourceUrl);
      assert.equal(backup.code, 0, backup.stderr);
      assert.match(backup.stdout, /زمن النسخ المقاس: \d+ مللي ثانية/);
      const manifest = JSON.parse(fs.readFileSync(`${dump}.manifest.json`, 'utf8'));
      assert.deepEqual(manifest.rowCounts, expectedCounts);
      assert.equal(manifest.migrationVersion, migrationVersion);

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
    const dump = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'backup-busy-')), 'state.dump');
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
  const dump = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'backup-corrupt-')), 'state.dump');
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
