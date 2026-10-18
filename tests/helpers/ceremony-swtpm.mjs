// @ts-nocheck
// tests/helpers/ceremony-swtpm.mjs
//
// WL-414 FUP-SOL-03 ثمّ WL-416 — تشغيلُ محاكيِ swtpm معزولٍ لاختباراتِ البروفةِ وإيقافُه.
// كانت startSim منسوخةً في ثلاثةِ ملفّاتِ اختبارٍ، وعندَ نجاحِ إطلاقِ swtpm مع فشلِ استعلامِ الجاهزيّةِ كانت
// تحذفُ مجلّدَ الحالةِ وتنتقلُ للمحاولةِ التاليةِ دونَ إيقافِ العمليّةِ — فيبقى محاكٍ يتيمٌ (PPID=1) بعدَ
// خروجِ الاختبارِ (قياسُ gpt_6_1_sol على 3e67d362، وإعادةُ إنتاجِه على a3272058). ثمّ أثبتَ مراجعا e23bd431
// فجوتَينِ باقيتَينِ (WL-416): غيابُ ملفِ PID كان يُعلَنُ توقّفًا (stopped=true) بلا قرينةٍ على زوالِ العمليّةِ،
// واستثناءُ probe/onAbandon كان يتجاوزُ التنظيفَ. الآن:
//   - هويةُ العمليّةِ تُربَطُ بمسارِ الحالةِ الفعليِّ من سطرِ أوامرِها (تفكيكُ وسائطِ /proc/<pid>/cmdline على
//     الفواصلِ الصفريةِ ومطابقةُ الوسمِ `--tpmstate` ومعاملِهِ `dir=<مسار>` كاملًا) — لا برقمِ منفذٍ ولا
//     بمطابقةِ نصٍّ جزئيٍّ، ولا تُقتَلُ عمليّةٌ لا يُثبَتُ أنها التي أنشأها هذا التشغيلُ.
//   - استثناءُ إرسالِ الإشارةِ ليسَ إثباتَ زوالٍ: ESRCH وحدها دليلُ غيابٍ؛ وغيرُها (EPERM مثلًا) حالةٌ مجهولةٌ
//     لا تُعلَنَ نجاحًا.
//   - غيابُ ملفِ PID لا يُعَدُّ توقّفًا: الاكتشافُ البديلُ يربطُ العمليّةَ بمجلّدِ الحالةِ ويُنهيها؛ وتعذّرَ إثباتُ
//     الهويّةِ أو الإيقافُ ⇒ stopped=false صادقةٌ ويُحفَظُ مجلّدُ الحالةِ دليلًا ولا يُحذَفُ ولا تُعادُ المحاولةُ.
//   - كلُّ مسارِ خروجٍ بعدَ الإطلاقِ (رميُ probe أو afterSpawn، رميُ onAbandon، فشلُ الإيقافِ نفسِه) يمرُّ عبرَ
//     تنظيفٍ مضمونٍ: لا يتجاوزُ أيُّ استثناءٍ مرحلةَ الإنهاءِ، ولا يُحذفُ مجلّدُ الحالةِ قبلَ إثباتِ زوالِ العمليّةِ
//     المقصودةِ (المراقبُ يُستدعى بعدَ الإنهاءِ وقبلَ الحذفِ، فشاهِدُ الترتيبِ داخلَه).
// لا TBS، ولا /dev/tpm*، ولا عتاد: محاكٍ على 127.0.0.1 أو ::1 فقط.

