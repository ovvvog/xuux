// @ts-nocheck
// tests/sim/tpm-host-decode.test.mjs
//
// WL-410 — مُفسِّرُ جردِ TPM للمضيف (sim/tpm-host/decode_inventory.mjs) على بياناتِ محاكٍ:
// ملفٌّ ثابتٌ مُلتقَطٌ من swtpm (tests/fixtures/tpm-host/swtpm-inventory.json)، وحالاتٌ
// مفقودة/تالفة/مجهولة. الأجزاءُ static تعملُ بلا swtpm ولا pwsh.
// حدٌّ مُعلَن: بياناتُ محاكٍ — تُثبِتُ سلوكَ المُفسِّرِ لا خصائصَ أيِّ شريحةٍ حقيقية.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import {
  analyzeInventory,
  checkAllowedCommand,
  classifyResponseCode,
  decodeGetCapabilityResponse,
  decodeNvReadPublicResponse,
  decodeResponseHeader,
  decodeTpmaNv,
  interpretNvCountersMax,
  propertyName,
} from '../../sim/tpm-host/decode_inventory.mjs';

const fixturePath = fileURLToPath(new URL('../fixtures/tpm-host/swtpm-inventory.json', import.meta.url));
const decoderPath = fileURLToPath(new URL('../../sim/tpm-host/decode_inventory.mjs', import.meta.url));
const loadFixture = () => JSON.parse(readFileSync(fixturePath, 'utf8'));
const hostDoc = (inventory, extra = {}) => ({ schema: 'xuux.tpm-host-inventory/1', exitCode: 0, status: 'COMPLETE', inventory, ...extra });
const qById = (inv, id) => inv.queries.find((q) => q.id === id);

test('static: الملفُّ الثابتُ (swtpm) يُفسَّرُ كاملاً ويُصنَّفُ «ليس دليلَ عتاد»', () => {
  const r = analyzeInventory(loadFixture());
  assert.deepEqual(r.errors, []);
  assert.equal(r.evidenceClass, 'simulator-not-hardware');
  assert.equal(r.requestsAllAllowlisted, true);
  for (const [k, v] of Object.entries(r.capabilitiesComplete)) assert.equal(v, true, k);
  assert.equal(r.tpm.manufacturer, 'IBM');
  assert.equal(r.tpm.familyIndicator, '2.0');
  assert.equal(r.nv.handleCount, r.nv.nvIndexesDefined, 'عددُ المقابضِ يطابقُ TPM_PT_HR_NV_INDEX');
  assert.equal(r.nv.freeNvBytes, null, 'لا خاصيّةَ تقيسُ السعةَ الحرّة — لا تُخترَع');
  const counter = r.nvIndexes.find((e) => e.handle === '0x01500016');
  assert.equal(counter.attributes.ntName, 'COUNTER');
  assert.equal(counter.dataSize, 8);
  assert.ok(counter.attributes.set.includes('NO_DA'));
  assert.deepEqual(r.nv.ownerRangeInUse, ['0x01800001']);
  assert.equal(r.commands.implementedByTpm.TPM2_NV_Increment.implemented, true);
  assert.match(r.commands.note, /NOT the Windows TBS allow list/);
  assert.equal(r.tbsObserved.TPM2_NV_DefineSpace, 'not-sent-by-design');
});

test('static: transport=tbs وحدَه يُصنَّفُ hardware-tbs؛ والمجهولُ لا يُرقّى', () => {
  const inv = loadFixture();
  assert.equal(analyzeInventory(hostDoc({ ...inv, transport: 'tbs' })).evidenceClass, 'hardware-tbs');
  assert.equal(analyzeInventory(hostDoc({ ...inv, transport: 'mystery' })).evidenceClass, 'unknown-transport');
});

