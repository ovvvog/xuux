// شواهدُ المُجدوِلِ السياديِّ — إغلاقُ الدَينِ `D-4` (‏`WL-191`).
//
// **معيارُ الإغلاقِ بحرفِه (‏`§4.2`):** «مُجدوِلٌ يُطلِقُ التقاريرَ والتمارينَ بلا
// نداءٍ يدويٍّ، مقيسٌ بواقعةٍ في دفترٍ». فالمقيسُ هنا أربعةُ أشياءَ لا واحدٌ:
//
//   1. أنّ **المؤقِّتَ** يُطلِقُ العملَ بلا نداءِ إطلاقٍ لكلِّ تشغيلٍ — يُقاسُ بعددِ
//      نداءاتِ المُنفِّذِ بعدَ تشغيلِ المؤقِّتِ وحدَه.
//   2. أنّ لكلِّ إطلاقٍ **واقعةً في دفترٍ** بطورَي حجزٍ ونتيجةٍ وسلسلةٍ متّصلةٍ.
//   3. أنّ الموعدَ يُقرأُ **من الدفترِ**: مُجدوِلٌ جديدٌ على الدفترِ نفسِه لا يُعيدُ
//      عملاً وقعَ — وهذا هو الفرقُ بين جدولةٍ في الذاكرةِ وجدولةٍ في دولةٍ.
//   4. أنّ الرفضَ **مُسمّىً**: شقٌّ محجوزٌ، ومُنفِّذٌ غائبٌ، وفاعلٌ غيرُ مُفوَّضٍ،
//      ونقطةُ تفويضٍ غائبةٌ، وفعلٌ فوقَ العتبةِ السياديّةِ في القيودِ.
//
// وبوابةُ الهويةِ تُمرَّرُ حقيقيّةً من جذرِ التركيبِ: نقطةُ تفويضٍ بلا بوابةٍ تقبلُ
// الفاعلَ كما وصفَ نفسَه، واختبارٌ يُبنى على ذلك يُثبِتُ أنّ الكودَ ينادي مزيّفاً
// لا أنّه محكومٌ.

import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { composeEnforcementChain } from '../../src/core/composition-root.mjs';
import { loadPolicyBundle } from '../../src/policy/loader.mjs';
import { createMemoryRepositories } from '../../src/persistence/composition.mjs';
import { EventLog } from '../../src/root-of-trust/index.mjs';
import {
  SCHEDULER_DISPATCH_ACTION,
  SCHEDULER_ERRORS,
  ScheduledRunLedger,
  Scheduler,
  loadSchedulePolicy,
} from '../../src/scheduling/index.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CONFIG_DIR = join(ROOT, 'config');
const START = Date.UTC(2026, 2, 1, 0, 0, 0);

/**
 * تركيبٌ كاملٌ بمستودعاتِ ذاكرةٍ وساعةٍ مُمرَّرةٍ: الساعةُ تُمرَّرُ كي يكونَ
 * الزمنُ مُدخَلاً مقيساً لا حالةَ جهازٍ — واختبارٌ يقرأُ `Date.now()` يمرُّ أو
 * يسقطُ بحسبِ لحظةِ تشغيلِه.
 * @param {{ dir?: string }} [options]
 * @returns {Promise<{ scheduler: Scheduler, ledger: ScheduledRunLedger, log: EventLog, operator: { id: string, role: string }, stranger: { id: string, role: string }, policy: import('../../src/scheduling/index.mjs').SchedulePolicy, tick: (now: number) => ReturnType<Scheduler['tick']>, setNow: (value: number) => void, repositories: Record<string, unknown> }>}
 */
async function harness({ dir = CONFIG_DIR } = {}) {
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
  const policy = loadSchedulePolicy({ dir, bundle: chain.bundle });
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
  const operatorAgent = await chain.registry.register({
    name: `scheduler-operator-${Math.random().toString(36).slice(2, 8)}`,
    role: 'role:operator',
    capabilities: ['action:read-registry', 'action:read-audit'],
    kind: 'service',
  });
  const strangerAgent = await chain.registry.register({
    name: `scheduler-stranger-${Math.random().toString(36).slice(2, 8)}`,
    role: 'role:agent',
    capabilities: ['action:read-registry'],
    kind: 'autonomous',
  });
  return {
    scheduler,
    ledger,
    log,
    policy,
    repositories,
    operator: { id: operatorAgent.id, role: operatorAgent.role },
    stranger: { id: strangerAgent.id, role: strangerAgent.role },
    setNow: (value) => {
      now = value;
    },
    tick: (value) => {
      now = value;
      return scheduler.tick({
        actor: { id: operatorAgent.id, role: operatorAgent.role, kind: 'service' },
      });
    },
  };
}

