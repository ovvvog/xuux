-- الهجرة 0015 — نموذجُ التشغيل المؤسسي: اختصاصٌ وصلاحياتٌ وسقفُ مدّةٍ ومساءلةٌ
-- ودورةٌ تقريرية (الخطوة M8.06).
--
-- **العيبُ الذي تعالجه:** أنشأت الهجرة 0014 عملَ المؤسسة — مهمّةٌ ومُخصَّصٌ
-- ومخرَجٌ — ولم يكن في القاعدة عمودٌ واحدٌ يقول **ما للمؤسسة أن تعمل فيه**: لا
-- مجالَ محكوماً، ولا صلاحيةً مسمّاةً، ولا جهةَ تُسأل أمامها، ولا سقفَ صرفٍ في
-- مدّة، ولا موعدَ تقريرٍ يُقاس تأخُّرُه. فكان الاختصاصُ فقرةً في
-- `docs/INSTITUTIONAL_OPERATING_MODEL.md`، ونصٌّ في وثيقةٍ لا يمنع فعلاً.
--
-- ولذلك تُنشأ ثلاثةُ جداول: `state.institution_mandates` (نموذجُ التشغيل نافذاً
-- في صفٍّ محفوظ)، و`state.institution_breaches` (المخالفةُ مادّةً للمساءلة
-- منسوبةً إلى جهةٍ مسمّاة)، و`state.institution_report_cycles` (دورةٌ مُغلَقةٌ
-- بتقريرٍ مُشتقٍّ من صفوفِ مدّتها). ويُضاف عمود `domain` إلى
-- `state.institution_tasks`: مجالٌ مُستنبَطٌ من نوعِ المهمّةِ وحدَه لا يُقاس
-- تجاوزُه، لأنّ المتجاوِزَ لا يُعلن.
--
-- ومُسمَّياتُ القيود تُطابق ثوابتَ `INSTITUTION_MANDATE_SPEC` و
-- `INSTITUTION_BREACH_SPEC` و`INSTITUTION_REPORT_CYCLE_SPEC` في
-- `src/persistence/entities.mjs` واحداً بواحد، والبوابةُ 22
-- (`scripts/guard-mandates.mjs`) تحرس ألّا يسقط أحدُ الطرفين دون الآخر.
--
-- **حدٌّ معلَن أول — عمودٌ مُضافٌ بقيمةٍ افتراضيةٍ ثم يُنزع افتراضُها:** المهامُّ
-- التي سبقت هذه الهجرة لا مجالَ مُعلَناً لها، فتُملأ بـ`'unassigned'` ثم يُنزع
-- الافتراضُ ليكون الإعلانُ لازماً على كلِّ صفٍّ جديد. والصفوفُ القديمةُ تبقى
-- مقروءةً بمجالٍ اسمُه يقول إنّه غيرُ مُسنَد: لا يُدَّعى أنّها كانت مُعلَنة.
--
-- **حدٌّ معلَن ثانٍ — سقفُ المدّة لا يُفرَض بقيدٍ جدوليّ:** جمعُ كلفِ المهامِّ
-- المقيَّدةِ في مدّةٍ متحرّكةٍ يقتضي قراءةَ جدولٍ آخرَ من قيدٍ على هذا الجدول،
-- والقيدُ الجدوليُّ لا يقرأ جدولاً آخر (والمُشغِّلاتُ ليست قيوداً بل كودٌ يُطفأ).
-- فالسقفُ مفروضٌ في `InstitutionMandate.assertWithinPeriodCeiling`، والقاعدةُ
-- تفرض ما تقدر عليه: أنّ السقفَ والمدّةَ أعدادٌ موجبةٌ مُعلَنةٌ في الصفّ.
--
-- **حدٌّ معلَن ثالث — لا مفاتيحَ أجنبية:** `institution_id` و`task_id` نصوصٌ
-- بنطاق `state.entity_id` لا `REFERENCES`، على نهج 0014 وما قبلها؛ والربطُ
-- مفروضٌ في `src/institutions/mandate.mjs` بقراءةِ الصفِّ قبل الكتابة. وهذا
-- **أضعفُ** من مفتاحٍ أجنبيٍّ ولا يُدَّعى أنّه مثلُه.
--
-- **حدٌّ معلَن رابع — لم تُطبَّق:** الهجرات 0005–0015 لم تُشغَّل على PostgreSQL
-- حقيقيٍّ في هذا المستودع بعد؛ صحّةُ هذه القيود مقروءةٌ لا مُختبَرة. وهو
-- مسجَّلٌ في `docs/REMAINING_WORK.md`.
--
-- ولا `BEGIN`/`COMMIT` هنا: المُهاجر يفتح المعاملة بنفسه.

