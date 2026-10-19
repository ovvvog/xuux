// Success-path: startSim returns whatever integer is in the pid file after ready,
// without proving that pid owns the state dir. stopSim then treats an absent pid
// as proof of death and deletes the directory.
import { writeFileSync } from 'node:fs';
import { startSim, stopSim, discoverSimPids, stateDirExists, killSim } from '/home/user/workspace/xuux/tests/helpers/ceremony-swtpm.mjs';

let launched = null;
let s = null;
let stopResult = null;
let threw = null;
try {
  s = startSim({
    prefix: 'xuux-wl418-stale-',
    portBase: 7860,
    label: 'WL418-stale',
    attempts: 1,
    readyTries: 2,
    readyDelayMs: 50,
    probe: () => true,
    afterSpawn: ({ pid, pidFile }) => {
      launched = pid;
      writeFileSync(pidFile, '2147483001');
    },
  });
  stopResult = stopSim(s);
} catch (e) {
  threw = String(e && e.message);
}
const owners = s ? (() => { try { return discoverSimPids(s.dir); } catch (e) { return ['err:' + e.message]; } })() : [];
let launchedAlive = null;
if (launched) {
  try { process.kill(launched, 0); launchedAlive = true; } catch (e) { launchedAlive = e && e.code !== 'ESRCH'; }
}
console.log(JSON.stringify({
  launched,
  returned: s,
  stopResult,
  threw,
  dirExists: s ? stateDirExists(s.dir) : null,
  ownersAfterStop: owners,
  launchedAlive,
}, null, 2));
if (launched) {
  try { killSim(launched, { dir: s && s.dir }); } catch {}
}
