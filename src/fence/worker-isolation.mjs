/**
 * عزلُ عمليةِ العاملِ عن عملياتِ الـUID نفسِه (`WL-533`، علاجُ `LAB-UID-05`).
 *
 * المشكلةُ المقيسةُ في `WL-532`: مفتاحُ العاملِ ملفٌّ 0400 **يملكُه مستخدمُ العامل**، والعاملُ يُشغَّلُ
 * مباشرةً بذلك المستخدم (‏`sudo -u` / `fork({uid})`). فأيُّ عمليةٍ أخرى بالـUID نفسِه تقرأُ المفتاح،
 * وتقرأُ `/proc/<pid>/environ|mem|fd`، وتستطيعُ `ptrace` العامل (لا Yama هنا)، فتسبقُه إلى الختم.
 *
 * العلاجُ هنا — **آليّةُ النواةِ نفسُها، لا ادّعاءٌ فوقَها**:
 *  1. المفتاحُ لا يكونُ ملفًّا يقرؤه مستخدمُ العامل: المُشرِفُ (root) يفتحُه ويمرّرُه **واصفاً موروثاً**
 *     (`XUUX_FENCE_KEY_FD`، عادةً 3). العاملُ يقرؤه ثمّ يغلقُ الواصف.
 *  2. العاملُ يبدأُ بـroot ويُسقِطُ هويّتَه **داخلَ العملية** (‏`setgroups`→`setgid`→`setuid`). تغييرُ
 *     الاعتمادِ بعدَ `execve` يجعلُ النواةَ تضبطُ `dumpable = fs.suid_dumpable` (‏`proc(5)`،
 *     ‏`prctl(2)` PR_SET_DUMPABLE)، فتصيرُ ملفّاتُ `/proc/<pid>` ملكَ root ويُرفَضُ `ptrace` و
 *     `pidfd_getfd` من الـUID نفسِه. أمّا `spawn({uid})` فيضبطُ الـUID **قبلَ** `execve` فيعودُ
 *     `dumpable = 1` — ولذلك هو مرفوضٌ هنا.
 *  3. تحقّقٌ لاحقٌ يفشلُ مغلقاً: الهويّاتُ الأربعُ = المطلوبة، القدراتُ صفر، `setuid(0)` مرفوض،
 *     و`/proc/self/environ` ملكُ root (دليلُ `dumpable ≠ 1`)، و`fs.suid_dumpable ∈ {0,2}`.
 *
 * **ما لا يحميه (حدٌّ معلن):** root ومن يملكُ `CAP_SYS_PTRACE`؛ اختراقُ العاملِ نفسِه (شيفرةٌ تعملُ
 * داخلَه تملكُ المفتاحَ في ذاكرته)؛ إشاراتُ القتلِ من الـUID نفسِه (توفّرٌ لا سلامة)؛ ودخولُ عمليةٍ
 * أخرى بدورِ الإقلاعِ بلا سرٍّ قبلَ الختم (‏`peer`) — وهذا يُفشِلُ الختمَ ويكشفُه `LAB-UID-02`، ولا
 * يمنحُ كتابة. لا يُثبتُ هويّةَ العمليةِ أمامَ root، ولا يدّعي حمايةً عتاديّة.
 */

import { closeSync, readFileSync, statSync } from 'node:fs';
import process from 'node:process';

import { FenceError, pemKeyProvider } from './db-fence.mjs';

export const ISOLATION_ERRORS = Object.freeze({
  NOT_PRIVILEGED: 'FENCE_ISOLATION_NOT_PRIVILEGED',
  CONFIG: 'FENCE_ISOLATION_CONFIG',
  DUMPABLE_POLICY: 'FENCE_ISOLATION_SUID_DUMPABLE',
  VERIFY_FAILED: 'FENCE_ISOLATION_VERIFY_FAILED',
});

/** المتغيّراتُ التي يحدّدُها المُشرِف. لا يحملُ أيٌّ منها سرًّا. */
export const ISOLATION_ENV = Object.freeze({
  keyFd: 'XUUX_FENCE_KEY_FD',
  uid: 'XUUX_FENCE_WORKER_UID',
  gid: 'XUUX_FENCE_WORKER_GID',
});

/**
 * @typedef {{
 *   getuid(): number, geteuid(): number, getgid(): number, getegid(): number,
 *   setgroups(g: number[]): void, setgid(g: number): void, setuid(u: number): void,
 *   readFd(fd: number): string, closeFd(fd: number): void,
 *   readText(path: string): string, ownerOf(path: string): number,
 * }} IsolationOs
 */

/** @type {IsolationOs} */
const realOs = {
  getuid: () => /** @type {any} */ (process).getuid(),
  geteuid: () => /** @type {any} */ (process).geteuid(),
  getgid: () => /** @type {any} */ (process).getgid(),
  getegid: () => /** @type {any} */ (process).getegid(),
  setgroups: (g) => /** @type {any} */ (process).setgroups(g),
  setgid: (g) => /** @type {any} */ (process).setgid(g),
  setuid: (u) => /** @type {any} */ (process).setuid(u),
  readFd: (fd) => readFileSync(fd, 'utf8'),
  closeFd: (fd) => closeSync(fd),
  readText: (p) => readFileSync(p, 'utf8'),
  ownerOf: (p) => statSync(p).uid,
};

/**
 * @param {NodeJS.ProcessEnv} env
 * @returns {boolean} هل طلبَ المُشرِفُ العزل؟
 */
export function isolationRequested(env) {
  return (env[ISOLATION_ENV.keyFd] ?? '').trim() !== '';
}

