# مراجعة WL-414 R3 — gpt_6_1_sol

## النطاق والاستقلال

طبعت الشجرة `de099aa8cfd82dda106199eeaf11e134b5ee6639`؛ وحفظت خرج `git status --porcelain` الأخير في ملف طوله صفر بايت، وكذلك فرق الملفات الأربعة المحمية عن `8b48a568`. [الفحص الأول](preflight.txt)، [الفحص الأخير](final-audit-v2.txt)، [خرج الحالة](git-status.txt)، [فرق الملفات المحمية](protected-files.diff).

قرأت التكليف، والشيفرة والاختبارات والوثائق المحددة، وتقريري الجولة الأولى التاريخيين لـ`gpt_6_1_sol` و`grok_4_7`؛ لم أقرأ مجلد عضو آخر في هذه الجولة، ولا تقريراً من مجلد تقارير R3، ولم أستعمل `gh` أو إيداعاً أو دفعاً أو أعدّل ملفاً متعقباً. كل مسابري ونتائجها تحت هذا المجلد؛ واستخراج النواة القديمة كان بـ`git show` إلى ملف خارجهـا. [مشغّل المسابر](run-independent.sh)، [النواة المستخرجة](Core-8b48a568.cs)، [فرق النواة المقروء](core-r3.diff)، [فرق المشغّل](rehearse-r3.diff).

البيئة المقيسة: Node `v20.20.2`، PowerShell `7.4.6`، swtpm `0.10.1`، tpm2-tools `5.7`؛ استعملت مسابري المنفذ `5600` والتحكم `5601` بالتتابع، أما محاكيات المنافذ العشوائية فأنشأتها الاختبارات المشحونة نفسها. [البيئة](preflight.txt)، [مسابر النقل والتراكم](context-and-accumulation.sh)، [تشغيل الحالات المشحونة](run-shipped-faults.sh).

لا قياس هنا على Windows أو TBS أو شريحة أو انقطاع طاقة، ولم أفتح `/dev/tpm*` أو أشغّل `scripts/tpm-sim-ci.sh`؛ كل نقل مخصّص في مسابري يلتف حول محاكي loopback الخاص فقط. [مصدر المسبر](IndependentR3.cs)، [مشغّل المسابر](run-independent.sh)، [أوامر السياق](context-and-accumulation.sh).

## خلاصة القياس

- أمر الاختبارات الخمسة خرج `0`، وحقول TAP كانت `tests 62` و`pass 62` و`fail 0` و`skipped 0`؛ البروفة المباشرة `ALL` خرجت `0`، وبها `status="COMPLETE"` و81 خطوة وبقايا فارغة. هذه أسماء حقول مخرجات، لا تعميم على الردود الأخرى. [TAP](test-suite.tap)، [خروج الاختبارات](test-suite.exit)، [البروفة](rehearsal.json)، [خروجها](rehearsal.exit).
- أعدت 29 وضعاً من الحزام المشحون على محاكٍ جديد لكل وضع، و33 حالة مستقلة على الرأس، و32 من هذه الحالات على نواة `8b48a568` مستخرجة خارج الشجرة؛ خرج جامع JSON في كل حالة منها `0`، بينما حالة البروفة داخل JSON تختلف باختلاف الحقن. [الحالات المشحونة ومخارجها](shipped/commands.log)، [ملخصها](shipped-summary.json)، [27 حالة مستقلة](current-v2-summary.json)، [أربع حالات إضافية](current-extra-summary.json)، [حالة Create الإضافية](current-create-proof-summary.json)، [فهرس الطرف الآخر](current-foreign/same-public-foreign.json)، [مقارنة النواة القديمة](baseline-v2-summary.json)، [إضافاتها](baseline-extra-summary.json)، [فهرس الطرف الآخر على القديم](baseline-foreign/same-public-foreign.json).
- تغيّرت نتائج الأمثلة القديمة للمقبض الموجود في خط الأساس، والصفحة بلا تقدم، والفئة الخاطئة، وتشويهات التفويض الأربعة، والبنية القصيرة، وفقد رد Create وPolicySigned السلبي؛ لكن بقي قبول تشويهات أخرى، وأمكن في حقن مركّب تحرير كائن موجود قبل الجولة. [الحالات المشحونة](shipped-summary.json)، [الكائن السابق الذي حُرّر](current-v2/inventory-duplicate-alias.json)، [التفويضات الأخرى](current-v2-summary.json).
- ظهرت أيضاً عملية اختبارية جديدة تترك 21 محاكي swtpm بعد خروج Node، ورفضٌ جديد لترميز بيانات إنشاء ذي `pcrDigest` فارغ عند اختيار PCR فارغ، وتناقضات وصفية في الجرد والوثائق؛ التفاصيل أدناه تفصل هذه النتائج عن حدود العتاد. [العمليات المتبقية](test-owned-process-metadata.txt)، [حالة بيانات الإنشاء](current-extra/cd-empty-pcr-digest.json)، [الجرد بعد خط أساس جزئي](current-v2/baseline-transient-badclass.json)، [مقتطف README](readme-excerpt.txt).

## أوامر إعادة القياس

الأمر الأول التالي هو الذي شغّلته من شجرة المراجعة، مع محاكي خاص مطابق لأمر التكليف على `5600/5601`؛ أوامر البدء والبناء والحالات الإضافية ظاهرة أيضاً في السكربتات المحفوظة. [أوامر الحالات المستقلة](run-independent.sh)، [أوامر النقل والتراكم](context-and-accumulation.sh)، [أوامر الحزام](run-shipped-faults.sh).

```sh
R=/home/user/workspace/xuux-review-de099aa8
W=/home/user/workspace/council-wl413-r3/gpt_6_1_sol
cd "$R"
XUUX_TPM_SIM=1 TPM2TOOLS_TCTI=swtpm:host=127.0.0.1,port=5600 \
  node --test --test-concurrency=1 \
  tests/sim/tpm-ceremony-rehearsal.test.mjs \
  tests/sim/tpm-ceremony-guard.test.mjs \
  tests/sim/tpm-ceremony-remediation.test.mjs \
  tests/sim/tpm-ceremony-wl413-r2.test.mjs \
  tests/sim/tpm-ceremony-wl413-r3.test.mjs
pwsh -NoProfile -File sim/tpm-ceremony/rehearse.ps1 \
  -SimHost 127.0.0.1 -SimPort 5600 -Stages ALL -SimPidFile "$W/pid"

# بعد إيقاف محاكي الأمر السابق: السكربت يبدأ ويوقف محاكياً لكل حالة
mcs -langversion:5 -out:"$W/IndependentR3-final.exe" \
  sim/tpm-ceremony/TpmCeremonyCore.cs "$W/IndependentR3.cs"
bash "$W/run-independent.sh" IndependentR3-final.exe replay
bash "$W/run-independent.sh" IndependentR3-final.exe replay-extra \
  'cd-empty-pcr-digest create-cd-missing post-inventory-no-progress post-inventory-wrong-class create-loss-proof same-public-foreign'
bash "$W/run-shipped-faults.sh"
bash "$W/context-and-accumulation.sh"
```