CREATE TABLE state.institution_mandates (
  id state.entity_id PRIMARY KEY,
  institution_id state.entity_id NOT NULL,
  charter_key text NOT NULL CHECK (charter_key ~ '^[a-z][a-z-]{2,63}$'),
  domains text[] NOT NULL CHECK (array_position(domains, NULL) IS NULL),
  excluded_domains text[] NOT NULL CHECK (array_position(excluded_domains, NULL) IS NULL),
  powers text[] NOT NULL CHECK (array_position(powers, NULL) IS NULL),
  prohibitions text[] NOT NULL CHECK (array_position(prohibitions, NULL) IS NULL),
  budget_period_days integer NOT NULL,
  budget_ceiling integer NOT NULL,
  accountable_to text NOT NULL CHECK (accountable_to ~ '^role:[a-z-]+$'),
  escalate_to text NOT NULL CHECK (escalate_to ~ '^role:[a-z-]+$'),
  reporting_period_days integer NOT NULL,
  reporting_grace_days integer NOT NULL,
  model_version integer NOT NULL CHECK (model_version >= 1),
  enacted_at timestamptz NOT NULL,
  version state.version_number NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- ١. الاختصاصُ مجالٌ واحدٌ على الأقل، ولا مجالَ مُعلَنٌ ومُستثنىً معاً: حدٌّ
  --    يُقرأ على وجهين ليس حدّاً، ونموذجٌ بلا مجالٍ يُقرأ إباحةً مطلقةً أو منعاً
  --    مطلقاً بحسب من يقرؤه.
  CONSTRAINT institution_mandates_jurisdiction_declared CHECK (
    array_length(domains, 1) >= 1
    AND NOT (domains && excluded_domains)
  ),
  -- ٢. الصلاحياتُ الممنوحةُ واحدةٌ على الأقل، ولا صلاحيةَ ممنوحةٌ ومحرَّمةٌ معاً:
  --    المحرَّمُ يغلب الممنوحَ فلا يجتمعان في صفٍّ واحد.
  CONSTRAINT institution_mandates_powers_declared CHECK (
    array_length(powers, 1) >= 1
    AND NOT (powers && prohibitions)
  ),
  -- ٣. جهةُ المساءلةِ وجهةُ التصعيد دوران مختلفان: تصعيدٌ إلى نفس الجهة ليس
  --    تصعيداً. وأن تكونا من خارج أدوارِ وكلاء المؤسسة شرطٌ يقتضي قراءةَ
  --    `state.institutions`، فهو مفروضٌ في `loadMandatesPolicy` وقتَ التحميل.
  CONSTRAINT institution_mandates_accountability_external CHECK (
    accountable_to <> escalate_to
  ),
  -- ٤. المُدَدُ والسقفُ أعدادٌ موجبةٌ ومهلةُ السماح غيرُ سالبة: سقفٌ صفريٌّ يمنع
  --    كلَّ عملٍ، ومدّةٌ صفريةٌ تجعل التقريرَ مستحقّاً دائماً فيوقف العملَ أبداً.
  CONSTRAINT institution_mandates_periods_positive CHECK (
    budget_period_days >= 1
    AND budget_ceiling >= 1
    AND reporting_period_days >= 1
    AND reporting_grace_days >= 0
  ),
  -- نموذجان لمؤسسةٍ واحدةٍ حدّان يُقرأ أحدُهما مكانَ الآخر.
  CONSTRAINT institution_mandates_charter_key_unique UNIQUE (charter_key)
);

