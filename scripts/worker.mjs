#!/usr/bin/env node
/**
 * مُقلِع عامل التنفيذ — الخطوة `M5.08`.
 *
 *   npm run worker -- --worker عامل-١ --once
 *   npm run worker -- --worker عامل-١ --max-tasks 20 --poll-ms 200
 *
 * السكربت لا يُنشئ سياسةً ولا مفتاح إيقاف من عنده: يقرأ `state/halt.json` القائم
 * ويتحقّق منه بمفتاح الملك العام. **وبلا مفتاح إيقاف قابل للقراءة لا يُقلع العامل
 * أصلاً** — عاملٌ لا يستطيع أن يعرف أنّ النظام أُوقف أخطر من عاملٍ لا يعمل.
 *
 * وفي الإنتاج (‏WL-092): سجلُّ وقائعِ العزلِ **مختومٌ** بمفتاح التوكن، فلا يبقى
 * على القرصِ نصٌّ ظاهرٌ عمّا نُفِّذ ولا عمّن حاول الهرب. والعاملُ يبقى مالكاً
 * لمفتاحٍ عامٍّ وحدَه للإيقاف: عقدةٌ تنفيذٍ تُقرُّ بالتوقفِ ولا تستأنفُ الدولة.
 *
 * وانقطاعُ القاعدة (‏WL-387) لا يُميت العامل: يُصنَّف ويُنتظَر بميزانيةٍ معلنة
 * (`--db-recovery-max-probes`، `--db-recovery-base-ms`، `--db-recovery-max-ms`)
 * ثم يُسوّى ما كان معلّقاً بلا إعادةِ تشغيلِ مُعالِج، ويُقيَّد الحكمُ في سجلِّ العامل
 * نفسِه (مختومٌ في الإنتاج). ورموزُ الخروجِ عند التوقّف الآمن: `75` قاعدةٌ لم تعُد
 * ضمن الميزانية، و`65` عطبٌ ليس تعذّراً (فسادٌ، مخطّطٌ غائب، نتيجةٌ لا تطابق).
 */

import { createHash, createPrivateKey, randomUUID } from 'node:crypto';
import {
  closeSync,
  fstatSync,
  lstatSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  statSync,
} from 'node:fs';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

/** @typedef {import('../src/execution/db-recovery.mjs').WorkerDatabaseFault} WorkerDatabaseFault */

// ═══════════════════════════════════════════════════════════════════════════════════════════
// مُقلِعُ العزل (`WL-533`، علاجُ `LAB-UID-05`) — **لا يستوردُ إلا وحداتِ `node:`**.
//
// ترتيبُ الإقلاع (‏مراجعةُ #546): هذا الملفُّ نقطةُ الدخول، ورسمُ استيرادِه الثابتُ وحداتُ `node:`
// وحدَها (‏يقيسُه اختبارُ ISO-40). فإن طُلبَ العزلُ (‏`XUUX_FENCE_ISOLATION=required`) لا تُقيَّمُ أيُّ
// وحدةٍ تطبيقيّةٍ ولا شيفرةُ تطبيقٍ وهو root: يُقرأُ واصفُ المفتاحِ ويُفحَصُ ويُغلَق، وتُسقَطُ الهويّة،
// ويُتحقَّق — ثمّ وحدَه `loadApp()` يُحمِّلُ التطبيقَ ديناميكيّاً (‏ISO-41 يقيسُ أثراً جانبيّاً في وحدةٍ
// مستوردة). وأمّا `NODE_OPTIONS` ومثلُها فتُنفَّذُ **قبلَ** أوّلِ سطرٍ هنا — فلا يحميها المُقلِع؛ يرفضُ
// وجودَها (‏كاشفٌ لا حاجز)، والحاجزُ بيئةُ السماحِ الصريحةِ في المُطلِق `isolatedLaunchCommand`.
//
// **ما لا يحميه:** root ومن يملكُ CAP_SYS_PTRACE؛ اختراقُ العاملِ نفسِه؛ إشاراتُ القتلِ من الـUID
// نفسِه. لا يُثبتُ هويّةَ العملية، ولا حمايةً عتاديّة. والقياسُ على مضيفٍ واحد.
// ═══════════════════════════════════════════════════════════════════════════════════════════

export const ISOLATION_ERRORS = Object.freeze({
  CONFIG: 'FENCE_ISOLATION_CONFIG',
  HOSTILE_ENV: 'FENCE_ISOLATION_HOSTILE_ENV',
  NOT_PRIVILEGED: 'FENCE_ISOLATION_NOT_PRIVILEGED',
  LAUNCH_POLICY: 'FENCE_ISOLATION_LAUNCH_POLICY',
  DUMPABLE_POLICY: 'FENCE_ISOLATION_SUID_DUMPABLE',
  KEY_FD: 'FENCE_ISOLATION_KEY_FD',
  VERIFY_FAILED: 'FENCE_ISOLATION_VERIFY_FAILED',
  UNTRUSTED_CODE: 'FENCE_ISOLATION_UNTRUSTED_CODE',
});

/** المتغيّراتُ التي يحدّدُها المُطلِق. لا يحملُ أيٌّ منها سرّاً. */
export const ISOLATION_ENV = Object.freeze({
  mode: 'XUUX_FENCE_ISOLATION',
  keyFd: 'XUUX_FENCE_KEY_FD',
  uid: 'XUUX_FENCE_WORKER_UID',
  gid: 'XUUX_FENCE_WORKER_GID',
});

/** حدُّ مجموعةِ القدراتِ المسموح (CapBnd): CAP_SETGID(6) وCAP_SETUID(7) فقط — للإسقاطِ وحدَه. */
export const ALLOWED_CAP_BND = 0xc0n;
/** أقصى حجمٍ لمفتاحٍ على الواصف (PEM لـEd25519 نحوَ 119 بايتاً). */
export const KEY_FD_MAX_BYTES = 16_384;
/** مدى مسحِ الواصفاتِ بحثاً عن نسخةٍ مكرَّرةٍ من واصفِ المفتاح. */
export const FD_SCAN_LIMIT = 4_096;

/** متغيّراتُ بيئةٍ تُنفِّذُ شيفرةً أو تُحمِّلُ مكتباتٍ قبلَ المُقلِع، أو تكتبُ ملفّاتٍ بصلاحيّةِ root. */
export const HOSTILE_ENV = [/^NODE_(?!ENV$)/, /^LD_/, /^DYLD_/];

export class IsolationError extends Error {
  /** @param {string} code @param {string} message @param {unknown} [details] */
  constructor(code, message, details) {
    super(message);
    this.name = 'IsolationError';
    this.code = code;
    this.details = details;
  }
}

/**
 * @typedef {{ type: string, uid: number, mode: number, size: number, dev: number, ino: number }} FdStat
 * @typedef {{
 *   getuid(): number, geteuid(): number,
 *   setgroups(g: number[]): void, setgid(g: number): void, setuid(u: number): void,
 *   fstat(fd: number): FdStat, readFd(fd: number): string, closeFd(fd: number): void,
 *   scanFds(dev: number, ino: number): number[],
 *   readText(path: string): string, ownerOf(path: string): number,
 * }} IsolationOs
 */

/** @param {import('node:fs').Stats} s */
const fdType = (s) =>
  s.isFile()
    ? 'file'
    : s.isFIFO()
      ? 'fifo'
      : s.isSocket()
        ? 'socket'
        : s.isCharacterDevice()
          ? 'char'
          : s.isDirectory()
            ? 'dir'
            : s.isBlockDevice()
              ? 'block'
              : 'other';

/** @type {IsolationOs} */
const realOs = {
  getuid: () => /** @type {any} */ (process).getuid(),
  geteuid: () => /** @type {any} */ (process).geteuid(),
  setgroups: (g) => /** @type {any} */ (process).setgroups(g),
  setgid: (g) => /** @type {any} */ (process).setgid(g),
  setuid: (u) => /** @type {any} */ (process).setuid(u),
  fstat: (fd) => {
    const s = fstatSync(fd);
    return {
      type: fdType(s),
      uid: s.uid,
      mode: s.mode & 0o7777,
      size: s.size,
      dev: s.dev,
      ino: s.ino,
    };
  },
  readFd: (fd) => readFileSync(fd, 'utf8'),
  closeFd: (fd) => closeSync(fd),
  scanFds: (dev, ino) => {
    /** @type {number[]} */
    const hits = [];
    for (let fd = 0; fd < FD_SCAN_LIMIT; fd += 1) {
      try {
        const s = fstatSync(fd);
        if (s.dev === dev && s.ino === ino) hits.push(fd);
      } catch {
        // EBADF: واصفٌ غيرُ مفتوح.
      }
    }
    return hits;
  },
  readText: (p) => readFileSync(p, 'utf8'),
  ownerOf: (p) => statSync(p).uid,
};

