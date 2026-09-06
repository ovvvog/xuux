/**
 * عامل التنفيذ — الخطوات `M5.05` و`M5.06` و`M5.07` و`M5.08` مجتمعةً في حلقة واحدة.
 *
 * دورة العامل، بترتيبٍ مقصود لا يُبدَّل:
 *
 * 1. **الإيقاف الشامل يُقرأ قبل كل حجز** (`M5.08`). لو قُرئ بعده لحُجزت مهمة في
 *    لحظة الإيقاف وبقيت محجوزةً بعقدٍ لعاملٍ لن يُشغّلها.
 * 2. الحجز الذرّي من الطابور (`claim`) — عقدٌ لهذا العامل وحده.
 * 3. **الإيقاف يُقرأ ثانياً قبل تشغيل المُعالِج**: بين الحجز والتشغيل نافذةُ زمن،
 *    وإن أُوقف النظام فيها فالمهمة تُعاد إلى الطابور بلا تنفيذ ولا فقدان.
 * 4. الميزانية تُحاسَب **قبل** التشغيل (`M5.06`): من نفدت ميزانيته لا يبدأ.
 * 5. التنفيذ في عملية منفصلة بحدود مفروضة (`M5.05`).
 * 6. نبضة قلب دورية تمدّ العقد وتنقل طلب الإلغاء، فيُقتل المُعالِج قسراً (`M5.07`).
 *
 * ## الحدود المعلنة
 *
 * - العامل يُنفّذ مهمة واحدة في كل دورة (`limit: 1`). التوازي في هذه الخطوة يكون
 *   **بعمّال متعددين** لا بخيوطٍ داخل عاملٍ واحد؛ وهذا أصدق لأن الحجز الذرّي هو
 *   ما يحرس التوازي فعلاً، وقد قِيس بعمليات منفصلة في `tests/execution/idempotency`.
 * - الإيقاف الشامل يوقف **بدء** العمل ويُعيد المحجوز؛ ولا يقتل مُعالِجاً بدأ
 *   فعلاً في نفس اللحظة إلا عبر نبضة القلب في دورتها التالية. فنافذة الإيقاف
 *   ليست صفراً، ومقدارها `heartbeatMs` وهو رقم معلن لا مستور.
 * - العامل لا يحرس نفسه من الموت: موته يُعالجه `reclaimExpired` من عاملٍ آخر أو
 *   من حاصدٍ مجدول. عاملٌ واحد بلا حاصد يعني مهمةً معلّقة إلى أن يُقلع غيره.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createBudgetGate } from './budget.mjs';
import { runIsolated } from './isolation.mjs';
import { LIMIT_ERRORS, runWithLimits } from './limits.mjs';
import { TaskLifecycle } from './lifecycle.mjs';
import { QUEUE_ERRORS, QueueError } from './queue.mjs';

/** رموز العامل. */
export const WORKER_ERRORS = Object.freeze({
  DEPENDENCY_MISSING: 'WORKER_DEPENDENCY_MISSING',
  ISOLATION_CONFIG_INVALID: 'WORKER_ISOLATION_CONFIG_INVALID',
  ISOLATION_RESULT_INVALID: 'WORKER_ISOLATION_RESULT_INVALID',
});

/** خطأ إعداد العامل. */
export class WorkerError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   */
  constructor(code, message) {
    super(message);
    this.name = 'WorkerError';
    /** @type {string} */
    this.code = code;
  }
}

/**
 * حصيلة دورةٍ واحدة. تُقرأ في الاختبار وفي سكربت التشغيل، ولذلك تُفصّل الأسباب:
 * `halted` تختلف عن `idle` اختلافاً جوهرياً — الأولى منعٌ والثانية فراغُ طابور.
 * @typedef {object} WorkerTick
 * @property {'halted' | 'idle' | 'done' | 'failed' | 'cancelled' | 'budget-denied' | 'requeued'} outcome
 * @property {string | null} taskId
 * @property {string | null} code
 * @property {number} durationMs
 */

