// @ts-nocheck
// sim/tpm-host/decode_inventory.mjs
//
// مُفسِّرُ ملفِّ جردِ TPM للمضيف (WL-410). يقرأُ ما أنتجَتْه `win_tpm_inventory.ps1` (أو حزامُ المحاكي)
// ويُعيدُ تفسيرَ كلِّ ردٍّ خامٍّ من بايتاتِه — لا يثقُ بأيِّ تفسيرٍ سابقٍ في الملف.
//
// قواعدُ الفشلِ المغلق:
//   - ما لا يُحلَّلُ يُعلَنُ خطأً مسمّىً ولا يُخمَّن؛ والقيمُ غيرُ المعروفةِ تُحفَظُ أرقاماً.
//   - أصلُ الدليلِ مُعلَنٌ: transport=tbs ⇒ «hardware-tbs»؛ وأيُّ شيءٍ آخرَ ⇒ ليس دليلَ عتاد.
//   - الحدُّ الأقصى النظريُّ ليس سعةً حرّة؛ وصفرُ NV_COUNTERS_MAX يُفسَّرُ بحسبِ مستوى
//     المواصفةِ الذي تعلنُه الشريحةُ (المراجعةُ وتاريخُ الإراتا): NOTE 2 في Part 2 r1.59 فأحدث،
//     وغائبةٌ عن النصِّ الأصليِّ لـr1.38 — وإراتا r1.38 (البندُ 2.22، من v1.8 بتاريخِ 2019-07-12
//     فأحدث) تضيفُها، والشريحةُ تعلنُ تاريخَ إراتاها في TPM_PT_YEAR/TPM_PT_DAY_OF_YEAR (LIVE-58).
//   - قائمةُ TPM_CAP_COMMANDS هي ما تُنفِّذُه الشريحة، لا قائمةُ سماحِ TBS.
//
// الاستعمال: node sim/tpm-host/decode_inventory.mjs <inventory.json>

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const TPM_ST_NO_SESSIONS = 0x8001;
export const TPM_CC_GetCapability = 0x17a;
export const TPM_CC_NV_ReadPublic = 0x169;
export const ALLOWED_CAPABILITIES = Object.freeze([0x0, 0x1, 0x2, 0x6, 0x8]);

/** مرآةُ TpmGuard.AssertAllowedCommand — تُستعمَلُ للتحقّقِ من أنّ كلَّ طلبٍ في الدليلِ مسموحٌ. */
export function checkAllowedCommand(bytes) {
  const b = toBuf(bytes);
  if (!b) return { ok: false, reason: 'null command' };
  if (b.length < 10) return { ok: false, reason: 'shorter than a TPM header' };
  const tag = b.readUInt16BE(0);
  const size = b.readUInt32BE(2);
  const cc = b.readUInt32BE(6);
  if (tag !== TPM_ST_NO_SESSIONS) return { ok: false, reason: 'tag must be TPM_ST_NO_SESSIONS' };
  if (size !== b.length) return { ok: false, reason: 'declared size does not equal buffer length' };
  if (cc === TPM_CC_GetCapability) {
    if (b.length !== 22) return { ok: false, reason: 'GetCapability must be exactly 22 bytes' };
    const cap = b.readUInt32BE(10);
    const prop = b.readUInt32BE(14);
    const count = b.readUInt32BE(18);
    if (!ALLOWED_CAPABILITIES.includes(cap)) return { ok: false, reason: 'capability not on the allowlist' };
    if (count < 1 || count > 256) return { ok: false, reason: 'propertyCount out of range' };
    if (cap === 0x1 && prop >>> 24 !== 0x01) return { ok: false, reason: 'handle enumeration is limited to the NV index range' };
    return { ok: true, command: 'GetCapability', capability: cap, property: prop, count };
  }
  if (cc === TPM_CC_NV_ReadPublic) {
    if (b.length !== 14) return { ok: false, reason: 'NV_ReadPublic must be exactly 14 bytes' };
    const h = b.readUInt32BE(10);
    if (h >>> 24 !== 0x01) return { ok: false, reason: 'NV_ReadPublic handle outside the NV index range' };
    return { ok: true, command: 'NV_ReadPublic', handle: h };
  }
  return { ok: false, reason: 'command code not on the allowlist: ' + hex32(cc) };
}

