// ملكيّةُ هدفِ الاستعادةِ وترتيبُ التحقّق — `WL-627` (‏`LIVE-78`).
//
// عيوبٌ ثلاثةٌ أكّدها مراجعو `2026-11-28` بإعادةِ إنتاجٍ على شيفرةِ `fcb379ca`:
//  (‏أ) «أُنشئَ» كانَ يُحسَبُ بفحصٍ منفصلٍ قبلَ `CREATE DATABASE` ⇒ قاعدةٌ أنشأَها غيرُ هذه الاستعادةِ تُحذَفُ
//      عندَ فشلِها، ومنها قاعدةُ استعادةٍ متزامنةٍ أعلنت `[RESTORE_OK]`.
//  (‏ب) ‏`RESTORE_COMMIT_OUTCOME_UNKNOWN` على هدفٍ مُنشأٍ كانَ يحذفُه — وقد يكونُ ملتزَماً.
//  (‏ج) التحقّقُ كانَ يسبقُ تركيبَ الدفترِ (‏عبارةٌ كاتبة) والقوادحَ المؤجَّلة ⇒ `[CONTENT_VERIFIED]` على ما لم يُلتزَم.
// كلُّ اختبارٍ هنا أحمرُ على الشيفرةِ القديمة (‏مقيسٌ عندَ الإضافة؛ docs/roadmap/05-work-log.md ‏`WL-627`).
//
// التشغيل: DATABASE_URL=... node --test tests/persistence/restore-target-ownership.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import pg from 'pg';
import { createBackup } from '../../scripts/backup.mjs';
import { skipWithoutDatabase } from '../helpers/pg.mjs';
import { startFaultProxy } from '../helpers/pg-fault-proxy.mjs';
import {
  l78AdminUrl,
  l78BusyTarget,
  l78Source,
  l78TargetImage,
  l78Url,
} from '../helpers/live78-restore.mjs';

const CLI = new URL('../../scripts/restore.mjs', import.meta.url).pathname;
/** يطابقُ `TARGET_LOCK_CLASS` في `scripts/restore.mjs`. */
const LOCK_CLASS = 0x5875_7578;

/**
 * @param {string[]} args
 * @param {Record<string, string>} env
 */
function runCli(args, env) {
  const child = spawn(process.execPath, [CLI, ...args], {
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (c) => {
    stdout += c;
  });
  child.stderr.on('data', (c) => {
    stderr += c;
  });
  /** @type {Promise<{ code: number | null, stdout: string, stderr: string }>} */
  const done = new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
  return { child, done };
}

/** @param {string} label */
async function productionSource(label) {
  const fixture = await l78Source(label);
  const dump = path.join(fixture.dir, 'prod.dump');
  await createBackup(dump, l78Url(fixture.source.name));
  return { fixture, dump };
}

/** @param {(admin: pg.Client) => Promise<void>} body */
async function withAdmin(body) {
  const admin = new pg.Client({ connectionString: l78AdminUrl() });
  await admin.connect();
  try {
    await body(admin);
  } finally {
    await admin.end();
  }
}

/** @param {string} name */
async function databaseExists(name) {
  let exists = false;
  await withAdmin(async (admin) => {
    exists =
      ((await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [name])).rowCount ?? 0) >
      0;
  });
  return exists;
}

/** @param {string} name */
async function dropDatabase(name) {
  await withAdmin(async (admin) => {
    await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
  });
}

/** المستعادُ كاملاً على قاعدةٍ باسمِها. @param {string} name */
async function assertRestoredContent(name) {
  const pool = new pg.Pool({ connectionString: l78Url(name), max: 1 });
  try {
    const r = await pool.query(
      `SELECT count(*)::int AS n, count(*) FILTER (WHERE body = 'نصّ ' || substr(id, 5)::int)::int AS ok FROM state.laws`,
    );
    assert.deepEqual(r.rows[0], { n: 300, ok: 300 }, 'المحتوى المستعادُ ليس محتوى المصدر');
    const ledger = await pool.query(
      `SELECT to_regclass('public.schema_migrations') IS NOT NULL AS l`,
    );
    assert.equal(ledger.rows[0].l, true);
  } finally {
    await pool.end();
  }
}

