-- الهجرة 0018 — التقاريرُ الملكيةُ الدورية: تقريرٌ مُولَّدٌ من صفوفٍ مقيسة،
-- مُراجَعٌ بشريّاً، مُنشَرٌ بأمرٍ ملكيٍّ (الخطوة M8.09).
--
-- **العيبُ الذي تعالجه:** لم يكن في القاعدةِ جدولٌ لتقريرِ **الدولة**. الموجودُ
-- `state.institution_report_cycles` (الهجرة 0015) وهو تقريرُ **مؤسسةٍ واحدةٍ**
-- عن دورتها: مهامُها وتجاوزاتُها وما استهلكته من ميزانيتها. فلا موضعَ يُقرأ منه
-- حالُ الدولةِ ومخاطرُها ومخالفاتُها وتكلفتُها مجتمعةً، ولا موضعَ يُميّز رقماً
-- **قِيس من صفوف** عن رقمٍ **قُدِّر** — وذاك بعينه ما يجعل تقريراً كاملَ الشكلِ
-- مُضلِّلاً: يُقرأ كلُّه قياساً وبعضُه تخمين.
--
-- ولذلك يُنشأ جدولٌ واحد: `state.royal_reports` — صفٌّ لكلِّ تقريرٍ دوريٍّ،
-- يحمل نافذتَه (بدايةً ونهايةً) ومن ولّده ومتى، وعددَ حقولِه المعلَنةِ والمقيسةِ
-- والتقديرية، و**بصمةَ القياس** التي يُعاد القياسُ إليها عند النشر، وأقسامَه
-- بحقولها كما قِيست، ثم مراجعتَها البشريةَ وأمرَ نشرها.
--
-- ومُسمَّياتُ القيود تُطابق ثوابتَ `ROYAL_REPORT_SPEC` في
-- `src/persistence/entities.mjs` واحداً بواحد، والبوابةُ 25
-- (`scripts/guard-reports.mjs`) تحرس ألّا يسقط أحدُ الطرفين دون الآخر.
--
-- **حدٌّ معلَن أول — التقديرُ مُعلَنٌ في الصفِّ لا في التعليق:** قيدُ
-- `royal_reports_estimates_declared` يفرض على كلِّ حقلٍ في `sections` أحدَ شكلين
-- لا ثالثَ لهما: مقيسٌ له `measuredFrom` غيرُ فارغٍ و`rowCount` غيرُ سالب، أو
-- تقديريٌّ له `assumption` لا تقلّ عن ستين حرفاً وقيمتُه `null`. فحقلٌ بلا مصدرٍ
-- ولا فرضيةٍ **يُرفض في القاعدة** لا في الكودِ وحدَه، وهذا هو معيارُ القبول:
-- «بلا حقولٍ تقديريةٍ غيرِ معلَنة».
--
-- **حدٌّ معلَن ثانٍ — النشرُ بعد مراجعةٍ قابلةٍ وبأمرٍ:** قيدُ
-- `royal_reports_publish_requires_review` يفرض أنّ المنشورَ له معرّفُ أمرٍ ووقتُ
-- نشرٍ وقرارُ مراجعةٍ `accept`، وأنّ غيرَ المنشورِ لا معرّفَ أمرٍ له. فلا يُخضَّر
-- نشرٌ بكتابةِ حالٍ في عمود.
--
-- **حدٌّ معلَن ثالث — البصمةُ تُحفظ ليُكتشف البيات:** `digest` بصمةُ القياسِ عند
-- التوليد. وعند النشرِ يُعاد القياسُ على النافذةِ المحفوظةِ بعينها، فإن خالفت
-- البصمةُ رُدَّ التقريرُ بـ`REPORTS_STALE`. والقاعدةُ تحفظ البصمةَ ولا تُعيد
-- القياس: إعادةُ القياسِ عملُ الوحدةِ لا عملُ قيد.
--
-- **حدٌّ معلَن رابع — لم تُطبَّق:** الهجرات 0005–0018 لم تُشغَّل على PostgreSQL
-- حقيقيٍّ في هذا المستودع بعد؛ صحّةُ هذه القيود مقروءةٌ لا مُختبَرة. وهو
-- مسجَّلٌ في `docs/REMAINING_WORK.md`.
--
-- ولا `BEGIN`/`COMMIT` هنا: المُهاجر يفتح المعاملة بنفسه.

