# WL-414 R3 — مراجعة مستقلة لمعالجة WL-413

المراجع: grok_4_7. التاريخ: 2026-10-18. الشجرة: `/home/user/workspace/xuux-review-de099aa8`.  
`git rev-parse HEAD` طبع `de099aa8cfd82dda106199eeaf11e134b5ee6639` في البداية وبعد انتهاء القياس.  
`git status --porcelain` فارغ في البداية وبعد الانتهاء.  
`git diff 8b48a568 -- scripts/production-entry.mjs config/external-review.yaml version.json sim/tpm/tcti_guard.mjs` حجمه 0 بايت.

لم يُلمس `/dev/tpm*`. استدعاءٌ واحدٌ لـ`tpm2_getcap -l` بلا `--tcti` حاول فتح `/dev/tpmrm0` و`/dev/tpm0` و`/dev/tcm0` ثم المنفذ 2321، وفشل كل ذلك بغياب الملف أو رفض الاتصال. كل استدعاء لاحق مرّ بـ`--tcti=swtpm:host=127.0.0.1,port=5800`. لم يُشغَّل `scripts/tpm-sim-ci.sh`. لم يُستعمل `gh` ولا `git commit` ولا `git push`. لم يُعدَّل ملف متعقَّب.

المنفذ المستعمل: 5800 والتحكم 5801 فقط. الاختبارات التي طلبها التكليف أنشأت محاكياتها على منافذ 2738–2992.

## ما شُغّل

1. مجموعة التكليف، خروجها 0، مدتها 58902 مللي ثانية. السجل: `raw/node-test-suite.log`. سطر الملخص: tests 62، fail 0، cancelled 0، skipped 0، todo 0. منها 21 سطرًا لأسماء R3-01 حتى R3-11.
2. `pwsh -NoProfile -File sim/tpm-ceremony/rehearse.ps1 -SimHost 127.0.0.1 -SimPort 5800 -Stages ALL -SimPidFile …/pid`. الخروج 0. التقرير في `raw/rehearsal.json`: الحقل `status` قيمته `COMPLETE`، 81 خطوة، `cleanupLeftovers` فارغ، `reconciliation` فارغ، `postRunInventory.verified` = true، والبقايا الثلاث فارغة. `transport.listener.before` و`after` كلاهما `pid=1828 comm=swtpm`. الهوية: manufacturer=`IBM`، vendorString=`SW   TPM`، vendorString3 و4 فارغان. `s1.probe.nvCountersMax` = 0. قيمة العداد بعد الزيادة الأولى 13 ثم 14 — حالة المحاكي لم تُمسح قبل هذه البروفة لأن مجموعة الاختبارات استعملت 5800 قبلها، فهذان الرقمان ليسا قياس بدءٍ نظيف.
3. مسابر مباشرة على `Resp.Parse` و`ResponseSchema.Check` بلا محاكٍ: `probes/probe.ps1 -Kind direct`، الخروج 0، `raw/direct.json`.
4. مسابر بروفة على 5800 بنقلٍ خاص خارج الشجرة (`probes/ProbeTransport.cs`، مُجمَّع إلى dll في المجلد نفسه، والنواة مُجمَّعة للقراءة من الشجرة بلا تعديل). المخرجات في `raw/ceremony-*.json` و`raw/acc-*.json` و`raw/session-enum.json` و`raw/acc-tpm2.txt`.

أدلة المنفّذ `evidence/r3-baseline-8b48a568/` و`evidence/r3-regression-at-de099aa8/` و`evidence/measurement-de099aa8/` غير موجودة في الشجرة (`git ls-files` لا يضمّها). سجل العمل يذكر قياس `npm run validate` على `d64b9a08`؛ `git cat-file -t d64b9a08` أعاد `Not a valid object name`. لم أُعِد تشغيل `npm run validate`.

## 1. إعادة فحص عوائق الجولة الأولى

السلوك القديم لم يُعَد إنتاجه في القياسات أدناه. هذا وصف قياس، لا حكم بإغلاق.

