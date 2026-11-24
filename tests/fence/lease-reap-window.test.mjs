/**
 * نافذةُ انقضاءِ الإيجارِ والحصاد (‏`WL-545`) — حاصدٌ مستقلٌّ يُنادى عندَ موعدِ القاعدة (‏`0027_fence_reap_deadline`).
 *
 * فُصِلَ عن `tests/fence/db-fence.test.mjs` لأنّه يقيسُ بساعةٍ حقيقيّة (‏نافذةُ إيجارٍ 5 ث، الحدُّ الأدنى لـ`lease_set`):
 * نحوُ 40 ث تُجاوِزُ بالملفِّ هناك مهلةَ الملفِّ الواحد (‏`--test-timeout=120000`). الحزامُ وحدودُه كما في ذلك الملف.
 */

import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { startLapseReaper } from '../../src/fence/db-fence.mjs';
import { down as migratorDown, up as migratorUp } from '../../src/persistence/migrator.mjs';
import { skipWithoutDatabase } from '../helpers/pg.mjs';
import { NO_EFFECTS, harness, rejection, rejectsWith } from '../helpers/fence-harness.mjs';

// ── WL-545: نافذةُ الانقضاءِ والحصاد — حاصدٌ مستقلٌّ بموعدِ القاعدة ───────────────────────────
// قبلَ الإصلاح (‏مقيسٌ على db8de990، نافذةٌ حقيقيّةٌ 5 ث): لا يُنادى reap_lapsed إلا عندَ رفضِ التجديدِ أو الإيقافِ أو
// المصافحة؛ فعمليّةُ جذرٍ ماتت (‏ومعها حافظُ الإيجار) أو حارسٌ محلّيٌّ أوقفَ الحافظَ تُبقي الاعتمادَ ACTIVE والجلسةَ
// حيّةً تُرسِلُ NOTIFY بعدَ الانقضاءِ بلا حدّ.

describe('WL-545: startLapseReaper (‏بلا قاعدة — حاصدٌ مزيّف)', () => {
  /** @param {Array<any>} script */
  const fake = (script) => {
    const calls = /** @type {number[]} */ ([]);
    const t0 = Date.now();
    return {
      calls,
      reapLapsed: async () => {
        calls.push(Date.now() - t0);
        const next = script.length > 1 ? script.shift() : script[0];
        if (next instanceof Error) throw next;
        return next;
      },
    };
  };
  const ok = (/** @type {number | null | undefined} */ due) => ({
    ok: true,
    reaped: [],
    unresolved: [],
    ...(due === undefined ? {} : { next_due_ms: due }),
  });
  const wait = (/** @type {number} */ ms) => new Promise((r) => setTimeout(r, ms));

  // WL-548: صفرٌ كان مقبولاً (‏retryMs = 0 مع فشلٍ دائم، أو minDelayMs = 0 مع next_due_ms = 0) ⇒ نداءٌ بلا تباعد —
  // حلقةٌ ساخنةٌ على القاعدة. الحدُّ الأدنى 1 مث لكليهما.
  test('الخيارات: ceilingMs صحيحٌ موجب، وminDelayMs/retryMs بينَ 1 والسقف — وإلا TypeError', () => {
    const r = fake([ok(null)]);
    for (const o of [
      { ceilingMs: 0 },
      { ceilingMs: -1 },
      { ceilingMs: 1.5 },
      { ceilingMs: Infinity },
      { ceilingMs: 100, minDelayMs: 200 },
      { ceilingMs: 100, retryMs: -1 },
      { ceilingMs: 100, retryMs: 0 },
      { ceilingMs: 100, minDelayMs: 0 },
      { ceilingMs: 100, retryMs: 0, minDelayMs: 0 },
    ])
      assert.throws(
        () => {
          // قيمةٌ قُبِلت خطأً تُوقَفُ فوراً: الفشلُ يُبلَّغُ ولا يُعلِّقُ الملفَّ بمؤقِّتٍ حيّ.
          void startLapseReaper(r, /** @type {any} */ (o)).stop();
        },
        TypeError,
        JSON.stringify(o),
      );
    assert.equal(r.calls.length, 0, 'لا نداءَ بخياراتٍ مرفوضة');
  });

  test('يُنادي فوراً، ثمّ عندَ next_due_ms لا قبله ولا بعدَه بكثير', async () => {
    const r = fake([ok(120), ok(null)]);
    const k = startLapseReaper(r, { ceilingMs: 60_000 });
    await wait(400);
    await k.stop();
    assert.equal(r.calls.length, 2, JSON.stringify(r.calls));
    const [first, second] = /** @type {[number, number]} */ (r.calls);
    assert.ok(first < 50, `الأوّلُ فوراً: ${first}`);
    assert.ok(
      second - first >= 115 && second - first < 250,
      `الثاني عندَ الموعد: ${second - first}`,
    );
  });

  test('السقف: موعدٌ أبعدُ من ceilingMs، أو null، أو غائب (‏قاعدةٌ قبلَ 0027) ⇒ النداءُ التالي عندَ السقف', async () => {
    for (const due of [10_000_000, null, undefined]) {
      const r = fake([ok(due)]);
      const k = startLapseReaper(r, { ceilingMs: 100 });
      await wait(350);
      await k.stop();
      assert.ok(r.calls.length >= 3 && r.calls.length <= 5, `${due}: ${JSON.stringify(r.calls)}`);
    }
  });

  test('لا حلقةَ ساخنة: next_due_ms = 0 مكرّراً يُباعَدُ بـminDelayMs', async () => {
    const r = fake([ok(0)]);
    const k = startLapseReaper(r, { ceilingMs: 1000, minDelayMs: 50 });
    await wait(300);
    await k.stop();
    assert.ok(r.calls.length >= 4 && r.calls.length <= 8, JSON.stringify(r.calls));
  });

  test('الفشل: onError ثمّ إعادةٌ بعدَ retryMs — لا يتوقّفُ الحاصدُ ولا يُعلَنُ حصاد', async () => {
    const boom = new Error('db down');
    const r = fake([boom, boom, ok(null)]);
    const errors = /** @type {unknown[]} */ ([]);
    const reaps = /** @type {unknown[]} */ ([]);
    const k = startLapseReaper(r, {
      ceilingMs: 10_000,
      retryMs: 40,
      onError: (e) => errors.push(e),
      onReap: (x) => reaps.push(x),
    });
    await wait(250);
    await k.stop();
    assert.deepEqual(errors, [boom, boom]);
    assert.deepEqual(reaps, []);
    assert.equal(r.calls.length, 3, JSON.stringify(r.calls));
  });

  test('unresolved (‏جلسةٌ بقيت حيّة) ⇒ onReap بالنتيجةِ وإعادةٌ بعدَ retryMs لا انتظارُ الموعد', async () => {
    const bad = { ok: false, reaped: [{ role: 'xw_a' }], unresolved: ['xw_a'], next_due_ms: null };
    const r = fake([bad, ok(null)]);
    const reaps = /** @type {any[]} */ ([]);
    const k = startLapseReaper(r, { ceilingMs: 10_000, retryMs: 40, onReap: (x) => reaps.push(x) });
    await wait(200);
    await k.stop();
    assert.equal(reaps[0], bad);
    assert.equal(r.calls.length, 2, JSON.stringify(r.calls));
  });

  test('stop() ينتظرُ النداءَ الجاري ولا يُجدوِلُ بعده', async () => {
    let release = () => {};
    let calls = 0;
    const k = startLapseReaper(
      {
        reapLapsed: () =>
          new Promise((resolve) => {
            calls += 1;
            release = () => resolve(ok(0));
          }),
      },
      { ceilingMs: 1000 },
    );
    let done = false;
    const stopping = k.stop().then(() => (done = true));
    await wait(20);
    assert.equal(done, false, 'لا يعودُ قبلَ انتهاءِ النداءِ الجاري');
    release();
    await stopping;
    await wait(50);
    assert.equal(calls, 1);
    assert.equal(k.stopped(), true);
  });
});

