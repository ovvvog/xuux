import test from 'node:test';
import assert from 'node:assert/strict';
import { EventLog } from '../../src/root-of-trust/index.mjs';
import {
  ModelEvaluationLedger,
  ModelRegistry,
  ModelState,
  ModelSandbox,
} from '../../src/models/index.mjs';
import { createMemoryRepository } from '../../src/persistence/repository-memory.mjs';
import { createWeightStore } from '../../src/models/weight-store.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * مخزن أوزان في مجلّد مؤقّت: التنشيط صار يعيد حساب البصمة (M6.06)، فسجلٌّ بلا
 * مخزن لا يُنشّط شيئاً — وذلك مقصود لا عائق.
 * @returns {import('../../src/models/weight-store.mjs').WeightStore}
 */
function temporaryWeightStore() {
  return createWeightStore({ root: fs.mkdtempSync(path.join(os.tmpdir(), 'weights-')) });
}

/** @returns {ModelRegistry} */
function registry(log = new EventLog()) {
  return new ModelRegistry({
    log,
    repository: createMemoryRepository(ModelRegistry.spec),
    weightStore: temporaryWeightStore(),
    evaluationLedger: new ModelEvaluationLedger({ log }),
  });
}

test('registers model with immutable weight digest', async () => {
  const r = registry(),
    m = await r.register({
      name: 'reasoner',
      modelVersion: '1.0.0',
      purpose: 'planning',
      provider: 'internal',
      weights: 'weights',
      capabilities: ['read:data'],
    });
  assert.equal(m.state, ModelState.REGISTERED);
  assert.equal(m.isActive, false);
  assert.equal(await r.verifyWeights(m.id, 'weights'), true);
  assert.equal(await r.verifyWeights(m.id, 'changed'), false);
});

test('rejects unsafe model capabilities and missing manifest', async () => {
  const r = registry();
  await assert.rejects(
    () =>
      r.register({
        name: 'x',
        modelVersion: '1',
        purpose: 'x',
        provider: 'x',
        weights: 'x',
        capabilities: ['bypass-crown'],
      }),
    /FORBIDDEN_MODEL_CAPABILITY/,
  );
  await assert.rejects(
    () =>
      // @ts-expect-error استدعاء ناقص الحقول مقصود: يثبت أن البيان الناقص يُرفض
      // زمن التشغيل بخطأ مُسمّى، لا أن يُمرَّر بصمت. رفض المدقّق له متوقَّع ومطلوب.
      r.register({ name: 'x' }),
    /MODEL_MANIFEST_REQUIRED/,
  );
});

test('requires approval before activation and supports sandbox', async () => {
  const r = registry(),
    m = await r.register({
      name: 'safe',
      modelVersion: '1',
      purpose: 'inspect',
      provider: 'test',
      weights: 'x',
    });
  await assert.rejects(() => r.activate(m.id), /MODEL_NOT_APPROVED/);
  await r.transition(m.id, ModelState.SANDBOXED, 'evaluation');
  const s = new ModelSandbox();
  const sandboxed = await r.get(m.id);
  assert.ok(sandboxed, 'النموذج المعزول يجب أن يكون موجوداً في السجل');
  assert.equal(s.run(sandboxed, { x: 1 }).network, 'disabled');
  const approved = await r.transition(m.id, ModelState.APPROVED, 'passed');
  // الاعتماد لا يُعلن بلا معتمِد مسمّى، والسلطة المعلنة اليوم هي التاج.
  assert.equal(approved.approvedBy, 'crown');
  r.evaluationLedger.record({
    modelId: m.id,
    fingerprint: m.fingerprint,
    evaluatedBy: 'role:minister',
    results: [
      { checkId: 'safety', score: 1 },
      { checkId: 'quality', score: 1 },
    ],
  });
  const active = await r.activate(m.id);
  assert.equal(active.id, m.id);
  assert.equal(active.isActive, true);
});

test('rolled back model cannot return to service', async () => {
  const r = registry(),
    m = await r.register({
      name: 'bad',
      modelVersion: '1',
      purpose: 'x',
      provider: 'test',
      weights: 'x',
    });
  await r.transition(m.id, ModelState.ROLLED_BACK, 'failed eval');
  await assert.rejects(
    () => r.transition(m.id, ModelState.APPROVED, 'retry'),
    /ROLLED_BACK_MODEL_IMMUTABLE/,
  );
});