// ── أسماءُ الخصائص (TPM 2.0 Part 2 §6.13: PT_FIXED = 0x100، PT_VAR = 0x200) ──
const PT_FIXED_NAMES = [
  'FAMILY_INDICATOR', 'LEVEL', 'REVISION', 'DAY_OF_YEAR', 'YEAR', 'MANUFACTURER',
  'VENDOR_STRING_1', 'VENDOR_STRING_2', 'VENDOR_STRING_3', 'VENDOR_STRING_4', 'VENDOR_TPM_TYPE',
  'FIRMWARE_VERSION_1', 'FIRMWARE_VERSION_2', 'INPUT_BUFFER', 'HR_TRANSIENT_MIN', 'HR_PERSISTENT_MIN',
  'HR_LOADED_MIN', 'ACTIVE_SESSIONS_MAX', 'PCR_COUNT', 'PCR_SELECT_MIN', 'CONTEXT_GAP_MAX', null,
  'NV_COUNTERS_MAX', 'NV_INDEX_MAX', 'MEMORY', 'CLOCK_UPDATE', 'CONTEXT_HASH', 'CONTEXT_SYM',
  'CONTEXT_SYM_SIZE', 'ORDERLY_COUNT', 'MAX_COMMAND_SIZE', 'MAX_RESPONSE_SIZE', 'MAX_DIGEST',
  'MAX_OBJECT_CONTEXT', 'MAX_SESSION_CONTEXT', 'PS_FAMILY_INDICATOR', 'PS_LEVEL', 'PS_REVISION',
  'PS_DAY_OF_YEAR', 'PS_YEAR', 'SPLIT_MAX', 'TOTAL_COMMANDS', 'LIBRARY_COMMANDS', 'VENDOR_COMMANDS',
  'NV_BUFFER_MAX', 'MODES', 'MAX_CAP_BUFFER',
];
const PT_VAR_NAMES = [
  'PERMANENT', 'STARTUP_CLEAR', 'HR_NV_INDEX', 'HR_LOADED', 'HR_LOADED_AVAIL', 'HR_ACTIVE',
  'HR_ACTIVE_AVAIL', 'HR_TRANSIENT_AVAIL', 'HR_PERSISTENT', 'HR_PERSISTENT_AVAIL', 'NV_COUNTERS',
  'NV_COUNTERS_AVAIL', 'ALGORITHM_SET', 'LOADED_CURVES', 'LOCKOUT_COUNTER', 'MAX_AUTH_FAIL',
  'LOCKOUT_INTERVAL', 'LOCKOUT_RECOVERY', 'NV_WRITE_RECOVERY', 'AUDIT_COUNTER_0', 'AUDIT_COUNTER_1',
];

export function propertyName(pt) {
  if (pt >= 0x100 && pt < 0x100 + PT_FIXED_NAMES.length && PT_FIXED_NAMES[pt - 0x100]) {
    return 'TPM_PT_' + PT_FIXED_NAMES[pt - 0x100];
  }
  if (pt >= 0x200 && pt < 0x200 + PT_VAR_NAMES.length) return 'TPM_PT_' + PT_VAR_NAMES[pt - 0x200];
  return null;
}

// ── أكوادُ الأوامرِ ذاتُ الصلةِ بالمرساة (Part 2 TPM_CC) ──
export const RELEVANT_COMMANDS = Object.freeze({
  0x12a: 'TPM2_NV_DefineSpace',
  0x122: 'TPM2_NV_UndefineSpace',
  0x134: 'TPM2_NV_Increment',
  0x14e: 'TPM2_NV_Read',
  0x169: 'TPM2_NV_ReadPublic',
  0x184: 'TPM2_NV_Certify',
  0x17a: 'TPM2_GetCapability',
  0x160: 'TPM2_PolicySigned',
  0x16c: 'TPM2_PolicyCommandCode',
  0x176: 'TPM2_StartAuthSession',
  0x153: 'TPM2_Create',
  0x131: 'TPM2_CreatePrimary',
  0x157: 'TPM2_Load',
  0x165: 'TPM2_FlushContext',
});

const NT_NAMES = { 0x0: 'ORDINARY', 0x1: 'COUNTER', 0x2: 'BITS', 0x4: 'EXTEND', 0x8: 'PIN_FAIL', 0x9: 'PIN_PASS' };
const TPMA_NV_BITS = [
  [0, 'PPWRITE'], [1, 'OWNERWRITE'], [2, 'AUTHWRITE'], [3, 'POLICYWRITE'], [10, 'POLICY_DELETE'],
  [11, 'WRITELOCKED'], [12, 'WRITEALL'], [13, 'WRITEDEFINE'], [14, 'WRITE_STCLEAR'], [15, 'GLOBALLOCK'],
  [16, 'PPREAD'], [17, 'OWNERREAD'], [18, 'AUTHREAD'], [19, 'POLICYREAD'], [25, 'NO_DA'], [26, 'ORDERLY'],
  [27, 'CLEAR_STCLEAR'], [28, 'READLOCKED'], [29, 'WRITTEN'], [30, 'PLATFORMCREATE'], [31, 'READ_STCLEAR'],
];
const TPMA_NV_RESERVED_MASK = 0x00000300 | 0x01f00000;
const ALG_NAMES = { 0x4: 'SHA1', 0xb: 'SHA256', 0xc: 'SHA384', 0xd: 'SHA512', 0x12: 'SM3_256', 0x10: 'NULL', 0x1: 'RSA', 0x23: 'ECC', 0x18: 'ECDSA', 0x6: 'AES', 0x5: 'HMAC' };
const ECC_NAMES = { 0x1: 'NIST_P192', 0x2: 'NIST_P224', 0x3: 'NIST_P256', 0x4: 'NIST_P384', 0x5: 'NIST_P521', 0x10: 'BN_P256', 0x11: 'BN_P638', 0x20: 'SM2_P256' };

