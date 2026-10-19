# تقرير مراجعة WL-420 (مركّزة على إصلاح WL-419): grok_4_7 (XAI)

- الكوميت المراجَع: df435a951486f124a5c75a337f17bd96924d7352
- زمن التشغيل (UTC): 2026-10-19T04:10:35Z إلى 2026-10-19T04:22:12Z
- نطاق السؤال: البنود الخمسة في حزمة التفويض مع تركيز بندي 1 و3 على إصلاحي WL-419

شجرة المراجعة `/tmp/wt-df435a95-grok`. أمر الهوية: `git -C /tmp/wt-df435a95-grok rev-parse HEAD` → `df435a951486f124a5c75a337f17bd96924d7352`. `git status --short` فارغ بعد القياس. لم يُعدَّل ملف متعقَّب، ولم يُنشأ commit، ولم يُدفع، ولم يُستعمل `gh`. لم يُمس `/dev/tpm*` ولا TBS. المحاكي `swtpm` وحده. لم يُقرأ تقرير عضو آخر.

فرق `git diff --stat a3f1505daf2247b60f33a5f4d4ab24f35dd7af5d df435a951486f124a5c75a337f17bd96924d7352 -- sim tests scripts`: خمسة ملفات، 135 إدراجًا و7 حذوف. لا تغيير تحت `scripts/`.

## البند 1: open

الادعاء المقاس: `startSim` لا يسلّم رقمًا إلا إن أثبت مسحٌ قرائيٌّ أنه المالك الحي لمسار الحالة (وإلا `pid-not-owner` ومسار الإنهاء الموحّد)، و`stopSim` ينهي كل مالك مثبت ولا يعلن التوقف ولا يحذف المجلد ما دام المسح يجد مالكًا. ويُعاد فحص أن الإصلاح لم يُضعف ضمانات سابقة (ESRCH وحده، إغلاق الفشل، حماية `finally`/المسار الموحّد).

الشيفرة على الرأس (`tests/helpers/ceremony-swtpm.mjs`):

- `startSim` بعد الجاهزية: `pid === null` → `no-pid`؛ وإلا إن `!scanStateDir(dir).matches.includes(pid)` → `pid-not-owner`؛ وإلا `return` (الأسطر 393–399). الفشل يسقط إلى مسار الإنهاء الموحّد (406–447): `terminateAttempt` ثم `onAbandon` ثم الحذف فقط إذا `stopped`.
- `stopSim` (454–471): `killSim(s.pid)` ثم `if (stopped !== true) return false` (456–457) قبل أي مسح. المسح وإنهاء المالكين لا يُنفَّذان إلا بعد أن يعيد `killSim` للرقم المسلَّم `true`. `killSim` يعيد `false` بلا إشارة إن كان الرقم حيًا وسطر أوامره لا يربطه بـ `swtpm` ومسار الحالة (223–225).
- `alive()` (42–48) لم يمسّه هذا الفرق: ESRCH وحده موت. `pidfdSignal` (140–159) بلا رجوع إلى `process.kill` لإشارة غير صفرية.

ما أُغلق من ملاحظة WL418-grok_4_7-01:

- على الرأس، اختبار الملف الرسمي: الأمر
  `XUUX_TPM_SIM=1 TPM2TOOLS_TCTI='swtpm:host=127.0.0.1,port=2321' node --test --test-concurrency=1 tests/sim/tpm-ceremony-wl416.test.mjs`
  من `/tmp/wt-df435a95-grok`. المخرج `/tmp/council-wl420-grok_4_7/logs/tests-df435a95.tap`. رمز الخروج 0. السطر الخام: `# tests 22` / `# fail 0` / `# duration_ms 95723.85366`. من بينها L1–L6 وR2-01 وR2-02 وCHANNEL وCHANNEL2 وZOMBIE وL7a وL7b بلا فشل. L7a يثبت رفض تسليم رقم لا يملك المسار. L7b يثبت أن رقمًا مسلَّمًا زائلًا لا يُعلن معه التوقف والمالك حي.
