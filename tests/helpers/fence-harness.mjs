/**
 * حزامُ اختباراتِ سياجِ القاعدة (`WL-532`): قاعدةٌ معزولةٌ مهاجَرة، سياديٌّ وجذرٌ بدوريهما، وعاملان
 * في القائمة. مشتركٌ بينَ `tests/fence/db-fence.test.mjs` و`tests/fence/fence-lifecycle.test.mjs`
 * كي تُختبَرَ دورةُ الحياةِ (الختم، دليلُ الآثار، HALT/RESUME) في ملفٍّ مستقلٍّ بلا تكرارٍ للحزام.
 *
 * حدُّ الحزامِ المعلن: الدخولُ بكلمةِ مرورٍ عشوائيةٍ يمنحُها superuser (لا peer). المختبرُ
 * (`scripts/fence-lab.mjs`) هو ما يختبرُ peer وUIDs حقيقية.
 */

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHmac, randomBytes } from 'node:crypto';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before } from 'node:test';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

import {
  FenceRoot,
  FenceSovereign,
  FenceSupervisor,
  SUPERVISOR_LOCK_KEY,
  SupervisorBootGate,
  generateTestKeyProvider,
  newBootId,
  reviewEffectsEvidence,
  sealFencedSessions,
  signCredentialChallenge,
} from '../../src/fence/db-fence.mjs';
import { up } from '../../src/persistence/migrator.mjs';
import { createIsolatedDatabase, databaseUrl, quoteIdent } from './pg.mjs';

/**
 * يمسكُ رفضَ وعدٍ ويُرجعُه.
 * @param {() => Promise<unknown>} fn
 * @returns {Promise<any>}
 */
export async function rejection(fn) {
  try {
    await fn();
  } catch (error) {
    return error;
  }
  throw new Error('لم يُرفَض النداءُ وكان يجب أن يُرفَض');
}

/**
 * يرفضُ بأحدِ الرموزِ المتوقَّعة.
 * @param {() => Promise<unknown>} fn
 * @param {string[]} codes
 * @param {string} why
 */
export async function rejectsWith(fn, codes, why) {
  const error = await rejection(fn);
  assert.ok(
    codes.includes(error.code),
    `${why}: الرمز ${error.code} (${error.message}) وليس من ${codes.join('/')}`,
  );
  return error;
}

/**
 * الحزام: قاعدةٌ معزولةٌ مُسيَّجة، سياديٌّ، جذر، وعاملان في القائمة.
 * @param {string} label
 */
