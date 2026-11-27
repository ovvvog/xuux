// ذرّيّةُ `restore --force` في معاملةٍ واحدة — `WL-624` (‏`LIVE-78`).
//
// مَنقولٌ حرفيّاً من `tests/persistence/atomicity.test.mjs` في `WL-625`: الملفُّ الأصليُّ بلغَ مهلةَ الملفِّ
// (‏120 ث في `test:suite`) على `push` التكاملِ [46060140725] بلا اختبارٍ راسب. لا اختبارَ حُذِفَ أو غُيِّرَ
// ولا مهلةَ رُفِعَت؛ الاختباراتُ التسعةُ هنا بأسمائها وأجسامِها.
//
// التشغيل: DATABASE_URL=... node --test tests/persistence/restore-atomicity.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import pg from 'pg';
import { createBackup } from '../../scripts/backup.mjs';
import { skipWithoutDatabase } from '../helpers/pg.mjs';
import { startFaultProxy } from '../helpers/pg-fault-proxy.mjs';
import { registerTmpRoot } from '../helpers/tmp-roots.mjs';
import {
  l78AdminUrl,
  l78BusyTarget,
  l78DropInjected,
  l78InstallContentTamper,
  l78Source,
  l78TargetImage,
  l78Url,
} from '../helpers/live78-restore.mjs';

const L78_RESTORE_CLI = new URL('../../scripts/restore.mjs', import.meta.url).pathname;

/**
 * يُشغِّلُ `restore.mjs` عمليّةً مستقلّة (‏الأداةُ كما يُشغِّلُها المشغّل).
 * @param {string[]} args
 * @param {Record<string, string>} env
 */
function l78RunCli(args, env) {
  const child = spawn(process.execPath, [L78_RESTORE_CLI, ...args], {
    env: { ...process.env, ...env },
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
  /** @type {Promise<{ code: number | null, signal: NodeJS.Signals | null, stdout: string, stderr: string }>} */
  const done = new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', (code, signal) => resolve({ code, signal, stdout, stderr }));
  });
  return { child, done };
}

/**
 * ينتظرُ جلسةَ الاستعادةِ (‏`application_name = xuux-restore`) على الهدفِ بشرطِ `where`؛ رصدُ حالٍ لا مهلة.
 * @param {string} database
 * @param {string} where
 * @returns {Promise<number | null>} رقمُ الخلفيّة أو `null` عندَ انقضاءِ الحدّ.
 */
async function l78WaitForRestoreBackend(database, where) {
  const admin = new pg.Client({ connectionString: l78AdminUrl() });
  await admin.connect();
  try {
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
      const r = await admin.query(
        `SELECT pid FROM pg_stat_activity
          WHERE datname = $1 AND application_name = 'xuux-restore' AND ${where}`,
        [database],
      );
      if ((r.rowCount ?? 0) > 0) return Number(r.rows[0].pid);
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    return null;
  } finally {
    await admin.end();
  }
}

/**
 * ينتظرُ ألّا تبقى على الهدفِ جلسةُ استعادة (‏أُجهِضت معاملتُها وخرجت).
 * @param {string} database
 * @returns {Promise<boolean>}
 */
async function l78WaitForNoRestoreBackend(database) {
  const admin = new pg.Client({ connectionString: l78AdminUrl() });
  await admin.connect();
  try {
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
      const r = await admin.query(
        `SELECT 1 FROM pg_stat_activity WHERE datname = $1 AND application_name = 'xuux-restore'`,
        [database],
      );
      if ((r.rowCount ?? 0) === 0) return true;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return false;
  } finally {
    await admin.end();
  }
}

/**
 * قادحُ أحداثٍ خارجَ `state` يُوقِفُ أوّلَ `CREATE INDEX` من خرجِ `pg_restore` ‏`seconds` ثانيةً (‏مرّةً في
 * المعاملة) — فتقفُ الاستعادةُ في منتصفِها بعدَ المحوِ وبعدَ إنشاءِ الجداولِ وتعبئتِها، حتميّاً بلا `sleep` في الاختبار.
 * @param {import('pg').Pool} pool
 * @param {number} seconds
 */
