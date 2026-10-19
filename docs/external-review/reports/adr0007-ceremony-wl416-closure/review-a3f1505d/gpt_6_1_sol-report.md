# تقرير مراجعة WL-418: gpt_6_1_sol (OPENAI)

- الكوميت المراجَع: `a3f1505daf2247b60f33a5f4d4ab24f35dd7af5d`؛ كان أول أمر منفّذ هو `git -C /home/user/workspace/xuux-review-a3f1505d rev-parse HEAD`، ورمز خروجه `0`. ([سجل الهوية والشجرتين](/tmp/council-wl418-gpt_6_1_sol/identity-and-tree.log))
- خط الأساس: `e23bd4314cf629846969f3685fb71e1681403c89` في `/tmp/wt-e23bd431`. ([سجل الهوية والشجرتين](/tmp/council-wl418-gpt_6_1_sol/identity-and-tree.log))
- زمن التشغيل (UTC): `2026-10-19T01:10:55Z` إلى `2026-10-19T01:16:55Z`. ([بداية التشغيل](/tmp/council-wl418-gpt_6_1_sol/identity-and-tree.log)، [نهاية التشغيل](/tmp/council-wl418-gpt_6_1_sol/final-tree-and-processes.log))
- نطاق السؤال: البنود الخمسة في `delegation-brief.md`.
- الأحكام بالترتيب: **holds / holds / open / holds / holds**.
- الملاحظات الجديدة: **critical: 0، high: 0، medium: 1، low: 0**.

المراجعة مستقلة للشيفرة والاختبارات والمسابير؛ لم أقرأ تقارير الأعضاء الآخرين، أو تقارير الجولات السابقة، أو `WL-416-final-report.md`، أو محتويات مجلد تجميع التقارير.

## البند 1: دورة حياة swtpm — holds