import { mkdtempSync, rmSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';

// ── قراءةُ /proc: هويةُ العمليّةِ وحيواتُها ──

// سطرُ أوامرِ العمليّةِ مفكوكًا على الفواصلِ الصفريةِ (وسائطٌ كاملةٌ لا نصٌّ واحدٌ).
function procArgs(pid) {
  try {
    return readFileSync(`/proc/${pid}/cmdline`, 'utf8')
      .split('\0')
      .filter((s) => s.length > 0);
  } catch {
    return null; // تعذّرَتِ القراءةُ: ليست دليلَ غيابٍ ولا دليلَ هويّةٍ
  }
}

// هل العمليّةُ حيّةٌ؟ ESRCH وحدها غيابٌ مؤكَّدٌ؛ رفضُ الصلاحيّةِ (EPERM) يعني وجودَها. لا يُدَّعى موتٌ
// بحالةِ الزومبي (Z) — فشلٌ واضحُ الحدِّ (ESRCH) هو الدليلُ الوحيدُ المقبولُ (حسمُ المراجعة 3، WL-416).
function alive(pid) {
  try {
    process.kill(pid, 0);
  } catch (e) {
    return e && e.code === 'ESRCH' ? false : true;
  }
  return true;
}

// حالةُ العمليّةِ من /proc/<pid>/stat: الزومبي (Z) منتهيةٌ عمليًا فلا تُحسَبُ حيّةً عليلا، وخيوطُ النواةِ
// (ppid=2 أو 0) ليست عمليّاتِ مستخدمٍ أصلًا. تعذّرَتِ القراءةُ ⇒ null (لا دليلَ غيابٍ ولا دليلَ هويّةٍ).
function procState(pid) {
  try {
    const s = readFileSync(`/proc/${pid}/stat`, 'utf8');
    const close = s.lastIndexOf(')');
    if (close < 0) return null;
    const rest = s.slice(close + 2).split(' ');
    return { state: rest[0], ppid: Number(rest[1]) };
  } catch {
    return null;
  }
}

// عمليّةُ swtpm تملكُ هذهِ الجلسةَ: وسمُ `--tpmstate` ومعاملُهُ `dir=<dir>` كاملًا بينَ وسائطِها.
function ownsStateDir(args, dir) {
  for (let i = 0; i + 1 < args.length; i++) {
    if (args[i] === '--tpmstate' && args[i + 1] === `dir=${dir}`) return true;
  }
  return false;
}

// ── إشارةٌ مرتبطةٌ بهويّةٍ مستقرةٍ (pidfd) — إغلاقُ نافذةِ التحقّقِ-ثمّ-الإشارةِ (جولةُ المراجعةِ الرابعةِ) ──
// نافذةُ «تحقّقٌ من الهويّةِ ثمّ kill بالرقمِ» غيرُ ذرّيّةٍ: قد يموتُ الهدفُ ويُعادُ استخدامُ رقمِهِ بينَهما
// فتُصيبُ الإشارةُ بريئًا. الإغلاقُ: تُفتَحُ مقبضةُ العمليّةِ (pidfd) أولًا فتتعلّقُ بالعمليّةِ نفسِها لا برقمِها،
// ثمّ يُعادُ إثباتُ الهويّةِ من /proc/<pid>/cmdline (سطرُ أوامرٍ كاملٌ + مسارُ الحالةِ)، ثمّ تُرسَلُ الإشارةُ
// عبرَ المقبضةِ وحدَها — فأيُّ إعادةِ استخدامٍ للرقمِ بعدَ الفتحِ لا تُلامسُها الإشارةُ (ESRCH على الأصلِ).
// القناةُ عبرَ python3 المتاحِ: os.pidfd_open/signal.pidfd_send_signal إن وُجدا، وإلّا فاستدعاءُ
// النظامِ الخامُّ عبرَ ctypes (SYS_pidfd_open=434 وSYS_pidfd_send_signal=424 — أرقامٌ موحّدةٌ على
// معماريّاتِ 64-بتِ لينكس 5.3+)؛ وإن تعذّرَ كلٌّ ذلكَ (بيئةٌ بلا python3 أو بلا pidfd أصلًا) فالرجوعُ
// إلى process.kill بالرقمِ **بنافذةٍ معلَنةٍ لا مُدّعى إغلاقُها**.
const PIDFD_SIGNAL_SCRIPT = [
  'import os, signal, sys',
  'pid = int(sys.argv[1]); sig = int(sys.argv[2]); want_dir = sys.argv[3] if len(sys.argv) > 3 else None',
  "SYSCALLS = {'x86_64': (434, 424), 'aarch64': (434, 424), 'arm64': (434, 424)}",
  'def raw_syscall(num, *a):',
  '    import ctypes',
  '    libc = ctypes.CDLL(None, use_errno=True)',
  '    rc = libc.syscall(num, *a)',
  '    if rc == -1:',
  '        e = ctypes.get_errno()',
  '        if e == 3: raise ProcessLookupError()',
  '        raise OSError(e, os.strerror(e))',
  '    return rc',
  'def do_pidfd_open(pid):',
  '    if hasattr(os, "pidfd_open"): return os.pidfd_open(pid)',
  '    import platform',
  '    nums = SYSCALLS.get(platform.machine())',
  '    if nums is None: raise AttributeError("pidfd_open")',
  '    return raw_syscall(nums[0], pid, 0)',
  'def do_pidfd_send(fd, sig):',
  '    if hasattr(signal, "pidfd_send_signal"): return signal.pidfd_send_signal(fd, sig)',
  '    import platform',
  '    nums = SYSCALLS.get(platform.machine())',
  '    if nums is None: raise AttributeError("pidfd_send_signal")',
  '    return raw_syscall(nums[1], fd, sig, 0, 0)',
  'try:',
  '    fd = do_pidfd_open(pid)',
  'except ProcessLookupError:',
  "    print('esrch'); sys.exit(0)",
  'except (AttributeError, OSError):',
  "    print('unsupported'); sys.exit(0)",
  'try:',
  "    with open('/proc/%d/cmdline' % pid, 'rb') as f:",
  '        raw = f.read()',
  "    args = [a.decode('utf-8', 'replace') for a in raw.split(b'\0') if a]",
  "    if not args or 'swtpm' not in args[0]:",
  "        print('mismatch'); sys.exit(0)",
  '    if want_dir is not None:',
  "        ok = any(args[i] == '--tpmstate' and i + 1 < len(args) and args[i+1] == 'dir=' + want_dir for i in range(len(args)))",
  '        if not ok:',
  "            print('mismatch'); sys.exit(0)",
  '    do_pidfd_send(fd, sig)',
  "    print('ok')",
  'except ProcessLookupError:',
  "    print('esrch')",
  'except (AttributeError, OSError):',
  "    print('unsupported')",
  'finally:',
  '    try: os.close(fd)',
  '    except OSError: pass',
].join('\n');

// تُعيدُ 'ok' (أُرسِلَتْ عبرَ المقبضةِ) أو 'esrch' (زالتْ قبلَها) أو 'mismatch' (الهويّةُ لم تُثبَتْ عبرَ
// المقبضةِ — لا إشارةَ) أو 'unsupported' (القناةُ غيرُ متاحةٍ: بديلُ الرقمِ بنافذتِهِ المعلَنةِ).
function pidfdSignal(pid, sig, dir) {
  let r;
  try {
    r = spawnSync(
      'python3',
      ['-c', PIDFD_SIGNAL_SCRIPT, String(pid), String(sig), dir === null ? '' : dir],
      {
        encoding: 'utf8',
        timeout: 10000,
      },
    );
  } catch {
    return 'unsupported';
  }
  if (!r || r.status !== 0 || r.error) return 'unsupported';
  const out = String(r.stdout || '').trim();
  return out === 'ok' || out === 'esrch' || out === 'mismatch' ? out : 'unsupported';
}

// عمليّاتُ swtpm الحيّةُ المرتبطةُ بمسارِ حالةٍ بعينِهِ (هويةً كاملةً من الوسائطِ، لا مطابقةَ نصٍّ جزئيٍّ).
export function discoverSimPids(dir) {
  return scanStateDir(dir).matches;
}

// مسحٌ قرائيٌّ لمسارِ حالةٍ: matches = عمليّاتٌ مُثبَتٌ أنها swtpm يملكُ مسارَ الحالةِ؛ unresolved = عمليّةٌ
// حيّةٌ لا يمكنُ قراءةُ هويّتِها (سطرُ أوامرٍ غيرُ مقروءٍ لعمليّةٍ ليست زومبي ولا خيطَ نواةٍ) — لا يجوزُ
// أن يُعلَنَ التوقّفُ مع بقائِها (WL-416 جولةُ المراجعةِ الثانيةِ: الاكتشافُ الفارغُ ليسَ إثباتَ موتٍ).
// readCmdline: حقنةُ اختبارٍ لمحاكاةِ قراءةٍ غيرِ مقروءةٍ (الافتراضيُّ قراءةُ /proc الحقيقيّةُ).
function scanStateDir(dir, { readCmdline = procArgs } = {}) {
  const matches = [];
  const unresolved = [];
  for (const entry of readdirSync('/proc')) {
    if (!/^\d+$/.test(entry)) continue;
    const pid = Number(entry);
    if (pid <= 1) continue;
    const args = readCmdline(pid);
    if (args === null || args.length === 0) {
      // لا هويةَ مقروءةً: الزومبي منتهيةٌ (خرجَتْ فعلًا ولم يُلقَّ أثرُها بعدُ) فلا تُشاوَهُ — تخطّيها في
      // المسحِ لا يقتلُ شيئًا ولا يحذفُ مِلكَ حيٍّ (لا سطرَ أوامرَ لها أصلًا)، ومسارُ ملفِ PID يُبقيها غيرَ
      // محسومةٍ (قراءةٌ فارغةٌ ⇒ identityUnknown ⇒ stopped=false). التحقّقُ موثَّقٌ في سجلِّ الأعمالِ (جولةُ 4).
      // وخيطُ النواةِ ليسَ عمليّةَ مستخدمٍ؛ وما عدا ذلك حيّةٌ غيرُ محسومةِ الهويّةِ.
      const st = procState(pid);
      if (st === null) {
        if (alive(pid)) unresolved.push(pid);
        continue;
      }
      if (st.state === 'Z') continue;
      if (st.ppid === 2 || st.ppid === 0) continue;
      if (alive(pid)) unresolved.push(pid);
      continue;
    }
    if (!args[0].includes('swtpm')) continue;
    if (dir === null || ownsStateDir(args, dir)) matches.push(pid);
  }
  return { matches, unresolved };
}

function sleepMs(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

// ── إنهاءُ عمليّةِ المحاكي وانتظارُ زوالِها ──
//
// يعيدَ true فقط عندَ قرينةٍ صحيحةٍ على زوالِ العمليّةِ المقصودةِ (ESRCH عندَ الإشارةِ أو بعدها، أو زوالُ
// /proc/<pid>). أمّا تعذّرُ قراءةِ الهويّةِ، أو عدمُ مطابقةِ سطرِ الأوامرِ لمسارِ الحالةِ (إعادةُ استخدامِ PID
// لعمليّةٍ أخرى)، أو رفضُ إرسالِ الإشارةِ بصلاحيّةٍ — فكلُّها حالاتٌ مجهولةٌ تُعيدُ false ولا تُقتَلُ فيها عمليّةٌ
// لا يُثبَتُ أنها العمليّةُ التي أنشأها هذا التشغيلُ.
// opts.dir: مسارُ الحالةِ للتحقّقِ من ملكيّةِ العمليّةِ قبلَ أيِّ إشارةٍ.
// opts.injectKillFailure: حقنٌ محدودٌ للاختبارِ — يُمحاكي فشلَ إرسالِ الإشارةِ بصلاحيّةٍ (EPERM) فلا يُعلَنَ
// التوقّفُ كذبًا ولا يُحذَفُ المجلّدُ.
export function killSim(
  pid,
  { graceMs = 3000, dir = null, injectKillFailure = false, readCmdline = procArgs } = {},
) {
  if (!Number.isInteger(pid) || pid <= 1) return false; // رقمٌ غيرُ صالحٍ ليس دليلَ زوالٍ ولا إذنَ تنظيفٍ (حسمُ المراجعةِ 3)
  // هويةُ العمليّةِ قابلةٌ للقراءةِ: إن لم تربطها بمسارِ حالتِنا فهي ليست مِلكَنا — لا تُمسّ.
  const args = readCmdline(pid);
  if (args !== null && args.length > 0) {
    if (!args[0].includes('swtpm') || (dir !== null && !ownsStateDir(args, dir))) return false;
  } else if (alive(pid)) {
    // سطرُ أوامرِها غيرُ مقروءٍ لكنّها حيّةٌ: الهويّةُ غيرُ قابلةٍ للإثباتِ — لا قتلَ بلا قرينةٍ.
    return false;
  } else {
    return true; // لا عمليّةَ بهذا الرقمِ: زالت.
  }
  // الإشارةُ الأولى (SIGTERM) عبرَ المقبضةِ المرتبطةِ بالهويّةِ إن تيسّرتْ، وإلّا فبالرقمِ مع نافذةٍ معلَنةٍ:
  if (injectKillFailure) return false; // فشلُ إرسالٍ محقونٌ: ليسَ إثباتَ زوالٍ (كما كانَ يُرمى ويُلتقطُ)
  const viaPidfd = pidfdSignal(pid, 'SIGTERM', dir);
  if (viaPidfd === 'mismatch') return false; // الهويّةُ لم تُثبَتْ عبرَ المقبضةِ: لا إشارةَ
  if (viaPidfd !== 'esrch' && viaPidfd !== 'ok' && viaPidfd !== 'unsupported') return false;
  if (viaPidfd === 'unsupported') {
    // بديلُ الرقمِ: تحقّقٌ سابقٌ ثمّ إشارةٌ — نافذةٌ غيرُ ذرّيّةٍ معلَنةٌ لا مُغلَقةٌ (قيدُ البيئةِ).
    try {
      process.kill(pid, 'SIGTERM');
    } catch (e) {
      if (e && e.code === 'ESRCH') return true; // زالت قبلَ الإشارةِ
      return false; // رفضُ صلاحيّةٍ أو خطأٌ آخر: ليسَ إثباتَ زوالٍ
    }
  }
  for (let waited = 0; waited < graceMs; waited += 20) {
    if (!alive(pid)) return true;
    sleepMs(20);
  }
  // التصعيدُ (SIGKILL) لا يقعُ على الرقمِ وحدَهُ: الهويّةُ يُعادُ إثباتُها قبلَهُ — انتظارُنا فحصُ وجودٍ
  // بالرقمِ فقط، وقد يُعادُ استخدامُهُ لعمليّةٍ أخرى بينَ الإشارتَينِ (WL-416 جولةُ المراجعةِ الثانيةِ).
  const argsAtEscalation = readCmdline(pid);
  if (
    argsAtEscalation === null ||
    argsAtEscalation.length === 0 ||
    !argsAtEscalation[0].includes('swtpm') ||
    (dir !== null && !ownsStateDir(argsAtEscalation, dir))
  ) {
    return false; // الهويّةُ لم تُثبَتْ عندَ التصعيدِ: لا قتلَ لعمليّةٍ قد لا تكونَ مِلكَنا
  }
  if (injectKillFailure) return false; // فشلُ إرسالٍ محقونٌ عندَ التصعيدِ: ليسَ إثباتَ زوالٍ
  // التصعيدُ (SIGKILL) عبرَ المقبضةِ كذلك: الإشارةُ لا تقعُ على الرقمِ وحدَهُ أبدًا حيثُ تيسّرتِ القناةُ.
  const killViaPidfd = pidfdSignal(pid, 'SIGKILL', dir);
  if (killViaPidfd === 'mismatch') return false; // الهويّةُ لم تُثبَتْ عبرَ المقبضةِ: لا تصعيدَ
  if (killViaPidfd !== 'esrch' && killViaPidfd !== 'ok' && killViaPidfd !== 'unsupported')
    return false;
  if (killViaPidfd === 'unsupported') {
    try {
      process.kill(pid, 'SIGKILL');
    } catch (e) {
      if (e && e.code === 'ESRCH') return true;
      return false;
    }
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

// إنهاءُ محاولةٍ: العمليّةُ المقصودةُ هي ما يربطُهُ سطرُ أوامرِهِ بمسارِ الحالةِ. لا يُقتَلُ ما لا يُثبَتُ
// ملكُهُ، ولا يُعلَنَ التوقّفُ إلّا بزوالِ كلِّ عمليّةٍ مُثبَتِ الملكيّةِ (إعادةُ مسحٍ قرائيةٍ بعدَ الإنهاءِ).
function terminateAttempt({ pidFile, dir, injectKillFailure, readCmdline = procArgs }) {
  const pidFromFile = readPid(pidFile);
  let identityUnknown = false;
  let usedPidFile = false;
  if (pidFromFile !== null && alive(pidFromFile)) {
    usedPidFile = true;
    const args = readCmdline(pidFromFile);
    if (args === null || args.length === 0) {
      identityUnknown = true; // حيّةٌ ولا يُقرأُ سطرُ أوامرِها: الهويّةُ غيرُ قابلةٍ للإثباتِ
    } else if (args[0].includes('swtpm') && (dir === null || ownsStateDir(args, dir))) {
      // مِلكُنا المُعلَنُ من ملفِ PID ومربوطٌ بمسارِ الحالةِ: يُنهى ويُنتظرُ زوالُهُ.
      if (!killSim(pidFromFile, { dir, injectKillFailure, readCmdline })) identityUnknown = true;
    }
    // وإلا: الملفُّ يشيرُ إلى عمليّةٍ لا تربطُها بمسارِ حالتِنا — ليست مِلكَ هذا التشغيلِ فلا تُمسّ.
  }
  // غيابُ ملفِ PID ليسَ دليلَ توقّفٍ: الاكتشافُ البديلُ من /proc يربطُ العمليّةَ بمسارِ الحالةِ الفعليّ.
  // والاكتشافُ الفارغُ ليسَ إثباتَ موتٍ: عمليّةٌ حيّةٌ لا تُقرأُ هويّتُها تُبقي الحالةَ غيرَ محسومةٍ.
  const scan = scanStateDir(dir, { readCmdline });
  if (scan.unresolved.length > 0) identityUnknown = true;
  const discovered = scan.matches;
  const discoveryUsed = discovered.length > 0 || scan.unresolved.length > 0;
  for (const p of discovered) {
    if (!killSim(p, { dir, injectKillFailure, readCmdline })) identityUnknown = true;
  }
  // القرينةُ الإيجابيةُ: لا عمليّةَ swtpm حيّةً تملكُ مسارَ الحالةِ بعدَ الإنهاءِ ولا عمليّةً غيرَ محسومةِ.
  const remaining = scanStateDir(dir, { readCmdline });
  return {
    stopped:
      !identityUnknown && remaining.matches.length === 0 && remaining.unresolved.length === 0,
    identityUnknown,
    discoveryUsed,
    usedPidFile,
  };
}

// opts: prefix (بادئةُ مجلّدِ الحالةِ)، portBase، bindaddr، attempts (8)، readyTries (10)، readyDelayMs (1000)،
// probe(port) ⇒ boolean (افتراضيًّا tpm2_getcap)، onAbandon({pid, dir, port, stopped, reason}) لمراقبةِ الاختبارِ،
// label للخطأ، afterSpawn({pid, dir, pidFile}) بعدَ الإطلاقِ وقبلَ الجاهزيّةِ (للاختباراتِ)،
// injectKillFailure (للاختبارِ: محاكاةُ فشلِ الإشارةِ).
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
    afterSpawn = null,
    injectKillFailure = false,
    readCmdline = null,
  } = opts;
  for (let attempt = 0; attempt < attempts; attempt++) {
    const dir = mkdtempSync(join(tmpdir(), prefix));
    const port = portBase + 2 * Math.floor(Math.random() * 150);
    const pidFile = join(dir, 'swtpm.pid');
    let launchError = null;
    let abandonReason = null;
    let r = null;
    try {
      r = spawnSync(
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
    } catch (e) {
      launchError = e;
      abandonReason = 'spawn-threw';
    }
    if (launchError === null) {
      // حتى عندَ خروجٍ غيرِ صفريٍّ قد يكونُ ملفُّ pid كُتب: يُنهى ما وُجدَ قبلَ أيِّ قرارٍ على المجلّدِ.
      if (r.status !== 0) abandonReason = 'spawn-failed';
      else {
        try {
          if (afterSpawn) afterSpawn({ pid: readPid(pidFile), dir, pidFile });
          let ready = false;
          // رميُ probe استثناءً لا يتجاوزُ التنظيفَ: كلُّ ما بعدَ الإطلاقِ يمرُّ عبرَ مسارِ الإنهاءِ نفسِهِ.
          for (let i = 0; i < readyTries; i++) {
            if (probe(port)) {
              ready = true;
              break;
            }
            if (i + 1 < readyTries) sleepMs(readyDelayMs);
          }
          const pid = readPid(pidFile);
          if (!ready) abandonReason = 'not-ready';
          else if (pid === null) abandonReason = 'no-pid';
          else return { dir, port, pidFile, pid };
        } catch (e) {
          launchError = e;
          abandonReason = 'exception-after-launch';
        }
      }
    }
    // ── مسارُ الإنهاءِ الموحّدُ لكلِّ محاولةٍ لم تُسلَّمْ: إثباتُ الزوالِ أولًا، ثمّ المراقبُ، ثمّ الحذفُ ──
    // المقبضُ يُقرأُ قبلَ الإنهاءِ: swtpm يحذفُ ملفَ PID بنفسِهِ عندَ توقّفِهِ الرشيقِ فلا يُقرأُ بعدهُ.
    const pidBeforeTermination = readPid(pidFile);
    let stopped = false;
    let cleanupError = null;
    let callbackError = null;
    try {
      stopped = terminateAttempt({
        pidFile,
        dir,
        injectKillFailure,
        readCmdline: readCmdline || procArgs,
      }).stopped;
    } catch (e) {
      cleanupError = e; // فشلُ الإنهاءِ نفسِه: يُحفَظُ ولا يُعلَنَ نجاحًا
    }
    // المراقبُ بعدَ الإنهاءِ وقبلَ الحذفِ: فشلُهُ لا يتجاوزُ التنظيفَ ولا يُخفيهِ.
    if (onAbandon) {
      try {
        onAbandon({ pid: pidBeforeTermination, dir, port, stopped, reason: abandonReason });
      } catch (e) {
        callbackError = e;
      }
    }
    // الحذفَ بعدَ إثباتِ الزوالِ وحدَهُ: بقيّةُ عمليّةٍ أو هويّةٍ غيرِ مثبَتةٍ ⇒ يُحفَظُ المجلّدُ دليلًا ويُوقَفُ
    // المسارُ مغلقًا — لا محاولةً تاليةً تُطلقُ محاكياتٍ فوقَ عمليّةٍ لم يُثبَتْ زوالُها.
    if (stopped) {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch (e) {
        cleanupError = cleanupError || e;
      }
    } else {
      cleanupError =
        cleanupError ||
        new Error(
          `${label}: simulator process not proven stopped (state dir kept as evidence: ${dir}); refusing to retry or delete`,
        );
    }
    if (cleanupError) throw cleanupError; // فشلُ التنظيفِ لا يُبتلَعُ خلفَ خطأٍ أصليٍّ ولا يجاورُهُ صامتًا
    if (callbackError) throw callbackError; // وفشلُ المراقبِ يظهرُ بعدَ اكتمالِ التنظيفِ
    if (launchError) throw launchError; // الاستثناءُ الأصليُّ يُعادُ رميُهُ بعدَ تنظيفٍ مضمونٍ
  }
  throw new Error(label + ': تعذّرَ تشغيلُ محاكٍ معزول');
}

// قتلُ عمليّةِ المحاكي وانتظارُ زوالِها قبلَ حذفِ مجلّدِ الحالةِ (الحذفُ وحدَه ترك 21 يتيمًا — WL-413 R3).
// الحذفَ بعدَ إثباتِ الزوالِ فقط: تعذّرَ الإيقافُ أو تعذّرَ إثباتُ الهويّةِ ⇒ يُحفَظُ المجلّدُ ويُعادَ false.
export function stopSim(s) {
  if (!s) return true;
  const stopped = killSim(s.pid, { dir: s.dir });
  if (stopped !== true) return false;
  try {
    rmSync(s.dir, { recursive: true, force: true });
  } catch {
    /* أفضلُ جهدٍ — الزوالُ مثبتٌ فلا يتيمَ */
  }
  return true;
}

// للاختبار: هل مجلّدُ الحالةِ ما زالَ على القرصِ؟ (شاهدُ ترتيبِ الحذفِ بعدَ زوالِ العمليّةِ)
export function stateDirExists(dir) {
  return existsSync(dir);
}

// للاختبار: هل توجدُ عمليّةُ swtpm حيّةٌ تحملُ هذا المسارَ في سطرِ أوامرِها؟ (قراءةُ /proc فقط)
export function swtpmProcessesWithPath(path) {
  const r = spawnSync('pgrep', ['-af', '--', 'swtpm'], { encoding: 'utf8' });
  return String(r.stdout || '')
    .split('\n')
    .filter((l) => l.includes(path));
}
