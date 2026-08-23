# طبقة الاستمرارية — المخطَّط والهجرات والمستودعات

هذه الوثيقة هي **المراجعة الموثَّقة للمخطَّط** التي يطلبها معيار قبول `M3.02`،
ومرجعُ من يشغّل القاعدة أو يضيف هجرة. وهي ليست وعداً: ما لم يُنجَز مذكور صريحاً
في «ما لم يُنجَز بعد».

## 1. تشغيل القاعدة

```bash
docker compose up -d                                   # PostgreSQL 18.6 على 127.0.0.1:5432
# مع مصادقة trust التطويرية لا كلمة مرور في الوصلة أصلاً:
export DATABASE_URL=postgresql://state@127.0.0.1:5432/state
npm run migrate -- status                              # حالة كل هجرة
npm run migrate -- up                                  # تقديم
npm run migrate -- down --steps 1                      # تراجع
npm test                                               # اختبارات القاعدة تعمل عند وجود DATABASE_URL
```

**لا وصلة افتراضية.** `resolveDatabaseConfig` ترفض العمل بلا `DATABASE_URL`
وترمي `DATABASE_URL_MISSING`؛ لأن السقوط الصامت إلى `localhost` يجعل اختباراً
يكتب في قاعدة إنتاج بلا أن ينطق. وفي بيئة إنتاج ترفض وصلةً بلا TLS
(`DATABASE_TLS_REQUIRED`).

**مصادقة القاعدة في `docker-compose.yml` هي `trust` للتطوير وحده** — حدٌّ معلَن
في `ADR-0001` وموضع إصلاحه `M9`.

## 2. المخطَّط الأول (الهجرة `0001`)

كل شيء داخل مخطَّط `state`، لا في `public`. ودفتر الهجرات وحده في `public`
لأن التراجع يُسقط `state` كاملاً ولا يجوز أن يُسقط دفتره معه.

مجالان يحرسان المعرّفات والنسخ:

- `state.entity_id` — نص من 3 إلى 64 محرفاً بنمط `^[a-z][a-z0-9-]*[a-z0-9]$`.
- `state.version_number` — عدد صحيح ≥ 1.

الجداول العشرة: `agents`، `models`، `events`، `commands`، `laws`، `cases`،
`policies`، `quotas`، `data_assets`، `memories`.

### ما تحرسه القاعدة نفسها (لا التطبيق)

| الجدول | القيد | ما يمنعه |
| --- | --- | --- |
| `agents` | `agents_suspension_has_reason` | تعليق وكيل بلا سبب مكتوب |
| `models` | `models_approval_has_approver` | نموذج «معتمد» بلا معتمِد |
| `models` | `models_one_approved_per_purpose_idx` | نموذجان معتمدان لغرض واحد |
| `events` | `events_hash_unique` + `events_prev_hash_unique` + `events_hash_not_prev` | تجزئة مكرّرة، أو حدثان يدّعيان السابق نفسه (تشعّب السلسلة)، أو حدث سابقه نفسه |
| `commands` | `commands_settled_iff_terminal` | «محسوم» بلا وقت حسمٍ وسبب، أو وقت حسمٍ لأمرٍ غير نهائي |
| `laws` | `laws_enactment_complete` / `laws_repeal_after_enactment` | نفاذ بلا سلطة أو تاريخ، وإلغاء قبل النفاذ |
| `cases` | `cases_judgment_needs_hearing` / `cases_verdict_iff_judged` | حكم قبل سماع، أو حكم بلا حالة حُكم |
| `policies` | `policies_enabled_needs_approver` | سياسة مفعَّلة بلا اعتماد |
| `quotas` | `quotas_consumed_within_limit` | استهلاك يتجاوز الحدّ |
| `data_assets` | `data_assets_hold_blocks_zero_retention` | أصلٌ محفوظ قانوناً باحتفاظ صفري |
| `memories` | `memories_hold_has_no_expiry` | ذاكرة محفوظة قانوناً لها تاريخ انتهاء |

هذه القيود ليست موثوقة لأنها مكتوبة هنا: `tests/persistence/schema.test.mjs`
يُدخل صفّاً يخالف كل واحدٍ منها ويتحقّق أن القاعدة ترفضه.

## 3. مراجعة الأعمدة التي تقبل الفراغ

معيار `M3.02` هو «صفر عمود بلا قيد ضروري». والفراغ المسموح مُحصور في القائمة
التالية، وكل مفتاح فيها **مذكور بنصّه** في `DECLARED_NULLABLE` في ملف اختبار
المخطَّط. فإن أُضيف عمود يقبل الفراغ ولم يُعلَن — أو أُعلن ولم يُشرح هنا — أخفقت
البوابة. وكل واحدٍ من هذه الأعمدة يصير إلزامياً بقيدٍ حين تقتضي الحالة ذلك:

