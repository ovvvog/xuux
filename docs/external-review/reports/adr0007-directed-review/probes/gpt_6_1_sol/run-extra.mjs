import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
const base = '/home/user/workspace/council-adr0007/gpt_6_1_sol';
const rows = [];
function run(id, cmd, args, cwd) {
  const start = new Date().toISOString();
  const r = spawnSync(cmd, args, { cwd, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, timeout: 120000, env: { ...process.env, TMPDIR: path.join(base, 'runtime') } });
  fs.writeFileSync(path.join(base, `logs/${id}.stdout.txt`), r.stdout ?? '');
  fs.writeFileSync(path.join(base, `logs/${id}.stderr.txt`), r.stderr ?? '');
  const row = { id, command: [cmd, ...args], cwd, start, end: new Date().toISOString(), exit: r.status, signal: r.signal, error: r.error?.message ?? null };
  rows.push(row);
  fs.writeFileSync(path.join(base, 'extra-command-ledger.json'), JSON.stringify(rows, null, 2));
  console.log(JSON.stringify(row));
  console.log(r.stdout ?? '');
  console.error(r.stderr ?? '');
}
run('real-nv-certify-simulator', 'bash', [path.join(base, 'run-nv-certify.sh')], base);
