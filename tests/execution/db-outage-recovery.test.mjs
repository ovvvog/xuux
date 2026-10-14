/**
 * الاستردادُ الذاتيُّ للعامل من انقطاعِ قاعدةِ البيانات — `WL-387`.
 *
 * كلُّ عطبٍ هنا **حقيقيٌّ**: وسيطُ TCP (`tests/helpers/pg-fault-proxy.mjs`) بين
 * العاملِ وPostgres يرفضُ الاتصالَ أو يقطعُ المقبسَ عند بايتاتِ استعلامٍ بعينه،
 * قبل تمريرِه (لم يُلتزَم حتماً) أو بعد ردِّ الخادمِ على `COMMIT` (التُزم حتماً وضاع
 * ردُّه). ولا تُستبدل دالّةٌ من الطابورِ ولا من `pg`. وكلُّ اختبارٍ على قاعدةٍ معزولةٍ
 * خاصّةٍ به، وتُقرأ الحقيقةُ من مجمّعٍ مباشرٍ لا يمرُّ بالوسيط.
 *
 * والحكمُ يُقاس بالقاعدة لا بجوابِ الدالة: عددُ مرّاتِ تشغيلِ المُعالِج، وعددُ
 * انتقالاتِ النجاح، وحالةُ المهمّة ومحاولاتُها، وما بقي بعقدِ العامل.
 */

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import {
  createCipheriv,
  createDecipheriv,
  generateKeyPairSync,
  randomBytes,
  randomUUID,
  sign as softwareSign,
} from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  HaltSwitch,
  KingIdentity,
  PersistentEventLog,
  fingerprint,
  openProductionEventLog,
} from '../../src/root-of-trust/index.mjs';
import { UNSTARTED_RELEASE_CODE, createTaskQueue } from '../../src/execution/queue.mjs';
import { createWorker } from '../../src/execution/worker.mjs';
import { TaskLifecycle } from '../../src/execution/lifecycle.mjs';
import { probeIsolation } from '../../src/execution/isolation.mjs';
import {
  DB_FAULT_KINDS,
  RECOVERY_EXIT_CODES,
  RECOVERY_REASONS,
  RECOVERY_VERDICTS,
  TICK_PHASES,
  WorkerDatabaseFault,
  abortableSleep,
  classifyDatabaseFault,
  createDatabaseRecovery,
  resultDigest,
} from '../../src/execution/db-recovery.mjs';
import { QueueError } from '../../src/execution/queue.mjs';
import { createPool } from '../../src/persistence/db.mjs';
import { BUDGET_ERRORS } from '../../src/execution/budget.mjs';
import { HALT_RELEASE_CODE } from '../../src/execution/queue.mjs';
import { createQuotaLedger } from '../../src/policy/quota.mjs';
import { loadPolicyBundle } from '../../src/policy/loader.mjs';
import { up } from '../../src/persistence/migrator.mjs';
import { createIsolatedDatabase, databaseUrl, skipWithoutDatabase } from '../helpers/pg.mjs';
import { startFaultProxy } from '../helpers/pg-fault-proxy.mjs';
import { registerTestKing, royalKeyEnv } from '../helpers/royal-halt-command.mjs';
import { registerTmpRoot } from '../helpers/tmp-roots.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const WORKER_SCRIPT = path.join(ROOT, 'scripts/worker.mjs');
const AUTH = { decisionId: 'decision-استرداد-القاعدة' };
const SUCCEEDED_SQL = "SET state = 'succeeded'";
const CLAIM_SQL = 'FOR UPDATE SKIP LOCKED';
/** مهمّةٌ تعبر العزلَ الحقيقيَّ في العملية: سقفُ ذاكرةٍ يتّسع لـNode داخل الحدود. */
const ISOLATED_TASK = { memoryLimitMb: 1_024, timeoutMs: 20_000 };
/** ميزانيةٌ قصيرةٌ للاختبار: ~4 ثوانٍ قبل الحكم بالفشل. */
const FAST_POLICY = { maxProbes: 40, baseDelayMs: 20, maxDelayMs: 100 };

/**
 * بيئةٌ معزولة: قاعدةٌ خاصّة مهاجَرة، ووسيطٌ أمامها، ومجمّعٌ للعامل عبر الوسيط،
 * ومجمّعٌ مباشرٌ للشهادة. وكلُّ ذلك يُهدَم في `t.after` — مع كلِّ مؤقّتٍ زرعه الاختبار.
 * @param {import('node:test').TestContext} t
 * @param {{ migrate?: boolean }} [options]
 */
async function environment(t, options = {}) {
  const db = await createIsolatedDatabase('dbrecov');
  if (options.migrate !== false) await up(db.pool);
  const base = new URL(/** @type {string} */ (databaseUrl()));
  base.pathname = `/${db.name}`;
  const proxy = await startFaultProxy({ host: base.hostname, port: Number(base.port || 5432) });
  const url = proxy.urlFor(base.toString());
  // مجمّعُ الإنتاجِ نفسُه (`createPool`) لا مجمّعٌ خاصٌّ بالاختبار: مستمعو الأخطاء فيه
  // هم ما يمنع موتَ العمليّة بالقطع، فلا يُستبدلون هنا بما يُخفي غيابهم.
  const workerPool = createPool({ url, max: 4 });
  /** @type {Set<NodeJS.Timeout>} */
  const timers = new Set();
  const dir = registerTmpRoot(mkdtempSync(path.join(tmpdir(), 'wl387-')));
  t.after(async () => {
    for (const timer of timers) clearTimeout(timer);
    await proxy.close();
    await workerPool.end().catch(() => undefined);
    await db.drop();
    rmSync(dir, { recursive: true, force: true });
  });
  return {
    db,
    admin: db.pool,
    proxy,
    url,
    dir,
    workerPool,
    queue: createTaskQueue({ pool: workerPool }),
    adminQueue: createTaskQueue({ pool: db.pool }),
    /** @param {() => unknown} fn @param {number} ms */
    later(fn, ms) {
      const timer = setTimeout(() => {
        timers.delete(timer);
        void fn();
      }, ms);
      timers.add(timer);
    },
  };
}

/**
 * مفتاحُ إيقافٍ حقيقيٌّ موقَّعٌ بمفتاحِ ملك، وأمرٌ ملكيٌّ يُقبل به.
 * @param {string} dir
 */
function haltSwitchIn(dir) {
  const royalCommand = { id: `cmd:wl387-${randomUUID()}` };
  const king = new KingIdentity();
  const file = path.join(dir, 'state', 'halt.json');
  const halt = new HaltSwitch(file, king, {
    fsync: false,
    royalCommandVerifier: (command) => command.id === royalCommand.id,
  });
  return { halt, royalCommand, king, file };
}

/** سجلٌّ في الذاكرةِ للاختبار: يحفظ الوقائعَ كما وصلت. */
function memoryLog() {
  /** @type {Array<{ type: string, actor: string, data: Record<string, unknown> }>} */
  const events = [];
  return {
    events,
    /** @param {string} type @param {string} actor @param {Record<string, unknown>} data */
    append(type, actor, data) {
      events.push({ type, actor, data });
    },
  };
}

/**
 * @param {ReturnType<typeof createTaskQueue>} queue
 * @param {string} key
 * @param {Record<string, unknown>} [extra]
 */
async function enqueue(queue, key, extra = {}) {
  const { task } = await queue.enqueue(
    {
      action: 'اختبار.نجاح',
      target: `موضوع/${key}`,
      actorId: 'actor-الاسترداد',
      idempotencyKey: key,
      timeoutMs: 10_000,
      memoryLimitMb: 96,
      ...extra,
    },
    AUTH,
  );
  return task;
}

/**
 * عاملٌ عبر الوسيط، يَعُدُّ مرّاتِ تشغيلِ المُعالِج — وهي الشاهدُ على «بلا تكرار».
 * @param {Awaited<ReturnType<typeof environment>>} env
 * @param {string} name
 * @param {{ assertOperational(): void }} haltGuard
 */
function countingWorker(env, name, haltGuard) {
  const runs = { count: 0 };
  const worker = createWorker({
    queue: env.queue,
    pool: env.workerPool,
    haltGuard,
    worker: name,
    onRun: () => {
      runs.count += 1;
    },
  });
  return { worker, runs };
}

/** @param {() => Promise<unknown>} fn */
async function rejection(fn) {
  try {
    await fn();
  } catch (error) {
    return error;
  }
  throw new Error('كان يجب أن يُرفض النداء.');
}

/** @param {import('pg').Pool} admin @param {string} taskId */
async function row(admin, taskId) {
  const found = await admin.query(
    `SELECT state, lease_owner, attempts, error_code, result FROM state.tasks WHERE id = $1`,
    [taskId],
  );
  return /** @type {{ state: string, lease_owner: string | null, attempts: number, error_code: string | null, result: unknown }} */ (
    found.rows[0]
  );
}

/** @param {import('pg').Pool} admin @param {string} taskId */
async function successTransitions(admin, taskId) {
  const found = await admin.query(
    `SELECT count(*)::int AS n FROM state.task_transitions WHERE task_id = $1 AND to_state = 'succeeded'`,
    [taskId],
  );
  return Number(/** @type {{ n: number }} */ (found.rows[0]).n);
}

/**
 * بصمةُ النتيجةِ المعلّقة في العطب — ما كان العاملُ يكتبه حين انقطعت القاعدة.
 * @param {WorkerDatabaseFault} fault
 */
function pendingResultDigest(fault) {
  assert.equal(fault.pending?.op, 'succeed');
  return resultDigest(
    /** @type {{ op: 'succeed', result: Record<string, unknown> }} */ (fault.pending).result,
  );
}

