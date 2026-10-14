/**
 * الاستردادُ الذاتيُّ للعامل من انقطاعِ قاعدةِ البيانات — `WL-387`.
 *
 * ## ما كان قبل هذه الوحدة (مقيسٌ لا مفترَض)
 *
 * `scripts/worker.mjs` يدورُ على `worker.tick()` بلا التقاط: أيُّ رميةٍ من `pg`
 * (‏`ECONNREFUSED`، «Connection terminated unexpectedly»، `57P01`) تسقطُ إلى
 * `main().catch` فيخرجُ العاملُ بالرمز `1` وبرسالةِ «فشل إقلاع العامل» ولو كان
 * يعملُ منذ ساعات. قِيسَ ذلك على `main@0aabb28f`: قاعدةٌ لا تُجيبُ ⇒ موتُ العاملِ
 * في **0.43 ثانية** بلا قيدٍ تدقيقيٍّ واحد. وأسوأُ منه ما يبقى بعده:
 *
 * - حجزٌ **التزمَته القاعدةُ وضاعَ ردُّه** يتركُ مهمّةً `running` بعقدِ هذا العامل
 *   ولم يبدأ مُعالِجُها قطّ؛ ولا شيءَ في الإنتاجِ يُنادي `reclaimExpired` (لا يُنادى
 *   إلّا في الاختبارات)، فتبقى معلّقةً. ولو نوديَ لحسبَ عليها محاولةً لم تُحاوَل،
 *   فمهمّةٌ سقفُها محاولةٌ واحدةٌ تذهبُ إلى الرسائلِ الميتةِ وهي لم تُنفَّذ.
 * - نتيجةٌ نُفِّذت فعلاً ثم سقطت كتابتُها: لا يُعرَف أكُتبت أم لا. وإعادةُ تشغيلِ
 *   المُعالِجِ لمعرفةِ ذلك تكرارٌ لأثرٍ قد يكون وقع.
 *
 * ## ما تفعلُه الآن، بستِّ مراحلَ لا تُبدَّل
 *
 * 1. **الاكتشافُ والتصنيف** (`classifyDatabaseFault`): تعذُّرُ خدمةٍ (`unavailable`)
 *    يُميَّزُ عن فسادٍ أو غيابِ مخطّطٍ (`integrity`) وعن مجهولٍ (`unknown`). وحدَه
 *    الأوّلُ يُستردُّ منه آلياً؛ الآخرانِ يوقفانِ العاملَ عند حدٍّ آمنٍ بلا كتابة.
 * 2. **الانتظارُ المحدودُ**: مسابيرُ بتأخيرٍ تراجعيٍّ وسقفٍ معلَن، كلٌّ منها يفحصُ
 *    الوصولَ **ووجودَ جداولِ الطابور** — فقاعدةٌ عادت فارغةً ليست قاعدةً عادت.
 * 3. **الإيقافُ السياديُّ يعلو الاسترداد**: إن كان النظامُ موقَفاً فلا كتابةَ ولا
 *    تسوية، ويُعلَنُ الاستردادُ مؤجَّلاً (`unverified`) حتى يُستأنف.
 * 4. **التسويةُ بلا تكرار**: لكلِّ مرحلةٍ من الدورةِ حكمٌ حتميٌّ يُقرأ من القاعدةِ لا
 *    يُخمَّن — ولا يُعادُ تشغيلُ مُعالِجٍ في أيِّ فرعٍ منها:
 *    - حجزٌ لم يبدأ مُعالِجُه ⇒ `releaseUnstarted` (المحاولةُ لا تُحسب).
 *    - نتيجةٌ نُفِّذت ⇒ إن التزمتها القاعدةُ بالبصمةِ نفسِها فهي كما هي؛ وإن بقيت
 *      المهمّةُ جاريةً بعقدِنا كُتبت **النتيجةُ نفسُها** بـ`succeed`؛ وإلّا فعقدُنا
 *      فُقد فلا نكتبُ فوقَ غيرِنا.
 *    - فشلٌ أو إلغاءٌ أو إفراجُ إيقافٍ ⇒ يُعادُ الفعلُ نفسُه إن بقي العقدُ لنا، أو
 *      يُثبَتُ من سجلِّ الانتقالاتِ أنّه وقع.
 * 5. **التحقّقُ بالقراءة**: كلُّ تسويةٍ تُقرأ بعدها من القاعدة، ثم يُعَدُّ ما بقي
 *    `running` بعقدِ هذا العاملِ منذ إقلاعه؛ ولا يُعلَنُ `recovered` إلّا بصفرٍ.
 * 6. **القيدُ**: واقعتانِ في سجلِّ العامل (مختومٌ في الإنتاج): `kernel.worker.db-fault`
 *    عند الاكتشاف، و`kernel.worker.db-recovery` بالحكمِ وأسبابِه.
 *
 * ## الأحكامُ الثلاثة — لا رابعَ يُخترَع
 *
 * - `recovered`: عادت القاعدةُ، وسُوِّيَ كلُّ ما كان معلّقاً، وقُرئ ذلك منها.
 * - `unverified`: عادت القاعدةُ لكن لا دليلَ كافياً (عقدٌ فُقد لغيرِنا، أو إيقافٌ
 *   سياديٌّ يؤجّل التسوية، أو طُلبَ التوقّفُ أثناء الاسترداد). لا يُقرأ نجاحاً.
 * - `failed`: لم تعد القاعدةُ ضمن الميزانية، أو العطبُ ليس تعذُّرَ خدمة. يتوقّفُ
 *   العاملُ ويُبقي كلَّ شيءٍ كما هو، ويُعلنُ حاجتَه إلى تدخّلٍ مخوَّل.
 *
 * ## حدودٌ معلَنة
 *
 * - **اسمُ العاملِ فريد**: التسويةُ تُفرجُ عمّا يحملُه عقدُ هذا الاسمِ منذ إقلاعِ
 *   هذه العملية. عاملانِ باسمٍ واحدٍ يُبطلانِ هذا الضمان — وهو عقدٌ قائمٌ أصلاً
 *   («عقدٌ بلا صاحب لا يُحاسَب»).
 * - **لا حاصدَ لعمّالٍ آخرين**: الاستردادُ لعقودِ هذا العاملِ وحدَه؛ عاملٌ ميتٌ تبقى
 *   مهمّتُه لـ`reclaimExpired` (‏`docs/EXECUTION_RUNTIME.md` §5.6 قائمٌ كما هو).
 * - **لا ذاكرةَ عبرَ موتِ العملية**: النتيجةُ المعلّقةُ تُحفظ في الذاكرةِ وتُقيَّدُ
 *   بصمتُها في السجل؛ فإن قُتل العاملُ قبل التسوية عادت المهمّةُ بعدَ انتهاءِ عقدِها
 *   إلى «مرّةٍ واحدةٍ على الأقل» كما كانت.
 */

