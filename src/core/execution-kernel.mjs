import { randomUUID } from 'node:crypto';
import { snapshot } from '../lib/snapshot.mjs';
import { loadGovernedActions } from '../policy/governed.mjs';
import { TaskLifecycle, assertTransition } from '../execution/lifecycle.mjs';
import { royalCommandDigest } from '../root-of-trust/crown.mjs';
import { isProductionRuntime } from '../root-of-trust/production-boot.mjs';

/** @typedef {import('../root-of-trust/crown.mjs').CrownGateway} CrownGateway */
/** @typedef {import('../root-of-trust/crown.mjs').RoyalCommand} RoyalCommand */
/** @typedef {import('../root-of-trust/crown.mjs').AcceptedRoyalCommand} AcceptedRoyalCommand */
/** @typedef {import('../root-of-trust/event-log.mjs').EventLog} EventLog */
/** @typedef {import('../root-of-trust/policy.mjs').PolicyEngine} PolicyEngine */
/** @typedef {import('../root-of-trust/halt-switch.mjs').HaltGuard} HaltGuard */

/**
 * حالات المهمة الخمس. النوع مشتق من الكائن المُجمَّد نفسه، فلا يمكن أن تنحرف
 * قائمة الحالات عن النوع الذي يفحصها.
 * @typedef {(typeof TaskState)[keyof typeof TaskState]} TaskStateValue
 */

/**
 * مهمة داخل النواة. الحقول التي تُضاف بعد البدء (البدء والنتيجة والخطأ والانتهاء)
 * اختيارية لأنها لا توجد لحظة الإدراج في الطابور، وإعلانها هنا هو ما يسمح
 * بإسنادها لاحقاً بلا خرق للنوع.
 * @typedef {object} Task
 * @property {string} id
 * @property {AcceptedRoyalCommand} command - الأمر بعد قبول التاج له
 * @property {TaskStateValue} state
 * @property {string} createdAt
 * @property {string} [startedAt]
 * @property {string} [finishedAt]
 * @property {unknown} [result] - ناتج المُعالِج، شكله يحدّده المُعالِج لا النواة
 * @property {string} [error] - رسالة الفشل إن فشلت المهمة
 */

export const TaskState = Object.freeze({
  QUEUED: 'queued',
  RUNNING: 'running',
  SUCCEEDED: 'succeeded',
  FAILED: 'failed',
  STOPPED: 'stopped',
});

/**
 * مقايسة حالات النواة (الخمس، في الذاكرة) بدورة حياة المهمة الدائمة السبع
 * (`src/execution/lifecycle.mjs`) — الخطوة `M5.01`.
 *
 * قبل هذه المقايسة كانت النواة تُبدّل نصّاً في كائن، فأيُّ انتقال كان ممكناً بنيوياً
 * ولو كان محرَّماً منطقياً. صارت الآن **كل نقلة حالة في النواة تُصدَّق بجدول
 * الانتقالات المشروعة نفسه** الذي يحرس الطابور الدائم، فلا مصدرَي حقٍّ لدورة حياة
 * واحدة. و«مجدولة» هي مقابل `QUEUED` لأن الإدراج في طابور النواة يقع **بعد**
 * التصريح (التاج والتفويض) لا قبله، و`STOPPED` تقابل «ملغاة» لأن كليهما إنهاءٌ
 * بقرارٍ خارجي لا بفشلٍ في العمل.
 * @type {Readonly<Record<TaskStateValue, import('../execution/lifecycle.mjs').TaskLifecycleState>>}
 */
export const KERNEL_STATE_TO_LIFECYCLE = Object.freeze({
  [TaskState.QUEUED]: TaskLifecycle.SCHEDULED,
  [TaskState.RUNNING]: TaskLifecycle.RUNNING,
  [TaskState.SUCCEEDED]: TaskLifecycle.SUCCEEDED,
  [TaskState.FAILED]: TaskLifecycle.FAILED,
  [TaskState.STOPPED]: TaskLifecycle.CANCELLED,
});

/**
 * ينقل مهمة النواة إلى حالة جديدة **بعد** تصديق الانتقال بجدول دورة الحياة.
 * انتقالٌ غير مشروع يرفع `LifecycleError` ولا يُكتب في المهمة، فالحالة الفاسدة لا
 * تُسجَّل ثم تُصلَح — لا تُسجَّل أصلاً (المادة 9).
 * @param {Task} task
 * @param {TaskStateValue} next
 * @returns {void}
 */
