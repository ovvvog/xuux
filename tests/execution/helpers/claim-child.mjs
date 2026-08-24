/**
 * عملية ابنٌ تحجز مهاماً من الطابور — مساعد اختبار `M5.03`.
 *
 * لماذا عملية منفصلة؟ لأن «لا تُنفَّذ مهمة مرتين» ادّعاءٌ عن **عمّال متعددين**،
 * وعمّالٌ داخل عملية واحدة يتشاركون حلقة أحداث واحدة ومجمّع اتصالٍ واحداً، فقد
 * ينجح الاختبار بسبب ترتيب حلقة الأحداث لا بسبب ذرّية الحجز في القاعدة. أمّا
 * عمليات `node` حقيقية متزامنة على قاعدة واحدة فلا يحرسها إلا `FOR UPDATE SKIP
 * LOCKED` نفسه.
 *
 * الاستعمال: `node claim-child.mjs <DATABASE_URL> <اسم العامل> <حدّ الحجز>`
 * ويُطبع على المخرج القياسي سطرُ JSON واحد: `{"worker":…,"claimed":[معرّفات]}`.
 *
 * حدٌّ معلن: الابن يحجز ولا يُنفّذ ولا يُنهي المهمة؛ فالمقصود قياس الحجز وحده.
 */

import pg from 'pg';

import { createTaskQueue } from '../../../src/execution/queue.mjs';

const [url, worker, limitRaw] = process.argv.slice(2);
if (url === undefined || worker === undefined) {
  console.error('الاستعمال: node claim-child.mjs <DATABASE_URL> <worker> [limit]');
  process.exit(2);
}

const pool = new pg.Pool({ connectionString: url, max: 4 });
pool.on('error', () => {});

try {
  const queue = createTaskQueue({ pool });
  /** @type {string[]} */
  const claimed = [];
  const limit = Number(limitRaw ?? '1');

  // يحجز مراراً حتى يجفّ الطابور: عاملٌ يحجز مرّة واحدة لا يزاحم أحداً، والمقصود
  // هو التزاحم على آخر المهام حيث يظهر التكرار لو وُجد.
  for (;;) {
    const batch = await queue.claim({ worker, limit });
    if (batch.length === 0) break;
    for (const task of batch) claimed.push(task.id);
  }

  process.stdout.write(`${JSON.stringify({ worker, claimed })}\n`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  await pool.end();
}
