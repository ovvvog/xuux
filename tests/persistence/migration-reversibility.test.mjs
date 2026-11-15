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
    });
    after(async () => {
      if (db !== undefined) await db.drop();
      if (fresh !== undefined) await fresh.drop();
      rmSync(dir24, { recursive: true, force: true });
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
      const out = await up(db.pool);
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
      await up(fresh.pool);
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
      const out = await up(db.pool);
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
      await assert.rejects(up(db.pool), /البيانُ لا يطابقُ 1 دالّة/);
      assert.deepEqual(await fenceFunctionCatalog(db.pool), tampered);
      await alter('ALTER FUNCTION fence.renew_lease(name) RESET work_mem');
      assert.deepEqual(await fenceFunctionCatalog(db.pool), at24);
      await up(db.pool);
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
        await up(db.pool);
        assert.deepEqual(await fenceFunctionCatalog(db.pool), at25);
      });
    }
  },
);