- مسبار الفجوة `/tmp/council-wl420-grok_4_7/probes/stopsim-gap.mjs`، الأمر `node /tmp/council-wl420-grok_4_7/probes/stopsim-gap.mjs`، المخرج `/tmp/council-wl420-grok_4_7/logs/stopsim-gap.log`، رمز الخروج 0:
  - الحالة B: الرقم المسلَّم 2147483002 زائل والمالك الحي 30430. `stopSim_return=true` و`ownersAfter=[]` و`dirExists=false` و`ownerAlive=false`. مسار النجاح الكاذب مع الحذف والمالك حي مغلق على هذا الاستدعاء.
  - الحالة C: `pid-not-owner` مع `injectKillFailure`. رُمي نص يحتوي `not proven stopped` و`refusing to retry or delete`، و`reason=pid-not-owner` و`stopped=false` و`dirExists=true` والمالك المُطلَق 30437 بقي حيًا حتى تنظيف المسبار نفسه بـ `killSim` الذي أعاد `true`. المسار الموحّد والإغلاق عند تعذّر إثبات الزوال لم يُضعفا.

ما يبقى مفتوحًا (WL420-grok_4_7-01، low):

- الحالة A في المسبار نفسه: الرقم المسلَّم عملية `sleep` حية لا تملك المسار، والمالك المثبت 30411. `stopSim_return=false` و`ownersAfter=[30411]` و`dirExists=true` و`ownerAlive=true`. لا إعلان توقف ولا حذف، لكن المالك المثبت لم يُنهَ. السبب: الرجوع المبكر في 456–457 قبل المسح. هذا ينقض جملة «ينهي كل مالك مثبت» في صيغتها المطلقة.
- ليس إعادةً لمسار النجاح الكاذب والحذف. `startSim` على الرأس لا يسلّم رقمًا غير مالك عند العودة. الوصول إلى الحالة A بعد تسليم صحيح يقتضي أن يصبح الرقم المسلَّم عملية حية غير مالكة بينما عملية أخرى ما زالت تملك المسار. لم يُقَس سباق إعادة استعمال الرقم بين المسح والإشارة.

الحكم **open** لأن العطف في البند لم يقم كاملًا، لا لأن مسار النجاح الكاذب على `a3f1505d` ما زال قائمًا على هذا الكوميت.

## البند 2: holds

الادعاء المقاس: سياق الاستجابة يُزال عند انتهاء عمر مثبت، ولا يُقبل رد سياق قديم، ولا يُرفض رد صحيح بلا اسم. وحكم جولة WL-418 «المعيار غير متحقق والسبب مقيس» صحيح على هذا الرأس. وحجة «رفض على القديم ثم قبول بعد الإصلاح مستحيل بهذه الشيفرة» تُفحص لا تُسلَّم.

المسبار غير موجود على شجرة `e23bd431` (محاولة أولى رمز 127: لا ملف). أُعيد تشغيل مسبار شجرة المراجعة على النواتين، وهو أداة القياس المأذون بها في الحزمة. بصمة المسبار `578ea4632f0699a9324639a0b68a77bb5b56721ed85bc094c4b10e78d2e7d54e`.

- خط الأساس: `bash /tmp/wt-df435a95-grok/docs/external-review/reports/adr0007-ceremony-wl416-closure/probes/run.sh /tmp/wt-e23bd431/sim/tpm-ceremony/TpmCeremonyCore.cs 7700`. المخرج `/tmp/council-wl420-grok_4_7/logs/probe-e23bd431-7700.log`. `probe_exit=0` و`swtpm_after_stop_with_dir=0` و`EXIT:0`. بصمة النواة `de076f9c73dce9a0c6f1916083d1281c8ffe7c6338cf63dc1ad040da177d15b4`. السطر: `EndOfLife absent`.
- الرأس: الأمر نفسه على `/tmp/wt-df435a95-grok/sim/tpm-ceremony/TpmCeremonyCore.cs` والمنفذ 7720. المخرج `/tmp/council-wl420-grok_4_7/logs/probe-df435a95-7720.log`. `probe_exit=0` و`swtpm_after_stop_with_dir=0` و`EXIT:0`. بصمة النواة `7a86b97a99a52c05e3d7712d93dbf3228ee7a965703350f157046a208f89e5e6`. السطر: `EndOfLife present`.

