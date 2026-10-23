import assert from 'node:assert/strict';
import { generateKeyPairSync, sign, verify } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import {
  StateManifest, STATE_PROVISION_ENV, FNV_BIND_DECLARED_ENV,
} from 'file:///tmp/wt-7a799ce-gpt/src/root-of-trust/state-manifest.mjs';
import { fnvBindingSourceDiff } from 'file:///tmp/wt-7a799ce-gpt/src/root-of-trust/fnv-binding.mjs';

const dir = '/tmp/council-wl437-r4/gpt_6_1_sol/current-probes';
mkdirSync(dir, {recursive: true});
const {privateKey, publicKey} = generateKeyPairSync('ed25519');
const keyId = 'king:r4-public-test-key';
const hsm = {
  id: keyId,
  async signAsync(payload) {
    return sign(null, Buffer.from(JSON.stringify(payload)), privateKey).toString('base64');
  },
  verify(payload, signature) {
    return verify(null, Buffer.from(JSON.stringify(payload)), publicKey, Buffer.from(signature, 'base64'));
  },
};
const identity = Object.freeze({
  counterIndex:'0x01800010', recordIndex:'0x01800011',
  counterName:'000b'+'cd'.repeat(32), recordName:'000b'+'ef'.repeat(32),
  base:'2', authPolicy: {counter:'11'.repeat(32), record:'12'.repeat(32)},
  tpmIdentity: {kind:'ek-certificate-sha256', value:'22'.repeat(32)},
});
const sourceWithoutIdentity = Object.fromEntries(Object.entries(identity).filter(([k]) => k !== 'tpmIdentity'));
async function makeManifest(name) {
  const result = new StateManifest(`${dir}/${name}.json`, {fsync:true, sealer:hsm});
  await result.provisionAsync({
    kingId:keyId, context:'public-r4-test', tokenSerial:'PUBLIC-R4-TOKEN', moduleSha256:'PUBLIC-R4-MODULE',
  }, {[STATE_PROVISION_ENV]:'1'});
  return result;
}
const one = await makeManifest('sequential');
const receipt = await one.bindFnvAsync(identity, {[FNV_BIND_DECLARED_ENV]:'1'});
let code;
try { await one.bindFnvAsync(identity, {[FNV_BIND_DECLARED_ENV]:'1'}); } catch (error) { code=error.code; }
assert.equal(code, 'STATE_MANIFEST_FNV_BINDING_IMMUTABLE');
console.log('CURRENT_SEQUENTIAL_SECOND_BIND', code);
const race = await makeManifest('same-object-concurrent');
const settlements = await Promise.allSettled([
  race.bindFnvAsync(identity, {[FNV_BIND_DECLARED_ENV]:'1'}),
  race.bindFnvAsync(identity, {[FNV_BIND_DECLARED_ENV]:'1'}),
]);
assert.equal(settlements.filter(s => s.status==='fulfilled').length, 2);
console.log('CURRENT_SAME_OBJECT_CONCURRENT_IDENTICAL_BINDS',
  JSON.stringify(settlements.map(s=>s.status)));
assert.equal(fnvBindingSourceDiff(receipt.freshnessBinding, sourceWithoutIdentity), null);
console.log('CURRENT_OPTIONAL_SOURCE_IDENTITY_DIFF', 'null');
console.log('SCOPE', 'Current source probes only: these do not implement the signed G3 proposal.');