function transitionKernelTask(task, next) {
  assertTransition(KERNEL_STATE_TO_LIFECYCLE[task.state], KERNEL_STATE_TO_LIFECYCLE[next]);
  task.state = next;
}

export class SafeMode {
  constructor() {
    this.active = false;
    /** @type {string | null} */
    this.reason = null;
  }
  /**
   * يُدخل النظام في الوضع الآمن فيمنع أي تنفيذ جديد.
   * @param {string} reason - سبب الدخول، يُسجَّل ويُعاد في رسالة الرفض
   * @returns {void}
   */
  enter(reason) {
    this.active = true;
    this.reason = reason;
  }
  leave() {
    this.active = false;
    this.reason = null;
  }
  assertOperational() {
    if (this.active) throw new Error(`SAFE_MODE: ${this.reason}`);
  }
  /**
   * يُلتقطُ حالة الوضع الآمن لإبقائها عبرَ إعادةِ التشغيل (R6-A-05 — الجزءُ الثاني).
   * @returns {{ active: boolean, reason: string | null }} اللقطة
   */
  snapshot() {
    return { active: this.active, reason: this.reason };
  }
  /**
   * يُعيدُ بناءَ حالة الوضع الآمن من لقطةٍ بعدَ إعادةِ التشغيل (R6-A-05 — الجزءُ الثاني).
   * لا يُكتبُ في سجلِّ الأحداث: الاستعادةُ تستعيدُ الحالةَ لا تُنشئُها.
   * @param {{ active?: boolean, reason?: string | null }} snapshot - اللقطة
   * @returns {boolean} هل تُمَّت الاستعادةُ بنجاحٍ؟
   */
  restore(snapshot) {
    if (!snapshot || typeof snapshot !== 'object') return false;
    if (typeof snapshot.active === 'boolean') {
      this.active = snapshot.active;
    }
    if (typeof snapshot.reason === 'string' || snapshot.reason === null) {
      this.reason = snapshot.reason ?? null;
    }
    return true;
  }
}

