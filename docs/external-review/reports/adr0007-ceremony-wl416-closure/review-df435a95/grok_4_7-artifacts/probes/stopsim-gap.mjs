// مسبار مستقل تحت مجلد المراجعة — لا يلمس شجرة المستودع.
// يقيس: (أ) رقم حي لا يملك المسار: هل يُنهي stopSim المالك المثبت أم يعود false ويتركه؟
// (ب) رقم زائل والمالك حي: هل يُنهى المالك قبل إعلان التوقف والحذف؟
// (ج) pid-not-owner مع فشل الإشارة المحقون: هل يُحفظ المجلد ولا يُعلن التوقف؟
import { writeFileSync, rmSync } from 'node:fs';
import { spawn } from 'node:child_process';
import {
  startSim,
  stopSim,
  killSim,
  discoverSimPids,
  stateDirExists,
} from '/tmp/wt-df435a95-grok/tests/helpers/ceremony-swtpm.mjs';

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e && e.code === 'ESRCH' ? false : true;
  }
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

const out = [];
function log(s) {
  out.push(s);
  console.log(s);
}

// (أ) رقم مسلّم حي وليس المالك
{
  const s = startSim({
    prefix: 'xuux-wl420-gap-a-',
    portBase: 7740,
    label: 'WL420-gap-a',
    attempts: 1,
    readyTries: 8,
    readyDelayMs: 200,
  });
  const owner = s.pid;
  const dir = s.dir;
  const decoy = spawn('sleep', ['120'], { stdio: 'ignore' });
  sleep(100);
  const decoyPid = decoy.pid;
  log(`A handedOwner=${owner} decoy=${decoyPid} ownersBefore=${JSON.stringify(discoverSimPids(dir))}`);
  const st = stopSim({ dir, pid: decoyPid, pidFile: s.pidFile });
  const ownersAfter = discoverSimPids(dir);
  log(
    `A stopSim_return=${st} ownersAfter=${JSON.stringify(ownersAfter)} dirExists=${stateDirExists(dir)} ownerAlive=${alive(owner)} decoyAlive=${alive(decoyPid)}`,
  );
  // تنظيف بأيدينا بعد القياس
  if (ownersAfter.length) {
    for (const p of ownersAfter) log(`A cleanup killSim(${p})=${killSim(p, { dir })}`);
  }
  try {
    if (alive(decoyPid)) process.kill(decoyPid, 9);
  } catch {}
  if (stateDirExists(dir) && discoverSimPids(dir).length === 0) {
    rmSync(dir, { recursive: true, force: true });
    log('A cleanup deleted dir after owners gone');
  } else {
    log(`A cleanup leftover dirExists=${stateDirExists(dir)} owners=${JSON.stringify(discoverSimPids(dir))}`);
  }
}

// (ب) رقم زائل والمالك حي — المسار الذي يدّعي الإصلاح إغلاقه
{
  const s = startSim({
    prefix: 'xuux-wl420-gap-b-',
    portBase: 7760,
    label: 'WL420-gap-b',
    attempts: 1,
    readyTries: 8,
    readyDelayMs: 200,
  });
  const owner = s.pid;
  log(`B owner=${owner} ownersBefore=${JSON.stringify(discoverSimPids(s.dir))}`);
  const st = stopSim({ ...s, pid: 2147483002 });
  const after = discoverSimPids(s.dir);
  log(
    `B stopSim_return=${st} ownersAfter=${JSON.stringify(after)} dirExists=${stateDirExists(s.dir)} ownerAlive=${alive(owner)}`,
  );
  if (after.length) {
    for (const p of after) log(`B cleanup killSim(${p})=${killSim(p, { dir: s.dir })}`);
  }
}

// (ج) pid-not-owner + فشل إشارة محقون: لا تسليم، لا إعلان توقف، المجلد محفوظ، المالك حي
{
  const abandoned = [];
  let launched = null;
  let threw = null;
  try {
    startSim({
      prefix: 'xuux-wl420-gap-c-',
      portBase: 7780,
      label: 'WL420-gap-c',
      attempts: 1,
      readyTries: 2,
      readyDelayMs: 50,
      probe: () => true,
      injectKillFailure: true,
      afterSpawn: ({ pid, pidFile }) => {
        launched = pid;
        writeFileSync(pidFile, '2147483003');
      },
      onAbandon: (a) => abandoned.push(a),
    });
  } catch (e) {
    threw = e;
  }
  const a = abandoned[0] || {};
  log(
    `C threw=${threw ? String(threw.message).slice(0, 180) : 'null'} reason=${a.reason} stopped=${a.stopped} dirExists=${a.dir ? stateDirExists(a.dir) : 'n/a'} launched=${launched} launchedAlive=${launched ? alive(launched) : 'n/a'} owners=${a.dir ? JSON.stringify(discoverSimPids(a.dir)) : '[]'}`,
  );
  if (a.dir && launched) {
    log(`C cleanup killSim=${killSim(launched, { dir: a.dir })}`);
    log(`C afterCleanup owners=${JSON.stringify(discoverSimPids(a.dir))} dirExists=${stateDirExists(a.dir)}`);
  }
}

writeFileSync('/tmp/council-wl420-grok_4_7/logs/stopsim-gap.log', out.join('\n') + '\n');
