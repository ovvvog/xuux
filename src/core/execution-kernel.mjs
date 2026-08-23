import { randomUUID } from 'node:crypto';
import { snapshot } from '../lib/snapshot.mjs';
import { loadGovernedActions } from '../policy/governed.mjs';

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
   * @param {{ crown?: CrownGateway, log?: EventLog, policy?: PolicyEngine | null, haltSwitch?: HaltGuard | null, enforcement?: import('../policy/enforcement-point.mjs').EnforcementPoint | null }} [deps]
   */
  constructor({ crown, log, policy = null, haltSwitch = null, enforcement = null } = {}) {
    if (!crown || !log) throw new Error('KERNEL_DEPENDENCY_MISSING');
    this.crown = crown;
    this.log = log;
    this.policy = policy;
    this.haltSwitch = haltSwitch;
    this.enforcement = enforcement;
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
   * @param {(command: AcceptedRoyalCommand) => unknown} handler - المُنفِّذ الفعلي
   * @param {{ decisionToken?: string }} [authorization] - تذكرة القرار من نقطة التفويض؛ لازمة لكل فعل محكوم (M4.05)
   * @returns {Readonly<Task>} صورة مُجمَّدة من المهمة بعد نجاحها
   */
  submit(command, signature, handler, authorization = {}) {
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
      task.state = TaskState.RUNNING;
      task.startedAt = new Date().toISOString();
      this.log.append('kernel.task.started', accepted.target, { taskId: task.id });
      const result = handler(accepted);
      task.state = TaskState.SUCCEEDED;
      task.result = result;
      task.finishedAt = new Date().toISOString();
      this.log.append('kernel.task.succeeded', accepted.target, { taskId: task.id });
      return snapshot(task);
    } catch (error) {
      task.state = TaskState.FAILED;
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
   * @param {string} [reason='kernel emergency stop']
   * @returns {void}
   */
  stop(reason = 'kernel emergency stop') {
    this.safeMode.enter(reason);
    this.log.append('kernel.safe-mode.entered', 'crown', { reason });
  }
  resume() {
    this.safeMode.leave();
    this.log.append('kernel.safe-mode.left', 'crown', {});
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
