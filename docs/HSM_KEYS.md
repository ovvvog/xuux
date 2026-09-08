# مفاتيح HSM — مواصفات وتكامل (Grok-F05 / F06 / F07)

التاريخ: 2026-09-08 — WL-087 (تمهيد)، يتبعها WL-088 للتكامل.

## البيئة المعتمدة

- **المزوّد:** SoftHSM v2 (برمجي، لغرض التطوير والتمهيد — **ليس ضمان HSM عتادي**).
- **الواجهة:** PKCS#11 v3.0 (`CKM_EDDSA`/`CKM_EC_EDWARDS_KEY_PAIR_GEN` للإنتاج، `CKM_AES_GCM`/`CKM_AES_KEY_GEN` للتشفير).
  - الثوابت المُتحقَّق من ترويسة `p11-kit` (pkcs11js 2.1.7 لا يُصدِّر EdDSA): `CKK_EC_EDWARDS = 0x40` (ليس 0x28)، `CKM_EC_EDWARDS_KEY_PAIR_GEN = 0x1055`، `CKM_EDDSA = 0x1057`، `CKM_AES_GCM = 0x1087` (0x1088 هو CKM_AES_CCM)، `CKM_AES_KEY_GEN = 0x1080`.
- **Module path:** `/usr/lib/x86_64-linux-gnu/softhsm/libsofthsm2.so`
- **SOFTHSM2_CONF:** `/home/reeveero/.config/softhsm2/softhsm2.conf`
- **Token label:** `xuux-security` — **معيار الاكتشاف الأول**.
- **Token serial:** `5794ace6ca8ed841` — تحقق إضافي.
- **الـSlot:** لا يُثبَّت في الكود؛ رقمٌ تشغيلي يُكتشف بالـlabel ثم يُتحقق بالـserial.

## قواعد حاكمة (تنطبق على كل مفتاح)

1. **لا مادة خاصة خارج التوكن:** لا في Git، ولا في السجلات، ولا في مخرجات CI، ولا في رسائل الأخطاء.
2. **اكتشاف بالـlabel ثم التحقق بالـserial:** إن تعددت التوكنات بنفس الـlabel يُفشَل المغلق.
3. **PIN:** من متغيّر بيئة `XUUX_PKCS11_PIN` أو ملف أسرار بصلاحية `600` خارج Git. **لا في argv ولا في npm script ولا في سجل CI.**
4. **فشلٌ مغلق:** غياب المكتبة أو الموديول أو التوكن أو آلية غير مدعومة = رفضٌ صريح لا fallback إلى مفتاح قابل للتصدير.
5. **عقدٌ جديد لا تعديلُ القائم:** `SigningKeyHandle`/`AeadKeyHandle` للتوقيع/التشفير داخل الحدود — لا تُخدع `KeyProvider.get()` لتُرجع مادةً لمفتاح غير قابل للتصدير.

---

## المفتاح 1 — Grok-F06 — مفتاح توقيع الملك

| # | البند | القيمة |
|---|---|---|
| 1 | الاسم والمعرّف | CKA_LABEL = `king-signing-key`، CKA_ID = `06` (سداسي) — يطابق `KING_KEY_NAME` في `king-key.mts` |
| 2 | نوع المفتاح والخوارزمية | Ed25519 — `CKK_EC_EDWARDS`، آلية التوقيع `CKM_EDDSA` (EdDSA نقيّ بلا تجزئة) |
| 3 | العمليات المسموح بها | `CKA_SIGN = true` فقط؛ `CKA_VERIFY = false` على الخاص (التحقق في البرنامج بالمفتاح العام)؛ `CKA_ENCRYPT/DECRYPT/WRAP/UNWRAP = false` |
| 4 | خصائص PKCS#11 | `CKA_TOKEN = true`، `CKA_PRIVATE = true`، `CKA_SENSITIVE = true`، `CKA_EXTRACTABLE = false`، `CKA_SIGN = true`، `CKA_SIGN_RECOVER = false`، `CKA_DECRYPT = false`، `CKA_UNWRAP = false`، `CKA_DERIVE = false`. القالب العام: `CKK_EC_EDWARDS` (0x40) + `CKA_EC_PARAMS` = OID Ed25519 `1.3.101.112` بصيغة DER (`06 03 2B 65 70` — المُتحقَّق في SoftHSM2)، `CKA_VERIFY = true`. ملاحظة: `1.3.101.110` (`06 03 2B 65 6E`) هو X25519 لا Ed25519 — راجع ADR-0002. `CKA_ENCRYPT`/`CKA_WRAP` غير صالحة على مفتاح EC فلا تُضبط |
| 5 | اختبار عدم الاستخراج | (أ) `C_GetAttributeValue(CKA_VALUE)` على الخاص ⇒ `CKR_ATTRIBUTE_SENSITIVE`. (ب) التحقق بعد الإنشاء: `CKA_EXTRACTABLE = false`، `CKA_NEVER_EXTRACTABLE = true`. (ج) `C_Sign(CKM_EDDSA)` ناجح لإثبات أن الرفض ليس لغياب المفتاح (حين تدعم الخلفية EdDSA) |
| 6 | النسخ الاحتياطي وCI | نسخٌ مشفَّرٌ لمخزن التوكن عبر `softhsm2-util` أو نسخ ملفات `.softhsm/token` إلى وسطٍ مشفَّرٍ **خارج Git**. في CI: توكن SoftHSM منفصل (`xuux-ci`) بمفاتيح اختبار بـCKA_ID مختلفة، يُنشأ داخل workflow. **لا توكن الإنتاج ولا CKA_ID الإنتاجي في CI.** |

