# WL-415 — دورةُ المعالجةِ المحدودةُ بعدَ متابعةِ WL-414 (أدلّةُ المنفِّذِ)

**النطاق:** المسائلُ التقنيّةُ الستُّ المتبقّيةُ من تقريرِ `gpt_6_1_sol` في جولةِ المتابعةِ
(`../adr0007-ceremony-wl414-followup-review/gpt_6_1_sol-report.md`، مُقيسٌ على `3e67d362`) — FUP-SOL-01..05
وربطُ طولِ بصمةِ `PolicySigned` بالطلب (وهو أيضًا البندُ «PolicySigned digest len 1» في تقريرِ `grok_4_7`).
دورةُ إصلاحٍ واحدةٌ؛ على المحاكي `swtpm 0.10.1` وحدَه؛ لا أمرَ إلى TPM حقيقيٍّ، ولا `/dev/tpm*`،
و`SUPPORTED_FRESHNESS_BACKENDS` فارغة. **تقاريرُ جولةِ المتابعةِ وحزمتُها لم تُعدَّلْ.** ونتائجُها
مقيسةٌ على `3e67d362`؛ وكلُّ ما هنا مقيسٌ على `a3272058` (خطُّ الأساسِ) أو على الشيفرةِ المعدّلةِ —
فلا تُخلَطُ النتائجُ بينَ هذه الرؤوس.

## SHA

