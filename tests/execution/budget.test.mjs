/**
 * اختبار ربط الميزانية بالتنفيذ — الخطوة `M5.06`.
 *
 * المعيار: **نفاد الميزانية يوقف المهمة قبل بدئها**. والإثبات هنا لا يكون بجواب
 * دالة وحده، بل بأن المُعالِج **لم يُشغَّل أصلاً**: مُعالِج «اختبار.نجاح» يُعيد
 * `pid` عمليته، فوجودُ نتيجة يعني تشغيلاً وقع. فإن رُفضت المهمة فلا نتيجة لها ولا
 * عملية أُقلعت، وذلك هو الفرق بين ميزانيةٍ وفاتورةٍ تُقدَّم بعد الإنفاق.
 */

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test, { after, before } from 'node:test';

import { HaltSwitch, KingIdentity } from '../../src/root-of-trust/index.mjs';
import { BUDGET_ERRORS, createBudgetGate } from '../../src/execution/budget.mjs';
import { createTaskQueue } from '../../src/execution/queue.mjs';
import { createWorker } from '../../src/execution/worker.mjs';
import { TaskLifecycle } from '../../src/execution/lifecycle.mjs';
import { createQuotaLedger } from '../../src/policy/quota.mjs';
import { loadPolicyBundle } from '../../src/policy/loader.mjs';
import { up } from '../../src/persistence/migrator.mjs';
import { createIsolatedDatabase, skipWithoutDatabase } from '../helpers/pg.mjs';

const AUTH = { decisionId: 'decision-الميزانية' };
/** موردٌ معلن في `config/quotas.yaml`؛ حدّه هناك هو الحدّ المُختبَر لا رقمٌ مُختلق. */
const RESOURCE = 'task-executions';

/** @type {{ pool: import('pg').Pool, name: string, drop: () => Promise<void> } | undefined} */
let db;
/** @type {string[]} */
const tempDirs = [];
/** @type {readonly import('../../src/policy/model.mjs').QuotaDefinition[]} */
let definitions = [];
/** @type {number} */
let declaredLimit = 0;

