/**
 * حفظُ البياناتِ عبرَ الهجرات — المسار `M3`، الخطوة `M3.03`.
 *
 * `migration-reversibility.test.mjs` يُبرهنُ انعكاسَ **المخطَّط** على قاعدةٍ
 * فارغة. وذلك برهانٌ ناقصٌ في أخطرِ موضع: مخطَّطٌ يعودُ سليماً وجدولٌ يعودُ
 * فارغاً يجتازُ كلَّ فحوصِه، لأنّ `catalogSnapshot` تُعلنُ صراحةً أنّها لا
 * تلتقطُ بياناتِ الجداول. فالسؤالُ «هل بقيَتِ الصفوف؟» لم يكن مطروحاً أصلاً.
 *
 * فهنا البرهانُ على قاعدةٍ **مأهولة**: تُملأُ الجداولُ بمدوَّنةٍ تمثيليةٍ
 * مستوىً بعدَ مستوىً، ثمّ تُقدَّمُ كلُّ هجرةٍ ويُتراجَعُ عنها، وتُقايَسُ الصفوفُ
 * قيمةً قيمةً لا عدداً: هجرةٌ تُبدّلُ قيمةً في كلِّ صفٍّ ثمّ لا يُرجِعُها
 * تراجعُها تُبقي العددَ كما هو تماماً.
 *
 * والمنطقُ في `src/persistence/data-preservation.mjs` ليكونَ الاختبارُ والأداةُ
 * `npm run verify:data` على مسطرةٍ واحدة.
 */

import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import { proveDataPreservation } from '../../src/persistence/data-preservation.mjs';
import { loadMigrations } from '../../src/persistence/migrator.mjs';
import { REFUSAL_SCENARIOS } from '../../src/persistence/seed-corpus.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import pg from 'pg';
import { up } from '../../src/persistence/migrator.mjs';
import { createBackup } from '../../scripts/backup.mjs';
import { restoreBackup } from '../../scripts/restore.mjs';
import { createIsolatedDatabase, databaseUrl, skipWithoutDatabase } from '../helpers/pg.mjs';

describe('حفظُ البياناتِ عبرَ الهجرات — قاعدةٌ مأهولة', { skip: skipWithoutDatabase }, () => {
  /** @type {Awaited<ReturnType<typeof createIsolatedDatabase>>} */
  let db;
  /** @type {import('../../src/persistence/data-preservation.mjs').PreservationReport} */
  let report;

  before(async () => {
    db = await createIsolatedDatabase('datapres');
    report = await proveDataPreservation(db.pool);
  });

  after(async () => {
    if (db !== undefined) await db.drop();
  });

  it('يفحصُ كلَّ هجرةٍ على القرصِ عدا الأولى — والاستثناءُ مُعلَنٌ لا مسكوت', () => {
    const onDisk = loadMigrations().length;
    assert.equal(report.total, onDisk - 1);
    assert.equal(
      report.checks.length,
      onDisk - 1,
      'توقّفَ الفحصُ قبلَ آخرِ هجرة — أوّلُ إخفاقٍ يقطعُه.',
    );
    assert.ok(
      report.limits.some((limit) => limit.includes('0001')),
      'الحدُّ المتعلّقُ بالهجرةِ الأولى غيرُ مُعلَنٍ في التقرير.',
    );
  });

  it('يجري على PostgreSQL حقيقيّ لا على بديلٍ في الذاكرة', () => {
    assert.match(report.server, /PostgreSQL \d+/);
  });

  it('القاعدةُ كانت مأهولةً فعلاً عندَ كلِّ هجرة — لا برهانَ على الفراغ', () => {
    for (const check of report.checks) {
      assert.ok(
        check.nonEmpty && check.rowsBefore > 0,
        `الهجرة ${check.version} (${check.name}) فُحِصَت على قاعدةٍ بلا صفوف، فالبرهانُ عليها لا يقولُ شيئاً.`,
      );
    }
    assert.ok(
      report.peakRows >= 50,
      `الحمولةُ القصوى ${report.peakRows} صفّاً — أقلُّ من أن تُمثِّل.`,
    );
  });

  it('كلُّ هجرةٍ: التراجعُ يُعيدُ الصفوفَ قيمةً قيمةً لا عدداً', () => {
    for (const check of report.checks) {
      assert.ok(
        check.preserved,
        `الهجرة ${check.version} (${check.name}) فقدت أو بدّلت بيانات. الفرق: ${JSON.stringify(check.diff, null, 1)}`,
      );
    }
  });

  it('كلُّ هجرةٍ: إعادةُ التقديمِ بعدَ التراجعِ تُنتجُ البياناتِ نفسَها', () => {
    for (const check of report.checks) {
      assert.ok(
        check.deterministic,
        `الهجرة ${check.version} (${check.name}): up→down→up أنتجَ بياناتٍ مغايرة.`,
      );
    }
  });

  it('كلُّ هجرةٍ: المخطَّطُ عادَ كذلك — حفظُ الصفوفِ لا يُغني عن انعكاسِ البنية', () => {
    for (const check of report.checks) {
      assert.ok(
        check.schemaReversible,
        `الهجرة ${check.version} (${check.name}): الصفوفُ محفوظةٌ والكتالوجُ لم يعُدْ كما كان.`,
      );
    }
  });

  it('الهجراتُ التي تُعلنُ الرفضَ ترفضُ برسالتِها ولا تُتلفُ صفّاً', () => {
    const probed = report.checks.filter((check) => check.refusal !== null);
    assert.equal(
      probed.length,
      REFUSAL_SCENARIOS.length,
      'موضعُ رفضٍ مُعلَنٌ في المدوَّنةِ لم يُجرَ عليه فحص.',
    );
    for (const check of probed) {
      const refusal = /** @type {NonNullable<typeof check.refusal>} */ (check.refusal);
      assert.ok(refusal.refused, `الهجرة ${check.version} قبِلت صفّاً مخالفاً وكان عليها أن ترفض.`);
      assert.ok(
        refusal.declared,
        `الهجرة ${check.version} أخفقت برسالةٍ غيرِ مُعلَنة (${refusal.message}) — عطلٌ عارضٌ لا رفضٌ محكوم.`,
      );
      assert.ok(
        refusal.atomic,
        `الهجرة ${check.version} رفضت بعدَ أن غيّرت بيانات — الرفضُ ليس ذرّياً.`,
      );
    }
  });

  it('إسقاطُ عمودٍ يُعلَنُ فقداناً مقصوداً لا يُخلَطُ بالفقدانِ العَرَضي', () => {
    const lineage = report.checks.find((check) => check.version === 7);
    assert.ok(lineage, 'الهجرة 0007 غيرُ مفحوصة.');
    assert.ok(
      lineage.droppedColumns.includes('state.data_assets.lineage'),
      `العمودُ المُسقَطُ عمداً لم يُرصَدْ: ${JSON.stringify(lineage.droppedColumns)}`,
    );
  });

  it('الحكمُ الكلّيُّ صحيحٌ ومتّسقٌ مع الأحكامِ الفردية', () => {
    assert.equal(report.passed, report.total);
    assert.ok(report.ok);
  });
});

