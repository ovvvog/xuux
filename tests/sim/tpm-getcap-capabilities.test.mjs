// @ts-nocheck
// tests/sim/tpm-getcap-capabilities.test.mjs
//
// اختبارات GetCapability العميقة (متطلبو التكليف 5):
//   - جرد handles-nv-index (عضوية فهرس معرَّف ثم زواله بعد الحذف).
//   - properties-fixed/variable وقراءة TPM2_PT_NV_COUNTERS_MAX الخام.
//   - تفسير NV_COUNTERS_MAX=0 مربوطاً بمستوى المواصفة المعلَن (LIVE-46، WL-438): «لا حدّ أقصى ثابتاً»
//     في r1.59 فأحدث (Part 2 NOTE 2)، أو r1.38 بإراتا ≥ v1.8 (البند 2.22، 2019-07-12) عبر TPM_PT_YEAR/DAY_OF_YEAR؛
//     وإلّا «غير مثبَتة»؛ ولا يُستنتج «دعم العدّادات» من الخاصية في أيّ حال.
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

test('static: NV_COUNTERS_MAX=0 — r1.59 فأحدث ⇒ «لا حدّ ثابتاً» بنصّ NOTE 2 (LIVE-46)', () => {
  // r1.59 (0x9F) وr1.64 (0xA4) وr1.83 (0xB7، ما يعلنه swtpm 0.10.1)؛ والتاريخُ لا يلزم.
  for (const rev of [159, '0x9F', '0xA4', '0xB7', '183']) {
    const zero = interpretNvCountersMax(0, rev);
    assert.equal(zero.ok, true);
    assert.equal(zero.semantics, 'no-fixed-maximum', `rev=${rev}`);
    assert.equal(zero.basis, 'part2-r1.59+-note2');
    assert.equal(zero.maxCounters, 0);
  }
  // الحدّ: 158 دونَه، 159 عندَه.
  assert.equal(interpretNvCountersMax(0, 158).semantics, 'zero-meaning-not-established');
  assert.equal(interpretNvCountersMax(0, 159).semantics, 'no-fixed-maximum');
});

test('static: NV_COUNTERS_MAX=0 مع r1.38 — يتبعُ تاريخَ الإراتا المعلَن لا المراجعةَ وحدَها (LIVE-46)', () => {
  const r = (date) => interpretNvCountersMax('0x0', '0x8A', date);
  // إراتا v1.8 (2019-07-12 = اليوم 193) فأحدث تضيفُ الـNOTE (البند 2.22).
  for (const d of [{ year: 2019, dayOfYear: 193 }, { year: '0x7E3', dayOfYear: '0xC1' }, { year: 2019, dayOfYear: 352 }, { year: 2025, dayOfYear: 161 }]) {
    const z = r(d);
    assert.equal(z.semantics, 'no-fixed-maximum', JSON.stringify(d));
    assert.equal(z.basis, 'r1.38-errata-2.22');
  }
  // أقدمُ من أوّلِ إراتا مؤكَّدةٍ تحويه، أو تاريخُ النصّ الأصليّ (2016-09-29 = اليوم 273)، أو بلا تاريخ ⇒ غيرُ مثبَتة.
  for (const d of [{ year: 2019, dayOfYear: 192 }, { year: 2016, dayOfYear: 273 }, { year: 2018, dayOfYear: 365 }, undefined, null]) {
    const z = r(d);
    assert.equal(z.ok, true);
    assert.equal(z.semantics, 'zero-meaning-not-established', JSON.stringify(d));
  }
  // الإراتا 2.22 خاصّةٌ بـr1.38: r1.16 بتاريخٍ حديثٍ لا تُرقّى.
  assert.equal(interpretNvCountersMax(0, 116, { year: 2024, dayOfYear: 1 }).semantics, 'zero-meaning-not-established');
  // بلا مراجعة ⇒ الدلالةُ الأضعف لا الأقوى، ولو كانَ التاريخُ حديثًا.
  assert.equal(interpretNvCountersMax(0).semantics, 'zero-meaning-not-established');
  assert.equal(interpretNvCountersMax(0, null).semantics, 'zero-meaning-not-established');
  assert.equal(interpretNvCountersMax(0, undefined, { year: 2024, dayOfYear: 1 }).semantics, 'zero-meaning-not-established');

  const nonzero = interpretNvCountersMax('0x4', '0x8A');
  assert.equal(nonzero.ok, true);
  assert.equal(nonzero.semantics, 'fixed-maximum');
  assert.equal(nonzero.maxCounters, 4);
});

test('static: الخاصيةُ لا تُثبتُ دعمَ العدّادات — supportProven=false دائماً، والإثباتُ يتطلّبُ إنشاءَ عدّاد (LIVE-46)', () => {
  for (const [v, rev, d] of [[0, 159], [0, 138, { year: 2019, dayOfYear: 193 }], [0, 138], [0, undefined], [8, 138]]) {
    const r = interpretNvCountersMax(v, rev, d);
    assert.equal(r.ok, true);
    assert.equal('supported' in r, false, `supported must not be claimed for value=${v} rev=${rev}`);
    assert.equal('supportProvenBy' in r, false, 'no wording that reads as a completed proof');
    assert.equal(r.supportProven, false);
    assert.equal(r.supportProofRequires, 'counter-creation');
  }
});

