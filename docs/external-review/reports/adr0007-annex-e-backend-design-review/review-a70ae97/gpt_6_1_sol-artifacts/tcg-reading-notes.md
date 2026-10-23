# مقتطفات القراءة المعيارية — الجولة 5

## Part 1 r1.59

قرئت المقاطع التالية بأداة fetch_url من [TCG Part 1 r1.59](https://trustedcomputinggroup.org/wp-content/uploads/TCG_TPM2_r1p59_Part1_Architecture_pub.pdf)، وليست نتائج قياس على TPM.

- §19.6.5، المعادلة (17): `authHMAC ≔ HMACsessionAlg ((sessionKey || authValue), (pHash || nonceNewer || nonceOlder { || nonceTPMdecrypt } { || nonceTPMencrypt } || sessionAttributes))`؛ وNOTE 2: “Trailing zeros are always removed from an authValue before it is used in an authorization computation.” ([TCG Part 1](https://trustedcomputinggroup.org/wp-content/uploads/TCG_TPM2_r1p59_Part1_Architecture_pub.pdf))
- §19.8: “The authValue associated with a permanent entity, other than TPM_RH_LOCKOUT, does not receive DA protection.” ([TCG Part 1](https://trustedcomputinggroup.org/wp-content/uploads/TCG_TPM2_r1p59_Part1_Architecture_pub.pdf))
- §37.2.6.3: “the TPM will initialize the 8-octet counter value such that the first increment will set a value that is greater than any value that a counter Index with the same Name has had over the lifetime of the TPM.” ([TCG Part 1](https://trustedcomputinggroup.org/wp-content/uploads/TCG_TPM2_r1p59_Part1_Architecture_pub.pdf))
- NOTE 4: “Since no counter can ever repeat a previous value ever contained in any NV Counter Index, a counter with a particular Name cannot be rolled back by deleting it and redefining it.” ([TCG Part 1](https://trustedcomputinggroup.org/wp-content/uploads/TCG_TPM2_r1p59_Part1_Architecture_pub.pdf))
- §37.2.6.3 يميز ORDERLY=0، حيث الزيادة مباشرة في NV، عن ORDERLY=1 الذي قد يعتمد RAM وقفزة عند بدء غير منظّم. ([TCG Part 1](https://trustedcomputinggroup.org/wp-content/uploads/TCG_TPM2_r1p59_Part1_Architecture_pub.pdf))

## Part 2 r1.59

مواضع OWNERWRITE=1، وحقل TPM_NT في 7:4 مع COUNTER=1، وAUTHREAD=18، وNO_DA=25، وORDERLY=26، وWRITTEN=29، واردة في [TCG Part 2](https://trustedcomputinggroup.org/wp-content/uploads/TCG_TPM2_r1p59_Part2_Structures_pub.pdf)؛ حُسب قناع K مستقلاً في design-models.mjs.

## Part 3 وPart 4 r1.59

فشل fetch_url للعنوانين برسالة bad_robots_code؛ نجح تنزيل HTTPS العام للعنوانين نفسيهما وتحويلهما بـpdftotext، دون تشغيل شيء من أوامر TPM. ([TCG Part 3](https://cdn.trustedcomputinggroup.org/production/TCG_TPM_2_r1p59_Part3_Commands_pub_00016d87e3.pdf)، [TCG Part 4](https://cdn.trustedcomputinggroup.org/production/TCG_TPM_2_r1p59_Part4_Supp_Routines_code_pub_b5951a79b4.pdf))

- Part 3 §11.1، الجدولان 15–16، ص39: StartAuthSession بلا audit/encrypt/decrypt يستعمل NO_SESSIONS؛ الرد يعيد sessionHandle وnonceTPM، لا HMAC الجلسة المنشأة؛ هذا يؤيد فجوة أول ن2 في الملحق. ([TCG Part 3](https://cdn.trustedcomputinggroup.org/production/TCG_TPM_2_r1p59_Part3_Commands_pub_00016d87e3.pdf))
- Part 3 §31.8، الجدول 222، ص376–377: الزيادة بواحد، وauthHandle هو دور التفويض، وnvIndex هدف غير مفوّض مستقلًا؛ NOTE 2 خاص بـORDERLY. ([TCG Part 3](https://cdn.trustedcomputinggroup.org/production/TCG_TPM_2_r1p59_Part3_Commands_pub_00016d87e3.pdf))
- Part 4 §8.4.5.18، ص319، الأسطر المرجعية 950–954: NvDeleteIndex يستدعي NvUpdateMaxCount لقيمة العداد المكتوب قبل الحذف؛ §8.4.5.20، ص320، الأسطر 1000–1005: NvFlushHierarchy يستدعي NvDeleteIndex لفهارس المالك. ([TCG Part 4](https://cdn.trustedcomputinggroup.org/production/TCG_TPM_2_r1p59_Part4_Supp_Routines_code_pub_b5951a79b4.pdf))
- Part 4 §8.4.6.1، ص328: قيمة أعلى عداد محذوف في end-of-list marker في NV؛ §8.4.6.3، ص329، الأسطر 1414–1415: تحديث s_maxCounter إلى القيمة الأكبر؛ §8.5.3.5، ص332، الأسطر 68–73: التهيئة المصنعية NvSetMaxCount(0). ([TCG Part 4](https://cdn.trustedcomputinggroup.org/production/TCG_TPM_2_r1p59_Part4_Supp_Routines_code_pub_b5951a79b4.pdf))

## EK Credential Profile

§2.2.1.6 يحدد الحالات الأربع: غياب القالب ⇒ الافتراضي؛ القالب دون nonce ⇒ بلا تعديل؛ nonce دون قالب ⇒ MUST NOT؛ الاثنان ⇒ إلحاق أصفار إلى unique، كما يذكر الملحق؛ القراءة تمت من [ملف EK v2.5 R2](https://trustedcomputinggroup.org/wp-content/uploads/TCG-EK-Credential-Profile-V-2.5-R2_published.pdf).

## حدود الاستدلال

المقتطفات لا تثبت امتثال شريحة بعينها ولا أرقام تشغيلات validate السابقة أو حالة GitHub الحية؛ تُفصل هذه الادعاءات عن الفحص المحلي في التقرير النهائي.
