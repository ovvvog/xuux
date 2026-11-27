/**
 * اختبارات نظام الهجرات — الخطوة `M3.03`.
 *
 * معيار القبول في خارطة الطريق: «`migrate up` ثم `migrate down` يعودان بالقاعدة
 * إلى حالتها الأصلية». وهذا يُقاس هنا **بصورة من كتالوج القاعدة** قبل التقديم
 * وبعد التراجع، لا بالثقة بأن `DROP` نظّف. ومعها اختبارات ما يُفشل النظام: بصمة
 * تغيّرت، وثغرة ترقيم، وهجرة بلا تراجع، وهجرة تسقط في منتصفها.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, describe, it } from 'node:test';
import { registerTmpRoot } from '../helpers/tmp-roots.mjs';
import {
  DEFAULT_MIGRATIONS_DIR,
  MIGRATION_ERRORS,
  down,
  loadMigrations,
  readApplied,
  status,
  up,
} from '../../src/persistence/migrator.mjs';
import { catalogSnapshot, createIsolatedDatabase, skipWithoutDatabase } from '../helpers/pg.mjs';

/** أنشئ مجلد هجرات مؤقتاً بمحتوى معطى. */
/**
 * @param {Record<string, string>} files
 * @returns {string}
 */
function tempMigrationsDir(files) {
  const dir = registerTmpRoot(fs.mkdtempSync(path.join(os.tmpdir(), 'migrations-')));
  for (const [name, body] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, name), body, 'utf8');
  }
  return dir;
}

// ── قراءة الهجرات والتحقّق من تماسكها (لا تحتاج قاعدة) ────────────────────────

test('هجرات المستودع الحقيقية تُقرأ ولكل واحدة تراجع', () => {
  const migrations = loadMigrations(DEFAULT_MIGRATIONS_DIR);
  assert.ok(migrations.length >= 1, 'لا هجرة في المستودع');
  assert.equal(migrations[0]?.version, 1);
  for (const migration of migrations) {
    assert.ok(migration.down.trim().length > 0, `الهجرة ${migration.version} بلا تراجع`);
    assert.match(migration.checksum, /^[0-9a-f]{64}$/);
  }
});

test('هجرة بلا ملف تراجع تُرفض قبل أن تُنفَّذ', () => {
  const dir = tempMigrationsDir({ '0001_only_up.up.sql': 'SELECT 1;' });
  assert.throws(
    () => loadMigrations(dir),
    (/** @type {unknown} */ error) =>
      /** @type {{ code?: string }} */ (error).code === MIGRATION_ERRORS.DOWN_MISSING,
  );
});

test('ثغرة في الترقيم تُكشف', () => {
  const dir = tempMigrationsDir({
    '0001_a.up.sql': 'SELECT 1;',
    '0001_a.down.sql': 'SELECT 1;',
    '0003_c.up.sql': 'SELECT 1;',
    '0003_c.down.sql': 'SELECT 1;',
  });
  assert.throws(
    () => loadMigrations(dir),
    (/** @type {unknown} */ error) =>
      /** @type {{ code?: string }} */ (error).code === MIGRATION_ERRORS.GAP,
  );
});

test('رقم واحد لاسمين — تصادم فرعين — يُكشف', () => {
  const dir = tempMigrationsDir({
    '0001_a.up.sql': 'SELECT 1;',
    '0001_a.down.sql': 'SELECT 1;',
    '0001_b.up.sql': 'SELECT 1;',
    '0001_b.down.sql': 'SELECT 1;',
  });
  assert.throws(
    () => loadMigrations(dir),
    (/** @type {unknown} */ error) =>
      /** @type {{ code?: string }} */ (error).code === MIGRATION_ERRORS.DUPLICATE,
  );
});

test('اسم لا يطابق الصيغة يُرفض', () => {
  const dir = tempMigrationsDir({ 'schema.sql': 'SELECT 1;' });
  assert.throws(
    () => loadMigrations(dir),
    (/** @type {unknown} */ error) =>
      /** @type {{ code?: string }} */ (error).code === MIGRATION_ERRORS.BAD_NAME,
  );
});

// ── ما لا يُبرهن إلا على قاعدة حقيقية ────────────────────────────────────────

test(
  'up ثم down يعودان بالقاعدة إلى حالتها الأصلية — بمقايسة الكتالوج',
  { skip: skipWithoutDatabase },
  async () => {
    const db = await createIsolatedDatabase('roundtrip');
    try {
      const before = await catalogSnapshot(db.pool);

      // الأرقام تُقرأ من المستودع لا تُثبَّت في الاختبار: تثبيتُ «[1]» يعني أن
      // إضافة أي هجرة تُفشل اختباراً لا علاقة له بصحّتها.
      const versions = (await loadMigrations()).map((migration) => migration.version);
      const latest = versions[versions.length - 1];
      assert.ok(latest !== undefined, 'لا هجرات في المستودع');

      const applied = await up(db.pool);
      assert.deepEqual(applied.applied, versions);
      assert.equal(applied.current, latest);

      const tables = await db.pool.query(
        `SELECT table_name FROM information_schema.tables WHERE table_schema = 'state' ORDER BY table_name`,
      );
      assert.deepEqual(
        tables.rows.map((row) => /** @type {Record<string, unknown>} */ (row)['table_name']),
        [
          // النواة والحوكمة والتشغيل (`0001`–`0005`)
          'agents',
          'cases',
          'certificate_revocations',
          'classification_approvals',
          'commands',
          'data_assets',
          // النسب والاحتفاظ والقنوات (`0007`–`0010`)
          'data_lineage',
          'erasure_records',
          'event_messages',
          'event_offsets',
          'events',
          // الاتحاد (`0016`–`0017`)
          'federation_delegation_register',
          'federation_delegations',
          'federation_local_acts',
          'federation_refusals',
          // المؤسسات وولاياتها (`0014`–`0015`)
          'institution_breaches',
          'institution_mandates',
          'institution_outputs',
          'institution_report_cycles',
          'institution_tasks',
          'institutions',
          'laws',
          'memories',
          'models',
          'policies',
          'policy_decisions',
          'policy_versions',
          'quotas',
          // التقارير الملكية (`0018`)
          'royal_reports',
          // الجدولة (`0021`)
          'scheduled_runs',
          'task_dead_letters',
          'task_transitions',
          'tasks',
          // سجلُّ إقلاعِ العمالِ (`0023`)
          'worker_registrations',
        ],
        // القائمةُ مُثبَّتةٌ قصداً — لا تُشتقّ من القاعدة نفسها: قائمةٌ تُقرأ من
        // القاعدة تُصادق على أيِّ جدولٍ يظهر فيها ولا تكشف جدولاً أُضيف بلا قرار.
        // وكانت متوقّفةً عند خمسة عشر جدولاً (حال `M5.01`) فأخفقت من أوّلِ هجرةٍ
        // بعدها، ولم يظهر ذلك لأن اختبارات القاعدة كانت متخطّاةً دائماً — شُخِّص
        // وأُصلح في `WL-045`. **من يضيف هجرةً تُنشئ جدولاً يُحدِّث هذه القائمة
        // بيده**، وذاك هو المقصود.
        'جداول المخطَّط بعد كل الهجرات الثلاثِ والعشرينَ: أربعةٌ وثلاثون جدولاً',
      );

      // التراجع خطوةً خطوة حتى الصفر: `down` تتراجع عن الأخيرة وحدها.
      for (let step = versions.length; step > 0; step -= 1) {
        const reverted = await down(db.pool);
        assert.deepEqual(reverted.reverted, [versions[step - 1]]);
        assert.equal(reverted.current, step === 1 ? 0 : versions[step - 2]);
      }

      // دفتر النسخ يبقى موجوداً بعد التراجع (يملكه المُهاجر لا الهجرة)، لكنه فارغ؛
      // فيُستثنى من المقايسة بحذفه، ثم تُقايس القاعدة صورةً بصورة.
      await db.pool.query('DROP TABLE public.schema_migrations');
      const after = await catalogSnapshot(db.pool);
      assert.equal(after, before, 'التراجع لم يُعِد القاعدة إلى حالتها الأصلية');
    } finally {
      await db.drop();
    }
  },
);

test('up مرتين لا يُطبّق شيئاً في الثانية', { skip: skipWithoutDatabase }, async () => {
  const db = await createIsolatedDatabase('idempotent');
  try {
    await up(db.pool);
    const versions = (await loadMigrations()).map((migration) => migration.version);
    const second = await up(db.pool);
    assert.deepEqual(second.applied, []);
    assert.equal(second.current, versions[versions.length - 1]);
    const state = await status(db.pool);
    assert.equal(
      state.rows.every((row) => row.isApplied),
      true,
    );
  } finally {
    await db.drop();
  }
});

test('تعديل هجرة بعد تطبيقها يُرفض ببصمة لا تطابق', { skip: skipWithoutDatabase }, async () => {
  const db = await createIsolatedDatabase('checksum');
  try {
    await up(db.pool);
    // محاكاة تعديل الملف بعد التطبيق: البصمة المسجَّلة لم تبقَ تطابق القرص.
    await db.pool.query(`UPDATE public.schema_migrations SET checksum = repeat('a', 64)`);
    await assert.rejects(
      () => up(db.pool),
      (/** @type {unknown} */ error) =>
        /** @type {{ code?: string }} */ (error).code === MIGRATION_ERRORS.CHECKSUM_MISMATCH,
    );
  } finally {
    await db.drop();
  }
});

test('هجرة مُطبَّقة لا ملف لها تُكشف', { skip: skipWithoutDatabase }, async () => {
  const db = await createIsolatedDatabase('orphan');
  try {
    await up(db.pool);
    // رقمٌ بعد آخر هجرة في المستودع، فلا يتعارض مع دفتر النسخ حين تُضاف هجرات.
    const versions = (await loadMigrations()).map((migration) => migration.version);
    const ghost = Number(versions[versions.length - 1] ?? 0) + 1;
    await db.pool.query(
      `INSERT INTO public.schema_migrations (version, name, checksum, applied_by)
       VALUES ($1, 'ghost', repeat('b', 64), 'test')`,
      [ghost],
    );
    await assert.rejects(
      () => status(db.pool),
      (/** @type {unknown} */ error) =>
        /** @type {{ code?: string }} */ (error).code === MIGRATION_ERRORS.MISSING_FILE,
    );
  } finally {
    await db.drop();
  }
});

test(
  'هجرة تسقط في منتصفها لا تُخلّف مخطَّطاً نصف مطبَّق ولا صفَّ نسخة',
  { skip: skipWithoutDatabase },
  async () => {
    const dir = tempMigrationsDir({
      // الجدول الأول ينجح ثم يأتي خطأ صريح: بلا معاملة كان الجدول سيبقى.
      '0001_partial.up.sql': 'CREATE TABLE public.half_done (id int PRIMARY KEY);\nSELECT 1/0;',
      '0001_partial.down.sql': 'DROP TABLE IF EXISTS public.half_done;',
    });
    const db = await createIsolatedDatabase('atomic');
    try {
      await assert.rejects(() => up(db.pool, { dir }));
      const table = await db.pool.query(
        `SELECT to_regclass('public.half_done') IS NOT NULL AS present`,
      );
      assert.equal(
        /** @type {Record<string, unknown>} */ (table.rows[0])['present'],
        false,
        'الجدول بقي بعد إخفاق الهجرة — الهجرة ليست ذرية',
      );
      assert.deepEqual(await readApplied(db.pool), []);
    } finally {
      await db.drop();
    }
  },
);