السكربتات تتطلب خلو `5600/5601` قبل بدئها؛ ملفات `.exit` تخص خروج جامع المسبر أو PowerShell لا حكماً مستنبطاً من `status`. لم أعد تشغيل `npm run validate` في هذه المراجعة، ولم أعد إنتاج العددين الشاملين 2848 و175 المذكورين في التكليف. [مخارج المسابر المستقلة](current-v2/commands.log)، [مخارج الإضافات](current-extra/commands.log)، [مخارج الحزام](shipped/commands.log).

## 1. إعادة فحص SOL413-01..08 وG47-413-1..9

كل اسم وضع في الجدول استُدعي بالحزام `pwsh … -Mode fault -SimPort 5600 -Fault <الوضع>`، إلا الأسماء المسبوقة بـ`independent:` فهي `mono IndependentR3-*.exe <الوضع>`، وحالتا سياق المستمع تستعملان `rehearse.ps1` نفسه. [أوامر الحزام ومخارجها](shipped/commands.log)، [أوامر المسابر المستقلة](current-v2/commands.log)، [أوامر السياق ومخارجها](context/commands.log).

| المعرف التاريخي | إعادة القياس على الرأس والخروج | حد النتيجة |
|---|---|---|
| SOL413-01 | `session-alias`: خروج الحزام `0`؛ `OUTCOME_UNKNOWN … RESPONSE_HANDLE_PREEXISTING`، مع ترك الجلسة الحقيقية الجديدة معلنة. و`independent:primary-alias` لم يرسل أي Flush إلى الكائن السابق، بخلاف النواة القديمة التي حرّرته. [جلسة](shipped/session-alias.json)، [رأس/كائن](current-v2/primary-alias.json)، [قديم/كائن](baseline-v2/primary-alias.json) | يختلف المثال الأصلي؛ ما زال قبول خط أساس ذي مقابض مكررة يتيح الالتفاف بحقنين، النتيجة R3SOL-01. |
| SOL413-02 | `inventory-no-progress` و`inventory-wrong-class`: خروج `0`، وسببان مسميان؛ وأعدت الحقن في الجرد النهائي نفسه، فأصبح `postRunInventory.verified=false` في الحالتين. [قبل التغيير](shipped-summary.json)، [نهائي بلا تقدم](current-extra/post-inventory-no-progress.json)، [نهائي بفئة خاطئة](current-extra/post-inventory-wrong-class.json) | لا يتكرر الفراغ القديم بهذين التشويهين؛ التكرار والترتيب والعدد قيود أخرى غير مفحوصة، والجرد بعد خط أساس جزئي حالة أخرى. |
| SOL413-03 | أوضاع `auth-nonce-byte` و`auth-hmac-byte` و`auth-attrs-ff` و`auth-attrs-clear`، خروج كل منها `0`، وبها `RESPONSE_AUTH_CONTENT_MALFORMED` عند التعريف. [النتائج الأربع](shipped-summary.txt) | قبول ملف السياسة مكان password، والعكس، والبت 3، باقٍ في R3SOL-02. |
| SOL413-04 | أوضاع `schema-*` الثمانية، خروج `0`، وأسباب مسماة للمنطقة العامة الفارغة وبيانات/بصمة الإنشاء القصيرة ووسم التذكرة وnonce الفارغة وقراءة NV القصيرة ومكوّن التوقيع وبصمة PolicySigned ذات 65 بايتاً. وقلب اسم Primary أعطى `RESPONSE_NAME_HASH_MISMATCH`. [ثمانية الأوضاع](shipped-summary.json)، [الاسم](current-v2/primary-name-flip.json) | لا تعني هذه الأمثلة فك كل الحقول الداخلية؛ R3SOL-03 يورد أمثلة قُبلت. |
| SOL413-05 | `readpublic-malformed-18b` و`readcounter-malformed-14a`: خروج `0`؛ سطر `reconcile … unverifiable: RESPONSE_ERROR_TAG_MALFORMED` في البقايا، دون تحويل التشويه إلى غياب أو عداد غير مهيأ. [18B](shipped/readpublic-malformed-18b.json)، [14A](shipped/readcounter-malformed-14a.json) | القياس لتشويهي الوسم هذين؛ وفحص مباشر مستقل رفض أيضاً جسم خطأ 14A ذي بايت زائد. [الفحص المباشر](parser-boundary.txt) |
| SOL413-06 | `create-response-loss` و`policysigned-neg-loss`: خروج `0`، و`OUTCOME_UNKNOWN` ثم سطر مصالحة في الحالتين. [Create](shipped/create-response-loss.json)، [PolicySigned](shipped/policysigned-neg-loss.json) | القيد لم يعد غائباً؛ عبارة Create الجديدة عن «likely not executed» لا تتبع من غياب مقبض، R3SOL-08. |
| SOL413-07 | `paramsize-huge`: خروج `0` و`RESPONSE_PARAMETER_SIZE_INVALID`؛ والفحص المباشر لـ`0xffffffff` و`0x80000000` أعطى السبب نفسه قبل قراءة منطقة المعاملات. [الحزام](shipped/paramsize-huge.json)، [الفحص المباشر وخروجه](parser-boundary.txt)، [الخروج](parser-boundary.exit) | لا قياس لاستهلاك ذاكرة كبير؛ الحالات المسجلة رفضت الإعلان غير الموافق للمتبقي. |
| SOL413-08 | نص R3 يذكر عدم حذف الفهرس بعد فقد الرد، لكن README وTHREAT_MODEL يحتفظان أيضاً بعبارات إثبات الملكية بالمطابقة، وعبارة «أي تشويه»؛ وقبول الردود أدناه أمثلة مضادة للتعميم. [README](readme-excerpt.txt)، [نموذج التهديد](threat-model-excerpt.txt)، [الردود المقبولة](current-v2-summary.json) | نتيجة وصفية، لا تجربة عتاد، R3SOL-07. |
| G47-413-1 | `define-response-loss` و`define-params-extra` و`missing-response-auth`: خروج `0`؛ الفهرس المطابق بقي على المحاكي، ولا حذف له من البروفة، مع `ownership-undetermined`. وأعدت زرع فهرس مطابق بتفويض فهرس مختلف ثم فقد رد تعريف البروفة: رأس R3 تركه، و8b حذفه. [فقد الرد](shipped/define-response-loss.json)، [زوائد المعاملات](shipped/define-params-extra.json)، [تفويض غائب](shipped/missing-response-auth.json)، [زرع مستقل/رأس](current-foreign/same-public-foreign.json)، [زرع مستقل/قديم](baseline-foreign/same-public-foreign.json) | قرار عدم الحذف مرصود أيضاً لفهرس أنشأه ناقل الطرف الآخر فعلاً قبل تمرير تعريف البروفة. |
| G47-413-2 | HMAC من بايت واحد يُرفض الآن؛ لكن تفويض password ذي nonce بطول 32 وسمات `0x08` وصل إلى `status="COMPLETE"` و81 خطوة وبقايا فارغة. [رفض HMAC](shipped/auth-hmac-byte.json)، [الحالة الأخرى](current-v2/auth-pw-reserved3.json) | معالجة المثال القديم لا تربط نوع التفويض بالطلب، R3SOL-02. |
| G47-413-3 | التشويهات القصيرة المسماة في الاختبارات توقفت؛ في المقابل قُبلت بيانات إنشاء ناقصة الحقول وتذاكر ذات هرم `0x40000002` وtimeout غير فارغ عند expiration=0. [المخططات المشحونة](shipped-summary.json)، [بيانات ناقصة](current-v2/cd-missing.json)، [تذكرة](current-v2/policy-ticket-hierarchy.json)، [timeout](current-v2/policy-ticket-timeout.json) | فحص جزئي للمحتوى، R3SOL-03، لا انعدام للفحص. |
| G47-413-4 | `parameterSize=0xffffffff` أعطى استثناء `ResponseMalformedException` بالسبب المسمى، خروج المسبر `0`. [الخرج](parser-boundary.txt) | يختلف سبب الرفض عن الاستثناء العام التاريخي. |
| G47-413-5 | `independent:cleanup-undefine-loss`: خروج `0`؛ محاولة حذف تنظيف واحدة حُجبت قبل الإرسال، ثم مصالحة «cleanup attempt budget already spent (no further attempt)»، والفهرس بقي معلناً؛ النواة القديمة تقول «cleanup retries once (bounded)» في الحالة نفسها. [حالي](current-v2/cleanup-undefine-loss.json)، [قديم](baseline-v2/cleanup-undefine-loss.json) | تغيرت الرسالة بما يطابق عدم إرسال محاولة أخرى في هذه الإعادة. |
| G47-413-6 | نفس حالتي Create وPolicySigned في SOL413-06؛ قيد ومصالحة موجودان الآن. [النتيجتان](shipped-summary.txt) | دقة وصف Create منفصلة عن وجود القيد، R3SOL-08. |
| G47-413-7 | شغّلت ثنائياً خاصاً اسمه و`comm` له `swtpm` وبوسائط مناسبة على 5600؛ المشغّل خرج `4` مع `SIMULATOR_LISTENER_EXE_MISMATCH`، وسجل الثنائي لم يتجاوز سطر الاستماع. [JSON](context/fake-exe.json)، [سجل الثنائي](context/fake-listener.log)، [مصدره](fake-swtpm.c)، [المخارج](context/commands.log) | لا اختبار لانتحال PATH أو تبديل inode أو سباق مستمع أو خصم ذي صلاحيات المضيف. |
| G47-413-8 | swtpm حقيقي على 5600 وctrl على `0.0.0.0:5601`: المشغّل خرج `4` مع `SIMULATOR_LISTENER_CTRL_PORT_NOT_LOOPBACK`. [المقابس](context/broad-listeners.txt)، [JSON](context/broad-control.json)، [المخارج](context/commands.log) | فحص الإعداد الواسع المذكور، لا تدقيق بروتوكول التحكم أو مصادقة الطرف. |
| G47-413-9 | نفس نتيجة SOL413-08؛ التقييد في فقرة R3 لم يزل العبارات القديمة ولا يحول الأمثلة المحددة إلى فحص لكل رد. [مقتطفا الوثائق](readme-excerpt.txt)، [نموذج التهديد](threat-model-excerpt.txt) | R3SOL-07. |