import { createHash } from 'node:crypto';

import { QUEUE_ERRORS, QueueError, UNSTARTED_RELEASE_CODE } from './queue.mjs';

export { UNSTARTED_RELEASE_CODE };
import { TaskLifecycle } from './lifecycle.mjs';

/** أصنافُ عطبِ القاعدة. */
export const DB_FAULT_KINDS = Object.freeze({
  /** تعذُّرُ خدمةٍ أو اتصال: يُرجى زوالُه، ويُستردُّ منه آلياً. */
  UNAVAILABLE: 'unavailable',
  /** فسادٌ أو غيابُ مخطّطٍ أو مخالفةُ قيد: لا يُعاد ولا يُسوّى، يوقف العامل. */
  INTEGRITY: 'integrity',
  /** خطأُ قاعدةٍ لا يُعرَف صنفُه: يُعامَل فشلاً مغلقاً لا تعذّراً عارضاً. */
  UNKNOWN: 'unknown',
});

/** مراحلُ دورةِ العامل التي قد يقعُ فيها العطب — تحدّد التسويةَ حتمياً. */
export const TICK_PHASES = Object.freeze({
  /** نداءُ الحجز: قد يكون التُزم وضاع ردُّه، أو لم يُلتزَم. */
  CLAIM: 'claim',
  /** بعد الحجز وقبل التشغيل (الميزانية، إفراجُ الإيقاف): المُعالِجُ لم يبدأ. */
  PRE_RUN: 'pre-run',
  /** بعد انتهاءِ المُعالِج وأثناءَ كتابةِ حصيلته: الأثرُ وقع، والكتابةُ مجهولة. */
  RECORD: 'record',
});

