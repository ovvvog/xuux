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
 */

import process from 'node:process';

import { PersistentEventLog } from '../src/root-of-trust/persistent-log.mjs';
import { HaltSwitch, royalVerifierFromPublicKey } from '../src/root-of-trust/index.mjs';
import { createTaskQueue } from '../src/execution/queue.mjs';
import { createWorker } from '../src/execution/worker.mjs';
import { createQuotaLedger } from '../src/policy/quota.mjs';
import { loadPolicyBundle } from '../src/policy/loader.mjs';
import { createPool } from '../src/persistence/db.mjs';

/**
 * @param {readonly string[]} argv
 * @returns {{ worker: string, once: boolean, maxTasks: number, pollMs: number, haltFile: string, publicKey: string | null }}
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
  };
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.publicKey === null) {
    throw new Error(
      'مفتاح الملك العام مطلوب (--halt-public-key أو HALT_PUBLIC_KEY): مفتاح إيقافٍ غير مُتحقَّق منه ليس حرساً.',
    );
  }
  const halt = new HaltSwitch(options.haltFile, royalVerifierFromPublicKey(options.publicKey));
  const pool = createPool();
  const queue = createTaskQueue({ pool });
  const isolationLog = new PersistentEventLog(
    process.env['ISOLATION_LOG_FILE'] ?? 'state/isolation-events.jsonl',
  );
  const worker = createWorker({
    queue,
    pool,
    haltGuard: halt,
    ledger: createQuotaLedger({ pool, definitions: loadPolicyBundle().quotas }),
    worker: options.worker,
    isolation: {
      workdir: process.cwd(),
      outputRoot: process.env['ISOLATION_OUTPUT_ROOT'] ?? '.isolation-output',
      log: isolationLog,
    },
  });

  let stopping = false;
  const stop = () => {
    stopping = true;
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);

  process.stdout.write(`عاملٌ أُقلع: ${options.worker} (ملف الإيقاف: ${options.haltFile})\n`);
  let handled = 0;
  try {
    while (!stopping && handled < options.maxTasks) {
      const tick = await worker.tick();
      process.stdout.write(
        `${new Date().toISOString()} | ${tick.outcome} | ${tick.taskId ?? '—'} | ${tick.code ?? '—'} | ${tick.durationMs}ms\n`,
      );
      if (tick.outcome === 'idle' || (tick.outcome === 'halted' && tick.taskId === null)) {
        if (options.once) break;
        await new Promise((resolve) => setTimeout(resolve, options.pollMs));
        continue;
      }
      handled += 1;
    }
  } finally {
    isolationLog.close();
    await pool.end();
  }
  process.stdout.write(`عاملٌ توقّف: ${options.worker} — مهام مُعالَجة: ${handled}\n`);
}

main().catch((error) => {
  process.stderr.write(
    `فشل إقلاع العامل: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
