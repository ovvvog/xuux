-- الهجرة 0001 — المخطَّط الأول لطبقة الاستمرارية (الخطوة M3.02)
--
-- قاعدة هذا المخطَّط: كل عمود إما مقيَّد (NOT NULL أو CHECK أو مفتاح أو مرجع) أو
-- مُعلَن في `docs/PERSISTENCE.md §مراجعة المخطَّط` مع سبب سماحه بالفراغ. واختبار
-- `tests/persistence/schema.test.mjs` يقرأ الكتالوج ويُفشل البوابة عند عمود بلا
-- قيد ولا إعلان — فالمعيار مقيس لا موصوف.
--
-- الجداول العشرة كلها في مخطَّط `state` وحده، فلا تختلط ببنية أدوات أخرى، ويصير
-- التراجع دقيقاً: لا شيء من هذه الهجرة يعيش خارج المخطَّط إلا صفُّها في
-- `public.schema_migrations` الذي يملكه المُهاجر ويحذفه بنفسه.

CREATE SCHEMA state;

-- ── أنماط مشتركة ───────────────────────────────────────────────────────────────
-- المعرّفات نصوص لا UUID مولَّدة في القاعدة: معرّفات الدولة تُصدرها بوابة التاج
-- وتُوقَّع قبل أن تصل هنا، فتوليدها في القاعدة يخلق مصدر حقيقة ثانياً.
CREATE DOMAIN state.entity_id AS text CHECK (VALUE ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$');

-- رقم النسخة يخدم القفل المتفائل في المستودعات: كل تحديث يرفعه بواحد، ومن كتب
-- على نسخة قديمة يُرفض بـ`VERSION_CONFLICT` بدل أن يمحو كتابة غيره صامتاً.
CREATE DOMAIN state.version_number AS integer CHECK (VALUE >= 1);

-- ── 1. الوكلاء ────────────────────────────────────────────────────────────────
CREATE TABLE state.agents (
  id state.entity_id PRIMARY KEY,
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 200),
  kind text NOT NULL CHECK (kind IN ('human', 'service', 'autonomous')),
  status text NOT NULL CHECK (status IN ('registered', 'active', 'suspended', 'quarantined', 'retired')),
  capabilities text[] NOT NULL DEFAULT '{}' CHECK (array_position(capabilities, NULL) IS NULL),
  version state.version_number NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  suspended_reason text CHECK (suspended_reason IS NULL OR length(btrim(suspended_reason)) > 0),
  CONSTRAINT agents_name_unique UNIQUE (name),
  -- سببُ التعليق إلزامي عند التعليق أو الحجْر: قرارٌ عقابي بلا سبب مسجَّل لا يُراجع.
  CONSTRAINT agents_suspension_has_reason CHECK (
    (status IN ('suspended', 'quarantined')) = (suspended_reason IS NOT NULL)
  ),
  CONSTRAINT agents_updated_not_before_created CHECK (updated_at >= created_at)
);

CREATE INDEX agents_status_idx ON state.agents (status);
CREATE INDEX agents_kind_status_idx ON state.agents (kind, status);

-- ── 2. النماذج ────────────────────────────────────────────────────────────────
CREATE TABLE state.models (
  id state.entity_id PRIMARY KEY,
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 200),
  provider text NOT NULL CHECK (length(btrim(provider)) > 0),
  purpose text NOT NULL CHECK (purpose IN ('governance', 'operations', 'research', 'education', 'safety', 'registry')),
  fingerprint text NOT NULL CHECK (fingerprint ~ '^[0-9a-f]{64}$'),
  status text NOT NULL CHECK (status IN ('registered', 'evaluated', 'approved', 'suspended', 'retired')),
  approved_by state.entity_id,
  version state.version_number NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT models_fingerprint_unique UNIQUE (fingerprint),
  -- البصمة هوية النموذج: نموذجان بنفس البصمة نموذج واحد أُدخل مرتين.
  CONSTRAINT models_name_provider_unique UNIQUE (name, provider),
  -- الاعتماد لا يُعلن بلا معتمِد: هذا هو حرس البوابة داخل القاعدة لا في الكود وحده.
  CONSTRAINT models_approval_has_approver CHECK ((status = 'approved') <= (approved_by IS NOT NULL)),
  CONSTRAINT models_updated_not_before_created CHECK (updated_at >= created_at)
);

CREATE INDEX models_purpose_status_idx ON state.models (purpose, status);
-- نموذج نشط واحد لكل غرض — قيدُ الفراغ الجزئي يمنع `D3` (مؤشّر نشاط مزدوج) في القاعدة.
CREATE UNIQUE INDEX models_one_approved_per_purpose_idx
  ON state.models (purpose)
  WHERE status = 'approved';

