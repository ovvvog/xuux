# `LIVE-39` — ع١: دليلُ علاماتِ مزامنةِ المجلّدِ ودوامِ الاسمِ (‏`WL-505`)

> **دليلُ قياسٍ لا قرار.** لا يُغلِقُ `LIVE-39`، ولا يغيّرُ `PLM` ولا `D3` ولا الفحصَ المطلوب، ولا يمسُّ كودَ الإنتاج.
> ينفّذُ العلاجَ (‏ع١) من [تحليلِ العمى](LIVE-39-mutation-blindness-analysis.md) §4.1 **بتفويضِ المالكِ لـع١ وحدَه**؛
> وع٢ (‏أنظمةُ ملفّاتٍ أخرى) وع٣ (‏إعادةُ تعريفِ `PLM`) خارجَ التفويض.

## 1. الخطّةُ (‏مسجّلةٌ قبلَ القياس)

| البند | التصميم |
|---|---|
| مواضعُ العلامات | بعدَ **كلِّ** `fsync(2)` على واصفِ مجلّدٍ داخلَ جذرِ الاختبار (‏`LIVE39_DIRSYNC_SCOPE`)، علامةُ `dirsync-<n>` في `dm-log-writes`. المتوقّعُ من تتبُّعِ `WL-503` §2: ستّةُ مواضع — BOOT×2 (‏`root-of-trust.manifest.json`)، وM1 (‏`undo.jsonl`)، وM2 (‏البيانُ في المعاملة)، وM3 (‏ربطُ المطالبةِ في `commands.ledger.claims`)، وM4 (‏البيانُ عندَ S4). |
| ما تقيسُه كلٌّ منها | حالُ كلِّ اسمٍ مسّتهُ `rename`/`link`/`unlink` في ذلكَ المجلّدِ منذُ مزامنتِه السابقة، **في نظامِ الملفّاتِ نفسِه** بعدَ إعادةِ السجلِّ حتّى العلامةِ وتركيبِه للقراءة: الاسمُ الأساسيُّ موجودٌ ومحتواهُ بصمةُ الملفِّ المُزامَن؛ والأسماءُ الثانويّةُ وجوداً/غياباً فقط (‏مزامنةُ المجلّدِ تَعِدُ بالأسماءِ لا بالمحتوى). |
| الشاهدُ الموجب (‏`witness`, PLD1) | `fsync` حقيقيٌّ ⇒ لقطةٌ ⇒ علامة. مطلوبٌ: كلُّ اسمٍ أساسيٍّ `DURABLE` في المواضعِ الستّة، و`e2fsck -n` نظيف (‏PL4). |
| الطفرةُ السلبيّة (‏`mutate`, PLD2) | يُتخطّى `fsync` المجلّد ⇒ لقطةٌ ⇒ علامة. **المعيارُ المسجَّلُ:** سقوطٌ (‏`LOST`) **مطلوبٌ** عندَ M2 وM4 (‏الحدُّ الأدنى في التصميم)؛ والمواضعُ الأخرى تُسجَّلُ `OBSERVED` بلا حكم. **التنبّؤ:** `LOST` في الستّةِ لأنّ العلامةَ تسبقُ أيَّ `fsync` ملفٍّ لاحق — وهذا يناقضُ تنبّؤَ التحليلِ §4.1 بأنّ M1/M3 يبقيانِ أخضرَين؛ ويُبلَّغُ أيُّ الفرعَين وقع. |
| الطفرةُ المضادّةُ لأداةِ القياس (‏`early`, PLD3) | لقطةٌ ⇒ علامة ⇒ `fsync` حقيقيّ (‏العلامةُ **قبلَ** النداء). مطلوبٌ: سقوطُ M2/M4 — فيثبتُ أنّ موضعَ العلامةِ من النداءِ مقيسٌ لا مفترض. |
| الفصلُ بينَ الاسمِ والبروتوكول | لكلِّ علامةٍ، بعدَ المِحكِّ: تركيبٌ للكتابةِ وتشغيلُ استعادةِ البروتوكولِ معَ لقطةِ المقبسِ عندَ العلامة ⇒ سطرُ `PROTO|…` **إعلاميٌّ** لا يدخلُ الحكم. |
| منعُ تلويثِ المسارِ الدائم | `scripts/live-39-dirsync-marks.sh` اختياريٌّ لا يناديهِ `ci.yml` ولا `npm test`؛ أسطرُ `STAGE|…` في الابنِ تُكتَبُ عندَ `op.dirsyncLog` وحدَه؛ والقياسُ الحيُّ بمسارِ استقصاءٍ مؤقّتٍ على فرعٍ منفصلٍ (‏`probe/wl-505-live-39-r1-dirsync`) لا يُدمَجُ ويُحذَف. والاختباراتُ الدائمةُ (‏`tests/tooling/live-39-dirsync.test.mjs`، 14) بلا نواةٍ. |
| حفظُ الدليل | قطعةُ التشغيلِ `wl-505-dirsync-evidence-<sha>` (‏احتفاظ 90 يوماً)، وأسطرُ النتائجِ منقولةً حرفيّاً في §3 أدناه فلا تزولُ بزوالِ القطعة. |

