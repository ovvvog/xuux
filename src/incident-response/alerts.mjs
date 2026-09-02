// تقييمُ قواعدِ التنبيهِ على لوحةِ مستوياتِ الخدمة — نقيٌّ بلا أثرٍ ولا ساعةٍ
// ولا سجلّ: يأخذ لوحةً مقروءةً ويُعيد التنبيهاتِ المُستحقّةَ ولا يُقيِّد شيئاً.
// وفُصل عن المنسِّقِ كي يُختبَر الحكمُ وحدَه على لوحاتٍ مصنوعةٍ بلا تركيبِ
// نظامٍ كامل، **ولئلّا يصير قرارُ «هل يُنبَّه؟» مدفوناً في وسطِ دالةٍ تكتب في
// السجلِّ وتُقيِّد الحادثةَ وتُبلِّغ**.
//
// **ولا يُحسَب هنا شيءٌ من جديد.** الحكمُ `meeting` أو `breaching` أو
// `unmeasured` حكمُ `M10.02` بعينِه من صفِّ اللوحة، ونفادُ الميزانيةِ حقلُها
// `exhausted` بعينُه. ولو أُعيد حسابُ العتبةِ هنا لصار في النظامِ مصدرانِ
// للحقيقةِ يتباعدانِ عند أولِ تعديلٍ لهدفٍ، فتُقرأ اللوحةُ خضراءَ ويُرفَع
// تنبيهٌ، أو تُقرأ حمراءَ ولا يُرفَع — وكِلا الحالين أسوأُ من غيابِ التنبيه.
//
// **ومهلةُ السماحِ في «غيابِ القياس» ليست تلطيفاً للحكم:** الهدفُ غيرُ
// المقيسِ في أوّلِ ثانيةٍ من عمرِ العمليةِ حالٌ طبيعيةٌ — لم يُنادَ المسارُ
// بعد. فتنبيهٌ يُرفَع عند كلِّ إقلاعٍ تنبيهٌ يُتعلَّم تجاهُلُه، ومن علّم
// المستجيبَ تجاهُلَ تنبيهٍ أطفأ ما بعده. ولذلك تُقاس المهلةُ على **عمرِ
// النافذةِ** الذي تُعلنه اللوحةُ نفسُها (`window.ageMs`) لا على ساعةٍ مستقلّة:
// فالنافذةُ هي ما يعرف كم مضى من القياس، وهو المعنى المقصودُ بـ«صمتَ طويلاً».

import { IR_ERRORS, IncidentResponseError } from './errors.mjs';

/**
 * @typedef {object} ObjectiveRowLike
 * @property {string} id
 * @property {string} capability
 * @property {'meeting' | 'breaching' | 'unmeasured'} status
 * @property {number} target
 * @property {number | null} measured
 * @property {number | null} deviation
 * @property {{ allowed: number, consumed: number, remaining: number, consumedRatio: number | null, exhausted: boolean }} errorBudget
 */

/**
 * @typedef {object} DashboardLike
 * @property {number} generatedAtMs
 * @property {{ scope: string, ageMs: number }} window
 * @property {ReadonlyArray<{ id: string, statement: string, objectives: readonly ObjectiveRowLike[] }>} capabilities
 * @property {{ objectives: number, meeting: number, breaching: number, unmeasured: number, budgetsExhausted: number }} summary
 */

/**
 * @typedef {object} AlertRule
 * @property {string} id
 * @property {string} objective
 * @property {'objective-breaching' | 'budget-exhausted' | 'measurement-missing'} condition
 * @property {string} severity
 * @property {string} channel
 * @property {number} [graceMs]
 * @property {string} statement
 */

/**
 * @typedef {object} AlertCandidate
 * @property {string} rule
 * @property {string} objective
 * @property {string} capability
 * @property {string} condition
 * @property {string} severity
 * @property {string} channel
 * @property {boolean} firing
 * @property {string} reason
 * @property {Record<string, unknown>} reading
 */

/**
 * فرشُ صفوفِ اللوحةِ في خريطةٍ بمعرّفِ الهدف.
 *
 * @param {DashboardLike} dashboard
 * @returns {Map<string, ObjectiveRowLike>}
 */
function rowsOf(dashboard) {
  /** @type {Map<string, ObjectiveRowLike>} */
  const rows = new Map();
  for (const capability of dashboard.capabilities) {
    for (const row of capability.objectives) rows.set(row.id, row);
  }
  return rows;
}

