# قنوات الأحداث — العقود والنقل والتخليص

> **الحالة:** نُفِّذت في الخطوة `M7.07` (السجل: `docs/roadmap/05-work-log.md#WL-031`).
> **الحاجز:** `npm run guard:events` — البوابة السادسة عشرة في `npm run validate`.
> **الدليل:** `tests/events/event-bus.test.mjs` — 14 اختباراً.

---

## 1. ما كان قبل هذه الوثيقة

كانت خارطةُ الطريق تسمّي «قنوات الأحداث الستّ عشرة»، وكان في المستودع
مجلَّداتٌ بأسمائها **فارغة** — ومنها جاء العددُ «16». والعددُ الحقّ بعد
جردِ مواضع النشر الفعلية في `src/` هو **18 قناةً و84 نوعاً**، والفرقُ
مُعلَنٌ في ترويسة `config/events.yaml` ولم يُخفَ بإعادةِ ترقيمٍ صامتة.

ولم يكن في المستودع ناقلُ أحداثٍ أصلاً. الموجودُ كان `EventLog` في
`src/root-of-trust/event-log.mjs`: سجلٌّ **متزامنٌ في الذاكرة** يُلحِق
سطراً بسلسلةِ تجزئةٍ ويُشهد عليه — وهو صالحٌ لما بُني له (أثرٌ لا يُنكَر)
ولا يوزّع شيئاً على أحد. فلم يكن هناك:

- عقدُ حِملٍ لأي نوعِ حدث — أيُّ حقلٍ يُكتب في `data` كان مقبولاً؛
- موضعُ قراءةٍ لأي مستهلك — فلا استئنافَ من حيث تُرك ولا كشفَ تأخُّر؛
- تخليصٌ يُقاس قبل التسليم — فحدثُ قناةٍ سياديّة يُقرأ كحدثِ قناةٍ داخلية؛
- نسخةُ قناةٍ ولا خطُّ أساسٍ يكشف كسرَ التوافق الخلفي.

---

## 2. السياسة بياناً محكوماً بمخطَّط

`config/events.yaml` هو المصدرُ الوحيد، ويتحقّق منه
`config/schemas/events.schema.json` بـ`additionalProperties: false` عند كل
تحميل (`loadEventsPolicy`) — فحقلٌ مكتوبٌ بخطأٍ إملائي يُرفض ولا يُهمَل
بصمت. الحقولُ العامّة:

| الحقل | معناه |
| --- | --- |
| `version` | نسخةُ السياسة نفسها |
| `owner` | المالكُ الحاكم (`crown`) |
| `maxBatch` | سقفُ ما يُسلَّم في استهلاكٍ واحد (500) |
| `relayRoles` | الأدوارُ التي يحقّ لها النقلُ من `EventLog` |
| `forbiddenPayloadKeys` | مفاتيحُ محرَّمة في أي حِمل: `content`، `plaintext`، `material`، `secret`، `password`، `token`، `privateKey` |
| `repositoryHolders` | الوحداتُ الوحيدةُ المسموحُ لها لمسُ مستودعي الأحداث |

### القنوات الثماني عشرة

| القناة | الموضوع | التصنيف | النسخة | الأنواع | المنتِجون | المستهلكون |
| --- | --- | --- | --- | --- | --- | --- |
| `agent` | حالاتُ هويّات الوكلاء وتسجيلُها | internal | v1 | 6 | role:king، role:operator | king، auditor، minister، operator، chief-justice |
| `capability` | منحُ القدرات وسحبُها ورفضُها | internal | v1 | 5 | role:king، role:minister | king، auditor، minister، operator، chief-justice |
| `court` | القضايا: فتحُها وسماعُها والحكمُ فيها واستئنافُها | sensitive | v1 | 4 | role:chief-justice، role:king | king، auditor، minister، operator |
| `crown` | أوامرُ التاج وقبولُها وإيقافُها الطارئ | sovereign | v1 | 4 | role:king | king، auditor |
| `data` | أصولُ البيانات وتصنيفاتُها واعتماداتُها ونسبُها | sensitive | v1 | 10 | role:operator، role:minister، role:king | king، auditor، minister، operator |
| `egress` | الخروجُ إلى الخارج: ما أُرسل وما رُفض | sensitive | v1 | 2 | role:operator، role:king | king، auditor، minister، operator |
| `halt` | مِفتاحُ الإيقاف: إصدارُه وتأكيدُه واستئنافُ العمل | sovereign | v1 | 3 | role:king | king، auditor |
| `identity` | بوابةُ الهوية وتجريدُ القدرات عند العبور | internal | v1 | 1 | role:king، role:operator | king، auditor، minister، operator، chief-justice |
| `incident` | سجلُّ الحوادث: فتحُها وإغلاقُها | sensitive | v1 | 2 | role:operator، role:auditor، role:king | king، auditor، minister، operator |
| `inference` | الاستدلال: ما تمّ وما رُفض | sensitive | v1 | 2 | role:operator، role:agent | king، auditor، minister، operator |
| `isolation` | العزلُ التنفيذي: بدؤُه وانتهاؤُه ومنعُ الهروب منه | internal | v1 | 5 | role:operator | king، auditor، minister، operator، chief-justice |
| `kernel` | نواةُ التنفيذ: المهامُّ وتصريحُها ووضعُ السلامة | internal | v1 | 7 | role:operator، role:king | king، auditor، minister، operator، chief-justice |
| `law` | القوانين: اقتراحُها وسَنُّها وتعليقُها وإلغاؤها | internal | v1 | 5 | role:king، role:chief-justice، role:minister | king، auditor، minister، operator، chief-justice |
| `memory` | ذاكرةُ الوكلاء: إنشاؤُها وانتهاؤُها وعزلُها | sensitive | v1 | 5 | role:operator، role:agent | king، auditor، minister، operator |
| `model` | النماذج: تسجيلُها وتقييمُها وتفعيلُها والتراجعُ عنها | internal | v1 | 13 | role:king، role:operator | king، auditor، minister، operator، chief-justice |
| `policy` | قراراتُ السياسة وخصمُ الحصص | internal | v1 | 2 | role:operator، role:king، role:minister، role:agent | king، auditor، minister، operator، chief-justice |
| `quarantine` | الحجرُ الصحّي: الإشاراتُ والعزلُ والإفراج | sensitive | v1 | 4 | role:operator، role:king | king، auditor، minister، operator |
| `retention` | الاحتفاظُ والمحو: ما مُحي ومتى وبأيّ شاهد | sensitive | v1 | 4 | role:operator، role:king | king، auditor، minister، operator |

