-- تراجع الهجرة 0015.
--
-- **يُعيد الحالَ إلى مؤسساتٍ تعمل بلا حدٍّ مُعلَن:** بسقوط الجداول الثلاثة يعود
-- الاختصاصُ نصّاً في وثيقةٍ لا يمنع فعلاً، ولا يبقى في الحالةِ المحفوظةِ أثرٌ
-- لمخالفةٍ سُجِّلت على مؤسسةٍ تجاوزت اختصاصَها، ولا لدورةٍ تقريريةٍ أُغلِقت.
-- ومحوُ المخالفةِ محوُ **مادّةِ المساءلة** نفسِها: تصير المؤسسةُ التي تجاوزت
-- كأنّها لم تتجاوز، ويصير التقريرُ الدوريُّ الذي أُقِرَّ كأنّه لم يُقَرّ. وذاك
-- أخطرُ من الفقدان: حدٌّ يُمحى فيُتجاوز بلا أثر.
--
-- ولذلك يُشترط ألّا تكون في الجداول مخالفةٌ مسجَّلةٌ ولا دورةٌ مُغلَقة. وصفوفُ
-- نموذجِ التشغيل وحدَها ليست وقائعَ نهائيةً — تُعاد بالإنفاذ من الوثيقة نفسِها —
-- فلا تمنع التراجع.
--
-- وعمود `domain` في `state.institution_tasks` يُنزع مع قيده: مجالٌ مُعلَنٌ في
-- صفوفٍ قائمةٍ يُفقَد بذلك، ولذلك يُنزع **بعد** التحقّق أعلاه لا قبله.

DO $$
DECLARE recorded bigint;
BEGIN
  SELECT
    (SELECT count(*) FROM state.institution_breaches)
    + (SELECT count(*) FROM state.institution_report_cycles)
  INTO recorded;

  IF recorded > 0 THEN
    RAISE EXCEPTION
      'تراجع الهجرة 0015 موقوف: % واقعةً نهائيةً مسجَّلةً (مخالفاتُ اختصاصٍ أو دوراتٌ تقريريةٌ أُغلِقت). إسقاطُ الجداول يمحو مادّةَ المساءلة فتصير المؤسسةُ التي تجاوزت كأنّها لم تتجاوز. صدّرها (scripts/backup.mjs) ثم أعِد التراجع.',
      recorded;
  END IF;
END $$;

DROP INDEX state.institution_tasks_domain_idx;
DROP INDEX state.institution_report_cycles_institution_idx;
DROP INDEX state.institution_breaches_institution_idx;

ALTER TABLE state.institution_tasks
  DROP CONSTRAINT institution_tasks_domain_declared;
ALTER TABLE state.institution_tasks
  DROP COLUMN domain;

DROP TABLE state.institution_report_cycles;
DROP TABLE state.institution_breaches;
DROP TABLE state.institution_mandates;
