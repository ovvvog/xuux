# بناء SoftHSMv2 بخلفية Botan — تعليمات مُتحقَّقة

- **الحالة:** مُتحقَّق في صندوق رمل Ubuntu 26.04 LTS x86_64 (= بيئة WSL2 المستهدفة)
- **التاريخ:** 2026-09-08
- **العلاقة:** ADR-0002، F06/F07، `scripts/pkcs11-backend-probe.mjs`، `scripts/pkcs11-eddsa-sign-probe.mjs`

> **تنبيه:** إعادة بناء SoftHSM بخلفية Botan ليست هي الإصلاح الفعلي لفشل توقيع
> EdDSA. الإصلاح الفعلي هو تصحيح ثابت OID في `scripts/pkcs11-oids.mjs`
> (راجع ADR-0002). بناء Botan خيارٌ مُتحقَّقٌ كبديلٍ موثوق، ويُلجأ إليه فقط إن فشل
> `hsm:probe` على الموديول الإنتاجي (OpenSSL) بعد تصحيح OID.

## المُكوّنات والإصدارات المُتحقَّقة

| المكوّن | الإصدار | المصدر |
| --- | --- | --- |
| Botan | 2.19.5 | `https://botan.randombit.net/releases/Botan-2.19.5.tar.xz` |
| SoftHSMv2 | 2.7.0 (develop HEAD) | `https://github.com/softhsm/SoftHSMv2` — التزكية `884cb38f3d2012a0447bd5f50dbd29c429987c41` |
| `WITH_EDDSA` | مُفعَّل (`#define WITH_EDDSA` في `config.h`) | نتيجة اكتشاف `ACX_BOTAN_EDDSA` وقت configure |

> **لماذا Botan 2.x لا 3.x؟** SoftHSMv2 يستخدم ترويسات Botan 2.x التي تُغيّرت/أُزيلت
> في Botan 3.x (مثل `botan/pipe.h`،`botan/rfc3394.h`،`botan/nist_keywrap.h`). Botan 3
> غير متوافقٍ مع SoftHSMv2. Ubuntu 26.04 يُصدِّر Botan 3.x فقط، لذا يُبنى Botan 2.19.5
> من المصدر.

## الخطوات (أمراً بأمر)

> ملاحظة حاسمة: تُصدَّر `LD_LIBRARY_PATH=/opt/botan2/lib` **قبل** `./configure`،
> وإلّا فشل اكتشاف EdDSA وقت configure (اختبار `AC_RUN_IFELSE` لا يجد `libbotan-2.so.19`
> وقت التشغيل) فيبقى `WITH_EDDSA` غير مُعرَّف، ويرجع `CKM_EC_EDWARDS_KEY_PAIR_GEN`
> بـ`CKR_MECHANISM_INVALID`.

### 1. البناء التحضيرّي والتبعيات

```bash
sudo apt-get update
sudo apt-get install -y build-essential python3 autoconf automake libtool pkg-config libsqlite3-dev xz-utils
```

### 2. بناء Botan 2.19.5 (مكتبة + ترويسات، بناءٌ كامل لا مُصغَّر)

```bash
cd ~
wget https://botan.randombit.net/releases/Botan-2.19.5.tar.xz
tar xf Botan-2.19.5.tar.xz
cd Botan-2.19.5
python3 configure.py --prefix=/opt/botan2 --with-build-dir=build2 --without-documentation
make -f build2/Makefile -j2 build2/libbotan-2.so.19
sudo mkdir -p /opt/botan2/lib /opt/botan2/include/botan-2
sudo cp -L build2/libbotan-2.so.19 /opt/botan2/lib/
sudo cp -rL build2/build/include/botan /opt/botan2/include/botan-2/botan
```

> **لا تبنِ CLI** (`make` بدون تحديد هدف): فشلُ الترجمة مع `slurp_file`. ابنِ هدف
> المكتبة `build2/libbotan-2.so.19` فقط. البناء الكامل (لا `--minimize-size`)
> ضروريٌّ لأنّ SoftHSM يتطلّب ترويسات `filters`/`rfc3394`/`nist_keywrap`/`pipe`.

