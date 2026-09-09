# WL-099 — نصوصٌ خامّةٌ: هل تنجحُ إعادةُ لقطةٍ كاملةٍ متّسقةٍ؟

هذه الوثيقةُ **دليلٌ على حدٍّ لا على إصلاحٍ**. سؤالُها واحدٌ: خصمٌ يملكُ القرصَ
أخذَ لقطةً كاملةً لجذرِ الحالةِ **ولحالةِ التوكنِ** في زمنٍ صحيحٍ، ثمَّ تقدّمَت
الدولةُ (أمرٌ موقَّعٌ ثمَّ إيقافٌ سياديٌّ موقَّعٌ)، ثمَّ أعادَ اللقطةَ كلَّها —
فماذا يقعُ؟

**النتيجةُ المقيسةُ: الإعادةُ تنجحُ.** يُقلعُ الجذرُ بلا رفضٍ، وتعودُ الحالةُ من
`halted` إلى `running` بعهدٍ صفرٍ، ويُقبَلُ الأمرُ الذي كان قد ثُبِّتَ ووُقِّعَ
مرّةً ثانيةً. والخاتَمُ لا يكشفُ ذلك لأنّه **وقَّعَ تلك الحالةَ بنفسِه**؛ فصحّةُ
التوقيعِ ليست حمايةً من الإعادةِ.

**ما مَنَعَ الاسترجاعَ في المجَسّاتِ السابقةِ ليس التوقيعَ وحدَه بل عدمُ
الاتّساقِ:** استرجاعٌ جزئيٌّ (متنٌ أقدمُ وملفّاتٌ أحدثُ) يُكشَفُ لأنّ الفحوصَ
المتقاطعةَ تجدُ تناقضاً — تسلسلاً أو رأسَ دفترِ رفعٍ أو توجيهَ إيقافٍ أحدثَ.
واللقطةُ الكاملةُ لا تُنتِجُ تناقضاً، فلا يوجدُ ما يُقارَنُ به: **كلُّ مرجعِ
حداثةٍ في هذا التصميمِ يقعُ داخلَ ما استعادَه الخصمُ.**

- الشاهدُ المُدرَجُ في الحزمةِ: `tests/root-of-trust/replay-limit.test.mjs`
- القرارُ والخياراتُ: `docs/adr/0006-state-manifest-seal-and-anti-rollback-limit.md`
- الحكمُ على `R3-A-01` **لم يُغلَقْ** ولا يُقرأُ من هذه الوثيقةِ.

## 1. المجَسُّ على SoftHSM حقيقيٍّ — نصٌّ خامٌّ

البيئةُ: SoftHSM 2.6.1 المبنيُّ من المصدرِ في
`/home/user/workspace/round3/softhsm`، وموديولٌ ببصمةِ
`d1e30c3f265a8ded9af3ea1b8d7a5b672ad2b7103c5e47c82d4a27767f3e7e23`، وتوكنٌ
**مؤقّتٌ مستقلٌّ** في `/tmp` بعلامةِ `replay-token` وبرمزٍ خاصٍّ به وحدَه.
**لم يُلمَسْ توكنُ المالكِ ولا مفتاحُه ولا رمزُه، ولا نُفِّذَ تدويرٌ عليه.**
وكلُّ إقلاعٍ في **عمليّةٍ مستقلّةٍ** لأنّ PKCS#11 يُهيَّأُ مرّةً لكلِّ عمليّةٍ.

