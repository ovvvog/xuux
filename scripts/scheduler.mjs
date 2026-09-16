#!/usr/bin/env node
/**
 * مُشغِّلُ المُجدوِلِ السياديِّ — إغلاقُ الدَينِ `D-4` (‏`WL-191`).
 *
 * **معيارُ الإغلاقِ بحرفِه (‏`§4.2`):** «مُجدوِلٌ يُطلِقُ التقاريرَ والتمارينَ بلا
 * نداءٍ يدويٍّ، مقيسٌ بواقعةٍ في دفترٍ». فهذا النصُّ هو الموضعُ الذي يصيرُ فيه
 * العهدُ فعلاً: يبني التركيبَ، ويُسجِّلُ مُنفِّذي الأعمالِ المعلَنةِ في
 * `config/schedule.yaml`، ثمّ يُطلِقُ المؤقِّتَ. وبعدَه لا يُنادى تقريرٌ ولا
 * تمرينٌ **لكلِّ تشغيلٍ**؛ ويبقى الفاعلُ مُسمّىً لأنّ التشغيلَ الأوّلَ بيدِ
 * مُشغِّلٍ له هويةٌ من جذرِ الثقةِ — فلا فاعلَ اسمُه «النظامُ».
 *
 * والاستعمالُ:
 *
 * ```
 * node scripts/scheduler.mjs --self-check      # براهينُ الآليّةِ بساعةٍ مُمرَّرةٍ
 * node scripts/scheduler.mjs --once   [--json] # نبضةٌ واحدةٌ ثمّ خروجٌ
 * node scripts/scheduler.mjs --watch  [--json] # مؤقِّتٌ يعملُ حتى إشارةِ إيقافٍ
 * ```
 *
 * ورمزُ الخروجِ: `0` نبضةٌ وقعت بلا رفضٍ، و`74` نبضةٌ فيها رفضٌ أو عملٌ فاشلٌ —
 * فرفضٌ يخرجُ بصفرٍ يجعلُ مُراقِبَ العمليّةِ يقرأُ الصمتَ نجاحاً، و`75` تركيبٌ
 * لم يقمْ أصلاً.
 *
 * **حدودٌ مُعلَنةٌ:** بلا `DATABASE_URL` يعملُ على مستودعاتِ الذاكرةِ، ودفترٌ في
 * الذاكرةِ يزولُ بانتهاءِ العمليّةِ فلا يمنعُ إطلاقاً مزدوجاً بينَ عمليّتينِ —
 * حجزُ الشقِّ بينَ العمليّاتِ قيدُ تفرّدٍ في القاعدةِ لا في الذاكرةِ. وتفصيلُ
 * الحدودِ في `docs/SCHEDULING.md`.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { composeEnforcementChain } from '../src/core/composition-root.mjs';
import {
  createMemoryRepositories,
  createPostgresRepositories,
} from '../src/persistence/composition.mjs';
import { createPool } from '../src/persistence/db.mjs';
import { loadDeferrals, loadReadinessContract } from '../src/readiness/contract.mjs';
import { EventLog } from '../src/root-of-trust/index.mjs';
import {
  Scheduler,
  ScheduledRunLedger,
  SCHEDULER_ERRORS,
  loadSchedulePolicy,
} from '../src/scheduling/index.mjs';
import { collectReadinessFacts } from './lib/readiness-facts.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const CONFIG_DIR = path.join(ROOT, 'config');
const EXIT_REFUSED = 74;
const EXIT_UNCOMPOSED = 75;

/**
 * @param {string[]} argv
 * @returns {{ mode: 'once' | 'watch' | 'self-check', json: boolean }}
 */
function parseArguments(argv) {
  const mode = argv.includes('--watch')
    ? /** @type {const} */ ('watch')
    : argv.includes('--self-check')
      ? /** @type {const} */ ('self-check')
      : /** @type {const} */ ('once');
  return { mode, json: argv.includes('--json') };
}

/**
 * مُنفِّذُ تقريرِ الجاهزيّةِ: يقرأُ الحقائقَ من موادِّها ويُعيدُ الحُكمَ رقماً
 * يُكتَبُ في الدفترِ. ولا يُعيدُ كتابةَ الوثيقةِ: مُجدوِلٌ يُعدِّلُ ملفّاً
 * متعقَّباً في كلِّ نبضةٍ يُنتِجُ فرقاً لا مُراجِعَ له.
 * @returns {Record<string, unknown>}
 */
