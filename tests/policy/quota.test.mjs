/**
 * أدلة دفتر الحصص الذرّي — الخطوة `M4.07`.
 *
 * لا تختبر هذه الأدلة عدّاداً في الذاكرة: كل حالة تهاجر قاعدة PostgreSQL معزولة
 * ثم تقرأ صف `state.quotas` نفسه. كان العيب قبل هذه الخطوة أن `maxAgents` وحده
 * يعدّ صفوف الوكلاء؛ لم يوجد خصم دائم للذاكرة أو البيانات الخارجة أو الميزانية،
 * ولم يوجد قيد قاعدة يثبت أن الطلبات المتزامنة لا تتخطى الحد.
 */

import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import { loadPolicyBundle } from '../../src/policy/loader.mjs';
import { createQuotaLedger, QUOTA_ERRORS } from '../../src/policy/quota.mjs';
import { up } from '../../src/persistence/migrator.mjs';
import { createIsolatedDatabase, skipWithoutDatabase } from '../helpers/pg.mjs';

/** @type {{ pool: import('pg').Pool, drop: () => Promise<void> } | null} */
let db = null;
let clock = new Date('2026-08-24T00:00:00.000Z');

const definitions = loadPolicyBundle().quotas;
const ledger = () =>
  createQuotaLedger({
    pool: pool(),
    definitions,
    // تنسخ الساعة كي لا يعدّل المستدعي كائن التاريخ المشترك بعد بدء الخصم،
    // فيختبر نافذة غير التي سلّمها للدفتر فعلاً.
    now: () => new Date(clock),
  });

before(async () => {
  if (skipWithoutDatabase !== false) return;
  const created = await createIsolatedDatabase('quota');
  db = created;
  await up(created.pool);
});

after(async () => {
  if (db !== null) await db.drop();
});

/**
 * @returns {import('pg').Pool}
 */
function pool() {
  if (db === null) throw new Error('لا قاعدة — كان يجب أن يُتخطّى الاختبار.');
  return db.pool;
}

/**
 * @param {unknown} error
 * @param {string} code
 * @returns {boolean}
 */
function hasQuotaCode(error, code) {
  return (
    typeof error === 'object' &&
    error !== null &&
    /** @type {Record<string, unknown>} */ (error)['code'] === code
  );
}

test(
  'وكيل يخصم حتى حدّه ثم يُوقَف فوراً ويبقى الاستهلاك المسجّل عند الحد',
  { skip: skipWithoutDatabase },
  async () => {
    clock = new Date('2026-08-24T00:00:00.000Z');
    const subject = {
      subjectType: 'agent',
      subjectId: 'agent-quota-limit-001',
      resource: 'agent-creations',
    };
    const quota = ledger();

    const first = await quota.debit({ ...subject, amount: 20 });
    const atLimit = await quota.debit({ ...subject, amount: 5 });
    assert.deepEqual(first, {
      resource: 'agent-creations',
      consumed: 20,
      limit: 25,
      remaining: 5,
    });
    assert.deepEqual(atLimit, {
      resource: 'agent-creations',
      consumed: 25,
      limit: 25,
      remaining: 0,
    });
    await assert.rejects(
      () => quota.debit({ ...subject, amount: 1 }),
      (error) => hasQuotaCode(error, QUOTA_ERRORS.EXCEEDED),
    );

    const recorded = await quota.read(subject);
    assert.deepEqual(recorded, atLimit, 'رفض التجاوز لا يمحو آخر خصم جائز ولا يسجّل خصماً جزئياً.');
  },
);

test(
  'ثلاثون خصماً متوازياً لا تتجاوز الحصّة: ينجح خمسة وعشرون بالضبط',
  { skip: skipWithoutDatabase },
  async () => {
    clock = new Date('2026-08-24T01:00:00.000Z');
    const subject = {
      subjectType: 'agent',
      subjectId: 'agent-quota-concurrent-001',
      resource: 'agent-creations',
    };
    const quota = ledger();
    const outcomes = await Promise.all(
      Array.from({ length: 30 }, async () => {
        try {
          await quota.debit({ ...subject, amount: 1 });
          return 'success';
        } catch (error) {
          if (hasQuotaCode(error, QUOTA_ERRORS.EXCEEDED)) return 'exceeded';
          throw error;
        }
      }),
    );
    const successes = outcomes.filter((outcome) => outcome === 'success').length;
    const rejections = outcomes.filter((outcome) => outcome === 'exceeded').length;
    const recorded = await quota.read(subject);

    assert.equal(successes, 25, 'عدد النجاحات يجب أن يساوي الحدّ لا أن يقترب منه.');
    assert.equal(rejections, 5, 'كل طلب زائد يجب أن يترجم إلى رفض حصّة مسمّى.');
    assert.deepEqual(recorded, {
      resource: 'agent-creations',
      consumed: 25,
      limit: 25,
      remaining: 0,
    });
  },
);

test(
  'تدوير نافذة الكتابة المنتهية يعيد السماح ويبدأ الاستهلاك من الخصم الجديد',
  { skip: skipWithoutDatabase },
  async () => {
    clock = new Date('2026-08-24T02:00:00.000Z');
    const subject = {
      subjectType: 'agent',
      subjectId: 'agent-quota-window-001',
      resource: 'memory-writes',
    };
    const quota = ledger();

    await quota.debit({ ...subject, amount: 5000 });
    await assert.rejects(
      () => quota.debit({ ...subject, amount: 1 }),
      (error) => hasQuotaCode(error, QUOTA_ERRORS.EXCEEDED),
    );
    clock = new Date('2026-08-24T03:00:01.000Z');

    const rotated = await quota.debit({ ...subject, amount: 1 });
    assert.deepEqual(rotated, {
      resource: 'memory-writes',
      consumed: 1,
      limit: 5000,
      remaining: 4999,
    });
  },
);

test(
  'مورد غير معلَن في البيانات يُرفض برمز مسمّى ولا ينشئ صفاً',
  { skip: skipWithoutDatabase },
  async () => {
    clock = new Date('2026-08-24T04:00:00.000Z');
    const quota = ledger();
    const subject = {
      subjectType: 'agent',
      subjectId: 'agent-quota-undeclared-001',
      resource: 'hidden-resource',
    };

    await assert.rejects(
      () => quota.debit({ ...subject, amount: 1 }),
      (error) => hasQuotaCode(error, QUOTA_ERRORS.RESOURCE_UNDECLARED),
    );
    await assert.rejects(
      () => quota.read(subject),
      (error) => hasQuotaCode(error, QUOTA_ERRORS.RESOURCE_UNDECLARED),
    );
    const rows = await pool().query(
      'SELECT count(*)::int AS count FROM state.quotas WHERE subject_id = $1 AND resource = $2',
      [subject.subjectId, subject.resource],
    );
    assert.equal(Number(rows.rows[0]?.count ?? -1), 0);
  },
);
