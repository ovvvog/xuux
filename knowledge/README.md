# `knowledge/` — معايير المعرفة العاملة

هذا المجلَّد **ليس أدبيّاتِ إرشاد**. كلُّ بندٍ في كل وثيقةٍ هنا له مقابلٌ في
الشيفرة: رمزُ رفضٍ يقع فعلاً عند خرقه، ووحدةٌ مسمّاةٌ ترميه.

المصدرُ المحكوم هو `config/knowledge.yaml` (مخطَّطُه
`config/schemas/knowledge.schema.json`، صارمٌ بـ `additionalProperties: false`)،
والوثائقُ هنا شرحٌ له لا بديلٌ عنه. ويحرس الرابطةَ بينهما
`npm run guard:knowledge`: بندٌ لا تذكره وثيقتُه برمزه — أو رمزٌ لا وجود له في
وحدة الإنفاذ — يوقف السلسلة.

## المعايير

| المعيار | الوثيقة | الوحدة الفارضة |
| --- | --- | --- |
| سجل التجارب | [`standards/experiment-ledger.md`](standards/experiment-ledger.md) | `src/knowledge/experiment-ledger.mjs` |
| قابلية إعادة الإنتاج | [`standards/reproducibility.md`](standards/reproducibility.md) | `src/knowledge/experiment-ledger.mjs` |
| تقييم النماذج | [`standards/model-evaluation.md`](standards/model-evaluation.md) | `src/knowledge/experiment-ledger.mjs` و`src/models/evaluation.mjs` |
| نزاهة البحث | [`standards/research-integrity.md`](standards/research-integrity.md) | `src/knowledge/experiment-ledger.mjs` |

## القاعدةُ الحاكمة لهذا المجلَّد

من أراد إضافةَ بندٍ يبدأ **بالرمز** لا بالنص: يكتب الرفضَ في الشيفرة، ثم يعلن
البندَ في `config/knowledge.yaml`، ثم يشرحه هنا. والعكسُ — نصٌّ أوّلاً — هو ما
يُنتج الوثائقَ التي لا يقابلها شيء.
