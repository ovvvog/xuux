-- الهجرة 0012 — مسارُ القضية من الدعوى إلى التنفيذ والتراجع والاستئناف (الخطوة M8.03).
--
-- **العيبُ الذي تعالجه:** جدولُ `state.cases` قائمٌ من الهجرة 0001 ويحمل
-- ثمانيةَ أعمدةٍ فقط: من، وعلى أيِّ قانون، وفي أيِّ حالة، ووقتُ الفتح والسماع
-- والمنطوقُ والإغلاق. وليس فيه **من ادّعى**، ولا **بماذا ادّعى**، ولا **من
-- حكم**، ولا **لماذا حكم**، ولا شيءٌ عن **تنفيذ الحكم** أصلاً. فكان في القاعدة
-- «قضاءٌ» يُصدر منطوقاً بلا مُدَّعٍ ولا سببٍ ولا تنفيذ — وهو ما تنقضه المادةُ 11
-- إذ تقتضي حكماً مُسبَّباً واستئنافاً مكفولاً لطرفٍ في القضية.
--
-- وأخطرُ نقصٍ فيه أنه **يفتقد الأعمدةَ المُدارة** (`version`, `created_at`,
-- `updated_at`) التي يقتضيها كلُّ مستودعٍ في `src/persistence`. فما كان الجدولُ
-- قابلاً للكتابة عبر المستودعات أصلاً، بل صفوفاً لا يكتبها إلا SQL يدويّ. ولهذا
-- كان القضاءُ في `src/governance/law-system.mjs` يعمل على `Map` في الذاكرة
-- والجدولُ خاويٌ لا يقرؤه شيء: جدولٌ بلا مواصفةٍ في الكود جدولٌ ميّت.
--
-- **والقيودُ الستّةُ الجديدةُ تُطابق مسمّياتُها ثوابتَ `CASE_SPEC`** في
-- `src/persistence/entities.mjs` واحداً بواحد، والبوابةُ 20
-- (`scripts/guard-judiciary.mjs`) تحرس ألّا يسقط أحدُ الطرفين دون الآخر. وهذا
-- مقصود: لو فُرض الشرطُ في الكود وحده لكان تجاوزُه كتابةً مباشرةً في القاعدة،
-- ولو فُرض في القاعدة وحدها لما ظهر الرفضُ في المستودع الذاكري ولا في الاختبار.
--
-- **حدٌّ معلَن أول:** عمودُ المدّعى عليه يبقى `subject` باسمه القديم ولا يُعاد
-- تسميته. المواصفةُ في الكود تسمّيه `respondent` وتربطه بالعمود. وإعادةُ التسمية
-- تكسر الهجرة 0001 وفهرسَ `cases_subject_idx` وكلَّ استعلامٍ خارجيٍّ قائمٍ عليه،
-- مقابلَ فائدةٍ لفظيةٍ بحتة.
--
-- **حدٌّ معلَن ثانٍ:** لا مفتاحَ أجنبيّاً على `execution_command_id` ولا على
-- `reversal_command_id` نحو دفتر الأوامر: الدفترُ (`state.command_ledger`) يقيّد
-- ما قبلته بوابةُ التاج، والقضيةُ تُسجّل معرّفَ الأمر بعد قبوله؛ ولو فُرض
-- المفتاحُ لتقيّد ترتيبُ الكتابة بين وحدتين لا معاملةَ واحدةً تضمّهما اليوم. وهو
-- مسجَّلٌ في `docs/REMAINING_WORK.md`.
--
-- **حدٌّ معلَن ثالث:** `closed` حالةٌ مقبولةٌ في الجدول من 0001 ولا دالّةَ
-- تُنتجها في `src/judiciary/court.mjs` بعد: إغلاقُ القضية بعد الفصل في الاستئناف
-- خطوةٌ لاحقةٌ مسجَّلةٌ لا مُدَّعاةٌ.
--
-- ولا `BEGIN`/`COMMIT` هنا: المُهاجر يفتح المعاملة بنفسه.

-- الصفوفُ السابقةُ تُفحص قبل فرض `NOT NULL`: المدّعي والدعوى واقعتان لا
-- يخترعهما مُهاجر. والجدولُ خاويٌ في كل بيئةٍ اليوم لأنه لم يكن قابلاً للكتابة
-- عبر المستودعات، لكن الفحصَ يقف بدلاً من أن يفترض.
DO $$
DECLARE legacy bigint;
BEGIN
  SELECT count(*) INTO legacy FROM state.cases;

  IF legacy > 0 THEN
    RAISE EXCEPTION
      'الهجرة 0012 موقوفة: % قضيةً سابقةً في الجدول بلا مدّعٍ ولا نصِّ دعوى. المدّعي والدعوى واقعتان لا يخترعهما مُهاجر: صدّرها (scripts/backup.mjs) واملأ claimant وclaim بقرارٍ مسجَّل ثم أعِد الهجرة.',
      legacy;
  END IF;
END $$;

