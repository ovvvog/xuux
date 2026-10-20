// @ts-nocheck
// sim/freshness-nv/hw-plan-check.mjs
//
// WL-432 — فاحصُ خطّةِ التأهيلِ العتاديِّ لمرجعِ الحداثة (‏C + R). **قرائيٌّ بالكامل ولا يتّصلُ بأيِّ TPM:**
// يقرأُ ملفَّ جردٍ أنتجَه `sim/tpm-host/win_tpm_inventory.ps1` (‏GetCapability وNV_ReadPublic عبرَ TBS)،
// ويفسّرُه بـ`sim/tpm-host/decode_inventory.mjs`، ثمّ يقيسُ شروطَ الخطّةِ ويفصلُ:
//   - الموانعَ (`blockers`) التي تُسقطُ الخطّة،
//   - وقراراتِ المالكِ (`ownerDecisions`) اللازمةَ قبلَ أيِّ كتابة،
//   - وما **لا تقيسُه** القراءةُ أصلًا (`unmeasurableReadOnly`).
// لا يطبعُ أسرارًا: ملفُّ الجردِ لا يحملُ OwnerAuth (‏قائمةُ حقولٍ مغلقةٌ في الأداة)، والمخرجُ أعدادٌ ومقابضُ وسمات.
//
//   node sim/freshness-nv/hw-plan-check.mjs <inventory.json> [--c 0x018xxxxx --r 0x018xxxxx]
//
// خروج: 0 لا موانع (ولا يعني إذنًا بالكتابة) · 1 موانع · 2 مدخلٌ فاسد.

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { OWNER_INDEX_RANGE, analyzeInventory } from '../tpm-host/decode_inventory.mjs';

/** مقبضا المحاكاة (‏WL-431) — في مجالِ مصنّعِ المنصّةِ بحسبِ سجلِّ TCG؛ ممنوعانِ على العتاد. */
export const SIMULATOR_HANDLES = Object.freeze([0x01500030, 0x01500031]);
/** سجلُّ TCG للمقابضِ المحفوظة v1p6: مجالاتُ فهارسِ NV. */
export const NV_RANGES = Object.freeze([
  { first: 0x01000000, last: 0x013fffff, owner: 'tpm-manufacturer' },
  { first: 0x01400000, last: 0x017fffff, owner: 'platform-manufacturer' },
  { first: 0x01800000, last: 0x01bfffff, owner: 'owner' },
  { first: 0x01c00000, last: 0x01ffffff, owner: 'tcg-defined' },
]);
/** حجمُ سجلِّ R في التصميمِ المحاكى (‏`RECORD_SIZE`). */
export const RECORD_BYTES = 128;
/** ملخّصُ المالكِ في WL-411 (‏2026-10-17) — للمقارنةِ لا للاعتماد. */
export const WL411_SUMMARY = Object.freeze({ nvIndexes: 16, counters: 4, nvCountersMax: 8, ownerRange: 5 });
/** أوامرُ يلزمُ أن يُنفّذَها الـTPM لتصميمِ C + R معَ سياسةِ الخدمة. */
export const REQUIRED_COMMANDS = Object.freeze([
  'TPM2_NV_DefineSpace',
  'TPM2_NV_UndefineSpace',
  'TPM2_NV_Increment',
  'TPM2_NV_Read',
  'TPM2_NV_ReadPublic',
  'TPM2_PolicySigned',
  'TPM2_PolicyCommandCode',
  'TPM2_StartAuthSession',
  'TPM2_NV_Certify',
]);

const hex = (n) => '0x' + (n >>> 0).toString(16).padStart(8, '0');
const parseHandle = (s) => (typeof s === 'number' ? s >>> 0 : Number.parseInt(String(s), 16) >>> 0);
export const rangeOf = (h) => NV_RANGES.find((r) => h >= r.first && h <= r.last)?.owner ?? 'not-nv-index';