async function l78InstallMidRestorePause(pool, seconds) {
  await pool.query(`CREATE FUNCTION public.l78_pause_once() RETURNS event_trigger LANGUAGE plpgsql AS $f$
    BEGIN
      IF pg_catalog.current_setting('xuux.l78_paused', true) IS DISTINCT FROM '1' THEN
        PERFORM pg_catalog.set_config('xuux.l78_paused', '1', true);
        PERFORM pg_catalog.pg_sleep(${Number(seconds)});
      END IF;
    END $f$`);
  await pool.query(`CREATE EVENT TRIGGER l78_pause_once ON ddl_command_end
    WHEN TAG IN ('CREATE INDEX') EXECUTE FUNCTION public.l78_pause_once()`);
}

/**
 * مصدرٌ بنسخةٍ **إنتاجيّةٍ** (‏`createBackup`، بصمةُ محتوى `WL-606`) وهدفٌ مشغولٌ بصفٍّ قديم.
 * @param {string} label
 */
async function l78ProductionFixture(label) {
  const fixture = await l78Source(label);
  const dump = path.join(fixture.dir, 'prod.dump');
  await createBackup(dump, l78Url(fixture.source.name));
  const target = await l78BusyTarget(`${label}t`);
  return {
    fixture,
    dump,
    target,
    cleanup: async () => {
      await l78DropInjected(target.pool).catch(() => undefined);
      await target.pool.query('DROP EVENT TRIGGER IF EXISTS l78_pause_once').catch(() => undefined);
      await target.pool.query('DROP EVENT TRIGGER IF EXISTS l78_gate_arm').catch(() => undefined);
      await target.drop();
      await fixture.cleanup();
    },
  };
}

/**
 * الصفُّ القديمُ مقروءٌ من الهدفِ بعدَ الإخفاق (‏البياناتُ القديمةُ صالحةٌ للاستعمال لا مجرّدُ «صورةٍ» متطابقة).
 * @param {import('pg').Pool} pool
 */
async function l78AssertStaleUsable(pool) {
  const r = await pool.query(`SELECT body FROM state.laws WHERE id = 'law-stale1'`);
  assert.deepEqual(r.rows, [{ body: 'صفٌّ قبلَ الاستعادة' }], 'الصفُّ القديمُ لم يعدْ مقروءاً');
  const ledger = await pool.query('SELECT max(version)::int AS v FROM public.schema_migrations');
  assert.equal(ledger.rows[0].v, 23, 'دفترُ الهدفِ القديمُ تغيّر');
}

/**
 * الاستعادةُ اكتملت فعلاً: محتوى المصدرِ كاملاً، ولا صفَّ قديم، والدفترُ مُركَّب.
 * @param {import('pg').Pool} pool
 */
async function l78AssertRestored(pool) {
  const r = await pool.query(
    `SELECT count(*)::int AS n, count(*) FILTER (WHERE id = 'law-stale1')::int AS stale FROM state.laws`,
  );
  assert.deepEqual(r.rows[0], { n: 300, stale: 0 });
  const ledger = await pool.query(
    `SELECT to_regclass('public.schema_migrations') IS NOT NULL AS l`,
  );
  assert.equal(ledger.rows[0].l, true);
}