/**
 * تقييمُ القواعدِ على لوحةٍ مقروءة.
 *
 * **ويُعاد كلُّ ما قُيِّم لا ما أشعل وحدَه**: القاعدةُ التي لم تُشعِل تُعاد
 * بـ`firing: false` وبسببِ عدمِ إشعالِها. وذاك مقصود: «لم يُرفَع تنبيهٌ» ليس
 * معلومةً واحدةً بل ثلاثاً — أنّ القاعدةَ قُرئت، وأنّ الهدفَ وُجد، وأنّ حكمَه
 * لم يستوجبها. ولو أُعيدت المُشعِلاتُ وحدَها لصار «لا شيءَ» جواباً لا يُميَّز
 * فيه صحيحُ الصمتِ من قاعدةٍ لم تُقيَّم أصلاً.
 *
 * @param {{ rules: readonly AlertRule[], dashboard: DashboardLike }} input
 * @returns {AlertCandidate[]}
 */
export function evaluateRules({ rules, dashboard }) {
  const rows = rowsOf(dashboard);
  const ageMs = dashboard.window.ageMs;
  /** @type {AlertCandidate[]} */
  const candidates = [];

  for (const rule of rules) {
    const row = rows.get(rule.objective);
    if (row === undefined) {
      // لا يُبلَغ هذا الموضعُ إلا إذا سقط تقابلُ الوثيقتين عند التحميل؛ والرفضُ
      // المُسمّى أصدقُ من تخطّي القاعدةِ بصمتٍ — وقاعدةٌ تُتخطّى بصمتٍ قاعدةٌ
      // يظنّ صاحبُها أنها تحرسه.
      throw new IncidentResponseError(
        IR_ERRORS.OBJECTIVE_UNDECLARED,
        `الهدف «${rule.objective}» الذي تُشير إليه القاعدة «${rule.id}» ليس في لوحةِ مستوياتِ الخدمة؛ وقاعدةٌ بلا هدفٍ تنبيهٌ لا مصدرَ لحكمِه.`,
        { rule: rule.id, objective: rule.objective },
      );
    }

    /** @type {boolean} */
    let firing;
    /** @type {string} */
    let reason;

    if (rule.condition === 'objective-breaching') {
      firing = row.status === 'breaching';
      reason = firing
        ? `الحكمُ المقيسُ للهدف «${row.id}» «مُخفِقٌ»: المقيسُ ${String(row.measured)} والهدفُ ${row.target}.`
        : `الحكمُ المقيسُ للهدف «${row.id}» «${row.status}» لا «breaching»، فلا تُشعِل القاعدةُ.`;
    } else if (rule.condition === 'budget-exhausted') {
      firing = row.errorBudget.exhausted;
      reason = firing
        ? `ميزانيةُ أخطاءِ الهدف «${row.id}» نُفدت: المسموحُ ${row.errorBudget.allowed} والمستهلَكُ ${row.errorBudget.consumed}.`
        : `ميزانيةُ أخطاءِ الهدف «${row.id}» لم تُنفَد: المتبقّي ${row.errorBudget.remaining}.`;
    } else {
      // `measurement-missing` — والشروطُ ثلاثةٌ لا رابعَ، ومخطَّطُ الوثيقةِ
      // يمنع غيرَها فلا فرعَ افتراضيًّا يُخفي شرطاً لم يُكتَب له فحص.
      const graceMs = rule.graceMs;
      if (typeof graceMs !== 'number') {
        throw new IncidentResponseError(
          IR_ERRORS.RULE_UNDECLARED,
          `القاعدة «${rule.id}» على شرطِ غيابِ القياسِ بلا مهلةِ سماحٍ معلَنة؛ وتنبيهٌ على غيابِ القياسِ بلا مهلةٍ يُرفَع في أولِ ثانيةٍ من عمرِ العمليةِ فيُتعلَّم تجاهُلُه.`,
          { rule: rule.id },
        );
      }
      firing = row.status === 'unmeasured' && ageMs >= graceMs;
      reason =
        row.status !== 'unmeasured'
          ? `الهدف «${row.id}» مقيسٌ (${row.status})، فلا صمتَ يُنبَّه عليه.`
          : ageMs >= graceMs
            ? `مضى على النافذةِ ${ageMs}ms وهي ≥ مهلةِ السماحِ ${graceMs}ms ولم يقع تحتَ الهدف «${row.id}» حدثٌ مقيسٌ واحد.`
            : `الهدف «${row.id}» غيرُ مقيسٍ وعمرُ النافذةِ ${ageMs}ms لم يبلغ مهلةَ السماحِ ${graceMs}ms؛ وصمتُ الإقلاعِ ليس عطباً.`;
    }

    candidates.push({
      rule: rule.id,
      objective: rule.objective,
      capability: row.capability,
      condition: rule.condition,
      severity: rule.severity,
      channel: rule.channel,
      firing,
      reason,
      reading: {
        status: row.status,
        target: row.target,
        measured: row.measured,
        deviation: row.deviation,
        budgetRemaining: row.errorBudget.remaining,
        budgetExhausted: row.errorBudget.exhausted,
        windowAgeMs: ageMs,
      },
    });
  }

  return candidates;
}
