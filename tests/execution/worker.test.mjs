/**
 * اختبار العامل والإيقاف الشامل — الخطوتان `M5.08` و`M5.07` (الإلغاء) مع `M5.05`.
 *
 * أثقل اختبار هنا هو **الإيقاف تحت حمل**: طابورٌ فيه مهام، وعاملٌ يعمل، ثم إيقاف
 * شامل موقَّع من الملك ⇒ **صفر تقدّم بعده وبلا فقدان مهمة**، ثم استئنافٌ يُكمل ما
 * بقي. والإثبات ليس بجواب دالة بل بعدّ المهام الناجحة في القاعدة قبل الإيقاف
 * وبعده: العدد لا يزيد، ومجموع المهام لا ينقص.
 */

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test, { after, before } from 'node:test';
import { registerTmpRoot } from '../helpers/tmp-roots.mjs';

import { HaltSwitch, KingIdentity } from '../../src/root-of-trust/index.mjs';
import { createTaskQueue } from '../../src/execution/queue.mjs';
import { createWorker } from '../../src/execution/worker.mjs';
import { TaskLifecycle } from '../../src/execution/lifecycle.mjs';
import { up } from '../../src/persistence/migrator.mjs';
import { createIsolatedDatabase, skipWithoutDatabase } from '../helpers/pg.mjs';

const AUTH = { decisionId: 'decision-العامل' };

/** @type {{ pool: import('pg').Pool, name: string, drop: () => Promise<void> } | undefined} */
let db;
/** @type {string[]} */
const tempDirs = [];

before(async () => {
  if (skipWithoutDatabase !== false) return;
  db = await createIsolatedDatabase('worker');
  await up(db.pool);
});

after(async () => {
  if (db !== undefined) await db.drop();
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

/** @returns {import('pg').Pool} */
function pool() {
  assert.ok(db !== undefined, 'قاعدة الاختبار غير مهيّأة');
  return db.pool;
}

/**
 * يُنشئ مفتاح إيقاف حقيقياً موقَّعاً بمفتاح ملك (لا صورياً)، مع أمرٍ ملكيٍّ
 * يولِّده الاختبارُ لنفسِه (R5-B-07): فالإيقافُ في `M5.08` أمرٌ لا علامةُ ذاكرةٍ.
 *
 * @returns {{ halt: HaltSwitch, royalCommand: { id: string } }}
 */
function haltSwitch() {
  const dir = registerTmpRoot(mkdtempSync(path.join(tmpdir(), 'm5-halt-')));
  tempDirs.push(dir);
  const royalCommand = { id: `cmd:m5-halt-${randomUUID()}` };
  const halt = new HaltSwitch(path.join(dir, 'state', 'halt.json'), new KingIdentity(), {
    fsync: false,
    royalCommandVerifier: (command) => command.id === royalCommand.id,
  });
  return { halt, royalCommand };
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
      actorId: 'actor-العامل',
      idempotencyKey: key,
      timeoutMs: 10_000,
      memoryLimitMb: 96,
      ...extra,
    },
    AUTH,
  );
  return task;
}

test(
  'العامل ينفّذ المهمة في عملية منفصلة ويُنهيها ناجحة',
  {
    skip: skipWithoutDatabase,
  },
  async () => {
    const queue = createTaskQueue({ pool: pool() });
    const { halt } = haltSwitch();
    const worker = createWorker({ queue, pool: pool(), haltGuard: halt, worker: 'عامل-النجاح' });
    const task = await enqueue(queue, 'عامل-مهمة-ناجحة', { payload: { قيمة: 3 } });

    const tick = await worker.tick();
    assert.equal(tick.outcome, 'done', `الحصيلة: ${tick.outcome} — ${String(tick.code)}`);
    assert.equal(tick.taskId, task.id);

    const done = await queue.get(task.id);
    assert.equal(done?.state, TaskLifecycle.SUCCEEDED);
    assert.equal(done?.result?.['نُفِّذ'], true);
    assert.notEqual(
      done?.result?.['pid'],
      process.pid,
      'نُفّذ في عملية الاختبار لا في عملية منفصلة',
    );

    // وطابورٌ فارغ يُقرأ فراغاً لا خطأً.
    assert.equal((await worker.tick()).outcome, 'idle');
  },
);

