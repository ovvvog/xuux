/**
 * اختبار موت العامل والاستعادة — الخطوة `M5.02` (الصمود) مع حرس `M5.03`.
 *
 * المعيار: **قتل عاملٍ بـ`SIGKILL` أثناء التنفيذ لا يُفقد المهمة.** والاختبار
 * يقتل عملية `node` حقيقية بالإشارة 9 (لا يُقفلها بلطف ولا يرمي استثناءً داخل
 * نفس العملية): `SIGKILL` لا يُلتقط، فلا `finally` ينفَّذ ولا تنظيفٌ يُجرى، وما
 * يُعيد المهمة إلى الطابور هو **انتهاء عقدها في القاعدة** وحده. ولو كان الطابور
 * في الذاكرة لضاعت المهمة مع العملية ولما استُعيدت.
 */

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import test, { after, before } from 'node:test';
import { fileURLToPath } from 'node:url';

import { createTaskQueue } from '../../src/execution/queue.mjs';
import { TaskLifecycle } from '../../src/execution/lifecycle.mjs';
import { up } from '../../src/persistence/migrator.mjs';
import { createIsolatedDatabase, skipWithoutDatabase } from '../helpers/pg.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const HANG = path.join(HERE, 'helpers/hang-child.mjs');
const AUTH = { decisionId: 'decision-موت-العامل' };
/** عقدٌ قصير كي ينتهي في زمن اختبار معقول؛ الطول لا يُغيّر المنطق. */
const LEASE_MS = 700;

/** @type {{ pool: import('pg').Pool, name: string, drop: () => Promise<void> } | undefined} */
let db;
/** @type {string} */
let dbUrl = '';

before(async () => {
  if (skipWithoutDatabase !== false) return;
  db = await createIsolatedDatabase('workers');
  await up(db.pool);
  const url = new URL(String(process.env.DATABASE_URL));
  url.pathname = `/${db.name}`;
  dbUrl = url.toString();
});

after(async () => {
  if (db !== undefined) await db.drop();
});

/** @returns {import('pg').Pool} */
function pool() {
  assert.ok(db !== undefined, 'قاعدة الاختبار غير مهيّأة');
  return db.pool;
}

/**
 * يُقلع ابناً يحجز مهمة ثم يتجمّد، ويُعيد معرّف المهمة المحجوزة ومقبض العملية.
 * @param {string} worker
 * @returns {Promise<{ taskId: string, child: import('node:child_process').ChildProcess }>}
 */
function spawnHangingWorker(worker) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [HANG, dbUrl, worker, String(LEASE_MS)], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let buffer = '';
    let settled = false;
    child.stdout.on('data', (chunk) => {
      buffer += String(chunk);
      const line = buffer.split('\n').find((entry) => entry.trim().startsWith('{'));
      if (line === undefined || settled) return;
      settled = true;
      const parsed = /** @type {{ claimed: string }} */ (JSON.parse(line));
      resolve({ taskId: parsed.claimed, child });
    });
    child.stderr.on('data', (chunk) => {
      if (!settled) {
        settled = true;
        child.kill('SIGKILL');
        reject(new Error(`الابن أخفق قبل الحجز: ${String(chunk)}`));
      }
    });
    child.on('exit', (code) => {
      if (!settled) {
        settled = true;
        reject(new Error(`الابن انتهى قبل الحجز برمز ${String(code)}`));
      }
    });
  });
}

