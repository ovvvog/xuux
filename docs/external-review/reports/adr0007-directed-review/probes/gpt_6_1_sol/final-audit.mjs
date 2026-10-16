import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
const base = '/home/user/workspace/council-adr0007/gpt_6_1_sol';
const root = '/home/user/workspace/xuux-review-a76c8478';
const s = fs.readFileSync(path.join(base, 'report.md'), 'utf8');
const targets = [...s.matchAll(/\]\(([^)]+)\)/g)].map((m) => m[1]);
const missing = targets.filter((u) => !/^https:\/\//.test(u) && !fs.existsSync(path.resolve(base, u)));
const copies = JSON.parse(fs.readFileSync(path.join(base, 'copy-hashes.json'), 'utf8'));
const commands = [
  ['rev-parse', 'HEAD'],
  ['status', '--porcelain=v1'],
  ['diff', '--exit-code'],
  ['diff', '--cached', '--exit-code'],
].map((args) => {
  const r = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  return { argv: ['git', ...args], cwd: root, exit: r.status, stdout: r.stdout, stderr: r.stderr };
});
const result = {
  time: new Date().toISOString(),
  reportPath: path.join(base, 'report.md'),
  sourceLinks: targets.length,
  missing,
  copiedFiles: copies.length,
  differingCopies: copies.filter((x) => x.original !== x.copy),
  commands,
};
fs.writeFileSync(path.join(base, 'final-audit.json'), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
if (missing.length || result.differingCopies.length || commands.some((r) => r.exit !== 0)) process.exitCode = 1;