-- ── 3. الأحداث ────────────────────────────────────────────────────────────────
-- سجل الأحداث الدائم على القرص (`M2.05`) يبقى مصدر الحقيقة لجذر الثقة؛ وهذا
-- الجدول مرآته القابلة للاستعلام، ومنه تُبنى القراءات لا التوقيعات.
CREATE TABLE state.events (
  seq bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  event_id state.entity_id NOT NULL,
  type text NOT NULL CHECK (type ~ '^[a-z][a-z0-9]*(\.[a-z][a-z0-9_]*)+$'),
  actor state.entity_id NOT NULL,
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  hash text NOT NULL CHECK (hash ~ '^[0-9a-f]{64}$'),
  prev_hash text CHECK (prev_hash ~ '^[0-9a-f]{64}$'),
  occurred_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT events_event_id_unique UNIQUE (event_id),
  CONSTRAINT events_hash_unique UNIQUE (hash),
  CONSTRAINT events_prev_hash_unique UNIQUE (prev_hash),
  CONSTRAINT events_hash_not_prev CHECK (prev_hash IS NULL OR prev_hash <> hash),
  CONSTRAINT events_recorded_not_before_occurred CHECK (recorded_at >= occurred_at)
);

CREATE INDEX events_type_occurred_idx ON state.events (type, occurred_at DESC);
CREATE INDEX events_actor_idx ON state.events (actor);

-- ── 4. الأوامر ────────────────────────────────────────────────────────────────
CREATE TABLE state.commands (
  id state.entity_id PRIMARY KEY,
  nonce text NOT NULL CHECK (length(nonce) BETWEEN 8 AND 256),
  issued_by state.entity_id NOT NULL,
  kind text NOT NULL CHECK (length(btrim(kind)) > 0),
  state text NOT NULL CHECK (state IN ('claimed', 'committed', 'aborted', 'indeterminate')),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  settled_at timestamptz,
  settle_reason text CHECK (settle_reason IS NULL OR length(btrim(settle_reason)) > 0),
  -- المعرّف الفريد هو منع إعادة الإرسال داخل القاعدة، مطابقاً لدفتر `M2.07`.
  CONSTRAINT commands_nonce_unique UNIQUE (nonce),
  CONSTRAINT commands_settled_iff_terminal CHECK (
    (state IN ('committed', 'aborted')) = (settled_at IS NOT NULL)
  ),
  CONSTRAINT commands_settled_not_before_created CHECK (settled_at IS NULL OR settled_at >= created_at)
);

CREATE INDEX commands_state_created_idx ON state.commands (state, created_at DESC);
CREATE INDEX commands_issued_by_idx ON state.commands (issued_by);

-- ── 5. القوانين ───────────────────────────────────────────────────────────────
CREATE TABLE state.laws (
  id state.entity_id PRIMARY KEY,
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 300),
  body text NOT NULL CHECK (length(btrim(body)) > 0),
  status text NOT NULL CHECK (status IN ('drafted', 'reviewed', 'enacted', 'repealed')),
  version state.version_number NOT NULL DEFAULT 1,
  enacted_by state.entity_id,
  enacted_at timestamptz,
  repealed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT laws_title_version_unique UNIQUE (title, version),
  -- لا نفاذ بلا سلطة نفاذ ولا وقت نفاذ: النفاذ فعلٌ سياديٌّ مؤرَّخ.
  CONSTRAINT laws_enactment_complete CHECK (
    (status IN ('enacted', 'repealed')) = (enacted_by IS NOT NULL AND enacted_at IS NOT NULL)
  ),
  CONSTRAINT laws_repeal_after_enactment CHECK (
    (status = 'repealed') = (repealed_at IS NOT NULL)
  ),
  CONSTRAINT laws_repealed_not_before_enacted CHECK (
    repealed_at IS NULL OR (enacted_at IS NOT NULL AND repealed_at >= enacted_at)
  )
);

CREATE INDEX laws_status_idx ON state.laws (status);

-- ── 6. القضايا ────────────────────────────────────────────────────────────────
CREATE TABLE state.cases (
  id state.entity_id PRIMARY KEY,
  law_id state.entity_id NOT NULL REFERENCES state.laws (id) ON DELETE RESTRICT,
  subject state.entity_id NOT NULL,
  state text NOT NULL CHECK (state IN ('opened', 'heard', 'judged', 'appealed', 'closed')),
  opened_at timestamptz NOT NULL DEFAULT now(),
  heard_at timestamptz,
  verdict text CHECK (verdict IS NULL OR verdict IN ('guilty', 'innocent', 'dismissed')),
  closed_at timestamptz,
  -- الحكم لا يُصدر قبل السماع (نفس حرس `law-system` في الكود، مثبَّتاً في القاعدة).
  CONSTRAINT cases_judgment_needs_hearing CHECK (
    (state IN ('judged', 'appealed', 'closed')) <= (heard_at IS NOT NULL)
  ),
  CONSTRAINT cases_verdict_iff_judged CHECK (
    (state IN ('judged', 'appealed', 'closed')) = (verdict IS NOT NULL)
  ),
  CONSTRAINT cases_closed_iff_state_closed CHECK ((state = 'closed') = (closed_at IS NOT NULL)),
  CONSTRAINT cases_timeline_ordered CHECK (
    (heard_at IS NULL OR heard_at >= opened_at) AND (closed_at IS NULL OR closed_at >= opened_at)
  )
);

