-- الهجرة 0007 — دفتر نسب البيانات، وإلغاء عمود النسب المُدّعى (الخطوة M7.04).
--
-- العيب الذي تعالجه: كان في `state.data_assets` عمودٌ اسمه `lineage` من نوع
-- `jsonb` أنشأته الهجرة `0002` بقيدٍ واحدٍ فقط: أن يكون **مصفوفة**. فكان يقبل
-- `['command']` و`[{ "from": "seed" }]` و`[]` — أي أن «نسب» الأصل كان نصّاً حرّاً
-- يكتبه **نفس** من يسجّل الأصل، ولا شيء يربطه بأصلٍ آخر ولا يقارن تصنيفه ولا
-- يمنع أن يكون فارغاً. وهذا نمطُ العيب الذي أُغلق مرّتين قبل هذه الخطوة:
-- «الاعتماد حقلٌ في الطلب» (‏M7.01) و«التخليص قيمةٌ في الطلب» (‏M7.02).
--
-- ولم يكن ثمّة **استعلام نسب** أصلاً: «من حوّل هذا الأصل ومن قرأه» سؤالٌ بلا
-- جواب في المستودع.
--
-- والقيود هنا هي الضمان الأخير، تعمل حتى لو كتب أحدٌ في الجدول بلا الدفتر:
--   • النوع من قائمةٍ معلَنة — نوعٌ لا يعرفه الإعداد لا يُقرأ في استعلام.
--   • الاشتقاق **وحده** يحمل أسلافاً، والقراءة والكتابة والأصلُ الأوّل لا تحملها.
--   • الأصل ليس سلفَ نفسه — دورةٌ بطول واحد تُقطع في القاعدة لا في الكود وحده.
--   • `seq = 1` **إن وفقط إن** كان `prev_hash = 'genesis'`: فلا يصير كل صفٍّ
--     بدايةً جديدة تُخفي ثغرةً في السلسلة.
--   • فريدٌ على (‏`asset_id`، `seq`) وعلى `hash`: لا صفّان في نفس موضع السلسلة،
--     ولا صفٌّ يُعاد إدراجه بحرفه.
--
-- ولا `BEGIN`/`COMMIT` هنا: المُهاجر يفتح المعاملة بنفسه (`withTransaction`)،
-- و`COMMIT` داخل ملف الهجرة كان سيُثبّت المعاملة الخارجية قبل صفّها في
-- `schema_migrations` — أي هجرةٌ مُطبَّقة غير مسجَّلة.
--
-- **ولا مسارَ تعديل:** لا `UPDATE` في الدفتر ولا `ON DELETE CASCADE` على مرجع
-- الأصل. حذفُ الأصل مع نسبه كان سيمحو الجواب عن «من قرأه» في نفس اللحظة التي
-- يُسأل فيها؛ والمحوُ فعلٌ محكوم في M7.06 لا أثرٌ جانبي لحذفٍ عابر.

CREATE TABLE state.data_lineage (
  id state.entity_id PRIMARY KEY,
  asset_id state.entity_id NOT NULL REFERENCES state.data_assets (id),
  seq integer NOT NULL CHECK (seq >= 1),
  kind text NOT NULL,
  actor_id text NOT NULL CHECK (length(btrim(actor_id)) > 0),
  parents jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(parents) = 'array'),
  purpose text NOT NULL CHECK (length(btrim(purpose)) > 0),
  -- نصٌّ لا `timestamptz`: التجزئة تُحسب على هذه القيمة، وفرقُ الدقّة بين ساعة
  -- القاعدة (ميكروثانية) و`Date` في JavaScript (ميليثانية) كان سيكسر السلسلة على
  -- البريء — وهو انحرافٌ سقط فيه المشروع مرّةً في `M3.05`. وصيغتُه محكومة بقيد.
  recorded_at text NOT NULL CHECK (
    recorded_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$'
  ),
  prev_hash text NOT NULL CHECK (prev_hash = 'genesis' OR prev_hash ~ '^[0-9a-f]{64}$'),
  hash text NOT NULL CHECK (hash ~ '^[0-9a-f]{64}$'),
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT data_lineage_kind_known CHECK (kind IN ('origin', 'derivation', 'read', 'write')),
  CONSTRAINT data_lineage_origin_without_parents CHECK (
    kind = 'derivation' OR jsonb_array_length(parents) = 0
  ),
  CONSTRAINT data_lineage_derivation_with_parents CHECK (
    kind <> 'derivation' OR jsonb_array_length(parents) > 0
  ),
  CONSTRAINT data_lineage_no_self_parent CHECK (NOT (parents ? (asset_id::text))),
  CONSTRAINT data_lineage_chain_linked CHECK ((seq = 1) = (prev_hash = 'genesis')),
  CONSTRAINT data_lineage_hash_unique UNIQUE (hash),
  CONSTRAINT data_lineage_seq_unique UNIQUE (asset_id, seq)
);

-- الاستعلام يمشي بالأصل وبترتيب السلسلة: بلا هذا الفهرس يصير كل استعلام نسبٍ
-- مسحاً كاملاً للدفتر، وهو أسرع ما يكبر في الدولة.
CREATE INDEX data_lineage_asset_idx ON state.data_lineage (asset_id, seq);
CREATE INDEX data_lineage_kind_idx ON state.data_lineage (kind, recorded_at DESC);

-- إلغاء عمود الادّعاء. والفشل **مُغلَق**: إن كان في الجداول القائمة أصلٌ يحمل
-- نسباً مُدّعىً فالترحيل **يتوقّف** ولا يحذف. والسبب أنّ تحويل ادّعاءٍ حرّ إلى
-- قيدٍ محقَّق يحتاج معرّفات أصولٍ لا تملكها الهجرة: `['command']` ليس معرّف أصل،
-- ولا يجوز أن تخترع الهجرة سلفاً ولا أن تُسقط ما أعلنه مالك صامتاً.
DO $$
DECLARE claimed bigint;
BEGIN
  SELECT count(*) INTO claimed
  FROM state.data_assets
  WHERE lineage IS NOT NULL AND jsonb_array_length(lineage) > 0;

  IF claimed > 0 THEN
    RAISE EXCEPTION
      'الترحيل موقوف: % أصلاً يحمل نسباً مُدّعىً في العمود الملغى state.data_assets.lineage. النسب صار قيوداً محقَّقة في state.data_lineage بمعرّفات أصولٍ مفهرسة، وتحويلُ نصٍّ حرٍّ إلى قيدٍ محقَّق يحتاج قراراً بشرياً لا هجرةً: لا تخترع الهجرةُ سلفاً ولا تُسقط ما أعلنه مالك صامتاً.',
      claimed;
  END IF;
END $$;

ALTER TABLE state.data_assets
  DROP COLUMN lineage;
