/**
 * جذرُ التركيبِ — وصلُ سلسلةِ الإنفاذِ في عمليّةٍ واحدةٍ (`R6-A-04`)
 *
 * العيبُ الذي يُعالَجُ هنا: الوحداتُ كانت موجودةً كلُّها — بوابةُ هويّةٍ، وسلطةُ
 * تصديقٍ، وسجلُّ وكلاءَ، وكتالوجُ قدراتٍ، ودفترُ منحٍ، وسجلُّ حوادثَ، ونقطةُ
 * تفويضٍ — **ولا موضعَ واحدٌ يصلُها**. فكلُّ مُشغِّلٍ يُعيدُ التركيبَ بيدِه، ومن
 * نسيَ وصلةً نالَ سلسلةً ناقصةً تعملُ بلا شكوى: `EnforcementPoint` بلا بوابةِ
 * هويّةٍ يقرأُ الفاعلَ من ادّعاءٍ في الطلبِ لا من جذرِ الثقةِ. وذاك أسوأُ من
 * وحدةٍ غائبةٍ، لأنّ الوحدةَ الغائبةَ تُرى والوصلةَ الناقصةَ لا تُرى.
 *
 * فصارَ هذا الملفُّ **الموضعَ الواحدَ**: من أرادَ سلسلةَ إنفاذٍ نادى
 * `composeEnforcementChain` ونالَها موصولةً أو نالَ رفضاً مُسمّىً — ولا ثالثَ.
 *
 * وثلاثةُ قيودٍ مقصودةٌ:
 *   1. **بوابةُ الهويّةِ ليست خياراً:** `requireIdentityGate` مُثبَّتٌ على `true`
 *      ولا يُمرَّرُ من الخارجِ، ومحاولةُ تمريرِه رفضٌ صريحٌ
 *      (`COMPOSITION_IDENTITY_GATE_NOT_OPTIONAL`) لا تجاهلٌ صامتٌ. فمن أرادَ
 *      تركيباً بلا هويّةٍ فليُنشئْ نقطتَه بيدِه ويَحملْ تصريحَه — لا يأخذُ ذلك من
 *      جذرِ التركيبِ ويُوهِمُ قارئَه أنّه مُركَّبٌ رسميّاً.
 *   2. **الوصلةُ الناقصةُ رفضٌ عندَ البناءِ لا عندَ الاستعمالِ:** سجلٌّ أو حزمةُ
 *      سياسةٍ ناقصةٌ ⇒ خطأٌ مُسمّىً قبلَ أن يُبنى شيءٌ.
 *   3. **ما يُبنى يُعادُ كلُّه:** لا وحدةَ تُبنى في الخفاءِ ولا تُرى، كي يكونَ
 *      الفحصُ على السلسلةِ نفسِها لا على نسخةٍ منها.
 *
 * **حدٌّ مُعلَنٌ:** هذا الجذرُ يصلُ سلسلةَ **التفويضِ والهويّةِ**. وجذرُ الثقةِ
 * الإنتاجيُّ (وحدةُ الأمانِ، والمرساةُ، والبيانُ المختومُ) تركيبُه في
 * `src/root-of-trust/production-runtime.mts` وله مسارُه ومفاتيحُه؛ ووصلُهما في
 * عمليّةٍ واحدةٍ خطوةٌ قائمةٌ بذاتِها لا تُدَّعى هنا.
 */

import { loadConstitutionPolicy } from '../constitution/constitution.mjs';
import { LawRegistry } from '../governance/law-system.mjs';
import { QuarantineWarden } from '../governance/quarantine.mjs';
import {
  AgentRegistry,
  CapabilityGrantLedger,
  IdentityGate,
  IncidentRegister,
  loadCapabilityCatalog,
} from '../identity/index.mjs';
import { Legislature, enforcementGate, loadLegislationPolicy } from '../legislation/index.mjs';
import { createMemoryRepository } from '../persistence/repository-memory.mjs';
import { createPolicyDecisionPoint } from '../policy/engine.mjs';
import { EnforcementPoint } from '../policy/enforcement-point.mjs';
import { loadPolicyBundle } from '../policy/loader.mjs';
import { CertificateAuthority, KingIdentity } from '../root-of-trust/identity.mjs';

export const COMPOSITION_ERRORS = Object.freeze({
  LOG_MISSING: 'COMPOSITION_LOG_MISSING',
  IDENTITY_GATE_NOT_OPTIONAL: 'COMPOSITION_IDENTITY_GATE_NOT_OPTIONAL',
  LAW_REPOSITORY_MISSING: 'COMPOSITION_LAW_REPOSITORY_MISSING',
});

/**
 * @typedef {object} EnforcementChain
 * @property {KingIdentity} kingIdentity
 * @property {CertificateAuthority} authority
 * @property {import('../identity/capability-catalog.mjs').CapabilityCatalog} catalog
 * @property {IncidentRegister} incidents
 * @property {CapabilityGrantLedger} grants
 * @property {AgentRegistry} registry
 * @property {IdentityGate} identityGate
 * @property {QuarantineWarden} quarantine
 * @property {EnforcementPoint} enforcementPoint
 * @property {import('../policy/loader.mjs').PolicyBundle} bundle
 * @property {Legislature | null} legislature
 */

