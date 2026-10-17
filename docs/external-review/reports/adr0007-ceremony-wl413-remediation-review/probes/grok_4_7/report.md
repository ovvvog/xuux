# تقريرُ مراجعةٍ مستقلّة — معالجةُ عوائقِ WL-412 (WL-413) — grok_4_7
**المُعرِّف:** grok_4_7  **المزوِّد:** xAI
**زمنُ التشغيل:** البدء 2026-10-17T23:33:44Z؛ الانتهاء 2026-10-17T23:54:34Z
**الكوميتُ المُراجَع:** dbaf61049bbdb9b2b93cab6c7605d439c1c465b3 (طبعَه `git rev-parse HEAD` في `/home/user/workspace/xuux-review-dbaf6104`)
**بيئةُ التشغيل:** Ubuntu؛ Node v20.20.2؛ PowerShell 7.4.6؛ swtpm 0.10.1؛ tpm2-tools 5.7؛ Mono mcs 6.14.1.0. لا TPM حقيقيّ، ولا مضيفُ Windows، ولا TBS، ولم يُفتح `/dev/tpm*`. المنفذُ المُسنَد 2121 والتحكّمُ 2122. مسابرُ العزل على منافذ 2141–2229 خارجَ مدى الاختبارات (2299 و2321 و2400–3000 و3100–3500).

## تصريحُ استقلال
قرأتُ `/home/user/workspace/council-wl413/brief.md`، وشجرةَ المراجعةِ عند `dbaf6104` (الشيفرةَ والاختباراتِ وADR 0007 §12 ونموذجَ التهديدِ §7 البند 11 وسجلَّ WL-413 وREADME)، وتقاريرَ WL-412 التاريخيّةَ ومسابرَها في `docs/external-review/reports/adr0007-ceremony-rehearsal-review/`، و`evidence/` تحت `docs/external-review/reports/adr0007-ceremony-wl413-remediation-review/` (بما فيه `brief.md` هناك لم أحتجْ إلى غيرِ موجزِ الحزمةِ في المجلس). لم أقرأْ مجلّدَي `council-wl413/gpt_6_1_sol` و`council-wl413/gemini_3_8_flash`، ولا أيَّ تقريرِ عضوٍ في هذه الجولة. لم أعدِّلْ ملفّاً متعقَّباً في شجرةِ المراجعة. `git status --porcelain` فيها فارغٌ عندَ البدءِ وعندَ الانتهاء.

## سجلُّ الأدلّة

### تثبيتُ الشجرة
```
cd /home/user/workspace/xuux-review-dbaf6104 && git rev-parse HEAD
dbaf61049bbdb9b2b93cab6c7605d439c1c465b3
git diff 1ca1668e --stat -- sim/tpm-host/
(فارغ — 0 بايت)
git status --porcelain
(فارغ)
```
خروجُ الأمرينِ الأخيرينِ 0.

### محاكيُ المنفذِ 2121 والاختباراتُ الأربع
```
swtpm socket --tpm2 --tpmstate dir=/home/user/workspace/council-wl413/grok_4_7/st \
  --server type=tcp,port=2121,bindaddr=127.0.0.1 \
  --ctrl type=tcp,port=2122,bindaddr=127.0.0.1 \
  --flags not-need-init,startup-clear \
  --pid file=/home/user/workspace/council-wl413/grok_4_7/pid --daemon
```
خروجُ البدءِ 0. PID=14516. `ss` أظهرَ 127.0.0.1:2121 و2122 للعمليّةِ نفسِها. 2026-10-17T23:34:02Z.

```
XUUX_TPM_SIM=1 TPM2TOOLS_TCTI=swtpm:host=127.0.0.1,port=2121 \
  node --test --test-concurrency=1 \
  tests/sim/tpm-ceremony-rehearsal.test.mjs \
  tests/sim/tpm-ceremony-guard.test.mjs \
  tests/sim/tpm-ceremony-remediation.test.mjs \
  tests/sim/tpm-ceremony-wl413-r2.test.mjs
```
المخرجُ في `logs/node-tests.out`. الخاتمة:
```
# tests 41
# fail 0
# skipped 0
# duration_ms 34244.462678
EXIT:0
```
سطرُ المُشغِّلِ `# pass 41` منقولٌ كما طبعَه. هذا مخرجُ الحزمةِ لا حكمٌ.

### البروفةُ على 2121
```
pwsh -NoProfile -File sim/tpm-ceremony/rehearse.ps1 -SimHost 127.0.0.1 -SimPort 2121 -Stages ALL \
  -SimPidFile /home/user/workspace/council-wl413/grok_4_7/pid
```
خروج 0. الملفُّ `rehearsal.json`. الحقلُ `status` = `COMPLETE`. `failure` = null. 81 خطوة. `cleanupLeftovers` = []. `postRunInventory.verified` = true والبقايا الثلاثُ فارغة. `transport.listener.before` = `transport.listener.after` = `pid=14516 comm=swtpm`. الحقائق: manufacturer=`IBM`، vendorString=`SW   TPM` (مسافتانِ داخلَ «SW» ومسافةٌ قبلَ «TPM»)، vendorString3/4 فارغتانِ بعدَ قصِّ الأصفارِ في العرضِ فقط. العدّادُ بعدَ إعادةِ التعريفِ `s1.redefine.aboveProbe=true`. `nvCountersMax=0`. رموزُ الرفضِ المقيسة: `0x14a` ثمّ `0x18b` ثمّ `0x12f` ثمّ `0x5db` ثمّ `0x5db` ثمّ `0x99d` ثمّ `0x99d`. بصمةُ جلسةِ التجربة = بصمةُ الصيغةِ في النواة = `ebef71870d3e7b8d96c4ae03e909e0ada089ebd9f1ea6a69f7a7b319ce62a338`. لا حقلَ بايتاتِ أمرٍ خامّ. السماتُ بعدَ فكِّ المنطقةِ العامّة: البتّاتُ 8–9 و20–24 = 0.