COMMENT ON TABLE state.institution_mandates IS
  'نموذجُ التشغيل المؤسسي نافذاً: الاختصاصُ والصلاحياتُ وسقفُ المدّةِ والمساءلةُ ومدّةُ التقرير كبياناتٍ تُقرأ وقتَ الفحص، لا نصّاً في وثيقة. مصدرُ الإعلان config/institutional-mandates.yaml والمنفِّذُ src/institutions/mandate.mjs.';

COMMENT ON COLUMN state.institution_mandates.excluded_domains IS
  'المجالاتُ المُستثناةُ صراحةً. منعٌ ضمنيٌّ يُقرأ نقصاً في الإعلان، ومنعٌ صريحٌ يُقرأ قراراً.';

COMMENT ON COLUMN state.institution_mandates.budget_ceiling IS
  'سقفُ الصرفِ في budget_period_days يوماً، فوق المُخصَّصِ الكلّي في state.institutions. لا يُفرَض بقيدٍ جدوليّ (انظر رأس الهجرة).';

CREATE TABLE state.institution_breaches (
  id text PRIMARY KEY CHECK (length(btrim(id)) > 0),
  institution_id state.entity_id NOT NULL,
  charter_key text NOT NULL CHECK (charter_key ~ '^[a-z][a-z-]{2,63}$'),
  task_id state.entity_id,
  code text NOT NULL,
  domain text,
  power text,
  detail text NOT NULL,
  accountable_to text NOT NULL CHECK (accountable_to ~ '^role:[a-z-]+$'),
  escalate_to text NOT NULL CHECK (escalate_to ~ '^role:[a-z-]+$'),
  detected_at timestamptz NOT NULL,
  version state.version_number NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- ١. تفصيلُ المخالفةِ 20 حرفاً، والرقمُ مكرَّرٌ هنا وفي
  --    `config/institutional-mandates.yaml` (`procedure.minBreachDetailLength`)
  --    وفي `entities.mjs` (`INSTITUTION_MANDATE_MIN_BREACH_DETAIL_LENGTH`)،
  --    والبوابةُ 22 تفحص تطابقَه في الثلاثة **في موضعه** من القيد.
  CONSTRAINT institution_breaches_reasoned CHECK (length(btrim(detail)) >= 20),
  -- ٢. الرمزُ من رموزِ نموذج التشغيل: رمزٌ حرٌّ يجعل عدَّ المخالفاتِ في التقرير
  --    عدَّ نصوصٍ لا وقائع.
  CONSTRAINT institution_breaches_code_declared CHECK (code LIKE 'MANDATE\_%'),
  -- ٣. المخالفةُ منسوبةٌ إلى جهةٍ تُسأل عنها وجهةٍ يُصعَّد إليها، مختلفتين.
  CONSTRAINT institution_breaches_attributed CHECK (accountable_to <> escalate_to)
);

COMMENT ON TABLE state.institution_breaches IS
  'مخالفاتُ الاختصاصِ والصلاحيةِ والسقفِ وموعدِ التقرير. مُنِعَ ولم يُسجَّل يعني أنّ المساءلةَ بلا مادّةٍ تُسأل عنها. والمخالفةُ تُسجَّل ولا تُعالَج: لا تسويةَ ولا جزاءَ (انظر docs/REMAINING_WORK.md).';

COMMENT ON COLUMN state.institution_breaches.task_id IS
  'المهمّةُ التي وقعت بها المخالفة إن وُجدت. وتغيب في مخالفةِ تأخُّرِ التقرير الدوريِّ فليست منسوبةً إلى مهمّةٍ بعينها.';

