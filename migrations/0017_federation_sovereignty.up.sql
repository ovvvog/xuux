-- الهجرة 0017 — سجلُّ التفويضاتِ النافذة: التفويضُ وسحبُه أمرٌ ملكيٌّ واحدٌ
-- يُقاس نفاذُه بمهلةٍ مُعلَنة (الخطوة M8.08).
--
-- **العيبُ الذي تعالجه:** الهجرة 0016 أنشأت `state.federation_delegations`
-- فصار للتفويضِ صفٌّ يُقرأ منه حالُ الترابِ **الآن**. لكنّ ذلك الصفَّ يُحدَّث في
-- موضعه: يُكتب فيه وقتُ السحبِ فيمحو ما قبله، ولا يحمل **معرّفَ أمرٍ ملكيٍّ**
-- ولا وقتَ إصداره ولا زمنَ نفاذه مقيساً. فكان يُمكن أن يُفوَّض ترابٌ أو يُسحب
-- تفويضُه **بمقارنةِ اسمِ دورٍ بالنصّ** لا بأمرٍ موقَّعٍ مقبولٍ في بوابة التاج،
-- وكانت السيادةُ حالةً حاضرةً لا سلسلةَ أوامرَ تُراجَع، ولا مهلةَ نفاذٍ تُقاس.
--
-- ولذلك يُنشأ جدولٌ واحد: `state.federation_delegation_register` — صفٌّ لكلِّ
-- أمرٍ ملكيٍّ نفذ، منحاً (`GRANT`) أو سحباً (`REVOKE`)، بمعرّفِ أمره **الذي لا
-- يتكرّر** (قيدُ تفرُّدٍ لا اتفاقٌ في الكود)، ووقتِ إصداره ووقتِ قبوله في
-- البوابةِ ووقتِ نفاذِ أثره، والزمنِ المقيسِ بينهما، والمهلةِ المُعلَنةِ للسحبِ
-- والحكمِ عليها.
--
-- والصفوفُ **لا تُحدَّث ولا تُمحى**: تسلسلُ الأوامرِ هو السجلّ. ومنه يُقرأ
-- النافذُ الآن (`DelegationRegister.effective`)، ويُقابَل بصفوفِ التفويضِ في
-- الاتجاهين فيُكشف التباعدُ بـ`FEDERATION_REGISTER_DIVERGED`.
--
-- ومُسمَّياتُ القيود تُطابق ثوابتَ `FEDERATION_REGISTER_SPEC` في
-- `src/persistence/entities.mjs` واحداً بواحد، والبوابةُ 24
-- (`scripts/guard-sovereignty.mjs`) تحرس ألّا يسقط أحدُ الطرفين دون الآخر.
--
-- **حدٌّ معلَن أول — الحكمُ على المهلةِ محسوبٌ لا مكتوب:** `within_deadline` ليس
-- عموداً حرّاً يكتبه المستدعي، بل قيدُ `federation_register_deadline_judged`
-- يفرض أنّه **مساوٍ** لِـ`latency_ms <= deadline_ms`. فلا يُقرأ سحبٌ ناجحاً في
-- مهلته إلا بقياسٍ محفوظٍ يقول ذلك، ولا تُخضَّر مهلةٌ بكتابةِ حكمٍ يخالف قياسه.
--
-- **حدٌّ معلَن ثانٍ — الزمنُ مشتقٌّ من وقتين محفوظين:**
-- `federation_register_latency_measured` يفرض
-- `latency_ms = (effective_at - issued_at)` بالميلي ثانية. ورقمٌ لا يُشتقّ من
-- وقتين محفوظين رقمٌ يُكتب باليد، ومهلةٌ تُقاس برقمٍ يُكتب باليد ليست مهلة.
--
-- **حدٌّ معلَن ثالث — لا مفتاحَ أجنبيَّ إلى جدولِ التفويضات:** على نهج 0016، إذ
-- قد يُسقَط صفُّ تفويضٍ في تركيبٍ آخر بينما يبقى أمرُ سحبه في السجلّ — وهو ما
-- يجب أن **يُكشف** بالتباعدِ برمزٍ مقروء، لا أن يمنعه مفتاحٌ أجنبيٌّ بخطأِ قاعدةٍ
-- خام. ولا مفتاحَ أجنبيَّ إلى سلسلةِ الوقائعِ الموقَّعةِ كذلك: هذا سجلٌّ جدوليٌّ
-- يُقرأ بالاستعلام، لا سلسلةٌ تُبرهن على نفسها بالتوقيعِ والتلبيد.
--
-- **حدٌّ معلَن رابع — لم تُطبَّق:** الهجرات 0005–0017 لم تُشغَّل على PostgreSQL
-- حقيقيٍّ في هذا المستودع بعد؛ صحّةُ هذه القيود مقروءةٌ لا مُختبَرة. وهو
-- مسجَّلٌ في `docs/REMAINING_WORK.md`.
--
-- ولا `BEGIN`/`COMMIT` هنا: المُهاجر يفتح المعاملة بنفسه.

