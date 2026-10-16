import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import * as tpm from '/home/user/workspace/xuux-review-a76c8478/sim/tpm/tpm_client.mjs';
import { FreshnessAnchorSim, snapshotState, restoreState } from '/home/user/workspace/xuux-review-a76c8478/sim/tpm/manifest_seal_sim.mjs';
import { frame, parseMessage } from '/home/user/workspace/xuux-review-a76c8478/sim/tpm/channel_protocol.mjs';

const base = '/home/user/workspace/council-adr0007/gpt_6_1_sol';
const results = [];
const json = (f, x) => fs.writeFileSync(f, JSON.stringify(x, null, 2));
const preserve = (a, label) => {
  const dest = path.join(base, 'probe-artifacts', label);
  fs.mkdirSync(dest, { recursive: true });
  fs.cpSync(a.dir, dest, { recursive: true });
};
async function setup(label, index) {
  const r = await tpm.nvDefineCounter(index);
  assert.equal(r.rc, 0, r.stderr);
  const a = new FreshnessAnchorSim(path.join(base, 'probe-state', label), tpm, 'ak-' + label, 'nv-' + label, index);
  await a.provision('inst-' + label);
  assert.equal((await a.seal()).ok, true);
  return a;
}
async function probe(id, fn) {
  try {
    const data = await fn();
    results.push({ id, ...data });
  } catch (e) {
    results.push({ id, error: String(e), stack: e.stack });
    process.exitCode = 1;
  }
  json(path.join(base, 'probe-results.json'), results);
  console.log(JSON.stringify(results.at(-1)));
}

await probe('P01-historical-staged-snapshot-lifts-acknowledged-halt', async () => {
  const a = await setup('historical-staged', '0x1500061');
  const initial = a.readManifest();
  const snap = path.join(base, 'probe-artifacts', 'P01-snapshot-before-increment');
  let interrupted = false;
  try {
    await a.seal({ beforeIncrement() {
      snapshotState(a.dir, snap);
      throw new Error('INTERRUPT_BEFORE_INCREMENT');
    } });
  } catch (e) { interrupted = /INTERRUPT_BEFORE_INCREMENT/.test(e.message); }
  assert.equal(interrupted, true);
  const discard = await a.recover();
  assert.equal(discard.state, 'running');
  const haltAck = await a.haltSovereign('owner-order-after-abandoned-candidate');
  assert.equal(haltAck.ok, true);
  const haltedBody = a.readManifest();
  preserve(a, 'P01-acknowledged-halt');
  const actualCounter = await a.readCounter();
  restoreState(snap, a.dir);
  preserve(a, 'P01-restored-historical-candidate');
  const result = await a.recover();
  const after = a.readManifest();
  preserve(a, 'P01-after-recovery');
  assert.equal(actualCounter, haltedBody.tpm.counter);
  assert.equal(result.state, 'running');
  assert.notEqual(after.halted, true);
  return {
    layer: 'unchanged simulator logic with live swtpm counter',
    initialCounter: initial.tpm.counter,
    discard,
    haltAck,
    haltedBody: { sequence: haltedBody.sequence, counter: haltedBody.tpm.counter, halted: haltedBody.halted, haltEpoch: haltedBody.haltEpoch },
    physicalCounterBeforeRestore: actualCounter,
    physicalCounterAfterRecovery: await a.readCounter(),
    result,
    recoveredBody: { sequence: after.sequence, counter: after.tpm.counter, halted: after.halted ?? false, haltEpoch: after.haltEpoch },
  };
});

await probe('P02-replayed-read-with-genuine-old-certificate', async () => {
  const a = await setup('replayed-read', '0x1500062');
  const snap = path.join(base, 'probe-artifacts', 'P02-old-state');
  const oldCounter = await a.readCounter();
  snapshotState(a.dir, snap);
  assert.equal((await a.haltSovereign('owner-order')).ok, true);
  const physical = await a.readCounter();
  restoreState(snap, a.dir);
  a.tpm = {
    nvReadCounter: async () => ({ rc: 0, counter: oldCounter }),
    nvIncrement: (...args) => tpm.nvIncrement(...args),
  };
  const viaReplayedRead = await a.recover();
  a.tpm = tpm;
  const viaLiveRead = await a.recover();
  assert.equal(viaReplayedRead.state, 'running');
  assert.equal(viaLiveRead.state, 'halted');
  return { layer: 'read-response fault injection, genuine existing simulated signature', oldCounter, physical, viaReplayedRead, viaLiveRead };
});