export async function harness(label) {
  const admin = new pg.Pool({ connectionString: databaseUrl(), max: 2 });
  await dropStrayWorkerRoles(admin);
  const db = await createIsolatedDatabase(label);
  await up(db.pool);
  const superuser = String((await db.pool.query('SELECT current_user AS u')).rows[0].u);
  /** @type {pg.Client[]} */
  const clients = [];
  /**
   * يتّصلُ بدور (كلمةُ مرورٍ عشوائيةٌ يمنحُها superuser — حدُّ الحزامِ المعلن).
   * @param {string} role
   * @param {{ database?: string }} [opts]
   */
  const login = async (role, opts = {}) => {
    const password = randomBytes(18).toString('base64url');
    // WL-538: دورُ الإقلاعِ يصدرُ بـVALID UNTIL '-infinity' (‏لا دخولَ بكلمةِ مرورٍ أبداً). الحزامُ
    // (‏superuser، حدُّه المعلن) يفتحُه للحظةِ الدخولِ ثمّ يُعيدُه كما صدر — فالجلسةُ القائمةُ تبقى،
    // وما يُختبَرُ بعدَها هو الدورُ بحالتِه المُصدَرة لا بحالةٍ صنعها الحزام.
    const prev = (
      await db.pool.query(
        `SELECT rolvaliduntil IS NOT NULL AND rolvaliduntil <= now() AS expired FROM pg_roles WHERE rolname = $1`,
        [role],
      )
    ).rows[0];
    const reopen = prev?.expired === true;
    await db.pool.query(
      `ALTER ROLE ${quoteIdent(role)} PASSWORD '${password}'${reopen ? ` VALID UNTIL 'infinity'` : ''}`,
    );
    const url = new URL(databaseUrl() ?? '');
    url.username = role;
    url.password = password;
    url.pathname = `/${opts.database ?? db.name}`;
    const client = new pg.Client({ connectionString: url.toString() });
    client.on('error', () => {});
    try {
      await client.connect();
    } finally {
      if (reopen) await db.pool.query(`ALTER ROLE ${quoteIdent(role)} VALID UNTIL '-infinity'`);
    }
    clients.push(client);
    return client;
  };
  let rootClient = await login('xf_root');
  let sovClient = await login('xf_sovereign');
  const sovereignKey = generateTestKeyProvider('sovereign');
  await db.pool.query('SELECT fence.bootstrap($1)', [sovereignKey.publicKeyRaw()]);
  // WL-540: الاحتواءُ جزءٌ من الإقلاعِ السياديّ (‏superuser). عنقودُ الاختبارِ مشترك: تُحفَظُ منحُ PUBLIC السابقةُ
  // لكلِّ قاعدةٍ فتُعادُ عند الإغلاق كما كانت (‏لا أثرَ جانبيٌّ على قواعدَ غيرِ الحزام).
  /** @type {Map<string, string[]>} */
  const publicBefore = new Map();
  const containDatabases = async () => {
    const before = await db.pool.query(
      `SELECT datname, array_remove(ARRAY[
         CASE WHEN has_database_privilege('public', oid, 'CONNECT') THEN 'CONNECT' END,
         CASE WHEN has_database_privilege('public', oid, 'TEMPORARY') THEN 'TEMPORARY' END], NULL) AS privs
       FROM pg_database WHERE datname <> current_database() AND datallowconn`,
    );
    for (const r of before.rows)
      if (r.privs.length && !publicBefore.has(r.datname)) publicBefore.set(r.datname, r.privs);
    return (await db.pool.query('SELECT fence.contain_database_reach() AS r')).rows[0].r;
  };
  await containDatabases();
  const sovereign = new FenceSovereign(sovClient, sovereignKey);
  const root = new FenceRoot(
    async () =>
      /** @type {any} */ ({
        query: (/** @type {any[]} */ ...a) => /** @type {any} */ (rootClient).query(...a),
      }),
    {
      lockTimeoutMs: 400,
    },
  );
  const keys = { alpha: generateTestKeyProvider('alpha'), beta: generateTestKeyProvider('beta') };
  const bypass = (
    await db.pool.query(
      `SELECT rolname FROM pg_roles WHERE rolcanlogin AND (rolsuper OR rolbypassrls OR rolreplication OR rolcreaterole) ORDER BY 1`,
    )
  ).rows.map((r) => String(r.rolname));
  await sovereign.breakglassSet(bypass);
  await sovereign.rosterSet([
    { worker_id: 'alpha', pubkey: keys.alpha.publicKeyRaw(), os_principal: 'xuuxw-alpha' },
    { worker_id: 'beta', pubkey: keys.beta.publicKeyRaw(), os_principal: 'xuuxw-beta' },
  ]);
  // ‏WL-579: الجذرُ لا يُصدِرُ قبلَ نجاحِ كنسِ الإقلاع — كما يفعلُ مُشرِفٌ يُقلِع.
  const bootGate = new SupervisorBootGate(root);
  await bootGate.start();
  // جدولُ اختبارٍ يُنشَأُ تحتَ HALTED فيُغطّى تلقائياً (مُطلِقُ DDL).
  await db.pool.query(
    `CREATE TABLE state.fence_probe (id integer PRIMARY KEY, v text NOT NULL DEFAULT '')`,
  );
  await db.pool.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON state.fence_probe TO xuux_worker`);

  /**
   * استئنافٌ سياديّ. الدليلُ مربوطٌ بآخرِ إيقافٍ مكتمل (`XF509`)، فإن لم يكن في العهدِ الحاليِّ
   * دليلُ آثارٍ (بعدَ الإقلاعِ أو RECOVER) يُجرى إيقافٌ كاملٌ أوّلاً. وخارجَ HALTED يُحاوَلُ تسجيلُ
   * الدليلِ نفسُه كي يُرفَضَ برمزِ القاعدة (XF507) لا بمراجعةِ العميل.
   */
  const resume = async () => {
    let s = await sovereign.status();
    if (s.effective.state !== 'HALTED') {
      const detail = { harness: label, ok: true, halt_id: 0, epoch: Number(s.bound?.epoch ?? 0) };
      const d = (
        await rootClient.query(
          `SELECT encode(sha256(convert_to($1::jsonb::text,'UTF8')),'hex') AS d`,
          [JSON.stringify(detail)],
        )
      ).rows[0].d;
      await rootClient.query('SELECT fence.record_effects_evidence($1, $2::jsonb)', [
        d,
        JSON.stringify(detail),
      ]);
    }
    // دليلٌ لا يجتازُ مراجعةَ السياديِّ (سلبيّ، لإيقافٍ سابق، لقائمةٍ سابقة) ⇒ إيقافٌ كاملٌ جديد.
    if (!reviewEffectsEvidence(s, String(s.effects_evidence?.sha256)).ok) {
      await root.halt(`harness-${label}`, { effects: NO_EFFECTS });
      s = await sovereign.status();
    }
    return sovereign.resume(String(s.effects_evidence?.sha256));
  };

  /**
   * يُصدِرُ اعتمادَ إقلاعٍ لعاملٍ ويتّصلُ به.
   * @param {'alpha' | 'beta'} workerId
   * @param {{ connect?: boolean, seal?: boolean }} [opts]
   */
  const boot = async (workerId, opts = {}) => {
    const bootId = newBootId();
    const credential = await root.issueCredential(workerId, bootId, (ch) =>
      signCredentialChallenge(keys[workerId], ch, { workerId, bootId }),
    );
    const secret = (
      await db.pool.query('SELECT rolpassword IS NULL AS none FROM pg_authid WHERE rolname = $1', [
        credential.role_name,
      ])
    ).rows[0];
    const client = opts.connect === false ? null : await login(credential.role_name);
    /** @type {Array<{ pid: number, start: string }> | null} */
    let sealed = null;
    if (client !== null && opts.seal !== false) {
      const live = (await sovereign.status()).live;
      sealed = await sealFencedSessions([client], keys[workerId], {
        db: db.name,
        sysid: String(live.sysid),
        workerId,
        bootId,
        epoch: credential.epoch,
        roleName: String(credential.role_name),
      });
    }
    return { bootId, credential, client, sealed, issuedWithoutSecret: secret?.none === true };
  };

  return {
    db,
    admin,
    superuser,
    login,
    root,
    bootGate,
    get rootClient() {
      return rootClient;
    },
    sovereign,
    get sovClient() {
      return sovClient;
    },
    /** بعدَ قطعِ وصلاتِ القاعدة (نسخُ القالب): وصلتا الجذرِ والسياديِّ من جديد. */
    async reconnect() {
      rootClient = await login('xf_root');
      sovClient = await login('xf_sovereign');
      sovereign.db = sovClient;
    },
    keys,
    resume,
    boot,
    /** WL-540: احتواءٌ من جديد (‏بعدَ نسخِ قالبٍ أو إنشاءِ قاعدة) — يُعيدُ تقريرَ fence.contain_database_reach(). */
    containDatabases,
    async close() {
      for (const c of clients) await c.end().catch(() => {});
      for (const [name, privs] of publicBefore)
        await admin
          .query(`GRANT ${privs.join(', ')} ON DATABASE ${quoteIdent(name)} TO PUBLIC`)
          .catch(() => {});
      await db.drop();
      await dropStrayWorkerRoles(admin);
      await admin.end();
    },
  };
}

/** أدوارُ الإقلاعِ على مستوى العنقود: تُسقَطُ بعدَ كلِّ حزامٍ فلا تُفسِدُ فحصَ غيرِه. @param {pg.Pool} admin */
async function dropStrayWorkerRoles(admin) {
  const roles = await admin
    .query(
      `SELECT r.rolname FROM pg_roles r JOIN pg_auth_members m ON m.member = r.oid
      WHERE m.roleid = 'xuux_worker'::regrole AND r.rolname LIKE 'xw\\_%'`,
    )
    .catch(() => ({ rows: [] }));
  for (const r of roles.rows) {
    await admin.query(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE usename = $1`, [
      r.rolname,
    ]);
    await admin.query(`DROP ROLE IF EXISTS ${quoteIdent(r.rolname)}`).catch(() => {});
  }
}

