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
import { chmodSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { PersistentEventLog } from '../../src/root-of-trust/persistent-log.mjs';
import { createSealedEventSink } from '../../src/root-of-trust/production-runtime.mjs';
import { HaltSwitch, KingIdentity } from '../../src/root-of-trust/index.mjs';
import { createBudgetGate } from '../../src/execution/budget.mjs';
import { createQuotaLedger } from '../../src/policy/quota.mjs';
import { loadPolicyBundle } from '../../src/policy/loader.mjs';
import { QUEUE_ERRORS, createTaskQueue, QueueError } from '../../src/execution/queue.mjs';
import { TaskLifecycle } from '../../src/execution/lifecycle.mjs';
import {
  PENDING_RESULT_RESOLVED_EVENT,
  PENDING_RESULT_STAGED_EVENT,
  PendingResultConflict,
  createPendingResultStore,
  settlePendingResults,
  settleUntilAdmitted,
} from '../../src/execution/pending-results.mjs';
import { createWorker } from '../../src/execution/worker.mjs';
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
    assert.deepEqual(counts, {
      examined: 1,
      settled: 1,
      superseded: 0,
      conflicts: 0,
      deferred: false,
    });

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
    assert.deepEqual(counts, {
      examined: 1,
      settled: 0,
      superseded: 1,
      conflicts: 0,
      deferred: false,
    });

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
    assert.deepEqual(counts, {
      examined: 1,
      settled: 0,
      superseded: 0,
      conflicts: 1,
      deferred: false,
    });
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
    assert.deepEqual(counts, {
      examined: 1,
      settled: 1,
      superseded: 0,
      conflicts: 0,
      deferred: false,
    });
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

test(
  'المخزنُ المختومُ: القيمةُ تدومُ على القرصِ جسمًا مصونًا لا نصًّا ظاهرًا، وتُقرأُ بالخاتمِ لا بدونه',
  { skip: skipWithoutDatabase },
  async (t) => {
    const env = await environment(t);
    /** خاتمُ اختبارٍ على نمطِ خاتمِ الإنتاج: ختمٌ وفكٌّ، والجسمُ على القرصِ نصٌّ مصون. */
    const sealer = {
      keyId: '05',
      seal: async (/** @type {unknown} */ data) => ({ sealed: JSON.stringify(data) }),
      open: async (/** @type {unknown} */ sealed) =>
        JSON.parse(/** @type {{ sealed: string }} */ (sealed).sealed),
    };
    const file = path.join(env.dir, 'pending-sealed.jsonl');
    // هويةٌ حقيقيةٌ من الطابورِ: التسويةُ بعدَ الفتحِ تمضي على المسارِ الحقيقيِّ
    // كاملًا (`settlePendingResults` بطابورٍ حيٍّ) لا بفكِّّ يدويٍّ للقيدِ فقط.
    const task = await enqueue(env.queue, 'مختومة-بالهوية-الحقيقية');
    const claimed = await env.queue.claim({ worker: 'عامل-الختم' });
    assert.equal(claimed.length, 1);
    const claimId = claimed[0]?.claimId;
    assert.ok(claimId !== null && claimId !== undefined);
    const log = new PersistentEventLog(file, { sealer, fsync: false, env: {} });
    log.load();
    const sink = createSealedEventSink(log);
    const store = createPendingResultStore({ reader: log, writer: sink, worker: 'عامل-الختم' });
    await store.stage({
      taskId: task.id,
      attempt: 1,
      claimId,
      result: { القيمة: 'مصونة' },
    });
    // الجسمُ على القرصِ مصونٌ لا نصٌّ ظاهر: مفتاحُ الحدثِ لا يظهرُ في الجسمِ الخامّ.
    const rawEvent = log.events.find((event) => event.type === PENDING_RESULT_STAGED_EVENT);
    assert.ok(rawEvent !== undefined);
    assert.equal(
      typeof (/** @type {Record<string, unknown>} */ (rawEvent.data)?.['sealed']),
      'string',
      'الجسمُ على القرصُ نصٌّ ظاهر — والختمَ في الإنتاجِ واجبُ دوامٍ لا زينة',
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
    assert.equal(pending[0]?.claimId, claimId);
    // والقيدُ يُكتبُ مصونًا **عبرَ التسويةِ الحقيقيةِ نفسِها** — لا بيدٍ يدويةٍ
    // تحاكيها: `settlePendingResults` بطابورٍ حيٍّ يستهلكُ الهويةَ ويقيدُ الحكمَ.
    const counts = await settlePendingResults({ store: second, queue: env.queue });
    assert.deepEqual(counts, {
      examined: 1,
      settled: 1,
      superseded: 0,
      conflicts: 0,
      deferred: false,
    });
    reopened.close();
    const settled = await env.queue.get(task.id);
    assert.equal(settled?.state, TaskLifecycle.SUCCEEDED, 'التسويةُ فوقَ الجسمِ المصونِ لم تمضِ');
    assert.deepEqual(settled?.result, { القيمة: 'مصونة' });
    const third = new PersistentEventLog(file, { sealer, fsync: false, env: {} });
    third.load();
    const thirdStore = createPendingResultStore({
      reader: third,
      writer: createSealedEventSink(third),
      worker: 'عامل-الختم',
    });
    assert.deepEqual(await thirdStore.unresolved(), [], 'قيدُ التسويةِ المصونُ لم يُقرأ');
    third.close();
  },
);

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
  // قيمةٌ مخالفةٌ للهويةِ نفسِها: تضادٌّ يُقيَّدُ في الحالِ ولا يُختارُ منهما شيء —
  // وخطأٌ مسمّى يُرمى لا يُعطى إذنًا باستكمالِ النجاحِ بالقيمةِ الثانية.
  await assert.rejects(
    first.store.stage({ ...identity, result: { القيمة: 'المخالفة' } }),
    (error) => error instanceof PendingResultConflict,
  );
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
    assert.deepEqual(counts, {
      examined: 1,
      settled: 0,
      superseded: 1,
      conflicts: 0,
      deferred: false,
    });
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
    assert.deepEqual(deferred, {
      examined: 0,
      settled: 0,
      superseded: 0,
      conflicts: 0,
      deferred: true,
    });
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
    assert.deepEqual(counts, {
      examined: 1,
      settled: 1,
      superseded: 0,
      conflicts: 0,
      deferred: false,
    });
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

// ─── (12) بوابةُ الحجزِ تستهلكُ حصيلةَ التسويةِ لا عيّنتَها ───────────────────

test('بوابةُ الحجزِ: الحجزُ لا يقعُ ما دامتْ آخرُ تسويةٍ تقولُ «مؤجَّلةٌ» — ولو رُفعَ الإيقافُ بينَ المحاولتين، والاستئنافُ العائدُ أثناءَ المحاولةِ يعيدُ المنعَ لا القبولَ', async () => {
  // المشهدُ الذي لا يُصادُ خارجيًّا بميكروثانيةٍ: التسويةُ تقعُ تحتَ إيقافٍ
  // فتحملُ حصيلتُها `deferred: true`، ثمّ **يُستأنفُ الإيقافُ قبلَ أن يُسألَ
  // القبولُ** — فلو بُنيَ القبولُ على عيّنةِ الإيقافِ اللاحقةِ لا على الحصيلةِ
  // لحُجزَ فوقَ معلّقةٍ لم تُقضَ. والدورةُ المستخرجةُ (`settleUntilAdmitted`)
  // هي **العزفُ نفسُهُ الذي تدورُ به حلقةُ العاملِ** لا قرارٌ صرفٌ يُختبرُ
  // وحدَهُ: الحصيلةُ المؤجَّلةُ تعيدُ الدورةَ، والعطبُ إلى الاستردادِ،
  // والقبولُ لا يقعُ إلا بعدَ حصيلةٍ تقولُ الانقضاءَ.
  let haltedNow = true;
  let attempts = 0;
  let waits = 0;
  const outcome = await settleUntilAdmitted({
    halted: () => haltedNow,
    settle: async () => {
      attempts += 1;
      // محاولتانِ تعودانِ مؤجَّلتينِ (إيقافٌ عائدٌ أثناءَ المحاولةِ) ثمّ انقضاء.
      return attempts < 3 ? { fault: null, deferred: true } : { fault: null, deferred: false };
    },
    wait: async () => {
      waits += 1;
      // الاستئنافُ يقعُ **بعدَ حصيلةٍ مؤجَّلةٍ وقبلَ سؤالِ القبولِ** — عينُ
      // النافذةِ التي كانَتِ العيّنةُ اللاحقةُ تُبنى عليها.
      haltedNow = false;
    },
    stopped: () => false,
  });
  assert.equal(outcome.verdict, 'admitted', 'القبولُ لم يُبلَغْ بعدَ انقضاءِ التأجيلِ');
  assert.equal(attempts, 3, 'الحجزُ قُبلَ قبلَ انقضاءِ التأجيلِ');
  assert.equal(waits, 1);
  // والدورةُ نفسُها: العطبُ إلى الاستردادِ لا إلى حجزٍ أو انتظارٍ.
  const faultOutcome = await settleUntilAdmitted({
    halted: () => false,
    settle: async () => ({ fault: { kind: 'connection' }, deferred: false }),
    wait: async () => {},
    stopped: () => false,
  });
  assert.equal(faultOutcome.verdict, 'fault');
  assert.deepEqual(faultOutcome.fault, { kind: 'connection' });
  // والتوقفُ يقطعُ الدورةَ لا يُدوّرُها.
  const stoppedOutcome = await settleUntilAdmitted({
    halted: () => true,
    settle: async () => ({ fault: null, deferred: true }),
    wait: async () => {},
    stopped: () => true,
  });
  assert.equal(stoppedOutcome.verdict, 'stopped');
});

// ─── (13) الإلغاءُ المتأخّرُ لا يُبطلُ قيمةً وُلدت ───────────────────────────

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
    assert.deepEqual(counts, {
      examined: 1,
      settled: 1,
      superseded: 0,
      conflicts: 0,
      deferred: false,
    });
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
    // القيمةُ المُلتزمةُ **كاملةً** هي بعينِها ما خُزِّنَ قبلَ الالتزامِ: القتلُ
    // في نافذةِ ما بعدَه لا يبدّلُ الجوابَ ولا يُفلِتُ منه شيئًا.
    const stagedReader = new PersistentEventLog(logFile, {
      env: { NODE_ENV: 'test' },
      lock: false,
    });
    let stagedResult;
    try {
      const staged = stagedReader.events
        .map((event) => ({ type: event.type, data: event.data }))
        .find((event) => event.type === PENDING_RESULT_STAGED_EVENT);
      assert.ok(staged !== undefined, 'القيمةُ لم تُخزَّن قبلَ الالتزام');
      stagedResult = /** @type {Record<string, unknown>} */ (staged.data)?.['result'];
    } finally {
      stagedReader.close();
    }
    assert.deepEqual(committed['result'], stagedResult);

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
    // والجوابُ الباقي بعدَ التسويةِ هو بعينِه المُلتزَمُ والمخزَّنُ — قيدٌ لا تنفيذ.
    assert.deepEqual(after.result, committed['result']);
    assert.deepEqual(after.result, stagedResult);
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
    assert.deepEqual(counts, {
      examined: 1,
      settled: 1,
      superseded: 0,
      conflicts: 0,
      deferred: false,
    });
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

// ─── (15) التضادُّ يُكتشَفُ عندَ القراءةِ ويوقفُ المسارَ لا يختار ────────────────

test(
  'تضادٌّ بلا حكمٍ بينَهما (قتلٌ بينَ التخزينِ الثاني والقيد): القراءةُ نفسُها تكتشفُهُ وتمنعُ التسويةَ الآلية — ولا يُختارُ الأخيرُ صامتاً',
  { skip: skipWithoutDatabase },
  async (t) => {
    const env = await environment(t);
    const identity = {
      taskId: 'مهمة-تضاد-القراءة',
      attempt: 1,
      claimId: '44444444-4444-4444-8444-444444444444',
    };
    // الحياةُ الأولىُ خزّنت قيمةً ثمّ قُتلت قبلَّ القيدِ؛ والحياةُ الثانيةُ خزّنت
    // **مخالفةً** ثمّ قُتلت قبلَّ قيدِ التضادِّ — لا حكمَ في السجلِّ بينَهما.
    const first = openStore(env.dir, 'عامل-القراءة', 'conflict.jsonl');
    await first.store.stage({ ...identity, result: { القيمة: 'الأولى' } });
    // التخزينُ الثاني يُكتبُ مباشرةً في السجلِّ (قتلٌ بينَ appendStaged وappendResolved):
    const raw = new PersistentEventLog(first.file, { env: { NODE_ENV: 'test' }, lock: false });
    raw.append(PENDING_RESULT_STAGED_EVENT, 'worker:عامل-القراءة', {
      taskId: identity.taskId,
      worker: 'عامل-القراءة',
      attempt: identity.attempt,
      claimId: identity.claimId,
      result: { القيمة: 'المخالفة' },
    });
    raw.close();
    first.close();

    // القراءةُ تكتشفُ التضادَّ وتُعلِّمُه — لا اختيارَ للأخيرِ ولا للأول.
    const second = openStore(env.dir, 'عامل-القراءة', 'conflict.jsonl');
    const pending = await second.store.unresolved();
    assert.equal(pending.length, 1);
    assert.equal(pending[0]?.conflict, true, 'القراءةُ لم تكتشفِ التضادَّ — وسيُختارُ صامتاً');
    // والتسويةُ تُسمّيهِ ولا تكتبُ قيمةً في القاعدةِ (المهمّةُ غيرُ موجودةٍ أصلاً —
    // والمسارُ المصروفُ للقاعدةِ ما كانَ ليُمسَّ).
    const counts = await settlePendingResults({ store: second.store, queue: env.queue });
    assert.deepEqual(counts, {
      examined: 1,
      settled: 0,
      superseded: 0,
      conflicts: 1,
      deferred: false,
    });
    const verdicts = second
      .events()
      .filter((event) => event.type === PENDING_RESULT_RESOLVED_EVENT);
    second.close();
    assert.equal(
      /** @type {Record<string, unknown> | undefined} */ (verdicts[0]?.data)?.['outcome'],
      'conflict',
      'حكمُ التضادِّ لم يُقيَّد',
    );
  },
);

// ─── (16) التضادُّ اللاصقُ: وسمٌ لا يسقطُ بإعادةِ تخزينٍ مطابقةٍ ───────────────

test(
  'التضادُّ لاصقٌ: قيمةٌ ثالثةٌ مطابقةٌ للمحتجَزةِ لا تمحو وسمَ التضادِّ ولا تُعيدُ الإذنَ — والقرارُ لمالكٍ لا لمُعيدِ التخزينِ',
  { skip: skipWithoutDatabase },
  async (t) => {
    const env = await environment(t);
    const task = await enqueue(env.queue, 'تضاد-لاصق');
    const claimed = await env.queue.claim({ worker: 'عامل-اللاصق' });
    assert.equal(claimed.length, 1);
    const claimId = claimed[0]?.claimId;
    assert.ok(claimId !== null && claimId !== undefined);

    // النافذةُ القاتلةُ بعينِها: تخزينانِ (أ ثمّ ب) **بلا قيدِ حكمٍ بينَهما** —
    // قتلٌ بينَ التخزينِ الثاني وقيدِ التضادِّ. ثمّ حياةٌ جديدةٌ تُعيدُ تخزينَ
    // الأولى (أ) مطابقةً للمحتجَزةِ: الوسمُ لا يسقطُ ولا يُعادُ الإذنُ بها.
    const stickyDir = registerTmpRoot(mkdtempSync(path.join(tmpdir(), 'wl392-sticky-')));
    t.after(() => rmSync(stickyDir, { recursive: true, force: true }));
    const rawLog = new PersistentEventLog(path.join(stickyDir, 'sticky.jsonl'), {
      env: { NODE_ENV: 'test' },
    });
    /** @param {Record<string, unknown>} result */
    const appendStaged = (result) =>
      rawLog.append(PENDING_RESULT_STAGED_EVENT, 'عامل-اللاصق', {
        taskId: task.id,
        worker: 'عامل-اللاصق',
        attempt: 1,
        claimId,
        result,
      });
    appendStaged({ القيمة: 'أ' });
    appendStaged({ القيمة: 'ب' }); // قُتلَ العاملُ قبلَ قيدِ الحكمِ
    appendStaged({ القيمة: 'أ' }); // وحياةٌ ثالثةٌ أعادتِ الأولى مطابقةً — ثمّ قُتلتْ قبلَ الحكمِ
    rawLog.close();
    // فالسجلُ نفسُهُ صارَ: أ، ب، أ — بلا قيدِ حكمٍ بينَها. والقراءةُ هي الحكمُ:
    // التخزينُ الثالثُ المطابقُ **لا يمحو الوسمَ** — فالقيمتانِ المختلفتانِ
    // قامتا دليلًا ولا اختيارَ لأطرافِ السجلِّ في محوِ التضادِّ.

    const reopened = openStore(stickyDir, 'عامل-اللاصق', 'sticky.jsonl');
    // القراءةُ نفسُها تكتشفُ التضادَّ (دليلانِ بلا حكمٍ) وتمسكُ المحتجَزةَ (أ)
    const first = await reopened.store.unresolved();
    assert.equal(first.length, 1);
    assert.equal(first[0]?.conflict, true, 'التضادُّ لم يُكتشف عندَ القراءة');
    assert.deepEqual(first[0]?.result, { القيمة: 'أ' });
    // إعادةُ تخزينِ المطابقةِ (أ) **لا تُعيدُ الإذنَ**: التضادُّ قائمٌ لم يُقضَ
    // فلا استكمالُ نجاحٍ بالقيمةِ المحتجَزةِ بعدَ أن قامتِ المخالفةُ دليلًا.
    await assert.rejects(
      () =>
        reopened.store.stage({
          taskId: task.id,
          attempt: 1,
          claimId,
          result: { القيمة: 'أ' },
        }),
      (error) => error instanceof PendingResultConflict,
    );
    // والوسمُ لا يسقطُ صامتاً: إعادةُ التخزينِ قيّدتِ التضادَّ **حكمًا مُسمّى**
    // (لا اختيارَ للقيمةِ) فلم يعدْ للمعلّقةِ وجودٌ كقيدٍ مفتوحٍ — الحكمُ دليلٌ
    // يُقرأُ لا محوٌ للتضادّ. والتسويةُ بعدها لا تجدُ معلّقًا ولا تكتبُ شيئاً.
    const second = await reopened.store.unresolved();
    assert.deepEqual(second, [], 'التضادُّ تُركَ بلا حكمٍ بعدَ إعادةِ التخزينِ');
    const verdicts = reopened
      .events()
      .filter((event) => event.type === PENDING_RESULT_RESOLVED_EVENT);
    assert.equal(verdicts.length, 1, 'حكمُ التضادِّ لم يُقيَّد عندَ إعادةِ التخزينِ');
    assert.equal(
      /** @type {Record<string, unknown> | undefined} */ (verdicts[0]?.data)?.['outcome'],
      'conflict',
      'الحكمُ المقيَّدُ ليسَ تضادًّا',
    );
    const counts = await settlePendingResults({ store: reopened.store, queue: env.queue });
    assert.deepEqual(counts, {
      examined: 0,
      settled: 0,
      superseded: 0,
      conflicts: 0,
      deferred: false,
    });
    const after = await env.queue.get(task.id);
    assert.equal(after?.state, TaskLifecycle.RUNNING, 'كُتب في القاعدةِ فوقَ تضادٍّ لم يُقضَ');
    assert.equal(after?.result, null);
    reopened.close();
  },
);

test(
  'مسارُ العاملِ الكاملُ عندَ التضادِّ: لا تُكتبُ أيٌّ من القيمتَينِ في القاعدةِ — خطأٌ مسمّى يوقفُ لا التهامٌ يُمرِّر',
  { skip: skipWithoutDatabase },
  async (t) => {
    const env = await environment(t);
    // مهمّةٌ منتظرةٌ لا محجوزةً: العاملُ نفسُهُ يحجزُها في `tick` ويُشغّلُ مُعالِجَها.
    const task = await enqueue(env.queue, 'تضاد-مسار-العامل');

    // مخزنٌ يواجهُ التضادَّ: التخزينُ يرمي `PendingResultConflict` كما يفعلُ المخزنُ
    // الحقيقيُّ عندَ قيمةٍ مخالفةٍ لهويةٍ لها قيمةٌ معلّقة.
    const store = createPendingResultStore({
      /** قارئٌ صوريٌّ لا يُقرأ منه — التخزينُ مُبدَّلٌ أسفلَه ليرميَ التضادَّ. */
      reader:
        /** @type {import('../../src/root-of-trust/persistent-log.mjs').PersistentEventLog} */ (
          /** @type {unknown} */ ({ events: [], sealed: false })
        ),
      writer: {
        append: () => {},
        drain: async () => {},
      },
      worker: 'عامل-التضاد',
    });
    store.stage = async () => {
      throw new PendingResultConflict(task.id, 'mock-claim');
    };

    const worker = createWorker({
      queue: env.queue,
      pool: env.db.pool,
      haltGuard: { assertOperational: () => {} },
      worker: 'عامل-التضاد',
      pendingResults: store,
    });
    // المُعالِجُ أنتجَ قيمةً (مُعالِجُ الاختبارِ الحقيقيُّ)، والتخزينُ رفضَها تضادًّا:
    // المسارُ يرمي الخطأَ المسمّى ولا يُكتبُ شيءٌ في القاعدةِ.
    await assert.rejects(
      () => worker.tick(),
      (error) => error instanceof PendingResultConflict,
    );
    const after = await env.queue.get(task.id);
    assert.equal(after?.state, TaskLifecycle.RUNNING, 'قيمةٌ كُتبت في القاعدةِ رغمَ التضادّ');
    assert.equal(after?.result, null);
  },
);

// ─── (16) الهجرةُ على قاعدةٍ قائمةٍ فيها صفوفٌ جارية ──────────────────────────

test(
  'الهجرةُ 0022 على قاعدةٍ من الإصدارِ 21 فيها مهماتٌ جاريةٌ ومنتظرةٌ ونهائية: كلُّ جاريةٍ تأخذُ معرِّفاً مستقلاً والقيدَ يقومُ',
  { skip: skipWithoutDatabase },
  async (t) => {
    const db = await createIsolatedDatabase('wl392mig');
    t.after(async () => {
      await db.drop();
    });
    // قاعدةٌ على الإصدارِ 21 بالضبطِ — كما كانت قواعدُ الإنتاجِ قبلَ هذه الهجرة.
    await up(db.pool, { to: 21 });
    const base = new URL(/** @type {string} */ (databaseUrl()));
    void base;
    /**
     * إدراجُ صفوفٍ بأدنى الأعمدةِ اللازمةِ: جاريتانِ ومنتظرةٌ ونهائية. والجاريةُ
     * تلزمُها أعمدةُ العقدِ (`tasks_running_needs_lease` من `0004`).
     * @param {string} id
     * @param {'running' | 'scheduled' | 'succeeded'} state
     */
    const insert = (id, state) =>
      db.pool.query(
        `INSERT INTO state.tasks (id, idempotency_key, action, target, actor_id, root_id, state, attempts, max_attempts, available_at, timeout_ms, memory_limit_mb, budget_amount, created_at, state_changed_at, lease_owner, lease_expires_at, started_at, finished_at)
         VALUES ($1, $2, 'اختبار.نجاح', 'موضوع/هجرة', 'actor-mig', $1, $3, 1, 3, now(), 10000, 96, 0, now(), now(),
                 CASE WHEN $4 THEN 'عامل-هجرة' ELSE NULL END,
                 CASE WHEN $4 THEN now() + interval '60 seconds' ELSE NULL END,
                 CASE WHEN $4 THEN now() ELSE NULL END,
                 CASE WHEN $5 THEN now() ELSE NULL END)`,
        [id, `mig-${id}`, state, state === 'running', state === 'succeeded'],
      );
    await insert('11111111-1111-4111-8111-111111111111', 'running');
    await insert('12222222-2222-4222-8222-222222222222', 'running');
    await insert('13333333-3333-4333-8333-333333333333', 'scheduled');
    await insert('14444444-4444-4444-8444-444444444444', 'succeeded');

    // الهجرةُ 22 على قاعدةٍ قائمةٍ: لا فشلَ في القيدِ، وكلُّ جاريةٍ معرِّفٌ مستقل.
    await up(db.pool);
    const rows = await db.pool.query(`SELECT id, state, claim_id FROM state.tasks ORDER BY id`);
    const byState = new Map(rows.rows.map((row) => [row['state'], row]));
    const runningIds = rows.rows
      .filter((row) => row['state'] === 'running')
      .map((row) => String(row['claim_id']));
    assert.equal(runningIds.length, 2);
    assert.ok(
      runningIds.every((id) => id !== null),
      'مهمةٌ جاريةٌ بقيت بلا معرِّفِ حجزٍ بعدَ الهجرةِ — والقيدَ يرفضُها',
    );
    assert.notEqual(runningIds[0], runningIds[1], 'حجزانِ تشاطرا معرِّفاً واحداً');
    assert.equal(byState.get('scheduled')?.['claim_id'], null);
    assert.equal(byState.get('succeeded')?.['claim_id'], null);
  },
);

// ─── (17) عطبُ قاعدةٍ عندَ إقلاعِ التسويةِ يؤجّلُ الحجزَ ثمّ يُسوّي قبلَه ───────

test(
  'القاعدةُ مقطوعةٌ عندَ الإقلاعِ ونتيجةٌ معلّقةٌ وشقٌّ جديدٌ منتظر: التسويةُ تُستوفى قبلَ حجزِ الشقِّ الجديدِ لا بعده',
  {
    skip: skipWithoutDatabase || !probeIsolation().available,
    timeout: 90_000,
  },
  async (t) => {
    const env = await environment(t, { proxy: true });
    // نتيجةٌ معلّقةٌ من حياةٍ ماتت (تُخزَّن بيدِ الاختبارِ كما خزّنها العاملُ الحقيقيُّ
    // في حياتِهِ الأولى) وشقٌّ جديدٌ منتظرٌ يُحجزُ متى سُمح.
    const first = await enqueue(env.queue, 'تسوية-قبل-الحجز');
    const claimed = await env.queue.claim({ worker: 'عامل-الإقلاع-المقطوع' });
    assert.equal(claimed.length, 1);
    const claimId = claimed[0]?.claimId;
    assert.ok(claimId !== null && claimId !== undefined);
    const store = openStore(env.dir, 'عامل-الإقلاع-المقطوع', 'worker-log.jsonl');
    await store.store.stage({
      taskId: first.id,
      attempt: 1,
      claimId,
      result: { القيمة: 'من-الحياة-الميتة' },
    });
    store.close();
    // الشقُّ الجديدُ سيُنفَّذَ فعلاً في العزلِ داخلَ العمليةِ الحيّةِ: سقفُ ذاكرةٍ يتّسعُ لـNode.
    const second = await enqueue(env.queue, 'شق-جديد-بعد-التسوية', ISOLATED_TASK);

    const logFile = path.join(env.dir, 'worker-log.jsonl');
    const king = new KingIdentity();
    const haltFile = path.join(env.dir, 'state', 'halt.json');
    const publicKey = String(king.publicKey.export({ type: 'spki', format: 'pem' }));
    const outputRoot = path.join(ROOT, '.isolation-output', `wl392c-${Date.now()}`);
    t.after(() => {
      rmSync(outputRoot, { recursive: true, force: true });
    });

    // **قطعٌ انتقائيٌّ لا إطفاءٌ كاملٌ:** يُقطعُ استعلامُ قراءةِ المهمّةِ نفسُه
    // (`SELECT … FROM state.tasks WHERE id = $1` — أولُ ما تقرأُهُ التسويةُ عندَ
    // الإقلاعِ) **قبلَّ تمريرِهِ** والوسيطُ باقٍ: فالقاعدةُ متاحةٌ لكلِّ ما عدا
    // قراءةَ التسويةِ. وبهذا يُقاسُ أنَّ عطبَ التسويةِ **وحدَهُ** — لا عطبُ حجزٍ
    // لاحقٌ يُشبهُه — يُؤجّلُ الحجزَ: لو ابتُلِعَ عطبُ التسويةِ لحُجزَ الشقُّ
    // الجديدُ فورًا (القاعدةُ متاحةٌ) ولم تُطبعْ تسويةٌ قطعًا.
    env.proxy?.severOn('FROM state.tasks WHERE id = $1', { mode: 'before', thenDown: false });
    const child = spawn(
      process.execPath,
      [
        WORKER_SCRIPT,
        '--worker',
        'عامل-الإقلاع-المقطوع',
        '--max-tasks',
        '1',
        '--poll-ms',
        '50',
        '--db-recovery-max-probes',
        '400',
        '--db-recovery-base-ms',
        '20',
        '--db-recovery-max-ms',
        '100',
      ],
      {
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
      },
    );
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
    t.after(() => {
      if (child.exitCode === null) child.kill('SIGKILL');
    });
    await until(() => stdout.includes('pending-results | عَطِلةُ قاعدةٍ عندَ التسويةِ'), 30_000);
    // والمرحلةُ المسؤولةُ هي `settle-pending` بعينِها: هذا الخطُّ لا يُطبعُ إلا
    // من مسارِ تصنيفِ عطبِ التسويةِ (لا من مسارِ الحجزِ)، والاستردادُ بعدهُ
    // يمضّي على الميزانيةِ لا بدورانٍ فارغٍ.
    await until(() => stdout.includes('db-recovery | recovered'), 30_000);

    // القاعدةُ لم تنقطعْ قطعًا كاملًا: الاستردادُ عاجزٌ عن قراءةِ التسويةِ
    // وحدها ثمّ **التسويةُ قبلَ أولِ حجزٍ جديدٍ** — والشقُّ الجديدُ لا يُحجزُ قبلها.
    const result = await exited;
    assert.equal(result.code, 0, `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`);

    const settleAt = result.stdout.indexOf('pending-results | سُوّيت: 1');
    assert.ok(settleAt >= 0, `التسويةُ لم تُطبع:\n${result.stdout}`);
    const settled = await env.queue.get(first.id);
    assert.equal(
      settled?.state,
      TaskLifecycle.SUCCEEDED,
      'النتيجةُ المعلّقةُ لم تُسوَّ بعدَ عودةِ القاعدة',
    );
    assert.deepEqual(settled?.result, { القيمة: 'من-الحياة-الميتة' });
    assert.equal(settled?.attempts, 1, 'التسويةُ أُعيدت تشغيلاً — وهي استيفاءٌ لا تنفيذ');
    // والشقُّ الجديدُ حُجز ونُفِّذ — والدليلُ أنَّ التسويةَ سبقتهُ في المخرجاتِ.
    const after = await env.queue.get(second.id);
    assert.equal(
      after?.state,
      TaskLifecycle.SUCCEEDED,
      `الشقُّ الجديدُ لم يُنفَّذ\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
    );
    const doneAt = result.stdout.indexOf(`done | ${second.id}`);
    assert.ok(doneAt > settleAt, 'حُجز الشقُّ الجديدُ قبلَّ تسويةِ المعلّقةِ — والحقَّ أحقُّ');
    // **حدُّ الحجزِ لا حدُّ الإنجازِ:** الإنجازُ (`done`) نهايةُ التنفيذِ لا
    // لحظةُ الحجزِ. الحدُّ المحسوسُ هو **حجزُ الشقِّ الثاني لا يسبقُ تسويةَ
    // المعلّقةِ** (انتقالُهُ إلى `running` لا يسبقُ انتقالَها إلى `succeeded`) —
    // من `state.task_transitions` ذاتِها لا من ترتيبِ سطورِ المخرجاتِ.
    const firstTrail = await env.queue.transitions(first.id);
    const secondTrail = await env.queue.transitions(second.id);
    const firstSettledAt = firstTrail.find((entry) => entry['to'] === TaskLifecycle.SUCCEEDED)?.[
      'at'
    ];
    const secondClaimedAt = secondTrail.find((entry) => entry['to'] === TaskLifecycle.RUNNING)?.[
      'at'
    ];
    assert.ok(firstSettledAt !== undefined, 'لا انتقالَ نجاحٍ للمعلّقةِ');
    assert.ok(secondClaimedAt !== undefined, 'لا انتقالَ حجزٍ للشقِّ الجديدِ');
    assert.ok(
      firstSettledAt <= secondClaimedAt,
      'حُجزَ الشقُّ الجديدُ قبلَ تسويةِ المعلّقةِ (من سجلِّ الانتقالاتِ نفسِهِ)',
    );
    // **والمرحلةُ المسؤولةُ تُقرأُ من القيدِ لا من خطِّ المخرجاتِ:** واقعةُ
    // `kernel.worker.db-recovery` في سجلِّ العاملِ الدائمِ تحملُ في جسمِها
    // `phase: 'settle-pending'` — العقدُ الذي وقَّعَهُ مصنِّفُ العطبِ على
    // القاعدةِ (خطُّ المخرجاتِ يطبعُهُ لكنّ القيدَ هو الحجة).
    const workerLog = new PersistentEventLog(logFile, { env: { NODE_ENV: 'test' } });
    try {
      workerLog.load({ acceptMissingHead: true });
      const recoveryEvents = workerLog.events.filter(
        (event) => event.type === 'kernel.worker.db-recovery',
      );
      assert.ok(recoveryEvents.length > 0, 'لا واقعةَ استردادٍ في سجلِّ العاملِ');
      // السجلُّ هنا غيرُ مختومٍ (بيئةُ اختبارٍ) فالجسمُ يُقرأُ من `data` مباشرةً —
      // أما المختومُ فيُفتحُ بخاتمِهِ وهذا عينُ عقدِ القراءةِ المختومةِ.
      /** @type {Array<Record<string, unknown>>} */
      const bodies = recoveryEvents.map(
        (event) => /** @type {Record<string, unknown>} */ (event.data),
      );
      assert.ok(
        bodies.some((body) => body['phase'] === 'settle-pending'),
        'لا واقعةَ استردادٍ بمرحلةِ settle-pending — الحجزُ لم يُؤجَّلْ لعطبِ التسويةِ',
      );
    } finally {
      workerLog.close();
    }
  },
);

test(
  'خطأُ قراءةٍ لا يعودُ للقاعدةِ عندَ الإقلاعِ يوقفُ العاملَ لا يُمرَّر: خروجٌ غيرُ صفريٍّ ولا حجزَ ولا تسويةً صامتة',
  {
    skip: skipWithoutDatabase || !probeIsolation().available,
    timeout: 60_000,
  },
  async (t) => {
    const env = await environment(t);
    const first = await enqueue(env.queue, 'قراءة-مكسورة');
    const claimed = await env.queue.claim({ worker: 'عامل-القراءة-المكسورة' });
    assert.equal(claimed.length, 1);
    const claimId = claimed[0]?.claimId;
    assert.ok(claimId !== null && claimId !== undefined);
    const store = openStore(env.dir, 'عامل-القراءة-المكسورة', 'worker-log.jsonl');
    await store.store.stage({
      taskId: first.id,
      attempt: 1,
      claimId,
      result: { القيمة: 'دائمة' },
    });
    store.close();

    // السجلُ الدائمُ يُصبحُ غيرَ قابلٍ للكتابةِ: أولُ محاولةِ إلحاقٍ (قيدُ
    // التسويةِ نفسِهِ) ترمي خطأَ نظامِ ملفاتٍ لا عطبَ قاعدةٍ — فالتصنيفُ يرميهِ
    // كما هو لا أن يُبتلَعَ فيمرَّرَ الكاسبُ فوقَه.
    chmodSync(store.file, 0o444);
    // تنظيفُ الصلاحيةِ دفاعيٌّ: تنظيفُ الجذرِ المؤقّتِ (المسجَّلُ قبلَ هذا الخطّافِ)
    // قد يسبقُه في الترتيبِ فيحذفُ الملفَ — والمقصودُ من الخطّافِ استعادةُ قابليةِ
    // الكتابةِ للملفِ الباقي لا الإخلالُ بالتنظيفِ نفسِه.
    t.after(() => {
      if (existsSync(store.file)) chmodSync(store.file, 0o644);
    });

    const logFile = path.join(env.dir, 'worker-log.jsonl');
    const king = new KingIdentity();
    const haltFile = path.join(env.dir, 'state', 'halt.json');
    const publicKey = String(king.publicKey.export({ type: 'spki', format: 'pem' }));
    const outputRoot = path.join(ROOT, '.isolation-output', `wl392d-${Date.now()}`);
    t.after(() => {
      rmSync(outputRoot, { recursive: true, force: true });
    });
    const child = spawn(
      process.execPath,
      [WORKER_SCRIPT, '--worker', 'عامل-القراءة-المكسورة', '--max-tasks', '5', '--poll-ms', '50'],
      {
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
      },
    );
    const exited = new Promise((resolve) => child.on('exit', (code) => resolve(code)));
    t.after(() => {
      if (child.exitCode === null) child.kill('SIGKILL');
    });
    const code = await exited;
    assert.notEqual(code, 0, 'خطأٌ غيرُ عطبِ قاعدةٍ مرَّ صامتاً — والعاملَ كانَ يجبُ أن يقف');
    // ولا حجزَ ولا تسويةً: المهمّةُ كما كانت والشقُّ بلا كتابةٍ.
    const after = await env.queue.get(first.id);
    assert.equal(after?.state, TaskLifecycle.RUNNING);
    assert.equal(after?.result, null);
  },
);

// ─── (18) إقلاعٌ موقوفٌ ثمّ استئناف: التسويةُ قبلَ أولِ حجزٍ ────────────────────

test(
  'إقلاعٌ تحتَ الإيقافِ السياديّ معَ نتيجةٍ معلّقةٍ وشقٍّ منتظرٍ، ثمّ استئناف: التسويةُ تُقضى قبلَ حجزِ الشقِّ الجديدِ لا بعده',
  {
    skip: skipWithoutDatabase || !probeIsolation().available,
    timeout: 90_000,
  },
  async (t) => {
    const env = await environment(t);
    const first = await enqueue(env.queue, 'إيقاف-ثم-استئناف');
    const claimed = await env.queue.claim({ worker: 'عامل-الإيقاف' });
    assert.equal(claimed.length, 1);
    const claimId = claimed[0]?.claimId;
    assert.ok(claimId !== null && claimId !== undefined);
    const store = openStore(env.dir, 'عامل-الإيقاف', 'worker-log.jsonl');
    await store.store.stage({
      taskId: first.id,
      attempt: 1,
      claimId,
      result: { القيمة: 'مؤجَّلة-بالإيقاف' },
    });
    store.close();
    // الشقُّ الجديدُ سيُنفَّذَ فعلاً في العزلِ بعدَ الاستئنافِ: سقفُ ذاكرةٍ يتّسعُ لـNode.
    const second = await enqueue(env.queue, 'شق-بعد-الاستئناف', ISOLATED_TASK);

    const logFile = path.join(env.dir, 'worker-log.jsonl');
    const king = new KingIdentity();
    const haltFile = path.join(env.dir, 'state', 'halt.json');
    const publicKey = String(king.publicKey.export({ type: 'spki', format: 'pem' }));
    // مفتاحُ إيقافٍ حقيقيٌّ موقَّعٌ بملكٍ: العاملُ قارئٌ له والملكُ كاتبُه.
    const royalCommand = { id: `cmd:wl392-${Date.now()}` };
    const halt = new HaltSwitch(haltFile, king, {
      fsync: false,
      royalCommandVerifier: (command) => command.id === royalCommand.id,
    });
    halt.halt('اختبارُ إيقافٍ عندَ الإقلاعِ', royalCommand);
    const outputRoot = path.join(ROOT, '.isolation-output', `wl392e-${Date.now()}`);
    t.after(() => {
      rmSync(outputRoot, { recursive: true, force: true });
    });

    const child = spawn(
      process.execPath,
      [WORKER_SCRIPT, '--worker', 'عامل-الإيقاف', '--max-tasks', '1', '--poll-ms', '50'],
      {
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
      },
    );
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
    t.after(() => {
      if (child.exitCode === null) child.kill('SIGKILL');
    });

    // تحتَ الإيقافِ: لا حجزَ للشقِّ الجديدِ ولا تسويةً ولا كتابةَ — التأجيلُ لا
    // الإلغاءُ ولا التجاوز.
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    assert.ok(!stdout.includes('سُوّيت'), `تسويةٌ تحتَ الإيقاف:\n${stdout}`);
    let after = await env.queue.get(second.id);
    assert.equal(after?.state, TaskLifecycle.SCHEDULED, 'حُجز شقٌّ جديدٌ تحتَ الإيقاف');
    assert.equal((await env.queue.get(first.id))?.state, TaskLifecycle.RUNNING);

    // الاستئنافُ: التسويةُ المُؤجَّلةُ تُقضى قبلَ أولِ حجزٍ جديدٍ — فالقيمةُ
    // المعلّقةُ أحقُّ من شقٍّ جديد.
    halt.resume('استئنافٌ بعدَ إيقافِ الإقلاعِ', royalCommand);
    const result = await exited;
    assert.equal(result.code, 0, `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
    const settleAt = result.stdout.indexOf('pending-results | سُوّيت: 1');
    assert.ok(settleAt >= 0, `التسويةُ المؤجَّلةُ لم تُقضَ بعدَ الاستئناف:\n${result.stdout}`);
    const settled = await env.queue.get(first.id);
    assert.equal(settled?.state, TaskLifecycle.SUCCEEDED);
    assert.deepEqual(settled?.result, { القيمة: 'مؤجَّلة-بالإيقاف' });
    assert.equal(settled?.attempts, 1, 'الاستئنافُ أعادَ تشغيلَ المُعالِج');
    after = await env.queue.get(second.id);
    assert.equal(after?.state, TaskLifecycle.SUCCEEDED, 'الشقُّ الجديدُ لم يُنفَّذ بعدَ الاستئناف');
    const doneAt = result.stdout.indexOf(`done | ${second.id}`);
    assert.ok(doneAt > settleAt, 'حُجز الشقُّ الجديدُ قبلَّ تسويةِ المعلّقةِ بعدَ الاستئناف');
    // **حدُّ الحجزِ من سجلِّ الانتقالاتِ ذاتِهِ** (لا من ترتيبِ سطورِ
    // المخرجاتِ): **حجزُ الشقِّ الجديدِ لا يسبقُ تسويةَ المعلّقةِ** (انتقالُهُ
    // إلى `running` لا يسبقُ انتقالَها إلى `succeeded`) — وهو الحدُّ الذي يحملُهُ العاملُ
    // **من حصيلةِ التسويةِ نفسِها** (`deferred`) لا من عيّنةٍ لاحقةٍ لحالةِ
    // الإيقافِ (فلو بُنيَ العلمُ من العيّنةِ لا من الحصيلةِ لا افتُرضَ القبولُ
    // حينَ يُستأنفُ الإيقافُ بينَ التسويةِ والعيّنةِ — وحُجزَ فوقَ معلّقةٍ).
    const firstTrail = await env.queue.transitions(first.id);
    const secondTrail = await env.queue.transitions(second.id);
    const firstSettledAt = firstTrail.find((entry) => entry['to'] === TaskLifecycle.SUCCEEDED)?.[
      'at'
    ];
    const secondClaimedAt = secondTrail.find((entry) => entry['to'] === TaskLifecycle.RUNNING)?.[
      'at'
    ];
    assert.ok(firstSettledAt !== undefined, 'لا انتقالَ نجاحٍ للمعلّقةِ');
    assert.ok(secondClaimedAt !== undefined, 'لا انتقالَ حجزٍ للشقِّ الجديدِ');
    assert.ok(
      firstSettledAt <= secondClaimedAt,
      'حُجزَ الشقُّ الجديدُ قبلَ تسويةِ المعلّقةِ (من سجلِّ الانتقالاتِ نفسِهِ)',
    );
  },
);

// ─── (19) سباقُ الإلغاءِ معَ التسويةِ تحتَ قفلِ الصفِّ ────────────────────────

test(
  'سباقُ الإلغاءِ معَ التسويةِ تحتَ قفلِ الصفِّ بالترتيبَينِ: القيمةُ التي وُلدت تقومُ — والإشارةُ المتأخّرةُ لا تُبطلُها (كالمسارِ المباشرِ)',
  { skip: skipWithoutDatabase },
  async (t) => {
    const env = await environment(t);

    /**
     * يُقيسُ ترتيبًا حتميًّا واحدًا من السباقِ: وصلةٌ تمسكُ قفلَ الصفِّ وتُنفِّذُ
     * إشارتَها، والتسويةُ تنتظرُ القفلَ ثمّ تمضي — لا صدفةَ توقيتٍ.
     * @param {'cancel-first' | 'settle-first'} order
     */
    const race = async (order) => {
      const task = await enqueue(env.queue, `سباق-الإلغاء-${order}`);
      const claimed = await env.queue.claim({ worker: 'عامل-السباق' });
      assert.equal(claimed.length, 1);
      const claimId = claimed[0]?.claimId;
      assert.ok(claimId !== null && claimId !== undefined);
      const value = { القيمة: `وُلدت-قبل-الإشارة-${order}` };
      const store = openStore(env.dir, 'عامل-السباق', `race-${order}.jsonl`);
      await store.store.stage({ taskId: task.id, attempt: 1, claimId, result: value });
      store.close();

      if (order === 'settle-first') {
        // **ترتيبٌ متتابعٌ لا تداخلٌ قسريٌّ:** التسويةُ تكتملُ أوّلًا ثمّ تصلُ
        // الإشارةُ إلى مهمّةٍ نجحت فتتجاوزُها — هذا نصفُ المشهدِ متتابعًا بطبيعته
        // (الإشارةُ «متأخّرة» وقعت بعد اكتمالِ كلّ شيء)، والتداخلُ القسريُّ
        // مقيسٌ في الشقِّ الآخرِ أدناه.
        const settleStore = openStore(env.dir, 'عامل-السباق', `race-${order}.jsonl`);
        try {
          const counts = await settlePendingResults({
            store: settleStore.store,
            queue: env.queue,
          });
          assert.equal(counts.settled, 1);
        } finally {
          settleStore.close();
        }
        await env.queue.cancelTree({ taskId: task.id, reason: 'إشارة متأخّرة' });
      } else {
        // **تداخلٌ قسريٌّ مُثبَتٌ لا مُفترَضٌ:** وصلةٌ تمسكُ قفلَ الصفِّ
        // (`FOR UPDATE`) وتلتزمُ إشارتَها ذرّيًّا داخلَ معاملتِها، بينما التسويةُ
        // انطلقتْ و**يُثبَتُ من القاعدةِ نفسِها أنّها بلغتِ الـ`UPDATE` ووقفتْ على
        // قفلِ هذه المعاملةِ بعينِها** قبلَ فكِّهِ — لا مهلةَ زمنيةً تُفترضُ فيها
        // البلاغةُ.
        // و`cancelTree` من وصلةٍ أخرى كانت ستقفُ على هذا القفلِ (انسدادٌ ذاتيٌّ
        // لا تنتهي منه)، فالإشارةُ تُكتَبُ داخلَ معاملةِ القفلِ ذاتِها — وهو عينُ
        // أثرِ إشارةٍ التزمتْ قبلَ أن تمضيَ التسويةُ فوقَها، كما يفعلُ المسارُ
        // المباشرُ (نجاحٌ بلا فحصِ إلغاءٍ بعدَ ولادةِ القيمة).
        const client = await env.db.pool.connect();
        const settleStore = openStore(env.dir, 'عامل-السباق', `race-${order}.jsonl`);
        // الوعدُ **خارجَ `try`** ليجدَهَا التنظيفُ في كلِّ حالٍ: أيُّ فشلٍ في
        // الطريقِ (استعلامُ الإثباتِ، تحديثُ الإشارةِ، الالتزامُ) لا يُغلقُ
        // المخزنَ فوقَ تسويةٍ ما زالت تجري — يُفكُّ القفلُ أوّلًا ثمّ يُجمعُ
        // مصيرُها ثمّ يُغلقُ كلُّ شيءٍ.
        /** @type {Promise<Record<string, number | boolean>> | null} */
        let settling = null;
        try {
          await client.query('BEGIN');
          const holderPid = Number(
            (await client.query('SELECT pg_backend_pid() AS pid')).rows[0]?.['pid'],
          );
          await client.query(`SELECT id FROM state.tasks WHERE id = $1 FOR UPDATE`, [task.id]);
          settling = settlePendingResults({
            store: settleStore.store,
            queue: env.queue,
          });
          // ردُّ الرفضِ **يُسجَّلُ فورَ الإنشاءِ** لا يُنتظرُ التنظيفُ: رفضٌ
          // يقعُ أثناءَ الاستقصاءِ قد يصيرُ وعدًا بلا معالجٍ قبلَ أن يبلغَهُ
          // `finally` — والمسارُ السليمُ يبقى يرمي (الانتظارُ الآتي يُظهرُ
          // خطأَهُ لا يبتلعُهُ).
          void settling.catch(() => {});
          // لا يُفترضُ أنّ التسويةَ بلغتِ القيدَ: يُقاسُ من القاعدةِ نفسِها أنّ
          // جلسةً **يحجبُها حاملُ هذا القفلِ بعينِهِ** وبيانُها `UPDATE
          // state.tasks` (أي: تسويتُنا هذه وصلتِ القيدَ ووقفتْ عليه) — عبرَّ
          // `pg_blocking_pids` لا بِعدِّ كلِّ منتظرٍ أيَّ قفلٍ كان (فذاك يُعطي
          // إيجابًا كاذبًا من انسدادٍ أجنبيٍّ لا صلةَ له بهذا الاختبار). مهلةٌ
          // محدودةٌ وإلّا فشلَ الاختبارُ بنفسِهِ لا بمهلةٍ صامتة.
          const blockedDeadline = Date.now() + 10_000;
          for (;;) {
            const blocked = await env.db.pool.query(
              `SELECT EXISTS (
                 SELECT 1 FROM pg_stat_activity a
                 WHERE a.datname = current_database()
                   AND $1::integer = ANY(pg_blocking_pids(a.pid))
                   AND a.query LIKE '%UPDATE state.tasks%'
               ) AS blocked`,
              [holderPid],
            );
            if (blocked.rows[0]?.['blocked'] === true) break;
            if (Date.now() > blockedDeadline) {
              // التنظيفُ في `finally` يفكُّ القفلَ ويجمعُ مصيرَ التسويةِ
              // (تُنجزُ أو تُخطئ) قبلَ إغلاقِ كلِّ شيءٍ — ثمّ يفشلُ الاختبارُ
              // بنفسِهِ لا بمهلةٍ صامتةٍ.
              throw new Error(
                'التسويةُ لم تبلغِ القيدَ المُقفلَ خلالَ المهلةِ — لا تداخلَ أُثبتَ.',
              );
            }
            await new Promise((resolve) => setTimeout(resolve, 20));
          }
          // الإشارةُ تلتزمُ والقفلُ بيدِ هذه المعاملةِ — فتبدو للتسويةِ عندَ فكِّهِ.
          await client.query(
            `UPDATE state.tasks SET cancel_requested = true, cancel_reason = $2 WHERE id = $1`,
            [task.id, 'إشارة تحت القفل'],
          );
          await client.query('COMMIT');
          const counts = await settling;
          assert.deepEqual(counts, {
            examined: 1,
            settled: 1,
            superseded: 0,
            conflicts: 0,
            deferred: false,
          });
        } finally {
          // التنظيفُ على كلِّ حالٍ وبالترتيبِ: (1) التراجعُ يفكُّ القفلَ لا
          // الإفلاتُ (إفلاتُ وصلةٍ بمعاملةٍ مفتوحةٍ يتركُ القفلَ معلقًا على مَن
          // بعدها)، (2) مصيرُ التسويةِ يُجمعُ (خطؤُها في المسارِ السليمِ مرئيٌّ
          // لأنّه رميٌ لا ابتلاعٌ — أمّا هنا فيُجمعُ صامتًا لأنّ فشلَ الاختبارِ
          // نفسِهِ هو الخبرُ)، (3) ثمّ الإغلاقُ والإفلاتُ.
          await client.query('ROLLBACK').catch(() => {});
          if (settling !== null) await settling.catch(() => {});
          settleStore.close();
          client.release();
        }
      }

      const after = await env.queue.get(task.id);
      return { after, value };
    };

    // الترتيبُ الأولُ: الإشارةُ تلتزمُ تحتَ القفلِ ثمّ التسويةُ — القيمةُ تقومُ
    // والإشارةُ باقيةٌ دليلًا (لا تُمحى) لكنها لا تُبطلُ ما وُلد.
    const first = await race('cancel-first');
    assert.equal(first.after?.state, TaskLifecycle.SUCCEEDED);
    assert.deepEqual(first.after?.result, first.value);
    assert.equal(first.after?.cancelRequested, true, 'الإشارةُ ضاعت — وهي دليلٌ لا يُمحى');

    // الترتيبُ الثاني: التسويةُ تلتزمُ أولًا ثمّ الإشارةُ — النجاحُ لا يُبطلُ
    // بالإشارةِ المتأخّرةِ (المسارُ المباشرُ كذلك) والقيمةُ كما وُلدت.
    const second = await race('settle-first');
    assert.equal(second.after?.state, TaskLifecycle.SUCCEEDED);
    assert.deepEqual(second.after?.result, second.value);
  },
);