ALTER TABLE state.cases
  ADD COLUMN version state.version_number NOT NULL DEFAULT 1,
  ADD COLUMN created_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN claimant state.entity_id NOT NULL,
  ADD COLUMN claim text NOT NULL CHECK (length(btrim(claim)) > 0),
  ADD COLUMN judge state.entity_id,
  ADD COLUMN reason text,
  ADD COLUMN judged_at timestamptz,
  ADD COLUMN executed_at timestamptz,
  ADD COLUMN executed_effect text CHECK (executed_effect IS NULL OR length(btrim(executed_effect)) > 0),
  ADD COLUMN execution_command_id state.entity_id,
  ADD COLUMN execution_fingerprint_before text
    CHECK (execution_fingerprint_before IS NULL OR length(execution_fingerprint_before) BETWEEN 1 AND 200),
  ADD COLUMN reversed_at timestamptz,
  ADD COLUMN reversal_reason text,
  ADD COLUMN reversal_command_id state.entity_id,
  ADD COLUMN appealed_at timestamptz,
  ADD COLUMN appellant state.entity_id,
  ADD COLUMN appeal_reason text;

COMMENT ON COLUMN state.cases.claimant IS
  'من رفع الدعوى. دعوى بلا مدّعٍ خصومةٌ بلا خصم، ولا يُعرف لمن الاستئنافُ مكفول.';

COMMENT ON COLUMN state.cases.claim IS
  'نصُّ الدعوى. منطوقٌ بلا دعوى مكتوبةٍ حكمٌ لا يُعرف فيماذا صدر.';

COMMENT ON COLUMN state.cases.judge IS
  'القاضي الذي سمع الجلسةَ وحكم. يُكتب عند السماع لا عند الحكم، كي يُقاس أنّ من حكم هو من سمع.';

COMMENT ON COLUMN state.cases.reason IS
  'سببُ الحكم مكتوباً بالحدِّ المُعلَن في config/judiciary.yaml (المادة 11: حكمٌ مُسبَّب).';

COMMENT ON COLUMN state.cases.execution_fingerprint_before IS
  'بصمةُ حال المدّعى عليه قبل التنفيذ. بها وحدها يُقاس أنّ التراجعَ أرجع الحالَ إلى ما كان، لا بإعلانِ تراجع.';

COMMENT ON COLUMN state.cases.execution_command_id IS
  'معرّفُ الأمر الملكيِّ الذي نفَّذ الحكم. لا مفتاحَ أجنبيّاً نحو دفتر الأوامر (انظر رأس الهجرة).';

-- ١. الحكمُ مُسبَّبٌ بسببٍ يبلغ 60 حرفاً، ولا سببَ لقضيةٍ لم يُحكم فيها.
--    الرقمُ 60 مكرَّرٌ هنا وفي `config/judiciary.yaml` و`entities.mjs`، والبوابةُ
--    20 تفحص تطابقَه في الثلاثة: قيدٌ في القاعدة لا يقرأ YAML.
ALTER TABLE state.cases
  ADD CONSTRAINT cases_judgment_reasoned CHECK (
    (verdict IS NOT NULL) = (reason IS NOT NULL AND length(btrim(reason)) >= 60)
  );

-- ٢. الحكمُ مؤرَّخٌ منسوبٌ إلى قاضٍ مسمّى.
ALTER TABLE state.cases
  ADD CONSTRAINT cases_judgment_attributed CHECK (
    (verdict IS NOT NULL) = (judged_at IS NOT NULL AND judge IS NOT NULL)
  );

-- ٣. لا يفصل قاضٍ في قضيةٍ هو طرفٌ فيها.
ALTER TABLE state.cases
  ADD CONSTRAINT cases_judge_not_party CHECK (
    judge IS NULL OR (judge <> claimant AND judge <> subject)
  );

-- ٤. التنفيذُ واقعةٌ كاملة: حكمٌ، وأثرٌ مسمّى، وأمرٌ ملكيّ، وبصمةٌ قبله.
ALTER TABLE state.cases
  ADD CONSTRAINT cases_execution_needs_judgment CHECK (
    CASE
      WHEN executed_at IS NULL THEN
        executed_effect IS NULL
        AND execution_command_id IS NULL
        AND execution_fingerprint_before IS NULL
      ELSE
        verdict IS NOT NULL
        AND executed_effect IS NOT NULL
        AND execution_command_id IS NOT NULL
        AND execution_fingerprint_before IS NOT NULL
        AND executed_at >= judged_at
    END
  );

-- ٥. لا تراجعَ عن تنفيذٍ لم يقع، ولا تراجعَ بلا سببٍ وأمرٍ مسجَّل.
ALTER TABLE state.cases
  ADD CONSTRAINT cases_reversal_needs_execution CHECK (
    CASE
      WHEN reversed_at IS NULL THEN
        reversal_reason IS NULL AND reversal_command_id IS NULL
      ELSE
        executed_at IS NOT NULL
        AND reversed_at >= executed_at
        AND reversal_reason IS NOT NULL
        AND length(btrim(reversal_reason)) >= 40
        AND reversal_command_id IS NOT NULL
    END
  );

-- ٦. الاستئنافُ على حكمٍ صادر، من طرفٍ في القضية، بسببٍ مكتوب.
ALTER TABLE state.cases
  ADD CONSTRAINT cases_appeal_needs_judgment CHECK (
    CASE
      WHEN appealed_at IS NULL THEN
        appellant IS NULL AND appeal_reason IS NULL
      ELSE
        verdict IS NOT NULL
        AND appealed_at >= judged_at
        AND appellant IS NOT NULL
        AND (appellant = claimant OR appellant = subject)
        AND appeal_reason IS NOT NULL
        AND length(btrim(appeal_reason)) >= 40
    END
  );

CREATE INDEX cases_claimant_idx ON state.cases (claimant);
CREATE INDEX cases_judge_idx ON state.cases (judge);
CREATE INDEX cases_executed_idx ON state.cases (executed_at DESC) WHERE executed_at IS NOT NULL;
