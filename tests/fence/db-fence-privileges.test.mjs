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

    test('أثرُ العضويّة: لا تُمحى ولا يُخفى كشفُها، ودورُ دخولٍ يرثُ العاملَ يُكشَف؛ والاستيلاءُ المباشرُ متبقٍّ مُعلَنٌ مقيس', async () => {
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
        rewrite_events: 'XF104',
        grant_owner_onward: '42501',
        create_login_role: 'OK',
        grant_worker_to_rogue: 'OK',
        detects_rogue: 'true',
        detects_owner: 'true',
        takeover_state: 'OK',
        takeover_reseal: 'OK',
        takeover_effective: 'RUNNING',
      });
      const res = (await fenced()).residuals.find((r) => r.kind === 'owner_membership_detect_only');
      assert.ok(res && /قرارُ مالك/.test(res.note), 'المتبقّي مُعلَنٌ في check_fenced');
      await su('REVOKE xf_owner FROM zz_wl551_p');
      await dropMade();
      assert.equal((await fenced()).ok, true);
      await h.resume();
    });
  },
);