describe(
  'WL-545: نافذةُ الانقضاءِ والحصاد (‏قاعدةٌ حقيقيّة، ساعةٌ حقيقيّة)',
  { skip: skipWithoutDatabase },
  () => {
    /** @type {Awaited<ReturnType<typeof harness>>} */
    let h;
    const WINDOW_S = 5;
    before(async () => {
      h = await harness('wl545');
      await h.sovereign.command('lease_set', { lease_window_s: WINDOW_S, lease_renew_s: 1 });
      await h.resume();
    });
    after(async () => {
      if (h) await h.close();
    });
    const sleep = (/** @type {number} */ ms) => new Promise((r) => setTimeout(r, ms));
    /** @param {string} role */
    const cred = async (role) =>
      (
        await h.db.pool.query(
          `SELECT c.status, c.revoke_reason, c.revoked_at, l.expires_at,
                  (SELECT count(*)::int FROM pg_stat_activity a WHERE a.usename = c.role_name) AS alive
             FROM fence.credentials c LEFT JOIN fence.run_lease l ON l.role_name = c.role_name
            WHERE c.role_name = $1`,
          [role],
        )
      ).rows[0];
    /**
     * حتى يُلتزَمَ الإلغاءُ وتموتَ الجلسة. ‏(pg_terminate_backend فوريٌّ لا معاملاتيّ: الجلسةُ تموتُ قبلَ التزامِ
     * الحصاد — فلا يكفي غيابُها.) @param {string} role @param {number} ms
     */
    const untilGone = async (role, ms) => {
      const t = Date.now();
      while (Date.now() - t < ms) {
        const c = await cred(role);
        if (c.alive === 0 && c.status === 'REVOKED') return true;
        await sleep(20);
      }
      return false;
    };
    /** @param {import('pg').Client} c */
    const notify = (c) =>
      c.query(`NOTIFY wl545, 'x'`).then(
        () => 'ACCEPTED',
        (/** @type {any} */ e) => `REJ ${e.code ?? e.message}`,
      );
    /** @param {string} role */
    const expiresAt = async (role) => new Date((await cred(role)).expires_at).getTime();
    /** نافذةُ القاعدة: revoked_at − expires_at بساعتِها هي (‏لا ساعةِ الاختبار). @param {string} role @param {number} expMs */
    const windowMs = async (role, expMs) =>
      new Date((await cred(role)).revoked_at).getTime() - expMs;

    test('العيبُ قائمٌ بلا حاصدٍ مستقلّ: الجذرُ "مات" فبعدَ الانقضاءِ الاعتمادُ ACTIVE والجلسةُ حيّةٌ تُرسِلُ NOTIFY؛ والحاصدُ المستقلُّ يُنهيها فوراً', async () => {
      const a = await h.boot('alpha');
      const ra = String(a.credential.role_name);
      const ca = /** @type {import('pg').Client} */ (a.client);
      const k = h.root.startLeaseKeeper(ra, { assertOperational: () => {} }, { intervalMs: 200 });
      await sleep(300);
      k.stop(); // موتُ العمليّة: لا نداءَ للحاصد
      const exp = await expiresAt(ra);
      await sleep(Math.max(0, exp - Date.now()) + 1500);
      const c = await cred(ra);
      assert.equal(c.status, 'ACTIVE', 'العيب: لا حصادَ بلا نداء');
      assert.equal(c.alive, 1);
      assert.equal(await notify(ca), 'ACCEPTED', 'العيب: NOTIFY بعدَ الانقضاء');
      await rejection(() => ca.query('INSERT INTO state.fence_probe DEFAULT VALUES'));
      const reaper = startLapseReaper(h.sovereign, { ceilingMs: 60_000 });
      try {
        assert.equal(await untilGone(ra, 2000), true, 'الحاصدُ المستقلُّ يُنهي الجلسة');
      } finally {
        await reaper.stop();
      }
      const after = await cred(ra);
      assert.equal(after.status, 'REVOKED');
      assert.equal(after.revoke_reason, 'LEASE_LAPSED:expired');
      assert.notEqual(await notify(ca), 'ACCEPTED');
    });

    test('موتُ الجذر والحاصدُ بوصلةِ السياديّ يعملُ: يُنهي الجلسةَ عندَ الموعد (‏السقفُ 60 ث فالموعدُ وحدَه يفسّرُ القرب) — النافذةُ مقيسةٌ بساعةِ القاعدة', async () => {
      const reaper = startLapseReaper(h.sovereign, { ceilingMs: 60_000 });
      try {
        const a = await h.boot('alpha');
        const ra = String(a.credential.role_name);
        const exp = await expiresAt(ra);
        // حاصدٌ بدأَ قبلَ الإقلاع (‏بلا اعتمادٍ نشِط): ينامُ النافذةَ لا السقف (‏next_due_ms ≤ lease_window_s)، فيستيقظُ
        // قبلَ انقضاءِ اعتمادٍ صدرَ بعدَه ويُجدوِلُ موعدَه بدقّة — بلا إيقاظٍ من issue_credential.
        assert.equal(await untilGone(ra, WINDOW_S * 1000 + 3000), true);
        const w = await windowMs(ra, exp);
        assert.ok(w >= 0 && w < 750, `النافذة ${w} ms (‏≥0: لا حصادَ قبلَ الانقضاء)`);
        assert.equal((await cred(ra)).revoke_reason, 'LEASE_LAPSED:expired');
        assert.notEqual(await notify(/** @type {import('pg').Client} */ (a.client)), 'ACCEPTED');
      } finally {
        await reaper.stop();
      }
    });

    test('الحارسُ المحلّيُّ يوقفُ حافظَ الإيجار (‏لا يقرأُ RUNNING) والحاصدُ المستقلُّ يُنهي الجلسةَ عندَ الموعد', async () => {
      const a = await h.boot('alpha');
      const ra = String(a.credential.role_name);
      let n = 0;
      /** @type {unknown} */
      let stopReason = null;
      h.root.startLeaseKeeper(
        ra,
        {
          assertOperational: () => {
            if (++n > 1) throw Object.assign(new Error('local guard'), { code: 'LOCAL_HALT' });
          },
        },
        { intervalMs: 300, onStop: (x) => (stopReason = x) },
      );
      const reaper = startLapseReaper(h.sovereign, { ceilingMs: 60_000 });
      try {
        await sleep(800);
        assert.equal(/** @type {any} */ (stopReason)?.code, 'LOCAL_HALT', 'الحافظُ توقّفَ بالحارس');
        const exp = await expiresAt(ra);
        assert.equal(await untilGone(ra, WINDOW_S * 1000 + 3000), true);
        const w = await windowMs(ra, exp);
        assert.ok(w >= 0 && w < 750, `النافذة ${w} ms`);
      } finally {
        await reaper.stop();
      }
    });

    test('مشروع: حافظٌ يُجدِّدُ وحاصدٌ يعملُ أطولَ من نافذتَين — لا حصادَ لإيجارٍ صالح، والكتابةُ تعمل، ولا حلقةَ ساخنة', async () => {
      const a = await h.boot('alpha');
      const ra = String(a.credential.role_name);
      const k = h.root.startLeaseKeeper(ra, { assertOperational: () => {} }, { intervalMs: 1000 });
      const reaped = /** @type {unknown[]} */ ([]);
      const reaper = startLapseReaper(h.sovereign, {
        ceilingMs: 60_000,
        onReap: (x) => reaped.push(x),
      });
      try {
        await sleep(WINDOW_S * 1000 * 2 + 500);
        const c = await cred(ra);
        assert.equal(c.status, 'ACTIVE');
        assert.equal(c.alive, 1);
        await /** @type {import('pg').Client} */ (a.client).query(
          `INSERT INTO state.fence_probe (id, v) VALUES (545, 'wl545')`,
        );
        assert.deepEqual(reaped, []);
        // الموعدُ يتقدّمُ مع كلِّ تجديد (‏~4 ث أمامَه): بضعُ نداءاتٍ لا مئات.
        assert.ok(reaper.ticks() <= 12, `ticks=${reaper.ticks()}`);
      } finally {
        k.stop();
        await reaper.stop();
      }
      await /** @type {import('pg').Client} */ (a.client).query(
        'DELETE FROM state.fence_probe WHERE id = 545',
      );
    });

    test('ما لا موعدَ له (‏no_lease) يُلتقَطُ بالسقف ولو كان الموعدُ التالي بعيداً', async () => {
      const a = await h.boot('alpha');
      const ra = String(a.credential.role_name);
      const reaper = startLapseReaper(h.sovereign, { ceilingMs: 400 });
      try {
        await sleep(100); // نامَ حتى min(الموعد ~5 ث، السقف)
        await h.db.pool.query('DELETE FROM fence.run_lease WHERE role_name = $1', [ra]);
        const t = Date.now();
        assert.equal(await untilGone(ra, 2000), true);
        assert.ok(Date.now() - t < 1000, `${Date.now() - t} ms`);
        assert.equal((await cred(ra)).revoke_reason, 'LEASE_LAPSED:no_lease');
      } finally {
        await reaper.stop();
      }
    });

    test('next_due_ms بساعةِ القاعدة: النافذةُ بلا اعتماد، وأقربُ الموعدَين لاعتمادَين، ولا يُرى العاملُ الحاصدَ', async () => {
      const a = await h.boot('alpha');
      const b = await h.boot('beta');
      const ra = String(a.credential.role_name);
      await h.db.pool.query(
        `UPDATE fence.run_lease SET expires_at = clock_timestamp() + interval '2 seconds' WHERE role_name = $1`,
        [ra],
      );
      const r = await h.sovereign.reapLapsed();
      assert.equal(r.reaped.length, 0);
      const due = Number(r.next_due_ms);
      assert.ok(
        due > 1500 && due <= 2000,
        `الأقربُ (‏alpha ~2000 ms لا beta ~${WINDOW_S * 1000}): ${due}`,
      );
      await rejectsWith(
        () => /** @type {import('pg').Client} */ (b.client).query('SELECT fence.reap_lapsed()'),
        ['42501', 'XF501'],
        'العاملُ لا يحصد',
      );
      // ‏الإلغاءُ يُخرجُ الاعتمادَ من الحساب: بلا اعتمادٍ نشِطٍ ⇒ النافذةُ نفسُها (‏لا 0 يُدوِّرُ الحاصدَ بلا داع، ولا نومٌ
      // أطولُ منها يفوّتُ اعتماداً يصدرُ بعدَه).
      await h.root.revokeCredential(ra, 'wl545');
      await h.root.revokeCredential(String(b.credential.role_name), 'wl545');
      assert.equal((await h.sovereign.reapLapsed()).next_due_ms, WINDOW_S * 1000);
    });

    test('طفراتُ 0027 تُكشَف (‏تُطبَّقُ بالمُهاجِرِ تحتَ HALTED ثمّ يُعادُ النصُّ الحقيقيّ)', async () => {
      const src = new URL('../../migrations/', import.meta.url);
      const FILE = '0027_fence_reap_deadline.up.sql';
      const above = readdirSync(src)
        .filter((f) => f.endsWith('.up.sql') && Number(f.slice(0, 4)) > 27)
        .map((f) => Number(f.slice(0, 4)))
        .sort((a, b) => a - b);
      /** فحصُ الدلالةِ نفسُه للنصِّ الحقيقيِّ وللطفرات. @returns {Promise<string[]>} أسماءُ الفحوصِ الساقطة */
      const probe = async () => {
        const fails = [];
        await h.resume();
        const a = await h.boot('alpha');
        await h.boot('beta');
        const ra = String(a.credential.role_name);
        await h.db.pool.query(
          `UPDATE fence.run_lease SET expires_at = clock_timestamp() + interval '2 seconds' WHERE role_name = $1`,
          [ra],
        );
        const due = Number((await h.sovereign.reapLapsed()).next_due_ms);
        if (!(due > 1500 && due <= 2000)) fails.push(`nearest:${due}`);
        await h.root.halt('wl545-mut', { effects: NO_EFFECTS });
        const after = (await h.sovereign.reapLapsed()).next_due_ms;
        if (after !== WINDOW_S * 1000) fails.push(`no_active:${after}`);
        return fails;
      };
      await h.root.halt('wl545-mut-pre', { effects: NO_EFFECTS });
      for (const [label, mutate] of /** @type {Array<[string, (t: string) => string]>} */ ([
        ['max بدلَ min (‏الأبعدُ لا الأقرب)', (t) => t.replace('1000, min(CASE', '1000, max(CASE')],
        ['ثوانٍ لا مللي ثوانٍ', (t) => t.replace(') * 1000))::bigint', ')))::bigint')],
        [
          'بلا قيدِ ACTIVE (‏الملغى يُحسَب)',
          (t) => t.replace("\n  WHERE x.status = 'ACTIVE';", ';'),
        ],
        [
          'بلا حدِّ النافذة (‏بلا اعتمادٍ نشِطٍ لا موعد)',
          (t) => t.replace('least(c.lease_window_s::bigint * 1000, min(CASE', 'least(min(CASE'),
        ],
      ])) {
        const d = mkdtempSync(join(tmpdir(), 'xuux-mig-'));
        try {
          for (const f of readdirSync(src)) {
            if (Number(f.slice(0, 4)) > 27) continue;
            const t = readFileSync(new URL(f, src), 'utf8');
            writeFileSync(join(d, f), f === FILE ? mutate(t) : t);
          }
          assert.notEqual(
            readFileSync(join(d, FILE), 'utf8'),
            readFileSync(new URL(FILE, src), 'utf8'),
            `${label}: الطفرةُ لم تُطبَّق`,
          );
          // ‏WL-551/WL-552: ما فوقَ 0027 (‏0028، 0029، …) يُنزَلُ معها إلى 26، والتقديمُ يُعيدُها كلَّها.
          assert.equal((await migratorDown(h.db.pool, { steps: above.length + 1 })).current, 26);
          await migratorUp(h.db.pool, { dir: d });
          assert.notDeepEqual(await probe(), [], `${label}: الطفرةُ حيّة`);
          await migratorDown(h.db.pool, { steps: 1, dir: d });
        } finally {
          rmSync(d, { recursive: true, force: true });
        }
        assert.deepEqual((await migratorUp(h.db.pool)).applied, [27, ...above]);
      }
      assert.deepEqual(await probe(), [], 'النصُّ الحقيقيُّ يجتازُ الفحوصَ كلَّها');
      await h.resume();
    });
  },
);

