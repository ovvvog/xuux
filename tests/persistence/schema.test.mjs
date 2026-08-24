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
  // أُضيفت في الهجرة `0002` مع مواءمة المخطَّط لسجلات الدولة (`M3.05`).
  'agents.state_changed_at': 'وكيلٌ لم تتغيّر حالته بعد التسجيل لا وقت تغيير له.',
  'models.state_reason': 'لا سبب حالةٍ لنموذج لم يُنقل عن حالته الأولى.',
  'models.state_changed_at': 'نموذجٌ لم تتغيّر حالته بعد التسجيل لا وقت تغيير له.',
  'laws.state_changed_at': 'قانونٌ ما زال مشروعاً لم تتغيّر حالته بعد.',
  // أُضيفت في الهجرة `0003` مع حوكمة إصدارات السياسة وسجل القرارات (`M4.06`).
  'policy_versions.approved_by': 'نسخة مقترحة لم تُعتمد بعد؛ والقيد يمنع تنشيطها بلا معتمِد.',
  'policy_versions.approval_signature': 'لا توقيع قبل الاعتماد؛ والقيد يمنع التنشيط بلا توقيع.',
  'policy_decisions.actor_kind': 'فاعلٌ لم يُعلن فئته يُقرأ بالافتراض الأضيق لا بفئة مخترعة.',
  'policy_decisions.actor_scope': 'فاعلٌ بلا نطاق مؤسسي — كالتاج نفسه.',
  'policy_decisions.scope': 'طلبٌ لا يحمل نطاقاً غير نطاق فاعله.',
  'policy_decisions.royal_command_id': 'أكثر الأفعال دون العتبة السيادية فلا أمر ملكي لها.',
  'policy_decisions.policy_id': 'قرارُ منعٍ بالافتراض لا سياسة حاكمة له — وذلك نفسه ما يُسجَّل.',
  'policy_decisions.policy_version': 'لا نسخة سياسة حيث لا سياسة حاكمة.',
  // أُضيفت في الهجرة `0004` مع النواة التشغيلية الموزّعة (`M5`).
  'tasks.parent_id': 'مهمة جزرية لا أم لها؛ والشجرة تبدأ من جذر لا من حلقة.',
  'tasks.started_at': 'مهمة لم تُشغّل بعد لا وقت بدء لها؛ ووجوده هو دليل أن المُعالِج شُغّل فعلاً.',
  'tasks.finished_at': 'مهمة جارية أو منتظرة لم تنتهِ؛ والقيد يجعله إلزامياً في الحالات النهائية.',
  'tasks.result':
    'لا نتيجة قبل النجاح؛ وفراغُها دليلٌ على أن المهمة لم تُنفّذ لا أنّها نُفّذت فراغاً.',
  'tasks.error_code': 'لا رمز خطأ لمهمة لم تفشل؛ والقيد يجعله إلزامياً عند الفشل فلا فشل مبهم.',
  'tasks.error_message': 'لا رسالة خطأ حيث لا خطأ؛ ورمزٌ بلا رسالة يمنعه القيد.',
  'tasks.cancel_reason':
    'لا سبب إلغاء لمهمة لم يُطلب إلغاؤها؛ والقيد يجعله إلزامياً مع طلب الإلغاء.',
  'tasks.lease_owner': 'مهمة غير محجوزة لا صاحب عقد لها؛ وخلوّه بعد النهاية هو إطلاق العقد.',
  'tasks.lease_expires_at': 'لا انتهاء لعقدٍ لم يُمنح؛ والقيد يلزم وجودهما معاً أو غيابهما معاً.',
  'tasks.budget_resource': 'مهمة لا ميزانية عليها لا مورد حصّة لها؛ والقيد يمنع مبلغاً بلا مورد.',
  'tasks.budget_debited_at':
    'مهمة لم تُخصم (لا ميزانية عليها أو رُفضت) لا وقت خصم لها؛ ووجوده قيد «مرّة واحدة» على الحساب.',
  'task_transitions.from_state':
    'أول انتقال في حياة المهمة لا حالة قبله؛ كأول حدثٍ بلا سابق في السلسلة.',
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
    `INSERT INTO state.agents (id, name, role, owner, kind, status, certificate)
     VALUES ('agent-001', 'وكيل التشغيل', 'auditor', 'crown', 'service', 'active', '{}'::jsonb)`,
  );

  // حالة خارج القيم المسموحة
  await assert.rejects(
    () =>
      client.query(
        `INSERT INTO state.agents (id, name, role, owner, kind, status, certificate)
         VALUES ('agent-002', 'وكيل ثانٍ', 'auditor', 'crown', 'service', 'ghost', '{}'::jsonb)`,
      ),
    /agents_status_check|check constraint/i,
  );

  // تعليق بلا سبب
  await assert.rejects(
    () =>
      client.query(
        `INSERT INTO state.agents (id, name, role, owner, kind, status, certificate)
         VALUES ('agent-003', 'وكيل ثالث', 'auditor', 'crown', 'service', 'suspended', '{}'::jsonb)`,
      ),
    // تغيّر اسم القيد في الهجرة `0002` لأنه صار يشمل الحجْر والإلغاء لا التعليق وحده.
    /agents_punitive_has_reason/,
  );

  // معرّف لا يطابق نمط معرّفات الدولة (مجال entity_id)
  await assert.rejects(
    () =>
      client.query(
        `INSERT INTO state.agents (id, name, role, owner, kind, status, certificate)
         VALUES ('a', 'قصير', 'auditor', 'crown', 'service', 'active', '{}'::jsonb)`,
      ),
    /entity_id/,
  );

  // اسم مكرّر
  await assert.rejects(
    () =>
      client.query(
        `INSERT INTO state.agents (id, name, role, owner, kind, status, certificate)
         VALUES ('agent-004', 'وكيل التشغيل', 'auditor', 'crown', 'human', 'active', '{}'::jsonb)`,
      ),
    /agents_name_unique/,
  );

  // اعتماد نموذج بلا معتمِد
  await assert.rejects(
    () =>
      client.query(
        `INSERT INTO state.models (id, name, provider, model_version, purpose, fingerprint, status)
         VALUES ('model-001', 'نموذج الحكم', 'internal', '1.0.0', 'governance', repeat('a', 64), 'approved')`,
      ),
    /models_approval_has_approver/,
  );
});

