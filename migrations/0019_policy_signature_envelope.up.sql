-- هجرة 0019 — ظرفُ التوقيعِ المخزَّنُ لنسخةِ السياسةِ (GPT-F02).
--
-- كان التوقيعُ يُفحَصُ عندَ الاعتمادِ وحدَه؛ فمن يملكُ الكتابةَ المباشرةَ على
-- `state.policy_versions` يستطيعُ تبديلَ الوثيقةِ أو المعتمدِ أو إقحامَ توقيعٍ
-- ملفَّقٍ، فيُمرَّرُ الصفُّ النشطُ إلى المحرّكِ نافذاً بلا كشفٍ. هجرةُ الظرفِ
-- تُلزمُ كلَّ صفٍّ نشطٍ بنوعِ عمليّةٍ صريحٍ (`signature_kind`) وبالنسخةِ
-- الأصليةِ للتراجعِ (`rollback_from_version`)، فيُعادُ التحقّقُ من التوقيعِ عندَ
-- القراءةِ من مادّةٍ قابلةٍ لإعادةِ البناءِ من الصفِّ وحدَه.

ALTER TABLE state.policy_versions
  ADD COLUMN signature_kind text NOT NULL DEFAULT 'approval'
    CHECK (signature_kind IN ('approval', 'rollback')),
  ADD COLUMN rollback_from_version integer
    CHECK (rollback_from_version IS NULL OR rollback_from_version >= 1);

-- اتّساقُ النوعِ مع النسخةِ الأصليةِ: الاعتمادُ بلا نسخةٍ أصليّةٍ، والتراجعُ
-- بنسخةٍ أصليّةٍ. فلا يُقبلُ صفٌّ نشطٌ نوعُهُ غامضٌ.
ALTER TABLE state.policy_versions
  ADD CONSTRAINT policy_versions_signature_kind_consistent CHECK (
    (signature_kind = 'approval' AND rollback_from_version IS NULL)
    OR (signature_kind = 'rollback' AND rollback_from_version IS NOT NULL)
  );
