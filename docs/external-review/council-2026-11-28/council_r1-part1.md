<!-- استُلِمَ 2026-11-28 عبرَ message_agent من /root/council_r1 (claude_opus_5_5) — نصٌّ خامٌّ كما ورد -->
# تقرير المراجِع council_r1 — النموذج: Claude Opus 5.5 — 2026-11-28 (الجزء 1/2)

## ما فحصتُه فعلاً
- استنساخ ovvvog/xuux عند fcb379ca في /home/user/council/council_r1/repo، وعنقود PostgreSQL 18.7 على المنفذ 5501 (القواعد: state مُهاجَرة حتى 37، r1down، r1src (v23 + 3000 صفّ laws)، r1busy).
- قرأتُ 0036 و0037 (up/down) وfence.window_breach وfence.read_window وguard_write (0024) وscripts/restore.mjs (restoreVerifiedArchive/ensureDatabase/settleTransaction) وclipMarkdown/markdownProfile في scripts/lib/project-state.mjs، وtests/helpers/lease-expiry-suite.mjs، وقسم 0037 من tests/persistence/migrator.test.mjs، وتقسيم #637.
- التجارب (كلّها في ملفّاتٍ محلّيّةٍ داخل مجلّدي، ولم يُدفع منها شيء):
  - E1–E5 في tests/fence/zz-r1-probe.test.mjs، وشُغّلت بـ `node --test --test-concurrency=1 --test-timeout=200000 tests/fence/zz-r1-probe.test.mjs`: مؤشّرٌ عبر النافذة، وDELETE/UPDATE/MERGE بخطّة Hash Join، وتسلسل RI عبر الانقضاء.
  - لقطات الكتالوج snap35/36/36b/36c/37.txt: قارنتُ 36 النظيفة بمسار 36→37→down، وجرّبتُ 35↔36.
  - zz-r1-delay.mjs: سباق TOCTOU في restore. وwork/blackhole.mjs: وكيلٌ على المنفذ 5599 يكفّ عن التمرير عند COMMIT دون أن يغلق الاتصال.
  - zz-r1-fuzz.mjs: اختبار clipMarkdown بـ 30000 حالة عشوائيّة، ثم 21025 حالة دون أسطرٍ جديدة.
- لم أشغّل npm test. ولم أشغّل ملفّات اختبارات المستودع نفسها (lease-expiry وrestore-atomicity وguard-project-state)؛ الملفّ الوحيد الذي شغّلتُه هو ملفّ تجاربي.

## ما لم أتمكّن من فحصه ولماذا
- لم أشغّل اختبارات المستودع المستهدفة بسبب ضيق الوقت.
- لم أجرّب أيّ طفرةٍ على الكود. بدأتُ بطفرة «إزالة فحص halt من read_window» ولم أُكملها، فقسم ضعف الاختبارات أدناه قائمٌ على قراءة الكود لا على طفرات.
- لم أختبر: الجداول المقسَّمة، ومسارات COPY/TRUNCATE، ومسارات BYPASSRLS/المالك (قرأتُ الكود فقط)، وبوّابات البروتوكول الموسَّع (Execute بحدّ صفوف؛ لا يوجد pg-cursor)، والتفاف xid، والفشل الحقيقيّ إلى نسخة احتياطيّة، وتغييرات ci.yml وconfig وfence-lab وguard-filecount.
- DOC-33 لم أفحصه إلا بقراءةٍ سطحيّة.

## العيوب المؤكَّدة
1. **[عالٍ] DELETE عبر الانقضاء بخطّة مُخزَّنة (Hash Join) يُطبَّق ويُثبَّت.** الموضع: 0037 up، سياسة DELETE وfence.window_breach (لا WITH CHECK لـ DELETE).
   - الخطوات: بجلسة العامل `SET enable_nestloop=off; SET enable_mergejoin=off;` ثم `DELETE FROM state.r1_t t USING (SELECT x, pg_sleep(CASE WHEN x=2 THEN 12 ELSE 0 END) s FROM generate_series(1,100000) x) q WHERE t.id=q.x RETURNING ...`.
   - المرصود: الخطّة Hash Join وجدول الهدف Seq Scan داخل Hash، فيُقيَّم مرشّح RLS أثناء البناء داخل النافذة. النتيجة ok: حُذف 5 صفوف، 4 منها بعد الانقضاء بـ +11018ms (و+1517ms مع نوم 2.5s)، وثُبّتت (autocommit).
   - للمقارنة بالخطّة نفسها: UPDATE ← 42501 (يلتقطه WITH CHECK)، وMERGE … WHEN MATCHED THEN DELETE ← XF009.
   - ترويسة 0037 تعلن حدّاً «كآخرِ صفٍّ تؤخّرُه زنادُ صفّ»، وهذا أقلّ من الواقع: عدد الصفوف والزمن غير محدودين، ولا حاجة لزناد، والإعدادات (GUCs) في يد العامل.