/** لا مهلةَ منسيّة: لا عملَ فلا حلقة. */
const noHalt = { assertOperational() {} };

// ─── (1) التصنيف ────────────────────────────────────────────────────────────

test('التصنيفُ يميّزُ تعذُّرَ الخدمةِ عن الفسادِ وعن المجهول، ولا يبتلعُ ما ليس خطأَ قاعدة', () => {
  const of = (/** @type {Record<string, unknown>} */ props, message = 'x') =>
    classifyDatabaseFault(Object.assign(new Error(message), props));
  assert.deepEqual(of({ code: 'ECONNREFUSED' }), { kind: 'unavailable', code: 'ECONNREFUSED' });
  assert.deepEqual(of({ code: '57P01' }), { kind: 'unavailable', code: '57P01' });
  assert.deepEqual(of({ code: '08006' }), { kind: 'unavailable', code: '08006' });
  assert.equal(of({}, 'Connection terminated unexpectedly')?.kind, DB_FAULT_KINDS.UNAVAILABLE);
  assert.deepEqual(of({ code: 'XX001' }), { kind: 'integrity', code: 'XX001' });
  assert.deepEqual(of({ code: '42P01' }), { kind: 'integrity', code: '42P01' });
  assert.deepEqual(of({ code: '23505' }), { kind: 'integrity', code: '23505' });
  assert.deepEqual(of({ code: '42601' }), { kind: 'unknown', code: '42601' });
  // خطأٌ مسمّى من الطابور، أو خطأٌ برمجيّ: ليسا عطبَ قاعدةٍ ولا يُستردّ منهما.
  assert.equal(classifyDatabaseFault(new QueueError('TASK_LEASE_LOST', 'x')), null);
  assert.equal(classifyDatabaseFault(new TypeError('undefined is not a function')), null);
  assert.equal(classifyDatabaseFault('نص'), null);
  // `AggregateError` من `net` يحمل الرمزَ في داخله.
  const aggregate = new AggregateError([Object.assign(new Error('a'), { code: 'ECONNREFUSED' })]);
  assert.equal(classifyDatabaseFault(aggregate)?.kind, DB_FAULT_KINDS.UNAVAILABLE);
});

test('النومُ المقطوعُ يُنظّف مؤقّتَه ويعود فوراً', async () => {
  const controller = new AbortController();
  const started = Date.now();
  const pending = abortableSleep(60_000, controller.signal);
  controller.abort();
  assert.equal(await pending, false);
  assert.ok(Date.now() - started < 1_000, 'نومٌ لم يُقطع يُبقي العملية حيّةً دقيقة');
  assert.equal(await abortableSleep(5, undefined), true);
});

// ─── (2) الرجوع: ما كان يُميت العامل صار عطباً معرَّفاً ─────────────────────

test(
  'رجوع: قاعدةٌ لا تُجيب ⇒ الدورةُ ترفع عطباً معرَّفاً بمرحلته لا خطأً خاماً يُميت العامل',
  { skip: skipWithoutDatabase },
  async (t) => {
    const env = await environment(t);
    const task = await enqueue(env.adminQueue, 'رجوع-خام');
    await env.proxy.down();
    const { worker, runs } = countingWorker(env, 'عامل-رجوع', noHalt);

    const error = await rejection(() => worker.tick());
    assert.ok(error instanceof WorkerDatabaseFault, `رُفع: ${String(error)}`);
    assert.equal(error.phase, TICK_PHASES.CLAIM);
    assert.equal(error.fault.kind, DB_FAULT_KINDS.UNAVAILABLE);
    assert.equal(error.taskId, null);
    assert.equal(runs.count, 0);
    const state = await row(env.admin, task.id);
    assert.equal(state.state, TaskLifecycle.SCHEDULED, 'لم يُكتب شيءٌ في القاعدة');
  },
);

// ─── (3) حدُّ الحجز: التُزم وضاع ردُّه ─────────────────────────────────────

test(
  'حدُّ الحجز: حجزٌ التُزم وضاع ردُّه يُفرَج عنه بلا احتسابِ محاولة ثم يُنفَّذ مرّةً واحدة',
  { skip: skipWithoutDatabase },
  async (t) => {
    const env = await environment(t);
    // سقفٌ بمحاولةٍ واحدة: لو حُسبت المحاولةُ الضائعة لذهبت المهمّة ميتةً بلا تنفيذ.
    const task = await enqueue(env.adminQueue, 'حجز-ملتزم', { maxAttempts: 1 });
    const log = memoryLog();
    const { worker, runs } = countingWorker(env, 'عامل-الحجز', noHalt);
    const recovery = createDatabaseRecovery({
      pool: env.workerPool,
      queue: env.queue,
      worker: 'عامل-الحجز',
      haltGuard: noHalt,
      log,
      policy: FAST_POLICY,
      bootAt: new Date(Date.now() - 1_000),
    });

    const severed = env.proxy.severOn(CLAIM_SQL, { mode: 'after-commit', thenDown: true });
    const fault = await rejection(() => worker.tick());
    await severed;
    assert.ok(fault instanceof WorkerDatabaseFault);
    assert.equal(fault.phase, TICK_PHASES.CLAIM);
    assert.equal(fault.taskId, null, 'الردُّ لم يبلغ العامل فلا يعرف المهمّة');

    // الخطر قبل الإصلاح، مقيساً: المهمّة جاريةٌ بعقدِ عاملٍ لا يعرفها، ومحاولتها الوحيدة مُستهلكة.
    const dangling = await row(env.admin, task.id);
    assert.equal(dangling.state, TaskLifecycle.RUNNING);
    assert.equal(dangling.lease_owner, 'عامل-الحجز');
    assert.equal(dangling.attempts, 1);

    env.later(() => env.proxy.up(), 150);
    const outcome = await recovery.recover(fault);
    assert.equal(outcome.verdict, RECOVERY_VERDICTS.RECOVERED, JSON.stringify(outcome));
    assert.ok(outcome.probes >= 2, 'الاستردادُ انتظر عودةَ القاعدة');
    assert.deepEqual(
      outcome.reconciled.map((entry) => entry.outcome),
      ['released-orphan-claim'],
    );
    const released = await row(env.admin, task.id);
    assert.equal(released.state, TaskLifecycle.SCHEDULED);
    assert.equal(released.attempts, 0, 'المحاولةُ التي لم تُحاوَل لا تُحسب');
    assert.equal(released.error_code, UNSTARTED_RELEASE_CODE);

    const tick = await worker.tick();
    assert.equal(tick.outcome, 'done');
    assert.equal(runs.count, 1, 'المُعالِجُ نُفِّذ مرّةً واحدة');
    assert.equal(await successTransitions(env.admin, task.id), 1);

    assert.deepEqual(
      log.events.map((event) => event.type),
      ['kernel.worker.db-fault', 'kernel.worker.db-recovery'],
    );
    assert.equal(log.events[1]?.data['verdict'], RECOVERY_VERDICTS.RECOVERED);
  },
);

test(
  'حدُّ الحجز: حجزٌ لم يُلتزَم لا يُفرَج فيه عن شيء ولا يُخترع له يتيم',
  { skip: skipWithoutDatabase },
  async (t) => {
    const env = await environment(t);
    const task = await enqueue(env.adminQueue, 'حجز-غير-ملتزم');
    const { worker, runs } = countingWorker(env, 'عامل-لا-التزام', noHalt);
    const recovery = createDatabaseRecovery({
      pool: env.workerPool,
      queue: env.queue,
      worker: 'عامل-لا-التزام',
      haltGuard: noHalt,
      log: memoryLog(),
      policy: FAST_POLICY,
    });
    const severed = env.proxy.severOn(CLAIM_SQL, { mode: 'before', thenDown: true });
    const fault = await rejection(() => worker.tick());
    await severed;
    assert.ok(fault instanceof WorkerDatabaseFault);
    assert.equal((await row(env.admin, task.id)).state, TaskLifecycle.SCHEDULED);

    env.later(() => env.proxy.up(), 100);
    const outcome = await recovery.recover(fault);
    assert.equal(outcome.verdict, RECOVERY_VERDICTS.RECOVERED);
    assert.deepEqual(outcome.reconciled, []);
    assert.equal((await worker.tick()).outcome, 'done');
    assert.equal(runs.count, 1);
    assert.equal((await row(env.admin, task.id)).attempts, 1);
  },
);

// ─── (4) حدُّ الكتابة: الأثرُ وقع ─────────────────────────────────────────

test(
  'حدُّ الكتابة: نجاحٌ التُزم وضاع ردُّه يُثبَت بالبصمة ولا يُكتب ثانيةً ولا يُعاد تشغيله',
  { skip: skipWithoutDatabase },
  async (t) => {
    const env = await environment(t);
    const task = await enqueue(env.adminQueue, 'نجاح-ملتزم');
    const log = memoryLog();
    const { worker, runs } = countingWorker(env, 'عامل-نجاح-ملتزم', noHalt);
    const recovery = createDatabaseRecovery({
      pool: env.workerPool,
      queue: env.queue,
      worker: 'عامل-نجاح-ملتزم',
      haltGuard: noHalt,
      log,
      policy: FAST_POLICY,
    });
    const severed = env.proxy.severOn(SUCCEEDED_SQL, { mode: 'after-commit', thenDown: true });
    const fault = await rejection(() => worker.tick());
    await severed;
    assert.ok(fault instanceof WorkerDatabaseFault);
    assert.equal(fault.phase, TICK_PHASES.RECORD);
    assert.equal(fault.taskId, task.id);
    assert.equal(fault.pending?.op, 'succeed');
    assert.equal((await row(env.admin, task.id)).state, TaskLifecycle.SUCCEEDED, 'التُزم فعلاً');

    env.later(() => env.proxy.up(), 100);
    const outcome = await recovery.recover(fault);
    assert.equal(outcome.verdict, RECOVERY_VERDICTS.RECOVERED, JSON.stringify(outcome));
    assert.deepEqual(outcome.reconciled, [
      { taskId: task.id, outcome: 'already-committed', verified: true },
    ]);
    assert.equal(runs.count, 1);
    assert.equal(await successTransitions(env.admin, task.id), 1, 'لا كتابةَ ثانية');
    assert.equal(log.events[1]?.data['pendingDigest'], pendingResultDigest(fault));
    assert.equal((await worker.tick()).outcome, 'idle');
  },
);