test(
  'إيقاف شامل تحت حمل ⇒ صفر تقدّم، بلا فقدان، ثم استئناف يُكمل الباقي',
  {
    skip: skipWithoutDatabase,
  },
  async () => {
    const queue = createTaskQueue({ pool: pool() });
    const { halt, royalCommand } = haltSwitch();
    const worker = createWorker({ queue, pool: pool(), haltGuard: halt, worker: 'عامل-الإيقاف' });

    const total = 6;
    /** @type {string[]} */
    const ids = [];
    for (let index = 0; index < total; index += 1) {
      const task = await enqueue(queue, `حمل-الإيقاف-${index}`, { payload: { index } });
      ids.push(task.id);
    }

    // تقدّمٌ حقيقي قبل الإيقاف: مهمتان تُنفَّذان فعلاً.
    const beforeRun = await worker.run({ maxTasks: 2, stopWhenIdle: true });
    const succeededBefore = beforeRun.ticks.filter((tick) => tick.outcome === 'done').length;
    assert.equal(succeededBefore, 2, 'لم يتقدّم العمل قبل الإيقاف فلا معنى لقياس توقّفه');

    // الإيقاف الشامل: موقَّع بمفتاح الملك لا بعلامة في الذاكرة.
    halt.halt('إيقاف اختبار M5.08 تحت حمل', royalCommand);
    assert.equal(halt.isHalted(), true);

    const countsAtHalt = await queue.counts();
    const succeededAtHalt = countsAtHalt[TaskLifecycle.SUCCEEDED] ?? 0;

    // عشر دورات بعد الإيقاف: كلّها تُقرأ «موقوف» ولا واحدة تُنفّذ شيئاً.
    for (let index = 0; index < 10; index += 1) {
      const tick = await worker.tick();
      assert.equal(tick.outcome, 'halted', `دورةٌ عملت بعد الإيقاف: ${tick.outcome}`);
      assert.equal(tick.taskId, null, 'حُجزت مهمة بعد الإيقاف');
    }

    const countsAfter = await queue.counts();
    assert.equal(
      countsAfter[TaskLifecycle.SUCCEEDED] ?? 0,
      succeededAtHalt,
      'زاد عدد المهام الناجحة بعد الإيقاف ⇒ العمل لم يتوقّف',
    );
    assert.equal(countsAfter[TaskLifecycle.RUNNING] ?? 0, 0, 'مهمةٌ بقيت جارية بعد الإيقاف');
    // بلا فقدان: مجموع المهام كما هو، وما لم يُنفَّذ باقٍ في الطابور.
    const totalRows = Object.values(countsAfter).reduce((sum, value) => sum + value, 0);
    const totalAtHalt = Object.values(countsAtHalt).reduce((sum, value) => sum + value, 0);
    assert.equal(totalRows, totalAtHalt, 'فُقد صفٌّ أو أُضيف بعد الإيقاف');
    assert.equal(
      countsAfter[TaskLifecycle.SCHEDULED] ?? 0,
      total - 2,
      'المهام الباقية لم تبقَ في الطابور',
    );

    // الاستئناف: العمل يُكمل ما بقي بلا فقدان ولا تكرار.
    halt.resume('استئناف اختبار M5.08', royalCommand);
    const afterRun = await worker.run({ maxTasks: total, stopWhenIdle: true, pollMs: 10 });
    assert.equal(afterRun.stopped, 'idle');

    for (const id of ids) {
      const current = await queue.get(id);
      assert.equal(current?.state, TaskLifecycle.SUCCEEDED, `مهمة لم تُنفَّذ بعد الاستئناف: ${id}`);
      assert.equal(current?.attempts, 1, 'مهمةٌ نُفّذت أكثر من محاولة ⇒ تكرار أو فقدان عقد');
    }
  },
);

test('عاملٌ بلا حرس إيقاف يُرفض بناؤه', { skip: skipWithoutDatabase }, () => {
  const queue = createTaskQueue({ pool: pool() });
  assert.throws(
    () =>
      createWorker({
        queue,
        pool: pool(),
        haltGuard: /** @type {never} */ (undefined),
        worker: 'عامل-بلا-حرس',
      }),
    { code: 'WORKER_DEPENDENCY_MISSING' },
  );
});