| الدور | SHA |
| --- | --- |
| `main` المرجعيّ | `ca134f8939eafb4d77e5eb537775e7b113ce0d26` |
| خطُّ الأساسِ (رأسُ PR #378 قبلَ الدورة) | `a3272058cb31365a5fe60f9c536832209debaab8` |
| الشيفرةُ المعدّلةُ | `813273c1dd8a2e4cc73ca163ac2fef24a0e29e69` (بصماتُ ملفّاتِه في `evidence/code-813273c1.sha256`) |
| التزامُ الأدلّةِ اللاحقُ | وثائقيٌّ فقط: يضيفُ سجلّاتِ القياسِ على `813273c1`؛ `git diff 813273c1 -- sim tests` فارغ |

## إعادةُ الإنتاجِ على `a3272058` (قبلَ أيِّ تعديل)

نسخةُ عملٍ منفصلةٌ (`git worktree`، رأسٌ منفصلٌ على `a3272058`) ومسابرُ المراجعِ نفسُها من
`../adr0007-ceremony-wl414-followup-review/probes/gpt_6_1_sol/` (`IndependentFollowup.cs`، `PositiveExpiration.cs`،
`run-independent.sh` بمتغيّرِ `OUTPUT`، ومسبارُ الجاهزيّةِ). الأوامرُ ورموزُ الخروجِ الخامُّ في
`evidence/raw-outputs.tar.gz` (`repro-a3272058*/commands.log` و`*.exit`)، والملخّصُ في
`evidence/repro-a3272058-summary.txt`.

| المسألة | الأمر | رمزُ خروجِ المسبار | السلوكُ المقيسُ على `a3272058` |
| --- | --- | --- | --- |
| FUP-SOL-01 + البصمة | `OUTPUT=…/repro-a3272058 bash run-independent.sh policy-digest-{1,32,64,65} policy-hierarchy-{40000001,4000000b,4000000c,40000007}` و`policy-tag-{8023,8024}` | 0 لكلٍّ | البصماتُ 1/32/64 والهرميّاتُ 0x40000001/0B/0C والوسمُ 0x8023 ⇒ `COMPLETE` (81 خطوة)؛ 65 و0x8024 وحدَهما ⇒ `FAILED_CLOSED` |
| FUP-SOL-02 | `run-independent.sh creation-outsideinfo creation-parentname` | 0 | كلاهما `COMPLETE` (outsideInfo مختلفٌ واسمُ أصلٍ مقلوبٌ مقبولانِ) |
| FUP-SOL-03 | `bash probes/run-repro-a3272058-readiness.sh` (shim `tpm2_getcap` يفشلُ؛ محاولةٌ واحدةٌ) | node: 1 | `processes-immediately-after.txt`: محاكٍ يتيمٌ واحدٌ (PPID=1) بمجلّدِ حالةِ الاختبار |
| FUP-SOL-04 | `run-independent.sh cleanup-undefine-before undefine-drop-before` | 0 | بعدَ استنفادِ محاولةِ التنظيفِ: «left for the bounded cleanup attempt (declared as leftover if it remains)» — النصُّ نفسُه في المسارِ الصحيحِ قبلَ التنظيف |
| FUP-SOL-05 | `run-positive-expiration.sh` (`PositiveExpiration.cs`) | 0 | `expiration=3600 SCHEMA_REJECT … RESPONSE_POLICY_TIMEOUT_MALFORMED: len=0` لردِّ swtpm الحقيقيِّ |

## قياسٌ جديدٌ قبلَ التصميم (`probes/TicketShape.cs`)

`bash probes/run-with-sim.sh 7200 mono ts-a3272058.exe 7200` (مترجَمٌ على نواةِ `a3272058`) — خروجٌ 0، وصفرُ
عمليّاتٍ بعدَ الإيقاف (`evidence/ticket-shape-a3272058.txt`). ردودُ swtpm الحقيقيّةُ لـPolicySigned:

| الجلسة | expiration | timeout | الوسم | الهرميّة | البصمة | حكمُ `a3272058` |
| --- | --- | --- | --- | --- | --- | --- |
| سياسة | 0 | 0 | 0x8025 | 0x40000007 | 0 | قبول |
| سياسة | 3600 | 0 | 0x8025 | 0x40000007 | 0 | **رفض** (FUP-SOL-05) |
| سياسة | −3600 | 8 | 0x8025 | 0x40000001 | 64 | قبول |
| تجربة | 0 | 0 | 0x8025 | 0x40000007 | 0 | قبول |
| تجربة | 3600 | 0 | 0x8025 | 0x40000007 | 0 | **رفض** |
| تجربة | −3600 | 0 | 0x8025 | 0x40000007 | 0 | **رفض** (حالةٌ إضافيّةٌ من الجذرِ نفسِه، كشفَها القياس) |

والاسمُ المؤهَّلُ للأصلِ في ردِّ Create الحقيقيِّ = `000B || SHA256(40000001 || Name(primary))` (حُسبَ ووُوزنَ
بالبايت)؛ وفي CreatePrimary: `parentNameAlg=ALG_NULL` والاسمُ والاسمُ المؤهَّلُ = `40000001`.

## الإصلاح

`sim/tpm-ceremony/TpmCeremonyCore.cs`:

- **`ResponseContext`** يُغذّى من `Send` بعدَ نجاحِ فحصِ المخطّطِ فقط: أسماءُ الكائناتِ وهرميّاتُها وأسماؤها المؤهَّلةُ
  (CreatePrimary/Load) وأنواعُ الجلساتِ (StartAuthSession)، وتُمحى عندَ FlushContext.
- **تذكرةُ PolicySigned** (FUP-SOL-01/05 + البصمة): الوسمُ 0x8025 حصرًا؛ شكلُ التذكرةِ من الطلبِ: `expiration≥0`
  أو جلسةُ تجربةٍ ⇒ NULL (timeout 0، RH_NULL، بصمة 0)؛ `expiration<0` في جلسةِ سياسةٍ ⇒ حقيقيّة (timeout 8،
  هرميّةُ authObject المسجّلةُ، بصمة 64). بلا سياقٍ للحالةِ السالبةِ ⇒ `RESPONSE_POLICY_CONTEXT_UNKNOWN`.
- **بياناتُ الإنشاءِ** (FUP-SOL-02): `outsideInfo` = ما في الطلبِ؛ CreatePrimary: ALG_NULL والاسمانِ = مقبضُ
  الهرميّةِ؛ Create: SHA-256 والاسمُ = اسمُ الأصلِ المسجّلِ والاسمُ المؤهَّلُ محسوبٌ؛ أصلٌ غيرُ مسجّلٍ ⇒
  `RESPONSE_CREATION_PARENT_UNKNOWN`.
- **نصُّ المصالحةِ** (FUP-SOL-04): `_cleanupDone` بعدَ جولةِ التنظيفِ؛ بعدَها «cleanup attempt budget already spent
  (1 per resource; no further attempt); declared as leftover» وبقيّةٌ معلَنةٌ في `cleanupLeftovers` إن لم تكن.

`tests/helpers/ceremony-swtpm.mjs` (FUP-SOL-03): `startSim`/`stopSim` مشتركتانِ بدلَ ثلاثِ نسخٍ؛ محاكٍ أُطلِقَ
ولم يجهزْ يُنهى (SIGTERM ثمّ SIGKILL) ويُنتظَرُ زوالُه قبلَ حذفِ مجلّدِه.

## إثباتُ الرجوع

| التشغيل | الأمر | الخروج | النتيجة |
| --- | --- | --- | --- |
| الاختباراتُ الجديدةُ على الشيفرةِ المعدّلة | `run-sim-tests.sh … tests/sim/tpm-ceremony-wl414-fup.test.mjs` | 0 | 26/26 (`evidence/fup-tests-on-fix.tap`) |
| الاختباراتُ نفسُها والمساعداتُ على **نواةِ** `a3272058` | الأمرُ نفسُه في نسخةِ عملٍ على `a3272058` + نسخُ ملفّاتِ الاختبارِ/المساعداتِ وحدَها | 1 | 9 ناجحةٌ / **17 فاشلةٌ** (`evidence/fup-tests-on-a3272058-core.tap`): FUP-1 (3600 مرفوض)، FUP-2 ×7 و FUP-3 ×8 (`COMPLETE` بدلَ الرفض)، FUP-4 (النصُّ القديم)؛ والضوابطُ (0x8024، إعادةُ الترميزِ الصحيحةُ، 4c، 5، 5c) ناجحة |
| مجموعةُ البروفةِ كاملةً على الشيفرةِ المعدّلة | `run-sim-tests.sh … tests/sim/tpm-ceremony-*.test.mjs` | 0 | 99/99 (73 سابقةً + 26)؛ `pgrep swtpm` بعدَها = 0 (`evidence/ceremony-all-on-fix.tap`) |
| مجموعةُ البروفةِ على `813273c1` | الأمرُ نفسُه | 0 | 99/99؛ `pgrep -c swtpm` = 0 (`evidence/ceremony-all-on-813273c1.tap`) |
| `npm run validate` على `813273c1` | `npm run validate` | 0 | 2885/2593/0/292 (`evidence/validate-813273c1.summary.txt`) |
| `bash scripts/tpm-sim-ci.sh` على `813273c1` | `bash scripts/tpm-sim-ci.sh` | 0 | 212/210/0/2؛ swtpm بعدَه = 0 (`evidence/tpm-sim-ci-813273c1.summary.txt`) |
| مسابرُ المراجعِ على النواةِ المعدّلة | `OUTPUT=…/after-fix CORE=<المعدّلة> bash run-independent.sh …` (21 وضعًا) | 0 لكلٍّ | `evidence/after-fix-reviewer-probes-summary.txt`؛ صفرُ عمليّاتٍ بعدَ كلِّ إيقاف |
| مسبارُ الأشكالِ على النواةِ المعدّلة | `run-with-sim.sh 7210 mono tsctx-fix.exe 7210` | 0 | الأشكالُ الستّةُ مقبولةٌ (`evidence/ticket-shape-fix.txt`) |
| مسبارُ الجاهزيّةِ (shim نفسُه) على الشجرةِ المعدّلة | `node --test --test-name-pattern=R3-18 tests/sim/tpm-ceremony-wl413-r3.test.mjs` بـ`PATH` الـshim | 1 (متوقَّعٌ: تعذّرُ التشغيلِ) | 8 محاولاتٍ × 10 استعلامات، و**صفرُ** عمليّاتِ swtpm فورَ الخروجِ (`readiness-fixed/` في الأرشيف) |

ملاحظةٌ صريحة: الصفوفُ «على الشيفرةِ المعدّلة» قِيسَت على شجرةِ العملِ قبلَ الالتزامِ (`evidence/measured-tree.sha256`)؛
والفرقُ الوحيدُ عن `813273c1` تنسيقُ Prettier في `tests/helpers/ceremony-swtpm.mjs` — لذا أُعيدَتِ المجموعةُ كاملةً
و`validate` و`tpm-sim-ci` على `813273c1` نفسِه. ملاحظةٌ صريحة: اختبارا FUP-5/5c يستعملانِ واجهةَ المساعدِ الجديدِ فلا يُطبَّقانِ على خطِّ الأساسِ؛ دليلُ الفشلِ
القديمِ هو مسبارُ الجاهزيّةِ على `a3272058` (يتيمٌ واحدٌ) مقابلَ صفرٍ بعدَ الإصلاح. وسطرُ `git rev-parse` في
`after-fix/commands.log` يطبعُ `a3272058` لأنَّ المشغّلَ يقرأُ رأسَ نسخةِ العملِ؛ النواةُ المترجَمةُ هي
المعدّلةُ (`CORE=` في السطرِ نفسِه).

## الحدود

- محاكٍ وحدَه؛ ثباتُ أطوالِ التذاكرِ (64) قياسُ libtpms/swtpm لا ضمانٌ لشريحةٍ أخرى.
- `pcrSelect`/`pcrDigest`/`locality` في بياناتِ الإنشاءِ لم تُربَطْ بالطلبِ في هذه الدورة (خارجَ المسائلِ الستِّ).
- البروفةُ ترسلُ `expiration=0` وحدَه؛ الحالاتُ 3600/−3600 مغطّاةٌ بمسبارٍ مباشرٍ على ردودٍ حقيقيّةٍ لا بمسارِ البروفة.
- `more=0` وسياسةُ فهارسِ NV: قرارُ المالك، لم تُغيَّرا. `R3-A-01` و`EXT-6` مفتوحان.
- المراجعةُ المستقلّةُ المركّزةُ تُطلَبُ على SHA النهائيِّ بعدَ الدفعِ؛ نتائجُها لا تُدرَجُ هنا ولا تُخلَطُ بنتائجِ `3e67d362`.
