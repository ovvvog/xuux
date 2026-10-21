import { createHash, generateKeyPairSync, sign, verify } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { StateManifest, FNV_BIND_DECLARED_ENV, STATE_PROVISION_ENV, STATE_CONTEXT_ENV } from './build/src/root-of-trust/state-manifest.mjs';
import { buildManifestFnvBinding, manifestFnvBindingBytes } from './build/src/root-of-trust/fnv-binding.mjs';

const root = '/tmp/council-wl437/gpt_6_1_sol/manifest-probe-state-v2';
mkdirSync(root, { recursive: true });
const env = { [STATE_PROVISION_ENV]: '1', [STATE_CONTEXT_ENV]: 'council-gpt', [FNV_BIND_DECLARED_ENV]: '1' };
const h = x => createHash('sha256').update(x).digest('hex');
const keys = generateKeyPairSync('ed25519');
const sealer = {
  id: 'review-only-king',
  signAsync: async data => sign(null, Buffer.from(JSON.stringify(data)), keys.privateKey).toString('base64'),
  verify: (data, seal) => verify(null, Buffer.from(JSON.stringify(data)), keys.publicKey, Buffer.from(seal, 'base64')),
};
const provisioning = { kingId: sealer.id, context: 'test', tokenSerial: 'T', moduleSha256: 'M' };
const material = {
  counterIndex: '0x01800030', recordIndex: '0x01800031', base: '4',
  counterName: '000b' + h('name-C'), recordName: '000b' + h('name-R'),
  tpmIdentity: { kind: 'ek-certificate-sha256', value: h('cert') },
  authPolicy: { counter: h('policy-C'), record: h('policy-R') },
};
const binding = buildManifestFnvBinding(material, 'review-instance');
console.log('CANONICALIZER', JSON.stringify({ binding, bytesHex: Buffer.from(manifestFnvBindingBytes(binding)).toString('hex') }));

{
  const file = join(root, 'same-object.json');
  const m = new StateManifest(file, { env, sealer });
  await m.provisionAsync(provisioning, env);
  const results = await Promise.allSettled([m.bindFnvAsync(material, env), m.bindFnvAsync(material, env)]);
  console.log('SAME_OBJECT_IDENTICAL_CONCURRENT', JSON.stringify(results.map(r => r.status === 'fulfilled' ? { status: r.status, base: r.value.freshnessBinding.base } : { status: r.status, code: r.reason.code })));
}

{
  const file = join(root, 'two-objects.json');
  const first = new StateManifest(file, { env, sealer });
  await first.provisionAsync(provisioning, env);
  const second = new StateManifest(file, { env, sealer });
  const results = await Promise.allSettled([first.bindFnvAsync(material, env), second.bindFnvAsync({ ...material, base: '9' }, env)]);
  console.log('TWO_OBJECTS_DIFFERENT_CONCURRENT', JSON.stringify(results.map(r => r.status === 'fulfilled' ? { status: r.status, base: r.value.freshnessBinding.base } : { status: r.status, code: r.reason.code })));
  console.log('TWO_OBJECTS_FINAL_BASE', JSON.parse(readFileSync(file, 'utf8')).body.freshnessBinding.base);
}

{
  const file = join(root, 'restored.json');
  const first = new StateManifest(file, { env, sealer });
  await first.provisionAsync(provisioning, env);
  const prior = readFileSync(file);
  await first.bindFnvAsync(material, env);
  writeFileSync(file, prior);
  const restored = new StateManifest(file, { env, sealer });
  const result = await restored.bindFnvAsync(material, env);
  console.log('REPLAY_AFTER_RESTORE', JSON.stringify({ accepted: true, base: result.freshnessBinding.base }));
}