test(
  'قتل عامل بـSIGKILL أثناء التنفيذ ⇒ المهمة تُستعاد بلا فقدان',
  {
    skip: skipWithoutDatabase,
  },
  async () => {
    const queue = createTaskQueue({ pool: pool(), leaseMs: LEASE_MS });
    const { task } = await queue.enqueue(
      {
        action: 'اختبار.موت-العامل',
        target: 'موضوع/الموت',
        actorId: 'actor-الموت',
        idempotencyKey: 'مفتاح-موت-العامل',
        payload: { حمولة: 'يجب أن تنجو' },
        maxAttempts: 3,
      },
      AUTH,
    );

    const { taskId, child } = await spawnHangingWorker('عامل-سيُقتل');
    assert.equal(taskId, task.id, 'الابن حجز مهمة غير المقصودة');

    const claimedState = await queue.get(task.id);
    assert.equal(claimedState?.state, TaskLifecycle.RUNNING);
    assert.equal(claimedState?.leaseOwner, 'عامل-سيُقتل');
    assert.equal(claimedState?.attempts, 1);

    // القتل الحقيقي: الإشارة 9 لا تُلتقط ولا تُنظَّف بعدها.
    const exited = new Promise((resolve) => child.once('exit', resolve));
    child.kill('SIGKILL');
    await exited;

    // قبل انتهاء العقد لا شيء يُستعاد: الاستعادة مشروطة بانتهاء العقد لا بموت
    // العملية (وهو ما لا تعرفه القاعدة أصلاً). فيُفحص الحدّان: قبلَه وبعدَه.
    const early = await queue.reclaimExpired({ actor: 'حاصد-الاختبار' });
    assert.deepEqual(
      [early.requeued.length, early.failed.length],
      [0, 0],
      'استُعيدت قبل انتهاء عقدها',
    );

    await new Promise((resolve) => setTimeout(resolve, LEASE_MS + 300));
    const reclaimed = await queue.reclaimExpired({ actor: 'حاصد-الاختبار' });
    assert.equal(reclaimed.requeued.length, 1, 'المهمة لم تُستعد بعد موت عاملها ⇒ فُقدت');
    assert.equal(reclaimed.failed.length, 0);

    const revived = reclaimed.requeued[0];
    assert.ok(revived !== undefined);
    assert.equal(revived.id, task.id);
    assert.equal(revived.state, TaskLifecycle.SCHEDULED);
    assert.equal(revived.leaseOwner, null, 'عقد العامل الميت لم يُفكّ');
    assert.equal(revived.errorCode, 'TASK_LEASE_EXPIRED');
    // بلا فقدان: الحمولة كما هي، والانتقالات تحفظ القصّة كاملة.
    assert.deepEqual(revived.payload, { حمولة: 'يجب أن تنجو' });
    const trail = await queue.transitions(task.id);
    assert.deepEqual(
      trail.map((entry) => `${entry.from ?? '∅'}⇒${entry.to}`),
      [
        '∅⇒created',
        'created⇒authorized',
        'authorized⇒scheduled',
        'scheduled⇒running',
        'running⇒scheduled',
      ],
    );

    // وتُحجز فعلاً بعد الاستعادة وتنجح: الاستعادة ليست إعلاناً بل عودةٌ للعمل.
    await new Promise((resolve) => setTimeout(resolve, 300));
    const again = await queue.claim({ worker: 'عامل-بديل', limit: 1 });
    assert.equal(again[0]?.id, task.id, 'المهمة المستعادة غير قابلة للحجز');
    assert.equal(again[0]?.attempts, 2, 'محاولةٌ لم تُحسب بعد الاستعادة');
    const done = await queue.succeed({
      taskId: task.id,
      worker: 'عامل-بديل',
      result: { تمّ: true },
    });
    assert.equal(done.state, TaskLifecycle.SUCCEEDED);
  },
);

test(
  'استنفاد المحاولات بموت العامل يُنهي المهمة إلى الرسائل الميتة',
  {
    skip: skipWithoutDatabase,
  },
  async () => {
    const queue = createTaskQueue({ pool: pool(), leaseMs: LEASE_MS });
    const { task } = await queue.enqueue(
      {
        action: 'اختبار.موت-متكرّر',
        target: 'موضوع/الموت-المتكرّر',
        actorId: 'actor-الموت',
        idempotencyKey: 'مفتاح-موت-متكرّر',
        maxAttempts: 1,
      },
      AUTH,
    );

    const { child } = await spawnHangingWorker('عامل-محاولة-واحدة');
    const exited = new Promise((resolve) => child.once('exit', resolve));
    child.kill('SIGKILL');
    await exited;

    await new Promise((resolve) => setTimeout(resolve, LEASE_MS + 300));
    const reclaimed = await queue.reclaimExpired({ actor: 'حاصد-الاختبار' });
    assert.equal(reclaimed.requeued.length, 0, 'أُعيدت مهمةٌ استُنفدت محاولاتها');
    assert.equal(reclaimed.failed.length, 1);
    assert.equal(reclaimed.failed[0]?.id, task.id);
    assert.equal(reclaimed.failed[0]?.errorCode, 'TASK_LEASE_EXPIRED');

    // ولا تختفي صامتة: تُسجَّل في الرسائل الميتة كي يُعاد النظر فيها بشرٍ لا بصمت.
    const dead = await queue.deadLetters();
    assert.ok(
      dead.some((entry) => entry.taskId === task.id && entry.errorCode === 'TASK_LEASE_EXPIRED'),
      'المهمة المفقودة لم تُسجَّل في الرسائل الميتة',
    );
  },
);
