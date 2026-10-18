# متابعة WL-414 — grok_4_7 على 3e67d362

المراجع: grok_4_7. التاريخ: 2026-10-18 (آسيا/الرياض).  
الرأس المقيس: `3e67d362dc4f30ec35f73957fd5542be47a3a875` (`git rev-parse HEAD` في `/tmp/wl414-followup/reviewers/grok_4_7/repo`).  
`git status --porcelain` حجمه 0 بايت بعد انتهاء القياس. فرق الملفات المحمية عن `8b48a568` (`scripts/production-entry.mjs` و`config/external-review.yaml` و`version.json` و`sim/tpm/tcti_guard.mjs`) حجمه 0 بايت.  
لم يُلمس `/dev/tpm*`. لم يُشغَّل `scripts/tpm-sim-ci.sh`. لم يُستعمل `gh` ولا `git commit` ولا `git push`. لم يُعدَّل ملف متعقَّب. المسابر خارج الشجرة في `probes/GrokFollowup.cs`.  
المنفذ: 7300، التحكم 7301 فقط. محاكي سابق على 2321/2322 (pid 10834، حالة `/tmp/wl414-followup/swtpm-shared2`) كان قائمًا قبل هذه الجولة ولم أُرسل إليه إشارة.

## البيئة والاستقلال

| الأداة | المقيس |
| --- | --- |
| swtpm | 0.10.1 |
| tpm2-tools | 5.7 (`tpm2_getcap`) |
| node | v20.20.2 |
| mono-mcs | 6.14.1.0 (`mcs -langversion:5`) |
| pwsh | **7.7.0-preview.5** — أحدث من 7.4 المذكورة في تكليف الجولة السابقة. انحراف موثَّق، لا إعادة قياس على 7.4. |

حد الاستقلال: الحاوية مشتركة. لم أقرأ أي دليل تحت `/tmp/wl414-followup/reviewers/` خارج `grok_4_7` و`brief-common.md`. في قائمة عمليات مبكرة ظهر `swtpm` لم أُطلقه على المنفذ 7200؛ لم أُرسل إليه إشارة ولم أقرأ حالةَه. عزل المراجعين هنا بتكليف لا بحاجز تقني. مسابري وملف اختبارات R3 اشتغلا في الوقت نفسه؛ عدّ اليتامى أدناه مأخوذ من لقطة بعد خروج `node` لا من لقطات تداخلت مع التشغيل.

أوامر الإعادة في `probes/commands.log`. ملخص الحقول في `raw/SUMMARY.txt`. كل وضع: خروج جامع `mono` = 0 (الملف `raw/<mode>.exit`).

## خلاصة