// ── ثقةُ الشيفرةِ التي تعملُ بـroot (‏WL-533، الجولةُ الثالثة) ─────────────────────────────────────
// node والمُقلِعُ وsh وsetpriv وenv وsudo تعملُ بـroot (‏منقوصِ القدرات) **قبلَ** الإسقاط. فإن كتبَ
// أحدَها — أو مجلّداً في طريقِه، أو رابطاً رمزيّاً في سلسلتِه — غيرُ root، صارَ الإقلاعُ التالي شيفرتَه
// بصلاحيّةِ root. (‏قِيسَ على مضيفِ المختبر: `/usr/local/bin/node` ‏0777 ملكُ uid 1001.)
// العقد: كلُّ مجلّدٍ يُعبَرُ ملكُ root ولا يكتبُه group/other إلا بِبِتِّ sticky؛ وكلُّ رابطٍ رمزيٍّ في
// السلسلةِ ملكُ root؛ والملفُّ النهائيُّ عاديٌّ ملكُ root لا يكتبُه group/other؛ وبصمةُ sha256 إن ثُبِّتت.
// (‏بِتُّ group في ‎st_mode‎ هو قناعُ ACL حين توجد، فمدخلُ ACL بالكتابةِ يظهرُ فيه.)
// **الحدّ:** لا يفحصُ المكتباتِ المشتركةَ ولا node_modules ولا النواة؛ وفحصُ المُقلِعِ لنفسِه كاشفٌ لسوءِ
// إعدادٍ لا حاجز — node مستبدَلٌ لا يُشغِّلُه. الحاجزُ فحصُ المُطلِقِ قبلَ exec (‏isolatedLaunchCommand).

/**
 * @typedef {{ type: string, uid: number, mode: number }} PathStat
 * @typedef {{ lstat(p: string): PathStat, readlink(p: string): string, sha256(p: string): string }} TrustFs
 */

/** @type {TrustFs} */
const realTrustFs = {
  lstat: (p) => {
    const s = lstatSync(p);
    return { type: s.isSymbolicLink() ? 'symlink' : fdType(s), uid: s.uid, mode: s.mode & 0o7777 };
  },
  readlink: (p) => readlinkSync(p),
  sha256: (p) => createHash('sha256').update(readFileSync(p)).digest('hex'),
};

/** @param {string} p */
const parts = (p) => p.split('/').filter((x) => x !== '' && x !== '.');
/** @param {string} dir @param {string} name */
const joinAbs = (dir, name) => (dir === '/' ? `/${name}` : `${dir}/${name}`);
/** @param {string} p */
const parentOf = (p) => (p.lastIndexOf('/') <= 0 ? '/' : p.slice(0, p.lastIndexOf('/')));
/** @param {number} m */
const oct = (m) => (m & 0o7777).toString(8);

/**
 * يمشي المسارَ مكوِّناً مكوِّناً ويتبعُ كلَّ رابطٍ بنفسِه (‏لا realpath واحداً) فيفحصُ كلَّ ما يُعبَر.
 * @param {readonly string[]} paths
 * `optional`: مساراتٌ يجوزُ غيابُها (‏وحداتٌ لم تُنشَر) — ويُفحَصُ أعمقُ مجلّدٍ موجودٍ في طريقِها، فمجلّدٌ
 * يكتبُه غيرُ root يُرفَضُ ولو غابَ الملفّ.
 * @param {{ fs?: TrustFs, pins?: Readonly<Record<string, string>>, optional?: readonly string[] }} [o]
 * @returns {{ violations: string[], checked: Array<{ path: string, real: string, sha256?: string }>,
 *   absent: string[] }}
 */
export function codeTrustViolations(paths, o = {}) {
  const fs = o.fs ?? realTrustFs;
  const pins = o.pins ?? {};
  const optional = new Set(o.optional ?? []);
  /** @type {string[]} */
  const absent = [];
  /** @type {string[]} */
  const violations = [];
  /** @type {Array<{ path: string, real: string, sha256?: string }>} */
  const checked = [];
  /** @param {string} d @param {PathStat} s */
  const dirIssue = (d, s) =>
    s.type !== 'dir'
      ? `${d}: ليس مجلّداً (${s.type})`
      : s.uid !== 0
        ? `${d}: مجلّدٌ ملكُ ${s.uid}`
        : (s.mode & 0o022) !== 0 && (s.mode & 0o1000) === 0
          ? `${d}: مجلّدٌ يكتبُه غيرُ root (${oct(s.mode)})`
          : null;
  for (const p of paths) {
    if (typeof p !== 'string' || !p.startsWith('/')) {
      violations.push(`${String(p)}: ليس مساراً مطلقاً`);
      continue;
    }
    /** @type {string[]} */
    const bad = [];
    try {
      const root = dirIssue('/', fs.lstat('/'));
      if (root !== null) bad.push(root);
      let cur = '/';
      let todo = parts(p);
      let hops = 0;
      /** @type {PathStat | null} */
      let leaf = null;
      while (todo.length > 0) {
        const c = /** @type {string} */ (todo.shift());
        if (c === '..') {
          cur = parentOf(cur);
          continue;
        }
        const next = joinAbs(cur, c);
        /** @type {PathStat} */
        let s;
        try {
          s = fs.lstat(next);
        } catch (error) {
          if (optional.has(p) && /** @type {any} */ (error)?.code === 'ENOENT') break;
          throw error;
        }
        if (s.type === 'symlink') {
          if (s.uid !== 0) bad.push(`${next}: رابطٌ رمزيٌّ ملكُ ${s.uid}`);
          if (++hops > 40) throw new Error('روابطُ رمزيّةٌ أكثرُ من 40');
          const t = fs.readlink(next);
          todo = [...parts(t), ...todo];
          if (t.startsWith('/')) cur = '/';
          continue;
        }
        if (todo.length > 0) {
          const issue = dirIssue(next, s);
          if (issue !== null) bad.push(issue);
          cur = next;
        } else {
          leaf = s;
          cur = next;
        }
      }
      if (leaf === null) {
        if (optional.has(p)) {
          absent.push(p);
          violations.push(...bad);
          continue;
        }
        throw new Error('مسارٌ بلا ملفّ');
      }
      if (leaf.type !== 'file') bad.push(`${cur}: ليس ملفّاً عاديّاً (${leaf.type})`);
      if (leaf.uid !== 0) bad.push(`${cur}: ملفٌّ ملكُ ${leaf.uid}`);
      if ((leaf.mode & 0o022) !== 0) bad.push(`${cur}: ملفٌّ يكتبُه غيرُ root (${oct(leaf.mode)})`);
      /** @type {{ path: string, real: string, sha256?: string }} */
      const entry = { path: p, real: cur };
      const pin = pins[p];
      if (pin !== undefined) {
        const h = fs.sha256(cur);
        entry.sha256 = h;
        if (h !== pin)
          bad.push(`${p}: بصمةٌ ${h.slice(0, 12)}… لا تطابقُ المثبَّتة ${pin.slice(0, 12)}…`);
      }
      if (bad.length === 0) checked.push(entry);
    } catch (error) {
      bad.push(`${p}: ${error instanceof Error ? error.message : String(error)}`);
    }
    violations.push(...bad);
  }
  return { violations: [...new Set(violations)], checked, absent };
}

/**
 * مساراتُ الشيفرةِ التي يفحصُها المُقلِعُ قبلَ قراءةِ المفتاح: node، ونقطةُ الدخول، والمُقلِعُ نفسُه،
 * ووحداتُ `loadApp()` (‏تعملُ بالهويّةِ المُسقَطة، لكنّ كتابتَها من مستخدمٍ آخرَ اختراقٌ عابرٌ للعمّال).
 */
export const APP_MODULES = Object.freeze([
  '../src/root-of-trust/persistent-log.mjs',
  '../src/root-of-trust/index.mjs',
  '../src/execution/queue.mjs',
  '../src/execution/worker.mjs',
  '../src/execution/pending-results.mjs',
  '../src/execution/db-recovery.mjs',
  '../src/policy/quota.mjs',
  '../src/policy/loader.mjs',
  '../src/persistence/db.mjs',
  '../src/execution/worker-registry.mjs',
  '../src/fence/db-fence.mjs',
]);

/** وحداتُ `loadApp()` بمساراتِها المطلقة — يجوزُ غيابُها في فحصِ المُقلِع (‏لا تُقيَّمُ بـroot). */
export const appModulePaths = () =>
  APP_MODULES.map((m) => fileURLToPath(new URL(m, import.meta.url)));