// TBS / Windows (Microsoft Learn: Tbsi_Context_Create، Tbsip_Submit_Command، COM Error Codes TPM).
export const WINDOWS_CODES = Object.freeze({
  0x80280400: 'TPM_E_COMMAND_BLOCKED',
  0x80284001: 'TBS_E_INTERNAL_ERROR',
  0x80284002: 'TBS_E_BAD_PARAMETER',
  0x80284003: 'TBS_E_INVALID_OUTPUT_POINTER',
  0x80284004: 'TBS_E_INVALID_CONTEXT',
  0x80284005: 'TBS_E_INSUFFICIENT_BUFFER',
  0x80284006: 'TBS_E_IOERROR',
  0x80284007: 'TBS_E_INVALID_CONTEXT_PARAM',
  0x80284008: 'TBS_E_SERVICE_NOT_RUNNING',
  0x80284009: 'TBS_E_TOO_MANY_TBS_CONTEXTS',
  0x8028400b: 'TBS_E_SERVICE_START_PENDING',
  0x8028400e: 'TBS_E_BUFFER_TOO_LARGE',
  0x8028400f: 'TBS_E_TPM_NOT_FOUND',
  0x80284010: 'TBS_E_SERVICE_DISABLED',
});

/** تصنيفُ رمزِ ردٍّ: نجاحٌ، أو رمزُ Windows، أو صيغةُ TPM 2.0 (0/1). لا يُسقِطُ المجهول. */
export function classifyResponseCode(rc) {
  if (rc === null || rc === undefined) return { kind: 'absent' };
  const v = rc >>> 0;
  if (v === 0) return { kind: 'success', raw: hex32(v) };
  if (((v & 0xffff0000) >>> 0) === 0x80280000) {
    return { kind: 'windows', raw: hex32(v), name: WINDOWS_CODES[v] ?? 'unknown-windows-code' };
  }
  if (v & 0x80) {
    const n = (v >>> 8) & 0xf;
    const where = v & 0x40 ? 'parameter' : (n & 0x8 ? 'session' : 'handle');
    return { kind: 'tpm2-format1', raw: hex32(v), error: hex32(v & 0xbf), where, number: v & 0x40 ? n : n & 0x7 };
  }
  if (v & 0x100) return { kind: 'tpm2-format0', raw: hex32(v), error: hex32(v & 0x97f), warning: Boolean(v & 0x800) };
  return { kind: 'tpm1.2-or-unknown', raw: hex32(v) };
}

/** رأسُ الرد: tag/size/rc، ويُرفَضُ تعارضُ الطول. */
export function decodeResponseHeader(bytes) {
  const b = toBuf(bytes);
  if (!b) return { ok: false, error: 'RESPONSE_ABSENT' };
  if (b.length < 10) return { ok: false, error: 'RESPONSE_TRUNCATED_HEADER' };
  const tag = b.readUInt16BE(0);
  const size = b.readUInt32BE(2);
  const rc = b.readUInt32BE(6);
  if (size !== b.length) return { ok: false, error: 'RESPONSE_SIZE_MISMATCH', tag, size, length: b.length, rc };
  if (tag !== 0x8001 && tag !== 0x8002 && tag !== 0x00c4) return { ok: false, error: 'RESPONSE_TAG_UNEXPECTED', tag, rc };
  return { ok: true, tag, size, rc };
}

const ITEM_SIZE = { 0x0: 6, 0x1: 4, 0x2: 4, 0x6: 8, 0x8: 2 };

/** يفسّرُ ردَّ GetCapability حرفيّاً. أيُّ عدمِ اتّساقٍ ⇒ خطأٌ مسمّى. */
export function decodeGetCapabilityResponse(bytes, expectedCapability, requestedCount) {
  const h = decodeResponseHeader(bytes);
  if (!h.ok) return h;
  if (h.rc !== 0) return { ok: false, error: 'TPM_ERROR', rc: h.rc, code: classifyResponseCode(h.rc) };
  if (h.tag !== 0x8001) return { ok: false, error: 'RESPONSE_TAG_UNEXPECTED', tag: h.tag };
  const b = toBuf(bytes);
  if (b.length < 19) return { ok: false, error: 'CAPABILITY_TRUNCATED' };
  const moreData = b[10];
  if (moreData > 1) return { ok: false, error: 'MORE_DATA_NOT_YES_NO', value: moreData };
  const capability = b.readUInt32BE(11);
  if (expectedCapability !== undefined && capability !== expectedCapability) {
    return { ok: false, error: 'CAPABILITY_SELECTOR_MISMATCH', capability };
  }
  const itemSize = ITEM_SIZE[capability];
  if (!itemSize) return { ok: false, error: 'CAPABILITY_UNSUPPORTED_BY_DECODER', capability };
  const count = b.readUInt32BE(15);
  if (requestedCount !== undefined && count > requestedCount) return { ok: false, error: 'COUNT_EXCEEDS_REQUEST', count };
  if (b.length !== 19 + count * itemSize) return { ok: false, error: 'LIST_LENGTH_INCONSISTENT', count, length: b.length };
  const items = [];
  for (let i = 0; i < count; i++) {
    const o = 19 + i * itemSize;
    if (capability === 0x6) items.push({ property: b.readUInt32BE(o), value: b.readUInt32BE(o + 4) });
    else if (capability === 0x1) items.push(b.readUInt32BE(o));
    else if (capability === 0x2) items.push(b.readUInt32BE(o));
    else if (capability === 0x0) items.push({ alg: b.readUInt16BE(o), attributes: b.readUInt32BE(o + 2) });
    else items.push(b.readUInt16BE(o));
  }
  return { ok: true, moreData: moreData === 1, capability, count, items };
}