حسابٌ ثالثٌ بـNode على اسمِ المفتاحِ من التقرير:
```
node /tmp/pol.mjs 000b77e6af16fab2c95fd82c2059e265be30cb3651a2c5127dcf3498a1b2b407bcbf
node ebef71870d3e7b8d96c4ae03e909e0ada089ebd9f1ea6a69f7a7b319ce62a338
clean []
bit8 ["RESERVED_BIT_8=1"]
```
البصمةُ الثالثةُ طابقتِ الاثنين. البتُّ 8 يُسمّى `RESERVED_BIT_8=1`.

### مسابرُ مستقلة (mono + النواةُ من الشجرة، بلا تعديل)
الترجمة: `mcs -langversion:5 -out:.../ProbeRunner.exe <tree>/sim/tpm-ceremony/TpmCeremonyCore.cs .../ProbeRunner.cs` — خروج 0. كلُّ وضعٍ على swtpm جديد. المخرجاتُ في `logs/probes/`.

| الوضع | status | ما طُبع |
| --- | --- | --- |
| invalid-tag-success | FAILED_CLOSED | `RESPONSE_TAG_MISMATCH: expected=0x8001 got=0x1234` خطوةٌ واحدة، لا أمرَ مُغيّر |
| truncated-header | FAILED_CLOSED | `RESPONSE_TRUNCATED_HEADER` |
| size-mismatch | FAILED_CLOSED | `RESPONSE_SIZE_MISMATCH` |
| error-with-body | FAILED_CLOSED | `RESPONSE_ERROR_BODY_MALFORMED rc=0x00000101` |
| error-bad-tag | FAILED_CLOSED | `RESPONSE_ERROR_TAG_MALFORMED rc=0x00000101` |
| hmac-nonzero | COMPLETE | 81 خطوة، `changes=1`، بقايا فارغة، `postVerified=true` |
| plant-same-public | FAILED_CLOSED | `ownership proven by publicArea match` ثمّ `undefineForwards=1` و`residualNv=[]` و`nv` بعدَ التشغيلِ فارغ. المقبض `0x01b162c6` زُرعَ قبلَ تمريرِ تعريفِنا (`plant-rc=00000000`) |
| redefine-after-exec | FAILED_CLOSED | التعريفُ نُفِّذ ثمّ أُلغيَ وأُعيدَ تعريفُه بتفويضِ فهرس `0x11` والمنطقةُ العامّةُ نفسُها. النصُّ `ownership proven` و`undefineForwards=1` و`residualNv=[]` |
| drop-create | FAILED_CLOSED | `OUTCOME_UNKNOWN: s2:Create...` و`reconciliation=[]` ولا بقايا |
| drop-refused-policysigned | FAILED_CLOSED | `OUTCOME_UNKNOWN: s2v.replay:PolicySigned(old-signature)` و`reconciliation=[]` ولا جلسةٌ باقية |
| cleanup-undefine-no-retry | FAILED_CLOSED | `nv-undefine 0x0189e3ac: still present; deletion outcome unknown; cleanup retries once (bounded)` والملاحظة `cleanup-undefine-not-forwarded`. `residualNv=["0x0189e3ac"]` و`tpm2_getcap` أظهر `0x189E3AC` |
| drop-undefine-after-exec | FAILED_CLOSED | `verified absent (deletion took effect)` ولا بقيّةٌ معلَنة (الحذفُ وقعَ قبلَ رميِ الاستثناء) |
| io-before-increment | FAILED_CLOSED | `OUTCOME_UNKNOWN` لا `TOOL_ERROR`؛ المصالحة `not-executed (counter still uninitialized)` والفهرسُ حُذفَ في التنظيف |
| short-nonce (إعادةُ كتابةٍ كسرتِ الحجم) | FAILED_CLOSED | `RESPONSE_TRUNCATED` — هذا تشويهٌ بنيويٌّ لا طولُ nonce سليم. المختبرُ وحده قبلَ nonce طوله 1: `SCHEMA startsession-nonce1 accepted` |

مختبرُ المخطّط (`logs/probes/schema.txt`، خروج 0) على منفذ 2141:
- مسيرُ الشيفرةِ لـCreatePrimary: ثلاثُ TPM2B ثمّ `u16=8021` و`u32=40000001` وname بطول 34 يبدأ بـ`000b` و`remain=0`. هذا يطابقُ جدولَ 158 في Part 3 r1.38 (بلا `outPrivate`). مسيرٌ أضفتُ فيه `outPrivate` انقطعَ — الخطأُ في المسيرِ لا في الجدول.
- `createprimary-trailing` رُفض. `createprimary-flip-last` (قلبُ آخرِ بايتٍ داخلَ الاسم) **قُبل**.
- `sign-hashalg-sha1` **قُبل** من المخطّط. `startsession-nonce1` **قُبل**. `policygetdigest-short` (8 بايتات) **قُبل**. `nvread-7bytes` **قُبل**. `policysigned-flip-after-timeout-len` **قُبل**.
- الزوائدُ بعدَ نهايةِ الحقولِ رُفضت لأوامرِ GetCapability وCreate وPolicyCommandCode وNV_DefineSpace.
- `PARSE paramsize-ffffffff` على mono: `OutOfMemoryException: Insufficient memory to continue the execution of the program.`
- على pwsh (`probes/paramsize.ps1`، خروج 0): `caught System.OverflowException: Arithmetic operation resulted in an overflow.`

### إعادةُ أوضاعِ الحزامِ المشحون (pwsh، محاكٍ لكلِّ وضع)
الخروج 0 لكلِّ استدعاء. الملخّص:

