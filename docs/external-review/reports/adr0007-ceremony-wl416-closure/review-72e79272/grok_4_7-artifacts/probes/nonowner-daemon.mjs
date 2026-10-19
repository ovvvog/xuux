// Delivered pid is a live non-owner; the simulator is the daemon started by startSim.
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';
import { startSim, stopSim, killSim, discoverSimPids } from '/tmp/wt-72e79272-grok/tests/helpers/ceremony-swtpm.mjs';

const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
function esrch(pid) {
  try { process.kill(pid, 0); return false; } catch (e) { return !!(e && e.code === 'ESRCH'); }
}
function stateOf(pid) {
  try {
    const st = readFileSync(`/proc/${pid}/stat`, 'utf8');
    return st.slice(st.lastIndexOf(')') + 2).split(' ')[0];
  } catch { return 'GONE'; }
}

const signalLog = join(mkdtempSync(join(tmpdir(), 'xuux-wl422-sig-')), 'signals.log');
writeFileSync(signalLog, '');
const decoy = spawn('python3', ['-c', [
  'import signal,sys,time',
  'p=sys.argv[1]',
  'def h(s,f):',
  '    open(p,"a").write("SIG %d\\n"%s)',
  'for n in (15,2,1,10,12):',
  '    signal.signal(n,h)',
  'open(p,"a").write("ready\\n")',
  'time.sleep(120)',
].join('\n'), signalLog], { stdio: 'ignore' });
for (let i = 0; i < 50; i++) {
  if (existsSync(signalLog) && readFileSync(signalLog, 'utf8').includes('ready')) break;
  sleep(20);
}
const s = startSim({ prefix: 'xuux-wl422-daemon-nonowner-', portBase: 24210, label: 'WL422-daemon-nonowner', attempts: 1 });
const out = { sim: { pid: s.pid, dir: s.dir, port: s.port }, decoy: decoy.pid, discoverBefore: discoverSimPids(s.dir) };
try {
  const t0 = Date.now();
  out.killDecoy = killSim(decoy.pid, { dir: s.dir, graceMs: 200 });
  out.stopSimReturned = stopSim({ ...s, pid: decoy.pid });
  out.elapsedMs = Date.now() - t0;
  out.owner = { state: stateOf(s.pid), esrch: esrch(s.pid), discover: discoverSimPids(s.dir) };
  out.decoyAfter = { state: stateOf(decoy.pid), esrch: esrch(decoy.pid), signalLog: readFileSync(signalLog, 'utf8') };
  out.stateDirExists = existsSync(s.dir);
  console.log(JSON.stringify(out, null, 2));
  assert.equal(out.killDecoy, false);
  assert.equal(out.stopSimReturned, false);
  assert.equal(out.owner.esrch, true, 'daemon owner must be gone (ESRCH)');
  assert.equal(out.decoyAfter.esrch, false);
  assert.equal(out.decoyAfter.signalLog.trim(), 'ready');
  assert.equal(out.stateDirExists, true);
} finally {
  decoy.kill('SIGKILL');
  await new Promise((r) => decoy.once('exit', () => r()));
  if (existsSync(s.dir)) {
    for (const p of discoverSimPids(s.dir)) killSim(p, { dir: s.dir });
    rmSync(s.dir, { recursive: true, force: true });
  }
}
