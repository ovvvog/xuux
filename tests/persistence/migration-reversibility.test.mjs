/**
 * انعكاسُ كلِّ هجرةٍ على حدة — المسار `M3`، الخطوة `M3.03`.
 *
 * في `migrator.test.mjs` برهانٌ على أنّ تقديمَ **كلِّ** الهجراتِ ثمّ التراجعَ عن
 * **كلِّها** يُعيدُ القاعدةَ إلى حالتِها الأولى. وذلك برهانٌ على المجموعِ لا على
 * أفرادِه: لو خلّفتِ الهجرةُ 0014 فهرساً لا يُسقطُه تراجعُها، لمحاه تراجعُ 0001
 * حينَ يُلقي مخطَّطَ `state` بـ`CASCADE`، فتمرُّ المقايسةُ الكلّيةُ سليمةً ويبقى
 * العيبُ مستوراً حتى يُتراجَعَ في الإنتاجِ عن هجرةٍ واحدةٍ لا عن عشرين.
 *
 * فهنا البرهانُ الفردي: لكلِّ i يُلتقطُ الكتالوجُ عندَ i−1، وتُقدَّمُ i وحدَها،
 * ويُتراجَعُ عنها خطوةً واحدة، وتُقايَسُ الصورتان. والمنطقُ في
 * `src/persistence/reversibility.mjs` ليكونَ الاختبارُ والأداةُ
 * `npm run verify:migrations` على مسطرةٍ واحدة.
 */

import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, describe, it } from 'node:test';

import { proveReversibility } from '../../src/persistence/reversibility.mjs';
import { down, loadMigrations, up } from '../../src/persistence/migrator.mjs';
import { createIsolatedDatabase, skipWithoutDatabase } from '../helpers/pg.mjs';

describe('انعكاسُ الهجرات — كلُّ هجرةٍ على حدة', { skip: skipWithoutDatabase }, () => {
  /** @type {Awaited<ReturnType<typeof createIsolatedDatabase>>} */
  let db;
  /** @type {import('../../src/persistence/reversibility.mjs').ReversibilityReport} */
  let report;

  before(async () => {
    db = await createIsolatedDatabase('revers');
    report = await proveReversibility(db.pool);
  });

  after(async () => {
    if (db !== undefined) await db.drop();
  });

  it('يفحصُ كلَّ هجرةٍ موجودةٍ على القرصِ بلا استثناء', () => {
    const onDisk = loadMigrations().length;
    assert.equal(report.total, onDisk);
    assert.equal(
      report.checks.length,
      onDisk,
      'توقّفَ الفحصُ قبلَ آخرِ هجرة — أوّلُ إخفاقٍ يقطعُه.',
    );
  });

  it('يجري على PostgreSQL حقيقيّ لا على بديلٍ في الذاكرة', () => {
    assert.match(report.server, /PostgreSQL \d+/);
  });

  it('كلُّ هجرةٍ: التراجعُ يُعيدُ الكتالوجَ إلى ما كانَ قبلَ التقديم', () => {
    for (const check of report.checks) {
      assert.ok(
        check.reversible,
        `الهجرة ${check.version} (${check.name}) لم تُتراجَعْ إلى الأصل. الفرق: ${JSON.stringify(check.diff, null, 1)}`,
      );
    }
  });

  it('كلُّ هجرةٍ: التقديمُ يُغيّرُ الكتالوجَ فعلاً — لا هجرةَ فارغةٍ تمرُّ', () => {
    for (const check of report.checks) {
      assert.ok(
        check.effective,
        `الهجرة ${check.version} (${check.name}) لم تُغيّرِ الكتالوج، فانعكاسُها لا يُبرهنُ شيئاً.`,
      );
    }
  });

  it('كلُّ هجرةٍ: إعادةُ التقديمِ بعدَ التراجعِ تُنتجُ المخطَّطَ نفسَه', () => {
    for (const check of report.checks) {
      assert.ok(
        check.deterministic,
        `الهجرة ${check.version} (${check.name}): up→down→up أنتجَ مخطَّطاً مغايراً.`,
      );
    }
  });

  it('كلُّ هجرةٍ: دفترُ الهجراتِ يُسجّلُ رقمَها ويحذفُه ولا يمسُّ غيرَه', () => {
    for (const check of report.checks) {
      assert.ok(
        check.bookkeeping,
        `الهجرة ${check.version} (${check.name}): دفترُ schema_migrations لم يُطابقِ المتوقَّع.`,
      );
    }
  });

  it('الحكمُ الكلّيُّ صحيحٌ ومتّسقٌ مع الأحكامِ الفردية', () => {
    assert.equal(report.passed, report.total);
    assert.ok(report.ok);
  });
});

