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
import { ErasureLedger } from '../data/erasure-ledger.mjs';
import { EventBus, loadEventsPolicy } from '../events/index.mjs';
import { LineageLedger } from '../data/lineage.mjs';
import { AgentMemoryStore } from '../data/memory-store.mjs';
import { RetentionCycle } from '../data/retention-cycle.mjs';
import { LawRegistry } from '../governance/law-system.mjs';
import { AgentRegistry } from '../identity/agent-registry.mjs';
import {
  Judiciary,
  createAgentSuspensionExecutor,
  executorIndex,
  loadJudiciaryPolicy,
} from '../judiciary/index.mjs';
import path from 'node:path';
import { ModelRegistry } from '../models/model-registry.mjs';
import { createWeightStore } from '../models/weight-store.mjs';
import {
  AGENT_SPEC,
  CLASSIFICATION_APPROVAL_SPEC,
  DATA_ASSET_SPEC,
  DATA_LINEAGE_SPEC,
  ERASURE_RECORD_SPEC,
  EVENT_MESSAGE_SPEC,
  EVENT_OFFSET_SPEC,
  CASE_SPEC,
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
 * @property {ReturnType<typeof createMemoryRepository>} cases
 * @property {ReturnType<typeof createMemoryRepository>} classificationApprovals
 * @property {ReturnType<typeof createMemoryRepository>} dataLineage
 * @property {ReturnType<typeof createMemoryRepository>} erasureRecords
 * @property {ReturnType<typeof createMemoryRepository>} eventMessages
 * @property {ReturnType<typeof createMemoryRepository>} eventOffsets
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
 * @property {Judiciary} judiciary
 * @property {ClassificationApprovalRegistry} approvals
 * @property {LineageLedger} lineage
 * @property {ErasureLedger} erasureLedger
 * @property {RetentionCycle} retention
 * @property {EventBus} events
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
    cases: createMemoryRepository(CASE_SPEC, options),
    classificationApprovals: createMemoryRepository(CLASSIFICATION_APPROVAL_SPEC, options),
    dataLineage: createMemoryRepository(DATA_LINEAGE_SPEC, options),
    erasureRecords: createMemoryRepository(ERASURE_RECORD_SPEC, options),
    eventMessages: createMemoryRepository(EVENT_MESSAGE_SPEC, options),
    eventOffsets: createMemoryRepository(EVENT_OFFSET_SPEC, options),
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
      cases: createPostgresRepository(pool, CASE_SPEC),
      classificationApprovals: createPostgresRepository(pool, CLASSIFICATION_APPROVAL_SPEC),
      dataLineage: createPostgresRepository(pool, DATA_LINEAGE_SPEC),
      erasureRecords: createPostgresRepository(pool, ERASURE_RECORD_SPEC),
      eventMessages: createPostgresRepository(pool, EVENT_MESSAGE_SPEC),
      eventOffsets: createPostgresRepository(pool, EVENT_OFFSET_SPEC),
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
 * @param {import('../data/memory-limits.mjs').MemoryPolicy | null} [deps.memoryPolicy] سياسة حدود
 *   الذاكرة (M7.05): الحصص لكل وكيل، والانتهاء الإلزامي، وعزلُ الوكلاء. تُحمَّل من
 *   `config/memory.yaml` إن لم تُمرَّر، ولا افتراضَ في الكود يغني عنها.
 * @param {import('../data/retention-cycle.mjs').RetentionCyclePolicy | null} [deps.retentionPolicy] سياسة
 *   دورة الاحتفاظ والمحو (M7.06): ترتيبُ الأهداف، وأدوارُ المطهّر، وتوابعُ الأصل
 *   المشهود عليها. تُحمّل من `config/retention.yaml` إن لم تُمرَّر.
 * @param {import('../events/contracts.mjs').EventsPolicy | null} [deps.eventsPolicy] سياسة
 *   قنوات الأحداث (M7.07): القنواتُ ومنتِجوها وقُرّاؤها وعقودُ أنواعها. تُحمّل من
 *   `config/events.yaml` إن لم تُمرَّر.
 * @param {import('../judiciary/judiciary.mjs').JudiciaryPolicy | null} [deps.judiciaryPolicy] وثيقةُ
 *   القضاء (M8.03): حائزو الأفعال، وإجراءُ التقاضي، وآثارُ التنفيذ، وضماناتُه.
 *   تُحمّل من `config/judiciary.yaml` إن لم تُمرَّر.
 * @param {{ command: (command: import('../root-of-trust/crown.mjs').RoyalCommand, signature: string) => unknown } | null} [deps.crown] بوابةُ
 *   التاج. من لم يمرّرها حصل على قضاءٍ يسمع ويحكم ويستأنف، و**يرفض** تنفيذَ الحكم
 *   والتراجعَ عنه برمز `JUDICIARY_ROYAL_COMMAND_REQUIRED`؛ فالفرقُ معلَنٌ لا مخفيّ.
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
  memoryPolicy = null,
  retentionPolicy = null,
  eventsPolicy = null,
  judiciaryPolicy = null,
  crown = null,
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
  // دفتر النسب يُركَّب **دائماً** (الخطوة `M7.04`): لو كان اختيارياً لصار تركُه
  // مساراً لتسجيل أصولٍ بلا مصدرٍ مقيَّد وقراءةٍ بلا أثر نسب — وهو ما أغلقته الخطوة.
  //
  // وقارئُ الأصول هنا هو **المستودع** لا الفهرس: الدفتر يحتاج أن يقرأ تصنيف الأصل
  // وأسلافه، والفهرسُ يحتاج الدفتر ليسجّل. تمريرُ الفهرس إلى الدفتر كان سيصنع
  // اعتماداً دائرياً يُحلّ بتعيينٍ بعد الإنشاء — وحالةٌ تُركَّب على مرحلتين تُنسى
  // مرحلتها الثانية في تركيبٍ آخر. فالدفتر يقرأ المستودع مباشرة، وهو نفسه المصدر.
  const lineage = new LineageLedger({
    log,
    repository: repositories.dataLineage,
    catalog: { get: (id) => repositories.dataAssets.findById(id) },
    lattice: classificationLattice,
  });
  // دفتر شواهد المحو ودورةُ الاحتفاظ يُركّبان **دائماً** (الخطوة `M7.06`)، لنفس سبب
  // دفتر النسب: دفترٌ اختياريٌّ يصير تركُه مساراً لمحوٍ بلا شاهد — وهو العيب الذي
  // أغلقته الخطوة بعينه. والسياسة تُحمّل من `config/retention.yaml`، ومُحمّلُها يرفض
  // أن تختلف أدوارُ المطهّر عن `config/memory.yaml`.
  const erasureLedger = new ErasureLedger({
    log,
    repository: repositories.erasureRecords,
  });
  const catalog = new DataCatalog({
    log,
    repository: repositories.dataAssets,
    lattice: classificationLattice,
    approvals,
    enforcementPoint,
    lineage,
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
    lineage,
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
  const agents = new AgentRegistry({
    ca,
    log,
    repository: repositories.agents,
    ...(limits.maxAgents === undefined ? {} : { maxAgents: limits.maxAgents }),
  });
  const laws = new LawRegistry({ log, repository: repositories.laws });
  return {
    agents,
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
      // الحجر يصل المخزن كما يصل سجل النماذج: تكرارُ محاولةِ عبورِ حدّ وكيلٍ
      // إلى آخر إشارةٌ تُرفع لا رفضٌ يُعدّ في صمت (M7.05).
      quarantine,
      ...(memoryPolicy === null ? {} : { policy: memoryPolicy }),
      ...(limits.maxEntries === undefined ? {} : { maxEntries: limits.maxEntries }),
    }),
    laws,
    // القضاءُ يُركَّب **دائماً** لنفس سبب ناقل القنوات ودفتري النسب والمحو:
    // سلطةٌ اختياريةُ التركيب تصير سلطةً لا مسارَ لها في التشغيل. وهو عيبٌ
    // قائمٌ اليوم في التشريع نفسه: سجلُّ `Legislature` (الخطوة M8.02) غيرُ
    // مُركَّبٍ على أيِّ مسارٍ إنتاجيّ، وهو مسجَّلٌ في `docs/REMAINING_WORK.md` لا
    // مُدَّعىً إغلاقُه.
    //
    // وبوابةُ التاج تُمرَّر من الخارج أو تُترك: قضاءٌ بلا بوابةٍ يسمع ويحكم
    // ويستأنف، ويرفض التنفيذَ والتراجعَ برمز `JUDICIARY_ROYAL_COMMAND_REQUIRED`.
    // وهذا هو الفشلُ المُغلَق: تنفيذُ حكمٍ يمسّ الحقوقَ لا يقع بتركيبٍ صامت.
    judiciary: new Judiciary({
      policy: judiciaryPolicy ?? loadJudiciaryPolicy(),
      laws,
      log,
      repository: repositories.cases,
      crown,
      executors: executorIndex([createAgentSuspensionExecutor({ agents })]),
    }),
    approvals,
    lineage,
    erasureLedger,
    retention: new RetentionCycle({
      log,
      erasureLedger,
      repositories: {
        dataAssets: repositories.dataAssets,
        memories: repositories.memories,
        dataLineage: repositories.dataLineage,
        classificationApprovals: repositories.classificationApprovals,
      },
      ...(retentionPolicy === null ? {} : { policy: retentionPolicy }),
    }),
    // ناقلُ القنوات يُركَّب **دائماً** (الخطوة `M7.07`)، لنفس سبب دفتري النسب
    // والمحو: ناقلٌ اختياريٌّ يصير تركُه مساراً لأحداثٍ تُقرأ بلا تخليصٍ ولا عقد
    // ولا موضعِ قراءة — وهو العيب الذي أغلقته الخطوة.
    events: new EventBus({
      policy: eventsPolicy ?? loadEventsPolicy(),
      lattice: classificationLattice,
      messages: repositories.eventMessages,
      offsets: repositories.eventOffsets,
    }),
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
