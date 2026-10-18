# مراجعة متابعة WL-414 — gpt_6_1_sol

## الخلاصة التنفيذية

الرأس المقيس هو `3e67d362dc4f30ec35f73957fd5542be47a3a875` في نسخة معزولة تحت `gpt_6_1_sol/repo`؛ خرج `npm ci` والبناء `0`، والحالة المتعقبة في نهاية العمل فارغة، وفرق الملفات الأربعة المحمية عن `8b48a568` فارغ. [الفحص الأول](static/preflight.txt)، [الفحص الأخير](final-audit.txt).

- **انكسرت سلسلة R3SOL-01 الكاملة:** زرعت كائنين حارسين، وقدمت صفحة تخفي الثاني بتكرار الأول، وجهزت استبدال مقبض الإنشاء بالضحية المخفية؛ توقف الرأس عند صفحة خط الأساس، فلم يصل إلى الحقن الثاني، وبقي الكائنان ولم يرسل تحريرًا لهما؛ النواة السابقة شغلت الحقنين وحررت الضحية بالمسبر نفسه. [الرأس](independent/duplicate-alias.json)، [الضابط السابق](control-before-fix/duplicate-alias.json).
- **ظهر تغير فعلي في التفويض والجرد والبنى:** رُفض تبادل ملفي password/policy في الاتجاهين، وnonce سياسة بطول 16 والبت `0x08`، والتكرار المتعدد والترتيب التنازلي والتكرار عبر الصفحات وما دون نقطة البدء؛ وخط الأساس الجزئي لا ينتج `postRunInventory.verified=true`. [ملخص القياس والاختبارات التأكيدية](review-summary.json)، [نتائج التأكيد](checks.log).
- **الفقد الفعلي لرد التعريف لا يحذف الفهرس:** أسقط ناقلي رد نجاح حقيقيًا بعد تنفيذ التعريف، فبقي المرشح معلنًا، وبقي أيضًا فهرس NV أجنبي مزروع قبل البروفة، ولم تُرسل محاولة حذف؛ وبقي فهرس أجنبي آخر مطابق المنطقة العامة عندما ضاع رد فشل تعريف البروفة بعد زرعه. [فقد النجاح مع فهرس سابق](independent/loss-define.json)، [الفهرس المطابق](independent-extra/loss-define-foreign-matching.json).
- **بقيت فجوتان متوسطتا النطاق في تحليل الردود:** قبول تذكرة PolicySigned غير المتسقة مع `expiration=0`/NULL، وقبول حقول إنشاء تناقض الطلب أو شروط اسم الأصل؛ لا تعني الإصلاحات الحالية تحققًا شاملاً من محتوى الردود. [تذكرة NULL ببصمة](independent/policy-digest-1.json)، [outsideInfo](independent/creation-outsideinfo.json)، [اسم الأصل](independent/creation-parentname.json).
- **لم تتكرر يتامى مسار إنهاء الاختبار العادي، لكن بقي تسرب في فشل التجهيز:** المجموعة الأصلية خرجت `0` وحقول TAP هي `tests=73, pass=73, fail=0, skipped=0`، ولم تضف عملية swtpm باقية عند خروج Node؛ أما حقن فشل استعلام الجاهزية فأبقى عملية واحدة حية فور خروج Node وقبل تدخلي لتنظيفها. [المجموعة](shipped/suite.tap)، [العد الفوري بعد المجموعة](shipped/processes-immediately-after-suite.txt)، [العد الفوري بعد فشل التجهيز](readiness-failure/processes-immediately-after.txt).
- **ظهرت ملاحظتان منخفضتان في التغييرات نفسها:** نص المصالحة يعد بمحاولة تنظيف بعدما استُنفدت، وفرع timeout الجديد يرفض رد swtpm حقيقيًا صالحًا عند expiration موجب؛ الثانية خارج بروفات المراحل الحالية التي ترسل الصفر. [المصالحة](independent-extra/cleanup-undefine-before.json)، [رد expiration=3600](positive-expiration/current-3600.txt)، [المواضع المقروءة](static/code-excerpts.txt).

هذا تقرير قياس لا حكم جاهزية ولا إغلاق لـ`R3-A-01` أو `EXT-6`؛ ولم أغير أي شيفرة متعقبة أو إعداد مراجعة أو فرع ولم أنفذ مرحلة على عتاد. [الفحص الأخير](final-audit.txt)، [مشغّل المسابر](run-independent.sh)، [مشغّل المجموعة](run-shipped.sh).

## 1. النطاق والبيئة والاستقلال

قرأت `brief-common.md`، وحزمة الجولة السابقة داخل نسختي: تقارير الأعضاء الثلاثة و`COLLECTION.md` و`brief.md`؛ وراجعت فرق `d9e1dc3b^..HEAD` في النواة وأدوات الحقن والاختبارات والوثائق، ثم تاريخ تغييرات قائمة السماح اللاحقة. [حزمة الجولة السابقة](repo/docs/external-review/reports/adr0007-ceremony-wl413-r3-remediation-review/COLLECTION.md)، [فرق النواة](static/core.diff)، [فرق الاختبارات](static/tests.diff)، [فرق الوثائق](static/docs.diff)، [تاريخ السماح](static/allowlist-history.txt).

بيئتي: Node `v20.20.2`، swtpm `0.10.1`، tpm2-tools `5.7`، Mono C# `6.14.1.0`، وPowerShell **`7.7.0-preview.5` لا 7.4**؛ هذا انحراف بيئي معلن، وليس قياس توافق مع إصدار 7.4 أو Windows PowerShell 5.1. [مخرجات الإصدارات والبناء](static/preflight.txt).

نسختي الخاصة هي الشجرة الوحيدة التي عملت فيها؛ لم أقرأ أي ملفات لمراجع متزامن تحت `/tmp/wl414-followup/reviewers/`، والاستثناء الوحيد خارج دليلي هو التكليف المشترك المطلوب صراحة؛ واستعملت قراءة Git اللازمة للنسخ فقط من المستودع الأصلي، لا أوامر داخله ولا تعديلًا عليه. [سجل التجهيز](setup-notes.txt)، [السكربتات الخاصة](run-independent.sh)، [الفحص الأخير](final-audit.txt).

