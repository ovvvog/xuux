# دفتر الحصص النافذ — M4.07

قبل M4.07 كانت الحصّة الوحيدة النافذة هي `maxAgents` في
`src/identity/agent-registry.mjs`: يفحص السجل عدد الوكلاء قبل التسجيل. ذلك عدٌّ
لا خصم، ولا يحمل نافذة زمنية، ولا يمنع سباق طلبين يقرآن العدد نفسه. ولم تكن كتابة
الذاكرة أو الإخراج الخارجي أو تخصيص الميزانية تسجّل استهلاكاً في قاعدة البيانات.

`src/policy/quota.mjs` يضيف دفتر حصص دائماً. ينشأ بالحدود المحمّلة من بيانات
السياسة نفسها، لا من أرقام ينسخها المستدعي:

```js
const bundle = loadPolicyBundle();
const quotas = createQuotaLedger({ pool, definitions: bundle.quotas });
```

الدالة `debit({ subjectType, subjectId, resource, amount })` تخصم وتعيد:

```js
{ resource, consumed, limit, remaining }
```

وعند تجاوز الحد ترفع `QuotaError` بالرمز `QUOTA_EXCEEDED`. أما مورد لا يظهر في
`loadPolicyBundle().quotas` لنوع صاحبه فيُرفض قبل قاعدة البيانات بالرمز
`QUOTA_RESOURCE_UNDECLARED`: لا توجد حصّة افتراضية ولا سماح ضمني. وتعيد
`read({ subjectType, subjectId, resource })` آخر صف مسجّل أو `null` إن لم يقع
خصم بعد. القراءة لا تدوّر النافذة؛ الخصم التالي هو الذي يدوّرها ضمن ذرّته.

تملك `EnforcementPoint` موضع حقن اختياري باسم `quotaLedger`: عند تمرير دفتر
منشأ بالحدود أعلاه، تخصم النقطة مورد كل فعل يعلن `quotaResource` بعد سماح
السياسة وقبل إصدار التذكرة. لذلك لا يخصم طلب مرفوض، ولا يحصل الفعل الذي تجاوز
حده على تذكرة تنفيذ. هذا ربط فعلي لمسار التفويض، لا عدّ منفصل في الذاكرة؛ لكنه
لا يجعل الدفتر ذاتيّ الإنشاء، كما تبيّنه الحدود أدناه.

## الجدول والحدود المعلنة

الدفتر يعمل على الجدول القائم `state.quotas` من الهجرة `0001_initial_schema`،
ولا يحتاج هجرة جديدة. مفتاحه التشغيلي الفريد هو:

```text
(subject_type, subject_id, resource)
```

ويحمل لكل مورد حدّه (`limit_value`)، طول نافذته (`window_seconds`)، المستهلك
الحالي (`consumed`) وبداية النافذة (`window_started_at`). قيد المخطط:

```text
quotas_consumed_within_limit CHECK (consumed <= limit_value)
```

هو حاجز الإيقاف. فالفحص في JavaScript وحده عيب: يمكن لطلبين متوازيين أن يريا
رصيداً صالحاً ثم يكتبا تجاوزاً. القيد يفحص الصف المقفول الذي تنفذه PostgreSQL
فعلاً، لذلك لا يمر تجاوز حتى لو أخطأ مستدعٍ أو تنافست وصلات متعددة.

الحدود الحالية، وكلها محمّلة من `config/quotas.yaml` عبر المحمّل، هي:

| المورد | صاحب الحصّة | الحد والنافذة | الغرض المعلن |
| --- | --- | --- | --- |
| `agent-creations` | وكيل | 25 في 86400 ثانية | منع تفريخ الهويات أسرع من المراجعة |
| `memory-writes` | وكيل | 5000 في 3600 ثانية | منع ضجيج الكتابة من إغراق الذاكرة |
| `egress-bytes` | وكيل | 1073741824 في 86400 ثانية | الحد من تسريب بطيء غير قابل للتمييز |
| `budget-allocated` | مؤسسة | 10000000 في 2592000 ثانية | منع استنزاف الميزانية بقرارات متفرقة |
| `model-deployments` | مؤسسة | 10 في 604800 ثانية | منع تفعيل أسرع من التقييم |

## استعلام الخصم الذرّي

هذا هو نص الاستعلام الثابت في الدفتر. كل قيمة، بما فيها المعرّف والحدّ والوقت،
معامل مرقّم؛ لا يُبنى نص SQL من مدخل المستدعي. `$8` هو وقت الدفتر الممرّر، ومنه
تُقاس نهاية النافذة وتُسجّل بدايتها الجديدة.

