# فهرسُ الوثائقِ وتصنيفُها

> **آخرُ جردٍ:** `main@d79cded2` (‏2026-10-02، `WL-301`) — 236 ملفَّ Markdown متعقَّباً قبلَ هذه الدفعةِ
> (`git ls-files '*.md'`). الوصفُ الحاليُّ للنظامِ في **[الحالةِ الحاليّةِ المقيسةِ](CURRENT_STATE.md)**،
> ولا تمنحُ الوثائقُ صلاحيّاتٍ تنفيذيّةً: مصدرُها العقودُ والسياساتُ وبوابةُ التاجِ.

**قاعدةُ القراءةِ:** الوثيقةُ **الحاليّةُ** تصفُ `main` كما هو ويُصحَّحُ ما يخالفُه فيها. والوثيقةُ
**التاريخيّةُ** سجلٌّ لِما كانَ وقتَ كتابتِها، **لا يُعادُ كتابتُها بالحالِ الحاضرِ** — يُضافُ إليها تنبيهٌ
يُحيلُ إلى الحالِ الحاليِّ عندَ الحاجةِ (‏المادة 6 من [القاعدةِ الحاكمةِ](../GOVERNANCE_RULE.md)).

## 1 — حاليّةٌ حاكمةٌ

| الوثيقةُ | دورُها |
| --- | --- |
| [`GOVERNANCE_RULE.md`](../GOVERNANCE_RULE.md) | الدستورُ الإجرائيُّ — يغلبُ عندَ التعارضِ |
| [`AGENTS.md`](../AGENTS.md) | نقطةُ دخولِ كلِّ وكيلٍ: ترتيبُ القراءةِ ودورتا ما قبلَ الدفعِ وما بعدَ الدمج (‏`WL-329`) |
| [`HANDOFF.md`](HANDOFF.md) | ملخّصُ التسليمِ — **مولَّدٌ** بـ`npm run handoff:report` ومحروسٌ بـ`guard:project-state` |
| [`../config/project-state.yaml`](../config/project-state.yaml) | عقدُ ذاكرةِ المشروعِ: ما يحملُ الحالةَ، وما يتأثّرُ بماذا، وما هو محايد |
| [`README.md`](../README.md) | واجهةُ المشروعِ |
| [`CURRENT_STATE.md`](CURRENT_STATE.md) | المعماريّةُ والقدراتُ والأدلّةُ والفجواتُ كما هي في الكودِ |
| [`PROJECT_STATUS.md`](../PROJECT_STATUS.md) | سطورُ «آخر تحديث» ولوحةُ الحالةِ (‏يحرسُها `guard:status-freshness`) |
| [`roadmap/03-roadmap-to-100.md`](roadmap/03-roadmap-to-100.md) | الخطواتُ ومعاييرُ قبولِها ولوحةُ العدّادِ (‏يحرسُها `guard:progress`) |
| [`roadmap/05-work-log.md`](roadmap/05-work-log.md) | سجلُّ الأعمالِ — إضافةٌ في الأعلى، ولا تعديلَ لمُدخلةٍ قديمةٍ |
| [`roadmap/06-debt-register.md`](roadmap/06-debt-register.md) | سجلُّ الديونِ الموحَّدُ — الحاكمُ في المفتوحِ ومَن يملكُ إغلاقَه |
| [`roadmap/04-execution-playbook.md`](roadmap/04-execution-playbook.md) | قواعدُ التنفيذِ والإصدارِ (‏SemVer) |
| [`../config/external-review.yaml`](../config/external-review.yaml) | عقدُ نتائجِ المراجعةِ المستقلّةِ — يُقرأُ بمُفسِّرِ YAML |
| [`../SECURITY.md`](../SECURITY.md) · [`THREAT_MODEL.md`](THREAT_MODEL.md) · [`ROOT_OF_TRUST.md`](ROOT_OF_TRUST.md) | الأمنُ ونموذجُ التهديدِ وجذرُ الثقةِ (‏يحرسُها `tests/docs/security-docs.test.mjs`) |

## 2 — حاليّةٌ: عقودُ الوحداتِ (‏كلٌّ يحرسُه حاجزُه)

كلُّ وثيقةٍ هنا تشرحُ عقدَ `config/*.yaml` لوحدتِها، ويقيسُ حاجزُ `guard:*` المقابلُ حضورَ معرِّفاتِها
بالاسمِ؛ فهي **حاليّةٌ بالقياسِ** في حدودِ ما يقيسُه الحاجزُ (‏نصّاً لا زمنَ تشغيلٍ):

