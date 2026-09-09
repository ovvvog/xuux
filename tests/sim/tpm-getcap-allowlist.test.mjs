// @ts-nocheck
// tests/sim/tpm-getcap-allowlist.test.mjs
//
// اختبارات مساعد GetCapability: قائمة مسموحات ثابتة (static) + runtime.
// الأجزاء static تعمل بلا swtpm. أجزاء runtime تتطلب المحاكي (تُتخطّى في CI).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ALLOWED_CAPS, getCapability } from '../../sim/tpm/getcap.mjs';
import { isSimEnabled } from '../../sim/tpm/tcti_guard.mjs';

const sim = isSimEnabled();
const simTest = (name, fn) =>
  test(name, { skip: !sim ? 'swtpm/XUUX_TPM_SIM unavailable' : false }, fn);

// ── static: بنية القائمة ──

test('static: ALLOWED_CAPS مجمّد ولا يحوي أوامر كتابة', () => {
  assert.equal(Object.isFrozen(ALLOWED_CAPS), true);
  for (const cap of ['nvdefine', 'nvundefine', 'nvincrement', 'nvwrite', 'nvread', 'startup', 'clear']) {
    assert.equal(ALLOWED_CAPS.has(cap), false, `write/cmd "${cap}" must NOT be in allowlist`);
  }
});

test('static: القائمة تحتوي فقط قدرات GetCapability المعروفة', () => {
  const expected = [
    'algorithms', 'commands', 'pcrs', 'properties-fixed', 'properties-variable',
    'ecc-curves', 'handles-transient', 'handles-persistent', 'handles-permanent',
    'handles-pcr', 'handles-nv-index', 'handles-loaded-session', 'handles-saved-session', 'vendor',
  ];
  assert.deepEqual([...ALLOWED_CAPS].sort(), [...expected].sort());
});

// ── runtime: الرفض (تعمل بلا swtpm لأنها تُرفض قبل الوصول للـ TCTI) ──

test('runtime: cap خارج القائمة يُرفض قبل أي تنفيذ', () => {
  assert.throws(() => getCapability('nvdefine'), /DISALLOWED_CAPABILITY/);
  assert.throws(() => getCapability('getcapability'), /DISALLOWED_CAPABILITY/);
  assert.throws(() => getCapability('ALGORITHMS'), /DISALLOWED_CAPABILITY/); // حساس للحالة
});

test('runtime: حقن shell/وسائط إضافية مستحيل — cap محصور بنص واحد', () => {
  // حتى لو احوى مسافات/فواصل، يُرفض لعدم المطابقة النصية الصارمة.
  assert.throws(() => getCapability('algorithms --foo'), /DISALLOWED_CAPABILITY/);
  assert.throws(() => getCapability('algorithms;rm -rf /'), /DISALLOWED_CAPABILITY/);
  assert.throws(() => getCapability('algorithms$(id)'), /DISALLOWED_CAPABILITY/);
});

// ── runtime: مسار سعيد يتطلب المحاكي ──

simTest('runtime: استعلام algorithms ناجح ويُرجع stdout', async () => {
  const r = await getCapability('algorithms');
  assert.equal(r.rc, 0);
  assert.ok(r.stdout.length > 0);
  assert.equal(r.argv.join(' '), 'tpm2 getcap algorithms');
});

simTest('runtime: properties-fixed يحوي NV_INDEX_MAX', async () => {
  const r = await getCapability('properties-fixed');
  assert.equal(r.rc, 0);
  assert.match(r.stdout, /TPM2_PT_NV_INDEX_MAX/);
});

simTest('runtime: handles-nv-index يسرد فهارس NV', async () => {
  const r = await getCapability('handles-nv-index');
  assert.equal(r.rc, 0);
  // قد يكون فارغاً أو يحوي فهارس — المهم أنه لا يخطئ.
});
