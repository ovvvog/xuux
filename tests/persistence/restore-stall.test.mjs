// انقطاعٌ صامتٌ عندَ `COMMIT` الاستعادة — `WL-629` (‏`LIVE-78`).
//
// مراجعةُ 2026-11-28 (‏r1، العيبُ 4) أعادت إنتاجَه: `restore --force` عبرَ وسيطٍ يبتلعُ الحزمَ ⇒ الأداةُ معلّقةٌ بلا حدٍّ
// حتى قُتِلت، والخلفيّةُ `idle in transaction` تمسكُ أقفالَها (‏`AccessExclusiveLock` على كلِّ جدول) — خرجُ `pg_restore`
// يُصفِّرُ `idle_in_transaction_session_timeout`. الذرّيّةُ صمدت (‏لا `COMMIT` وصل) لكن لا حدَّ ولا إبلاغ.
// الوسيطُ هنا (‏`mode: 'stall'`) لا يقطعُ المقبس: يبتلعُ `COMMIT` وكلَّ ما بعدَه في الاتجاهين، ولا يُبلِغُ العميلَ إغلاقَ الخادم.
// كلا الاختبارين أحمرُ على الشيفرةِ قبلَ `WL-629` (‏الأداةُ لا تنتهي خلالَ الحدّ؛ مقيسٌ عندَ الإضافة).
//
// التشغيل: DATABASE_URL=... node --test tests/persistence/restore-stall.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
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
/** حدُّ انتظارِ الأداةِ في الاختبار: أضعافُ مجموعِ الحدودِ المضبوطةِ أدناه، وأقلُّ كثيراً من «بلا حدّ». */
const CLI_DEADLINE_MS = 45_000;
const STALL_ENV = {
  RESTORE_IDLE_TX_TIMEOUT_MS: '3000',
  RESTORE_COMMIT_ACK_TIMEOUT_MS: '4000',
  RESTORE_STEP_TIMEOUT_MS: '8000',
};
/**
 * رسالةُ `COMMIT` من psql (‏Query بنصِّ `COMMIT;` منتهيةً بـNUL): psql يُرسِلُ كلَّ عبارةٍ رسالةً مستقلّة، فلا تُطابَقُ
 * سطورٌ متجاورة؛ وNUL يمنعُ مطابقةَ «COMMIT» داخلَ نصٍّ أطول (‏أجسامُ الدوالِّ المستعادة).
 */
const COMMIT_PATTERN = 'COMMIT;\u0000';
/**
 * مراجعةُ 2026-11-28 لـ`5d07cb73` (‏D1/D2): انقطاعٌ صامتٌ **قبلَ الضخّ** (‏عبارةُ المحوِ الأولى، `--force`) و**بعدَه وقبلَ
 * `COMMIT`** (‏تركيبُ الدفتر). كلاهما كانَ يُعلِّقُ الأداةَ بلا حدّ، والأوّلُ يُبقي الخلفيّةَ ممسكةً بالأقفال.
 */
const PRE_PUMP_PATTERN = 'DROP TABLE IF EXISTS public.';
const POST_PUMP_PATTERN = 'SET SCHEMA public';

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
  const started = Date.now();
  /** @type {Promise<{ code: number | null, stdout: string, stderr: string, ms: number, hung: boolean }>} */
  const done = new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
    }, CLI_DEADLINE_MS);
    let hung = false;
    timer.unref();
    child.on('error', reject);
    child.on('exit', (_code, signal) => {
      if (signal === 'SIGKILL') hung = true;
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr, ms: Date.now() - started, hung });
    });
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

/** جلساتُ الاستعادةِ الحيّةُ على الهدف (‏من الخادمِ مباشرةً، لا عبرَ الوسيط). @param {string} db */
async function restoreBackends(db) {
  const admin = new pg.Client({ connectionString: l78AdminUrl() });
  await admin.connect();
  try {
    return (
      await admin.query(
        `SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = $1 AND application_name = 'xuux-restore'`,
        [db],
      )
    ).rows[0].n;
  } finally {
    await admin.end();
  }
}

/** قارئٌ مباشرٌ على الهدفِ بحدِّ قفلٍ قصير: الأقفالُ محرَّرة؟ @param {string} db */
async function readerUnblocked(db) {
  const c = new pg.Client({ connectionString: l78Url(db) });
  await c.connect();
  try {
    await c.query(`SET lock_timeout = '1s'`);
    return (await c.query(`SELECT count(*)::int AS n FROM state.laws`)).rows[0].n;
  } finally {
    await c.end();
  }
}

/**
 * @param {string} label
 * @param {{ thenStallDatabase?: boolean, pattern?: string }} opts
 */
