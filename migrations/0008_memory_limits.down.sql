-- تراجع الهجرة 0008.
--
-- **يُعيد بابَ الذاكرة الأبديّة بإعلانه:** بسقوط `memories_expiry_required` يصير
-- مدخلٌ بلا تاريخ انتهاء ولا حفظٍ قانوني مقبولاً في القاعدة مرّةً أخرى، ودورةُ
-- المحو تعود قادرةً على المرور بصفر صفوف وإعلان النجاح. وحدُّ الانتهاء يبقى
-- مفروضاً في الكود (`config/memory.yaml` + `src/data/memory-limits.mjs`) — والقاعدة
-- تكفّ عن كونها الضمان الأخير.
--
-- ولا صفٌّ يُحذف ولا عمودٌ يُفرَّغ: التراجع يُسقط قيداً وفهرساً، والصفوف التي
-- كُتب لها انتهاءٌ تبقى بانتهائها.

DROP INDEX state.memories_agent_expiry_idx;

ALTER TABLE state.memories
  DROP CONSTRAINT memories_expiry_required;

COMMENT ON COLUMN state.memories.expires_at IS NULL;
