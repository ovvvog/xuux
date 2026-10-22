// Protocol-shaped evidence only: no device, TPM library, TBS, or network access.
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign, verify } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

const dir = '/tmp/council-wl437-r4/gpt_6_1_sol/';
const annex = readFileSync('/tmp/wt-7a799ce-gpt/docs/adr/0007-annex-e-production-backend-design.md', 'utf8');
const nvPublicRow = annex.split('\n').find(line => line.startsWith('| `NV_ReadPublic` |'));
const createPrimaryRow = annex.split('\n').find(line => line.startsWith('| `CreatePrimary` |'));
assert(nvPublicRow.includes('مملّحة'));
assert(!nvPublicRow.includes('بلا جلسات'));
assert(createPrimaryRow.includes('الجردِ الموثَّق'));
assert(annex.includes('أيُّ تركيبةٍ لا يصفُها الصفُّ بالضبطِ تُرفَضُ قبلَ الإرسال'));
assert(annex.includes('قراءاتُ التمهيد (`GetCapability`، و`NV_ReadPublic`، و`ReadPublic`)'));
console.log('BOOTSTRAP_DESCRIPTOR_CONTRADICTION',
  JSON.stringify({nvReadPublicRow: nvPublicRow, createPrimaryRequiresAuthenticatedInventory: true,
    noSessionBootstrapListedElsewhere: true}));

// Exact NV_UndefineSpace shape from TCG Part 3 §31.4, Table 201.
// Only the password authorization relation is modeled; this is NOT a TPM emulator.
function u16(n) { const b = Buffer.alloc(2); b.writeUInt16BE(n); return b; }
function u32(n) { const b = Buffer.alloc(4); b.writeUInt32BE(n); return b; }
const OWNER = 0x40000001;
const PW = 0x40000009;
const CC_NV_UNDEFINE = 0x122;
const allowedIndex = 0x01800021;
const otherIndex = 0x01800022;
const ownerAuth = Buffer.from('r4-public-example', 'ascii'); // Deliberately not a real secret.
const auth = Buffer.concat([u32(PW), u16(0), Buffer.from([1]), u16(ownerAuth.length), ownerAuth]);
const body = Buffer.concat([u32(OWNER), u32(allowedIndex), u32(auth.length), auth]);
const original = Buffer.concat([u16(0x8002), u32(10 + body.length), u32(CC_NV_UNDEFINE), body]);
assert.equal(original.readUInt32BE(14), allowedIndex); // Host's allowlist check.
const changed = Buffer.from(original);
changed.writeUInt32BE(otherIndex, 14); // Untrusted transport changes only nvIndex.

function passwordAuthorizationModel(bytes) {
  assert.equal(bytes.readUInt16BE(0), 0x8002);
  assert.equal(bytes.readUInt32BE(2), bytes.length);
  assert.equal(bytes.readUInt32BE(6), CC_NV_UNDEFINE);
  assert.equal(bytes.readUInt32BE(10), OWNER);
  assert.equal(bytes.readUInt32BE(18), bytes.length - 22);
  assert.equal(bytes.readUInt32BE(22), PW);
  assert.equal(bytes.readUInt16BE(26), 0);
  assert.equal(bytes[28], 1);
  const length = bytes.readUInt16BE(29);
  assert.equal(bytes.length, 31 + length);
  return bytes.subarray(31).equals(ownerAuth);
}
assert(passwordAuthorizationModel(original));
assert(passwordAuthorizationModel(changed));
assert(original.subarray(22).equals(changed.subarray(22)));
const nvResources = new Set([allowedIndex, otherIndex]);
nvResources.delete(changed.readUInt32BE(14));
assert(nvResources.has(allowedIndex));
assert(!nvResources.has(otherIndex));
writeFileSync(`${dir}owner-pw-undefine-original.bin`, original);
writeFileSync(`${dir}owner-pw-undefine-transport-changed.bin`, changed);
console.log('OWNER_PASSWORD_HAS_NO_COMMAND_INTEGRITY', JSON.stringify({
  kind: 'TCG-shaped password-authorization model, not a TPM execution',
  originalHex: original.toString('hex'),
  changedHex: changed.toString('hex'),
  originalTarget: `0x${allowedIndex.toString(16)}`,
  wireTarget: `0x${otherIndex.toString(16)}`,
  authorizationAreaIdentical: true,
  ownerPasswordVisibleInWireBytes: true,
  authorizedInModelBeforeAndAfterChange: true,
  originalResourceRemains: nvResources.has(allowedIndex),
  otherResourceRemoved: !nvResources.has(otherIndex),
  hostReadbackWouldDetectTooLateToUndoDeletion: true,
}));

// R2-06: even a signature on the ceremony file does not give it freshness.
// This models the stated limit; it is NOT an implementation of the proposed G3 protocol.
const keys = generateKeyPairSync('ed25519');
function signedRecord(state) {
  const bytes = Buffer.from(JSON.stringify({challenge: 'public-r4-challenge', state}));
  return JSON.stringify({record: bytes.toString('base64'), signature: sign(null, bytes, keys.privateKey).toString('base64')});
}
function readAuthenticatedRecord(path) {
  const file = JSON.parse(readFileSync(path, 'utf8'));
  const bytes = Buffer.from(file.record, 'base64');
  assert(verify(null, bytes, keys.publicKey, Buffer.from(file.signature, 'base64')));
  return JSON.parse(bytes);
}
const active = signedRecord('active');
writeFileSync(`${dir}ledger-active-snapshot.json`, active);
writeFileSync(`${dir}ledger-current.json`, active);
let consumptions = 0;
function consumeModel() {
  assert.equal(readAuthenticatedRecord(`${dir}ledger-current.json`).state, 'active');
  writeFileSync(`${dir}ledger-current.json`, signedRecord('consumed'));
  consumptions++;
}
consumeModel();
assert.equal(readAuthenticatedRecord(`${dir}ledger-current.json`).state, 'consumed');
writeFileSync(`${dir}ledger-consumed-before-restore.json`, readFileSync(`${dir}ledger-current.json`));
writeFileSync(`${dir}ledger-current.json`, readFileSync(`${dir}ledger-active-snapshot.json`));
consumeModel();
assert.equal(consumptions, 2);
console.log('R2_06_SIGNED_FILE_RESTORE_MODEL', JSON.stringify({
  kind: 'signed-file freshness model only; no G3 implementation and no TPM',
  consumptions, signatureAcceptedForRestoredSnapshot: true,
  challengeSha256: createHash('sha256').update('public-r4-challenge').digest('hex'),
}));
