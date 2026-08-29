/**
 * واجهةُ الفدرالية — الخطوتان `M8.07` و`M8.08`.
 *
 * مَجمَعُ تصديرٍ واحدٌ للتفويض الترابي: الوثيقةُ تُحمَّل بـ`loadDelegationPolicy`،
 * وتُنفَّذ بـ`RegionalDelegation`، وأثرُ كلِّ أمرٍ ملكيٍّ يُكتب في `DelegationRegister`. والاستيرادُ من هنا لا من مسارِ الوحدةِ مباشرةً
 * كي يبقى للفدرالية بابٌ واحدٌ كما لغيرها من المسارات.
 *
 * **حدٌّ معلَن:** لا شيءَ هنا يقرأ شجرةَ الفدراليةِ كاملةً — ذاك عملُ
 * `src/registry/loader.mjs`. وهذه الواجهةُ للإقليمِ المفوَّضِ وحدَه.
 */

export {
  DEFAULT_FEDERATION_CONFIG_DIR,
  DEFAULT_FEDERATION_SEED_DIR,
  FEDERATION_ERRORS,
  FEDERATION_EVENTS,
  FederationError,
  RegionalDelegation,
  ancestorsOf,
  levelFor,
  loadDelegationPolicy,
  withinTerritory,
} from './delegation.mjs';

export { DelegationRegister, REGISTER_EFFECTS } from './sovereignty.mjs';
