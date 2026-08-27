/**
 * مدخلُ طبقة المعرفة — الخطوة M7.08.
 *
 * يُصدِّر سياسةَ المعرفة وسجلَّ التجارب. ولا يُصدِّر مساراً بديلاً للكتابة في
 * المخزن: `config/knowledge.yaml#ledgerHolders` يُعلن الوحدتين الوحيدتين
 * المسموح لهما بلمسه، ويحرس ذلك `npm run guard:knowledge`.
 */

export {
  DEFAULT_KNOWLEDGE_CONFIG_DIR,
  EXPERIMENT_GENESIS,
  ExperimentLedger,
  KNOWLEDGE_ERRORS,
  KnowledgeError,
  createExperimentLedger,
  experimentHash,
  loadKnowledgePolicy,
} from './experiment-ledger.mjs';
