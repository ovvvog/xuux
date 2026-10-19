# تقرير مراجعة WL-420 (مركّزة على إصلاح WL-419): gpt_6_1_sol (OPENAI)

- الكوميت المراجَع: `df435a951486f124a5c75a337f17bd96924d7352`، وهو ناتج `git rev-parse HEAD` حرفيًا في شجرة `/tmp/wt-df435a95-gpt`. ([إثبات الهوية](01-identity.stdout.txt)، [الأمر وخروجه 0](01-identity.command.txt))
- زمن التشغيل الموثّق (UTC): `2026-10-19T04:06:22Z` إلى `2026-10-19T04:14:14Z`؛ يسبق ذلك الاطلاع الأول على حزمة التفويض والتحقق الأول من الرأس. ([بداية السجل](01-identity.command.txt)، [فحص الختام](28-integrity.stdout.txt))
- نطاق السؤال: البنود الخمسة في حزمة التفويض، مع تركيز البندين 1 و3 على إصلاحي WL-419. ([الحزمة المقروءة كاملة](00-brief.stdout.txt))

## طريقة القياس وحفظ الأدلة

استُخدمت الشيفرة والاختبارات والمسابير مباشرة، ولم تُقرأ تقارير أي مراجع آخر ولا تقارير الجولات السابقة؛ ادعاءات المنفّذ المقروءة هي مدخلات WL-416–WL-419 وREADME الخاص بـ`sim/tpm-ceremony` فقط، وحُفظت منفصلة عن النتائج المستقلة. ([الادعاءات](11-claims.stdout.txt)، [الشيفرة](05-core-source.stdout.txt)، [الاختبار الكامل](04-test-source.stdout.txt))

كل تشغيل مرقّم له أربعة ملفات: `<id>.command.txt` للأمر ودليل العمل والزمن ورمز الخروج، و`<id>.exit.txt` للرمز وحده، و`<id>.stdout.txt` و`<id>.stderr.txt` للمخرجات الخام؛ والجامع هو [run-record.sh](run-record.sh).

لإعادة الأوامر المختصرة أدناه تُعرّف المتغيرات التالية، ويظل نص كل أمر فعلي محفوظًا في ملفه:

```sh
R=/tmp/council-wl420-gpt_6_1_sol
H=/tmp/wt-df435a95-gpt
A=/tmp/wt-a3f1505d
B=/tmp/wt-e23bd431
export TMPDIR="$R"
export XUUX_TPM_SIM=1
export TPM2TOOLS_TCTI=swtpm:host=127.0.0.1,port=7600
```

اختبارات المستودع تختار منافذ خارج المدى المخصّص، لذلك حصر [محمّل ESM](port-loader.mjs) **تعبير اختيار المنفذ فقط** في الأزواج `7600–7679` عند التحميل، دون تعديل أي ملف متعقّب؛ واستُخدمت `7686/7687` لمسبار الزومبي و`7690/7691` و`7692/7693` لمسباري السياق. ([تعبير المنفذ الأصلي، السطر 349](03-lifecycle.stdout.txt)، [أوامر الاختبارات](07-head-wl416.command.txt)، [مسبار الزومبي](14-stop-zombie.stdout.txt)، [أمر خط الأساس](09-context-baseline.command.txt)، [أمر الرأس](10-context-head.command.txt))

## البند 1: open

**الإصلاح المحدد يعمل في حالتي L7a/L7b، لكن الخاصية الكاملة لعدم إعلان التوقف بلا دليل لا تزال مفتوحة بسبب WL420-gpt_6_1_sol-01 أدناه.** ([الاختبارات الأربعة على الرأس](20-head-four.stdout.txt)، [المسبار المضاد](14-stop-zombie.stdout.txt))

