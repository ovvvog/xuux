/**
 * حزمةُ الدستور: النصُّ المؤسِّس ومخزنُه المحميُّ ومسارُ تعديله (الخطوة M8.01).
 */

export {
  CONSTITUTION_ERRORS,
  CONSTITUTION_GENESIS,
  ConstitutionError,
  ConstitutionStore,
  DEFAULT_CONSTITUTION_CONFIG_DIR,
  RevisionKind,
  articleHash,
  documentRoot,
  loadConstitutionPolicy,
  revisionHash,
} from './constitution.mjs';

export {
  AMENDMENT_ERRORS,
  AmendmentPath,
  CONSTITUTION_EVENTS,
  ProposalState,
  ReviewVerdict,
} from './amendment-path.mjs';
