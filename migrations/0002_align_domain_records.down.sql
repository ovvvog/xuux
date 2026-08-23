-- تراجع الهجرة 0002 — إعادة المخطَّط إلى صورته في `0001` بالحرف.
--
-- التراجع هنا **يُفقد بيانات**: الأعمدة المضافة (‏`role` و`owner` و`certificate`
-- و`source` و`lineage` و`quality` و`dataset_id` و`scope` و`proposer` و`is_active`
-- ونسخة النموذج) تُحذف بمحتواها، لأن `0001` لا موضع فيها لها. فمن تراجع بعد
-- تشغيلٍ حقيقي فقد سجلاتِ الميدان لا شكلَ الجدول وحده — والنسخ الاحتياطي
-- (`M3.07`) هو ما يُرجعها لا هذا الملف. وهذا **حدٌّ معلن** لا عيبٌ مستور: تراجعُ
-- هجرةٍ تُغيّر العقد لا يمكن أن يكون بلا فقد، وإخفاؤه بعمودٍ يُترك خلفه أسوأ.
--
-- ومعيار `M3.03` («up ثم down يعودان بالقاعدة إلى حالتها الأصلية») يُقاس على
-- **صورة الكتالوج** لا على البيانات، وهذا الملف يستوفيه: يُعيد الأعمدة والقيود
-- والفهارس المحذوفة بأسمائها ونصوصها كما كانت.

DROP INDEX state.laws_scope_status_idx;

ALTER TABLE state.laws DROP CONSTRAINT laws_enactment_authority_recorded;
ALTER TABLE state.laws
  ADD CONSTRAINT laws_enactment_complete CHECK (
    (status IN ('enacted', 'repealed')) = (enacted_by IS NOT NULL AND enacted_at IS NOT NULL)
  );

ALTER TABLE state.laws DROP CONSTRAINT laws_status_allowed;
ALTER TABLE state.laws DROP CONSTRAINT laws_updated_not_before_created;
ALTER TABLE state.laws
  ADD CONSTRAINT laws_status_check CHECK (
    status IN ('drafted', 'reviewed', 'enacted', 'repealed')
  );

ALTER TABLE state.laws
  DROP COLUMN scope,
  DROP COLUMN proposer,
  DROP COLUMN state_changed_at,
  DROP COLUMN updated_at;

DROP INDEX state.memories_dataset_idx;
ALTER TABLE state.memories DROP CONSTRAINT memories_updated_not_before_created;
ALTER TABLE state.memories
  ALTER COLUMN kind DROP DEFAULT,
  DROP COLUMN dataset_id,
  DROP COLUMN version,
  DROP COLUMN updated_at;

ALTER TABLE state.data_assets DROP CONSTRAINT data_assets_classification_allowed;
ALTER TABLE state.data_assets DROP CONSTRAINT data_assets_updated_not_before_created;
ALTER TABLE state.data_assets
  ADD CONSTRAINT data_assets_classification_check CHECK (
    classification IN ('public', 'internal', 'confidential', 'sovereign')
  );

-- إعادة `schema_ref` تلزمها قيمة للصفوف القائمة، والقيمة الافتراضية اختلاق. فإن
-- وُجد صفٌّ واحد فشل التراجع مُغلقاً بدل أن يكتب قيمة صورية في عمود إلزامي.
DO $guard$
BEGIN
  IF EXISTS (SELECT 1 FROM state.data_assets) THEN
    RAISE EXCEPTION 'MIGRATION_0002_DOWN_REFUSES_TO_FABRICATE: state.data_assets فيها صفوف، وإعادة schema_ref الإلزامي تستلزم قيمة مُلفَّقة لكل صف.';
  END IF;
END
$guard$;

ALTER TABLE state.data_assets
  ADD COLUMN schema_ref text NOT NULL CHECK (length(btrim(schema_ref)) > 0),
  DROP COLUMN source,
  DROP COLUMN lineage,
  DROP COLUMN quality,
  DROP COLUMN version,
  DROP COLUMN updated_at;

DROP INDEX state.models_one_active_per_purpose_idx;
CREATE UNIQUE INDEX models_one_approved_per_purpose_idx
  ON state.models (purpose)
  WHERE status = 'approved';

ALTER TABLE state.models DROP CONSTRAINT models_name_provider_version_unique;
ALTER TABLE state.models
  ADD CONSTRAINT models_name_provider_unique UNIQUE (name, provider);

ALTER TABLE state.models DROP CONSTRAINT models_status_allowed;
ALTER TABLE state.models DROP CONSTRAINT models_active_must_be_approved;
ALTER TABLE state.models DROP CONSTRAINT models_state_change_not_before_created;
ALTER TABLE state.models
  ADD CONSTRAINT models_status_check CHECK (
    status IN ('registered', 'evaluated', 'approved', 'suspended', 'retired')
  );

ALTER TABLE state.models DROP CONSTRAINT models_purpose_declared;
ALTER TABLE state.models
  ADD CONSTRAINT models_purpose_check CHECK (
    purpose IN ('governance', 'operations', 'research', 'education', 'safety', 'registry')
  );

ALTER TABLE state.models
  DROP COLUMN model_version,
  DROP COLUMN capabilities,
  DROP COLUMN state_reason,
  DROP COLUMN state_changed_at,
  DROP COLUMN is_active;

DROP INDEX state.agents_owner_idx;

ALTER TABLE state.agents DROP CONSTRAINT agents_punitive_has_reason;
ALTER TABLE state.agents DROP CONSTRAINT agents_state_change_not_before_created;
ALTER TABLE state.agents
  ADD CONSTRAINT agents_suspension_has_reason CHECK (
    (status IN ('suspended', 'quarantined')) = (suspended_reason IS NOT NULL)
  );

ALTER TABLE state.agents DROP CONSTRAINT agents_status_allowed;
ALTER TABLE state.agents
  ADD CONSTRAINT agents_status_check CHECK (
    status IN ('registered', 'active', 'suspended', 'quarantined', 'retired')
  );

ALTER TABLE state.agents
  ALTER COLUMN kind DROP DEFAULT,
  DROP COLUMN role,
  DROP COLUMN owner,
  DROP COLUMN certificate,
  DROP COLUMN state_changed_at;

-- إعادة دقّة ساعة القاعدة إلى الميكروثانية (وبها يعود العيب المتقطّع الموصوف
-- في ملف التقديم — والتراجع لا يُدّعى فيه أنه أفضل، بل أنه يعيد ما كان).
ALTER TABLE state.data_assets ALTER COLUMN created_at SET DEFAULT now();
ALTER TABLE state.memories ALTER COLUMN created_at SET DEFAULT now();
ALTER TABLE state.laws ALTER COLUMN created_at SET DEFAULT now();
ALTER TABLE state.models ALTER COLUMN created_at SET DEFAULT now();
ALTER TABLE state.agents ALTER COLUMN created_at SET DEFAULT now();