**الاستعمال:** يوقّع أوامر التاج (`CrownGateway.command`) داخل HSM بدل `crypto.sign` في الذاكرة. المفتاح العام يُصدَّر مرةً للتدقيق ويُخزَّن PEM (المفتاح العام فقط).

---

## المفتاح 2 — Grok-F05 — مفتاح تشفير سجل الأحداث

| # | البند | القيمة |
|---|---|---|
| 1 | الاسم والمعرّف | CKA_LABEL = `event-log-aead-key`، CKA_ID = `05` (سداسي) |
| 2 | نوع المفتاح والخوارزمية | AES-256 — `CKK_AES`، آلية `CKM_AES_GCM` (AEAD: confidentiality + authenticity) |
| 3 | العمليات المسموح بها | `CKA_ENCRYPT = true`، `CKA_DECRYPT = true`؛ `CKA_SIGN/VERIFY = false`؛ `CKA_WRAP/UNWRAP = false` |
| 4 | خصائص PKCS#11 | `CKA_TOKEN = true`، `CKA_PRIVATE = true`، `CKA_SENSITIVE = true`، `CKA_EXTRACTABLE = false`، `CKA_ENCRYPT = true`، `CKA_DECRYPT = true`، `CKA_VALUE_LEN = 32`، `CKA_NEVER_EXTRACTABLE = true` |
| 5 | اختبار عدم الاستخراج | (أ) `C_GetAttributeValue(CKA_VALUE)` ⇒ `CKR_ATTRIBUTE_SENSITIVE`. (ب) التحقق بعد الإنشاء: `CKA_EXTRACTABLE = false`، `CKA_NEVER_EXTRACTABLE = true`. (ج) `C_Encrypt`/`C_Decrypt` بـ`CKM_AES_GCM` ناجح |
| 6 | النسخ الاحتياطي وCI | نفس قواعد F06. **nonce/tag ليسا سرّاً** ويُخزَّنان مع النص المشفَّر في سجل الأحداث؛ المفتاح وحده في HSM. |

**الاستعمال:** تشفير سجل الأحداث بـAES-GCM داخل HSM. nonce عشوائي 12 بايت لكل عملية، tag 16 بايت، يُخزَّنان مع النص. التحقق من السلامة عند القراءة عبر `C_Decrypt` (يفشل مغلقًا عند العبث).

---

## المفتاح 3 — Grok-F07 — مفتاح توقيع سجل الأوامر

| # | البند | القيمة |
|---|---|---|
| 1 | الاسم والمعرّف | CKA_LABEL = `command-ledger-signing-key`، CKA_ID = `07` (سداسي) |
| 2 | نوع المفتاح والخوارزمية | Ed25519 — `CKK_EC_EDWARDS`، آلية `CKM_EDDSA` |
| 3 | العمليات المسموح بها | `CKA_SIGN = true` فقط؛ `CKA_VERIFY = false`؛ `CKA_ENCRYPT/DECRYPT/WRAP/UNWRAP = false` |
| 4 | خصائص PKCS#11 | مطابقة لـF06 تماماً (`CKA_TOKEN/PRIVATE/SENSITIVE=true`، `CKA_EXTRACTABLE=false`، `CKA_SIGN=true`، `CKA_SIGN_RECOVER/DECRYPT/UNWRAP/DERIVE=false`، `CKA_EC_PARAMS` = OID Ed25519 `1.3.101.112`). **مفتاح مستقل عن مفتاح الملك** — مفتاحٌ لكل غرض |
| 5 | اختبار عدم الاستخراج | مطابق لـF06 |
| 6 | النسخ الاحتياطي وCI | مطابق لـF06 |

**الاستعمال:** توقيع إدخالات سجل الأوامر (التسلسل الرتيب) داخل HSM بدل التوقيع في الذاكرة، بحيث يُكشف العبث بالسجل لاحقاً عبر التحقق بالمفتاح العام.

