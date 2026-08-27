/**
 * فصلُ المصالح: مصلحةٌ تُقرأ من البيانات لا مصلحةٌ تُعلَن — الخطوة M8.04
 *
 * **العيبُ الذي يُغلقه هذا الملف:** كان شرطُ «القاضي ليس طرفاً» في الخطوة M8.03
 * فحصاً واحداً ضيّقاً: `judge === claimant || judge === respondent`. وهو يمنع
 * أفجرَ صورةٍ للتعارض ويترك ما هو أقربُ منها إلى الواقع: أن يكون القاضي **مالكَ
 * هويةِ** أحد الخصوم (`owner` في `state.agents`)، أو أن يكون هو نفسُه هويةً
 * **يملكها** خصمٌ في القضية، أو أن يشتركا في مالكٍ واحد، أو أن يعود القاضي الذي
 * حكم فينظر القضيةَ نفسَها بعد استئناف حكمِه — وهو نصُّ المادة 11: «ولا يُراجع
 * أحدٌ عملَ نفسه».
 *
 * **وقاعدةُ هذا الملف أنّ المصلحةَ واقعةٌ في الجدول لا إعلانٌ في وثيقة:** كلُّ
 * قاعدةٍ هنا تُقرأ من صفٍّ قائمٍ في سجلِّ الوكلاء أو من صفِّ القضية نفسِه. ولذلك
 * هي **قابلةٌ للتزييف**: يسجَّل وكيلٌ مالكُه القاضي فيُرفض السماع، ويُغيَّر المالك
 * فيُقبل. ولو كانت المصلحةُ سجلَّ تصريحاتٍ يكتبه صاحبُ المصلحة نفسُه لكان
 * «الفصلُ» إقراراً يُوقّعه من له الإقرار.
 *
 * **حدٌّ معلَن أول:** المالكُ السياديُّ `crown` مستثنىً من قاعدة «المالكُ
 * الواحد». وهو مالكُ كلِّ هويةٍ تُسجَّل بلا مالكٍ مصرَّح (القيمةُ الافتراضية في
 * `AgentRegistry.register`)، فلو لم يُستثنَ لصار كلُّ قاضٍ ذا مصلحةٍ في كل قضيةٍ
 * فيُعطَّل الفحصُ كلُّه عملياً. والاستثناءُ مكتوبٌ هنا لا مُخفىً، ورفعُ الاستثناء
 * ممكنٌ حين تصير المُلكيةُ مُصرَّحةً في كل تسجيل.
 *
 * **حدٌّ معلَن ثانٍ:** لا يقيس هذا الملفُّ مصلحةً خارج بيانات الدولة — قرابةً ولا
 * انتفاعاً ماليّاً ولا انتماءً مؤسسيّاً — لأنها ليست حقولاً في هذا المستودع.
 * وسجلُّ المصالح المُصرَّحة خطوةٌ مسجَّلةٌ في `docs/REMAINING_WORK.md` لا
 * مُدَّعاةٌ هنا.
 */

import { JUDICIARY_ERRORS, JudiciaryError } from './judiciary.mjs';

/** @typedef {Record<string, unknown>} CaseRow */
/** @typedef {{ get: (id: string) => Promise<Record<string, unknown> | null> }} AgentLookup */

/**
 * المالكُ السياديُّ: القيمةُ الافتراضيةُ لمالك كلِّ هويةٍ تُسجَّل بلا مالكٍ
 * مصرَّح. ومشاركتُه ليست مصلحةً خاصّة (انظر الحدَّ المُعلَن الأول في رأس الملف).
 */
export const SOVEREIGN_OWNER = 'crown';

/**
 * قواعدُ التعارض المقيسة. كلُّ قاعدةٍ لها معرّفٌ يُنشر في الحدث ويُقرأ في
 * التدقيق، فالرفضُ يقول **بأيِّ قاعدةٍ** رُفض لا «تعارضُ مصالح» مجرّدةً.
 */
export const CONFLICT_RULES = Object.freeze([
  Object.freeze({
    id: 'judge-owns-party',
    statement: 'القاضي مالكُ هويةِ خصمٍ في القضية؛ ومن يملك الهويةَ له في أمرها مصلحة.',
  }),
  Object.freeze({
    id: 'party-owns-judge',
    statement: 'القاضي هويةٌ يملكها خصمٌ في القضية؛ ومن يملك القاضيَ يملك حكمَه.',
  }),
  Object.freeze({
    id: 'shared-owner',
    statement: 'القاضي وخصمٌ في القضية هويتان لمالكٍ واحدٍ غيرِ سياديّ.',
  }),
  Object.freeze({
    id: 'self-review-after-appeal',
    statement: 'القاضي الذي حكم لا ينظر القضيةَ بعد استئناف حكمِه؛ ولا يُراجع أحدٌ عملَ نفسه.',
  }),
]);

