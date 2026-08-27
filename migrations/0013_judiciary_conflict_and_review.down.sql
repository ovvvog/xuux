-- تراجع الهجرة 0013.
--
-- **يُعيد الحالَ إلى تنفيذٍ بلا قارئٍ بشريٍّ واحد:** بسقوط أعمدة المراجعة يصير
-- الحكمُ الحسّاس (منطوقُه `guilty` أو أثرُه إيقافُ وكيل) قابلاً للتنفيذ بأمرٍ
-- ملكيٍّ صحيحٍ ولا أثرَ في الجدول لمن قرأه من البشر — ويصير قرارُ الرفض نفسُه
-- غيرَ قابلٍ للتسجيل، فلا يمنع تنفيذاً. وبسقوط `recused_judges` يعود القاضي
-- المتنحّي إلى القضية التي تنحّى عنها ولا شيءَ في القاعدة يمنعه.
--
-- ولذلك يُشترط ألّا تكون في الجدول مراجعةٌ أو تنحٍّ مسجَّل: إسقاطُ الأعمدة يمحو
-- شهادةَ بشرٍ على حكمٍ وسببَ تنحٍّ، وهما واقعتان إجرائيتان لا حقلان تقنيّان.
-- ومحوُ المراجعة يُفقد الأثرَ الذي يُقاس به أنّ الحكمَ الحسّاس قُرئ قبل تنفيذه.

DO $$
DECLARE recorded bigint;
BEGIN
  SELECT count(*) INTO recorded
  FROM state.cases
  WHERE reviewed_at IS NOT NULL
     OR recusal_reason IS NOT NULL
     OR array_length(recused_judges, 1) IS NOT NULL;

  IF recorded > 0 THEN
    RAISE EXCEPTION
      'تراجع الهجرة 0013 موقوف: % قضيةً فيها مراجعةٌ بشريةٌ أو تنحٍّ مسجَّل. إسقاطُ الأعمدة يمحو شهادةَ بشرٍ على حكمٍ حسّاسٍ وسببَ تنحٍّ، وهما واقعتان إجرائيتان لا حقلان تقنيّان. صدّرها (scripts/backup.mjs) ثم أعِد التراجع.',
      recorded;
  END IF;
END $$;

DROP INDEX state.cases_reviewer_idx;

ALTER TABLE state.cases
  DROP CONSTRAINT cases_recusal_reasoned,
  DROP CONSTRAINT cases_judge_not_recused,
  DROP CONSTRAINT cases_execution_not_rejected,
  DROP CONSTRAINT cases_review_complete;

ALTER TABLE state.cases
  DROP COLUMN recusal_reason,
  DROP COLUMN recused_judges,
  DROP COLUMN review_reason,
  DROP COLUMN review_decision,
  DROP COLUMN reviewer,
  DROP COLUMN reviewed_at;
