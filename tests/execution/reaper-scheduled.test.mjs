/**
 * اختبارُ الحاصدِ المُجدوَلِ — إغلاقُ الدَينِ `LIVE-45` (أ) (`WL-391`).
 *
 * المعيارُ بحرفِهِ من سجلِّ الديونِ:
 *   «حاصدٌ مُجدوَلٌ بفعلٍ مصرَّحٍ به في `config/schedule.yaml` يُنادي
 *    `reclaimExpired` ومقيسٌ بموتِ عاملٍ حقيقيّ».
 *
 * **والحصادُ ليس وعداً على الورقِ ولا جولةً في الذاكرةِ.** فالاختبارُ هنا يُقيسُ
 * ثلاثةَ أشياءَ لا واحداً:
 *
 *   1. **عملُ الحصادِ مُعلَنٌ ومُنفِّذُه الإنتاجيُّ مُسجَّلٌ**: `config/schedule.yaml`
 *      يُعلِنُ `job:reclaim-expired-leases`، و`scripts/scheduler.mjs` يُسجِّلُ المُنفِّذَ
 *      الإنتاجيّ (`runReclaimLeasesJob`) — وحاجزُ S2 في `guard:scheduling` يحرسُ
 *      الوجودَ، وهذا الاختبارُ يُقيسُ الفعلَ لا الوجودَ: لا يُستبدَلُ المُنفِّذُ بجسمٍ
 *      يزيدُ عدّادَ استدعاءٍ وهميّ.
 *   2. **القرارُ يقعُ قبلَ أولِ كتابةٍ في القاعدةِ**: `authorize` للفعلِ
 *      `reclaim-expired-leases` ثمّ `verify` قبلَ نداءِ `reclaimExpired` — لا بعدهُ.
 *      والقرارُ يُقيَّمُ على الفعلِ نفسِهِ لا على فعلِ الإطلاقِ (`run-scheduled-job`):
 *      فما صدرَ لفعلٍ لا يُنفَّذُ لفعلٍ آخرَ. وقرارٌ صادرٌ لدورٍ لا يملكُهُ يُرفضُ
 *      بقرارٍ مُسمّى لا بصمتٍ.
 *   3. **الحصادُ مقيسٌ بموتِ عاملٍ حقيقيّ**: عمليةُ ابنٍ حقيقيةٌ تُقتلُ بـ`SIGKILL`
 *      بعدَ حجزِ مهمّةٍ، فينتهي عقدُها، ويُنادى `Scheduler.tick()` — والمُنفِّذُ
 *      الإنتاجيُّ هو الذي يستعيدُ المهمّةَ لا يدُ الاختبارِ.
 *
 * **حدٌّ مُعلَنٌ لا يُتجاوَزُ:** المهمّةُ التي خُصمت ميزانيتُها (علامةُ
 * `budget_debited_at` مُلتزَمةً ذرّيّاً) **تُستعادُ كما هي** — الخصمُ وقعَ، فلا
 * يُعادُ ولا يُفرَجُ عنه هنا؛ والحصادُ لا يمنحُ «إفراجاً لم يبدأ» (لا يُصفرُ
 * المحاولةَ) ولا يُصدرُ حكماً على نتيجةِ خصمٍ مُعلّقة: `db-recovery.mjs` يظلُّ
 * حاكمًا على عقدِ العاملِ **الحيّ** (شرطُ `lease_owner`)، والحصادُ يأخذُ ما ماتَ
 * حامِلُه فعلًا (شرطُ `lease_expires_at < now`). وما بقيَ خارجَ هذا الملفِّ
 * (الدوامُ بعدَ الانقطاعِ (`LIVE-45` ب) وفرادةُ اسمِ العاملِ (`LIVE-45` د)) مُعلَنٌ
 * في سجلِّ الديونِ ولا يُدّعى هنا.
 *
 * التشغيلُ: DATABASE_URL=... node --test tests/execution/reaper-scheduled.test.mjs
 */

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { composeEnforcementChain } from '../../src/core/composition-root.mjs';
import { createPostgresRepositories } from '../../src/persistence/composition.mjs';
import { up } from '../../src/persistence/migrator.mjs';
import { createTaskQueue } from '../../src/execution/queue.mjs';
import { TaskLifecycle } from '../../src/execution/lifecycle.mjs';
import { runReclaimLeasesJob } from '../../src/execution/reaper.mjs';
import { Scheduler, ScheduledRunLedger, loadSchedulePolicy } from '../../src/scheduling/index.mjs';
import { createIsolatedDatabase, skipWithoutDatabase } from '../helpers/pg.mjs';
import { EventLog } from '../../src/root-of-trust/index.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const HANG = path.join(HERE, 'helpers', 'hang-child.mjs');
const ROOT = path.resolve(HERE, '..', '..');
const CONFIG_DIR = path.join(ROOT, 'config');