/** الأحكام. */
export const RECOVERY_VERDICTS = Object.freeze({
  RECOVERED: 'recovered',
  UNVERIFIED: 'unverified',
  FAILED: 'failed',
});

/** رموزُ أسبابِ الحكم — مثبّتةٌ نصّاً كي تُختبر ولا تُخمَّن من رسالة. */
export const RECOVERY_REASONS = Object.freeze({
  RECONCILED: 'DB_RECOVERY_RECONCILED',
  LEASE_LOST: 'DB_RECOVERY_LEASE_LOST',
  HALT_ACTIVE: 'DB_RECOVERY_DEFERRED_BY_HALT',
  STOPPED: 'DB_RECOVERY_STOPPED',
  BUDGET_EXHAUSTED: 'DB_UNAVAILABLE_BUDGET_EXHAUSTED',
  NOT_TRANSIENT: 'DB_FAULT_NOT_TRANSIENT',
  SCHEMA_MISSING: 'DB_SCHEMA_MISSING',
  RESIDUAL_CLAIMS: 'DB_RECOVERY_RESIDUAL_CLAIMS',
  RESULT_MISMATCH: 'DB_RECOVERY_RESULT_MISMATCH',
  TASK_MISSING: 'DB_RECOVERY_TASK_MISSING',
});

/**
 * رموزُ خروجِ العامل حين يتوقّف عند حدٍّ آمن. `75` هو `EX_TEMPFAIL` (تعذُّرٌ قد
 * يزول: من يُشغّل العامل يُعيده)، و`65` هو `EX_DATAERR` (لا يُعاد قبل فحصِ مخوَّل).
 */
export const RECOVERY_EXIT_CODES = Object.freeze({
  DB_UNAVAILABLE: 75,
  DB_INTEGRITY: 65,
});

/**
 * سياسةُ الانتظارِ الافتراضية: ~41 ثانية قبل الحكم بالفشل. معلنةٌ لا مستورة.
 * @typedef {{ maxProbes: number, baseDelayMs: number, maxDelayMs: number }} RecoveryPolicy
 * @type {Readonly<RecoveryPolicy>}
 */
export const DEFAULT_RECOVERY_POLICY = Object.freeze({
  maxProbes: 12,
  baseDelayMs: 200,
  maxDelayMs: 5_000,
});

const NETWORK_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ECONNABORTED',
  'EPIPE',
  'ETIMEDOUT',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ENOTFOUND',
  'EAI_AGAIN',
]);

// SQLSTATE: 57P01 admin_shutdown · 57P02 crash_shutdown · 57P03 cannot_connect_now
// · 53300 too_many_connections · 08xxx connection_exception.
const UNAVAILABLE_SQLSTATES = new Set(['57P01', '57P02', '57P03', '53300']);
// XX001 data_corrupted · XX002 index_corrupted · 42P01 undefined_table ·
// 42703 undefined_column · 3F000 invalid_schema_name · 23xxx/22xxx قيودٌ وبيانات.
const INTEGRITY_SQLSTATES = new Set(['XX001', 'XX002', '42P01', '42703', '3F000']);

// رسائلُ `pg` التي لا رمزَ لها. مطابقةُ نصٍّ هشّةٌ، لكنها **رسائلُ المكتبةِ نفسِها**
// لا رسائلُ خادم، وكلُّ واحدةٍ منها مقيسةٌ في الاختبار بانقطاعٍ حقيقي.
const UNAVAILABLE_MESSAGES = [
  /^Connection terminated/i,
  /timeout exceeded when trying to connect/i,
  /Client has encountered a connection error and is not queryable/i,
  /Query read timeout/i,
];

/**
 * يصنّفُ خطأً من القاعدة. يُعيد `null` إن لم يكن خطأَ قاعدةٍ أصلاً — فخطأُ طابورٍ
 * مسمّى أو خطأٌ برمجيٌّ لا يُبتلع في مسارِ الاسترداد بل يُرفع كما كان.
 * @param {unknown} error
 * @returns {{ kind: string, code: string } | null}
 */
