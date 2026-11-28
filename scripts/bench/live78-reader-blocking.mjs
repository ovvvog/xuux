#!/usr/bin/env node
// @ts-nocheck — أداةُ قياسٍ تُشغَّلُ يدوياً لا وحدةٌ تُستدعى (‏`WL-630`): سجلّاتُها كائناتٌ حرّةُ الشكلِ تُكتَبُ JSON خامّاً؛
// تنميطُها لا يحمي سلوكاً إنتاجيّاً، وESLint وprettier يبقيانِ عليها.
/**
 * ‏`WL-630` (‏`LIVE-78`): قياسُ كلفةِ حجبِ القرّاءِ والكُتّابِ أثناءَ معاملةِ `restore --force` الواحدة.
 *
 * **قياسٌ لا اختبار:** لا يُشغَّلُ في `npm test` (‏اسمُه خارجَ نمطِ `test:suite`)، ولا يُقرِّرُ قبولَ الكلفة —
 * ذاك قرارُ المالك. يُشغِّلُ الأداةَ الإنتاجيّةَ نفسَها (‏`scripts/backup.mjs` ثمّ `scripts/restore.mjs` عمليّةً
 * مستقلّة) على قاعدةٍ حقيقيّةٍ ويُسجِّلُ كلَّ استعلامٍ لكلِّ عميلٍ متزامنٍ بزمنِه ونتيجتِه، ويكتبُ النتائجَ الخامَ
 * (‏JSON) والبيئةَ إلى `--out`.
 *
 * السيناريوهات (‏لكلِّ حجم): `success` (‏استعادةٌ ناجحة)، `kill` (‏`SIGKILL` لعمليّةِ الاستعادةِ بعدَ أن
 * تُمسِكَ القفلَ الحصريّ)، `verify-fail` (‏تلاعبٌ بالمحتوى يُسقِطُ التحقّقَ قبلَ `COMMIT`). والعملاء:
 *   - `reader-pre`  قارئٌ متّصلٌ قبلَ الاستعادة، يعدُّ `state.laws` كلَّ 25 ms؛
 *   - `reader-mid`  قارئٌ يتّصلُ بعدَ أن تبدأَ الاستعادةُ الحجبَ؛
 *   - `reader-lt`   قارئٌ بـ`lock_timeout = 500ms` (‏سلوكُ الإلغاءِ بالمهلة)؛
 *   - `reader-st`   قارئٌ بـ`statement_timeout = 2000ms`؛
 *   - `writer`      كاتبٌ يُدرِجُ صفّاً كلَّ 50 ms (‏قيمُ `law-bench-w*`).
 * والتحقّقُ الدلاليُّ لكلِّ قراءةٍ ناجحة: العددُ إمّا القديمُ (‏قبلَ COMMIT، مع ما كتبَه الكاتبُ) وإمّا الجديدُ
 * (‏المستعاد، مع ما كتبَه الكاتبُ بعدَ COMMIT) — **لا عددَ جزئيٌّ ولا `42P01`** (‏ذاك عيبُ ما قبلَ `WL-624`).
 *
 * التشغيل: DATABASE_URL=postgresql://<superuser>@host/db node scripts/bench/live78-reader-blocking.mjs \
 *            --sizes 1000,100000,1000000 --repeats 3 --scenarios success,kill,verify-fail --out <dir>
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { up } from '../../src/persistence/migrator.mjs';
import { createBackup } from '../backup.mjs';

const RESTORE_CLI = fileURLToPath(new URL('../restore.mjs', import.meta.url));
// ‏مراجعةُ 2026-11-28 (‏D3): مختلفٌ عن كلِّ حجمٍ مقيس (‏كانَ 1000 = أصغرُ الأحجامِ فلا يُميَّزُ القديمُ من الجديد).
const OLD_ROWS = 1500;
const READ_INTERVAL_MS = 25;
const WRITE_INTERVAL_MS = 50;

function parseArgs(argv) {
  const o = { sizes: [1000, 100000], repeats: 1, scenarios: ['success'], out: null, body: 100 };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const v = argv[i + 1];
    if (a === '--sizes') {
      o.sizes = String(v).split(',').map(Number);
      i += 1;
    } else if (a === '--repeats') {
      o.repeats = Number(v);
      i += 1;
    } else if (a === '--scenarios') {
      o.scenarios = String(v).split(',');
      i += 1;
    } else if (a === '--out') {
      o.out = String(v);
      i += 1;
    } else if (a === '--body') {
      o.body = Number(v);
      i += 1;
    } else throw new Error(`وسيطٌ غيرُ معروف: ${a}`);
  }
  if (o.out === null) throw new Error('--out مطلوب');
  return o;
}

const adminUrl = () => {
  const u = process.env.DATABASE_URL;
  if (!u) throw new Error('DATABASE_URL غير معلَنة');
  return u;
};
const urlFor = (name) => {
  const u = new URL(adminUrl());
  u.pathname = `/${name}`;
  return u.toString();
};
const now = () => Number(process.hrtime.bigint() / 1000n) / 1000; // ms

async function admin(sql) {
  const c = new pg.Client({ connectionString: adminUrl() });
  await c.connect();
  try {
    return await c.query(sql);
  } finally {
    await c.end();
  }
}

async function createDb(name) {
  await admin(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
  await admin(`CREATE DATABASE "${name}"`);
  const pool = new pg.Pool({ connectionString: urlFor(name), max: 2 });
  pool.on('error', () => undefined);
  return pool;
}

async function fillLaws(pool, from, count, bodyBytes, prefix) {
  const step = 200000;
  for (let s = 0; s < count; s += step) {
    const n = Math.min(step, count - s);
    await pool.query(
      `INSERT INTO state.laws (id, title, body, status, scope, proposer)
       SELECT '${prefix}' || lpad((g + ${from + s})::text, 9, '0'), 'عنوان ' || (g + ${from + s}), repeat('x', ${bodyBytes}) || g,
              'draft', 'testing', 'agent-001'
         FROM generate_series(1, ${n}) g`,
    );
  }
}

/** عميلٌ يُكرِّرُ استعلاماً ويُسجِّلُ كلَّ محاولة. */
function startClient(kind, url, opts) {
  const log = [];
  let stop = false;
  let seq = 0;
  const done = (async () => {
    if (opts.startAfter) await opts.startAfter;
    /** يُعيدُ عميلاً متّصلاً أو null (‏لا إسنادَ لمتغيّرٍ مشترَكٍ عبرَ await). */
    const connect = async () => {
      const fresh = new pg.Client({ connectionString: url, application_name: `bench-${kind}` });
      fresh.on('error', () => undefined);
      const t0 = now();
      try {
        await fresh.connect();
        if (opts.setup) for (const s of opts.setup) await fresh.query(s);
        log.push({ kind, op: 'connect', t0, t1: now(), ok: true });
        return fresh;
      } catch (e) {
        log.push({
          kind,
          op: 'connect',
          t0,
          t1: now(),
          ok: false,
          code: e.code ?? null,
          msg: String(e.message).slice(0, 200),
        });
        return null;
      }
    };
    let c = await connect();
    while (!stop) {
      if (c === null) {
        await new Promise((r) => setTimeout(r, 100));
        c = await connect();
        continue;
      }
      seq += 1;
      const t0 = now();
      const cur = c;
      try {
        const r = await cur.query(opts.sql(seq));
        log.push({
          kind,
          op: 'q',
          t0,
          t1: now(),
          ok: true,
          value: r.rows[0] ? Number(Object.values(r.rows[0])[0]) : r.rowCount,
        });
      } catch (e) {
        log.push({
          kind,
          op: 'q',
          t0,
          t1: now(),
          ok: false,
          code: e.code ?? null,
          msg: String(e.message).slice(0, 200),
        });
        if (e.code === undefined || ['57P01', '08006', '08003'].includes(e.code)) {
          c = null;
          try {
            await cur.end();
          } catch {
            /* */
          }
        }
      }
      await new Promise((r) => setTimeout(r, opts.interval));
    }
    try {
      await c?.end();
    } catch {
      /* */
    }
  })();
  return {
    log,
    stop: () => {
      stop = true;
      return done;
    },
  };
}

