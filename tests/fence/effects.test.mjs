/**
 * الآثارُ (`WL-532`، §9) — `T-EFF-02` و`T-EFF-03` وجردُ E1..E16 وقتلُ اليتامى (E6).
 *
 * قتلُ اليتامى يتطلّبُ cgroup v2 مفوَّضاً (`XUUX_CGROUP_PARENT`)؛ بدونه يُعلَنُ الاختبارُ
 * `NOT RUN` بسببِه (تخطٍّ صريحٌ لا نجاح) — ويُشغَّلُ في `scripts/fence-lab.mjs`.
 *
 * ‏`WL-608` (‏`§7` مهلةُ الملفّ): نُقلت هنا حرفيّاً كتلةُ WL-541 (‏أثرُ NOTIFY المتبقّي — قناةُ أثرٍ) من
 * `tests/fence/db-fence-privileges.test.mjs`، وأُضيفت كتلةُ `WL-608 LIVE-75` (‏قدرةُ العاملِ الفعليّةُ عبرَ انقضاءِ
 * الإيجار — ما يقدرُ أن يُحدِثَه من أثرٍ في القاعدة). كلتاهما بقاعدةٍ حقيقيّة وتُتخطّيان بلا `DATABASE_URL`.
 */

import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import { randomBytes } from 'node:crypto';
import test, { after, before, describe } from 'node:test';

import pg from 'pg';
import YAML from 'yaml';

import {
  CgroupScope,
  EFFECTS_ERRORS,
  EffectsError,
  FencingReceiver,
  HaltFencedTransport,
  auditWorkerCapabilitiesLive,
  buildEffectsStopper,
  cgroupDelegated,
  fencingToken,
  loadCapabilityPolicy,
} from '../../src/fence/effects.mjs';
import { createEgressGate } from '../../src/egress/egress-gate.mjs';
import { createPolicyDecisionPoint } from '../../src/policy/engine.mjs';
import { EnforcementPoint } from '../../src/policy/enforcement-point.mjs';
import { loadPolicyBundle } from '../../src/policy/loader.mjs';
import { down as migratorDown } from '../../src/persistence/migrator.mjs';
import { databaseUrl, quoteIdent, skipWithoutDatabase } from '../helpers/pg.mjs';
import { startFaultProxy } from '../helpers/pg-fault-proxy.mjs';
import { NO_EFFECTS, harness, rejection, rejectsWith, t_note } from '../helpers/fence-harness.mjs';

/** @param {number} pid */
function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

test('E1..E16: كلُّ أثرٍ مُصنَّفٌ بضابطٍ وحالةٍ ودليل — لا أثرَ غيرُ مصنَّف', () => {
  const doc = YAML.parse(
    readFileSync(new URL('../../config/fence-effects.yaml', import.meta.url), 'utf8'),
  );
  const ids = doc.effects.map((/** @type {{ id: string }} */ e) => e.id);
  assert.deepEqual(
    ids,
    Array.from({ length: 16 }, (_, i) => `E${i + 1}`),
  );
  for (const effect of doc.effects) {
    for (const field of ['name', 'control', 'status', 'evidence']) {
      assert.equal(typeof effect[field], 'string', `${effect.id}.${field}`);
      assert.ok(effect[field].trim().length > 0, `${effect.id}.${field} فارغ`);
    }
    assert.ok(
      ['ENFORCED', 'PARTIAL', 'RESIDUAL'].includes(effect.status),
      `${effect.id}: ${effect.status}`,
    );
  }
  const residual = doc.effects
    .filter((/** @type {{ status: string }} */ e) => e.status === 'RESIDUAL')
    .map((/** @type {{ id: string }} */ e) => e.id);
  assert.deepEqual(residual, ['E3', 'E11', 'E12', 'E13'], 'المتبقّياتُ المعلنةُ لا تتغيّرُ صامتة');
});

const parent = process.env['XUUX_CGROUP_PARENT'] ?? '';
const delegated =
  parent === '' ? { ok: false, reason: 'XUUX_CGROUP_PARENT غيرُ مضبوط' } : cgroupDelegated(parent);

test(
  'E6: cgroup.kill يقتلُ الابنَ والحفيدَ اليتيم (setsid، أبوه مات) ويُثبتُ الخلوّ',
  { skip: delegated.ok ? false : `NOT RUN — ${delegated.reason}` },
  async () => {
    const scope = new CgroupScope(parent, `t${process.pid}${Date.now()}`);
    try {
      // الابنُ يُطلقُ حفيداً في جلسةٍ جديدة ثمّ يموت: الحفيدُ يتيمٌ يتبنّاه init — لكنّه في النطاق.
      const child = scope.spawn(
        '/bin/sh',
        ['-c', 'setsid sh -c "sleep 300" >/dev/null 2>&1 & echo $!; sleep 0.2'],
        {
          stdio: ['ignore', 'pipe', 'ignore'],
        },
      );
      let out = '';
      child.stdout?.on('data', (b) => (out += String(b)));
      await new Promise((resolve) => child.on('exit', resolve));
      const orphan = Number(out.trim());
      assert.ok(Number.isInteger(orphan) && orphan > 0, out);
      await delay(50);
      assert.ok(alive(orphan), 'اليتيمُ حيٌّ بعدَ موتِ أبيه');
      assert.ok(scope.procs().length >= 1, 'واليتيمُ في النطاق');
      const r = await scope.kill();
      assert.equal(r.ok, true, JSON.stringify(r));
      assert.deepEqual(r.procsAfter, []);
      assert.equal(r.populated, false);
      await delay(50);
      assert.equal(alive(orphan), false, 'اليتيمُ مات');
      assert.throws(
        () => scope.spawn('/bin/true', []),
        (e) => e instanceof EffectsError && e.code === EFFECTS_ERRORS.SCOPE_CLOSED,
      );
    } finally {
      if (existsSync(scope.path)) scope.remove();
    }
  },
);

test('E6: بلا cgroup مفوَّض يرفضُ CgroupScope الإنشاءَ صراحةً (لا نطاقَ وهميّ)', () => {
  assert.throws(
    () => new CgroupScope('/nonexistent/cgroup', 'x'),
    (e) => e instanceof EffectsError && e.code === EFFECTS_ERRORS.CGROUP_UNAVAILABLE,
  );
});

/** بوّابةُ الخروجِ الحقيقيّة (`createEgressGate`) بناقلٍ مُسيَّج. */
function realGate(/** @type {HaltFencedTransport} */ fenced) {
  /** @type {Array<{ type: string }>} */
  const events = [];
  const log = { append: (/** @type {string} */ type) => void events.push({ type }) };
  const point = new EnforcementPoint({
    decisionPoint: createPolicyDecisionPoint({ bundle: loadPolicyBundle() }),
    log,
    requireIdentityGate: false,
  });
  const gate = createEgressGate({
    enforcementPoint: point,
    log,
    destinations: [
      {
        id: 'federation:audit-mirror',
        uri: 'https://audit-mirror.federation.example/ingest',
        purpose: 'مرآة تدقيق',
      },
    ],
    quarantine: null,
    classifier: null,
    callsPerWindow: 30,
    maxPayloadBytes: 1024,
    transport: fenced.transport,
  });
  return { gate, events };
}

const actor = {
  id: 'agent:minister-1',
  role: 'role:minister',
  kind: /** @type {const} */ ('human'),
  state: 'active',
  scope: 'org:interior',
};
const request = (/** @type {string} */ payload) => ({
  actor,
  destination: 'federation:audit-mirror',
  payload,
  classification: 'internal',
  resourceId: `audit:${payload}`,
});

test('T-EFF-02: الخروجُ عبرَ EgressGate القائمة — الإيقافُ يُجهِضُ الجاريَ ويرفضُ الجديد، والحارسُ يُقرأ قبلَ كلِّ نقل', async () => {
  let halted = false;
  const guard = {
    assertOperational() {
      if (halted) throw Object.assign(new Error('SOVEREIGN_HALT'), { code: 'SOVEREIGN_HALT' });
    },
  };
  /** @type {string[]} */
  const delivered = [];
  const fenced = new HaltFencedTransport(guard, async (record) => {
    const signal = /** @type {AbortSignal} */ (record.signal);
    if (String(record.payload) === 'slow') {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, 5_000);
        signal.addEventListener('abort', () => {
          clearTimeout(timer);
          reject(signal.reason);
        });
      });
    }
    delivered.push(String(record.payload));
    return { status: 202 };
  });
  const { gate } = realGate(fenced);
  await gate.send(request('one'));
  assert.deepEqual(delivered, ['one']);
  const slow = gate.send(request('slow'));
  await delay(30);
  assert.equal(fenced.inflight.size, 1, 'نقلٌ جارٍ');
  const stopper = buildEffectsStopper({ egress: [fenced] });
  const stopped = await stopper.stop();
  assert.equal(stopped.ok, true, JSON.stringify(stopped));
  await assert.rejects(slow, 'الجاري أُجهِض');
  assert.deepEqual(delivered, ['one'], 'لم يُسلَّم الجاري');
  await assert.rejects(() => gate.send(request('after')), 'الجديدُ مرفوض');
  assert.deepEqual(delivered, ['one']);
  // الحارسُ وحده (بلا close) يمنعُ أيضاً: ناقلٌ ثانٍ لم يُغلَق.
  halted = true;
  const fenced2 = new HaltFencedTransport(guard, async () => {
    delivered.push('leak');
    return { status: 202 };
  });
  await assert.rejects(() => realGate(fenced2).gate.send(request('guarded')));
  assert.ok(!delivered.includes('leak'));
  assert.ok(fenced2.refused >= 1);
});

test('T-EFF-03: المستقبِلُ يرفضُ العهدَ القديمَ والتكرارَ وغيرَ RUNNING (رمزُ السياج)', async () => {
  let fence = { state: 'RUNNING', epoch: 4 };
  const rx = new FencingReceiver(() => fence);
  const t4 = fencingToken({
    epoch: 4,
    workerId: 'alpha',
    bootId: 'b1',
    idempotencyKey: 'msg-0001',
  });
  assert.equal(await rx.accept(t4, 'hello'), true);
  await assert.rejects(
    () => rx.accept(t4, 'hello'),
    (e) => e instanceof EffectsError && e.code === EFFECTS_ERRORS.REPLAY,
  );
  fence = { state: 'HALTED', epoch: 5 };
  const t4b = fencingToken({
    epoch: 4,
    workerId: 'alpha',
    bootId: 'b1',
    idempotencyKey: 'msg-0002',
  });
  await assert.rejects(
    () => rx.accept(t4b, 'late'),
    (e) => e instanceof EffectsError && e.code === EFFECTS_ERRORS.NOT_RUNNING,
  );
  fence = { state: 'RUNNING', epoch: 6 };
  await assert.rejects(
    () => rx.accept(t4b, 'stale'),
    (e) => e instanceof EffectsError && e.code === EFFECTS_ERRORS.STALE_EPOCH,
  );
  const t6 = fencingToken({
    epoch: 6,
    workerId: 'alpha',
    bootId: 'b2',
    idempotencyKey: 'msg-0003',
  });
  assert.equal(await rx.accept(t6, 'fresh'), true);
  assert.equal(rx.accepted.length, 2);
  assert.throws(
    () => fencingToken({ epoch: 0, workerId: 'a', bootId: 'b', idempotencyKey: 'msg-0004' }),
    TypeError,
  );
  assert.throws(
    () => fencingToken({ epoch: 1, workerId: 'a', bootId: 'b', idempotencyKey: 'short' }),
    TypeError,
  );
});

test('الخطوة 11: موقِفُ آثارٍ بلا أيِّ ضابطٍ ليس نجاحاً', async () => {
  const r = await buildEffectsStopper({}).stop();
  assert.equal(r.ok, false);
});

