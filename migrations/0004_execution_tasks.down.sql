-- تراجع الهجرة 0004.
--
-- **يفقد بياناً بإعلانه:** كل مهمة في الطابور وكل انتقال في دفترها وكل رسالة
-- ميتة تُحذف. لا تراجع «بلا خسارة» عن جدولٍ هو مكان الحالة نفسها؛ ومن أراد
-- الاحتفاظ فليأخذ نسخة (`npm run backup`) قبل التراجع.
--
-- الترتيب مقصود: المُشير قبل المُشار إليه، والمجال بعد كل ما يستعمله.

DROP TABLE state.task_dead_letters;
DROP TABLE state.task_transitions;
DROP TABLE state.tasks;
DROP DOMAIN state.task_state;