test('المؤقِّتُ يُطلِقُ العملَ بلا نداءِ إطلاقٍ لكلِّ تشغيلٍ — وهذا نصُّ معيارِ الإغلاقِ', async () => {
  const { scheduler, policy, operator } = await harness();
  let calls = 0;
  for (const job of policy.jobs) {
    scheduler.register(job.id, () => {
      calls += 1;
      return { proof: 'timer' };
    });
  }
  // الزمنُ مُدخَلٌ لا انتظارٌ: اختبارٌ ينامُ خمسَ عشرةَ دقيقةً ليرى نبضةً ليس
  // اختباراً، واختبارٌ يُنادي `tick` بيدِه يُثبِتُ أنّ الدالّةَ تعملُ لا أنّ
  // **المؤقِّتَ** يُناديها. فتُزيَّفُ المؤقِّتاتُ وتُقدَّمُ الساعةُ نبضةً واحدةً.
  mock.timers.enable({ apis: ['setInterval'] });
  /** @type {(value: unknown) => void} */
  let resolveTick = () => {};
  const ticked = new Promise((resolve) => {
    resolveTick = resolve;
  });
  try {
    const stop = scheduler.start({
      actor: { id: operator.id, role: operator.role, kind: 'service' },
      onTick: (result) => resolveTick(result),
    });
    assert.equal(calls, 0, 'نُودِيَ المُنفِّذُ عندَ التشغيلِ لا عندَ النبضةِ');
    // تقديمُ الساعةِ نبضةً واحدةً، ثمّ **انتظارُ نتيجةِ النبضةِ نفسِها** لا عددٍ
    // مُخمَّنٍ من المهامِّ المُصغَّرةِ: النبضةُ تكتبُ في دفترٍ وتمرُّ بقرارٍ، وانتظارٌ
    // بالتخمينِ يجعلُ الاختبارَ يمرُّ أو يسقطُ بحسبِ سرعةِ الجهازِ.
    mock.timers.tick(policy.tickMs);
    const result = /** @type {{ dispatched: unknown[] }} */ (await ticked);
    assert.equal(result.dispatched.length, calls, 'ما أُطلِقَ في النبضةِ لا يطابقُ ما نُودِيَ');
    stop();
  } finally {
    mock.timers.reset();
  }
  assert.ok(calls >= 1, `المؤقِّتُ لم يُطلِقْ شيئاً بنفسِه: ${calls} نداءً`);
});

test('لكلِّ إطلاقٍ واقعةٌ في الدفترِ بطورَي حجزٍ ونتيجةٍ وسلسلةٍ متّصلةٍ', async () => {
  const { scheduler, ledger, policy, tick } = await harness();
  for (const job of policy.jobs) scheduler.register(job.id, () => ({ proof: 'ledger' }));
  const result = await tick(START);
  assert.ok(result.dispatched.length >= 1, 'لم يُطلَقْ عملٌ مستحقٌّ');
  assert.equal(result.refused.length, 0, `رفضٌ غيرُ متوقّعٍ: ${JSON.stringify(result.refused)}`);
  const first = /** @type {{ jobId: string, slotAt: number }} */ (result.dispatched[0]);
  const phases = await ledger.phasesOfSlot({ jobId: first.jobId, slotAt: first.slotAt });
  assert.deepEqual([...phases].sort(), ['completed', 'dispatched']);
  const verified = await ledger.verify();
  assert.equal(verified.ok, true, `سلسلةُ الدفترِ مكسورةٌ: ${JSON.stringify(verified.faults)}`);
  assert.equal(verified.rows, result.dispatched.length * 2);
});

