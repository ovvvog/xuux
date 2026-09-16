/**
 * المُجدوِلُ السياديُّ — إغلاقُ الدَينِ `D-4` (‏`WL-191`).
 *
 * **العيبُ الذي تُغلقُه هذه الوحدةُ، بنصِّه كما كان (‏`D-4`):** «لا مُجدوِلَ
 * ذاتيَّ التشغيلِ في المستودعِ. التقاريرُ والتمارينُ تُطلَقُ بنداءٍ يدويٍّ،
 * والدوريّةُ عهدٌ في وثيقةٍ لا فعلٌ يقعُ». وهذا الملفُّ هو **الفعلُ**: يسألُ في
 * كلِّ نبضةٍ «ما استحقَّ؟» من **الدفترِ**، ويُطلِقُ ما استحقَّ بقرارٍ مُسجَّلٍ،
 * ويكتبُ لكلِّ إطلاقٍ واقعةً.
 *
 * **وثلاثةُ أشياءَ تفصلُ هذا عن «حلقةٍ تُنادي دوالَّ»:**
 *
 *  1. **الموعدُ من الدفترِ لا من الذاكرةِ.** لا حقلَ `lastRunAt` في هذا الصفِّ
 *     ولا في أيِّ صفٍّ: `dueJobs` تقرأُ آخرَ شقٍّ مكتملٍ من `ScheduledRunLedger`
 *     في كلِّ نبضةٍ. فإعادةُ التشغيلِ لا تُعيدُ عملاً وقعَ ولا تُصفِّرُ موعداً.
 *  2. **الإطلاقُ فعلٌ محكومٌ.** كلُّ إطلاقٍ يمرُّ بنقطةِ التفويضِ
 *     (`run-scheduled-job` على المَورِدِ `job:<id>`)، وتُستهلَكُ تذكرتُه عندَ
 *     الاستدعاءِ نفسِه بـ`verify` لا عندَ الطلبِ. ومُجدوِلٌ يُطلِقُ بلا قرارٍ
 *     مسارٌ يعملُ في غيابِ الناسِ بلا نسبةٍ — وهو أخطرُ من غيابِ الجدولةِ.
 *  3. **حجزُ الشقِّ قبلَ العملِ لا بعدَه.** الحجزُ صفٌّ في الدفترِ يحميه قيدُ
 *     تفرّدٍ في القاعدةِ؛ فنسختانِ من المُجدوِلِ تعملانِ معاً لا تُطلِقانِ الشقَّ
 *     نفسَه، والثانيةُ تُرفَضُ بـ`SCHEDULER_SLOT_ALREADY_CLAIMED`.
 *
 * **حدودٌ مُعلَنةٌ — وهي مقصودةٌ لا نقصٌ سيُستدرَك:**
 *
 *  - **لا تعويضَ عن شقٍّ فائتٍ.** الشقُّ الجاريُ وحدَه يُطلَقُ، وما فاتَ يُعلَنُ
 *    فائتاً (`scheduler.slot.missed`). تشغيلُ تقريرِ نافذةٍ مضت اليومَ يكتبُ في
 *    الدفترِ واقعةً تُقرأُ لاحقاً كأنّها وقعت في موعدِها، وذاك تزييفُ سجلٍّ.
 *  - **العملُ الفاشلُ لا يُعادُ في شقِّه.** يُكتَبُ `failed`، ويبقى الشقُّ غيرَ
 *    مكتملٍ فيظهرُ فائتاً في القراءةِ، ويُعادُ في الشقِّ التالي. وإعادتُه في
 *    شقِّه تجعلُ عملاً يفشلُ فشلاً ثابتاً يستنزفُ الدولةَ بحلقةٍ لا تنتهي.
 *  - **هويةُ المُجدوِلِ هويةُ مَن شغَّلَه.** لا فاعلَ اسمُه «النظامُ»: الفاعلُ
 *    يُمرَّرُ عندَ التشغيلِ وتتحقّقُ منه بوابةُ الهويةِ في كلِّ إطلاقٍ. ومعنى
 *    «بلا نداءٍ يدويٍّ» أن لا نداءَ **لكلِّ تشغيلٍ**، لا أن لا فاعلَ للتشغيلِ.
 *  - **الحُكمُ على ما يفعلُه العملُ داخلَه ليس هنا.** لكلِّ تقريرٍ وتمرينٍ
 *    بوّاباتُه؛ وهذا الفعلُ يحكمُ **الإطلاقَ**. والقيودُ ترفضُ عندَ التحميلِ
 *    جدولةَ فعلٍ فوقَ العتبةِ السياديّةِ، فلا يُجدوَلُ ما لا يقعُ إلا بأمرٍ ملكيٍّ.
 *
 * @module scheduling/scheduler
 */

