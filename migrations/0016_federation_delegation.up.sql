-- الهجرة 0016 — التفويضُ الترابيُّ: إقليمٌ معزولٌ بولايةٍ وبلديةٍ بصلاحياتٍ
-- مفوَّضةٍ صريحةٍ، وسحبُ التفويضِ نافذٌ في لحظته (الخطوة M8.07).
--
-- **العيبُ الذي تعالجه:** كانت الشجرةُ الترابيةُ في `seed/federation.yaml` أسماءَ
-- أقاليمَ وولاياتٍ وبلديات، وكان في القاعدة مؤسساتٌ تعمل بنموذجِ تشغيلٍ (0015)
-- ولم يكن فيها عمودٌ واحدٌ يقول **إنّ لهذا الترابِ أن يعمل بنفسه**: لا صلاحيةً
-- مفوَّضةً إلى مستوىً بعينه، ولا دورَ ممارسةٍ محليّاً، ولا أصلاً ترابيّاً تُقرأ
-- منه السلسلة، ولا وقتَ سحبٍ يُقاس نفاذُه. فكان «العزلُ» فقرةً في وثيقة، ونصٌّ
-- في وثيقةٍ لا يُوقف فعلاً ولا يُثبته.
--
-- ولذلك تُنشأ ثلاثةُ جداول: `state.federation_delegations` (التفويضُ نافذاً أو
-- مسحوباً في صفٍّ محفوظ، وهو **سندُ السلطة**)، و`state.federation_local_acts`
-- (الفعلُ الترابيُّ الذي مُورس بدورِ مستواه، وهو **دليلُ الاستقلال**)،
-- و`state.federation_refusals` (ما مُنع ولِمَ، وهو **مادّةُ مراجعةِ العزل**).
--
-- ووقتُ السحبِ يُكتب في صفِّ التفويضِ نفسِه لا في جدولٍ آخر: حالٌ تُقرأ من
-- موضعين تُقرأ متعارضةً في اللحظة التي يهمّ فيها الفرقُ بين نافذٍ ومسحوب.
--
-- ومُسمَّياتُ القيود تُطابق ثوابتَ `FEDERATION_DELEGATION_SPEC` و
-- `FEDERATION_ACT_SPEC` و`FEDERATION_REFUSAL_SPEC` في
-- `src/persistence/entities.mjs` واحداً بواحد، والبوابةُ 23
-- (`scripts/guard-federation.mjs`) تحرس ألّا يسقط أحدُ الطرفين دون الآخر.
--
-- **حدٌّ معلَن أول — لا سلسلةَ أصولٍ مفروضةً بمفتاحٍ أجنبيّ:** `parent_key` نصٌّ
-- لا `REFERENCES state.federation_delegations (territory_key)`، على نهج 0014
-- و0015. والسببُ أنّ الأصلَ قد يُفوَّض بعد فرعه في تركيبٍ آخر، ومفتاحٌ أجنبيٌّ
-- يقلب ذلك من رفضٍ مقروءٍ برمزٍ (`FEDERATION_CHAIN_BROKEN`) إلى خطأ قاعدةٍ خام.
-- فالسلسلةُ مفروضةٌ في `src/federation/delegation.mjs` بقراءةِ صفوفِ الأصولِ قبل
-- كلِّ فعل، وقيدُ `federation_delegations_parent_coherent` يفرض ما تقدر عليه
-- القاعدةُ: أنّ المفتاحَ من ترابِ أصلِه بحسب شكله. وهذا **أضعفُ** من مفتاحٍ
-- أجنبيٍّ ولا يُدَّعى أنّه مثلُه.
--
-- **حدٌّ معلَن ثانٍ — نفاذُ السحبِ لا يُفرَض بقيدٍ جدوليّ:** أنّ فعلاً وقع بعد
-- سحبِ تفويضِ أصلِه يقتضي قراءةَ جدولِ التفويضاتِ من قيدٍ على جدولِ الأفعال،
-- والقيدُ الجدوليُّ لا يقرأ جدولاً آخر (والمُشغِّلاتُ ليست قيوداً بل كودٌ يُطفأ).
-- فالنفاذُ مفروضٌ في `RegionalDelegation.exercise` ومقيسٌ في
-- `tests/federation/delegation.test.mjs` بساعةٍ مُجمَّدة: أولُ فعلٍ بعد السحبِ
-- يُرفض بلا تقديمِ ساعةٍ ولا نافذةِ سماح.
--
-- **حدٌّ معلَن ثالث — إقليمٌ واحدٌ لا شجرةٌ كاملة:** الجداولُ تقبل أيَّ مفتاحٍ
-- صحيحِ الشكل، والمُفوَّضُ فعلاً في هذه الخطوة `R001` وولايتُه وبلديتُه وحدَها؛
-- وما عدا ذلك يُرفض بـ`FEDERATION_TERRITORY_UNKNOWN` من الوثيقة لا من القاعدة.
--
-- **حدٌّ معلَن رابع — لم تُطبَّق:** الهجرات 0005–0016 لم تُشغَّل على PostgreSQL
-- حقيقيٍّ في هذا المستودع بعد؛ صحّةُ هذه القيود مقروءةٌ لا مُختبَرة. وهو
-- مسجَّلٌ في `docs/REMAINING_WORK.md`.
--
-- ولا `BEGIN`/`COMMIT` هنا: المُهاجر يفتح المعاملة بنفسه.

