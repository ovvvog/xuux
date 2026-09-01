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
import { loadPolicyBundle } from '../policy/index.mjs';
import { DataAccessGate } from '../data/access-gate.mjs';
import { DataCatalog } from '../data/data-catalog.mjs';
import { DataEncryptor, loadEncryptionPolicy } from '../data/encryption.mjs';
import { ErasureLedger } from '../data/erasure-ledger.mjs';
import { EventBus, loadEventsPolicy } from '../events/index.mjs';
import {
  DelegationRegister,
  RegionalDelegation,
  loadDelegationPolicy,
} from '../federation/index.mjs';
import { RoyalReportGenerator, createReportMeasures, loadReportPolicy } from '../reports/index.mjs';
import { MonitorAgent, loadMonitoringPolicy } from '../observability/index.mjs';
import { ApiGateway, loadApiPolicy } from '../api/index.mjs';
import { RoyalConsole, loadConsolePolicy } from '../console/index.mjs';
import { KingAuthenticator, loadKingAuthPolicy } from '../authn/index.mjs';
import {
  OperationsCenter,
  loadOperationsPolicy,
  quotaReaderFromPolicy,
} from '../operations/index.mjs';
import { CrisisRoom, loadCrisisPolicy } from '../crisis/index.mjs';
import { AuditLogViewer, loadAuditViewerPolicy } from '../audit-viewer/index.mjs';
import { LineageLedger } from '../data/lineage.mjs';
import { AgentMemoryStore } from '../data/memory-store.mjs';
import { RetentionCycle } from '../data/retention-cycle.mjs';
import { LawRegistry } from '../governance/law-system.mjs';
import { AgentRegistry } from '../identity/agent-registry.mjs';
import {
  InstitutionMandate,
  InstitutionOperations,
  createServiceCatalogExecutor,
  createStatisticalBulletinExecutor,
  effectIndex,
  loadInstitutionsPolicy,
  loadMandatesPolicy,
} from '../institutions/index.mjs';
import {
  Judiciary,
  createAgentSuspensionExecutor,
  executorIndex,
  loadJudiciaryPolicy,
} from '../judiciary/index.mjs';
import path from 'node:path';
import { ModelRegistry } from '../models/model-registry.mjs';
import { ModelEvaluationLedger } from '../models/evaluation.mjs';
import { ExperimentLedger } from '../knowledge/experiment-ledger.mjs';
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
  INSTITUTION_SPEC,
  INSTITUTION_TASK_SPEC,
  INSTITUTION_OUTPUT_SPEC,
  INSTITUTION_MANDATE_SPEC,
  INSTITUTION_BREACH_SPEC,
  INSTITUTION_REPORT_CYCLE_SPEC,
  FEDERATION_DELEGATION_SPEC,
  FEDERATION_ACT_SPEC,
  FEDERATION_REFUSAL_SPEC,
  FEDERATION_REGISTER_SPEC,
  ROYAL_REPORT_SPEC,
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
 * @property {ReturnType<typeof createMemoryRepository>} institutions
 * @property {ReturnType<typeof createMemoryRepository>} institutionTasks
 * @property {ReturnType<typeof createMemoryRepository>} institutionOutputs
 * @property {ReturnType<typeof createMemoryRepository>} institutionMandates
 * @property {ReturnType<typeof createMemoryRepository>} institutionBreaches
 * @property {ReturnType<typeof createMemoryRepository>} institutionReportCycles
 * @property {ReturnType<typeof createMemoryRepository>} federationDelegations
 * @property {ReturnType<typeof createMemoryRepository>} federationActs
 * @property {ReturnType<typeof createMemoryRepository>} federationRefusals
 * @property {ReturnType<typeof createMemoryRepository>} federationRegister
 * @property {ReturnType<typeof createMemoryRepository>} royalReports
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
 * @property {InstitutionOperations} institutions
 * @property {RegionalDelegation} federation
 * @property {DelegationRegister} federationRegister
 * @property {RoyalReportGenerator} reports
 * @property {MonitorAgent} monitor
 * @property {ApiGateway} api
 * @property {RoyalConsole} royalConsole
 * @property {KingAuthenticator} kingAuth
 * @property {OperationsCenter} operations
 * @property {CrisisRoom} crisis
 * @property {AuditLogViewer} auditViewer
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
    institutions: createMemoryRepository(INSTITUTION_SPEC, options),
    institutionTasks: createMemoryRepository(INSTITUTION_TASK_SPEC, options),
    institutionOutputs: createMemoryRepository(INSTITUTION_OUTPUT_SPEC, options),
    institutionMandates: createMemoryRepository(INSTITUTION_MANDATE_SPEC, options),
    institutionBreaches: createMemoryRepository(INSTITUTION_BREACH_SPEC, options),
    institutionReportCycles: createMemoryRepository(INSTITUTION_REPORT_CYCLE_SPEC, options),
    federationDelegations: createMemoryRepository(FEDERATION_DELEGATION_SPEC, options),
    federationActs: createMemoryRepository(FEDERATION_ACT_SPEC, options),
    federationRefusals: createMemoryRepository(FEDERATION_REFUSAL_SPEC, options),
    federationRegister: createMemoryRepository(FEDERATION_REGISTER_SPEC, options),
    royalReports: createMemoryRepository(ROYAL_REPORT_SPEC, options),
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
      institutions: createPostgresRepository(pool, INSTITUTION_SPEC),
      institutionTasks: createPostgresRepository(pool, INSTITUTION_TASK_SPEC),
      institutionOutputs: createPostgresRepository(pool, INSTITUTION_OUTPUT_SPEC),
      institutionMandates: createPostgresRepository(pool, INSTITUTION_MANDATE_SPEC),
      institutionBreaches: createPostgresRepository(pool, INSTITUTION_BREACH_SPEC),
      institutionReportCycles: createPostgresRepository(pool, INSTITUTION_REPORT_CYCLE_SPEC),
      federationDelegations: createPostgresRepository(pool, FEDERATION_DELEGATION_SPEC),
      federationActs: createPostgresRepository(pool, FEDERATION_ACT_SPEC),
      federationRefusals: createPostgresRepository(pool, FEDERATION_REFUSAL_SPEC),
      federationRegister: createPostgresRepository(pool, FEDERATION_REGISTER_SPEC),
      royalReports: createPostgresRepository(pool, ROYAL_REPORT_SPEC),
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
 * @param {import('../models/evaluation.mjs').ModelEvaluationLedger | null} [deps.evaluationLedger] دفترُ
 *   تقييمِ النماذج (M6.07). صُحّح في `WL-045`: كان التركيبُ لا يُمرّره إلى السجل
 *   الداخليِّ المعاملاتيِّ فيُبنى دفترٌ فارغٌ جديد، فيصير التنشيطُ على قاعدةٍ
 *   حقيقيةٍ مستحيلاً برمز `MODEL_EVALUATION_MISSING`. فمن مرَّره حصل على دفترٍ
 *   واحدٍ يشهد للتركيبين، ومن لم يمرّره حصل على دفترٍ يُبنى له مرّةً واحدة.
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
 * @param {import('../institutions/institutions.mjs').InstitutionsPolicy | null} [deps.institutionsPolicy] عهدُ
 *   التشغيل المؤسسي (M8.05): حائزو الأفعال، وإجراءُ المهمّة، وحدُّ الميزانية،
 *   والآثارُ المُعلَنة، والمؤسستان التجريبيتان. يُحمَّل من `config/institutions.yaml`
 *   إن لم يُمرَّر.
 * @param {import('../institutions/mandate.mjs').MandatesPolicy | null} [deps.mandatesPolicy] نموذجُ
 *   التشغيل المؤسسي (M8.06): الاختصاصُ والصلاحياتُ وسقفُ المدّةِ والمساءلةُ ومدّةُ
 *   التقرير الدوريِّ لكلِّ مؤسسةٍ مُشغَّلة. يُحمَّل من
 *   `config/institutional-mandates.yaml` إن لم يُمرَّر.
 * @param {import('../federation/delegation.mjs').DelegationPolicy | null} [deps.delegationPolicy] وثيقةُ
 *   التفويض الترابي (M8.07): الإقليمُ المعزولُ ومستوياتُه الثلاثةُ وصلاحياتُ كلِّ
 *   مستوى ودورُ ممارستها والصلاحياتُ المحجوزةُ للمركز. تُحمَّل من
 *   `config/federation-delegation.yaml` إن لم تُمرَّر.
 * @param {import('../reports/royal-report.mjs').ReportPolicy | null} [deps.reportsPolicy] وثيقةُ
 *   التقاريرِ الملكيةِ الدورية (M8.09): نافذةُ التقريرِ وأقسامُه وحقولُ كلِّ قسمٍ
 *   ومصادرُ قياسِها ومسارُ مراجعتِها ونشرِها. تُحمَّل من `config/royal-reports.yaml`
 *   إن لم تُمرَّر.
 * @param {import('../observability/monitor-agent.mjs').MonitoringPolicy | null} [deps.monitoringPolicy] وثيقةُ
 *   المراقبةِ للقراءةِ فقط (M9.01): دورُ المراقبةِ وقدراتُه المسموحةُ ونداءاتُه
 *   المقروءةُ ومشاهدُه وحدُّ صفوفِه. تُحمَّل من `config/monitoring.yaml` إن لم
 *   تُمرَّر.
 * @param {import('../api/gateway.mjs').ApiPolicy | null} [deps.apiPolicy] وثيقةُ
 *   طبقةِ الواجهةِ الداخلية (M9.02): مساراتُها المُعلَنةُ وأفعالُها ومشاهدُها،
 *   ومهلةُ جلستِها، وحدُّ معدَّلِها، وأحداثُ تدقيقِها، ورموزُ رفضِها وضماناتُها.
 *   تُحمَّل من `config/api.yaml` إن لم تُمرَّر.
 * @param {{ command: (command: import('../root-of-trust/crown.mjs').RoyalCommand, signature: string) => unknown } | null} [deps.crown] بوابةُ
 *   التاج. من لم يمرّرها حصل على قضاءٍ يسمع ويحكم ويستأنف، و**يرفض** تنفيذَ الحكم
 *   والتراجعَ عنه برمز `JUDICIARY_ROYAL_COMMAND_REQUIRED`؛ فالفرقُ معلَنٌ لا مخفيّ.
 * @param {import('../console/royal-console.mjs').ConsolePolicy | null} [deps.consolePolicy] وثيقةُ
 *   الديوانِ الملكيّ (M9.03): مشاهدُه المُعلَنةُ ومساراتُها في طبقةِ الواجهة،
 *   وأوامرُه بأفعالِها وأهدافِها ومساراتِها، وأحداثُ تدقيقِه، ورموزُ رفضِه
 *   وضماناتُه. تُحمَّل من `config/royal-console.yaml` إن لم تُمرَّر.
 * @param {import('../authn/king-auth.mjs').KingAuthPolicy | null} [deps.authnPolicy] وثيقةُ
 *   مصادقةِ الملكِ القوية (M9.04): جهازُه الموثوقُ وعاملُه الثاني ومهلةُ جلستِه
 *   وأنواعُ الأوامرِ المُشترَطة. تُحمَّل من `config/king-authentication.yaml` إن
 *   لم تُمرَّر.
 * @param {import('../authn/king-auth.mjs').FactorSecretsLike | null} [deps.factorSecrets] مزوِّدُ
 *   سرِّ العاملِ الثاني. من لم يمرّره حصل على مصادقةٍ **ترفض** بـ`AUTHN_SECRET_MISSING`
 *   لا على مصادقةٍ تتخطّى العامل؛ فالنقصُ رفضٌ مُسمّىً لا سماحٌ صامت.
 * @param {import('../console/royal-console.mjs').ConsoleHaltLike | null} [deps.haltSwitch] زرُّ
 *   الإيقافِ الشامل. من لم يمرّره حصل على ديوانٍ يقرأ ويَنقُض، و**يرفض** الإيقافَ
 *   والاستئنافَ برمز `CONSOLE_HALT_REQUIRED`؛ فالنقصُ يظهر رفضاً لا سماحاً.
 * @param {import('../console/royal-console.mjs').ConsoleKingLike | null} [deps.king] هويةُ
 *   الملك. لازمةٌ لمسارِ التعافي وحده (رفعُ النقضِ والاستئنافُ) لأنه لا يمرّ ببوابةِ
 *   التاج؛ ومن لم يمرّرها رُفض تعافيه بـ`CONSOLE_KING_REQUIRED`.
 * @param {import('../console/royal-console.mjs').ConsoleLedgerLike | null} [deps.commandLedger] دفترُ
 *   الأوامرِ الدائم. يمنع إعادةَ إرسالِ أمرِ تعافٍ موقَّعٍ بعد إعادةِ التشغيل؛
 *   وغيابُه يحصر منعَ الإعادةِ في ذاكرةِ العمليةِ الواحدة وذاك حدٌّ معلَن.
 * @param {import('../operations/operations-center.mjs').OperationsPolicy | null} [deps.operationsPolicy] وثيقةُ
 *   مركزِ العمليات (M9.05): لوحاتُه الخمسُ ومصادرُها، ومهلةُ ظهورِ الحادثةِ
 *   المُعلَنةُ، وسعةُ سجلِّ الحوادثِ ودرجاتُها، وأحداثُ تدقيقِه، ورموزُ رفضِه
 *   وضماناتُه. تُحمَّل من `config/operations-center.yaml` إن لم تُمرَّر.
 * @param {import('../crisis/crisis-room.mjs').CrisisPolicy | null} [deps.crisisPolicy] وثيقةُ
 *   غرفةِ الأزمات (M9.06): إجراءاتُها وترتيبُ خطواتِها، ونطاقاتُ الحجْرِ وحدُّ سببِه،
 *   وجهاتُ التصعيدِ ومهلةُ إقرارِها، ومدّةُ التمرينِ وأحداثُ تدقيقِه ورموزُ رفضِه.
 *   تُحمَّل من `config/crisis-room.yaml` إن لم تُمرَّر.
 * @param {(() => ReadonlyArray<{ type: string, actor: string, data: Record<string, unknown> }>) | null} [deps.crisisEvidence] قارئُ
 *   دليلِ التمرينِ من **السجلِّ الدائمِ على القرص**. من لم يمرّره حصل على غرفةٍ
 *   تُدير الأزمةَ و**ترفض** إغلاقَ التمرينِ بـ`CRISIS_EVIDENCE_MISSING`؛ فالنقصُ
 *   رفضٌ مُسمّى لا إغلاقٌ على شهادةِ ذاكرةٍ عن نفسِها.
 * @param {import('../audit-viewer/audit-log-viewer.mjs').AuditViewerPolicy | null} [deps.auditViewerPolicy] وثيقةُ
 *   عارضِ سجلِّ التدقيق (M9.07): مشاهدُهُ الثلاثةُ بأوجهِها ومصدرِها، وحقولُ
 *   بحثِه وحدودُه، وأسبابُ انكسارِ السلسلةِ ورموزُ رفضِه. تُحمَّل من
 *   `config/audit-log-viewer.yaml` إن لم تُمرَّر.
 * @param {ReadonlyArray<{ id: string, check: () => { status: string, detail?: string } | Promise<{ status: string, detail?: string }> }> | null} [deps.healthProbes] مسابرُ
 *   صحةٍ للوحةِ الصحة. من لم يمرّرها حصل على لوحةٍ **تُرَدُّ** بـ`OPERATIONS_SOURCE_MISSING`
 *   لا على لوحةٍ فارغةٍ تُقرأ «صحيحةً»؛ فصفرٌ بلا مصدرٍ كذبٌ مُطمئن.
 * @param {ReadonlyArray<{ resource: string, limit: number, unit?: string, windowSeconds: number }> | null} [deps.quotas] حدودُ
 *   الحصصِ الأصلُ للوحتَي السعةِ والتكلفة. تُقرأ من `config/quotas.yaml` عبر
 *   `loadPolicyBundle` إن لم تُمرَّر؛ ومستهلَكُها من `deps.quotaConsumption`، وما لم
 *   يُقَس يُعاد `null` صريحاً لا صفراً.
 * @param {((resource: string) => number | null) | null} [deps.quotaConsumption] قارئُ
 *   المستهلَكِ من كلِّ موردٍ. المركزُ لا يحسب حصّةً ولا يخصم عليها، وهذا حدٌّ معلَن.
 * @param {(() => number) | null} [deps.nowMs] ساعةُ
 *   مركزِ العمليات. تُمرَّر في الاختبارِ لتُقاد المهلةُ صعوداً وهبوطاً؛ وفي التشغيلِ
 *   ساعةُ النظام.
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
  evaluationLedger = null,
  quarantine = null,
  enforcementPoint = null,
  lattice = null,
  keyProvider = null,
  encryptionPolicy = null,
  memoryPolicy = null,
  retentionPolicy = null,
  eventsPolicy = null,
  judiciaryPolicy = null,
  delegationPolicy = null,
  reportsPolicy = null,
  monitoringPolicy = null,
  apiPolicy = null,
  consolePolicy = null,
  authnPolicy = null,
  factorSecrets = null,
  operationsPolicy = null,
  crisisPolicy = null,
  crisisEvidence = null,
  auditViewerPolicy = null,
  healthProbes = null,
  quotas = null,
  quotaConsumption = null,
  nowMs = null,
  haltSwitch = null,
  king = null,
  commandLedger = null,
  institutionsPolicy = null,
  mandatesPolicy = null,
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
  // ونموذجُ التشغيل يُركَّب قبل التشغيلِ المؤسسي لا داخلَ وسائطه (الخطوة `M8.06`):
  // بلا اختصاصٍ مُنفَذٍ تعمل المؤسسةُ بلا حدّ، ولذلك يرفض `InstitutionOperations`
  // الإنشاءَ بلا هذا الوسيط. وإفرادُه باسمٍ يجعل وصلَه مقروءاً في سطرٍ واحد.
  const institutionMandate = new InstitutionMandate({
    policy: mandatesPolicy ?? loadMandatesPolicy(),
    log,
    institutions: repositories.institutions,
    mandates: repositories.institutionMandates,
    breaches: repositories.institutionBreaches,
    cycles: repositories.institutionReportCycles,
    tasks: repositories.institutionTasks,
  });
  // والتفويضُ الترابيُّ يُركَّب قبل بنيةِ الإرجاع لا داخلَ وسائطها (الخطوة `M8.07`):
  // إقليمٌ اختياريُّ التركيبِ يصير إقليماً بلا مسارٍ في التشغيل، فلا يُقاس استقلالُه
  // ولا نفاذُ سحبِ تفويضه. وإفرادُه باسمٍ يجعل وصلَه مقروءاً في موضعٍ واحد.
  // وسجلُّ التفويضاتِ النافذةِ يُركَّب معه (الخطوة `M8.08`) وتُمرَّر إليه بوابةُ التاج:
  // بلا بوابةٍ لا تفعيلَ ولا سحب، وبلا سجلٍّ لا يُقاس نفاذُ السحبِ ولا يُقرأ النافذُ
  // الآن من سلسلةِ أوامرَ يُراجَع أثرُها.
  const delegationRegister = new DelegationRegister({
    repository: repositories.federationRegister,
    log,
  });
  const regionalDelegation = new RegionalDelegation({
    policy: delegationPolicy ?? loadDelegationPolicy(),
    log,
    delegations: repositories.federationDelegations,
    acts: repositories.federationActs,
    refusals: repositories.federationRefusals,
    register: delegationRegister,
    crown,
  });
  // والتقريرُ الملكيُّ الدوريُّ يُركَّب **دائماً** (الخطوة `M8.09`)، لنفس سببِ
  // المؤسسةِ والإقليم: تقريرٌ اختياريُّ التركيبِ يصير تقريراً لا مسارَ له في
  // التشغيل، فلا يُقاس منه حالُ الدولةِ ولا مخاطرُها. والمقاييسُ مبنيّةٌ على
  // المستودعاتِ نفسِها وعلى سجلِّ السيادة، وبوابةُ التاجِ وسجلُّ الهوياتِ موصولان:
  // بلا الأولِ لا نشرَ، وبلا الثاني لا مراجعةَ بشريةً تُقاس.
  const royalReports = new RoyalReportGenerator({
    policy: reportsPolicy ?? loadReportPolicy(),
    reports: repositories.royalReports,
    measures: createReportMeasures({ repositories, register: delegationRegister }),
    agents,
    crown,
  });
  // ووكيلُ المراقبةِ للقراءةِ فقط يُركَّب **دائماً** (الخطوة `M9.01`): مراقبةٌ
  // اختياريةُ التركيبِ تصير مراقبةً لا مسارَ لها، فيعود القارئُ إلى المستودعاتِ
  // كما هي — أي إلى القراءةِ بسلطةِ كتابةٍ معها، وهو العيبُ نفسُه. والسجلُّ
  // والهوياتُ موصولان: بلا الأولِ لا قراءةَ (لا أثرَ تدقيق)، وبلا الثاني لا
  // قراءةَ (لا هويةَ محقَّقة).
  const monitor = new MonitorAgent({
    policy: monitoringPolicy ?? loadMonitoringPolicy(),
    repositories,
    agents,
    log,
  });
  // وبوابةُ الواجهةِ الداخليةِ تُركَّب **دائماً** (الخطوة `M9.02`)، لنفسِ السبب:
  // بوابةٌ اختياريةُ التركيبِ تصير بوابةً يُلتفّ حولها بنداءِ الوكيلِ مباشرةً بلا
  // جلسةٍ ولا حدِّ معدَّلٍ ولا مرورٍ بنقطةِ التفويض. وما ينقص من وصلاتِها يظهر
  // **رفضاً** لا سماحاً: بلا نقطةِ تفويضٍ لا نداءَ، وبلا سجلٍّ لا نداءَ، وبلا
  // سجلِّ هوياتٍ لا جلسة.
  const api = new ApiGateway({
    policy: apiPolicy ?? loadApiPolicy(),
    log,
    agents,
    monitor,
    enforcementPoint,
  });
  // والديوانُ الملكيُّ يُركَّب **دائماً** (الخطوة `M9.03`): ديوانٌ اختياريُّ
  // التركيبِ يعني أن ممارسةَ السلطةِ تعود إلى نداءِ `crown.stop()` أو
  // `veto.block()` من داخلِ الكودِ بلا أمرٍ موقَّعٍ ولا قيدٍ دائم — وهو العيبُ
  // نفسُه الذي جاءت الخطوةُ لتغلقه. وما ينقص من وصلاتِه يظهر **رفضاً** مُسمّى:
  // بلا سجلٍّ لا أمرَ ولا مشهد، وبلا بوابةِ تاجٍ لا أمرَ على مسارِها، وبلا زرِّ
  // إيقافٍ لا إيقافَ ولا استئناف، وبلا هويةِ ملكٍ لا تعافي.
  //
  // وبوابةُ التاجِ تُقرأ بعقدِ الديوانِ لا بعقدِ القضاء: القضاءُ لا يحتاج منها
  // إلا `command`، والديوانُ يحتاج معها حقَّ النقضِ وحالَ التوقّف. فبوابةٌ لا
  // تحمل `veto` ليست بوابةَ ديوانٍ، ويُقرأ غيابُها رفضاً لا يُفترَض حضورُها.
  const royalCrown =
    crown !== null && 'veto' in crown
      ? /** @type {import('../console/royal-console.mjs').ConsoleCrownLike} */ (
          /** @type {unknown} */ (crown)
        )
      : null;
  // ومصادقةُ الملكِ تُركَّب **دائماً** (الخطوة `M9.04`) بلا شرطٍ واحد: شرطٌ على
  // تركيبِها شرطٌ على العاملِ الثاني، ومن لم يستوفِه أصدر أمراً سيادياً بمفتاحِ
  // توقيعٍ وحده — وهو العيبُ الذي جاءت الخطوةُ لتغلقه. وما ينقص من وصلاتِها
  // يظهر **رفضاً** مُسمّى: بلا مزوِّدِ أسرارٍ لا عاملَ ثانٍ فتُرَدُّ المصادقةُ
  // بـ`AUTHN_SECRET_MISSING`، وبلا هويةِ ملكٍ تُرَدُّ بـ`AUTHN_IDENTITY_UNVERIFIED`،
  // وبلا سجلٍّ لا مصادقةَ أصلاً.
  const kingAuth = new KingAuthenticator({
    policy: authnPolicy ?? loadKingAuthPolicy(),
    king,
    log,
    factorSecrets,
  });
  const royalConsole = new RoyalConsole({
    policy: consolePolicy ?? loadConsolePolicy(),
    gateway: api,
    crown: royalCrown,
    haltSwitch,
    king,
    kingAuth,
    commandLedger,
    log,
  });
  // ومركزُ العملياتِ يُركَّب **دائماً** (الخطوة `M9.05`)، لنفسِ سببِ الديوانِ
  // والمراقبة: مركزٌ اختياريُّ التركيبِ يعني أن حالَ التشغيلِ يعود إلى قراءةِ
  // سجلِّ أحداثٍ باليدِ وحسابِ الحصصِ ذهناً — أي تشغيلٌ **يُستنبَط** لا تشغيلٌ
  // يُرى، وهو العيبُ الذي جاءت الخطوةُ لتغلقه. وما ينقص من وصلاتِه يظهر **رفضاً**
  // مُسمّى: بلا سجلٍّ دائمٍ لا لوحةَ ولا حادثة (`OPERATIONS_AUDIT_REQUIRED`)، وبلا
  // طبقةِ واجهةٍ لا لوحةَ على مسارٍ مُعلَن (`OPERATIONS_GATEWAY_REQUIRED`)، وبلا
  // مزوِّدٍ داخليٍّ تُرَدُّ لوحتُه (`OPERATIONS_SOURCE_MISSING`) ولا تُقرأ فارغة.
  //
  // وطبقةُ الواجهةِ تُمرَّر هي لا المستودعاتُ: لوحةُ المهامِ تُقرأ من مسارٍ مُعلَنٍ
  // في `config/api.yaml` فتَرِث الجلسةَ وحدَّ المعدَّلِ ونقطةَ التفويضِ والتدقيق.
  // ولو قرأ المركزُ مستودعاً مباشرةً لبنى المسارَ الجانبيَّ الذي أُغلق في `M4.05`
  // وسمّاه «مركزَ عمليات».
  //
  // وحدودُ الحصصِ تُقرأ من `config/quotas.yaml` عبر حزمةِ الوثائقِ لا من أرقامٍ
  // في الكود: رقمٌ بلا أصلٍ رقمٌ مخترَع. والمستهلَكُ من مزوِّدٍ خارجَ الوحدةِ،
  // فالمركزُ يعرض ولا يحسب.
  const operations = new OperationsCenter({
    policy: operationsPolicy ?? loadOperationsPolicy(),
    log,
    gateway: api,
    healthProbes,
    quotaReader: quotaReaderFromPolicy({
      quotas: quotas ?? loadPolicyBundle().quotas,
      ...(quotaConsumption === null ? {} : { consumed: quotaConsumption }),
    }),
    ...(nowMs === null ? {} : { nowMs }),
  });
  // وغرفةُ الأزمات (`M9.06`): إجراءٌ معلَنٌ بترتيبٍ محفوظٍ فوق ما بُني قبله، لا
  // محرّكٌ جديدٌ تحته. فالأمرُ السياديُّ يمرّ بالديوانِ المُمرَّرِ نفسِه — بتوقيعِه
  // وتاجِه وجلستِه القوية — والحادثةُ تُقيَّد في مركزِ العملياتِ فتَرِث مهلتَه
  // ولوحتَه، والحجْرُ يقع في سجلِّ الهوياتِ فيرُدُّ صاحبَه `requireActiveIdentity`
  // في طبقةِ الواجهةِ عند أوّلِ نداءٍ بعده. ولو مرّرنا لها زرَّ الإيقافِ مباشرةً
  // لبنينا طريقاً حولَ حواجزِ `M9.03` و`M9.04` وسمّيناه «إجراءَ طوارئ».
  const crisis = new CrisisRoom({
    policy: crisisPolicy ?? loadCrisisPolicy(),
    console: royalConsole,
    operations,
    agents,
    log,
    ...(crisisEvidence === null ? {} : { evidence: crisisEvidence }),
    ...(nowMs === null ? {} : { nowMs }),
  });
  // وعارضُ سجلِّ التدقيق (`M9.07`): سطحُ قراءةٍ محضٌ على **عينِ** السجلِّ
  // الدائمِ الذي تكتب فيه الطبقاتُ كلُّها أثرَها، لا على نسخةٍ ثانيةٍ تُقرأ سجلّاً
  // غيرَ الذي تشهد عليه الدولة. ولا مستودعَ في يدِه ولا نداءَ كتابةٍ واحدٌ على
  // المفحوص: يقرأ بـ`inspectEventLog` ويكتب أثرَ قراءتِه في السجلِّ نفسِه **قبل**
  // أن يفتحَه، ويُعيد مع كلِّ مشهدٍ حكمَ سلامةِ السلسلةِ مقروءاً من نفسِ القراءة.
  const auditViewer = new AuditLogViewer({
    policy: auditViewerPolicy ?? loadAuditViewerPolicy(),
    log,
    ...(nowMs === null ? {} : { nowMs }),
  });
  return {
    agents,
    monitor,
    api,
    kingAuth,
    royalConsole,
    operations,
    crisis,
    auditViewer,
    models: new ModelRegistry({
      log,
      repository: repositories.models,
      transaction,
      weightStore: weights,
      quarantine,
      // دفتر التقييم يُمرَّر إن أُعطي، ولا يُخترع هنا واحدٌ آخر: التفعيل يجري داخل
      // معاملة، والمعاملة تُركّب سجلاتٍ جديدة. فلو أنشأ كلُّ تركيبٍ دفتراً خاصّاً
      // به لقرأ التفعيلُ دفتراً فارغاً ورفض بـ`MODEL_EVALUATION_MISSING` نموذجاً
      // مقيَّماً فعلاً — وهو عيبٌ حقيقيٌّ أخفق به تفعيلُ **كل** نموذج على
      // PostgreSQL، لم يظهر لأن اختبارات القاعدة كانت متخطّاةً دائماً (`WL-045`).
      ...(evaluationLedger === null ? {} : { evaluationLedger }),
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
      // وسجلُ الهويات موصولٌ لا متروك: منه يُقرأ مالكُ الخصم في فحص المصالح
      // (الخطوة M8.04) وبشريةُ المراجع. وتركُه لا يفتح الباب بل يُغلقه: السماعُ
      // يُرفض حينها برمز `JUDICIARY_INTEREST_SCREENING_UNAVAILABLE`.
      agents,
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
    // التشغيلُ المؤسسي يُركَّب **دائماً** (الخطوة `M8.05`)، لنفس سبب القضاء
    // وناقلِ القنوات: مؤسسةٌ اختياريةُ التركيب تصير مؤسسةً لا مسارَ لها في
    // التشغيل، وهو العيبُ الذي أغلقته الخطوة بعينه. وسجلُّ الهويات موصولٌ لا
    // متروك: منه تُقرأ حالةُ الوكيل ودورُه، وبلا ذلك يصير الإسنادُ اسماً في عمود.
    institutions: new InstitutionOperations({
      policy: institutionsPolicy ?? loadInstitutionsPolicy(),
      log,
      institutions: repositories.institutions,
      tasks: repositories.institutionTasks,
      outputs: repositories.institutionOutputs,
      agents,
      // ونموذجُ التشغيل موصولٌ لا متروك (الخطوة `M8.06`): بلا اختصاصٍ مُنفَذٍ
      // تعمل المؤسسةُ بلا حدٍّ، وهو العيبُ الذي أغلقته الخطوةُ بعينه. ولذلك
      // يرفض `InstitutionOperations` الإنشاءَ بلا هذا الوسيط لا يعمل بدونه.
      mandate: institutionMandate,
      effects: effectIndex([
        createServiceCatalogExecutor({ outputs: repositories.institutionOutputs }),
        createStatisticalBulletinExecutor({ outputs: repositories.institutionOutputs }),
      ]),
    }),
    // والتفويضُ الترابيُّ موصولٌ **دائماً** (الخطوة `M8.07`)، لنفس سببِ المؤسسة:
    // إقليمٌ لا مسارَ له في التشغيلِ لا يُمارِس فعلاً ولا يُوقفه سحبُ تفويضٍ، فلا
    // يبقى لمعيارِ القبولِ ما يُقاس عليه.
    federation: regionalDelegation,
    federationRegister: delegationRegister,
    reports: royalReports,
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
  // ودفتر التقييم واحدٌ للتركيب كلِّه ولِما تُركّبه المعاملة داخله: دفترٌ لكل
  // معاملة يعني أن شهادة التقييم تُكتب في دفترٍ ويُسأل عنها دفترٌ آخر.
  const evaluationLedger = new ModelEvaluationLedger({
    log,
    experiments: new ExperimentLedger({ log }),
  });
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
          evaluationLedger,
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
    evaluationLedger,
  });
}