// ‏نُقلَت حرفيّاً من `atomicity.test.mjs` (‏`WL-608`): على CI تستغرقُ حالاتُ `WL-606` الأربعُ 15–30 ث لكلٍّ منها
// (‏200 ألفِ صفّ) فتجاوزَ ذلك الملفُّ مهلةَ الملفِّ 120 ث على `#623`. لا مهلةَ رُفِعت ولا توكيدَ تغيّر؛ ووصلتا
// الإدارةِ والقاعدةِ نسختانِ من دالّتَي ذلك الملفّ.

/** وصلةُ الإدارة (‏superuser الاختبار). */
function l78AdminUrl() {
  return /** @type {string} */ (databaseUrl());
}

/** @param {string} name */
function l78Url(name) {
  const url = new URL(/** @type {string} */ (process.env.DATABASE_URL));
  url.pathname = `/${name}`;
  return url.toString();
}

// ─── ‏`WL-606`: فشلُ حسابِ البصمةِ وانقطاعُ الاتصالِ أثناءَه — في النسخِ وفي الاستعادة ───
//
// الحقن: جلسةٌ مراقِبةٌ تنتظرُ استعلامَ تجزئةِ الصفوفِ في `pg_stat_activity` للقاعدةِ المعنيّة، ثمّ
// ‏`pg_cancel_backend` (‏فشلُ حسابٍ: `57014`) أو `pg_terminate_backend` (‏انقطاعُ اتصال). الجدولُ كبيرٌ
// (‏200 ألفِ صفّ) كي يطولَ الاستعلامُ بما يكفي للمراقبة؛ **والاختبارُ يؤكّدُ أنّ الحقنَ وقع** وإلا سقط.

// ‏الجدولُ الكبيرُ وحدَه (‏`state.laws`، 200 ألفِ صفّ): استعلامُ بصمةٍ لجدولٍ صغيرٍ ينتهي بينَ قراءةِ
// `pg_stat_activity` ووصولِ الإلغاء، فيقعُ الإلغاءُ على جلسةٍ خاملةٍ ويُهمَل والنسخُ ينجح (‏سقوطٌ في CI على
// `wl-606`: «الحقنُ وقع» و`BACKUP_CREATED`). الإنهاءُ لا يتأثّرُ لأنّه يقتلُ الجلسةَ أيّاً كان استعلامُها.
const L78_DIGEST_QUERY = '%convert_to(t::text%"state"."laws" AS t%';

/**
 * @param {string} database
 * @param {'cancel' | 'terminate'} mode
 * @returns {{ done: Promise<number>, stop: () => void }} عددُ الجلساتِ المقطوعة.
 */
