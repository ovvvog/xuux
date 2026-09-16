/**
 * وقتٌ مُبرهَنٌ من مصدرٍ موقَّعٍ — مدخلُ الحزمةِ (‏`D-7`، `WL-192`).
 *
 * @module time
 */

export { TIME_ERRORS, TimeError } from './errors.mjs';
export {
  DIALECTS,
  PUBLIC_KEY_LENGTH,
  REQUEST_LENGTH,
  TAGS,
  dialect,
  encodeMessage,
  encodeRequest,
  framePacket,
  parseMessage,
  unframePacket,
  verifyMerklePath,
  verifyResponse,
} from './roughtime.mjs';
export { DEFAULT_TIME_CONFIG_DIR, TimePolicy, TimeSource, loadTimePolicy } from './policy.mjs';
export { AttestedClock } from './attested-clock.mjs';
export { MAX_RESPONSE_BYTES, askSource } from './transport.mjs';
export { TimeWitness, startWitness } from './witness.mjs';