test('static: NV_COUNTERS_MAX — الصفرُ ليس «غيرَ مدعوم»، ودلالتُه تتبعُ مستوى المواصفةِ المعلَنَ (المراجعةُ وتاريخُ الإراتا) كما في WL-439', () => {
  // r1.59 فأحدث: NOTE 2 — والمراجعةُ تغلبُ التاريخَ (r1.59 بتاريخٍ قديمٍ تبقى بلا حدٍّ ثابتٍ).
  assert.equal(interpretNvCountersMax(0, 159).semantics, 'no-fixed-maximum');
  assert.equal(interpretNvCountersMax(0, 183).semantics, 'no-fixed-maximum');
  assert.equal(interpretNvCountersMax(0, 159, { year: 2014, dayOfYear: 10 }).semantics, 'no-fixed-maximum');
  assert.equal(interpretNvCountersMax(0, 183).basis, 'part2-r1.59+-note2');
  // r1.38: النصُّ الأصليُّ بلا NOTE؛ والإراتا (البندُ 2.22، من v1.8 بتاريخ 2019-07-12 = اليوم 193) تضيفُها.
  const r138 = interpretNvCountersMax(0, 138);
  assert.equal(r138.semantics, 'zero-meaning-not-established');
  assert.match(r138.note, /does not mean unsupported/);
  assert.equal(interpretNvCountersMax(0, undefined).semantics, 'zero-meaning-not-established');
  assert.equal(interpretNvCountersMax(0, 138, null).semantics, 'zero-meaning-not-established');
  assert.equal(interpretNvCountersMax(0, 138, { year: 2017, dayOfYear: 16 }).semantics, 'zero-meaning-not-established'); // إراتا v1.0
  assert.equal(interpretNvCountersMax(0, 138, { year: 2019, dayOfYear: 192 }).semantics, 'zero-meaning-not-established'); // اليومُ قبلَ v1.8
  assert.equal(interpretNvCountersMax(0, undefined, { year: 2024, dayOfYear: 25 }).semantics, 'zero-meaning-not-established'); // تاريخٌ بلا مراجعةٍ لا يكفي
  assert.equal(interpretNvCountersMax(0, 137, { year: 2024, dayOfYear: 25 }).semantics, 'zero-meaning-not-established'); // مراجعةٌ أخرى غيرُ 138
  const errata = interpretNvCountersMax(0, 138, { year: 2019, dayOfYear: 193 });
  assert.equal(errata.semantics, 'no-fixed-maximum');
  assert.equal(errata.basis, 'r1.38-errata-2.22');
  assert.equal(interpretNvCountersMax(0, 138, { year: 2024, dayOfYear: 25 }).semantics, 'no-fixed-maximum');
  // لا ادّعاءَ دعمٍ: الخاصيةُ لا تُثبِتُه (WL-439).
  assert.equal(errata.supportProven, false);
  assert.equal(errata.supportProofRequires, 'counter-creation');
  // القيمةُ الموجبةُ حدٌّ أعلى لا سعةٌ حرّة.
  const r8 = interpretNvCountersMax(8, 138);
  assert.equal(r8.semantics, 'fixed-maximum');
  assert.match(r8.note, /not free capacity/);
  // فشلٌ مغلق: تاريخٌ ناقصٌ أو خارجُ المدى، وقيمٌ غيرُ قابلةٍ للتحليل.
  assert.equal(interpretNvCountersMax(0, 138, { year: 2019 }).ok, false);
  assert.equal(interpretNvCountersMax(0, 138, { year: 2012, dayOfYear: 200 }).ok, false);
  assert.equal(interpretNvCountersMax(0, 138, { year: 2019, dayOfYear: 400 }).ok, false);
  assert.equal(interpretNvCountersMax(-1, 138).ok, false);
  assert.equal(interpretNvCountersMax(4294967296, 138).ok, false);
  assert.equal(interpretNvCountersMax('8', 138).ok, false);
  assert.equal(interpretNvCountersMax(0, 0).ok, false);
});

test('static: الجردُ الكاملُ يمرّرُ المراجعةَ والتاريخَ إلى المُفسِّرِ (swtpm: r1.83 وتاريخُ 2024)', () => {
  const r = analyzeInventory(hostDoc(loadFixture()));
  assert.equal(r.nv.nvCountersMax.ok, true);
  assert.equal(r.nv.nvCountersMax.semantics, 'no-fixed-maximum');
  assert.equal(r.nv.nvCountersMax.basis, 'part2-r1.59+-note2');
  assert.deepEqual(r.nv.nvCountersMax.specDate, { year: 2024, dayOfYear: 25 });
  assert.equal(r.nv.nvCountersMax.revisionTimes100, 183);
});