/** @param {readonly string[]} argv */
export function bootstrapTrustPaths(argv = process.argv) {
  const self = fileURLToPath(import.meta.url);
  const entry = argv[1] !== undefined && argv[1].startsWith('/') ? [argv[1]] : [];
  return [...new Set([process.execPath, ...entry, self, ...appModulePaths()])];
}

/** @param {NodeJS.ProcessEnv} env @param {string} name */
const val = (env, name) => (env[name] ?? '').trim();

/**
 * وضعُ العزلِ المُعلَن. **يفشلُ مغلقاً:** أيُّ متغيّرٍ من متغيّراتِ العزلِ بلا
 * `XUUX_FENCE_ISOLATION=required` خطأُ إعداد، لا تجاهلٌ صامت.
 * @param {NodeJS.ProcessEnv} env
 * @returns {'off' | 'required'}
 */
export function isolationMode(env) {
  const raw = val(env, ISOLATION_ENV.mode);
  const partial = [ISOLATION_ENV.keyFd, ISOLATION_ENV.uid, ISOLATION_ENV.gid].filter(
    (n) => val(env, n) !== '',
  );
  if (raw === '' || raw === 'off') {
    if (partial.length > 0) {
      throw new IsolationError(
        ISOLATION_ERRORS.CONFIG,
        `${partial.join('، ')} بلا ${ISOLATION_ENV.mode}=required: إعدادُ عزلٍ لا يُعلِنُ وضعَه يُرفَض.`,
      );
    }
    return 'off';
  }
  if (raw !== 'required') {
    throw new IsolationError(
      ISOLATION_ERRORS.CONFIG,
      `${ISOLATION_ENV.mode}=«${raw}» غيرُ معروف — المقبول: required أو off أو الغياب.`,
    );
  }
  return 'required';
}

/**
 * متغيّراتُ البيئةِ ووسائطُ Node العدائيّة. تُنفَّذُ قبلَ المُقلِع، فالرفضُ هنا كشفٌ لإطلاقٍ مخالفٍ
 * لا منعٌ لأثرٍ وقع.
 * @param {NodeJS.ProcessEnv} env @param {readonly string[]} execArgv
 */
export function hostileLaunchInputs(env, execArgv) {
  const names = Object.keys(env).filter((n) => HOSTILE_ENV.some((re) => re.test(n)));
  return [...names.sort(), ...execArgv.map((a) => `execArgv:${a}`)];
}

/** @param {NodeJS.ProcessEnv} env @param {string} name */
function positiveInt(env, name) {
  const raw = val(env, name);
  if (!/^[1-9][0-9]*$/.test(raw) || !Number.isSafeInteger(Number(raw))) {
    throw new IsolationError(
      ISOLATION_ERRORS.CONFIG,
      `${name} يجبُ أن يكونَ عدداً موجباً (لا root): «${raw}».`,
    );
  }
  return Number(raw);
}

/** @param {string} status @param {string} field */
const statusField = (status, field) =>
  (status.split('\n').find((l) => l.startsWith(`${field}:`)) ?? '')
    .slice(field.length + 1)
    .trim()
    .split(/\s+/)
    .filter((x) => x !== '');

/** @param {string} status @param {string} field */
const capOf = (status, field) => {
  const hex = statusField(status, field)[0] ?? '';
  return /^[0-9a-f]+$/i.test(hex) ? BigInt(`0x${hex}`) : null;
};

/**
 * عقدُ الواصف: ملفٌّ عاديٌّ يملكُه root، لا يقرؤه غيرُ مالكِه، يقرؤه مالكُه، وحجمُه معقول. لا أنبوبٌ
 * ولا مقبسٌ ولا طرفيّةٌ ولا مجلّد — مصدرٌ يتحكّمُ فيه غيرُ root أو يُعيدُ محتوًى متغيّراً مرفوض.
 * @param {FdStat} s
 */
export function keyFdViolations(s) {
  /** @type {string[]} */
  const v = [];
  if (s.type !== 'file') v.push(`type=${s.type}`);
  if (s.uid !== 0) v.push(`owner=${s.uid}`);
  if ((s.mode & 0o077) !== 0) v.push(`mode=${(s.mode & 0o777).toString(8)} (group/other)`);
  if ((s.mode & 0o400) === 0) v.push(`mode=${(s.mode & 0o777).toString(8)} (owner unreadable)`);
  if (!(s.size > 0 && s.size <= KEY_FD_MAX_BYTES)) v.push(`size=${s.size}`);
  return v;
}

/**
 * المُقلِع: يُستدعى **قبلَ تحميلِ أيِّ وحدةٍ تطبيقيّة**. بلا عزلٍ مطلوبٍ يُعيدُ `null`؛ ومعه إمّا عزلٌ
 * متحقَّقٌ منه وإمّا استثناءٌ — لا مسارَ وسطاً.
 * @param {NodeJS.ProcessEnv} env
 * @param {{ os?: IsolationOs, execArgv?: readonly string[],
 *   trust?: (paths: readonly string[]) => { violations: string[], checked: unknown[] },
 *   trustPaths?: readonly string[] }} [options]
 * @returns {{ pem: string, evidence: Readonly<Record<string, unknown>> } | null}
 */
export function bootstrapIsolation(env, options = {}) {
  if (isolationMode(env) === 'off') return null;
  const os = options.os ?? realOs;
  // ١. الإعداد — قبلَ أيِّ نداءٍ للنظام.
  if (val(env, 'XUUX_FENCE_WORKER_KEY') !== '') {
    throw new IsolationError(
      ISOLATION_ERRORS.CONFIG,
      'XUUX_FENCE_WORKER_KEY مع العزلِ الإلزاميّ: لا تراجعَ إلى مسارِ ملفِّ المفتاحِ القديم.',
    );
  }
  if (val(env, 'XUUX_DB_FENCE') !== 'required') {
    throw new IsolationError(
      ISOLATION_ERRORS.CONFIG,
      'العزلُ الإلزاميُّ يتطلّبُ XUUX_DB_FENCE=required: المفتاحُ المعزولُ لا مستهلِكَ له بلا سياج.',
    );
  }
  const fdRaw = val(env, ISOLATION_ENV.keyFd);
  if (!/^[3-9]$|^[1-9][0-9]+$/.test(fdRaw) || Number(fdRaw) >= FD_SCAN_LIMIT) {
    throw new IsolationError(
      ISOLATION_ERRORS.CONFIG,
      `${ISOLATION_ENV.keyFd} غائبٌ أو غيرُ صالح («${fdRaw}»): العزلُ الإلزاميُّ بلا واصفٍ يُرفَض.`,
    );
  }
  const fd = Number(fdRaw);
  const uid = positiveInt(env, ISOLATION_ENV.uid);
  const gid = positiveInt(env, ISOLATION_ENV.gid);
  // ٢. مدخلاتُ إطلاقٍ عدائيّة.
  const hostile = hostileLaunchInputs(env, options.execArgv ?? process.execArgv);
  if (hostile.length > 0) {
    throw new IsolationError(
      ISOLATION_ERRORS.HOSTILE_ENV,
      `مدخلاتُ إطلاقٍ تُنفِّذُ شيفرةً قبلَ المُقلِع: ${hostile.join('، ')}. المُطلِقُ يجبُ أن يبنيَ ` +
        'البيئةَ من قائمةِ سماحٍ صريحة (isolatedLaunchCommand) — وأثرُها إن وُجِدَ قد وقعَ بصلاحيّةِ root.',
      hostile,
    );
  }
  // ٣. الصلاحيّةُ وسياسةُ الإطلاق.
  if (os.geteuid() !== 0 || os.getuid() !== 0) {
    throw new IsolationError(
      ISOLATION_ERRORS.NOT_PRIVILEGED,
      'العزلُ يتطلّبُ أن يبدأَ العاملُ بـroot ويُسقِطَ هويّتَه بنفسِه: عمليةٌ بُدئت بمستخدمِ العاملِ ' +
        'مباشرةً (dumpable=1) يقرؤها أيُّ عمليةٍ بالـUID نفسِه (LAB-UID-05).',
    );
  }
  const before = os.readText('/proc/self/status');
  const bndBefore = capOf(before, 'CapBnd');
  const nnpBefore = statusField(before, 'NoNewPrivs')[0];
  if (nnpBefore !== '1' || bndBefore === null || (bndBefore & ~ALLOWED_CAP_BND) !== 0n) {
    throw new IsolationError(
      ISOLATION_ERRORS.LAUNCH_POLICY,
      `سياسةُ الإطلاق: المطلوبُ NoNewPrivs=1 وCapBnd ⊆ {setgid,setuid} (0xc0)، والمقيسُ ` +
        `NoNewPrivs=${nnpBefore ?? '?'} CapBnd=${bndBefore?.toString(16) ?? '?'}. ` +
        'بلا ذلك يستعيدُ execve لبرنامجِ setuid أو ذي قدراتٍ ملفّيّةٍ صلاحيّاتٍ بعدَ الإسقاط.',
    );
  }
  const suidDumpable = os.readText('/proc/sys/fs/suid_dumpable').trim();
  if (suidDumpable !== '0' && suidDumpable !== '2') {
    throw new IsolationError(
      ISOLATION_ERRORS.DUMPABLE_POLICY,
      `fs.suid_dumpable=${suidDumpable}: بعدَ إسقاطِ الهويّةِ تبقى العمليةُ قابلةً للتفريغِ والـptrace ` +
        'من الـUID نفسِه. المطلوب 0 أو 2.',
    );
  }
  // ٣ب. ثقةُ الشيفرةِ العاملةِ بـroot — قبلَ أيِّ قراءةٍ للمفتاح. كاشفٌ لا حاجز (‏انظر codeTrustViolations).
  const trustPaths = options.trustPaths ?? bootstrapTrustPaths();
  const trust = (
    options.trust ?? ((ps) => codeTrustViolations(ps, { optional: appModulePaths() }))
  )(trustPaths);
  if (trust.violations.length > 0) {
    throw new IsolationError(
      ISOLATION_ERRORS.UNTRUSTED_CODE,
      `شيفرةٌ تعملُ بـroot يكتبُها غيرُ root: ${trust.violations.join('؛ ')}. لا يُقرأُ المفتاح.`,
      trust.violations,
    );
  }
  // ٤. عقدُ الواصف، ثمّ القراءةُ والإغلاق — في كلِّ حال.
  /** @type {FdStat} */
  let st;
  /** @type {string} */
  let pem;
  try {
    st = os.fstat(fd);
    const bad = keyFdViolations(st);
    if (bad.length > 0) {
      throw new IsolationError(
        ISOLATION_ERRORS.KEY_FD,
        `واصفُ المفتاح ${fd} يخالفُ العقد: ${bad.join('، ')}.`,
        bad,
      );
    }
    pem = os.readFd(fd);
  } catch (error) {
    if (error instanceof IsolationError) throw error;
    throw new IsolationError(
      ISOLATION_ERRORS.KEY_FD,
      `واصفُ المفتاح ${fd} غيرُ مقروء: ${error instanceof Error ? error.message : String(error)}`,
    );
  } finally {
    try {
      os.closeFd(fd);
    } catch {
      // واصفٌ غيرُ مفتوحٍ أصلاً: خطؤه ظاهرٌ من fstat.
    }
  }
  let keyType;
  try {
    keyType = createPrivateKey(pem).asymmetricKeyType;
  } catch {
    keyType = 'unparseable';
  }
  if (keyType !== 'ed25519') {
    throw new IsolationError(
      ISOLATION_ERRORS.KEY_FD,
      `محتوى الواصفِ ليس مفتاحَ Ed25519 خاصّاً (${keyType}).`,
    );
  }
  // ٥. الإسقاط.
  os.setgroups([gid]);
  os.setgid(gid);
  os.setuid(uid);
  // ٦. التحقّق — يفشلُ مغلقاً.
  const evidence = verifyIsolation(os, { uid, gid, suidDumpable, fd, dev: st.dev, ino: st.ino });
  return {
    pem,
    evidence: Object.freeze({
      ...evidence,
      code_trust: { checked: trust.checked.length },
      key_fd: {
        fd,
        type: st.type,
        owner: st.uid,
        mode: (st.mode & 0o777).toString(8),
        bytes: st.size,
      },
    }),
  };
}

