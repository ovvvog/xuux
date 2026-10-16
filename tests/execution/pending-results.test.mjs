/**
 * النتائجُ المعلّقةُ الدائمةُ عبرَ انقطاعِ العملية — إغلاقُ الدَينِ `LIVE-45` (ب)
 * (‏`WL-392`).
 *
 * المشهدُ الحاسمُ الذي يقيسُ هذا الملفُّ كلَّ شيءٍ عليه: مُعالِجٌ حقيقيٌّ يُنتجُ
 * قيمةً معروفة، فتنقطعُ القاعدةُ عندَ تسجيلها (وسيطُ TCP يقطعُ الاتصالَ قبلَّ
 * تمريرِ الاستعلام — فالمعاملةُ لم تُلتزم)، ثمّ تُقتلُ العمليةُ قتلاً. العمليةُ
 * الجديدةُ لا تملكُ `fault.pending` في الذاكرةِ (ذاكرةُ الأولى ماتت معها)، فأين
 * القيمةُ؟ الجوابُ الذي يقيسُهُ الاختبارُ الأخير: على القرصِ، في سجلِّ العاملِ
 * الدائمِ، فتُسوّى من الحياةِ الجديدةِ بلا إعادةِ تشغيلِ المُعالِج.
 *
 * وكلُّ اختبارٍ هنا على قاعدةٍ معزولةٍ خاصّةٍ به، ويُقرأ الواقعُ من الطابورِ
 * نفسِهِ (المهمّةُ ومحاولاتُها وانتقالاتُها) لا من جوابِ دالّة.
 */

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { PersistentEventLog } from '../../src/root-of-trust/persistent-log.mjs';
import { createSealedEventSink } from '../../src/root-of-trust/production-runtime.mjs';
import { KingIdentity } from '../../src/root-of-trust/index.mjs';
import { createBudgetGate } from '../../src/execution/budget.mjs';
import { createQuotaLedger } from '../../src/policy/quota.mjs';
import { loadPolicyBundle } from '../../src/policy/loader.mjs';
import { QUEUE_ERRORS, createTaskQueue, QueueError } from '../../src/execution/queue.mjs';
import { TaskLifecycle } from '../../src/execution/lifecycle.mjs';
import {
  PENDING_RESULT_RESOLVED_EVENT,
  PENDING_RESULT_STAGED_EVENT,
  createPendingResultStore,
  settlePendingResults,
} from '../../src/execution/pending-results.mjs';
import { probeIsolation } from '../../src/execution/isolation.mjs';
import { up } from '../../src/persistence/migrator.mjs';
import { createIsolatedDatabase, databaseUrl, skipWithoutDatabase } from '../helpers/pg.mjs';
import { startFaultProxy } from '../helpers/pg-fault-proxy.mjs';
import { registerTmpRoot } from '../helpers/tmp-roots.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const WORKER_SCRIPT = path.join(ROOT, 'scripts/worker.mjs');
const AUTH = { decisionId: 'decision-نتائج-معلقة' };
/** مهمّةٌ تعبرُ العزلَ الحقيقيَّ في العملية: سقفُ ذاكرةٍ يتّسعُ لـNode داخل الحدود. */
const ISOLATED_TASK = { memoryLimitMb: 1_024, timeoutMs: 20_000 };
/** لقطعِ استعلامِ التسجيلِ قبلَّ تمريرهِ — فالمعاملةُ لم تُلتزم حتماً. */
const SUCCEEDED_SQL = "SET state = 'succeeded'";

/**
 * بيئةُ اختبارٍ على قاعدةٍ معزولةٍ مُهاجَرة، ووسيطُ أعطابٍ اختياريٌّ أمامها.
 * @param {import('node:test').TestContext} t
 * @param {{ proxy?: boolean }} [options]
 */
async function environment(t, options = {}) {
  const db = await createIsolatedDatabase('pendres');
  await up(db.pool);
  const base = new URL(/** @type {string} */ (databaseUrl()));
  base.pathname = `/${db.name}`;
  const proxy =
    options.proxy === true
      ? await startFaultProxy({ host: base.hostname, port: Number(base.port || 5432) })
      : null;
  const url = proxy === null ? base.toString() : proxy.urlFor(base.toString());
  const dir = registerTmpRoot(mkdtempSync(path.join(tmpdir(), 'wl392-')));
  t.after(async () => {
    if (proxy !== null) await proxy.close();
    await db.drop();
    rmSync(dir, { recursive: true, force: true });
  });
  return { db, proxy, url, dir, queue: createTaskQueue({ pool: db.pool }) };
}

/**
 * مخزنٌ حقيقيٌّ على ملفٍّ مؤقّتٍ — يُفتحُ ويُغلقُ كما تفعلُ العمليةُ الحية.
 * @param {string} dir
 * @param {string} worker
 * @param {string} [name]
 */
function openStore(dir, worker, name = 'pending.jsonl') {
  const file = path.join(dir, name);
  const log = new PersistentEventLog(file, { env: { NODE_ENV: 'test' } });
  const store = createPendingResultStore({ reader: log, writer: log, worker });
  return {
    store,
    file,
    close: () => log.close(),
    /** قراءةٌ خامٌ للأدلة: الأحداثُ لا تُمحى — التسويةُ قيدٌ فوقَ التخزينِ لا حذفٌ له.
     * قراءةٌ بلا قفلِ كاتبٍ: القارئَ ليس كاتباً، والمخزنُ قد يكونُ مفتوحاً في العمليةِ نفسِها. */
    events: () => {
      const reader = new PersistentEventLog(file, { env: { NODE_ENV: 'test' }, lock: false });
      try {
        return reader.events.map((event) => ({ type: event.type, data: event.data }));
      } finally {
        reader.close();
      }
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
      actorId: `actor-${key}`,
      idempotencyKey: key,
      timeoutMs: 10_000,
      memoryLimitMb: 96,
      ...extra,
    },
    AUTH,
  );
  return task;
}

/** @param {() => boolean} predicate @param {number} timeoutMs */
async function until(predicate, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('انقضت المهلةُ قبل تحقّق الشرط.');
}

// ─── (1) دوامُ المخزن ────────────────────────────────────────────────────────

