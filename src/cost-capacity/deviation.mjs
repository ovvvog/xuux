// حكمُ السعةِ والانحراف — نقيٌّ بلا أثرٍ ولا ساعةٍ ولا سجلّ: يأخذ مجاميعَ شهرٍ
// مقروءةً ويُعيد أحكاماً، ولا يُقيِّد حادثةً ولا يكتب سطراً.
//
// وفُصل عن المنسِّقِ للسببِ نفسِه الذي فُصل له `alerts.mjs` في `M10.03`: كي
// يُختبَر قرارُ «هل تُجاوِز السعةُ؟» و«هل انحرف الإنفاق؟» وحدَه على مجاميعَ
// مصنوعةٍ بلا تركيبِ نظامٍ كامل، **ولئلّا يصير الحكمُ مدفوناً في وسطِ دالةٍ
// تكتب في السجلِّ وتُقيِّد الحادثةَ وتُبلِّغ**.
//
// **ولا سقفَ ولا خطَّ أساسٍ ولا هامشَ مكتوبٌ هنا:** كلُّها تصل **مُمرَّرةً** من
// `config/cost-capacity.yaml`، ويقيس الحاجزُ (R5) غيابَها نصّاً. فتشديدُ سقفٍ
// سطرٌ في الوثيقةِ يظهر أثرُه في الحكمِ بلا سطرِ كودٍ يُغيَّر.
//
// **وما لم يقع تحته قيدٌ يُقرأ «غيرَ مقيسٍ» لا «تحتَ السقف»** — وهذا موضعُ
// الكذبِ المُطمئنِّ نفسِه الذي قُتل في `M10.02`: من لم يُقَس استهلاكُه ليس
// مُقتصداً، بل مجهولاً.

/**
 * @typedef {object} SubjectTotal
 * @property {string} subject
 * @property {number} units
 * @property {number} costMilli
 * @property {number} entries
 */

/**
 * @typedef {object} CapacityLimitLike
 * @property {string} id
 * @property {'institution' | 'agent' | 'model'} dimension
 * @property {string} item
 * @property {number} limitUnits
 * @property {string} severity
 */

/**
 * @typedef {object} DeviationRuleLike
 * @property {string} id
 * @property {'institution' | 'agent' | 'model'} dimension
 * @property {string} item
 * @property {number} baselineUnits
 * @property {number} toleranceRatio
 * @property {string} severity
 * @property {string} channel
 */

/**
 * @typedef {object} CapacityRow
 * @property {string} limit
 * @property {string} dimension
 * @property {string} item
 * @property {string | null} subject
 * @property {'within' | 'exceeded' | 'unmeasured'} status
 * @property {number} limitUnits
 * @property {number | null} units
 * @property {number | null} headroomUnits
 * @property {string} severity
 * @property {string} reason
 */

/**
 * @typedef {object} DeviationRow
 * @property {string} rule
 * @property {string} dimension
 * @property {string} item
 * @property {string | null} subject
 * @property {boolean} firing
 * @property {number} baselineUnits
 * @property {number} allowedUnits
 * @property {number | null} units
 * @property {number | null} deviationRatio
 * @property {string} severity
 * @property {string} channel
 * @property {string} reason
 */

/**
 * قراءةُ مجاميعِ بُعدٍ وبندٍ من خريطةِ الجمعِ في صورةِ صفوفٍ مُسمّاة.
 *
 * @param {{ aggregate: Map<string, Map<string, { units: number, costMilli: number, entries: number }>>, item: string }} input
 * @returns {SubjectTotal[]}
 */
export function subjectTotals({ aggregate, item }) {
  /** @type {SubjectTotal[]} */
  const rows = [];
  for (const [subject, items] of aggregate) {
    const total = items.get(item);
    if (total === undefined) continue;
    rows.push({ subject, units: total.units, costMilli: total.costMilli, entries: total.entries });
  }
  rows.sort((left, right) => right.units - left.units || left.subject.localeCompare(right.subject));
  return rows;
}

/**
 * حكمُ السعةِ لكلِّ حدٍّ معلَنٍ على كلِّ صاحبٍ وقع له قيد.
 *
 * **وحدٌّ لم يقع تحته صاحبٌ واحدٌ يُعاد صفّاً واحداً «غيرَ مقيسٍ»** ولا يُطوى:
 * فحدٌّ يختفي من اللوحةِ لأنّ أحداً لم يستهلك تحته يُقرأ «لا حدَّ هنا».
 *
 * @param {{ limits: readonly CapacityLimitLike[], totalsFor: (dimension: 'institution' | 'agent' | 'model') => Map<string, Map<string, { units: number, costMilli: number, entries: number }>> }} input
 * @returns {CapacityRow[]}
 */
