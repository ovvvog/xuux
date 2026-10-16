import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const root = '/home/user/workspace/xuux-review-a76c8478';
const base = '/home/user/workspace/council-adr0007/gpt_6_1_sol';
const harness = path.join(base, 'harness');
fs.mkdirSync(path.join(harness, 'tests'), { recursive: true });
fs.mkdirSync(path.join(harness, 'scripts'), { recursive: true });
fs.mkdirSync(path.join(base, 'logs'), { recursive: true });
fs.mkdirSync(path.join(base, 'runtime'), { recursive: true });
for (const dir of ['sim', 'tests/sim']) {
  fs.cpSync(path.join(root, dir), path.join(harness, dir), { recursive: true });
}
const digest = (file) => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const copied = [];
function inventory(dir) {
  for (const e of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) inventory(p);
    else if (fs.existsSync(path.join(harness, p))) copied.push({ path: p, original: digest(path.join(root, p)), copy: digest(path.join(harness, p)) });
  }
}
inventory('sim'); inventory('tests/sim');
fs.writeFileSync(path.join(base, 'copy-hashes.json'), JSON.stringify(copied, null, 2));
const script = fs.readFileSync(path.join(root, 'scripts/tpm-sim-ci.sh'), 'utf8')
  .replace('readonly PORT=2321', 'readonly PORT=29311')
  .replace('readonly CTRL=2322', 'readonly CTRL=29312')
  .replace('  rm -rf "${state_dir}" sim/tpm/_tear sim/tpm/_replay sim/tpm/_snap sim/tpm/_sovereign || true', '  printf "EVIDENCE_STATE %s\\n" "${state_dir}"');
fs.writeFileSync(path.join(harness, 'scripts/tpm-sim-ci-isolated.sh'), script);
const record = [];
function run(id, command, args, opts = {}) {
  const start = new Date().toISOString();
  const r = spawnSync(command, args, { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, ...opts });
  fs.writeFileSync(path.join(base, `logs/${id}.stdout.txt`), r.stdout ?? '');
  fs.writeFileSync(path.join(base, `logs/${id}.stderr.txt`), r.stderr ?? '');
  const row = { id, command: [command, ...args], cwd: opts.cwd ?? root, start, end: new Date().toISOString(), exit: r.status, signal: r.signal, error: r.error?.message ?? null };
  record.push(row);
  fs.writeFileSync(path.join(base, 'command-ledger.json'), JSON.stringify(record, null, 2));
  console.log(JSON.stringify(row));
  console.log(r.stdout ?? ''); console.error(r.stderr ?? '');
  return r;
}
run('identity', 'bash', ['-c', 'git rev-parse HEAD; git status --porcelain=v1; date -u +%Y-%m-%dT%H:%M:%SZ; node --version; npm --version; swtpm --version; tpm2 --version; uname -srmo; command -v pwsh || true; command -v docker || true']);
run('sim-suite', 'bash', ['scripts/tpm-sim-ci-isolated.sh'], {
  cwd: harness,
  env: { ...process.env, RUNNER_TEMP: path.join(base, 'runtime'), XUUX_CHANNEL_POC: '1' },
  timeout: 180000,
});
run('independent-probes', 'bash', [path.join(base, 'run-probes.sh')], { cwd: base, timeout: 180000 });
run('final-tree-status', 'bash', ['-c', 'git rev-parse HEAD; git status --porcelain=v1; git diff --exit-code; git diff --cached --exit-code; date -u +%Y-%m-%dT%H:%M:%SZ']);