```text
== التوكن: label=replay-token serial=4fdaed3319a7fdab kingId=king:8a252d2c6531ed981d871143
== module sha256=d1e30c3f265a8ded9af3ea1b8d7a5b672ad2b7103c5e47c82d4a27767f3e7e23
--- T0 تهيئة
{"phase":"init","booted":true,"halt":"running","epoch":0,"body":{"version":2,"kingId":"king:8a252d2c6531ed981d871143","context":"","tokenSerial":"4fdaed3319a7fdab","moduleSha256":"d1e30c3f265a8ded9af3ea1b8d7a5b672ad2b7103c5e47c82d4a27767f3e7e23","instanceId":"6203ca42aa1a17a4bfbbfeecc658962885c4491f10937607c117ab8a62197f61","createdAt":"2026-09-09T16:32:37.957Z","sealedAt":"2026-09-09T16:32:37.961Z","sequence":2,"anchoredCount":0,"haltEpoch":0,"ledgerCommitted":0,"journalHead":"checkpoint:2"}}
--- T1 لقطة كاملة: جذر الحالة + مجلد التوكن
--- T2 تقدّم الحالة (أمر جديد + إيقاف سياديّ)
{"phase":"advance","booted":true,"halt":"halted","epoch":0,"haltedTo":1,"body":{"version":2,"kingId":"king:8a252d2c6531ed981d871143","context":"","tokenSerial":"4fdaed3319a7fdab","moduleSha256":"d1e30c3f265a8ded9af3ea1b8d7a5b672ad2b7103c5e47c82d4a27767f3e7e23","instanceId":"6203ca42aa1a17a4bfbbfeecc658962885c4491f10937607c117ab8a62197f61","createdAt":"2026-09-09T16:32:37.957Z","sealedAt":"2026-09-09T16:32:38.068Z","sequence":6,"anchoredCount":0,"haltEpoch":1,"ledgerCommitted":1,"journalHead":"checkpoint:6"}}
--- T3 استرجاع اللقطة الكاملة (الجذر + حالة التوكن)
{"phase":"after-restore","booted":true,"halt":"running","epoch":0,"replayOfAdvanceCommand":"قُبِلَ","body":{"version":2,"kingId":"king:8a252d2c6531ed981d871143","context":"","tokenSerial":"4fdaed3319a7fdab","moduleSha256":"d1e30c3f265a8ded9af3ea1b8d7a5b672ad2b7103c5e47c82d4a27767f3e7e23","instanceId":"6203ca42aa1a17a4bfbbfeecc658962885c4491f10937607c117ab8a62197f61","createdAt":"2026-09-09T16:32:37.957Z","sealedAt":"2026-09-09T16:32:38.175Z","sequence":5,"anchoredCount":0,"haltEpoch":0,"ledgerCommitted":1,"journalHead":"checkpoint:5"}}
TOKENDIR=/tmp/replayhsm-9xwd
```

**قراءةُ النصِّ:** في `advance` صارت الحالةُ `halted` بعهدٍ `1` و`ledgerCommitted`
واحداً. وبعدَ `after-restore`: `booted: true` و`halt: running` و`epoch: 0`،
و`replayOfAdvanceCommand: قُبِلَ` — أي أنّ الأمرَ المُثبَّتَ الموقَّعَ قُبِلَ من
جديدٍ. **ولا رمزَ خطإٍ واحداً في المسارِ.**

## 2. المجَسُّ بمصدرٍ محقونٍ (ثابتِ المفاتيحِ) — نصٌّ خامٌّ

مستوىً ثانٍ للتأكيدِ، وفيه `anchoredCount` غيرُ صفرٍ (سجلٌّ مُثبَّتٌ بمرساةٍ)
لبيانِ أنّ الإعادةَ تنجحُ حتى معَ مراسٍ قائمةٍ. **وهذا موفِّرٌ محقونٌ لا
SoftHSM، ولا يُوصَفُ دليلَ عتادٍ.**