`AGENT_CONTAINMENT` · `API_LAYER` · `AUDIT_LOG_VIEWER` · `BACKUP` · `CHAOS` · `CONSTITUTION` ·
`COST_CAPACITY` · `CRISIS_ROOM` · `DEPLOYMENT` · `EMERGENCY_DRILL` · `ENVIRONMENT` · `EVENTS` ·
`EXECUTION_RUNTIME` · `EXTERNAL_CONSUMER` · `FEDERAL_DELEGATION` · `INCIDENT_RESPONSE` · `INFERENCE` ·
`INSTITUTIONAL_OPERATING_MODEL` · `KING_AUTHENTICATION` · `KNOWLEDGE` · `LEGISLATION` · `MONITORING` ·
`NOTIFICATIONS` · `OPERATIONS_CENTER` · `OWNER_IDENTITY` · `PERSISTENCE` · `POLICY_GOVERNANCE` ·
`POLICY_MODEL` · `QUOTAS` · `READINESS` · `RECOVERY` · `REGIONS` · `RETENTION` · `ROYAL_CONSOLE` ·
`ROYAL_REPORTS` · `SCHEDULING` · `SERVICE_LEVELS` · `STATE_TREE_CATALOG` · `TELEMETRY` · `TIME` ·
`TRANSPORT` · `TYPING_STANDARD` · `WORK_LEDGER` · `FUTURE_SCIENCE_REGISTRY` · `ops/capacity`
(‏كلُّها `docs/<الاسم>.md`). ومعها [`HSM_KEYS.md`](HSM_KEYS.md) و[`HSM_BOTAN_BUILD.md`](HSM_BOTAN_BUILD.md)
— **وصفٌ لبيئةِ المالكِ المحلّيّةِ (‏SoftHSM على WSL2)** لا لبيئةٍ إنتاجيّةٍ، ومساراتُها المطلقةُ
(‏`/home/...`) مساراتُ ذلك الجهازِ.

**قراراتٌ معماريّةٌ نافذةٌ** (`adr/`): `0001` PostgreSQL · `0002` معرِّفُ EdDSA في HSM · `0003` تدويرُ
مفاتيحِ F06/F07 · `0004` فرضُ HSM عندَ الإقلاعِ · `0005` ترحيلُ المساراتِ الإنتاجيّةِ إلى HSM · `0006` ختمُ
بيانِ الحالةِ وحدُّ منعِ الرجوعِ · `0008` دفترُ تهيئةِ البيئةِ. و**`0007` (‏مرساةُ عدّادِ NV في TPM) تصميمٌ
ينتظرُ موافقةَ المالكِ ولا سطرَ تنفيذٍ له** (‏`EXT-6`).

## 3 — حاليّةٌ مولَّدةٌ (‏لا تُحرَّرُ يدويّاً)

| الوثيقةُ | تُولَّدُ بـ |
| --- | --- |
| [`READINESS_REPORT.md`](READINESS_REPORT.md) | `npm run readiness:report` — تغطيةٌ لا اعتمادٌ |
| [`ROYAL_DECISION_PACKET.md`](ROYAL_DECISION_PACKET.md) | `npm run royal:packet` — حزمةٌ مُجهَّزةٌ بحقولِ قرارٍ فارغةٍ |
| [`audit/file-inventory-summary.md`](audit/file-inventory-summary.md) | `node scripts/inventory.mjs --summary` — **لقطةٌ قديمةٌ من 2026-08-23** |
| [`external-review/skip-baseline.json`](external-review/skip-baseline.json) | مسارُ `measure-skip-baseline.yml` ثمّ `publish-skip-baseline.yml` |

## 4 — تخطيطٌ نشطٌ

| الوثيقةُ | دورُها |
| --- | --- |
| [`../PRODUCT_BUILD_PLAN.md`](../PRODUCT_BUILD_PLAN.md) | التفصيلُ الهندسيُّ لكلِّ دَينِ منتجٍ — والسجلُّ أولى عندَ التعارضِ |
| [`REMAINING_WORK.md`](REMAINING_WORK.md) | التفصيلُ الطويلُ الذي تُحيلُ إليه الحواجزُ (‏`guard:authorization` R5 وغيرُه) |
| [`EXTERNAL_REVIEW_PACK.md`](EXTERNAL_REVIEW_PACK.md) | حزمةُ المراجعةِ المستقلّةِ `M11.04`–`M11.06` |
| `external-review/M11.04-round-9-plan.md` · `M11.05-round-3-plan.md` · `M11.06-round-4-plan.md` | خططُ آخرِ جولةٍ (‏`WL-292`) |
| `external-review/architecture/` · `external-review/options/` | تصميمُ استرجاعِ الحالةِ وخياراتُ المالكِ لـ`R3-A-01`/`EXT-6` |