// ── WL-543: توافقُ 0024 مع القواعدِ التي طبّقت WL-541، ونقلُ إضافاتِ WL-542 إلى 0025 ──
//
// WL-542 عدّلَ 0024 بعدَ تطبيقِها في WL-541 فتغيّرت بصمتُها، والمُهاجِرُ يرفضُ قاعدةً على WL-541 بـ
// MIGRATION_CHECKSUM_MISMATCH. هنا: 0024 على القرصِ ببصمةِ WL-541 بعينِها؛ والقاعدةُ الجديدةُ والقاعدةُ
// المُرقّاةُ من 0024 القديمةِ تنتهيان إلى كتالوجِ دوالٍّ واحد؛ ورجوعُ 0025 يُعيدُ دوالَّ 0024 بايتاً ببايت.
// كتالوجُ `catalogSnapshot` لا يلتقطُ الدوالَّ ولا مُطلِقاتِ الأحداثِ ولا ACL، فيُلتقَطُ ذلك هنا.

/** بصمةُ 0024 كما طُبِّقت في WL-541 (‏545571c4) — ثابتٌ لا يُحدَّث. */
const WL541_0024_CHECKSUM = '9738e64028ff1a15198497534c76cb4abc2acfc37bc20941e63ce15fb51e12f7';
const REAPER_FUNCTIONS = [
  'fence._revoke_role(name,text)',
  'fence._lease_lapse_reason(fence.credentials,fence.control)',
  'fence._reap_lapsed()',
  'fence.reap_lapsed()',
];

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

/**
 * مشكلاتُ 0025 كما تُرى في الكتالوج (‏فارغةٌ = سليم). يُختبَرُ هو نفسُه بطفرات.
 * @param {import('pg').Pool} pool
 */
async function reaperProblems(pool) {
  /** @type {string[]} */
  const problems = [];
  const rows = (
    await pool.query(
      `SELECT p.oid::regprocedure::text AS sig, p.provolatile AS vol,
              EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                       WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE') AS public_exec,
              ARRAY(SELECT r.rolname::text FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                      JOIN pg_catalog.pg_roles r ON r.oid = a.grantee
                     WHERE a.privilege_type = 'EXECUTE' AND a.grantee <> p.proowner ORDER BY 1) AS grantees
         FROM pg_catalog.pg_proc p WHERE p.pronamespace = 'fence'::regnamespace`,
    )
  ).rows;
  const bySig = new Map(rows.map((r) => [String(r.sig), r]));
  for (const sig of REAPER_FUNCTIONS) {
    const r = bySig.get(sig);
    if (r === undefined) {
      problems.push(`${sig}: غائبة`);
      continue;
    }
    if (r.public_exec) problems.push(`${sig}: EXECUTE لـPUBLIC`);
  }
  const lapse = bySig.get('fence._lease_lapse_reason(fence.credentials,fence.control)');
  if (lapse !== undefined && lapse.vol !== 'v')
    problems.push(`_lease_lapse_reason: التقلّب ${lapse.vol} لا VOLATILE`);
  const reap = bySig.get('fence.reap_lapsed()');
  if (reap !== undefined && reap.grantees.join(',') !== 'xf_root,xf_sovereign')
    problems.push(`reap_lapsed: الممنوحون ${reap.grantees.join(',')} لا xf_root,xf_sovereign`);
  // read_ok() وحدَها لـPUBLIC عمداً في 0024 (‏تستدعيها سياسةُ RLS لكلِّ قارئ، ولا تكشفُ شيئاً لغيرِ العامل).
  for (const r of rows)
    if (r.public_exec && r.sig !== 'fence.read_ok()') problems.push(`${r.sig}: EXECUTE لـPUBLIC`);
  const renew = (
    await pool.query(
      `SELECT prosrc FROM pg_proc WHERE oid = 'fence.renew_lease(name)'::regprocedure`,
    )
  ).rows[0];
  if (!String(renew?.prosrc ?? '').includes('_lease_lapse_reason'))
    problems.push('renew_lease: لا يفحصُ الانقضاء (‏يُحيي الإيجارَ المنقضي)');
  // كلُّ دوالِّ fence يملكُها xf_owner (‏كما في 0024): مالكٌ superuser يجعلُ SECURITY DEFINER تصعيداً.
  const owners = (
    await pool.query(
      `SELECT p.oid::regprocedure::text AS sig FROM pg_proc p
        WHERE p.pronamespace = 'fence'::regnamespace AND pg_get_userbyid(p.proowner) <> 'xf_owner'`,
    )
  ).rows;
  for (const r of owners) problems.push(`${r.sig}: مالكُها ليس xf_owner`);
  // البيانُ كما يقرؤه check_fenced (‏fence_function_tampered / unlisted_fence_functions).
  const fenced = (await pool.query('SELECT fence.check_fenced() AS r')).rows[0].r;
  for (const p of fenced.problems ?? [])
    if (p.kind === 'fence_function_tampered' || p.kind === 'unlisted_fence_functions')
      problems.push(`البيان: ${p.kind} ${p.function ?? p.count}`);
  const ddlEnd = (
    await pool.query(`SELECT evtenabled FROM pg_event_trigger WHERE evtname = 'xf_ddl_end'`)
  ).rows[0];
  if (ddlEnd?.evtenabled !== 'A')
    problems.push(`xf_ddl_end: ${ddlEnd?.evtenabled} لا ENABLE ALWAYS`);
  return [...new Set(problems)];
}

/**
 * ضماناتُ WL-536..541 التي يجبُ ألّا تمسَّها 0025 تقديماً ولا رجوعاً.
 * @param {import('pg').Pool} pool
 */