### 3. بناء SoftHSMv2 بخلفية Botan

```bash
cd ~
git clone https://github.com/softhsm/SoftHSMv2
cd SoftHSMv2
git checkout 884cb38f3d2012a0447bd5f50dbd29c429987c41   # تثبيت التزكية المُتحقَّقة
export LD_LIBRARY_PATH=/opt/botan2/lib        # ← حاسمة قبل configure
autoreconf --install --force
./configure \
  --with-crypto-backend=botan \
  --with-botan=/opt/botan2 \
  --prefix=/opt/softhsm-botan \
  --disable-gost
```

تحقَّق من `WITH_EDDSA` قبل `make`:

```bash
grep WITH_EDDSA config.h   # يجب أن يظهر: #define WITH_EDDSA
```

ثمّ ابنِ وثبّت:

```bash
make -j2
sudo make install
```

## خطوات التحقّق من البناء

### أ. إثبات أنّ الموديول يربط Botan لا OpenSSL

```bash
export XUUX_PKCS11_MODULE=/opt/softhsm-botan/lib/softhsm/libsofthsm2.so
node scripts/pkcs11-backend-probe.mjs
# أو يدويّاً:
ldd "$XUUX_PKCS11_MODULE" | grep -i botan   # libbotan-2.so.19
ldd "$XUUX_PKCS11_MODULE" | grep -iE 'libcrypto|libssl'   # فارغ
```

الناتج المُتحقَّق: `links libbotan-2: true`، `links libcrypto/libssl: false`، `PASS`.

### ب. تهيئة توكن اختبار (Botan backend)

```bash
export SOFTHSM2_CONF=$HOME/softhsm2-botan.conf
mkdir -p $HOME/hsm-botan-tokens
cat > "$SOFTHSM2_CONF" <<EOF
directories.tokendir = $HOME/hsm-botan-tokens
EOF
export LD_LIBRARY_PATH=/opt/botan2/lib
/opt/softhsm-botan/bin/softhsm2-util --init-token --free \
  --label xuux-security --so-pin "$SO_PIN" --pin "$PIN"
```

> لا تُمرِّر PIN عبر argv في الإنتاج. استعمل متغيّر بيئة أو ملفاً بصلاحية 600.

### ج. فحص توقيع EdDSA داخل HSM

```bash
export XUUX_PKCS11_MODULE=/opt/softhsm-botan/lib/softhsm/libsofthsm2.so
export XUUX_PKCS11_PIN="$PIN"
npm run hsm:probe
# الناتج المتوقع: === PASS: التوقيع داخل HSM يعمل والتحقق ناجح === ، EXIT=0
```

### د. توليد المفاتيح والتحقّق من توقيع F06/F07

```bash
export XUUX_PKCS11_TOKEN=xuux-security
npm run hsm:keygen                    # يُولّد F05/F06/F07
XUUX_PKCS11_KEY_ID=06 node scripts/pkcs11-existing-eddsa-sign-test.mjs   # F06
XUUX_PKCS11_KEY_ID=07 node scripts/pkcs11-existing-eddsa-sign-test.mjs   # F07
# الناتج المتوقع لكلٍّ منهما: curve OID=1.3.101.112 kind=Ed25519 ... PASS ... EXIT=0
```

## قائمة التحقّق على بيئة WSL2 الإنتاجية

1. `node scripts/pkcs11-backend-probe.mjs` → `PASS: module links Botan`.
2. `npm run hsm:probe` → `PASS`، `EXIT=0`.
3. `npm run hsm:keygen` → يُولّد F05/F06/F07، كلٌّ `CKA_NEVER_EXTRACTABLE=true`.
4. `XUUX_PKCS11_KEY_ID=06|07 node scripts/pkcs11-existing-eddsa-sign-test.mjs` → `PASS`.
5. `npm run validate` → أخضر (47 بوابة حراسة + `npm test`).
6. CI أخضر على الفرع.

> قبل تبديل الخلفية الإنتاجية: شغّل `hsm:probe` **على موديول OpenSSL الحالي بعد
> تصحيح OID**. إن نجح، فالانتقال إلى Botan اختياريٌّ لا واجب (راجع ADR-0002).
