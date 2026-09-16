import { randomUUID } from 'node:crypto';
import { snapshot } from '../lib/snapshot.mjs';
import { MEMORY_SPEC } from '../persistence/entities.mjs';
import {
  MEMORY_KINDS,
  MEMORY_LIMIT_ERRORS,
  MemoryIsolationMonitor,
  MemoryLimitError,
  loadMemoryPolicy,
  storedBytesOf,
} from './memory-limits.mjs';
import {
  PURGE_DATA_ACTION,
  assertRoyalCommandForPurge,
  loadPurgeAuthority,
} from './purge-authority.mjs';

// الأنواع المستوردة تُكتب بصيغة `import(...)` مباشرة في مواضعها ولا تُسمّى بأسماء
// محلية: هذه الوحدة تُعاد تصديرها مع فهرس البيانات في src/data/index.mjs، وتسمية
// نفس النوع في الملفين تُنتج تصديرين متنازعين لاسم واحد.

/**
 * مخزن ذاكرة الوكلاء — صار **دائماً** في الخطوة `M3.05`.
 *
 * والقاعدة تفرض ما كان اتفاقاً: `agent_id` مرجعٌ إلى `state.agents`، فذاكرةٌ
 * لوكيل غير مسجَّل تُرفض في القاعدة لا في الكود فقط؛ و`dataset_id` مرجعٌ إلزامي
 * إلى `state.data_assets`، فلا وجود لذاكرة غير مفهرسة.
 *
 * **حدٌّ معلن:** `remember` كتابتان في جدولين (عقد بيانات ثم مدخل ذاكرة). ربطهما
 * في معاملة واحدة عمل الخطوة `M3.06`؛ وقبله كان انقطاعٌ بينهما يترك عقد بيانات
 * بلا ذاكرة — وهو أثرٌ زائد لا فقدُ ذاكرة.
 */

/**
 * مدخل ذاكرة لوكيل. كل مدخل مربوط بسجل في فهرس البيانات، فلا ذاكرة بلا عقد
 * بيانات معلَن المالك والتصنيف — وهذا ما يجعل الاستدعاء قابلاً للتفويض والمنع.
 * @typedef {object} MemoryEntry
 * @property {string} id
 * @property {string} agentId - مالك المدخل؛ لا يقرأ وكيل ذاكرة غيره
 * @property {string} datasetId - السجل المقابل في فهرس البيانات
 * @property {'episodic' | 'semantic' | 'procedural'} kind
 * @property {unknown} content - محتوى الذاكرة كما سلّمه الوكيل
 * @property {string[]} tags
 * @property {boolean} legalHold
 * @property {Date | null} expiresAt
 * @property {number} version
 * @property {Date} createdAt
 * @property {Date} updatedAt
 */

/**
 * عقد المستودع الذي يحتاجه هذا المخزن.
 * @typedef {object} MemoryRepository
 * @property {(record: Record<string, unknown>) => Promise<Record<string, unknown>>} insert
 * @property {(id: string) => Promise<Record<string, unknown> | null>} findById
 * @property {(query?: { filter?: Record<string, unknown>, limit?: number }) => Promise<Array<Record<string, unknown>>>} list
 * @property {(filter?: Record<string, unknown>) => Promise<number>} count
 * @property {(id: string, expectedVersion: number) => Promise<void>} remove
 */

/**
 * يبني مدخلاً من صفّ المستودع ومادةٍ **مفكوكة من غلافها** (الخطوة `M7.03`).
 *
 * ولماذا تُمرَّر المادة وسيطاً ولا تُقرأ من الصفّ: لأن الصفّ لا يحمل مادةً
 * بعد اليوم بل معمّى؛ ودالّةٌ تقرأ `content` مباشرةً كانت ستُعيد الغلاف نفسه
 * لمن لم يمرّ بالفكّ فيصير للمادة مسار قراءةٍ ثانٍ.
 * @param {Record<string, unknown>} row
 * @param {unknown} content
 * @returns {MemoryEntry}
 */
function toEntry(row, content) {
  return /** @type {MemoryEntry} */ (
    /** @type {unknown} */ (
      Object.freeze({
        ...row,
        // `snapshot` لا `content` كما وصلت: المادة العائدة من الفكّ كائنٌ حديث
        // مُحلَّل من نصّ، فلو مُرِّرت كما هي لعاد الاستدعاء بمخزونٍ **قابل
        // للتعديل** — وهو الحدّ الذي كان قائماً قبل التشفير وكاد يسقط معه.
        content: snapshot(content),
        tags: row['tags'] ?? [],
      })
    )
  );
}

/**
 * ربط الغلاف بهويّة صفّه: معرّف المدخل ومالكه وعقد بياناته. فمعمّى يُنقل
 * من صفّ إلى صفّ — وهو ما يفعله من يريد قراءة ذاكرة غيره بلا مفتاح — يُخفق
 * عند الفكّ ولا يُعاد نصّاً.
 * @param {{ id: string, agentId: string, datasetId: string }} parts
 * @returns {Record<string, string>}
 */
function bindingOf({ id, agentId, datasetId }) {
  return { id, agentId, datasetId };
}

/** @typedef {import('../persistence/composition.mjs').StateTransaction} TransactionRunner */