before(async () => {
  if (skipWithoutDatabase !== false) return;
  db = await createIsolatedDatabase('budget');
  await up(db.pool);
  definitions = loadPolicyBundle().quotas;
  const found = definitions.find((entry) => entry.resource === RESOURCE);
  assert.ok(found !== undefined, `المورد ${RESOURCE} غير معلن في ملف الحصص`);
  declaredLimit = found.limit;
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

function ledger() {
  return createQuotaLedger({ pool: pool(), definitions });
}

function haltSwitch() {
  const dir = mkdtempSync(path.join(tmpdir(), 'm5-budget-halt-'));
  tempDirs.push(dir);
  return new HaltSwitch(path.join(dir, 'state', 'halt.json'), new KingIdentity(), { fsync: false });
}

/**
 * @param {ReturnType<typeof createTaskQueue>} queue
 * @param {string} key
 * @param {string} actorId
 * @param {number} amount
 */
async function enqueue(queue, key, actorId, amount) {
  const { task } = await queue.enqueue(
    {
      action: 'اختبار.نجاح',
      target: `موضوع/${key}`,
      actorId,
      idempotencyKey: key,
      timeoutMs: 10_000,
      memoryLimitMb: 96,
      budgetResource: RESOURCE,
      budgetAmount: amount,
    },
    AUTH,
  );
  return task;
}

test(
  'نفاد الميزانية يوقف المهمة قبل تشغيلها ولا نتيجة لها',
  {
    skip: skipWithoutDatabase,
  },
  async () => {
    const queue = createTaskQueue({ pool: pool() });
    const worker = createWorker({
      queue,
      pool: pool(),
      haltGuard: haltSwitch(),
      ledger: ledger(),
      worker: 'عامل-الميزانية',
    });
    const actorId = 'actor-budget-exhausted';

    // مهمةٌ تطلب أكثر من الحدّ المعلن كلّه: لا سبيل إلى قبولها.
    const task = await enqueue(queue, 'ميزانية-تتجاوز-الحدّ', actorId, declaredLimit + 1);

    const tick = await worker.tick();
    assert.equal(tick.outcome, 'budget-denied', `الحصيلة: ${tick.outcome} — ${String(tick.code)}`);
    assert.equal(tick.code, BUDGET_ERRORS.EXHAUSTED);

    const current = await queue.get(task.id);
    assert.equal(current?.state, TaskLifecycle.FAILED, 'مهمةٌ رُفضت ميزانيتها ولم تُنهَ');
    assert.equal(current?.errorCode, BUDGET_ERRORS.EXHAUSTED);
    // الدليل القاطع على «قبل البدء»: لا نتيجة ولا وقت بدءٍ ولا خصمٌ سُجّل.
    assert.equal(current?.result, null, 'وُجدت نتيجة ⇒ المُعالِج شُغّل فعلاً');
    const row = await pool().query(
      `SELECT started_at, budget_debited_at FROM state.tasks WHERE id = $1`,
      [task.id],
    );
    assert.equal(row.rows[0]?.['budget_debited_at'], null, 'خُصم من الميزانية رغم الرفض');

    // ويُسجَّل في الرسائل الميتة كي يراه بشر: الرفض المالي لا يُعاد بلا حكم.
    const dead = await queue.deadLetters();
    assert.ok(
      dead.some((entry) => entry.taskId === task.id && entry.errorCode === BUDGET_ERRORS.EXHAUSTED),
      'رفضُ الميزانية لم يُسجَّل في الرسائل الميتة',
    );
  },
);

test(
  'المهمة داخل الميزانية تُنفَّذ ويُحسم استهلاكها فعلاً في الدفتر',
  {
    skip: skipWithoutDatabase,
  },
  async () => {
    const queue = createTaskQueue({ pool: pool() });
    const book = ledger();
    const worker = createWorker({
      queue,
      pool: pool(),
      haltGuard: haltSwitch(),
      ledger: book,
      worker: 'عامل-الخصم',
    });
    const actorId = 'actor-budget-inside';

    const before1 = await book.read({
      subjectType: 'agent',
      subjectId: actorId,
      resource: RESOURCE,
    });
    assert.equal(before1, null, 'الفاعل استهلك قبل أن يبدأ');

    const task = await enqueue(queue, 'ميزانية-داخل-الحدّ', actorId, 5);
    const tick = await worker.tick();
    assert.equal(tick.outcome, 'done', `الحصيلة: ${tick.outcome} — ${String(tick.code)}`);

    const after1 = await book.read({
      subjectType: 'agent',
      subjectId: actorId,
      resource: RESOURCE,
    });
    assert.equal(after1?.consumed, 5, 'لم يُحسم الاستهلاك من الدفتر');
    assert.equal(after1?.remaining, declaredLimit - 5);

    const done = await queue.get(task.id);
    assert.equal(done?.state, TaskLifecycle.SUCCEEDED);
    const row = await pool().query(`SELECT budget_debited_at FROM state.tasks WHERE id = $1`, [
      task.id,
    ]);
    assert.notEqual(row.rows[0]?.['budget_debited_at'], null, 'نُفّذت بلا تسجيل خصم');
  },
);

test(
  'إعادة المحاولة لا تُحاسَب مرّتين على نفس المهمة',
  {
    skip: skipWithoutDatabase,
  },
  async () => {
    const queue = createTaskQueue({ pool: pool(), leaseMs: 10_000 });
    const book = ledger();
    const gate = createBudgetGate({ pool: pool(), ledger: book });
    const actorId = 'actor-budget-retry';

    const task = await enqueue(queue, 'ميزانية-إعادة-المحاولة', actorId, 4);
    const claimedFirst = await queue.claim({ worker: 'عامل-أ', limit: 1 });
    assert.equal(claimedFirst[0]?.id, task.id);

    const first = await gate.chargeBeforeStart(claimedFirst[0]);
    assert.equal(first.allowed, true);
    assert.equal(first.debited, true);
    assert.equal(first.reading?.consumed, 4);

    // فشلٌ وإعادة، ثم محاسبةٌ ثانية على **نفس** المهمة: لا خصم جديد.
    await queue.fail({
      taskId: task.id,
      worker: 'عامل-أ',
      code: 'TASK_HANDLER_FAILED',
      message: 'فشل مقصود لإعادة المحاولة',
    });
    await new Promise((resolve) => setTimeout(resolve, 250));
    const claimedSecond = await queue.claim({ worker: 'عامل-ب', limit: 1 });
    assert.equal(claimedSecond[0]?.id, task.id);

    const second = await gate.chargeBeforeStart(claimedSecond[0]);
    assert.equal(second.allowed, true);
    assert.equal(second.debited, false, 'خُصمت إعادة المحاولة مرّة ثانية');
    const reading = await book.read({
      subjectType: 'agent',
      subjectId: actorId,
      resource: RESOURCE,
    });
    assert.equal(reading?.consumed, 4, 'تغيّر الاستهلاك بإعادة المحاولة');
  },
);

test(
  'خصمان متزامنان على آخر وحدة لا يُنتجان رصيداً سالباً',
  {
    skip: skipWithoutDatabase,
  },
  async () => {
    const queue = createTaskQueue({ pool: pool() });
    const book = ledger();
    const gate = createBudgetGate({ pool: pool(), ledger: book });
    const actorId = 'actor-budget-race';

    // يُستهلك الحدّ إلا وحدةً واحدة، ثم يتسابق طلبان على تلك الوحدة.
    await book.debit({
      subjectType: 'agent',
      subjectId: actorId,
      resource: RESOURCE,
      amount: declaredLimit - 1,
    });

    const taskA = await enqueue(queue, 'تسابق-أ', actorId, 1);
    const taskB = await enqueue(queue, 'تسابق-ب', actorId, 1);
    const claimed = await queue.claim({ worker: 'عامل-التسابق', limit: 2 });
    assert.equal(claimed.length, 2);

    const decisions = await Promise.all(claimed.map((task) => gate.chargeBeforeStart(task)));
    const allowed = decisions.filter((decision) => decision.allowed);
    const denied = decisions.filter((decision) => !decision.allowed);
    assert.equal(allowed.length, 1, 'مرّ الطلبان معاً على آخر وحدة');
    assert.equal(denied.length, 1);
    assert.equal(denied[0]?.code, BUDGET_ERRORS.EXHAUSTED);

    const reading = await book.read({
      subjectType: 'agent',
      subjectId: actorId,
      resource: RESOURCE,
    });
    assert.equal(reading?.consumed, declaredLimit, 'الاستهلاك تجاوز الحدّ');
    assert.ok((reading?.remaining ?? -1) >= 0, 'رصيدٌ سالب ⇒ الحدّ تجاوزه التسابق');
    assert.ok(taskA.id !== taskB.id);
  },
);

test(
  'مورد ميزانية غير معلن يمنع التشغيل ولا يمرّ بلا حدّ',
  {
    skip: skipWithoutDatabase,
  },
  async () => {
    const queue = createTaskQueue({ pool: pool() });
    const gate = createBudgetGate({ pool: pool(), ledger: ledger() });
    const { task } = await queue.enqueue(
      {
        action: 'اختبار.نجاح',
        target: 'موضوع/مورد-مجهول',
        actorId: 'actor-budget-unknown',
        idempotencyKey: 'ميزانية-مورد-مجهول',
        budgetResource: 'مورد-لا-وجود-له',
        budgetAmount: 1,
      },
      AUTH,
    );
    const claimed = await queue.claim({ worker: 'عامل-مورد-مجهول', limit: 1 });
    assert.equal(claimed[0]?.id, task.id);

    const decision = await gate.chargeBeforeStart(claimed[0]);
    assert.equal(decision.allowed, false, 'مورد غير معلن مرّ بلا حدّ');
    assert.equal(decision.code, BUDGET_ERRORS.RESOURCE_UNDECLARED);
  },
);

test('بوابةٌ بلا دفتر حصص يُرفض بناؤها', { skip: skipWithoutDatabase }, () => {
  assert.throws(
    () => createBudgetGate({ pool: pool(), ledger: /** @type {never} */ (undefined) }),
    { code: BUDGET_ERRORS.DEPENDENCY_MISSING },
  );
});
