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

/** سجل ونموذج معتمد ومُفعَّل، وهو الوضع الذي تُختبر عليه البوابات. */
function activeModel() {
  const log = new EventLog();
  const registry = new ModelRegistry({ log });
  const model = registry.register({
    name: 'مدقّق',
    version: '1.0.0',
    purpose: 'audit',
    source: 'internal',
    weights: 'w-1',
  });
  registry.transition(model.id, ModelState.SANDBOXED, 'اختبار معزول');
  registry.transition(model.id, ModelState.APPROVED, 'اعتماد');
  registry.activate(model.id);
  return { log, registry, id: model.id };
}

test('D4 — getActive تُرجع صورة مُجمَّدة لا المرجع الداخلي', () => {
  const { registry, id } = activeModel();
  const active = registry.getActive('audit');
  assert.ok(active, 'لا نموذج نشط');
  assert.equal(Object.isFrozen(active), true, 'الصورة غير مُجمَّدة');
  // العيب الأصلي: هذا الكائن **هو** السجل الداخلي، فالتعديل عليه يمرّ.
  assert.notEqual(active, registry.models.get(id), 'المُرجَع هو المرجع الداخلي نفسه');
});

test('D4 — تعديل الصورة المُرجَعة لا يُغيّر حالة النموذج في السجل', () => {
  const { registry, id } = activeModel();
  const active = /** @type {Record<string, unknown>} */ (
    /** @type {unknown} */ (registry.getActive('audit'))
  );
  assert.throws(
    () => {
      'use strict';
      active.state = ModelState.ROLLED_BACK;
    },
    TypeError,
    'التعديل لم يُرفض',
  );
  const internal = registry.models.get(id);
  assert.equal(internal?.state, ModelState.APPROVED, 'الحالة الداخلية انحرفت');
});

test('D1 — القدرات في الصورة المُرجَعة لا تشترك مع مصفوفة السجل', () => {
  const log = new EventLog();
  const registry = new ModelRegistry({ log });
  const model = registry.register({
    name: 'مولّد',
    version: '2.0.0',
    purpose: 'draft',
    source: 'internal',
    weights: 'w-2',
    capabilities: ['text:generate'],
  });
  // العيب: `Object.freeze({ ...record })` تجميدٌ **سطحي**، والمصفوفة الداخلية
  // نفسها ممرَّرة بالمرجع — فمن أخذ «صورة مُجمَّدة» قدر أن يدسّ قدرة محرَّمة
  // في نموذج مسجَّل، متجاوزاً فحص `FORBIDDEN_CAPABILITIES` كله.
  assert.throws(() => model.capabilities.push('bypass-crown'), TypeError, 'المصفوفة قابلة للدسّ');
  assert.deepEqual(registry.models.get(model.id)?.capabilities, ['text:generate']);
});

test('D3 — تعليق النموذج النشط يُسقط كونه نشطاً لغرضه', () => {
  const { registry, id } = activeModel();
  registry.transition(id, ModelState.SUSPENDED, 'شبهة انحراف');
  assert.equal(registry.getActive('audit'), null, 'المُعلَّق ما زال نشطاً لغرضه');
});

test('D3 — إرجاع النموذج النشط يُسقط كونه نشطاً لغرضه', () => {
  const { registry, id } = activeModel();
  registry.transition(id, ModelState.ROLLED_BACK, 'إرجاع');
  assert.equal(registry.getActive('audit'), null, 'المُرجَع عنه ما زال نشطاً لغرضه');
});

test('D3 — إسقاط النشاط يُسجَّل حدثاً فلا يقع بصمت', () => {
  const { log, registry, id } = activeModel();
  registry.transition(id, ModelState.SUSPENDED, 'شبهة انحراف');
  const kinds = log.events.map((e) => e.type);
  assert.ok(kinds.includes('model.deactivated'), `لا حدث إسقاط: ${kinds.join(', ')}`);
});

test('D3 — إعادة الاعتماد بعد التعليق تحتاج تفعيلاً صريحاً', () => {
  const { registry, id } = activeModel();
  registry.transition(id, ModelState.SUSPENDED, 'شبهة');
  registry.transition(id, ModelState.APPROVED, 'انتهى التحقيق');
  // الاعتماد ليس تفعيلاً: الرجوع إلى الخدمة قرارٌ يُعلن لا أثرٌ جانبي لانتقال.
  assert.equal(registry.getActive('audit'), null, 'عاد نشطاً بلا تفعيل');
  registry.activate(id);
  assert.equal(registry.getActive('audit')?.id, id);
});

test('D2 — مؤشّر نشط معلَّق يُرفع خطأً مُسمّى لا يُقرأ فراغاً', () => {
  const { registry } = activeModel();
  // محاكاة فساد حالة: مؤشّرٌ يشير إلى معرّف غير موجود في السجل. كان يُقرأ
  // `undefined` فيُخلط بـ«لا نشط»، والفرق بينهما هو الفرق بين فراغٍ وفساد.
  registry.activeByPurpose.set('audit', 'model:00000000-0000-4000-8000-000000000000');
  assert.throws(() => registry.getActive('audit'), /MODEL_ACTIVE_POINTER_DANGLING/);
});

test('D2 — مؤشّر نشط إلى نموذج غير معتمد يفشل مُغلقاً', () => {
  const { registry, id } = activeModel();
  // فساد آخر: المؤشّر قائم والنموذج موجود لكن حالته ليست معتمدة. لا يقع هذا
  // في المسار العادي بعد إصلاح D3، وحرسُه هنا لأن الفشل المُغلق لا يُبنى على
  // ثقةٍ بأن المسار العادي هو الوحيد.
  const internal = registry.models.get(id);
  assert.ok(internal);
  internal.state = ModelState.SUSPENDED;
  assert.throws(() => registry.getActive('audit'), /MODEL_ACTIVE_NOT_APPROVED/);
});

test('لا نشط لغرضٍ لم يُفعَّل فيه شيء ⇒ null صريحة', () => {
  const { registry } = activeModel();
  assert.equal(registry.getActive('غرض-آخر'), null);
});

test('انتقال بلا سبب لا يمحو سبب الانتقال السابق بـundefined', () => {
  const { registry, id } = activeModel();
  registry.transition(id, ModelState.SUSPENDED, 'سبب معلن');
  const before = registry.models.get(id)?.reason;
  assert.equal(before, 'سبب معلن');
  registry.transition(id, ModelState.SUSPENDED);
  // سببٌ غائب لا يُكتب فوق سببٍ معلن، ولا يُقرأ سبباً للانتقال الجديد: الحقل
  // يبقى كما هو ووقتُ التغيير هو ما يتقدّم.
  assert.equal(registry.models.get(id)?.reason, 'سبب معلن');
});
