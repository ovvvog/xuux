// تقريرُ المراجعةِ اللاحقة — **خطُّ الزمنِ يُقرأ ولا يُكتَب**.
//
// العيبُ الذي تُغلقه هذه الوحدةُ: الحادثةُ تُغلَق ولا يُكتب لماذا وقعت ولا ما
// يمنع تكرارَها. **والحادثةُ التي تُغلَق بلا مراجعةٍ تعود** — لا لأن أحداً
// أهمل، بل لأن ما تعلَّمه المستجيبُ في الثالثةِ صباحاً بقي في رأسِه وحدَه.
//
// والقرارُ البنيويُّ هنا هو الفصلُ بين ما يعرفه السجلُّ وما لا يعرفه:
//
//   • **خطُّ الزمن** يعرفه السجلُّ وحدَه، فيُقرأ من قيودِه على القرصِ ولا
//     يُقبَل مكتوباً من مُراجِعٍ. ومن كتب خطَّ زمنٍ من ذاكرتِه كتب ما يتذكّره
//     لا ما وقع، وهو أوّلُ ما يختلّ بعد ليلةِ سهر. ولو قُبل مكتوباً لصار
//     التقريرُ إنشاءً يُصدّقه من كتبه.
//
//   • **الأثرُ والسببُ الجذريُّ والإجراءُ المانع** لا يعرفها السجلُّ: من
//     تأثّر في الخارج، ولماذا وقع الذي وقع، وما يُبنى كي لا يعود. فيكتبها
//     المُراجِعُ **بحدودِ طولٍ معلَنةٍ في الوثيقةِ لا في الكود** — كي يكون
//     تخفيفُ الحدِّ تعديلاً معلَناً في ملفٍّ يُقرأ لا رقماً يُغيَّر في سطرٍ
//     لا يراه أحد. وسببٌ جذريٌّ من كلمتين يُقرأ بعد شهرٍ ولا يُفهم، ومراجعةٌ
//     بلا إجراءٍ مانعٍ مراجعةٌ تُطمئن ولا تمنع.
//
// **حدٌّ معلَنٌ:** لا يُحكَم هنا على **صحّةِ** ما كتبه المُراجِعُ — لا آلةَ
// تعرف أنّ هذا سببٌ جذريٌّ حقّاً لا عرَضٌ آخر. المقيسُ: أنّ القسمَ حاضرٌ،
// وأنّ طولَه يبلغ الحدَّ المُعلَن، وأنّ الإجراءَ المانعَ واحدٌ على الأقلّ،
// وأنّ خطَّ الزمنِ من القرص. وما بعد ذلك مسؤوليةُ المُراجِعِ المستقلِّ، وهو
// موضعُ الحكمِ البشريِّ الذي لا يُؤتمَت.

import { IR_ERRORS, IncidentResponseError } from './errors.mjs';

/**
 * @typedef {object} LogEntryLike
 * @property {number} [seq]
 * @property {string} type
 * @property {string} [actor]
 * @property {string} [at]
 * @property {Record<string, unknown>} data
 */

/**
 * @typedef {object} ReviewPolicy
 * @property {number} dueWithinMs
 * @property {number} minRootCauseLength
 * @property {number} minImpactLength
 * @property {number} minCorrectiveActions
 * @property {number} minCorrectiveActionLength
 * @property {true} independentReviewer
 * @property {'on-disk-log'} evidence
 * @property {string} statement
 * @property {ReadonlyArray<{ id: string, source: 'on-disk-log' | 'reviewer', purpose: string }>} requiredSections
 */

/**
 * بناءُ خطِّ الزمنِ من قيودِ السجلِّ على القرصِ لتنبيهٍ بعينِه.
 *
 * والتصفيةُ على حقلِ `alert` في جسمِ القيدِ لا على نوعِ الحدثِ وحدَه: في
 * السجلِّ قيودُ تنبيهاتٍ أخرى وقيودُ نظامٍ كاملٍ، ومن قرأ النوعَ وحدَه بنى
 * خطَّ زمنٍ لحادثةٍ من قيودِ حادثةٍ أخرى.
 *
 * @param {{ entries: readonly LogEntryLike[], alertId: string, eventTypes: readonly string[] }} input
 * @returns {Array<{ seq: number | null, type: string, actor: string | null, at: string | null, data: Record<string, unknown> }>}
 */
export function buildTimeline({ entries, alertId, eventTypes }) {
  const wanted = new Set(eventTypes);
  return entries
    .filter((entry) => wanted.has(entry.type) && String(entry.data?.['alert'] ?? '') === alertId)
    .map((entry) => ({
      seq: typeof entry.seq === 'number' ? entry.seq : null,
      type: entry.type,
      actor: typeof entry.actor === 'string' ? entry.actor : null,
      at: typeof entry.at === 'string' ? entry.at : null,
      data: { ...entry.data },
    }));
}