export class AgentMemoryStore {
  /**
   * الاعتماديات اختيارية في النوع لأن التوقيع يقبل الاستدعاء بلا وسائط ويردّ
   * بخطأ مُسمّى `MEMORY_DEPENDENCY_MISSING`؛ التحقّق بعده يضيّق النوع.
   * @param {{ catalog?: import('./data-catalog.mjs').DataCatalog, log?: import('../root-of-trust/event-log.mjs').EventLog, repository?: MemoryRepository, maxEntries?: number, transaction?: TransactionRunner | null, accessGate?: import('./access-gate.mjs').DataAccessGate | null, encryptor?: import('./encryption.mjs').DataEncryptor | null, policy?: import('./memory-limits.mjs').MemoryPolicy | null, quarantine?: { report: (input: { kind: string, subject: string, detail?: Record<string, unknown> }) => unknown } | null, authorizer?: { authorize: (request: import('../policy/model.mjs').PolicyRequest, measurement?: { measured?: Record<string, unknown> }) => Promise<{ decision: { allowed: boolean, code: string, reason: string }, token: string | null }>, verify: (token: string | undefined, expected: { actorId: string, action: string, resourceKey: string, royalCommandId?: string, royalCommandDigest?: string }) => unknown, identityGate?: unknown } | null, purgeAuthority?: import('./purge-authority.mjs').PurgeAuthority | null }} [deps]
   */
  constructor({
    catalog,
    log,
    repository,
    maxEntries,
    transaction = null,
    accessGate = null,
    encryptor = null,
    policy = null,
    quarantine = null,
    authorizer = null,
    purgeAuthority = null,
  } = {}) {
    if (!catalog || !log || !repository) throw new Error('MEMORY_DEPENDENCY_MISSING');
    this.catalog = catalog;
    /**
     * بوابة الوصول (الخطوة `M7.02`). اختيارية في **التركيب** لا في الفعل: مخزنٌ
     * بلا بوابة **يرفض** الاستدعاء والتذكّر برمز `MEMORY_ACCESS_GATE_REQUIRED`
     * ولا يمرّرهما بقرارٍ ناقص — فالتركيب الناقص ليس مساراً جانبياً.
     * @type {import('./access-gate.mjs').DataAccessGate | null}
     */
    this.accessGate = accessGate;
    /**
     * مغلّف المادة (الخطوة `M7.03`). اختياري في **التركيب** وليس في الفعل:
     * مخزنٌ بلا مغلّف يرفض التذكّر والاستدعاء برمز `MEMORY_ENCRYPTOR_REQUIRED`.
     * ولماذا لا يكتب نصّاً حين لا مغلّف: لأن ذلك يجعل **تركَ التركيب** طريقاً
     * مفتوحاً للنصّ الصريح — وهو أسهل من اختراق التشفير نفسه.
     * @type {import('./encryption.mjs').DataEncryptor | null}
     */
    this.encryptor = encryptor;
    this.log = log;
    /** @type {MemoryRepository} */
    this.repository = repository;
    /**
     * سياسة الحدود والعزل (‏`M7.05`). تُحمَّل من `config/memory.yaml` إن لم
     * تُمرَّر: الأرقام سياسةٌ معلَنة لا ثوابتَ في الكود — وقد كانت `maxEntries`
     * رقماً في التوقيع، سقفاً واحداً للمخزن كلّه لا حصّةً لوكيل.
     * @type {import('./memory-limits.mjs').MemoryPolicy}
     */
    this.policy = policy ?? loadMemoryPolicy();
    /**
     * نقطةُ التفويضِ للتطهيرِ المحكومِ (‏`LIM-3`). اختياريّةٌ في **التركيبِ** لا
     * في الفعلِ: مخزنٌ بلا نقطةِ تفويضٍ **يرفضُ** التطهيرَ برمزٍ مُسمّىً ولا
     * يمحو بنصِّ دورٍ يُرسلُه المُنادي — وهو العيبُ المُغلَقُ في `WL-190`.
     * @type {{ authorize: (request: import('../policy/model.mjs').PolicyRequest, measurement?: { measured?: Record<string, unknown> }) => Promise<{ decision: { allowed: boolean, code: string, reason: string }, token: string | null }>, verify: (token: string | undefined, expected: { actorId: string, action: string, resourceKey: string, royalCommandId?: string, royalCommandDigest?: string }) => unknown, identityGate?: unknown } | null}
     */
    this.authorizer = authorizer;
    /**
     * عتبةُ `purge-data` كما تُقرأُ من `config/royal-authority.yaml`. تُحمَّلُ عند
     * أوّلِ تطهيرٍ إن لم تُمرَّرْ، ولا تُثبَّتُ ثابتاً في الكودِ: العتبةُ بياناتٌ
     * سياديّةٌ، ونسخةٌ منها في الكودِ تفترقُ عن أصلِها بلا أن يُقال.
     * @type {import('./purge-authority.mjs').PurgeAuthority | null}
     */
    this.purgeAuthority = purgeAuthority;
    /**
     * السقف العالمي: يبقى قابلاً للتضييق في التركيب (‏`limits.maxEntries`) لأن
     * حجم النشر يختلف عن حجم الاختبار، ولا يبقى **بديلاً** عن حصّة الوكيل.
     * @type {number}
     */
    this.maxEntries = maxEntries ?? this.policy.quotas.globalEntries;
    /**
     * مبلِّغ الحجر: محاولةُ عبورٍ واحدة قد تكون معرّفاً خاطئاً، وتكرارُها قصدٌ.
     * @type {{ report: (input: { kind: string, subject: string, detail?: Record<string, unknown> }) => unknown } | null}
     */
    this.quarantine = quarantine;
    /** @type {MemoryIsolationMonitor} */
    this.isolationMonitor = new MemoryIsolationMonitor({
      threshold: this.policy.anomaly.crossAgentAttemptsBeforeSignal,
    });
    /**
     * مُشغّل معاملة يُمرَّر من طبقة التركيب حين تكون المستودعات على قاعدة
     * (`M3.06`). إن كان `null` فالكتابتان في «تذكّر» ليستا ذرّيتين — وهذا هو
     * حال مستودعات الذاكرة، وهو حدٌّ معلن لا مسكوتٌ عنه.
     * @type {TransactionRunner | null}
     */
    this.transaction = transaction;
  }