- في `tests/helpers/ceremony-swtpm.mjs:393–400` لا يُسلَّم PID إلا إذا ظهر في `scanStateDir(dir).matches`، وإلا يُسمّى `pid-not-owner` ويمر مسار الإنهاء الموحد؛ وفي `:454–470` ينهي `stopSim` كل مالك مثبت يعثر عليه، لكن فحصه النهائي ينظر إلى `matches` وحدها، لا `unresolved` ولا `zombies`. ([قراءة الملف كاملة، خروج 0](03-lifecycle.command.txt)، [الملف مرقّمًا](03-lifecycle.stdout.txt))
- لا يوجد رجوع لإشارة قاتلة عبر رقم PID في `killSim`: فتح pidfd يسبق إعادة قراءة الهوية، والإشارة عبره وحده؛ ويتحقق الربط بوسيطَي `--tpmstate` و`dir=<المسار>` كاملين، وتُعاد الهوية قبل التصعيد، وESRCH وحدها نفي الوجود في `alive`. ([الأسطر 35–72 و104–153 و219–260](03-lifecycle.stdout.txt))
- استثناءا `probe` و`onAbandon` لا يتجاوزان الإنهاء في `startSim:380–447`، ويأتي المراقب قبل حذف المجلد وبعد محاولة الإنهاء، وتُعطى أخطاء التنظيف أولوية ولا تبدأ محاولة جديدة عند عدم ثبوت التوقف؛ واختبارات L1–L6 وR2-01/R2-02 وCHANNEL/CHANNEL2/ZOMBIE ضمن التشغيل الكامل نجحت. ([الشيفرة](03-lifecycle.stdout.txt)، [نتيجة التشغيل الكامل](07-head-wl416.stdout.txt))

**الأوامر والنتائج:**

```sh
cd "$H"
bash "$R/run-record.sh" 07-head-wl416 env \
  TMPDIR="$R" XUUX_TPM_SIM=1 \
  TPM2TOOLS_TCTI=swtpm:host=127.0.0.1,port=7600 \
  node --experimental-loader="$R/port-loader.mjs" --test \
  --test-concurrency=1 tests/sim/tpm-ceremony-wl416.test.mjs
```

الخروج `0`، العدد `22`، النجاح `22`، الإخفاق `0`، التخطي `0`. ([الأمر](07-head-wl416.command.txt)، [الرمز](07-head-wl416.exit.txt)، [TAP الخام](07-head-wl416.stdout.txt))

```sh
node --experimental-loader="$R/port-loader.mjs" "$R/unavailable-pidfd-probe.mjs"
node "$R/stop-zombie-probe.mjs"
```

الأول خرج `0`: مع حجب الوصول إلى python بقي المحاكي حيًا، و`stopped=false`، وعدد الإشارات غير الصفرية عبر `process.kill` يساوي صفرًا، والمجلد محفوظ؛ والثاني خرج `1` لأن `stopSim` أعلن التوقف وحذف المجلد رغم بقاء صاحب الحالة زومبيًا قابلًا لإثبات الوجود بالإشارة صفر. ([أمر الأول](21-no-pidfd.command.txt)، [خرجه الخام](21-no-pidfd.stdout.txt)، [أمر الثاني](14-stop-zombie.command.txt)، [خرجه الخام](14-stop-zombie.stdout.txt)، [التأكيد الفاشل](14-stop-zombie.stderr.txt))

## البند 2: holds

**هذا الحكم يخص صحة دورة الحياة المقيسة وصحة تصريح WL-418 بأن معيار «رفض على القديمة ثم قبول بعد الإصلاح» غير مستوفى؛ لا يعني أن ذلك المعيار قد استُوفي.** ([ادعاء WL-418](11-claims.stdout.txt)، [قياس خط الأساس](09-context-baseline.stdout.txt)، [قياس الرأس](10-context-head.stdout.txt))

- يسجَّل السياق بعد فحص الرد الناجح في `TpmCeremonyCore.cs:1221–1225`، ويمسحه نجاح `FlushContext` في `ResponseContext.Record:611–615`، ويمسحه `EndOfLife:635–638` بعد غياب مثبت في `ReconcileOne:1953–1965` أو اختفاء جلسة السياسة في `:1991–2002`، وكذلك بعد الزيادة المفوّضة الناجحة في `:1808–1809` عبر `SessionConsumed:1694`؛ أما المقبض الباقي فتُسجّل حقيقة احتفاظه بالسياق بدل مسحه. ([الشيفرة مرقّمة](05-core-source.stdout.txt)، [اختبارا CTX وCTX2](04-test-source.stdout.txt))
- يعيد `Record(CreatePrimary/Load)` كتابة هوية المقبض بدل وراثتها، ويمحو تسجيل الجلسة خرائط الكائن، ولا تتحول إزالة السياق إلى قبول افتراضي: `CreationData:843–845` يرفض الأصل المجهول باسم `RESPONSE_CREATION_PARENT_UNKNOWN`. ([الشيفرة](05-core-source.stdout.txt)، [الفرق مع خط الأساس](12-context-diff.stdout.txt))