test('المخزنُ يدومُ عبرَ إغلاقِ الملفِ وفتحهِ: القيمةُ على القرصِ لا في ذاكرةِ العملية', async (t) => {
  const dir = registerTmpRoot(mkdtempSync(path.join(tmpdir(), 'wl392-unit-')));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const first = openStore(dir, 'عامل-القرص');
  await first.store.stage({
    taskId: 'مهمة-١',
    attempt: 1,
    claimId: '11111111-1111-4111-8111-111111111111',
    result: { القيمة: 'من-الحياة-الأولى' },
  });
  first.close();

  // عمليةٌ جديدة: لا ذاكرةَ مشتركة — القراءةُ من القرصِ وحدَه.
  const second = openStore(dir, 'عامل-القرص');
  const pending = await second.store.unresolved();
  assert.equal(pending.length, 1, 'القيمةُ لم تَدُم على القرص');
  assert.deepEqual(pending[0]?.result, { القيمة: 'من-الحياة-الأولى' });
  await second.store.resolve({
    taskId: 'مهمة-١',
    attempt: 1,
    claimId: '11111111-1111-4111-8111-111111111111',
    outcome: 'settled',
    reason: 'اختبار',
  });
  second.close();

  // القيدُ لا يَمحو الدليلَ: التخزينُ باقٍ في السجلّ، والسجلاتُ المفتوحةُ فراغ.
  const third = openStore(dir, 'عامل-القرص');
  assert.deepEqual(await third.store.unresolved(), [], 'القيدُ لم يُقرأ بعدَ إعادةِ الفتح');
  const raw = third.events();
  third.close();
  assert.equal(
    raw.filter((event) => event.type === PENDING_RESULT_STAGED_EVENT).length,
    1,
    'التخزينُ حُذف من السجلّ — والأدلةُ لا تُمحى',
  );
  assert.equal(
    raw.filter((event) => event.type === PENDING_RESULT_RESOLVED_EVENT).length,
    1,
    'قيدُ التسويةِ ضاع',
  );
});

// ─── (2) التسويةُ من حياةٍ جديدة ────────────────────────────────────────────

test(
  'التسويةُ من حياةٍ جديدة: القيمةُ تُستوفى بلا إعادةِ تشغيلِ المُعالِج، والمحاولةُ لا تُزاد',
  { skip: skipWithoutDatabase },
  async (t) => {
    const env = await environment(t);
    const task = await enqueue(env.queue, 'تسوية-من-حياة-جديدة');
    const claimed = await env.queue.claim({ worker: 'عامل-س' });
    assert.equal(claimed.length, 1);
    const claimId = claimed[0]?.claimId;
    assert.ok(claimId !== null && claimId !== undefined);
    assert.equal(claimed[0]?.id, task.id);

    // الحياةُ الأولى: القيمةُ خُزّنت دائماً ثمّ ماتتِ العمليةُ قبلَّ التسجيل.
    // ومعها معرِّفُ الحجزِ الذي وُلدَ عندَ الحجزِ — هويةُ النتيجةِ التي تُقاس.
    const first = openStore(env.dir, 'عامل-س');
    await first.store.stage({
      taskId: task.id,
      attempt: 1,
      claimId,
      result: { القيمة: 'من-الحياة-الأولى' },
    });
    first.close();

    // الحياةُ الجديدة: لا `fault.pending` في الذاكرة — التسويةُ من القرصِ وحدَه.
    const second = openStore(env.dir, 'عامل-س');
    const counts = await settlePendingResults({ store: second.store, queue: env.queue });
    assert.deepEqual(counts, { examined: 1, settled: 1, superseded: 0, conflicts: 0 });

    const after = await env.queue.get(task.id);
    assert.ok(after !== null);
    assert.equal(after.state, TaskLifecycle.SUCCEEDED);
    assert.deepEqual(after.result, { القيمة: 'من-الحياة-الأولى' });
    assert.equal(after.attempts, 1, 'التسويةُ زادتِ المحاولةَ — وهي ليست تنفيذاً جديداً');
    assert.equal(after.leaseOwner, null);

    // انتقالٌ واحدٌ بالسببِ المُسمّى — لا انتقالَ مزدوجٍ ولا تشغيلٌ ثانٍ.
    const transitions = await env.queue.transitions(task.id);
    const successMoves = transitions.filter((entry) => entry.to === TaskLifecycle.SUCCEEDED);
    assert.equal(successMoves.length, 1);
    assert.match(String(successMoves[0]?.reason), /تسويةُ نتيجةٍ معلّقة/);
    assert.deepEqual(await second.store.unresolved(), []);
    second.close();
  },
);

// ─── (3) شرطُ الهويةِ: المحاولةُ ومعرِّفُ الحجز ─────────────────────────────

test(
  'شرطُ الهويةِ في `succeed`: نتيجةُ حياةٍ سابقةٍ لا تُكتبُ فوقَ محاولةٍ أو حجزٍ أحدث',
  { skip: skipWithoutDatabase },
  async (t) => {
    const env = await environment(t);
    const task = await enqueue(env.queue, 'شرط-المحاولة');
    const claimed = await env.queue.claim({ worker: 'عامل-س' });
    assert.equal(claimed.length, 1);
    const claimId = claimed[0]?.claimId;
    assert.ok(claimId !== null && claimId !== undefined);

    // عدّادٌ مخالفٌ ⇒ رفضُ عقدٍ لا نجاحٌ صامت.
    await assert.rejects(
      env.queue.succeed({ taskId: task.id, worker: 'عامل-س', result: { ن: 1 }, attempt: 2 }),
      (error) => error instanceof QueueError && error.code === QUEUE_ERRORS.LEASE_LOST,
    );
    // معرِّفُ حجزٍ مخالفٌ (حجزٌ آخرُ بالاسمِ والعدّادِ نفْسِها) ⇒ الرفضُ نفسُه:
    // الاسمُ والعدّادُ قابلانِ لإعادةِ الاستعمال، والمعرِّفُ لا.
    await assert.rejects(
      env.queue.succeed({
        taskId: task.id,
        worker: 'عامل-س',
        result: { ن: 1 },
        attempt: 1,
        claimId: '99999999-9999-4999-8999-999999999999',
      }),
      (error) => error instanceof QueueError && error.code === QUEUE_ERRORS.LEASE_LOST,
    );
    let after = await env.queue.get(task.id);
    assert.equal(
      after?.state,
      TaskLifecycle.RUNNING,
      'المحاولةُ المخالفةُ نجحت — والهويةَ مُزوّرة',
    );

    await env.queue.succeed({
      taskId: task.id,
      worker: 'عامل-س',
      result: { ن: 1 },
      attempt: 1,
      claimId,
    });
    after = await env.queue.get(task.id);
    assert.equal(after?.state, TaskLifecycle.SUCCEEDED);
  },
);