function l78InterruptDigest(database, mode) {
  const watcher = new pg.Pool({ connectionString: l78AdminUrl(), max: 1 });
  let stopped = false;
  const done = (async () => {
    try {
      const deadline = Date.now() + 60_000;
      while (!stopped && Date.now() < deadline) {
        const hit = await watcher.query(
          `SELECT pid, ${mode === 'cancel' ? 'pg_cancel_backend' : 'pg_terminate_backend'}(pid) AS ok
             FROM pg_stat_activity
            WHERE datname = $1 AND state = 'active' AND query LIKE $2 AND pid <> pg_backend_pid()`,
          [database, L78_DIGEST_QUERY],
        );
        if (hit.rowCount !== null && hit.rowCount > 0) return hit.rowCount;
        await new Promise((resolve) => setTimeout(resolve, 3));
      }
      return 0;
    } finally {
      await watcher.end();
    }
  })();
  return { done, stop: () => (stopped = true) };
}

/** مصدرٌ مُهاجَرٌ كبيرٌ بما يكفي لمراقبةِ استعلامِ البصمة. */
async function l78LargeSource(/** @type {string} */ label) {
  const source = await createIsolatedDatabase(label);
  await up(source.pool);
  await source.pool.query(
    `INSERT INTO state.laws (id, title, body, status, scope, proposer)
     SELECT 'law-' || lpad(g::text, 7, '0'), 'عنوان ' || g, repeat('نصّ ', 8) || g, 'draft', 'testing', 'agent-001'
       FROM generate_series(1, 200000) g`,
  );
  return source;
}

for (const mode of /** @type {const} */ (['cancel', 'terminate'])) {
  test(
    `WL-606: ${mode === 'cancel' ? 'فشلُ حسابِ' : 'انقطاعُ الاتصالِ أثناءَ حسابِ'} البصمةِ في النسخ ⇒ BACKUP_DIGEST_FAILED بلا أرشيفٍ ولا بيانٍ ولا جدولٍ مرحليّ`,
    { skip: skipWithoutDatabase, timeout: 120_000 },
    async () => {
      const source = await l78LargeSource(`l78dgb${mode.slice(0, 4)}`);
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'l78-digest-backup-'));
      const dump = path.join(dir, 'state.dump');
      try {
        const interrupt = l78InterruptDigest(source.name, mode);
        const outcome = await createBackup(dump, l78Url(source.name)).then(
          () => 'BACKUP_CREATED',
          (/** @type {any} */ error) => error,
        );
        interrupt.stop();
        assert.ok((await interrupt.done) > 0, 'الحقنُ لم يقع — الاختبارُ لا يقيس');
        assert.equal(outcome?.code, 'BACKUP_DIGEST_FAILED', String(outcome?.message ?? outcome));
        assert.equal(fs.existsSync(dump), false, 'كُتبَ أرشيفٌ رغمَ فشلِ البصمة');
        assert.equal(fs.existsSync(`${dump}.manifest.json`), false, 'كُتبَ بيانٌ رغمَ فشلِ البصمة');
        const staging = await source.pool.query(
          `SELECT count(*)::int AS n FROM pg_class c JOIN pg_namespace s ON s.oid = c.relnamespace
            WHERE s.nspname = 'state' AND c.relname LIKE '\\_\\_backup\\_%'`,
        );
        assert.equal(staging.rows[0].n, 0, 'بقيَ جدولٌ مرحليٌّ في المصدر');
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
        await source.drop();
      }
    },
  );

  test(
    `WL-606: ${mode === 'cancel' ? 'فشلُ حسابِ' : 'انقطاعُ الاتصالِ أثناءَ حسابِ'} البصمةِ بعدَ الاستعادة ⇒ RESTORE_CONTENT_CHECK_FAILED، لا RESTORE_OK والدفترُ غيرُ مُركَّب`,
    { skip: skipWithoutDatabase, timeout: 120_000 },
    async () => {
      const source = await l78LargeSource(`l78dgr${mode.slice(0, 4)}`);
      const target = await createIsolatedDatabase(`l78dgr${mode.slice(0, 4)}t`);
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'l78-digest-restore-'));
      const dump = path.join(dir, 'state.dump');
      try {
        await createBackup(dump, l78Url(source.name));
        const interrupt = l78InterruptDigest(target.name, mode);
        const outcome = await restoreBackup(
          { dumpPath: dump, database: target.name, force: false },
          l78AdminUrl(),
        ).then(
          () => 'RESTORE_OK',
          (/** @type {any} */ error) => error,
        );
        interrupt.stop();
        assert.ok((await interrupt.done) > 0, 'الحقنُ لم يقع — الاختبارُ لا يقيس');
        assert.notEqual(outcome, 'RESTORE_OK');
        assert.equal(
          outcome?.code,
          'RESTORE_CONTENT_CHECK_FAILED',
          String(outcome?.message ?? outcome),
        );
        assert.match(
          String(outcome?.message),
          mode === 'cancel' ? /57014/ : /terminat|57P01|Connection/i,
        );
        const ledger = await target.pool.query(
          `SELECT to_regclass('public.schema_migrations') IS NULL AS absent`,
        );
        assert.equal(ledger.rows[0].absent, true, 'رُكِّبَ دفترُ الهجراتِ رغمَ فشلِ التحقّق');
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
        await target.drop();
        await source.drop();
      }
    },
  );
}