test('نموذجان **نشطان** لغرض واحد مرفوضان في القاعدة', { skip: skipWithoutDatabase }, async () => {
  // تغيّر المعنى في الهجرة `0002`: كان القيد يمنع اعتماد نموذجين لغرض واحد،
  // وهذا خطأ في وضع الشرط — الاعتماد صفة نموذج، والنشاط هو ما لا يُثنّى. فصار
  // الفهرس الجزئي على `is_active`، ومعه قيدٌ يمنع أن يكون النشط غير معتمد.
  const client = pool();
  await client.query(
    `INSERT INTO state.models (id, name, provider, model_version, purpose, fingerprint, status, approved_by, is_active)
     VALUES ('model-approved-1', 'نموذج العمليات', 'internal', '1.0.0', 'operations', repeat('b', 64), 'approved', 'king-001', true)`,
  );
  // اعتماد ثانٍ لنفس الغرض مقبول ما لم يُفعَّل.
  await client.query(
    `INSERT INTO state.models (id, name, provider, model_version, purpose, fingerprint, status, approved_by, is_active)
     VALUES ('model-approved-2', 'نموذج العمليات البديل', 'internal', '2.0.0', 'operations', repeat('c', 64), 'approved', 'king-001', false)`,
  );
  await assert.rejects(
    () => client.query(`UPDATE state.models SET is_active = true WHERE id = 'model-approved-2'`),
    /models_one_active_per_purpose_idx/,
  );
  // ونشطٌ غير معتمد مرفوض بقيدٍ مسمّى.
  await assert.rejects(
    () =>
      client.query(
        `INSERT INTO state.models (id, name, provider, model_version, purpose, fingerprint, status, is_active)
         VALUES ('model-sandbox-1', 'نموذج معزول', 'internal', '1.0.0', 'operations', repeat('d', 64), 'sandboxed', true)`,
      ),
    /models_active_must_be_approved/,
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
    `INSERT INTO state.laws (id, title, body, scope, proposer, status, enacted_by, enacted_at)
     VALUES ('law-001', 'نظام التشغيل', 'نصّ النظام', 'operations', 'council', 'enacted', 'king-001', now())`,
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
        `INSERT INTO state.memories (id, agent_id, dataset_id, kind, content, legal_hold, expires_at)
         VALUES ('mem-001', 'agent-001', 'data-001', 'episodic', '{}'::jsonb, true, now() + interval '1 day')`,
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

test(
  'ساعة القاعدة بدقّة الميليثانية فلا يسبق تغيّرُ الحالةِ إنشاءَ الصفّ كذباً',
  { skip: skipWithoutDatabase },
  async () => {
    // عيبٌ حقيقي كان يظهر إخفاقاً **متقطّعاً** في اختبار الذرّية: `created_at`
    // من ساعة القاعدة بدقّة الميكروثانية، و`state_changed_at` من `Date` في
    // JavaScript بدقّة الميليثانية. فصفٌّ أُنشئ عند ‎.123456‎ ثم تغيّرت حالته
    // بعده يحمل ‎.123‎ فيُقرأ **أسبق** من إنشائه ويرفضه القيد.
    //
    // القياس هنا في طبقتين: افتراض العمود مقصوصٌ إلى الميليثانية في الكتالوج،
    // ثم تجربةٌ متكرّرة تكتب زمناً بدقّة JavaScript فور الإنشاء. والتكرار مقصود:
    // العيب احتمالي، والمرّة الواحدة تنجح غالباً وتُطمئن كذباً.
    const client = pool();
    const defaults = await client.query(
      `SELECT table_name, column_default
         FROM information_schema.columns
        WHERE table_schema = 'state' AND column_name = 'created_at'
          AND table_name IN ('agents', 'models', 'laws', 'memories', 'data_assets')
        ORDER BY table_name`,
    );
    assert.equal(defaults.rows.length, 5, 'الجداول الخمسة التي تُقارن أزمنتها بكود JavaScript.');
    for (const row of defaults.rows) {
      const value = String(/** @type {Record<string, unknown>} */ (row)['column_default']);
      assert.match(
        value,
        /date_trunc\('milliseconds'::text, now\(\)\)/,
        `افتراض created_at في ${String(/** @type {Record<string, unknown>} */ (row)['table_name'])} لم يُقصَّ إلى الميليثانية.`,
      );
    }

    for (let attempt = 0; attempt < 40; attempt += 1) {
      const id = `agent-precision-${attempt}`;
      await client.query(
        `INSERT INTO state.agents (id, name, role, owner, kind, status, certificate)
         VALUES ($1, $2, 'auditor', 'crown', 'service', 'active', '{}'::jsonb)`,
        [id, `وكيل دقّة ${attempt}`],
      );
      await client.query(`UPDATE state.agents SET state_changed_at = $2 WHERE id = $1`, [
        id,
        new Date(),
      ]);
      await client.query(`DELETE FROM state.agents WHERE id = $1`, [id]);
    }
  },
);
