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
 * @property {{ quotasEnforced: boolean, decisionsPersisted: boolean, policyVersioning: boolean }} guarantees - ما هو نافذ فعلاً في هذا التركيب
 */

/**
 * يبني تركيب الحكم كاملاً.
 * @param {{ log: { append: (type: string, actor: string, payload: object) => unknown }, pool?: import('pg').Pool | null, haltSwitch?: { assertOperational: () => void } | null, signer?: Parameters<typeof createPolicyVersionStore>[0]['signer'] | null, bundle?: import('./loader.mjs').PolicyBundle }} deps
 * @returns {Governance}
 */
export function createGovernance({ log, pool = null, haltSwitch = null, signer = null, bundle }) {
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
    }),
  });
}