| Fault | status | خلاصة |
| --- | --- | --- |
| invalid-tag | FAILED_CLOSED | `RESPONSE_TAG_MISMATCH` قبلَ خطِّ الأساس |
| missing-response-auth | FAILED_CLOSED | `RESPONSE_AUTH_AREA_MALFORMED`؛ المصالحة أثبتتِ التنفيذَ ثمّ الغيابَ بعدَ الحذف؛ البقيّةُ المعلَنةُ لم تُمحَ وأُضيف `post-run: … verified absent` |
| define-response-loss | FAILED_CLOSED | `executed; ownership proven` و`nvAfter=[]` |
| define-not-executed | FAILED_CLOSED | `not-executed (verified absent by read-only inventory)` و`nvAfter=[]` |
| flush-refusal | BLOCKED_FAIL_CLOSED | الجلسة `0x03000000` والكائنان `0x80000000`/`0x80000001` في البقايا وفي `postRunInventory` وفي `sessionsAfter` |
| unexpected-negative | FAILED_CLOSED | `NEGATIVE_WRONG_RC … expected=0x000005db got=0x00000101` |
| blocked-forever-undefine | BLOCKED_FAIL_CLOSED | البقيّةُ معلَنة و`nvAfter=['0x01a119f8']` |
| identity-string34 | FAILED_CLOSED | `SIMULATOR_IDENTITY_REQUIRED … vendor=0x53572020,0x2054504d,0x4556494c,0x58585858` خطوةٌ واحدة |
| identity-spacefold | FAILED_CLOSED | `vendor=0x53205720,0x5420504d,0x00000000,0x00000000` |
| identity-missing-prop | FAILED_CLOSED | `SIMULATOR_IDENTITY_INCOMPLETE: properties=4` |
| written-before-reconcile | FAILED_CLOSED | `TPMA_NV_WRITTEN is set … ownership undetermined; left in place`. لا `NV_UndefineSpace`. `residualNv` و`nvAfter` = `0x01b53012`. `thirdPartyRc=0x00000000` |
| neg-increment-loss | FAILED_CLOSED | `nv-increment … not-executed (counter still uninitialized)`. بقايا فارغة |
| trailing-readpublic | FAILED_CLOSED | `RESPONSE_PARAMS_TRAILING_BYTES: NV_ReadPublic extra=3`. الفهرسُ باقٍ ومعلَن |
| define-params-extra | FAILED_CLOSED | `OUTCOME_UNKNOWN … empty-params extra=2` ثمّ `ownership proven` وحُذف |
| getcap-wrong-cap | FAILED_CLOSED | `RESPONSE_CAPABILITY_MISMATCH: asked=0x00000006 got=0x00000001`. خطوةٌ واحدة. `postRunInventory.verified=false` |

حارسُ المضيف (`-Mode host-guard`، خروج 0): 15 شكلاً رُفضت. `GetCapability` و`NV_ReadPublic` بلغا النقلَ (`submitted 2`). `git diff 1ca1668e -- sim/tpm-host/` فارغ.

### النقل
وسيطُ التحكّمِ على `0.0.0.0:2212` مع خادمٍ على `127.0.0.1:2211`:
```
pwsh … rehearse.ps1 -SimPort 2211 -Stages S1 -SimPidFile …
```
خروج 0. الحقلُ `status` = `COMPLETE`. `ss` أظهر `0.0.0.0:2212`. الفحصُ لم ينظرْ إلى `--ctrl`.

ثنائيٌّ مُترجَمٌ باسمِ `swtpm` ومسارُه `probes/bin/swtpm` لا `/usr/bin/swtpm`، وسطرُ أوامرِه `socket --tpm2 --server type=tcp,port=2215,bindaddr=127.0.0.1`:
الفحصُ قبلَ التشغيلِ طبعَ `pid=16733 comm=swtpm`. السجلُّ `bytes=22` والبايتاتُ `8001000000160000017a…` (GetCapability). الخروج 1 والحقلُ `status` = `FAILED_CLOSED` بسببِ `rc=0x1` من الثنائيِّ لا بسببِ رفضِ المالك. `transport.listener.after` = `unverifiable: SIMULATOR_LISTENER_ABSENT` (الثنائيُّ خرجَ بعدَ قبولٍ واحد).

أُوقفَ swtpm 14516 وكلُّ محاكياتِ المسابر. عندَ الانتهاء لا مستمعَ swtpm من هذه الجولة، و`git status --porcelain` فارغ.

### أدلّةُ الحزمةِ على `42c0050a` (قراءةٌ لا إعادةُ تشغيل)
لم أُنشئْ شجرةً ثانيةً عند `42c0050a`. قرأتُ المخرجاتِ الخامَّ في الحزمة:
- `written-before-reconcile.at-42c0050a.jsonl`: `FAILED_CLOSED` و`ownership proven by publicArea match` و`cleanupLeftovers=[]`.
- `neg-increment-loss.at-42c0050a.jsonl`: `reconciliation=[]`.
- `trailing-params.at-42c0050a.jsonl`: `status` = `COMPLETE`.
- `via-proxy-pid.json` و`via-proxy-nopid.json`: `status` = `COMPLETE`. `proxy.log`: `proxied-commands=28` ثمّ `56`.
- `new-tests-against-42c0050a.tap`: الاختبارُ الأوّلُ `not ok` والخطأ `ownership proven`؛ وفرقُ `COMPLETE` مقابلَ `FAILED_CLOSED` ظاهرٌ في السجلّ.
- على `1ca1668e`: `invalid-tag.jsonl` حقلُ `status` = `COMPLETE`؛ `identity-ignores-string34.jsonl` كذلك.

## إعادةُ فحصِ العيوبِ الأصليّة وادّعاءاتِ R2

