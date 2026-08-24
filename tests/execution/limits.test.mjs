/**
 * اختبار حدود الموارد — الخطوة `M5.05`.
 *
 * المعيار: مهمة تتجاوز الحدّ **تُقتل فعلاً** ويُسجَّل سببها. ولذلك:
 *
 * - المهلة تُختبر على مُعالِج يحتكر المعالج في **حلقة محسوبة**، لا على انتظارٍ
 *   خامل. حلقةٌ كهذه تُثبت أن القتل بإشارة على عملية، لا `Promise.race`.
 * - حدّ الذاكرة يُختبر على مُعالِج يُكبّر الكومة حتى الموت، ويُفحص أن الرمز
 *   `TASK_MEMORY_EXCEEDED` لا `TASK_TIMEOUT`: خلطُ الرمزين يُخفي عيب الحدّ.
 * - الإلغاء القسري يُختبر بقتلٍ لمتجمّد لا يتعاون.
 * - وفي كل حال يُفحص أن العملية الابن **لم تبقَ حيّة** بعد النتيجة.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { GRACE_MS, LIMIT_ERRORS, LimitError, runWithLimits } from '../../src/execution/limits.mjs';

test('المُعالِج ينجح في عملية منفصلة فعلاً (pid مختلف)', async () => {
  const run = await runWithLimits({
    action: 'اختبار.نجاح',
    payload: { قيمة: 7 },
    timeoutMs: 10_000,
    memoryLimitMb: 128,
  });

  assert.equal(run.ok, true, `أخفق التنفيذ: ${String(run.code)} — ${String(run.message)}`);
  assert.equal(run.code, null);
  assert.equal(run.killed, false);
  assert.equal(run.exitCode, 0);
  const result = run.result ?? {};
  assert.equal(result['نُفِّذ'], true);
  // العزلة ليست ادّعاءً: معرّف عملية المُعالِج يختلف عن معرّف عملية الاختبار.
  assert.notEqual(result['pid'], process.pid, 'نُفّذ المُعالِج في عملية الاختبار نفسها');
  assert.deepEqual(result['صدى'], { قيمة: 7 });
  assert.ok(run.durationMs >= 0);
});

test('حلقة محسوبة تحتكر المعالج تُقتل عند المهلة برمز TASK_TIMEOUT', async () => {
  const startedAt = Date.now();
  const run = await runWithLimits({
    action: 'اختبار.تجمّد',
    payload: { busy: true },
    timeoutMs: 600,
    memoryLimitMb: 128,
  });
  const elapsed = Date.now() - startedAt;

  assert.equal(run.ok, false);
  assert.equal(run.code, LIMIT_ERRORS.TIMEOUT, `رمزٌ غير متوقّع: ${String(run.code)}`);
  assert.equal(run.killed, true, 'المهلة انطقت بلا قتل ⇒ العمل استمرّ');
  // القتل حقيقي: حلقة محسوبة لا تستجيب لـ`SIGTERM` فتُقتل بـ`SIGKILL` بعد التهذيب.
  assert.equal(run.signal, 'SIGKILL', `الإشارة: ${String(run.signal)}`);
  assert.ok(elapsed >= 600, `انتهى قبل مهلته (${elapsed}ms)`);
  assert.ok(elapsed < 600 + GRACE_MS + 4_000, `القتل تأخّر كثيراً (${elapsed}ms)`);
  assert.match(String(run.message), /مهلتها/);
});

test('انتظار خامل يُقتل أيضاً عند المهلة (وتُقبل نافذة التهذيب)', async () => {
  const run = await runWithLimits({
    action: 'اختبار.تجمّد',
    payload: { busy: false },
    timeoutMs: 400,
    memoryLimitMb: 128,
  });

  assert.equal(run.code, LIMIT_ERRORS.TIMEOUT);
  assert.equal(run.killed, true);
  // المتجمّد الخامل يستجيب لـ`SIGTERM` فيخرج برمز 143؛ والمحتكر لا يستجيب فيُقتل.
  // كلا الطريقين مقبول، والمرفوض وحده أن يبقى حيّاً.
  assert.ok(
    run.signal === 'SIGKILL' || run.exitCode === 143,
    `لم يمت المتجمّد: رمز ${String(run.exitCode)} إشارة ${String(run.signal)}`,
  );
});

test('تجاوز حدّ الذاكرة يُميَّز عن المهلة برمزه الخاص', async () => {
  const run = await runWithLimits({
    action: 'اختبار.نهم-ذاكرة',
    payload: { chunkMb: 8 },
    // مهلة واسعة كي يكون الموت من الذاكرة لا من الزمن: الاختبار يفصل السببين.
    timeoutMs: 25_000,
    memoryLimitMb: 40,
  });

  assert.equal(run.ok, false);
  assert.equal(
    run.code,
    LIMIT_ERRORS.MEMORY,
    `رمزٌ غير متوقّع: ${String(run.code)} — ${String(run.message)}`,
  );
  assert.equal(run.killed, false, 'مات بالحدّ لا بقتل الأمّ — وهذا هو المقصود');
  assert.match(String(run.message), /حدّ الذاكرة/);
});

test('الإلغاء القسري يقتل متجمّداً لا يتعاون', async () => {
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 300).unref();

  const run = await runWithLimits({
    action: 'اختبار.تجمّد',
    payload: { busy: true },
    timeoutMs: 20_000,
    memoryLimitMb: 128,
    signal: controller.signal,
  });

  assert.equal(run.code, LIMIT_ERRORS.CANCELLED, `رمزٌ غير متوقّع: ${String(run.code)}`);
  assert.equal(run.killed, true);
  assert.equal(run.signal, 'SIGKILL');
  assert.match(String(run.message), /لم تُنتظر موافقة المُعالِج/);
});

test('فشل المُعالِج يُصنَّف TASK_HANDLER_FAILED لا انتهاء مهلة', async () => {
  const run = await runWithLimits({
    action: 'اختبار.فشل',
    payload: { message: 'خطأ مقصود في الاختبار' },
    timeoutMs: 5_000,
    memoryLimitMb: 128,
  });

  assert.equal(run.ok, false);
  assert.equal(run.code, LIMIT_ERRORS.HANDLER_FAILED);
  assert.equal(run.killed, false);
  assert.equal(run.message, 'خطأ مقصود في الاختبار');
});

test('فعلٌ لا مُعالِج له يُرفض برمزه من داخل الابن', async () => {
  const run = await runWithLimits({
    action: 'فعل.غير.مسجّل',
    timeoutMs: 5_000,
    memoryLimitMb: 128,
  });

  assert.equal(run.ok, false);
  assert.equal(run.code, 'TASK_ACTION_UNKNOWN');
});

test('حدٌّ غير صالح يُرفض **قبل** إقلاع أي عملية', () => {
  // الرفض تزامنيٌ لا وعدٌ مرفوض: الحدّ الفاسد خطأ في المُستدعي ينكشف قبل أن
  // يُقلع شيء، فلا تبقى عمليةٌ يتيمة تعمل بلا حدّ يحرسها.
  assert.throws(
    () => runWithLimits({ action: 'اختبار.نجاح', timeoutMs: 0, memoryLimitMb: 64 }),
    (error) => {
      assert.ok(error instanceof LimitError);
      assert.equal(error.code, LIMIT_ERRORS.LIMIT_INVALID);
      return true;
    },
  );
  assert.throws(() => runWithLimits({ action: 'اختبار.نجاح', timeoutMs: 100, memoryLimitMb: -1 }), {
    code: LIMIT_ERRORS.LIMIT_INVALID,
  });
});