test('static: ردودٌ مقطوعة/متعارضةُ الطولِ/وسمٌ غريبٌ ⇒ أخطاءٌ مسمّاة', () => {
  assert.equal(decodeResponseHeader(null).error, 'RESPONSE_ABSENT');
  assert.equal(decodeResponseHeader(Buffer.from('800100', 'hex')).error, 'RESPONSE_TRUNCATED_HEADER');
  assert.equal(decodeResponseHeader(Buffer.from('80010000000b00000000', 'hex')).error, 'RESPONSE_SIZE_MISMATCH');
  assert.equal(decodeResponseHeader(Buffer.from('12340000000a00000000', 'hex')).error, 'RESPONSE_TAG_UNEXPECTED');
  // moreData = 2 ليس TPMI_YES_NO
  const capHead = (more, cap, count) => {
    const b = Buffer.alloc(19);
    b.writeUInt16BE(0x8001, 0);
    b.writeUInt32BE(19, 2);
    b[10] = more;
    b.writeUInt32BE(cap, 11);
    b.writeUInt32BE(count, 15);
    return b;
  };
  const bad = capHead(2, 6, 0);
  assert.equal(decodeGetCapabilityResponse(bad, 6).error, 'MORE_DATA_NOT_YES_NO');
  // محدِّدُ قدرةٍ لا يطابقُ الطلب
  const sel = capHead(0, 1, 0);
  assert.equal(decodeGetCapabilityResponse(sel, 6).error, 'CAPABILITY_SELECTOR_MISMATCH');
  // عددٌ معلَنٌ أكبرُ من البايتات
  const len = Buffer.concat([capHead(0, 6, 2), Buffer.alloc(8)]);
  len.writeUInt32BE(27, 2);
  assert.equal(decodeGetCapabilityResponse(len, 6).error, 'LIST_LENGTH_INCONSISTENT');
  // قدرةٌ لا يفسّرُها المُفسِّر (PCRS)
  const pcr = capHead(0, 5, 0);
  assert.equal(decodeGetCapabilityResponse(pcr).error, 'CAPABILITY_UNSUPPORTED_BY_DECODER');
});

test('static: رموزُ الخطأِ تُصنَّفُ ولا تُسقَط — ومنها TPM_E_COMMAND_BLOCKED', () => {
  assert.equal(classifyResponseCode(0x80280400).name, 'TPM_E_COMMAND_BLOCKED');
  assert.equal(classifyResponseCode(0x80284004).name, 'TBS_E_INVALID_CONTEXT');
  assert.equal(classifyResponseCode(0x80289999).name, 'unknown-windows-code');
  assert.equal(classifyResponseCode(0x18b).kind, 'tpm2-format1'); // TPM_RC_HANDLE + handle 1
  assert.equal(classifyResponseCode(0x18b).where, 'handle');
  assert.equal(classifyResponseCode(0x101).kind, 'tpm2-format0');
  const blocked = Buffer.from('80010000000a80280400', 'hex');
  const d = decodeGetCapabilityResponse(blocked, 6);
  assert.equal(d.error, 'TPM_ERROR');
  assert.equal(d.code.name, 'TPM_E_COMMAND_BLOCKED');
});

test('static: TPMA_NV — نوعٌ محجوزٌ وبتّاتٌ محجوزةٌ تُعلَنُ لا تُهمَل', () => {
  const x = decodeTpmaNv(0x000000f0); // TPM_NT = 0xF غيرُ معرَّف
  assert.equal(x.ntName, 'reserved-15');
  assert.equal(decodeTpmaNv(0x00000100).reservedBitsSet, true);
  assert.equal(decodeTpmaNv(0x02060012).reservedBitsSet, false);
});

test('static: NV_ReadPublic — مقطوع/مقبضٌ مختلف/خطأ TPM', () => {
  const inv = loadFixture();
  const q = qById(inv, 'nv-readpublic-01500016');
  const ok = decodeNvReadPublicResponse(Buffer.from(q.responseHex, 'hex'), 0x01500016);
  assert.equal(ok.ok, true);
  assert.equal(decodeNvReadPublicResponse(Buffer.from(q.responseHex, 'hex'), 0x01500017).error, 'NV_INDEX_MISMATCH');
  const cut = Buffer.from(q.responseHex, 'hex').subarray(0, 20);
  cut.writeUInt32BE(20, 2);
  assert.equal(decodeNvReadPublicResponse(cut).error, 'NV_PUBLIC_TRUNCATED');
  const err = Buffer.from('80010000000a0000018b', 'hex');
  assert.equal(decodeNvReadPublicResponse(err).error, 'TPM_ERROR');
});

test('static: خاصيّةٌ مجهولةٌ تُحفَظُ رقماً ولا تُسمّى', () => {
  assert.equal(propertyName(0x115), null); // فجوةٌ في PT_FIXED
  assert.equal(propertyName(0x116), 'TPM_PT_NV_COUNTERS_MAX');
  assert.equal(propertyName(0x20b), 'TPM_PT_NV_COUNTERS_AVAIL');
  const inv = loadFixture();
  const q = qById(inv, 'tpm-properties-var-p0');
  const b = Buffer.from(q.responseHex, 'hex');
  b.writeUInt32BE(0x2ff, 19); // أوّلُ خاصيّةٍ ⇒ مجهولة
  q.responseHex = b.toString('hex');
  const r = analyzeInventory(inv);
  assert.deepEqual(r.errors, []);
  assert.equal(r.unknownProperties[0].property, '0x000002ff');
});

