/**
 * الحكمُ على موجاتِ النشرِ وآلةُ حالاتِه — الشقُّ النقيُّ من الخطوة `M10.06`.
 *
 * **العيبُ الذي تُغلقه هذه الوحدة:** بوابةُ نشرٍ يقرؤها إنسانٌ بعد فوتِ الموجةِ
 * ليست بوابةً؛ والبوابةُ التي تُقارن رقماً بعتبةٍ **مكتوبةٍ في المُنفِّذ** ليست
 * موصولةً بعهدِ الخدمةِ بل بنسخةٍ منه تشيخ. فهذه الوحدةُ تحكم على الموجةِ من
 * **أهدافِ `M10.02` نفسِها** كما وصلت في العقدِ المحمَّل، وبحسابِ
 * `src/service-levels/budget.mjs` نفسِه — **لا حسابان لرقمٍ واحد**.
 *
 * والضمانانِ المُنفَّذانِ هنا:
 *   - `G-DEPLOY-GATES-BEFORE-WIDENING`: لا يتّسع النصيبُ قبل حكمٍ صحيحٍ عن
 *     السابقة؛ فآلةُ الحالاتِ لا تُصدر «تُقدَّم» إلا من `verdict:healthy`.
 *   - `G-DEPLOY-NO-EMPTY-SUCCESS`: موجةٌ لم تبلغ حدَّ مشاهداتِها تُصدر
 *     `verdict:unmeasured` لا `verdict:healthy`؛ فصمتُ القياسِ ليس التزاماً،
 *     وهو الدرسُ نفسُه الذي أُنفِذ في `M10.02` على اللوحة.
 *
 * والوحدةُ **نقيّةٌ** (‏`G-DEPLOY-PURE-JUDGEMENT`): لا قرصَ ولا عمليّةَ ولا
 * ساعةَ نظامٍ — الزمنُ يصل مُعامِلاً حين يلزم.
 *
 * @module deployment/rollout
 */

import { attainment, deviation } from '../service-levels/budget.mjs';

import { DEPLOY_ERRORS, DeploymentError } from './errors.mjs';

/** أحكامُ النشرِ بمعرّفاتِها كما في العقد. */
export const DEPLOY_VERDICTS = Object.freeze({
  HEALTHY: 'verdict:healthy',
  BROKEN: 'verdict:broken',
  UNMEASURED: 'verdict:unmeasured',
});

/**
 * @typedef {object} WaveObservation
 * @property {number} total مجموعُ ما وقع من أحداثِ الهدفِ في الموجة.
 * @property {number} bad المُخفِقُ منها بحسبِ تعريفِ الهدفِ نفسِه.
 */

/**
 * @typedef {object} ObjectiveJudgement
 * @property {string} id
 * @property {number} target
 * @property {number} total
 * @property {number} bad
 * @property {number | null} measured
 * @property {number | null} deviation
 * @property {'meeting' | 'breaching' | 'unmeasured'} status
 */

/**
 * @typedef {object} WaveJudgement
 * @property {string} wave
 * @property {string} verdict
 * @property {ReadonlyArray<ObjectiveJudgement>} objectives
 * @property {string} reason
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
 * حكمُ موجةٍ واحدةٍ من مشاهداتِها المُمرَّرةِ وأهدافِ الخدمةِ المُعلَنة.
 *
 * @param {object} input
 * @param {import('./plan.mjs').PlannedWave} input.wave
 * @param {Readonly<Record<string, { id: string, target: number }>>} input.objectives أهدافُ `M10.02` بمعرّفاتِها.
 * @param {Readonly<Record<string, WaveObservation>>} input.observation
 * @returns {WaveJudgement}
 */
export function judgeWave({ wave, objectives, observation }) {
  /** @type {ObjectiveJudgement[]} */
  const rows = [];
  for (const objectiveId of wave.objectives) {
    const objective = objectives[objectiveId];
    if (objective === undefined) {
      refuse(
        DEPLOY_ERRORS.OBJECTIVE_UNDECLARED,
        `بوابةُ الموجةِ «${wave.id}» تُشير إلى الهدف «${objectiveId}» ولا إعلانَ له في أهدافِ الخدمة — وعتبةٌ بلا عهدٍ خلفَها رقمٌ بلا مصدر.`,
        { wave: wave.id, objective: objectiveId },
      );
    }
    const reading = observation[objectiveId];
    if (reading === undefined) {
      refuse(
        DEPLOY_ERRORS.OBSERVATION_MISSING,
        `لا مشاهدةَ للهدف «${objectiveId}» في مخرَجِ مجسِّ الموجةِ «${wave.id}» — وبوابةٌ بلا قياسٍ لا تُقرأ نجاحاً ولا تُتجاوَز صمتاً.`,
        { wave: wave.id, objective: objectiveId },
      );
    }
    assertObservation(objectiveId, reading);
    const measured =
      reading.total >= wave.minObservations
        ? attainment({ good: reading.total - reading.bad, total: reading.total })
        : null;
    /** @type {'meeting' | 'breaching' | 'unmeasured'} */
    let status = 'unmeasured';
    if (measured !== null) status = measured >= objective.target ? 'meeting' : 'breaching';
    rows.push(
      Object.freeze({
        id: objectiveId,
        target: objective.target,
        total: reading.total,
        bad: reading.bad,
        measured,
        deviation: deviation({ measured, target: objective.target }),
        status,
      }),
    );
  }

  const breaching = rows.filter((row) => row.status === 'breaching');
  const unmeasured = rows.filter((row) => row.status === 'unmeasured');
  /** @type {string} */
  let verdict = DEPLOY_VERDICTS.HEALTHY;
  let reason = `كلُّ أهدافِ الموجةِ «${wave.id}» ملتزمةٌ بقياسٍ يبلغ حدَّها المعلَن (${String(wave.minObservations)} حدثاً).`;
  if (breaching.length > 0) {
    verdict = DEPLOY_VERDICTS.BROKEN;
    reason = `انكسر في الموجةِ «${wave.id}» ${String(breaching.length)} هدفاً: ${breaching.map((row) => row.id).join('، ')}.`;
  } else if (unmeasured.length > 0) {
    verdict = DEPLOY_VERDICTS.UNMEASURED;
    reason = `لم يبلغ القياسُ في الموجةِ «${wave.id}» حدَّها المعلَن (${String(wave.minObservations)} حدثاً) في: ${unmeasured.map((row) => row.id).join('، ')} — وصمتُ القياسِ ليس التزاماً.`;
  }

  return Object.freeze({
    wave: wave.id,
    verdict,
    objectives: Object.freeze(rows),
    reason,
  });
}

