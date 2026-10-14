#!/usr/bin/env node
/**
 * مُقلِع عامل التنفيذ — الخطوة `M5.08`.
 *
 *   npm run worker -- --worker عامل-١ --once
 *   npm run worker -- --worker عامل-١ --max-tasks 20 --poll-ms 200
 *
 * السكربت لا يُنشئ سياسةً ولا مفتاح إيقاف من عنده: يقرأ `state/halt.json` القائم
 * ويتحقّق منه بمفتاح الملك العام. **وبلا مفتاح إيقاف قابل للقراءة لا يُقلع العامل
 * أصلاً** — عاملٌ لا يستطيع أن يعرف أنّ النظام أُوقف أخطر من عاملٍ لا يعمل.
 *
 * وفي الإنتاج (‏WL-092): سجلُّ وقائعِ العزلِ **مختومٌ** بمفتاح التوكن، فلا يبقى
 * على القرصِ نصٌّ ظاهرٌ عمّا نُفِّذ ولا عمّن حاول الهرب. والعاملُ يبقى مالكاً
 * لمفتاحٍ عامٍّ وحدَه للإيقاف: عقدةٌ تنفيذٍ تُقرُّ بالتوقفِ ولا تستأنفُ الدولة.
 *
 * وانقطاعُ القاعدة (‏WL-387) لا يُميت العامل: يُصنَّف ويُنتظَر بميزانيةٍ معلنة
 * (`--db-recovery-max-probes`، `--db-recovery-base-ms`، `--db-recovery-max-ms`)
 * ثم يُسوّى ما كان معلّقاً بلا إعادةِ تشغيلِ مُعالِج، ويُقيَّد الحكمُ في سجلِّ العامل
 * نفسِه (مختومٌ في الإنتاج). ورموزُ الخروجِ عند التوقّف الآمن: `75` قاعدةٌ لم تعُد
 * ضمن الميزانية، و`65` عطبٌ ليس تعذّراً (فسادٌ، مخطّطٌ غائب، نتيجةٌ لا تطابق).
 */

import process from 'node:process';

import { PersistentEventLog } from '../src/root-of-trust/persistent-log.mjs';
import {
  HaltSwitch,
  isProductionRuntime,
  openProductionEventLog,
  royalVerifierFromPublicKey,
} from '../src/root-of-trust/index.mjs';
import { createTaskQueue } from '../src/execution/queue.mjs';
import { createWorker } from '../src/execution/worker.mjs';
import {
  RECOVERY_EXIT_CODES,
  RECOVERY_VERDICTS,
  WorkerDatabaseFault,
  abortableSleep,
  createDatabaseRecovery,
} from '../src/execution/db-recovery.mjs';
import { createQuotaLedger } from '../src/policy/quota.mjs';
import { loadPolicyBundle } from '../src/policy/loader.mjs';
import { createPool } from '../src/persistence/db.mjs';

/**
 * @param {readonly string[]} argv
 * @returns {{ worker: string, once: boolean, maxTasks: number, pollMs: number, haltFile: string, publicKey: string | null, recoveryPolicy: { maxProbes?: number, baseDelayMs?: number, maxDelayMs?: number } }}
 */
function parseArguments(argv) {
  /** @type {Record<string, string>} */
  const flags = {};
  let once = false;
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === undefined) continue;
    if (token === '--once') {
      once = true;
      continue;
    }
    if (token.startsWith('--')) {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith('--')) {
        throw new Error(`العلَم ${token} يحتاج قيمة.`);
      }
      flags[token.slice(2)] = value;
      index += 1;
    }
  }
  const worker = flags['worker'] ?? process.env['WORKER_NAME'] ?? '';
  if (worker.trim() === '') {
    throw new Error('اسم العامل مطلوب: --worker <اسم>. عقدٌ بلا صاحب لا يُحاسَب.');
  }
  return {
    worker,
    once,
    maxTasks: Number(flags['max-tasks'] ?? (once ? '1' : '0')) || (once ? 1 : Infinity),
    pollMs: Number(flags['poll-ms'] ?? '200'),
    haltFile: flags['halt-file'] ?? process.env['HALT_FILE'] ?? 'state/halt.json',
    publicKey: flags['halt-public-key'] ?? process.env['HALT_PUBLIC_KEY'] ?? null,
    recoveryPolicy: recoveryPolicyFrom(flags),
  };
}

