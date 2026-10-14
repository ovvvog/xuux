/**
 * أخطاءُ بوابةِ الميزانيةِ المُسمّاة: تُعرَّفُ هنا لا في `budget.mjs` ولا في
 * `db-recovery.mjs`، كي لا تُنتِجَ دورةَ استيرادٍ بينهما.
 *
 * `BudgetOutcomeUnknown` خطأٌ مُسمّى يرميه مُنفِّذُ بوابةِ الميزانيةِ عند تعذُّرِ
 * إثباتِ نتيجةِ الخصم. يُميَّز ليصلَ إلى مُصنِّفِ عطبِ قاعدةِ البياناتِ بلا غلافٍ
 * يُخفيه: التصنيفُ من السببِ الأصليِّ (`cause`) لا من رسالةٍ تخمينية.
 */
export class BudgetOutcomeUnknown extends Error {
  /**
   * @param {string} resource
   * @param {unknown} cause الخطأُ الأصليُّ من دفترِ الحصص (انقطاعٌ أو غيرُه).
   * @param {string} taskId
   * @param {string} subjectId
   * @param {string} subjectType
   * @param {Date} at لحظةُ بدءِ معاملةِ الخصم؛ دليلٌ لا يُمحى.
   */
  constructor(resource, cause, taskId, subjectId, subjectType, at) {
    super(
      `تعذّرَ إثباتُ نتيجةِ خصمِ الموردِ ${resource}: معاملةُ الخصمِ بدأت في ${at.toISOString()} ` +
        `ولم يُعرف أالتزمت قبل انقطاعِ الردّ (المهمّة ${taskId}، صاحبُ الحصة ` +
        `${subjectType}/${subjectId}). لا يُمحى الدليلُ ولا يُخصَمُ مرّةً ثانيةً بلا إثبات.`,
      { cause },
    );
    this.name = 'BudgetOutcomeUnknown';
    this.code = 'BUDGET_OUTCOME_UNKNOWN';
    this.resource = resource;
    this.taskId = taskId;
    this.subjectId = subjectId;
    this.subjectType = subjectType;
    this.markedAt = at;
  }
}
