# دليلُ WL-098 — نصوصُ التشغيلِ الخامّةُ لإصلاحِ UF-16 و R3-A-01

هذا الملفُّ **نصوصٌ خامّةٌ منقولةٌ كما خرجت** لا وصفٌ لها. وهو دليلُ تنفيذٍ لا حكمُ إغلاقٍ: أحكامُ النتائجِ بيدِ أعضاءِ المجلسِ وحدَهم.

## 1. توكنٌ مؤقّتٌ مستقلٌّ (لا مفاتيحَ للمالكِ ولا PIN له)

```
softhsm2-util --version → 2.6.1
module → libsofthsm2.so  sha256 d1e30c3f265a8ded9af3ea1b8d7a5b672ad2b7103c5e47c82d4a27767f3e7e23
token  → label uf16-token (مؤقّتٌ في /tmp، PIN 222222 و SO-PIN 111111 خاصّانِ بالتوكنِ المؤقّتِ وحدَه)
```

## 2. npm run hsm:keygen — وضعُ التهيئةِ الأولى

```

> digital-state-root-of-trust@0.65.0 hsm:keygen
> node scripts/pkcs11-keygen.mjs --log ${XUUX_KEYGEN_LOG:-artifacts/hsm/keygen.log}

[keygen] وضع=initial
[keygen] token=uf16-token serial=(غير متحقَّق)
[keygen] نطاق الإنشاء: CKA_ID=06,05,07
[keygen] king-signing-key (توقيع أوامر التاج (F06))
  CKA_ID=06 نوع=ed25519
  CKA_VALUE مرفوض=نعم (CKR_ATTRIBUTE_SENSITIVE)
  CKA_EXTRACTABLE=false CKA_NEVER_EXTRACTABLE=true
  عملية داخل HSM=ناجحة
  publicKeyPEM:
    -----BEGIN PUBLIC KEY-----
    MCowBQYDK2VwAyEAD191lZMCYjsUafp/BHSDfkbXSzKtNrmH2kTZ1rMgyaA=
    -----END PUBLIC KEY-----
[keygen] event-log-aead-key (تشفير سجل الأحداث AES-256-GCM (F05))
  CKA_ID=05 نوع=aes
  CKA_VALUE مرفوض=نعم (CKR_ATTRIBUTE_SENSITIVE)
  CKA_EXTRACTABLE=false CKA_NEVER_EXTRACTABLE=true
  عملية داخل HSM=ناجحة
[keygen] command-ledger-signing-key (توقيع سجل الأوامر (F07))
  CKA_ID=07 نوع=ed25519
  CKA_VALUE مرفوض=نعم (CKR_ATTRIBUTE_SENSITIVE)
  CKA_EXTRACTABLE=false CKA_NEVER_EXTRACTABLE=true
  عملية داخل HSM=ناجحة
  publicKeyPEM:
    -----BEGIN PUBLIC KEY-----
    MCowBQYDK2VwAyEA151mgxstgrcXFdwOrPdhVI44G0vMhocl2D3DEiPgb/c=
    -----END PUBLIC KEY-----
[keygen] تم.
```

## 3. npm run hsm:verify:f05 بعدَ التهيئةِ الأولى

```

> digital-state-root-of-trust@0.65.0 hsm:verify:f05
> node scripts/pkcs11-f05-verify.mjs --keygen-log ${XUUX_KEYGEN_LOG:-artifacts/hsm/keygen.log}

[f05-verify] تحقّق موجَّه من ثبات F05 (CKA_ID=05, AES-256-GCM)
[f05-verify] الوسم المتوقَّع: event-log-aead-key
[f05-verify] الفحوص:
  OK   exactly_one_object_with_cka_id_05 — العدد=1
  OK   class_is_CKO_SECRET_KEY — class=4 (المتوقَّع 4)
  OK   key_type_is_CKK_AES — key_type=0x1f
  OK   label_matches — label=event-log-aead-key
  OK   value_len_is_256_bit — 32 بايت
  OK   CKA_SENSITIVE_true
  OK   CKA_EXTRACTABLE_false
  OK   CKA_NEVER_EXTRACTABLE_true — القيمة=true
  OK   CKA_ALWAYS_SENSITIVE_true
  OK   CKA_VALUE_rejected_as_sensitive
  OK   aes_gcm_encrypt_ok — ciphertext+tag=35 بايت
  OK   aes_gcm_decrypt_roundtrip_matches
  OK   aes_gcm_rejects_tampered_ciphertext
  OK   keygen_log_provided — /tmp/uf16-6VUP/keygen.log
  OK   keygen_log_readable — /tmp/uf16-6VUP/keygen.log
  OK   keygen_mode_declared — initial
  OK   keygen_log_bound_to_token — شهادةٌ لوسمِ uf16-token والتحقّقُ عندَ uf16-token
  OK   keygen_no_f05_protection_trip — لم يُشتبك حارس F05 أي أن 05 لم يدخل نطاقَ إتلافٍ أصلاً
  OK   keygen_initial_destroyed_nothing — أوسمةُ الإتلاف: (لا شيء)
  OK   keygen_initial_created_f05 — CKA_ID=05,06,07
[f05-verify] 20/20 فحصاً ناجحاً
[f05-verify] === PASS: F05 ثابتٌ وسليمٌ ولم يُلمَس بتدوير F06/F07 ===
F05_VERIFY_EXIT=0
```

