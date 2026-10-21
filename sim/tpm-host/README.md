# `sim/tpm-host/` — جردُ TPM على مضيفِ Windows (للقراءةِ فقط) — WL-410

أداةُ مضيفٍ **منفصلةٌ** عن `sim/tpm/`. أداةُ المحاكاةِ هناك تبقى مقيّدةً بـ`assertSimulatorTcti`
(لم يُمَسَّ ولم يُخفَّف)، وهذه الأداةُ لا تستعملُ `tpm2-tools` ولا أيَّ TCTI ولا WSL: تتكلّمُ مع
الشريحةِ عبرَ **TBS** (‏Windows TPM Base Services) وحدَها، وهي الواجهةُ المدعومةُ التي تطبّقُ قائمةَ
السماحِ الحقيقيةَ لأوامرِ TPM 2.0.

> **حدٌّ مُعلَن:** كلُّ ما في هذا المجلّدِ قيسَ على المحاكي `swtpm` في الحاوية فقط. لم يُشغَّلْ شيءٌ
> منه على المضيف. «نجاحُ» الاختباراتِ هنا يُثبِتُ سلوكَ الأداةِ والمُفسِّر، لا خصائصَ شريحةِ
> SLB9670 ولا سلوكَ TBS على اللابتوب.

## الملفّات