// ── WL-552: جلسةٌ حيّةٌ لاعتمادٍ ملغى (‏0029) ───────────────────────────────────────────────────
// قبلَ الإصلاح (‏مقيسٌ في مختبرِ WL-548 (‏د) على 0027، ونصُّه في 0028 كما هو): جلسةٌ لم تمُت بإشارةِ الإنهاء — النداءُ
// الأوّلُ للحاصدِ يُلغي ويُبلِّغُها unresolved، والثاني يُعلِنُ ok=true وهي حيّة (‏الحلقةُ على ACTIVE وحدَها). وكذلك إلغاءُ الجذرِ
// اليدويّ. الجلسةُ الباقيةُ تُصنَعُ حتميّاً بـSIGSTOP على عمليّةِ الخادم — ممكنٌ حيثُ تملكُ عمليّةُ الاختبارِ عمليّاتِ الخادم
// (‏PG محلّيّ)؛ وفي خادمٍ داخلَ حاوية (‏CI) لا إشارةَ ممكنة فتُعلَنُ تلك الاختباراتُ NOT RUN بسببِها. فحصُ إعادةِ استعمالِ
// رقمِ العمليّة (‏fence._signal_session) لا يحتاجُ إيقافاً فيعملُ في كلِّ مكان.

describe('WL-552: جلسةُ الاعتمادِ الملغى الحيّة (‏0029)', { skip: skipWithoutDatabase }, () => {
  /** @type {Awaited<ReturnType<typeof harness>>} */
  let h;
  /** @type {Set<number>} */
  const stopped = new Set();
  /** @type {string | false} */
  let freezeSkip = false;
  const sleep = (/** @type {number} */ ms) => new Promise((r) => setTimeout(r, ms));
  /** @param {number} pid */
  const thaw = (pid) => {
    try {
      process.kill(pid, 'SIGCONT');
    } catch {
      /* ماتت */
    }
    stopped.delete(pid);
  };
  /** @param {import('pg').Client} c @returns {Promise<{ pid: number, start: string }>} */
  const backendOf = async (c) => {
    const r = (
      await c.query(
        `SELECT pid, backend_start::text AS start FROM pg_stat_activity WHERE pid = pg_backend_pid()`,
      )
    ).rows[0];
    return { pid: Number(r.pid), start: String(r.start) };
  };
  /**
   * عمليّةُ خلفيّةٍ لهذا الخادمِ بعينِه في متناولِ الاختبار: الإشارةُ 0 تنجح، وسطرُ أوامرِها `postgres: <الدور> <القاعدة> `.
   * @param {number} pid @param {string} role
   */
  const serverProcess = (pid, role) => {
    try {
      process.kill(pid, 0);
      return readFileSync(`/proc/${pid}/cmdline`, 'utf8').startsWith(
        `postgres: ${role} ${h.db.name} `,
      );
    } catch {
      return false;
    }
  };
  /** @param {import('pg').Client} c */
  const freeze = async (c) => {
    const b = await backendOf(c);
    const role = String((await c.query('SELECT current_user AS u')).rows[0].u);
    // ‏لا إشارةَ لعمليّةٍ غيرِ خلفيّةِ هذه الجلسةِ بعينِها (‏رقمٌ من فضاءِ أسماءٍ آخرَ قد يُطابقُ عمليّةً أجنبيّة).
    assert.ok(serverProcess(b.pid, role), `العمليّةُ ${b.pid} ليست خلفيّةَ ${role}`);
    process.kill(b.pid, 'SIGSTOP');
    stopped.add(b.pid);
    return b;
  };
  /** @param {string} role */
  const sessions = async (role) =>
    (
      await h.db.pool.query(
        `SELECT pid, backend_start::text AS start FROM pg_stat_activity WHERE usename = $1 ORDER BY pid, backend_start`,
        [role],
      )
    ).rows.map((r) => ({ pid: Number(r.pid), start: String(r.start) }));
  /** @param {string} role @param {number} ms */
  const untilDead = async (role, ms = 5000) => {
    const t = Date.now();
    while (Date.now() - t < ms) {
      if ((await sessions(role)).length === 0) return true;
      await sleep(20);
    }
    return false;
  };
  /** ‏lingering[i].sessions بصيغةِ الاختبار (‏backend_start نصّاً بساعةِ القاعدة). @param {any} r @param {string} role */
  const lingeringOf = async (r, role) => {
    const e = (r.lingering ?? []).find((/** @type {any} */ x) => x.role === role);
    if (e === undefined) return undefined;
    const out = [];
    for (const s of e.sessions)
      out.push({
        pid: Number(s.pid),
        start: String(
          (await h.db.pool.query('SELECT $1::timestamptz::text AS t', [s.backend_start])).rows[0].t,
        ),
      });
    return { status: e.status, signalled: e.signalled, sessions: out };
  };
  /** ‏إلغاءٌ «في نداءٍ سابق» بلا إنهاء: الحالةُ وحدَها (‏superuser، حدُّ الحزام) — فالحاصدُ يرى REVOKED وجلسةً حيّة. */
  const markRevoked = (/** @type {string} */ role, /** @type {string} */ why) =>
    h.db.pool.query(
      `UPDATE fence.credentials SET status = 'REVOKED', revoked_at = clock_timestamp(), revoke_reason = $2
        WHERE role_name = $1 AND status = 'ACTIVE'`,
      [role, why],
    );

  before(async () => {
    h = await harness('wl552');
    await h.sovereign.command('lease_set', { lease_window_s: 5, lease_renew_s: 1 });
    await h.resume();
    const c = await h.db.pool.connect();
    try {
      const pid = Number((await c.query('SELECT pg_backend_pid() AS p')).rows[0].p);
      if (!serverProcess(pid, h.superuser))
        freezeSkip =
          'NOT RUN — عمليّةُ خلفيّةِ الخادمِ ليست في متناولِ عمليّةِ الاختبار (‏خادمٌ في حاويةٍ أو بمستخدمٍ آخر): لا SIGSTOP ممكن';
    } finally {
      c.release();
    }
  });
  after(async () => {
    for (const p of [...stopped]) thaw(p);
    if (h) {
      await sleep(300);
      await h.close();
    }
  });

  test('إعادةُ استعمالِ رقمِ العمليّة: fence._signal_session لا تُنهي إلا (‏pid، backend_start) لدورِ عاملٍ بعينِه', async () => {
    const a = await h.boot('alpha');
    const role = String(a.credential.role_name);
    const ca = /** @type {import('pg').Client} */ (a.client);
    const b = await backendOf(ca);
    const su = await h.db.pool.connect();
    try {
      /** @param {number} pid @param {string} start @param {string} r */
      const sig = async (pid, start, r) =>
        (
          await su.query('SELECT fence._signal_session($1, $2::timestamptz, $3) AS ok', [
            pid,
            start,
            r,
          ])
        ).rows[0].ok;
      const later = String(
        (
          await su.query(`SELECT ($1::timestamptz + interval '1 microsecond')::text AS t`, [
            b.start,
          ])
        ).rows[0].t,
      );
      // الرقمُ نفسُه وبدءٌ آخر = جلسةٌ أخرى وُلِدت بالرقمِ نفسِه بعدَ موتِ الأولى.
      assert.equal(await sig(b.pid, later, role), false, 'بدءٌ آخرُ بالرقمِ نفسِه');
      assert.equal(await sig(b.pid, b.start, 'xf_root'), false, 'دورٌ آخر');
      const other = await h.db.pool.connect();
      try {
        const o = await backendOf(/** @type {any} */ (other));
        assert.equal(await sig(o.pid, o.start, h.superuser), false, 'جلسةُ superuser ليست عاملاً');
      } finally {
        other.release();
      }
      const self = await backendOf(/** @type {any} */ (su));
      assert.equal(await sig(self.pid, self.start, h.superuser), false, 'لا إنهاءَ للنفس');
      assert.deepEqual(await sessions(role), [b], 'الجلسةُ حيّةٌ بعدَ كلِّ رفض');
      await rejectsWith(
        () => ca.query('SELECT fence._signal_session(1, now(), $1)', [role]),
        ['42501'],
        'العاملُ لا يُنادي الدالّة',
      );
      assert.equal(await sig(b.pid, b.start, role), true, 'الزوجُ الصحيحُ يُنهي');
    } finally {
      su.release();
    }
    assert.equal(await untilDead(role), true);
    await h.root.revokeCredential(role, 'wl552-cleanup');
  });

  test('جلسةٌ لم تمُت عبرَ الانقضاء: النداءُ الأوّلُ unresolved، والثاني ok=false بـ(‏pid، backend_start) وبلا انتظار، وبعدَ موتِها ok', async (t) => {
    if (freezeSkip) return t.skip(freezeSkip);
    const a = await h.boot('alpha');
    const role = String(a.credential.role_name);
    const exp = new Date(
      (await h.db.pool.query('SELECT expires_at FROM fence.run_lease WHERE role_name = $1', [role]))
        .rows[0].expires_at,
    ).getTime();
    const b = await freeze(/** @type {import('pg').Client} */ (a.client));
    await sleep(Math.max(0, exp - Date.now()) + 300);
    const t1 = await h.sovereign.reapLapsed();
    assert.equal(t1.ok, false);
    assert.deepEqual(t1.unresolved, [role]);
    const s0 = Date.now();
    const t2 = await h.sovereign.reapLapsed();
    const t2ms = Date.now() - s0;
    assert.deepEqual(await sessions(role), [b], 'شرطٌ مسبق: الجلسةُ حيّةٌ عندَ النداءِ الثاني');
    assert.equal(t2.ok, false, 'اعتمادٌ ملغى وجلستُه حيّة: لا ok=true');
    assert.deepEqual(t2.unresolved, [role]);
    assert.deepEqual(await lingeringOf(t2, role), {
      status: 'REVOKED',
      signalled: 1,
      sessions: [b],
    });
    assert.ok(t2ms < 2000, `الإشارةُ بلا انتظار (‏${t2ms} مث)`);
    const ev = (
      await h.db.pool.query(
        `SELECT detail FROM fence.events WHERE kind = 'REVOKED_SESSION_LINGERING' ORDER BY seq DESC LIMIT 1`,
      )
    ).rows[0];
    assert.deepEqual(
      ev?.detail?.lingering?.map((/** @type {any} */ x) => [
        x.role,
        x.sessions.map((/** @type {any} */ y) => y.pid),
      ]),
      [[role, [b.pid]]],
      'حدثُ REVOKED_SESSION_LINGERING بالدورِ والجلسة',
    );
    thaw(b.pid);
    assert.equal(await untilDead(role), true, 'بعدَ الاستئنافِ تكتملُ الإشارة');
    const t3 = await h.sovereign.reapLapsed();
    assert.equal(t3.ok, true);
    assert.deepEqual(t3.unresolved, []);
    assert.deepEqual(t3.lingering, []);
  });

  test('إعادةُ الإلغاء: إلغاءُ الجذرِ يدويّاً مرّتين — الاعتمادُ REVOKED بسببِه الأوّل، والحاصدُ ok=false ما دامت الجلسةُ حيّة', async (t) => {
    if (freezeSkip) return t.skip(freezeSkip);
    const a = await h.boot('beta');
    const role = String(a.credential.role_name);
    const b = await freeze(/** @type {import('pg').Client} */ (a.client));
    assert.equal(
      await h.root.revokeCredential(role, 'wl552-first'),
      0,
      'الإلغاءُ الأوّل: الإنهاءُ لم يكتمل',
    );
    const r1 = await h.sovereign.reapLapsed();
    assert.equal(r1.ok, false);
    assert.deepEqual((await lingeringOf(r1, role))?.sessions, [b]);
    assert.equal(
      await h.root.revokeCredential(role, 'wl552-second'),
      0,
      'الإلغاءُ الثاني لا يُحيي ولا يُنهي المعلّق',
    );
    const c = (
      await h.db.pool.query(
        'SELECT status, revoke_reason FROM fence.credentials WHERE role_name = $1',
        [role],
      )
    ).rows[0];
    assert.deepEqual(c, { status: 'REVOKED', revoke_reason: 'wl552-first' }, 'السببُ الأوّلُ باقٍ');
    const r2 = await h.sovereign.reapLapsed();
    assert.equal(r2.ok, false);
    assert.deepEqual(r2.unresolved, [role]);
    assert.deepEqual((await lingeringOf(r2, role))?.sessions, [b]);
    thaw(b.pid);
    assert.equal(await untilDead(role), true);
    assert.equal((await h.sovereign.reapLapsed()).ok, true);
  });

  test('تجديدٌ وإلغاءٌ متزامنان بوصلتَي جذر: لا إحياءَ للإيجار، والحاصدُ ok=false حتى تموتَ الجلسة', async (t) => {
    if (freezeSkip) return t.skip(freezeSkip);
    const a = await h.boot('alpha');
    const role = String(a.credential.role_name);
    const b = await freeze(/** @type {import('pg').Client} */ (a.client));
    const r2 = await h.login('xf_root');
    // الإلغاءُ يحذفُ الإيجارَ ثمّ ينتظرُ إنهاءَ الجلسةِ الموقوفة (‏5 ث) داخلَ معاملتِه؛ التجديدُ يصلُ في أثنائها فينتظرُ،
    // وبعدَ الالتزامِ يُرفَض (‏XF007 اعتمادٌ غيرُ نشِط، أو XF009 لا إيجار) — لا إحياءَ للإيجارِ بسباق.
    const revoking = h.rootClient.query('SELECT fence.revoke_credential($1, $2) AS n', [
      role,
      'wl552-race',
    ]);
    await sleep(300);
    const s0 = Date.now();
    const [renew, revoke] = await Promise.allSettled([
      r2.query('SELECT fence.renew_lease($1) AS e', [role]),
      revoking,
    ]);
    const waited = Date.now() - s0;
    assert.equal(revoke.status, 'fulfilled', 'الإلغاءُ ينجح');
    assert.equal(renew.status, 'rejected', 'التجديدُ المتزامنُ مرفوض');
    assert.ok(
      ['XF007', 'XF009'].includes(/** @type {any} */ (renew).reason.code),
      `اعتمادٌ غيرُ نشِط أو لا إيجار: ${/** @type {any} */ (renew).reason.code}`,
    );
    assert.ok(waited > 1000, `التجديدُ انتظرَ الإلغاءَ فعلاً (‏${waited} مث) — تزامنٌ لا تتابع`);
    const lease = (
      await h.db.pool.query('SELECT count(*)::int AS n FROM fence.run_lease WHERE role_name = $1', [
        role,
      ])
    ).rows[0].n;
    assert.equal(lease, 0, 'لا إيجارَ بعدَ الإلغاء');
    await rejectsWith(
      () => r2.query('SELECT fence.renew_lease($1)', [role]),
      ['XF007'],
      'بعدَ الاستقرار',
    );
    const r = await h.sovereign.reapLapsed();
    assert.equal(r.ok, false);
    assert.deepEqual((await lingeringOf(r, role))?.sessions, [b]);
    thaw(b.pid);
    assert.equal(await untilDead(role), true);
    assert.equal((await h.sovereign.reapLapsed()).ok, true);
  });

  test('جلساتٌ متعدّدة: جلستان لاعتمادٍ وجلسةٌ لآخر — كلُّها بـ(‏pid، backend_start)، وok=false حتى تموتَ آخرُها', async (t) => {
    if (freezeSkip) return t.skip(freezeSkip);
    // ‏جلسةٌ ثانيةٌ للدورِ نفسِه قبلَ الختم (‏الختمُ يُغلِقُ الدخول): جلستان حيّتانِ لاعتمادٍ واحد.
    const a = await h.boot('alpha', { seal: false });
    const ra = String(a.credential.role_name);
    const a2 = await h.login(ra);
    const z = await h.boot('beta');
    const rz = String(z.credential.role_name);
    const fa = [await freeze(/** @type {import('pg').Client} */ (a.client)), await freeze(a2)].sort(
      (x, y) => x.pid - y.pid,
    );
    const fz = await freeze(/** @type {import('pg').Client} */ (z.client));
    await markRevoked(ra, 'wl552-multi');
    await markRevoked(rz, 'wl552-multi');
    const r1 = await h.sovereign.reapLapsed();
    assert.equal(r1.ok, false);
    assert.deepEqual([...r1.unresolved].sort(), [ra, rz].sort());
    assert.deepEqual(await lingeringOf(r1, ra), { status: 'REVOKED', signalled: 2, sessions: fa });
    assert.deepEqual(await lingeringOf(r1, rz), {
      status: 'REVOKED',
      signalled: 1,
      sessions: [fz],
    });
    thaw(/** @type {{ pid: number }} */ (fa[0]).pid);
    thaw(fz.pid);
    assert.equal(await untilDead(rz), true);
    for (let i = 0; i < 100 && (await sessions(ra)).length > 1; i += 1) await sleep(20);
    const r2 = await h.sovereign.reapLapsed();
    assert.equal(r2.ok, false, 'جلسةٌ واحدةٌ باقيةٌ تكفي');
    assert.deepEqual(r2.unresolved, [ra]);
    assert.deepEqual((await lingeringOf(r2, ra))?.sessions, [fa[1]]);
    thaw(/** @type {{ pid: number }} */ (fa[1]).pid);
    assert.equal(await untilDead(ra), true);
    const r3 = await h.sovereign.reapLapsed();
    assert.equal(r3.ok, true);
    assert.deepEqual(r3.lingering, []);
  });

  test('طفراتُ 0029 تُكشَف (‏تُطبَّقُ بالمُهاجِرِ تحتَ HALTED ثمّ يُعادُ النصُّ الحقيقيّ)', async (t) => {
    if (freezeSkip) return t.skip(freezeSkip);
    const src = new URL('../../migrations/', import.meta.url);
    const FILE = '0029_fence_revoked_session.up.sql';
    /** @returns {Promise<string[]>} أسماءُ الفحوصِ الساقطة */
    const probe = async () => {
      const fails = [];
      await h.resume();
      const a = await h.boot('alpha');
      const role = String(a.credential.role_name);
      const b = await freeze(/** @type {import('pg').Client} */ (a.client));
      try {
        await markRevoked(role, 'wl552-mut');
        const s0 = Date.now();
        const r = await h.sovereign.reapLapsed();
        const ms = Date.now() - s0;
        if (r.ok !== false) fails.push('ok');
        if (ms >= 2000) fails.push(`waited:${ms}`);
        const lg = await lingeringOf(r, role);
        if (JSON.stringify(lg?.sessions) !== JSON.stringify([b]))
          fails.push(`lingering:${JSON.stringify(lg)}`);
        const later = String(
          (
            await h.db.pool.query(
              `SELECT ($1::timestamptz + interval '1 microsecond')::text AS t`,
              [b.start],
            )
          ).rows[0].t,
        );
        const reuse = (
          await h.db.pool.query('SELECT fence._signal_session($1, $2::timestamptz, $3) AS ok', [
            b.pid,
            later,
            role,
          ])
        ).rows[0].ok;
        if (reuse !== false) fails.push('pid_reuse');
      } finally {
        thaw(b.pid);
      }
      if (!(await untilDead(role))) fails.push('alive');
      await h.root.halt('wl552-mut', { effects: NO_EFFECTS });
      return fails;
    };
    const above = readdirSync(src)
      .filter((f) => f.endsWith('.up.sql') && Number(f.slice(0, 4)) > 29)
      .map((f) => Number(f.slice(0, 4)));
    await h.root.halt('wl552-mut-pre', { effects: NO_EFFECTS });
    for (const [label, mutate] of /** @type {Array<[string, (t: string) => string]>} */ ([
      [
        'الجلسةُ الباقيةُ لا تُسقِطُ ok',
        (x) =>
          x.replace(
            "        'signalled', n, 'sessions', sess));\n      unresolved := unresolved || to_jsonb(cr.role_name::text);\n",
            "        'signalled', n, 'sessions', sess));\n",
          ),
      ],
      [
        'بلا backend_start (‏رقمُ العمليّةِ وحدَه)',
        (x) => x.replace('a.pid = p AND a.backend_start = started AND', 'a.pid = p AND'),
      ],
      [
        'الإشارةُ تنتظر (‏5 ث لكلِّ جلسة)',
        (x) =>
          x.replace('RETURN pg_terminate_backend(p);', 'RETURN pg_terminate_backend(p, 5000);'),
      ],
      [
        'الإلغاءُ بالحاصدِ وحدَه (‏لا اليدويّ)',
        (x) =>
          x.replace(
            "FROM fence.credentials x WHERE x.status <> 'ACTIVE'\n",
            "FROM fence.credentials x WHERE x.status <> 'ACTIVE' AND x.revoke_reason LIKE 'LEASE_LAPSED:%'\n",
          ),
      ],
    ])) {
      const d = mkdtempSync(join(tmpdir(), 'xuux-mig-'));
      try {
        for (const f of readdirSync(src)) {
          if (Number(f.slice(0, 4)) > 29) continue;
          const x = readFileSync(new URL(f, src), 'utf8');
          writeFileSync(join(d, f), f === FILE ? mutate(x) : x);
        }
        assert.notEqual(
          readFileSync(join(d, FILE), 'utf8'),
          readFileSync(new URL(FILE, src), 'utf8'),
          `${label}: الطفرةُ لم تُطبَّق`,
        );
        assert.equal((await migratorDown(h.db.pool, { steps: above.length + 1 })).current, 28);
        await migratorUp(h.db.pool, { dir: d });
        assert.notDeepEqual(await probe(), [], `${label}: الطفرةُ حيّة`);
        await migratorDown(h.db.pool, { steps: 1, dir: d });
      } finally {
        rmSync(d, { recursive: true, force: true });
      }
      assert.deepEqual((await migratorUp(h.db.pool)).applied, [29, ...above]);
    }
    assert.deepEqual(await probe(), [], 'النصُّ الحقيقيُّ يجتازُ الفحوصَ كلَّها');
    await h.resume();
  });
});
