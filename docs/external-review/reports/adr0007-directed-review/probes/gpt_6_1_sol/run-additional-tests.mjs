import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { generateKeyPairSync, sign, verify, createHash } from 'node:crypto';
import { frame, parseMessage } from '/home/user/workspace/xuux-review-a76c8478/sim/tpm/channel_protocol.mjs';
import assert from 'node:assert/strict';
const root = '/home/user/workspace/xuux-review-a76c8478';
const base = '/home/user/workspace/council-adr0007/gpt_6_1_sol';
const rows = [];
function run(id, cmd, args) {
  const start = new Date().toISOString();
  const r = spawnSync(cmd, args, { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, timeout: 120000, env: { ...process.env, TMPDIR: path.join(base, 'runtime') } });
  fs.writeFileSync(path.join(base, `logs/${id}.stdout.txt`), r.stdout ?? '');
  fs.writeFileSync(path.join(base, `logs/${id}.stderr.txt`), r.stderr ?? '');
  rows.push({ id, command: [cmd, ...args], cwd: root, start, end: new Date().toISOString(), exit: r.status, signal: r.signal, error: r.error?.message ?? null });
  fs.writeFileSync(path.join(base, 'additional-command-ledger.json'), JSON.stringify(rows, null, 2));
  console.log(JSON.stringify(rows.at(-1)));
  const summary = (r.stdout ?? '').split('\n').filter((l) => /^# (tests|pass|fail|skipped|todo)|PROBE_RESULT|^not ok/.test(l));
  console.log(summary.join('\n'));
  console.error(r.stderr ?? '');
}
run('root-freshness-tests', process.execPath, ['--test', '--test-concurrency=1', 'tests/root-of-trust/replay-limit.test.mjs', 'tests/root-of-trust/freshness-socket.test.mjs', 'tests/root-of-trust/wl-326-commit-barrier.test.mjs']);
run('vsock-local-capability', 'python3', [path.join(base, 'harness/sim/channel/vsock_probe_wsl.py')]);

const read = (f) => JSON.parse(fs.readFileSync(path.join(base, f), 'utf8'));
const stagedA = read('probe-artifacts/P01-snapshot-before-increment/root-of-trust.manifest.staged.json');
const haltedB = read('probe-artifacts/P01-acknowledged-halt/root-of-trust.manifest.json');
const pair = generateKeyPairSync('ed25519');
const payloadA = Buffer.from(JSON.stringify(stagedA));
const payloadB = Buffer.from(JSON.stringify(haltedB));
const sigA = sign(null, payloadA, pair.privateKey);
const sigB = sign(null, payloadB, pair.privateKey);
const signatureModel = {
  id: 'P09-independent-stateless-signature-model',
  scope: 'software Ed25519 fixture only, not HSM execution',
  aCounter: stagedA.tpm.counter,
  bCounter: haltedB.tpm.counter,
  aDigest: createHash('sha256').update(payloadA).digest('hex'),
  bDigest: createHash('sha256').update(payloadB).digest('hex'),
  originalASignatureStillValid: verify(null, payloadA, pair.publicKey, sigA),
  bSignatureValid: verify(null, payloadB, pair.publicKey, sigB),
  aHalted: stagedA.halted ?? false,
  bHalted: haltedB.halted,
};
assert.equal(signatureModel.aCounter, signatureModel.bCounter);
assert.notEqual(signatureModel.aDigest, signatureModel.bDigest);
assert.equal(signatureModel.originalASignatureStillValid, true);
assert.equal(signatureModel.bSignatureValid, true);
fs.writeFileSync(path.join(base, 'signature-model.json'), JSON.stringify(signatureModel, null, 2));
console.log(JSON.stringify(signatureModel));

const a = 9007199254740992n, b = a + 1n;
const precision = {
  id: 'P10-uint64-wire-number-alias',
  a: a.toString(), b: b.toString(),
  parsedA: parseMessage(frame(Buffer.from('a'), a)).counter,
  parsedB: parseMessage(frame(Buffer.from('b'), b)).counter,
};
assert.equal(precision.parsedA, precision.parsedB);
fs.writeFileSync(path.join(base, 'precision-model.json'), JSON.stringify(precision, null, 2));
console.log(JSON.stringify(precision));
run('tree-status-after-all-execution', 'bash', ['-c', 'git rev-parse HEAD && git status --porcelain=v1 && git diff --exit-code && git diff --cached --exit-code; date -u +%Y-%m-%dT%H:%M:%SZ']);