الاستقلال هنا استقلال نسخة ومسابير ومجلدات وتعليمات، لا عزل حاوية أو نواة نظام: جدول العمليات والأدوات مشترك، ولذلك حفظت العدد الكلي وعدد العمليات المنسوبة إلى مساراتي على حدة، ولم أستعمل تقارير أعضاء هذه المتابعة أو أستشرهم. [العد المنسوب للمسارات](review-summary.json)، [أوامر رصد الفشل](run-readiness-failure.sh).

كل اتصالاتي المخصصة كانت إلى `127.0.0.1:7100` والتحكم `7101`؛ المجموعة الأصلية وحدها استعملت المنافذ العشوائية التي تنشئها اختبارات المستودع، وكانت ملفاتها المؤقتة تحت `shipped/tmp` بفضل `TMPDIR` الخاص. [مشغّل النقل المستقل](IndependentFollowup.cs)، [مشغّل المجموعة](run-shipped.sh).

لم أستخدم `/dev/tpm*` أو TBS أو نقل عتاد، ولم أشغل `tpm-sim-ci.sh` أو `npm run validate` أو `gh` أو دفعًا أو دمجًا؛ القياس الشامل هنا يخص ملفات المراسم الخمسة فقط، وليس إعادة إنتاج تعداد `validate` التاريخي. [أوامر المجموعة](shipped/commands.log)، [أوامر المسابر](independent/commands.log)، [الفحص الأخير](final-audit.txt).

جمعت **56 حالة بروفة مستقلة على الرأس و9 حالات ضابطة على النواة السابقة**، وجميع جامعيها خرجوا `0`؛ إضافة إلى مصفوفة مباشرة بلا شبكة، وتجربتي expiration على كل نواة، واختباري فشل متعمدين لعملية Node. خروج جامع JSON ليس حكمًا على البروفة: حالات `FAILED_CLOSED` و`TOOL_ERROR` محفوظة كما هي. [الفهرس المولد](review-summary.json)، [اختبارات التأكيد الـ25](checks.log)، [مصفوفة الحدود](static/schema-boundaries.txt)، [تجارب expiration](positive-expiration/commands.log).

## 2. الأولوية الأولى: المقابض وسلسلة إخفاء الضحية

كل صف أدناه شغله `mono IndependentFollowup.exe <mode> <output-directory>` على محاكٍ جديد، بعد بناء النواة الأصلية مع ناقلي خارج الشجرة؛ الأوامر الكاملة وأكواد الخروج وطلبات/ردود النقل موجودة بجانب JSON. [الناقل المستقل](IndependentFollowup.cs)، [أوامر التشغيل](independent/commands.log).

| الوضع | القياس على الرأس، خروج الجامع 0 | الدليل |
|---|---|---|
| `duplicate-alias` | الحارسان `0x80000000/0x80000001`؛ خط أساس `[A,A]` بدل `[A,B]`؛ `changes=1` لا 2؛ `RESPONSE_CAPABILITY_HANDLE_ORDER_MALFORMED`؛ لا CreatePrimary ولا FlushContext من البروفة؛ الجرد الخارجي أبقى `[A,B]` | [JSON](independent/duplicate-alias.json)، [بايتات النقل](independent/duplicate-alias.frames.txt) |
| `duplicate-many` | الصفحة `[A,A,A,B,B]` رُفضت عند أول تكرار؛ بقي الحارسان ولم يُحرر أيهما | [JSON](independent/duplicate-many.json) |
| `descending` | `[B,A]` رُفضت باسم ترتيب المقابض؛ لا تغيير بعد خط الأساس | [JSON](independent/descending.json) |
| `cross-page` | صفحة أولى `[A],more=1` ثم ثانية `[A,B]` مع طلب يبدأ من `A+1`؛ `changes=2`؛ رُفض التكرار عبر حد الصفحتين لأنه دون بداية الصفحة الثانية | [JSON](independent/cross-page.json)، [النقل](independent/cross-page.frames.txt) |
| `below-start` | صفحة اصطناعية أولى تنتهي عند `0x80000010` ثم مقبض `0x80000005` لطلب يبدأ `0x80000011`؛ رُفض قبل بناء خط أساس كامل | [JSON](independent/below-start.json) |

لم أكتف بافتراض أن عدم وصول حقن المقبض الثاني يعني سلامة المسبر: أعدت **نفس سلسلة الحقنين** على النواة المستخرجة من `d9e1dc3b^`، وهي `c1f80b6d7c8e6b40af2e906cd6997d4737b1189e`؛ هناك `changes=2`، و`flushed=["0x80000001"]`، والجرد تحول من `[0x80000000,0x80000001]` إلى `[0x80000000,0x80000002]`. [SHA الضابط](static/pre-fix-sha.txt)، [النواة المستخرجة](Core-before-d9e1dc3b.cs)، [نتيجة الضابط](control-before-fix/duplicate-alias.json)، [بايتاته](control-before-fix/duplicate-alias.frames.txt).

