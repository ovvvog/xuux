# حزمةُ إطلاقِ جولةِ مجلسِ النماذجِ المستقلِّ — M11.04 ج11 · M11.06 ج6

**التاريخ:** 2026-10-08 (توقيتُ الرياض)
**الكوميتُ المُراجَعُ:** `b1c6e4aa7c7539e833a56456542491c72f487401` — رأسُ `main`
**CI:** أخضر (تشغيلة `37601625227` — نجاح)
**الأعضاء:** `gpt_6_1_sol` (OPENAI) و`claude_opus_5_5` (ANTHROPIC) — مزوِّدانِ مختلفانِ

---

## التعليماتُ لكلِّ عضوٍ

أنتَ عضوٌ مستقلٌّ في مجلسِ نماذجَ يُراجعُ إصلاحاتٍ مُدمَجةً في مستودعِ `xuux`. مهمتُكَ:

1. **اقرأْ** المستودعَ من `/home/user/workspace/xuux` على الكوميتِ `b1c6e4aa`.
2. **لكلِّ نتيجةٍ في النطاقِ أدناه:** اقرأْ مسارَ الإعادةِ في `config/external-review.yaml`، ثمَّ تحقَّقْ من الإصلاحِ في الشفرةِ، ثمَّ شغِّلْ مسارَ الإعادةِ واقرأْ رمزَ الخروجِ.
3. **احكمْ** لكلِّ نتيجةٍ: `closed` (الإصلاحُ يَسُدُّ المسارَ) أو `open` (المسارُ ما زالَ نافذاً). **مفرداتُ الحكمِ `closed` و`open` وحدَهما.**
4. **اكتبْ تقريراً خامّاً** في المسارِ المُحدَّدِ يحوي: مُعرِّفَ النموذجِ ومزوِّدَه، زمنَ التشغيلِ، الكوميتَ المُراجَعَ، بيئةَ التشغيلِ، تصريحَ استقلالٍ، سجلَّ أدلّةٍ بالأوامرِ ورموزِ الخروجِ، جدولَ أحكامٍ، نتائجَ جديدةً (إن وُجِدَت)، قسمَ حدودٍ.

### ما لا تفعلهُ

- **لا تُؤلِّفُ نتائجَ غيركَ ولا تقرأُ تقريرَه.**
- **لا تُعدِّلُ `config/external-review.yaml`** ولا تُغيِّرُ حالةَ نتيجةٍ.
- **لا ترفعُ نسبةً ولا تُغلِقُ خطوةً.**
- **لا تستعملُ `verified` أو `approved` أو `secure` أو `ready`.**

### البيئةُ

- Node على `.nvmrc`، و`npm ci` و`npm run build` منفَّذانِ مسبقاً.
- الاختباراتُ بـ`env -u DATABASE_URL` — ما احتاجَ قاعدةً يُعلَنُ تخطّيه حدّاً.
- لا SoftHSM ولا TPM ولا Docker — وكلُّ حكمٍ يَقومُ على مسارٍ لم يُشغَّلْ يُعلَنُ في قسمِ الحدودِ.
- المستودعُ في `/home/user/workspace/xuux`.

### التغييراتُ منذُ الجولةِ السابقةِ (WL-337…WL-348، كوميتُ `b1c6e4aa`)

أُدمجَت منذُ الجولةِ السابقةِ (`fc6dc63`) إصلاحاتٌ جوهريةٌ:

| المُدخلةُ | الدَينُ | الإصلاحُ |
| --- | --- | --- |
| `WL-337` | `LIVE-41` | عدّادٌ رتيبٌ في معرّفِ قصدِ الجذرِ لترتيبِ الإيداعِ داخلَ الملّي ثانيةِ |
| `WL-338` | `DOC-29` | `R8` يقرأُ حالةَ §4.3 من `config/external-review.yaml` |
| `WL-340` | `DOC-30` | `parseDebtRows` يحكمُ بالإغلاقِ من خليّةِ المعرِّفِ |
| `WL-341`/`WL-342` | `DOC-31` | مصالحةُ ذاكرةِ المشروعِ |
| `WL-345` | — | `legislature` ينادي `crown.commandAsync` |
| `WL-346` | — | `judiciary`/`reports`/`federation` تنادي `crown.commandAsync` |
| `WL-347` | — | الديوانُ الملكيُّ يقبلُ الأمرَ بـ`crown.commandAsync` |
| `WL-348` | — | الديوانُ الملكيُّ ومصادقةُ الملكِ القويّةُ في التركيبِ الإنتاجيّ: إيقافٌ واستئنافٌ ونقضٌ بأمرٍ موقَّعٍ وجلسةٍ قويّةٍ |

---

## النطاقُ — 21 نتيجةً `open` من ارتباطَينِ

### M11.04 (8 نتائج)

