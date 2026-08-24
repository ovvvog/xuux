/**
 * دورة حياة المهمة — الخطوة `M5.01`.
 *
 * قبل هذه الوحدة كانت حالات المهمة خمساً معلنة في النواة (`queued` و`running`
 * و`succeeded` و`failed` و`stopped`) **بلا مخطَّط انتقالات**: أي إسنادٍ لحقل
 * `state` كان مقبولاً، فمهمةٌ ناجحة يمكن أن تُعاد إلى `running`، ومهمةٌ لم تُصرَّح
 * يمكن أن تُنفَّذ. أي أن «دورة الحياة» كانت أسماءً لا قانوناً.
 *
 * هنا الانتقالات **بيانات**، والدالة `assertTransition` هي الحارس الوحيد الذي
 * يُستدعى من الطابور ومن العامل ومن النواة. وما ليس في الجدول ممنوع (المادة 9):
 * القائمة قائمةُ **المسموح** لا قائمةُ الممنوع، فالحالة الجديدة التي يضيفها
 * أحدهم بلا انتقالات تُصبح معزولة لا مفتوحة.
 *
 * ولا يُخفى حدٌّ: هذه الوحدة تحرس **شكل** الانتقال لا صلاحية من طلبه. الصلاحية
 * قرار نقطة التفويض (`M4.05`)، والعقد وذرّية الحجز قرار الطابور (`M5.04`).
 */

/**
 * حالات المهمة السبع. مُشتقّة من كائن مُجمَّد فلا تنحرف القائمة عن النوع.
 * @typedef {(typeof TaskLifecycle)[keyof typeof TaskLifecycle]} TaskLifecycleState
 */
export const TaskLifecycle = Object.freeze({
  /** أُنشئت وسُجّلت، ولم يُبتّ في صلاحيتها بعد. */
  CREATED: 'created',
  /** مرّت بنقطة التفويض ومعها قرار مُسبَّب. */
  AUTHORIZED: 'authorized',
  /** في الطابور، قابلة للحجز متى حان وقتها. */
  SCHEDULED: 'scheduled',
  /** محجوزة بعقدٍ لعاملٍ بعينه وقيد التنفيذ. */
  RUNNING: 'running',
  SUCCEEDED: 'succeeded',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
});

/**
 * الحالات التي لا خروج منها. من وصلها فقد انتهى أمره.
 *
 * النوع مُعلن على **كل** الحالات لا على الثلاث وحدها، لأن `has` تُستدعى بحالةٍ
 * مجهولة الانتماء؛ ومجموعةٌ لا تقبل السؤال إلا عن أعضائها لا تُفيد سائلاً.
 * @type {ReadonlySet<TaskLifecycleState>}
 */
export const TERMINAL_STATES = Object.freeze(
  new Set([TaskLifecycle.SUCCEEDED, TaskLifecycle.FAILED, TaskLifecycle.CANCELLED]),
);

/**
 * الانتقالات المسموحة وحدها. كل انتقال معه سببه المكتوب في الشرح أدناه:
 *
 * - `created → authorized`: قرار سياسة مُسبَّب. و`created → cancelled` لأن ما لم
 *   يُصرَّح به يجوز إسقاطه.
 * - `authorized → scheduled`: أُدخلت الطابور فعلاً (كتابةٌ في القاعدة).
 * - `scheduled → running`: **حجزٌ ذرّي بعقد**، لا مجرّد نية عاملٍ بالتشغيل.
 * - `running → scheduled`: إعادة إلى الطابور بعد فشلٍ قابل للإعادة أو بعد
 *   انتهاء عقدٍ لعاملٍ مات. وهو الانتقال الذي يجعل قتل العامل استعادةً.
 * - `running → succeeded | failed | cancelled`: نهايةُ التنفيذ.
 * - `scheduled → failed`: استنفاد المحاولات أو رفضُ ميزانية قبل التشغيل.
 * - ولا انتقال يخرج من حالة نهائية، ولا انتقال يعود إلى `created`.
 * @type {Readonly<Record<TaskLifecycleState, readonly TaskLifecycleState[]>>}
 */