شُغّل نفس مسبار C#، ببصمة `578ea4632f0699a9324639a0b68a77bb5b56721ed85bc094c4b10e78d2e7d54e`، على نسختي النواة؛ نسخة `run.sh` الخاصة بالمراجعة تختلف عن الأصل **بمسار مجلد الحالة المؤقت فقط**، لأن الأصل يفرض مسارًا خارج مجلد التفويض. ([فرق إعداد المسبار وبصمته](08-context-preparation.stdout.txt)، [أمر الإعداد، خروج 0](08-context-preparation.command.txt))

```sh
bash "$R/context-probe/run.sh" "$B/sim/tpm-ceremony/TpmCeremonyCore.cs" 7690
bash "$R/context-probe/run.sh" "$H/sim/tpm-ceremony/TpmCeremonyCore.cs" 7692
```

الخروج `0` لكليهما، وكل حالة أثبتت الغياب بالجرد وإعادة استعمال نفس رقم `0x80000000`، وعدد المحاكيات المرتبطة بمجلد كل مسبار بعد إيقافه `0`. ([أمر القديمة](09-context-baseline.command.txt)، [مخرج القديمة](09-context-baseline.stdout.txt)، [أمر الرأس](10-context-head.command.txt)، [مخرج الرأس](10-context-head.stdout.txt))

| الحالة | e23bd431 | df435a95 |
|---|---|---|
| إعادة استخدام بهوية جديدة مع تسجيلها | `ACCEPT` | `ACCEPT` |
| إعادة استخدام بهوية جديدة بلا تسجيل | `REJECT … parentName differs` | `REJECT RESPONSE_CREATION_PARENT_UNKNOWN` |
| إعادة استخدام بالهوية نفسها بلا تسجيل | `ACCEPT` بسياق بائت | `REJECT RESPONSE_CREATION_PARENT_UNKNOWN` |
| رد غير صالح بعد إعادة استخدام مسجّلة | `REJECT … parentName differs` | `REJECT … parentName differs` |

كل خلية في الجدول من [المخرج الخام للقديمة](09-context-baseline.stdout.txt) و[المخرج الخام للرأس](10-context-head.stdout.txt).

الحجة البنيوية صحيحة **لهذا الفاحص ومسار السياق عند تثبيت الطلب والرد وتسلسل التسجيل**: تغييرات السياق إزالات، والتسجيل الجديد يعيد الكتابة في النسختين، وغياب الأصل أو نوع الجلسة يؤدي إلى رفض مسمّى لا إلى قبول؛ لذلك لا تنتج إزالة سياق بائت قبولًا كان مرفوضًا سابقًا، ولا يجوز تعميم النتيجة على كل اختلافات تشغيل البروفة أو اعتبارها استيفاءً لمعيار الرجوع المطلوب. ([الفرق الكامل للنواة مع خط الأساس](12-context-diff.stdout.txt)، [فحوص السياق في النواة](05-core-source.stdout.txt)، [نتيجتا المسبار](09-context-baseline.stdout.txt)، [الرأس](10-context-head.stdout.txt))

## البند 3: holds

**حاجز الإرسال يوقف الأمر المغيّر التالي في حالتي الظهور المتأخر، واستثناءا التحرير ليسا في المسار المقروء إذنًا لحذف فهرس غير منسوب؛ توجد ملاحظة تشخيصية منخفضة الخطورة مستقلة، WL420-gpt_6_1_sol-03.** ([قياس ما بعد التعريف](22-detail-nv-appear-after-define.stderr.txt)، [قياس ما بعد Primary](22-detail-nv-appear-after-primary.stderr.txt)، [تشخيص الظهور المبكر](22-detail-nv-appear-late.stderr.txt))

