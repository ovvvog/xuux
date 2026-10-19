import { readdirSync, readFileSync } from 'node:fs';
import { killSim } from '/tmp/wt-df435a95-gpt/tests/helpers/ceremony-swtpm.mjs';
const base = '/tmp/council-wl420-gpt_6_1_sol/';
let failed = false;
for (const entry of readdirSync('/proc')) {
  if (!/^\d+$/.test(entry)) continue;
  let argv;
  try { argv = readFileSync(`/proc/${entry}/cmdline`, 'utf8').split('\0').filter(Boolean); } catch { continue; }
  if (!argv[0]?.includes('swtpm')) continue;
  const j = argv.indexOf('--tpmstate');
  if (j < 0 || !argv[j + 1]?.startsWith(`dir=${base}`)) continue;
  const dir = argv[j + 1].slice(4);
  const stopped = killSim(Number(entry), { dir });
  console.log(JSON.stringify({ pid: Number(entry), dir, stopped, directoryIntentionallyRetained: true }));
  if (!stopped) failed = true;
}
process.exitCode = failed ? 1 : 0;
