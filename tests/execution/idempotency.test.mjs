/**
 * اختبار عدم التكرار — الخطوة `M5.03`.
 *
 * معيار الخطوة كما في الخارطة: **مئة إرسال متزامن لنفس المفتاح ⇒ تنفيذ واحد**،
 * و**عمّال متعددون ⇒ صفر مهمة تُنفَّذ مرتين**. والاختبار هنا يُثبت الأمرين
 * بالحدّين الصعبين لا بالسهلين:
 *
 * 1. مئة نداء `enqueue` **متزامنة** (لا متتابعة) بنفس المفتاح: صفٌّ واحد فقط،
 *    و`created: true` مرّة واحدة بالضبط لا أكثر — كي لا يظنّ نداءان أنهما أنشآ.
 * 2. الحجز من **عمليات `node` منفصلة** حقيقية تتزاحم على الطابور نفسه: مجموع ما
 *    حجزوه يساوي عدد المهام بلا تكرار معرّفٍ واحد بين عاملين.
 */

import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import path from 'node:path';
import test, { after, before } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { createTaskQueue } from '../../src/execution/queue.mjs';
import { TaskLifecycle } from '../../src/execution/lifecycle.mjs';
import { up } from '../../src/persistence/migrator.mjs';
import { createIsolatedDatabase, skipWithoutDatabase } from '../helpers/pg.mjs';

const run = promisify(execFile);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const CHILD = path.join(HERE, 'helpers/claim-child.mjs');
const AUTH = { decisionId: 'decision-عدم-التكرار' };

/** @type {{ pool: import('pg').Pool, name: string, drop: () => Promise<void> } | undefined} */
let db;
/** @type {string} */
let dbUrl = '';

before(async () => {
  if (skipWithoutDatabase !== false) return;
  db = await createIsolatedDatabase('idem');
  await up(db.pool);
  const url = new URL(String(process.env.DATABASE_URL));
  url.pathname = `/${db.name}`;
  dbUrl = url.toString();
});

after(async () => {
  if (db !== undefined) await db.drop();
});

/** @returns {import('pg').Pool} */
function pool() {
  assert.ok(db !== undefined, 'قاعدة الاختبار غير مهيّأة');
  return db.pool;
}

test(
  'مئة إرسال متزامن لنفس المفتاح ⇒ مهمة واحدة وإنشاء واحد',
  {
    skip: skipWithoutDatabase,
  },
  async () => {
    const queue = createTaskQueue({ pool: pool() });
    const key = 'مفتاح-واحد-لمئة-إرسال';

    // `Promise.allSettled` لا `for await`: التزامن هو محلّ الاختبار، والتتابع
    // ينجح دائماً ولو لم يكن في القاعدة قيدُ تفرّدٍ أصلاً.
    const results = await Promise.allSettled(
      Array.from({ length: 100 }, (_, index) =>
        queue.enqueue(
          {
            action: 'اختبار.عدم-التكرار',
            target: 'موضوع/واحد',
            actorId: `actor-${index}`,
            idempotencyKey: key,
            payload: { index },
          },
          AUTH,
        ),
      ),
    );

    const fulfilled = results.filter((entry) => entry.status === 'fulfilled');
    const rejected = results.filter((entry) => entry.status === 'rejected');
    // لا يُشترط نجاح المئة كلها (تسابق الإدراج قد يُخرج تعارضاً مُعلناً برمزه)،
    // لكن **يُشترط** ألّا يكون هناك أكثر من إنشاء واحد وألّا يُخفق نداء بخطأ غير
    // معلن. فيُفحص رمز كل رفض.
    for (const entry of rejected) {
      const reason = entry.reason;
      assert.ok(reason instanceof Error);
      assert.match(
        String(/** @type {{ code?: string }} */ (reason).code ?? ''),
        /^TASK_IDEMPOTENCY_CONFLICT$/,
        `رفضٌ بخطأ غير معلن: ${reason.message}`,
      );
    }

    const createdCount = fulfilled.filter(
      (entry) => /** @type {{ value: { created: boolean } }} */ (entry).value.created,
    ).length;
    assert.equal(createdCount, 1, `أُنشئت المهمة ${createdCount} مرّة بدل مرّة واحدة`);

    // ومعرّف المهمة واحدٌ في كل الأجوبة الناجحة: من لم يُنشئ يقرأ القائم لا ينشئ ثانياً.
    const ids = new Set(
      fulfilled.map(
        (entry) => /** @type {{ value: { task: { id: string } } }} */ (entry).value.task.id,
      ),
    );
    assert.equal(ids.size, 1, 'أجوبةٌ بمعرّفات مختلفة لنفس المفتاح');

    const counts = await queue.counts();
    assert.deepEqual(counts, { [TaskLifecycle.SCHEDULED]: 1 }, 'أكثر من صفٍّ لنفس المفتاح');
  },
);

