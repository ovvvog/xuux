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

ALTER TABLE state.laws
  ADD COLUMN article_id text
    CHECK (article_id IS NULL OR article_id ~ '^art:[0-9]{2}$'),
  ADD COLUMN policy_ids text[]
    CHECK (
      policy_ids IS NULL
      OR (
        array_length(policy_ids, 1) >= 1
        AND array_position(policy_ids, NULL) IS NULL
        AND NOT EXISTS (SELECT 1 FROM unnest(policy_ids) AS value WHERE btrim(value) = '')
      )
    );

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
