-- الهجرة 0004 — طابور المهام الدائم ودفتر انتقالاتها (المسار M5).
--
-- قبل هذه الهجرة كانت المهمة **كائناً في Map داخل عملية واحدة**: تُنشأ وتُنفَّذ
-- وتُنسى في نفس نداء الدالة. أثرُ ذلك ليس بطئاً ولا قلّة أناقة، بل ثلاثة عيوب
-- سلطوية: (أ) موتُ العملية يمحو كل مهمة لم تنتهِ، ولا أحد يعرف أنها كانت؛
-- (ب) لا يمكن لعاملٍ ثانٍ أن يشارك في العمل لأن الطابور لا يُرى من خارج العملية؛
-- (ج) لا سجل انتقالات، فسؤال «ما جرى لهذه المهمة» يُجاب بالتخمين.
--
-- والجداول هنا تجعل الطابور **حالةً في القاعدة**: الحجز ذرّي بقفل صفّ، والعقد
-- (`lease`) ينتهي فيُستعاد عملُ من مات، وكل انتقال حالة يُكتب صفّاً لا يُمحى.
--
-- حدٌّ معلن: هذه الهجرة تُنشئ الطابور ولا تفرض التنفيذ عليه. النواة المتزامنة
-- القائمة تبقى مساراً داخل العملية للأفعال الفورية، والطابور هو مسار المهام
-- الذي يصمد؛ ومن قرأ «المهام تدوم» فليقرأها على من أدخل مهمته الطابور.

-- ── الحالات السبع لدورة حياة المهمة (M5.01) ──────────────────────────────────
-- تُصرَّح كمجال (domain) لا كقيد CHECK متفرّق: حالةٌ جديدة تُضاف في موضع واحد،
-- ولا يستطيع جدولٌ آخر أن يعرف مجموعةَ حالاتٍ مختلفة عن هذا الجدول.
CREATE DOMAIN state.task_state AS text
  CHECK (VALUE IN ('created', 'authorized', 'scheduled', 'running', 'succeeded', 'failed', 'cancelled'));

CREATE TABLE state.tasks (
  id uuid PRIMARY KEY,
  -- مفتاح عدم التكرار إلزامي لا اختياري (M5.03): مهمةٌ بلا مفتاح تعني أن إعادة
  -- الإرسال بعد انقطاع شبكة تُنتج تنفيذاً ثانياً، والفريدُ في القاعدة هو الحارس
  -- الوحيد الذي لا يُهزم بالتزامن. ومن لا مفتاح طبيعي له يولّد واحداً صريحاً.
  idempotency_key text NOT NULL CHECK (length(btrim(idempotency_key)) BETWEEN 1 AND 200),
  action text NOT NULL CHECK (length(btrim(action)) > 0),
  target text NOT NULL CHECK (length(btrim(target)) > 0),
  actor_id text NOT NULL CHECK (length(btrim(actor_id)) > 0),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(payload) = 'object'),
  -- الأب مرجعٌ إلى مهمة أخرى: عليه يقوم الإلغاء المنتشر (M5.07). و`ON DELETE`
  -- غير معلَن قصداً — المهام لا تُحذف، تُلغى؛ فحذفُ أبٍ بلا قرار احتفاظ ممنوع
  -- بالمرجع نفسه لا بالنية.
  parent_id uuid REFERENCES state.tasks (id),
  -- الجذر يُحمل صريحاً كي لا يُصعد الشجرة عند كل قراءة: الإلغاء المنتشر يستعمل
  -- الأب (صحّةً)، والقياس والتقارير تستعمل الجذر (سرعةً).
  root_id uuid NOT NULL,
  priority integer NOT NULL DEFAULT 100 CHECK (priority BETWEEN 1 AND 1000),
  state state.task_state NOT NULL DEFAULT 'created',
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts integer NOT NULL DEFAULT 3 CHECK (max_attempts BETWEEN 1 AND 100),
  -- متى تصير المهمة قابلة للحجز: التأجيل التراجعي يكتب هذا العمود لا يُنام في
  -- الذاكرة، فتأجيلٌ في عمليةٍ ماتت يبقى نافذاً.
  available_at timestamptz NOT NULL DEFAULT date_trunc('milliseconds', now()),
  timeout_ms integer NOT NULL DEFAULT 30000 CHECK (timeout_ms BETWEEN 1 AND 3600000),
  memory_limit_mb integer NOT NULL DEFAULT 256 CHECK (memory_limit_mb BETWEEN 16 AND 8192),
  -- الميزانية: مورد الحصّة الذي يُخصم منه قبل التشغيل (M5.06). القيمة اسمُ مورد
  -- في `config/quotas.yaml`؛ ومهمة بلا مورد معلَن لا ميزانية لها وذلك مُعلن.
  budget_resource text CHECK (budget_resource IS NULL OR length(btrim(budget_resource)) > 0),
  budget_amount numeric(20, 4) NOT NULL DEFAULT 0 CHECK (budget_amount >= 0),
  -- وقت خصم الميزانية من دفتر الحصص. فراغٌ مُعلن: المهمة التي لا ميزانية عليها لا
  -- تُخصم أصلاً، والتي عليها ميزانية تُخصم مرّة واحدة فقط. وهذا العمود هو قيد
  -- «مرّة واحدة»: إعادة المحاولة بعد فشلٍ لا تُحاسَب ثانياً على نفس المهمة.
  budget_debited_at timestamptz,
  -- العقد: من يملك التنفيذ الآن ومتى ينتهي حقّه. انتهاؤه هو ما يجعل قتلَ العامل
  -- استعادةً لا فقداناً — لا نبضة قلبٍ في ذاكرة عملية أخرى.
  lease_owner text CHECK (lease_owner IS NULL OR length(btrim(lease_owner)) > 0),
  lease_expires_at timestamptz,
  cancel_requested boolean NOT NULL DEFAULT false,
  cancel_reason text CHECK (cancel_reason IS NULL OR length(btrim(cancel_reason)) > 0),
  result jsonb CHECK (result IS NULL OR jsonb_typeof(result) = 'object'),
  error_code text CHECK (error_code IS NULL OR length(btrim(error_code)) > 0),
  error_message text CHECK (error_message IS NULL OR length(btrim(error_message)) > 0),
  created_at timestamptz NOT NULL DEFAULT date_trunc('milliseconds', now()),
  state_changed_at timestamptz NOT NULL DEFAULT date_trunc('milliseconds', now()),
  started_at timestamptz,
  finished_at timestamptz,

  CONSTRAINT tasks_idempotency_key_unique UNIQUE (idempotency_key),
  -- «قيد الجري»: مهمةٌ جارية بلا عقدٍ ولا مالك تعني مهمةً لا يُعرف من ينفّذها،
  -- وهي بالضبط الحالة التي تُنفَّذ مرتين. تُمنع في القاعدة لا في العامل.
  CONSTRAINT tasks_running_needs_lease CHECK (
    state <> 'running' OR (lease_owner IS NOT NULL AND lease_expires_at IS NOT NULL AND started_at IS NOT NULL)
  ),
  -- الحالات النهائية تلزمها لحظة انتهاء: بلا ذلك يصير حساب الزمن والسعة تخميناً.
  CONSTRAINT tasks_terminal_needs_finish CHECK (
    state NOT IN ('succeeded', 'failed', 'cancelled') OR finished_at IS NOT NULL
  ),
  -- فشلٌ بلا رمز خطأ يُقرأ لاحقاً «فشل لسبب ما»، وهذا ليس محاسبة.
  CONSTRAINT tasks_failed_needs_code CHECK (state <> 'failed' OR error_code IS NOT NULL),
  CONSTRAINT tasks_cancelled_needs_reason CHECK (state <> 'cancelled' OR cancel_reason IS NOT NULL),
  -- ميزانيةٌ بمقدار موجب بلا مورد معلَن خصمٌ من العدم.
  CONSTRAINT tasks_budget_amount_needs_resource CHECK (
    budget_amount = 0 OR budget_resource IS NOT NULL
  ),
  CONSTRAINT tasks_no_self_parent CHECK (parent_id IS NULL OR parent_id <> id),
  CONSTRAINT tasks_finish_after_start CHECK (
    finished_at IS NULL OR started_at IS NULL OR finished_at >= started_at
  )
);

