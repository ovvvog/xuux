# معيار: تقييم النماذج

> المصدر المحكوم: `config/knowledge.yaml#standards[id=model-evaluation]`
> الوحدتان الفارضتان: `src/knowledge/experiment-ledger.mjs` و`src/models/evaluation.mjs`
> الحاجز: `npm run guard:knowledge`

## الموضع في المسار

تنشيطُ نموذجٍ في `src/models/model-registry.mjs` مشروطٌ بنتيجة تقييمٍ حالتُها
`passed` لهذه البصمةِ بعينها (‏`M6.08`). فالسلسلةُ اليوم:

```
تسجيل تجربة (سند) → نتيجة تقييم مربوطة بها → تنشيط النموذج
```

وكان الطرفُ الأول مفقوداً: النتيجةُ تُكتب بلا سند.

## البنود

### ME-1 — كل نتيجةٍ مربوطةٌ بتجربةٍ مسجَّلة

`ModelEvaluationLedger.record` تشترط `experimentId`، وتُنادي
`ExperimentLedger.assertRegistered({ kind: 'model-evaluation' })` **قبل** أيّ
كتابةٍ أو نشرِ حدث.

- رمز الرفض: `KNOWLEDGE_EXPERIMENT_UNREGISTERED`
- ويشمل هذا المخزنَ الدائم: نتيجةٌ محفوظةٌ في الملف بلا `experimentId` تُرفض عند
  التحميل (`MODEL_EVALUATION_STORAGE_INVALID`)، وإلا كان الملفُّ طريقاً جانبياً
  يُبطل الشرطَ من حيث لا يُحرَس.

### ME-2 — الموضوعُ هو نفسُه

التجربةُ تخصّ نفسَ `modelId` ونفسَ `fingerprint` في النتيجة؛ فتجربةٌ على بصمةٍ
أخرى ليست سنداً لهذه — وهذا هو المنعُ نفسه الذي حرسه `M6.08` حين رفض أن تكون
نتيجةُ بصمةٍ تصريحاً عامّاً للنموذج.

- الفارض: `ExperimentLedger.assertRegistered`
- رمز الرفض: `KNOWLEDGE_SUBJECT_MISMATCH`

### ME-3 — لا سجلَّ تقييمٍ بلا سجل تجارب

اعتمادُ `experiments` **واجبٌ في المُنشئ** كوجوب `log`. واعتمادٌ اختياريٌّ هنا
يعني حاجزاً يُتجاوَز بحذف وسيطٍ من نداء التركيب.

- الفارض: `ModelEvaluationLedger` (المُنشئ)
- رمز الرفض: `MODEL_EVALUATION_DEPENDENCY_MISSING`

### ME-4 — موضوعٌ ببصمةٍ كاملة

نوعُ `model-evaluation` يُعلن `subjectKeys: [modelId, fingerprint]`، فتسجيلُ
تجربةٍ بلا أحدهما يُرفض: سندٌ بموضوعٍ مبهم لا يربط شيئاً بشيء.

- الفارض: `ExperimentLedger.register`
- رمز الرفض: `KNOWLEDGE_INPUT_INVALID`

## حدٌّ معلَن

السجلُّ الافتراضيُّ الذي يبنيه `ModelRegistry` يحمل سجلَّ تجاربَ **في الذاكرة**،
فتجاربُه لا تعبر إعادةَ التشغيل إلا إذا مرّرت طبقةُ التركيب سجلاً بملفّ. وهذا
لا يفتح طريقاً جانبياً — لا نتيجةَ بلا تجربةٍ في كل الحالات — لكنه يعني أن سندَ
نتيجةٍ قديمةٍ قد لا يكون مقروءاً بعد إعادة التشغيل. وإغلاقُه مربوطٌ بنقل
السجلَّين إلى PostgreSQL، وهو دَينُ `M6.08` القائم.