export const ALLOWED_TRANSITIONS = Object.freeze({
  created: Object.freeze([TaskLifecycle.AUTHORIZED, TaskLifecycle.CANCELLED, TaskLifecycle.FAILED]),
  authorized: Object.freeze([
    TaskLifecycle.SCHEDULED,
    TaskLifecycle.CANCELLED,
    TaskLifecycle.FAILED,
  ]),
  scheduled: Object.freeze([TaskLifecycle.RUNNING, TaskLifecycle.CANCELLED, TaskLifecycle.FAILED]),
  running: Object.freeze([
    TaskLifecycle.SUCCEEDED,
    TaskLifecycle.FAILED,
    TaskLifecycle.CANCELLED,
    TaskLifecycle.SCHEDULED,
  ]),
  succeeded: Object.freeze([]),
  failed: Object.freeze([]),
  cancelled: Object.freeze([]),
});

export const LIFECYCLE_ERRORS = Object.freeze({
  UNKNOWN_STATE: 'TASK_STATE_UNKNOWN',
  ILLEGAL_TRANSITION: 'TASK_TRANSITION_ILLEGAL',
  TERMINAL: 'TASK_ALREADY_TERMINAL',
});

/** خطأ دورة حياة يحمل رمزاً وحالتين، فيُقرأ القرار آلياً لا بتحليل نصّ. */
export class LifecycleError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   * @param {{ from?: string, to?: string }} [context]
   */
  constructor(code, message, context = {}) {
    super(message);
    this.name = 'LifecycleError';
    /** @type {string} */
    this.code = code;
    /** @type {string | undefined} */
    this.from = context.from;
    /** @type {string | undefined} */
    this.to = context.to;
  }
}

/**
 * هل النص حالةٌ معروفة؟
 * @param {unknown} value
 * @returns {value is TaskLifecycleState}
 */
export function isTaskState(value) {
  return typeof value === 'string' && Object.hasOwn(ALLOWED_TRANSITIONS, value);
}

/**
 * يتحقّق من مشروعية الانتقال ويرفع خطأً مسمّى إن كان ممنوعاً.
 *
 * الحالةُ المجهولة تُرفض قبل الانتقال: قبولُ حالةٍ لا يعرفها المخطَّط يعني أن
 * القاعدة ستحرسها وحدها، وقيدُ القاعدة يُخرج خطأً بلغة PostgreSQL لا رمزاً.
 * @param {unknown} from - الحالة الحالية
 * @param {unknown} to - الحالة المطلوبة
 * @returns {void}
 */
export function assertTransition(from, to) {
  if (!isTaskState(from)) {
    // الحقل يُحذف إن لم تكن الحالة الهدف نصّاً، ولا يُسنَد `undefined` صريحاً:
    // حقلٌ موجودٌ بقيمة فارغة يختلف عن حقلٍ غائب، والفرق يُقرأ في الرسالة.
    throw new LifecycleError(
      LIFECYCLE_ERRORS.UNKNOWN_STATE,
      `حالة مجهولة: ${String(from)}`,
      typeof to === 'string' ? { to } : {},
    );
  }
  if (!isTaskState(to)) {
    throw new LifecycleError(LIFECYCLE_ERRORS.UNKNOWN_STATE, `حالة مجهولة: ${String(to)}`, {
      from,
    });
  }
  if (TERMINAL_STATES.has(from)) {
    throw new LifecycleError(
      LIFECYCLE_ERRORS.TERMINAL,
      `المهمة في حالة نهائية (${from}) فلا تنتقل إلى ${to}.`,
      { from, to },
    );
  }
  const allowed = ALLOWED_TRANSITIONS[from];
  if (!allowed.includes(to)) {
    throw new LifecycleError(
      LIFECYCLE_ERRORS.ILLEGAL_TRANSITION,
      `انتقال ممنوع: ${from} ⇒ ${to}. المسموح من ${from}: ${allowed.join('، ') || 'لا شيء'}.`,
      { from, to },
    );
  }
}

/**
 * كل الأزواج الممكنة مع حكمها. تُستعمل في الاختبار كي يُفحص **كل** زوج لا عيّنة
 * منه، وفي الوثيقة كي يُرسم المخطَّط من المصدر لا من الذاكرة.
 * @returns {Array<{ from: TaskLifecycleState, to: TaskLifecycleState, allowed: boolean }>}
 */
export function transitionMatrix() {
  const states = /** @type {TaskLifecycleState[]} */ (Object.keys(ALLOWED_TRANSITIONS));
  /** @type {Array<{ from: TaskLifecycleState, to: TaskLifecycleState, allowed: boolean }>} */
  const rows = [];
  for (const from of states) {
    for (const to of states) {
      rows.push({ from, to, allowed: ALLOWED_TRANSITIONS[from].includes(to) });
    }
  }
  return rows;
}
