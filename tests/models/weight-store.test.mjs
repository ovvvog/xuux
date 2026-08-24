// اختبار مخزن الأوزان والتنشيط المشروط بالبصمة — M6.06.
//
// المعيار المعلَن في خارطة الطريق: «تبديل بايت واحد يمنع التنشيط». فهذا هو
// المقيس حرفياً: يُسجَّل نموذج، ثم يُبدَّل بايتٌ واحد في ملف أوزانه على القرص،
// ثم يُطلب تنشيطه — ويجب أن يُرفض، وأن يُسجَّل الرفض، وأن يُبلَّغ الحجر الصحّي.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { EventLog } from '../../src/root-of-trust/event-log.mjs';
import { createMemoryRepository } from '../../src/persistence/repository-memory.mjs';
import { ModelRegistry, ModelState } from '../../src/models/model-registry.mjs';
import { ModelEvaluationLedger } from '../../src/models/evaluation.mjs';
import {
  WEIGHT_STORE_ERRORS,
  WeightStore,
  createWeightStore,
  digestOf,
} from '../../src/models/weight-store.mjs';

/** @returns {string} */
function temporaryRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'weights-'));
}

/**
 * @param {{ quarantine?: { report: (signal: object) => unknown } | null }} [deps]
 */
function setup(deps = {}) {
  const log = new EventLog();
  const weightStore = createWeightStore({ root: temporaryRoot() });
  const registry = new ModelRegistry({
    log,
    repository: createMemoryRepository(ModelRegistry.spec),
    weightStore,
    quarantine: deps.quarantine ?? null,
    evaluationLedger: new ModelEvaluationLedger({ log }),
  });
  return { log, weightStore, registry };
}

/**
 * @param {ModelRegistry} registry
 * @param {string} weights
 */
async function approvedModel(registry, weights) {
  const model = await registry.register({
    name: 'مصنّف الطلبات',
    modelVersion: '1.0.0',
    purpose: 'triage',
    provider: 'داخلي',
    weights,
  });
  await registry.transition(model.id, ModelState.SANDBOXED);
  await registry.transition(model.id, ModelState.APPROVED);
  registry.evaluationLedger.record({
    modelId: model.id,
    fingerprint: model.fingerprint,
    evaluatedBy: 'role:minister',
    results: [
      { checkId: 'safety', score: 1 },
      { checkId: 'quality', score: 1 },
    ],
  });
  return model;
}

test('المخزن معنوَن بالمحتوى: البصمة اسم الملف والتخزين المتكرّر لا يضاعف', () => {
  const store = createWeightStore({ root: temporaryRoot() });
  const digest = store.put('أوزان');
  assert.equal(digest, digestOf('أوزان'));
  assert.equal(store.put('أوزان'), digest, 'المحتوى واحد فالعنوان واحد');
  assert.ok(store.has(digest));
  assert.equal(fs.readdirSync(store.root).length, 1);
  assert.deepEqual(store.verify(digest), {
    verified: true,
    digest,
    bytes: Buffer.byteLength('أوزان', 'utf8'),
  });
});

test('المخزن يرفض بصمةً ليست sha256 فلا يُقرأ ملفٌ خارج الجذر', () => {
  const store = createWeightStore({ root: temporaryRoot() });
  assert.throws(
    () => store.pathFor('../../etc/passwd'),
    (error) => /** @type {{ code: string }} */ (error).code === WEIGHT_STORE_ERRORS.DIGEST_INVALID,
  );
  assert.throws(
    () => new WeightStore({}),
    (error) => /** @type {{ code: string }} */ (error).code === WEIGHT_STORE_ERRORS.ROOT_REQUIRED,
  );
});

test('غياب الأوزان يفرَّق عن تبدّلها بخطأين مختلفين', () => {
  const store = createWeightStore({ root: temporaryRoot() });
  const digest = store.put('أوزان');
  assert.throws(
    () => store.verify(digestOf('أوزان أخرى')),
    (error) => /** @type {{ code: string }} */ (error).code === WEIGHT_STORE_ERRORS.WEIGHTS_MISSING,
  );
  fs.writeFileSync(store.pathFor(digest), 'أوزان مبدَّلة');
  assert.throws(
    () => store.verify(digest),
    (error) =>
      /** @type {{ code: string }} */ (error).code === WEIGHT_STORE_ERRORS.FINGERPRINT_MISMATCH,
  );
});

test('التنشيط يعيد حساب البصمة ويسجّل التحقّق', async () => {
  const { registry, log } = setup();
  const model = await approvedModel(registry, 'أوزان أصلية');
  const activated = await registry.activate(model.id);
  assert.equal(activated.isActive, true);
  const verified = log.events.find((event) => event.type === 'model.fingerprint-verified');
  assert.ok(verified, 'التحقّق من البصمة حدثٌ مسجَّل لا فحصٌ صامت');
  assert.equal(
    /** @type {Record<string, unknown>} */ (verified.data)['fingerprint'],
    model.fingerprint,
  );
});

test('تبديل بايتٍ واحد في الأوزان يمنع التنشيط ويُبلّغ الحجر', async () => {
  /** @type {Array<{ kind: string, subject: string }>} */
  const signals = [];
  const { registry, weightStore, log } = setup({
    quarantine: {
      report(signal) {
        signals.push(/** @type {{ kind: string, subject: string }} */ (signal));
      },
    },
  });
  const model = await approvedModel(registry, 'أوزان أصلية');

  // تبديل بايت واحد فقط — لا إعادة كتابة الملف كلّه.
  const target = weightStore.pathFor(model.fingerprint);
  const bytes = fs.readFileSync(target);
  bytes[0] = (bytes[0] ?? 0) === 0 ? 1 : (bytes[0] ?? 1) - 1;
  fs.writeFileSync(target, bytes);

  await assert.rejects(() => registry.activate(model.id), /MODEL_FINGERPRINT_MISMATCH/u);
  const refusal = log.events.find((event) => event.type === 'model.activation-refused');
  assert.ok(refusal, 'الرفض يُسجَّل');
  assert.equal(
    /** @type {Record<string, unknown>} */ (refusal.data)['code'],
    'MODEL_FINGERPRINT_MISMATCH',
  );
  assert.equal(signals.length, 1);
  assert.equal(signals[0]?.kind, 'model-fingerprint-mismatch');
  assert.equal(signals[0]?.subject, model.id);

  const stored = await registry.get(model.id);
  assert.equal(stored?.isActive, false, 'الرفض قبل الكتابة: لا يبقى نشطاً لحظةً');
});

test('حذف ملف الأوزان يمنع التنشيط بخطأ غياب لا بخطأ تبدّل', async () => {
  const { registry, weightStore } = setup();
  const model = await approvedModel(registry, 'أوزان أصلية');
  fs.rmSync(weightStore.pathFor(model.fingerprint));
  await assert.rejects(() => registry.activate(model.id), /MODEL_WEIGHTS_MISSING/u);
});

test('سجلٌ بلا مخزن أوزان لا يُنشّط شيئاً: الفحص ليس اختيارياً', async () => {
  const log = new EventLog();
  const registry = new ModelRegistry({
    log,
    repository: createMemoryRepository(ModelRegistry.spec),
  });
  const model = await approvedModel(registry, 'أوزان');
  await assert.rejects(() => registry.activate(model.id), /MODEL_WEIGHT_STORE_MISSING/u);
  assert.ok(
    log.events.some(
      (event) =>
        event.type === 'model.activation-refused' &&
        /** @type {Record<string, unknown>} */ (event.data)['code'] ===
          'MODEL_WEIGHT_STORE_MISSING',
    ),
  );
});