async function wl541Guarantees(pool) {
  const r = (
    await pool.query(
      `SELECT
         NOT EXISTS (SELECT 1 FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                      WHERE p.pronamespace = 'pg_catalog'::regnamespace
                        AND p.proname IN ('pg_notify', 'pg_logical_emit_message')
                        AND a.grantee = 0) AS notify_revoked,
         NOT has_schema_privilege('public', 'public', 'CREATE') AS no_public_create,
         (SELECT count(*) FROM pg_event_trigger WHERE evtname LIKE 'xf\\_ddl\\_%' AND evtenabled = 'A') AS ddl_triggers`,
    )
  ).rows[0];
  return {
    notifyRevoked: r.notify_revoked,
    noPublicCreate: r.no_public_create,
    ddlTriggers: Number(r.ddl_triggers),
  };
}

describe('WL-543 — 0024 ببصمةِ WL-541، و0025 تكميليّة', () => {
  it('0024 على القرصِ هي نسخةُ WL-541 بعينِها (‏لا MIGRATION_CHECKSUM_MISMATCH لقاعدةٍ طبّقتها)', () => {
    const m = loadMigrations().find((x) => x.version === 24);
    assert.equal(m?.checksum, WL541_0024_CHECKSUM);
    const m25 = loadMigrations().find((x) => x.version === 25);
    assert.equal(m25?.name, 'fence_lease_reaper');
  });
});

