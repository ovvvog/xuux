/**
 * العزل التنفيذي الحقيقي — M6.04
 *
 * العيب الذي تعالجه: العملية الابن المحدودة في `limits.mjs` تملك قبل هذه الوحدة
 * شبكة الأب ونظام ملفاته؛ فالمهلة وحدّ الكومة لا يمنعان مُعالِجاً مارقاً من إخراج
 * بيانات أو تعديل ملفٍ خارج مهمته. هذه الوحدة لا «تثق» بالمُعالِج: تبدأ عمليةً في
 * مساحات أسماء Linux جديدة، وتبني لها جذر tmpfs لا يُربط فيه إلا زمن التشغيل
 * ومجلد العمل للقراءة ومجلد كتابة واحد صريح.
 *
 * لا توجد عودة صامتة إلى تشغيل غير معزول. إن غاب `unshare` أو رفضت النواة مساحة
 * المستخدم، تعيد `runIsolated` نتيجة `ISOLATION_UNSUPPORTED` ولا تبدأ الحمولة.
 *
 * مثال (المسارات التي تحت `workdir` تُرى داخل العزل تحت `/workspace`):
 *
 *   const result = await runIsolated({
 *     command: '/usr/local/bin/node',
 *     args: ['/workspace/job.mjs'],
 *     workdir: '/srv/jobs/42',
 *     writableDir: '/srv/jobs/42/output',
 *     log,
 *   });
 *
 * حدود معلنة:
 * - هذا مسار Linux فقط؛ المنصات بلا user/mount/network namespaces تُرفض مغلقة.
 * - جذر الحمولة tmpfs، فلا تُنقل ملفات `writableDir` إلى الأم إلا إن كتبها
 *   المُعالِج صراحةً فيه. لا تُنفّذ هذه الوحدة نسخةً احتياطية أو مسحاً للمخرجات.
 * - `ulimit -v` سقف ذاكرة افتراضية و`ulimit -u` سقف عمليات، لا بديل عن cgroups
 *   للمحاسبة الدقيقة للذاكرة المقيمة أو مجموع العمليات عبر حاويات متعددة.
 * - لا يُوصَل هذا المنفّذ بـ`worker.mjs` أو `handlers.mjs` هنا؛ قرار اختيار
 *   المُعالِج ونقطة التفويض يبقيان خطوة وصلٍ لاحقة، كي لا يُفتح مسار تنفيذ جديد
 *   بلا مراجعة عقده.
 */

import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { reportAwaitingSeal } from '../governance/quarantine.mjs';

const DEFAULT_TIMEOUT_MS = 10_000;
// يحتاج Node في بيئة المشروع حجز مساحة عناوين أولية تقارب 768MB؛ حدّ أصغر يفشل
// قبل أن تبدأ الحمولة، فيثبت خطأ إعداد لا حدّ ذاكرة للحمولة.
const DEFAULT_MEMORY_LIMIT_MB = 1_024;
const DEFAULT_MAX_FILE_SIZE_MB = 16;
const DEFAULT_PROCESS_LIMIT = 64;
const OUTPUT_LIMIT_BYTES = 1_048_576;

/** رموز الرفض والنتائج؛ النص العربي في `IsolationError` أو `message`. */
export const ISOLATION_ERRORS = Object.freeze({
  DEPENDENCY_MISSING: 'ISOLATION_DEPENDENCY_MISSING',
  UNSUPPORTED: 'ISOLATION_UNSUPPORTED',
  REQUEST_INVALID: 'ISOLATION_REQUEST_INVALID',
  COMMAND_INVALID: 'ISOLATION_COMMAND_INVALID',
  WORKDIR_INVALID: 'ISOLATION_WORKDIR_INVALID',
  WRITABLE_DIR_INVALID: 'ISOLATION_WRITABLE_DIR_INVALID',
  TIMEOUT: 'ISOLATION_TIMEOUT',
  CANCELLED: 'ISOLATION_CANCELLED',
  RESOURCE_LIMIT: 'ISOLATION_RESOURCE_LIMIT',
  ESCAPE_BLOCKED: 'ISOLATION_ESCAPE_BLOCKED',
  COMMAND_FAILED: 'ISOLATION_COMMAND_FAILED',
});

