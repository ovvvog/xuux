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
      const d = mkdtempSync(join(tmpdir(), 'xuux-mig-'));
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
      const d = mkdtempSync(join(tmpdir(), 'xuux-mig-'));
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
      const d = mkdtempSync(join(tmpdir(), 'xuux-mig-'));
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
      const d = mkdtempSync(join(tmpdir(), 'xuux-mig-'));
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