test(
  'WL-624 LIVE-78: قتلُ عمليّةِ restore.mjs بـSIGKILL في منتصفِ pg_restore ⇒ لا COMMIT؛ الهدفُ كما كانَ مقروءاً، ولا [RESTORE_OK]، وإعادةُ المحاولةِ تنجح',
  { skip: skipWithoutDatabase, timeout: 180_000 },
  async () => {
    const env = await l78ProductionFixture('l78kill');
    // ‏SIGKILL لا يُشغِّلُ تنظيفاً: النسخةُ الخاصّةُ للأرشيف (‏`xuux-restore-*`، `snapshotVerifiedArchive`)
    // تبقى. تُوجَّهُ إلى جذرٍ يملكُه الاختبارُ (‏`TMPDIR`) فيُقاسُ بقاؤُها حدّاً مُعلَناً ويُمحى الجذر.
    const killTmp = registerTmpRoot(fs.mkdtempSync(path.join(os.tmpdir(), 'xuux-l78kill-')));
    try {
      await l78InstallMidRestorePause(env.target.pool, 3);
      const before = await l78TargetImage(env.target.pool);
      const live = l78RunCli([env.dump, '--database', env.target.name, '--force'], {
        DATABASE_URL: l78AdminUrl(),
        TMPDIR: killTmp,
      });
      const pid = await l78WaitForRestoreBackend(env.target.name, `wait_event = 'PgSleep'`);
      assert.notEqual(pid, null, 'الاستعادةُ لم تبلغ منتصفَها (‏CREATE INDEX)');
      // في هذه اللحظة: المحوُ وقعَ والجداولُ أُنشئت وعُبِّئت داخلَ المعاملة — لم يُلتزَم منها شيء.
      live.child.kill('SIGKILL');
      const killed = await live.done;
      assert.equal(killed.signal, 'SIGKILL');
      assert.doesNotMatch(killed.stdout, /RESTORE_OK/);
      // حدٌّ مُعلَنٌ منذُ `WL-614` (‏`docs/RECOVERY.md`، الحدُّ 3): القتلُ يتركُ النسخةَ الخاصّةَ للأرشيفِ في `TMPDIR` (‏0700) — بلا أثرٍ على الهدف.
      assert.deepEqual(
        fs.readdirSync(killTmp).filter((name) => name.startsWith('xuux-restore-')).length,
        1,
        'النسخةُ الخاصّةُ للأرشيفِ بعدَ SIGKILL',
      );
      // الأداةُ ماتت ولم ترسلْ COMMIT ⇒ ‏psql يبلغُ نهايةَ مدخلِه فيخرج ⇒ يُجهِضُ الخادمُ المعاملة.
      const gone = await l78WaitForNoRestoreBackend(env.target.name);
      assert.ok(gone, 'بقيت جلسةُ الاستعادةِ حيّةً بعدَ موتِ الأداة');
      assert.equal(await l78TargetImage(env.target.pool), before, 'الهدفُ تغيّرَ بعدَ قتلِ الأداة');
      await l78AssertStaleUsable(env.target.pool);
      // إعادةُ المحاولة: الأمرُ نفسُه بلا العطبِ ينجحُ كاملاً — لا أثرَ متبقٍّ من المحاولةِ المقتولةِ يعيقُها.
      await env.target.pool.query('DROP EVENT TRIGGER l78_pause_once');
      const retry = await l78RunCli([env.dump, '--database', env.target.name, '--force'], {
        DATABASE_URL: l78AdminUrl(),
      }).done;
      assert.equal(retry.code, 0, retry.stderr);
      assert.match(retry.stdout, /\[RESTORE_OK\]/);
      await l78AssertRestored(env.target.pool);
    } finally {
      await env.cleanup();
      fs.rmSync(killTmp, { recursive: true, force: true });
    }
  },
);

test(
  'WL-624 LIVE-78: إنهاءُ جلسةِ الاستعادةِ من الخادم (‏pg_terminate_backend) في منتصفِ pg_restore ⇒ RESTORE_COMMAND_FAILED، والهدفُ كما كانَ مقروءاً',
  { skip: skipWithoutDatabase, timeout: 180_000 },
  async () => {
    const env = await l78ProductionFixture('l78term');
    try {
      await l78InstallMidRestorePause(env.target.pool, 30);
      const before = await l78TargetImage(env.target.pool);
      const run = l78RunCli([env.dump, '--database', env.target.name, '--force'], {
        DATABASE_URL: l78AdminUrl(),
      });
      const pid = await l78WaitForRestoreBackend(env.target.name, `wait_event = 'PgSleep'`);
      assert.notEqual(pid, null, 'الاستعادةُ لم تبلغ منتصفَها');
      const admin = new pg.Client({ connectionString: l78AdminUrl() });
      await admin.connect();
      try {
        await admin.query('SELECT pg_terminate_backend($1)', [pid]);
      } finally {
        await admin.end();
      }
      const result = await run.done;
      assert.equal(result.code, 1, result.stdout);
      assert.doesNotMatch(result.stdout, /RESTORE_OK/);
      assert.match(result.stderr, /⛔ \[RESTORE_COMMAND_FAILED\]/);
      assert.match(result.stderr, /لا COMMIT: الهدفُ كما كان/);
      assert.equal(
        await l78TargetImage(env.target.pool),
        before,
        'الهدفُ تغيّرَ بعدَ إنهاءِ الجلسة',
      );
      await l78AssertStaleUsable(env.target.pool);
    } finally {
      await env.cleanup();
    }
  },
);