// ─── (4) سباقُ الحاصد: لا استبدالَ فوقَ حياةٍ أحدث ───────────────────────────

test(
  'سباقُ الحاصدِ: مهمّةٌ حُصدت وحُجزت من جديدٍ — نتيجةُ الحياةِ السابقةِ تُعلَّقُ لا تُكتب فوقَ الأحدث',
  { skip: skipWithoutDatabase },
  async (t) => {
    const env = await environment(t);
    const task = await enqueue(env.queue, 'سباق-الحاصد');
    const claimed = await env.queue.claim({ worker: 'عامل-الأول' });
    assert.equal(claimed.length, 1);
    const claimId = claimed[0]?.claimId;
    assert.ok(claimId !== null && claimId !== undefined);

    const first = openStore(env.dir, 'عامل-الأول');
    await first.store.stage({
      taskId: task.id,
      attempt: 1,
      claimId,
      result: { الجيل: 'الأول' },
    });
    first.close();

    // العقدُ ينتهي فتحصدُها الحاصدُ وتُحجزُ من جديدٍ بحياةٍ أخرى ونتيجةٍ أخرى.
    const expired = new Date(Date.now() + 60_000);
    const reapedQueue = createTaskQueue({ pool: env.db.pool, now: () => expired });
    await reapedQueue.reclaimExpired({ actor: 'الحاصد' });
    const requeued = await env.queue.get(task.id);
    assert.equal(requeued?.state, TaskLifecycle.SCHEDULED, 'الحصادُ لم يُعد المهمّة');
    // إعادةُ الحجزِ بعدَ انقضاءِ التأجيلِ التراجعيِّ الذي وضعهُ الحصادُ: وقتٌ
    // متقدّمٌ لا نومٌ — الحسابُ حتميٌّ لا صدفةَ توقيتٍ.
    const afterBackoff = new Date(Date.now() + 120_000);
    const futureQueue = createTaskQueue({ pool: env.db.pool, now: () => afterBackoff });
    const claimedAgain = await futureQueue.claim({ worker: 'عامل-الثاني' });
    assert.equal(claimedAgain.length, 1);
    await env.queue.succeed({
      taskId: task.id,
      worker: 'عامل-الثاني',
      result: { الجيل: 'الثاني' },
    });

    const second = openStore(env.dir, 'عامل-الأول');
    const counts = await settlePendingResults({ store: second.store, queue: env.queue });
    assert.deepEqual(counts, { examined: 1, settled: 0, superseded: 1, conflicts: 0 });

    // النتيجةُ الأحدثُ باقيةٌ — لم تُستبدلْ صامتاً — والأدلةُ لم تُمحَ.
    const after = await env.queue.get(task.id);
    assert.equal(after?.state, TaskLifecycle.SUCCEEDED);
    assert.deepEqual(after?.result, { الجيل: 'الثاني' });
    assert.equal(after?.attempts, 2);
    const transitions = await env.queue.transitions(task.id);
    assert.equal(
      transitions.filter((entry) => entry.to === TaskLifecycle.SUCCEEDED).length,
      1,
      'انتقالُ نجاحٍ مزدوج — والتسويةَ ليست تنفيذاً',
    );
    const raw = second.events();
    second.close();
    assert.equal(
      raw.filter((event) => event.type === PENDING_RESULT_STAGED_EVENT).length,
      1,
      'دليلُ الحياةِ الأولى حُذف',
    );
  },
);

// ─── (5) التضادُّ المُسمّى لا الاستبدالُ الصامت ──────────────────────────────

test(
  'نتيجةٌ قائمةٌ مخالفةٌ للمعلّقة: تضادٌّ يُقيَّدُ — لا استبدالَ صامتاً ولا كتابةً في القاعدة',
  { skip: skipWithoutDatabase },
  async (t) => {
    const env = await environment(t);
    const task = await enqueue(env.queue, 'تضاد-مسمّى');
    const claimed = await env.queue.claim({ worker: 'عامل-س' });
    assert.equal(claimed.length, 1);
    const claimId = claimed[0]?.claimId;
    assert.ok(claimId !== null && claimId !== undefined);

    const first = openStore(env.dir, 'عامل-س');
    await first.store.stage({
      taskId: task.id,
      attempt: 1,
      claimId,
      result: { القيمة: 'المعلّقة' },
    });
    first.close();

    // القاعدةُ سجّلت قيمةً مختلفةً (مسارٌ آخرَ — مُداركٌ أو استرداد).
    await env.queue.succeed({ taskId: task.id, worker: 'عامل-س', result: { القيمة: 'المسجّلة' } });

    const second = openStore(env.dir, 'عامل-س');
    const counts = await settlePendingResults({ store: second.store, queue: env.queue });
    assert.deepEqual(counts, { examined: 1, settled: 0, superseded: 0, conflicts: 1 });
    const after = await env.queue.get(task.id);
    assert.deepEqual(after?.result, { القيمة: 'المسجّلة' }, 'استُبدلت نتيجةٌ مسجّلةٌ صامتاً');
    assert.equal((await second.store.unresolved()).length, 0);
    const raw = second.events();
    second.close();
    const verdict = raw.find((event) => event.type === PENDING_RESULT_RESOLVED_EVENT);
    assert.equal(
      /** @type {Record<string, unknown> | undefined} */ (verdict?.data)?.['outcome'],
      'conflict',
    );
    assert.equal(
      raw.filter((event) => event.type === PENDING_RESULT_STAGED_EVENT).length,
      1,
      'دليلُ التضادِّ حُذف',
    );
  },
);

// ─── (6) الاستيفاءُ بالمطابقةِ لا يُكرّرُ انتقالاً ────────────────────────────

