# تقريرُ مراجعةٍ مستقلّة — بروفةُ مراسمِ ADR 0007 (WL-412) — gpt_6_1_sol

**المُعرِّف:** gpt_6_1_sol  **المزوِّد:** OpenAI  
**زمنُ التشغيل:** البدء `2026-10-17T10:12:54Z`؛ الانتهاء `2026-10-17T10:18:09Z`.  
**الكوميتُ المُراجَع:** `50518cf64572e5462b4ce616a491878a1cb426df`؛ طبعه `git rev-parse HEAD` في `/home/user/workspace/xuux-review-50518cf6` عند البداية وعند النهاية؛ وسجل النهاية يعرض خرج `git status --porcelain` فارغاً، والفحص الإضافي يقيس حجمه بصفر بايت. [سجل النهاية](final-state.log)، [فحص الإيقاف والشجرة](stop-confirmation.log).

**بيئةُ التشغيل:** Linux، Node `20.20.2`، PowerShell `7.4.6`، swtpm `0.10.1`، Mono C# compiler `6.14.1.0`، tpm2-tools `5.7`؛ استُعمل المحاكي الخاص بي على `127.0.0.1:2341` والتحكم `2342`؛ لا مضيف Windows ولا اختبار TBS فعلي ولا شريحة فعلية في هذه المراجعة. [البيئة](environment.log)، [سجل النهاية](final-state.log).

## تصريحُ استقلال

قرأتُ التكليف المشترك `brief.md`، والملفات المسمّاة فيه، وأجزاءَ `TpmHostSimTransport.cs` اللازمة لفهم النقل التسجيلي، ومواصفات TCG العامة المشار إليها أدناه؛ ولم أقرأ أي مجلد عضو آخر تحت `council-ceremony/`، ولا أي ملف تحت `docs/external-review/reports/`، ولا مصفوفات مقارنة. لم أستعن بالمنفذ في الاستنتاجات، ولم أعدّل ملفات الشجرة، ولم أستعمل `gh` أو الشبكة إلى GitHub، ولم أنفّذ إيداعاً أو دفعاً، ولم أفتح أي جهاز TPM؛ والأوامر التي اتصلت بمحاكٍ اتصلت بالمحاكي الخاص بي وحده.

كتبتُ المسابر بنفسي خارج شجرة المراجعة، وحفظتُ الشيفرة ونتائجها في هذا المجلد؛ والمسباران C# أُنشئا للتجربة فقط ولم يُضافا إلى المشروع. [مسبار الأخطاء](IndependentProbe.cs)، [مسبار الحارس](HostGuardProbe.cs)، [مسبار OpenSSL](openssl-digest-probe.mjs).

## سجلُّ الأدلّة

### الأوامر المشتركة ومخارجها

استُعملت الأوامر التالية، مع كون مسارات المخرجات كلها في `/home/user/workspace/council-ceremony/gpt_6_1_sol/`؛ سجل الاختبارات يحتوي 18 اختباراً، بلا إخفاق ولا تخطٍّ، وخرج عملية Node كان `0`. [خرج الاختبارات](tests.log).

```sh
git -C /home/user/workspace/xuux-review-50518cf6 rev-parse HEAD
# 50518cf64572e5462b4ce616a491878a1cb426df ; exit 0

swtpm socket --tpm2 \
  --tpmstate dir=/home/user/workspace/council-ceremony/gpt_6_1_sol/st \
  --server type=tcp,port=2341,bindaddr=127.0.0.1 \
  --ctrl type=tcp,port=2342,bindaddr=127.0.0.1 \
  --flags not-need-init,startup-clear \
  --pid file=/home/user/workspace/council-ceremony/gpt_6_1_sol/pid --daemon
# exit 0

cd /home/user/workspace/xuux-review-50518cf6
XUUX_TPM_SIM=1 TPM2TOOLS_TCTI=swtpm:host=127.0.0.1,port=2341 \
  node --test --test-concurrency=1 \
  tests/sim/tpm-ceremony-rehearsal.test.mjs \
  tests/sim/tpm-ceremony-guard.test.mjs \
  > /home/user/workspace/council-ceremony/gpt_6_1_sol/tests.log 2>&1
# exit 0

pwsh -NoProfile -File sim/tpm-ceremony/rehearse.ps1 \
  -SimHost 127.0.0.1 -SimPort 2341 -Stages ALL \
  > /home/user/workspace/council-ceremony/gpt_6_1_sol/rehearsal.json \
  2> /home/user/workspace/council-ceremony/gpt_6_1_sol/rehearsal.stderr
# exit 0
```

في البروفة المباشرة: 75 خطوة، و`failure=null`، و`cleanupLeftovers=[]`؛ قيم S1 كانت `13→14`، ثم `15` في المقبض الجديد، وقيمة فهرس اختبار السياسة بقيت `16` بعد المسارات السلبية؛ وهذه أرقام جلسة المحاكي المتراكمة وليست قيمة بداية عامة. [البروفة المباشرة](rehearsal.json).

شغّلت أيضاً `-Stages S1` و`-Stages S2` كلّاً على حدة، بالمضيف والمنفذ نفسيهما؛ خرج كل عملية `0`، وعدد الخطوات `25` و`12` على الترتيب، بلا بقايا معلنة في التشغيل العادي. [سجل المرحلتين](stage-runs.log)، [S1](rehearsal-S1.json)، [S2](rehearsal-S2.json).

### المسابر المستقلة

أوامر البناء والتشغيل التالية خرجت جميعها بالرمز `0`؛ وهذا الرمز يخص تشغيل المسبار، ولا يحوّل الملاحظات السلبية أدناه إلى حكم إيجابي على الأداة. [سجل المسابر](independent-run.log)، [سجل مسبار الحارس](host-guard-run.log).

```sh
cd /home/user/workspace/council-ceremony/gpt_6_1_sol
mcs -langversion:5 -out:IndependentProbe.exe \
  /home/user/workspace/xuux-review-50518cf6/sim/tpm-ceremony/TpmCeremonyCore.cs \
  IndependentProbe.cs
mono IndependentProbe.exe invalid-tag > probe-invalid-tag.jsonl \
  2> probe-invalid-tag.stderr
mono IndependentProbe.exe missing-response-auth > probe-missing-response-auth.jsonl \
  2> probe-missing-response-auth.stderr
mono IndependentProbe.exe define-response-loss > probe-define-response-loss.jsonl \
  2> probe-define-response-loss.stderr
mono IndependentProbe.exe flush-refusal > probe-flush-refusal.jsonl \
  2> probe-flush-refusal.stderr
mono IndependentProbe.exe unexpected-negative > probe-unexpected-negative.jsonl \
  2> probe-unexpected-negative.stderr
node openssl-digest-probe.mjs > openssl-digest-probe.json \
  2> openssl-digest-probe.stderr

mcs -langversion:5 -out:HostGuardProbe.exe \
  /home/user/workspace/xuux-review-50518cf6/sim/tpm-ceremony/TpmCeremonyCore.cs \
  /home/user/workspace/xuux-review-50518cf6/sim/tpm-host/TpmInventoryCore.cs \
  /home/user/workspace/xuux-review-50518cf6/tests/helpers/TpmHostSimTransport.cs \
  HostGuardProbe.cs
mono HostGuardProbe.exe > host-guard-probe.json
```

