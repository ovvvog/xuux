# سجل إحالات ADR 0007 — gpt_6_1_sol

قراءة مباشرة للوثائق التي أحال إليها ADR 0007؛ لم أستخدم شبكة GitHub، ولم أفتح تقارير أعضاء أو مصفوفات مقارنة.

## TCG — Part 3، Revision 01.64، 2020-12-24

الرابط: https://trustedcomputinggroup.org/wp-content/uploads/TCG_TPM2_r1p64_Part3_Commands_15may2021.pdf

- §31.2 «NV Counters»، ص367: “When an NV counter is created, the TPM shall initialize the 8-octet counter value with a number that is greater than any count value for any NV counter on the TPM since the time of TPM manufacture.” ([TCG Part 3 r1.64](https://trustedcomputinggroup.org/wp-content/uploads/TCG_TPM2_r1p64_Part3_Commands_15may2021.pdf))
- §31.8 «TPM2_NV_Increment»، ص384: زيادة واحد، وتعيين `TPMA_NV_WRITTEN`؛ و§31.2 يصف رفع قيمة عدّاد `ORDERLY` بعد انقطاع غير منظّم، لا وعد مساواة القيمة التالية دائمًا بالقيمة السابقة زائد واحد عند كل عطب. ([TCG Part 3 r1.64](https://trustedcomputinggroup.org/wp-content/uploads/TCG_TPM2_r1p64_Part3_Commands_15may2021.pdf))

## TCG — Part 1، Revision 01.07، 2014-03-13

الرابط: https://trustedcomputinggroup.org/wp-content/uploads/TPM-Rev-2.0-Part-1-Architecture-01.07-2014-03-13.pdf

- §37.2.4.3 «Counter Hybrid Indices»، ص208، و§37.2.6.3 «NV Counter Index»، ص210–211: رتابة القراءة؛ `ORDERLY` قد يتقدّم بقفزة عند إقلاع غير منظّم؛ والزيادة الأولى تهيّئ عدّادًا لم يحمل قيمة بعد. ([TCG Part 1 r1.07](https://trustedcomputinggroup.org/wp-content/uploads/TPM-Rev-2.0-Part-1-Architecture-01.07-2014-03-13.pdf))
- §37.2.6.3، ص211: “a counter with a particular Name cannot be rolled back by deleting it and redefining it”. ([TCG Part 1 r1.07](https://trustedcomputinggroup.org/wp-content/uploads/TPM-Rev-2.0-Part-1-Architecture-01.07-2014-03-13.pdf))
- §37.7.1 «Power Interruption»، ص219: “A TPM is not required to maintain the integrity of the data in an NV Index if a power loss interrupts the write. After the interruption, the TPM should indicate that the Index no longer exists.” ([TCG Part 1 r1.07](https://trustedcomputinggroup.org/wp-content/uploads/TPM-Rev-2.0-Part-1-Architecture-01.07-2014-03-13.pdf))

## TCG — Part 1، Revision 01.50، 2018-09-18، نسخة مراجعة عامة

الرابط: https://trustedcomputinggroup.org/wp-content/uploads/TPM_Rev2.0_Part1_Architecture_r1.50_publicreview.pdf

- §16 «Names»، ص80: “The Name associated with an NV Index will change based on changes to the attributes of the Index.” ثم يذكر تغير الاسم عندما تصير `TPMA_NV_WRITTEN` معيّنة. ([TCG Part 1 r1.50](https://trustedcomputinggroup.org/wp-content/uploads/TPM_Rev2.0_Part1_Architecture_r1.50_publicreview.pdf))
- §37.2.6.3، ص219–220: الفهرس المنشأ ليس له محتوى قابل للقراءة بعد؛ الزيادة الأولى تعيّن `WRITTEN`؛ ضمان الرتابة لا يساوي ضمان عدم فقد الفهرس عند جميع أعطال الطاقة. ([TCG Part 1 r1.50](https://trustedcomputinggroup.org/wp-content/uploads/TPM_Rev2.0_Part1_Architecture_r1.50_publicreview.pdf))
- §19.8 «Dictionary Attack Protection»، ص132: `NO_DA` يخص إذن الفهرس نفسه، وسمات `noDA` تخص إذن الكائن نفسه؛ لا يستنتج من علم الفهرس حكم شامل على كل استعمال لمفاتيح الخدمة أو AK. ([TCG Part 1 r1.50](https://trustedcomputinggroup.org/wp-content/uploads/TPM_Rev2.0_Part1_Architecture_r1.50_publicreview.pdf))

## TCG — Part 3، Version 185، 2026-03-12

الرابط: https://trustedcomputinggroup.org/wp-content/uploads/Trusted-Platform-Module-2.0-Library-Part-3-Commands_Version-185_pub.pdf

- §31.16.1–2، ص371–372: `NV_Certify` يصادق محتوى الفهرس المحدد بالحجم والإزاحة، ويضمّن اسم NV؛ و§18.1، ص151–152، يذكر وضع `qualifyingData` المزوّدة من المستدعي في `extraData` لمعظم مخططات التوقيع. ([TCG Part 3 v185](https://trustedcomputinggroup.org/wp-content/uploads/Trusted-Platform-Module-2.0-Library-Part-3-Commands_Version-185_pub.pdf))
- §23.3.1: بنية التفويض الموقعة في `PolicySigned` هي `nonceTPM ‖ expiration ‖ cpHashA ‖ policyRef`؛ يمكن ترك nonce فارغًا، والمدة صفرًا؛ و§23.2.2–5 يشرح القيود والتذاكر. ([TCG Part 3 v185](https://trustedcomputinggroup.org/wp-content/uploads/Trusted-Platform-Module-2.0-Library-Part-3-Commands_Version-185_pub.pdf))
- §23.11.1–2: `PolicyCommandCode` يقيّد رمز الأمر؛ §23.13.1–2: `PolicyCpHash` يربط الأمر بمعاملاته وكائناته؛ فلا أستنتج من تسمية سياستي §4.2 وحدها تفاصيل nonce أو العمر أو الارتباط بالفهرس. ([TCG Part 3 v185](https://trustedcomputinggroup.org/wp-content/uploads/Trusted-Platform-Module-2.0-Library-Part-3-Commands_Version-185_pub.pdf))
- لم أستنتج أن TPM الإنتاج ذي النسخة المذكورة تاريخيًا في ADR يطبق كل تفصيل مستحدث في v185؛ اختلاف النسخ نفسه شرط توحيد للمواصفة المستهدفة. ([ADR 0007 §6.2](../../xuux-review-a76c8478/docs/adr/0007-tpm-nv-counter-freshness-anchor-design.md)، [TCG Part 3 v185](https://trustedcomputinggroup.org/wp-content/uploads/Trusted-Platform-Module-2.0-Library-Part-3-Commands_Version-185_pub.pdf))

## Microsoft — Command Blocking، 2020-06-17

الرابط: https://learn.microsoft.com/en-us/windows/win32/tbs/command-blocking

- يخص شرح القوائم الثلاث TPM 1.2، أما TPM 2.0 فله قائمة سماح معكوسة؛ ومن Windows 10 1809 تثبت الأوامر المسموحة داخل برنامج تشغيل TPM، ولا يمكن تغييرها عبر إعدادات السجل. ([Microsoft — Command Blocking](https://learn.microsoft.com/en-us/windows/win32/tbs/command-blocking))
- لا يكفي غياب مفتاح سجل لقائمة حجب لكي يثبت نفاذ أمر TPM 2.0 عبر TBS، ولا يثبت `GetCapability(commands)` وحده قبول مسار Windows له. ([Microsoft — Command Blocking](https://learn.microsoft.com/en-us/windows/win32/tbs/command-blocking))

## Microsoft — TPM Group Policy settings، 2025-08-15

الرابط: https://learn.microsoft.com/en-us/windows/security/hardware-security/tpm/trusted-platform-module-services-group-policy-settings

- عنوان “Configure the level of TPM owner authorization information available to the operating system”: القيمة الافتراضية 5 ابتداء من Windows 10 1703 تعني مع TPM 2.0 الاحتفاظ بإذن lockout؛ والجدول يقابل `OwnerAuthFull` بإذن `LockoutAuth`، و`OwnerAuthAdmin` بإذن `StorageOwnerAuth`. ([Microsoft — TPM Group Policy settings](https://learn.microsoft.com/en-us/windows/security/hardware-security/tpm/trusted-platform-module-services-group-policy-settings))
- لذلك لا أعامل المسار `OwnerAuthFull` ولا تسمية `Full` وحدهما برهانًا على توفر إذن هرم التخزين لتعريف NV على المضيف. ([Microsoft — TPM Group Policy settings](https://learn.microsoft.com/en-us/windows/security/hardware-security/tpm/trusted-platform-module-services-group-policy-settings))

## Microsoft — Get-Tpm

الرابط: https://learn.microsoft.com/en-us/powershell/module/trustedplatformmodule/get-tpm?view=windowsserver2025-ps

- الصفحة تعرّف `ManagedAuthLevel` بالقيم `Legacy` و`Balanced` و`Full`، وتعرّف `OwnerAuth`؛ ولا تعرض الحقل `OwnerAuthStatus` الذي يسميه ADR. ([Microsoft — Get-Tpm](https://learn.microsoft.com/en-us/powershell/module/trustedplatformmodule/get-tpm?view=windowsserver2025-ps))
- لم أنسب تاريخ تحديث موثوقًا إلى هذه الصفحة، لأن استخراج التاريخ عرض نصًا ترويجيًا لا تاريخ تعديل. ([Microsoft — Get-Tpm](https://learn.microsoft.com/en-us/powershell/module/trustedplatformmodule/get-tpm?view=windowsserver2025-ps))

## tpm2-tools — قراءة إضافية لضبط محاولة تشغيل المحاكي

- `nvcertify`: `-C` هو سياق مفتاح التوقيع، و`-c` هو مصدر إذن NV، و`--size`/`--offset` يحددان الجزء، و`-q` بيانات التأهيل. ([tpm2-tools — nvcertify](https://tpm2-tools.readthedocs.io/en/latest/man/tpm2_nvcertify.1/))
- `createprimary`: القالب الافتراضي يشتمل على معاملات مفتاح تخزين؛ محاولة قالب توقيع ECC المحلي خرجت بخطأ `0x2D6`، فلم يصل المسبار إلى `NV_Certify`، ولا أعد هذه المحاولة دليل شهادة TPM فعلية حتى على المحاكي. ([tpm2-tools — createprimary](https://tpm2-tools.readthedocs.io/en/latest/man/tpm2_createprimary.1/)، [سجل المحاولة](logs/real-nv-certify-simulator.stdout.txt)، [الخطأ](logs/real-nv-certify-simulator.stderr.txt))
