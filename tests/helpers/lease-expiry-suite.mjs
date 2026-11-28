/**
 * كتلةُ `WL-608 LIVE-75` المشتركة (‏انقضاءُ الإيجار: قدرةُ العاملِ الفعليّةُ على القراءةِ والكتابةِ عبرَه)، بقاعدةٍ وساعةٍ حقيقيّتين.
 *
 * ‏`WL-623` (‏مهلةُ الملفّ، سابقةُ `WL-555`): كانت الكتلةُ في `tests/fence/effects.test.mjs` فجاوزَ الملفُّ مهلةَ الملفِّ
 * (‏120000 ms، `test:suite`) في CI ‏46014701431 بإضافةِ اختباراتِ `LIVE-75/RLS-SILENT-SKIP` (‏كلٌّ منها ينتظرُ انقضاءَ إيجارٍ
 * أدناه 5 ث بقيدِ 0024)، وبلغت وحدَها نحوَ 101 ث محلّيّاً. نُقِلت هنا حرفيّاً، ويُشغِّلُها ملفّان: `tests/fence/lease-expiry.test.mjs`
 * (‏`part = 'base'`) و`tests/fence/lease-expiry-silent-skip.test.mjs` (‏`part = 'silent-skip'`). التقسيمُ **تجزئةٌ** بالاسم: كلُّ
 * اختبارٍ في اسمِه `SILENT-SKIP` في الثاني، وكلُّ ما سواه في الأوّل — فلا اختبارَ يسقطُ من كليهما ولا يتكرّر. التهيئةُ
 * (‏`before`) تجري في كلٍّ منهما. لم تُرفَع المهلةُ ولم يُحذَف اختبار ولم يُغيَّر تأكيد.
 *
 * ليسَ ملفَّ اختبار (‏لا يطابقُ نمطَ `test:suite`)، ولا يُسجِّلُ شيئاً إلا بنداءِ `defineLeaseExpirySuite`.
 */

import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { after, before, describe, test as nodeTest } from 'node:test';

import pg from 'pg';

import { databaseUrl, skipWithoutDatabase } from './pg.mjs';
import { startFaultProxy } from './pg-fault-proxy.mjs';
import { harness, t_note } from './fence-harness.mjs';

/** @typedef {'base' | 'silent-skip'} LeaseExpiryPart */

/** @param {string} name @returns {LeaseExpiryPart} */
export const leaseExpiryPartOf = (name) => (name.includes('SILENT-SKIP') ? 'silent-skip' : 'base');

/**
 * يُسجِّلُ اختباراتِ الجزءِ `part` وحدَه، ويُعيدُ أسماءَها (‏لتأكيدِ أنّ الجزءَ غيرُ فارغ).
 * @param {LeaseExpiryPart} part
 * @returns {string[]}
 */