test('عمّال في عمليات منفصلة: صفر مهمة تُنفَّذ مرتين', { skip: skipWithoutDatabase }, async () => {
  const queue = createTaskQueue({ pool: pool() });
  const total = 60;

  /** @type {string[]} */
  const enqueued = [];
  for (let index = 0; index < total; index += 1) {
    const { task } = await queue.enqueue(
      {
        action: 'اختبار.تزاحم',
        target: `موضوع/${index}`,
        actorId: 'actor-التزاحم',
        idempotencyKey: `مفتاح-تزاحم-${index}`,
      },
      AUTH,
    );
    enqueued.push(task.id);
  }

  // أربع عمليات `node` حقيقية تُقلع معاً وتتزاحم على الطابور نفسه — **وخطُّ
  // بدايتها واحد**: يُسخّن كلُّ ابنٍ اتصالَه ثم ينتظر العصرَ المُمرَّر، فلا يسبق
  // أوّلُهم البقيةَ بزمنِ إقلاعِ عمليةٍ فيحجز الكلَّ وحده. صُحِّح في `WL-045`:
  // على آلةٍ مشغولةٍ كان الاختبارُ يُخفق بدعواه الصادقة «عاملٌ واحدٌ حجز الكلَّ ⇒
  // لا تزاحمَ فُحص فعلاً» — وذاك إخفاقُ ترتيبِ إقلاعٍ لا إخفاقُ ذرّيةِ حجز.
  const workers = ['عامل-أ', 'عامل-ب', 'عامل-ج', 'عامل-د'];
  const startAt = String(Date.now() + 1500);
  const outputs = await Promise.all(
    workers.map((worker) => run(process.execPath, [CHILD, dbUrl, worker, '5', startAt])),
  );

  /** @type {Map<string, string[]>} من حجز كل مهمة؛ لو حجزها اثنان ظهرت هنا. */
  const owners = new Map();
  /** @type {Map<string, string[]>} حجوزات مهام هذا الاختبار وحدها. */
  const mine = new Map();
  const expected = new Set(enqueued);
  let claimedTotal = 0;
  for (const output of outputs) {
    const line = output.stdout.trim().split('\n').at(-1) ?? '{}';
    const parsed = /** @type {{ worker: string, claimed: string[] }} */ (JSON.parse(line));
    for (const id of parsed.claimed) {
      claimedTotal += 1;
      owners.set(id, [...(owners.get(id) ?? []), parsed.worker]);
      // الأبناء يحجزون من القاعدة كلّها، وفيها مهمة الاختبار السابق الباقية
      // في الطابور. فتُفرز مهام هذا الاختبار وحدها للعدّ، ويبقى فحصُ عدم
      // التكرار شاملاً لكل ما حُجز بلا استثناء.
      if (expected.has(id)) mine.set(id, [...(mine.get(id) ?? []), parsed.worker]);
    }
  }

  const duplicated = [...owners.entries()].filter(([, list]) => list.length > 1);
  assert.deepEqual(duplicated, [], `مهامٌ حُجزت أكثر من مرّة: ${JSON.stringify(duplicated)}`);
  assert.equal(mine.size, total, 'مجموع المحجوز من مهام هذا الاختبار لا يساوي عددها');
  // ولا حجزٌ زائد عن عدد الصفوف القابلة للحجز: مهامي + ما بقي من اختبار قبله.
  assert.equal(claimedTotal, owners.size, 'حجزٌ مكرّر لمعرّف واحد');
  assert.ok(claimedTotal >= total);

  // وفي القاعدة نفسها: كل مهمة جارية بعاملٍ واحد ومحاولتها الأولى لا أكثر.
  const state = await pool().query(
    `SELECT count(*)::int AS running, max(attempts)::int AS max_attempts,
            count(DISTINCT lease_owner)::int AS owners
       FROM state.tasks WHERE id = ANY($1::uuid[])`,
    [enqueued],
  );
  const row = /** @type {Record<string, unknown>} */ (state.rows[0]);
  assert.equal(Number(row['running']), total, 'مهامٌ لم تُحجز أو أُسقطت');
  assert.equal(Number(row['max_attempts']), 1, 'مهمة حُجزت مرّتين ⇒ محاولاتها أكثر من واحدة');
  assert.ok(Number(row['owners']) > 1, 'عاملٌ واحد حجز الكلّ ⇒ لا تزاحم فُحص فعلاً');
});
