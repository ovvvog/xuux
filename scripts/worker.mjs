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
  createPendingResultStore,
  settlePendingResults,
  settleUntilAdmitted,
} from '../src/execution/pending-results.mjs';
import {
  RECOVERY_EXIT_CODES,
  RECOVERY_VERDICTS,
  WorkerDatabaseFault,
  abortableSleep,
  classifyDatabaseFault,
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
  // مخزنُ النتائجِ المعلّقةِ (‏`WL-392`): يكتبُ في سجلِّ العاملِ الدائمِ نفسِهِ —
  // القيمةُ تدومُ على القرصِ قبلَ أولِ كتابةٍ للقاعدةِ، وتُسوّى عندَ إقلاعٍ جديدٍ
  // من الحياةِ السابقةِ للعمليةِ بلا إعادةِ تشغيلِ المُعالِج.
  const pendingResults = createPendingResultStore({
    reader: isolationLog,
    writer: isolationSink,
    worker: options.worker,
  });
  const worker = createWorker({
    queue,
    pool,
    haltGuard: halt,
    ledger: createQuotaLedger({ pool, definitions: loadPolicyBundle().quotas }),
    worker: options.worker,
    pendingResults,
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
  // تسويةُ النتائجِ المعلّقةِ من حياةٍ سابقةٍ للعمليةِ **قبلَ أيِّ حجزٍ جديدٍ** —
  // لا يُحجزُ شقٌّ جديدَ وما زالَ للقيمةِ المُنتَجةِ حقٌّ لم يُستوفَ. والقاعدةُ
  // متوقّفة؟ **يُؤجَّلُ الحجزُ الجديدُ نفسُهُ** كما يُؤجَّلُ الاستردادُ: تُرمى العَطِلةُ
  // وتدخل الحلقةَ في حالةِ العطبِ فلا حجزَ حتى تعودَ القاعدةُ ثمّ تُعادُ المحاولةُ.
  // وما ليسَ عطبَ قاعدةٍ (فسادٌ، عقدٌ غائبٌ) يُرمى كما هو: توقّفٌ عندَ حدٍّ آمنٍ
  // لا التهامٌ الصامتُ الذي يمرّرُ الكاسبَ الجديدَ فوقَ حقٍّ لم يُستوفَ.
  // والإيقافُ السياديّ يؤجّلُ التسويةَ كلَّها: السجلاتُ تنتظرُ الاستئنافَ ولا كتابةَ تحته.
  // والحصيلةُ تحملُ **تأجيلَها بنفسِها** (`deferred`): لا يُعادُ بناءُ «هل
  // أُجِّلتِ التسويةُ؟» من عيّنةٍ لاحقةٍ لحالةِ الإيقافِ — فالاستئنافُ قد يقعُ
  // بينَ التسويةِ والعيّنةِ فيُبنى العلمُ على العدمِ ويُحجزُ شقٌّ فوقَ معلّقةٍ
  // لم تُقضَ. العلمُ يُحملُ من التسويةِ نفسِها.
  /** @returns {Promise<{ fault: WorkerDatabaseFault | null, deferred: boolean }>} */
  const settlePending = async () => {
    try {
      const counts = await settlePendingResults({ store: pendingResults, queue, haltGuard: halt });
      if (counts.examined > 0) {
        process.stdout.write(
          `${new Date().toISOString()} | pending-results | سُوّيت: ${counts.settled} | عُلّقت: ${counts.superseded} | تضادّت: ${counts.conflicts}\n`,
        );
      }
      return { fault: null, deferred: counts.deferred === true };
    } catch (error) {
      const fault = classifyDatabaseFault(error);
      if (fault === null) throw error;
      process.stdout.write(
        `${new Date().toISOString()} | pending-results | عَطِلةُ قاعدةٍ عندَ التسويةِ (${fault.kind}/${fault.code}): الحجزُ الجديدُ مؤجَّلٌ حتى عودتِها\n`,
      );
      return {
        fault: new WorkerDatabaseFault({
          worker: options.worker,
          phase: 'settle-pending',
          taskId: null,
          pending: null,
          fault,
          cause: error,
          at: new Date(),
        }),
        deferred: false,
      };
    }
  };
  let handled = 0;
  /** @type {WorkerDatabaseFault | null} */
  let fault;
  /** @type {number | undefined} */
  let exitCode;
  let lastRecoveryLine = '';
  try {
    // تسويةُ الإقلاعِ: عَطِلةٌ هنا تُدخلُ الحلقةَ في حالةِ العطبِ فتُؤجّلُ الحجزَ
    // الجديدَ حتى تعودَ القاعدةُ ثمّ تُعادُ المحاولةُ — لا يُمرَّرُ كاسبٌ جديدٌ فوقَ
    // قيمةٍ معلّقةٍ لم يُحسَمْ حقُّها.
    const bootSettlement = await settlePending();
    fault = bootSettlement.fault;
    // الإيقافُ السياديُّ **يؤجّلُ التسويةَ ولا يُلغيها**: لا يُحجزُ شقٌّ جديدٌ قبلَ
    // أن تُسوّى النتيجةُ المعلّقةُ التي كانت قبلَه — وعَطِلةُ قاعدةٍ عندَها
    // تدخلُ الحلقةَ في حالةِ العطبِ (استردادٌ ينتظرُ بميزانيتِهِ لا دورانٌ فارغٌ).
    // والتأجيلُ يُحملُ من حصيلةِ التسويةِ نفسِها لا من عيّنةٍ لاحقةٍ.
    const isHalted = () => {
      try {
        halt.assertOperational();
        return false;
      } catch {
        return true;
      }
    };
    let settlementDeferred = bootSettlement.deferred;
    while (!stopping && handled < options.maxTasks) {
      // بوابةُ الحجزِ (مستخرجةٌ لتُقاضى وتُختبرَ): قرارٌ واحدٌ في رأسِ كلِّ
      // دورةٍ — والعلمُ المُقاضى **المحمولُ من حصيلةِ آخرِّ تسويةٍ** لا عيّنةً
      // لاحقةً لحالةِ الإيقافِ. فالاستئنافُ بعدَ إيقافٍ عندَ الإقلاعِ: التسويةُ
      // المؤجَّلةُ تُقضى قبلَ أولِ حجزٍ جديدٍ لا بعده — فالقيمةُ المعلّقةُ أحقُّ
      // من شقٍّ جديد. وإن عطِبَتِ القاعدةُ عندَها فالأمرُ إلى الاستردادِ
      // (ينتظرُ بميزانيتِه) لا إلى إعادةِ نداءٍ فارغةٍ تدورُ بلا انتظار.
      if (fault === null && settlementDeferred) {
        // **العزفُ المستخرجُ نفسُهُ** الذي يُختبرُ (`settleUntilAdmitted`): لا
        // حجزَ في الدورةِ التي حاولتِ التسويةَ — التأجيلُ العائدُ يعيدُ المنعَ
        // والعطبُ إلى الاستردادِ، حتى تعلنَ الحصيلةُ نفسُها انقضاءَ التأجيلِ.
        const outcome = await settleUntilAdmitted({
          halted: isHalted,
          settle: settlePending,
          wait: async () => {
            await abortableSleep(options.pollMs, stopper.signal);
          },
          stopped: () => stopping,
        });
        if (outcome.verdict === 'stopped') break;
        if (outcome.verdict === 'fault') {
          fault = /** @type {WorkerDatabaseFault} */ (outcome.fault);
          continue;
        }
        settlementDeferred = false;
        continue;
      }
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
        // القاعدةُ عادت: أُعيدت المحاولةُ على ما دامَ معلّقاً في السجلّ الدائمِ
        // من الحياةِ السابقةِ — والقيمةُ لا تُفقدُ بانقطاعِ القاعدةِ عندَ التسجيلِ.
        // وعادت العَطِلةُ عندَ التسويةِ؟ يُعادُ تأجيلُ الحجزِ لا الالتهامُ.
        const settleResult = await settlePending();
        if (settleResult.fault !== null) {
          fault = settleResult.fault;
          continue;
        }
        settlementDeferred = settleResult.deferred;
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