/**
 * سياسةُ الانتظارِ من الأعلام. قيمةٌ غيرُ صالحةٍ تُرفض لا تُستبدل صامتةً بالافتراضي:
 * ميزانيةٌ لا يعرف مُشغّلُها مقدارَها ليست ميزانية.
 * @param {Record<string, string>} flags
 */
function recoveryPolicyFrom(flags) {
  /** @type {{ maxProbes?: number, baseDelayMs?: number, maxDelayMs?: number }} */
  const policy = {};
  /** @type {Array<[string, 'maxProbes' | 'baseDelayMs' | 'maxDelayMs', number]>} */
  const fields = [
    ['db-recovery-max-probes', 'maxProbes', 1],
    ['db-recovery-base-ms', 'baseDelayMs', 1],
    ['db-recovery-max-ms', 'maxDelayMs', 1],
  ];
  for (const [flag, key, min] of fields) {
    const raw = flags[flag];
    if (raw === undefined) continue;
    const value = Number(raw);
    if (!Number.isInteger(value) || value < min) {
      throw new Error(`العلَم --${flag} يحتاج عدداً صحيحاً ≥ ${min}، لا «${raw}».`);
    }
    policy[key] = value;
  }
  return policy;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.publicKey === null) {
    throw new Error(
      'مفتاح الملك العام مطلوب (--halt-public-key أو HALT_PUBLIC_KEY): مفتاح إيقافٍ غير مُتحقَّق منه ليس حرساً.',
    );
  }
  // `D6` (‏`WL-326`): العاملُ قارئٌ لمفتاحِ الإيقافِ لا كاتب — الكاتبُ الواحدُ عمليةُ الجذر.
  const halt = new HaltSwitch(options.haltFile, royalVerifierFromPublicKey(options.publicKey), {
    readOnly: true,
  });
  const pool = createPool();
  const queue = createTaskQueue({ pool });
  const isolationLogFile = process.env['ISOLATION_LOG_FILE'] ?? 'state/isolation-events.jsonl';
  // في الإنتاج يُفتحُ السجلُّ مختوماً بمفتاحِ التوكن، ويُلبَسُ مصرِفاً مرتَّباً
  // لأن عقدَ `log.append` عندَ العزلِ متزامنٌ والختمُ ليس كذلك. التصريفُ يقعُ
  // عندَ حدودِ المهامِّ وقبلَ الإغلاق، فإن فشلَ ختمُ واقعةٍ توقّفَ العامل.
  const production = isProductionRuntime(process.env);
  const sealed = production ? await openProductionEventLog(process.env, isolationLogFile) : null;
  const isolationLog = sealed === null ? new PersistentEventLog(isolationLogFile) : sealed.log;
  const isolationSink = sealed === null ? isolationLog : sealed.sink;
  const worker = createWorker({
    queue,
    pool,
    haltGuard: halt,
    ledger: createQuotaLedger({ pool, definitions: loadPolicyBundle().quotas }),
    worker: options.worker,
    isolation: {
      workdir: process.cwd(),
      outputRoot: process.env['ISOLATION_OUTPUT_ROOT'] ?? '.isolation-output',
      log: isolationSink,
    },
  });

  // المُستردّ يقيّد في سجلّ العامل نفسه — المختوم في الإنتاج — لا في ملفٍّ جانبيٍّ
  // ظاهر: ما يكشفه قيدُ الاسترداد (مهمّةٌ ومرحلةٌ وبصمةُ نتيجة) يستحقّ الختمَ ذاته.
  const recovery = createDatabaseRecovery({
    pool,
    queue,
    worker: options.worker,
    haltGuard: halt,
    log: isolationSink,
    policy: options.recoveryPolicy,
  });

  let stopping = false;
  const stopper = new AbortController();
  const stop = () => {
    stopping = true;
    stopper.abort();
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);

  process.stdout.write(`عاملٌ أُقلع: ${options.worker} (ملف الإيقاف: ${options.haltFile})\n`);
  let handled = 0;
  /** @type {WorkerDatabaseFault | null} */
  let fault = null;
  /** @type {number | undefined} */
  let exitCode;
  let lastRecoveryLine = '';
  try {
    while (!stopping && handled < options.maxTasks) {
      if (fault !== null) {
        const outcome = await recovery.recover(fault, { signal: stopper.signal });
        // التأجيلُ تحت الإيقاف يُطبع مرّةً لا في كلِّ دورة (كما يُقيَّد في السجلّ مرّة).
        const line = `${outcome.verdict}|${outcome.reason}`;
        if (line !== lastRecoveryLine) {
          process.stdout.write(
            `${new Date().toISOString()} | db-recovery | ${outcome.verdict} | ${outcome.reason} | ${outcome.probes} مسبار | ${outcome.durationMs}ms\n`,
          );
        }
        lastRecoveryLine = outcome.retry ? line : '';
        if (sealed !== null) await sealed.sink.drain();
        if (outcome.verdict === RECOVERY_VERDICTS.FAILED) {
          process.stderr.write(
            `توقّف العامل عند حدٍّ آمن: ${outcome.reason} — يحتاج تدخّلاً مخوَّلاً؛ لم يُعَد تشغيلُ شيءٍ ولم يُكتب شيء.\n`,
          );
          exitCode = outcome.exitCode ?? RECOVERY_EXIT_CODES.DB_INTEGRITY;
          break;
        }
        if (outcome.retry) {
          // الإيقاف السياديّ يؤجّل التسوية: لا كتابة حتى يُستأنف، ولا حجز جديد.
          await abortableSleep(options.pollMs, stopper.signal);
          continue;
        }
        if (outcome.verdict === RECOVERY_VERDICTS.UNVERIFIED && stopping) {
          exitCode = RECOVERY_EXIT_CODES.DB_UNAVAILABLE;
          break;
        }
        fault = null;
        continue;
      }
      let tick;
      try {
        tick = await worker.tick();
      } catch (error) {
        if (!(error instanceof WorkerDatabaseFault)) throw error;
        process.stdout.write(
          `${new Date().toISOString()} | db-fault | ${error.fault.kind}/${error.fault.code} | ${error.phase} | ${error.taskId ?? '—'}\n`,
        );
        fault = error;
        continue;
      }
      process.stdout.write(
        `${new Date().toISOString()} | ${tick.outcome} | ${tick.taskId ?? '—'} | ${tick.code ?? '—'} | ${tick.durationMs}ms\n`,
      );
      if (tick.outcome === 'idle' || (tick.outcome === 'halted' && tick.taskId === null)) {
        if (options.once) break;
        await abortableSleep(options.pollMs, stopper.signal);
        continue;
      }
      handled += 1;
      // تصريفٌ عندَ حدِّ المهمّة: واقعةُ عزلٍ لم تُختَم ولم تُكتَب توقفُ العامل
      // ولا تُمرَّرُ مهمةٌ تالية — سجلٌّ ناقصٌ أخطرُ من عاملٍ متوقف.
      if (sealed !== null) await sealed.sink.drain();
    }
    // توقّفٌ وعطبٌ معلّقٌ لم يُسوَّ: لا يُعلَن خروجاً سليماً.
    if (fault !== null && exitCode === undefined) exitCode = RECOVERY_EXIT_CODES.DB_UNAVAILABLE;
  } finally {
    if (sealed !== null) {
      try {
        await sealed.sink.drain();
      } finally {
        isolationLog.close();
        await sealed.close();
      }
    } else {
      isolationLog.close();
    }
    await pool.end();
  }
  process.stdout.write(`عاملٌ توقّف: ${options.worker} — مهام مُعالَجة: ${handled}\n`);
  if (exitCode !== undefined) process.exitCode = exitCode;
}

main().catch((error) => {
  process.stderr.write(
    `فشل إقلاع العامل: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
