/**
 * عملية ابنٌ تحجز مهمة ثم تتجمّد — مساعد اختبار الاستعادة بعد موت العامل.
 *
 * الغرض أن يُقتل بـ`SIGKILL` **وهو محتجزٌ لمهمة جارية**. و`SIGKILL` لا يُمكن
 * التقاطه ولا تنظيفٌ يُجرى بعده: لا `finally` ينفَّذ ولا اتصالٌ يُغلَق بلطف. فهو
 * محاكاة الموت الحقيقي (انقطاع كهرباء، قتلُ مدبّر الحاويات) لا محاكاة الإقفال
 * المهذّب. وما يُعيد المهمة بعده ليس تنظيفَ العامل بل **انتهاء عقده** وحده.
 *
 * الاستعمال: `node hang-child.mjs <DATABASE_URL> <اسم العامل> <عقد بالمللي>`
 * ويُطبع سطرُ JSON عند نجاح الحجز: `{"claimed":"<معرّف>"}` ثم يتجمّد إلى الأبد.
 */

import pg from 'pg';

import { createTaskQueue } from '../../../src/execution/queue.mjs';

const [url, worker, leaseRaw] = process.argv.slice(2);
if (url === undefined || worker === undefined) {
  console.error('الاستعمال: node hang-child.mjs <DATABASE_URL> <worker> [leaseMs]');
  process.exit(2);
}

const pool = new pg.Pool({ connectionString: url, max: 2 });
pool.on('error', () => {});

const queue = createTaskQueue({ pool, leaseMs: Number(leaseRaw ?? '1000') });
const claimed = await queue.claim({ worker, limit: 1 });
const first = claimed[0];
if (first === undefined) {
  console.error('لا مهمة في الطابور');
  process.exit(3);
}

process.stdout.write(`${JSON.stringify({ claimed: first.id, worker })}\n`);

// تجمّدٌ بلا نهاية: المهمة جارية والعقد يمضي إلى انتهائه. لا نبضة قلب تُمدّ العقد
// عمداً، فالمقصود أن ينتهي العقد بعد موت العامل فتُستعاد المهمة.
setInterval(() => {}, 1_000);
