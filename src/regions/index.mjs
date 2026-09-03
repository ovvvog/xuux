/**
 * مدخلُ وحدةِ الأقاليمِ وتجاوزِ الفشل — الخطوة `M10.07`.
 *
 * @module regions
 */

export { REGION_ERRORS, RegionError } from './errors.mjs';
export {
  DEFAULT_REGIONS_CONFIG_DIR,
  exitCodeFor,
  loadRegionsContract,
  requireRegion,
} from './contract.mjs';
export { assertObservation, judgeAllRegions, judgeRegion, triggersFailover } from './health.mjs';
export { assertQuorum, judgeFailoverDuration, planFailover } from './failover.mjs';
export { measureImpact } from './impact.mjs';