test('down بلا هجرة مُطبَّقة يُرفض برمز مسمّى', { skip: skipWithoutDatabase }, async () => {
  const db = await createIsolatedDatabase('nothing');
  try {
    await assert.rejects(
      () => down(db.pool),
      (/** @type {unknown} */ error) =>
        /** @type {{ code?: string }} */ (error).code === MIGRATION_ERRORS.NOTHING_TO_REVERT,
    );
  } finally {
    await db.drop();
  }
});

// ── WL-562: أجنحةُ هجراتِ السياجِ 0028–0032 نُقِلَت حرفيّاً من migration-reversibility.test.mjs ──
// ‏ذاك الملفُّ بلغَ مهلةَ الملفِّ (‏--test-timeout=120000) على عدّاءٍ بطيء: نحوُ 117 ث قبلَ أن يبدأَ جناحُ 0032 (‏التشغيلة
// 44223858099)، فأُلغيَ وبقيَ جذرانِ في /tmp. النقلُ لا يحذفُ اختباراً ولا توكيداً ولا يُضيفُ ملفّاً (‏G1 ‏3220).
// ‏fenceFunctionCatalog منسوخٌ حرفيّاً (‏ملفُّ الاختبارِ لا يُستورَدُ: استيرادُه يُسجِّلُ اختباراتِه).

/**
 * كتالوجُ دوالِّ fence (‏التعريفُ كاملاً، التقلّب، SECURITY DEFINER، المالك، ACL) ومُطلِقاتِ الأحداث.
 * @param {import('pg').Pool} pool
 */
async function fenceFunctionCatalog(pool) {
  const fns = await pool.query(
    `SELECT p.oid::regprocedure::text AS sig, pg_catalog.pg_get_functiondef(p.oid) AS def,
            p.provolatile AS vol, p.prosecdef AS secdef, pg_catalog.pg_get_userbyid(p.proowner) AS owner,
            coalesce(p.proacl::text, '') AS acl
       FROM pg_catalog.pg_proc p WHERE p.pronamespace = 'fence'::regnamespace ORDER BY 1`,
  );
  const evt = await pool.query(
    `SELECT evtname, evtenabled, evtfoid::regproc::text AS fn FROM pg_catalog.pg_event_trigger ORDER BY 1`,
  );
  const manifest = await pool.query(
    'SELECT function_signature, digest FROM fence.manifest ORDER BY function_signature',
  );
  return { functions: fns.rows, eventTriggers: evt.rows, manifest: manifest.rows };
}

// ── WL-551: عضويّةُ xf_owner تمنعُ RESUME (‏0028) ──
//
// 0028 تُضيفُ fence._owner_membership_problems() وكتلةً مغلقةَ الفشلِ في check_fenced. هنا: على 0027 العضويّةُ لا تُرى
// (‏العيبُ مقيساً)، والترقيةُ تُطبِّقُ [28] فتُرى، وقاعدةٌ جديدةٌ تنتهي إلى الكتالوجِ نفسِه، والرجوعُ يُعيدُ كتالوجَ 0027
// بايتاً ببايت (‏التعريف، المالك، ACL، المُطلِقات، البيانُ ببصماتِه)، وإعادةُ التقديمِ تُطابق؛ وطفراتُ 0028 تُكشَف.
// الأثرُ الحيُّ (‏XF415، HALT، الاستيلاءُ المباشرُ متبقّياً) في tests/fence/db-fence-privileges.test.mjs (‏نُقلَ إليه في WL-555).
describe(
  'WL-551 — 0028: العيبُ، والترقية، والرجوع، والطفرات',
  { skip: skipWithoutDatabase },
  () => {
    /** @type {Awaited<ReturnType<typeof createIsolatedDatabase>>} */
    let db;
    /** @type {Awaited<ReturnType<typeof createIsolatedDatabase>> | undefined} */
    let fresh;
    /** @type {string} */
    let dir27;
    /** @type {string} */
    let dir28;
    /** @type {Awaited<ReturnType<typeof fenceFunctionCatalog>>} */
    let at27;
    /** @type {Awaited<ReturnType<typeof fenceFunctionCatalog>>} */
    let at28;
    const src = fileURLToPath(new URL('../../migrations/', import.meta.url));
    const FILE = '0028_fence_owner_membership.up.sql';
    /** @param {number} upTo @param {(n: string, t: string) => string} [mutate] */
    const migrationsDir = (upTo, mutate = (_n, t) => t) => {
      const d = registerTmpRoot(mkdtempSync(join(tmpdir(), 'xuux-mig-')));
      for (const f of readdirSync(src)) {
        if (Number(f.slice(0, 4)) > upTo) continue;
        writeFileSync(join(d, f), mutate(f, readFileSync(join(src, f), 'utf8')));
      }
      return d;
    };
    const ROLES = ['zz_m28_t', 'zz_m28_m3', 'zz_m28_m2', 'zz_m28_m1', 'zz_m28_a'];
    /**
     * الفحصُ نفسُه للنصِّ الحقيقيِّ وللطفرات: سلسلةٌ بعمق 4 بوسطاءَ NOLOGIN، وعضوٌ بـADMIN وحدَه، وخطأٌ مُحقَنٌ في الجرد.
     * @param {import('pg').Pool} pool @returns {Promise<string[]>} أسماءُ الفحوصِ الساقطة
     */
    const probe = async (pool) => {
      const fails = [];
      for (const r of ROLES) await pool.query(`DROP ROLE IF EXISTS ${r}`);
      try {
        for (const r of ROLES) await pool.query(`CREATE ROLE ${r} NOLOGIN`);
        await pool.query('GRANT xf_owner TO zz_m28_m1');
        await pool.query('GRANT zz_m28_m1 TO zz_m28_m2');
        await pool.query('GRANT zz_m28_m2 TO zz_m28_m3');
        await pool.query('GRANT zz_m28_m3 TO zz_m28_t');
        await pool.query('GRANT xf_owner TO zz_m28_a WITH ADMIN TRUE, INHERIT FALSE, SET FALSE');
        const chk = (await pool.query('SELECT fence.check_fenced() AS r')).rows[0].r;
        const seen = chk.problems
          .filter((/** @type {any} */ p) => p.kind === 'owner_membership')
          .map((/** @type {any} */ p) => `${p.role}:${p.depth}`)
          .sort();
        if (!seen.includes('zz_m28_t:4')) fails.push(`transitive:${seen}`);
        if (!seen.includes('zz_m28_a:1')) fails.push(`admin_only:${seen}`);
        if (chk.ok !== false) fails.push('ok');
      } finally {
        for (const r of ROLES) await pool.query(`DROP ROLE IF EXISTS ${r}`);
      }
      const c = await pool.connect();
      try {
        await c.query('BEGIN');
        await c.query('ALTER EVENT TRIGGER xf_ddl_end DISABLE');
        await c.query(`CREATE OR REPLACE FUNCTION fence._owner_membership_problems() RETURNS jsonb
        LANGUAGE plpgsql STABLE SET search_path = pg_catalog, pg_temp AS $f$
        BEGIN RAISE EXCEPTION 'wl551 fault'; END $f$`);
        const r = (await c.query('SELECT fence.check_fenced() AS r')).rows[0].r;
        if (
          !r.problems.some((/** @type {any} */ p) => p.kind === 'owner_membership_inventory_failed')
        )
          fails.push('inventory_fault_hidden');
      } catch (e) {
        fails.push(`check_fenced_raised:${/** @type {any} */ (e).code}`);
      } finally {
        await c.query('ROLLBACK').catch(() => {});
        c.release();
      }
      return fails;
    };
    before(async () => {
      db = await createIsolatedDatabase('m0028');
      dir27 = migrationsDir(27);
      // ‏WL-552: هذه الحزمةُ تقيسُ 0028 — فالتقديمُ يقفُ عندَها صراحةً (‏0029 وما بعدَها لها حزمتُها).
      dir28 = migrationsDir(28);
    });
    after(async () => {
      if (db !== undefined) await db.drop();
      if (fresh !== undefined) await fresh.drop();
      rmSync(dir27, { recursive: true, force: true });
      rmSync(dir28, { recursive: true, force: true });
    });

    it('على 0027: العضويّةُ في xf_owner لا تُرى (‏العيبُ مقيساً)', async () => {
      assert.equal((await up(db.pool, { dir: dir27 })).current, 27);
      at27 = await fenceFunctionCatalog(db.pool);
      const fails = await probe(db.pool);
      assert.ok(
        fails.some((f) => f.startsWith('transitive')),
        JSON.stringify(fails),
      );
      assert.ok(
        fails.some((f) => f.startsWith('admin_only')),
        JSON.stringify(fails),
      );
    });

    it('الترقيةُ إلى 0028 تُطبِّقُ [28] بلا اختلافِ بصمة، والفحصُ كلُّه يجتاز', async () => {
      assert.deepEqual((await up(db.pool, { dir: dir28 })).applied, [28]);
      at28 = await fenceFunctionCatalog(db.pool);
      assert.notDeepEqual(at28, at27, '0028 غيّرت الكتالوجَ فعلاً');
      assert.deepEqual(await probe(db.pool), []);
      const fn = at28.functions.find((f) => f.sig === 'fence._owner_membership_problems()');
      assert.ok(fn, 'الدالّةُ حاضرة');
      assert.equal(fn.owner, 'xf_owner');
      assert.equal(fn.secdef, false, 'بصلاحيةِ المُنادي (‏check_fenced هو SECURITY DEFINER)');
      assert.equal(fn.acl, '{xf_owner=X/xf_owner}', 'مسحوبةٌ من PUBLIC ولا تُمنَحُ لأحد');
    });

    it('قاعدةٌ جديدةٌ من الصفر تنتهي إلى كتالوجِ 0028 نفسِه', async () => {
      fresh = await createIsolatedDatabase('m0028f');
      await up(fresh.pool, { dir: dir28 });
      assert.deepEqual(await fenceFunctionCatalog(fresh.pool), at28);
    });

    it('رجوعُ 0028 يُعيدُ كتالوجَ 0027 بايتاً ببايت (‏والبيانَ ببصماتِه)، وإعادةُ التقديمِ تُطابق', async () => {
      assert.equal((await down(db.pool, { steps: 1 })).current, 27);
      assert.deepEqual(await fenceFunctionCatalog(db.pool), at27);
      assert.deepEqual((await up(db.pool, { dir: dir28 })).applied, [28]);
      assert.deepEqual(await fenceFunctionCatalog(db.pool), at28);
    });

    for (const [label, mutate] of /** @type {Array<[string, (t: string) => string]>} */ ([
      [
        'مباشرةٌ وحدَها (‏بلا الحدِّ التكراريّ)',
        (t) =>
          t.replace(
            '    UNION\n    SELECT e.member, r.depth + 1 FROM reach r JOIN e ON e.roleid = r.member\n    WHERE r.depth < (SELECT count(*) FROM pg_roles)\n',
            '',
          ),
      ],
      [
        'عمقٌ محدود (‏2)',
        (t) => t.replace('WHERE r.depth < (SELECT count(*) FROM pg_roles)', 'WHERE r.depth < 2'),
      ],
      [
        'ADMIN وحدَه لا يُعَدّ',
        (t) =>
          t.replace(
            'FROM pg_auth_members am GROUP BY am.roleid, am.member',
            'FROM pg_auth_members am WHERE am.inherit_option OR am.set_option GROUP BY am.roleid, am.member',
          ),
      ],
      [
        'بلا كتلةِ الفشلِ المغلق',
        (t) =>
          t.replace(
            "  BEGIN\n    problems := problems || fence._owner_membership_problems();\n  EXCEPTION WHEN OTHERS THEN\n    problems := problems || jsonb_build_array(jsonb_build_object('kind', 'owner_membership_inventory_failed', 'sqlstate', SQLSTATE, 'message', SQLERRM));\n  END;\n",
            '  problems := problems || fence._owner_membership_problems();\n',
          ),
      ],
    ])) {
      it(`طفرةٌ في 0028 تُكشَف: ${label}`, async () => {
        const d = migrationsDir(28, (n, t) => (n === FILE ? mutate(t) : t));
        try {
          assert.notEqual(
            readFileSync(join(d, FILE), 'utf8'),
            readFileSync(join(src, FILE), 'utf8'),
            'الطفرةُ لم تُطبَّق',
          );
          await down(db.pool, { steps: 1 });
          await up(db.pool, { dir: d });
          assert.notDeepEqual(await probe(db.pool), [], 'الطفرةُ حيّة');
          await down(db.pool, { steps: 1, dir: d });
        } finally {
          rmSync(d, { recursive: true, force: true });
        }
        assert.deepEqual((await up(db.pool, { dir: dir28 })).applied, [28]);
        assert.deepEqual(await probe(db.pool), [], 'النصُّ الحقيقيُّ يجتاز');
        assert.deepEqual(await fenceFunctionCatalog(db.pool), at28);
      });
    }
  },
);

