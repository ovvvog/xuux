// يطبع نص فشل الحاجز لأوضاع الظهور قبل أي أمر مغيّر وبعده. لا يعدل شجرة المراجعة.
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { startSim, stopSim, discoverSimPids } from '/tmp/wt-df435a95-grok/tests/helpers/ceremony-swtpm.mjs';

const harness = '/tmp/wt-df435a95-grok/tests/helpers/tpm-ceremony-harness.ps1';
const modes = ['nv-appear-midrun', 'nv-appear-late', 'nv-appear-after-define', 'nv-appear-after-primary', 'nv-preseed-unattributable'];
const lines = [];
let base = 7780;
for (const mode of modes) {
  const s = startSim({
    prefix: 'xuux-wl420-nvtext-',
    portBase: base,
    label: 'WL420-nvtext',
    attempts: 1,
    readyTries: 8,
    readyDelayMs: 200,
  });
  base += 2;
  const r = spawnSync(
    'pwsh',
    ['-NoProfile', '-NonInteractive', '-File', harness, '-SimPort', String(s.port), '-Mode', 'fault', '-Fault', mode],
    { encoding: 'utf8', maxBuffer: 64 << 20 },
  );
  let failure = 'HARNESS_STATUS_' + r.status;
  let stateChanging = [];
  let steps = [];
  if (r.status === 0) {
    const o = JSON.parse(r.stdout);
    failure = o.report && o.report.failure ? o.report.failure : 'null';
    steps = (o.report && o.report.steps) || [];
    const changing = new Set(['0x0000012a', '0x00000134', '0x00000122', '0x00000131', '0x00000153', '0x00000157', '0x00000176', '0x00000160', '0x0000016c', '0x00000165']);
    stateChanging = steps.filter((x) => changing.has(String(x.commandCode).toLowerCase())).map((x) => x.stage + ':' + x.name + ':' + x.commandCode);
  } else {
    failure = (r.stderr || r.stdout || '').slice(0, 500);
  }
  const st = stopSim(s);
  const left = discoverSimPids(s.dir);
  lines.push('MODE=' + mode);
  lines.push('port=' + s.port + ' harness_exit=' + r.status + ' stopSim=' + st + ' ownersLeft=' + JSON.stringify(left));
  lines.push('FAILURE=' + failure);
  lines.push('STATE_CHANGING_STEPS=' + JSON.stringify(stateChanging));
  lines.push('---');
  console.log(lines[lines.length - 5]);
  console.log(lines[lines.length - 3]);
}
writeFileSync('/tmp/council-wl420-grok_4_7/logs/nv-failure-text.log', lines.join('\n') + '\n');
