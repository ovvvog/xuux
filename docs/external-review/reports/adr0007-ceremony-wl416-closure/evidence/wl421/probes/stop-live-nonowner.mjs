// WL-421 — مسبارُ WL420-grok_4_7-01: الرقمُ المسلَّمُ حيٌّ لكنه ليس المالك (sleep)، والمالكُ الحقيقيُّ حيٌّ.
// المطلوب: لا إشارةَ إلى الرقمِ غيرِ المثبَتِ (يبقى حيًّا)، والمالكُ المثبَتُ يُنهى، ولا يُعلَنُ التوقّفُ
// (الرقمُ المسلَّمُ لم يُثبَت زوالُه ولا انتماؤه) فيُحفَظُ المجلّد. XUUX_HELPER مسارٌ مطلق.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { rmSync } from 'node:fs';

const helper = process.env.XUUX_HELPER;
if (!helper) throw new Error('XUUX_HELPER required');
const { startSim, stopSim, killSim, discoverSimPids, stateDirExists } = await import(helper);
const alive = (p) => { try { process.kill(p, 0); return true; } catch (e) { return e.code !== 'ESRCH'; } };
const s = startSim({ prefix: 'xuux-wl421-nonowner-', portBase: 7740, label: 'WL421-nonowner', attempts: 1, readyTries: 8, readyDelayMs: 200 });
const decoy = spawn('sleep', ['120'], { stdio: 'ignore' });
let r;
try {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
  const st = stopSim({ dir: s.dir, pid: decoy.pid, pidFile: s.pidFile });
  r = { helper, owner: s.pid, decoy: decoy.pid, stopSimReturned: st, ownersAfter: discoverSimPids(s.dir), ownerAlive: alive(s.pid), decoyAlive: alive(decoy.pid), dirExists: stateDirExists(s.dir) };
  console.log(JSON.stringify(r));
  assert.equal(r.decoyAlive, true, 'no signal to an unproven pid');
  assert.equal(st, false, 'no stop claim for an unproven delivered pid');
  assert.deepEqual(r.ownersAfter, [], 'the proven owner is terminated anyway');
  assert.equal(r.ownerAlive, false);
  assert.equal(r.dirExists, true, 'dir kept while the claim is unproven');
} finally {
  for (const p of discoverSimPids(s.dir)) killSim(p, { dir: s.dir });
  decoy.kill('SIGKILL');
  if (discoverSimPids(s.dir).length === 0) rmSync(s.dir, { recursive: true, force: true });
  console.log(JSON.stringify({ phase: 'cleanup', ownersLeft: discoverSimPids(s.dir), dirExists: stateDirExists(s.dir) }));
}