// ── WL-552: جلسةُ الاعتمادِ الملغى الحيّة (‏0029) ──
//
// 0029 تُعيدُ كتابةَ fence._reap_lapsed() وتُضيفُ fence._signal_session(). هنا: الترقيةُ تُطبِّقُ [29]، وقاعدةٌ جديدةٌ تنتهي
// إلى الكتالوجِ نفسِه، والرجوعُ يُعيدُ كتالوجَ 0028 بايتاً ببايت — و_reap_lapsed بعدَ الرجوعِ هي نصُّ 0027 حرفيّاً ببصمتِه
// في البيان (‏مقابَلةً بقاعدةٍ وقفت عندَ 0027، و0028 لم تمسَّها). السلوكُ الحيُّ والطفراتُ في tests/fence/lease-reap-window.
describe(
  'WL-552 — 0029: الترقية، والرجوع إلى 0028 (‏و_reap_lapsed إلى 0027 ببصمتِها)',
  { skip: skipWithoutDatabase },
  () => {
    /** @type {Awaited<ReturnType<typeof createIsolatedDatabase>>} */
    let db;
    /** @type {Awaited<ReturnType<typeof createIsolatedDatabase>> | undefined} */
    let fresh;
    /** @type {Awaited<ReturnType<typeof createIsolatedDatabase>> | undefined} */
    let only27;
    /** @type {string} */
    let dir27;
    /** @type {string} */
    let dir28;
    /** @type {string} */
    let dir29;
    /** @type {Awaited<ReturnType<typeof fenceFunctionCatalog>>} */
    let at28;
    /** @type {Awaited<ReturnType<typeof fenceFunctionCatalog>>} */
    let at29;
    const src = fileURLToPath(new URL('../../migrations/', import.meta.url));
    const RL = 'fence._reap_lapsed()';
    const SIG = 'fence._signal_session(integer,timestamp with time zone,name)';
    /** @param {number} upTo */
    const migrationsDir = (upTo) => {
      const d = registerTmpRoot(mkdtempSync(join(tmpdir(), 'xuux-mig-')));
      for (const f of readdirSync(src)) {
        if (Number(f.slice(0, 4)) > upTo) continue;
        writeFileSync(join(d, f), readFileSync(join(src, f), 'utf8'));
      }
      return d;
    };
    /** @param {Awaited<ReturnType<typeof fenceFunctionCatalog>>} c @param {string} sig */
    const entry = (c, sig) => ({
      fn: c.functions.find((f) => f.sig === sig),
      digest: c.manifest.find((m) => m.function_signature === sig)?.digest,
    });
    before(async () => {
      db = await createIsolatedDatabase('m0029');
      dir27 = migrationsDir(27);
      dir28 = migrationsDir(28);
      dir29 = migrationsDir(29);
    });
    after(async () => {
      for (const d of [db, fresh, only27]) if (d !== undefined) await d.drop();
      for (const d of [dir27, dir28, dir29]) rmSync(d, { recursive: true, force: true });
    });

    it('الترقيةُ إلى 0029 تُطبِّقُ [29] بلا اختلافِ بصمة، والدالّةُ الجديدةُ مسحوبةٌ من PUBLIC', async () => {
      assert.equal((await up(db.pool, { dir: dir28 })).current, 28);
      at28 = await fenceFunctionCatalog(db.pool);
      assert.deepEqual((await up(db.pool, { dir: dir29 })).applied, [29]);
      at29 = await fenceFunctionCatalog(db.pool);
      assert.notDeepEqual(entry(at29, RL), entry(at28, RL), '0029 غيّرت _reap_lapsed فعلاً');
      const fn = at29.functions.find((f) => f.sig === SIG);
      assert.ok(fn, 'الدالّةُ حاضرة');
      assert.equal(fn.owner, 'xf_owner');
      assert.equal(
        fn.secdef,
        true,
        'تُرسِلُ الإشارةَ بصلاحيةِ المالك (‏كـ_terminate_worker_sessions)',
      );
      assert.equal(fn.acl, '{xf_owner=X/xf_owner}', 'مسحوبةٌ من PUBLIC ولا تُمنَحُ لأحد');
      assert.ok(entry(at29, SIG).digest, 'في البيان');
      const others = (/** @type {typeof at28} */ c) => ({
        functions: c.functions.filter((f) => f.sig !== RL && f.sig !== SIG),
        eventTriggers: c.eventTriggers,
        manifest: c.manifest.filter(
          (m) => m.function_signature !== RL && m.function_signature !== SIG,
        ),
      });
      assert.deepEqual(others(at29), others(at28), 'لا تغييرَ خارجَ الدالّتَين');
    });

    it('قاعدةٌ جديدةٌ من الصفر تنتهي إلى كتالوجِ 0029 نفسِه', async () => {
      fresh = await createIsolatedDatabase('m0029f');
      await up(fresh.pool, { dir: dir29 });
      assert.deepEqual(await fenceFunctionCatalog(fresh.pool), at29);
    });

    it('رجوعُ 0029 يُعيدُ كتالوجَ 0028 بايتاً ببايت، و_reap_lapsed نصَّ 0027 ببصمتِه، وإعادةُ التقديمِ تُطابق', async () => {
      assert.equal((await down(db.pool, { steps: 1, dir: dir29 })).current, 28);
      const back = await fenceFunctionCatalog(db.pool);
      assert.deepEqual(back, at28);
      only27 = await createIsolatedDatabase('m0029at27');
      await up(only27.pool, { dir: dir27 });
      const at27 = await fenceFunctionCatalog(only27.pool);
      assert.deepEqual(
        entry(back, RL),
        entry(at27, RL),
        'التعريفُ والمالكُ وACL وبصمةُ البيان = 0027',
      );
      assert.equal(entry(back, SIG).fn, undefined, 'الدالّةُ الجديدةُ أُسقِطت');
      assert.equal(entry(back, SIG).digest, undefined, 'وبصمتُها من البيان');
      assert.deepEqual((await up(db.pool, { dir: dir29 })).applied, [29]);
      assert.deepEqual(await fenceFunctionCatalog(db.pool), at29);
    });
  },
);

// ── WL-558: الحاصدُ الدائم (‏0030) — دورٌ على مستوى العنقود، وبابٌ واحد، ورجوعٌ يُثبِتُ الحالةَ الناتجة ──
//
// xf_reaper دورٌ على مستوى العنقود، وعنقودُ الاختبارِ مشترك (‏قاعدةُ state وغيرُها قد تحملُ 0030). فقاعدةٌ «مِرساة» تُطبِّقُ
// 0030 أوّلاً: الدورُ حاضرٌ بوسمِ 0030 واعتمادٍ في قاعدةٍ أخرى أيّاً كانت حالُ العنقود — فالقاعدةُ المختبَرةُ تسلكُ مسارَ
// «القبول» صعوداً و«الإبقاء» رجوعاً حتميّاً. مسارا «الإنشاء» و«الإسقاط» و«XF526» يحتاجانِ عنقوداً بلا اعتماد: في مختبرِ
// العنقودِ النظيف (‏evidence/wl558-reaper/lab.sh) وفي خطوةِ هجراتِ CI (‏up → down ⇒ لا دور → up).
// التلاعبُ بالدورِ هنا مؤقّتٌ ويُعادُ في finally (‏الاختبارُ متسلسل: --test-concurrency=1).
const REAPER_MARKER = 'xuux-fence-0030:xf_reaper';
/**
 * لقطةُ 0030: دوالُّ fence وبيانُها، وجداولُها بـACL، وACL هذه القاعدة، وحالُ xf_reaper كاملة (‏خصائص، وسم، عضويّاتٌ
 * في الاتّجاهَين، إعدادات، واعتمادُه في هذه القاعدة).
 * @param {import('pg').Pool} pool
 */
async function reaperSnapshot(pool) {
  const base = await fenceFunctionCatalog(pool);
  const tables = await pool.query(
    `SELECT c.relname, c.relkind, pg_get_userbyid(c.relowner) AS owner, coalesce(c.relacl::text, '') AS acl
       FROM pg_class c WHERE c.relnamespace = 'fence'::regnamespace AND c.relkind IN ('r', 'v', 'S') ORDER BY 1`,
  );
  const dbacl = await pool.query(
    `SELECT coalesce(datacl::text, '') AS acl FROM pg_database WHERE datname = current_database()`,
  );
  const role = await pool.query(
    `SELECT r.rolname, r.rolsuper, r.rolinherit, r.rolcreaterole, r.rolcreatedb, r.rolcanlogin, r.rolreplication,
            r.rolbypassrls, r.rolconnlimit, r.rolvaliduntil::text AS validuntil,
            shobj_description(r.oid, 'pg_authid') AS marker,
            ARRAY(SELECT m.roleid::regrole::text || ':' || m.admin_option || m.inherit_option || m.set_option
                    FROM pg_auth_members m WHERE m.member = r.oid ORDER BY 1) AS member_of,
            ARRAY(SELECT m.member::regrole::text FROM pg_auth_members m WHERE m.roleid = r.oid ORDER BY 1) AS members,
            ARRAY(SELECT coalesce(s.setdatabase::text, '') || '=' || array_to_string(s.setconfig, ',')
                    FROM pg_db_role_setting s WHERE s.setrole = r.oid ORDER BY 1) AS settings,
            (SELECT count(*)::int FROM pg_shdepend d
              WHERE d.refobjid = r.oid AND d.dbid = (SELECT oid FROM pg_database WHERE datname = current_database()))
              AS local_deps,
            EXISTS (SELECT 1 FROM pg_shdepend d WHERE d.refobjid = r.oid AND d.dbid = 0
                       AND d.classid = 'pg_database'::regclass
                       AND d.objid = (SELECT oid FROM pg_database WHERE datname = current_database())) AS db_dep
       FROM pg_roles r WHERE r.rolname = 'xf_reaper'`,
  );
  return { ...base, tables: tables.rows, dbacl: dbacl.rows[0].acl, role: role.rows[0] ?? null };
}

