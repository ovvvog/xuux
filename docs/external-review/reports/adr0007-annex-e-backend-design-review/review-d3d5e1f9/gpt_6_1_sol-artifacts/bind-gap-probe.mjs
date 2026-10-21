import { readFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { bootRoot, makeKeys } from '/tmp/wt-d3d5e1f9-gpt/tests/helpers/wl-326-root.mjs';
import { CommitCoordinator } from './build/src/root-of-trust/commit-barrier.mjs';
const root = '/tmp/council-wl437/gpt_6_1_sol/bind-gap-state';
mkdirSync(root, { recursive: true });
const file = join(root, 'root-of-trust.manifest.json');
const keys = makeKeys();
const hash = x => createHash('sha256').update(x).digest('hex');
const material = {
  counterIndex: '0x01800030', recordIndex: '0x01800031',
  counterName: '000b' + hash('C'), recordName: '000b' + hash('R'), base: '7',
  tpmIdentity: { kind: 'ek-certificate-sha256', value: hash('cert') },
  authPolicy: { counter: hash('pc'), record: hash('pr') },
};
let current = { epoch: 0n, anchor: 'genesis' };
const socket = {
  stateBound: true, testFixture: true,
  read: async () => current,
  advanceState: async (from, to) => { current = to; return current; },
  fnvBindingMaterial: async () => material,
  pinnedBinding: () => { try { return JSON.parse(readFileSync(file, 'utf8')).body.freshnessBinding ?? null; } catch { return null; } },
};
const env = { XUUX_FRESHNESS_BIND_DECLARED: '1' };
const original = CommitCoordinator.prototype.bindAsync;
CommitCoordinator.prototype.bindAsync = async () => { throw Object.assign(new Error('Injected stop before coordinator.bindAsync stages'), { code: 'PROBE_GAP' }); };
try {
  await bootRoot(root, keys, socket, { env });
} catch (e) {
  console.log('FIRST_BOOT_INJECTED_STOP', JSON.stringify({ code: e.code }));
} finally {
  CommitCoordinator.prototype.bindAsync = original;
}
const body = JSON.parse(readFileSync(file, 'utf8')).body;
console.log('ON_DISK_AFTER_STOP', JSON.stringify({ version: body.version, bindingPresent: !!body.freshnessBinding, staged: body.staged ?? null, freshnessAnchor: body.freshnessAnchor ?? null, stateDigest: body.stateDigest ?? null, freshnessEpoch: body.freshnessEpoch }));
try {
  const reopened = await bootRoot(root, keys, socket, { env });
  console.log('RESTART', JSON.stringify({ resumed: true }));
  reopened.root.dispose();
} catch (e) {
  console.log('RESTART', JSON.stringify({ resumed: false, code: e.code, detail: e.detail }));
}
