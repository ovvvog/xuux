# دستور الدولة الرقمية

## ديباجة

هذه الدولةُ برمجيّةٌ، وكلُّ سلطةٍ فيها قابلةٌ للتنفيذ آلياً. ولذلك خطرُها ليس في
سوء النيّة بل في **السهولة**: سطرٌ واحدٌ يوقف الدولةَ، ونداءُ تابعٍ واحدٍ كان
يكفي — قبل هذه الخطوة — لتغيير أعلى نصٍّ فيها.

فهذا الدستورُ ليس بياناً أخلاقياً. هو **قيدٌ مُنفَّذ**: كلُّ مادةٍ فيه مربوطةٌ
بمرجعِ قانونٍ تستند إليه سياساتٌ وقدراتٌ وعتبةٌ سياديّةٌ قائمة، وبمواضعِ إنفاذٍ
في الشيفرة، وكلُّ ضمانٍ فيه مربوطٌ **برمزِ رفضٍ يقع فعلاً** لا بوعدٍ في وثيقة.
وما لا يُقاس منه لا يُدّعى.

## أين النصّ

| ما تريد | اقرأ |
| --- | --- |
| النصُّ المؤسِّس (المصدر) | [`config/constitution.yaml`](../config/constitution.yaml) |
| الموادُّ مقروءةً مع تجزئةِ كلٍّ منها | [`ARTICLES.md`](./ARTICLES.md) — وثيقةٌ **مشتقّةٌ** تُولَّد بـ`node scripts/render-constitution-docs.mjs` |
| مخطَّطُ النصّ الصارم | [`config/schemas/constitution.schema.json`](../config/schemas/constitution.schema.json) |
| الشيفرةُ المنفِّذة | [`src/constitution/`](../src/constitution/) |
| شرحُ التصميم وحدودُه | [`docs/CONSTITUTION.md`](../docs/CONSTITUTION.md) |

**والنصُّ النافذُ اليوم ليس هذا الملفَّ ولا الملفَّ المؤسِّس وحده**، بل المؤسِّسُ
مضافاً إليه التعديلاتُ المُبرَمة في المخزن. ومن أراد النافذَ يقرأه من الكود:
`new ConstitutionStore({ policy, signer, dir }).effective()`.

## فهرس الموادّ

| المادة | العنوان | مرجع القانون | مختومة |
| --- | --- | --- | --- |
| `art:01` | السيادة ومصدرها | `law:sovereignty` | **نعم** |
| `art:02` | الدستور ومسار تعديله | `law:constitution` | **نعم** |
| `art:03` | جذر الثقة والمفاتيح | `law:root-of-trust` | لا |
| `art:04` | الإيقاف السيادي | `law:sovereign-halt` | **نعم** |
| `art:05` | التشريع ونفاذه | `law:legislation` | لا |
| `art:06` | حكم السياسات | `law:policy-governance` | لا |
| `art:07` | سيادة البيانات وتصنيفُها | `law:data-sovereignty` | لا |
| `art:08` | الاحتفاظ والمحو المشهود | `law:retention` | لا |
| `art:09` | الوكلاء واحتواؤهم | `law:agent-registry` | لا |
| `art:10` | المال العام | `law:public-finance` | لا |
| `art:11` | القضاء واستقلاله | `law:judiciary` | لا |

## مسار التعديل: أربعُ خطواتٍ لا خطوة

```
                                                  مهلة تدبُّر
  أمرٌ ملكيٌّ (1)          مراجعةُ رئيس القضاة        604800 ث         أمرٌ ملكيٌّ (2)
 amend-constitution   ──▶   لا يراجعها الطارح   ──▶   تمرّ فعلاً   ──▶  ratify-constitution
      propose()                  review()          deliberationRemaining()   ratify()
         │                          │                      │                    │
         └── سببٌ ≥ 32 حرفاً        └── رأيٌ ≥ 24 حرفاً      └── تُقاس على ساعةٍ     └── يحمل تجزئةَ
             ونصٌّ مختلفٌ فعلاً          وحكمٌ صريح               تُمرَّر لا Date.now()      الطرح بعينها
```

وإسقاطُ أيِّ خطوةٍ **رفضٌ برمزٍ مُسمّى**، لا سكوت:

| ما حاولتَه | الرمز |
| --- | --- |
| تحرير `config/constitution.yaml` مباشرةً بعد ختمه | `CONSTITUTION_FOUNDING_TEXT_DRIFT` |
| الكتابةُ في المخزن أو حذفُ سطرٍ منه | `CONSTITUTION_TAMPERED` |
| حذفُ آخر عهدٍ لإرجاع النصّ | `CONSTITUTION_EPOCH_ROLLBACK` |
| تعديلُ مادةٍ مختومةٍ ولو بالمسار كاملاً | `CONSTITUTION_ARTICLE_ENTRENCHED` |
| طرحٌ أو إبرامٌ بلا أمرٍ ملكيٍّ مقبول | `CONSTITUTION_COMMAND_REQUIRED` |
| إعادةُ استعمال أمرٍ للإبرام | `CONSTITUTION_COMMAND_REPLAYED` |
| إبرامٌ بلا مراجعةٍ قضائيّة | `CONSTITUTION_REVIEW_MISSING` |
| مراجعةُ الطارحِ طرحَه | `CONSTITUTION_SELF_REVIEW_REFUSED` |
| إبرامٌ قبل انقضاء المهلة | `CONSTITUTION_DELIBERATION_INCOMPLETE` |
| إبرامُ نصٍّ غيرِ الذي طُرح | `CONSTITUTION_PROPOSAL_HASH_MISMATCH` |
| إبرامٌ على نصٍّ زال عهدُه | `CONSTITUTION_PROPOSAL_STALE` |
| طرحٌ بلا سببٍ مكتوب | `CONSTITUTION_REASON_MISSING` |
| تعديلٌ لا يغيّر النصّ | `CONSTITUTION_TEXT_UNCHANGED` |
| مرجعُ قانونٍ في `config/` لا يُسنَد إلى مادة | `CONSTITUTION_LAW_REFERENCE_DANGLING` |

## المادةُ المختومة

ثلاثُ موادَّ مختومة (`art:01` السيادة، `art:02` الدستورُ ومسارُه، `art:04`
الإيقاف). **لا تُعدَّل ولو استُوفي المسارُ كاملاً**؛ لأن تغييرَها ليس تعديلاً
داخل النظام بل تأسيسُ نظامٍ آخر، وذلك فعلٌ فوق سلطة أيّ كودٍ هنا. وخَتْمُ
`art:02` بعينه شرطٌ يفحصه المحمِّل: مسارٌ يستطيع تعديلَ نفسِه ليس مساراً.

## كيف تتحقّق بنفسك

```bash
npm run guard:constitution                 # البوابة 18: سبعُ قواعد على النصّ ووثائقه ومراجعِه
node --test tests/constitution/            # مسارُ التعديل: ما يُرفض خارجه وما يلزمه داخله
node scripts/render-constitution-docs.mjs  # يعيد توليد ARTICLES.md من النصّ
```