في الحالتين: المقبض أُعيد استعماله `0x80000000`، والتنظيف نُفّذ، والرد أُسقط، و`absentByInventory=True`.

| الحالة | e23bd431 | df435a95 |
| --- | --- | --- |
| recorded-reuse-new-identity | ACCEPT | ACCEPT |
| unrecorded-reuse-new-identity | REJECT `RESPONSE_CREATION_DATA_MALFORMED: Create parentName differs from known parent` | REJECT `RESPONSE_CREATION_PARENT_UNKNOWN: Create parent 0x80000000` |
| unrecorded-reuse-same-identity | ACCEPT | REJECT `RESPONSE_CREATION_PARENT_UNKNOWN` |
| invalid-response-recorded-reuse | REJECT parentName differs | REJECT parentName differs |

لا حالة رُفضت على القديم وقُبلت على الرأس. قبول الهوية القديمة نفسها بعد إعادة استعمال غير مسجّل قائم على خط الأساس وزائل على الرأس. الرد المسجّل الصحيح مقبول على الاثنين. الرد غير المسجّل الصحيح مرفوض على الرأس باسم `RESPONSE_CREATION_PARENT_UNKNOWN` (إغلاق مسمّى، لا قبول افتراضي). الرد غير المطابق مرفوض على الاثنين.

فرق `TpmCeremonyCore.cs` من `e23bd4314cf629846969f3685fb71e1681403c89` إلى الرأس في مسار السياق إزالات (`EndOfLife` عند 633، واستدعاؤها من `SessionConsumed` عند 1694 ومن `ReconcileOne` عند 1960 و1997) وقراءة `Knows`. `Check` و`Put` و`CreationData` لم تتغير في ما يخص القبول: القبول يشترط مدخلًا مطابقًا، والأب غير المعروف يرمي `RESPONSE_CREATION_PARENT_UNKNOWN` (843). الإزالة لا تفتح قبولًا كان مرفوضًا. لذلك «رفض ثم قبول لنفس تسلسل السجل» غير ممكن بهذه الشيفرة، والقياس لم يُظهر حالة كهذه.

حد: مسار `SessionConsumed` / جلسة السياسة لم يُسبَر مباشرة؛ الاستنتاج فيه بنيوي. البروفة تتوقف عند فقد رد التنظيف (`Send` يرمي) ولا تكمل قبولًا بعد ذلك.

حكم WL-418 «المعيار غير متحقق والسبب مقيس» قائم على هذا الكوميت: القبول القديم مقيس، وسببه غياب `EndOfLife` على خط الأساس ووجوده على الرأس. الحكم **holds**.

## البند 3: holds

الادعاء المقاس: بعد أول فحص بوابة ناجح يُعاد الفحص عند `Send` قبل كل أمر مغيّر، مع استثناء صريح لـ `FlushContext` و`NV_UndefineSpace`، ونص الفشل يسمي الأمر الذي أوقف قبله، ولا يُحذف فهرس بلا ملكية مثبتة، وقرار المالك لم يتغير (عتبة فهرس واحد، ولا حذف، و`more=0` حد موثّق لا يُزال).

الشيفرة على الرأس (`sim/tpm-ceremony/TpmCeremonyCore.cs`):

- `_nvGuardArmed` يُضبط `true` في نهاية أول فحص ناجح (1515)، وذلك من `Run()` قبل أي أمر مغيّر.
- `Send` (1208): إن كان الحارس مسلّحًا و`NvGuardedAtSend` يستدعي `AssertNvRangeOwnership(name)` قبل إضافة الخطوة وقبل الإرسال.
- `NvGuardedAtSend` (1201–1204): أوامر مغيّرة عدا `CC_FlushContext` و`CC_NV_UndefineSpace`.
- العتبة `UnresolvedNvStopThreshold = 1` (1483). لم تتغير.
- `UndefineOwn` (1625–1637): يرمي `REFUSE_UNDEFINE_NOT_CREATED_BY_RUN` إن لم يكن الفهرس في `_definedByRun`، ثم يطابق المنطقة العامة، ثم يرسل. المستدعي الوحيد لـ `NV_UndefineSpace`. `Flush` (1660–1664) يعود فورًا إن لم يكن المقبض في `_transients`.
- `more == 0 || n == 0` (1420 و1460) خارج فرق WL-419.