CREATE TABLE state.royal_reports (
  id state.entity_id PRIMARY KEY,
  report_id text NOT NULL,
  period_start timestamptz NOT NULL,
  period_end timestamptz NOT NULL,
  generated_by text NOT NULL CHECK (generated_by ~ '^role:[a-z-]+$'),
  generated_at timestamptz NOT NULL,
  state text NOT NULL CHECK (state IN ('generated', 'reviewed', 'rejected', 'published')),
  fields_declared integer NOT NULL CHECK (fields_declared > 0),
  fields_measured integer NOT NULL CHECK (fields_measured >= 0),
  fields_estimated integer NOT NULL CHECK (fields_estimated >= 0),
  digest text NOT NULL CHECK (digest ~ '^[0-9a-f]{64}$'),
  sections jsonb NOT NULL,
  reviewer text,
  review_decision text CHECK (review_decision IN ('accept', 'reject')),
  review_reason text,
  reviewed_at timestamptz,
  publish_command_id text,
  published_at timestamptz,
  model_version integer NOT NULL CHECK (model_version > 0),
  version state.version_number NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- ١. تقريرٌ واحدٌ لمعرّفٍ واحد: المعرّفُ لا يتكرّر، فلا تقريران يُقرأ أحدُهما
  --    تصحيحاً للآخر بلا إعلان.
  CONSTRAINT royal_reports_id_once UNIQUE (report_id),
  -- ٢. النافذةُ تبدأُ قبل أن تنتهي، والتوليدُ بعد انقضائها. وتقريرٌ يُولَّد قبل
  --    انتهاءِ مدّتِه تقريرٌ عن مدّةٍ لم تكتمل.
  CONSTRAINT royal_reports_period_ordered CHECK (
    period_end > period_start AND generated_at >= period_end
  ),
  -- ٣. مجموعُ المقيسِ والتقديريِّ هو عددُ الحقولِ المعلَنة. وتقريرٌ لا يُغطّي
  --    حقولَه المعلَنةَ تقريرٌ ناقصٌ يُقرأ كاملاً.
  CONSTRAINT royal_reports_fields_measured CHECK (
    fields_measured + fields_estimated = fields_declared
  ),
  -- ٤. الأقسامُ مصفوفةٌ غيرُ فارغةٍ طولُها عددُ الحقولِ المعلَنة.
  CONSTRAINT royal_reports_sections_shaped CHECK (
    jsonb_typeof(sections) = 'array'
    AND jsonb_array_length(sections) = fields_declared
  ),
  -- ٥. كلُّ حقلٍ إمّا مقيسٌ بمصدرٍ مُسمّىً وعددِ صفوفٍ غيرِ سالب، وإمّا تقديريٌّ
  --    بفرضيةٍ لا تقلّ عن ستين حرفاً وقيمةٍ غيرِ معروفة. ولا حقلَ ثالثاً: حقلٌ
  --    بلا مصدرٍ ولا فرضيةٍ حقلٌ تقديريٌّ غيرُ معلَن، وهو ما جاءت الخطوةُ لمنعه.
  CONSTRAINT royal_reports_estimates_declared CHECK (
    NOT EXISTS (
      SELECT 1
      FROM jsonb_array_elements(sections) AS field
      WHERE NOT (
        (
          (field->>'estimated')::boolean IS TRUE
          AND length(btrim(coalesce(field->>'assumption', ''))) >= 60
          AND jsonb_typeof(field->'value') = 'null'
        )
        OR (
          (field->>'estimated')::boolean IS FALSE
          AND length(btrim(coalesce(field->>'measuredFrom', ''))) > 0
          AND (field->>'rowCount')::bigint >= 0
          AND (
            jsonb_typeof(field->'value') IN ('number', 'string')
            OR (
              jsonb_typeof(field->'value') = 'null'
              AND (field->>'rowCount')::bigint = 0
            )
          )
        )
      )
    )
  ),
  -- ٦. المراجعةُ كاملةٌ أو غائبةٌ كلُّها، والغائبةُ لا تكون إلا لتقريرٍ مُولَّدٍ
  --    بعد. ومراجعةٌ نصفُها مكتوبٌ مراجعةٌ لا يُعرف من أجراها ولا بأيِّ موجب.
  CONSTRAINT royal_reports_review_bound CHECK (
    (
      reviewer IS NULL
      AND review_decision IS NULL
      AND review_reason IS NULL
      AND reviewed_at IS NULL
      AND state = 'generated'
    )
    OR (
      reviewer IS NOT NULL
      AND review_decision IS NOT NULL
      AND length(btrim(review_reason)) >= 60
      AND reviewed_at IS NOT NULL
      AND reviewed_at >= generated_at
    )
  ),
  -- ٧. المنشورُ له أمرُ نشرٍ ووقتُه ومراجعةٌ قابلة، وغيرُ المنشورِ لا أمرَ نشرٍ
  --    له ولا وقت. ونشرٌ بلا أمرٍ نشرٌ بلا سلطة.
  CONSTRAINT royal_reports_publish_requires_review CHECK (
    (
      state <> 'published'
      AND publish_command_id IS NULL
      AND published_at IS NULL
    )
    OR (
      state = 'published'
      AND publish_command_id IS NOT NULL
      AND published_at IS NOT NULL
      AND review_decision = 'accept'
      AND published_at >= reviewed_at
    )
  ),
  -- ٨. القرارُ يوافق الحال: قبولٌ لا يُقرأ منه تقريرٌ مرفوض، ورفضٌ لا يُقرأ منه
  --    مُراجَعٌ ولا منشور.
  CONSTRAINT royal_reports_decision_matches_state CHECK (
    review_decision IS NULL
    OR (review_decision = 'reject' AND state = 'rejected')
    OR (review_decision = 'accept' AND state IN ('reviewed', 'published'))
  )
);

