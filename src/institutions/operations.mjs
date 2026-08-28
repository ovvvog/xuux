/**
 * وحدةُ التشغيل المؤسسي: مهمّةٌ تُستقبَل، وكيلٌ يُسنَد، ميزانيةٌ تُقيَّد، أثرٌ
 * يُقاس، تقريرٌ يُشتقّ — الخطوة M8.05
 *
 * **العيبُ الذي يُغلقه هذا الملف:** المؤسساتُ في هذه الدولة كانت 143 اسماً في
 * `seed/institutions.yaml` كلُّها `status: planned`، و`src/registry/loader.mjs`
 * يقرؤها إلى خريطةٍ في الذاكرة يُقاس صدقُها بعدّادها وتفرُّدِ مساراتها. فلم يكن
 * في المستودع مؤسسةٌ **تعمل**: لا مهمّةَ تُستقبَل، ولا وكيلَ يُسنَد إليه عمل،
 * ولا ميزانيةَ تُستهلَك، ولا تقريرَ يُنتج. وكلُّ ما بعد ذلك — الاختصاصُ
 * والمساءلةُ والتفويضُ — يقف على شيءٍ لم يقع.
 *
 * والمسارُ هنا مرتَّبٌ بترتيبٍ مقصود، وكلُّ خطوةٍ منه لها رمزُ رفضٍ مُعلَنٌ في
 * `config/institutions.yaml`:
 *
 *   1. `commission` — المؤسسةُ تُؤسَّس مرّةً واحدةً بمُخصَّصٍ **مقروءٍ من عهد
 *      التشغيل** لا مُمرَّرٍ من المستدعي، فلا تُنفَخ ميزانيةٌ بنداء.
 *   2. `submit` — المهمّةُ من نوعٍ مُعلَنٍ لهذه المؤسسةِ بعينها، وموضوعُها يبلغ
 *      الحدَّ المُعلَن.
 *   3. `assign` — الوكيلُ صفٌّ قائمٌ في سجلِّ الهويات، حالتُه نشطةٌ ودورُه من
 *      أدوار المؤسسة. يُقرأ من السجل لا يُمرَّر وصفُه في وسيط.
 *   4. `execute` — **الميزانيةُ تُقيَّد قبل التنفيذ**، ثم تُقرأ بصمةُ مخزنِ
 *      المخرجات، ثم يُنتج المنفِّذُ مخرَجَه، ثم تُقرأ البصمةُ ثانياً. وبصمتان
 *      متساويتان تعني تنفيذاً بلا أثر: تُرفض المهمّةُ ويُسجَّل رفضُها، ولا يُردّ
 *      المقيَّد.
 *   5. `report` — التقريرُ **مُشتقٌّ** من الصفوف المحفوظة: لا نصَّ يُخزَّن ثم
 *      يُقرأ تقريراً، فنصٌّ مخزَّنٌ يُكتب مرّةً ويصدق مرّةً.
 *
 * **وحدٌّ معلَن أول:** ذرّيةُ الميزانية هي ذرّيةُ التحديث المتفائل على `version`
 * في صفِّ المؤسسة، لا معاملةٌ واحدةٌ تضمّ القيدَ والتنفيذَ. فلو أخفق الإنتاجُ
 * بعد القيد بقي المقيَّدُ مقيَّداً — وهذا **مقصودٌ ومُعلَنٌ** في
 * `budget.refundOnIneffectiveExecution: false`: المحاولةُ استهلكت المورد فعلاً.
 * وتوحيدُ هذا مع دفتر الحصص الذرّي في `src/policy/quota.mjs` مسجَّلٌ في
 * `docs/REMAINING_WORK.md`.
 *
 * **وحدٌّ معلَن ثانٍ:** حدودُ اختصاص المؤسسة ومساءلتُها وتقاريرُها الدوريةُ
 * كبياناتٍ حاكمةٍ هي الخطوةُ `M8.06`، وليست في هذا الملف. وما يُقاس هنا هو
 * **دورةُ التشغيل** لا حدُّ الاختصاص: أنواعُ المهام مُعلَنةٌ لكلِّ مؤسسةٍ، وهذا
 * أضيقُ من «اختصاصٍ» بالمعنى الحاكم ولا يُدَّعى أنّه هو.
 *
 * **وحدٌّ معلَن ثالث:** الأفعالُ هنا لا تمرّ بنقطة التفويض
 * (`src/policy/enforcement-point.mjs`) لأنّها ليست من الأفعال المحكومة المُعلَنة
 * في `config/policies.yaml`. والفصلُ المُنفَّذ فصلُ **أدوارٍ** مقروءٌ من عهد
 * التشغيل، وهو أضعفُ من التفويض الكامل. ورفعُ أفعال التشغيل المؤسسي إلى
 * الكتالوج المحكوم مسجَّلٌ في `docs/REMAINING_WORK.md`.
 */