describe(
  'WL-543 — ترقيةٌ من 0024 القديمة، ورجوعٌ، وإعادةُ تقديم',
  { skip: skipWithoutDatabase },
  () => {
    /** @type {Awaited<ReturnType<typeof createIsolatedDatabase>>} */
    let db;
    /** @type {Awaited<ReturnType<typeof createIsolatedDatabase>> | undefined} */
    let fresh;
    /** @type {string} */
    let dir24;
    // WL-544: هذه الحزمةُ تقيسُ 0025 — فالتقديمُ يقفُ عندَها صراحةً (‏0026 وما بعدَها لها حزمتُها).
    /** @type {string} */
    let dir25;
    /** @type {Awaited<ReturnType<typeof fenceFunctionCatalog>>} */
    let at24;
    /** @type {Awaited<ReturnType<typeof fenceFunctionCatalog>>} */
    let at25;
    const src = fileURLToPath(new URL('../../migrations/', import.meta.url));
    /** @param {number} upTo @param {(name: string, text: string) => string} [mutate] */
    const migrationsDir = (upTo, mutate = (_n, t) => t) => {
      const d = mkdtempSync(join(tmpdir(), 'xuux-mig-'));
      for (const f of readdirSync(src)) {
        if (Number(f.slice(0, 4)) > upTo) continue;
        writeFileSync(join(d, f), mutate(f, readFileSync(join(src, f), 'utf8')));
      }
      return d;
    };

    before(async () => {
      db = await createIsolatedDatabase('m0025');
      dir24 = migrationsDir(24);
      dir25 = migrationsDir(25);
    });
    after(async () => {
      if (db !== undefined) await db.drop();
      if (fresh !== undefined) await fresh.drop();
      rmSync(dir24, { recursive: true, force: true });
      rmSync(dir25, { recursive: true, force: true });
    });

    it('قاعدةٌ على 0024 القديمة (‏WL-541): البصمةُ المسجّلةُ ثابتةُ WL-541، والضماناتُ قائمة', async () => {
      const out = await up(db.pool, { dir: dir24 });
      assert.equal(out.current, 24);
      const row = (
        await db.pool.query('SELECT checksum FROM public.schema_migrations WHERE version = 24')
      ).rows[0];
      assert.equal(row.checksum, WL541_0024_CHECKSUM);
      assert.deepEqual(await wl541Guarantees(db.pool), {
        notifyRevoked: true,
        noPublicCreate: true,
        ddlTriggers: 3,
      });
      at24 = await fenceFunctionCatalog(db.pool);
      assert.ok(
        !at24.functions.some((f) => f.sig === 'fence.reap_lapsed()'),
        'الحاصدُ موجودٌ قبلَ 0025',
      );
    });

    it('تتقدّمُ إلى 0025 بلا اختلافِ بصمة، وكلُّ ضماناتِ 0025 قائمة', async () => {
      const out = await up(db.pool, { dir: dir25 });
      assert.deepEqual(out.applied, [25]);
      assert.deepEqual(await reaperProblems(db.pool), []);
      assert.deepEqual(await wl541Guarantees(db.pool), {
        notifyRevoked: true,
        noPublicCreate: true,
        ddlTriggers: 3,
      });
      at25 = await fenceFunctionCatalog(db.pool);
    });

    it('قاعدةٌ جديدةٌ تطبّقُ الهجراتِ كلَّها من البداية تنتهي إلى الكتالوجِ نفسِه', async () => {
      fresh = await createIsolatedDatabase('m0025f');
      await up(fresh.pool, { dir: dir25 });
      assert.deepEqual(await reaperProblems(fresh.pool), []);
      assert.deepEqual(await fenceFunctionCatalog(fresh.pool), at25);
    });

    it('رجوعُ 0025 يُعيدُ دوالَّ 0024 ومُطلِقاتِها وACL بايتاً ببايت، ولا يمسُّ ضماناتِ WL-541', async () => {
      const out = await down(db.pool, { steps: 1 });
      assert.equal(out.current, 24);
      assert.deepEqual(await fenceFunctionCatalog(db.pool), at24);
      assert.deepEqual(await wl541Guarantees(db.pool), {
        notifyRevoked: true,
        noPublicCreate: true,
        ddlTriggers: 3,
      });
    });

    it('إعادةُ تقديمِ 0025 بعدَ الرجوعِ تُنتجُ الكتالوجَ نفسَه', async () => {
      const out = await up(db.pool, { dir: dir25 });
      assert.deepEqual(out.applied, [25]);
      assert.deepEqual(await fenceFunctionCatalog(db.pool), at25);
    });

    it('طفرة: تعديلُ بايتٍ في 0024 المُطبَّقة يُرفَضُ بـMIGRATION_CHECKSUM_MISMATCH (‏العيبُ الذي يُصحَّح)', async () => {
      const d = migrationsDir(25, (n, t) => (n === '0024_fence.up.sql' ? `${t}\n-- طفرة\n` : t));
      try {
        await assert.rejects(up(db.pool, { dir: d }), { code: 'MIGRATION_CHECKSUM_MISMATCH' });
      } finally {
        rmSync(d, { recursive: true, force: true });
      }
    });

    it('عبثٌ سابقٌ بدالّةٍ في البيان: 0025 ترفضُ إعادةَ التسجيلِ فوقَه (‏لا شرعنة)، ولا يتغيّرُ شيء', async () => {
      await down(db.pool, { steps: 1 });
      const alter = async (/** @type {string} */ sql) => {
        await db.pool.query('ALTER EVENT TRIGGER xf_ddl_end DISABLE');
        try {
          await db.pool.query(sql);
        } finally {
          await db.pool.query('ALTER EVENT TRIGGER xf_ddl_end ENABLE ALWAYS');
        }
      };
      await alter('ALTER FUNCTION fence.renew_lease(name) SET work_mem = 64');
      const tampered = await fenceFunctionCatalog(db.pool);
      await assert.rejects(up(db.pool, { dir: dir25 }), /البيانُ لا يطابقُ 1 دالّة/);
      assert.deepEqual(await fenceFunctionCatalog(db.pool), tampered);
      await alter('ALTER FUNCTION fence.renew_lease(name) RESET work_mem');
      assert.deepEqual(await fenceFunctionCatalog(db.pool), at24);
      await up(db.pool, { dir: dir25 });
      assert.deepEqual(await fenceFunctionCatalog(db.pool), at25);
    });

    for (const [label, mutate, expected] of /** @type {const} */ ([
      [
        'بلا سحبِ PUBLIC عن الدوالِّ الجديدة',
        (/** @type {string} */ t) =>
          t.replace(/REVOKE ALL ON FUNCTION fence\._revoke_role[\s\S]*?FROM PUBLIC;/, ''),
        /EXECUTE لـPUBLIC/,
      ],
      [
        '_lease_lapse_reason ‏STABLE',
        (/** @type {string} */ t) =>
          t.replace(
            'LANGUAGE sql VOLATILE SECURITY DEFINER',
            'LANGUAGE sql STABLE SECURITY DEFINER',
          ),
        /لا VOLATILE/,
      ],
      [
        'reap_lapsed ممنوحةٌ لـxf_auditor',
        (/** @type {string} */ t) =>
          t.replace('TO xf_root, xf_sovereign;', 'TO xf_root, xf_sovereign, xf_auditor;'),
        /الممنوحون/,
      ],
      [
        'الدوالُّ الجديدةُ يُنشئُها superuser (‏بلا SET LOCAL ROLE xf_owner)',
        (/** @type {string} */ t) => t.replace('SET LOCAL ROLE xf_owner;', ''),
        /مالكُها ليس xf_owner/,
      ],
      [
        'بلا إعادةِ تسجيلِ البيان',
        (/** @type {string} */ t) =>
          t.replace(
            /\nDELETE FROM fence\.manifest[\s\S]*?\n-- وبعدَه[\s\S]*?\$manifest_post\$;\n/,
            '\n',
          ),
        /البيان: /,
      ],
      [
        'renew_lease بنصِّ WL-541 (‏يُحيي المنقضي)',
        (/** @type {string} */ t) =>
          t.replace(/CREATE OR REPLACE FUNCTION fence\.renew_lease[\s\S]*?\n\$f\$;\n/, ''),
        /renew_lease/,
      ],
    ])) {
      it(`طفرةٌ في 0025 تُكشَف: ${label}`, async () => {
        await down(db.pool, { steps: 1 });
        const d = migrationsDir(25, (n, t) =>
          n === '0025_fence_lease_reaper.up.sql' ? mutate(t) : t,
        );
        try {
          const m = readFileSync(join(d, '0025_fence_lease_reaper.up.sql'), 'utf8');
          assert.notEqual(
            m,
            readFileSync(join(src, '0025_fence_lease_reaper.up.sql'), 'utf8'),
            'الطفرةُ لم تُطبَّق',
          );
          await up(db.pool, { dir: d });
          const problems = await reaperProblems(db.pool);
          assert.ok(
            problems.some((p) => expected.test(p)),
            `لم تُكشَف: ${problems.join(' | ')}`,
          );
          // طفرةُ البيان: رجوعُ 0025 الحقيقيُّ يرفضُ بيانًا لا يطابقُ (‏فشلٌ مغلق)؛ فيُطبَّقُ للتنظيفِ مقطعُ
          // التسجيلِ الحقيقيُّ من 0025 بعينِه — لا تسجيلٌ مُخترَع.
          if (/البيان/.test(label)) {
            const real = readFileSync(join(src, '0025_fence_lease_reaper.up.sql'), 'utf8');
            const block = /\nDELETE FROM fence\.manifest[\s\S]*?\n-- وبعدَه/.exec(real)?.[0];
            assert.ok(block, 'مقطعُ تسجيلِ البيانِ غائبٌ عن 0025');
            await db.pool.query(block);
          }
          await down(db.pool, { steps: 1, dir: d });
        } finally {
          rmSync(d, { recursive: true, force: true });
        }
        await up(db.pool, { dir: dir25 });
        assert.deepEqual(await fenceFunctionCatalog(db.pool), at25);
      });
    }
  },
);

