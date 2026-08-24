/**
 * اختبار طابور المهام الدائم — الخطوات `M5.02` (الطابور الدائم) و`M5.04`
 * (الفشل والإعادة والرسائل الميتة).
 *
 * المعيار الذي يحرسه هذا الملف: المهمة **تصمد أمام إعادة التشغيل**. ولذلك لا
 * يفحص الاختبار كائناً في الذاكرة، بل يقطع المجمّع كلَّه (وهو ما يفعله موت
 * العملية) ثم يفتح مجمّعاً جديداً على القاعدة نفسها ويقرأ منها. ولو كان الطابور
 * في `Map` لسقط هذا الاختبار، وهذا هو الفرق بين الدوام والادّعاء.
 */

import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import pg from 'pg';

import { QUEUE_ERRORS, backoffMs, createTaskQueue } from '../../src/execution/queue.mjs';
import { TaskLifecycle } from '../../src/execution/lifecycle.mjs';
import { up } from '../../src/persistence/migrator.mjs';
import { createIsolatedDatabase, skipWithoutDatabase } from '../helpers/pg.mjs';

/** @type {{ pool: import('pg').Pool, name: string, drop: () => Promise<void> } | undefined} */
let db;
/** تفويض صوري: الاختبار يفحص الطابور لا نقطة التفويض، والمعرّف يكفي شرطها. */
const AUTH = { decisionId: 'decision-اختبار-الطابور' };

before(async () => {
  if (skipWithoutDatabase !== false) return;
  db = await createIsolatedDatabase('queue');
  await up(db.pool);
});

after(async () => {
  if (db !== undefined) await db.drop();
});

/** @returns {{ pool: import('pg').Pool, name: string, drop: () => Promise<void> }} */
function database() {
  assert.ok(db !== undefined, 'قاعدة الاختبار غير مهيّأة');
  return db;
}

/**
 * @param {string} key
 * @param {Record<string, unknown>} [extra]
 */
function request(key, extra = {}) {
  return {
    action: 'اختبار.تنفيذ',
    target: 'موضوع/الاختبار',
    actorId: 'actor-اختبار',
    idempotencyKey: key,
    ...extra,
  };
}

test(
  'الإدخال يمرّ حتماً بمسار created ⇒ authorized ⇒ scheduled ويُسجّل كل انتقال',
  {
    skip: skipWithoutDatabase,
  },
  async () => {
    const queue = createTaskQueue({ pool: database().pool });
    const { task, created } = await queue.enqueue(request('k-مسار-كامل'), AUTH);

    assert.equal(created, true);
    assert.equal(task.state, TaskLifecycle.SCHEDULED);

    // الانتقالات ليست تجميلاً: هي الدليل على أن المهمة لم «تظهر» في الطابور
    // مباشرةً بلا تفويض. فيُفحص تسلسلها كما سُجّل.
    const trail = await queue.transitions(task.id);
    assert.deepEqual(
      trail.map((entry) => `${entry.from ?? '∅'}⇒${entry.to}`),
      ['∅⇒created', 'created⇒authorized', 'authorized⇒scheduled'],
    );
  },
);

test('الإدخال بلا قرار تفويض يُرفض برمزه', { skip: skipWithoutDatabase }, async () => {
  const queue = createTaskQueue({ pool: database().pool });
  // الحقل مطلوب في النوع، والتمرير الفارغ مقصود: يُختبر ما يحدث حين يُغفله
  // مستدعٍ جاهل، لا ما يسمح به النوع لمستدعٍ منتبه.
  await assert.rejects(
    () => queue.enqueue(request('k-بلا-تفويض'), /** @type {never} */ (undefined)),
    {
      code: QUEUE_ERRORS.AUTHORIZATION_REQUIRED,
    },
  );
  // والرفض حقيقي لا شكلي: لا صفَّ بقي في الجدول.
  const counts = await queue.counts();
  assert.equal(counts[TaskLifecycle.SCHEDULED] ?? 0, 1, 'المهمة الوحيدة هي مهمة الاختبار السابق');
});

test(
  'المهمة تصمد أمام إعادة التشغيل: يُقطع المجمّع ثم تُقرأ من قاعدة جديدة',
  {
    skip: skipWithoutDatabase,
  },
  async () => {
    const { name } = database();
    const url = new URL(String(process.env.DATABASE_URL));
    url.pathname = `/${name}`;

    // مجمّع أوّل يمثّل العملية التي ستموت.
    const first = new pg.Pool({ connectionString: url.toString(), max: 2 });
    first.on('error', () => {});
    const before1 = createTaskQueue({ pool: first });
    const { task } = await before1.enqueue(request('k-تصمد-للتشغيل', { priority: 5 }), AUTH);
    await first.end(); // موت العملية: لا حالة في الذاكرة تنجو من هذا.

    // مجمّع ثانٍ يمثّل العملية التي أُقلعت بعد الموت.
    const second = new pg.Pool({ connectionString: url.toString(), max: 2 });
    second.on('error', () => {});
    try {
      const afterRestart = createTaskQueue({ pool: second });
      const found = await afterRestart.get(task.id);
      assert.ok(found !== null, 'المهمة اختفت بعد إعادة التشغيل ⇒ الطابور ليس دائماً');
      assert.equal(found.state, TaskLifecycle.SCHEDULED);
      assert.equal(found.priority, 5);

      // وقابلةٌ للحجز فعلاً بعد الإقلاع، لا مجرّد صفٍّ محفوظ.
      const claimed = await afterRestart.claim({ worker: 'عامل-بعد-الإقلاع', limit: 10 });
      assert.ok(
        claimed.some((entry) => entry.id === task.id),
        'المهمة نجت لكنها غير قابلة للحجز',
      );
      for (const entry of claimed) {
        await afterRestart.succeed({ taskId: entry.id, worker: 'عامل-بعد-الإقلاع' });
      }
    } finally {
      await second.end();
    }
  },
);

