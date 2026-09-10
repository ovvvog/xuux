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
import { createIsolatedDatabase, skipWithoutDatabase } from '../helpers/pg.mjs';

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
