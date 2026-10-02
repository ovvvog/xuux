# الحالةُ الحاليّةُ المقيسةُ — مصدرُ الحقيقةِ الواحدُ لوصفِ المستودعِ

> **آخرُ تحقُّقٍ:** `main@23d07212` (‏2026-10-02، بعدَ دمجِ `#211` و`#212`) — CI على `main` التشغيلةُ
> [`37044233977`](https://github.com/ovvvog/xuux/actions/runs/37044233977) ناجحةٌ.
> كُتِبَت هذه الوثيقةُ في `WL-301` من الكودِ والاختباراتِ وسجلِّ CI لا من تقاريرَ سابقةٍ، وحُدِّثَت
> لقطتُها الزمنيّةُ وحالُ الحمايةِ والأمرُ الملكيُّ في `WL-302`، ثمّ اللقطةُ وحدُّ السلطةِ الملكيّةِ عندَ نقطةِ
> الإنفاذِ (‏`R6-A-07`) في `WL-303` وحدَها.
> **ما يتغيّرُ بكلِّ دفعةٍ لا يُنسَخُ هنا رقماً حاكماً** (‏`DOC-7`): نسبةُ الإنجازِ من
> `version.json`، والمفتوحُ من [سجلِّ الديونِ](roadmap/06-debt-register.md)، وعددُ الاختباراتِ
> من مخرَجِ `npm test`. والأرقامُ أدناه **لقطةٌ مؤرَّخةٌ بالكوميتِ أعلاه** لا عدّادٌ حيٌّ.

## 1 — مفرداتُ الحالةِ (تُستعمَلُ بهذا المعنى وحدَه)

| اللفظُ | معناه في هذا المستودعِ |
| --- | --- |
| **منفَّذٌ** | شفرةٌ في `src/` أو `scripts/` تعملُ، لا واجهةٌ ولا صنفٌ فارغٌ |
| **موصولٌ** | يُستدعى من مسارٍ حقيقيٍّ (‏نقطةِ دخولٍ أو سلسلةِ إنفاذٍ)، لا من الاختباراتِ وحدَها |
| **مُختبَرٌ في CI** | له اختبارٌ يُشغَّلُ **ولا يُتخطّى** على `ubuntu-latest` في `ci.yml` |
| **مُختبَرٌ محلّيّاً فقط** | اختبارُه يُتخطّى في CI بسببٍ مُعلَنٍ (‏TPM أو HSM أو `userns`) ويُشغَّلُ على جهازِ المالكِ |
| **قادرٌ إنتاجيّاً** | يُقلِعُ في `NODE_ENV=production` بمكوّناتِه الحقيقيّةِ — **لا شيءَ في المستودعِ بلغَ هذا اليومَ** (§3) |
| **مُعتمَدٌ** | حكمُ مجلسِ المراجعةِ أو قرارُ المالكِ — **لا يُطلِقُه المنفِّذُ ولا CI أخضرُ** |

## 2 — ما هو المشروعُ اليومَ

نواةٌ سياديّةٌ مكتوبةٌ بـ Node.js 20 (‏`src/root-of-trust/*.mts` بـ TypeScript تُصرَّفُ في
الموضعِ، والباقي `.mjs` بفحصِ أنواعٍ `checkJs`)، تُجرِّبُ نموذجَ «دولةٍ رقميّةٍ» يُقيَّدُ فيها كلُّ
قرارٍ مؤثِّرٍ ببوابةٍ واحدةٍ (‏التاج) تخضعُ لمفتاحِ إنسانٍ واحدٍ (‏الملك) في وحدةِ أمانٍ، مع سجلٍّ
مختومٍ ومفتاحِ إيقافٍ. وفيه عشراتُ الوحداتِ الفرعيّةِ (‏سياساتٌ، تشريعٌ، قضاءٌ، فدراليّةٌ، استدلالٌ،
نقلٌ، جدولةٌ، تعافٍ، فوضى، طوارئُ…) لكلٍّ منها عقدُ `config/*.yaml` بمخطَّطٍ صارمٍ وحاجزُ `guard:*`
ووثيقةٌ في `docs/`.

**الحالُ في سطرٍ واحدٍ:** مكتبةُ مكوّناتٍ مُختبَرةٌ ونقطةُ دخولٍ إنتاجيّةٌ موصولةٌ **تَرفضُ الإقلاعَ
مغلقةً عمداً** لأنّ مصدرَ الحداثةِ الإنتاجيَّ (‏`R3-A-01` / `EXT-6`) غيرُ موجودٍ — فلا نشرَ
إنتاجيَّ قائمٌ ولا يُدّعى.

## 3 — المسارُ الإنتاجيُّ كما هو في الكودِ

المُشغِّلُ: `scripts/production-entry.mjs` ← `createProductionSystem()` في
`src/production/entrypoint.mjs`. والترتيبُ المقروءُ من الكودِ:

```text
production-entry.mjs
  ├─ يرفضُ ما لم يكن NODE_ENV/STATE_ENV = production
  ├─ يرفضُ ما لم يُعلَن XUUX_FRESHNESS_BACKEND مدعوماً   ← المجموعةُ المدعومةُ فارغةٌ: يتوقّفُ هنا اليومَ
  └─ createProductionSystem(env, { root, freshnessSocket, clock })
       1. isProductionRuntime(env)                         — وإلّا PRODUCTION_ENTRYPOINT_NOT_PRODUCTION_ENV
       2. freshnessSocket ليس null ولا testFixture          — وإلّا PRODUCTION_ENTRYPOINT_FRESHNESS_SOCKET_NULL
       3. createProductionRootOfTrust()                    — src/root-of-trust/production-runtime.mts
            · HSM عبرَ PKCS#11 إلزاماً (Pkcs11HsmProvider)، ولا سقوطَ إلى مفتاحٍ برمجيٍّ
            · بيانُ حالةٍ مختومٌ + فحصُ سلسلةِ التثبيتاتِ عندَ الإقلاعِ (state-manifest / anchor)
            · سجلُّ أحداثٍ دائمٌ مختومٌ بـ AES-GCM من التوكنِ (PersistentEventLog، ملفٌّ بـ fsync)
            · دفترُ أوامرَ موقَّعٌ (CommandLedger) ومخزنُ سحبٍ دائمٌ (FileRevocationStore)
            · مفتاحُ إيقافٍ (HaltSwitch) بمُتحقِّقِ أوامرَ ملكيّةٍ مشتقٍّ من مفتاحِ HSM العامِّ
       4. هويّةُ الملكِ من المفتاحِ العامِّ وحدَه (kingIdentityFromPublicKey)
       5. CertificateAuthority بمخزنِ السحبِ الدائمِ
       6. AttestedClock — نصابُ مصادرِ Roughtime موقَّعةٍ (config/time.yaml)، ولا سقوطَ إلى Date.now()
       7. composeEnforcementChain — هويّةٌ ← حَجرٌ ← سياسةٌ ← حدُّ السلطةِ الملكيّةِ ← تذكرةٌ
            · royalCommandVerifier = createRoyalAuthorization (src/root-of-trust/royal-authorization.mts)
              مفتاحُ الملكِ في التوكنِ ⇒ ربطُ المعرّفِ والملخّصِ والفعلِ والموردِ ⇒ العتبةُ السياديّةُ
              ⇒ الحداثةُ بالساعةِ الموثوقةِ ⇒ منعُ الإعادةِ بالدفترِ الدائمِ ⇒ أثرٌ مختومٌ (WL-303)
            · السجلُّ عبرَ sealedAudit: لا تذكرةَ قبلَ أن يُختَمَ قيدُ قرارِها
       8. CrownGateway — يلزمُه دفترُ الأوامرِ ومفتاحُ الإيقافِ والساعةُ الموثوقةُ
       9. ExecutionKernel — بوابةُ التاجِ + نقطةُ الإنفاذِ + SafeMode + السجلُّ المختومُ (تدقيقٌ)
```

فالتدفّقُ الفعليُّ: **Production Entry → Freshness gate → Production Root of Trust (HSM ·
manifest · sealed log · ledger · halt) → King identity (HSM public key) → Enforcement chain
(identity · policy · quarantine) → Attested time → Crown gateway → Execution kernel → Audit
(sealed persistent log)**. والحداثةُ تُفحَصُ **قبلَ** جذرِ الثقةِ لا بعدَه، والوقتُ المُبرهَنُ
**بعدَ** سلسلةِ الإنفاذِ وقبلَ بوابةِ التاجِ.

**حدودٌ مقروءةٌ في الكودِ نفسِه (‏لا تُدَّعى قدرةً):**

- `SUPPORTED_FRESHNESS_BACKENDS` في `scripts/production-entry.mjs` مجموعةٌ فارغةٌ، و`freshnessSocket`
  يُمرَّرُ `null` — **فالمُشغِّلُ الإنتاجيُّ لا يُقلِعُ في أيِّ بيئةٍ اليومَ**. والمقبسُ الوحيدُ المنفَّذُ
  `InMemoryFreshnessSocket` موسومٌ `testFixture` ومرفوضٌ في الإنتاجِ.
- إصدارُ الشهاداتِ في الإنتاجِ عبرَ `CertificateAuthority.issueAsync` بموقِّعِ التوكنِ (‏`WL-303`)،
  و`AgentRegistry.register` يستعملُه. **والتنفيذُ بعدَ التذكرةِ ما زالَ مغلقاً في الإنتاجِ:**
  `CrownGateway.command` متزامنٌ على سجلٍّ مختومٍ ودفترٍ موقَّعٍ فيسقطُ بـ`SEALED_LOG_REQUIRES_ASYNC_APPEND`
  قبلَ المُعالِجِ (‏مقيسٌ: `A13` في `tests/production/wl-303-sovereign-authorization.test.mjs`).
- `scripts/serve-state.mjs` (‏`npm run serve`) مسارُ تطويرٍ **يرفضُ الإنتاجَ** (‏`WL-297`).
- PostgreSQL تخدمُ طبقةَ الاستمراريّةِ (‏`src/persistence/`) والطابورَ والعاملَ (‏`src/execution/`)،
  **ولا يستعملُها المسارُ الإنتاجيُّ أعلاه** — تدقيقُه في سجلٍّ ملفّيٍّ مختومٍ.

## 4 — حدودُ الأمنِ

| الحدُّ | أين يُفرَضُ | ما الذي لا يغطّيه |
| --- | --- | --- |
| المفتاحُ الملكيُّ لا يغادرُ وحدةَ الأمانِ | `pkcs11-provider.mts` · `hsm-binding.mts` · `production-boot.mts` | المقيسُ على SoftHSM (‏برمجيٌّ)، لا على HSM عتاديٍّ |
| لا أمرَ مؤثِّرَ إلا عبرَ التاجِ | `crown.mts` · `execution-kernel.mjs` · `guard:authorization` | المساراتُ خارجَ `ExecutionKernel` تُقاسُ بالحاجزِ نصّاً لا زمنَ تشغيلٍ |
| منعُ الرجوعِ بالحالةِ | `state-manifest.mts` (‏ADR 0006) | **حدٌّ معلَنٌ:** الختمُ على القرصِ نفسِه؛ مرجعُ حداثةٍ خارجَ القرصِ غيرُ منفَّذٍ (‏`R3-A-01`/`EXT-6`، ADR 0007 تصميمٌ بلا تنفيذٍ) |
| الوقتُ المُبرهَنُ | `src/time/attested-clock.mjs` · `config/time.yaml` | يحتاجُ وصولَ UDP إلى خوادمِ Roughtime في بيئةِ التشغيلِ |
| العزلُ التنفيذيُّ | `src/execution/isolation.mjs` (‏`unshare` + `prlimit`) | لا حاوياتٍ ولا cgroups؛ **ولا يُختبَرُ في CI** (§6) |
| الخروجُ إلى الشبكةِ | `src/egress/` | قنواتُ الإبلاغِ الحيّةُ (‏SMTP/Telegram) تُتخطّى في CI بلا بياناتِ اعتمادٍ |

والتفصيلُ في [نموذجِ التهديدِ](THREAT_MODEL.md) و[جذرِ الثقةِ](ROOT_OF_TRUST.md) و[`SECURITY.md`](../SECURITY.md).

## 5 — القدراتُ ودليلُ كلٍّ منها

`claim → source → test → evidence → commit`. والعمودُ «CI» يقولُ هل يُشغَّلُ الاختبارُ فعلاً في CI
أم يُتخطّى (‏سببُ التخطّي في §6).

| القدرةُ | المصدرُ | الاختبارُ | CI | آخرُ كوميتٍ على `main` يمسُّ المصدرَ | الحالُ |
| --- | --- | --- | --- | --- | --- |
| نقطةُ دخولٍ إنتاجيّةٌ تفشلُ مغلقةً | `src/production/entrypoint.mjs` · `scripts/production-entry.mjs` | `tests/production/entrypoint.test.mjs` · `subprocess.test.mjs` | يُشغَّلُ (‏حالاتُ SoftHSM الحقيقيّةُ تُتخطّى) | `2876cb58` (‏#207) · `7ad69efc` (‏#206) · `810e59ce` (‏#204) | منفَّذٌ وموصولٌ؛ **لا يُقلِعُ إنتاجاً** (§3) |
| تركيبُ جذرِ الثقةِ الإنتاجيِّ على HSM | `src/root-of-trust/production-runtime.mts` | `tests/root-of-trust/production-runtime.test.mjs` · `production-runtime-softhsm.test.mjs` | الأوّلُ بتوكنٍ مزيَّفٍ يُشغَّلُ؛ الثاني يُتخطّى (‏`XUUX_HSM_TEST`) | `2876cb58` | منفَّذٌ؛ مقيسٌ على SoftHSM محلّيّاً |
| موفِّرُ PKCS#11 (‏AES-GCM · Ed25519 غيرُ قابلٍ للاستخراجِ) | `src/root-of-trust/pkcs11-provider.mts` · `scripts/pkcs11-*.mjs` | `tests/root-of-trust/pkcs11-*.test.mjs` | اختباراتُ العقدِ تُشغَّلُ؛ التوكنُ الحقيقيُّ يُتخطّى | `61f5c668` | منفَّذٌ؛ لا HSM عتاديَّ؛ عقدُ `pkcs11js` غيرُ محسومٍ (‏`OPS-1/M6`) |
| مُتحقِّقُ الأوامرِ الملكيّةِ في مفتاحِ الإيقافِ | `src/root-of-trust/royal-command.mts` · `halt-switch.mts` · `scripts/halt-switch.mjs` | `tests/production/royal-command-verifier.test.mjs` · `halt-switch-integration.test.mjs` | يُشغَّلُ | `2876cb58` (‏#207، `WL-299`/`WL-300`) | منفَّذٌ وموصولٌ؛ نتائجُ المجلسِ عليه مفتوحةٌ (§8) |
| بوابةُ التاجِ ودفترُ الأوامرِ | `crown.mts` · `command-ledger.mts` | `tests/root-of-trust/command-ledger.test.mjs` · `root-of-trust.test.mjs` | يُشغَّلُ | `d08c1cd3` · `734397dc` (‏#96) | منفَّذٌ وموصولٌ |
| سجلُّ أحداثٍ دائمٌ مختومٌ وتثبيتٌ دوريٌّ موقَّعٌ | `persistent-log.mts` · `anchor.mts` | `tests/root-of-trust/persistent-log.test.mjs` · `anchor.test.mjs` | يُشغَّلُ | `1648d450` · `3fa38868` | منفَّذٌ؛ العبثُ يُكشَفُ ولا يُمنَعُ على القرصِ |
| بيانُ حالةٍ مختومٌ وحدُّ الرجوعِ | `state-manifest.mts` · `freshness-socket.mts` | `tests/root-of-trust/replay-limit.test.mjs` · `freshness-socket.test.mjs` | يُشغَّلُ | `5babed13` · `2876cb58` | منفَّذٌ داخلَ القرصِ؛ **لا مصدرَ حداثةٍ خارجيَّ** |
| وقتٌ مُبرهَنٌ بنصابِ Roughtime | `src/time/` | `tests/time/*.test.mjs` · `tests/root-of-trust/attested-time-gate.test.mjs` | يُشغَّلُ على عيّناتٍ مُثبَّتةٍ (‏`tests/fixtures/roughtime/`) | `d08c1cd3` | منفَّذٌ وموصولٌ؛ الشبكةُ الحيّةُ غيرُ مقيسةٍ في CI |
| سلسلةُ الإنفاذِ (‏هويّةٌ · سياسةٌ · حَجرٌ) | `src/core/composition-root.mjs` · `src/policy/` | `tests/core/composition-root.test.mjs` · `tests/policy/*.test.mjs` | يُشغَّلُ | `7ad69efc` | منفَّذٌ وموصولٌ |
| نواةُ التنفيذِ والوضعُ الآمنُ | `src/core/execution-kernel.mjs` | `tests/core/execution-kernel.test.mjs` · `safe-mode-persistence.test.mjs` | يُشغَّلُ | `50ee266e` (‏#57) | منفَّذٌ وموصولٌ |
| الاستمراريّةُ على PostgreSQL والهجراتُ | `src/persistence/` · `migrations/` | `tests/persistence/*.test.mjs` | يُشغَّلُ على حاويةِ `postgres` في CI | `2f06f6a1` | منفَّذٌ؛ غيرُ موصولٍ بالمسارِ الإنتاجيِّ أعلاه |
| الحجزُ القانونيُّ والاحتفاظُ | `src/data/retention-cycle.mjs` · `scripts/retention.mjs` | `tests/data/legal-hold-sovereign.test.mjs` | يُشغَّلُ | `98e88fbe` | منفَّذٌ |
| العزلُ التنفيذيُّ الحقيقيُّ | `src/execution/isolation.mjs` · `scripts/isolated-task-runner.mjs` | `tests/execution/isolation.test.mjs` · `worker-isolation.test.mjs` | **حالاتُ العزلِ الحقيقيِّ تُتخطّى** (‏`userns` محظورٌ على المضيفِ) | `64d07258` | منفَّذٌ؛ **غيرُ مقيسٍ في CI منذ `WL-286`** (‏`LIVE-23`) |
| تمارينُ التعافي والفوضى والطوارئِ | `src/recovery/` · `src/chaos/` · `src/emergency/` | `tests/recovery/` · `tests/chaos/` · `tests/emergency/` | يُشغَّلُ | — | منفَّذٌ محلّيّاً في العمليّةِ والقرصِ؛ لا شبكةَ حقيقيّةَ ولا سحابةَ |

## 6 — ما يقيسُه CI وما لا يقيسُه

- **المنصّةُ:** كلُّ مساراتِ العملِ الأربعةِ (‏`ci.yml` · `measure-skip-baseline.yml` ·
  `publish-skip-baseline.yml` · `auto-measure-skip-baseline.yml`) على `ubuntu-latest` المستضافِ
  منذ `WL-286`، وقاعدةُ البياناتِ حاويةُ خدمةٍ `postgres:18.6-alpine`. **لا عدّاءَ ذاتيَّ الاستضافةِ.**
- **لقطةُ `main@23d07212`** (‏التشغيلةُ `37044233977`، خطوةُ «الاختبارات»، مقروءةٌ من سجلِّها):
  `tests 2398` · `pass 2355` · `fail 0` · `skipped 43`.
- **أسبابُ التخطّي الـ43 كما طُبِعَت:** محاكي TPM (‏`swtpm`/`XUUX_TPM_SIM`) **25** · `userns`
  (‏`unshare: write failed /proc/self/uid_map`) **6** · توكنُ SoftHSM حقيقيٌّ (‏`XUUX_HSM_TEST`) **7** ·
  قناةٌ حيّةٌ (‏`XUUX_CHANNEL_POC`) **2** · عزلٌ حقيقيٌّ غيرُ متاحٍ **1** · متغيّراتُ بيئةٍ خارجيّةٌ **1** ·
  SMTP **1**.
- **فالأخضرُ لا يعني:** أنّ HSM الحقيقيَّ أو TPM أو العزلَ بمساحاتِ الأسماءِ أو القنواتِ الحيّةَ
  مقيسةٌ في CI. هي مقيسةٌ (‏إن قِيسَت) على جهازِ المالكِ بأدلّةٍ في سجلِّ الأعمالِ.

## 7 — حالُ GitHub المقيسُ

| البندُ | المقيسُ (‏2026-10-02) |
| --- | --- |
| المستودعُ | `ovvvog/xuux` — **عامٌّ** · `delete_branch_on_merge: true` |
| حمايةُ `main` | مراجعةٌ موافِقةٌ واحدةٌ · `enforce_admins: true` · حلُّ المحادثاتِ إلزاميٌّ · **فحصُ «فحص الجودة الكامل» مُلزَمٌ** (‏`app_id 15368`) · **الدفعُ القسريُّ والحذفُ ممنوعانِ** — نُفِّذَ في `WL-302` بأمرِ المالكِ الصريحِ (‏`EXT-1`) |
| البيئاتُ | `publish-skip-baseline` بقاعدتَي `branch_policy` و`required_reviewers` |
| الفروعُ البعيدةُ | `main` وحدَه بعدَ تنظيفِ `WL-301` |
| طلباتُ الدمجِ المفتوحةُ | لا شيءَ على `main@5222c40e` قبلَ طلبِ `WL-302` |

## 8 — المراجعةُ المستقلّةُ

`config/external-review.yaml` (‏مقروءاً بمُفسِّرِ YAML): **57 نتيجةً — 27 `closed` · 30 `open`**،
وسلطةُ النتيجةِ `model-council`. وجولةُ `WL-292` أنتجَت 12 اتفاقاً على الإغلاقِ **لم تُقيَّدْ** في العقدِ
لأنّ خطّةَ الجولةِ تشترطُ عرضَها على المالكِ أوّلاً — **فالنتائجُ الثلاثونَ مفتوحةٌ رسميّاً** وأيُّ
وثيقةٍ حاليّةٍ تقولُ غيرَ ذلك خطأٌ. والجدولُ بنداً بنداً في §4.3 من [سجلِّ الديونِ](roadmap/06-debt-register.md).

## 9 — الفجواتُ المتبقّيةُ الحقيقيّةُ (‏بالحجبِ)

1. **مصدرُ حداثةٍ إنتاجيٌّ** (‏`R3-A-01` / `EXT-6`) — بدونِه لا إقلاعَ إنتاجيٌّ أصلاً.
2. **HSM عتاديٌّ ووصولُ Roughtime** في بيئةِ التشغيلِ (‏`WL-299`) — المقيسُ SoftHSM وعيّناتٌ مثبَّتةٌ.
3. **مراجعةٌ مستقلّةٌ** `M11.04`–`M11.06`: ثلاثونَ نتيجةً مفتوحةً، منها اثنتا عشرةَ تنتظرُ قرارَ المالكِ بالتقييدِ.
4. ~~فحصُ CI مُلزَمٌ ومنعُ الدفعِ القسريِّ~~ — **نُفِّذَ في `WL-302`** وقِيسَ بـ`GET …/branches/main/protection`؛ وتسجيلُ `M0.06` في اللوحةِ للمالكِ (‏`EXT-1`).
4ب. **فصلُ مفتاحِ الأمرِ الملكيِّ عن مفتاحِ العُقدة** (‏`LIVE-24`، `WL-302`) — قرارُ المالكِ.
5. **تغطيةُ CI للعزلِ وTPM وHSM** (‏`LIVE-23`).
6. **إصدارُ الشهاداتِ في الإنتاجِ** — يحتاجُ مسارَ توقيعٍ غيرَ متزامنٍ.
7. **قرارُ الإطلاقِ** `M11.09` و`G11` — للمالكِ وحدَه.

## 10 — خريطةُ الوثائقِ

تصنيفُ كلِّ ملفّاتِ Markdown (‏حاليّةٌ · تاريخيّةٌ · تخطيطٌ · قوالبُ) في [فهرسِ `docs/`](README.md).