/**
 * @param {string} objectiveId
 * @param {WaveObservation} reading
 * @returns {void}
 */
function assertObservation(objectiveId, reading) {
  const { total, bad } = reading;
  if (!Number.isFinite(total) || !Number.isInteger(total) || total < 0) {
    refuse(
      DEPLOY_ERRORS.OBSERVATION_INVALID,
      `مشاهدةُ الهدفِ «${objectiveId}» بمجموعٍ غيرِ صالحٍ (${String(total)}) — ورقمٌ لا يُعَدّ لا يُحسَب عليه حكمٌ.`,
      { objective: objectiveId, total },
    );
  }
  if (!Number.isFinite(bad) || !Number.isInteger(bad) || bad < 0 || bad > total) {
    refuse(
      DEPLOY_ERRORS.OBSERVATION_INVALID,
      `مُخفِقُ الهدفِ «${objectiveId}» (${String(bad)}) غيرُ صالحٍ أو يتجاوز مجموعَه (${String(total)}).`,
      { objective: objectiveId, total, bad },
    );
  }
}

/**
 * @typedef {object} RolloutStep
 * @property {'promote' | 'activate' | 'rollback'} action
 * @property {string | null} nextWave
 * @property {string} verdict
 * @property {string} statement
 */

/**
 * آلةُ حالاتِ النشرِ: من حكمِ موجةٍ إلى الفعلِ التالي، لا أكثر ولا أقلّ.
 *
 * ولا يتّسع النصيبُ إلا من `verdict:healthy` (‏`G-DEPLOY-GATES-BEFORE-WIDENING`)؛
 * وكلُّ حكمٍ في `rollback.triggerOn` يُخرج «تراجعاً» بلا وسيطٍ يُعطِّله.
 *
 * @param {object} input
 * @param {import('./plan.mjs').PlannedWave} input.wave
 * @param {WaveJudgement} input.judgement
 * @param {{ automatic: boolean, triggerOn: ReadonlyArray<string> }} input.rollback
 * @returns {RolloutStep}
 */
export function nextStep({ wave, judgement, rollback }) {
  if (rollback.triggerOn.includes(judgement.verdict)) {
    if (!rollback.automatic) {
      refuse(
        DEPLOY_ERRORS.ROLLBACK_DISABLED,
        'سياسةُ التراجعِ الآليِّ مُعطَّلةٌ في العقد — وتعطيلُها تعطيلٌ للضمانِ لا تهيئةٌ، فلا يُقبَل.',
        { verdict: judgement.verdict },
      );
    }
    return Object.freeze({
      action: /** @type {'rollback'} */ ('rollback'),
      nextWave: null,
      verdict: judgement.verdict,
      statement: `${judgement.reason} فيقع التراجعُ الآليُّ بلا إقرارٍ بشريّ.`,
    });
  }
  if (judgement.verdict !== DEPLOY_VERDICTS.HEALTHY) {
    refuse(
      DEPLOY_ERRORS.VERDICT_UNDECLARED,
      `الحكم «${judgement.verdict}» ليس صحيحاً ولا موجباً للتراجعِ في العقد — وحالةٌ ثالثةٌ بلا فعلٍ معلَنٍ تُنفَّذ بمزاجِ منفِّذها.`,
      { verdict: judgement.verdict },
    );
  }
  if (wave.final) {
    return Object.freeze({
      action: /** @type {'activate'} */ ('activate'),
      nextWave: null,
      verdict: judgement.verdict,
      statement: `اجتازت الموجةُ الأخيرةُ «${wave.id}» بوابتَها، فيُعمَّم الإصدارُ على الحِمل كلِّه.`,
    });
  }
  return Object.freeze({
    action: /** @type {'promote'} */ ('promote'),
    nextWave: wave.next,
    verdict: judgement.verdict,
    statement: `اجتازت الموجةُ «${wave.id}» بوابتَها، فتُقدَّم «${String(wave.next)}».`,
  });
}
