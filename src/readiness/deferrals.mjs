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
 * **والضمانُ `G-READINESS-DEFERRAL-REVIEW-DATED`:** التأجيلُ **موقوتٌ لا مفتوحٌ**.
 * فلكلِّ تأجيلٍ وتيرةُ إعادةِ نظرٍ مقرَّرةٌ في سياسةِ سلطتِه وتاريخُ آخرِ مراجعةٍ
 * ومُدخلةُ قرارٍ، ومنها يُحسَبُ موعدُ مراجعتِه القادمةِ. ووتيرةٌ تُخالفُ سياستَها
 * أو موعدٌ فاتَ بلا مراجعةٍ يُوقِفُ الحكمَ — فشرطُ فكٍّ مكتوبٌ بلا موعدِ سؤالٍ
 * يُبقي التأجيلَ دهراً بلا أن يُسألَ عنه أحدٌ (إغلاقُ الدَّينِ `LIVE-3`).
 *
 * واليومُ **يدخلُ وسيطاً** لا يُقرأُ من ساعةِ النظامِ: فمن قاسَ الفَواتَ قاسَه
 * بيومٍ يُمرَّرُ إليه، وتبقى الوحدةُ نقيّةً يُعادُ حكمُها بالحرفِ.
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

/** حقولُ إعادةِ النظرِ الإلزاميّةُ داخلَ `recheck` — إغلاقُ الدَّينِ `LIVE-3`. */
export const RECHECK_REQUIRED_FIELDS = Object.freeze(['cadence', 'lastReviewedOn', 'decidedIn']);

/** الوتائرُ المقبولةُ: شهرٌ أو ثلاثةٌ — بصيغةِ مدّةٍ لا بعددٍ عارٍ. */
export const RECHECK_CADENCES = Object.freeze({ P1M: 1, P3M: 3 });

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/u;

/**
 * تاريخٌ **مقروءٌ حقّاً**: لا صيغةً تُطابِقُ نمطاً وحدَه. فـ`2026-13-01` يُطابِقُ
 * النمطَ ولا وجودَ لشهرٍ ثالثَ عشرَ — ومن قبِلَه حسبَ منه موعداً في سنةٍ أخرى بصمتٍ.
 *
 * @param {string} text
 * @returns {boolean}
 */
export function isReadableDate(text) {
  if (!ISO_DATE.test(String(text))) return false;
  const [yearText, monthText, dayText] = String(text).split('-');
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
  );
}

/**
 * يُعيدُ عددَ الأشهرِ لوتيرةٍ معلَنةٍ، أو `undefined` لوتيرةٍ لا يعرفُها العقدُ.
 *
 * @param {string} cadence
 * @returns {number | undefined}
 */
export function cadenceMonths(cadence) {
  return /** @type {Record<string, number | undefined>} */ (RECHECK_CADENCES)[String(cadence)];
}

/**
 * وتيرةُ سلطةٍ بعينِها: ما أُعلِنَ لها في `byAuthority`، وإلّا الأساسُ.
 *
 * @param {{ baselineCadence?: string, byAuthority?: Record<string, string> }} policy
 * @param {string} authority
 * @returns {string}
 */
export function cadenceForAuthority(policy, authority) {
  const byAuthority = policy?.byAuthority ?? {};
  const declared = /** @type {Record<string, string | undefined>} */ (byAuthority)[
    String(authority)
  ];
  return declared ?? String(policy?.baselineCadence ?? '');
}

/**
 * موعدُ المراجعةِ القادمةِ = آخرُ مراجعةٍ + الوتيرةُ. حسابٌ **نقيٌّ**: لا ساعةَ
 * نظامٍ تدخلُه، فالموعدُ نفسُه لا يتبدَّلُ بتبدُّلِ يومِ التشغيلِ.
 *
 * @param {string} lastReviewedOn تاريخٌ بصيغةِ `YYYY-MM-DD`.
 * @param {string} cadence
 * @returns {string} تاريخٌ بصيغةِ `YYYY-MM-DD`، أو نصٌّ فارغٌ إن كانَ المُدخَلُ غيرَ مقروءٍ.
 */
export function nextReviewOn(lastReviewedOn, cadence) {
  const months = cadenceMonths(cadence);
  if (months === undefined || !isReadableDate(String(lastReviewedOn))) return '';
  const [yearText, monthText, dayText] = String(lastReviewedOn).split('-');
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const zeroBased = month - 1 + months;
  const targetYear = year + Math.floor(zeroBased / 12);
  const targetMonth = (zeroBased % 12) + 1;
  // آخرُ يومٍ في الشهرِ الهدفِ: من أجّلَ في الحادي والثلاثينَ لا يُقذَفُ به إلى شهرٍ تالٍ.
  const lastDay = new Date(Date.UTC(targetYear, targetMonth, 0)).getUTCDate();
  const targetDay = Math.min(day, lastDay);
  const pad = (/** @type {number} */ value) => String(value).padStart(2, '0');
  return `${String(targetYear).padStart(4, '0')}-${pad(targetMonth)}-${pad(targetDay)}`;
}

/**
 * أفاتَ موعدُ المراجعةِ؟ **واليومُ يدخلُ وسيطاً لا يُقرأُ من ساعةِ النظامِ** — فالوحدةُ
 * تبقى نقيّةً، والمُقرِّرُ بالوقتِ هو الحاجزُ لا وحدةُ الحكمِ.
 *
 * @param {{ lastReviewedOn: string, cadence: string, today: string }} input
 * @returns {boolean}
 */
