// Independent WL-422 probe. Does not modify the review tree.
// Modes: zombie-stale | zombie-self | nonowner | unrelated-block
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';

const which = process.argv[2];
const mode = process.argv[3];
const port = Number(process.argv[4]);
if (!which || !mode || !port) {
  console.error('usage: lifecycle.mjs <new|old> <zombie-stale|zombie-self|nonowner|unrelated-block> <port>');
  process.exit(2);
}
const tree = which === 'old' ? '/tmp/wt-339f5934' : '/tmp/wt-72e79272-grok';
const helperPath = `${tree}/tests/helpers/ceremony-swtpm.mjs`;
const { stopSim, discoverSimPids, killSim } = await import(helperPath);

const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
function stateOf(pid) {
  try {
    const st = readFileSync(`/proc/${pid}/stat`, 'utf8');
    return st.slice(st.lastIndexOf(')') + 2).split(' ')[0];
  } catch (e) {
    return 'GONE';
  }
}
function cmdlineOf(pid) {
  try {
    const b = readFileSync(`/proc/${pid}/cmdline`);
    return { bytes: b.length, text: b.toString('utf8').replaceAll('\0', ' | ') };
  } catch (e) {
    return { error: e && e.code };
  }
}
function esrch(pid) {
  try {
    process.kill(pid, 0);
    return false;
  } catch (e) {
    return !!(e && e.code === 'ESRCH');
  }
}
function scanLocal(dir) {
  const matches = [];
  const zombies = [];
  const unresolved = [];
  for (const entry of readdirSync('/proc')) {
    if (!/^\d+$/.test(entry)) continue;
    const pid = Number(entry);
    if (pid <= 1) continue;
    let args = null;
    try {
      args = readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0').filter((s) => s.length > 0);
    } catch {
      args = null;
    }
    const st = stateOf(pid);
    if (args && args.length > 0 && args[0].includes('swtpm')) {
      const i = args.indexOf('--tpmstate');
      if (dir === null || (i >= 0 && args[i + 1] === `dir=${dir}`)) matches.push(pid);
      continue;
    }
    if (args === null || args.length === 0) {
      if (st === 'Z') zombies.push(pid);
      else if (st !== 'GONE' && st !== 'Z') {
        let ppid = null;
        try {
          const s = readFileSync(`/proc/${pid}/stat`, 'utf8');
          const rest = s.slice(s.lastIndexOf(')') + 2).split(' ');
          ppid = Number(rest[1]);
        } catch { /* ignore */ }
        if (ppid !== 2 && ppid !== 0 && !esrch(pid)) unresolved.push(pid);
      }
    }
  }
  return { matches, zombies: zombies.length, unresolved: unresolved.length, zombiePids: zombies.slice(0, 12) };
}