1. هجوم R3SOL-01 بصفحة مكررة ثم استبدال مقبض الإنشاء **انكسر قبل التبني**: الضحيتان `0x80000000` و`0x80000001` بقيتا، و`flushed=[]`. التكرار الثلاثي، والترتيب التنازلي، ومقبض دون نقطة البدء، وتكرار جلسة، وعدد 65 لطلب 64: كلها رُفضت بالاسم نفسه تقريبًا (`RESPONSE_CAPABILITY_HANDLE_ORDER_MALFORMED` أو `RESPONSE_CAPABILITY_COUNT_MALFORMED`) وبلا `FlushContext`.
2. **الأثر نفسه ما زال قابلًا للإنتاج بحقنين من نوع آخر:** صفحة جرد سليمة الشكل مع `more=0` تخفي أحد حارسي خط الأساس، ثم استبدال مقبض `CreatePrimary` بالضحية المخفية. أُرسل `FlushContext` للضحية، وبقي الكائن الحقيقي الجديد. الحقل `status` = `FAILED_CLOSED` و`Create` rc=`0x00000902` — نفس شكل نهاية R3SOL-01 في تقرير الجولة السابقة، لا صفحة تكرار. ثلاث تركيبات قيست (بادئة `more=0`، المقبض الأعلى فقط، صفحة ثانية فارغة بعد `more=1`).
3. ملف التفويض مربوط بنوع جلسة الطلب في الاتجاهين. القيم الأربع للهرمية تُقبل، و`0x40000002` يُرفض. بصمة تذكرة الإنشاء بطول غير 64 تُرفض. بصمة تذكرة `PolicySigned` بطول 1 مع `RH_NULL` وصلت إلى الحقل `status` = `COMPLETE` على مرحلة `S2`.
4. خط الأساس الجزئي: `postRunInventory.verified=false` ورسالة `partial baseline` في مسبرين مستقلين (فشل جرد العابرين، وفشل جرد الجلسات بعد نجاح العابرين). اختبار الحقن `R3-18` موجود في الشجرة، وسطر TAP له `ok 32` بلا `SKIP` ضمن `# tests 32` `# pass 32` `# fail 0`.
5. فقد رد تعريف فعلي (rc=`0` ثم رمي الرد، لا جسم مشوَّه): لا `NV_UndefineSpace`، والنص المعلن يطابق §12.5، والفهرس يبقى. فهرس أجنبي زُرع قبل البروفة يبقى في بروفة بالحقل `status` = `COMPLETE` وفي مسار الفقد. فهرس مطابق زُرع قبل تعريف البروفة (رد التعريف الأصلي `0x14c` ثم أُسقط) لم يُحذف.
6. بعد خروج ملف اختبارات R3 (32 اختبارًا، منها مسارات فشل الحقن، ومنها R3-18): عدد عمليات `swtpm socket` لم يزد عن العملية السابقة على 2321. العد فور خروج `node`، بلا تنظيف خارجي.
7. قائمة السماح في الرأس لا تضيف مسار استثناء عن `d9e1dc3b^`. استثناء ثلاثة ملفات فارغة أُضيف في `0ba77606` وأُزيل في `673c8c88`. `node scripts/guard-templates.mjs` خرج 0 ومخالفات 0. نصوص منشورة ما زالت أوسع من القياس أو تخالف ملف الدليل المرفق في الشجرة نفسها (الأرقام، وعبارة `likely not executed`).

## 1. المقابض المكررة وإخفاء خط الأساس

الزرع: `CreatePrimary` مرتين قبل `Run` على محاكٍ جديد، فصار الحارسان `0x80000000` و`0x80000001`. الاستبدال، إن وُصل إليه، يضع مقبض رد `CreatePrimary` على الضحية المخفية. المرحلة `S2`. المخرجات: `raw/r3sol01-full.json` و`raw/dup-triple.json` و`raw/descending.json` و`raw/below-start.json` و`raw/cross-page-dup.json` و`raw/session-dup.json` و`raw/count-over.json` و`raw/omit-more0-alias.json` و`raw/omit-higher-only-alias.json` و`raw/omit-page2-empty-alias.json` و`raw/omit-more0-alias.steps.json`.

### ما انكسر

| الوضع | الفشل المطبوع | flushed | العابرون بعد |
| --- | --- | --- | --- |
| `r3sol01-full` صفحة `[0x80000000, 0x80000000]` ثم الاستبدال مسلّح | `RESPONSE_CAPABILITY_HANDLE_ORDER_MALFORMED: 0x80000000 after 0x80000000 from 0x80000000` | `[]` | الاثنان | 
| `dup-triple` ثلاث نسخ | `… after 0x80000000 from 0x80000000` | `[]` | الاثنان |
| `descending` `[0x80000001, 0x80000000]` | `… 0x80000000 after 0x80000001 from 0x80000000` | `[]` | الاثنان |
| `below-start` / `cross-page-dup` صفحة أولى `more=1` والمقبض الأدنى، ثم الصفحة الثانية تعيد `0x80000000` والطلب عند `0x80000001` | `… 0x80000000 after 0x00000000 from 0x80000001` | `[]` | الاثنان |
| `session-dup` جلسة `0x03000000` مرتين في جرد يبدأ عند `0x02000000` | `… 0x03000000 after 0x03000000 from 0x02000000` | `[]` | الجلسة بقيت |
| `count-over` 65 مقبضًا لطلب 64 | `RESPONSE_CAPABILITY_COUNT_MALFORMED: 65 > requested 64` | `[]` | — |

في `r3sol01-full` التعديل الثاني (استبدال المقبض) لم يُسجَّل في `edits`: السلسلة وقفت عند صفحة التكرار. `postRunInventory.verified=false` و`partial baseline` لأن الالتقاط توقف. هذا وصف لهذه الصفحات، لا لكل أشكال الجرد.

