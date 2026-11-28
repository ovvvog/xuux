/**
 * ‏`WL-628` — ‏`LIVE-75/RLS-SILENT-SKIP`: ثغرتا ما بعدَ 0037 (‏الهجرة 0038). تُتخطّى بلا `DATABASE_URL`.
 *
 * أعادَ إنتاجَهما مراجعو 2026-11-28 (‏`docs/external-review/council-2026-11-28/`، ‏r1 العيبان 1 و3):
 * 1. ‏**المؤشّرُ/البوّابةُ يُبتَرُ صامتاً:** كلُّ FETCH (‏وكلُّ Execute بحدِّ صفوف) يُعيدُ ضبطَ `statement_timestamp()`، فكانت
 *    `window_breach` (‏0037) تُعيدُ false لِما بعدَ الانقضاء ⇒ صفرُ صفوفٍ بلا خطأ. 0038: `transaction_timestamp()`.
 * 2. ‏**DELETE بخطّةِ Hash Join يلتزمُ بعدَ الانقضاء:** صفوفُ الهدفِ تُفحَصُ أثناءَ بناءِ التجزئة (‏داخلَ النافذة) وتُحذَفُ بعدَها
 *    بلا فحص. 0038: ‏`xf_guard_end` — ‏guard_write() نفسُها AFTER … FOR EACH STATEMENT.
 *
 * كلُّ اختبارٍ يحمرُّ على 0037 (‏طفراتُ WL-628 في سجلِّ العمل). ملفٌّ مستقلٌّ لمهلةِ الملفّ (‏120 ث).
 */

import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import pg from 'pg';

import { harness, t_note } from '../helpers/fence-harness.mjs';
import { skipWithoutDatabase } from '../helpers/pg.mjs';

