import { readdirSync, readFileSync } from 'node:fs';
const prefix = process.argv[2] || '';
let owners = 0;
let anySwtpm = 0;
let zombies = 0;
for (const e of readdirSync('/proc')) {
  if (!/^\d+$/.test(e)) continue;
  const pid = Number(e);
  if (pid <= 1) continue;
  let stat = '';
  try {
    const s = readFileSync(`/proc/${pid}/stat`, 'utf8');
    stat = s.slice(s.lastIndexOf(')') + 2).split(' ')[0];
  } catch { continue; }
  if (stat === 'Z') zombies++;
  let argv = null;
  try { argv = readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0').filter(Boolean); } catch { argv = null; }
  if (!argv || !argv[0] || !argv[0].includes('swtpm')) continue;
  anySwtpm++;
  const j = argv.indexOf('--tpmstate');
  const dirArg = j >= 0 ? argv[j + 1] : '';
  if (!prefix || (dirArg && dirArg.startsWith('dir=' + prefix))) {
    owners++;
    console.log(JSON.stringify({ pid, stat, dirArg, argv0: argv[0] }));
  }
}
console.log(JSON.stringify({ prefix, matching_owners: owners, any_swtpm: anySwtpm, system_zombies: zombies }));