import {
  INSTITUTION_ERRORS,
  InstitutionError,
  pilotOf,
  rolesFor,
  taskKindOf,
} from './institutions.mjs';

/**
 * أنواعُ حوادثِ التشغيل المؤسسي. وكلُّ نوعٍ هنا عقدٌ في قناة `institutions` من
 * `config/events.yaml`، والبوابةُ 21 تحرس التقابل.
 */
export const INSTITUTION_EVENTS = Object.freeze({
  COMMISSIONED: 'institutions.institution.commissioned',
  RECEIVED: 'institutions.task.received',
  ASSIGNED: 'institutions.task.assigned',
  DEBITED: 'institutions.budget.debited',
  EXECUTED: 'institutions.task.executed',
  REFUSED: 'institutions.task.refused',
  REPORTED: 'institutions.report.produced',
});

/**
 * @param {unknown} record
 * @param {string} key
 * @returns {unknown}
 */
function read(record, key) {
  return /** @type {Record<string, unknown>} */ (record ?? {})[key];
}

/**
 * @param {unknown} record
 * @param {string} key
 * @returns {number}
 */
function readInt(record, key) {
  const value = read(record, key);
  return typeof value === 'number' ? value : 0;
}

/**
 * @param {unknown} record
 * @param {string} key
 * @returns {string}
 */
function readText(record, key) {
  const value = read(record, key);
  return typeof value === 'string' ? value : '';
}

/** التشغيلُ المؤسسي النافذ. */
export class InstitutionOperations {
  /**
   * @param {object} deps
   * @param {import('./institutions.mjs').InstitutionsPolicy} deps.policy عهدُ التشغيل المُحمَّل.
   * @param {import('../root-of-trust/event-log.mjs').EventLog} deps.log
   * @param {import('../persistence/repository-memory.mjs').Repository} deps.institutions
   * @param {import('../persistence/repository-memory.mjs').Repository} deps.tasks
   * @param {import('../persistence/repository-memory.mjs').Repository} deps.outputs
   * @param {import('../identity/agent-registry.mjs').AgentRegistry} deps.agents
   * @param {Map<string, import('./executors.mjs').InstitutionEffectExecutor>} deps.effects
   * @param {() => Date} [deps.now]
   */
  constructor({ policy, log, institutions, tasks, outputs, agents, effects, now }) {
    if (!policy) throw new Error('INSTITUTION_POLICY_REQUIRED');
    if (!log) throw new Error('INSTITUTION_EVENT_LOG_REQUIRED');
    if (!institutions || !tasks || !outputs) throw new Error('INSTITUTION_REPOSITORY_REQUIRED');
    // سجلُ الهويات لازمٌ لا اختياري: بلا سجلٍّ لا يُقرأ دورُ الوكيل ولا حالتُه،
    // فيصير الإسنادُ اسماً في عمود — وهو العيبُ الذي تُغلقه هذه الخطوة.
    if (!agents) throw new Error('INSTITUTION_AGENT_REGISTRY_REQUIRED');
    if (!effects) throw new Error('INSTITUTION_EFFECT_INDEX_REQUIRED');
    this.policy = policy;
    this.log = log;
    this.institutions = institutions;
    this.tasks = tasks;
    this.outputs = outputs;
    this.agents = agents;
    this.effects = effects;
    this.now = now ?? (() => new Date());
  }