import { SCHEDULER_ERRORS, SchedulerError } from './errors.mjs';

/**
 * فعلُ الإطلاقِ المحكومُ. **اسمٌ واحدٌ لفعلٍ واحدٍ**: من كتبَه نصّاً في موضعٍ
 * ثانٍ فتحَ بابَ فعلَينِ بمسمّيَينِ، والحاجزُ يفحصُ هذا الرمزَ لا النصَّ.
 * وموضعُه هذا الملفُّ لا `schedule-policy.mjs`: **الفعلُ يُسمّى حيثُ يُفوَّضُ**
 * (قاعدةُ `R2` في `guard:authorization`).
 */
export const SCHEDULER_DISPATCH_ACTION = 'run-scheduled-job';

/**
 * @typedef {import('./schedule-policy.mjs').SchedulePolicy} SchedulePolicy
 * @typedef {import('./schedule-policy.mjs').ScheduledJob} ScheduledJob
 * @typedef {import('./run-ledger.mjs').ScheduledRunLedger} ScheduledRunLedger
 */

/**
 * @typedef {object} SchedulerActor
 * @property {string} id
 * @property {string} role
 * @property {string} [kind]
 * @property {string} [state]
 */

/**
 * @typedef {object} JobDueness
 * @property {string} jobId
 * @property {number} slotAt
 * @property {number | undefined} lastCompletedSlot
 * @property {boolean} due
 * @property {boolean} overdue
 * @property {number[]} missedSlots
 * @property {string} statement
 */

/** المُجدوِلُ: يقرأُ الموعدَ من الدفترِ، ويُطلِقُ بقرارٍ، ويكتبُ واقعةً. */
export class Scheduler {
  /**
   * @param {object} deps
   * @param {SchedulePolicy} deps.policy
   * @param {ScheduledRunLedger} deps.ledger
   * @param {{ authorize: (request: import('../policy/model.mjs').PolicyRequest, measurement?: { measured?: Record<string, unknown> }) => Promise<{ decision: { allowed: boolean, code: string, reason: string, policyId?: string | null }, token: string | null }>, verify: (token: string | undefined, expected: { actorId: string, action: string, resourceKey: string }) => unknown, identityGate?: unknown } | null} [deps.authorizer]
   * @param {{ append: (type: string, actor: string, data: object) => unknown } | null} [deps.log]
   * @param {(() => number) | undefined} [deps.clock] ساعةُ الآنِ بالميلي ثانية.
   */
  constructor({ policy, ledger, authorizer = null, log = null, clock }) {
    if (policy === undefined || ledger === undefined) {
      throw new SchedulerError(
        SCHEDULER_ERRORS.INPUT_INVALID,
        'المُجدوِلُ يحتاجُ قيوداً مُعلَنةً ودفترَ إطلاقاتٍ: بلا قيودٍ جدولةٌ في الكودِ، وبلا دفترٍ موعدٌ في الذاكرةِ يزولُ بإعادةِ التشغيلِ.',
      );
    }
    this.policy = policy;
    this.ledger = ledger;
    this.authorizer = authorizer;
    this.log = log;
    this.clock = clock ?? (() => Date.now());
    /** @type {Map<string, (context: { job: ScheduledJob, slotAt: number, now: number, actor: SchedulerActor }) => Promise<Record<string, unknown>> | Record<string, unknown>>} */
    this.handlers = new Map();
    /** @type {ReturnType<typeof setInterval> | null} */
    this.timer = null;
  }

