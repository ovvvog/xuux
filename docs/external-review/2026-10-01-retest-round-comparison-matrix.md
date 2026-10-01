# مصفوفةُ مقارنةِ الجولةِ — M11.04 ج9 · M11.05 ج3 · M11.06 ج4

**التاريخ:** 2026-10-01 (توقيتُ الرياض)
**الكوميتُ المُراجَعُ:** `5babed1346104486411c141282cdb10486578307`
**الأعضاء:** `gpt_6_1_sol` (OPENAI) و`gemini_3_7_flash` (GOOGLE)
**التقاريرُ الخامّة:**
- `docs/external-review/reports/M11.04-round-9-model-council-report-gpt-6-1-sol.md`
- `docs/external-review/reports/M11.04-round-9-model-council-report-gemini-3-7-flash.md`
- `docs/external-review/reports/M11.05-round-3-model-council-report-gpt-6-1-sol.md`
- `docs/external-review/reports/M11.05-round-3-model-council-report-gemini-3-7-flash.md`
- `docs/external-review/reports/M11.06-round-4-model-council-report-gpt-6-1-sol.md`
- `docs/external-review/reports/M11.06-round-4-model-council-report-gemini-3-7-flash.md`

---

## المجموعُ

| الفئةُ | العددُ |
| --- | --- |
| اتفاقٌ على `closed` | **12** |
| اتفاقٌ على `open` | **2** |
| اختلافٌ (تبقى `open`) | **11** |
| **الإجماليُّ** | **25** |

---

## M11.04 — الجولةُ التاسعةُ (3 نتائج)

| النتيجة | الشدّة | GPT 6.1 Sol | Gemini 3.7 Flash | الحكمُ |
| --- | --- | --- | --- | --- |
| `M11.04-F07` | high | `open` | `open` | **open** — اتفاقٌ على البقاءِ مفتوحةً |
| `R4-K3-01` | high | `open` | `open` | **open** — اتفاقٌ على البقاءِ مفتوحةً |
| `R5-A-05` | low | `open` | `closed` | **open** — اختلافٌ |

**ملاحظة:** `M11.04-F07` و`R4-K3-01` مرتبطتانِ بـ`EXT-6` (مرجعُ حداثةٍ خارجَ القرصِ — قرارُ مالكٍ). كلاهما يبقى `open` بحقِّه لا بتقصيرٍ.

---

## M11.05 — الجولةُ الثالثةُ (9 نتائج)

| النتيجة | الشدّة | GPT 6.1 Sol | Gemini 3.7 Flash | الحكمُ |
| --- | --- | --- | --- | --- |
| `R5-A-06` | low | `open` | `closed` | **open** — اختلافٌ |
| `R5-B-03` | high | `closed` | `closed` | **اتفاقٌ على `closed`** |
| `R5-B-04` | high | `closed` | `closed` | **اتفاقٌ على `closed`** |
| `R5-B-05` | medium | `open` | `closed` | **open** — اختلافٌ |
| `R5-B-06` | high | `closed` | `closed` | **اتفاقٌ على `closed`** |
| `R5-B-07` | high | `closed` | `closed` | **اتفاقٌ على `closed`** |
| `R5-B-08` | high | `closed` | `closed` | **اتفاقٌ على `closed`** |
| `R5-B-09` | high | `closed` | `closed` | **اتفاقٌ على `closed`** |
| `R5-B-10` | medium | `open` | `closed` | **open** — اختلافٌ |

---

## M11.06 — الجولةُ الرابعةُ (13 نتيجة)

| النتيجة | الشدّة | GPT 6.1 Sol | Gemini 3.7 Flash | الحكمُ |
| --- | --- | --- | --- | --- |
| `R6-A-01` | high | `closed` | `closed` | **اتفاقٌ على `closed`** |
| `R6-A-03` | medium | `closed` | `closed` | **اتفاقٌ على `closed`** |
| `R6-A-05` | medium | `open` | `closed` | **open** — اختلافٌ |
| `R6-A-07` | low | `open` | `closed` | **open** — اختلافٌ |
| `R6-A-08` | low | `open` | `closed` | **open** — اختلافٌ |
| `R6-A-09` | low | `open` | `closed` | **open** — اختلافٌ |
| `R6-A-10` | low | `closed` | `closed` | **اتفاقٌ على `closed`** |
| `R6-A-11` | high | `open` | `closed` | **open** — اختلافٌ |
| `R6-A-12` | low | `closed` | `closed` | **اتفاقٌ على `closed`** |
| `R6-A-13` | low | `closed` | `closed` | **اتفاقٌ على `closed`** |
| `R6-B-03` | high | `open` | `closed` | **open** — اختلافٌ |
| `R6-B-04` | low | `closed` | `closed` | **اتفاقٌ على `closed`** |
| `R6-B-05` | low | `open` | `closed` | **open** — اختلافٌ |

---

## أسبابُ الاختلافاتِ (11 نتيجة)

الاختلافاتُ كلُّها في اتجاهٍ واحدٍ: GPT 6.1 Sol حكمَ `open` وGemini 3.7 Flash حكمَ `closed`. أبرزُ أسبابِ GPT 6.1 Sol:

1. **R5-A-05:** `FileRevocationStore` يُبنى ولا يُوصَلُ بسلطةِ تصديقٍ حيّةٍ في الإنتاجِ — الاختبارُ يُورِّدُ الوصلةَ بنفسِهِ.
2. **R5-A-06:** أثرُ خطِّ الأساسِ متقادمٌ (225 ملفّاً مُعلَناً مقابل 226 على القرصِ).
3. **R5-B-05:** خارجَ الإنتاجِ، المُرسِلُ يستطيعُ إرسالَ `sensitive` كـ`public` — الحارسُ يُطبَّقُ في الإنتاجِ وحدَهُ.
4. **R5-B-10:** `requireIdentityGate: false` يَعملُ خارجَ الإنتاجِ — العقدُ لا يُقيِّدُ النتيجةَ بالإنتاجِ.
5. **R6-A-05:** snapshot/restore يدويٌّ لا آليٌّ — الوصلةُ الرابعةُ (المقترحاتُ الدستوريّةُ) غيرُ مُستعادَةٍ آليّاً.
6. **R6-A-07:** فحصُ شكلِ الملخصِ لا يُوثِّقُ توقيعَ الأمرِ السياديِّ في المحرّكِ — التعويضُ في نقطةِ الإنفاذِ لا في المحرّكِ.
7. **R6-A-08:** `stop()` و`resume()` يَعملانِ بلا فاعلٍ مُوثَّقٍ — التسجيلُ فقط لا المنعُ.
8. **R6-A-09:** الجدولةُ الآليّةُ غائبةٌ — الحدُّ المُعلَنُ يَتحقَّقُ من الرقابةِ لا من الجدولةِ.
9. **R6-A-11:** `purge()` المُصدَّرُ في `src/persistence/retention.mjs` يَعملُ بلا سلطةٍ — حارسُ الاستيرادِ الثابتِ لا حارسُ وقتِ التشغيلِ.
10. **R6-B-03:** وصلةُ `DATABASE_URL` العاديّةُ تَرفعُ `ENCRYPTION_TRANSPORT_INSECURE` — الإصلاحُ في `createPool` لا يُغيِّرُ سلوكَ الوصلةِ العاديّةِ.
11. **R6-B-05:** طفرةُ نفيِ المُنتِجِ في `budget-exceeded` تَمرُّ — الحارسُ لا يَكشفُ نفيَ المُنتِجِ وحدَهُ.