/**
 * الدليلُ حاضرٌ أو رفضٌ مُسمّى: لا تقريرَ على خطِّ زمنٍ فارغٍ، ولا تقريرَ على
 * خطِّ زمنٍ لا يشهد أنّ التنبيهَ رُفع أصلاً.
 *
 * والشقُّ الثاني ليس زيادةً: خطُّ زمنٍ فيه إقرارٌ بلا رفعٍ يعني أنّ السجلَّ
 * الذي يُقرأ منه ليس السجلَّ الذي كُتب فيه — إمّا قارئٌ يقرأ ملفّاً آخرَ، أو
 * قيدٌ لم يُثبَّت على القرص. وكِلاهما عطبٌ في الدليلِ نفسِه، وأخطرُ من غيابِه
 * الصريحِ لأنه يُقرأ كتقريرٍ تامّ.
 *
 * @param {{ timeline: ReadonlyArray<{ type: string }>, alertId: string, raisedEvent: string }} input
 * @returns {void}
 */
export function assertEvidence({ timeline, alertId, raisedEvent }) {
  if (timeline.length === 0) {
    throw new IncidentResponseError(
      IR_ERRORS.REVIEW_EVIDENCE_MISSING,
      `لا قيدَ واحداً في السجلِّ الدائمِ على القرصِ للتنبيه «${alertId}»؛ وتقريرُ مراجعةٍ بلا خطِّ زمنٍ مقروءٍ من القرصِ شهادةُ ذاكرةٍ على نفسِها، وهو بعينُه ما جاء معيارُ «تقريرٍ موثَّق» ليمنعه.`,
      { alert: alertId },
    );
  }
  if (!timeline.some((entry) => entry.type === raisedEvent)) {
    throw new IncidentResponseError(
      IR_ERRORS.REVIEW_EVIDENCE_MISSING,
      `خطُّ زمنِ التنبيه «${alertId}» لا يشهد برفعِه («${raisedEvent}» غائبٌ) وفيه قيودٌ بعدَه؛ وخطُّ زمنٍ يبدأ من وسطِه يعني قارئاً يقرأ سجلًّا غيرَ الذي كُتب فيه أو قيداً لم يُثبَّت — وذاك أخطرُ من غيابِ الدليلِ لأنه يُقرأ تامّاً.`,
      { alert: alertId, raisedEvent },
    );
  }
}

/**
 * فحصُ أقسامِ التقرير: الحضورُ وحدودُ الطولِ والإجراءُ المانع.
 *
 * @param {{ policy: ReviewPolicy, report: Record<string, unknown>, alertId: string }} input
 * @returns {{ impact: string, rootCause: string, correctiveActions: string[] }}
 */
export function assertSections({ policy, report, alertId }) {
  /** @param {string} section @param {string} why @param {Record<string, unknown>} [detail] */
  const missing = (section, why, detail = {}) => {
    throw new IncidentResponseError(
      IR_ERRORS.REVIEW_SECTION_MISSING,
      `قسمُ التقرير «${section}» للتنبيه «${alertId}» ${why}`,
      { alert: alertId, section, ...detail },
    );
  };

  const impactRaw = report['impact'];
  const impact = typeof impactRaw === 'string' ? impactRaw.trim() : '';
  if (impact.length < policy.minImpactLength) {
    missing(
      'section:impact',
      `أقصرُ من الحدِّ المُعلَنِ في الوثيقة (${impact.length} < ${policy.minImpactLength})؛ والأثرُ في الخارجِ لا يعرفه السجلُّ فمن لم يكتبه لم يُوثِّق الحادثةَ بل قيَّد أحداثَها.`,
      { length: impact.length, minLength: policy.minImpactLength },
    );
  }

  const rootCauseRaw = report['rootCause'];
  const rootCause = typeof rootCauseRaw === 'string' ? rootCauseRaw.trim() : '';
  if (rootCause.length < policy.minRootCauseLength) {
    missing(
      'section:root-cause',
      `أقصرُ من الحدِّ المُعلَنِ في الوثيقة (${rootCause.length} < ${policy.minRootCauseLength})؛ وسببٌ جذريٌّ من كلمتين يُقرأ بعد شهرٍ ولا يُفهم، والحدُّ في الوثيقةِ لا في الكودِ كي يكون تخفيفُه قراراً معلَناً.`,
      { length: rootCause.length, minLength: policy.minRootCauseLength },
    );
  }

  const actionsRaw = report['correctiveActions'];
  const actions = Array.isArray(actionsRaw)
    ? actionsRaw.map((action) => (typeof action === 'string' ? action.trim() : '')).filter(Boolean)
    : [];
  if (actions.length < policy.minCorrectiveActions) {
    missing(
      'section:corrective-actions',
      `فيه ${actions.length} إجراءً والحدُّ المُعلَنُ ${policy.minCorrectiveActions}؛ ومراجعةٌ بلا إجراءٍ مانعٍ للتكرارِ مراجعةٌ تُطمئن ولا تمنع، والحادثةُ تعود.`,
      { count: actions.length, minCount: policy.minCorrectiveActions },
    );
  }
  for (const action of actions) {
    if (action.length < policy.minCorrectiveActionLength) {
      missing(
        'section:corrective-actions',
        `فيه إجراءٌ أقصرُ من الحدِّ المُعلَن (${action.length} < ${policy.minCorrectiveActionLength})؛ و«نُصلحه» ليس إجراءً بل نيّة.`,
        { action, length: action.length, minLength: policy.minCorrectiveActionLength },
      );
    }
  }

  return { impact, rootCause, correctiveActions: actions };
}