| المسبار | التغيير المستقل | المشاهدة |
|---|---|---|
| `invalid-tag` | استبدال وسم 50 رداً بلا جلسات بالقيمة `0x1234`، مع الإبقاء على المحتوى الآخر | نفّذت الأداة 75 خطوة مع `failure=null`؛ لم ترفض الوسم المشوّه. [الخرج](probe-invalid-tag.jsonl) |
| `missing-response-auth` | حذف منطقة تفويض الرد من 25 رد نجاح ذي جلسات، وتصحيح حجم الحزمة فقط | نفّذت الأداة 75 خطوة مع `failure=null` رغم غياب المنطقة المطلوبة. [الخرج](probe-missing-response-auth.jsonl) |
| `define-response-loss` | تمرير أول `NV_DefineSpace` إلى المحاكي، ثم إلقاء `IOException` بدلاً من تسليم رده للنواة | توقّف التشغيل، لكن بقي فهرس `0x0182cf0a` في هذه الإعادة، بينما `cleanupLeftovers=[]`؛ سجل المسبار يحمل المقبض الفعلي، وأعاده المسبار المستقل إلى الحالة الخالية بعد مطابقة منطقته العامة. [الخرج](probe-define-response-loss.jsonl)، [الشيفرة](IndependentProbe.cs) |
| `flush-refusal` | رفض أول `FlushContext` قبل تمريره، بالرمز `0x80280400` | توقّف التشغيل؛ بقيت جلسة `0x03000000`، بينما `cleanupLeftovers=[]`؛ ثم حرّرها المسبار المستقل. [الخرج](probe-flush-refusal.jsonl) |
| `unexpected-negative` | إرجاع `0x101` بدلاً من تنفيذ اختبار توقيع الإعادة فقط | وُسم الاختبار `rejected-as-expected` واستمرت 75 خطوة بلا `failure`، مع أن الرفض لم يكن ناتجاً عن فحص التوقيع القديم. [الخرج](probe-unexpected-negative.jsonl) |
| OpenSSL | حساب بصمة السياسة باستدعاءات `openssl dgst` منفصلة وبتركيب حقول سداسية مستقل | الناتج `6d0fb50fddee0f153bd361fbf220511f614ee59a8e1cd14e096004047f326a27`، مساوي لقيمتي المحاكي وC# ولحساب Node؛ حذف التجزئة الثانية أعطى قيمة مختلفة. [الشيفرة](openssl-digest-probe.mjs)، [الخرج](openssl-digest-probe.json) |
| بتات محجوزة | تفعيل كل من البتات `8,9,20,21,22,23,24` منفرداً فوق سمات المرساة | أعادت `anchorAttributeViolations` قائمة فارغة في الحالات السبع. [الخرج](openssl-digest-probe.json) |
| حارس المضيف | عرض `GetCapability` و`NV_ReadPublic` من منشئ المراسم على `RecordingTransport` فقط | قبلهما الحارس؛ `recordingSubmittedCount=2` و`recordingReachedCount=2`، من دون نقل TBS أو اتصال بشريحة. [الخرج](host-guard-probe.json)، [الشيفرة](HostGuardProbe.cs) |