/** TPMA_CC (Part 2): commandIndex 15:0، nv 22، extensive 23، flushed 24، cHandles 27:25، rHandle 28، V 29. */
export function decodeTpmaCc(v) {
  const x = v >>> 0;
  const vendor = Boolean(x & (1 << 29));
  return {
    commandCode: vendor ? ((0x20000000 | (x & 0xffff)) >>> 0) : x & 0xffff,
    commandIndex: x & 0xffff,
    nv: Boolean(x & (1 << 22)),
    extensive: Boolean(x & (1 << 23)),
    flushed: Boolean(x & (1 << 24)),
    cHandles: (x >>> 25) & 0x7,
    rHandle: Boolean(x & (1 << 28)),
    vendor,
    reservedBitsSet: (x & 0xc03f0000) !== 0,
  };
}

/** TPMA_NV (Part 2 r1.38 Table 204). البتّاتُ المحجوزةُ المضبوطةُ تُعلَنُ ولا تُهمَل. */
export function decodeTpmaNv(v) {
  const x = v >>> 0;
  const nt = (x >>> 4) & 0xf;
  const set = TPMA_NV_BITS.filter(([bit]) => (x >>> bit) & 1).map(([, n]) => n);
  return {
    raw: hex32(x),
    nt,
    ntName: NT_NAMES[nt] ?? 'reserved-' + nt,
    set,
    reservedBitsSet: (x & TPMA_NV_RESERVED_MASK) !== 0,
  };
}

/** ردُّ NV_ReadPublic: TPM2B_NV_PUBLIC ثمّ TPM2B_NAME (tag=NO_SESSIONS ⇒ لا parameterSize). */
export function decodeNvReadPublicResponse(bytes, expectedHandle) {
  const h = decodeResponseHeader(bytes);
  if (!h.ok) return h;
  if (h.rc !== 0) return { ok: false, error: 'TPM_ERROR', rc: h.rc, code: classifyResponseCode(h.rc) };
  if (h.tag !== 0x8001) return { ok: false, error: 'RESPONSE_TAG_UNEXPECTED', tag: h.tag };
  const b = toBuf(bytes);
  let o = 10;
  if (b.length < o + 2) return { ok: false, error: 'NV_PUBLIC_TRUNCATED' };
  const pubSize = b.readUInt16BE(o); o += 2;
  if (b.length < o + pubSize) return { ok: false, error: 'NV_PUBLIC_TRUNCATED' };
  const pubEnd = o + pubSize;
  if (pubSize < 4 + 2 + 4 + 2 + 2) return { ok: false, error: 'NV_PUBLIC_TOO_SHORT' };
  const nvIndex = b.readUInt32BE(o); o += 4;
  const nameAlg = b.readUInt16BE(o); o += 2;
  const attributes = b.readUInt32BE(o); o += 4;
  const policySize = b.readUInt16BE(o); o += 2;
  if (o + policySize + 2 !== pubEnd) return { ok: false, error: 'NV_PUBLIC_LAYOUT_INCONSISTENT' };
  const authPolicy = b.subarray(o, o + policySize).toString('hex'); o += policySize;
  const dataSize = b.readUInt16BE(o); o += 2;
  if (b.length < o + 2) return { ok: false, error: 'NV_NAME_TRUNCATED' };
  const nameSize = b.readUInt16BE(o); o += 2;
  if (o + nameSize !== b.length) return { ok: false, error: 'NV_NAME_LENGTH_INCONSISTENT' };
  const name = b.subarray(o, o + nameSize).toString('hex');
  if (expectedHandle !== undefined && nvIndex !== expectedHandle) return { ok: false, error: 'NV_INDEX_MISMATCH', nvIndex };
  return {
    ok: true,
    nvIndex: hex32(nvIndex),
    nameAlg: hex16(nameAlg),
    nameAlgName: ALG_NAMES[nameAlg] ?? null,
    attributes: decodeTpmaNv(attributes),
    authPolicyHex: authPolicy,
    dataSize,
    name,
  };
}

// مجالُ فهارسِ المالكِ (سجلُّ TCG للمقابضِ المحفوظةِ v1p6؛ ADR 0007 §4.1).
export const OWNER_INDEX_RANGE = Object.freeze({ first: 0x01800000, last: 0x01bfffff });