| الملف | الدور |
|---|---|
| `win_tpm_inventory.ps1` | الأداةُ التي يُشغِّلُها المالك. معاملٌ واحدٌ اختياريٌّ: `-OutDir`. |
| `TpmInventoryCore.cs` | النواة (C# 5 — تُترجَمُ بـ`Add-Type` في Windows PowerShell 5.1 بلا تثبيت): الحارسُ، بناءُ الأوامر، نقلُ TBS، الجرد، التسلسل. |
| `decode_inventory.mjs` | مُفسِّرٌ بـNode يقرأُ الملفَّ الناتجَ ويعيدُ تفسيرَ كلِّ ردٍّ من بايتاتِه الخامّة. |

## ما تقرؤه الأداة

1. **`Get-Tpm`** — حقولٌ مسمّاةٌ صراحةً فقط (‏`TpmPresent`، `TpmReady`، `TpmEnabled`، `TpmActivated`،
   `TpmOwned`، `RestartPending`، `ManufacturerId[Txt]`، `ManufacturerVersion[Full20]`، `ManagedAuthLevel`،
   `OwnerClearDisabled`، `AutoProvisioning`، `LockedOut`، `LockoutHealTime`، `LockoutCount`، `LockoutMax`).
   **`OwnerAuth` ليس منها ولا يُنقَلُ أبداً.** يتطلّبُ عادةً جلسةً مرفوعة؛ إن فشلَ سُجِّلَ سببُ الفشلِ ولم
   يُستعَضْ عنه بشيء.
2. **`Tbsi_GetDeviceInfo`** — إصدارُ TPM ونوعُ الواجهةِ ومراجعةُ التنفيذِ كما تراها TBS
   ([Microsoft Learn](https://learn.microsoft.com/en-us/windows/win32/api/tbs/nf-tbs-tbsi_getdeviceinfo)).
3. **سياقُ TBS** بـ`Tbsi_Context_Create` و`TBS_CONTEXT_PARAMS2` (‏`includeTpm20`)
   ([Microsoft Learn](https://learn.microsoft.com/en-us/windows/win32/api/tbs/ns-tbs-tbs_context_params2))،
   ثمّ أمرانِ للقراءةِ فقط عبرَ `Tbsip_Submit_Command`
   ([Microsoft Learn](https://learn.microsoft.com/en-us/windows/win32/api/tbs/nf-tbs-tbsip_submit_command)):
   - `TPM2_GetCapability` (‏`0x17A`): الخصائصُ الثابتة (من `0x100`) والمتغيّرة (من `0x200`) كلٌّ على
     حدة، ومقابضُ فهارسِ NV (من `0x01000000`)، والأوامرُ المنفَّذةُ في الشريحة (`TPM_CAP_COMMANDS`)،
     والخوارزميات، ومنحنياتُ ECC. ترقيمٌ بـ64 عنصراً/صفحة، 16 صفحةً حدّاً، وتقدّمٌ صارمٌ (لا حلقة).
   - `TPM2_NV_ReadPublic` (‏`0x169`): المنطقةُ **العامّة** لكلِّ فهرسٍ موجود (السماتُ، الحجمُ، خوارزميةُ
     الاسم، السياسة) — حتى 64 فهرساً. **لا يُقرأُ محتوى أيِّ فهرس** (‏`NV_Read` ممنوع).
4. لكلِّ استعلام: رمزُ TBS، ورمزُ ردِّ TPM، والطلبُ والردُّ **خامّينِ بالسداسي**، وسببُ الفشلِ إن وقع.
5. بصمتا SHA-256 للأداةِ والنواة، وكوميتُ git (قراءةً: `rev-parse` و`status --porcelain`)، وهل الجلسةُ مرفوعة.

## الضمانات (وما يحرسُها)

- **الحارس `TpmGuard.AssertAllowedCommand`** يُطبَّقُ على نسخةٍ من الطلبِ **قبلَ** النداءِ الأصليّ
  (‏`GuardedTransport.Submit` غيرُ قابلٍ للتجاوز): الوسمُ `TPM_ST_NO_SESSIONS` حصراً (لا جلساتِ تفويض)،
  والحجمُ المعلنُ = طولُ البايتات، و`GetCapability` بـ22 بايتاً تماماً وقدراتٍ خمسٍ مسمّاة وعددٍ 1..256
  ومقابضَ في مجالِ NV فقط، و`NV_ReadPublic` بـ14 بايتاً تماماً ومقبضٍ في مجالِ NV. وكلُّ ما عدا ذلك يُرفَضُ
  بـ`XUUX_TPM_COMMAND_NOT_ALLOWED` ولا يبلغُ TBS.
- **لا شيءَ يُغيِّرُ الحالة:** لا `Clear-Tpm`، لا `Initialize-Tpm`، لا تعريفَ/زيادةَ/حذفَ فهارس، لا
  `ownerAuth`/`lockoutAuth`، لا سجلّ، لا خدمات، لا جدارَ حماية، لا `.wslconfig`، لا تنزيل، لا تغييرَ
  لسياسةِ التنفيذ. الأثرُ الوحيدُ: ملفُّ JSON في `-OutDir` (ومِلفّاتُ ترجمةٍ مؤقّتةٌ يُنشئُها `Add-Type`
  في `%TEMP%` ويحذفُها).
- **لا سقوطَ إلى محاكاة:** على غيرِ Windows تخرجُ الأداةُ بـ2 (‏`NOT_WINDOWS`) بلا ملفّ. النقلُ إلى
  `swtpm` موجودٌ في `tests/helpers/` فقط ولا تُحمِّلُه الأداة.
- يحرسُ ذلك `tests/sim/tpm-host-guard.test.mjs` (فحصٌ نصّيٌّ + تحميلُ النواةِ الحقيقيةِ في `pwsh` ورفضُ
  كلِّ كودِ أمرٍ في `0x11F..0x1A0` عدا الشكلَين + تشغيلٌ على swtpm)، و`tests/sim/tpm-host-decode.test.mjs`
  (المُفسِّرُ على ملفِّ محاكٍ ثابتٍ وحالاتٍ مفقودة/تالفة/مجهولة).

## أمرُ المالك

من جذرِ نسخةِ المستودعِ على المضيف (على كوميتِ هذا الفرع)، في PowerShell عاديٍّ أو مرفوع:

```powershell
powershell -NoProfile -File .\sim\tpm-host\win_tpm_inventory.ps1
```

لا يتضمّنُ الأمرُ `-ExecutionPolicy Bypass` عمداً: تجاوزُ سياسةِ التنفيذِ قرارٌ للمالكِ لا للأداة. إن
رفضَتْه السياسةُ فالرسالةُ نفسُها هي النتيجةُ المطلوبة.

## رموزُ الخروجِ والحالة

| الرمز | الحالة | المعنى |
|---|---|---|
| 0 | `COMPLETE` | كلُّ الاستعلاماتِ وصلَت وأجابَ عنها TPM بنجاح، وكلُّ ترقيمٍ اكتمل. |
| 1 | `PARTIAL` | استعلامٌ أو أكثرُ رُفِضَ من TBS (مثل `TPM_E_COMMAND_BLOCKED` ‏`0x80280400`) أو من TPM، أو انقطعَ ترقيم. الأسبابُ في الملف. |
| 2 | `NOT_WINDOWS` | لا جردَ ولا بديل. |
| 3 | `TBS_CONTEXT_UNAVAILABLE` | تعذّرَ فتحُ سياقِ TBS — لم يُرسَلْ أيُّ أمر. |
| 4 | `TOOL_ERROR` | عطلٌ في الأداة (تحميلُ النواة — مثلاً وضعُ اللغةِ المقيَّد — أو الكتابة). |

التفسير: `node sim/tpm-host/decode_inventory.mjs <file.json>` (خروجٌ 0 بلا أخطاء، 1 بأخطاءٍ مسمّاة، 2 ملفٌّ
غيرُ مقروء). المُفسِّرُ يُعيدُ حسابَ الاكتمالِ من البايتات، ويصنّفُ الدليلَ `hardware-tbs` فقط إن كان
النقلُ `tbs`، ويكشفُ أيَّ طلبٍ في الملفِّ خارجَ قائمةِ السماح.

## ما لا يمكنُ لهذه الأداةِ إثباتُه (حدودٌ معلنة)

- **قائمةُ سماحِ TBS لأوامرِ الكتابة.** في TPM 2.0 القائمةُ ثابتةٌ في المشغِّلِ منذ Windows 10 1809،
  منفصلةٌ للمسؤولِ والمستخدمِ وAppContainer، ولا تُقرأُ ببرمجيّةٍ موثّقة
  ([Microsoft Learn — Command blocking](https://learn.microsoft.com/en-us/windows/win32/tbs/command-blocking)).
  نجاحُ `GetCapability`/`NV_ReadPublic` يُثبِتُ السماحَ بهما **لهذا الحسابِ** فقط. أمّا `NV_DefineSpace`
  و`NV_Increment` و`NV_Certify` فلا تُقاسُ إلا بإرسالِها — وهذا ممنوعٌ هنا.
- **`Win32_Tpm.IsCommandBlocked` مستبعَد:** يقرأُ مفاتيحَ سجلِّ قوائمِ الحظرِ (نموذجُ TPM 1.2)
  ([Microsoft Learn](https://learn.microsoft.com/en-us/windows/win32/secprov/iscommandblocked-win32-tpm))،
  فلا يدلُّ على قائمةِ سماحِ 2.0 — وهو بالضبطِ «التخمينُ من إعداداتِ Windows» المرفوض.
- **`TPM_CAP_COMMANDS` ≠ قائمةُ السماح:** هو ما **تنفّذُه الشريحة**؛ قد ينفّذُ الأمرَ وتحجبُه TBS.
- **السعةُ الحرّة:** لا خاصيّةَ في TPM 2.0 تعطي بايتاتِ NV الحرّة. `TPM_PT_NV_INDEX_MAX` حدُّ حجمِ
  بياناتِ الفهرسِ الواحد، و`TPM_PT_HR_NV_INDEX` عددُ الفهارسِ المعرَّفة — وكلاهما ليس «مساحةً متاحة».
- **`TPM_PT_NV_COUNTERS_AVAIL`** يعدُّ العدّاداتِ الإضافيّةَ ذاتَ `TPMA_NV_ORDERLY` المضبوطة، تقديراً
  ([TCG Part 2 r1.38](https://trustedcomputinggroup.org/wp-content/uploads/TPM-Rev-2.0-Part-2-Structures-01.38.pdf))؛
  ومرساةُ ADR 0007 §4.1 تشترطُ `ORDERLY = 0`، فليس مقياساً لها.
- **صفرُ `TPM_PT_NV_COUNTERS_MAX`:** في r1.59 تقولُ NOTE 2 «لا حدَّ أقصى ثابتاً»
  ([TCG Part 2 r1.59](https://trustedcomputinggroup.org/wp-content/uploads/TCG_TPM2_r1p59_Part2_Structures_pub.pdf))،
  وهذه الملاحظةُ **غائبةٌ عن النصِّ الأصليِّ لـr1.38** الذي تعلنُها SLB9670 (ADR 0007 annex A) — لكنّ إراتا
  r1.38 (البندُ 2.22، مؤكَّدةٌ في v1.8 بتاريخ 2019-07-12 فأحدث) **تضيفُها**، والشريحةُ تعلنُ تاريخَ آخرِ
  إراتا تطبّقُها في `TPM_PT_YEAR`/`TPM_PT_DAY_OF_YEAR`. فالمُفسِّرُ يربطُ الدلالةَ بالمستوى المعلَنِ كلِّهِ:
  الصفرُ مع r1.59 فأحدث «لا حدَّ أقصى ثابتاً»، ومع r1.38 وتاريخِ إراتا ≥ 2019-07-12 كذلك؛ وما عدا ذلك
  «غيرُ مثبَتٍ من المعلَن» — لا «غيرُ مدعوم» ولا «بلا حد». والقيمةُ الموجبةُ حدٌّ أعلى لا سعةٌ حرّة.
- **رتابةُ العدّادِ عبرَ الحذفِ وإعادةِ التعريف، وتوفّرُ تفويضِ هرمِ التخزين** — تحتاجُ عملياتٍ تغيّرُ
  الحالة، خارجَ هذه الأداة.