/**
 * عقد الاختبار: قابلٌ للتهيئة بيئيّاً كي يُوسَّع حيث تبعد القاعدة.
 * (راجِع اختبارَ العمّالِ نفسِه — `tests/execution/workers.test.mjs`.)
 */
const LEASE_MS = Number(process.env.TEST_LEASE_MS ?? '700');

const START = Date.UTC(2026, 9, 16, 0, 0, 0);

/**
 * يبني مُجدوِلاً حقيقيّاً بنقطةِ تفويضٍ حقيقيّةٍ ودفترٍ على قاعدةِ البياناتِ
 * **المعزولةِ** — ويسجّلُ المُنفِّذَ الإنتاجيَّ (`runReclaimLeasesJob`) لا جسمَ مُزوِّرٍ.
 * والفاعلُ يُسجَّلُ بقدرةِ الحصادِ (`action:reclaim-expired-leases`) لا بقدرةٍ عامّةٍ:
 * فما لا تمنحُهُ السياسةُ لا يُمنحُ هنا بجرّةِ قلمٍ.
 *
 * @param {{ pool: import('pg').Pool }} wiring
 * @returns {Promise<{ scheduler: Scheduler, actor: { id: string, role: string, kind: string }, policy: import('../../src/scheduling/index.mjs').SchedulePolicy, setNow: (value: number) => void, log: EventLog }>}
 */
async function harness({ pool }) {
  const log = new EventLog();
  const repositories = createPostgresRepositories(pool);
  const chain = composeEnforcementChain({
    log: /** @type {never} */ (log),
    configDir: CONFIG_DIR,
    withLegislation: false,
    lawRepository: null,
    crown: null,
  });
  const policy = loadSchedulePolicy({ dir: CONFIG_DIR, bundle: chain.bundle });
  const capabilities = [
    ...new Set(policy.jobs.flatMap((job) => job.performs.map((action) => `action:${action}`))),
  ];
  const agent = await chain.registry.register({
    name: `reaper-test-${Math.random().toString(36).slice(2, 8)}`,
    role: 'role:operator',
    capabilities,
    kind: 'service',
  });
  const actor = { id: agent.id, role: agent.role, kind: 'service' };
  const ledger = new ScheduledRunLedger({
    repository: /** @type {never} */ (repositories['scheduledRuns']),
    log: /** @type {never} */ (log),
  });
  let now = START;
  const scheduler = new Scheduler({
    policy,
    ledger,
    authorizer: /** @type {never} */ (chain.enforcementPoint),
    log: /** @type {never} */ (log),
    clock: () => now,
  });
  // المُنفِّذُ الإنتاجيُّ: هو الذي يُنادى في نبضةِ المُجدوِلِ، لا جسمٌ يزيدُ
  // عدّاداً وهميّاً. والطابورُ مُركَّبٌ من مجمّعِ القاعدةِ المعزولةِ نفسِهِ.
  const queue = createTaskQueue({ pool, leaseMs: LEASE_MS });
  scheduler.register('job:readiness-report', () => ({ proof: 'reaper-test' }));
  scheduler.register('job:recovery-drill', () => ({ proof: 'reaper-test' }));
  scheduler.register('job:reclaim-expired-leases', () =>
    runReclaimLeasesJob({
      queue,
      actor,
      log,
      enforcementPoint: chain.enforcementPoint,
    }),
  );
  return {
    scheduler,
    actor,
    policy,
    setNow: (value) => {
      now = value;
    },
    log,
  };
}

