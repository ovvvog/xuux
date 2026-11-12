#!/usr/bin/env node
/**
 * عقدُ وحدةِ systemd المكافئةِ للمُطلِق — WL-533 (‏البند ٣ من الجولة اللاحقة).
 *
 *   node scripts/fence-worker-unit.mjs --node /usr/bin/node --entry /opt/xuux/scripts/worker.mjs \
 *     --key-file /etc/xuux/worker.key --uid 990 --gid 990 [--pass PGHOST,PGPORT] [--no-trust-check] \
 *     [-- <وسائط العامل>]
 *
 * يطبعُ نصَّ الوحدةِ على stdout **فقط**: لا يكتبُ ملفّاً، ولا يستدعي systemctl، ولا يُثبِّتُ شيئاً.
 * التثبيتُ قرارُ مالكٍ (‏D-SUP-1/2) لم يُتَّخذ. الوحدةُ مبنيّةٌ من **المصدرِ نفسِه** الذي يبني منه
 * المُطلِقُ أمرَه (`isolatedLaunchEnv` وثوابتُ الحدِّ في scripts/worker.mjs)، فلا عقدَ موازٍ:
 *
 *   - `User=root` و`NoNewPrivileges=yes` و`CapabilityBoundingSet=CAP_SETUID CAP_SETGID` و
 *     `AmbientCapabilities=` فارغ — ما يتطلّبُه المُقلِعُ قبلَ أن يُسقِطَ هويّتَه (‏NoNewPrivs=1،
 *     CapBnd ⊆ 0xc0)؛
 *   - `Environment=` بقائمةِ السماحِ نفسِها، بلا `EnvironmentFile=`؛
 *   - `UnsetEnvironment=` لأسماءٍ عدائيّةٍ معروفة: بيئةُ مديرِ systemd (`systemctl set-environment`)
 *     تُورَّثُ لكلِّ الوحدات. القائمةُ **ليست شاملة** (لا أنماطَ في UnsetEnvironment)؛ ما يفلتُ منها
 *     يرفضُه المُقلِعُ (`hostileLaunchInputs`) — كشفٌ لا منع؛
 *   - `OpenFile=<key>:xuux-key:read-only` (‏systemd ≥ 253): يفتحُه المديرُ ويمرّرُه على الواصف 3
 *     ما دامت الوحدةُ بلا مقابسِ تفعيل؛ والمُقلِعُ يفحصُ الواصفَ المفتوحَ بـfstat؛
 *   - `ExecStart=` مطلقٌ، وثقةُ node ونقطةِ الدخولِ تُفحَصُ قبلَ التوليد بعقدِ `codeTrustViolations`.
 *
 * حدود: هذا **عقدٌ نصّيٌّ مُختبَر**، لا دليلَ على سلوكِ systemd فعلاً على مضيفٍ ما (‏لم يُشغَّل
 * systemd هنا). ولا يحمي من root ولا يُثبتُ هويّةَ العملية.
 */
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  ALLOWED_CAP_BND,
  ISOLATION_ERRORS,
  IsolationError,
  codeTrustViolations,
  isolatedLaunchEnv,
} from './worker.mjs';

/** أسماءُ القدرات في حدِّ ALLOWED_CAP_BND (‏البتّ ٦ CAP_SETGID، ٧ CAP_SETUID). */
const CAP_NAMES = Object.freeze({ 6: 'CAP_SETGID', 7: 'CAP_SETUID' });

/** أسماءٌ عدائيّةٌ معروفةٌ تُزالُ من بيئةِ المدير — ليست شاملة. */
export const UNSET_ENV = Object.freeze([
  'NODE_OPTIONS',
  'NODE_PATH',
  'NODE_EXTRA_CA_CERTS',
  'NODE_REPL_EXTERNAL_MODULE',
  'NODE_TLS_REJECT_UNAUTHORIZED',
  'NODE_DEBUG',
  'NODE_V8_COVERAGE',
  'LD_PRELOAD',
  'LD_LIBRARY_PATH',
  'LD_AUDIT',
  'XUUX_FENCE_WORKER_KEY',
]);

/** القدراتُ المسموحةُ في الحدّ، مشتقّةً من ALLOWED_CAP_BND لا مكتوبةً يدويّاً. */
export function boundingCapabilities() {
  /** @type {string[]} */
  const caps = [];
  for (let bit = 0; bit < 64; bit++) {
    if ((ALLOWED_CAP_BND >> BigInt(bit)) & 1n) {
      const name = /** @type {Record<number, string>} */ (CAP_NAMES)[bit];
      if (name === undefined) throw new Error(`بتّ قدرةٍ بلا اسم: ${bit}`);
      caps.push(name);
    }
  }
  return caps.sort().reverse(); // CAP_SETUID CAP_SETGID
}

