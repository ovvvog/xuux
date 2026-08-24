/**
 * اختبار دورة حياة المهمة — الخطوة `M5.01`.
 *
 * الحرس المطلوب: لا انتقال يُقبل إلا إن كان **مُعلناً في قائمة المسموح**. ولذلك
 * لا يكتفي هذا الملف بأمثلةٍ منتقاة تنجح، بل يمرّ على **كل زوج** من الحالات
 * السبع (49 زوجاً) ويطابق قرار `assertTransition` بقائمة `ALLOWED_TRANSITIONS`
 * حرفاً بحرف: كل زوج مسموح يجب أن يمرّ، وكل زوج غير مسموح يجب أن يُرفض برمزٍ
 * مقروء آلياً. اختبارُ أمثلةٍ منتقاة يمرّ ولو نُسي زوجٌ خطِر، وهذا لا يمرّ.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ALLOWED_TRANSITIONS,
  LIFECYCLE_ERRORS,
  LifecycleError,
  TERMINAL_STATES,
  TaskLifecycle,
  assertTransition,
  isTaskState,
  transitionMatrix,
} from '../../src/execution/lifecycle.mjs';

const ALL_STATES = Object.values(TaskLifecycle);

test('الحالات السبع معلنة ومتّسقة مع جدول الانتقالات', () => {
  assert.equal(ALL_STATES.length, 7);
  // كل حالة لها مدخل في الجدول، وكل مدخل في الجدول حالةٌ معلنة: الاتّساق في
  // الاتجاهين، فلا حالة بلا قانون ولا قانون لحالة لا وجود لها.
  for (const state of ALL_STATES) {
    assert.ok(Object.hasOwn(ALLOWED_TRANSITIONS, state), `لا مدخل لـ${state}`);
  }
  for (const key of Object.keys(ALLOWED_TRANSITIONS)) {
    assert.ok(isTaskState(key), `مدخل لا يقابل حالة: ${key}`);
  }
});

test('كل زوج من الحالات يتبع قائمة المسموح وحدها — 49 زوجاً', () => {
  let allowed = 0;
  let rejected = 0;

  for (const from of ALL_STATES) {
    for (const to of ALL_STATES) {
      const list = ALLOWED_TRANSITIONS[from] ?? [];
      const isAllowed = list.includes(to);

      if (isAllowed) {
        // `assertTransition` حارسٌ لا مُحوِّل: تُعيد `void` وتُرفع عند المنع. فالنجاح
        // هو ألّا تُرفع، والاختبار يُثبت ذلك بأنها لا ترمي.
        assert.doesNotThrow(() => assertTransition(from, to), `كان يجب قبول ${from} ⇒ ${to}`);
        allowed += 1;
        continue;
      }

      assert.throws(
        () => assertTransition(from, to),
        (error) => {
          assert.ok(error instanceof LifecycleError, `خطأ من نوع غير معلن في ${from} ⇒ ${to}`);
          // الحالة النهائية لها رمزها الخاص لأن سببها مختلف: ليس أن الانتقال
          // ممنوع، بل أن أمر المهمة انتهى فلا انتقال بعده أصلاً.
          const expected = TERMINAL_STATES.has(from)
            ? LIFECYCLE_ERRORS.TERMINAL
            : LIFECYCLE_ERRORS.ILLEGAL_TRANSITION;
          assert.equal(error.code, expected, `رمز غير متوقّع في ${from} ⇒ ${to}`);
          assert.equal(error.from, from);
          assert.equal(error.to, to);
          return true;
        },
        `كان يجب رفض ${from} ⇒ ${to}`,
      );
      rejected += 1;
    }
  }

  assert.equal(allowed + rejected, 49, 'لم تُغطَّ كل الأزواج');
  // رقمٌ محسوب لا مُقدَّر: مجموع أطوال قوائم المسموح. إن أضاف أحدهم انتقالاً
  // جديداً فسيتغيّر العدّ هنا فيلزمه أن يُعلنه صراحةً في هذا الاختبار.
  const declared = ALL_STATES.reduce(
    (sum, from) => sum + (ALLOWED_TRANSITIONS[from]?.length ?? 0),
    0,
  );
  assert.equal(allowed, declared);
  assert.equal(allowed, 13);
});

test('الحالات النهائية ثلاث ولا مخرج منها', () => {
  assert.deepEqual([...TERMINAL_STATES].sort(), ['cancelled', 'failed', 'succeeded']);
  for (const state of TERMINAL_STATES) {
    assert.deepEqual(ALLOWED_TRANSITIONS[state], []);
  }
});

test('لا انتقال يعود إلى created ولا انتقال من مهمة إلى نفسها', () => {
  for (const from of ALL_STATES) {
    const list = ALLOWED_TRANSITIONS[from] ?? [];
    assert.ok(!list.includes(TaskLifecycle.CREATED), `${from} يعود إلى created`);
    assert.ok(!list.includes(from), `${from} ينتقل إلى نفسه`);
  }
});

test('حالة غير معروفة تُرفض برمزها لا بخطأ عامّ', () => {
  assert.equal(isTaskState('running'), true);
  assert.equal(isTaskState('paused'), false);
  assert.throws(() => assertTransition('paused', 'running'), {
    code: LIFECYCLE_ERRORS.UNKNOWN_STATE,
  });
  assert.throws(() => assertTransition('running', 'paused'), {
    code: LIFECYCLE_ERRORS.UNKNOWN_STATE,
  });
});

test('transitionMatrix تُخرج كل زوج مع حكمه ويُمكن قيادة الاختبار بها', () => {
  const matrix = transitionMatrix();
  // المصفوفة تُخرج الأزواج **كلها** مع حكم كل زوج، لا المسموح وحده: كي تُقاد بها
  // الاختبارات في الاتجاهين ويُرسم منها المخطَّط في الوثيقة من المصدر لا من الذاكرة.
  assert.equal(matrix.length, 49);
  assert.equal(matrix.filter((pair) => pair.allowed).length, 13);
  for (const pair of matrix) {
    assert.ok(isTaskState(pair.from));
    assert.ok(isTaskState(pair.to));
    if (pair.allowed) assert.doesNotThrow(() => assertTransition(pair.from, pair.to));
    else assert.throws(() => assertTransition(pair.from, pair.to));
  }
  // مسار الحياة الكامل الذي يعتمد عليه الطابور: من الإنشاء إلى النجاح.
  const happy = ['created', 'authorized', 'scheduled', 'running', 'succeeded'];
  for (let index = 0; index + 1 < happy.length; index += 1) {
    const from = happy[index];
    const to = happy[index + 1];
    assert.ok(from !== undefined && to !== undefined);
    assert.ok(
      matrix.some((pair) => pair.from === from && pair.to === to && pair.allowed),
      `المسار السعيد ينقص ${from} ⇒ ${to}`,
    );
  }
});