قياس الرأس، الأمر `bash /tmp/council-wl420-grok_4_7/probes/nv-failure-text.sh`، المخرج `/tmp/council-wl420-grok_4_7/logs/nv-failure-text.log`، رمز الخروج 0. المنافذ 7782–7792. كل محاكٍ `swtpm_left=0` والمجلد حُذف بعد ذلك.

- `nv-preseed-unattributable`: `FAILED_CLOSED`، النص `halted before any state-changing command`، `STATE_CHANGING=[]`، `nvAfter=["0x01807777"]`، `changes=0`، `stopThreshold=1`.
- `nv-appear-after-define`: النص يسمي `s1.probe:NV_Increment#1` ويقول إن أوامر مغيّرة أُرسلت. `STATE_CHANGING` = تعريف المسبار `0x12a` ثم تنظيف `NV_UndefineSpace` `0x122` لفهرس التشغيل `0x01ae1dc7` فقط. `NV_Increment` `0x134` لم يُرسل. `nvAfter=["0x01807777"]`. الاستثناء حرّر فهرسًا ملكيته مثبتة ولم يمس الفهرس الغريب.
- `nv-appear-after-primary`: النص يسمي `s2:Create(service-key,ECDSA-P256)`. `Create` `0x153` لم يُرسل. بعد `CreatePrimary` التنظيف `FlushContext` `0x165` فقط. `nvAfter=["0x01807777"]`. لا `Undefine` للفهرس الغريب.

قياس النواة القديمة (بصمة بادئة `e3651be9049db38e`) مع ناقل الأعطال الجديد، المخرج `/tmp/council-wl420-grok_4_7/logs/old-core-late-nv.log`:

- `nv-appear-after-define`: `STATE_CHANGING` يتضمن تعريفًا ثم `NV_Increment#1` و`NV_Increment#2` ثم `NV_UndefineSpace`، والنص ما زال `halted before any state-changing command`، و`nvAfter=["0x01807777"]`. الثقب الوظيفي قائم على `a3f1505d`: الأمران التاليان أُرسلا، والفهرس غير المنسوب لم يُحذف.
- `nv-appear-after-primary`: بعد الزرع أُرسل `Create` و`Load` و`StartAuthSession` و`PolicySigned` و`PolicyCommandCode` و`FlushContext`، والنص كاذب «قبل أي أمر مغيّر»، والفهرس الغريب بقي.

إذن إعادة الفحص عند `Send` توقف الأمر المغيّر التالي على الرأس، والاستثناء تحرير موارد ملكيتها مثبتة لا ثقب حذف، والعتبة 1، ولا حذف لفهرس غير منسوب في القياس. نص الفشل يسمي الأمر في مساري NV4/NV5. الحكم الوظيفي **holds**.

ملاحظة منفصلة لا تعيد فتح الثقب (WL420-grok_4_7-02، low): في `nv-appear-midrun` و`nv-appear-late` النص يقول `before the next state-changing command (s1.probe:NV_DefineSpace); state-changing commands were already sent in this run` بينما `STATE_CHANGING=[]` والفهرس `0x01807777` يبقى و`changes=1` و`baseline.nvHandles=0`. السبب: فرع النص عند 1509–1510 يُفعَّل بـ `_nvGuardArmed`، وهذا العلم يعني نجاح الفحص الأول لا إرسال أمر مغيّر. التوقف حاصل والفهرس لم يُحذف. اختبارا NV2/NV3 لا يفحصان هذه الجملة، فيمكن أن ينجحا والنص كاذب.

## البند 4: holds

