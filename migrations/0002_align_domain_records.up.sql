-- الهجرة 0002 — توفيق المخطَّط مع سجلات الميدان (الخطوة `M3.05`).
--
-- **سببُ وجودها عيبٌ أُثبت لا تحسينٌ اختياري.** المخطَّط الأول (`0001`، الخطوة
-- `M3.02`) صُمِّم على الورق قبل أن يُوصَل بسجلٍ واحدٍ من السجلات القائمة، فخرج
-- بحقولٍ لا وجود لها في الكود (‏`kind`، `schema_ref`) وناقصاً حقولاً يحملها كل
-- سجل فعلي (‏`role` و`owner` و`certificate` للوكيل، و`source` و`lineage`
-- و`quality` لأصل البيانات)، وبقوائم قيمٍ تخالف حالات الكود (‏`revoked` للوكيل
-- و`sandboxed` و`rolled-back` للنموذج و`draft`/`proposed`/`suspended` للقانون،
-- و`sensitive` تصنيفاً بدل `confidential`)، وبأبعاد تفرّدٍ خاطئة (‏`UNIQUE (name,
-- provider)` تمنع نسختين من نفس النموذج، وهو ما يفعله السجل بالتحديد).
--
-- فلا تُقرأ هذه الهجرة إضافةَ ميزة: هي **تصحيح مخطَّطٍ أُعلن مقبولاً في `M3.02`**
-- وكُشف خلافه أول ما وُصل بالكود. وتصحيحُه هجرةً مُرقَّمة قابلة للتراجع هو ما
-- كان نظام الهجرات (‏`M3.03`) موضوعاً له.
--
-- **حرس عدم التلفيق:** إضافة عمود `NOT NULL` إلى جدول فيه صفوف تلزمها قيمة
-- افتراضية، والقيمة الافتراضية هنا تعني **اختلاق بيانات** لسجلاتٍ قائمة (وكيلٌ
-- بدور 'unspecified' ومالكٍ مُلفَّق). فالهجرة تفشل مُغلقةً إن وجدت صفاً واحداً في
-- أي من الجداول المعدَّلة، وتُترك المعالجة لهجرةٍ خاصة يكتبها من يملك البيانات.

DO $guard$
DECLARE
  populated text;
BEGIN
  SELECT string_agg(t, ', ') INTO populated
  FROM (
    SELECT 'state.agents' AS t WHERE EXISTS (SELECT 1 FROM state.agents)
    UNION ALL SELECT 'state.models' WHERE EXISTS (SELECT 1 FROM state.models)
    UNION ALL SELECT 'state.laws' WHERE EXISTS (SELECT 1 FROM state.laws)
    UNION ALL SELECT 'state.data_assets' WHERE EXISTS (SELECT 1 FROM state.data_assets)
    UNION ALL SELECT 'state.memories' WHERE EXISTS (SELECT 1 FROM state.memories)
  ) AS populated_tables;
  IF populated IS NOT NULL THEN
    RAISE EXCEPTION 'MIGRATION_0002_REFUSES_TO_FABRICATE: جداول فيها صفوف (%) — إضافة أعمدة إلزامية تستلزم قيماً مُلفَّقة لها. اكتب هجرة نقل بيانات صريحة.', populated;
  END IF;
END
$guard$;

-- ═══ الوكلاء: الدور والمالك والشهادة، و«ملغى» حالةً معلنة ═══
ALTER TABLE state.agents
  ADD COLUMN role text NOT NULL CHECK (length(btrim(role)) BETWEEN 1 AND 120),
  ADD COLUMN owner state.entity_id NOT NULL,
  -- الشهادة تُخزَّن كما أصدرها جذر الثقة: هي الدليل على أن الوكيل مُصرَّح، وفقدُها
  -- بإعادة التشغيل يجعل كل وكيل قائمٍ بلا إثبات صلاحية.
  ADD COLUMN certificate jsonb NOT NULL CHECK (jsonb_typeof(certificate) = 'object'),
  ADD COLUMN state_changed_at timestamptz,
  ALTER COLUMN kind SET DEFAULT 'autonomous';

ALTER TABLE state.agents DROP CONSTRAINT agents_status_check;
ALTER TABLE state.agents
  ADD CONSTRAINT agents_status_allowed CHECK (
    status IN ('registered', 'active', 'suspended', 'quarantined', 'revoked', 'retired')
  );