test(
  'طلب الإلغاء يقتل مُعالِجاً متجمّداً ويُثبَّت الإلغاء',
  {
    skip: skipWithoutDatabase,
  },
  async () => {
    const queue = createTaskQueue({ pool: pool(), leaseMs: 5_000 });
    const { halt } = haltSwitch();
    const worker = createWorker({
      queue,
      pool: pool(),
      haltGuard: halt,
      worker: 'عامل-الإلغاء',
      heartbeatMs: 150,
    });

    const task = await enqueue(queue, 'إلغاء-متجمّد', {
      action: 'اختبار.تجمّد',
      payload: { busy: true },
      timeoutMs: 20_000,
    });

    // الإلغاء يُطلب بعد أن يبدأ التنفيذ فعلاً: قبله سيُلغى في الطابور بلا اختبار
    // للقتل القسري، وهو ليس محلّ هذا الاختبار.
    const cancelling = (async () => {
      for (;;) {
        const current = await queue.get(task.id);
        if (current?.state === TaskLifecycle.RUNNING) break;
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      await queue.cancelTree({ taskId: task.id, reason: 'إلغاء أثناء تجمّد' });
    })();

    const [tick] = await Promise.all([worker.tick(), cancelling]);
    assert.equal(tick.outcome, 'cancelled', `الحصيلة: ${tick.outcome} — ${String(tick.code)}`);

    const cancelled = await queue.get(task.id);
    assert.equal(cancelled?.state, TaskLifecycle.CANCELLED);
    assert.equal(cancelled?.cancelReason, 'إلغاء أثناء تجمّد');
    assert.equal(cancelled?.leaseOwner, null);
    // ولم تنتظر المهلة الطويلة (20 ثانية): القتل كان قسرياً لا انتظاراً لانتهائها.
    assert.ok(tick.durationMs < 15_000, `تأخّر القتل: ${tick.durationMs}ms`);
  },
);

test(
  'انتهاء مهلة المهمة يُسجَّل رمزاً في المهمة ويُعيدها للطابور',
  {
    skip: skipWithoutDatabase,
  },
  async () => {
    const queue = createTaskQueue({ pool: pool(), leaseMs: 10_000 });
    const { halt } = haltSwitch();
    const worker = createWorker({ queue, pool: pool(), haltGuard: halt, worker: 'عامل-المهلة' });

    const task = await enqueue(queue, 'مهلة-قصيرة', {
      action: 'اختبار.تجمّد',
      payload: { busy: true },
      timeoutMs: 500,
      maxAttempts: 2,
    });

    const tick = await worker.tick();
    assert.equal(tick.outcome, 'failed');
    assert.equal(tick.code, 'TASK_TIMEOUT');

    const current = await queue.get(task.id);
    assert.equal(current?.state, TaskLifecycle.SCHEDULED, 'المهلة أضاعت المهمة بدل إعادتها');
    assert.equal(current?.errorCode, 'TASK_TIMEOUT');
    assert.equal(current?.attempts, 1);

    // وتُنهى نهائياً عند استنفاد المحاولات، وتُسجَّل في الرسائل الميتة.
    await new Promise((resolve) => setTimeout(resolve, 250));
    const second = await worker.tick();
    assert.equal(second.code, 'TASK_TIMEOUT');
    const dead = await queue.deadLetters();
    assert.ok(
      dead.some((entry) => entry.taskId === task.id && entry.errorCode === 'TASK_TIMEOUT'),
      'مهمةٌ استُنفدت محاولاتها بالمهلة ولم تُسجَّل ميتة',
    );
  },
);

test(
  'إيقافٌ شاملٌ أثناءَ تنفيذٍ جارٍ يُجهضه ويُعيد المهمة بلا استهلاك محاولة',
  {
    skip: skipWithoutDatabase,
  },
  async () => {
    // شاهدُ الدَّينِ `D-8`: قبلَ الإصلاحِ كان الإيقافُ يَحسِبُ محاولةً على المهمّةِ
    // المُجهَضةِ، فمهمّةٌ سقفُها محاولةٌ واحدةٌ تُعلَنُ `failed` وتُنقَلُ إلى الرسائلِ
    // الميتةِ وهي لم تُخطئ. والقياسُ هنا ثلاثيٌّ: الإجهازُ سريعٌ لا انتظارُ مهلةٍ،
    // والمحاولةُ مردودةٌ، ولا رسالةَ ميتةً.
    const queue = createTaskQueue({ pool: pool(), leaseMs: 8_000 });
    const { halt, royalCommand } = haltSwitch();
    const worker = createWorker({
      queue,
      pool: pool(),
      haltGuard: halt,
      worker: 'عامل-الإجهاض',
      heartbeatMs: 120,
    });

    // مهمّةٌ تَشغَلُ المعالجَ بحلقةٍ مشغولةٍ لا تُقاطَعُ إلّا بقتلٍ، ومهلتُها طويلةٌ
    // جدّاً: فإن عادت المهمّةُ قبلَ المهلةِ فما أعادها إلّا إجهازٌ قسريٌّ.
    const task = await enqueue(queue, 'إجهاض-جارٍ', {
      action: 'اختبار.تجمّد',
      payload: { busy: true },
      timeoutMs: 30_000,
      maxAttempts: 1,
    });

    const startedAt = Date.now();
    const halting = (async () => {
      for (;;) {
        const current = await queue.get(task.id);
        if (current?.state === TaskLifecycle.RUNNING) break;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      halt.halt('إيقافٌ شاملٌ أثناءَ تنفيذٍ جارٍ — شاهدُ `D-8`', royalCommand);
    })();
    const [tick] = await Promise.all([worker.tick(), halting]);
    const elapsedMs = Date.now() - startedAt;

    assert.equal(tick.outcome, 'requeued');
    assert.equal(tick.code, 'TASK_HALTED');
    assert.ok(
      elapsedMs < 10_000,
      `الفعلُ الجاري لم يُجهَضْ: انتظرَ ${elapsedMs}ms من مهلةٍ قدرُها 30000ms`,
    );

    const current = await queue.get(task.id);
    assert.equal(current?.state, TaskLifecycle.SCHEDULED, 'الإيقافُ أضاعَ المهمّةَ بدلَ إعادتِها');
    assert.equal(current?.errorCode, 'TASK_HALTED');
    assert.equal(current?.attempts, 0, 'الإيقافُ استهلكَ محاولةً وهي لم تُخطئ');
    assert.equal(current?.leaseOwner, null, 'عقدٌ لم يُفَكَّ بعدَ الإجهاضِ');
    assert.equal(current?.result, null);

    const dead = await queue.deadLetters();
    assert.equal(
      dead.some((entry) => entry.taskId === task.id),
      false,
      'الإيقافُ نقلَ مهمّةً إلى الرسائلِ الميتةِ، وذلك فقدانُ عملٍ لا حفظُه',
    );

    // والأثرُ مقروءٌ: الانتقالُ يُصرِّحُ بالسببِ وبأنّ المحاولةَ لم تُستهلَكْ.
    const transitions = await queue.transitions(task.id);
    const last = transitions.at(-1);
    assert.equal(last?.from, TaskLifecycle.RUNNING);
    assert.equal(last?.to, TaskLifecycle.SCHEDULED);
    assert.match(last?.reason ?? '', /إيقاف شامل \(TASK_HALTED\)/u);
    assert.match(last?.reason ?? '', /المحاولة لم تُستهلك/u);

    // ثمّ الاستئنافُ يُعيدُ المهمّةَ قابلةً للحجزِ بميزانيتِها كاملةً.
    halt.resume('استئنافٌ بعدَ شاهدِ `D-8`', royalCommand);
    const reclaimed = await queue.claim({ worker: 'عامل-بعد-الاستئناف', limit: 1 });
    assert.equal(reclaimed.length, 1, 'المهمّةُ لم تعُدْ قابلةً للحجزِ بعدَ الاستئنافِ');
    assert.equal(reclaimed[0]?.id, task.id);
    assert.equal(
      reclaimed[0]?.attempts,
      1,
      'الحجزُ بعدَ الاستئنافِ هو المحاولةُ الأولى لا الثانية',
    );
  },
);