الادعاء المقاس: اختبار `M0` ووضع `inventory-more0-hide` يثبتان ما يدّعيانه لا أكثر، وقرار المالك يبقى (إيقاف الجرد عند `more=0` حد موثّق لا يُزال في هذا الفرق).

الشيفرة: `more == 0 || n == 0` عند 1420 و1460 لم يدخلا فرق WL-419. الوضع في `tests/helpers/TpmCeremonyFaultTransport.cs` (672 وما يليها) يسقط الفهرس المزروع `0x01000001` (خارج مجال المالك) ويبقي بت `more`، ويضبط العدد على ما بقي. إن كان الفهرس المزروع وحده في الصفحة صار `more==0` و`n==0` معًا.

اختبار `M0` (الأسطر 412–427) يفحص اكتمال البروفة و`changes >= 1` وبقاء `0x01000001` في الجرد المباشر. لا يفصل بت `more` عن `n==0`.

قياس الوضع نفسه في `/tmp/council-wl420-grok_4_7/logs/nv-failure-text.log`: `status=COMPLETE` و`FAILURE=null` و`nvAfter` يتضمن `0x01000001` و`changes=40` و`baseline.nvHandles=0`. البروفة اكتملت والفهرس المحجوب بقي، وجرد البروفة لم يره. هذا حد العزل الذي وثّقه المنفّذ لملاحظة WL418-grok_4_7-02 ولم يغيّره هذا الفرق. لا أُعيد فتحها ملاحظة جديدة: القرار بقي للمالك، والاختبار لا يثبت أكثر مما تفحصه تأكيداته، وعنوان الاختبار أوسع من التأكيدات. الحكم **holds**.

## البند 5: holds

الادعاء المقاس: لا إضعاف للإغلاق عند الفشل، ولا حذف فهرس غير مثبت الملكية، وصحة الاختبارات، وحماية التراجع، في فرق `sim tests scripts` وملف WL-416 كاملًا. وادعاء التراجع نفسه: NV4/NV5/L7a/L7b تفشل على `a3f1505d` وتنجح على `df435a95`.

الفرق لا يمس `alive()` ولا قناة pidfd ولا عتبة الفهرس ولا `more==0` ولا مسار قبول السياق. الحالة C في مسبار الفجوة أبقت المجلد ولم تعلن توقفًا عند فشل الإنهاء. اختبارات L5a وR2-01 وZOMBIE وCHANNEL وCHANNEL2 على الرأس ضمن الـ22 بلا فشل (المخرج أعلاه، خروج 0). لا مسار مقيس حذف `0x01807777`.

ملف اختبار `a3f1505d` نفسه لا يحتوي NV4/NV5/L7a/L7b. إعادة الإنتاج لم تعدّل `/tmp/wt-a3f1505d` ولا شجرة المراجعة: نسخة صلبة `cp -al /tmp/wt-a3f1505d /tmp/council-wl420-grok_4_7/repro-a3f1505d` ثم استبدال ملفي الاختبار وناقل الأعطال بنسختي الرأس فقط. النواة بقيت القديمة (`cmp` مطابق، بادئة البصمة `e3651be9049db38e`).

الأمر من النسخة، بنفس بيئة الحزمة:
`XUUX_TPM_SIM=1 TPM2TOOLS_TCTI='swtpm:host=127.0.0.1,port=2321' node --test --test-concurrency=1 tests/sim/tpm-ceremony-wl416.test.mjs`
المخرج `/tmp/council-wl420-grok_4_7/logs/tests-a3f1505d-overlay.tap`. رمز الخروج 1. السطر الخام: `# tests 22` / `# pass 18` / `# fail 4` / `# duration_ms 96507.850983`. الفشل الأربعة وحدها:

- NV4 وNV5: التأكيد عند السطر 995 لم يطابق؛ النص الفعلي `halted before any state-changing command`. هذا فشل النص. إرسال الأوامر التالية على النواة القديمة مقيس في `/tmp/council-wl420-grok_4_7/logs/old-core-late-nv.log` لا في هذا التأكيد، لأنه توقف قبل التأكيدات اللاحقة.
- L7a: `a pid that does not own the state dir must not be handed over` (التسليم حدث بدل الرمي). هذا التشغيل خلّف محاكيًا يتيمًا `pid=1898` على `/tmp/xuux-wl418-l7a-B8Llc2` لأن الاختبار لا ينظّف إن عاد `startSim` بدل أن يرمي. أُنهى لاحقًا بـ `killSim` من مساعد الرأس بعد إثبات الملكية (`kill 1898 true`، ثم `owners=[]`، ثم حذف المجلد).
- L7b: `a stop claim requires the state-dir owner to be gone`، والقيمة الفعلية `[1901]`. الاختبار ينظّف بالرقم الحقيقي بعد القياس؛ لم يبقَ محاكٍ. قيمة إرجاع `stopSim` القديمة ليست في هذا المخرج لأن التأكيد على بقاء المالك سقط أولًا.

قياس إرجاع المساعد القديم مباشرة، المخرج `/tmp/council-wl420-grok_4_7/logs/old-stopsim-gap.log`، رمز الخروج 0: `{"handed":2588,"before":[2588],"stopSim_return":true,"after":[2588],"dirExists":false}`. على `a3f1505d` أعاد `stopSim` قيمة النجاح وحذف المجلد والمالك 2588 حي. على الرأس الحالة B تغلق هذا المسار.

على الرأس الاختبارات الأربعة ضمن `# fail 0` وخروج 0. ادعاء التراجع قائم بالأعداد ورموز الخروج: 4 فشل وخروج 1 على شيفرة `a3f1505d` مع الاختبارات الجديدة، و0 فشل وخروج 0 على `df435a95`. الحكم **holds**.

## تحقق ادعاء التراجع (NV4/NV5/L7a/L7b على a3f1505d مقابل df435a95): الأعداد ورموز الخروج

| الشجرة | الأمر | المخرج | العدد الخام | الخروج |
| --- | --- | --- | --- | --- |
| نسخة `a3f1505d` مع ملفي الاختبار وناقل الأعطال من الرأس، والنواة والمساعد القديمان | أمر الحزمة أعلاه من `/tmp/council-wl420-grok_4_7/repro-a3f1505d` | `/tmp/council-wl420-grok_4_7/logs/tests-a3f1505d-overlay.tap` | `# tests 22` / `# pass 18` / `# fail 4` | 1 |
| `/tmp/wt-df435a95-grok` عند `df435a951486f124a5c75a337f17bd96924d7352` | الأمر نفسه | `/tmp/council-wl420-grok_4_7/logs/tests-df435a95.tap` | `# tests 22` / `# pass 22` / `# fail 0` | 0 |

الفشل الأربعة على النسخة القديمة هي NV4 وNV5 وL7a وL7b فقط. على الرأس الأربعة بلا فشل. قياس النواة القديمة المنفصل (`old-core-late-nv.log`) يبيّن أن فشل NV4/NV5 في الاختبار فشل نص، وأن الأوامر المغيّرة التالية أُرسلت فعلًا على `a3f1505d` ولم تُرسل على الرأس (`nv-failure-text.log`). قياس المساعد القديم (`old-stopsim-gap.log`) يبيّن نجاحًا كاذبًا مع حذف والمالك حي؛ الرأس يغلق هذا الاستدعاء (الحالة B) ويبقي فجوة الحالة A.

## ملاحظات جديدة (WL420-<model>-NN)

### WL420-grok_4_7-01

- الخطورة: low
- البند: 1 (ولهذا البند **open**)
- المكان: `tests/helpers/ceremony-swtpm.mjs:454-457`
- الوصف: إن أعاد `killSim` للرقم المسلَّم قيمة غير `true` (رقم حي لا يملك المسار، أو هوية غير مقروءة)، يرجع `stopSim` فورًا ولا يمسح المالكين المثبتين ولا ينهيهم. لا يعلن توقفًا ولا يحذف. هذا ليس إعادة لمسار النجاح الكاذب والحذف على `a3f1505d`.
- إعادة الإنتاج: `node /tmp/council-wl420-grok_4_7/probes/stopsim-gap.mjs` الحالة A. المخرج `/tmp/council-wl420-grok_4_7/logs/stopsim-gap.log`، خروج 0: `A stopSim_return=false ownersAfter=[30411] dirExists=true ownerAlive=true`.