**قاعدةُ المستهلكين ليست اعتباطاً**: هي مقيسةٌ على مراتب التصنيف في
`config/classification.yaml`. القناةُ السياديّة (`crown`، `halt`) لا يقرؤها
إلا الملكُ والمدقّق؛ والحسّاسةُ تُضيف الوزيرَ والمشغّل؛ والداخليّةُ تُضيف
رئيسَ القضاة. والتخليصُ يُقاس في الكود بـ`lattice.dominates` لا بمقارنةِ
نصوص.

### العقود

لكل نوعٍ في كل قناة: `required` (حقولٌ يضمنها العقد)، `optional` (حقولٌ
مسموحة)، `open` (هل تُقبل حقولٌ غيرُ معلَنة). **الأنواعُ المفتوحةُ سبعةٌ
فقط** وكلُّها أنواعُ رفضٍ أو حادثٍ تختلف تفاصيلُها بحسب السبب:
`crown.command.accepted`، `data.access.refused`، `egress.refused`،
`incident.opened`، `inference.refused`، `model.rolled-back`،
`quarantine.signal`.

> **حدٌّ معلَن:** العقودُ تضمن **حضورَ الحقول لا أنواعَ قيمها**. حقلٌ واجبٌ
> قيمتُه `null` أو رقمٌ حيث يُنتظر نصٌّ يمرّ. ضبطُ الأنواع يلزمه مخطَّطُ
> حِملٍ لكل نوعٍ من الأربعة والثمانين، وهو عملٌ لم يُنفَّذ ولم يُدَّعَ.

---

## 3. الناقل

`src/events/event-bus.mjs` — الصنف `EventBus`:

```js
const bus = new EventBus({ policy, lattice, messages, offsets, now });
```

| الطريقة | ما تفعله وما ترفضه |
| --- | --- |
| `publish({ type, actor, payload, authorId, relayed })` | يُحدّد القناةَ من النوع، ويرفض: النوعَ المجهول (`EVENT_TYPE_UNKNOWN`)، وحقلاً واجباً ناقصاً أو حقلاً غيرَ معلَنٍ في عقدٍ مغلق (`EVENT_CONTRACT_VIOLATION`)، ومفتاحاً محرَّماً (`EVENT_FORBIDDEN_FIELD`)، ودوراً ليس من منتِجي القناة (`EVENT_PUBLISH_REFUSED`) — **كلُّه قبل الكتابة لا بعدها**. ثم يُسلسل: تسلسلٌ لكل قناةٍ يبدأ من 1، و`prevHash` يربط الرسالةَ بسابقتها (أولاها بـ`genesis`). |
| `consume({ channel, group, consumer, limit, minVersion })` | يرفض قناةً مجهولة، ودوراً ليس من مستهلكيها، وتخليصاً لا يهيمن على تصنيفها (`EVENT_CONSUME_REFUSED`)، ونسخةً أدنى من المطلوبة (`EVENT_VERSION_UNSUPPORTED`). يُسلّم من الموضعِ المثبَّت لا من الرأس، ويعيد `{ messages, fromSeq, headSeq, lag }`. |
| `commit({ channel, group, seq })` | يرفض تراجعَ الموضع وتثبيتَه فوق الرأس (`EVENT_OFFSET_INVALID`) — فلا يُعاد ما عُولج ولا يُتخطّى ما لم يُعالَج. |
| `relay({ events, actor })` | ينقل أحداث `EventLog` الحقيقية إلى قنواتها بدورٍ من `relayRoles`، ويتوقّف **مغلقاً** عند أول حدثٍ يخالف عقدَه فلا يتجاوزه، ويعيد `{ relayed, fromSeq, toSeq, perChannel, stoppedAt, fault }`. النقلُ **مُتماثلُ التكرار**: إعادتُه لا تضاعف الرسائل. |
| `verifyChannel(channel)` / `verifyAll()` | يعيدان حسابَ سلسلة التجزئة فيكشفان العبثَ بالمخزن. |