function runRestore(dump, target, env = {}) {
  const t0 = now();
  const child = spawn(process.execPath, [RESTORE_CLI, dump, '--database', target, '--force'], {
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  child.stdout.on('data', (d) => {
    out += d;
  });
  child.stderr.on('data', (d) => {
    out += d;
  });
  const done = new Promise((resolve) =>
    child.on('close', (code, signal) =>
      resolve({ code, signal, t0, t1: now(), out: out.slice(-1500) }),
    ),
  );
  return { child, done };
}

/** ينتظرُ أن تُمسِكَ جلسةُ الاستعادةِ قفلاً حصريّاً على علاقةٍ في الهدف (‏= بدأ الحجب). */
async function waitForExclusive(target, timeoutMs = 60000) {
  const c = new pg.Client({ connectionString: urlFor(target) });
  await c.connect();
  const t0 = now();
  try {
    for (;;) {
      const r = await c.query(
        `SELECT count(*)::int n FROM pg_locks l JOIN pg_stat_activity a ON a.pid = l.pid
          WHERE a.application_name = 'xuux-restore' AND l.mode = 'AccessExclusiveLock' AND l.granted
            AND l.locktype = 'relation' AND l.database = (SELECT oid FROM pg_database WHERE datname = current_database())`,
      );
      if (r.rows[0].n > 0) return now();
      if (now() - t0 > timeoutMs) return null;
      await new Promise((r2) => setTimeout(r2, 10));
    }
  } finally {
    await c.end();
  }
}

async function snapshotTarget(target) {
  const c = new pg.Client({ connectionString: urlFor(target) });
  await c.connect();
  try {
    const r =
      await c.query(`SELECT count(*)::int n, count(*) FILTER (WHERE id LIKE 'law-old%')::int old,
                                    count(*) FILTER (WHERE id LIKE 'law-new%')::int new,
                                    count(*) FILTER (WHERE id LIKE 'law-bench-w%')::int w FROM state.laws`);
    return r.rows[0];
  } finally {
    await c.end();
  }
}

function stats(values) {
  if (values.length === 0) return { n: 0 };
  const s = [...values].sort((a, b) => a - b);
  const q = (p) => s[Math.min(s.length - 1, Math.floor(p * (s.length - 1)))];
  return { n: s.length, min: s[0], p50: q(0.5), p95: q(0.95), p99: q(0.99), max: s[s.length - 1] };
}

function summarize(logs, restore, blockStart, oldCount, newCount) {
  const out = {};
  for (const [kind, log] of Object.entries(logs)) {
    const qs = log.filter((e) => e.op === 'q');
    const lat = qs.map((e) => e.t1 - e.t0);
    const blocked = qs.filter((e) => e.t1 - e.t0 > 100);
    const errors = {};
    for (const e of qs.filter((x) => !x.ok))
      errors[e.code ?? 'none'] = (errors[e.code ?? 'none'] ?? 0) + 1;
    let anomalies = 0;
    /** @type {unknown[]} */
    const anomalySamples = [];
    if (kind.startsWith('reader')) {
      // ‏مراجعةُ 2026-11-28 (‏D3): المُسنِدُ السابقُ كانَ شبهَ فارغ. الآن كلُّ قراءةٍ ناجحةٍ يجبُ أن تساوي إحدى الحالتين بالضبط
      // ضمنَ ما التزمَه الكاتبُ حولَ زمنِها (‏لقطةُ `READ COMMITTED` تؤخَذُ بينَ بدءِ العبارةِ ونهايتِها):
      //   القديم: oldCount + كتاباتٌ ناجحةٌ انتهت قبلَ بدءِ القراءة … بدأت قبلَ نهايتِها؛
      //   الجديد: newCount + مثلُ ذلك لكن من الكتاباتِ التي انتهت بعدَ بدءِ الحجب (‏ما قبلَه محاه الاستعادة).
      // لا عددٌ جزئيٌّ (‏جدولٌ نصفُ مُعبّأ) يقعُ في أيٍّ منهما لأنَّ الحجمَ أكبرُ أو أصغرُ من الكتاباتِ بفارقٍ كبير.
      const writes = (logs.writer ?? []).filter((x) => x.op === 'q' && x.ok);
      const fence = blockStart ?? Infinity;
      for (const e of qs.filter((x) => x.ok)) {
        const v = e.value;
        const oldLo = oldCount + writes.filter((w) => w.t1 <= e.t0).length;
        const oldHi = oldCount + writes.filter((w) => w.t0 <= e.t1).length;
        const newLo = newCount + writes.filter((w) => w.t1 >= fence && w.t1 <= e.t0).length;
        const newHi = newCount + writes.filter((w) => w.t1 >= fence && w.t0 <= e.t1).length;
        const okOld = v >= oldLo && v <= oldHi;
        const okNew = restore.code === 0 && v >= newLo && v <= newHi;
        if (!(okOld || okNew)) {
          anomalies += 1;
          if (anomalySamples.length < 5)
            anomalySamples.push({ v, t0: e.t0, t1: e.t1, oldLo, oldHi, newLo, newHi });
        }
      }
    }
    out[kind] = {
      queries: qs.length,
      ok: qs.filter((e) => e.ok).length,
      errors,
      latency_ms: stats(lat),
      blocked_over_100ms: blocked.length,
      max_block_ms: blocked.length ? Math.max(...blocked.map((e) => e.t1 - e.t0)) : 0,
      semantic_anomalies: anomalies,
      semantic_anomaly_samples: anomalySamples,
      connects: log
        .filter((e) => e.op === 'connect')
        .map((e) => ({ ok: e.ok, ms: Math.round(e.t1 - e.t0), code: e.code ?? null })),
    };
  }
  return {
    restore_ms: Math.round(restore.t1 - restore.t0),
    exclusive_lock_after_ms: blockStart === null ? null : Math.round(blockStart - restore.t0),
    exclusive_window_ms: blockStart === null ? null : Math.round(restore.t1 - blockStart),
    clients: out,
  };
}

function environment() {
  let pgv = null;
  try {
    pgv = execFileSync('psql', ['--version']).toString().trim();
  } catch {
    /* */
  }
  return {
    node: process.version,
    psql: pgv,
    os: `${os.type()} ${os.release()}`,
    cpus: os.cpus().length,
    cpu_model: os.cpus()[0]?.model ?? null,
    mem_gb: Math.round(os.totalmem() / 2 ** 30),
    loadavg_at_start: os.loadavg(),
  };
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  fs.mkdirSync(o.out, { recursive: true });
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'xuux-bench-l78-'));
  const env = environment();
  const sv =
    await admin(`SELECT version() v, current_setting('shared_buffers') sb, current_setting('max_locks_per_transaction') ml,
                                 current_setting('wal_level') wl, current_setting('synchronous_commit') sc, current_setting('fsync') fs`);
  env.server = sv.rows[0];
  const results = [];
  const tag = crypto.randomBytes(3).toString('hex');
  try {
    for (const size of o.sizes) {
      const src = `bench_l78_src_${tag}`;
      const sp = await createDb(src);
      await up(sp, { to: 23 });
      const tf0 = now();
      await fillLaws(sp, 0, size, o.body, 'law-new');
      const fillMs = Math.round(now() - tf0);
      const srcBytes = Number(
        (await sp.query(`SELECT pg_database_size(current_database())::bigint b`)).rows[0].b,
      );
      await sp.end();
      const dump = path.join(work, `src-${size}.dump`);
      const tb0 = now();
      await createBackup(dump, urlFor(src));
      const backupMs = Math.round(now() - tb0);
      const dumpBytes = fs.statSync(dump).size;
      await admin(`DROP DATABASE "${src}" WITH (FORCE)`);
      const newCount = size;
      for (const scenario of o.scenarios) {
        for (let rep = 1; rep <= o.repeats; rep += 1) {
          const target = `bench_l78_tgt_${tag}`;
          const tp = await createDb(target);
          await up(tp, { to: 23 });
          await fillLaws(tp, 0, OLD_ROWS, o.body, 'law-old');
          let tamper = false;
          if (scenario === 'verify-fail') {
            // ‏قادحُ أحداثٍ خارجَ `state` يُبدِّلُ المحتوى المنسوخ ⇒ البصمةُ لا تطابق ⇒ لا COMMIT (‏كما في اختبارات WL-624).
            await tp.query(
              `CREATE FUNCTION public.bench_tamper_row() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN NEW.body := 'x'; RETURN NEW; END $f$`,
            );
            await tp.query(`CREATE FUNCTION public.bench_attach() RETURNS event_trigger LANGUAGE plpgsql AS $f$
              DECLARE o record; BEGIN
                FOR o IN SELECT * FROM pg_event_trigger_ddl_commands() WHERE object_identity = 'state.laws' AND command_tag = 'CREATE TABLE' LOOP
                  EXECUTE 'CREATE TRIGGER bench_tamper BEFORE INSERT ON state.laws FOR EACH ROW EXECUTE FUNCTION public.bench_tamper_row()';
                END LOOP; END $f$`);
            await tp.query(
              `CREATE EVENT TRIGGER bench_attach ON ddl_command_end WHEN TAG IN ('CREATE TABLE') EXECUTE FUNCTION public.bench_attach()`,
            );
            tamper = true;
          }
          await tp.end();
          const before = await snapshotTarget(target);
          const url = urlFor(target);
          const readSql = () => 'SELECT count(*) FROM state.laws';
          let releaseMid;
          const midGate = new Promise((r) => {
            releaseMid = r;
          });
          const clients = {
            'reader-pre': startClient('reader-pre', url, {
              sql: readSql,
              interval: READ_INTERVAL_MS,
            }),
            'reader-mid': startClient('reader-mid', url, {
              sql: readSql,
              interval: READ_INTERVAL_MS,
              startAfter: midGate,
            }),
            'reader-lt': startClient('reader-lt', url, {
              sql: readSql,
              interval: READ_INTERVAL_MS,
              setup: [`SET lock_timeout = '500ms'`],
            }),
            'reader-st': startClient('reader-st', url, {
              sql: readSql,
              interval: READ_INTERVAL_MS,
              setup: [`SET statement_timeout = '2000ms'`],
            }),
            writer: startClient('writer', url, {
              sql: (n) => {
                const id = `law-bench-w${rep}-${n}-${crypto.randomBytes(3).toString('hex')}`;
                return `INSERT INTO state.laws (id, title, body, status, scope, proposer) VALUES ('${id}', '${id}', 'w', 'draft', 'testing', 'agent-001')`;
              },
              interval: WRITE_INTERVAL_MS,
            }),
          };
          await new Promise((r) => setTimeout(r, 500)); // قبلَ الاستعادة: خطُّ أساس
          // ‏`SIGKILL` لا يُشغِّلُ تنظيفاً: نسخةُ الأرشيفِ الخاصّةُ تُوجَّهُ إلى مجلّدِ القياسِ (‏يُمحى في النهاية) لا إلى `/tmp`.
          const restore = runRestore(dump, target, { TMPDIR: work });
          const blockStart = await waitForExclusive(target);
          releaseMid();
          let killedAt = null;
          if (scenario === 'kill' && blockStart !== null) {
            // ‏منتصفُ الضخِّ تقريباً: نصفُ زمنِ الاستعادةِ المقيسِ في سيناريو النجاحِ للحجمِ نفسِه إن وُجِد، وإلّا 300 ms.
            const ref = results.find((x) => x.size === size && x.scenario === 'success');
            const delay = ref ? Math.max(50, Math.round(ref.summary.exclusive_window_ms / 2)) : 300;
            await new Promise((r) => setTimeout(r, delay));
            killedAt = now();
            restore.child.kill('SIGKILL');
          }
          const res = await restore.done;
          await new Promise((r) => setTimeout(r, scenario === 'kill' ? 3000 : 800)); // ما بعدَ الاستعادة
          for (const c of Object.values(clients)) await c.stop();
          const after = await snapshotTarget(target);
          const logs = Object.fromEntries(Object.entries(clients).map(([k, v]) => [k, v.log]));
          const summary = summarize(logs, res, blockStart, before.n, newCount);
          // ‏ما بعدَ القتل: متى عادَ القارئُ أوّلَ مرّةٍ بنجاح؟
          if (killedAt !== null) {
            const first = logs['reader-pre'].find((e) => e.op === 'q' && e.ok && e.t1 > killedAt);
            summary.reader_pre_resumed_after_kill_ms = first
              ? Math.round(first.t1 - killedAt)
              : null;
          }
          const row = {
            size,
            scenario,
            rep,
            body_bytes: o.body,
            fill_ms: fillMs,
            backup_ms: backupMs,
            src_db_bytes: srcBytes,
            dump_bytes: dumpBytes,
            restore_exit: { code: res.code, signal: res.signal },
            restore_tail: res.out.split('\n').filter(Boolean).slice(-3),
            target_before: before,
            target_after: after,
            tamper,
            summary,
            loadavg: os.loadavg(),
          };
          results.push(row);
          fs.writeFileSync(
            path.join(o.out, `raw-${size}-${scenario}-${rep}.json`),
            JSON.stringify({ row, logs }, null, 1),
          );
          process.stdout.write(
            `${size}\t${scenario}\t#${rep}\texit=${res.code ?? res.signal}\trestore=${summary.restore_ms}ms\twindow=${summary.exclusive_window_ms}ms\tpre.max=${Math.round(summary.clients['reader-pre'].latency_ms.max ?? 0)}ms\tmid.max=${Math.round(summary.clients['reader-mid'].latency_ms.max ?? 0)}ms\tlt.err=${JSON.stringify(summary.clients['reader-lt'].errors)}\tst.err=${JSON.stringify(summary.clients['reader-st'].errors)}\tw.max=${Math.round(summary.clients.writer.latency_ms.max ?? 0)}ms\tw.err=${JSON.stringify(summary.clients.writer.errors)}\tanom=${Object.values(summary.clients).reduce((a, c) => a + c.semantic_anomalies, 0)}\tafter=${JSON.stringify(after)}\n`,
          );
          await admin(`DROP DATABASE IF EXISTS "${target}" WITH (FORCE)`);
        }
      }
    }
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
    env.loadavg_at_end = os.loadavg();
    fs.writeFileSync(
      path.join(o.out, 'summary.json'),
      JSON.stringify(
        { environment: env, options: o, results: results.map((r) => ({ ...r })) },
        null,
        1,
      ),
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