test(
  'نتيجةٌ قائمةٌ مطابقةٌ للمعلّقة: استيفاءٌ بالقيدِ بلا انتقالٍ جديدٍ ولا كتابة',
  { skip: skipWithoutDatabase },
  async (t) => {
    const env = await environment(t);
    const task = await enqueue(env.queue, 'استيفاء-بالمطابقة');
    const claimed = await env.queue.claim({ worker: 'عامل-س' });
    assert.equal(claimed.length, 1);
    const claimId = claimed[0]?.claimId;
    assert.ok(claimId !== null && claimId !== undefined);

    const first = openStore(env.dir, 'عامل-س');
    await first.store.stage({
      taskId: task.id,
      attempt: 1,
      claimId,
      result: { القيمة: 'المطابقة' },
    });
    first.close();

    // نجحَ التسجيلُ في القاعدةِ لكنّ القيدَ في المخزنِ لم يُكتب (قتلٌ بين الاثنين).
    await env.queue.succeed({ taskId: task.id, worker: 'عامل-س', result: { القيمة: 'المطابقة' } });
    const before = (await env.queue.transitions(task.id)).length;

    const second = openStore(env.dir, 'عامل-س');
    const counts = await settlePendingResults({ store: second.store, queue: env.queue });
    assert.deepEqual(counts, { examined: 1, settled: 1, superseded: 0, conflicts: 0 });
    const after = await env.queue.get(task.id);
    assert.equal(after?.state, TaskLifecycle.SUCCEEDED);
    assert.deepEqual(after?.result, { القيمة: 'المطابقة' });
    assert.equal(
      (await env.queue.transitions(task.id)).length,
      before,
      'انتقالٌ جديدٌ فوقَ نتيجةٍ قائمة — والمطابقةَ قيدٌ لا تنفيذ',
    );
    second.close();
  },
);

// ─── (7) المشهدُ الحاسم: قتلٌ حقيقيٌّ في نافذةِ التسجيل ─────────────────────