-- الإلغاء عقوبةٌ كالتعليق والحجْر، فسببُه إلزاميٌّ مثلها. القيد الأول كان يُغفل
-- `revoked` لأن الحالة نفسها لم تكن في المخطَّط.
ALTER TABLE state.agents DROP CONSTRAINT agents_suspension_has_reason;
ALTER TABLE state.agents
  ADD CONSTRAINT agents_punitive_has_reason CHECK (
    (status IN ('suspended', 'quarantined', 'revoked')) = (suspended_reason IS NOT NULL)
  ),
  ADD CONSTRAINT agents_state_change_not_before_created CHECK (
    state_changed_at IS NULL OR state_changed_at >= created_at
  );

CREATE INDEX agents_owner_idx ON state.agents (owner);

-- ═══ النماذج: نسخة النموذج، وقدراته، ومؤشّر النشاط الصريح ═══
ALTER TABLE state.models
  -- عمود `version` محجوز للقفل المتفائل (عدد صحيح يزيد مع كل كتابة)، ونسخة
  -- النموذج نصٌّ يُعلنه المُودِع ('1.0.0')؛ خلطُهما كان سيجعل ترقيةَ نموذجٍ
  -- تُقرأ كتابةً متزامنة.
  ADD COLUMN model_version text NOT NULL CHECK (length(btrim(model_version)) BETWEEN 1 AND 60),
  ADD COLUMN capabilities text[] NOT NULL DEFAULT '{}' CHECK (array_position(capabilities, NULL) IS NULL),
  ADD COLUMN state_reason text CHECK (state_reason IS NULL OR length(btrim(state_reason)) > 0),
  ADD COLUMN state_changed_at timestamptz,
  -- النشاط قرارٌ مستقل عن الاعتماد: نماذج كثيرة تُعتمد، وواحدٌ يُفعَّل لغرضه.
  -- كان المخطَّط يخلطهما فيمنع اعتماد نموذجين لغرض واحد، وهو ما يحتاجه الترقية.
  ADD COLUMN is_active boolean NOT NULL DEFAULT false;

ALTER TABLE state.models DROP CONSTRAINT models_purpose_check;
ALTER TABLE state.models
  -- الغرض نصٌّ يُعلنه صاحب النموذج لا قائمةً مغلقة اختُرعت على الورق: قائمة
  -- `0001` لم تكن تحوي 'audit' وهو غرضٌ مستعمل في الكود اليوم.
  ADD CONSTRAINT models_purpose_declared CHECK (length(btrim(purpose)) BETWEEN 1 AND 120);

ALTER TABLE state.models DROP CONSTRAINT models_status_check;
ALTER TABLE state.models
  ADD CONSTRAINT models_status_allowed CHECK (
    status IN ('registered', 'sandboxed', 'evaluated', 'approved', 'suspended', 'retired', 'rolled-back')
  ),
  -- النشط يجب أن يكون معتمداً: هذا هو حرسُ `MODEL_ACTIVE_NOT_APPROVED` نفسه،
  -- مثبَّتاً في القاعدة فلا يتجاوزه من كتب في الجدول بلا مستودع.
  ADD CONSTRAINT models_active_must_be_approved CHECK (NOT is_active OR status = 'approved'),
  ADD CONSTRAINT models_state_change_not_before_created CHECK (
    state_changed_at IS NULL OR state_changed_at >= created_at
  );

ALTER TABLE state.models DROP CONSTRAINT models_name_provider_unique;
ALTER TABLE state.models
  ADD CONSTRAINT models_name_provider_version_unique UNIQUE (name, provider, model_version);

DROP INDEX state.models_one_approved_per_purpose_idx;
-- نموذج **نشط** واحد لكل غرض. القيد قائم كما كان في `D3`، لكن على البُعد الصحيح.
CREATE UNIQUE INDEX models_one_active_per_purpose_idx
  ON state.models (purpose)
  WHERE is_active;

-- ═══ أصول البيانات: المصدر والاشتقاق والجودة، ونسخةٌ للقفل ═══
ALTER TABLE state.data_assets
  ADD COLUMN source text NOT NULL CHECK (length(btrim(source)) BETWEEN 1 AND 200),
  ADD COLUMN lineage jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(lineage) = 'array'),
  -- الجودة تبدأ `unverified`: البيانات غير موثوقة حتى يُثبت خلاف ذلك، لا العكس.
  ADD COLUMN quality text NOT NULL DEFAULT 'unverified' CHECK (
    quality IN ('unverified', 'verified', 'degraded', 'rejected')
  ),
  ADD COLUMN version state.version_number NOT NULL DEFAULT 1,
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now(),
  -- `schema_ref` عمودٌ لم يُكتب فيه شيء قطّ ولا مقابل له في أي سجل: عمودٌ إلزامي
  -- بلا كاتب يُملأ بقيمة صورية، وقيمةٌ صورية إلزامية أسوأ من غياب العمود.
  DROP COLUMN schema_ref;

