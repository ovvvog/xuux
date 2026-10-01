# حزمةُ إطلاقِ جولةِ إعادةِ الاختبارِ — M11.04 ج9 · M11.05 ج3 · M11.06 ج4

**التاريخ:** 2026-10-01 (توقيتُ الرياض)
**الكوميتُ المُراجَعُ:** `5babed1346104486411c141282cdb10486578307`
**رأسُ `main`:** CI أخضر (تشغيلة `36819651646` — نجاح)
**الأعضاء:** `gpt_6_1_sol` (OPENAI) و`gemini_3_7_flash` (GOOGLE)

---

## التعليماتُ لكلِّ عضوٍ

أنتَ عضوٌ مستقلٌّ في مجلسِ نماذجَ يُراجعُ إصلاحاتٍ مُدمَجةً في مستودعِ `xuux`. مهمتُكَ:

1. **استنسخْ** المستودعَ من `/home/user/workspace/xuux` (أو اقرأْهُ مباشرةً) على الكوميتِ `5babed13`.
2. **لكلِّ نتيجةٍ في النطاقِ أدناه:** اقرأْ مسارَ الإعادةِ في `config/external-review.yaml`، ثمَّ تحقَّقْ من الإصلاحِ في الشفرةِ، ثمَّ شغِّلْ مسارَ الإعادةِ واقرأْ رمزَ الخروجِ.
3. **احكمْ** لكلِّ نتيجةٍ: `closed` (الإصلاحُ يَسُدُّ المسارَ) أو `open` (المسارُ ما زالَ نافذاً). **مفرداتُ الحكمِ `closed` و`open` وحدَهما.**
4. **اكتبْ تقريراً خامّاً** في المسارِ المُحدَّدِ يحوي: مُعرِّفَ النموذجِ ومزوِّدَه، زمنَ التشغيلِ، الكوميتَ المُراجَعَ، بيئةَ التشغيلِ، تصريحَ استقلالٍ، سجلَّ أدلّةٍ بالأوامرِ ورموزِ الخروجِ، جدولَ أحكامٍ، نتائجَ جديدةً (إن وُجِدَت)، قسمَ حدودٍ.

### ما لا تفعلهُ

- **لا تُؤلِّفُ نتائجَ غيركَ ولا تقرأُ تقريرَه.**
- **لا تُعدِّلُ `config/external-review.yaml`** ولا تُغيِّرُ حالةَ نتيجةٍ.
- **لا ترفعُ نسبةً ولا تُغلِقُ خطوةً.**
- **لا تستعملُ `verified` أو `approved` أو `secure` أو `ready`.**

### البيئةُ

- Node على `.nvmrc`، و`npm ci` ثمَّ `npm run build` قبلَ أيِّ قياسٍ.
- الاختباراتُ بـ`env -u DATABASE_URL` — ما احتاجَ قاعدةً يُعلَنُ تخطّيه حدّاً.
- لا SoftHSM ولا TPM ولا Docker — وكلُّ حكمٍ يَقومُ على مسارٍ لم يُشغَّلْ يُعلَنُ في قسمِ الحدودِ.

---

## النطاقُ — 25 نتيجةً `open` من 3 ارتباطاتٍ

### M11.04 (3 نتائج)

| المعرِّف | الشدّة | مسارُ الإعادةِ | الملفّاتُ المتأثِّرةُ |
| --- | --- | --- | --- |
| `M11.04-F07` | high | يتبعُ إعادةَ إنتاجِ `UF-07` و`UF-03` | `src/root-of-trust/command-ledger.mts`, `src/root-of-trust/halt-switch.mts` |
| `R4-K3-01` | high | `S10`/`S4b`/`S13` — خرجُ 0 وحالةٌ منجَزةٌ | `src/root-of-trust/state-manifest.mts` |
| `R5-A-05` | low | قراءةُ `production-runtime.mts` — `FileRevocationStore` موصولٌ بسلطةِ التصديقِ | `src/root-of-trust/production-runtime.mts` |

### M11.05 (9 نتائج)

