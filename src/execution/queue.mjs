/**
 * طابور المهام الدائم — الخطوات `M5.02` و`M5.03` و`M5.04` و`M5.07`.
 *
 * المسألة: الطابور القديم كان `Map` في عملية واحدة. فإن ماتت العملية ماتت معها
 * كل مهمة لم تنتهِ ولا أثر لها، وإن أُريد عاملٌ ثانٍ لم يكن له طريق يرى الطابور
 * أصلاً. ولذلك لم تكن «إعادة المحاولة» و«الأولوية» غائبةً عن الكود فحسب، بل
 * كانت **غير ممكنة**: كلتاهما تحتاج حالةً تدوم أطول من العملية.
 *
 * القرارات الأربعة التي يقوم عليها هذا الطابور:
 *
 * 1. **الحجز ذرّي في القاعدة** بـ`FOR UPDATE SKIP LOCKED`: عاملان يسألان معاً
 *    فيأخذ كلٌّ منهما مهمةً مختلفة، بلا قفلٍ عام يوقف الطابور كله.
 * 2. **العقد (`lease`) لا نبضة القلب.** العامل يملك المهمة إلى وقتٍ معلَن في
 *    القاعدة. فمن مات بـ`SIGKILL` — ولا يملك أن يُعلن موته — يُستعاد عمله عند
 *    انتهاء عقده. ولا يُعتمد على `finally` لأن القتل لا يمرّ بـ`finally`.
 * 3. **مفتاح عدم التكرار فريدٌ في القاعدة** لا مجموعةٌ في الذاكرة: مئة إرسال
 *    متزامن لنفس المفتاح ⇒ صفٌّ واحد، والباقي يقرأ الصفّ نفسه ولا يُنشئ ثانياً.
 * 4. **كل انتقال يُكتب صفّاً** في `state.task_transitions` داخل نفس المعاملة.
 *    فليس في هذا الملف تغييرُ حالةٍ بلا أثرٍ محاسبي.
 *
 * حدود معلنة:
 * - **التأجيل التراجعي بلا تشويش (jitter)**: ألف مهمة فشلت في اللحظة نفسها
 *   تُصبح متاحة في اللحظة نفسها. مقبولٌ عند هذا الحجم، ويُصلَح بتشويش معلَن حين
 *   يُقاس أثره في `M5.09`.
 * - **الطابور لا يُنفّذ**: التنفيذ وحدوده في `worker.mjs` و`limits.mjs`. من قرأ
 *   «المهمة محجوزة» فليقرأها «لعاملٍ التزم بعقدها»، لا «تعمل الآن قطعاً».
 * - **لا تشذيب** للمهام المنتهية ولا للانتقالات: الجدول ينمو، وسياسة الاحتفاظ
 *   (`M3.08`) لا تعرف هذين الجدولين بعد.
 */

import { randomUUID } from 'node:crypto';
import { withTransaction } from '../persistence/db.mjs';
import { assertTransition, TaskLifecycle } from './lifecycle.mjs';

export const QUEUE_ERRORS = Object.freeze({
  DEPENDENCY_MISSING: 'QUEUE_DEPENDENCY_MISSING',
  FIELD_INVALID: 'TASK_FIELD_INVALID',
  AUTHORIZATION_REQUIRED: 'TASK_AUTHORIZATION_REQUIRED',
  IDEMPOTENCY_CONFLICT: 'TASK_IDEMPOTENCY_CONFLICT',
  NOT_FOUND: 'TASK_NOT_FOUND',
  LEASE_LOST: 'TASK_LEASE_LOST',
  PARENT_TERMINAL: 'TASK_PARENT_TERMINAL',
});

/** خطأ طابور مسمّى برمز يُفرَّق به آلياً. */
export class QueueError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   */
  constructor(code, message) {
    super(message);
    this.name = 'QueueError';
    /** @type {string} */
    this.code = code;
  }
}

/**
 * صورة مهمة كما تُقرأ من القاعدة.
 * @typedef {object} TaskRecord
 * @property {string} id
 * @property {string} idempotencyKey
 * @property {string} action
 * @property {string} target
 * @property {string} actorId
 * @property {Record<string, unknown>} payload
 * @property {string | null} parentId
 * @property {string} rootId
 * @property {number} priority
 * @property {string} state
 * @property {number} attempts
 * @property {number} maxAttempts
 * @property {Date} availableAt
 * @property {number} timeoutMs
 * @property {number} memoryLimitMb
 * @property {string | null} budgetResource
 * @property {number} budgetAmount
 * @property {string | null} leaseOwner
 * @property {Date | null} leaseExpiresAt
 * @property {boolean} cancelRequested
 * @property {string | null} cancelReason
 * @property {Record<string, unknown> | null} result
 * @property {string | null} errorCode
 * @property {string | null} errorMessage
 * @property {Date} createdAt
 * @property {Date | null} startedAt
 * @property {Date | null} finishedAt
 */