**انحرافٌ معلَنٌ عن §4.1:** طلبُ العلامةِ عبرَ **مُعلِّمٍ متزامنٍ يُطلَقُ بـ`posix_spawn`** (‏ينتظرُ الحائلُ خروجَه، ويُجهِضُ عندَ فشلِه) بدلَ FIFO وإقرار — الضمانُ نفسُه: العلامةُ في السجلِّ قبلَ عودةِ النداءِ إلى الكاتب.

## 2. النتيجة

التشغيلةُ [`41206970829`](https://github.com/ovvvog/xuux/actions/runs/41206970829) (‏المحاولتانِ 1 و2) على رأسِ فرعِ الاستقصاءِ `5fe1e8ad` — وهوَ
كودُ ع١ نفسُه (‏الفرقُ عن فرعِ الميزةِ: ملفُّ سيرِ العملِ المؤقّتُ وسطرٌ في سجلِّ الأعمالِ فقط). ext4 بـ`commit=600`، قطعٌ بإعادةِ
سجلِّ `dm-log-writes` لا فقدَ طاقةٍ فعليّ.

| n | الموضع | الاسمُ الأساسيّ | witness (PLD1) | mutate (PLD2) | early (PLD3) | PROTO (الثلاثة) |
|---|---|---|---|---|---|---|
| 1 | BOOT | `root-of-trust.manifest.json` | DURABLE ✅ | LOST:CONTENT (مرصود) | LOST:CONTENT (مرصود) | `BOOT_OK`، `cmd-cut=unknown` |
| 2 | BOOT | `root-of-trust.manifest.json` | DURABLE ✅ | LOST:CONTENT (مرصود) | LOST:CONTENT (مرصود) | `BOOT_OK`، `unknown` |
| 3 | M1 | `root-of-trust.undo.jsonl` | DURABLE ✅ | LOST:CONTENT (مرصود) | LOST:CONTENT (مرصود) | `BOOT_OK`، `unknown` |
| 4 | M2 | `root-of-trust.manifest.json` | DURABLE ✅ | **LOST:CONTENT ✅ مطلوب** | **LOST:CONTENT ✅ مطلوب** | `BOOT_OK`، `unknown` |
| 5 | M3 | `commands.ledger.claims/<hash>` | DURABLE ✅ | LOST:MISSING (مرصود) | LOST:MISSING (مرصود) | `BOOT_OK`، `unknown` |
| 6 | M4 | `root-of-trust.manifest.json` | DURABLE ✅ | **LOST:CONTENT ✅ مطلوب** | **LOST:CONTENT ✅ مطلوب** | `BOOT_OK`، **`committed`** |

- **قابليّةُ الإعادة:** أُعيدَ التشغيلُ نفسُه (‏المحاولةُ 2، المهمّةُ `124556596468`؛ والأولى `124553935055`) فجاءت الأسطرُ الـ87 في §3 **مطابقةً حرفاً بحرف**.
- **الحزام:** في الأوضاعِ الثلاثة: المعاملةُ أقرّت (‏ACK)، و6 علاماتٍ وُضِعَت (‏`out_of_scope=0`)، وترتيبُ الأحداثِ سليم (‏`broken=0`)، والمواضعُ المطلوبةُ حاضرة (‏`M2+M4=2`)، و`e2fsck` نظيفٌ عندَ العلاماتِ الثماني عشرة.
- **كشفت العلاماتُ المواضعَ المتوقّعةَ كلَّها:** ستّةٌ بالترتيبِ المتوقَّعِ من `WL-503` §2، ولا موضعَ خارجَ النطاق.
- **`LOST:CONTENT`** يعني: الاسمُ موجودٌ لكنّه يشيرُ إلى المحتوى القديم، والملفُّ المؤقّتُ (‏`…json.tmp-<pid>`) ما زالَ حاضراً — أي أنّ `rename` لم يدُم. **`LOST:MISSING`:** ربطُ المطالبةِ غائب.
- **الفصلُ بينَ الاسمِ والبروتوكول (‏الأهمّ):** عندَ M4 تحتَ الطفرةِ الاسمُ **غيرُ دائمٍ** والبروتوكولُ مع ذلك يستعيدُ إلى `committed` (‏قاعدةُ `B3` تُتمُّ الترقيةَ). فنتيجةُ البروتوكولِ وحدَها لا تشهدُ لدوامِ الاسم — وهذا ما قرّرهُ تحليلُ `WL-503` §3.2، مقيساً الآنَ عندَ الموضعِ نفسِه.

### تناقضٌ معلَنٌ معَ التنبّؤِ السابق

تحليلُ `WL-503` §4.1 تنبّأ بأنّ M1 وM3 **يبقيانِ أخضرَين** تحتَ الطفرةِ (‏مغطَّيَينِ بيوميّاتِ ext4). **المقيسُ خلافُه:** سقطا (‏`LOST`).
والتفسيرُ: الآليّةُ (‏أ) تعملُ عندَ **أوّلِ `fsync` ملفٍّ لاحقٍ**، والعلامةُ الدقيقةُ تقعُ قبلَه — فهيَ تغطّي القطعَ عندَ حدودِ المراحلِ
(‏ما قاسَهُ `WL-502`) لا القطعَ في النافذةِ الضيّقة. **لم يُعدَّلْ معيارُ النجاح:** بقيَ M2/M4 مطلوبَين، وM1/M3/BOOT `OBSERVED` بلا حكم.

### ما لم يُثبَتْ

1. أنّ النافذةَ الضيّقةَ قابلةٌ للحدوثِ بفقدِ طاقةٍ فعليّ — القطعُ هنا إعادةُ سجلِّ كتلٍ، لا عتادٌ ولا ذاكرةُ تخزينٍ مؤقّت.
2. سلوكُ أنظمةِ ملفّاتٍ أخرى أو ext4 بلا يوميّات (‏ع٢، غيرُ مفوَّض).
3. أنّ `PLM` صارَ يرى الطفرة — `PLM` لم يُمَسّ (‏ع٣، غيرُ مفوَّض)؛ ع١ مِحكٌّ موازٍ لا بديل.
4. `D3` البروتوكوليُّ (‏لا ACK قبلَ الدوام) — ع١ يقيسُ «الاسمُ دائمٌ عندَ عودةِ مزامنةِ المجلّد» لا `D3`.

## 3. الأسطرُ الحرفيّة (‏التشغيلة `41206970829`)

```text
LIVE39_DIRSYNC_SUMMARY mode=witness marks=6 out_of_scope=0
PASS|HARNESS|dirsync-witness/transaction|ACK
MARKREC|1|witness|BOOT|BOOT|/mnt/lw505/root/root-of-trust.manifest.json|ok
MARKREC|2|witness|BOOT|BOOT|/mnt/lw505/root/root-of-trust.manifest.json|ok
MARKREC|3|witness|M1|TXN|/mnt/lw505/root/root-of-trust.undo.jsonl|ok
MARKREC|4|witness|M2|TXN|/mnt/lw505/root/root-of-trust.manifest.json|ok
MARKREC|5|witness|M3|S2|/mnt/lw505/root/commands.ledger.claims/942444ab8d6993e4d84e6770d3b9b4576816ff7d11e45056a206c60d6d8023c8|ok
MARKREC|6|witness|M4|S4|/mnt/lw505/root/root-of-trust.manifest.json|ok
PASS|HARNESS|dirsync-witness/marks-placed|marks=6
PASS|HARNESS|dirsync-witness/mark-order|broken=0
PASS|PLD1|dirsync-witness/n1/BOOT/root-of-trust.manifest.json|DURABLE
PASS|PL4|dirsync-witness/n1|e2fsck
PROTO|dirsync-witness/n1|site=BOOT|name=DURABLE|protocol=BOOT_OK STATE:cmd-cut=unknown|order=ok
PASS|PLD1|dirsync-witness/n2/BOOT/root-of-trust.manifest.json|DURABLE
PASS|PL4|dirsync-witness/n2|e2fsck
PROTO|dirsync-witness/n2|site=BOOT|name=DURABLE|protocol=BOOT_OK STATE:cmd-cut=unknown|order=ok
PASS|PLD1|dirsync-witness/n3/TXN/root-of-trust.undo.jsonl|DURABLE
PASS|PL4|dirsync-witness/n3|e2fsck
PROTO|dirsync-witness/n3|site=M1|name=DURABLE|protocol=BOOT_OK STATE:cmd-cut=unknown|order=ok
PASS|PLD1|dirsync-witness/n4/TXN/root-of-trust.manifest.json|DURABLE
PASS|PL4|dirsync-witness/n4|e2fsck
PROTO|dirsync-witness/n4|site=M2|name=DURABLE|protocol=BOOT_OK STATE:cmd-cut=unknown|order=ok
PASS|PLD1|dirsync-witness/n5/S2/942444ab8d6993e4d84e6770d3b9b4576816ff7d11e45056a206c60d6d8023c8|DURABLE
PASS|PL4|dirsync-witness/n5|e2fsck
PROTO|dirsync-witness/n5|site=M3|name=DURABLE|protocol=BOOT_OK STATE:cmd-cut=unknown|order=ok
PASS|PLD1|dirsync-witness/n6/S4/root-of-trust.manifest.json|DURABLE
PASS|PL4|dirsync-witness/n6|e2fsck
PROTO|dirsync-witness/n6|site=M4|name=DURABLE|protocol=BOOT_OK STATE:cmd-cut=committed|order=ok
PASS|HARNESS|dirsync-witness/required-sites|M2+M4=2
LIVE39_DIRSYNC_SUMMARY mode=mutate marks=6 out_of_scope=0
PASS|HARNESS|dirsync-mutate/transaction|ACK
MARKREC|1|mutate|BOOT|BOOT|/mnt/lw505/root/root-of-trust.manifest.json|ok
MARKREC|2|mutate|BOOT|BOOT|/mnt/lw505/root/root-of-trust.manifest.json|ok
MARKREC|3|mutate|M1|TXN|/mnt/lw505/root/root-of-trust.undo.jsonl|ok
MARKREC|4|mutate|M2|TXN|/mnt/lw505/root/root-of-trust.manifest.json|ok
MARKREC|5|mutate|M3|S2|/mnt/lw505/root/commands.ledger.claims/942444ab8d6993e4d84e6770d3b9b4576816ff7d11e45056a206c60d6d8023c8|ok
MARKREC|6|mutate|M4|S4|/mnt/lw505/root/root-of-trust.manifest.json|ok
PASS|HARNESS|dirsync-mutate/marks-placed|marks=6
PASS|HARNESS|dirsync-mutate/mark-order|broken=0
OBSERVED|PLD2|dirsync-mutate/n1/BOOT/root-of-trust.manifest.json|site=BOOT|primary=LOST:CONTENT:/mnt/lw505/root/root-of-trust.manifest.json
PASS|PL4|dirsync-mutate/n1|e2fsck
PROTO|dirsync-mutate/n1|site=BOOT|name=LOST:CONTENT:/mnt/lw505/root/root-of-trust.manifest.json|protocol=BOOT_OK STATE:cmd-cut=unknown|order=ok
OBSERVED|PLD2|dirsync-mutate/n2/BOOT/root-of-trust.manifest.json|site=BOOT|primary=LOST:CONTENT:/mnt/lw505/root/root-of-trust.manifest.json
PASS|PL4|dirsync-mutate/n2|e2fsck
PROTO|dirsync-mutate/n2|site=BOOT|name=LOST:CONTENT:/mnt/lw505/root/root-of-trust.manifest.json|protocol=BOOT_OK STATE:cmd-cut=unknown|order=ok
OBSERVED|PLD2|dirsync-mutate/n3/TXN/root-of-trust.undo.jsonl|site=M1|primary=LOST:CONTENT:/mnt/lw505/root/root-of-trust.undo.jsonl
PASS|PL4|dirsync-mutate/n3|e2fsck
PROTO|dirsync-mutate/n3|site=M1|name=LOST:CONTENT:/mnt/lw505/root/root-of-trust.undo.jsonl|protocol=BOOT_OK STATE:cmd-cut=unknown|order=ok
PASS|PLD2|dirsync-mutate/n4/TXN/root-of-trust.manifest.json|LOST:CONTENT:/mnt/lw505/root/root-of-trust.manifest.json
PASS|PL4|dirsync-mutate/n4|e2fsck
PROTO|dirsync-mutate/n4|site=M2|name=LOST:CONTENT:/mnt/lw505/root/root-of-trust.manifest.json|protocol=BOOT_OK STATE:cmd-cut=unknown|order=ok
OBSERVED|PLD2|dirsync-mutate/n5/S2/942444ab8d6993e4d84e6770d3b9b4576816ff7d11e45056a206c60d6d8023c8|site=M3|primary=LOST:MISSING:/mnt/lw505/root/commands.ledger.claims/942444ab8d6993e4d84e6770d3b9b4576816ff7d11e45056a206c60d6d8023c8
PASS|PL4|dirsync-mutate/n5|e2fsck
PROTO|dirsync-mutate/n5|site=M3|name=LOST:MISSING:/mnt/lw505/root/commands.ledger.claims/942444ab8d6993e4d84e6770d3b9b4576816ff7d11e45056a206c60d6d8023c8|protocol=BOOT_OK STATE:cmd-cut=unknown|order=ok
PASS|PLD2|dirsync-mutate/n6/S4/root-of-trust.manifest.json|LOST:CONTENT:/mnt/lw505/root/root-of-trust.manifest.json
PASS|PL4|dirsync-mutate/n6|e2fsck
PROTO|dirsync-mutate/n6|site=M4|name=LOST:CONTENT:/mnt/lw505/root/root-of-trust.manifest.json|protocol=BOOT_OK STATE:cmd-cut=committed|order=ok
PASS|HARNESS|dirsync-mutate/required-sites|M2+M4=2
LIVE39_DIRSYNC_SUMMARY mode=early marks=6 out_of_scope=0
PASS|HARNESS|dirsync-early/transaction|ACK
MARKREC|1|early|BOOT|BOOT|/mnt/lw505/root/root-of-trust.manifest.json|ok
MARKREC|2|early|BOOT|BOOT|/mnt/lw505/root/root-of-trust.manifest.json|ok
MARKREC|3|early|M1|TXN|/mnt/lw505/root/root-of-trust.undo.jsonl|ok
MARKREC|4|early|M2|TXN|/mnt/lw505/root/root-of-trust.manifest.json|ok
MARKREC|5|early|M3|S2|/mnt/lw505/root/commands.ledger.claims/942444ab8d6993e4d84e6770d3b9b4576816ff7d11e45056a206c60d6d8023c8|ok
MARKREC|6|early|M4|S4|/mnt/lw505/root/root-of-trust.manifest.json|ok
PASS|HARNESS|dirsync-early/marks-placed|marks=6
PASS|HARNESS|dirsync-early/mark-order|broken=0
OBSERVED|PLD3|dirsync-early/n1/BOOT/root-of-trust.manifest.json|site=BOOT|primary=LOST:CONTENT:/mnt/lw505/root/root-of-trust.manifest.json
PASS|PL4|dirsync-early/n1|e2fsck
PROTO|dirsync-early/n1|site=BOOT|name=LOST:CONTENT:/mnt/lw505/root/root-of-trust.manifest.json|protocol=BOOT_OK STATE:cmd-cut=unknown|order=ok
OBSERVED|PLD3|dirsync-early/n2/BOOT/root-of-trust.manifest.json|site=BOOT|primary=LOST:CONTENT:/mnt/lw505/root/root-of-trust.manifest.json
PASS|PL4|dirsync-early/n2|e2fsck
PROTO|dirsync-early/n2|site=BOOT|name=LOST:CONTENT:/mnt/lw505/root/root-of-trust.manifest.json|protocol=BOOT_OK STATE:cmd-cut=unknown|order=ok
OBSERVED|PLD3|dirsync-early/n3/TXN/root-of-trust.undo.jsonl|site=M1|primary=LOST:CONTENT:/mnt/lw505/root/root-of-trust.undo.jsonl
PASS|PL4|dirsync-early/n3|e2fsck
PROTO|dirsync-early/n3|site=M1|name=LOST:CONTENT:/mnt/lw505/root/root-of-trust.undo.jsonl|protocol=BOOT_OK STATE:cmd-cut=unknown|order=ok
PASS|PLD3|dirsync-early/n4/TXN/root-of-trust.manifest.json|LOST:CONTENT:/mnt/lw505/root/root-of-trust.manifest.json
PASS|PL4|dirsync-early/n4|e2fsck
PROTO|dirsync-early/n4|site=M2|name=LOST:CONTENT:/mnt/lw505/root/root-of-trust.manifest.json|protocol=BOOT_OK STATE:cmd-cut=unknown|order=ok
OBSERVED|PLD3|dirsync-early/n5/S2/942444ab8d6993e4d84e6770d3b9b4576816ff7d11e45056a206c60d6d8023c8|site=M3|primary=LOST:MISSING:/mnt/lw505/root/commands.ledger.claims/942444ab8d6993e4d84e6770d3b9b4576816ff7d11e45056a206c60d6d8023c8
PASS|PL4|dirsync-early/n5|e2fsck
PROTO|dirsync-early/n5|site=M3|name=LOST:MISSING:/mnt/lw505/root/commands.ledger.claims/942444ab8d6993e4d84e6770d3b9b4576816ff7d11e45056a206c60d6d8023c8|protocol=BOOT_OK STATE:cmd-cut=unknown|order=ok
PASS|PLD3|dirsync-early/n6/S4/root-of-trust.manifest.json|LOST:CONTENT:/mnt/lw505/root/root-of-trust.manifest.json
PASS|PL4|dirsync-early/n6|e2fsck
PROTO|dirsync-early/n6|site=M4|name=LOST:CONTENT:/mnt/lw505/root/root-of-trust.manifest.json|protocol=BOOT_OK STATE:cmd-cut=committed|order=ok
PASS|HARNESS|dirsync-early/required-sites|M2+M4=2
```