- `Send:1206–1208` يعيد الحاجز قبل إضافة خطوة الأمر وقبل النقل، عندما يكون `_nvGuardArmed` مفعّلًا، ويستثني `NvGuardedAtSend:1201–1203` فقط `FlushContext` و`NV_UndefineSpace` من مجموعة أوامر التغيير؛ ويجري أول تسليح بعد الجرد في `Run:2097–2100`. ([الشيفرة مرقمة](05-core-source.stdout.txt))
- لا يتسلّح الحاجز إلا بعد جرد ناجح بلا فهرس غير منسوب، والعتبة بقيت `1` في `:1483`، ومجال المالك بقي `0x01800000–0x01BFFFFF`، وتسجّل `:1500–1505` قائمة الفهارس لا العدد وحده؛ ومطابقة تعريف بعد ضياع رده لا تُدخل الفهرس في ملكية الجولة في `:1885–1916`. ([الشيفرة](05-core-source.stdout.txt)، [اختبارات NV1/NV2/NV3](07-head-wl416.stdout.txt))
- الاستثناء مبرّر في المسارات الفعلية: لا يدخل `_definedByRun` إلا بعد رد تعريف ناجح في `Define:1582–1588`، ولا يرسل الحذف إلا `UndefineOwn:1623–1638` بعد وجود قيد الملكية ومطابقة المنطقة العامة عدا WRITTEN، ويقتصر `Flush:1660–1665` على `_transients` المتتبعة؛ ولا توجد نقطة إرسال ثانية لحذف NV في النواة. ([الملف الكامل ونقاط الاستدعاء](05-core-source.stdout.txt))

```sh
node --experimental-loader="$R/port-loader.mjs" "$R/fault-detail.mjs" nv-appear-after-define
node --experimental-loader="$R/port-loader.mjs" "$R/fault-detail.mjs" nv-appear-after-primary
```

كلا التشغيلين خرج `0`: الأول وقف قبل `s1.probe:NV_Increment#1` ولم يرسل بعده إلا حذف فهرس الجولة المثبت، والثاني وقف قبل `s2:Create(service-key,ECDSA-P256)` ولم يرسل بعده إلا تحرير Primary؛ والفهرس الأجنبي `0x01807777` بقي في الجرد المباشر في الحالتين. ([أمر الأول](22-detail-nv-appear-after-define.command.txt)، [JSON الأول الخام](22-detail-nv-appear-after-define.stdout.txt)، [أمر الثاني](22-detail-nv-appear-after-primary.command.txt)، [JSON الثاني الخام](22-detail-nv-appear-after-primary.stdout.txt))

المقارنة المستقلة مع النواة القديمة، مع حقن الأعطال نفسه، أثبتت أن القديمة أرسلت الزيادتين بعد الظهور الأول، وأنها واصلت `Create/Load/StartAuthSession/PolicySigned/PolicyCommandCode` بعد الظهور عقب Primary؛ خرج مشغّلا القياس القديم `0`، وهذا رمز نجاح القياس لا صحة السلوك القديم. ([أمر القديمة بعد التعريف](26-old-detail-nv-appear-after-define.command.txt)، [مخرجها](26-old-detail-nv-appear-after-define.stderr.txt)، [أمر القديمة بعد Primary](26-old-detail-nv-appear-after-primary.command.txt)، [مخرجها](26-old-detail-nv-appear-after-primary.stderr.txt))

هذا حكم على المسارات المقروءة والمقيسة، لا برهان ضد نقل يكذب في الجرد، ولا ضمان ذريًا ضد استبدال فهرس مطابق بواسطة طرف آخر بين التحقق والحذف؛ اختبارا الظهور المتأخر يزرعان فهرسًا مختلفًا ظاهرًا في الجرد، ولا يختبران ذلك الاستبدال المتزامن. ([موضع الحقن، الأسطر 712–722](06-fault-source.stdout.txt)، [موضع فحص الملكية ثم الحذف](05-core-source.stdout.txt))

## البند 4: holds

**M0 يثبت حدّه الضيق، ولا يثبت اكتمال الجرد ضد محاكٍ كاذب، والقرار الموثق باقٍ دون توسيع.** ([الاختبار، الأسطر 412–428](04-test-source.stdout.txt)، [التوثيق، الأسطر 82–86](11-claims.stdout.txt))

`inventory-more0-hide` يعرّف فهرسًا حقيقيًا خارج مجال المالك، `0x01000001`، ويحذفه من قائمة المقابض في الرد مع حفظ قيمة `more` التي ردها المحاكي، ولا يصنع بنفسه سيناريو صفحات ممتلئة يغيّر فيه `more=1` إلى `0`؛ واختبار M0 يشترط اكتمال البروفة وتفعيل التحوير وبقاء الفهرس في الجرد المباشر فقط. ([حقن الفهرس، الأسطر 117–124، والتحوير، الأسطر 668–692](06-fault-source.stdout.txt)، [نص M0](04-test-source.stdout.txt))

```sh
node --experimental-loader="$R/port-loader.mjs" "$R/fault-detail.mjs" inventory-more0-hide
```

