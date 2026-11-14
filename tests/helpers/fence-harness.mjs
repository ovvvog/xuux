/**
 * حزامُ اختباراتِ سياجِ القاعدة (`WL-532`): قاعدةٌ معزولةٌ مهاجَرة، سياديٌّ وجذرٌ بدوريهما، وعاملان
 * في القائمة. مشتركٌ بينَ `tests/fence/db-fence.test.mjs` و`tests/fence/fence-lifecycle.test.mjs`
 * كي تُختبَرَ دورةُ الحياةِ (الختم، دليلُ الآثار، HALT/RESUME) في ملفٍّ مستقلٍّ بلا تكرارٍ للحزام.
 *
 * حدُّ الحزامِ المعلن: الدخولُ بكلمةِ مرورٍ عشوائيةٍ يمنحُها superuser (لا peer). المختبرُ
 * (`scripts/fence-lab.mjs`) هو ما يختبرُ peer وUIDs حقيقية.
 */

import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import pg from 'pg';

import {
  FenceRoot,
  FenceSovereign,
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