// ── WL-544: قراءةُ العاملِ خارجَ state ومشتقّاتُ fence (‏0026) ──
//
// قبلَ 0026: منحُ SELECT لـPUBLIC على داخليّاتِ fence، أو مشهدٌ فوقَها يملكُه دورٌ مميَّز، لا يُرى في
// capability_problems() (‏فلا يمنعُ RESUME). هنا: الهجومُ نفسُه على القاعدةِ نفسِها قبلَ 0026 وبعدَها، والرجوعُ يُعيدُ
// كتالوجَ 0025 بايتاً ببايت، وطفراتُ 0026 تُكشَفُ كلُّها. الأثرُ التشغيليُّ (‏RESUME، العاملُ الحيّ) في tests/fence/db-fence.test.mjs.

/**
 * هجماتُ القراءة: تُطبَّقُ بالمالكِ الأعلى (‏المُطلِقُ معطَّلٌ للحظةِ الأمرِ وحدَه) وتُعكَس.
 * @type {Array<{ name: string, apply: string[], revert: string[], kind: string, object: string }>}
 */
const READ_ATTACKS = [
  {
    name: 'SELECT لـPUBLIC على fence.credentials',
    apply: ['GRANT SELECT ON fence.credentials TO PUBLIC'],
    revert: ['REVOKE SELECT ON fence.credentials FROM PUBLIC'],
    kind: 'worker_read_outside_state',
    object: 'fence.credentials:SELECT',
  },
  {
    name: 'SELECT على تسلسلٍ في fence عبرَ دورٍ وسيط',
    apply: [
      'CREATE ROLE wl544_mid NOLOGIN',
      'GRANT SELECT ON SEQUENCE fence.evidence_id_seq TO wl544_mid',
      'GRANT wl544_mid TO xuux_worker',
    ],
    revert: [
      'REVOKE wl544_mid FROM xuux_worker',
      'REVOKE ALL ON SEQUENCE fence.evidence_id_seq FROM wl544_mid',
      'DROP ROLE wl544_mid',
    ],
    kind: 'worker_read_outside_state',
    object: 'fence.evidence_id_seq:SELECT',
  },
  {
    name: 'مشهدٌ في state فوقَ fence.challenges (‏يقرأُ بصلاحياتِ مالكِه)',
    apply: [
      'CREATE VIEW state.wl544_c AS SELECT nonce FROM fence.challenges',
      'GRANT SELECT ON state.wl544_c TO xuux_worker',
    ],
    revert: ['DROP VIEW state.wl544_c'],
    kind: 'worker_fence_derived_read',
    object: 'state.wl544_c:SELECT',
  },
  {
    name: 'مشهدٌ متداخل: state فوقَ public فوقَ fence.sovereign_commands',
    apply: [
      'CREATE VIEW public.wl544_a AS SELECT nonce, signature FROM fence.sovereign_commands',
      'CREATE VIEW state.wl544_b AS SELECT * FROM public.wl544_a',
      'GRANT SELECT ON state.wl544_b TO xuux_worker',
    ],
    revert: ['DROP VIEW state.wl544_b', 'DROP VIEW public.wl544_a'],
    kind: 'worker_fence_derived_read',
    object: 'state.wl544_b:SELECT',
  },
];

/**
 * @param {import('pg').Pool} pool
 * @param {string[]} stmts
 */
async function asOwner(pool, stmts) {
  await pool.query('ALTER EVENT TRIGGER xf_ddl_end DISABLE');
  try {
    for (const s of stmts) await pool.query(s);
  } finally {
    await pool.query('ALTER EVENT TRIGGER xf_ddl_end ENABLE ALWAYS');
  }
}

/**
 * هل يكشفُ capability_problems() الهجوم؟ يُطبِّقُ ثمّ يعكسُ دائماً.
 * @param {import('pg').Pool} pool
 * @param {(typeof READ_ATTACKS)[number]} a
 */