  /**
   * تسجيلُ مُنفِّذٍ لعملٍ معلَنٍ. والعملُ يُقرأُ من القيودِ أوّلاً: تسجيلُ
   * مُنفِّذٍ لعملٍ غيرِ معلَنٍ جدولةٌ خارجَ البياناتِ، فيُرفَضُ باسمِه.
   * @param {string} jobId
   * @param {(context: { job: ScheduledJob, slotAt: number, now: number, actor: SchedulerActor }) => Promise<Record<string, unknown>> | Record<string, unknown>} handler
   * @returns {void}
   */
  register(jobId, handler) {
    const job = this.policy.job(jobId);
    if (typeof handler !== 'function') {
      throw new SchedulerError(
        SCHEDULER_ERRORS.INPUT_INVALID,
        `مُنفِّذُ العملِ «${jobId}» ليس دالّةً؛ ومُنفِّذٌ ليس دالّةً يجعلُ الشقَّ يُحجَزُ ثمّ لا يقعُ عملٌ.`,
        { jobId },
      );
    }
    this.handlers.set(job.id, handler);
  }

  /**
   * قراءةُ الاستحقاقِ لكلِّ عملٍ **من الدفترِ**. لا حالةَ في الذاكرةِ تُقرأُ هنا:
   * مصدرُ الموعدِ الوحيدُ هو آخرُ شقٍّ مكتملٍ في `state.scheduled_runs`.
   * @param {{ now?: number }} [options]
   * @returns {Promise<JobDueness[]>}
   */
  async dueJobs({ now = this.clock() } = {}) {
    /** @type {JobDueness[]} */
    const out = [];
    for (const job of this.policy.jobs) {
      const slotAt = job.slotAt(now);
      const lastCompletedSlot = await this.ledger.lastCompletedSlot(job.id);
      const phases = await this.ledger.phasesOfSlot({ jobId: job.id, slotAt });
      const claimed = phases.size > 0;
      const completed = phases.has('completed');
      const due = !claimed;
      const overdue = !completed && now - slotAt > job.graceMs;
      /** @type {number[]} */
      const missedSlots = [];
      if (lastCompletedSlot !== undefined) {
        for (let slot = lastCompletedSlot + job.everyMs; slot < slotAt; slot += job.everyMs) {
          missedSlots.push(slot);
        }
      }
      out.push({
        jobId: job.id,
        slotAt,
        lastCompletedSlot,
        due,
        overdue,
        missedSlots,
        statement:
          lastCompletedSlot === undefined
            ? 'لا شقَّ مكتملاً في الدفترِ — وغيابُ الدليلِ ليس براءةً، فالعملُ مستحقٌّ الآنَ.'
            : `آخرُ شقٍّ مكتملٍ ${new Date(lastCompletedSlot).toISOString()}؛ والشقُّ الجاريُ ${new Date(slotAt).toISOString()}${claimed ? ' محجوزٌ' : ' غيرُ محجوزٍ'}.`,
      });
    }
    return out;
  }