test('الشقُّ الواحدُ لا يُطلَقُ مرّتينِ — والرفضُ باسمِ الحجزِ', async () => {
  const { scheduler, policy, tick, operator } = await harness();
  let calls = 0;
  for (const job of policy.jobs) {
    scheduler.register(job.id, () => {
      calls += 1;
      return {};
    });
  }
  const first = await tick(START);
  const again = await tick(START + 60_000);
  assert.equal(again.dispatched.length, 0, 'أُطلِقَ الشقُّ نفسُه ثانيةً في نبضةٍ تالِيةٍ');
  assert.equal(calls, first.dispatched.length, 'نُودِيَ المُنفِّذُ أكثرَ من مرّةٍ في الشقِّ نفسِه');
  const job = policy.job(/** @type {{ jobId: string }} */ (first.dispatched[0]).jobId);
  await assert.rejects(
    () =>
      scheduler.dispatch({
        job,
        slotAt: job.slotAt(START),
        now: START,
        actor: { id: operator.id, role: operator.role, kind: 'service' },
      }),
    (error) => {
      assert.equal(
        /** @type {{ code?: string }} */ (error).code,
        SCHEDULER_ERRORS.SLOT_ALREADY_CLAIMED,
      );
      return true;
    },
  );
});

test('الموعدُ يُقرأُ من الدفترِ: مُجدوِلٌ جديدٌ على الدفترِ نفسِه لا يُعيدُ عملاً وقعَ', async () => {
  const { scheduler, ledger, policy, tick, operator } = await harness();
  for (const job of policy.jobs) scheduler.register(job.id, () => ({}));
  const first = await tick(START);
  assert.ok(first.dispatched.length >= 1);

  // «إعادةُ تشغيلٍ»: مُجدوِلٌ آخرُ بلا أيِّ حالةٍ في الذاكرةِ على الدفترِ نفسِه.
  const restarted = new Scheduler({
    policy,
    ledger,
    authorizer: /** @type {never} */ (scheduler.authorizer),
    clock: () => START + 60_000,
  });
  for (const job of policy.jobs) restarted.register(job.id, () => ({}));
  const after = await restarted.tick({
    actor: { id: operator.id, role: operator.role, kind: 'service' },
  });
  assert.equal(after.dispatched.length, 0, 'مُجدوِلٌ بعدَ إعادةِ التشغيلِ أعادَ عملاً وقعَ');
  const dueness = await restarted.dueJobs({ now: START + 60_000 });
  for (const entry of dueness) {
    assert.equal(entry.due, false, `${entry.jobId} يُقرأُ مستحقّاً وشقُّه محجوزٌ`);
  }
});

test('الشقُّ التاليَ يُطلَقُ، والشقُّ الفائتُ يُعلَنُ ولا يُعوَّضُ', async () => {
  const { scheduler, policy, tick, log } = await harness();
  for (const job of policy.jobs) scheduler.register(job.id, () => ({}));
  const first = await tick(START);
  const job = policy.job(/** @type {{ jobId: string }} */ (first.dispatched[0]).jobId);
  // ثلاثُ دوريّاتٍ إلى الأمامِ: شقّانِ بينهما فاتا، والحاضرُ يُطلَقُ.
  const later = await tick(job.slotAt(START) + job.everyMs * 3 + 1000);
  const missedForJob = later.missed.filter((entry) => entry.jobId === job.id);
  assert.equal(missedForJob.length, 2, `عددُ الشقوقِ الفائتةِ: ${JSON.stringify(later.missed)}`);
  assert.ok(
    later.dispatched.some((entry) => entry.jobId === job.id),
    'الشقُّ الحاضرُ لم يُطلَقْ',
  );
  const missedEvents = log
    .snapshot()
    .filter((entry) => String(entry['type']) === 'scheduler.slot.missed');
  assert.ok(missedEvents.length >= 2, 'الشقُّ الفائتُ لم يُعلَنْ حدثاً');
  // ولا واقعةَ إطلاقٍ لشقٍّ فائتٍ: التعويضُ يكتبُ في الدفترِ ماضياً لم يقعْ.
  for (const entry of later.dispatched) {
    assert.notEqual(entry.slotAt, job.slotAt(START) + job.everyMs, 'عُوِّضَ شقٌّ فائتٌ');
  }
});