## 2. قرار عدم الحذف بعد فقد رد التعريف وأثر التكرار

في مسبر `same-public-foreign` عرّف الغلاف فهرس الطلب نفسه مسبقاً بمنطقة عامة مطابقة وتفويض فهرس `0x11`، فكان رد زرعه `0` ورد تعريف البروفة اللاحق `0x14c` ثم أُسقط الرد؛ الرأس ترك الفهرس `0x01bfc320` ولم يرسل حذفه، بينما أرسل8b حذف الفهرس النظير وقال في حقل المصالحة `ownership proven by publicArea match`. [الرأس](current-foreign/same-public-foreign.json)، [8b](baseline-foreign/same-public-foreign.json)، [المصدر](IndependentR3.cs).

على حالة محاكي واحدة، أعدت `define-response-loss` ثلاث مرات: قوائم `nvBefore/nvAfter` زادت من 0 إلى 1 ثم 2 ثم 3، وكل تشغيل أعلن الفهرس الجديد وحده ضمن `residualNv` وتركه؛ خرج كل استدعاء للحزام `0`، وحالة البروفة فيه `FAILED_CLOSED`. [الأولى](accumulation/lost-1.json)، [الثانية](accumulation/lost-2.json)، [الثالثة](accumulation/lost-3.json)، [المخارج](accumulation/commands.log).

بعدها شغّلت بروفة عادية على المحاكي نفسه، فخرجت `0` و`status="COMPLETE"` و`baseline.nvHandles="3"` و`residualNv=[]`؛ والجرد الخارجي بعدها أبقى الفهارس الثلاثة `0x0199eefd` و`0x01a0f699` و`0x01b7cd77`. [البروفة اللاحقة](accumulation/subsequent-normal.json)، [جرد tpm2-tools اللاحق](accumulation/nv-after-normal.txt).

إذن الفراغ في `residualNv` هنا فرقٌ عن خط الأساس، لا فراغ المخزن، والتوقف في عملية واحدة لا يمنع بدء عملية جديدة مع أدلة متروكة من عملية سابقة؛ لم أملأ السعة إلى حدها ولم أقس عدد الإعادات اللازم لاستنفادها. [المقارنة](accumulation-summary.json)، [الجرد الأول والأخير](accumulation/nv-initial.txt)، [الجرد الأخير](accumulation/nv-after-normal.txt).