2. **[عالٍ؛ الأثر فقدان بيانات، ويحتاج سباقاً] TOCTOU في restore.mjs يحذف قاعدةَ غيره.** الموضع: scripts/restore.mjs، restoreVerifiedArchive.
   - السبب: `created` يُحسب بـ `SELECT 1 FROM pg_database` منفصلٍ قبل ensureDatabase، وensureDatabase لا يُبلغ هل أنشأ القاعدة. ثم يُنفّذ finally أمر `DROP DATABASE IF EXISTS` إذا كانت النتيجة undefined و`created` صحيحاً.
   - الخطوات: zz-r1-delay.mjs يؤخّر الفحص الثاني لـ pg_database ثلاث ثوانٍ. خلالها أنشأتُ من جلسةٍ أخرى `CREATE DATABASE r1race; CREATE SCHEMA state; CREATE TABLE state.precious…; INSERT 'someone else data'`.
   - المرصود: طبع restore `⛔ [RESTORE_TARGET_NOT_CLEAN]`، ثم كانت نتيجة فحص وجود r1race صفراً، أي أن قاعدة الضحيّة حُذفت.
   - وفي استعادتين متزامنتين للاسم نفسه: تلقّت الثانية خطأً خاماً بلا اسم `⛔ [23505] duplicate key … pg_datname_index` أو 42P06.
3. **[متوسط] RLS-SILENT-SKIP لم يُغلق للمؤشّرات (القراءة).**
   - الخطوات: `BEGIN; DECLARE cur CURSOR FOR SELECT id FROM state.r1_t ORDER BY id; FETCH 3` داخل النافذة ← 3 صفوف. وبعد الانقضاء `FETCH ALL` ← 0 صفّ بلا خطأ، مع أن 7 صفوف كانت متبقّية.
   - السبب: window_breach تشترط `statement_timestamp() >= upper` لتعيد false، وكلّ FETCH (وكلّ Execute لبوّابة في البروتوكول) يُعيد ضبط statement_timestamp. فيصير الاقتطاع صامتاً ولا يتميّز عن نهاية المؤشّر.
   - لا ذكر لذلك في ترويسة 0037 ولا في الوثائق.
4. **[متوسط] انقطاع شبكةٍ صامت عند COMMIT ⇐ الأداة تتعلّق بلا حدّ والهدف مقفول.**
   - الخطوات: restore مع --force إلى r1busy عبر blackhole (المنفذ 5599).
   - المرصود: لا مخرجات حتى قتلها `timeout 45` (رمز الخروج 124). جلسة الخادم في حالة `idle in transaction`/ClientRead وتحمل 1489 قفلاً من نوع AccessExclusiveLock، ومُستعلِم `count(*)` على state.laws انتهت مهلته (5s).
   - مخرجات pg_restore تضبط `idle_in_transaction_session_timeout=0; transaction_timeout=0; lock_timeout=0; statement_timeout=0`، فتُلغي حمايات المشغّل.
   - الذرّيّة صمدت: بقي الهدف على حالته القديمة، ولم تُرفع الأقفال إلا بإغلاق المقبس. لكن لا مهلة ولا إبلاغ COMMIT_OUTCOME_UNKNOWN. ووكيل الأعطال في الاختبارات يقطع قطعاً نظيفاً فقط.
5. **[منخفض] DOC-32: الطول يخالف الوثيقة.** في 4484 حالة من 21025 (بلا أسطرٍ جديدة) يتجاوز الناتج n بكثير عند مسار الهروب الاحتياطيّ، حتى يقارب 2n، والوثيقة تقول إنه يزيد «بطولِ المُغلِقاتِ وحدَها». مثال: n=12 فيخرج `\*\*b\#\]\*\>\\😀 😀\(`.