CREATE INDEX cases_law_idx ON state.cases (law_id);
CREATE INDEX cases_state_opened_idx ON state.cases (state, opened_at DESC);
CREATE INDEX cases_subject_idx ON state.cases (subject);

-- ── 7. السياسات ───────────────────────────────────────────────────────────────
CREATE TABLE state.policies (
  id state.entity_id PRIMARY KEY,
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 200),
  effect text NOT NULL CHECK (effect IN ('allow', 'deny')),
  resource text NOT NULL CHECK (length(btrim(resource)) > 0),
  action text NOT NULL CHECK (length(btrim(action)) > 0),
  condition jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(condition) = 'object'),
  law_id state.entity_id REFERENCES state.laws (id) ON DELETE RESTRICT,
  version state.version_number NOT NULL DEFAULT 1,
  enabled boolean NOT NULL DEFAULT false,
  approved_by state.entity_id,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT policies_name_version_unique UNIQUE (name, version),
  -- سياسة نافذة بلا اعتماد هي توسيع صلاحيات بلا قرار (المادة 9).
  CONSTRAINT policies_enabled_needs_approver CHECK (enabled <= (approved_by IS NOT NULL))
);

CREATE INDEX policies_resource_action_idx ON state.policies (resource, action) WHERE enabled;
CREATE INDEX policies_law_idx ON state.policies (law_id);

-- ── 8. الحصص ──────────────────────────────────────────────────────────────────
CREATE TABLE state.quotas (
  id state.entity_id PRIMARY KEY,
  subject_type text NOT NULL CHECK (subject_type IN ('agent', 'institution', 'region', 'model')),
  subject_id state.entity_id NOT NULL,
  resource text NOT NULL CHECK (length(btrim(resource)) > 0),
  limit_value numeric(20, 4) NOT NULL CHECK (limit_value > 0),
  window_seconds integer NOT NULL CHECK (window_seconds > 0),
  consumed numeric(20, 4) NOT NULL DEFAULT 0 CHECK (consumed >= 0),
  window_started_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT quotas_subject_resource_unique UNIQUE (subject_type, subject_id, resource),
  -- الحدّ يُوقف فعلاً: القاعدة نفسها ترفض استهلاكاً يتجاوزه، فلا يعتمد الإيقاف
  -- على تذكّر المستدعي أن يفحص.
  CONSTRAINT quotas_consumed_within_limit CHECK (consumed <= limit_value)
);

CREATE INDEX quotas_subject_idx ON state.quotas (subject_type, subject_id);

-- ── 9. أصول البيانات ─────────────────────────────────────────────────────────
CREATE TABLE state.data_assets (
  id state.entity_id PRIMARY KEY,
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 200),
  classification text NOT NULL CHECK (classification IN ('public', 'internal', 'confidential', 'sovereign')),
  owner state.entity_id NOT NULL,
  schema_ref text NOT NULL CHECK (length(btrim(schema_ref)) > 0),
  retention_days integer NOT NULL CHECK (retention_days >= 0),
  legal_hold boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT data_assets_name_unique UNIQUE (name),
  -- احتفاظ صفر يعني «يُمحى فوراً»، ولا يجوز أن يقع على أصلٍ محفوظ قانوناً (M3.08).
  CONSTRAINT data_assets_hold_blocks_zero_retention CHECK (NOT (legal_hold AND retention_days = 0))
);

CREATE INDEX data_assets_classification_idx ON state.data_assets (classification);
CREATE INDEX data_assets_owner_idx ON state.data_assets (owner);

-- ── 10. ذاكرة الوكلاء ────────────────────────────────────────────────────────
CREATE TABLE state.memories (
  id state.entity_id PRIMARY KEY,
  agent_id state.entity_id NOT NULL REFERENCES state.agents (id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('episodic', 'semantic', 'procedural')),
  content jsonb NOT NULL CHECK (jsonb_typeof(content) = 'object'),
  tags text[] NOT NULL DEFAULT '{}' CHECK (array_position(tags, NULL) IS NULL),
  legal_hold boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  CONSTRAINT memories_expiry_after_creation CHECK (expires_at IS NULL OR expires_at > created_at),
  -- ذاكرة محفوظة قانوناً لا تحمل تاريخ انتهاء: المحو المؤجَّل محوٌ مضمون.
  CONSTRAINT memories_hold_has_no_expiry CHECK (NOT (legal_hold AND expires_at IS NOT NULL))
);

CREATE INDEX memories_agent_created_idx ON state.memories (agent_id, created_at DESC);
CREATE INDEX memories_expiry_idx ON state.memories (expires_at) WHERE expires_at IS NOT NULL;
CREATE INDEX memories_tags_idx ON state.memories USING gin (tags);
