-- الهجرة 0014 — تشغيلُ المؤسسات: مهامٌّ وإسنادٌ وميزانيةٌ ومخرجات (الخطوة M8.05).
--
-- **العيبُ الذي تعالجه:** المؤسساتُ في هذه الدولة كانت 143 صفّاً في
-- `seed/institutions.yaml` كلُّها `status: planned`، ولا جدولَ واحداً في القاعدة
-- يحمل **عملَ** مؤسسة: لا مهمّةً تُستقبَل، ولا وكيلاً يُسنَد، ولا ميزانيةً
-- تُستهلَك، ولا مخرَجاً يُنتج. فكان «قيامُ المؤسسة» اسماً في بذرةٍ لا واقعةً
-- في حالةٍ محفوظة، وكلُّ ما يُبنى عليه بعدها — الاختصاصُ والمساءلةُ والتفويضُ —
-- يقف على شيءٍ لم يقع.
--
-- ولذلك تُنشأ ثلاثةُ جداول: `state.institutions` (المؤسسةُ ومُخصَّصُها وما قُيِّد
-- منه)، و`state.institution_tasks` (المهمّةُ من استقبالها إلى تنفيذها أو رفضها)،
-- و`state.institution_outputs` (المخرَجُ المنسوب). ومُسمَّياتُ القيود تُطابق
-- ثوابتَ `INSTITUTION_SPEC` و`INSTITUTION_TASK_SPEC` و`INSTITUTION_OUTPUT_SPEC`
-- في `src/persistence/entities.mjs` واحداً بواحد، والبوابةُ 21
-- (`scripts/guard-institutions.mjs`) تحرس ألّا يسقط أحدُ الطرفين دون الآخر.
--
-- **حدٌّ معلَن أول — الميزانيةُ دفترٌ ثانٍ:** المُخصَّصُ والمقيَّد عمودان في صفِّ
-- المؤسسة لا صفوفٌ في `state.quotas`، وذرّيةُ القيد ذرّيةُ التحديث المتفائل على
-- `version` لا معاملةٌ واحدةٌ تضمّ القيدَ والإنتاج. ودفترُ الحصص الذرّي في
-- `src/policy/quota.mjs` يعمل على PostgreSQL وحده، فلا يُقاس في اختبارِ قبولٍ
-- ذاكريّ. وتوحيدُ الدفترين مسجَّلٌ في `docs/REMAINING_WORK.md` لا مُوهَمٌ بوقوعه.
--
-- **حدٌّ معلَن ثانٍ — لا مفاتيحَ أجنبية:** `institution_id` و`task_id` و`agent_id`
-- نصوصٌ بنطاق `state.entity_id` لا `REFERENCES`، على نفس نهج الجداول السابقة في
-- هذا المستودع: الربطُ مفروضٌ في `src/institutions/operations.mjs` بقراءةِ الصفِّ
-- قبل الكتابة. وهذا **أضعفُ** من مفتاحٍ أجنبيٍّ ولا يُدَّعى أنّه مثلُه: كتابةٌ
-- مباشرةٌ في القاعدة تستطيع أن تُحيل إلى مؤسسةٍ لا وجودَ لها.
--
-- **حدٌّ معلَن ثالث — أهليّةُ الوكيل ليست في القاعدة:** أن يكون الوكيلُ نشطاً
-- ودورُه من أدوار المؤسسة شرطٌ يقتضي قراءةَ `state.agents` من قيدٍ على
-- `state.institution_tasks`، والقيدُ الجدوليُّ لا يقرأ جدولاً آخر (والمُشغِّلاتُ
-- ليست قيوداً بل كودٌ يُطفأ). فالأهليّةُ مفروضةٌ في `InstitutionOperations.assign`
-- بقراءةِ سجلِّ الهويات، والقاعدةُ تفرض ما تقدر عليه: أنّ الإسنادَ واقعةٌ كاملة.
--
-- **حدٌّ معلَن رابع — لم تُطبَّق:** الهجرات 0005–0014 لم تُشغَّل على PostgreSQL
-- حقيقيٍّ في هذا المستودع بعد؛ صحّةُ هذه القيود مقروءةٌ لا مُختبَرة، والاختباراتُ
-- المتعلّقةُ بالقاعدة تُتخطّى اليوم. وهو مسجَّلٌ في `docs/REMAINING_WORK.md`.
--
-- ولا `BEGIN`/`COMMIT` هنا: المُهاجر يفتح المعاملة بنفسه.