## 4. npm run hsm:keygen — وضعُ التدويرِ (F06/F07 فقط، بخطّةِ استبدالٍ)

```
[keygen] خطة الاستبدال مقبولة: /tmp/uf16-6VUP/plan.md
[keygen] وضع=rotation
[keygen] token=uf16-token serial=(غير متحقَّق)
[keygen] نطاق الإنشاء: CKA_ID=06,07
[keygen] تدوير انتقائي: CKA_ID=06,07 (المفاتيح الأخرى محمية)
[keygen] king-signing-key: أُتلِف 2 عنصر قائم (--replace).
[keygen] king-signing-key (توقيع أوامر التاج (F06))
  CKA_ID=06 نوع=ed25519
  CKA_VALUE مرفوض=نعم (CKR_ATTRIBUTE_SENSITIVE)
  CKA_EXTRACTABLE=false CKA_NEVER_EXTRACTABLE=true
  عملية داخل HSM=ناجحة
  publicKeyPEM:
    -----BEGIN PUBLIC KEY-----
    MCowBQYDK2VwAyEAYZm/3PiIEuiydvTjFeHNRl/uhO09JKRJSM18JRAjZn4=
    -----END PUBLIC KEY-----
[keygen] command-ledger-signing-key: أُتلِف 2 عنصر قائم (--replace).
[keygen] command-ledger-signing-key (توقيع سجل الأوامر (F07))
  CKA_ID=07 نوع=ed25519
  CKA_VALUE مرفوض=نعم (CKR_ATTRIBUTE_SENSITIVE)
  CKA_EXTRACTABLE=false CKA_NEVER_EXTRACTABLE=true
  عملية داخل HSM=ناجحة
  publicKeyPEM:
    -----BEGIN PUBLIC KEY-----
    MCowBQYDK2VwAyEA1fPfNj67MLOHKC2biFDw1smlSgT/ScBRU/nZF/FGtIk=
    -----END PUBLIC KEY-----
[keygen] تم.
```

## 5. npm run hsm:verify:f05 بعدَ التدوير

```

> digital-state-root-of-trust@0.65.0 hsm:verify:f05
> node scripts/pkcs11-f05-verify.mjs --keygen-log ${XUUX_KEYGEN_LOG:-artifacts/hsm/keygen.log}

[f05-verify] تحقّق موجَّه من ثبات F05 (CKA_ID=05, AES-256-GCM)
[f05-verify] الوسم المتوقَّع: event-log-aead-key
[f05-verify] الفحوص:
  OK   exactly_one_object_with_cka_id_05 — العدد=1
  OK   class_is_CKO_SECRET_KEY — class=4 (المتوقَّع 4)
  OK   key_type_is_CKK_AES — key_type=0x1f
  OK   label_matches — label=event-log-aead-key
  OK   value_len_is_256_bit — 32 بايت
  OK   CKA_SENSITIVE_true
  OK   CKA_EXTRACTABLE_false
  OK   CKA_NEVER_EXTRACTABLE_true — القيمة=true
  OK   CKA_ALWAYS_SENSITIVE_true
  OK   CKA_VALUE_rejected_as_sensitive
  OK   aes_gcm_encrypt_ok — ciphertext+tag=35 بايت
  OK   aes_gcm_decrypt_roundtrip_matches
  OK   aes_gcm_rejects_tampered_ciphertext
  OK   keygen_log_provided — /tmp/uf16-6VUP/keygen-rot.log
  OK   keygen_log_readable — /tmp/uf16-6VUP/keygen-rot.log
  OK   keygen_mode_declared — rotation
  OK   keygen_log_bound_to_token — شهادةٌ لوسمِ uf16-token والتحقّقُ عندَ uf16-token
  OK   keygen_no_f05_protection_trip — لم يُشتبك حارس F05 أي أن 05 لم يدخل نطاقَ إتلافٍ أصلاً
  OK   keygen_scope_is_06_07_only — CKA_ID=06,07
  OK   keygen_destroyed_nothing_labelled_f05 — وسم F05 (event-log-aead-key) لم يُلمَس
  OK   keygen_destroyed_exactly_f06_f07 — أوسمة الإتلاف: command-ledger-signing-key, king-signing-key
[f05-verify] 21/21 فحصاً ناجحاً
[f05-verify] === PASS: F05 ثابتٌ وسليمٌ ولم يُلمَس بتدوير F06/F07 ===
F05_VERIFY_EXIT=0
```