```text
== T0: تهيئةُ جذرٍ إنتاجيٍّ ==
T1 body = {"version":2,"kingId":"king:e554cd6a20b65e50cbb5d9cc","context":"","tokenSerial":"DEADBEEFCAFE0001","moduleSha256":"ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff","instanceId":"9e5c0f8114d7ec78d2775f99b5576e0c84db077a13757d95c3e6e2586a9d8b8b","createdAt":"2026-09-09T16:32:38.230Z","sealedAt":"2026-09-09T16:32:38.240Z","sequence":5,"anchoredCount":1,"haltEpoch":0,"ledgerCommitted":1,"journalHead":"checkpoint:5"}
T1 ملفّات الجذر = anchors.jsonl commands.ledger commands.ledger.claims events.log events.log.head halt root-of-trust.manifest.json

== T1: لقطةٌ كاملةٌ متّسقةٌ للجذرِ كلِّه (cp -a) ==

== T2: تقدّمُ الحالةِ — أمرٌ جديدٌ ثمَّ إيقافٌ سياديٌّ موقَّع ==
T2 halt = {"state":"halted","epoch":1,"reason":"إيقافٌ سياديّ","at":"2026-09-09T16:32:38.248Z","directive":{"version":1,"epoch":1,"state":"halted","reason":"إيقافٌ سياديّ","at":"2026-09-09T16:32:38.248Z","kingId":"king:e554cd6a20b65e50cbb5d9cc","keyVersion":1,"previousDirectiveHash":"GENESIS_HALT","hash":"27f0b328da9e2a0cac6f3094e0fe3df41defcf2970d2e5b87c9334b80862809e","signature":"gdHUdhhVeEt6ecJvoBMbm01LpUH-h9rwxTyi2aFDqAq0z9a5GH7eXokct_zRUHNiudTfZFntQZmuqHYjD9J2AQ"}}
T2 body = {"version":2,"kingId":"king:e554cd6a20b65e50cbb5d9cc","context":"","tokenSerial":"DEADBEEFCAFE0001","moduleSha256":"ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff","instanceId":"9e5c0f8114d7ec78d2775f99b5576e0c84db077a13757d95c3e6e2586a9d8b8b","createdAt":"2026-09-09T16:32:38.230Z","sealedAt":"2026-09-09T16:32:38.249Z","sequence":9,"anchoredCount":1,"haltEpoch":1,"ledgerCommitted":2,"journalHead":"checkpoint:9"}

== T3: استرجاعُ اللقطةِ الكاملةِ فوقَ الجذرِ (محوٌ ثمَّ نسخٌ) ==
T3 body قبلَ الإقلاع = {"version":2,"kingId":"king:e554cd6a20b65e50cbb5d9cc","context":"","tokenSerial":"DEADBEEFCAFE0001","moduleSha256":"ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff","instanceId":"9e5c0f8114d7ec78d2775f99b5576e0c84db077a13757d95c3e6e2586a9d8b8b","createdAt":"2026-09-09T16:32:38.230Z","sealedAt":"2026-09-09T16:32:38.240Z","sequence":5,"anchoredCount":1,"haltEpoch":0,"ledgerCommitted":1,"journalHead":"checkpoint:5"}
T3 النتيجة = {
  "booted": true,
  "halt": {
    "state": "running",
    "epoch": 0,
    "reason": "لا توجيه",
    "at": null,
    "directive": null
  },
  "body": {
    "version": 2,
    "kingId": "king:e554cd6a20b65e50cbb5d9cc",
    "context": "",
    "tokenSerial": "DEADBEEFCAFE0001",
    "moduleSha256": "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
    "instanceId": "9e5c0f8114d7ec78d2775f99b5576e0c84db077a13757d95c3e6e2586a9d8b8b",
    "createdAt": "2026-09-09T16:32:38.230Z",
    "sealedAt": "2026-09-09T16:32:38.254Z",
    "sequence": 7,
    "anchoredCount": 1,
    "haltEpoch": 0,
    "ledgerCommitted": 1,
    "journalHead": "checkpoint:7"
  },
  "replayOfT2Command": "قُبِلَ"
}

الحكم: REPLAY نجحَ — الحالةُ عادت إلى ما قبلَ الإيقافِ
```

## 3. إعادةُ الإنتاجِ

الشاهدُ المُدرَجُ في المستودعِ يُشغَّلُ بأمرٍ واحدٍ، ويعملُ في CI بلا توكنٍ:

```bash
node --test tests/root-of-trust/replay-limit.test.mjs
```

ونصُّ المجَسِّ على توكنٍ حقيقيٍّ — كما شُغِّلَ حرفياً — سائقٌ وطورٌ:

```bash
set -e
export PATH=/home/user/workspace/round3/softhsm/bin:$PATH
T=$(mktemp -d /tmp/replayhsm-XXXX)
printf 'directories.tokendir = %s/tokens\nobjectstore.backend = file\nlog.level = ERROR\n' "$T" > $T/softhsm2.conf
mkdir -p $T/tokens
export SOFTHSM2_CONF=$T/softhsm2.conf
export XUUX_PKCS11_MODULE=/home/user/workspace/round3/softhsm/lib/softhsm/libsofthsm2.so
export XUUX_PKCS11_TOKEN=replay-token
export XUUX_PKCS11_PIN=222222
softhsm2-util --init-token --free --label replay-token --so-pin 111111 --pin 222222 >/dev/null
cd /home/user/workspace/xuux
XUUX_PKCS11_TOKEN_SERIAL='' node scripts/pkcs11-keygen.mjs --log $T/keygen.log >/dev/null
# استخراجُ الهويةِ والرقمِ من التوكنِ نفسِه
IDJSON=$(node -e '
const {Pkcs11HsmProvider}=await import("/home/user/workspace/xuux/src/root-of-trust/pkcs11-provider.mjs");
const {bindHsmRootOfTrust}=await import("/home/user/workspace/xuux/src/root-of-trust/hsm-binding.mjs");
const p=await Pkcs11HsmProvider.create({modulePath:process.env.XUUX_PKCS11_MODULE,tokenLabel:process.env.XUUX_PKCS11_TOKEN,pin:process.env.XUUX_PKCS11_PIN});
const b=await bindHsmRootOfTrust(p,{env:{}});
process.stdout.write(JSON.stringify({serial:p.describe().tokenSerial,kingId:b.kingSigner.id}));
await p.close();' --input-type=module)
export XUUX_PKCS11_TOKEN_SERIAL=$(node -e "process.stdout.write(JSON.parse(process.argv[1]).serial)" "$IDJSON")
export XUUX_KING_ID=$(node -e "process.stdout.write(JSON.parse(process.argv[1]).kingId)" "$IDJSON")
export XUUX_PKCS11_MODULE_SHA256=$(sha256sum $XUUX_PKCS11_MODULE | cut -d' ' -f1)
echo "== التوكن: label=replay-token serial=$XUUX_PKCS11_TOKEN_SERIAL kingId=$XUUX_KING_ID"
echo "== module sha256=$XUUX_PKCS11_MODULE_SHA256"
ROOT=$T/state; mkdir -p $ROOT
echo "--- T0 تهيئة"; node /tmp/replay2/phase.mjs init "$ROOT"
echo "--- T1 لقطة كاملة: جذر الحالة + مجلد التوكن"
cp -a $ROOT $T/state.snap; cp -a $T/tokens $T/tokens.snap
echo "--- T2 تقدّم الحالة (أمر جديد + إيقاف سياديّ)"; node /tmp/replay2/phase.mjs advance "$ROOT"
echo "--- T3 استرجاع اللقطة الكاملة (الجذر + حالة التوكن)"
rm -rf $ROOT $T/tokens; cp -a $T/state.snap $ROOT; cp -a $T/tokens.snap $T/tokens
node /tmp/replay2/phase.mjs after-restore "$ROOT"
echo "TOKENDIR=$T"
```

```js
// طورٌ واحدٌ في عمليّةٍ مستقلّةٍ — PKCS#11 يُهيَّأُ مرّةً لكلِّ عمليّة.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const { createProductionRootOfTrust } = await import('/home/user/workspace/xuux/src/root-of-trust/index.mjs');
const phase = process.argv[2];
const root = process.argv[3];
const env = { ...process.env, NODE_ENV: 'production', XUUX_ROOT_OF_TRUST_MODE: 'hsm', XUUX_ROOT_OF_TRUST_PROVISION: '1' };
const body = () => JSON.parse(readFileSync(join(root, 'root-of-trust.manifest.json'), 'utf8')).body;
let rt;
try {
  rt = await createProductionRootOfTrust(env, { root });
} catch (e) {
  console.log(JSON.stringify({ phase, booted: false, code: e.code, detail: e.detail, message: e.message }));
  process.exit(0);
}
const out = { phase, booted: true, halt: rt.haltSwitch.read().state, epoch: rt.haltSwitch.read().epoch };
if (phase === 'advance') {
  const cmd = { id: 'أمر-جديد' };
  rt.ledger.begin(cmd); await rt.ledger.commitSigned(cmd, 'تمّ');
  const d = await rt.haltSwitch.haltAsync('إيقافٌ سياديّ');
  out.haltedTo = d.epoch; out.halt = rt.haltSwitch.read().state;
} else if (phase === 'after-restore') {
  const cmd = { id: 'أمر-جديد' };
  try { rt.ledger.begin(cmd); await rt.ledger.commitSigned(cmd, 'إعادة'); out.replayOfAdvanceCommand = 'قُبِلَ'; }
  catch (e) { out.replayOfAdvanceCommand = 'رُفِضَ: ' + (e.code ?? e.message); }
}
out.body = body();
rt.log.close?.(); await rt.close();
console.log(JSON.stringify(out));
```

## 4. ما لا تقولُه هذه الوثيقةُ

- **لا تُغلِقُ `R3-A-01`** ولا `UF-01` ولا `UF-03` ولا `UF-07`؛ الأحكامُ للمجلسِ.
- **لا تدّعي اكتمالَ إصلاحِ `R3-A-01`:** مسارُ تعديلِ البيانِ مسدودٌ بدليلٍ،
  ومسارُ الإعادةِ الكاملةِ **قائمٌ ومُعلَنٌ**.
- **لا توصي بعدّادٍ إضافيٍّ على القرصِ نفسِه:** ذلك يُعيدُ المشكلةَ باسمٍ آخرَ،
  وقد مُنِعَ نصّاً.
- **لا تُنفِّذُ شبكةً ولا عتاداً**، ولا تُعدِّلُ بوابةً ولا نسبةً ولا
  `config/external-review.yaml`.