الخروج `0`، وحالة البروفة `COMPLETE`، وعدد التحويرات `40`، والجرد الداخلي المباشر بعد البروفة يحوي `0x01000001`؛ وهي قرينة على وجود فهرس مخفي مع اكتمال مسار يعتمد الرد، لا قرينة على خلو حقيقي. ([الأمر](22-detail-inventory-more0-hide.command.txt)، [JSON الخام](22-detail-inventory-more0-hide.stdout.txt)، [الملخّص الخام](22-detail-inventory-more0-hide.stderr.txt))

بقي رفض `more=1/count=0` والعدد أو الفئة أو الترتيب غير الصحيح في `ResponseSchema:969–1032` وفي قارئ الجرد `NvHandles:1393–1427`، وشمل تشغيل اختبارات R3 هذه السلبيات بنجاح. ([الشيفرة](05-core-source.stdout.txt)، [اختبارات R3 الخام](23-r3-fup.stdout.txt))

## البند 5: open

**لم يظهر إضعاف للفشل المغلق في نواة البروفة ضمن الفرق، لكن ضمانات تنظيف اختبارات التراجع وإثبات زوال المحاكي لا تكتمل؛ تمنع الملاحظتان 01 و02 الحكم الشامل holds.** ([الفرق الكامل](02-diff.stdout.txt)، [مسبار الزومبي](14-stop-zombie.stdout.txt)، [العملية التي بقيت بعد اختبار التراجع](17-old-four-processes.stdout.txt))

الفرق المقروء `git diff a3f1505d df435a951486f124a5c75a337f17bd96924d7352 -- sim tests scripts` محصور في خمسة ملفات، ولا يغيّر مسار المصالحة الذي يترك فهرس التعريف المجهول بلا حذف، ولا يزيل شرط الملكية في `UndefineOwn`؛ وفحص `git diff --check` لهذا المدى خرج `0` بلا مخرج. ([أمر الفرق](02-diff.command.txt)، [الفرق الخام](02-diff.stdout.txt)، [شرط الملكية والمصالحة](05-core-source.stdout.txt)، [أمر فحص الفرق](25-diff-check.command.txt)، [خروجه](25-diff-check.exit.txt))

قرأت ملف WL-416 كاملًا، لا الإضافات الأربع وحدها: `withSim:63–75` يحمي التنظيف في finally، واختبارات EPERM والهوية غير المقروءة تحمي الموارد المكتسبة، وZOMBIE يجمع أخطاء مسارات التنظيف المستقلة؛ لكن L7a وL7b المضافين لا يغلّفان كامل الفترة بعد الإطلاق بحماية مماثلة. ([الاختبار الكامل مرقّمًا](04-test-source.stdout.txt)، [الإضافات في الفرق](02-diff.stdout.txt))

```sh
cd "$H"
node --experimental-loader="$R/port-loader.mjs" --test --test-concurrency=1 \
  tests/sim/tpm-ceremony-wl413-r3.test.mjs \
  tests/sim/tpm-ceremony-wl414-fup.test.mjs
```

الخروج `0`، `58` اختبارًا ناجحًا، `0` إخفاق و`0` تخطٍّ، بالإضافة إلى تشغيل WL-416 الكامل `22/22`؛ هذه النتائج لا تلغي الإخفاقين المضادين المقيسين. ([الأمر](23-r3-fup.command.txt)، [TAP الخام](23-r3-fup.stdout.txt)، [WL-416 الخام](07-head-wl416.stdout.txt)، [الإخفاق المضاد الأول](14-stop-zombie.stderr.txt)، [تسرب مورد الاختبار](17-old-four-processes.stdout.txt))

## تحقق ادعاء التراجع (NV4/NV5/L7a/L7b على a3f1505d مقابل df435a95)

ملف `a3f1505d` الأصلي يحوي `18` اختبارًا ولا يحوي الأربعة الجديدة؛ لذلك شغّلته أولًا كما هو، ثم حمّلت نص اختبار الرأس مع حزامه وحقن أعطاله على **نواة a3f1505d ومساعد دورة حياته** عبر محمّل خارجي، دون تغيير أي ملف في الأشجار؛ وفرق الحزام الخاص بالمراجعة يغير مساري النواة وملف حقن الأعطال فقط. ([نتيجة القديم الأصلي](15-old-native.stdout.txt)، [محمّل المقارنة](old-regression-loader.mjs)، [فرق إعداد الحزام والبصمات](13-old-preparation.stdout.txt))