describe(
  'WL-558 — 0030: الترقية، والرجوعُ إلى 0029 بالحالةِ الناتجة، ورفضُ دورٍ بالاسمِ نفسِه لم تُنشئه',
  { skip: skipWithoutDatabase },
  () => {
    /** @type {Awaited<ReturnType<typeof createIsolatedDatabase>>} */
    let db;
    /** @type {Awaited<ReturnType<typeof createIsolatedDatabase>>} */
    let anchor;
    /** @type {Awaited<ReturnType<typeof createIsolatedDatabase>> | undefined} */
    let fresh;
    /** @type {string} */
    let dir29;
    /** @type {string} */
    let dir30;
    /** @type {Awaited<ReturnType<typeof reaperSnapshot>>} */
    let at29;
    /** @type {Awaited<ReturnType<typeof reaperSnapshot>>} */
    let at30;
    const src = fileURLToPath(new URL('../../migrations/', import.meta.url));
    /** @param {number} upTo */
    const migrationsDir = (upTo) => {
      const d = registerTmpRoot(mkdtempSync(join(tmpdir(), 'xuux-mig-')));
      for (const f of readdirSync(src)) {
        if (Number(f.slice(0, 4)) > upTo) continue;
        writeFileSync(join(d, f), readFileSync(join(src, f), 'utf8'));
      }
      return d;
    };
    const NEW = [
      'fence._worker_capability_problems()',
      'fence.reaper_tick(uuid,integer,integer)',
      'fence.reaper_health(integer)',
      'fence.reaper_capabilities()',
      'fence.reaper_capability_problems()',
    ];
    const CHANGED = ['fence.capability_problems()', 'fence.notify_surface()'];
    before(async () => {
      dir29 = migrationsDir(29);
      dir30 = migrationsDir(30);
      anchor = await createIsolatedDatabase('m0030a');
      await up(anchor.pool, { dir: dir30 });
      db = await createIsolatedDatabase('m0030');
    });
    after(async () => {
      for (const d of [db, fresh, anchor]) if (d !== undefined) await d.drop();
      for (const d of [dir29, dir30]) rmSync(d, { recursive: true, force: true });
    });

    it('المِرساة: xf_reaper بوسمِ 0030 وخصائصِه حرفيّاً، بلا عضويّةٍ ولا إعداد', async () => {
      const r = (await reaperSnapshot(anchor.pool)).role;
      assert.ok(r, 'الدورُ حاضر');
      assert.deepEqual(
        { ...r, local_deps: undefined, db_dep: undefined },
        {
          rolname: 'xf_reaper',
          rolsuper: false,
          rolinherit: false,
          rolcreaterole: false,
          rolcreatedb: false,
          rolcanlogin: true,
          rolreplication: false,
          rolbypassrls: false,
          rolconnlimit: 2,
          validuntil: '-infinity',
          marker: REAPER_MARKER,
          member_of: [],
          members: [],
          settings: [],
          local_deps: undefined,
          db_dep: undefined,
        },
      );
      assert.equal(r.local_deps, 2, 'USAGE (‏fence) + EXECUTE (‏reaper_tick) — لا غير');
      assert.equal(r.db_dep, true, 'وCONNECT على القاعدة (‏اعتمادٌ مشتركٌ بـdbid = 0)');
    });

    it('الترقيةُ إلى 0030: [30]، والتغييرُ محصورٌ في المتوقَّع، وACL كلِّ دالّةٍ جديدةٍ حرفيّاً', async () => {
      assert.equal((await up(db.pool, { dir: dir29 })).current, 29);
      at29 = await reaperSnapshot(db.pool);
      assert.deepEqual((await up(db.pool, { dir: dir30 })).applied, [30]);
      at30 = await reaperSnapshot(db.pool);
      const fn = (/** @type {typeof at30} */ c, /** @type {string} */ s) =>
        c.functions.find((f) => f.sig === s);
      const dg = (/** @type {typeof at30} */ c, /** @type {string} */ s) =>
        c.manifest.find((m) => m.function_signature === s)?.digest;
      const FULL =
        '{xf_owner=X/xf_owner,xf_root=X/xf_owner,xf_sovereign=X/xf_owner,xf_auditor=X/xf_owner,xuux_migrator=X/xf_owner}';
      assert.equal(
        fn(at30, 'fence.reaper_tick(uuid,integer,integer)')?.acl,
        '{xf_owner=X/xf_owner,xf_reaper=X/xf_owner}',
      );
      assert.equal(
        fn(at30, 'fence.reaper_health(integer)')?.acl,
        '{xf_owner=X/xf_owner,xf_root=X/xf_owner,xf_sovereign=X/xf_owner,xf_auditor=X/xf_owner}',
      );
      for (const s of [
        'fence.reaper_capabilities()',
        'fence.reaper_capability_problems()',
        'fence.capability_problems()',
      ])
        assert.equal(fn(at30, s)?.acl, FULL, s);
      for (const s of NEW) {
        assert.equal(fn(at30, s)?.owner, 'xf_owner', s);
        assert.equal(fn(at30, s)?.secdef, true, s);
        assert.ok(dg(at30, s), `${s} في البيان`);
      }
      // ‏الدالّةُ القديمةُ أُعيدَت تسميتُها لا إنشاؤها: ACL وبصمتُها كما كانت تحتَ الاسمِ القديم.
      const old = fn(at29, 'fence.capability_problems()');
      const renamed = fn(at30, 'fence._worker_capability_problems()');
      assert.equal(renamed?.acl, old?.acl);
      assert.equal(
        renamed?.def,
        old?.def.replace('fence.capability_problems()', 'fence._worker_capability_problems()'),
      );
      assert.equal(
        dg(at30, 'fence._worker_capability_problems()'),
        dg(at29, 'fence.capability_problems()'),
      );
      assert.match(
        String(fn(at30, 'fence.notify_surface()')?.def),
        /'xuux_migrator', 'xf_reaper'\]::name\[\]/,
      );
      assert.deepEqual(
        at30.tables.filter((t) => t.relname === 'reaper_heartbeat'),
        [
          {
            relname: 'reaper_heartbeat',
            relkind: 'r',
            owner: 'xf_owner',
            acl: '{xf_owner=arwdDxtm/xf_owner}',
          },
        ],
      );
      assert.match(at30.dbacl, /(^|,)xf_reaper=c\//, 'CONNECT وحدَه على هذه القاعدة');
      const others = (/** @type {typeof at30} */ c) => ({
        functions: c.functions.filter((f) => !NEW.includes(f.sig) && !CHANGED.includes(f.sig)),
        eventTriggers: c.eventTriggers,
        manifest: c.manifest.filter(
          (m) => !NEW.includes(m.function_signature) && !CHANGED.includes(m.function_signature),
        ),
        tables: c.tables.filter((t) => t.relname !== 'reaper_heartbeat'),
        dbacl: c.dbacl.replace(/,?xf_reaper=c\/[a-z_]+/, ''),
      });
      assert.deepEqual(others(at30), others(at29), 'لا تغييرَ خارجَ ما أعلنته 0030');
      assert.deepEqual(
        { ...at30.role, local_deps: 0, db_dep: false },
        { ...at29.role, local_deps: 0, db_dep: false },
        'الدورُ القائمُ لم يُعدَّل',
      );
      assert.deepEqual([at29.role?.local_deps, at29.role?.db_dep], [0, false]);
      assert.deepEqual([at30.role?.local_deps, at30.role?.db_dep], [2, true]);
    });

    it('قاعدةٌ جديدةٌ من الصفر تنتهي إلى لقطةِ 0030 نفسِها', async () => {
      fresh = await createIsolatedDatabase('m0030f');
      await up(fresh.pool, { dir: dir30 });
      assert.deepEqual(await reaperSnapshot(fresh.pool), at30);
    });

    it('رجوعُ 0030 يُعيدُ لقطةَ 0029 حرفيّاً (‏والدورُ باقٍ كما هو: له اعتمادٌ في المِرساة)، وإعادةُ التقديمِ تُطابق', async () => {
      assert.equal((await down(db.pool, { steps: 1, dir: dir30 })).current, 29);
      assert.deepEqual(await reaperSnapshot(db.pool), at29);
      assert.deepEqual((await up(db.pool, { dir: dir30 })).applied, [30]);
      assert.deepEqual(await reaperSnapshot(db.pool), at30);
    });

    /**
     * تلاعبٌ مؤقّتٌ بالدور: يُطبَّقُ، ثمّ `body`، ثمّ يُعادُ ولو فشل.
     * @param {string[]} apply @param {string[]} restore @param {() => Promise<void>} body
     */
    const tampered = async (apply, restore, body) => {
      for (const s of apply) await db.pool.query(s);
      try {
        await body();
      } finally {
        for (const s of restore) await db.pool.query(s).catch(() => {});
      }
    };
    const TAMPER = [
      {
        why: 'حدُّ اتصالٍ مختلف',
        apply: ['ALTER ROLE xf_reaper CONNECTION LIMIT 3'],
        restore: ['ALTER ROLE xf_reaper CONNECTION LIMIT 2'],
      },
      {
        why: 'INHERIT',
        apply: ['ALTER ROLE xf_reaper INHERIT'],
        restore: ['ALTER ROLE xf_reaper NOINHERIT'],
      },
      {
        why: 'VALID UNTIL مفتوح',
        apply: [`ALTER ROLE xf_reaper VALID UNTIL 'infinity'`],
        restore: [`ALTER ROLE xf_reaper VALID UNTIL '-infinity'`],
      },
      {
        why: 'CREATEDB',
        apply: ['ALTER ROLE xf_reaper CREATEDB'],
        restore: ['ALTER ROLE xf_reaper NOCREATEDB'],
      },
      {
        why: 'بلا وسمِ 0030 (‏دورٌ لم تُنشئه)',
        apply: ['COMMENT ON ROLE xf_reaper IS NULL'],
        restore: [`COMMENT ON ROLE xf_reaper IS '${REAPER_MARKER}'`],
      },
      {
        why: 'وسمٌ آخر',
        apply: [`COMMENT ON ROLE xf_reaper IS 'someone-else'`],
        restore: [`COMMENT ON ROLE xf_reaper IS '${REAPER_MARKER}'`],
      },
      {
        why: 'عضوٌ في دورٍ آخر',
        apply: ['CREATE ROLE wl558_t_parent NOLOGIN', 'GRANT wl558_t_parent TO xf_reaper'],
        restore: ['DROP ROLE IF EXISTS wl558_t_parent'],
      },
      {
        why: 'له عضو',
        apply: ['CREATE ROLE wl558_t_child NOLOGIN', 'GRANT xf_reaper TO wl558_t_child'],
        restore: ['DROP ROLE IF EXISTS wl558_t_child'],
      },
      {
        why: 'إعدادٌ دائم',
        apply: [`ALTER ROLE xf_reaper SET work_mem = '1MB'`],
        restore: ['ALTER ROLE xf_reaper RESET ALL'],
      },
    ];
    for (const t of TAMPER) {
      it(`التقديمُ يرفضُ xf_reaper قائماً بـ«${t.why}» (‏XF524) بلا أيِّ أثر: لا تعديلَ للدورِ ولا للقاعدة`, async () => {
        assert.equal((await down(db.pool, { steps: 1, dir: dir30 })).current, 29);
        await tampered(t.apply, t.restore, async () => {
          const before_ = await reaperSnapshot(db.pool);
          assert.notDeepEqual(before_.role, at29.role, 'التلاعبُ وقعَ فعلاً');
          await assert.rejects(
            up(db.pool, { dir: dir30 }),
            (/** @type {any} */ e) => e?.code === 'XF524',
          );
          assert.deepEqual(
            await reaperSnapshot(db.pool),
            before_,
            'لا أثر: الدورُ كما وُجدَ والقاعدةُ عندَ 0029',
          );
        });
        assert.deepEqual(await reaperSnapshot(db.pool), at29, 'الإعادةُ تامّة');
        assert.deepEqual((await up(db.pool, { dir: dir30 })).applied, [30]);
      });
    }

    it('الرجوعُ لا يُسقِطُ ولا يُعدِّلُ دوراً بلا وسمِ 0030 — ويُعيدُ القاعدةَ إلى 0029 حرفيّاً', async () => {
      await tampered(
        [
          'COMMENT ON ROLE xf_reaper IS NULL',
          'CREATE ROLE wl558_t_parent NOLOGIN',
          'GRANT wl558_t_parent TO xf_reaper',
        ],
        ['DROP ROLE IF EXISTS wl558_t_parent', `COMMENT ON ROLE xf_reaper IS '${REAPER_MARKER}'`],
        async () => {
          const role = (await reaperSnapshot(db.pool)).role;
          assert.equal((await down(db.pool, { steps: 1, dir: dir30 })).current, 29);
          const back = await reaperSnapshot(db.pool);
          assert.deepEqual(
            back.role,
            { ...role, local_deps: 0, db_dep: false },
            'الدورُ كما وُجدَ (‏بعضويّتِه ووسمِه الغائب)',
          );
          assert.deepEqual({ ...back, role: at29.role }, at29);
        },
      );
      assert.deepEqual((await up(db.pool, { dir: dir30 })).applied, [30]);
      assert.deepEqual(await reaperSnapshot(db.pool), at30);
    });
  },
);