CREATE TABLE state.institutions (
  id state.entity_id PRIMARY KEY,
  -- مفتاحُ المؤسسة في عهدِ التشغيل، ومعرِّفُها في البذرة. وكلاهما فريدٌ بقيدٍ
  -- مسمّى: مؤسستان بمفتاحٍ واحدٍ تُنادى إحداهما مكانَ الأخرى، ومؤسستان بمعرِّفِ
  -- بذرةٍ واحدٍ تُقرآن سنداً واحداً في `seed/institutions.yaml`.
  charter_key text NOT NULL CHECK (charter_key ~ '^[a-z][a-z-]{2,63}$'),
  seed_id text NOT NULL CHECK (seed_id ~ '^[0-9]{3}$'),
  name text NOT NULL CHECK (length(btrim(name)) > 0),
  agent_roles text[] NOT NULL CHECK (array_position(agent_roles, NULL) IS NULL),
  budget_resource text NOT NULL CHECK (length(btrim(budget_resource)) > 0),
  budget_allocated integer NOT NULL,
  budget_consumed integer NOT NULL DEFAULT 0,
  charter_version integer NOT NULL CHECK (charter_version >= 1),
  commissioned_at timestamptz NOT NULL,
  version state.version_number NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- ١. المقيَّدُ لا يتجاوز المُخصَّصَ ولا ينزل عن الصفر. وهذا هو القيدُ الذي
  --    يجعل الميزانيةَ حدّاً: لو غاب لصار «نفادُ الميزانية» فحصاً في الكود وحده
  --    يُتخطّى بكتابةٍ مباشرة.
  CONSTRAINT institutions_budget_not_overdrawn CHECK (
    budget_consumed >= 0 AND budget_consumed <= budget_allocated
  ),
  -- ٢. مؤسسةٌ بمُخصَّصٍ صفريٍّ لا تُنفِّذ مهمّةً واحدة؛ وتشغيلُها إعلانٌ لا عمل.
  CONSTRAINT institutions_allocation_positive CHECK (budget_allocated >= 1),
  -- ٣. مؤسسةٌ بلا دورٍ مؤهَّلٍ يُسنَد إليها كلُّ وكيل.
  CONSTRAINT institutions_roles_declared CHECK (
    array_length(agent_roles, 1) >= 1
  ),
  CONSTRAINT institutions_charter_key_unique UNIQUE (charter_key),
  CONSTRAINT institutions_seed_id_unique UNIQUE (seed_id)
);

COMMENT ON TABLE state.institutions IS
  'المؤسساتُ العاملة: مفتاحٌ في عهد التشغيل، وسندٌ في البذرة، ومُخصَّصٌ يُقيَّد منه قبل كل تنفيذ. لا جدولَ حصصٍ ذرّيّاً (انظر رأس الهجرة).';

