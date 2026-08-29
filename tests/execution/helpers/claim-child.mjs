/**
 * عملية ابنٌ تحجز مهاماً من الطابور — مساعد اختبار `M5.03`.
 *
 * لماذا عملية منفصلة؟ لأن «لا تُنفَّذ مهمة مرتين» ادّعاءٌ عن **عمّال متعددين**،
 * وعمّالٌ داخل عملية واحدة يتشاركون حلقة أحداث واحدة ومجمّع اتصالٍ واحداً، فقد
 * ينجح الاختبار بسبب ترتيب حلقة الأحداث لا بسبب ذرّية الحجز في القاعدة. أمّا
 * عمليات `node` حقيقية متزامنة على قاعدة واحدة فلا يحرسها إلا `FOR UPDATE SKIP
 * LOCKED` نفسه.
 *
 * الاستعمال: `node claim-child.mjs <DATABASE_URL> <اسم العامل> <حدّ الحجز> [خطُّ البداية]`
 * و«خطُّ البداية» عصرٌ بالمللي ثانية ينتظره الابن **بعد** تسخين اتصاله وقبل أوّلِ
 * حجز. أُضيف في `WL-045`: كان الأبناء يُقلعون على غير موعدٍ، فعلى آلةٍ مشغولةٍ
 * يسبق أوّلُهم البقيةَ بمئاتِ المللي ثانية فيحجز الستّين كلَّها، فيُخفق الاختبارُ
 * بدعواه الصادقة «عاملٌ واحدٌ حجز الكلَّ ⇒ لا تزاحمَ فُحص فعلاً» — إخفاقُ ترتيبِ
 * إقلاعٍ لا إخفاقُ ذرّيةِ حجز. والخطُّ الواحدُ يجعل التزاحمَ **مُقاماً** لا
 * مرجوّاً، ولا يُضعِف الدعوى: `FOR UPDATE SKIP LOCKED` هو وحده ما يحرسها.
 * ويُطبع على المخرج القياسي سطرُ JSON واحد: `{"worker":…,"claimed":[معرّفات]}`.
 *
 * حدٌّ معلن: الابن يحجز ولا يُنفّذ ولا يُنهي المهمة؛ فالمقصود قياس الحجز وحده.
 */

import pg from 'pg';

import { createTaskQueue } from '../../../src/execution/queue.mjs';

const [url, worker, limitRaw, startAtRaw] = process.argv.slice(2);
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

  // تسخينُ الاتصالِ قبل خطِّ البداية: أوّلُ نداءٍ يفتح مِقبساً ويُصادِق، وذاك
  // زمنٌ لا علاقةَ له بالتزاحم فلا يُحسَب فيه.
  await pool.query('SELECT 1');
  const startAt = Number(startAtRaw ?? '0');
  if (Number.isFinite(startAt) && startAt > 0) {
    const remaining = startAt - Date.now();
    if (remaining > 0) await new Promise((resolve) => setTimeout(resolve, remaining));
  }

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