| المعرّف | القياس على هذه الشجرة | الأمر / المخرج |
| --- | --- | --- |
| SOL413-01 | رد `StartAuthSession` استُبدل مقبضه بمقبض جلسةٍ أُنشئت قبل `Run`. الفشل: `OUTCOME_UNKNOWN: s2.trial:StartAuthSession (ResponseMalformedException: RESPONSE_HANDLE_PREEXISTING: StartAuthSession 0x03000000 existed in baseline sessions inventory)`. لا تبنٍّ للمقبض. الجلسة الحقيقية `0x03000001` أُعلنت `ownership not provable` ولم تُحرَّر. `tpm2_getcap handles-loaded-session` أظهر `0x3000000` و`0x3000001`. الحقل `status` = `FAILED_CLOSED`. | `ceremony-session-alias.json` |
| SOL413-02 | `ResponseSchema.Check` على more=1 وcount=0 رمى `RESPONSE_CAPABILITY_NO_PROGRESS` (1 مللي ثانية). مقبض `0x80000001` في جردٍ طُلب عند `0x01000000` رمى `RESPONSE_CAPABILITY_HANDLE_CLASS_MALFORMED`. سجلا R3-02a وR3-02b ضمن الـ62. | `raw/direct.json`؛ سجل المجموعة |
| SOL413-03 / G47-413-2 | hmac بطول 1 رُفض: `RESPONSE_AUTH_CONTENT_MALFORMED: auth#0 nonceLen=0 attrs=0x01 hmacLen=1`. سجلات R3-03 الأربعة ضمن الـ62. تشويهات أخرى لم تُرفض — القسم 3. | `raw/direct.json` |
| SOL413-04 / G47-413-3 | سجلات R3-08 حتى R3-11 ضمن الـ62. مستقلًّا: وسم تذكرة `0x8024` رُفض؛ بصمة PolicySigned بطول 65 رُفض؛ قلب بايت في رأس المنطقة العامة لـCreatePrimary أعطى `RESPONSE_PUBLIC_AREA_MALFORMED: CreatePrimary head differs from sent template at 20` والحقل `status` = `FAILED_CLOSED`، والكائن `0x80000000` بقي. فجوات ما زالت تُقبل — القسم 3. | سجل المجموعة؛ `ceremony-cp-name-flip.json` |
| SOL413-05 | تحليل `0x18B` بوسم `0x1234` رمى `RESPONSE_ERROR_TAG_MALFORMED`، لا `TpmErrorException`. الرأس السليم (وسم `0x8001`، طول 10، rc `0x18B`) يُحلَّل و`Rc=0x18B`. سجلا R3-05a/b ضمن الـ62، ونصّهما يذكر `unverifiable` لا عبارة الغياب المقتبسة في اسم الاختبار. | `raw/direct.json`؛ سجل المجموعة |
| SOL413-06 / G47-413-6 | سجلا R3-06a/b ضمن الـ62. مستقلًّا: فقد رد `Load` بعد التنفيذ أعطى `OUTCOME_UNKNOWN: s2:Load(service-key)` وسطر مصالحة `object-create 0x80000001: appeared during run; ownership not provable; left in place`، و`tpm2_getcap handles-transient` أظهر `0x80000001`. فقد رد `StartAuthSession` أبقى `0x03000000` وأعلنه. | `ceremony-load-loss.json`؛ `ceremony-session-loss.json` |
| SOL413-07 / G47-413-4 | `parameterSize=2147483632` مع متبقٍّ 5 بايتات رمى `ResponseMalformedException` / `RESPONSE_PARAMETER_SIZE_INVALID: 2147483632 > remaining 5` في 2 مللي ثانية. لم يظهر `OverflowException` ولا `OutOfMemoryException`. حد النقل في الشيفرة 65536 قبل هذا الفحص. سجل R3-04 ضمن الـ62. | `raw/direct.json`؛ `TpmCeremonyCore.cs` حوالي 389 و486 |
| G47-413-1 | فقد رد التعريف بعد التنفيذ: لا خطوة `0x00000122`، البقية `nv 0x01a34f4d: ownership-undetermined (define reply lost; matching publicArea is not proof); left in place`، و`tpm2_getcap handles-nv-index` أظهر `0x1A34F4D`. عبارة `ownership proven` لم تظهر. سجل R3-07 ضمن الـ62. | `raw/acc-1.json` |
| G47-413-5 | انظر القسم 4: نص المصالحة يقول إن ميزانية المحاولة استُنفدت ولا محاولة لاحقة، ثم أُرسل `cleanup:NV_UndefineSpace`. | `raw/undefine-drop-before.json` |
| G47-413-7 | البروفة على 5800 سجّلت مستمعًا `pid=1828 comm=swtpm` قبلها وبعدها، والحقل `status` = `COMPLETE`. لم أُشغّل ثنائيًا باسم `swtpm` بملف تنفيذي مختلف — ذلك يحتاج عمليةً ثانية على المنفذ نفسه. الشيفرة في `rehearse.ps1` تقارن `/proc/<pid>/exe` بـ`command -v swtpm`. | `raw/rehearsal.json` |
| G47-413-8 | محاكيي على 5801 مربوط بـ`127.0.0.1`، والبروفة لم تتوقف عند فحص `--ctrl`. لم أُشغّل تحكمًا على `0.0.0.0` لأن التكليف يمنع منافذ غير 5800/5801. الشيفرة ترفض `type=tcp` بلا `bindaddr` من loopback. | `rehearse.ps1` حوالي 124–132 |
| SOL413-08 / G47-413-9 | الوثائق ما زالت أوسع من القياس — القسم 5. | أدناه |

