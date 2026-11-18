// WL-555: نُقلت هنا حرفيّاً كتلُ `describe` الثلاث WL-541 وWL-544 وWL-551 من `tests/fence/db-fence.test.mjs`
// (‏بترتيبِها وبلا تغييرٍ في جسمٍ أو تأكيد) لأنَّ الملفَّ بلغَ 114 ث محلّيّاً من مهلةِ الملفِّ 120 ث في `npm test`،
// ففشلَ CI بالمهلةِ لا بخطأ. لا تعتمدُ الكتلُ على مساعدٍ في الملفِّ الأصليّ — على الاستيراداتِ ومساعداتِ `tests/helpers` وحدَها.

import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import pg from 'pg';

import { readFileSync } from 'node:fs';

import {
  auditWorkerCapabilitiesLive,
  classifyCapability,
  loadCapabilityPolicy,
} from '../../src/fence/effects.mjs';
import { down as migratorDown } from '../../src/persistence/migrator.mjs';
import { quoteIdent, skipWithoutDatabase } from '../helpers/pg.mjs';
import { NO_EFFECTS, harness, rejection, rejectsWith } from '../helpers/fence-harness.mjs';

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

// ── WL-544: سطحُ القراءةِ وPUBLIC والتسلسلات ─────────────────────────────────────────────────
// الجردُ مقيسٌ من الكتالوجِ الحيّ: ما لـPUBLIC بعدَ الإقلاع، وما يقرؤُه العامل. الهجماتُ تُطبَّقُ بالمالكِ الأعلى
// ويُثبَتُ أثرُها بدورِ العاملِ نفسِه (‏SET ROLE xuux_worker)، ثمّ الكشفُ في check_fenced والمدقّق، ثمّ RESUME يُرفَض.
// ما قبلَ 0026 (‏العيبُ مقيساً) والرجوعُ والطفراتُ في tests/persistence/migration-reversibility.test.mjs.
describe(
  'WL-544: PUBLIC والامتيازاتُ الموروثةُ والافتراضيّةُ والتسلسلات',
  { skip: skipWithoutDatabase },
  () => {
    /** @type {Awaited<ReturnType<typeof harness>>} */
    let h;
    /** @type {Record<string, any>} */
    let policy;
    before(async () => {
      h = await harness('wl544');
      policy = await loadCapabilityPolicy();
    });
    after(async () => {
      if (h) await h.close();
    });
    const problems = async () =>
      /** @type {Array<{ kind: string, object?: string }>} */ (
        (await h.rootClient.query('SELECT fence.check_fenced() AS r')).rows[0].r.problems
      );
    const audit = () => auditWorkerCapabilitiesLive(h.rootClient, policy);
    /**
     * يُنفِّذُ بدورِ العاملِ في جلسةٍ جديدة (‏لحالةِ الجلسة)، بعدَ تمهيدٍ اختياريٍّ بالدورِ المتميّز.
     * @param {string} sql @param {string} [pre]
     */
    const freshWorker = async (sql, pre) => {
      const c = new pg.Client({
        connectionString: /** @type {any} */ (h.db.pool).options.connectionString,
      });
      await c.connect();
      try {
        if (pre) await c.query(pre);
        await c.query('SET ROLE xuux_worker');
        await c.query(sql);
        return 'OK';
      } catch (e) {
        return String(/** @type {any} */ (e).code);
      } finally {
        await c.end();
      }
    };
    /** يُنفِّذُ بدورِ العاملِ في معاملةٍ تُرجَع. @param {string} sql */
    const asWorker = async (sql) => {
      const c = await h.db.pool.connect();
      try {
        await c.query('BEGIN');
        await c.query('SET LOCAL ROLE xuux_worker');
        await c.query(sql);
        return 'OK';
      } catch (e) {
        return String(/** @type {any} */ (e).code);
      } finally {
        await c.query('ROLLBACK').catch(() => {});
        c.release();
      }
    };

    test('خطُّ الأساس: جردُ PUBLIC مقيس، والعاملُ لا يقرأُ إلا state، وcheck_fenced والمدقّقُ نظيفان', async () => {
      const q = async (/** @type {string} */ s) => (await h.db.pool.query(s)).rows;
      assert.deepEqual(
        await q(`SELECT c.oid::regclass::text AS o FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace,
                 aclexplode(coalesce(c.relacl, acldefault(CASE WHEN c.relkind = 'S' THEN 's' ELSE 'r' END::"char", c.relowner))) a
               WHERE a.grantee = 0 AND n.nspname NOT IN ('pg_catalog', 'information_schema') AND n.nspname NOT LIKE 'pg\\_%'`),
        [],
        'لا علاقةَ ولا تسلسلَ لـPUBLIC',
      );
      assert.deepEqual(
        (
          await q(`SELECT n.nspname || ':' || a.privilege_type AS o FROM pg_namespace n,
                   aclexplode(coalesce(n.nspacl, acldefault('n', n.nspowner))) a WHERE a.grantee = 0 ORDER BY 1`)
        ).map((r) => r.o),
        ['information_schema:USAGE', 'pg_catalog:USAGE', 'public:USAGE'],
        'PUBLIC: USAGE على ثلاثةِ مخطّطاتٍ وحدَها، لا CREATE',
      );
      assert.deepEqual(
        (
          await q(`SELECT n.nspname || '.' || p.proname AS o FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace,
                   aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                 WHERE a.grantee = 0 AND n.nspname NOT IN ('pg_catalog', 'information_schema') ORDER BY 1`)
        ).map((r) => r.o),
        ['fence.read_ok', 'state.report_sections_declared', 'state.text_array_is_named'],
        'EXECUTE لـPUBLIC خارجَ الكتالوج: read_ok ودالّتا مستدعٍ ثابتتان في state',
      );
      assert.deepEqual(
        await q(`SELECT a.privilege_type FROM pg_database d, aclexplode(coalesce(d.datacl, acldefault('d', d.datdba))) a
               WHERE a.grantee = 0 AND d.datname = current_database()`),
        [],
        'لا CONNECT ولا TEMPORARY لـPUBLIC على القاعدةِ المسيَّجة',
      );
      assert.deepEqual(await q('SELECT 1 FROM pg_default_acl'), [], 'لا امتيازاتٍ افتراضيّة');
      const inv = (await h.rootClient.query('SELECT fence.worker_capabilities() AS r')).rows[0].r;
      const readSchemas = new Set(
        inv
          .filter(
            (/** @type {any} */ x) =>
              ['relation', 'sequence'].includes(x.axis) && x.privilege === 'SELECT',
          )
          .map((/** @type {any} */ x) => x.detail.schema),
      );
      assert.deepEqual([...readSchemas], ['state']);
      assert.ok(
        inv.every(
          (/** @type {any} */ x) => x.axis !== 'relation' || x.detail.reads_fence === false,
        ),
        'لا علاقةَ يقرؤُها العاملُ مشتقّةٌ من fence',
      );
      assert.deepEqual(await problems(), []);
      assert.deepEqual((await audit()).unclassified, []);
    });

    test('التسلسلات: nextval/setval مرفوضان للعامل، وcurrval/lastval بلا قيمةٍ في الجلسة، وlast_value قراءة', async () => {
      assert.equal(await asWorker(`SELECT nextval('state.events_seq_seq')`), '42501');
      assert.equal(await asWorker(`SELECT setval('state.events_seq_seq', 1000000)`), '42501');
      // currval/lastval حالةُ جلسة: تُقاسُ في جلسةٍ جديدةٍ لا في اتصالٍ مُعادٍ من المجمّع.
      assert.equal(await freshWorker(`SELECT currval('state.events_seq_seq')`), '55000');
      assert.equal(await freshWorker(`SELECT lastval()`), '55000');
      // جلسةٌ سحبَ فيها دورٌ متميّزٌ من تسلسلِ fence ثمّ نزلَت إلى العامل: lastval لا يُسرِّبُ القيمة.
      // ‏(‏nextval غيرُ معاملاتيّ: يستهلكُ رقماً في قاعدةِ الاختبارِ المعزولةِ فقط، وهذا مقبول.)
      assert.equal(
        await freshWorker(`SELECT lastval()`, `SELECT nextval('fence.evidence_id_seq')`),
        '42501',
      );
      assert.equal(await asWorker('SELECT last_value FROM state.events_seq_seq'), 'OK');
      assert.equal(await asWorker('SELECT last_value FROM fence.evidence_id_seq'), '42501');
      assert.equal(await asWorker('SELECT count(*) FROM fence.credentials'), '42501');
    });

    /** @type {Array<{ name: string, apply: string[], revert: string[], exploit: string | null, kinds: string[] }>} */
    const attacks = [
      {
        name: 'SELECT لـPUBLIC على fence.credentials',
        apply: ['GRANT SELECT ON fence.credentials TO PUBLIC'],
        revert: ['REVOKE SELECT ON fence.credentials FROM PUBLIC'],
        exploit: 'SELECT role_name, boot_id FROM fence.credentials',
        kinds: ['worker_read_outside_state'],
      },
      {
        name: 'SELECT على fence.challenges عبرَ دورٍ وسيط',
        apply: [
          'CREATE ROLE wl544_mid NOLOGIN',
          'GRANT SELECT ON fence.challenges TO wl544_mid',
          'GRANT wl544_mid TO xuux_worker',
        ],
        revert: [
          'REVOKE wl544_mid FROM xuux_worker',
          'REVOKE ALL ON fence.challenges FROM wl544_mid',
          'DROP ROLE wl544_mid',
        ],
        exploit: 'SELECT nonce FROM fence.challenges',
        kinds: ['worker_read_outside_state', 'worker_membership'],
      },
      {
        name: 'مشهدٌ في public فوقَ fence.credentials لـPUBLIC (‏يقرأُ بصلاحياتِ مالكِه)',
        apply: [
          'CREATE VIEW public.wl544_v AS SELECT role_name, sealed_sessions FROM fence.credentials',
          'GRANT SELECT ON public.wl544_v TO PUBLIC',
        ],
        revert: ['DROP VIEW public.wl544_v'],
        exploit: 'SELECT * FROM public.wl544_v',
        kinds: ['worker_read_outside_state', 'worker_fence_derived_read'],
      },
      {
        name: 'مشهدٌ مُجسَّدٌ في state فوقَ fence.sovereign_commands',
        apply: [
          'CREATE MATERIALIZED VIEW state.wl544_m AS SELECT nonce, signature FROM fence.sovereign_commands',
          'GRANT SELECT ON state.wl544_m TO xuux_worker',
        ],
        revert: ['DROP MATERIALIZED VIEW state.wl544_m'],
        exploit: 'SELECT * FROM state.wl544_m',
        kinds: ['worker_fence_derived_read'],
      },
      {
        name: 'SELECT لـPUBLIC على تسلسلٍ في fence',
        apply: ['GRANT SELECT ON SEQUENCE fence.evidence_id_seq TO PUBLIC'],
        revert: ['REVOKE SELECT ON SEQUENCE fence.evidence_id_seq FROM PUBLIC'],
        exploit: 'SELECT last_value FROM fence.evidence_id_seq',
        kinds: ['worker_read_outside_state'],
      },
      {
        name: 'USAGE لـPUBLIC على تسلسلٍ في state (‏nextval)',
        apply: ['GRANT USAGE ON SEQUENCE state.events_seq_seq TO PUBLIC'],
        revert: ['REVOKE USAGE ON SEQUENCE state.events_seq_seq FROM PUBLIC'],
        exploit: `SELECT nextval('state.events_seq_seq')`,
        kinds: ['worker_sequence_write'],
      },
      {
        name: 'UPDATE على تسلسلٍ في state عبرَ دورٍ وسيط (‏setval)',
        apply: [
          'CREATE ROLE wl544_seq NOLOGIN',
          'GRANT UPDATE ON SEQUENCE state.task_transitions_id_seq TO wl544_seq',
          'GRANT wl544_seq TO xuux_worker',
        ],
        revert: [
          'REVOKE wl544_seq FROM xuux_worker',
          'REVOKE ALL ON SEQUENCE state.task_transitions_id_seq FROM wl544_seq',
          'DROP ROLE wl544_seq',
        ],
        exploit: `SELECT setval('state.task_transitions_id_seq', 1000000)`,
        kinds: ['worker_sequence_write', 'worker_inherits_roles'],
      },
      {
        name: 'امتيازٌ افتراضيٌّ جديد: جداولُ fence القادمةُ لـPUBLIC',
        apply: [
          'ALTER DEFAULT PRIVILEGES FOR ROLE xf_owner IN SCHEMA fence GRANT SELECT ON TABLES TO PUBLIC',
        ],
        revert: [
          'ALTER DEFAULT PRIVILEGES FOR ROLE xf_owner IN SCHEMA fence REVOKE SELECT ON TABLES FROM PUBLIC',
        ],
        exploit: null,
        kinds: ['worker_default_acl_privilege'],
      },
      {
        name: 'امتيازٌ افتراضيٌّ جديد: تسلسلاتُ state القادمةُ للعامل',
        apply: [
          'ALTER DEFAULT PRIVILEGES FOR ROLE xuux_migrator IN SCHEMA state GRANT USAGE ON SEQUENCES TO xuux_worker',
        ],
        revert: [
          'ALTER DEFAULT PRIVILEGES FOR ROLE xuux_migrator IN SCHEMA state REVOKE USAGE ON SEQUENCES FROM xuux_worker',
        ],
        exploit: null,
        kinds: ['worker_default_acl_privilege'],
      },
    ];
    for (const a of attacks) {
      test(`هجوم: ${a.name} ⇒ أثرٌ حقيقيٌّ بدورِ العامل، ويكشفُه check_fenced (${a.kinds.join('+')}) والمدقّق`, async () => {
        // قبلَ المنح: مرفوضٌ (‏42501) أو الكائنُ لم يُنشأ بعد (‏42P01: مشهدٌ يُنشئُه الهجومُ نفسُه).
        if (a.exploit)
          assert.ok(['42501', '42P01'].includes(await asWorker(a.exploit)), 'قبلَ المنح: مرفوض');
        for (const s of a.apply) await h.db.pool.query(s);
        try {
          if (a.exploit)
            assert.equal(await asWorker(a.exploit), 'OK', 'الهجومُ حقيقيّ: نجحَ بدورِ العامل');
          const kinds = (await problems()).map((p) => p.kind);
          for (const k of a.kinds) assert.ok(kinds.includes(k), `${k} ∉ ${JSON.stringify(kinds)}`);
          const r = await audit();
          assert.ok(!r.ok && r.unclassified.length > 0, 'المدقّقُ يكشف');
        } finally {
          for (const s of a.revert) await h.db.pool.query(s);
        }
        assert.deepEqual(await problems(), [], 'العكسُ يعيدُ النظافة');
        assert.deepEqual((await audit()).unclassified, []);
      });
    }

    test('منعٌ من المصدر: SELECT لـPUBLIC على public.schema_migrations يُرفَضُ لحظةَ المنح (‏XF203)', async () => {
      await rejectsWith(
        () => h.db.pool.query('GRANT SELECT ON public.schema_migrations TO PUBLIC'),
        ['XF203'],
        'منحُ القراءةِ على دفترِ الهجرات',
      );
      assert.deepEqual(await problems(), []);
    });

    test('امتيازٌ لدورٍ ليس العاملَ عضواً فيه لا يُعَدُّ قدرةً للعامل (‏لا إيجابيَّ كاذب)، ويُكشَفُ لحظةَ الوراثة', async () => {
      await h.db.pool.query('CREATE ROLE wl544_other NOLOGIN');
      await h.db.pool.query('GRANT SELECT ON fence.credentials TO wl544_other');
      try {
        assert.deepEqual(await problems(), []);
        await h.db.pool.query('GRANT wl544_other TO xuux_worker');
        const kinds = (await problems()).map((p) => p.kind);
        assert.ok(kinds.includes('worker_read_outside_state'), JSON.stringify(kinds));
        await h.db.pool.query('REVOKE wl544_other FROM xuux_worker');
      } finally {
        await h.db.pool.query('REVOKE ALL ON fence.credentials FROM wl544_other');
        await h.db.pool.query('DROP ROLE wl544_other');
      }
      assert.deepEqual(await problems(), []);
    });

    test('قدرةُ قراءةٍ غيرُ مصنّفةٍ تمنعُ RESUME (‏XF415)، وبعدَ العكسِ يعودُ الجذرُ والسياديُّ والمدقّقُ والمُهاجِرُ والعاملُ كما كانوا', async () => {
      // إيقافٌ كاملٌ نظيفٌ أوّلاً: فإكمالُ HALT نفسُه يرفضُ مع انجرافٍ قائم (‏يبقى HALT_REQUESTED)،
      // والمطلوبُ هنا إثباتُ أنَّ RESUME وحدَه يُرفَضُ بـcheck_fenced (‏XF415) لا بغيابِ الدليل.
      await h.root.halt('wl544-resume', { effects: NO_EFFECTS });
      assert.equal((await h.sovereign.status()).effective.state, 'HALTED');
      await h.db.pool.query('GRANT SELECT ON fence.sovereign_commands TO PUBLIC');
      try {
        await rejectsWith(() => h.resume(), ['XF415'], 'RESUME فوقَ قراءةٍ غيرِ مصنّفة');
        const kinds = (await problems()).map((p) => p.kind);
        assert.ok(kinds.includes('worker_read_outside_state'), JSON.stringify(kinds));
      } finally {
        await h.db.pool.query('REVOKE SELECT ON fence.sovereign_commands FROM PUBLIC');
      }
      await h.resume();
      assert.equal((await h.sovereign.status()).effective.state, 'RUNNING');
      for (const role of ['xf_auditor', 'xuux_migrator']) {
        const c = await h.login(role);
        const r = (await c.query('SELECT fence.check_fenced() AS r')).rows[0].r;
        assert.equal(r.ok, true, `${role}: check_fenced سليم`);
      }
      const w = await h.boot('alpha');
      const cl = /** @type {pg.Client} */ (w.client);
      assert.equal(
        (await cl.query('SELECT count(*)::int AS n FROM state.fence_probe')).rows[0].n,
        0,
      );
      assert.ok((await cl.query('SELECT fence.whoami() AS r')).rows[0].r);
      await rejectsWith(
        () => cl.query('SELECT count(*) FROM fence.credentials'),
        ['42501'],
        'العاملُ الحيُّ لا يقرأُ fence',
      );
    });

    test('المدقّق (‏طفرات): القراءةُ مصنّفةٌ في read_schemas وحدَها ولعلاقةٍ غيرِ مشتقّةٍ من fence صراحةً', () => {
      const rel = (/** @type {Record<string, any>} */ detail) => ({
        axis: 'relation',
        object: 'state.x',
        privilege: 'SELECT',
        detail: { schema: 'state', relkind: 'r', reads_fence: false, ...detail },
      });
      assert.equal(classifyCapability(rel({}), policy)?.class, 'READ_ONLY');
      assert.equal(classifyCapability(rel({ schema: 'fence' }), policy), null, 'fence');
      assert.equal(classifyCapability(rel({ schema: 'public' }), policy), null, 'public');
      assert.equal(
        classifyCapability(rel({ relkind: 'v', reads_fence: true }), policy),
        null,
        'مشتقّ',
      );
      assert.equal(
        classifyCapability(rel({ reads_fence: undefined }), policy),
        null,
        'جردٌ بلا الحقلِ لا يُفترَضُ سليماً',
      );
      assert.equal(
        classifyCapability(rel({}), { ...policy, read_schemas: [] }),
        null,
        'سياسةٌ بلا read_schemas',
      );
      const seq = (/** @type {string} */ schema) => ({
        axis: 'sequence',
        object: `${schema}.s`,
        privilege: 'SELECT',
        detail: { schema, relkind: 'S' },
      });
      assert.equal(classifyCapability(seq('state'), policy)?.class, 'READ_ONLY');
      assert.equal(classifyCapability(seq('fence'), policy), null);
      assert.deepEqual(policy.read_schemas, ['state']);
    });
  },
);

