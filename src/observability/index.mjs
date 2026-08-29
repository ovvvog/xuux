/**
 * مدخلُ وحداتِ المراقبة — الخطوة `M9.01`.
 *
 * المدخلُ يُصدِّر ما يُستعمَل من خارجِ المجلَّد ولا يُصدِّر أكثر: `createReadOnlyView`
 * مُصدَّرٌ لأن اختبارَ معيارِ القبولِ يقيس المشهدَ وحدَه بنيوياً، ولا يُصدَّر شيءٌ
 * يمنح مستودعاً أو نداءً كاتباً.
 */

export {
  MonitorAgent,
  MonitorError,
  MONITOR_ERRORS,
  loadMonitoringPolicy,
  readRoleCapabilities,
  DEFAULT_MONITORING_CONFIG_DIR,
} from './monitor-agent.mjs';

export { createReadOnlyView, ReadOnlyViewError, VIEW_ERRORS } from './read-only-view.mjs';
