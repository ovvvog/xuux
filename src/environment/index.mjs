// مِقبضُ مسارِ البيئة — الخطوة `M10.05`.
//
// يُصدَّر ما يُنادى من خارجِ المجلَّدِ ولا يُصدَّر ما هو تفصيلٌ داخليّ: فما
// يُصدَّر يصير عقداً يُصان، ومن صدَّر كلَّ شيءٍ لم يُعلن عقداً بل أعلن أنّ كلَّ
// سطرٍ قابلٌ لأن يُنادى من أيِّ مكان.

export {
  DEFAULT_ENVIRONMENT_CONFIG_DIR,
  ENVIRONMENT_PROFILES,
  HEALTH_VERDICTS,
  exitCodeOf,
  loadEnvironmentContract,
} from './contract.mjs';
export { ENV_ERRORS, EnvironmentError } from './errors.mjs';
export { Environment } from './environment.mjs';
export { bootstrapPlan, versionInRange } from './plan.mjs';
export { evaluateProbes, healthVerdict } from './probes.mjs';
export {
  READINESS_STATES,
  declaresReadiness,
  judgeToolReadiness,
  readinessCommandText,
  toolsDeclaringReadiness,
} from './tool-readiness.mjs';