const out = {
  which,
  mode,
  helperPath,
  port,
  head: spawnSync('git', ['-C', tree, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim(),
};

function launchSwtpm(dir, pidFile, p) {
  const child = spawn(
    'swtpm',
    [
      'socket', '--tpm2', '--tpmstate', `dir=${dir}`,
      '--server', `type=tcp,port=${p},bindaddr=127.0.0.1`,
      '--ctrl', `type=tcp,port=${p + 1},bindaddr=127.0.0.1`,
      '--flags', 'not-need-init,startup-clear',
      '--pid', `file=${pidFile}`,
    ],
    { stdio: 'ignore' },
  );
  let ready = false;
  for (let i = 0; i < 100 && !ready; i++) {
    ready = spawnSync('tpm2_getcap', [`--tcti=swtpm:host=127.0.0.1,port=${p}`, 'properties-fixed'], { stdio: 'ignore' }).status === 0;
    if (!ready) sleep(30);
  }
  return { child, ready };
}

const dir = mkdtempSync(join(tmpdir(), `xuux-wl422-${which}-${mode}-`));
const pidFile = join(dir, 'swtpm.pid');
let child = null;
let decoy = null;
let extra = null;
const signalLog = join(dir, 'signals.log');

try {
  if (mode === 'unrelated-block') {
    const { startSim } = await import(helperPath);
    const s = startSim({ prefix: 'xuux-wl422-unrel-', portBase: port, label: 'WL422-unrel', attempts: 1 });
    out.started = { pid: s.pid, dir: s.dir, discover: discoverSimPids(s.dir) };
    extra = spawn('sleep', ['120'], { stdio: 'ignore' });
    sleep(50);
    extra.kill('SIGKILL');
    let z = null;
    for (let i = 0; i < 50 && z !== 'Z'; i++) {
      z = stateOf(extra.pid);
      if (z !== 'Z') sleep(20);
    }
    out.unrelatedZombie = { pid: extra.pid, state: z, cmdline: cmdlineOf(extra.pid) };
    const t0 = Date.now();
    const stopped = stopSim(s);
    out.elapsedMs = Date.now() - t0;
    out.stopSimReturned = stopped;
    out.stateDirExists = existsSync(s.dir);
    out.ownerAfter = { state: stateOf(s.pid), esrch: esrch(s.pid), discover: discoverSimPids(s.dir) };
    out.scanAfter = scanLocal(s.dir);
    // reap unrelated zombie, then a second stop must be allowed to finish deletion
    extra.kill('SIGKILL');
    await new Promise((r) => extra.once('exit', r));
    const t1 = Date.now();
    const stopped2 = stopSim({ pid: s.pid, dir: s.dir, pidFile: s.pidFile });
    out.second = {
      elapsedMs: Date.now() - t1,
      stopSimReturned: stopped2,
      stateDirExists: existsSync(s.dir),
      ownerEsrch: esrch(s.pid),
    };
    out.dir = s.dir;
  } else if (mode === 'nonowner') {
    writeFileSync(signalLog, '');
    decoy = spawn(
      'python3',
      ['-c', [
        'import signal,sys,time',
        'p=sys.argv[1]',
        'def h(s,f):',
        '    open(p,"a").write("SIG %d\\n"%s); open(p,"a").flush()',
        'for n in (15,2,1,10,12):',
        '    signal.signal(n,h)',
        'open(p,"a").write("ready\\n")',
        'time.sleep(120)',
      ].join('\n'), signalLog],
      { stdio: 'ignore' },
    );
    for (let i = 0; i < 50 && !existsSync(signalLog); i++) sleep(20);
    let ready = '';
    for (let i = 0; i < 50; i++) {
      ready = readFileSync(signalLog, 'utf8');
      if (ready.includes('ready')) break;
      sleep(20);
    }
    const launched = launchSwtpm(dir, pidFile, port);
    child = launched.child;
    assert.equal(launched.ready, true, 'swtpm not ready');
    assert.ok(discoverSimPids(dir).includes(child.pid), 'owner not discovered');
    const owner = child.pid;
    const tKill = Date.now();
    const killDecoy = killSim(decoy.pid, { dir, graceMs: 200 });
    out.killSimDecoy = { returned: killDecoy, elapsedMs: Date.now() - tKill, decoyState: stateOf(decoy.pid), esrch: esrch(decoy.pid) };
    const t0 = Date.now();
    const stopped = stopSim({ pid: decoy.pid, dir, pidFile });
    out.elapsedMs = Date.now() - t0;
    out.stopSimReturned = stopped;
    out.stateDirExists = existsSync(dir);
    out.ownerAfter = { pid: owner, state: stateOf(owner), esrch: esrch(owner), discover: discoverSimPids(dir) };
    out.decoyAfter = { pid: decoy.pid, state: stateOf(decoy.pid), esrch: esrch(decoy.pid), signalLog: readFileSync(signalLog, 'utf8') };
    out.scanAfter = scanLocal(dir);
  } else {
    const launched = launchSwtpm(dir, pidFile, port);
    child = launched.child;
    assert.equal(launched.ready, true, 'swtpm not ready');
    assert.ok(discoverSimPids(dir).includes(child.pid), 'owner not discovered before kill');
    const owner = child.pid;
    child.kill('SIGKILL');
    let st = null;
    for (let i = 0; i < 80 && st !== 'Z'; i++) {
      st = stateOf(owner);
      if (st !== 'Z') sleep(20);
    }
    out.before = {
      ownerPid: owner,
      state: st,
      cmdline: cmdlineOf(owner),
      discover: discoverSimPids(dir),
      scan: scanLocal(dir),
    };
    const delivered = mode === 'zombie-self' ? owner : 2147483000;
    const t0 = Date.now();
    const stopped = stopSim({ pid: delivered, dir, pidFile });
    out.elapsedMs = Date.now() - t0;
    out.deliveredPid = delivered;
    out.stopSimReturned = stopped;
    out.stateDirExists = existsSync(dir);
    out.after = {
      state: stateOf(owner),
      esrch: esrch(owner),
      cmdline: cmdlineOf(owner),
      discover: discoverSimPids(dir),
      scan: scanLocal(dir),
    };
  }
  console.log(JSON.stringify(out, null, 2));
  const expect = {
    'old:zombie-stale': () => {
      assert.equal(out.stopSimReturned, true, 'old stopSim declared stop despite zombie owner');
      assert.equal(out.stateDirExists, false, 'old stopSim deleted the state dir');
      assert.equal(out.after.state, 'Z', 'zombie owner still unreaped');
    },
    'new:zombie-stale': () => {
      assert.equal(out.stopSimReturned, false);
      assert.equal(out.stateDirExists, true);
      assert.equal(out.after.state, 'Z');
      assert.ok(out.elapsedMs >= 800, 'settle wait expected, got ' + out.elapsedMs);
    },
    'old:zombie-self': () => {
      assert.equal(out.stopSimReturned, false, 'old killSim refuses unreadable live pid and returns early');
      assert.equal(out.stateDirExists, true);
      assert.equal(out.after.state, 'Z');
      assert.ok(out.elapsedMs < 800, 'old path must not wait out the new settle window, got ' + out.elapsedMs);
    },
    'new:zombie-self': () => {
      assert.equal(out.stopSimReturned, false);
      assert.equal(out.stateDirExists, true);
      assert.equal(out.after.state, 'Z');
    },
    'old:nonowner': () => {
      assert.equal(out.stopSimReturned, false);
      assert.equal(out.ownerAfter.esrch, false, 'old stopSim left the proven owner alive');
      assert.equal(out.decoyAfter.esrch, false);
      assert.equal(out.decoyAfter.signalLog.trim(), 'ready');
      assert.equal(out.stateDirExists, true);
    },
    'new:nonowner': () => {
      assert.equal(out.stopSimReturned, false);
      assert.equal(out.ownerAfter.esrch, true, 'proven owner must be terminated');
      assert.equal(out.decoyAfter.esrch, false, 'no signal to unproven delivered pid');
      assert.equal(out.decoyAfter.signalLog.trim(), 'ready');
      assert.equal(out.stateDirExists, true);
      assert.equal(out.killSimDecoy.returned, false);
    },
    'old:unrelated-block': () => {
      assert.equal(out.stopSimReturned, true, 'old stopSim ignores unattributable zombies');
      assert.equal(out.stateDirExists, false);
    },
    'new:unrelated-block': () => {
      assert.equal(out.stopSimReturned, false, 'any unreaped zombie blocks the stop claim');
      assert.equal(out.stateDirExists, true);
      assert.equal(out.ownerAfter.esrch, true, 'owner is dead even though stop is not declared');
      assert.equal(out.second.stopSimReturned, true);
      assert.equal(out.second.stateDirExists, false);
    },
  };
  expect[`${which}:${mode}`]();
} finally {
  if (decoy && decoy.exitCode === null && decoy.signalCode === null) decoy.kill('SIGKILL');
  if (extra && extra.exitCode === null && extra.signalCode === null) extra.kill('SIGKILL');
  if (child && child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  const waits = [decoy, extra, child].filter(Boolean).map((c) => new Promise((r) => {
    if (c.exitCode !== null || c.signalCode !== null) r();
    else c.once('exit', r);
  }));
  await Promise.all(waits);
  // do not delete a dir the probe is still using as evidence of retention; always remove our temp dirs after the assertion window
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* recorded already */ }
  if (out.dir && out.dir !== dir) {
    try { rmSync(out.dir, { recursive: true, force: true }); } catch { /* recorded already */ }
  }
}
