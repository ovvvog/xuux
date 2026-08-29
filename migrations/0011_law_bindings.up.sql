-- الهجرة 0011 — ربطُ القانون بسنَده وبأداةِ إنفاذه (الخطوة M8.02).
--
-- **العيبُ الذي تعالجه:** كان جدولُ `state.laws` يحمل نصّاً حرّاً (`body`) وحالةً
-- وسلطةَ نفاذٍ ووقتَه، ولا يحمل **شيئاً يربط النصَّ بالإنفاذ**: لا مادةً
-- دستوريةً تسنده، ولا سياسةً تُنفِّذه. فكان القانونُ «النافذ» صفّاً لا يقرؤه
-- قرارٌ واحدٌ في الدولة: نقطةُ التفويض تقرأ `config/policies.yaml`، والقوانينُ
-- في جدولٍ لا يمرُّ به مسارُ قرار. وهذان العمودان هما الشطرُ الغائب.
--
-- **ولماذا `text[]` لا `jsonb` في `policy_ids`؟** لأن القيمةَ قائمةُ معرّفاتٍ
-- نصّيةٍ لا شكلٌ حرّ، و`jsonb` كان سيقبل كائناً أو رقماً أو تعشيشاً، فيُنقل
-- التحقّقُ من القاعدة إلى القارئ. والمصفوفةُ النصّية تُفرض في القاعدة نفسِها.
--
-- **والقيدُ الحقيقيُّ هو `laws_enacted_requires_binding`:** لا يَنفُذ صفٌّ بلا
-- مادةٍ وبلا سياسةٍ واحدةٍ على الأقل. وهو ما يجعل «قانونٌ نافذٌ فعلاً» شرطاً
-- تفرضه القاعدةُ لا اصطلاحاً في الكود: من كتب في الجدول مباشرةً بلا ربطٍ رُدَّ.
--
-- **حدٌّ معلَن أول:** لا مفتاحَ أجنبيّاً على `article_id` ولا على عناصر
-- `policy_ids`: المادةُ الدستوريةُ في ملفٍ موقَّع (`config/constitution.yaml`
-- ومخزنُ الدستور)، والسياسةُ في `config/policies.yaml` — وكلاهما **ليس جدولاً**
-- في هذه القاعدة. فالربطُ يُفرض شكلاً هنا ومحتوىً في
-- `src/legislation/legislature.mjs` (رمزا `LEGISLATION_ARTICLE_UNKNOWN`
-- و`LEGISLATION_POLICY_UNKNOWN`)، والحاجزُ 19 يحرس ألّا يسقط الفحص. ونقلُ
-- الوثيقتين إلى جدولين قرارٌ معماريٌّ لم يُتخذ، وهو مسجَّل في
-- `docs/REMAINING_WORK.md`.
--
-- **حدٌّ معلَن ثانٍ:** الصفوفُ النافذةُ السابقةُ لهذه الهجرة — إن وُجدت — تخالف
-- القيدَ الجديد، ولذلك يُنفَّذ القيدُ بعد فحصٍ يقف إن وجد صفّاً كذلك. ولا
-- يُملأ العمودان بقيمةٍ مُخترعة: ربطٌ يخترعه المُهاجر ربطٌ لا مشرِّعَ له.
--
-- ولا `BEGIN`/`COMMIT` هنا: المُهاجر يفتح المعاملة بنفسه.