/** محارفُ تُغيّرُ معنى سطرِ الوحدة (‏فاصل، اقتباس، هروب، محدِّد %) — رفضٌ لا هروب. */
const UNSAFE = /[\s"'\\%;$`]/u;

/** @param {string} v */
const hasControl = (v) => [...v].some((c) => c.charCodeAt(0) < 0x20 || c.charCodeAt(0) === 0x7f);

/** @param {string} what @param {string} v */
function safe(what, v) {
  if (typeof v !== 'string' || v === '' || UNSAFE.test(v) || hasControl(v)) {
    throw new IsolationError(
      ISOLATION_ERRORS.CONFIG,
      `${what} يحوي محرفاً لا يُكتَبُ في وحدةِ systemd بأمان: «${String(v)}».`,
    );
  }
  return v;
}

/**
 * يولّدُ نصَّ الوحدة. يرمي `FENCE_ISOLATION_CONFIG` لمُدخلٍ غيرِ آمن، و`FENCE_ISOLATION_HOSTILE_ENV`
 * لاسمٍ ممنوع، و`FENCE_ISOLATION_UNTRUSTED_CODE` لشيفرةٍ غيرِ موثوقة (ما لم يُعطَّل الفحصُ صراحةً).
 * @param {{ node: string, entry: string, args?: readonly string[], keyFile: string, uid: number,
 *   gid: number, env?: NodeJS.ProcessEnv, pass?: readonly string[], description?: string,
 *   trust?: false | { fs?: import('./worker.mjs').TrustFs, pins?: Readonly<Record<string, string>> } }} o
 * @returns {{ unit: string, env: Record<string, string>, trust: number }}
 */
export function systemdUnit(o) {
  const env = isolatedLaunchEnv({ ...o, env: o.env ?? {} });
  safe('node', o.node);
  safe('entry', o.entry);
  safe('keyFile', o.keyFile);
  for (const a of o.args ?? []) safe('وسيط', a);
  for (const [k, v] of Object.entries(env)) safe(`قيمة ${k}`, v);
  let checked = 0;
  if (o.trust !== false) {
    const t = codeTrustViolations([o.node, o.entry], o.trust ?? {});
    if (t.violations.length > 0) {
      throw new IsolationError(
        ISOLATION_ERRORS.UNTRUSTED_CODE,
        `مولّدُ الوحدةِ يرفض: ${t.violations.join('؛ ')}.`,
        t.violations,
      );
    }
    checked = t.checked.length;
  }
  const description = [...(o.description ?? 'XUUX fenced worker (WL-533 contract)')]
    .filter((c) => !hasControl(c) && c !== '%')
    .join('');
  const lines = [
    '# مولَّدٌ من scripts/fence-worker-unit.mjs — عقدٌ لم يُثبَّت (‏D-SUP-1/2).',
    '[Unit]',
    `Description=${description}`,
    '',
    '[Service]',
    'Type=simple',
    'User=root',
    'Group=root',
    'NoNewPrivileges=yes',
    `CapabilityBoundingSet=${boundingCapabilities().join(' ')}`,
    'AmbientCapabilities=',
    'UMask=0077',
    `UnsetEnvironment=${UNSET_ENV.join(' ')}`,
    ...Object.entries(env).map(([k, v]) => `Environment=${k}=${v}`),
    `OpenFile=${o.keyFile}:xuux-key:read-only`,
    `ExecStart=${[o.node, o.entry, ...(o.args ?? [])].join(' ')}`,
    'Restart=no',
    '',
  ];
  return { unit: lines.join('\n'), env, trust: checked };
}

/**
 * يقرأُ نصَّ وحدةٍ مولَّدة (‏للاختبار والتحقّق) — لا محلّلَ systemd عامّاً.
 * @param {string} text
 */
export function parseUnit(text) {
  /** @type {Record<string, string[]>} */
  const d = {};
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#') || line.startsWith('[')) continue;
    const i = line.indexOf('=');
    const k = line.slice(0, i);
    (d[k] ??= []).push(line.slice(i + 1));
  }
  return d;
}

/** @param {string[]} argv */
function parseArgs(argv) {
  const dash = argv.indexOf('--');
  const own = dash === -1 ? argv : argv.slice(0, dash);
  const args = dash === -1 ? [] : argv.slice(dash + 1);
  /** @type {Record<string, string | boolean>} */
  const f = {};
  for (let i = 0; i < own.length; i++) {
    const a = own[i] ?? '';
    if (a === '--no-trust-check') f['no-trust-check'] = true;
    else if (a.startsWith('--')) f[a.slice(2)] = own[++i] ?? '';
    else throw new Error(`وسيطٌ غيرُ معروف: ${a}`);
  }
  return { f, args };
}

function main() {
  const { f, args } = parseArgs(process.argv.slice(2));
  const str = (/** @type {string} */ k) => (typeof f[k] === 'string' ? String(f[k]) : '');
  const { unit } = systemdUnit({
    node: str('node'),
    entry: str('entry'),
    keyFile: str('key-file'),
    uid: Number(str('uid')),
    gid: Number(str('gid')),
    env: process.env,
    pass: str('pass') === '' ? [] : str('pass').split(','),
    args,
    trust: f['no-trust-check'] === true ? false : {},
  });
  process.stdout.write(unit);
}

const isMain = (() => {
  try {
    return realpathSync(process.argv[1] ?? '') === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
})();
if (isMain) {
  try {
    main();
  } catch (e) {
    const err = /** @type {Error & { code?: string }} */ (e);
    process.stderr.write(`${err.code ?? 'ERROR'}: ${err.message}\n`);
    process.exit(2);
  }
}
