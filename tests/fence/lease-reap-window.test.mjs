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
          // ‏WL-551: 0028 فوقَ 0027 — الرجوعُ خطوتان إلى 26، والتقديمُ يُعيدُهما.
          assert.equal((await migratorDown(h.db.pool, { steps: 2 })).current, 26);
          await migratorUp(h.db.pool, { dir: d });
          assert.notDeepEqual(await probe(), [], `${label}: الطفرةُ حيّة`);
          await migratorDown(h.db.pool, { steps: 1, dir: d });
        } finally {
          rmSync(d, { recursive: true, force: true });
        }
        assert.deepEqual((await migratorUp(h.db.pool)).applied, [27, 28]);
      }
      assert.deepEqual(await probe(), [], 'النصُّ الحقيقيُّ يجتازُ الفحوصَ كلَّها');
      await h.resume();
    });
  },
);
