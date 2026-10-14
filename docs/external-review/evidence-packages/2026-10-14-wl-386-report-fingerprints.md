# سجلُ بصماتِ SHA-256 للتقاريرِ الستةِ الخامِّ — جولةُ WL-383 (PR #340)

**تاريخُ إنشاءِ السجلِّ:** 2026-10-14 (WL-386)
**المنهجيّةُ:** حسابُ `sha256sum` على النسخةِ الحاليةِ من كلِّ ملفٍّ في الشجرةِ العاملةِ على `main@fad7cecdb5e0d1c97de9c62146a61a3abbc93b7f`. **لا يُوجدُ مرجعُ بصمةٍ أصليٌّ مستقلٌّ في جسمِ كوميتِ PR #340** رغمَ أنّ عنوانَ الكوميتِ قالَ «نقلت بايتاً ببايت مع بصمات sha256» — هذا الادّعاءُ **غيرُ مدعومٍ بدليلٍ** في الكوميتِ نفسِه.

## البصماتُ المحسوبةُ (النسخةُ الحاليةُ على main@fad7cec)

| الملفُّ | SHA-256 | الكوميتُ المُدخِلُ |
| --- | --- | --- |
| `docs/external-review/reports/M11.04-round-13-model-council-report-gpt-6-1-sol.md` | `7e10eb4bf209f00693977a6ed041fd1d2de909740de54316effefbd6623b7c01` | `b2a89ad1` (WL-383/PR #340) |
| `docs/external-review/reports/M11.04-round-13-model-council-report-claude-opus-5-5.md` | `fe1b9a8a3e1b7d13d0e654b49fa852ad59ae88b574f0005e091c5208f43c7332` | `b2a89ad1` (WL-383/PR #340) |
| `docs/external-review/reports/M11.05-round-5-model-council-report-gpt-6-1-sol.md` | `95b36b1c3eee483d089198951c87dbe5684d4d3faf06adee8e7efed77fe65ca0` | `b2a89ad1` (WL-383/PR #340) |
| `docs/external-review/reports/M11.05-round-5-model-council-report-claude-opus-5-5.md` | `404bda4ab519174a5a8ac4a3867c02c17c2c4db9782793e13aa3ce8728bbffe0` | `b2a89ad1` (WL-383/PR #340) |
| `docs/external-review/reports/M11.06-round-8-model-council-report-gpt-6-1-sol.md` | `0e759ac413acfedbad36a225ccb7745d6a36483ca0a8fa8c739f91790a04b745` | `b2a89ad1` (WL-383/PR #340) |
| `docs/external-review/reports/M11.06-round-8-model-council-report-claude-opus-5-5.md` | `7ca85fc316d08f49b068c58cbb9a3724c09d46c6140b73c91d81811b52cc4238` | `b2a89ad1` (WL-383/PR #340) |

## حدودُ الإثباتِ

- **هذه البصماتُ تُثبِتُ هويةَ الملفاتِ الحاليّةِ لا سلامةَ النقلِ الأصليَّ.** حِسابُها الآنَ يُثبِتُ أنّ الملفَّ الذي في الشجرةِ هو ما هو عليهِ اليومَ — لا أنّهُ لم يتغيّرْ منذُ النقلِ الأصليِّ.
- **لا يوجدُ مرجعُ بصمةٍ أصليةٍ مستقلّةٍ** في جسمِ كوميتِ `b2a89ad1` أو في PR #340 أو في السجلِّ. لذلكَ **لا يمكنُ التحقّقُ من أنّ النقلَ كانَ بايتاً ببايت** كما ادّعى العنوانُ.
- **ملاحظةٌ على عنوانِ الجولةِ داخلَ الملفّينِ من M11.05 ج5:** يحملُ كلا الملفّينِ عنوانَ «الجولة 3» خطأً (قُيِّدَ في CO55-M11.05-R3-03). التقريرُ الخامُّ **لا يُعدَّلُ** — يُوثَّقُ العيبُ هنا.

## إعادةُ الحسابِ

```bash
sha256sum docs/external-review/reports/M11.0{4-round-13,5-round-5,6-round-8}-model-council-report-{gpt-6-1-sol,claude-opus-5-5}.md
```

على شجرةٍ نظيفةٍ على `main@fad7cec`.