CREATE TABLE state.federation_delegation_register (
  id state.entity_id PRIMARY KEY,
  command_id text NOT NULL,
  action text NOT NULL CHECK (action ~ '^[a-z][a-z0-9-]{4,63}$'),
  effect text NOT NULL CHECK (effect IN ('GRANT', 'REVOKE')),
  territory_key text NOT NULL,
  level text NOT NULL CHECK (level IN ('region', 'province', 'municipality')),
  actor_role text NOT NULL CHECK (actor_role ~ '^role:[a-z-]+$'),
  issued_at timestamptz NOT NULL,
  accepted_at timestamptz NOT NULL,
  effective_at timestamptz NOT NULL,
  latency_ms bigint NOT NULL CHECK (latency_ms >= 0),
  deadline_ms integer CHECK (deadline_ms > 0),
  within_deadline boolean,
  reason text,
  version state.version_number NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- ١. أمرٌ ملكيٌّ واحدٌ أثرٌ واحد: معرّفُ الأمرِ لا يتكرّر في السجلّ. وبوابةُ
  --    التاجِ تمنع الإعادةَ في الذاكرة، وهذا القيدُ يمنعها في الحالةِ المحفوظةِ
  --    بعد إعادةِ التشغيل — والذاكرةُ تُفقَد والقاعدةُ تبقى.
  CONSTRAINT federation_register_command_once UNIQUE (command_id),
  -- ٢. مفتاحُ الترابِ يقول مرتبتَه كما في 0016: الإقليمُ Rnnn، والولايةُ
  --    Pnnn-nn، والبلديةُ Pnnn-nn-nnn.
  CONSTRAINT federation_register_level_key_shaped CHECK (
    (level = 'region' AND territory_key ~ '^R[0-9]{3}$')
    OR (level = 'province' AND territory_key ~ '^P[0-9]{3}-[0-9]{2}$')
    OR (level = 'municipality' AND territory_key ~ '^P[0-9]{3}-[0-9]{2}-[0-9]{3}$')
  ),
  -- ٣. وقتُ الإصدارِ ثم القبولِ ثم النفاذ، بهذا الترتيبِ لا غيره. وأمرٌ نفَذ قبل
  --    أن يُقبل زمنٌ لا يُقرأ منه سببٌ ولا يُقاس منه تأخُّر.
  CONSTRAINT federation_register_times_ordered CHECK (
    accepted_at >= issued_at AND effective_at >= accepted_at
  ),
  -- ٤. الزمنُ المقيسُ مشتقٌّ من وقتين محفوظين لا مكتوبٌ استقلالاً.
  CONSTRAINT federation_register_latency_measured CHECK (
    latency_ms = (EXTRACT(EPOCH FROM (effective_at - issued_at)) * 1000)::bigint
  ),
  -- ٥. السحبُ وحدَه له مهلةٌ وحكمٌ عليها، والحكمُ محسوبٌ من القياس؛ والمنحُ بلا
  --    مهلةٍ ولا حكم. ومنحٌ بمهلةٍ سجلٌّ يُقرأ منه ما لم يُعلَن.
  CONSTRAINT federation_register_deadline_judged CHECK (
    (effect = 'GRANT' AND deadline_ms IS NULL AND within_deadline IS NULL)
    OR (
      effect = 'REVOKE'
      AND deadline_ms IS NOT NULL
      AND within_deadline IS NOT NULL
      AND within_deadline = (latency_ms <= deadline_ms)
    )
  ),
  -- ٦. لكلِّ سحبٍ سببٌ مكتوبٌ بالحدِّ المُعلَن نفسِه (20) كما في 0016، ولا سببَ
  --    لمنح. وسحبٌ بلا سببٍ في السجلِّ سيادةٌ سُحبت بلا موجبٍ يُقرأ.
  CONSTRAINT federation_register_reason_bound_to_effect CHECK (
    (effect = 'GRANT' AND reason IS NULL)
    OR (effect = 'REVOKE' AND length(btrim(reason)) >= 20)
  )
);

COMMENT ON TABLE state.federation_delegation_register IS
  'سجلُّ التفويضاتِ النافذة: صفٌّ لكلِّ أمرٍ ملكيٍّ نفذ منحاً أو سحباً. ومنه يُقرأ النافذُ الآن لا من الوثيقةِ ولا من صفِّ التفويضِ وحدَه، إذ يُحدَّث في موضعه فيمحو ما قبله. والصفوفُ لا تُحدَّث ولا تُمحى: تسلسلُ الأوامرِ هو السجل.';

COMMENT ON COLUMN state.federation_delegation_register.latency_ms IS
  'زمنُ نفاذِ الأمرِ مقيساً من إصداره إلى كتابةِ أثره، مشتقّاً من العمودين المحفوظين بقيدٍ لا بثقةٍ في المستدعي. وهو مادّةُ معيارِ القبول: سحبُ التفويضِ ينفذ خلال مهلةٍ معلَنةٍ ومُقاسة.';

COMMENT ON COLUMN state.federation_delegation_register.within_deadline IS
  'حكمُ المهلةِ محسوباً من القياسِ لا مكتوباً استقلالاً؛ ويُقرأ للسحبِ وحدَه. وتجاوزُ المهلةِ يبقى مكتوباً وتُنشر له حادثةُ federation.revocation.overdue: مهلةٌ تُخضَّر بحذفِ قياسها ليست مهلة.';

-- الاستعلامُ يمشي بالترابِ وبالزمن (لقراءةِ النافذِ الآن وتسلسلِ أوامره)، وبالحكمِ
-- على المهلةِ (لجمعِ ما تجاوزها وحدَه دون مسحِ السجلِّ كلِّه).
CREATE INDEX federation_register_territory_idx
  ON state.federation_delegation_register (territory_key, effective_at DESC);
CREATE INDEX federation_register_overdue_idx
  ON state.federation_delegation_register (within_deadline, effective_at DESC)
  WHERE within_deadline = false;
