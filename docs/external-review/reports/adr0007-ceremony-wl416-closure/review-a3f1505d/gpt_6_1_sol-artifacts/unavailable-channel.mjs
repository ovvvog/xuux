import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import {
  startSim, stopSim, killSim,
} from '/home/user/workspace/xuux-review-a3f1505d/tests/helpers/ceremony-swtpm.mjs';

const path = process.env.PATH;
let retained = null;
let launched = null;
let error = null;
const originalKill = process.kill;
let nonzeroSignals = 0;
try {
  process.kill = (pid, signal) => {
    if (signal !== 0) {
      nonzeroSignals++;
      throw new Error('numeric signal fallback forbidden');
    }
    return originalKill.call(process, pid, signal);
  };
  try {
    startSim({
      portBase: 7600, prefix: 'independent-no-python-', attempts: 1,
      readyTries: 1, probe: () => false,
      afterSpawn: (s) => {
        launched = s;
        process.env.PATH = '/tmp/council-wl418-gpt_6_1_sol/absent-bin';
      },
      onAbandon: (s) => { retained = s; },
    });
  } catch (e) { error = e; }
  assert.match(error?.message ?? '', /not proven stopped/);
  assert.equal(retained.stopped, false);
  assert.equal(existsSync(retained.dir), true);
  originalKill.call(process, launched.pid, 0);
  assert.equal(nonzeroSignals, 0);
  assert.equal(killSim(0, { dir: retained.dir }), false);
  console.log(JSON.stringify({
    channelUnavailable: true, stopped: retained.stopped,
    stateDirKept: existsSync(retained.dir), intendedProcessStillExists: true,
    numericSignalFallbackCount: nonzeroSignals,
  }));
} finally {
  process.env.PATH = path;
  process.kill = originalKill;
  if (launched) {
    assert.equal(stopSim({ pid: launched.pid, dir: launched.dir }), true);
    console.log('normal-channel-cleanup=true stateDirExists=' + existsSync(launched.dir));
  }
}
