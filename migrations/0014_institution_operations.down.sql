-- تراجع الهجرة 0014.
--
-- **يُعيد الحالَ إلى مؤسساتٍ مُعلَنةٍ لا عاملة:** بسقوط الجداول الثلاثة تعود
-- المؤسسةُ اسماً في `seed/institutions.yaml` بحالة `planned`، ولا يبقى في
-- الحالةِ المحفوظةِ أثرٌ لمهمّةٍ استُقبِلت، ولا لوكيلٍ أُسنِد إليه عمل، ولا
-- لميزانيةٍ استُهلِكت، ولا لمخرَجٍ صدر. ومحوُ المخرَج محوُ أثرٍ نُشِر باسم
-- الدولة، ومحوُ المقيَّد من الميزانية يُعيد المُخصَّصَ كاملاً فيصير ما استُهلك
-- كأنّه لم يُستهلَك — وذاك أخطرُ من الفقدان: حدٌّ يُمحى فيُتجاوز بلا أثر.
--
-- ولذلك يُشترط ألّا يكون في الجداول مهمّةٌ نُفِّذت أو رُفضت، ولا مخرَجٌ صدر، ولا
-- مؤسسةٌ قُيِّد من ميزانيتها شيء. والمهامُّ المُستقبَلةُ والمُسنَدةُ وحدَها ليست
-- وقائعَ نهائيةً فلا تمنع التراجع.

DO $$
DECLARE recorded bigint;
BEGIN
  SELECT
    (SELECT count(*) FROM state.institution_tasks
      WHERE executed_at IS NOT NULL OR refused_at IS NOT NULL)
    + (SELECT count(*) FROM state.institution_outputs)
    + (SELECT count(*) FROM state.institutions WHERE budget_consumed > 0)
  INTO recorded;

  IF recorded > 0 THEN
    RAISE EXCEPTION
      'تراجع الهجرة 0014 موقوف: % واقعةً نهائيةً مسجَّلةً (مهامُّ نُفِّذت أو رُفضت، أو مخرجاتٌ صدرت، أو ميزانياتٌ قُيِّد منها). إسقاطُ الجداول يمحو أثراً نُشِر باسم الدولة ويُعيد المُخصَّصَ كاملاً فيصير المستهلَكُ كأنّه لم يُستهلَك. صدّرها (scripts/backup.mjs) ثم أعِد التراجع.',
      recorded;
  END IF;
END $$;

DROP INDEX state.institution_outputs_institution_idx;
DROP INDEX state.institution_tasks_state_idx;
DROP INDEX state.institution_tasks_institution_idx;

DROP TABLE state.institution_outputs;
DROP TABLE state.institution_tasks;
DROP TABLE state.institutions;
