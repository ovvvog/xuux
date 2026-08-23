-- الهجرة 0003 — حوكمة إصدارات السياسة ومحاكي الأثر (M4.06 وM4.08).
--
-- قبل هذه الخطوة كانت السياسة ملف YAML: من يملك الكتابة على القرص يغيّر قرار
-- الدولة مباشرةً، بلا اعتمادٍ مستقل، ولا توقيعٍ يربط المعتمد بالمادة، ولا سجل
-- تغيّرات، ولا طريقٍ مراجع للتراجع. ذلك عيب سلطوي لا نقص راحة للمطوّر؛ فالتغيير
-- في قاعدة القرار هو نفسه فعلٌ سيادي، ولا يكفي أن يبدو ملفاً صحيحاً.
--
-- تفصل الجداول بين نسخ السياسة وقراراتها السابقة. لا يُخزّن المحاكي «تخميناً»
-- عن أفعال محتملة، بل يعيد تقييم طلباتٍ وقع عليها قرار فعلاً. ولا تعني هذه
-- الهجرة أن كل مسار تشغيل صار يكتب سجل القرارات تلقائياً: ربط نقطة التفويض
-- بالمصرف مسؤولية تركيبٍ لاحقة، وهو حدٌّ معلن في وثيقة الحوكمة.

CREATE TABLE state.policy_versions (
  policy_id text NOT NULL CHECK (length(btrim(policy_id)) BETWEEN 1 AND 200),
  version integer NOT NULL CHECK (version >= 1),
  -- الوثيقة كائن سياسة كامل لا نص YAML: يبقى ما اعتمد فعلاً قابلاً للقراءة حتى
  -- إن تغيّر تنسيق الملف أو اختفى من القرص. كائنٌ فقط، لأن مصفوفة أو قيمة مفردة
  -- ليست سياسة ولا يمكن للمحرّك أن يقيّمها.
  document jsonb NOT NULL CHECK (jsonb_typeof(document) = 'object'),
  change_reason text NOT NULL CHECK (length(btrim(change_reason)) > 0),
  proposed_by text NOT NULL CHECK (length(btrim(proposed_by)) > 0),
  approved_by text CHECK (approved_by IS NULL OR length(btrim(approved_by)) > 0),
  approval_signature text CHECK (
    approval_signature IS NULL OR length(btrim(approval_signature)) > 0
  ),
  active boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT date_trunc('milliseconds', now()),
  -- المفتاح الأوّلي هو (السياسة، النسخة) لا معرّفاً مولَّداً: النسخة الثانية من
  -- سياسةٍ هي هويتها نفسها، ومعرّفٌ مولَّد فوقها يسمح بصفّين لنفس النسخة ثم
  -- يجعل «أي الصفّين اعتُمد» سؤالاً بلا جواب.
  CONSTRAINT policy_versions_pkey PRIMARY KEY (policy_id, version),
  -- التنشيط هو لحظة النفاذ، ولذلك يُمنع في القاعدة نفسها إن غاب اسم المعتمد أو
  -- توقيعه. ففحص JavaScript وحده يمكن تجاوزه بكتابة SQL مباشرةً، وهذا القيد لا.
  CONSTRAINT policy_versions_active_needs_approval CHECK (
    NOT active OR (approved_by IS NOT NULL AND approval_signature IS NOT NULL)
  )
);

-- سياسة نافذة واحدة لكل معرّف. القيد الجزئي أقوى من ترتيب التطبيق: حتى عميل SQL
-- آخر لا يستطيع إبقاء نسختين نافذتين عند التزامن أو بعد خطأ في برنامج الحوكمة.
CREATE UNIQUE INDEX policy_versions_one_active_per_policy_idx
  ON state.policy_versions (policy_id)
  WHERE active;

CREATE TABLE state.policy_decisions (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_id text NOT NULL CHECK (length(btrim(actor_id)) > 0),
  actor_role text NOT NULL CHECK (length(btrim(actor_role)) > 0),
  -- حالة الفاعل ونوعه ونطاقه حقائق لازمة لإعادة التقييم؛ الاقتصار على المعرّف
  -- والدور كان سيجعل المحاكي يختبر فاعلاً مختلفاً عن الفاعل الذي وقع عليه القرار.
  actor_state text NOT NULL CHECK (length(btrim(actor_state)) > 0),
  actor_kind text CHECK (actor_kind IS NULL OR length(btrim(actor_kind)) > 0),
  actor_scope text CHECK (actor_scope IS NULL OR length(btrim(actor_scope)) > 0),
  action text NOT NULL CHECK (length(btrim(action)) > 0),
  resource jsonb NOT NULL CHECK (jsonb_typeof(resource) = 'object'),
  context jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(context) = 'object'),
  scope text CHECK (scope IS NULL OR length(btrim(scope)) > 0),
  royal_command_id text CHECK (
    royal_command_id IS NULL OR length(btrim(royal_command_id)) > 0
  ),
  code text NOT NULL CHECK (length(btrim(code)) > 0),
  allowed boolean NOT NULL,
  policy_id text,
  policy_version integer CHECK (policy_version IS NULL OR policy_version >= 1),
  created_at timestamptz NOT NULL DEFAULT date_trunc('milliseconds', now()),
  -- قرارٌ لا تحكمه سياسة جائز (فعل مجهول مثلاً)، لكن نسخةً بلا معرّف سياسة
  -- تضليل في سجل التدقيق، لذلك يُلزم القيد وجودهما معاً أو غيابهما معاً.
  CONSTRAINT policy_decisions_policy_reference_complete CHECK (
    (policy_id IS NULL) = (policy_version IS NULL)
  )
);

-- القراءة الزمنية للمحاكي هي مساره الطبيعي؛ الفهرس يمنع أن يتحول تقرير أثرٍ
-- دفاعي إلى مسحٍ كامل مع نمو دفتر القرار.
CREATE INDEX policy_decisions_created_at_idx ON state.policy_decisions (created_at);