CREATE TABLE state.institution_tasks (
  id state.entity_id PRIMARY KEY,
  institution_id state.entity_id NOT NULL,
  kind text NOT NULL CHECK (length(btrim(kind)) > 0),
  subject text NOT NULL,
  submitted_by text NOT NULL CHECK (length(btrim(submitted_by)) > 0),
  state text NOT NULL,
  received_at timestamptz NOT NULL,
  budget_cost integer NOT NULL,
  agent_id state.entity_id,
  assigned_at timestamptz,
  budget_debited_at timestamptz,
  effect text,
  output_id state.entity_id,
  fingerprint_before text,
  fingerprint_after text,
  executed_at timestamptz,
  refusal_code text,
  refusal_reason text,
  refused_at timestamptz,
  version state.version_number NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT institution_tasks_state_known CHECK (
    state IN ('received', 'assigned', 'executed', 'refused')
  ),
  -- ١. حدُّ الموضوع 20 حرفاً، والرقمُ مكرَّرٌ هنا وفي `config/institutions.yaml`
  --    (`procedure.minSubjectLength`) وفي `entities.mjs`
  --    (`INSTITUTION_MIN_SUBJECT_LENGTH`)، والبوابةُ 21 تفحص تطابقَه في الثلاثة.
  CONSTRAINT institution_tasks_subject_measured CHECK (length(btrim(subject)) >= 20),
  -- ٢. مهمّةٌ بكلفةٍ صفريةٍ تُنفَّذ بلا حدّ.
  CONSTRAINT institution_tasks_cost_positive CHECK (budget_cost >= 1),
  -- ٣. الإسنادُ واقعةٌ كاملة: وكيلٌ مسمّى ووقتٌ مسجَّل؛ ونصفُ إسنادٍ لا يُراجَع.
  CONSTRAINT institution_tasks_assignment_complete CHECK (
    (agent_id IS NULL) = (assigned_at IS NULL)
  ),
  -- ٤. الميزانيةُ تُقيَّد قبل التنفيذ لا بعده. وقيدٌ بعد التنفيذ يسمح بتجاوزِ
  --    الحدِّ مرّةً واحدةً — وهي المرّةُ التي تهمّ.
  CONSTRAINT institution_tasks_budget_before_execution CHECK (
    executed_at IS NULL
    OR (budget_debited_at IS NOT NULL AND budget_debited_at <= executed_at)
  ),
  -- ٥. التنفيذُ واقعةٌ **مقيسة**: بصمتان مختلفتان قبله وبعده. وبصمتان متساويتان
  --    تنفيذٌ بلا أثر، وهو ما يُرفض في `InstitutionOperations.execute` أيضاً.
  CONSTRAINT institution_tasks_execution_measured CHECK (
    CASE
      WHEN executed_at IS NULL THEN
        effect IS NULL AND output_id IS NULL AND fingerprint_after IS NULL
      ELSE
        agent_id IS NOT NULL
        AND effect IS NOT NULL
        AND output_id IS NOT NULL
        AND fingerprint_before IS NOT NULL
        AND fingerprint_after IS NOT NULL
        AND fingerprint_before <> fingerprint_after
    END
  ),
  -- ٦. الرفضُ واقعةٌ كاملة: رمزٌ وسببٌ يبلغ 20 حرفاً ووقتٌ مسجَّل، ولا تُرفض
  --    مهمّةٌ نُفِّذت. والرقمُ 20 مكرَّرٌ في العهد وفي `entities.mjs` والبوابةُ
  --    21 تفحص تطابقَه.
  CONSTRAINT institution_tasks_refusal_reasoned CHECK (
    CASE
      WHEN refused_at IS NULL THEN refusal_code IS NULL AND refusal_reason IS NULL
      ELSE
        refusal_code IS NOT NULL
        AND refusal_reason IS NOT NULL
        AND length(btrim(refusal_reason)) >= 20
        AND executed_at IS NULL
    END
  ),
  -- ٧. الحالةُ محسوبةٌ من الوقائع لا مُعلَنةٌ بجانبها؛ وحالةٌ تخالف الوقائعَ
  --    حالةٌ تكذب في كل تقريرٍ يُشتقّ منها.
  CONSTRAINT institution_tasks_state_matches_timeline CHECK (
    CASE state
      WHEN 'received' THEN agent_id IS NULL AND executed_at IS NULL AND refused_at IS NULL
      WHEN 'assigned' THEN agent_id IS NOT NULL AND executed_at IS NULL AND refused_at IS NULL
      WHEN 'executed' THEN executed_at IS NOT NULL
      ELSE refused_at IS NOT NULL
    END
  )
);

COMMENT ON COLUMN state.institution_tasks.agent_id IS
  'الوكيلُ المُسنَد إليه. أهليّتُه (نشطٌ ودورُه من أدوار المؤسسة) مفروضةٌ في InstitutionOperations.assign لا في القاعدة (انظر رأس الهجرة).';

COMMENT ON COLUMN state.institution_tasks.assigned_at IS
  'وقتُ الإسناد. يغيب مع غياب الوكيل ويحضر بحضوره، وقيدُ institution_tasks_assignment_complete يمنع نصفَ إسناد.';