COMMENT ON TABLE state.royal_reports IS
  'التقاريرُ الملكيةُ الدورية: صفٌّ لكلِّ تقريرٍ عن نافذةٍ مُعلَنة، حالُ الدولةِ ومخاطرُها ومخالفاتُها وتكلفتُها. كلُّ حقلٍ فيه مقيسٌ بمصدرٍ مُسمّى أو تقديريٌّ بفرضيةٍ مكتوبة، ولا حقلَ ثالثاً؛ ولا يُنشر إلا بمراجعةٍ بشريةٍ وأمرٍ ملكيٍّ وإعادةِ قياسٍ تُطابق البصمة.';

COMMENT ON COLUMN state.royal_reports.digest IS
  'بصمةُ القياسِ عند التوليد. وعند النشرِ يُعاد القياسُ على النافذةِ المحفوظةِ نفسِها، فإن خالفت البصمةُ رُدَّ التقريرُ بائتاً (REPORTS_STALE) ولم يُنشر: تقريرٌ يُنشر بعد أن تغيّرت الصفوفُ تقريرٌ عن دولةٍ أخرى.';

COMMENT ON COLUMN state.royal_reports.sections IS
  'أقسامُ التقريرِ بحقولها كما قِيست: لكلِّ حقلٍ قيمتُه ومصدرُه وعددُ الصفوفِ التي قِيس منها، أو فرضيتُه إن كان تقديريّاً معلَناً. والقيدُ royal_reports_estimates_declared يرفض حقلاً بلا مصدرٍ ولا فرضية.';

COMMENT ON COLUMN state.royal_reports.fields_estimated IS
  'عددُ الحقولِ التقديريةِ المُعلَنة. ورقمٌ يكبر بلا فرضياتٍ مكتوبةٍ في sections يُرفض بالقيد، فلا يُخفى التقديرُ في عدّاد.';

-- الاستعلامُ يمشي بالحالِ وبالنافذة (لقراءةِ آخرِ منشورٍ ومنعِ تقريرين على نافذةٍ
-- واحدة)، وبأمرِ النشرِ (لمقابلةِ التقريرِ بدفترِ الأوامرِ الملكية).
CREATE INDEX royal_reports_state_period_idx
  ON state.royal_reports (state, period_end DESC);
CREATE UNIQUE INDEX royal_reports_published_period_idx
  ON state.royal_reports (period_end)
  WHERE state = 'published';
CREATE INDEX royal_reports_publish_command_idx
  ON state.royal_reports (publish_command_id)
  WHERE publish_command_id IS NOT NULL;
