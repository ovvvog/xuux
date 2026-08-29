-- تراجع الهجرة 0011.
--
-- **يُعيد الحالَ إلى قانونٍ بلا إنفاذٍ بإعلانه:** بسقوط العمودين يعود «القانونُ
-- النافذ» صفّاً لا يربطه بمادةٍ سندٌ ولا بسياسةٍ أداةُ إنفاذ، ويسقط معه القيدُ
-- `laws_enacted_requires_binding` — أي يصير النفاذُ ممكناً بلا ربطٍ من جديد،
-- ويصير معيارُ القبول «قانونٌ نافذٌ فعلاً» غيرَ محقَّق.
--
-- ومعه **يُفقد الربطُ نفسُه**: أيُّ مادةٍ سنَدت أيَّ قانونٍ وأيُّ سياسةٍ نفّذته.
-- وهذا فقدُ قرارٍ تشريعيٍّ مُوقَّعٍ لا فقدُ حقلٍ تقني، ولهذا يُشترط ألّا يكون في
-- الجدول قانونٌ نافذٌ مربوط: إسقاطُ ربطِ نافذٍ يجعل الدولةَ تُنفِّذ سياسةً بلا
-- أن يُعرف بأيِّ قانونٍ تُنفَّذ.

DO $$
DECLARE bound bigint;
BEGIN
  SELECT count(*) INTO bound
  FROM state.laws
  WHERE article_id IS NOT NULL OR policy_ids IS NOT NULL;

  IF bound > 0 THEN
    RAISE EXCEPTION
      'تراجع الهجرة 0011 موقوف: % قانوناً يحمل ربطاً بمادةٍ أو سياسة. إسقاطُ العمودين يمحو سندَ النفاذ وأداتَه، فتُنفَّذ سياساتٌ بلا قانونٍ يُعرف. صدّرها (scripts/backup.mjs) وعلّق القوانينَ بأمرٍ ملكيٍّ ثم أعِد التراجع.',
      bound;
  END IF;
END $$;

DROP INDEX state.laws_article_idx;

ALTER TABLE state.laws
  DROP CONSTRAINT laws_enacted_requires_binding;

ALTER TABLE state.laws
  DROP COLUMN policy_ids,
  DROP COLUMN article_id;

-- والدالّةُ تُسقط بعد القيدِ الذي يناديها، لا قبله.
DROP FUNCTION state.text_array_is_named(text[]);
