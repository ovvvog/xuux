// @ts-nocheck
// tests/sim/tpm-getcap-capabilities.test.mjs
//
// اختبارات GetCapability العميقة (متطلبو التكليف 5):
//   - جرد handles-nv-index (عضوية فهرس معرَّف ثم زواله بعد الحذف).
//   - properties-fixed/variable وقراءة TPM2_PT_NV_COUNTERS_MAX الخام.
//   - تفسير NV_COUNTERS_MAX=0 بأنه «لا حدّ أقصى ثابتاً» لا «عدم دعم»
//     (مواصفة TPM 2.0 Library Part 2: القيمة صفر = لا حدّاً ثابتاً).
//   - جرد commands يحوي الأوامر المطلوبة (NV_Increment/NV_Certify/...).
//   - حالات moreData: yes/no/غائب/نص غير معروف ⇒ فشل مغلق لا تخمين.
//
// الأجزاء static تعمل بلا swtpm. الأجزاء runtime تتطلّب المحاكي (تُتخطّى في CI).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  getCapability,
  interpretNvCountersMax,
  parsePropertyRaw,
  parseMoreData,
  parseHandlesNvIndex,
} from '../../sim/tpm/getcap.mjs';
import * as tpm from '../../sim/tpm/tpm_client.mjs';
import { isSimEnabled } from '../../sim/tpm/tcti_guard.mjs';

const sim = isSimEnabled();
const simTest = (name, fn) =>
  test(name, { skip: !sim ? 'swtpm/XUUX_TPM_SIM unavailable' : false }, fn);

// ── static: تفسير NV_COUNTERS_MAX ──

test('static: NV_COUNTERS_MAX=0 تعني «لا حدّ أقصى ثابتاً» لا «عدم دعم»', () => {
  const zero = interpretNvCountersMax(0);
  assert.equal(zero.ok, true);
  assert.equal(zero.supported, true, '0 must NOT be read as counters-unsupported');
  assert.equal(zero.semantics, 'no-fixed-maximum');
  assert.equal(zero.maxCounters, 0);

  const fromHex = interpretNvCountersMax('0x0');
  assert.equal(fromHex.ok, true);
  assert.equal(fromHex.semantics, 'no-fixed-maximum');

  const nonzero = interpretNvCountersMax('0x4');
  assert.equal(nonzero.ok, true);
  assert.equal(nonzero.semantics, 'fixed-maximum');
  assert.equal(nonzero.maxCounters, 4);
});

test('static: قيمة غير قابلة للتحليل في NV_COUNTERS_MAX ⇒ فشل مغلق', () => {
  assert.equal(interpretNvCountersMax('garbage').ok, false);
  assert.equal(interpretNvCountersMax(null).ok, false);
  assert.equal(interpretNvCountersMax(-1).ok, false);
});

// ── static: moreData ──

test('static: moreData صريحة تُقرأ، والغياب/الغريب ⇒ unknown (فشل مغلق)', () => {
  assert.equal(parseMoreData('More data: yes'), 'yes');
  assert.equal(parseMoreData('More data: no'), 'no');
  assert.equal(parseMoreData('no more-data line at all'), 'unknown');
  assert.equal(parseMoreData('More data: maybe'), 'unknown');
  assert.equal(parseMoreData(null), 'unknown');
});

// ── static: جرد المقابض ──

test('static: parseHandlesNvIndex يجرد المقابض ويتحمّل الفارغ والغريب', () => {
  assert.deepEqual(
    parseHandlesNvIndex('- 0x1500010\n- 0x1500011\n'),
    ['0x1500010', '0x1500011'],
  );
  assert.deepEqual(parseHandlesNvIndex(''), []);
  assert.deepEqual(parseHandlesNvIndex(null), []);
  // أسطر غريبة لا تُعدّ مقابض
  assert.deepEqual(parseHandlesNvIndex('some noise\n- 0x1\nnot a handle'), ['0x1']);
});

// ── static: استخراج قيمة خاصية خام ──