// أوّلُ إصدارِ إراتا لـr1.38 تحقّقنا أنّه يحوي البندَ 2.22 (كما في `sim/tpm/getcap.mjs`، WL-439):
// Errata v1.8، بتاريخ 2019-07-12 (اليوم 193). وإراتا v1.0 (2017-01-16) لا تحويه، وما بينهما
// (v1.1/v1.3/v1.4) لم يُتحقَّقْ منه فتاريخٌ أقدمُ من v1.8 لا يُثبِتُ الدلالةَ (تحفّظٌ لا نفي).
const R138_ERRATA_2_22_FIRST_CONFIRMED = { year: 2019, dayOfYear: 193 };

/**
 * تفسيرُ NV_COUNTERS_MAX بحسبِ مستوى المواصفةِ الذي تعلنه الشريحةُ: المراجعةُ وتاريخُ الإراتا —
 * بالتسمياتِ نفسِها التي في `sim/tpm/getcap.mjs` (WL-439، إغلاقُ LIVE-58).
 * r1.59 Part 2 NOTE 2: «The value zero indicates that there is no fixed maximum».
 * النصُّ الأصليُّ لـr1.38 لا يحملُ هذه الملاحظة؛ وإراتاه (البندُ 2.22) تضيفُها — مؤكَّدةٌ في
 * v1.8 بتاريخِ 2019-07-12 (اليوم 193) فأحدث، وغائبةٌ عن v1.0 (2017-01-16) — والشريحةُ تعلنُ
 * تاريخَ آخرِ إراتا تطبّقُها في TPM_PT_YEAR/TPM_PT_DAY_OF_YEAR (Errata §2.24).
 * @param {number} value قيمة TPM_PT_NV_COUNTERS_MAX (رقمٌ من الجردِ المفكوكِ، لا نصٌّ)
 * @param {number|null} [revisionTimes100] TPM_PT_REVISION (المراجعة × 100) أو null/undefined
 * @param {{year?: number|null, dayOfYear?: number|null}|null|undefined} [specDate] TPM_PT_YEAR وTPM_PT_DAY_OF_YEAR أو null
 * @returns {{ok: true, value: number, revisionTimes100: number|null, specDate: {year: number, dayOfYear: number}|null,
 *   supportProven: false, supportProofRequires: 'counter-creation', basis: string,
 *   semantics: 'no-fixed-maximum'|'fixed-maximum'|'zero-meaning-not-established'}|{ok: false, error: string}}
 * التاريخُ المعطىُ غيرُ القابلِ للتحليلِ ⇒ فشلٌ مغلقٌ لا تخمين؛ والغائبُ ⇒ لا إراتا تُفترض.
 */
export function interpretNvCountersMax(value, revisionTimes100, specDate) {
  if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) return { ok: false, error: 'NV_COUNTERS_MAX_UNKNOWN' };
  let revision = null;
  if (revisionTimes100 !== undefined && revisionTimes100 !== null) {
    // مراجعةٌ فوقَ مدى UINT32 غيرُ قابلةٍ للتحليلِ ⇒ مجهولةٌ لا مقبولة (كما في `sim/tpm/getcap.mjs`، WL-439).
    if (!Number.isInteger(revisionTimes100) || revisionTimes100 <= 0 || revisionTimes100 > 0xffffffff) {
      return { ok: false, error: 'TPM_PT_REVISION_UNKNOWN' };
    }
    revision = revisionTimes100;
  }
  let date = null;
  if (specDate !== undefined && specDate !== null) {
    const year = specDate.year;
    const day = specDate.dayOfYear;
    // سنةٌ فوقَ مدى UINT32 غيرُ قابلةٍ للتحليلِ ⇒ فشلٌ مغلقٌ لا تخمين (كما في `parseRawInteger` هناك).
    if (!Number.isInteger(year) || !Number.isInteger(day) || year < 2013 || year > 0xffffffff || day < 1 || day > 366) {
      return { ok: false, error: 'TPM_PT_SPEC_DATE_UNKNOWN' };
    }
    date = { year, dayOfYear: day };
  }
  const base = {
    ok: true,
    value,
    revisionTimes100: revision,
    specDate: date,
    supportProven: /** @type {false} */ (false),
    supportProofRequires: /** @type {'counter-creation'} */ ('counter-creation'),
  };
  if (value > 0) return { ...base, semantics: 'fixed-maximum', basis: 'nonzero-value', note: 'upper bound on counter indexes, not free capacity' };
  if (revision !== null && revision >= 159) {
    return { ...base, semantics: 'no-fixed-maximum', basis: 'part2-r1.59+-note2', note: 'Part 2 r1.59 NOTE 2: bounded by the NV memory pool' };
  }
  if (revision === 138 && date !== null && dateAtLeast(date, R138_ERRATA_2_22_FIRST_CONFIRMED)) {
    return { ...base, semantics: 'no-fixed-maximum', basis: 'r1.38-errata-2.22', note: 'r1.38 errata 2.22 (v1.8+, 2019-07-12): bounded by the NV memory pool' };
  }
  return {
    ...base,
    semantics: 'zero-meaning-not-established',
    basis: 'no-normative-text-established-for-reported-level',
    note: 'original r1.38 text has no NOTE 2; zero does not mean unsupported and does not prove unlimited — the datasheet bound applies',
  };
}

