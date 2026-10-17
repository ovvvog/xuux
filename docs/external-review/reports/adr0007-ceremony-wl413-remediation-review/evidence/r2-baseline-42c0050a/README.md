# أدلّةُ الدفعةِ الثانيةِ من WL-413 — إعادةُ فحصٍ مستقلٍّ لكوميتِ الإصلاحِ الأوّل `42c0050a`

هذه مخرجاتُ تشغيلٍ فعليٍّ على `swtpm 0.10.1` (libtpms، loopback) في بيئةِ المنفِّذِ (Ubuntu 26.04، ‏PowerShell 7.4.6، ‏Mono `mcs` 6.14.1)،
أُنتِجَت **قبلَ** كتابةِ إصلاحاتِ الدفعةِ الثانية. لم تُحرَّرْ يدويًّا. لا عتادَ، ولا TBS، ولا `/dev/tpm*`.

## 1) مسابرُ `gpt_6_1_sol` الأصليّةُ نفسُها، أُعيدَ تشغيلُها بيدِ المنفِّذِ

المصدر: `../../../adr0007-ceremony-rehearsal-review/probes/gpt_6_1_sol/IndependentProbe.cs` (بلا تعديلٍ على خطِّ الأساس).

| المسبار | على `1ca1668e` (خطُّ أساسِ WL-412) | على `42c0050a` (إصلاحُ الدفعةِ الأولى) |
| --- | --- | --- |
| `invalid-tag` | 75 خطوةً، بلا فشلٍ، 50 ردًّا مشوّهًا قُبِل | `FAILED_CLOSED` — `RESPONSE_TAG_MISMATCH` في خطوةِ الهويّة |
| `missing-response-auth` | 75 خطوةً، بلا فشلٍ، 25 ردًّا مشوّهًا قُبِل | `FAILED_CLOSED` — `OUTCOME_UNKNOWN … RESPONSE_AUTH_AREA_MALFORMED`؛ **لكنّ** `cleanupLeftovers` تعلنُ الفهرسَ باقيًا والمصالحةُ تثبتُ غيابَه (تناقضٌ ⇒ R2-04) |
| `define-response-loss` | فهرسٌ `0x018fc0ab` باقٍ و`cleanupLeftovers=[]` | `executed; ownership proven` ثمّ حُذِف؛ `nvAfter=[]` |
| `flush-refusal` | الجلسةُ `0x03000000` باقيةٌ و`cleanupLeftovers=[]` | الرفضُ الأوّلُ معلَنٌ والتحريرُ في التنظيفِ نجح؛ `sessionsAfter=[]` |
| `unexpected-negative` | `0x101` قُبِلَ رفضًا متوقَّعًا | `NEGATIVE_WRONG_RC expected=0x000005db got=0x00000101` |

على `42c0050a` تغيّرَ توقيعُ `Resp.Parse` فكُيِّفَت أربعُ نداءاتٍ في المسبارِ وحدَها (والمنفذُ 2341→2351) — الفرقُ كاملًا في
`gpt_6_1_sol-probes-at-42c0050a/probe-adaptation.diff`. ‏خروجُ المسبارِ 1 في `define-response-loss` على `42c0050a` متوقَّعٌ: استعادتُه
المستقلّةُ لم تجدْ الفهرسَ لأنّ الأداةَ حذفَته بعدَ إثباتِ الملكيّة.

## 2) عيوبٌ جديدةٌ على `42c0050a` (لم تَرِدْ في تقاريرِ WL-412)

المسبار: `R2Probe.cs` (يُترجَمُ مع `sim/tpm-ceremony/TpmCeremonyCore.cs` عند `42c0050a`):

```
mcs -langversion:5 -out:R2.exe <tree>/sim/tpm-ceremony/TpmCeremonyCore.cs R2Probe.cs
mono R2.exe <mode> <port>
```

| المعرّف | المسبار ومخرجُه | المشاهَدُ على `42c0050a` | الأثر |
| --- | --- | --- | --- |
| R2-01 | `written-before-reconcile.at-42c0050a.jsonl` | طرفٌ آخرُ كتبَ الفهرسَ بعدَ ضياعِ ردِّ تعريفِه (`rc=0` للزيادة) ⇒ `nv-define …: executed; ownership proven by publicArea match` ثمّ **حُذِف**؛ `cleanupLeftovers=[]` | حذفُ كائنٍ لم تُثبَتْ ملكيّتُه (المقارنةُ كانت تُسقِطُ بتَّ WRITTEN) |
| R2-02 | `neg-increment-loss.at-42c0050a.jsonl` | ضياعُ ردِّ `s2v:NV_Increment(password-auth)` ⇒ `reconciliation=[]` | أثرُ أمرٍ مُغيِّرٍ مجهولٌ ولا يذكرُه التقرير |
| R2-03 | `trailing-params.at-42c0050a.jsonl` | 8 ردودِ `NV_ReadPublic` ببايتاتٍ زائدةٍ (الحجمُ الكلّيُّ متّسق) ⇒ `status=COMPLETE`، 78 خطوة | ردٌّ مشوّهُ البنيةِ الداخليّةِ يُقبَلُ وتستمرُّ المراسم |
| R2-04 | `../../../adr0007-ceremony-rehearsal-review/…` + `gpt_6_1_sol-probes-at-42c0050a/missing-response-auth.jsonl` | بقيّةٌ معلَنةٌ لفهرسٍ ثبتَ غيابُه؛ ولا جردَ نهائيًّا يكونُ مرجعًا للحالةِ الفعليّة | التقريرُ لا يُطابِقُ الحالةَ؛ ولا دليلَ على حالةِ النقلِ عندَ الانتهاء |
| R2-05 | `proxy.mjs` + `via-proxy-nopid.json` + `via-proxy-pid.json` + `proxy.log` | وسيطُ Node على `127.0.0.1:2391` يمرّرُ إلى swtpm ⇒ `COMPLETE` بلا `-SimPidFile`، **و`COMPLETE` مع `-SimPidFile` لـswtpm الحقيقيّ**؛ الوسيطُ مرّرَ 28 ثمّ 56 أمرًا | الأوامرُ تذهبُ إلى عمليةٍ ليست المحاكي (يمكنُها توجيهُها إلى أيِّ نقل)؛ فحصُ PID كان يتحقّقُ من اسمِ عمليّةٍ لا من مالكِ المنفذ |

## 3) اختباراتُ الرجوعِ الجديدةُ على الشيفرةِ القديمة

`../r2-regression/new-tests-against-42c0050a.tap`: ‏`tests/sim/tpm-ceremony-wl413-r2.test.mjs` مع أداةِ الحقنِ الجديدةِ فوقَ النواةِ والمشغِّلِ
عندَ `42c0050a` ⇒ **11 اختبارًا، 0 نجاحٌ، 11 إخفاقًا** — والأسبابُ الجوهريّةُ ظاهرةٌ في السجلّ (`ownership proven`، و`COMPLETE`
بدلَ `FAILED_CLOSED`، والخروجُ `0` عبرَ الوسيط). بعدَ الإصلاحِ: 11/11 (السجلُّ في `../r2-regression/`).