/**
 * يبني سلسلةَ الإنفاذِ موصولةً: هويّةٌ من جذرِ الثقةِ، ثمَّ تفويضٌ على حزمةِ
 * السياسةِ، ثمَّ حَجرٌ يستقبلُ إشاراتِ الاحتواءِ.
 *
 * @param {{
 *   log: { append: (type: string, actor: string, payload: object) => unknown },
 *   configDir?: string,
 *   bundle?: import('../policy/loader.mjs').PolicyBundle,
 *   lawRepository?: unknown,
 *   withLegislation?: boolean,
 *   crown?: unknown,
 *   haltSwitch?: unknown,
 *   quotaLedger?: unknown,
 *   now?: () => Date,
 *   requireIdentityGate?: never,
 * }} deps
 * @returns {EnforcementChain}
 */
export function composeEnforcementChain(deps) {
  const options = deps ?? /** @type {never} */ ({});
  const {
    log,
    configDir,
    bundle,
    lawRepository,
    withLegislation = false,
    crown = null,
    haltSwitch = null,
    royalCommandVerifier = null,
    quotaLedger = null,
    now,
  } = options;

  if (
    log === undefined ||
    log === null ||
    typeof (/** @type {{ append?: unknown }} */ (log).append) !== 'function'
  ) {
    throw new Error(COMPOSITION_ERRORS.LOG_MISSING);
  }
  // بوابةُ الهويّةِ ليست خياراً يُمرَّرُ: لو قُبِلَ `requireIdentityGate` هنا لصارَ
  // جذرُ التركيبِ نفسُه بابَ التركيبِ الناقصِ، وهو العيبُ الذي يُعالِجُه.
  if (Object.hasOwn(options, 'requireIdentityGate')) {
    throw new Error(COMPOSITION_ERRORS.IDENTITY_GATE_NOT_OPTIONAL);
  }

  const clock = now ?? (() => new Date());
  const catalogOptions = configDir === undefined ? undefined : { dir: configDir };
  const kingIdentity = new KingIdentity();
  const authority = new CertificateAuthority(kingIdentity);
  const catalog = loadCapabilityCatalog(catalogOptions);
  const incidents = new IncidentRegister({ log: /** @type {never} */ (log) });
  const grants = new CapabilityGrantLedger({
    catalog,
    log: /** @type {never} */ (log),
    incidents,
    now: clock,
  });
  const registry = new AgentRegistry({
    ca: authority,
    log: /** @type {never} */ (log),
    repository: createMemoryRepository(AgentRegistry.spec),
    catalog,
    grants,
    incidents,
  });
  const identityGate = new IdentityGate({
    registry,
    ca: authority,
    catalog,
    grants,
    incidents,
    log: /** @type {never} */ (log),
  });
  // الحَجرُ موصولٌ بنفسِ سجلِّ الحوادثِ وسجلِّ الأحداثِ: إشارةُ احتواءٍ تُبلَّغُ
  // إلى حارسٍ لا يقرأُها أحدٌ إشارةٌ لا إنفاذَ فيها.
  const quarantine = new QuarantineWarden({
    incidents: /** @type {never} */ (incidents),
    log: /** @type {never} */ (log),
    now: clock,
  });

  const resolvedBundle = bundle ?? loadPolicyBundle();
  /** @type {Legislature | null} */
  let legislature = null;
  if (withLegislation) {
    if (lawRepository === undefined || lawRepository === null) {
      throw new Error(COMPOSITION_ERRORS.LAW_REPOSITORY_MISSING);
    }
    legislature = new Legislature({
      policy: loadLegislationPolicy(catalogOptions),
      bundle: resolvedBundle,
      articles: loadConstitutionPolicy(catalogOptions).articles,
      laws: new LawRegistry({
        log: /** @type {never} */ (log),
        repository: /** @type {never} */ (lawRepository),
      }),
      log: /** @type {never} */ (log),
      crown: /** @type {never} */ (crown),
    });
  }

  const enforcementPoint = new EnforcementPoint({
    decisionPoint: createPolicyDecisionPoint({ bundle: resolvedBundle }),
    log: /** @type {never} */ (log),
    identityGate,
    quarantine,
    // R5-B-06 (تقرير: R5-B-04): التحقّقُ من الأمرِ الملكيِّ موصولٌ إن مُرِّرَ
    // الديوانُ. الإنتاجُ يمرّرُه؛ والاختباراتُ تُمرِّرُهُ أو تتركُهُ.
    ...(royalCommandVerifier === null || royalCommandVerifier === undefined
      ? {}
      : { royalCommandVerifier }),
    requireIdentityGate: true,
    ...(legislature === null ? {} : { legislationGate: enforcementGate(legislature) }),
    ...(haltSwitch === null ? {} : { haltSwitch: /** @type {never} */ (haltSwitch) }),
    ...(quotaLedger === null ? {} : { quotaLedger: /** @type {never} */ (quotaLedger) }),
    ...(now === undefined ? {} : { now: clock }),
  });

  return {
    kingIdentity,
    authority,
    catalog,
    incidents,
    grants,
    registry,
    identityGate,
    quarantine,
    enforcementPoint,
    bundle: resolvedBundle,
    legislature,
  };
}