/** خطأ مُسمّى للمدخلات التي لا يمكن بدء عملية آمنة معها. */
export class IsolationError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   * @param {Record<string, unknown>} [detail]
   */
  constructor(code, message, detail = {}) {
    super(message);
    this.name = 'IsolationError';
    /** @type {string} */
    this.code = code;
    /** @type {Record<string, unknown>} */
    this.detail = detail;
  }
}

/**
 * نصّ منفّذ العزل داخل `unshare`. لا يأخذ من المضيف إلا مساراتٍ مرّت من التحقق؛
 * ولا يستعمل توسعة نصية للحمولة، لذلك لا يحوّل args إلى shell code.
 */
const NAMESPACE_RUNNER = String.raw`
ROOT="$1"
WORKDIR="$2"
WRITABLE_DIR="$3"
RUNTIME_COMMAND="$4"
MEMORY_KB="$5"
FILE_KB="$6"
PROCESS_LIMIT="$7"
CPU_SECONDS="$8"
COMMAND="$9"
shift 9

mount --make-rprivate /
mount -t tmpfs -o "size=$((MEMORY_KB / 2))k,nosuid,nodev" tmpfs "$ROOT"
mkdir -p "$ROOT/usr" "$ROOT/usr/local" "$ROOT/lib" "$ROOT/lib64" "$ROOT/bin" "$ROOT/sbin" "$ROOT/workspace" "$ROOT/proc" "$ROOT/dev" "$ROOT/runtime"
for directory in /usr /usr/local /lib /lib64 /bin /sbin; do
  [ -e "$directory" ] || continue
  mount --bind "$directory" "$ROOT$directory"
  mount -o remount,bind,ro "$ROOT$directory"
done
if [ -n "$RUNTIME_COMMAND" ]; then
  : > "$ROOT/runtime/runner"
  mount --bind "$RUNTIME_COMMAND" "$ROOT/runtime/runner"
  mount -o remount,bind,ro "$ROOT/runtime/runner"
fi
mount --bind "$WORKDIR" "$ROOT/workspace"
mkdir -p "$ROOT/workspace/output"
mount -o remount,bind,ro "$ROOT/workspace"
mount --bind "$WRITABLE_DIR" "$ROOT/workspace/output"
mount -o remount,bind,rw "$ROOT/workspace/output"
mount -t proc proc "$ROOT/proc"
for device in null zero random urandom; do
  : > "$ROOT/dev/$device"
  mount --bind "/dev/$device" "$ROOT/dev/$device"
  mount -o remount,bind,ro "$ROOT/dev/$device"
done

exec prlimit \
  --as="$((MEMORY_KB * 1024))" \
  --fsize="$((FILE_KB * 1024))" \
  --nproc="$PROCESS_LIMIT" \
  --cpu="$CPU_SECONDS" \
  -- chroot "$ROOT" /usr/bin/env -i \
  PATH=/usr/local/bin:/usr/bin:/bin \
  HOME=/workspace/output \
  ISOLATION_WORKDIR=/workspace \
  ISOLATION_WRITABLE_DIR=/workspace/output \
  /bin/sh -ceu 'cd "$ISOLATION_WORKDIR"; exec "$@"' isolation-command "$COMMAND" "$@"
`;

/**
 * @typedef {object} IsolationProbe
 * @property {boolean} available
 * @property {string | null} code
 * @property {string} reason
 * @property {string} command
 */

/**
 * يفحص القدرة بالفعل، لا بوجود ملف `unshare` فقط: قد يكون الأمر موجوداً وتمنع
 * سياسة المضيف إنشاء مساحة مستخدم، وعندئذٍ لا يوجد عزل قابل للاعتماد.
 * @returns {IsolationProbe}
 */
