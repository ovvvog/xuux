/**
 * اختبارات المخطَّط الأول — الخطوة `M3.02`.
 *
 * معيار القبول: «صفر عمود بلا قيد ضروري». والقياس هنا من **كتالوج القاعدة** لا
 * من قراءة ملف SQL: كل عمود إما `NOT NULL`، أو له افتراض، أو مُعلن في قائمة
 * الفراغ المصرَّح بها أدناه **ومشروح سببه في `docs/PERSISTENCE.md`** — وحرسٌ في
 * آخر الملف يُفشل البوابة إن أُضيف عمود فارغ بلا إعلان أو إعلانٌ بلا شرح.
 *
 * ومعها إثباتٌ أن القيود تعمل فعلاً: كل قيد مذكور يُجرَّب بإدخالٍ يخالفه.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test, { after, before } from 'node:test';
import { fileURLToPath } from 'node:url';
import { up } from '../../src/persistence/migrator.mjs';
import { createIsolatedDatabase, skipWithoutDatabase } from '../helpers/pg.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/**
 * الأعمدة التي يُسمح بفراغها، ولكلٍّ سببٌ مكتوب في `docs/PERSISTENCE.md`.
 * @type {Readonly<Record<string, string>>}
 */
const DECLARED_NULLABLE = Object.freeze({
  'agents.suspended_reason': 'لا سبب لوكيل غير معلَّق؛ والقيد يجعله إلزامياً عند التعليق.',
  'models.approved_by': 'لا معتمِد قبل الاعتماد؛ والقيد يجعله إلزامياً عند الاعتماد.',
  'events.prev_hash': 'أول حدث في السلسلة لا سابق له.',
  'commands.settled_at': 'الأمر المحجوز لم يُحسم بعد.',
  'commands.settle_reason': 'لا سبب حسمٍ قبل الحسم.',
  'laws.enacted_by': 'مشروع القانون لا سلطة نفاذ له بعد.',
  'laws.enacted_at': 'مشروع القانون لا تاريخ نفاذ له بعد.',
  'laws.repealed_at': 'القانون النافذ غير ملغى.',
  'cases.heard_at': 'القضية المفتوحة لم تُسمع بعد.',
  'cases.verdict': 'لا حكم قبل السماع.',
  'cases.closed_at': 'القضية الجارية غير مغلقة.',
  'policies.law_id': 'سياسة تشغيلية قد لا تستند إلى نصٍّ قانوني بعينه.',
  'policies.approved_by': 'لا معتمِد قبل الاعتماد؛ والقيد يمنع تفعيلها بلا اعتماد.',
  'memories.expires_at': 'ذاكرة بلا انتهاء صريح تخضع لسياسة الاحتفاظ في M3.08.',
});

/** @type {{ pool: import('pg').Pool, drop: () => Promise<void> } | null} */
let db = null;

before(async () => {
  if (skipWithoutDatabase !== false) return;
  const created = await createIsolatedDatabase('schema');
  db = created;
  await up(created.pool);
});

after(async () => {
  if (db !== null) await db.drop();
});

/** @returns {import('pg').Pool} */
function pool() {
  if (db === null) throw new Error('لا قاعدة — كان يجب أن يُتخطّى الاختبار.');
  return db.pool;
}

test(
  'كل عمود مقيَّد: NOT NULL أو افتراض أو فراغ مُعلن',
  { skip: skipWithoutDatabase },
  async () => {
    const result = await pool().query(
      `SELECT table_name, column_name, is_nullable, column_default
     FROM information_schema.columns
     WHERE table_schema = 'state'
     ORDER BY table_name, column_name`,
    );
    /** @type {string[]} */
    const undeclared = [];
    for (const row of result.rows) {
      const record = /** @type {Record<string, unknown>} */ (row);
      const key = `${String(record['table_name'])}.${String(record['column_name'])}`;
      const nullable = record['is_nullable'] === 'YES';
      const hasDefault = record['column_default'] !== null;
      if (nullable && !hasDefault && !Object.hasOwn(DECLARED_NULLABLE, key)) undeclared.push(key);
    }
    assert.deepEqual(undeclared, [], `أعمدة تقبل الفراغ بلا إعلان:\n${undeclared.join('\n')}`);
  },
);

test('كل جدول له مفتاح أوّلي', { skip: skipWithoutDatabase }, async () => {
  const result = await pool().query(
    `SELECT c.relname AS rel,
            count(*) FILTER (WHERE con.contype = 'p') AS pk
     FROM pg_class c
     JOIN pg_namespace n ON n.oid = c.relnamespace
     LEFT JOIN pg_constraint con ON con.conrelid = c.oid
     WHERE n.nspname = 'state' AND c.relkind = 'r'
     GROUP BY c.relname ORDER BY c.relname`,
  );
  const without = result.rows
    .map((row) => /** @type {Record<string, unknown>} */ (row))
    .filter((row) => Number(row['pk']) === 0)
    .map((row) => String(row['rel']));
  assert.deepEqual(without, [], 'جداول بلا مفتاح أوّلي');
});