| العمود | سبب السماح بالفراغ | ما يُلزمه عند الحاجة |
| --- | --- | --- |
| `agents.suspended_reason` | وكيل غير معلَّق لا سبب له | `agents_suspension_has_reason` |
| `models.approved_by` | لا معتمِد قبل الاعتماد | `models_approval_has_approver` |
| `events.prev_hash` | أول حدث في السلسلة لا سابق له | `events_prev_hash_unique` + `events_hash_not_prev` |
| `commands.settled_at` | أمر محجوز لم يُحسم | `commands_settled_iff_terminal` |
| `commands.settle_reason` | لا سبب حسمٍ قبل الحسم | `commands_settled_iff_terminal` |
| `laws.enacted_by` | مشروع القانون لا سلطة نفاذ له | `laws_enactment_complete` |
| `laws.enacted_at` | مشروع القانون لا تاريخ نفاذ له | `laws_enactment_complete` |
| `laws.repealed_at` | القانون النافذ غير ملغى | `laws_repeal_after_enactment` |
| `cases.heard_at` | القضية المفتوحة لم تُسمع | `cases_judgment_needs_hearing` |
| `cases.verdict` | لا حكم قبل السماع | `cases_judgment_needs_hearing` |
| `cases.closed_at` | القضية الجارية غير مغلقة | `cases_closed_iff_state_closed` |
| `policies.law_id` | سياسة تشغيلية قد لا تستند إلى نصٍّ قانوني | مفتاح خارجي عند وجوده |
| `policies.approved_by` | لا معتمِد قبل الاعتماد | `policies_enabled_needs_approver` |
| `memories.expires_at` | ذاكرة بلا انتهاء صريح | سياسة الاحتفاظ في `M3.08` — **لم تُبنَ بعد** |

## 4. الهجرات

ملفان لكل هجرة: `NNNN_name.up.sql` و`NNNN_name.down.sql`. والنظام يرفض قبل
التنفيذ: اسماً لا يطابق الصيغة، ورقماً مكرّراً، وثغرة في الترقيم، وهجرةً بلا
ملف تراجع، وبصمةَ ملفٍ تغيّرت بعد تطبيقه، وصفَّ نسخةٍ لا ملف له.

كل هجرة وصفُّ دفترها في **معاملة واحدة**: هجرة تسقط في منتصفها لا تُخلّف
مخطَّطاً نصف مطبَّق — وهذا مُختبَر بهجرة تُنشئ جدولاً ثم تُخطئ عمداً.

وقبل أي عمل يُؤخذ **قفل استشاري** (`pg_advisory_lock`) فلا يهاجر مسارَان معاً.

معيار «up ثم down يعودان بالقاعدة إلى حالتها الأصلية» يُقاس بصورة نصّية من
كتالوج القاعدة (مخطَّطات، أعمدة، قيود، فهارس، مجالات) قبل التقديم وبعد
التراجع، وتُقايس الصورتان حرفاً بحرف.

## 5. المستودعات وعقدها

مواصفة واحدة لكل كيان (`src/persistence/entities.mjs`) تُغذّي تطبيقَين:
`repository-memory.mjs` و`repository-postgres.mjs`. والعقد:
`insert`, `findById`, `list`, `count`, `update`, `remove` — والتحديث والحذف
يأخذان **رقم النسخة المتوقَّع** ويرفضان القديم بـ`VERSION_CONFLICT`.

رموز الأخطاء موحَّدة بين التطبيقين: `DUPLICATE_ID`, `DUPLICATE_UNIQUE`,
`INVALID_RECORD`, `UNKNOWN_FIELD`, `NOT_FOUND`, `VERSION_CONFLICT`,
`UNSUPPORTED_FILTER`. وأخطاء PostgreSQL تُترجَم إلى هذه الرموز، ولا يُسمح
بترشيح على حقل غير مدعوم (يُرفض ولا يُتجاهل صامتاً).

`tests/persistence/repository-contract.test.mjs` مجموعةٌ واحدة تُشغَّل بنصّها
على التطبيقين، لأن تطبيق ذاكرة أرخى من القاعدة يُطمئن كذباً.

## 6. ما لم يُنجَز بعد

| الخطوة | ما ينتظر |
| --- | --- |
| `M3.05` | تحويل السجلات وقاعدة البذور إلى هذه المستودعات — السجلات لا تزال ملفات JSON مُوقَّعة |
| `M3.06` | معاملات على العمليات المركّبة وإثبات ذرّيتها عبر جدولين |
| `M3.07` | نسخ احتياطي واستعادة بتمرين مقيس الزمن — **بدونه لا يجوز قول «الحالة محفوظة»** |
| `M3.08` | سياسة احتفاظ ومحو، وهي ما يجعل `memories.expires_at` مُحكَماً |
| `G3` | لا تُفتح قبل الأربعة أعلاه |