async function detects(pool, a) {
  await asOwner(pool, a.apply);
  try {
    const r = await pool.query('SELECT fence.capability_problems() AS p');
    return r.rows[0].p.some((/** @type {any} */ p) => p.kind === a.kind && p.object === a.object);
  } finally {
    await asOwner(pool, a.revert);
  }
}

describe(
  'WL-544 — 0026: الهجومُ قبلَها وبعدَها، والرجوع، والطفرات',
  { skip: skipWithoutDatabase },
  () => {
    /** @type {Awaited<ReturnType<typeof createIsolatedDatabase>>} */
    let db;
    /** @type {Awaited<ReturnType<typeof createIsolatedDatabase>> | undefined} */
    let fresh;
    /** @type {string} */
    let dir25;
    /** @type {string} */
    let dir26;
    /** @type {Awaited<ReturnType<typeof fenceFunctionCatalog>>} */
    let at25;
    /** @type {Awaited<ReturnType<typeof fenceFunctionCatalog>>} */
    let at26;
    const src = fileURLToPath(new URL('../../migrations/', import.meta.url));
    /** @param {number} upTo @param {(name: string, text: string) => string} [mutate] */
    const migrationsDir = (upTo, mutate = (_n, t) => t) => {
      const d = mkdtempSync(join(tmpdir(), 'xuux-mig-'));
      for (const f of readdirSync(src)) {
        if (Number(f.slice(0, 4)) > upTo) continue;
        writeFileSync(join(d, f), mutate(f, readFileSync(join(src, f), 'utf8')));
      }
      return d;
    };
    before(async () => {
      db = await createIsolatedDatabase('m0026');
      dir25 = migrationsDir(25);
      // WL-545: هذه الحزمةُ تقيسُ 0026 — فالتقديمُ يقفُ عندَها صراحةً (‏0027 وما بعدَها لها حزمتُها).
      dir26 = migrationsDir(26);
    });
    after(async () => {
      if (db !== undefined) await db.drop();
      if (fresh !== undefined) await fresh.drop();
      rmSync(dir25, { recursive: true, force: true });
      rmSync(dir26, { recursive: true, force: true });
    });

    it('قبلَ 0026 (‏قاعدةٌ على 0025): لا هجومَ قراءةٍ يُكشَف — العيبُ مقيسٌ لا مفترَض', async () => {
      assert.equal((await up(db.pool, { dir: dir25 })).current, 25);
      at25 = await fenceFunctionCatalog(db.pool);
      for (const a of READ_ATTACKS) assert.equal(await detects(db.pool, a), false, a.name);
    });

    it('الترقيةُ إلى 0026 بلا اختلافِ بصمة، وكلُّ هجومٍ يُكشَف، وخطُّ الأساسِ نظيف', async () => {
      assert.deepEqual((await up(db.pool, { dir: dir26 })).applied, [26]);
      for (const a of READ_ATTACKS) assert.equal(await detects(db.pool, a), true, a.name);
      const p = (await db.pool.query('SELECT fence.capability_problems() AS p')).rows[0].p;
      // ‏(worker_database_reach خارجَ هذه الحزمة: القاعدةُ هنا بلا إقلاعٍ ولا احتواء — WL-540.)
      const kinds = /^worker_(read_outside_state|fence_derived_read)$/;
      assert.deepEqual(
        p.filter((/** @type {any} */ x) => kinds.test(x.kind)),
        [],
        'لا إيجابيَّ كاذبٌ على قاعدةٍ جديدة',
      );
      at26 = await fenceFunctionCatalog(db.pool);
    });

    it('قاعدةٌ جديدةٌ من الصفر تنتهي إلى كتالوجِ 0026 نفسِه', async () => {
      fresh = await createIsolatedDatabase('m0026f');
      await up(fresh.pool, { dir: dir26 });
      assert.deepEqual(await fenceFunctionCatalog(fresh.pool), at26);
    });

    it('رجوعُ 0026 يُعيدُ كتالوجَ 0025 بايتاً ببايت (‏ويعودُ العيبُ كما قيس)، وإعادةُ التقديمِ تُطابق', async () => {
      assert.equal((await down(db.pool, { steps: 1 })).current, 25);
      assert.deepEqual(await fenceFunctionCatalog(db.pool), at25);
      assert.equal(
        await detects(db.pool, READ_ATTACKS[0] ?? assert.fail('READ_ATTACKS[0]')),
        false,
      );
      assert.deepEqual((await up(db.pool, { dir: dir26 })).applied, [26]);
      assert.deepEqual(await fenceFunctionCatalog(db.pool), at26);
    });

    for (const [label, mutate, attack] of /** @type {const} */ ([
      [
        'بلا قاعدةِ worker_read_outside_state',
        (/** @type {string} */ t) =>
          t.replace(
            /\n {4}SELECT 'worker_read_outside_state'[\s\S]*?IS DISTINCT FROM 'state'\n {4}UNION ALL/,
            '',
          ),
        0,
      ],
      [
        'استثناءُ fence من القراءةِ خارجَ state',
        (/** @type {string} */ t) =>
          t.replace("IS DISTINCT FROM 'state'", "NOT IN ('state', 'fence')"),
        0,
      ],
      [
        'التسلسلاتُ خارجَ القاعدة',
        (/** @type {string} */ t) =>
          t.replace(
            "x->>'axis' IN ('relation', 'sequence') AND x->>'privilege' = 'SELECT'",
            "x->>'axis' = 'relation' AND x->>'privilege' = 'SELECT'",
          ),
        1,
      ],
      [
        'بلا قاعدةِ worker_fence_derived_read',
        (/** @type {string} */ t) =>
          t.replace(
            /\n {4}SELECT 'worker_fence_derived_read'[\s\S]*?IN \('v', 'm'\)\n {4}UNION ALL/,
            '',
          ),
        2,
      ],
      [
        'إغلاقٌ غيرُ متعدٍّ (‏مشتقُّ المشتقِّ لا يُرى)',
        (/** @type {string} */ t) =>
          t.replace(
            /\n {4}UNION\n {4}SELECT rw\.ev_class[\s\S]*?WHERE rw\.ev_class <> d\.refobjid\n/,
            "\n    UNION\n    SELECT rw.ev_class FROM pg_rewrite rw\n    JOIN pg_depend d ON d.classid = 'pg_rewrite'::regclass AND d.objid = rw.oid AND d.refclassid = 'pg_class'::regclass\n    JOIN pg_class t ON t.oid = d.refobjid AND t.relnamespace = 'fence'::regnamespace\n    WHERE rw.ev_class <> d.refobjid\n",
          ),
        3,
      ],
    ])) {
      it(`طفرةٌ في 0026 تُكشَف: ${label}`, async () => {
        const d = migrationsDir(26, (n, t) =>
          n === '0026_fence_read_surface.up.sql' ? mutate(t) : t,
        );
        try {
          assert.notEqual(
            readFileSync(join(d, '0026_fence_read_surface.up.sql'), 'utf8'),
            readFileSync(join(src, '0026_fence_read_surface.up.sql'), 'utf8'),
            'الطفرةُ لم تُطبَّق',
          );
          await down(db.pool, { steps: 1 });
          await up(db.pool, { dir: d });
          assert.equal(
            await detects(db.pool, READ_ATTACKS[attack] ?? assert.fail(String(attack))),
            false,
            'الطفرةُ حيّة: الهجومُ لم يُكشَف',
          );
          await down(db.pool, { steps: 1, dir: d });
        } finally {
          rmSync(d, { recursive: true, force: true });
        }
        await up(db.pool, { dir: dir26 });
        assert.equal(
          await detects(db.pool, READ_ATTACKS[attack] ?? assert.fail(String(attack))),
          true,
          'النصُّ الحقيقيُّ يكشف',
        );
        assert.deepEqual(await fenceFunctionCatalog(db.pool), at26);
      });
    }
    // ‏(بلا SET LOCAL ROLE xf_owner طفرةٌ مكافئة: CREATE OR REPLACE يُبقي مالكَ الدالّةِ القائمة — لا تُعَدّ.)
  },
);