ملاحظة إجرائية: استعلام جلسات المسبار النهائي يبدأ من `0x02000000` لجرد الجلسات المحمّلة؛ لا يُستدل على غياب جلسة سياسة من جرد الجلسات المحفوظة وحده، وسجل `flush-refusal` النهائي يعرض الجلسة المتبقية صراحة؛ وتشرح Part 3 r1.38 §30.2 أن جرد LOADED_SESSION يعيد جلسات HMAC والسياسة معاً. [شيفرة المسبار](IndependentProbe.cs)، [خرج رفض التحرير](probe-flush-refusal.jsonl)، [TCG Part 3 r1.38 §30.2](https://cdn.trustedcomputinggroup.org/production/TPM_Rev_2_0_Part_3_Commands_01_38_f1ed38ee7e.pdf).

### قراءة المواصفات

قرأت ملفات TCG العامة الثلاثة، **Trusted Platform Module Library، Family “2.0”، Level 00، Revision 01.38، 29 September 2016**؛ تعذّر إحضار محتواها بأداة قراءة الويب بسبب `bad_robots_code`، فحُمّلت ملفات PDF العامة عبر HTTPS من TCG وحُوّلت محلياً بـ`pdftotext -layout`، وحُفظت مقتطفات المواضع المستخدمة وبصمات ملفاتها. [مقتطفات القراءة](spec-excerpts.txt)، [بصمات الملفات والبيئة](environment.log).

إحالات الأقسام الآتية إلى هذه النسخة تحديداً، لا إلى أحدث مسودة: [TCG Part 1 r1.38](https://cdn.trustedcomputinggroup.org/production/TPM_Rev_2_0_Part_1_Architecture_01_38_425d4a82aa.pdf)، [TCG Part 2 r1.38](https://cdn.trustedcomputinggroup.org/production/TPM_Rev_2_0_Part_2_Structures_01_38_213d66fde1.pdf)، [TCG Part 3 r1.38](https://cdn.trustedcomputinggroup.org/production/TPM_Rev_2_0_Part_3_Commands_01_38_f1ed38ee7e.pdf).

## التحليل — سؤالاً سؤالاً (1–6)

### 1. منشئ الأوامر والترميز ومناطق التفويض

**ما قسته:** قَبِل libtpms مسارات الأوامر الإيجابية في التشغيل المباشر، وأمكن بناء النواة مع `-langversion:5`؛ لا تتضمن هذه التجربة مقارنةً بتطبيق TPM آخر. [البروفة](rehearsal.json)، [سجل البناء](independent-run.log).

**المطابقة بالنص:** باني الحزم يضع الرأس بترتيب big-endian، ثم المقابض، ثم `authorizationSize` والتفويض عند وجوده، ثم المعاملات؛ وهذا يطابق موضع منطقة التفويض في Part 3 r1.38 §4.3، وتسلسل `TPMS_AUTH_COMMAND` في Part 2 r1.38 §10.13.2. [النواة:127–185](../../xuux-review-50518cf6/sim/tpm-ceremony/TpmCeremonyCore.cs#L127)، [TCG Part 3 r1.38 §4.3](https://cdn.trustedcomputinggroup.org/production/TPM_Rev_2_0_Part_3_Commands_01_38_f1ed38ee7e.pdf)، [TCG Part 2 r1.38 §10.13.2](https://cdn.trustedcomputinggroup.org/production/TPM_Rev_2_0_Part_2_Structures_01_38_213d66fde1.pdf).

كل صف تالٍ يقارن دالة `Cmd` بجدول الأمر الفعلي، لا بمجرد نجاح المحاكي؛ قيم أكواد الأوامر تطابق أيضاً Part 2 r1.38 §6.5.2. [النواة:188–277](../../xuux-review-50518cf6/sim/tpm-ceremony/TpmCeremonyCore.cs#L188)، [TCG Part 2 r1.38 §6.5.2](https://cdn.trustedcomputinggroup.org/production/TPM_Rev_2_0_Part_2_Structures_01_38_213d66fde1.pdf).

| الأمر/الكود | المقابض والمعاملات في النواة | نص المطابقة |
|---|---|---|
| `NV_DefineSpace / 0x12a` | owner، جلسة password؛ `TPM2B_AUTH` ثم `TPM2B_NV_PUBLIC` | [Part 3 r1.38 §31.3، جدول 205](https://cdn.trustedcomputinggroup.org/production/TPM_Rev_2_0_Part_3_Commands_01_38_f1ed38ee7e.pdf) |
| `NV_Increment / 0x134` | الفهرس مصدر تفويض ثم الفهرس الهدف؛ جلسة؛ لا معاملات | [Part 3 r1.38 §31.8، جدول 215](https://cdn.trustedcomputinggroup.org/production/TPM_Rev_2_0_Part_3_Commands_01_38_f1ed38ee7e.pdf) |
| `NV_Read / 0x14e` | الفهرس مرتين؛ جلسة؛ `UINT16 size=8, offset=0` | [Part 3 r1.38 §31.13، جدول 225](https://cdn.trustedcomputinggroup.org/production/TPM_Rev_2_0_Part_3_Commands_01_38_f1ed38ee7e.pdf) |
| `NV_ReadPublic / 0x169` | مقبض NV واحد؛ لا تفويض ولا معاملات | [Part 3 r1.38 §31.6، جدول 211](https://cdn.trustedcomputinggroup.org/production/TPM_Rev_2_0_Part_3_Commands_01_38_f1ed38ee7e.pdf) |
| `NV_UndefineSpace / 0x122` | owner ثم الفهرس؛ password للـowner | [Part 3 r1.38 §31.4، جدول 207](https://cdn.trustedcomputinggroup.org/production/TPM_Rev_2_0_Part_3_Commands_01_38_f1ed38ee7e.pdf) |
| `CreatePrimary / 0x131` | owner؛ password؛ sensitive ثم public ثم outsideInfo فارغ وPCR count صفر | [Part 3 r1.38 §24.1، جدول 157](https://cdn.trustedcomputinggroup.org/production/TPM_Rev_2_0_Part_3_Commands_01_38_f1ed38ee7e.pdf) |
| `Create / 0x153` | parent؛ password؛ ترتيب المعاملات نفسه | [Part 3 r1.38 §12.1، جدول 19](https://cdn.trustedcomputinggroup.org/production/TPM_Rev_2_0_Part_3_Commands_01_38_f1ed38ee7e.pdf) |
| `Load / 0x157` | parent؛ password؛ private ثم public بحجميهما | [Part 3 r1.38 §12.2، جدول 21](https://cdn.trustedcomputinggroup.org/production/TPM_Rev_2_0_Part_3_Commands_01_38_f1ed38ee7e.pdf) |
| `Sign / 0x15d` | key؛ password؛ digest ثم ECDSA/SHA256 ثم تذكرة HASHCHECK/NULL فارغة | [Part 3 r1.38 §20.2، جدول 99](https://cdn.trustedcomputinggroup.org/production/TPM_Rev_2_0_Part_3_Commands_01_38_f1ed38ee7e.pdf) |
| `StartAuthSession / 0x176` | NULL، NULL؛ nonce بحجم32، salt فارغ، نوع trial/policy، symmetric=NULL، SHA256 | [Part 3 r1.38 §11.1، جدول 15](https://cdn.trustedcomputinggroup.org/production/TPM_Rev_2_0_Part_3_Commands_01_38_f1ed38ee7e.pdf) |
| `PolicySigned / 0x160` | authObject ثم policySession؛ nonce، cpHash فارغ، policyRef فارغ، expiration=0، توقيع ECDSA | [Part 3 r1.38 §23.3، جدول 117](https://cdn.trustedcomputinggroup.org/production/TPM_Rev_2_0_Part_3_Commands_01_38_f1ed38ee7e.pdf) |
| `PolicyCommandCode / 0x16c` | policySession؛ `UINT32 code` | [Part 3 r1.38 §23.11، جدول 133](https://cdn.trustedcomputinggroup.org/production/TPM_Rev_2_0_Part_3_Commands_01_38_f1ed38ee7e.pdf) |
| `PolicyGetDigest / 0x189` | policySession؛ لا معاملات أخرى | [Part 3 r1.38 §23.19، جدول 149](https://cdn.trustedcomputinggroup.org/production/TPM_Rev_2_0_Part_3_Commands_01_38_f1ed38ee7e.pdf) |
| `FlushContext / 0x165` | لا handle area؛ `flushHandle` في **منطقة المعاملات**؛ لا جلسات | [Part 3 r1.38 §28.4، جدول 191 والملاحظة قبله](https://cdn.trustedcomputinggroup.org/production/TPM_Rev_2_0_Part_3_Commands_01_38_f1ed38ee7e.pdf) |
| `GetCapability / 0x17a` | بلا مقابض أو جلسات؛ `capability, property, propertyCount` جميعها حقول32 بت | [Part 3 r1.38 §30.2، جدول 201](https://cdn.trustedcomputinggroup.org/production/TPM_Rev_2_0_Part_3_Commands_01_38_f1ed38ee7e.pdf) |

صيغة password ذات nonce فارغ و`continueSession=1` ليست تجاوزاً خاصاً بـlibtpms؛ Part 1 r1.38 §19.4 يجيز هذا البت ويتجاهل أثره لجلسة password، وPart 2 r1.38 §8.4 يوضح ذلك؛ أما جلسة السياسة فتستخدم nonce جديداً و`continueSession=0` وHMAC فارغاً، ولا تضيف الأداة `PolicyAuthValue` أو `PolicyPassword`. [النواة:160–168،815–821](../../xuux-review-50518cf6/sim/tpm-ceremony/TpmCeremonyCore.cs#L160)، [TCG Part 1 r1.38 §19.4](https://cdn.trustedcomputinggroup.org/production/TPM_Rev_2_0_Part_1_Architecture_01_38_425d4a82aa.pdf)، [TCG Part 2 r1.38 §8.4](https://cdn.trustedcomputinggroup.org/production/TPM_Rev_2_0_Part_2_Structures_01_38_213d66fde1.pdf).

وقبول HMAC فارغ هنا ليس خصوصية للمحاكي: Part 1 r1.38 §19.6.15 يجيزه عندما تكون sessionKey فارغة، كما في bind=NULL وtpmKey=NULL، ولا تستخدم السياسة authValue؛ لكنه لا يلغي وجوب بنية تفويض الرد نفسها، وهو ما أخفق المحلل في فرضه. [TCG Part 1 r1.38 §19.6.15،No HMAC Authorization](https://cdn.trustedcomputinggroup.org/production/TPM_Rev_2_0_Part_1_Architecture_01_38_425d4a82aa.pdf)، [TCG Part 2 r1.38 §10.13.3](https://cdn.trustedcomputinggroup.org/production/TPM_Rev_2_0_Part_2_Structures_01_38_213d66fde1.pdf)، [خرج الرد الناقص](probe-missing-response-auth.jsonl).

القالبان ECC/P256 يستخدمان `TPMT_PUBLIC` بالترتيب الصحيح؛ أوّلي التخزين restricted/decrypt مع AES128/CFB وscheme=NULL، ومفتاح الخدمة sign غير مقيّد مع symmetric=NULL وECDSA/SHA256 وKDF=NULL؛ و`inSensitive` حجمه الداخلي أربعة بايتات لا صفر، لأنه يحمل حجمي userAuth وdata الفارغين؛ وتذكرة `Sign` الفارغة مناسبة للمفتاح غير المقيّد. [النواة:221–245،284–302](../../xuux-review-50518cf6/sim/tpm-ceremony/TpmCeremonyCore.cs#L221)، [TCG Part 2 r1.38 §§11.1.15–11.1.16،12.2.3.6،12.2.4،10.7.6](https://cdn.trustedcomputinggroup.org/production/TPM_Rev_2_0_Part_2_Structures_01_38_213d66fde1.pdf)، [TCG Part 3 r1.38 §20.2](https://cdn.trustedcomputinggroup.org/production/TPM_Rev_2_0_Part_3_Commands_01_38_f1ed38ee7e.pdf).

**الاستنتاج:** لم أجد عيباً محدداً في ترميز الطلبات المستخدمة يقتضي أن يقبلها libtpms وحده، لكن ذلك ليس قياس توافق مع مصنع ثانٍ؛ دعم المنحنيات والأوامر والموارد وتفويض Windows أمور منفصلة عن صحة تسلسل البايتات. [جداول المطابقة أعلاه](spec-excerpts.txt)، [حدود الوثيقة](../../xuux-review-50518cf6/docs/adr/0007-tpm-nv-counter-freshness-anchor-design.md#L411).

العيب المرصود في الجانب المقابل: `Resp.Parse` لا يتحقق من وسم الرد ولا من وجود/عدد بنى تفويض الرد، ولا يربط الرد بشكل الطلب؛ والمسباران قبلا حزم الردود المشوّهة، خلاف اشتراط تساوي وسم النجاح مع الطلب في Part 3 r1.38 §6.1، ووجود تفويضات رد النجاح بالعدد نفسه في Part 2 r1.38 §10.13.3؛ لا يكفي فحص طول الرأس أو `responseSize` لإثبات رفض التشويه. [النواة:412–434](../../xuux-review-50518cf6/sim/tpm-ceremony/TpmCeremonyCore.cs#L412)، [مسبار الوسم](probe-invalid-tag.jsonl)، [مسبار منطقة التفويض](probe-missing-response-auth.jsonl)، [TCG Part 3 r1.38 §6.1](https://cdn.trustedcomputinggroup.org/production/TPM_Rev_2_0_Part_3_Commands_01_38_f1ed38ee7e.pdf)، [TCG Part 2 r1.38 §10.13.3](https://cdn.trustedcomputinggroup.org/production/TPM_Rev_2_0_Part_2_Structures_01_38_213d66fde1.pdf).

### 2. السمات والأسماء والأحجام

**ما قسته:** قيمة سمات المرساة `0x02040018` عند التعريف و`0x22040018` بعد الكتابة؛ `nameAlg=0x000b`، والحجم ثمانية بايتات، وauthPolicy بحجم32 يساوي بصمة التجربة، والاسم يتغير مع `WRITTEN`؛ أما سبر S1 فيستخدم عمداً `0x02040014`، أي AUTHWRITE بدلاً من POLICYWRITE. [البروفة](rehearsal.json)، [فحوص الاختبار:102–122](../../xuux-review-50518cf6/tests/sim/tpm-ceremony-rehearsal.test.mjs#L102).

هذا يحقق البتات المذكورة في ADR §4.1: COUNTER/POLICYWRITE/AUTHREAD/NO_DA، مع ORDERLY وPOLICY_DELETE وAUTHWRITE صفراً؛ ودلالات هذه البتات مثبتة في Part 2 r1.38 §13.4 جدول204، كما يوجب Part 3 r1.38 §31.3 حجم8 للعداد. [ADR:50–60](../../xuux-review-50518cf6/docs/adr/0007-tpm-nv-counter-freshness-anchor-design.md#L50)، [النواة:88–93](../../xuux-review-50518cf6/sim/tpm-ceremony/TpmCeremonyCore.cs#L88)، [TCG Part 2 r1.38 §13.4](https://cdn.trustedcomputinggroup.org/production/TPM_Rev_2_0_Part_2_Structures_01_38_213d66fde1.pdf)، [TCG Part 3 r1.38 §31.3](https://cdn.trustedcomputinggroup.org/production/TPM_Rev_2_0_Part_3_Commands_01_38_f1ed38ee7e.pdf).

يفحص `Define` الفهرس والخوارزمية والسمات **بالمساواة الدقيقة** والحجم والسياسة والاسم، ويفحص `UndefineOwn` المنطقة العامة مع تجاهل WRITTEN فقط؛ لذلك فجوة البتات المحجوزة في Node لا تعني أن النواة تسمح بها في نتيجة التعريف العادية، لكنها تنقض وصف مدقق Node بأنه يفحص جميع البتات؛ البتات `9:8` و`24:20` يجب أن تكون صفراً وفق جدول204. [النواة:668–706](../../xuux-review-50518cf6/sim/tpm-ceremony/TpmCeremonyCore.cs#L668)، [مدقق Node:70–84](../../xuux-review-50518cf6/sim/tpm-ceremony/policy_digest.mjs#L70)، [خرج البتات](openssl-digest-probe.json)، [TCG Part 2 r1.38 §13.4 جدول204](https://cdn.trustedcomputinggroup.org/production/TPM_Rev_2_0_Part_2_Structures_01_38_213d66fde1.pdf).

صيغة الاسم `nameAlg || H(publicArea)`، من دون بادئة حجم TPM2B، وتغير اسم NV عند ضبط WRITTEN يطابقان Part 1 r1.38 §16 جدول3 ومثاله؛ وهما ليسا تغيراً في هوية المفتاح العام نفسه. [TCG Part 1 r1.38 §16](https://cdn.trustedcomputinggroup.org/production/TPM_Rev_2_0_Part_1_Architecture_01_38_425d4a82aa.pdf)، [صيغة النواة:333–335](../../xuux-review-50518cf6/sim/tpm-ceremony/TpmCeremonyCore.cs#L333)، [إعادة حساب Node](../../xuux-review-50518cf6/tests/sim/tpm-ceremony-rehearsal.test.mjs#L116).

**الفرق الذي تخفيه البروفة:** AUTHREAD لا يعني غياب منطقة التفويض، بل قبول authValue الفهرس، وقد عُرّف هنا فارغاً؛ وهذا يحقق «قراءة بلا سر» محلياً، لكنه لا يختبر سماح Windows TBS لعميل معين بإرسال NV_Read؛ كذلك `_ownerAuth` الفارغ ثابت في البروفة ولا يثبت امتلاك تفويض هرم التخزين على المضيف. [النواة:513،668–686](../../xuux-review-50518cf6/sim/tpm-ceremony/TpmCeremonyCore.cs#L513)، [TCG Part 2 r1.38 §13.4،بت18](https://cdn.trustedcomputinggroup.org/production/TPM_Rev_2_0_Part_2_Structures_01_38_213d66fde1.pdf)، [الحدود المعلنة](../../xuux-review-50518cf6/sim/tpm-ceremony/README.md#L39).

وبالمثل فإن مفتاح الخدمة في المحاكي له USERWITHAUTH وauthValue فارغ، ويُستعمل عبر `Sign` بتفويض password فارغ؛ هذه البروفة لا تقيس حصرية حساب الخدمة أو واصف أمان Windows، ولا ينبغي الخلط بين fixedTPM/fixedParent وبين سياسة وصول نظام التشغيل. [القالب والاستدعاء](../../xuux-review-50518cf6/sim/tpm-ceremony/TpmCeremonyCore.cs#L294)، [SignAHash](../../xuux-review-50518cf6/sim/tpm-ceremony/TpmCeremonyCore.cs#L726)، [TCG Part 2 r1.38 §§8.3.3.2،8.3.3.4،8.3.3.6](https://cdn.trustedcomputinggroup.org/production/TPM_Rev_2_0_Part_2_Structures_01_38_213d66fde1.pdf).

### 3. استقلال بصمة السياسة

**المواصفة التي قرأتها:** Part 3 r1.38 §23.2.3، معادلتان10 و11، يحدّث البصمة بتجزئتين؛ حجم arg2 وarg3 لا يدخل التجزئة؛ §23.3،معادلة14 يختار `PolicySigned` واسم المفتاح وpolicyRef؛ و§23.11،معادلة26 يضيف كود الأمر المقيد. [TCG Part 3 r1.38 §§23.2.3،23.3،23.11](https://cdn.trustedcomputinggroup.org/production/TPM_Rev_2_0_Part_3_Commands_01_38_f1ed38ee7e.pdf).

للحالة هنا تكون الصيغة، مع SHA256 وpolicyRef الفارغ:

\[
d_1=H(0^{32}\parallel \mathrm{BE32}(0x160)\parallel Name),\quad
d_2=H(d_1),\quad
d_3=H(d_2\parallel \mathrm{BE32}(0x16c)\parallel \mathrm{BE32}(0x134)).
\]

التجزئة الثانية تبقى موجودة حتى عندما يكون policyRef فارغاً؛ وهذا بالضبط ما تنفذه النواة وNode، وما أعاد حسابه مسباري عبر OpenSSL؛ حذفها يعطي `4df020ca7ed1318c387be079b5d27dc41ce489e171513da23a3689dde51a25ec` بدلاً من بصمة البروفة. [النواة:312–325](../../xuux-review-50518cf6/sim/tpm-ceremony/TpmCeremonyCore.cs#L312)، [Node:39–52](../../xuux-review-50518cf6/sim/tpm-ceremony/policy_digest.mjs#L39)، [نتائج OpenSSL](openssl-digest-probe.json)، [TCG Part 3 r1.38 §23.2.3](https://cdn.trustedcomputinggroup.org/production/TPM_Rev_2_0_Part_3_Commands_01_38_f1ed38ee7e.pdf).

**درجة الاستقلال:** Node لا يستدعي C# ولا يستورد دواله، بل يستخدم `node:crypto`؛ الاختبار يأخذ اسم المفتاح من نتيجة TPM ثم يعيد حساب الاسم من publicArea، ويقارن حساب Node مع بصمة جلسة trial ومع صيغة C#، وليس مع إعادة تنفيذ نداء C# نفسه؛ لكن لا يمكن استنتاج استقلال المؤلفين أو مسار اشتقاق الصيغة من مجرد اختلاف اللغة، لأن منطق التجزئة متشابه بالضرورة هنا. [ملف Node](../../xuux-review-50518cf6/sim/tpm-ceremony/policy_digest.mjs)، [الاختبار:80–98](../../xuux-review-50518cf6/tests/sim/tpm-ceremony-rehearsal.test.mjs#L80).

ودليل tpm2-tools أضيق: يبدأ trial مستقلة من صفر ويختبر **PolicyCommandCode وحده**؛ لا يبني السلسلة السابقة كلها ولا يختبر PolicySigned بواسطة أدوات ثانية، كما أن الأدوات تستعلم المحاكي نفسه، فلا تُعدّ شريحة ثانية؛ أما مسبار OpenSSL فيضيف مسار تركيب وحساب منفصلاً للسلسلة المعنية من دون استدعاء دوال السياسة في حسابه، ولا أدعي بذلك اختلاف المكتبة التشفيرية الأساسية التي قد يشترك فيها Node وOpenSSL. [الاختبار:91–99](../../xuux-review-50518cf6/tests/sim/tpm-ceremony-rehearsal.test.mjs#L91)، [مسبار OpenSSL](openssl-digest-probe.mjs)، [خرجه](openssl-digest-probe.json).

وجلسة trial لا تفحص صحة التوقيع أصلاً وفق Part 3 r1.38 §23.3؛ الدليل على التوقيع الفعلي يأتي من جلسات policy والزيادة الإيجابية ورفض الإعادة، لا من مساواة trial وحدها. [TCG Part 3 r1.38 §23.3](https://cdn.trustedcomputinggroup.org/production/TPM_Rev_2_0_Part_3_Commands_01_38_f1ed38ee7e.pdf)، [خطوات البروفة](rehearsal.json).

### 4. الفشل المغلق والتنظيف والتعافي

**ما قسته وما لا يصح تعميمه:** حالات الحقن الخمس الأصلية تتوقف عند أول رفض محقون، ولا تُرسل بعدها إلا أوامر التنظيف؛ وتستعيد عدد فهارس NV في تلك الحالات؛ لكنها تحقن الخطأ **قبل إرسال الأمر**، وتحقنه عند الظهور الأول فقط، ولا تختبر نتيجة أمر تغييري نُفّذ ثم فُقد الرد، ولا تشويه الردود، ولا رفض FlushContext. [الاختبارات:141–169](../../xuux-review-50518cf6/tests/sim/tpm-ceremony-rehearsal.test.mjs#L141)، [BlockingTransport:32–45](../../xuux-review-50518cf6/tests/helpers/TpmCeremonyFaultTransport.cs#L32)، [خرج الاختبارات](tests.log).

التعرف على `0x8028xxxx` يسبق مسار «الرفض المتوقع»، وأي رمز غير صفري في موضع نجاح يوقف المسار بلا بديل؛ أما في موضع `Refused` فيُقبل **أي** رمز غير صفري غير هذه العائلة، ولذلك أُخذ `0x101` على أنه دليل رفض إعادة التوقيع مع أنه حُقن بدلاً من الاختبار؛ هذا عيب في حجية الاختبارات السلبية، وليس مشاهدة زيادة عداد غير مأذونة. [النواة:532–564](../../xuux-review-50518cf6/sim/tpm-ceremony/TpmCeremonyCore.cs#L532)، [خرج الخطأ غير المتوقع](probe-unexpected-negative.jsonl).

التوقف بعد الانقطاع قائم، لكن إعلان البقايا غير كاف: يسجل `Define` الفهرس في `_definedByRun` **بعد** رجوع `Ok`، فمسبار فقد رد تعريف ناجح ترك فهرساً موجوداً ولم يعلنه `cleanupLeftovers`؛ لا يوجد في التقرير حينها حتى سجل بالمقبض المرشح لتوجيه التعافي. [النواة:668–680](../../xuux-review-50518cf6/sim/tpm-ceremony/TpmCeremonyCore.cs#L668)، [مسبار فقد الرد](probe-define-response-loss.jsonl).

وهذه نتيجة مستقلة عن الفشل السابق: `Flush` يزيل المقبض من قائمة `_transients` **قبل** إرسال التحرير، فرفض تحرير جلسة trial تركها حية في الجرد المستقل، بينما لا تظهر في البقايا ولا يعيد Cleanup النظر فيها. [النواة:717–721،882–887](../../xuux-review-50518cf6/sim/tpm-ceremony/TpmCeremonyCore.cs#L717)، [مسبار رفض التحرير](probe-flush-refusal.jsonl).

التنظيف الاعتيادي مقيد بقاموس ما سجلته البروفة، ويتحقق من publicArea قبل حذف NV، ولا يختار فهرساً آخر عند الرفض؛ ومع ذلك فمطابقة الشكل ليست برهان ملكية فريد لجولة التشغيل، خاصة في S1 ذي السياسة الفارغة، والفاصل بين الفحص والحذف غير ذري؛ إذا وُجد طرف آخر يملك تفويض الهرم ويحذف/يعيد تعريف المقبض نفسه، فلا تثبت هذه المقارنة وحدها أن الفهرس الحالي من إنشاء الجولة؛ هذا استنتاج تزامن لم أختبره على عتاد. [النواة:628–645،694–706](../../xuux-review-50518cf6/sim/tpm-ceremony/TpmCeremonyCore.cs#L628).

كما أن عبارة «بلا إعادة» لها استثناء فعلي: رفض `NV_UndefineSpace` في المسار العادي يتبعه طلب الحذف نفسه أثناء Cleanup؛ الاختبار وتعليق README يذكران ذلك، لكنه غير مذكور في العبارة المختصرة بنموذج التهديد. [الاختبار:158–164](../../xuux-review-50518cf6/tests/sim/tpm-ceremony-rehearsal.test.mjs#L158)، [README:45–46](../../xuux-review-50518cf6/sim/tpm-ceremony/README.md#L45)، [نموذج التهديد:273–275](../../xuux-review-50518cf6/docs/THREAT_MODEL.md#L273).

**المعالجة المطلوبة:** دفتر مرشحات قبل إرسال الأوامر المنشئة مع حالة «النتيجة مجهولة»، وإظهار موارد محتملة حتى عند فقد الرد، وإزالة موارد التحرير من التتبع بعد نتيجة ملائمة لا قبلها، ومدقق ردود مربوط بشكل الأمر، وقوائم أكواد متوقعة لكل اختبار سلبي؛ ولا أوصي بإعادة زيادة أو بحذف تلقائي أعمى عند النتيجة المجهولة، بل بتوقف مع دليل تعافٍ يخضع لقرار المالك.

### 5. عدم الوصول إلى العتاد وهوية المحاكي وحارس المضيف

**المسار الموجود:** مُشغّل البروفة يحمل ملف النواة وحده وينشئ `SwtpmLoopbackTransport`؛ هذا النقل يقبل حرفياً `127.0.0.1` أو `::1` فقط، ولا يوجد فيه TBS أو فتح جهاز أو اختيار نقل بديل؛ ويُنفذ استعلام الهوية قبل S1/S2؛ الاختبارات رفضت المضيفين غير المقبولين وهوية IFX قبل أي أمر تغييري. [المشغّل:15–37](../../xuux-review-50518cf6/sim/tpm-ceremony/rehearse.ps1#L15)، [النقل:347–386](../../xuux-review-50518cf6/sim/tpm-ceremony/TpmCeremonyCore.cs#L347)، [الاختبارات](tests.log).

فحص `IBM` مع vendorString بعد إزالة المسافات يرفض الهوية الأخرى المقاسة، لكنه **علامة تعريف ذاتية لا مصادقة على الطرف المقابل**؛ يمكن لنقل اختباري أو وسيط محلي أن يرسل هذه الخصائص؛ و`ICeremonyTransport` واجهة عامة لا تشترط نوع المحاكي في مُنشئ `CeremonyRehearsal`؛ لذلك الاستنتاج الدقيق هو غياب مسار عتاد مباشر في المُشغّل الحالي، لا استحالة وضع وكيل محلي أو برنامج مختلف وراء منفذ loopback. [الهوية:567–583](../../xuux-review-50518cf6/sim/tpm-ceremony/TpmCeremonyCore.cs#L567)، [الواجهة والمُنشئ:340–344،519–523](../../xuux-review-50518cf6/sim/tpm-ceremony/TpmCeremonyCore.cs#L340).

اختبار الحارس الأصلي يثبت رفض 15 **حالة مختارة** تشمل أوامر التغيير والسياسات والتوقيع والقراءة المصرح بها؛ لكنه لا يثبت رفض كل أمر تُرسله البروفة، إذ لا يولّد emitter حالتي `GetCapability` و`NV_ReadPublic`، وهما مسموحتان عمداً في حارس الجرد؛ عرضتهما مستقلاً على النقل التسجيلي وبلغتاه، من دون TBS. [Emitter:72–93](../../xuux-review-50518cf6/tests/helpers/TpmCeremonyFaultTransport.cs#L72)، [حارس الجرد:67–101](../../xuux-review-50518cf6/sim/tpm-host/TpmInventoryCore.cs#L67)، [خرج المسبار](host-guard-probe.json).

وعليه فعبارة «يرفض كل أمر تبنيه البروفة» في ADR §12.1 ونموذج التهديد أوسع من القياس؛ العبارة المناسبة هي رفض الأشكال غير المسموح بها، وبالأخص أوامر التغيير/السياسة، مع استمرار السماح باستعلامَي الجرد؛ لم أجد في ذلك مسار تمرير لأمر تغييري إلى حارس المضيف. [ADR:407](../../xuux-review-50518cf6/docs/adr/0007-tpm-nv-counter-freshness-anchor-design.md#L407)، [نموذج التهديد:275](../../xuux-review-50518cf6/docs/THREAT_MODEL.md#L275)، [الحارس](../../xuux-review-50518cf6/sim/tpm-host/TpmInventoryCore.cs#L79).

التقرير المعتاد يخرج SHA256 لكل طلب ولا يخرج بايتات الطلب، وfacts تتضمن مناطق عامة وأسماء وبصمات لا private blob ولا تواقيع مسلسلة؛ لا توجد فيه حزمة أوامر خام لإعادة إرسالها؛ هذا لا يجعل منشئ `Cmd` ذاته غير قابل لإعادة الاستخدام في برنامج آخر، لأن وظيفته أصلاً إنتاج بايتات الأوامر. [Send:532–540](../../xuux-review-50518cf6/sim/tpm-ceremony/TpmCeremonyCore.cs#L532)، [ToJson:475–504](../../xuux-review-50518cf6/sim/tpm-ceremony/TpmCeremonyCore.cs#L475)، [التقرير المقيس](rehearsal.json)، [Cmd](../../xuux-review-50518cf6/sim/tpm-ceremony/TpmCeremonyCore.cs#L158).

### 6. الحدود والفصل بين المقيس والمقترح وما يلزم قبل S1

الوثائق تميز بوضوح بين المحاكي والعتاد، وتنص على بقاء `R3-A-01` و`EXT-6` مفتوحين، وعدم تفعيل مصدر حداثة إنتاجي، واشتراط إذن جديد لكل مرحلة؛ وجدول §12.1 يصف تساوي البصمات وأكواد الحالات الطبيعية وصفاً يتفق مع تشغيلتي، ويصرح بأن مقارنة tpm2-tools جزئية. [ADR:389–422](../../xuux-review-50518cf6/docs/adr/0007-tpm-nv-counter-freshness-anchor-design.md#L389)، [README:39–47](../../xuux-review-50518cf6/sim/tpm-ceremony/README.md#L39)، [نموذج التهديد:264–280](../../xuux-review-50518cf6/docs/THREAT_MODEL.md#L264)، [البروفة](rehearsal.json).

لكن عبارات README:32–34 «أي رمز غير متوقع» و«أي بقية تعلن»، ونموذج التهديد:273–275 «بلا إعادة» ورفض «كل أمر»، ووصف فحص Node «بتاً بتاً»، أوسع من الأدلة بعد المسابر الحالية؛ ينبغي تضييقها أو إضافة فحوص تتناول النتائج المرصودة بدلاً من اعتماد تشغيل عادي وحده. [README:32–34](../../xuux-review-50518cf6/sim/tpm-ceremony/README.md#L32)، [نموذج التهديد](../../xuux-review-50518cf6/docs/THREAT_MODEL.md#L273)، [ADR:401–407](../../xuux-review-50518cf6/docs/adr/0007-tpm-nv-counter-freshness-anchor-design.md#L401)، [مسبار فقد الرد](probe-define-response-loss.jsonl)، [مسبار التحرير](probe-flush-refusal.jsonl)، [مسبار الخطأ السلبي](probe-unexpected-negative.jsonl)، [مسبار البتات](openssl-digest-probe.json).

أوصي بأن يُشترط قبل **طلب** إذن S1 على الشريحة، لا أن تنفذه هذه المراجعة:

1. معالجة نتائج التعقب والردود المشوهة والرفض غير المتوقع، ثم إعادة المسابر على كوميت محدد، مع حقن فقد الرد بعد التنفيذ عند التعريف والزيادة والإنشاء والتحميل، ورفض التنظيف المستمر لا لمرة واحدة فقط.
2. نص إذن جديد للمالك يحدد المضيف، والمرحلة S1 وحدها، والسمات والحجم والخطوات وحدود الأثر والتوقف؛ فصل ذلك عن أي إذن لـS2/S3/S4/S5.
3. جرد حديث للقراءة فقط، وإثبات مصدر وصلاحية **تفويض هرم التخزين** الفعلي، لا افتراض أن حالة ملكية Windows أو صلاحية المدير تكفي؛ والتوقف إن لم يكن التفويض متاحاً من دون طلب مسح أو تغيير تفويض.
4. خطة استبعاد التزامن أثناء المراسم وتعقب المقبض المرشح قبل إرسال التعريف، وإجراء مراجعة بشرية عند أثر مجهول؛ توضيح متى يسمح إذن المرحلة بالحذف ومتى يقتضي التوقف تدخلاً منفصلاً، وعدم إعادة الزيادة.
5. دليل سماح/رفض Windows TBS لكل أمر مطلوب على المضيف المقصود وبالهوية التشغيلية المقصودة، من دون توسيع قائمة السماح لتجاوز رفض، وبيان أثر الفشل على BitLocker وHello والموارد المشتركة.
6. إدراك أثر استهلاك خانة NV والتحمل ورفع أعلى قيمة عداد حتى بعد حذف فهرس السبر؛ تخصيص أدلة الانقطاع الكهربائي والرتابة وإعادة التعريف على الشريحة للمراحل المأذونة لاحقاً، وعدم نسبتها لتجربة swtpm.

هذه توصيات تشغيلية للمراجعة؛ مصادر القيود التصميمية هي §4.1 و§11.2 و§12.2، أما وجوب حجم8 وحفظ الحالة فور نجاح أمر التحديث عند ORDERLY=0، ونمو العداد الجديد فوق القيم السابقة، فهي أحكام مواصفة لا قياس SLB9670: Part 2 r1.38 §13.4، وPart 3 r1.38 §31.2 و§31.3. [ADR §4.1](../../xuux-review-50518cf6/docs/adr/0007-tpm-nv-counter-freshness-anchor-design.md#L50)، [ADR §11.2](../../xuux-review-50518cf6/docs/adr/0007-tpm-nv-counter-freshness-anchor-design.md#L369)، [ADR §12.2](../../xuux-review-50518cf6/docs/adr/0007-tpm-nv-counter-freshness-anchor-design.md#L411)، [TCG Part 2 r1.38 §13.4](https://cdn.trustedcomputinggroup.org/production/TPM_Rev_2_0_Part_2_Structures_01_38_213d66fde1.pdf)، [TCG Part 3 r1.38 §§31.2–31.3](https://cdn.trustedcomputinggroup.org/production/TPM_Rev_2_0_Part_3_Commands_01_38_f1ed38ee7e.pdf).

## النتائج

تقدير الخطورة أدناه يراعي أداة محاكاة قد تُستعمل أدلتها لاحقاً لطلب إذن مرحلة تغيّر حالة العتاد؛ لا يدّعي أي صف استغلالاً مقيساً على شريحة.

| المعرّف | الخطورة | الموضع (ملف:سطر) | الوصف | الدليل | التصنيف |
|---|---|---|---|---|---|
| SOL-01 | متوسطة | `sim/tpm-ceremony/TpmCeremonyCore.cs:412–434` | قبول وسم رد غير صالح وغياب بنى تفويض الرد؛ لا يتوقف المسار عند هذين التشويهين. | [50 وسماً مشوهاً](probe-invalid-tag.jsonl)، [25 منطقة تفويض محذوفة](probe-missing-response-auth.jsonl)، [Part 3 r1.38 §6.1](https://cdn.trustedcomputinggroup.org/production/TPM_Rev_2_0_Part_3_Commands_01_38_f1ed38ee7e.pdf)، [Part 2 r1.38 §10.13.3](https://cdn.trustedcomputinggroup.org/production/TPM_Rev_2_0_Part_2_Structures_01_38_213d66fde1.pdf) | قياس محاكٍ |
| SOL-02 | عالية | `sim/tpm-ceremony/TpmCeremonyCore.cs:671–672,873–880` | فقد رد تعريف نُفذ فعلاً يترك NV خارج سجل الجولة، ولا تظهر البقية ولا المقبض المرشح في التقرير؛ الحالة تغيّرية مجهولة لا يغطيها الحقن الأصلي. | [مسبار فقد رد التعريف](probe-define-response-loss.jsonl)، [الشيفرة المستقلة](IndependentProbe.cs) | قياس محاكٍ؛ أثره على تعافي العتاد استنتاج |
| SOL-03 | متوسطة | `sim/tpm-ceremony/TpmCeremonyCore.cs:717–721,882–887` | حذف مقبض التحرير من التتبع قبل نتيجة الأمر يخفي جلسة باقية عند الرفض. | [جلسة `0x03000000` وبقايا معلنة فارغة](probe-flush-refusal.jsonl) | قياس محاكٍ |
| SOL-04 | متوسطة | `sim/tpm-ceremony/TpmCeremonyCore.cs:555–559`؛ `tests/sim/tpm-ceremony-rehearsal.test.mjs:132–136` | كل خطأ غير صفري تقريباً يُعد رفضاً متوقعاً في الاختبار السلبي؛ يمكن استبدال رفض التوقيع بعطل عام من دون فشل المراسم. | [حقن `0x101` بدل فحص الإعادة](probe-unexpected-negative.jsonl) | قياس محاكٍ |
| SOL-05 | منخفضة | `sim/tpm-ceremony/policy_digest.mjs:70–84` | عدم فحص سبعة بتات محجوزة؛ مدقق Node ليس فحصاً لجميع البتات، مع بقاء مقارنة C# الدقيقة حاجزاً في مسار التعريف العادي. | [الحالات السبع](openssl-digest-probe.json)، [Part 2 r1.38 §13.4 جدول204](https://cdn.trustedcomputinggroup.org/production/TPM_Rev_2_0_Part_2_Structures_01_38_213d66fde1.pdf) | قياس دالة محلية + استنتاج |
| SOL-06 | منخفضة | `tests/helpers/TpmCeremonyFaultTransport.cs:72–93`؛ ADR:407؛ THREAT_MODEL:273–275؛ README:32–34 | المولد يغفل أمري الجرد المسموحين؛ وعبارات «كل أمر» و«أي بقية» و«أي رمز غير متوقع» و«بلا إعادة» تحتاج حدوداً واستثناء حذف التنظيف. | [مسبار الحارس](host-guard-probe.json)، [SOL-02](probe-define-response-loss.jsonl)، [SOL-03](probe-flush-refusal.jsonl)، [SOL-04](probe-unexpected-negative.jsonl)، [اختبار استثناء الحذف](../../xuux-review-50518cf6/tests/sim/tpm-ceremony-rehearsal.test.mjs#L163) | قياس محلي + استنتاج توثيقي |
| SOL-07 | ملاحظة | `sim/tpm-ceremony/TpmCeremonyCore.cs:567–583,694–706` | خصائص IBM/SW TPM غير موثّقة الهوية تشفيرياً، ومطابقة publicArea لا تميز إعادة تعريف مماثلة من طرف يملك تفويض الهرم؛ يلزم ضبط الطرف المحلي والتزامن قبل أي نقل عتادي مقترح. | [فحص الهوية والحذف](../../xuux-review-50518cf6/sim/tpm-ceremony/TpmCeremonyCore.cs#L567) | استنتاج؛ لا تجربة عتاد |

## الحدود

- لم أختبر Windows PowerShell 5.1 أو TBS الحقيقي أو صلاحيات حساب خدمة Windows أو SLB9670، ولم أختبر إعادة التشغيل أو انقطاع الطاقة؛ بناء C#5 على Mono ليس بديلاً عن تلك البيئات. [سجل البناء](independent-run.log)، [البيئة](environment.log).
- لم أجرِ مقابلة مع تطبيق TPM مستقل عن libtpms؛ ثلاثية الحسابات وOpenSSL تقوي فحص البصمة، لكنها لا تحول المحاكي إلى دليل سلوك شريحة، ومقارنة tpm2-tools الأصلية تخص PolicyCommandCode فقط. [الاختبار:91–99](../../xuux-review-50518cf6/tests/sim/tpm-ceremony-rehearsal.test.mjs#L91)، [خرج OpenSSL](openssl-digest-probe.json).
- `define-response-loss` يحاكي عدم تسليم الرد بعد التنفيذ بإلقاء استثناء في غلاف النقل، لا بفصل شبكة TCP فعلي؛ و`invalid-tag` و`missing-response-auth` يختبران مُحلل النواة عبر الواجهة نفسها بعد تعديل رد المحاكي، لا خادم شبكة مضاداً. [شيفرة المسابر](IndependentProbe.cs).
- شُغلت المسابر بالتتابع على المحاكي الخاص بي، ونُظفت فقط آثار المسبارين التي تعرفها شيفرتهما وبعد التقاطها؛ نتيجة المسارات الأصلية وحدها لا ينبغي أن تُقرأ على أنها دليل غياب بقايا عند أي عطل. [مسبار فقد الرد](probe-define-response-loss.jsonl)، [مسبار رفض التحرير](probe-flush-refusal.jsonl).
- قبل إيقاف المحاكي أعادت الاستعلامات الأربع لـNV والكائنات المؤقتة والجلسات المحملة والمحفوظة خرجاً فارغاً ورمز `0`؛ أُرسل `kill` إلى PID `19887` بالرمز `0`، ثم لم يوجد هذا PID ولا مستمع على2341/2342، وخرج حالة git صفر بايت؛ رسالة غياب ملف pid في الفحص الأول بعد الإيقاف تلت إزالة المحاكي ملف pid، ثم استُخدم رقم العملية المسجل نفسه للفحص الإضافي. [سجل النهاية](final-state.log)، [فحص الإيقاف](stop-confirmation.log).

## الحكم

**عوائقُ تلزمُ معالجتُها قبلَ طلبِ إذنِ S1 على العتاد.**

التعليل: التشغيل الأصلي يعرض 18 اختباراً بلا إخفاق، وترميز الطلبات وحساب السياسة والسمات المقيسة متسقة في الحالات العادية، لكن المسابر المستقلة أظهرت قبول ردود مشوهة، وفهرس NV وجلسة خارج إعلان البقايا عند عطلين مختلفين، وقبول خطأ عام باعتباره نتيجة اختبار توقيع سلبية؛ وهذه عوائق في حجية أدلة الفشل والتعافي التي يلزم الاستناد إليها قبل طلب نقل المراسم إلى الشريحة. [الاختبارات](tests.log)، [الردود المشوهة](probe-invalid-tag.jsonl)، [التفويض المفقود](probe-missing-response-auth.jsonl)، [فقد رد التعريف](probe-define-response-loss.jsonl)، [رفض التحرير](probe-flush-refusal.jsonl)، [الرفض غير المحدد](probe-unexpected-negative.jsonl).

هذا الحكم ليس إذناً بأي عملية عتادية، ولا يغلق `R3-A-01` أو `EXT-6`، ولا ينقل نتائج libtpms إلى Windows أو SLB9670.