/**
 * مُغلِّفُ `pg_restore` يُمرِّرُ `--version` و`--list` إلى الأداةِ الحقيقيّة، ويُخرِجُ من الاستعادةِ **نصفَ** نصِّها
 * ثمّ يخرجُ برمز 1 — موتُ `pg_restore` في منتصفِ الضخّ بعدَ أن نُفِّذَت عباراتٌ منه. والنصفُ يُحفَظُ دليلاً.
 * و`listExtra` سطرٌ يُلحَقُ بخرجِ `--list` (‏فهرسٌ مُزوَّر)، و`listFake` عددُ مدخلاتِ تعليقٍ مزوّرةٍ تُلحَقُ به.
 * @param {string} dir
 * @param {{ listExtra?: string, listFake?: number }} [options]
 */
async function l78RestoreWrapper(dir, options = {}) {
  const { resolvePgTool } = await import('../../scripts/lib/pg-tools.mjs');
  const real = JSON.stringify(resolvePgTool('pg_restore'));
  const wrapper = path.join(dir, 'pg_restore');
  const full = JSON.stringify(path.join(dir, 'full.sql'));
  const half = path.join(dir, 'half.sql');
  const fake =
    options.listFake === undefined
      ? ''
      : `i=0; while [ $i -lt ${options.listFake} ]; do echo "$((90000 + i)); 0 0 COMMENT - fake $i state"; i=$((i + 1)); done; `;
  const lines = [
    '#!/bin/sh',
    'if [ "$1" = "--version" ]; then exec ' + real + ' "$@"; fi',
    options.listFake !== undefined
      ? `if [ "$1" = "--list" ]; then ${real} "$@" || exit $?; ${fake}exit 0; fi`
      : options.listExtra === undefined
        ? 'if [ "$1" = "--list" ]; then exec ' + real + ' "$@"; fi'
        : `if [ "$1" = "--list" ]; then ${real} "$@" || exit $?; echo ${JSON.stringify(options.listExtra)}; exit 0; fi`,
    `${real} "$@" > ${full} || exit 9`,
    `size=$(wc -c < ${full})`,
    `head -c $((size / 2)) ${full} | tee ${JSON.stringify(half)}`,
    'exit 1',
    '',
  ];
  fs.writeFileSync(wrapper, lines.join('\n'), { mode: 0o700 });
  return { wrapper, half };
}

