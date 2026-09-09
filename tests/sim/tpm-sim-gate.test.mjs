// @ts-nocheck
// tests/sim/tpm-sim-gate.test.mjs
//
// اختبارات بوابة محاكي TPM: قواعد التخطّي والحارس ضد TCTI الحقيقي.
// غير إنتاجي. هذه الاختبارات تعمل بلا swtpm (تختبر المنطق فقط).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertSimulatorTcti, isSimEnabled } from '../../sim/tpm/tcti_guard.mjs';

test('guard: swtpm TCTI مقبول', () => {
  assert.equal(assertSimulatorTcti('swtpm:host=localhost,port=2321'), 'swtpm:host=localhost,port=2321');
  assert.equal(assertSimulatorTcti('mssim:host=127.0.0.1,port=2321'), 'mssim:host=127.0.0.1,port=2321');
});

test('guard: TCTI جهازي حقيقي مرفوض', () => {
  assert.throws(() => assertSimulatorTcti('device:/dev/tpm0'), /TCTI_REAL_OR_UNKNOWN/);
  assert.throws(() => assertSimulatorTcti('device:/dev/tpmrm0'), /device TCTI refused/);
});

test('guard: TCTI فارغ أو غير محاكٍ مرفوض', () => {
  assert.throws(() => assertSimulatorTcti(''), /empty/);
  assert.throws(() => assertSimulatorTcti('tcp:host=1.2.3.4,port=2321'), /not a simulator TCTI/);
});

test('guard: محاولة حقن shell عبر TCTI مرفوضة', () => {
  assert.throws(() => assertSimulatorTcti('swtpm:host=localhost;rm -rf /'), /TCTI_REAL_OR_UNKNOWN/);
  assert.throws(() => assertSimulatorTcti('$(whoami)'), /TCTI_REAL_OR_UNKNOWN/);
});

test('gate: isSimEnabled يعيد boolean', () => {
  assert.equal(typeof isSimEnabled(), 'boolean');
});

test('gate: في غياب XUUX_TPM_SIM يعيد false (مسار CI الافتراضي)', () => {
  const saved = process.env.XUUX_TPM_SIM;
  delete process.env.XUUX_TPM_SIM;
  try {
    assert.equal(isSimEnabled(), false);
  } finally {
    if (saved !== undefined) process.env.XUUX_TPM_SIM = saved;
  }
});