/** موقِفُ آثارٍ بلا آثار (لا cgroup ولا مخارجَ في الحزام). */
export const NO_EFFECTS = {
  stop: async () => ({ ok: true, detail: { harness: true, scopes: [], egress: [] } }),
};

// ── LIVE-75 (‏WL-604): المُشرِفُ المركّب `FenceSupervisor` — عمليّاتُ عمّالٍ حقيقيّةٌ بـIPC و`XUUX_DB_FENCE=required` ──
// كلُّ عاملٍ عمليّةُ Node ابنةٌ حقيقيّة تسلكُ مسارَ العاملِ (‏`dbFenceMode` ⇒ `workerFenceHandshake` ⇒ `sealFencedPool` ⇒
// `assertFencedSession`) بمفتاحِها في ملفٍّ لا يقرؤه المُشرِف. **حدُّ الحزامِ المعلن:** دورُ الإقلاعِ يدخلُ بكلمةِ مرورٍ
// مشتقّةٍ يمنحُها superuser (‏`loginBroker`) — الإنتاجُ peer/pg_ident بلا سرّ (‏D-SUP-2)، والمختبرُ يختبرُ peer.
export const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url));
const FENCE_MODULE = new URL('../../src/fence/db-fence.mjs', import.meta.url).href;
export const L75_WORKER_SRC = `
import { createHmac } from 'node:crypto';
import pg from 'pg';
import { assertFencedSession, dbFenceMode, fileKeyProvider, newBootId, sealFencedPool, workerFenceHandshake }
  from ${JSON.stringify(FENCE_MODULE)};
const env = process.env;
const mode = env.L75_MODE ?? 'write';
const send = (m) => { if (process.connected) { try { process.send(m); } catch {} } };
process.on('disconnect', () => { if (mode !== 'stubborn') process.exit(70); });
if (dbFenceMode(env) !== 'required') process.exit(64);
if (mode === 'die-before-hello') process.exit(11);
const workerId = env.XUUX_FENCE_WORKER_ID;
const key = fileKeyProvider(env.XUUX_FENCE_WORKER_KEY);
const bootId = newBootId();
const cred = await workerFenceHandshake(key, { workerId, bootId, timeoutMs: 10000 });
if (mode === 'die-after-handshake') process.exit(12);
const role = String(cred.role_name);
const url = new URL(env.L75_DB_URL);
url.username = role;
url.password = createHmac('sha256', env.L75_HARNESS_SECRET).update(role).digest('base64url');
const pool = new pg.Pool({ connectionString: url.toString(), max: 2, idleTimeoutMillis: 0 });
pool.on('error', () => {});
if (mode === 'seal-fail') {
  send({ type: 'xuux-fence/seal-failed', role_name: role, reason: 'injected' });
  await new Promise(() => {});
}
for (let i = 0; ; i++) {
  try { const c = await pool.connect(); c.release(); break; }
  catch (e) { if (i > 100) { send({ type: 'xuux-fence/seal-failed', role_name: role, reason: 'login' }); process.exit(14); }
    await new Promise((r) => setTimeout(r, 30)); }
}
let sessions;
try {
  sessions = await sealFencedPool(pool, 2, key, { db: cred.db, sysid: cred.sysid, workerId, bootId, epoch: cred.epoch, roleName: role });
} catch (e) {
  send({ type: 'xuux-fence/seal-failed', role_name: role, reason: String(e?.message ?? e) });
  process.exit(13);
}
send({ type: 'xuux-fence/sealed', role_name: role, sessions: mode === 'seal-lie' ? sessions.slice(0, 1) : sessions });
if (mode === 'seal-lie') await new Promise(() => {});
await assertFencedSession(pool, { workerId, bootId });
send({ type: 'l75/ready', role, pid: process.pid });
const id = Number(env.L75_ID);
if (mode === 'open-txn') {
  const c = await pool.connect();
  await c.query('BEGIN');
  await c.query("INSERT INTO state.fence_probe (id, v) VALUES ($1, 'open-txn')", [id]);
  send({ type: 'l75/txn-open' });
  await new Promise(() => {});
}
if (mode === 'die-after-ready') setTimeout(() => process.exit(21), 150);
let n = 0;
for (;;) {
  try {
    await pool.query('INSERT INTO state.fence_probe (id, v) VALUES ($1, $2) ON CONFLICT (id) DO UPDATE SET v = excluded.v', [id, String(++n)]);
    send({ type: 'l75/wrote', n });
  } catch (e) {
    send({ type: 'l75/write-refused', code: e?.code ?? null });
    if (mode !== 'stubborn') process.exit(30);
  }
  await new Promise((r) => setTimeout(r, 40));
}
`;

