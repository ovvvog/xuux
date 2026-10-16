import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

const dir = process.argv[2];
function parse(file) {
  const b = fs.readFileSync(path.join(dir, file));
  let p = 0;
  const u16 = () => { const n = b.readUInt16BE(p); p += 2; return n; };
  const u32 = () => { const n = b.readUInt32BE(p); p += 4; return n; };
  const u64 = () => { const n = b.readBigUInt64BE(p).toString(); p += 8; return n; };
  const sized = () => { const n = u16(); const out = b.subarray(p, p + n); p += n; return out; };
  const magic = u32().toString(16), type = u16().toString(16);
  const qualifiedSigner = sized().toString('hex'), extraData = sized().toString('hex');
  const clock = u64(), resetCount = u32(), restartCount = u32(), safe = b[p++];
  const firmwareVersion = u64(), indexName = sized().toString('hex'), offset = u16();
  const contents = sized();
  assert.equal(contents.length, 8);
  assert.equal(p, b.length);
  return { file, bytes: b.length, magic, type, qualifiedSigner, extraData, clock, resetCount, restartCount, safe, firmwareVersion, indexName, offset, counter: contents.readBigUInt64BE().toString() };
}
const a = parse('attest-a.bin'), b = parse('attest-b.bin');
assert.equal(a.counter, b.counter);
assert.equal(a.indexName, b.indexName);
assert.equal(a.qualifiedSigner, b.qualifiedSigner);
assert.notEqual(a.extraData, b.extraData);
fs.writeFileSync(path.join(dir, 'parsed-attestations.json'), JSON.stringify({ a, b }, null, 2));
console.log(JSON.stringify({ a, b }));