فالنتيجة المحددة: الرأس يمنع هذه السلسلة عند جرد خط الأساس، لا أنه يثبت أصالة كل جرد أو يمنع كل إخفاء محتمل؛ وصفحة مرتبة تحذف مقبضًا دون تكرار أو ادعاء صادق من طرف خبيث ليست مما تثبته هذه التجربة. [رفض الرأس](independent/duplicate-alias.json)، [فحوص الترتيب وحد الطلب](repo/sim/tpm-ceremony/TpmCeremonyCore.cs#L825).

فحصت أيضًا مباشرة فئات NV والجلسات والعابر: طلب 64 يقبل 64 صاعدة ويرفض 65، ومقبض من الفئة نفسها دون البداية مرفوض في الفئات الثلاث. [المصدر المستقل بلا نقل](SchemaBoundaries.cs)، [الخرج](static/schema-boundaries.txt)، [الخروج 0](static/schema-boundaries.exit).

## 3. الأولوية الثانية: نوع التفويض والهرمية والبصمات والحقول الداخلية

### 3.1 مواضع تغيرت في القياس

| المسبر | النتيجة المقيسة | الدليل الخام |
|---|---|---|
| ملف policy كامل على رد `NV_DefineSpace` بكلمة سر | `OUTCOME_UNKNOWN` و`RESPONSE_AUTH_CONTENT_MALFORMED … expected=password`؛ لا حذف للمرشح | [الرأس](independent/auth-policy-on-password.json)، [السابق الذي تابَع إلى COMPLETE](control-before-fix/auth-policy-on-password.json) |
| ملف password على رد زيادة بجلسة policy | `OUTCOME_UNKNOWN … expected=policy` | [الرأس](independent/auth-password-on-policy.json)، [السابق الذي تابَع](control-before-fix/auth-password-on-policy.json) |
| nonce سياسة 16، أو attrs=`0x08` | رفض مسمى لكل منهما؛ ردود السياسة العادية nonce=32/attrs=0 بقيت مستعملة في البروفة العادية | [nonce](independent/auth-policy-nonce16.json)، [attrs](independent/auth-policy-attrs08.json)، [العادي](independent/normal.json) |
| هرمية Creation وAuth | القيم الأربع `0x40000001/07/0B/0C` دخلت؛ `02` و`09` رُفضتا بـ`RESPONSE_TICKET_HIERARCHY_MALFORMED` في كلا الأمرين | [مصفوفة النتائج](review-summary.json)، [Creation/02](independent/creation-hierarchy-40000002.json)، [Auth/0C](independent/policy-hierarchy-4000000c.json) |
| بصمة تذكرة CreatePrimary | أطوال 0/1/32/63/65/100 رُفضت؛ 64 قُبلت، موافقة لقيد swtpm المنشور، لا ادعاء عن كل TPM | [63](independent/creation-digest-63.json)، [64](independent/creation-digest-64.json)، [100](independent/creation-digest-100.json) |
| بنية بيانات الإنشاء | حذف الحقول الذيلية، إضافة رابع، parentNameAlg=`ffff`، وقلب creationHash رُفضت؛ count=0/pcrDigest فارغ مع إعادة حساب creationHash قُبل | [ناقص](independent/creation-data-missing.json)، [زائد](independent/creation-data-extra.json)، [الخوارزمية](independent/creation-parentalg-invalid.json)، [البصمة](independent/creation-hash-flip.json)، [PCR الفارغ](independent/creation-pcr-empty.json) |
| timeout واسم Load | timeout غير فارغ عند expiration=0 رُفض؛ قلب اسم Load رُفض بمطابقة البصمة | [timeout](independent/policy-timeout.json)، [Load](independent/load-name-flip.json) |

اختبار الهرميات أعلاه يختبر **قبول القيمة من مجموعة التعداد**، لا أصالة تذكرة صدرت فعلًا عن كل هرمية أو اتساقها مع هرم طلب CreatePrimary الحالي؛ لقد غيرت حقلًا في الرد ولم أعد إنتاج HMAC سر TPM. [طريقة تعديل الحقل](IndependentFollowup.cs)، [مثال تعديل الهرمية](independent/creation-hierarchy-4000000c.frames.txt).

### FUP-SOL-01 — متوسطة: علاقات تذكرة PolicySigned/NULL ما زالت غير مفحوصة

على الرأس، `policy-digest-1` و`policy-digest-32` و`policy-digest-64` أعادت تذكرة هرمها `RH_NULL`، timeout فارغًا، وexpiration الطلب صفرًا، ولكن بصمتها غير فارغة؛ وفي الثلاثة تابعت البروفة إلى `status="COMPLETE"` و81 خطوة وبقايا فارغة. أما 65 فُرفضت بحد الحجم، أي إن هناك فحصًا جزئيًا لا غيابًا للفحص. [بايت واحد](independent/policy-digest-1.json)، [32](independent/policy-digest-32.json)، [64](independent/policy-digest-64.json)، [65 المرفوضة](independent/policy-digest-65.json).

كذلك `policy-hierarchy-40000001/0B/0C` استُقبلت رغم expiration=0، و`policy-tag-8023` استُقبلت بدل وسم التذكرة الموقعة `8025`؛ بينما `policy-tag-8024` رُفضت، مما يفصل فحص المجموعة المسموحة عن ربط التذكرة بالأمر. [هرمية غير NULL عند الصفر](independent/policy-hierarchy-40000001.json)، [وسم 8023](independent-extra/policy-tag-8023.json)، [وسم 8024](independent-extra/policy-tag-8024.json).

المرجع الذي قرأته هو TCG Part 3، Revision 01.59، 8 نوفمبر 2019، §23.3 وجدولا 124/125: expiration غير السالب يعيد NULL Ticket، وtimeout يكون Empty Buffer معها؛ وPart 2 §10.7.5 جدول 98 يورد NULL Auth Ticket ببصمة حجمها صفر. [TCG Part 3 r1.59](https://trustedcomputinggroup.org/wp-content/uploads/TCG_TPM2_r1p59_Part3_Commands_pub.pdf)، [TCG Part 2 r1.59](https://trustedcomputinggroup.org/wp-content/uploads/TCG_TPM2_r1p59_Part2_Structures_pub.pdf)، [النصان المحفوظان](static/spec-locations.txt).

الموضع هو `AuthTicket` ثم `Check(PolicySigned)`: الهرمية مقيدة بأربع قيم والـdigest بحد أقصى64، دون شرط NULL المرتبط بالطلب؛ وفحص الأمر يقبل وسمي Auth العامين بدل وسم PolicySigned المحدد. [الشيفرة](repo/sim/tpm-ceremony/TpmCeremonyCore.cs#L620)، [فرع PolicySigned](repo/sim/tpm-ceremony/TpmCeremonyCore.cs#L792).

الحالة `policy-digest-1` ووسم 8023 مقبولان أيضًا في الضابط السابق، لذا لا أنسب نشأتهما إلى `d9e1dc3b`؛ هما حد متبقٍ من R3SOL-03، وليس الدليل هنا تجاوزًا لسياسة NV على TPM أو استخدامًا لتذكرة مزورة في أمر لاحق. [ضابط البصمة](control-before-fix/policy-digest-1.json)، [ضابط الوسم](control-extra/policy-tag-8023.json)، [مسار البروفة](repo/sim/tpm-ceremony/TpmCeremonyCore.cs#L1535).

إعادة القياس: `OUTPUT="$W/replay-ticket" bash "$W/run-independent.sh" policy-digest-1 policy-digest-32 policy-digest-64 policy-digest-65 policy-tag-8023 policy-tag-8024` مع مخرج جديد؛ خرج الجامع المسجل `0` لكل حالة. [الأوامر الأصلية](independent/commands.log)، [أوامر الوسم](independent-extra/commands.log).

### FUP-SOL-02 — متوسطة: استهلاك ثلاثة حقول إنشاء لا يثبت اتساقها

في `creation-outsideinfo` استبدلت outsideInfo الفارغ ببايت `42` وأعدت حساب creationHash؛ وفي `creation-parentname` استبدلت أول حقل اسم ذيلي باسم من بايت واحد مع بقاء parentNameAlg=`ALG_NULL`؛ كلاهما انتهى `COMPLETE` و81 خطوة وبقايا فارغة. [outsideInfo والطلب/الرد](independent/creation-outsideinfo.frames.txt)، [نتيجته](independent/creation-outsideinfo.json)، [اسم الأصل](independent/creation-parentname.frames.txt)، [نتيجته](independent/creation-parentname.json).

أمر CreatePrimary في البروفة يرسل outsideInfo فارغًا وهرم OWNER، وTCG Part 2 r1.59 §15.1 جدول222 يربط outsideInfo بقيمة الطلب، ويجعل parentName وparentQualifiedName مساويين لمقبض الهرم وبحجم4 عند ALG_NULL؛ لذلك هذه أمثلة مخالفة لقواعد يمكن التحقق منها دون امتلاك سر HMAC. [منشئ الطلب](repo/sim/tpm-ceremony/TpmCeremonyCore.cs#L242)، [TCG Part 2 §15.1](https://trustedcomputinggroup.org/wp-content/uploads/TCG_TPM2_r1p59_Part2_Structures_pub.pdf)، [TCG Part 3 §12.1](https://trustedcomputinggroup.org/wp-content/uploads/TCG_TPM2_r1p59_Part3_Commands_pub.pdf).

الإصلاح الحالي يفحص عدد الحقول الثلاثة وخوارزمية الأصل ويعيد حساب creationHash، لكنه يستهلك الحقول الذيلية بـ`B2B()` دون تحقق من هذه العلاقات؛ وoutsideInfo المخالف دخل كذلك على النواة السابقة، فلا أنسب هذا المثال إلى الدفعة الجديدة. [دالة CreationData](repo/sim/tpm-ceremony/TpmCeremonyCore.cs#L647)، [الضابط السابق](control-before-fix/creation-outsideinfo.json).

لم أعد توليد تذكرة إنشاء أصيلة للبيانات المعدلة ولم أختبر كل حقل PCR أو locality أو كل نوع مفتاح؛ النتيجة تخص قبول هذه التناقضات في فاحص الرد، لا إبطال إثبات تشفيري كامل أو قياس جهاز آخر. [الناقل وآلية إعادة البناء](IndependentFollowup.cs).

إعادة القياس: `OUTPUT="$W/replay-creation" bash "$W/run-independent.sh" creation-outsideinfo creation-parentname creation-hash-flip creation-data-missing`؛ خرج الجامع المسجل `0` في الأمثلة الأربعة، مع اختلاف حقول حالة البروفة المذكور أعلاه. [الأوامر والخروج](independent/commands.log).

### FUP-SOL-05 — منخفضة، انحسار جديد خارج ملف البروفة: expiration الموجب

أنشأ `PositiveExpiration.cs` مفتاحًا وجلسة سياسة حقيقيين على swtpm، ووقّع `Policy.AHash(nonce,3600)`، وأرسل PolicySigned؛ رد المحاكي الحقيقي كان نجاحًا بالبايتات `8001000000140000000000008025400000070000`، لكن `ResponseSchema.Check` على الرأس رفضه بـ`RESPONSE_POLICY_TIMEOUT_MALFORMED: len=0`. [المصدر](PositiveExpiration.cs)، [الطلبات والردود على الرأس](positive-expiration/current-3600.txt)، [خروج الجامع 0](positive-expiration/current-3600.exit).

النواة السابقة قبلت رد التجربة نفسها، وتجربتا expiration=0 قبلتهما النواتان؛ فهذا اختلاف في شرط nonzero المضاف في `d9e1dc3b`، لا رد اختباري مركب يدّعي النجاح فقط. [السابق/3600](positive-expiration/before-fix-3600.txt)، [الرأس/0](positive-expiration/current-0.txt)، [السابق/0](positive-expiration/before-fix-0.txt)، [فرق النواة](static/core.diff).

TCG Part 3 r1.59 §23.3 وجدولا124/125 يطلبان NULL Ticket وtimeout فارغًا عند expiration غير السالب؛ الشرط الحالي يعامل الموجب كالسالب ويطلب timeout غير فارغ. [TCG Part 3](https://trustedcomputinggroup.org/wp-content/uploads/TCG_TPM2_r1p59_Part3_Commands_pub.pdf)، [الشرط الحالي](repo/sim/tpm-ceremony/TpmCeremonyCore.cs#L800).

حد الخطورة منخفض لأن بروفات الشجرة الحالية ترسل expiration=0؛ لا أدعي أن هذه الحالة توقف مسار ALL الحالي، وإنما أن الفرع العام المضاف يرفض ردًا حقيقيًا خارج ذلك الملف. [مستدعي PolicySigned الحالي](repo/sim/tpm-ceremony/TpmCeremonyCore.cs#L1461)، [أوامر التجربة](positive-expiration/commands.log).

إعادة القياس: `bash "$W/run-positive-expiration.sh"`؛ المخارج الأربعة المسجلة `0`، والقبول أو الرفض مطبوع داخل الملفات النصية، مع تحرير الموارد الثلاثة في نهاية كل تجربة. [المشغّل](run-positive-expiration.sh)، [نهاية تجربة الرأس](positive-expiration/current-3600.txt).

## 4. الأولوية الثالثة: خط الأساس الجزئي واختبار R3-18

حقنت في مسبر مستقل فشلين **نقليين حقيقيين** أثناء جرد العابر ثم الجلسات، وفي تجربتين أخريين حقنت فئة مقبض NV في الموضعين؛ فكانت حالة الفشل النقلي `TOOL_ERROR` وحالة الفئة الخاطئة `FAILED_CLOSED`، لكن الأربع حملت `verified=false` و`partial baseline` وبقية `residual state unknown`، ولم ترسل البروفة أمرًا مغيرًا. [فقد جرد العابر](independent/partial-transient.json)، [فقد جرد الجلسات](independent/partial-session.json)، [فئة خاطئة للعابر](independent-partial/partial-transient-badclass.json)، [فئة خاطئة للجلسات](independent-partial/partial-session-badclass.json).

هذا يختبر استقلالًا عن ناقل الحزمة الحالتين الجزئيتين: NV فقط مكتمل، وNV والعابر مكتملان مع غياب الجلسات؛ والشرط الجديد في PostRunInventory يرفض المقارنة في كليهما. [مصدر مسابري](IndependentFollowup.cs)، [الشيفرة 1765–1775](repo/sim/tpm-ceremony/TpmCeremonyCore.cs#L1765).

أما `3e67d362` فيضيف فعلًا وضع `baseline-partial` عند أول جرد عابر، واختبار R3-18 الذي يفحص تشغيل الحقن والفشل المسمى وعدم إرسال مغير و`verified=false` ونص partial baseline وبقية مجهولة؛ وشغّلته المجموعة الأصلية ضمن الاختبارات الـ73 بلا تخطي. [وضع الحزمة](repo/tests/helpers/TpmCeremonyFaultTransport.cs#L484)، [توقعات R3-18](repo/tests/sim/tpm-ceremony-wl413-r3.test.mjs#L414)، [TAP](shipped/suite.tap).

لا أعمم اختبار R3-18 على فقد الجلسات؛ ذلك المسار الإضافي مقيس هنا بمسبر مستقل لا بتوقعات R3-18 نفسه. [تجربة الجلسات](independent-partial/partial-session-badclass.json)، [الاختبار المشحون](repo/tests/sim/tpm-ceremony-wl413-r3.test.mjs#L414).

## 5. الأولوية الرابعة: فقد الرد والتنظيف والموارد الأجنبية

قبل البروفة عرّفت فهرس NV أجنبيًا `0x01807777` بتفويض فهرس غير فارغ، ثم مررت NV_DefineSpace الخاص بالبروفة حتى استلم ناقلي رد نجاح حقيقيًا وأسقطته باستثناء IO؛ لم يكن هذا مجرد رد مشوه. [الزرع وآلية الإسقاط](IndependentFollowup.cs)، [رد النجاح قبل الرمي](independent/loss-define.frames.txt).

خرج الجامع `0`، وحالة البروفة `FAILED_CLOSED/OUTCOME_UNKNOWN`؛ كان `nvBefore=[0x01807777]` و`nvAfter=[0x01807777,0x01bbb50a]`، مع `deleted=[]` وبقية جديدة `0x01bbb50a` فقط ونص «matching publicArea is not proof». [JSON الكامل](independent/loss-define.json)، [الخروج](independent/loss-define.exit).

وفي `normal-foreign` انتهت البروفة العادية مع بقاء الفهرس الأجنبي وعدم إدراجه ضمن البقايا الجديدة؛ إذ إن `residualNv` فرق عن خط الأساس لا ادعاء بخلو مخزن NV كله. [البروفة مع الأجنبي](independent/normal-foreign.json)، [مقارنة الجرد النهائي](repo/sim/tpm-ceremony/TpmCeremonyCore.cs#L1780).

ولفحص الالتباس الأقوى، زرع ناقلي فهرسًا **بنفس المنطقة العامة للمرشح** لكن بتفويض فهرس مختلف قبل تمرير تعريف البروفة؛ عاد تعريف البروفة الفعلي بـ`0x14c` ثم أسقطت رده، وبقي الفهرس ولم يمر إلى النقل أي UndefineSpace؛ هذا زرع أثناء النقل بعد اختيار المقبض، وليس ادعاء زرع ذلك المقبض العشوائي قبل اختياره. [الطلبان والردان](independent-extra/loss-define-foreign-matching.frames.txt)، [النتيجة](independent-extra/loss-define-foreign-matching.json).

كذلك أسقطت رد Create ناجحًا حقيقيًا: جاءت المصالحة الآن بـ«execution undetermined from handle inventory; Create returns no object handle…» لا «likely not executed»، بما يطابق محدودية الجرد في هذه الحالة. [الفقد الفعلي](independent/loss-create.frames.txt)، [نص المصالحة](independent/loss-create.json).

### FUP-SOL-04 — منخفضة، نص مصالحة مضلل بعد استنفاد محاولة التنظيف

في `undefine-drop-before` أسقطت حذف المرحلة قبل الإرسال؛ أتت المصالحة «left for the bounded cleanup attempt»، ثم أرسلت محاولة تنظيف واحدة ونجحت واختفى الفهرس، وهو مسار يلائم النص الجديد. [القياس](independent-extra/undefine-drop-before.json)، [النقل](independent-extra/undefine-drop-before.frames.txt).

لكن في `cleanup-undefine-before` حقنت رد فشل TPM مبكرًا لإدخال التنظيف، ثم أسقطت **محاولة حذف التنظيف نفسها** قبل الإرسال؛ بعدها خرجت المصالحة بالنص نفسه «left for the bounded cleanup attempt (declared as leftover if it remains)» رغم عدم وجود محاولة لاحقة، وبقي الفهرس `0x01a27687` معلنًا. [التجربة](independent-extra/cleanup-undefine-before.json)، [الترتيب الخام](independent-extra/cleanup-undefine-before.frames.txt).

الجامع خرج `0`؛ يوجد استدعاء حذف واحد في سجل المحاولات وصفر حذف فعلي في `forwarded`، وخطوات ما بعد المصالحة جرد نهائي فقط؛ النواة السابقة كانت تقول بدقة في هذا المسار «cleanup attempt budget already spent (no further attempt)». [الرأس](independent-extra/cleanup-undefine-before.json)، [الضابط السابق](control-extra/cleanup-undefine-before.json).

إذن التبديل غير المشروط في السطر1703 أصلح وصف مسار ما قبل التنظيف لكنه أفسد وصف مسار المصالحة **بعده**؛ هذه ملاحظة دقة تقرير، لا حذف غير مملوك أو ادعاء خلو، لأن البقية وحالة الفشل لم تختفيا. [فرق النص](static/core.diff)، [الفرع الحالي](repo/sim/tpm-ceremony/TpmCeremonyCore.cs#L1696)، [الجرد الباقي](independent-extra/cleanup-undefine-before.json).

إعادة القياس: `OUTPUT="$W/replay-cleanup" bash "$W/run-independent.sh" undefine-drop-before cleanup-undefine-before`؛ خرج الجامعين المسجل `0`، ولم أقس حالة flush المناظرة وإن كان النص مكررًا فيها. [الأوامر](independent-extra/commands.log)، [نص flush في الشيفرة](repo/sim/tpm-ceremony/TpmCeremonyCore.cs#L1716).

## 6. الأولوية الخامسة: العد الفوري لعمليات swtpm

نفذت الرصد فور رجوع العملية مع حفظ رمز خروجها، **قبل kill أو sleep أو أي تنظيف خارجي**؛ وعدد «خاص بي» يعني سطر عملية يحمل المسار الفريد لدليلي، أما المحاكي الممرّر إلى rehearse فكان أصلًا fixture أبدأه وأوقفه صراحة وليس عملية ينشئها rehearse. [مشغّل المجموعة](run-shipped.sh)، [مشغّل فشل التأكيد](run-forced-failure.sh)، [مشغّل فشل التجهيز](run-readiness-failure.sh).

| المسار | قبل: كلي / خاص بي | فور خروج Node أو pwsh: كلي / خاص بي | النتيجة والدليل |
|---|---:|---:|---|
| المجموعة الأصلية، خروج0 | 2 / 1 | 2 / 1 | fixture نفسه فقط؛ صفر محاكيات اختبار جديدة باقية. [قبل](shipped/processes-before-suite.txt)، [بعد فوري](shipped/processes-immediately-after-suite.txt) |
| rehearse ALL، خروج0 | fixture واحد في ملكيتي | 2 / 1 | 81 خطوة، البقايا فارغة؛ المحاكي الممرّر بقي عمدًا بنفس PID17568. [JSON](shipped/rehearsal.json)، [بعد فوري](shipped/processes-immediately-after-rehearsal.txt) |
| فشل assert بعد نجاح startSim، خروج1 | 1 / 0 | 1 / 0 | finally/stopSim أوقف المحاكي قبل خروج Node. [قبل](forced-failure/processes-before.txt)، [بعد فوري](forced-failure/processes-immediately-after.txt)، [TAP](forced-failure/forced.tap) |
| فشل استعلام الجاهزية داخل startSim، خروج1 | 1 / 0 | 2 / 1 | بقي PID30077 حيًا؛ التفاصيل أدناه. [قبل](readiness-failure/processes-before.txt)، [بعد فوري](readiness-failure/processes-immediately-after.txt) |

بعد إنهاء fixture العادي لم تبق لي عملية في سجل ذلك التشغيل، وبعد تسجيل يتيم فشل الجاهزية أوقفته وحده وفق المسار؛ لم ألمس المحاكي المشترك أو محاكي مراجع آخر. [بعد fixture](shipped/processes-after-fixture-stop.txt)، [إيقاف اليتيم بعد القياس](readiness-failure/commands.log)، [الفحص الأخير](final-audit.txt).

### FUP-SOL-03 — منخفضة تشغيلية: فشل تجهيز startSim يترك محاكيًا حيًا

نسخت اختبار R3 خارج الشجرة، وأبقيت فرع الفشل كما هو، وعدلت المسارات والمنفذ إلى7100 وحدّي المحاولة/استعلام الجاهزية إلى **1 بدل 8/10** لحصر الحقن في محاكٍ واحد؛ وفشل `tpm2_getcap` عبر shim خاص يخرج85، ولم أبدل swtpm أو core أو stopSim. [الفرق الكامل للنسخة](readiness-failure/copy.diff)، [مولّد النسخة](prepare-readiness-failure.mjs)، [shim](readiness-failure/bin/tpm2_getcap).

عندما ينجح إطلاق swtpm لكن `ready=false`، ينفذ startSim السطر `rmSync(dir)…continue` دون إيقاف العملية، ثم يرمي خطأ التجهيز؛ ولأن `const s=startSim()` يقع قبل try/finally في الاختبار فلا يدخل stopSim أصلًا. [الأصل، أسطر38–59](repo/tests/sim/tpm-ceremony-wl413-r3.test.mjs#L38)، [موضع استدعاء R3-18](repo/tests/sim/tpm-ceremony-wl413-r3.test.mjs#L415).

الخرج المسجل هو خطأ «تعذّر تشغيل محاك معزول»، وNode خرج1، وفور خروجه بقيت العملية PID30077 وPPID1 وحالتها `S` على7100، رغم زوال مجلد الحالة؛ لم أجعل التنظيف الخارجي اللاحق جزءًا من نتيجة «صفر يتامى». [TAP](readiness-failure/readiness.tap)، [الخروج](readiness-failure/readiness.exit)، [العملية فور الخروج](readiness-failure/processes-immediately-after.txt)، [تنظيفها اللاحق](readiness-failure/processes-after-explicit-cleanup.txt).

هذا قياس لفرع تجهيز محدد بنسخة ذات حدود زمنية مختصرة، لا تشغيل كامل لثماني محاولات أصلية ولا ادعاء ثمانية يتامى؛ وهو متبقٍ خارج إصلاح stopSim، لا عودة لتسرب مسار إنهاء الاختبارات الـ21 القديم. [حدود التعديل المعلنة](readiness-failure/copy.diff)، [فرق إصلاح stopSim](static/tests.diff).

إعادة القياس: `bash "$W/run-readiness-failure.sh"` على7100 الخالي؛ السكربت يسجل العد قبل إيقاف اليتيم، ورمز Node المتوقع1 لا خطأ بيئة مجهول؛ ولا يلزم إعادة المحاولة عشوائيًا لهذه الحالة المتعمدة. [المشغّل](run-readiness-failure.sh)، [الأوامر والمخرج](readiness-failure/commands.log).

## 7. الأولوية السادسة: النصوص المنشورة مقابل ما قيس

| النص | المطابقة أو القيد المقيس |
|---|---|
| README: ربط نوع تفويض الرد بالجلسة، ترتيب الجرد، partial baseline | تطابق مع أمثلتي المحددة، بما فيها رفض الاتجاهين وغياب المقارنة مع خط أساس جزئي. [النص](repo/sim/tpm-ceremony/README.md#L61)، [النتائج](review-summary.json) |
| README: «أي تشويه ⇒ فشل مغلق» | أوسع من القياس؛ تذاكر NULL ذات بصمة وحقول الإنشاء المخالفة أمثلة مضادة، لا مبرر لتعميم الشمول. [النص](repo/sim/tpm-ceremony/README.md#L39)، [التذكرة المقبولة](independent/policy-digest-1.json)، [الإنشاء المقبول](independent/creation-outsideinfo.json) |
| README: stopSim لا يترك يتيمًا | يلائم finally بعد تجهيز ناجح، لكنه لا يصف فشل startSim قبل finally؛ فرّقت العدين ولم أسقط هذه الحالة من التقرير. [النص](repo/sim/tpm-ceremony/README.md#L69)، [assert](forced-failure/processes-immediately-after.txt)، [الجاهزية](readiness-failure/processes-immediately-after.txt) |
| THREAT_MODEL §7/11: وصف الملكية | سطر الدفعة الثانية نُقح إلى «التطابق لا الملكية»، لكن فقرة «عوائق المراجعة…2026-10-17» السابقة له ما زالت تقول بعد فقد الرد «يثبت…ملكية فهرس NV بمطابقة…قبل أي حذف»؛ يلزم وسمها تاريخيًا أو إحالتها صراحة إلى الإلغاء كما فُعل في الفقرة التالية. [النصان المتجاوران](repo/docs/THREAT_MODEL.md#L279)، [سلوك عدم الحذف](independent/loss-define.json) |
| ADR §12.5: مواضع المعالجة الإضافية | قبول الهرميات الأربع ورفض02، قيد64 المقيس، ربط نوع التفويض، رفض التكرار، مطابقة Load، الحقول الثلاثة وإعادة حساب creationHash تغييرات قست أمثلتها؛ لا يستلزم ذلك فحص العلاقات الباقية أو جميع أنواع الردود. [النص](repo/docs/adr/0007-tpm-nv-counter-freshness-anchor-design.md#L492)، [مصفوفتي](review-summary.json) |
| ADR: timeout≤8 عند غير الصفر | يصف الشيفرة الحالية لكنه ليس قاعدة صحيحة لكل nonzero؛ رد expiration=3600 الحقيقي يكشف فرق الموجب والسالب، خارج ملف البروفة الحالية. [النص](repo/docs/adr/0007-tpm-nv-counter-freshness-anchor-design.md#L492)، [القياس](positive-expiration/current-3600.txt)، [TCG Part3 §23.3](https://trustedcomputinggroup.org/wp-content/uploads/TCG_TPM2_r1p59_Part3_Commands_pub.pdf) |
| مصالحة Create بعد الفقد | «execution undetermined» الجديدة تلائم فقد رد Create الذي لا يعيد مقبضًا؛ لا أستنتج التنفيذ من غياب مقبض. [القياس](independent/loss-create.json)، [النص](repo/sim/tpm-ceremony/TpmCeremonyCore.cs#L1728) |
| مصالحة الحذف | النص الجديد صحيح قبل التنظيف لا بعد استنفاد ميزانيته؛ FUP-SOL-04 يحدد المسارين بدل تعميم أحدهما. [قبل التنظيف](independent-extra/undefine-drop-before.json)، [بعده](independent-extra/cleanup-undefine-before.json) |

بعض تعليقات الشيفرة القديمة أيضًا بقيت تصف policy nonce من16..64 أو attrs=01 للملفين أو إثبات ملكية NV بالمطابقة، بينما التنفيذ الحالي أضيق أو يترك الفهرس؛ لا أعد التعليق دليلًا لسلوك البرنامج. [تعليقات التفويض](repo/sim/tpm-ceremony/TpmCeremonyCore.cs#L491)، [تعليق استخراج أنواع الجلسات](repo/sim/tpm-ceremony/TpmCeremonyCore.cs#L542)، [تعليق حدود الملكية](repo/sim/tpm-ceremony/TpmCeremonyCore.cs#L16)، [التنفيذ المقيس](independent/loss-define.json).

## 8. الأولوية السابعة: حاجز القوالب وقائمة السماح

راجعت تاريخ `7e2ded54..673c8c88` والتزام الاختبار الأخير: أضاف `0ba77606` ثلاثة مسارات استثناء مؤقتة لأدلة فارغة، ثم أزال `673c8c88` الثلاثة؛ والفرق النهائي منذ `d9e1dc3b` في قائمة السماح **سطر فارغ فقط**، ولا فرق في شيفرة guard نفسها، ولا توسيع نهائي للمداخل الدلالية. [تاريخ السماح](static/allowlist-history.txt)، [الفرق النهائي](static/allowlist.diff).

قارنت المداخل بعد حذف التعليقات والأسطر الفارغة: المجموعة قبل وبعد متطابقة وعددها109؛ و`npm run guard:templates` خرج0 وأعلن مخالفات0 ومداخل متروكة0 ومخرج هروب واحدًا هو سجل العمل الموجود، لا استثناء عامًا لحزمة المراجعة. [المقارنة الدلالية](review-summary.json)، [خرج الحاجز](static/template-guard.txt)، [طريقة فحص القائمة](repo/scripts/guard-templates.mjs#L32).

التزام `3e67d362` يضيف وضع الحقن واختبار R3-18 فقط من ناحية الشيفرة محل هذا الفحص؛ لا يغير guard أو allowlist أو نواة المراسم. [سجل الالتزامات](static/commits.txt)، [فرق الاختبارات](static/tests.diff)، [فرق السماح](static/allowlist.diff).

## 9. إعادة الإنتاج، العوائق، والحدود الباقية

تُستعمل قيمة `W` أدناه لدليلي الحالي؛ يجب اختيار `OUTPUT` جديد عند إعادة حالات الحقن كي لا تُستأنف حالة swtpm سابقة، ولا تشغيل أمرين يملكان7100 في وقت واحد. [مشغّل الحالات ومجلدات الحالة](run-independent.sh).

```sh
W=/tmp/wl414-followup/reviewers/gpt_6_1_sol
cd "$W"

# البناء/الحاجز/الفروق، من نسختي فقط:
bash capture-review.sh

# مثال إعادة الحالات الأساسية، بمخرج جديد:
OUTPUT="$W/replay-$(date +%s)" bash run-independent.sh \
  duplicate-alias duplicate-many descending cross-page below-start \
  auth-policy-on-password auth-password-on-policy \
  partial-transient-badclass partial-session-badclass loss-define \
  policy-digest-1 creation-outsideinfo cleanup-undefine-before

# المجموعة الأصلية ذات ملفاتها الخمسة، ثم rehearse ALL:
bash run-shipped.sh

# فشلان مختلفان؛ Node يخرج1 عمدًا في كل منهما:
bash run-forced-failure.sh
bash run-readiness-failure.sh

# ردود expiration الحقيقية، على النواة الحالية والسابقة:
bash run-positive-expiration.sh

# تجميع النتائج وتأكيد العلاقات المسجلة؛ لا يرسل أوامر TPM:
node summarize-followup.mjs
```

المخرجات الخام موضوعة في `independent/` و`independent-extra/` و`independent-partial/`، مع `.frames.txt` و`.json` و`.exit` وstderr وسجلات العمليات؛ الضوابط في `control-before-fix/` و`control-extra/`، ومصادر المسابر C# والمشغلات في جذر دليلي، خارج الملفات المتعقبة. [الفهرس المولد](review-summary.json)، [مشغّل الحالات](run-independent.sh).

وقع خطأ تجهيز واحد: استدعاء checkout الأول بقي في دليل المراجع لا المستودع بعد نجاح النسخ، فخرج128 بـ`fatal: not a git repository`؛ أعدته من دليل النسخة فخرج0، ثم أعدت npm ci والبناء مع حفظ الخرج؛ وتعذر جلب نسخة Part3 r1.38 من عنوان بعينه فاستعملت r1.59 المقروءة والمحفوظة بدلًا منها، ولا يبقى عائق تشغيل أو مرجع من هذين. [الأمر والخرج والتعافي](setup-notes.txt)، [إعادة البناء](static/preflight.txt)، [TCG Part3 المحفوظ](static/tcg-part3.json).

**ما لم أقسه:** لا Windows/TBS أو TPM حقيقي أو انقطاع طاقة أو امتلاء NV حتى الاستنفاد أو سماح هرم مالك حقيقي؛ ولا خصم بصلاحيات المضيف أو سباق تبديل مستمع أو إعادة مصادقة تشفيرية على swtpm؛ والمجموعة لم تُظهر فشل منافذ عشوائية يستلزم إعادة محاولة. [نطاق النقل في المسبر](IndependentFollowup.cs)، [أوامر التشغيل](shipped/commands.log)، [TAP](shipped/suite.tap).

لم أعِد قياس تراكم الفهارس عبر تشغيلات كثيرة هنا، ولم أختبر كل مخطط رد أو كل بت أو كل خوارزمية أو تحقق HMAC للتذاكر؛ ورفض طول CreatePrimary64 لا أعرضه كقاعدة TPM عامة، وتجارب الهرميات المعدلة ليست تذاكر أصيلة بديلة، وتجربة فشل التجهيز ذات حدود1/1 لا قياس محاولات8/10 كلها. [آلية الحقن](IndependentFollowup.cs)، [النسخة المقيّدة للتجهيز](readiness-failure/copy.diff)، [الشيفرة المقيسة](static/code-excerpts.txt).

الفحص الأخير بعد كتابة التقرير أبقى HEAD المطلوب والحالة المتعقبة فارغة والفرق المحمي فارغًا، ولم يعرض مستمعًا على7100/7101 أو swtpm منسوبًا إلى دليلي؛ المحاكي المشترك الظاهر في جدول العمليات لم أنشئه ولم ألمسه. [الفحص الأخير بعد التقرير](final-audit-after-report.txt).

## سجل النتائج المتبقية

| المعرف | النطاق/الخطورة | أصل النتيجة المقيس |
|---|---|---|
| FUP-SOL-01 | متوسطة — قبول NULL auth ticket غير متسقة وربط الوسم/الهرمية بالطلب ناقص | استمرار من السابق في حالتي digest1 والوسم8023؛ قيد64 وهرمية التعداد لا يغطيان العلاقة. [الرأس](independent/policy-digest-1.json)، [السابق](control-before-fix/policy-digest-1.json) |
| FUP-SOL-02 | متوسطة — parentName/outsideInfo لا يربطان بشروط البنية/الطلب | استمرار outsideInfo في الضابط السابق؛ الحقول الثلاثة والبصمة المتسقة لا تمنعان المثالين. [الرأس](independent/creation-outsideinfo.json)، [السابق](control-before-fix/creation-outsideinfo.json) |
| FUP-SOL-03 | منخفضة تشغيلية — يتيم عند فشل جاهزية startSim قبل finally | فرع تجهيز باقٍ؛ لم يتكرر تسرب مسار stopSim العادي. [العد الفوري](readiness-failure/processes-immediately-after.txt)، [فرق النسخة](readiness-failure/copy.diff) |
| FUP-SOL-04 | منخفضة — وعد محاولة تنظيف بعد استنفادها | تبديل النص في d9e1dc3b غيّر دقة مسار ما بعد التنظيف؛ البقية تبقى معلنة. [الرأس](independent-extra/cleanup-undefine-before.json)، [السابق](control-extra/cleanup-undefine-before.json) |
| FUP-SOL-05 | منخفضة — رفض رد نجاح حقيقي عند expiration موجب | انحسار جديد في ResponseSchema العام، خارج ملف expiration=0 للمراسم الحالية. [الرأس](positive-expiration/current-3600.txt)، [السابق](positive-expiration/before-fix-3600.txt) |