const SELECT_COLUMNS = `
  id, idempotency_key, action, target, actor_id, payload, parent_id, root_id, priority,
  state, attempts, max_attempts, available_at, timeout_ms, memory_limit_mb,
  budget_resource, budget_amount, lease_owner, lease_expires_at, cancel_requested,
  cancel_reason, result, error_code, error_message, created_at, started_at, finished_at
`;

/**
 * القائمة نفسها مؤهَّلة باسم مستعار للجدول. تلزم حيث يُضمّ الجدول إلى تعبيرٍ آخر
 * فيه عمود `id` أيضاً (كما في حجز `FOR UPDATE SKIP LOCKED` الذي يضمّ CTE اسمه
 * `candidate` وفيه `id`): قائمةٌ غير مؤهَّلة هناك تُخرج خطأ «column reference id
 * is ambiguous» من PostgreSQL لا خطأً مقروءاً من الكود.
 * @param {string} alias
 * @returns {string}
 */
function qualifiedColumns(alias) {
  return SELECT_COLUMNS.split(',')
    .map((column) => `${alias}.${column.trim()}`)
    .join(', ');
}

/** حدّ التأجيل الأعلى: تأجيلٌ لا سقف له يُخرج المهمة من الرصد بلا أن تُعلن ميتة. */
const BACKOFF_CAP_MS = 30_000;
const BACKOFF_BASE_MS = 100;

/**
 * التأجيل التراجعي: `100ms × 2^(المحاولة−1)` بسقف 30 ثانية. حتمي بلا تشويش،
 * والحدّ معلَن في رأس الملف.
 * @param {number} attempt - رقم المحاولة التي فشلت (يبدأ من 1)
 * @returns {number} ميلي ثانية
 */
export function backoffMs(attempt) {
  if (!Number.isInteger(attempt) || attempt < 1) return BACKOFF_BASE_MS;
  const raw = BACKOFF_BASE_MS * 2 ** (attempt - 1);
  return Math.min(raw, BACKOFF_CAP_MS);
}

/**
 * يحوّل صفّ القاعدة إلى صورة مهمة. التحويل صريح لأن أسماء الأعمدة عقد القاعدة
 * وأسماء الحقول عقد الكود، وخلطُهما يجعل تغيير عمودٍ خرقاً صامتاً في الواجهة.
 * @param {Record<string, unknown>} row
 * @returns {TaskRecord}
 */
function toTask(row) {
  return {
    id: String(row['id']),
    idempotencyKey: String(row['idempotency_key']),
    action: String(row['action']),
    target: String(row['target']),
    actorId: String(row['actor_id']),
    payload: /** @type {Record<string, unknown>} */ (row['payload'] ?? {}),
    parentId: row['parent_id'] === null ? null : String(row['parent_id']),
    rootId: String(row['root_id']),
    priority: Number(row['priority']),
    state: String(row['state']),
    attempts: Number(row['attempts']),
    maxAttempts: Number(row['max_attempts']),
    availableAt: /** @type {Date} */ (row['available_at']),
    timeoutMs: Number(row['timeout_ms']),
    memoryLimitMb: Number(row['memory_limit_mb']),
    budgetResource: row['budget_resource'] === null ? null : String(row['budget_resource']),
    budgetAmount: Number(row['budget_amount']),
    leaseOwner: row['lease_owner'] === null ? null : String(row['lease_owner']),
    leaseExpiresAt: /** @type {Date | null} */ (row['lease_expires_at'] ?? null),
    cancelRequested: row['cancel_requested'] === true,
    cancelReason: row['cancel_reason'] === null ? null : String(row['cancel_reason']),
    result: /** @type {Record<string, unknown> | null} */ (row['result'] ?? null),
    errorCode: row['error_code'] === null ? null : String(row['error_code']),
    errorMessage: row['error_message'] === null ? null : String(row['error_message']),
    createdAt: /** @type {Date} */ (row['created_at']),
    startedAt: /** @type {Date | null} */ (row['started_at'] ?? null),
    finishedAt: /** @type {Date | null} */ (row['finished_at'] ?? null),
  };
}

/**
 * @param {unknown} value
 * @param {string} field
 * @returns {string}
 */
function requireText(value, field) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new QueueError(QUEUE_ERRORS.FIELD_INVALID, `${field} نصٌّ غير فارغ إلزاماً.`);
  }
  return value;
}