-- فهرس الحجز: العامل يسأل «أعلى أولوية، حان وقتها، غير محجوزة» — وهذا الفهرس
-- الجزئي يجعل السؤال قراءةَ رأس الطابور لا مسحاً لكل المهام المنتهية.
CREATE INDEX tasks_claimable_idx
  ON state.tasks (priority, available_at, created_at)
  WHERE state = 'scheduled';

-- فهرس العقود المنتهية: مُستعيد العمل (`reap`) يبحث في الجارية وحدها.
CREATE INDEX tasks_expired_lease_idx
  ON state.tasks (lease_expires_at)
  WHERE state = 'running';

-- المفتاح الأجنبي مفهرس صراحةً: بلا فهرس يصير الإلغاء المنتشر مسحاً كاملاً لكل
-- طبقة في الشجرة (وحرسُ المخطَّط يفرض ذلك على كل مفتاح أجنبي).
CREATE INDEX tasks_parent_id_idx ON state.tasks (parent_id);
CREATE INDEX tasks_root_id_idx ON state.tasks (root_id);

-- ── دفتر الانتقالات: المحاسبة لا التصحيح ────────────────────────────────────
-- لا يُقاس التقدّم بحالة المهمة الأخيرة وحدها: مهمةٌ نجحت من المحاولة الثالثة
-- بعد تأجيلين تختلف عن مهمة نجحت من الأولى، والحالة النهائية واحدة فيهما.
CREATE TABLE state.task_transitions (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  task_id uuid NOT NULL REFERENCES state.tasks (id),
  from_state state.task_state,
  to_state state.task_state NOT NULL,
  reason text NOT NULL CHECK (length(btrim(reason)) > 0),
  actor text NOT NULL CHECK (length(btrim(actor)) > 0),
  attempt integer NOT NULL CHECK (attempt >= 0),
  at timestamptz NOT NULL DEFAULT date_trunc('milliseconds', now()),
  -- انتقالٌ من حالة إلى نفسها ليس انتقالاً؛ وقبولُه يُفسد كل قياس على الدفتر.
  CONSTRAINT task_transitions_moves CHECK (from_state IS NULL OR from_state <> to_state)
);

CREATE INDEX task_transitions_task_id_idx ON state.task_transitions (task_id, id);

-- ── طابور الرسائل الميتة ─────────────────────────────────────────────────────
-- مهمةٌ استنفدت محاولاتها لا تُحذف ولا تُعاد إلى الطابور بلا قرار: تُنقل هنا
-- بحمولتها كاملة كي يُعاد إرسالها بقرار معلَن بعد إصلاح سببها.
CREATE TABLE state.task_dead_letters (
  task_id uuid PRIMARY KEY REFERENCES state.tasks (id),
  action text NOT NULL CHECK (length(btrim(action)) > 0),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  attempts integer NOT NULL CHECK (attempts >= 0),
  error_code text NOT NULL CHECK (length(btrim(error_code)) > 0),
  error_message text NOT NULL CHECK (length(btrim(error_message)) > 0),
  moved_at timestamptz NOT NULL DEFAULT date_trunc('milliseconds', now())
);