## حالة التحقّق (WL-088)

أُنشئ السكربت `scripts/pkcs11-keygen.mjs` (مولّد المفاتيح الإنتاجي) و`scripts/pkcs11-eddsa-sign-probe.mjs` (فحص قدرة توقيع EdDSA)، وفُحِصا في SoftHSM2 v2.6.1 (خلفية OpenSSL 3) داخل بيئة اختبارٍ مستقلّةٍ. **المفاتيح لم تُنشأ بعدُ في توكن المستخدم** — المستودعُ يحوي الأمرَ المُتحقَّقَ لإنشائها محليّاً في توكنك:

```bash
export SOFTHSM2_CONF=/home/reeveero/.config/softhsm2/softhsm2.conf
export XUUX_PKCS11_MODULE=/usr/lib/x86_64-linux-gnu/softhsm/libsofthsm2.so
export XUUX_PKCS11_PIN=$(read -rsp "User PIN: ")  # أو ملف بصلاحية 600
npm run hsm:keygen
```

السكربت **يرفض التكرار** افتراضياً (مفتاحٌ موجود بنفس `CKA_LABEL` ⇒ خطأٌ `KEY_EXISTS`)؛ للاستبدال الصريح بعد تأكيد إتلاف القديم: `npm run hsm:keygen -- --replace`. ملفُ الـPIN يُفحَصُ بصلاحيتِه (يجب `0600`، وإلّا خطأٌ `PIN_FILE_TOO_OPEN`).

| المقدرة | الحالة |
|---|---|
| إنشاء مفتاح Ed25519 (F06/F07) | ✅ ناجح |
| عدم استخراج Ed25519 (`CKA_VALUE` ⇒ `CKR_ATTRIBUTE_SENSITIVE`) | ✅ مُثبَت |
| `CKA_EXTRACTABLE = false`، `CKA_NEVER_EXTRACTABLE = true` | ✅ مقروء بعد الإنشاء |
| إنشاء مفتاح AES-256 (F05) | ✅ ناجح |
| عدم استخراج AES (`CKA_VALUE` ⇒ `CKR_ATTRIBUTE_SENSITIVE`) | ✅ مُثبَت |
| `C_Encrypt`/`C_Decrypt` بـ`CKM_AES_GCM` (roundtrip) | ✅ ناجح |
| كشف العبث (نص مُعدَّل ⇒ فشل فك التشفير) | ✅ مُثبَت |
| توقيع EdDSA عبر `C_Sign` | ⛔ فشل — `CKR_GENERAL_ERROR` (خلفية OpenSSL 3 في SoftHSM2)

### حاجز توقيع EdDSA (F06/F07)

توقيع `CKM_EDDSA` داخل HSM يفشل بـ`CKR_GENERAL_ERROR` في SoftHSM2 بخلفية OpenSSL 3 — قيدٌ في خلفية الخزنة لا في التكامل. **هذا لا يَنقُل** F06/F07 إلى «مُعالَج»: المولّد صحيح والمفاتيح غير قابلة للاستخراج، لكن التوقيع الإنتاجي داخل HSM غير مُثبَت على هذه الخلفية.

**الحلول البديلة:** (1) إعادة بناء SoftHSM2 بخلفية Botan (`--with-crypto-backend=botan --enable-eddsa`) التي تدعم EdDSA كاملًا؛ (2) مزوّد HSM عتادي (YubiHSM2)؛ (3) توقيع Ed25519 في الذاكرة (الوضع الحالي) كحلٍّ مؤقتٍ حتى تتوفّر خلفية تدعمه.

**على المستخدم التحقق من خلفيّته** قبل اعتماد التوقيع داخل HSM: شغّل `npm run hsm:probe` على WSL2 وأرفق المخرجات.

## التكامل

عقدُ موفّر HSM الجديد `src/root-of-trust/pkcs11-provider.mts` يُحدّد واجهة `HsmProvider` (لا تُصدِّر المادة)، و`AeadKeyHandle` (F05 — AEAD داخل HSM)، و`SigningKeyHandle` (F06/F07 — توقيع داخل HSM مع فحص ذاتي مغلق على الفشل)، و`Pkcs11HsmProvider.fromEnv()` (اكتشاف عبر `XUUX_PKCS11_MODULE` + `token label` + PIN مُؤمَّن). التحميل الديناميكي لـ`pkcs11js` (تبعية اختيارية)، فشلٌ مغلقٌ عند غيابها — **لا مسار برمجي للمادة الخاصة**.

### ما تم وما بقي