| المعرّف | إعادةُ الإنتاجِ على الشجرة | الحكم | الدليل |
| --- | --- | --- | --- |
| SOL-01 | وسمٌ `0x1234` ومنطقةُ تفويضٍ محذوفةٌ يوقفانِ التشغيلَ | زالَ بالقياس | `invalid-tag` و`missing-response-auth` و`invalid-tag-success`؛ الخروج 0 للحزام وFAILED_CLOSED في التقرير |
| SOL-02 | فقدُ الردِّ بعدَ التنفيذِ يُعلَن ويُحذفُ إذا طابقتِ المنطقةُ؛ فقدُه قبلَ التنفيذِ يُعلَن غياباً ولا يُحذف | زالَ بالقياس للحالةِ الأصليّة؛ انظر G47-413-1 للحافةِ المتبقّية | `define-response-loss` و`define-not-executed` |
| SOL-03 | رفضُ FlushContext المستمرُّ يُبقي المقبضَ في البقايا وعلى المحاكي | زالَ بالقياس | `flush-refusal`: `0x03000000` في `sessionsAfter` وفي `cleanupLeftovers` |
| SOL-04 | `0x101` مكانَ `0x5db` يُسمّى `NEGATIVE_WRONG_RC` | زالَ بالقياس | `unexpected-negative` |
| SOL-05 | فاحصُ Node يسمّي البتّات 8–9 و20–24 | زالَ بالقياس | `node /tmp/pol.mjs` طبعَ `RESERVED_BIT_8=1`؛ النواةُ تقارنُ القناعَ (السماتُ المقيسةُ بلا بتٍّ محجوز) |
| SOL-06 | المولّدُ يشملُ أمريِ الجرد؛ الحارسُ يرفضُ ما عداهما | زالَ بالقياس | `host-guard`: رفضٌ لخمسةَ عشرَ شكلاً، وبلوغٌ لاستعلامين |
| SOL-07 | الهويّةُ ما زالت إقراراً؛ مطابقةُ المنطقةِ العامّةِ لا تميّزُ إعادةَ تعريفٍ مماثلة | باقٍ كحدٍّ، والحذفُ تحتَ عبارةِ «proven» عيبٌ قائم (G47-413-1) | `plant-same-public` و`redefine-after-exec`؛ ADR §12.4 |
| G47-1 | EVIL/XXXX والطيُّ والخاصيّةُ الناقصةُ تُرفض قبلَ أمرٍ مُغيّر | زالَ بالقياس | ثلاثةُ أوضاعِ الهويّة |
| G47-2 | الحجبُ المستمرُّ للحذفِ يُعلِن البقيّةَ ويبقي الفهرسَ | زالَ بالقياس | `blocked-forever-undefine` |
| G47-3 | `IOException` على أمرٍ مُغيّر يُصنَّف `OUTCOME_UNKNOWN` | زالَ بالقياس لهذا المسار | `io-before-increment` و`define-not-executed`. استثناءُ `parameterSize` الضخمِ ليس `CeremonyFailedException` (G47-413-4) |
| G47-4 | التفويضُ فارغ | باقٍ ملاحظة | البروفةُ خرجت 0 بتفويضٍ فارغ؛ ADR §4.1 |
| G47-5 | الحسابُ الثالثُ طابقَ البصمة | زالَ بالقياس في هذا التشغيل | Node = النواة = جلسةُ التجربة |
| G47-6 | البتّاتُ المحجوزةُ مسمّاة | زالَ بالقياس | أعلاه |
| G47-7 | لا حزمةَ أمرٍ خامّة؛ المنطقةُ العامّةُ ما زالت في الوقائع | باقٍ ملاحظة | `rehearsal.json` |
| حدودُ gemini (ترويسةٌ مبتورة، حجمٌ غيرُ متطابق) | لم تعُد تُقبَل | زالَ بالقياس للحدّينِ اللذينِ أعدتُهما | `truncated-header` و`size-mismatch`. لم أُعِدْ ملفَّ Python التاريخيَّ (مسارُه لشجرةٍ قديمة) |
| R2-01 | على `42c0050a` الدليلُ الخامُّ يقول `ownership proven` ثمّ حذفاً. على هذه الشجرة WRITTEN=1 يُترك | زالَ بالقياس لحالةِ WRITTEN | الحزمة + `written-before-reconcile` هنا: لا حذف و`nvAfter` يحوي الفهرسَ |
| R2-02 | على `42c0050a` `reconciliation=[]`. هنا تُجرَد الزيادةُ السلبيّةُ الأولى | زالَ بالقياس للحالةِ المختبَرة | `neg-increment-loss`. الزيادتانِ السلبيّتانِ الأخريانِ في الشيفرةِ عبرَ `RefusedIncrement` ولم أُسقطْ ردَّهما |
| R2-03 | الزوائدُ بعدَ الحقولِ تُرفض. تشويهاتٌ داخليّةٌ وHMAC لا تُرفض | زالَ ظاهريّاً لعيبِ الزوائد؛ باقٍ لفجواتِ المخطّط (G47-413-2/3) | `trailing-readpublic` مقابلَ `hmac-nonzero` و`schema.txt` |
| R2-04 | جردٌ نهائيٌّ حاضر. بقيّةٌ ثبتَ غيابُها تُوثَّق ولا تُمحى. تعذّرُ الجردِ في الاختبارِ المشحون (نقلٌ ميّت) لم أُعِدْه يدوياً؛ الاختبارُ ضمنَ الـ41 | زالَ بالقياس لما أعدتُه | `missing-response-auth` أبقى البقيّةَ وأضاف ملاحظةَ الغياب؛ البروفةُ حملت `postRunInventory` |
| R2-05 | وسيطُ Node على المنفذِ يُرفض في اختبارِ الحزمة (ضمنَ الـ41). ثنائيٌّ باسم `swtpm` وسطرِ أوامرٍ مطابقٍ يستقبلُ أمراً | زالَ بالقياس لعيبِ الوسيطِ الموصوف؛ حدُّ الفحصِ مقيسٌ في G47-413-7 | `fake-swtpm.log` بايتات=22؛ اختبارُ R2-05 في `node-tests.out` |

## التحليل — سؤالاً سؤالاً (1–6)

### 1. إعادةُ فحصِ العيوبِ الأصليّة
بالتشغيل: العيوبُ التي كانت تقبلُ وسماً تالفاً أو تخفي فهرساً أو جلسةً أو تقبلُ `0x101` لم تُعِدِ الإنتاجَ على `dbaf6104`. الهويّةُ الخامُّ للخصائصِ الخمسِ ترفضُ EVIL والطيَّ والنقصَ قبلَ خطِّ الأساس. الحجبُ المستمرُّ للحذفِ يُعلِن الفهرسَ ويتركُه. استثناءُ الكتابةِ على أمرٍ مُغيّر صار `OUTCOME_UNKNOWN` وتبعَه جرد. فاحصُ Node يسمّي البتّاتِ المحجوزة. حارسُ المضيفِ لم يتغيّر منذ `1ca1668e` ويسمحُ باستعلامينِ فقط.

استنتاج: SOL-07 لم يُغلقْ كحدِّ ثقة؛ وما زال مسارُ الحذفِ بعدَ فقدِ ردِّ التعريفِ يسمّي المطابقةَ إثباتَ ملكيّةٍ ويحذف (السؤال 4 وG47-413-1). G47-4 وG47-7 ملاحظتانِ باقيتانِ كما وُصفتا، لا عودةً للعيوبِ الصامتة.

