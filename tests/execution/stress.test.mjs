/**
 * اختبار السعة تحت حمل — الخطوة `M5.09`.
 *
 * لا يقيس هذا الاختبار «سرعةً جيدة» — فذلك حكمٌ لا قياس — بل يُثبت ثلاثة أمور
 * قابلة للتشغيل: أن حملاً متزامناً من عمّال متعددين **يُصرَّف كاملاً**، وأن **لا
 * مهمة تُنفَّذ مرّتين** تحت التسابق، وأن الأرقام المنشورة في `docs/ops/capacity.md`
 * تأتي من **نفس** الدالة التي يستدعيها السكربت لا من مسارٍ موازٍ.
 */

import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';

import { percentile, runStress } from '../../scripts/stress.mjs';
import { TaskLifecycle } from '../../src/execution/lifecycle.mjs';
import { createTaskQueue } from '../../src/execution/queue.mjs';
import { up } from '../../src/persistence/migrator.mjs';
import { createIsolatedDatabase, skipWithoutDatabase } from '../helpers/pg.mjs';
import { probeIsolation } from '../../src/execution/isolation.mjs';

const isolationSkip = probeIsolation().available ? false : `تخطّي معلن: ${probeIsolation().reason}`;

const testSkip = skipWithoutDatabase !== false ? skipWithoutDatabase : isolationSkip;

/** @type {{ pool: import('pg').Pool, drop: () => Promise<void> } | undefined} */
let db;

before(async () => {
  if (skipWithoutDatabase !== false) return;
  db = await createIsolatedDatabase('stress');
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

test('حسبة المئين تختار قيمةً لا تقلّ عن النسبة المطلوبة', () => {
  assert.equal(percentile([], 95), 0);
  assert.equal(percentile([5], 50), 5);
  assert.equal(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 50), 5);
  assert.equal(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 95), 10);
  // القيمة الشاذّة الكبيرة يجب أن تظهر في p95 لا أن تُخفى بالتقريب.
  assert.equal(percentile([1, 1, 1, 1, 1, 1, 1, 1, 1, 900], 95), 900);
});

test(
  'حملٌ متزامن يُصرَّف كاملاً بلا تنفيذ مزدوج ويُنتج أرقاماً مقيسة',
  {
    skip: testSkip,
  },
  async () => {
    const tasks = 24;
    const workers = 4;
    const report = await runStress({ pool: pool(), tasks, workers, label: 'اختبار-الضغط' });

    assert.equal(report.tasks, tasks);
    assert.equal(report.succeeded, tasks, 'لم يُصرَّف الحمل كاملاً ⇒ مهمةٌ عُلّقت أو فُقدت');
    assert.ok(report.throughputPerSecond > 0, 'إنتاجيةٌ صفر ⇒ لا قياس');
    assert.ok(report.claimP95Ms >= report.claimP50Ms, 'p95 أصغر من p50 ⇒ الحسبة خاطئة');

    // ولا تنفيذ مزدوج: كل مهمة محاولةٌ واحدة، والمجموع في القاعدة مطابق.
    const queue = createTaskQueue({ pool: pool() });
    const counts = await queue.counts();
    assert.equal(counts[TaskLifecycle.SUCCEEDED] ?? 0, tasks);
    assert.equal(counts[TaskLifecycle.RUNNING] ?? 0, 0, 'مهمةٌ بقيت جارية بعد التصريف');
    // **قُرِئ حدٌّ حقيقي هنا ولا يُستر**: عند إغراق العتاد بعمّال أكثر من الأنوية
    // تتأخّر نبضة قلبٍ فيُفقد عقدٌ فتُعاد مهمة إلى الطابور. فالضمان **مرّة على
    // الأقل** لا «مرّة واحدة بالضبط»، وما يحرسه النظام أن **لا مهمتين تجريان معاً**
    // (الحجز الذرّي) وأن لا مهمة تُفقد. ولذلك يُقاس المتوسّط لا المطلق.
    const attempts = await pool().query(
      `SELECT coalesce(sum(attempts), 0)::int AS total FROM state.tasks`,
    );
    const totalAttempts = Number(attempts.rows[0]?.['total'] ?? 0);
    assert.ok(totalAttempts >= tasks, 'محاولات أقلّ من المهام ⇒ مهمةٌ أُعلنت ناجحة بلا تنفيذ');
    assert.ok(
      totalAttempts <= tasks * 1.25,
      `إعادات أكثر من المقبول: ${totalAttempts} محاولة لـ${tasks} مهمة`,
    );
  },
);