```sh
cd "$A"
node --experimental-loader="$R/port-loader.mjs" --test --test-concurrency=1 \
  tests/sim/tpm-ceremony-wl416.test.mjs
node --experimental-loader="$R/old-regression-loader.mjs" --test \
  --test-concurrency=1 '--test-name-pattern=^(NV[45]|L7[ab]):' \
  tests/sim/tpm-ceremony-wl416.test.mjs
cd "$H"
node --experimental-loader="$R/port-loader.mjs" --test \
  --test-concurrency=1 '--test-name-pattern=^(NV[45]|L7[ab]):' \
  tests/sim/tpm-ceremony-wl416.test.mjs
```

| التشغيل | العدد المسجّل | نجاح | إخفاق | تخطٍّ | رمز الخروج | الدليل |
|---|---:|---:|---:|---:|---:|---|
| ملف a3f1505d الأصلي كاملًا | 18 | 18 | 0 | 0 | 0 | [الأمر](15-old-native.command.txt)، [TAP](15-old-native.stdout.txt) |
| الاختبارات الجديدة على تنفيذ a3f1505d | 22 | 0 | 4 | 18 | 1 | [الأمر](16-old-four.command.txt)، [TAP](16-old-four.stdout.txt) |
| الأربعة نفسها على df435a95 | 22 | 4 | 0 | 18 | 0 | [الأمر](20-head-four.command.txt)، [TAP](20-head-four.stdout.txt) |
| ملف df435a95 كاملًا | 22 | 22 | 0 | 0 | 0 | [الأمر](07-head-wl416.command.txt)، [TAP](07-head-wl416.stdout.txt) |

الأربعة القديمة فشلت بتأكيدات السلوك لا بخطأ تحميل: NV4/NV5 بنص الفشل القديم الذي لا يسمي الأمر، وL7a بتسليم PID غير مالك، وL7b ببقاء المالك بعد إعلان التوقف؛ وأثبتت مسابير JSON القديمة المستقلة أيضًا استمرار أوامر التغيير، لا اختلاف النص فقط. ([تفاصيل إخفاقات الأربعة](16-old-four.stdout.txt)، [تفاصيل NV القديمة بعد التعريف](26-old-detail-nv-appear-after-define.stdout.txt)، [بعد Primary](26-old-detail-nv-appear-after-primary.stdout.txt))

**ادعاء اختلاف النتيجة للأربعة قائم، مع عيب تنظيف في الاختبار نفسه:** بقي محاكٍ واحد `PID=29061` مرتبط بمجلد `xuux-wl418-l7a-NK3EMp` بعد انتهاء التشغيل القديم، ثم أُنهي بمساعد الرأس وقناة الهوية دون حذف ملفاته المتبقية، وأظهر المسح بعدها `own_state_dir_owners=0`. ([قبل التنظيف](17-old-four-processes.stdout.txt)، [أمر التنظيف](18-old-four-cleanup.command.txt)، [إثبات الإنهاء](18-old-four-cleanup.stdout.txt)، [المسح بعده](19-after-cleanup.stdout.txt))

## ملاحظات جديدة

### WL420-gpt_6_1_sol-01 — medium — stopSim يهمل الزومبي وغير المحسوم في المسح النهائي

- **الموضع:** `tests/helpers/ceremony-swtpm.mjs:461–466` يستعمل `.matches` وحدها رغم أن `scanStateDir:174–207` يميّز `unresolved` و`zombies`، ورغم أن `terminateAttempt:308–323` يمنع إعلان التوقف مع أي منهما. ([الشيفرة مرقّمة](03-lifecycle.stdout.txt))
- **إعادة الإنتاج:** `TMPDIR="$R" node "$R/stop-zombie-probe.mjs"`، من أي دليل؛ يطلق المسبار swtpm حقيقيًا على `7686/7687` كابن يملكه، يثبت استجابته وملكيته للمجلد، ثم يقتله ويؤخر حصاده حتى تبقى حالته `Z`، ويستدعي `stopSim` برقم زائل كما في سيناريو L7b. ([المسبار](stop-zombie-probe.mjs)، [الأمر الفعلي](14-stop-zombie.command.txt))
- **النتيجة:** الخروج `1`؛ قبل الاستدعاء `terminateAttempt.stopped=false` و`identityUnknown=true`، وبعده `stopSimReturned=true` و`actualOwnerStillExists=true` مع `stateDirExists=false`؛ ثم حصد المسبار ابنه وأثبت ESRCH في finally. ([المخرج الخام](14-stop-zombie.stdout.txt)، [التأكيد الفاشل](14-stop-zombie.stderr.txt)، [رمز الخروج](14-stop-zombie.exit.txt))
- **الأثر وحدوده:** هذه مخالفة مقيسة لشرط ESRCH وعدم حذف المجلد قبل إثبات الزوال، وليست ادعاءً بأن الزومبي ينفذ أوامر أو أن إشارة أصابت عملية بريئة؛ ولا أدّعي أن WL-419 أدخل السلوك لأول مرة، بل إن إغلاق الخاصية المطلوبة بقي غير كامل. ([دليل الحالة الفعلية](14-stop-zombie.stdout.txt)، [المعيار المحدد في الحزمة](00-brief.stdout.txt))
- **اتجاه الإصلاح:** استعمال نتيجة مسح كاملة ومنع إعلان التوقف والحذف عند وجود `unresolved` أو `zombies`، أو استعمال مسار الإنهاء الموحد مع الاحتفاظ بمعيار ESRCH؛ لا اختزال عدم وجود مالك مقروء إلى دليل زوال.