  /** @returns {import('../persistence/entities.mjs').EntitySpec} */
  static get spec() {
    return MEMORY_SPEC;
  }

  /**
   * يسجّل ذاكرة جديدة: يُنشئ لها عقد بيانات في الفهرس أولاً، فلا وجود لذاكرة
   * غير مفهرسة. الحصّة تُفحص قبل الإنشاء لا بعده.
   *
   * ومعرّف الذاكرة يُولَّد **قبل** عقد البيانات لأن اسم العقد فريد في القاعدة:
   * `memory:${agentId}` وحده كان يتعارض عند ثاني ذاكرة لنفس الوكيل، وهو عيبٌ لم
   * يكن يظهر في `Map` بلا قيد فريد.
   * @param {string} agentId
   * @param {unknown} content
   * @param {{ classification?: import('./classification.mjs').ClassificationValue, source?: string, kind?: 'episodic' | 'semantic' | 'procedural', tags?: string[], actor?: import('../policy/model.mjs').PolicyActor }} [options]
   * @returns {Promise<MemoryEntry>}
   */
  async remember(agentId, content, options = {}) {
    // الكتابة قرار إتاحة أيضاً: من يحمل تخليصاً عالياً لا يُنشئ مادةً مصنّفة أدنى
    // منه، لأن ذلك ينقل ما يعرفه إلى مرتبةٍ يقرؤها من هو أدنى منه بلا إعادة تصنيف.
    if (this.accessGate === null) throw new Error('MEMORY_ACCESS_GATE_REQUIRED');
    if (this.encryptor === null) throw new Error('MEMORY_ENCRYPTOR_REQUIRED');
    const actor = options.actor;
    if (actor === undefined || typeof actor.role !== 'string') {
      throw new Error('MEMORY_ACTOR_REQUIRED');
    }
    this.accessGate.assertNoWriteDown(actor, options.classification ?? 'internal');
    // المالك يُشتقّ من الفاعل ولا يُقبل ادّعاءً (‏`M7.05`): وكيلٌ يذكر معرّف وكيلٍ
    // آخر كان **يزرع** ذاكرةً في وعاء غيره، وهو تسريبٌ بالاتجاه المعاكس: يُقرأ
    // لاحقاً بوصفه ذاكرةَ صاحبه ويُصدَّق.
    const owner = this.#ownerFor(agentId, actor);
    // كتابتان: عقد بيانات ثم ذاكرة تحيل إليه. إن أخفقت الثانية بقي عقدٌ بلا
    // ذاكرة — أثرٌ لا يقوله أحد. فحين يوجد مُشغّل معاملة تُلَفّان معاً.
    if (this.transaction === null) return this.#write(owner, content, options);
    return this.transaction(
      /** @param {import('../persistence/composition.mjs').StateRegistries} registries */
      (registries) => registries.memory.#write(owner, content, options),
    );
  }

