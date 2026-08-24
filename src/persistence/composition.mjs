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

import { ClassificationApprovalRegistry } from '../data/approvals.mjs';
import { loadClassificationLattice } from '../data/classification.mjs';
import { DataAccessGate } from '../data/access-gate.mjs';
import { DataCatalog } from '../data/data-catalog.mjs';
import { DataEncryptor, loadEncryptionPolicy } from '../data/encryption.mjs';
import { AgentMemoryStore } from '../data/memory-store.mjs';
import { LawRegistry } from '../governance/law-system.mjs';
import { AgentRegistry } from '../identity/agent-registry.mjs';
import path from 'node:path';
import { ModelRegistry } from '../models/model-registry.mjs';
import { createWeightStore } from '../models/weight-store.mjs';
import {
  AGENT_SPEC,
  CLASSIFICATION_APPROVAL_SPEC,
  DATA_ASSET_SPEC,
  LAW_SPEC,
  MEMORY_SPEC,
  MODEL_SPEC,
} from './entities.mjs';
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
 * @property {ReturnType<typeof createMemoryRepository>} classificationApprovals
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
 * @property {DataAccessGate} accessGate
 * @property {DataEncryptor | null} encryptor
 * @property {AgentMemoryStore} memory
 * @property {LawRegistry} laws
 * @property {ClassificationApprovalRegistry} approvals
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
    classificationApprovals: createMemoryRepository(CLASSIFICATION_APPROVAL_SPEC, options),
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
      classificationApprovals: createPostgresRepository(pool, CLASSIFICATION_APPROVAL_SPEC),
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
 * @param {import('../models/weight-store.mjs').WeightStore | null} [deps.weightStore] مخزن
 *   الأوزان المعنوَن بالمحتوى (M6.06). إن لم يُمرَّر فُتحيّز الجذر من `WEIGHTS_DIR`
 *   أو `.state/weights`؛ فالتنشيط لا يقع بلا إعادة حساب البصمة في أي تركيب.
 * @param {{ report: (signal: object) => unknown } | null} [deps.quarantine] حاجب الحجر (M6.09).
 * @param {import('../policy/enforcement-point.mjs').EnforcementPoint | null} [deps.enforcementPoint] نقطة
 *   التفويض (M7.01). من لم يمرّرها حصل على فهرسٍ يسجّل ويقرأ، و**تُرفض** عنده
 *   إعادة التصنيف برمز `CLASSIFICATION_ENFORCEMENT_REQUIRED` — فالفرق معلَن لا مخفيّ.
 * @param {import('../data/classification.mjs').ClassificationLattice | null} [deps.lattice] سلّم
 *   التصنيف؛ يُحمَّل من `config/classification.yaml` إن لم يُمرَّر.
 * @param {import('../root-of-trust/key-provider.mjs').KeyProvider | null} [deps.keyProvider] مزوّد
 *   مفاتيح التشفير عند التخزين (M7.03). من لم يمرّره حصل على مخزن ذاكرةٍ **يرفض**
 *   التذكّر والاستدعاء برمز `MEMORY_ENCRYPTOR_REQUIRED`، ولا يكتب نصّاً صريحاً:
 *   لأن الكتابة نصّاً عند غياب المزوّد تجعل **تركَ المزوّد** أسهلَ طريقٍ إلى
 *   المخزون المكشوف. ولا مزوّد افتراضي في الكود: مفتاحٌ يولّده الكود مفتاحٌ منشور.
 * @param {import('../data/encryption.mjs').EncryptionPolicy | null} [deps.encryptionPolicy] سياسة
 *   التشفير؛ تُحمَّل من `config/encryption.yaml` إن لم تُمرَّر ووُجد مزوّد.
 * @param {string} [deps.environment] البيئة؛ تُقرَّر بها صلاحية المزوّد للإنتاج.
 * @returns {StateRegistries}
 */