/** مُغلِّفُ `pg_restore` يُمرِّرُ `--version` و`--list` ويفشلُ في الاستعادةِ بعدَ `seconds`. */
function failingRestoreTool(/** @type {string} */ dir, /** @type {number} */ seconds) {
  return import('../../scripts/lib/pg-tools.mjs').then(({ resolvePgTool }) => {
    const real = JSON.stringify(resolvePgTool('pg_restore'));
    const wrapper = path.join(dir, 'pg_restore_fail');
    fs.writeFileSync(
      wrapper,
      [
        '#!/bin/sh',
        `if [ "$1" = "--version" ] || [ "$1" = "--list" ]; then exec ${real} "$@"; fi`,
        `sleep ${Number(seconds)}`,
        'exit 1',
        '',
      ].join('\n'),
      { mode: 0o700 },
    );
    return wrapper;
  });
}

test(
  'WL-627 LIVE-78: نتيجةُ COMMIT مجهولةٌ على هدفٍ أنشأته الاستعادةُ والالتزامُ وقع ⇒ RESTORE_COMMIT_OUTCOME_UNKNOWN والقاعدةُ باقيةٌ بمحتواها المستعاد (‏لا تُحذَفُ على فشلٍ غيرِ مُثبَت)',
  { skip: skipWithoutDatabase, timeout: 120_000 },
  async () => {
    const { fixture, dump } = await productionSource('l78unk');
    const fresh = `l78unk_new_${process.pid}`;
    const proxy = await startFaultProxy({
      host: '127.0.0.1',
      port: Number(new URL(l78AdminUrl()).port || 5432),
    });
    try {
      let fired = false;
      void proxy
        .severOn('RENAME TO "schema_migrations"', {
          mode: 'after-commit',
          thenRefuseDatabase: fresh,
        })
        .then(() => {
          fired = true;
        });
      const url = new URL(proxy.urlFor(l78AdminUrl()));
      url.searchParams.set('sslmode', 'disable');
      const result = await runCli([dump, '--database', fresh], {
        DATABASE_URL: url.toString(),
      }).done;
      assert.ok(fired, 'القطعُ بعدَ COMMIT لم يقع');
      assert.equal(result.code, 1, result.stdout);
      assert.doesNotMatch(result.stdout, /RESTORE_OK/);
      assert.match(result.stderr, /⛔ \[RESTORE_COMMIT_OUTCOME_UNKNOWN\]/);
      // الالتزامُ وقعَ (‏الوسيطُ لا يُسقِطُ إلا ردَّ الخادمِ على COMMIT) — فالقاعدةُ ملتزَمةٌ ومستعادةٌ كاملة.
      assert.equal(await databaseExists(fresh), true, 'حُذِفَت قاعدةٌ ملتزَمةٌ على نتيجةٍ مجهولة');
      await assertRestoredContent(fresh);
    } finally {
      await proxy.close();
      await dropDatabase(fresh);
      await fixture.cleanup();
    }
  },
);

test(
  'WL-627 LIVE-78: استعادتان إلى اسمٍ غائبٍ نفسِه — إحداهما تفشلُ بعدَ أن تنجحَ الأخرى ⇒ لا تُحذَفُ قاعدةُ الناجحة، و[RESTORE_OK] يعني قاعدةً موجودةً بمحتواها',
  { skip: skipWithoutDatabase, timeout: 120_000 },
  async () => {
    const { fixture, dump } = await productionSource('l78race');
    const wrapper = await failingRestoreTool(fixture.dir, 3);
    try {
      for (let round = 0; round < 2; round += 1) {
        const name = `l78race_${process.pid}_${round}`;
        try {
          const failing = runCli([dump, '--database', name], {
            DATABASE_URL: l78AdminUrl(),
            PG_RESTORE: wrapper,
          });
          const ok = runCli([dump, '--database', name], { DATABASE_URL: l78AdminUrl() });
          const [f, s] = await Promise.all([failing.done, ok.done]);
          assert.equal(f.code, 1, f.stdout);
          // تسلسلتا: الفاشلةُ قبلُ ⇒ ‏`COMMAND_FAILED` (‏وحذفت ما أنشأته هي)، أو بعدُ ⇒ الهدفُ مُستعادٌ فليس نظيفاً.
          assert.match(f.stderr, /⛔ \[RESTORE_(COMMAND_FAILED|TARGET_NOT_CLEAN)\]/);
          // لا خطأَ خامٌ بلا اسم (‏23505/42P04 من CREATE DATABASE متزامن).
          assert.doesNotMatch(f.stderr + s.stderr, /23505|42P04|duplicate key|already exists/);
          assert.equal(s.code, 0, s.stderr);
          assert.match(s.stdout, /\[RESTORE_OK\]/);
          assert.equal(
            await databaseExists(name),
            true,
            'حُذِفَت قاعدةُ استعادةٍ أعلنت [RESTORE_OK]',
          );
          await assertRestoredContent(name);
        } finally {
          await dropDatabase(name);
        }
      }
    } finally {
      await fixture.cleanup();
    }
  },
);

