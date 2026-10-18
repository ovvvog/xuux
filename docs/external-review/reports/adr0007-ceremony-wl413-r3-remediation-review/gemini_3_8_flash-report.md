# تقريرُ المراجعةِ المستقلّةِ — الدفعةُ الثالثةُ من معالجةِ عوائقِ WL-413 (`WL-414`)

**معرِّفُ المراجع:** `gemini_3_8_flash`  
**التاريخ:** 2026-10-18 (توقيتُ الرياض)  
**الكوميتُ المُراجَع:** `de099aa8cfd82dda106199eeaf11e134b5ee6639`  
**الفرع:** `wl-413-review-remediation` (PR #378، غيرُ مدموج)  
**شجرةُ المراجعة:** `/home/user/workspace/xuux-review-de099aa8`  
**المنفذُ المُسنَد:** 5700 (منفذُ التحكّم: 5701)  
**مجلدُ العملِ والمخرجات:** `/home/user/workspace/council-wl413-r3/gemini_3_8_flash/`

---

## 1. الفحصُ الأوّليُّ وتثبّتُ الشجرةِ والبيئةِ

1. **الكوميتُ المثبَّت:**
   - الأمر: `git rev-parse HEAD` داخل شجرةِ المراجعةِ `/home/user/workspace/xuux-review-de099aa8`.
   - المخرج: `de099aa8cfd82dda106199eeaf11e134b5ee6639`، مطابقٌ لما وردَ في [وثيقةِ التكليفِ brief.md](/home/user/workspace/council-wl413-r3/brief.md).
   - رمزُ الخروج: `0`.

2. **نظافةُ الشجرة:**
   - الأمر: `git status --porcelain` داخل شجرةِ المراجعةِ.
   - المخرج: مخرجاتٌ فارغةٌ بالكامل (لا ملفاتٍ معدَّلةً ولا ملفاتٍ غيرَ متعقَّبةٍ).
   - رمزُ الخروج: `0`.

3. **سلامةُ الملفاتِ المحميّة:**
   - الأمر: `git diff 8b48a568 -- scripts/production-entry.mjs config/external-review.yaml version.json sim/tpm/tcti_guard.mjs`
   - المخرج: لا يوجدُ أيُّ فرقٍ (مخرجاتٌ فارغة).
   - رمزُ الخروج: `0`.

4. **تشغيلُ البروفةِ الأساسيّةِ (`rehearse.ps1`):**
   - أُطلِقَ محاكي `swtpm` مستقلٌّ على المنفذِ 5700 (والتحكّمِ 5701) ببياناتٍ معزولةٍ تحتَ المجلدِ الخاص:
     ```bash
     swtpm socket --tpm2 --tpmstate dir=/home/user/workspace/council-wl413-r3/gemini_3_8_flash/st \
       --server type=tcp,port=5700,bindaddr=127.0.0.1 \
       --ctrl type=tcp,port=5701,bindaddr=127.0.0.1 \
       --flags not-need-init,startup-clear \
       --pid file=/home/user/workspace/council-wl413-r3/gemini_3_8_flash/pid --daemon
     ```
   - شُغِّلَت البروفة:
     ```bash
     pwsh -NoProfile -File sim/tpm-ceremony/rehearse.ps1 -SimHost 127.0.0.1 -SimPort 5700 -Stages ALL -SimPidFile /home/user/workspace/council-wl413-r3/gemini_3_8_flash/pid > /home/user/workspace/council-wl413-r3/gemini_3_8_flash/rehearsal.json
     ```
   - المخرج: ملفُّ `rehearsal.json` أظهر:
     - حقل `status`: `"COMPLETE"`.
     - حقل `failure`: `null`.
     - حقل `transport.listener.before`: `"pid=30154 comm=swtpm"`.
     - حقل `transport.listener.after`: `"pid=30154 comm=swtpm"`.
     - حقل `postRunInventory.verified`: `true`.
     - حقول `residualNv` و`residualSessions` و`residualTransients`: مصفوفاتٌ فارغة `[]`.
   - رمزُ الخروج: `0`.

5. **تشغيلُ حزمةِ الاختباراتِ القياسيّة:**
   - الأمر:
     ```bash
     XUUX_TPM_SIM=1 TPM2TOOLS_TCTI=swtpm:host=127.0.0.1,port=5700 node --test --test-concurrency=1 \
       tests/sim/tpm-ceremony-rehearsal.test.mjs tests/sim/tpm-ceremony-guard.test.mjs \
       tests/sim/tpm-ceremony-remediation.test.mjs tests/sim/tpm-ceremony-wl413-r2.test.mjs \
       tests/sim/tpm-ceremony-wl413-r3.test.mjs
     ```
   - المخرج: 62 اختبارًا فرعيًّا؛ سجَّلَ التقريرُ: `# tests 62`، `# pass 62`، `# fail 0`، `# duration_ms 58285.96`.
   - رمزُ الخروج: `0`.

---

## 2. السؤال الأول: إعادةُ فحصِ عوائقِ الجولةِ الأولى (SOL413-01..08 وG47-413-1..9)

أُجريت تجاربُ إعادةِ الإنتاجِ لكلِّ عائقٍ أُعلن في الجولةِ السابقةِ على كوميت `8b48a568`، وقِيسَ سلوكُ الشفرةِ الحاليةِ على `de099aa8`:

| المعرّف | وصفُ العائقِ التاريخي | أمرُ الفحصِ / الوضع | المخرجُ المقيسُ على `de099aa8` | رمز الخروج | النتيجة المقيسة |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **SOL413-01** / **G47-413-1** | تبنّي مقبضِ ردِّ إنشاءٍ موجودٍ بخطِّ الأساسِ وتحريرِ كائنٍ سابق | `tpm-ceremony-harness.ps1 -Mode fault -SimPort 5700 -Fault session-alias` | `status: "FAILED_CLOSED"`, `failure: "OUTCOME_UNKNOWN: s2.trial:StartAuthSession (ResponseMalformedException: RESPONSE_HANDLE_PREEXISTING: StartAuthSession 0x03000000 existed in baseline sessions inventory)"`, والجلسةُ `0x03000001` أُعلنت في `cleanupLeftovers` و`residualSessions` | `0` | تعذُّرُ إعادةِ الإنتاج: رُفِضَ التبنّي بفشلٍ مغلقٍ مسمّى، والجلسةُ غيرُ المتبنّاةِ رُصِدت في الجردِ النهائي |
| **SOL413-02** | جردُ مقابضَ بلا تقدّمٍ (more=1/count=0) أو بفئةٍ خاطئةٍ يُنهى صامتًا كأنّه فراغ | `tpm-ceremony-harness.ps1 -Mode fault -SimPort 5700 -Fault inventory-no-progress` و`inventory-wrong-class` | في الأول: `status: "FAILED_CLOSED"`, `failure: "RESPONSE_CAPABILITY_NO_PROGRESS: more=1 count=0 rc=0x00000000"`, `postRunInventory.verified: false`؛ وفي الثاني: `failure: "RESPONSE_CAPABILITY_HANDLE_CLASS_MALFORMED: 0x80000001 asked=0x01000000"` | `0` | تعذُّرُ إعادةِ الإنتاج: الفشلُ مسمّى قبلَ أيِّ أمرٍ مُغيّرٍ، و`verified` يحملُ القيمةَ `false` |
| **SOL413-03** / **G47-413-2** | محتوى تفويضِ الردِّ (nonce/السمات/hmac) غيرُ مفحوصٍ وقبولُ ردودِ كلمةِ سرٍّ مشوَّهة | `tpm-ceremony-harness.ps1 -Mode fault -SimPort 5700 -Fault auth-nonce-byte` (وكذلك `auth-hmac-byte` و`auth-attrs-ff` و`auth-attrs-clear`) | جميعُ الحالاتِ الأربعِ أنتجت: `status: "FAILED_CLOSED"`, `failure: "OUTCOME_UNKNOWN: s1.probe:NV_DefineSpace (ResponseMalformedException: RESPONSE_AUTH_CONTENT_MALFORMED: auth#0 ...)"` | `0` | تعذُّرُ إعادةِ الإنتاج: رُفِضت التشويهاتُ الأربعةُ باسمٍ مسمّى وعُلِّقت كنتيجةٍ مجهولةٍ مُصالحة |
| **SOL413-04** / **G47-413-3** | بنيةُ معاملاتِ الردِّ الداخليّةِ غيرُ مفحوصة (منطقةٌ عامّةٌ فارغة، بياناتُ إنشاءٍ مقتطعة، تذاكرُ مقلوبة، nonce فارغ) | مسابرُ المخطّط الثمانية: `schema-public-empty`، `schema-creationdata-short`، `schema-creationhash-short`، `schema-ticket-tag-flip`، `schema-nonce-empty`، `schema-nvread-short`، `schema-sign-short`، `schema-policysigned-digest` | رُفِضت كلُّ حالةٍ باستثناءٍ صريحٍ: `RESPONSE_PUBLIC_AREA_MALFORMED`، `RESPONSE_CREATION_DATA_MALFORMED`، `RESPONSE_CREATION_HASH_MALFORMED`، `RESPONSE_TICKET_TAG_MALFORMED`، `RESPONSE_SESSION_NONCE_MALFORMED`، `RESPONSE_NV_READ_SIZE_MALFORMED`، `RESPONSE_SIGNATURE_COMPONENT_MALFORMED`، `RESPONSE_TICKET_DIGEST_MALFORMED` | `0` | تعذُّرُ إعادةِ الإنتاج للحالاتِ الثماني المذكورة؛ (مع وجودِ حدودٍ إضافيّةٍ مفصّلةٍ في السؤال 3) |
| **SOL413-05** | ردُّ غيابٍ/عدمِ تهيئةٍ مشوَّهٌ (0x18B/0x14A) يُبتلَعُ دليلاً للغياب («verified absent») | `tpm-ceremony-harness.ps1 -Mode fault -SimPort 5700 -Fault readpublic-malformed-18b` و`readcounter-malformed-14a` | في الأول: `cleanupLeftovers: ["reconcile nv-define 0x0183897a unverifiable: RESPONSE_ERROR_TAG_MALFORMED"]`؛ وفي الثاني: `cleanupLeftovers: ["reconcile nv-increment 0x0180588a unverifiable: RESPONSE_ERROR_TAG_MALFORMED"]` | `0` | تعذُّرُ إعادةِ الإنتاج: لم يُبتلَع الردُّ المشوَّهُ كدليلِ غيابٍ، وأُعلن صراحةً أنّهُ `unverifiable` وبقي في البقايا |
| **SOL413-06** / **G47-413-6** | أمرُ `Create` والرفضُ السلبيُّ لـ`PolicySigned` غيرُ مقيّدَينِ في دفترِ الموارد | `tpm-ceremony-harness.ps1 -Mode fault -SimPort 5700 -Fault create-response-loss` و`policysigned-neg-loss` | في الأول: `failure: "OUTCOME_UNKNOWN: s2:Create(service-key,ECDSA-P256) ..."`, `reconciliation: ["object-create: no new handle since baseline (likely not executed)"]`؛ وفي الثاني: `failure: "OUTCOME_UNKNOWN: s2v.replay:PolicySigned(old-signature) ..."`, `reconciliation: ["policy-mutation 0x03000000: session still present ..."]` | `0` | تعذُّرُ إعادةِ الإنتاج: فُقِدانُ الردِّ قُيِّدَ كنتيجةٍ مجهولةٍ في الدفترِ ودخلَ المصالحة |
| **SOL413-07** / **G47-413-4** | إعلانُ `parameterSize` ضخمٍ يُخصَّصُ قبلَ التحقّق فيرمي `OutOfMemoryException` | `tpm-ceremony-harness.ps1 -Mode fault -SimPort 5700 -Fault paramsize-huge` | `failure: "OUTCOME_UNKNOWN: s1.probe:NV_DefineSpace (ResponseMalformedException: RESPONSE_PARAMETER_SIZE_INVALID: 2147483632 > remaining 5)"` | `0` | تعذُّرُ إعادةِ الإنتاج: حُصِرَ الحجمُ قبلَ القراءةِ ورُمي استثناءٌ مسمّى محدّد |
| **SOL413-08** / **G47-413-9** | وثائقٌ تدّعي أكثرَ ممّا هو مُثبَتٌ بالتجارب (معالجةُ أيِّ تشويه، إثباتُ الملكيّة) | مقارنةُ نصوصِ [وثيقةِ ADR 0007 §12.5](docs/adr/0007-tpm-nv-counter-freshness-anchor-design.md) وسجلِّ الدينِ [docs/roadmap/06-debt-register.md](docs/roadmap/06-debt-register.md) | شُدِّدت العباراتُ وحُذِفت ادّعاءاتُ الشمولِ المطلقِ وأُثبِتَ قرارُ عدمِ الحذف | — | نُصِّصَ على القياسِ ونطاقِ المحاكي، وفُصِّلت الحدودُ (مع وجودِ ملاحظاتٍ في السؤال 5) |
| **G47-413-1** | مطابقةُ المنطقةِ العامّةِ بايتًا ببايتٍ بعدَ فقدِ ردِّ التعريف تُسمّى «إثباتَ ملكيّةٍ» وتحذفُ الفهرس | `tpm-ceremony-harness.ps1 -Mode fault -SimPort 5700 -Fault define-response-loss` | `status: "FAILED_CLOSED"`, `failure: "OUTCOME_UNKNOWN: s1.probe:NV_DefineSpace ..."`, `reconciliation: ["nv-define 0x01be00d0: exists with definition matching this run's request; the define reply was lost or unusable so execution and ownership cannot be proven (an identical pre-existing index is indistinguishable); left in place"]`, `cleanupLeftovers: ["nv 0x01be00d0: ownership-undetermined (define reply lost; matching publicArea is not proof); left in place"]`, `nvAfter: ["0x01be00d0"]` | `0` | تعذُّرُ إعادةِ الإنتاج: الفهرسُ لم يُحذَف بل تُرِكَ في المحاكي ووُثِّقَ في البقايا دليلاً ماديّاً |
| **G47-413-5** | نصُّ المصالحةِ يدّعي إعادةَ محاولةِ الحذفِ بينما ميزانيةُ المحاولةِ مستنفدة | مراجعةُ سطرِ 1600 في `sim/tpm-ceremony/TpmCeremonyCore.cs` | أظهرت الشيفرةُ تبديلَ العبارةِ إلى: `"cleanup attempt budget already spent (no further attempt); declared as leftover"` | — | تعذُّرُ إعادةِ الإنتاج للنصِّ المضلّلِ القديم |
| **G47-413-7** | انتحالُ `comm` و`cmdline` في فحصِ المستمعِ دونَ التحقّقِ من الملفِّ التنفيذي | فحصُ كودِ [sim/tpm-ceremony/rehearse.ps1](sim/tpm-ceremony/rehearse.ps1) أسطر 105–114 | كودُ `Assert-SimulatorListener` يفحصُ رابطَ `/proc/$ownerPid/exe` ويقارنُه بـ`(Get-Command swtpm).Source`، ويرمي `SIMULATOR_LISTENER_EXE_MISMATCH` عند الاختلاف | — | أُضيف الفحصُ التنفيذيُّ |
| **G47-413-8** | منفذُ التحكّمِ `--ctrl` مربوطٌ بـ`0.0.0.0` يُقبلُ دونَ تحقّق | تشغيلُ `swtpm` مع `--ctrl type=tcp,port=5701,bindaddr=0.0.0.0` ثم استدعاءُ `rehearse.ps1` | `failure: "simulator context mismatch: SIMULATOR_LISTENER_CTRL_PORT_NOT_LOOPBACK"` | `4` | تعذُّرُ إعادةِ الإنتاج: رُفِضَ ربطُ منفذِ التحكّمِ بغيرِ loopback |

---

## 3. السؤال الثاني: ادّعاءاتُ الدفعةِ الثالثةِ وقرارُ عدمِ الحذفِ بعدَ فقدِ ردِّ التعريف

1. **إثباتاتُ الرجوعِ للمنفّذ:**
   - قِيسَ ملفُّ اختباراتِ المنفّذِ [tests/sim/tpm-ceremony-wl413-r3.test.mjs](tests/sim/tpm-ceremony-wl413-r3.test.mjs) وسجّلَ 21/21 نجاحًا على الكوميت `de099aa8`.
   - بمراجعةِ سجلِّ المنفّذِ المودَع في [evidence/r3-baseline-8b48a568/r3-tests-on-8b48a568.log](/home/user/workspace/xuux/docs/external-review/reports/adr0007-ceremony-wl413-r3-remediation-review/evidence/r3-baseline-8b48a568/r3-tests-on-8b48a568.log)؛ سجَّلَ الملفُّ نفسُه على الكوميت `8b48a568`: إخفاقَ 21/21 اختبارًا.

2. **سلوكُ قرارِ عدمِ الحذفِ بعدَ فقدِ ردِّ التعريف:**
   - قِيسَ مسارُ فقدِ ردِّ `NV_DefineSpace` المنفَّذِ عبرَ وضعِ `define-response-loss` باستخدامِ المنفذِ 5700.
   - النتيجةُ المقيسة:
     - لم يُرسَل أمرُ `NV_UndefineSpace` في مرحلةِ التنظيف.
     - الفهرسُ الناتجُ (`0x01be00d0`) بقي موجودًا في المحاكي؛ وأثبتَ الاستعلامُ القرائيُّ اللاحقُ `Get-HandleList` وجودَه في مصفوفةِ `nvAfter`.
     - سُجِّلَ في حقلِ `reconciliation`:
       `"nv-define 0x01be00d0: exists with definition matching this run's request; the define reply was lost or unusable so execution and ownership cannot be proven (an identical pre-existing index is indistinguishable); left in place"`
     - وسُجِّلَ في حقلِ `cleanupLeftovers`:
       `"nv 0x01be00d0: ownership-undetermined (define reply lost; matching publicArea is not proof); left in place"`
   - يثبتُ القياسُ أنّ السلوك يسلكُ حرفيًّا كما قرَّرَ المالكُ في التكليف: لا حذفَ لفهرسٍ تعذَّرَ إثباتُ ملكيّتِه بردٍّ سليمٍ مُستخدَمٍ.

3. **هل يتركُ القرارُ ثغرةً أو أثرًا تراكميًّا؟**
   - **التحليلُ المقيسُ للشيفرة:**
     - عندَ تكرارِ فقدِ ردودِ التعريفِ عبرَ تشغيلاتٍ متتاليةٍ، يبقى كلُّ فهرسٍ عُرِّفَ دائمًا في ذاكرةِ NV الخاصةِ بالشريحةِ دونَ حذفٍ آليٍّ.
     - في [sim/tpm-ceremony/TpmCeremonyCore.cs](sim/tpm-ceremony/TpmCeremonyCore.cs#L1196)، تفحصُ الدالةُ `PickVacantHandle` سعةَ العدّاداتِ عبر:
       `if (countersMax > 0 && counters >= countersMax) throw new CeremonyFailedException("NO_COUNTER_HEADROOM", 0);`
     - وبما أنّ عتادَ TPM يملكُ سعةً محدودةً لعدّاداتِ NV (كما قِيسَ على اللابتوب في تقريرِ WL-411: `TPM_PT_NV_COUNTERS_MAX = 8`، وكانَ القائمُ 4 عدّادات)، فإنّ بقاءَ الفهارسِ غيرِ المحذوفةِ يستهلكُ خاناتِ العدّاداتِ المتبقية.
     - عندَ امتلاءِ الخاناتِ، تتوقّفُ أيُّ محاولةِ تشغيلٍ جديدةٍ بالاستثناءِ المغلقِ `NO_COUNTER_HEADROOM`.
   - **الاستنتاجُ المعماري:**
     - هذا السلوكُ ليس ثغرةَ تسريبٍ خفيةٍ؛ بل هو خيارٌ هندسيٌّ متعمّدٌ للفشلِ المغلقِ (Fail-Closed): تفضيلُ بقاءِ الفهرسِ كدليلٍ ماديٍّ للمراجعةِ والتدخّلِ اليدويِّ للمالك، على حسابِ الحذفِ الآليِّ الذي قد يطالُ كائنًا سبقَ تعريفُه خارجَ الجولة.

---

## 4. السؤال الثالث: تحليلُ الردودِ وحدودُها، والوسمُ `ST_NO_SESSIONS`

### أ. تحليلُ ردودِ `ST_NO_SESSIONS`
- أشارَ التكليفُ إلى أنّ ردودَ `StartAuthSession` و`PolicySigned` تعودُ على `swtpm` بوسمِ `ST_NO_SESSIONS` (0x8001) بلا حقلِ `parameterSize`.
- قِيسَ مسارُ فكِّ الردودِ في `Resp.Parse` أسطر 516–520 في [sim/tpm-ceremony/TpmCeremonyCore.cs](sim/tpm-ceremony/TpmCeremonyCore.cs#L516):
  - عندما يكونُ الوسمُ `ST_NO_SESSIONS`، تُخصَّصُ المعاملاتُ عبر: `p.Params = r.Raw(r.Remaining);` مباشرةً تاليةً للمقابضِ دونَ توقّعِ حقلِ `parameterSize`.
  - تُمرَّرُ `p.Params` بالكاملِ إلى `ResponseSchema.Check(cc, cmd, p.Params)`.
  - داخلَ `ResponseSchema.Check`، تُقسَّمُ الحقولُ بالتتابعِ عبرَ قارئِ البايتاتِ `Rd`، ويُستدعى في نهايةِ كلِّ أمرٍ `End(r, what)` للتحقّقِ من أنّ `r.Remaining == 0`.
  - القياس: إذا احتوى الردُّ على بايتاتٍ زائدةٍ في النهاية، يُرمى استثناءُ `RESPONSE_PARAMS_TRAILING_BYTES`؛ وإذا كان مقتطعًا، يرمي `Rd` استثناءَ `RESPONSE_TRUNCATED`.

### ب. ثغراتٌ وفجواتٌ جديدةٌ كشفتْها المسابرُ المخصَّصة (مع الإحالةِ لمواصفاتِ TCG)

أُجريت مسابرُ تدقيقٍ مخصّصةٌ كُتِبت خارجَ الشجرةِ في [AuditProbes.cs](/home/user/workspace/council-wl413-r3/gemini_3_8_flash/probes/AuditProbes.cs) وشُغِّلت بواسطةِ [run-audit.ps1](/home/user/workspace/council-wl413-r3/gemini_3_8_flash/probes/run-audit.ps1) على المنفذِ 5700، وأسفرت عن الآتي:

1. **فحصُ الهرميّةِ في تذاكرِ `AuthTicket` و`CreationTicket` (قبولُ مقبضِ 0x40000002 غيرِ الصالح):**
   - **الواقعُ في الشيفرة:** تفحصُ الدالتانِ `AuthTicket` (سطر 597) و`CreationTicket` (سطر 587) الهرميّةَ بالشرط:
     ```csharp
     if (hierarchy < 0x40000001u || hierarchy > 0x40000007u)
         throw new ResponseMalformedException("RESPONSE_TICKET_HIERARCHY_MALFORMED: " + what + " " + Hex.U32(hierarchy), 0);
     ```
   - **مواصفةُ TCG:** تنصُّ مواصفةُ [TCG TPM 2.0 Part 2: Structures Rev 01.38 §9.26 Table 29](https://trustedcomputinggroup.org/wp-content/uploads/TPM-Rev-2.0-Part-2-Structures-01.38.pdf) (وكذلك جدول 100 لتذكرةِ `TPMT_TK_AUTH` وجدول 99 لتذكرةِ `TPMT_TK_CREATION` في §10.7) على أنّ قيمَ `TPMI_RH_HIERARCHY` المسموحةَ حصرًا هي:
     - `TPM_RH_OWNER` (`0x40000001`)
     - `TPM_RH_NULL` (`0x40000007`)
     - `TPM_RH_ENDORSEMENT` (`0x4000000B`)
     - `TPM_RH_PLATFORM` (`0x4000000C`)
   - **النتيجةُ المقيسة بالمسبر `policysigned-hierarchy-0x40000002`:**
     - حُقِنَ المقبضُ `0x40000002` (وهو `TPM_RH_REVOKE`، وليس هرميّةً إطلاقًا وفقَ جدولِ 29).
     - قبِلَ الفاحصُ التذكرةَ، واكتملت البروفةُ بالحالة: `{"probe":"policysigned-hierarchy-0x40000002","changes":1,"status":"COMPLETE","failure":null}`.
     - بالإضافةِ إلى ذلك، فإنّ الشرطَ الحاليَّ (`hierarchy > 0x40000007u`) سيرفضُ خطأً أيَّ تذكرةٍ صحيحةٍ صادرةٍ عن هرمِ المنصّة (`0x4000000C`) أو التأييد (`0x4000000B`) إن وُجدت.

2. **عدمُ فحصِ طولِ بصمةِ التذكرةِ في ردِّ `Create`:**
   - **الواقعُ في الشيفرة:** في [sim/tpm-ceremony/TpmCeremonyCore.cs](sim/tpm-ceremony/TpmCeremonyCore.cs#L683):
     ```csharp
     ushort ttag = r.U16(); uint h = r.U32(); r.B2B();
     End(r, "Create");
     EccPublic(pub, CmdTemplate(cmd), "Create");
     CreationData(cd, "Create");
     if (ch.Length != 32) throw new ResponseMalformedException("RESPONSE_CREATION_HASH_MALFORMED: len=" + ch.Length, 0);
     CreationTicket(ttag, h, "Create");
     ```
     تُقرأ بصمةُ التذكرةِ عبر `r.B2B()` ولكن لا يُفحصُ طولُها على الإطلاقِ مقارنةً بـ`ch` التي فُحِصت ضد 32 بايتًا.
   - **مواصفةُ TCG:** تنصُّ مواصفةُ [TCG TPM 2.0 Part 2: Structures Rev 01.38 §10.7 Table 99](https://trustedcomputinggroup.org/wp-content/uploads/TPM-Rev-2.0-Part-2-Structures-01.38.pdf) على أنّ حقلَ `digest` في `TPMT_TK_CREATION` هو `TPM2B_DIGEST` ويطابقُ ناتجَ تجزئةِ خوارزميّةِ الإنشاء (32 بايتًا في SHA-256).
   - **النتيجةُ المقيسة بالمسبر `create-ticket-digest-short`:**
     - حُقِنت بصمةُ تذكرةٍ بطولِ بايتٍ واحدٍ (`new byte[1]`).
     - قبِلَ الفاحصُ الردَّ بالكامل، وسجّل: `{"probe":"create-ticket-digest-short","changes":1,"status":"COMPLETE","failure":null}`.

3. **عدمُ التثبّتِ من فراغِ حقلِ `timeout` في ردِّ `PolicySigned` عندَ انتهاءِ الصلاحيةِ بصفر:**
   - **الواقعُ في الشيفرة:** سطر 718 في `TpmCeremonyCore.cs`:
     `r.B2B(); // timeout (فارغٌ عند expiration=0 — قياسُ swtpm)`
     كُتِبَ في التعليقِ أنّه فارغٌ، ولكن لم يُوضَع شرطُ `if (to.Length != 0)`.
   - **مواصفةُ TCG:** تنصُّ مواصفةُ [TCG TPM 2.0 Part 3: Commands Rev 01.38 §23.3](https://trustedcomputinggroup.org/wp-content/uploads/TPM_Rev_2_0_Part_3_Commands_01_38_f1ed38ee7e.pdf) على أنّه عندما تكون قيمةُ `expiration == 0`، لا تُنشئ الشريحةُ قيدَ توقيت، ويكونُ حقلُ `timeout` فارغًا (حجمه صفر).
   - **النتيجةُ المقيسة بالمسبر `policysigned-timeout-nonzero`:**
     - حُقِنَ `timeout` بطول 8 بايتات.
     - قبِلَ الفاحصُ الردَّ واكتملت البروفة: `{"probe":"policysigned-timeout-nonzero","changes":1,"status":"COMPLETE","failure":null}`.

---

## 5. السؤال الرابع: التنظيفُ والفشلُ المغلقُ والدفترُ وسلامةُ الاختبارات

### أ. قيدُ الأوامرِ المُغيِّرةِ في دفترِ الموارد
- فُحِصت شفرةُ `TpmCeremonyCore.cs` بالكامل؛ وتبيّنَ أنّ كافةَ الأوامرِ المُغيِّرةِ للحالةِ مقيّدةٌ بدفترِ المواردِ `_pending`:
  - أمرُ `NV_DefineSpace`: يُرسَل عبر `SendTracked(..., Tracked("nv-define", ...))`.
  - أمرُ `NV_Increment`: يُرسَل عبر `SendTracked(..., Tracked("nv-increment", ...))` أو عبر `RefusedIncrement` المقيّدة في الدفتر.
  - أمرُ `NV_UndefineSpace`: يُرسَل عبر `SendTracked(..., Tracked("nv-undefine", ...))`.
  - أمرُ `CreatePrimary`: يُرسَل عبر `SendTracked(..., Tracked("object-create", ...))`.
  - أمرُ `Create`: أصبحَ يُرسَل عبر `SendTracked(..., Tracked("object-create", ...))` (عولِجَ SOL413-06).
  - أمرُ `Load`: يُرسَل عبر `SendTracked(..., Tracked("object-create", ...))`.
  - أمرُ `StartAuthSession`: يُرسَل عبر `SendTracked(..., Tracked("session-create", ...))`.
  - أمرُ `FlushContext`: يُرسَل عبر `SendTracked(..., Tracked("flush", ...))`.
  - أمرُ `PolicySigned` السلبيّ: أصبحَ يُرسَل عبر `RefusedTracked(..., Tracked("policy-mutation", ...))` (عولِجَ SOL413-06).
  - أمرُ `PolicyCommandCode`: يُرسَل عبر `SendTracked(..., Tracked("policy-mutation", ...))`.
- الأوامرُ غيرُ المقيّدةِ في الدفتر هي أوامرُ قراءةٍ فقط ولا تُحدثُ أثرًا دائمًا على TPM: `GetCapability`، و`NV_ReadPublic`، و`NV_Read`، و`Sign`، و`PolicyGetDigest`.

### ب. مساراتُ الحذفِ والتحقّقُ من الملكيّة
- قِيسَ مسارُ الحذفِ في `UndefineOwn` أسطر 1292–1306 في `TpmCeremonyCore.cs`:
  1. يتطلّبُ وجودَ الفهرسِ في قاموسِ `_definedByRun` الذي لا يُملأُ إلا بعدَ نجاحِ أمرِ `NV_DefineSpace` في الجولةِ الحالية.
  2. يُجري فحصَ ملكيّةٍ قرائيًّا عبر `NV_ReadPublic` للتحقّقِ من تطابقِ المنطقةِ العامّةِ بايتًا ببايت (مع استثناءِ بتّ `TPMA_NV_WRITTEN`).
  3. في حالِ فقدِ ردِّ التعريف، لا يُضافُ الفهرسُ إلى `_definedByRun`، ولا يمسُّهُ الحذف.
- إعلانُ النظافةِ والجردُ النهائي (`PostRunInventory`):
  - لا يمكنُ إعلانُ النظافةِ (`verified: true`) دونَ تنفيذِ جردِ المقابضِ القرائيِّ ومقارنتِه بخطِّ الأساسِ المأخوذِ قبلَ بدءِ المراسم.
  - في حالِ تعذّرِ الجرد (كنقلٍ ميت)، يُسجَّل: `verified = false`، وتُضاف رسالةُ `"residual state unknown"` إلى البقايا.

### ج. عيبٌ تشغيليٌّ في حزامِ اختباراتِ الدفعةِ الثالثة (`tpm-ceremony-wl413-r3.test.mjs`)
- عندَ تشغيلِ حزمةِ الاختباراتِ القياسيةِ، كشفَ الرصدُ لنظامِ التشغيلِ (`ps aux | grep swtpm`) عن بقاءِ **21 عمليةَ `swtpm` يتيمةً** تعملُ في الخلفية.
- **سببُ العيبِ بالشيفرة:**
  - في [tests/sim/tpm-ceremony-wl413-r2.test.mjs](tests/sim/tpm-ceremony-wl413-r2.test.mjs#L57):
    `return { dir, port, pidFile, pid: Number(readFileSync(pidFile, 'utf8').trim()) };`
    وفي `stopSim`:
    `try { process.kill(s.pid, 'SIGTERM'); } catch { }`
  - أمّا في [tests/sim/tpm-ceremony-wl413-r3.test.mjs](tests/sim/tpm-ceremony-wl413-r3.test.mjs#L57):
    `return { dir, port, pidFile };` (أُهملَ استخراجُ `pid`)
    وفي سطر 61:
    `function stopSim(s) { try { rmSync(s.dir, { recursive: true, force: true }); } catch { } }`
    حيثُ يكتفي بحذفِ المجلدِ المؤقّتِ دونَ إنهاءِ عمليةِ `swtpm` العاملةِ كـ`--daemon`!
  - ونتيجةً لذلك: كلُّ تشغيلةٍ لاختباراتِ R3 تتركُ 21 خادمَ `swtpm` يعملُ في الذاكرةِ حتى يُقتلَ يدويًّا. (قُتِلت جميعُ العملياتِ اليتيمةِ ووثِّقَ ذلك أثناء الفحص).

---

## 6. السؤال الخامس: الحدودُ والوثائقُ ومتطلّباتُ الإذنِ بـ S1 على العتاد

1. **هل تقولُ وثيقةُ ADR 0007 §12.5 والوثائقُ المجاورةُ أكثرَ ممّا قِيس؟**
   - وثيقةُ [ADR 0007 §12.5](docs/adr/0007-tpm-nv-counter-freshness-anchor-design.md) ونموذجُ التهديد [docs/THREAT_MODEL.md](docs/THREAT_MODEL.md) شدَّدا نصوصَهما بحصرِ النتائجِ في «نطاقِ المحاكي فقط»، وبيّنا أنّ قرارَ عدمِ الحذفِ أضحى سلوكًا مبرمجًا.
   - لكنّ جدولَ §12.5 يدّعي:
     - «تذكرةٌ بوسمِها وهرمِها»: وهذا أوسعُ من المقيس؛ إذ أثبتَ المسبرُ `policysigned-hierarchy-0x40000002` أنّ فحصَ الهرميّةِ يقبلُ مقابضَ غيرِ صالحةٍ كـ`0x40000002`.
     - «أطوالُ الحقولِ الداخليّة»: أثبتَ المسبرُ `create-ticket-digest-short` أنّ بصمةَ تذكرةِ الإنشاءِ في أمرِ `Create` لا تُفحصُ إطلاقًا وتُقبلُ بحجمِ بايتٍ واحدٍ؛ والمسبرُ `policysigned-timeout-nonzero` أثبتَ قبولَ توقيتٍ غيرِ صفريٍّ عند `expiration=0`.

2. **ما الذي يلزمُ استيفاؤهُ قبلَ أيِّ إذنٍ بمرحلةِ S1 على العتاد؟**
   وفقًا لما تمليهِ نصوصُ [ADR 0007 §7 و§11 و§12.6](docs/adr/0007-tpm-nv-counter-freshness-anchor-design.md) وسجلِّ الدينِ `EXT-6`:
   1. **قرارُ مالكٍ صريحٌ ومكتوب:** إذنٌ خاصٌّ ومحدّدٌ بمراسمِ S1 ونصِّها ومجالِها التشغيليِّ.
   2. **صلاحيّاتُ المُضيفِ وتفويضُ التخزين:** تشغيلٌ بحسابِ مديرٍ مرفوعٍ على Windows، وتوفّرُ تفويضِ هرمِ التخزينِ المحفوظِ لدى نظامِ التشغيل (وهو ما لم يُقَسْ بعد).
   3. **سماحُ وسيطِ Windows TBS لأوامرِ الكتابة:** قياسُ سماحِ خدمةِ TBS لأوامرِ `NV_DefineSpace` و`NV_Increment` و`NV_UndefineSpace`؛ حيثُ إنّ قياساتِ WL-411 اقتصرت على أوامرِ القراءة (`GetCapability` و`NV_ReadPublic`).
   4. **سعةُ التخزينِ وخاناتُ العدّاداتِ الحرّة:** قياسُ السعةِ المتبقيّةِ لذاكرةِ NV والسعةِ الحرّةِ للعدّاداتِ؛ إذ إنّ وجودَ حدٍّ نظريٍّ (`TPM_PT_NV_COUNTERS_MAX=8`) لا يضمنُ توفّرَ ذاكرةِ NV المشتركة.
   5. **إدراكُ عدمِ الرجعيّة:** إقرارُ المالكِ بأنّ زيادةَ عدّادِ NV ترفعُ أعلى قيمةٍ عرفتْها الشريحةُ بصورةٍ رتيبةٍ دائمةٍ في السيليكون لا يمكنُ إرجاعُها للوراء.
   6. **معالجةُ الفجواتِ المكتشفةِ في المحلّل:**
      - تصحيحُ فحصِ هرميّةِ التذاكرِ لحصرِها في القيمِ الأربعِ المعرّفةِ في مواصفةِ TCG Part 2 Table 29 (`0x40000001` و`0x40000007` و`0x4000000B` و`0x4000000C`)، ورفضِ ما عداها.
      - فحصُ طولِ بصمةِ التذكرةِ في `Create` (32 بايتًا).
      - فحصُ فراغِ حقلِ `timeout` في `PolicySigned` عند `expiration=0`.
      - تصحيحُ دالّةِ `stopSim` في [tests/sim/tpm-ceremony-wl413-r3.test.mjs](tests/sim/tpm-ceremony-wl413-r3.test.mjs) لقتلِ عملياتِ `swtpm` اليتيمة.

---

## 7. خاتمةُ الفحصِ وإعلانُ النظافة

- أُوقِفت جميعُ العملياتِ والمحاكياتِ المُطلقةِ أثناءَ الفحصِ (تمّ التحقّقُ بخلوِّ قائمةِ العملياتِ من أيِّ مسارٍ لـ`swtpm` أو `node` أو `pwsh` يخصُّ هذا الحساب).
- شجرةُ المراجعةِ في المسار `/home/user/workspace/xuux-review-de099aa8`:
  - الأمر: `git -C /home/user/workspace/xuux-review-de099aa8 status --porcelain`
  - الناتج: **فارغٌ تمامًا (لا تغييراتٍ ولا ملفاتٍ غيرَ متعقّبة)**.