| المعرِّف | الشدّة | مسارُ الإعادةِ | الملفّاتُ المتأثِّرةُ |
| --- | --- | --- | --- |
| `UF-01` | high | `S10`/`S4b`/`S13` — إقلاعٌ إنتاجيٌّ يُقبَلُ بعدَ خفضِ `anchoredCount` وحذفِ السجلِّ | `src/root-of-trust/production-runtime.mts`, `src/root-of-trust/state-manifest.mts` |
| `UF-03` | high | `S10`/`S4b`/`S13` — حالةُ الإيقافِ تعودُ `running/epoch=0` بمحوِ ملفّاتِها | `src/root-of-trust/halt-switch.mts`, `src/root-of-trust/state-manifest.mts` |
| `UF-07` | medium | `S10`/`S4b`/`S13` — أمرٌ مُثبَّتٌ يُقبَلُ مرّةً ثانيةً بعدَ محوِ الدفترِ | `src/root-of-trust/command-ledger.mts`, `src/root-of-trust/state-manifest.mts` |
| `M11.04-F07` | high | يتبعُ إعادةَ إنتاجِ `UF-07` و`UF-03` — استرجاعُ لقطةٍ كاملةٍ متّسقةٍ | `src/root-of-trust/command-ledger.mts`, `src/root-of-trust/halt-switch.mts` |
| `R3-A-01` | high | `P10` — مصادقةٌ بديلةٌ؛ وتحليلُ `state-manifest.mts` | `src/root-of-trust/state-manifest.mts` |
| `M11.04-F05` | high | `npm run hsm:verify:f05` (خرجُ 0)؛ و`P13` | `src/root-of-trust/persistent-log.mts`, `src/root-of-trust/production-runtime.mts` |
| `R4-K3-01` | high | `S10`/`S4b`/`S13` — استبدالُ البيانِ بلقطةٍ أقدمَ | `src/root-of-trust/state-manifest.mts` |
| `R5-A-05` | low | قراءةُ `production-runtime.mts` — `FileRevocationStore` بلا مستهلكٍ حيٍّ | `src/root-of-trust/production-runtime.mts` |

### M11.06 (13 نتيجة)

| المعرِّف | الشدّة | مسارُ الإعادةِ | الملفّاتُ المتأثِّرةُ |
| --- | --- | --- | --- |
| `R6-A-01` | high | `node probes/probe-retention-sweeper-identity.mjs; echo $?` ⇒ `3` | `src/data/retention-cycle.mjs`, `config/royal-authority.yaml` |
| `R6-A-03` | medium | `node probes/probe-capabilities-ignored.mjs` | `src/policy/engine.mjs`, `docs/POLICY_MODEL.md` |
| `R6-A-05` | medium | قراءةُ `quarantine.mjs` snapshot/restore + `production-runtime.mts` | `src/governance/quarantine.mjs`, `src/root-of-trust/production-runtime.mts` |
| `R6-A-07` | low | `sed -n 300,310p src/policy/engine.mjs` | `src/policy/engine.mjs`, `src/core/execution-kernel.mjs` |
| `R6-A-08` | low | قراءةُ `ExecutionKernel.stop()` و`resume()` | `src/core/execution-kernel.mjs` |
| `R6-A-09` | low | قراءةُ `docs/RETENTION.md` و`config/retention.yaml` | `docs/RETENTION.md`, `config/retention.yaml` |
| `R6-A-10` | low | `git ls-tree -r b1c6e4aa --name-only \| grep M11.06` | `docs/external-review/M11.06-round-*-plan.md` |
| `R6-A-11` | high | `node probes/probe-raw-purge-no-authority.mjs` | `scripts/retention.mjs`, `src/persistence/retention.mjs` |
| `R6-A-12` | low | `node --test tests/agents/` | `tests/agents/` |
| `R6-A-13` | low | `node --test tests/docs/agent-containment-claims.test.mjs` | `tests/docs/agent-containment-claims.test.mjs` |
| `R6-B-03` | high | `export DATABASE_URL=...` ثمَّ `npm run validate` | `src/data/encryption.mjs`, `scripts/guard-encryption.mjs` |
| `R6-B-04` | low | `ls tests/agents` | `tests/agents/` |
| `R6-B-05` | low | `node --test tests/docs/agent-containment-claims.test.mjs` | `tests/docs/agent-containment-claims.test.mjs` |

---

## مسارُ التقريرِ الخامِّ

احفظْ تقريرَكَ في:
- `docs/external-review/reports/M11.04-round-11-model-council-report-<model-id>.md`
- `docs/external-review/reports/M11.06-round-6-model-council-report-<model-id>.md`

استبدلْ `<model-id>` بمعرِّفِ نموذجِكَ (مثلَ `gpt-6-1-sol` أو `claude-opus-5-5`).

## قالبُ التقريرِ الخامِّ

```markdown
# تقريرُ مجلسِ النماذجِ — <اسمُ النموذجِ>

**المُعرِّفُ:** <model-id>
**المزوِّدُ:** <provider>
**زمنُ التشغيلِ:** <ISO timestamp>
**الكوميتُ المُراجَعُ:** b1c6e4aa
**بيئةُ التشغيلِ:** <وصفٌ>

## تصريحُ استقلالٍ

أُقرُّ بأنّي أجريتُ هذه المراجعةَ بشكلٍ مستقلٍّ، ولم أقرأْ تقريرَ أيِّ عضوٍ آخرَ، ولم أتلقَّ نتائجَه.

## سجلُّ الأدلّةِ

لكلِّ نتيجةٍ: الأمرُ الذي شُغِّلَ ورمزُ خروجِهِ وما طبعَهُ.

## جدولُ الأحكامِ

| المعرِّفُ | الحكمُ | الدليلُ |
| --- | --- | --- |
| <id> | closed/open | <أمرٌ ورمزُ خروجٍ> |

## نتائجُ جديدةٌ (إن وُجِدَت)

## حدودٌ
```
