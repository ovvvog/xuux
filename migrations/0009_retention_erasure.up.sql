-- الهجرة 0009 — دفتر شواهد المحو وفهرس عقد الذاكرة (الخطوة M7.06).
--
-- **العيب الذي تعالجه:** معيار قبول الخطوة نصّه «دورة احتفاظ كاملة تُمحى
-- **وتُسجَّل**». و`src/persistence/retention.mjs` (‏`M3.08`) يحذف الصفوف المنتهية
-- بـ`DELETE` مباشرةً: لا شاهد، ولا سبب، ولا فاعل. فبعد المرور لا يبقى في الدولة
-- ما يميّز «مُحي بانتهاء مدّته» من «لم يوجد قطّ» من «حُذف بيدٍ لا تملك». وهذا
-- الجدول هو الشطر الغائب: يبقى بعد زوال المادّة، ويشهد على زوالها.
--
-- **ولا مرجعَ في `target_id` إلى `state.data_assets`:** المشهود عليه **زائلٌ
-- بالقصد**. مرجعٌ إليه إمّا يُسقط الشاهد مع الأصل (فلا شاهد)، أو يمنع محو الأصل
-- (فلا محو) — وكلاهما نقضٌ لغرض الجدول. فالمعرّف يُحفظ نصّاً، وسلامةُ الدفتر
-- تقوم على سلسلة التجزئة لا على مرجعٍ إلى ما زال.
--
-- **وشهادةُ التوابع `dependents`:** الهجرة `0007` جعلت `state.data_lineage.asset_id`
-- و`state.classification_approvals.asset_id` مرجعين بلا `ON DELETE` قصداً، ونصّت أنّ
-- «المحوَ فعلٌ محكوم في M7.06». وهنا يُنفَّذ ذلك النصّ: الدورة تعدّ صفوف التابع
-- وتشهد على رأس سلسلته **قبل** حذفه، فيبقى الجواب عن «من قرأ هذا الأصل» تجزئةً
-- محفوظة بعد زوال صفوفه.
--
-- **والفهرس `memories_dataset_idx`:** `state.memories.dataset_id` يرجع إلى الأصل
-- بـ`ON DELETE RESTRICT`، فالدورة تسأل قبل كل محوِ أصلٍ «هل ما زالت له ذاكرةٌ
-- حيّة؟»، وبلا فهرسٍ يكون السؤال مسحاً كاملاً لجدول الذاكرة في كل مرّة.
-- **والفهرسُ قائمٌ فعلاً منذ الهجرة `0002`** (السطر 144 من `0002_..._records.up.sql`)،
-- وكانت هذه الهجرة تُعيد إنشاءه فتُخفق بـ`42P07` على قاعدةٍ نظيفة — عيبٌ حقيقيٌّ
-- أبقى مسارَ CI أحمرَ من يومِ إضافةِ هذه الهجرة، شُخِّص وأُصلح في `WL-044`.
-- **ولم يُصلَح بـ`IF NOT EXISTS`:** ذاك يُخفي التكرارَ ويجعل الهجرةَ تُجيز حالين،
-- والمِلكيةُ تُصحَّح لا تُلبَّس — فالفهرسُ ملكُ `0002`، وهذه الهجرةُ تنصّ على
-- اعتمادِها عليه ولا تُنشئه ولا تُسقطه. وبذلك يبقى الترشيحُ المُعلن في
-- `MEMORY_SPEC.filterable` مسنوداً بفهرسٍ **واحدٍ** له مالكٌ واحد.
--
-- **حدٌّ معلَن:** الترتيب (الذاكرة قبل عقدها) **ليس** مفروضاً بقيدٍ في القاعدة،
-- ولا يمكن أن يكون: القيد يُقيَّم على صفٍّ لا على تعاقب أفعال. الضمانُ الأخير هو
-- `ON DELETE RESTRICT` القائم — يرفض عكسَ الترتيب رفضاً محتوماً — والترتيبُ نفسه
-- معلَنٌ في `config/retention.yaml` ويرفض مُحمِّلُه عكسَه قبل التشغيل.
--
-- **حدٌّ معلَن ثانٍ:** لا مُحرِّض يمنع `UPDATE`/`DELETE` على هذا الدفتر. منعُه في
-- القاعدة يقتضي مُحرِّضاً يعمل بصلاحية مالك الجدول، ولا تُثبَّت صلاحيةٌ لم تُقَس
-- في بيئةٍ بلا قاعدة تشغيلية. والكشفُ قائمٌ لا المنع: `ErasureLedger.verify()`
-- يُظهر أي تعديلٍ أو حذفٍ لانقطاع السلسلة، وقيدا التفرّد أدناه يمنعان الإدراج
-- المزدوج. وهو مسجَّل في `docs/REMAINING_WORK.md`.
--
-- ولا `BEGIN`/`COMMIT` هنا: المُهاجر يفتح المعاملة بنفسه.

CREATE TABLE state.erasure_records (
  id state.entity_id PRIMARY KEY,
  target text NOT NULL,
  -- نصٌّ لا مرجع: المشهود عليه زائلٌ بالقصد (انظر رأس الملف).
  target_id text NOT NULL CHECK (length(btrim(target_id)) > 0),
  reason text NOT NULL,
  actor_id text NOT NULL CHECK (length(btrim(actor_id)) > 0),
  classification text NOT NULL CHECK (length(btrim(classification)) > 0),
  owner text NOT NULL CHECK (length(btrim(owner)) > 0),
  dependents jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(dependents) = 'object'),
  seq integer NOT NULL CHECK (seq >= 1),
  -- نصٌّ لا `timestamptz`، لنفس سبب دفتر النسب في `0007`: التجزئة تُحسب على هذه
  -- القيمة، وفرقُ الدقّة بين ساعة القاعدة و`Date` كان سيكسر السلسلة على البريء.
  recorded_at text NOT NULL CHECK (
    recorded_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$'
  ),
  prev_hash text NOT NULL CHECK (prev_hash = 'genesis' OR prev_hash ~ '^[0-9a-f]{64}$'),
  hash text NOT NULL CHECK (hash ~ '^[0-9a-f]{64}$'),
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT erasure_records_target_known CHECK (target IN ('memories', 'data_assets')),
  CONSTRAINT erasure_records_reason_known CHECK (reason IN ('retention', 'directed')),
  CONSTRAINT erasure_records_chain_linked CHECK ((seq = 1) = (prev_hash = 'genesis')),
  CONSTRAINT erasure_records_hash_unique UNIQUE (hash),
  CONSTRAINT erasure_records_seq_unique UNIQUE (seq)
);

COMMENT ON TABLE state.erasure_records IS
  'شواهد المحو: يبقى بعد زوال المادّة ويشهد على زوالها. لا يحمل مادّة ما مُحي ولا غلافه — دفترٌ يحمل المادة يُبطل المحو من باب التدقيق.';

-- الاستعلام يمشي بترتيب السلسلة (للتحقق) وبالهدف (للتدقيق).
CREATE INDEX erasure_records_seq_idx ON state.erasure_records (seq);
CREATE INDEX erasure_records_target_idx ON state.erasure_records (target, recorded_at DESC);

-- ولا `CREATE INDEX memories_dataset_idx` هنا: الفهرسُ ملكُ الهجرة `0002` — انظر
-- الترويسة أعلاه. اعتمادٌ مُعلَنٌ لا إنشاءٌ مُكرَّر.