CREATE TABLE state.institution_report_cycles (
  id text PRIMARY KEY CHECK (length(btrim(id)) > 0),
  institution_id state.entity_id NOT NULL,
  charter_key text NOT NULL CHECK (charter_key ~ '^[a-z][a-z-]{2,63}$'),
  period_start timestamptz NOT NULL,
  period_end timestamptz NOT NULL,
  due_at timestamptz NOT NULL,
  closed_at timestamptz NOT NULL,
  closed_by text NOT NULL CHECK (closed_by ~ '^role:[a-z-]+$'),
  tasks_total integer NOT NULL,
  tasks_executed integer NOT NULL,
  tasks_refused integer NOT NULL,
  breach_count integer NOT NULL,
  budget_consumed integer NOT NULL,
  version state.version_number NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- ١. المدّةُ تبدأ قبل أن تنتهي، والاستحقاقُ بعد انتهائها.
  CONSTRAINT institution_report_cycles_window_ordered CHECK (
    period_start < period_end AND period_end <= due_at
  ),
  -- ٢. الدورةُ تُغلَق بعد انقضاء مدّتها: إغلاقٌ قبلها يُنتج تقريراً عن مدّةٍ لم
  --    تكتمل فيُقرأ أداءً كاملاً وهو جزءٌ منه.
  CONSTRAINT institution_report_cycles_closed_after_period CHECK (closed_at >= period_end),
  -- ٣. الأعدادُ غيرُ سالبةٍ ومجموعُ المنفَّذِ والمرفوضِ لا يتجاوز مهامَّ المدّة.
  CONSTRAINT institution_report_cycles_counts_coherent CHECK (
    tasks_total >= 0
    AND tasks_executed >= 0
    AND tasks_refused >= 0
    AND breach_count >= 0
    AND budget_consumed >= 0
    AND tasks_executed + tasks_refused <= tasks_total
  ),
  -- دورتان لمدّةٍ واحدةٍ تقريران يُحتسب بهما العملُ مرّتين.
  CONSTRAINT institution_report_cycles_period_unique UNIQUE (charter_key, period_start)
);

COMMENT ON TABLE state.institution_report_cycles IS
  'الدوراتُ التقريريةُ المُغلَقة. أعدادُها مُشتقّةٌ من صفوفِ المدّة لا نصٌّ محفوظٌ يُقرأ تقريراً: نصٌّ مخزَّنٌ يُكتب مرّةً ويصدق مرّةً.';

-- مجالُ المهمّة: يُضاف بقيمةٍ افتراضيةٍ للصفوف السابقة ثم يُنزع الافتراضُ ليكون
-- الإعلانُ لازماً على كلِّ صفٍّ جديد (انظر الحدَّ المُعلَن الأول في رأس الهجرة).
ALTER TABLE state.institution_tasks
  ADD COLUMN domain text NOT NULL DEFAULT 'unassigned';

ALTER TABLE state.institution_tasks
  ALTER COLUMN domain DROP DEFAULT;

ALTER TABLE state.institution_tasks
  ADD CONSTRAINT institution_tasks_domain_declared CHECK (length(btrim(domain)) > 0);

COMMENT ON COLUMN state.institution_tasks.domain IS
  'مجالُ المهمّة المُعلَنُ عند رفعها، ويُقاس عليه اختصاصُ المؤسسة. الصفوفُ التي سبقت الهجرة 0015 تحمل unassigned ولا يُدَّعى أنّها كانت مُعلَنة.';

-- الاستعلامُ يمشي بالمؤسسة (للتقرير الدوريّ) وبالوقت (لحدود المدّة).
CREATE INDEX institution_breaches_institution_idx
  ON state.institution_breaches (charter_key, detected_at DESC);
CREATE INDEX institution_report_cycles_institution_idx
  ON state.institution_report_cycles (charter_key, period_start DESC);
CREATE INDEX institution_tasks_domain_idx ON state.institution_tasks (institution_id, domain);