export function evaluateCapacity({ limits, totalsFor }) {
  /** @type {CapacityRow[]} */
  const rows = [];
  for (const limit of limits) {
    const totals = subjectTotals({ aggregate: totalsFor(limit.dimension), item: limit.item });
    if (totals.length === 0) {
      rows.push({
        limit: limit.id,
        dimension: limit.dimension,
        item: limit.item,
        subject: null,
        status: 'unmeasured',
        limitUnits: limit.limitUnits,
        units: null,
        headroomUnits: null,
        severity: limit.severity,
        reason: `لم يقع تحت الحدِّ «${limit.id}» قيدُ استهلاكٍ واحدٌ في هذا الشهر؛ وغيابُ القياسِ ليس التزاماً بالسقف.`,
      });
      continue;
    }
    for (const total of totals) {
      const exceeded = total.units > limit.limitUnits;
      rows.push({
        limit: limit.id,
        dimension: limit.dimension,
        item: limit.item,
        subject: total.subject,
        status: exceeded ? 'exceeded' : 'within',
        limitUnits: limit.limitUnits,
        units: total.units,
        headroomUnits: limit.limitUnits - total.units,
        severity: limit.severity,
        reason: exceeded
          ? `استهلك «${total.subject}» ${total.units} وحدةً من «${limit.item}» وسقفُه المُعلَنُ ${limit.limitUnits}.`
          : `استهلك «${total.subject}» ${total.units} وحدةً من «${limit.item}» ومتبقّيه ${limit.limitUnits - total.units}.`,
      });
    }
  }
  return rows;
}

/**
 * حكمُ الانحرافِ عن خطِّ الأساسِ المُعلَنِ بالهامشِ المُعلَن.
 *
 * **ويُعاد كلُّ ما قُيِّم لا ما أشعل وحدَه** — كما في `evaluateRules` في
 * `M10.03`: «لا انحرافَ» ليس معلومةً واحدةً بل ثلاثاً — أنّ القاعدةَ قُرئت،
 * وأنّ الصاحبَ وُجد، وأنّ رقمَه لم يستوجبها.
 *
 * @param {{ rules: readonly DeviationRuleLike[], totalsFor: (dimension: 'institution' | 'agent' | 'model') => Map<string, Map<string, { units: number, costMilli: number, entries: number }>> }} input
 * @returns {DeviationRow[]}
 */
export function evaluateDeviation({ rules, totalsFor }) {
  /** @type {DeviationRow[]} */
  const rows = [];
  for (const rule of rules) {
    const allowedUnits = Math.round(rule.baselineUnits * (1 + rule.toleranceRatio));
    const totals = subjectTotals({ aggregate: totalsFor(rule.dimension), item: rule.item });
    if (totals.length === 0) {
      rows.push({
        rule: rule.id,
        dimension: rule.dimension,
        item: rule.item,
        subject: null,
        firing: false,
        baselineUnits: rule.baselineUnits,
        allowedUnits,
        units: null,
        deviationRatio: null,
        severity: rule.severity,
        channel: rule.channel,
        reason: `لم يقع تحت القاعدة «${rule.id}» قيدُ استهلاكٍ واحدٌ في هذا الشهر، فلا انحرافَ يُقاس ولا التزامَ يُدَّعى.`,
      });
      continue;
    }
    for (const total of totals) {
      const firing = total.units > allowedUnits;
      rows.push({
        rule: rule.id,
        dimension: rule.dimension,
        item: rule.item,
        subject: total.subject,
        firing,
        baselineUnits: rule.baselineUnits,
        allowedUnits,
        units: total.units,
        deviationRatio: (total.units - rule.baselineUnits) / rule.baselineUnits,
        severity: rule.severity,
        channel: rule.channel,
        reason: firing
          ? `استهلك «${total.subject}» ${total.units} وحدةً من «${rule.item}» والمسموحُ فوقَ خطِّ الأساسِ ${allowedUnits}.`
          : `استهلك «${total.subject}» ${total.units} وحدةً من «${rule.item}» وهي ضمنَ المسموحِ ${allowedUnits} فوقَ خطِّ الأساس.`,
      });
    }
  }
  return rows;
}