export function classifyDatabaseFault(error) {
  if (error === null || typeof error !== 'object') return null;
  if (error instanceof QueueError) return null;
  const record = /** @type {{ code?: unknown, message?: unknown, errors?: unknown }} */ (error);
  const code = typeof record.code === 'string' ? record.code : '';
  const message = typeof record.message === 'string' ? record.message : '';

  // `AggregateError` من `net` (محاولةُ IPv4 وIPv6 معاً) يحمل الرموز في `errors`.
  if (code === '' && Array.isArray(record.errors) && record.errors.length > 0) {
    const inner = classifyDatabaseFault(record.errors[0]);
    if (inner !== null) return inner;
  }
  if (NETWORK_CODES.has(code)) return { kind: DB_FAULT_KINDS.UNAVAILABLE, code };
  if (/^[0-9A-Z]{5}$/.test(code)) {
    if (UNAVAILABLE_SQLSTATES.has(code) || code.startsWith('08')) {
      return { kind: DB_FAULT_KINDS.UNAVAILABLE, code };
    }
    if (INTEGRITY_SQLSTATES.has(code) || code.startsWith('23') || code.startsWith('22')) {
      return { kind: DB_FAULT_KINDS.INTEGRITY, code };
    }
    return { kind: DB_FAULT_KINDS.UNKNOWN, code };
  }
  if (UNAVAILABLE_MESSAGES.some((pattern) => pattern.test(message))) {
    return { kind: DB_FAULT_KINDS.UNAVAILABLE, code: 'PG_CONNECTION_LOST' };
  }
  return null;
}

/**
 * عطبُ قاعدةٍ وقع داخل دورةِ العامل، يحمل ما يلزمُ لتسويته بلا تكرار: المرحلة،
 * والمهمّة إن حُجزت، والفعلُ الذي كان يُكتب حين انقطعت القاعدة.
 */
export class WorkerDatabaseFault extends Error {
  /**
   * @param {object} input
   * @param {string} input.worker
   * @param {string} input.phase
   * @param {string | null} input.taskId
   * @param {PendingOutcome | null} input.pending
   * @param {{ kind: string, code: string }} input.fault
   * @param {unknown} input.cause
   * @param {Date} input.at
   */
  constructor({ worker, phase, taskId, pending, fault, cause, at }) {
    super(
      `انقطاعُ قاعدةٍ (${fault.kind}/${fault.code}) في مرحلة ${phase}` +
        (taskId === null ? '' : ` للمهمّة ${taskId}`),
      { cause },
    );
    this.name = 'WorkerDatabaseFault';
    this.code = 'WORKER_DB_FAULT';
    this.worker = worker;
    this.phase = phase;
    this.taskId = taskId;
    this.pending = pending;
    this.fault = fault;
    this.at = at;
  }
}

/**
 * الفعلُ الذي كان يُكتب حين انقطعت القاعدة.
 * @typedef {{ op: 'succeed', result: Record<string, unknown> }
 *   | { op: 'fail', code: string, message: string, retryable: boolean }
 *   | { op: 'release-halt', reason: string }
 *   | { op: 'confirm-cancel' }
 *   | { op: 'interrupted' }} PendingOutcome
 */

/**
 * تسلسلٌ ثابتُ المفاتيح: `jsonb` يُعيد ترتيبَ المفاتيح، فمقارنةُ نصِّ JSON كما هو
 * تُعلن اختلافاً في نتيجةٍ لم تختلف.
 * @param {unknown} value
 * @returns {string}
 */
function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const entries = Object.keys(value)
    .sort()
    .map(
      (key) =>
        `${JSON.stringify(key)}:${stableStringify(/** @type {Record<string, unknown>} */ (value)[key])}`,
    );
  return `{${entries.join(',')}}`;
}

/**
 * بصمةُ نتيجة: تُقيَّد في السجلِّ بدلَ النتيجةِ نفسِها، فالسجلُّ يُثبت التطابقَ
 * ولا يحملُ حمولةً قد تكون حسّاسة.
 * @param {unknown} result
 * @returns {string}
 */
export function resultDigest(result) {
  return createHash('sha256')
    .update(stableStringify(result ?? {}))
    .digest('hex');
}

/**
 * نومٌ يُقطَع بإشارة، ويُنظَّف مؤقّتُه في الحالين — مؤقّتٌ معلّقٌ بعد التوقّف يُبقي
 * العمليّةَ حيّةً بلا عمل.
 * @param {number} ms
 * @param {AbortSignal | undefined} signal
 * @returns {Promise<boolean>} `false` إن قُطع النوم
 */
