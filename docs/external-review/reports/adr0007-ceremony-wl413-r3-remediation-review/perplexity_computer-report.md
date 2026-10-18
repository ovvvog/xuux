# تقرير تدقيق المنفِّذ — WL-414 R3 — perplexity_computer

## التصريح بالدور والحدود

أنا المنفِّذ (Perplexity Computer)، **لستُ عضوًا في مجلس المراجعة** كما نصّ بروتوكول الجولات. هذا التقرير **تدقيق المنفِّذ** لا مراجعة مستقلة: جولتُنا الثالثة (R3) على de099aa8 انتُدب لها ثلاثة مراجعين مستقلين (gpt_6_1_sol، gemini_3_8_flash، grok_4_7) في وكلاءٍ منفصلة، وتقاريرهم الخامّ هي حكم الجولة، وتُجمع في حزمة الجولة دون تعديل. ما في هذا المجلد: مسابرٌ مستقلة أعددتُها للتحقق الشخصي من ادعاءات الإصلاح، والقياسات الكاملة (validate وtpm-sim-ci)، وتوثيق حدودها.

**انحرافاتٌ أعلنها صراحةً** (أفعالُ منفِّذٍ لا مراجعٍ مستقل):
- استعملتُ `gh` للتحقق من حالة المستودع (تكليف المستخدم المكتوب) ولجمع فحوص GitHub على رأس #378.
- شغّلتُ `scripts/tpm-sim-ci.sh` (منفذه الثابت 2321) كقياسٍ للمنفِّذ؛ المراجعون المستقلون مُنعوا منه ولم يستعملوه.
- قياساتي على شجرة de099aa8 (`/home/user/workspace/xuux-review-de099aa8`)، بنفس بيئة الحاوية.

**تقارير الجولة (3):** تُقرأ تقاريرُهم الخام كما هي دون تلخيصٍ يُخفي اختلاف أحكامهم؛ حالة كل تقرير توثَّق في فهرس الجولة النهائي (COLLECTION).

## زمن القياس

البدء ~2026-10-18T02:00Z؛ آخر تحديث للتقرير: 2026-10-18T03:30Z تقريبًا (تقديرٌ لا ساعةُ مستوى). الكوميت المراجَع: `de099aa8cfd82dda106199eeaf11e134b5ee6639` (طبع `git rev-parse HEAD` في شجرة التدقيق).

## فحوصات الحماية (أُعيدت في النهاية)

- `git status --porcelain` في شجرة التدقيق: فارغ.
- فرق الملفات المحمية (config/external-review.yaml، version.json، sim/tpm/tcti_guard.mjs، scripts/production-entry.mjs) عن `8b48a568`: **صفر بايت** (`core-diff.txt`).
- فرق `sim/tpm-host/` عن `1ca1668e`: صفر بايت.
- لا يوجد `/dev/tpm*` في هذه البيئة أصلًا؛ لم تُنفَّذ أي عملية على TPM حقيقي.

## القياس الكامل (المنفِّذ)

| القياس | الأمر | النتيجة | رمز الخروج |
|---|---|---|---|
| فحوص الجودة الشاملة | `npm run validate` | tests 2848 / pass 2593 / fail 0 / skipped 255 (419.8s) | 0 |
| فحص بوابة المحاكي | `bash scripts/tpm-sim-ci.sh` | tests 175 / pass 173 / fail 0 / skipped 2 | 0 |
| فحوص GitHub على رأس #378 (c1f80b6) | `gh pr view 378 --json statusCheckRollup` | فحص الجودة الكامل: COMPLETED/SUCCESS؛ تقرير البوابتين G0 وG1: COMPLETED/SUCCESS | — |

**ملاحظة على الفشل الأول لـvalidate (بيئي، موثق):** المحاولة الأولى فشلت في `fetch:reviewed-commits` بـ`REVIEWED_COMMIT_UNREADABLE: d9e094e802334407d24d07451944e4ba7adb0621`: الكوميت M11.05 المعلن في config/external-review.yaml يعيش في refs/pull/113/head، وPR #113 دُمج بsquash فالكوميت غير قابل للوصول من الفروع؛ وأصل شجرة التدقيق نسخة محلية لا تخدم SHA-fetch. عولج بـ`git fetch https://github.com/ovvvog/xuux.git d9e094e8…` (GitHub يخدم SHA-fetch). هذا عيبُ بيئةِ التحقق لا عيبُ شيفرة؛ نص الحارس نفسه يوثق فئة الفشل هذه.

