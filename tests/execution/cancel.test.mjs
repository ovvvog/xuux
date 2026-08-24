/**
 * اختبار الإلغاء المنتشر — الخطوة `M5.07`.
 *
 * المعيار: إلغاء مهمة أمٍّ يُلغي **كل فروعها إلى أي عمق**. والاختبار يبني شجرة
 * من **ثلاث طبقات** (جدّ ⇒ أبوان ⇒ أربعة أحفاد) لأن انتشاراً بطبقة واحدة ينجح
 * حتى مع تنفيذٍ ساذج يقرأ `parent_id` مرّةً واحدة؛ والطبقة الثالثة هي التي تُثبت
 * أن الانتشار تكراريٌّ فعلاً.
 *
 * ويُفحص الفرق المقصود بين حالتين: ما لم يبدأ يُلغى **حالاً**، وما يجري الآن
 * تُرفع عليه علامة الإلغاء ويُخبَر عامله بها عبر نبضة القلب ثم يُثبّتها هو. لأن
 * إعلان مهمةٍ جارية ملغاةً ووراءها عاملٌ لا يزال يعمل كذبٌ على الدفتر.
 */

import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';

import { QUEUE_ERRORS, createTaskQueue } from '../../src/execution/queue.mjs';
import { TaskLifecycle } from '../../src/execution/lifecycle.mjs';
import { up } from '../../src/persistence/migrator.mjs';
import { createIsolatedDatabase, skipWithoutDatabase } from '../helpers/pg.mjs';

const AUTH = { decisionId: 'decision-الإلغاء-المنتشر' };

/** @type {{ pool: import('pg').Pool, name: string, drop: () => Promise<void> } | undefined} */
let db;