// ── WL-545: موعدُ الانقضاءِ التالي في نتيجةِ الحاصد (‏0027) ──
//
// 0027 تُبدِّلُ جسمَ fence._reap_lapsed() وحدَه (‏مفتاحٌ إضافيّ next_due_ms). هنا: ترقيةٌ من 0026 تُطبِّقُ [27] بلا
// اختلافِ بصمة، وقاعدةٌ جديدةٌ تنتهي إلى الكتالوجِ نفسِه، والرجوعُ يُعيدُ كتالوجَ 0026 بايتاً ببايت (‏ويغيبُ المفتاح)،
// وإعادةُ التقديمِ تُطابق. الأثرُ الزمنيُّ (‏نافذةٌ حقيقيّة، موتُ الجذر، الطفرات) في tests/fence/db-fence.test.mjs.
describe('WL-545 — 0027: الترقية، والرجوع، وإعادةُ التقديم', { skip: skipWithoutDatabase }, () => {
  /** @type {Awaited<ReturnType<typeof createIsolatedDatabase>>} */
  let db;
  /** @type {Awaited<ReturnType<typeof createIsolatedDatabase>> | undefined} */
  let fresh;
  /** @type {string} */
  let dir26;
  /** @type {string} */
  let dir27;
  /** @type {Awaited<ReturnType<typeof fenceFunctionCatalog>>} */
  let at26;
  /** @type {Awaited<ReturnType<typeof fenceFunctionCatalog>>} */
  let at27;
  const src = fileURLToPath(new URL('../../migrations/', import.meta.url));
  /** @param {import('pg').Pool} pool */
  const reapKeys = async (pool) =>
    Object.keys((await pool.query('SELECT fence.reap_lapsed() AS r')).rows[0].r).sort();
  before(async () => {
    db = await createIsolatedDatabase('m0027');
    dir26 = mkdtempSync(join(tmpdir(), 'xuux-mig-'));
    // WL-551: هذه الحزمةُ تقيسُ 0027 — فالتقديمُ يقفُ عندَها صراحةً (‏0028 وما بعدَها لها حزمتُها).
    dir27 = mkdtempSync(join(tmpdir(), 'xuux-mig-'));
    for (const f of readdirSync(src)) {
      if (Number(f.slice(0, 4)) > 27) continue;
      writeFileSync(join(dir27, f), readFileSync(join(src, f), 'utf8'));
      if (Number(f.slice(0, 4)) > 26) continue;
      writeFileSync(join(dir26, f), readFileSync(join(src, f), 'utf8'));
    }
  });
  after(async () => {
    if (db !== undefined) await db.drop();
    if (fresh !== undefined) await fresh.drop();
    rmSync(dir26, { recursive: true, force: true });
    rmSync(dir27, { recursive: true, force: true });
  });

  it('على 0026: لا next_due_ms (‏العيبُ: لا موعدَ يُجدوَلُ عليه)', async () => {
    assert.equal((await up(db.pool, { dir: dir26 })).current, 26);
    at26 = await fenceFunctionCatalog(db.pool);
    assert.equal((await reapKeys(db.pool)).includes('next_due_ms'), false);
  });

  it('الترقيةُ إلى 0027 تُطبِّقُ [27] بلا اختلافِ بصمة، والمفتاحُ حاضر', async () => {
    assert.deepEqual((await up(db.pool, { dir: dir27 })).applied, [27]);
    assert.equal((await reapKeys(db.pool)).includes('next_due_ms'), true);
    at27 = await fenceFunctionCatalog(db.pool);
    assert.notDeepEqual(at27, at26, '0027 غيّرت الكتالوجَ فعلاً');
  });

  it('قاعدةٌ جديدةٌ من الصفر تنتهي إلى كتالوجِ 0027 نفسِه', async () => {
    fresh = await createIsolatedDatabase('m0027f');
    await up(fresh.pool, { dir: dir27 });
    assert.deepEqual(await fenceFunctionCatalog(fresh.pool), at27);
  });

  it('رجوعُ 0027 يُعيدُ كتالوجَ 0026 بايتاً ببايت، وإعادةُ التقديمِ تُطابق', async () => {
    assert.equal((await down(db.pool, { steps: 1 })).current, 26);
    assert.deepEqual(await fenceFunctionCatalog(db.pool), at26);
    assert.equal((await reapKeys(db.pool)).includes('next_due_ms'), false);
    assert.deepEqual((await up(db.pool, { dir: dir27 })).applied, [27]);
    assert.deepEqual(await fenceFunctionCatalog(db.pool), at27);
  });
});