test('static: الملفُّ الفاسدُ أو الناقصُ ⇒ أخطاءٌ، لا نجاحٌ صامت', () => {
  assert.deepEqual(analyzeInventory(null).errors, ['DOCUMENT_NOT_OBJECT']);
  assert.deepEqual(analyzeInventory({ schema: 'xuux.tpm-host-inventory/1', inventory: { error: 'core load failed' } }).errors, ['INVENTORY_ABSENT']);
  assert.ok(analyzeInventory({ schema: 'other/9', inventory: loadFixture() }).errors.some((e) => e.startsWith('SCHEMA_UNKNOWN')));

  const missingResp = loadFixture();
  qById(missingResp, 'commands-p1').responseHex = null;
  const r1 = analyzeInventory(missingResp);
  assert.equal(r1.capabilitiesComplete.commands, false);
  assert.equal(r1.commands.totalImplemented, null);
  assert.equal(r1.commands.implementedByTpm.TPM2_NV_Certify.implemented !== false, true, 'قائمةٌ ناقصةٌ لا تُثبِتُ الغياب');
  assert.ok(r1.errors.some((e) => e.includes('CAPABILITY_CLAIMED_COMPLETE_BUT_NOT: commands')));

  const dangling = loadFixture();
  dangling.capabilities.find((c) => c.name === 'algorithms').queryIds.push('nope');
  assert.ok(analyzeInventory(dangling).errors.includes('QUERY_ID_DANGLING: nope'));

  const corrupt = loadFixture();
  qById(corrupt, 'algorithms-p0').responseHex = 'zz';
  assert.ok(analyzeInventory(corrupt).errors.some((e) => e.startsWith('NO_RESPONSE') || e.startsWith('CAPABILITY_DECODE')));

  const absentRun = loadFixture();
  absentRun.capabilities = absentRun.capabilities.filter((c) => c.name !== 'ecc-curves');
  assert.ok(analyzeInventory(absentRun).errors.includes('CAPABILITY_RUN_ABSENT: ecc-curves'));
});

test('static: طلبٌ خارجَ قائمةِ السماحِ داخلَ الدليلِ يُكشَف', () => {
  const inv = loadFixture();
  // NV_DefineSpace بلا جلسات (شكلٌ غيرُ صالحٍ أصلاً، لكنّ الحارسَ يجبُ أن يرفضَه بالكود)
  inv.queries.push({ id: 'smuggled', command: 'X', requestHex: '80010000000e0000012a01500016', responseHex: null, transportCode: null, tpmResponseCode: null, error: null });
  const r = analyzeInventory(inv);
  assert.equal(r.requestsAllAllowlisted, false);
  assert.ok(r.errors.some((e) => e.startsWith('REQUEST_NOT_ALLOWLISTED: smuggled')));
});

test('static: مرآةُ الحارسِ في JS ترفضُ كلَّ كودِ أمرٍ غيرِ المسموحَين', () => {
  for (let cc = 0x11f; cc <= 0x1a0; cc++) {
    for (const len of [14, 22]) {
      const b = Buffer.alloc(len);
      b.writeUInt16BE(0x8001, 0);
      b.writeUInt32BE(len, 2);
      b.writeUInt32BE(cc, 6);
      if (len === 22) { b.writeUInt32BE(6, 10); b.writeUInt32BE(0x100, 14); b.writeUInt32BE(64, 18); }
      else b.writeUInt32BE(0x01500016, 10);
      const allowed = (cc === 0x17a && len === 22) || (cc === 0x169 && len === 14);
      assert.equal(checkAllowedCommand(b).ok, allowed, `cc=0x${cc.toString(16)} len=${len}`);
    }
  }
});

test('static: CLI — ملفٌّ غيرُ مقروء ⇒ 2، وملفٌّ سليم ⇒ 0', () => {
  const ok = spawnSync(process.execPath, [decoderPath, fixturePath], { encoding: 'utf8' });
  assert.equal(ok.status, 0, ok.stderr);
  assert.equal(JSON.parse(ok.stdout).evidenceClass, 'simulator-not-hardware');
  const missing = spawnSync(process.execPath, [decoderPath, '/nonexistent/xuux.json'], { encoding: 'utf8' });
  assert.equal(missing.status, 2);
  assert.match(missing.stderr, /INVENTORY_UNREADABLE/);
  const usage = spawnSync(process.execPath, [decoderPath], { encoding: 'utf8' });
  assert.equal(usage.status, 2);
});
