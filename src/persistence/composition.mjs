/**
 * تركيب السجلات على المستودعات — الخطوة `M3.05`.
 *
 * السجلات صارت تأخذ مستودعاتها من الخارج، وهذا يعني أن على كل مستدعٍ أن يعرف
 * أي مواصفة لأي سجل. تكرار هذه المعرفة في كل موضع تركيب هو كيف تختلف بيئةٌ عن
 * بيئة بلا أن يفشل شيء، فجُمعت هنا في موضع واحد.
 *
 * ولا يُخفى الفرق بين التطبيقين: مستودعات الذاكرة **تُمحى بإعادة التشغيل** ولا
 * تعرف مراجع المفاتيح الأجنبية (ذاكرةٌ لوكيل غير مسجَّل تُقبل فيها وتُرفض في
 * القاعدة). فهي للاختبار السريع، والقاعدة هي التشغيل. من أراد إثبات الاستمرارية
 * فلا يثبتها على الذاكرة.
 */

import { DataCatalog } from '../data/data-catalog.mjs';
import { AgentMemoryStore } from '../data/memory-store.mjs';
import { LawRegistry } from '../governance/law-system.mjs';
import { AgentRegistry } from '../identity/agent-registry.mjs';
import { ModelRegistry } from '../models/model-registry.mjs';
import { AGENT_SPEC, DATA_ASSET_SPEC, LAW_SPEC, MEMORY_SPEC, MODEL_SPEC } from './entities.mjs';
import { createMemoryRepository } from './repository-memory.mjs';
import { createPostgresRepository } from './repository-postgres.mjs';
import { withUnitOfWork } from './unit-of-work.mjs';

/**
 * ترتيب الإنشاء مقصود: الوكلاء ثم أصول البيانات قبل الذاكرة، لأن مراجع القاعدة
 * تفرض هذا الترتيب على الكتابة لا على الإنشاء فقط.
 * @typedef {object} StateRepositories
 * @property {ReturnType<typeof createMemoryRepository>} agents
 * @property {ReturnType<typeof createMemoryRepository>} models
 * @property {ReturnType<typeof createMemoryRepository>} dataAssets
 * @property {ReturnType<typeof createMemoryRepository>} memories
 * @property {ReturnType<typeof createMemoryRepository>} laws
 */

/**
 * مُشغّل معاملة على السجلات: يُعيد بناء السجلات على وصلةٍ واحدة داخل معاملة،
 * فتصير الكتابات المركّبة كلها أو لا شيء (`M3.06`).
 * @typedef {<T>(work: (registries: StateRegistries) => Promise<T>) => Promise<T>} StateTransaction
 */

/**
 * @typedef {object} StateRegistries
 * @property {AgentRegistry} agents
 * @property {ModelRegistry} models
 * @property {DataCatalog} catalog
 * @property {AgentMemoryStore} memory
 * @property {LawRegistry} laws
 */

/**
 * مستودعات ذاكرة لكل السجلات — للاختبار السريع لا للتشغيل.
 * @param {{ now?: () => Date }} [options]
 * @returns {StateRepositories}
 */
export function createMemoryRepositories(options = {}) {
  return {
    agents: createMemoryRepository(AGENT_SPEC, options),
    models: createMemoryRepository(MODEL_SPEC, options),
    dataAssets: createMemoryRepository(DATA_ASSET_SPEC, options),
    memories: createMemoryRepository(MEMORY_SPEC, options),
    laws: createMemoryRepository(LAW_SPEC, options),
  };
}

/**
 * مستودعات PostgreSQL لكل السجلات — هذه هي التي تُثبت الاستمرارية.
 * @param {import('pg').Pool} pool
 * @returns {StateRepositories}
 */
export function createPostgresRepositories(pool) {
  return /** @type {StateRepositories} */ (
    /** @type {unknown} */ ({
      agents: createPostgresRepository(pool, AGENT_SPEC),
      models: createPostgresRepository(pool, MODEL_SPEC),
      dataAssets: createPostgresRepository(pool, DATA_ASSET_SPEC),
      memories: createPostgresRepository(pool, MEMORY_SPEC),
      laws: createPostgresRepository(pool, LAW_SPEC),
    })
  );
}

/**
 * يركّب السجلات الخمسة على مستودعات مُعطاة.
 * @param {object} deps
 * @param {import('../root-of-trust/identity.mjs').CertificateAuthority} deps.ca
 * @param {import('../root-of-trust/event-log.mjs').EventLog} deps.log
 * @param {StateRepositories} deps.repositories
 * @param {{ maxAgents?: number, maxModels?: number, maxEntries?: number }} [deps.limits]
 * @param {StateTransaction | null} [deps.transaction] مُشغّل معاملة، يُمرَّر حين
 *   تكون المستودعات على قاعدة كي تصير العمليات المركّبة ذرّية.
 * @returns {StateRegistries}
 */
export function createRegistries({ ca, log, repositories, limits = {}, transaction = null }) {
  const catalog = new DataCatalog({ log, repository: repositories.dataAssets });
  return {
    agents: new AgentRegistry({
      ca,
      log,
      repository: repositories.agents,
      ...(limits.maxAgents === undefined ? {} : { maxAgents: limits.maxAgents }),
    }),
    models: new ModelRegistry({
      log,
      repository: repositories.models,
      transaction,
      ...(limits.maxModels === undefined ? {} : { maxModels: limits.maxModels }),
    }),
    catalog,
    memory: new AgentMemoryStore({
      catalog,
      log,
      repository: repositories.memories,
      transaction,
      ...(limits.maxEntries === undefined ? {} : { maxEntries: limits.maxEntries }),
    }),
    laws: new LawRegistry({ log, repository: repositories.laws }),
  };
}

/**
 * يركّب سجلات الدولة على قاعدة PostgreSQL **مع** ذرّية العمليات المركّبة.
 *
 * هذا هو المدخل المقصود للتشغيل: `createRegistries` وحدها تُركّب على أي
 * مستودعات، وهذه تربطها بمجمّعٍ وتمنحها مُشغّل معاملة، فتصير «تذكّر» و«فعّل»
 * كتابةً واحدة لا كتابتين متتاليتين.
 * @param {object} deps
 * @param {import('pg').Pool} deps.pool
 * @param {import('../root-of-trust/identity.mjs').CertificateAuthority} deps.ca
 * @param {import('../root-of-trust/event-log.mjs').EventLog} deps.log
 * @param {{ maxAgents?: number, maxModels?: number, maxEntries?: number }} [deps.limits]
 * @returns {StateRegistries}
 */
export function createPostgresRegistries({ pool, ca, log, limits = {} }) {
  /** @type {StateTransaction} */
  const transaction = (work) =>
    withUnitOfWork(pool, (repositories) =>
      // المستودعات داخل المعاملة تُركّب سجلاتٍ جديدة بنفس الحدود ونفس السجل،
      // ولا تُمرَّر لها معاملةٌ أخرى: معاملة داخل معاملة ليست ذرّية.
      work(createRegistries({ ca, log, repositories, limits, transaction: null })),
    );
  return createRegistries({
    ca,
    log,
    repositories: createPostgresRepositories(pool),
    limits,
    transaction,
  });
}
