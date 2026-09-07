-- تراجعُ الهجرةِ 0019 — إزالةُ عمودَي ظرفِ التوقيعِ. يُفقدُ هذا التراجعُ سجلَّ
-- نوعِ العمليةِ والنسخةِ الأصليةِ للتراجعِ، فلا يُعادُ بناءُ الظرفِ من الصفِّ
-- بعدَها. قبلَ تنفيذِه على قاعدةٍ استُعملت فعلاً يلزمُ أخذُ نسخةٍ احتياطيّةٍ.

ALTER TABLE state.policy_versions
  DROP CONSTRAINT IF EXISTS policy_versions_signature_kind_consistent;

ALTER TABLE state.policy_versions
  DROP COLUMN IF EXISTS rollback_from_version,
  DROP COLUMN IF EXISTS signature_kind;