/** @param {{year: number, dayOfYear: number}} a @param {{year: number, dayOfYear: number}} b */
function dateAtLeast(a, b) {
  return a.year > b.year || (a.year === b.year && a.dayOfYear >= b.dayOfYear);
}

/** يحلّلُ ملفَّ جردٍ كاملٍ ويُعيدُ تقريراً. لا يرمي على مدخلٍ فاسد: يُعيدُ أخطاءً مسمّاة. */
export function analyzeInventory(doc) {
  const errors = [];
  const report = {
    schemaOk: false,
    evidenceClass: 'unknown',
    exit: null,
    status: null,
    tool: null,
    host: null,
    getTpm: null,
    tbs: null,
    requestsAllAllowlisted: null,
    queries: [],
    capabilitiesComplete: {},
    properties: {},
    unknownProperties: [],
    tpm: {},
    nv: {},
    nvIndexes: [],
    commands: { implementedByTpm: {}, totalImplemented: null, vendorCommands: 0, note: 'implemented by the TPM per TPM_CAP_COMMANDS — NOT the Windows TBS allow list' },
    tbsObserved: {},
    algorithms: [],
    eccCurves: [],
    unproven: [],
    errors,
  };
  if (!doc || typeof doc !== 'object') {
    errors.push('DOCUMENT_NOT_OBJECT');
    return report;
  }
  const inv = doc.inventory && typeof doc.inventory === 'object' && Array.isArray(doc.inventory.queries) ? doc.inventory : (Array.isArray(doc.queries) ? doc : null);
  if (doc.schema !== undefined && doc.schema !== 'xuux.tpm-host-inventory/1') errors.push('SCHEMA_UNKNOWN: ' + String(doc.schema));
  report.exit = doc.exitCode ?? null;
  report.status = doc.status ?? null;
  report.tool = doc.tool ?? null;
  report.host = doc.host ?? null;
  report.getTpm = doc.getTpm ?? null;
  report.tbs = doc.tbs ?? null;
  if (!inv) {
    errors.push('INVENTORY_ABSENT');
    return report;
  }
  report.schemaOk = errors.length === 0;
  report.evidenceClass = inv.transport === 'tbs' ? 'hardware-tbs' : (typeof inv.transport === 'string' && inv.transport.startsWith('simulator') ? 'simulator-not-hardware' : 'unknown-transport');

  const byId = new Map();
  let allAllowed = true;
  for (const q of inv.queries) {
    if (!q || typeof q.id !== 'string') { errors.push('QUERY_MALFORMED'); allAllowed = false; continue; }
    byId.set(q.id, q);
    const req = hexToBuf(q.requestHex);
    const allow = checkAllowedCommand(req);
    if (!allow.ok) { allAllowed = false; errors.push('REQUEST_NOT_ALLOWLISTED: ' + q.id + ' — ' + allow.reason); }
    const transport = parseHexCode(q.transportCode);
    const hdr = q.responseHex ? decodeResponseHeader(hexToBuf(q.responseHex)) : { ok: false, error: 'RESPONSE_ABSENT' };
    report.queries.push({
      id: q.id,
      command: allow.ok ? allow.command : null,
      transport: classifyResponseCode(transport),
      tpm: hdr.ok ? classifyResponseCode(hdr.rc) : { kind: 'absent', error: hdr.error },
      error: q.error ?? null,
    });
  }
  report.requestsAllAllowlisted = allAllowed;

  const caps = Array.isArray(inv.capabilities) ? inv.capabilities : [];
  const decodeRun = (name) => {
    const run = caps.find((c) => c && c.name === name);
    if (!run) { errors.push('CAPABILITY_RUN_ABSENT: ' + name); report.capabilitiesComplete[name] = false; return []; }
    const items = [];
    let complete = true;
    let sawEnd = false;
    for (const id of run.queryIds ?? []) {
      const q = byId.get(id);
      if (!q) { errors.push('QUERY_ID_DANGLING: ' + id); complete = false; break; }
      const req = checkAllowedCommand(hexToBuf(q.requestHex));
      if (!req.ok || req.command !== 'GetCapability') { complete = false; break; }
      if (!q.responseHex) { complete = false; errors.push('NO_RESPONSE: ' + id + (q.error ? ' — ' + q.error : '')); break; }
      const d = decodeGetCapabilityResponse(hexToBuf(q.responseHex), req.capability, req.count);
      if (!d.ok) { complete = false; errors.push('CAPABILITY_DECODE: ' + id + ' — ' + d.error + (d.code ? ' ' + JSON.stringify(d.code) : '')); break; }
      items.push(...d.items);
      if (!d.moreData) sawEnd = true;
    }
    // الاكتمالُ يُعادُ حسابُه: إمّا moreData=NO، أو خروجُ مقابضِ NV من مجالِها (ما تفعلُه النواة).
    if (!sawEnd && name === 'nv-index-handles' && items.some((h) => h >>> 24 !== 0x01)) sawEnd = true;
    const ok = complete && sawEnd && run.complete === true;
    if (run.complete === true && !(complete && sawEnd)) errors.push('CAPABILITY_CLAIMED_COMPLETE_BUT_NOT: ' + name);
    report.capabilitiesComplete[name] = ok;
    return items;
  };

  // الخصائص
  const props = [...decodeRun('tpm-properties-fixed'), ...decodeRun('tpm-properties-var')];
  for (const p of props) {
    const n = propertyName(p.property);
    if (!n) { report.unknownProperties.push({ property: hex32(p.property), value: p.value >>> 0 }); continue; }
    if (report.properties[n] === undefined) report.properties[n] = p.value >>> 0;
  }
  const P = report.properties;
  const ascii = (v) => (v === undefined ? null : Buffer.from([(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255]).toString('latin1').replace(/\0+$/, ''));
  report.tpm = {
    manufacturer: ascii(P.TPM_PT_MANUFACTURER),
    vendorString: [P.TPM_PT_VENDOR_STRING_1, P.TPM_PT_VENDOR_STRING_2, P.TPM_PT_VENDOR_STRING_3, P.TPM_PT_VENDOR_STRING_4].map(ascii).filter((s) => s !== null).join('') || null,
    familyIndicator: ascii(P.TPM_PT_FAMILY_INDICATOR),
    specLevel: P.TPM_PT_LEVEL ?? null,
    specRevisionTimes100: P.TPM_PT_REVISION ?? null,
    specYear: P.TPM_PT_YEAR ?? null,
    specDayOfYear: P.TPM_PT_DAY_OF_YEAR ?? null,
    firmware: P.TPM_PT_FIRMWARE_VERSION_1 === undefined ? null : {
      v1: hex32(P.TPM_PT_FIRMWARE_VERSION_1),
      v2: P.TPM_PT_FIRMWARE_VERSION_2 === undefined ? null : hex32(P.TPM_PT_FIRMWARE_VERSION_2),
      // اصطلاحُ عرضٍ شائعٌ (16.16.16.16) — تفسيرُ البائعِ غيرُ مضمونٍ بالمواصفة.
      dotted: [P.TPM_PT_FIRMWARE_VERSION_1 >>> 16, P.TPM_PT_FIRMWARE_VERSION_1 & 0xffff, (P.TPM_PT_FIRMWARE_VERSION_2 ?? 0) >>> 16, (P.TPM_PT_FIRMWARE_VERSION_2 ?? 0) & 0xffff].join('.'),
    },
    psFamily: P.TPM_PT_PS_FAMILY_INDICATOR ?? null,
    psLevel: P.TPM_PT_PS_LEVEL ?? null,
    psRevision: P.TPM_PT_PS_REVISION ?? null,
  };
  const mem = P.TPM_PT_MEMORY;
  report.nv = {
    nvCountersMax: P.TPM_PT_NV_COUNTERS_MAX === undefined ? { ok: false, error: 'ABSENT' } : interpretNvCountersMax(
      P.TPM_PT_NV_COUNTERS_MAX,
      P.TPM_PT_REVISION,
      P.TPM_PT_YEAR !== undefined || P.TPM_PT_DAY_OF_YEAR !== undefined ? { year: P.TPM_PT_YEAR, dayOfYear: P.TPM_PT_DAY_OF_YEAR } : null,
    ),
    nvCountersDefined: P.TPM_PT_NV_COUNTERS ?? null,
    nvCountersAvailOrderly: P.TPM_PT_NV_COUNTERS_AVAIL ?? null,
    nvCountersAvailNote: 'TPM_PT_NV_COUNTERS_AVAIL counts additional counters with TPMA_NV_ORDERLY SET and is an estimate; ADR 0007 §4.1 requires ORDERLY=0, so this is not a measure for the anchor',
    nvIndexesDefined: P.TPM_PT_HR_NV_INDEX ?? null,
    nvIndexMaxDataSize: P.TPM_PT_NV_INDEX_MAX ?? null,
    nvBufferMax: P.TPM_PT_NV_BUFFER_MAX ?? null,
    persistentAvailEstimate: P.TPM_PT_HR_PERSISTENT_AVAIL ?? null,
    memory: mem === undefined ? null : { raw: hex32(mem), sharedRAM: Boolean(mem & 1), sharedNV: Boolean(mem & 2), objectCopiedToRam: Boolean(mem & 4) },
    freeNvBytes: null,
    freeNvBytesNote: 'TPM 2.0 GetCapability exposes no free-NV-bytes property; free capacity is unmeasured by any read-only query',
  };

  // المقابضُ وفهارسُ NV
  const handles = decodeRun('nv-index-handles').filter((h) => h >>> 24 === 0x01);
  report.nv.handleCount = handles.length;
  if (P.TPM_PT_HR_NV_INDEX !== undefined && report.capabilitiesComplete['nv-index-handles'] && handles.length !== P.TPM_PT_HR_NV_INDEX) {
    errors.push('HANDLE_COUNT_DISAGREES_WITH_TPM_PT_HR_NV_INDEX');
  }
  let counters = 0;
  for (const h of handles) {
    const id = 'nv-readpublic-' + h.toString(16).padStart(8, '0');
    const q = byId.get(id);
    const entry = { handle: hex32(h), inOwnerRange: h >= OWNER_INDEX_RANGE.first && h <= OWNER_INDEX_RANGE.last };
    if (!q) { entry.error = 'NOT_QUERIED'; report.nvIndexes.push(entry); continue; }
    if (!q.responseHex) { entry.error = 'NO_RESPONSE' + (q.error ? ': ' + q.error : ''); report.nvIndexes.push(entry); continue; }
    const d = decodeNvReadPublicResponse(hexToBuf(q.responseHex), h);
    if (!d.ok) { entry.error = d.error; if (d.code) entry.code = d.code; report.nvIndexes.push(entry); continue; }
    Object.assign(entry, d);
    if (d.attributes.nt === 0x1) counters++;
    report.nvIndexes.push(entry);
  }
  report.nv.counterIndexesSeen = counters;
  report.nv.ownerRangeInUse = report.nvIndexes.filter((e) => e.inOwnerRange).map((e) => e.handle);

  // الأوامرُ المنفَّذةُ في الشريحة
  const cmds = decodeRun('commands').map(decodeTpmaCc);
  if (report.capabilitiesComplete.commands) report.commands.totalImplemented = cmds.length;
  report.commands.vendorCommands = cmds.filter((c) => c.vendor).length;
  for (const [cc, n] of Object.entries(RELEVANT_COMMANDS)) {
    const found = cmds.find((c) => !c.vendor && c.commandIndex === Number(cc));
    report.commands.implementedByTpm[n] = found ? { implemented: true, nv: found.nv, cHandles: found.cHandles } : (report.capabilitiesComplete.commands ? { implemented: false } : { implemented: 'unknown-incomplete-list' });
  }

  // ما رصدناهُ فعلاً عبرَ الطبقة (لا أكثر)
  const observed = (pred) => {
    const qs = report.queries.filter(pred);
    if (qs.length === 0) return 'not-sent';
    return qs.every((q) => q.transport.kind === 'success' && q.tpm.kind === 'success') ? 'all-succeeded' : 'some-failed';
  };
  report.tbsObserved = {
    'TPM2_GetCapability': observed((q) => q.command === 'GetCapability'),
    'TPM2_NV_ReadPublic': observed((q) => q.command === 'NV_ReadPublic'),
    'TPM2_NV_DefineSpace': 'not-sent-by-design',
    'TPM2_NV_Increment': 'not-sent-by-design',
    'TPM2_NV_Certify': 'not-sent-by-design',
    blockedResponses: report.queries.filter((q) => q.tpm.name === 'TPM_E_COMMAND_BLOCKED').map((q) => q.id),
  };

  report.algorithms = decodeRun('algorithms').map((a) => ({ alg: hex16(a.alg), name: ALG_NAMES[a.alg] ?? null, attributes: hex32(a.attributes) }));
  report.eccCurves = decodeRun('ecc-curves').map((c) => ({ curve: hex16(c), name: ECC_NAMES[c] ?? null }));

  report.unproven = [
    'Whether TBS (for the future service account) allows TPM2_NV_DefineSpace / TPM2_NV_Increment / TPM2_NV_Certify — never sent.',
    'Free NV bytes and whether a new 8-byte counter index (ORDERLY=0) can be allocated — only a define attempt proves it.',
    'Counter monotonicity across undefine/redefine on this chip — requires state-changing commands.',
    'Storage-hierarchy authorization availability to the owner ceremony (Get-Tpm fields are status, not proof of usable auth).',
    'Windows<->WSL2 production channel properties — out of scope of this inventory.',
  ];
  return report;
}

// ── أدوات ──
export function hex32(v) { return '0x' + (v >>> 0).toString(16).padStart(8, '0'); }
function hex16(v) { return '0x' + (v & 0xffff).toString(16).padStart(4, '0'); }
function toBuf(x) {
  if (x === null || x === undefined) return null;
  if (Buffer.isBuffer(x)) return x;
  if (x instanceof Uint8Array) return Buffer.from(x);
  return null;
}
export function hexToBuf(h) {
  if (typeof h !== 'string' || h.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(h)) return null;
  return Buffer.from(h, 'hex');
}
function parseHexCode(s) {
  if (s === null || s === undefined) return null;
  if (typeof s === 'number') return s;
  if (typeof s !== 'string' || !/^0x[0-9a-f]{1,8}$/i.test(s)) return null;
  return Number.parseInt(s, 16) >>> 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const file = process.argv[2];
  if (!file) {
    process.stderr.write('usage: node sim/tpm-host/decode_inventory.mjs <inventory.json>\n');
    process.exit(2);
  }
  let doc;
  try {
    doc = JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
  } catch (e) {
    process.stderr.write('INVENTORY_UNREADABLE: ' + e.message + '\n');
    process.exit(2);
  }
  const report = analyzeInventory(doc);
  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  process.exit(report.errors.length === 0 ? 0 : 1);
}