// ── WL-560: كاتبُ fence.control (‏0031) — حارسٌ يسألُ session_user؛ رجوعٌ يُعيدُ نصَّي 0024/0028 حرفياً، وxf_owner لا يتغيّر ──
/**
 * لقطةُ 0031: دوالُّ fence وبيانُها وحالُ xf_owner كاملة (‏خصائصُه وعضويّاتُه في الاتّجاهَين) — فلا تغييرَ لامتيازاته.
 * @param {import('pg').Pool} pool
 */
async function ownerSnapshot(pool) {
  const base = await fenceFunctionCatalog(pool);
  const role = await pool.query(
    `SELECT r.rolname, r.rolsuper, r.rolinherit, r.rolcreaterole, r.rolcreatedb, r.rolcanlogin, r.rolreplication,
            r.rolbypassrls, r.rolconnlimit,
            ARRAY(SELECT m.roleid::regrole::text || ':' || m.admin_option || m.inherit_option || m.set_option
                    FROM pg_auth_members m WHERE m.member = r.oid ORDER BY 1) AS member_of,
            ARRAY(SELECT m.member::regrole::text || ':' || m.admin_option
                    FROM pg_auth_members m WHERE m.roleid = r.oid ORDER BY 1) AS members
       FROM pg_roles r WHERE r.rolname = 'xf_owner'`,
  );
  const tables = await pool.query(
    `SELECT c.relname, pg_get_userbyid(c.relowner) AS owner, coalesce(c.relacl::text, '') AS acl
       FROM pg_class c WHERE c.relnamespace = 'fence'::regnamespace AND c.relkind IN ('r', 'v', 'S') ORDER BY 1`,
  );
  const triggers = await pool.query(
    `SELECT tgname, tgenabled, tgfoid::regprocedure::text AS fn FROM pg_trigger
      WHERE tgrelid = 'fence.control'::regclass AND NOT tgisinternal ORDER BY 1`,
  );
  return { ...base, owner: role.rows[0], tables: tables.rows, triggers: triggers.rows };
}

describe(
  'WL-560 — 0031: الترقيةُ تُغيّرُ _control_guard وcheck_fenced فقط، والرجوعُ إلى 0030 بالحالةِ الناتجةِ حرفياً',
  { skip: skipWithoutDatabase },
  () => {
    /** @type {Awaited<ReturnType<typeof createIsolatedDatabase>>} */
    let db;
    /** @type {string} */
    let dir30;
    /** @type {string} */
    let dir31;
    const src = fileURLToPath(new URL('../../migrations/', import.meta.url));
    /** @param {number} upTo */
    const migrationsDir = (upTo) => {
      const d = registerTmpRoot(mkdtempSync(join(tmpdir(), 'xuux-mig-')));
      for (const f of readdirSync(src)) {
        if (Number(f.slice(0, 4)) > upTo) continue;
        writeFileSync(join(d, f), readFileSync(join(src, f), 'utf8'));
      }
      return d;
    };
    const CHANGED = ['fence._control_guard()', 'fence.check_fenced()'];
    before(async () => {
      dir30 = migrationsDir(30);
      dir31 = migrationsDir(31);
      db = await createIsolatedDatabase('m0031');
      await up(db.pool, { dir: dir30 });
    });
    after(async () => {
      if (db !== undefined) await db.drop();
      for (const d of [dir30, dir31]) rmSync(d, { recursive: true, force: true });
    });

    it('تقديمٌ ورجوعٌ وإعادةُ تقديم: التغييرُ محصورٌ في دالّتَين، وxf_owner والجداولُ والمشغِّلاتُ حرفيّاً، والرجوعُ يُطابقُ 0030', async () => {
      const at30 = await ownerSnapshot(db.pool);
      assert.deepEqual((await up(db.pool, { dir: dir31 })).applied, [31]);
      const at31 = await ownerSnapshot(db.pool);
      /** @type {(s: { functions: any[] }) => Record<string, any>} */
      const bySig = (s) => Object.fromEntries(s.functions.map((f) => [f.sig, f]));
      const f30 = bySig(at30);
      const f31 = bySig(at31);
      assert.deepEqual(Object.keys(f31), Object.keys(f30), 'لا دالّةَ جديدةَ ولا محذوفة');
      for (const sig of Object.keys(f30)) {
        if (CHANGED.includes(sig)) {
          assert.notEqual(f31[sig].def, f30[sig].def, `${sig} تغيّر`);
          for (const k of ['vol', 'secdef', 'owner', 'acl'])
            assert.equal(f31[sig][k], f30[sig][k], `${sig}.${k} حرفيّاً`);
        } else assert.deepEqual(f31[sig], f30[sig], `${sig} حرفيّاً`);
      }
      assert.match(f31['fence._control_guard()'].def, /XF105/);
      assert.match(f31['fence._control_guard()'].def, /XF106/);
      assert.match(f31['fence._control_guard()'].def, /session_user/);
      assert.doesNotMatch(f30['fence._control_guard()'].def, /XF105|XF106/);
      assert.match(f31['fence.check_fenced()'].def, /0031/);
      // ‏البيانُ يُعيدُ تسجيلَ الدالّتَين فقط.
      /** @type {(s: { manifest: any[] }) => Record<string, string>} */
      const m = (s) => Object.fromEntries(s.manifest.map((r) => [r.function_signature, r.digest]));
      const m30 = m(at30);
      const m31 = m(at31);
      assert.deepEqual(Object.keys(m31), Object.keys(m30));
      const changedManifest = Object.keys(m30).filter((k) => m30[k] !== m31[k]);
      assert.deepEqual(changedManifest.sort(), [...CHANGED].sort());
      assert.deepEqual(at31.owner, at30.owner, 'امتيازاتُ xf_owner وعضويّاتُه لا تتغيّر');
      assert.deepEqual(at31.tables, at30.tables, 'ملكيّةُ جداولِ fence وACL لا تتغيّر');
      assert.deepEqual(at31.triggers, at30.triggers, 'مشغِّلاتُ fence.control لا تتغيّر');
      assert.deepEqual(at31.eventTriggers, at30.eventTriggers);
      // ‏الرجوعُ يُعيدُ 0030 حرفياً؛ وإعادةُ التقديمِ تُطابقُ 0031.
      assert.equal((await down(db.pool, { steps: 1, dir: dir31 })).current, 30);
      assert.deepEqual(await ownerSnapshot(db.pool), at30);
      assert.deepEqual((await up(db.pool, { dir: dir31 })).applied, [31]);
      assert.deepEqual(await ownerSnapshot(db.pool), at31);
      const fenced = await db.pool.query('SELECT fence.check_fenced() AS r');
      assert.ok(fenced.rows[0].r, 'check_fenced يعملُ بعدَ إعادةِ التقديم');
    });
  },
);

// ── WL-561: كاتبُ جداولِ fence الأخرى (‏0032) — دالّةٌ جديدةٌ ومُطلِقٌ على كلِّ جدولٍ غيرِ control؛ الرجوعُ يُعيدُ 0031 حرفياً ──
/**
 * كلُّ مُطلِقاتِ جداولِ fence (‏لا control وحدَه) — فيُرى ما يُضيفُه 0032 وما يُزيلُه الرجوع.
 * @param {import('pg').Pool} pool
 */
async function fenceTriggerSnapshot(pool) {
  const r = await pool.query(
    `SELECT c.relname, t.tgname, t.tgenabled, t.tgtype, t.tgfoid::regprocedure::text AS fn
       FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
      WHERE c.relnamespace = 'fence'::regnamespace AND NOT t.tgisinternal ORDER BY 1, 2`,
  );
  return r.rows;
}

