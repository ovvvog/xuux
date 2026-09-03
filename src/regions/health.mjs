/**
 * حكمُ صحّةِ الإقليمِ وتأخُّرِ نسخِه — الخطوة `M10.07`.
 *
 * **الضمان `G-REGION-PURE-JUDGEMENT`:** ما في هذا الملفِّ دوالُّ نقيّةٌ: لا
 * `node:fs` ولا `node:child_process` ولا `node:process`، ولا قراءةَ لساعةِ
 * النظامِ ولا مؤقِّتٌ ذاتيٌّ — الوقائعُ كلُّها تُمرَّر إليها من
 * `scripts/lib/region-facts.mjs` وحدَها. فالحكمُ الذي يلمس ما يفحصه يستطيع أن
 * يُصلِحه ثم يُثني عليه.
 *
 * **والضمان `G-REGION-NO-EMPTY-SUCCESS`:** إقليمٌ لم تقع عليه مشاهدةٌ واحدةٌ
 * صالحةٌ يُحكَم عليه `health:unmeasured` لا `health:up`. فمن قرأ صمتاً صحّةً
 * أعلن سلامةَ ما لم يُقَس أصلاً، وذلك أسوأ من عطبٍ يُقرأ عطباً لأنه يُطمئن.
 *
 * @module regions/health
 */

import { REGION_ERRORS, RegionError } from './errors.mjs';

/**
 * @typedef {object} RegionObservation
 * @property {string} region معرَّفُ الإقليمِ المُشاهَد.
 * @property {boolean} reachable أَبَلَغَه القياسُ أم لا.
 * @property {number} replicationLagMs تأخّرُ النسخِ المقيسُ بالميلي‑ثانية.
 * @property {number} at لحظةُ المشاهدةِ بالميلي‑ثانية.
 */

/**
 * @typedef {object} RegionHealthJudgement
 * @property {string} region
 * @property {string} verdict معرَّفُ الحكمِ من العقد.
 * @property {number} observations عددُ المشاهداتِ الصالحةِ التي بُني عليها الحكم.
 * @property {number | null} replicationLagMs أحدثُ تأخّرٍ مقيسٍ، أو `null` إن لم يُقَس.
 * @property {string | null} reason سببُ الحكمِ إن لم يكن `health:up`.
 */

/**
 * @param {string} code
 * @param {string} message
 * @param {Record<string, unknown>} [detail]
 * @returns {never}
 */
function refuse(code, message, detail = {}) {
  throw new RegionError(code, message, detail);
}

/**
 * التحقّقُ من مشاهدةٍ واحدةٍ: الحقولُ كاملةٌ وأنواعُها صحيحةٌ والتأخّرُ عددٌ
 * منتهٍ غيرُ سالبٍ. ومشاهدةٌ فاسدةٌ تُرَدُّ ولا تُطرَح صامتةً: مشاهدةٌ تُهمَل في
 * صمتٍ تُنقِص العدّادَ فيصير الحكمُ `unmeasured` بلا أن يُعرَف السبب.
 *
 * @param {unknown} value
 * @returns {RegionObservation}
 */