### الرموز

`EVENTS_CONFIG_INVALID`، `EVENT_TYPE_UNKNOWN`، `EVENT_CONTRACT_VIOLATION`،
`EVENT_FORBIDDEN_FIELD`، `EVENT_VERSION_UNSUPPORTED`،
`EVENT_PUBLISH_REFUSED`، `EVENT_CONSUME_REFUSED`، `EVENT_OFFSET_INVALID`،
`EVENT_CHAIN_BROKEN`، `EVENT_INPUT_INVALID`.

---

## 4. التخزين

الهجرة `migrations/0010_event_channels.up.sql`:

- `state.event_messages` — القناةُ والنوعُ ونسخةُ العقد والتسلسلُ والفاعلُ
  ودورُه والتصنيفُ والحِملُ (`jsonb`) و`prev_hash` و`hash`. القيود:
  `event_messages_type_in_channel` (النوعُ يبدأ باسم قناته)،
  `event_messages_chain_linked` (أولى القناة وحدَها تحمل `genesis`)،
  `event_messages_hash_unique`، `event_messages_channel_seq_unique`.
- `state.event_offsets` — المجموعةُ والقناةُ والموضعُ المثبَّت ووقتُه، بقيد
  `event_offsets_group_channel_unique`. وسُمّي عمودُ الوقت `committed_at`
  تمييزاً له عن `updated_at` في بقيّة الجداول: هو **وقتُ تثبيتِ موضعِ
  قراءةٍ** لا وقتُ آخرِ تعديلٍ لصف.
- والنزول يرفض بـ`RAISE EXCEPTION` إن كان في الجدول رسائل — الهبوطُ لا
  يمحو أثراً.

---

## 5. الحاجز

`scripts/guard-events.mjs` بستّ قواعد:

1. **R1** — السياسةُ تُحمَّل وتُطابق مخطَّطَها.
2. **R2** — كلُّ موضعِ نشرٍ فعليٍّ في `src/` له عقدٌ معلَن، وكلُّ عقدٍ له
   موضعُ نشرٍ أو استثناءٌ مُعلَن. الجردُ باستخراج شجرة TypeScript
   (`scripts/lib/event-emissions.mjs`) لا بتعبيرٍ نمطيّ — **79 موضعاً**.
3. **R3** — لا مفتاحَ محرَّماً في أي عقد.
4. **R4** — مستهلكو كل قناةٍ متوافقون مع تصنيفها في مشبَّك التصنيف.
5. **R5** — لا وحدةَ خارجَ `repositoryHolders` تلمس مستودعي الأحداث.
6. **R6** — لا كسرَ توافقٍ خلفي عن `config/events.baseline.json`: حذفُ
   قناةٍ أو نوعٍ، أو إضافةُ حقلٍ واجبٍ إلى عقدٍ قائم، أو خفضُ نسخةٍ.

> **حدٌّ معلَن:** نوعٌ يُنشَر من موضعِ قالبٍ (`` `model.${state}` ``) ومن
> موضعٍ صريحٍ معاً يُنسَب إلى الصريحِ وحدَه، فلا يُحاسَب القالبُ عليه
> مرّتين. والقالبُ لا يُوسَّع إلا مقطعاً واحداً.

---

## 6. ما لم يُنفَّذ في هذه الخطوة

1. **الباعثون الخمسةُ والعشرون في `src/` ما زالوا يُنادون
   `EventLog.append` مباشرةً** ولم يُعَد توصيلُهم عبر `publish`. النقلُ
   (`relay`) هو الجسر، فالتسليمُ **ليس فوريّاً** بل بمقدار تشغيلِ النقل.
   إعادةُ التوصيل تغييرٌ واسعٌ في مسارٍ سياديّ، موضعُها خطوةٌ لاحقة.
2. **الهجرة `0010` لم تُشغَّل على PostgreSQL** — لا `DATABASE_URL` ولا
   `docker` في بيئة التنفيذ. القيودُ مقروءةٌ نصّاً ومُختبرةٌ في CI حيث
   القاعدة قائمة.
3. **لا مُطلِقَ في القاعدة يمنع `UPDATE`/`DELETE`** على `event_messages`:
   العبثُ **يُكشف بالسلسلة ولا يُمنع**.
4. **لا قيدَ في القاعدة يربط `prev_hash` بتجزئةِ الصفِّ `seq-1`** — الربطُ
   محسوبٌ في الكود وفي `verifyChannel`.
5. **الضمانُ «مرّةً على الأقل»** لا «مرّةً بالضبط»: مستهلكٌ يعطب بعد
   المعالجة وقبل `commit` يُعيد المعالجة.