test('كل مفتاح خارجي مفهرس', { skip: skipWithoutDatabase }, async () => {
  // مفتاح خارجي بلا فهرس يجعل كل حذف من الجدول الأب مسحاً كاملاً للابن.
  const result = await pool().query(
    `SELECT con.conname, con.conrelid::regclass::text AS rel, att.attname AS col
     FROM pg_constraint con
     JOIN unnest(con.conkey) AS k(attnum) ON true
     JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = k.attnum
     WHERE con.contype = 'f' AND con.connamespace::regnamespace::text = 'state'`,
  );
  const indexes = await pool().query(
    `SELECT tablename, indexdef FROM pg_indexes WHERE schemaname = 'state'`,
  );
  /** @type {string[]} */
  const unindexed = [];
  for (const row of result.rows) {
    const record = /** @type {Record<string, unknown>} */ (row);
    const table = String(record['rel']).replace('state.', '');
    const column = String(record['col']);
    const covered = indexes.rows.some((indexRow) => {
      const index = /** @type {Record<string, unknown>} */ (indexRow);
      return (
        String(index['tablename']) === table && String(index['indexdef']).includes(`(${column}`)
      );
    });
    if (!covered) unindexed.push(`${table}.${column}`);
  }
  assert.deepEqual(unindexed, [], 'مفاتيح خارجية بلا فهرس');
});

test('قيود الحالة والسبب والاعتماد ترفض ما يخالفها', { skip: skipWithoutDatabase }, async () => {
  const client = pool();
  await client.query(
    `INSERT INTO state.agents (id, name, kind, status) VALUES ('agent-001', 'وكيل التشغيل', 'service', 'active')`,
  );

  // حالة خارج القيم المسموحة
  await assert.rejects(
    () =>
      client.query(
        `INSERT INTO state.agents (id, name, kind, status) VALUES ('agent-002', 'وكيل ثانٍ', 'service', 'ghost')`,
      ),
    /agents_status_check|check constraint/i,
  );

  // تعليق بلا سبب
  await assert.rejects(
    () =>
      client.query(
        `INSERT INTO state.agents (id, name, kind, status) VALUES ('agent-003', 'وكيل ثالث', 'service', 'suspended')`,
      ),
    /agents_suspension_has_reason/,
  );

  // معرّف لا يطابق نمط معرّفات الدولة (مجال entity_id)
  await assert.rejects(
    () =>
      client.query(
        `INSERT INTO state.agents (id, name, kind, status) VALUES ('a', 'قصير', 'service', 'active')`,
      ),
    /entity_id/,
  );

  // اسم مكرّر
  await assert.rejects(
    () =>
      client.query(
        `INSERT INTO state.agents (id, name, kind, status) VALUES ('agent-004', 'وكيل التشغيل', 'human', 'active')`,
      ),
    /agents_name_unique/,
  );

  // اعتماد نموذج بلا معتمِد
  await assert.rejects(
    () =>
      client.query(
        `INSERT INTO state.models (id, name, provider, purpose, fingerprint, status)
         VALUES ('model-001', 'نموذج الحكم', 'internal', 'governance', repeat('a', 64), 'approved')`,
      ),
    /models_approval_has_approver/,
  );
});

test('نموذجان معتمدان لغرض واحد مرفوضان في القاعدة', { skip: skipWithoutDatabase }, async () => {
  const client = pool();
  await client.query(
    `INSERT INTO state.models (id, name, provider, purpose, fingerprint, status, approved_by)
     VALUES ('model-approved-1', 'نموذج العمليات', 'internal', 'operations', repeat('b', 64), 'approved', 'king-001')`,
  );
  await assert.rejects(
    () =>
      client.query(
        `INSERT INTO state.models (id, name, provider, purpose, fingerprint, status, approved_by)
         VALUES ('model-approved-2', 'نموذج العمليات البديل', 'internal', 'operations', repeat('c', 64), 'approved', 'king-001')`,
      ),
    /models_one_approved_per_purpose_idx/,
  );
});

test('الحصة لا تتجاوز حدّها، والحكم لا يسبق السماع', { skip: skipWithoutDatabase }, async () => {
  const client = pool();
  await assert.rejects(
    () =>
      client.query(
        `INSERT INTO state.quotas (id, subject_type, subject_id, resource, limit_value, window_seconds, consumed)
         VALUES ('quota-001', 'agent', 'agent-001', 'inference-tokens', 100, 60, 101)`,
      ),
    /quotas_consumed_within_limit/,
  );

  await client.query(
    `INSERT INTO state.laws (id, title, body, status, enacted_by, enacted_at)
     VALUES ('law-001', 'نظام التشغيل', 'نصّ النظام', 'enacted', 'king-001', now())`,
  );
  await assert.rejects(
    () =>
      client.query(
        `INSERT INTO state.cases (id, law_id, subject, state, verdict)
         VALUES ('case-001', 'law-001', 'agent-001', 'judged', 'guilty')`,
      ),
    /cases_judgment_needs_hearing/,
  );
});

test('ذاكرة محفوظة قانوناً لا تحمل تاريخ انتهاء', { skip: skipWithoutDatabase }, async () => {
  const client = pool();
  await assert.rejects(
    () =>
      client.query(
        `INSERT INTO state.memories (id, agent_id, kind, content, legal_hold, expires_at)
         VALUES ('mem-001', 'agent-001', 'episodic', '{}'::jsonb, true, now() + interval '1 day')`,
      ),
    /memories_hold_has_no_expiry/,
  );
});

test('كل عمود فراغه مُعلن مشروحٌ سببه في وثيقة الاستمرارية', () => {
  // حرس صدق وثائق مثل حرس `M2.10`: إعلانٌ بلا شرح يصير مبرِّراً صامتاً.
  const doc = fs.readFileSync(path.join(ROOT, 'docs/PERSISTENCE.md'), 'utf8');
  const missing = Object.keys(DECLARED_NULLABLE).filter((key) => !doc.includes(key));
  assert.deepEqual(
    missing,
    [],
    `أعمدة مُعلنة بلا شرح في docs/PERSISTENCE.md:\n${missing.join('\n')}`,
  );
});