## 2. ادّعاءات الدفعة الثالثة، وقرار عدم الحذف

فقد رد التعريف بعد التنفيذ، ثم تشغيل ثانٍ على الحالة نفسها بلا إعادة تهيئة:

- التشغيل الأول: `baseline.nvHandles=0`، لا `NV_UndefineSpace`، البقية `0x01a34f4d`. `tpm2_getcap`: فهرس واحد، `TPM2_PT_NV_COUNTERS=0x1`، `TPM2_PT_NV_COUNTERS_AVAIL=0x19`، `TPM2_PT_HR_NV_INDEX=0x1`.
- التشغيل الثاني: `baseline.nvHandles=1`، لا حذف للأول، بقية جديدة `0x01b67116` فقط (الأول في خط الأساس فلا يدخل `residualNv`). `tpm2_getcap handles-nv-index` أظهر الاثنين: `0x1A34F4D` و`0x1B67116`. العدادات `0x2`، المتاح `0x19` لم ينقص في هذا السطر (القيمة المعروضة بقيت `0x19`؛ العداد المستعمل صار 2). `HR_NV_INDEX=0x2`.

القرار الموصوف (لا حذف بعد رد تعريف مفقود ولو طابقت المنطقة) هو ما حدث في القياسين. الثغرة العملية المقاسة: الفهرس لا يُحذف في تشغيل لاحق أيضًا، فيتراكم. فحص الهامش في الشيفرة يستعمل `TPM_PT_NV_COUNTERS_MAX` ويتجاهله إن كان 0. البروفة سجّلت `nvCountersMax=0`. على هذا المحاكي الخاصية المتغيرة `TPM2_PT_NV_COUNTERS_AVAIL` كانت `0x19` بعد عدّادٍ واحد، والفحص لا يقرأها. تكرار فقد رد التعريف يستهلك عدّادات NV بلا مسار تنظيف في تشغيل لاحق. هذا حدّ قبل أي تشغيل على شريحة ذات سقف عدّادات غير صفري، وليس قياسًا على الشريحة.