test(
  'WL-624 LIVE-78: موتُ pg_restore بعدَ ضخِّ نصفِ الاستعادة ⇒ لا COMMIT؛ الهدفُ القائمُ كما كانَ مقروءاً، والهدفُ الذي أنشأته الاستعادةُ يُحذَف',
  { skip: skipWithoutDatabase, timeout: 180_000 },
  async () => {
    const env = await l78ProductionFixture('l78half');
    const fresh = `l78half_new_${process.pid}`;
    try {
      const { wrapper, half } = await l78RestoreWrapper(env.fixture.dir);
      const before = await l78TargetImage(env.target.pool);
      const result = await l78RunCli([env.dump, '--database', env.target.name, '--force'], {
        DATABASE_URL: l78AdminUrl(),
        PG_RESTORE: wrapper,
      }).done;
      // النصفُ المضخوخُ فيه محوٌ وإنشاءٌ حقيقيّان — فالاختبارُ يقيسُ تراجعَ ما نُفِّذ، لا استعادةً لم تبدأ.
      const pumped = fs.readFileSync(half, 'utf8');
      assert.match(pumped, /CREATE TABLE state\./);
      assert.equal(result.code, 1, result.stdout);
      assert.doesNotMatch(result.stdout, /RESTORE_OK/);
      assert.match(result.stderr, /⛔ \[RESTORE_COMMAND_FAILED\]/);
      assert.equal(
        await l78TargetImage(env.target.pool),
        before,
        'الهدفُ تغيّرَ بعدَ موتِ pg_restore',
      );
      await l78AssertStaleUsable(env.target.pool);

      // هدفٌ غيرُ موجود: تُنشئُه الاستعادة ثمّ تفشل ⇒ يُحذَف (‏«كما كان» = غائب).
      const created = await l78RunCli([env.dump, '--database', fresh], {
        DATABASE_URL: l78AdminUrl(),
        PG_RESTORE: wrapper,
      }).done;
      assert.equal(created.code, 1, created.stdout);
      assert.doesNotMatch(created.stdout, /RESTORE_OK/);
      const admin = new pg.Client({ connectionString: l78AdminUrl() });
      await admin.connect();
      try {
        const exists = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [fresh]);
        assert.equal(exists.rowCount, 0, 'بقيت قاعدةُ الهدفِ التي أنشأتها استعادةٌ فاشلة');
      } finally {
        await admin.query(`DROP DATABASE IF EXISTS "${fresh}"`).catch(() => undefined);
        await admin.end();
      }
      // ضابط: الأمرُ نفسُه بالأداةِ الحقيقيّةِ ينجح.
      const control = await l78RunCli([env.dump, '--database', env.target.name, '--force'], {
        DATABASE_URL: l78AdminUrl(),
      }).done;
      assert.equal(control.code, 0, control.stderr);
      await l78AssertRestored(env.target.pool);
    } finally {
      await env.cleanup();
    }
  },
);

test(
  'WL-624 LIVE-78: إخفاقُ التحقّقِ (‏بصمةُ المحتوى) قبلَ الانتقال على هدفٍ مشغول بـ--force ⇒ RESTORE_CONTENT_MISMATCH، والقديمُ كما كانَ مقروءاً',
  { skip: skipWithoutDatabase, timeout: 180_000 },
  async () => {
    const env = await l78ProductionFixture('l78vfail');
    try {
      await l78InstallContentTamper(env.target.pool);
      const before = await l78TargetImage(env.target.pool);
      const result = await l78RunCli([env.dump, '--database', env.target.name, '--force'], {
        DATABASE_URL: l78AdminUrl(),
      }).done;
      assert.equal(result.code, 1, result.stdout);
      assert.doesNotMatch(result.stdout, /RESTORE_OK|CONTENT_VERIFIED/);
      assert.match(result.stderr, /⛔ \[RESTORE_CONTENT_MISMATCH\].*table laws: sha256/s);
      assert.equal(await l78TargetImage(env.target.pool), before, 'الهدفُ تغيّرَ بعدَ تحقّقٍ فاشل');
      await l78AssertStaleUsable(env.target.pool);
    } finally {
      await env.cleanup();
    }
  },
);

/**
 * بوّابةٌ تُسقِطُ `COMMIT` نفسَه: قيدٌ مؤجَّلٌ (‏`INITIALLY DEFERRED`) على جدولٍ في `public` يُعبِّئُه قادحُ أحداثٍ
 * عندَ أيِّ `ALTER TABLE` — فكلُّ العباراتِ تنجح، والتحقّقُ ينجح، ولا يسقطُ إلا الالتزام.
 * @param {import('pg').Pool} pool
 */
async function l78InstallCommitGate(pool) {
  await pool.query('CREATE TABLE public.l78_gate (n integer)');
  await pool.query(`CREATE FUNCTION public.l78_gate_fail() RETURNS trigger LANGUAGE plpgsql AS $f$
    BEGIN RAISE EXCEPTION 'L78_INJECTED_COMMIT_FAILURE'; END $f$`);
  await pool.query(`CREATE CONSTRAINT TRIGGER l78_gate_fail AFTER INSERT ON public.l78_gate
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.l78_gate_fail()`);
  await pool.query(`CREATE FUNCTION public.l78_gate_arm() RETURNS event_trigger LANGUAGE plpgsql AS $f$
    BEGIN INSERT INTO public.l78_gate VALUES (1); END $f$`);
  await pool.query(`CREATE EVENT TRIGGER l78_gate_arm ON ddl_command_end
    WHEN TAG IN ('ALTER TABLE') EXECUTE FUNCTION public.l78_gate_arm()`);
}