describe('WL-541: الأثرُ المتبقّي لـNOTIFY', { skip: skipWithoutDatabase }, () => {
  /** @type {Awaited<ReturnType<typeof harness>>} */
  let h;
  /** @type {Record<string, any>} */
  let policy;
  const audit = async () => auditWorkerCapabilitiesLive(/** @type {any} */ (h.rootClient), policy);
  const checkFenced = async () =>
    /** @type {{ ok: boolean, problems: Array<{ kind: string }>, residuals: Array<any> }} */ (
      (await h.rootClient.query('SELECT fence.check_fenced() AS r')).rows[0].r
    );
  const surface = async () =>
    /** @type {Record<string, any>} */ (
      (await h.rootClient.query('SELECT fence.notify_surface() AS s')).rows[0].s
    );
  const notifyProblems = async () =>
    (await checkFenced()).problems.filter((p) =>
      ['worker_notify_function', 'notify_listener_public'].includes(p.kind),
    );
  /**
   * مستمعٌ فعليّ: LISTEN على قناة، ويجمعُ ما يصلُه.
   * @param {pg.Client} c
   * @param {string} channel
   */
  const listen = async (c, channel) => {
    /** @type {string[]} */
    const got = [];
    c.on('notification', (m) => {
      if (m.channel === channel) got.push(String(m.payload));
    });
    await c.query(`LISTEN ${channel}`);
    return got;
  };
  /** الإشعارُ يُسلَّمُ للمستمعِ الخامل: جولةٌ على وصلتِه ومهلةٌ قصيرة. @param {pg.Client[]} cs */
  const settle = async (...cs) => {
    await new Promise((r) => setTimeout(r, 150));
    for (const c of cs) await c.query('SELECT 1').catch(() => {});
    await new Promise((r) => setTimeout(r, 50));
  };
  /** وصلةُ superuser إلى قاعدةٍ أخرى في العنقود. @param {string} database */
  const superuserTo = async (database) => {
    const u = new URL(process.env['DATABASE_URL'] ?? '');
    u.pathname = `/${database}`;
    const c = new pg.Client({ connectionString: u.toString() });
    c.on('error', () => {});
    await c.connect();
    return c;
  };
  const dropRoles = async (/** @type {string[]} */ roles) => {
    for (const r of roles) {
      await h.db.pool.query(
        `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE usename = $1`,
        [r],
      );
      await h.db.pool
        .query(`REVOKE ALL ON DATABASE ${quoteIdent(h.db.name)} FROM ${quoteIdent(r)}`)
        .catch(() => {});
      await h.db.pool.query(`DROP ROLE IF EXISTS ${quoteIdent(r)}`);
    }
  };
  before(async () => {
    policy = await loadCapabilityPolicy();
    h = await harness('wl541');
    await h.resume();
  });
  after(async () => h?.close());

  test('القدرة: العاملُ يُرسلُ بأمرِ NOTIFY ويصلُ مستمعاً متّصلاً في القاعدةِ نفسِها فقط؛ ROLLBACK لا يُرسِل، والمستمعُ اللاحقُ لا يرى، وpg_notify مسحوبةٌ (‏42501)', async () => {
    const w = await h.boot('alpha');
    const c = /** @type {pg.Client} */ (w.client);
    const aud = await h.login('xf_auditor');
    const got = await listen(aud, 'wl541');
    // مستمعٌ في قاعدةٍ أخرى (‏superuser، فلا قيدَ صلاحية): NOTIFY محلّيٌّ للقاعدة.
    const other = await superuserTo('postgres');
    const elsewhere = await listen(other, 'wl541');
    try {
      await c.query(`NOTIFY wl541, 'stmt'`);
      await c.query('BEGIN');
      await c.query(`NOTIFY wl541, 'rolled-back'`);
      await c.query('ROLLBACK');
      await rejectsWith(
        () => c.query(`SELECT pg_notify('wl541', 'fn')`),
        ['42501'],
        'pg_notify للعامل (‏سُحِبَت من PUBLIC — WL-541)',
      );
      // الأمرُ نفسُه داخلَ PL/pgSQL (‏EXECUTE) لا يمرُّ بامتياز: يبقى متبقّياً مُعلَناً.
      await c.query(`DO $$BEGIN EXECUTE 'NOTIFY wl541, ''dynamic'''; END$$`);
      await settle(aud, other);
      assert.deepEqual(got, ['stmt', 'dynamic'], 'المستمعُ المتّصلُ يستقبلُ الأمرَ وحدَه');
      assert.deepEqual(elsewhere, [], 'لا عبورَ بينَ القواعد');
      // حدودُ PG: القناةُ ≤ 63 بايتاً (‏NAMEDATALEN-1، والمعرّفُ الأطولُ يُقتطَع)، والحمولةُ < 8000 بايت؛ لا قيدَ على المحتوى.
      await rejectsWith(
        () => c.query(`NOTIFY wl541, '${'a'.repeat(8000)}'`),
        ['22023'],
        'حمولةٌ أطولُ من الحدّ',
      );
      await c.query(`NOTIFY wl541, '${'a'.repeat(7999)}'`);
      const late = await h.login('xf_auditor');
      const lateGot = await listen(late, 'wl541');
      await settle(aud, late);
      assert.equal(got.at(-1)?.length, 7999);
      assert.deepEqual(lateGot, [], 'ما سبقَ LISTEN لا يُخزَّنُ لمستمعٍ لاحق');
      await late.end();
    } finally {
      await other.end().catch(() => {});
      await aud.end().catch(() => {});
      await h.root.revokeCredential(w.credential.role_name, 'wl541');
    }
  });

  test('مَن يستطيعُ LISTEN: الدخولُ وحدَه شرطُه — منحٌ مباشرٌ أو عضويّةٌ موروثة (‏INHERIT) أو superuser؛ لا NOINHERIT ولا دورٌ بلا منح، وPUBLIC مسحوبٌ من القاعدةِ المسيَّجة', async () => {
    const roles = ['wl541_member', 'wl541_noinh', 'wl541_none'];
    await dropRoles(roles);
    await h.db.pool.query('CREATE ROLE wl541_member LOGIN');
    await h.db.pool.query('CREATE ROLE wl541_noinh LOGIN NOINHERIT');
    await h.db.pool.query('CREATE ROLE wl541_none LOGIN');
    await h.db.pool.query('GRANT xf_auditor TO wl541_member, wl541_noinh');
    const a = await h.boot('alpha');
    const b = await h.boot('beta');
    try {
      const member = await h.login('wl541_member');
      const memberGot = await listen(member, 'wl541b');
      const peer = await listen(/** @type {pg.Client} */ (b.client), 'wl541b');
      const su = await superuserTo(h.db.name);
      const suGot = await listen(su, 'wl541b');
      for (const r of ['wl541_noinh', 'wl541_none'])
        await rejectsWith(() => h.login(r), ['42501'], `${r}: لا CONNECT ⇒ لا LISTEN`);
      await /** @type {pg.Client} */ (a.client).query(`NOTIFY wl541b, 'to-all'`);
      await settle(member, /** @type {pg.Client} */ (b.client), su);
      assert.deepEqual(memberGot, ['to-all'], 'عضوٌ يرثُ xf_auditor يستقبل');
      assert.deepEqual(peer, ['to-all'], 'عاملٌ آخرُ يستقبل (‏قناةٌ بينَ العمّال)');
      assert.deepEqual(suGot, ['to-all'], 'superuser يستقبل');
      await su.end();
      await member.end();
      // السطحُ كما تراه القاعدة: مَن يستطيعُ الدخولَ (‏= LISTEN) ومن أين، دونَ ادّعاءِ مَن يستمعُ فعلاً.
      const s = await surface();
      assert.equal(s.connect_via_public, false);
      assert.equal(s.pg_notify_worker_execute, false);
      assert.equal(s.active_listeners_observable, false, 'PG لا يكشفُ قنواتِ جلساتٍ أخرى');
      const by = new Map(s.listeners.map((/** @type {any} */ l) => [l.role, l]));
      assert.deepEqual(by.get('wl541_member')?.via, ['xf_auditor']);
      assert.ok(by.get(h.superuser)?.superuser, 'superuser مُدرَج');
      // الهويّةُ المختومةُ NOLOGIN، لكنّ جلستَها الحيّةَ مستمعٌ محتمَل — تُدرَجُ بجلساتِها لا بقدرتِها على الدخول.
      for (const id of [a.credential.role_name, b.credential.role_name]) {
        assert.deepEqual(by.get(id)?.via, ['xuux_worker'], id);
        assert.ok(by.get(id)?.live_sessions >= 1, id);
      }
      for (const r of ['wl541_noinh', 'wl541_none']) assert.ok(!by.has(r), r);
      assert.deepEqual(
        s.grantees.filter((/** @type {any} */ g) => !g.classified),
        [],
        'كلُّ منحِ CONNECT على القاعدةِ مصنّف',
      );
      assert.deepEqual(await notifyProblems(), []);
    } finally {
      await h.root.revokeCredential(a.credential.role_name, 'wl541');
      await h.root.revokeCredential(b.credential.role_name, 'wl541');
      await h.db.pool.query('REVOKE xf_auditor FROM wl541_member, wl541_noinh');
      await dropRoles(roles);
    }
  });

  test('دورةُ الحياة: الختمُ لا يقطعُ NOTIFY، وانقضاءُ الإيجارِ لا يمنعُه (‏الكتابةُ XF009)، وما التزمَ قبلَ الإلغاءِ يصلُ مستمعاً متّصلاً بعدَه، والإيقافُ يُنهي الجلسة، والاستئنافُ لا يُعيدُ القديمة', async () => {
    const w = await h.boot('alpha');
    const c = /** @type {pg.Client} */ (w.client);
    assert.ok(w.sealed && w.sealed.length > 0, 'الجلسةُ مختومة');
    const aud = await h.login('xf_auditor');
    const got = await listen(aud, 'wl541c');
    try {
      await c.query(`NOTIFY wl541c, 'sealed'`);
      await h.db.pool.query(
        `UPDATE fence.run_lease SET expires_at = clock_timestamp() - interval '1 second' WHERE role_name = $1`,
        [w.credential.role_name],
      );
      await rejectsWith(
        () => c.query(`INSERT INTO state.fence_probe VALUES (541, 'late')`),
        ['XF009'],
        'كتابةٌ بإيجارٍ منقضٍ',
      );
      await c.query(`NOTIFY wl541c, 'after-lease'`);
      await settle(aud);
      assert.deepEqual(got, ['sealed', 'after-lease'], 'NOTIFY بعدَ الختمِ وبعدَ انقضاءِ الإيجار');
      // المستمعُ داخلَ معاملة: الإشعارُ ينتظرُه في الطابور. المُرسِلُ يُلغى (‏الجلسةُ تُنهى) ثمّ يصل.
      await aud.query('BEGIN');
      await c.query(`NOTIFY wl541c, 'before-revoke'`);
      const n = await h.root.revokeCredential(w.credential.role_name, 'wl541-lifecycle');
      assert.equal(n, 1, 'جلسةُ العاملِ أُنهيت');
      await rejection(() => c.query(`NOTIFY wl541c, 'after-revoke'`));
      await aud.query('COMMIT');
      await settle(aud);
      assert.deepEqual(
        got.slice(2),
        ['before-revoke'],
        'أثرٌ عابرٌ يتجاوزُ الإلغاءَ لمستمعٍ كان متّصلاً',
      );
      const late = await h.login('xf_auditor');
      const lateGot = await listen(late, 'wl541c');
      await settle(late);
      assert.deepEqual(lateGot, [], 'ولا يبقى لمستمعٍ لاحق');
      await late.end();
      // الإيقافُ: كلُّ جلسةِ عاملٍ تُنهى، والمتبقّي مُعلَنٌ بسطحِه في check_fenced.
      const w2 = await h.boot('beta');
      const c2 = /** @type {pg.Client} */ (w2.client);
      await c2.query(`NOTIFY wl541c, 'before-halt'`);
      const hr = /** @type {any} */ (await h.root.halt('wl541-halt', { effects: NO_EFFECTS }));
      assert.equal(hr.dbFenced, true, JSON.stringify(hr.check?.problems));
      await rejection(() => c2.query(`NOTIFY wl541c, 'after-halt'`));
      await settle(aud);
      assert.deepEqual(got.slice(3), ['before-halt']);
      const res = (await checkFenced()).residuals.find(
        (/** @type {any} */ r) => r.kind === 'notify_not_revocable',
      );
      assert.ok(res?.surface?.listeners?.length > 0, JSON.stringify(res));
      assert.equal(res.surface.pg_notify_worker_execute, false);
      await h.resume();
      for (const role of [w.credential.role_name, w2.credential.role_name])
        await rejection(() => h.login(role));
      // الاستئنافُ: إقلاعٌ جديدٌ يعملُ (‏مسارٌ مشروعٌ لم يُكسَر).
      const w3 = await h.boot('alpha');
      await /** @type {pg.Client} */ (w3.client).query(
        `INSERT INTO state.fence_probe VALUES (541, 'ok')`,
      );
      await /** @type {pg.Client} */ (w3.client).query(
        `DELETE FROM state.fence_probe WHERE id = 541`,
      );
      await h.root.revokeCredential(w3.credential.role_name, 'wl541');
    } finally {
      await aud.end().catch(() => {});
    }
  });

  test('الطفرات: إعادةُ pg_notify (‏PUBLIC، مباشر، موروث) أو CONNECT لـPUBLIC على القاعدةِ المسيَّجة ⇒ مكشوفةٌ وتمنعُ اكتمالَ الإيقافِ وRESUME', async () => {
    const mutations = [
      {
        name: 'pg_notify لـPUBLIC',
        apply: ['GRANT EXECUTE ON FUNCTION pg_catalog.pg_notify(text, text) TO PUBLIC'],
        revert: ['REVOKE EXECUTE ON FUNCTION pg_catalog.pg_notify(text, text) FROM PUBLIC'],
        kind: 'worker_notify_function',
        unclassified: 'pg_notify',
      },
      {
        name: 'pg_notify لـxuux_worker مباشرةً',
        apply: ['GRANT EXECUTE ON FUNCTION pg_catalog.pg_notify(text, text) TO xuux_worker'],
        revert: ['REVOKE EXECUTE ON FUNCTION pg_catalog.pg_notify(text, text) FROM xuux_worker'],
        kind: 'worker_notify_function',
        unclassified: 'pg_notify',
      },
      {
        name: 'pg_notify موروثةٌ عبرَ دورٍ وسيط',
        apply: [
          'CREATE ROLE wl541_fn NOLOGIN',
          'GRANT EXECUTE ON FUNCTION pg_catalog.pg_notify(text, text) TO wl541_fn',
          'GRANT wl541_fn TO xuux_worker',
        ],
        revert: [
          'REVOKE wl541_fn FROM xuux_worker',
          'REVOKE EXECUTE ON FUNCTION pg_catalog.pg_notify(text, text) FROM wl541_fn',
          'DROP ROLE wl541_fn',
        ],
        kind: 'worker_notify_function',
        unclassified: 'pg_notify',
      },
      {
        name: 'CONNECT لـPUBLIC على القاعدةِ المسيَّجة (‏كلُّ دورِ دخولٍ في العنقودِ مستمعٌ محتمل)',
        apply: ['GRANT CONNECT ON DATABASE {db} TO PUBLIC'],
        revert: ['REVOKE CONNECT ON DATABASE {db} FROM PUBLIC'],
        kind: 'notify_listener_public',
        unclassified: null,
      },
    ];
    const sql = (/** @type {string} */ s) => s.replaceAll('{db}', quoteIdent(h.db.name));
    // الإيقافُ أوّلاً: GRANT على دالّةٍ يمرُّ بمُطلِقِ الأحداث (‏XF201 تحتَ RUNNING).
    await h.root.halt('wl541-mutations', { effects: NO_EFFECTS });
    for (const m of mutations) {
      for (const s of m.apply) await h.db.pool.query(sql(s));
      try {
        const kinds = (await notifyProblems()).map((p) => p.kind);
        assert.deepEqual(kinds, [m.kind], `${m.name}: ${JSON.stringify(kinds)}`);
        if (m.unclassified !== null) {
          const r = await audit();
          assert.ok(
            !r.ok &&
              r.unclassified.some(
                (x) => x.axis === 'function' && x.detail?.name === m.unclassified,
              ),
            `${m.name}: المدقّقُ لا يصنّفُ pg_notify — ${JSON.stringify(r.unclassified)}`,
          );
        }
        const hr = /** @type {any} */ (
          await h.root.halt(`wl541-${m.kind}`, { effects: NO_EFFECTS })
        );
        assert.equal(hr.dbFenced, false, m.name);
        assert.equal(hr.reason, 'DB_NOT_FENCED', m.name);
        assert.equal((await h.sovereign.status()).effective.state, 'HALT_REQUESTED');
        await rejectsWith(() => h.resume(), ['XF415', 'XF507'], `RESUME فوقَ ${m.name}`);
        assert.notEqual((await h.sovereign.status()).effective.state, 'RUNNING');
      } finally {
        for (const s of m.revert) await h.db.pool.query(sql(s));
      }
      assert.deepEqual(await notifyProblems(), [], `${m.name}: الإرجاعُ يُزيلُ المشكلة`);
    }
    // بعدَ الإرجاع: إيقافٌ نظيفٌ يكتملُ ثمّ RESUME (‏الإيقافُ الفاشلُ يُبقي HALT_REQUESTED).
    const reverted = /** @type {any} */ (
      await h.root.halt('wl541-reverted', { effects: NO_EFFECTS })
    );
    assert.equal(reverted.dbFenced, true, JSON.stringify(reverted.check?.problems));
    // هجومُ PUBLIC مُعادٌ إنتاجُه فعلاً: دورٌ بلا أيِّ منحٍ يدخلُ ويستقبلُ إشعارَ العامل.
    await h.resume();
    await h.db.pool.query('DROP ROLE IF EXISTS wl541_stranger');
    await h.db.pool.query('CREATE ROLE wl541_stranger LOGIN');
    const w = await h.boot('alpha');
    try {
      await rejectsWith(() => h.login('wl541_stranger'), ['42501'], 'قبلَ الطفرة');
      await h.db.pool.query(sql('GRANT CONNECT ON DATABASE {db} TO PUBLIC'));
      const s = await h.login('wl541_stranger');
      const got = await listen(s, 'wl541d');
      await /** @type {pg.Client} */ (w.client).query(`NOTIFY wl541d, 'leak'`);
      await settle(s);
      assert.deepEqual(got, ['leak'], 'PUBLIC يجعلُ أيَّ دورِ دخولٍ مستقبِلاً');
      assert.equal((await surface()).connect_via_public, true);
      await s.end();
    } finally {
      await h.db.pool.query(sql('REVOKE CONNECT ON DATABASE {db} FROM PUBLIC'));
      await h.root.revokeCredential(w.credential.role_name, 'wl541');
      await dropRoles(['wl541_stranger']);
    }
    const done = /** @type {any} */ (await h.root.halt('wl541-clean', { effects: NO_EFFECTS }));
    assert.equal(done.dbFenced, true, JSON.stringify(done.check?.problems));
    await h.resume();
    assert.equal((await h.sovereign.status()).effective.state, 'RUNNING');
  });

  test('لا كسرَ ولا إخفاء: superuser يملكُ pg_notify، ومنحٌ صريحٌ لدورٍ تشغيليٍّ يظهرُ في السطحِ غيرَ مصنّفٍ دونَ أن يمنعَ (‏قرارُ مالك)، والجذرُ والسياديُّ والإقلاعُ تعمل', async () => {
    const su = await superuserTo(h.db.name);
    try {
      await su.query(`SELECT pg_notify('wl541e', 'superuser')`);
    } finally {
      await su.end();
    }
    await dropRoles(['wl541_ops']);
    await h.db.pool.query('CREATE ROLE wl541_ops LOGIN');
    await h.db.pool.query(`GRANT CONNECT ON DATABASE ${quoteIdent(h.db.name)} TO wl541_ops`);
    try {
      const s = await surface();
      assert.deepEqual(
        s.grantees
          .filter((/** @type {any} */ g) => !g.classified)
          .map((/** @type {any} */ g) => g.grantee),
        ['wl541_ops'],
        'المنحُ الصريحُ ظاهرٌ لا مُخفى',
      );
      assert.deepEqual(s.listeners.find((/** @type {any} */ l) => l.role === 'wl541_ops')?.via, [
        'wl541_ops',
      ]);
      assert.deepEqual(await notifyProblems(), [], 'ليس انحرافاً في السياج (‏حدٌّ مُعلَن)');
      const cf = await checkFenced();
      const res = cf.residuals.find((r) => r.kind === 'notify_not_revocable');
      assert.deepEqual(res?.surface?.unclassified_grantees, ['wl541_ops']);
    } finally {
      await dropRoles(['wl541_ops']);
    }
    await h.reconnect();
    const w = await h.boot('beta');
    await /** @type {pg.Client} */ (w.client).query('SELECT 1');
    await h.root.revokeCredential(w.credential.role_name, 'wl541');
    assert.equal((await h.sovereign.status()).effective.state, 'RUNNING');
  });
  // ── WL-542: انقضاءُ الإيجارِ نهائيٌّ، والحاصدُ يُنهي الجلسةَ المنقضيةَ بلا جذر ──────────────────────
  // قبلَ الإصلاح (‏مقيسٌ على 545571c4، PG 18.6): renew_lease يُحيي الإيجارَ المنقضي فتعودُ الجلسةُ نفسُها
  // تكتب؛ والسياديُّ يتلقّى 42501 على الإلغاءِ والقفلِ وإنهاءِ الجلسات — فجلسةُ إيجارٍ منقضٍ تبقى حيّةً
  // تُرسِلُ NOTIFY بلا حدٍّ ما غابَ الجذر. الاختباراتُ أدناه تفشلُ على الشيفرةِ السابقة (‏reap_lapsed غائبةٌ).
  const lapse = async (/** @type {string} */ role, how = 'expired') => {
    const sql = {
      expired: `UPDATE fence.run_lease SET expires_at = clock_timestamp() - interval '1 second' WHERE role_name = $1`,
      clock_regressed: `UPDATE fence.run_lease SET renewed_at = clock_timestamp() + interval '1 hour' WHERE role_name = $1`,
      no_lease: `DELETE FROM fence.run_lease WHERE role_name = $1`,
    }[how];
    await h.db.pool.query(String(sql), [role]);
  };
  const credential = async (/** @type {string} */ role) =>
    (
      await h.db.pool.query(
        'SELECT status, revoke_reason FROM fence.credentials WHERE role_name = $1',
        [role],
      )
    ).rows[0];
  const liveSessions = async (/** @type {string} */ role) =>
    Number(
      (
        await h.db.pool.query(
          'SELECT count(*)::int AS n FROM pg_stat_activity WHERE usename = $1',
          [role],
        )
      ).rows[0].n,
    );

  test('WL-542 العيب: الانقضاءُ نهائيّ — التجديدُ لا يُحيي (‏XF009) والجلسةُ لا تعودُ تكتب؛ والسياديُّ لا يملكُ الإلغاءَ ولا الإنهاءَ مباشرةً (‏42501)', async () => {
    // كلُّ مصافحةٍ تحصدُ المنقضيَ أوّلاً (‏issue_credential)، فيُقلَعُ الاثنانِ قبلَ أيِّ انقضاء.
    const w2 = await h.boot('beta', { seal: false });
    const w = await h.boot('alpha');
    const c = /** @type {pg.Client} */ (w.client);
    const role = String(w.credential.role_name);
    try {
      // الساعةُ المُرجَعةُ تبقى XF012 (‏WL-536) — لا يُخفيها رفضُ الانقضاء.
      await lapse(String(w2.credential.role_name), 'clock_regressed');
      await rejectsWith(
        () => h.root.renewLease(String(w2.credential.role_name)),
        ['XF012'],
        'ساعةٌ مُرجَعة',
      );
      await c.query(`INSERT INTO state.fence_probe VALUES (542, 'live')`);
      await lapse(role);
      await rejectsWith(
        () => c.query(`UPDATE state.fence_probe SET v = 'x' WHERE id = 542`),
        ['XF009'],
        'منقضٍ',
      );
      await rejectsWith(() => h.root.renewLease(role), ['XF009'], 'لا إحياء');
      await rejectsWith(
        () => c.query(`UPDATE state.fence_probe SET v = 'revived' WHERE id = 542`),
        ['XF009'],
        'الجلسةُ نفسُها لا تعودُ تكتب',
      );
      // السياديُّ بلا جذر: الإلغاءُ والإنهاءُ المباشرُ مرفوضان — لذلك الحاصد.
      const pid = Number((await c.query('SELECT pg_backend_pid() AS p')).rows[0].p);
      await rejectsWith(
        () => h.sovClient.query('SELECT fence.revoke_credential($1, $2)', [role, 'sov']),
        ['42501'],
        'السياديُّ لا يُلغي',
      );
      await rejectsWith(
        () => h.sovClient.query('SELECT pg_terminate_backend($1)', [pid]),
        ['42501'],
        'السياديُّ لا يُنهي جلسةً مباشرة',
      );
      assert.equal(await liveSessions(role), 1, 'الجلسةُ المنقضيةُ حيّةٌ قبلَ الحصاد');
      // غيرُ الجذرِ والسياديّ: لا حصاد.
      await rejectsWith(
        () => h.login('xf_auditor').then((a) => a.query('SELECT fence.reap_lapsed()')),
        ['42501', 'XF501'],
        'المدقّقُ لا يحصد',
      );
      await rejectsWith(() => c.query('SELECT fence.reap_lapsed()'), ['42501'], 'العاملُ لا يحصد');
    } finally {
      await h.db.pool.query('DELETE FROM state.fence_probe WHERE id = 542');
      await h.root.reapLapsed();
    }
  });

  test('WL-542 الحاصد: السياديُّ وحدَه يُنهي جلسةَ الإيجارِ المنقضي (‏expired/no_lease/clock_regressed) بمرسِلٍ ومستمعٍ فعليّين؛ الصالحُ لا يُمَسّ، ولا دخولَ بعدَه، والمتبقّي معلن', async () => {
    const aud = await h.login('xf_auditor');
    const got = await listen(aud, 'wl542r');
    const a = await h.boot('alpha');
    const b = await h.boot('beta');
    const ca = /** @type {pg.Client} */ (a.client);
    const cb = /** @type {pg.Client} */ (b.client);
    const ra = String(a.credential.role_name);
    const rb = String(b.credential.role_name);
    try {
      await ca.query(`NOTIFY wl542r, 'running'`);
      await lapse(ra);
      // النافذةُ المتبقّية (‏مُعلَنة): بينَ الانقضاءِ والحصادِ ما زالت الجلسةُ تُرسِل.
      await ca.query(`NOTIFY wl542r, 'lapsed-before-reap'`);
      await aud.query('BEGIN');
      await ca.query(`NOTIFY wl542r, 'committed-before-reap'`);
      const r = await h.sovereign.reapLapsed();
      assert.equal(r.ok, true, JSON.stringify(r));
      assert.deepEqual(r.unresolved, []);
      assert.deepEqual(
        r.reaped.map((x) => [x['role'], x['reason'], x['terminated'], x['alive_after']]),
        [[ra, 'expired', 1, 0]],
        'المنقضي وحدَه، أُنهِيَت جلستُه ولم يبقَ منها شيء',
      );
      await rejection(() => ca.query(`NOTIFY wl542r, 'after-reap'`));
      await aud.query('COMMIT');
      await settle(aud);
      assert.deepEqual(
        got,
        ['running', 'lapsed-before-reap', 'committed-before-reap'],
        'ما التزمَ قبلَ الحصادِ يصلُ مستمعاً متّصلاً (‏حدٌّ معلن)، ولا شيءَ بعدَه',
      );
      assert.deepEqual(await credential(ra), {
        status: 'REVOKED',
        revoke_reason: 'LEASE_LAPSED:expired',
      });
      await rejection(() => h.login(ra));
      assert.equal(await liveSessions(ra), 0);
      // الصالحُ لا يُمَسّ: beta يكتبُ ويُرسِلُ ويُجدَّدُ إيجارُه.
      await cb.query(`INSERT INTO state.fence_probe VALUES (5421, 'beta')`);
      await cb.query(`DELETE FROM state.fence_probe WHERE id = 5421`);
      await h.root.renewLease(rb);
      assert.equal((await credential(rb)).status, 'ACTIVE');
      // الحصادُ ثانيةً لا يفعلُ شيئاً (‏لا يُخفي ولا يختلق).
      // ‏(WL-545: next_due_ms مفتاحٌ إضافيّ — موعدُ rb المُجدَّدِ للتوّ، بينَ 0 والنافذة؛ والباقي كما كان.)
      // ‏(WL-552: lingering مفتاحٌ إضافيّ — لا جلسةَ لاعتمادٍ ملغى باقية ⇒ فارغ.)
      const { next_due_ms: due, lingering, ...again } = await h.sovereign.reapLapsed();
      assert.deepEqual(again, { ok: true, reaped: [], unresolved: [] });
      assert.deepEqual(lingering, []);
      const win = (await h.db.pool.query('SELECT lease_window_s FROM fence.control')).rows[0];
      assert.ok(
        Number.isInteger(due) && Number(due) > 0 && Number(due) <= win.lease_window_s * 1000,
        String(due),
      );
      const ev = await h.db.pool.query(
        `SELECT detail FROM fence.events WHERE kind = 'LEASE_LAPSED_REAPED' ORDER BY seq DESC LIMIT 1`,
      );
      assert.equal(ev.rows[0].detail.reaped[0].role, ra, 'حدثٌ مسجَّلٌ في السلسلة');
      // no_lease وclock_regressed: كلاهما انقضاء (‏الحارسُ يرفضُ بهما الكتابة) فيُحصَدان.
      await lapse(rb, 'no_lease');
      const a2 = await h.boot('alpha', { seal: false });
      const ra2 = String(a2.credential.role_name);
      assert.equal(
        (await credential(rb)).revoke_reason,
        'LEASE_LAPSED:no_lease',
        'issue_credential يحصدُ أوّلاً',
      );
      await rejection(() => cb.query('SELECT 1'));
      await lapse(ra2, 'clock_regressed');
      const r2 = await h.root.reapLapsed();
      assert.deepEqual(
        r2.reaped.map((x) => [x['role'], x['reason']]),
        [[ra2, 'clock_regressed']],
      );
      // الجلسةُ غيرُ المختومة (‏الدورُ كان LOGIN): لا إعادةَ اتّصال — NOLOGIN.
      await rejection(() => /** @type {pg.Client} */ (a2.client).query('SELECT 1'));
      await rejection(() => h.login(ra2));
      const res = (await checkFenced()).residuals.find(
        (/** @type {any} */ x) => x.kind === 'notify_not_revocable',
      );
      assert.match(String(res?.note), /reap_lapsed/, 'المتبقّي يذكرُ الحاصدَ ونافذتَه');
    } finally {
      await aud.end().catch(() => {});
      await h.root.reapLapsed();
    }
  });

  test('WL-542 الإيقافُ من السياديّ وحدَه: halt_request يحصدُ المنقضيَ فوراً، وغيرُ المنقضي مرفوضُ الكتابةِ حتى يكتملَ الإيقاف', async () => {
    const a = await h.boot('alpha');
    const b = await h.boot('beta');
    const ca = /** @type {pg.Client} */ (a.client);
    const cb = /** @type {pg.Client} */ (b.client);
    await lapse(String(a.credential.role_name));
    await h.sovClient.query(`SELECT fence.halt_request('wl542-sovereign-halt')`);
    await rejection(() => ca.query(`NOTIFY wl542h, 'after-sov-halt'`));
    assert.equal(
      (await credential(String(a.credential.role_name))).revoke_reason,
      'LEASE_LAPSED:expired',
    );
    // الصالحُ: لم يُحصَد (‏ليس منقضياً) لكنّ كتابتَه مرفوضةٌ بالطلبِ المفتوح، والتجديدُ مرفوضٌ (‏XF502) فينقضي.
    await rejection(() => cb.query(`INSERT INTO state.fence_probe VALUES (5422, 'x')`));
    await rejectsWith(
      () => h.root.renewLease(String(b.credential.role_name)),
      ['XF502'],
      'لا تجديدَ تحتَ طلبِ إيقاف',
    );
    await lapse(String(b.credential.role_name));
    const r = await h.sovereign.reapLapsed();
    assert.deepEqual(
      r.reaped.map((x) => x['role']),
      [b.credential.role_name],
      'وبعدَ انقضائه يحصدُه السياديُّ بلا جذر',
    );
    await rejection(() => cb.query('SELECT 1'));
    const hr = /** @type {any} */ (await h.root.halt('wl542-complete', { effects: NO_EFFECTS }));
    assert.equal(hr.dbFenced, true, JSON.stringify(hr.check?.problems));
    await h.resume();
    assert.equal((await h.sovereign.status()).effective.state, 'RUNNING');
  });

  test('WL-542 السباق: تجديدٌ وحصادٌ متزامنان على وصلتين — لا يُحصَدُ ما جُدِّدَ والتزم، ولا يُجدَّدُ ما حُصِد', async () => {
    const root2 = await h.login('xf_root');
    try {
      // (‏أ) التجديدُ يمسكُ الصفَّ ولم يلتزمْ بعد، والإيجارُ الأصليُّ ينقضي أثناءَه: الحاصدُ ينتظرُ القفلَ ثمّ يرى التجديد.
      const a = await h.boot('alpha');
      const ra = String(a.credential.role_name);
      await h.db.pool.query(
        `UPDATE fence.run_lease SET expires_at = clock_timestamp() + interval '700 milliseconds' WHERE role_name = $1`,
        [ra],
      );
      await root2.query('BEGIN');
      await root2.query('SELECT fence.renew_lease($1)', [ra]);
      await new Promise((r) => setTimeout(r, 900));
      const reaping = h.sovereign.reapLapsed();
      for (let i = 0; i < 50; i++) {
        const wt = await h.db.pool.query(
          `SELECT count(*)::int AS n FROM pg_stat_activity WHERE usename = 'xf_sovereign' AND wait_event_type = 'Lock'`,
        );
        if (wt.rows[0].n > 0) break;
        await new Promise((r) => setTimeout(r, 20));
      }
      await root2.query('COMMIT');
      const r = await reaping;
      assert.deepEqual(r.reaped, [], 'التجديدُ الملتزمُ قبلَ القفلِ يُرى بعدَه');
      await /** @type {pg.Client} */ (a.client).query(
        `INSERT INTO state.fence_probe VALUES (5423, 'ok')`,
      );
      await /** @type {pg.Client} */ (a.client).query(
        `DELETE FROM state.fence_probe WHERE id = 5423`,
      );
      // (‏ب) الحاصدُ يمسكُ الصفَّ (‏معاملةٌ مفتوحة) والتجديدُ ينتظر: بعدَ الالتزامِ التجديدُ XF007 لا إحياء.
      await lapse(ra);
      await h.sovClient.query('BEGIN');
      const inTx = (await h.sovClient.query('SELECT fence.reap_lapsed() AS r')).rows[0].r;
      assert.deepEqual(
        inTx.reaped.map((/** @type {any} */ x) => x.role),
        [ra],
      );
      const renewing = root2.query('SELECT fence.renew_lease($1)', [ra]).then(
        () => null,
        (/** @type {any} */ e) => e,
      );
      await new Promise((r) => setTimeout(r, 150));
      await h.sovClient.query('COMMIT');
      const err = await renewing;
      assert.equal(err?.code, 'XF007', String(err?.message));
      assert.equal((await credential(ra)).status, 'REVOKED');
    } finally {
      await h.sovClient.query('ROLLBACK').catch(() => {});
      await root2.end().catch(() => {});
      await h.root.reapLapsed();
    }
  });

  test('WL-542 حافظُ الإيجار: رفضُ التجديدِ يُنادي الحاصدَ قبلَ التوقّف — الجلسةُ المنقضيةُ لا تُترَكُ حيّة', async () => {
    const a = await h.boot('alpha');
    const ra = String(a.credential.role_name);
    await lapse(ra);
    /** @type {unknown} */
    let reaped = null;
    // مهلةٌ محدودة: حافظٌ يُجدِّدُ إيجاراً منقضياً (‏الإحياءُ القديم) لا يتوقّفُ أبداً — يفشلُ هنا ولا يُعلِّقُ المجموعة.
    /** @type {{ stop(): void } | null} */
    let keeper = null;
    /** @type {NodeJS.Timeout | undefined} */
    let timer;
    const stopped = await new Promise((resolve) => {
      timer = setTimeout(() => resolve(new Error('keeper-did-not-stop')), 5000);
      keeper = h.root.startLeaseKeeper(
        ra,
        { assertOperational: () => {} },
        {
          intervalMs: 10,
          onReap: (x) => {
            reaped = x;
          },
          onStop: resolve,
        },
      );
    });
    clearTimeout(timer);
    /** @type {any} */ (keeper)?.stop();
    assert.equal(/** @type {any} */ (stopped).code, 'XF009', 'توقّفَ برفضِ التجديد');
    const r = /** @type {any} */ (reaped);
    assert.equal(r?.ok, true, JSON.stringify(r));
    assert.deepEqual(
      r.reaped.map((/** @type {any} */ x) => x.role),
      [ra],
    );
    await rejection(() => /** @type {pg.Client} */ (a.client).query('SELECT 1'));
  });

  test('WL-542 ضغطُ الطابور (‏آمنٌ في CI): مستمعٌ متوقّفٌ يُبقي إشعاراتِ العاملِ في الطابورِ المشترك، والحصادُ يوقفُ الإضافةَ ولا يُفرغُ ما سبق', async () => {
    const aud = await h.login('xf_auditor');
    const got = await listen(aud, 'wl542q');
    const a = await h.boot('alpha');
    const ca = /** @type {pg.Client} */ (a.client);
    const usage = async () =>
      Number((await h.db.pool.query('SELECT pg_notification_queue_usage() AS u')).rows[0].u);
    try {
      await aud.query('BEGIN');
      const big = 'x'.repeat(7000);
      for (let i = 0; i < 20; i++) await ca.query(`SELECT 1; NOTIFY wl542q, '${i}:${big}'`);
      assert.ok((await usage()) > 0, 'الطابورُ المشتركُ يحملُ ما لم يقرأه المستمعُ المتوقّف');
      await lapse(String(a.credential.role_name));
      assert.equal((await h.sovereign.reapLapsed()).ok, true);
      await rejection(() => ca.query(`NOTIFY wl542q, 'after'`));
      await aud.query('COMMIT');
      await settle(aud);
      assert.equal(got.length, 20, 'المُلتزَمُ قبلَ الحصادِ يُسلَّمُ كاملاً (‏حدٌّ معلن)');
      // امتلاءُ الطابور (‏54000 لكلِّ NOTIFY في العنقود) مقيسٌ في مختبرٍ معزول (‏max_notify_queue_pages=64)، لا هنا.
    } finally {
      await aud.query('ROLLBACK').catch(() => {});
      await aud.end().catch(() => {});
      await h.root.reapLapsed();
    }
  });

  test('WL-543: رجوعُ 0025 مرفوضٌ تحتَ RUNNING (‏D-13) — لا يُعطَّلُ مُطلِقٌ ولا تُمَسُّ دالّة', async () => {
    if ((await h.sovereign.status()).effective.state !== 'RUNNING') await h.resume();
    const snap = async () =>
      (
        await h.db.pool.query(
          `SELECT (SELECT string_agg(evtname || ':' || evtenabled::text, ',' ORDER BY evtname) FROM pg_event_trigger) AS evt,
                  (SELECT count(*)::int FROM pg_proc WHERE oid = 'fence.reap_lapsed()'::regprocedure) AS reaper,
                  (SELECT max(version)::int FROM public.schema_migrations) AS v`,
        )
      ).rows[0];
    const before = await snap();
    // ‏≥ 25: هجراتٌ لاحقةٌ (‏0026 WL-544، 0027 WL-545، 0028 WL-551، 0029 WL-552) فوقَها؛ والرجوعُ خطوةً يمسُّ الأعلى — ومرفوضٌ كذلك.
    assert.ok(before.v >= 25, String(before.v));
    // الطبقةُ الأولى: المُهاجِرُ نفسُه يُرفَضُ تحتَ RUNNING (‏xf_ddl_start ⇒ XF201 على إنشاءِ دفترِه).
    await assert.rejects(
      migratorDown(h.db.pool, { steps: 1 }),
      (/** @type {any} */ e) => e.code === 'XF201' || /D-13/.test(String(e.message)),
    );
    assert.deepEqual(await snap(), before);
    // الطبقةُ الثانية: نصُّ 0025 نفسُه (‏تقديماً ورجوعاً) يرفضُ تحتَ RUNNING بحارسِه (‏D-13) ولو نُفِّذَ مباشرة.
    for (const file of [
      '0025_fence_lease_reaper.down.sql',
      '0025_fence_lease_reaper.up.sql',
      '0026_fence_read_surface.down.sql',
      '0026_fence_read_surface.up.sql',
      '0027_fence_reap_deadline.down.sql',
      '0027_fence_reap_deadline.up.sql',
      '0028_fence_owner_membership.down.sql',
      '0028_fence_owner_membership.up.sql',
      '0029_fence_revoked_session.down.sql',
      '0029_fence_revoked_session.up.sql',
    ]) {
      const sql = readFileSync(new URL(`../../migrations/${file}`, import.meta.url), 'utf8');
      const c = await h.db.pool.connect();
      try {
        await c.query('BEGIN');
        await assert.rejects(c.query(sql), /D-13/, file);
      } finally {
        await c.query('ROLLBACK').catch(() => {});
        c.release();
      }
      assert.deepEqual(await snap(), before, file);
    }
  });
});