function runReadinessJob() {
  const contract = loadReadinessContract({ configDir: CONFIG_DIR });
  const deferrals = loadDeferrals({ configDir: CONFIG_DIR });
  const facts = collectReadinessFacts({ root: ROOT, contract, deferrals });
  return {
    verdict: facts.judgement.verdict,
    percent: facts.project.percent,
    items: facts.items.length,
  };
}

/**
 * مُنفِّذُ تمرينِ التعافي: يُشغِّلُ المنفِّذَ القائمَ في **جذرٍ مؤقّتٍ** لا في
 * جذرِ المستودعِ. وتمرينٌ يُفرِّغُ جذرَ العملِ ليُثبِتَ التعافيَ يُوقِفُ الدولةَ
 * كي يُثبِتَ أنّها تعملُ.
 * @returns {Promise<Record<string, unknown>>}
 */
async function runRecoveryJob() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'scheduled-drill-'));
  try {
    const result = await new Promise((resolve) => {
      execFile(
        process.execPath,
        [path.join(ROOT, 'scripts', 'recovery-drill.mjs'), '--json', '--root', root],
        { cwd: ROOT, timeout: 600_000, maxBuffer: 32 * 1024 * 1024 },
        (error, stdout) => {
          const code =
            error === null
              ? 0
              : Number(/** @type {{ code?: number }} */ (error).code ?? EXIT_REFUSED);
          resolve({ code, stdout: String(stdout) });
        },
      );
    });
    const { code, stdout } = /** @type {{ code: number, stdout: string }} */ (result);
    /** @type {Record<string, unknown>} */
    let parsed = {};
    try {
      parsed = /** @type {Record<string, unknown>} */ (JSON.parse(stdout));
    } catch {
      parsed = {};
    }
    if (code !== 0) {
      throw new Error(
        `تمرينُ التعافي خرجَ برمزِ ${code}: ${String(parsed['verdict'] ?? 'بلا حكمٍ')}`,
      );
    }
    return {
      verdict: String(parsed['verdict'] ?? 'unknown'),
      totalMs: Number(parsed['totalMs'] ?? 0),
      files: Number(parsed['files'] ?? 0),
    };
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

/**
 * يبني التركيبَ كلَّه: مستودعاتٌ، ثمّ سلسلةُ الإنفاذِ من جذرِ التركيبِ، ثمّ
 * فاعلٌ مُسجَّلٌ في السجلِّ كي تُصدِّقَه بوابةُ الهويةِ، ثمّ مُجدوِلٌ موصولٌ.
 * @returns {Promise<{ scheduler: Scheduler, actor: { id: string, role: string, kind: string }, log: EventLog, source: string, close: () => Promise<void> }>}
 */
async function compose() {
  const url = process.env['DATABASE_URL'] ?? '';
  const log = new EventLog();
  /** @type {{ repositories: Record<string, unknown>, source: string, close: () => Promise<void> }} */
  const wiring =
    url === ''
      ? {
          repositories: /** @type {Record<string, unknown>} */ (
            /** @type {unknown} */ (createMemoryRepositories())
          ),
          source: 'memory',
          close: async () => {},
        }
      : (() => {
          const pool = createPool();
          return {
            repositories: /** @type {Record<string, unknown>} */ (
              /** @type {unknown} */ (createPostgresRepositories(pool))
            ),
            source: 'postgres',
            close: async () => {
              await pool.end();
            },
          };
        })();

  const chain = composeEnforcementChain({
    log: /** @type {never} */ (log),
    configDir: CONFIG_DIR,
    withLegislation: false,
    lawRepository: null,
    crown: null,
  });
  const policy = loadSchedulePolicy({ dir: CONFIG_DIR, bundle: chain.bundle });
  // الفاعلُ يُسجَّلُ في السجلِّ بقدراتِ ما تُعلِنُه الأعمالُ أنّها تفعلُ: قدرةٌ
  // تُمنَحُ ولا يُعلِنُها عملٌ سلطةٌ زائدةٌ تعملُ في غيابِ الناسِ.
  const capabilities = [
    ...new Set(policy.jobs.flatMap((job) => job.performs.map((action) => `action:${action}`))),
  ];
  const agent = await chain.registry.register({
    name: 'sovereign-scheduler',
    role: policy.jobs[0]?.actorRole ?? 'role:operator',
    capabilities,
    kind: 'service',
  });
  const actor = { id: agent.id, role: agent.role, kind: 'service' };
  const scheduler = new Scheduler({
    policy,
    ledger: new ScheduledRunLedger({
      repository: /** @type {never} */ (wiring.repositories['scheduledRuns']),
      log: /** @type {never} */ (log),
    }),
    authorizer: /** @type {never} */ (chain.enforcementPoint),
    log: /** @type {never} */ (log),
  });
  scheduler.register('job:readiness-report', () => runReadinessJob());
  scheduler.register('job:recovery-drill', () => runRecoveryJob());
  return { scheduler, actor, log, source: wiring.source, close: wiring.close };
}

/**
 * براهينُ الآليّةِ بساعةٍ مُمرَّرةٍ ومستودعاتِ ذاكرةٍ: كلُّ برهانٍ **رقمٌ مقيسٌ**
 * لا جملةٌ. والغرضُ أن يُثبِتَ المُشغِّلُ قبلَ الاعتمادِ أنّ الإطلاقَ يقعُ بلا
 * نداءٍ لكلِّ تشغيلٍ، وأنّ الشقَّ لا يُطلَقُ مرّتينِ، وأنّ الرفضَ يُسمّى.
 * @returns {Promise<{ ok: boolean, witnesses: Array<{ id: string, statement: string, measured: unknown }> }>}
 */
async function selfCheck() {
  const log = new EventLog();
  const repositories = /** @type {Record<string, unknown>} */ (
    /** @type {unknown} */ (createMemoryRepositories())
  );
  const chain = composeEnforcementChain({
    log: /** @type {never} */ (log),
    configDir: CONFIG_DIR,
    withLegislation: false,
    lawRepository: null,
    crown: null,
  });
  const policy = loadSchedulePolicy({ dir: CONFIG_DIR, bundle: chain.bundle });
  const ledger = new ScheduledRunLedger({
    repository: /** @type {never} */ (repositories['scheduledRuns']),
    log: /** @type {never} */ (log),
  });
  let now = Date.UTC(2026, 0, 1, 0, 0, 0);
  const scheduler = new Scheduler({
    policy,
    ledger,
    authorizer: /** @type {never} */ (chain.enforcementPoint),
    log: /** @type {never} */ (log),
    clock: () => now,
  });
  const operator = await chain.registry.register({
    name: 'scheduler-self-check',
    role: 'role:operator',
    capabilities: ['action:read-registry', 'action:read-audit'],
    kind: 'service',
  });
  const stranger = await chain.registry.register({
    name: 'scheduler-self-check-agent',
    role: 'role:agent',
    capabilities: ['action:read-registry'],
    kind: 'autonomous',
  });
  const actor = { id: operator.id, role: operator.role, kind: 'service' };

  const orphan = policy.jobs[0];
  if (orphan === undefined) {
    throw new Error('لا عملَ معلَنٌ في `config/schedule.yaml`؛ ولا يُفحَصُ مُجدوِلٌ بلا عملٍ.');
  }

  /** @type {Array<{ id: string, statement: string, measured: unknown }>} */
  const witnesses = [];
  let calls = 0;
  for (const job of policy.jobs) {
    scheduler.register(job.id, () => {
      calls += 1;
      return { proof: 'self-check', jobId: job.id };
    });
  }

  // W1: المؤقِّتُ يُطلِقُ بلا نداءِ إطلاقٍ لكلِّ تشغيلٍ — والقياسُ عددُ نداءاتِ
  // المُنفِّذينَ بعدَ نبضتينِ من الساعةِ المُمرَّرةِ.
  const first = await scheduler.tick({ actor });
  now += policy.tickMs;
  const second = await scheduler.tick({ actor });
  witnesses.push({
    id: 'W1',
    statement: 'نبضتانِ أطلقتا عملاً بلا نداءِ إطلاقٍ يدويٍّ لكلِّ عملٍ',
    measured: {
      handlerCalls: calls,
      firstDispatched: first.dispatched.length,
      firstRefused: first.refused,
      firstMissed: first.missed.length,
      secondRefused: second.refused,
    },
  });

  // W2: الواقعةُ في الدفترِ لا في السجلِّ وحدَه — الأطوارُ تُقرأُ من الدفترِ.
  const dispatchedJob = first.dispatched[0]?.jobId ?? '';
  const slot = first.dispatched[0]?.slotAt ?? 0;
  const phases = await ledger.phasesOfSlot({ jobId: dispatchedJob, slotAt: slot });
  witnesses.push({
    id: 'W2',
    statement: 'لكلِّ إطلاقٍ واقعةٌ في دفترِ الإطلاقاتِ بطورَي حجزٍ ونتيجةٍ',
    measured: { jobId: dispatchedJob, phases: [...phases].sort() },
  });

  // W3: الشقُّ نفسُه لا يُطلَقُ مرّتينِ — النبضةُ الثانيةُ في الشقِّ نفسِه لم
  // تُطلِقْ، ونداءُ الإطلاقِ المباشرُ يُرفَضُ باسمِ الحجزِ.
  let claimCode = 'NONE';
  try {
    await scheduler.dispatch({ job: policy.job(dispatchedJob), slotAt: slot, now, actor });
  } catch (error) {
    claimCode = /** @type {{ code?: string }} */ (error).code ?? 'UNKNOWN';
  }
  witnesses.push({
    id: 'W3',
    statement: 'الشقُّ المحجوزُ يُرفَضُ إطلاقُه ثانيةً برمزِه',
    measured: { code: claimCode, secondTickDispatched: second.dispatched.length },
  });

  // W4: عملٌ بلا مُنفِّذٍ يُرفَضُ **قبلَ** الحجزِ — فالدفترُ يبقى خالياً من شقِّه.
  const orphanScheduler = new Scheduler({
    policy,
    ledger,
    authorizer: /** @type {never} */ (chain.enforcementPoint),
    log: /** @type {never} */ (log),
    clock: () => now + orphan.everyMs * 3,
  });
  let handlerCode = 'NONE';
  const orphanSlot = orphan.slotAt(now + orphan.everyMs * 3);
  try {
    await orphanScheduler.dispatch({ job: orphan, slotAt: orphanSlot, now, actor });
  } catch (error) {
    handlerCode = /** @type {{ code?: string }} */ (error).code ?? 'UNKNOWN';
  }
  const orphanPhases = await ledger.phasesOfSlot({ jobId: orphan.id, slotAt: orphanSlot });
  witnesses.push({
    id: 'W4',
    statement: 'عملٌ بلا مُنفِّذٍ يُرفَضُ قبلَ الحجزِ فلا يبقى شقٌّ محجوزٌ بلا عملٍ',
    measured: { code: handlerCode, phasesAfter: [...orphanPhases] },
  });

  // W5: فاعلٌ لا تمنحُه السياسةُ الإطلاقَ يُرفَضُ — والقرارُ من نقطةِ التفويضِ.
  let deniedCode = 'NONE';
  try {
    await scheduler.dispatch({
      job: policy.job(dispatchedJob),
      slotAt: orphan.slotAt(now + orphan.everyMs * 7),
      now,
      actor: { id: stranger.id, role: stranger.role, kind: 'agent' },
    });
  } catch (error) {
    deniedCode = /** @type {{ code?: string }} */ (error).code ?? 'UNKNOWN';
  }
  witnesses.push({
    id: 'W5',
    statement: 'فاعلٌ بدورٍ لا تمنحُه السياسةُ الإطلاقَ يُرفَضُ بقرارٍ لا بصمتٍ',
    measured: { code: deniedCode },
  });

  // W6: مُجدوِلٌ بلا نقطةِ تفويضٍ لا يُطلِقُ شيئاً — فشلٌ مُغلَقٌ باسمِه.
  let unauthorizedCode = 'NONE';
  try {
    await new Scheduler({ policy, ledger, clock: () => now }).dispatch({
      job: policy.job(dispatchedJob),
      slotAt: orphan.slotAt(now + orphan.everyMs * 11),
      now,
      actor,
    });
  } catch (error) {
    unauthorizedCode = /** @type {{ code?: string }} */ (error).code ?? 'UNKNOWN';
  }
  witnesses.push({
    id: 'W6',
    statement: 'مُجدوِلٌ بلا نقطةِ تفويضٍ يرفضُ الإطلاقَ من أصلِه',
    measured: { code: unauthorizedCode },
  });

  // W7: سلسلةُ الدفترِ متّصلةٌ — بصمةٌ تُحسَبُ على ما سبقَ، والتحقّقُ يقرأُ كلَّ صفٍّ.
  const verified = await ledger.verify();
  witnesses.push({
    id: 'W7',
    statement: 'سلسلةُ دفترِ الإطلاقاتِ متّصلةٌ ومُتحقَّقٌ منها صفّاً صفّاً',
    measured: verified,
  });

  const ok =
    calls >= 1 &&
    first.dispatched.length >= 1 &&
    [...phases].includes('dispatched') &&
    [...phases].includes('completed') &&
    claimCode === SCHEDULER_ERRORS.SLOT_ALREADY_CLAIMED &&
    second.dispatched.length === 0 &&
    handlerCode === SCHEDULER_ERRORS.HANDLER_MISSING &&
    orphanPhases.size === 0 &&
    deniedCode === SCHEDULER_ERRORS.NOT_AUTHORIZED &&
    unauthorizedCode === SCHEDULER_ERRORS.AUTHORIZER_REQUIRED &&
    verified.ok === true &&
    verified.rows >= 2;
  return { ok, witnesses };
}

/**
 * @returns {Promise<number>}
 */
async function main() {
  const options = parseArguments(process.argv.slice(2));

  if (options.mode === 'self-check') {
    const { ok, witnesses } = await selfCheck();
    if (options.json) {
      process.stdout.write(`${JSON.stringify({ ok, witnesses }, null, 2)}\n`);
    } else {
      process.stdout.write('فحصُ المُجدوِلِ الذاتيُّ — براهينُ مقيسةٌ لا أوصافٌ:\n');
      for (const witness of witnesses) {
        process.stdout.write(
          `  ${witness.id}: ${witness.statement}\n      ${JSON.stringify(witness.measured)}\n`,
        );
      }
      process.stdout.write(
        ok
          ? '✅ المُجدوِلُ يُطلِقُ بلا نداءٍ لكلِّ تشغيلٍ، ويكتبُ واقعةً، ويرفضُ الشقَّ المحجوزَ والفاعلَ غيرَ المُفوَّضِ.\n'
          : '⛔ برهانٌ واحدٌ على الأقلِّ لم يقعْ كما يجبُ؛ ولا يُعتمَدُ مُجدوِلٌ بلا براهينِه.\n',
      );
    }
    return ok ? 0 : EXIT_REFUSED;
  }

  /** @type {Awaited<ReturnType<typeof compose>>} */
  let wiring;
  try {
    wiring = await compose();
  } catch (error) {
    process.stderr.write(
      `⛔ لم يقمِ التركيبُ: ${error instanceof Error ? error.message : error}\n`,
    );
    return EXIT_UNCOMPOSED;
  }

  try {
    if (options.mode === 'once') {
      const result = await wiring.scheduler.tick({ actor: wiring.actor });
      const failed = result.dispatched.filter((entry) => entry.outcome !== 'completed');
      if (options.json) {
        process.stdout.write(`${JSON.stringify({ source: wiring.source, ...result }, null, 2)}\n`);
      } else {
        process.stdout.write(
          `نبضةٌ واحدةٌ (${wiring.source}) في ${result.now}: أُطلِقَ ${result.dispatched.length}، وفاتَ ${result.missed.length}، ورُفِضَ ${result.refused.length}، وأُجِّلَ ${result.skipped.length}.\n`,
        );
      }
      return result.refused.length > 0 || failed.length > 0 ? EXIT_REFUSED : 0;
    }

    process.stdout.write(
      `المُجدوِلُ يعملُ (${wiring.source}) كلَّ ${wiring.scheduler.policy.tick.everyMinutes} دقيقةً بفاعلِ ${wiring.actor.id}؛ والإيقافُ بإشارةٍ.\n`,
    );
    const stop = wiring.scheduler.start({
      actor: wiring.actor,
      onTick: (result) => {
        process.stdout.write(`${JSON.stringify(result)}\n`);
      },
    });
    // مؤقِّتُ المُجدوِلِ `unref` كي لا يمنعَ عمليّةً من الانتهاءِ، فلو لم يُثبَّتْ
    // هنا مُقيمٌ صريحٌ لخرجتِ العمليّةُ فوراً وقُرِئَ الخروجُ الصامتُ «يعملُ».
    const resident = setInterval(() => {}, 1 << 30);
    await new Promise((resolve) => {
      const finish = () => {
        stop();
        clearInterval(resident);
        resolve(undefined);
      };
      process.once('SIGINT', finish);
      process.once('SIGTERM', finish);
    });
    return 0;
  } finally {
    await wiring.close();
  }
}

const exitCode = await main();
process.exitCode = exitCode;