test(
  'WL-624 LIVE-78: إخفاقُ الانتقالِ نفسِه (‏COMMIT يُرفَض بقيدٍ مؤجَّل) ⇒ RESTORE_COMMIT_FAILED لا [RESTORE_OK]، والهدفُ كما كانَ مقروءاً',
  { skip: skipWithoutDatabase, timeout: 180_000 },
  async () => {
    const env = await l78ProductionFixture('l78cfail');
    try {
      await l78InstallCommitGate(env.target.pool);
      const before = await l78TargetImage(env.target.pool);
      const result = await l78RunCli([env.dump, '--database', env.target.name, '--force'], {
        DATABASE_URL: l78AdminUrl(),
      }).done;
      assert.equal(result.code, 1, result.stdout);
      // التحقّقُ نجحَ قبلَ COMMIT، لكنّ النجاحَ لا يُعلَنُ إلا بعدَ الانتقال.
      assert.doesNotMatch(result.stdout, /RESTORE_OK|CONTENT_VERIFIED/);
      assert.match(result.stderr, /⛔ \[RESTORE_COMMIT_FAILED\].*L78_INJECTED_COMMIT_FAILURE/s);
      assert.equal(
        await l78TargetImage(env.target.pool),
        before,
        'الهدفُ تغيّرَ بعدَ COMMIT مرفوض',
      );
      await l78AssertStaleUsable(env.target.pool);
      const gate = await env.target.pool.query('SELECT count(*)::int AS n FROM public.l78_gate');
      assert.equal(gate.rows[0].n, 0, 'أثرٌ من المعاملةِ المُجهَضةِ باقٍ');
      // ضابط: البوّابةُ منزوعةً ⇒ الأمرُ نفسُه ينجح.
      await env.target.pool.query('DROP EVENT TRIGGER l78_gate_arm');
      const control = await l78RunCli([env.dump, '--database', env.target.name, '--force'], {
        DATABASE_URL: l78AdminUrl(),
      }).done;
      assert.equal(control.code, 0, control.stderr);
      assert.match(control.stdout, /\[RESTORE_OK\]/);
      await l78AssertRestored(env.target.pool);
    } finally {
      await env.cleanup();
    }
  },
);

/** رابطُ الإدارةِ عبرَ الوسيط، بلا TLS كي يرى الوسيطُ نصَّ البروتوكول. */
function l78ProxiedAdminUrl(/** @type {{ urlFor: (u: string) => string }} */ proxy) {
  const url = new URL(proxy.urlFor(l78AdminUrl()));
  url.searchParams.set('sslmode', 'disable');
  return url.toString();
}

