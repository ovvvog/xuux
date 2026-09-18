// بوابات لا تُتجاوز — الخطوة M2.11، العيوب D2 وD3 وD4.
//
// كل اختبار هنا كُتب **قبل** إصلاحه وشُوهد فاشلاً، ثم نجح بعده. والعيوب:
//
// - **D4** (الموصَّف في خارطة الطريق): `getActive` تُرجع **المرجع الداخلي** غير
//   مُجمَّد، فمن نادى `getActive` قدر أن يُغيّر حالة النموذج بيده ويتجاوز
//   `transition` — أي أن البوابة كانت تُحرَس من الأمام وبابها الخلفي مفتوح.
//   وكانت تخلط `null` بـ`undefined` فلا يفرّق المستدعي بين «لا نشط لهذا الغرض»
//   وبين «مؤشّرٌ نشط يشير إلى نموذج غير موجود» — والثاني فسادُ حالة لا فراغ.
// - **D3**: مؤشّر «النشط لهذا الغرض» لم يكن يُنظَّف عند تعليق النموذج أو إرجاعه،
//   فنموذجٌ مُعلَّق يبقى **هو النشط** لغرضه. وهذا أخطر من D4 لأنه لا يحتاج
//   مستدعياً سيّئاً: يكفي أن يُعلَّق نموذج ثم يُسأل السجل عن نشط الغرض.
// - **D2**: مؤشّرٌ معلَّق يشير إلى معرّف غير موجود كان يُقرأ `undefined` صامتاً
//   بدل خطأ مُسمّى — وفسادُ الحالة الذي يُقرأ فراغاً يُبنى عليه.
//
// التشغيل: node --test tests/models/registry-gates.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventLog } from '../../src/root-of-trust/event-log.mjs';
import { ModelRegistry, ModelState } from '../../src/models/model-registry.mjs';
import { ModelEvaluationLedger } from '../../src/models/evaluation.mjs';
import { createMemoryRepository } from '../../src/persistence/repository-memory.mjs';
import { createWeightStore } from '../../src/models/weight-store.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { registerTmpRoot } from '../helpers/tmp-roots.mjs';
import {
  experimentLedgerFor,
  registerEvaluationExperiment,
} from '../helpers/experiment-support.mjs';

/**
 * مخزن أوزان في مجلّد مؤقّت — لازمٌ للتنشيط بعد M6.06.
 * @returns {import('../../src/models/weight-store.mjs').WeightStore}
 */
function temporaryWeightStore() {
  return createWeightStore({
    root: registerTmpRoot(fs.mkdtempSync(path.join(os.tmpdir(), 'weights-'))),
  });
}

/** سجل ونموذج معتمد ومُفعَّل، وهو الوضع الذي تُختبر عليه البوابات. */
async function activeModel() {
  const log = new EventLog();
  const repository = createMemoryRepository(ModelRegistry.spec);
  const registry = new ModelRegistry({
    log,
    repository,
    weightStore: temporaryWeightStore(),
    evaluationLedger: new ModelEvaluationLedger({ log, experiments: experimentLedgerFor(log) }),
  });
  const model = await registry.register({
    name: 'مدقّق',
    modelVersion: '1.0.0',
    purpose: 'audit',
    provider: 'internal',
    weights: 'w-1',
  });
  await registry.transition(model.id, ModelState.SANDBOXED, 'اختبار معزول');
  await registry.transition(model.id, ModelState.APPROVED, 'اعتماد');
  registry.evaluationLedger.record({
    modelId: model.id,
    fingerprint: model.fingerprint,
    evaluatedBy: 'role:minister',
    experimentId: registerEvaluationExperiment(registry.evaluationLedger, {
      modelId: model.id,
      fingerprint: model.fingerprint,
    }),
    results: [
      { checkId: 'safety', score: 1 },
      { checkId: 'quality', score: 1 },
    ],
  });
  await registry.activate(model.id);
  return { log, registry, repository, id: model.id };
}

test('D4 — getActive تُرجع صورة مُجمَّدة لا المرجع الداخلي', async () => {
  const { registry, repository, id } = await activeModel();
  const active = await registry.getActive('audit');
  assert.ok(active, 'لا نموذج نشط');
  assert.equal(Object.isFrozen(active), true, 'الصورة غير مُجمَّدة');
  // العيب الأصلي: هذا الكائن **هو** السجل الداخلي، فالتعديل عليه يمرّ. وبعد
  // `M3.05` لا سجل داخلياً أصلاً: المخزن مستودع، وكل قراءة صورةٌ جديدة.
  assert.notEqual(active, await repository.findById(id), 'المُرجَع هو المرجع المخزون نفسه');
});

test('D4 — تعديل الصورة المُرجَعة لا يُغيّر حالة النموذج في السجل', async () => {
  const { registry, id } = await activeModel();
  const active = /** @type {Record<string, unknown>} */ (
    /** @type {unknown} */ (await registry.getActive('audit'))
  );
  assert.throws(
    () => {
      'use strict';
      active.state = ModelState.ROLLED_BACK;
    },
    TypeError,
    'التعديل لم يُرفض',
  );
  const stored = await registry.get(id);
  assert.equal(stored?.state, ModelState.APPROVED, 'الحالة المخزونة انحرفت');
});

