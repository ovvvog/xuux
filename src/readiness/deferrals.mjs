/**
 * التحقّقُ من التأجيلاتِ المُصرَّحةِ — الخطوة `M11.08`.
 *
 * **الضمانُ `G-READINESS-DEFERRAL-DECLARED-NOT-IMPLIED`:** التأجيلُ لا يُستنتَج من
 * غيابِ الدليلِ. فبندٌ غيرُ منجَزٍ **بلا سطرِ تأجيلٍ مُصرَّحٍ** يُوقِف الحكمَ، وبندٌ
 * مؤجَّلٌ بسببٍ بلا حاجزٍ، أو بحاجزٍ بلا شرطِ فكٍّ، أو بشرطٍ بلا صاحبِ قرارٍ، أو
 * بمُدخلةِ إعلانٍ لا وجودَ لها في سجلِّ العملِ — تأجيلٌ ناقصٌ يُقرأ عذراً لا إعلاناً.
 *
 * **وتأجيلٌ يتيمٌ** (لبندٍ لا وجودَ له في المصادرِ، أو لبندٍ **مُنجَزٍ** ✅) يُوقِف
 * الحكمَ أيضاً: فسجلُّ تأجيلاتٍ يحمل بنداً أُنجِزَ يُبقي على قارئِه انطباعاً كاذباً
 * بأنّ العملَ ما زال محجوباً — والعكسُ أخطرُ: تأجيلٌ يبقى بعدَ فكِّ حاجزِه يُخفي
 * أنّ الحاجزَ زالَ ولم يُستأنَفِ العملُ.
 *
 * والوحدةُ **نقيّةٌ**: سجلٌّ مقروءٌ يدخل، وحكمُ اكتمالِه يخرج.
 *
 * @module readiness/deferrals
 */

import { READINESS_ERRORS } from './errors.mjs';

const REQUIRED_FIELDS = Object.freeze([
  'id',
  'kind',
  'title',
  'reason',
  'blocker',
  'blockerKind',
  'unblockCondition',
  'authority',
  'declaredIn',
]);

/**
 * @typedef {object} DeferralRecord
 * @property {string} id
 * @property {string} kind
 * @property {string} title
 * @property {string} reason
 * @property {string} blocker
 * @property {string} blockerKind
 * @property {string} unblockCondition
 * @property {string} authority
 * @property {string} declaredIn
 */

/**
 * @typedef {object} DeferralFault
 * @property {string} code
 * @property {string} id
 * @property {string} evidence
 */

/**
 * يُثبت أنّ كلَّ تأجيلٍ كاملُ الحقولِ، ومُدخلةُ إعلانِه موجودةٌ فعلاً، وأنّه ليس
 * تأجيلاً يتيماً ولا تأجيلاً لبندٍ مُنجَزٍ.
 *
 * @param {DeferralRecord[]} deferrals
 * @param {{ knownIds: Set<string>, completedIds: Set<string>, workLogIds: Set<string> }} facts
 * @returns {DeferralFault[]}
 */
export function auditDeferrals(deferrals, facts) {
  /** @type {DeferralFault[]} */
  const faults = [];
  for (const deferral of deferrals) {
    const id = String(deferral.id ?? 'بلا معرِّف');
    for (const field of REQUIRED_FIELDS) {
      const value = /** @type {Record<string, unknown>} */ (deferral)[field];
      if (typeof value !== 'string' || value.trim() === '') {
        faults.push({
          code: READINESS_ERRORS.DEFERRAL_INCOMPLETE,
          id,
          evidence: `الحقلُ «${field}» غائبٌ أو فارغٌ — وتأجيلٌ ناقصُ حقلٍ عذرٌ لا إعلانٌ.`,
        });
      }
    }
    if (!facts.knownIds.has(id)) {
      faults.push({
        code: READINESS_ERRORS.DEFERRAL_ORPHAN,
        id,
        evidence: 'تأجيلٌ لبندٍ لا وجودَ له في مصادرِ البنودِ — تأجيلٌ يتيمٌ.',
      });
    }
    if (facts.completedIds.has(id)) {
      faults.push({
        code: READINESS_ERRORS.DEFERRAL_ORPHAN,
        id,
        evidence: 'البندُ مُعلَنٌ مُنجَزاً ✅ ومؤجَّلٌ في السجلِّ معاً — أحدُهما كاذبٌ.',
      });
    }
    if (typeof deferral.declaredIn === 'string' && !facts.workLogIds.has(deferral.declaredIn)) {
      faults.push({
        code: READINESS_ERRORS.DEFERRAL_UNDECLARED,
        id,
        evidence: `مُدخلةُ الإعلانِ «${deferral.declaredIn}» لا وجودَ لها في سجلِّ العملِ.`,
      });
    }
  }
  return faults;
}