test(
  'العمليةُ الحقيقية: القيمةُ تُقتلُ في نافذةِ تسجيلِها فتنجو على القرصِ وتُسوّى من حياةٍ جديدة',
  {
    skip: skipWithoutDatabase || !probeIsolation().available,
    timeout: 90_000,
  },
  async (t) => {
    const env = await environment(t, { proxy: true });
    const task = await enqueue(env.queue, 'قتل-في-نافذة-التسجيل', ISOLATED_TASK);
    const logFile = path.join(env.dir, 'worker-log.jsonl');
    /** مفتاحُ إيقافٍ حقيقيٌّ موقّعٌ بمفتاحِ ملك. */
    const king = new KingIdentity();
    const haltFile = path.join(env.dir, 'state', 'halt.json');
    const publicKey = String(king.publicKey.export({ type: 'spki', format: 'pem' }));
    /** جذرُ مخرجاتِ العزلِ يُنشأ ويُمحى معَ الاختبارِ لا يبقى أثراً بعده. */
    const outputRoot = path.join(ROOT, '.isolation-output', `wl392-${Date.now()}`);
    t.after(() => {
      rmSync(outputRoot, { recursive: true, force: true });
    });

    /**
     * عاملٌ حقيقيٌّ عبرَ الوسيط: سجلُّ العزلِ نفسُهُ هو حاملُ النتائجِ المعلّقةِ،
     * فالعمليةُ الثانيةُ تقرأُ ما خزّنتْهُ الأولى على القرص.
     * @param {string[]} args
     */
    /** @param {string[]} args */
    const spawnWorker = (args) => {
      const child = spawn(process.execPath, [WORKER_SCRIPT, ...args], {
        cwd: ROOT,
        env: {
          ...process.env,
          NODE_ENV: 'test',
          STATE_ENV: 'ci',
          DATABASE_URL: env.url,
          HALT_FILE: haltFile,
          HALT_PUBLIC_KEY: publicKey,
          ISOLATION_LOG_FILE: logFile,
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
      const exited = new Promise((resolve) =>
        child.on('exit', (code) => resolve({ code, stdout, stderr })),
      );
      return { child, exited: () => exited, output: () => stdout, stderrOf: () => stderr };
    };

    const workerArgs = [
      '--worker',
      'عامل-النافذة',
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
    ];

    // الحياةُ الأولى: المُعالِجُ يُنتجُ القيمةَ، وتُخزَّن دائماً، ثمّ يُقطعُ
    // الاتصالُ **قبلَّ تمريرِ** استعلامِ النجاحِ — فالمعاملةُ لم تُلتزم.
    env.proxy?.severOn(SUCCEEDED_SQL, { mode: 'before', thenDown: true });
    const first = spawnWorker(workerArgs);
    t.after(() => {
      if (first.child.exitCode === null) first.child.kill('SIGKILL');
    });
    try {
      await until(() => first.output().includes('db-fault'), 30_000);
    } catch (error) {
      throw new Error(
        `db-fault لم يظهر خلال 30 ثانية. stdout:\n${first.output()}\n---stderr---\n${first.stderrOf()}`,
        { cause: error },
      );
    }
    // القيمةُ الآن على القرصِ (خُزّنت قبلَّ استعلامِ التسجيل)، والعمليةُ تنتظرُ
    // استرداداً لن يعودَ (الوسيطُ مطفأ) — فتُقتلُ قتلاً في نافذةِ التسجيلِ.
    first.child.kill('SIGKILL');
    await first.exited();

    const afterKill = await env.queue.get(task.id);
    assert.equal(afterKill?.state, TaskLifecycle.RUNNING, 'المهمّةُ سُجّلت نجحت رغمَ قطعِ التسجيل');
    assert.equal(afterKill?.attempts, 1);

    // القاعدةُ تعود، والحياةُ الجديدةُ تُقلعُ بذاكرةٍ فارغةٍ — لا `fault.pending`.
    await env.proxy?.up();
    const second = spawnWorker([...workerArgs, '--once']);
    const result = await second.exited();
    assert.equal(result.code, 0, `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`);

    // التسويةُ وقعت عندَ الإقلاعِ قبلَّ أيِّ حجزٍ جديد — والقيمةُ من القرصِ لا من
    // إعادةِ تشغيل: عدّادُ المحاولاتِ لم يزد، وقيدُ المخزنِ يُسمّي الاستيفاء.
    assert.match(result.stdout, /pending-results \| سُوّيت: 1/);
    const after = await env.queue.get(task.id);
    assert.ok(after !== null);
    assert.equal(after.state, TaskLifecycle.SUCCEEDED);
    assert.equal(after.attempts, 1, 'أُعيد تشغيلُ المُعالِج — والقيمةَ كانت دائمة');
    assert.equal(after.result?.['نُفِّذ'], true);
    assert.equal(after.leaseOwner, null);
    const transitions = await env.queue.transitions(task.id);
    assert.equal(
      transitions.filter((entry) => entry.to === TaskLifecycle.SUCCEEDED).length,
      1,
      'انتقالا نجاحٍ — إمّا تكرارُ تنفيذٍ أو انتقالٌ مزدوج',
    );

    // والدليلُ باقٍ في السجلِّ الدائمِ: تخزينٌ ثمّ قيدُ استيفاء.
    const reader = new PersistentEventLog(logFile, { env: { NODE_ENV: 'test' }, lock: false });
    try {
      const types = reader.events.map((event) => event.type);
      assert.ok(types.includes(PENDING_RESULT_STAGED_EVENT), types.join(','));
      assert.ok(types.includes(PENDING_RESULT_RESOLVED_EVENT), types.join(','));
      const staged = reader.events.find((event) => event.type === PENDING_RESULT_STAGED_EVENT);
      // القيمةُ المُستوفاةُ هي القيمةُ المُخزَّنةُ نفسُها — لا نسخةً أعادَ إنتاجَها
      // تشغيلٌ ثانٍ.
      assert.deepEqual(
        /** @type {Record<string, unknown> | undefined} */ (staged?.data)?.['result'],
        after.result,
      );
    } finally {
      reader.close();
    }
  },
);

// ─── (8) المخزنُ المختومُ: الجسمُ المصونُ يُفكُّ عندَ القراءة ─────────────────

test('المخزنُ المختومُ: القيمةُ تدومُ على القرصِ جسمًا مصونًا لا نصًّا ظاهرًا، وتُقرأُ بالخاتمِ لا بدونه', async (t) => {
  const dir = registerTmpRoot(mkdtempSync(path.join(tmpdir(), 'wl392-sealed-')));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  /** خاتمُ اختبارٍ على نمطِ خاتمِ الإنتاج: ختمٌ وفكٌّ، والجسمُ على القرصِ نصٌّ مصون. */
  const sealer = {
    keyId: '05',
    seal: async (/** @type {unknown} */ data) => ({ sealed: JSON.stringify(data) }),
    open: async (/** @type {unknown} */ sealed) =>
      JSON.parse(/** @type {{ sealed: string }} */ (sealed).sealed),
  };
  const file = path.join(dir, 'pending-sealed.jsonl');
  const log = new PersistentEventLog(file, { sealer, fsync: false, env: {} });
  log.load();
  const sink = createSealedEventSink(log);
  const store = createPendingResultStore({ reader: log, writer: sink, worker: 'عامل-الختم' });
  await store.stage({
    taskId: 'مهمة-مختومة',
    attempt: 1,
    claimId: '22222222-2222-4222-8222-222222222222',
    result: { القيمة: 'مصونة' },
  });
  // الجسمُ على القرصِ مصونٌ لا نصٌّ ظاهر: مفتاحُ الحدثِ لا يظهرُ في الجسمِ الخامّ.
  const rawEvent = log.events.find((event) => event.type === PENDING_RESULT_STAGED_EVENT);
  assert.ok(rawEvent !== undefined);
  assert.equal(
    typeof (/** @type {Record<string, unknown>} */ (rawEvent.data)?.['sealed']),
    'string',
    'الجسمُ على القرصِ نصٌّ ظاهر — والختمَ في الإنتاجِ واجبُ دوامٍ لا زينة',
  );
  assert.equal(/** @type {Record<string, unknown>} */ (rawEvent.data)?.['taskId'], undefined);
  log.close();

  // حياةٌ جديدة: القراءةُ تُفكُّ الختمَ حدثاً حدثاً — القارئُ بلا خاتمٍ أعمى.
  const reopened = new PersistentEventLog(file, { sealer, fsync: false, env: {} });
  reopened.load();
  const second = createPendingResultStore({
    reader: reopened,
    writer: createSealedEventSink(reopened),
    worker: 'عامل-الختم',
  });
  const pending = await second.unresolved();
  assert.equal(pending.length, 1, 'القيمةُ المصونةُ لم تُقرأ بعدَ إعادةِ الفتح');
  assert.deepEqual(pending[0]?.result, { القيمة: 'مصونة' });
  assert.equal(pending[0]?.claimId, '22222222-2222-4222-8222-222222222222');
  // والقيدُ يُخزَنُ مصونًا كذلك ويُقرأُ بعدَه.
  await second.resolve({
    taskId: 'مهمة-مختومة',
    attempt: 1,
    claimId: '22222222-2222-4222-8222-222222222222',
    outcome: 'settled',
    reason: 'اختبارُ الختم',
  });
  reopened.close();
  const third = new PersistentEventLog(file, { sealer, fsync: false, env: {} });
  third.load();
  const thirdStore = createPendingResultStore({
    reader: third,
    writer: createSealedEventSink(third),
    worker: 'عامل-الختم',
  });
  assert.deepEqual(await thirdStore.unresolved(), [], 'قيدُ التسويةِ المصونُ لم يُقرأ');
  third.close();
});

// ─── (9) التخزينُ المزدوجُ: الخمولُ والتضادُّ المُسمّى ───────────────────────

test('التخزينُ المزدوجُ: القيمةُ المطابقةُ خمولٌ، والمخالفةُ تضادٌّ مُسمّى — لا اختيارَ صامتَ ولا إخفاءَ دليل', async (t) => {
  const dir = registerTmpRoot(mkdtempSync(path.join(tmpdir(), 'wl392-dup-')));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const identity = {
    taskId: 'مهمة-التخزين-المزدوج',
    attempt: 1,
    claimId: '33333333-3333-4333-8333-333333333333',
  };
  const open = () => {
    const entry = openStore(dir, 'عامل-المزدوج', 'dup.jsonl');
    return entry;
  };
  const first = open();
  await first.store.stage({ ...identity, result: { القيمة: 'الأولى' } });
  // إعادةُ محاولةٍ خاملةٌ بقيمةٍ مطابقة: لا دليلَ جديد ولا تضادّ.
  await first.store.stage({ ...identity, result: { القيمة: 'الأولى' } });
  assert.equal((await first.store.unresolved()).length, 1);
  let raw = first.events();
  assert.equal(
    raw.filter((event) => event.type === PENDING_RESULT_STAGED_EVENT).length,
    1,
    'التخزينُ المطابِقُ زادَ دليلًا — وهو خمولٌ لا واقعة',
  );
  // قيمةٌ مخالفةٌ للهويةِ نفسِها: تضادٌّ يُقيَّدُ في الحالِ ولا يُختارُ منهما شيء.
  await first.store.stage({ ...identity, result: { القيمة: 'المخالفة' } });
  assert.deepEqual(
    await first.store.unresolved(),
    [],
    'التضادُّ بقيَ معلّقًا — وهو قرارٌ مُسمّى لا سجلٌ ينتظرُ من يختار',
  );
  raw = first.events();
  first.close();
  const verdict = /** @type {Record<string, unknown> | undefined} */ (
    raw.find((event) => event.type === PENDING_RESULT_RESOLVED_EVENT)?.data
  );
  assert.equal(verdict?.['outcome'], 'conflict', 'المخالفةُ لم تُسمَّ تضادًّا');
  assert.equal(
    raw.filter((event) => event.type === PENDING_RESULT_STAGED_EVENT).length,
    2,
    'دليلُ التضادِّ حُذف — والأدلةَ لا تُمحى',
  );
});

// ─── (10) هويةُ الحجزِ لا تُعادُ بالاسمِ والعدّاد ───────────────────────────

test(
  'هويةُ الحجزِ لا تُعادُ: إرجاعٌ ثمّ حجزٌ بالاسمِ والعدّادِ نفْسِهما — نتيجةُ الحياةِ الأولى تُعلَّقُ لا تُكتب',
  { skip: skipWithoutDatabase },
  async (t) => {
    const env = await environment(t);
    const task = await enqueue(env.queue, 'هوية-الحجز');
    const claimed = await env.queue.claim({ worker: 'عامل-س' });
    assert.equal(claimed.length, 1);
    const claimId = claimed[0]?.claimId;
    assert.ok(claimId !== null && claimId !== undefined);
    const firstClaimId = claimed[0]?.claimId;
    assert.ok(typeof firstClaimId === 'string' && firstClaimId !== '');

    const first = openStore(env.dir, 'عامل-س');
    await first.store.stage({
      taskId: task.id,
      attempt: 1,
      claimId: firstClaimId,
      result: { القيمة: 'من-الحياة-الأولى' },
    });
    first.close();

    // الإرجاعُ يُخرِجُ المهمّةَ من `running` ويُعيدُ المحاولةَ — ثمّ يُحجَزُ بالاسمِ
    // والعدّادِ نفْسِهما: هويةٌ نصًّا واحدةٌ وحجزانِ مختلفانِ فعلاً.
    await env.queue.releaseForHalt({
      taskId: task.id,
      worker: 'عامل-س',
      reason: 'اختبارُ إعادةِ الهوية',
    });
    const reclaimed = await env.queue.claim({ worker: 'عامل-س' });
    assert.equal(reclaimed.length, 1);
    assert.equal(reclaimed[0]?.attempts, 1, 'الإرجاعُ لم يُعِدِ المحاولةَ — والهويةَ تتكرّر');
    assert.notEqual(
      reclaimed[0]?.claimId,
      firstClaimId,
      'الحجزُ الثاني وُلدَ بمعرِّفِ الحياةِ الأولى — والمعرِّفَ لا يُولَدُ مرّتين',
    );

    // تسويةُ نتيجةِ الحياةِ الأولى فوقَ حجزِ الحياةِ الثانية: تعليقٌ لا كتابة.
    const second = openStore(env.dir, 'عامل-س');
    const counts = await settlePendingResults({ store: second.store, queue: env.queue });
    assert.deepEqual(counts, { examined: 1, settled: 0, superseded: 1, conflicts: 0 });
    const after = await env.queue.get(task.id);
    assert.equal(after?.state, TaskLifecycle.RUNNING, 'تسويةُ حياةٍ سابقةٍ كتبت فوقَ حجزٍ أحدث');
    assert.equal(after?.claimId, reclaimed[0]?.claimId, 'حجزُ الحياةِ الثانيةِ استُبدل');
    assert.deepEqual(after?.result, null);
    second.close();
  },
);

// ─── (11) الإيقافُ السياديُّ يؤجّلُ التسوية ──────────────────────────────────

test(
  'الإيقافُ السياديُّ يؤجّلُ التسويةَ: لا كتابةَ ولا قيدَ تحتَه، وبعدَ الاستئنافِ تُسوّى',
  { skip: skipWithoutDatabase },
  async (t) => {
    const env = await environment(t);
    const task = await enqueue(env.queue, 'إيقاف-يؤجل-التسوية');
    const claimed = await env.queue.claim({ worker: 'عامل-س' });
    assert.equal(claimed.length, 1);
    const claimId = claimed[0]?.claimId;
    assert.ok(claimId !== null && claimId !== undefined);

    const first = openStore(env.dir, 'عامل-س');
    await first.store.stage({
      taskId: task.id,
      attempt: 1,
      claimId,
      result: { القيمة: 'مؤجّلة' },
    });
    first.close();

    // تحتَ الإيقافِ: التسويةُ تُؤجَّلُ كلَّها — لا تُفحصُ ولا تُكتبُ ولا تُقيَّدُ.
    const halted = {
      assertOperational: () => {
        throw new Error('النظام موقوف');
      },
    };
    const second = openStore(env.dir, 'عامل-س');
    const deferred = await settlePendingResults({
      store: second.store,
      queue: env.queue,
      haltGuard: halted,
    });
    assert.deepEqual(deferred, { examined: 0, settled: 0, superseded: 0, conflicts: 0 });
    let after = await env.queue.get(task.id);
    assert.equal(after?.state, TaskLifecycle.RUNNING, 'تسويةٌ وقعت تحتَ الإيقاف');
    assert.equal(
      (await second.store.unresolved()).length,
      1,
      'السجلُ قُيِّدَ له حكمٌ تحتَ الإيقاف',
    );
    let raw = second.events();
    assert.equal(
      raw.filter((event) => event.type === PENDING_RESULT_RESOLVED_EVENT).length,
      0,
      'قيدُ تسويةٍ تحتَ الإيقاف',
    );

    // وبعدَ الاستئنافِ: التسويةُ تقعُ كما لو لم يكن إيقافٌ — القيمةُ لم تَفقد.
    const resumed = { assertOperational: () => {} };
    const counts = await settlePendingResults({
      store: second.store,
      queue: env.queue,
      haltGuard: resumed,
    });
    assert.deepEqual(counts, { examined: 1, settled: 1, superseded: 0, conflicts: 0 });
    after = await env.queue.get(task.id);
    assert.equal(after?.state, TaskLifecycle.SUCCEEDED);
    assert.deepEqual(after?.result, { القيمة: 'مؤجّلة' });
    assert.equal(
      after?.attempts,
      1,
      'الاستئنافُ أعادَ تشغيلَ المُعالِج — والقيمةَ كانت معلّقةً لا فاقدة',
    );
    raw = second.events();
    second.close();
    assert.equal(
      raw.filter((event) => event.type === PENDING_RESULT_RESOLVED_EVENT).length,
      1,
      'قيدُ التسويةِ بعدَ الاستئنافِ ضاع',
    );
  },
);

// ─── (12) الإلغاءُ المتأخّرُ لا يُبطلُ قيمةً وُلدت ───────────────────────────

test(
  'إلغاءٌ طلُبَ بعدَ ولادةِ القيمة: التسويةُ تُسجّلُ النجاحَ كما يفعلُ المسارُ المباشرُ — الإشارةُ خسرتِ السباق',
  { skip: skipWithoutDatabase },
  async (t) => {
    const env = await environment(t);
    const task = await enqueue(env.queue, 'إلغاء-متأخّر');
    const claimed = await env.queue.claim({ worker: 'عامل-س' });
    assert.equal(claimed.length, 1);
    const claimId = claimed[0]?.claimId;
    assert.ok(claimId !== null && claimId !== undefined);

    const first = openStore(env.dir, 'عامل-س');
    await first.store.stage({
      taskId: task.id,
      attempt: 1,
      claimId,
      result: { القيمة: 'وُلدت قبلَ الإلغاء' },
    });
    first.close();

    // إشارةُ الإلغاءِ تصلُ بعدَ أن أنتجَ المُعالِجُ قيمتَه — والمسارُ المباشرُ
    // (‏`run.ok` ثمّ `succeed` بلا فحصِ إلغاء) لا يُبطلُها، فالتسويةُ مثلهُ.
    await env.queue.cancelTree({ taskId: task.id, reason: 'اختبارُ الإلغاءِ المتأخّر' });
    const running = await env.queue.get(task.id);
    assert.equal(running?.cancelRequested, true, 'الإشارةُ لم تُسجَّل');
    assert.equal(running?.state, TaskLifecycle.RUNNING);

    const second = openStore(env.dir, 'عامل-س');
    const counts = await settlePendingResults({ store: second.store, queue: env.queue });
    assert.deepEqual(counts, { examined: 1, settled: 1, superseded: 0, conflicts: 0 });
    const after = await env.queue.get(task.id);
    assert.equal(
      after?.state,
      TaskLifecycle.SUCCEEDED,
      'قيمةٌ وُلدت أُبطلت بإشارةٍ متأخّرة — والمسارَ المباشرَ لا يُبطلُها',
    );
    assert.deepEqual(after?.result, { القيمة: 'وُلدت قبلَ الإلغاء' });
    second.close();
  },
);

// ─── (13) المشهدُ الثاني: نجاحٌ التزمَ وضاعَ جوابُه ──────────────────────────

test(
  'النجاحُ التزمَ في القاعدةِ وضاعَ الجوابُ: قتلٌ ثمّ إقلاعٌ جديدٌ يُسوّي بالملاحظةِ — قيدٌ بلا انتقالٍ جديدٍ ولا استبدال',
  {
    skip: skipWithoutDatabase || !probeIsolation().available,
    timeout: 90_000,
  },
  async (t) => {
    const env = await environment(t, { proxy: true });
    const task = await enqueue(env.queue, 'نجاح-التزم-وضاع-الجواب', ISOLATED_TASK);
    const logFile = path.join(env.dir, 'worker-log.jsonl');
    const king = new KingIdentity();
    const haltFile = path.join(env.dir, 'state', 'halt.json');
    const publicKey = String(king.publicKey.export({ type: 'spki', format: 'pem' }));
    const outputRoot = path.join(ROOT, '.isolation-output', `wl392b-${Date.now()}`);
    t.after(() => {
      rmSync(outputRoot, { recursive: true, force: true });
    });

    /** @param {string[]} args */
    const spawnWorker = (args) => {
      const child = spawn(process.execPath, [WORKER_SCRIPT, ...args], {
        cwd: ROOT,
        env: {
          ...process.env,
          NODE_ENV: 'test',
          STATE_ENV: 'ci',
          DATABASE_URL: env.url,
          HALT_FILE: haltFile,
          HALT_PUBLIC_KEY: publicKey,
          ISOLATION_LOG_FILE: logFile,
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
      const exited = new Promise((resolve) =>
        child.on('exit', (code) => resolve({ code, stdout, stderr })),
      );
      return { child, exited: () => exited, output: () => stdout, stderrOf: () => stderr };
    };

    const workerArgs = [
      '--worker',
      'عامل-الالتزام',
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
    ];

    // النجاحُ **يلتزم** لكنّ الجوابَ يُقطعُ بعدَ الالتزام: القاعدةُ سجّلت، والعمليةُ
    // لا تعرفُ — فتقتلُ قتلاً في نافذةِ ما بعدَ الالتزام.
    env.proxy?.severOn(SUCCEEDED_SQL, { mode: 'after-commit', thenDown: true });
    const first = spawnWorker(workerArgs);
    t.after(() => {
      if (first.child.exitCode === null) first.child.kill('SIGKILL');
    });
    try {
      await until(() => first.output().includes('db-fault'), 30_000);
    } catch (error) {
      throw new Error(
        `db-fault لم يظهر خلال 30 ثانية. stdout:\n${first.output()}\n---stderr---\n${first.stderrOf()}`,
        { cause: error },
      );
    }
    first.child.kill('SIGKILL');
    await first.exited();

    // الالتزامُ وقعَ: المهمّةُ نجحت في القاعدةِ بلا علمِ العمليةِ القتيلة.
    const committed = await env.db.pool
      .query(`SELECT state, result FROM state.tasks WHERE id = $1`, [task.id])
      .then((found) => found.rows[0]);
    assert.ok(committed !== undefined);
    assert.equal(
      committed['state'],
      TaskLifecycle.SUCCEEDED,
      'النجاحُ لم يلتزم — والمشهدَ افترضَ التزامَه',
    );
    assert.equal(committed['result']?.['نُفِّذ'], true);

    // القاعدةُ تعودُ والحياةُ الجديدةُ تُقلعُ: التسويةُ تقرأُ النجاحَ القائمَ
    // بالملاحظةِ (بصمةٌ مطابقةٌ من الحياةِ نفْسِها) — قيدٌ لا كتابةٌ ولا انتقالٌ جديد.
    await env.proxy?.up();
    const second = spawnWorker([...workerArgs, '--once']);
    const result = await second.exited();
    assert.equal(result.code, 0, `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
    assert.match(result.stdout, /pending-results \| سُوّيت: 1/);

    const after = await env.queue.get(task.id);
    assert.ok(after !== null);
    assert.equal(after.state, TaskLifecycle.SUCCEEDED);
    assert.equal(after.attempts, 1);
    assert.deepEqual(after.result?.['نُفِّذ'], true);
    const transitions = await env.queue.transitions(task.id);
    assert.equal(
      transitions.filter((entry) => entry.to === TaskLifecycle.SUCCEEDED).length,
      1,
      'انتقالا نجاحٍ — والملاحظةَ قيدٌ لا تنفيذ',
    );

    // والدليلُ في السجلِّ الدائم: تخزينٌ ثمّ قيدُ استيفاءٍ بالمطابقة.
    const reader = new PersistentEventLog(logFile, { env: { NODE_ENV: 'test' }, lock: false });
    try {
      const types = reader.events.map((event) => event.type);
      assert.ok(types.includes(PENDING_RESULT_STAGED_EVENT), types.join(','));
      assert.ok(types.includes(PENDING_RESULT_RESOLVED_EVENT), types.join(','));
    } finally {
      reader.close();
    }
  },
);

// ─── (14) التسويةُ لا تُعيدُ خصمَ الميزانية ──────────────────────────────────

test(
  'التسويةُ لا تُعيدُ خصمَ الميزانية: الخصمُ وقعَ مرّةً عندَ البدء، والتسويةُ استيفاءُ قيمةٍ لا تنفيذٌ جديد',
  { skip: skipWithoutDatabase },
  async (t) => {
    const env = await environment(t);
    // مفتاحٌ لاتينيٌّ: صاحبُ الحصةِ في دفترِ الحصصِ (‏`actor-<المفتاح>`) مقيَّدٌ
    // بنمطٍ لا يقبلُ العربيّةَ — وهذا حدُّ الدفترِ لا اختيارُ اختبار.
    const task = await enqueue(env.queue, 'budget-no-redebit', {
      budgetResource: 'inference-tokens',
      budgetAmount: 50,
    });
    const claimed = await env.queue.claim({ worker: 'عامل-س' });
    assert.equal(claimed.length, 1);
    const claimId = claimed[0]?.claimId;
    assert.ok(claimId !== null && claimId !== undefined);
    const claimedTask = claimed[0];
    assert.ok(claimedTask !== undefined);

    // الخصمُ الحقيقيُّ الذرّيُّ من مسارِ الإنتاجِ نفسِه: العلامةُ والدفترُ في معاملةٍ واحدة.
    const gate = createBudgetGate({
      pool: env.db.pool,
      ledger: createQuotaLedger({ pool: env.db.pool, definitions: loadPolicyBundle().quotas }),
    });
    const decision = await gate.chargeBeforeStart(claimedTask);
    assert.equal(decision.allowed, true, `رفضُ الخصمِ: ${JSON.stringify(decision)}`);
    assert.equal(decision.debited, true, 'الخصمُ لم يقع — والمشهدَ يفترضُه');

    const first = openStore(env.dir, 'عامل-س');
    await first.store.stage({
      taskId: task.id,
      attempt: 1,
      claimId,
      result: { القيمة: 'خُصمت مرّةً واحدة' },
    });
    first.close();

    // الدفترُ والعلامةُ قبلَ التسويةِ — للتقارنِ بعدها.
    const ledgerBefore = await env.db.pool
      .query(
        `SELECT subject_type, subject_id, resource, consumed FROM state.quotas ORDER BY resource`,
      )
      .then((found) => found.rows);
    const markBefore = await env.db.pool
      .query(`SELECT budget_debited_at FROM state.tasks WHERE id = $1`, [task.id])
      .then((found) => found.rows[0]?.['budget_debited_at']);

    const second = openStore(env.dir, 'عامل-س');
    const counts = await settlePendingResults({ store: second.store, queue: env.queue });
    assert.deepEqual(counts, { examined: 1, settled: 1, superseded: 0, conflicts: 0 });
    second.close();

    const after = await env.queue.get(task.id);
    assert.equal(after?.state, TaskLifecycle.SUCCEEDED);
    assert.deepEqual(after?.result, { القيمة: 'خُصمت مرّةً واحدة' });
    // الخصمُ مرّةً واحدة: الدفترُ والعلامةُ كما هما — التسويةُ استوفَت قيمةً
    // خُصمت عندَ بدئِها ولم تُنفّذ شيئاً يُحاسَبُ من جديد.
    const ledgerAfter = await env.db.pool
      .query(
        `SELECT subject_type, subject_id, resource, consumed FROM state.quotas ORDER BY resource`,
      )
      .then((found) => found.rows);
    const markAfter = await env.db.pool
      .query(`SELECT budget_debited_at FROM state.tasks WHERE id = $1`, [task.id])
      .then((found) => found.rows[0]?.['budget_debited_at']);
    assert.deepEqual(ledgerAfter, ledgerBefore, 'التسويةُ خصمت من الدفتر مرّةً ثانية');
    assert.deepEqual(
      markAfter,
      markBefore,
      'علامةُ الخصمِ تُعيدُ نفسَها أو تُمحى — وكلاهما محاسبةٌ زائفة',
    );
  },
);