## 5 — تاريخيّةٌ / أرشيفيّةٌ (‏تُحفَظُ لقيمتِها الإثباتيّةِ)

| الموضعُ | ما هو | لماذا يبقى |
| --- | --- | --- |
| [`roadmap/01-project-definition.md`](roadmap/01-project-definition.md) · [`roadmap/02-baseline-audit.md`](roadmap/02-baseline-audit.md) | تعريفُ المشروعِ وتدقيقُ خطِّ الأساسِ يومَ 2026-08-23 | §2.9.1 من `02` مصدرُ صيغةِ النسبةِ في `guard:progress` |
| `stages/002`…`006` | ملاحظاتُ المراحلِ الأولى للنواةِ (‏2026-08-23) | أصلُ الوحداتِ قبلَ الخارطةِ |
| `changes/2026-09-*.md` | سجلّاتُ تغييرٍ مؤرَّخةٌ | أدلّةُ إجراءاتٍ بتاريخِها |
| [`RUNNER_PROVISIONING.md`](RUNNER_PROVISIONING.md) | تجهيزُ العدّاءِ المقيمِ الملغى في `WL-286` | موسومٌ تاريخيّاً في رأسِه |
| `PROGRESS.md` | تصحيحُ قياسِ `WL-063` | يُحيلُ إلى العدّادِ الحيِّ |
| `audit/work-log-id-map.md` | خريطةُ معرِّفاتِ سجلِّ الأعمالِ | تقرؤها `guard:work-log-ids` |
| `external-review/reports/` (‏30) | التقاريرُ الخامُّ لأعضاءِ مجلسِ النماذجِ | دليلُ كلِّ جولةٍ — لا تُعدَّلُ |
| `external-review/*-comparison-matrix.md` · خططُ الجولاتِ السابقةِ · `delegation/` · `evidence/` · `evidence-packages/` · `probes/` | مصفوفاتُ المقارنةِ وحزمُ التفويضِ والأدلّةِ لكلِّ جولةٍ | يقرأُ `R6-A-10` خطّةَ كلِّ جولةٍ في الكوميتِ الذي راجعَه المجلسُ |
| `../document-1/2/3-*-5000-lines.md` | الوثائقُ الثلاثُ الأصليّةُ (‏15,000 سطرٍ) | مصدرُ نطاقٍ ومصطلحٍ — **لا مواصفةٌ تنفيذيّةٌ**، وتحتوي أخطاءً موثَّقةً في `02` |

## 6 — عيّنةٌ قالبيّةٌ مرجعيّةٌ (‏لا منطقَ فيها)

`civilization/001-domain/` · `federation/regions/001/…` · `institutions/001-الديوان-الملكي/` ومعها
`INSTITUTION_INDEX.md` و`INSTITUTION_LIFECYCLE.md` و`MUNICIPALITY_MODEL.md` — **109 ملفّاتٍ** مسجَّلةٌ في
[`audit/template-allowlist.txt`](audit/template-allowlist.txt) ومحروسةٌ بـ`guard:templates`. ومصدرُ الحقيقةِ
لبنيةِ الدولةِ `seed/` لا هذه العيّنةُ. **ورأسُ القائمةِ يقولُ إنّها تُحذَفُ عندَ `M3`، و`M3` مُغلَقٌ وهي
باقيةٌ** — دَينٌ مقيَّدٌ `DOC-21` ينتظرُ قرارَ المالكِ.

ومثلُها ملفّاتُ `README.md` من أربعةِ أسطرٍ في `contracts/` و`engines/` و`interfaces/` و`operations/`
و`data-platform/` و`infrastructure/` و`federation/`: **عناوينُ مجلّداتٍ بلا محتوى تنفيذيٍّ**.

## 7 — وثائقُ أخرى خارجَ `docs/`

`constitution/README.md` و`constitution/ARTICLES.md` (‏نصُّ الدستورِ، يحرسُه `guard:constitution`) ·
`knowledge/` (‏معاييرُ البحثِ، يحرسُها `guard:knowledge`) · `sim/tpm/README.md` و`sim/channel/README.md`
(‏محاكياتُ تطويرٍ) · `tests/fixtures/roughtime/PROVENANCE.md` (‏أصلُ العيّناتِ المثبَّتةِ).
