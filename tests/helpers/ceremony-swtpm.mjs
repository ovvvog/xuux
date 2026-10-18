// @ts-nocheck
// tests/helpers/ceremony-swtpm.mjs
//
// WL-414 دورةُ المعالجةِ / FUP-SOL-03 — تشغيلُ محاكيِ swtpm معزولٍ لاختباراتِ البروفةِ وإيقافُه.
// كانت startSim منسوخةً في ثلاثةِ ملفّاتِ اختبارٍ، وعندَ نجاحِ إطلاقِ swtpm مع فشلِ استعلامِ الجاهزيّةِ كانت
// تحذفُ مجلّدَ الحالةِ وتنتقلُ للمحاولةِ التاليةِ دونَ إيقافِ العمليّةِ — فيبقى محاكٍ يتيمٌ (PPID=1) بعدَ
// خروجِ الاختبارِ (قياسُ gpt_6_1_sol على 3e67d362، وإعادةُ إنتاجِه على a3272058). الآن: كلُّ محاكٍ أُطلِقَ ولم
// يُسلَّمْ للاختبارِ يُنهى وتُنتظَرُ نهايتُه قبلَ حذفِ مجلّدِه، وstopSim تنتظرُ النهايةَ كذلك (SIGTERM ثمّ SIGKILL).
// لا TBS، ولا /dev/tpm*، ولا عتاد: محاكٍ على 127.0.0.1 أو ::1 فقط.

import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function sleepMs(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

// يُنهي عمليّةَ المحاكي وينتظرُ زوالَها: SIGTERM ثمّ انتظارٌ محدودٌ ثمّ SIGKILL. يعيدُ true إن زالت.
export function killSim(pid, { graceMs = 3000 } = {}) {
  if (!Number.isInteger(pid) || pid <= 1) return true;
  try {
    process.kill(pid, 'SIGTERM');
  } catch {
    return true;
  }
  for (let waited = 0; waited < graceMs; waited += 20) {
    if (!alive(pid)) return true;
    sleepMs(20);
  }
  try {
    process.kill(pid, 'SIGKILL');
  } catch {
    return true;
  }
  for (let waited = 0; waited < 1000; waited += 20) {
    if (!alive(pid)) return true;
    sleepMs(20);
  }
  return !alive(pid);
}

function readPid(pidFile) {
  try {
    const n = Number(readFileSync(pidFile, 'utf8').trim());
    return Number.isInteger(n) && n > 1 ? n : null;
  } catch {
    return null;
  }
}

function defaultProbe(port) {
  try {
    execFileSync('tpm2_getcap', ['--tcti=swtpm:host=127.0.0.1,port=' + port, 'properties-fixed'], {
      stdio: 'ignore',
    });
    return true;
  } catch {
    return false;
  }
}

// opts: prefix (بادئةُ مجلّدِ الحالةِ)، portBase، bindaddr، attempts (8)، readyTries (10)، readyDelayMs (1000)،
// probe(port) ⇒ boolean (افتراضيًّا tpm2_getcap)، onAbandon({pid, dir, port, stopped}) لمراقبةِ الاختبارِ، label للخطأ.
export function startSim(opts = {}) {
  const {
    prefix = 'xuux-ceremony-',
    portBase = 2700,
    bindaddr = '127.0.0.1',
    attempts = 8,
    readyTries = 10,
    readyDelayMs = 1000,
    probe = defaultProbe,
    onAbandon = null,
    label = 'WL-413',
  } = opts;
  for (let attempt = 0; attempt < attempts; attempt++) {
    const dir = mkdtempSync(join(tmpdir(), prefix));
    const port = portBase + 2 * Math.floor(Math.random() * 150);
    const pidFile = join(dir, 'swtpm.pid');
    const r = spawnSync(
      'swtpm',
      [
        'socket',
        '--tpm2',
        '--tpmstate',
        `dir=${dir}`,
        '--server',
        `type=tcp,port=${port},bindaddr=${bindaddr}`,
        '--ctrl',
        `type=tcp,port=${port + 1},bindaddr=127.0.0.1`,
        '--flags',
        'not-need-init,startup-clear',
        '--pid',
        `file=${pidFile}`,
        '--daemon',
      ],
      { encoding: 'utf8' },
    );
    // حتى عندَ خروجٍ غيرِ صفريٍّ قد يكونُ ملفُّ pid كُتب: يُنهى ما وُجدَ قبلَ حذفِ المجلّد.
    if (r.status !== 0) {
      const pid = readPid(pidFile);
      const stopped = pid ? killSim(pid) : true;
      if (onAbandon) onAbandon({ pid, dir, port, stopped, reason: 'spawn-failed' });
      rmSync(dir, { recursive: true, force: true });
      continue;
    }
    let ready = false;
    for (let i = 0; i < readyTries; i++) {
      if (probe(port)) {
        ready = true;
        break;
      }
      if (i + 1 < readyTries) sleepMs(readyDelayMs);
    }
    const pid = readPid(pidFile);
    if (!ready || pid === null) {
      const stopped = pid ? killSim(pid) : true;
      if (onAbandon) onAbandon({ pid, dir, port, stopped, reason: ready ? 'no-pid' : 'not-ready' });
      rmSync(dir, { recursive: true, force: true });
      continue;
    }
    return { dir, port, pidFile, pid };
  }
  throw new Error(label + ': تعذّرَ تشغيلُ محاكٍ معزول');
}

// قتلُ عمليّةِ المحاكي وانتظارُ زوالِها قبلَ حذفِ مجلّدِ الحالةِ (الحذفُ وحدَه ترك 21 يتيمًا — WL-413 R3).
export function stopSim(s) {
  if (!s) return true;
  const stopped = killSim(s.pid);
  try {
    rmSync(s.dir, { recursive: true, force: true });
  } catch {
    /* أفضلُ جهد */
  }
  return stopped;
}

// للاختبار: هل توجدُ عمليّةُ swtpm حيّةٌ تحملُ هذا المسارَ في سطرِ أوامرِها؟ (قراءةُ /proc فقط)
export function swtpmProcessesWithPath(path) {
  const r = spawnSync('pgrep', ['-af', '--', 'swtpm'], { encoding: 'utf8' });
  return String(r.stdout || '')
    .split('\n')
    .filter((l) => l.includes(path));
}