export class ExecutionKernel {
  /**
   * الاعتماديات موصوفة كاختيارية في النوع لأن التوقيع يقبل الاستدعاء بلا وسائط
   * ويردّ عليه بخطأ مُسمّى `KERNEL_DEPENDENCY_MISSING`. جعلها إلزامية في النوع
   * كان سيحوّل ذلك الخطأ المقروء إلى انهيار تفكيك غامض — أي تغييراً في السلوك.
   * والتحقّق في أول سطر هو ما يضيّق النوع بعده إلى وجود مؤكد.
   * `haltSwitch` اختياري ومطفأ افتراضياً (M2.08): إن وُصل صار الإيقاف الشامل
   * الدائم يُقرأ من القرص قبل كل مهمة، فلا يبقى الإيقاف حبيس ذاكرة هذه العملية.
   *
   * `enforcement` هي نقطة التفويض المركزية (M4.05). وهي اختيارية في التوقيع
   * **لا في الأثر**: من لم يوصلها لا يستطيع تنفيذ فعلٍ محكوم أصلاً، لأن الفعل
   * المحكوم يُرفض حينها بـ`AUTHORIZATION_POINT_REQUIRED`. وقائمة الأفعال
   * المحكومة تُقرأ من النقطة نفسها — أي من `config/*.yaml` لا من الكود.
   * @param {{ crown?: CrownGateway, log?: EventLog, policy?: PolicyEngine | null, haltSwitch?: HaltGuard | null, enforcement?: import('../policy/enforcement-point.mjs').EnforcementPoint | null, env?: NodeJS.ProcessEnv }} [deps]
   */
  constructor({
    crown,
    log,
    policy = null,
    haltSwitch = null,
    enforcement = null,
    env = process.env,
  } = {}) {
    if (!crown || !log) throw new Error('KERNEL_DEPENDENCY_MISSING');
    this.crown = crown;
    this.log = log;
    this.policy = policy;
    this.haltSwitch = haltSwitch;
    this.enforcement = enforcement;
    /** `WL-302`: يُقرأُ مرّةً — في الإنتاجِ لا يُبدَّلُ الوضعُ الآمنُ بنداءِ دالّة. */
    this.production = isProductionRuntime(env);
    /**
     * الأفعال المحكومة تُقرأ من **البيانات** لا من نقطة التفويض: لو كانت المعرفة
     * تأتي من النقطة وحدها لصار «لا تُوصل النقطة» هو المسار الجانبي نفسه.
     * @type {ReadonlySet<string>}
     */
    this.governedActions = loadGovernedActions();
    this.safeMode = new SafeMode();
    /** @type {Map<string, Task>} */
    this.tasks = new Map();
  }
  /**
   * يُقدّم أمراً موقّعاً للتنفيذ: يُجيزه التاج أولاً، ثم يُنفَّذ المُعالِج تحت
   * سجل أحداث كامل من الطابور إلى النتيجة.
   * @param {RoyalCommand} command - الأمر الملكي المطلوب تنفيذه
   * @param {string} signature - توقيع الأمر، يتحقّق منه التاج لا النواة
   * @param {(command: AcceptedRoyalCommand) => unknown | Promise<unknown>} handler - المُنفِّذ الفعلي
   * @param {{ decisionToken?: string }} [authorization] - تذكرة القرار من نقطة التفويض؛ لازمة لكل فعل محكوم (M4.05)
   * @returns {Promise<Readonly<Task>>} صورة مُجمَّدة من المهمة بعد نجاحها
   */
  async submit(command, signature, handler, authorization = {}) {
    // الإيقاف الشامل أولاً: قرارٌ سيادي دائم يعلو على الوضع الآمن المحلي.
    if (this.haltSwitch) this.haltSwitch.assertOperational();
    this.safeMode.assertOperational();
    if (typeof handler !== 'function') throw new Error('TASK_HANDLER_REQUIRED');
    // التفويض يُفحص **قبل** قبول التاج: أمرٌ لن يُنفَّذ لا يجوز أن يُحرق معرّفه
    // في دفتر الأوامر، فيبقى قابلاً للإصدار من جديد بعد الحصول على تذكرة.
    this.assertAuthorized(command, authorization);
    const accepted = this.crown.command(command, signature);
    /** @type {Task} */
    const task = {
      id: randomUUID(),
      command: accepted,
      state: TaskState.QUEUED,
      createdAt: new Date().toISOString(),
    };
    this.tasks.set(task.id, task);
    this.log.append('kernel.task.queued', accepted.target, {
      taskId: task.id,
      action: accepted.action,
    });
    try {
      // فحصٌ ثانٍ قبل تشغيل المُعالِج مباشرة: بين قبول التاج وبدء الفعل نافذةٌ
      // زمنية قد يصدر فيها إيقاف، وضيقُها لا يعني انعدامها. والفعل هو المُعالِج
      // لا الإدراج في الطابور، فمنعُه هنا هو المقصود بـ«صفر تنفيذ بعد الإيقاف».
      if (this.haltSwitch) this.haltSwitch.assertOperational();
      transitionKernelTask(task, TaskState.RUNNING);
      task.startedAt = new Date().toISOString();
      this.log.append('kernel.task.started', accepted.target, { taskId: task.id });
      // **تحويلٌ إلى اللاتزامن (`M5.01`)**: كانت النواة تنتظر مُعالِجاً متزامناً
      // وحده، فمُعالِجٌ يُعيد وعداً كان «ينجح» قبل أن يعمل، وفشلُه بعد ذلك يقع
      // خارج المهمة فلا يُسجَّل ولا يُقرأ. والانتظار هنا هو ما يجعل حالة المهمة
      // خبراً عن العمل لا عن إقلاعه.
      const result = await handler(accepted);
      transitionKernelTask(task, TaskState.SUCCEEDED);
      task.result = result;
      task.finishedAt = new Date().toISOString();
      this.log.append('kernel.task.succeeded', accepted.target, { taskId: task.id });
      return snapshot(task);
    } catch (error) {
      // الفشل يُسجَّل من أي حالة سابقة مشروعة؛ ولو كان الانتقال إلى «فاشلة» نفسه
      // محرَّماً (كأن تكون المهمة قد انتهت) فالخطأ الأصلي يُعاد ولا يُستبدل بخطأ
      // دورة حياة يحجب سببه.
      try {
        transitionKernelTask(task, TaskState.FAILED);
      } catch {
        task.state = TaskState.FAILED;
      }
      task.error = error instanceof Error ? error.message : String(error);
      task.finishedAt = new Date().toISOString();
      this.log.append('kernel.task.failed', accepted.target, {
        taskId: task.id,
        error: task.error,
      });
      throw error;
    }
  }
  /**
   * يمنع المسار الجانبي: كل فعل محكوم يلزمه تذكرة قرار صادرة من نقطة التفويض
   * ومربوطة بنفس الفاعل والفعل والمورد. وغيابُ النقطة رفضٌ لا استثناء.
   *
   * وهذا **تضييقٌ معلَن في السلوك** (حدٌّ معلن): نواةٌ كانت تنفّذ `change-policy`
   * بأمر موقّع وحده صارت ترفضه بلا تذكرة. والأفعال غير المحكومة لم يتغيّر مسارها.
   * @param {RoyalCommand} command
   * @param {{ decisionToken?: string }} authorization
   * @returns {void}
   */
  assertAuthorized(command, authorization) {
    if (!this.governedActions.has(command.action)) return;
    // فعلٌ محكوم ونقطة التفويض غير موصولة ← رفضٌ مغلق (المادة 9). لا مسار
    // جانبي ولا وضع توافقي يسمح بالتنفيذ بلا قرار.
    if (this.enforcement === null) throw new Error('AUTHORIZATION_POINT_REQUIRED');
    const binding = {
      actorId: this.actorOf(command),
      action: command.action,
      resourceKey: command.target,
      // ربطُ الأمرِ الملكيِّ (`GPT-F06`): النواةُ تُقدّمُ معرّفَ الأمرِ الفعليِّ
      // وملخصَه فتُقارَنُ بالتذكرة. تذكرةٌ صدرتْ لأمرٍ آخرَ — ولو طابقَ الفاعلَ
      // والفعلَ والموردَ — تُرفَضُ هنا قبلَ استهلاكِها والتنفيذ.
      royalCommandId: command.id,
      royalCommandDigest: royalCommandDigest(command),
    };
    const verified = this.enforcement.verify(authorization.decisionToken, binding);
    this.log.append('kernel.authorization.verified', binding.actorId, {
      action: command.action,
      target: command.target,
      policyId: verified.policyId,
    });
  }

