// @ts-nocheck
// tests/sim/tpm-nv-counter.test.mjs
//
// اختبار النموذج: حذف + إعادة تعريف العدّاد بحالته الخام.
// يبرهن على سلوك swtpm: عدّاد بعد إعادة التعريف يبدأ فوق الحد الأقصى السابق.
//
// تنبيه أمان: هذا سلوك swtpm 0.10.1. سلوك TPM الحقيقي قد يختلف (قد يُصفّر إلى 1).
// لذلك ضمان ADR 0007 المضاد للإعادة يعتمد على مقارنة body.counter مع عدّاد TPM
// + ملف staged، لا على رتابة العدّاد عبر إعادة التعريف. هذا يُوثَّق في التقرير.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isSimEnabled } from '../../sim/tpm/tcti_guard.mjs';
import * as tpm from '../../sim/tpm/tpm_client.mjs';

const sim = isSimEnabled();
const simTest = (name, fn) =>
  test(name, { skip: !sim ? 'swtpm/XUUX_TPM_SIM unavailable' : false }, fn);

const NV = '0x150000F';

simTest('nv-counter: حذف + إعادة تعريف يبدأ فوق الحد الأقصى السابق (قيم خام)', async () => {
  // 1. أنشئ العدّاد وزِده عدة مرات، وسجّل القيمة الخام.
  await tpm.nvUndefine(NV);
  await tpm.nvDefineCounter(NV);
  await tpm.nvIncrement(NV);
  await tpm.nvIncrement(NV);
  await tpm.nvIncrement(NV);
  const before = await tpm.nvReadCounter(NV);
  assert.equal(before.rc, 0);
  const beforeVal = before.counter;
  assert.ok(beforeVal >= 3, `before counter should be >= 3, got ${beforeVal}`);

  // 2. احذف وأعد تعريف (محاكاة «عدّاد جديد»).
  await tpm.nvUndefine(NV);
  await tpm.nvDefineCounter(NV);

  // 3. الزيادة الأولى على العدّاد «الجديد».
  const inc = await tpm.nvIncrement(NV);
  assert.equal(inc.rc, 0);
  const after = await tpm.nvReadCounter(NV);
  assert.equal(after.rc, 0);
  const afterVal = after.counter;

  // القيمة الخام قبل/بعد: afterVal يجب أن تكون فوق beforeVal على swtpm.
  assert.ok(
    afterVal > beforeVal,
    `new counter (${afterVal}) must be above previous max (${beforeVal}) on swtpm`,
  );

  // سجلّ القيم الخام للتقرير.
  console.log(
    `  [raw] before=${beforeVal} (0x${beforeVal.toString(16)}) after=${afterVal} (0x${afterVal.toString(16)})`,
  );
});

simTest('nv-counter: readPublic يرجع اسم الفهرس بعد التعريف', async () => {
  await tpm.nvUndefine(NV);
  await tpm.nvDefineCounter(NV);
  const rp = await tpm.nvReadPublic(NV);
  assert.equal(rp.rc, 0);
  assert.match(rp.stdout, /0x150000f/i);
});
