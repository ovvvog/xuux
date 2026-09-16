# سجلُّ هويةِ المالكِ والأجهزة

## نظرةٌ عامّةٌ

سجلٌّ موحَّدٌ لهويةِ المالكِ وأجهزتِه. يدعمُ تعدّدَ المعرّفاتِ (بريد، هاتف،
Telegram، WhatsApp، Instagram، X/Twitter) وتعدّدَ الأجهزةِ لكلِّ مالكٍ.

## الوحداتُ

### `src/owner-identity/owner-identity.mjs`

- `createOwnerIdentity(ownerId, identityType, identityValue, opts)` — ينشئُ سجلَّ هوية.
- `normalizeIdentityValue(type, value)` — يُطبِّعُ القيم (email→lowercase, phone→E.164).
- `maskIdentityValue(type, value)` — يُخفي القيمةَ في السجلِّ.
- `isValidIdentityValue(type, value)` — يتحقّقُ من صحةِ القيمة.
- `isDeliverable(identity)` — يحدّدُ هل الهويةُ قابلةٌ للتسليم.
- `maskOwnerIdentity(identity)` — يُخفي كلَّ الحقول الحسّاسة في السجلِّ.

### `src/owner-identity/owner-device.mjs`

- `createOwnerDevice(opts)` — ينشئُ سجلَّ جهاز.
- `maskDeviceFingerprint(fingerprint)` — يُخفي بصمةَ الجهاز.
- `maskOwnerDevice(device)` — يُخفي كلَّ الحقول الحسّاسة.

## أنواعُ الهويةِ المدعومة

- `email` — بريدٌ إلكترونيٌّ
- `phone` — رقمُ هاتف (E.164)
- `telegram_chat` — معرّف محادثة Telegram
- `telegram_bot` — Bot Token مرجع
- `whatsapp` — رقم WhatsApp
- `instagram` — حساب Instagram
- `x_twitter` — حساب X/Twitter
- `device_id` — معرّف جهاز
- `internal` — معرّف داخلي

## القواعدُ

- **لا أسرارَ في القاعدة:** المتغيّراتُ البيئيّة تحملُ المراجع، والقاعدةُ تحملُ الإشارةَ فقط.
- **لا MAC كوجهةِ إنترنت:** بصمةُ الجهازِ ليست عنواناً للإرسال.
- **التطبيعُ إلزاميٌّ:** كلُّ قيمةٍ تُطبَّعُ قبل التخزين.
- **الإخفاءُ في السجلِّ:** لا تُكتبُ قيمةٌ خامّةٌ في أي سجلٍّ تدقيق.
