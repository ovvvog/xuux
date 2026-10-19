// WL-421 — مسبارُ إعادةِ إنتاجِ WL420-gpt_6_1_sol-01 (مقتبسٌ من مسبارِ المراجِع stop-zombie-probe.mjs).
// مالكٌ حقيقيٌّ لمسارِ الحالةِ يُقتَلُ بـSIGKILL دونَ حصادٍ ⇒ زومبي. stopSim برقمٍ زائلٍ يجبُ ألّا يعلنَ
// التوقّفَ ولا يحذفَ المجلّد. المساعدُ يُحمَّلُ من XUUX_HELPER (مسارٌ مطلق). منفذُ swtpm: XUUX_PORT (7686).
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { once } from 'node:events';

const helper = process.env.XUUX_HELPER;
if (!helper) throw new Error('XUUX_HELPER required');
const { stopSim, discoverSimPids } = await import(helper);
const dir = mkdtempSync(join(tmpdir(), 'xuux-wl421-zombie-'));
const pidFile = join(dir, 'swtpm.pid');
const port = Number(process.env.XUUX_PORT || 7686);
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const child = spawn('swtpm', ['socket', '--tpm2', '--tpmstate', `dir=${dir}`,
  '--server', `type=tcp,port=${port},bindaddr=127.0.0.1`, '--ctrl', `type=tcp,port=${port + 1},bindaddr=127.0.0.1`,
  '--flags', 'not-need-init,startup-clear', '--pid', `file=${pidFile}`], { stdio: 'ignore' });
const exited = once(child, 'exit');
let sent = false;
let stopped;
try {
  let ok = false;
  for (let i = 0; i < 100 && !ok; i++) {
    ok = spawnSync('tpm2_getcap', [`--tcti=swtpm:host=127.0.0.1,port=${port}`, 'properties-fixed'], { stdio: 'ignore' }).status === 0;
    if (!ok) sleep(20);
  }
  assert.ok(ok, 'real swtpm responds');
  assert.ok(discoverSimPids(dir).includes(child.pid), 'ownership initially established');
  child.kill('SIGKILL'); // لا حصادَ: حلقةُ الأحداثِ لم تدُر بعدُ
  sent = true;
  let state = null;
  for (let i = 0; i < 100; i++) {
    const st = readFileSync(`/proc/${child.pid}/stat`, 'utf8');
    state = st.slice(st.lastIndexOf(')') + 2).split(' ')[0];
    if (state === 'Z') break;
    sleep(20);
  }
  assert.equal(state, 'Z', 'owned real simulator remains a zombie');
  stopped = stopSim({ pid: 2147483000, dir, pidFile });
  console.log(JSON.stringify({ helper, ownerPid: child.pid, ownerState: state, stopSimReturned: stopped, stateDirExists: existsSync(dir) }));
  assert.equal(stopped, false, 'a stale pid plus an owned zombie must not prove termination');
  assert.equal(existsSync(dir), true, 'state dir kept while the owner is unresolved');
} finally {
  if (!sent) child.kill('SIGKILL');
  await exited;
  let absent = false;
  try { process.kill(child.pid, 0); } catch (e) { absent = e.code === 'ESRCH'; }
  rmSync(dir, { recursive: true, force: true });
  console.log(JSON.stringify({ phase: 'cleanup', ownerPid: child.pid, reapedAbsentByESRCH: absent }));
}