test('العملُ الفاشلُ يُكتَبُ فاشلاً ولا يُعادُ في شقِّه', async () => {
  const { scheduler, ledger, policy, tick } = await harness();
  let calls = 0;
  const target = /** @type {import('../../src/scheduling/index.mjs').ScheduledJob} */ (
    policy.jobs[0]
  );
  for (const job of policy.jobs) {
    scheduler.register(job.id, () => {
      calls += 1;
      if (job.id === target.id) throw new Error('فشلٌ مقصودٌ لأجلِ القياسِ');
      return {};
    });
  }
  await tick(START);
  const phases = await ledger.phasesOfSlot({ jobId: target.id, slotAt: target.slotAt(START) });
  assert.deepEqual([...phases].sort(), ['dispatched', 'failed']);
  const callsAfterFailure = calls;
  const again = await tick(START + 60_000);
  assert.equal(again.dispatched.length, 0, 'أُعيدَ عملٌ فاشلٌ في شقِّه نفسِه');
  assert.equal(calls, callsAfterFailure, 'نُودِيَ المُنفِّذُ ثانيةً في الشقِّ نفسِه');
  // وشقٌّ لم يكتملْ لا يُقرأُ مكتملاً: `lastCompletedSlot` تتجاهلُ الفاشلَ.
  assert.equal(await ledger.lastCompletedSlot(target.id), undefined);
});

test('فاعلٌ بدورٍ لا تمنحُه السياسةُ الإطلاقَ يُرفَضُ بقرارٍ لا بصمتٍ', async () => {
  const { scheduler, ledger, policy, stranger } = await harness();
  const job = /** @type {import('../../src/scheduling/index.mjs').ScheduledJob} */ (policy.jobs[0]);
  scheduler.register(job.id, () => ({}));
  await assert.rejects(
    () =>
      scheduler.dispatch({
        job,
        slotAt: job.slotAt(START),
        now: START,
        actor: { id: stranger.id, role: stranger.role, kind: 'agent' },
      }),
    (error) => {
      assert.equal(/** @type {{ code?: string }} */ (error).code, SCHEDULER_ERRORS.NOT_AUTHORIZED);
      return true;
    },
  );
  const phases = await ledger.phasesOfSlot({ jobId: job.id, slotAt: job.slotAt(START) });
  assert.equal(phases.size, 0, 'حُجِزَ شقٌّ لإطلاقٍ مرفوضٍ');
});

test('مُجدوِلٌ بلا نقطةِ تفويضٍ يرفضُ الإطلاقَ من أصلِه، وبلا بوابةِ هويةٍ كذلك', async () => {
  const { policy, ledger, operator } = await harness();
  const job = /** @type {import('../../src/scheduling/index.mjs').ScheduledJob} */ (policy.jobs[0]);
  const bare = new Scheduler({ policy, ledger, clock: () => START });
  bare.register(job.id, () => ({}));
  await assert.rejects(
    () =>
      bare.dispatch({
        job,
        slotAt: job.slotAt(START),
        now: START,
        actor: { id: operator.id, role: operator.role, kind: 'service' },
      }),
    (error) => {
      assert.equal(
        /** @type {{ code?: string }} */ (error).code,
        SCHEDULER_ERRORS.AUTHORIZER_REQUIRED,
      );
      return true;
    },
  );

  // ونقطةُ تفويضٍ **بلا بوابةِ هويةٍ** تُرفَضُ بنفسِ الرمزِ: بوابةٌ غائبةٌ تعني
  // أنّ الفاعلَ يُقبَلُ كما وصفَ نفسَه، ومُجدوِلٌ يعملُ في غيابِ الناسِ لا يُقبَلُ
  // فيه فاعلٌ مزعومٌ.
  const gateless = new Scheduler({
    policy,
    ledger,
    authorizer: /** @type {never} */ ({
      authorize: async () => ({ decision: { allowed: true, code: 'OK', reason: '' }, token: 't' }),
      verify: () => true,
    }),
    clock: () => START,
  });
  gateless.register(job.id, () => ({}));
  await assert.rejects(
    () =>
      gateless.dispatch({
        job,
        slotAt: job.slotAt(START),
        now: START,
        actor: { id: operator.id, role: operator.role, kind: 'service' },
      }),
    (error) => {
      assert.equal(
        /** @type {{ code?: string }} */ (error).code,
        SCHEDULER_ERRORS.AUTHORIZER_REQUIRED,
      );
      return true;
    },
  );
});