/** @param {() => Promise<boolean> | boolean} fn @param {number} ms @param {string} why */
export async function l75Until(fn, ms, why) {
  const deadline = Date.now() + ms;
  for (;;) {
    if (await fn()) return;
    if (Date.now() > deadline) throw new Error(`انقضت المهلة: ${why}`);
    await new Promise((r) => setTimeout(r, 25));
  }
}

/** سطرُ قياسٍ في مخرجِ TAP (‏دليلٌ لا تأكيد). @param {string} id @param {unknown} data */
export function t_note(id, data) {
  process.stdout.write(`# L75-NOTE ${id} ${JSON.stringify(data)}\n`);
}

/**
 * ‏مختبرُ المُشرِفِ المشترَك (‏`WL-604`، نُقِلَ إلى هنا في `WL-607`): قاعدةٌ معزولةٌ بـ`harness(label)`، ومفاتيحُ
 * العمّالِ في ملفّات، ودورُ جذرٍ بكلمةِ مرور، و`mk()` يبني `FenceSupervisor` بعمّالٍ حقيقيّين. يُنادى داخلَ
 * `describe` فيُسجِّلُ `before`/`after` فيه. نُقِلَ لتعملَ اختباراتُ `WL-607` في ملفٍّ آخرَ دونَ نسخِ الإعداد:
 * مهلةُ الملفِّ في `test:suite` (‏120 ث) لا تتّسعُ للمجموعتينِ معاً في `fence-lifecycle`.
 * @param {string} label
 */