| المعرِّف | الشدّة | مسارُ الإعادةِ | الملفّاتُ المتأثِّرةُ |
| --- | --- | --- | --- |
| `R5-A-06` | low | `env -u DATABASE_URL npm run validate` ⇒ تفاوتُ خطِّ أساسٍ | `skip-baseline.json` |
| `R5-B-03` | high | `new KingAuthenticator` بسرِّ عاملٍ، `authenticate` مرّتَين | `src/authn/king-auth.mjs` |
| `R5-B-04` | high | `TelegramBotChannel.send(...)` بلا `EgressGate` | `src/notifications/channels/telegram-bot.mjs` |
| `R5-B-05` | medium | `sensitive` يُعلَنُ `public` | `src/egress/egress-gate.mjs` |
| `R5-B-06` | high | sha256 يفتحُ إذناً سياديّاً | `src/policy/engine.mjs`, `src/policy/enforcement-point.mjs` |
| `R5-B-07` | high | `HaltSwitch.halt('probe')` بلا أمرٍ ملكيٍّ | `src/root-of-trust/halt-switch.mts` |
| `R5-B-08` | high | وكيلٌ محجورٌ يبقى فاعلَ تفويض | `src/policy/enforcement-point.mjs` |
| `R5-B-09` | high | وكيلٌ بلا قدراتٍ يُؤذَنُ بالكتابة | `src/policy/engine.mjs`, `config/policies.yaml` |
| `R5-B-10` | medium | `requireIdentityGate: false` يثقُ بوصفِ الفاعل | `src/core/composition-root.mjs`, `src/policy/enforcement-point.mjs` |

### M11.06 (13 نتيجة)

| المعرِّف | الشدّة | مسارُ الإعادةِ | الملفّاتُ المتأثِّرةُ |
| --- | --- | --- | --- |
| `R6-A-01` | high | `node probes/probe-retention-sweeper-identity.mjs; echo $?` ⇒ `3` | `src/data/retention-cycle.mjs`, `config/royal-authority.yaml` |
| `R6-A-03` | medium | `node probes/probe-capabilities-ignored.mjs` | `src/policy/engine.mjs` |
| `R6-A-05` | medium | قراءةُ snapshot/restore للحجر والميزانية | `src/governance/quarantine.mjs` |
| `R6-A-07` | low | `sed -n 300,310p src/policy/engine.mjs` | `src/policy/engine.mjs` |
| `R6-A-08` | low | قراءةُ `ExecutionKernel.stop()` و`resume()` | `src/core/execution-kernel.mjs` |
| `R6-A-09` | low | قراءةُ `docs/RETENTION.md` و`config/retention.yaml` | `docs/RETENTION.md`, `config/retention.yaml` |
| `R6-A-10` | low | `git ls-tree -r 5babed13 --name-only \| grep M11.06` | `docs/external-review/M11.06-round-*-plan.md` |
| `R6-A-11` | high | `node probes/probe-raw-purge-no-authority.mjs` | `scripts/retention.mjs`, `src/persistence/retention.mjs` |
| `R6-A-12` | low | `node --test tests/agents/` | `tests/agents/` |
| `R6-A-13` | low | `node --test tests/docs/agent-containment-claims.test.mjs` | `tests/docs/agent-containment-claims.test.mjs` |
| `R6-B-03` | high | `export DATABASE_URL=...` ثمَّ `npm run validate` | `src/data/encryption.mjs`, `scripts/guard-encryption.mjs` |
| `R6-B-04` | low | `ls tests/agents` | `tests/agents/` |
| `R6-B-05` | low | `node --test tests/docs/agent-containment-claims.test.mjs` | `tests/docs/agent-containment-claims.test.mjs` |

---

## حزمةُ الأدلّةِ المرجعيّةُ

التفاصيلُ الكاملةُ (الكوميتُ المُصلِحُ، الملفُّ، السطرُ، آليّةُ المنعِ) في:
`docs/external-review/evidence-packages/2026-09-30-council-evidence-package.md`

الخططُ التفصيليّةُ لكلِّ ارتباطٍ:
- `docs/external-review/M11.04-round-9-plan.md`
- `docs/external-review/M11.05-round-3-plan.md`
- `docs/external-review/M11.06-round-4-plan.md`
