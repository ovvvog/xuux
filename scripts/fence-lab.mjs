#!/usr/bin/env node
/**
 * مختبرُ سياجِ القاعدة (`WL-532`، §11–§12) — قابلٌ لإعادةِ الإنشاءِ من الصفر في كلِّ تشغيل.
 *
 * ما يفعلُه، بالترتيب، على عنقودِ PostgreSQL **مؤقّتٍ جديد** (لا يمسُّ أيَّ عنقودٍ قائم):
 *  A. يُشغِّلُ اختباراتِ `tests/fence/*.test.mjs` على العنقودِ المؤقّت (بحزامِ كلماتِ المرورِ المعلَن)
 *     ويقرأُ نتيجةَ كلِّ اختبارٍ من TAP.
 *  B. يُشدِّدُ `pg_hba.conf`: أدوارُ الإقلاعِ (`xw_*`) لا تدخلُ إلا بـpeer عبرَ المقبس، وكلُّ عاملٍ
 *     مربوطٌ بمستخدمِ نظامٍ واحدٍ عبرَ `pg_ident.conf` (`T-CRED-05`)، وTCP مرفوضٌ لها.
 *     ثمّ: ربطُ الهويّة، إيقافٌ حقيقيٌّ تحتَ كاتبٍ حيٍّ (متكرّر)، إعادةُ تشغيلِ العنقود ⇒
 *     RECOVERY_REQUIRED ⇒ RECOVER ⇒ HALTED ⇒ RESUME، ونسخةٌ فيزيائيةٌ (`pg_basebackup`) ⇒
 *     RECOVERY_REQUIRED وإعادةُ الأمرِ القديمِ مرفوضة.
 *  C. يكتبُ تقريراً آلياً يميّزُ PASS/FAIL/PARTIAL/NOT RUN لكلِّ فحصٍ ولكلِّ هجومٍ من الخمسةِ
 *     والعشرين، مع SHA-256 لكلِّ سجلٍّ وللتقريرِ نفسِه.
 *
 * **حدودٌ معلنة:** المفاتيحُ مفاتيحُ اختبارٍ مولَّدةٌ في الذاكرة (لا مفتاحَ مالكٍ ولا HSM)؛
 * superuser والجذرُ خارجَ السياجِ عمداً؛ لا تلاعبَ بساعةِ النظام (الهجوم 24 NOT RUN)؛ لا فقدَ
 * طاقةٍ حقيقيّاً (إعادةُ التشغيلِ `pg_ctl -m immediate` فقط). ونجاحُ المختبرِ ليس دليلَ إنتاج.
 *
 * الاستعمال:
 *   node scripts/fence-lab.mjs [--report <path>] [--pg-bin <dir>] [--keep] [--iterations N]
 * البيئة: `XUUX_CGROUP_PARENT` (اختياريّ) لاختبارِ E6؛ `sudo -n` لإنشاءِ مستخدمي العمّال.
 */

import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:net';
import { hostname, release, tmpdir, userInfo } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import pg from 'pg';

import { EventEmitter } from 'node:events';

import {
  FenceRoot,
  FenceSovereign,
  confirmWorkerSeal,
  generateTestKeyProvider,
  newBootId,
  reviewEffectsEvidence,
  signCredentialChallenge,
} from '../src/fence/db-fence.mjs';
import { up } from '../src/persistence/migrator.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_REPORT = 'docs/external-review/evidence/WL-532-fence-lab-report.json';
const WORKERS = /** @type {const} */ (['alpha', 'beta']);
const OS_USER = (/** @type {string} */ w) => `xuuxw-${w}`;

// ── الوسائط ──────────────────────────────────────────────────────────────────

const argv = process.argv.slice(2);
/** @param {string} name @param {string} [fallback] */
const arg = (name, fallback) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : fallback;
};
const reportPath = path.resolve(ROOT, arg('--report', DEFAULT_REPORT) ?? DEFAULT_REPORT);
const keep = argv.includes('--keep');
const iterations = Number(arg('--iterations', '10'));

/** @param {string | Buffer} data */
const sha256 = (data) => createHash('sha256').update(data).digest('hex');

// ── بصمةُ الشجرةِ القابلةِ للتنفيذ (§3: الرأسُ المختبَرُ هو الرأسُ المعروض) ──────────
/** الجذورُ التي يتوقّفُ عليها سلوكُ المختبرِ والاختبارات. */
const TREE_ROOTS = ['src', 'scripts', 'migrations', 'tests', 'config'];
const TREE_FILES = /^(package(-lock)?\.json|tsconfig[^/]*\.json)$/;
/**
 * SHA-256 لقائمةٍ مرتّبةٍ من «مسار␀بصمة» لكلِّ ملفٍّ متتبَّعٍ في git تحتَ الجذورِ أعلاه — من
 * محتوى شجرةِ العملِ (ما يُشغَّلُ فعلاً)، لا من الفهرس.
 * @returns {{ sha256: string, files: number }}
 */
function executableTreeDigest() {
  const r = spawnSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8' });
  const files = r.stdout
    .split('\0')
    .filter(
      (f) => f !== '' && (TREE_ROOTS.some((d) => f.startsWith(`${d}/`)) || TREE_FILES.test(f)),
    )
    .filter((f) => existsSync(path.join(ROOT, f)))
    .sort();
  const lines = files.map((f) => `${f}\0${sha256(readFileSync(path.join(ROOT, f)))}`);
  return { sha256: sha256(lines.join('\n')), files: files.length };
}

if (argv.includes('--verify-report')) {
  // يتحقّقُ من تقريرٍ محفوظ: سلامةُ هاشِ التقرير، ومطابقةُ رأسِه وبصمةِ شجرتِه للشجرةِ الحالية.
  const file = path.resolve(ROOT, arg('--verify-report', DEFAULT_REPORT) ?? DEFAULT_REPORT);
  const saved = JSON.parse(readFileSync(file, 'utf8'));
  const { report_sha256: claimed, ...rest } = saved;
  const problems = [];
  if (sha256(JSON.stringify(rest, null, 2)) !== claimed)
    problems.push('report_sha256 لا يطابقُ المحتوى');
  const tree = executableTreeDigest();
  if (saved.environment?.tree_sha256 !== tree.sha256)
    problems.push(`بصمةُ الشجرة ${saved.environment?.tree_sha256} ≠ الحالية ${tree.sha256}`);
  if (saved.environment?.git_dirty !== false) problems.push('شُغِّلَ على شجرةٍ غيرِ نظيفة');
  const out = { file: path.relative(ROOT, file), ok: problems.length === 0, problems, tree };
  process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
  process.exit(out.ok ? 0 : 1);
}

// ── أدوات ────────────────────────────────────────────────────────────────────

function findPgBin() {
  const explicit = arg('--pg-bin');
  if (explicit) return explicit;
  const r = spawnSync('pg_config', ['--bindir'], { encoding: 'utf8' });
  if (r.status === 0 && existsSync(path.join(r.stdout.trim(), 'initdb'))) return r.stdout.trim();
  for (const v of ['18', '17', '16']) {
    const d = `/usr/lib/postgresql/${v}/bin`;
    if (existsSync(path.join(d, 'initdb'))) return d;
  }
  throw new Error('لا initdb: مرِّرْ --pg-bin');
}

/** @returns {Promise<number>} */
function freePort() {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const a = s.address();
      const port = typeof a === 'object' && a !== null ? a.port : 0;
      s.close(() => resolve(port));
    });
  });
}

const work = mkdtempSync(path.join(tmpdir(), 'xuux-fence-lab-'));
chmodSync(work, 0o755);
const logsDir = path.join(work, 'logs');
mkdirSync(logsDir, { mode: 0o755 });

