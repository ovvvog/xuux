/**
 * تركيب الحكم — وصل أجزاء M4 في مسار واحد.
 *
 * الأجزاء بُنيت متفرّقة عن قصد: المحرّك لا يعرف SQL، والدفتر لا يعرف السياسة،
 * والمحاكي لا يُعدّل شيئاً. لكن التفرّق نفسه خطر: من يبني النقطة بيده قد ينساها
 * بلا دفتر حصص فتصير الحصص معلنة غير نافذة، أو بلا مصرف قرارات فيصير سجل
 * القرارات في الذاكرة وحدها فيضيع عند إعادة التشغيل — ويضيع معه أساس المحاكي.
 *
 * فصار الوصل في مكان واحد: `createGovernance` تعطي نقطة تفويض موصولة بالبيانات
 * وبالدفتر وبالمصرف. ومن مرّر مجمّع اتصال حصل على الإنفاذ الدائم، ومن لم يمرّره
 * حصل على قرار مسبَّب بلا خصم ولا سجل دائم — والفرق **معلَن** في المُعاد لا
 * مخفيّ، كي لا يظنّ أحد أنه يُنفِذ حصصاً وهو لا يفعل.
 */

import { createPolicyDecisionPoint } from './engine.mjs';
import { EnforcementPoint } from './enforcement-point.mjs';
import { loadPolicyBundle } from './loader.mjs';
import { createQuotaLedger } from './quota.mjs';
import { createPolicyDecisionSink } from './simulator.mjs';
import { createPolicyVersionStore } from './versioning.mjs';

/**
 * @typedef {object} Governance
 * @property {import('./loader.mjs').PolicyBundle} bundle
 * @property {import('./engine.mjs').PolicyDecisionPoint} decisionPoint
 * @property {EnforcementPoint} enforcement
 * @property {ReturnType<typeof createQuotaLedger> | null} quotaLedger
 * @property {ReturnType<typeof createPolicyVersionStore> | null} versionStore
 * @property {{ quotasEnforced: boolean, decisionsPersisted: boolean, policyVersioning: boolean, identityEnforced: boolean, legislationEnforced: boolean }} guarantees - ما هو نافذ فعلاً في هذا التركيب
 */

/**
 * يبني تركيب الحكم كاملاً.
 * @param {{ log: { append: (type: string, actor: string, payload: object) => unknown }, pool?: import('pg').Pool | null, haltSwitch?: { assertOperational: () => void } | null, signer?: Parameters<typeof createPolicyVersionStore>[0]['signer'] | null, bundle?: import('./loader.mjs').PolicyBundle, identityGate?: import('./enforcement-point.mjs').IdentityGateLike | null, legislationGate?: { blockedActions: () => Promise<ReadonlySet<string>> } | null }} deps
 * @returns {Governance}
 */
export function createGovernance({
  log,
  pool = null,
  haltSwitch = null,
  signer = null,
  bundle,
  identityGate = null,
  legislationGate = null,
}) {
  if (!log) throw new Error('GOVERNANCE_LOG_REQUIRED');
  const loaded = bundle ?? loadPolicyBundle();
  const decisionPoint = createPolicyDecisionPoint({ bundle: loaded });

  const quotaLedger =
    pool === null ? null : createQuotaLedger({ pool, definitions: loaded.quotas });
  const decisionSink = pool === null ? null : createPolicyDecisionSink({ pool });
  const versionStore =
    pool === null || signer === null ? null : createPolicyVersionStore({ pool, signer });

  const enforcement = new EnforcementPoint({
    decisionPoint,
    log,
    haltSwitch,
    quotaLedger,
    decisionSink,
    // بوابةُ الهوية (‏M6.01) اختياريّةٌ في التركيب ومُعلَنةٌ في `guarantees`: من
    // لم يمرّرها لا يظنّ أنّ الفاعلَ يُحقَّق من جذر الثقة. والإنشاءُ الخامُّ بلا
    // بوابةٍ يُرفَض عند البناءِ (M11.04-F01)؛ أمّا المصنعُ فيُعَلِّمُ الإلزامَ بحضورِها:
    // مَن مرّرها أُلزِمَت، ومَن لم يمرّرها لم يُلزَم ولم يَدّعِها.
    identityGate,
    requireIdentityGate: identityGate !== null,
    // حاجزُ التشريع (‏M8.02) اختياريٌّ في التركيب ومُعلَنٌ في `guarantees`: من
    // لم يمرّره لا يظنّ أنّ التعارضَ يمنع عنده إنفاذاً، فالوعدُ يُقرأ من المُعاد.
    legislationGate,
  });

  return Object.freeze({
    bundle: loaded,
    decisionPoint,
    enforcement,
    quotaLedger,
    versionStore,
    guarantees: Object.freeze({
      quotasEnforced: quotaLedger !== null,
      decisionsPersisted: decisionSink !== null,
      policyVersioning: versionStore !== null,
      identityEnforced: identityGate !== null,
      legislationEnforced: legislationGate !== null,
    }),
  });
}