/**
 * @param {object} dependencies
 * @param {ReturnType<import('./queue.mjs').createTaskQueue>} dependencies.queue
 * @param {import('pg').Pool} dependencies.pool
 * @param {{ assertOperational: () => void }} dependencies.haltGuard حرس الإيقاف الشامل (`M2.08`).
 * @param {{ debit: Function, read: Function }} [dependencies.ledger] دفتر الحصص (`M4.07`).
 * @param {string} dependencies.worker اسم العامل — يُكتب في العقد فيُعرف صاحبه.
 * @param {number} [dependencies.heartbeatMs]
 * @param {(run: import('./limits.mjs').LimitedRun) => void} [dependencies.onRun]
 * @param {{ workdir?: string, outputRoot?: string, log: { append: (type: string, actor: string, payload: object) => unknown }, quarantine?: { report: (signal: object) => unknown } | null }} [dependencies.isolation]
 */
export function createWorker({
  queue,
  pool,
  haltGuard,
  ledger,
  worker,
  heartbeatMs = 500,
  onRun,
  isolation,
}) {
  if (queue === undefined || pool === undefined || haltGuard === undefined) {
    throw new WorkerError(
      WORKER_ERRORS.DEPENDENCY_MISSING,
      'العامل يحتاج طابوراً ومجمّع قاعدة وحرس إيقاف؛ عاملٌ بلا حرس إيقاف لا يتوقّف عند الإيقاف الشامل وهو خطر لا نقص.',
    );
  }
  if (typeof worker !== 'string' || worker.trim() === '') {
    throw new WorkerError(
      WORKER_ERRORS.DEPENDENCY_MISSING,
      'اسم العامل مطلوب: عقدٌ بلا صاحب لا يُحاسَب.',
    );
  }

  const budget = ledger === undefined ? null : createBudgetGate({ pool, ledger });
  const isolatedRunner = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../../scripts/isolated-task-runner.mjs',
  );
  if (isolation !== undefined && (!isolation.log || typeof isolation.log.append !== 'function')) {
    throw new WorkerError(
      WORKER_ERRORS.ISOLATION_CONFIG_INVALID,
      'العزل المفعّل يحتاج سجلاً دائماً؛ لا يُسمح بتشغيل مهمة معزولة بلا أثر تدقيقي.',
    );
  }

  /**
   * نفّذ المهمة في العزل الحقيقي عند تفعيله، أو في مسار حدود الموارد للاختبارات
   * والوحدات التي لم تُركّب لها بيئة تشغيل إنتاجية بعد.
   * @param {object} input
   * @param {Record<string, unknown>} input.task
   * @param {AbortSignal} input.signal
   */
  async function runTask({ task, signal }) {
    if (isolation === undefined) {
      return runWithLimits({
        action: String(task['action']),
        payload: /** @type {Record<string, unknown>} */ (task['payload'] ?? {}),
        timeoutMs: Number(task['timeoutMs']),
        memoryLimitMb: Number(task['memoryLimitMb']),
        signal,
        taskId: String(task['id']),
      });
    }
    const workdir = path.resolve(isolation.workdir ?? process.cwd());
    const outputRoot = path.resolve(
      isolation.outputRoot ?? path.join(workdir, '.isolation-output'),
    );
    fs.mkdirSync(outputRoot, { recursive: true });
    const outputDir = fs.mkdtempSync(path.join(outputRoot, 'task-'));
    try {
      const result = await runIsolated({
        command: process.execPath,
        args: [isolatedRunner, String(task['action']), JSON.stringify(task['payload'] ?? {})],
        workdir,
        writableDir: outputDir,
        timeoutMs: Number(task['timeoutMs']),
        memoryLimitMb: Number(task['memoryLimitMb']),
        signal,
        actor: `worker:${worker}:${String(task['id'])}`,
        log: isolation.log,
        quarantine: isolation.quarantine ?? null,
      });
      if (!result.ok) return { ...result, result: undefined, cpuMs: 0 };
      try {
        const envelope = JSON.parse(result.stdout.trim());
        if (
          envelope?.ok !== true ||
          typeof envelope.result !== 'object' ||
          envelope.result === null
        ) {
          throw new Error('غلاف نتيجة العزل غير صالح.');
        }
        return { ...result, result: envelope.result, cpuMs: 0 };
      } catch (error) {
        return {
          ...result,
          ok: false,
          code: WORKER_ERRORS.ISOLATION_RESULT_INVALID,
          message: error instanceof Error ? error.message : String(error),
          result: undefined,
          cpuMs: 0,
        };
      }
    } finally {
      fs.rmSync(outputDir, { recursive: true, force: true });
    }
  }

  /** @returns {boolean} هل النظام مُوقف الآن؟ */
  function isHalted() {
    try {
      haltGuard.assertOperational();
      return false;
    } catch {
      // الإيقاف ليس عطباً في العامل بل قراراً فوقه: يُقرأ حالةً لا استثناءً يُرفع.
      return true;
    }
  }

  return Object.freeze({
    /**
     * دورة واحدة: حجزٌ واحد وتنفيذه إن جاز. تُعيد حصيلتها ولا ترمي عند الإيقاف
     * أو فراغ الطابور، لأن كليهما وضعٌ طبيعي لا عطب.
     * @returns {Promise<WorkerTick>}
     */
    async tick() {
      const startedAt = Date.now();
      /** @param {WorkerTick['outcome']} outcome @param {string | null} taskId @param {string | null} code */
      const finish = (outcome, taskId, code) => ({
        outcome,
        taskId,
        code,
        durationMs: Date.now() - startedAt,
      });

      // (1) الإيقاف قبل الحجز: لا مهمة تُحجز بعد الإيقاف.
      if (isHalted()) return finish('halted', null, 'HALTED');

      const claimed = await queue.claim({ worker, limit: 1 });
      const task = claimed[0];
      if (task === undefined) return finish('idle', null, null);

      // (3) الإيقاف بعد الحجز وقبل التشغيل: تُعاد المهمة بلا تنفيذ ولا فقدان.
      if (isHalted()) {
        await queue.fail({
          taskId: task.id,
          worker,
          code: 'TASK_HALTED',
          message:
            'أُوقف النظام إيقافاً شاملاً بعد الحجز وقبل التشغيل؛ أُعيدت المهمة إلى الطابور بلا تنفيذ.',
          retryable: true,
        });
        return finish('halted', task.id, 'TASK_HALTED');
      }

      // (4) الميزانية قبل التشغيل: من نفدت ميزانيته لا يبدأ.
      if (budget !== null) {
        const decision = await budget.chargeBeforeStart(task);
        if (!decision.allowed) {
          await queue.fail({
            taskId: task.id,
            worker,
            code: decision.code ?? 'TASK_BUDGET_EXHAUSTED',
            message: decision.message ?? 'رفضت الميزانية تشغيل المهمة.',
            // نفاد الميزانية ليس عطباً عارضاً يُرجى زواله بإعادة المحاولة: يُنهى
            // نهائياً وتُسجَّل رسالته الميتة كي يراها بشر.
            retryable: false,
          });
          return finish('budget-denied', task.id, decision.code ?? null);
        }
      }

      // (6) نبضة القلب: تمدّ العقد وتنقل طلب الإلغاء إلى قتلٍ قسري.
      const controller = new AbortController();
      const beat = setInterval(() => {
        void (async () => {
          try {
            const reading = await queue.heartbeat({ taskId: task.id, worker });
            // فقدُ العقد أو طلب الإلغاء أو الإيقاف الشامل: ثلاثتها تُوقف التنفيذ.
            if (reading.cancelRequested || !reading.extended || isHalted()) controller.abort();
          } catch {
            // خطأ نبضة قلب لا يُترك يُسقط العامل، لكنه لا يُبتلع أثره: يُقطع
            // التنفيذ لأن عاملاً لا يستطيع تمديد عقده لا يجوز أن يستمرّ.
            controller.abort();
          }
        })();
      }, heartbeatMs);
      beat.unref();

      try {
        // (5) التنفيذ بحدوده في عملية منفصلة.
        const run = await runTask({ task, signal: controller.signal });
        onRun?.(run);

        if (run.ok) {
          await queue.succeed({ taskId: task.id, worker, result: run.result ?? {} });
          return finish('done', task.id, null);
        }

        if (run.code === LIMIT_ERRORS.CANCELLED) {
          const current = await queue.get(task.id);
          if (current?.cancelRequested === true) {
            await queue.confirmCancelled({ taskId: task.id, worker });
            return finish('cancelled', task.id, LIMIT_ERRORS.CANCELLED);
          }
          // أُلغي التنفيذ بلا طلب إلغاء على المهمة ⇒ السبب إيقافٌ شامل أو فقدُ
          // عقد. تُعاد إلى الطابور بلا فقدان، ولا تُعلن ملغاة كذباً.
          try {
            await queue.fail({
              taskId: task.id,
              worker,
              code: 'TASK_HALTED',
              message: 'قُطع التنفيذ (إيقاف شامل أو فقدُ عقد) فأُعيدت المهمة إلى الطابور.',
              retryable: true,
            });
            return finish('requeued', task.id, 'TASK_HALTED');
          } catch (error) {
            // فقدُ العقد يعني أن غيره استعادها: لا خبر أصدق من ذلك ولا فقدان.
            if (error instanceof QueueError && error.code === QUEUE_ERRORS.LEASE_LOST) {
              return finish('requeued', task.id, QUEUE_ERRORS.LEASE_LOST);
            }
            throw error;
          }
        }

        await queue.fail({
          taskId: task.id,
          worker,
          code: run.code ?? LIMIT_ERRORS.HANDLER_FAILED,
          message: run.message ?? 'فشل بلا رسالة',
          // تجاوز الحدّ ليس عطباً عارضاً: إعادةُ نفس المهمة بنفس حدّها ستتجاوزه
          // مرّة أخرى. فتُعاد لأن الحمل قد يكون عارضاً، وهذا حدٌّ معلن يُراجَع
          // بقرار مالك لا بتخمين منفّذ.
          retryable: true,
        });
        return finish('failed', task.id, run.code);
      } finally {
        clearInterval(beat);
      }
    },

    /**
     * حلقةٌ تدور حتى تنتهي المهام أو يُبلغ السقف. تُستعمل في السكربت وفي الضغط.
     * @param {{ maxTasks?: number, pollMs?: number, stopWhenIdle?: boolean, deadlineMs?: number }} [options]
     * @returns {Promise<{ ticks: WorkerTick[], stopped: 'max' | 'idle' | 'halted' | 'deadline' }>}
     */
    async run(options = {}) {
      const maxTasks = options.maxTasks ?? Infinity;
      const pollMs = options.pollMs ?? 100;
      const stopWhenIdle = options.stopWhenIdle ?? false;
      const deadline =
        options.deadlineMs === undefined ? Infinity : Date.now() + options.deadlineMs;
      /** @type {WorkerTick[]} */
      const ticks = [];
      let handled = 0;

      for (;;) {
        if (Date.now() >= deadline) return { ticks, stopped: 'deadline' };
        const tick = await this.tick();
        ticks.push(tick);

        if (tick.outcome === 'halted' && tick.taskId === null) {
          // الإيقاف الشامل: لا تدوير حلقةٍ محتدمة على قاعدة لا تُقرأ منها.
          if (stopWhenIdle) return { ticks, stopped: 'halted' };
          await new Promise((resolve) => setTimeout(resolve, pollMs));
          continue;
        }
        if (tick.outcome === 'idle') {
          if (stopWhenIdle) return { ticks, stopped: 'idle' };
          await new Promise((resolve) => setTimeout(resolve, pollMs));
          continue;
        }
        handled += 1;
        if (handled >= maxTasks) return { ticks, stopped: 'max' };
      }
    },
  });
}

/** يُصدَّر للتوثيق: حالات المهمة النهائية التي لا يعمل عليها العامل. */
export const WORKER_TERMINAL_STATES = Object.freeze([
  TaskLifecycle.SUCCEEDED,
  TaskLifecycle.FAILED,
  TaskLifecycle.CANCELLED,
]);
