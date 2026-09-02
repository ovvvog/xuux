// اختباراتُ مسارِ النشرِ النقيِّ — الخطوة `M10.06`.
//
// ولا قرصَ هنا ولا عمليّةٌ ابنة: الوحداتُ النقيّةُ تُختبَر بما هي — عقدٌ يصل،
// وأعدادٌ تصل، وحكمٌ يخرج. وأمّا معيارُ القبولِ («إصدارٌ معيوبٌ ⇒ تراجعٌ
// تلقائيٌّ بلا تدخّل») فمقيسٌ في `tests/deployment/rollback.test.mjs` بعمليّاتٍ
// أبناءٍ حقيقيّةٍ لا هنا.

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEPLOY_ERRORS,
  DEPLOY_VERDICTS,
  DeploymentError,
  assertReleaseId,
  buildRolloutPlan,
  judgeWave,
  loadDeploymentContract,
  nextStep,
  requireRollbackTarget,
  selectRollbackTarget,
  waveById,
} from '../../src/deployment/index.mjs';

const contract = loadDeploymentContract();
const plan = buildRolloutPlan(contract);

/**
 * @param {number} sharePercent
 * @param {number} minObservations
 * @param {boolean} final
 * @returns {import('../../src/deployment/plan.mjs').PlannedWave}
 */
function wave(sharePercent, minObservations, final) {
  return Object.freeze({
    id: 'wave:test',
    order: 1,
    sharePercent,
    minObservations,
    timeoutMs: 5000,
    objectives: ['slo:api.availability'],
    index: 0,
    next: final ? null : 'wave:next',
    final,
    statement: 'موجةُ اختبارٍ نقيّةٌ لا تُنشر ولا تلمس قرصاً.',
  });
}

const objectives = Object.freeze({
  'slo:api.availability': Object.freeze({ id: 'slo:api.availability', target: 0.995 }),
});

test('العقدُ يُحمَّل وتُبنى منه خطّةٌ تتّسع موجاتُها وتنتهي بالحِمل كلِّه', () => {
  assert.ok(plan.length >= 2, 'خطّةُ موجةٍ واحدةٍ ليست نشراً تدريجياً');
  let previous = 0;
  for (const entry of plan) {
    assert.ok(entry.sharePercent > previous, `نصيبُ ${entry.id} لا يتّسع عمّا قبله`);
    previous = entry.sharePercent;
  }
  const last = plan.at(-1);
  assert.ok(last !== undefined);
  assert.equal(last.sharePercent, 100);
  assert.equal(last.final, true);
  assert.equal(plan[0]?.next, plan[1]?.id);
});

test('عتباتُ البواباتِ تُقرأ من أهدافِ الخدمةِ لا من عقدِ النشر', () => {
  for (const entry of plan) {
    for (const objectiveId of entry.objectives) {
      const objective = contract.objectives[objectiveId];
      assert.ok(objective !== undefined, `الهدف ${objectiveId} غيرُ مُلحَقٍ من وثيقةِ الأهداف`);
      assert.ok(objective.target > 0 && objective.target <= 1);
    }
  }
});

test('موجةٌ ملتزمةٌ بقياسٍ كافٍ تُصدر حكماً صحيحاً وتُقدَّم التالية', () => {
  const judgement = judgeWave({
    wave: wave(10, 20, false),
    objectives,
    observation: { 'slo:api.availability': { total: 200, bad: 0 } },
  });
  assert.equal(judgement.verdict, DEPLOY_VERDICTS.HEALTHY);
  const step = nextStep({ wave: wave(10, 20, false), judgement, rollback: contract.rollback });
  assert.equal(step.action, 'promote');
  assert.equal(step.nextWave, 'wave:next');
});

test('هدفٌ منكسرٌ يُصدر verdict:broken ويُخرج تراجعاً بلا إقرار', () => {
  const judgement = judgeWave({
    wave: wave(10, 20, false),
    objectives,
    observation: { 'slo:api.availability': { total: 200, bad: 40 } },
  });
  assert.equal(judgement.verdict, DEPLOY_VERDICTS.BROKEN);
  assert.equal(judgement.objectives[0]?.status, 'breaching');
  const step = nextStep({ wave: wave(10, 20, false), judgement, rollback: contract.rollback });
  assert.equal(step.action, 'rollback');
});

test('قياسٌ دون الحدِّ المعلَن ليس نجاحاً بل verdict:unmeasured', () => {
  const judgement = judgeWave({
    wave: wave(10, 20, false),
    objectives,
    observation: { 'slo:api.availability': { total: 3, bad: 0 } },
  });
  assert.equal(judgement.verdict, DEPLOY_VERDICTS.UNMEASURED);
  assert.equal(judgement.objectives[0]?.measured, null);
  const step = nextStep({ wave: wave(10, 20, false), judgement, rollback: contract.rollback });
  assert.equal(step.action, 'rollback');
});

test('الموجةُ الأخيرةُ الملتزمةُ تُعمِّم الإصدارَ لا تُقدِّم موجةً بعدها', () => {
  const last = wave(100, 20, true);
  const judgement = judgeWave({
    wave: last,
    objectives,
    observation: { 'slo:api.availability': { total: 500, bad: 1 } },
  });
  const step = nextStep({ wave: last, judgement, rollback: contract.rollback });
  assert.equal(step.action, 'activate');
  assert.equal(step.nextWave, null);
});