`plant-then-drop` (أُرسل أمر التعريف نفسه من داخل النقل ثم رُمي الاستثناء) أعطى الرسالة نفسها ولم يحذف. لم أُنشئ فهرسًا مطابقًا بمقبضٍ يختاره التشغيل قبل أن يُختار المقبض؛ المساران (نُفّذ أمرنا / وُجد فهرس مطابق) غير قابلين للتمييز من الجرد، وهذا ما يقوله نص المصالحة.

## 3. تحليل الردود

### شكل `ST_NO_SESSIONS` على swtpm

من `ceremony-log.json`، أول رد ناجح لكل أمر:

- `StartAuthSession` (`0x176`): `8001000000300000000003000000` ثم nonce بطول 32. الوسم `0x8001`، الطول 48، لا حقل `parameterSize`. المقبض `0x03000000`.
- `PolicySigned` (`0x160`): `8001000000140000000000008025400000070000`. الوسم `0x8001`، الطول 20. timeout فارغ، وسم التذكرة `0x8025`، الهرمية `0x40000007`، البصمة فارغة.
- `CreatePrimary`: وسم `0x8002`، `parameterSize=291`، منطقة عامة 90 بايتًا، creationData 55، creationHash 32، تذكرة وسم `0x8021` وهرمية `0x40000001` وبصمة 64، اسم 34.

`RewriteNoSessionsParams` موجود في `tests/helpers/TpmCeremonyFaultTransport.cs` فقط، لا في محلل البروفة. المحلل عند الوسم `0x8001` الناجح يأخذ الباقي معاملاتٍ ثم يستدعي `ResponseSchema.Check`. سجل R3-08 `schema-nonce-empty` ضمن الـ62 يرفض nonce فارغًا على هذا الشكل. البروفة النظيفة قبلت الشكل الحقيقي (الحقل `status` = `COMPLETE`). فالمخطط يُستدعى على هذا الشكل؛ المعيد للكتابة أداة اختبار لا محلل إنتاج.

جرد الجلسات على swtpm: بعد `StartAuthSession` بنوع policy، `GetCapability` من `0x02000000` أعاد more=0 وcount=1 والمقبض `0x03000000`. الاستعلام من `0x02000000` رأى جلسة السياسة في الصفحة نفسها. هذا قياس محاكٍ لا تعميم على شريحة تعيد نوع المقبض `0x02` فقط ثم more=0.

### ما قبله الفاحص في هذا القياس

| التشويه | النتيجة | أين |
| --- | --- | --- |
| تفويض بشكل policy (nonce 32، attrs `0x00`، hmac فارغ) على رد `NV_DefineSpace` بكلمة سر | الحقل `status` = `COMPLETE`، changes=1، البقايا فارغة، والفهرس حُذف لاحقًا كملكية مُتبنّاة | `ceremony-auth-cross.json` |
| nonce سياسة بطول 16 بدل 32 على `NV_Increment` | الحقل `status` = `COMPLETE`، changes=1 | `ceremony-policy-nonce16.json` |
| attrs `0x08` (البت 3) على تفويض سياسة | الحقل `status` = `COMPLETE`، changes=1 | `ceremony-policy-attrs08.json` |
| attrs `0x02` (auditExclusive) في التحليل المباشر | لم يُرمَ استثناء | `raw/direct.json` |
| timeout بطول 8 وبطول 9 في `PolicySigned` | الطول 8: بروفة بالحقل `status` = `COMPLETE`. الطول 9: `ResponseSchema.Check` لم يرمِ | `ceremony-ps-timeout8.json`؛ `raw/direct.json` |
| هرمية تذكرة `0x40000002` في PolicySigned وفي Create | البروفة الأولى بالحقل `status` = `COMPLETE`. الاثنان لم يُرميا في الفحص المباشر | `ceremony-ps-hier02.json`؛ `raw/direct.json` |
| بصمة تذكرة Create بطول 100 | `ResponseSchema.Check` لم يرمِ | `raw/direct.json` |
| creationData بعدد PCR = 0 وبصمة PCR حجمها 0 | رُفض: `RESPONSE_CREATION_DATA_MALFORMED: Create pcrDigest not 32` | `raw/direct.json` |

