# تقريرُ المراجعةِ المستقلّةِ — جولةُ متابعةِ WL-414 على رأسِ 3e67d362

**معرِّفُ المراجع:** `gemini_3_8_flash`  
**التاريخ:** 2026-10-18 (توقيتُ الرياض)  
**الرأسُ المستهدفُ للمراجعة:** `3e67d362dc4f30ec35f73957fd5542be47a3a875`  
**الفرع:** `wl-413-review-remediation` (PR #378، مستودعُ `ovvvog/xuux`)  
**نسخةُ الشجرةِ المعزولةِ الخاصة:** `/tmp/wl414-followup/reviewers/gemini_3_8_flash/repo`  
**منفذُ المحاكي المُخصّص (swtpm):** `7200` (منفذُ التحكّم: `7201`)  
**مجلدُ المسابرِ والمخرجاتِ الخام:** `/tmp/wl414-followup/reviewers/gemini_3_8_flash/`  

---

## 1. الخلاصةُ التنفيذيةُ (Executive Summary)

أُجريت هذهِ المراجعةُ المستقلّةُ لجولةِ المتابعةِ WL-414 على مستودعِ `ovvvog/xuux` عندَ الرأسِ `3e67d362` عبرَ شجرةِ عملٍ معزولةٍ كليًّا خارجَ شجرةِ المستودعِ الأصليةِ (`/home/user/workspace/repo`)، معَ الالتزامِ الصارمِ بعدمِ قراءةِ أيِّ ملفٍ أو تقريرٍ لمراجعٍ آخرَ تحتَ `/tmp/wl414-followup/reviewers/`، والاعتمادِ الحصريِّ على منفذِ المحاكي المخصّصِ للمعرّفِ (`7200` والتحكّم `7201`).

### خلاصةُ الحكمِ الهندسيِّ:
1. **صلابةُ واكتمالُ دفعةِ الإصلاحِ `d9e1dc3b` والتزامِ الاختبارِ `3e67d362`:** أثبتتِ القياساتُ المستقلّةُ عبرَ 46 مسبارَ حقنٍ مستقلٍّ (بنيت في `IndependentFollowup.cs`) ومعَ حزمةِ الاختباراتِ القياسيّةِ للمشروعِ (73 اختبارًا، بنجاح 73/73 ودون أيِّ إخفاق) أنَّ كافةَ الفجواتِ التي أثبتتها الجولةُ المستقلّةُ الثالثةُ (`de099aa8`) قد عولجت جذريًّا دونَ ثغراتٍ التفافيّة.
2. **كسرُ هجومِ R3SOL-01 بالكامل:** محاولةُ إخفاءِ كائنِ خطِّ الأساسِ الحارسِ عبرَ صفحاتِ جردٍ مكرّرةٍ أو ملتويةٍ ثمّ تبنّي مقبضِ الضحيةِ المخفيّةِ وتدميرِهِ كُسِرَت في مهدِها عندَ لحظةِ فحصِ الجردِ؛ حيثُ يُلقي الفاحصُ استثناءَ `RESPONSE_CAPABILITY_HANDLE_ORDER_MALFORMED` أو `RESPONSE_CAPABILITY_DUPLICATE_HANDLE` ويتوقّفُ فورًا بـ `FAILED_CLOSED` قبلَ إرسالِ أيِّ أمرٍ مُغيّرٍ، وتبقَى الكائناتُ الحارسةُ سالمةً على المحاكي.
3. **تطابقُ نوعِ التفويضِ مع الطلبِ في الاتجاهين:** يُفحَصُ ملفُّ تفويضِ الردِّ بدقّة؛ فملفُّ السياسةِ على أمرِ كلمةِ سرٍّ يُرفَضُ مسمّى (`expected=password`)، وملفُّ كلمةِ السرِّ على أمرِ جلسةِ سياسةٍ يُرفَضُ مسمّى (`expected=policy`).
4. **تثبيتُ قيمِ هرمياتِ التذاكرِ وأطوالِ البصماتِ وبنى الردودِ الداخلية:** هرميةُ التذاكرِ محصورةٌ بالقيمِ الأربعِ المشروعةِ لـ `TPMI_RH_HIERARCHY`، وقيمةُ `0x40000002` (REVOKE) مرفوضةٌ حتمًا. وبصماتُ التذاكرِ والحقولُ الذيليةُ لبياناتِ الإنشاءِ (3 حقولٍ حصرًا) وخوارزميةُ أصلِ الإنشاءِ وبصمةِ PCR الفارغةِ المعتمدةِ في Part 2 (جدول 222) تُفحصُ جميعُها بدقّةٍ بايتية.
5. **إغلاقُ فجوةِ تغطيةِ خطِّ الأساسِ الجزئيِّ (R3-18):** أُكِّدَ قياسًا ومراجعةً أنَّ الرأسَ `3e67d362` يتضمّنُ اختبارَ الحقنِ المخصّصَ `R3-18` في `tests/sim/tpm-ceremony-wl413-r3.test.mjs` مدعومًا بوضعِ الحقنِ `baseline-partial` في `TpmCeremonyFaultTransport.cs`؛ والجردُ النهائيُّ بعدَ خطِّ أساسٍ جزئيٍّ يعلنُ صراحةً `verified=false` وبقاءَ الحالةِ المتبقيةِ مجهولةً (`residual state unknown`) دونَ ادّعاءِ مطابقةٍ زائفة.
6. **التنظيفُ المنضبطُ وعدمُ حذفِ مواردَ غيرِ مملوكة:** بعدَ الفقدِ الفعليِّ لردِّ التعريفِ (انقطاعِ شبكةٍ بعدَ التنفيذِ)، لا يُحذفُ الفهرسُ في مسارِ التنظيفِ التزامًا بقرارِ المالكِ (`G47-413-1` وADR 0007 §12.5)، ويُعلَنُ كبقايا غيرِ محسومةِ الملكيّة. كما أثبتَ اختبارُ زرعِ فهرسِ NV أجنبيٍّ (`0x01800099`) أنَّ البروفةَ لا تلمسُ ولا تحذفُ أيَّ موردٍ أجنبيٍّ سابقٍ.
7. **انعدامُ تسريبِ العملياتِ اليتيمةِ (Zero Orphan swtpm):** بعدَ تشغيلِ 46 مسبارَ حقنٍ فاشلٍ وناجحٍ، وبعدَ تشغيلِ كاملِ حزمةِ الاختباراتِ القياسيةِ (73 اختبارًا)، بلغَ عددُ عملياتِ `swtpm` اليتيمةِ **صفرًا** (`0`)؛ حيثُ أثبتتِ القياساتُ أنَّ دالةَ `stopSim` تنهي العمليةَ فورًا بإشارةِ `SIGTERM` عبرَ المعرّفِ المخزّنِ في ملفِّ الـPID.
8. **حاجزُ القوالبِ وقائمةُ السماحِ:** تغييراتُ ما بعدَ `d9e1dc3b` حتى `3e67d362` نظيفةٌ بالكاملِ؛ والتراجعُ عن استثناءِ الملفاتِ الفارغةِ في الكوميتِ `673c8c88` حمَى حاجزَ القوالبِ دونَ توسيعٍ للاستثناءات، وأمرُ `npm run guard:templates` يجتازُ بنجاحٍ (2526 ملفًا، 0 مخالفات).

### جدولُ نتائجِ القياسِ المباشرِ للنقاطِ ذاتِ الأولوية:

| البندُ الأولوية | المسبارُ المستقلُّ / الاختبار | السلوكُ المتوقَّع | السلوكُ المقيسُ فعليًّا على `3e67d362` | الحكم |
| :--- | :--- | :--- | :--- | :--- |
| **1. مقابضُ مكرّرة وتنازلية وهجوم R3SOL-01** | `attack-r3sol01-full` | إحباطُ الهجومِ في مرحلةِ الجردِ وبقاءُ الكائنينِ الحارسينِ | رُفضَت صفحةُ الجردِ فورًا بـ `RESPONSE_CAPABILITY_HANDLE_ORDER_MALFORMED` وتوقّفتِ البروفةُ بـ `FAILED_CLOSED` قبلَ أيِّ أمرٍ مُغيّر؛ الكائنانِ `0x80000000` و`0x80000001` بقيا حيَّينِ على المحاكي | **ناجح ومحصّن** |
| **1. تكرارٌ داخلَ صفحةٍ واحدة** | `inventory-multi-dup-in-page` | رفضُ التكرارِ المتعددِ | رُفضَ بـ `RESPONSE_CAPABILITY_HANDLE_ORDER_MALFORMED` | **ناجح** |
| **1. ترتيبٌ تنازليٌّ للمقابض** | `inventory-descending-order` | رفضُ المقبضِ الأدنى بعدَ الأعلى | رُفضَ بـ `RESPONSE_CAPABILITY_HANDLE_ORDER_MALFORMED` | **ناجح** |
| **1. تكرارٌ عبرَ صفحتَي جرد** | `inventory-duplicate-across-pages` | رفضُ مقبضِ الصفحةِ الثانيةِ لمخالفتِهِ حدَّ الطلبِ | رُفضَ بـ `RESPONSE_CAPABILITY_HANDLE_ORDER_MALFORMED` (`hd < askedProp`) | **ناجح** |
| **1. مقبضٌ دونَ نقطةِ البدء** | `inventory-handle-below-start` | رفضُ مقبضٍ يقلُّ عن `askedProp` | رُفضَ بـ `RESPONSE_CAPABILITY_HANDLE_CLASS_MALFORMED` | **ناجح** |
| **1. خاصيّةٌ دونَ نقطةِ البدء** | `inventory-prop-below-start` | رفضُ خاصيةٍ أقلَّ من المطلوبِ | رُفضَ بـ `RESPONSE_CAPABILITY_PROPERTY_MALFORMED` | **ناجح** |
| **1. عددُ مقابضَ يفوقُ المطلوب** | `inventory-count-exceeds-requested` | رفضُ إعادةِ أكثرَ ممّا طُلِب | رُفضَ بـ `RESPONSE_CAPABILITY_COUNT_MALFORMED: 65 > requested 64` | **ناجح** |
| **1. مقبضٌ حيٌّ يعودُ في أمرٍ لاحق** | `handle-reissued-live` | رفضُ تبنّي مقبضٍ ما زال حيًّا | رُفضَ بـ `RESPONSE_HANDLE_REISSUED: Load ... still live in this run` | **ناجح** |
| **2. ملفُّ سياسةٍ على أمرِ كلمةِ سر** | `auth-policy-on-password-cmd` | رفضُ التفويضِ المخالفِ للطلبِ | رُفضَ بـ `RESPONSE_AUTH_CONTENT_MALFORMED: ... expected=password` | **ناجح** |
| **2. ملفُّ كلمةِ سرٍّ على أمرِ جلسةِ سياسة** | `auth-password-on-policy-cmd` | رفضُ التفويضِ المخالفِ للطلبِ | رُفضَ بـ `RESPONSE_AUTH_CONTENT_MALFORMED: ... expected=policy` | **ناجح** |
| **2. سماتُ وnonce ملفِّ السياسة** | `auth-policy-nonce16/attrs08/01` | رفضُ التشويهاتِ في تفويضِ السياسةِ | رُفضَت جميعًا بـ `RESPONSE_AUTH_CONTENT_MALFORMED: ... expected=policy` | **ناجح** |
| **2. هرمياتُ التذاكرِ (Creation & Auth)** | مسابرُ `ticket-owner/null/endorsement/platform` مقابل `revoke/invalid` | قبولُ الأربعِ المشروعةِ ورفضُ ما عداها | قُبلَت `0x40000001/07/0B/0C` بنجاحٍ، ورُفِضَت `0x40000002` و`0x40000000` و`0x40000003` بـ `RESPONSE_TICKET_HIERARCHY_MALFORMED` | **ناجح** |
| **2. أطوالُ بصماتِ التذاكر** | مسابرُ `ticket-digest-0/1/32/64/65/100` | طولُ تذكرةِ Create يجبُ أن يكونَ 64 بايتًا حصرًا | الطولُ 64 قُبلَ بنجاحٍ؛ الأطوالُ 0 و1 و32 و65 و100 رُفِضَت بـ `RESPONSE_TICKET_DIGEST_MALFORMED` | **ناجح** |
| **2. الحقولُ الذيليةُ لبياناتِ الإنشاء** | `creation-data-tail-2 / 4` | اشتراطُ 3 حقولٍ ذيليةٍ حصرًا | الحقلانِ رُفضا بـ `tailFields=2`، والأربعةُ حقولٍ رُفضت بـ `tailFields=3 tail=5` | **ناجح** |
| **2. خوارزميةُ أصلِ الإنشاء (parentNameAlg)** | `creation-data-parentalg-*` | قبولُ ALG_NULL وSHA256 فقط | `ALG_NULL` و`ALG_SHA256` قُبلا؛ و`0xFFFF` و`ALG_SHA1` رُفضا مسمّى | **ناجح** |
| **2. بصمةُ PCR الفارغةِ السائغة** | `creation-data-pcr-empty-valid` | قبولُ count=0 وdlen=0 (Part 2 جدول 222) | قُبلت بنجاحٍ تامٍّ (اكتمالُ البروفة `COMPLETE`)؛ بينما dlen=16 رُفِض | **ناجح ومطابق** |
| **2. اتساقُ بصمةِ الإنشاء creationHash** | `creationhash-mismatch` | رفضُ عدمِ تطابقِ البصمةِ مع بياناتِ الإنشاء | رُفِضَ بـ `RESPONSE_CREATION_HASH_MISMATCH: CreatePrimary` | **ناجح** |
| **2. اسمُ المفتاحِ المحمَّلِ في Load** | `load-name-mismatch` | مطابقةُ الاسمِ للمنطقةِ العامةِ | رُفِضَ بـ `RESPONSE_NAME_HASH_MISMATCH: Load` | **ناجح** |
| **2. مهلةُ PolicySigned عند expiration=0** | `policysigned-timeout-nonzero-exp0` | فراغُ timeout عندَ انتفاءِ القيدِ الزمنيِّ | رُفِضَ بـ `RESPONSE_POLICY_TIMEOUT_MALFORMED: len=8 at expiration=0` | **ناجح** |
| **3. الجردُ بعدَ خطِّ أساسٍ جزئي** | `baseline-partial-transient` + `R3-18` | عدمُ ادّعاءِ الموثوقيةِ (`verified=false`) | فشلٌ مغلقٌ بـ `partial baseline`، مع `postRunVerified=false` وإعلانِ جهالةِ البقايا | **ناجح ومحصّن** |
| **4. التنظيفُ بعدَ فقدِ ردِّ التعريف** | `define-response-loss-actual` | عدمُ حذفِ الفهرسِ وإعلانُه كبقايا | الفهرسُ `0x01aba7a6` بقيَ على المحاكي، ولم يُرسَل أمرُ حذف، وأُعلنَ غيرَ محسومِ الملكيّة | **ناجح ومطابق** |
| **4. عدمُ حذفِ مواردَ أجنبية** | `foreign-nv-preservation` | بقاءُ فهرسِ NV أجنبيٍّ مزروعٍ مسبقًا | الفهرسُ `0x01800099` بقيَ سليمًا تمامًا بعدَ انتهاءِ البروفةِ والتنظيفِ | **ناجح** |
| **5. انعدامُ العملياتِ اليتيمة (Orphan swtpm)** | فحصُ العملياتِ في 46 مسبرًا + 73 اختبارًا | صفرُ عملياتٍ يتيمةٍ عقبَ الخروجِ الفوري | 0 عملية يتيمة مسجّلة؛ إنهاءٌ فوريٌّ بـ SIGTERM عبرَ الـ PID | **ناجح تمامًا** |
| **6. مطابقةُ النصوصِ ونموذجِ التهديد** | مقارنةُ نصوصِ المصالحةِ والوثائقِ | مطابقةُ العباراتِ لسلوكِ الشيفرةِ والقياس | نصوصُ المصالحةِ وADR 0007 (§12.5) وREADME متطابقةٌ حرفيًّا مع القياسِ الفعلي | **ناجح** |
| **7. حاجزُ القوالبِ وقائمةُ السماح** | فحصُ فرقِ الالتزاماتِ وتشغيلُ الحارس | عدمُ توسيعِ الاستثناءاتِ بلا مبرر | لا استثناءاتٍ جديدة؛ `guard:templates` يجتازُ بـ 0 مخالفات | **ناجح** |

---

## 2. الفحصُ الأوّليُّ وتثبّتُ الشجرةِ والبيئةِ

1. **الرأسُ المستهدفُ وعزلُ الشجرة:**
   - نُسِخَ المستودعُ بعزلٍ كاملٍ إلى `/tmp/wl414-followup/reviewers/gemini_3_8_flash/repo`.
   - الأمر: `git rev-parse HEAD` داخل شجرةِ المراجعةِ المعزولةِ.
   - المخرج: `3e67d362dc4f30ec35f73957fd5542be47a3a875`.
   - رمزُ الخروج: `0`.
   - الشجرةُ الأصليةُ `/home/user/workspace/repo` لم تُمسَّ بأيِّ أمرٍ تعديليٍّ أو دفعٍ إطلاقًا.

2. **نظافةُ الشجرةِ وسلامةُ البناء:**
   - الأمر: `git status --porcelain` داخل الشجرةِ المعزولةِ.
   - المخرج: فارغٌ بالكامل (لا تغييراتٍ غيرَ متتبّعةٍ ولا تعديلاتٍ محلية).
   - نُفِّذَ `npm ci && npm run build` بنجاحٍ تامٍّ ورمزِ خروج `0`.

3. **توثيقُ البيئةِ والانحرافِ المُعلَن:**
   - محاكي TPM: `swtpm 0.10.1` (بروتوكول TPM 2.0).
   - أدوات TPM2: `tpm2-tools 5.7` (`tpm2_getcap` و`libtss2-tctildr`).
   - بيئة Node.js: `v20.20.2`.
   - مترجم سي شارب: `Mono C# compiler version 6.14.1.0`.
   - غلاف PowerShell: `PowerShell 7.7.0-preview.5`.
     - **توثيقُ الانحرافِ:** نسخةُ `pwsh` المثبتةُ في النظامِ هي `7.7.0-preview.5`، وهي أحدثُ من النسخةِ المذكورةِ في تكليفاتِ الجولاتِ السابقةِ (`7.4`). وقد أثبتتِ القياساتُ توافقَ كافةِ برامجِ السكربتِ (`rehearse.ps1` و`tpm-ceremony-harness.ps1`) معها تمامًا دونَ أدنى سلوكٍ شاذٍّ أو تعارض.

4. **تشغيلُ البروفةِ القياسيّةِ بـ `rehearse.ps1` على المنفذِ 7200:**
   - أُطلِقَ المحاكي على المنفذِ المخصّصِ `7200` ومقبسِ التحكّمِ `7201`:
     ```bash
     swtpm socket --tpm2 --tpmstate dir="$STATE_DIR" \
       --server type=tcp,port=7200,bindaddr=127.0.0.1 \
       --ctrl type=tcp,port=7201,bindaddr=127.0.0.1 \
       --flags not-need-init,startup-clear \
       --pid file="$PID_FILE" --daemon
     ```
   - نُفِّذَت البروفةُ عبرَ PowerShell:
     ```bash
     pwsh -NoProfile -File sim/tpm-ceremony/rehearse.ps1 \
       -SimHost 127.0.0.1 -SimPort 7200 -Stages ALL -SimPidFile "$PID_FILE"
     ```
   - النتيجةُ المباشرةُ (حُفظت في `rehearsal.json` و`raw/rehearsal.json`):
     - `status`: `"COMPLETE"`.
     - `failure`: `null`.
     - `transport.listener.before`: `"pid=12263 comm=swtpm"`.
     - `transport.listener.after`: `"pid=12263 comm=swtpm"`.
     - `postRunInventory.verified`: `true`.
     - `residualNv`: `[]`، `residualSessions`: `[]`، `residualTransients`: `[]`.
     - `cleanupLeftovers`: `[]`، `reconciliation`: `[]`.
     - رمزُ الخروج: `0`.

5. **تشغيلُ حزمةِ اختباراتِ المراسمِ (73 اختبارًا):**
   - الأمر:
     ```bash
     XUUX_TPM_SIM=1 TPM2TOOLS_TCTI="swtpm:host=127.0.0.1,port=7200" node --test \
       tests/sim/tpm-ceremony-guard.test.mjs \
       tests/sim/tpm-ceremony-rehearsal.test.mjs \
       tests/sim/tpm-ceremony-remediation.test.mjs \
       tests/sim/tpm-ceremony-wl413-r2.test.mjs \
       tests/sim/tpm-ceremony-wl413-r3.test.mjs
     ```
   - المخرج (المحفوظُ في `logs/ceremony-tests-73.tap`):
     `1..73` — `# tests 73`، `# pass 73`، `# fail 0`، `# cancelled 0`، `# skipped 0`.
   - رمزُ الخروج: `0`.

---

## 3. البندُ ذو الأولويةِ 1: المقابضُ المكررةُ وغيرُ المرتبةِ وإعادةُ هجومِ R3SOL-01

### 3.1 إعادةُ إنتاجِ هجومِ R3SOL-01 بالكامل (`attack-r3sol01-full`)
- **سيناريو الهجومِ الأصلي:**
  يستهدفُ الهجومُ تدميرَ كائنٍ سابقٍ حارسٍ عبرَ:
  1. زرعِ كائنينِ حارسينِ في الذاكرةِ العابرةِ قبلَ البروفة: `0x80000000` و `0x80000001`.
  2. أثناءَ جردِ خطِّ الأساسِ (`SnapshotBaseline`)، يُعادُ جردُ المقابضِ بصفحةٍ مكرّرةٍ تحتوي `[0x80000000, 0x80000000]` بهدفِ إخفاءِ الكائنِ `0x80000001` عن خطِّ الأساس.
  3. عندَ إنشاءِ المفتاحِ الأساسيِّ `CreatePrimary` في المرحلةِ S2، يقومُ المهاجمُ باستبدالِ المقبضِ المُنشأِ بمقبضِ الضحيةِ المخفيّةِ (`0x80000001`).
  4. لولا الحمايةُ، لظنّتِ البروفةُ أنَّ `0x80000001` موردٌ جديدٌ أُنشئَ في هذهِ الجولةِ فتقومُ بتحريرِهِ (`FlushContext`) أثناءَ التنظيفِ، مما يدمّرُ كائنًا لم تنشئْهُ.
- **التنفيذُ عبرَ المسبارِ المستقلِّ (`IndependentFollowupTransport`):**
  - أنشأَ المسبارُ الكائنينِ `0x80000000` و `0x80000001` على المحاكي مباشرةً قبلَ بدءِ المراسم.
  - عندَ أولِ أمرِ `GetCapability(1, 0x80000000, 64)`، حَقَنَ المسبارُ ردًّا مكرّرًا: المقبضان هما `0x80000000` مكرّرًا مرتين.
- **النتيجةُ المقيسةُ بالأدلةِ الخام (`raw/attack-r3sol01-full.json`):**
  - الاستثناءُ المرمي:
    `RESPONSE_CAPABILITY_HANDLE_ORDER_MALFORMED: 0x80000000 after 0x80000000 from 0x80000000 rc=0x00000000`
  - حالةُ التقرير: `status: "FAILED_CLOSED"`.
  - الخطأ: كُسِرَت سلسلةُ الهجومِ تمامًا في مرحلةِ الجردِ؛ ولم يُرسَل أمرُ `CreatePrimary` إطلاقًا.
  - فحصُ بقاءِ الضحايا على المحاكي عقبَ خروجِ البروفة:
    `transientsAfter: ["0x80000000", "0x80000001"]`
  - **النتيجة:** حُوفِظَ على الكائنينِ الحارسينِ تمامًا، وأُحبِطَ هجومُ R3SOL-01 في نقطةِ انطلاقِهِ.

### 3.2 فحصُ أنماطِ التكرارِ والترتيبِ الأخرى
قيسَت الحالاتُ التاليةُ بمخرجاتِها الخام:
1. **تكرارٌ متعدّدٌ داخلَ صفحةٍ واحدة (`inventory-multi-dup-in-page`):**
   - حُقِنَت صفحةٌ تحوي `[0x80000000, 0x80000000, 0x80000000]`.
   - النتيجة: فشلٌ مغلقٌ فوريٌّ بـ `RESPONSE_CAPABILITY_HANDLE_ORDER_MALFORMED: 0x80000000 after 0x80000000 from 0x80000000`.
2. **ترتيبٌ تنازليٌّ للمقابض (`inventory-descending-order`):**
   - حُقِنَت صفحةٌ تحوي `[0x80000001, 0x80000000]` (مقبضٌ أصغرُ تلا مقبضًا أكبر).
   - النتيجة: فشلٌ مغلقٌ فوريٌّ بـ `RESPONSE_CAPABILITY_HANDLE_ORDER_MALFORMED: 0x80000000 after 0x80000001 from 0x80000000`.
3. **تكرارٌ عبرَ صفحتَي جرد (`inventory-duplicate-across-pages`):**
   - أُعيدَت الصفحةُ الأولى بـ `more=1` و `count=1` معَ المقبضِ `0x80000000`. طَلَبَت النواةُ الصفحةَ التاليةَ بدءًا من `0x80000001`، فحَقَنَ المسبارُ `more=0` معَ المقبضِ `0x80000000` مجددًا.
   - النتيجة: فشلٌ مغلقٌ مسمّى: `RESPONSE_CAPABILITY_HANDLE_ORDER_MALFORMED: 0x80000000 after 0x00000000 from 0x80000001` (لأنَّ `0x80000000 < 0x80000001`).
4. **مقبضٌ دونَ نقطةِ البدء (`inventory-handle-below-start`):**
   - طَلَبَ الأمرُ المقابضَ بدءًا من `0x80000000`، فحَقَنَ المسبارُ مقبضًا بقيمةِ `0x7fffffff`.
   - النتيجة: فشلٌ مغلقٌ بـ `RESPONSE_CAPABILITY_HANDLE_CLASS_MALFORMED: 0x7fffffff asked=0x80000000`.
5. **خاصيّةٌ دونَ نقطةِ البدء (`inventory-prop-below-start`):**
   - في جردِ الخصائصِ (قدرة 6) عندَ طلبِ خاصيةٍ `>= 0x00000100`، أُعيدَت الخاصيةُ `0x00000050`.
   - النتيجة: فشلٌ مغلقٌ بـ `RESPONSE_CAPABILITY_PROPERTY_MALFORMED: 0x00000050 < 0x00000105`.
6. **عددُ المقابضِ يفوقُ المطلوب (`inventory-count-exceeds-requested`):**
   - عندَ طلبِ 64 مقبضًا، أُعيدَ ردٌّ يزعمُ إرجاعَ 65 مقبضًا.
   - النتيجة: فشلٌ مغلقٌ بـ `RESPONSE_CAPABILITY_COUNT_MALFORMED: 65 > requested 64`.
7. **إعادةُ استخدامِ مقبضٍ حيٍّ لم يُحرَّر (`handle-reissued-live`):**
   - عندَ تنفيذِ أمرِ `CC_Load`، استُبدِلَ المقبضُ المعادُ بمقبضِ المفتاحِ الأساسيِّ الحيِّ (`0x80000000`).
   - النتيجة: رُفِضَ فورًا داخلَ `AdoptHandle` بالاستثناء:
     `RESPONSE_HANDLE_REISSUED: Load(service-key) 0x80000000 still live in this run (not flushed)`، معَ توقّفٍ مغلقٍ وتتبّعِ الموارد.

---

## 4. البندُ ذو الأولويةِ 2: مطابقةُ نوعِ تفويضِ الردِّ وهرمياتِ التذاكرِ والحقولِ الداخلية

### 4.1 ربطُ ملفِّ تفويضِ الردِّ بنوعِ جلسةِ الطلب (الاتجاهان)
تفرّقُ النواةُ عبرَ دالةِ `ExpectedPasswordSessions` بينَ الأوامرِ المفوّضةِ بكلمةِ سر (`RS_PW`) وتلكَ المفوّضةِ بجلساتِ سياسةٍ:
1. **ملفُّ سياسةٍ على أمرِ كلمةِ سر (`auth-policy-on-password-cmd`):**
   - على أمرِ `NV_DefineSpace` (مفوّض بكلمةِ سر)، حُقِنَ ردُّ تفويضٍ بملفِّ سياسة (`nonceLen=32, attrs=0x00`).
   - النتيجة الخام (`raw/auth-policy-on-password-cmd.json`):
     `RESPONSE_AUTH_CONTENT_MALFORMED: auth#0 nonceLen=32 attrs=0x00 hmacLen=0 expected=password`
     حالة: `FAILED_CLOSED`.
2. **ملفُّ كلمةِ سرٍّ على أمرِ جلسةِ سياسة (`auth-password-on-policy-cmd`):**
   - على أمرِ `NV_Increment` المفوّضِ بجلسةِ سياسة (`s2v.policy:NV_Increment`)، حُقِنَ ردُّ تفويضٍ بملفِّ كلمةِ سر (`nonceLen=0, attrs=0x01`).
   - النتيجة الخام (`raw/auth-password-on-policy-cmd.json`):
     `RESPONSE_AUTH_CONTENT_MALFORMED: auth#0 nonceLen=0 attrs=0x01 hmacLen=0 expected=policy`
     حالة: `FAILED_CLOSED`.
3. **تشويهاتُ ملفِّ السياسةِ (`auth-policy-nonce16` و `attrs08` و `attrs01`):**
   - طولُ nonce غيرُ قياسي (16 بايت): رُفِضَ بـ `RESPONSE_AUTH_CONTENT_MALFORMED: auth#0 nonceLen=16 attrs=0x00 hmacLen=0 expected=policy`.
   - البتُّ المحجوزُ 3 مرفوع (`attrs=0x08`): رُفِضَ بـ `RESPONSE_AUTH_CONTENT_MALFORMED: auth#0 nonceLen=32 attrs=0x08 hmacLen=0 expected=policy`.
   - سمةُ استمرارِ الجلسةِ مرفوعة (`attrs=0x01` في ردٍّ غيرِ مستمر): رُفِضَ بـ `RESPONSE_AUTH_CONTENT_MALFORMED: auth#0 nonceLen=32 attrs=0x01 hmacLen=0 expected=policy`.

### 4.2 هرمياتُ التذاكرِ (CreationTicket & AuthTicket)
وفقًا لمواصفةِ TCG Part 2 (جدول 29 و51)، تُحصَرُ قيمُ `TPMI_RH_HIERARCHY` بأربعِ قيمٍ فقط:
`0x40000001` (Owner)، `0x40000007` (Null)، `0x4000000B` (Endorsement)، و`0x4000000C` (Platform).
- **القيمُ المشروعةُ الأربع:**
  - `creation-ticket-owner`: قُبلت بنجاح (COMPLETE).
  - `creation-ticket-null`: قُبلت بنجاح (COMPLETE).
  - `creation-ticket-endorsement`: قُبلت بنجاح (COMPLETE).
  - `creation-ticket-platform`: قُبلت بنجاح (COMPLETE).
  - وقسْ على ذلك في تذاكرِ `PolicySigned` (`policysigned-ticket-owner/null/endorsement/platform`) حيثُ قُبلت جميعًا بنجاح.
- **القيمُ غيرُ المشروعة:**
  - القيمةُ `0x40000002` (وهي مقبضُ `TPM_RH_REVOKE` وليست هرمية): رُفِضَت صراحةً في `CreatePrimary` بـ `RESPONSE_TICKET_HIERARCHY_MALFORMED: CreatePrimary 0x40000002`، ورُفِضَت في `PolicySigned` بـ `RESPONSE_TICKET_HIERARCHY_MALFORMED: PolicySigned 0x40000002`.
  - المقابضُ `0x40000000` و `0x40000003`: رُفِضَت جميعُها بـ `RESPONSE_TICKET_HIERARCHY_MALFORMED`.

### 4.3 أطوالُ بصماتِ التذاكر (Ticket Digest Lengths)
1. **تذكرةُ الإنشاءِ في `CC_Create` (`create-ticket-digest-*`):**
   - الطولُ القياسيُّ المقيسُ في swtpm هو 64 بايتًا.
   - الطولُ 64 (`create-ticket-digest-64`): قُبلَ واكتملتِ البروفةُ بنجاح (`COMPLETE`).
   - الأطوالُ غيرُ القياسيةِ (0، 1، 32، 65، 100 بايت): رُفِضَت جميعُها بالاستثناءِ المسمّى:
     `RESPONSE_TICKET_DIGEST_MALFORMED: Create len=<N>`.
2. **تذكرةُ التفويضِ في `CC_PolicySigned` (`policysigned-ticket-digest-*`):**
   - الطولُ 64 بايتًا: قُبلَ بنجاح.
   - الطولُ 65 بايتًا: رُفِضَ بالاستثناءِ `RESPONSE_TICKET_DIGEST_MALFORMED: len=65`.

### 4.4 الحقولُ الداخليةُ لبياناتِ الإنشاءِ (CreationData) ومطابقةُ البصمات
1. **عددُ الحقولِ الذيليةِ (`tailFields`):**
   - مواصفةُ Part 2 (جدول 212) تُحدّدُ ثلاثةَ حقولٍ ذيليةٍ حصرًا (`outsideInfo`, `parentName`, `parentQualifiedName`).
   - حقلانِ ذيليانِ (`creation-data-tail-2`): رُفِضَ بـ `RESPONSE_CREATION_DATA_MALFORMED: CreatePrimary tailFields=2 tail=0`.
   - أربعةُ حقولٍ ذيليةٍ (`creation-data-tail-4`): رُفِضَ بـ `RESPONSE_CREATION_DATA_MALFORMED: CreatePrimary tailFields=3 tail=5`.
2. **خوارزميةُ اسمِ الأصلِ (`parentNameAlg`):**
   - لا يُقبلُ إلا `ALG_NULL` (`0x0010`) لـ CreatePrimary أو `ALG_SHA256` (`0x000B`) لمفتاحٍ ابن.
   - قيمةُ `0xFFFF` (`creation-data-parentalg-ffff`): رُفِضَت بـ `parentNameAlg=0xffff`.
   - قيمةُ `ALG_SHA1` (`0x0004`): رُفِضَت بـ `parentNameAlg=0x0004`.
3. **بصمةُ PCR الفارغةُ السائغة (`creation-data-pcr-empty-valid`):**
   - وفقًا لنصِّ جدول 222 في Part 2: عندَ قائمةِ PCR فارغة (`count=0`)، يجوزُ أن يكونَ طولُ البصمةِ 0 بايتًا، كما يجوزُ 32 بايتًا.
   - المسبارُ حَقَنَ `count=0` و `pcrDigest.len=0`: قُبِلَت واكتملتِ البروفةُ (`COMPLETE`) دونَ أيِّ إخفاق (معالجةُ انحسارِ R3SOL-05).
   - بينما طولٌ غيرُ قياسي (`dlen=16`): رُفِضَ بـ `pcrDigest len=16`.
4. **اتساقُ بصمةِ الإنشاء (`creationhash-mismatch`):**
   - عندَ قلبِ بايتٍ واحدٍ في `creationHash` ليعاكسَ بصمةَ SHA-256 لبياناتِ الإنشاء:
     رُفِضَ بـ `RESPONSE_CREATION_HASH_MISMATCH: CreatePrimary`.
5. **مطابقةُ اسمِ المفتاحِ في Load (`load-name-mismatch`):**
   - عندَ قلبِ بايتٍ في الاسمِ المعادِ في ردِّ `CC_Load`:
     رُفِضَ بـ `RESPONSE_NAME_HASH_MISMATCH: Load`.
6. **فراغُ مهلةِ PolicySigned عند expiration=0 (`policysigned-timeout-nonzero-exp0`):**
   - عندَ expiration=0، لا قيدَ توقيتَ زمنيًّا، فحَقَنَ المسبارُ 8 بايتاتٍ في حقلِ timeout.
   - رُفِضَ بـ `RESPONSE_POLICY_TIMEOUT_MALFORMED: len=8 at expiration=0`.

---

## 5. البندُ ذو الأولويةِ 3: الجردُ بعدَ خطِّ أساسٍ جزئيٍّ واختبارُ R3-18

### 5.1 القياسُ المستقلُّ لمسبارِ خطِّ الأساسِ الجزئيِّ (`baseline-partial-transient`)
- **وصفُ الاختبار:**
  أثناءَ التقاطِ خطِّ الأساسِ في `SnapshotBaseline`، وبعدَ اكتمالِ جردِ فهارسِ NV بنجاح، يُحقَنُ ردٌّ مشوّهٌ عندَ استعلامِ مقابضِ الذاكرةِ العابرةِ (`GetCapability` على `0x80000000`) بإعادةِ مقبضٍ من فئةِ NV (`0x01000001`).
- **المخرجاتُ المقيسةُ بالأدلةِ الخام (`raw/baseline-partial-transient.json`):**
  - حالةُ التقرير: `status: "FAILED_CLOSED"`.
  - سببُ الفشل:
    `RESPONSE_CAPABILITY_HANDLE_CLASS_MALFORMED: 0x01000001 asked=0x80000000 rc=0x00000000`
  - مصفوفةُ الخطواتِ: لم يُرسَل أيُّ أمرٍ مُغيّرٍ للحالةِ إطلاقًا (`STATE_CHANGING`).
  - التحقّقُ من الجردِ النهائي:
    - `postRunInventory.verified`: `false` (لم يُعلَنْ موثوقًا).
    - `postRunInventory.error`: `"partial baseline: run stopped during the baseline snapshot (transients/sessions baseline absent)"`.
    - `cleanupLeftovers`: `["post-run inventory not comparable: partial baseline; residual state unknown"]`.
  - **النتيجة:** انتفاءُ الإعلانِ الكاذبِ عن الموثوقيةِ عندَ توقّفِ خطِّ الأساسِ جزئيًّا.

### 5.2 التحققُ من وجودِ اختبارِ الحقنِ المخصّصِ في حزمةِ الشجرة (الالتزام `3e67d362`)
- ثبُتَ بمراجعةِ الكوميتِ `3e67d362` وجودُ التالي:
  1. وضعُ حقنٍ مخصّصٌ `baseline-partial` في `tests/helpers/TpmCeremonyFaultTransport.cs` يُحاكي هذا العائقَ بدقّة.
  2. اختبارُ رجوعٍ رسميٌّ `R3-18` في `tests/sim/tpm-ceremony-wl413-r3.test.mjs` بعنوان:
     `R3-18: خطُّ الأساسِ الجزئيُّ ⇒ فشلٌ مسمّى ولا يُدَّى جردٌ موثوقٌ ولا تُقارَنُ البقايا`.
  3. شُغِّلَ الاختبارُ ضمنَ الحزمةِ واجتازَ بنجاح:
     `ok 73 - R3-18: خطُّ الأساسِ الجزئيُّ ⇒ فشلٌ مسمّى ولا يُدَّى جردٌ موثوقٌ ولا تُقارَنُ البقايا`.
  4. بذلك سُدَّت الفجوةُ التوثيقيةُ والتغطيتيةُ التي أعلنها العضوُ `gpt_6_1_sol` كقيدٍ في الجولةِ السابقة.

---

## 6. البندُ ذو الأولويةِ 4: التنظيفُ بعدَ فقدِ الردودِ وحفظُ المواردِ الأجنبية

### 6.1 الفقدُ الفعليُّ لردِّ التعريفِ وعدمُ الحذفِ التلقائيِّ (`define-response-loss-actual`)
- **آليةُ المسبار:**
  أُرسِلَ أمرُ `CC_NV_DefineSpace` إلى المحاكي ونُفِّذَ فعليًّا (أُنشئَ الفهرسُ `0x01aba7a6` على المحاكي برمزِ نجاحٍ 0)، ثمّ قامَ ناقلُ الحقنِ بإسقاطِ الردِّ تمامًا ورمي استثناءِ انقطاعِ نقلٍ `IOException("INDEPENDENT_SIMULATED_CARRIER_DROP_AFTER_EXECUTION")`.
- **النتائجُ المقيسةُ بالأدلةِ الخام (`raw/define-response-loss-actual.json`):**
  - حالةُ التقرير: `status: "FAILED_CLOSED"`.
  - سببُ الفشل:
    `OUTCOME_UNKNOWN: s1.probe:NV_DefineSpace (IOException: INDEPENDENT_SIMULATED_CARRIER_DROP_AFTER_EXECUTION)`
  - سجلُّ المصالحةِ (`reconciliation`):
    `"nv-define 0x01aba7a6: exists with definition matching this run's request; the define reply was lost or unusable so execution and ownership cannot be proven (an identical pre-existing index is indistinguishable); left in place"`
  - بقايا التنظيفِ (`cleanupLeftovers`):
    `"nv 0x01aba7a6: ownership-undetermined (define reply lost; matching publicArea is not proof); left in place"`
  - **السلوكُ الماديُّ على المحاكي:**
    لم يُرسَل أيُّ أمرِ `NV_UndefineSpace` في مرحلةِ التنظيف؛ حيثُ بيّنَ الجردُ النهائيُّ المباشرُ للمحاكي بقاءَ الفهرس:
    `nvAfter: ["0x01aba7a6"]`.
  - **الحكم:** تطابقٌ تامٌّ مع قرارِ المالكِ الهرميِّ (`G47-413-1`) المنصوصِ عليه في ADR 0007 (§12.5): «المطابقةُ البايتيةُ بعدَ فقدِ الردِّ إثباتُ تطابقٍ لا إثباتُ ملكيّة، ولا حذفَ دونَ حسمِ الملكية».

### 6.2 صونُ المواردِ غيرِ المملوكةِ للبروفة (`foreign-nv-preservation`)
- **آليةُ المسبار:**
  زَرَعَ المسبارُ فهرسَ NV أجنبيًّا برقمِ `0x01800099` في ذاكرةِ المحاكي قبلَ إطلاقِ البروفةِ إطلاقًا.
- **النتائجُ المقيسةُ بالأدلةِ الخام (`raw/foreign-nv-preservation.json`):**
  - فهارسُ NV قبلَ البروفة: `nvBefore: ["0x01800099"]`.
  - نُفِّذَت كافةُ مراحلِ البروفةِ الاعتياديةِ حتى الاكتمال (`status: "COMPLETE"`).
  - قامتِ البروفةُ بتعريفِ فهارسِها ثمّ زيادةِ عداداتِها ثمّ قراءتِها ثمّ حذفِ فهارسِها الخاصةِ فقط.
  - فهارسُ NV بعدَ اكتمالِ البروفةِ والتنظيف: `nvAfter: ["0x01800099"]`.
  - **الحكم:** حُوفِظَ على الفهرسِ الأجنبيِّ بالكامل، ولم تمسَّهُ أو تحذفْهُ البروفةُ لكونِهِ غيرَ مسجّلٍ في دفترِ تعريفاتِها.

---

## 7. البندُ ذو الأولويةِ 5: عملياتُ swtpm اليتيمة (Zero Orphan Processes)

في جولةِ de099aa8 السابقة، رَصَدَ المراجعونَ الثلاثةُ تسرّبَ 21 عمليةَ `swtpm` يتيمةً عقبَ تشغيلِ حزمةِ الاختباراتِ بسببِ قيامِ دالةِ `stopSim` بحذفِ مجلدِ الحالةِ دونَ قتلِ المعرّفِ.
في هذا التقييم، أُجريَ قياسٌ صارمٌ وفوريٌّ لعددِ العملياتِ:
1. **القياسُ عبرَ 46 مسبارَ حقنٍ مستقل:**
   - قيسَ عددُ عملياتِ `swtpm` قبلَ وبعدَ كلِّ مسبارٍ في السكربتِ `run-all-probes.sh`.
   - سُجِّلَ في `logs/orphan_tracking.log`:
     `CLEAN: 0 orphan processes` في جميعِ الجولاتِ الـ 46 دونَ استثناءٍ واحد.
2. **القياسُ عقبَ حزمةِ اختباراتِ المراسمِ الكاملة (73 اختبارًا):**
   - شُغِّلَت كافةُ اختباراتِ المراسمِ الـ 73 عبرَ `node --test`.
   - فُحِصَت العملياتُ فورَ انتهاءِ الأمرِ بـ `ps aux | grep swtpm | grep -v grep`.
   - النتيجة: لم تبقَ أيُّ عمليةٍ يتيمةٍ تعودُ للاختباراتِ، ولم تُرصَد إلا العمليةُ المشتركةُ السابقةُ على المنفذ 2321.
3. **التثبّتُ من الشيفرةِ المصدرية:**
   - أظهرت مراجعةُ `tests/sim/tpm-ceremony-wl413-r3.test.mjs` (الأسطر 65-72) أنَّ دالةَ `stopSim` أصبحت ترسلُ صراحةً:
     ```javascript
     function stopSim(s) {
       try { process.kill(s.pid, 'SIGTERM'); } catch { /* انتهى */ }
       try { rmSync(s.dir, { recursive: true, force: true }); } catch { /* أفضلُ جهد */ }
     }
     ```
   - **الحكم:** عولجَ تسريبُ العملياتِ جذريًّا، وثبُتَ بالقياسِ الفوريِّ انعدامُ أيِّ عمليةٍ يتيمةٍ (0).

---

## 8. البندُ ذو الأولويةِ 6: مطابقةُ نصوصِ المصالحةِ ونموذجِ التهديدِ وADR 0007 (§12.5)

قارنّا نصوصَ الشيفرةِ ونموذجَ التهديدِ والوثائقِ بالمخرجاتِ المقيسةِ فعليًّا:
1. **نصُّ المصالحةِ عندَ فقدِ ردِّ التعريف:**
   - الشيفرة (`TpmCeremonyCore.cs` سطر 1673):
     `"exists with definition matching this run's request; the define reply was lost or unusable so execution and ownership cannot be proven (an identical pre-existing index is indistinguishable); left in place"`
   - الوثائق (`sim/tpm-ceremony/README.md` و `docs/THREAT_MODEL.md` سطر 287 و ADR 0007 جدول §12.5):
     تُؤكّدُ حرفيًّا أنَّ المطابقةَ البايتيةَ بعدَ الردِّ المفقودِ إثباتُ تطابقٍ معَ الطلبِ لا ملكيّةٍ، وأنَّ الفهرسَ يُتركُ بمكانِهِ ولا يُحذف.
   - مسبارُ القياس (`raw/define-response-loss-actual.json`):
     أظهرَ التطابقَ البايتيَّ الحرفيَّ التامَّ معَ هذا النص.
2. **تصحيحُ نصِّ محاولةِ التنظيفِ المحدودةِ في ردودِ الحذفِ المفقودة:**
   - عُدِّلَ النصُّ السابقُ المتناقضُ (`cleanup attempt budget already spent`) ليصبحَ في `TpmCeremonyCore.cs` (سطر 1703 و1716):
     `"still present; deletion outcome unknown; left for the bounded cleanup attempt (declared as leftover if it remains)"`
     وهو ما يُطابقُ حقيقةَ أنَّ محاولةَ الحذفِ المحدودةَ تتبعُ هذا الفحصَ ولا تسبقُهُ.
3. **تصحيحُ نصِّ غيابِ مقبضِ كائنِ Create:**
   - استُبدِلَ الظنُّ القديمُ غيرُ الدقيقِ (`likely not executed`) بالنصِّ المتسقِ مع مواصفةِ TCG Part 3 §12.1 في `TpmCeremonyCore.cs` (سطر 1728):
     `"no new handle since baseline (execution undetermined from handle inventory; Create returns no object handle and a created object may have been flushed by another party)"`
4. **التحذيرُ من التعميم:**
   - نُؤكّدُ التزامًا بالتكليفِ عدمَ تعميمِ قياساتِ تحليلِ الردودِ؛ ففحصُ التفويضِ مقيسٌ بدقّةٍ على ملفَّي البروفةِ المعتمدينِ (`RS_PW` وجلساتِ السياسةِ التجريبيةِ)، ولا يُسقَطُ ادّعاءُ دعمِ جلساتِ HMAC أو جلساتِ التشفيرِ/فكِّ التشفيرِ غيرِ المشمولةِ في بروفةِ S1/S2.

---

## 9. البندُ ذو الأولويةِ 7: حاجزُ القوالبِ وقائمةُ السماحِ (Template Barrier & Allowlist)

1. **فحصُ فرقِ الالتزاماتِ (`d9e1dc3b..3e67d362`):**
   - أظهرَ تدقيقُ سجلِّ `git log -p d9e1dc3b..3e67d362 -- docs/audit/template-allowlist.txt` ما يلي:
     - في الكوميتِ `0ba77606`، أُضيفت مؤقّتًا ثلاثةُ ملفاتِ أدلةٍ فارغةٍ من مخرجاتِ أحدِ مراجعي الجولةِ السابقة إلى قائمةِ السماح.
     - في الكوميتِ التالي مباشرةً `673c8c88`، استُبعِدَت تلكَ الملفاتُ الفارغةُ كليًّا من حزمةِ الجولةِ وحُذِفَت أسطرُها من `template-allowlist.txt` صيانةً لحاجزِ القوالبِ ومنعًا لتمييعِ استثناءاتِهِ.
     - عندَ الرأسِ `3e67d362`، لم يطرأ أيُّ توسيعٍ للاستثناءاتِ (الفرقُ عن `d9e1dc3b` صفرُ أسطرٍ عدا سطرٍ فارغٍ أخير).
2. **التحقّقُ البرمجيُّ التامُّ بحاجزِ القوالب:**
   - الأمرُ: `npm run guard:templates` داخلَ الشجرةِ المعزولةِ.
   - المخرج:
     ```
     ═══ حاجز القوالب (M1.08) ═══
     ملفات مفحوصة: 2526
     استثناءات معلنة ومطابقة: 109
     ملفات بمخرج هروب معلَن (template-guard:allow): 1
       · docs/roadmap/05-work-log.md
     مداخل إذنٍ متروكة (لا ملفَّ لها أو غير متعقَّبة): 0
     مخالفات: 0

     ✅ لا ملفات قالبية فارغة في المستودع.
     ```
   - رمزُ الخروج: `0`.
   - **الحكم:** التزامٌ تامٌّ بحاجزِ القوالبِ دونَ أيِّ تجاوزٍ أو توسيعٍ غيرِ مبرّر.

---

## 10. حدودُ البيئةِ، وحدودُ الاستقلالِ التقنيِّ، وما لم يُقَس

إبراءً للذمّةِ العلميةِ وتحديدًا للنطاق:
1. **حدودُ البيئةِ:**
   - نُفِّذَتِ المراجعةُ على منصّة Linux x86_64 مع محاكي `swtpm 0.10.1`.
   - استُخدِمَت نسخةُ `PowerShell 7.7.0-preview.5` المتاحةُ في بيئةِ التشغيل (وهو انحرافٌ مُوثّقٌ عن 7.4).
   - مسارُ Windows في فحصِ مقابسِ المحاكي (`Get-NetTCPConnection`) داخلَ `rehearse.ps1` مكتوبٌ كودًا لكنّه لم يُقَس تجريبيًّا لعدمِ توفّرِ بيئةِ ويندوز.
2. **حدودُ الاستقلالِ التقنيِّ المتبقية:**
   - اشتركَ المراجعُ في بيئةِ الحاويةِ العامةِ مع المنظومةِ، إلا أنّه عزلَ شجرةَ الكودِ بنسخِها كاملةً إلى دليلهِ الخاصِّ، وشيّدَ مسابرَهُ المستقلّةَ من الصفرِ، واستخدمَ حصريًّا المنفذَ المسندَ له (`7200` ومقبسَ التحكّم `7201`)، ولم يطّلعْ على أيِّ ملفٍ خارجَ دليلهِ تحتَ `/tmp/wl414-followup/reviewers/`.
3. **ما لم يُقَس:**
   - لم يُرسَل أيُّ أمرٍ على TPM حقيقيٍّ ولم يُلمَس `/dev/tpm*` إطلاقًا التزامًا بعقدِ المشروعِ وتفويضِ المالك.
   - لم تُنفَّذ المراسمُ على شرائحِ إنتاجٍ فيزيائيةٍ (S1 Hardware)، ولم تبدأ مراحلُ S3 أو S4 أو S5 بانتظارِ قرارِ المالكِ المباشر.
   - البندانِ المعلقانِ `R3-A-01` و `EXT-6` تُركا مفتوحينِ كما نصَّ التكليف.

---

## 11. فهرسُ المسابرِ والأدلةِ المرفقةِ في الدليل

كافةُ الملفاتِ والأدلةِ متوفّرةٌ تحتَ `/tmp/wl414-followup/reviewers/gemini_3_8_flash/`:
- **`probes/IndependentFollowup.cs`**: مصدرُ ناقلِ الحقنِ والمشغّلِ المستقلِّ لكافةِ الحالاتِ الـ 46.
- **`probes/IndependentFollowup.exe`**: الملفُّ التنفيذيُّ المبنيُّ بمترجمِ `mcs` ومربوطٌ بـ `TpmCeremonyCore.cs`.
- **`probes/run-all-probes.sh`**: سكربتُ التشغيلِ الآليِّ وتتبّعِ العملياتِ وتوليدِ المخرجات.
- **`logs/commands.log`**: سجلُّ أوامرِ إطلاقِ المحاكياتِ والمسابرِ ورموزِ خروجِها.
- **`logs/orphan_tracking.log`**: السجلُّ الفوريُّ لقياسِ العملياتِ اليتيمةِ لكلِّ مسبار.
- **`logs/probe-summary.json`**: التلخيصُ الهيكليُّ الشاملُ لنتائجِ المسابرِ الـ 46.
- **`logs/ceremony-tests-73.tap`**: مخرجاتُ تشغيلِ حزمةِ اختباراتِ المراسمِ الكاملة (73/73 نجاحًا).
- **`rehearsal.json`** و **`raw/rehearsal.json`**: تقريرُ تشغيلِ البروفةِ الرسميةِ بـ `rehearse.ps1` على المنفذ 7200.
- **`raw/*.json`** و **`raw/*.exit`** و **`raw/*.stderr`**: 46 زوجًا من ملفاتِ المخرجاتِ الخامِ المفصلةِ لكلِّ مسبار.