test('static: parsePropertyRaw يستخرج raw ولا يخمّن عند الغياب', () => {
  const sample = 'TPM2_PT_NV_INDEX_MAX:\n  raw: 0x800\nTPM2_PT_NV_COUNTERS_MAX:\n  raw: 0x0\n';
  assert.equal(parsePropertyRaw(sample, 'TPM2_PT_NV_COUNTERS_MAX'), '0x0');
  assert.equal(parsePropertyRaw(sample, 'TPM2_PT_NV_INDEX_MAX'), '0x800');
  assert.equal(parsePropertyRaw(sample, 'TPM2_PT_ABSENT'), null);
  assert.equal(parsePropertyRaw('', 'TPM2_PT_NV_COUNTERS_MAX'), null);
});

// ── runtime (تتطلّب المحاكي) ──

simTest('runtime: properties-fixed يعطي NV_COUNTERS_MAX خام ويُفسَّر صفرها صحيحاً', async () => {
  const r = await getCapability('properties-fixed');
  assert.equal(r.rc, 0);
  const raw = parsePropertyRaw(r.stdout, 'TPM2_PT_NV_COUNTERS_MAX');
  assert.ok(raw !== null, 'TPM2_PT_NV_COUNTERS_MAX must be present');
  const interpretation = interpretNvCountersMax(raw);
  assert.equal(interpretation.ok, true);
  // swtpm يُبلغ 0 ⇒ لا حدّ أقصى ثابتاً — وليس غياب دعم العدّادات
  // (والدليل العملي: العدّادات تُنشأ وتُزاد في الاختبارات الأخرى).
  assert.equal(interpretation.semantics, 'no-fixed-maximum');
  console.log(`  [raw] TPM2_PT_NV_COUNTERS_MAX = ${raw} ⇒ ${interpretation.semantics}`);
});

simTest('runtime: properties-variable يعمل ويحوي خصائص NV حيّة', async () => {
  const r = await getCapability('properties-variable');
  assert.equal(r.rc, 0);
  assert.match(r.stdout, /TPM2_PT_NV_COUNTERS:/);
  assert.match(r.stdout, /TPM2_PT_HR_NV_INDEX:/);
});

simTest('runtime: جرد handles-nv-index يُظهر فهرساً معرَّفاً ثم يزول بعد حذفه', async () => {
  const NV = '0x1500012';
  await tpm.nvUndefine(NV); // تنظيف أولاً
  const empty = await getCapability('handles-nv-index');
  assert.equal(empty.rc, 0);
  const before = parseHandlesNvIndex(empty.stdout);
  assert.equal(before.includes(NV.toLowerCase()), false, 'index must not exist before define');

  const def = await tpm.nvDefineCounter(NV);
  assert.equal(def.rc, 0, `nvdefine should succeed, stderr: ${def.stderr}`);
  const after = await getCapability('handles-nv-index');
  const present = parseHandlesNvIndex(after.stdout);
  assert.ok(
    present.some((h) => h.toLowerCase() === NV.toLowerCase()),
    `defined index ${NV} must appear in handles-nv-index inventory: ${present.join(', ')}`,
  );

  await tpm.nvUndefine(NV);
  const removed = await getCapability('handles-nv-index');
  const gone = parseHandlesNvIndex(removed.stdout);
  assert.equal(
    gone.some((h) => h.toLowerCase() === NV.toLowerCase()),
    false,
    'index must disappear from inventory after undefine',
  );
});

simTest('runtime: جرد commands يحوي الأوامر المطلوبة لمسار العدّاد', async () => {
  const r = await getCapability('commands');
  assert.equal(r.rc, 0);
  const required = [
    'TPM2_CC_NV_DefineSpace',
    'TPM2_CC_NV_UndefineSpace',
    'TPM2_CC_NV_Increment',
    'TPM2_CC_NV_Read',
    'TPM2_CC_NV_ReadPublic',
    'TPM2_CC_NV_Certify',
  ];
  const missing = required.filter((c) => !r.stdout.includes(c + ':'));
  assert.deepEqual(missing, [], `required commands missing from capability inventory: ${missing}`);
});

simTest('runtime: moreData تُفسَّر فقط إن وُجدت صريحة، وإلا unknown', async () => {
  const r = await getCapability('handles-nv-index');
  assert.equal(r.rc, 0);
  const md = parseMoreData(r.stdout);
  // القيمة إما yes أو no أو unknown — كلها مقبولة كحالة، والمهم ألا يُخمَّن
  assert.ok(['yes', 'no', 'unknown'].includes(md), `unexpected moreData state: ${md}`);
});