  /**
   * @returns {void}
   */
  #assertAuthorizer() {
    if (this.authorizer === null || typeof this.authorizer.authorize !== 'function') {
      throw new SchedulerError(
        SCHEDULER_ERRORS.AUTHORIZER_REQUIRED,
        `الإطلاقُ فعلٌ محكومٌ («${SCHEDULER_DISPATCH_ACTION}») ولم تُمرَّر نقطةُ تفويضٍ؛ ومُجدوِلٌ يُطلِقُ بلا قرارٍ مسارٌ يعملُ في غيابِ الناسِ بلا نسبةٍ.`,
        { action: SCHEDULER_DISPATCH_ACTION },
      );
    }
    const gate = /** @type {{ identityGate?: { verify?: unknown } | null }} */ (this.authorizer)
      .identityGate;
    if (gate === null || gate === undefined || typeof gate.verify !== 'function') {
      throw new SchedulerError(
        SCHEDULER_ERRORS.AUTHORIZER_REQUIRED,
        'نقطةُ التفويضِ الممرَّرةُ بلا بوابةِ هويةٍ موصولةٍ؛ فتقبلُ الفاعلَ كما وصفَ نفسَه، ومُجدوِلٌ يعملُ بلا حاضرٍ لا يُقبَلُ فيه فاعلٌ مزعومٌ.',
        { action: SCHEDULER_DISPATCH_ACTION },
      );
    }
  }

  /**
   * إطلاقُ عملٍ واحدٍ في شقِّه: تفويضٌ، ثمّ حجزٌ، ثمّ تشغيلٌ، ثمّ واقعةُ نتيجةٍ.
   * @param {{ job: ScheduledJob, slotAt: number, now: number, actor: SchedulerActor }} input
   * @returns {Promise<{ jobId: string, slotAt: number, outcome: 'completed' | 'failed', detail: Record<string, unknown> }>}
   */
  async dispatch({ job, slotAt, now, actor }) {
    this.#assertAuthorizer();
    const handler = this.handlers.get(job.id);
    if (handler === undefined) {
      // الرفضُ **قبلَ** الحجزِ: حجزُ شقٍّ لعملٍ لا مُنفِّذَ له يُسكِتُ العملَ إلى
      // الشقِّ التاليَ ويُقرأُ الدفترُ بعدَه كأنّ الجدولةَ تعملُ.
      throw new SchedulerError(
        SCHEDULER_ERRORS.HANDLER_MISSING,
        `العملُ «${job.id}» معلَنٌ في القيودِ ولا مُنفِّذَ مسجَّلٌ له؛ ولا يُحجَزُ شقٌّ لعملٍ لا يقعُ، فحجزٌ بلا عملٍ صمتٌ يُقرأُ نجاحاً.`,
        { jobId: job.id },
      );
    }
    const authorizer = /** @type {NonNullable<Scheduler['authorizer']>} */ (this.authorizer);
    const resourceKey = job.id;
    const { decision, token } = await authorizer.authorize({
      actor: {
        id: actor.id,
        role: actor.role,
        kind: /** @type {import('../policy/model.mjs').ActorKind} */ (actor.kind ?? 'human'),
        state: actor.state ?? 'active',
      },
      action: SCHEDULER_DISPATCH_ACTION,
      resource: { type: 'job', id: job.id.replace(/^job:/, ''), classification: 'internal' },
      context: { slotAt: new Date(slotAt).toISOString(), jobKind: job.kind },
    });
    if (!decision.allowed) {
      throw new SchedulerError(
        SCHEDULER_ERRORS.NOT_AUTHORIZED,
        `نقطةُ التفويضِ رفضت إطلاقَ «${job.id}» برمزِ ${decision.code}: ${decision.reason}`,
        { jobId: job.id, code: decision.code, policyId: decision.policyId },
      );
    }

    const phases = await this.ledger.phasesOfSlot({ jobId: job.id, slotAt });
    if (phases.size > 0) {
      throw new SchedulerError(
        SCHEDULER_ERRORS.SLOT_ALREADY_CLAIMED,
        `الشقُّ ${new Date(slotAt).toISOString()} للعملِ «${job.id}» محجوزٌ سابقاً (${[...phases].join('، ')}); وإطلاقُه ثانيةً إطلاقٌ مزدوجٌ لا استئنافٌ.`,
        { jobId: job.id, slotAt, phases: [...phases] },
      );
    }

    // **التذكرةُ تُستهلَكُ عندَ الاستدعاءِ نفسِه**: التفويضُ قبلَ الحجزِ أهليّةٌ،
    // واستهلاكُ التذكرةِ هنا هو السلطةُ. وتذكرةٌ تُطلَبُ ولا تُستهلَكُ تجعلُ
    // القرارَ ورقةً لا بوّابةً.
    authorizer.verify(token ?? undefined, {
      actorId: actor.id,
      action: SCHEDULER_DISPATCH_ACTION,
      resourceKey,
    });

    const decisionId = decision.policyId ?? 'none';
    await this.ledger.append({
      jobId: job.id,
      slotAt,
      phase: 'dispatched',
      actorId: actor.id,
      decisionId,
      detail: { subject: job.subject, kind: job.kind, dispatchedAt: new Date(now).toISOString() },
    });

    const startedAt = this.clock();
    try {
      const result = (await handler({ job, slotAt, now, actor })) ?? {};
      const detail = {
        ...result,
        durationMs: Math.max(0, this.clock() - startedAt),
      };
      await this.ledger.append({
        jobId: job.id,
        slotAt,
        phase: 'completed',
        actorId: actor.id,
        decisionId,
        detail,
      });
      return { jobId: job.id, slotAt, outcome: 'completed', detail };
    } catch (error) {
      const detail = {
        code: error instanceof SchedulerError ? error.code : 'HANDLER_THREW',
        message: error instanceof Error ? error.message : String(error),
        durationMs: Math.max(0, this.clock() - startedAt),
      };
      await this.ledger.append({
        jobId: job.id,
        slotAt,
        phase: 'failed',
        actorId: actor.id,
        decisionId,
        detail,
      });
      return { jobId: job.id, slotAt, outcome: 'failed', detail };
    }
  }

  /**
   * نبضةٌ واحدةٌ: تقرأُ الاستحقاقَ من الدفترِ وتُطلِقُ ما استحقَّ حتى السقفِ
   * المُعلَنِ. وهي **المسارُ الوحيدُ** للإطلاقِ الدوريِّ، تُنادى من المؤقِّتِ.
   * @param {{ now?: number, actor: SchedulerActor }} input
   * @returns {Promise<{ now: string, dispatched: Array<{ jobId: string, slotAt: number, outcome: string }>, refused: Array<{ jobId: string, code: string }>, missed: Array<{ jobId: string, slotAt: string }>, skipped: string[] }>}
   */
  async tick({ now = this.clock(), actor }) {
    if (actor === undefined || typeof actor.id !== 'string' || typeof actor.role !== 'string') {
      throw new SchedulerError(
        SCHEDULER_ERRORS.INPUT_INVALID,
        'النبضةُ تحتاجُ فاعلاً بهويةٍ ودورٍ؛ ولا فاعلَ اسمُه «النظامُ» في هذه الدولةِ، فكلُّ إطلاقٍ يُنسَبُ إلى مَن شغَّلَ المُجدوِلَ.',
      );
    }
    const dueness = await this.dueJobs({ now });
    /** @type {Array<{ jobId: string, slotAt: number, outcome: string }>} */
    const dispatched = [];
    /** @type {Array<{ jobId: string, code: string }>} */
    const refused = [];
    /** @type {Array<{ jobId: string, slotAt: string }>} */
    const missed = [];
    /** @type {string[]} */
    const skipped = [];

    for (const entry of dueness) {
      for (const slot of entry.missedSlots) {
        const slotText = new Date(slot).toISOString();
        missed.push({ jobId: entry.jobId, slotAt: slotText });
        this.log?.append('scheduler.slot.missed', actor.id, {
          jobId: entry.jobId,
          slotAt: slotText,
        });
      }
      if (!entry.due) {
        skipped.push(entry.jobId);
        continue;
      }
      if (dispatched.length >= this.policy.tick.maxJobsPerTick) {
        skipped.push(entry.jobId);
        continue;
      }
      const job = this.policy.job(entry.jobId);
      try {
        const result = await this.dispatch({ job, slotAt: entry.slotAt, now, actor });
        dispatched.push({ jobId: result.jobId, slotAt: result.slotAt, outcome: result.outcome });
      } catch (error) {
        refused.push({
          jobId: entry.jobId,
          code: error instanceof SchedulerError ? error.code : 'UNKNOWN',
        });
      }
    }

    const nowText = new Date(now).toISOString();
    this.log?.append('scheduler.tick', actor.id, {
      now: nowText,
      dispatched: dispatched.length,
      refused: refused.length,
      missed: missed.length,
    });
    return { now: nowText, dispatched, refused, missed, skipped };
  }

  /**
   * تشغيلُ المؤقِّتِ: من هنا يصيرُ الإطلاقُ **بلا نداءٍ يدويٍّ**. والمؤقِّتُ
   * `unref` كي لا يمنعَ عمليّةً من الانتهاءِ، والأخطاءُ تُسجَّلُ ولا تُرمى في
   * حدثٍ غيرِ ملتقَطٍ يُسقِطُ العمليّةَ.
   * @param {{ actor: SchedulerActor, onTick?: (result: unknown) => void }} input
   * @returns {() => void} دالّةُ إيقافٍ.
   */
  start({ actor, onTick }) {
    if (this.timer !== null) {
      throw new SchedulerError(
        SCHEDULER_ERRORS.INPUT_INVALID,
        'المُجدوِلُ يعملُ بالفعلِ؛ ومؤقِّتانِ في عمليّةٍ واحدةٍ يتنافسانِ على الشقِّ نفسِه بلا سببٍ.',
      );
    }
    const timer = setInterval(() => {
      void this.tick({ actor })
        .then((result) => onTick?.(result))
        .catch((error) => {
          this.log?.append('scheduler.tick.failed', actor.id, {
            message: error instanceof Error ? error.message : String(error),
          });
        });
    }, this.policy.tickMs);
    if (typeof timer.unref === 'function') timer.unref();
    this.timer = timer;
    return () => this.stop();
  }

  /** إيقافُ المؤقِّتِ. */
  stop() {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}