before(async () => {
  if (skipWithoutDatabase !== false) return;
  db = await createIsolatedDatabase('cancel');
  await up(db.pool);
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
 * @param {ReturnType<typeof createTaskQueue>} queue
 * @param {string} key
 * @param {string | undefined} parentId
 */
async function child(queue, key, parentId) {
  const { task } = await queue.enqueue(
    {
      action: 'اختبار.شجرة',
      target: `موضوع/${key}`,
      actorId: 'actor-الشجرة',
      idempotencyKey: key,
      ...(parentId === undefined ? {} : { parentId }),
    },
    AUTH,
  );
  return task;
}

test('إلغاء الجدّ يُلغي ثلاث طبقات كاملة', { skip: skipWithoutDatabase }, async () => {
  const queue = createTaskQueue({ pool: pool() });

  const root = await child(queue, 'شجرة-جدّ', undefined);
  const parentA = await child(queue, 'شجرة-أب-أ', root.id);
  const parentB = await child(queue, 'شجرة-أب-ب', root.id);
  const leaves = [
    await child(queue, 'شجرة-حفيد-أ1', parentA.id),
    await child(queue, 'شجرة-حفيد-أ2', parentA.id),
    await child(queue, 'شجرة-حفيد-ب1', parentB.id),
    await child(queue, 'شجرة-حفيد-ب2', parentB.id),
  ];

  // الجذر يُورَّث لكل الشجرة: هو المفتاح الذي يجعل الاستعلام التكراري ممكناً.
  for (const node of [parentA, parentB, ...leaves]) {
    assert.equal(node.rootId, root.id, `عقدةٌ لا تحمل جذر الشجرة: ${node.idempotencyKey}`);
  }

  const result = await queue.cancelTree({
    taskId: root.id,
    reason: 'أُلغيت الشجرة في الاختبار',
    actor: 'مُلغي-الاختبار',
  });

  // سبعُ عقد: جدّ + أبوان + أربعة أحفاد. لا شيء منها كان جارياً فكلّها تُلغى حالاً.
  // والدالة تُعيد **معرّفات** لا عدداً، فيُفحص العدد ومحتواها معاً: أيّ عقدة
  // ناقصة تُكشف بالمقارنة لا بالعدّ وحده.
  assert.equal(result.cancelled.length, 7, `أُلغيت ${result.cancelled.length} عقدة من سبع`);
  assert.equal(result.signalled.length, 0, 'لا مهمة جارية في هذه الشجرة');
  assert.deepEqual(
    [...result.cancelled].sort(),
    [root.id, parentA.id, parentB.id, ...leaves.map((leaf) => leaf.id)].sort(),
    'قائمة المُلغى لا تطابق الشجرة',
  );

  for (const node of [root, parentA, parentB, ...leaves]) {
    const current = await queue.get(node.id);
    assert.equal(current?.state, TaskLifecycle.CANCELLED, `عقدة لم تُلغَ: ${node.idempotencyKey}`);
    assert.equal(current?.cancelReason, 'أُلغيت الشجرة في الاختبار');
  }

  // ولا واحدة منها تبقى قابلة للحجز: الإلغاء أثرٌ في الطابور لا وسمٌ في الدفتر.
  const claimed = await queue.claim({ worker: 'عامل-بعد-الإلغاء', limit: 20 });
  assert.deepEqual(claimed, [], 'حُجزت مهمة من شجرة ملغاة');
});

test(
  'المهمة الجارية تُوسم بطلب الإلغاء ويعرفها عاملها بنبضة القلب ثم يُثبّتها',
  {
    skip: skipWithoutDatabase,
  },
  async () => {
    const queue = createTaskQueue({ pool: pool() });
    const root = await child(queue, 'جارية-أمّ', undefined);
    const leaf = await child(queue, 'جارية-فرع', root.id);

    const worker = 'عامل-يُلغى-عليه';
    const claimed = await queue.claim({ worker, limit: 1 });
    const running = claimed[0];
    assert.ok(running !== undefined, 'لم تُحجز مهمة');

    const before1 = await queue.heartbeat({ taskId: running.id, worker });
    assert.equal(before1.extended, true);
    assert.equal(before1.cancelRequested, false, 'الإلغاء مطلوبٌ قبل أن يُطلب');

    const result = await queue.cancelTree({ taskId: root.id, reason: 'إلغاء أثناء التنفيذ' });
    assert.deepEqual(result.signalled, [running.id], 'المهمة الجارية لم تُوسم بطلب الإلغاء');
    assert.equal(
      result.cancelled.length + result.signalled.length,
      2,
      'الشجرة عقدتان: واحدة جارية وأخرى لا',
    );

    // الجارية لم تُعلن ملغاة بعد: عاملها يعمل، وإعلانها الآن كذبٌ على الدفتر.
    const midway = await queue.get(running.id);
    assert.equal(midway?.state, TaskLifecycle.RUNNING);
    assert.equal(midway?.cancelRequested, true);

    // والعامل يعرف بالطلب من جواب نبضة القلب — وهذا هو طريق العامل الطويل.
    const beat = await queue.heartbeat({ taskId: running.id, worker });
    assert.equal(beat.cancelRequested, true, 'نبضة القلب لم تُخبر العامل بالإلغاء');

    const confirmed = await queue.confirmCancelled({ taskId: running.id, worker });
    assert.equal(confirmed.state, TaskLifecycle.CANCELLED);
    assert.equal(confirmed.leaseOwner, null);

    const trail = await queue.transitions(running.id);
    assert.equal(trail.at(-1)?.to, TaskLifecycle.CANCELLED);
    assert.equal(trail.at(-1)?.from, TaskLifecycle.RUNNING);

    const other = await queue.get(leaf.id === running.id ? root.id : leaf.id);
    assert.equal(other?.state, TaskLifecycle.CANCELLED, 'العقدة الأخرى لم تُلغَ حالاً');
  },
);

test(
  'لا يُنشأ فرعٌ لأبٍ ملغى، والإلغاء لمهمة مجهولة يُرفض برمزه',
  {
    skip: skipWithoutDatabase,
  },
  async () => {
    const queue = createTaskQueue({ pool: pool() });
    const root = await child(queue, 'أب-سيُلغى', undefined);
    await queue.cancelTree({ taskId: root.id, reason: 'إلغاء قبل الفرع' });

    await assert.rejects(() => child(queue, 'فرع-لأب-ملغى', root.id), {
      code: QUEUE_ERRORS.PARENT_TERMINAL,
    });
    await assert.rejects(
      () => queue.cancelTree({ taskId: '00000000-0000-0000-0000-000000000000', reason: 'لا شيء' }),
      { code: QUEUE_ERRORS.NOT_FOUND },
    );
  },
);