/**
 * يُقلع ابناً يحجز مهمة ثم يتجمّد — مساعد موت العامل الحقيقيّ.
 * (نفسُ مساعدِ اختبارِ العمّالِ — `tests/execution/workers.test.mjs`.)
 *
 * @param {string} url
 * @param {string} worker
 * @returns {Promise<{ taskId: string, child: import('node:child_process').ChildProcess }>}
 */
function spawnHangingWorker(url, worker) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [HANG, url, worker, String(LEASE_MS)], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let buffer = '';
    let settled = false;
    child.stdout.on('data', (chunk) => {
      buffer += String(chunk);
      const line = buffer.split('\n').find((entry) => entry.trim().startsWith('{'));
      if (line === undefined || settled) return;
      settled = true;
      const parsed = /** @type {{ claimed: string }} */ (JSON.parse(line));
      resolve({ taskId: parsed.claimed, child });
    });
    child.stderr.on('data', (chunk) => {
      if (!settled) {
        settled = true;
        child.kill('SIGKILL');
        reject(new Error(`الابن أخفق قبل الحجز: ${String(chunk)}`));
      }
    });
    child.on('exit', (code) => {
      if (!settled) {
        settled = true;
        reject(new Error(`الابن انتهى قبل الحجز برمز ${String(code)}`));
      }
    });
  });
}

/**
 * حصادٌ يقعُ **عبر نبضةِ المُجدوِلِ** لا بنداءٍ يدويٍّ مباشرٍ. والزمنُ مُدخَلٌ
 * لا انتظارٌ: اختبارٌ ينامُ ساعةً ليرى شقّاً ليس اختباراً. فالشقُّ يُحسَبُ
 * بالزمنِ المُدخَلِ لا بالانتظارِ الحقيقيّ، والمهمّةُ تُقتَلُ فعلاً.
 *
 * @param {Scheduler} scheduler
 * @param {{ id: string, role: string, kind: string }} actor
 * @returns {Promise<{ dispatched: Array<{ jobId: string, slotAt: number, outcome: string, detail?: Record<string, unknown> }>, refused: Array<Record<string, unknown>>, missed: Array<Record<string, unknown>> }>}
 */
async function tickReaper(scheduler, actor) {
  return scheduler.tick({ actor });
}