هذه زيادة بقايا مقيسة تنتج من سياسة إبقاء الفهرس، وليست مبرراً لحذفه دون حسم الملكية؛ وسؤال الاحتفاظ الدائم أو وقف إعادة التشغيل إلى حين قرار المالك يبقى منفصلاً عن سلامة الامتناع عن الحذف في الحالات الثلاث. [نتائج الامتناع عن الحذف](accumulation-summary.json)، [نص ADR §12.5](../../xuux-review-de099aa8/docs/adr/0007-tpm-nv-counter-freshness-anchor-design.md#L499).

## 3. تحليل الردود والبنى والقيود

### نسخ المواصفة المستخدمة

قرأت نصوص TCG TPM Library، Family 2.0، Level 00، Revision **01.38، 29 September 2016** للأجزاء 1–3؛ تعذّر جلب PDF عبر أداة قراءة الويب، ثم جُلبت الملفات بـHTTPS وحوّلت إلى نص محلي، وبصماتها محفوظة. [Part 1 r1.38](https://cdn.trustedcomputinggroup.org/production/TPM_Rev_2_0_Part_1_Architecture_01_38_425d4a82aa.pdf)، [Part 2 r1.38](https://cdn.trustedcomputinggroup.org/production/TPM_Rev_2_0_Part_2_Structures_01_38_213d66fde1.pdf)، [Part 3 r1.38](https://cdn.trustedcomputinggroup.org/production/TPM_Rev_2_0_Part_3_Commands_01_38_f1ed38ee7e.pdf)، [البصمات](tcg-sha256.txt).

وقرأت أيضاً **Part 2 Revision 01.83، 25 January 2024، §15.1** وموضع البتين المحجوزين في TPMA_SESSION بأداة قراءة الويب؛ قاعدة `pcrDigest.size=0` عند قائمة PCR فارغة موجودة في النسختين المقروءتين. [Part 2 r1.83 §15.1](https://trustedcomputinggroup.org/wp-content/uploads/TPM-2.0-1.83-Part-2-Structures.pdf)، [مقتطف القراءة](spec-r183-note.md)، [مقتطف r1.38 §15.1](spec-creation-excerpt.txt).

### R3SOL-01 — جرد مكرر يخفي كائن خط أساس ثم يتيح تحريره

**القياس:** زرعت مسابري كائني تخزين قبل `Run` عند `0x80000000/0x80000001`؛ استبدلت صفحة خط الأساس `[0x80000000,0x80000001]` بصفحة `[0x80000000,0x80000000]`، ثم استبدلت مقبض CreatePrimary الحقيقي `0x80000002` بالمقبض السابق `0x80000001`. هذه حالة **حقنين**، و`changes=2`، وليست حذفاً ناتجاً من التكرار وحده. [الطلبان والتعديلان والجردان](current-v2/inventory-duplicate-alias.json)، [مصدر الحقن](IndependentR3.cs).

قُبلت صفحة التكرار، ثم أرسلت البروفة `FlushContext(0x80000001)`؛ كان الجرد الخارجي قبلها `[0x80000000,0x80000001]` وبعدها `[0x80000000,0x80000002]`، وانتهت `FAILED_CLOSED` بسبب `Create … rc=0x902` وبقية الكائن الجديد، لا بسبب رفض صفحة التكرار أو تبني المقبض السابق. [JSON قبل/بعد و`flushed`](current-v2/inventory-duplicate-alias.json).

الفحص المباشر قبل أيضاً 65 قيمة لطلب 64، وقيمة دون `property` المطلوب، والتكرار والترتيب التنازلي؛ `ResponseSchema` يفحص الفئة والعدد العام لا علاقات الترتيب والتقدم وحد الطلب. [نتائج الفحص المباشر](parser-boundary.txt)، [الشيفرة 743–770 و1108–1174](../../xuux-review-de099aa8/sim/tpm-ceremony/TpmCeremonyCore.cs#L743).

Part 3 r1.38 §30.2 يحدد بدء القراءة عند الخاصية أو التالية الأعلى، وعدم إرجاع أكثر من العدد المطلوب، واجتياز المقابض إلى الأعلى؛ لذلك فالتكرار والحد الأدنى والعدد ليست مجرد تفضيلات للعرض. [Part 3 r1.38 §30.2، ص340–342](https://cdn.trustedcomputinggroup.org/production/TPM_Rev_2_0_Part_3_Commands_01_38_f1ed38ee7e.pdf).

**التصنيف:** عالية بالنسبة لفصل موارد المحاكي؛ ظهرت الحالة المركبة أيضاً على `8b48a568`، فلا أنسب نشأتها إلى R3، وإنما أن فحص خط الأساس الجديد لا يكفي عند قبول جرد كهذا. [إعادة النواة القديمة](baseline-v2/inventory-duplicate-alias.json)، [إعادة الرأس](current-v2/inventory-duplicate-alias.json).

### R3SOL-02 — اختيار ملف التفويض من محتوى الرد لا من الطلب

**القياس:** تسع حالات مستقلة مختلفة انتهت إلى `status="COMPLETE"` و81 خطوة وبقايا فارغة: nonce بطول 16 أو32 أو64 في رد password؛ nonce=32 مع `attrs=0x08` أو`0x02` في رد password؛ وإقرار password فارغ أو nonce=16 أو`attrs=0x01` أو`0x08` في رد الزيادة بجلسة policy. [ملخص الحالات](current-v2-summary.json)، [password والبت3](current-v2/auth-pw-reserved3.json)، [policy ورد password](current-v2/auth-policy-password.json)، [policy والبت3](current-v2/auth-policy-reserved3.json).

الفاحص يقبل `passwordProfile || policyProfile` دون استلام نوع تفويض الطلب، ويقبل `16..64` لا 32 فقط للسياسة، والقناع `0xF0` لا يزيل البت 3؛ لذلك دخلت الأمثلة المذكورة تحت الملف الآخر أو تحت قناع يسمح بالبت المحجوز. [Resp.Parse 498–506](../../xuux-review-de099aa8/sim/tpm-ceremony/TpmCeremonyCore.cs#L498)، [تعديلات التفويض المسجلة](selected-edits.txt).

Part 1 r1.38 §19.4، جدول13 يحدد nonce وHMAC فارغين لإقرار password، وPart 2 r1.38 §8.4، جدول32 يخصص البتين 4:3 للصفر ويجعل auditExclusive صفراً في الرد عندما يكون audit صفراً؛ والنسخة 1.83 المقروءة تبقي البتين 4:3 محجوزين. [Part 1 r1.38 §19.4](https://cdn.trustedcomputinggroup.org/production/TPM_Rev_2_0_Part_1_Architecture_01_38_425d4a82aa.pdf)، [Part 2 r1.38 §8.4](https://cdn.trustedcomputinggroup.org/production/TPM_Rev_2_0_Part_2_Structures_01_38_213d66fde1.pdf)، [Part 2 r1.83](https://trustedcomputinggroup.org/wp-content/uploads/TPM-2.0-1.83-Part-2-Structures.pdf).

**التصنيف:** متوسطة؛ الأمثلة كانت مقبولة أيضاً في إعادة `8b48a568`، أما الآلية الحالية فتضيف رفضاً لبعض القيم فقط ولا تحقق وصف الوثيقة لملف سياسة بطول32 وسمات0. [النواة القديمة](baseline-v2-summary.json)، [وصف ADR §12.5](../../xuux-review-de099aa8/docs/adr/0007-tpm-nv-counter-freshness-anchor-design.md#L486).

### R3SOL-03 — بنى داخلية وقيم مشتقة ما زالت تقبل التشويه

كل حالة في الجدول خرج جامعها `0`، وكانت حالة البروفة `COMPLETE`، و81 خطوة، وقوائم البقايا فارغة؛ التعديل على المعاملات أعاد بناء غلاف الرد مع الحفاظ على نوعه ومنطقة التفويض. [مصدر إعادة البناء](IndependentR3.cs)، [الملخص](current-v2-summary.json)، [إضافة Create](current-extra/create-cd-missing.json).

| التشويه | المقيس | سبب القبول في المسار |
|---|---|---|
| `cd-missing` و`create-cd-missing` | حذف حقول `parentName/parentQualifiedName/outsideInfo` كلها من بيانات إنشاء Primary أو Create. [Primary](current-v2/cd-missing.json)، [Create](current-extra/create-cd-missing.json) | الحلقة في `CreationData` تقبل صفر حقول TPM2B لاحقة بدلاً من الثلاثة المحددة؛ نهاية 41 بايتاً لا تثير خطأ. [618–640](../../xuux-review-de099aa8/sim/tpm-ceremony/TpmCeremonyCore.cs#L618) |
| `cd-extra`، `cd-parentalg` | إضافة TPM2B رابع، أو جعل parentNameAlg=`0xffff`. [زائد](current-v2/cd-extra.json)، [خوارزمية](current-v2/cd-parentalg.json) | عدد الحقول مسموح إلى أربعة، وparentNameAlg يُقرأ دون تحقق من قيمته أو ارتباطه بالأسماء. [636–640](../../xuux-review-de099aa8/sim/tpm-ceremony/TpmCeremonyCore.cs#L636) |
| `creationhash-flip` | قلب بايت واحد في creationHash مع بقاء طوله32. [النتيجة](current-v2/creationhash-flip.json) | الفحص للطول، لا مطابقة SHA-256 للـcreationData. [715–717](../../xuux-review-de099aa8/sim/tpm-ceremony/TpmCeremonyCore.cs#L715) |
| `creation-ticket-hierarchy`، `creation-ticket-digest` | هرم `0x40000002`، أو بصمة تذكرة إنشاء بطول65. [هرم](current-v2/creation-ticket-hierarchy.json)، [بصمة](current-v2/creation-ticket-digest.json) | نطاق عددي متصل للهرم، وتجاهل بصمة تذكرة الإنشاء بعد فك TPM2B. [584–589 و711–717](../../xuux-review-de099aa8/sim/tpm-ceremony/TpmCeremonyCore.cs#L584) |
| `policy-ticket-timeout`، `policy-ticket-hierarchy`، `policy-ticket-digest` | timeout من بايت واحد، أو هرم `0x40000002`، أو بصمة من بايت واحد مع هرم NULL، في رد PolicySigned ذي expiration=0. [timeout](current-v2/policy-ticket-timeout.json)، [هرم](current-v2/policy-ticket-hierarchy.json)، [بصمة](current-v2/policy-ticket-digest.json) | timeout مهمل؛ فحص الهرم نطاقي، والبصمة مقيدة بحد أعلى فقط، دون شرط NULL Ticket. [734–741](../../xuux-review-de099aa8/sim/tpm-ceremony/TpmCeremonyCore.cs#L734) |
| `foreign-load-name` | قلب آخر بايت في Name لرد Load الثاني، مفتاح الاختبار الآخر؛ قبلته البروفة حتى نهايتها. [النتيجة والتعديل](current-v2/foreign-load-name.json) | مخطط Load يفرض طولاً وبادئة فقط؛ تحقق البصمة اللاحق موجود لمفتاح الخدمة، وليس لـLoad الآخر. [690–691 و1478–1485](../../xuux-review-de099aa8/sim/tpm-ceremony/TpmCeremonyCore.cs#L690) |

المقابلة بالمواصفة: Part 2 r1.38 §15.1، جدول212 يسمي الحقول الثلاثة الأخيرة صراحة؛ وPart 3 r1.38 §12.1، جدول20 و§24.1، جدول158 يجعلان creationHash تجزئة creationData بخوارزمية اسم المفتاح، لا مخزناً بطول صحيح وحده. [Part 2 r1.38 §15.1](https://cdn.trustedcomputinggroup.org/production/TPM_Rev_2_0_Part_2_Structures_01_38_213d66fde1.pdf)، [Part 3 r1.38 §12.1 و§24.1](https://cdn.trustedcomputinggroup.org/production/TPM_Rev_2_0_Part_3_Commands_01_38_f1ed38ee7e.pdf).

نوع هرم التذكرة في Part 2 r1.38 §§9.12،10.7.3،10.7.5 يختار OWNER/PLATFORM/ENDORSEMENT/NULL لا المجال العددي كله؛ و§10.7.2 يجعل digest فارغاً لتذكرة NULL، وPart 3 r1.38 §23.3، جدول118 يجعل timeout فارغاً إذا كانت التذكرة NULL ويطلب تذكرة NULL للـexpiration غير السالب. [Part 2 r1.38](https://cdn.trustedcomputinggroup.org/production/TPM_Rev_2_0_Part_2_Structures_01_38_213d66fde1.pdf)، [Part 3 r1.38 §23.3](https://cdn.trustedcomputinggroup.org/production/TPM_Rev_2_0_Part_3_Commands_01_38_f1ed38ee7e.pdf).

**التصنيف:** متوسطة؛ هي أمثلة استمرار لصنف SOL413-04، لا دعوى اكتشاف كل تركيب ممكن أو التحقق التشفيري من سر HMAC داخل TPM، وكل الحالات المقارنة أعطت نتائج مماثلة على النواة القديمة. [مقارنة القديم](baseline-v2-summary.json)، [حالة Create القديمة](baseline-extra/create-cd-missing.json).

### هل يفحص ST_NO_SESSIONS فعلاً؟

نعم للحقل الذي استهدفته التجربة: nonce فارغة في رد StartAuthSession الأول ثم في رد جلسة السياسة الثاني رُفضت بـ`RESPONSE_SESSION_NONCE_MALFORMED`، وبصمة تذكرة PolicySigned ذات65 بايتاً رُفضت بـ`RESPONSE_TICKET_DIGEST_MALFORMED`، مع وصول مخطط الأمر إلى معاملات بلا parameterSize. [الأول](shipped/schema-nonce-empty.json)، [الثاني](current-v2/session-policy-empty.json)، [PolicySigned](shipped/schema-policysigned-digest.json)، [مخطط الأوامر 675–741](../../xuux-review-de099aa8/sim/tpm-ceremony/TpmCeremonyCore.cs#L675).

لكن شكل الوسم لا يكفي لفحص المحتوى: رد PolicySigned بـtimeout من بايت واحد ظل مقبولاً في الإعادة المستقلة، ومقبض StartAuthSession ذا فئة كائن عابر غير موجود قُبل في خطوة الإنشاء ثم رفضه TPM لاحقاً عند PolicySigned بـ`0x284`، لا في مخطط رد الإنشاء. [timeout المقبول](current-v2/policy-ticket-timeout.json)، [فئة المقبض](current-v2/session-handle-wrongclass.json).

Part 3 r1.38 §11.1، جدول16 يحدد `TPMI_SH_AUTH_SESSION` لمقبض جلسة الإنشاء، و§23.3، جدول118 يحدد timeout والتذكرة؛ لذلك تميز التجارب بين وصول المخطط إلى شكل بلا جلسات وبين استكمال قيود نوع حقوله. [Part 3 r1.38 §11.1 و§23.3](https://cdn.trustedcomputinggroup.org/production/TPM_Rev_2_0_Part_3_Commands_01_38_f1ed38ee7e.pdf).

### R3SOL-05 — قيد جديد يستبعد ترميز pcrDigest الفارغ

استبدلت في بيانات إنشاء Primary اختيار PCR ذي count=0 وdigest من32 بايتاً بترميز count=0 وdigest فارغ، وأعدت حساب creationHash للبيانات المعدلة؛ صار طول بيانات الإنشاء23 بايتاً، فرفضها الرأس بـ`RESPONSE_CREATION_DATA_MALFORMED: CreatePrimary len=23` وترك الكائن المنشأ، بينما انتهى المسبر نفسه على `8b48a568` إلى `COMPLETE`. [الرأس](current-extra/cd-empty-pcr-digest.json)، [القديم](baseline-extra/cd-empty-pcr-digest.json)، [مصدر التغيير](IndependentR3.cs).

هذا ترميز للحقل يتبع قاعدة §15.1 في Part 2 r1.38 وr1.83 المقروءتين؛ أما رد swtpm الأصلي المقيس فيحمل count=0 وdigest بطول32، والشيفرة الجديدة تثبت هذا الطول وتضع حداً أدنى38 للبيانات. [r1.38 §15.1](https://cdn.trustedcomputinggroup.org/production/TPM_Rev_2_0_Part_2_Structures_01_38_213d66fde1.pdf)، [r1.83 §15.1](https://trustedcomputinggroup.org/wp-content/uploads/TPM-2.0-1.83-Part-2-Structures.pdf)، [الرد قبل/بعد التعديل](current-extra/cd-empty-pcr-digest.json)، [الفحص 618–640](../../xuux-review-de099aa8/sim/tpm-ceremony/TpmCeremonyCore.cs#L618).

لم أعد إنشاء تذكرة HMAC للبيانات المعدلة، فلا أقدم الرد المعدل كله بوصفه رد TPM أصيلاً متسقاً تشفيرياً؛ المقيس هو رفض هذا الترميز من فاحص بنية البيانات قبل فحص تذكرة، لا عدم توافق مقيس مع شريحة أو تطبيق TPM آخر. [آلية التعديل](IndependentR3.cs)، [سبب الرفض الأول](current-extra/cd-empty-pcr-digest.json).

**التصنيف:** منخفضة، انحسار جديد في قبول البنية مقارنة بالنواة القديمة؛ نطاق البروفة مقصور على swtpm، ولذلك لا أستنتج تعطل مسار العتاد غير الموجود من هذه الإعادة. [الحالي والقديم](current-extra-summary.json)، [القديم](baseline-extra-summary.json).

## 4. التنظيف والفشل المغلق والدفتر والاختبارات

### R3SOL-04 — حقل جرد نهائي موجب بعد فشل خط الأساس جزئياً

شوّهت صفحة الكائنات العابرة الأولى فقط إلى فئة NV؛ توقف التشغيل بـ`FAILED_CLOSED` و`RESPONSE_CAPABILITY_HANDLE_CLASS_MALFORMED`، ولم يُرسل أمر مغير، لكن الجرد النهائي حمل `verified=true,error=null` وقوائم فارغة، مع أن خط أساس الكائنات العابرة والجلسات لم يُستكمل. [التقرير وخطواته الست](current-v2/baseline-transient-badclass.json).

السبب الظاهر من المسار هو أن `PostRunInventory` يتحقق من `_baselineNv` وحده، ثم لا يلمس مجموعتي خط الأساس الأخريين إن كانت قوائم الجرد النهائي فارغة؛ لذلك فالنتيجة ليست عودة إلى `status="COMPLETE"` أو حذف مورد، بل إسناد حقل جرد مقارن إلى خط أساس غير موجود كله. [SnapshotBaseline 1178–1188 وPostRunInventory 1655–1672](../../xuux-review-de099aa8/sim/tpm-ceremony/TpmCeremonyCore.cs#L1178)، [القياس](current-v2/baseline-transient-badclass.json).

**التصنيف:** منخفضة في دقة الحقل؛ تختلف هذه الحالة عن اختباري R3-02 اللذين يفشلان أثناء أول جرد NV، حيث كان `verified=false` فعلاً. [اختبارا أول جرد](shipped/inventory-no-progress.json)، [الفئة الخاطئة في أول جرد](shipped/inventory-wrong-class.json).

### دفتر الموارد

في الحالات المشحونة لفقد رد Create وPolicySigned السلبي، سجلت البروفة نتيجة مجهولة ومصالحة قبل التنظيف؛ وحجب Flush المستمر وحجب Undefine المستمر تركا مقابض معلنة ومرصودة من الناقل الداخلي غير المحرف. [Create](shipped/create-response-loss.json)، [PolicySigned](shipped/policysigned-neg-loss.json)، [رفض Flush](shipped/flush-refusal.json)، [رفض Undefine](shipped/blocked-forever-undefine.json).

راجعت مواضع إرسال أوامر مجموعة `StateChanging` العشرة: التعريف والزيادات والحذف وPrimary/Create/Load وStartAuthSession وتغييري السياسة وFlush تستعمل `SendTracked` أو غلاف رفض يتتبع Pending؛ لم أجد في المواضع الحالية المسمّاة أمراً من هذه المجموعة مرسلاً عبر `Ok/Refused` وحدهما. هذا استنتاج من مواضع النداء وليس حقناً لفقد الرد عند كل ظهور منها. [فهرس مواضع الإرسال](send-callsite-index.txt)، [المجموعة والأغلفة 917–1055](../../xuux-review-de099aa8/sim/tpm-ceremony/TpmCeremonyCore.cs#L917).

التنظيف في مسبر فقد رد حذف التنظيف لم يرسل محاولة أخرى، وصرّح ببقاء NV؛ وفي النقل الميت بعد التعريف صرّح بعدم توفر الجرد والحالة الباقية، لا بفراغها. [فقد الرد في التنظيف](current-v2/cleanup-undefine-loss.json)، [النقل الميت](shipped/transport-dead-after-define.json).

### R3SOL-08 — رسالة مصالحة Create تربط غياب المقابض باحتمال عدم التنفيذ

في مسبر مستقل تركت Create يُرجع `responseCode=0` إلى الغلاف ثم رميت الرد؛ سجل الغلاف ذلك حرفياً، وسجلت البروفة `OUTCOME_UNKNOWN` لكن مصالحتها كانت `object-create: no new handle since baseline (likely not executed)`؛ خرج المسبر `0` ولم تبق كائنات عابرة بعد التنظيف. [القياس المستقل](current-create-proof/create-loss-proof.json)، [المصدر](IndependentR3.cs).

Part 3 r1.38 §12.1، جدول20 يُرجع blobs وبيانات إنشاء لا مقبض كائن؛ لذلك غياب مقبض جديد في هذا الأمر لا يسند عبارة «likely not executed»، ولو كان وجود القيد نفسه تغيراً مرصوداً عن النواة القديمة. [Part 3 r1.38 §12.1](https://cdn.trustedcomputinggroup.org/production/TPM_Rev_2_0_Part_3_Commands_01_38_f1ed38ee7e.pdf)، [فرع المصالحة 1616–1625](../../xuux-review-de099aa8/sim/tpm-ceremony/TpmCeremonyCore.cs#L1616).

**التصنيف:** منخفضة، وصف مضلل جديد في مسار دفتر Create المضاف؛ لا تسرب مورد مقيس من هذا النص وحده. [التقرير المستقل](current-create-proof/create-loss-proof.json)، [فرق إضافة التتبع](core-r3.diff).

### R3SOL-06 — اختبارات R3 تترك عمليات المحاكيات

بعد خروج مجموعة الاختبارات `0` كان هناك21 عملية swtpm حية، PID من `25298` إلى `25818` في السجل المرفق، وكلها تحمل مسارات `/tmp/xuux-wl413r3-*`؛ دالة `stopSim` في الاختبار الجديد تحذف مجلد الحالة فقط ولا ترسل إشارة إلى PID، بخلاف دالة R2 التي ترسل SIGTERM. [العمليات وأوقات بدئها](test-owned-process-metadata.txt)، [مقتطف stopSim](test-stop-excerpt.txt)، [اختبار R3:61–63](../../xuux-review-de099aa8/tests/sim/tpm-ceremony-wl413-r3.test.mjs#L61)، [اختبار R2:63–65](../../xuux-review-de099aa8/tests/sim/tpm-ceremony-wl413-r2.test.mjs#L63).

أوقفت العمليات21 المحددة، بعد مطابقة كل PID مع بادئة أمر الاختبار، وحفظت نتيجة كل إشارة؛ لم يبق في الفحص اللاحق أي سطر مطابق لهذه العمليات أو محاكياتي. [سجل الإيقاف](test-daemon-shutdown.txt)، [الفحص بعده](after-daemon-shutdown.txt)، [الفحص الأخير](final-audit-v2.txt).

**التصنيف:** منخفضة، تسرب عمليات في ملف اختبارات مضاف في R3؛ قد يؤثر في موارد التشغيل اللاحق، لكنني لم أقس استنفاد موارد أو تصادم منافذ بسبب تشغيل متكرر للحزمة. [فرق إضافة ملف الاختبار](../../xuux-review-de099aa8/tests/sim/tpm-ceremony-wl413-r3.test.mjs)، [العمليات المرصودة](test-owned-process-metadata.txt).

### ما تقيسه الاختبارات وما لا تقيسه

توقعات R3-03 الأربعة تستهدف أول رد password بقيم 1 بايت أوHMAC غير فارغ أوسمات `ff/00`؛ لا تستهدف قبول ملف السياسة في ذلك الرد ولا البت3، وأمثلة بيانات الإنشاء تكتفي ببايت واحد، ومسبار تذكرة السياسة يختار65 بايتاً لا تذكرة NULL ذات digest من بايت واحد. [اختبارات R3:119–172 و272–322](../../xuux-review-de099aa8/tests/sim/tpm-ceremony-wl413-r3.test.mjs#L119)، [حاقن الاختبار:290–387](../../xuux-review-de099aa8/tests/helpers/TpmCeremonyFaultTransport.cs#L290).

لذلك تتسق حقول TAP البالغة62 مع قبول الحالات الأخرى في مسابري؛ ولا يحتوي ملف الاختبارات الجديد على نظير لتجربتي الملف التنفيذي ومنفذ التحكم، اللتين شغّلتهما منفصلتين. [TAP](test-suite.tap)، [قبول الحالات الأخرى](current-v2-summary.json)، [فحص الملف التنفيذي](context/fake-exe.json)، [فحص التحكم](context/broad-control.json)، [ملف الاختبارات الجديد](../../xuux-review-de099aa8/tests/sim/tpm-ceremony-wl413-r3.test.mjs).

## 5. الوثائق وحدود أي طلب لاحق لـS1

### R3SOL-07 — عبارات قديمة باقية وعبارات R3 أوسع من القياس

README، فقرة النتيجة المجهولة، ما زالت تقول إن ملكية NV تثبت بمطابقة المنطقة العامة، وتكرر الفكرة في فقرة الحدود؛ والفقرة اللاحقة عن قرار R3 تقول العكس بعد فقد الرد، كما يحتفظ THREAT_MODEL بعبارة إثبات الملكية بالمطابقة في فقرته السابقة. [مقتطف README](readme-excerpt.txt)، [README، فقرة الحدود](../../xuux-review-de099aa8/sim/tpm-ceremony/README.md#L87)، [مقتطف نموذج التهديد](threat-model-excerpt.txt).

ADR §12.5 وسجل WL-414 يصفان سياسة الرد بـnonce=32 وattrs=0 وكل مخالفة باسم محدد، لكن الفاحص الفعلي يقبل16..64 وملف password بديلاً؛ ووصف فحص بيانات الإنشاء والتذاكر والأسماء لا يبين الحالات المقبولة أعلاه. [ADR §12.5](../../xuux-review-de099aa8/docs/adr/0007-tpm-nv-counter-freshness-anchor-design.md#L486)، [سجل WL-414](../../xuux-review-de099aa8/docs/roadmap/05-work-log.md#L11)، [الفاحص 498–506](../../xuux-review-de099aa8/sim/tpm-ceremony/TpmCeremonyCore.cs#L498)، [الأمثلة المقيسة](current-v2-summary.json).

**التصنيف:** منخفضة في الوصف، متصلة بنتائج التحليل لا باختبار عتاد؛ عبارات الفصل بين المحاكي والعتاد وبقاء `R3-A-01/EXT-6` في الوثائق لا تعارض حدود هذه التجارب، أما تعميم «أي تشويه» و«كل مخالفة» فتعارضه أمثلة محددة مسجلة. [README](../../xuux-review-de099aa8/sim/tpm-ceremony/README.md)، [ADR §12.5–12.6](../../xuux-review-de099aa8/docs/adr/0007-tpm-nv-counter-freshness-anchor-design.md#L473)، [الأمثلة](current-v2-summary.json).

### نقاط تبقى خارج القياس الحالي قبل عرض طلب إذن S1

1. فصل نتيجة الأمثلة القديمة عن الفجوات المقيسة هنا: ربط ملفات التفويض بطلباتها، ورفض جرد التكرار والحدود المخالفة قبل بناء خط الأساس، وفحص حقول الإنشاء والتذاكر والأسماء التي قُبل تشويهها؛ إعادة هذه الحالات على SHA جديد هي ما يختبر تغير سلوكها، لا عداد الاختبارات وحده. [التفويض](current-v2/auth-pw-reserved3.json)، [الجرد والكائن السابق](current-v2/inventory-duplicate-alias.json)، [الحقول الداخلية](current-v2-summary.json).
2. تعريف ما يعنيه خط أساس جزئي، وما يعنيه `residualNv=[]` بعد ترك فهارس قديمة، وكيف يحتفظ المالك بسجلها أو يوقف إعادة التشغيل إلى حين قرار خاص بها؛ لم تختبر هذه الجولة استنفاد السعة، لكن زيادة0→3 ثم بقاء3 بعد تشغيل عادي مقيسة. [خط الأساس الجزئي](current-v2/baseline-transient-badclass.json)، [التراكم](accumulation-summary.json)، [الجرد بعد التشغيل العادي](accumulation/nv-after-normal.txt).
3. لا تتناول التجارب صلاحية تفويض هرم التخزين أو سماح/رفض Windows TBS للحساب المقصود أو السعة الحرة على SLB9670؛ كما أن رفض `0x80280400` هنا حقن اختباري، لا خرج TBS. [حدود ADR §12.2](../../xuux-review-de099aa8/docs/adr/0007-tpm-nv-counter-freshness-anchor-design.md#L413)، [حاقن الحجب](../../xuux-review-de099aa8/tests/helpers/TpmCeremonyFaultTransport.cs)، [الرفض المقيس](shipped/blocked-forever-undefine.json).
4. لم أقس ثبات عداد عند انقطاع الطاقة أو رتابته على شريحة أو أثر الحذف وإعادة التعريف هناك؛ ولا تعوض قراءات libtpms هذه الأسئلة، ولا تخص تجربة pcrDigest المعدلة تطبيق TPM ثانياً. [البروفة على المحاكي](rehearsal.json)، [حدود ADR §12.2](../../xuux-review-de099aa8/docs/adr/0007-tpm-nv-counter-freshness-anchor-design.md#L413)، [المسبر المعدل](current-extra/cd-empty-pcr-digest.json).
5. نص §12.6 يبقي أي مرحلة تغير حالة العتاد بانتظار إذن جديد صريح ومحدد؛ هذه المراجعة لم تنفذ S1 على الشريحة، ولم تنشئ مساراً عتادياً أو إذناً لـS3/S4/S5. [ADR §12.6](../../xuux-review-de099aa8/docs/adr/0007-tpm-nv-counter-freshness-anchor-design.md#L511)، [أوامر الجولة](run-independent.sh)، [أوامر السياق](context-and-accumulation.sh).

## سجل النتائج المختصر

| المعرف | الخطورة والنطاق | الموضع | أصل النتيجة في المقارنة |
|---|---|---|---|
| R3SOL-01 | عالية — تحرير كائن سابق في محاكٍ، مع حقنين | `ResponseSchema:743–770`، `NvHandles/HandleSet:1108–1174`، `AdoptHandle:1336–1343` | مقيسة على الرأس وعلى8b؛ رفض الفئة/الصفحة الفارغة لا يرفض التكرار. [رأس](current-v2/inventory-duplicate-alias.json)، [قديم](baseline-v2/inventory-duplicate-alias.json) |
| R3SOL-02 | متوسطة — قبول تفويض مخالف للطلب وبت محجوز | `Resp.Parse:498–506` | الأمثلة مقبولة على الرأس والقديم؛ التحقق المضاف جزئي. [رأس](current-v2-summary.json)، [قديم](baseline-v2-summary.json) |
| R3SOL-03 | متوسطة — قبول بنى داخلية/أسماء/تذاكر مشوهة | `CreationData:618–640`، `CreationTicket/AuthTicket:584–598`، `Check:690–741`، Load الآخر `1478–1485` | استمرار للصنف القديم، مع اختلاف نتائج التشويهات القصيرة المشحونة. [رأس](current-v2-summary.json)، [Create](current-extra/create-cd-missing.json)، [قديم](baseline-v2-summary.json) |
| R3SOL-04 | منخفضة — حقل جرد مقارن بعد خط أساس جزئي | `SnapshotBaseline:1178–1188`، `PostRunInventory:1655–1672` | مقيسة في مسار فشل تصير له قابلية وصول مع رفض فئة خاطئة أثناء الجرد الثاني. [التقرير](current-v2/baseline-transient-badclass.json) |
| R3SOL-05 | منخفضة — قبول بنية أضيق من قاعدة PCR الفارغ | `CreationData:622–635` | رفض جديد في R3 مقابل قبول8b؛ رد اصطناعي، لا تطبيق TPM ثانٍ. [رأس](current-extra/cd-empty-pcr-digest.json)، [قديم](baseline-extra/cd-empty-pcr-digest.json) |
| R3SOL-06 | منخفضة — 21 محاكياً باقياً بعد الاختبارات | `tpm-ceremony-wl413-r3.test.mjs:61–63` | ملف اختبار جديد؛ أوقفت العمليات المرصودة بعد التسجيل. [العمليات](test-owned-process-metadata.txt)، [إيقافها](test-daemon-shutdown.txt) |
| R3SOL-07 | منخفضة — عبارات ملكية وتعميم لا تطابق السلوك | README، THREAT_MODEL §7/11، ADR §12.5، WL-414 | قراءة وثائق مقابل قياسات الحالات. [README](readme-excerpt.txt)، [THREAT_MODEL](threat-model-excerpt.txt)، [القياسات](current-v2-summary.json) |
| R3SOL-08 | منخفضة — ترجيح عدم تنفيذ Create من غياب مقبض | `SendTracked(Create):1413–1414`، `ReconcileOne:1616–1625` | نص جديد في قيد Create؛ الغلاف سجل رداً فعلياً برمز0 قبل إسقاطه. [المسبر](current-create-proof/create-loss-proof.json) |

## الفحص الختامي

آخر فحص مسجل عند `2026-10-18T03:18:11Z` طبع SHA المطلوب، و`git-status-bytes=0` و`protected-diff-bytes=0`، ولم يعرض مستمعاً على5600/5601 أو عملية `swtpm/pwsh/mono/node` تخص مجلدي؛ وأوقفت أيضاً عمليات اختبارات R3 الـ21 المذكورة أعلاه دون لمس محاكي عضو آخر. [الفحص الأخير](final-audit-v2.txt)، [خرج git الفارغ](git-status.txt)، [فرق الحماية الفارغ](protected-files.diff)، [سجل إيقاف عمليات الاختبارات](test-daemon-shutdown.txt).
