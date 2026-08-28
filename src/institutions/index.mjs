/** واجهةُ التشغيل المؤسسي — الخطوة M8.05. */

export {
  DEFAULT_INSTITUTIONS_CONFIG_DIR,
  DEFAULT_INSTITUTIONS_SEED_DIR,
  INSTITUTION_ERRORS,
  InstitutionError,
  loadInstitutionsPolicy,
  pilotOf,
  rolesFor,
  taskKindOf,
} from './institutions.mjs';
export {
  createOutputExecutor,
  createServiceCatalogExecutor,
  createStatisticalBulletinExecutor,
  effectIndex,
  outputFingerprint,
} from './executors.mjs';
export { INSTITUTION_EVENTS, InstitutionOperations } from './operations.mjs';