test(
  'حدُّ الكتابة: نجاحٌ لم يُلتزَم تُكتب نتيجتُه نفسُها بعد العودة — بلا إعادةِ تشغيل',
  { skip: skipWithoutDatabase },
  async (t) => {
    const env = await environment(t);
    const task = await enqueue(env.adminQueue, 'نجاح-غير-ملتزم');
    const { worker, runs } = countingWorker(env, 'عامل-إعادة-كتابة', noHalt);
    const recovery = createDatabaseRecovery({
      pool: env.workerPool,
      queue: env.queue,
      worker: 'عامل-إعادة-كتابة',
      haltGuard: noHalt,
      log: memoryLog(),
      policy: FAST_POLICY,
    });
    const severed = env.proxy.severOn(SUCCEEDED_SQL, { mode: 'before', thenDown: true });
    const fault = await rejection(() => worker.tick());
    await severed;
    assert.ok(fault instanceof WorkerDatabaseFault);
    const before = await row(env.admin, task.id);
    assert.equal(before.state, TaskLifecycle.RUNNING);
    assert.equal(before.lease_owner, 'عامل-إعادة-كتابة');

    env.later(() => env.proxy.up(), 100);
    const outcome = await recovery.recover(fault);
    assert.equal(outcome.verdict, RECOVERY_VERDICTS.RECOVERED);
    assert.equal(outcome.reconciled[0]?.outcome, 'rewritten');
    const after = await row(env.admin, task.id);
    assert.equal(after.state, TaskLifecycle.SUCCEEDED);
    assert.equal(resultDigest(after.result), pendingResultDigest(fault));
    assert.equal(runs.count, 1, 'الأثرُ لم يتكرّر');
    assert.equal(await successTransitions(env.admin, task.id), 1);
  },
);

// ─── (5) الفشلُ أثناء الاسترداد ────────────────────────────────────────────

test(
  'فشلٌ أثناء الاسترداد: انقطاعٌ ثانٍ في التسوية يعود إلى المسابير ثم يُسوّى بلا تكرار',
  { skip: skipWithoutDatabase },
  async (t) => {
    const env = await environment(t);
    const task = await enqueue(env.adminQueue, 'انقطاع-مزدوج');
    const log = memoryLog();
    const { worker, runs } = countingWorker(env, 'عامل-مزدوج', noHalt);
    const recovery = createDatabaseRecovery({
      pool: env.workerPool,
      queue: env.queue,
      worker: 'عامل-مزدوج',
      haltGuard: noHalt,
      log,
      policy: FAST_POLICY,
    });
    const first = env.proxy.severOn(SUCCEEDED_SQL, { mode: 'before', thenDown: true });
    const fault = await rejection(() => worker.tick());
    await first;
    assert.ok(fault instanceof WorkerDatabaseFault);

    // تعود القاعدة، فتنقطع ثانيةً عند كتابةِ التسويةِ نفسِها، ثم تعود.
    void env.proxy
      .severOn(SUCCEEDED_SQL, { mode: 'before', thenDown: true })
      .then(() => env.later(() => env.proxy.up(), 150));
    env.later(() => env.proxy.up(), 80);

    const outcome = await recovery.recover(fault);
    assert.equal(outcome.verdict, RECOVERY_VERDICTS.RECOVERED, JSON.stringify(outcome));
    assert.ok(outcome.probes >= 3, `مسابير: ${outcome.probes}`);
    assert.equal((await row(env.admin, task.id)).state, TaskLifecycle.SUCCEEDED);
    assert.equal(runs.count, 1);
    assert.equal(await successTransitions(env.admin, task.id), 1);
    assert.equal(
      log.events.filter((event) => event.type === 'kernel.worker.db-fault').length,
      1,
      'عطبٌ واحدٌ يُقيَّد مرّةً واحدة',
    );
  },
);

test(
  'نفادُ الميزانية: قاعدةٌ لا تعود ⇒ failed برمز 75، والمهمّةُ كما هي، والأدلّةُ مقيَّدة',
  { skip: skipWithoutDatabase },
  async (t) => {
    const env = await environment(t);
    const task = await enqueue(env.adminQueue, 'ميزانية-نافدة');
    const log = memoryLog();
    const { worker, runs } = countingWorker(env, 'عامل-نافد', noHalt);
    const recovery = createDatabaseRecovery({
      pool: env.workerPool,
      queue: env.queue,
      worker: 'عامل-نافد',
      haltGuard: noHalt,
      log,
      policy: { maxProbes: 3, baseDelayMs: 10, maxDelayMs: 20 },
    });
    const severed = env.proxy.severOn(SUCCEEDED_SQL, { mode: 'before', thenDown: true });
    const fault = await rejection(() => worker.tick());
    await severed;
    assert.ok(fault instanceof WorkerDatabaseFault);

    const outcome = await recovery.recover(fault);
    assert.equal(outcome.verdict, RECOVERY_VERDICTS.FAILED);
    assert.equal(outcome.reason, RECOVERY_REASONS.BUDGET_EXHAUSTED);
    assert.equal(outcome.exitCode, RECOVERY_EXIT_CODES.DB_UNAVAILABLE);
    assert.equal(outcome.probes, 3);
    const kept = await row(env.admin, task.id);
    assert.equal(kept.state, TaskLifecycle.RUNNING, 'لا شيءَ كُتب ولا شيءَ فُقد');
    assert.equal(kept.lease_owner, 'عامل-نافد');
    assert.equal(runs.count, 1);
    const verdict = log.events[1]?.data;
    assert.equal(verdict?.['verdict'], 'failed');
    assert.equal(verdict?.['taskId'], task.id, 'الدليلُ يسمّي المهمّةَ المعلّقة');
    assert.equal(verdict?.['pendingDigest'], pendingResultDigest(fault));
  },
);

// ─── (6) الفسادُ والقاعدةُ المختلفة ─────────────────────────────────────────

test(
  'فسادٌ لا تعذّر: خطأُ سلامةٍ ⇒ failed فوراً بلا مسبارٍ ولا كتابة',
  { skip: skipWithoutDatabase },
  async (t) => {
    const env = await environment(t);
    const recovery = createDatabaseRecovery({
      pool: env.workerPool,
      queue: env.queue,
      worker: 'عامل-فساد',
      haltGuard: noHalt,
      log: memoryLog(),
      policy: FAST_POLICY,
    });
    const fault = new WorkerDatabaseFault({
      worker: 'عامل-فساد',
      phase: TICK_PHASES.CLAIM,
      taskId: null,
      pending: null,
      fault: { kind: DB_FAULT_KINDS.INTEGRITY, code: 'XX001' },
      cause: null,
      at: new Date(),
    });
    const connectionsBefore = env.proxy.connections;
    const outcome = await recovery.recover(fault);
    assert.equal(outcome.verdict, RECOVERY_VERDICTS.FAILED);
    assert.equal(outcome.reason, RECOVERY_REASONS.NOT_TRANSIENT);
    assert.equal(outcome.exitCode, RECOVERY_EXIT_CODES.DB_INTEGRITY);
    assert.equal(outcome.probes, 0);
    assert.equal(env.proxy.connections, connectionsBefore, 'لم يُلمس القاعدةُ أصلاً');
  },
);

test(
  'قاعدةٌ عادت بلا جداولِ الطابور ⇒ لا تُعَدُّ عودة: failed، ولا كتابة، والبياناتُ محفوظة',
  { skip: skipWithoutDatabase },
  async (t) => {
    const env = await environment(t);
    const task = await enqueue(env.adminQueue, 'مخطط-غائب');
    const { worker, runs } = countingWorker(env, 'عامل-مخطط', noHalt);
    const recovery = createDatabaseRecovery({
      pool: env.workerPool,
      queue: env.queue,
      worker: 'عامل-مخطط',
      haltGuard: noHalt,
      log: memoryLog(),
      policy: FAST_POLICY,
    });
    const severed = env.proxy.severOn(SUCCEEDED_SQL, { mode: 'before', thenDown: true });
    const fault = await rejection(() => worker.tick());
    await severed;
    assert.ok(fault instanceof WorkerDatabaseFault);

    // تعود «قاعدةٌ» بلا مخطّطِ الطابور — كاستعادةٍ إلى قاعدةٍ فارغة أو غير مهاجَرة.
    await env.admin.query('ALTER SCHEMA state RENAME TO state_wl387_hidden');
    t.after(async () => {
      await env.admin
        .query('ALTER SCHEMA state_wl387_hidden RENAME TO state')
        .catch(() => undefined);
    });
    await env.proxy.up();

    const outcome = await recovery.recover(fault);
    assert.equal(outcome.verdict, RECOVERY_VERDICTS.FAILED);
    assert.equal(outcome.reason, RECOVERY_REASONS.SCHEMA_MISSING);
    assert.equal(outcome.exitCode, RECOVERY_EXIT_CODES.DB_INTEGRITY);

    await env.admin.query('ALTER SCHEMA state_wl387_hidden RENAME TO state');
    const kept = await row(env.admin, task.id);
    assert.equal(kept.state, TaskLifecycle.RUNNING, 'لم يُكتب شيء في القاعدة البديلة ولا الأصلية');
    assert.equal(runs.count, 1);
  },
);

