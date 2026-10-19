// WL-421 — عدُّ عمليّاتِ swtpm الحيّةِ التي يقعُ مسارُ حالتِها تحتَ بادئةٍ (قراءةُ /proc فقط).
import { readdirSync, readFileSync } from 'node:fs';
const prefix = process.argv[2];
if (!prefix) throw new Error('usage: list-swtpm-orphans.mjs <state-dir-prefix>');
let n = 0;
for (const e of readdirSync('/proc')) {
  if (!/^\d+$/.test(e)) continue;
  try {
    const argv = readFileSync(`/proc/${e}/cmdline`, 'utf8').split('\0').filter(Boolean);
    if (!argv[0]?.includes('swtpm')) continue;
    const j = argv.indexOf('--tpmstate');
    if (j < 0 || !argv[j + 1]?.startsWith('dir=' + prefix)) continue;
    n++;
    console.log(JSON.stringify({ pid: Number(e), argv }));
  } catch { /* exited */ }
}
console.log('orphan_swtpm_owners=' + n);