/**
 * ينشئ طابور مهام على مجمّع وصلات.
 * @param {{ pool?: import('pg').Pool, now?: () => Date, leaseMs?: number }} [deps]
 */
export function createTaskQueue({ pool, now = () => new Date(), leaseMs = 30_000 } = {}) {
  if (!pool) throw new QueueError(QUEUE_ERRORS.DEPENDENCY_MISSING, 'الطابور يلزمه مجمّع وصلات.');

  /**
   * يكتب صفّ انتقال. يُنادى **داخل** معاملة النداء الذي غيّر الحالة، فلا يوجد
   * انتقالٌ في القاعدة بلا صفٍّ يشرحه ولا صفٌّ عن انتقالٍ لم يقع.
   * @param {import('pg').PoolClient} client
   * @param {{ taskId: string, from: string | null, to: string, reason: string, actor: string, attempt: number, at: Date }} entry
   * @returns {Promise<void>}
   */
  async function recordTransition(client, entry) {
    if (entry.from !== null) assertTransition(entry.from, entry.to);
    await client.query(
      `INSERT INTO state.task_transitions (task_id, from_state, to_state, reason, actor, attempt, at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [entry.taskId, entry.from, entry.to, entry.reason, entry.actor, entry.attempt, entry.at],
    );
  }

  /**
   * يقرأ مهمة بمعرّفها داخل وصلة معطاة.
   * @param {import('pg').PoolClient | import('pg').Pool} client
   * @param {string} id
   * @returns {Promise<TaskRecord | null>}
   */
  async function readTask(client, id) {
    const found = await client.query(`SELECT ${SELECT_COLUMNS} FROM state.tasks WHERE id = $1`, [
      id,
    ]);
    const row = found.rows[0];
    return row === undefined ? null : toTask(/** @type {Record<string, unknown>} */ (row));
  }

  return {
    /**
     * يُدخل مهمة الطابور. تمرّ حتماً بثلاث حالات في معاملة واحدة:
     * `created ⇒ authorized ⇒ scheduled`. و`authorized` **تستوجب معرّف قرار**:
     * لا تدخل مهمة الطابور بلا قرارٍ صادر عن نقطة التفويض (`M4.05`)، ومن لم
     * يحمل قراراً يُرفض بـ`TASK_AUTHORIZATION_REQUIRED` لا يُدخل بصمت.
     *
     * وتكرار المفتاح **ليس خطأً**: يُعاد الصفّ القائم مع `created: false`، لأن
     * إعادة الإرسال بعد انقطاع شبكة سلوكٌ صحيح من المرسل لا خطأٌ منه.
     * @param {{ action: string, target: string, actorId: string, idempotencyKey: string, payload?: Record<string, unknown>, priority?: number, parentId?: string | null, maxAttempts?: number, timeoutMs?: number, memoryLimitMb?: number, budgetResource?: string | null, budgetAmount?: number, availableAt?: Date }} request
     * @param {{ decisionId: string, policyId?: string | null }} authorization
     * @returns {Promise<{ task: TaskRecord, created: boolean }>}
     */
    async enqueue(request, authorization) {
      const action = requireText(request.action, 'action');
      const target = requireText(request.target, 'target');
      const actorId = requireText(request.actorId, 'actorId');
      const idempotencyKey = requireText(request.idempotencyKey, 'idempotencyKey');
      if (
        authorization === undefined ||
        typeof authorization.decisionId !== 'string' ||
        authorization.decisionId.trim() === ''
      ) {
        throw new QueueError(
          QUEUE_ERRORS.AUTHORIZATION_REQUIRED,
          'لا تدخل مهمة الطابور بلا معرّف قرار من نقطة التفويض (M4.05).',
        );
      }
      const at = now();
      const id = randomUUID();

      return withTransaction(pool, async (client) => {
        /** @type {string} */
        let rootId = id;
        if (request.parentId !== undefined && request.parentId !== null) {
          const parent = await readTask(client, request.parentId);
          if (parent === null) {
            throw new QueueError(QUEUE_ERRORS.NOT_FOUND, `الأب غير موجود: ${request.parentId}`);
          }
          // فرعٌ لأبٍ انتهى أمره لا معنى له: إن كان الأب ملغى فالفرع يُنشأ ملغى
          // بالتعريف، وإن كان ناجحاً فالعمل انتهى. الرفض أصدق من الإنشاء المعلّق.
          if (
            parent.state === TaskLifecycle.CANCELLED ||
            parent.state === TaskLifecycle.SUCCEEDED ||
            parent.state === TaskLifecycle.FAILED
          ) {
            throw new QueueError(
              QUEUE_ERRORS.PARENT_TERMINAL,
              `الأب في حالة نهائية (${parent.state}) فلا يُنشأ له فرع.`,
            );
          }
          rootId = parent.rootId;
        }

        const inserted = await client.query(
          `INSERT INTO state.tasks (
             id, idempotency_key, action, target, actor_id, payload, parent_id, root_id,
             priority, state, max_attempts, available_at, timeout_ms, memory_limit_mb,
             budget_resource, budget_amount, created_at, state_changed_at
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'created', $10, $11, $12, $13, $14, $15, $16, $16)
           ON CONFLICT (idempotency_key) DO NOTHING
           RETURNING ${SELECT_COLUMNS}`,
          [
            id,
            idempotencyKey,
            action,
            target,
            actorId,
            JSON.stringify(request.payload ?? {}),
            request.parentId ?? null,
            rootId,
            request.priority ?? 100,
            request.maxAttempts ?? 3,
            request.availableAt ?? at,
            request.timeoutMs ?? 30_000,
            request.memoryLimitMb ?? 256,
            request.budgetResource ?? null,
            request.budgetAmount ?? 0,
            at,
          ],
        );

        const row = inserted.rows[0];
        if (row === undefined) {
          // المفتاح موجود: نُعيد الصفّ القائم. وإن لم يُقرأ (سباقٌ مع معاملة لم
          // تُثبَّت بعد) فذلك تعارضٌ يُسمّى ولا يُخمَّن.
          const existing = await client.query(
            `SELECT ${SELECT_COLUMNS} FROM state.tasks WHERE idempotency_key = $1`,
            [idempotencyKey],
          );
          const found = existing.rows[0];
          if (found === undefined) {
            throw new QueueError(
              QUEUE_ERRORS.IDEMPOTENCY_CONFLICT,
              'المفتاح محجوز في معاملة أخرى لم تُثبَّت بعد.',
            );
          }
          return {
            task: toTask(/** @type {Record<string, unknown>} */ (found)),
            created: false,
          };
        }

        await recordTransition(client, {
          taskId: id,
          from: null,
          to: TaskLifecycle.CREATED,
          reason: 'أُنشئت المهمة',
          actor: actorId,
          attempt: 0,
          at,
        });
        for (const [to, reason] of [
          [TaskLifecycle.AUTHORIZED, `قرار نقطة التفويض ${authorization.decisionId}`],
          [TaskLifecycle.SCHEDULED, 'أُدخلت الطابور'],
        ]) {
          const from =
            to === TaskLifecycle.AUTHORIZED ? TaskLifecycle.CREATED : TaskLifecycle.AUTHORIZED;
          await recordTransition(client, {
            taskId: id,
            from,
            to: /** @type {string} */ (to),
            reason: /** @type {string} */ (reason),
            actor: actorId,
            attempt: 0,
            at,
          });
        }
        const scheduled = await client.query(
          `UPDATE state.tasks SET state = 'scheduled', state_changed_at = $2
           WHERE id = $1 RETURNING ${SELECT_COLUMNS}`,
          [id, at],
        );
        return {
          task: toTask(/** @type {Record<string, unknown>} */ (scheduled.rows[0])),
          created: true,
        };
      });
    },

    /**
     * يحجز مهاماً حجزاً ذرّياً. `FOR UPDATE SKIP LOCKED` هو ما يجعل عاملين
     * متزامنين يأخذان مهمتين مختلفتين بلا انتظار أحدهما الآخر.
     *
     * والمحاولة تُزاد **عند الحجز** لا عند الفشل: عاملٌ يُقتل بعد الحجز وقبل أي
     * نتيجة يجب أن تُحسب محاولته، وإلا صارت المهمة التي تقتل عاملها تُحجز إلى
     * الأبد بلا أن تستنفد محاولاتها.
     * @param {{ worker: string, limit?: number, leaseMs?: number }} request
     * @returns {Promise<TaskRecord[]>}
     */
    async claim(request) {
      const worker = requireText(request.worker, 'worker');
      const limit = request.limit ?? 1;
      const lease = request.leaseMs ?? leaseMs;
      const at = now();
      const expires = new Date(at.getTime() + lease);

      return withTransaction(pool, async (client) => {
        const claimed = await client.query(
          `WITH candidate AS (
             SELECT id FROM state.tasks
             WHERE state = 'scheduled'
               AND available_at <= $1
               AND cancel_requested = false
             ORDER BY priority ASC, available_at ASC, created_at ASC
             FOR UPDATE SKIP LOCKED
             LIMIT $2
           )
           UPDATE state.tasks t
              SET state = 'running',
                  lease_owner = $3,
                  lease_expires_at = $4,
                  started_at = COALESCE(t.started_at, $1),
                  attempts = t.attempts + 1,
                  state_changed_at = $1
             FROM candidate c
            WHERE t.id = c.id
            RETURNING ${qualifiedColumns('t')}`,
          [at, limit, worker, expires],
        );
        /** @type {TaskRecord[]} */
        const tasks = [];
        for (const row of claimed.rows) {
          const task = toTask(/** @type {Record<string, unknown>} */ (row));
          await recordTransition(client, {
            taskId: task.id,
            from: TaskLifecycle.SCHEDULED,
            to: TaskLifecycle.RUNNING,
            reason: `حجزها العامل ${worker} بعقد ينتهي ${expires.toISOString()}`,
            actor: worker,
            attempt: task.attempts,
            at,
          });
          tasks.push(task);
        }
        return tasks;
      });
    },

    /**
     * يمدّ العقد ويُخبر العامل إن كان الإلغاء مطلوباً. الجواب هو الطريق الذي
     * يعرف به العامل الطويل أن عليه التوقّف (`M5.07`).
     * @param {{ taskId: string, worker: string, leaseMs?: number }} request
     * @returns {Promise<{ extended: boolean, cancelRequested: boolean, leaseExpiresAt: Date | null }>}
     */
    async heartbeat(request) {
      const at = now();
      const expires = new Date(at.getTime() + (request.leaseMs ?? leaseMs));
      const updated = await pool.query(
        `UPDATE state.tasks
            SET lease_expires_at = $3
          WHERE id = $1 AND lease_owner = $2 AND state = 'running'
          RETURNING cancel_requested, lease_expires_at`,
        [request.taskId, request.worker, expires],
      );
      const row = updated.rows[0];
      if (row === undefined) {
        // فقدُ العقد ليس خطأً في العامل بل حقيقةٌ عنه: مهمته استُعيدت أو أُلغيت.
        const current = await readTask(pool, request.taskId);
        return {
          extended: false,
          cancelRequested: current?.cancelRequested ?? true,
          leaseExpiresAt: current?.leaseExpiresAt ?? null,
        };
      }
      const record = /** @type {Record<string, unknown>} */ (row);
      return {
        extended: true,
        cancelRequested: record['cancel_requested'] === true,
        leaseExpiresAt: /** @type {Date} */ (record['lease_expires_at']),
      };
    },

    /**
     * يُنهي مهمة بنجاح. مشروطٌ بملكية العقد: من فقد عقده لا يكتب نتيجة، وإلا
     * كتب عاملٌ بطيء نتيجةً على مهمةٍ يُنفّذها غيره الآن.
     * @param {{ taskId: string, worker: string, result?: Record<string, unknown> }} request
     * @returns {Promise<TaskRecord>}
     */
    async succeed(request) {
      const at = now();
      return withTransaction(pool, async (client) => {
        const updated = await client.query(
          `UPDATE state.tasks
              SET state = 'succeeded', result = $3, finished_at = $4, state_changed_at = $4,
                  lease_owner = NULL, lease_expires_at = NULL
            WHERE id = $1 AND lease_owner = $2 AND state = 'running'
            RETURNING ${SELECT_COLUMNS}`,
          [request.taskId, request.worker, JSON.stringify(request.result ?? {}), at],
        );
        const row = updated.rows[0];
        if (row === undefined) {
          throw new QueueError(
            QUEUE_ERRORS.LEASE_LOST,
            `العقد ليس لك أو المهمة ليست جارية: ${request.taskId}`,
          );
        }
        const task = toTask(/** @type {Record<string, unknown>} */ (row));
        await recordTransition(client, {
          taskId: task.id,
          from: TaskLifecycle.RUNNING,
          to: TaskLifecycle.SUCCEEDED,
          reason: 'انتهى المُعالِج بنجاح',
          actor: request.worker,
          attempt: task.attempts,
          at,
        });
        return task;
      });
    },

    /**
     * يُسجّل فشلاً: إعادةٌ إلى الطابور بتأجيل تراجعي إن بقيت محاولات، وإلا
     * فشلٌ نهائي **ونقلٌ إلى طابور الرسائل الميتة** بالحمولة كاملة.
     * @param {{ taskId: string, worker: string, code: string, message: string, retryable?: boolean }} request
     * @returns {Promise<{ task: TaskRecord, requeued: boolean, deadLettered: boolean }>}
     */
    async fail(request) {
      const at = now();
      const code = requireText(request.code, 'code');
      const message = requireText(request.message, 'message');
      return withTransaction(pool, async (client) => {
        const locked = await client.query(
          `SELECT ${SELECT_COLUMNS} FROM state.tasks
            WHERE id = $1 AND lease_owner = $2 AND state = 'running' FOR UPDATE`,
          [request.taskId, request.worker],
        );
        const lockedRow = locked.rows[0];
        if (lockedRow === undefined) {
          throw new QueueError(
            QUEUE_ERRORS.LEASE_LOST,
            `العقد ليس لك أو المهمة ليست جارية: ${request.taskId}`,
          );
        }
        const current = toTask(/** @type {Record<string, unknown>} */ (lockedRow));
        const retryable = request.retryable ?? true;
        const canRetry = retryable && current.attempts < current.maxAttempts;

        if (canRetry) {
          const availableAt = new Date(at.getTime() + backoffMs(current.attempts));
          const requeued = await client.query(
            `UPDATE state.tasks
                SET state = 'scheduled', available_at = $2, error_code = $3, error_message = $4,
                    lease_owner = NULL, lease_expires_at = NULL, state_changed_at = $5
              WHERE id = $1 RETURNING ${SELECT_COLUMNS}`,
            [current.id, availableAt, code, message, at],
          );
          await recordTransition(client, {
            taskId: current.id,
            from: TaskLifecycle.RUNNING,
            to: TaskLifecycle.SCHEDULED,
            reason: `فشل (${code}) والمحاولات ${current.attempts}/${current.maxAttempts} — تأجيل إلى ${availableAt.toISOString()}`,
            actor: request.worker,
            attempt: current.attempts,
            at,
          });
          return {
            task: toTask(/** @type {Record<string, unknown>} */ (requeued.rows[0])),
            requeued: true,
            deadLettered: false,
          };
        }

        const failed = await client.query(
          `UPDATE state.tasks
              SET state = 'failed', error_code = $2, error_message = $3, finished_at = $4,
                  state_changed_at = $4, lease_owner = NULL, lease_expires_at = NULL
            WHERE id = $1 RETURNING ${SELECT_COLUMNS}`,
          [current.id, code, message, at],
        );
        await recordTransition(client, {
          taskId: current.id,
          from: TaskLifecycle.RUNNING,
          to: TaskLifecycle.FAILED,
          reason: retryable
            ? `استُنفدت المحاولات (${current.attempts}/${current.maxAttempts}): ${code}`
            : `فشل غير قابل للإعادة: ${code}`,
          actor: request.worker,
          attempt: current.attempts,
          at,
        });
        await client.query(
          `INSERT INTO state.task_dead_letters (task_id, action, payload, attempts, error_code, error_message, moved_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (task_id) DO NOTHING`,
          [
            current.id,
            current.action,
            JSON.stringify(current.payload),
            current.attempts,
            code,
            message,
            at,
          ],
        );
        return {
          task: toTask(/** @type {Record<string, unknown>} */ (failed.rows[0])),
          requeued: false,
          deadLettered: true,
        };
      });
    },

    /**
     * يستعيد المهام التي انتهت عقودها: عاملُها مات أو تجمّد. تعود إلى الطابور
     * إن بقيت محاولات، وإلا تُعلن فاشلة وتُنقل إلى الرسائل الميتة.
     *
     * وهذه هي الدالة التي تجعل `kill -9` **استعادةً**: لا `finally` يُنفَّذ عند
     * القتل، فالحقيقة الوحيدة الباقية هي عقدٌ منتهٍ في القاعدة.
     * @param {{ actor?: string, limit?: number }} [request]
     * @returns {Promise<{ requeued: TaskRecord[], failed: TaskRecord[] }>}
     */
    async reclaimExpired(request = {}) {
      const at = now();
      const actor = request.actor ?? 'reaper';
      return withTransaction(pool, async (client) => {
        const expired = await client.query(
          `SELECT ${SELECT_COLUMNS} FROM state.tasks
            WHERE state = 'running' AND lease_expires_at < $1
            ORDER BY lease_expires_at ASC
            FOR UPDATE SKIP LOCKED
            LIMIT $2`,
          [at, request.limit ?? 100],
        );
        /** @type {TaskRecord[]} */
        const requeued = [];
        /** @type {TaskRecord[]} */
        const failed = [];
        for (const row of expired.rows) {
          const task = toTask(/** @type {Record<string, unknown>} */ (row));
          const code = 'TASK_LEASE_EXPIRED';
          const message = `انتهى عقد العامل ${task.leaseOwner ?? 'مجهول'} بلا نتيجة.`;
          if (task.attempts < task.maxAttempts) {
            const availableAt = new Date(at.getTime() + backoffMs(task.attempts));
            const updated = await client.query(
              `UPDATE state.tasks
                  SET state = 'scheduled', available_at = $2, error_code = $3, error_message = $4,
                      lease_owner = NULL, lease_expires_at = NULL, state_changed_at = $5
                WHERE id = $1 RETURNING ${SELECT_COLUMNS}`,
              [task.id, availableAt, code, message, at],
            );
            await recordTransition(client, {
              taskId: task.id,
              from: TaskLifecycle.RUNNING,
              to: TaskLifecycle.SCHEDULED,
              reason: `${message} أُعيدت إلى الطابور (${task.attempts}/${task.maxAttempts}).`,
              actor,
              attempt: task.attempts,
              at,
            });
            requeued.push(toTask(/** @type {Record<string, unknown>} */ (updated.rows[0])));
            continue;
          }
          const updated = await client.query(
            `UPDATE state.tasks
                SET state = 'failed', error_code = $2, error_message = $3, finished_at = $4,
                    state_changed_at = $4, lease_owner = NULL, lease_expires_at = NULL
              WHERE id = $1 RETURNING ${SELECT_COLUMNS}`,
            [task.id, code, message, at],
          );
          await recordTransition(client, {
            taskId: task.id,
            from: TaskLifecycle.RUNNING,
            to: TaskLifecycle.FAILED,
            reason: `${message} واستُنفدت المحاولات.`,
            actor,
            attempt: task.attempts,
            at,
          });
          await client.query(
            `INSERT INTO state.task_dead_letters (task_id, action, payload, attempts, error_code, error_message, moved_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (task_id) DO NOTHING`,
            [task.id, task.action, JSON.stringify(task.payload), task.attempts, code, message, at],
          );
          failed.push(toTask(/** @type {Record<string, unknown>} */ (updated.rows[0])));
        }
        return { requeued, failed };
      });
    },

    /**
     * إلغاء منتشر (`M5.07`): يُلغي المهمة وكل فروعها إلى أي عمق.
     *
     * الفرق بين حالتين مقصود: ما لم يبدأ يُلغى **حالاً** في نفس المعاملة، وما
     * يجري الآن تُرفع عليه علامة `cancel_requested` ويُنتظر توقّف عامله. لأن
     * إعلان مهمةٍ ملغاةً وهي لا تزال تكتب أثراً هو كذبٌ في السجل — والعامل هو من
     * يملك قتل عمليته، لا من يُلغي.
     * @param {{ taskId: string, reason: string, actor?: string }} request
     * @returns {Promise<{ cancelled: string[], signalled: string[] }>}
     */
    async cancelTree(request) {
      const reason = requireText(request.reason, 'reason');
      const actor = request.actor ?? 'crown';
      const at = now();
      return withTransaction(pool, async (client) => {
        // الشجرة تُجمع بـCTE تكراري: طبقةٌ واحدة كانت ستترك أحفاداً يعملون بعد
        // إلغاء جدّهم، وذلك أسوأ من ألّا يُلغى شيء لأنه يُقرأ إلغاءً تاماً.
        const subtree = await client.query(
          `WITH RECURSIVE tree AS (
             SELECT id, state FROM state.tasks WHERE id = $1
             UNION ALL
             SELECT t.id, t.state FROM state.tasks t JOIN tree ON t.parent_id = tree.id
           )
           SELECT id, state FROM tree`,
          [request.taskId],
        );
        if (subtree.rows.length === 0) {
          throw new QueueError(QUEUE_ERRORS.NOT_FOUND, `لا مهمة بهذا المعرّف: ${request.taskId}`);
        }
        /** @type {string[]} */
        const cancelled = [];
        /** @type {string[]} */
        const signalled = [];
        for (const raw of subtree.rows) {
          const row = /** @type {Record<string, unknown>} */ (raw);
          const id = String(row['id']);
          const state = String(row['state']);
          if (state === TaskLifecycle.RUNNING) {
            await client.query(
              `UPDATE state.tasks SET cancel_requested = true, cancel_reason = $2 WHERE id = $1`,
              [id, reason],
            );
            signalled.push(id);
            continue;
          }
          if (
            state === TaskLifecycle.SUCCEEDED ||
            state === TaskLifecycle.FAILED ||
            state === TaskLifecycle.CANCELLED
          ) {
            continue;
          }
          const updated = await client.query(
            `UPDATE state.tasks
                SET state = 'cancelled', cancel_requested = true, cancel_reason = $2,
                    finished_at = $3, state_changed_at = $3, lease_owner = NULL, lease_expires_at = NULL
              WHERE id = $1 RETURNING attempts`,
            [id, reason, at],
          );
          const attemptRow = /** @type {Record<string, unknown> | undefined} */ (updated.rows[0]);
          await recordTransition(client, {
            taskId: id,
            from: state,
            to: TaskLifecycle.CANCELLED,
            reason,
            actor,
            attempt: Number(attemptRow?.['attempts'] ?? 0),
            at,
          });
          cancelled.push(id);
        }
        return { cancelled, signalled };
      });
    },

    /**
     * يُثبت إلغاء مهمة جارية بعد أن أوقف عاملها التنفيذ فعلاً.
     * @param {{ taskId: string, worker: string, reason?: string }} request
     * @returns {Promise<TaskRecord>}
     */
    async confirmCancelled(request) {
      const at = now();
      return withTransaction(pool, async (client) => {
        const updated = await client.query(
          `UPDATE state.tasks
              SET state = 'cancelled', finished_at = $3, state_changed_at = $3,
                  cancel_requested = true,
                  cancel_reason = COALESCE(cancel_reason, $4),
                  lease_owner = NULL, lease_expires_at = NULL
            WHERE id = $1 AND lease_owner = $2 AND state = 'running'
            RETURNING ${SELECT_COLUMNS}`,
          [request.taskId, request.worker, at, request.reason ?? 'أُلغيت بطلب'],
        );
        const row = updated.rows[0];
        if (row === undefined) {
          throw new QueueError(
            QUEUE_ERRORS.LEASE_LOST,
            `العقد ليس لك أو المهمة ليست جارية: ${request.taskId}`,
          );
        }
        const task = toTask(/** @type {Record<string, unknown>} */ (row));
        await recordTransition(client, {
          taskId: task.id,
          from: TaskLifecycle.RUNNING,
          to: TaskLifecycle.CANCELLED,
          reason: task.cancelReason ?? 'أُلغيت بطلب',
          actor: request.worker,
          attempt: task.attempts,
          at,
        });
        return task;
      });
    },

    /**
     * يُفشل مهمة جارية بقرار خارجي (تجاوز مهلة أو حدّ ذاكرة قتله المُشرف).
     * تُستعمل حين لا يستطيع المُعالِج نفسه أن يُبلّغ لأنه قُتل.
     * @param {{ taskId: string, worker: string, code: string, message: string, retryable?: boolean }} request
     * @returns {Promise<{ task: TaskRecord, requeued: boolean, deadLettered: boolean }>}
     */
    async failByWatchdog(request) {
      return this.fail(request);
    },

    /**
     * @param {string} id
     * @returns {Promise<TaskRecord | null>}
     */
    async get(id) {
      return readTask(pool, id);
    },

    /**
     * @param {string} taskId
     * @returns {Promise<Array<{ from: string | null, to: string, reason: string, actor: string, attempt: number, at: Date }>>}
     */
    async transitions(taskId) {
      const found = await pool.query(
        `SELECT from_state, to_state, reason, actor, attempt, at
           FROM state.task_transitions WHERE task_id = $1 ORDER BY id ASC`,
        [taskId],
      );
      return found.rows.map((raw) => {
        const row = /** @type {Record<string, unknown>} */ (raw);
        return {
          from: row['from_state'] === null ? null : String(row['from_state']),
          to: String(row['to_state']),
          reason: String(row['reason']),
          actor: String(row['actor']),
          attempt: Number(row['attempt']),
          at: /** @type {Date} */ (row['at']),
        };
      });
    },

    /**
     * @returns {Promise<Array<{ taskId: string, action: string, attempts: number, errorCode: string }>>}
     */
    async deadLetters() {
      const found = await pool.query(
        `SELECT task_id, action, attempts, error_code FROM state.task_dead_letters ORDER BY moved_at ASC`,
      );
      return found.rows.map((raw) => {
        const row = /** @type {Record<string, unknown>} */ (raw);
        return {
          taskId: String(row['task_id']),
          action: String(row['action']),
          attempts: Number(row['attempts']),
          errorCode: String(row['error_code']),
        };
      });
    },

    /**
     * عدّاد لكل حالة. يُقرأ في اختبارات الضغط وفي تقرير السعة.
     * @returns {Promise<Record<string, number>>}
     */
    async counts() {
      const found = await pool.query(
        `SELECT state, count(*)::int AS total FROM state.tasks GROUP BY state`,
      );
      /** @type {Record<string, number>} */
      const counts = {};
      for (const raw of found.rows) {
        const row = /** @type {Record<string, unknown>} */ (raw);
        counts[String(row['state'])] = Number(row['total']);
      }
      return counts;
    },
  };
}