// ── WL-551: عضويّةُ xf_owner تمنعُ RESUME (‏0028) ──
//
// 0028 تُضيفُ fence._owner_membership_problems() وكتلةً مغلقةَ الفشلِ في check_fenced. هنا: على 0027 العضويّةُ لا تُرى
// (‏العيبُ مقيساً)، والترقيةُ تُطبِّقُ [28] فتُرى، وقاعدةٌ جديدةٌ تنتهي إلى الكتالوجِ نفسِه، والرجوعُ يُعيدُ كتالوجَ 0027
// بايتاً ببايت (‏التعريف، المالك، ACL، المُطلِقات، البيانُ ببصماتِه)، وإعادةُ التقديمِ تُطابق؛ وطفراتُ 0028 تُكشَف.
// الأثرُ الحيُّ (‏XF415، HALT، الاستيلاءُ المباشرُ متبقّياً) في tests/fence/db-fence.test.mjs.
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
    /** @type {Awaited<ReturnType<typeof fenceFunctionCatalog>>} */
    let at27;
    /** @type {Awaited<ReturnType<typeof fenceFunctionCatalog>>} */
    let at28;
    const src = fileURLToPath(new URL('../../migrations/', import.meta.url));
    const FILE = '0028_fence_owner_membership.up.sql';
    /** @param {number} upTo @param {(n: string, t: string) => string} [mutate] */
    const migrationsDir = (upTo, mutate = (_n, t) => t) => {
      const d = mkdtempSync(join(tmpdir(), 'xuux-mig-'));
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
    });
    after(async () => {
      if (db !== undefined) await db.drop();
      if (fresh !== undefined) await fresh.drop();
      rmSync(dir27, { recursive: true, force: true });
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
      assert.deepEqual((await up(db.pool)).applied, [28]);
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
      await up(fresh.pool);
      assert.deepEqual(await fenceFunctionCatalog(fresh.pool), at28);
    });

    it('رجوعُ 0028 يُعيدُ كتالوجَ 0027 بايتاً ببايت (‏والبيانَ ببصماتِه)، وإعادةُ التقديمِ تُطابق', async () => {
      assert.equal((await down(db.pool, { steps: 1 })).current, 27);
      assert.deepEqual(await fenceFunctionCatalog(db.pool), at27);
      assert.deepEqual((await up(db.pool)).applied, [28]);
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
        assert.deepEqual((await up(db.pool)).applied, [28]);
        assert.deepEqual(await probe(db.pool), [], 'النصُّ الحقيقيُّ يجتاز');
        assert.deepEqual(await fenceFunctionCatalog(db.pool), at28);
      });
    }
  },
);
