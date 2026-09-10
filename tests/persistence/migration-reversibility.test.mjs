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
import { after, before, describe, it } from 'node:test';

import { proveReversibility } from '../../src/persistence/reversibility.mjs';
import { loadMigrations } from '../../src/persistence/migrator.mjs';
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