test(
  'WL-624 LIVE-78: انقطاعُ الاتصالِ حولَ COMMIT — بعدَ الالتزامِ ⇒ يُحسَمُ من الخادمِ نجاحاً؛ قبلَ وصولِه ⇒ RESTORE_COMMIT_FAILED والهدفُ كما كان؛ وبلا خادمٍ يُسأل ⇒ RESTORE_COMMIT_OUTCOME_UNKNOWN والحالُ أحدُ الطرفين لا بينَهما',
  { skip: skipWithoutDatabase, timeout: 240_000 },
  async () => {
    const env = await l78ProductionFixture('l78commit');
    const proxy = await startFaultProxy({
      host: '127.0.0.1',
      port: Number(new URL(l78AdminUrl()).port || 5432),
    });
    const args = [env.dump, '--database', env.target.name, '--force'];
    /** @type {Awaited<ReturnType<typeof l78BusyTarget>> | undefined} */
    let second;
    try {
      const before = await l78TargetImage(env.target.pool);
      // (‏أ) ‏COMMIT لا يصلُ الخادم: يُقطَعُ الاتصالُ قبلَ تمريرِه ⇒ الخادمُ يُجهِض ⇒ الحسمُ `aborted`.
      const fired = { before: false, acked: false, unknown: false };
      void proxy.severOn('COMMIT;\0', { mode: 'before' }).then(() => {
        fired.before = true;
      });
      const lost = await l78RunCli(args, { DATABASE_URL: l78ProxiedAdminUrl(proxy) }).done;
      assert.ok(fired.before, 'القطعُ قبلَ COMMIT لم يقع');
      assert.equal(lost.code, 1, lost.stdout);
      assert.doesNotMatch(lost.stdout, /RESTORE_OK/);
      assert.match(lost.stderr, /⛔ \[RESTORE_COMMIT_FAILED\]/);
      assert.equal(await l78TargetImage(env.target.pool), before, 'الهدفُ تغيّرَ وCOMMIT لم يصل');
      await l78AssertStaleUsable(env.target.pool);

      // (‏ب) ‏COMMIT يُلتزَمُ ويضيعُ ردُّه، والخادمُ متاحٌ للسؤال ⇒ ‏`pg_xact_status` = committed ⇒ نجاحٌ حقيقيّ.
      void proxy.severOn('RENAME TO "schema_migrations"', { mode: 'after-commit' }).then(() => {
        fired.acked = true;
      });
      const acked = await l78RunCli(args, { DATABASE_URL: l78ProxiedAdminUrl(proxy) }).done;
      assert.ok(fired.acked, 'القطعُ بعدَ COMMIT لم يقع');
      assert.equal(acked.code, 0, acked.stderr);
      assert.match(acked.stdout, /\[RESTORE_OK\]/);
      await l78AssertRestored(env.target.pool);

      // (‏ج) الشيءُ نفسُه والوسيطُ يُغلَقُ بعدَه فلا يُسأَلُ الخادم ⇒ نتيجةٌ مجهولةٌ مُعلَنة لا نجاحٌ مُدّعى.
      // هدفٌ مشغولٌ ثانٍ: الأوّلُ صارَ مُسيَّجاً بالاستعادةِ الناجحة، و`--force` يرفضُ المُسيَّج (‏`WL-597`).
      second = await l78BusyTarget('l78commit2t');
      void proxy
        .severOn('RENAME TO "schema_migrations"', { mode: 'after-commit', thenDown: true })
        .then(() => {
          fired.unknown = true;
        });
      const unknown = await l78RunCli([env.dump, '--database', second.name, '--force'], {
        DATABASE_URL: l78ProxiedAdminUrl(proxy),
      }).done;
      assert.ok(fired.unknown, 'القطعُ الثاني لم يقع');
      assert.equal(unknown.code, 1, unknown.stdout);
      assert.doesNotMatch(unknown.stdout, /RESTORE_OK/);
      assert.match(unknown.stderr, /⛔ \[RESTORE_COMMIT_OUTCOME_UNKNOWN\]/);
      // والحالُ الفعليُّ أحدُ الطرفين بالضبط — هنا الالتزامُ وقع: المستعادُ كاملاً، لا خليط.
      await l78AssertRestored(second.pool);
    } finally {
      await proxy.close();
      await second?.drop();
      await env.cleanup();
    }
  },
);

test(
  'WL-624 LIVE-78: انقطاعُ الاتصالِ في منتصفِ pg_restore ⇒ RESTORE_COMMAND_FAILED، والهدفُ كما كانَ مقروءاً',
  { skip: skipWithoutDatabase, timeout: 180_000 },
  async () => {
    const env = await l78ProductionFixture('l78sever');
    const proxy = await startFaultProxy({
      host: '127.0.0.1',
      port: Number(new URL(l78AdminUrl()).port || 5432),
    });
    try {
      const before = await l78TargetImage(env.target.pool);
      let fired = false;
      void proxy.severOn('CREATE INDEX', { mode: 'before' }).then(() => {
        fired = true;
      });
      const result = await l78RunCli([env.dump, '--database', env.target.name, '--force'], {
        DATABASE_URL: l78ProxiedAdminUrl(proxy),
      }).done;
      assert.ok(fired, 'القطعُ لم يقع');
      assert.equal(result.code, 1, result.stdout);
      assert.doesNotMatch(result.stdout, /RESTORE_OK/);
      assert.match(result.stderr, /⛔ \[RESTORE_COMMAND_FAILED\]/);
      assert.equal(await l78TargetImage(env.target.pool), before, 'الهدفُ تغيّرَ بعدَ الانقطاع');
      await l78AssertStaleUsable(env.target.pool);
    } finally {
      await proxy.close();
      await env.cleanup();
    }
  },
);

