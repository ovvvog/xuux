-- الهجرة 0010 — قنوات الأحداث: تدفّقاتُ الرسائل ومواضعُ قراءتها (الخطوة M7.07).
--
-- **العيب الذي تعالجه:** كان في الدولة سجلٌّ واحد للأحداث (`EventLog`) تكتب فيه
-- خمسةٌ وعشرون موضعاً. وهو سجلٌّ سليمُ السلسلة، لكنه **ليس قناة**: من أراد أحداث
-- مجالٍ واحد قرأ السجلَّ كلَّه ورشّح بنفسه (فقارئان يرشّحان بشرطين مختلفين
-- يقرأان مجالين ويحسبانهما واحداً)، ولم يكن لأي قارئٍ **موضعُ قراءةٍ محفوظ**
-- (فمن يُعاد تشغيله يُعالج ما عالجه أو يُسقط ما فاته، وكلاهما خطأٌ صامت)، ولم
-- تكن على النشر سلطةٌ ولا على القراءة تخليص، ولا عقدٌ يقول ما الحقولُ التي
-- يضمنها نوعٌ لقارئه. وهذان الجدولان هما الشطر الغائب.
--
-- **ولماذا التفرّد على `(channel, seq)` لا على `seq` وحده؟** لأن السلسلة هنا
-- **لكل قناة على حدة**: الترقيم يبدأ من 1 داخل كل قناة. والقناةُ هي وحدةُ
-- القراءة، فسلسلةٌ عامّةٌ للجدول كلّه كانت ستجعل فحصَ قناةٍ واحدة يقتضي قراءةَ
-- قنواتٍ لا تخليصَ للقارئ عليها — وذلك يهدم البوابة التي بُنيت القنواتُ
-- لإقامتها.
--
-- **و`author_id` منفصلٌ عن `actor_id`:** الأولُ فاعلُ الواقعة كما كُتب في سجل جذر
-- الثقة، والثاني من حملها إلى القناة (`relayed = true`). ودمجُهما كان سيجعل كل
-- حدثٍ منقولٍ يبدو كأن الناقلَ فعله، وهو نسبُ فعلٍ إلى غير فاعله في دفترٍ يُدقَّق.
--
-- **و`recorded_at` نصٌّ لا `timestamptz`**، لنفس سبب `0007` و`0009`: التجزئة تُحسب
-- على هذه القيمة، وفرقُ الدقّة بين ساعة القاعدة و`Date` كان سيكسر السلسلة على
-- البريء. ولذلك سُمّي عمودُ موضع القراءة `committed_at` تمييزاً له عن
-- `updated_at` المُدار.
--
-- **حدٌّ معلَن:** لا قيدَ في القاعدة يفرض أن يكون `prev_hash` هو `hash` الرسالة
-- ذات `seq - 1` في القناة نفسها. القيدُ يُقيَّم على صفٍّ لا على صفَّين، وفرضُه
-- يقتضي مُحرِّضاً يقرأ الجدول في كل إدراج. والمفروضُ هنا هو ما يُقاس على صفٍّ
-- واحد: `(seq = 1) = (prev_hash = 'genesis')` وتفرّدُ `(channel, seq)` وتفرّدُ
-- `hash`. والكشفُ الكامل في `EventBus.verifyChannel()`.
--
-- **حدٌّ معلَن ثانٍ:** لا مُحرِّض يمنع `UPDATE`/`DELETE` على جدول الرسائل، لنفس
-- سبب `0009`: منعُه يقتضي صلاحية مالك الجدول، ولا تُثبَّت صلاحيةٌ لم تُقَس في
-- بيئةٍ بلا قاعدةٍ تشغيلية. والكشفُ قائمٌ لا المنع، وهو مسجَّل في
-- `docs/REMAINING_WORK.md`.
--
-- ولا `BEGIN`/`COMMIT` هنا: المُهاجر يفتح المعاملة بنفسه.