  /**
   * مالكُ المدخل: من الفاعل إن كان وكيلاً، ومن الوسيط إن كان الفاعل دوراً
   * تشغيلياً يُهيّئ لوكيلٍ (وهو مسارُ التهيئة القائم: مشغّلٌ يكتب ذاكرةً لوكيلٍ
   * سجّله). والفرق أنّ **الوكيل** لا يستطيع تسمية غيره، وأنّ التهيئة تُسجَّل
   * بنيابتها فلا تُقرأ لاحقاً كأنّ الوكيل كتبها بنفسه.
   * @param {string} claimed
   * @param {import('../policy/model.mjs').PolicyActor} actor
   * @returns {string}
   */
  #ownerFor(claimed, actor) {
    const requested = typeof claimed === 'string' ? claimed.trim() : '';
    if (this.policy.isOwnerRole(actor.role)) {
      if (requested !== '' && requested !== actor.id) {
        this.#refuseIsolation({
          actor,
          subject: requested,
          reason: 'remember',
        });
        throw new MemoryLimitError(
          MEMORY_LIMIT_ERRORS.OWNER_CLAIM_REFUSED,
          `الوكيل «${actor.id}» طلب كتابة ذاكرةٍ باسم «${requested}»: الملكية تُشتقّ من الفاعل، وزرعُ ذاكرةٍ في وعاء وكيلٍ آخر تسريبٌ بالاتجاه المعاكس.`,
          { actorId: actor.id, claimed: requested },
        );
      }
      return actor.id;
    }
    if (requested === '') {
      throw new MemoryLimitError(
        MEMORY_LIMIT_ERRORS.INPUT_INVALID,
        'كتابة ذاكرةٍ من دورٍ تشغيلي بلا تسمية الوكيل المالك: مدخلٌ بلا مالكٍ واحد هو مساحةٌ مشتركة، وهي قناة التسريب التي تمنعها هذه الخطوة.',
        { actorId: actor.id },
      );
    }
    return requested;
  }

  /**
   * يسجّل رفض عزلٍ: حدثٌ في السجل دائماً، وإشارةُ حجرٍ عند بلوغ العتبة.
   * @param {{ actor: import('../policy/model.mjs').PolicyActor, subject: string, reason: string }} input
   * @returns {void}
   */
  #refuseIsolation({ actor, subject, reason }) {
    const { count, reached } = this.isolationMonitor.attempt(String(actor.id));
    this.log.append('memory.isolation.refused', String(actor.id), {
      subject,
      reason,
      role: actor.role,
      attempts: count,
    });
    if (!reached || this.quarantine === null) return;
    try {
      this.quarantine.report({
        kind: this.policy.anomaly.signalKind,
        subject: String(actor.id),
        detail: { attempts: count, lastSubject: subject, reason },
      });
    } catch {
      // إخفاقُ الحاجب لا يحوّل رفضاً إلى سماح ولا يُخفي الرفض عن المُنادي.
    }
  }

  /**
   * يفرض الحصص **قبل** أي كتابة: عدد مداخل الوكيل، وبايتات مخزونه، والسقف
   * العالمي. وكان الفحص الوحيد قبل هذه الخطوة `count()` بلا مرشِّح على سقفٍ
   * واحد — فوكيلٌ واحد يمنع الجميع.
   * @param {{ agentId: string, entryBytes: number }} input
   * @returns {Promise<{ rows: Array<Record<string, unknown>>, usedBytes: number }>}
   */
  async #assertQuota({ agentId, entryBytes }) {
    const { maxEntryBytes, perAgentEntries, perAgentStoredBytes } = this.policy.quotas;
    if (entryBytes > maxEntryBytes) {
      throw new MemoryLimitError(
        MEMORY_LIMIT_ERRORS.ENTRY_TOO_LARGE,
        `مدخل ذاكرةٍ بحجم ${entryBytes} بايت يتجاوز حدّ المدخل الواحد (${maxEntryBytes}): مدخلٌ بلا حدٍّ يستنزف الحصّة كلها في كتابةٍ واحدة.`,
        { agentId, entryBytes, maxEntryBytes },
      );
    }
    // السقف العالمي يبقى آخر الحدود لا أوّلها: بلوغُه يعني أن المخزن ككل امتلأ.
    if ((await this.repository.count()) >= this.maxEntries) {
      throw new MemoryLimitError(
        MEMORY_LIMIT_ERRORS.QUOTA_EXCEEDED,
        `المخزن بلغ سقفه العالمي (${this.maxEntries} مدخلاً).`,
        { agentId, limit: this.maxEntries },
      );
    }
    const rows = await this.repository.list({ filter: { agentId } });
    if (rows.length >= perAgentEntries) {
      throw new MemoryLimitError(
        MEMORY_LIMIT_ERRORS.AGENT_QUOTA_EXCEEDED,
        `الوكيل «${agentId}» بلغ حصّته (${perAgentEntries} مدخلاً): حصّةُ وكيلٍ تُرفض عليه وحده، ولا تُغلق المخزن على غيره.`,
        { agentId, limit: perAgentEntries, held: rows.length },
      );
    }
    const usedBytes = rows.reduce((sum, row) => sum + storedBytesOf(row['content']), 0);
    if (usedBytes >= perAgentStoredBytes) {
      throw new MemoryLimitError(
        MEMORY_LIMIT_ERRORS.AGENT_BYTES_EXCEEDED,
        `الوكيل «${agentId}» بلغ حصّة بايتاته (${usedBytes} من ${perAgentStoredBytes}).`,
        { agentId, usedBytes, limit: perAgentStoredBytes },
      );
    }
    return { rows, usedBytes };
  }

  /**
   * جسم «تذكّر» بلا معاملة — يُنادى مباشرةً أو داخل وحدة عمل.
   * @param {string} agentId
   * @param {unknown} content
   * @param {{ classification?: import('./classification.mjs').ClassificationValue, source?: string, kind?: 'episodic' | 'semantic' | 'procedural', tags?: string[], actor?: import('../policy/model.mjs').PolicyActor }} options
   * @returns {Promise<MemoryEntry>}
   */
  async #write(
    agentId,
    content,
    { classification = 'internal', source = 'agent', kind = 'episodic', tags = [] } = {},
  ) {
    // صورةٌ من المحتوى وقت التسليم لا مرجعٌ إليه: الذاكرة تُقيّد ما سُلِّم حين سُلِّم.
    const material = snapshot(content);
    // الحصص تُقاس قبل أي كتابة: فحصٌ بعد التسجيل يترك عقد بياناتٍ لمدخلٍ مرفوض.
    await this.#assertQuota({ agentId, entryBytes: storedBytesOf(material) });
    const id = 'memory:' + randomUUID();
    const dataset = await this.catalog.register({
      name: `${id}@${agentId}`,
      owner: agentId,
      classification,
      source,
      // مدّة الاحتفاظ من السياسة لا رقماً في الكود (‏`M7.05`)، ومن **نفس** الموضع الذي
      // يُحسب منه انتهاء المدخل: رقمان منفصلان لمعنىٍ واحد يفترقان أوّل تعديل،
      // فيبقى عقد البيانات بعد انتهاء مادته أو يُمحى قبله.
      retentionDays: MEMORY_KINDS.includes(kind) ? this.policy.daysFor(kind) : 30,
      // غرضُ قيد النسب (‏`M7.04`): عقدُ بياناتٍ وُلد لذاكرة وكيل، لا أصلٌ سُجّل بيدٍ.
      purpose: 'memory',
    });
    // و**تُغلَّف** قبل أن تلمس المستودع (الخطوة `M7.03`): فمن قرأ القاعدة من
    // غير طريق الكود — نسخةٌ احتياطية أو حساب صيانة أو قرصٌ مُصادَر — قرأ معمّى.
    // والتغليف دائمٌ ولو كان التصنيف عامّاً، لأن التصنيف يسكن `state.data_assets`
    // لا `state.memories`، فقيدُ القاعدة لا يقرؤه؛ ونسخُ التصنيف عموداً ثانياً هو
    // انحراف «الحقيقة في موضعين» الذي أُصلح في M7.01.
    const sealed = await /** @type {import('./encryption.mjs').DataEncryptor} */ (
      this.encryptor
    ).seal({
      value: material,
      classification,
      binding: bindingOf({ id, agentId, datasetId: dataset.id }),
    });
    // الانتهاء يُحسب من السياسة ويُكتب فعلاً (‏`M7.05`): كان العمود قائماً منذ الترحيل
    // الأول ولم يُكتَب مرّةً، وسياسةُ الاحتفاظ تمحو به — فكانت تمرّ على صفر صفوف
    // وتُعلن نجاحها. ونوعٌ غير معلَن لا تُخترع له مدّة: يرفضه المستودع بقيد
    // التعداد في نفس الموضع الذي كان يرفضه فيه، فلا تتغير الذرّية المقيسة.
    const expiresAt = MEMORY_KINDS.includes(kind) ? this.policy.expiresAt({ kind }) : null;
    const row = await this.repository.insert({
      id,
      agentId,
      datasetId: dataset.id,
      kind,
      content: sealed,
      tags: [...tags],
      legalHold: false,
      expiresAt,
    });
    // السجل يقول إنّ الذاكرة كُتبت **مغلَّفة** وبأي مرتبة، ولا يحمل مادتها ولا
    // شيئاً من مفتاحها: سجلٌّ يحمل المادة يُبطل التشفير من باب التدقيق.
    this.log.append('memory.created', agentId, {
      id,
      datasetId: dataset.id,
      encrypted: true,
      tier: sealed.tier,
      expiresAt: expiresAt === null ? null : expiresAt.toISOString(),
    });
    return toEntry(row, material);
  }

  /**
   * يستدعي ذاكرة. شرطان معاً: **ملكية** المدخل، و**قرار إتاحة كامل** من بوابة
   * الوصول على عقد البيانات المقابل (الخطوة `M7.02`).
   *
   * كان التوقيع `recall(agentId, id, clearance)` والتصريح **يُمرَّر** فيُقارن بتصنيف
   * الأصل: فمن نادى بـ`'sovereign'` قرأ. صار التخليص يُشتقّ من دور الفاعل بعد
   * تفويضٍ يتحقّق من هويته، والمادّة لا تُعاد إلا بعد التحقّق من تذكرة القرار.
   * الملكية تُقاس بالفاعل لا بوسيطٍ يُمرَّر: الوكيل يستدعي ما كتبه هو، ومن ليس
   * وكيلاً (مراجعٌ أو وزير) يستدعي ذاكرة غيره **بقرار البوابة** لا بحقٍّ ذاتي.
   * @param {{ id: string, actor: import('../policy/model.mjs').PolicyActor, agentId?: string, purpose?: string }} request
   * @returns {Promise<MemoryEntry>}
   */
  async recall({ id, actor, agentId, purpose = 'agent-recall' }) {
    if (this.accessGate === null) throw new Error('MEMORY_ACCESS_GATE_REQUIRED');
    if (this.encryptor === null) throw new Error('MEMORY_ENCRYPTOR_REQUIRED');
    if (actor === undefined || typeof actor.id !== 'string')
      throw new Error('MEMORY_ACTOR_REQUIRED');
    const row = await this.repository.findById(id);
    if (row === null) throw new Error('MEMORY_NOT_FOUND');
    if (agentId !== undefined && row['agentId'] !== agentId) throw new Error('MEMORY_NOT_FOUND');
    // الوكيل محصورٌ في ذاكرته: لو قُيس المالك بوسيطٍ يُمرَّره المُنادي لصار كلُّ
    // مَن يعرف معرّف وكيلٍ آخر يقرأ ذاكرته بذكر اسمه.
    if (this.policy.isOwnerRole(String(actor.role)) && row['agentId'] !== actor.id) {
      // الرفض يُسجّل ويُعدّ (‏`M7.05`)، ويبقى رمزه `MEMORY_NOT_FOUND` لا «ليس لك»:
      // التمييز بين الرمزين يعطي وجود المدخل لمن ليس له، فيصير الرفض نفسه قناةً
      // تُجيب عن «هل يملك فلانٌ مدخلاً بهذا المعرّف؟».
      this.#refuseIsolation({ actor, subject: String(row['id']), reason: 'recall' });
      throw new Error('MEMORY_NOT_FOUND');
    }
    // ذاكرةٌ انتهت مدّتها لا تُعاد ولو بقي صفّها إلى أن يمرّ المطهِّر: الفجوة
    // بين الانتهاء والمحو ليست إذناً بالقراءة، ومحوٌ يتأخّر لا يُمدّد مدّة الاحتفاظ.
    this.#assertNotExpired(row);
    const encryptor = /** @type {import('./encryption.mjs').DataEncryptor} */ (this.encryptor);
    const datasetId = String(row['datasetId']);
    return /** @type {Promise<MemoryEntry>} */ (
      this.accessGate.read({
        actor,
        assetId: datasetId,
        purpose,
        // الفكّ **داخل** أثر البوابة لا قبله: فلا تُفكّ مادةٌ إلا بعد أن تُقيَّم
        // السياسة وتُستهلَك تذكرة القرار. ولو فُكّت قبل النداء لصارت المادة
        // مكشوفة في الذاكرة حتى لمن سيُرفض بعد سطرين.
        // ومرتبة الأصل تُمرَّر من قرار البوابة لا من الغلاف: غلافٌ بمفتاح مرتبةٍ
        // لا تطابق تصنيف أصله اليوم يُرفض بـ`ENCRYPTION_ENVELOPE_TIER_MISMATCH`.
        reader: async (asset) =>
          toEntry(
            row,
            await encryptor.open({
              envelope: row['content'],
              binding: bindingOf({
                id: String(row['id']),
                agentId: String(row['agentId']),
                datasetId,
              }),
              classification: asset.classification,
            }),
          ),
      })
    );
  }

  /**
   * يحذف مدخلاً بقرار بوابة، وملكيّته تُقاس بالفاعل لا بوسيط (‏`M7.05`).
   *
   * **حدٌّ معلن:** عقد البيانات المقابل **يبقى** في الفهرس. حذفه هنا يمحو أثر
   * التصنيف والملكية من الفهرس، وقرارُ محو عقود البيانات المهجورة سياسةُ
   * الاحتفاظ (`M3.08`) لا فعلُ وكيلٍ ينسى.
   * @param {{ id: string, actor: import('../policy/model.mjs').PolicyActor } | string} request
   * @param {string} [legacyId]
   * @returns {Promise<true>}
   */
  async forget(request, legacyId) {
    // التوقيع القديم `forget(agentId, id)` كان يقيس الملكية على وسيطٍ يُمرَّره
    // المُنادي، فمن يعرف معرّف وكيلٍ يمحو ذاكرته. وهو يُرفض رفضاً مُسمّى لا
    // يُدعم بـ«توافق خلفي»: توافقٌ يحفظ طريقَ العيب ليس توافقاً بل إبقاءً للعيب.
    if (typeof request === 'string' || legacyId !== undefined) {
      throw new MemoryLimitError(
        MEMORY_LIMIT_ERRORS.OWNER_CLAIM_REFUSED,
        'النسيان بتوقيع `forget(agentId, id)` مرفوض: الملكية كانت تُقاس على وسيطٍ يُمرَّره من يمحو، فصار التوقيع `forget({ id, actor })`.',
      );
    }
    if (this.accessGate === null) throw new Error('MEMORY_ACCESS_GATE_REQUIRED');
    const { id, actor } = request;
    if (actor === undefined || typeof actor.id !== 'string' || typeof actor.role !== 'string') {
      throw new Error('MEMORY_ACTOR_REQUIRED');
    }
    const row = await this.repository.findById(id);
    if (row === null) throw new Error('MEMORY_NOT_FOUND');
    if (this.policy.isOwnerRole(actor.role) && row['agentId'] !== actor.id) {
      this.#refuseIsolation({ actor, subject: String(row['id']), reason: 'forget' });
      throw new Error('MEMORY_NOT_FOUND');
    }
    const owner = String(row['agentId']);
    // المحو قرارُ كتابة يمرّ بالبوابة (‏`M7.02`) فيُقيّد في النسب (‏`M7.04`):
    // محوٌ لا يُقيّد يجعل اختفاء مدخلٍ حادثةً بلا فاعل.
    await this.accessGate.write({
      actor,
      assetId: String(row['datasetId']),
      purpose: 'memory-forget',
      writer: async () => {
        // الحذف يرفع خطأ المستودع كما هو إن تعارضت النسخة أو زال الصفّ بين
        // القراءة والحذف: ابتلاعه يجعل «نسيتُ» تُقال عن ذاكرةٍ لم تُحذف.
        await this.repository.remove(id, Number(row['version']));
        this.log.append('memory.deleted', owner, { id, actorId: actor.id });
        return true;
      },
    });
    return true;
  }

  /**
   * يرفع رفضاً إن انتهت مدّة المدخل.
   * @param {Record<string, unknown>} row
   * @param {Date} [now]
   * @returns {void}
   */
  #assertNotExpired(row, now = new Date()) {
    if (!this.policy.expiry.refuseRecallAfterExpiry) return;
    if (!this.#isExpired(row, now)) return;
    throw new MemoryLimitError(
      MEMORY_LIMIT_ERRORS.EXPIRED,
      `المدخل «${String(row['id'])}» انتهت مدّته ولم يمرّ المطهِّر بعد: الفجوة بين الانتهاء والمحو ليست إذناً بالقراءة.`,
      { id: String(row['id']), expiresAt: String(row['expiresAt']) },
    );
  }

  /**
   * @param {Record<string, unknown>} row
   * @param {Date} now
   * @returns {boolean}
   */
  #isExpired(row, now) {
    if (row['legalHold'] === true) return false;
    const value = row['expiresAt'];
    if (value === null || value === undefined) return false;
    const at = value instanceof Date ? value : new Date(String(value));
    if (Number.isNaN(at.getTime())) return false;
    return at.getTime() <= now.getTime();
  }

  /**
   * يسرد **وصف** مداخل وكيل بلا مادّتها. ولماذا وجوده أصلاً: لم يكن في
   * المخزن مسارُ تصفّح، ومستودع الذاكرة يقبل `agentId` مرشِّحاً، فمن أراد ذاكرة
   * غيره لم يحتج إلى ثغرة بل إلى مسارٍ أقصر: المستودع مباشرةً. فوجود مسارٍ
   * محكوم هو ما يُمكّن الحاجز من تحريم المسار الجانبي.
   *
   * **ولا تُعاد المادة هنا أبداً:** المادة تُفكّ في `recall` وحدها داخل أثر
   * البوابة، فلو أعاد السرد مادّةً لصار قرار الإتاحة قابلاً للتجاوز بمسارٍ أرخص.
   * @param {{ actor: import('../policy/model.mjs').PolicyActor, agentId?: string, limit?: number }} request
   * @returns {Promise<Array<{ id: string, agentId: string, datasetId: string, kind: string, tags: string[], legalHold: boolean, expiresAt: Date | null, createdAt: Date, storedBytes: number }>>}
   */
  async list({ actor, agentId, limit }) {
    if (actor === undefined || typeof actor.id !== 'string' || typeof actor.role !== 'string') {
      throw new Error('MEMORY_ACTOR_REQUIRED');
    }
    let owner = agentId;
    if (this.policy.isOwnerRole(actor.role)) {
      if (agentId !== undefined && agentId !== actor.id) {
        this.#refuseIsolation({ actor, subject: String(agentId), reason: 'list' });
        throw new MemoryLimitError(
          MEMORY_LIMIT_ERRORS.ISOLATION_REFUSED,
          `الوكيل «${actor.id}» طلب سرد مداخل «${agentId}»: الوكيل محصورٌ في ذاكرته، وحتّى وصفُ مداخل غيره يقول متى عمل وعلى ماذا.`,
          { actorId: actor.id, requested: agentId },
        );
      }
      owner = actor.id;
    } else if (owner === undefined) {
      throw new MemoryLimitError(
        MEMORY_LIMIT_ERRORS.INPUT_INVALID,
        'سردٌ بلا تسمية وكيل: سردٌ عامّ لكل المداخل يجمع ما فرّقه العزل.',
        { actorId: actor.id },
      );
    }
    const rows = await this.repository.list({
      filter: { agentId: owner },
      ...(limit === undefined ? {} : { limit }),
    });
    const now = new Date();
    this.log.append('memory.listed', String(actor.id), { agentId: owner, count: rows.length });
    return rows
      .filter((row) => !this.#isExpired(row, now))
      .map((row) =>
        Object.freeze({
          id: String(row['id']),
          agentId: String(row['agentId']),
          datasetId: String(row['datasetId']),
          kind: String(row['kind']),
          tags: /** @type {string[]} */ (row['tags'] ?? []),
          legalHold: row['legalHold'] === true,
          expiresAt: /** @type {Date | null} */ (row['expiresAt'] ?? null),
          createdAt: /** @type {Date} */ (row['createdAt']),
          storedBytes: storedBytesOf(row['content']),
        }),
      );
  }

  /**
   * يمحو المداخل المنتهية ويسجّل محوها. فعلُ تشغيلٍ لا فعلُ وكيل: وكيلٌ
   * يطهّر يمحو أثره بنفسه، فالأدوار المأذونة معلَنة في السياسة.
   *
   * **حدٌّ معلَن:** عقد البيانات المقابل يبقى في الفهرس، ومحوه مع دورة الاحتفاظ
   * الكاملة عملُ `M7.06`؛ وهذا المطهِّر يفرض **الانتهاء** لا الاحتفاظ كلّه.
   *
   * **وما تغيّر في `WL-190` إغلاقاً للدَينِ `LIM-3`:** كان هذا المسارُ يحذفُ
   * الصفوفَ فعلاً وحارسُه الوحيدُ `policy.isSweeper(actor.role)` — نصُّ دورٍ
   * يُرسلُه المُنادي — بلا بوابةِ هويةٍ ولا نداءِ تفويضٍ ولا أمرٍ ملكيٍّ، مع أنّ
   * `purge-data` فوقَ العتبةِ السياديّةِ. فكان **مسارَ محوٍ ثانياً** بقيَ مفتوحاً
   * بعدَ أن أُغلِقَ الأوّلُ في `R6-A-01`. فصارَ الدورُ **أهليّةً** والسلطةُ قرارَ
   * نقطةِ التفويضِ مع أمرٍ ملكيٍّ بمعرِّفِه وملخّصِه، والتذكرةُ تُستهلَكُ **قبلَ
   * أوّلِ حذفٍ** لا بعدَه.
   * @param {{ actor: import('../policy/model.mjs').PolicyActor, now?: Date, royalCommand?: { id: string, digest: string } }} request
   * @returns {Promise<string[]>}
   */
  async sweepExpired({ actor, now = new Date(), royalCommand }) {
    if (actor === undefined || typeof actor.role !== 'string') {
      throw new Error('MEMORY_ACTOR_REQUIRED');
    }
    if (!this.policy.isSweeper(actor.role)) {
      throw new MemoryLimitError(
        MEMORY_LIMIT_ERRORS.SWEEP_REFUSED,
        `الدور «${actor.role}» ليس من أدوار المطهِّر المعلَنة: من يمحو ما انتهت مدّته يمحو دليلاً، فلا يكون صاحبه.`,
        { role: actor.role },
      );
    }
    await this.#authorizeSweep({
      actor,
      ...(royalCommand === undefined ? {} : { royalCommand }),
    });
    const rows = await this.repository.list({});
    /** @type {string[]} */
    const purged = [];
    for (const row of rows) {
      if (!this.#isExpired(row, now)) continue;
      const id = String(row['id']);
      await this.repository.remove(id, Number(row['version']));
      this.log.append('memory.expired', String(row['agentId']), {
        id,
        actorId: actor.id,
        expiresAt: String(row['expiresAt']),
      });
      purged.push(id);
    }
    return purged;
  }

  /**
   * سلطةُ التطهيرِ (‏`LIM-3`، `WL-190`): أمرٌ ملكيٌّ فوقَ الأهليّةِ، ثمّ قرارُ
   * نقطةِ تفويضٍ موصولةٍ ببوابةِ هويةٍ، ثمّ استهلاكُ التذكرةِ — كلُّ ذلك **قبلَ**
   * أوّلِ حذفٍ. وعقدُه نفسُ عقدِ `RetentionCycle` كي لا يكونَ في الدولةِ مسارا
   * محوٍ بعقدَينِ مختلفَينِ.
   * @param {{ actor: import('../policy/model.mjs').PolicyActor, royalCommand?: { id: string, digest: string } }} request
   * @returns {Promise<void>}
   */
  async #authorizeSweep({ actor, royalCommand }) {
    const authority = this.purgeAuthority ?? loadPurgeAuthority();
    this.purgeAuthority = authority;
    // الرفضُ المُسمّى قبلَ نداءِ التفويضِ: الدورُ أهليّةٌ لا سلطةٌ، فمن جاءَ بدورٍ
    // مأذونٍ وبلا أمرٍ ملكيٍّ يقرأُ سببَ رفضِه باسمِه لا رمزَ سياسةٍ عامّاً.
    const bound = assertRoyalCommandForPurge({
      authority,
      role: actor.role,
      sweeperRoles: this.policy.expiry.sweeperRoles,
      ...(royalCommand === undefined ? {} : { royalCommand }),
    });
    if (this.authorizer === null || typeof this.authorizer.authorize !== 'function') {
      throw new MemoryLimitError(
        MEMORY_LIMIT_ERRORS.PURGE_AUTHORIZER_REQUIRED,
        `التطهيرُ فعلٌ محكومٌ («${PURGE_DATA_ACTION}») فوقَ العتبةِ السياديّةِ، ولم تُمرَّر نقطةُ تفويضٍ؛ ومحوٌ يقعُ بتركيبٍ صامتٍ هو تصعيدُ صلاحيةٍ لا تطهيرُ منتهياتٍ.`,
        { action: PURGE_DATA_ACTION, role: actor.role },
      );
    }
    if (
      this.authorizer.identityGate === null ||
      this.authorizer.identityGate === undefined ||
      typeof (/** @type {{ verify?: unknown }} */ (this.authorizer.identityGate).verify) !==
        'function'
    ) {
      throw new MemoryLimitError(
        MEMORY_LIMIT_ERRORS.PURGE_AUTHORIZER_REQUIRED,
        'نقطةُ التفويضِ الممرَّرةُ بلا بوابةِ هويةٍ موصولةٍ؛ فتقبلُ الفاعلَ كما وصفَ نفسَه، والمحوُ لا يقعُ على وصفٍ يُرسلُه المُنادي.',
        { action: PURGE_DATA_ACTION, role: actor.role },
      );
    }
    const { decision, token } = await this.authorizer.authorize({
      actor: {
        id: String(actor.id),
        role: actor.role,
        kind: /** @type {import('../policy/model.mjs').ActorKind} */ (
          typeof actor.kind === 'string' ? actor.kind : 'human'
        ),
        state: typeof actor.state === 'string' ? actor.state : 'active',
      },
      action: PURGE_DATA_ACTION,
      resource: { type: 'data', id: 'memories', classification: 'secret' },
      context: { reason: 'retention' },
      ...(bound === null ? {} : { royalCommandId: bound.id, royalCommandDigest: bound.digest }),
    });
    if (!decision.allowed) {
      throw new MemoryLimitError(
        MEMORY_LIMIT_ERRORS.PURGE_NOT_AUTHORIZED,
        `نقطةُ التفويضِ رفضت التطهيرَ برمز ${decision.code}: ${decision.reason}`,
        { action: PURGE_DATA_ACTION, code: decision.code },
      );
    }
    // التذكرةُ تُستهلَكُ قبلَ أوّلِ حذفٍ: قرارٌ لا تُستهلَكُ تذكرتُه يبقى قابلاً
    // لإعادةِ الاستعمالِ على تطهيرٍ ثانٍ لم يُقرَّر.
    try {
      this.authorizer.verify(token ?? undefined, {
        actorId: String(actor.id),
        action: PURGE_DATA_ACTION,
        // مفتاحُ المورد يُشتقُّ كما تشتقُّه نقطةُ الإنفاذِ من الطلبِ
        // (`<type>:<id>`)؛ ومفتاحٌ يُكتَبُ بيدٍ مخالفاً يُسقِطُ التحقّقَ برمز
        // `AUTHORIZATION_DECISION_MISMATCH` فيبدو التطهيرُ مرفوضاً لسببٍ آخرَ.
        resourceKey: 'data:memories',
        ...(bound === null ? {} : { royalCommandId: bound.id, royalCommandDigest: bound.digest }),
      });
    } catch (error) {
      throw new MemoryLimitError(
        MEMORY_LIMIT_ERRORS.PURGE_NOT_AUTHORIZED,
        `تذكرةُ قرارِ التطهيرِ غيرُ مقبولةٍ: ${error instanceof Error ? error.message : String(error)}`,
        { action: PURGE_DATA_ACTION },
      );
    }
    this.log.append('memory.sweep.authorized', String(actor.id), {
      action: PURGE_DATA_ACTION,
      resourceKey: 'data:memories',
    });
  }
}
