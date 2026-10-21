import { createHash, generateKeyPairSync, sign, verify } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { StateManifest, FNV_BIND_DECLARED_ENV, STATE_PROVISION_ENV, STATE_CONTEXT_ENV } from './build/src/root-of-trust/state-manifest.mjs';
import { CommitCoordinator } from './build/src/root-of-trust/commit-barrier.mjs';
import { bootRoot, makeKeys } from '/tmp/wt-8c69e98-gpt/tests/helpers/wl-326-root.mjs';

const root = '/tmp/council-wl437-r3/gpt_6_1_sol/current-code-state';
mkdirSync(root, { recursive: true });
const env = {
  [STATE_PROVISION_ENV]: '1',
  [STATE_CONTEXT_ENV]: 'r3-review-only',
  [FNV_BIND_DECLARED_ENV]: '1',
};
const h = (x) => createHash('sha256').update(x).digest('hex');
const key = generateKeyPairSync('ed25519');
const sealer = {
  id: 'r3-software-review-only',
  signAsync: async data => sign(null, Buffer.from(JSON.stringify(data)), key.privateKey).toString('base64'),
  verify: (data, seal) => verify(null, Buffer.from(JSON.stringify(data)), key.publicKey, Buffer.from(seal, 'base64')),
};
const provision = { kingId: sealer.id, context: 'r3', tokenSerial: 'REVIEW', moduleSha256: h('software-fixture') };
const material = {
  counterIndex: '0x01800030', recordIndex: '0x01800031', base: '4',
  counterName: '000b' + h('C'), recordName: '000b' + h('R'),
  tpmIdentity: { kind: 'ek-certificate-sha256', value: h('certificate-fixture') },
  authPolicy: { counter: h('pc'), record: h('pr') },
};
const outcome = (r) => r.status === 'fulfilled'
  ? { status: r.status, base: r.value.freshnessBinding.base }
  : { status: r.status, code: r.reason.code, detail: r.reason.message };

{
  const m = new StateManifest(join(root, 'same-instance.json'), { env, sealer });
  await m.provisionAsync(provision, env);
  const result = await Promise.allSettled([m.bindFnvAsync(material, env), m.bindFnvAsync(material, env)]);
  console.log('SAME_INSTANCE_IDENTICAL', JSON.stringify(result.map(outcome)));
  const body = m.read();
  console.log('OWNER_DOCUMENT_NOT_PROVIDED', JSON.stringify({
    bindingPresent: Boolean(body.freshnessBinding),
    consumedFieldPresent: Object.keys(body).some(k => /consum/i.test(k)),
  }));
}
{
  const file = join(root, 'two-instances.json');
  const a = new StateManifest(file, { env, sealer });
  await a.provisionAsync(provision, env);
  const b = new StateManifest(file, { env, sealer });
  const result = await Promise.allSettled([
    a.bindFnvAsync(material, env),
    b.bindFnvAsync({ ...material, base: '9' }, env),
  ]);
  console.log('TWO_INSTANCES_DIFFERENT', JSON.stringify(result.map(outcome)));
  console.log('TWO_INSTANCES_FINAL', JSON.stringify({
    base: JSON.parse(readFileSync(file, 'utf8')).body.freshnessBinding.base,
  }));
}
{
  const gapRoot = join(root, 'binding-gap');
  mkdirSync(gapRoot, { recursive: true });
  const file = join(gapRoot, 'root-of-trust.manifest.json');
  const keys = makeKeys();
  let current = { epoch: 0n, anchor: 'genesis' };
  const socket = {
    stateBound: true, testFixture: true,
    read: async () => current,
    advanceState: async (_from, to) => { current = to; return current; },
    fnvBindingMaterial: async () => material,
    pinnedBinding: () => {
      try { return JSON.parse(readFileSync(file, 'utf8')).body.freshnessBinding ?? null; }
      catch { return null; }
    },
  };
  const gapEnv = { XUUX_FRESHNESS_BIND_DECLARED: '1' };
  const original = CommitCoordinator.prototype.bindAsync;
  CommitCoordinator.prototype.bindAsync = async () => {
    throw Object.assign(new Error('review-only failure before coordinator staging'), { code: 'R3_GAP_INJECTED' });
  };
  try {
    await bootRoot(gapRoot, keys, socket, { env: gapEnv });
  } catch (error) {
    console.log('GAP_FIRST_BOOT', JSON.stringify({ code: error.code }));
  } finally {
    CommitCoordinator.prototype.bindAsync = original;
  }
  const body = JSON.parse(readFileSync(file, 'utf8')).body;
  console.log('GAP_PERSISTED', JSON.stringify({
    version: body.version, bindingPresent: Boolean(body.freshnessBinding),
    epoch: body.freshnessEpoch, anchor: body.freshnessAnchor, staged: body.staged,
  }));
  try {
    const reopened = await bootRoot(gapRoot, keys, socket, { env: gapEnv });
    console.log('GAP_RESTART', JSON.stringify({ resumed: true }));
    reopened.root.dispose();
  } catch (error) {
    console.log('GAP_RESTART', JSON.stringify({ resumed: false, code: error.code, detail: error.detail }));
  }
}
