// أداة التراجع — M6.08.
//
// يقيس الاختبار الزمن فعلاً حول نداء الأداة نفسها، لا زمناً تقديرياً في نص أو
// ثابت. ويثبت أن النتيجة تعيد السابق وأن المرجع عنه لا يعود إلى الخدمة.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import test from 'node:test';

import { ModelEvaluationLedger } from '../../src/models/evaluation.mjs';
import { ModelRegistry, ModelState } from '../../src/models/model-registry.mjs';
import { createWeightStore } from '../../src/models/weight-store.mjs';
import { createMemoryRepository } from '../../src/persistence/repository-memory.mjs';
import { EventLog } from '../../src/root-of-trust/event-log.mjs';
import { parseArgs, run } from '../../scripts/rollback-model.mjs';
import {
  experimentLedgerFor,
  registerEvaluationExperiment,
} from '../helpers/experiment-support.mjs';

/** @returns {{ log: EventLog, registry: ModelRegistry, evaluations: ModelEvaluationLedger }} */
function setup() {
  const log = new EventLog();
  const evaluations = new ModelEvaluationLedger({ log, experiments: experimentLedgerFor(log) });
  const registry = new ModelRegistry({
    log,
    repository: createMemoryRepository(ModelRegistry.spec),
    weightStore: createWeightStore({
      root: fs.mkdtempSync(path.join(os.tmpdir(), 'rollback-model-')),
    }),
    evaluationLedger: evaluations,
  });
  return { log, registry, evaluations };
}

/** @param {ModelRegistry} registry @param {ModelEvaluationLedger} evaluations @param {string} version */
async function approvedAndEvaluated(registry, evaluations, version) {
  const model = await registry.register({
    name: `خدمة-${version}`,
    modelVersion: version,
    purpose: 'service',
    provider: 'اختبار',
    weights: `أوزان-${version}`,
  });
  await registry.transition(model.id, ModelState.SANDBOXED, 'فحص معزول');
  await registry.transition(model.id, ModelState.APPROVED, 'معتمد');
  evaluations.record({
    modelId: model.id,
    fingerprint: model.fingerprint,
    evaluatedBy: 'role:minister',
    experimentId: registerEvaluationExperiment(evaluations, {
      modelId: model.id,
      fingerprint: model.fingerprint,
    }),
    results: [
      { checkId: 'safety', score: 1 },
      { checkId: 'quality', score: 0.95 },
    ],
  });
  return model;
}

test('الأمر الواحد يعيد النسخة السابقة ويقيس زمناً دون الدقيقة', async () => {
  const { log, registry, evaluations } = setup();
  const previous = await approvedAndEvaluated(registry, evaluations, '1.0.0');
  await registry.activate(previous.id);
  const current = await approvedAndEvaluated(registry, evaluations, '2.0.0');
  await registry.activate(current.id);

  const before = performance.now();
  const result = await run(['--purpose', 'service', '--reason', 'انحراف جودة مثبت'], { registry });
  const measuredMs = performance.now() - before;

  assert.equal(result.rolledBackId, current.id);
  assert.equal(result.restoredId, previous.id);
  assert.ok(measuredMs < 60_000, `التراجع استغرق ${measuredMs}ms، والحد أقل من دقيقة`);
  assert.ok(result.durationMs >= 0);
  assert.equal((await registry.getActive('service'))?.id, previous.id);
  assert.equal((await registry.get(current.id))?.state, ModelState.ROLLED_BACK);
  await assert.rejects(
    () => registry.transition(current.id, ModelState.APPROVED, 'إعادة تشغيل'),
    /ROLLED_BACK_MODEL_IMMUTABLE/,
  );
  assert.ok(log.events.some((event) => event.type === 'model.rolled-back'));
});

test('الأداة ترفض سبباً غائباً قبل لمس السجل', () => {
  assert.throws(() => parseArgs(['--purpose', 'service']), /MODEL_ROLLBACK_ARGUMENT_INVALID/);
  assert.throws(() => parseArgs(['--reason', 'سبب']), /MODEL_ROLLBACK_ARGUMENT_INVALID/);
});
