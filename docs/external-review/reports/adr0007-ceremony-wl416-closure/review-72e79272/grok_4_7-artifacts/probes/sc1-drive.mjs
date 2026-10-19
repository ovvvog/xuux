// Starts an isolated swtpm, runs sc1-run.ps1 against a caller-supplied core copy, then stops the sim.
import { spawnSync } from 'node:child_process';
import { startSim, stopSim } from '/tmp/wt-72e79272-grok/tests/helpers/ceremony-swtpm.mjs';

const core = process.argv[2];
const portBase = Number(process.argv[3] || 25100);
const helper = '/tmp/wt-72e79272-grok/tests/helpers/TpmCeremonyFaultTransport.cs';
const ps1 = '/tmp/council-wl422-grok_4_7/probes/sc1-run.ps1';
if (!core) {
  console.error('usage: sc1-drive.mjs <core.cs> [portBase]');
  process.exit(2);
}
const s = startSim({ prefix: 'xuux-wl422-sc1-', portBase, label: 'WL422-SC1', attempts: 2 });
let code = 1;
try {
  const r = spawnSync(
    'pwsh',
    ['-NoProfile', '-NonInteractive', '-File', ps1, '-Core', core, '-Helper', helper, '-Port', String(s.port)],
    { encoding: 'utf8', maxBuffer: 64 << 20 },
  );
  process.stdout.write(r.stdout || '');
  process.stderr.write(r.stderr || '');
  code = r.status === null ? 1 : r.status;
  console.log(JSON.stringify({ simPort: s.port, simPid: s.pid, pwshStatus: r.status }));
} finally {
  const stopped = stopSim(s);
  console.log(JSON.stringify({ stopSim: stopped }));
  if (!stopped) code = code || 1;
}
process.exit(code);