export function defineLeaseExpirySuite(part) {
  /** @type {string[]} */
  const registered = [];
  /** @type {typeof nodeTest} */
  // @ts-ignore — غلافٌ يمرّرُ المعاملاتِ كما هي لِـ`node:test`
  const test = (name, ...rest) => {
    if (leaseExpiryPartOf(String(name)) !== part) return undefined;
    registered.push(String(name));
    // @ts-ignore
    return nodeTest(name, ...rest);
  };
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
        // ‏`WL-632`: و`l75_pre` على مستوى العبارةِ **قبلَ** `xf_guard` (‏`l` قبلَ `x`) — ساعتُه حدٌّ أدنى لقراءةِ الزناد، بإعلانٍ
        // ‏مستقلٍّ (‏`PRE`) لا يختلطُ بـ`STATEMENT`. فقراءةُ الزنادِ محصورةٌ بينَ `PRE` و`STATEMENT` لا مُقدَّرةٌ بأحدِهما.
        for (const sql of [
          `CREATE TABLE state.l75_c1_probe (id integer PRIMARY KEY, v text NOT NULL DEFAULT '')`,
          `CREATE FUNCTION state.l75_clock_note() RETURNS trigger LANGUAGE plpgsql AS $f$
           BEGIN
             RAISE NOTICE 'l75-clock % %', TG_LEVEL, (extract(epoch FROM clock_timestamp()) * 1000)::float8;
             IF TG_LEVEL = 'ROW' THEN RETURN NEW; END IF;
             RETURN NULL;
           END $f$`,
          `REVOKE ALL ON FUNCTION state.l75_clock_note() FROM PUBLIC`,
          `CREATE FUNCTION state.l75_clock_pre() RETURNS trigger LANGUAGE plpgsql AS $f$
           BEGIN
             RAISE NOTICE 'l75-clock PRE %', (extract(epoch FROM clock_timestamp()) * 1000)::float8;
             RETURN NULL;
           END $f$`,
          `REVOKE ALL ON FUNCTION state.l75_clock_pre() FROM PUBLIC`,
          `CREATE TRIGGER l75_pre BEFORE INSERT ON state.l75_c1_probe FOR EACH STATEMENT EXECUTE FUNCTION state.l75_clock_pre()`,
          `CREATE TRIGGER xf_guard_zz_l75 BEFORE INSERT ON state.l75_c1_probe FOR EACH STATEMENT EXECUTE FUNCTION state.l75_clock_note()`,
          `CREATE TRIGGER l75_row BEFORE INSERT ON state.l75_c1_probe FOR EACH ROW EXECUTE FUNCTION state.l75_clock_note()`,
          // ‏`WL-633` (‏مراجعةُ r6، R1): ‏AFTER ROW ينامُ لقيمةٍ واحدةٍ (‏`after-sleep`) — يُبعِدُ `xf_guard_end` (‏AFTER STATEMENT، 0038)
          // ‏عن WITH CHECK عبرَ الانقضاء، فيُرى رفضُ زنادِ النهايةِ حتميّاً لا مصادفةً.
          `CREATE FUNCTION state.l75_after_row() RETURNS trigger LANGUAGE plpgsql AS $f$
           BEGIN
             IF NEW.v = 'after-sleep' THEN
               PERFORM pg_sleep(0.4);
               RAISE NOTICE 'l75-clock AFTERROW %', (extract(epoch FROM clock_timestamp()) * 1000)::float8;
             END IF;
             RETURN NULL;
           END $f$`,
          `REVOKE ALL ON FUNCTION state.l75_after_row() FROM PUBLIC`,
          `CREATE TRIGGER l75_after_row AFTER INSERT ON state.l75_c1_probe FOR EACH ROW EXECUTE FUNCTION state.l75_after_row()`,
          `GRANT SELECT, INSERT ON state.l75_c1_probe TO xuux_worker`,
          // ‏`LIVE-75/RLS-INITPLAN` (‏`WL-620`): مِسبارٌ بصفّينِ في عبارةٍ واحدة. زنادُ الصفِّ (‏BEFORE ROW، ‏VOLATILE) يُعلِنُ لكلِّ صفٍّ
          // ‏كم صفّاً **من العبارةِ نفسِها** صارَ مرئيّاً (‏قاعدةُ PG: زنادُ BEFORE ROW يرى ما أدرجَته العبارةُ من صفوفٍ سابقة) وساعتَه،
          // ‏ثمّ — للصفِّ المتأخّرِ وحدَه — ينامُ عبرَ الانقضاءِ ويُعيدُ الصفّ، فيُفحَصُ WITH CHECK بعدَ النوم. ‏`seen = 1` في إعلانِ
          // ‏المتأخّرِ دليلٌ مستقلٌّ على أنّ الأوّلَ اجتازَ WITH CHECK وأُدرِجَ قبلَ أن يبدأَ تأخيرُ الثاني؛ وساعتُه قبلَ الانقضاءِ تنفي الرفضَ المبكّر.
          `CREATE TABLE state.l75_initplan_probe (id integer PRIMARY KEY, v text NOT NULL)`,
          `CREATE FUNCTION state.l75_initplan_row() RETURNS trigger LANGUAGE plpgsql VOLATILE AS $f$
           DECLARE seen int; late boolean; rid int;
           BEGIN
             IF TG_OP = 'INSERT' THEN
               rid := NEW.id;
               late := NEW.v = 'late';
               SELECT count(*) INTO seen FROM state.l75_initplan_probe WHERE id BETWEEN rid - 4 AND rid + 4;
             ELSIF TG_OP = 'UPDATE' THEN
               rid := NEW.id;
               late := OLD.v LIKE 'late%';
               SELECT count(*) INTO seen FROM state.l75_initplan_probe
                WHERE id BETWEEN rid - 4 AND rid + 4 AND v LIKE '%-new';
             ELSE
               rid := OLD.id;
               late := OLD.v LIKE 'slow%';
               SELECT count(*) INTO seen FROM state.l75_initplan_probe WHERE id BETWEEN rid - 4 AND rid + 4;
             END IF;
             RAISE NOTICE 'l75-ip ROW % % % %', TG_OP, rid, seen, (extract(epoch FROM clock_timestamp()) * 1000)::float8;
             IF late THEN PERFORM pg_sleep(1.5); END IF;
             IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
             RETURN NEW;
           END $f$`,
          `REVOKE ALL ON FUNCTION state.l75_initplan_row() FROM PUBLIC`,
          `CREATE TRIGGER xf_guard_zz_l75 BEFORE INSERT OR UPDATE OR DELETE ON state.l75_initplan_probe FOR EACH STATEMENT EXECUTE FUNCTION state.l75_clock_note()`,
          `CREATE TRIGGER l75_ip_row BEFORE INSERT OR UPDATE OR DELETE ON state.l75_initplan_probe FOR EACH ROW EXECUTE FUNCTION state.l75_initplan_row()`,
          `GRANT SELECT, INSERT, UPDATE, DELETE ON state.l75_initplan_probe TO xuux_worker`,
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
        return {
          role,
          c: /** @type {import('pg').Client} */ (a.client),
          exp: await expiresAt(role),
        };
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
      // ‏الخاصيّةُ تُلزِمُها 0036 (‏`WL-620`): بدونِها (‏down) تحمرُّ — العبارةُ تُقبَلُ ويُكتَبُ الصفّان؛ وصلاحيّةُ القياسِ والضابطُ لازمانِ دائماً.
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
          const row = /^l75-ip ROW (INSERT|UPDATE|DELETE) (\d+) (\d+) ([0-9.]+)$/u.exec(msg);
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
        assert.ok(
          m.startedAt < m.exp && m.endedAt > m.exp + 500,
          'WITH CHECK للثاني بعدَ الانقضاء',
        );
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

      test('LIVE-75/RLS-INITPLAN (‏0036): صفٌّ ثانٍ فُحِصَ بعدَ الانقضاءِ في عبارةٍ اجتازَ صفُّها الأوّلُ الفحصَ قبلَه ⇒ 42501 برسالةِ RLS، ولا يُكتَبُ صفّ', async () => {
        const m = await ipInsert();
        assert.equal(m.r.ok, false, `العبارةُ قُبِلَت وكُتِبَ ${m.rows.length} صفّ`);
        assert.equal(m.r.code, '42501', String(m.r.message));
        assert.deepEqual(m.rows, [], 'العبارةُ ذرّيّة: لا الثاني ولا الأوّل');
      });

      test('LIVE-75/RLS-INITPLAN صلاحيّةُ القياس (‏UPDATE): خطّةٌ بلا Sort/Materialize، والصفُّ الأوّلُ حُدِّثَ قبلَ تأخيرِ الثاني، وقيمةُ الثاني فُحِصَت بعدَ الانقضاء', async () => {
        const m = await ipUpdate();
        assertIpValid(m, 'Update', [60860, 60861]);
      });

      test('LIVE-75/RLS-INITPLAN (‏0036) UPDATE: قيمةٌ جديدةٌ فُحِصَت بعدَ الانقضاءِ في عبارةٍ اجتازَ صفُّها الأوّلُ الفحصَ قبلَه ⇒ 42501، ولا يتغيّرُ صفّ', async () => {
        const m = await ipUpdate();
        assert.equal(m.r.ok, false, 'UPDATE عبرَ الانقضاءِ قُبِل');
        assert.equal(m.r.code, '42501', String(m.r.message));
        assert.deepEqual(m.rows, [
          { id: 60860, v: 'first-u' },
          { id: 60861, v: 'late-u' },
        ]);
      });

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

      // ‏═══ ‏`LIVE-75/RLS-SILENT-SKIP` (‏`WL-622`، يُصلِحُه 0037 — كانَ يُثبَّتُ حدّاً في `WL-620`) ═══════════════════════════════════
      // ‏العيبُ بعدَ 0036: ‏USING لصفٍّ تبلغُه UPDATE/DELETE بعدَ الانقضاءِ ‏false بلا خطأ — فالعبارةُ تلتزمُ مطبَّقةً جزئيّاً. 0037: عبارةٌ
      // ‏بدأت داخلَ النافذةِ وبلغت صفّاً خارجَها ⇒ ‏XF009 من `fence.window_breach` ⇒ العبارةُ كلُّها تسقط (‏لا صفَّ محذوفاً ولا معدَّلاً).
      // ‏كلُّ اختبارٍ يُثبِتُ صلاحيّتَه (‏guard_write اجتيزَ قبلَ الانقضاء، والصفُّ الثاني بُلِغَ بعدَه) قبلَ أن يحكم؛ والطفرةُ (‏إزالةُ 0037)
      // ‏تُحمِّرُها كلَّها والضوابطُ تبقى خضراء (‏`WL-622`، ‏`/tmp/rls/mut-0037.tap`).
      /** @param {Array<{ id: number, v: string }>} rows */
      const seedIp = (rows) =>
        h.db.pool.query(
          `INSERT INTO state.l75_initplan_probe (id, v) SELECT * FROM jsonb_to_recordset($1::jsonb) AS x(id int, v text)`,
          [JSON.stringify(rows)],
        );
      /** @param {number[]} ids */
      const ipRows = async (ids) =>
        (
          await h.db.pool.query(
            'SELECT id, v FROM state.l75_initplan_probe WHERE id = ANY($1::int[]) ORDER BY id',
            [ids],
          )
        ).rows;
      /** @param {IpRun} m */
      const guardBefore = (m) => {
        const st = m.notes.filter((n) => n.level === 'STATEMENT');
        assert.ok(
          st.length === 1 && (st[0]?.at ?? Infinity) < m.exp,
          'guard_write اجتيزَ قبلَ الانقضاء',
        );
      };
      /** @param {any} r */
      const isBreach = (r) => {
        assert.equal(r.ok, false, `العبارةُ قُبِلَت: ${JSON.stringify(r)}`);
        assert.equal(r.code, 'XF009', String(r.message));
        assert.match(String(r.message), /الإيجارُ انقضى أثناءَ العبارة/u);
      };

      test('LIVE-75/RLS-SILENT-SKIP (‏0037) DELETE: صفٌّ أوّلُ حُذِفَ ثمّ صفٌّ ثانٍ بُلِغَ بعدَ الانقضاء ⇒ XF009 والعبارةُ كلُّها تسقط — الصفّانِ باقيان', async () => {
        await seedIp([
          { id: 60880, v: 'slow-d' },
          { id: 60881, v: 'other-d' },
        ]);
        const m = await runIp(
          'alpha',
          `DELETE FROM state.l75_initplan_probe WHERE id IN (60880, 60881) RETURNING id`,
          [60880, 60881],
          true,
        );
        assert.match(m.plan[0] ?? '', /^Delete on state\.l75_initplan_probe/u, m.plan.join('\n'));
        assert.deepEqual(
          m.plan.filter((l) => IP_BUFFERING.test(l)),
          [],
          m.plan.join('\n'),
        );
        assert.equal(m.okBefore, true);
        assert.equal(m.okAfter, false);
        guardBefore(m);
        const rows = /** @type {Array<Extract<IpNote, { level: 'ROW' }>>} */ (
          m.notes.filter((n) => n.level === 'ROW')
        );
        // ‏صلاحيّة: الصفُّ الأوّلُ اجتازَ USING وبلغَ زنادَه قبلَ الانقضاء (‏فحُذِفَ داخلَ العبارة)، والعبارةُ عبرت الانقضاءَ بأكثرَ من 500 ms.
        assert.deepEqual(
          rows.map((n) => [n.op, n.id]),
          [['DELETE', 60880]],
        );
        assert.ok(
          (rows[0]?.at ?? Infinity) < m.exp && m.endedAt > m.exp + 500,
          'الصفُّ الثاني بُلِغَ بعدَ الانقضاء',
        );
        isBreach(m.r);
        assert.deepEqual(
          m.rows,
          [
            { id: 60880, v: 'slow-d' },
            { id: 60881, v: 'other-d' },
          ],
          'تراجعٌ كامل: لا الأوّلُ محذوفٌ ولا الثاني',
        );
        t_note('LIVE-75/RLS-SILENT-SKIP', {
          op: 'DELETE',
          statement: String(m.r.code),
          secondRowReachedAfterExpiryMs: Math.round(Number(rows[0]?.at) + 1500 - m.exp),
          rowsRemaining: m.rows.length,
        });
      });

      test('LIVE-75/RLS-SILENT-SKIP (‏0037) أوّلُ صفٍّ بعدَ الانقضاء: عبارةٌ اجتازت guard_write قبلَه وبلغت صفَّها الأوّلَ بعدَه (‏InitPlan كسول) ⇒ XF009 لا «DELETE 0» صامت', async () => {
        await seedIp([
          { id: 60882, v: 'a-d' },
          { id: 60883, v: 'b-d' },
        ]);
        const a = await bootWorker('alpha');
        /** @type {IpNote[]} */
        const notes = [];
        a.c.on('notice', (/** @type {any} */ n) => {
          const st = /^l75-clock STATEMENT ([0-9.]+)$/u.exec(String(n.message));
          if (st) notes.push({ level: 'STATEMENT', at: Number(st[1]) });
        });
        // ‏مفتاحُ الفهرسِ ‏InitPlan ينامُ 1.5 ث: يُقيَّمُ عندَ بدءِ المسحِ قبلَ أيِّ صفّ، فأوّلُ تقييمٍ لـxf_read (‏ونافذتِه) بعدَ الانقضاء.
        const sql = `DELETE FROM state.l75_initplan_probe
                      WHERE id = ANY (ARRAY(SELECT x FROM (VALUES (60882), (60883)) q(x), pg_sleep(1.5) s)) RETURNING id`;
        await a.c.query('SET enable_seqscan = off');
        const plan = (await a.c.query(`EXPLAIN (COSTS OFF) ${sql}`)).rows.map((x) =>
          String(x['QUERY PLAN']),
        );
        assert.ok(
          plan.some((l) => /Index Cond: \(id = ANY \(\(InitPlan 1\)/u.test(l)),
          plan.join('\n'),
        );
        await untilDb(a.exp - 700);
        const startedAt = await dbNow();
        const r = await outcome(a.c, sql);
        const endedAt = await dbNow();
        await a.c.query('RESET enable_seqscan');
        assert.ok(startedAt < a.exp && endedAt > a.exp + 500, 'العبارةُ عبرت الانقضاء');
        assert.ok(
          notes.length === 1 && (notes[0]?.at ?? Infinity) < a.exp,
          'guard_write اجتيزَ قبلَ الانقضاء',
        );
        isBreach(r);
        assert.deepEqual(await ipRows([60882, 60883]), [
          { id: 60882, v: 'a-d' },
          { id: 60883, v: 'b-d' },
        ]);
        t_note('LIVE-75/RLS-SILENT-SKIP', {
          op: 'DELETE-lazy-initplan',
          statement: String(r.code),
        });
      });

      /**
       * التزامنُ الحقيقيّ: معاملةٌ أخرى تُعدِّلُ الصفَّ الثانيَ وتقفلُه عبرَ الانقضاء؛ فعبارةُ العامل — بدأت قبلَه وطبّقت الأوّل —
       * تنتظرُ القفل، ثمّ يُعيدُ PG فحصَ شروطِ الصفِّ على نسختِه الجديدة (‏EvalPlanQual) ومنها USING بعدَ الانقضاء.
       * @param {'UPDATE' | 'DELETE'} op @param {[number, number]} ids @param {boolean} crossExpiry
       */
      const epqRun = async (op, [id1, id2], crossExpiry) => {
        await seedIp([
          { id: id1, v: 'one' },
          { id: id2, v: 'two' },
        ]);
        const a = await bootWorker(crossExpiry ? 'alpha' : 'beta');
        const pid = Number((await a.c.query('SELECT pg_backend_pid() AS p')).rows[0].p);
        const locker = await h.db.pool.connect();
        try {
          if (crossExpiry) await untilDb(a.exp - 1200);
          await locker.query('BEGIN');
          await locker.query(`UPDATE state.l75_initplan_probe SET v = 'two-locked' WHERE id = $1`, [
            id2,
          ]);
          const sql =
            op === 'UPDATE'
              ? `UPDATE state.l75_initplan_probe SET v = v || '-w' WHERE id IN (${id1}, ${id2}) RETURNING id`
              : `DELETE FROM state.l75_initplan_probe WHERE id IN (${id1}, ${id2}) RETURNING id`;
          const startedAt = await dbNow();
          const pending = outcome(a.c, sql);
          // ‏صلاحيّة: العاملُ ينتظرُ قفلَ الصفِّ فعلاً (‏لا افتراض).
          let waiting = false;
          for (let i = 0; i < 100 && !waiting; i++) {
            waiting =
              (
                await h.db.pool.query(
                  `SELECT wait_event_type = 'Lock' AS w FROM pg_stat_activity WHERE pid = $1`,
                  [pid],
                )
              ).rows[0]?.w === true;
            if (!waiting) await sleep(20);
          }
          assert.ok(waiting, 'العاملُ ينتظرُ قفلَ الصفِّ الثاني');
          const waitSeenAt = await dbNow();
          if (crossExpiry) await untilDb(a.exp + 300);
          const releasedAt = await dbNow();
          await locker.query('COMMIT');
          const r = await pending;
          return { a, r, startedAt, waitSeenAt, releasedAt, rows: await ipRows([id1, id2]) };
        } finally {
          await locker.query('ROLLBACK').catch(() => {});
          locker.release();
        }
      };

      for (const [op, ids] of /** @type {const} */ ([
        ['UPDATE', [60884, 60885]],
        ['DELETE', [60886, 60887]],
      ]))
        test(`LIVE-75/RLS-SILENT-SKIP (‏0037) تزامن ${op}: صفٌّ مقفلٌ عبرَ الانقضاءِ يُعادُ فحصُه بعدَه (‏EvalPlanQual) ⇒ XF009 والصفُّ الأوّلُ لا يتغيّر`, async () => {
          const m = await epqRun(op, [...ids], true);
          assert.ok(
            m.startedAt < m.a.exp && m.waitSeenAt < m.a.exp,
            'بدأت العبارةُ وانتظرت قبلَ الانقضاء',
          );
          assert.ok(m.releasedAt > m.a.exp, 'القفلُ حُرِّرَ بعدَ الانقضاء');
          isBreach(m.r);
          assert.deepEqual(m.rows, [
            { id: ids[0], v: 'one' },
            { id: ids[1], v: 'two-locked' },
          ]);
        });

      test('LIVE-75/RLS-SILENT-SKIP ضابطُ التزامن: القفلُ نفسُه يُحرَّرُ قبلَ الانقضاء ⇒ UPDATE كاملٌ على الصفّين (‏الرفضُ سببُه الزمن)', async () => {
        const m = await epqRun('UPDATE', [60888, 60889], false);
        assert.ok(m.releasedAt < m.a.exp - 500);
        assert.equal(m.r.ok, true, String(/** @type {any} */ (m.r).message));
        assert.equal(m.r.rows?.length, 2);
        assert.deepEqual(m.rows, [
          { id: 60888, v: 'one-w' },
          { id: 60889, v: 'two-locked-w' },
        ]);
      });

      test('LIVE-75/RLS-SILENT-SKIP (‏0037) تجديدٌ أثناءَ العبارة: نافذةُ العبارةِ لقطتُها — صفٌّ بعدَ الانقضاءِ القديمِ ⇒ XF009 (‏فشلٌ مغلق)، وإعادةُ المحاولةِ بعدَ التجديدِ تنجحُ كاملة', async () => {
        await seedIp([
          { id: 60890, v: 'slow-r' },
          { id: 60891, v: 'other-r' },
        ]);
        const sql = `DELETE FROM state.l75_initplan_probe WHERE id IN (60890, 60891) RETURNING id`;
        const a = await bootWorker('alpha');
        await untilDb(a.exp - 700);
        const pending = outcome(a.c, sql);
        await sleep(250);
        const renewedTo = new Date(await h.root.renewLease(a.role)).getTime();
        const renewedAt = await dbNow();
        const r = await pending;
        const endedAt = await dbNow();
        assert.ok(renewedAt < a.exp, 'التجديدُ التزمَ قبلَ الانقضاءِ القديم');
        assert.ok(
          endedAt > a.exp + 500 && endedAt < renewedTo,
          'الصفُّ الثاني بُلِغَ بعدَ القديمِ وداخلَ الجديد',
        );
        isBreach(r);
        assert.deepEqual(await ipRows([60890, 60891]), [
          { id: 60890, v: 'slow-r' },
          { id: 60891, v: 'other-r' },
        ]);
        const retry = await outcome(a.c, sql);
        assert.equal(retry.ok, true, String(/** @type {any} */ (retry).message));
        assert.deepEqual(
          await ipRows([60890, 60891]),
          [],
          'إعادةُ المحاولةِ بنافذةِ التجديد: حذفٌ كامل',
        );
      });

      test('LIVE-75/RLS-SILENT-SKIP ضابطٌ إيجابيّ: DELETE نفسُه بالتأخيرِ نفسِه قبلَ الانقضاءِ يحذفُ الصفّين', async () => {
        await seedIp([
          { id: 60892, v: 'slow-c' },
          { id: 60893, v: 'other-c' },
        ]);
        const m = await runIp(
          'beta',
          `DELETE FROM state.l75_initplan_probe WHERE id IN (60892, 60893) RETURNING id`,
          [60892, 60893],
          false,
        );
        assert.ok(m.endedAt < m.exp - 500, 'العبارةُ كلُّها قبلَ الانقضاء');
        assert.equal(m.r.ok, true, String(m.r.message));
        assert.equal(m.r.rows.length, 2);
        assert.deepEqual(m.rows, []);
      });

      test('LIVE-75/RLS-SILENT-SKIP (‏0037) القراءة: SELECT بلغَ صفَّه الثانيَ بعدَ الانقضاء ⇒ XF009 لا نتيجةٌ مبتورةٌ صامتة؛ وSELECT بدأ بعدَه ⇒ صفرٌ بلا خطأ (‏L75-R1 كما هو)', async () => {
        await seedIp([
          { id: 60894, v: 'r1' },
          { id: 60895, v: 'r2' },
        ]);
        const a = await bootWorker('alpha');
        // ‏كلُّ صفٍّ ينامُ 1.5 ث بعدَ اجتيازِه USING: أيّاً كانَ الأوّل، الثاني يُبلَغُ بعدَ الانقضاء (‏لا افتراضَ لترتيبِ الكومة).
        const sql = `SELECT id, pg_sleep(1.5) IS NOT NULL AS s
                       FROM state.l75_initplan_probe WHERE id IN (60894, 60895)`;
        const plan = (await a.c.query(`EXPLAIN (COSTS OFF) ${sql}`)).rows.map((x) =>
          String(x['QUERY PLAN']),
        );
        assert.deepEqual(
          plan.filter((l) => IP_BUFFERING.test(l)),
          [],
          plan.join('\n'),
        );
        await untilDb(a.exp - 700);
        const startedAt = await dbNow();
        const r = await outcome(a.c, sql);
        const endedAt = await dbNow();
        assert.ok(startedAt < a.exp && endedAt > a.exp + 500);
        isBreach(r);
        assert.deepEqual(
          await outcome(a.c, `SELECT id FROM state.l75_initplan_probe WHERE id IN (60894, 60895)`),
          {
            ok: true,
            command: 'SELECT',
            rows: [],
          },
        );
      });

      test('LIVE-75/RLS-SILENT-SKIP (‏0037) تكافؤ: read_ok() ⇔ clock_timestamp() <@ read_window() للعاملِ قبلَ الانقضاءِ وبعدَه ولغيرِ العامل، والنافذةُ لا تتغيّرُ بالساعة', async () => {
        const a = await bootWorker('alpha');
        const probe = async (/** @type {import('pg').Client | import('pg').Pool} */ c) =>
          (
            await c.query(
              `SELECT fence.read_ok() AS ok, clock_timestamp() <@ fence.read_window() AS inw, fence.read_window()::text AS w`,
            )
          ).rows[0];
        const before = await probe(a.c);
        assert.deepEqual([before.ok, before.inw], [true, true]);
        assert.notEqual(before.w, 'empty');
        await untilDb(a.exp + 200);
        const after = await probe(a.c);
        assert.deepEqual([after.ok, after.inw], [false, false]);
        assert.equal(after.w, before.w, 'النافذةُ نفسُها بعدَ الانقضاء — الساعةُ خارجَها');
        const su = await probe(h.db.pool);
        assert.deepEqual([su.ok, su.inw, su.w], [true, true, '(,)']);
      });

      test('LIVE-75/RLS-INITPLAN + SILENT-SKIP بنيويّ (‏0036+0037): كلُّ سياسةِ xf_read على علاقةٍ محميّةٍ بالصيغةِ القانونيّةِ حرفيّاً (‏الساعةُ لكلِّ صفّ؛ USING يرفعُ خارجَ النافذة)، ولا متساهلةَ غيرُها', async () => {
        const rows = (
          await h.db.pool.query(
            `SELECT pr.schema_name || '.' || pr.rel_name AS rel,
                    btrim(regexp_replace(pg_get_expr(po.polqual, po.polrelid), '\\s+', ' ', 'g')) AS q,
                      pg_get_expr(po.polwithcheck, po.polrelid) AS w
                 FROM fence.protected_relations() pr JOIN pg_policy po ON po.polrelid = pr.relid AND po.polname = 'xf_read'`,
          )
        ).rows;
        // ‏مطابقةٌ حرفيّةٌ لا تطابقُ نمط: `clock_timestamp() OR true` ليس إصلاحاً.
        const canon = '(clock_timestamp() <@ ( SELECT fence.read_window() AS read_window))';
        const canonQ =
          'CASE WHEN (clock_timestamp() <@ ( SELECT fence.read_window() AS read_window)) THEN true ELSE fence.window_breach(( SELECT fence.read_window() AS read_window)) END';
        const n = Number(
          (await h.db.pool.query('SELECT count(*)::int AS n FROM fence.protected_relations()'))
            .rows[0].n,
        );
        assert.ok(
          rows.length > 0 && rows.length === n,
          `xf_read على كلِّ علاقةٍ محميّة (${rows.length}/${n})`,
        );
        for (const r of rows) assert.deepEqual([r.q, r.w], [canonQ, canon], r.rel);
        const extra = (
          await h.db.pool.query(
            `SELECT po.polrelid::regclass::text AS rel, po.polname FROM fence.protected_relations() pr
                 JOIN pg_policy po ON po.polrelid = pr.relid WHERE po.polname <> 'xf_read' AND po.polpermissive`,
          )
        ).rows;
        assert.deepEqual(extra, [], 'لا سياسةَ متساهلةً أخرى تُضَمُّ بـOR');
      });

      // ‏`WL-628` (‏0038): داخلَ معاملةٍ بدأت قبلَ الانقضاءِ لم تَعُد القراءةُ صفراً صامتاً — ‏`window_breach` بساعةِ المعاملة ⇒ ‏XF009
      // ‏(‏السببُ نفسُه لمؤشّرٍ يُبتَرُ صامتاً: المُستدعي لا يميّزُ الرفضَ من الفراغ). خارجَها (‏معاملةٌ بدأت بعدَه) بلا تغيير: صفرٌ صامت.
      test('L75-R1: القراءة — قبلَ الانقضاءِ ترى، وبعدَه داخلَ REPEATABLE READ بدأت قبلَه ⇒ XF009، وخارجَها صفرُ صفوفٍ بلا خطأ', async () => {
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
        const inTx = await outcome(
          a.c,
          `SELECT count(*)::int AS n FROM state.fence_probe WHERE id = 60806`,
        );
        assert.deepEqual(
          inTx,
          { ok: false, code: 'XF009' },
          'داخلَ المعاملةِ نفسِها: read_ok بساعةٍ حقيقيّةٍ لا بلقطة، والرفضُ مُعلَن',
        );
        assert.equal((await outcome(a.c, 'ROLLBACK')).command, 'ROLLBACK');
        assert.equal(await count(), 0, 'خارجَها: لا صفوف');
        // ‏الخطأُ غيرُ مُعلَن: القراءةُ صفرٌ صامت — المُستدعي لا يعرفُ أنّه مرفوض.
        const r = await outcome(a.c, `SELECT id FROM state.fence_probe`);
        assert.deepEqual(r, { ok: true, command: 'SELECT', rows: [] });
        t_note('L75-R1', {
          beforeExpiry: 1,
          afterExpiryInRepeatableRead: 'XF009',
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
          const m = /^l75-clock (PRE|STATEMENT|ROW) ([0-9.]+)$/u.exec(String(n.message));
          if (m) clocks.push({ level: String(m[1]), at: Number(m[2]) });
        });
        await untilDb(a.exp - 400);
        /** @type {Array<{ at: number, ok: boolean, code?: string | undefined, message?: string | undefined, preAt?: number | undefined, guardAt?: number | undefined, rowAt?: number | undefined, id: number }>} */
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
            preAt: clocks.find((c) => c.level === 'PRE')?.at,
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
        const endGuardPath = rejected?.code === 'XF009' && rejected.guardAt !== undefined;
        if (endGuardPath) {
          // ‏`WL-633` (‏مراجعةُ r6، R1): مخرجٌ ثالثٌ منذُ 0038 — `xf_guard` وWITH CHECK اجتازا قبلَ الانقضاء، ثمّ `xf_guard_end`
          // ‏(‏AFTER STATEMENT) قرأَ الساعةَ بعدَه ⇒ XF009 بعدَ صفٍّ أُنتِج. شروطُه اللازمة: `PRE < exp` (‏الزنادُ الأوّلُ اجتاز)،
          // ‏و`ROW < exp` (‏RLS تقرأُ بعدَ مِسبارِ الصفِّ واجتازت)، والرفضُ وصلَ بعدَ الانقضاء (‏`at` ساعةُ القاعدةِ بعدَه: حدٌّ أعلى لقراءةِ زنادِ النهاية).
          // ‏والحتميُّ منه في «L75-C1-END».
          assert.ok(rejected.rowAt !== undefined, 'زنادُ النهاية: صفٌّ أُنتِجَ قبلَه');
          assert.ok(
            rejected.preAt !== undefined && rejected.preAt < a.exp,
            'زنادُ النهاية: الزنادُ الأوّلُ قرأَ قبلَ الانقضاء',
          );
          assert.ok(
            Number(rejected.rowAt) < a.exp,
            `زنادُ النهاية: ‏RLS اجتازت قبلَ الانقضاء (‏${Number(rejected.rowAt) - a.exp} ms)`,
          );
          assert.ok(
            rejected.at >= a.exp,
            `زنادُ النهاية رفضَ قبلَ الانقضاء (‏${rejected.at - a.exp} ms) — رفضٌ مبكّر`,
          );
          t_note('L75-C1-ENDPATH', {
            preMinusExpiryMs: Number(rejected.preAt) - a.exp,
            rowMinusExpiryMs: Number(rejected.rowAt) - a.exp,
            rejectedMinusExpiryMs: rejected.at - a.exp,
          });
        } else if (rejected?.code === 'XF009') {
          // ‏الزنادُ رفضَ قبلَ أيِّ صفّ: لا مِسبارَ بعدَه أُطلِق.
          assert.equal(
            rejected.guardAt,
            undefined,
            'XF009 والمِسبارُ بعدَ الزنادِ أُطلِق — الرفضُ ليس من الزناد',
          );
          assert.equal(rejected.rowAt, undefined);
          // ‏`WL-632`: و`PRE` أُطلِقَ قبلَ رفضِ الزناد — دليلٌ على أنّه قبلَ `xf_guard` في الترتيبِ فعلاً، لا افتراضاً من الاسم.
          assert.ok(rejected.preAt !== undefined, 'مِسبارُ PRE يُطلَقُ قبلَ xf_guard');
        } else {
          // ‏مسارُ C1-RACE وحدَه: الزنادُ اجتازَ الساعةَ قبلَ الانقضاء، ثمّ RLS رفضت الصفّ — لا «أيُّ 42501».
          assert.equal(
            rejected?.code,
            '42501',
            `رمزٌ ثالث: ${rejected?.code} ${rejected?.message}`,
          );
          assert.match(
            String(rejected?.message),
            /new row violates row-level security policy for table "l75_c1_probe"/u,
          );
          // ‏`WL-632`: قراءةُ الزنادِ في [‏`PRE`، `STATEMENT`]. كانَ الشرطُ `STATEMENT < exp` — أي الحدُّ الأعلى — فرسبَ على CI
          // ‏(‏run 46105237618) بـ`STATEMENT − exp = +0.072 ms`: انقضاءٌ وقعَ بينَ قراءةِ الزنادِ ومِسبارِه، لا زنادٌ اجتازَ بعدَه.
          // ‏فالمُثبَتُ بالقياس: `PRE < exp` شرطٌ لازم (‏وإلّا فقراءةُ الزنادِ بعدَ الانقضاءِ قطعاً وكانَ عليه XF009)، والحصرُ
          // ‏معلَن. وإن وقعَ `exp` داخلَ [‏`PRE`، `STATEMENT`] فالقياسُ لا يفصلُ — يُعلَنُ ولا يُحسَبُ إثباتاً؛ والفصلُ الحتميُّ في C1-RACE.
          assert.ok(rejected?.preAt !== undefined, 'مِسبارُ ما قبلَ الزنادِ أُطلِق');
          assert.ok(
            rejected?.guardAt !== undefined &&
              rejected?.preAt !== undefined &&
              rejected.preAt <= rejected.guardAt,
            'ترتيبُ المِسبارَين: PRE قبلَ STATEMENT',
          );
          assert.ok(
            Number(rejected?.preAt) < a.exp,
            `42501 والزنادُ قرأَ الساعةَ بعدَ الانقضاءِ قطعاً (‏PRE − exp = ${Number(rejected?.preAt) - a.exp} ms) — كانَ عليه XF009`,
          );
          if (Number(rejected?.guardAt) >= a.exp)
            t_note('L75-C1-BRACKET', {
              preMinusExpiryMs: Number(rejected?.preAt) - a.exp,
              guardMinusExpiryMs: Number(rejected?.guardAt) - a.exp,
            });
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
          rejectedPreMinusExpiryMs: r2(rejected?.preAt),
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
            await h.db.pool.query(
              'SELECT count(*)::int AS n FROM state.l75_c1_probe WHERE id = $1',
              [id],
            )
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

      test('L75-C1-END: زنادُ النهايةِ حتميّاً (‏0038) — عبارةٌ اجتازت `xf_guard` وWITH CHECK قبلَ الانقضاءِ وانتهت بعدَه ⇒ XF009 ولا صفّ', async () => {
        const a = await bootWorker('alpha');
        const ends = (
          await h.db.pool.query(
            `SELECT count(*)::int AS n FROM pg_trigger WHERE tgrelid = 'state.l75_c1_probe'::regclass AND tgname = 'xf_guard_end'`,
          )
        ).rows[0].n;
        assert.equal(ends, 1, 'جدولُ المِسبارِ مُغطّى بزنادِ النهاية');
        /** @type {Array<{ level: string, at: number }>} */
        const clocks = [];
        a.c.on('notice', (/** @type {any} */ n) => {
          const m = /^l75-clock (PRE|STATEMENT|ROW|AFTERROW) ([0-9.]+)$/u.exec(String(n.message));
          if (m) clocks.push({ level: String(m[1]), at: Number(m[2]) });
        });
        const at = (/** @type {string} */ level) => clocks.find((c) => c.level === level)?.at;
        await untilDb(a.exp - 150);
        const startedAt = await dbNow();
        const r = await outcome(
          a.c,
          `INSERT INTO state.l75_c1_probe (id, v) VALUES (61300, 'after-sleep')`,
        );
        const endedAt = await dbNow();
        assert.ok(startedAt < a.exp && endedAt > a.exp, 'العبارةُ عبرَت الانقضاء');
        assert.equal(r.code, 'XF009', String(/** @type {any} */ (r).message));
        const [pre, st, row, afterRow] = ['PRE', 'STATEMENT', 'ROW', 'AFTERROW'].map(at);
        assert.ok(
          pre !== undefined && st !== undefined && pre < a.exp && st < a.exp,
          'الزنادُ الأوّلُ اجتازَ قبلَ الانقضاء',
        );
        assert.ok(row !== undefined && row < a.exp, 'RLS اجتازت قبلَ الانقضاء');
        assert.ok(
          afterRow !== undefined && afterRow > a.exp,
          'ما قبلَ زنادِ النهايةِ بعدَ الانقضاء',
        );
        const n = (
          await h.db.pool.query(
            'SELECT count(*)::int AS n FROM state.l75_c1_probe WHERE id = 61300',
          )
        ).rows[0].n;
        assert.equal(n, 0, 'لا صفَّ كُتِب');
        t_note('L75-C1-END', {
          startBeforeExpiryMs: Math.round(a.exp - startedAt),
          rowMinusExpiryMs: Math.round((Number(row) - a.exp) * 100) / 100,
          afterRowMinusExpiryMs: Math.round((Number(afterRow) - a.exp) * 100) / 100,
          code: r.code,
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
        const late = await outcome(
          b.c,
          `INSERT INTO state.fence_probe (id, v) VALUES (61201, 'x')`,
        );
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
  return registered;
}