export function supervisorLab(label) {
  /** @type {Awaited<ReturnType<typeof harness>>} */
  let h;
  /** @type {string} */
  let dir;
  /** @type {string} */
  let rootPassword;
  const secret = randomBytes(18).toString('base64url');
  /** @type {Record<string, string>} */
  const keyFiles = {};
  /** @type {Set<import('node:child_process').ChildProcess>} */
  const children = new Set();
  /** @type {FenceSupervisor[]} */
  const supervisors = [];
  /** ‏عمّالُ عمليّةِ CLI (‏أحفادٌ لا أبناء): يُقتَلونَ في `after` إن سقطَ اختبارٌ قبلَ تنظيفِه (‏WL-607). @type {Set<number>} */
  const grandchildren = new Set();

  before(async () => {
    h = await harness(label);
    await h.resume();
    dir = mkdtempSync(join(tmpdir(), 'xuux-l75-'));
    for (const w of /** @type {const} */ (['alpha', 'beta'])) {
      keyFiles[w] = join(dir, `${w}.pem`);
      writeFileSync(keyFiles[w], h.keys[w].privateKeyPem, { mode: 0o600 });
      chmodSync(keyFiles[w], 0o600);
    }
    rootPassword = randomBytes(18).toString('base64url');
    await h.db.pool.query(`ALTER ROLE xf_root PASSWORD '${rootPassword}'`);
  });
  after(async () => {
    for (const s of supervisors) await s.stop().catch(() => {});
    for (const c of children) if (c.exitCode === null && c.signalCode === null) c.kill('SIGKILL');
    for (const pid of grandchildren)
      try {
        process.kill(pid, 'SIGKILL');
      } catch {
        // ‏مات.
      }
    await h?.close();
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  /** @param {string} [base] */
  const rootUrl = (base = databaseUrl() ?? '') => {
    const u = new URL(base);
    u.username = 'xf_root';
    u.password = rootPassword;
    u.pathname = `/${h.db.name}`;
    return u.toString();
  };
  const workerDbUrl = () => {
    const u = new URL(databaseUrl() ?? '');
    u.pathname = `/${h.db.name}`;
    return u.toString();
  };
  /** @param {string} url */
  const connectAt = (url) => async () => {
    const c = new pg.Client({ connectionString: url });
    c.on('error', () => {});
    await c.connect();
    return c;
  };
  /** @param {Record<string, any>} credential */
  const loginBroker = async (credential) => {
    const role = String(credential['role_name']);
    const pw = createHmac('sha256', secret).update(role).digest('base64url');
    await h.db.pool.query(`ALTER ROLE ${quoteIdent(role)} PASSWORD '${pw}' VALID UNTIL 'infinity'`);
  };
  /** @type {Record<string, number>} */
  const probeId = { alpha: 7501, beta: 7502 };

  /**
   * @param {{ modes?: Record<string, string[]>, workers?: string[], url?: string, root?: FenceRoot,
   *           options?: Record<string, any> }} [o]
   */
  const mk = (o = {}) => {
    const url = o.url ?? rootUrl();
    /** @type {Array<Record<string, unknown>>} */
    const events = [];
    /** @type {Array<{ worker: string, attempt: number, env: Record<string, string>, child: import('node:child_process').ChildProcess }>} */
    const spawned = [];
    /** @type {Array<{ worker: string, attempt: number, m: any }>} */
    const messages = [];
    const modes = o.modes ?? {};
    const sup = new FenceSupervisor({
      root:
        o.root ?? new FenceRoot(connectAt(url), { log: (e) => events.push({ src: 'root', ...e }) }),
      lockConnect: connectAt(url),
      workers: (o.workers ?? ['alpha', 'beta']).map((workerId) => ({ workerId })),
      spawnWorker: (spec, ctx) => {
        const list = modes[spec.workerId] ?? ['write'];
        const mode = list[Math.min(ctx.attempt - 1, list.length - 1)];
        const child = spawn(process.execPath, ['--input-type=module', '-e', L75_WORKER_SRC], {
          cwd: REPO_ROOT,
          env: {
            PATH: process.env['PATH'] ?? '',
            ...ctx.env,
            XUUX_FENCE_WORKER_KEY: keyFiles[spec.workerId],
            L75_MODE: mode,
            L75_DB_URL: workerDbUrl(),
            L75_HARNESS_SECRET: secret,
            L75_ID: String(probeId[spec.workerId]),
          },
          stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
        });
        child.stderr?.on('data', () => {});
        child.on('message', (m) =>
          messages.push({ worker: spec.workerId, attempt: ctx.attempt, m }),
        );
        children.add(child);
        spawned.push({ worker: spec.workerId, attempt: ctx.attempt, env: ctx.env, child });
        return child;
      },
      loginBroker,
      handshakeTimeoutMs: 8_000,
      sealTimeoutMs: 8_000,
      leaseIntervalMs: 200,
      monitorIntervalMs: 100,
      lockCheckTimeoutMs: 1_000,
      maxDbFailures: 2,
      killGraceMs: 500,
      restart: { maxRestarts: 3, windowMs: 60_000, backoffMs: 50 },
      reaper: { ceilingMs: 1_000, retryMs: 50, firstTickTimeoutMs: 3_000 },
      ...(o.options ?? {}),
      log: (e) => events.push({ src: 'supervisor', ...e }),
    });
    supervisors.push(sup);
    return { sup, events, spawned, messages };
  };

  /** اعتماداتُ الاختباراتِ السابقةِ (‏تُرى عندَ `clean()`) خارجَ ما يَعُدُّه الاختبارُ الجاري. */
  let seen = new Set();
  /** @returns {Promise<Array<{ role_name: string, worker_id: string, status: string, revoke_reason: string | null }>>} */
  const creds = async () =>
    (
      await h.db.pool.query(
        `SELECT role_name::text AS role_name, worker_id, status, revoke_reason FROM fence.credentials ORDER BY issued_at, role_name`,
      )
    ).rows.filter((/** @type {any} */ c) => !seen.has(c.role_name));
  const active = async () => (await creds()).filter((c) => c.status === 'ACTIVE');
  /** @param {string[]} roles */
  const sessionsOf = async (roles) =>
    Number(
      (
        await h.db.pool.query(
          'SELECT count(*)::int AS n FROM pg_stat_activity WHERE usename = ANY($1::text[])',
          [roles],
        )
      ).rows[0].n,
    );
  const lockHolders = async () =>
    Number(
      (
        await h.db.pool.query(
          `SELECT count(*)::int AS n FROM pg_locks WHERE locktype = 'advisory' AND classid = $1::oid AND objid = $2::oid
               AND objsubid = 2 AND granted AND database = (SELECT oid FROM pg_database WHERE datname = current_database())`,
          [...SUPERVISOR_LOCK_KEY],
        )
      ).rows[0].n,
    );
  /** @param {FenceSupervisor} sup @param {string} id */
  const workerOf = (sup, id) => sup.snapshot().workers.find((w) => w.id === id);
  /** @param {import('node:child_process').ChildProcess} c */
  const dead = (c) => c.exitCode !== null || c.signalCode !== null;
  /** بدايةٌ نظيفة: لا اعتمادَ نشِط، والسياجُ RUNNING، ولا قفل. */
  const clean = async () => {
    // ‏اختبارٌ سابقٌ سقطَ قبلَ `stop()` لا يتركُ مُشرِفَه ممسكاً بالقفلِ للتالي.
    for (const s of supervisors.splice(0)) await s.stop().catch(() => {});
    if ((await h.sovereign.status()).effective.state !== 'RUNNING') await h.resume();
    await h.root.revokeOrphanCredentials();
    await h.db.pool.query('DELETE FROM state.fence_probe WHERE id IN (7501, 7502)');
    await l75Until(async () => (await lockHolders()) === 0, 5_000, 'القفلُ محرَّرٌ قبلَ الاختبار');
    assert.deepEqual(await active(), [], 'لا اعتمادَ نشِطاً قبلَ الاختبار');
    seen = new Set(
      (await h.db.pool.query('SELECT role_name::text AS r FROM fence.credentials')).rows.map(
        (/** @type {any} */ x) => x.r,
      ),
    );
  };

  return {
    get h() {
      return h;
    },
    get dir() {
      return dir;
    },
    secret,
    keyFiles,
    children,
    supervisors,
    grandchildren,
    rootUrl,
    workerDbUrl,
    connectAt,
    probeId,
    mk,
    creds,
    active,
    sessionsOf,
    lockHolders,
    workerOf,
    dead,
    clean,
  };
}