CREATE TABLE state.federation_delegations (
  id state.entity_id PRIMARY KEY,
  territory_key text NOT NULL,
  level text NOT NULL CHECK (level IN ('region', 'province', 'municipality')),
  parent_key text,
  exercised_by text NOT NULL CHECK (exercised_by ~ '^role:[a-z-]+$'),
  powers text[] NOT NULL CHECK (array_position(powers, NULL) IS NULL),
  kinds text[] NOT NULL CHECK (array_position(kinds, NULL) IS NULL),
  model_version integer NOT NULL CHECK (model_version >= 1),
  activated_at timestamptz NOT NULL,
  activated_by text NOT NULL CHECK (activated_by ~ '^role:[a-z-]+$'),
  revoked_at timestamptz,
  revoked_by text CHECK (revoked_by ~ '^role:[a-z-]+$'),
  revocation_reason text,
  version state.version_number NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- ١. مفتاحُ الترابِ يقول مرتبتَه: الإقليمُ Rnnn، والولايةُ Pnnn-nn، والبلديةُ
  --    Pnnn-nn-nnn. ومفتاحٌ لا يقول مرتبتَه يُقرأ في غيرِ موضعه من الشجرة.
  CONSTRAINT federation_delegations_level_key_shaped CHECK (
    (level = 'region' AND territory_key ~ '^R[0-9]{3}$')
    OR (level = 'province' AND territory_key ~ '^P[0-9]{3}-[0-9]{2}$')
    OR (level = 'municipality' AND territory_key ~ '^P[0-9]{3}-[0-9]{2}-[0-9]{3}$')
  ),
  -- ٢. الإقليمُ بلا أصلٍ ترابيٍّ وفوقَه المركز، وما دونه أصلُه مُعلَنٌ وهو من
  --    ترابه بحسب مفتاحه. وفرعٌ بلا أصلٍ سلطةٌ بلا مصدرٍ يُقرأ منه سحبُها.
  CONSTRAINT federation_delegations_parent_coherent CHECK (
    (level = 'region' AND parent_key IS NULL)
    OR (
      level = 'province'
      AND parent_key ~ '^R[0-9]{3}$'
      AND territory_key LIKE 'P' || substring(parent_key from 2) || '-%'
    )
    OR (
      level = 'municipality'
      AND parent_key ~ '^P[0-9]{3}-[0-9]{2}$'
      AND territory_key LIKE parent_key || '-%'
    )
  ),
  -- ٣. التفويضُ صلاحيةٌ واحدةٌ على الأقلِّ ونوعُ فعلٍ واحدٌ على الأقل: تفويضٌ بلا
  --    صلاحيةٍ إعلانُ سلطةٍ لا تُمارَس، فلا يُقاس سحبُها بشيء.
  CONSTRAINT federation_delegations_powers_declared CHECK (
    array_length(powers, 1) >= 1
    AND array_length(kinds, 1) >= 1
  ),
  -- ٤. السحبُ وقتٌ وفاعلٌ وسببٌ يبلغ 20 حرفاً، والثلاثةُ تحضر معاً أو تغيب معاً.
  --    والرقمُ مكرَّرٌ هنا وفي `config/federation-delegation.yaml`
  --    (`procedure.minRefusalReasonLength`) وفي `entities.mjs`
  --    (`FEDERATION_MIN_REASON_LENGTH`)، والبوابةُ 23 تفحص تطابقَه في الثلاثة
  --    **في موضعه** من القيد. وسحبٌ بلا سببٍ قرارٌ لا يُراجَع.
  CONSTRAINT federation_delegations_revocation_complete CHECK (
    (revoked_at IS NULL AND revoked_by IS NULL AND revocation_reason IS NULL)
    OR (
      revoked_at IS NOT NULL
      AND revoked_by IS NOT NULL
      AND length(btrim(revocation_reason)) >= 20
    )
  ),
  -- ٥. السحبُ لا يسبق التفويض: سلطةٌ سُحبت قبل أن تُمنح حالٌ لا تُقرأ.
  CONSTRAINT federation_delegations_revoked_after_activation CHECK (
    revoked_at IS NULL OR revoked_at >= activated_at
  ),
  -- تفويضان لترابٍ واحدٍ سندان يُقرأ أحدُهما مكانَ الآخر، فيبقى النافذُ مقروءاً
  -- بعد سحبِ الآخر ويسقط معنى السحب.
  CONSTRAINT federation_delegations_territory_unique UNIQUE (territory_key)
);