  /**
   * يتحقّق أنّ الدورَ يملك الفعلَ في عهد التشغيل.
   * @param {import('./institutions.mjs').InstitutionalAct} act
   * @param {string} role
   * @returns {void}
   */
  #permit(act, role) {
    const holders = rolesFor(this.policy, act);
    if (!holders.has(role)) {
      throw new InstitutionError(
        INSTITUTION_ERRORS.ROLE_NOT_PERMITTED,
        `الدور ${role} لا يملك الفعل ${act}؛ وحاملوه المُعلَنون: ${[...holders].join('، ')}.`,
      );
    }
  }

  /**
   * صفُّ المؤسسة بمفتاحها، أو رفضٌ إن لم تُؤسَّس.
   * @param {string} key
   * @returns {Promise<import('../persistence/entities.mjs').EntityRecord>}
   */
  async #commissioned(key) {
    // `pilotOf` أولاً: مفتاحٌ لا عهدَ له يُرفض برمزه الخاص لا برمز «لم تُؤسَّس»،
    // فالرمزان يفرِّقان بين مؤسسةٍ لا وجودَ لها ومؤسسةٍ لم يُفتح لها صفٌّ بعد.
    pilotOf(this.policy, key);
    const [row] = await this.institutions.list({ filter: { key }, limit: 1 });
    if (row === undefined) {
      throw new InstitutionError(
        INSTITUTION_ERRORS.NOT_COMMISSIONED,
        `المؤسسة ${key} لم تُؤسَّس بعد؛ ولا تُستقبَل مهمّةٌ ولا يُستخرَج تقريرٌ قبل تخصيصِ ميزانيةٍ في صفٍّ محفوظ.`,
      );
    }
    return row;
  }

  /**
   * يُؤسِّس المؤسسةَ ويُخصِّص ميزانيتَها من عهد التشغيل.
   *
   * والمُخصَّصُ مقروءٌ من الوثيقة لا مُمرَّرٌ في وسيط: مُخصَّصٌ يأتي من المستدعي
   * يجعل حدَّ الميزانية حدَّ من ينفّذ لا حدَّ الدولة. والتأسيسُ فعلٌ سياديٌّ خارج
   * الأفعال التشغيلية الأربعة، فيُنشر باسم التاج.
   * @param {{ key: string }} input
   * @returns {Promise<import('../persistence/entities.mjs').EntityRecord>}
   */
  async commission({ key }) {
    const pilot = pilotOf(this.policy, key);
    const existing = await this.institutions.list({ filter: { key }, limit: 1 });
    if (existing.length > 0) {
      throw new InstitutionError(
        INSTITUTION_ERRORS.ALREADY_COMMISSIONED,
        `المؤسسة ${key} مُؤسَّسةٌ فعلاً؛ وتأسيسٌ ثانٍ يُعيد الميزانيةَ إلى مقدارها الأول فيمحو ما استُهلك.`,
      );
    }
    const record = await this.institutions.insert({
      id: `inst:${pilot.seedId}`,
      key: pilot.key,
      seedId: pilot.seedId,
      name: pilot.name,
      agentRoles: [...pilot.agentRoles],
      budgetResource: this.policy.budget.resource,
      budgetAllocated: pilot.budget.allocation,
      budgetConsumed: 0,
      charterVersion: this.policy.version,
      commissionedAt: this.now(),
    });
    this.log.append('institutions.institution.commissioned', 'role:king', {
      id: String(record['id']),
      key: pilot.key,
      allocation: pilot.budget.allocation,
      seedId: pilot.seedId,
      resource: this.policy.budget.resource,
    });
    return record;
  }

  /**
   * يستقبل مهمّةً من نوعٍ مُعلَنٍ لهذه المؤسسة.
   * @param {{ id: string, institutionKey: string, kind: string, subject: string, submittedBy: string, actorRole: string }} input
   * @returns {Promise<import('../persistence/entities.mjs').EntityRecord>}
   */
  async submit({ id, institutionKey, kind, subject, submittedBy, actorRole }) {
    this.#permit('submit', actorRole);
    const institution = await this.#commissioned(institutionKey);
    const pilot = pilotOf(this.policy, institutionKey);
    const taskKind = taskKindOf(pilot, kind);
    // حدُّ الموضوع مقروءٌ من الوثيقة، ونفسُ الحدِّ ثابتٌ في `entities.mjs` وقيدٌ
    // في الهجرة 0014. والرفضُ هنا يحمل رمزَه المُعلَن كي يُقرأ في القناة رفضَ
    // شرطٍ لا انهيارَ مواصفة.
    if (subject.trim().length < this.policy.procedure.minSubjectLength) {
      throw new InstitutionError(
        INSTITUTION_ERRORS.SUBJECT_TOO_SHORT,
        `موضوعُ المهمّة ${subject.trim().length} حرفاً والحدُّ المُعلَن ${this.policy.procedure.minSubjectLength}.`,
      );
    }
    const record = await this.tasks.insert({
      id,
      institutionId: String(institution['id']),
      kind,
      subject,
      submittedBy,
      state: 'received',
      receivedAt: this.now(),
      budgetCost: taskKind.cost,
    });
    this.log.append('institutions.task.received', 'role:minister', {
      id,
      institutionId: String(institution['id']),
      kind,
      cost: taskKind.cost,
      subjectLength: subject.trim().length,
    });
    return record;
  }

  /**
   * صفُّ المهمّة بمعرِّفها، أو رفضٌ برمزٍ مُعلَن.
   * @param {string} taskId
   * @returns {Promise<import('../persistence/entities.mjs').EntityRecord>}
   */
  async #task(taskId) {
    const row = await this.tasks.findById(taskId);
    if (row === null) {
      throw new InstitutionError(
        INSTITUTION_ERRORS.TASK_NOT_FOUND,
        `لا مهمّةَ بالمعرِّف ${taskId}؛ ومعرِّفٌ مجهولٌ رفضٌ لا فراغ.`,
      );
    }
    return row;
  }

  /**
   * يُسنِد المهمّةَ إلى وكيلٍ مؤهَّل.
   *
   * والتأهيلُ مقروءٌ من سجلِّ الهويات: حالةُ الوكيل ودورُه لا يُمرَّران في وسيط،
   * فوسيطٌ يوصف به الوكيلُ يجعل «الوكيل النشط» ادّعاءَ من يُسنِد.
   * @param {{ taskId: string, agentId: string, actorRole: string }} input
   * @returns {Promise<import('../persistence/entities.mjs').EntityRecord>}
   */
  async assign({ taskId, agentId, actorRole }) {
    this.#permit('assign', actorRole);
    const task = await this.#task(taskId);
    if (task['state'] !== 'received') {
      throw new InstitutionError(
        INSTITUTION_ERRORS.TASK_STATE_INVALID,
        `المهمّة ${taskId} حالتُها ${readText(task, 'state')} ولا تُسنَد إلا مهمّةٌ مُستقبَلة.`,
      );
    }
    const institution = await this.institutions.findById(String(task['institutionId']));
    if (institution === null) {
      throw new InstitutionError(
        INSTITUTION_ERRORS.NOT_COMMISSIONED,
        `المهمّة ${taskId} تُحيل إلى مؤسسةٍ لا صفَّ لها؛ وإسنادٌ إلى مؤسسةٍ غيرِ مُؤسَّسةٍ عملٌ بلا ميزانية.`,
      );
    }
    const agent = await this.agents.get(agentId);
    if (agent === null) {
      throw new InstitutionError(
        INSTITUTION_ERRORS.AGENT_NOT_ELIGIBLE,
        `الوكيل ${agentId} لا صفَّ له في سجلِّ الهويات؛ واسمُ وكيلٍ في عمودٍ ليس وكيلاً.`,
      );
    }
    if (readText(agent, 'state') !== 'active') {
      throw new InstitutionError(
        INSTITUTION_ERRORS.AGENT_NOT_ELIGIBLE,
        `الوكيل ${agentId} حالتُه ${readText(agent, 'state')} لا نشطة؛ ووكيلٌ معلَّقٌ أو ملغىً لا يُسنَد إليه عمل.`,
      );
    }
    const roles = read(institution, 'agentRoles');
    const role = readText(agent, 'role');
    if (!Array.isArray(roles) || !roles.includes(role)) {
      throw new InstitutionError(
        INSTITUTION_ERRORS.AGENT_NOT_ELIGIBLE,
        `دورُ الوكيل ${role} ليس من أدوار المؤسسة ${readText(institution, 'key')} المُعلَنة.`,
      );
    }
    const updated = await this.tasks.update(taskId, readInt(task, 'version'), {
      state: 'assigned',
      agentId,
      assignedAt: this.now(),
    });
    this.log.append('institutions.task.assigned', 'role:operator', {
      id: taskId,
      institutionId: String(task['institutionId']),
      agentId,
      role,
    });
    return updated;
  }

  /**
   * يُسجِّل رفضَ المهمّةِ في صفِّها وينشره.
   *
   * والرفضُ **يُحفظ** لا يُرمى وحده: مهمّةٌ رُفضت ولم يُسجَّل رفضُها تُقرأ في
   * التقرير «مُستقبَلةً» فيُوهم بعملٍ ينتظر وهو عملٌ سقط.
   * @param {import('../persistence/entities.mjs').EntityRecord} task
   * @param {string} code
   * @param {string} reason
   * @returns {Promise<never>}
   */
  async #refuse(task, code, reason) {
    const taskId = String(task['id']);
    await this.tasks.update(taskId, readInt(task, 'version'), {
      state: 'refused',
      refusalCode: code,
      refusalReason: reason,
      refusedAt: this.now(),
    });
    this.log.append('institutions.task.refused', 'role:operator', {
      id: taskId,
      reason: code,
      institutionId: readText(task, 'institutionId'),
    });
    throw new InstitutionError(code, reason);
  }

  /**
   * يُنفِّذ المهمّةَ: قيدُ الميزانيةِ أولاً، ثم إنتاجٌ يُقاس أثرُه بالبصمتين.
   * @param {{ taskId: string, actorRole: string }} input
   * @returns {Promise<import('../persistence/entities.mjs').EntityRecord>}
   */
  async execute({ taskId, actorRole }) {
    this.#permit('execute', actorRole);
    const task = await this.#task(taskId);
    if (task['state'] !== 'assigned') {
      throw new InstitutionError(
        INSTITUTION_ERRORS.TASK_STATE_INVALID,
        `المهمّة ${taskId} حالتُها ${readText(task, 'state')} ولا تُنفَّذ إلا مهمّةٌ مُسنَدة.`,
      );
    }
    const institutionId = String(task['institutionId']);
    const institution = await this.institutions.findById(institutionId);
    if (institution === null) {
      throw new InstitutionError(
        INSTITUTION_ERRORS.NOT_COMMISSIONED,
        `المهمّة ${taskId} تُحيل إلى مؤسسةٍ لا صفَّ لها؛ وتنفيذٌ بلا صفِّ مؤسسةٍ تنفيذٌ بلا ميزانيةٍ تُقيَّد.`,
      );
    }
    const pilot = pilotOf(this.policy, readText(institution, 'key'));
    const taskKind = taskKindOf(pilot, readText(task, 'kind'));
    const executor = this.effects.get(taskKind.effect);
    if (executor === undefined) {
      // الرفضُ يُسجَّل ولا يُرمى وحده: أثرٌ بلا منفِّذٍ عيبُ تركيبٍ يجب أن يُقرأ
      // في صفِّ المهمّة لا أن يبقى في سجلٍّ يُنسى.
      return this.#refuse(
        task,
        INSTITUTION_ERRORS.EFFECT_NOT_REGISTERED,
        `الأثر ${taskKind.effect} مُعلَنٌ في عهد التشغيل ولا منفِّذَ مُسجَّلٌ باسمه؛ واسمُ أثرٍ في وثيقةٍ ليس يداً تُحدثه.`,
      );
    }

    // ── قيدُ الميزانية قبل التنفيذ ──
    const cost = readInt(task, 'budgetCost');
    const allocated = readInt(institution, 'budgetAllocated');
    const consumed = readInt(institution, 'budgetConsumed');
    if (consumed + cost > allocated) {
      return this.#refuse(
        task,
        INSTITUTION_ERRORS.BUDGET_EXHAUSTED,
        `ميزانيةُ المؤسسة ${readText(institution, 'key')} نفدت: المُخصَّص ${allocated} والمقيَّد ${consumed} وكلفةُ المهمّة ${cost}؛ ونفادُ الميزانية يوقف المهمّةَ قبل أن تبدأ.`,
      );
    }
    // التحديثُ المتفائل هو الحاجز: محاولتان متزامنتان تنجح إحداهما وتُخفق
    // الأخرى بتعارض النسخة، فلا يمرّ القيدان معاً على قراءةٍ واحدة.
    const debited = await this.institutions.update(institutionId, readInt(institution, 'version'), {
      budgetConsumed: consumed + cost,
    });
    const afterDebit = await this.tasks.update(taskId, readInt(task, 'version'), {
      budgetDebitedAt: this.now(),
    });
    this.log.append('institutions.budget.debited', 'role:operator', {
      institutionId,
      taskId,
      cost,
      remaining: readInt(debited, 'budgetAllocated') - readInt(debited, 'budgetConsumed'),
      resource: readText(debited, 'budgetResource'),
    });

    // ── الإنتاجُ وقياسُ أثره ──
    const agentId = readText(afterDebit, 'agentId');
    const before = await executor.fingerprint(institutionId);
    const outputId = await executor.produce({
      institutionId,
      taskId,
      kind: readText(afterDebit, 'kind'),
      subject: readText(afterDebit, 'subject'),
      agentId,
    });
    const after = await executor.fingerprint(institutionId);
    if (before === after) {
      return this.#refuse(
        afterDebit,
        INSTITUTION_ERRORS.EXECUTION_INEFFECTIVE,
        `تنفيذُ المهمّة ${taskId} لم يُغيِّر بصمةَ مخزنِ المخرجات (${before})؛ وتنفيذٌ بلا أثرٍ لا يُسجَّل منفَّذاً، والمقيَّدُ لا يُردّ.`,
      );
    }
    const executed = await this.tasks.update(taskId, readInt(afterDebit, 'version'), {
      state: 'executed',
      effect: taskKind.effect,
      outputId,
      fingerprintBefore: before,
      fingerprintAfter: after,
      executedAt: this.now(),
    });
    this.log.append('institutions.task.executed', 'role:operator', {
      id: taskId,
      institutionId,
      effect: taskKind.effect,
      outputId,
      agentId,
    });
    return executed;
  }

  /**
   * @typedef {Readonly<{
   *   institution: Readonly<{ id: string, key: string, name: string, seedId: string }>,
   *   budget: Readonly<{ resource: string, allocated: number, consumed: number, remaining: number }>,
   *   tasks: Readonly<{ total: number, received: number, assigned: number, executed: number, refused: number }>,
   *   outputs: Readonly<{ count: number, ids: readonly string[] }>,
   *   refusals: readonly Readonly<{ taskId: string, code: string }>[],
   *   producedAt: Date,
   * }>} InstitutionReport
   */

  /**
   * يستخرج تقريرَ المؤسسةِ **مشتقّاً** من صفوفها المحفوظة.
   *
   * ولا نصَّ يُخزَّن ثم يُقرأ تقريراً: نصٌّ مخزَّنٌ يُكتب مرّةً ويصدق مرّةً، ثم
   * تتغيّر الصفوفُ ويبقى النصُّ يُقرأ حقيقةً. وكلُّ رقمٍ هنا محسوبٌ عند الطلب من
   * `institution_tasks` و`institution_outputs` وصفِّ المؤسسة.
   * @param {{ institutionKey: string, actorRole: string }} input
   * @returns {Promise<InstitutionReport>}
   */
  async report({ institutionKey, actorRole }) {
    this.#permit('report', actorRole);
    const institution = await this.#commissioned(institutionKey);
    const institutionId = String(institution['id']);
    const rows = await this.tasks.list({ filter: { institutionId } });
    if (rows.length === 0) {
      throw new InstitutionError(
        INSTITUTION_ERRORS.REPORT_EMPTY,
        `المؤسسة ${institutionKey} لم تستقبل مهمّةً واحدة؛ وتقريرٌ عن صفرِ عملٍ يوهم بعملٍ لم يقع.`,
      );
    }
    const outputRows = await this.outputs.list({ filter: { institutionId } });
    /** @param {string} state */
    const countOf = (state) => rows.filter((row) => row['state'] === state).length;
    const allocated = readInt(institution, 'budgetAllocated');
    const consumed = readInt(institution, 'budgetConsumed');
    /** @type {Array<{ taskId: string, code: string }>} */
    const refusals = rows
      .filter((row) => row['state'] === 'refused')
      .map((row) => ({ taskId: String(row['id']), code: readText(row, 'refusalCode') }));
    const report = Object.freeze({
      institution: Object.freeze({
        id: institutionId,
        key: institutionKey,
        name: readText(institution, 'name'),
        seedId: readText(institution, 'seedId'),
      }),
      budget: Object.freeze({
        resource: readText(institution, 'budgetResource'),
        allocated,
        consumed,
        remaining: allocated - consumed,
      }),
      tasks: Object.freeze({
        total: rows.length,
        received: countOf('received'),
        assigned: countOf('assigned'),
        executed: countOf('executed'),
        refused: countOf('refused'),
      }),
      outputs: Object.freeze({
        count: outputRows.length,
        ids: Object.freeze(outputRows.map((row) => String(row['id']))),
      }),
      refusals: Object.freeze(refusals.map((entry) => Object.freeze(entry))),
      producedAt: this.now(),
    });
    this.log.append('institutions.report.produced', 'role:auditor', {
      institutionId,
      tasks: rows.length,
      outputs: outputRows.length,
      consumed,
      remaining: allocated - consumed,
    });
    return report;
  }
}