| الموضع | الحالة |
|---|---|
| عقد الموفّر (`pkcs11-provider.mts`) | ✅ منفَّذ (typecheck + build أخضر) |
| سكربت إنشاء المفاتيح (`hsm:keygen`) | ✅ منفَّذ ومُتحقَّق في SoftHSM |
| فحص توقيع EdDSA (`hsm:probe`) | ✅ منفَّذ ومُتحقَّق |
| اختبارات الموفّر (6 اختبارات، sandbox) | ✅ ناجحة (تتخطّى في CI بلا SoftHSM) |
| F05: التشفير داخل HSM | ✅ البدائيّة مُثبَة ومُختبَرة؛ **ربط مسار سجل الأحداث الإنتاجي بقي** (خطوة تالية) |
| F06/F07: التوقيع داخل HSM | ⛔ محجوبٌ على خلفية OpenSSL 3؛ يلزم خلفية تدعم EdDSA |
| pkcs11js كتبعية اختيارية | ✅ (تحميل ديناميكي، فشلٌ مغلق) |
| PIN في ملف أسرار بصلاحية 600 | ✅ موثَّق (أدناه)؛ **لا يُطلب في المحادثة ولا يُكتب في السجلات** |

**الخلاصة:** المولّد والعقد وفحص عدم الاستخراج والتشفير داخل HSM (F05) مُثبَة ومُختبَرة. التوقيع داخل HSM (F06/F07) محجوبٌ على خلفية المستخدم الحالية، وفُرض حاجزٌ مغلقٌ (فشلٌ صريح لا مسار برمجي) عند غياب قدرة EdDSA. مادة المفاتيح الخاصة لا تُكتب في Git أو السجلات أو مخرجات CI.

---

## أوامر PIN الآمنة

**خيار أ — تفاعلي (موصى به، مؤقت في الذاكرة):**

```sh
read -rsp "User PIN: " XUUX_PKCS11_PIN
echo
export XUUX_PKCS11_PIN
export SOFTHSM2_CONF=/home/reeveero/.config/softhsm2/softhsm2.conf
node scripts/pkcs11-keygen.mjs
unset XUUX_PKCS11_PIN
```

**خيار ب — ملف أسرار بصلاحية 600:**

```sh
install -m 600 /dev/null ~/.config/xuux/pkcs11-pin
# أدخل الـPIN يدوياً في الملف بمحرّر، ثم:
export XUUX_PKCS11_PIN="$(cat ~/.config/xuux/pkcs11-pin)"
export SOFTHSM2_CONF=/home/reeveero/.config/softhsm2/softhsm2.conf
node scripts/pkcs11-keygen.mjs
```

`~/.config/xuux/pkcs11-pin` خارج المستودع (لا يُضاف لـGit). إن وُضع داخل المستودع فليكن في `.secrets/` المُدرج في `.gitignore`.

---

## سكربت الإنشاء والاختبار

`scripts/pkcs11-keygen.mjs` (يستعمل `pkcs11js` بالتحميل الديناميكي):
- يكتشف التوكن بـlabel `xuux-security` ويتحقق بالـserial `5794ace6ca8ed841`.
- يتحقق من دعم الآليات (`CKM_EDDSA`/`CKM_AES_GCM`/`CKM_AES_KEY_GEN`) قبل أي إنشاء، فشلٌ مغلقٌ عند عدم الدعم.
- يُنشئ المفاتيح الثلاثة بالخصائص أعلاه (متسامح: يتخطّى الموجود).
- ينفّذ اختبار عدم الاستخراج (CKA_VALUE ⇒ CKR_ATTRIBUTE_SENSITIVE) ثم التوقيع/التشفير الناجح.
- يطبع **المفتاح العام فقط** (Ed25519 DER → PEM) لكل مفتاح توقيع؛ لا يطبع المادة الخاصة أبداً.

التشغيل يتطلب تثبيت `pkcs11js` (native addon): `npm install pkcs11js` (يحتاج مترجم C++ وpython3 وmake — متوفرة في WSL2). المكتبة تُحمَّل ديناميكياً في وقت التشغيل، فلا يُكسر التطبيق في البيئات بلا HSM.

---

## حدود معلَنة

1. **SoftHSM برمجي** لا عتادي: حماية الذاكرة (نسخ/تفريغ/لقطة نواة) خارج ضمانه. مناسبٌ للتمهيد والتطوير وCI، **لا لإنتاجٍ سياديٍّ حقيقي** — يتطلب لاحقاً HSM عتادياً (YubiHSM/CloudHSM) بنفس العقد.
2. **لا تدوير مفاتيح تلقائي هنا** — ذلك مسار منفصل (M2.04)؛ هذا التكامل يثبّت المادة في التوكن ويوقّع/يُشفِّر داخلها.
3. **لا تُغيَّر خوارزمية التوقيع** — تبقى Ed25519 في كل النظام؛ HSM يُوقّع بالخوارزمية نفسها.