test('عملٌ مُعلَنٌ بلا مُنفِّذٍ يُرفَضُ قبلَ الحجزِ فلا يبقى شقٌّ محجوزٌ بلا عملٍ', async () => {
  const { scheduler, ledger, policy, operator } = await harness();
  const job = /** @type {import('../../src/scheduling/index.mjs').ScheduledJob} */ (policy.jobs[0]);
  await assert.rejects(
    () =>
      scheduler.dispatch({
        job,
        slotAt: job.slotAt(START),
        now: START,
        actor: { id: operator.id, role: operator.role, kind: 'service' },
      }),
    (error) => {
      assert.equal(/** @type {{ code?: string }} */ (error).code, SCHEDULER_ERRORS.HANDLER_MISSING);
      return true;
    },
  );
  assert.equal((await ledger.phasesOfSlot({ jobId: job.id, slotAt: job.slotAt(START) })).size, 0);
});

test('النبضةُ بلا فاعلٍ تُرفَضُ: لا فاعلَ اسمُه «النظامُ»', async () => {
  const { scheduler } = await harness();
  await assert.rejects(
    () => scheduler.tick(/** @type {never} */ ({})),
    (error) => {
      assert.equal(/** @type {{ code?: string }} */ (error).code, SCHEDULER_ERRORS.INPUT_INVALID);
      return true;
    },
  );
});

test('القيودُ ترفضُ عندَ التحميلِ جدولةَ فعلٍ فوقَ العتبةِ السياديّةِ', () => {
  const dir = mkdtempSync(join(tmpdir(), 'xuux-schedule-config-'));
  try {
    cpSync(CONFIG_DIR, dir, { recursive: true });
    writeFileSync(
      join(dir, 'schedule.yaml'),
      [
        'version: 1',
        'tick:',
        '  everyMinutes: 15',
        '  maxJobsPerTick: 2',
        'jobs:',
        '  - id: job:purge',
        "    subject: 'جدولةُ محوٍ — وهي ما يجبُ أن يُرفَضَ عندَ التحميلِ'",
        '    kind: report',
        '    cadence:',
        '      everyHours: 24',
        '      graceHours: 6',
        '    actorRole: role:operator',
        '    performs:',
        '      - purge-data',
        '',
      ].join('\n'),
    );
    assert.throws(
      () => loadSchedulePolicy({ dir, bundle: loadPolicyBundle() }),
      (error) => {
        assert.equal(
          /** @type {{ code?: string }} */ (error).code,
          SCHEDULER_ERRORS.CONFIG_INVALID,
        );
        assert.match(String(/** @type {{ message?: string }} */ (error).message), /purge-data/u);
        return true;
      },
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('فعلُ الإطلاقِ مُعلَنٌ في فهرسِ الأفعالِ وتحتَ العتبةِ السياديّةِ', () => {
  const bundle = loadPolicyBundle();
  assert.equal(bundle.actions.has(SCHEDULER_DISPATCH_ACTION), true);
  const above = new Set((bundle.threshold ?? []).map((entry) => String(entry.action)));
  assert.equal(
    above.has(SCHEDULER_DISPATCH_ACTION),
    false,
    'فعلُ الإطلاقِ فوقَ العتبةِ السياديّةِ؛ فلا يقعُ إلا بأمرٍ ملكيٍّ ولا يصلحُ للجدولةِ.',
  );
  // وسياسةٌ واحدةٌ على الأقلِّ تمنحُ دورَ المُشغِّلِ هذا الفعلَ: فعلٌ بلا سياسةٍ
  // تمنحُه يُرفَضُ في كلِّ نبضةٍ، فتُقرأُ الجدولةُ عاطلةً بلا سببٍ ظاهرٍ.
  const granting = bundle.policies.filter(
    (entry) =>
      entry.effect === 'allow' &&
      entry.actions.includes(SCHEDULER_DISPATCH_ACTION) &&
      (entry.actors.roles ?? []).includes('role:operator'),
  );
  assert.ok(granting.length >= 1, 'لا سياسةَ تمنحُ المُشغِّلَ إطلاقَ عملٍ مجدوَلٍ');
});
