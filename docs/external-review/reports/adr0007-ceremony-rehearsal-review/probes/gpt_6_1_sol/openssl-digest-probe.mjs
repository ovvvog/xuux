import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { anchorIncrementPolicy, anchorAttributeViolations } from '/home/user/workspace/xuux-review-50518cf6/sim/tpm-ceremony/policy_digest.mjs';

const report = JSON.parse(readFileSync(new URL('./rehearsal.json', import.meta.url)));
const name = report.facts['s2.serviceKey.name'];
const hashHex = hex => execFileSync('openssl', ['dgst', '-sha256', '-binary'], {input: Buffer.from(hex, 'hex')}).toString('hex');
// Hex fields transcribed independently from Part 3 r1.38 equations 10, 11, 14, 26.
// Sized-buffer length fields are deliberately absent. Empty policyRef still hashes again.
const first = hashHex('00'.repeat(32) + '00000160' + name);
const signed = hashHex(first);
const final = hashHex(signed + '0000016c' + '00000134');
const withoutSecondHash = hashHex(first + '0000016c' + '00000134');
assert.equal(final, report.facts['s2.policy.tpmTrialDigest']);
assert.equal(final, report.facts['s2.policy.coreFormulaDigest']);
assert.equal(final, anchorIncrementPolicy(name));
assert.notEqual(final, withoutSecondHash);
const reservedBitAcceptance = [8,9,20,21,22,23,24].map(bit => ({
  bit, attributes: (0x02040018 | 2 ** bit).toString(16),
  violations: anchorAttributeViolations(0x02040018 | 2 ** bit, {written:false}),
}));
console.log(JSON.stringify({serviceKeyName:name, first, signed, final, withoutSecondHash,
  comparisons:4, reservedBitAcceptance}, null, 2));