test('static: مراجعةٌ أو تاريخٌ غيرُ قابلٍ للتحليل ⇒ فشلٌ مغلقٌ لا تخمين (LIVE-46)', () => {
  for (const rev of ['garbage', -1, 0, '', ' ', 1.38, 138.5, '0x', '1.38', Number.NaN, {}, true]) {
    const r = interpretNvCountersMax(0, rev);
    assert.equal(r.ok, false, `rev=${String(rev)}`);
    assert.match(r.error, /^TPM_PT_REVISION_UNKNOWN/);
  }
  // النصُّ العشريُّ والستّ‑عشريُّ كلاهما مقبول، ومتطابقان.
  assert.equal(interpretNvCountersMax(0, '138').revisionTimes100, 138);
  assert.equal(interpretNvCountersMax(0, '0x8a').revisionTimes100, 138);
  for (const d of [{ year: 2019 }, { dayOfYear: 193 }, { year: 'x', dayOfYear: 1 }, { year: 2019, dayOfYear: 0 }, { year: 2019, dayOfYear: 367 }, { year: 1999, dayOfYear: 1 }]) {
    const r = interpretNvCountersMax(0, 138, d);
    assert.equal(r.ok, false, JSON.stringify(d));
    assert.match(r.error, /^TPM_PT_SPEC_DATE_UNKNOWN/);
  }
});

test('static: قيمة غير قابلة للتحليل في NV_COUNTERS_MAX ⇒ فشل مغلق', () => {
  assert.equal(interpretNvCountersMax('garbage').ok, false);
  assert.equal(interpretNvCountersMax(null).ok, false);
  assert.equal(interpretNvCountersMax(-1).ok, false);
});

test('static: قيمةٌ خامٌ فوقَ مدى UINT32 (0xFFFFFFFF) ⇒ فشلٌ مغلقٌ لا تفسير (WL-438)', () => {
  // خاصيّاتُ TPM المُفسَّرَةُ هنا (REVISION، YEAR، DAY_OF_YEAR، NV_COUNTERS_MAX) من نوعِ UINT32؛
  // فما جاوزَ المدى لا يصدرُ عن خاصيةٍ حقيقيةٍ ولا يُقرأ مراجعةً صحيحةً أو حدًّا. الحدُّ نفسُه (0xFFFFFFFF) مقبولٌ نحوياً.
  for (const rev of [0x100000000, 4294967296, '0x100000000', '4294967296', 2 ** 53 - 1 + 1]) {
    const r = interpretNvCountersMax(0, rev);
    assert.equal(r.ok, false, `rev=${String(rev)}`);
    assert.match(r.error, /^TPM_PT_REVISION_UNKNOWN/);
  }
  for (const val of [0x100000000, '0x100000000', 4294967296, '4294967296']) {
    const r = interpretNvCountersMax(val, 159);
    assert.equal(r.ok, false, `val=${String(val)}`);
    assert.match(r.error, /^NV_COUNTERS_MAX_UNKNOWN/);
  }
  const y = interpretNvCountersMax(0, 138, { year: 0x100000000, dayOfYear: 193 });
  assert.equal(y.ok, false);
  assert.match(y.error, /^TPM_PT_SPEC_DATE_UNKNOWN/);
  // والحدُّ الأعلى للنوعِ (UINT32) نفسُه يبقى قابلًا للتحليلِ نحوياً (التفسيرُ يبقى مربوطًا بالمراجعة).
  const edge = interpretNvCountersMax(0, 0xffffffff);
  assert.equal(edge.ok, true);
  assert.equal(edge.revisionTimes100, 0xffffffff);
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
  const revision = parsePropertyRaw(r.stdout, 'TPM2_PT_REVISION');
  assert.ok(revision !== null, 'TPM2_PT_REVISION must be present');
  const year = parsePropertyRaw(r.stdout, 'TPM2_PT_YEAR');
  const dayOfYear = parsePropertyRaw(r.stdout, 'TPM2_PT_DAY_OF_YEAR');
  assert.ok(year !== null && dayOfYear !== null, 'TPM2_PT_YEAR/DAY_OF_YEAR must be present');
  const interpretation = interpretNvCountersMax(raw, revision, { year, dayOfYear });
  assert.equal(interpretation.ok, true);
  // swtpm يُبلغ 0 ومراجعةً ≥ 1.59 ⇒ لا حدّ أقصى ثابتاً (Part 2 NOTE 2) — وليس غياب دعم العدّادات
  // (والدليل العملي: العدّادات تُنشأ وتُزاد في الاختبارات الأخرى). وعلى r1.38 تتبعُ الدلالةُ تاريخَ الإراتا.
  if (Number(raw) === 0) {
    assert.ok(Number(revision) >= 159, `swtpm revision ${revision} expected ≥ 1.59`);
    assert.equal(interpretation.semantics, 'no-fixed-maximum');
  }
  console.log(
    `  [raw] TPM2_PT_NV_COUNTERS_MAX = ${raw} @ TPM2_PT_REVISION = ${revision}, YEAR = ${year}, DAY_OF_YEAR = ${dayOfYear} ⇒ ${interpretation.semantics} (${interpretation.basis})`,
  );
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
