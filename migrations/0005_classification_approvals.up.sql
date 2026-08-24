-- الهجرة 0005 — دفتر اعتمادات إعادة التصنيف (الخطوة M7.01).
--
-- العيب الذي تعالجه: إعادة التصنيف لم تكن موجودة أصلاً في `state.data_assets`،
-- فمن أراد إنزال تصنيف أصلٍ سياديٍّ كان يكتب `classification` مباشرةً بتحديث
-- مستودع عادي. أي أن أخطر فعلٍ على البيانات — نشرُ ما كان محجوباً — كان تحديث
-- عمودٍ واحد بلا معتمِد ولا سبب ولا أثر يُراجَع.
--
-- ولا يكفي أن يشترط الكود «اعتماداً» ويقبل كائن اعتماد يُمرَّر إليه في الطلب:
-- من يستطيع تمرير `{ approvedBy: 'king' }` يستطيع اختراعه. فالاعتماد صار **صفّاً
-- في القاعدة** يُنشأ بفعلٍ منفصل ثم يُستهلَك مرّةً واحدة، والكود لا يقرأ إلا
-- بمُعرّفه من هذا الجدول.
--
-- والقيود هنا هي الضمان الأخير، تعمل حتى لو كتب أحدٌ في الجدول بلا مستودع:
--   • `from` ≠ `to` — اعتمادٌ لا يغيّر شيئاً ليس اعتماداً.
--   • المعتمِد ≠ الطالب — فصل السلطات في القاعدة لا في النية وحدها.
--   • انتهاء الصلاحية بعد الإنشاء — نافذةٌ سالبة تعني اعتماداً ميّتاً عند ميلاده.
--   • فريدٌ جزئي: لا اعتمادان **غير مستهلَكين** لنفس الأصل ونفس الانتقال ونفس
--     نسخة السجل. بلا هذا يُطلب اعتمادان ويُستهلَك أحدهما ثم يبقى الآخر تصريحاً
--     نائماً لإنزالٍ ثانٍ.
--
-- حدٌّ معلن: الاستهلاك يُكتب هنا (`consumed_at`) لكن **ذرّية** «استهلِك ثم اكتب
-- التصنيف» تحتاج معاملة، وهي متاحة عبر مُشغّل المعاملة في `src/persistence`؛
-- ومن ركّب الفهرس بلا مُشغّل معاملة فقد كتابتين متتاليتين لا واحدة، والفرق
-- معلَن في `docs/PERSISTENCE.md` لا مخفيّ.

CREATE TABLE state.classification_approvals (
  id state.entity_id PRIMARY KEY,
  -- المرجع إلى الأصل صريح: اعتمادٌ بلا أصل قائم تصريحٌ في الهواء. و`ON DELETE`
  -- غير معلَن قصداً — أصول البيانات لا تُحذف بل يقرّر احتفاظُها محوَها (M7.06).
  asset_id state.entity_id NOT NULL REFERENCES state.data_assets (id),
  from_classification text NOT NULL CHECK (
    from_classification IN ('public', 'internal', 'sensitive', 'sovereign')
  ),
  to_classification text NOT NULL CHECK (
    to_classification IN ('public', 'internal', 'sensitive', 'sovereign')
  ),
  requested_by text NOT NULL CHECK (length(btrim(requested_by)) > 0),
  approved_by text NOT NULL CHECK (length(btrim(approved_by)) > 0),
  approver_role text NOT NULL CHECK (length(btrim(approver_role)) > 0),
  justification text NOT NULL CHECK (length(btrim(justification)) >= 12),
  -- نسخة السجل لحظة الاعتماد: تمنع أن يُعتمد إنزالٌ على حالٍ ثم يُطبَّق بعد أن
  -- تغيّر الأصل. الاعتماد قرارٌ على حالةٍ بعينها لا على اسم أصل.
  record_version integer NOT NULL CHECK (record_version >= 1),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  consumed_by text,
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT classification_approvals_direction CHECK (from_classification <> to_classification),
  CONSTRAINT classification_approvals_separation CHECK (approved_by <> requested_by),
  CONSTRAINT classification_approvals_window CHECK (expires_at > created_at),
  CONSTRAINT classification_approvals_consumer CHECK (
    (consumed_at IS NULL AND consumed_by IS NULL)
    OR (consumed_at IS NOT NULL AND consumed_by IS NOT NULL)
  )
);

-- فريدٌ جزئي على الاعتمادات الحيّة وحدها: المستهلَكة تبقى للأثر ولا تمنع اعتماداً
-- جديداً لاحقاً، والحيّة لا تتعدد فلا يبقى تصريحٌ نائم بعد أول استعمال.
CREATE UNIQUE INDEX classification_approvals_live_idx
  ON state.classification_approvals (asset_id, from_classification, to_classification, record_version)
  WHERE consumed_at IS NULL;

CREATE INDEX classification_approvals_asset_idx
  ON state.classification_approvals (asset_id, created_at DESC);