describe(
  'WL-628 LIVE-75/RLS-SILENT-SKIP (‏0038): المؤشّرُ لا يُبتَرُ صامتاً، والعبارةُ التي تنتهي بعدَ الانقضاءِ تسقط',
  { skip: skipWithoutDatabase },
  () => {
    /** @type {Awaited<ReturnType<typeof harness>>} */
    let h;
    before(async () => {
      h = await harness('wl628end');
      for (const sql of [
        `CREATE TABLE state.eg_probe (id integer PRIMARY KEY, v text NOT NULL)`,
        `GRANT SELECT, INSERT, UPDATE, DELETE ON state.eg_probe TO xuux_worker`,
      ])
        await h.db.pool.query(sql);
      await h.sovereign.command('lease_set', { lease_window_s: 5, lease_renew_s: 1 });
      await h.resume();
    });
    after(async () => {
      if (h) await h.close();
    });
    const sleep = (/** @type {number} */ ms) => new Promise((r) => setTimeout(r, ms));
    const dbNow = async () =>
      Number(
        (
          await h.db.pool.query(
            `SELECT (extract(epoch FROM clock_timestamp()) * 1000)::float8 AS t`,
          )
        ).rows[0].t,
      );
    /** @param {number} ms */
    const untilDb = async (ms) => {
      for (let now = await dbNow(); now <= ms; now = await dbNow())
        await sleep(Math.min(200, ms - now + 5));
    };
    /** @param {'alpha' | 'beta'} id */
    const bootWorker = async (id) => {
      const a = await h.boot(id);
      const role = String(a.credential.role_name);
      const exp = Number(
        (
          await h.db.pool.query(
            `SELECT (extract(epoch FROM expires_at) * 1000)::float8 AS t FROM fence.run_lease WHERE role_name = $1`,
            [role],
          )
        ).rows[0].t,
      );
      return { role, c: /** @type {pg.Client} */ (a.client), exp };
    };
    /** @param {number[]} ids */
    const seed = async (ids) => {
      await h.db.pool.query(`DELETE FROM state.eg_probe WHERE id = ANY($1::int[])`, [ids]);
      await h.db.pool.query(
        `INSERT INTO state.eg_probe (id, v) SELECT x, 'v' || x FROM unnest($1::int[]) x`,
        [ids],
      );
    };
    /** @param {number[]} ids */
    const present = async (ids) =>
      (
        await h.db.pool.query(
          `SELECT id FROM state.eg_probe WHERE id = ANY($1::int[]) ORDER BY id`,
          [ids],
        )
      ).rows.map((r) => r.id);
    /** @param {any} e */
    const isBreach = (e) => {
      assert.ok(e instanceof Error, `قُبِلَت: ${JSON.stringify(e)}`);
      assert.equal(/** @type {any} */ (e).code, 'XF009', String(e.message));
    };
    /** @param {() => Promise<unknown>} fn */
    const caught = (fn) =>
      fn().then(
        (r) => r,
        (e) => e,
      );

    test('بنيويّ: xf_guard_end — guard_write() بعدَ العبارة، ENABLE ALWAYS — على كلِّ علاقةٍ محميّة، وcoverage_problems فارغ', async () => {
      const rows = (
        await h.db.pool.query(`
          SELECT pr.schema_name || '.' || pr.rel_name AS rel,
                 (SELECT jsonb_build_object('enabled', t.tgenabled, 'fn', t.tgfoid::regprocedure::text,
                    'row', (t.tgtype & 1) <> 0, 'before', (t.tgtype & 2) <> 0, 'instead', (t.tgtype & 64) <> 0,
                    'events', t.tgtype & 60)
                    FROM pg_trigger t WHERE t.tgrelid = pr.relid AND t.tgname = 'xf_guard_end') AS g
            FROM fence.protected_relations() pr ORDER BY 1`)
      ).rows;
      assert.ok(rows.length > 5, `علاقاتٌ محميّة: ${rows.length}`);
      for (const r of rows)
        assert.deepEqual(
          r.g,
          {
            enabled: 'A',
            fn: 'fence.guard_write()',
            row: false,
            before: false,
            instead: false,
            events: 60,
          },
          r.rel,
        );
      assert.ok(
        rows.some((r) => r.rel === 'state.eg_probe'),
        'الجدولُ المُنشأُ تحتَ HALTED غُطّيَ تلقائياً',
      );
      assert.deepEqual(
        (await h.db.pool.query(`SELECT fence.coverage_problems() AS p`)).rows[0].p,
        [],
      );
    });

    test('المؤشّر: FETCH بعدَ الانقضاءِ في معاملةٍ بدأت قبلَه ⇒ XF009 (‏كانَ صفراً صامتاً مع صفوفٍ متبقّية)', async () => {
      const ids = [62801, 62802, 62803, 62804];
      await seed(ids);
      const a = await bootWorker('alpha');
      await a.c.query('BEGIN');
      await a.c.query(
        `DECLARE eg CURSOR FOR SELECT id FROM state.eg_probe WHERE id = ANY('{62801,62802,62803,62804}'::int[]) ORDER BY id`,
      );
      assert.deepEqual((await a.c.query('FETCH 1 FROM eg')).rows, [{ id: 62801 }]);
      await untilDb(a.exp + 300);
      const fetchAt = await dbNow();
      const e = await caught(() => a.c.query('FETCH ALL FROM eg'));
      isBreach(e);
      await a.c.query('ROLLBACK');
      t_note('WL-628 cursor', { fetchAfterExpiryMs: Math.round(fetchAt - a.exp), error: 'XF009' });
    });

    test('البروتوكولُ الموسَّع: بوّابةٌ بحدِّ صفٍّ واحد — Execute بدأ بعدَ الانقضاء ⇒ XF009 لا نتيجةٌ مبتورة', async () => {
      const ids = [62811, 62812, 62813];
      await seed(ids);
      const a = await bootWorker('beta');
      // ‏كلُّ صفٍّ ينامُ 1.5 ث بعدَ اجتيازِ RLS؛ و`rows: 1` يجعلُ كلَّ صفٍّ Execute مستقلّاً (‏statement_timestamp جديد).
      // ‏بدءاً قبلَ الانقضاءِ بـ2 ث: الثالثُ يُفحَصُ في Execute بدأ بعدَه.
      await untilDb(a.exp - 2000);
      const startedAt = await dbNow();
      /** @type {any} */
      const config = {
        text: `SELECT id, pg_sleep(1.5) IS NOT NULL AS s FROM state.eg_probe WHERE id = ANY($1::int[])`,
        values: [ids],
        rows: 1,
      };
      const q = new pg.Query(config);
      /** @type {number[]} */
      const got = [];
      q.on('row', (/** @type {any} */ row) => got.push(row.id));
      const e = await new Promise((resolve) => {
        q.on('end', () => resolve({ ok: true, got }));
        q.on('error', resolve);
        a.c.query(q);
      });
      const endedAt = await dbNow();
      assert.ok(
        startedAt < a.exp - 1000 && endedAt > a.exp + 500,
        `${startedAt - a.exp}/${endedAt - a.exp}`,
      );
      isBreach(e);
      assert.ok(got.length < 3, `صفوفٌ قبلَ الرفض: ${got.length}`);
      t_note('WL-628 portal', {
        startedMs: Math.round(startedAt - a.exp),
        endedMs: Math.round(endedAt - a.exp),
      });
    });

    test('DELETE بخطّةِ Hash Join: الهدفُ يُفحَصُ أثناءَ البناءِ ويُحذَفُ بعدَ الانقضاء ⇒ XF009 من xf_guard_end والصفوفُ كلُّها باقية', async () => {
      const ids = [1, 2, 3, 4, 5];
      await seed(ids);
      const a = await bootWorker('alpha');
      await a.c.query('SET enable_nestloop = off');
      await a.c.query('SET enable_mergejoin = off');
      const sql = `DELETE FROM state.eg_probe t
                     USING (SELECT x, pg_sleep(CASE WHEN x = 2 THEN 3 ELSE 0 END) AS s FROM generate_series(1, 20000) x) q
                    WHERE t.id = q.x AND t.id <= 5 RETURNING t.id`;
      const plan = (await a.c.query(`EXPLAIN (COSTS OFF) ${sql}`)).rows.map((x) =>
        String(x['QUERY PLAN']),
      );
      const text = plan.join('\n');
      assert.match(text, /Hash Join/u, text);
      assert.match(
        text,
        /Hash\n\s*->\s*(?:Seq|Index|Bitmap)[^\n]*eg_probe/u,
        `الهدفُ داخلَ Hash:\n${text}`,
      );
      await untilDb(a.exp - 1500);
      const startedAt = await dbNow();
      const e = await caught(() => a.c.query(sql));
      const endedAt = await dbNow();
      assert.ok(
        startedAt < a.exp && endedAt > a.exp + 500,
        `${startedAt - a.exp}/${endedAt - a.exp}`,
      );
      isBreach(e);
      assert.match(
        String(/** @type {any} */ (e).message),
        /الإيجارُ منقضٍ أو غائب/u,
        'من guard_write',
      );
      assert.deepEqual(await present(ids), ids, 'لا صفَّ حُذِف');
      t_note('WL-628 hash-delete', {
        startedMs: Math.round(startedAt - a.exp),
        endedMs: Math.round(endedAt - a.exp),
      });
    });

    test('ضابطٌ إيجابيّ: الخطّةُ نفسُها كاملةً داخلَ النافذةِ تحذفُ الصفوفَ الخمسة', async () => {
      const ids = [1, 2, 3, 4, 5];
      await seed(ids);
      const a = await bootWorker('beta');
      await a.c.query('SET enable_nestloop = off');
      await a.c.query('SET enable_mergejoin = off');
      const r = await a.c.query(
        `DELETE FROM state.eg_probe t
           USING (SELECT x, pg_sleep(CASE WHEN x = 2 THEN 0.5 ELSE 0 END) AS s FROM generate_series(1, 20000) x) q
          WHERE t.id = q.x AND t.id <= 5 RETURNING t.id`,
      );
      assert.equal(r.rowCount, 5);
      assert.deepEqual(await present(ids), []);
    });

    test('إسقاطُ xf_guard_end أو تعطيلُه (‏superuser، تحتَ HALTED) ⇒ تُلغى المعاملةُ عندَ الالتزام', async () => {
      await h.root.halt('wl628-ddl', { effects: { stop: async () => ({ ok: true, detail: {} }) } });
      for (const sql of [
        'DROP TRIGGER xf_guard_end ON state.eg_probe',
        'ALTER TABLE state.eg_probe DISABLE TRIGGER xf_guard_end',
        'ALTER TABLE state.eg_probe ENABLE TRIGGER xf_guard_end',
      ]) {
        const e = await caught(() => h.db.pool.query(sql));
        assert.ok(e instanceof Error, `قُبِلَ: ${sql}`);
      }
      const n = (
        await h.db.pool.query(
          `SELECT count(*)::int AS n FROM pg_trigger WHERE tgrelid = 'state.eg_probe'::regclass AND tgname = 'xf_guard_end' AND tgenabled = 'A'`,
        )
      ).rows[0].n;
      assert.equal(n, 1, 'الحارسُ باقٍ كما هو');
      await h.db.pool.query('CREATE TABLE state.eg_new (id int)');
      assert.equal(
        (
          await h.db.pool.query(
            `SELECT count(*)::int AS n FROM pg_trigger WHERE tgrelid = 'state.eg_new'::regclass AND tgname = 'xf_guard_end' AND tgenabled = 'A'`,
          )
        ).rows[0].n,
        1,
        'جدولٌ جديدٌ يُغطّى بالحارسَين (‏cover_relation)',
      );
      assert.deepEqual(
        (await h.db.pool.query(`SELECT fence.coverage_problems() AS p`)).rows[0].p,
        [],
      );
    });

    test('حارسٌ مُستبدَلٌ بشرطٍ (‏CREATE OR REPLACE … WHEN (false) أو UPDATE OF عمود) ⇒ تُلغى المعاملة، والحارسانِ كما كانا (‏مراجعةُ 2026-11-28، D1)', async () => {
      // ‏superuser تحتَ HALTED (‏من الاختبارِ السابق). قبلَ الإصلاح: الاسمُ والدالّةُ والنوعُ والتمكينُ ALWAYS كما هي فيُقبَلُ الالتزام،
      // و`coverage_problems` فارغ — والحارسُ لا يعمل (‏أعادَ المراجعُ إنتاجَ DELETE بخطّةِ Hash Join ملتزَماً بعدَ الانقضاءِ بـ1.5 ث).
      const tampers = [
        [
          'CREATE OR REPLACE TRIGGER xf_guard_end AFTER INSERT OR UPDATE OR DELETE OR TRUNCATE ON state.eg_probe FOR EACH STATEMENT WHEN (false) EXECUTE FUNCTION fence.guard_write()',
          'ALTER TABLE state.eg_probe ENABLE ALWAYS TRIGGER xf_guard_end',
        ],
        [
          'CREATE OR REPLACE TRIGGER xf_guard BEFORE INSERT OR UPDATE OF v OR DELETE OR TRUNCATE ON state.eg_probe FOR EACH STATEMENT EXECUTE FUNCTION fence.guard_write()',
          'ALTER TABLE state.eg_probe ENABLE ALWAYS TRIGGER xf_guard',
        ],
        [
          'CREATE OR REPLACE TRIGGER xf_guard BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON state.eg_probe FOR EACH STATEMENT WHEN (false) EXECUTE FUNCTION fence.guard_write()',
          'ALTER TABLE state.eg_probe ENABLE ALWAYS TRIGGER xf_guard',
        ],
      ];
      for (const statements of tampers) {
        const c = await h.db.pool.connect();
        try {
          await c.query('BEGIN');
          for (const sql of statements) await c.query(sql);
          const e = await caught(() => c.query('COMMIT'));
          assert.ok(e instanceof Error, `قُبِلَ الالتزام: ${statements[0]}`);
        } finally {
          await c.query('ROLLBACK').catch(() => undefined);
          c.release();
        }
      }
      const defs = (
        await h.db.pool.query(
          `SELECT tgname, pg_get_triggerdef(oid) AS d FROM pg_trigger
            WHERE tgrelid = 'state.eg_probe'::regclass AND tgname IN ('xf_guard', 'xf_guard_end') ORDER BY tgname`,
        )
      ).rows;
      assert.equal(defs.length, 2);
      for (const { tgname, d } of defs) {
        assert.doesNotMatch(d, /WHEN|UPDATE OF/u, `${tgname} تغيّر: ${d}`);
      }
      assert.deepEqual(
        (await h.db.pool.query(`SELECT fence.coverage_problems() AS p`)).rows[0].p,
        [],
      );
    });
  },
);