### WL420-grok_4_7-02

- الخطورة: low
- البند: 3 يبقى **holds**؛ الملاحظة على جملة النص لا على التوقف أو الحذف
- المكان: `sim/tpm-ceremony/TpmCeremonyCore.cs:1509-1511` مع ضبط `_nvGuardArmed` عند 1515
- الوصف: بعد تسليح الحارس وقبل أي أمر مغيّر، نص الفشل يقول `state-changing commands were already sent in this run` بينما `STATE_CHANGING` فارغ. التوقف حاصل والفهرس غير المنسوب يبقى.
- إعادة الإنتاج: `bash /tmp/council-wl420-grok_4_7/probes/nv-failure-text.sh` الوضعان `nv-appear-midrun` و`nv-appear-late`. المخرج `/tmp/council-wl420-grok_4_7/logs/nv-failure-text.log`، خروج 0. المنفذان 7784 و7786.

## حدود

- لم يُشغَّل `scripts/tpm-sim-ci.sh` (محاكيه المشترك ممنوع في الحزمة).
- لم يُلمس `/dev/tpm*` ولا TBS. `pgrep -af swtpm` في نهاية المراجعة: لا عملية.
- لم يُقرأ تقرير عضو آخر ولا تقارير `review-a3f1505d/`. قُرئ ادعاء المنفّذ في سجل العمل وREADME الإغلاق ليُقاس لا ليُقبل.
- لم يُكسب سباق إعادة استعمال الرقم بين المسح والإشارة. الحالة A استدعاء مُركَّب لا سباق مكسوب. المنفّذ أعلن هذا السباق غير مقيس؛ القياس هنا لا يغلقه.
- `stopSim` لا يفحص `unresolved` ولا `zombies` كما يفعل `terminateAttempt` (305–321). هذا التباين سابق لهذا الفرق ولم يُضعف. لم يُسبَر زومبي خاص بـ `stopSim`.
- مسار `SessionConsumed` لم يُسبَر مباشرة؛ الحكم البنيوي في البند 2 مقيّد بذلك.
- بايت `more` الخام في `M0` لم يُفرَغ. الاستنتاج من الشيفرة (الإبقاء على `more` وإسقاط الفهرس الوحيد) ومن `baseline.nvHandles=0` مع بقاء `0x01000001` في الجرد المباشر.
- مسبار السياق غير موجود على `e23bd431`؛ استُعمل مسبار شجرة المراجعة على تلك النواة.
- أعداد فشل `a3f1505d` من نسخة صلبة مع استبدال ملفين، لا من تعديل الشجرة المشتركة. ملف اختبار `a3f1505d` الأصلي لا يحتوي الاختبارات الأربعة.
- اختبارات الملف الرسمي تستعمل قواعد منافذها الثابتة 3300–3540 كما يأمر نص الحزمة، لا مدى 7700–7799. مسابير السياق استعملت 7700 و7720. مسبار النص استعمل 7782–7792. مسبار الفجوة استعمل `portBase` 7740/7760/7780 وقد يتجاوز المدى بسبب `portBase + 2*random(150)`؛ المحاكيات أُوقفت. قياس المساعد القديم استعمل `portBase` 7788.
- `python3` بلا السمة `os.pidfd_open`. اختبارا CHANNEL وCHANNEL2 على الرأس ضمن خروج 0، فالمسار الاحتياطي عبر syscall عمل في هذين الاختبارين. لم يُقس مضيف بلا `python3` أو بلا pidfd.
- `dotnet` غير موجود في `PATH`. المسبار يُصرَّف بـ `pwsh Add-Type` كما في `run.sh`.
- يتيم L7a من تشغيل النسخة القديمة (pid 1898) أُنهى بعد إثبات الملكية وحُذف مجلده بعد `owners=[]`. لا يتيم في نهاية المراجعة.