## مسابر المنفِّذ المستقلة (PcProbe)

برنامج مسابر C# مستقل (`PcProbe.cs`/`PcProbe.exe`) مبني فوق `sim/tpm-ceremony/TpmCeremonyCore.cs` من شجرة التدقيق؛ 20 وضعًا، كل وضع يُنشئ محاكي swtpm خاصًّا به. **تصحيحاتٌ أُدخلت أثناء التدقيق (توثيق أمانة):** النسخ 1–2 من المسابر احتوت أخطاء (إرسال مزدوج في A6، قراءة مقبض من بداية الرد في B3، تكرار مقبض ثابت غير موجود في B5، حقن غير موثق في B9) — صُححت وأعيد التشغيل؛ مخرجات التشغيلات السابقة كُتبت فوقها بالنسخ المصححة (النسخة النهائية هي المعتمدة كدليل). نتائج النسخة المصححة:

| المسبر | الحقن | النتيجة المقيسة |
|---|---|---|
| A1 session-alias | مقبض موجود في خط الأساس في رد إنشاء جلسة | `OUTCOME_UNKNOWN … RESPONSE_HANDLE_PREEXISTING`، الجلسة الحقيقية معلنة (FAILED_CLOSED) |
| A2 inventory-no-progress / wrong-class | صفحة جرد بلا تقدم / فئة خاطئة | `RESPONSE_CAPABILITY_NO_PROGRESS` / `RESPONSE_CAPABILITY_HANDLE_CLASS_MALFORMED: 0x03000001 asked=0x01000000` مع verified=false |
| A3 auth-hmac-nonzero | HMAC غير فارغ في رد جلسة سياسة | `RESPONSE_AUTH_CONTENT_MALFORMED` |
| A4 public-empty | منطقة عامة فارغة | `RESPONSE_PUBLIC_AREA_MALFORMED` |
| A5 readpublic-malformed-18b | وسم غير صالح في رد ReadPublic | `reconcile … unverifiable: RESPONSE_ERROR_TAG_MALFORMED` في البقايا (لا «غياب مثبت») |
| A6 create/policysigned-neg-loss | إسقاط رد Create / رد PolicySigned سلبي بعد التنفيذ | `OUTCOME_UNKNOWN` + سطر مصالحة في الحالتين (إرسالٌ واحد؛ صُحح الإرسال المزدوج) |
| A7 paramsize-huge | parameterSize=0x7fffffff | `RESPONSE_PARAMETER_SIZE_INVALID` قبل قراءة المعاملات، لا OOM |
| A8 define-response-loss | فقد رد NV_DefineSpace | `ownership cannot be proven; left in place` — لا حذف، FAILED_CLOSED (قرار المالك منفذ) |
| A10 sign-sha1 | signature.hashAlg=SHA-1 | `RESPONSE_SIGNATURE_HASH_UNEXPECTED` |
| B1 nosessions-trailing | بايت زائد بعد جسم رد ST_NO_SESSIONS | `RESPONSE_PARAMS_TRAILING_BYTES` |
| B2 nosessions-nonce-1 | nonce بطول 1 في رد بلا جلسات | `RESPONSE_SESSION_NONCE_MALFORMED` |
| B3 load-alias-run-handle | إرجاع مقبض CreatePrimary (0x80000000) في رد Load بدل المقبض الفعلي (0x80000001) | القبول غير مسمّى كالتفافٍ لكن التشغيل فشل مغلقًا عند Sign بـTPM_ERROR rc=0x19c؛ الالتفاف نفسه لا يسمّى |
| B4 auth-attrs-reserved-high | attrs=0xF0 | `RESPONSE_AUTH_CONTENT_MALFORMED` (البتات العليا) |
| B5 inventory-duplicate | صفحة جرد تحمل المقبض 0x01000001 مرتين (عدد=2، فئة صحيحة) | **قُبلت** — status COMPLETE، لا فحص للتكرار (يدعم R3SOL-01) |
| B6 policysigned-huge-timeout | timeout بطول 200 بايت في رد PolicySigned ناجح | **قُبل** — status COMPLETE (يدعم R3SOL-03) |
| B7 nosessions-for-sessions-cmd | retag رد جلسات إلى ST_NO_SESSIONS | `TAG_MISMATCH` |
| B8 auth-mixed-profile | ملف password في رد جلسة سياسة | يقبل الملفين دون ربط بالطلب (يدعم R3SOL-02) |
| B9 policy-profile-on-password-cmd | ملف سياسة كامل (nonce=32, attrs=0x00) في رد أمر بتفويض كلمة سر | **قُبل** — status COMPLETE: لا ربط لملف التفويض بنوع الجلسة المطلوبة (يدعم R3SOL-02) |