COMMENT ON TABLE state.federation_delegations IS
  'التفويضُ الترابيُّ نافذاً أو مسحوباً: صلاحياتُ المستوى ودورُ ممارستها وأصلُه الترابيُّ ووقتُ نفاذِه ووقتُ سحبه. مصدرُ الإعلان config/federation-delegation.yaml والمنفِّذُ src/federation/delegation.mjs.';

COMMENT ON COLUMN state.federation_delegations.parent_key IS
  'الأصلُ الترابيُّ: يغيب للإقليمِ وحدَه لأنّ فوقَه المركزَ لا ترابَ آخر. وليس مفتاحاً أجنبيّاً (انظر الحدَّ المُعلَن الأول في رأس الهجرة).';

COMMENT ON COLUMN state.federation_delegations.revoked_at IS
  'وقتُ سحبِ التفويض. والنفاذُ من هذه اللحظةِ بلا نافذةِ سماح، ومفروضٌ في الكود لا بقيدٍ جدوليّ (انظر الحدَّ المُعلَن الثاني).';

CREATE TABLE state.federation_local_acts (
  id state.entity_id PRIMARY KEY,
  territory_key text NOT NULL,
  acting_key text NOT NULL,
  level text NOT NULL CHECK (level IN ('region', 'province', 'municipality')),
  kind text NOT NULL CHECK (kind ~ '^[a-z][a-z-]{2,63}$'),
  power text NOT NULL CHECK (power ~ '^[a-z][a-z-]{2,63}$'),
  subject text NOT NULL,
  exercised_by text NOT NULL CHECK (exercised_by ~ '^role:[a-z-]+$'),
  exercised_at timestamptz NOT NULL,
  version state.version_number NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- ١. موضوعُ الفعلِ مكتوبٌ بالحدِّ المُعلَن نفسِه (20): فعلٌ بموضوعٍ من حرفين لا
  --    يُراجَع ولا يُعرَف ما وقع به.
  CONSTRAINT federation_local_acts_subject_substantial CHECK (length(btrim(subject)) >= 20),
  -- ٢. الفعلُ في ترابِ من مارسه أو في فرعٍ منه: فعلٌ خارجَ ترابِ صاحبه سلطةٌ
  --    عبرت حدَّها، ومع عبورِ الحدِّ لا يبقى للعزلِ معنى.
  CONSTRAINT federation_local_acts_within_acting_territory CHECK (
    territory_key = acting_key
    OR (acting_key ~ '^R[0-9]{3}$' AND territory_key LIKE 'P' || substring(acting_key from 2) || '-%')
    OR (acting_key ~ '^P[0-9]{3}-[0-9]{2}$' AND territory_key LIKE acting_key || '-%')
  )
);

