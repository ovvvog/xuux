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
 * مصدرٌ مُهاجَرٌ مُمهَّدٌ ونسخةٌ منه.
 * @param {string} label
 * @returns {Promise<{ source: Awaited<ReturnType<typeof createIsolatedDatabase>>, sourceUrl: string, dir: string, dump: string }>}
 */
async function seededBackup(label) {
  const source = await createIsolatedDatabase(`${label}src`);
  const dir = registerTmpRoot(fs.mkdtempSync(path.join(os.tmpdir(), `backup-${label}-`)));
  const dump = path.join(dir, 'state.dump');
  await up(source.pool);
  await seedEveryTable(source.pool);
  const sourceUrl = databaseUrlFor(source.name);
  const backup = await runNode([BACKUP_SCRIPT, 'create', dump], sourceUrl);
  assert.equal(backup.code, 0, backup.stderr);
  return { source, sourceUrl, dir, dump };
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
    const { source, sourceUrl, dir, dump } = await seededBackup('forceok');
    const busy = await createIsolatedDatabase('forceokdst');
    try {
      await up(busy.pool);
      await busy.pool.query(
        `INSERT INTO state.models (id, name, provider, purpose, fingerprint, status, model_version)
         VALUES ('stale-model', 'Stale', 'internal', 'operations', $1, 'registered', '0.0.1')`,
        ['f'.repeat(64)],
      );
      const expectedDigest = await contentsDigest(source.pool);
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

      // (٣) هدفٌ قائمٌ مشغولٌ مع --force ⇒ لا علامة (‏المحوُ ليس إنشاءً).
      await up(busy.pool);
      const forced = await runNode(
        [RESTORE_SCRIPT, dump, '--database', busy.name, '--force'],
        sourceUrl,
      );
      assert.equal(forced.code, 0, forced.stderr);
      const forcedLine = marker.exec(forced.stdout);
      assert.ok(forcedLine, forced.stdout);
      assert.equal(forcedLine[2], undefined, 'العلامةُ ظهرت مع --force على هدفٍ قائم');

      // (٤) الهدفُ الذي أُنشئَ في (١) قائمٌ الآن: استعادةٌ ثانيةٌ إليه بـ--force بلا علامة.
      const again = await runNode(
        [RESTORE_SCRIPT, dump, '--database', fresh, '--force'],
        sourceUrl,
      );
      assert.equal(again.code, 0, again.stderr);
      const againLine = marker.exec(again.stdout);
      assert.ok(againLine, again.stdout);
      assert.equal(againLine[2], undefined, 'العلامةُ ظهرت لهدفٍ أنشأته استعادةٌ سابقة');

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