export function probeIsolation() {
  if (process.platform !== 'linux') {
    return {
      available: false,
      code: ISOLATION_ERRORS.UNSUPPORTED,
      reason: 'العزل يحتاج Linux namespaces؛ المنصة الحالية ليست Linux فلا يُشغَّل شيء بلا عزل.',
      command: 'unshare',
    };
  }
  const probe = spawnSync(
    'unshare',
    ['--map-root-user', '--net', '--mount', '--pid', '--fork', '--mount-proc', '--', 'true'],
    { encoding: 'utf8', timeout: 3_000 },
  );
  if (probe.error !== undefined || probe.status !== 0) {
    const reason = String(
      probe.stderr || probe.error?.message || `رمز الخروج ${String(probe.status)}`,
    )
      .trim()
      .slice(0, 500);
    return {
      available: false,
      code: ISOLATION_ERRORS.UNSUPPORTED,
      reason: `تعذّر إنشاء user/mount/network/pid namespaces: ${reason || 'رفضت النواة الطلب'}. الرفض مقصود لأن التنفيذ بلا عزل غير مقبول.`,
      command: 'unshare',
    };
  }
  return {
    available: true,
    code: null,
    reason: 'مساحات الأسماء المطلوبة متاحة.',
    command: 'unshare',
  };
}

/** @param {unknown} value @param {string} field @returns {number} */
function positiveInteger(value, field) {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new IsolationError(
      ISOLATION_ERRORS.REQUEST_INVALID,
      `${field} يجب أن يكون عدداً صحيحاً موجباً؛ حدٌّ غامض يُقرأ بلا حدّ وهذا مرفوض.`,
    );
  }
  return value;
}

/** @param {string} candidate @param {string} workdir @returns {string} */
function isolatedPath(candidate, workdir) {
  if (!path.isAbsolute(candidate)) return candidate;
  const relative = path.relative(workdir, candidate);
  if (relative === '') return '/workspace';
  if (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative)) {
    return path.posix.join('/workspace', relative.split(path.sep).join('/'));
  }
  // مسارات النظام المربوطة للقراءة فقط متاحة داخل الجذر؛ وأي مسار مضيف آخر
  // لا يُمرَّر خفيةً. مسار Node الذي أطلق الاختبار/المشغّل استثناءٌ محدود:
  // يُربط كملف واحد إلى /runtime/runner للقراءة فقط، لا كمجلد runtime كامل.
  if (/^\/(usr|bin|sbin|lib|lib64)(\/|$)/.test(candidate)) return candidate;
  if (candidate === process.execPath) return '/runtime/runner';
  throw new IsolationError(
    ISOLATION_ERRORS.COMMAND_INVALID,
    `المسار ${candidate} خارج workdir وليس من زمن التشغيل المربوط للقراءة فقط؛ لا يُمرَّر مسار مضيف خفي إلى المعزول.`,
  );
}

/**
 * @param {unknown} log
 * @returns {{ append: (type: string, actor: string, payload: object) => unknown }}
 */
function requireLog(log) {
  if (!log || typeof (/** @type {{ append?: unknown }} */ (log).append) !== 'function') {
    throw new IsolationError(
      ISOLATION_ERRORS.DEPENDENCY_MISSING,
      'العزل يحتاج سجل أحداث: تنفيذٌ أو رفضٌ بلا أثر تدقيقي غير مقبول.',
    );
  }
  return /** @type {{ append: (type: string, actor: string, payload: object) => unknown }} */ (log);
}

/** @param {string} stderr @returns {'network' | 'filesystem' | null} */
function escapeKind(stderr) {
  if (/ENETUNREACH|EAI_AGAIN|ENETDOWN|EHOSTUNREACH|network is unreachable/i.test(stderr))
    return 'network';
  if (/\bEROFS\b|\bEACCES\b|read-only file system|permission denied/i.test(stderr))
    return 'filesystem';
  return null;
}

/**
 * @typedef {object} IsolatedRun
 * @property {boolean} ok
 * @property {string | null} code
 * @property {string} message
 * @property {string} stdout
 * @property {string} stderr
 * @property {number} durationMs
 * @property {number | null} exitCode
 * @property {string | null} signal
 * @property {boolean} killed
 */