1. غياب PID لا يُختزل إلى نجاح: `terminateAttempt` يقرأ الملف، ويستكشف العمليات المرتبطة بمسار الحالة، ثم يعيد المسح؛ وجود هوية غير مقروءة أو زومبي غير محسومة يمنع `stopped=true`. ([tests/helpers/ceremony-swtpm.mjs:286–325](/home/user/workspace/xuux-review-a3f1505d/tests/helpers/ceremony-swtpm.mjs#L286-L325))
2. إثبات الهوية يجمع وسائط مفكوكة على الفواصل الصفرية مع مطابقة `--tpmstate` و`dir=<المسار>` كاملين؛ قناة Python تفتح pidfd أولًا، ثم تعيد قراءة الهوية، ثم ترسل عبر المقبضة، ولا تعود إلى إرسال إشارة غير صفرية برقم PID عند تعذّر القناة. ([ceremony-swtpm.mjs:30–37،65–70،84–158](/home/user/workspace/xuux-review-a3f1505d/tests/helpers/ceremony-swtpm.mjs#L30-L158))
3. `killSim` لا يعدّ PID غير صالح أو خطأ غير `ESRCH` دليل زوال؛ يعيد إثبات الهوية عند التصعيد، ويشترط اختفاء العملية قبل نجاحه. ([ceremony-swtpm.mjs:42–48،217–260](/home/user/workspace/xuux-review-a3f1505d/tests/helpers/ceremony-swtpm.mjs#L217-L260))
4. استثناءا `probe` و`afterSpawn` يمران إلى مسار الإنهاء؛ ويُلتقط استثناء `onAbandon` حتى لا يمنع الحذف المشروط بإثبات الزوال، بينما يمنع فشل الإنهاء الحذف والمحاولة التالية. ([ceremony-swtpm.mjs:378–444](/home/user/workspace/xuux-review-a3f1505d/tests/helpers/ceremony-swtpm.mjs#L378-L444))
5. شغّلت مجموعة WL-416 كاملة: **18 اختبارًا، 0 إخفاق، 0 تخطٍّ، رمز خروج 0**؛ وتشمل فقد PID، الاستثناءات، ترتيب الإنهاء قبل الحذف، فشل الإشارة المحقون، PID لعملية بريئة، الهوية غير المقروءة، تبدّل الهوية عند التصعيد، قناتي SIGTERM/SIGKILL، والزومبي. ([سجل اختبارات WL-416](/tmp/council-wl418-gpt_6_1_sol/wl416-tests.log))
6. أضفت مسبارًا مستقلًا يعطّل العثور على `python3` بعد الإطلاق، ويرفض أي إشارة غير صفرية عبر `process.kill`: النتيجة `stopped=false`، والمجلد محفوظ، والعملية المقصودة موجودة، وعدد محاولات الإشارة العددية `0`؛ وبعد إعادة البيئة أنهى المسار العادي العملية، ورمز خروج المسبار `0`. ([شيفرة المسبار](/tmp/council-wl418-gpt_6_1_sol/unavailable-channel.mjs)، [خرج المسبار](/tmp/council-wl418-gpt_6_1_sol/unavailable-channel.log))

أمر المجموعة، من شجرة الرأس:

```sh
flock /tmp/council-wl418-sim.lock env \
  XUUX_TPM_SIM=1 TPM2TOOLS_TCTI=swtpm:host=127.0.0.1,port=7600 \
  TMPDIR=/tmp/council-wl418-gpt_6_1_sol/tmp \
  node --experimental-loader /tmp/council-wl418-gpt_6_1_sol/ports-only-loader.mjs \
  --test tests/sim/tpm-ceremony-wl416.test.mjs
```

الـloader يغيّر في الذاكرة سطر توزيع المنفذ فقط إلى أزواج ضمن `7600–7699`؛ لا يغيّر منطق الإنهاء أو ملفات الشجرة. ([ports-only-loader.mjs](/tmp/council-wl418-gpt_6_1_sol/ports-only-loader.mjs))

## البند 2: عمر ResponseContext وإعادة استخدام المقابض — holds

الإزالة مرتبطة بنجاح `FlushContext` في `Record`، وبغياب مثبت بجرد في فرعي `flush` و`policy-mutation` داخل `ReconcileOne`، وبنجاح الزيادة المفوّضة قبل `SessionConsumed`؛ فرع بقاء المقبض لا يمسح السياق. ([TpmCeremonyCore.cs:611–635](/home/user/workspace/xuux-review-a3f1505d/sim/tpm-ceremony/TpmCeremonyCore.cs#L611-L635)، [1673،1787–1788](/home/user/workspace/xuux-review-a3f1505d/sim/tpm-ceremony/TpmCeremonyCore.cs#L1673-L1788)، [1931–1983](/home/user/workspace/xuux-review-a3f1505d/sim/tpm-ceremony/TpmCeremonyCore.cs#L1931-L1983))

التسجيل الجديد للكائن يستبدل الاسم والاسم المؤهل والهرمية ويزيل نوع الجلسة، وتسجيل الجلسة يزيل خرائط الكائن؛ والسياق المفقود لا يفتح قبولًا افتراضيًا لفحوص الأصل أو تذكرة السياسة التي تحتاج السياق. ([TpmCeremonyCore.cs:580–622](/home/user/workspace/xuux-review-a3f1505d/sim/tpm-ceremony/TpmCeremonyCore.cs#L580-L622)، [741–770](/home/user/workspace/xuux-review-a3f1505d/sim/tpm-ceremony/TpmCeremonyCore.cs#L741-L770)، [839–851](/home/user/workspace/xuux-review-a3f1505d/sim/tpm-ceremony/TpmCeremonyCore.cs#L839-L851))

شغّلت `probes/run.sh` نفسه على النواتين، دون تعديلهما أو تعديل المسبار؛ أعدت توجيه قالب `mktemp` الصريح فقط بواسطة shim في `PATH` إلى مجلدي المسموح، واستُخدم القفل والمتغير `XUUX_TPM_SIM=1` في التشغيلين، برمز خروج `0` لكل منهما. ([run.sh:4–16](/home/user/workspace/xuux-review-a3f1505d/docs/external-review/reports/adr0007-ceremony-wl416-closure/probes/run.sh#L4-L16)، [shim](/tmp/council-wl418-gpt_6_1_sol/bin/mktemp)، [خرج الأساس](/tmp/council-wl418-gpt_6_1_sol/probe-baseline.log)، [خرج الرأس](/tmp/council-wl418-gpt_6_1_sol/probe-head.log))

```sh
# شُغّلا تسلسليًا داخل flock، مع TMPDIR وPATH المذكورين:
bash docs/external-review/reports/adr0007-ceremony-wl416-closure/probes/run.sh \
  /tmp/wt-e23bd431/sim/tpm-ceremony/TpmCeremonyCore.cs 7600
bash docs/external-review/reports/adr0007-ceremony-wl416-closure/probes/run.sh \
  /home/user/workspace/xuux-review-a3f1505d/sim/tpm-ceremony/TpmCeremonyCore.cs 7602
```

| حالة المسبار | e23bd431 | الرأس |
|---|---|---|
| إعادة استخدام بهوية B مسجلة | ACCEPT | ACCEPT |
| إعادة استخدام بهوية B غير مسجلة | رفض `RESPONSE_CREATION_DATA_MALFORMED` | رفض `RESPONSE_CREATION_PARENT_UNKNOWN` |
| إعادة استخدام بالهوية A نفسها غير مسجلة | ACCEPT بسياق قديم | رفض `RESPONSE_CREATION_PARENT_UNKNOWN` |
| رد مشوّه مع إعادة استخدام مسجلة | رفض `RESPONSE_CREATION_DATA_MALFORMED` | الرفض نفسه |

هذه نتائج فعلية مع `sameNumber=True` وغياب المقبض بالجرد في كل الحالات، ومع عدم بقاء عملية مرتبطة بمسار المحاكي بعد كل تشغيل. ([خرج الأساس](/tmp/council-wl418-gpt_6_1_sol/probe-baseline.log)، [خرج الرأس](/tmp/council-wl418-gpt_6_1_sol/probe-head.log))

**تقييم الادعاء البنيوي:** في مسار إعادة الاستخدام المسجّلة الذي يمارسه هذا الكود، لا يوجد انتقال «رفض على القديمة ثم قبول على الجديدة» في هذا المسبار؛ فـ`Put` كان أصلًا يستبدل الهوية، وتسجيل رد الإنشاء الجديد يسبق استعمالها، ولذلك يقبل الطرفان الحالة الصحيحة المسجّلة. ([TpmCeremonyCore.cs:585–600،620–622](/home/user/workspace/xuux-review-a3f1505d/sim/tpm-ceremony/TpmCeremonyCore.cs#L585-L622)، [Send:1208–1211](/home/user/workspace/xuux-review-a3f1505d/sim/tpm-ceremony/TpmCeremonyCore.cs#L1208-L1211)، [خرجا المقارنة](/tmp/council-wl418-gpt_6_1_sol/probe-head.log))

الأثر المثبت للإصلاح هو منع إرث السياق غير المسجل وتسميته «أصل غير معروف»، لا تحويل رد صحيح مرفوض إلى مقبول؛ واختبار `CTX2` يقيس الإزالة والحفظ من خرائط السياق في مسار المصالحة الحقيقي، لا من مجرد مجاورة نداء في النص. ([tests/sim/tpm-ceremony-wl416.test.mjs:373–409](/home/user/workspace/xuux-review-a3f1505d/tests/sim/tpm-ceremony-wl416.test.mjs#L373-L409)، [سجل WL-416](/tmp/council-wl418-gpt_6_1_sol/wl416-tests.log))

## البند 3: حاجز NV قبل كل أمر مغيّر — open

الحاجز نفسه محافظ على الفهارس التي يراها: عتبة التوقف فهرس واحد غير مسجل في `_definedByRun` ضمن `0x01800000–0x01BFFFFF`، مع تسجيل قائمة الفهارس؛ لكنه يُستدعى فقط بعد خط الأساس وداخل `PickVacantHandle`، وليس قبل كل إرسال مغيّر للحالة. ([TpmCeremonyCore.cs:1472–1503](/home/user/workspace/xuux-review-a3f1505d/sim/tpm-ceremony/TpmCeremonyCore.cs#L1472-L1503)، [Send:1194–1211](/home/user/workspace/xuux-review-a3f1505d/sim/tpm-ceremony/TpmCeremonyCore.cs#L1194-L1211)، [Run:2076–2082](/home/user/workspace/xuux-review-a3f1505d/sim/tpm-ceremony/TpmCeremonyCore.cs#L2076-L2082))

اختبارات `NV1/NV2/NV3` اكتملت دون إخفاق، لكنها تزرع الفهرس قبل بدء التغييرات أو قبل حاجز التعريف؛ لا تغطي ظهوره بين أمرين مغيّرين بعد تجاوز ذلك الحاجز. ([تعريف الاختبارات:432–473،598–613](/home/user/workspace/xuux-review-a3f1505d/tests/sim/tpm-ceremony-wl416.test.mjs#L432-L613)، [أوضاع الحقن:694–710](/home/user/workspace/xuux-review-a3f1505d/tests/helpers/TpmCeremonyFaultTransport.cs#L694-L710)، [سجل WL-416](/tmp/council-wl418-gpt_6_1_sol/wl416-tests.log))

المسبار المستقل أثبت حالتين بعد زرع فهرس حقيقي `0x01807777` عبر النقل الداخلي، بلا تزوير صفحات الجرد: في S1 استمرت زيادتان ثم حذف الفهرس الخاص بالبروفة قبل توقف الحاجز عند التعريف التالي، وفي S2 استمرت الإنشاءات والجلسة والسياسة والتحرير حتى الجرد النهائي دون استدعاء الحاجز مجددًا؛ بقي الفهرس الأجنبي موجودًا في الحالتين. ([LateNvProbe.cs:23–54](/tmp/council-wl418-gpt_6_1_sol/LateNvProbe.cs#L23-L54)، [نتيجة S1](/tmp/council-wl418-gpt_6_1_sol/late-nv-after-define.log)، [نتيجة S2](/tmp/council-wl418-gpt_6_1_sol/late-nv-after-primary.log))

إذن الادعاء الأضيق «حاجز قبل أول تغيير وقبل كل تعريف» قائم، أما نص التكليف «يسبق كل أمر مغيّر» فغير قائم؛ التفاصيل وإعادة الإنتاج في `WL418-gpt_6_1_sol-01` أدناه.

## البند 4: more=0 وحدود M0 — holds

وضع `inventory-more0-hide` ينشئ فعليًا الفهرس `0x01000001` خارج مجال المالك، ويحذف هذا الفهرس وحده من ردود جرد NV، ويُبقي قيمة `more` وبقية المقابض كما جاءت من المحاكي؛ لا يستبدل الرد كله بجرد فارغ مفترض. ([TpmCeremonyFaultTransport.cs:117–125](/home/user/workspace/xuux-review-a3f1505d/tests/helpers/TpmCeremonyFaultTransport.cs#L117-L125)، [672–691](/home/user/workspace/xuux-review-a3f1505d/tests/helpers/TpmCeremonyFaultTransport.cs#L672-L691))

الاختبار يثبت معًا `COMPLETE`، وتفعيل إعادة كتابة الرد، وبقاء الفهرس في جرد مباشر غير ملفوف بالنقل المحرّف؛ وقد اكتمل M0 دون إخفاق ضمن المجموعة ذات رمز الخروج `0`. ([wl416.test.mjs:412–427](/home/user/workspace/xuux-review-a3f1505d/tests/sim/tpm-ceremony-wl416.test.mjs#L412-L427)، [الجرد المباشر في harness:94–112](/home/user/workspace/xuux-review-a3f1505d/tests/helpers/tpm-ceremony-harness.ps1#L94-L112)، [سجل WL-416](/tmp/council-wl418-gpt_6_1_sol/wl416-tests.log))

الحكم محدود بقرار المالك: `more=0` نهاية الجرد وفق عقد الرد، **لا برهان خلو** ولا إثبات مقاومة محاكٍ يكذب، ولا يثبت M0 وحده حماية مجال المالك لأن الفهرس المحجوب في تجربته خارجه؛ وفحوص البنية و`more=1/count=0` والترتيب والعدد لم تُخفف في الفرق. ([NvHandles:1380–1410](/home/user/workspace/xuux-review-a3f1505d/sim/tpm-ceremony/TpmCeremonyCore.cs#L1380-L1410)، [ResponseSchema:977–1025](/home/user/workspace/xuux-review-a3f1505d/sim/tpm-ceremony/TpmCeremonyCore.cs#L977-L1025)، [فرق النطاق](/tmp/council-wl418-gpt_6_1_sol/scope.diff))

## البند 5: عدم إضعاف الفشل المغلق وعدم حذف فهرس غير مثبت الملكية في الفرق — holds

قرأت فرق `git diff e23bd431 HEAD -- sim tests scripts`؛ الملفات المتغيرة سبعة، ولا تغيير ضمن `scripts`، ولا حذف لفحوص الردود أو مسار التفويض أو شروط ملكية NV في النواة. ([قائمة الملفات](/tmp/council-wl418-gpt_6_1_sol/identity-and-tree.log)، [فرق النطاق كاملًا](/tmp/council-wl418-gpt_6_1_sol/scope.diff))

حذف NV ما زال مشروطًا بقيد تعريف ناجح في `_definedByRun` ومطابقة المنطقة العامة، ورد التعريف المفقود لا يُحوَّل إلى ملكية حتى عند تطابق المنطقة العامة؛ والحاجز الجديد لا يتبنّى فهرسًا مجهولًا للتنظيف. ([TpmCeremonyCore.cs:1561–1572](/home/user/workspace/xuux-review-a3f1505d/sim/tpm-ceremony/TpmCeremonyCore.cs#L1561-L1572)، [1603–1616](/home/user/workspace/xuux-review-a3f1505d/sim/tpm-ceremony/TpmCeremonyCore.cs#L1603-L1616)، [1864–1895](/home/user/workspace/xuux-review-a3f1505d/sim/tpm-ceremony/TpmCeremonyCore.cs#L1864-L1895))

لم أستنتج سلامة عامة من اكتمال الاختبارات: ملاحظة الحاجز في البند 3 باقية، لكنها نقص في شمول القيد الجديد لا تخفيف لحاجز كان موجودًا في الأساس، ولم تُنتج حذفًا للفهرس الأجنبي أو نتيجة نهائية `COMPLETE` في مسباري. ([فرق النواة](/tmp/council-wl418-gpt_6_1_sol/scope.diff)، [نتيجة S1](/tmp/council-wl418-gpt_6_1_sol/late-nv-after-define.log)، [نتيجة S2](/tmp/council-wl418-gpt_6_1_sol/late-nv-after-primary.log))

شغّلت اختبارات `guard` و`remediation` و`wl413-r2` و`wl413-r3` و`wl414-fup` تسلسليًا على الرأس: **89 اختبارًا، 0 إخفاق، 0 تخطٍّ، رمز خروج 0**؛ مع مجموعة WL-416 يكون المجموع **107 اختبارات** دون إخفاق أو تخطٍّ. ([سجل اختبارات الانحدار](/tmp/council-wl418-gpt_6_1_sol/regression-tests.log)، [سجل WL-416](/tmp/council-wl418-gpt_6_1_sol/wl416-tests.log))

```sh
flock /tmp/council-wl418-sim.lock env \
  XUUX_TPM_SIM=1 TPM2TOOLS_TCTI=swtpm:host=127.0.0.1,port=7600 \
  TMPDIR=/tmp/council-wl418-gpt_6_1_sol/tmp \
  node --experimental-loader /tmp/council-wl418-gpt_6_1_sol/ports-only-loader.mjs \
  --test --test-concurrency=1 \
  tests/sim/tpm-ceremony-guard.test.mjs \
  tests/sim/tpm-ceremony-remediation.test.mjs \
  tests/sim/tpm-ceremony-wl413-r2.test.mjs \
  tests/sim/tpm-ceremony-wl413-r3.test.mjs \
  tests/sim/tpm-ceremony-wl414-fup.test.mjs
```

## ملاحظات جديدة

### WL418-gpt_6_1_sol-01 — medium — حاجز ملكية مجال NV لا يحرس التغييرات التالية بعد ظهوره المتأخر

- **الموضع:** استدعاءا الحاجز في `Run:2079` و`PickVacantHandle:1502` فقط؛ الإرسال في `Send:1206` لا يفرضه، وكذلك `Increment:1578–1581` ومسار S2 في `1731–1768`. ([TpmCeremonyCore.cs:1194–1211](/home/user/workspace/xuux-review-a3f1505d/sim/tpm-ceremony/TpmCeremonyCore.cs#L1194-L1211)، [1499–1503](/home/user/workspace/xuux-review-a3f1505d/sim/tpm-ceremony/TpmCeremonyCore.cs#L1499-L1503)، [1578–1581](/home/user/workspace/xuux-review-a3f1505d/sim/tpm-ceremony/TpmCeremonyCore.cs#L1578-L1581)، [1731–1768](/home/user/workspace/xuux-review-a3f1505d/sim/tpm-ceremony/TpmCeremonyCore.cs#L1731-L1768)، [2076–2082](/home/user/workspace/xuux-review-a3f1505d/sim/tpm-ceremony/TpmCeremonyCore.cs#L2076-L2082))
- **الشرط:** طرف آخر يعرّف فهرسًا داخل مجال المالك بعد تجاوز الحاجز الأول وقبل أمر مغيّر لاحق؛ المسبار يزرعه بعد رد نجاح حقيقي للتعريف الأول في S1 أو `CreatePrimary` في S2، دون إخفائه عن أي جرد. ([LateNvProbe.cs:23–38](/tmp/council-wl418-gpt_6_1_sol/LateNvProbe.cs#L23-L38))
- **الأثر المقاس:** بعد الزرع في S1 وصلت `0x134,0x134,0x122` إلى المحاكي؛ توقف الحاجز عند محاولة التعريف التالية، ومع ذلك حمل نص الفشل عبارة «halted before any state-changing command» غير المطابقة لتسلسل هذه التجربة. ([خرج S1](/tmp/council-wl418-gpt_6_1_sol/late-nv-after-define.log))
- **الشاهد الثاني:** بعد الزرع في S2 وصلت `Create, Load, StartAuthSession, PolicySigned, PolicyCommandCode` وثلاث عمليات `FlushContext`، ثم خُفضت النتيجة إلى `FAILED_CLOSED` بالجرد النهائي فقط، مع `failure:null` وبقية NV معلنة. ([خرج S2](/tmp/council-wl418-gpt_6_1_sol/late-nv-after-primary.log))
- **حد الخطورة:** لم يحذف المسبار الفهرس الأجنبي، ولم يحصل على اكتمال نهائي كاذب؛ التصنيف medium لأن سياسة التوقف الوقائي المطلوبة تُطبق متأخرة أو لا تُستدعى مجددًا، لا لأن حذفًا غير مأذون أو تجاوزًا نهائيًا للفشل المغلق قد أُثبت. ([خرجا S1](/tmp/council-wl418-gpt_6_1_sol/late-nv-after-define.log)، [S2](/tmp/council-wl418-gpt_6_1_sol/late-nv-after-primary.log))
- **اتجاه المعالجة:** فرض سياسة الحاجز عند بوابة إرسال الأوامر المغيّرة، مع منع التكرار الدائري لأوامر الجرد، وتحديد أي استثناء لتنظيف الموارد المثبتة بقرار صريح؛ وإضافة اختبارات زرع بين التغييرات، لا قبل التعريف وحده.

**إعادة الإنتاج:** ملفا المسبار مستقلان خارج الشجرة، وأمر التشغيل التالي أعاد الحالتين برمز `0`، مستخدمًا المنفذين `7610/7611` ثم `7612/7613`، والنواة الأصلية غير المعدلة. ([LateNvProbe.cs](/tmp/council-wl418-gpt_6_1_sol/LateNvProbe.cs)، [run-late-nv.sh](/tmp/council-wl418-gpt_6_1_sol/run-late-nv.sh)، [سجل S1](/tmp/council-wl418-gpt_6_1_sol/late-nv-after-define.log)، [سجل S2](/tmp/council-wl418-gpt_6_1_sol/late-nv-after-primary.log))

```sh
flock /tmp/council-wl418-sim.lock env \
  XUUX_TPM_SIM=1 TPM2TOOLS_TCTI=swtpm:host=127.0.0.1,port=7610 \
  TMPDIR=/tmp/council-wl418-gpt_6_1_sol/tmp \
  bash /tmp/council-wl418-gpt_6_1_sol/run-late-nv.sh
```

## حدود

- لا TPM حقيقي ولا وصول إلى `/dev/tpm*` أو TBS؛ كل التنفيذ الفعلي استهدف swtpm، والتقييم لا يمتد إلى العتاد.
- لم أشغّل `scripts/tpm-sim-ci.sh` أو جميع اختبارات `tests/sim/`؛ شغّلت الملفات الستة المذكورة والمسبار المقارن والحالتين المستقلتين ومسبار تعذّر قناة الإشارة. ([سجل WL-416](/tmp/council-wl418-gpt_6_1_sol/wl416-tests.log)، [سجل الانحدار](/tmp/council-wl418-gpt_6_1_sol/regression-tests.log)، [مسبار الأساس](/tmp/council-wl418-gpt_6_1_sol/probe-baseline.log)، [مسبار الرأس](/tmp/council-wl418-gpt_6_1_sol/probe-head.log)، [مسبار القناة](/tmp/council-wl418-gpt_6_1_sol/unavailable-channel.log))
- لم أشغّل ملف WL-416 على الأساس لأنه يستورد واجهات أضيفت بعده؛ المقارنة بين النسختين اقتصرت على `CtxRegressionProbe.cs` المتوافق معهما، وبقي اختبار `CTX2` اختبارًا لمسار الرأس. ([واردات wl416.test.mjs:26–33](/home/user/workspace/xuux-review-a3f1505d/tests/sim/tpm-ceremony-wl416.test.mjs#L26-L33)، [CtxRegressionProbe.cs:88–127](/home/user/workspace/xuux-review-a3f1505d/docs/external-review/reports/adr0007-ceremony-wl416-closure/probes/CtxRegressionProbe.cs#L88-L127))
- اختبارات الهوية عند التصعيد ورفض الإشارة تستخدم حقنًا مضبوطًا؛ لم أُجبر نظام التشغيل على إعادة استخدام PID حقيقي، ولم أختبر مسار syscall الخام على معماريات أخرى. ([wl416.test.mjs:564–578](/home/user/workspace/xuux-review-a3f1505d/tests/sim/tpm-ceremony-wl416.test.mjs#L564-L578)، [قناة pidfd:84–108](/home/user/workspace/xuux-review-a3f1505d/tests/helpers/ceremony-swtpm.mjs#L84-L108))
- مسح العمليات متحفظ على مستوى `/proc` كله: زومبي غير منسوبة أو عملية مستخدم مجهولة الهوية قد تمنع تنظيف محاولة حتى إن لم تكن تخصها؛ هذا حد توافر للفشل المغلق، وليس دليل قتل عملية أجنبية أو نجاح زائف. ([ceremony-swtpm.mjs:172–201،304–321](/home/user/workspace/xuux-review-a3f1505d/tests/helpers/ceremony-swtpm.mjs#L172-L321))
- لم أغيّر ملفات أي من الشجرتين، ولم أستعمل commit أو push أو `gh`؛ الحالة النهائية للشجرتين خالية من تغييرات العمل، والرأس بقي SHA المذكور، ولم تبق عملية محاكٍ تحمل مسار حالتي المؤقتة في نهاية التشغيل. ([فحص النهاية](/tmp/council-wl418-gpt_6_1_sol/final-tree-and-processes.log))
- تعديل المنفذ بالذاكرة وshim قالب `mktemp` قيدان معلنان للتشغيل ضمن تعليمات المنافذ والملفات المؤقتة، لا تعديلات على الشيفرة المراجَعة؛ الأدلة والمسابير باقية تحت `/tmp/council-wl418-gpt_6_1_sol/`. ([loader](/tmp/council-wl418-gpt_6_1_sol/ports-only-loader.mjs)، [shim](/tmp/council-wl418-gpt_6_1_sol/bin/mktemp))