مواصفاتٌ قُرئت: [Part 3 r1.38 §6.1–§6.2](https://trustedcomputinggroup.org/wp-content/uploads/TPM-Rev-2.0-Part-3-Commands-01.38.pdf) (وسمُ النجاحِ يطابقُ الطلب، وردُّ الخطأ 10 بايتات)؛ [Part 2 r1.38 Table 204](https://trustedcomputinggroup.org/wp-content/uploads/TPM-Rev-2.0-Part-2-Structures-01.38.pdf) (البتّان 9:8 و24:20 «shall be zero»).

### 2. ادّعاءاتُ R2
بالتشغيل على هذه الشجرة، وبمخرجاتِ الحزمةِ على `42c0050a` (لم أُعِدْ بناءَ ذلك الكوميت):
- R2-01 كان عيباً في الدليلِ الخامّ (مطابقةٌ بعدَ إسقاطِ WRITTEN ثمّ حذف). هنا WRITTEN=1 يُترك والفهرسُ يبقى. الإصلاحُ لا يُعيدُ ذلك المسار. يُبقي مسارَ المطابقةِ التامّةِ الذي يحذفُ فهرساً لم تُنشئه هذه الجولة (قياسٌ أدناه).
- R2-02 كان صمتاً (`reconciliation=[]`). هنا الزيادةُ السلبيّةُ الأولى تُجرَد «لم تُنفَّذ». لم أُسقطْ ردَّ الزيادتينِ الأخريين؛ الشيفرةُ تمرّرهما عبرَ `RefusedIncrement` (قراءة).
- R2-03: زوائدُ `NV_ReadPublic` لم تَعُد تنتهي بالحقل `COMPLETE`. بقيَ ما لا يفحصُه المخطّط (السؤال 3).
- R2-04: الجردُ النهائيُّ موجودٌ في البروفةِ وفي مساراتِ الفشل، وبقيّةُ `missing-response-auth` لم تُمسَحْ رغمَ إثباتِ الغياب.
- R2-05: الدليلُ على `42c0050a` يُظهر مرورَ الأوامرِ عبرَ وسيطٍ حتى مع ملفِّ PID. على هذه الشجرةِ اختبارُ الحزمةِ (ضمنَ الـ41) يتوقّع رفضَ وسيطِ Node. قياسي: الفحصُ لا يثبّتُ أنّ الملفَّ التنفيذيَّ هو swtpm النظام.

### 3. تحليلُ الردود
ما كشفَه الفاحصُ بالتشغيل: وسمٌ غيرُ المتوقَّع، ترويسةٌ أقصرُ من 10، اختلافُ الحجمِ المعلَنِ عن الطول، ردُّ خطأٍ بوسمِ جلساتٍ أو بجسم، منطقةُ تفويضٍ غائبة، زوائدُ بعدَ الحقول، اسمُ Load أقصرُ من 34، قدرةٌ غيرُ المسؤولِ عنها، معاملاتُ تعريفٍ غيرُ فارغة.

ما لم يكشفْه، مقيساً:
- محتوى `hmac` في `TPMS_AUTH_RESPONSE`: إعادةُ كتابتِه إلى بايت `0xFF` مع إبقاءِ البنيةِ أنهتِ البروفةَ بالحقل `status`=`COMPLETE` (81 خطوة، بقايا فارغة). [Part 2 r1.38 §10.13.3](https://trustedcomputinggroup.org/wp-content/uploads/TPM-Rev-2.0-Part-2-Structures-01.38.pdf) يجعل الحقلَ HMAC أو EmptyAuth. [Part 1 rev 01.83 البند 19.6.3.1](https://trustedcomputinggroup.org/wp-content/uploads/TPM-2.0-1.83-Part-1-Architecture.pdf) يقول إنّ المتّصلَ يتحقّقُ من HMAC الردِّ. الشيفرةُ في `Resp.Parse` تقرأ nonce والسماتِ وhmac وتطرحُها (`TpmCeremonyCore.cs` حوالي 471–477).
- `parameterSize=0xFFFFFFFF`: لا رمزَ `RESPONSE_*`. pwsh يرمي `OverflowException`؛ mono يرمي `OutOfMemoryException`. السبب: `Raw((int)ps)` في `Resp.Parse` (حوالي 467–468) و`Need` لا يرفضُ الطولَ السالبَ قبلَ التخصيص. [Part 3 r1.38 §4.3](https://trustedcomputinggroup.org/wp-content/uploads/TPM-Rev-2.0-Part-3-Commands-01.38.pdf) يعرّف `parameterSize` حجماً لمنطقةِ المعاملات.
- المخطّطُ لا يفحصُ خوارزميّةَ تجزئةِ التوقيع (SHA-1 قُبلت)، ولا طولَ nonce جلسةِ البدء (بايتٌ واحدٌ قُبل)، ولا طولَ بصمةِ `PolicyGetDigest`، ولا طولَ بياناتِ `NV_Read` (7 بايتاتٍ قُبلت؛ المستدعي `ReadCounter` يرفضُ غيرَ 8 في مسارِ البروفة)، ولا وسمَ تذكرةِ `PolicySigned`، ولا بايتاتِ الاسمِ عدا الطول 34 والبادئة `000b` (قلبُ آخرِ بايتٍ في اسمِ CreatePrimary قُبل). [Part 3 r1.38 Table 158](https://trustedcomputinggroup.org/wp-content/uploads/TPM-Rev-2.0-Part-3-Commands-01.38.pdf) لـCreatePrimary (outPublic، creationData، creationHash، creationTicket، name — بلا outPrivate) وTable 20 لـCreate وTable 100 لـSign.
- عددُ المقابضِ يأتِي من المستدعي لا من الردّ. بايتاتُ مقبضٍ زائدةٌ داخلَ معاملاتِ `NV_ReadPublic` رُفضت لأنّها أفسدتِ المحاذاة. هذا ليس فحصاً مستقلاً لعددِ المقابض.

استنتاج: الفاحصُ يمسكُ تشويهَ الهيكلِ الظاهر (زوائد، وسم، حجم، منطقةُ تفويضٍ ناقصة) ولا يمسكُ محتوى التفويضِ ولا عدةَ حقولٍ داخليّةٍ ما دامتِ الأطوالُ متّسقة. ادّعاءُ README «أيُّ تشويهٍ ⇒ فشلٌ مغلق» أوسعُ من القياس.

`continueSession` CLEAR مع فشلِ الأمرِ لا يُنهي الجلسةَ حسبَ [Part 1 rev 01.83 البند 19.6.17](https://trustedcomputinggroup.org/wp-content/uploads/TPM-2.0-1.83-Part-1-Architecture.pdf). البروفةُ استطاعتْ `FlushContext` بعدَ الرفضِ (rc=0 في `rehearsal.json`)؛ هذا يطابقُ ذلك النصَّ على هذا المحاكي، لا يثبِتُ العتاد.

### 4. التنظيفُ والفشلُ المغلق
أوامرٌ مُغيّرةٌ تُرسَلُ خارجَ الدفتر، مقيسة:
- `Create` يُرسَل بـ`Ok` لا `SendTracked` (`TpmCeremonyCore.cs` حوالي 1143) وهو في مجموعةِ `StateChanging`. إسقاطُ الردِّ بعدَ الإرسال: `OUTCOME_UNKNOWN` و`reconciliation=[]`. لا مقبضَ جديداً فالبقايا فارغة. الفشلُ مُغلَق والحالةُ غيرُ مسجَّلةٍ في الدفتر.
- `PolicySigned` المرفوض (إعادةُ التوقيعِ وتوقيعُ المفتاحِ الآخر) يُرسَل بـ`Refused` لا بتتبّع. إسقاطُ الثالث: `OUTCOME_UNKNOWN` و`reconciliation=[]` والجلسةُ زالتْ في التنظيفِ لأنّها كانت في `_transients`. لا تسرّبَ مقبضٍ في هذا القياس، والدفترُ لا يذكرُ الطفرة.

ما يحذفُ ما لم تُثبَتْ ملكيّتُه، مقيساً:
- زرعُ فهرسٍ مطابقٍ بايتاً ببايت قبلَ تمريرِ `NV_DefineSpace`: المصالحةُ قالت `executed; ownership proven by publicArea match` وأُرسلَ `NV_UndefineSpace` مرةً والفهرسُ غاب. الجولةُ لم تُنشئْه.
- تنفيذُ التعريفِ ثمّ إلغاؤه وإعادةُ تعريفِه بالمنطقةِ نفسِها وتفويضِ فهرس مختلف: النصُّ نفسُه والحذفُ وقع. هذا لا يحتاجُ إلى رؤيةِ بايتاتِ الأمر؛ بعدَ التنفيذِ يظهرُ الفهرسُ في الجردِ ومنطقتُه العامّةُ مقروءة، والتفويضُ الفارغُ في تصميمِ §4.1 يجعلُ النسخةَ المطابقةَ غيرَ مميَّزة. ADR §12.4 يقول إنّ الطرفَ الثالثَ لا يُميَّز إلا بحصريّةِ الوصول، بينما الشيفرةُ تميّزُ المطابقةَ على أنّها إثباتٌ وتحذف. الخيارُ الذي لا يحتاجُ تمييزاً — عدمُ الإرسالِ لـ`NV_UndefineSpace` عندَ فقدِ ردِّ التعريفِ والاكتفاءُ بالإعلان — غيرُ مُتَّخذ. العبارةُ «لا يُميَّز إلا بحصريّةِ الوصول» تخفي هذا الخيار.

ما لا يُعلِن نظافةً بلا جرد: إذا لم يُؤخذْ خطُّ الأساس، `postRunInventory.verified=false` ونصُّ الخطأ يذكرُ غيابَ الخطّ (`getcap-wrong-cap`). إذا ماتَ النقلُ فالاختبارُ المشحونُ ضمنَ الـ41 يتوقّع الإعلان؛ لم أُعِدْ ذلك الوضعَ خارجَ الحزمة.

إعادةُ المحاولة: `MaxCleanupAttemptsPerResource = 1`. بعدَ فشلِ حذفِ التنظيفِ قبلَ الإرسال، المصالحةُ تقول `cleanup retries once (bounded)` ولا إرسالَ ثانٍ. الفهرسُ بقيَ ومُعلَن و`postRunInventory.verified=true` و`residualNv` يحويه. الاتجاهُ عدمُ الحذف، والرسالةُ كاذبة.

لا مسارَ مقيساً يحوّلُ فقدَ ردٍّ إلى الحقل `COMPLETE`. مسارُ `hmac-nonzero` حوّلَ تشويهَ تفويضٍ إلى ذلك الحقل. حقنُ `0x80280400` المستمرُّ يبقى `BLOCKED_FAIL_CLOSED` ولا يعيدُ الأمرَ المرفوض؛ التنظيفُ يحاولُ الحذفَ مرةً ويفشلُ فيُعلِن.

الاختباراتُ المشحونةُ تقيسُ ما تصفُه لحالاتِ WRITTEN والزوائدِ والجردِ والوسيطِ التي أعدتُها. لا تقيسُ HMAC ولا المطابقةَ التامّةَ لطرفٍ لم يكتب، ولا كذبَ رسالةِ إعادةِ المحاولة.

### 5. النقلُ والهويّة
مساراتٌ أوصلتْ أو لم تُوصل:
- وسيطُ Node على المنفذ: اختبارُ الحزمةِ (R2-05 ضمنَ الـ41) يتوقّع رفضاً قبلَ أيِّ بايت. لم أُعِدْ كتابةَ الوسيط؛ اعتمدتُ ذلك المخرجَ مع قياسِ الثنائيِّ المزيّف.
- ربطُ الخادمِ بغيرِ loopback: الاختبارُ المشحونُ يتوقّع `SIMULATOR_LISTENER_NOT_LOOPBACK`. لم أُعِدْه.
- تبدّلُ المالكِ أثناءَ الاتصالِ القائم: اتصالُ TCP بعدَ `accept` لا ينتقلُ إلى مستمعٍ جديد. الفحصُ البعديُّ يغيّرُ الحالةَ إن تغيّرَ المستمعُ بعدَ العودة؛ لا يمنعُ بايتاتٍ أُرسلت. لم أُجْرِ سباقاً زمنيّاً ناجحاً لإبدالِ العمليّةِ وسطَ البروفة (مدّتُها نحو ثانيتين).
- TBS و`/dev/tpm*`: لا `DllImport` في `sim/tpm-ceremony/` سوى ذكرٍ في التعليق وREADME. النقلُ يرفضُ غيرَ `127.0.0.1` و`::1`. لم يُفتح جهاز.
- ثنائيٌّ محلّيٌّ اسمُ عمليّتِه `swtpm` وسطرُ أوامرِه يطابقُ النمط: **استقبلَ أمرَ GetCapability (22 بايتاً)**. الفحصُ يقرأ `comm` و`cmdline` لا `readlink /proc/<pid>/exe`.
- منفذُ التحكّم `0.0.0.0`: البروفةُ انتهتْ بالحقل `COMPLETE`. الفحصُ لا يقرأ `--ctrl`.

ما يثبِتُه فحصُ المالك: عندَ لحظةِ الفحص، مستمعٌ واحدٌ على المنفذ، عنوانُه loopback في `/proc/net/tcp{,6}`، و`comm` = `swtpm`، وargv فيه `socket` و`--tpm2` و`--server type=tcp,port=<P>,bindaddr=127.0.0.1|::1`، وملفُّ PID إن مُرِّر. ما لا يثبِتُه: أنّ الملفَّ التنفيذيَّ هو swtpm النظام، ولا أنّ منفذَ التحكّم loopback، ولا ربطاً تشفيريّاً بالطرف، ولا أنّ البايتاتِ على الاتصالِ القائمِ ذهبتْ إلى تلكَ العمليّةِ إذا تغيّرَ الربطُ داخلَ النواة، ولا سلوكَ `Get-NetTCPConnection` (غيرُ مقيس؛ لا Windows هنا). خصمٌ بنفسِ المستخدمِ يستطيعُ تشغيلَ الثنائيِّ الذي قستُه. هذا مطابقٌ لنصِّ الحدِّ في ADR §12.4، والقياسُ يبيّنُ حدَّه لا أكثر.

### 6. الحدودُ والوثائق
تقولُ الوثائقُ أكثرَ ممّا قِيس في مواضع:
- README: «أيُّ تشويهٍ ⇒ فشلٌ مغلقٌ مسمّى». القياسُ يخالفُه (HMAC، وnonce قصيرٌ سليمُ البنية، وقلبُ بايتِ اسم).
- ADR §12.4 وسجلُّ العمل: «ملكيّتُه مُثبَتة» بمطابقةٍ بايتاً ببايت، وفي الفقرةِ التاليةِ أنّ طرفاً ثالثاً يستطيعُ تعريفَ المطابقِ ولا يُميَّز. الشيفرةُ تنحازُ إلى الجملةِ الأولى وتحذف.
- سجلُّ العمل: «قبلَ إرسالِ كلِّ أمرٍ مُغيّر». `Create` و`PolicySigned` المرفوضُ خارجَ الدفتر (قياس).
- نموذجُ التهديدِ §7 البند 11 يفصلُ المقيسَ على المحاكي عن غيرِ المقيسِ على العتاد، ويذكرُ حدَّ خصمِ المستخدم. هذا الجزءُ صادقٌ بالنسبةِ إلى ما قستُه، مع زيادةِ أنّ منفذَ التحكّمِ غيرُ مذكور.
- «عولجَت كلُّها» في README عن عوائقِ WL-412: العيوبُ الصامتةُ الأصليّةُ لم تُعِدِ الإنتاج، وحدُّ SOL-07 ما زال، وحافةُ الحذفِ بالمطابقةِ التامّةِ قائمة.

قبلَ أيِّ طلبِ إذنٍ بـS1 على الشريحة، القياسُ هنا لا يغني عن: مسارٍ لا يحذفُ فهرساً عندَ فقدِ ردِّ التعريفِ إلا إذا بقيَ التمييزُ ممكناً (وهو ليس كذلك بتفويضٍ فارغ)، وتضييقِ عبارةِ «أيِّ تشويه»، وقياسِ TBS والسعةِ وتفويضِ الهرمِ والرتابةِ على العتاد — وهذه الثلاثةُ الأخيرةُ لا تُثبَتُ بالمحاكي (ADR §12.2). `R3-A-01` و`EXT-6` لم يُمسا.

## النتائج

| المعرّف | الخطورة | الموضع | الوصف | الدليل | التصنيف |
| --- | --- | --- | --- | --- | --- |
| G47-413-1 | متوسطة | `sim/tpm-ceremony/TpmCeremonyCore.cs:1276-1285` ثمّ `1044-1057` | مطابقةُ المنطقةِ العامّةِ بايتاً ببايت تُسمّى `ownership proven` ويُرسَل `NV_UndefineSpace` حتى لو لم تُرسَل جولةُ التعريفِ أصلاً، أو بعدَ إعادةِ تعريفٍ مطابقةٍ بتفويضِ فهرسٍ آخر. يخالفُ جملةَ §12.4 أنّ المطابقةَ لا تُميَّز. الخيارُ الذي لا يحذفُ ويكتفي بالإعلانِ غيرُ مستخدَم. | `plant-same-public.jsonl` و`redefine-after-exec.jsonl`؛ `nv` بعدَهما فارغ | قياسُ محاكٍ |
| G47-413-2 | متوسطة | `TpmCeremonyCore.cs:471-477` | HMAC الردِّ وسماتُ الجلسةِ تُقرأ ولا تُفحص. تشويهٌ بنيويٌّ سليمٌ أنهى البروفةَ بالحقل `COMPLETE`. | `hmac-nonzero.jsonl`؛ [Part 1 rev 01.83 §19.6.3.1](https://trustedcomputinggroup.org/wp-content/uploads/TPM-2.0-1.83-Part-1-Architecture.pdf)؛ [Part 2 r1.38 §10.13.3](https://trustedcomputinggroup.org/wp-content/uploads/TPM-Rev-2.0-Part-2-Structures-01.38.pdf) | قياسُ محاكٍ |
| G47-413-3 | منخفضة | `TpmCeremonyCore.cs:503-543` | المخطّطُ لا يرفضُ SHA-1 في التوقيع، ولا nonce طوله 1، ولا بصمةً قصيرة، ولا 7 بايتاتٍ في `NV_Read`، ولا قلبَ وسمِ التذكرة، ولا قلبَ بايتٍ داخلَ الاسم. بعضُ المستدعينَ يرفضونَ لاحقاً (`ReadCounter`، `SignAHash`) وبعضُهم لا. | `logs/probes/schema.txt` | قياسُ محاكٍ |
| G47-413-4 | منخفضة | `TpmCeremonyCore.cs:467-468` | `parameterSize` بقيمة `0xFFFFFFFF` يرمي `OverflowException` على pwsh و`OutOfMemoryException` على mono، لا رمزَ ردٍّ مسمّى. | `paramsize.ps1` و`schema.txt` | قياسُ محاكٍ |
| G47-413-5 | منخفضة | `TpmCeremonyCore.cs:1318` و`1467-1473` | بعدَ انتهاءِ التنظيف، المصالحةُ تقول إنّ الحذفَ سيُعادُ مرةً ولا إرسالَ ثانٍ. الفهرسُ يبقى معلَناً. | `cleanup-undefine-no-retry.jsonl` و`tpm2_getcap` أظهر `0x189E3AC` | قياسُ محاكٍ |
| G47-413-6 | منخفضة | `TpmCeremonyCore.cs:1143` و`1195` و`703-708` | `Create` و`PolicySigned` المرفوضُ مُغيّرانِ وغيرُ مقيّدينِ في الدفتر. إسقاطُ الردِّ يُغلقُ الفشلَ بلا سطرِ مصالحة. لا بقيّةَ في القياسين. | `drop-create.jsonl` و`drop-refused-policysigned.jsonl` | قياسُ محاكٍ |
| G47-413-7 | متوسطة | `sim/tpm-ceremony/rehearse.ps1:79-108` | فحصُ المالكِ يقبلُ عمليّةً `comm=swtpm` بسطرِ أوامرٍ مطابقٍ ولو كان الملفُّ التنفيذيُّ غيرَ swtpm النظام. وصلتْ 22 بايتاً. الحدُّ موثَّقٌ والقياسُ يحدِّدُه. | `logs/followup/fake-swtpm.json` و`probes/fake-swtpm.log` | قياسُ محاكٍ |
| G47-413-8 | منخفضة | `rehearse.ps1:100-108` | ربطُ منفذِ التحكّمِ بـ`0.0.0.0` لا يُرفض. البروفةُ انتهتْ بالحقل `COMPLETE`. أوامرُ المراسمِ بقيتْ على خادمِ loopback؛ سطحُ التحكّمِ لم يُفحص. | `logs/followup/ctrl-wide.json` و`ss` على 2212 | قياسُ محاكٍ |
| G47-413-9 | ملاحظة | `sim/tpm-ceremony/README.md:40-42`؛ ADR §12.4؛ سجلُّ WL-413 | عباراتُ «أيِّ تشويه» و«كلِّ أمرٍ مُغيّر» و«ملكيّةٍ مُثبَتة» أوسعُ من القياس. فصلُ العتادِ في نموذجِ التهديدِ §7/11 لا يدّعي قياسَ TBS. | هذا التقرير | استنتاج |

## الحدود
- لم أُعِدْ تشغيلَ الشجرةِ عند `42c0050a`؛ حكمُ «كان عيباً هناك» مبنيٌّ على ملفاتِ `evidence/` لا على إعادةِ تنفيذٍ بيدي.
- لم أُسقطْ ردَّ الزيادتينِ السلبيّتينِ الثانيةِ والثالثة، ولا فقدَ ردِّ `CreatePrimary`/`Load`/`StartAuthSession` إلا بما غطّته أوضاعُ الحزمةِ ضمنَ اختباراتِ الـ41 (لم أُعِدْ `load-name-short` و`transport-dead-after-define` خارجَها).
- لم أُعِدْ ملفَّاتِ Python التاريخيّةَ لـgemini (مساراتُ شجرةٍ قديمة). أعدتُ حدَّيِ الترويسةِ والحجمِ وحسابَ البصمةِ الثالث.
- لا Windows، فلا قياسَ لـ`Get-NetTCPConnection` ولا لـTBS ولا لـ`/dev/tpm*`.
- سباقُ تبديلِ المستمعِ أثناءَ الاتصالِ القائمِ لم يُنفَّذ كتجربةِ توقيت؛ الاستنتاجُ من نموذجِ TCP ومن نصِّ الفحصِ البعديّ.
- أُوقفَت المحاكياتُ التي أطلقتُها. `git status --porcelain` في شجرةِ المراجعةِ فارغ.

## الحكم
عوائقُ تلزمُ معالجتُها قبلَ طلبِ إذنِ S1 على العتاد.

التعليل: عيوبُ WL-412 التي كانت تقبلُ رداً تالفاً أو تخفي فهرساً أو جلسةً أو تقبلُ رمزاً عامّاً لم تُعِدِ الإنتاجَ على `dbaf6104`، وحالةُ WRITTEN بعدَ فقدِ ردِّ التعريفِ لم تَعُد تُحذف. العائقُ الباقي في نطاقِ المحاكي هو أنّ مسارَ S1 نفسَه ما زال يحذفُ فهرسَ NV عندَ فقدِ ردِّ `NV_DefineSpace` إذا طابقتِ المنطقةُ العامّةُ بايتاً ببايت، ويسمّي ذلك إثباتَ ملكيّة، وقد قِستُ حذفَ فهرسٍ لم تُرسلْه الجولةُ وحذفَ فهرسٍ أعادَ تعريفَه طرفٌ آخرُ بالمنطقةِ نفسِها. نصُّ §12.4 يقول إنّ هذه المطابقةَ لا تُميَّزُ إلا بحصريّةِ الوصول، والشيفرةُ تفعلُ العكس. عدمُ الحذفِ والإعلانُ خيارٌ في الشيفرةِ لا يتطلّبُ تمييزاً تشفيريّاً. إلى جانبه، تشويهُ HMAC الردِّ لا يوقفُ البروفة (الحقل `status` يصير `COMPLETE`)، وفحصُ مالكِ المقبسِ لا يمنعُ ثنائيّاً محلّياً باسم `swtpm` من استلامِ أمر. هذا ليس حكماً بالجاهزيّة، ولا إغلاقاً لـ`R3-A-01` أو `EXT-6`، ولا إذناً بأيِّ أمرٍ على عتاد.
