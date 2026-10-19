import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
const root = '/tmp/council-wl422-gpt_6_1_sol';
const [name, cwd, cmd, ...args] = process.argv.slice(2);
if (!/^\d\d-[a-z0-9-]+$/.test(name) || !cmd) throw new Error('usage: record.mjs NN-name cwd cmd args...');
const quote = s => "'" + s.replaceAll("'", "'\\''") + "'";
const start = new Date().toISOString();
fs.writeFileSync(path.join(root, name+'.command.txt'),
  `# start UTC: ${start}\ncd ${quote(cwd)} && ${[cmd,...args].map(quote).join(' ')}\n`);
const r = spawnSync(cmd, args, {cwd, env: process.env, encoding:'utf8', maxBuffer: 64*1024*1024});
if (r.stdout?.length) fs.writeFileSync(path.join(root,name+'.stdout.txt'),r.stdout);
if (r.stderr?.length) fs.writeFileSync(path.join(root,name+'.stderr.txt'),r.stderr);
const code = r.status ?? `signal=${r.signal}; error=${r.error}`;
fs.writeFileSync(path.join(root,name+'.exit.txt'),`${code}\n# end UTC: ${new Date().toISOString()}\n`);
process.stdout.write(r.stdout ?? '');
process.stderr.write(r.stderr ?? '');
console.log(`\nRECORDED ${name} exit=${code}`);
process.exitCode = typeof code === 'number' ? code : 1;