  /**
   * الفاعل هو صاحب الشهادة إن حملها الأمر، وإلا التاج. والتذكرة مربوطة بهذا
   * المعرّف نفسه، فتذكرةُ فاعلٍ لا تُنفَّذ بأمر فاعلٍ آخر.
   * @param {RoyalCommand} command
   * @returns {string}
   */
  actorOf(command) {
    const certificate = /** @type {{ subject?: unknown, id?: unknown } | undefined} */ (
      command.certificate
    );
    if (certificate !== undefined) {
      if (typeof certificate.subject === 'string') return certificate.subject;
      if (typeof certificate.id === 'string') return certificate.id;
    }
    return 'crown';
  }

  /**
   * إيقاف طارئ: يُدخل الوضع الآمن ويُسجّل السبب.
   *
   * R6-A-08: كانَ الفاعلُ ثابتاً (`crown`) لا يُمرَّر. صارَ يُمرَّرُ اختياريّاً،
   * والمنادي مسؤولٌ عن تمريرِه — والمنادي الإنتاجيُّ يُمرِّرُ هويةَ الفاعلِ الآمرة.
   * @param {string} [reason='kernel emergency stop']
   * @param {string} [actorId='crown'] - هويةُ الفاعلِ الآمرِ بالإيقافِ (R6-A-08)
   * @returns {void}
   */
  stop(reason = 'kernel emergency stop', actorId = 'crown') {
    // `WL-302`: نصُّ فاعلٍ (`'crown'`) ليس سلطةً. في الإنتاجِ يُرفَضُ هذا المسارُ،
    // والوضعُ الآمنُ يُدخَلُ بـ`enterSafeMode` بأمرٍ ملكيٍّ موقَّعٍ عبرَ `HaltSwitch`.
    if (this.production) throw new Error('KERNEL_SAFE_MODE_REQUIRES_ROYAL_COMMAND');
    this.safeMode.enter(reason);
    this.log.append('kernel.safe-mode.entered', actorId, { reason });
  }
  /**
   * يستأنف التنفيذ ويُخرجُ من الوضع الآمن.
   *
   * R6-A-08: كانَ الفاعلُ ثابتاً (`crown`) لا يُمرَّر. صارَ يُمرَّرُ اختياريّاً.
   * @param {string} [actorId='crown'] - هويةُ الفاعلِ الآمرِ بالاستئنافِ (R6-A-08)
   * @returns {void}
   */
  resume(actorId = 'crown') {
    if (this.production) throw new Error('KERNEL_SAFE_MODE_REQUIRES_ROYAL_COMMAND');
    this.safeMode.leave();
    this.log.append('kernel.safe-mode.left', actorId, {});
  }