await probe('P03-new-object-with-same-pinned-names', async () => {
  const a = await setup('restart-ak', '0x1500063');
  const sameObject = await a.recover();
  const b = new FreshnessAnchorSim(a.dir, tpm, a.akName, a.nvIndexName, a.nvIndex);
  const newObject = await b.recover();
  assert.equal(sameObject.state, 'running');
  assert.equal(newObject.error, 'STATE_TPM_ATTEST_INVALID');
  return { sameObject, newObject };
});

await probe('P04-preincrement-staged-skips-invalid-committed-attestation', async () => {
  const a = await setup('invalid-committed', '0x1500064');
  const old = a.readManifest();
  old.tpm.certify.signature = '00'.repeat(64);
  json(a.manifestPath(), old);
  const rejectedWithoutStaged = await a.recover();
  json(a.haltPath(), { state: 'running', epoch: 0 });
  json(a.stagedPath(), { ...old, sequence: old.sequence + 1, tpm: { ...old.tpm, counter: old.tpm.counter + 1, certify: null } });
  const acceptedWithStaged = await a.recover();
  assert.equal(rejectedWithoutStaged.error, 'STATE_TPM_ATTEST_INVALID');
  assert.equal(acceptedWithStaged.state, 'running');
  preserve(a, 'P04-after-recovery');
  return { layer: 'simulated verification branch only; no HSM seal modeled', rejectedWithoutStaged, acceptedWithStaged };
});

await probe('P05-parallel-seals-with-deterministic-increment-barrier', async () => {
  const a = await setup('parallel-seals', '0x1500065');
  let queued = 0;
  let release;
  const gate = new Promise((r) => { release = r; });
  a.tpm = {
    nvReadCounter: (...args) => tpm.nvReadCounter(...args),
    nvIncrement: async (...args) => {
      const r = await tpm.nvIncrement(...args);
      queued++;
      if (queued === 2) release();
      await gate;
      return r;
    },
  };
  const initial = a.readManifest().tpm.counter;
  const seals = await Promise.all([a.seal(), a.seal()]);
  const recovery = await a.recover();
  assert.equal(seals.every((r) => !r.ok), true);
  assert.equal(recovery.state, 'halted');
  preserve(a, 'P05-after-parallel-seals');
  return { layer: 'live swtpm increments, scheduling barrier only', initial, physical: await a.readCounter(), seals, recovery };
});

await probe('P06-tcp-identical-frame-on-new-connection', async () => {
  const responder = '/home/user/workspace/xuux-review-a76c8478/sim/channel/tcp_responder.mjs';
  const child = spawn(process.execPath, [responder, '--port', '29331', '--lifetime-ms', '12000', '--kill-file', path.join(base, 'runtime/channel-kill')], { env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '', stderr = '';
  child.stdout.on('data', (d) => { stdout += d; });
  child.stderr.on('data', (d) => { stderr += d; });
  try {
    await new Promise((resolve, reject) => {
      child.stdout.on('data', () => { if (stdout.includes('POC_' + 'READY')) resolve(); });
      child.once('exit', (code) => reject(new Error('responder exit ' + code)));
      setTimeout(() => reject(new Error('listener startup timeout')), 4000).unref();
    });
    const bytes = frame(Buffer.from('same-request'), 1);
    const send = async () => {
      const s = net.connect(29331, '127.0.0.1');
      await once(s, 'connect');
      s.write(bytes);
      const [response] = await once(s, 'data');
      const p = parseMessage(response);
      s.destroy();
      return { ok: p.ok, counter: p.counter, payload: p.payload?.toString() };
    };
    const first = await send(), second = await send();
    assert.equal(first.ok, true);
    assert.equal(second.ok, true);
    return { first, second, sameWireBytes: bytes.toString('hex') };
  } finally {
    child.kill('SIGTERM');
    await once(child, 'exit');
    fs.writeFileSync(path.join(base, 'logs/P06-responder.stdout.txt'), stdout);
    fs.writeFileSync(path.join(base, 'logs/P06-responder.stderr.txt'), stderr);
  }
});

await probe('P07-nv-name-before-and-after-first-increment', async () => {
  const index = '0x1500066';
  assert.equal((await tpm.nvDefineCounter(index)).rc, 0);
  const before = await tpm.nvReadPublic(index);
  assert.equal((await tpm.nvIncrement(index)).rc, 0);
  const after = await tpm.nvReadPublic(index);
  fs.writeFileSync(path.join(base, 'logs/P07-name-before.txt'), before.stdout);
  fs.writeFileSync(path.join(base, 'logs/P07-name-after.txt'), after.stdout);
  return { before, after };
});
