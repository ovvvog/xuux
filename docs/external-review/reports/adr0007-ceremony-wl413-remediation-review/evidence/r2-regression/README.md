# سجلّاتُ اختباراتِ الرجوعِ للدفعةِ الثانيةِ من WL-413

- `new-tests-against-42c0050a.tap` — ‏`tests/sim/tpm-ceremony-wl413-r2.test.mjs` وأداةُ الحقنِ الجديدةُ فوقَ النواةِ والمشغِّلِ عندَ `42c0050a`: **11 اختبارًا، 0 نجاح، 11 إخفاقًا** (الأسبابُ الجوهريّةُ ظاهرة).
- `at-dbaf6104/` — تشغيلٌ فعليٌّ على شجرةٍ منفصلةٍ مثبَّتةٍ على `dbaf61049bbdb9b2b93cab6c7605d439c1c465b3`:
  - `ceremony-tests.tap` — اختباراتُ المراسمِ الأربعةُ (wl413-r2، remediation، rehearsal، guard): 41 اختبارًا، 41 نجاحًا، 0 إخفاق، 0 تخطٍّ؛ خروج 0.
  - `tpm-sim-ci.log` — ‏`bash scripts/tpm-sim-ci.sh`: ‏154 اختبارًا، 152 نجاحًا، 0 إخفاق، تخطّيانِ (`XUUX_CHANNEL_POC=1` غيرُ مُعلَنٍ — مسارُ القناةِ الحيُّ محلّيٌّ لا CI، قائمانِ سلفًا)؛ خروج 0.
  - `gpt-probe-*.jsonl` — مسابرُ `gpt_6_1_sol` الأصليّةُ (بتكييفِ `Resp.Parse` الموثَّقِ في `../r2-baseline-42c0050a/gpt_6_1_sol-probes-at-42c0050a/probe-adaptation.diff`)؛ `r2-probe-*.jsonl` — مسابرُ R2؛ `probe-exit-codes.txt` و`probe-summary.txt` ملخّصٌ آليٌّ منها. خروجُ 1 في `define-response-loss`/`flush-refusal` من استعادةِ المسبارِ المستقلّةِ (لم تجدْ ما تحرّرُه/تحذفُه لأنّ الأداةَ نظّفَته)، لا من الأداة.
  - البقايا في `r2-probe-trailing-params` و`r2-probe-written-before-reconcile` مقصودة: الأداةُ تركَت فهرسًا لا تستطيعُ إثباتَ ملكيّتِه وأعلنَته، والجردُ النهائيُّ رصدَه (`residualNv`)؛ أُزيلَ بعدَها بأداةِ `tpm2_nvundefine` على المحاكي نفسِه ضمنَ سياقِ الاختبار.