/**
 * @param {IsolationOs} os
 * @param {{ uid: number, gid: number, suidDumpable: string, fd: number, dev: number, ino: number }} want
 */
export function verifyIsolation(os, want) {
  /** @type {string[]} */
  const failures = [];
  const status = os.readText('/proc/self/status');
  const uids = statusField(status, 'Uid').map(Number);
  const gids = statusField(status, 'Gid').map(Number);
  const groups = statusField(status, 'Groups').map(Number);
  if (uids.length !== 4 || uids.some((u) => u !== want.uid)) failures.push(`Uid=${uids.join(',')}`);
  if (gids.length !== 4 || gids.some((g) => g !== want.gid)) failures.push(`Gid=${gids.join(',')}`);
  if (groups.some((g) => g !== want.gid)) failures.push(`Groups=${groups.join(',')}`);
  for (const cap of ['CapInh', 'CapPrm', 'CapEff', 'CapAmb']) {
    if (capOf(status, cap) !== 0n) failures.push(`${cap}=${statusField(status, cap)[0] ?? '?'}`);
  }
  const bnd = capOf(status, 'CapBnd');
  if (bnd === null || (bnd & ~ALLOWED_CAP_BND) !== 0n) failures.push(`CapBnd=${bnd?.toString(16)}`);
  const nnp = statusField(status, 'NoNewPrivs')[0];
  if (nnp !== '1') failures.push(`NoNewPrivs=${nnp ?? '?'}`);
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
  const copies = os.scanFds(want.dev, want.ino);
  if (copies.length > 0) failures.push(`نسخُ واصفِ المفتاحِ مفتوحة: ${copies.join(',')}`);
  if (failures.length > 0) {
    throw new IsolationError(
      ISOLATION_ERRORS.VERIFY_FAILED,
      `فشلَ التحقّقُ من عزلِ العامل: ${failures.join('؛ ')}`,
      failures,
    );
  }
  return {
    mode: 'uid-drop-after-exec',
    uid: want.uid,
    gid: want.gid,
    suid_dumpable: want.suidDumpable,
    proc_owner: procOwner,
    setuid0_refused: true,
    // الادّعاءُ بالضبط: هذه الحقولُ الأربعةُ صفر، وCapBnd ⊆ 0xc0، وNoNewPrivs=1 — لا «كلُّ القدرات».
    caps_zero: ['CapInh', 'CapPrm', 'CapEff', 'CapAmb'],
    cap_bnd: /** @type {bigint} */ (bnd).toString(16),
    no_new_privs: true,
    key_fd_open_copies: 0,
  };
}

/** البرامجُ التي يُشغِّلُها المُطلِقُ بـroot — مساراتٌ مطلقةٌ ثابتةٌ لا PATH. */
export const LAUNCH_SUDO = '/usr/bin/sudo';
export const LAUNCH_ENV = '/usr/bin/env';
export const LAUNCH_SETPRIV = '/usr/bin/setpriv';
export const LAUNCH_SH = '/bin/sh';

/** متغيّراتٌ لا يمرّرُها المُطلِقُ أبداً ولو طُلِبت. */
const NEVER_PASS = [
  ...HOSTILE_ENV,
  /^XUUX_FENCE_WORKER_KEY$/,
  /^XUUX_FENCE_(ISOLATION|KEY_FD|WORKER_UID|WORKER_GID)$/,
];

/**
 * بيئةُ السماحِ الصريحةُ وفحصُ المُدخلات — مشتركةٌ بينَ المُطلِقِ ووحدةِ systemd (‏مصدرٌ واحد).
 * @param {{ node: string, entry: string, keyFile: string, uid: number, gid: number,
 *   env: NodeJS.ProcessEnv, pass?: readonly string[] }} o
 * @returns {Record<string, string>}
 */
export function isolatedLaunchEnv(o) {
  for (const [name, p] of /** @type {Array<[string, string]>} */ ([
    ['node', o.node],
    ['entry', o.entry],
    ['keyFile', o.keyFile],
  ])) {
    if (typeof p !== 'string' || !p.startsWith('/')) {
      throw new IsolationError(ISOLATION_ERRORS.CONFIG, `${name} يجبُ أن يكونَ مساراً مطلقاً.`);
    }
  }
  for (const n of [o.uid, o.gid]) {
    if (!Number.isSafeInteger(n) || n <= 0) {
      throw new IsolationError(ISOLATION_ERRORS.CONFIG, `uid/gid موجبٌ مطلوب (لا root): ${n}.`);
    }
  }
  /** @type {Record<string, string>} */
  const env = { PATH: '/usr/sbin:/usr/bin:/sbin:/bin' };
  for (const name of o.pass ?? []) {
    if (!/^[A-Z][A-Z0-9_]*$/.test(name) || NEVER_PASS.some((re) => re.test(name))) {
      throw new IsolationError(
        ISOLATION_ERRORS.HOSTILE_ENV,
        `المتغيّر «${name}» لا يُمرَّرُ إلى عاملٍ معزول.`,
      );
    }
    const v = o.env[name];
    if (v === undefined) continue;
    if (v.includes('\0') || v.includes('\n')) {
      throw new IsolationError(ISOLATION_ERRORS.CONFIG, `قيمةُ «${name}» تحوي فاصلاً.`);
    }
    env[name] = v;
  }
  env[ISOLATION_ENV.mode] = 'required';
  env[ISOLATION_ENV.keyFd] = '3';
  env[ISOLATION_ENV.uid] = String(o.uid);
  env[ISOLATION_ENV.gid] = String(o.gid);
  return env;
}