test(
  'قاعدةٌ غيرُ مهاجَرة منذ الإقلاع ⇒ العطبُ integrity لا unavailable، والعاملُ لا ينتظر',
  { skip: skipWithoutDatabase },
  async (t) => {
    const env = await environment(t, { migrate: false });
    const { worker } = countingWorker(env, 'عامل-بلا-مخطط', noHalt);
    const fault = await rejection(() => worker.tick());
    assert.ok(fault instanceof WorkerDatabaseFault);
    assert.equal(fault.fault.kind, DB_FAULT_KINDS.INTEGRITY);
    assert.equal(fault.fault.code, '42P01');
    const outcome = await createDatabaseRecovery({
      pool: env.workerPool,
      queue: env.queue,
      worker: 'عامل-بلا-مخطط',
      haltGuard: noHalt,
      log: memoryLog(),
      policy: FAST_POLICY,
    }).recover(fault);
    assert.equal(outcome.verdict, RECOVERY_VERDICTS.FAILED);
    assert.equal(outcome.probes, 0);
  },
);

// ─── (7) السيادةُ والعقود ──────────────────────────────────────────────────

test(
  'الإيقافُ السياديُّ يعلو الاسترداد: لا كتابةَ ما دام قائماً، ثم تسويةٌ بعد الاستئناف',
  { skip: skipWithoutDatabase },
  async (t) => {
    const env = await environment(t);
    const task = await enqueue(env.adminQueue, 'إيقاف-أثناء-انقطاع');
    const { halt, royalCommand } = haltSwitchIn(env.dir);
    const log = memoryLog();
    const { worker, runs } = countingWorker(env, 'عامل-سيادي', halt);
    const recovery = createDatabaseRecovery({
      pool: env.workerPool,
      queue: env.queue,
      worker: 'عامل-سيادي',
      haltGuard: halt,
      log,
      policy: FAST_POLICY,
    });
    const severed = env.proxy.severOn(SUCCEEDED_SQL, { mode: 'before', thenDown: true });
    const fault = await rejection(() => worker.tick());
    await severed;
    assert.ok(fault instanceof WorkerDatabaseFault);

    halt.halt('إيقافٌ سياديٌّ أثناء انقطاع القاعدة — WL-387', royalCommand);
    await env.proxy.up();

    const deferred = await recovery.recover(fault);
    assert.equal(deferred.verdict, RECOVERY_VERDICTS.UNVERIFIED);
    assert.equal(deferred.reason, RECOVERY_REASONS.HALT_ACTIVE);
    assert.equal(deferred.retry, true);
    const again = await recovery.recover(fault);
    assert.equal(again.reason, RECOVERY_REASONS.HALT_ACTIVE);
    const held = await row(env.admin, task.id);
    assert.equal(held.state, TaskLifecycle.RUNNING, 'لا كتابةَ تحت الإيقاف');
    assert.equal(await successTransitions(env.admin, task.id), 0);
    assert.equal(
      log.events.filter((event) => event.type === 'kernel.worker.db-recovery').length,
      1,
      'التأجيلُ يُقيَّد مرّةً لا في كلِّ مسبار',
    );

    halt.resume('استئنافٌ بعد إيقافٍ أثناء الانقطاع', royalCommand);
    const recovered = await recovery.recover(fault);
    assert.equal(recovered.verdict, RECOVERY_VERDICTS.RECOVERED);
    assert.equal((await row(env.admin, task.id)).state, TaskLifecycle.SUCCEEDED);
    assert.equal(runs.count, 1);
  },
);

test(
  'عقدٌ فُقد أثناء الانقطاع: لا كتابةَ فوقَ عقدِ غيرِنا، والحكمُ unverified لا recovered',
  { skip: skipWithoutDatabase },
  async (t) => {
    const env = await environment(t);
    const task = await enqueue(env.adminQueue, 'عقد-مفقود');
    const { worker, runs } = countingWorker(env, 'عامل-فاقد', noHalt);
    const recovery = createDatabaseRecovery({
      pool: env.workerPool,
      queue: env.queue,
      worker: 'عامل-فاقد',
      haltGuard: noHalt,
      log: memoryLog(),
      policy: FAST_POLICY,
    });
    const severed = env.proxy.severOn(SUCCEEDED_SQL, { mode: 'before', thenDown: true });
    const fault = await rejection(() => worker.tick());
    await severed;
    assert.ok(fault instanceof WorkerDatabaseFault);

    // أثناء الانقطاع: ينتهي العقد، فيستعيده حاصدٌ، ويحجزه عاملٌ آخر.
    await env.admin.query(
      `UPDATE state.tasks SET lease_expires_at = now() - interval '1 second' WHERE id = $1`,
      [task.id],
    );
    await env.adminQueue.reclaimExpired({ actor: 'حاصد-اختبار' });
    await env.admin.query(
      `UPDATE state.tasks SET available_at = now() - interval '1 second' WHERE id = $1`,
      [task.id],
    );
    const [other] = await env.adminQueue.claim({ worker: 'عامل-آخر', limit: 1 });
    assert.equal(other?.id, task.id);
    await env.proxy.up();

    const outcome = await recovery.recover(fault);
    assert.equal(outcome.verdict, RECOVERY_VERDICTS.UNVERIFIED);
    assert.equal(outcome.reason, RECOVERY_REASONS.LEASE_LOST);
    const now = await row(env.admin, task.id);
    assert.equal(now.state, TaskLifecycle.RUNNING);
    assert.equal(now.lease_owner, 'عامل-آخر', 'عقدُ الآخر لم يُمسّ');
    assert.equal(await successTransitions(env.admin, task.id), 0);
    assert.equal(runs.count, 1);
  },
);

test(
  'الإفراجُ عن حجزٍ لم يبدأ يرفضُ حجزاً من حياةٍ سابقة للعامل نفسه',
  { skip: skipWithoutDatabase },
  async (t) => {
    const env = await environment(t);
    const task = await enqueue(env.adminQueue, 'حياة-سابقة');
    const [claimed] = await env.adminQueue.claim({ worker: 'عامل-عائد', limit: 1 });
    assert.equal(claimed?.id, task.id);
    const error = await rejection(() =>
      env.adminQueue.releaseUnstarted({
        taskId: task.id,
        worker: 'عامل-عائد',
        reason: 'محاولة إفراج عن حجز سابق للإقلاع',
        claimedAfter: new Date(Date.now() + 60_000),
      }),
    );
    assert.ok(error instanceof QueueError);
    assert.equal(error.code, 'TASK_LEASE_LOST');
    assert.equal((await row(env.admin, task.id)).attempts, 1, 'المحاولةُ لم تُرجَع');
  },
);

// ─── (8) المسارُ المختوم ───────────────────────────────────────────────────

/**
 * توكنٌ مُحقَن (كـ`wl-304`): ختمٌ حقيقيٌّ AES-256-GCM بلا عتادٍ في الاختبار.
 * @param {import('node:crypto').KeyPairKeyObjectResult} king
 * @param {Buffer} aeadKey
 * @param {import('node:crypto').KeyPairKeyObjectResult} ledgerPair
 */
function injectedToken(king, aeadKey, ledgerPair) {
  const aad = Buffer.from('xuux-event');
  const ed = new Map([
    ['06', king],
    ['07', ledgerPair],
  ]);
  return {
    describe: () => ({ kind: 'pkcs11-hsm', canExport: false, tokenSerial: 'DEADBEEFCAFE0001' }),
    getAeadKey: async (/** @type {string} */ keyId) => {
      if (keyId !== '05') throw new Error('KEY_NOT_FOUND');
      return {
        keyId,
        encrypt: async (/** @type {Buffer} */ plaintext) => {
          const iv = randomBytes(12);
          const cipher = createCipheriv('aes-256-gcm', aeadKey, iv);
          cipher.setAAD(aad);
          return {
            ciphertext: Buffer.concat([cipher.update(plaintext), cipher.final()]),
            iv,
            tag: cipher.getAuthTag(),
          };
        },
        decrypt: async (
          /** @type {Buffer} */ ciphertext,
          /** @type {Buffer} */ iv,
          /** @type {Buffer} */ tag,
        ) => {
          const decipher = createDecipheriv('aes-256-gcm', aeadKey, iv);
          decipher.setAAD(aad);
          decipher.setAuthTag(tag);
          return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
        },
      };
    },
    getSigningKey: async (/** @type {string} */ keyId) => {
      const pair = ed.get(keyId);
      if (!pair) throw new Error('KEY_NOT_FOUND');
      return {
        keyId,
        sign: async (/** @type {Buffer} */ message) => softwareSign(null, message, pair.privateKey),
        exportPublicPem: async () => String(pair.publicKey.export({ type: 'spki', format: 'pem' })),
      };
    },
  };
}

