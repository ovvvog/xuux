import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
const out='/home/user/workspace/council-284f74d0/reports';
const scratch='/tmp/council-gpt-6-astra';
const root='/home/user/workspace/xuux-review-284f74d0';
const end=execFileSync('date',['-u','+%Y-%m-%dT%H:%M:%SZ'],{encoding:'utf8'}).trim();
const ref=(label,p)=>`[${label}](${p})`;
const source=(p)=>ref('الشفرة',root+'/'+p);
const log=(n)=>ref('سجل التشغيل',scratch+'/'+n+'.json');
const cmd=(n)=>JSON.parse(fs.readFileSync(scratch+'/'+n+'.json','utf8')).command;
const common=`
**المُعرِّفُ:** \`gpt_6_astra\`؛ معرّف التقرير \`gpt-6-astra\`
**المزوِّدُ:** OPENAI
**زمنُ التشغيلِ:** البداية \`2026-10-08T01:25:58Z\`؛ النهاية \`${end}\`، بتوقيت UTC؛ قُرئ الوقت بأمر \`date -u +%Y-%m-%dT%H:%M:%SZ\`.
**الكوميتُ المُراجَعُ:** \`284f74d0b2803cbe909ced0114144f6e1f814ccd\`؛ مخرج \`git rev-parse HEAD\` هو السطر نفسه، ورمز الخروج \`0\`. ${log('inventory')}
**بيئةُ التشغيلِ:** Linux x86_64، النواة \`6.1.155\`، Node \`v20.20.2\`، npm \`10.8.2\`؛ شجرة منفصلة في \`${root}\`، والاعتماديات والبناء موجودان مسبقاً. ${ref('قياس البيئة',scratch+'/metadata.json')}

## تصريحُ استقلالٍ

قرأت حزمة الإطلاق وعقد النتائج والشفرة والاختبارات ذات الصلة في شجرة المراجعة وحدها. لم أقرأ محتوى أي تقرير مجلس سابق أو حالي، ولا أي مصفوفة مقارنة، ولم أفتح شجرة \`/home/user/workspace/xuux\` أو الذاكرة الشخصية. ظهور أسماء تقارير في عقد النتائج أو قائمة Git لم يتبعه فتح تلك الملفات. لم أستخدم \`gh\` أو شبكة GitHub، ولم أعدّل ملفاً متعقّباً أو ألزم أو أدفع شيئاً.

جميع المسابر والنسخ المؤقتة تحت \`${scratch}/\`؛ ضُبط \`TMPDIR\` إلى المسار نفسه في مشغّل الاختبارات، وكل تشغيل اختبار أو مسبار Node استخدم \`env -u DATABASE_URL\`. سجل Git قبل الاختبارات وبعدها لا يطبع تغييرات. ${ref('مشغّل الأوامر',scratch+'/run.mjs')} ${ref('قياس الشجرة',scratch+'/metadata.json')}
`;
const diff=`
### E0 — هوية الشجرة وتغيّر النطاق

\`\`\`sh
git rev-parse HEAD
git diff --stat b1c6e4aa 284f74d0
git diff --name-only b1c6e4aa 284f74d0 -- src/ scripts/
git status --porcelain
\`\`\`

رمز خروج كل أمر \`0\`؛ المخرجات: SHA الكامل أعلاه، ثم \`15 files changed, 605 insertions(+), 224 deletions(-)\`، وملفا المصدر المتغيران فقط \`src/console/royal-console.mjs\` و\`src/production/sovereign-console.mjs\`، ثم لا تغييرات في الشجرة. حُسب تقاطع هذه القائمة مع \`affectedFiles\` للنتائج الإحدى والعشرين فكان \`[]\`؛ بذلك طابق القياس الادعاء الضيق الخاص بملفات \`src/\` و\`scripts/\`، وليس ادعاء أن المستودع كله لم يتغير. ${ref('قياس الفرق',scratch+'/metadata.json')}

قرأت \`reproductionPath\` و\`affectedFiles\` و\`closure\` لكل نتيجة؛ الحقل الأخير غائب في جميع المدخلات الإحدى والعشرين، وحُفظ في الاستخراج بقيمة \`null\` لا كدليل إغلاق. ${ref('العقد المستخرج',scratch+'/finding-contracts.json')}
`;
const r04=`# تقريرُ مجلسِ النماذجِ — M11.04 الجولة 12 — gpt_6_astra
${common}
**نطاقُ السؤالِ:** إعادة اختبار النتائج الثماني المفتوحة: UF-01، UF-03، UF-07، M11.04-F07، R3-A-01، M11.04-F05، R4-K3-01، R5-A-05، وفحص التغيير WL-349 في الديوان واستعادة النقض.

## سجلُّ الأدلّةِ
${diff}
### E1 — إعادة اللقطات والمحو واستمرارية الجذر

\`\`\`sh
${cmd('root')}
\`\`\`

الخروج \`0\`؛ 72 اختباراً، منها 70 دون إخفاق واختباران متروكان لمسار SoftHSM؛ لا يجوز عدّ المتروكين قياساً على توكن حقيقي. من المخرجات: رفض لقطة الجذر القديمة بـ\`STALE_MANIFEST_EPOCH\`، واختبار UF-07 لمحو الدفتر مع شاهد موجب، واختبار UF-01 لمحو السجل والمرساة، واختبار P14 لبقاء الإيقاف بعد بيان قديم ومحو \`halt/\`؛ وقياسات S13 ترفض غياب السجل على جذر قائم. ${log('root')}

هذه هي البدائل القابلة للتشغيل لمسارات S10/S4b/S13 وP12/P13/P14 الواردة في العقد؛ لم أفتح التقارير التي تحمل التسميات الأصلية. بدائل التوقيع ومقبس الحداثة هنا برمجية داخل عملية الاختبار، والمقارنة المضادة للإعادة مثبتة فقط عندما يبقى المرجع المحقون خارج اللقطة. ${ref('اختبارات إعادة اللقطة',root+'/tests/root-of-trust/replay-limit.test.mjs')} ${log('root')}

القراءة المقابلة: تحقق توقيع البيان في \`state-manifest.mts:940–1011\`، مقارنة الحداثة في \`production-runtime.mts:683–751\`، تركيب شاهد الدفتر والإيقاف في \`810–903\`، كشف محو الدفتر في \`command-ledger.mts:299–361\`، وقراءة غياب توجيه الإيقاف في \`halt-switch.mts:653–661\`. ${source('src/root-of-trust/state-manifest.mts')} ${source('src/root-of-trust/production-runtime.mts')} ${source('src/root-of-trust/command-ledger.mts')} ${source('src/root-of-trust/halt-switch.mts')}

### E2 — هل يوجد مسار تشغيل إنتاجي بمرجع حداثة دائم؟

\`\`\`sh
env -u DATABASE_URL NODE_ENV=production XUUX_STATE_ROOT=/tmp/council-gpt-6-astra/cli-root XUUX_FRESHNESS_BACKEND=council node scripts/production-entry.mjs
\`\`\`

الخروج \`1\`؛ المقتطف \`Supported backends: (none in this environment)\`. الشفرة في \`scripts/production-entry.mjs:55\` تنشئ مجموعة دعم فارغة؛ رفض الإقلاع يمنع التشغيل بلا مرجع، لكنه لا يثبت منع إعادة اللقطة على نشر فعلي بمرجع دائم، ولذلك لم أحوّل نجاح E1 التركيبي إلى إغلاق النتائج التي تتطلبه. ${log('paths')} ${source('scripts/production-entry.mjs')}

### E3 — M11.04-F05: المفاتيح والسجل

\`\`\`sh
env -u DATABASE_URL npm run hsm:verify:f05
\`\`\`

الخروج \`1\`؛ \`FAIL (PIN_MISSING)\` و\`F05_VERIFY_EXIT=1\`. لم تُقَس خصائص F05 ولا ثباته عبر تدوير F06/F07 على توكن حقيقي؛ البديل E1 يقيس ختم الأجسام ورفض العبث والدفتر الموقّع، لكنه لا يعوّض غياب العتاد. ${log('paths')} ${log('root')}

قرأت كذلك فرض الختم في \`persistent-log.mts:374–387\` ومسار \`appendSealed/openEvent:622–655\`، وربط السجل بالمراسي في مصنع الجذر؛ هذه أدلة شفرة داعمة لا بديل عن تشغيل فحص المفتاح المفقود. ${source('src/root-of-trust/persistent-log.mts')} ${source('src/root-of-trust/production-runtime.mts')}

### E4 — R5-A-05: مستهلك السحب الحي

\`\`\`sh
env -u DATABASE_URL node /tmp/council-gpt-6-astra/revocation-probe.mjs
\`\`\`

الخروج \`0\`؛ أصدر المسبار شهادة من \`system.chain.authority\`، وكانت صالحة قبل سحبها، ثم سجل \`persisted:true\`، وبعد إغلاق النظام وإعادة بنائه سجل \`live authority after reboot false\`. هذا استعمال للسلطة المركبة فعلاً لا مجرد إنشاء مخزن مستقل؛ مصدر المفاتيح والحداثة محقونان للاختبار. ${log('revocation')} ${ref('المسبار',scratch+'/revocation-probe.mjs')}

المصنع ينشئ \`FileRevocationStore\` عند \`production-runtime.mts:909–911\`، ونقطة الإنتاج تمرره إلى \`CertificateAuthority\` عند \`entrypoint.mjs:135–143\` ثم إلى سلسلة الهوية؛ بذلك لم يعد المخزن بلا مستهلك في مسار التركيب. ${source('src/root-of-trust/production-runtime.mts')} ${source('src/production/entrypoint.mjs')}

### E5 — الضوابط الإيجابية والسلبية لـWL-349

\`\`\`sh
${cmd('veto')}
\`\`\`

الخروج \`0\`؛ 11 اختباراً، صفر إخفاق وصفر ترك. تضمنت V1 استعادة النقض، V2 دوام رفعه، V3 رفض جسم تالف، V4 عدم تطبيق أثر بعد فشل الختم، V5 عدم تكرار الحدث، V6 رفض السجل المبتور. ${log('veto')}

### E6 — قيد نقض مختوم بلا سلطة أمر ملكي

\`\`\`sh
env -u DATABASE_URL node /tmp/council-gpt-6-astra/veto-probe.mjs
\`\`\`

الخروج \`0\`؛ المخرجات المقيسة التالية تبين انتقال الحالة بعد إعادة البناء رغم أن القيد الأخير لا يحمل أمراً أو معرّفه. ${log('vetoProbe')}

\`\`\`text
WL349 legitimate veto true
WL349 after unsigned append runtime veto true
WL349 reboot veto false
WL349 last actor/body agent:log-writer {"vetoed":false}
\`\`\`

## جدولُ الأحكامِ

| المعرِّفُ | الحكمُ | الدليلُ |
| --- | --- | --- |
| UF-01 | open | E1 خرج 0 وسد المحو الجزئي في البديل؛ E2 خرج 1 ولا مرجع إنتاجي دائم مقيس لاستبعاد اللقطة الكاملة، فلا دليل كافٍ على الإغلاق الشامل. ${log('root')} ${log('paths')} |
| UF-03 | open | E1: P14 لا يعيد الحالة إلى running عند المحو الجزئي؛ بقاء الإيقاف ضد استعادة كامل النشر ومرجعه لم يُقَس بعتاد أو مصدر خارجي. ${log('root')} |
| UF-07 | open | E1: محو الدفتر مع الشاهد يُرفض؛ لا قياس إنتاجي لمنع أمر مكرر بعد استعادة الجذر كاملاً، وE2 يتوقف قبل الإقلاع. ${log('root')} ${log('paths')} |
| M11.04-F07 | open | النتيجة المركبة تتبع UF-03 وUF-07؛ ضوابط المحو الجزئي موجودة، لكن حد اللقطة الكاملة غير مثبت على نشر فعلي. ${log('root')} |
| R3-A-01 | open | الختم ومقارنة مرجع محقون مقيسان في E1؛ المصدر الخارجي الدائم غير مركب في مشغّل E2، فلا إثبات خروج مصدر الحقيقة من نطاق القرص على تشغيل فعلي. ${log('root')} ${source('scripts/production-entry.mjs')} |
| M11.04-F05 | open | E3 خرج 1 بسبب غياب PIN؛ فحص المفتاح الحقيقي والاستمرارية المطلوبة لم يُنفذ، مع وجود قياس بديل للسجل في E1. ${log('paths')} ${log('root')} |
| R4-K3-01 | open | E1 يرفض اللقطة القديمة حين يتقدم المرجع الذاكري خارجها؛ لم يُختبر الرجوع بنفس التوكن على مصدر حداثة إنتاجي دائم. ${log('root')} |
| R5-A-05 | closed | E4 خرج 0: السلطة الحية تقرأ السحب بعد إعادة بناء النظام، مع اتصالها بالمخزن الذي أنشأه مصنع الجذر؛ الحكم على غياب المستهلك لا على سلامة العتاد. ${log('revocation')} |

**الحصيلة للثماني الأصلية:** \`closed: 1\`، \`open: 7\`؛ لا تدخل النتيجة الجديدة في هذين العددين.

## نتائجُ جديدةٌ

### R12-ASTRA-01 — تحويل قدرة كتابة السجل إلى تعديل دائم للنقض عند الإقلاع

**الشدة المقترحة:** medium. **الحكم:** open.

**الشرط السابق والأثر:** جهة داخل العملية مُنحت قدرة \`appendSealed\` على سجل التدقيق تستطيع إلحاق \`console.veto.state\` بجسم \`{vetoed:false}\`، بلا توقيع الملك وبلا جلسة العامل الثاني وبلا \`commandId\`؛ بعد إعادة البناء يرفع الديوان نقضاً سبق أن صدر بأمر ملكي صحيح. لا أدّعي هنا منفذاً شبكياً أو قدرة كتابة من حساب وكيل خارجي؛ الحد المقيس هو الفصل بين قدرة التدقيق وقدرة إصدار الأمر السيادي. ${log('vetoProbe')} ${ref('المسبار الكامل',scratch+'/veto-probe.mjs')}

**سبب نسبتها للتغيير:** WL-349 أضاف مستهلكاً يجعل آخر جسم من النوع المحدد مصدراً للحالة؛ \`vetoFromSealedLog:37–67\` يفحص نوع \`vetoed\` فقط عند رفع النقض، ولا يتحقق من الفاعل أو أمر ملكي أو ربطه بالدفتر، ويحوّل غياب \`commandId\` إلى نص فارغ؛ ثم \`composeSovereignConsole:151–159\` يطبّق النتيجة على التاج. ختم الجسم يثبت صحة التخزين، ولا يثبت أن كاتب القيد يملك مفتاح الملك المنفصل. ${source('src/production/sovereign-console.mjs')} ${source('src/console/royal-console.mjs')} ${source('src/production/entrypoint.mjs')}

**مسار إعادة قابل للتشغيل:** شغّل E6 من شجرة المراجعة؛ ينشئ المسبار جذراً جديداً في المسار المؤقت، يقلع عبر حزام الإنتاج، يصدر نقضاً صحيحاً مرة واحدة كتهيئة، ثم يستعمل السطر الآتي دون أمر ملكي جديد، ويغلق النظام ويعيد بناءه بنفس المفاتيح ومقبس الحداثة. ${ref('المسبار الكامل',scratch+'/veto-probe.mjs')}

\`\`\`js
await first.auditLog.appendSealed(
  'console.veto.state',
  'agent:log-writer',
  { vetoed: false },
);
\`\`\`

**الملفات:** \`src/production/sovereign-console.mjs\` و\`src/console/royal-console.mjs\`؛ السجل العام الذي يقبل النوع والفاعل والجسم موضح في \`persistent-log.mts:622–644\`. ${source('src/production/sovereign-console.mjs')} ${source('src/console/royal-console.mjs')} ${source('src/root-of-trust/persistent-log.mts')}

**الإصلاح المقترح:** جعل استعادة النقض تتحقق من سند سلطته الملكية وربطه بمعرّف أمر مثبت وفعل وهدف محددين، أو فصل كتابة أحداث السلطة عن واجهة التدقيق العامة بقيد لا تستطيع جهة التدقيق اصطناعه؛ إضافة اختبار يعيد الإقلاع بعد قيد مختوم صادر عن كاتب غير مخوّل. هذه توصية وليست إصلاحاً منفذاً.

## حدودٌ

- لا DATABASE_URL ولا PostgreSQL ولا SoftHSM ولا TPM ولا Docker في نطاق هذا التشغيل؛ لم أزعم أن غيابها يكشف ثغرة، بل أبقيت النتائج التي تحتاجها مفتوحة لعدم كفاية الإثبات.
- E1 وE4 وE5 وE6 استعملت بدائل برمجية للتوكن والساعة والحداثة؛ إعادة البناء فيها داخل عملية واحدة، وليست دورة جهاز HSM أو مرجعاً خارجياً فعلياً. ${ref('حزام الإنتاج',root+'/tests/helpers/production-sovereign-rig.mjs')} ${log('root')}
- لا أستنتج أن مسار المحو الجزئي القديم ما زال نافذاً؛ الذي بقي دون إثبات شامل هو مقاومة اللقطة الكاملة والفحص العتادي المطلوب، وهذا سبب أحكام open المحافظة. ${log('root')} ${log('paths')}
- إعادة النقض المزور في E6 مشروطة بالوصول إلى قدرة الكتابة المختومة داخل العملية؛ لم أختبر وصولاً إليها من مستخدم شبكة، ولا أساوي بين القدرة على كتابة ملف عادي والقدرة على إنشاء ختم صحيح. ${log('vetoProbe')}
- لم أُشغّل الحزمة الكاملة، ولم أعتمد تقارير غيري أو أمثلتهم غير المتاحة خارج تسميات عقد النتائج.
`;
const r06=`# تقريرُ مجلسِ النماذجِ — M11.06 الجولة 7 — gpt_6_astra
${common}
**نطاقُ السؤالِ:** إعادة اختبار النتائج الثلاث عشرة المفتوحة: R6-A-01، R6-A-03، R6-A-05، R6-A-07، R6-A-08، R6-A-09، R6-A-10، R6-A-11، R6-A-12، R6-A-13، R6-B-03، R6-B-04، R6-B-05.

## سجلُّ الأدلّةِ
${diff}
### E10 — R6-A-01: المحو وهوية الآمر

\`\`\`sh
${cmd('retention')}
\`\`\`

الخروج \`0\`؛ 37 اختباراً، منها 31 دون إخفاق و6 متروكة لغياب PostgreSQL. اختبارات التفويض غير المتروكة ترفض الفاعل غير المسجل رغم الدور النصي، وتبقي الصف موجوداً، وتعد نداء \`authorize\` على \`purge-data\`؛ كما ترفض غياب نقطة التفويض أو بوابة الهوية أو الأمر الملكي، وتقيس الاستهلاك مرة واحدة قبل الحذف. ${log('retention')}

موضع الإنفاذ \`retention-cycle.mjs:358–428\`: حارس الدور ليس كافياً، ويلزم \`authorizer.identityGate.verify\` وقرار السماح ثم استهلاك التذكرة؛ \`run\` و\`eraseDirected\` يناديان المسار قبل الحذف. \`purge-data\` معلن فوق العتبة في ملف السلطة؛ وهذا سد لمسار الفاعل غير المسجل الذي تصفه النتيجة، مع أن الاختبار لا يثبت معاملة PostgreSQL حقيقية. ${source('src/data/retention-cycle.mjs')} ${source('config/royal-authority.yaml')} ${log('retention')}

### E11 — R6-A-03 وR6-A-07: القرار والقدرات والعتبة

\`\`\`sh
${cmd('policy')}
env -u DATABASE_URL node /tmp/council-gpt-6-astra/probes.mjs
\`\`\`

الخروج \`0\` لكل أمر؛ مجموعة الاختبارات 22 اختباراً بلا إخفاق أو ترك. المسبار المستقل أعاد النتائج التالية، مع عدم استنتاج أن قرار PDP وحده ينفّذ أمراً. ${log('policy')} ${log('probes')}

\`\`\`text
R6-A-03 write-data capabilities=[] allowed=false code=POLICY_NO_MATCH
R6-A-03 write-data capabilities=[action:write-data] allowed=true code=POLICY_ALLOW
R6-A-03 create-agent capabilities=[action:create-agent] allowed=false code=POLICY_NO_MATCH
R6-A-07 direct PDP shaped strings {"allowed":true,"code":"POLICY_ALLOW"}
\`\`\`

الكتابة صارت مشروطة بـ\`actor.capabilities includes action:write-data\` في \`config/policies.yaml:452–471\`، ويستهلك المحرك عامل includes؛ أما إنشاء وكيل بدور agent فلا تفتحه القدرة وحدها لأن سياسة الخدمة الذاتية عند \`512–527\` غير مفعلة، وهذا رفض سياسة مقصود وليس تجاهلاً مطلقاً للقدرات كما في العيب الأصلي. ${source('src/policy/engine.mjs')} ${source('config/policies.yaml')} ${ref('عقد ترتيب القرار',root+'/docs/POLICY_MODEL.md')}

في المقابل بقي فحص العتبة داخل \`engine.mjs:307–345\` شكلياً: معرّف غير فارغ وملخص سداسي بطول 64 يفتحان قرار PDP من دون توقيع؛ لذلك أبقيت R6-A-07 مفتوحة على هذا الحد المحدد، مع الإقرار بوجود تعويض إنفاذي مقيس في E13. ${source('src/policy/engine.mjs')} ${log('probes')} ${log('supplement2')}

### E12 — R6-A-05: الدوام بعد إعادة البناء وعملية جديدة

\`\`\`sh
${cmd('restart')}
env -u DATABASE_URL node /tmp/council-gpt-6-astra/probes.mjs
\`\`\`

الخروج \`0\` لكل أمر؛ المجموعة 47 اختباراً بلا إخفاق أو ترك، منها استعادة الحجر من السجل المختوم ودوام ميزانية الاستدلال عند استعمال المخزن الملفي؛ لكن المسبار أنشأ منحة ومقترحاً ثم فتح عملية Node جديدة، وطبع \`grant before 1\`، \`proposals before 1\`، \`child grants 0\`، \`child proposals 0\`، ورمز العملية الفرعية \`0\`. ${log('restart')} ${log('probes')}

المتبقي واضح في \`CapabilityGrantLedger\` و\`AmendmentPath\`: خرائط ذاكرية لا عقد استعادة دائم لها؛ أما الحجر فله استعادة إنتاجية، وبوابة الاستدلال تفرض \`budgetStore.load/save\`. المسبار الفرعي يثبت غياب الحالة من واجهة البناء الجديدة، ولا يدّعي أنه قتل نشر PostgreSQL ثم أعاده. ${source('src/identity/capability-grants.mjs')} ${source('src/constitution/amendment-path.mjs')} ${source('src/governance/quarantine.mjs')} ${source('src/inference/inference-gate.mjs')} ${ref('حد المقترحات',root+'/docs/CONSTITUTION.md')}

### E13 — التعويض السيادي، الحفظ القانوني، المحو الخام، وإعداد النقل

محاولة أولى استعملت اسماً غير موجود لأحد اختبارات القاعدة، فخرجت \`1\` قبل أي اختبار؛ هذا خطأ في أمر المراجع لا عيب في المنتج، وسُجل دون إخفاء. ${log('supplement')}

\`\`\`sh
${cmd('supplement')}
\`\`\`

ثم استُعمل الاسم الموجود \`db-config.test.mjs\` في الأمر التالي، فخرج \`0\` مع 48 اختباراً بلا إخفاق أو ترك. ${log('supplement2')}

\`\`\`sh
${cmd('supplement2')}
\`\`\`

- **R6-A-07:** نقطة الإنفاذ في \`createProductionSystem\` ترفض المعرّف والملخص وحدهما، وتوقيع العقدة غير توقيع الملك، ويصل الأمر الصحيح إلى المعالج؛ هذا تعويض حقيقي مقيس على حزام محقون، لا تغيير لطبيعة PDP في E11. ${log('supplement2')} ${source('src/production/entrypoint.mjs')}
- **R6-A-09:** تعيين الحفظ القانوني ورفعه بلا أمر يُرفضان في المسار التطبيقي؛ لكن \`docs/RETENTION.md:61,169–172\` و\`retention-cycle.mjs\` ما زالا يعلنان أن الدورة لا تُجدول نفسها، وإعدادا \`minHoursBetweenRuns\` و\`maxErasuresPerRun\` بوابتان لا مجدول؛ فشق الجدولة باقٍ. ${log('supplement2')} ${ref('وثيقة الاحتفاظ',root+'/docs/RETENTION.md')} ${source('src/data/retention-cycle.mjs')} ${ref('الإعداد',root+'/config/retention.yaml')}
- **R6-A-11:** الاختبار المكافئ للمجمع الوهمي يسجل صفر SQL وصفر اتصالات عند \`purge\` و\`eraseById\`، ويرفض بـ\`RETENTION_PURGE_UNAUTHORIZED\`؛ في الشفرة \`retention.mjs:313–362\` يقع الرفض قبل الاتصال، والقراءة الجافة فقط تبقى ممكنة. ${log('supplement2')} ${source('src/persistence/retention.mjs')}
- **R6-B-03:** إعداد الوصلة يقبل تمرير CA مع \`rejectUnauthorized:true\` ويزيل \`sslmode\` قبل تسليم خيارات pg؛ القراءة في \`guard-encryption.mjs:131–139\` تؤكد استعمال \`createPool\` بدل إنشاء مجمع يتجاهل CA، لكن لا قياس لاتصال قاعدة حقيقية في هذه الجولة. ${log('supplement2')} ${source('scripts/guard-encryption.mjs')} ${source('src/persistence/db.mjs')}

المسبار E11، دون فتح اتصال شبكي، رفض وصلة \`db.invalid\` بلا TLS، ثم أعاد \`tls:true\` و\`rejectUnauthorized:true\` و\`removedSslmode:true\` للوصلة ذات TLS وشهادة تجريبية؛ الشهادة هنا شكل نص للاختبار ولا تمثل سلسلة ثقة اجتازت مصافحة. لذلك لم أثبت زوال إخفاق الوصلة الفعلية المذكور في R6-B-03. ${log('probes')}

### E14 — R6-A-08: stop/resume في الإنتاج

\`\`\`sh
${cmd('safeMode')}
\`\`\`

الخروج \`0\`؛ 22 اختباراً بلا إخفاق أو ترك. شمل القياس رفض تبديل الوضع الإنتاجي بنداء ودور نصي، وقبول أمر صحيح عبر مفتاح الإيقاف مع دوام حالته ورفض التوقيع المزور وإعادة الأمر؛ كما طبع المسبار E11 الرمز \`KERNEL_SAFE_MODE_REQUIRES_ROYAL_COMMAND\` عند stop وعند resume بلا سلطة في بيئة الإنتاج. ${log('safeMode')} ${log('probes')}

السبب البرمجي \`execution-kernel.mjs:326–368\`: الدالتان القديمتان ترفضان في الإنتاج، و\`enterSafeMode/leaveSafeMode\` تمرران الأمر إلى HaltSwitch؛ بقي مسار التطوير القديم، لكنه ليس مسار السلطة الإنتاجية الذي بُني عليه حكم الإغلاق هنا. ${source('src/core/execution-kernel.mjs')}

### E15 — R6-A-10 وR6-A-12 وR6-B-04: الخطة ومسار الاختبارات

\`\`\`sh
git ls-tree -r 284f74d0 --name-only | rg M11.06
git ls-tree -r 284f74d0 --name-only | rg '^docs/external-review/M11\\.06.*plan\\.md$'
git cat-file -e HEAD:docs/external-review/M11.06-round-7-plan.md
env -u DATABASE_URL node --test tests/agents/
env -u DATABASE_URL node scripts/retention.mjs purge
\`\`\`

رموز الخروج بالترتيب: \`0، 0، 128، 0، 1\`. قائمة الخطط تظهر الجولات 1 و2 و3 و4 فقط، وGit يقول إن خطة الجولة 7 غير موجودة في HEAD؛ أما \`tests/agents/\` فشُغّل فعلاً باختبارين دون إخفاق أو ترك. أمر المحو يطبع \`RETENTION_PURGE_CLI_FORBIDDEN\` قبل الاتصال بالقاعدة، ويخدم كذلك R6-A-11. ${log('paths')} ${ref('قياس الخطة',scratch+'/metadata.json')}

قرأت خطة الجولة 2 التي تحمل الأمر، واختبار حزمة المراجعة \`tests/docs/external-review-pack.test.mjs:52–112\`؛ الحارس الأخير صار يقبل وجود الدليل في HEAD إذا نقص من نسخة العمل، لكن وجود خطط سابقة لا يعوّض غياب خطة الجولة التي نراجع بها هذا الكوميت. لم أشغّل الحارس أو validate كي لا يقرأ محتوى تقارير محظورة ضمن اختبارات الوثائق. ${ref('خطة الجولة 2',root+'/docs/external-review/M11.06-round-2-plan.md')} ${ref('حارس الحزمة',root+'/tests/docs/external-review-pack.test.mjs')} ${ref('قياس الخطة',scratch+'/metadata.json')}

### E16 — R6-A-13 وR6-B-05: طفرة إقرار غياب المنتج

\`\`\`sh
${cmd('docs')}
env -u DATABASE_URL node /tmp/council-gpt-6-astra/doc-mutation.mjs
\`\`\`

الخروج \`0\` لكل أمر؛ الأول 23 اختباراً بلا إخفاق أو ترك، منها إنتاج \`budget-exceeded\` فعلياً وطفرات نفي متعددة. الثاني ينسخ الاختبار والوثيقة إلى المسار المؤقت فقط، ويبدل عبارة البند إلى \`budget-exceeded بلا مُنتِجٍ\`، ثم يشغّل اختبار صدق الوثيقة المطابق للاسم؛ رمز الاختبار الفرعي \`1\`، مع إخفاق واحد و22 اختباراً متروكاً بمرشح الاسم، وسبب الإخفاق \`ERR_ASSERTION\` عند اكتشاف عبارة \`بلا منتج\`. خروج الغلاف \`0\` يعني أنه رأى رمز الإخفاق المتوقع، وليس أن الوثيقة المعدلة قُبلت. ${log('docs')} ${log('mutation')} ${ref('خرج الطفرة',scratch+'/containment-mutant-output.txt')}

الأمر الفرعي كما شُغّل: ${ref('مشغّل الطفرة',scratch+'/doc-mutation.mjs')}

\`\`\`sh
env -u DATABASE_URL node --test '--test-name-pattern=وثيقةُ الاحتواءِ لا تُقرُّ بغيابِ مُنتِجِ' /tmp/council-gpt-6-astra/containment-mutant.test.mjs
\`\`\`

قرأت المنتج في \`inference-gate.mjs\` والحارس في \`agent-containment-claims.test.mjs:300–373\` والفقرة عند \`AGENT_CONTAINMENT.md:150\`؛ الحكم يخص مسار إعادة النفي المذكور في النتيجتين، لا اكتمال فهم كل صياغة عربية ممكنة. ${source('src/inference/inference-gate.mjs')} ${ref('حارس الادعاء',root+'/tests/docs/agent-containment-claims.test.mjs')} ${ref('الوثيقة',root+'/docs/AGENT_CONTAINMENT.md')}

## جدولُ الأحكامِ

| المعرِّفُ | الحكمُ | الدليلُ |
| --- | --- | --- |
| R6-A-01 | closed | E10 خرج 0؛ الفاعل غير المسجل لا يمحو، ويقع التفويض واستهلاك التذكرة قبل الحذف، والرفض مقيس دون حاجة لقاعدة حية. ${log('retention')} |
| R6-A-03 | closed | E11 خرج 0؛ كتابة الدور بلا قدرة تُرفض، ومع القدرة تُسمح؛ رفض create-agent للوكيل مطابق لسياسة غير مفعلة لا لتجاهل جميع القدرات. ${log('probes')} ${source('config/policies.yaml')} |
| R6-A-05 | open | E12/E11 خرجا 0؛ الحجر والميزانية لهما دوام مقيس، لكن المنح والمقترحات انتقلت من 1 إلى 0 في العملية الجديدة. ${log('restart')} ${log('probes')} |
| R6-A-07 | open | E11 خرج 0 وأعاد PDP السماح لمعرّف وملخص شكليين؛ E13 أثبت التعويض عند نقطة الإنتاج، ولم يغيّر الحد المعلن داخل المحرك نفسه. ${log('probes')} ${log('supplement2')} |
| R6-A-08 | closed | E14 خرج 0؛ النداء المجرد للإيقاف والاستئناف يُرفض في الإنتاج، والمسار البديل يمر بأمر ملكي في HaltSwitch. ${log('safeMode')} ${log('probes')} |
| R6-A-09 | open | E13 سد غياب الأمر في مسار الحفظ القانوني؛ شق عدم الجدولة باقٍ في الشفرة والوثيقة. ${log('supplement2')} ${ref('وثيقة الاحتفاظ',root+'/docs/RETENTION.md')} |
| R6-A-10 | open | E15: غياب خطة الجولة 7 في الكوميت مقيس برمز 128؛ خطط 1–4 ليست الخطة الحالية. ${ref('قياس الخطة',scratch+'/metadata.json')} |
| R6-A-11 | closed | E13: صفر SQL واتصالات للمحو الخام؛ E15: CLI يخرج 1 قبل الاتصال. ${log('supplement2')} ${log('paths')} |
| R6-A-12 | closed | E15: الأمر نفسه على tests/agents/ يخرج 0 باختبارين؛ سبب الإخفاق الأصلي غير قائم. ${log('paths')} |
| R6-A-13 | closed | E16: الأصل يخرج 0، والطفرة المقصودة تخرج 1 باكتشاف إقرار الغياب. ${log('docs')} ${log('mutation')} |
| R6-B-03 | open | E13/E11 قاسا تحسن إعداد TLS وتمرير CA فقط؛ لا PostgreSQL ولا إعادة اتصال الوصلة المعنية، فلا إثبات كافٍ على زوال العائق التشغيلي. ${log('supplement2')} ${log('probes')} |
| R6-B-04 | closed | E15: نفس الأمر لمسار agents موجود ويعمل برمز 0. ${log('paths')} |
| R6-B-05 | closed | E16: إدخال عبارة بلا منتج يسقط حارس الوثيقة فعلاً، لا مجرد فحص النص الأصلي. ${log('mutation')} |

**الحصيلة للثلاث عشرة الأصلية:** \`closed: 8\`، \`open: 5\`.

## نتائجُ جديدةٌ

لم أضف نتيجة جديدة لهذا الارتباط؛ نتيجة WL-349 المشروطة بقدرة كتابة السجل مدرجة في تقرير M11.04 الخاص بي، ولا أكرر عدّها هنا.

## حدودٌ

- لا قاعدة PostgreSQL في التشغيل؛ ستة اختبارات في E10 متروكة لذلك، ولم أعد تشغيل الوصلة التاريخية أو مصافحة TLS أو validate كاملة. الحكم على R6-B-03 عدم كفاية دليل الإغلاق، لا اتهاماً بأن إعداد CA الجديد معطل. ${log('retention')} ${log('probes')}
- أحكام المحو تخص رفض المسارات غير المخولة قبل الوصول إلى المستودع/المجمع؛ نجاح السيناريوهات المخولة بمستودعات الذاكرة أو بمحقق اختبار لا يثبت التشغيل الكامل للمحو على الإنتاج. ${ref('اختبارات التفويض',root+'/tests/data/retention-authorization.test.mjs')} ${log('supplement2')}
- الدوام الإنتاجي المقيس للحجر والأوامر استخدم حزام مفاتيح وحداثة وساعة محقوناً؛ اختبار المنح والمقترحات فتح عملية ثانية لكنه ليس استعادة نشر شامل بمخازن خارجية. ${log('restart')} ${ref('المسبار',scratch+'/probes.mjs')}
- R6-A-07 لا تعني وجود تجاوز سيادي مثبت عبر واجهة الإنتاج: E13 رفضه فعلياً؛ الذي بقي هو المسار البنيوي الموصوف صراحة في المحرك وعقد النتيجة. ${log('probes')} ${log('supplement2')}
- R6-A-08 أُغلقت على مسار الإنتاج؛ لا أدّعي أن دوال التطوير القديمة أصبحت تتطلب أمراً ملكياً، ولا أن كائناً مكشوفاً داخل عملية موثوقة يشكل عزلاً أمنياً كاملاً. ${source('src/core/execution-kernel.mjs')}
- الحارس النصي للمستند لا يفهم كل صياغة لغوية؛ الذي أُعيد هنا هو الطفرة المطلوبة ومرادفاتها الموجودة في الحزمة، دون تعديل الملف المتعقّب. ${log('docs')} ${log('mutation')}
- لا قراءة لتقارير غيري، ولا إزالة تقارير من شجرة المراجعة لمحاكاة الشطر التاريخي لـR6-A-10؛ سؤال وجود خطة الجولة الحالية حُسم بأسماء الشجرة فقط. ${ref('قياس الخطة',scratch+'/metadata.json')}
`;
fs.mkdirSync(out,{recursive:true});
for(const [name,text] of [['M11.04-round-12-model-council-report-gpt-6-astra.md',r04],['M11.06-round-7-model-council-report-gpt-6-astra.md',r06]]){
for(const forbidden of ['verified','approved','secure','ready','passed'])if(text.toLowerCase().includes(forbidden))throw Error('forbidden token '+forbidden);
fs.writeFileSync(out+'/'+name,text);
console.log(out+'/'+name);
}
console.log('END_UTC='+end);