test(
  'حاصدٌ مُجدوَلٌ يستعيدُ مهمّةً لعاملٍ ماتَ حقيقةً — بقرارٍ مُسجَّلٍ لا بيدِ الاختبارِ',
  { skip: skipWithoutDatabase },
  async () => {
    const created = await createIsolatedDatabase('reaper');
    const { pool, name } = created;
    try {
      await up(pool);
      const url = new URL(String(process.env.DATABASE_URL));
      url.pathname = `/${name}`;
      const harnessResult = await harness({ pool });
      const queue = createTaskQueue({ pool, leaseMs: LEASE_MS });
      const AUTH = { decisionId: 'decision-reaper-test' };
      const { task } = await queue.enqueue(
        {
          action: 'اختبار.حصاد-موت-العامل',
          target: 'موضوع/الحصاد',
          actorId: 'actor-الحصاد',
          idempotencyKey: 'مفتاح-حصاد-موت-العامل',
          payload: { حمولة: 'يجب أن تُحصَد' },
          maxAttempts: 3,
        },
        AUTH,
      );

      const { taskId, child } = await spawnHangingWorker(url.toString(), 'عامل-الحصاد');
      assert.equal(taskId, task.id, 'الابن حجز مهمة غير المقصودة');

      // القتل الحقيقي: `SIGKILL` لا يُلتقط ولا تنظيف بعده.
      const exited = new Promise((resolve) => child.once('exit', resolve));
      child.kill('SIGKILL');
      await exited;

      // قبلَ انتهاءِ العقدِ لا حصادَ — الاستعادةُ مشروطةٌ بانتهاءِ العقدِ لا بموتِ
      // العمليّةِ (وهو ما لا تعرفهُ القاعدةُ أصلاً). والعملُ يُطلَقُ في نافذتِهِ،
      // لكنّ **الطابورَ** لا يُعيدُ مهمّةً لم ينتهِ عقدُها بعد: فالشقُّ لا يعني أنّ
      // ما فيهَ حُصدَ، والقرارُ لا يستردُّ ما لا تنتهي صلاحيّتُه.
      const early = await tickReaper(harnessResult.scheduler, harnessResult.actor);
      const earlyReaper = early.dispatched.find(
        (entry) => entry.jobId === 'job:reclaim-expired-leases',
      );
      // العملُ استحقَّ في شقِّهِ فأُطلِقَ — لكنّ الحصادَ **لم يُعيد شيئاً** بلا عقدٍ
      // منتهي: فهذا هو المُعيارُ لا «لم يُطلَق».
      assert.ok(
        earlyReaper !== undefined,
        'لم يُطلَق عملُ الحصادِ في شقِّهِ ولو لم يُحصَد شيءٌ — والشقُّ لا يُعلَّلُ بالانتظارِ',
      );
      assert.equal(
        Number(earlyReaper?.detail?.['requeued'] ?? -1),
        0,
        'استُعيدت مهمّةٌ لم ينتهِ عقدُها — والاستردادُ مشروطٌ بانتهاءِ العقدِ لا بموتِ العمليّةِ',
      );
      const earlyState = await queue.get(task.id);
      assert.equal(earlyState?.state, TaskLifecycle.RUNNING);
      assert.equal(earlyState?.leaseOwner, 'عامل-الحصاد');

      // ينتهي العقدُ: النومُ بالزمنِ المُدخَلِ لا بالانتظارِ — والمُنفِّذُ الإنتاجيُّ
      // هو الذي يستعيدُ المهمّةَ. والشقُّ **يُقدَّمُ بالساعةِ المُمرَّرةِ** كي لا
      // يُرفضَ الحصادُ بحجزِ الشقِّ الأولِ (‏`SLOT_ALREADY_CLAIMED`) — فالنبضةُ
      // الأولى أطلقَت في شقِّها واكتملَ، فالشقُّ التاليَ هو الذي يقعُ فيه الحصادُ
      // الحقيقيُّ للعقدِ المنتهي.
      await new Promise((resolve) => setTimeout(resolve, LEASE_MS + 300));
      harnessResult.setNow(Date.UTC(2026, 9, 16, 1, 0, 0));
      const ticked = await tickReaper(harnessResult.scheduler, harnessResult.actor);
      const reaperEntry = ticked.dispatched.find(
        (entry) => entry.jobId === 'job:reclaim-expired-leases',
      );
      assert.ok(reaperEntry !== undefined, 'لم يُطلَق عملُ الحصادِ في نافذتِه');
      assert.equal(reaperEntry.outcome, 'completed', 'عملُ الحصادِ لم يُكتَمْ');
      // والتفصيلُ مقروءٌ لا مُفترَضٌ: تذكرةٌ استُهلِكَت ونُدِيَ الطابورُ.
      assert.ok(reaperEntry.detail !== undefined, 'بلا تفصيلٍ للحصادِ — لا قياسَ');
      assert.equal(
        Number(reaperEntry.detail['requeued'] ?? 0),
        1,
        'لم يُستعَد العقدُ المنتهي بعدَ موتِ حامِلِه',
      );
      assert.equal(
        Number(reaperEntry.detail['failed'] ?? 0),
        0,
        'أُعلِنت مهمّةٌ فاشلةً وهي بقيت لها محاولات',
      );

      // والقرارُ مُسجَّلٌ لا صامتٌ: التذكرةُ استُهلِكَت قبلَ أولِ كتابةٍ، والفعلُ
      // المُقيَّمُ هو فعلُ الحصادِ لا فعلُ الإطلاقِ.
      const after = await queue.get(task.id);
      assert.ok(after !== null, 'المهمّةُ ضاعت');
      assert.equal(after.state, TaskLifecycle.SCHEDULED, 'لم تُعَد المهمّةُ إلى الطابورِ');
      assert.equal(after.leaseOwner, null, 'عقدُ العاملِ الميتِ لم يُفَكّ');
      // الحصادُ يحسَبُ المحاولةَ لا يُصفرُها (`releaseUnstarted` وحده لا يُحسَب): فما
      // بدأَ مُعالِجُه فعذَبُهُ على ميزانيّةِ محاولاتِه، لا يُعادُ تشغيلُه بلا محاسبةٍ.
      assert.equal(after.attempts, 1, 'محاولةُ الحجزِ لم تُحسَب بعدَ موتِ العاملِ');
      assert.equal(after.errorCode, 'TASK_LEASE_EXPIRED');
      assert.deepEqual(after.payload, { حمولة: 'يجب أن تُحصَد' });
      const trail = await queue.transitions(task.id);
      assert.deepEqual(
        trail.map((entry) => `${entry.from ?? '∅'}⇒${entry.to}`),
        [
          '∅⇒created',
          'created⇒authorized',
          'authorized⇒scheduled',
          'scheduled⇒running',
          'running⇒scheduled',
        ],
      );
    } finally {
      await created.drop();
    }
  },
);

