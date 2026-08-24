import { randomUUID } from 'node:crypto';
import { snapshot } from '../lib/snapshot.mjs';
import { MEMORY_SPEC } from '../persistence/entities.mjs';

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
 * يفكّ تغليف المحتوى: يُخزَّن `{ value: ... }` لأن عمود القاعدة يشترط كائناً،
 * ويُقرأ كما سلّمه الوكيل.
 * @param {Record<string, unknown>} row
 * @returns {MemoryEntry}
 */
function toEntry(row) {
  const wrapper = row['content'];
  if (typeof wrapper !== 'object' || wrapper === null || !('value' in wrapper)) {
    throw new Error('MEMORY_CONTENT_CORRUPT');
  }
  return /** @type {MemoryEntry} */ (
    /** @type {unknown} */ (
      Object.freeze({
        ...row,
        content: /** @type {{ value: unknown }} */ (wrapper).value,
        tags: row['tags'] ?? [],
      })
    )
  );
}

/** @typedef {import('../persistence/composition.mjs').StateTransaction} TransactionRunner */

export class AgentMemoryStore {
  /**
   * الاعتماديات اختيارية في النوع لأن التوقيع يقبل الاستدعاء بلا وسائط ويردّ
   * بخطأ مُسمّى `MEMORY_DEPENDENCY_MISSING`؛ التحقّق بعده يضيّق النوع.
   * @param {{ catalog?: import('./data-catalog.mjs').DataCatalog, log?: import('../root-of-trust/event-log.mjs').EventLog, repository?: MemoryRepository, maxEntries?: number, transaction?: TransactionRunner | null, accessGate?: import('./access-gate.mjs').DataAccessGate | null }} [deps]
   */
  constructor({
    catalog,
    log,
    repository,
    maxEntries = 100000,
    transaction = null,
    accessGate = null,
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
    this.log = log;
    /** @type {MemoryRepository} */
    this.repository = repository;
    this.maxEntries = maxEntries;
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
    const actor = options.actor;
    if (actor === undefined || typeof actor.role !== 'string') {
      throw new Error('MEMORY_ACTOR_REQUIRED');
    }
    this.accessGate.assertNoWriteDown(actor, options.classification ?? 'internal');
    // كتابتان: عقد بيانات ثم ذاكرة تحيل إليه. إن أخفقت الثانية بقي عقدٌ بلا
    // ذاكرة — أثرٌ لا يقوله أحد. فحين يوجد مُشغّل معاملة تُلَفّان معاً.
    if (this.transaction === null) return this.#write(agentId, content, options);
    return this.transaction(
      /** @param {import('../persistence/composition.mjs').StateRegistries} registries */
      (registries) => registries.memory.#write(agentId, content, options),
    );
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
    if ((await this.repository.count()) >= this.maxEntries)
      throw new Error('MEMORY_QUOTA_EXCEEDED');
    const id = 'memory:' + randomUUID();
    const dataset = await this.catalog.register({
      name: `${id}@${agentId}`,
      owner: agentId,
      classification,
      source,
      retentionDays: 30,
    });
    const row = await this.repository.insert({
      id,
      agentId,
      datasetId: dataset.id,
      kind,
      // صورةٌ من المحتوى وقت التسليم لا مرجعٌ إليه: الذاكرة تُقيّد ما سُلِّم حين
      // سُلِّم. والتغليف `{ value }` شرط عمود `jsonb` الكائني في القاعدة.
      content: { value: snapshot(content) },
      tags: [...tags],
      legalHold: false,
    });
    this.log.append('memory.created', agentId, { id, datasetId: dataset.id });
    return toEntry(row);
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
    if (actor === undefined || typeof actor.id !== 'string')
      throw new Error('MEMORY_ACTOR_REQUIRED');
    const row = await this.repository.findById(id);
    if (row === null) throw new Error('MEMORY_NOT_FOUND');
    if (agentId !== undefined && row['agentId'] !== agentId) throw new Error('MEMORY_NOT_FOUND');
    // الوكيل محصورٌ في ذاكرته: لو قُيس المالك بوسيطٍ يُمرَّره المُنادي لصار كلُّ
    // مَن يعرف معرّف وكيلٍ آخر يقرأ ذاكرته بذكر اسمه.
    if (actor.role === 'role:agent' && row['agentId'] !== actor.id) {
      throw new Error('MEMORY_NOT_FOUND');
    }
    const entry = toEntry(row);
    return /** @type {Promise<MemoryEntry>} */ (
      this.accessGate.read({
        actor,
        assetId: entry.datasetId,
        purpose,
        reader: () => entry,
      })
    );
  }

  /**
   * يحذف ذاكرة يملكها الوكيل نفسه، ويسجّل الحذف.
   *
   * **حدٌّ معلن:** عقد البيانات المقابل **يبقى** في الفهرس. حذفه هنا يمحو أثر
   * التصنيف والملكية من الفهرس، وقرارُ محو عقود البيانات المهجورة سياسةُ
   * الاحتفاظ (`M3.08`) لا فعلُ وكيلٍ ينسى.
   * @param {string} agentId
   * @param {string} id
   * @returns {Promise<true>}
   */
  async forget(agentId, id) {
    const row = await this.repository.findById(id);
    if (row === null || row['agentId'] !== agentId) throw new Error('MEMORY_NOT_FOUND');
    // الحذف يرفع خطأ المستودع كما هو إن تعارضت النسخة أو زال الصفّ بين القراءة
    // والحذف: ابتلاعه هنا يجعل «نسيتُ» تُقال عن ذاكرةٍ لم تُحذف.
    await this.repository.remove(id, Number(row['version']));
    this.log.append('memory.deleted', agentId, { id });
    return true;
  }
}
