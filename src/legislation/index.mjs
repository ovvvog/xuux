/**
 * حزمةُ التشريع: وثيقةُ الشرط، ومحرّكُ التعارض، والسلطةُ التي تُصدر وتحلّ
 * (الخطوة M8.02).
 */

export {
  DEFAULT_LEGISLATION_CONFIG_DIR,
  LEGISLATION_ERRORS,
  LegislationError,
  loadLegislationPolicy,
  rolesFor,
} from './legislation.mjs';

export { blockedActions, conflictFingerprint, detectConflicts } from './conflict-engine.mjs';

export { LEGISLATION_EVENTS, Legislature, enforcementGate } from './legislature.mjs';