describe(
  'WL-561 — 0032: الترقيةُ تُضيفُ _table_writer_guard ومُطلِقَه على كلِّ جدولٍ غيرِ control وتُغيّرُ check_fenced فقط، والرجوعُ إلى 0031 حرفياً',
  { skip: skipWithoutDatabase },
  () => {
    /** @type {Awaited<ReturnType<typeof createIsolatedDatabase>>} */
    let db;
    /** @type {string} */
    let dir31;
    /** @type {string} */
    let dir32;
    const src = fileURLToPath(new URL('../../migrations/', import.meta.url));
    /** @param {number} upTo */
    const migrationsDir = (upTo) => {
      const d = registerTmpRoot(mkdtempSync(join(tmpdir(), 'xuux-mig-')));
      for (const f of readdirSync(src)) {
        if (Number(f.slice(0, 4)) > upTo) continue;
        writeFileSync(join(d, f), readFileSync(join(src, f), 'utf8'));
      }
      return d;
    };
    const ADDED = 'fence._table_writer_guard()';
    before(async () => {
      dir31 = migrationsDir(31);
      dir32 = migrationsDir(32);
      db = await createIsolatedDatabase('m0032');
      await up(db.pool, { dir: dir31 });
    });
    after(async () => {
      if (db !== undefined) await db.drop();
      for (const d of [dir31, dir32]) rmSync(d, { recursive: true, force: true });
    });

    it('تقديمٌ ورجوعٌ وإعادةُ تقديم: دالّةٌ جديدةٌ واحدة، وcheck_fenced، ومُطلِقٌ لكلِّ جدولٍ غيرِ control؛ وxf_owner والجداولُ حرفيّاً؛ والرجوعُ يُطابقُ 0031', async () => {
      const at31 = await ownerSnapshot(db.pool);
      const tg31 = await fenceTriggerSnapshot(db.pool);
      assert.deepEqual((await up(db.pool, { dir: dir32 })).applied, [32]);
      const at32 = await ownerSnapshot(db.pool);
      const tg32 = await fenceTriggerSnapshot(db.pool);
      /** @type {(s: { functions: any[] }) => Record<string, any>} */
      const bySig = (s) => Object.fromEntries(s.functions.map((f) => [f.sig, f]));
      const f31 = bySig(at31);
      const f32 = bySig(at32);
      assert.deepEqual(
        Object.keys(f32).filter((k) => !(k in f31)),
        [ADDED],
        'دالّةٌ جديدةٌ واحدة',
      );
      assert.deepEqual(
        Object.keys(f31).filter((k) => !(k in f32)),
        [],
        'لا دالّةَ محذوفة',
      );
      for (const sig of Object.keys(f31)) {
        if (sig === 'fence.check_fenced()') {
          assert.notEqual(f32[sig].def, f31[sig].def, `${sig} تغيّر`);
          for (const k of ['vol', 'secdef', 'owner', 'acl'])
            assert.equal(f32[sig][k], f31[sig][k], `${sig}.${k} حرفيّاً`);
        } else assert.deepEqual(f32[sig], f31[sig], `${sig} حرفيّاً`);
      }
      assert.match(f32[ADDED].def, /XF107/);
      assert.match(f32[ADDED].def, /session_user/);
      assert.equal(f32[ADDED].secdef, false, 'SECURITY INVOKER');
      assert.match(f32['fence.check_fenced()'].def, /fence_table_writer_unguarded/);
      // ‏البيانُ: الدالّةُ الجديدةُ تُسجَّل، وcheck_fenced يُعادُ تسجيلُه، ولا غيرُهما.
      /** @type {(s: { manifest: any[] }) => Record<string, string>} */
      const m = (s) => Object.fromEntries(s.manifest.map((r) => [r.function_signature, r.digest]));
      const m31 = m(at31);
      const m32 = m(at32);
      assert.deepEqual(
        Object.keys(m32).filter((k) => !(k in m31)),
        [ADDED],
      );
      assert.deepEqual(
        Object.keys(m31).filter((k) => m31[k] !== m32[k]),
        ['fence.check_fenced()'],
      );
      assert.deepEqual(at32.owner, at31.owner, 'امتيازاتُ xf_owner وعضويّاتُه لا تتغيّر');
      assert.deepEqual(at32.tables, at31.tables, 'ملكيّةُ جداولِ fence وACL لا تتغيّر');
      assert.deepEqual(at32.eventTriggers, at31.eventTriggers);
      // ‏المُطلِقات: ما قبلَها حرفيّاً، وxf_owner_writer واحدٌ (‏ENABLE ALWAYS) على كلِّ جدولٍ غيرِ control.
      const tables = await db.pool.query(
        `SELECT relname FROM pg_class WHERE relnamespace = 'fence'::regnamespace AND relkind = 'r'
            AND relname <> 'control' ORDER BY 1`,
      );
      const added = tg32.filter((t) => t.tgname === 'xf_owner_writer');
      assert.deepEqual(
        tg32.filter((t) => t.tgname !== 'xf_owner_writer'),
        tg31,
      );
      assert.equal(tg31.filter((t) => t.tgname === 'xf_owner_writer').length, 0);
      assert.deepEqual(
        added.map((t) => t.relname),
        tables.rows.map((r) => r.relname),
      );
      assert.ok(added.length >= 10, `مُطلِقاتٌ كثيرة (${added.length})`);
      for (const t of added) {
        assert.equal(t.tgenabled, 'A', `${t.relname}: ENABLE ALWAYS`);
        assert.equal(t.fn, ADDED);
        // ‏BEFORE (2) | INSERT (4) | DELETE (8) | UPDATE (16) | TRUNCATE (32)، على مستوى الجملة (‏لا ROW=1).
        assert.equal(Number(t.tgtype), 2 | 4 | 8 | 16 | 32, `${t.relname}: نوعُ المُطلِق`);
      }
      // ‏الكشف: مُطلِقٌ مُعطَّلٌ (‏بيدِ superuser بعدَ تعطيلِ xf_ddl_end) يظهرُ في check_fenced، والإعادةُ تمحوه.
      const kinds = async () =>
        (await db.pool.query('SELECT fence.check_fenced() AS r')).rows[0].r.problems.map(
          (/** @type {{ kind: string }} */ p) => p.kind,
        );
      assert.ok(!(await kinds()).includes('fence_table_writer_unguarded'));
      const client = await db.pool.connect();
      try {
        await client.query('BEGIN');
        await client.query('ALTER EVENT TRIGGER xf_ddl_end DISABLE');
        await client.query('ALTER TABLE fence.run_lease DISABLE TRIGGER xf_owner_writer');
        const r = await client.query('SELECT fence.check_fenced() AS r');
        const p = r.rows[0].r.problems.find(
          (/** @type {{ kind: string }} */ x) => x.kind === 'fence_table_writer_unguarded',
        );
        assert.ok(p, 'المُطلِقُ المُعطَّلُ يُكشَف');
        assert.deepEqual(p.tables, ['run_lease']);
      } finally {
        await client.query('ROLLBACK');
        client.release();
      }
      assert.ok(!(await kinds()).includes('fence_table_writer_unguarded'));
      // ‏الرجوعُ يُعيدُ 0031 حرفياً (‏دوالَّ وبياناً ومُطلِقات)؛ وإعادةُ التقديمِ تُطابقُ 0032.
      assert.equal((await down(db.pool, { steps: 1, dir: dir32 })).current, 31);
      assert.deepEqual(await ownerSnapshot(db.pool), at31);
      assert.deepEqual(await fenceTriggerSnapshot(db.pool), tg31);
      assert.deepEqual((await up(db.pool, { dir: dir32 })).applied, [32]);
      assert.deepEqual(await ownerSnapshot(db.pool), at32);
      assert.deepEqual(await fenceTriggerSnapshot(db.pool), tg32);
    });
  },
);

// ── WL-563: عضويّةُ xf_owner الصاعدة (‏0033) — دالّةُ جردٍ جديدة، والحارسان وcheck_fenced وحدَها؛ الرجوعُ يُعيدُ 0032 حرفياً ──
describe(
  'WL-563 — 0033: الترقيةُ تُضيفُ _owner_reach_problems وتُغيّرُ _control_guard و_table_writer_guard وcheck_fenced فقط، والرجوعُ إلى 0032 حرفياً',
  { skip: skipWithoutDatabase },
  () => {
    /** @type {Awaited<ReturnType<typeof createIsolatedDatabase>>} */
    let db;
    /** @type {string} */
    let dir32;
    /** @type {string} */
    let dir33;
    const src = fileURLToPath(new URL('../../migrations/', import.meta.url));
    /** @param {number} upTo */
    const migrationsDir = (upTo) => {
      const d = registerTmpRoot(mkdtempSync(join(tmpdir(), 'xuux-mig-')));
      for (const f of readdirSync(src)) {
        if (Number(f.slice(0, 4)) > upTo) continue;
        writeFileSync(join(d, f), readFileSync(join(src, f), 'utf8'));
      }
      return d;
    };
    const ADDED = 'fence._owner_reach_problems()';
    const CHANGED = [
      'fence._control_guard()',
      'fence._table_writer_guard()',
      'fence.check_fenced()',
    ];
    before(async () => {
      dir32 = migrationsDir(32);
      dir33 = migrationsDir(33);
      db = await createIsolatedDatabase('m0033');
      await up(db.pool, { dir: dir32 });
    });
    after(async () => {
      if (db !== undefined) await db.drop();
      for (const d of [dir32, dir33]) rmSync(d, { recursive: true, force: true });
    });

    it('تقديمٌ ورجوعٌ وإعادةُ تقديم: دالّةٌ جديدةٌ واحدةٌ مسحوبةٌ من PUBLIC، وثلاثُ دوالَّ تتغيّرُ نصّاً فقط؛ والأدوارُ والجداولُ والمُطلِقاتُ حرفيّاً؛ والرجوعُ يُطابقُ 0032', async () => {
      const at32 = await ownerSnapshot(db.pool);
      const tg32 = await fenceTriggerSnapshot(db.pool);
      assert.deepEqual((await up(db.pool, { dir: dir33 })).applied, [33]);
      const at33 = await ownerSnapshot(db.pool);
      /** @type {(s: { functions: any[] }) => Record<string, any>} */
      const bySig = (s) => Object.fromEntries(s.functions.map((f) => [f.sig, f]));
      const f32 = bySig(at32);
      const f33 = bySig(at33);
      assert.deepEqual(
        Object.keys(f33).filter((k) => !(k in f32)),
        [ADDED],
        'دالّةٌ جديدةٌ واحدة',
      );
      assert.deepEqual(
        Object.keys(f32).filter((k) => !(k in f33)),
        [],
        'لا دالّةَ محذوفة',
      );
      for (const sig of Object.keys(f32)) {
        if (CHANGED.includes(sig)) {
          assert.notEqual(f33[sig].def, f32[sig].def, `${sig} تغيّر`);
          for (const k of ['vol', 'secdef', 'owner', 'acl'])
            assert.equal(f33[sig][k], f32[sig][k], `${sig}.${k} حرفيّاً`);
        } else assert.deepEqual(f33[sig], f32[sig], `${sig} حرفيّاً`);
      }
      assert.equal(f33[ADDED].secdef, false, 'SECURITY INVOKER');
      assert.equal(f33[ADDED].owner, 'xf_owner');
      assert.match(f33[ADDED].def, /owner_upward_membership/);
      assert.match(f33['fence.check_fenced()'].def, /owner_reach_inventory_failed/);
      for (const sig of ['fence._control_guard()', 'fence._table_writer_guard()'])
        assert.match(
          f33[sig].def,
          /IS DISTINCT FROM \(SELECT o\.oid FROM pg_roles o WHERE o\.rolname = 'xf_owner'\)/,
          sig,
        );
      const acl = await db.pool.query(
        `SELECT has_function_privilege('xuux_worker', $1::regprocedure, 'EXECUTE') AS w,
                has_function_privilege('xf_owner', $1::regprocedure, 'EXECUTE') AS o`,
        [ADDED],
      );
      assert.deepEqual(acl.rows[0], { w: false, o: true }, 'ليست لـPUBLIC');
      // ‏البيانُ: الجديدةُ تُسجَّل، والثلاثُ يُعادُ تسجيلُها، ولا غيرُها.
      /** @type {(s: { manifest: any[] }) => Record<string, string>} */
      const m = (s) => Object.fromEntries(s.manifest.map((r) => [r.function_signature, r.digest]));
      const m32 = m(at32);
      const m33 = m(at33);
      assert.deepEqual(
        Object.keys(m33).filter((k) => !(k in m32)),
        [ADDED],
      );
      assert.deepEqual(
        Object.keys(m32)
          .filter((k) => m32[k] !== m33[k])
          .sort(),
        [...CHANGED].sort(),
      );
      assert.deepEqual(at33.owner, at32.owner, 'امتيازاتُ xf_owner وعضويّاتُه لا تتغيّر');
      assert.deepEqual(at33.tables, at32.tables, 'ملكيّةُ جداولِ fence وACL لا تتغيّر');
      assert.deepEqual(at33.eventTriggers, at32.eventTriggers);
      assert.deepEqual(await fenceTriggerSnapshot(db.pool), tg32, 'المُطلِقاتُ حرفيّاً');
      const ok = (await db.pool.query('SELECT fence.check_fenced() AS r')).rows[0].r;
      assert.deepEqual(
        ok.problems.filter((/** @type {{ kind: string }} */ p) =>
          /^owner_(upward|reach)/.test(p.kind),
        ),
        [],
        'الأساسُ صامت',
      );
      // ‏الرجوعُ يُعيدُ 0032 حرفياً؛ وإعادةُ التقديمِ تُطابقُ 0033.
      assert.equal((await down(db.pool, { steps: 1, dir: dir33 })).current, 32);
      assert.deepEqual(await ownerSnapshot(db.pool), at32);
      assert.deepEqual(await fenceTriggerSnapshot(db.pool), tg32);
      assert.deepEqual((await up(db.pool, { dir: dir33 })).applied, [33]);
      assert.deepEqual(await ownerSnapshot(db.pool), at33);
    });
  },
);

