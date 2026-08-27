-- الهجرة 0013 — فصلُ المصالح والمراجعةُ البشرية (الخطوة M8.04).
--
-- **العيبُ الذي تعالجه:** بعد الهجرة 0012 صار في الجدول قاضٍ وسببٌ وتنفيذٌ
-- وتراجعٌ واستئناف، وقيدٌ واحدٌ للمصالح: `cases_judge_not_party` — وهو يمنع
-- أفجرَ صورةٍ للتعارض (أن يكون القاضي هو المدّعيَ أو المدّعى عليه) ويترك ما هو
-- أقربُ إلى الواقع: أن يكون القاضي **مالكَ هويةِ** خصمٍ في القضية، أو هويةً
-- يملكها خصم، أو أن يعود قاضٍ تنحّى. وليس في الجدول **أثرٌ للمراجعة البشرية**
-- أصلاً: كان الحكمُ الحسّاس (منطوقُه `guilty` أو أثرُه إيقافُ وكيل) يُنفَّذ بأمرٍ
-- ملكيٍّ صحيحٍ بلا قارئٍ بشريٍّ واحد، وهو ما تنقضه العدالةُ الإجرائية: أثرٌ يمسّ
-- حقّاً ويقع بلا بشرٍ يُسأل عنه أثرٌ لا مسؤولَ له.
--
-- ولذلك تُضاف ستةُ أعمدة: أربعةٌ للمراجعة (وقتُها، ومن راجع، وبماذا قرَّر، ولماذا)
-- واثنان للتنحي (من تنحّى، ولماذا). وأربعةُ قيودٍ مسمّياتُها تُطابق ثوابتَ
-- `CASE_SPEC` في `src/persistence/entities.mjs` واحداً بواحد، والبوابةُ 20
-- (`scripts/guard-judiciary.mjs`) تحرس ألّا يسقط أحدُ الطرفين دون الآخر.
--
-- **حدٌّ معلَن أول:** بشريةُ المراجع **لا تُفرض في القاعدة**. لا مفتاحَ أجنبيّاً
-- من `reviewer` نحو `state.agents` ولا قيدَ يقرأ `agents.kind = 'human'`: القيدُ
-- الجدوليُّ لا يقرأ جدولاً آخر (والمُشغِّلاتُ ليست قيوداً بل كودٌ يُطفأ). فالبشريةُ
-- مفروضةٌ في `Judiciary.ratify` بقراءة سجلِّ الهويات، والقاعدةُ تفرض ما تقدر
-- عليه: أنّ المراجعَ مسمّىً، وليس القاضيَ ولا خصماً، وأنّ سببَه مكتوبٌ بالحدّ.
--
-- **حدٌّ معلَن ثانٍ:** قواعدُ التعارض غيرُ المباشرة (مالكُ الخصم، المالكُ الواحد،
-- إعادةُ النظر بعد الاستئناف) مفروضةٌ في `src/judiciary/interests.mjs` وحدَه ولا
-- تُفرض في القاعدة لنفس السبب: كلُّها تقتضي قراءةَ `state.agents` من قيدٍ على
-- `state.cases`. والقاعدةُ تفرض من قواعد التعارض ما لا يحتاج جدولاً آخر: أن لا
-- يجلس من تنحّى (`cases_judge_not_recused`) وأن لا يكون القاضي طرفاً (قيدُ 0012).
--
-- **حدٌّ معلَن ثالث — لم تُطبَّق:** الهجرات 0005–0013 لم تُشغَّل على PostgreSQL
-- حقيقيٍّ في هذا المستودع بعد؛ صحّتُها مقروءةٌ لا مُختبَرة، و86 اختباراً
-- متعلّقاً بالقاعدة يُتخطّى اليوم. وهو مسجَّلٌ في `docs/REMAINING_WORK.md`.
--
-- ولا `BEGIN`/`COMMIT` هنا: المُهاجر يفتح المعاملة بنفسه.

ALTER TABLE state.cases
  ADD COLUMN reviewed_at timestamptz,
  ADD COLUMN reviewer state.entity_id,
  ADD COLUMN review_decision text
    CHECK (review_decision IS NULL OR review_decision IN ('approved', 'rejected')),
  ADD COLUMN review_reason text,
  ADD COLUMN recused_judges text[] NOT NULL DEFAULT '{}'
    CHECK (array_position(recused_judges, NULL) IS NULL),
  ADD COLUMN recusal_reason text;

COMMENT ON COLUMN state.cases.reviewer IS
  'من راجع الحكمَ الحسّاس قبل تنفيذه. بشريتُه مفروضةٌ في Judiciary.ratify لا في القاعدة (انظر رأس الهجرة).';

COMMENT ON COLUMN state.cases.review_decision IS
  'قرارُ المراجعة: approved أو rejected. وغيابُه مع حكمٍ حسّاسٍ يمنع التنفيذَ برمز JUDICIARY_HUMAN_REVIEW_REQUIRED.';

COMMENT ON COLUMN state.cases.recused_judges IS
  'من تنحّى عن القضية. قيدٌ دائم: لا يعود المتنحّي قاضياً فيها، وعودتُه تُفرغ التنحي من معناه.';

-- ١. المراجعةُ واقعةٌ كاملة: حكمٌ قبلها، ومراجعٌ مسمّى ليس قاضياً ولا خصماً،
--    وقرارٌ، وسببٌ يبلغ 60 حرفاً. والرقمُ 60 مكرَّرٌ هنا وفي `config/judiciary.yaml`
--    (`review.minReviewReasonLength`) وفي `entities.mjs`
--    (`CASE_MIN_REVIEW_REASON_LENGTH`)، والبوابةُ 20 تفحص تطابقَه في الثلاثة.
ALTER TABLE state.cases
  ADD CONSTRAINT cases_review_complete CHECK (
    CASE
      WHEN reviewed_at IS NULL THEN
        reviewer IS NULL
        AND review_decision IS NULL
        AND review_reason IS NULL
      ELSE
        judged_at IS NOT NULL
        AND reviewed_at >= judged_at
        AND review_decision IS NOT NULL
        AND review_reason IS NOT NULL
        AND length(btrim(review_reason)) >= 60
        AND reviewer IS NOT NULL
        AND reviewer <> judge
        AND reviewer <> claimant
        AND reviewer <> subject
    END
  );

-- ٢. لا يُنفَّذ حكمٌ رُفضت مراجعتُه. وهذا هو القيدُ الذي يجعل «الرفضَ» رفضاً:
--    لو غاب لصار قرارُ المراجعة حرفاً يُكتب ثم يُنفَّذ الحكمُ على خلافه.
ALTER TABLE state.cases
  ADD CONSTRAINT cases_execution_not_rejected CHECK (
    executed_at IS NULL OR review_decision IS DISTINCT FROM 'rejected'
  );

-- ٣. لا يجلس للقضية من تنحّى عنها.
ALTER TABLE state.cases
  ADD CONSTRAINT cases_judge_not_recused CHECK (
    judge IS NULL OR judge <> ALL (recused_judges)
  );

-- ٤. التنحي مُسبَّبٌ بسببٍ يبلغ 40 حرفاً، ولا سببَ تنحٍّ لقضيةٍ لم يتنحَّ عنها أحد.
ALTER TABLE state.cases
  ADD CONSTRAINT cases_recusal_reasoned CHECK (
    (array_length(recused_judges, 1) IS NOT NULL)
    = (recusal_reason IS NOT NULL AND length(btrim(recusal_reason)) >= 40)
  );

CREATE INDEX cases_reviewer_idx ON state.cases (reviewer) WHERE reviewer IS NOT NULL;
