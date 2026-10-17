// @ts-nocheck
// sim/tpm-ceremony/policy_digest.mjs
//
// حسابٌ مستقلٌّ (WL-412) لبصمةِ سياسةِ زيادةِ المرساةِ ولأسماءِ الكائناتِ والفهارسِ، مكتوبٌ من نصِّ
// المواصفةِ مباشرةً بـnode:crypto — لا يستدعي نواةَ C# ولا يشاركها شيفرة. الغرض: أن تُقارَنَ بصمةُ
// النواةِ (TpmCeremonyCore.cs) وبصمةُ جلسةِ التجربةِ في الـTPM بحسابٍ ثالثٍ لا بتنفيذِ الدالةِ نفسِها مرّتين.
//
// المراجع: TPM 2.0 Part 1 r1.38 §16 (Names)؛ Part 3 r1.38 §23.2.3 (PolicyUpdate)، §23.3 (PolicySigned)،
// §23.11 (PolicyCommandCode)؛ Part 2 r1.38 Table 204 (TPMA_NV)، Table 205 (TPMS_NV_PUBLIC).

import { createHash } from 'node:crypto';

const sha256 = (...parts) => createHash('sha256').update(Buffer.concat(parts.map((p) => Buffer.from(p)))).digest();
const u32 = (v) => { const b = Buffer.alloc(4); b.writeUInt32BE(v >>> 0); return b; };

export const TPM_CC = Object.freeze({
  PolicySigned: 0x160,
  PolicyCommandCode: 0x16c,
  NV_Increment: 0x134,
  NV_Read: 0x14e,
});

export const TPMA_NV = Object.freeze({
  PPWRITE: 1 << 0, OWNERWRITE: 1 << 1, AUTHWRITE: 1 << 2, POLICYWRITE: 1 << 3,
  TPM_NT_SHIFT: 4, TPM_NT_MASK: 0xf0,
  POLICY_DELETE: 1 << 10, WRITELOCKED: 1 << 11, WRITEALL: 1 << 12, WRITEDEFINE: 1 << 13,
  WRITE_STCLEAR: 1 << 14, GLOBALLOCK: 1 << 15, PPREAD: 1 << 16, OWNERREAD: 1 << 17,
  AUTHREAD: 1 << 18, POLICYREAD: 1 << 19, NO_DA: 1 << 25, ORDERLY: 1 << 26,
  CLEAR_STCLEAR: 1 << 27, READLOCKED: 1 << 28, WRITTEN: 1 << 29, PLATFORMCREATE: 1 << 30,
  READ_STCLEAR: 2 ** 31,
});
export const TPM_NT_COUNTER = 0x1;

/** Name = nameAlg(0x000B) || SHA-256(public area) — Part 1 §16. */
export function nameOfPublicArea(publicAreaHex) {
  return Buffer.concat([Buffer.from([0x00, 0x0b]), sha256(Buffer.from(publicAreaHex, 'hex'))]).toString('hex');
}

/** PolicySigned بلا policyRef: H(H(d || CC_PolicySigned || authName) || policyRef) — Part 3 §23.2.3. */
export function policySignedUpdate(digest, authObjectNameHex, policyRef = Buffer.alloc(0)) {
  const first = sha256(digest, u32(TPM_CC.PolicySigned), Buffer.from(authObjectNameHex, 'hex'));
  return sha256(first, policyRef);
}

/** PolicyCommandCode: H(d || CC_PolicyCommandCode || code) — Part 3 §23.11. */
export function policyCommandCodeUpdate(digest, code) {
  return sha256(digest, u32(TPM_CC.PolicyCommandCode), u32(code));
}

/** سياسةُ زيادةِ المرساةِ (ADR 0007 §4.2): PolicySigned(مفتاحُ الخدمة) ثمّ PolicyCommandCode(NV_Increment). */
export function anchorIncrementPolicy(serviceKeyNameHex) {
  return policyCommandCodeUpdate(policySignedUpdate(Buffer.alloc(32), serviceKeyNameHex), TPM_CC.NV_Increment).toString('hex');
}

/** يفكُّ TPMS_NV_PUBLIC (Part 2 Table 205). */
export function decodeNvPublic(hex) {
  const b = Buffer.from(hex, 'hex');
  let o = 0;
  const index = b.readUInt32BE(o); o += 4;
  const nameAlg = b.readUInt16BE(o); o += 2;
  const attributes = b.readUInt32BE(o); o += 4;
  const policyLen = b.readUInt16BE(o); o += 2;
  const authPolicy = b.subarray(o, o + policyLen).toString('hex'); o += policyLen;
  const dataSize = b.readUInt16BE(o); o += 2;
  if (o !== b.length) throw new Error('NV_PUBLIC_TRAILING_BYTES');
  return { index, nameAlg, attributes, authPolicy, dataSize };
}

/** قيودُ ADR 0007 §4.1 على فهرسِ المرساة، مفحوصةً بتاً بتاً. تُعيدُ قائمةَ المخالفات (فارغةٌ = مطابق).
 *  البتاتُ المحجوزةُ (8 و9 و20–24) يجبُ أن تكونَ صفرًا (Part 2 r1.38 Table 204) — وُسّعَت في
 *  WL-413 إغلاقًا لـSOL-05: الفحصُ يُسمّيها الآن فلا يُقالُ إنّه يفحصُ «كلَّ البتات» وهو لا يفعل. */
export function anchorAttributeViolations(attributes, { written } = { written: false }) {
  const a = attributes >>> 0;
  const v = [];
  const has = (bit) => (a & bit) !== 0;
  if (((a & TPMA_NV.TPM_NT_MASK) >>> TPMA_NV.TPM_NT_SHIFT) !== TPM_NT_COUNTER) v.push('TPM_NT!=COUNTER');
  if (!has(TPMA_NV.POLICYWRITE)) v.push('POLICYWRITE=0');
  for (const k of ['PPWRITE', 'OWNERWRITE', 'AUTHWRITE', 'POLICY_DELETE', 'ORDERLY', 'WRITEALL', 'WRITEDEFINE',
    'WRITE_STCLEAR', 'GLOBALLOCK', 'PPREAD', 'OWNERREAD', 'POLICYREAD', 'CLEAR_STCLEAR', 'READ_STCLEAR',
    'PLATFORMCREATE', 'WRITELOCKED', 'READLOCKED']) {
    if (has(TPMA_NV[k])) v.push(k + '=1');
  }
  for (const bit of [8, 9, 20, 21, 22, 23, 24]) {
    if (has(1 << bit)) v.push('RESERVED_BIT_' + bit + '=1');
  }
  if (!has(TPMA_NV.AUTHREAD)) v.push('AUTHREAD=0');
  if (!has(TPMA_NV.NO_DA)) v.push('NO_DA=0');
  if (has(TPMA_NV.WRITTEN) !== Boolean(written)) v.push('WRITTEN=' + (has(TPMA_NV.WRITTEN) ? 1 : 0));
  return v;
}
