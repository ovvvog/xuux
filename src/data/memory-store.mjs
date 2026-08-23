import { randomUUID } from 'node:crypto';
import { snapshot } from '../lib/snapshot.mjs';

// الأنواع المستوردة تُكتب بصيغة `import(...)` مباشرة في مواضعها ولا تُسمّى بأسماء
// محلية: هذه الوحدة تُعاد تصديرها مع فهرس البيانات في src/data/index.mjs، وتسمية
// نفس النوع في الملفين تُنتج تصديرين متنازعين لاسم واحد.

/**
 * مدخل ذاكرة لوكيل. كل مدخل مربوط بسجل في فهرس البيانات، فلا ذاكرة بلا عقد
 * بيانات معلَن المالك والتصنيف — وهذا ما يجعل الاستدعاء قابلاً للتفويض والمنع.
 * @typedef {object} MemoryEntry
 * @property {string} id
 * @property {string} agentId - مالك المدخل؛ لا يقرأ وكيل ذاكرة غيره
 * @property {string} datasetId - السجل المقابل في فهرس البيانات
 * @property {unknown} content - محتوى الذاكرة كما سلّمه الوكيل
 * @property {string} createdAt
 */

export class AgentMemoryStore {
  /**
   * الاعتماديات اختيارية في النوع لأن التوقيع يقبل الاستدعاء بلا وسائط ويردّ
   * بخطأ مُسمّى `MEMORY_DEPENDENCY_MISSING`؛ التحقّق بعده يضيّق النوع.
   * @param {{ catalog?: import('./data-catalog.mjs').DataCatalog, log?: import('../root-of-trust/event-log.mjs').EventLog, maxEntries?: number }} [deps]
   */
  constructor({ catalog, log, maxEntries = 100000 } = {}) {
    if (!catalog || !log) throw new Error('MEMORY_DEPENDENCY_MISSING');
    this.catalog = catalog;
    this.log = log;
    this.maxEntries = maxEntries;
    /** @type {Map<string, MemoryEntry>} */
    this.entries = new Map();
  }

  /**
   * يسجّل ذاكرة جديدة: يُنشئ لها عقد بيانات في الفهرس أولاً، فلا وجود لذاكرة
   * غير مفهرسة. الحصّة تُفحص قبل الإنشاء لا بعده.
   * @param {string} agentId
   * @param {unknown} content
   * @param {{ classification?: import('./data-catalog.mjs').ClassificationValue, source?: string }} [options]
   * @returns {Readonly<MemoryEntry>}
   */
  remember(agentId, content, { classification = 'internal', source = 'agent' } = {}) {
    if (this.entries.size >= this.maxEntries) throw new Error('MEMORY_QUOTA_EXCEEDED');
    const dataset = this.catalog.register({
      name: `memory:${agentId}`,
      owner: agentId,
      classification,
      source,
      retentionDays: 30,
    });
    const id = 'memory:' + randomUUID();
    /** @type {MemoryEntry} */
    const e = {
      id,
      agentId,
      datasetId: dataset.id,
      // صورةٌ من المحتوى وقت التسليم لا مرجعٌ إليه: الذاكرة تُقيّد ما سُلِّم حين
      // سُلِّم، ومرجعٌ محفوظ يجعل المستدعي قادراً على تبديل ذاكرةٍ مسجَّلة بعد
      // تسجيلها فيُفسد كل استدعاءٍ لاحق ولا يترك أثراً في السجل.
      content: snapshot(content),
      createdAt: new Date().toISOString(),
    };
    this.entries.set(id, e);
    this.log.append('memory.created', agentId, { id, datasetId: dataset.id });
    return snapshot(e);
  }

  /**
   * يستدعي ذاكرة. شرطان معاً: ملكية المدخل، وإتاحة الفهرس بمستوى التصريح.
   * @param {string} agentId
   * @param {string} id
   * @param {import('./data-catalog.mjs').ClassificationValue} [clearance='internal']
   * @returns {Readonly<MemoryEntry>}
   */
  recall(agentId, id, clearance = 'internal') {
    const e = this.entries.get(id);
    if (!e || e.agentId !== agentId) throw new Error('MEMORY_NOT_FOUND');
    this.catalog.canRead(e.datasetId, agentId, clearance);
    return snapshot(e);
  }

  /**
   * يحذف ذاكرة يملكها الوكيل نفسه، ويسجّل الحذف.
   * @param {string} agentId
   * @param {string} id
   * @returns {true}
   */
  forget(agentId, id) {
    const e = this.entries.get(id);
    if (!e || e.agentId !== agentId) throw new Error('MEMORY_NOT_FOUND');
    this.entries.delete(id);
    this.log.append('memory.deleted', agentId, { id });
    return true;
  }
}