test(
  'المسارُ المختوم: قيدُ الاسترداد يُختم كقيدِ العزل — لا نصَّ ظاهراً على القرص ويُفتح بالمفتاح',
  { skip: skipWithoutDatabase },
  async (t) => {
    const env = await environment(t);
    const king = registerTestKing(generateKeyPairSync('ed25519'));
    const ledgerPair = registerTestKing(generateKeyPairSync('ed25519'));
    const aeadKey = randomBytes(32);
    const royal = royalKeyEnv();
    const productionEnv = {
      NODE_ENV: 'production',
      STATE_ENV: 'production',
      XUUX_ROOT_OF_TRUST_MODE: 'hsm',
      XUUX_PKCS11_MODULE: '/usr/lib/softhsm/libsofthsm2.so',
      XUUX_PKCS11_TOKEN: 'xuux-test',
      XUUX_PKCS11_TOKEN_SERIAL: 'DEADBEEFCAFE0001',
      XUUX_PKCS11_MODULE_SHA256: 'f'.repeat(64),
      XUUX_PKCS11_PIN: 'unused-by-injected-source',
      XUUX_KING_ID: 'king:' + fingerprint(king.publicKey).slice(0, 24),
      ...royal.env,
    };
    const file = path.join(env.dir, 'sealed-worker-events.jsonl');
    const sealed = await openProductionEventLog(
      productionEnv,
      file,
      {
        openSource: async () => ({
          source: injectedToken(king, aeadKey, ledgerPair),
          close: async () => undefined,
        }),
      },
      { fsync: false },
    );
    t.after(async () => {
      sealed.log.close();
      await sealed.close();
    });
    assert.equal(sealed.log.sealed, true);

    const task = await enqueue(env.adminQueue, 'مسار-مختوم');
    const { worker } = countingWorker(env, 'عامل-مختوم', noHalt);
    const recovery = createDatabaseRecovery({
      pool: env.workerPool,
      queue: env.queue,
      worker: 'عامل-مختوم',
      haltGuard: noHalt,
      log: sealed.sink,
      policy: { maxProbes: 2, baseDelayMs: 10, maxDelayMs: 10 },
    });
    const severed = env.proxy.severOn(SUCCEEDED_SQL, { mode: 'before', thenDown: true });
    const fault = await rejection(() => worker.tick());
    await severed;
    assert.ok(fault instanceof WorkerDatabaseFault);
    const outcome = await recovery.recover(fault);
    assert.equal(outcome.verdict, RECOVERY_VERDICTS.FAILED);
    await sealed.sink.drain();

    const onDisk = readFileSync(file, 'utf8');
    // الحمولةُ مختومة: المهمّةُ والسببُ وبصمةُ النتيجة لا تظهر. والنوعُ والفاعلُ غلافٌ
    // ظاهرٌ بتصميمِ السجلِّ المختوم نفسِه (كقيودِ العزل) — لا يُدّعى هنا غيرُ ذلك.
    const digest = pendingResultDigest(fault);
    for (const visible of [task.id, RECOVERY_REASONS.BUDGET_EXHAUSTED, digest, 'pendingDigest']) {
      assert.ok(!onDisk.includes(visible), `نصٌّ ظاهرٌ على القرص: ${visible}`);
    }
    const events = sealed.log.snapshot();
    const types = events.map((event) => event.type);
    assert.ok(types.includes('kernel.worker.db-fault'), `الأنواع: ${types.join(',')}`);
    const last = events.find((event) => event.type === 'kernel.worker.db-recovery');
    assert.ok(last !== undefined);
    const opened = /** @type {Record<string, unknown>} */ (await sealed.log.openEvent(last));
    assert.equal(opened['verdict'], RECOVERY_VERDICTS.FAILED);
    assert.equal(opened['taskId'], task.id);
  },
);

// ─── (9) العمليةُ الحقيقية: `scripts/worker.mjs` ───────────────────────────

/**
 * يُشغّل العاملَ عمليةً مستقلّة بمفتاحِ الملكِ العامِّ في البيئة (`HALT_PUBLIC_KEY`)
 * — كما يُقلع في التشغيل — ويُرجع وعداً بخروجه ومخرجاتِه.
 * @param {Awaited<ReturnType<typeof environment>>} env
 * @param {KingIdentity} king
 * @param {string} haltFile
 * @param {string[]} args
 */
