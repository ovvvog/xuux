-- تراجع الهجرة 0012.
--
-- **يُعيد الحالَ إلى قضاءٍ بلا مُدَّعٍ ولا سببٍ ولا تنفيذ:** بسقوط هذه الأعمدة
-- يعود الجدولُ إلى ثمانيةِ أعمدةٍ تُسجّل منطوقاً بلا من ادّعى ولا لماذا حُكم ولا
-- ماذا نُفِّذ، فتسقط المادةُ 11 عمليّاً: حكمٌ غيرُ مُسبَّبٍ يصير مقبولاً في
-- القاعدة، واستئنافٌ من غير طرفٍ يصير مقبولاً، وتنفيذُ الحكم يصير غيرَ ممكنِ
-- التسجيل أصلاً.
--
-- وأخطرُ من ذلك أنّ سقوطَ `version` و`created_at` و`updated_at` **يُخرج الجدولَ
-- من متناول المستودعات** كما كان: لا قفلَ تفاؤليّاً، فلا كتابةَ آمنةً متزامنة.
-- أي أنّ هذا التراجع لا يُعيد ميزةً بل يُعيد جدولاً ميّتاً.
--
-- ولذلك يُشترط ألّا تكون في الجدول قضيةٌ واحدة: إسقاطُ الأعمدة يمحو الدعوى
-- والسببَ والتنفيذَ والتراجعَ والاستئنافَ — وهي وقائعُ قضائيةٌ لا حقولٌ تقنية،
-- ومحوُها يُفقد الأثرَ الذي يُقاس به أنّ تنفيذاً وقع أو رُوجِع.

DO $$
DECLARE recorded bigint;
BEGIN
  SELECT count(*) INTO recorded FROM state.cases;

  IF recorded > 0 THEN
    RAISE EXCEPTION
      'تراجع الهجرة 0012 موقوف: % قضيةً في الجدول. إسقاطُ الأعمدة يمحو المدّعيَ والدعوى وسببَ الحكم وتنفيذَه وتراجعَه واستئنافَه، وهي وقائعُ قضائيةٌ موقَّعةٌ لا حقولٌ تقنية. صدّرها (scripts/backup.mjs) ثم أعِد التراجع.',
      recorded;
  END IF;
END $$;

DROP INDEX state.cases_executed_idx;
DROP INDEX state.cases_judge_idx;
DROP INDEX state.cases_claimant_idx;

ALTER TABLE state.cases
  DROP CONSTRAINT cases_appeal_needs_judgment,
  DROP CONSTRAINT cases_reversal_needs_execution,
  DROP CONSTRAINT cases_execution_needs_judgment,
  DROP CONSTRAINT cases_judge_not_party,
  DROP CONSTRAINT cases_judgment_attributed,
  DROP CONSTRAINT cases_judgment_reasoned;

ALTER TABLE state.cases
  DROP COLUMN appeal_reason,
  DROP COLUMN appellant,
  DROP COLUMN appealed_at,
  DROP COLUMN reversal_command_id,
  DROP COLUMN reversal_reason,
  DROP COLUMN reversed_at,
  DROP COLUMN execution_fingerprint_before,
  DROP COLUMN execution_command_id,
  DROP COLUMN executed_effect,
  DROP COLUMN executed_at,
  DROP COLUMN judged_at,
  DROP COLUMN reason,
  DROP COLUMN judge,
  DROP COLUMN claim,
  DROP COLUMN claimant,
  DROP COLUMN updated_at,
  DROP COLUMN created_at,
  DROP COLUMN version;