/** @type {Array<{ name: string, sha256: string, bytes: number }>} */
const logIndex = [];
/** يحفظُ سجلَّ تجربةٍ ويُرجِعُ بصمتَه. @param {string} name @param {string} text */
function saveLog(name, text) {
  writeFileSync(path.join(logsDir, name), text);
  const entry = { name, sha256: sha256(text), bytes: Buffer.byteLength(text) };
  logIndex.push(entry);
  return entry;
}

/**
 * @param {string} cmd @param {string[]} args
 * @param {{ env?: NodeJS.ProcessEnv, input?: string, cwd?: string, timeout?: number }} [opts]
 */
function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, {
    encoding: 'utf8',
    env: opts.env ?? process.env,
    input: opts.input,
    cwd: opts.cwd ?? ROOT,
    timeout: opts.timeout ?? 120_000,
    maxBuffer: 64 * 1024 * 1024,
  });
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '', error: r.error };
}

/** @type {Array<Record<string, any>>} */
const checks = [];
/**
 * @param {string} id @param {string} title @param {'PASS'|'FAIL'|'PARTIAL'|'NOT RUN'} status
 * @param {Record<string, unknown>} [detail]
 */
function record(id, title, status, detail = {}) {
  checks.push({ id, title, status, ...detail });
  process.stdout.write(`${status.padEnd(8)} ${id} — ${title}\n`);
}

/** فحصٌ مغلّف: الاستثناءُ FAIL مع السبب، لا تجاوزٌ صامت. @param {string} id @param {string} title @param {() => Promise<Record<string, unknown> | void>} fn */
async function check(id, title, fn) {
  try {
    const detail = (await fn()) ?? {};
    const status = /** @type {any} */ (detail).status ?? 'PASS';
    delete (/** @type {any} */ (detail).status);
    record(id, title, status, detail);
  } catch (error) {
    record(id, title, 'FAIL', { error: error instanceof Error ? error.message : String(error) });
  }
}

/** @param {unknown} cond @param {string} msg */
function must(cond, msg) {
  if (!cond) throw new Error(msg);
}

// ── العنقود ──────────────────────────────────────────────────────────────────

const pgBin = findPgBin();
const bin = (/** @type {string} */ n) => path.join(pgBin, n);
const me = userInfo().username;

/** @param {string} dir @param {number} port @param {string} sock */
function writeConf(dir, port, sock) {
  const conf = [
    `port = ${port}`,
    `listen_addresses = '127.0.0.1'`,
    `unix_socket_directories = '${sock}'`,
    `unix_socket_permissions = 0777`,
    `max_prepared_transactions = 0`,
    `max_connections = 120`,
    `wal_level = replica`,
    `max_wal_senders = 4`,
    `log_connections = on`,
    `fsync = on`,
  ].join('\n');
  writeFileSync(path.join(dir, 'postgresql.auto.conf'), `${conf}\n`);
}

/** حزامُ الاختبار (المرحلة A): كلماتُ مرورٍ عبرَ TCP — حدٌّ معلنٌ في رأسِ ملفِّ الاختبار. */
const HBA_HARNESS = `local all all peer map=admin
local replication all peer map=admin
host all postgres 127.0.0.1/32 trust
host all all 127.0.0.1/32 scram-sha-256
`;
/** المرحلة B: لا TCP لأحد؛ أدوارُ الإقلاعِ بـpeer فقط ولكلِّ عاملٍ مستخدمُ نظامِه. */
const HBA_STRICT = `local all postgres,xf_root,xf_sovereign peer map=admin
local replication postgres peer map=admin
local all /^xw_ peer map=fence
local all all reject
host all all all reject
`;
const IDENT = `admin ${me} postgres
admin ${me} xf_root
admin ${me} xf_sovereign
admin postgres postgres
${WORKERS.map((w) => `fence ${OS_USER(w)} /^xw_${w}_[0-9a-f]{16}$`).join('\n')}
`;

/** @param {string} data @param {string} log */
function pgStart(data, log) {
  const r = run(bin('pg_ctl'), ['-D', data, '-l', log, '-w', '-t', '60', 'start']);
  must(r.status === 0, `pg_ctl start: ${r.stderr || r.stdout}`);
}
/** @param {string} data @param {'fast'|'immediate'} [mode] */
function pgStop(data, mode = 'fast') {
  return run(bin('pg_ctl'), ['-D', data, '-m', mode, '-w', 'stop']);
}
/** @param {string} data */
function pgReload(data) {
  const r = run(bin('pg_ctl'), ['-D', data, 'reload']);
  must(r.status === 0, `reload: ${r.stderr}`);
}

const cluster = {
  data: path.join(work, 'data'),
  sock: path.join(work, 'sock'),
  log: path.join(logsDir, 'postgres-primary.log'),
  port: 0,
};

// ── المسارُ الرئيسيّ ─────────────────────────────────────────────────────────

const env = {
  pg_bin: pgBin,
  pg_version: run(bin('postgres'), ['--version']).stdout.trim(),
  node: process.version,
  kernel: release(),
  host: hostname(),
  os_user: me,
  sudo: run('sudo', ['-n', 'true']).status === 0,
  cgroup_parent: process.env['XUUX_CGROUP_PARENT'] ?? null,
  git_head: run('git', ['rev-parse', 'HEAD']).stdout.trim(),
  git_dirty: run('git', ['status', '--porcelain']).stdout.trim() !== '',
  tree_sha256: executableTreeDigest().sha256,
  tree_files: executableTreeDigest().files,
};

/** @type {Record<string, { status: string, file: string }>} */
const testResults = {};