محاولة التكرار عبر صفحتين: الصفحة الثانية طُلبت عند `last+1` (`0x80000001` في `edits`). إعادة مقبض الصفحة الأولى رُفضت لأنه دون نقطة البدء. لم أُنشئ صفحة ثانية تقبلها `ResponseSchema.Check` وفيها مقبض ظهر في الصفحة الأولى: بعد صعود صارم يصير `next = last+1`، فكل مقبض سابق دون البداية. هذا قراءة للشيفرة (`HandleSet` حوالي 1258–1259 و`ResponseSchema.Check` حوالي 839–840) مع القياس أعلاه، لا مسحًا لكل تركيب.

الفحص المباشر بلا محاكٍ (`raw/direct.json`، أسطر JSON متتالية لا كائن واحد): التكرار والتنازلي ودون البداية والعدد 65 رمت `ResponseMalformedException` بالأسماء أعلاه. صفحة `more=0` ومقبض واحد `0x80000000` لطلب يبدأ عند `0x80000000` **لم ترمِ** (`direct-omit-more0-schema-accepts`، `threw=false`).

### ما بقي: إخفاء بـ `more=0` ثم الاستبدال

`omit-more0-alias`: صفحة خط الأساس استُبدلت بـ `more=0, count=1, 0x80000000` (تخفي `0x80000001` بلا تكرار وبلا هبوط). ثم `primary-handle:0x80000002=>0x80000001`.

- `changes=2`
- `flushed=["0x80000001"]`
- العابرون قبل: `["0x80000000","0x80000001"]` وبعد: `["0x80000000","0x80000002"]` — الضحية المخفية غابت، والكائن الذي أنشأه TPM (`0x80000002`) بقي
- الحقل `status` = `FAILED_CLOSED`
- `failure` = `TPM_ERROR: s2:Create(service-key,ECDSA-P256) rc=0x00000902`
- `cleanupLeftovers` فيها `residual 0x80000002: present after run, absent from baseline; not removed`
- خطوات مختصرة في `raw/omit-more0-alias.steps.json`: جرد العابرين `outcome=ok`، ثم `CreatePrimary` `outcome=ok`، ثم `Create` `unexpected-failure` rc=`0x00000902`، ثم `cleanup:FlushContext` `outcome=ok`

`omit-higher-only-alias`: الصفحة `more=0` والمقبض `0x80000001` فقط، والاستبدال إلى `0x80000000`. `flushed=["0x80000000"]`. بعد: `0x80000001` و`0x80000002`. الضحية الأدنى غابت.

`omit-page2-empty-alias`: صفحة أولى `more=1` والمقبض `0x80000000`، ثم صفحة ثانية `more=0` و`count=0` عند الطلب `0x80000001`. `flushed=["0x80000001"]`. بعد: `0x80000000` و`0x80000002`.