```sql
INSERT INTO state.quotas (
  id, subject_type, subject_id, resource, limit_value, window_seconds,
  consumed, window_started_at, updated_at
)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)
ON CONFLICT (subject_type, subject_id, resource) DO UPDATE
SET
  limit_value = EXCLUDED.limit_value,
  window_seconds = EXCLUDED.window_seconds,
  consumed = CASE
    WHEN state.quotas.window_started_at
         + state.quotas.window_seconds * INTERVAL '1 second'
         <= EXCLUDED.window_started_at
    THEN EXCLUDED.consumed
    ELSE state.quotas.consumed + EXCLUDED.consumed
  END,
  window_started_at = CASE
    WHEN state.quotas.window_started_at
         + state.quotas.window_seconds * INTERVAL '1 second'
         <= EXCLUDED.window_started_at
    THEN EXCLUDED.window_started_at
    ELSE state.quotas.window_started_at
  END,
  updated_at = EXCLUDED.updated_at
RETURNING resource, consumed, limit_value;
```

إدراج الصف لأول خصم وتحديثه وتدوير نافذته وزيادة الاستهلاك عمليات استعلام واحد.
إن جعلت القراءة أو تدوير النافذة استعلاماً مستقلاً عاد عيب السباق: لا تعني نتيجة
قراءة قديمة أن الصف ما زال يملك الرصيد عند الكتابة. يترجم الدفتر خطأ PostgreSQL
`23514` لقيد `quotas_consumed_within_limit` وحده إلى `QUOTA_EXCEEDED`؛ لا يخلط
قيوداً أخرى بهذا الرمز كي لا يُعرض فساد معرّف أو تعريف حصّة كأنه نفاد طبيعي.

## الدليل المشغّل

`tests/policy/quota.test.mjs` ينشئ قاعدة مستقلة بـ`createIsolatedDatabase` ثم
يشغّل الهجرات بـ`up`. يثبت الخصم التراكمي حتى 25 لوكيل ثم رفضه، ويطلق 30 خصماً
متوازياً بحد 25 فينجح 25 فقط، ويثبت تدوير نافذة `memory-writes` بعد ساعة، ويرفض
مورداً غير معلن برمز مسمّى. لا يعتمد الدليل على `Map` أو محاكاة للقاعدة.

## حدود معلنة / ما لم يُنفَّذ

- **حدٌّ معلن:** الدفتر لا يحسب مقدار الإخراج أو تكلفة الميزانية بنفسه؛ على معالج
  الفعل أن يمرّر `amount` المقاس. مقدار غير موجب أو أدق من أربع خانات عشرية
  مرفوض حتى لا يقرّبه PostgreSQL بصمت.
- **حدٌّ معلن:** لا يربط هذا الملف وحده خصم الحصّة بمعاملة الفعل التجاري أو بسجل
  أحداث. نقطة التفويض تخصم عند حقن `quotaLedger` فيها، لكن تركيب تشغيل ينشئ
  الدفتر من `pool` و`bundle.quotas` ويحقنه ليس ذاتياً بعد؛ إنشاء نقطة بلا دفتر
  يترك خصم المورد معطلاً، وهذا عيب معلن لا سماح مقصود.
- **حدٌّ معلن:** لا توجد مفاتيح تكرار أو حجز ثم تسوية أو عكس تلقائي. تكرار طلب
  ناجح يخصم مرة أخرى، وإخفاق العمل بعد الخصم لا يعكسه الدفتر من تلقاء نفسه.
- **حدٌّ معلن:** لا توجد جدولة تمحو الصفوف المنتهية؛ تُدوّر النافذة عند الخصم
  التالي وتحفظ آخر نافذة لغرض المراجعة.
- **حدٌّ معلن:** مورد `model-deployments` معلن في البيانات، لكن فعل
  `deploy-model` لا يعلن له `quotaResource` في كتالوج الأفعال الحالي؛ لذلك لا
  يصل إلى الدفتر عبر نقطة التفويض حتى يُربط في سياسة معتمدة لاحقة.
- **حدٌّ معلن:** الأرقام تعاد كـJavaScript `number`؛ حدود تتجاوز الدقة الآمنة أو
  تحتاج أكثر من أربع خانات عشرية ليست مدعومة في هذه الواجهة، رغم أن PostgreSQL
  يستطيع تمثيل نطاق عددي أوسع.