// ═══ ‏`WL-608` — ‏`LIVE-75`: ما يقدرُ عليه العاملُ **فعلاً** عبرَ انقضاءِ الإيجار ═══════════════════════════
// حارسُ الكتابةِ (‏`fence.guard_write`) زنادُ عبارةٍ (‏BEFORE … FOR EACH STATEMENT) يقرأُ `clock_timestamp()` **عندَ بدءِ
// العبارة**؛ وقراءةُ العامل تمرُّ بسياسةِ `xf_read` (‏`fence.read_ok()`). لا فحصَ عندَ `COMMIT`. تُقاسُ هنا الحدودُ
// الفعليّة بلا حاصد (‏أسوأُ حالةٍ: لا مُشرِفَ ولا حاصدَ حيّ)، بقاعدةٍ وساعةٍ حقيقيّتين، ويُطبَعُ كلُّ قياسٍ بـ`t_note`.
// ‏**اكتشافُ الوفاةِ ليس منعَ الكتابة**: ما يُثبَتُ هنا حدودُ القاعدة، لا أنّ المُشرِفَ يمنعُ شيئاً. ‏`LIVE-75` يبقى OPEN.
describe(
  'WL-608 LIVE-75: قدرةُ العاملِ الفعليّةُ على القراءةِ والكتابةِ عبرَ انقضاءِ الإيجار (‏بلا حاصد)',
  { skip: skipWithoutDatabase },
  () => {
    /** @type {Awaited<ReturnType<typeof harness>>} */
    let h;
    const WINDOW_S = 5; // ‏الحدُّ الأدنى في 0024 (‏CHECK BETWEEN 5 AND 600)
    before(async () => {
      h = await harness('wl608lease');
      // ‏`LIVE-75/C1-RACE` (‏`WL-619`): جدولُ مِسبارٍ لـC1 وحدَه بمشغِّلَي ساعةٍ يُعلِنانِ بـNOTICE (‏تصلُ ولو فشلت العبارة):
      // ‏`xf_guard_zz_l75` على مستوى العبارة — يُطلَقُ بعدَ `xf_guard` مباشرةً (‏الترتيبُ أبجديّ) فساعتُه حدٌّ أعلى لقراءةِ الزناد؛
      // ‏و`l75_row` قبلَ الصفِّ — يُطلَقُ قبلَ WITH CHECK مباشرةً فساعتُه حدٌّ أدنى لفحصِ RLS. تحتَ HALTED فيُغطّى (‏زنادٌ وسياسة).
      for (const sql of [
        `CREATE TABLE state.l75_c1_probe (id integer PRIMARY KEY, v text NOT NULL DEFAULT '')`,
        `CREATE FUNCTION state.l75_clock_note() RETURNS trigger LANGUAGE plpgsql AS $f$
         BEGIN
           RAISE NOTICE 'l75-clock % %', TG_LEVEL, (extract(epoch FROM clock_timestamp()) * 1000)::float8;
           IF TG_LEVEL = 'ROW' THEN RETURN NEW; END IF;
           RETURN NULL;
         END $f$`,
        `REVOKE ALL ON FUNCTION state.l75_clock_note() FROM PUBLIC`,
        `CREATE TRIGGER xf_guard_zz_l75 BEFORE INSERT ON state.l75_c1_probe FOR EACH STATEMENT EXECUTE FUNCTION state.l75_clock_note()`,
        `CREATE TRIGGER l75_row BEFORE INSERT ON state.l75_c1_probe FOR EACH ROW EXECUTE FUNCTION state.l75_clock_note()`,
        `GRANT SELECT, INSERT ON state.l75_c1_probe TO xuux_worker`,
        // ‏`LIVE-75/RLS-INITPLAN` (‏`WL-620`): مِسبارٌ بصفّينِ في عبارةٍ واحدة. زنادُ الصفِّ (‏BEFORE ROW، ‏VOLATILE) يُعلِنُ لكلِّ صفٍّ
        // ‏كم صفّاً **من العبارةِ نفسِها** صارَ مرئيّاً (‏قاعدةُ PG: زنادُ BEFORE ROW يرى ما أدرجَته العبارةُ من صفوفٍ سابقة) وساعتَه،
        // ‏ثمّ — للصفِّ المتأخّرِ وحدَه — ينامُ عبرَ الانقضاءِ ويُعيدُ الصفّ، فيُفحَصُ WITH CHECK بعدَ النوم. ‏`seen = 1` في إعلانِ
        // ‏المتأخّرِ دليلٌ مستقلٌّ على أنّ الأوّلَ اجتازَ WITH CHECK وأُدرِجَ قبلَ أن يبدأَ تأخيرُ الثاني؛ وساعتُه قبلَ الانقضاءِ تنفي الرفضَ المبكّر.
        `CREATE TABLE state.l75_initplan_probe (id integer PRIMARY KEY, v text NOT NULL)`,
        `CREATE FUNCTION state.l75_initplan_row() RETURNS trigger LANGUAGE plpgsql VOLATILE AS $f$
         DECLARE seen int; late boolean;
         BEGIN
           IF TG_OP = 'INSERT' THEN
             late := NEW.v = 'late';
             SELECT count(*) INTO seen FROM state.l75_initplan_probe WHERE id BETWEEN NEW.id - 4 AND NEW.id + 4;
           ELSE
             late := OLD.v LIKE 'late%';
             SELECT count(*) INTO seen FROM state.l75_initplan_probe
              WHERE id BETWEEN NEW.id - 4 AND NEW.id + 4 AND v LIKE '%-new';
           END IF;
           RAISE NOTICE 'l75-ip ROW % % % %', TG_OP, NEW.id, seen, (extract(epoch FROM clock_timestamp()) * 1000)::float8;
           IF late THEN PERFORM pg_sleep(1.5); END IF;
           RETURN NEW;
         END $f$`,
        `REVOKE ALL ON FUNCTION state.l75_initplan_row() FROM PUBLIC`,
        `CREATE TRIGGER xf_guard_zz_l75 BEFORE INSERT OR UPDATE ON state.l75_initplan_probe FOR EACH STATEMENT EXECUTE FUNCTION state.l75_clock_note()`,
        `CREATE TRIGGER l75_ip_row BEFORE INSERT OR UPDATE ON state.l75_initplan_probe FOR EACH ROW EXECUTE FUNCTION state.l75_initplan_row()`,
        `GRANT SELECT, INSERT, UPDATE ON state.l75_initplan_probe TO xuux_worker`,
      ])
        await h.db.pool.query(sql);
      await h.sovereign.command('lease_set', { lease_window_s: WINDOW_S, lease_renew_s: 1 });
      await h.resume();
    });
    after(async () => {
      if (h) await h.close();
    });
    const sleep = (/** @type {number} */ ms) => new Promise((r) => setTimeout(r, ms));
    /** ساعةُ القاعدة (‏ms). */
    const dbNow = async () =>
      Number(
        (
          await h.db.pool.query(
            `SELECT (extract(epoch FROM clock_timestamp()) * 1000)::float8 AS t`,
          )
        ).rows[0].t,
      );
    /** @param {string} role */
    const expiresAt = async (role) =>
      Number(
        (
          await h.db.pool.query(
            `SELECT (extract(epoch FROM expires_at) * 1000)::float8 AS t FROM fence.run_lease WHERE role_name = $1`,
            [role],
          )
        ).rows[0].t,
      );
    /** حتى تتجاوزَ ساعةُ القاعدةِ اللحظةَ `ms`. @param {number} ms */
    const untilDb = async (ms) => {
      for (let now = await dbNow(); now <= ms; now = await dbNow())
        await sleep(Math.min(200, ms - now + 5));
    };
    /** @param {number} id */
    const committed = async (id) =>
      (await h.db.pool.query('SELECT v FROM state.fence_probe WHERE id = $1', [id])).rows[0]?.v ??
      null;
    /**
     * @param {import('pg').Client} c @param {string} sql @param {unknown[]} [p]
     * @returns {Promise<{ ok: boolean, code?: string, command?: string, rows?: any[] }>}
     */
    const outcome = (c, sql, p = []) =>
      c.query(sql, p).then(
        (r) => ({ ok: true, command: r.command, rows: r.rows }),
        // ‏النصُّ غيرُ قابلٍ للعدّ: يظهرُ في التشخيصِ ولا يدخلُ مقارنةَ deepEqual.
        (/** @type {any} */ e) =>
          Object.defineProperty({ ok: false, code: String(e.code ?? e.message) }, 'message', {
            value: String(e.message),
            enumerable: false,
          }),
      );
    /** @param {'alpha' | 'beta'} id */
    const bootWorker = async (id) => {
      const a = await h.boot(id);
      const role = String(a.credential.role_name);
      return { role, c: /** @type {import('pg').Client} */ (a.client), exp: await expiresAt(role) };
    };

    test('L75-W1: معاملةٌ كتبت قبلَ الانقضاء تُلتزَمُ بعدَه (‏COMMIT بلا فحص)، وعبارةٌ جديدةٌ في معاملةٍ مفتوحةٍ تُرفَضُ وتُسقِطُ ما قبلَها', async () => {
      const [a, b] = await Promise.all([bootWorker('alpha'), bootWorker('beta')]);
      await a.c.query('BEGIN');
      await a.c.query(`INSERT INTO state.fence_probe (id, v) VALUES (60801, 'before-expiry')`);
      await b.c.query('BEGIN');
      await b.c.query(`INSERT INTO state.fence_probe (id, v) VALUES (60802, 'before-expiry')`);
      const exp = Math.max(a.exp, b.exp);
      await untilDb(exp + 1500);
      // ‏(أ) ‏COMMIT بعدَ الانقضاءِ بـ1.5 ث: لا فحصَ عندَ الالتزام.
      const commitAt = await dbNow();
      const commit = await outcome(a.c, 'COMMIT');
      assert.deepEqual(commit, { ok: true, command: 'COMMIT', rows: [] });
      assert.equal(
        await committed(60801),
        'before-expiry',
        'كتابةٌ بدأت قبلَ الانقضاءِ صارت مرئيّةً بعدَه',
      );
      // ‏(ب) عبارةٌ جديدةٌ بعدَ الانقضاءِ في المعاملةِ المفتوحة ⇒ ‏XF009، والمعاملةُ كلُّها تسقط.
      assert.deepEqual(
        await outcome(b.c, `INSERT INTO state.fence_probe (id, v) VALUES (60803, 'after')`),
        {
          ok: false,
          code: 'XF009',
        },
      );
      assert.equal((await outcome(b.c, 'COMMIT')).command, 'ROLLBACK');
      assert.equal(await committed(60802), null);
      assert.equal(await committed(60803), null);
      // ‏وبعدَها كلُّ كتابةٍ مرفوضة.
      assert.equal(
        (await outcome(a.c, `INSERT INTO state.fence_probe (id, v) VALUES (60804, 'x')`)).code,
        'XF009',
      );
      t_note('L75-W1', {
        commitAfterExpiryMs: Math.round(commitAt - a.exp),
        committed: true,
        newStatement: 'XF009',
      });
    });

    test('L75-W2: عبارةٌ واحدةٌ بدأت قبلَ الانقضاءِ وأنتجت صفَّها بعدَه ⇒ سياسةُ RLS (‏WITH CHECK) تفحصُ صفَّها الوحيدَ بعدَ إنتاجِه بساعةٍ حقيقيّة فترفضُه (‏صفٌّ واحد؛ تعدُّدُ الصفوفِ في LIVE-75/RLS-INITPLAN) (‏42501) ولا يُكتَبُ شيء', async () => {
      // ‏قياسٌ لا افتراض: حدُّ الكتابةِ ليس بدءَ العبارةِ وحدَه — فحصُ الصفِّ عندَ إنتاجِه يُضيِّقُه.
      const a = await bootWorker('alpha');
      await untilDb(a.exp - 1000);
      const startedAt = await dbNow();
      const r = await outcome(
        a.c,
        `INSERT INTO state.fence_probe (id, v)
           SELECT 60805, (extract(epoch FROM clock_timestamp()) * 1000)::bigint::text FROM (SELECT pg_sleep(2)) AS s`,
      );
      const endedAt = await dbNow();
      assert.ok(startedAt < a.exp && endedAt > a.exp, 'العبارةُ عبرت لحظةَ الانقضاء');
      assert.equal(r.ok, false);
      assert.equal(r.code, '42501', String(/** @type {any} */ (r).message));
      assert.match(String(/** @type {any} */ (r).message), /row-level security/);
      assert.equal(await committed(60805), null, 'لا صفَّ مُنتَجاً بعدَ الانقضاءِ كُتِب');
      // ‏والضابط: العبارةُ نفسُها بلا نومٍ قبلَ الانقضاءِ تُكتَب (‏الرفضُ سببُه الزمنُ لا الصياغة).
      const b = await bootWorker('beta');
      const ok = await outcome(
        b.c,
        `INSERT INTO state.fence_probe (id, v)
           SELECT 60807, (extract(epoch FROM clock_timestamp()) * 1000)::bigint::text FROM (SELECT pg_sleep(0)) AS s`,
      );
      assert.equal(ok.ok, true, String(/** @type {any} */ (ok).message));
      t_note('L75-W2', {
        statementStartBeforeExpiryMs: Math.round(a.exp - startedAt),
        rowAfterExpiry: 'rejected-42501-rls',
      });
    });

    // ‏═══ ‏`LIVE-75/RLS-INITPLAN` (‏`WL-620`، يحلُّ محلَّ قياسِ `WL-619`) ═══════════════════════════════════════════════════
    // ‏كانَ القياسُ السابقُ يستدلُّ بـ`pg_stat_activity` (‏رؤيةِ `PgSleep`) وبزمنِ بدءِ العبارة، وبـ`ORDER BY` قد يُدخِلُ Sort يُنتِجُ
    // ‏الصفوفَ كلَّها قبلَ أن يُفحَصَ أوّلُها — فلا يُثبِتُ أنّ الصفَّ الأوّلَ **اجتازَ** RLS قبلَ تأخيرِ الثاني (‏المراجعةُ الخارجيّة).
    // ‏الآن: ‏`VALUES` بصفّين بلا ترتيب، وخطّةٌ مقيسةٌ بـEXPLAIN (‏‏Values Scan مباشرةً تحتَ ModifyTable، لا Sort ولا Materialize)،
    // ‏ودليلٌ مستقلٌّ من داخلِ العبارة (‏زنادُ `l75_ip_row`): إعلانُ الصفِّ المتأخّرِ يرى صفَّ العبارةِ الأوّلَ مُدرَجاً (‏`seen = 1`) —
    // ‏أي اجتازَ WITH CHECK وكُتِبَ — وساعتُه قبلَ الانقضاء؛ ثمّ ينامُ 1.5 ث فيُفحَصُ WITH CHECK له بعدَ الانقضاء. وزنادُ العبارةِ
    // ‏`xf_guard_zz_l75` (‏بعدَ `xf_guard`) يُعلِنُ ساعتَه قبلَ الانقضاء: لا رفضَ مبكّراً من `guard_write`.
    // ‏ما يُثبِتُه: فحصُ RLS لصفٍّ ثانٍ في عبارةٍ اجتازَ صفُّها الأوّلُ الفحصَ قبلَ الانقضاء يقرأُ — أو لا يقرأُ — الساعةَ عندَ صفِّه.
    // ‏ما لا يُثبِتُه: لا يقيسُ إلّا INSERT/UPDATE بمسارِ ModifyTable صفّاً صفّاً؛ ولا يقيسُ COPY ولا الحذف (‏DELETE بلا WITH CHECK —
    // ‏انظر LIVE-75/RLS-SILENT-SKIP)؛ والتأخيرُ مصنوعٌ بزنادٍ لا بحِملٍ حقيقيّ.
    // ‏الخاصيّةُ حمراءُ على الإنتاجِ الحاليّ (‏`todo` حتى 0036 في طلبِ دمجٍ مستقلّ)، وصلاحيّةُ القياسِ والضابطُ الإيجابيُّ لازمانِ دائماً.
    const RLS_INITPLAN_TODO =
      'LIVE-75/RLS-INITPLAN: xf_read تلفُّ read_ok() باستعلامٍ فرعيٍّ غيرِ مرتبط (‏InitPlan يُقيَّمُ مرّةً للعبارة) — الإصلاحُ 0036 في طلبِ دمجٍ مستقلّ (‏WL-620)';
    /** عقدُ الخطّة: لا عقدةَ تُخزِّنُ الصفوفَ أو تُعيدُ ترتيبَها بينَ المصدرِ وModifyTable. */
    const IP_BUFFERING =
      /^\s*(?:->\s*)?(?:Sort|Incremental Sort|Materialize|Hash|Hash Join|Merge Join|Gather|Gather Merge|Memoize|Unique|Aggregate|HashAggregate|GroupAggregate|WindowAgg|CTE Scan)\b/u;
    /**
     * @typedef {{ level: 'ROW', op: string, id: number, seen: number, at: number } | { level: 'STATEMENT', at: number }} IpNote
     * @typedef {{ exp: number, plan: string[], notes: IpNote[], r: any, startedAt: number, endedAt: number, alive: any,
     *   okBefore: boolean, okAfter: boolean, rows: Array<{ id: number, v: string }> }} IpRun
     */
    /**
     * @param {'alpha' | 'beta'} worker @param {string} sql @param {number[]} ids @param {boolean} crossExpiry
     * @returns {Promise<IpRun>}
     */
    const runIp = async (worker, sql, ids, crossExpiry) => {
      const a = await bootWorker(worker);
      const plan = (await a.c.query(`EXPLAIN (VERBOSE, COSTS OFF) ${sql}`)).rows.map((x) =>
        String(x['QUERY PLAN']),
      );
      /** @type {IpNote[]} */
      const notes = [];
      a.c.on('notice', (/** @type {any} */ n) => {
        const msg = String(n.message);
        const row = /^l75-ip ROW (INSERT|UPDATE) (\d+) (\d+) ([0-9.]+)$/u.exec(msg);
        if (row)
          notes.push({
            level: 'ROW',
            op: String(row[1]),
            id: Number(row[2]),
            seen: Number(row[3]),
            at: Number(row[4]),
          });
        const st = /^l75-clock STATEMENT ([0-9.]+)$/u.exec(msg);
        if (st) notes.push({ level: 'STATEMENT', at: Number(st[1]) });
      });
      const okBefore = Boolean((await a.c.query('SELECT fence.read_ok() AS ok')).rows[0].ok);
      if (crossExpiry) await untilDb(a.exp - 700);
      const startedAt = await dbNow();
      const r = await outcome(a.c, sql);
      const endedAt = await dbNow();
      const alive = await outcome(a.c, 'SELECT 1 AS one');
      const okAfter = Boolean((await a.c.query('SELECT fence.read_ok() AS ok')).rows[0].ok);
      const rows = (
        await h.db.pool.query(
          'SELECT id, v FROM state.l75_initplan_probe WHERE id = ANY($1::int[]) ORDER BY id',
          [ids],
        )
      ).rows;
      return { exp: a.exp, plan, notes, r, startedAt, endedAt, alive, okBefore, okAfter, rows };
    };
    const IP_INSERT = `INSERT INTO state.l75_initplan_probe (id, v) VALUES (60850, 'first'), (60851, 'late')`;
    const IP_UPDATE = `UPDATE state.l75_initplan_probe SET v = v || '-new' WHERE id IN (60860, 60861)`;
    /** @type {Record<string, Promise<IpRun>>} */
    const ipRuns = {};
    const ipInsert = () => (ipRuns.insert ??= runIp('alpha', IP_INSERT, [60850, 60851], true));
    const ipUpdate = () =>
      (ipRuns.update ??= (async () => {
        // ‏الصفّانِ يُدرَجانِ بالترتيبِ في عبارةٍ واحدة (‏كومةٌ بترتيبِ الإدراج)؛ والقياسُ يتحقّقُ من الترتيبِ ولا يفترضُه.
        await h.db.pool.query(
          `INSERT INTO state.l75_initplan_probe (id, v) VALUES (60860, 'first-u'), (60861, 'late-u')`,
        );
        return runIp('alpha', IP_UPDATE, [60860, 60861], true);
      })());

    /**
     * صلاحيّةُ القياسِ لعبارةٍ عبرَت الانقضاء — مشتركةٌ بينَ INSERT وUPDATE.
     * @param {IpRun} m @param {'Insert' | 'Update'} node @param {[number, number]} ids
     */
    const assertIpValid = (m, node, [firstId, lateId]) => {
      // ‏(١) الخطّة: ModifyTable أوّلاً، ولا عقدةَ تُخزِّنُ أو تُرتِّب.
      assert.match(
        m.plan[0] ?? '',
        new RegExp(`^${node} on state\\.l75_initplan_probe`, 'u'),
        m.plan.join('\n'),
      );
      if (node === 'Insert')
        assert.ok(
          m.plan.some((l) => /->\s*Values Scan on "\*VALUES\*"/u.test(l)),
          m.plan.join('\n'),
        );
      assert.deepEqual(
        m.plan.filter((l) => IP_BUFFERING.test(l)),
        [],
        m.plan.join('\n'),
      );
      // ‏(٢) الحالةُ: صالحةٌ قبل، ومنقضيةٌ بعد، والوصلةُ حيّة.
      assert.equal(m.okBefore, true);
      assert.equal(m.okAfter, false, 'الإيجارُ انقضى فعلاً');
      assert.equal(m.alive.ok, true, 'لا انقطاعَ ولا مهلة');
      // ‏(٣) الزنادُ اجتيزَ قبلَ الانقضاء — لا رفضَ مبكّراً.
      const st = m.notes.filter((n) => n.level === 'STATEMENT');
      assert.equal(st.length, 1, 'زنادُ العبارةِ أُطلِقَ مرّةً');
      assert.ok((st[0]?.at ?? Infinity) < m.exp, 'guard_write اجتيزَ قبلَ الانقضاء');
      // ‏(٤) الدليلُ المستقلّ: صفّانِ بالترتيب، والأوّلُ مرئيٌّ مُدرَجاً لزنادِ الثاني قبلَ الانقضاءِ وقبلَ تأخيرِه.
      const rows = /** @type {Array<Extract<IpNote, { level: 'ROW' }>>} */ (
        m.notes.filter((n) => n.level === 'ROW')
      );
      assert.deepEqual(
        rows.map((n) => [n.id, n.seen]),
        [
          [firstId, 0],
          [lateId, 1],
        ],
        'الصفُّ الأوّلُ اجتازَ WITH CHECK وكُتِبَ قبلَ أن يبدأَ تأخيرُ الثاني',
      );
      assert.ok((rows[1]?.at ?? Infinity) < m.exp, 'تأخيرُ الصفِّ الثاني بدأَ قبلَ الانقضاء');
      assert.ok(m.startedAt < m.exp && m.endedAt > m.exp + 500, 'WITH CHECK للثاني بعدَ الانقضاء');
      // ‏(٥) نتيجتانِ لا ثالثةَ لهما: قَبولٌ (‏العيب) أو 42501 برسالةِ RLS لهذا الجدول (‏الإصلاح).
      if (m.r.ok) assert.equal(m.r.command, node.toUpperCase());
      else {
        assert.equal(m.r.code, '42501', String(m.r.message));
        assert.match(
          String(m.r.message),
          /new row violates row-level security policy for table "l75_initplan_probe"/u,
        );
      }
    };

    test('LIVE-75/RLS-INITPLAN صلاحيّةُ القياس (‏INSERT): خطّةٌ بلا Sort/Materialize، وguard_write اجتيزَ، والصفُّ الأوّلُ اجتازَ WITH CHECK وكُتِبَ قبلَ تأخيرِ الثاني، والثاني فُحِصَ بعدَ الانقضاء', async () => {
      const m = await ipInsert();
      assertIpValid(m, 'Insert', [60850, 60851]);
      const late = m.notes.find((n) => n.level === 'ROW' && n.id === 60851);
      t_note('LIVE-75/RLS-INITPLAN', {
        op: 'INSERT',
        statement: m.r.ok ? 'accepted' : String(m.r.code),
        lateRowDelayStartBeforeExpiryMs: Math.round(m.exp - Number(late?.at)),
        lateRowCheckAfterExpiryMs: Math.round(Number(late?.at) + 1500 - m.exp),
        rowsWritten: m.rows.length,
        plan: m.plan.filter((l) => !/^\s*Output:/u.test(l)).map((l) => l.trim()),
      });
    });

    test(
      'LIVE-75/RLS-INITPLAN (‏0036): صفٌّ ثانٍ فُحِصَ بعدَ الانقضاءِ في عبارةٍ اجتازَ صفُّها الأوّلُ الفحصَ قبلَه ⇒ 42501 برسالةِ RLS، ولا يُكتَبُ صفّ',
      { todo: RLS_INITPLAN_TODO },
      async () => {
        const m = await ipInsert();
        assert.equal(m.r.ok, false, `العبارةُ قُبِلَت وكُتِبَ ${m.rows.length} صفّ`);
        assert.equal(m.r.code, '42501', String(m.r.message));
        assert.deepEqual(m.rows, [], 'العبارةُ ذرّيّة: لا الثاني ولا الأوّل');
      },
    );

    test('LIVE-75/RLS-INITPLAN صلاحيّةُ القياس (‏UPDATE): خطّةٌ بلا Sort/Materialize، والصفُّ الأوّلُ حُدِّثَ قبلَ تأخيرِ الثاني، وقيمةُ الثاني فُحِصَت بعدَ الانقضاء', async () => {
      const m = await ipUpdate();
      assertIpValid(m, 'Update', [60860, 60861]);
    });

    test(
      'LIVE-75/RLS-INITPLAN (‏0036) UPDATE: قيمةٌ جديدةٌ فُحِصَت بعدَ الانقضاءِ في عبارةٍ اجتازَ صفُّها الأوّلُ الفحصَ قبلَه ⇒ 42501، ولا يتغيّرُ صفّ',
      { todo: RLS_INITPLAN_TODO },
      async () => {
        const m = await ipUpdate();
        assert.equal(m.r.ok, false, 'UPDATE عبرَ الانقضاءِ قُبِل');
        assert.equal(m.r.code, '42501', String(m.r.message));
        assert.deepEqual(m.rows, [
          { id: 60860, v: 'first-u' },
          { id: 60861, v: 'late-u' },
        ]);
      },
    );

    test('LIVE-75/RLS-INITPLAN ضابطٌ إيجابيّ: العبارةُ نفسُها بالتأخيرِ نفسِه قبلَ الانقضاءِ تُكتَبُ كاملة (‏الرفضُ سببُه الزمنُ لا الصياغة)', async () => {
      const sql = `INSERT INTO state.l75_initplan_probe (id, v) VALUES (60870, 'first'), (60871, 'late')`;
      const m = await runIp('beta', sql, [60870, 60871], false);
      assert.ok(m.endedAt < m.exp - 500, 'العبارةُ كلُّها قبلَ الانقضاء');
      assert.deepEqual(m.r, { ok: true, command: 'INSERT', rows: [] });
      assert.deepEqual(
        m.notes.filter((n) => n.level === 'ROW').map((n) => /** @type {any} */ (n).seen),
        [0, 1],
      );
      assert.deepEqual(m.rows, [
        { id: 60870, v: 'first' },
        { id: 60871, v: 'late' },
      ]);
    });

    test(
      'LIVE-75/RLS-INITPLAN بنيويّ (‏0036): كلُّ سياسةِ xf_read على علاقةٍ محميّةٍ بالصيغةِ القانونيّةِ حرفيّاً (‏الساعةُ لكلِّ صفّ في USING وWITH CHECK)، ولا متساهلةَ غيرُها',
      { todo: RLS_INITPLAN_TODO },
      async () => {
        const rows = (
          await h.db.pool.query(
            `SELECT pr.schema_name || '.' || pr.rel_name AS rel, pg_get_expr(po.polqual, po.polrelid) AS q,
                    pg_get_expr(po.polwithcheck, po.polrelid) AS w
               FROM fence.protected_relations() pr JOIN pg_policy po ON po.polrelid = pr.relid AND po.polname = 'xf_read'`,
          )
        ).rows;
        // ‏مطابقةٌ حرفيّةٌ لا تطابقُ نمط: `clock_timestamp() OR true` ليس إصلاحاً.
        const canon = '(clock_timestamp() <@ ( SELECT fence.read_window() AS read_window))';
        const n = Number(
          (await h.db.pool.query('SELECT count(*)::int AS n FROM fence.protected_relations()'))
            .rows[0].n,
        );
        assert.ok(
          rows.length > 0 && rows.length === n,
          `xf_read على كلِّ علاقةٍ محميّة (${rows.length}/${n})`,
        );
        for (const r of rows) assert.deepEqual([r.q, r.w], [canon, canon], r.rel);
        const extra = (
          await h.db.pool.query(
            `SELECT po.polrelid::regclass::text AS rel, po.polname FROM fence.protected_relations() pr
               JOIN pg_policy po ON po.polrelid = pr.relid WHERE po.polname <> 'xf_read' AND po.polpermissive`,
          )
        ).rows;
        assert.deepEqual(extra, [], 'لا سياسةَ متساهلةً أخرى تُضَمُّ بـOR');
      },
    );

    test('L75-R1: القراءة — قبلَ الانقضاءِ ترى، وبعدَه صفرُ صفوفٍ بلا خطأ (‏حتى داخلَ REPEATABLE READ بدأت قبلَه)', async () => {
      await h.db.pool.query(
        `INSERT INTO state.fence_probe (id, v) VALUES (60806, 'visible') ON CONFLICT DO NOTHING`,
      );
      const a = await bootWorker('alpha');
      const count = async () =>
        (await a.c.query(`SELECT count(*)::int AS n FROM state.fence_probe WHERE id = 60806`))
          .rows[0].n;
      assert.equal(await count(), 1, 'العاملُ يقرأُ قبلَ الانقضاء');
      await a.c.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
      assert.equal(await count(), 1);
      await untilDb(a.exp + 300);
      assert.equal(await count(), 0, 'داخلَ المعاملةِ نفسِها: read_ok بساعةٍ حقيقيّةٍ لا بلقطة');
      await a.c.query('ROLLBACK');
      assert.equal(await count(), 0, 'خارجَها: لا صفوف');
      // ‏الخطأُ غيرُ مُعلَن: القراءةُ صفرٌ صامت — المُستدعي لا يعرفُ أنّه مرفوض.
      const r = await outcome(a.c, `SELECT id FROM state.fence_probe`);
      assert.deepEqual(r, { ok: true, command: 'SELECT', rows: [] });
      t_note('L75-R1', {
        beforeExpiry: 1,
        afterExpiryInRepeatableRead: 0,
        afterExpiry: 0,
        error: false,
      });
    });

    // ‏`LIVE-75/C1-RACE` (‏`WL-619`): أوّلُ رفضٍ عبرَ اللحظةِ تصنعُه إحدى طبقتَين، ولكلٍّ شرطُها السببيّ المقيس:
    // ‏`guard_write` (‏زنادُ العبارة، يقرأُ الساعةَ قبلَ أيِّ صفّ) ⇒ `XF009`؛ أو — إن وقعَ الانقضاءُ بينَ قراءةِ الزنادِ للساعة
    // ‏وفحصِ RLS للصفّ (‏أجزاءٌ من ms) — سياسةُ `xf_read` ⇒ `42501` برسالةِ RLS، والعبارةُ **بدأت قبلَ الانقضاء** (‏لو قرأَ الزنادُ
    // ‏ساعةً بعدَه لرفعَ `XF009` قبلَ أيِّ صفّ). مقيسٌ: تكرارُ النمطِ 20 مرّةً على PG 18.7 أعطى 19 ‏`XF009` بدأت كلُّها بعدَ
    // ‏الانقضاء و1 ‏`42501` بدأ قبلَه بـ0.38 ms؛ والمسارُ نفسُه حتميٌّ في «L75-C1-RACE» أدناه. لا رمزَ ثالث، ولا صفَّ مكتوب.
    // ‏ولا يُكتفى بزمنِ بدءِ العبارة: مِسبارا `state.l75_c1_probe` يُسجِّلانِ لحظةَ اجتيازِ الزنادِ ولحظةَ ما قبلَ WITH CHECK.
    test('L75-C1: انقضاءٌ متزامنٌ مع الالتزام — عباراتٌ ذاتيّةُ الالتزامِ كلَّ ~10 ms عبرَ اللحظة: آخرُ قَبولٍ قبلَها، وأوّلُ رفضٍ XF009 من الزنادِ قبلَ أيِّ صفّ أو 42501 من RLS بعدَ زنادٍ اجتازَ الساعةَ قبلَها (‏C1-RACE)', async () => {
      const a = await bootWorker('alpha');
      /** @type {Array<{ level: string, at: number }>} */
      let clocks = [];
      a.c.on('notice', (/** @type {any} */ n) => {
        const m = /^l75-clock (STATEMENT|ROW) ([0-9.]+)$/u.exec(String(n.message));
        if (m) clocks.push({ level: String(m[1]), at: Number(m[2]) });
      });
      await untilDb(a.exp - 400);
      /** @type {Array<{ at: number, ok: boolean, code?: string | undefined, message?: string | undefined, guardAt?: number | undefined, rowAt?: number | undefined, id: number }>} */
      const seen = [];
      for (let id = 60900; id < 61100; id++) {
        clocks = [];
        const r = await outcome(
          a.c,
          `INSERT INTO state.l75_c1_probe (id, v) VALUES ($1, '') RETURNING (extract(epoch FROM statement_timestamp()) * 1000)::float8 AS at`,
          [id],
        );
        const at = r.ok ? Number(/** @type {any} */ (r).rows[0].at) : await dbNow();
        seen.push({
          at,
          ok: r.ok,
          code: /** @type {any} */ (r).code,
          message: /** @type {any} */ (r).message,
          guardAt: clocks.find((c) => c.level === 'STATEMENT')?.at,
          rowAt: clocks.find((c) => c.level === 'ROW')?.at,
          id,
        });
        if (!r.ok) break;
        await sleep(10);
      }
      const accepted = seen.filter((s) => s.ok);
      const rejected = seen.find((s) => !s.ok);
      assert.ok(accepted.length > 0 && rejected, 'القياسُ عبرَ اللحظة');
      // ‏كلُّ مقبولٍ مرَّ بالمِسبارَين (‏وإلّا فالقياسُ لا يرى الطبقات).
      for (const s of accepted)
        assert.ok(
          s.guardAt !== undefined && s.rowAt !== undefined,
          'المِسبارُ يُعلِنُ لكلِّ عبارة',
        );
      if (rejected?.code === 'XF009') {
        // ‏الزنادُ رفضَ قبلَ أيِّ صفّ: لا مِسبارَ بعدَه أُطلِق.
        assert.equal(
          rejected.guardAt,
          undefined,
          'XF009 والمِسبارُ بعدَ الزنادِ أُطلِق — الرفضُ ليس من الزناد',
        );
        assert.equal(rejected.rowAt, undefined);
      } else {
        // ‏مسارُ C1-RACE وحدَه: الزنادُ اجتازَ الساعةَ قبلَ الانقضاء، ثمّ RLS رفضت الصفّ — لا «أيُّ 42501».
        assert.equal(rejected?.code, '42501', `رمزٌ ثالث: ${rejected?.code} ${rejected?.message}`);
        assert.match(
          String(rejected?.message),
          /new row violates row-level security policy for table "l75_c1_probe"/u,
        );
        assert.ok(
          rejected?.guardAt !== undefined && rejected.guardAt < a.exp,
          `42501 والزنادُ لم يجتز الساعةَ قبلَ الانقضاء (${Number(rejected?.guardAt) - a.exp} ms) — كانَ عليه XF009`,
        );
        assert.ok(rejected?.rowAt !== undefined, 'RLS رفضت صفّاً أُنتِج');
      }
      const lastOk = /** @type {{ at: number }} */ (accepted.at(-1)).at;
      assert.ok(lastOk <= a.exp, `آخرُ قَبولٍ بدأَ قبلَ الانقضاء (${lastOk - a.exp} ms)`);
      // ‏كلُّ ما قُبِلَ التُزِمَ فعلاً (‏ذاتيُّ الالتزام)، والمرفوضُ لم يُكتَب.
      const n = (
        await h.db.pool.query(
          `SELECT count(*)::int AS n FROM state.l75_c1_probe WHERE id BETWEEN 60900 AND 61099`,
        )
      ).rows[0].n;
      assert.equal(n, accepted.length);
      const written = (
        await h.db.pool.query('SELECT count(*)::int AS n FROM state.l75_c1_probe WHERE id = $1', [
          rejected?.id,
        ])
      ).rows[0].n;
      assert.equal(written, 0, 'العبارةُ المرفوضةُ لم تكتب');
      const r2 = (/** @type {number | undefined} */ x) =>
        x === undefined ? null : Math.round((x - a.exp) * 100) / 100;
      t_note('L75-C1', {
        accepted: accepted.length,
        lastAcceptedBeforeExpiryMs: Math.round(a.exp - lastOk),
        firstRejectedAfterExpiryMs: Math.round(Number(rejected?.at) - a.exp),
        rejectedCode: rejected?.code,
        rejectedGuardMinusExpiryMs: r2(rejected?.guardAt),
        rejectedRowMinusExpiryMs: r2(rejected?.rowAt),
        lastAcceptedRowMinusExpiryMs: r2(accepted.at(-1)?.rowAt),
      });
    });

    // ‏`LIVE-75/C1-RACE` حتميّاً: الفجوةُ بينَ قراءةِ الزنادِ للساعةِ وفحصِ RLS للصفِّ تُوسَّعُ بـ`pg_sleep` في إنتاجِ الصفِّ الوحيد
    // ‏(‏VALUES تُحسَبُ بعدَ زنادِ العبارةِ وقبلَ WITH CHECK). (أ) بدأت قبلَ الانقضاءِ بـ150 ms والصفُّ بعدَه ⇒ الزنادُ اجتاز، وRLS ترفضُ
    // ‏بـ42501. (ب) عبارةٌ بعدَ الانقضاء ⇒ الزنادُ يرفضُ بـXF009 قبلَ أيِّ صفّ (‏لا ينامُ أبداً: الرفضُ قبلَ VALUES). الطبقتانِ
    // ‏مستقلّتانِ عن ‏`RLS-INITPLAN`: سياسةُ 0024 تُقيِّمُ InitPlan عندَ أوّلِ WITH CHECK — بعدَ إنتاجِ الصفِّ الوحيد — فالنتيجةُ نفسُها.
    test('L75-C1-RACE: الطبقةُ حتميّاً — عبارةٌ بدأت قبلَ الانقضاءِ وصفُّها بعدَه ⇒ 42501 من RLS؛ وعبارةٌ بعدَه ⇒ XF009 من الزنادِ قبلَ أيِّ صفّ', async () => {
      const a = await bootWorker('alpha');
      /** @type {Array<{ level: string, at: number }>} */
      let clocks = [];
      a.c.on('notice', (/** @type {any} */ n) => {
        const m = /^l75-clock (STATEMENT|ROW) ([0-9.]+)$/u.exec(String(n.message));
        if (m) clocks.push({ level: String(m[1]), at: Number(m[2]) });
      });
      const at = (/** @type {string} */ level) => clocks.find((c) => c.level === level)?.at;
      const stored = async (/** @type {number} */ id) =>
        (
          await h.db.pool.query('SELECT count(*)::int AS n FROM state.l75_c1_probe WHERE id = $1', [
            id,
          ])
        ).rows[0].n;
      await untilDb(a.exp - 150);
      const startedAt = await dbNow();
      const r = await outcome(
        a.c,
        `INSERT INTO state.l75_c1_probe (id, v) VALUES (61200, pg_sleep(0.4)::text)`,
      );
      const endedAt = await dbNow();
      const guardAt = at('STATEMENT');
      const rowAt = at('ROW');
      assert.ok(startedAt < a.exp && endedAt > a.exp, 'العبارةُ عبرَت الانقضاء');
      assert.equal(r.code, '42501', String(/** @type {any} */ (r).message));
      assert.match(
        String(/** @type {any} */ (r).message),
        /new row violates row-level security policy for table "l75_c1_probe"/u,
      );
      // ‏لحظةُ كلِّ طبقة: الزنادُ اجتازَ الساعةَ قبلَ الانقضاء، وفحصُ RLS (‏بعدَ مِسبارِ الصفّ) بعدَه.
      assert.ok(
        guardAt !== undefined && guardAt < a.exp,
        `الزنادُ قبلَ الانقضاء (${Number(guardAt) - a.exp} ms)`,
      );
      assert.ok(
        rowAt !== undefined && rowAt > a.exp,
        `فحصُ الصفِّ بعدَ الانقضاء (${Number(rowAt) - a.exp} ms)`,
      );
      assert.equal(await stored(61200), 0);
      clocks = [];
      const t0 = await dbNow();
      const after = await outcome(
        a.c,
        `INSERT INTO state.l75_c1_probe (id, v) VALUES (61201, pg_sleep(0.4)::text)`,
      );
      const took = (await dbNow()) - t0;
      assert.ok(t0 > a.exp);
      assert.equal(after.code, 'XF009', String(/** @type {any} */ (after).message));
      assert.equal(at('STATEMENT'), undefined, 'XF009 من الزناد: لم يُطلَقْ ما بعدَه');
      assert.equal(at('ROW'), undefined, 'ولا صفَّ أُنتِج');
      assert.ok(took < 300, `الزنادُ رفضَ قبلَ إنتاجِ الصفّ (‏لا نومَ: ${Math.round(took)} ms)`);
      assert.equal(await stored(61201), 0);
      t_note('L75-C1-RACE', {
        inFlight: r.code,
        startBeforeExpiryMs: Math.round(a.exp - startedAt),
        guardMinusExpiryMs: Math.round((Number(guardAt) - a.exp) * 100) / 100,
        rowMinusExpiryMs: Math.round((Number(rowAt) - a.exp) * 100) / 100,
        afterExpiry: after.code,
        afterTookMs: Math.round(took),
      });
    });

    test('L75-N1: انقطاعُ وصلةِ الجذرِ أثناءَ التجديد — قبلَ الالتزام لا يُجدَّد، وبعدَه يُجدَّدُ والجذرُ يرى فشلاً؛ والقاعدةُ وحدَها تحكمُ الكتابة', async () => {
      // ‏(أ) قبلَ الالتزام: التجديدُ محجوزٌ خلفَ قفلِ صفِّ الإيجار، ثمّ تُقطَعُ جلسةُ الجذر.
      const a = await bootWorker('alpha');
      const blocker = await h.db.pool.connect();
      const rootSide = await h.login('xf_root');
      try {
        await blocker.query('BEGIN');
        await blocker.query('SELECT 1 FROM fence.run_lease WHERE role_name = $1 FOR UPDATE', [
          a.role,
        ]);
        const rootPid = (await rootSide.query('SELECT pg_backend_pid() AS p')).rows[0].p;
        rootSide.on('error', () => {});
        const renewing = outcome(rootSide, 'SELECT fence.renew_lease($1)', [a.role]);
        await sleep(300);
        await h.db.pool.query('SELECT pg_terminate_backend($1)', [rootPid]);
        const r = await renewing;
        assert.equal(r.ok, false, 'الجذرُ يرى فشلاً');
        await blocker.query('ROLLBACK');
      } finally {
        blocker.release();
        await rootSide.end().catch(() => {});
      }
      assert.equal(await expiresAt(a.role), a.exp, 'لم يُجدَّد');
      await untilDb(a.exp + 200);
      assert.equal(
        (await outcome(a.c, `INSERT INTO state.fence_probe (id, v) VALUES (61200, 'x')`)).code,
        'XF009',
      );
      // ‏ولا يُحيي تجديدٌ لاحقٌ ما انقضى (‏0025).
      assert.equal(
        (await outcome(h.rootClient, 'SELECT fence.renew_lease($1)', [a.role])).ok,
        false,
      );

      // ‏(ب) بعدَ الالتزام: ‏COMMIT يصلُ ويُلتزَمُ ثمّ تُقطَعُ الوصلةُ قبلَ الرد.
      const b = await bootWorker('beta');
      // ‏التجديدُ قربَ النهاية (‏قبلَها بـ1.5 ث) ليكونَ الامتدادُ قابلاً للقياس.
      await untilDb(b.exp - 1500);
      const proxy = await startFaultProxy({
        host: '127.0.0.1',
        port: Number(new URL(String(databaseUrl())).port || 5432),
      });
      // ‏‏\`xf_root\` دورُ عنقودٍ مشترك: تُغيَّرُ كلمةُ مرورِه وحدَها كما يفعلُ الحزام (‏\`login\`)، ولا يُمَسُّ VALID UNTIL
      // ‏إلا إن كان منقضياً فيُفتَحُ لحظةَ الدخولِ ويُعادُ كما كان (‏تعديلُه سابقاً كسرَ \`supervisorLab\` في الملفّ نفسِه — مقيس).
      const password = randomBytes(12).toString('base64url');
      const rootExpired = (
        await h.db.pool.query(
          `SELECT rolvaliduntil IS NOT NULL AND rolvaliduntil <= now() AS e FROM pg_roles WHERE rolname = 'xf_root'`,
        )
      ).rows[0].e;
      await h.db.pool.query(
        `ALTER ROLE xf_root PASSWORD '${password}'${rootExpired ? ` VALID UNTIL 'infinity'` : ''}`,
      );
      const url = new URL(String(databaseUrl()));
      url.username = 'xf_root';
      url.password = password;
      url.pathname = `/${h.db.name}`;
      const viaProxy = new pg.Client({ connectionString: proxy.urlFor(url.toString()) });
      viaProxy.on('error', () => {});
      try {
        await viaProxy.connect();
        if (rootExpired) await h.db.pool.query(`ALTER ROLE xf_root VALID UNTIL '-infinity'`);
        await viaProxy.query('BEGIN');
        const severed = proxy.severOn('renew_lease', { mode: 'after-commit' });
        await viaProxy.query('SELECT fence.renew_lease($1)', [b.role]);
        const commit = await outcome(viaProxy, 'COMMIT');
        await severed;
        assert.equal(commit.ok, false, 'الجذرُ يرى فشلاً');
      } finally {
        await viaProxy.end().catch(() => {});
        await proxy.down();
        // ‏كلمةُ المرورِ المؤقّتةُ تُبطَلُ بأخرى عشوائيّة (‏كما يتركُها الحزام)؛ VALID UNTIL كما كان.
        await h.db.pool.query(
          `ALTER ROLE xf_root PASSWORD '${randomBytes(18).toString('base64url')}'`,
        );
      }
      const extended = await expiresAt(b.role);
      assert.ok(
        extended > b.exp + 1000,
        `القاعدةُ جدّدت رغمَ أنّ الجذرَ رأى فشلاً (+${Math.round(extended - b.exp)} ms)`,
      );
      await untilDb(b.exp + 200);
      const late = await outcome(b.c, `INSERT INTO state.fence_probe (id, v) VALUES (61201, 'x')`);
      assert.equal(
        late.ok,
        true,
        JSON.stringify({
          late: { ...late, message: /** @type {any} */ (late).message },
          extended,
          exp: b.exp,
          now: await dbNow(),
        }) + ' العاملُ يكتبُ بعدَ الموعدِ الذي ظنّه الجذرُ نهايةً — حتى الموعدِ المُجدَّد',
      );
      t_note('L75-N1', {
        beforeCommit: 'not-renewed',
        afterCommit: 'renewed-but-root-saw-failure',
        extraWindowMs: Math.round(extended - b.exp),
      });
    });
  },
);