COMMENT ON COLUMN state.institution_tasks.budget_debited_at IS
  'وقتُ قيدِ الكلفة على المُخصَّص. يحضر قبل التنفيذ دائماً، ويبقى حاضراً بعد رفضِ تنفيذٍ بلا أثر: المقيَّدُ لا يُردّ.';

COMMENT ON COLUMN state.institution_tasks.effect IS
  'اسمُ الأثر المُنفَّذ كما هو معلَنٌ في config/institutions.yaml. يغيب قبل التنفيذ.';

COMMENT ON COLUMN state.institution_tasks.output_id IS
  'معرِّفُ المخرَج في state.institution_outputs. نصٌّ لا مفتاحٌ أجنبيّ (انظر رأس الهجرة).';

COMMENT ON COLUMN state.institution_tasks.fingerprint_before IS
  'بصمةُ مخزنِ مخرجات المؤسسة قبل التنفيذ. بها وبأختها يُقاس أنّ للتنفيذ أثراً في البيانات.';

COMMENT ON COLUMN state.institution_tasks.fingerprint_after IS
  'بصمةُ المخزن بعد التنفيذ. تساويها مع الأولى تنفيذٌ بلا أثر، ويمنعه قيدُ institution_tasks_execution_measured.';

COMMENT ON COLUMN state.institution_tasks.executed_at IS
  'وقتُ التنفيذ. يغيب مع المهمّة المُستقبَلة والمُسنَدة والمرفوضة.';

COMMENT ON COLUMN state.institution_tasks.refusal_code IS
  'رمزُ الرفض من الرموز المُعلَنة في config/institutions.yaml (guarantees). يغيب مع غياب وقتِ الرفض.';

COMMENT ON COLUMN state.institution_tasks.refusal_reason IS
  'سببُ الرفض مكتوباً بحدّ 20 حرفاً. رفضٌ بلا سببٍ مكتوبٍ لا يُراجَع.';

COMMENT ON COLUMN state.institution_tasks.refused_at IS
  'وقتُ الرفض. حضورُه يوجب الرمزَ والسببَ ويمنع أن يكون للمهمّة وقتُ تنفيذ.';

CREATE TABLE state.institution_outputs (
  id state.entity_id PRIMARY KEY,
  institution_id state.entity_id NOT NULL,
  task_id state.entity_id NOT NULL,
  kind text NOT NULL CHECK (length(btrim(kind)) > 0),
  effect text NOT NULL CHECK (length(btrim(effect)) > 0),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  produced_by text NOT NULL,
  produced_at timestamptz NOT NULL,
  version state.version_number NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- المخرَجُ منسوبٌ إلى مهمّةٍ وإلى الوكيل الذي أنتجه؛ ومخرَجٌ بلا نسبةٍ لا
  -- يُدقَّق ولا يُقرأ في تقرير.
  CONSTRAINT institution_outputs_attributed CHECK (
    length(btrim(task_id)) > 0 AND length(btrim(produced_by)) > 0
  ),
  -- مخرَجان لمهمّةٍ واحدةٍ يجعلان الكلفةَ المقيَّدةَ مرّةً تُنتج أثرين.
  CONSTRAINT institution_outputs_task_unique UNIQUE (task_id)
);

COMMENT ON TABLE state.institution_outputs IS
  'مخرجاتُ المؤسسات. مخزنٌ خارج صفِّ المهمّة بالقصد: بصمةُ الأثر لو قُرئت من صفِّ المهمّة لتغيّرت بكتابة الصفِّ نفسِه فصار قياسُ الأثر يقيس كتابتَه هو. ولا سحبَ لمخرَجٍ صدر (انظر docs/REMAINING_WORK.md).';

-- الاستعلامُ يمشي بالمؤسسة (للتقرير) وبالحالة (لعدّ ما نُفِّذ وما رُفض).
CREATE INDEX institution_tasks_institution_idx
  ON state.institution_tasks (institution_id, received_at DESC);
CREATE INDEX institution_tasks_state_idx ON state.institution_tasks (institution_id, state);
CREATE INDEX institution_outputs_institution_idx
  ON state.institution_outputs (institution_id, produced_at DESC);
