/**
 * محاكي أثر تغيّر السياسة — M4.08.
 *
 * قبل هذه الخطوة كان المقترح يُفعّل أولاً ثم يُكتشف أثره في التشغيل. ذلك يجعل
 * المواطنين والأنظمة حقل اختبار لتغيير صلاحية حساس. المحاكي يعيد تقييم قرارات
 * مسجلة على مجموعة حالية ومجموعة مقترحة، ولا يكتب قاعدةً ولا ينشّط نسخةً ولا
 * يخصم حصّة؛ هو قراءة حسابية فقط.
 *
 * حدٌّ معلن: التقرير يقيس القرارات الموجودة في مصرفه، لا كل الطلبات التي لم
 * تسجلها نقطة تفويض. كما أنه يعيد السياسة وحدها؛ لا يحاكي حالة الحصص المتحركة
 * أو إيقاف الدولة أو صحة أمر ملكي خارج حقل الطلب المسجل.
 */

import { PolicyDecisionPoint } from './engine.mjs';

/** @typedef {import('./loader.mjs').PolicyBundle} PolicyBundle */
/** @typedef {import('./model.mjs').PolicyRequest} PolicyRequest */
/** @typedef {import('./model.mjs').PolicyDecision} PolicyDecision */

/**
 * قرار محفوظ بالحد الأدنى اللازم لتقييم الطلب مرة أخرى. النتيجة التاريخية تحفظ
 * للدليل، لكن المقارنة تستمد «قبل» من `currentBundle` كي تقيس المقترح على الحالة
 * التي يريد صاحب التغيير استبدالها الآن.
 * @typedef {object} RecordedPolicyDecision
 * @property {PolicyRequest} request
 * @property {boolean} allowed
 * @property {string} code
 * @property {string | null} policyId
 * @property {number | null} policyVersion
 * @property {Date | null} recordedAt
 */

/**
 * مثال مقروء على تبدّل نتيجة واحدة، لا يكتفي بعداد يخفي من وقع عليه الأثر.
 * @typedef {object} PolicyImpactExample
 * @property {string} actor
 * @property {string} action
 * @property {string} resource
 * @property {string} beforeCode
 * @property {string} afterCode
 * @property {boolean} beforeAllowed
 * @property {boolean} afterAllowed
 */

/**
 * تقرير أثر مقترح على قرارات مسجلة.
 * @typedef {object} PolicyImpactReport
 * @property {number} total
 * @property {number} allowToDeny
 * @property {number} denyToAllow
 * @property {number} unchanged
 * @property {readonly PolicyImpactExample[]} examples
 */

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * @param {unknown} value
 * @param {string} name
 * @returns {string}
 */
function readText(value, name) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`POLICY_DECISION_RECORD_INVALID: الحقل ${name} نص غير فارغ إلزامي.`);
  }
  return value;
}

/**
 * فئة الفاعل تُعاد كما سُجّلت. والقصر على القائمة المغلقة متروك للنموذج لا مكرَّر
 * هنا: قرارٌ سُجّل بفئة لا يعرفها النموذج يجب أن يُرفض عند القراءة لا أن يُصمت
 * عنه، لكن رفضه بقائمة ثانية في هذا الملف يجعل القائمتين تنحرفان.
 * @param {unknown} value
 * @returns {import('./model.mjs').ActorKind | undefined}
 */
function readActorType(value) {
  if (value === null || value === undefined) return undefined;
  if (value === 'human' || value === 'autonomous' || value === 'service') return value;
  throw new Error('POLICY_DECISION_RECORD_INVALID: actor_kind غير مدعوم.');
}

/**
 * يحوّل صف قاعدة البيانات إلى طلب المحرك. القراءة ترفض السجل الناقص بدلاً من
 * اختراع حالة «active» أو مورد من نص؛ اختراع الماضي يجعل تقرير الأثر أدق ظاهرياً
 * وأكذب فعلياً.
 * @param {Record<string, unknown>} row
 * @returns {RecordedPolicyDecision}
 */
export function recordedPolicyDecisionFromRow(row) {
  const resource = row['resource'];
  const context = row['context'];
  if (!isRecord(resource) || !isRecord(context)) {
    throw new Error('POLICY_DECISION_RECORD_INVALID: المورد والسياق يجب أن يكونا كائنين.');
  }
  const kind = readActorType(row['actor_kind']);
  const actor = {
    id: readText(row['actor_id'], 'actor_id'),
    role: readText(row['actor_role'], 'actor_role'),
    state: readText(row['actor_state'], 'actor_state'),
    ...(kind === undefined ? {} : { kind }),
    ...(typeof row['actor_scope'] === 'string' ? { scope: row['actor_scope'] } : {}),
  };
  /** @type {PolicyRequest} */
  const request = {
    actor,
    action: readText(row['action'], 'action'),
    resource: /** @type {PolicyRequest['resource']} */ (/** @type {unknown} */ (resource)),
    context,
    ...(typeof row['scope'] === 'string' ? { scope: row['scope'] } : {}),
    ...(typeof row['royal_command_id'] === 'string'
      ? { royalCommandId: row['royal_command_id'] }
      : {}),
  };
  return {
    request,
    allowed: Boolean(row['allowed']),
    code: readText(row['code'], 'code'),
    policyId:
      row['policy_id'] === null || row['policy_id'] === undefined ? null : String(row['policy_id']),
    policyVersion:
      row['policy_version'] === null || row['policy_version'] === undefined
        ? null
        : Number(row['policy_version']),
    recordedAt: row['created_at'] instanceof Date ? row['created_at'] : null,
  };
}