test('مشاهدةٌ غائبةٌ أو غيرُ صالحةٍ تُردّ برمزٍ مُسمّىً لا تُتجاوَز صمتاً', () => {
  assert.throws(
    () => judgeWave({ wave: wave(10, 20, false), objectives, observation: {} }),
    (/** @type {unknown} */ error) =>
      error instanceof DeploymentError && error.code === DEPLOY_ERRORS.OBSERVATION_MISSING,
  );
  assert.throws(
    () =>
      judgeWave({
        wave: wave(10, 20, false),
        objectives,
        observation: { 'slo:api.availability': { total: 10, bad: 40 } },
      }),
    (/** @type {unknown} */ error) =>
      error instanceof DeploymentError && error.code === DEPLOY_ERRORS.OBSERVATION_INVALID,
  );
});

test('هدفٌ غيرُ معلَنٍ في أهدافِ الخدمةِ يُردّ ولا يُحكَم عليه', () => {
  assert.throws(
    () =>
      judgeWave({
        wave: wave(10, 20, false),
        objectives: {},
        observation: { 'slo:api.availability': { total: 100, bad: 0 } },
      }),
    (/** @type {unknown} */ error) =>
      error instanceof DeploymentError && error.code === DEPLOY_ERRORS.OBJECTIVE_UNDECLARED,
  );
});

test('خطّةٌ بموجتين متساويتي النصيبِ تُردّ — والتساوي ليس تدرّجاً', () => {
  assert.throws(
    () =>
      buildRolloutPlan(
        /** @type {import('../../src/deployment/contract.mjs').DeploymentContract} */ ({
          ...contract,
          waves: [
            { ...contract.waves[0], sharePercent: 50 },
            { ...contract.waves[1], sharePercent: 50 },
          ],
        }),
      ),
    (/** @type {unknown} */ error) =>
      error instanceof DeploymentError && error.code === DEPLOY_ERRORS.WAVE_SHARE_INVALID,
  );
});

test('خطّةٌ لا تنتهي بالحِمل كلِّه تُردّ — ونشرٌ ناقصٌ يُقال إنه تمّ', () => {
  assert.throws(
    () =>
      buildRolloutPlan(
        /** @type {import('../../src/deployment/contract.mjs').DeploymentContract} */ ({
          ...contract,
          waves: [
            { ...contract.waves[0], order: 1, sharePercent: 10 },
            { ...contract.waves[1], order: 2, sharePercent: 70 },
          ],
        }),
      ),
    (/** @type {unknown} */ error) =>
      error instanceof DeploymentError && error.code === DEPLOY_ERRORS.WAVE_SHARE_INVALID,
  );
});

test('موجةٌ غيرُ معلَنةٍ لا تُنفَّذ', () => {
  const first = plan[0];
  assert.ok(first !== undefined);
  assert.equal(waveById(plan, first.id).id, first.id);
  assert.throws(
    () => waveById(plan, 'wave:ghost'),
    (/** @type {unknown} */ error) =>
      error instanceof DeploymentError && error.code === DEPLOY_ERRORS.WAVE_UNDECLARED,
  );
});

test('هويّةُ الإصدارِ تُطابق الصيغةَ المعلَنةَ أو تُردّ', () => {
  assert.equal(assertReleaseId('1.2.3', contract.release.idPattern), '1.2.3');
  assert.equal(assertReleaseId('1.2.3-rc.1', contract.release.idPattern), '1.2.3-rc.1');
  assert.throws(
    () => assertReleaseId('latest', contract.release.idPattern),
    (/** @type {unknown} */ error) =>
      error instanceof DeploymentError && error.code === DEPLOY_ERRORS.RELEASE_ID_INVALID,
  );
});

test('هدفُ التراجعِ يُشتقّ من الدفترِ ويستثني الإصدارَ الجاري', () => {
  const entries = [
    { type: 'deploy.release.staged', release: '1.0.0' },
    { type: 'deploy.release.activated', release: '1.0.0' },
    { type: 'deploy.release.staged', release: '1.1.0' },
    { type: 'deploy.release.activated', release: '1.1.0' },
    { type: 'deploy.release.staged', release: '1.2.0' },
  ];
  assert.equal(selectRollbackTarget(entries, { excludeRelease: '1.2.0' }), '1.1.0');
  assert.equal(selectRollbackTarget(entries, { excludeRelease: '1.1.0' }), '1.0.0');
  assert.equal(selectRollbackTarget([{ type: 'deploy.release.staged', release: '1.0.0' }]), null);
});

test('تراجعٌ بلا سابقٍ سليمٍ يُردّ برمزٍ مُسمّىً لا يُنشِّط ما يُظَنّ سليماً', () => {
  assert.throws(
    () => requireRollbackTarget([], { excludeRelease: '1.0.0' }),
    (/** @type {unknown} */ error) =>
      error instanceof DeploymentError && error.code === DEPLOY_ERRORS.ROLLBACK_TARGET_MISSING,
  );
});

test('تعطيلُ التراجعِ الآليِّ يُردّ ولا يُقبَل تهيئةً', () => {
  const judgement = judgeWave({
    wave: wave(10, 20, false),
    objectives,
    observation: { 'slo:api.availability': { total: 200, bad: 40 } },
  });
  assert.throws(
    () =>
      nextStep({
        wave: wave(10, 20, false),
        judgement,
        rollback: { automatic: false, triggerOn: contract.rollback.triggerOn },
      }),
    (/** @type {unknown} */ error) =>
      error instanceof DeploymentError && error.code === DEPLOY_ERRORS.ROLLBACK_DISABLED,
  );
});

test('لكلِّ حكمٍ رمزُ خروجٍ مُفرَدٌ والصحيحُ صفرٌ', () => {
  const codes = contract.verdicts.map((verdict) => verdict.exitCode);
  assert.equal(new Set(codes).size, codes.length);
  const healthy = contract.verdicts.find((verdict) => verdict.id === DEPLOY_VERDICTS.HEALTHY);
  assert.ok(healthy !== undefined);
  assert.equal(healthy.exitCode, 0);
});