/**
 * يقرأ صفَّ هويةٍ إن كان المعرّفُ هويةً مسجَّلة، ويردّ `null` لغيرها. والأدوارُ
 * (`role:chief-justice`) ليست هوياتٍ مسجَّلةً فلا صفَّ لها — وهذا مقصودٌ لا
 * إخفاق: القاضي قد يكون دوراً وقد يكون هويةً، والقاعدةُ تُطبَّق على ما وُجد.
 * @param {AgentLookup} agents
 * @param {unknown} id
 * @returns {Promise<Record<string, unknown> | null>}
 */
async function recordOf(agents, id) {
  if (typeof id !== 'string' || id === '') return null;
  try {
    return await agents.get(id);
  } catch {
    // صفٌّ تالفٌ أو غيرُ مقروء لا يُقرأ «لا تعارضَ»: يُعامَل كغائبٍ فتسقط قاعدتُه
    // وحدها، وتبقى القواعدُ الأخرى. والرفضُ عند غياب الفحص كلِّه في
    // `screenJudicialInterest` نفسِه لا هنا.
    return null;
  }
}

/**
 * يفحص مصلحةَ قاضٍ في قضيةٍ بعينها.
 *
 * الرفضُ **لا يقع هنا**: الدالّةُ تردّ القاعدةَ التي تحقّقت أو `null`، ومن يستدعي
 * هو الذي يرفض ويُسجِّل الحادثة. وهذا كي يبقى موضعُ النشر والرفض واحداً في
 * `court.mjs` فلا تنشأ أحداثٌ من موضعين بعقدين.
 *
 * وغيابُ سجلِّ الوكلاء مع كون الفحص لازماً **رفضٌ لا تجاوز**: فحصٌ لا سبيلَ إلى
 * إجرائه لا يُفترض نجاحُه (وهذا هو الفرقُ بين ضابطٍ مربوطٍ بمسارٍ حقيقيٍّ وضابطٍ
 * ككودٍ معلَّق).
 * @param {object} input
 * @param {string} input.judge
 * @param {CaseRow} input.row
 * @param {AgentLookup | null} input.agents
 * @param {boolean} input.required
 * @returns {Promise<{ rule: string, detail: string } | null>}
 */
export async function screenJudicialInterest({ judge, row, agents, required }) {
  if (agents === null || agents === undefined) {
    if (!required) return null;
    throw new JudiciaryError(
      JUDICIARY_ERRORS.INTEREST_SCREENING_UNAVAILABLE,
      'فحصُ المصلحة لازمٌ ولا سجلَّ هوياتٍ مركَّباً يُقرأ منه المالك؛ وفحصٌ لا يُجرى لا يُفترض نجاحُه.',
    );
  }
  const parties = [row['claimant'], row['respondent']].filter(
    (party) => typeof party === 'string' && party !== '',
  );
  const judgeRecord = await recordOf(agents, judge);
  for (const party of parties) {
    const partyRecord = await recordOf(agents, party);
    if (partyRecord !== null && partyRecord['owner'] === judge) {
      return {
        rule: 'judge-owns-party',
        detail: `${judge} مالكُ هويةِ الخصم ${String(party)}؛ ومن يملك الهويةَ له في أمرها مصلحة.`,
      };
    }
    if (judgeRecord !== null && judgeRecord['owner'] === party) {
      return {
        rule: 'party-owns-judge',
        detail: `القاضي ${judge} هويةٌ يملكها الخصمُ ${String(party)}؛ ومن يملك القاضيَ يملك حكمَه.`,
      };
    }
    if (
      judgeRecord !== null &&
      partyRecord !== null &&
      typeof judgeRecord['owner'] === 'string' &&
      judgeRecord['owner'] !== SOVEREIGN_OWNER &&
      judgeRecord['owner'] === partyRecord['owner']
    ) {
      return {
        rule: 'shared-owner',
        detail: `القاضي ${judge} والخصمُ ${String(party)} هويتان لمالكٍ واحد (${String(judgeRecord['owner'])}).`,
      };
    }
  }
  // ولا يعود من حكم لينظر القضيةَ نفسَها بعد استئناف حكمِه.
  if (row['appealedAt'] instanceof Date && row['judge'] === judge) {
    return {
      rule: 'self-review-after-appeal',
      detail: `${judge} حكم في القضية واستُؤنف حكمُه؛ ولا ينظر أحدٌ استئنافَ حكمِ نفسه.`,
    };
  }
  return null;
}

/**
 * قائمةُ المتنحّين المقروءةُ من صفِّ القضية. والقراءةُ متسامحةٌ في الشكل
 * (`undefined` أو `null` أو مصفوفة) لأنّ الحقلَ يُكتب بعد الهجرة 0013 وقد يقرأ
 * الكودُ صفوفاً كُتبت قبلها.
 * @param {CaseRow} row
 * @returns {readonly string[]}
 */
export function recusedJudgesOf(row) {
  const value = row['recusedJudges'];
  if (!Array.isArray(value)) return [];
  return value.filter((entry) => typeof entry === 'string');
}
