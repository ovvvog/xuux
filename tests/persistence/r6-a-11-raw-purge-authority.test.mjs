// اختبارُ ارتدادٍ للنتيجةِ `R6-A-11` (مجلسُ النماذجِ): المحوُ الخامُ بلا سلطةٍ.
//
// **العيبُ المُقاسُ بنصِّه:** `purge` و`eraseById` المُصدَّرتانِ من
// `src/persistence/retention.mjs` كانتا تُصدِرانِ `DELETE FROM "state"."memories" …`
// وتُعيدانِ `deleted: 1` على مجمّعٍ مُزيَّفٍ — بلا نداءٍ إلى نقطةِ التفويضِ على
// الفعلِ `purge-data`، وبلا سجلِّ محوٍ في دفترِ المحوِ. وإغلاقُ سطرِ الأوامرِ
// (`RETENTION_PURGE_CLI_FORBIDDEN`) وحاجزُ `scripts/guard-retention.mjs` يمنعانِ
// الوصولَ من `scripts/` وحدَها؛ أمّا الدالّتانِ نفسُهما فبقيتا مسارَ حذفٍ مفتوحاً
// لكلِّ مَن يستوردُ الوحدةَ.
//
// **وما يقيسُه هذا الملفُّ** بلا قاعدةٍ حيّةٍ (مجمّعٌ مُزيَّفٌ يسجّلُ كلَّ نصِّ SQL):
//  1. أنّ `purge` بلا `dryRun` تُرفَضُ برمزٍ مُسمّىً **ولا تُصدِرُ نصّاً واحداً**
//     إلى القاعدة — لا `DELETE` ولا حتى `BEGIN`.
//  2. أنّ `eraseById` كذلك تُرفَضُ قبلَ أيِّ اتصالٍ.
//  3. أنّ القراءةَ (`plan` و`purge({ dryRun: true })`) باقيةٌ كما هي: تعدُّ ولا تحذف.
//  4. أنّ رفوضَ التحقّقِ السابقةَ (جدولٌ غيرُ معلَنٍ، `events`) باقيةٌ برموزِها.
//
// والمسارُ المحكومُ للمحوِ هو `RetentionCycle.run` في `src/data/retention-cycle.mjs`
// عبرَ `EnforcementPoint.authorize` على `purge-data` (`R6-A-01`)، ونجاحُه مع السلطةِ
// مقيسٌ في `tests/data/retention-authorization.test.mjs`.

import assert from 'node:assert/strict';
import test from 'node:test';

import { eraseById, plan, purge, RETENTION_ERRORS } from '../../src/persistence/retention.mjs';

const NOW = new Date('2026-08-24T00:00:00.000Z');

/**
 * مجمّعٌ مُزيَّفٌ يسجّلُ كلَّ نصٍّ يصلُه، من المجمّعِ نفسِه أو من عميلٍ مأخوذٍ منه.
 * والعدُّ يُعيدُ صفّاً منتهياً واحداً، والحذفُ يُعيدُ `rowCount: 1` — أي أنّ
 * المحوَ لو وقعَ لظهرَ في التقريرِ `deleted: 1` كما قاسَه المجلس.
 */
function recordingPool() {
  /** @type {string[]} */
  const sql = [];
  let connects = 0;
  /**
   * @param {string} text
   */
  async function query(text) {
    sql.push(text);
    if (/^\s*SELECT\s+count/i.test(text)) {
      return { rows: [{ eligible: 1, legalHoldProtected: 0 }], rowCount: 1 };
    }
    if (/^\s*SELECT/i.test(text)) {
      return { rows: [{ legal_hold: false }], rowCount: 1 };
    }
    return { rows: [], rowCount: 1 };
  }
  const pool = {
    query,
    async connect() {
      connects += 1;
      return { query, release() {} };
    },
  };
  return {
    pool: /** @type {import('pg').Pool} */ (/** @type {unknown} */ (pool)),
    sql,
    get connects() {
      return connects;
    },
  };
}