export function createRegistries({
  ca,
  log,
  repositories,
  limits = {},
  transaction = null,
  weightStore = null,
  quarantine = null,
  enforcementPoint = null,
  lattice = null,
  keyProvider = null,
  encryptionPolicy = null,
  environment = process.env['STATE_ENV'] ?? process.env['NODE_ENV'] ?? 'development',
}) {
  // السلّم واحد للفهرس ولدفتر الاعتمادات: سلّمان منفصلان يعنيان أن الاعتماد قد
  // يُمنح على اتجاهٍ ويُقرأ اتجاهاً آخر.
  const classificationLattice = lattice ?? loadClassificationLattice();
  const approvals = new ClassificationApprovalRegistry({
    log,
    repository: repositories.classificationApprovals,
    lattice: classificationLattice,
  });
  const catalog = new DataCatalog({
    log,
    repository: repositories.dataAssets,
    lattice: classificationLattice,
    approvals,
    enforcementPoint,
  });
  // بوابة الوصول تُركَّب **دائماً** (الخطوة `M7.02`): لو كانت اختيارية لصار تركُها
  // مساراً لقراءةٍ بلا قرار — وهو بالضبط ما أغلقته هذه الخطوة. وهي بلا نقطة تفويض
  // ترفض كل قراءة وكتابة، فالتركيب الناقص يظهر رفضاً لا سماحاً.
  const accessGate = new DataAccessGate({
    log,
    catalog,
    lattice: classificationLattice,
    enforcementPoint,
    quarantine,
  });
  // المغلِّف يُركَّب حين يوجد مزوّد مفاتيح، ولا يُختلق مزوّد: مفتاحٌ يولّده الكود في
  // الذاكرة يضيع عند الإقلاع فيصير كل ما كُتب غير قابل للفكّ — فقدُ بيانات باسم
  // التشفير. وغيابُ المزوّد يُقرأ **رفضاً** في مخزن الذاكرة لا كتابةً نصّاً.
  const encryptor =
    keyProvider === null
      ? null
      : new DataEncryptor({
          policy: encryptionPolicy ?? loadEncryptionPolicy({ lattice: classificationLattice }),
          lattice: classificationLattice,
          keyProvider,
          environment,
        });
  // مخزن الأوزان يُركَّب دائماً: لو كان اختياريّاً لصار تركه مساراً لتنشيطٍ
  // بلا فحص بصمة، وهو بالضبط ما يمنعه M6.06.
  const weights =
    weightStore ??
    createWeightStore({
      root: process.env['WEIGHTS_DIR'] ?? path.join(process.cwd(), '.state/weights'),
    });
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
      weightStore: weights,
      quarantine,
      ...(limits.maxModels === undefined ? {} : { maxModels: limits.maxModels }),
    }),
    catalog,
    accessGate,
    encryptor,
    memory: new AgentMemoryStore({
      catalog,
      log,
      repository: repositories.memories,
      transaction,
      accessGate,
      encryptor,
      ...(limits.maxEntries === undefined ? {} : { maxEntries: limits.maxEntries }),
    }),
    laws: new LawRegistry({ log, repository: repositories.laws }),
    approvals,
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
 * @param {import('../policy/enforcement-point.mjs').EnforcementPoint | null} [deps.enforcementPoint] نقطة
 *   التفويض؛ تُمرَّر إلى السجلات داخل المعاملة أيضاً كي لا تصير إعادة التصنيف
 *   الذرّية مساراً بلا قرار.
 * @param {import('../root-of-trust/key-provider.mjs').KeyProvider | null} [deps.keyProvider] مزوّد
 *   مفاتيح التشفير؛ يُمرَّر إلى السجلات داخل المعاملة أيضاً، فمغلِّفان بسياستين في
 *   عمليةٍ واحدة يفتحان انحرافاً كالذي يفتحه سلّمان.
 * @returns {StateRegistries}
 */
export function createPostgresRegistries({
  pool,
  ca,
  log,
  limits = {},
  enforcementPoint = null,
  keyProvider = null,
}) {
  // السلّم يُحمَّل مرّة واحدة ويُمرَّر إلى السجلات داخل المعاملة أيضاً: تحميلُه في كل
  // معاملة يقرأ الملف على كل كتابة، وسلّمان في عمليةٍ واحدة يفتحان انحرافاً.
  const classificationLattice = loadClassificationLattice();
  // وسياسة التشفير كذلك: تُقرأ مرّة واحدة، وقراءتها في كل معاملة تفتح الملف على كل
  // كتابة وتجعل تعديلاً وسط التشغيل يُطبَّق على بعض الكتابات دون بعض.
  const policy =
    keyProvider === null ? null : loadEncryptionPolicy({ lattice: classificationLattice });
  /** @type {StateTransaction} */
  const transaction = (work) =>
    withUnitOfWork(pool, (repositories) =>
      // المستودعات داخل المعاملة تُركّب سجلاتٍ جديدة بنفس الحدود ونفس السجل،
      // ولا تُمرَّر لها معاملةٌ أخرى: معاملة داخل معاملة ليست ذرّية.
      work(
        createRegistries({
          ca,
          log,
          repositories,
          limits,
          transaction: null,
          enforcementPoint,
          lattice: classificationLattice,
          keyProvider,
          encryptionPolicy: policy,
        }),
      ),
    );
  return createRegistries({
    ca,
    log,
    repositories: createPostgresRepositories(pool),
    limits,
    transaction,
    enforcementPoint,
    lattice: classificationLattice,
    keyProvider,
    encryptionPolicy: policy,
  });
}