  /**
   * `WL-302`: دخولُ الوضعِ الآمنِ بسلطةٍ مُثبَتةٍ لا بنصِّ فاعل: أمرٌ ملكيٌّ
   * موقَّعٌ يتحقّقُ منه `HaltSwitch` (‏التوقيعُ، ثمّ العملُ والعهدُ والحداثةُ
   * والسبب)، فيصيرُ الإيقافُ توجيهاً دائماً يقرؤه `submit` قبلَ كلِّ فعلٍ ويصمدُ
   * لإعادةِ التشغيل، وكلُّ رفضٍ يُسجَّلُ في سجلِّ المفتاح.
   * @param {string} reason - السببُ المختومُ في الأمر
   * @param {unknown} command - الأمرُ الملكيُّ الموقَّع
   * @returns {Promise<unknown>} التوجيهُ الصادر
   */
  async enterSafeMode(reason, command) {
    const halt = this.#sovereignHaltSwitch();
    return halt.asyncSigner ? halt.haltAsync(reason, command) : halt.halt(reason, command);
  }

  /**
   * `WL-302`: الخروجُ من الوضعِ الآمنِ بالشرطِ نفسِه، وبشرطِ إقرارِ العقدِ الحيّة.
   * @param {string} reason - السببُ المختومُ في الأمر
   * @param {unknown} command - الأمرُ الملكيُّ الموقَّع
   * @returns {Promise<unknown>} التوجيهُ الصادر
   */
  async leaveSafeMode(reason, command) {
    const halt = this.#sovereignHaltSwitch();
    return halt.asyncSigner ? halt.resumeAsync(reason, command) : halt.resume(reason, command);
  }

  /**
   * مفتاحُ الإيقافِ الدائمُ بمساريه غيرِ المتزامنَين — وغيابُه رفضٌ.
   * والتوقيعُ في التوكنِ غيرُ متزامنٍ، والموقِّعُ البرمجيُّ (‏تطويرٌ) متزامن.
   * @returns {{ asyncSigner: boolean, halt: (reason: string, command: unknown) => unknown, resume: (reason: string, command: unknown) => unknown, haltAsync: (reason: string, command: unknown) => Promise<unknown>, resumeAsync: (reason: string, command: unknown) => Promise<unknown> }}
   */
  #sovereignHaltSwitch() {
    const candidate = /** @type {any} */ (this.haltSwitch);
    if (
      candidate === null ||
      typeof candidate.haltAsync !== 'function' ||
      typeof candidate.resumeAsync !== 'function'
    ) {
      throw new Error('KERNEL_SAFE_MODE_HALT_SWITCH_REQUIRED');
    }
    const asyncSigner = typeof candidate.king?.signAsync === 'function';
    return {
      asyncSigner,
      halt: (reason, command) => candidate.halt(reason, command),
      resume: (reason, command) => candidate.resume(reason, command),
      haltAsync: (reason, command) => candidate.haltAsync(reason, command),
      resumeAsync: (reason, command) => candidate.resumeAsync(reason, command),
    };
  }
  /**
   * @param {string} id - معرّف المهمة
   * @returns {Readonly<Task> | null} صورة مُجمَّدة، أو null إن لم توجد المهمة
   */
  getTask(id) {
    const task = this.tasks.get(id);
    return task ? snapshot(task) : null;
  }
}