-- **عيبان حقيقيان في أوّلِ صياغةِ هذه الهجرة، شُخِّصا على PostgreSQL 18.6 فعليٍّ
-- وأُصلحا في `WL-044`** — ولم تكن الهجرةُ قد شُغِّلت على قاعدةٍ حقيقيةٍ قبلها قطُّ:
--
-- ١. `NOT EXISTS (SELECT …)` **داخل قيدِ `CHECK`** ⇒ ‏`0A000 cannot use subquery in
--    check constraint`. القاعدةُ ترفضه رفضاً محتوماً، فكان القيدُ نصّاً لا يُنشأ
--    أصلاً — وأبقى مسارَ CI أحمرَ من يومِ إضافةِ هذه الهجرة. والاستعلامُ الفرعيُّ
--    مسموحٌ **داخل دالّةٍ `IMMUTABLE`** يُنادى من القيد، فنُقل إلى موضعِه المشروع.
--
-- ٢. `array_position(policy_ids, NULL) IS NULL` **قيدٌ زخرفيٌّ لا يمنع شيئاً:**
--    ‏`array_position` صارمةٌ (`STRICT`) فمُدخلٌ `NULL` يُخرِج `NULL` دائماً، أي أن
--    الشرطَ يصدُق أبداً ولو حمل المصفوفُ عنصراً معدوماً. والصحيحُ `array_positions`
--    ‏— وهي غيرُ صارمةٍ في المطلوبِ وتَجِد المعدومَ فعلاً.
--
-- **ولم يُصلَح الأولُ بحذفِ الشرط:** «سياسةٌ باسمٍ فارغ» صفٌّ يجعل القانونَ يبدو
-- منفَّذاً ولا سياسةَ له. فالضابطُ يبقى، ويُنقل إلى حيث تسمح القاعدةُ بتنفيذِه.

-- والوسيطُ `items` لا `values`: ‏`VALUES` كلمةٌ محجوزةٌ في SQL، واستعمالُها اسماً
-- يُخفِق بـ`42601` — أُصلح في نفسِ التشغيلِ الذي كشفه.
CREATE FUNCTION state.text_array_is_named(items text[]) RETURNS boolean
  LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
  AS $fn$
    SELECT array_length(items, 1) >= 1
       AND array_positions(items, NULL) = '{}'::int[]
       AND NOT EXISTS (SELECT 1 FROM unnest(items) AS item WHERE btrim(item) = '')
  $fn$;

COMMENT ON FUNCTION state.text_array_is_named(text[]) IS
  'مصفوفةُ نصوصٍ غيرُ فارغةٍ ولا تحمل عنصراً معدوماً ولا عنصراً فارغَ الاسم. موضعُها دالّةٌ لأن القيدَ لا يقبل استعلاماً فرعيّاً — لا لأن الضابطَ اختياريّ.';

ALTER TABLE state.laws
  ADD COLUMN article_id text
    CHECK (article_id IS NULL OR article_id ~ '^art:[0-9]{2}$'),
  ADD COLUMN policy_ids text[]
    CHECK (policy_ids IS NULL OR state.text_array_is_named(policy_ids));

COMMENT ON COLUMN state.laws.article_id IS
  'المادةُ الدستوريةُ التي يستند إليها القانون. لا مفتاحَ أجنبيّاً: الدستورُ ملفٌّ موقَّعٌ لا جدول (انظر رأس الهجرة).';

COMMENT ON COLUMN state.laws.policy_ids IS
  'معرّفاتُ السياسات التي تُنفِّذ القانون. قانونٌ نافذٌ بلا سياسةٍ نصٌّ لا أثرَ له في قرار.';

-- الصفوفُ النافذةُ السابقة تُفحص قبل فرض القيد: الهجرةُ تقف ولا تخترع ربطاً.
DO $$
DECLARE unbound bigint;
BEGIN
  SELECT count(*) INTO unbound
  FROM state.laws
  WHERE status = 'enacted' AND (article_id IS NULL OR policy_ids IS NULL);

  IF unbound > 0 THEN
    RAISE EXCEPTION
      'الهجرة 0011 موقوفة: % قانوناً نافذاً بلا ربطٍ بمادةٍ وسياسة. الربطُ قرارٌ تشريعيٌّ يُوقَّع، ولا يخترعه مُهاجر: اربطها عبر src/legislation/legislature.mjs أو علّقها بأمرٍ ملكيّ، ثم أعِد الهجرة.',
      unbound;
  END IF;
END $$;

ALTER TABLE state.laws
  ADD CONSTRAINT laws_enacted_requires_binding CHECK (
    status <> 'enacted' OR (article_id IS NOT NULL AND policy_ids IS NOT NULL)
  );

CREATE INDEX laws_article_idx ON state.laws (article_id);