الشيفرة تقبل أحد ملفي التفويض على أي منطقة تفويض، لا الملف المطابق لنوع الجلسة في الطلب (`passwordProfile || policyProfile`). ملف السياسة في الشيفرة: nonce من 16 إلى 64 و`(attrs & 0xF0)==0`، لا nonce=32 وattrs=`0x00` كما في ADR §12.5 وسجل WL-414.

الإحالات التي قرأتها:

- [Part 1 rev 01.59، 8 نوفمبر 2019](https://trustedcomputinggroup.org/wp-content/uploads/TCG_TPM2_r1p59_Part1_Architecture_pub.pdf): §19.4 جدول 13 — nonce كلمة السر في الرد طوله صفر و`continueSession` يُضبط. §19.6.3.2 — حجم `nonceTPM` يُحفظ من `nonceCaller` الأول، الأدنى 16، والأقصى حجم بصمة خوارزمية الجلسة (SHA-256 = 32). §18.2 — `parameterSize` حاضر فقط إذا كان الوسم `TPM_ST_SESSIONS` والرد نجاحًا؛ خطأ غير صفري: وسم `TPM_ST_NO_SESSIONS` وطول 10 بلا بايتات بعده. §15.3–15.6 — MSO لفهرس NV `0x01`، جلسة HMAC `0x02`، جلسة سياسة `0x03`، عابر `0x80`.
- [Part 2 rev 01.59، 8 نوفمبر 2019](https://trustedcomputinggroup.org/wp-content/uploads/TCG_TPM2_r1p59_Part2_Structures_pub.pdf): جدول 32 — بتّا `TPMA_SESSION` 4:3 محفوظان ويجب أن يكونا CLEAR؛ البت 0 لـ`continueSession` يُضبط في رد كلمة السر. جدول 19 — `TPM_ST_NO_SESSIONS=0x8001` بلا `parameterSize`، ورد الخطأ بهذا الوسم؛ `TPM_ST_SESSIONS=0x8002`؛ `TPM_ST_CREATION=0x8021`؛ `TPM_ST_AUTH_SECRET=0x8023`؛ `TPM_ST_AUTH_SIGNED=0x8025`. جدول 51 و28 — `TPMI_RH_HIERARCHY`: المالك `0x40000001`، NULL `0x40000007`، endorsement `0x4000000B`، platform `0x4000000C`. `0x40000002` ليس فيها. جدول 88 — `TPM2B_TIMEOUT` حجمه 8 أو أقل. جدول 222 — `pcrDigest.size` صفر إن كانت قائمة PCR فارغة. جدول 135 — `TPMS_AUTH_RESPONSE`. §10.7.5 — تذكرة NULL: `<TPM_ST_AUTH_SIGNED, TPM_RH_NULL, 0x0000>`.
- [Part 3 rev 01.38، 29 سبتمبر 2016](https://trustedcomputinggroup.org/wp-content/uploads/TPM-Rev-2.0-Part-3-Commands-01.38.pdf): §11.1 جدول 16 — رد `StartAuthSession` مقبض و`nonceTPM`، والوسم يطابق الطلب (بلا جلسات إن لم تُرفق جلسة audit/decrypt/encrypt). §23.3 — `timeout` فارغ إن كانت التذكرة NULL. §6.1–6.2 و§5.9 — رد الخطأ 10 بايتات بوسم بلا جلسات. §30.2 — `GetCapability` يعيد المقابض تصاعديًا والاستئناف من آخر مقبض + 1. §31.6 — `NV_ReadPublic` و`TPM_RC_HANDLE` لغياب الفهرس.

قياس swtpm لـcreationData خالف جدول 222: count=0 و`pcrDigest` حجمه 32 لا 0. `parentNameAlg=0x0010` (`TPM_ALG_NULL`) و`parentName` طوله 4 وقيمته `0x40000001`، وهذا يطابق جملة الجدول لحالة `ALG_NULL`. المخطط يشترط حجم البصمة 32 دائمًا، فيقبل قياس المحاكي ويرفض الشكل الذي يشترطه الجدول عند قائمة فارغة. رد PolicySigned الحقيقي طابق تذكرة NULL في §10.7.5؛ الفاحص يقبل أيضًا timeout غير فارغ وهرمية `0x40000002`.

استبدال مقبض `Load` بمقبض `CreatePrimary` الحي (ليس في خط الأساس): `AdoptHandle` لم يرفض. البروفة تابعت إلى `Sign` على مقبض التخزين. الفشل `TPM_ERROR: s2.trial:Sign(aHash) rc=0x0000019c`. الكائن المحمّل الحقيقي `0x80000001` بقي، و`tpm2_getcap handles-transient` أظهره. فحص التبني يقارن خط الأساس فقط، لا المقابض المتبنّاة في الجولة نفسها. الحقل `status` = `FAILED_CLOSED`، لكن أوامر لاحقة أُرسلت قبل التوقف.

## 4. التنظيف والدفتر وما تقيسه الاختبارات

أوامر التغيير في `StateChanging` تُرسل عبر `SendTracked` أو `RefusedTracked` أو `RefusedIncrement` في المواضع التي قرأتها: Define وIncrement وUndefine وCreatePrimary وCreate وLoad وStartAuthSession وPolicySigned وPolicyCommandCode وFlush. `Sign` و`NV_Read` و`GetCapability` و`NV_ReadPublic` و`PolicyGetDigest` خارج المجموعة. `Flush` لا يرسل إن لم يكن المقبض في `_transients`.

حذف NV يمر بـ`UndefineOwn` ويشترط وجود المقبض في `_definedByRun` ثم مطابقة المنطقة عدا `WRITTEN`. فقد رد التعريف لا يضيف إلى `_definedByRun`. القياس: لا `NV_UndefineSpace` بعد فقد رد التعريف.

`undefine-drop-before` (الاستثناء قبل الإرسال، والفهرس ما زال موجودًا لأن رد التعريف كان قد وصل):

- الفشل عند `s1.probe:NV_UndefineSpace`.
- خطوات الحذف: `s1.probe:NV_UndefineSpace` ثم `cleanup:NV_UndefineSpace`.
- نص المصالحة: `nv-undefine 0x01a24fa0: still present; deletion outcome unknown; cleanup attempt budget already spent (no further attempt); declared as leftover`.
- `cleanupLeftovers` فارغ، `residualNv` فارغ، `postRunInventory.verified` = true.

النص يقول لا محاولة لاحقة، والقياس أظهر محاولة تنظيف لاحقة حذفَت فهرسًا كان رده عند التعريف قد وصل (فدخل `_definedByRun`). لم يُحذف فهرسٌ لم يُثبت تعريفه. العبارة لا تطابق الأمر الذي تلاها. مسار «الرد ضاع بعد تنفيذ الحذف والفهرس ما زال حاضرًا» لم يُفصل عن «الحذف لم يُرسل».

اختبارات R3 تقيس ما تعلنه أسماؤها للحالات التي تغطيها (مقبض خط أساس، more=1/count=0، فئة خاطئة، أربعة أشكال تفويض لا تطابق أي ملف، parameterSize الضخم، غياب مشوّه، Create وPolicySigned السلبي، فقد التعريف، ثمانية تشويهات مخطط). لا تغطي: شكل policy على أمر كلمة سر، nonce سياسة ≠ 32، البت المحفوظ 3، timeout غير فارغ، هرمية خارج `TPMI_RH_HIERARCHY`، بصمة تذكرة Create فوق 64، pcrDigest بحجم 0، استبدال مقبض أُنشئ في الجولة نفسها، تراكم الفهارس عبر تشغيلين. `stopSim` في `tpm-ceremony-wl413-r3.test.mjs` يحذف مجلد الحالة ولا يرسل إشارة للعملية: بعد المجموعة بقيت 21 عملية `swtpm` (بدأت 03:42:02–03:42:22، منافذ 2738–2992). أوقفتها في النهاية مع محاكي 5800. بعدها `ps` لا يظهر `swtpm`، و5800/5801 غير مفتوحين.

## 5. الوثائق وما يلزم قبل S1 على الشريحة

ما قالته الوثائق أكثر مما قِيس هنا:

- ADR 0007 §12.5 وسجل WL-414: ملف السياسة «nonce=32 وattrs=0x00» و«كل مخالفة» تُرفض. القياس قبل nonce 16 وattrs `0x08` وشكل policy على أمر كلمة سر، وانتهت تلك البروفات بالحقل `status` = `COMPLETE`.
- `sim/tpm-ceremony/README.md` حوالي 41–42 ما زال يقول «أي تشويه ⇒ فشل مغلق مسمى». القسم 3 تشويهات بنيتها الكلية سليمة ولم توقف البروفة.
- §12.3 ما زال يصف إصلاح SOL-02 بأنه `define-response-loss` ⇒ «executed; ownership proven» ويُحذف الفهرس، بلا إحالة أن §12.5 ألغى ذلك الحذف. الشيفرة والقياس لا يحذفان.
- سجل WL-414 يذكر `npm run validate` على `d64b9a08` (2848/2593/0/255) و`scripts/tpm-sim-ci.sh` (175/173/0/2). الكوميت غير موجود في هذه الشجرة، ومجلدات الأدلة المذكورة في التكليف غير متعقَّبة. لا أؤكد هذين الرقمين.
- نموذج التهديد §7 البند 11 يقول إن العوائق «عولجت» ويحيل إلى الاختبارات. القياس أعلاه يؤيد زوال السلوك القديم المذكور في الجدول، ويبقي الفجوات في القسم 3 و4. فصل العتاد في البند نفسه (لا TBS، لا سعة حرة، لا تفويض هرم، لا رتابة على الشريحة) يطابق أن هذا التشغيل كله على swtpm 0.10.1. `EXT-6` و`R3-A-01` في سجل الدين ما زالا مفتوحين وينصان على أن لا سطر تنفيذ على TPM حقيقي. §12.6 يوقف S1/S3/S4/S5 إلى إذن جديد. ذلك الحد مكتوب، ولم أُرسل أمرًا إلى شريحة.

قبل أي إذن بـS1 على الشريحة، مما قِسته أو قرأته ولم يُقس على عتاد: سماح TBS أو منعه، السعة الحرة (`NV_COUNTERS_MAX=0` على هذا المحاكي لا يساوي `NV_COUNTERS_AVAIL`)، تفويض هرم التخزين، رتابة العداد عبر إعادة التشغيل وانقطاع الطاقة، وسلوك إعادة التعريف فوق القيمة السابقة (قياس محاكٍ في تعليقات الشيفرة). ويُضاف من هذا القياس: فهارس فقد رد تعريفها تتراكم ولا يمسحها تشغيل لاحق؛ مخطط creationData مربوط بحجم بصمة 32 الذي يعيده swtpm عند count=0 لا بجملة جدول 222؛ فحص التفويض والتذكرة أضيق من نص §12.5 وأوسع من جداول Part 2 التي قرأتها؛ فحص التبني لا يشمل مقبضًا أُنشئ في الجولة نفسها.

## حدود هذا التقرير

لم أُعِد إنتاج العيوب على `8b48a568` (الشجرة مثبتة على `de099aa8`، ولا نسخة أخرى في المجلد). الاستنتاج أن السلوك القديم لم يظهر هنا استنتاج من قياسات هذه الشجرة، لا من تشغيل الشجرة السابقة. لم أُشغّل ctrl غير loopback ولا ثنائيًا منتحلًا لـ`swtpm`. لم أقرأ تقارير أعضاء هذه الجولة.