### WL420-gpt_6_1_sol-02 — medium — L7a يترك محاكيًا حيًا عند إخفاق التراجع الذي صُمم لاكتشافه

- **الموضع:** `tests/sim/tpm-ceremony-wl416.test.mjs:1012–1049` يحفظ `launched` لكنه لا يحتفظ بمقبض نظيف في finally ولا ينهي المحاكي إذا أعاد `startSim` رقمًا غير مالك؛ وL7b في `:1053–1062` أيضًا لا يحمي تأكيد الملكية الأول وما بعده كله بـfinally. ([الاختبار مرقّمًا](04-test-source.stdout.txt))
- **إعادة الإنتاج:** أمر `16-old-four` أعلاه، باستخدام نص اختبار الرأس على التنفيذ القديم؛ ثم `node "$R/list-own-processes.mjs"` قبل أي تنظيف خارجي. ([الأمر](16-old-four.command.txt)، [أمر المسح](17-old-four-processes.command.txt))
- **النتيجة:** الخروج `1` للاختبارات، ثم المسح بخروج `0` وجد محاكيًا حيًا واحدًا من L7a بعد خروج مشغّل Node، `PID=29061`، وله `--tpmstate dir=.../xuux-wl418-l7a-NK3EMp`؛ أنهيته بهوية المسار عبر `killSim` من الرأس، وأبقيت دليل الحالة. ([TAP الخام](16-old-four.stdout.txt)، [العملية الخام](17-old-four-processes.stdout.txt)، [التنظيف الموثق](18-old-four-cleanup.stdout.txt))
- **الأثر:** اختبار الحماية من التراجع يعيد إنتاج المورد اليتيم أثناء إخفاقه المقصود، فلا يكفي نجاحه الحالي لإسناد عبارة «كل اختبار ينهي محاكيه في finally» المكتوبة قبل الإضافات؛ أما تسرب L7b عند تأكيد مبكر فحجة شيفرية ولم أختبره بحقن إخفاق مستقل. ([العبارة والإضافات](04-test-source.stdout.txt)، [شاهد تسرب L7a](17-old-four-processes.stdout.txt))
- **اتجاه الإصلاح:** التقاط دليل المجلد والعملية منذ `afterSpawn`، ثم إحاطة الجسم كله بعد الإطلاق بـfinally ينهي كل مالك مثبت ويعلن خطأ التنظيف، حتى إن أعاد التنفيذ القديم مقبضًا غير صحيح أو أخفق أول تأكيد.

### WL420-gpt_6_1_sol-03 — low — نص حاجز NV يدّعي إرسال أوامر قبل إرسال أول أمر