function spawnWorker(env, king, haltFile, args) {
  const isolationLog = path.join(env.dir, `worker-${randomUUID()}.jsonl`);
  // جذرُ مخرجاتِ العزلِ يجب أن يكون ابناً من مجلّد العمل (حدُّ العزل نفسُه)، فيُفرَد
  // لكلِّ تشغيلٍ مجلّدٌ تحت `.isolation-output/` ويُزال بعده.
  const outputRoot = path.join(ROOT, '.isolation-output', `wl387-${randomUUID()}`);
  const child = spawn(process.execPath, [WORKER_SCRIPT, ...args], {
    cwd: ROOT,
    env: {
      ...process.env,
      NODE_ENV: 'test',
      STATE_ENV: 'ci',
      DATABASE_URL: env.url,
      HALT_FILE: haltFile,
      HALT_PUBLIC_KEY: String(king.publicKey.export({ type: 'spki', format: 'pem' })),
      ISOLATION_LOG_FILE: isolationLog,
      ISOLATION_OUTPUT_ROOT: outputRoot,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => {
    stdout += String(chunk);
  });
  child.stderr.on('data', (chunk) => {
    stderr += String(chunk);
  });
  const exited = new Promise((resolve) => {
    child.on('exit', (code) => resolve({ code, stdout, stderr }));
  });
  return {
    child,
    isolationLog,
    outputRoot,
    /** @returns {Promise<{ code: number | null, stdout: string, stderr: string }>} */
    exited: () =>
      /** @type {Promise<{ code: number | null, stdout: string, stderr: string }>} */ (exited),
    output: () => stdout,
    /** @returns {Array<{ type: string, data: Record<string, unknown> }>} */
    events() {
      if (!existsSync(isolationLog)) return [];
      const log = new PersistentEventLog(isolationLog);
      try {
        return log.snapshot().map((event) => ({
          type: event.type,
          data: /** @type {Record<string, unknown>} */ (event.data),
        }));
      } finally {
        log.close();
      }
    },
  };
}

/**
 * المهمّةُ عولجت بعد الاسترداد مرّةً واحدة — وحكمُ العزلِ يتبعُ المضيفَ المقيس لا يُفترض:
 * مضيفٌ بمساحاتِ أسماءٍ ⇒ نجاح؛ ومضيفٌ بلاها (مُشغِّلُ CI) ⇒ رفضٌ مغلقٌ `ISOLATION_UNSUPPORTED`
 * يُعيدُ المهمّةَ إلى الطابور. كلاهما دليلُ أنّ العاملَ عاد يحجزُ ويُعالج؛ ولا نجاحَ يُخترع
 * حيث العزلُ غائب، ولا تخطٍّ يُخفي الاختبار.
 * @param {Awaited<ReturnType<typeof row>>} final
 * @param {string} context
 */
function assertProcessedOnce(final, context) {
  assert.equal(final.attempts, 1, context);
  if (probeIsolation().available) {
    assert.equal(final.state, TaskLifecycle.SUCCEEDED, context);
  } else {
    assert.equal(final.state, TaskLifecycle.SCHEDULED, context);
    assert.equal(final.error_code, 'ISOLATION_UNSUPPORTED', context);
  }
}

/** @param {() => boolean} predicate @param {number} timeoutMs */
async function until(predicate, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await abortableSleep(25, undefined);
  }
  throw new Error('انقضت المهلةُ قبل تحقّق الشرط.');
}

test(
  'العمليةُ الحقيقية: قاعدةٌ متوقّفةٌ قبل إقلاع العامل ⇒ ينتظر، يستردّ، يُنفّذ، ويخرج سليماً',
  { skip: skipWithoutDatabase, timeout: 60_000 },
  async (t) => {
    const env = await environment(t);
    const task = await enqueue(env.adminQueue, 'عملية-قبل-الإقلاع', ISOLATED_TASK);
    const { king, file } = haltSwitchIn(env.dir);
    // القاعدة متوقّفةٌ **قبل** أن يُقلع العامل — لا بعده.
    await env.proxy.down();
    const run = spawnWorker(env, king, file, [
      '--worker',
      'عامل-عملية',
      '--max-tasks',
      '1',
      '--poll-ms',
      '50',
      '--db-recovery-max-probes',
      '200',
      '--db-recovery-base-ms',
      '20',
      '--db-recovery-max-ms',
      '100',
    ]);
    t.after(() => {
      if (run.child.exitCode === null) run.child.kill('SIGKILL');
      rmSync(run.outputRoot, { recursive: true, force: true });
    });
    await until(() => run.output().includes('db-fault'), 15_000);
    await env.proxy.up();

    const result = await run.exited();
    assert.equal(result.code, 0, `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
    assert.match(result.stdout, /db-recovery \| recovered/);
    const final = await row(env.admin, task.id);
    assertProcessedOnce(final, `${result.stdout}\n${JSON.stringify(final)}`);
    const types = run.events().map((event) => event.type);
    assert.ok(types.includes('kernel.worker.db-fault'), types.join(','));
    const verdict = run.events().find((event) => event.type === 'kernel.worker.db-recovery');
    assert.equal(verdict?.data['verdict'], RECOVERY_VERDICTS.RECOVERED);
  },
);

test(
  'العمليةُ الحقيقية: إيقافٌ سياديٌّ موقَّعٌ والقاعدةُ متوقّفة ⇒ لا تنفيذ حتى الاستئناف',
  { skip: skipWithoutDatabase, timeout: 60_000 },
  async (t) => {
    const env = await environment(t);
    const task = await enqueue(env.adminQueue, 'عملية-تحت-الإيقاف', ISOLATED_TASK);
    const { king, file, halt, royalCommand } = haltSwitchIn(env.dir);
    await env.proxy.down();
    const run = spawnWorker(env, king, file, [
      '--worker',
      'عامل-عملية-سيادي',
      '--max-tasks',
      '1',
      '--poll-ms',
      '50',
      '--db-recovery-base-ms',
      '20',
      '--db-recovery-max-ms',
      '100',
      '--db-recovery-max-probes',
      '200',
    ]);
    t.after(() => {
      if (run.child.exitCode === null) run.child.kill('SIGKILL');
      rmSync(run.outputRoot, { recursive: true, force: true });
    });
    await until(() => run.output().includes('db-fault'), 15_000);
    // الإيقافُ يُوقَّع بمفتاح الملك، والعاملُ يتحقّق منه بالمفتاح العام في بيئته.
    halt.halt('إيقافٌ سياديٌّ والقاعدةُ متوقّفة — WL-387', royalCommand);
    await env.proxy.up();
    await abortableSleep(600, undefined);
    assert.equal(run.child.exitCode, null, 'العاملُ لم يمت ولم يخرج');
    assert.equal(
      (await row(env.admin, task.id)).state,
      TaskLifecycle.SCHEDULED,
      'لا حجزَ ولا تنفيذَ تحت الإيقاف',
    );

    halt.resume('استئنافٌ سياديّ', royalCommand);
    const result = await run.exited();
    assert.equal(result.code, 0, `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
    const final = await row(env.admin, task.id);
    assertProcessedOnce(final, `${result.stdout}\n${JSON.stringify(final)}`);
  },
);

test(
  'العمليةُ الحقيقية: قاعدةٌ لا تعود ⇒ خروجٌ آمنٌ برمز 75 لا 1، وقيدٌ بالحكم',
  { skip: skipWithoutDatabase, timeout: 60_000 },
  async (t) => {
    const env = await environment(t);
    const task = await enqueue(env.adminQueue, 'عملية-بلا-عودة');
    const { king, file } = haltSwitchIn(env.dir);
    await env.proxy.down();
    const run = spawnWorker(env, king, file, [
      '--worker',
      'عامل-بلا-عودة',
      '--db-recovery-max-probes',
      '3',
      '--db-recovery-base-ms',
      '20',
      '--db-recovery-max-ms',
      '40',
    ]);
    t.after(() => {
      if (run.child.exitCode === null) run.child.kill('SIGKILL');
      rmSync(run.outputRoot, { recursive: true, force: true });
    });
    const result = await run.exited();
    assert.equal(result.code, RECOVERY_EXIT_CODES.DB_UNAVAILABLE, result.stderr);
    assert.match(result.stderr, /حدٍّ آمن/);
    assert.equal((await row(env.admin, task.id)).state, TaskLifecycle.SCHEDULED);
    const verdict = run.events().find((event) => event.type === 'kernel.worker.db-recovery');
    assert.equal(verdict?.data['verdict'], RECOVERY_VERDICTS.FAILED);
    assert.equal(verdict?.data['reason'], RECOVERY_REASONS.BUDGET_EXHAUSTED);
  },
);

test(
  'العمليةُ الحقيقية: SIGTERM أثناء الاسترداد يقطع الانتظار فوراً ويُقيَّد unverified',
  { skip: skipWithoutDatabase, timeout: 60_000 },
  async (t) => {
    const env = await environment(t);
    const { king, file } = haltSwitchIn(env.dir);
    await env.proxy.down();
    const run = spawnWorker(env, king, file, [
      '--worker',
      'عامل-مُنهى',
      '--db-recovery-max-probes',
      '100',
      '--db-recovery-base-ms',
      '5000',
      '--db-recovery-max-ms',
      '5000',
    ]);
    t.after(() => {
      if (run.child.exitCode === null) run.child.kill('SIGKILL');
      rmSync(run.outputRoot, { recursive: true, force: true });
    });
    await until(() => run.output().includes('db-fault'), 15_000);
    const signalledAt = Date.now();
    run.child.kill('SIGTERM');
    const result = await run.exited();
    assert.ok(Date.now() - signalledAt < 3_000, 'مؤقّتُ المسبار لم يُبقِ العملية حيّة');
    assert.equal(result.code, RECOVERY_EXIT_CODES.DB_UNAVAILABLE);
    const verdict = run.events().find((event) => event.type === 'kernel.worker.db-recovery');
    assert.equal(verdict?.data['verdict'], RECOVERY_VERDICTS.UNVERIFIED);
    assert.equal(verdict?.data['reason'], RECOVERY_REASONS.STOPPED);
  },
);

// ─── (8) حدُّ رفضِ الميزانية: القرارُ الملتزَمُ لا يُقلَب بضياعِ ردِّه ──────────

/** موردٌ معلنٌ في `config/quotas.yaml`؛ حدُّه من السياسة لا رقمٌ مُختلق. */
const BUDGET_RESOURCE = 'task-executions';
/** رسالةُ الرفضِ الميتةُ تُكتب في معاملةِ `queue.fail()` نفسِها ولا تُكتب في غيرها. */
const DEAD_LETTER_SQL = 'INSERT INTO state.task_dead_letters';
/** خصمُ الدفتر: استعلامٌ ذاتيُّ الالتزام بعد علامةِ الخصم على المهمّة. */
const QUOTA_DEBIT_SQL = 'INSERT INTO state.quotas';
const BUDGET_ACTOR = 'actor-db-recovery-budget';

/**
 * بيئةُ ميزانيةٍ حقيقيّة: دفترُ حصصٍ على القاعدةِ نفسِها بساعةٍ يُحرّكها الاختبار،
 * وفاعلٌ استُهلك من حصّته حتى لا يبقى إلا وحدةٌ واحدة — فمهمّةٌ بوحدتين تُرفض الآن
 * وتُقبل لو أُعيدت بعد انقضاءِ النافذة. هذا هو الخطرُ لا افتراضه.
 * @param {Awaited<ReturnType<typeof environment>>} env
 */
async function budgetSetup(env) {
  const definitions = loadPolicyBundle().quotas;
  const declared = definitions.find((entry) => entry.resource === BUDGET_RESOURCE);
  assert.ok(declared !== undefined, `المورد ${BUDGET_RESOURCE} غير معلن`);
  const clock = { at: new Date() };
  const now = () => clock.at;
  const workerLedger = createQuotaLedger({ pool: env.workerPool, definitions, now });
  const adminLedger = createQuotaLedger({ pool: env.admin, definitions, now });
  await adminLedger.debit({
    subjectType: 'agent',
    subjectId: BUDGET_ACTOR,
    resource: BUDGET_RESOURCE,
    amount: declared.limit - 1,
  });
  return { clock, declared, workerLedger, windowMs: declared.windowSeconds * 1000 };
}

/**
 * @param {Awaited<ReturnType<typeof environment>>} env
 * @param {string} name
 * @param {{ debit: Function, read: Function }} ledger
 * @param {{ assertOperational(): void }} [haltGuard]
 */
function budgetWorker(env, name, ledger, haltGuard = noHalt) {
  const runs = { count: 0 };
  const worker = createWorker({
    queue: env.queue,
    pool: env.workerPool,
    haltGuard,
    ledger,
    worker: name,
    onRun: () => {
      runs.count += 1;
    },
  });
  return { worker, runs };
}

/**
 * الشهادةُ الماليّةُ والقراريّةُ من القاعدة مباشرةً.
 * @param {import('pg').Pool} admin
 * @param {string} taskId
 */
async function budgetEvidence(admin, taskId) {
  const task = await admin.query(
    `SELECT state, lease_owner, attempts, error_code, budget_debited_at FROM state.tasks WHERE id = $1`,
    [taskId],
  );
  const dead = await admin.query(
    `SELECT error_code FROM state.task_dead_letters WHERE task_id = $1`,
    [taskId],
  );
  const failed = await admin.query(
    `SELECT count(*)::int AS n FROM state.task_transitions WHERE task_id = $1 AND to_state = 'failed'`,
    [taskId],
  );
  const quota = await admin.query(
    `SELECT consumed FROM state.quotas WHERE subject_id = $1 AND resource = $2`,
    [BUDGET_ACTOR, BUDGET_RESOURCE],
  );
  const t0 = /** @type {Record<string, unknown>} */ (task.rows[0]);
  return {
    state: t0['state'],
    leaseOwner: t0['lease_owner'],
    attempts: Number(t0['attempts']),
    errorCode: t0['error_code'],
    budgetDebitedAt: t0['budget_debited_at'],
    deadLetters: dead.rows.map((entry) => entry['error_code']),
    failedTransitions: Number(/** @type {{ n: number }} */ (failed.rows[0]).n),
    consumed: Number(/** @type {Record<string, unknown>} */ (quota.rows[0])['consumed']),
  };
}

/**
 * @param {Awaited<ReturnType<typeof environment>>} env
 * @param {string} name
 */
function recoveryFor(env, name) {
  return createDatabaseRecovery({
    pool: env.workerPool,
    queue: env.queue,
    worker: name,
    haltGuard: noHalt,
    log: memoryLog(),
    policy: FAST_POLICY,
  });
}

/**
 * الحالةُ النهائيّةُ الوحيدةُ المقبولة لمهمّةٍ رُفضت ميزانيتُها: فشلٌ نهائيٌّ برمزِ النفاد،
 * رسالةٌ ميتةٌ واحدة، انتقالٌ واحدٌ إلى `failed`، لا علامةَ خصم، والدفترُ لم يتحرّك.
 * @param {Awaited<ReturnType<typeof budgetEvidence>>} evidence
 * @param {number} consumedBefore
 */
function assertDeniedOnce(evidence, consumedBefore) {
  const context = JSON.stringify(evidence);
  assert.equal(evidence.state, TaskLifecycle.FAILED, context);
  assert.equal(evidence.errorCode, BUDGET_ERRORS.EXHAUSTED, context);
  assert.deepEqual(
    evidence.deadLetters,
    [BUDGET_ERRORS.EXHAUSTED],
    `رسالةٌ ميتةٌ واحدة: ${context}`,
  );
  assert.equal(evidence.failedTransitions, 1, `انتقالُ رفضٍ واحد: ${context}`);
  assert.equal(evidence.budgetDebitedAt, null, `لا علامةَ خصمٍ على مرفوضة: ${context}`);
  assert.equal(evidence.consumed, consumedBefore, `لا أثرَ ماليٌّ إضافيّ: ${context}`);
  assert.equal(evidence.leaseOwner, null, context);
}

test(
  'رفضُ ميزانيةٍ التُزم وضاع ردُّه (وسيطٌ عند ردِّ COMMIT) ⇒ يُعرف من القاعدة بلا كتابةٍ ثانية ولا تشغيل',
  { skip: skipWithoutDatabase },
  async (t) => {
    const env = await environment(t);
    const budget = await budgetSetup(env);
    const task = await enqueue(env.adminQueue, 'رفض-ملتزم', {
      actorId: BUDGET_ACTOR,
      budgetResource: BUDGET_RESOURCE,
      budgetAmount: 2,
    });
    const name = 'عامل-رفض-ملتزم';
    const { worker, runs } = budgetWorker(env, name, budget.workerLedger);
    // المُستردُّ يُنشأ عند الإقلاع كما في `scripts/worker.mjs`: حدُّه الزمنيُّ قبل كلِّ حجز.
    const recovery = recoveryFor(env, name);
    const severed = env.proxy.severOn(DEAD_LETTER_SQL, { mode: 'after-commit', thenDown: true });
    const fault = await rejection(() => worker.tick());
    await severed;
    assert.ok(fault instanceof WorkerDatabaseFault, String(fault));
    assert.equal(fault.phase, TICK_PHASES.PRE_RUN);
    assert.equal(fault.pending?.op, 'fail');
    // الحدُّ حتميّ: القاعدةُ التزمت الرفضَ قبل أن يضيع ردُّه.
    const committed = await budgetEvidence(env.admin, task.id);
    assertDeniedOnce(committed, budget.declared.limit - 1);

    // تمضي النافذة: لو أُعيدت المهمّةُ «حجزاً لم يبدأ» لقُبلت الآن وشُغّلت.
    budget.clock.at = new Date(budget.clock.at.getTime() + budget.windowMs + 1_000);
    env.later(() => env.proxy.up(), 80);
    const outcome = await recovery.recover(fault);
    assert.equal(outcome.verdict, RECOVERY_VERDICTS.RECOVERED, JSON.stringify(outcome));
    assert.equal(outcome.reconciled[0]?.outcome, 'already-committed');
    assert.equal(outcome.reconciled[0]?.verified, true);

    assert.equal((await worker.tick()).outcome, 'idle', 'المرفوضةُ لا تعود قابلةً للحجز');
    assertDeniedOnce(await budgetEvidence(env.admin, task.id), budget.declared.limit - 1);
    assert.equal(runs.count, 0, 'مُعالِجُ مهمّةٍ مرفوضةٍ لم يُشغَّل');
  },
);

test(
  'رفضُ ميزانيةٍ لم يُلتزَم (قطعٌ قبل الكتابة) ⇒ يُكمَل القرارُ نفسُه بعقدِ العامل، لا إفراجَ ولا تشغيل',
  { skip: skipWithoutDatabase },
  async (t) => {
    const env = await environment(t);
    const budget = await budgetSetup(env);
    const task = await enqueue(env.adminQueue, 'رفض-غير-ملتزم', {
      actorId: BUDGET_ACTOR,
      budgetResource: BUDGET_RESOURCE,
      budgetAmount: 2,
    });
    const name = 'عامل-رفض-غير-ملتزم';
    const { worker, runs } = budgetWorker(env, name, budget.workerLedger);
    // المُستردُّ يُنشأ عند الإقلاع كما في `scripts/worker.mjs`: حدُّه الزمنيُّ قبل كلِّ حجز.
    const recovery = recoveryFor(env, name);
    const severed = env.proxy.severOn(DEAD_LETTER_SQL, { mode: 'before', thenDown: true });
    const fault = await rejection(() => worker.tick());
    await severed;
    assert.ok(fault instanceof WorkerDatabaseFault, String(fault));
    assert.equal(fault.phase, TICK_PHASES.PRE_RUN);
    assert.deepEqual(
      { op: fault.pending?.op, code: /** @type {{ code?: string }} */ (fault.pending).code },
      { op: 'fail', code: BUDGET_ERRORS.EXHAUSTED },
    );
    const before = await budgetEvidence(env.admin, task.id);
    assert.equal(before.state, TaskLifecycle.RUNNING, 'المعاملةُ لم تُلتزَم');
    assert.equal(before.leaseOwner, name);
    assert.deepEqual(before.deadLetters, []);

    budget.clock.at = new Date(budget.clock.at.getTime() + budget.windowMs + 1_000);
    env.later(() => env.proxy.up(), 80);
    const outcome = await recovery.recover(fault);
    assert.equal(outcome.verdict, RECOVERY_VERDICTS.RECOVERED, JSON.stringify(outcome));
    assert.equal(outcome.reconciled[0]?.outcome, 'rewritten');
    assert.equal(outcome.reconciled[0]?.verified, true);

    assert.equal((await worker.tick()).outcome, 'idle', 'المرفوضةُ لا تعود قابلةً للحجز');
    const after = await budgetEvidence(env.admin, task.id);
    assertDeniedOnce(after, budget.declared.limit - 1);
    assert.equal(after.attempts, 1, 'محاولةٌ واحدةٌ رُفضت، لا ثانية');
    assert.equal(runs.count, 0, 'مُعالِجُ مهمّةٍ مرفوضةٍ لم يُشغَّل');
  },
);

test(
  'رفضٌ ملتزَمٌ تخالفه القاعدةُ عند العودة ⇒ failed (عدمُ تطابقِ القرار) برمز 65 بلا كتابة',
  { skip: skipWithoutDatabase },
  async (t) => {
    const env = await environment(t);
    const budget = await budgetSetup(env);
    const task = await enqueue(env.adminQueue, 'رفض-مخالف', {
      actorId: BUDGET_ACTOR,
      budgetResource: BUDGET_RESOURCE,
      budgetAmount: 2,
    });
    const name = 'عامل-رفض-مخالف';
    const { worker, runs } = budgetWorker(env, name, budget.workerLedger);
    // المُستردُّ يُنشأ عند الإقلاع كما في `scripts/worker.mjs`: حدُّه الزمنيُّ قبل كلِّ حجز.
    const recovery = recoveryFor(env, name);
    const severed = env.proxy.severOn(DEAD_LETTER_SQL, { mode: 'after-commit', thenDown: true });
    const fault = await rejection(() => worker.tick());
    await severed;
    assert.ok(fault instanceof WorkerDatabaseFault);
    // القاعدةُ عادت تحمل خروجاً بيدِ العامل لا يطابق ما كتبه: لا يُثبَتُ القرار.
    await env.admin.query(`UPDATE state.tasks SET error_code = 'SOMETHING_ELSE' WHERE id = $1`, [
      task.id,
    ]);
    const tampered = await budgetEvidence(env.admin, task.id);

    env.later(() => env.proxy.up(), 80);
    const outcome = await recovery.recover(fault);
    assert.equal(outcome.verdict, RECOVERY_VERDICTS.FAILED, JSON.stringify(outcome));
    assert.equal(outcome.reason, RECOVERY_REASONS.DECISION_MISMATCH);
    assert.equal(outcome.exitCode, RECOVERY_EXIT_CODES.DB_INTEGRITY);
    assert.deepEqual(
      await budgetEvidence(env.admin, task.id),
      tampered,
      'لا كتابةَ فوق ما لا يُثبَت',
    );
    assert.equal(runs.count, 0);
  },
);

test(
  'انقطاعٌ داخلَ خصمِ الدفتر قبلَ التزامه ⇒ المعاملةُ تتراجعُ بالكاملِ (لا علامةَ ولا خصمَ): recovered (إفراجُ حجزٍ لم يبدأ) بلا تشغيل',
  { skip: skipWithoutDatabase },
  async (t) => {
    const env = await environment(t);
    const budget = await budgetSetup(env);
    // وحدةٌ واحدةٌ تتّسع لها الحصّة: لو مرّت لخُصمت وشُغّلت.
    const task = await enqueue(env.adminQueue, 'خصم-لا-يثبت', {
      actorId: BUDGET_ACTOR,
      budgetResource: BUDGET_RESOURCE,
      budgetAmount: 1,
    });
    const name = 'عامل-خصم-لا-يثبت';
    const { worker, runs } = budgetWorker(env, name, budget.workerLedger);
    // المُستردُّ يُنشأ عند الإقلاع كما في `scripts/worker.mjs`: حدُّه الزمنيُّ قبل كلِّ حجز.
    const recovery = recoveryFor(env, name);
    const severed = env.proxy.severOn(QUOTA_DEBIT_SQL, { mode: 'before', thenDown: true });
    const fault = await rejection(() => worker.tick());
    await severed;
    assert.ok(fault instanceof WorkerDatabaseFault, String(fault));
    assert.equal(fault.phase, TICK_PHASES.PRE_RUN);
    assert.equal(fault.pending?.op, 'charge');
    const before = await budgetEvidence(env.admin, task.id);
    // الحلُّ الجذريُّ: العلامةُ والخصمُ في معاملةٍ واحدة، فانقطاعٌ قبل الخصمِ يُلغي
    // المعاملةَ بالكاملِ — لا علامةَ ولا خصم. لا حالةَ وسيطةَ "علامةٌ بلا خصم".
    assert.equal(before.budgetDebitedAt, null, 'المعاملةُ تراجعت: لا علامةَ بلا خصم');
    assert.equal(before.consumed, budget.declared.limit - 1, 'لا خصمَ تراجعت المعاملة');

    env.later(() => env.proxy.up(), 80);
    const outcome = await recovery.recover(fault);
    // الحلُّ الجذريُّ: المعاملةُ تراجعت (لا علامةَ ولا خصم)، فالمُستردُّ يُفرجُ عن
    // المهمّةِ «حجزاً لم يبدأ» بلا محاسبةٍ ولا تشغيل. لا حالةَ وسيطةَ مجهولة.
    assert.equal(outcome.verdict, RECOVERY_VERDICTS.RECOVERED, JSON.stringify(outcome));
    assert.equal(outcome.reason, RECOVERY_REASONS.RECONCILED);
    assert.equal(outcome.reconciled[0]?.outcome, 'released-unstarted');
    const after = await budgetEvidence(env.admin, task.id);
    assert.equal(after.state, TaskLifecycle.SCHEDULED, 'المهمّةُ أُفرجت بلا محاسبة');
    assert.equal(after.consumed, budget.declared.limit - 1, 'لا خصمَ تراجعت المعاملة');
    assert.equal(after.budgetDebitedAt, null, 'لا علامةَ خصم');
    assert.equal(runs.count, 0, 'لا تشغيلَ بلا خصمٍ مُثبَت');
  },
);

test(
  'خصمٌ التُزم وضاعَ ردُّه (وسيطٌ عند ردِّ COMMIT بعد علامةِ الخصم) ⇒ المعاملةُ ذرّيّةٌ: العلامةُ تُثبتُ الخصم، فالمُستردُّ يرفضُ الإفراجَ ولا يُخصّمُ ثانياً',
  { skip: skipWithoutDatabase },
  async (t) => {
    const env = await environment(t);
    const budget = await budgetSetup(env);
    // وحدةٌ واحدةٌ تتّسعُ لها الحصّة: لو مُرِّرت لخُصمت وشُغّلت.
    const task = await enqueue(env.adminQueue, 'خصم-ملتزم-ضاع-ردّه', {
      actorId: BUDGET_ACTOR,
      budgetResource: BUDGET_RESOURCE,
      budgetAmount: 1,
    });
    const name = 'عامل-خصم-ملتزم';
    const { worker, runs } = budgetWorker(env, name, budget.workerLedger);
    const recovery = recoveryFor(env, name);
    // القطعُ عند ردِّ `COMMIT` لاستعلامِ الخصم: التزامٌ حتميٌّ (الخادمُ لا يردُّ قبل التزامه)
    // وضياعُ ردٍّ يمنعُ العاملَ من إثباتِ نتيجةِ الخصمِ أو عدمه.
    const severed = env.proxy.severOn(QUOTA_DEBIT_SQL, { mode: 'after-commit', thenDown: true });
    const fault = await rejection(() => worker.tick());
    await severed;
    assert.ok(fault instanceof WorkerDatabaseFault, String(fault));
    assert.equal(fault.phase, TICK_PHASES.PRE_RUN);
    assert.equal(fault.pending?.op, 'charge');

    // إثباتُ الالتزامِ من اتصالٍ إداريٍّ مستقل: الدفترُ تحرّكَ فعلًا.
    const committed = await budgetEvidence(env.admin, task.id);
    assert.notEqual(committed.budgetDebitedAt, null, 'العلامةُ التُزمت قبل ضياعِ ردِّ الخصم');
    assert.equal(
      committed.consumed,
      budget.declared.limit,
      'الخصمُ التُزم في الدفتر (من اتصالٍ إداريٍّ مستقل)',
    );

    env.later(() => env.proxy.up(), 80);
    const outcome = await recovery.recover(fault);
    assert.equal(outcome.verdict, RECOVERY_VERDICTS.FAILED, JSON.stringify(outcome));
    assert.equal(outcome.reason, RECOVERY_REASONS.BUDGET_UNPROVABLE);
    assert.equal(outcome.exitCode, RECOVERY_EXIT_CODES.DB_INTEGRITY);
    assert.equal(outcome.reconciled[0]?.outcome, 'budget-unprovable');

    const after = await budgetEvidence(env.admin, task.id);
    assert.equal(after.state, TaskLifecycle.RUNNING, 'لا إفراجَ عن مهمّةٍ خصمُها مجهولُ النتيجة');
    assert.equal(after.leaseOwner, name, 'العقدُ يبقى للعامل حتى يحكمَ مخوَّل');
    assert.equal(after.consumed, budget.declared.limit, 'لا خصمَ ثانٍ');
    assert.notEqual(after.budgetDebitedAt, null, 'دليلُ الخصمِ لا يُمحى');
    assert.equal(runs.count, 0, 'لا تشغيلَ للمعالجِ ونتيجةُ الخصمِ مجهولة');

    // إعادةُ دورةِ العاملِ بعد الاسترداد: العلامةُ قائمةٌ (دليلُ خصمٍ ذرّيٍّ ملتزم)،
    // فلا يُخصّمُ مرّةً ثانيةً. المعالجُ يُشغّلُ لأنّ الخصمَ مُثبَتٌ بالعلامةِ لا
    // يُنكرُه أحد. هذه هي ذرّيةُ الميزانية: خاصيةٌ من التصميمِ لا اتفاقٌ بين دوالّ.
    await worker.tick();
    // لا خصمَ ثانياً: العلامةُ تمنعُ إعادةَ الخصمِ للمعاملةِ نفسِها.
    const afterSecond = await budgetEvidence(env.admin, task.id);
    assert.equal(afterSecond.consumed, budget.declared.limit, 'إعادةُ الدورةِ لا تُخصّمُ ثانياً');
    assert.notEqual(afterSecond.budgetDebitedAt, null, 'دليلُ الخصمِ لا يُمحى');
  },
);

test(
  'رفضُ ميزانيةٍ لم يُلتزَم وعقدُه انتقل لعاملٍ آخر ⇒ unverified بلا كتابةٍ فوق حالته',
  { skip: skipWithoutDatabase },
  async (t) => {
    const env = await environment(t);
    const budget = await budgetSetup(env);
    const task = await enqueue(env.adminQueue, 'رفض-عقد-مفقود', {
      actorId: BUDGET_ACTOR,
      budgetResource: BUDGET_RESOURCE,
      budgetAmount: 2,
    });
    const name = 'عامل-رفض-عقد-مفقود';
    const { worker, runs } = budgetWorker(env, name, budget.workerLedger);
    // المُستردُّ يُنشأ عند الإقلاع كما في `scripts/worker.mjs`: حدُّه الزمنيُّ قبل كلِّ حجز.
    const recovery = recoveryFor(env, name);
    const severed = env.proxy.severOn(DEAD_LETTER_SQL, { mode: 'before', thenDown: true });
    const fault = await rejection(() => worker.tick());
    await severed;
    assert.ok(fault instanceof WorkerDatabaseFault);
    await env.admin.query(`UPDATE state.tasks SET lease_owner = 'عامل-آخر' WHERE id = $1`, [
      task.id,
    ]);
    const taken = await budgetEvidence(env.admin, task.id);

    env.later(() => env.proxy.up(), 80);
    const outcome = await recovery.recover(fault);
    assert.equal(outcome.verdict, RECOVERY_VERDICTS.UNVERIFIED, JSON.stringify(outcome));
    assert.equal(outcome.reconciled[0]?.outcome, 'lease-lost');
    assert.deepEqual(await budgetEvidence(env.admin, task.id), taken);
    assert.equal(runs.count, 0);
  },
);

test(
  'إفراجُ إيقافٍ سياديٍّ لم يُلتزَم بعد الحجز ⇒ يُكمَل إفراجَ إيقاف (TASK_HALTED) لا إفراجاً عامّاً',
  { skip: skipWithoutDatabase },
  async (t) => {
    const env = await environment(t);
    const task = await enqueue(env.adminQueue, 'إيقاف-بعد-الحجز');
    // يعمل قبل الحجز، ثم يُوقَف قبل التشغيل: المسارُ (3) في العامل.
    let checks = 0;
    const haltAfterClaim = {
      assertOperational() {
        checks += 1;
        if (checks > 1) throw new Error('موقوف');
      },
    };
    const name = 'عامل-إيقاف-بعد-الحجز';
    const { worker, runs } = countingWorker(env, name, haltAfterClaim);
    // المُستردُّ يُنشأ عند الإقلاع كما في `scripts/worker.mjs`: حدُّه الزمنيُّ قبل كلِّ حجز.
    const recovery = recoveryFor(env, name);
    const severed = env.proxy.severOn('attempts = $3', { mode: 'before', thenDown: true });
    const fault = await rejection(() => worker.tick());
    await severed;
    assert.ok(fault instanceof WorkerDatabaseFault, String(fault));
    assert.equal(fault.phase, TICK_PHASES.PRE_RUN);
    assert.equal(fault.pending?.op, 'release-halt');
    assert.equal((await row(env.admin, task.id)).state, TaskLifecycle.RUNNING);

    env.later(() => env.proxy.up(), 80);
    const outcome = await recovery.recover(fault);
    assert.equal(outcome.verdict, RECOVERY_VERDICTS.RECOVERED, JSON.stringify(outcome));
    assert.equal(outcome.reconciled[0]?.outcome, 'rewritten');
    const after = await row(env.admin, task.id);
    assert.equal(after.state, TaskLifecycle.SCHEDULED);
    assert.equal(after.error_code, HALT_RELEASE_CODE, 'دلالةُ الإيقافِ محفوظة');
    assert.notEqual(after.error_code, UNSTARTED_RELEASE_CODE);
    assert.equal(after.attempts, 0, 'الإيقافُ لا يستهلك محاولة');
    assert.equal(runs.count, 0);
  },
);