export function reviewIsOverdue(input) {
  const due = nextReviewOn(input.lastReviewedOn, input.cadence);
  if (due === '' || !isReadableDate(String(input.today))) return false;
  return String(input.today) > due;
}

/**
 * يُثبتُ أنّ لكلِّ تأجيلٍ **موعدَ إعادةِ نظرٍ** لا تاريخاً مفتوحاً: وتيرةً مطابقةً
 * لسياسةِ سلطتِه، وتاريخَ مراجعةٍ أخيرةٍ مقروءَ الصيغةِ غيرَ مستقبَليٍّ، ومُدخلةَ
 * قرارٍ — **وأنّ الموعدَ لم يَفُتْ**. فتأجيلٌ بلا موعدٍ يبقى إلى الأبدِ بلا أن يُسألَ عنه.
 *
 * @param {DeferralRecord[]} deferrals
 * @param {{ policy: { baselineCadence?: string, byAuthority?: Record<string, string> }, today: string, workLogIds?: Set<string> }} facts
 * @returns {DeferralFault[]}
 */
export function auditDeferralReviews(deferrals, facts) {
  /** @type {DeferralFault[]} */
  const faults = [];
  for (const deferral of deferrals) {
    const id = String(deferral.id ?? 'بلا معرِّف');
    const recheck = /** @type {Record<string, string> | undefined} */ (
      /** @type {Record<string, unknown>} */ (deferral).recheck
    );
    if (recheck === undefined || recheck === null || typeof recheck !== 'object') {
      faults.push({
        code: READINESS_ERRORS.DEFERRAL_INCOMPLETE,
        id,
        evidence: 'التأجيلُ بلا قسمِ `recheck` — وتأجيلٌ بلا موعدِ إعادةِ نظرٍ تاريخٌ مفتوحٌ.',
      });
      continue;
    }
    for (const field of RECHECK_REQUIRED_FIELDS) {
      const value = recheck[field];
      if (typeof value !== 'string' || value.trim() === '') {
        faults.push({
          code: READINESS_ERRORS.DEFERRAL_INCOMPLETE,
          id,
          evidence: `حقلُ إعادةِ النظرِ «${field}» غائبٌ أو فارغٌ — فموعدٌ ناقصُ حقلٍ موعدٌ لا يُقاسُ.`,
        });
      }
    }
    const expected = cadenceForAuthority(facts.policy, String(deferral.authority));
    if (recheck.cadence !== undefined && recheck.cadence !== expected) {
      faults.push({
        code: READINESS_ERRORS.DEFERRAL_INCOMPLETE,
        id,
        evidence: `وتيرةُ التأجيلِ «${String(recheck.cadence)}» وسياسةُ سلطتِه «${expected}» — ووتيرةٌ تُكتَبُ بيدٍ خارجَ السياسةِ تُطيلُ الأجلَ بلا قرارٍ.`,
      });
    }
    if (recheck.lastReviewedOn !== undefined && !isReadableDate(String(recheck.lastReviewedOn))) {
      faults.push({
        code: READINESS_ERRORS.DEFERRAL_INCOMPLETE,
        id,
        evidence: `تاريخُ آخرِ مراجعةٍ «${String(recheck.lastReviewedOn)}» ليس بصيغةِ اليومِ المُعلَنةِ — وتاريخٌ لا يُقرأُ لا يُحسَبُ منه موعدٌ.`,
      });
    } else if (
      recheck.lastReviewedOn !== undefined &&
      isReadableDate(String(facts.today)) &&
      String(recheck.lastReviewedOn) > String(facts.today)
    ) {
      faults.push({
        code: READINESS_ERRORS.DEFERRAL_INCOMPLETE,
        id,
        evidence: `تاريخُ آخرِ مراجعةٍ «${String(recheck.lastReviewedOn)}» في المستقبلِ — ومراجعةٌ لم تقعْ لا تُؤرَّخُ.`,
      });
    }
    if (
      facts.workLogIds !== undefined &&
      typeof recheck.decidedIn === 'string' &&
      !facts.workLogIds.has(recheck.decidedIn)
    ) {
      faults.push({
        code: READINESS_ERRORS.DEFERRAL_UNDECLARED,
        id,
        evidence: `مُدخلةُ قرارِ الوتيرةِ «${recheck.decidedIn}» لا وجودَ لها في سجلِّ العملِ.`,
      });
    }
    if (
      typeof recheck.lastReviewedOn === 'string' &&
      typeof recheck.cadence === 'string' &&
      reviewIsOverdue({
        lastReviewedOn: recheck.lastReviewedOn,
        cadence: recheck.cadence,
        today: facts.today,
      })
    ) {
      faults.push({
        code: READINESS_ERRORS.DEFERRAL_REVIEW_OVERDUE,
        id,
        evidence: `موعدُ إعادةِ النظرِ ${nextReviewOn(recheck.lastReviewedOn, recheck.cadence)} فاتَ واليومُ ${String(facts.today)} — فراجِعِ الحاجزَ وسجِّلْ نتيجةَ المراجعةِ بمُدخلةٍ، أو أعلِنْ وتيرةً أخرى بقرارِ صاحبِ السلطةِ.`,
      });
    }
  }
  return faults;
}

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
 * @property {{ cadence: string, lastReviewedOn: string, decidedIn: string }} recheck
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
