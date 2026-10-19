import { readdirSync, readFileSync } from 'node:fs';
const base = '/tmp/council-wl420-gpt_6_1_sol/';
let count = 0;
for (const entry of readdirSync('/proc')) {
  if (!/^\d+$/.test(entry)) continue;
  try {
    const argv = readFileSync(`/proc/${entry}/cmdline`, 'utf8').split('\0').filter(Boolean);
    if (!argv[0]?.includes('swtpm')) continue;
    const j = argv.indexOf('--tpmstate');
    if (j < 0 || !argv[j + 1]?.startsWith(`dir=${base}`)) continue;
    count++;
    console.log(JSON.stringify({ pid: Number(entry), argv }));
  } catch { /* exited between directory read and cmdline read */ }
}
console.log(`own_state_dir_owners=${count}`);
