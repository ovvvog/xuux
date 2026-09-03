/**
 * خطّةُ تجاوزِ الفشلِ: من يصير كاتباً إن سقط الكاتب؟ — الخطوة `M10.07`.
 *
 * **الضمان `G-REGION-SINGLE-WRITER`:** لا تُبنى خطّةُ تنصيبٍ والكاتبُ القائمُ
 * حكمُه `health:up`؛ تُرَدُّ بالرمز `REGION_WRITER_NOT_UNIQUE` **قبل أن تقع
 * كتابةٌ واحدة**. فكاتبانِ في وقتٍ واحدٍ يعني كتابتين لا تلتقيان أبداً، وضياعُ
 * كتابةٍ لا تُستعاد أسوأُ من توقّفٍ يُرى ويُقاس.
 *
 * **والضمان `G-REGION-CANDIDATE-FROM-LEDGER`:** المرشَّحُ يُشتقُّ من أولويّاتِ
 * العقدِ ومن أحكامٍ مبنيّةٍ على تأخّرٍ **مقيسٍ مقروءٍ**، لا من وسيطٍ يُمرَّر ولا
 * من ذاكرةِ منفِّذٍ في لحظةِ عطلٍ — وذاكرةُ إنسانٍ حينَها أسوأُ مصادرِ الحقيقة.
 *
 * وهذا الملفُّ **نقيٌّ**: لا قرصَ ولا عمليّةَ ولا ساعةَ.
 *
 * @module regions/failover
 */

import { REGION_ERRORS, RegionError } from './errors.mjs';
import { triggersFailover } from './health.mjs';

/**
 * @typedef {object} FailoverPlan
 * @property {string} from الكاتبُ الساقطُ الذي يُتجاوَز.
 * @property {string} to الكاتبُ الجديدُ المُرشَّح.
 * @property {string} reason الحكمُ الذي أوجب التجاوز.
 * @property {number} candidatePriority أولويّةُ المرشَّحِ في العقد.
 * @property {number | null} candidateLagMs تأخّرُ المرشَّحِ المقيسُ لحظةَ التنصيب.
 * @property {ReadonlyArray<string>} skipped مرشَّحون أعلى أولويّةً استُبعِدوا، ولماذا.
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
 * التحقّقُ من بلوغِ الحدِّ الأدنى المعلَنِ للأقاليمِ القائمة.
 *
 * @param {object} input
 * @param {import('./contract.mjs').RegionsContract} input.contract
 * @param {ReadonlyArray<import('./health.mjs').RegionHealthJudgement>} input.judgements
 * @returns {number} عددُ الأقاليمِ القائمة.
 */
export function assertQuorum(input) {
  const healthy = input.judgements.filter((judgement) => judgement.verdict === 'health:up').length;
  if (healthy < input.contract.failover.minHealthyRegions) {
    refuse(
      REGION_ERRORS.QUORUM_LOST,
      `القائمُ من الأقاليمِ ${String(healthy)} والحدُّ الأدنى المعلَن ${String(input.contract.failover.minHealthyRegions)} — ولا يُقال «استمرّت الخدمة» وقد سقط النصابُ المعلَن.`,
      { healthy, required: input.contract.failover.minHealthyRegions },
    );
  }
  return healthy;
}

/**
 * بناءُ خطّةِ التجاوزِ من العقدِ والأحكامِ المقيسة.
 *
 * @param {object} input
 * @param {import('./contract.mjs').RegionsContract} input.contract
 * @param {string} input.currentWriter الكاتبُ الحاليُّ المقروءُ من المؤشِّر.
 * @param {ReadonlyArray<import('./health.mjs').RegionHealthJudgement>} input.judgements
 * @returns {FailoverPlan}
 */
export function planFailover(input) {
  const { contract, currentWriter, judgements } = input;
  if (!contract.failover.automatic) {
    refuse(
      REGION_ERRORS.FAILOVER_DISABLED,
      'تجاوزُ الفشلِ مُعطَّلٌ في العقد — وتجاوزٌ يحتاج إذناً ليس تجاوزاً بل إشعارٌ يصل بعد أن يقع الضرر.',
    );
  }
  const writerJudgement = judgements.find((judgement) => judgement.region === currentWriter);
  if (writerJudgement === undefined) {
    refuse(
      REGION_ERRORS.UNDECLARED,
      `لا حكمَ مقيسٌ على الكاتبِ الحاليِّ «${currentWriter}» — ولا يُتجاوَز كاتبٌ لم يُقَس.`,
      { region: currentWriter },
    );
  }
  if (!triggersFailover(contract, writerJudgement.verdict)) {
    refuse(
      REGION_ERRORS.WRITER_NOT_UNIQUE,
      `الكاتبُ «${currentWriter}» حكمُه «${writerJudgement.verdict}» ولا يُوجب التجاوزَ — وتنصيبُ ثانٍ والأولُ قائمٌ هو بابُ كاتبَين في وقتٍ واحد.`,
      { region: currentWriter, verdict: writerJudgement.verdict },
    );
  }

  /** @type {string[]} */
  const skipped = [];
  const candidates = contract.regions
    .filter((region) => region.id !== currentWriter)
    .sort((first, second) => first.priority - second.priority);
  for (const candidate of candidates) {
    const judgement = judgements.find((entry) => entry.region === candidate.id);
    if (judgement === undefined) {
      skipped.push(`${candidate.id}: ${REGION_ERRORS.OBSERVATION_MISSING}`);
      continue;
    }
    if (judgement.verdict !== 'health:up') {
      skipped.push(`${candidate.id}: ${judgement.reason ?? judgement.verdict}`);
      continue;
    }
    return Object.freeze({
      from: currentWriter,
      to: candidate.id,
      reason: writerJudgement.verdict,
      candidatePriority: candidate.priority,
      candidateLagMs: judgement.replicationLagMs,
      skipped: Object.freeze([...skipped]),
    });
  }
  refuse(
    REGION_ERRORS.FAILOVER_CANDIDATE_MISSING,
    `لا مرشَّحَ صالحاً لتنصيبِه كاتباً بعد سقوطِ «${currentWriter}» — ولا يُنصَّب من يُظَنّ صالحاً؛ المُستبعَدون: ${skipped.join('، ') || 'لا أحد'}.`,
    { from: currentWriter, skipped },
  );
}

/**
 * محاسبةُ مدّةِ التجاوزِ المقيسةِ على السقفِ المعلَن.
 *
 * @param {object} input
 * @param {import('./contract.mjs').RegionsContract} input.contract
 * @param {number} input.durationMs
 * @returns {{ durationMs: number, limitMs: number, withinLimit: boolean }}
 */
export function judgeFailoverDuration(input) {
  const limitMs = input.contract.failover.maxFailoverMs;
  if (!Number.isFinite(input.durationMs) || input.durationMs < 0) {
    refuse(
      REGION_ERRORS.CLOCK_INVALID,
      'مدّةُ التجاوزِ ليست عدداً منتهياً غيرَ سالبٍ — ومدّةٌ تُقاس بساعةٍ فاسدةٍ مدّةٌ مُختلَقة.',
      { durationMs: input.durationMs },
    );
  }
  return Object.freeze({
    durationMs: input.durationMs,
    limitMs,
    withinLimit: input.durationMs <= limitMs,
  });
}