/**
 * يشغّل حمولة في جذر read-only بلا شبكة وبمساحات user/mount/network/pid جديدة.
 * `command` أو `handler` اسم تنفيذ لا دالة JavaScript: الدوال في ذاكرة الأب لا
 * تعبر حدّ العملية، وقبولها يوهم بعزلٍ لا يحدث. يستعمل `handler` مرادفاً لفظياً
 * لمسار أمر كي يدعم مستدعي سجلّ المعالجات.
 *
 * @param {{ command?: string, handler?: string, args?: readonly string[], workdir: string, writableDir: string, timeoutMs?: number, memoryLimitMb?: number, maxFileSizeMb?: number, processLimit?: number, actor?: string, signal?: AbortSignal, log: { append: (type: string, actor: string, payload: object) => unknown }, quarantine?: import('../governance/quarantine.mjs').QuarantineReporter | null }} request
 * @returns {Promise<IsolatedRun>}
 */
export async function runIsolated(request) {
  const log = requireLog(request?.log);
  const actor =
    typeof request?.actor === 'string' && request.actor.trim() !== ''
      ? request.actor
      : 'system:isolation';
  const probe = probeIsolation();
  if (!probe.available) {
    const result = {
      ok: false,
      code: ISOLATION_ERRORS.UNSUPPORTED,
      message: probe.reason,
      stdout: '',
      stderr: '',
      durationMs: 0,
      exitCode: null,
      signal: null,
      killed: false,
    };
    log.append('isolation.refused', actor, {
      code: result.code,
      reason: result.message,
      phase: 'probe',
    });
    return result;
  }

  const command = request.command ?? request.handler;
  if (
    typeof command !== 'string' ||
    command.trim() === '' ||
    (request.command && request.handler)
  ) {
    throw new IsolationError(
      ISOLATION_ERRORS.COMMAND_INVALID,
      'يلزم command أو handler واحد غير فارغ؛ اختيارٌ غامض قد يشغّل حمولة غير مقصودة.',
    );
  }
  if (!Array.isArray(request.args) && request.args !== undefined) {
    throw new IsolationError(
      ISOLATION_ERRORS.REQUEST_INVALID,
      'args يجب أن تكون مصفوفة نصوص؛ لا تُحوّل مدخلات غامضة إلى shell.',
    );
  }
  const args = request.args ?? [];
  if (!args.every((value) => typeof value === 'string')) {
    throw new IsolationError(
      ISOLATION_ERRORS.REQUEST_INVALID,
      'كل عنصر في args يجب أن يكون نصاً؛ الكائنات لا تُحوّل إلى أوامر.',
    );
  }

  if (typeof request.workdir !== 'string' || typeof request.writableDir !== 'string') {
    throw new IsolationError(
      ISOLATION_ERRORS.REQUEST_INVALID,
      'workdir وwritableDir مساران صريحان؛ لا يوجد مجلد كتابة افتراضي.',
    );
  }
  let workdir;
  let writableDir;
  try {
    workdir = fs.realpathSync(request.workdir);
  } catch {
    throw new IsolationError(
      ISOLATION_ERRORS.WORKDIR_INVALID,
      'مجلد العمل غير موجود؛ لا نبني عزلاً على مسار متخيَّل.',
    );
  }
  try {
    writableDir = fs.realpathSync(request.writableDir);
  } catch {
    throw new IsolationError(
      ISOLATION_ERRORS.WRITABLE_DIR_INVALID,
      'مجلد الكتابة المعلن غير موجود؛ رفضُه يمنع سقوطاً إلى كتابة أوسع.',
    );
  }
  if (!fs.statSync(workdir).isDirectory()) {
    throw new IsolationError(
      ISOLATION_ERRORS.WORKDIR_INVALID,
      'workdir يجب أن يكون مجلداً ليربط للقراءة فقط.',
    );
  }
  if (!fs.statSync(writableDir).isDirectory()) {
    throw new IsolationError(
      ISOLATION_ERRORS.WRITABLE_DIR_INVALID,
      'writableDir يجب أن يكون مجلداً مستقلاً للكتابة.',
    );
  }
  const writableRelative = path.relative(workdir, writableDir);
  if (
    writableRelative === '' ||
    writableRelative === '..' ||
    writableRelative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(writableRelative)
  ) {
    throw new IsolationError(
      ISOLATION_ERRORS.WRITABLE_DIR_INVALID,
      'writableDir يجب أن يكون ابناً من workdir لا workdir نفسه ولا مساراً خارجه؛ وإلا صار جذر المصدر قابلاً للكتابة.',
    );
  }

  const timeoutMs = positiveInteger(request.timeoutMs ?? DEFAULT_TIMEOUT_MS, 'timeoutMs');
  const memoryLimitMb = positiveInteger(
    request.memoryLimitMb ?? DEFAULT_MEMORY_LIMIT_MB,
    'memoryLimitMb',
  );
  const maxFileSizeMb = positiveInteger(
    request.maxFileSizeMb ?? DEFAULT_MAX_FILE_SIZE_MB,
    'maxFileSizeMb',
  );
  const processLimit = positiveInteger(
    request.processLimit ?? DEFAULT_PROCESS_LIMIT,
    'processLimit',
  );
  const commandInJail = isolatedPath(command, workdir);
  const runtimeCommand = command === process.execPath ? command : '';
  const argsInJail = args.map((value) => isolatedPath(value, workdir));
  const sandboxRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'xuux-isolation-'));
  const startedAt = Date.now();

  log.append('isolation.started', actor, {
    command: commandInJail,
    timeoutMs,
    memoryLimitMb,
    maxFileSizeMb,
    processLimit,
    network: 'disabled',
    workdir: '/workspace',
    writableDir: '/workspace/output',
  });

  return await new Promise((resolve, reject) => {
    const child = spawn(
      'unshare',
      [
        '--map-root-user',
        '--net',
        '--mount',
        '--pid',
        '--fork',
        '--mount-proc',
        '--',
        'sh',
        '-ceu',
        NAMESPACE_RUNNER,
        'isolation-runner',
        sandboxRoot,
        workdir,
        writableDir,
        runtimeCommand,
        String(memoryLimitMb * 1024),
        String(maxFileSizeMb * 1024),
        String(processLimit),
        String(Math.max(1, Math.ceil(timeoutMs / 1_000))),
        commandInJail,
        ...argsInJail,
      ],
      { detached: true, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let stdout = '';
    let stderr = '';
    let killed = false;
    let timedOut = false;
    let cancelled = false;
    let settled = false;
    const childPid = child.pid;
    /** @param {string} chunk @param {'stdout' | 'stderr'} stream */
    function collect(chunk, stream) {
      const current = stream === 'stdout' ? stdout : stderr;
      const next = `${current}${chunk}`;
      if (stream === 'stdout') stdout = next.slice(-OUTPUT_LIMIT_BYTES);
      else stderr = next.slice(-OUTPUT_LIMIT_BYTES);
    }
    child.stdout?.on('data', (chunk) => collect(String(chunk), 'stdout'));
    child.stderr?.on('data', (chunk) => collect(String(chunk), 'stderr'));
    /** @param {string} reason */
    const terminate = (reason) => {
      killed = true;
      if (childPid === undefined) {
        stderr += `\nلم تنشئ عملية unshare معرّفاً للإيقاف (${reason}).`;
        return;
      }
      try {
        process.kill(-childPid, 'SIGTERM');
      } catch (error) {
        stderr += `\nلم يُرسل SIGTERM: ${error instanceof Error ? error.message : String(error)}`;
      }
      setTimeout(() => {
        try {
          process.kill(-childPid, 'SIGKILL');
        } catch (error) {
          if (/** @type {NodeJS.ErrnoException} */ (error).code !== 'ESRCH') {
            stderr += `\nلم يُرسل SIGKILL: ${error instanceof Error ? error.message : String(error)}`;
          }
        }
      }, 200).unref();
    };
    const timer = setTimeout(() => {
      timedOut = true;
      terminate('timeout');
    }, timeoutMs);
    timer.unref();
    const abortHandler = () => {
      if (settled || timedOut) return;
      cancelled = true;
      terminate('abort');
    };
    if (request.signal?.aborted) abortHandler();
    else request.signal?.addEventListener('abort', abortHandler, { once: true });

    child.on('error', (error) => {
      stderr += `\nتعذّر بدء unshare: ${error.message}`;
    });
    child.on('close', (exitCode, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      request.signal?.removeEventListener('abort', abortHandler);
      fs.rmSync(sandboxRoot, { recursive: true, force: true });
      const durationMs = Date.now() - startedAt;
      /** @type {IsolatedRun} */
      const result = {
        ok: false,
        code: null,
        message: '',
        stdout,
        stderr,
        durationMs,
        exitCode,
        signal,
        killed,
      };
      if (timedOut) {
        result.code = ISOLATION_ERRORS.TIMEOUT;
        result.message = `تجاوزت الحمولة مهلة ${timeoutMs}ms فقُتلت شجرة العملية المعزولة.`;
        log.append('isolation.timeout', actor, {
          code: result.code,
          timeoutMs,
          durationMs,
          signal,
        });
      } else if (cancelled) {
        result.code = ISOLATION_ERRORS.CANCELLED;
        result.message = 'أُلغي التنفيذ المعزول بعد سحب العقد أو طلب الإلغاء.';
        log.append('isolation.cancelled', actor, { code: result.code, durationMs, signal });
      } else if (exitCode === 0) {
        result.ok = true;
        result.message = 'أُنجزت الحمولة داخل namespaces بلا شبكة وبجذر قراءة فقط.';
        log.append('isolation.completed', actor, {
          durationMs,
          exitCode,
          stdoutBytes: Buffer.byteLength(stdout),
        });
      } else {
        const blocked = escapeKind(stderr);
        const resource =
          /out of memory|fatal process oom|cannot allocate memory|file size limit exceeded|\bEFBIG\b|\bSIGXFSZ\b/i.test(
            stderr,
          );
        result.code = blocked
          ? ISOLATION_ERRORS.ESCAPE_BLOCKED
          : resource
            ? ISOLATION_ERRORS.RESOURCE_LIMIT
            : ISOLATION_ERRORS.COMMAND_FAILED;
        result.message = blocked
          ? `أوقفت النواة محاولة هروب عبر ${blocked === 'network' ? 'الشبكة المعطّلة' : 'نظام الملفات للقراءة فقط'}.`
          : resource
            ? 'بلغت الحمولة حدّ الموارد المفروض عليها، فتوقّفت داخل العزل.'
            : `خرجت الحمولة المعزولة برمز ${String(exitCode)} وإشارة ${String(signal)}.`;
        log.append('isolation.refused', actor, {
          code: result.code,
          durationMs,
          exitCode,
          signal,
          reason: result.message,
        });
        if (blocked) {
          log.append('isolation.escape-blocked', actor, {
            code: result.code,
            kind: blocked,
            durationMs,
          });
          if (request.quarantine !== null && request.quarantine !== undefined) {
            // `LIVE-27` / `R10-F-04` (‏`WL-309`): كانَ `report` المتزامنُ يُرَدُّ على الحاجبِ
            // الإنتاجيِّ **داخلَ مستمعِ `close`** فيصيرُ استثناءً غيرَ ملتقَطٍ لا رفضاً. فالإشارةُ
            // تُنتظَرُ حتّى يُختَمَ قيدُها ثمّ تُعادُ النتيجة، وفشلُ الختمِ يُرفَضُ به الوعدُ ولا يُبتلَع.
            reportAwaitingSeal(request.quarantine, {
              // نوع قائم في QuarantineWarden: محاولة الخروج المحجوبة إشارة خروج مرفوض.
              kind: 'egress-refused',
              subject: actor,
              detail: { source: 'isolation', escape: blocked, code: result.code },
            }).then(() => resolve(result), reject);
            return;
          }
        }
      }
      resolve(result);
    });
  });
}
