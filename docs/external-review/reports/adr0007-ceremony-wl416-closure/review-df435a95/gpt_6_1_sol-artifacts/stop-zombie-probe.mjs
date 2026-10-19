import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { once } from 'node:events';
import { stopSim, terminateAttempt, discoverSimPids } from '/tmp/wt-df435a95-gpt/tests/helpers/ceremony-swtpm.mjs';

const dir = mkdtempSync('/tmp/council-wl420-gpt_6_1_sol/stop-zombie-');
const pidFile = join(dir, 'swtpm.pid');
const port = 7686;
const child = spawn('swtpm', [
  'socket', '--tpm2', '--tpmstate', `dir=${dir}`,
  '--server', `type=tcp,port=${port},bindaddr=127.0.0.1`,
  '--ctrl', `type=tcp,port=${port + 1},bindaddr=127.0.0.1`,
  '--flags', 'not-need-init,startup-clear', '--pid', `file=${pidFile}`,
], { stdio: 'ignore' });
const exited = once(child, 'exit');
let sent = false;
try {
  let responsive = false;
  for (let i = 0; i < 100; i++) {
    const p = spawnSync('tpm2_getcap', [`--tcti=swtpm:host=127.0.0.1,port=${port}`, 'properties-fixed'], { stdio: 'ignore' });
    if (p.status === 0) { responsive = true; break; }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
  }
  assert.ok(responsive, 'real swtpm responds');
  assert.ok(discoverSimPids(dir).includes(child.pid), 'ownership initially established');
  console.log(JSON.stringify({ phase: 'live', dir, ownerPid: child.pid, argv: readFileSync(`/proc/${child.pid}/cmdline`, 'utf8').split('\0') }));
  // The witness has an owned ChildProcess handle; the event loop deliberately
  // has not run waitpid yet. SIGKILL cannot remove its zombie /proc entry.
  child.kill('SIGKILL');
  sent = true;
  let state = null;
  for (let i = 0; i < 100; i++) {
    const stat = readFileSync(`/proc/${child.pid}/stat`, 'utf8');
    state = stat.slice(stat.lastIndexOf(')') + 2).split(' ')[0];
    if (state === 'Z') break;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
  }
  assert.equal(state, 'Z', 'owned real simulator remains a zombie');
  const before = terminateAttempt({ pidFile, dir });
  console.log(JSON.stringify({ phase: 'pre-stop', actualOwnerState: state, pidStillExists: process.kill(child.pid, 0), scanOwners: discoverSimPids(dir), terminateAttempt: before, stateDirExists: existsSync(dir) }));
  const stopped = stopSim({ pid: 2147483000, dir, pidFile });
  console.log(JSON.stringify({ phase: 'post-stop', suppliedPid: 2147483000, stopSimReturned: stopped, actualOwnerStillExists: process.kill(child.pid, 0), actualOwnerState: state, stateDirExists: existsSync(dir) }));
  assert.equal(stopped, false, 'a stale pid plus an unattributable zombie must not prove termination');
} finally {
  if (!sent && child.pid) child.kill('SIGKILL');
  await exited;
  let absent = false;
  try { process.kill(child.pid, 0); } catch (e) { absent = e.code === 'ESRCH'; }
  console.log(JSON.stringify({ phase: 'cleanup', actualOwnerPid: child.pid, absentByESRCH: absent, directoryRetained: existsSync(dir) }));
  assert.ok(absent, 'witness reaps its own swtpm');
}