async function stallScenario(label, opts) {
  const { fixture, dump } = await productionSource(label);
  const target = await l78BusyTarget(`${label}t`);
  const proxy = await startFaultProxy({
    host: '127.0.0.1',
    port: Number(new URL(l78AdminUrl()).port || 5432),
  });
  try {
    const before = await l78TargetImage(target.pool);
    let fired = false;
    void proxy
      .severOn(opts.pattern ?? COMMIT_PATTERN, {
        mode: 'stall',
        ...(opts.thenStallDatabase === true ? { thenStallDatabase: target.name } : {}),
      })
      .then(() => {
        fired = true;
      });
    const url = new URL(proxy.urlFor(l78AdminUrl()));
    url.searchParams.set('sslmode', 'disable');
    const result = await runCli([dump, '--database', target.name, '--force'], {
      DATABASE_URL: url.toString(),
      ...STALL_ENV,
    }).done;
    assert.ok(fired, `الانقطاعُ لم يقع:\n${result.stdout}\n${result.stderr}`);
    assert.equal(
      result.hung,
      false,
      `الأداةُ معلّقةٌ ${CLI_DEADLINE_MS} ms بلا حدّ:\n${result.stderr}`,
    );
    assert.equal(result.code, 1, result.stdout);
    assert.doesNotMatch(result.stdout, /RESTORE_OK/);
    // جهةُ الخادم: حدُّ الخمولِ أنهى الخلفيّة ⇒ لا جلسةَ استعادة، والقارئُ لا يُحجَب، والهدفُ كما كانَ بالضبط.
    assert.equal(await restoreBackends(target.name), 0, 'خلفيّةُ الاستعادةِ ما زالت حيّة');
    assert.equal(await readerUnblocked(target.name), 1, 'القارئُ محجوبٌ أو الهدفُ تغيّر');
    assert.equal(await l78TargetImage(target.pool), before, 'الهدفُ تغيّرَ بلا COMMIT');
    return result;
  } finally {
    await proxy.close();
    await target.drop();
    await fixture.cleanup();
  }
}

test(
  'WL-629 LIVE-78: COMMIT يُبتلَعُ بصمتٍ والخادمُ يُسأَل ⇒ psql يُقتَلُ بعدَ الحدّ، والخادمُ يُجهِضُ بحدِّ الخمول ⇒ RESTORE_COMMIT_FAILED والهدفُ كما كان',
  { skip: skipWithoutDatabase, timeout: 110_000 },
  async () => {
    const r = await stallScenario('l78stall', {});
    assert.match(r.stderr, /⛔ \[RESTORE_COMMIT_FAILED\]/u, r.stderr);
  },
);

test(
  'WL-629 LIVE-78: COMMIT يُبتلَعُ وكلُّ وصلةٍ جديدةٍ إلى الهدفِ تُبتلَع ⇒ لا تعليق: RESTORE_COMMIT_OUTCOME_UNKNOWN خلالَ الحدود، والخادمُ يُحرِّرُ الأقفال',
  { skip: skipWithoutDatabase, timeout: 110_000 },
  async () => {
    const r = await stallScenario('l78stallu', { thenStallDatabase: true });
    assert.match(r.stderr, /⛔ \[RESTORE_COMMIT_OUTCOME_UNKNOWN\]/u, r.stderr);
  },
);

test(
  'WL-629 LIVE-78 (مراجعة D1): انقطاعٌ صامتٌ قبلَ الضخّ (عبارةُ المحو) ⇒ حدُّ الخطوةِ يقتلُ psql، وحدُّ الخمولِ مضبوطٌ منذُ BEGIN ⇒ الخادمُ يُحرِّرُ الأقفال والهدفُ كما كان',
  { skip: skipWithoutDatabase, timeout: 110_000 },
  async () => {
    const r = await stallScenario('l78stallpre', { pattern: PRE_PUMP_PATTERN });
    assert.match(r.stderr, /لا ردَّ من الخادمِ خلالَ 8000 ms/u, r.stderr);
    assert.doesNotMatch(r.stderr, /RESTORE_COMMIT_/u, r.stderr);
  },
);

test(
  'WL-629 LIVE-78 (مراجعة D2): انقطاعٌ صامتٌ بعدَ الضخِّ وقبلَ COMMIT (تركيبُ الدفتر) ⇒ لا تعليق: حدُّ الخطوةِ يقتلُ psql بلا COMMIT، والهدفُ كما كان',
  { skip: skipWithoutDatabase, timeout: 110_000 },
  async () => {
    const r = await stallScenario('l78stallpost', { pattern: POST_PUMP_PATTERN });
    assert.match(r.stderr, /لا ردَّ من الخادمِ خلالَ 8000 ms/u, r.stderr);
    assert.doesNotMatch(r.stderr, /RESTORE_COMMIT_/u, r.stderr);
  },
);