// ── WL-551: عضويّةُ xf_owner تمنعُ RESUME (‏0028) ─────────────────────────────────────────────────
// xf_owner يملكُ fence.* ودوالَّه، وله CREATEROLE وADMIN على xuux_worker. كلُّ عضويّةٍ فيه لدورٍ غيرِ superuser —
// مباشرةً أو عبرَ سلسلةٍ (‏ولو بوسيطٍ NOLOGIN)، وبأيِّ تركيبٍ من ADMIN/INHERIT/SET — مشكلةٌ بمسارِها وخصائصِ حلقاتِها،
// فـRESUME يُرفَضُ (‏XF415) حتى تُسحَب. الكشفُ لا المنع: العضوُ النشِطُ مالكٌ للسياج (‏متبقٍّ مُعلَنٌ مقيسٌ أدناه).
// الرجوعُ والطفراتُ في tests/persistence/migration-reversibility.test.mjs.
describe(
  'WL-551: عضويّةُ xf_owner — مباشرةً وتعدّياً وبكلِّ الخصائص',
  { skip: skipWithoutDatabase },
  () => {
    /** @type {Awaited<ReturnType<typeof harness>>} */
    let h;
    /** @type {string[]} */
    const made = [];
    const su = (/** @type {string} */ s, /** @type {unknown[]} */ p = []) => h.db.pool.query(s, p);
    const mk = async (/** @type {string} */ name, login = false) => {
      await su(`DROP ROLE IF EXISTS ${quoteIdent(name)}`);
      await su(`CREATE ROLE ${quoteIdent(name)} ${login ? 'LOGIN' : 'NOLOGIN'}`);
      made.push(name);
    };
    const dropMade = async () => {
      while (made.length) await su(`DROP ROLE IF EXISTS ${quoteIdent(String(made.pop()))}`);
    };
    /** @returns {Promise<{ ok: boolean, problems: any[], residuals: any[] }>} */
    const fenced = async () =>
      (await h.rootClient.query('SELECT fence.check_fenced() AS r')).rows[0].r;
    const owners = async () =>
      (await fenced()).problems.filter((p) => p.kind === 'owner_membership');
    const state = async () => (await h.sovereign.status()).effective.state;
    before(async () => {
      h = await harness('wl551');
      const base = await fenced();
      assert.equal(base.ok, true, JSON.stringify(base.problems));
    });
    after(async () => {
      if (h) {
        await dropMade().catch(() => {});
        await h.close();
      }
    });

    test('كلُّ تركيبٍ من ADMIN/INHERIT/SET (‏8) مباشرةً: مشكلةٌ بالخصائص ⇒ XF415، ثمّ السحبُ ⇒ سليم', async () => {
      await h.root.halt('wl551-combos', { effects: NO_EFFECTS });
      for (const admin of [false, true])
        for (const inherit of [false, true])
          for (const set of [false, true]) {
            const r = `zz_wl551_${Number(admin)}${Number(inherit)}${Number(set)}`;
            await mk(r);
            await su(
              `GRANT xf_owner TO ${quoteIdent(r)} WITH ADMIN ${admin}, INHERIT ${inherit}, SET ${set}`,
            );
            const p = await owners();
            assert.deepEqual(
              p,
              [
                {
                  kind: 'owner_membership',
                  role: r,
                  login: false,
                  depth: 1,
                  path: [r, 'xf_owner'],
                  edges: [{ role: 'xf_owner', member: r, admin, inherit, set }],
                },
              ],
              r,
            );
            await rejectsWith(() => h.resume(), ['XF415'], `${r} يمنعُ الاستئناف`);
            await su(`REVOKE xf_owner FROM ${quoteIdent(r)}`);
            assert.deepEqual(await owners(), [], `${r}: السحبُ يُزيلُ المشكلة`);
            assert.equal((await fenced()).ok, true, `${r}: سليمٌ بعدَ السحب`);
          }
      await dropMade();
      await h.resume();
      assert.equal(await state(), 'RUNNING');
    });

    test('تعدّياً عبرَ وسطاءَ NOLOGIN (‏عمق 4، وماسة، ودورُ دخول، وxf_sovereign): كلُّ دورٍ بأقصرِ مساره ⇒ XF415', async () => {
      await h.root.halt('wl551-chain', { effects: NO_EFFECTS });
      for (const r of ['zz_wl551_m1', 'zz_wl551_m2', 'zz_wl551_m3', 'zz_wl551_b']) await mk(r);
      await mk('zz_wl551_t', true);
      // سلسلة: t (‏LOGIN) → m3 → m2 → m1 → xf_owner، الحلقاتُ بلا INHERIT ولا SET في الوسط (‏ADMIN وحدَه).
      await su('GRANT xf_owner TO zz_wl551_m1 WITH INHERIT FALSE, SET FALSE, ADMIN TRUE');
      await su('GRANT zz_wl551_m1 TO zz_wl551_m2 WITH INHERIT FALSE, SET TRUE');
      await su('GRANT zz_wl551_m2 TO zz_wl551_m3');
      await su('GRANT zz_wl551_m3 TO zz_wl551_t WITH INHERIT TRUE, SET FALSE');
      // ماسة: b عضوٌ في m1 وm2 — أقصرُ مسارٍ عبرَ m1، ومرّةً واحدة.
      await su('GRANT zz_wl551_m1 TO zz_wl551_b');
      await su('GRANT zz_wl551_m2 TO zz_wl551_b');
      let p = await owners();
      assert.deepEqual(
        p.map((x) => [x.role, x.depth, x.path, x.login]),
        [
          ['zz_wl551_b', 2, ['zz_wl551_b', 'zz_wl551_m1', 'xf_owner'], false],
          ['zz_wl551_m1', 1, ['zz_wl551_m1', 'xf_owner'], false],
          ['zz_wl551_m2', 2, ['zz_wl551_m2', 'zz_wl551_m1', 'xf_owner'], false],
          ['zz_wl551_m3', 3, ['zz_wl551_m3', 'zz_wl551_m2', 'zz_wl551_m1', 'xf_owner'], false],
          [
            'zz_wl551_t',
            4,
            ['zz_wl551_t', 'zz_wl551_m3', 'zz_wl551_m2', 'zz_wl551_m1', 'xf_owner'],
            true,
          ],
        ],
      );
      assert.deepEqual(
        p
          .find((x) => x.role === 'zz_wl551_t')
          .edges.map((/** @type {any} */ e) => [e.member, e.admin, e.inherit, e.set]),
        [
          ['zz_wl551_t', false, true, false],
          ['zz_wl551_m3', false, true, true],
          ['zz_wl551_m2', false, false, true],
          ['zz_wl551_m1', true, false, false],
        ],
        'خصائصُ كلِّ حلقةٍ من الدورِ إلى xf_owner',
      );
      await rejectsWith(() => h.resume(), ['XF415'], 'السلسلةُ تمنعُ الاستئناف');
      // قطعُ الحلقةِ العليا وحدَها يُزيلُ الكلّ؛ وقطعُ حلقةٍ وسطى يُبقي ما فوقَها.
      await su('REVOKE zz_wl551_m2 FROM zz_wl551_m3');
      p = await owners();
      assert.deepEqual(
        p.map((x) => x.role),
        ['zz_wl551_b', 'zz_wl551_m1', 'zz_wl551_m2'],
      );
      await rejectsWith(() => h.resume(), ['XF415'], 'ما بقي يمنعُ الاستئناف');
      await su('REVOKE xf_owner FROM zz_wl551_m1');
      assert.deepEqual(await owners(), []);
      // دورٌ سياديٌّ (‏xf_sovereign) عضواً: يُبلَّغُ كغيرِه.
      await su('GRANT xf_owner TO xf_sovereign');
      try {
        assert.deepEqual(
          (await owners()).map((x) => x.role),
          ['xf_sovereign'],
        );
        await rejectsWith(() => h.resume(), ['XF415'], 'xf_sovereign عضواً يمنعُ الاستئناف');
      } finally {
        await su('REVOKE xf_owner FROM xf_sovereign');
      }
      await dropMade();
      assert.equal((await fenced()).ok, true);
      await h.resume();
    });

    test('superuser عضواً لا يُبلَّغ (‏خارجَ السياج، T-OWN-04)، وما تحتَه يُبلَّغ', async () => {
      await h.root.halt('wl551-su', { effects: NO_EFFECTS });
      await mk('zz_wl551_su');
      await su('ALTER ROLE zz_wl551_su SUPERUSER');
      await mk('zz_wl551_under');
      await su('GRANT xf_owner TO zz_wl551_su');
      await su('GRANT zz_wl551_su TO zz_wl551_under');
      assert.deepEqual(
        (await owners()).map((x) => [x.role, x.path]),
        [['zz_wl551_under', ['zz_wl551_under', 'zz_wl551_su', 'xf_owner']]],
      );
      await su('REVOKE xf_owner FROM zz_wl551_su');
      await dropMade();
      assert.equal((await fenced()).ok, true);
      await h.resume();
    });

    test('فشلٌ مغلق: خطأٌ في جردِ العضويّة مشكلةٌ (‏ok=false — بوّابةُ RESUME وhalt_complete)، ولا يُسقِطُ check_fenced', async () => {
      await h.root.halt('wl551-inv', { effects: NO_EFFECTS });
      const c = await h.db.pool.connect();
      try {
        await c.query('BEGIN');
        await c.query('ALTER EVENT TRIGGER xf_ddl_end DISABLE');
        await c.query(`CREATE OR REPLACE FUNCTION fence._owner_membership_problems() RETURNS jsonb
        LANGUAGE plpgsql STABLE SET search_path = pg_catalog, pg_temp AS $f$
        BEGIN RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'wl551 inventory fault'; END $f$`);
        const r = (await c.query('SELECT fence.check_fenced() AS r')).rows[0].r;
        assert.equal(r.ok, false);
        assert.deepEqual(
          r.problems.filter(
            (/** @type {any} */ p) => p.kind === 'owner_membership_inventory_failed',
          ),
          [
            {
              kind: 'owner_membership_inventory_failed',
              sqlstate: '42501',
              message: 'wl551 inventory fault',
            },
          ],
        );
      } finally {
        await c.query('ROLLBACK').catch(() => {});
        c.release();
      }
      assert.equal((await fenced()).ok, true, 'الإرجاعُ أعادَ الدالّة');
      await h.resume();
    });

    test('HALT: عضويّةٌ قائمةٌ تُبقي الإيقافَ HALT_REQUESTED (‏DB_NOT_FENCED، والطلبُ غيرُ مكتمل)، والسحبُ يُكمِله', async () => {
      if ((await state()) !== 'RUNNING') await h.resume();
      await mk('zz_wl551_h');
      await su('GRANT xf_owner TO zz_wl551_h WITH INHERIT FALSE, SET FALSE');
      const r = await h.root.halt('wl551-halt', { effects: NO_EFFECTS });
      assert.equal(r.dbFenced, false);
      assert.equal(r.reason, 'DB_NOT_FENCED');
      assert.ok(
        r.check.problems.some(
          (/** @type {any} */ p) => p.kind === 'owner_membership' && p.role === 'zz_wl551_h',
        ),
        JSON.stringify(r.check.problems),
      );
      assert.equal(await state(), 'HALT_REQUESTED');
      // ‏الطلبُ مفتوحٌ لم يكتمل (‏لا انتقالَ ولا دلالةَ جديدة: كأيِّ مشكلةٍ في check_fenced منذُ 0024).
      const hr = await su('SELECT status FROM fence.halt_requests WHERE id = $1', [r.haltId]);
      assert.notEqual(hr.rows[0].status, 'COMPLETE');
      await su('REVOKE xf_owner FROM zz_wl551_h');
      const r2 = await h.root.halt('wl551-halt-2', { effects: NO_EFFECTS });
      assert.equal(r2.dbFenced, true, JSON.stringify(r2.check?.problems));
      assert.equal(await state(), 'HALTED');
      await dropMade();
      await h.resume();
    });

    test('أثرُ العضويّة: لا تُمحى ولا يُخفى كشفُها، ودورُ دخولٍ يرثُ العاملَ يُكشَف؛ والاستيلاءُ المباشرُ (‏متبقٍّ في 0028) مرفوضٌ بـ0031 (‏XF105) مقيس', async () => {
      await h.root.halt('wl551-impact', { effects: NO_EFFECTS });
      await mk('zz_wl551_p');
      await su('GRANT xf_owner TO zz_wl551_p WITH INHERIT FALSE, SET TRUE');
      const c = await h.db.pool.connect();
      /** @type {Record<string, string>} */
      const out = {};
      const tryq = async (/** @type {string} */ k, /** @type {string} */ sql) => {
        await c.query('SAVEPOINT p');
        try {
          await c.query(sql);
          out[k] = 'OK';
          await c.query('RELEASE SAVEPOINT p');
        } catch (e) {
          out[k] = String(/** @type {any} */ (e).code);
          await c.query('ROLLBACK TO SAVEPOINT p');
        }
      };
      try {
        await c.query('BEGIN');
        await c.query('SET LOCAL SESSION AUTHORIZATION zz_wl551_p');
        await c.query('SET LOCAL ROLE xf_owner');
        // ما يُخفي الكشفَ: كلُّه مرفوض.
        await tryq('revoke_own_membership', 'REVOKE xf_owner FROM zz_wl551_p');
        await tryq(
          'replace_check_fenced',
          `CREATE OR REPLACE FUNCTION fence.check_fenced() RETURNS jsonb LANGUAGE sql AS $$SELECT '{"ok":true}'::jsonb$$`,
        );
        await tryq(
          'replace_inventory',
          `CREATE OR REPLACE FUNCTION fence._owner_membership_problems() RETURNS jsonb LANGUAGE sql AS $$SELECT '[]'::jsonb$$`,
        );
        await tryq('disable_event_trigger', 'ALTER EVENT TRIGGER xf_ddl_end DISABLE');
        await tryq('disable_control_trigger', 'ALTER TABLE fence.control DISABLE TRIGGER ALL');
        await tryq('rewrite_events', 'UPDATE fence.events SET kind = kind');
        await tryq('grant_owner_onward', 'GRANT xf_owner TO xf_auditor');
        // دورُ دخولٍ يرثُ العامل: يُنشأ (‏CREATEROLE + ADMIN) لكنّه يُكشَف.
        await tryq('create_login_role', 'CREATE ROLE zz_wl551_rogue LOGIN');
        await tryq('grant_worker_to_rogue', 'GRANT xuux_worker TO zz_wl551_rogue');
        const k = (await c.query('SELECT fence.check_fenced() AS r')).rows[0].r.problems.map(
          (/** @type {any} */ p) => p.kind,
        );
        out.detects_rogue = String(k.includes('worker_login_roles'));
        out.detects_owner = String(k.includes('owner_membership'));
        // الاستيلاءُ المباشر (‏متبقٍّ): control بعهدٍ أعلى ثمّ إعادةُ الختم ⇒ RUNNING بلا RESUME ولا check_fenced.
        await tryq(
          'takeover_state',
          `UPDATE fence.control SET state = 'RUNNING', epoch = epoch + 1`,
        );
        await tryq('takeover_reseal', 'SELECT fence._reseal()');
        out.takeover_effective = String(
          (await c.query(`SELECT fence.effective_state()->>'state' AS s`)).rows[0].s,
        );
      } finally {
        await c.query('ROLLBACK').catch(() => {});
        c.release();
      }
      assert.deepEqual(out, {
        revoke_own_membership: '42501',
        replace_check_fenced: 'XF202',
        replace_inventory: 'XF202',
        disable_event_trigger: '42501',
        disable_control_trigger: 'XF202',
        // ‏0032: حارسُ الكاتبِ (‏على مستوى الجملة) يرفضُ قبلَ حارسِ الإلحاقِ (‏XF104، باقٍ خلفه لمن يُسمَحُ له بالكتابة).
        rewrite_events: 'XF107',
        grant_owner_onward: '42501',
        create_login_role: 'OK',
        grant_worker_to_rogue: 'OK',
        detects_rogue: 'true',
        detects_owner: 'true',
        // ‏WL-560 (‏0031): كانت OK/OK/RUNNING (‏الاستيلاءُ المقيسُ في WL-551) — الكاتبُ صارَ يُقرَّرُ بـsession_user.
        takeover_state: 'XF105',
        takeover_reseal: 'XF105',
        takeover_effective: 'HALTED',
      });
      const res = (await fenced()).residuals.find((r) => r.kind === 'owner_membership_detect_only');
      assert.ok(res && /قرارُ مالك/.test(res.note), 'المتبقّي مُعلَنٌ في check_fenced');
      assert.ok(
        res && /0031/.test(res.note) && /لا يكتبُ fence\.control/.test(res.note),
        'الملاحظةُ تصفُ 0031 لا الاستيلاءَ القديم',
      );
      await su('REVOKE xf_owner FROM zz_wl551_p');
      await dropMade();
      assert.equal((await fenced()).ok, true);
      await h.resume();
    });

    test('WL-560: كاتبُ fence.control بـsession_user (‏0031) — دخولٌ حقيقيٌّ لعضوِ xf_owner وحدَه، ومعه xf_root، ومعه xf_sovereign؛ والمسارُ المشروعُ يبقى', async (t) => {
      await h.root.halt('wl560-writer', { effects: NO_EFFECTS });
      assert.equal(await state(), 'HALTED');
      // ‏ثلاثةُ أدوارِ دخولٍ حقيقيّة (‏لا SET SESSION AUTHORIZATION من superuser — فذاك يسمحُ بتبديلِ الهويّةِ لاحقاً).
      /** @type {Record<string, string>} */
      const pw = {};
      for (const [name, extra] of /** @type {const} */ ([
        ['zz_wl560_p', []],
        ['zz_wl560_r', ['xf_root']],
        ['zz_wl560_s', ['xf_sovereign']],
      ])) {
        await mk(name, true);
        pw[name] = `wl560-${Math.random().toString(36).slice(2)}-${Date.now()}`;
        await su(`ALTER ROLE ${quoteIdent(name)} PASSWORD '${pw[name]}'`);
        await su(`GRANT CONNECT ON DATABASE ${quoteIdent(h.db.name)} TO ${quoteIdent(name)}`);
        await su(`GRANT xf_owner TO ${quoteIdent(name)} WITH INHERIT FALSE, SET TRUE`);
        for (const r of extra) await su(`GRANT ${r} TO ${quoteIdent(name)}`);
      }
      /** @param {string} name */
      const login = async (name) => {
        const u = new URL(String(process.env['DATABASE_URL']));
        u.username = name;
        u.password = String(pw[name]);
        u.pathname = `/${h.db.name}`;
        const c = new pg.Client({ connectionString: u.toString() });
        await c.connect();
        return c;
      };
      /** @param {pg.Client} c @param {Array<[string, string]>} steps */
      const run = async (c, steps) => {
        /** @type {Record<string, string>} */
        const out = {};
        await c.query('BEGIN');
        for (const [k, sql] of steps) {
          await c.query('SAVEPOINT p');
          try {
            const r = await c.query(sql);
            out[k] = r.rows?.[0]?.v === undefined ? 'OK' : String(r.rows[0].v);
            await c.query('RELEASE SAVEPOINT p');
          } catch (e) {
            out[k] = String(/** @type {any} */ (e).code);
            await c.query('ROLLBACK TO SAVEPOINT p');
          }
        }
        await c.query('ROLLBACK');
        return out;
      };
      const eff = `SELECT fence.effective_state()->>'state' AS v`;
      /** @type {pg.Client[]} */
      const clients = [];
      try {
        const p = await login('zz_wl560_p');
        clients.push(p);
        const gotP = await run(p, [
          ['session_user', 'SELECT session_user::text AS v'],
          ['set_role', 'SET ROLE xf_owner'],
          ['current_user', 'SELECT current_user::text AS v'],
          ['takeover_state', `UPDATE fence.control SET state = 'RUNNING', epoch = epoch + 1`],
          ['takeover_reseal', 'SELECT fence._reseal()'],
          ['same_state_write', 'UPDATE fence.control SET seal = seal'],
          [
            'restrictive_write',
            `UPDATE fence.control SET state = 'HALT_REQUESTED', epoch = epoch + 1`,
          ],
          ['lease_field_write', 'UPDATE fence.control SET lease_window_s = lease_window_s + 1'],
          ['second_row_insert', 'INSERT INTO fence.control SELECT * FROM fence.control'],
          ['effective', eff],
          ['grant_root_self', 'GRANT xf_root TO zz_wl560_p'],
          ['grant_sovereign_self', 'GRANT xf_sovereign TO zz_wl560_p'],
          ['alter_sovereign', `ALTER ROLE xf_sovereign PASSWORD 'x'`],
          ['disable_trigger', 'ALTER TABLE fence.control DISABLE TRIGGER xf_control_row'],
          [
            'replace_guard',
            `CREATE OR REPLACE FUNCTION fence._control_guard() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RETURN NEW; END$$`,
          ],
          ['replica_role', 'SET session_replication_role = replica'],
          ['reset_role', 'RESET ROLE'],
          ['session_auth_sovereign', 'SET SESSION AUTHORIZATION xf_sovereign'],
          // ‏بقايا مقيسةٌ لا يُغلِقُها 0031 (‏ملكيّةُ جداولِ fence الأخرى، وقفلُ الصفّ) — 0032 يُغلِقُ الكتابةَ (‏XF107) لا القفل:
          ['set_role_again', 'SET ROLE xf_owner'],
          [
            'residual_lease_update',
            `UPDATE fence.run_lease SET expires_at = expires_at + interval '1 year'`,
          ],
          ['residual_credentials_update', `UPDATE fence.credentials SET revoked_at = revoked_at`],
          ['residual_control_lock', 'SELECT 1 AS v FROM fence.control FOR UPDATE NOWAIT'],
        ]);
        assert.deepEqual(gotP, {
          session_user: 'zz_wl560_p',
          set_role: 'OK',
          current_user: 'xf_owner',
          takeover_state: 'XF105',
          takeover_reseal: 'XF105',
          same_state_write: 'XF105',
          restrictive_write: 'XF105',
          lease_field_write: 'XF105',
          second_row_insert: 'XF105',
          effective: 'HALTED',
          grant_root_self: '42501',
          grant_sovereign_self: '42501',
          alter_sovereign: '42501',
          disable_trigger: 'XF202',
          replace_guard: 'XF202',
          replica_role: '42501',
          reset_role: 'OK',
          session_auth_sovereign: '42501',
          set_role_again: 'OK',
          residual_lease_update: 'XF107',
          residual_credentials_update: 'XF107',
          residual_control_lock: '1',
        });
        for (const name of ['zz_wl560_r', 'zz_wl560_s']) {
          const c = await login(name);
          clients.push(c);
          const got = await run(c, [
            [
              'direct_without_owner',
              `UPDATE fence.control SET state = 'RUNNING', epoch = epoch + 1`,
            ],
            ['set_role', 'SET ROLE xf_owner'],
            ['takeover_state', `UPDATE fence.control SET state = 'RUNNING', epoch = epoch + 1`],
            [
              'pubkey_write',
              `UPDATE fence.control SET sovereign_pubkey = decode(repeat('00', 32), 'hex')`,
            ],
            ['lease_field_write', 'UPDATE fence.control SET lease_window_s = lease_window_s + 1'],
            // ‏صفٌّ ثانٍ: XF106 قبلَ XF101 — العضوُ لا يُدرِجُ أصلاً (‏ولو كان الجدولُ فارغاً).
            ['second_row_insert', 'INSERT INTO fence.control SELECT * FROM fence.control'],
            ['reseal_same', 'SELECT fence._reseal()'],
            [
              'restrictive_write',
              `UPDATE fence.control SET state = 'HALT_REQUESTED', epoch = epoch + 1`,
            ],
            // ‏كتابةٌ خامٌ بلا ختمٍ ⇒ الختمُ لا يطابقُ ⇒ RECOVERY_REQUIRED (‏أشدُّ تقييداً)؛ ثمّ الختمُ المشروعُ ⇒ HALT_REQUESTED.
            ['effective_unsealed', eff],
            ['reseal_restrictive', 'SELECT fence._reseal()'],
            ['effective_after', eff],
          ]);
          assert.deepEqual(
            got,
            {
              direct_without_owner: '42501',
              set_role: 'OK',
              takeover_state: 'XF106',
              pubkey_write: 'XF106',
              lease_field_write: 'XF106',
              second_row_insert: 'XF106',
              reseal_same: 'OK',
              // ‏الإيقافُ يبقى ممكناً لجذرٍ أو سياديٍّ ولو كان عضواً (‏الكشفُ يُبقيه HALT_REQUESTED كما في 0028).
              restrictive_write: 'OK',
              effective_unsealed: 'RECOVERY_REQUIRED',
              reseal_restrictive: 'OK',
              effective_after: 'HALT_REQUESTED',
            },
            name,
          );
        }
        t.diagnostic(
          `owner-only: XF105 ×6; owner+root/sovereign: XF106 ×4; lease/credentials XF107 (0032); lock OK`,
        );
        assert.equal(await state(), 'HALTED', 'لا أثرَ باقٍ (‏كلُّه في معاملاتٍ أُرجِعت)');
      } finally {
        for (const c of clients) await c.end().catch(() => {});
        // ‏الأدوارُ عنقوديّة: تُزالُ ولو فشلَ الاختبار (‏منحُ CONNECT يمنعُ DROP ROLE فيُسحَبُ أوّلاً).
        for (const name of ['zz_wl560_p', 'zz_wl560_r', 'zz_wl560_s']) {
          await su(
            `REVOKE CONNECT ON DATABASE ${quoteIdent(h.db.name)} FROM ${quoteIdent(name)}`,
          ).catch(() => {});
        }
        await dropMade();
      }
      assert.equal((await fenced()).ok, true);
      // ‏المسارُ المشروع: RESUME موقَّعٌ من السياديّ (‏عبرَ _control_guard نفسِه) ⇒ RUNNING.
      await h.resume();
      assert.equal(await state(), 'RUNNING');
    });

    test('WL-561: كاتبُ جداولِ fence الأخرى بـsession_user (‏0032) — عضوُ xf_owner وحدَه لا يكتبُ الإيجارَ ولا الاعتمادَ ولا القائمةَ ولا البيانَ ولا الأحداث (‏XF107)؛ والجذرُ والسياديُّ العضوان بقيّةٌ مُعلَنة؛ والمسارُ المشروعُ يبقى', async (t) => {
      await h.root.halt('wl561-writer', { effects: NO_EFFECTS });
      assert.equal(await state(), 'HALTED');
      // ‏ثلاثةُ أدوارِ دخولٍ حقيقيّة (‏لا SET SESSION AUTHORIZATION من superuser — فذاك يسمحُ بتبديلِ الهويّةِ لاحقاً).
      /** @type {Record<string, string>} */
      const pw = {};
      for (const [name, extra] of /** @type {const} */ ([
        ['zz_wl561_p', []],
        ['zz_wl561_r', ['xf_root']],
        ['zz_wl561_s', ['xf_sovereign']],
      ])) {
        await mk(name, true);
        pw[name] = `wl561-${Math.random().toString(36).slice(2)}-${Date.now()}`;
        await su(`ALTER ROLE ${quoteIdent(name)} PASSWORD '${pw[name]}'`);
        await su(`GRANT CONNECT ON DATABASE ${quoteIdent(h.db.name)} TO ${quoteIdent(name)}`);
        await su(`GRANT xf_owner TO ${quoteIdent(name)} WITH INHERIT FALSE, SET TRUE`);
        for (const r of extra) await su(`GRANT ${r} TO ${quoteIdent(name)}`);
      }
      /** @param {string} name */
      const login = async (name) => {
        const u = new URL(String(process.env['DATABASE_URL']));
        u.username = name;
        u.password = String(pw[name]);
        u.pathname = `/${h.db.name}`;
        const c = new pg.Client({ connectionString: u.toString() });
        await c.connect();
        return c;
      };
      /** @param {pg.Client} c @param {Array<[string, string]>} steps */
      const run = async (c, steps) => {
        /** @type {Record<string, string>} */
        const out = {};
        await c.query('BEGIN');
        for (const [k, sql] of steps) {
          await c.query('SAVEPOINT p');
          try {
            const r = await c.query(sql);
            out[k] = r.rows?.[0]?.v === undefined ? 'OK' : String(r.rows[0].v);
            await c.query('RELEASE SAVEPOINT p');
          } catch (e) {
            out[k] = String(/** @type {any} */ (e).code);
            await c.query('ROLLBACK TO SAVEPOINT p');
          }
        }
        await c.query('ROLLBACK');
        return out;
      };
      /** @type {pg.Client[]} */
      const clients = [];
      try {
        const p = await login('zz_wl561_p');
        clients.push(p);
        const gotP = await run(p, [
          ['set_role', 'SET ROLE xf_owner'],
          ['current_user', 'SELECT current_user::text AS v'],
          [
            'lease_update',
            `UPDATE fence.run_lease SET expires_at = expires_at + interval '1 year'`,
          ],
          ['lease_insert', 'INSERT INTO fence.run_lease SELECT * FROM fence.run_lease'],
          ['lease_delete', 'DELETE FROM fence.run_lease'],
          ['lease_truncate', 'TRUNCATE fence.run_lease'],
          ['credentials_update', 'UPDATE fence.credentials SET revoked_at = revoked_at'],
          ['roster_insert', 'INSERT INTO fence.roster SELECT * FROM fence.roster'],
          ['roster_delete', 'DELETE FROM fence.roster'],
          ['manifest_update', 'UPDATE fence.manifest SET digest = digest'],
          ['events_insert', 'INSERT INTO fence.events SELECT * FROM fence.events WHERE false'],
          ['heartbeat_delete', 'DELETE FROM fence.reaper_heartbeat'],
          ['challenges_delete', 'DELETE FROM fence.challenges'],
          ['halt_requests_delete', 'DELETE FROM fence.halt_requests'],
          ['drop_trigger', 'DROP TRIGGER xf_owner_writer ON fence.run_lease'],
          ['disable_trigger', 'ALTER TABLE fence.run_lease DISABLE TRIGGER xf_owner_writer'],
          [
            'replace_guard',
            `CREATE OR REPLACE FUNCTION fence._table_writer_guard() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RETURN NULL; END$$`,
          ],
          // ‏ليس كتابة: القفلُ بقيّةُ توفّرٍ مُعلَنة.
          [
            'residual_lease_lock',
            'SELECT count(*)::text AS v FROM (SELECT 1 FROM fence.run_lease FOR UPDATE NOWAIT) x',
          ],
        ]);
        assert.deepEqual(gotP, {
          set_role: 'OK',
          current_user: 'xf_owner',
          lease_update: 'XF107',
          lease_insert: 'XF107',
          lease_delete: 'XF107',
          lease_truncate: 'XF107',
          credentials_update: 'XF107',
          roster_insert: 'XF107',
          roster_delete: 'XF107',
          manifest_update: 'XF107',
          events_insert: 'XF107',
          heartbeat_delete: 'XF107',
          challenges_delete: 'XF107',
          halt_requests_delete: 'XF107',
          drop_trigger: 'XF202',
          disable_trigger: 'XF202',
          replace_guard: 'XF202',
          residual_lease_lock: '0',
        });
        for (const name of ['zz_wl561_r', 'zz_wl561_s']) {
          const c = await login(name);
          clients.push(c);
          const got = await run(c, [
            ['direct_without_owner', 'DELETE FROM fence.run_lease'],
            ['set_role', 'SET ROLE xf_owner'],
            // ‏بقيّةٌ مُعلَنة: الجذرُ أو السياديُّ العضوُ يكتبُ (‏لا تمييزَ في الجداول بين تقييديٍّ وموسِّع).
            ['residual_lease_delete', 'DELETE FROM fence.run_lease'],
            ['residual_credentials_update', 'UPDATE fence.credentials SET revoked_at = revoked_at'],
          ]);
          assert.deepEqual(
            got,
            {
              direct_without_owner: '42501',
              set_role: 'OK',
              residual_lease_delete: 'OK',
              residual_credentials_update: 'OK',
            },
            name,
          );
        }
        t.diagnostic('owner-only: XF107 ×12, XF202 ×3; owner+root/sovereign: residual write OK');
        assert.equal(await state(), 'HALTED', 'لا أثرَ باقٍ (‏كلُّه في معاملاتٍ أُرجِعت)');
      } finally {
        for (const c of clients) await c.end().catch(() => {});
        for (const name of ['zz_wl561_p', 'zz_wl561_r', 'zz_wl561_s']) {
          await su(
            `REVOKE CONNECT ON DATABASE ${quoteIdent(h.db.name)} FROM ${quoteIdent(name)}`,
          ).catch(() => {});
        }
        await dropMade();
      }
      assert.equal((await fenced()).ok, true);
      // ‏المسارُ المشروعُ لا يتغيّر: RESUME موقَّعٌ (‏يكتبُ fence.* عبرَ SECURITY DEFINER) ⇒ RUNNING.
      await h.resume();
      assert.equal(await state(), 'RUNNING');
      // ‏والعاملُ (‏ليس عضواً في xf_owner): تحدٍّ واعتمادٌ وختمُ جلسةٍ وإيجار — يكتبُ challenges/credentials/run_lease
      // ‏بـsession_user نفسِه، فلا يمسُّه الحارس؛ ثمّ يجدّدُه الجذرُ (‏renew_lease).
      const w = await h.boot('alpha');
      assert.ok(w.client !== null && w.sealed !== null, 'العاملُ يُقلِعُ ويُختَم');
      const role = String(w.credential.role_name);
      const lease = await su(
        'SELECT count(*)::int AS n FROM fence.run_lease WHERE role_name = $1',
        [role],
      );
      assert.equal(lease.rows[0].n, 1, 'إيجارُ العاملِ مكتوب');
      const renewed = await h.rootClient.query('SELECT fence.renew_lease($1) AS e', [role]);
      assert.ok(renewed.rows[0].e !== null, 'الجذرُ يجدّدُ الإيجار');
    });
  },
);

