// Deterministic specification-level vector, NOT a TPM execution.
import { createHash, createHmac } from 'node:crypto';
import assert from 'node:assert/strict';

function u32(n) { const b = Buffer.alloc(4); b.writeUInt32BE(n); return b; }
function b2(b) { const n = Buffer.alloc(2); n.writeUInt16BE(b.length); return Buffer.concat([n, b]); }
const sha = (...b) => createHash('sha256').update(Buffer.concat(b)).digest();
const key = Buffer.alloc(32, 0xaa);
const nonceCaller = Buffer.alloc(32, 0xbb);
const nonceTpmReply = Buffer.alloc(32, 0xcc);
const cmdAttributes = 0x81;
const responseAttributes = 0x83;
// First use of a salted HMAC session for audit, TPM2_GetCapability(HANDLES),
// with an empty NV inventory; Part 1 rev 1.59 §18.6.4, §20.2.
const parameters = Buffer.concat([Buffer.from([0]), u32(1), u32(0)]);
const rpHash = sha(u32(0), u32(0x17a), parameters);
const responseHmac = createHmac('sha256', key)
  .update(Buffer.concat([rpHash, nonceTpmReply, nonceCaller, Buffer.from([responseAttributes])]))
  .digest();
const authorization = Buffer.concat([b2(nonceTpmReply), Buffer.from([responseAttributes]), b2(responseHmac)]);
const body = Buffer.concat([u32(parameters.length), parameters, authorization]);
const header = Buffer.concat([Buffer.from([0x80, 0x02]), u32(10 + body.length), u32(0)]);
const response = Buffer.concat([header, body]);
assert.equal(response.readUInt32BE(2), response.length);
assert.equal(response.readUInt32BE(10), parameters.length);
assert.notEqual(cmdAttributes, responseAttributes);
const incorrectlyExpectedHmac = createHmac('sha256', key)
  .update(Buffer.concat([rpHash, nonceTpmReply, nonceCaller, Buffer.from([cmdAttributes])]))
  .digest();
assert.notDeepEqual(responseHmac, incorrectlyExpectedHmac);
console.log(JSON.stringify({
  kind: 'TCG-specification-level-vector-no-TPM',
  command: 'TPM2_GetCapability first use of new salted HMAC audit session',
  commandAttributes: '0x81',
  correctResponseAttributes: '0x83',
  ADR_4_4_equal_attributes_accepts: responseAttributes === cmdAttributes,
  rpHash: rpHash.toString('hex'),
  responseHmac: responseHmac.toString('hex'),
  incorrectHmacUsingCommandAttributes: incorrectlyExpectedHmac.toString('hex'),
  responseBytes: response.toString('hex'),
  responseLength: response.length
}, null, 2));