/**
 * المُطلِق: يبني أمرَ إقلاعٍ معزولٍ **من بيئةِ سماحٍ صريحة** (`env -i`)، بحدِّ قدراتٍ {setgid,setuid}
 * وno_new_privs (`setpriv`)، ومفتاحٍ يفتحُه `sh` (root) على الواصف 3. لا يرثُ الابنُ متغيّراً لم يُسمَّ.
 * **ويفحصُ ثقةَ الشيفرةِ قبلَ أن يبنيَ الأمر** (‏الحاجزُ لا الكاشف): node ونقطةُ الدخولِ وenv وsetpriv وsh —
 * وsudo إن استُعمِل — بعقدِ `codeTrustViolations` وبصماتٍ اختياريّة. لا مسارَ لتجاوزِه. (‏ملفُّ المفتاحِ لا يُفحَصُ
 * هنا: المُقلِعُ يفحصُ الواصفَ المفتوحَ نفسَه بـfstat، فلا نافذةَ سباقٍ بينَ الفحصِ والفتح.)
 * @param {{ node: string, entry: string, args?: readonly string[], keyFile: string, uid: number,
 *   gid: number, env: NodeJS.ProcessEnv, pass?: readonly string[], sudo?: boolean,
 *   trust?: { fs?: TrustFs, pins?: Readonly<Record<string, string>> } }} o
 */
export function isolatedLaunchCommand(o) {
  const env = isolatedLaunchEnv(o);
  const trustPaths = [
    ...(o.sudo === false ? [] : [LAUNCH_SUDO]),
    LAUNCH_ENV,
    LAUNCH_SETPRIV,
    LAUNCH_SH,
    o.node,
    o.entry,
  ];
  const trust = codeTrustViolations(trustPaths, o.trust ?? {});
  if (trust.violations.length > 0) {
    throw new IsolationError(
      ISOLATION_ERRORS.UNTRUSTED_CODE,
      `المُطلِقُ يرفض: ${trust.violations.join('؛ ')}.`,
      trust.violations,
    );
  }
  const inner = [
    LAUNCH_ENV,
    '-i',
    ...Object.entries(env).map(([k, v]) => `${k}=${v}`),
    LAUNCH_SETPRIV,
    '--no-new-privs',
    '--bounding-set',
    '-all,+setuid,+setgid',
    '--inh-caps',
    '-all',
    LAUNCH_SH,
    '-c',
    'k=$1; shift; exec "$@" 3<"$k"',
    'sh',
    o.keyFile,
    o.node,
    o.entry,
    ...(o.args ?? []),
  ];
  return o.sudo === false
    ? { command: LAUNCH_ENV, args: inner.slice(1), env, trust: trust.checked }
    : { command: LAUNCH_SUDO, args: ['-n', ...inner], env, trust: trust.checked };
}

/**
 * وحداتُ التطبيق — تُحمَّلُ **بعدَ** `bootstrapIsolation` وحدَه (‏ISO-41). لا استيرادَ ثابتاً لأيٍّ منها
 * في هذا الملفّ: أيُّ أثرٍ جانبيٍّ في وحدةٍ منها يقعُ بالهويّةِ المُسقَطةِ لا بـroot.
 */
export async function loadApp() {
  const [log, rot, queue, workerMod, pending, recovery, quota, policy, db, registry, fence] =
    await Promise.all([
      import('../src/root-of-trust/persistent-log.mjs'),
      import('../src/root-of-trust/index.mjs'),
      import('../src/execution/queue.mjs'),
      import('../src/execution/worker.mjs'),
      import('../src/execution/pending-results.mjs'),
      import('../src/execution/db-recovery.mjs'),
      import('../src/policy/quota.mjs'),
      import('../src/policy/loader.mjs'),
      import('../src/persistence/db.mjs'),
      import('../src/execution/worker-registry.mjs'),
      import('../src/fence/db-fence.mjs'),
    ]);
  return {
    PersistentEventLog: log.PersistentEventLog,
    HaltSwitch: rot.HaltSwitch,
    isProductionRuntime: rot.isProductionRuntime,
    openProductionEventLog: rot.openProductionEventLog,
    royalVerifierFromPublicKey: rot.royalVerifierFromPublicKey,
    createTaskQueue: queue.createTaskQueue,
    createWorker: workerMod.createWorker,
    createPendingResultStore: pending.createPendingResultStore,
    settlePendingResults: pending.settlePendingResults,
    settleUntilAdmitted: pending.settleUntilAdmitted,
    RECOVERY_EXIT_CODES: recovery.RECOVERY_EXIT_CODES,
    RECOVERY_VERDICTS: recovery.RECOVERY_VERDICTS,
    WorkerDatabaseFault: recovery.WorkerDatabaseFault,
    abortableSleep: recovery.abortableSleep,
    classifyDatabaseFault: recovery.classifyDatabaseFault,
    createDatabaseRecovery: recovery.createDatabaseRecovery,
    createQuotaLedger: quota.createQuotaLedger,
    loadPolicyBundle: policy.loadPolicyBundle,
    createPool: db.createPool,
    WORKER_REGISTRY_ERRORS: registry.WORKER_REGISTRY_ERRORS,
    WorkerRegistryError: registry.WorkerRegistryError,
    createWorkerRegistry: registry.createWorkerRegistry,
    dbFenceMode: fence.dbFenceMode,
    prepareFencedWorker: fence.prepareFencedWorker,
    pemKeyProvider: fence.pemKeyProvider,
  };
}

/** حجمُ مجمّعِ العاملِ المُسيَّج: ثابتٌ ومختوم (حدُّ دورِ الإقلاع CONNECTION LIMIT 16). */
const FENCED_POOL_SIZE = 8;

/**
 * @param {readonly string[]} argv
 * @returns {{ worker: string, once: boolean, maxTasks: number, pollMs: number, haltFile: string, publicKey: string | null, registrationTtlMs: number, recoveryPolicy: { maxProbes?: number, baseDelayMs?: number, maxDelayMs?: number } }}
 */
function parseArguments(argv) {
  /** @type {Record<string, string>} */
  const flags = {};
  let once = false;
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === undefined) continue;
    if (token === '--once') {
      once = true;
      continue;
    }
    if (token.startsWith('--')) {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith('--')) {
        throw new Error(`العلَم ${token} يحتاج قيمة.`);
      }
      flags[token.slice(2)] = value;
      index += 1;
    }
  }
  const worker = flags['worker'] ?? process.env['WORKER_NAME'] ?? '';
  if (worker.trim() === '') {
    throw new Error('اسم العامل مطلوب: --worker <اسم>. عقدٌ بلا صاحب لا يُحاسَب.');
  }
  const pollMs = Number(flags['poll-ms'] ?? '200');
  // عتبةُ تقادُمِ نبضةِ ملكيّةِ الاسمِ (‏`LIVE-45`/د): فوقَها يُفتَحُ الاسمُ لإقلاعٍ
  // جديدٍ. والتحققُ صارمٌ لا استبدالٌ صامتٌ بالافتراضيّ: عتبةٌ لا يعرفُ مُشغّلُها
  // مقدارَها عقدٌ مبتورٌ، وعتبةٌ أضيقُ من دورةِ الانتظارِ تفتحُ الاسمَ لغيرِ
  // صاحبهِ وهوَ حيٌّ ينبضُ — فتُرفَضُ لا تُمرَّرَ.
  const registrationTtlMs = Number(
    flags['registration-ttl-ms'] ?? process.env['WORKER_REGISTRATION_TTL_MS'] ?? '60000',
  );
  if (!Number.isInteger(registrationTtlMs) || registrationTtlMs <= pollMs) {
    throw new Error(
      `عتبةُ ملكيّةِ الاسمِ (‏--registration-ttl-ms) مطلوبةٌ عددًا صحيحًا أكبرَ من دورةِ الانتظارِ (‏${pollMs}ms) لا «${String(
        flags['registration-ttl-ms'] ?? process.env['WORKER_REGISTRATION_TTL_MS'] ?? '',
      )}»: عتبةٌ أضيقُ تفتحُ اسمَ عاملٍ حيٍّ لغيرهِ.`,
    );
  }
  return {
    worker,
    once,
    maxTasks: Number(flags['max-tasks'] ?? (once ? '1' : '0')) || (once ? 1 : Infinity),
    pollMs,
    haltFile: flags['halt-file'] ?? process.env['HALT_FILE'] ?? 'state/halt.json',
    publicKey: flags['halt-public-key'] ?? process.env['HALT_PUBLIC_KEY'] ?? null,
    registrationTtlMs,
    recoveryPolicy: recoveryPolicyFrom(flags),
  };
}