CREATE TABLE state.event_messages (
  id state.entity_id PRIMARY KEY,
  channel text NOT NULL CHECK (length(btrim(channel)) > 0),
  type text NOT NULL CHECK (length(btrim(type)) > 0),
  contract_version integer NOT NULL CHECK (contract_version >= 1),
  seq integer NOT NULL CHECK (seq >= 1),
  -- فاعلُ الواقعة الأصلي، ثم من حملها إلى القناة (انظر رأس الملف).
  author_id text NOT NULL CHECK (length(btrim(author_id)) > 0),
  actor_id text NOT NULL CHECK (length(btrim(actor_id)) > 0),
  actor_role text NOT NULL CHECK (length(btrim(actor_role)) > 0),
  classification text NOT NULL CHECK (length(btrim(classification)) > 0),
  payload jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(payload) = 'object'),
  relayed boolean NOT NULL DEFAULT false,
  -- نصٌّ لا `timestamptz`: التجزئة تُحسب عليه (انظر رأس الملف).
  recorded_at text NOT NULL CHECK (
    recorded_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$'
  ),
  prev_hash text NOT NULL CHECK (prev_hash = 'genesis' OR prev_hash ~ '^[0-9a-f]{64}$'),
  hash text NOT NULL CHECK (hash ~ '^[0-9a-f]{64}$'),
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- النوعُ يبدأ بمعرّف قناته: نوعٌ في قناةٍ لا تملكه يجعل القارئ يقرأ مجالاً
  -- غير الذي خُلِّص له، وذلك طريقٌ حول البوابة لا خطأُ تسمية.
  CONSTRAINT event_messages_type_in_channel CHECK (split_part(type, '.', 1) = channel),
  CONSTRAINT event_messages_chain_linked CHECK ((seq = 1) = (prev_hash = 'genesis')),
  CONSTRAINT event_messages_hash_unique UNIQUE (hash),
  CONSTRAINT event_messages_channel_seq_unique UNIQUE (channel, seq)
);

COMMENT ON TABLE state.event_messages IS
  'رسائلُ قنوات الأحداث: تدفّقٌ لكل مجال بسلسلة تجزئةٍ لكل قناة على حدة. يُكتب فيه ولا يُعدَّل، ولا يحمل مادّةً ولا سرّاً — قناةٌ تحمل المادة تصير طريقاً حول بوابة الوصول وحول التعمية معاً.';

-- القراءةُ تمشي دائماً «قناةٌ ثم ما بعد موضعٍ»: فهرسٌ مركّب لا فهرسان.
CREATE INDEX event_messages_channel_seq_idx ON state.event_messages (channel, seq);
CREATE INDEX event_messages_type_idx ON state.event_messages (type, recorded_at DESC);

CREATE TABLE state.event_offsets (
  id state.entity_id PRIMARY KEY,
  -- `group` كلمةٌ محجوزة في SQL، فالعمود `consumer_group` والحقل `group`.
  consumer_group text NOT NULL CHECK (length(btrim(consumer_group)) > 0),
  channel text NOT NULL CHECK (length(btrim(channel)) > 0),
  -- صفرٌ لمن لم يقرأ بعد. لا سالبَ: موضعٌ سالب لا يقابل رسالةً في القناة.
  committed_seq integer NOT NULL DEFAULT 0 CHECK (committed_seq >= 0),
  committed_at text NOT NULL CHECK (
    committed_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$'
  ),
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT event_offsets_group_channel_unique UNIQUE (consumer_group, channel)
);

COMMENT ON TABLE state.event_offsets IS
  'مواضعُ قراءة القنوات: صفٌّ لكل «مجموعةِ استهلاكٍ × قناة» يحمل آخر ترقيمٍ عُولج وثُبِّت. التقدّمُ إلى الأمام وحده مقبول، ويُفرض في `EventBus.commit()`؛ وتراجعُ الموضع إعادةُ معالجةٍ صامتة.';

CREATE INDEX event_offsets_group_idx ON state.event_offsets (consumer_group);