test(
  'WL-624 LIVE-78: أرشيفٌ في فهرسِه كائنٌ كبير (‏BLOB) يُرفَضُ RESTORE_ARCHIVE_UNSUPPORTED قبلَ اللمس — خرجُه يحملُ BEGIN/COMMIT خاصّةً تكسرُ المعاملةَ الواحدة',
  { skip: skipWithoutDatabase, timeout: 180_000 },
  async () => {
    const env = await l78ProductionFixture('l78blob');
    try {
      const { wrapper } = await l78RestoreWrapper(env.fixture.dir, {
        listExtra: '9999; 2613 16400 BLOB - 16400 state',
      });
      const before = await l78TargetImage(env.target.pool);
      const result = await l78RunCli([env.dump, '--database', env.target.name, '--force'], {
        DATABASE_URL: l78AdminUrl(),
        PG_RESTORE: wrapper,
      }).done;
      assert.equal(result.code, 1, result.stdout);
      assert.match(result.stderr, /⛔ \[RESTORE_ARCHIVE_UNSUPPORTED\]/);
      assert.equal(
        fs.existsSync(path.join(env.fixture.dir, 'full.sql')),
        false,
        'شُغِّلَت الاستعادةُ رغمَ الرفض',
      );
      assert.equal(await l78TargetImage(env.target.pool), before);
      await l78AssertStaleUsable(env.target.pool);
    } finally {
      await env.cleanup();
    }
  },
);

test(
  'WL-624 LIVE-78: فهرسٌ يتجاوزُ تقديرُ أقفالِه نصفَ جدولِ الأقفالِ المشترك يُرفَضُ RESTORE_LOCK_CAPACITY قبلَ اللمس — بلا رفعِ إعداد',
  { skip: skipWithoutDatabase, timeout: 180_000 },
  async () => {
    const env = await l78ProductionFixture('l78lock');
    try {
      const { LOCKS_PER_ARCHIVE_ENTRY } = await import('../../scripts/restore.mjs');
      const settings = (
        await env.target.pool.query(
          `SELECT current_setting('max_locks_per_transaction')::int * (current_setting('max_connections')::int + current_setting('max_prepared_transactions')::int) AS capacity`,
        )
      ).rows[0];
      // مدخلاتٌ مزوّرةٌ تكفي وحدَها لتجاوزِ النصف — الحدُّ يُقرأُ من الخادمِ لا يُفترَض.
      const fake = Math.ceil(Number(settings.capacity) / 2 / LOCKS_PER_ARCHIVE_ENTRY) + 1;
      const { wrapper } = await l78RestoreWrapper(env.fixture.dir, { listFake: fake });
      const before = await l78TargetImage(env.target.pool);
      const result = await l78RunCli([env.dump, '--database', env.target.name, '--force'], {
        DATABASE_URL: l78AdminUrl(),
        PG_RESTORE: wrapper,
      }).done;
      assert.equal(result.code, 1, result.stdout);
      assert.match(result.stderr, /⛔ \[RESTORE_LOCK_CAPACITY\]/);
      assert.doesNotMatch(result.stdout, /RESTORE_OK/);
      assert.equal(
        fs.existsSync(path.join(env.fixture.dir, 'full.sql')),
        false,
        'شُغِّلَت الاستعادةُ رغمَ الرفض',
      );
      assert.equal(await l78TargetImage(env.target.pool), before);
      await l78AssertStaleUsable(env.target.pool);
      await l78WaitForNoRestoreBackend(env.target.name);

      // ضابط: الأرشيفُ نفسُه بلا تزويرٍ يمرُّ من الفحصِ نفسِه ويُستعاد.
      const control = await l78RunCli([env.dump, '--database', env.target.name, '--force'], {
        DATABASE_URL: l78AdminUrl(),
      }).done;
      assert.equal(control.code, 0, control.stderr);
      assert.match(control.stdout, /\[RESTORE_OK\]/);
      await l78AssertRestored(env.target.pool);
    } finally {
      await env.cleanup();
    }
  },
);