/**
 * اقرأ القرارات من مصرف الحوكمة. لا تعديل هنا عمداً: اتصال قراءة يمكنه تشغيل
 * المحاكي بأمان في مرحلة المراجعة قبل الاعتماد.
 * @param {import('pg').Pool} pool
 * @param {{ limit?: number }} [options]
 * @returns {Promise<RecordedPolicyDecision[]>}
 */
export async function readRecordedPolicyDecisions(pool, options = {}) {
  const limit = options.limit ?? 10_000;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100_000) {
    throw new Error('POLICY_SIMULATION_LIMIT_INVALID');
  }
  const result = await pool.query(
    `SELECT actor_id, actor_role, actor_state, actor_kind, actor_scope, action,
            resource, context, scope, royal_command_id, code, allowed,
            policy_id, policy_version, created_at
       FROM state.policy_decisions
      ORDER BY id ASC
      LIMIT $1`,
    [limit],
  );
  return result.rows.map((row) =>
    recordedPolicyDecisionFromRow(/** @type {Record<string, unknown>} */ (row)),
  );
}

/**
 * سجّل قراراً من نقطة التفويض بشكل يمكن للمحاكي إعادته. تصدير المصرف وحده لا
 * يربط نقطة التفويض تلقائياً لأن الوحدة لا تملك دورة تشغيلها؛ يمرر المركّب هذه
 * الدالة إلى `EnforcementPoint` بوصفها `decisionSink`.
 * @param {{ pool: import('pg').Pool }} deps
 * @returns {(record: { decision: PolicyDecision, request: PolicyRequest }) => Promise<void>}
 */
export function createPolicyDecisionSink({ pool }) {
  if (!pool) throw new Error('POLICY_DECISION_SINK_DEPENDENCY_MISSING');
  return async ({ decision, request }) => {
    await pool.query(
      `INSERT INTO state.policy_decisions
        (actor_id, actor_role, actor_state, actor_kind, actor_scope, action,
         resource, context, scope, royal_command_id, code, allowed,
         policy_id, policy_version)
       VALUES
        ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9, $10, $11, $12, $13, $14)`,
      [
        request.actor.id,
        request.actor.role,
        request.actor.state,
        request.actor.kind ?? null,
        request.actor.scope ?? null,
        request.action,
        JSON.stringify(request.resource),
        JSON.stringify(request.context ?? {}),
        request.scope ?? null,
        request.royalCommandId ?? null,
        decision.code,
        decision.allowed,
        decision.policyId,
        decision.policyVersion,
      ],
    );
  };
}

/**
 * احسب أثر مجموعة مقترحة من دون أي كتابة. الأمثلة تشمل كل التحولات وتقتصر على
 * أول عشرين مثالاً كي يبقى التقرير قابلاً للقراءة؛ العداد الكلي لا يقتصر.
 * @param {{ recorded: readonly RecordedPolicyDecision[], currentBundle: PolicyBundle, proposedBundle: PolicyBundle }} input
 * @returns {PolicyImpactReport}
 */
export function simulatePolicyChange({ recorded, currentBundle, proposedBundle }) {
  const current = new PolicyDecisionPoint({ bundle: currentBundle });
  const proposed = new PolicyDecisionPoint({ bundle: proposedBundle });
  let allowToDeny = 0;
  let denyToAllow = 0;
  let unchanged = 0;
  /** @type {PolicyImpactExample[]} */
  const examples = [];
  for (const record of recorded) {
    const before = current.evaluate(record.request);
    const after = proposed.evaluate(record.request);
    if (before.allowed && !after.allowed) {
      allowToDeny += 1;
    } else if (!before.allowed && after.allowed) {
      denyToAllow += 1;
    } else {
      unchanged += 1;
    }
    if (before.allowed !== after.allowed && examples.length < 20) {
      examples.push(
        Object.freeze({
          actor: record.request.actor.id,
          action: record.request.action,
          resource: `${record.request.resource.type}:${record.request.resource.id}`,
          beforeCode: before.code,
          afterCode: after.code,
          beforeAllowed: before.allowed,
          afterAllowed: after.allowed,
        }),
      );
    }
  }
  return Object.freeze({
    total: recorded.length,
    allowToDeny,
    denyToAllow,
    unchanged,
    examples: Object.freeze(examples),
  });
}