الحقنان لازمان: الإخفاء وحده لا يرسل `FlushContext`؛ الاستبدال هو ما يُدخل الضحية في `_transients` فيُحررها التنظيف. هذا نفس عدد الحقنات في R3SOL-01، والتقنية مختلفة. فحص «صاعد بلا تكرار» لا يرفض صفحةً تدّعي `more=0` وهي تُسقط مقبضًا أعلى. [Part 3 r01.38 §30.2](https://trustedcomputinggroup.org/wp-content/uploads/TPM-Rev-2.0-Part-3-Commands-01.38.pdf) يجعل `moreData=YES` إن بقيت قيم لم تُعَد، ويطلب قراءة المقبض التالي بآخر مقبض مُعاد + 1. القياس هنا على ناقل حقن لا على شريحة.

لا أعمم هذا على كل أوامر الرد. المقيس جرد مقابض العابرين في `SnapshotBaseline` ثم تبني `CreatePrimary`.

## 2. نوع التفويض والهرمية وأطوال البصمات والحقول الداخلية

### التفويض — الاتجاهان

| الوضع | ما غُيّر | المطبوع |
| --- | --- | --- |
| `auth-pw-as-policy` | على `NV_DefineSpace` (جلسة `RS_PW`): nonce=32 وattrs=`0x00` وhmac فارغ | `RESPONSE_AUTH_CONTENT_MALFORMED: … nonceLen=32 attrs=0x00 hmacLen=0 expected=password` |
| `auth-policy-as-password` | على `NV_Increment` بجلسة سياسة: nonce=0 وattrs=`0x01` وhmac فارغ | `… nonceLen=0 attrs=0x01 hmacLen=0 expected=policy` |
| `auth-pw-attrs08` | attrs=`0x08` على رد كلمة سر | `expected=password` |
| `auth-policy-nonce16` | nonce بطول 16 على رد سياسة | `expected=policy` |
| `auth-policy-attrs08` | attrs=`0x08` على رد سياسة | `expected=policy` |

الفحص المباشر وافق ذلك: ملف السياسة على أمر كلمة سر يُرمى، وملف كلمة السر على أمر سياسة يُرمى، والملف المطابق لا يُرمى (`raw/direct.json`). هذا لهذه الأشكال الخمسة، لا لكل بت في `TPMA_SESSION` ولا لكل طول nonce خارجها.

رد التعريف المشوَّه بعد تنفيذ الأمر عومل كرد غير قابل للاستخدام: الفهرس بقي وأُعلن `ownership-undetermined` بلا `NV_UndefineSpace` (`auth-pw-as-policy`). هذا مسار «رد غير صالح» لا مسار «فقد الرد» في البند 4.

### الهرمية

| الوضع | القيمة | الحقل `status` | المرحلة |
| --- | --- | --- | --- |
| `creation-hier-invalid` | `0x40000002` على تذكرة CreatePrimary | `FAILED_CLOSED` | `RESPONSE_TICKET_HIERARCHY_MALFORMED: CreatePrimary 0x40000002` |
| `creation-hier-platform` | `0x4000000C` | `COMPLETE` | `S2` |
| `creation-hier-endorsement` | `0x4000000B` | `COMPLETE` | `S2` |
| `creation-hier-null` | `0x40000007` | `COMPLETE` | `S2` |
| `policy-hier-invalid` | `0x40000002` | `FAILED_CLOSED` | `RESPONSE_TICKET_HIERARCHY_MALFORMED: PolicySigned 0x40000002` |
| `policy-hier-platform` / `endorsement` / `owner` | `0x4000000C` / `0B` / `01` | `COMPLETE` | `S2` |

القيم الأربع تُقبل والقيمة `0x40000002` تُرفض، في تذكرة الإنشاء وتذكرة `PolicySigned`. القبول لا يربط الهرمية بسياق الأمر: رد `PolicySigned` على هذه البروفة expiration=0، والرد الأصلي هرمية `0x40000007`، واستبدالها بـ`0x4000000C` أو `0x40000001` أو `0x4000000B` وصل إلى الحقل `status` = `COMPLETE`. [Part 3 r01.38](https://trustedcomputinggroup.org/wp-content/uploads/TPM-Rev-2.0-Part-3-Commands-01.38.pdf) يعيد تذكرة NULL إن كان expiration غير سالب؛ [Part 2 r01.38 §10.7.2](https://trustedcomputinggroup.org/wp-content/uploads/TPM-Rev-2.0-Part-2-Structures-01.38.pdf) يجعل هرمية تذكرة NULL هي `TPM_RH_NULL` وبصمتها فارغة. النص المنشور في ADR §12.5 يحصر الهرمية بالقيم الأربع، ولا يقول إنها تُربَط بالأمر. القياس يطابق الحصر ولا يطابق ربط السياق.

### أطوال البصمات

تذكرة الإنشاء: أطوال 1 و63 و65 و100 رُفضت `RESPONSE_TICKET_DIGEST_MALFORMED: CreatePrimary len=…` (`raw/creation-digest-*.json`). الطول 64 هو رد swtpm الذي أكمل `S2` في أوضاع الهرمية الصالحة أعلاه (لم أُعد كتابة الطول 64 صناعيًا؛ الرد الأصلي بهذا الطول قُبل ضمن تلك الأوضاع).

تذكرة `PolicySigned`: طول 65 رُفض `RESPONSE_TICKET_DIGEST_MALFORMED: len=65`. طول 1 مع الإبقاء على الوسم `0x8025` والهرمية `0x40000007`: التعديل `00008025400000070000=>00008025400000070001aa`، والحقل `status` = `COMPLETE`، `changes=1` (`raw/policy-digest-1.json`). الفحص في الشيفرة `td.Length > 64` فقط (حوالي 806). فراغ البصمة لتذكرة NULL غير مفروض. هذا لا يُعمم على تذكرة الإنشاء: تلك فُحص طولها بـ 64 في القياس أعلاه.

### حقول داخلية أخرى قيست

| الوضع | النتيجة |
| --- | --- |
| `creationhash-flip` | `RESPONSE_CREATION_HASH_MISMATCH: CreatePrimary` |
| `cd-missing` / `cd-extra` | `RESPONSE_CREATION_DATA_MALFORMED` (`tailFields=0` / `tailFields=3 tail=2`) |
| `pcr-empty` (count=0 وdigest فارغ، وأُعيد حساب creationHash) | الحقل `status` = `COMPLETE` على `S2` |
| `parentalg-ffff` | الإزاحة 39 كانت `0010`؛ بعد `ffff`: `parentNameAlg=0xffff` |
| `parentalg-sha-on-primary` | `0010` → `000b` مع إعادة البصمة: الحقل `status` = `COMPLETE` |
| `parentalg-null-on-create` | على `Create` كانت `000b` → `0010` مع إعادة البصمة: الحقل `status` = `COMPLETE` |
| `load-name-flip` | `RESPONSE_NAME_HASH_MISMATCH: Load` |
| `handle-reissued` | `RESPONSE_HANDLE_REISSUED: Load(service-key) 0x80000000 still live`؛ الكائن المحمَّل الحقيقي `0x80000001` بقي معلنًا ولم يُحرَّر بوصفه المقبض المتبنى |
| `session-wrongclass` | `RESPONSE_SESSION_HANDLE_CLASS_MALFORMED: StartAuthSession 0x800000ff`؛ الجلسة الحقيقية `0x03000000` بقيت في الجرد النهائي |
| `policy-timeout-byte` | `RESPONSE_POLICY_TIMEOUT_MALFORMED: len=1 at expiration=0` |
| `property-below` | `RESPONSE_CAPABILITY_PROPERTY_MALFORMED: 0x00000104 < 0x00000105` |
| `property-descending` | الهوية قبلت الخصائص الخمس تنازليًا (`0x109`…`0x105`) بقيم IBM المتوقعة، ثم أوقف المسبار نفسه: `PROBE_IDENTITY_ACCEPTED_DESCENDING_PROPERTIES`. لا أمر مغيّر قبل ذلك. |

`0xffff` يُرفض. `SHA-256` على Primary و`ALG_NULL` على Create يُقبلان حتى نهاية `S2`. الشيفرة تسمح بالقيمتين على الأمرين (حوالي 672–674)، ولا تربط الخوارزمية بنوع الأمر. نص ADR يقول «سائغة (ALG_NULL لـCreatePrimary أو SHA-256)»؛ القياس يطابق «إحدى القيمتين» لا الربط المذكور بين قوسين.

ترتيب الخصائص: الحد الأدنى عن قيمة الطلب مفحوص؛ الصعود الصارم غير مفحوص في هذا المسار. نص الإصلاح يقول «قيمة خاصية لا دون المطلوب»، وهو ما قيس، لا صعودًا صارمًا كالذي طُبّق على المقابض.

لم أحقن `expiration != 0` في أمر حي، فلا قياس لحد timeout ≤ 8 خارج قراءة الشيفرة.

## 3. الجرد بعد خط أساس جزئي

مسبران على 7300، مرحلة `S1`، خروج 0:

- `baseline-partial-transient` (`raw/baseline-partial-transient.json`): أول جرد عابرين بمقبض `0x01000001`. `failure` = `RESPONSE_CAPABILITY_HANDLE_CLASS_MALFORMED: 0x01000001 asked=0x80000000`. `postRunInventory.verified=false`. `postErr` = `partial baseline: run stopped during the baseline snapshot (transients/sessions baseline absent)`. `cleanupLeftovers` = `post-run inventory not comparable: partial baseline; residual state unknown`. `flushed=[]` و`nvAfter=[]` — لا أمر مغيّر قبل الفشل في هذا المسبر.
- `baseline-partial-session` (`raw/baseline-partial-session.json`): جرد العابرين حقيقي، ثم جرد الجلسات بمقبض NV. الفشل `… asked=0x02000000`. `verified=false` والنص نفسه. العبارة تقول إن خط أساس العابرين والجلسات معدوم، بينما العابرون التُقطوا ثم فشل الجلسات. المقارَن: لا جرد نهائي بقوائم فارغة وحقل `verified=true`. لم تُقارَن بقايا NV بخط أساس NV المكتمل في هذا المسار (الدالة تعود قبل المقارنة إن نقص أحد الخطين).

اختبار الحزمة: `tests/sim/tpm-ceremony-wl413-r3.test.mjs` السطر 415، الوضع `baseline-partial`. في `orphans/r3-rerun.tap`:

```
ok 32 - R3-18: … 
duration_ms: 903.023186
# tests 32
# pass 32
# fail 0
# skipped 0
```

خروج العملية 0 (`orphans/r3-rerun.exit`). هذا سطر TAP لا حكم على كل الردود. التشغيل الأول بلا `TPM2TOOLS_TCTI` طبع `# skipped 32` (`orphans/r3.tap`) لأن `isSimEnabled()` يشترط TCTI محاكٍ؛ أُعيد بالوسيط `swtpm:host=127.0.0.1,port=7300` والاختبارات تنشئ محاكياتها على منافذها. لا أعدّ التخطي الأول عائقًا في الشيفرة.

## 4. التنظيف بعد فقد الردود

فقد فعلي: النقل استلم rc=`0x00000000` ثم رمى `IOException` بلا إعادة كتابة الجسم. `raw/define-loss.json`.

- `edits` فيها `define actual responseCode=0x00000000 discarded after execution (not a malformed body)`
- `failure` = `OUTCOME_UNKNOWN: s1.probe:NV_DefineSpace (IOException: GROK_DEFINE_SUCCESS_RESPONSE_DISCARDED)`
- `undefines=[]`
- `nvAfter=["0x019b9d6b"]`
- المصالحة: `exists with definition matching this run's request; the define reply was lost or unusable so execution and ownership cannot be proven … left in place`
- البقايا: `ownership-undetermined (define reply lost; matching publicArea is not proof); left in place`

فهرس أجنبي مختلف قبل البروفة (`0x01800011`، تفويض فهرس `0x11`) ثم الفقد نفسه: `raw/define-loss-with-foreign.json`. `nvBefore=["0x01800011"]` و`nvAfter=["0x01800011","0x01b67069"]`. `undefines=[]`. المعلن هو فهرس الفقد فقط. الأجنبي بقي وليس في `undefines`.

فهرس مطابق (المنطقة العامة نفسها، تفويض `0x11`) يُزرع داخل أمر التعريف ثم يُمرَّر أمر البروفة فيُرجع `0x0000014c` ويُسقَط الرد: `raw/foreign-identical-loss.json`. `edits`: `foreign identical public planted rc=0x00000000; original define rc=0x0000014c discarded`. `undefines=[]`. الفهرس `0x01a15370` بقي وأُعلن غير محسوم.

بروفة `ALL` بلا حقن بعد زرع `0x01800011`: `raw/foreign-survive.json`. الحقل `status` = `COMPLETE`. `nvBefore` و`nvAfter` كلاهما `["0x01800011"]`. قائمة `undefines` ثلاث مقابض أخرى، ليس `0x01800011`. `cleanupLeftovers` فارغ. الفراغ هنا فرق عن خط الأساس، لا حذف الأجنبي.

`create-loss` (`raw/create-loss.json`): رد `Create` rc=`0` أُسقط بعد التنفيذ. المصالحة المطبوعة:

`object-create: no new handle since baseline (execution undetermined from handle inventory; Create returns no object handle and a created object may have been flushed by another party)`

ليست `likely not executed`. انظر البند 6.

## 5. عمليات swtpm

الأمر الذي يُحتسب:

```
XUUX_TPM_SIM=1 TPM2TOOLS_TCTI=swtpm:host=127.0.0.1,port=7300 \
  node --test --test-concurrency=1 tests/sim/tpm-ceremony-wl413-r3.test.mjs
```

من شجرة المراجعة. الخروج 0. TAP: `# tests 32` `# pass 32` `# fail 0` `# skipped 0` `# duration_ms 33249.183569`. لا سطر `not ok`. الملف يضم مسارات فشل الحقن (R3-01…R3-18 تتوقع `FAILED_CLOSED`) و`stopSim` يرسل `SIGTERM` ثم يحذف المجلد (`tpm-ceremony-wl413-r3.test.mjs` حوالي 62–66). لا انتظار ولا `SIGKILL` في الدالة.

لقطة `ps` لأسطر `swtpm socket` فقط، فور كتابة ملف الخروج، بلا قتل لاحق مني:

- قبل: pid 10834 على 2321 (`orphans/before-rerun.txt`)
- بعد: pid 10834 فقط (`orphans/after-rerun-immediate.txt`)

لا عملية `xuux-wl413r3-*` في اللقطة اللاحقة. لم أُوقف 10834.

`rehearse.ps1` لا يطلق `swtpm`؛ يتصل بمستمع قائم. بروفة `clean` على 7300 لم تُنشئ عملية ثانية: لقطات `raw/*.swtpm-after-immediate.txt` أثناء تداخل الاختبارات تظهر محاكيات الاختبار الحية (`/tmp/xuux-wl413r3-*`) ومحاكي دليلي على 7300. تلك اللقطات ليست عدّ اليتامى؛ العد هو لقطة ما بعد خروج `node`. بعد `kill` لمحاكي دليلي في نهاية المشغّل بقيت 10834 فقط.

لم أقس `swtpm` يتجاهل `SIGTERM`. لم أُعد ملف الاختبارات الخمس معًا على هذا الرأس.

## 6. النصوص مقابل القياس

ما طابق القياس في هذه الجولة، في الحدود المذكورة:

- ADR §12.5 / README حوالي 60–68: لا حذف بعد فقد رد التعريف ولو طابقت المنطقة؛ النص المقيس في البند 4 هو نص الشيفرة.
- ربط ملف التفويض بالاتجاهين، ورفض `0x40000002`، وقبول القيم الأربع، وطول بصمة الإنشاء 64، وفراغ timeout عند expiration=0، و`RESPONSE_HANDLE_REISSUED`، وفئة الجلسة، و`partial baseline` مع `verified=false`، وقبول `pcrDigest` الفارغ عند count=0.
- مصالحة `Create` لم تعد `likely not executed` في المسبر `create-loss`.

ما لم يطابق، أو هو أوسع من القياس:

- `docs/roadmap/05-work-log.md` السطر 33 ما زال يقتبس `object-create: no new handle since baseline (likely not executed)` بوصفه نص الجرد الحالي لـSOL413-06. المسبر على هذا الرأس طبع الجملة الأطول عن «execution undetermined» و«Create returns no object handle».
- `PROJECT_STATUS.md` السطر 1 و`docs/roadmap/05-work-log.md` حوالي 15: `npm run validate` (2848/2593/0/255) و`tpm-sim-ci` (175/173/0/2). ملف الدليل المرفق في الشجرة `docs/external-review/reports/adr0007-ceremony-wl413-r3-remediation-review/evidence/fix-batch-d9e1dc3b/validate.log` يختم بـ `# tests 2858` `# pass 2593` `# fail 0` `# skipped 265` و`exit=0`. `tpm-sim-ci.log` يختم بـ `# tests 185` `# pass 183` `# fail 0` `# skipped 2`. رسالة `d9e1dc3b` تذكر 2858/2593/0/265 و185/183/0/2. لم أُعد `npm run validate` ولا `tpm-sim-ci` على هذا الرأس؛ المقيس هنا تعارض النصوص مع ملف الدليل المتعقَّب، لا إعادة للعددين.
- العددان 72/72 و`R3-12..R3-17` في `PROJECT_STATUS` وADR §12.5 لا يذكران `R3-18`. ملف الاختبار على هذا الرأس فيه R3-18، وTAP هذه الجولة `# tests 32` `# pass 32` لملف R3 وحده. لم أُعد مجموعة المراسم الكاملة.
- `sim/tpm-ceremony/README.md` السطر 42: «تشويهٍ ⇒ فشل مغلق مسمى». المسبر `policy-digest-1` ومسابر الإخفاء بـ`more=0` و`parentalg-sha-on-primary` و`property-descending` تشويهات قُبلت حتى الحقل `status` = `COMPLETE` أو حتى تبني المقبض. العبارة أوسع من هذه القياسات. لا أعمم القبول على كل الحقول: قلب بصمة الإنشاء واسم Load وtimeout غير الفارغ عند expiration=0 رُفضت في البند 2.

## 7. حاجز القوالب وقائمة السماح

`git diff d9e1dc3b^ HEAD -- docs/audit/template-allowlist.txt`: سطر فارغ في نهاية الملف فقط (`allowlist/allowlist-since-parent.diff`). لا مسار استثناء جديد في الرأس.

بين `d9e1dc3b` و`HEAD`: `0ba77606` أضاف ثلاثة مسارات لملفات فارغة من مسابر gpt_6_1_sol، و`673c8c88` حذف الأسطر الثلاثة. الأثر الصافي ليس توسيعًا قائمًا. `3e67d362` لا يمس القائمة (اختبار فقط).

`node scripts/guard-templates.mjs` من الشجرة، الخروج 0 (`allowlist/guard-templates.txt`): ملفات مفحوصة 2526، استثناءات معلنة ومطابقة 109، مداخل إذن متروكة 0، مخالفات 0، والنص «لا ملفات قالبية فارغة في المستودع». `find` للملفات الفارغة تحت حزمة الجولة الثالثة لم يطبع مسارًا (`allowlist/empty-files.txt`).

## ما لم يُقس

- `npm run validate` ومجموعة المراسم الخمس و`scripts/tpm-sim-ci.sh` على `3e67d362`. أرقام 2858 و185 أعلاه من ملف دليل متعقَّب لدفعة `d9e1dc3b`، لا من تشغيل هذه الجولة.
- عتاد، TBS، `/dev/tpm*`، انقطاع طاقة، سعة عدادات حتى `NO_COUNTER_HEADROOM`.
- `expiration != 0` وحد timeout الحي.
- `swtpm` لا يموت بـ`SIGTERM`.
- إعادة إنتاج العوائق على `8b48a568` أو `de099aa8` في هذه الجولة؛ الشجرة مثبتة على `3e67d362`.
- منفذ تحكم على `0.0.0.0` أو ثنائي باسم `swtpm` بملف تنفيذ مختلف — خارج منافذ 7300/7301، ولم يُطلب في بنود الأولوية السبعة.
- `R3-A-01` و`EXT-6` لم يُمسا، وهما مفتوحان في النصوص كما هما.

## إعادة الإنتاج

```
cd /tmp/wl414-followup/reviewers/grok_4_7/repo
# الرأس 3e67d362dc4f30ec35f73957fd5542be47a3a875
mcs -langversion:5 -out:../probes/GrokFollowup.exe \
  sim/tpm-ceremony/TpmCeremonyCore.cs ../probes/GrokFollowup.cs
# لكل وضع: swtpm على 127.0.0.1:7300 والتحكم 7301، حالة تحت دليل المراجع فقط
mono ../probes/GrokFollowup.exe omit-more0-alias 7300
mono ../probes/GrokFollowup.exe r3sol01-full 7300
mono ../probes/GrokFollowup.exe define-loss 7300
XUUX_TPM_SIM=1 TPM2TOOLS_TCTI=swtpm:host=127.0.0.1,port=7300 \
  node --test --test-concurrency=1 tests/sim/tpm-ceremony-wl413-r3.test.mjs
```

المنافذ العشوائية للاختبارات (2700–2998 في هذا الملف) قد تتصادم مع مشغّل آخر؛ هذه الإعادة خرجت 0 من المحاولة الثانية. لا تُقتل عملية 2321 ولا أي `swtpm` لا يحتوي مساره `grok_4_7/swtpm-state`.