ALTER TABLE state.data_assets DROP CONSTRAINT data_assets_classification_check;
ALTER TABLE state.data_assets
  -- سلّم التصنيف في الكود: public < internal < sensitive < sovereign. المخطَّط
  -- كتب 'confidential' اسماً لا وجود له في أي قرار إتاحة.
  ADD CONSTRAINT data_assets_classification_allowed CHECK (
    classification IN ('public', 'internal', 'sensitive', 'sovereign')
  ),
  ADD CONSTRAINT data_assets_updated_not_before_created CHECK (updated_at >= created_at);

-- ═══ الذاكرة: ربطُها بعقد بياناتها، ونسخةٌ للقفل ═══
ALTER TABLE state.memories
  -- لا ذاكرة بلا عقد بيانات معلَن المالك والتصنيف: هذا هو الشرط الذي يفرضه
  -- `memory-store` في الكود، وكان غائباً عن المخطَّط فيُمكن كتابة ذاكرة يتيمة.
  ADD COLUMN dataset_id state.entity_id NOT NULL REFERENCES state.data_assets (id) ON DELETE RESTRICT,
  ADD COLUMN version state.version_number NOT NULL DEFAULT 1,
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now(),
  ALTER COLUMN kind SET DEFAULT 'episodic';

ALTER TABLE state.memories
  ADD CONSTRAINT memories_updated_not_before_created CHECK (updated_at >= created_at);

CREATE INDEX memories_dataset_idx ON state.memories (dataset_id);

-- ═══ القوانين: النطاق والمُقترِح، وحالاتٌ كما هي في الكود ═══
ALTER TABLE state.laws
  ADD COLUMN scope text NOT NULL CHECK (length(btrim(scope)) BETWEEN 1 AND 120),
  ADD COLUMN proposer state.entity_id NOT NULL,
  ADD COLUMN state_changed_at timestamptz,
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE state.laws DROP CONSTRAINT laws_status_check;
ALTER TABLE state.laws
  ADD CONSTRAINT laws_status_allowed CHECK (
    status IN ('draft', 'proposed', 'enacted', 'suspended', 'repealed')
  ),
  ADD CONSTRAINT laws_updated_not_before_created CHECK (updated_at >= created_at);

-- النفاذ يلزمه سلطةُ نفاذ ووقتُ نفاذ. والصيغة صارت **استلزاماً** لا تكافؤاً: قانونٌ
-- نافذ ثم مُعلَّق يبقى محتفظاً بسلطة نفاذه ووقته، والتكافؤ كان يُبطل التعليق.
ALTER TABLE state.laws DROP CONSTRAINT laws_enactment_complete;
ALTER TABLE state.laws
  ADD CONSTRAINT laws_enactment_authority_recorded CHECK (
    (status IN ('enacted', 'suspended', 'repealed')) <= (enacted_by IS NOT NULL AND enacted_at IS NOT NULL)
  );

CREATE INDEX laws_scope_status_idx ON state.laws (scope, status);

-- ═══ دقّة الزمن على حدّ JavaScript/PostgreSQL ═══
-- عيبٌ حقيقي ظهر إخفاقاً متقطّعاً في `tests/persistence/atomicity.test.mjs`:
-- `created_at` كان يُكتب من ساعة القاعدة بدقّة الميكروثانية، أما كل الأزمنة
-- القادمة من الكود (`stateChangedAt`, `expiresAt`) فدقّتها **ميلي**ثانية لأن
-- `Date` في JavaScript لا يحمل أكثر. فصفٌّ أُنشئ عند 12:00:00.123456 ثم انتقلت
-- حالته بعد ميكروثانيات يحمل `state_changed_at = 12:00:00.123` وهو **أقل** من
-- تاريخ إنشائه، فيرفضه القيد وإن كان الترتيب الحقيقي سليماً.
--
-- والعلاج المبدئي أن تُقصَّ ساعة القاعدة إلى الميليثانية، فتصير الدقّتان
-- واحدة ولا يبقى فرقٌ كاذب. وحدٌّ معلن: القيود تسمح بالتساوي، فعمليّتان في نفس
-- الميليثانية لا يفرّق بينهما الزمن — الترتيب يُقرأ من `version` لا من الساعة.
ALTER TABLE state.agents ALTER COLUMN created_at SET DEFAULT date_trunc('milliseconds', now());
ALTER TABLE state.models ALTER COLUMN created_at SET DEFAULT date_trunc('milliseconds', now());
ALTER TABLE state.laws ALTER COLUMN created_at SET DEFAULT date_trunc('milliseconds', now());
ALTER TABLE state.memories ALTER COLUMN created_at SET DEFAULT date_trunc('milliseconds', now());
ALTER TABLE state.data_assets ALTER COLUMN created_at SET DEFAULT date_trunc('milliseconds', now());
