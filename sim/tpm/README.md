# sim/tpm — تجهيزات محاكي TPM (غير إنتاجية)

هذه التجهيزات أدوات **تحقّق ومحاكاة فقط** لتطوير والتحقق من تصميم جذر الثقة v3
الموسوم بـTPM (ADR 0007). **ليست كود إنتاج**، ولا تُحمّل كخدمة، ولا تُثبَّت
على Windows، ولا تتصل بـTPM حقيقي **افتراضياً**.

## ما يوفّره هذا الدليل

- `tcti_guard.mjs` — حارس قناة TPM. يرفض أي TCTI جهازي حقيقي
  (`device:/dev/tpm*`) أو شبكي غير محاكٍ، ويرفض المحارف غير الآمنة (حقن shell).
  المسار المسموح وحده: محاكيات `swtpm:` / `mssim:`.
- `tpm_client.mjs` — عميل NV لمحاكي swtpm. عمليات العدّاد فقط، argv آمن
  (مصفوفة، `shell:false`)، بلا تفسير shell.
- `getcap.mjs` — مساعد GetCapability بقائمة مسموحات ثابتة (allowlist) لا تقبل
  سوى قدرات `tpm2 getcap` المعروفة. لا يمكن تمرير أوامر كتابة أو وسائط shell.
- `manifest_seal_sim.mjs` — محاكاة جذر الثقة v3: مسار الختم الذرّي (ADR 0007
  §4.4) وقواعد التعافي، وعقد التحقق من شهادة TPM2_NV_Certify (محاكاة بنية
  الشهادة وعقد تحققها، لا أمر TPM حقيقي).
- `channel_protocol.mjs` — منطق بروتوكول قناة TCP (same-environment):
  تأطير، حد أقصى، كشف تشويه (crc16)، حماية من الإعادة (counter)، تحديد معدّل،
  وتحمّل انقطاع منتصف الرسالة.

## التشغيل

لا تُشغَّل هذه التجهيزات تلقائياً. الاختبارات في `tests/sim/**` تتطلّب تشغيل
`swtpm` يدوياً وضبط `XUUX_TPM_SIM=1` و`TPM2TOOLS_TCTI=swtpm:...`. في غيابهما
(حالة CI الافتراضية) **تُتخطّى الاختبارات المقيّدة بأمان** دون فشل.

## الحارس ضد TPM الحقيقي

أي استدعاء لـ`tpm_client`/`getcap` يمرّ عبر `assertSimulatorTcti` التي ترمي
`TCTI_REAL_OR_UNKNOWN` إن لم يكن TCTI محاكياً صريحاً. هذا يمنع اختيار TCTI
حقيقي في CI ومسار الاختبار الافتراضي.

## عقد رموز الحالة: TORN مقابل MISMATCH (WL-103)

توحيدٌ للتفاوت التسميوي بين جدول ADR 0007 §4.4 وقاعدته §4.8 — العقد الكامل
وأمثلته في `sim/channel/README.md`، وخلاصته:

- **`STATE_MANIFEST_TPM_TORN`** — تناقضٌ **داخليٌ بين ملفات جذر الحالة نفسها**
  (body/staged/التوكن البرمجي) لا يفسّره أي مسار تعافٍ صالح: staged لا يطابق
  نمطاً، أو توكنٌ لا يطابق المتن. القرار: إغلاقٌ فوريّ مع سببٍ دقيق.
- **`STATE_TPM_COUNTER_MISMATCH`** — تعارضُ **الملفّات المتّسقة داخلياً مع عدّاد
  TPM الخارجي**: إمّا replay (`body.counter <` العدّاد بأيّ فجوة، بما فيها أكثر
  من واحد) أو body-ahead (`body.counter >` العدّاد). القرار: إغلاقٌ دائمٌ مع
  direction.
- قاعدة الفصل: staged قابل للتفسير ⇒ تعافٍ §4.4؛ تناقض بين الملفات ⇒ TORN؛
  تناقض ملفاتٍ متّسقةٍ مع العتاد ⇒ MISMATCH. كلاهما إغلاقٌ لا إقلاع بعده،
  والقرار النهائي للتسمية لصاحب ADR 0007 (يبقى proposed).

## ما لا يُثبت هنا

- **AF_VSOCK** و**TCP/NAT** بين Windows وWSL2: غير مُثبَتَين على المضيف
  (أدوات PoC تشخيصية مؤقتة أُضيفت في `sim/channel/` — انظر مصفوفة الأدلة
  الكاملة وخطوات الاختبار المحلي في `sim/channel/README.md`؛ تُشغَّل بأمر
  المالك حصراً، أمراً واحداً في كل مرة).
- **سلوك TPM عبر `undefine`/`redefine` للعدّاد:** swtpm 0.10.1 لا يُصفّر العدّاد
  (يكمل من قيمته السابقة — مثال خام مُقاس: 0x12 قبل الحذف، 0x13 بعده). وهذا
  السلوك **مضمون بالمواصفة لا خاص بالمحاكي**: TPM 2.0 Library Part 3 §31.2
  (NV Counters): «When an NV counter is created, the TPM shall initialize the
  8-octet counter value with a number that is greater than any count value for
  any NV counter on the TPM since the time of TPM manufacture»، و Part 1
  §37.2.6.3 NOTE 2: «a counter with a particular Name cannot be rolled back by
  deleting it and redefining it». ومع ذلك يبقى ضمان ADR 0007 المضاد للإعادة
  معتمداً على مقارنة `body.counter` مع عدّاد TPM + ملف `staged` — دفاعٌ على
  الطبقة العليا لا اعتماداً وحيداً على رتابة العتاد.
- **TPM2_NV_Certify الحقيقي**: يتطلب إعداد EK/AK خارج نطاق هذا التحقيق غير
  الإنتاجي. تُحاكى بنية الشهادة وعقد تحققها فقط.
