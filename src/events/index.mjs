/**
 * قنواتُ الأحداث — واجهةُ المجال الواحدة (‏`M7.07`).
 *
 * الاستيرادُ من هذا الملف لا من ملفاته: مسارٌ واحد للمجال يجعل الحاجزَ قادراً
 * على منع المسار الجانبي إلى مستودعَي الرسائل والمواضع.
 */

export {
  DEFAULT_EVENTS_CONFIG_DIR,
  EVENTS_BASELINE_FILE,
  EVENT_ERRORS,
  EventError,
  assertPayloadValid,
  assertVersionAcceptable,
  channelOfType,
  findBreakingChanges,
  loadEventsBaseline,
  loadEventsPolicy,
  toBaselineShape,
} from './contracts.mjs';

export { EVENT_GENESIS, EventBus, RELAY_GROUP, messageHash } from './event-bus.mjs';