test(
  'الأولوية تُرتّب الحجز، والمهمة المؤجّلة لا تُحجز قبل وقتها',
  {
    skip: skipWithoutDatabase,
  },
  async () => {
    const queue = createTaskQueue({ pool: database().pool });
    await queue.enqueue(request('k-أولوية-متأخرة', { priority: 200 }), AUTH);
    await queue.enqueue(request('k-أولوية-عاجلة', { priority: 1 }), AUTH);
    const future = new Date(Date.now() + 60_000);
    const delayed = await queue.enqueue(
      request('k-مؤجّلة', { priority: 1, availableAt: future }),
      AUTH,
    );

    const claimed = await queue.claim({ worker: 'عامل-الترتيب', limit: 5 });
    const keys = claimed.map((entry) => entry.idempotencyKey);
    assert.deepEqual(keys, ['k-أولوية-عاجلة', 'k-أولوية-متأخرة'], 'الترتيب لم يتبع الأولوية');
    assert.ok(!keys.includes('k-مؤجّلة'), 'حُجزت مهمة قبل وقتها');

    for (const entry of claimed) {
      await queue.succeed({ taskId: entry.id, worker: 'عامل-الترتيب' });
    }
    await queue.cancelTree({ taskId: delayed.task.id, reason: 'تنظيف الاختبار' });
  },
);

test(
  'الفشل القابل للإعادة يُؤجَّل تراجعياً، واستنفاد المحاولات يُنتج رسالة ميتة',
  {
    skip: skipWithoutDatabase,
  },
  async () => {
    const queue = createTaskQueue({ pool: database().pool });
    const { task } = await queue.enqueue(request('k-فشل-متكرّر', { maxAttempts: 2 }), AUTH);
    const worker = 'عامل-الفشل';

    const first = await queue.claim({ worker, limit: 1 });
    assert.equal(first[0]?.id, task.id);
    assert.equal(first[0]?.attempts, 1, 'المحاولات تُزاد عند الحجز لا عند الفشل');

    const failedOnce = await queue.fail({
      taskId: task.id,
      worker,
      code: 'TASK_HANDLER_FAILED',
      message: 'فشل مقصود في الاختبار',
    });
    assert.equal(failedOnce.requeued, true);
    assert.equal(failedOnce.deadLettered, false);
    assert.equal(failedOnce.task.state, TaskLifecycle.SCHEDULED);
    // التأجيل التراجعي رقمٌ معلن لا سلوك خفيّ: 100ms × 2^(محاولة−1).
    assert.equal(backoffMs(1), 100);
    assert.equal(backoffMs(2), 200);
    assert.equal(backoffMs(30), 30_000, 'السقف المعلن 30 ثانية');
    assert.ok(failedOnce.task.availableAt.getTime() > Date.now() - 1_000);

    // الحجز الثاني يحتاج انتهاء التأجيل؛ يُحجز بعقدٍ مباشر بعد الانتظار القصير.
    await new Promise((resolve) => setTimeout(resolve, 250));
    const second = await queue.claim({ worker, limit: 1 });
    assert.equal(second[0]?.id, task.id, 'المهمة لم تُتَح بعد انتهاء التأجيل');
    assert.equal(second[0]?.attempts, 2);

    const failedTwice = await queue.fail({
      taskId: task.id,
      worker,
      code: 'TASK_HANDLER_FAILED',
      message: 'فشل مقصود ثانٍ',
    });
    assert.equal(failedTwice.requeued, false);
    assert.equal(failedTwice.deadLettered, true, 'استنفاد المحاولات لم يُنتج رسالة ميتة');
    assert.equal(failedTwice.task.state, TaskLifecycle.FAILED);

    const dead = await queue.deadLetters();
    const entry = dead.find((row) => row.taskId === task.id);
    assert.ok(entry !== undefined, 'الرسالة الميتة لم تُسجَّل');
    assert.equal(entry.attempts, 2);
    assert.equal(entry.errorCode, 'TASK_HANDLER_FAILED');
  },
);

test('من فقد عقده لا يكتب نتيجة ولا فشلاً', { skip: skipWithoutDatabase }, async () => {
  const queue = createTaskQueue({ pool: database().pool });
  const { task } = await queue.enqueue(request('k-عقد-مفقود'), AUTH);
  const claimed = await queue.claim({ worker: 'العامل-الحقيقي', limit: 1 });
  assert.equal(claimed[0]?.id, task.id);

  await assert.rejects(() => queue.succeed({ taskId: task.id, worker: 'عامل-متطفّل' }), {
    code: QUEUE_ERRORS.LEASE_LOST,
  });
  await assert.rejects(
    () =>
      queue.fail({
        taskId: task.id,
        worker: 'عامل-متطفّل',
        code: 'X',
        message: 'محاولة كتابة من غير صاحب العقد',
      }),
    { code: QUEUE_ERRORS.LEASE_LOST },
  );

  const still = await queue.get(task.id);
  assert.equal(still?.state, TaskLifecycle.RUNNING, 'المتطفّل غيّر حالة مهمة لا يملكها');
  await queue.succeed({ taskId: task.id, worker: 'العامل-الحقيقي' });
});
