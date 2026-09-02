/**
 * خطّةُ النشرِ التدريجيِّ — الشقُّ النقيُّ من الخطوة `M10.06`.
 *
 * **العيبُ الذي تُغلقه هذه الوحدة:** «نشرٌ تدريجيٌّ» عبارةٌ تُقال، وما لم
 * يُبنَ منها **ترتيبٌ محسوبٌ ونصيبٌ يتّسع ولا يضيق وينتهي بحِملٍ كامل** بقيت
 * وصفاً في وثيقةٍ يُنفِّذه كلُّ منفِّذٍ بمزاجِه: موجتانِ بنصيبٍ واحدٍ ليستا
 * تدرّجاً، وموجاتٌ تنتهي عند سبعين بالمئة تترك ثلث الحِمل على إصدارٍ قديمٍ
 * **ويُقال إنّ النشر تمّ**.
 *
 * والضمانُ المُنفَّذُ هنا `G-DEPLOY-PURE-JUDGEMENT`: هذه الوحدة **لا تلمس
 * قرصاً ولا تُشغّل أمراً ولا تقرأ بيئةَ تشغيل** — تأخذ عقداً محمَّلاً وتُعيد
 * خطّةً مجمَّدة. فما يُختبَر منها يُختبَر بلا تركيبٍ ولا مجلَّدٍ مؤقّت.
 *
 * @module deployment/plan
 */

import { DEPLOY_ERRORS, DeploymentError } from './errors.mjs';

/**
 * @typedef {object} PlannedWave
 * @property {string} id
 * @property {number} order
 * @property {number} sharePercent
 * @property {number} minObservations
 * @property {number} timeoutMs
 * @property {ReadonlyArray<string>} objectives
 * @property {number} index الموضعُ الصفريُّ في الخطّة المرتَّبة.
 * @property {string | null} next معرّفُ الموجةِ التالية، و`null` للأخيرة.
 * @property {boolean} final هل هي الموجةُ التي تُعمّم الحِملَ كلَّه.
 * @property {string} statement
 */

/**
 * @param {string} code
 * @param {string} message
 * @param {Record<string, unknown>} [detail]
 * @returns {never}
 */
function refuse(code, message, detail = {}) {
  throw new DeploymentError(code, message, detail);
}

/**
 * بناءُ خطّةِ الموجاتِ من العقدِ: ترتيبٌ متصاعدٌ لا يتكرّر، ونصيبٌ يتّسع عند
 * كلِّ موجةٍ، وآخرُ موجةٍ على الحِمل كلِّه.
 *
 * @param {import('./contract.mjs').DeploymentContract} contract
 * @returns {ReadonlyArray<PlannedWave>}
 */
export function buildRolloutPlan(contract) {
  const waves = [...contract.waves].sort((left, right) => left.order - right.order);
  /** @type {Set<number>} */
  const seenOrders = new Set();
  /** @type {Set<string>} */
  const seenIds = new Set();
  for (const wave of waves) {
    if (seenOrders.has(wave.order)) {
      refuse(
        DEPLOY_ERRORS.WAVE_ORDER_INVALID,
        `ترتيبُ الموجةِ «${wave.id}» (${String(wave.order)}) مكرَّرٌ — وخطّةٌ بترتيبٍ ملتبسٍ تُنفَّذ بترتيبين مختلفين في جهازين.`,
        { wave: wave.id, order: wave.order },
      );
    }
    if (seenIds.has(wave.id)) {
      refuse(
        DEPLOY_ERRORS.WAVE_UNDECLARED,
        `معرّفُ الموجةِ «${wave.id}» مكرَّرٌ في العقد — ومعرّفٌ يدلّ على شيئين لا يدلّ على شيء.`,
        { wave: wave.id },
      );
    }
    seenOrders.add(wave.order);
    seenIds.add(wave.id);
  }

  let previousShare = 0;
  for (const wave of waves) {
    if (wave.sharePercent <= previousShare) {
      refuse(
        DEPLOY_ERRORS.WAVE_SHARE_INVALID,
        `نصيبُ الموجةِ «${wave.id}» (${String(wave.sharePercent)}٪) لا يتّسع عمّا قبله (${String(previousShare)}٪) — وموجتانِ بنصيبٍ واحدٍ ليستا تدرّجاً بل تكراراً.`,
        { wave: wave.id, sharePercent: wave.sharePercent, previousShare },
      );
    }
    previousShare = wave.sharePercent;
  }
  const last = waves[waves.length - 1];
  if (last === undefined || last.sharePercent !== 100) {
    refuse(
      DEPLOY_ERRORS.WAVE_SHARE_INVALID,
      'آخرُ الموجاتِ لا تُعمّم الحِملَ كلَّه (100٪) — ونشرٌ ينتهي دون الحِمل الكامل يترك شريحةً على إصدارٍ قديمٍ ويُقال إنه تمّ.',
      { lastShare: last === undefined ? null : last.sharePercent },
    );
  }

  return Object.freeze(
    waves.map((wave, index) =>
      Object.freeze({
        id: wave.id,
        order: wave.order,
        sharePercent: wave.sharePercent,
        minObservations: wave.minObservations,
        timeoutMs: wave.timeoutMs,
        objectives: Object.freeze([...wave.objectives]),
        index,
        next: waves[index + 1]?.id ?? null,
        final: index === waves.length - 1,
        statement: wave.statement,
      }),
    ),
  );
}

/**
 * موجةٌ بعينها من الخطّةِ بمعرّفِها — وردٌّ مُسمّىً حين لا تُعرَف.
 *
 * @param {ReadonlyArray<PlannedWave>} plan
 * @param {string} waveId
 * @returns {PlannedWave}
 */
export function waveById(plan, waveId) {
  const found = plan.find((wave) => wave.id === waveId);
  if (found === undefined) {
    refuse(
      DEPLOY_ERRORS.WAVE_UNDECLARED,
      `الموجة «${waveId}» غيرُ معلَنةٍ في خطّةِ النشر — ولا تُنفَّذ موجةٌ لا إعلانَ لها.`,
      { wave: waveId, declared: plan.map((wave) => wave.id) },
    );
  }
  return found;
}