// ── WL-558: الحاصدُ الدائم (‏0030) — العضويّةُ المتعدّيةُ بلا حدِّ عمق، والنبضُ المربوطُ بالجلسة، والصحّة، وNOTIFY/LISTEN ──
describe(
  'WL-558: xf_reaper وبابُه fence.reaper_tick (‏0030)',
  { skip: skipWithoutDatabase },
  () => {
    /** @type {Awaited<ReturnType<typeof harness>>} */
    let h;
    before(async () => {
      h = await harness('wl558');
    });
    after(async () => h?.close());
    const A = '00000000-0000-4000-8000-0000000000a1';
    const B = '00000000-0000-4000-8000-0000000000b2';
    /** @param {pg.Client} c @param {string} inst @param {number} [ceil] @param {number} [qt] */
    const tick = async (c, inst, ceil = 1000, qt = 2000) =>
      /** @type {Record<string, any>} */ (
        (await c.query('SELECT fence.reaper_tick($1, $2, $3) AS r', [inst, ceil, qt])).rows[0].r
      );
    /** @param {number} [slack] */
    const health = async (slack = 1000) =>
      /** @type {Record<string, any>} */ (
        (await h.rootClient.query('SELECT fence.reaper_health($1) AS r', [slack])).rows[0].r
      );
    /** صفُّ النسخة، والعدّاداتُ (‏bigint) أعداداً. @param {string} inst */
    const beat = async (inst) => {
      const r = (
        await h.db.pool.query('SELECT * FROM fence.reaper_heartbeat WHERE instance = $1', [inst])
      ).rows[0];
      for (const k of ['ticks', 'ok_ticks', 'failed_ticks', 'reaped_total', 'connects'])
        r[k] = Number(r[k]);
      return r;
    };
    const problems = async () =>
      /** @type {Array<Record<string, any>>} */ (
        (await h.rootClient.query('SELECT fence.reaper_capability_problems() AS r')).rows[0].r
      );
    const memberships = async () =>
      /** @type {Array<Record<string, any>>} */ (
        (await h.rootClient.query('SELECT fence.reaper_capabilities() AS r')).rows[0].r
      ).filter((x) => x.axis === 'membership');
    /** @param {string[]} roles */
    const dropRoles = async (roles) => {
      for (const r of roles) await h.db.pool.query(`DROP ROLE IF EXISTS ${quoteIdent(r)}`);
    };
    /**
     * يُغلِقُ الوصلاتِ وينتظرُ زوالَ خوادمِها بأرقامِها — خادمٌ يتأخّرُ موتُه يُحتسَبُ «غيرَ مربوط» فيما يلي.
     * @param {pg.Client[]} cs
     */
    const ends = async (...cs) => {
      const pids = cs.map((c) => Number(/** @type {any} */ (c).processID)).filter((x) => x > 0);
      for (const c of cs) await c.end().catch(() => {});
      const until = Date.now() + 5000;
      while (Date.now() < until) {
        const n = (
          await h.db.pool.query(
            'SELECT count(*)::int AS n FROM pg_stat_activity WHERE pid = ANY($1::int[])',
            [pids],
          )
        ).rows[0].n;
        if (n === 0) return;
        await new Promise((res) => setTimeout(res, 20));
      }
      assert.fail(`خوادمُ ${pids.join(',')} لم تزل خلال 5 ث`);
    };

    test('السليم: لا مشكلةَ امتياز، وcheck_fenced سليم، والاستئنافُ يمضي — وما لا يملكُه xf_reaper مرفوضٌ (‏42501) لا مخفيّ', async () => {
      assert.deepEqual(await problems(), []);
      const cf = (await h.rootClient.query('SELECT fence.check_fenced() AS r')).rows[0].r;
      assert.deepEqual(
        cf.problems.filter((/** @type {any} */ p) => String(p.kind).startsWith('reaper_')),
        [],
      );
      const c = await h.login('xf_reaper');
      try {
        for (const sql of [
          `INSERT INTO fence.reaper_heartbeat (instance, backend_pid, backend_start, ceiling_ms, query_timeout_ms,
           first_tick_at, last_tick_at, ticks, ok_ticks, failed_ticks, reaped_total, connects, last_result)
         VALUES (gen_random_uuid(), 1, now(), 1, 2000, now(), now(), 1, 1, 0, 0, 1, '{}')`,
          'SELECT fence.reaper_health()',
          'SELECT fence.reap_lapsed()',
          'SELECT fence._reap_lapsed()',
          'SELECT fence.reaper_capabilities()',
          `SELECT pg_notify('x', 'y')`,
          'SELECT count(*) FROM state.fence_probe',
        ])
          assert.equal((await rejection(() => c.query(sql)))?.code, '42501', sql);
        assert.equal(
          (
            await rejection(() =>
              h.rootClient.query('SELECT fence.reaper_tick($1, 1000, 2000)', [A]),
            )
          )?.code,
          '42501',
        );
        assert.equal(
          (await rejection(() => h.db.pool.query('SELECT fence.reaper_tick($1, 1000, 2000)', [A])))
            ?.code,
          'XF520',
          'superuser يملكُ EXECUTE لكنّ البابَ لدخولِ xf_reaper وحدَه',
        );
        assert.equal(
          (await h.db.pool.query('SELECT count(*)::int AS n FROM fence.reaper_heartbeat')).rows[0]
            .n,
          0,
        );
      } finally {
        await ends(c);
      }
    });

    test('العضويّةُ المتعدّية بلا حدٍّ ثابت: سلاسلُ 17 و18 و32 في الاتّجاهَين (‏إلى xf_owner ومن دورِ دخول) ⇒ مكشوفةٌ بعمقِها، وcheck_fenced يرفض', async () => {
      for (const n of [17, 18, 32]) {
        const up = Array.from({ length: n }, (_, i) => `wl558_up${n}_${i + 1}`);
        const dn = Array.from({ length: n }, (_, i) => `wl558_dn${n}_${i + 1}`);
        try {
          for (const r of [...up, ...dn]) await h.db.pool.query(`CREATE ROLE ${r} NOLOGIN`);
          await h.db.pool.query(`ALTER ROLE ${dn[n - 1]} LOGIN`);
          // ‏xf_reaper ∈ up1 ∈ up2 … ∈ up_n ∈ xf_owner: n + 1 حافّة.
          await h.db.pool.query(`GRANT ${up[0]} TO xf_reaper`);
          for (let i = 0; i < n - 1; i++) await h.db.pool.query(`GRANT ${up[i + 1]} TO ${up[i]}`);
          await h.db.pool.query(`GRANT xf_owner TO ${up[n - 1]}`);
          // ‏dn_n (‏دخول) ∈ … ∈ dn1 ∈ xf_reaper: n حافّة.
          await h.db.pool.query(`GRANT xf_reaper TO ${dn[0]}`);
          for (let i = 0; i < n - 1; i++) await h.db.pool.query(`GRANT ${dn[i]} TO ${dn[i + 1]}`);
          const m = await memberships();
          const owner = m.find((x) => x.object === 'xf_reaper -> xf_owner');
          assert.ok(owner, `${n}: xf_reaper -> xf_owner مكشوفة`);
          assert.equal(owner.detail.depth, n + 1);
          assert.equal(owner.detail.pg_has_role_member, true, 'وPG يراها عضويّةً فعلاً');
          assert.equal(owner.via, 'transitive');
          const login = m.find((x) => x.object === `${dn[n - 1]} -> xf_reaper`);
          assert.ok(login, `${n}: ${dn[n - 1]} -> xf_reaper مكشوفة`);
          assert.equal(login.detail.depth, n);
          assert.equal(login.detail.member_can_login, true);
          for (const r of [...up, ...dn])
            assert.equal(m.filter((x) => String(x.object).split(' -> ').includes(r)).length, 1, r);
          const p = await problems();
          assert.ok(
            p.some((x) => x.kind === 'reaper_membership' && x.object === 'xf_reaper -> xf_owner'),
          );
          assert.ok(
            p.some(
              (x) => x.kind === 'reaper_membership' && x.object === `${dn[n - 1]} -> xf_reaper`,
            ),
          );
          const cf = (await h.rootClient.query('SELECT fence.check_fenced() AS r')).rows[0].r;
          assert.equal(cf.ok, false);
          assert.ok(cf.problems.some((/** @type {any} */ x) => x.kind === 'reaper_membership'));
          assert.equal((await health()).privileges_intact, false);
        } finally {
          await dropRoles([...up, ...dn]);
        }
        assert.deepEqual(await problems(), [], `${n}: السحبُ ⇒ سليم`);
      }
    });

    test('المخطّطاتُ المتفرّعة: ماسةٌ ومساراتٌ متعدّدةٌ بأطوالٍ مختلفة ⇒ كلُّ هدفٍ مرّةً واحدةً بأقصرِ عمق؛ والدورةُ يرفضُها PG (‏0LP01)', async () => {
      const R = ['wl558_a', 'wl558_b', 'wl558_c', 'wl558_d', 'wl558_e', 'wl558_f'];
      try {
        for (const r of R) await h.db.pool.query(`CREATE ROLE ${r} NOLOGIN`);
        // ‏ماسة: reaper ∈ a، reaper ∈ b، a ∈ c، b ∈ c، c ∈ d. ومسارٌ طويلٌ إلى f: d ∈ e ∈ f، ومسارٌ قصيرٌ: a ∈ f.
        for (const [g, m] of [
          ['wl558_a', 'xf_reaper'],
          ['wl558_b', 'xf_reaper'],
          ['wl558_c', 'wl558_a'],
          ['wl558_c', 'wl558_b'],
          ['wl558_d', 'wl558_c'],
          ['wl558_e', 'wl558_d'],
          ['wl558_f', 'wl558_e'],
          ['wl558_f', 'wl558_a'],
        ])
          await h.db.pool.query(`GRANT ${g} TO ${m}`);
        const m = await memberships();
        const depth = Object.fromEntries(
          m
            .filter((x) => x.detail.direction === 'member_of')
            .map((x) => [x.object.split(' -> ')[1], x.detail.depth]),
        );
        assert.deepEqual(depth, {
          wl558_a: 1,
          wl558_b: 1,
          wl558_c: 2,
          wl558_d: 3,
          wl558_e: 4,
          wl558_f: 2,
        });
        assert.equal(m.length, 6, 'لا تكرارَ بتعدّدِ المسارات');
        const cyc = await rejection(() => h.db.pool.query('GRANT wl558_d TO wl558_f'));
        assert.ok(cyc, 'الدورةُ مرفوضة');
        assert.equal(cyc.code, '0LP01');
        assert.equal(
          (await rejection(() => h.db.pool.query('GRANT xf_reaper TO wl558_f')))?.code,
          '0LP01',
          'دورةٌ عبرَ xf_reaper نفسِه مرفوضة',
        );
      } finally {
        await dropRoles([...R].reverse());
      }
      assert.deepEqual(await memberships(), []);
    });

    test('الامتيازُ جزءٌ من الصحّة: نبضٌ طازجٌ مربوطٌ ناجحٌ ومنحٌ زائدٌ لـxf_reaper ⇒ غيرُ سليمٍ بـprivileges_intact = false؛ والسحبُ يُعيدُه سليماً', async () => {
      const C = '00000000-0000-4000-8000-0000000000c3';
      const c = await h.login('xf_reaper');
      try {
        assert.equal((await tick(c, C)).ok, true);
        assert.equal((await health()).healthy, true);
        await h.db.pool.query('GRANT SELECT ON fence.control TO xf_reaper');
        assert.equal((await tick(c, C)).ok, true, 'الحصادُ نفسُه ينجح');
        const bad = await health();
        assert.deepEqual(
          [bad.healthy, bad.privileges_intact, bad.tick_succeeded, bad.db_connected],
          [false, false, true, true],
          JSON.stringify(bad),
        );
        assert.ok(
          bad.privilege_problems.some(
            (/** @type {any} */ x) => x.object === 'fence.control' && x.privilege === 'SELECT',
          ),
          JSON.stringify(bad.privilege_problems),
        );
        await h.db.pool.query('REVOKE SELECT ON fence.control FROM xf_reaper');
        assert.equal((await tick(c, C)).ok, true);
        assert.equal((await health()).healthy, true);
      } finally {
        await h.db.pool.query('REVOKE ALL ON fence.control FROM xf_reaper');
        await c.end();
        await ends(c);
      }
    });

    test('النبضُ المربوط: نسخةٌ واحدةٌ موصولةٌ ⇒ سليم؛ جلسةٌ غيرُ مربوطة، ونسختان، وربطٌ متعارض (‏XF522) ⇒ غيرُ سليم؛ وإعادةُ الاتصالِ تستلمُ النسخة', async () => {
      const c1 = await h.login('xf_reaper');
      /** @type {pg.Client[]} */
      const opened = [c1];
      try {
        const r = await tick(c1, A);
        assert.equal(r.ok, true);
        let hl = await health();
        assert.equal(hl.healthy, true, JSON.stringify(hl));
        assert.deepEqual(
          [
            hl.db_connected,
            hl.tick_attempted,
            hl.tick_succeeded,
            hl.privileges_intact,
            hl.process_alive_observable,
          ],
          [true, true, true, true, false],
        );
        const b1 = await beat(A);
        assert.equal(b1.backend_pid, (await c1.query('SELECT pg_backend_pid() AS p')).rows[0].p);
        assert.deepEqual([b1.ticks, b1.ok_ticks, b1.failed_ticks, b1.connects], [1, 1, 0, 1]);
        // ‏جلسةٌ ثانيةٌ بلا نبض.
        const c2 = await h.login('xf_reaper');
        opened.push(c2);
        hl = await health();
        assert.equal(hl.healthy, false);
        assert.equal(hl.anomalies.unbound_reaper_sessions, 1);
        // ‏الثانيةُ تنتحلُ النسخةَ A والأولى حيّة ⇒ XF522 بلا نبض؛ والأولى لا تنبضُ بنسخةٍ ثانية.
        assert.equal((await rejection(() => tick(c2, A)))?.code, 'XF522');
        assert.equal((await rejection(() => tick(c1, B)))?.code, 'XF522');
        assert.equal((await beat(A)).ticks, 1);
        // ‏نسختان موصولتان ⇒ غيرُ سليم.
        assert.equal((await tick(c2, B)).ok, true);
        hl = await health();
        assert.equal(hl.healthy, false);
        assert.deepEqual(
          [hl.anomalies.connected_instances, hl.anomalies.unbound_reaper_sessions],
          [2, 0],
        );
        // ‏حدُّ الاتصالِ 2: ثالثةٌ مرفوضة.
        assert.equal((await rejection(() => h.login('xf_reaper')))?.code, '53300');
        await ends(c2);
        await h.db.pool.query('SELECT pg_stat_clear_snapshot()');
        const wait = Date.now() + 5000;
        while ((await health()).anomalies.connected_instances !== 1 && Date.now() < wait)
          await new Promise((res) => setTimeout(res, 50));
        assert.equal(
          (await health()).healthy,
          true,
          'الثانيةُ ماتت: صفُّها غيرُ موصولٍ لا يُحتسَب',
        );
        // ‏إعادةُ الاتصال: الأولى تموت، وجلسةٌ جديدةٌ تستلمُ A (‏connects = 2).
        await ends(c1);
        const w2 = Date.now() + 5000;
        while ((await health()).anomalies.connected_instances !== 0 && Date.now() < w2)
          await new Promise((res) => setTimeout(res, 50));
        hl = await health();
        assert.deepEqual([hl.healthy, hl.db_connected], [false, false], 'بلا جلسة: غيرُ سليم');
        const c3 = await h.login('xf_reaper');
        opened.push(c3);
        assert.equal((await tick(c3, A)).ok, true);
        const b2 = await beat(A);
        assert.deepEqual([b2.ticks, b2.connects], [2, 2]);
        assert.equal(b2.backend_pid, (await c3.query('SELECT pg_backend_pid() AS p')).rows[0].p);
        assert.equal((await health()).healthy, true);
      } finally {
        await ends(...opened);
        await h.db.pool.query('DELETE FROM fence.reaper_heartbeat');
      }
    });

    test('المهلة: العتبةُ = ceiling + 2 × query_timeout + slack (‏حدّاها بدقّة)، والمعاملاتُ خارجَ حدودِها XF521، والساعةُ الشاذّةُ غيرُ سليمة', async () => {
      const c = await h.login('xf_reaper');
      try {
        for (const [ceil, qt] of [
          [0, 2000],
          [300001, 2000],
          [1000, 1999],
          [1000, 300001],
        ])
          assert.equal(
            (await rejection(() => tick(c, A, ceil, qt)))?.code,
            'XF521',
            `${ceil}/${qt}`,
          );
        assert.equal((await tick(c, A, 1000, 2000)).ok, true);
        const hl = await health(1000);
        assert.equal(hl.instances[0].stale_after_ms, 6000);
        const at = async (/** @type {number} */ agoMs) => {
          await h.db.pool.query(
            `UPDATE fence.reaper_heartbeat SET last_tick_at = clock_timestamp() - make_interval(secs => $1 / 1000.0),
             last_ok_at = clock_timestamp() - make_interval(secs => $1 / 1000.0),
             first_tick_at = clock_timestamp() - interval '1 hour'`,
            [agoMs],
          );
          return health(1000);
        };
        let x = await at(5500);
        assert.equal(x.healthy, true, `داخلَ العتبة: ${JSON.stringify(x)}`);
        x = await at(6500);
        assert.equal(x.healthy, false, 'بعدَ العتبة');
        assert.equal(x.anomalies.stale_connected_instances, 1);
        assert.deepEqual([x.db_connected, x.tick_attempted], [true, false]);
        x = await at(-5000);
        assert.equal(x.healthy, false, 'نبضٌ من المستقبل');
        assert.equal(x.anomalies.clock_anomaly_instances, 1);
        assert.equal(
          (await rejection(() => h.rootClient.query('SELECT fence.reaper_health(-1)')))?.code,
          '22023',
        );
      } finally {
        await ends(c);
        await h.db.pool.query('DELETE FROM fence.reaper_heartbeat');
      }
    });

    test('فشلُ الحصاد: قفلٌ ممسوكٌ ⇒ نبضةٌ فاشلةٌ مُسجَّلةٌ (‏55P03) بلا last_ok_at وغيرُ سليم؛ وإلغاءُ النداءِ (‏57014) لا يكتبُ نبضاً؛ وإعداداتُ الدورِ XF523', async () => {
      const c = await h.login('xf_reaper');
      const locker = await h.db.pool.connect();
      try {
        assert.equal((await tick(c, A)).ok, true);
        const ok1 = await beat(A);
        await locker.query('BEGIN');
        await locker.query('LOCK TABLE fence.credentials IN ACCESS EXCLUSIVE MODE');
        const r = await tick(c, A);
        assert.equal(r.ok, false);
        assert.equal(r.tick_error.sqlstate, '55P03');
        const f = await beat(A);
        assert.deepEqual([f.ticks, f.ok_ticks, f.failed_ticks], [2, 1, 1]);
        assert.equal(
          f.last_ok_at.getTime(),
          ok1.last_ok_at.getTime(),
          'لا نجاحَ يُكتَبُ لحصادٍ فشل',
        );
        assert.ok(f.last_tick_at > ok1.last_tick_at);
        assert.equal(f.last_error.sqlstate, '55P03');
        const hl = await health();
        assert.deepEqual([hl.healthy, hl.tick_attempted, hl.tick_succeeded], [false, true, false]);
        // ‏مهلةُ النداءِ دونَ lock_timeout: الإلغاءُ لا تلتقطُه الكتلةُ الفرعيّة ⇒ لا نبض.
        await c.query(`SET statement_timeout = 300`);
        assert.equal((await rejection(() => tick(c, A)))?.code, '57014');
        await c.query('RESET statement_timeout');
        assert.equal((await beat(A)).ticks, 2, 'الإلغاءُ لم يكتب');
        await locker.query('ROLLBACK');
        assert.equal((await tick(c, A)).ok, true);
        assert.equal((await health()).healthy, true, 'التعافي بعدَ زوالِ القفل');
        await h.db.pool.query(`ALTER ROLE xf_reaper SET work_mem = '1MB'`);
        try {
          assert.equal((await rejection(() => tick(c, A)))?.code, 'XF523');
          assert.ok(
            (await problems()).some((p) => p.kind === 'reaper_role_setting'),
            JSON.stringify(await problems()),
          );
        } finally {
          await h.db.pool.query('ALTER ROLE xf_reaper RESET ALL');
        }
      } finally {
        await locker.query('ROLLBACK').catch(() => {});
        locker.release();
        await ends(c);
        await h.db.pool.query('DELETE FROM fence.reaper_heartbeat');
      }
    });

    test('البابُ يحصدُ فعلاً: اعتمادٌ انقضى إيجارُه يُلغى وتُنهى جلستُه عبرَ reaper_tick، والنبضُ يعدُّه؛ والصالحُ لا يُمَسّ', async () => {
      // ‏RESUME يمضي بـxf_reaper حاضراً (‏check_fenced سليمٌ بجردِه) — ثمّ إقلاعان.
      await h.resume();
      const c = await h.login('xf_reaper');
      const a = await h.boot('alpha');
      const b = await h.boot('beta');
      const ra = String(a.credential.role_name);
      const rb = String(b.credential.role_name);
      try {
        await h.db.pool.query(
          `UPDATE fence.run_lease SET expires_at = clock_timestamp() - interval '1 second' WHERE role_name = $1`,
          [ra],
        );
        const r = await tick(c, A);
        assert.equal(r.ok, true, JSON.stringify(r));
        assert.deepEqual(
          r.reaped.map((/** @type {any} */ x) => [x.role, x.reason, x.alive_after]),
          [[ra, 'expired', 0]],
        );
        assert.ok(
          await rejection(() => /** @type {pg.Client} */ (a.client).query('SELECT 1')),
          'الجلسةُ أُنهِيَت',
        );
        assert.equal(
          (await /** @type {pg.Client} */ (b.client).query('SELECT 1 AS x')).rows[0].x,
          1,
          'الصالحُ حيّ',
        );
        const st = (
          await h.db.pool.query(
            'SELECT status FROM fence.credentials WHERE role_name = ANY($1) ORDER BY role_name = $2 DESC',
            [[ra, rb], ra],
          )
        ).rows.map((x) => x.status);
        assert.deepEqual(st, ['REVOKED', 'ACTIVE']);
        const hb = await beat(A);
        assert.deepEqual([hb.reaped_total, hb.ok_ticks], [1, 1]);
        assert.equal(hb.last_result.reaped, 1);
      } finally {
        await ends(c);
        await h.db.pool.query('DELETE FROM fence.reaper_heartbeat');
      }
    });

    test('المتبقّي المُعلَن: xf_reaper يستطيعُ LISTEN وأمرَ NOTIFY فعلاً (‏لا امتيازَ يُسحَب) في هذه القاعدةِ وحدَها، وpg_notify مسحوبة', async () => {
      const r = await h.login('xf_reaper');
      const su = new pg.Client({
        connectionString: (() => {
          const u = new URL(process.env['DATABASE_URL'] ?? '');
          u.pathname = `/${h.db.name}`;
          return u.toString();
        })(),
      });
      su.on('error', () => {});
      await su.connect();
      try {
        /** @type {string[]} */
        const atReaper = [];
        /** @type {string[]} */
        const atSu = [];
        r.on('notification', (m) => atReaper.push(`${m.channel}:${m.payload}`));
        su.on('notification', (m) => atSu.push(`${m.channel}:${m.payload}`));
        await r.query('LISTEN wl558_in');
        await su.query('LISTEN wl558_out');
        await su.query(`NOTIFY wl558_in, 'to-reaper'`);
        await r.query(`NOTIFY wl558_out, 'from-reaper'`);
        await r.query('BEGIN');
        await r.query(`NOTIFY wl558_out, 'rolled-back'`);
        await r.query('ROLLBACK');
        await new Promise((res) => setTimeout(res, 150));
        await r.query('SELECT 1');
        await su.query('SELECT 1');
        assert.deepEqual(atReaper, ['wl558_in:to-reaper']);
        assert.deepEqual(atSu, ['wl558_out:from-reaper']);
        assert.equal(
          (await rejection(() => r.query(`SELECT pg_notify('wl558_out', 'x')`)))?.code,
          '42501',
        );
        // ‏لا قاعدةَ أخرى: CONNECT على postgres مسحوبٌ من PUBLIC بالاحتواء.
        assert.ok(await rejection(() => h.login('xf_reaper', { database: 'postgres' })));
        const s = (await h.rootClient.query('SELECT fence.notify_surface() AS s')).rows[0].s;
        assert.ok(JSON.stringify(s).includes('xf_reaper'), 'السطحُ يُسمّيه');
        assert.deepEqual(await problems(), [], 'المتبقّي مُعلَنٌ لا مشكلة');
      } finally {
        await ends(r, su);
      }
    });
  },
);