/** @param {NodeJS.ProcessEnv} env @param {string} name */
function positiveInt(env, name) {
  const raw = (env[name] ?? '').trim();
  if (!/^[0-9]+$/.test(raw) || Number(raw) <= 0 || !Number.isSafeInteger(Number(raw))) {
    throw new FenceError(
      ISOLATION_ERRORS.CONFIG,
      `${name} يجبُ أن يكونَ عدداً موجباً (لا root): «${raw}».`,
    );
  }
  return Number(raw);
}

/**
 * يقرأُ مفتاحَ العاملِ من الواصفِ الموروث، ويُسقِطُ الهويّة، ويتحقّق. يُستدعى **أوّلَ** شيءٍ في
 * العامل — قبلَ أيِّ ملفٍّ أو وصلةٍ أو مصافحة.
 * @param {NodeJS.ProcessEnv} env
 * @param {{ os?: IsolationOs, workerId?: string }} [options]
 */
export function isolateWorkerProcess(env, options = {}) {
  const os = options.os ?? realOs;
  if ((env['XUUX_FENCE_WORKER_KEY'] ?? '').trim() !== '') {
    throw new FenceError(
      ISOLATION_ERRORS.CONFIG,
      'XUUX_FENCE_WORKER_KEY و XUUX_FENCE_KEY_FD معاً: مسارُ ملفِّ المفتاحِ يُلغي العزلَ ويُرفَض.',
    );
  }
  const fdRaw = (env[ISOLATION_ENV.keyFd] ?? '').trim();
  if (!/^[3-9]$|^[1-9][0-9]+$/.test(fdRaw)) {
    throw new FenceError(ISOLATION_ERRORS.CONFIG, `${ISOLATION_ENV.keyFd} غيرُ صالح: «${fdRaw}».`);
  }
  const fd = Number(fdRaw);
  const uid = positiveInt(env, ISOLATION_ENV.uid);
  const gid = positiveInt(env, ISOLATION_ENV.gid);
  if (os.geteuid() !== 0 || os.getuid() !== 0) {
    throw new FenceError(
      ISOLATION_ERRORS.NOT_PRIVILEGED,
      'العزلُ يتطلّبُ أن يبدأَ العاملُ بـroot ويُسقِطَ هويّتَه بنفسِه: عمليةٌ بُدئت بمستخدمِ العاملِ ' +
        'مباشرةً (dumpable=1) يقرؤها أيُّ عمليةٍ بالـUID نفسِه (LAB-UID-05).',
    );
  }
  const suidDumpable = os.readText('/proc/sys/fs/suid_dumpable').trim();
  if (suidDumpable !== '0' && suidDumpable !== '2') {
    throw new FenceError(
      ISOLATION_ERRORS.DUMPABLE_POLICY,
      `fs.suid_dumpable=${suidDumpable}: بعدَ إسقاطِ الهويّةِ تبقى العمليةُ قابلةً للتفريغِ والـptrace ` +
        'من الـUID نفسِه. المطلوب 0 أو 2.',
    );
  }
  let pem;
  try {
    pem = os.readFd(fd);
  } finally {
    try {
      os.closeFd(fd);
    } catch {
      // واصفٌ مغلقٌ أصلاً: يظهرُ خطؤه من القراءة.
    }
  }
  const key = pemKeyProvider(pem, `worker-fd:${options.workerId ?? 'unknown'}`);
  os.setgroups([gid]);
  os.setgid(gid);
  os.setuid(uid);
  const evidence = verifyIsolation(os, { uid, gid, suidDumpable });
  return { key, evidence };
}

/**
 * @param {IsolationOs} os
 * @param {{ uid: number, gid: number, suidDumpable: string }} want
 */
export function verifyIsolation(os, want) {
  /** @type {string[]} */
  const failures = [];
  const status = os.readText('/proc/self/status');
  /** @param {string} field */
  const line = (field) =>
    (status.split('\n').find((l) => l.startsWith(`${field}:`)) ?? '')
      .slice(field.length + 1)
      .trim()
      .split(/\s+/);
  const uids = line('Uid').map(Number);
  const gids = line('Gid').map(Number);
  const groups = line('Groups')
    .filter((g) => g !== '')
    .map(Number);
  if (uids.length !== 4 || uids.some((u) => u !== want.uid)) failures.push(`Uid=${uids.join(',')}`);
  if (gids.length !== 4 || gids.some((g) => g !== want.gid)) failures.push(`Gid=${gids.join(',')}`);
  if (groups.some((g) => g !== want.gid)) failures.push(`Groups=${groups.join(',')}`);
  for (const cap of ['CapInh', 'CapPrm', 'CapEff', 'CapAmb']) {
    const v = line(cap)[0] ?? '';
    if (!/^0+$/.test(v)) failures.push(`${cap}=${v}`);
  }
  let regained = false;
  try {
    os.setuid(0);
    regained = true;
  } catch {
    // المتوقّع: EPERM.
  }
  if (regained) failures.push('setuid(0) نجح');
  const procOwner = os.ownerOf('/proc/self/environ');
  if (procOwner !== 0) failures.push(`/proc/self/environ ملكُ ${procOwner} (dumpable=1)`);
  if (failures.length > 0) {
    throw new FenceError(
      ISOLATION_ERRORS.VERIFY_FAILED,
      `فشلَ التحقّقُ من عزلِ العامل: ${failures.join('؛ ')}`,
      failures,
    );
  }
  return Object.freeze({
    mode: 'uid-drop-after-exec',
    uid: want.uid,
    gid: want.gid,
    suid_dumpable: want.suidDumpable,
    proc_owner: procOwner,
    setuid0_refused: true,
    capabilities_zero: true,
  });
}
