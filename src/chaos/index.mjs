// مدخلُ مسارِ اختباراتِ الفوضى — الخطوة `M10.09`.
//
// يُصدِّر الحكمَ والعقدَ ودفترَ الانحرافاتِ ورموزَ الرفضِ. **ولا يُصدِّر حقناً
// ولا لمساً للقرصِ**: الحقنُ في `scripts/lib/chaos-facts.mjs` وحدَه.

export { CHAOS_ERRORS, ChaosError } from './errors.mjs';
export {
  DEFAULT_CHAOS_CONFIG_DIR,
  RESILIENT_VERDICT,
  exitCodeFor,
  loadChaosContract,
  requireExperiment,
} from './contract.mjs';
export { assertPlanCovered, assertResult, planExperiments } from './experiment-plan.mjs';
export { assertDeviationsClosed, recordDeviations, requireClosure } from './deviation.mjs';
export { DEVIATED_VERDICT, UNMEASURED_VERDICT, judgeRun } from './judgement.mjs';
