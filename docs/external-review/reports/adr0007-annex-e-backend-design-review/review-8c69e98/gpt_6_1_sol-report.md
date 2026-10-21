# تقرير مراجعة WL-437 (الملحق هـ، الجولة 3): gpt_6_1_sol (OPENAI)

## الكوميت + زمن البدء/الانتهاء

- **الكوميت محل الحكم، ناتج `git rev-parse HEAD` حرفيًا:** [سجل الرأس والحالة](file:///tmp/council-wl437-r3/gpt_6_1_sol/head-and-state.log).

```text
8c69e98dd45f9129698fd2027f00eed20885e748
```

- **الشجرة:** `/tmp/wt-8c69e98-gpt`؛ **المرجع المطلوب:** `wl-437-production-backend-design`، ‏PR #391، وفق [كراسة التفويض](file:///tmp/council-wl437-r3/delegation-brief-8c69e98.md).
- **زمن التشغيل (UTC):** من `2026-10-21T07:32:38Z`، أول توقيت محفوظ أثناء الفحص، إلى `2026-10-21T07:51:03Z`، فحص التسليم الموثق؛ أي 18 دقيقة و25 ثانية، ويقابله `10:32:38–10:51:03` بتوقيت الرياض، وفق [التوقيت الأول](file:///tmp/council-wl437-r3/gpt_6_1_sol/initial-time.log) و[فحص التسليم النهائي](file:///tmp/council-wl437-r3/gpt_6_1_sol/final-check.log).
- قرأت الكراسة كاملة أولًا، والملحق هـ كاملًا، وتقريريّ الشخصيين للجولتين السابقتين؛ لم أفتح التقرير الخام للعضو الآخر، ولم أتخذ جدول ادعاءات §13/§14 دليل إغلاق، وهذه هي [المادة الرئيسة](file:///tmp/wt-8c69e98-gpt/docs/adr/0007-annex-e-production-backend-design.md) و[تقريري الأول](file:///tmp/wt-8c69e98-gpt/docs/external-review/reports/adr0007-annex-e-backend-design-review/review-d3d5e1f9/gpt_6_1_sol-report.md) و[تقريري الثاني](file:///tmp/wt-8c69e98-gpt/docs/external-review/reports/adr0007-annex-e-backend-design-review/review-992230c/gpt_6_1_sol-report.md).
- **نطاق السؤال:** البنود الستة الثابتة في الكراسة، وحالة ملاحظاتي `WL437-gpt_6_1_sol-01..06` و`WL437-gpt_6_1_sol-R2-NN` على هذا الرأس؛ و`holds` حكم على كفاية التصميم المكتوب ودقة ادعاءاته ضمن موضوع البند، لا إثبات تنفيذ أو قياس عتادي، وفق [تعريف الحكم والنطاق في التكليف:16–41](file:///tmp/council-wl437-r3/delegation-brief-8c69e98.md#L16).

## البند 1: الحكم holds — صلاحية الإذن الموقّع وإعادة استخدامه

الإذن عقد معياري لا مثال: ظرف JSON مغلق، وJCS، وتوقيع Ed25519 على `"xuux.fnv-ceremony-authorization/1" ‖ 0x00 ‖ JCS(payload)`، وتثبيت `keyId` والخوارزمية والترميز، ومخططان للعملتين لا يجيزان حقولًا زائدة أو ناقصة، وفق [هـ §6.3:298–340](file:///tmp/wt-8c69e98-gpt/docs/adr/0007-annex-e-production-backend-design.md#L298).

كلا النوعين يربط العملية والتثبيت والجهاز والتحدي والصلاحية، ونوع الربط يثبت بصمة بايتات `manifestFnvBindingBytes` ومقبضي الهدف وبصمة إذن التهيئة المستهلك؛ وتشمل البايتات القائمة المخطط و`instanceId` والمقبضين والاسمين و`base` ونوع الهوية وقيمتها والسياستين، وفق [هـ §6.3:316–343](file:///tmp/wt-8c69e98-gpt/docs/adr/0007-annex-e-production-backend-design.md#L316) و[fnv-binding.mts:160–176](file:///tmp/wt-8c69e98-gpt/src/root-of-trust/fnv-binding.mts#L160).

يتعين أن يطابق التحدي تحديًا نشطًا واحدًا لكل تثبيت ونوع، ويُلغى السابق قبل بدء مراسم جديدة، ويُرفض المستهلك؛ و`notAfter` له شكل UTC محدد، مع إقرار أن ساعة المضيف حد ضعيف وأن منع الإعادة يعتمد على التحدي والاستهلاك لا الساعة وحدها، وفق [هـ §6.3:324–364](file:///tmp/wt-8c69e98-gpt/docs/adr/0007-annex-e-production-backend-design.md#L324).

هذا حكم على صياغة الإذن ونطاقه بشرط مصدر هوية صحيح، لا حكم على اكتمال تمهيد المصدر؛ مصدر الهوية نفسه له الملاحظتان `R3-01` و`R3-04` أدناه، كما أن [بوابة الربط الحالية:635–669](file:///tmp/wt-8c69e98-gpt/src/root-of-trust/state-manifest.mts#L635) ما زالت تعتمد إعلان البيئة، وقد أكد ذلك [مجس الرأس الحالي](file:///tmp/council-wl437-r3/gpt_6_1_sol/current-code-probes.log).

## البند 2: الحكم holds — الاستهلاك الذري لـnonce وحالات الانقطاع

يلزم §6.3 الفحص والاستهلاك داخل `#sealSerialized`، تحت قفل الدفتر ومقابل المتن الحالي على القرص، مع رفض ربط ثان حتى إن تطابقت مادته؛ ويُكتب `freshnessBinding` و`consumedAuthorizations` في متن ختم واحد، وتبقى بيانات الاستهلاك في كل ختم لاحق، وفق [هـ §6.3:350–356](file:///tmp/wt-8c69e98-gpt/docs/adr/0007-annex-e-production-backend-design.md#L350).

هذا قابل للبناء فوق آلية الختم الموجودة: تأخذ قفل الدفتر وتلغي الذاكرة المخبأة وتعيد قراءة البيان قبل mutation، ثم تنشر الملف بكتابة مؤقتة و`rename` ومزامنة مشروطة بإعداد `fsync`؛ أما فحص عدم وجود ربط الحالي فيسبق السلسلة، فيظل نقله للداخل تغييرًا مطلوبًا لا حقيقة منجزة، وفق [state-manifest.mts:317–332 و705–766](file:///tmp/wt-8c69e98-gpt/src/root-of-trust/state-manifest.mts#L317) و[bindFnvAsync:648–670](file:///tmp/wt-8c69e98-gpt/src/root-of-trust/state-manifest.mts#L648).

ولنوع `provision-define-init` الذي لا ختم فيه، يوجد سجل دائم في دفتر المراسم يكتب ويزامن قبل أول `NV_DefineSpace`؛ والتوقف قبل السجل يسمح بالإذن نفسه ما دام التحدي نشطًا، وبعد كتابته يمنع إعادة التعريف التلقائية وإعادة الإذن حتى إن لم يُرسل الأمر، وفق [هـ §6.3:357–362](file:///tmp/wt-8c69e98-gpt/docs/adr/0007-annex-e-production-backend-design.md#L357).

بين الخطوتين 4 و5 لا ختم ولا استهلاك، لكن بعد نشر الختم يتحدد التصرف من المتن المنشور لا من غياب الإقرار؛ أضيفت `bindingBytesSha256` إلى سجل الاستهلاك نفسه، وأصبح استكمال فجوة الختم/المنسق أمر مراسم منفصلًا يتحقق منها ويستدعي `coordinator.bindAsync` وحده دون ربط جديد أو إذن جديد، وفق [هـ §6.3:351 و380–387](file:///tmp/wt-8c69e98-gpt/docs/adr/0007-annex-e-production-backend-design.md#L351) و[هـ §6.2:291](file:///tmp/wt-8c69e98-gpt/docs/adr/0007-annex-e-production-backend-design.md#L291).

**حد الحكم:** لا تنفيذ لهذه الإضافات بعد؛ أعادت المجسات قبول نداءين متطابقين وقبول `base=4` و`base=9` بكائنين، ثم `IMMUTABLE` بعد حقن توقف بين ختم الربط والمنسق؛ وهي تعيد عيوب الشيفرة المعروفة التي يصف النص علاجها صراحة، ولا تنقض كفاية وصف العلاج، وفق [نتائج الرأس الحالي](file:///tmp/council-wl437-r3/gpt_6_1_sol/current-code-probes.log) و[الفجوة الحالية:452–457](file:///tmp/wt-8c69e98-gpt/src/root-of-trust/production-runtime.mts#L452).

## البند 3: الحكم holds — نافذة TOCTOU

يرتب النص أخذ قفل السلطة قبل قراءة الهوية والأسماء و`C/R`، ثم حساب المادة والتحقق من الإذن، ثم إعادة قراءة الاسمين وقيمة `C` وبصمة بايتات `R` في الجلسة المملحة نفسها مباشرة قبل الختم؛ ويوقف أي اختلاف ويعيد الخطوات 2–4 كاملة إن تغيرت الجلسة، وفق [هـ §6.3:366–375](file:///tmp/wt-8c69e98-gpt/docs/adr/0007-annex-e-production-backend-design.md#L366).

وتشمل السلطة المقترحة تجهيز البيان وترقيته وكل قراءة ينتج عنها قرار كتابة، لا `advanceState` وحده؛ ويصل نطاقها من أول أمر TPM إلى آخر كتابة بيان، وفق [هـ §7.3:447–453](file:///tmp/wt-8c69e98-gpt/docs/adr/0007-annex-e-production-backend-design.md#L447).

بين المراسم والإقلاع اللاحق يُطلب تحقق جديد وقراءات حية، ويكشف المسار تغير الأسماء أو الهوية بـ`MISMATCH` وزيادة `C` بـ`STALE_MANIFEST_EPOCH`، مع اعتراف بأن القفل لا يمنع كاتبًا خارجيًا وأن فحص +1 جزئي وأن T6 غير محلول، وفق [هـ §3.2:58–70](file:///tmp/wt-8c69e98-gpt/docs/adr/0007-annex-e-production-backend-design.md#L58) و[هـ §6.3:376–380](file:///tmp/wt-8c69e98-gpt/docs/adr/0007-annex-e-production-backend-design.md#L376) و[هـ §7.2:425–433](file:///tmp/wt-8c69e98-gpt/docs/adr/0007-annex-e-production-backend-design.md#L425).

المقارنة البرمجية القائمة للربط والعهد تؤيد ضرورة هذين المسارين، لكنها لا تنشئ قفلًا عامًا بنفسها؛ والحكم هنا لإغلاق النافذة داخل السلطة المعلنة لا لضمان ضد مالك TPM خارج النموذج، وفق [production-runtime.mts:369–380 و471–476](file:///tmp/wt-8c69e98-gpt/src/root-of-trust/production-runtime.mts#L369) و[حد السلطة في هـ §7.3:467](file:///tmp/wt-8c69e98-gpt/docs/adr/0007-annex-e-production-backend-design.md#L467).

**حد الحكم:** يلزم تصحيح قابلية إنشاء المصدر الحي كما في `R3-01` و`R3-04`؛ لا أعدّ ذلك دليل قبول قراءة قديمة بين الفحص والختم، بل تعارضًا مستقلًا في مصدر البيانات وتسلسل الأوامر، وفق [هـ §3.2:68](file:///tmp/wt-8c69e98-gpt/docs/adr/0007-annex-e-production-backend-design.md#L68) و[صف NV_Read:161](file:///tmp/wt-8c69e98-gpt/docs/adr/0007-annex-e-production-backend-design.md#L161).

## البند 4: الحكم holds — نطاق القفل والسلطة الواحدة والتعارض

مفتاح القفل المقترح هو `instanceId`، لا مقبض العدّاد ولا مسار يمرره المستدعي؛ ويحدد النص مسار Linux وصلاحيات الدليل `0700` والملف `0600` و`O_CLOEXEC`، وكائن Windows العام وDACL، ومهلة 30 ثانية لا تنتزع القفل، وفق [هـ §7.3:454–458](file:///tmp/wt-8c69e98-gpt/docs/adr/0007-annex-e-production-backend-design.md#L454).

التغطية تشمل `advanceState` والمراسم كلها و`bindFnvAsync` مع المنسق وS4/S5 والقراءات التي ينتج عنها قرار كتابة؛ وأضيف أن `bindFnvAsync` يرفض العمل دون سلطة القفل، وأن سلسلة الختم تكون لكل ملف لا لكل كائن فقط، وفق [هـ §7.3، الأسطر 447–453](file:///tmp/wt-8c69e98-gpt/docs/adr/0007-annex-e-production-backend-design.md#L447) و[هـ §6.3، السطر 351](file:///tmp/wt-8c69e98-gpt/docs/adr/0007-annex-e-production-backend-design.md#L351).

كما يفرض التصميم ترتيب أخذ قفل السلطة قبل قفل دفتر البيان، ويقر بأن برامج لا تخضع للسلطة أو مالك تفويض TPM يمكنها تعديل الجهاز خارجها؛ فلا ينسب القفل إلى ذرية يوفرها TPM، وفق [هـ §7.3، الأسطر 456–462](file:///tmp/wt-8c69e98-gpt/docs/adr/0007-annex-e-production-backend-design.md#L456).

يحرر النظام القفل عند موت المالك، وتؤدي `WAIT_ABANDONED` أو الوفاة لإسقاط الجلسات وإعادة التحقق قبل التغيير؛ ويمنع التصميم تعدد المضيفين والحاويات المشتركة ومسار WSL/TBS المنقسم، مع إقرار أنه لا يكشف كل مسار بديل آليًا، وفق [هـ §7.3:459–467](file:///tmp/wt-8c69e98-gpt/docs/adr/0007-annex-e-production-backend-design.md#L459).

**حد الحكم:** الواقع الحالي ثلاثة نطاقات مختلفة: سلسلة `CommitCoordinator` لكل كائن، وقفل البيان لختمه، وقفل المجس حول `advanceState` وحده مع كشف PID ميت ومهلة؛ وهذه لا تُقدَّم كسلطة إنتاجية مكتملة، وفق [commit-barrier.mts:412–430](file:///tmp/wt-8c69e98-gpt/src/root-of-trust/commit-barrier.mts#L412) و[state-manifest.mts:705–715 و835–854](file:///tmp/wt-8c69e98-gpt/src/root-of-trust/state-manifest.mts#L705) و[nv-state-bound-socket.mjs:383–424](file:///tmp/wt-8c69e98-gpt/sim/freshness-nv/nv-state-bound-socket.mjs#L383).

## البند 5: الحكم open — تحليل ردود TPM الناجحة وردود الأخطاء

أُصلحت ملاحظتي `R2-01`: قواعد سمات الرد منفصلة عن سمات الطلب، ويجيز النص انتقال أول تدقيق 0x81→0x83، ويحسب HMAC على بايت سمات الرد المستلم بعد التحقق من قانونيته، وفق [هـ §4.4:189](file:///tmp/wt-8c69e98-gpt/docs/adr/0007-annex-e-production-backend-design.md#L189).

ونمط الخطأ ذي العشرة بايتات الخالي من الجلسات، وملف رد `TPM_RS_PW` ذي nonce وHMAC الفارغين و`continueSession=1`، وفصل ذلك عن HMAC الجلسات المملحة، محددة على نحو يزيل الاعتراض الأصلي على هذين الشكلين؛ وقناع TBS يشمل كامل عائلة `0x8028xxxx` ولا يسمح بإعادة بايتات أمر مغيّر، وفق [هـ §4.4، الأسطر 178–201](file:///tmp/wt-8c69e98-gpt/docs/adr/0007-annex-e-production-backend-design.md#L178) و[TCG Part 3 §6.1](https://cdn.trustedcomputinggroup.org/production/TCG_TPM_2_r1p59_Part3_Commands_pub_00016d87e3.pdf) و[شكل كلمة السر الحالي في البروفة](file:///tmp/wt-8c69e98-gpt/sim/tpm-ceremony/TpmCeremonyCore.cs#L491).

لكن الشكل ن1 حُصر الآن في القراءات قبل فتح الجلسة، فيما تلزم المصفوفة نفسها `StartAuthSession` و`LoadExternal` و`PolicySigned` و`FlushContext` بالعمل بلا جلسات، وتجيز ذلك لـ`PolicyCommandCode` لأن جلسة السلامة فيه اختيارية؛ ولا يوجد شكل نجاح آخر يقبل تلك الردود الصحيحة بلا جلسات، وفق [هـ §4.3، الأسطر 164–172](file:///tmp/wt-8c69e98-gpt/docs/adr/0007-annex-e-production-backend-design.md#L164) و[هـ §4.4، الأسطر 182–190](file:///tmp/wt-8c69e98-gpt/docs/adr/0007-annex-e-production-backend-design.md#L182).

ويشترط ن3 إثبات حذف الفهرس بقراءة `NV_ReadPublic` لاحقة تطابق منطقته العامة، مع أن الفهرس المحذوف لا يملك منطقة عامة ليعيدها؛ والخطأ الناتج لا يحمل HMAC وفق النموذج نفسه، فيتعذر إتمام طور تنظيف ناجح كما كُتب، وفق [هـ §4.4، السطر 190](file:///tmp/wt-8c69e98-gpt/docs/adr/0007-annex-e-production-backend-design.md#L190) و[TCG Part 3 §5.3 و§31.4 و§31.6](https://cdn.trustedcomputinggroup.org/production/TCG_TPM_2_r1p59_Part3_Commands_pub_00016d87e3.pdf).

**سبب بقاء البند مفتوحًا:** هذه تعارضات قبول للأوامر والردود المقصودة ذاتها، إضافة إلى دائرة EK الموضحة في البند 6؛ وتفصيلها في `R3-01` و`R3-02` و`R3-03`، مع تصحيح صغير لتعريف NULL ticket في `R3-05`، بناء على [مقاطع wire المحفوظة](file:///tmp/council-wl437-r3/gpt_6_1_sol/design-evidence.log) و[مقتطفات TCG](file:///tmp/council-wl437-r3/gpt_6_1_sol/tcg-part3-focused-excerpts.txt).

## البند 6: الحكم open — قيود معاملات كل أمر مسموح

راجعت الصفوف كلها: `GetCapability` وصفحاته، و`NV_ReadPublic`، و`NV_Read` بأحجامه، و`ReadPublic/CreatePrimary`، و`StartAuthSession`، و`LoadExternal`، و`PolicySigned/PolicyCommandCode`، والزيادة والكتابة والتعريف والحذف و`FlushContext`؛ ومعظمها صار ذا مقابض وأدوار ومعاملات وأشكال جلسات محددة، وفق [هـ §4.3:157–172](file:///tmp/wt-8c69e98-gpt/docs/adr/0007-annex-e-production-backend-design.md#L157).

عولج استثناء أهداف P1–P4 من الإذن المستهلك والدفتر قبل وجود الربط، واستمرار صفحات `GetCapability` من آخر مقبض +1 مع منع الجرد الناقص، وفراغ `inPrivate` وهرم NULL، وقيد ملكية الموارد في `FlushContext`، و`expiration=+60` ومنع `PolicyTicket`، وفق [هـ §4.3:159–172](file:///tmp/wt-8c69e98-gpt/docs/adr/0007-annex-e-production-backend-design.md#L159).

لكن صف `NV_Read` يضع قراءة شهادة EK وnonce داخل الجلسة المملحة، مع أن nonce لازم لإنشاء EK الذي يحتاجه `StartAuthSession`؛ وصف `NV_ReadPublic` لا يجيز فهارس nonce في التشغيل العادي، وتعريف NULL ticket نفسه غير صحيح، وفق [هـ §4.3:160–166](file:///tmp/wt-8c69e98-gpt/docs/adr/0007-annex-e-production-backend-design.md#L160) و[ملف TCG لقالب EK](https://trustedcomputinggroup.org/wp-content/uploads/TCG-EK-Credential-Profile-V-2.5-R2_published.pdf) و[TCG Part 2 §10.7.2](https://trustedcomputinggroup.org/wp-content/uploads/TCG_TPM2_r1p59_Part2_Structures_pub.pdf).

وفوق ذلك يسند §3.2 حساب بصمة الشهادة الحية إلى `NV_ReadPublic` رغم أن الأمر لا يعيد بيانات DER؛ لذلك يبقى مصدر حقل الهوية نفسه غير قابل للحساب كما كُتب، وفق [هـ §3.2:68](file:///tmp/wt-8c69e98-gpt/docs/adr/0007-annex-e-production-backend-design.md#L68) و[TCG Part 3 §31.6، الجدول 219](https://cdn.trustedcomputinggroup.org/production/TCG_TPM_2_r1p59_Part3_Commands_pub_00016d87e3.pdf).

**سبب بقاء البند مفتوحًا:** الملاحظات `R3-01` و`R3-04` و`R3-05` أخطاء في قيود المصدر والأوامر وقابلية تشغيلها، لا مجرد غياب تنفيذ؛ وتبقى G1–G4 و`EXT-6` و`R3-A-01` خارج الإغلاق، والقائمة الإنتاجية فارغة، وفق [قيود المصفوفة](file:///tmp/wt-8c69e98-gpt/docs/adr/0007-annex-e-production-backend-design.md#L157) و[قائمة الإنتاج الفعلية:51–56](file:///tmp/wt-8c69e98-gpt/scripts/production-entry.mjs#L51) و[هـ §12:525–537](file:///tmp/wt-8c69e98-gpt/docs/adr/0007-annex-e-production-backend-design.md#L525).

## حالة ملاحظاتي السابقة: addressed | partially | not-addressed + الدليل

المقصود بالحالة التالية معالجة **ملاحظة التصميم المحددة** على هذا الرأس، لا وصول التوصية إلى التنفيذ؛ وتظل حقيقة أن الشيفرة لم تتغير مثبتة في [مقارنة الرأسين](file:///tmp/council-wl437-r3/gpt_6_1_sol/head-and-state.log).

### الجولة الأولى

| المعرّف | الحكم | النص الحالي والدليل من الشيفرة |
| --- | --- | --- |
| `WL437-gpt_6_1_sol-01` | **addressed** | حوّل [هـ §6.3:300–340](file:///tmp/wt-8c69e98-gpt/docs/adr/0007-annex-e-production-backend-design.md#L300) الإذن إلى بروتوكول معياري ذي ترميز وتوقيع وعمليات محددة وتحدٍّ نشط؛ أما [bindFnvAsync:635–669](file:///tmp/wt-8c69e98-gpt/src/root-of-trust/state-manifest.mts#L635) فيثبت أن الموجود ما زال إعلان بيئة لا ذلك البروتوكول، وقد ربط المجس فعلًا بلا وثيقة مالك في [سجل القياس](file:///tmp/council-wl437-r3/gpt_6_1_sol/current-code-probes.log). |
| `WL437-gpt_6_1_sol-02` | **addressed** | عرّف [هـ §7.3:444–469](file:///tmp/wt-8c69e98-gpt/docs/adr/0007-annex-e-production-backend-design.md#L444) نطاق قفل واحدًا مستقلًا عن جذر التطبيق، وشمل الكاتب والبيان والمنسق، وألزم رافضًا داخل `bindFnvAsync`؛ بينما تظل [سلسلة المنسق:412–430](file:///tmp/wt-8c69e98-gpt/src/root-of-trust/commit-barrier.mts#L412) لكل كائن، و[قفل المجس:391–424](file:///tmp/wt-8c69e98-gpt/sim/freshness-nv/nv-state-bound-socket.mjs#L391) حول الانتقال وحده؛ وأظهر [مجس الكائنين](file:///tmp/council-wl437-r3/gpt_6_1_sol/current-code-probes.log) أن العلاج ليس واقعًا تنفيذيًا بعد. |
| `WL437-gpt_6_1_sol-03` | **addressed** | ألزم [هـ §6.3:345–353](file:///tmp/wt-8c69e98-gpt/docs/adr/0007-annex-e-production-backend-design.md#L345) إعادة القراءة وفحص عدم الاستهلاك داخل التسلسل، وضم سجل الاستهلاك والربط في متن واحد، مع سلسلة لكل ملف؛ وهذا يعالج قبول النداء المتطابق الذي ما زال [فحصه الحالي خارج #sealWith](file:///tmp/wt-8c69e98-gpt/src/root-of-trust/state-manifest.mts#L648) وتعيده [مجسات الرأس](file:///tmp/council-wl437-r3/gpt_6_1_sol/current-code-probes.log). |
| `WL437-gpt_6_1_sol-04` | **addressed** | حدّد [هـ §6.3:382–387](file:///tmp/wt-8c69e98-gpt/docs/adr/0007-annex-e-production-backend-design.md#L382) استكمالًا داخل أمر مراسم مستقل، مع البصمة المحفوظة، دون `bindFnvAsync` جديد أو إذن جديد؛ ويبقى [الاستدعاءان الحاليان المنفصلان:455–457](file:///tmp/wt-8c69e98-gpt/src/root-of-trust/production-runtime.mts#L455) سبب إعادة `IMMUTABLE` في [حقن التوقف الحالي](file:///tmp/council-wl437-r3/gpt_6_1_sol/current-code-probes.log)، فلا أخلط علاج التصميم بعلاج الشيفرة. |
| `WL437-gpt_6_1_sol-05` | **partially** | صُحّح فصل ملف كلمة السر عن HMAC المملح، ونطاق `LoadExternal` و`FlushContext`، وصفحات الجرد وأهداف التهيئة في [هـ §4.3–§4.4:159–190](file:///tmp/wt-8c69e98-gpt/docs/adr/0007-annex-e-production-backend-design.md#L159)، وتؤيد [شيفرة البروفة:491–507](file:///tmp/wt-8c69e98-gpt/sim/tpm-ceremony/TpmCeremonyCore.cs#L491) واقعة ملف كلمة السر؛ لكن عقد الأوامر/الردود المقصودة لا يزال يرفض مسارات صحيحة في `R3-01..03`، لذلك لا أسقط اعتراض اكتمال ملفات الأوامر كله. |
| `WL437-gpt_6_1_sol-06` | **addressed** | يطلب [هـ §3.2:52–66](file:///tmp/wt-8c69e98-gpt/docs/adr/0007-annex-e-production-backend-design.md#L52) مساواة نوع المفتاح ومعاملاته مع `SubjectPublicKeyInfo` واستعمال المقبض نفسه في `StartAuthSession`، ويؤكد [صف StartAuthSession:164](file:///tmp/wt-8c69e98-gpt/docs/adr/0007-annex-e-production-backend-design.md#L164) ذلك؛ أما [مطابقة المصدر الحالية:369–380](file:///tmp/wt-8c69e98-gpt/src/root-of-trust/production-runtime.mts#L369) فليست دليل ملكية المفتاح الخاص، وقد وصف النص المقارنة الجديدة توصية؛ ودائرة التمهيد الجديدة ملاحظة مستقلة لا غياب شرط المساواة نفسه. |

### الجولة الثانية — بما فيها R2-05 الموجودة فعلًا في تقريري الخام

| المعرّف | الحكم | النص الحالي والدليل من الشيفرة |
| --- | --- | --- |
| `WL437-gpt_6_1_sol-R2-01` | **addressed** | ينص [هـ §4.4:189](file:///tmp/wt-8c69e98-gpt/docs/adr/0007-annex-e-production-backend-design.md#L189) صراحة على 0x81→0x83 وقواعد سمات الرد واستعمال بايت الرد داخل HMAC؛ وهو يتجنب مقارنة الصدى التي كشفها [شاهدي السابق](file:///tmp/wt-8c69e98-gpt/docs/external-review/reports/adr0007-annex-e-backend-design-review/review-992230c/gpt_6_1_sol-artifacts/audit-response-witness.json)، مع بقاء [المحلل الحالي غير المملح:503–507](file:///tmp/wt-8c69e98-gpt/sim/tpm-ceremony/TpmCeremonyCore.cs#L503) منفصلًا عن المنفذ المقترح. |
| `WL437-gpt_6_1_sol-R2-02` | **addressed** | أضاف [هـ §4.3:161 و168–169](file:///tmp/wt-8c69e98-gpt/docs/adr/0007-annex-e-production-backend-design.md#L161) المقبضين من إذن `provision-define-init` المستهلك والدفتر قبل وجود الربط؛ وهذا يطابق ترتيب الواقع النموذجي الذي يأخذ فيه [provision:321–339](file:///tmp/wt-8c69e98-gpt/sim/freshness-nv/nv-state-bound-socket.mjs#L321) `base` ويكتب `R` قبل ختم الربط؛ وبوابة الإنتاج المطلوبة ما زالت غير منفذة. |
| `WL437-gpt_6_1_sol-R2-03` | **addressed** | صار [هـ §4.3:159](file:///tmp/wt-8c69e98-gpt/docs/adr/0007-annex-e-production-backend-design.md#L159) يجيز المتابعة من آخر مقبض +1 تحت السلطة مع تقدم صارم وحدود ورفض الجرد الناقص؛ وهو يتسق مع ضرورة التتابع الظاهرة في [TpmInventoryCore.cs:489–510](file:///tmp/wt-8c69e98-gpt/sim/tpm-host/TpmInventoryCore.cs#L489)، بدل حصر كل صفحة في property البداية. |
| `WL437-gpt_6_1_sol-R2-04` | **addressed** | أضاف [هـ §6.3:351–355](file:///tmp/wt-8c69e98-gpt/docs/adr/0007-annex-e-production-backend-design.md#L351) `bindingBytesSha256` صراحة إلى سجل الاستهلاك، وأوجب حفظ السجل في كل ختم لاحق، ويقرأه [مسار الاستكمال:385](file:///tmp/wt-8c69e98-gpt/docs/adr/0007-annex-e-production-backend-design.md#L385)؛ ويميز ذلك عن [متن البيان الحالي:169–212](file:///tmp/wt-8c69e98-gpt/src/root-of-trust/state-manifest.mts#L169) الذي لا يحمل هذا السجل، وعن [فرع B10 الحالي](file:///tmp/wt-8c69e98-gpt/src/root-of-trust/production-runtime.mts#L432) الذي لا يقرأه. |
| `WL437-gpt_6_1_sol-R2-05` | **addressed** | صحّح [هـ §4.3:166](file:///tmp/wt-8c69e98-gpt/docs/adr/0007-annex-e-production-backend-design.md#L166) `expiration` إلى ‎+60 ومنع `PolicyTicket`، بما يوافق أن القيمة غير السالبة تعيد NULL ticket في [TCG Part 3 §23.2.5 و§23.3](https://cdn.trustedcomputinggroup.org/production/TCG_TPM_2_r1p59_Part3_Commands_pub_00016d87e3.pdf)؛ أما [توقيع البروفة القديم على expiration=0:743–767](file:///tmp/wt-8c69e98-gpt/sim/tpm-ceremony/TpmCeremonyCore.cs#L743) فلا يثبت تطبيق الملف الجديد؛ ويبقى تعريف حقول NULL نفسه بحاجة التصحيح الصغير في `R3-05`. |

## ملاحظات جديدة — WL437-gpt_6_1_sol-R3-NN

### WL437-gpt_6_1_sol-R3-01 — medium — §3.2 و§4.3: تمهيد EK يتطلب الجلسة التي لم تُنشأ بعد

**الدليل.** يحصر صف `NV_Read` قراءة الشهادة وEK Nonce داخل الجلسة المملحة، ويشترط `CreatePrimary` nonce المقروء، ويشترط `StartAuthSession` EK الذي طابق الشهادة مسبقًا؛ كما أن `NV_ReadPublic` في التشغيل العادي لا يجيز أصلًا فهارس nonce، رغم أن حدود قراءة nonce تعتمد `dataSize` منه، وفق [هـ §4.3:160–164](file:///tmp/wt-8c69e98-gpt/docs/adr/0007-annex-e-production-backend-design.md#L160).

تجيز القاعدة العامة السابقة قراءة شهادة EK قبل الجلسة عبر `TPM_RS_PW`، لكن الصف المغلق يناقضها، ولا يوجد استثناء مماثل للـnonce؛ لذلك المسألة تعارض معياري داخل البوابة نفسها، لا تجاهل مني لاستثناء الشهادة الموجود، وفق [هـ §4.3:154 و161](file:///tmp/wt-8c69e98-gpt/docs/adr/0007-annex-e-production-backend-design.md#L154).

**تتبع الفشل.** اتصال أول بلا EK مستمر: يلزم nonce لبناء EK، وتلزم قراءة الشهادة لاختيار النوع ومطابقة المفتاح، وتلزم الجلسة لهاتين القراءتين، ولا تفتح الجلسة قبل إنشاء EK ومطابقته؛ حتى وجود EK مستمر لا يحل شرط قراءة شهادة المصنّع لأول اتصال تحت الجلسة ذاتها، وفق [هـ §3.2:43–66](file:///tmp/wt-8c69e98-gpt/docs/adr/0007-annex-e-production-backend-design.md#L43) و[صفوف EK الحالية](file:///tmp/wt-8c69e98-gpt/docs/adr/0007-annex-e-production-backend-design.md#L161).

**الأثر.** لا يوجد مسار تمهيد مطابق للمصفوفة حرفيًا، ولا تعريف لفروع nonce الغائب التي يجيز فيها ملف EK استخدام القالب الافتراضي؛ وهذا منع تشغيل للسيناريو المقصود، لا برهان تجاوز هوية، وفق [قاعدة TCG للقالب والـnonce الغائب](https://trustedcomputinggroup.org/wp-content/uploads/TCG-EK-Credential-Profile-V-2.5-R2_published.pdf) و[المقتطف المحفوظ](file:///tmp/council-wl437-r3/gpt_6_1_sol/tcg-other-excerpts.txt).

**الإصلاح المقترح.** إضافة حالة تمهيد محددة قبل الجلسة تسمح فقط بقراءة المناطق العامة وبيانات فهارس شهادة EK وnonce المسمّاة، وبحدود أطوال ثابتة؛ التعامل مع هذه المدخلات كغير موثوقة حتى التحقق من السلسلة ومطابقة EK، ثم فتح الجلسة وإثبات امتلاك السر عبر HMAC؛ وتحديد فروع nonce الغائب والموجود وفهارس nonce العددية في `NV_ReadPublic` و`NV_Read`، مع اختبارات إيجابية لكل فرع وسلبية للاستبدال.

### WL437-gpt_6_1_sol-R3-02 — medium — §4.3–§4.4: ملف ن1 الجديد يحظر ردود أوامر التحكم المسموحة

**الدليل.** تقضي §4.4 بأن أشكال النجاح ثلاثة لا غير، ثم تقصر ن1 على القراءات قبل فتح الجلسة؛ في المقابل تنص المصفوفة على إرسال `StartAuthSession` و`LoadExternal` و`PolicySigned` و`FlushContext` بلا جلسات، وتتيح `PolicyCommandCode` بلا جلسة سلامة لأنها اختيارية، وفق [هـ §4.4:182–190](file:///tmp/wt-8c69e98-gpt/docs/adr/0007-annex-e-production-backend-design.md#L182) و[هـ §4.3:164–172](file:///tmp/wt-8c69e98-gpt/docs/adr/0007-annex-e-production-backend-design.md#L164).

**الشاهد المعياري.** يحدد TCG أن وسم النجاح يطابق وسم الطلب؛ ويسمح `PolicySigned` و`LoadExternal` بلا جلسات، بينما يفرض `FlushContext` نفسه `TPM_ST_NO_SESSIONS`، وفق [TCG Part 3 §6.1، والجداول 15–16 و23–24 و124–125 و140–141 و198–199](https://cdn.trustedcomputinggroup.org/production/TCG_TPM_2_r1p59_Part3_Commands_pub_00016d87e3.pdf) و[مقتطفات الأوامر والردود](file:///tmp/council-wl437-r3/gpt_6_1_sol/tcg-part3-focused-excerpts.txt).

**الأثر.** بعد إنشاء جلسة السياسة، يصل رد `PolicySigned` الصحيح بلا منطقة تفويض؛ ن1 يمنعه لأنه بعد فتح الجلسة، ون2 يتطلب منطقة HMAC غير موجودة، ون3 يخص `TPM_RS_PW` الذي لم يُرسل؛ وبذلك يُرفض الانتقال المشروع قبل أمر NV نفسه، وفق [تسلسل الجلسات في §4.3](file:///tmp/wt-8c69e98-gpt/docs/adr/0007-annex-e-production-backend-design.md#L164) و[أشكال النجاح الحصرية في §4.4](file:///tmp/wt-8c69e98-gpt/docs/adr/0007-annex-e-production-backend-design.md#L182).

**الإصلاح المقترح.** جعل ملف النجاح تابعًا لوصف الأمر المرسل لا لقاعدة زمنية عامة: السماح المحدد لأوامر التحكم السابقة بالرد بلا جلسات مع فك دقيق للمقابض والمعاملات، وعدم معاملتها كدليل مصادقة؛ يبقى قرار NV وقراءات الحالة والجرد الحاجز معتمدة على HMAC المملح، وتستعمل جلسة التدقيق حيث تدعمها المواصفة، لا في `FlushContext`.

### WL437-gpt_6_1_sol-R3-03 — medium — §4.4 ن3 و§4.3 NV_UndefineSpace: إثبات الحذف يشترط قراءة عامة لفهرس لم يعد موجودًا

**الدليل.** ينص ن3 على ألا يُسجل طور «تعريف أو حذف» إلا بعد `NV_ReadPublic` لاحق داخل جلسة مملحة يطابق المنطقة العامة المتوقعة، ويجعل فشل هذه القراءة نتيجة مجهولة؛ ويحيل صف `NV_UndefineSpace` إلى تنظيف الملحق ب §7 الذي يحذف `R` ثم `C` ويجرد البقايا، وفق [هـ §4.4:190](file:///tmp/wt-8c69e98-gpt/docs/adr/0007-annex-e-production-backend-design.md#L190) و[هـ §4.3:171](file:///tmp/wt-8c69e98-gpt/docs/adr/0007-annex-e-production-backend-design.md#L171) و[الملحق ب:168–179](file:///tmp/wt-8c69e98-gpt/docs/adr/0007-annex-b-hw-freshness-qualification-plan.md#L168).

**تتبع الفشل.** بعد حذف حقيقي ناجح لا يبقى الفهرس ليعيد `nvPublic`؛ يفشل تحقق وجود المقبض بـ`TPM_RC_HANDLE`، ورد الخطأ بلا HMAC، فيبقى طور الحذف مجهولًا رغم حصوله، وفق [TCG Part 3 §5.3 و§31.4 و§31.6](https://cdn.trustedcomputinggroup.org/production/TCG_TPM_2_r1p59_Part3_Commands_pub_00016d87e3.pdf) و[ملف الخطأ في هـ §4.4:178](file:///tmp/wt-8c69e98-gpt/docs/adr/0007-annex-e-production-backend-design.md#L178).

**الأثر.** لا يمكن تسجيل تنظيف ناجح حرفيًا، وإذا حُذف `R` أولًا تعذر التقدم إلى مسار اكتمال طبيعي؛ والاعتماد بدلًا من ذلك على خطأ `TPM_RC_HANDLE` غير الموثق يعيد مشكلة تزوير الرد التي حاول التنقيح منعها، وفق [شرط ن3](file:///tmp/wt-8c69e98-gpt/docs/adr/0007-annex-e-production-backend-design.md#L190) و[ترتيب التنظيف في ب §7:177](file:///tmp/wt-8c69e98-gpt/docs/adr/0007-annex-b-hw-freshness-qualification-plan.md#L177).

**الإصلاح المقترح.** فصل شرط التعريف عن شرط الحذف: تعريف ناجح يحتاج `NV_ReadPublic` موثقًا يطابق الطلب؛ وحذف ناجح يحتاج جرد `GetCapability(TPM_CAP_HANDLES)` موثقًا وكاملًا يثبت غياب المقبض تحت سلطة القفل نفسها، أو بروتوكول عدم وجود آخر محدد ومراجع؛ لا يُعتد بخطأ غير موثق وحده، ولا تُعاد بايتات الحذف.

### WL437-gpt_6_1_sol-R3-04 — medium — §3.2: بصمة شهادة EK الحية من نوع بيانات لا يحمل الشهادة

**الدليل.** حدد التنقيح مصدر `tpmIdentity` بأنه «بصمة الشهادة من `NV_ReadPublic` لفهرس الشهادة»، مع تمييز مصادر الاسم والسياسة و`base`، وفق [هـ §3.2:68](file:///tmp/wt-8c69e98-gpt/docs/adr/0007-annex-e-production-backend-design.md#L68).

**الشاهد المعياري.** يعيد `NV_ReadPublic` ‏`TPM2B_NV_PUBLIC` و`TPM2B_NAME`؛ وتحتوي المنطقة العامة `nvIndex/nameAlg/attributes/authPolicy/dataSize` لا DER الشهادة، بينما يخزن ملف EK الشهادة نفسها في بيانات NV التي تقرأ بـ`NV_Read`، وفق [TCG Part 3، الجدول 219](https://cdn.trustedcomputinggroup.org/production/TCG_TPM_2_r1p59_Part3_Commands_pub_00016d87e3.pdf) و[TCG Part 2 §13.5–§13.6](https://trustedcomputinggroup.org/wp-content/uploads/TCG_TPM2_r1p59_Part2_Structures_pub.pdf) و[ملف شهادة EK](https://trustedcomputinggroup.org/wp-content/uploads/TCG-EK-Credential-Profile-V-2.5-R2_published.pdf).

**الأثر.** قد يحسب المنفذ بصمة منطقة عامة أو اسم بدل بصمة شهادة، أو يعيد استعمال بصمة قديمة لملء الفراغ؛ لا واحدة منهما تحقق تعريف الهوية الحية المقصود، ولا يكفي نجاح المقارنة الحالية لأن المصدر في مجس المحاكاة يستطيع إعادة الربط من البيان نفسه، وفق [تعريف الهوية في fnv-binding.mts:57–64 و116–120](file:///tmp/wt-8c69e98-gpt/src/root-of-trust/fnv-binding.mts#L57) و[مصدر المحاكاة:195–212](file:///tmp/wt-8c69e98-gpt/sim/freshness-nv/nv-state-bound-socket.mjs#L195).

**الإصلاح المقترح.** النص صراحة على أن البصمة SHA-256 لبايتات DER الحية المجمعة من `NV_Read` للفهرس المثبت، بعد التحقق من السلسلة ومطابقة المفتاح، وأنها لا تُستخرج من `nvPublic` أو الاسم أو متن البيان؛ مع اختبار شهادة مختلفة في فهرس ذي منطقة عامة مماثلة، واختبار مصدر يعيد قيمة البيان بدل البيانات الحية.

### WL437-gpt_6_1_sol-R3-05 — low — §4.3: تعريف NULL ticket خلط غياب التذكرة بقيمة وسمها

**الدليل.** بعد تصحيح `expiration=+60` يشترط الصف «تذكرة NULL فقط» ثم يفسرها بـ«وسم `TPM_ST_NULL` أو خلاصة فارغة»، وفق [هـ §4.3:166](file:///tmp/wt-8c69e98-gpt/docs/adr/0007-annex-e-production-backend-design.md#L166).

**الشاهد المعياري.** NULL ticket ليست وسم `TPM_ST_NULL`: يلزم وسم السياق الصحيح، و`hierarchy=TPM_RH_NULL`، وdigest فارغ؛ ووسم تذكرة `PolicySigned` هو `TPM_ST_AUTH_SIGNED`، كما يجب أن يكون timeout فارغًا عند NULL ticket، وفق [TCG Part 2 §10.7.2 و§10.7.5](https://trustedcomputinggroup.org/wp-content/uploads/TCG_TPM2_r1p59_Part2_Structures_pub.pdf) و[TCG Part 3 §23.3، الجدول 125](https://cdn.trustedcomputinggroup.org/production/TCG_TPM_2_r1p59_Part3_Commands_pub_00016d87e3.pdf).

**الأثر.** عبارة OR لا تحدد ملف رد صحيحًا كاملًا، فتترك قبول تذكرة موسومة خطأ أو ذات hierarchy غير صحيح؛ ولا أستنتج منها تجاوز تفويض NV أو تذكرة قابلة للإعادة لأن التصميم يمنع `PolicyTicket` ويثبت nonce و`cpHashA`، ولذلك خطورتها منخفضة في هذا النطاق، وفق [ملف PolicySigned الحالي](file:///tmp/wt-8c69e98-gpt/docs/adr/0007-annex-e-production-backend-design.md#L166).

**الإصلاح المقترح.** استبدال العبارة باقتران الشروط: `tag=TPM_ST_AUTH_SIGNED`، و`hierarchy=TPM_RH_NULL`، وdigest بطول صفر، وtimeout بطول صفر؛ مع رفض أي بايت زائد أو نوع آخر، واختبار إيجابي لتذكرة NULL القياسية وسلبي لكل حقل.

## حدود

- لم أستخدم `gh`، ولم أدفع تغييرات أو أفتح PR، ولم أعدل ملفات متعقبة أو `config/external-review.yaml`، ولم أفتح منافذ استماع أو أتصل بأي TPM أو أشغّل `swtpm` أو `tpm2-tools`؛ وحالة الشجرة المتعقبة بقيت خالية في [سجل الرأس والحالة](file:///tmp/council-wl437-r3/gpt_6_1_sol/head-and-state.log).
- لم أطلب مفاتيح أو PIN أو ownerAuth أو صلاحيات مخزنة، وكل توقيع مولّد في المجسات توقيع برمجي اختباري داخل العملية ولا يطبع المفتاح الخاص، كما يظهر في [شيفرة المجسات](file:///tmp/council-wl437-r3/gpt_6_1_sol/current-code-probes.mjs).
- بُني TypeScript بالأمر `node node_modules/typescript/bin/tsc -p tsconfig.build.json --outDir /tmp/council-wl437-r3/gpt_6_1_sol/build --incremental false` بخروج صفر، وحُفظ ناتجه خارج الشجرة، وفق [سجل البناء](file:///tmp/council-wl437-r3/gpt_6_1_sol/build.log).
- شُغلت حزمة WL-434 وحدها بالأمر `TMPDIR=/tmp/council-wl437-r3/gpt_6_1_sol/test-roots node --loader /tmp/council-wl437-r3/gpt_6_1_sol/loader.mjs --test tests/root-of-trust/wl-434-fnv-manifest-binding.test.mjs` بخروج صفر و17 حالة بلا فشل، وفق [ناتج الاختبار](file:///tmp/council-wl437-r3/gpt_6_1_sol/wl434-tests.log).
- يوجه loader استيرادات root-of-trust إلى بناء هذا الرأس فقط، ويحتفظ بجذور الاختبار والأدلة بدل محوها؛ وحيث يمثل حذف ملف محفز الاختبار، يعيد تسميته داخل الجذر نفسه دون تغيير التأكيدات، فلا أدعي أنها تشغيلة CI الحرفية غير المعدلة، وفق [loader المراجعة](file:///tmp/council-wl437-r3/gpt_6_1_sol/loader.mjs).
- شُغل `current-code-probes.mjs` بخروج صفر على البناء نفسه: أظهر قبول نداءين متطابقين، وقبول قيمي `base` مختلفتين بكائنين، ثم رفض إعادة الإقلاع بـ`STATE_MANIFEST_FNV_BINDING_IMMUTABLE` بعد حقن انقطاع بين ختم الربط والمنسق، وفق [الشيفرة](file:///tmp/council-wl437-r3/gpt_6_1_sol/current-code-probes.mjs) و[ناتجها](file:///tmp/council-wl437-r3/gpt_6_1_sol/current-code-probes.log).
- تعذر جلب Part 3 بأداة قراءة الويب، فاستُخدم تنزيل HTTPS للعنوان المرجعي نفسه ثم `pdftotext`، وحُفظ [ملف TCG الأصلي](file:///tmp/council-wl437-r3/gpt_6_1_sol/tcg-part3-r159.pdf) و[النص الكامل](file:///tmp/council-wl437-r3/gpt_6_1_sol/tcg-part3-r159.txt) و[المقاطع المركزة](file:///tmp/council-wl437-r3/gpt_6_1_sol/tcg-part3-focused-excerpts.txt)، بينما حُفظت مقتطفات EK وPart 2 من نتائج قراءة الويب في [مقتطفات المواصفات الأخرى](file:///tmp/council-wl437-r3/gpt_6_1_sol/tcg-other-excerpts.txt).
- لا توجد في هذه المراجعة تجربة adapter جديد أو جلسة TPM فعلية؛ استنتاجات `R3-01..05` هي مقارنة حرفية للعقد المقترح بمواصفاته المرجعية، وليست ادعاء قياس عتاد، وفق [حدود حزمة التصميم](file:///tmp/wt-8c69e98-gpt/docs/adr/0007-annex-e-production-backend-design.md#L27).

**الخلاصة:** البنود **1 و2 و3 و4 holds**؛ والبندان **5 و6 open**؛ ومن ملاحظاتي السابقة **عشر addressed وواحدة partially**؛ والملاحظات الجديدة **أربع متوسطة وواحدة منخفضة**، بالأسباب والأدلة المفصلة في الأقسام أعلاه.