/**
 * مقبضانِ مقترحانِ حتميّانِ في مجالِ المالك (‏C زوجيّ، R = C+1) يتخطّيانِ المشغول. **اقتراحٌ للمراجعة:**
 * يُعادُ فحصُه بجردٍ فوريٍّ قبلَ أيِّ تعريفٍ في المهمّةِ المأذونة (‏الجردُ لقطةٌ لحظيّة).
 */
export function proposeHandles(inUse, seed = 'xuux/freshness-nv/hw-qualification/v1') {
  const used = new Set(inUse);
  const span = (OWNER_INDEX_RANGE.last - OWNER_INDEX_RANGE.first + 1) / 2;
  let slot = createHash('sha256').update(seed).digest().readUInt32BE(0) % span;
  for (let i = 0; i < 1024; i += 1) {
    const c = OWNER_INDEX_RANGE.first + 2 * slot;
    if (!used.has(c) && !used.has(c + 1)) return { c, r: c + 1, seed, skipped: i };
    slot = (slot + 1) % span;
  }
  return null;
}

/** يفحصُ تقريرَ `analyzeInventory` مقابلَ الخطّة. دالّةٌ نقيّة. */
export function planCheck(report, opts = {}) {
  const blockers = [];
  const ownerDecisions = [];
  const notes = [];
  const out = { schema: 'xuux.fnv-hw-plan-check/1', readOnly: true, blockers, ownerDecisions, notes };

  // (أ) صحّةُ الدليل
  out.evidenceClass = report.evidenceClass;
  if (report.evidenceClass !== 'hardware-tbs') blockers.push('NOT_HARDWARE_EVIDENCE');
  if (!report.schemaOk || (report.errors ?? []).length > 0) blockers.push('INVENTORY_INVALID');
  if (report.requestsAllAllowlisted !== true) blockers.push('INVENTORY_REQUESTS_NOT_ALLOWLISTED');
  for (const cap of ['nv-index-handles', 'tpm-properties-fixed', 'tpm-properties-var', 'commands']) {
    if (report.capabilitiesComplete?.[cap] !== true) blockers.push(`CAPABILITY_INCOMPLETE:${cap}`);
  }

  // (ب) الهويّةُ والجاهزيّة
  out.identity = {
    manufacturer: report.tpm?.manufacturer ?? null,
    vendorString: report.tpm?.vendorString ?? null,
    family: report.tpm?.familyIndicator ?? null,
    specRevisionTimes100: report.tpm?.specRevisionTimes100 ?? null,
    firmware: report.tpm?.firmware?.dotted ?? null,
  };
  const g = report.getTpm?.ok === true && report.getTpm.fields && typeof report.getTpm.fields === 'object' ? report.getTpm.fields : null;
  const pick = (k) => (g && Object.hasOwn(g, k) ? g[k] : null);
  out.readiness = Object.fromEntries(
    ['TpmPresent', 'TpmReady', 'TpmEnabled', 'TpmActivated', 'TpmOwned', 'RestartPending', 'ManagedAuthLevel', 'OwnerClearDisabled', 'AutoProvisioning', 'LockedOut', 'LockoutCount', 'LockoutMax'].map((k) => [k, pick(k)]),
  );
  if (g === null) blockers.push('READINESS_UNKNOWN_GET_TPM_ABSENT');
  else {
    for (const k of ['TpmPresent', 'TpmReady', 'TpmEnabled']) if (pick(k) !== true) blockers.push(`TPM_NOT_READY:${k}`);
    if (pick('LockedOut') !== false) blockers.push('TPM_DA_LOCKED_OUT_OR_UNKNOWN');
    if (pick('RestartPending') === true) blockers.push('TPM_RESTART_PENDING');
  }

  // (ج) الموارد — أربعةُ أبعادٍ منفصلةٍ لا يُستنتَجُ أحدُها من آخر
  const nv = report.nv ?? {};
  const max = nv.nvCountersMax;
  const counters = nv.nvCountersDefined;
  const counterQuota = { max: max?.value ?? null, semantics: max?.semantics ?? null, defined: counters, needed: 1 };
  if (max?.ok && max.semantics === 'fixed-maximum' && Number.isInteger(counters)) {
    counterQuota.headroomUpperBound = max.value - counters;
    if (counterQuota.headroomUpperBound < 1) blockers.push('NV_COUNTER_QUOTA_EXHAUSTED');
    else if (counterQuota.headroomUpperBound < 2) notes.push('NV_COUNTER_HEADROOM_IS_ONE: S1 temporary probe and C cannot coexist');
  } else if (max?.ok && max.semantics === 'no-fixed-maximum') {
    counterQuota.headroomUpperBound = null;
    notes.push('NV_COUNTER_QUOTA_POOL_BOUND: no fixed maximum (r1.59 NOTE 2); bounded by unmeasured NV pool');
  } else {
    counterQuota.headroomUpperBound = null;
    blockers.push('NV_COUNTER_QUOTA_UNKNOWN');
  }
  counterQuota.note = 'upper bound only; NV pool may be exhausted first (free bytes unmeasured)';
  const indexCount = { defined: nv.nvIndexesDefined ?? null, listed: nv.handleCount ?? null, needed: 2 };
  if (indexCount.defined !== null && indexCount.listed !== null && indexCount.defined !== indexCount.listed) {
    blockers.push('NV_INDEX_COUNT_DISAGREES');
  }
  const size = {
    recordBytes: RECORD_BYTES,
    nvIndexMax: nv.nvIndexMaxDataSize ?? null,
    nvBufferMax: nv.nvBufferMax ?? null,
    freeNvBytes: null,
  };
  if (!(size.nvIndexMax >= RECORD_BYTES)) blockers.push('R_EXCEEDS_NV_INDEX_MAX_OR_UNKNOWN');
  // سجلُّ R يجبُ أن يُكتبَ بأمرِ NV_Write واحد؛ وإلّا فالكتابةُ مجزّأةٌ وتمزّقُها نافذةٌ إضافيّة.
  if (!(size.nvBufferMax >= RECORD_BYTES)) blockers.push('R_NEEDS_MULTIPLE_NV_WRITES_OR_UNKNOWN');
  const authorization = {
    managedAuthLevel: pick('ManagedAuthLevel'),
    proven: false,
    note: 'Get-Tpm fields are status, not proof that owner/storage authorization is usable by the ceremony',
  };
  out.resources = { counterQuota, indexCount, size, persistentAvailEstimate: nv.persistentAvailEstimate ?? null, authorization };

  // (د) المقابض
  const inUse = (report.nvIndexes ?? []).map((e) => parseHandle(e.handle));
  const ownerInUse = inUse.filter((h) => rangeOf(h) === 'owner');
  out.handles = {
    inUse: inUse.map(hex),
    byRange: Object.fromEntries(NV_RANGES.map((r) => [r.owner, inUse.filter((h) => rangeOf(h) === r.owner).length])),
    ownerRangeInUse: ownerInUse.map(hex),
    ownerRangeDetail: (report.nvIndexes ?? [])
      .filter((e) => rangeOf(parseHandle(e.handle)) === 'owner')
      .map((e) => ({ handle: e.handle, type: e.attributes?.ntName ?? null, attributes: e.attributes?.set ?? null, dataSize: e.dataSize ?? null, error: e.error ?? null })),
  };
  const unreadable = (report.nvIndexes ?? []).filter((e) => e.ok !== true);
  if (unreadable.length > 0) blockers.push('NV_PUBLIC_UNREADABLE:' + unreadable.map((e) => e.handle).join(','));
  if (ownerInUse.length > 0) {
    ownerDecisions.push(
      `OWNER_RANGE_OCCUPIED_UNATTRIBUTED:${ownerInUse.length} — the WL-416 ownership barrier halts before any mutating command; owner must decide whether to permit a run beside indices it cannot attribute`,
    );
  }
  let proposal = null;
  if (opts.c !== undefined || opts.r !== undefined) {
    proposal = { c: parseHandle(opts.c), r: parseHandle(opts.r), source: 'operator' };
  } else {
    const p = proposeHandles(inUse);
    proposal = p && { c: p.c, r: p.r, source: 'deterministic-proposal', seed: p.seed, skipped: p.skipped };
  }
  if (!proposal) blockers.push('NO_FREE_HANDLE_PAIR');
  else {
    const issues = [];
    for (const [role, h] of [['C', proposal.c], ['R', proposal.r]]) {
      if (rangeOf(h) !== 'owner') issues.push(`${role}_NOT_IN_OWNER_RANGE:${rangeOf(h)}`);
      if (SIMULATOR_HANDLES.includes(h)) issues.push(`${role}_IS_SIMULATOR_HANDLE`);
      if (inUse.includes(h)) issues.push(`${role}_IN_USE`);
    }
    if (proposal.c === proposal.r) issues.push('C_EQUALS_R');
    blockers.push(...issues.map((i) => `HANDLE_${i}`));
    out.proposal = { c: hex(proposal.c), r: hex(proposal.r), source: proposal.source, seed: proposal.seed ?? null, recheckImmediatelyBeforeDefine: true, issues };
  }

  // (هـ) الأوامرُ المنفّذةُ في الشريحة (‏لا سماحُ TBS)
  const impl = report.commands?.implementedByTpm ?? {};
  out.commands = Object.fromEntries(REQUIRED_COMMANDS.map((n) => [n, impl[n]?.implemented ?? 'unknown']));
  for (const n of REQUIRED_COMMANDS) if (impl[n]?.implemented === false) blockers.push(`COMMAND_NOT_IMPLEMENTED:${n}`);
  out.tbsObserved = report.tbsObserved ?? null;

  // (و) المقارنةُ بملخّصِ WL-411
  out.driftVsWl411 = {
    nvIndexes: [WL411_SUMMARY.nvIndexes, indexCount.listed],
    counters: [WL411_SUMMARY.counters, counters ?? null],
    nvCountersMax: [WL411_SUMMARY.nvCountersMax, counterQuota.max],
    ownerRange: [WL411_SUMMARY.ownerRange, ownerInUse.length],
  };

  out.unmeasurableReadOnly = [
    'free NV bytes: no GetCapability property; only an approved define attempt (TPM_RC_NV_SPACE) measures it',
    'whether Windows TBS permits NV_DefineSpace / NV_Increment / NV_Write / NV_UndefineSpace / NV_Certify for the ceremony account',
    'usable owner (storage hierarchy) authorization — ManagedAuthLevel is status, not proof',
    'counter monotonicity across undefine/redefine and across power loss on this chip',
    'single NV_Write atomicity for R under power loss (vendor property, not in the spec guarantee)',
    'BitLocker / Windows Hello dependence on the indices in the owner range (read with manage-bde / dsregcmd, not via TPM)',
  ];
  out.verdict = blockers.length === 0 ? 'NO_READ_ONLY_BLOCKERS__OWNER_DECISION_STILL_REQUIRED' : 'BLOCKED';
  return out;
}

async function main(argv) {
  const file = argv[0];
  if (!file) {
    process.stderr.write('usage: hw-plan-check.mjs <inventory.json> [--c HANDLE --r HANDLE]\n');
    return 2;
  }
  const opts = {};
  for (let i = 1; i < argv.length; i += 2) {
    if (argv[i] === '--c') opts.c = argv[i + 1];
    else if (argv[i] === '--r') opts.r = argv[i + 1];
    else {
      process.stderr.write(`unknown argument ${argv[i]}\n`);
      return 2;
    }
  }
  let doc;
  let fileSha256;
  try {
    const raw = readFileSync(file);
    doc = JSON.parse(raw.toString('utf8').replace(/^\uFEFF/, ''));
    fileSha256 = createHash('sha256').update(raw).digest('hex');
  } catch (error) {
    process.stderr.write(`INVENTORY_UNREADABLE: ${error.message}\n`);
    return 2;
  }
  const result = { inventorySha256: fileSha256, ...planCheck(analyzeInventory(doc), opts) };
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  return result.blockers.length === 0 ? 0 : 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
