// Non-TPM models of the written contract, not an implementation of G2/G3.
// Annex: /tmp/wt-a70ae97-gpt/docs/adr/0007-annex-e-production-backend-design.md
// TCG Part 1 r1.59 §§19.6.5, 37.2.6.3:
// https://trustedcomputinggroup.org/wp-content/uploads/TCG_TPM2_r1p59_Part1_Architecture_pub.pdf
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash, createHmac } from 'node:crypto';

const annex = readFileSync('/tmp/wt-a70ae97-gpt/docs/adr/0007-annex-e-production-backend-design.md', 'utf8');
const lines = annex.split('\n');
assert(lines[153].includes('bootstrap') && lines[153].includes('ن2'));
assert(lines[158].includes('T1–T6') && lines[158].includes('StartAuthSession'));
assert(lines[221].includes('StartAuthSession') && lines[221].includes('ن1'));

// Exhaust the closed bootstrap set. StartAuthSession is NO_SESSIONS (N1),
// CreatePrimary and NV_Read use password (N3); none can supply N2.
const bootstrap = [
  { row: 'T1', command: 'GetCapability', response: 'N1' },
  { row: 'T2', command: 'NV_ReadPublic', response: 'N1' },
  { row: 'T3', command: 'NV_Read', response: 'N3' },
  { row: 'T4', command: 'ReadPublic', response: 'N1' },
  { row: 'T5', command: 'CreatePrimary', response: 'N3' },
  { row: 'T6', command: 'GetCapability', response: 'N1' },
  { row: 'general', command: 'StartAuthSession', response: 'N1' },
];
const reachable = new Set(['bootstrap']);
for (const command of bootstrap) {
  if (command.response === 'N2') reachable.add('salted');
}
assert.deepEqual([...reachable], ['bootstrap']);
console.log(JSON.stringify({ model: 'literal-gate-reachability', bootstrap, reachable: [...reachable],
  reason: 'Annex:154 requires N2 to leave bootstrap; Annex:159 admits no command producing N2.',
  no_identity_bypass_demonstrated: true }));

const u16 = n => { const b = Buffer.alloc(2); b.writeUInt16BE(n); return b; };
const u32 = n => { const b = Buffer.alloc(4); b.writeUInt32BE(n); return b; };
const hash = (...b) => createHash('sha256').update(Buffer.concat(b)).digest();
const hmac = (key, ...b) => createHmac('sha256', key).update(Buffer.concat(b)).digest();
const b2 = b => Buffer.concat([u16(b.length), b]);
const trimAuth = auth => { let end = auth.length; while (end && auth[end - 1] === 0) end--; return auth.subarray(0, end); };
const publicArea = (handle, attrs, size = 8) => Buffer.concat([
  u32(handle), u16(0x000b), u32(attrs), b2(Buffer.alloc(0)), u16(size),
]);
const name = pub => Buffer.concat([u16(0x000b), hash(pub)]);
const ownerName = u32(0x40000001);
const sessionKey = Buffer.alloc(32, 0x51); // symbolic established EK-salted session key
const caller = Buffer.alloc(32, 0x52);
const tpmNonce = Buffer.alloc(32, 0x53);
const auth = Buffer.from('owner-test-value-not-a-real-secret');
const key = Buffer.concat([sessionKey, trimAuth(auth)]);
const cp = (code, names, parameters = Buffer.alloc(0)) => hash(u32(code), ...names, parameters);
const authHmac = digest => hmac(key, digest, caller, tpmNonce, Buffer.from([0]));
const pubK = publicArea(0x01800023, 0x22040012);
const pubX = publicArea(0x01800024, 0x22040012);
const original = cp(0x122, [ownerName, name(pubK)]);
const switchedIndex = cp(0x122, [ownerName, name(pubX)]);
const switchedCode = cp(0x134, [ownerName, name(pubK)]);
assert(!authHmac(original).equals(authHmac(switchedIndex)));
assert(!authHmac(original).equals(authHmac(switchedCode)));
const defineParams = Buffer.concat([b2(Buffer.alloc(0)), b2(publicArea(0x01800025, 0x02040012))]);
const changedParams = Buffer.concat([b2(Buffer.alloc(0)), b2(publicArea(0x01800025, 0x02040018))]);
assert(!authHmac(cp(0x12a, [ownerName], defineParams)).equals(authHmac(cp(0x12a, [ownerName], changedParams))));
assert(!authHmac(original).equals(hmac(key, original, caller, Buffer.alloc(32, 0x54), Buffer.from([0]))));
assert(trimAuth(Buffer.concat([auth, Buffer.alloc(3)])).equals(auth));
const area = Buffer.concat([u32(0x02000000), b2(caller), Buffer.from([0]), b2(authHmac(original))]);
assert(!area.includes(auth));
console.log(JSON.stringify({ model: 'owner-hmac', cpHash: original.toString('hex'),
  handle_mutation_changes_hmac: true, code_mutation_changes_hmac: true,
  publicInfo_mutation_changes_hmac: true, nonce_mutation_changes_hmac: true,
  trailing_zero_auth_normalized: true, plaintext_ownerAuth_absent_in_model_auth_area: true,
  limitation: 'An algebraic consistency check with a symbolic established session key; not an official test vector, not a TPM execution.' }));

const mask = (2 ** 1) + (1 << 4) + (2 ** 18) + (2 ** 25);
assert.equal(mask, 0x02040012);
let k = 10n, deletedMaximum = 0n, definitions = 0, ownerPrompts = 0;
const consume = expected => {
  if (expected !== k) return 'reject-before-owner';
  ownerPrompts++;
  k++;
  definitions++;
  return 'defined';
};
assert.equal(consume(10n), 'defined');
const localSnapshot = { challenge: 'same-active-challenge', consumed: false };
assert.equal(localSnapshot.consumed, false); // old local file restored
assert.equal(consume(10n), 'reject-before-owner');
assert.equal(ownerPrompts, 1);
const removeAndRecreate = () => {
  deletedMaximum = deletedMaximum > k ? deletedMaximum : k;
  k = deletedMaximum + 1n; // explicit spec assumption, not an experimental result
};
removeAndRecreate();
assert.equal(consume(10n), 'reject-before-owner');
removeAndRecreate(); // model TPM2_Clear as deleting owner indices while preserving max
assert.equal(consume(10n), 'reject-before-owner');
assert.equal(definitions, 1);
assert.equal(ownerPrompts, 1);
const v = k;
k++; // power loss after consumption but before definitions
assert.equal(consume(v), 'reject-before-owner');
console.log(JSON.stringify({ model: 'witness-K', mask: '0x' + mask.toString(16),
  file_restore_rejected_before_owner: true, redefine_rejected_before_owner: true,
  clear_rejected_before_owner: true, burn_before_definition_rejected: true,
  limitation: 'Persistence/max-counter properties are assumptions of this model, not measurements or a proof about a vendor.' }));
