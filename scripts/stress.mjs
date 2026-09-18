#!/usr/bin/env node
/**
 * قياس السعة تحت حمل — الخطوة `M5.09`.
 *
 *   npm run stress -- --tasks 200 --workers 4
 *
 * يُدخل مهاماً حقيقية في القاعدة، يُشغّل عمّالاً حقيقيين عليها، ثم يطبع أرقاماً
 * **مقيسة**: إنتاجية (مهمة/ثانية)، وp50/p95 لزمن الحجز، ومعدّل الفشل. والغاية
 * ليست الرقم بذاته بل أن يكون في الخارطة رقمٌ مُقاس بدل تخمينٍ عن السعة.
 *
 * ## الحدود المعلنة
 *
 * 1. المُعالِج المُستعمل `اختبار.نجاح` وهو خفيف: الرقم يقيس **سعة النواة**
 *    (حجز + تنفيذ في عملية + إنهاء) لا سعة عملٍ حقيقي ثقيل.
 * 2. كل مهمة تُقلع عملية Node منفصلة، وذلك أغلى ما في الدورة. فالإنتاجية هنا
 *    محدودة بإقلاع العمليات لا بالقاعدة، وهذا حدٌّ معلن.
 * 3. الرقم لعتاد الجهاز المُقاس عليه وحده، ومعه ساعة القاعدة نفسها. نقلُه إلى
 *    عتادٍ آخر بلا إعادة قياس تخمينٌ لا قياس.
 */

import process from 'node:process';

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { cpus, totalmem } from 'node:os';
import path from 'node:path';

import { HaltSwitch, KingIdentity } from '../src/root-of-trust/index.mjs';
import { createTaskQueue } from '../src/execution/queue.mjs';
import { createWorker } from '../src/execution/worker.mjs';
import { createPool } from '../src/persistence/db.mjs';

/**
 * @param {readonly number[]} values
 * @param {number} quantile
 * @returns {number}
 */
export function percentile(values, quantile) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  // فهرسٌ مقصوص لا مُقرَّب: p95 يجب ألا تُختار قيمةً أصغر من 95% من القيم.
  const index = Math.min(sorted.length - 1, Math.ceil((quantile / 100) * sorted.length) - 1);
  return sorted[Math.max(0, index)] ?? 0;
}

/**
 * يُشغّل قياساً واحداً. يُصدَّر كي يستعمله الاختبار بنفس المسار لا بمسارٍ موازٍ
 * يُقاس في الاختبار ويُنشر في الوثيقة غيرُه.
 * @param {object} options
 * @param {import('pg').Pool} options.pool
 * @param {number} options.tasks
 * @param {number} options.workers
 * @param {{ assertOperational: () => void }} [options.haltGuard]
 * @param {string} [options.label]
 * @returns {Promise<{ tasks: number, workers: number, succeeded: number, failed: number, enqueueMs: number, drainMs: number, throughputPerSecond: number, claimP50Ms: number, claimP95Ms: number }>}
 */
export async function runStress({ pool, tasks, workers, haltGuard, label = 'stress' }) {
  const queue = createTaskQueue({ pool });
  const guard = haltGuard ?? createLocalHaltGuard();

  const enqueueStartedAt = Date.now();
  for (let index = 0; index < tasks; index += 1) {
    await queue.enqueue(
      {
        action: 'اختبار.نجاح',
        target: `stress/${label}/${index}`,
        actorId: `actor-stress-${index % workers}`,
        idempotencyKey: `${label}-${index}`,
        payload: { index },
        timeoutMs: 15_000,
        memoryLimitMb: 96,
      },
      { decisionId: `decision-${label}` },
    );
  }
  const enqueueMs = Date.now() - enqueueStartedAt;

  /** @type {number[]} */
  const durations = [];
  let succeeded = 0;
  let failed = 0;

  const drainStartedAt = Date.now();
  await Promise.all(
    Array.from({ length: workers }, async (_unused, slot) => {
      const worker = createWorker({
        queue,
        pool,
        haltGuard: guard,
        worker: `stress-worker-${slot}`,
      });
      const result = await worker.run({ stopWhenIdle: true, pollMs: 20, deadlineMs: 300_000 });
      for (const tick of result.ticks) {
        if (tick.outcome === 'done') {
          succeeded += 1;
          durations.push(tick.durationMs);
        } else if (tick.outcome !== 'idle' && tick.outcome !== 'halted') {
          failed += 1;
        }
      }
    }),
  );
  const drainMs = Math.max(1, Date.now() - drainStartedAt);

  return {
    tasks,
    workers,
    succeeded,
    failed,
    enqueueMs,
    drainMs,
    throughputPerSecond: Number(((succeeded / drainMs) * 1000).toFixed(2)),
    claimP50Ms: percentile(durations, 50),
    claimP95Ms: percentile(durations, 95),
  };
}

/** مفتاح إيقاف محلّي للقياس فقط: القياس يجري على نظامٍ عاملٍ لا موقوف. */
function createLocalHaltGuard() {
  const dir = mkdtempSync(path.join(tmpdir(), 'stress-halt-'));
  // `WL-219`: هذا النصُّ يُشغَّلُ عمليّةً فرعيّةً من اختبارٍ، فلا يَبلُغُهُ مُعِينُ
  // `tests/helpers/tmp-roots.mjs`. **وذاكَ حدٌّ مُعلَنٌ أمسكَهُ القياسُ السلوكيُّ في CI
  // لا تحليلُ النصِّ** — فالمحوُ مُدبَّرٌ هنا عندَ خروجِ العمليّةِ.
  process.on('exit', () => {
    rmSync(dir, { recursive: true, force: true });
  });
  return new HaltSwitch(path.join(dir, 'state', 'halt.json'), new KingIdentity(), { fsync: false });
}

async function main() {
  const argv = process.argv.slice(2);
  /** @param {string} name @param {number} fallback */
  const flag = (name, fallback) => {
    const at = argv.indexOf(`--${name}`);
    if (at === -1) return fallback;
    return Number(argv[at + 1] ?? fallback) || fallback;
  };
  const pool = createPool();
  try {
    const report = await runStress({
      pool,
      tasks: flag('tasks', 100),
      workers: flag('workers', 4),
      label: `cli-${Date.now()}`,
    });
    process.stdout.write(
      [
        `العتاد: ${cpus().length} vCPU، ${(totalmem() / 1024 ** 3).toFixed(1)}GB، ${process.version}`,
        `مهام: ${report.tasks} | عمّال: ${report.workers}`,
        `إدخال: ${report.enqueueMs}ms | تصريف: ${report.drainMs}ms`,
        `ناجحة: ${report.succeeded} | فاشلة: ${report.failed}`,
        `إنتاجية: ${report.throughputPerSecond} مهمة/ثانية`,
        `زمن الدورة p50: ${report.claimP50Ms}ms | p95: ${report.claimP95Ms}ms`,
        '',
      ].join('\n'),
    );
  } finally {
    await pool.end();
  }
}

if (process.argv[1] !== undefined && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  main().catch((error) => {
    process.stderr.write(`فشل القياس: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