COMMENT ON TABLE state.federation_local_acts IS
  'الأفعالُ الترابيةُ المُمارَسةُ فعلاً بدورِ مستواها بلا إذنٍ مركزيٍّ لكلِّ فعل: وهي دليلُ استقلالِ الإقليم. ومخرَجُها نصُّ الموضوعِ في الصفِّ نفسِه، فلا منفِّذَ أثرٍ خارجيٍّ كما في M8.05.';

COMMENT ON COLUMN state.federation_local_acts.acting_key IS
  'الترابُ الذي مارس الفعل، وقد يعلو الترابَ المعمولَ فيه: الأصلُ يعمل في فرعه ولا يعمل الفرعُ في غيرِ ترابه.';

CREATE TABLE state.federation_refusals (
  id text PRIMARY KEY CHECK (length(btrim(id)) > 0),
  territory_key text,
  requested_territory_key text NOT NULL CHECK (length(btrim(requested_territory_key)) > 0),
  level text CHECK (level IN ('region', 'province', 'municipality')),
  kind text,
  power text,
  code text NOT NULL,
  reason text NOT NULL,
  actor_role text CHECK (actor_role ~ '^role:[a-z-]+$'),
  refused_at timestamptz NOT NULL,
  version state.version_number NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- ١. سببُ الرفضِ مكتوبٌ بالحدِّ المُعلَن نفسِه (20)، والرقمُ محروسٌ بالبوابة 23
  --    في موضعه من هذا القيد كما في قيدِ السحب. ورفضٌ بلا سببٍ مكتوبٍ يُقرأ بعد
  --    حينٍ منعاً بلا موجبٍ فلا يُراجَع ولا يُنقَض.
  CONSTRAINT federation_refusals_reason_substantial CHECK (length(btrim(reason)) >= 20),
  -- ٢. الرمزُ من رموزِ التفويض الترابي المُعلَنة: رمزٌ حرٌّ يجعل جدولَ الرفوضِ
  --    نصّاً لا يُصنَّف، فلا يُعرَف كم مرّةً أوقف سحبُ التفويضِ عملاً.
  CONSTRAINT federation_refusals_code_declared CHECK (code LIKE 'FEDERATION\_%')
);

COMMENT ON TABLE state.federation_refusals IS
  'رفوضُ الأفعالِ الترابية: مُنِعَ ولم يُسجَّل يعني أنّ الترابَ المتجاوِزَ لا يُقرأ في أيِّ جدول، وأنّ سحبَ التفويضِ لا يُعرَف أنّه أوقف عملاً. والرفضُ يُسجَّل ولا يُعالَج: لا تصعيدَ ولا جزاءَ (انظر docs/REMAINING_WORK.md).';

COMMENT ON COLUMN state.federation_refusals.territory_key IS
  'ترابُ من طلب الفعلَ إن كان مُعلَناً في الوثيقة، ويغيب إذا كان المفتاحُ نفسُه غيرَ مُفوَّض. والفرقُ بينه وبين requested_territory_key هو الخروجُ من الحدّ.';

-- الاستعلامُ يمشي بالترابِ (لمراجعةِ العزل) وبالوقتِ (لأثرِ لحظةِ السحب).
CREATE INDEX federation_delegations_parent_idx
  ON state.federation_delegations (parent_key, territory_key);
CREATE INDEX federation_local_acts_territory_idx
  ON state.federation_local_acts (territory_key, exercised_at DESC);
CREATE INDEX federation_refusals_territory_idx
  ON state.federation_refusals (requested_territory_key, refused_at DESC);