export function abortableSleep(ms, signal) {
  if (signal?.aborted === true) return Promise.resolve(false);
  return new Promise((resolve) => {
    const onAbort = () => {
      clearTimeout(timer);
      resolve(false);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve(true);
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * يبني مُستردّاً لعاملٍ واحد.
 * @param {object} input
 * @param {import('pg').Pool} input.pool
 * @param {ReturnType<typeof import('./queue.mjs').createTaskQueue>} input.queue
 * @param {string} input.worker
 * @param {{ assertOperational(): void }} input.haltGuard
 * @param {{ append(type: string, actor: string, data: Record<string, unknown>): unknown }} input.log
 * @param {Partial<RecoveryPolicy>} [input.policy]
 * @param {Date} [input.bootAt] لحظةُ إقلاعِ هذه العملية: حدُّ ما يُنسب إليها من حجوز
 * @param {() => Date} [input.now]
 * @param {(ms: number, signal?: AbortSignal) => Promise<boolean>} [input.sleep]
 */
export function createDatabaseRecovery(input) {
  const { pool, queue, worker, haltGuard, log } = input;
  if (!pool || !queue || !haltGuard || !log || typeof log.append !== 'function') {
    throw new Error('المُستردّ يحتاج المجمّع والطابور ومفتاح الإيقاف وسجلاً يُقيَّد فيه.');
  }
  if (typeof worker !== 'string' || worker.trim() === '') {
    throw new Error('المُستردّ يحتاج اسم العامل: لا يُسوّى عقدٌ بلا صاحب.');
  }
  const policy = { ...DEFAULT_RECOVERY_POLICY, ...(input.policy ?? {}) };
  const now = input.now ?? (() => new Date());
  const bootAt = input.bootAt ?? now();
  const sleep = input.sleep ?? abortableSleep;
  const actor = `worker:${worker}`;
  /** @type {WeakSet<WorkerDatabaseFault>} */
  const recorded = new WeakSet();
  /** @type {WeakSet<WorkerDatabaseFault>} */
  const deferred = new WeakSet();

  function isHalted() {
    try {
      haltGuard.assertOperational();
      return false;
    } catch {
      return true;
    }
  }

  /** @param {number} attempt */
  function delayFor(attempt) {
    return Math.min(policy.maxDelayMs, policy.baseDelayMs * 2 ** Math.max(0, attempt - 1));
  }

  /**
   * مسبار: الوصولُ وحده لا يكفي — جداولُ الطابورِ يجب أن تكون حاضرة.
   * @returns {Promise<{ ok: true } | { ok: false, kind: string, code: string }>}
   */
  async function probe() {
    try {
      const found = await pool.query(
        `SELECT to_regclass('state.tasks') IS NOT NULL AS tasks,
                to_regclass('state.task_transitions') IS NOT NULL AS transitions`,
      );
      const row = /** @type {{ tasks?: boolean, transitions?: boolean } | undefined} */ (
        found.rows[0]
      );
      if (row?.tasks !== true || row?.transitions !== true) {
        return { ok: false, kind: DB_FAULT_KINDS.INTEGRITY, code: RECOVERY_REASONS.SCHEMA_MISSING };
      }
      return { ok: true };
    } catch (error) {
      const fault = classifyDatabaseFault(error) ?? {
        kind: DB_FAULT_KINDS.UNKNOWN,
        code: 'PROBE_FAILED',
      };
      return { ok: false, ...fault };
    }
  }

  /**
   * حجوزُ هذا العاملِ منذ إقلاعه التي لا يحملها في ذاكرته: التزمتها القاعدةُ وضاع
   * ردُّها، فلم يبدأ مُعالِجُها قطّ (العاملُ لا يُشغّل إلا ما أعاده `claim`).
   * @param {Date} before
   * @returns {Promise<string[]>}
   */
  async function ownRunningSince(before) {
    const found = await pool.query(
      `SELECT id FROM state.tasks
        WHERE state = 'running' AND lease_owner = $1
          AND state_changed_at >= $2 AND state_changed_at <= $3
        ORDER BY state_changed_at ASC`,
      [worker, bootAt, before],
    );
    return found.rows.map((row) => String(/** @type {{ id: unknown }} */ (row).id));
  }

  /**
   * هل وقعَ انتقالُ خروجٍ من `running` بيدِ هذا العاملِ منذ إقلاعه؟ يُثبت أنّ كتابةً
   * سقط ردُّها التزمتها القاعدةُ فعلاً. والحدُّ لحظةُ الإقلاع لا رقمُ المحاولة: الإفراجُ
   * يُرجع العدّاد، والانتقالُ يُقيَّد برقمها قبل الإرجاع.
   * @param {string} taskId
   */
  async function committedByMe(taskId) {
    const transitions = await queue.transitions(taskId);
    const last = transitions[transitions.length - 1];
    return (
      last !== undefined &&
      last.from === TaskLifecycle.RUNNING &&
      last.actor === worker &&
      last.at.getTime() >= bootAt.getTime()
    );
  }

  /**
   * يسوّي المهمّةَ التي كانت في يدِ العاملِ حين انقطعت القاعدة.
   * @param {WorkerDatabaseFault} fault
   * @returns {Promise<{ taskId: string, outcome: string, verified: boolean }>}
   */
  async function reconcileKnown(fault) {
    const taskId = /** @type {string} */ (fault.taskId);
    const task = await queue.get(taskId);
    if (task === null) {
      return { taskId, outcome: 'missing', verified: false };
    }
    const mine = task.state === TaskLifecycle.RUNNING && task.leaseOwner === worker;
    const pending = fault.pending;

    // المُعالِجُ لم يبدأ: يُفرَج عن الحجزِ ولا تُحسَب محاولة.
    if (fault.phase !== TICK_PHASES.RECORD || pending === null) {
      if (!mine) {
        // فعلٌ قبل التشغيل (إفراجُ إيقافٍ أو رفضُ ميزانية) التزمته القاعدةُ وضاع ردُّه.
        const done = await committedByMe(taskId);
        return { taskId, outcome: done ? 'already-committed' : 'lease-lost', verified: done };
      }
      await queue.releaseUnstarted({
        taskId,
        worker,
        claimedAfter: bootAt,
        reason: `انقطعت القاعدة (${fault.fault.code}) في مرحلة ${fault.phase} قبل بدء المُعالِج.`,
      });
      const after = await queue.get(taskId);
      return {
        taskId,
        outcome: 'released-unstarted',
        verified: after?.state === TaskLifecycle.SCHEDULED && after.leaseOwner === null,
      };
    }

    if (pending.op === 'succeed') {
      const expected = resultDigest(pending.result);
      if (task.state === TaskLifecycle.SUCCEEDED) {
        // التزمتها القاعدةُ قبل الانقطاع: لا كتابةَ ثانية. والبصمةُ هي الدليل.
        if (resultDigest(task.result) === expected) {
          return { taskId, outcome: 'already-committed', verified: true };
        }
        // نتيجةٌ أخرى: إن كتبها غيرُنا بعد أن استُعيد العقدُ فذلك فقدُ عقد؛ وإن
        // كتبناها نحن بغير ما نحمل فالقاعدةُ لا تطابق ما كُتب — وذاك فسادٌ يوقف.
        const mineCommit = await committedByMe(taskId);
        return {
          taskId,
          outcome: mineCommit ? 'result-mismatch' : 'lease-lost',
          verified: false,
        };
      }
      if (!mine) return { taskId, outcome: 'lease-lost', verified: false };
      await queue.succeed({ taskId, worker, result: pending.result });
      const after = await queue.get(taskId);
      return {
        taskId,
        outcome: 'rewritten',
        verified:
          after?.state === TaskLifecycle.SUCCEEDED && resultDigest(after.result) === expected,
      };
    }

    if (!mine) {
      const done = await committedByMe(taskId);
      return {
        taskId,
        outcome: done ? 'already-committed' : 'lease-lost',
        verified: done,
      };
    }

    if (pending.op === 'fail') {
      await queue.fail({
        taskId,
        worker,
        code: pending.code,
        message: pending.message,
        retryable: pending.retryable,
      });
    } else if (pending.op === 'release-halt') {
      await queue.releaseForHalt({ taskId, worker, reason: pending.reason });
    } else if (pending.op === 'confirm-cancel') {
      await queue.confirmCancelled({ taskId, worker });
    } else {
      // إجهاضٌ بلا سببٍ مقروء (فقدُ عقدٍ أو نبضة): كما يفعل العاملُ في دورته.
      if (task.cancelRequested) {
        await queue.confirmCancelled({ taskId, worker });
      } else {
        await queue.fail({
          taskId,
          worker,
          code: 'TASK_EXECUTION_INTERRUPTED',
          message: 'قُطع التنفيذ وانقطعت القاعدة قبل تسجيله؛ سُوّي بعد عودتها.',
          retryable: true,
        });
      }
    }
    const after = await queue.get(taskId);
    return {
      taskId,
      outcome: 'rewritten',
      verified: !(after?.state === TaskLifecycle.RUNNING && after.leaseOwner === worker),
    };
  }

  /**
   * @param {WorkerDatabaseFault} fault
   * @param {string} verdict
   * @param {string} reason
   * @param {{ probes: number, startedAt: number, reconciled: Array<{ taskId: string, outcome: string, verified: boolean }> }} detail
   */
  function verdictOf(fault, verdict, reason, detail) {
    const outcome = {
      verdict,
      reason,
      probes: detail.probes,
      durationMs: Date.now() - detail.startedAt,
      reconciled: detail.reconciled,
      exitCode:
        verdict !== RECOVERY_VERDICTS.FAILED
          ? null
          : reason === RECOVERY_REASONS.BUDGET_EXHAUSTED
            ? RECOVERY_EXIT_CODES.DB_UNAVAILABLE
            : RECOVERY_EXIT_CODES.DB_INTEGRITY,
      // يُعاد الاستردادُ لاحقاً لهذا العطب نفسه (الإيقاف السيادي) لا يُطوى.
      retry: reason === RECOVERY_REASONS.HALT_ACTIVE,
    };
    const deferredAgain = outcome.retry && deferred.has(fault);
    if (outcome.retry) deferred.add(fault);
    if (!deferredAgain) {
      log.append('kernel.worker.db-recovery', actor, {
        worker,
        verdict,
        reason,
        phase: fault.phase,
        taskId: fault.taskId,
        probes: detail.probes,
        durationMs: outcome.durationMs,
        reconciled: detail.reconciled.map((entry) => `${entry.taskId}:${entry.outcome}`),
        pendingDigest: fault.pending?.op === 'succeed' ? resultDigest(fault.pending.result) : null,
      });
    }
    return outcome;
  }

  return Object.freeze({
    policy,
    bootAt,

    /**
     * يستردّ من عطبٍ واحد. لا يرمي لعطبِ قاعدة: كلُّ مسارٍ ينتهي بحكمٍ مقيَّد.
     * @param {WorkerDatabaseFault} fault
     * @param {{ signal?: AbortSignal }} [options]
     */
    async recover(fault, options = {}) {
      const startedAt = Date.now();
      /** @type {Array<{ taskId: string, outcome: string, verified: boolean }>} */
      const reconciled = [];
      let probes = 0;
      const detail = () => ({ probes, startedAt, reconciled });

      if (!recorded.has(fault)) {
        recorded.add(fault);
        log.append('kernel.worker.db-fault', actor, {
          worker,
          phase: fault.phase,
          kind: fault.fault.kind,
          code: fault.fault.code,
          taskId: fault.taskId,
          pendingOp: fault.pending?.op ?? null,
        });
      }

      // (1) فسادٌ أو مجهول: لا انتظارَ ولا كتابة. الأدلّةُ تبقى كما هي.
      if (fault.fault.kind !== DB_FAULT_KINDS.UNAVAILABLE) {
        return verdictOf(fault, RECOVERY_VERDICTS.FAILED, RECOVERY_REASONS.NOT_TRANSIENT, detail());
      }

      // (2)…(5) مسابيرُ ثم تسوية؛ وانقطاعٌ أثناء التسوية يعودُ إلى المسابير ضمن
      // الميزانية نفسها — فالفشلُ أثناء الاسترداد لا يُطلق ميزانيةً جديدة.
      for (;;) {
        let ready = false;
        while (probes < policy.maxProbes) {
          const slept = await sleep(delayFor(probes + 1), options.signal);
          if (!slept) {
            return verdictOf(
              fault,
              RECOVERY_VERDICTS.UNVERIFIED,
              RECOVERY_REASONS.STOPPED,
              detail(),
            );
          }
          probes += 1;
          const reading = await probe();
          if (reading.ok) {
            ready = true;
            break;
          }
          if (reading.kind !== DB_FAULT_KINDS.UNAVAILABLE) {
            return verdictOf(
              fault,
              RECOVERY_VERDICTS.FAILED,
              reading.code === RECOVERY_REASONS.SCHEMA_MISSING
                ? RECOVERY_REASONS.SCHEMA_MISSING
                : RECOVERY_REASONS.NOT_TRANSIENT,
              detail(),
            );
          }
        }
        if (!ready) {
          return verdictOf(
            fault,
            RECOVERY_VERDICTS.FAILED,
            RECOVERY_REASONS.BUDGET_EXHAUSTED,
            detail(),
          );
        }

        // (3) الإيقافُ السياديُّ يعلو: لا كتابةَ في القاعدة ما دام قائماً.
        if (isHalted()) {
          return verdictOf(
            fault,
            RECOVERY_VERDICTS.UNVERIFIED,
            RECOVERY_REASONS.HALT_ACTIVE,
            detail(),
          );
        }

        try {
          reconciled.length = 0;
          const boundary = now();
          if (fault.taskId !== null) {
            const known = await reconcileKnown(fault);
            reconciled.push(known);
            // لا تسويةَ بعدَ دليلِ فساد: قاعدةٌ لا تحمل ما كُتب فيها لا يُفرَج فيها عن شيء.
            if (known.outcome === 'missing' || known.outcome === 'result-mismatch') {
              return verdictOf(
                fault,
                RECOVERY_VERDICTS.FAILED,
                known.outcome === 'missing'
                  ? RECOVERY_REASONS.TASK_MISSING
                  : RECOVERY_REASONS.RESULT_MISMATCH,
                detail(),
              );
            }
          }
          for (const id of await ownRunningSince(boundary)) {
            if (id === fault.taskId) continue;
            await queue.releaseUnstarted({
              taskId: id,
              worker,
              claimedAfter: bootAt,
              reason: `حجزٌ التزمته القاعدة وضاع ردُّه بانقطاعها (${fault.fault.code}) — لم يبدأ مُعالِجُه.`,
            });
            const after = await queue.get(id);
            reconciled.push({
              taskId: id,
              outcome: 'released-orphan-claim',
              verified: after?.state === TaskLifecycle.SCHEDULED,
            });
          }
          // (5) التحقّق: لا حجزَ باقٍ لهذا العامل منذ إقلاعه.
          const residual = await ownRunningSince(now());
          if (residual.length > 0) {
            return verdictOf(
              fault,
              RECOVERY_VERDICTS.UNVERIFIED,
              RECOVERY_REASONS.RESIDUAL_CLAIMS,
              detail(),
            );
          }
        } catch (error) {
          if (error instanceof QueueError && error.code === QUEUE_ERRORS.LEASE_LOST) {
            // سُحب العقدُ بين القراءة والكتابة: حقيقةٌ لا تُكتب فوقها.
            reconciled.push({
              taskId: fault.taskId ?? 'unknown',
              outcome: 'lease-lost',
              verified: false,
            });
            return verdictOf(
              fault,
              RECOVERY_VERDICTS.UNVERIFIED,
              RECOVERY_REASONS.LEASE_LOST,
              detail(),
            );
          }
          const again = classifyDatabaseFault(error);
          if (again === null) throw error;
          if (again.kind !== DB_FAULT_KINDS.UNAVAILABLE) {
            return verdictOf(
              fault,
              RECOVERY_VERDICTS.FAILED,
              RECOVERY_REASONS.NOT_TRANSIENT,
              detail(),
            );
          }
          // انقطاعٌ ثانٍ أثناء التسوية: كلُّ فعلٍ فيها معاملةٌ ذرّيةٌ مشروطةٌ بالعقد،
          // فإعادتُها بعد القراءة من جديد لا تُكرّر أثراً.
          continue;
        }

        if (reconciled.some((entry) => !entry.verified)) {
          return verdictOf(
            fault,
            RECOVERY_VERDICTS.UNVERIFIED,
            RECOVERY_REASONS.LEASE_LOST,
            detail(),
          );
        }
        return verdictOf(fault, RECOVERY_VERDICTS.RECOVERED, RECOVERY_REASONS.RECONCILED, detail());
      }
    },
  });
}
