import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { startSim, stopSim } from '/tmp/wt-df435a95-gpt/tests/helpers/ceremony-swtpm.mjs';

const mode = process.argv[2];
assert.ok(mode);
const s = startSim({ prefix: `wl420-detail-${mode}-`, portBase: 7600, attempts: 1 });
console.error(JSON.stringify({ mode, simulator: s }));
try {
  const r = spawnSync('pwsh', [
    '-NoProfile', '-NonInteractive', '-File',
    process.env.WL420_FAULT_HARNESS || '/tmp/wt-df435a95-gpt/tests/helpers/tpm-ceremony-harness.ps1',
    '-SimPort', String(s.port), '-Mode', 'fault', '-Fault', mode,
  ], { encoding: 'utf8', maxBuffer: 64 << 20 });
  process.stdout.write(r.stdout || '');
  process.stderr.write(r.stderr || '');
  assert.equal(r.status, 0);
  const o = JSON.parse(r.stdout);
  const changing = new Set(['0x0000012a', '0x00000134', '0x00000122', '0x00000131', '0x00000153', '0x00000157', '0x00000176', '0x00000160', '0x0000016c', '0x00000165']);
  console.error(JSON.stringify({
    mode, status: o.report.status, failure: o.report.failure,
    changes: o.fault.changes, stateChangingSteps: o.report.steps.filter(x => changing.has(x.commandCode)).map(x => ({ name: x.name, commandCode: x.commandCode, stage: x.stage })),
    nvAfter: o.nvAfter,
  }));
  if (mode === 'nv-appear-late') {
    assert.equal(o.report.steps.filter(x => changing.has(x.commandCode)).length, 0);
    assert.doesNotMatch(o.report.failure, /state-changing commands were already sent/, 'the first mutating command has not been sent');
  }
} finally {
  const stopped = stopSim(s);
  console.error(JSON.stringify({ mode, stopped }));
  assert.equal(stopped, true);
}