- **الموضع:** `sim/tpm-ceremony/TpmCeremonyCore.cs:1509–1515` يساوي بين `_nvGuardArmed` وبين سبق إرسال أمر مغيّر، مع أن التسليح يحدث بعد أول فحص ناجح وقبل أي إرسال مغيّر. ([الشيفرة مرقمة](05-core-source.stdout.txt))
- **إعادة الإنتاج:** `node --experimental-loader="$R/port-loader.mjs" "$R/fault-detail.mjs" nv-appear-late` مع TMPDIR المحدد؛ يستعمل وضع NV3 القائم ويؤكد خلو سجل الخطوات من أوامر التغيير. ([المسبار](fault-detail.mjs)، [الأمر](22-detail-nv-appear-late.command.txt))
- **النتيجة:** الخروج `1` لتأكيد صدق التشخيص؛ التقرير `FAILED_CLOSED` و`stateChangingSteps=[]` والفهرس الأجنبي باقٍ، لكن النص يقول `state-changing commands were already sent in this run (see steps)` ويسمي `s1.probe:NV_DefineSpace` أمرًا لاحقًا. ([JSON الخام](22-detail-nv-appear-late.stdout.txt)، [التلخيص والتأكيد الفاشل](22-detail-nv-appear-late.stderr.txt)، [رمز الخروج](22-detail-nv-appear-late.exit.txt))
- **الأثر وحدوده:** لا تجاوز للحاجز ولا حذف للفهرس في هذا الشاهد؛ الخلل في صدق السجل التشخيصي فقط، ولم يمنع النص الجديد من تسمية الأمر الموقوف في NV4/NV5. ([شاهد NV3](22-detail-nv-appear-late.stderr.txt)، [شاهد NV4](22-detail-nv-appear-after-define.stderr.txt)، [شاهد NV5](22-detail-nv-appear-after-primary.stderr.txt))
- **اتجاه الإصلاح:** فصل تسليح الحاجز عن عدّ الأوامر المغيّرة المرسلة فعليًا، أو حذف الجملة الجازمة عن الإرسال السابق واستعمال وصف محايد.

## حدود

- لم يُشغَّل عتاد حقيقي أو TBS، ولم تُفتح أي قناة إلى `/dev/tpm*`، ولم تُستعمل `gh` ولا عمليات commit أو push؛ النتائج التشغيلية تخص swtpm ووسائل دورة حياة الاختبارات فقط.
- لم أعد تشغيل `scripts/tpm-sim-ci.sh` ذي المحاكي المشترك، ولا `npm run validate` ولا المجموعة الكاملة لكل اختبارات المستودع؛ المقاس هنا WL-416 كاملًا، وملفاه الداعمان R3/FUP، والمسابير المحددة، لا الأرقام التاريخية المنقولة في دفتر العمل. ([أوامر WL-416](07-head-wl416.command.txt)، [الداعمان](23-r3-fup.command.txt)، [الادعاءات التاريخية غير المعتمدة كقياس مستقل](11-claims.stdout.txt))
- اختبار غياب قناة pidfd حجب executable python المستخدم للقناة ولم يعطّل دعم النواة لـpidfd فعليًا، واختبار تغيّر الهوية القائم حقن قارئ الهوية لا حملًا واقعيًا لإعادة استعمال PID؛ فلا يُستنتج من ذلك قياس إجهاد للسباق تحت الحمل. ([مسبار القناة](unavailable-pidfd-probe.mjs)، [اختبار R2-02، الأسطر 528–597](04-test-source.stdout.txt))
- لم أختبر استبدال فهرس سبق إثبات ملكيته بآخر مطابق بين فحصه وحذفه، ولا كذب الجرد الشامل لموارد داخل مجال المالك؛ ومسبار M0 لا يغطي اقتطاع صفحات ممتلئة أو تحويل `more=1` المصطنع إلى `0`. ([فحص الحذف](05-core-source.stdout.txt)، [نطاق حقن M0 وNV4/NV5](06-fault-source.stdout.txt))
- معيار «رفض القديمة ثم قبول المصححة» ما زال غير مستوفى كما فُصل في البند 2، ولا يُستبدل بإخفاق استيراد واجهات غير موجودة أو بنتيجة قبول بائت قديمة. ([قياس القديمة](09-context-baseline.stdout.txt)، [قياس الرأس](10-context-head.stdout.txt))
- لم تُقرأ README التقارير أو أي تقرير نهائي آخر داخل `docs/external-review/reports/`؛ اقتصرت القراءة هناك على ملفّي المسبار اللذين سمّتهما الحزمة، تجنبًا لتعارض بند الادعاءات مع المنع الصريح لقراءة التقارير.
- فحص الختام بخروج `0` أكد الرأس المطلوب ونظافة الأشجار الثلاث، ومسح العمليات المقيد **بمسارات حالتي فقط** وجد `own_state_dir_owners=0`؛ لا أدّعي من ذلك إحصاء محاكيات بقية المراجعين أو إنهاء أي منها. ([أمر التحقق الصارم](28-integrity.command.txt)، [مخرجه](28-integrity.stdout.txt)، [البصمات الختامية](27-final-state.stdout.txt))