// ── WL-564: امتيازاتُ fence المنجرفة (‏0034) — دالّةُ جردٍ جديدة، والحارسان وcheck_fenced وحدَها؛ الرجوعُ يُعيدُ 0033 حرفياً ──
describe(
  'WL-564 — 0034: الترقيةُ تُضيفُ _fence_acl_problems وتُغيّرُ _control_guard و_table_writer_guard وcheck_fenced فقط، والرجوعُ إلى 0033 حرفياً',
  { skip: skipWithoutDatabase },
  () => {
    /** @type {Awaited<ReturnType<typeof createIsolatedDatabase>>} */
    let db;
    /** @type {string} */
    let dir33;
    /** @type {string} */
    let dir34;
    const src = fileURLToPath(new URL('../../migrations/', import.meta.url));
    /** @param {number} upTo */
    const migrationsDir = (upTo) => {
      const d = registerTmpRoot(mkdtempSync(join(tmpdir(), 'xuux-mig-')));
      for (const f of readdirSync(src)) {
        if (Number(f.slice(0, 4)) > upTo) continue;
        writeFileSync(join(d, f), readFileSync(join(src, f), 'utf8'));
      }
      return d;
    };
    const ADDED = 'fence._fence_acl_problems()';
    const CHANGED = [
      'fence._control_guard()',
      'fence._table_writer_guard()',
      'fence.check_fenced()',
    ];
    before(async () => {
      dir33 = migrationsDir(33);
      dir34 = migrationsDir(34);
      db = await createIsolatedDatabase('m0034');
      await up(db.pool, { dir: dir33 });
    });
    after(async () => {
      if (db !== undefined) await db.drop();
      for (const d of [dir33, dir34]) rmSync(d, { recursive: true, force: true });
    });

    it('تقديمٌ ورجوعٌ وإعادةُ تقديم: دالّةٌ جديدةٌ واحدةٌ مسحوبةٌ من PUBLIC، وثلاثُ دوالَّ تتغيّرُ نصّاً فقط؛ والأدوارُ والجداولُ والمُطلِقاتُ حرفيّاً؛ والرجوعُ يُطابقُ 0033', async () => {
      const at33 = await ownerSnapshot(db.pool);
      const tg33 = await fenceTriggerSnapshot(db.pool);
      assert.deepEqual((await up(db.pool, { dir: dir34 })).applied, [34]);
      const at34 = await ownerSnapshot(db.pool);
      /** @type {(s: { functions: any[] }) => Record<string, any>} */
      const bySig = (s) => Object.fromEntries(s.functions.map((f) => [f.sig, f]));
      const f33 = bySig(at33);
      const f34 = bySig(at34);
      assert.deepEqual(
        Object.keys(f34).filter((k) => !(k in f33)),
        [ADDED],
        'دالّةٌ جديدةٌ واحدة',
      );
      assert.deepEqual(
        Object.keys(f33).filter((k) => !(k in f34)),
        [],
        'لا دالّةَ محذوفة',
      );
      for (const sig of Object.keys(f33)) {
        if (CHANGED.includes(sig)) {
          assert.notEqual(f34[sig].def, f33[sig].def, `${sig} تغيّر`);
          for (const k of ['vol', 'secdef', 'owner', 'acl'])
            assert.equal(f34[sig][k], f33[sig][k], `${sig}.${k} حرفيّاً`);
        } else assert.deepEqual(f34[sig], f33[sig], `${sig} حرفيّاً`);
      }
      assert.equal(f34[ADDED].secdef, false, 'SECURITY INVOKER');
      assert.equal(f34[ADDED].owner, 'xf_owner');
      assert.match(f34[ADDED].def, /fence_acl_drift/);
      assert.match(f34['fence.check_fenced()'].def, /fence_acl_inventory_failed/);
      for (const sig of ['fence._control_guard()', 'fence._table_writer_guard()'])
        assert.match(f34[sig].def, /'XF108'/, sig);
      const acl = await db.pool.query(
        `SELECT has_function_privilege('xuux_worker', $1::regprocedure, 'EXECUTE') AS w,
                has_function_privilege('xf_owner', $1::regprocedure, 'EXECUTE') AS o`,
        [ADDED],
      );
      assert.deepEqual(acl.rows[0], { w: false, o: true }, 'ليست لـPUBLIC');
      // ‏البيانُ: الجديدةُ تُسجَّل، والثلاثُ يُعادُ تسجيلُها، ولا غيرُها.
      /** @type {(s: { manifest: any[] }) => Record<string, string>} */
      const m = (s) => Object.fromEntries(s.manifest.map((r) => [r.function_signature, r.digest]));
      const m33 = m(at33);
      const m34 = m(at34);
      assert.deepEqual(
        Object.keys(m34).filter((k) => !(k in m33)),
        [ADDED],
      );
      assert.deepEqual(
        Object.keys(m33)
          .filter((k) => m33[k] !== m34[k])
          .sort(),
        [...CHANGED].sort(),
      );
      assert.deepEqual(at34.owner, at33.owner, 'امتيازاتُ xf_owner وعضويّاتُه لا تتغيّر');
      assert.deepEqual(at34.tables, at33.tables, 'ملكيّةُ جداولِ fence وACL لا تتغيّر');
      assert.deepEqual(at34.eventTriggers, at33.eventTriggers);
      assert.deepEqual(await fenceTriggerSnapshot(db.pool), tg33, 'المُطلِقاتُ حرفيّاً');
      const ok = (await db.pool.query('SELECT fence.check_fenced() AS r')).rows[0].r;
      assert.deepEqual(
        ok.problems.filter((/** @type {{ kind: string }} */ p) => /^fence_acl_/.test(p.kind)),
        [],
        'الأساسُ صامت',
      );
      // ‏الرجوعُ يُعيدُ 0033 حرفياً؛ وإعادةُ التقديمِ تُطابقُ 0034.
      assert.equal((await down(db.pool, { steps: 1, dir: dir34 })).current, 33);
      assert.deepEqual(await ownerSnapshot(db.pool), at33);
      assert.deepEqual(await fenceTriggerSnapshot(db.pool), tg33);
      assert.deepEqual((await up(db.pool, { dir: dir34 })).applied, [34]);
      assert.deepEqual(await ownerSnapshot(db.pool), at34);
    });
  },
);

// ── WL-570: عضويّةٌ بينَ الأدوارِ السياديّة (‏0035) — دالّةُ جردٍ جديدة وcheck_fenced وحدَها؛ الرجوعُ يُعيدُ 0034 حرفياً ──
describe(
  'WL-570 — 0035: الترقيةُ تُضيفُ _sovereign_membership_problems وتُغيّرُ check_fenced فقط، والرجوعُ إلى 0034 حرفياً',
  { skip: skipWithoutDatabase },
  () => {
    /** @type {Awaited<ReturnType<typeof createIsolatedDatabase>>} */
    let db;
    /** @type {string} */
    let dir34;
    /** @type {string} */
    let dir35;
    const src = fileURLToPath(new URL('../../migrations/', import.meta.url));
    /** @param {number} upTo */
    const migrationsDir = (upTo) => {
      const d = registerTmpRoot(mkdtempSync(join(tmpdir(), 'xuux-mig-')));
      for (const f of readdirSync(src)) {
        if (Number(f.slice(0, 4)) > upTo) continue;
        writeFileSync(join(d, f), readFileSync(join(src, f), 'utf8'));
      }
      return d;
    };
    const ADDED = 'fence._sovereign_membership_problems()';
    const CHANGED = ['fence.check_fenced()'];
    before(async () => {
      dir34 = migrationsDir(34);
      dir35 = migrationsDir(35);
      db = await createIsolatedDatabase('m0035');
      await up(db.pool, { dir: dir34 });
    });
    after(async () => {
      if (db !== undefined) await db.drop();
      for (const d of [dir34, dir35]) rmSync(d, { recursive: true, force: true });
    });

    it('تقديمٌ ورجوعٌ وإعادةُ تقديم: دالّةٌ جديدةٌ واحدةٌ مسحوبةٌ من PUBLIC، وcheck_fenced وحدَها تتغيّرُ نصّاً؛ والحارسانِ والأدوارُ والجداولُ والمُطلِقاتُ حرفيّاً؛ والرجوعُ يُطابقُ 0034', async () => {
      const at34 = await ownerSnapshot(db.pool);
      const tg34 = await fenceTriggerSnapshot(db.pool);
      assert.deepEqual((await up(db.pool, { dir: dir35 })).applied, [35]);
      const at35 = await ownerSnapshot(db.pool);
      /** @type {(s: { functions: any[] }) => Record<string, any>} */
      const bySig = (s) => Object.fromEntries(s.functions.map((f) => [f.sig, f]));
      const f34 = bySig(at34);
      const f35 = bySig(at35);
      assert.deepEqual(
        Object.keys(f35).filter((k) => !(k in f34)),
        [ADDED],
        'دالّةٌ جديدةٌ واحدة',
      );
      assert.deepEqual(
        Object.keys(f34).filter((k) => !(k in f35)),
        [],
        'لا دالّةَ محذوفة',
      );
      for (const sig of Object.keys(f34)) {
        if (CHANGED.includes(sig)) {
          assert.notEqual(f35[sig].def, f34[sig].def, `${sig} تغيّر`);
          for (const k of ['vol', 'secdef', 'owner', 'acl'])
            assert.equal(f35[sig][k], f34[sig][k], `${sig}.${k} حرفيّاً`);
        } else assert.deepEqual(f35[sig], f34[sig], `${sig} حرفيّاً`);
      }
      // ‏الحارسان (‏0032/0033/0034) والحاصدُ لم يُمَسّا — مشمولةٌ في «حرفيّاً» أعلاه، وتُسمّى هنا صراحةً.
      for (const sig of ['fence._control_guard()', 'fence._table_writer_guard()'])
        assert.deepEqual(f35[sig], f34[sig], `${sig} بنصِّ 0034`);
      assert.equal(f35[ADDED].secdef, false, 'SECURITY INVOKER');
      assert.equal(f35[ADDED].owner, 'xf_owner');
      assert.match(f35[ADDED].def, /sovereign_membership/);
      assert.match(f35['fence.check_fenced()'].def, /sovereign_membership_inventory_failed/);
      assert.match(f35['fence.check_fenced()'].def, /sovereign_membership_detect_only/);
      const acl = await db.pool.query(
        `SELECT has_function_privilege('xuux_worker', $1::regprocedure, 'EXECUTE') AS w,
                has_function_privilege('xf_owner', $1::regprocedure, 'EXECUTE') AS o`,
        [ADDED],
      );
      assert.deepEqual(acl.rows[0], { w: false, o: true }, 'ليست لـPUBLIC');
      /** @type {(s: { manifest: any[] }) => Record<string, string>} */
      const m = (s) => Object.fromEntries(s.manifest.map((r) => [r.function_signature, r.digest]));
      const m34 = m(at34);
      const m35 = m(at35);
      assert.deepEqual(
        Object.keys(m35).filter((k) => !(k in m34)),
        [ADDED],
      );
      assert.deepEqual(
        Object.keys(m34).filter((k) => m34[k] !== m35[k]),
        CHANGED,
      );
      assert.deepEqual(at35.owner, at34.owner, 'امتيازاتُ xf_owner وعضويّاتُه لا تتغيّر');
      assert.deepEqual(at35.tables, at34.tables, 'ملكيّةُ جداولِ fence وACL لا تتغيّر');
      assert.deepEqual(at35.eventTriggers, at34.eventTriggers);
      assert.deepEqual(await fenceTriggerSnapshot(db.pool), tg34, 'المُطلِقاتُ حرفيّاً');
      const ok = (await db.pool.query('SELECT fence.check_fenced() AS r')).rows[0].r;
      assert.deepEqual(
        ok.problems.filter((/** @type {{ kind: string }} */ p) => /^sovereign_/.test(p.kind)),
        [],
        'الأساسُ صامت',
      );
      // ‏الرجوعُ يُعيدُ 0034 حرفياً؛ وإعادةُ التقديمِ تُطابقُ 0035.
      assert.equal((await down(db.pool, { steps: 1, dir: dir35 })).current, 34);
      assert.deepEqual(await ownerSnapshot(db.pool), at34);
      assert.deepEqual(await fenceTriggerSnapshot(db.pool), tg34);
      const gone = await db.pool.query(
        `SELECT count(*)::int AS n FROM pg_proc WHERE proname = '_sovereign_membership_problems'`,
      );
      assert.equal(gone.rows[0].n, 0, 'الدالّةُ أُسقِطت');
      assert.deepEqual((await up(db.pool, { dir: dir35 })).applied, [35]);
      assert.deepEqual(await ownerSnapshot(db.pool), at35);
    });
  },
);