test(
  'WL-627 LIVE-78: الاسمُ محجوزٌ بقفلِ الاستعادة ⇒ الاستعادةُ تنتظرُه؛ قاعدةٌ أنشأها غيرُها في الأثناءِ لا تُعَدُّ «مُنشأةً» فلا تُحذَف؛ وانتظارٌ فوقَ الحدِّ ⇒ RESTORE_TARGET_BUSY بلا لمس',
  { skip: skipWithoutDatabase, timeout: 120_000 },
  async () => {
    const { fixture, dump } = await productionSource('l78lock');
    const wrapper = await failingRestoreTool(fixture.dir, 0);
    const name = `l78lock_${process.pid}`;
    // القفلُ الاستشاريُّ لكلِّ قاعدةٍ على حدة: الاستعادةُ تحجزُ في قاعدةِ الإدارة `postgres`.
    const holder = new pg.Client({ connectionString: l78Url('postgres') });
    await holder.connect();
    /** @type {{ name: string, pool: pg.Pool } | undefined} */
    let precious;
    try {
      await holder.query('SELECT pg_advisory_lock($1, hashtext($2))', [LOCK_CLASS, name]);
      const run = runCli([dump, '--database', name], {
        DATABASE_URL: l78AdminUrl(),
        PG_RESTORE: wrapper,
      });
      // رصدُ حالٍ لا مهلة: الاستعادةُ واقفةٌ على القفلِ الاستشاريّ.
      let waiting = false;
      for (const deadline = Date.now() + 30_000; Date.now() < deadline;) {
        const r = await holder.query(
          `SELECT 1 FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND wait_event = 'advisory' AND pid <> pg_backend_pid()`,
        );
        if ((r.rowCount ?? 0) > 0) {
          waiting = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      if (!waiting) {
        run.child.kill('SIGKILL');
        const early = await run.done;
        assert.fail(`الاستعادةُ لم تنتظرْ قفلَ الهدف: ${early.stdout} ${early.stderr}`);
      }
      // طرفٌ آخرُ يُنشئُ الاسمَ ببياناتٍ ثمينةٍ وهي تنتظر.
      await holder.query(`CREATE DATABASE "${name}"`);
      precious = { name, pool: new pg.Pool({ connectionString: l78Url(name), max: 1 }) };
      await precious.pool.query('CREATE TABLE public.precious (v text)');
      await precious.pool.query(`INSERT INTO public.precious VALUES ('ثمين')`);
      await holder.query('SELECT pg_advisory_unlock($1, hashtext($2))', [LOCK_CLASS, name]);
      const result = await run.done;
      assert.equal(result.code, 1, result.stdout);
      assert.doesNotMatch(result.stdout, /RESTORE_OK/);
      assert.equal(await databaseExists(name), true, 'حُذِفَت قاعدةُ طرفٍ آخر');
      const kept = await precious.pool.query('SELECT v FROM public.precious');
      assert.deepEqual(kept.rows, [{ v: 'ثمين' }]);

      // الحدّ: القفلُ ممسوكٌ فوقَ `RESTORE_TARGET_LOCK_TIMEOUT_MS` ⇒ ‏`RESTORE_TARGET_BUSY` والهدفُ لم يُلمَس.
      await holder.query('SELECT pg_advisory_lock($1, hashtext($2))', [LOCK_CLASS, name]);
      const before = await l78TargetImage(precious.pool);
      const busy = await runCli([dump, '--database', name, '--force'], {
        DATABASE_URL: l78AdminUrl(),
        RESTORE_TARGET_LOCK_TIMEOUT_MS: '300',
      }).done;
      assert.equal(busy.code, 1, busy.stdout);
      assert.match(busy.stderr, /⛔ \[RESTORE_TARGET_BUSY\]/);
      assert.equal(await l78TargetImage(precious.pool), before, 'الهدفُ لُمِسَ والقفلُ ممسوك');
    } finally {
      await holder.end();
      await precious?.pool.end();
      await dropDatabase(name);
      await fixture.cleanup();
    }
  },
);

/**
 * عبثٌ **بعدَ** موضعِ التحقّقِ القديم: (‏`alter`) قادحُ أحداثٍ على `ALTER TABLE` في `public` (‏تركيبُ الدفتر)
 * يُبدِّلُ نصّاً؛ (‏`deferred`) قادحُ قيدٍ مؤجَّلٌ يُلحَقُ بـ`state.laws` حالَ إنشائها يُبدِّلُ عندَ `COMMIT`.
 * @param {import('pg').Pool} pool
 * @param {'alter' | 'deferred'} kind
 */
async function installLateTamper(pool, kind) {
  if (kind === 'alter') {
    await pool.query(`CREATE FUNCTION public.l78_late() RETURNS event_trigger LANGUAGE plpgsql AS $f$
      BEGIN
        IF EXISTS (SELECT 1 FROM pg_event_trigger_ddl_commands() WHERE schema_name = 'public')
           AND to_regclass('state.laws') IS NOT NULL THEN
          UPDATE state.laws SET body = 'مُبدَّلٌ بعدَ البصمة' WHERE id = 'law-000001';
        END IF;
      END $f$`);
    await pool.query(`CREATE EVENT TRIGGER l78_late ON ddl_command_end
      WHEN TAG IN ('ALTER TABLE') EXECUTE FUNCTION public.l78_late()`);
    return;
  }
  // الحدثُ يُصفُّ في `public.l78_late_q` (‏خارجَ `state`، ينجو من المحو) عندَ تركيبِ الدفتر، وقادحُ القيدِ المؤجَّلُ
  // عليه يُبدِّلُ المحتوى حينَ تُطلَقُ القيودُ المؤجَّلة — كانَ ذلكَ عندَ `COMMIT` بعدَ البصمة.
  await pool.query('CREATE TABLE public.l78_late_q (n integer)');
  await pool.query(`CREATE FUNCTION public.l78_late_row() RETURNS trigger LANGUAGE plpgsql AS $f$
    BEGIN
      UPDATE state.laws SET body = 'مُبدَّلٌ عندَ COMMIT' WHERE id = 'law-000001';
      RETURN NULL;
    END $f$`);
  await pool.query(`CREATE CONSTRAINT TRIGGER l78_late_row AFTER INSERT ON public.l78_late_q
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.l78_late_row()`);
  await pool.query(`CREATE FUNCTION public.l78_late() RETURNS event_trigger LANGUAGE plpgsql AS $f$
    BEGIN
      IF EXISTS (SELECT 1 FROM pg_event_trigger_ddl_commands() WHERE schema_name = 'public')
         AND to_regclass('state.laws') IS NOT NULL THEN
        INSERT INTO public.l78_late_q VALUES (1);
      END IF;
    END $f$`);
  await pool.query(`CREATE EVENT TRIGGER l78_late ON ddl_command_end
    WHEN TAG IN ('ALTER TABLE') EXECUTE FUNCTION public.l78_late()`);
}

for (const kind of /** @type {const} */ (['alter', 'deferred'])) {
  test(
    `WL-627 LIVE-78: عبثٌ بعدَ موضعِ التحقّقِ القديم (${kind === 'alter' ? 'قادحُ أحداثٍ على تركيبِ الدفتر' : 'قادحُ قيدٍ مؤجَّلٌ إلى COMMIT'}) ⇒ RESTORE_CONTENT_MISMATCH لا [CONTENT_VERIFIED]، والهدفُ كما كان`,
    { skip: skipWithoutDatabase, timeout: 120_000 },
    async () => {
      const { fixture, dump } = await productionSource(`l78late${kind[0]}`);
      const target = await l78BusyTarget(`l78late${kind[0]}t`);
      try {
        await installLateTamper(target.pool, kind);
        const before = await l78TargetImage(target.pool);
        const result = await runCli([dump, '--database', target.name, '--force'], {
          DATABASE_URL: l78AdminUrl(),
        }).done;
        assert.equal(result.code, 1, result.stdout);
        assert.doesNotMatch(result.stdout, /RESTORE_OK|CONTENT_VERIFIED/);
        assert.match(result.stderr, /⛔ \[RESTORE_CONTENT_MISMATCH\].*table laws: sha256/s);
        assert.equal(await l78TargetImage(target.pool), before, 'الهدفُ تغيّرَ بعدَ تحقّقٍ فاشل');
      } finally {
        await target.pool.query('DROP EVENT TRIGGER IF EXISTS l78_late').catch(() => undefined);
        await target.drop();
        await fixture.cleanup();
      }
    },
  );
}