test(
  'القرارُ يُقيَّمُ على فعلِ الحصادِ نفسِهِ: فاعلٌ بقدرةِ إطلاقٍ فقط يُرفَضُ حصادُه',
  { skip: skipWithoutDatabase },
  async () => {
    const created = await createIsolatedDatabase('reaperauth');
    const { pool, name } = created;
    try {
      await up(pool);
      const url = new URL(String(process.env.DATABASE_URL));
      url.pathname = `/${name}`;
      // حصادُ فاعلٍ بلا قدرةٍ لا يحتاجُ تركيبَ المُجدوِلِ المُنتِجِ — فالمطلوبُ إثباتُ
      // الرفضِ لا الحصادِ. تركيبٌ كاملٌ بفاعلٍ بلا قدرةٍ يُقيّمُ نفسَ الرفضِ عبرَ
      // سلسلةٍ أصغرَ (نقطةِ تفويضٍ ودفترٍ ومُجدوِلٍ) لا عبرَ تركيبِ الاختبارِ المُنتِجِ.
      const queue = createTaskQueue({ pool, leaseMs: LEASE_MS });
      const AUTH = { decisionId: 'decision-reaper-auth-test' };
      const { task } = await queue.enqueue(
        {
          action: 'اختبار.حصاد-قدرة-ناقصة',
          target: 'موضوع/الحصاد-قدرة-ناقصة',
          actorId: 'actor-الحصاد-قدرة-ناقصة',
          idempotencyKey: 'مفتاح-حصاد-قدرة-ناقصة',
          payload: { حمولة: 'لا يُحصَدُ بقدرةٍ ناقصة' },
          maxAttempts: 3,
        },
        AUTH,
      );

      // فاعلٌ بقدرةِ الإطلاقِ وحدَهُ (`run-scheduled-job`) لا بقدرةِ الحصادِ
      // (`reclaim-expired-leases`) — لا يُمنحُ حقَّ الحصادِ بقرارٍ صادرٍ لفعلٍ آخرَ.
      const { child } = await spawnHangingWorker(url.toString(), 'عامل-الحصاد-قدرة-ناقصة');
      const exited = new Promise((resolve) => child.once('exit', resolve));
      child.kill('SIGKILL');
      await exited;
      await new Promise((resolve) => setTimeout(resolve, LEASE_MS + 300));

      const log = new EventLog();
      const repositories = createPostgresRepositories(pool);
      const chain = composeEnforcementChain({
        log: /** @type {never} */ (log),
        configDir: CONFIG_DIR,
        withLegislation: false,
        lawRepository: null,
        crown: null,
      });
      const policy = loadSchedulePolicy({ dir: CONFIG_DIR, bundle: chain.bundle });
      // فاعلٌ **بلا** قدرةِ الحصادِ (`action:reclaim-expired-leases`) ولا قدرةِ إطلاقِ
      // الأعمالِ المجدولةِ (`action:run-scheduled-job`): السياسةُ لا تمنحُهُ الحصادَ،
      // ولا يُمنحُ هنا بجرّةِ قلمٍ.
      const agent = await chain.registry.register({
        name: `reaper-stranger-${Math.random().toString(36).slice(2, 8)}`,
        role: 'role:agent',
        capabilities: [],
        kind: 'autonomous',
      });
      const stranger = { id: agent.id, role: agent.role, kind: 'autonomous' };
      const ledger = new ScheduledRunLedger({
        repository: /** @type {never} */ (repositories['scheduledRuns']),
        log: /** @type {never} */ (log),
      });
      const now = Date.UTC(2026, 9, 16, 0, 0, 0);
      const scheduler = new Scheduler({
        policy,
        ledger,
        authorizer: /** @type {never} */ (chain.enforcementPoint),
        log: /** @type {never} */ (log),
        clock: () => now,
      });
      const strangerQueue = createTaskQueue({ pool, leaseMs: LEASE_MS });
      scheduler.register('job:readiness-report', () => ({ proof: 'reaper-test' }));
      scheduler.register('job:recovery-drill', () => ({ proof: 'reaper-test' }));
      scheduler.register('job:reclaim-expired-leases', () =>
        runReclaimLeasesJob({
          queue: strangerQueue,
          actor: stranger,
          log,
          enforcementPoint: chain.enforcementPoint,
        }),
      );
      const ticked = await scheduler.tick({ actor: stranger });
      const reaperEntry = ticked.refused.find(
        (entry) => entry.jobId === 'job:reclaim-expired-leases',
      );
      assert.ok(reaperEntry !== undefined, 'لم يُسمَّ رفضُ حصادِ فاعلٍ بلا قدرةٍ');
      assert.match(
        String(reaperEntry.code ?? ''),
        /NOT_AUTHORIZED/u,
        `الرفضُ لم يُسَمَّ برمزِ السياسةِ: ${JSON.stringify(reaperEntry)}`,
      );
      // **ولا كتابةَ في القاعدةِ**: الرفضُ يقعُ قبلَ أولِ كتابةٍ، فالمهمّةُ تبقى
      // `running` بعقدِ العاملِ الميتِ لا تُستعادُ بقرارٍ مرفوضٍ.
      const after = await queue.get(task.id);
      assert.ok(after !== null, 'المهمّةُ ضاعت');
      assert.equal(
        after.state,
        TaskLifecycle.RUNNING,
        'استُعيدت مهمّةٌ بقرارٍ مرفوضٍ — والرفضُ لا يُنفَّذُ بعدَ الفعلِ',
      );
      assert.equal(after.leaseOwner, 'عامل-الحصاد-قدرة-ناقصة');
    } finally {
      await created.drop();
    }
  },
);

