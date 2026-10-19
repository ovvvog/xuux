// Independent observation of stopSim when the supplied pid is already absent
// while a live swtpm still owns the state dir. Does not modify the review tree.
import { startSim, stopSim, discoverSimPids, stateDirExists, killSim } from '/home/user/workspace/xuux/tests/helpers/ceremony-swtpm.mjs';

const s = startSim({ prefix: 'xuux-wl418-gap-', portBase: 7850, label: 'WL418-gap', attempts: 1 });
const ownersBefore = discoverSimPids(s.dir);
const deadPid = 2147483000;
let stopResult = null;
let threw = null;
try {
  stopResult = stopSim({ pid: deadPid, dir: s.dir });
} catch (e) {
  threw = String(e && e.message);
}
const ownersAfter = (() => {
  try { return discoverSimPids(s.dir); } catch (e) { return ['scan-threw:' + e.message]; }
})();
const dirExists = stateDirExists(s.dir);
const realStillAlive = ownersBefore.length === 1 ? (() => {
  try { process.kill(ownersBefore[0], 0); return true; } catch (e) { return e && e.code !== 'ESRCH'; }
})() : null;
console.log(JSON.stringify({
  returnedPid: s.pid,
  ownersBefore,
  deadPid,
  stopResult,
  threw,
  dirExistsAfterStopSim: dirExists,
  ownersAfter,
  realStillAlive,
}, null, 2));
// cleanup the real process if stopSim did not
if (ownersBefore.length) {
  for (const pid of ownersBefore) {
    try { killSim(pid, { dir: s.dir }); } catch {}
  }
}