/**
 * @param {string} code
 * @returns {(error: unknown) => boolean}
 */
function hasCode(code) {
  return (error) =>
    typeof error === 'object' &&
    error !== null &&
    /** @type {Record<string, unknown>} */ (error)['code'] === code;
}

test('R6-A-11: purge بلا سلطةِ purge-data تُرفَضُ ولا تُصدِرُ DELETE', async () => {
  for (const tables of [['memories'], ['data_assets'], undefined]) {
    const fake = recordingPool();
    await assert.rejects(
      () => purge(fake.pool, { now: NOW, ...(tables === undefined ? {} : { tables }) }),
      hasCode(RETENTION_ERRORS.PURGE_UNAUTHORIZED),
    );
    assert.deepEqual(
      fake.sql.filter((text) => /\bDELETE\b/i.test(text)),
      [],
      `لا DELETE بلا سلطة (tables=${JSON.stringify(tables)}).`,
    );
    assert.deepEqual(fake.sql, [], 'الرفضُ يقعُ قبلَ أيِّ نصٍّ إلى القاعدة.');
    assert.equal(fake.connects, 0, 'ولا اتصالَ يُؤخَذُ من المجمّع.');
  }
});

test('R6-A-11: eraseById بلا سلطةِ purge-data تُرفَضُ ولا تُصدِرُ DELETE', async () => {
  for (const table of ['memories', 'data_assets']) {
    const fake = recordingPool();
    await assert.rejects(
      () => eraseById(fake.pool, table, `${table}-001`),
      hasCode(RETENTION_ERRORS.PURGE_UNAUTHORIZED),
    );
    assert.deepEqual(
      fake.sql.filter((text) => /\bDELETE\b/i.test(text)),
      [],
      `لا DELETE بلا سلطة (${table}).`,
    );
    assert.deepEqual(fake.sql, [], 'الرفضُ يقعُ قبلَ أيِّ نصٍّ إلى القاعدة.');
    assert.equal(fake.connects, 0, 'ولا اتصالَ يُؤخَذُ من المجمّع.');
  }
});

test('R6-A-11: القراءةُ باقيةٌ — plan وdryRun تعدّانِ ولا تحذفان', async () => {
  const fake = recordingPool();
  const report = await plan(fake.pool, { now: NOW });
  assert.equal(report.tables.find((row) => row.table === 'state.memories')?.eligible, 1);
  const simulated = await purge(fake.pool, { now: NOW, dryRun: true });
  assert.equal(simulated.dryRun, true);
  assert.deepEqual(
    simulated.tables.map((row) => [row.table, row.eligible, row.deleted]),
    [
      ['state.data_assets', 1, 0],
      ['state.memories', 1, 0],
    ],
  );
  assert.ok(fake.sql.length > 0, 'القراءةُ وقعت فعلاً.');
  assert.deepEqual(
    fake.sql.filter((text) => !/^\s*SELECT\b/i.test(text)),
    [],
    'لا نصَّ غيرَ القراءة.',
  );
});

test('R6-A-11: رفوضُ التحقّقِ السابقةُ باقيةٌ برموزِها', async () => {
  const fake = recordingPool();
  await assert.rejects(
    () => purge(fake.pool, { now: NOW, tables: ['events'] }),
    hasCode(RETENTION_ERRORS.EVENTS_IMMUTABLE),
  );
  await assert.rejects(
    () => eraseById(fake.pool, 'events', 'event-001'),
    hasCode(RETENTION_ERRORS.EVENTS_IMMUTABLE),
  );
  await assert.rejects(
    () => purge(fake.pool, { now: NOW, tables: ['nope'] }),
    hasCode(RETENTION_ERRORS.UNKNOWN_TABLE),
  );
  await assert.rejects(
    () => purge(fake.pool, { now: new Date('x') }),
    hasCode(RETENTION_ERRORS.INVALID_NOW),
  );
  assert.deepEqual(fake.sql, []);
});
