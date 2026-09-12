// مِقبضُ الاستدلالِ: البوابةُ وعقدُ مُوائمِها والمُوائمُ الحتميُّ.
//
// ويُصدَّرُ ما يُنادى من خارجِ المجلَّدِ وحدَه: فمن صدَّرَ كلَّ سطرٍ لم يُعلن
// عقداً بل أعلنَ أنّ كلَّ تفصيلٍ داخليٍّ قابلٌ لأن يُنادى من أيِّ مكانٍ.

export * from './inference-gate.mjs';
export {
  ADAPTER_ERRORS,
  ADAPTER_NETWORK_STATES,
  ADAPTER_TRANSPORTS,
  assertAdapterDeclaration,
  assertAdapterResult,
  executorFor,
  FORBIDDEN_RESULT_FIELDS,
  InferenceAdapterError,
  isEnvName,
  looksLikeSecret,
  MAX_ADAPTER_TIMEOUT_MS,
} from './adapters/contract.mjs';
export {
  createHttpsAdapter,
  HTTPS_ADAPTER_DEFAULT_TIMEOUT_MS,
  HTTPS_ADAPTER_MAX_RESPONSE_BYTES,
  httpsExecutor,
  REDACTION_MARK,
} from './adapters/https.mjs';
export {
  createDeterministicAdapter,
  DETERMINISTIC_ADAPTER_ID,
  DETERMINISTIC_TIMEOUT_MS,
  deterministicExecutor,
} from './adapters/deterministic.mjs';
