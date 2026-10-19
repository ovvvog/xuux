import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { startSim, killSim, stopSim, discoverSimPids } from '/tmp/wt-df435a95-gpt/tests/helpers/ceremony-swtpm.mjs';

const s = startSim({ prefix: 'wl420-no-python-', portBase: 7600, attempts: 1 });
const originalPath = process.env.PATH;
const originalKill = process.kill.bind(process);
let nonzeroSignals = 0;
try {
  process.env.PATH = '/tmp/council-wl420-gpt_6_1_sol/no-executables';
  process.kill = (pid, signal) => {
    if (signal !== 0) { nonzeroSignals++; throw new Error('numeric signal fallback forbidden'); }
    return originalKill(pid, signal);
  };
  const stopped = killSim(s.pid, { dir: s.dir, graceMs: 40 });
  console.log(JSON.stringify({ phase: 'without-python', pid: s.pid, dir: s.dir, stopped, nonzeroSignals, liveOwners: discoverSimPids(s.dir), dirExists: existsSync(s.dir) }));
  assert.equal(stopped, false);
  assert.equal(nonzeroSignals, 0);
  assert.ok(discoverSimPids(s.dir).includes(s.pid));
  assert.ok(existsSync(s.dir));
} finally {
  process.env.PATH = originalPath;
  process.kill = originalKill;
  const stopped = stopSim(s);
  console.log(JSON.stringify({ phase: 'cleanup', stopped, remainingOwners: discoverSimPids(s.dir) }));
  assert.equal(stopped, true);
}
