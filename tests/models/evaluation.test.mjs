// التقييم قبل التنشيط والتراجع — M6.08.
//
// يثبت هذا الملف بوابتين لا يكفي فيهما الوصف: نتيجة فاشلة لا تنشط النموذج ولو
// كان معتمداً، والنتيجة الناجحة مربوطة ببصمة الأوزان لا باسم النموذج فقط.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { registerTmpRoot } from '../helpers/tmp-roots.mjs';

import { ModelEvaluationLedger } from '../../src/models/evaluation.mjs';
import { ModelRegistry, ModelState } from '../../src/models/model-registry.mjs';
import { createWeightStore } from '../../src/models/weight-store.mjs';
import { createMemoryRepository } from '../../src/persistence/repository-memory.mjs';
import { EventLog } from '../../src/root-of-trust/event-log.mjs';
import {
  experimentLedgerFor,
  registerEvaluationExperiment,
} from '../helpers/experiment-support.mjs';

/** @returns {{ log: EventLog, registry: ModelRegistry, evaluations: ModelEvaluationLedger, weights: import('../../src/models/weight-store.mjs').WeightStore }} */
function setup() {
  const log = new EventLog();
  const weights = createWeightStore({
    root: registerTmpRoot(fs.mkdtempSync(path.join(os.tmpdir(), 'model-evaluation-'))),
  });
  const evaluations = new ModelEvaluationLedger({ log, experiments: experimentLedgerFor(log) });
  const registry = new ModelRegistry({
    log,
    repository: createMemoryRepository(ModelRegistry.spec),
    weightStore: weights,
    evaluationLedger: evaluations,
  });
  return { log, registry, evaluations, weights };
}

/** @param {ModelRegistry} registry @param {string} purpose @param {string} weights */
async function approvedModel(registry, purpose, weights) {
  const model = await registry.register({
    name: `نموذج-${purpose}-${weights}`,
    modelVersion: `${purpose}-${weights}`,
    purpose,
    provider: 'اختبار',
    weights,
  });
  await registry.transition(model.id, ModelState.SANDBOXED, 'عزل التقييم');
  await registry.transition(model.id, ModelState.APPROVED, 'اعتماد مشروط بالتقييم');
  return model;
}

/** @param {ModelEvaluationLedger} evaluations @param {{ id: string, fingerprint: string }} model */
function pass(evaluations, model) {
  return evaluations.record({
    modelId: model.id,
    fingerprint: model.fingerprint,
    evaluatedBy: 'role:minister',
    experimentId: registerEvaluationExperiment(evaluations, {
      modelId: model.id,
      fingerprint: model.fingerprint,
    }),
    results: [
      { checkId: 'safety', score: 1 },
      { checkId: 'quality', score: 0.9 },
      { checkId: 'reliability', score: 0.95 },
    ],
  });
}

test('نموذج يفشل فحصاً إلزامياً لا يُنشَّط ويسجّل القرار', async () => {
  const { registry, evaluations, log } = setup();
  const model = await approvedModel(registry, 'triage', 'فاشل');
  const evaluation = evaluations.record({
    modelId: model.id,
    fingerprint: model.fingerprint,
    evaluatedBy: 'role:minister',
    experimentId: registerEvaluationExperiment(evaluations, {
      modelId: model.id,
      fingerprint: model.fingerprint,
    }),
    results: [
      { checkId: 'safety', score: 0.5 },
      { checkId: 'quality', score: 1 },
    ],
  });
  assert.equal(evaluation.state, 'failed');
  await assert.rejects(
    () => registry.activate(model.id),
    (error) => /** @type {{ code?: string }} */ (error).code === 'MODEL_EVALUATION_FAILED',
  );
  assert.equal((await registry.get(model.id))?.isActive, false);
  assert.ok(log.events.some((event) => event.type === 'model.evaluation.failed'));
  assert.ok(
    log.events.some(
      (event) =>
        event.type === 'model.activation-refused' &&
        /** @type {Record<string, unknown>} */ (event.data).code === 'MODEL_EVALUATION_FAILED',
    ),
  );
});

test('غياب نتيجة تقييم يرفض التنشيط برمز مستقل', async () => {
  const { registry, log } = setup();
  const model = await approvedModel(registry, 'classify', 'بلا-تقييم');
  await assert.rejects(
    () => registry.activate(model.id),
    (error) => /** @type {{ code?: string }} */ (error).code === 'MODEL_EVALUATION_MISSING',
  );
  assert.ok(
    log.events.some(
      (event) =>
        event.type === 'model.activation-refused' &&
        /** @type {Record<string, unknown>} */ (event.data).code === 'MODEL_EVALUATION_MISSING',
    ),
  );
});

test('نجاح التقييم لا ينتقل إلى أوزان أخرى ولو كان الغرض نفسه', async () => {
  const { registry, evaluations } = setup();
  const first = await approvedModel(registry, 'summarize', 'أوزان-أولى');
  pass(evaluations, first);
  await registry.activate(first.id);

  const replacement = await approvedModel(registry, 'summarize', 'أوزان-ثانية');
  assert.notEqual(replacement.fingerprint, first.fingerprint);
  await assert.rejects(
    () => registry.activate(replacement.id),
    (error) => /** @type {{ code?: string }} */ (error).code === 'MODEL_EVALUATION_MISSING',
  );
  assert.equal((await registry.getActive('summarize'))?.id, first.id);
});

test('سجل التقييم الدائم يعيد ربط النجاح بالبصمة بعد عملية جديدة', () => {
  const log = new EventLog();
  const file = path.join(
    registerTmpRoot(fs.mkdtempSync(path.join(os.tmpdir(), 'evaluation-ledger-'))),
    'results.json',
  );
  const fingerprint = 'a'.repeat(64);
  const written = new ModelEvaluationLedger({ log, experiments: experimentLedgerFor(log), file });
  written.record({
    modelId: 'model:persistent-evaluation',
    fingerprint,
    evaluatedBy: 'role:minister',
    experimentId: registerEvaluationExperiment(written, {
      modelId: 'model:persistent-evaluation',
      fingerprint,
    }),
    results: [
      { checkId: 'safety', score: 1 },
      { checkId: 'quality', score: 0.8 },
    ],
  });
  const loaded = new ModelEvaluationLedger({ log, experiments: experimentLedgerFor(log), file });
  assert.equal(loaded.isPassed('model:persistent-evaluation', fingerprint), true);
  assert.equal(loaded.isPassed('model:persistent-evaluation', 'b'.repeat(64)), false);
});