/**
 * سياسةُ الانتظارِ من الأعلام. قيمةٌ غيرُ صالحةٍ تُرفض لا تُستبدل صامتةً بالافتراضي:
 * ميزانيةٌ لا يعرف مُشغّلُها مقدارَها ليست ميزانية.
 * @param {Record<string, string>} flags
 */
function recoveryPolicyFrom(flags) {
  /** @type {{ maxProbes?: number, baseDelayMs?: number, maxDelayMs?: number }} */
  const policy = {};
  /** @type {Array<[string, 'maxProbes' | 'baseDelayMs' | 'maxDelayMs', number]>} */
  const fields = [
    ['db-recovery-max-probes', 'maxProbes', 1],
    ['db-recovery-base-ms', 'baseDelayMs', 1],
    ['db-recovery-max-ms', 'maxDelayMs', 1],
  ];
  for (const [flag, key, min] of fields) {
    const raw = flags[flag];
    if (raw === undefined) continue;
    const value = Number(raw);
    if (!Number.isInteger(value) || value < min) {
      throw new Error(`العلَم --${flag} يحتاج عدداً صحيحاً ≥ ${min}، لا «${raw}».`);
    }
    policy[key] = value;
  }
  return policy;
}

async function main() {
  // ١. المُقلِع (`WL-533`): قبلَ تحميلِ أيِّ وحدةٍ تطبيقيّة. عزلٌ مطلوبٌ ⇒ عزلٌ متحقَّقٌ أو خروج.
  const isolated = bootstrapIsolation(process.env);
  // ٢. التطبيق — بالهويّةِ المُسقَطةِ إن طُلِبَ العزل.
  const {
    PersistentEventLog,
    HaltSwitch,
    isProductionRuntime,
    openProductionEventLog,
    royalVerifierFromPublicKey,
    createTaskQueue,
    createWorker,
    createPendingResultStore,
    settlePendingResults,
    settleUntilAdmitted,
    RECOVERY_EXIT_CODES,
    RECOVERY_VERDICTS,
    WorkerDatabaseFault,
    abortableSleep,
    classifyDatabaseFault,
    createDatabaseRecovery,
    createQuotaLedger,
    loadPolicyBundle,
    createPool,
    WORKER_REGISTRY_ERRORS,
    WorkerRegistryError,
    createWorkerRegistry,
    dbFenceMode,
    prepareFencedWorker,
    pemKeyProvider,
  } = await loadApp();
  const isolatedKey =
    isolated === null
      ? undefined
      : {
          key: pemKeyProvider(
            isolated.pem,
            `worker-fd:${process.env['XUUX_FENCE_WORKER_ID'] ?? 'unknown'}`,
          ),
          evidence: isolated.evidence,
        };
  const options = parseArguments(process.argv.slice(2));
  if (options.publicKey === null) {
    throw new Error(
      'مفتاح الملك العام مطلوب (--halt-public-key أو HALT_PUBLIC_KEY): مفتاح إيقافٍ غير مُتحقَّق منه ليس حرساً.',
    );
  }
  // `D6` (‏`WL-326`): العاملُ قارئٌ لمفتاحِ الإيقافِ لا كاتب — الكاتبُ الواحدُ عمليةُ الجذر.
  const halt = new HaltSwitch(options.haltFile, royalVerifierFromPublicKey(options.publicKey), {
    readOnly: true,
  });
  // وضعُ السياج (‏`WL-532`، ‏`XUUX_DB_FENCE=required`): الحارسُ يصيرُ مركّباً (HaltSwitch +
  // القراءةُ الصارمة `D-14`)، والاعتمادُ يُصدَرُ لهذا الإقلاعِ وحدَه بمصافحةٍ مع المُشرِف
  // (الجذر) يوقّعُ فيها العاملُ تحدّيَه بمفتاحِه، والمجمّعُ بدورِ الإقلاعِ بلا سرّ، ويُثبَتُ
  // قبلَ أيِّ عملٍ أنّ الجلسةَ هي الاعتمادُ النشِط. لا بروتوكولَ موازٍ: كلُّ ما بعدَ هذا
  // السطرِ هو العاملُ نفسُه بالحارسِ نفسِه في كلِّ موضع.
  const fence =
    dbFenceMode(process.env) === 'required'
      ? await prepareFencedWorker({
          env: process.env,
          halt,
          ...(isolatedKey === undefined ? {} : { isolated: isolatedKey }),
        })
      : null;
  const guard = fence === null ? halt : fence.haltGuard;
  const pool =
    fence === null ? createPool() : createPool({ url: fence.databaseUrl, max: FENCED_POOL_SIZE });
  if (fence !== null) {
    // ختمُ الجلسات (`WL-532` §5): كلُّ وصلاتِ المجمّعِ تُفتحُ الآنَ وتُختمُ بمفتاحِ العامل، ثمّ
    // يُغلَقُ الدخولُ بدورِ الإقلاع — عمليةٌ أخرى بالـUID نفسِه لا تدخلُ بعدَها، وإن سبقت أفشلت الختم.
    await fence.seal(pool, FENCED_POOL_SIZE);
    await fence.verify(pool);
    process.stdout.write(
      `وضعُ السياج: ${fence.workerId} بدورِ ${String(fence.credential.role_name)} (عهد ${String(fence.credential.epoch)}، مفتاحٌ عتاديّ: ${fence.hardwareBacked ? 'نعم' : 'لا'}، عزلُ العملية: ${fence.processIsolation === null ? 'لا' : 'نعم'})\n`,
    );
  }
  const queue = createTaskQueue({ pool });
  const isolationLogFile = process.env['ISOLATION_LOG_FILE'] ?? 'state/isolation-events.jsonl';
  // في الإنتاج يُفتحُ السجلُّ مختوماً بمفتاحِ التوكن، ويُلبَسُ مصرِفاً مرتَّباً
  // لأن عقدَ `log.append` عندَ العزلِ متزامنٌ والختمُ ليس كذلك. التصريفُ يقعُ
  // عندَ حدودِ المهامِّ وقبلَ الإغلاق، فإن فشلَ ختمُ واقعةٍ توقّفَ العامل.
  const production = isProductionRuntime(process.env);
  const sealed = production ? await openProductionEventLog(process.env, isolationLogFile) : null;
  const isolationLog = sealed === null ? new PersistentEventLog(isolationLogFile) : sealed.log;
  const isolationSink = sealed === null ? isolationLog : sealed.sink;
  // مخزنُ النتائجِ المعلّقةِ (‏`WL-392`): يكتبُ في سجلِّ العاملِ الدائمِ نفسِهِ —
  // القيمةُ تدومُ على القرصِ قبلَ أولِ كتابةٍ للقاعدةِ، وتُسوّى عندَ إقلاعٍ جديدٍ
  // من الحياةِ السابقةِ للعمليةِ بلا إعادةِ تشغيلِ المُعالِج.
  const pendingResults = createPendingResultStore({
    reader: isolationLog,
    writer: isolationSink,
    worker: options.worker,
  });
  const worker = createWorker({
    queue,
    pool,
    haltGuard: guard,
    ledger: createQuotaLedger({ pool, definitions: loadPolicyBundle().quotas }),
    worker: options.worker,
    pendingResults,
    isolation: {
      workdir: process.cwd(),
      outputRoot: process.env['ISOLATION_OUTPUT_ROOT'] ?? '.isolation-output',
      log: isolationSink,
    },
  });

  // المُستردّ يقيّد في سجلّ العامل نفسه — المختوم في الإنتاج — لا في ملفٍّ جانبيٍّ
  // ظاهر: ما يكشفه قيدُ الاسترداد (مهمّةٌ ومرحلةٌ وبصمةُ نتيجة) يستحقّ الختمَ ذاته.
  const recovery = createDatabaseRecovery({
    pool,
    queue,
    worker: options.worker,
    haltGuard: guard,
    log: isolationSink,
    policy: options.recoveryPolicy,
    // بوابةُ الملكيّةِ على التسويةِ (`WL-396`): الاستردادُ يكتبُ بالمفتاحِ الاسميِّ
    // (`releaseUnstarted` على `lease_owner`)، فلو فقدَ هذا الإقلاعُ اسمَه لإقلاعٍ
    // أحدثَ كانت تسويتُهُ إفراجاً عن عقودِ المالكِ الجديدِ. تُستنطقُ بعدَ عودةِ
    // القاعدةِ وقبلَ أيِّ كتابةٍ، وتقرأُ الحقيقةَ من سجلِّ الإقلاعاتِ لا من ذاكرةِ
    // العمليةِ — فتوقّفَ المالكُ السابقُ بلا تسويةٍ لا يملكُها.
    ownsName: async () => {
      const entry = await registry.readEntry(options.worker);
      // البوابةُ تمنعُ مالكًا **آخرَ** لا مجرَّدَ غيابِ الملكيّةِ: الاسمُ بلا مالكٍ
      // (عاملٌ أُقلعَ والقاعدةُ متوقّفةٌ فلم يَسجُلْ بعدُ) ليسَ أخذاً من أحدٍ —
      // فقتلُ استردادِه بالفقدِ يقتلُ عاملًا بريئًا لم يُنافسْ أحدًا. فالمرجعُ
      // «مالكٌ آخرُ» لا «أنا المالكُ» — والملكُ يعودُ للتسجيلِ في أولِ دورةٍ.
      return entry === null || entry.bootId === bootId;
    },
  });

  // تفرُّدُ اسمِ العاملِ الحيِّ (‏`LIVE-45`/د — `WL-394`): الإقلاعُ يُثبِتُ ملكيّتَه
  // للاسمِ **قبلَ أيِّ حجزٍ** بمعاملةٍ ذرّيّةٍ على القاعدةِ، فعمليّتانِ بالاسمِ
  // نفسِه لا تمرّانِ: الثانيةُ تُرفَضُ برمزٍ مُسمّى وخروجٍ غيرِ صفريّ قبلَ أن
  // تلمسَ طابورًا — لأنّ عاملَينِ بالاسمِ نفسِه يُبطلانَ ضمانَ «لم يبدأ» في
  // `releaseUnstarted`: الثاني يُفرِجُ حجزَ الأوّلِ وقد بدأهُ مُعالِجُه فعلًا.
  // والملكيّةُ عهدةُ قاعدةٍ لا ذاكرةِ عمليةٍ: النبضةُ تُمدَّدُ في الحلقةِ، وإن
  // أخذَ الاسمَ إقلاعٌ أحدثُ (بعدَ تقادُمِ النبضةِ فوقَ العتبةِ) توقّفَ هذا
  // قبلَ أيِّ حجزٍ جديدٍ — فلا يعملُ اثنانِ بالاسمِ نفسِه ولو طالَ انقطاعُ القاعدةِ.
  const bootId = randomUUID();
  const registry = createWorkerRegistry({
    pool,
    ttlMs: options.registrationTtlMs,
    log: isolationSink,
  });
  // التسجيلُ يقعُ أولَ الدورةِ لا هنا: عطبُ القاعدةِ عندَ الإقلاعِ يُصنَّفُ عطبَ
  // دورةٍ (استردادٌ ينتظرُ) لا قتلًا للعاملِ — فلا يُدفنُ عاملٌ حيٌّ لأنّ القاعدةَ
  // كانت متوقفةً عندَ إقلاعِه. والرفضُ إن وقعَ يقعُ **قبلَ أيِّ حجزٍ** دائمًا.
  let registered = false;

  let stopping = false;
  const stopper = new AbortController();
  const stop = () => {
    stopping = true;
    stopper.abort();
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);

  process.stdout.write(`عاملٌ أُقلع: ${options.worker} (ملف الإيقاف: ${options.haltFile})\n`);
  // تسويةُ النتائجِ المعلّقةِ من حياةٍ سابقةٍ للعمليةِ **قبلَ أيِّ حجزٍ جديدٍ** —
  // لا يُحجزُ شقٌّ جديدَ وما زالَ للقيمةِ المُنتَجةِ حقٌّ لم يُستوفَ. والقاعدةُ
  // متوقّفة؟ **يُؤجَّلُ الحجزُ الجديدُ نفسُهُ** كما يُؤجَّلُ الاستردادُ: تُرمى العَطِلةُ
  // وتدخل الحلقةَ في حالةِ العطبِ فلا حجزَ حتى تعودَ القاعدةُ ثمّ تُعادُ المحاولةُ.
  // وما ليسَ عطبَ قاعدةٍ (فسادٌ، عقدٌ غائبٌ) يُرمى كما هو: توقّفٌ عندَ حدٍّ آمنٍ
  // لا التهامٌ الصامتُ الذي يمرّرُ الكاسبَ الجديدَ فوقَ حقٍّ لم يُستوفَ.
  // والإيقافُ السياديّ يؤجّلُ التسويةَ كلَّها: السجلاتُ تنتظرُ الاستئنافَ ولا كتابةَ تحته.
  // والحصيلةُ تحملُ **تأجيلَها بنفسِها** (`deferred`): لا يُعادُ بناءُ «هل
  // أُجِّلتِ التسويةُ؟» من عيّنةٍ لاحقةٍ لحالةِ الإيقافِ — فالاستئنافُ قد يقعُ
  // بينَ التسويةِ والعيّنةِ فيُبنى العلمُ على العدمِ ويُحجزُ شقٌّ فوقَ معلّقةٍ
  // لم تُقضَ. العلمُ يُحملُ من التسويةِ نفسِها.
  /** @returns {Promise<{ fault: WorkerDatabaseFault | null, deferred: boolean }>} */
  const settlePending = async () => {
    try {
      const counts = await settlePendingResults({ store: pendingResults, queue, haltGuard: guard });
      if (counts.examined > 0) {
        process.stdout.write(
          `${new Date().toISOString()} | pending-results | سُوّيت: ${counts.settled} | عُلّقت: ${counts.superseded} | تضادّت: ${counts.conflicts}\n`,
        );
      }
      return { fault: null, deferred: counts.deferred === true };
    } catch (error) {
      const fault = classifyDatabaseFault(error);
      if (fault === null) throw error;
      process.stdout.write(
        `${new Date().toISOString()} | pending-results | عَطِلةُ قاعدةٍ عندَ التسويةِ (${fault.kind}/${fault.code}): الحجزُ الجديدُ مؤجَّلٌ حتى عودتِها\n`,
      );
      return {
        fault: new WorkerDatabaseFault({
          worker: options.worker,
          phase: 'settle-pending',
          taskId: null,
          pending: null,
          fault,
          cause: error,
          at: new Date(),
        }),
        deferred: false,
      };
    }
  };
  let handled = 0;
  /** @type {WorkerDatabaseFault | null} */
  let fault;
  /** @type {number | undefined} */
  let exitCode;
  let lastRecoveryLine = '';
  try {
    // تسويةُ الإقلاعِ: عَطِلةٌ هنا تُدخلُ الحلقةَ في حالةِ العطبِ فتُؤجّلُ الحجزَ
    // الجديدَ حتى تعودَ القاعدةُ ثمّ تُعادُ المحاولةُ — لا يُمرَّرُ كاسبٌ جديدٌ فوقَ
    // قيمةٍ معلّقةٍ لم يُحسَمْ حقُّها.
    const bootSettlement = await settlePending();
    fault = bootSettlement.fault;
    // الإيقافُ السياديُّ **يؤجّلُ التسويةَ ولا يُلغيها**: لا يُحجزُ شقٌّ جديدٌ قبلَ
    // أن تُسوّى النتيجةُ المعلّقةُ التي كانت قبلَه — وعَطِلةُ قاعدةٍ عندَها
    // تدخلُ الحلقةَ في حالةِ العطبِ (استردادٌ ينتظرُ بميزانيتِهِ لا دورانٌ فارغٌ).
    // والتأجيلُ يُحملُ من حصيلةِ التسويةِ نفسِها لا من عيّنةٍ لاحقةٍ.
    const isHalted = () => {
      try {
        guard.assertOperational();
        return false;
      } catch {
        return true;
      }
    };
    let settlementDeferred = bootSettlement.deferred;
    while (!stopping && handled < options.maxTasks) {
      // نبضةُ ملكيّةِ الاسمِ (‏`LIVE-45`/د): قبلَ أيِّ حجزٍ في الدورةِ. فإن أخذَ
      // الاسمَ إقلاعٌ أحدثُ توقّفَ هذا هنا **قبلَ الحجزِ** بخروجٍ غيرِ صفريّ — لا
      // بعدهُ: عاملٌ لا يملكُ اسمهُ لا يضمنُ أنّ ما يُفرِجُهُ لم يبدأهُ غيرُهُ. وعطبُ
      // القاعدةِ عندَ النبضةِ يُصنَّفُ كعطبِ دورةٍ (استردادٌ ينتظرُ) لا يُرمى —
      // فانتظارُ العتبةِ أرحمُ من دفنِ العاملِ الحيّ.
      // لا نبضةَ فوقَ عطبٍ قائمٍ: العطبُ المعلَّقُ يُسلَّمُ للاستردادِ في مكانهِ لا
      // يُعادُ اكتشافُه في كلِّ دورةٍ فتدورَ الحلقةُ بلا بلوغِ الاستردادِ أبدًا.
      if (fault === null) {
        try {
          if (!registered) {
            await registry.register({ worker: options.worker, bootId });
            registered = true;
          } else {
            await registry.heartbeat({ worker: options.worker, bootId });
          }
        } catch (error) {
          if (
            error instanceof WorkerRegistryError &&
            (error.code === WORKER_REGISTRY_ERRORS.NAME_TAKEN ||
              error.code === WORKER_REGISTRY_ERRORS.REGISTRATION_LOST)
          ) {
            process.stderr.write(`توقّف العامل عند حدٍّ آمن: ${error.message}\n`);
            exitCode = 1;
            break;
          }
          const fault2 = classifyDatabaseFault(error);
          if (fault2 === null) throw error;
          process.stdout.write(
            `${new Date().toISOString()} | db-fault | ${fault2.kind}/${fault2.code} | ${
              registered ? 'registry-heartbeat' : 'boot-registration'
            } | —\n`,
          );
          fault = new WorkerDatabaseFault({
            worker: options.worker,
            phase: registered ? 'registry-heartbeat' : 'boot-registration',
            taskId: null,
            pending: null,
            fault: fault2,
            cause: error,
            at: new Date(),
          });
          continue;
        }
      }
      // بوابةُ الحجزِ (مستخرجةٌ لتُقاضى وتُختبرَ): قرارٌ واحدٌ في رأسِ كلِّ
      // دورةٍ — والعلمُ المُقاضى **المحمولُ من حصيلةِ آخرِّ تسويةٍ** لا عيّنةً
      // لاحقةً لحالةِ الإيقافِ. فالاستئنافُ بعدَ إيقافٍ عندَ الإقلاعِ: التسويةُ
      // المؤجَّلةُ تُقضى قبلَ أولِ حجزٍ جديدٍ لا بعده — فالقيمةُ المعلّقةُ أحقُّ
      // من شقٍّ جديد. وإن عطِبَتِ القاعدةُ عندَها فالأمرُ إلى الاستردادِ
      // (ينتظرُ بميزانيتِه) لا إلى إعادةِ نداءٍ فارغةٍ تدورُ بلا انتظار.
      if (fault === null && settlementDeferred) {
        // **العزفُ المستخرجُ نفسُهُ** الذي يُختبرُ (`settleUntilAdmitted`): لا
        // حجزَ في الدورةِ التي حاولتِ التسويةَ — التأجيلُ العائدُ يعيدُ المنعَ
        // والعطبُ إلى الاستردادِ، حتى تعلنَ الحصيلةُ نفسُها انقضاءَ التأجيلِ.
        const outcome = await settleUntilAdmitted({
          halted: isHalted,
          settle: settlePending,
          wait: async () => {
            await abortableSleep(options.pollMs, stopper.signal);
          },
          stopped: () => stopping,
        });
        if (outcome.verdict === 'stopped') break;
        if (outcome.verdict === 'fault') {
          fault = /** @type {WorkerDatabaseFault} */ (outcome.fault);
          continue;
        }
        settlementDeferred = false;
        continue;
      }
      if (fault !== null) {
        const outcome = await recovery.recover(fault, { signal: stopper.signal });
        // التأجيلُ تحت الإيقاف يُطبع مرّةً لا في كلِّ دورة (كما يُقيَّد في السجلّ مرّة).
        const line = `${outcome.verdict}|${outcome.reason}`;
        if (line !== lastRecoveryLine) {
          process.stdout.write(
            `${new Date().toISOString()} | db-recovery | ${outcome.verdict} | ${outcome.reason} | ${outcome.probes} مسبار | ${outcome.durationMs}ms\n`,
          );
        }
        lastRecoveryLine = outcome.retry ? line : '';
        if (sealed !== null) await sealed.sink.drain();
        if (outcome.verdict === RECOVERY_VERDICTS.FAILED) {
          process.stderr.write(
            `توقّف العامل عند حدٍّ آمن: ${outcome.reason} — يحتاج تدخّلاً مخوَّلاً؛ لم يُعَد تشغيلُ شيءٍ ولم يُكتب شيء.\n`,
          );
          exitCode = outcome.exitCode ?? RECOVERY_EXIT_CODES.DB_INTEGRITY;
          break;
        }
        if (outcome.retry) {
          // الإيقاف السياديّ يؤجّل التسوية: لا كتابة حتى يُستأنف، ولا حجز جديد.
          await abortableSleep(options.pollMs, stopper.signal);
          continue;
        }
        // القاعدةُ عادت: أُعيدت المحاولةُ على ما دامَ معلّقاً في السجلّ الدائمِ
        // من الحياةِ السابقةِ — والقيمةُ لا تُفقدُ بانقطاعِ القاعدةِ عندَ التسجيلِ.
        // وعادت العَطِلةُ عندَ التسويةِ؟ يُعادُ تأجيلُ الحجزِ لا الالتهامُ.
        const settleResult = await settlePending();
        if (settleResult.fault !== null) {
          fault = settleResult.fault;
          continue;
        }
        settlementDeferred = settleResult.deferred;
        if (outcome.verdict === RECOVERY_VERDICTS.UNVERIFIED && stopping) {
          exitCode = RECOVERY_EXIT_CODES.DB_UNAVAILABLE;
          break;
        }
        fault = null;
        continue;
      }
      let tick;
      try {
        tick = await worker.tick();
      } catch (error) {
        if (!(error instanceof WorkerDatabaseFault)) throw error;
        process.stdout.write(
          `${new Date().toISOString()} | db-fault | ${error.fault.kind}/${error.fault.code} | ${error.phase} | ${error.taskId ?? '—'}\n`,
        );
        fault = error;
        continue;
      }
      process.stdout.write(
        `${new Date().toISOString()} | ${tick.outcome} | ${tick.taskId ?? '—'} | ${tick.code ?? '—'} | ${tick.durationMs}ms\n`,
      );
      if (tick.outcome === 'idle' || (tick.outcome === 'halted' && tick.taskId === null)) {
        if (options.once) break;
        await abortableSleep(options.pollMs, stopper.signal);
        continue;
      }
      handled += 1;
      // تصريفٌ عندَ حدِّ المهمّة: واقعةُ عزلٍ لم تُختَم ولم تُكتَب توقفُ العامل
      // ولا تُمرَّرُ مهمةٌ تالية — سجلٌّ ناقصٌ أخطرُ من عاملٍ متوقف.
      if (sealed !== null) await sealed.sink.drain();
    }
    // توقّفٌ وعطبٌ معلّقٌ لم يُسوَّ: لا يُعلَن خروجاً سليماً.
    if (fault !== null && exitCode === undefined) exitCode = RECOVERY_EXIT_CODES.DB_UNAVAILABLE;
  } finally {
    // إخلاءُ الاسمِ عندَ التوقّفِ السليمِ (‏`LIVE-45`/د): فورًا لا انتظارَ العتبةِ —
    // فالمشغّلُ الذي يُريدُ إقلاعًا جديدًا بالاسمِ نفسِه بعدَ توقّفٍ سليمٍ لا ينتظرُ.
    // والفشلُ هنا لا يُدفنُ صامتًا (يُعلَن) ولا يُدفنُ العملُ الذي وقعَ (الخروجُ يُحفَظ):
    // الإخلاءُ عهدةُ توقّفٍ لا شرطُ نجاحٍ.
    try {
      await registry.deregister({ worker: options.worker, bootId });
    } catch (error) {
      process.stderr.write(
        `تعذّرَ إخلاءُ اسمِ العاملِ ${options.worker} عند التوقّفِ (${error instanceof Error ? error.message : String(error)}) — الاسمُ يُفتَحُ بعدَ العتبةِ لا فورًا.\n`,
      );
    }
    if (sealed !== null) {
      try {
        await sealed.sink.drain();
      } finally {
        isolationLog.close();
        await sealed.close();
      }
    } else {
      isolationLog.close();
    }
    await pool.end();
  }
  process.stdout.write(`عاملٌ توقّف: ${options.worker} — مهام مُعالَجة: ${handled}\n`);
  if (exitCode !== undefined) process.exitCode = exitCode;
}

/** نقطةُ الدخولِ وحدَها تُشغِّلُ main — الاستيرادُ (‏كاتبُ المختبرِ والاختبارات) لا يُشغِّلُه. */
const isEntry = (() => {
  try {
    return realpathSync(process.argv[1] ?? '') === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
})();

if (isEntry) {
  main().catch((error) => {
    const code = /** @type {any} */ (error)?.code;
    process.stderr.write(
      `فشل إقلاع العامل: ${typeof code === 'string' ? `${code}: ` : ''}${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  });
}