async function main() {
  // ── إعدادُ عنقودٍ جديد ──
  cluster.port = await freePort();
  mkdirSync(cluster.sock, { mode: 0o755 });
  chmodSync(cluster.sock, 0o755);
  const init = run(bin('initdb'), [
    '-D',
    cluster.data,
    '-U',
    'postgres',
    '--auth=reject',
    '-E',
    'UTF8',
    '--locale=C',
  ]);
  saveLog('initdb.log', init.stdout + init.stderr);
  must(init.status === 0, `initdb: ${init.stderr}`);
  writeConf(cluster.data, cluster.port, cluster.sock);
  writeFileSync(path.join(cluster.data, 'pg_hba.conf'), HBA_HARNESS);
  writeFileSync(path.join(cluster.data, 'pg_ident.conf'), IDENT);
  pgStart(cluster.data, cluster.log);
  const created = run(bin('createdb'), [
    '-h',
    cluster.sock,
    '-p',
    String(cluster.port),
    '-U',
    'postgres',
    'state',
  ]);
  must(created.status === 0, `createdb state: ${created.stderr}`);
  record('LAB-ENV-01', 'عنقودٌ مؤقّتٌ جديدٌ من initdb (لا ملفّاتٍ قديمة)', 'PASS', {
    port: cluster.port,
  });
  // شجرةٌ غيرُ نظيفةٍ ⇒ FAIL: لا يُعرَضُ تشغيلٌ على تعديلاتٍ غيرِ ملتزَمةٍ كأنّه تشغيلُ الرأس.
  record(
    'LAB-ENV-02',
    'الشجرةُ نظيفةٌ: الرأسُ المختبَرُ هو الملتزَم (git_head + tree_sha256)',
    env.git_dirty ? 'FAIL' : 'PASS',
    { git_head: env.git_head, tree_sha256: env.tree_sha256, git_dirty: env.git_dirty },
  );

  // ── A: اختباراتُ السياجِ على العنقودِ الجديد ──
  const tcpUrl = `postgresql://postgres@127.0.0.1:${cluster.port}/state`;
  /** @type {Array<[string, Record<string, string>]>} */
  const suites = [
    ['tests/fence/db-fence.test.mjs', {}],
    ['tests/fence/fence-lifecycle.test.mjs', {}],
    ['tests/fence/halt-integrity.test.mjs', {}],
    ['tests/fence/effects.test.mjs', {}],
    ['tests/fence/connection-map.test.mjs', {}],
    // §6: libsodium مرجعٌ مستقلٌّ **إلزاميّ** هنا (غيابُه FAIL لا SKIP)، وضبابٌ أوسع.
    ['tests/fence/ed25519.test.mjs', { XUUX_ED_SODIUM: 'required', XUUX_ED_FUZZ_N: '2000' }],
  ];
  for (const [file, extraEnv] of suites) {
    const r = run(
      process.execPath,
      ['--test', '--test-reporter=tap', '--test-concurrency=1', '--test-timeout=600000', file],
      { env: { ...process.env, DATABASE_URL: tcpUrl, ...extraEnv }, timeout: 1_800_000 },
    );
    const log = saveLog(`${path.basename(file)}.tap`, r.stdout + r.stderr);
    let parsed = 0;
    const lines = r.stdout.split('\n');
    // مجموعاتُ describe في المستوى الأعلى حين يكونُ في الملفِّ نتائجُ متداخلة: ليست اختبارات.
    const nested = lines.some((l) => /^\s+(not ok|ok) \d+ - /.test(l));
    for (const line of lines) {
      const m = /^(\s*)(not ok|ok) \d+ - (.*?)(?: # (SKIP|TODO)\b(.*))?$/.exec(line);
      if (m === null) continue;
      if (nested && (m[1] ?? '') === '') continue;
      const name = (m[3] ?? '').replace(/\\#/g, '#').trim();
      const status = m[4] === 'SKIP' ? 'NOT RUN' : m[2] === 'ok' ? 'PASS' : 'FAIL';
      testResults[name] = { status, file };
      parsed++;
    }
    record(
      `LAB-SUITE-${path.basename(file, '.test.mjs')}`,
      `تشغيلُ ${file}`,
      r.status === 0 && parsed > 0 ? 'PASS' : 'FAIL',
      {
        exit: r.status,
        tests: parsed,
        log: log.name,
        log_sha256: log.sha256,
      },
    );
  }

  // ── B: المختبرُ الحيّ ──
  await liveLab();
}

/** @param {string} database */
function socketClient(database, user = 'postgres', port = cluster.port, host = cluster.sock) {
  const c = new pg.Client({ host, port, user, database });
  c.on('error', () => {});
  return c;
}

/**
 * psql بمستخدمِ نظامِ عامل (sudo) عبرَ المقبس.
 * @param {string} osUser @param {string} role @param {string} sql
 * @param {{ host?: string, port?: number, database?: string }} [o]
 */
function psqlAs(osUser, role, sql, o = {}) {
  const args = [
    '-n',
    '-u',
    osUser,
    bin('psql'),
    '-X',
    '-v',
    'ON_ERROR_STOP=1',
    '-At',
    '-h',
    o.host ?? cluster.sock,
    '-p',
    String(o.port ?? cluster.port),
    '-U',
    role,
    '-d',
    o.database ?? 'lab',
    '-c',
    sql,
  ];
  const r = osUser === me ? run(bin('psql'), args.slice(4)) : run('sudo', args);
  return { ok: r.status === 0, out: r.stdout.trim(), err: r.stderr.trim() };
}

async function liveLab() {
  const admin = socketClient('postgres');
  await admin.connect();
  await admin.query('CREATE DATABASE lab');
  const labPool = new pg.Pool({
    host: cluster.sock,
    port: cluster.port,
    user: 'postgres',
    database: 'lab',
    max: 3,
  });
  labPool.on('error', () => {});
  await up(labPool);

  // أدوارُ العمّالِ على مستوى العنقود من المرحلة A أُسقِطت بحزامِها؛ نتحقّق.
  const sovereignKey = generateTestKeyProvider('lab-sovereign');
  const keys = {
    alpha: generateTestKeyProvider('lab-alpha'),
    beta: generateTestKeyProvider('lab-beta'),
  };
  await labPool.query('SELECT fence.bootstrap($1)', [sovereignKey.publicKeyRaw()]);

  /** @type {pg.Client} */
  let sovClient = socketClient('lab', 'xf_sovereign');
  await sovClient.connect();
  const sovereign = new FenceSovereign(sovClient, sovereignKey);
  const root = new FenceRoot(
    async () => {
      const c = socketClient('lab', 'xf_root');
      await c.connect();
      return c;
    },
    { lockTimeoutMs: 500 },
  );
  const bypass = (
    await labPool.query(
      `SELECT rolname FROM pg_roles WHERE rolcanlogin AND (rolsuper OR rolbypassrls OR rolreplication OR rolcreaterole) ORDER BY 1`,
    )
  ).rows.map((r) => String(r.rolname));
  await sovereign.breakglassSet(bypass);
  await sovereign.rosterSet(
    WORKERS.map((w) => ({
      worker_id: w,
      pubkey: keys[w].publicKeyRaw(),
      os_principal: OS_USER(w),
    })),
  );
  await labPool.query(
    `CREATE TABLE state.lab_probe (v text NOT NULL DEFAULT gen_random_uuid()::text, writer text NOT NULL, at timestamptz NOT NULL DEFAULT clock_timestamp())`,
  );
  await labPool.query(`GRANT SELECT, INSERT ON state.lab_probe TO xuux_worker`);

  const reconnectSovereign = async () => {
    sovClient = socketClient('lab', 'xf_sovereign');
    await sovClient.connect();
    sovereign.db = sovClient;
  };
  /**
   * استئنافٌ كما يفعلُه المشغِّل: دليلُ الآثارِ مربوطٌ بآخرِ إيقافٍ مكتمل، فإن لم يجتزْ مراجعةَ
   * السياديِّ (لا دليلَ في العهدِ بعدَ الإقلاعِ أو RECOVER، أو دليلٌ لإيقافٍ سابق) يُجرى إيقافٌ كامل.
   * @param {string} label
   */
  const resume = async (label) => {
    let s = await sovereign.status();
    if (!reviewEffectsEvidence(s, String(s.effects_evidence?.sha256)).ok) {
      const hr = await root.halt(`lab-resume-${label}`, { effects: noEffects });
      must(hr.systemHaltComplete === true, `إيقافُ ما قبلَ الاستئناف: ${JSON.stringify(hr)}`);
      s = await sovereign.status();
    }
    return sovereign.resume(String(s.effects_evidence?.sha256));
  };
  const noEffects = {
    stop: async () => ({ ok: true, detail: { lab: true, scopes: [], egress: [] } }),
  };
  const boot = async (/** @type {'alpha'|'beta'} */ w) => {
    const bootId = newBootId();
    const c = await root.issueCredential(w, bootId, (ch) =>
      signCredentialChallenge(keys[w], ch, { workerId: w, bootId }),
    );
    return { ...c, boot_id: bootId };
  };

  // ── تشديدُ المصادقة ──
  writeFileSync(path.join(cluster.data, 'pg_hba.conf'), HBA_STRICT);
  pgReload(cluster.data);
  await new Promise((r) => setTimeout(r, 300));
  const tcpProbe = run(bin('psql'), [
    '-X',
    '-h',
    '127.0.0.1',
    '-p',
    String(cluster.port),
    '-U',
    'postgres',
    '-d',
    'lab',
    '-c',
    'select 1',
  ]);
  record(
    'LAB-AUTH-01',
    'بعدَ التشديد: TCP مرفوضٌ حتى لـpostgres؛ الدخولُ بالمقبسِ وpeer فقط',
    tcpProbe.status !== 0 ? 'PASS' : 'FAIL',
    {
      stderr: tcpProbe.stderr.trim().slice(0, 200),
    },
  );

  await resume('initial');
  must((await sovereign.status()).effective.state === 'RUNNING', 'لم يصل RUNNING');

  // ── مستخدمو النظامِ للعمّال ──
  let osUsersReady = env.sudo;
  if (env.sudo) {
    for (const w of WORKERS) {
      if (run('getent', ['passwd', OS_USER(w)]).status !== 0) {
        const r = run('sudo', [
          '-n',
          'useradd',
          '--system',
          '--no-create-home',
          '--shell',
          '/usr/sbin/nologin',
          OS_USER(w),
        ]);
        if (r.status !== 0) osUsersReady = false;
      }
    }
  }

  // ── تطبيقُ العاملِ: نسخةٌ يقرؤها مستخدمو العمّال (المستودعُ تحتَ مجلّدٍ 0750) ──
  const app = path.join(work, 'app');
  /** @type {Record<string, string>} */
  const keyFiles = {};
  /** يمدُّ نسخةَ src/ وكاتبِ المختبرِ واعتمادِ pg (وإغلاقِه)، ومفاتيحُ العمّالِ 0400 لمالكيها. */
  const prepareApp = () => {
    mkdirSync(path.join(app, 'scripts'), { recursive: true });
    cpSync(path.join(ROOT, 'src'), path.join(app, 'src'), { recursive: true });
    cpSync(
      path.join(ROOT, 'scripts', 'fence-lab-writer.mjs'),
      path.join(app, 'scripts', 'fence-lab-writer.mjs'),
    );
    cpSync(path.join(ROOT, 'package.json'), path.join(app, 'package.json'));
    const seen = new Set();
    const pending = ['pg'];
    while (pending.length > 0) {
      const name = /** @type {string} */ (pending.pop());
      if (seen.has(name)) continue;
      seen.add(name);
      const dir = path.join(ROOT, 'node_modules', name);
      cpSync(dir, path.join(app, 'node_modules', name), { recursive: true });
      const pkg = JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8'));
      pending.push(...Object.keys(pkg.dependencies ?? {}));
    }
    must(run('chmod', ['-R', 'a+rX,go-w', app]).status === 0, 'chmod app');
    const keysDir = path.join(app, 'keys');
    mkdirSync(keysDir, { mode: 0o755 });
    chmodSync(keysDir, 0o755);
    for (const w of WORKERS) {
      const tmpKey = path.join(work, `${w}.pem.tmp`);
      writeFileSync(tmpKey, keys[w].privateKeyPem, { mode: 0o600 });
      keyFiles[w] = path.join(keysDir, `${w}.pem`);
      const inst = run('sudo', [
        '-n',
        'install',
        '-o',
        OS_USER(w),
        '-m',
        '0400',
        tmpKey,
        /** @type {string} */ (keyFiles[w]),
      ]);
      rmSync(tmpKey, { force: true });
      must(inst.status === 0, `install key ${w}: ${inst.stderr}`);
    }
    return { packages: [...seen].sort() };
  };

  /**
   * يُطلقُ كاتباً حقيقيّاً بمستخدمِ نظامِ العامل: مجمّعُ pg مختومٌ بمفتاحِ العامل.
   * @param {'alpha'|'beta'} w @param {Record<string, any>} c - الاعتمادُ المُصدَر
   * @param {{ writer: string, poolSize?: number, keyOf?: 'alpha'|'beta', sealOnly?: boolean }} o
   */
  const spawnWriter = async (w, c, o) => {
    const s = await sovereign.status();
    const input = {
      sock: cluster.sock,
      port: cluster.port,
      database: 'lab',
      role: String(c.role_name),
      workerId: w,
      bootId: String(c.boot_id),
      epoch: c.epoch,
      sysid: String(s.live.sysid),
      keyFile: keyFiles[o.keyOf ?? w],
      poolSize: o.poolSize ?? 4,
      writer: o.writer,
      sealOnly: o.sealOnly === true,
    };
    const child = spawn(
      'sudo',
      [
        '-n',
        '-u',
        OS_USER(w),
        process.execPath,
        path.join(app, 'scripts', 'fence-lab-writer.mjs'),
        Buffer.from(JSON.stringify(input)).toString('base64url'),
      ],
      { cwd: app, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    const bus = new EventEmitter();
    /** @type {Array<Record<string, any>>} */
    const messages = [];
    let buf = '';
    let stderr = '';
    child.stdout.on('data', (d) => {
      buf += d;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 1);
        try {
          const m = JSON.parse(line);
          messages.push(m);
          bus.emit('message', m);
        } catch {
          stderr += `${line}\n`;
        }
      }
    });
    child.stderr.on('data', (d) => (stderr += d));
    const exited = new Promise((resolve) => child.on('exit', (code) => resolve(code)));
    /** @param {string[]} types @param {number} [ms] */
    const waitFor = (types, ms = 15_000) =>
      new Promise((resolve) => {
        const hit = messages.find((m) => types.includes(m.type));
        if (hit) return resolve(hit);
        const t = setTimeout(() => {
          bus.off('message', on);
          resolve({ type: 'timeout' });
        }, ms);
        /** @param {any} m */
        const on = (m) => {
          if (!types.includes(m.type)) return;
          clearTimeout(t);
          bus.off('message', on);
          resolve(m);
        };
        bus.on('message', on);
      });
    return {
      child,
      bus,
      messages,
      exited,
      waitFor,
      get stderr() {
        return stderr;
      },
      kill: () => run('sudo', ['-n', 'pkill', '-KILL', '-u', OS_USER(w), '-f', 'fence-lab-writer']),
    };
  };
  /** @param {string} role */
  const credStatus = async (role) =>
    (
      await labPool.query(
        'SELECT status, revoke_reason FROM fence.credentials WHERE role_name = $1',
        [role],
      )
    ).rows[0] ?? null;
  /** @param {string} writer */
  const rowsOf = async (writer) =>
    Number(
      (
        await labPool.query(`SELECT count(*)::int AS n FROM state.lab_probe WHERE writer = $1`, [
          writer,
        ])
      ).rows[0].n,
    );

  const cred = await boot('alpha');
  const role = String(cred.role_name);
  const workerChecks = [
    'LAB-APP',
    'LAB-CRED-05a',
    'LAB-CRED-05b',
    'LAB-CRED-05c',
    'LAB-CRED-05d',
    'LAB-CRED-05e',
    'LAB-SEAL-01',
    'LAB-UID-01',
    'LAB-UID-02',
    'LAB-UID-03',
    'LAB-UID-04',
    'LAB-UID-05',
    'LAB-HALT-LIVE',
  ];
  if (!osUsersReady) {
    for (const id of workerChecks)
      record(id, 'يتطلّبُ مستخدمي نظامٍ للعمّال (sudo -n)', 'NOT RUN', {
        reason: 'لا sudo غيرُ تفاعليّ',
      });
  } else {
    await check('LAB-APP', 'نسخةُ تطبيقِ العاملِ ومفاتيحُه (0400 لمستخدمِ كلِّ عامل)', async () =>
      prepareApp(),
    );
    await check(
      'LAB-CRED-05a',
      'T-CRED-05: مستخدمُ نظامِ alpha يدخلُ بدورِ إقلاعِه بلا سرّ (peer) ويعرفُ نفسَه — لكنّ جلسةً غيرَ مختومةٍ لا تكتب (XF011)',
      async () => {
        const r = psqlAs(OS_USER('alpha'), role, `SELECT fence.whoami()::text`);
        must(r.ok, r.err);
        const who = JSON.parse(r.out.split('\n').pop() ?? '{}');
        must(
          who.known === true &&
            who.worker_id === 'alpha' &&
            who.credential_status === 'ACTIVE' &&
            who.sealed === false,
          r.out,
        );
        const w = psqlAs(
          OS_USER('alpha'),
          role,
          `INSERT INTO state.lab_probe(writer) VALUES ('alpha-unsealed')`,
        );
        must(!w.ok && /المختومة/.test(w.err), `كتابةٌ غيرُ مختومةٍ قُبِلت: ${w.out}${w.err}`);
        return { whoami: who, unsealed_write: w.err.split('\n')[0]?.slice(0, 200) };
      },
    );
    await check(
      'LAB-CRED-05b',
      'T-CRED-05: مستخدمُ نظامِ beta لا يستعملُ اعتمادَ alpha (الهجوم 2)',
      async () => {
        const r = psqlAs(OS_USER('beta'), role, 'SELECT 1');
        must(
          !r.ok && /Peer authentication failed|authentication failed/.test(r.err),
          `قُبِل: ${r.out}${r.err}`,
        );
        return { stderr: r.err.slice(0, 200) };
      },
    );
    await check(
      'LAB-CRED-05c',
      'T-CRED-05: مستخدمُ المختبرِ نفسُه (مالكُ العنقود) لا يدخلُ بدورِ alpha',
      async () => {
        const r = psqlAs(me, role, 'SELECT 1');
        must(!r.ok, `قُبِل: ${r.out}`);
        return { stderr: r.err.slice(0, 200) };
      },
    );
    await check(
      'LAB-CRED-05d',
      'T-CRED-05: دورُ الإقلاعِ عبرَ TCP مرفوضٌ (لا سرَّ قابلاً للنقل)',
      async () => {
        const r = run(
          bin('psql'),
          [
            '-X',
            '-h',
            '127.0.0.1',
            '-p',
            String(cluster.port),
            '-U',
            role,
            '-d',
            'lab',
            '-c',
            'select 1',
          ],
          {
            env: { ...process.env, PGPASSWORD: 'x' },
          },
        );
        must(r.status !== 0, 'قُبِل');
        return { stderr: r.stderr.trim().slice(0, 200) };
      },
    );
    await check(
      'LAB-CRED-05e',
      'مستخدمُ نظامِ العاملِ لا يدخلُ بدورِ xf_root ولا xf_sovereign ولا postgres',
      async () => {
        for (const r2 of ['xf_root', 'xf_sovereign', 'postgres']) {
          const r = psqlAs(OS_USER('alpha'), r2, 'SELECT 1');
          must(!r.ok, `${r2} قُبِل`);
        }
      },
    );

    // ── §5: ختمُ الجلساتِ وعمليّاتٌ بالـUID نفسِه ──
    await check(
      'LAB-SEAL-01',
      'عملية Node بمستخدمِ alpha تختمُ مجمّعَها (4 وصلات) وتكتب؛ المُشرِفُ يطابقُ الختم',
      async () => {
        const wr = await spawnWriter('alpha', cred, { writer: 'seal-01', poolSize: 4 });
        const confirmed = await confirmWorkerSeal(root, wr.bus, cred, { timeoutMs: 15_000 });
        await new Promise((r) => setTimeout(r, 300));
        const n = await rowsOf('seal-01');
        must(n > 0, `لا كتابة: ${wr.stderr}`);
        // UID-01 هنا: الكاتبُ حيّ ومختوم.
        const late = psqlAs(
          OS_USER('alpha'),
          role,
          `INSERT INTO state.lab_probe(writer) VALUES ('uid-01')`,
        );
        record(
          'LAB-UID-01',
          'عمليةٌ ثانيةٌ بالـUID نفسِه بعدَ الختم: الدخولُ مرفوض (الدورُ NOLOGIN) والعاملُ يواصل',
          !late.ok &&
            /not permitted to log in/.test(late.err) &&
            (await credStatus(role))?.status === 'ACTIVE'
            ? 'PASS'
            : 'FAIL',
          { stderr: late.err.split('\n')[0]?.slice(0, 200), credential: await credStatus(role) },
        );
        await root.revokeCredential(role, 'lab-seal-01-done');
        const code = await Promise.race([
          wr.exited,
          new Promise((r) => setTimeout(() => r('timeout'), 10_000)),
        ]);
        if (code === 'timeout') wr.kill();
        return { sessions: confirmed, rows: n, writer_exit: code, stopped: wr.messages.at(-1) };
      },
    );
    await check(
      'LAB-UID-02',
      'دخيلٌ بالـUID نفسِه حاضرٌ لحظةَ الختم ⇒ الختمُ مرفوض (session_set_mismatch)، الاعتمادُ يُلغى، الدخيلُ يُنهى',
      async () => {
        const c = await boot('alpha');
        const r = String(c.role_name);
        const intruder = spawn(
          'sudo',
          [
            '-n',
            '-u',
            OS_USER('alpha'),
            bin('psql'),
            '-X',
            '-At',
            '-h',
            cluster.sock,
            '-p',
            String(cluster.port),
            '-U',
            r,
            '-d',
            'lab',
            '-c',
            'SELECT pg_sleep(30)',
          ],
          { stdio: ['ignore', 'ignore', 'pipe'] },
        );
        let ierr = '';
        intruder.stderr.on('data', (d) => (ierr += d));
        const iexit = new Promise((res) => intruder.on('exit', (code) => res(code)));
        for (let i = 0; i < 50; i++) {
          const n = (
            await labPool.query(
              'SELECT count(*)::int AS n FROM pg_stat_activity WHERE usename = $1',
              [r],
            )
          ).rows[0].n;
          if (n > 0) break;
          await new Promise((res) => setTimeout(res, 100));
        }
        const wr = await spawnWriter('alpha', c, { writer: 'uid-02' });
        const sealP = confirmWorkerSeal(root, wr.bus, c, { timeoutMs: 15_000 }).then(
          () => 'confirmed',
          (e) => String(e.message),
        );
        const msg = await wr.waitFor(['xuux-fence/sealed', 'xuux-fence/seal-failed']);
        const sup = await sealP;
        const code = await Promise.race([
          iexit,
          new Promise((res) => setTimeout(() => res('timeout'), 10_000)),
        ]);
        if (code === 'timeout') intruder.kill('SIGKILL');
        const st = await credStatus(r);
        must(msg.type === 'xuux-fence/seal-failed', JSON.stringify(msg));
        must(
          st?.status === 'REVOKED' && /session_set_mismatch/.test(String(st?.revoke_reason)),
          JSON.stringify(st),
        );
        must(code !== 0 && code !== 'timeout', `الدخيلُ لم يُنهَ (${code})`);
        must((await rowsOf('uid-02')) === 0, 'كتابةٌ رغمَ الرفض');
        return {
          worker: msg,
          supervisor: sup,
          credential: st,
          intruder_exit: code,
          intruder_stderr: ierr.trim().slice(0, 160),
        };
      },
    );
    await check(
      'LAB-UID-03',
      'دخيلٌ بالـUID نفسِه بلا المفتاح يختمُ بتوقيعٍ مزوَّر ⇒ bad_signature، الاعتمادُ يُلغى',
      async () => {
        const c = await boot('alpha');
        const r = String(c.role_name);
        const q = psqlAs(
          OS_USER('alpha'),
          r,
          `SELECT fence.seal_sessions(jsonb_build_array(fence.session_tag()), decode(repeat('ab', 64), 'hex'))::text`,
        );
        const out = JSON.parse(q.out.split('\n').pop() || '{}');
        const st = await credStatus(r);
        must(out.sealed === false && out.reason === 'bad_signature', q.out + q.err);
        must(st?.status === 'REVOKED', JSON.stringify(st));
        return { result: out, credential: st };
      },
    );
    await check(
      'LAB-UID-04',
      'حدُّ نظامِ التشغيل: مفتاحُ alpha (0400) لا يقرؤه مستخدمُ beta — ويقرؤه أيُّ عمليةٍ بـUID alpha (حدٌّ معلن)',
      async () => {
        const other = run('sudo', [
          '-n',
          '-u',
          OS_USER('beta'),
          'cat',
          /** @type {string} */ (keyFiles['alpha']),
        ]);
        const same = run('sudo', [
          '-n',
          '-u',
          OS_USER('alpha'),
          'cat',
          /** @type {string} */ (keyFiles['alpha']),
        ]);
        must(other.status !== 0, 'beta قرأ مفتاحَ alpha');
        must(same.status === 0 && same.stdout.includes('PRIVATE KEY'), 'UID alpha لم يقرأ مفتاحَه');
        return {
          beta_read: other.stderr.trim().slice(0, 160),
          same_uid_can_read: true,
          note: 'أيُّ عمليةٍ بـUID العاملِ تقرأُ المفتاحَ وتستطيعُ ptrace العاملِ (لا Yama هنا) — الختمُ لا يُثبتُ هويّةَ العمليةِ أمامَها',
        };
      },
    );
    await check(
      'LAB-UID-05',
      'خطرٌ متبقٍّ: عمليةٌ بالـUID نفسِه تقرأُ المفتاحَ وتسبقُ العاملَ إلى الختم ⇒ تختمُ وتكتب؛ العاملُ الحقيقيُّ يفشلُ فيُلغي المُشرِفُ الاعتمادَ ويُنهي المهاجم',
      async () => {
        const c = await boot('alpha');
        const r = String(c.role_name);
        const attacker = await spawnWriter('alpha', c, { writer: 'uid-05-attacker', poolSize: 2 });
        const am = await attacker.waitFor(['xuux-fence/sealed', 'xuux-fence/seal-failed']);
        must(am.type === 'xuux-fence/sealed', `المهاجمُ لم يختم: ${JSON.stringify(am)}`);
        await new Promise((res) => setTimeout(res, 300));
        const real = await spawnWriter('alpha', c, { writer: 'uid-05-real' });
        const sup = await confirmWorkerSeal(root, real.bus, c, { timeoutMs: 15_000 }).then(
          () => 'confirmed',
          (e) => String(e.message),
        );
        const revokedAt = new Date();
        const acode = await Promise.race([
          attacker.exited,
          new Promise((res) => setTimeout(() => res('timeout'), 10_000)),
        ]);
        if (acode === 'timeout') attacker.kill();
        await new Promise((res) => setTimeout(res, 300));
        const before = await rowsOf('uid-05-attacker');
        const afterRevoke = Number(
          (
            await labPool.query(
              `SELECT count(*)::int AS n FROM state.lab_probe WHERE writer = 'uid-05-attacker' AND at > $1`,
              [revokedAt],
            )
          ).rows[0].n,
        );
        const st = await credStatus(r);
        must(sup !== 'confirmed', 'المُشرِفُ أكّدَ ختمَ المهاجم');
        must(st?.status === 'REVOKED', JSON.stringify(st));
        must(afterRevoke === 0, `كتابةٌ بعدَ الإلغاء: ${afterRevoke}`);
        must((await rowsOf('uid-05-real')) === 0, 'العاملُ الحقيقيُّ كتب');
        return {
          residual_risk: true,
          attacker_rows_before_revoke: before,
          attacker_rows_after_revoke: afterRevoke,
          attacker_exit: acode,
          real_worker: real.messages[0] ?? null,
          supervisor: sup,
          credential: st,
          note: 'كشفٌ بعديٌّ لا منع: نافذةُ المهاجمِ بينَ ختمِه وفشلِ العاملِ الحقيقيّ حقيقية',
        };
      },
    );

    // ── إيقافٌ حقيقيٌّ تحتَ كاتبٍ حيٍّ مختوم، متكرّر ──
    /** @type {Array<Record<string, unknown>>} */
    const rounds = [];
    let failures = 0;
    for (let i = 0; i < iterations; i++) {
      if ((await sovereign.status()).effective.state !== 'RUNNING') await resume(`pre-live-${i}`);
      const c = await boot('alpha');
      const r = String(c.role_name);
      const writer = `w${i}`;
      const wr = await spawnWriter('alpha', c, { writer, poolSize: 4 });
      const sealed = await confirmWorkerSeal(root, wr.bus, c, { timeoutMs: 15_000 }).then(
        () => true,
        (e) => String(e.message),
      );
      await new Promise((res) => setTimeout(res, 150 + Math.floor(Math.random() * 400)));
      const before = await rowsOf(writer);
      const h = await root.halt(`lab-live-${i}`, { effects: noEffects });
      const code = await Promise.race([
        wr.exited,
        new Promise((res) => setTimeout(() => res('timeout'), 10_000)),
      ]);
      const fencedAt = (
        await labPool.query(`SELECT max(at) AS t FROM fence.evidence WHERE kind = 'DB_FENCED'`)
      ).rows[0].t;
      const n1 = await rowsOf(writer);
      const late = Number(
        (
          await labPool.query(
            `SELECT count(*)::int AS n FROM state.lab_probe WHERE writer = $1 AND at >= $2`,
            [writer, fencedAt],
          )
        ).rows[0].n,
      );
      await new Promise((res) => setTimeout(res, 250));
      const n2 = await rowsOf(writer);
      const relogin = psqlAs(
        OS_USER('alpha'),
        r,
        `INSERT INTO state.lab_probe(writer) VALUES ('${writer}-relogin')`,
      );
      const ok =
        sealed === true &&
        h.dbFenced === true &&
        h.systemHaltComplete === true &&
        before > 0 &&
        late === 0 &&
        n1 === n2 &&
        code !== 0 &&
        code !== 'timeout' &&
        !relogin.ok;
      if (!ok) failures++;
      rounds.push({
        i,
        sealed,
        before,
        committed: n1,
        after_wait: n2,
        late_writes: late,
        writer_exit: code,
        writer_stopped: wr.messages.find((m) => m.type === 'stopped') ?? null,
        relogin_refused: !relogin.ok,
        systemHaltComplete: h.systemHaltComplete,
      });
      if (code === 'timeout') wr.kill();
      await resume(`lab-live-${i}`);
    }
    const lg = saveLog('halt-live-rounds.json', JSON.stringify(rounds, null, 2));
    record(
      'LAB-HALT-LIVE',
      `إيقافٌ حقيقيٌّ تحتَ كاتبٍ Node مختومٍ (4 وصلات) بمستخدمِ نظامِ العامل × ${iterations}: لا كتابةَ بعدَ DB_FENCED، الكاتبُ يُنهى، وإعادةُ الدخولِ مرفوضة`,
      failures === 0 ? 'PASS' : 'FAIL',
      {
        iterations,
        failures,
        log: lg.name,
        log_sha256: lg.sha256,
      },
    );
  }

  // ── إعادةُ تشغيلِ العنقود (انهيارٌ فوريّ) ⇒ RECOVERY_REQUIRED ──
  let replayResume = /** @type {{ payload: any, signature: any } | null} */ (null);
  await check(
    'LAB-RESTART',
    'انهيارُ العنقود (immediate) ⇒ RECOVERY_REQUIRED؛ RECOVER موقَّعٌ ⇒ HALTED لا RUNNING؛ ثمّ RESUME',
    async () => {
      const s0 = await sovereign.status();
      if (s0.effective.state === 'RUNNING')
        await root.halt('lab-pre-restart', { effects: noEffects });
      const st = await sovereign.status();
      replayResume = sovereign.sign('resume', st, {
        roster_hash: st.bound.roster_hash,
        pm_start_epoch: String(st.live.pm_start_epoch),
        effects_evidence_sha256: '0'.repeat(64),
      });
      await sovClient.end().catch(() => {});
      await labPool.end();
      await admin.end().catch(() => {});
      const stop = pgStop(cluster.data, 'immediate');
      must(stop.status === 0, `stop: ${stop.stderr}`);
      pgStart(cluster.data, cluster.log);
      await reconnectSovereign();
      const s = await sovereign.status();
      must(
        s.effective.state === 'RECOVERY_REQUIRED',
        `الحالةُ بعدَ إعادةِ التشغيل ${s.effective.state}`,
      );
      const replay = await sovClient
        .query('SELECT fence.resume($1,$2)', [replayResume?.payload, replayResume?.signature])
        .then(
          () => null,
          (e) => e.code,
        );
      must(replay !== null, 'أمرُ استئنافٍ مُعادٌ قُبِل بعدَ إعادةِ التشغيل');
      const r = await sovereign.recover();
      must(r.state === 'HALTED', `RECOVER أفضى إلى ${r.state}`);
      await resume('after-restart');
      const s2 = await sovereign.status();
      must(s2.effective.state === 'RUNNING', s2.effective.state);
      return {
        after_restart: s.effective,
        replay_rejected: replay,
        recovered_to: r.state,
        epoch: s2.bound.epoch,
      };
    },
  );

  // ── نسخةٌ فيزيائيةٌ قديمة (pg_basebackup) ⇒ RECOVERY_REQUIRED ──
  await check(
    'LAB-PHYS-RESTORE',
    'استعادةُ نسخةٍ فيزيائيةٍ قديمة (pg_basebackup) ⇒ RECOVERY_REQUIRED؛ الكتابةُ والأمرُ المُعادُ مرفوضان (الهجومان 21 و23)',
    async () => {
      const c = osUsersReady ? await boot('alpha') : null;
      const st = await sovereign.status();
      const oldCmd = sovereign.sign('resume', st, {
        roster_hash: st.bound.roster_hash,
        pm_start_epoch: String(st.live.pm_start_epoch),
        effects_evidence_sha256: '0'.repeat(64),
      });
      const copyDir = path.join(work, 'copy');
      const bb = run(bin('pg_basebackup'), [
        '-h',
        cluster.sock,
        '-p',
        String(cluster.port),
        '-U',
        'postgres',
        '-D',
        copyDir,
        '-X',
        'stream',
        '-c',
        'fast',
      ]);
      saveLog('pg_basebackup.log', bb.stdout + bb.stderr);
      must(bb.status === 0, `pg_basebackup: ${bb.stderr}`);
      // الأصلُ يمضي: إيقافٌ واستئنافٌ يرفعانِ العهد — النسخةُ أقدم.
      await root.halt('lab-after-backup', { effects: noEffects });
      await resume('after-backup');
      const copyPort = await freePort();
      const copySock = path.join(work, 'sock-copy');
      mkdirSync(copySock, { mode: 0o755 });
      chmodSync(copySock, 0o755);
      chmodSync(copyDir, 0o700);
      writeConf(copyDir, copyPort, copySock);
      pgStart(copyDir, path.join(logsDir, 'postgres-copy.log'));
      try {
        const cc = socketClient('lab', 'postgres', copyPort, copySock);
        await cc.connect();
        const eff = (await cc.query('SELECT fence.effective_state() AS e')).rows[0].e;
        must(eff.state === 'RECOVERY_REQUIRED', `النسخةُ ${JSON.stringify(eff)}`);
        const chk = (await cc.query('SELECT fence.check_fenced() AS c')).rows[0].c;
        await cc.end();
        const cs = socketClient('lab', 'xf_sovereign', copyPort, copySock);
        await cs.connect();
        const replay = await cs
          .query('SELECT fence.resume($1,$2)', [oldCmd.payload, oldCmd.signature])
          .then(
            () => null,
            (e) => e.code,
          );
        await cs.end();
        must(replay !== null, 'أمرٌ قديمٌ قُبِلَ على النسخة');
        let write = 'NOT RUN';
        if (c !== null) {
          const w = psqlAs(
            OS_USER('alpha'),
            String(c.role_name),
            `INSERT INTO state.lab_probe(writer) VALUES ('copy')`,
            { host: copySock, port: copyPort },
          );
          must(!w.ok, 'كتابةٌ على النسخةِ قُبِلت');
          write = w.err.split('\n')[0]?.slice(0, 160) ?? '';
        }
        return {
          status: c === null ? 'PARTIAL' : 'PASS',
          copy_state: eff,
          copy_check_ok: chk.ok,
          replay_rejected: replay,
          worker_write: write,
        };
      } finally {
        pgStop(copyDir, 'fast');
      }
    },
  );

  await sovClient.end().catch(() => {});
}

// ── خريطةُ الهجماتِ الخمسةِ والعشرين (§11) ──────────────────────────────────

/** مرجعٌ إلى اختبارٍ باسمِه (بادئة) أو فحصٍ مخبريّ. */
const T = (/** @type {string} */ prefix) => ({ test: prefix });
const L = (/** @type {string} */ id) => ({ lab: id });
/** @type {Array<{ n: number, title: string, refs: Array<{test?: string, lab?: string}>, partial?: string, notRun?: string }>} */
const ATTACKS = [
  {
    n: 1,
    title: 'الكتابةُ مباشرةً دونَ مكتبةِ XUUX',
    refs: [T('هويّةٌ مزوَّرة'), T('T-OWN-04'), L('LAB-CRED-05c')],
  },
  { n: 2, title: 'استخدامُ اعتمادِ عاملٍ آخر', refs: [L('LAB-CRED-05b'), T('T-CRED-07')] },
  { n: 3, title: 'إعادةُ استعمالِ اعتمادٍ قديم', refs: [T('الاعتمادُ القديم')] },
  { n: 4, title: 'إعادةُ الاتصالِ بعدَ الإيقاف', refs: [T('T-EFF-01'), L('LAB-HALT-LIVE')] },
  {
    n: 5,
    title: 'الكتابةُ من معاملةٍ بدأت قبلَ الإيقاف',
    refs: [T('T-EFF-01'), L('LAB-HALT-LIVE')],
  },
  { n: 6, title: 'الكتابةُ تحتَ REPEATABLE READ', refs: [T('REPEATABLE READ')] },
  {
    n: 7,
    title: 'الكتابةُ بعدَ الاستئنافِ من جلسةٍ قديمة',
    refs: [T('T-EFF-01'), L('LAB-HALT-LIVE')],
  },
  { n: 8, title: 'تعطيلُ Trigger', refs: [T('جدولٌ جديدٌ بلا زناد'), T('T-OWN-04')] },
  { n: 9, title: 'إضافةُ جدولٍ دونَ Trigger', refs: [T('جدولٌ جديدٌ بلا زناد')] },
  { n: 10, title: 'استبدالُ دالّةِ SECURITY DEFINER', refs: [T('جدولٌ جديدٌ بلا زناد')] },
  { n: 11, title: 'تزويرُ GUC', refs: [T('هويّةٌ مزوَّرة')] },
  { n: 12, title: 'التلاعبُ بـsearch_path', refs: [T('هويّةٌ مزوَّرة')] },
  { n: 13, title: 'استخدامُ SET ROLE', refs: [T('T-OWN-04'), T('T-CRED-05')] },
  { n: 14, title: 'COPY وMERGE وTRUNCATE', refs: [T('الكتابةُ المشروعة'), T('T-OWN-04')] },
  { n: 15, title: 'large objects', refs: [T('T-OWN-04')] },
  {
    n: 16,
    title: 'NOTIFY',
    refs: [T('T-EFF-01')],
    partial:
      'NOTIFY لا يُسحَبُ بامتياز؛ الجلساتُ تُنهى عندَ الإيقافِ فلا NOTIFY بعدَه، لكنّ ما أُرسِلَ قبلَ الالتزامِ في نافذةِ الإيقافِ خطرٌ متبقٍّ مُعلَن (E3)',
  },
  { n: 17, title: 'الاحتفاظُ بقفلٍ استشاريّ', refs: [T('T-EFF-01')] },
  {
    n: 18,
    title: 'تشغيلُ عمليةٍ فرعيةٍ بعدَ موتِ الأب',
    refs: [T('E6: cgroup.kill'), T('E6: بلا cgroup')],
  },
  { n: 19, title: 'إرسالُ HTTPS بعدَ HALT', refs: [T('T-EFF-02')] },
  { n: 20, title: 'إعادةُ تشغيلِ رسالةِ Outbox قديمة', refs: [T('T-EFF-03')] },
  { n: 21, title: 'استعادةُ نسخةٍ قديمة', refs: [T('T-REC-05'), L('LAB-PHYS-RESTORE')] },
  {
    n: 22,
    title: 'حذفُ كلِّ ملفّاتِ حالةِ الجذر',
    refs: [T('D-14: غيابُ الثلاثيّةِ'), T('D-14: تاريخٌ محذوفٌ'), T('D-14: ملفُّ العهد')],
  },
  {
    n: 23,
    title: 'استعادةُ جذرٍ وقاعدةٍ متوافقَين من نسخةٍ قديمة',
    refs: [T('D-14: استرجاعُ ثلاثيّةٍ أقدمَ'), L('LAB-PHYS-RESTORE')],
    partial:
      'الكشفُ يعتمدُ على حدِّ عهدٍ خارجيٍّ (XUUX_HALT_EPOCH_FLOOR) وتجسُّدِ العنقود؛ مَن يملكُ الحدَّ والقاعدةَ معاً (الجذر/superuser) خارجَ نموذجِ التهديد — لا مرساةَ مستقلّةً (HSM/TPM) متاحة',
  },
  {
    n: 24,
    title: 'التلاعبُ بساعةِ القاعدة',
    refs: [],
    notRun:
      'تغييرُ ساعةِ النظامِ يتطلّبُ صلاحيةَ المضيفِ ولا faketime في المختبر؛ الإيجارُ يعتمدُ clock_timestamp() — خطرٌ متبقٍّ مُعلَن',
  },
  {
    n: 25,
    title: 'الانهيارُ في منتصفِ كلِّ خطوةٍ من الإيقافِ والاستئناف',
    refs: [T('الحقنُ بالأعطال'), L('LAB-RESTART')],
    partial:
      'الإيقافُ: حقنٌ بعدَ كلِّ خطوة + انهيارُ العنقود. الاستئنافُ معاملةٌ واحدةٌ ذرّيةٌ (لا نقاطَ وسطى قابلةً للحقن)، ولا فقدَ طاقةٍ حقيقيّاً (§14-8)',
  },
];

function resolveAttacks() {
  return ATTACKS.map((a) => {
    const evidence = a.refs.map((ref) => {
      if (ref.lab) {
        const c = checks.find((x) => x.id === ref.lab);
        return { ref: ref.lab, status: c?.status ?? 'NOT RUN' };
      }
      const key = Object.keys(testResults).find((k) => k.startsWith(ref.test ?? '\u0000'));
      return {
        ref: key ?? ref.test,
        status: key ? (testResults[key]?.status ?? 'NOT RUN') : 'NOT RUN',
      };
    });
    /** @type {string} */
    let status;
    if (a.notRun) status = 'NOT RUN';
    else if (evidence.some((e) => e.status === 'FAIL')) status = 'FAIL';
    else if (evidence.length === 0 || evidence.every((e) => e.status === 'NOT RUN'))
      status = 'NOT RUN';
    else if (evidence.some((e) => e.status !== 'PASS') || a.partial) status = 'PARTIAL';
    else status = 'PASS';
    return {
      n: a.n,
      title: a.title,
      status,
      evidence,
      ...(a.partial ? { partial: a.partial } : {}),
      ...(a.notRun ? { not_run: a.notRun } : {}),
    };
  });
}

// ── التشغيلُ والتقرير ────────────────────────────────────────────────────────

try {
  await main();
} catch (error) {
  const fatal = error instanceof Error ? `${error.message}\n${error.stack}` : String(error);
  record('LAB-FATAL', 'خطأٌ أوقفَ المختبر', 'FAIL', { error: fatal.slice(0, 2000) });
} finally {
  pgStop(cluster.data, 'fast');
  if (existsSync(cluster.log)) {
    const t = readFileSync(cluster.log, 'utf8');
    logIndex.push({ name: 'postgres-primary.log', sha256: sha256(t), bytes: Buffer.byteLength(t) });
  }
}

const attacks = resolveAttacks();
const count = (/** @type {Array<Record<string, any>>} */ xs) =>
  Object.fromEntries(
    ['PASS', 'FAIL', 'PARTIAL', 'NOT RUN'].map((s) => [s, xs.filter((x) => x.status === s).length]),
  );
const report = {
  schema: 'xuux/fence-lab-report/v1',
  work_log: 'WL-532',
  generated_at: new Date().toISOString(),
  environment: env,
  declared_limits: [
    'مفاتيحُ اختبارٍ مولَّدةٌ في الذاكرة — لا مفتاحَ مالكٍ ولا HSM/TPM (hardwareBacked=false)',
    'superuser والجذرُ (root) خارجَ السياجِ عمداً ويُعلَنانِ break-glass — لا حمايةَ منهما',
    'المرحلةُ A تستعملُ حزامَ كلماتِ مرورٍ عبرَ TCP (حدٌّ معلنٌ في رأسِ الاختبار)؛ ربطُ الهويّةِ بـpeer يُثبَتُ في المرحلةِ B وحدَها',
    'لا تلاعبَ بساعةِ النظامِ ولا فقدَ طاقةٍ حقيقيّاً؛ الانهيارُ = pg_ctl -m immediate',
    'نجاحُ المختبرِ ليس دليلَ جاهزيّةٍ إنتاجية، ولا يمسُّ RISK-0054 (NO-GO)',
  ],
  summary: {
    checks: count(checks),
    attacks: count(attacks),
    tests: count(Object.values(testResults)),
  },
  checks,
  tests: testResults,
  attacks,
  logs: logIndex,
};
const body = JSON.stringify(report, null, 2);
const final = JSON.stringify({ ...report, report_sha256: sha256(body) }, null, 2);
mkdirSync(path.dirname(reportPath), { recursive: true });
writeFileSync(reportPath, `${final}\n`);
process.stdout.write(`\nالتقرير: ${path.relative(ROOT, reportPath)}\n`);
process.stdout.write(
  `الفحوص ${JSON.stringify(report.summary.checks)} · الهجمات ${JSON.stringify(report.summary.attacks)}\n`,
);
if (keep) process.stdout.write(`أُبقيَ مجلّدُ العمل: ${work}\n`);
else rmSync(work, { recursive: true, force: true });
process.exitCode =
  checks.some((c) => c.status === 'FAIL') || attacks.some((a) => a.status === 'FAIL') ? 1 : 0;