**ST_NO_SESSIONS:** ردود StartAuthSession وPolicySigned الناجحة من swtpm تأتي وسمها 0x8001 بلا parameterSize (تحقق مباشر)؛ الفاحص يفحص هذا الشكل فعلاً (B1/B2/B7 ترفضه مشوهًا).

## موقف عوائق الجولة الأولى (تدقيق المنفِّذ)

عوائق gpt_6_1_sol (SOL413-01..08) وgrok_4_7 (G47-413-1..9): أُعيد فحصها بمسابري أعلاه — مثال كل عائقٍ أصبح يُرفض باسمٍ مسمّى أو يُصرَّح بحالته (الجدول أعلاه). **حدود تدقيقي:** لم أعد إنتاجًا مستقلًا لمثال G47-413-7/8 (فحص الملف التنفيذي/منفذ التحكم) — المراجع المستقل gpt_6_1_sol قاسهما في تقريره؛ وفرع 0x14A في readcounter جرى قياسه في اختبارات R3 المشحونة (r3 readcounter-malformed-14a) لا بمسبري. فحص مالك المقبس وTBS خارج نطاق المحاكاة أصلاً.

## نتائج تدقيق المنفِّذ (4، كلها منخفضة–متوسطة، تتقاطع مع تقارير المراجعين)

| المعرف | الخطورة | الوصف | الدليل |
|---|---|---|---|
| PC-R3-1 | منخفضة | رد PolicySigned ناجح بtimeout بطول 200 بايت يُقبل → COMPLETE | B6 مع دليل إطلاق |
| PC-R3-2 | منخفضة | صفحة جرد بمقبض مكرر تُقبل → COMPLETE | B5 بعد إعادة التصميم |
| PC-R3-3 | منخفضة | رد Load يُرجع مقبضًا من إنشاء التشغيل لا يُسمّى التفافًا (يفشل مغلقًا لاحقًا) | B3 |
| PC-R3-4 | منخفضة | ملف تفويض الرد لا يُربَط بنوع الجلسة المطلوبة (ملف سياسة في رد أمر بكلمة سر) | B9 |

## ما لا يُقاس في هذه البيئة

- أي قياس على TPM حقيقي أو /dev/tpm* أو Windows TBS أو انقطاع طاقة.
- ثبات العداد ورتابته على شريحة، وسلوك الحذف/إعادة التعريف على العتاد.
- استنفاد سعة NV بالفهارس المتروكة (قياس العدد فقط 0→3 في تقارير المراجعين).

## خلاصة المنفِّذ

القياسات الكاملة (validate/tpm-sim-ci) نجحت على de099aa8، وفحوص GitHub ناجحة على رأس #378 (c1f80b6)، وعوائق الجولة الأولى أصبحت مرفوضة بأسماء مسمّاة في مسابري، مع أربعة مواضع قبولٍ جديدة منخفضة–متوسطة الخطورة وثّقتها أعلاه وتتقاطع مع نتائج المراجعين المستقلين. حكم الجولة وأثرها في الإصلاح: للتقارير الثلاثة الخامّ وللمالك، لا لهذا التدقيق.