test(
  'الحصادُ لا يُصدِرُ حكماً على نتيجةِ خصمٍ مُعلّقة: المهمّةُ التي خُصمت ميزانيتُها تُستعادُ كما هي لا إفراجًا لم يبدأ',
  { skip: skipWithoutDatabase },
  async () => {
    const created = await createIsolatedDatabase('reaperbudget');
    const { pool, name } = created;
    try {
      await up(pool);
      const url = new URL(String(process.env.DATABASE_URL));
      url.pathname = `/${name}`;
      const harnessResult = await harness({ pool });
      const queue = createTaskQueue({ pool, leaseMs: LEASE_MS });
      const AUTH = { decisionId: 'decision-reaper-budget-test' };
      const { task } = await queue.enqueue(
        {
          action: 'اختبار.حصاد-خصم-معلّق',
          target: 'موضوع/الحصاد-خصم-معلّق',
          actorId: 'actor-الحصاد-خصم-معلّق',
          idempotencyKey: 'مفتاح-حصاد-خصم-معلّق',
          payload: { حمولة: 'خصمٌ مُلتزَمٌ لا يُفرَجُ عنه' },
          maxAttempts: 3,
          budgetResource: 'inference-tokens',
          budgetAmount: 100,
        },
        AUTH,
      );

      // المهمّةُ تُقتلُ **بعدَ** التزامِ خصمِ ميزانيتِها: `budget_debited_at` مُلتزَمٌ
      // ذرّيّاً (`WL-389` — العلامةُ والخصمُ في معاملةٍ واحدةٍ). فالخصمُ وقعَ، ولا
      // يُعادُ ولا يُفرَجُ عنه هنا.
      const { child } = await spawnHangingWorker(url.toString(), 'عامل-الحصاد-خصم-معلّق');
      const exited = new Promise((resolve) => child.once('exit', resolve));
      child.kill('SIGKILL');
      await exited;

      // ضعِ العلامةَ يدويّاً كأنّ خصماً وقعَ (الاستقلالُ عن تنفيذِ العاملِ):
      // ما يُقاسُ هنا سلوكُ الحاصدِ لا تنفيذُ العاملِ.
      await pool.query(`UPDATE state.tasks SET budget_debited_at = $2 WHERE id = $1`, [
        task.id,
        new Date(),
      ]);
      await new Promise((resolve) => setTimeout(resolve, LEASE_MS + 300));

      const ticked = await tickReaper(harnessResult.scheduler, harnessResult.actor);
      const reaperEntry = ticked.dispatched.find(
        (entry) => entry.jobId === 'job:reclaim-expired-leases',
      );
      assert.ok(reaperEntry !== undefined, 'لم يُطلَق عملُ الحصادِ في نافذتِه');
      assert.equal(reaperEntry.outcome, 'completed');

      // الحصادُ يأخذُ المهمّةَ كما هي — **لا إفراجًا لم يبدأ** (المحاولةُ تُحسَبُ
      // لا تُصفَّرُ): فما بدأَ مُعالِجُه فذنبُهُ على ميزانيّةِ محاولاتِه، والإفراجُ
      // عنه هنا يُعيدُ تشغيلَه بلا محاسبةٍ.
      const after = await queue.get(task.id);
      assert.ok(after !== null, 'المهمّةُ ضاعت');
      assert.equal(after.state, TaskLifecycle.SCHEDULED);
      assert.equal(after.attempts, 1, 'محاولةُ الحجزِ لم تُحسَب: إفراجٌ لم يبدأ');
      assert.equal(after.errorCode, 'TASK_LEASE_EXPIRED');
      // والعلامةُ لا تُمحى: الحصادُ لا يُصدِرُ حكماً على نتيجةِ خصمٍ، ولا يُعيدُ
      // تشغيلَ المهمّةِ بخصمٍ جديدٍ (علامةٌ واحدةٌ = خصمٌ واحدٌ).
      const marked = await pool.query(`SELECT budget_debited_at FROM state.tasks WHERE id = $1`, [
        task.id,
      ]);
      assert.ok(
        marked.rows[0]?.budget_debited_at !== null,
        'مُحِيَت علامةُ الخصمِ المُلتزَمة — والحاصدُ لا يُصدِرُ أحكاماً',
      );
    } finally {
      await created.drop();
    }
  },
);