test('D1 — القدرات في الصورة المُرجَعة لا تشترك مع مصفوفة السجل', async () => {
  const log = new EventLog();
  const registry = new ModelRegistry({
    log,
    repository: createMemoryRepository(ModelRegistry.spec),
    weightStore: temporaryWeightStore(),
  });
  const model = await registry.register({
    name: 'مولّد',
    modelVersion: '2.0.0',
    purpose: 'draft',
    provider: 'internal',
    weights: 'w-2',
    capabilities: ['text:generate'],
  });
  // العيب: `Object.freeze({ ...record })` تجميدٌ **سطحي**، والمصفوفة الداخلية
  // نفسها ممرَّرة بالمرجع — فمن أخذ «صورة مُجمَّدة» قدر أن يدسّ قدرة محرَّمة
  // في نموذج مسجَّل، متجاوزاً فحص `FORBIDDEN_CAPABILITIES` كله.
  assert.throws(() => model.capabilities.push('bypass-crown'), TypeError, 'المصفوفة قابلة للدسّ');
  assert.deepEqual((await registry.get(model.id))?.capabilities, ['text:generate']);
});

test('D3 — تعليق النموذج النشط يُسقط كونه نشطاً لغرضه', async () => {
  const { registry, id } = await activeModel();
  await registry.transition(id, ModelState.SUSPENDED, 'شبهة انحراف');
  assert.equal(await registry.getActive('audit'), null, 'المُعلَّق ما زال نشطاً لغرضه');
});

test('D3 — إرجاع النموذج النشط يُسقط كونه نشطاً لغرضه', async () => {
  const { registry, id } = await activeModel();
  await registry.transition(id, ModelState.ROLLED_BACK, 'إرجاع');
  assert.equal(await registry.getActive('audit'), null, 'المُرجَع عنه ما زال نشطاً لغرضه');
});

test('D3 — إسقاط النشاط يُسجَّل حدثاً فلا يقع بصمت', async () => {
  const { log, registry, id } = await activeModel();
  await registry.transition(id, ModelState.SUSPENDED, 'شبهة انحراف');
  const kinds = log.events.map((e) => e.type);
  assert.ok(kinds.includes('model.deactivated'), `لا حدث إسقاط: ${kinds.join(', ')}`);
});

test('D3 — إعادة الاعتماد بعد التعليق تحتاج تفعيلاً صريحاً', async () => {
  const { registry, id } = await activeModel();
  await registry.transition(id, ModelState.SUSPENDED, 'شبهة');
  await registry.transition(id, ModelState.APPROVED, 'انتهى التحقيق');
  // الاعتماد ليس تفعيلاً: الرجوع إلى الخدمة قرارٌ يُعلن لا أثرٌ جانبي لانتقال.
  assert.equal(await registry.getActive('audit'), null, 'عاد نشطاً بلا تفعيل');
  await registry.activate(id);
  assert.equal((await registry.getActive('audit'))?.id, id);
});

test('D2 — «مؤشّر النشط» زال: النشاط عمودٌ لا خريطة موازية', async () => {
  // كان الفساد الممكن: مؤشّرٌ في خريطة يشير إلى معرّف غير موجود، فيُقرأ
  // `undefined` ويُخلط بـ«لا نشط». بعد `M3.05` لا خريطة موازية أصلاً — النشاط
  // عمودٌ في صفّ النموذج، فلا وجود لمؤشّر معلَّق يُشار به إلى العدم. والحرس
  // الباقي هو رفض المستودع أن يُكتب «نشطٌ غير معتمد».
  const { registry, repository, id } = await activeModel();
  const stored = await repository.findById(id);
  assert.ok(stored);
  await assert.rejects(
    () =>
      repository.update(id, Number(stored['version']), {
        state: ModelState.SUSPENDED,
        stateReason: 'شبهة',
      }),
    /MODEL_ACTIVE_MUST_BE_APPROVED/,
    'كُتب نشطٌ غير معتمد',
  );
  assert.equal((await registry.getActive('audit'))?.id, id);
});

test('D2 — نشطان لغرض واحد يفشلان مُغلقاً لا يُقرأ أحدهما اعتباطاً', async () => {
  const { registry, repository, id } = await activeModel();
  // فسادٌ تمنعه القاعدة بفهرس جزئي فريد، ولا يمنعه مستودع الذاكرة. وحرسُ
  // السجل هنا هو ما يجعل القراءة تفشل مُغلقة بدل أن تختار أحدهما بلا معيار.
  await repository.insert({
    id: 'model:duplicate-active',
    name: 'مدقّق-ثانٍ',
    provider: 'internal',
    modelVersion: '1.0.1',
    purpose: 'audit',
    fingerprint: 'a'.repeat(64),
    state: ModelState.APPROVED,
    approvedBy: 'crown',
    isActive: true,
  });
  await assert.rejects(() => registry.getActive('audit'), /MODEL_ACTIVE_AMBIGUOUS/);
  assert.ok(id);
});

test('لا نشط لغرضٍ لم يُفعَّل فيه شيء ⇒ null صريحة', async () => {
  const { registry } = await activeModel();
  assert.equal(await registry.getActive('غرض-آخر'), null);
});

test('انتقال بلا سبب لا يمحو سبب الانتقال السابق بـundefined', async () => {
  const { registry, id } = await activeModel();
  await registry.transition(id, ModelState.SUSPENDED, 'سبب معلن');
  assert.equal((await registry.get(id))?.stateReason, 'سبب معلن');
  await registry.transition(id, ModelState.SUSPENDED);
  // سببٌ غائب لا يُكتب فوق سببٍ معلن، ولا يُقرأ سبباً للانتقال الجديد: الحقل
  // يبقى كما هو ووقتُ التغيير هو ما يتقدّم.
  assert.equal((await registry.get(id))?.stateReason, 'سبب معلن');
});