// ── WL-619: ‏LIVE-75/RLS-INITPLAN (‏0036) — xf_read بالساعةِ لكلِّ صفّ؛ دالّةٌ جديدة وستُّ دوالَّ تتغيّرُ نصّاً؛ الرجوعُ إلى 0035 حرفياً ──
describe(
  'WL-619 — 0036: xf_read بالصيغةِ الجديدةِ على كلِّ علاقةٍ محميّة، والدوالُّ المتغيّرةُ وحدَها، والرجوعُ إلى 0035 حرفياً',
  { skip: skipWithoutDatabase },
  () => {
    /** @type {Awaited<ReturnType<typeof createIsolatedDatabase>>} */
    let db;
    /** @type {string} */
    let dir35;
    /** @type {string} */
    let dir36;
    const src = fileURLToPath(new URL('../../migrations/', import.meta.url));
    /** @param {number} upTo */
    const migrationsDir = (upTo) => {
      const d = registerTmpRoot(mkdtempSync(join(tmpdir(), 'xuux-mig-')));
      for (const f of readdirSync(src)) {
        if (Number(f.slice(0, 4)) > upTo) continue;
        writeFileSync(join(d, f), readFileSync(join(src, f), 'utf8'));
      }
      return d;
    };
    const ADDED = 'fence.read_window()';
    const CHANGED = [
      'fence._fence_acl_problems()',
      'fence._worker_allowed_execute()',
      'fence.check_fenced()',
      'fence.cover_relation(oid)',
      'fence.coverage_problems()',
      'fence.reaper_capability_problems()',
    ];
    const OLD = '( SELECT fence.read_ok() AS read_ok)';
    const NEW = '(clock_timestamp() <@ ( SELECT fence.read_window() AS read_window))';
    /** @param {import('pg').Pool} pool */
    const policies = async (pool) =>
      (
        await pool.query(
          `SELECT po.polrelid::regclass::text AS rel, po.polname AS name, po.polcmd AS cmd, po.polpermissive AS perm,
                  po.polroles::text AS roles, pg_get_expr(po.polqual, po.polrelid) AS q,
                  pg_get_expr(po.polwithcheck, po.polrelid) AS w
             FROM pg_policy po ORDER BY 1, 2`,
        )
      ).rows;
    before(async () => {
      dir35 = migrationsDir(35);
      dir36 = migrationsDir(36);
      db = await createIsolatedDatabase('m0036');
      await up(db.pool, { dir: dir35 });
    });
    after(async () => {
      if (db !== undefined) await db.drop();
      for (const d of [dir35, dir36]) rmSync(d, { recursive: true, force: true });
    });

    it('تقديمٌ ورجوعٌ وإعادةُ تقديم: كلُّ xf_read يتحوّلُ ويعود، ودالّةٌ جديدةٌ واحدة، والدوالُّ الستُّ وحدَها تتغيّرُ نصّاً؛ والرجوعُ يُطابقُ 0035', async () => {
      const at35 = await ownerSnapshot(db.pool);
      const tg35 = await fenceTriggerSnapshot(db.pool);
      const p35 = await policies(db.pool);
      assert.ok(p35.length > 0);
      const problems35 = (await db.pool.query('SELECT fence.check_fenced() AS r')).rows[0].r
        .problems;
      for (const p of p35) {
        assert.equal(p.name, 'xf_read', `${p.rel}: لا سياسةَ غيرُ xf_read في الأساس`);
        assert.deepEqual([p.q, p.w], [OLD, OLD], `${p.rel}: صيغةُ 0024`);
      }
      assert.deepEqual((await up(db.pool, { dir: dir36 })).applied, [36]);
      const at36 = await ownerSnapshot(db.pool);
      const p36 = await policies(db.pool);
      assert.deepEqual(
        p36.map((p) => ({ ...p, q: null, w: null })),
        p35.map((p) => ({ ...p, q: null, w: null })),
        'العلاقاتُ والأوامرُ والأدوارُ والتساهلُ حرفيّاً',
      );
      for (const p of p36) assert.deepEqual([p.q, p.w], [NEW, NEW], `${p.rel}: الصيغةُ الجديدة`);
      /** @type {(s: { functions: any[] }) => Record<string, any>} */
      const bySig = (s) => Object.fromEntries(s.functions.map((f) => [f.sig, f]));
      const f35 = bySig(at35);
      const f36 = bySig(at36);
      assert.deepEqual(
        Object.keys(f36).filter((k) => !(k in f35)),
        [ADDED],
        'دالّةٌ جديدةٌ واحدة',
      );
      assert.deepEqual(
        Object.keys(f35).filter((k) => !(k in f36)),
        [],
        'لا دالّةَ محذوفة',
      );
      for (const sig of Object.keys(f35)) {
        if (CHANGED.includes(sig)) {
          assert.notEqual(f36[sig].def, f35[sig].def, `${sig} تغيّر`);
          for (const k of ['vol', 'secdef', 'owner', 'acl'])
            assert.equal(f36[sig][k], f35[sig][k], `${sig}.${k} حرفيّاً`);
        } else assert.deepEqual(f36[sig], f35[sig], `${sig} حرفيّاً`);
      }
      // ‏الدالّةُ الجديدةُ بخصائصِ read_ok() نفسِها: مالكٌ وSECURITY DEFINER وSTABLE وsearch_path مثبَّت وACL.
      const rk = f35['fence.read_ok()'];
      const rw = f36[ADDED];
      for (const k of ['vol', 'secdef', 'owner'])
        assert.equal(rw[k], rk[k], `read_window.${k} = read_ok.${k}`);
      /** @param {string} acl */
      const aclSet = (acl) =>
        acl
          .replace(/^\{|\}$/gu, '')
          .split(',')
          .sort();
      assert.deepEqual(
        aclSet(rw.acl),
        aclSet(rk.acl),
        'ACL مطابقةٌ لـread_ok() (‏PUBLIC والأدوارُ الثلاثة)',
      );
      assert.match(rw.def, /SET search_path TO 'pg_catalog', 'pg_temp'/u);
      /** @type {(s: { manifest: any[] }) => Record<string, string>} */
      const m = (s) => Object.fromEntries(s.manifest.map((r) => [r.function_signature, r.digest]));
      const m35 = m(at35);
      const m36 = m(at36);
      assert.deepEqual(
        Object.keys(m36).filter((k) => !(k in m35)),
        [ADDED],
      );
      assert.deepEqual(
        Object.keys(m35)
          .filter((k) => m35[k] !== m36[k])
          .sort(),
        CHANGED,
      );
      assert.deepEqual(at36.owner, at35.owner, 'امتيازاتُ xf_owner وعضويّاتُه لا تتغيّر');
      assert.deepEqual(at36.tables, at35.tables, 'ملكيّةُ جداولِ fence وACL لا تتغيّر');
      assert.deepEqual(at36.eventTriggers, at35.eventTriggers);
      assert.deepEqual(await fenceTriggerSnapshot(db.pool), tg35, 'المُطلِقاتُ حرفيّاً');
      // ‏قاعدةٌ بلا إقلاعٍ ليست صامتة (‏incarnation_mismatch…)؛ المطلوبُ: لا مشكلةَ جديدةَ بعدَ التقديم.
      const ok = (await db.pool.query('SELECT fence.check_fenced() AS r')).rows[0].r;
      assert.deepEqual(ok.problems, problems35, 'check_fenced: لا مشكلةَ جديدةٌ بعدَ التقديم');
      // ‏غيرُ العاملِ (‏superuser هنا) نافذتُه غيرُ محدودة — كما read_ok() = true له.
      const win = (await db.pool.query(`SELECT fence.read_window()::text AS w`)).rows[0].w;
      assert.equal(win, '(,)');
      // ‏كشفُ الانحرافِ بلا قفل: coverage_problems() تُستدعى عندَ التزامِ كلِّ DDL؛ قفلٌ حصريٌّ على جدولٍ محميٍّ لا يُوقفُها
      // ‏(‏pg_get_expr بـrelid يفتحُ العلاقة — كانَ يُوقِفُ إنشاءَ جدولِ النسخِ المرحليّ: WL-592 B2).
      const locker = await db.pool.connect();
      const probe = await db.pool.connect();
      try {
        await locker.query('BEGIN');
        await locker.query('LOCK TABLE state.agents IN ACCESS EXCLUSIVE MODE');
        await probe.query('BEGIN');
        await probe.query(`SET LOCAL lock_timeout = '1s'`);
        const cp = (await probe.query('SELECT fence.coverage_problems() AS p')).rows[0].p;
        assert.deepEqual(cp, [], 'coverage_problems() لا تنتظرُ قفلَ جدولٍ محميّ');
        await probe.query('COMMIT');
      } finally {
        await locker.query('ROLLBACK');
        locker.release();
        probe.release();
      }
      // ‏الرجوعُ يُعيدُ 0035 حرفياً؛ وإعادةُ التقديمِ تُطابقُ 0036.
      assert.equal((await down(db.pool, { steps: 1, dir: dir36 })).current, 35);
      assert.deepEqual(await ownerSnapshot(db.pool), at35);
      assert.deepEqual(await fenceTriggerSnapshot(db.pool), tg35);
      assert.deepEqual(await policies(db.pool), p35, 'السياساتُ بصيغةِ 0024 حرفيّاً');
      assert.deepEqual((await up(db.pool, { dir: dir36 })).applied, [36]);
      assert.deepEqual(await ownerSnapshot(db.pool), at36);
      assert.deepEqual(await policies(db.pool), p36);
    });
  },
);