export function assertObservation(value) {
  if (typeof value !== 'object' || value === null) {
    refuse(REGION_ERRORS.OBSERVATION_INVALID, 'المشاهدةُ ليست كائناً.');
  }
  const entry = /** @type {Record<string, unknown>} */ (value);
  if (typeof entry.region !== 'string' || entry.region.length === 0) {
    refuse(REGION_ERRORS.OBSERVATION_INVALID, 'المشاهدةُ بلا معرَّفِ إقليم.');
  }
  if (typeof entry.reachable !== 'boolean') {
    refuse(REGION_ERRORS.OBSERVATION_INVALID, `مشاهدةُ «${entry.region}» بلا حقلِ بلوغٍ منطقيّ.`, {
      region: entry.region,
    });
  }
  if (typeof entry.at !== 'number' || !Number.isFinite(entry.at)) {
    refuse(REGION_ERRORS.OBSERVATION_INVALID, `مشاهدةُ «${entry.region}» بلا لحظةٍ منتهية.`, {
      region: entry.region,
    });
  }
  if (typeof entry.replicationLagMs !== 'number' || !Number.isFinite(entry.replicationLagMs)) {
    refuse(REGION_ERRORS.LAG_INVALID, `تأخّرُ نسخِ «${entry.region}» ليس عدداً منتهياً.`, {
      region: entry.region,
    });
  }
  if (entry.replicationLagMs < 0) {
    refuse(
      REGION_ERRORS.LAG_INVALID,
      `تأخّرُ نسخِ «${entry.region}» سالبٌ — ونسخةٌ أحدثُ من أصلِها دليلُ ساعةٍ فاسدةٍ لا دليلُ صحّة.`,
      { region: entry.region, replicationLagMs: entry.replicationLagMs },
    );
  }
  return /** @type {RegionObservation} */ (value);
}

/**
 * الحكمُ على إقليمٍ من مشاهداتِه: نقيٌّ، ويردّ الحكمَ والسببَ والعدد.
 *
 * @param {object} input
 * @param {import('./contract.mjs').RegionsContract} input.contract
 * @param {string} input.region
 * @param {ReadonlyArray<unknown>} input.observations
 * @param {number} [input.minObservations] الحدُّ الأدنى للمشاهداتِ الصالحة (افتراضُه واحدة).
 * @returns {RegionHealthJudgement}
 */
export function judgeRegion(input) {
  const { contract, region, observations } = input;
  const minObservations = input.minObservations ?? 1;
  /** @type {RegionObservation[]} */
  const valid = [];
  for (const raw of observations) {
    const observation = assertObservation(raw);
    if (observation.region === region) {
      valid.push(observation);
    }
  }
  if (valid.length < minObservations) {
    return Object.freeze({
      region,
      verdict: 'health:unmeasured',
      observations: valid.length,
      replicationLagMs: null,
      reason: REGION_ERRORS.OBSERVATION_MISSING,
    });
  }
  let latest = /** @type {RegionObservation} */ (valid[0]);
  for (const entry of valid) {
    if (entry.at >= latest.at) {
      latest = entry;
    }
  }
  if (!valid.every((entry) => entry.reachable)) {
    return Object.freeze({
      region,
      verdict: 'health:down',
      observations: valid.length,
      replicationLagMs: latest.replicationLagMs,
      reason: 'unreachable',
    });
  }
  if (latest.replicationLagMs > contract.consistency.maxReplicationLagMs) {
    return Object.freeze({
      region,
      verdict: 'health:down',
      observations: valid.length,
      replicationLagMs: latest.replicationLagMs,
      reason: REGION_ERRORS.LAG_EXCEEDED,
    });
  }
  return Object.freeze({
    region,
    verdict: 'health:up',
    observations: valid.length,
    replicationLagMs: latest.replicationLagMs,
    reason: null,
  });
}

/**
 * الحكمُ على كلِّ إقليمٍ معلَنٍ في العقد.
 *
 * @param {object} input
 * @param {import('./contract.mjs').RegionsContract} input.contract
 * @param {ReadonlyArray<unknown>} input.observations
 * @param {number} [input.minObservations]
 * @returns {ReadonlyArray<RegionHealthJudgement>}
 */
export function judgeAllRegions(input) {
  return Object.freeze(
    input.contract.regions.map((region) =>
      judgeRegion({
        contract: input.contract,
        region: region.id,
        observations: input.observations,
        minObservations: input.minObservations,
      }),
    ),
  );
}

/**
 * أيُوجب هذا الحكمُ تجاوزَ الفشلِ بنصِّ العقد؟
 *
 * @param {import('./contract.mjs').RegionsContract} contract
 * @param {string} verdict
 * @returns {boolean}
 */
export function triggersFailover(contract, verdict) {
  return contract.failover.triggerOn.includes(verdict);
}
