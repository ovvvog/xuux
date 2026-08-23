/**
 * حوكمة إصدارات السياسة — M4.06.
 *
 * قبل هذا المصرف كانت السياسة ملف YAML يعدّله من يملك الكتابة على القرص، بلا
 * اعتماد مستقل ولا توقيع ولا سجل تغيّرات ولا تراجع قابل للمراجعة. هذه الوحدة لا
 * تجعل الملف آمناً بذاته، لكنها تجعل النسخة النافذة من القاعدة حدثاً موقّعاً
 * ومؤرخاً، وتبني للمحرّك مجموعةً تتقدّم فيها النسخ المعتمدة على بيانات الملفات.
 *
 * حدٌّ معلن: التوقيع يثبت أن المفتاح الذي يملكه `signer` وافق على المادة، ولا
 * يثبت وحده أن `approvedBy` يساوي هوية صاحب المفتاح. ربط مفاتيح الأشخاص
 * بالأدوار التنظيمية يحتاج سجل هويات منفصلاً ولم يُنفّذ في هذه الخطوة.
 */

import { createHash } from 'node:crypto';
import { withTransaction } from '../persistence/db.mjs';

/** @typedef {import('./loader.mjs').PolicyBundle} PolicyBundle */
/** @typedef {import('./model.mjs').PolicyRecord} PolicyRecord */

/** رموز أخطاء الحوكمة: يفرّق المستدعي بها لا بنص عربي متغير. */
export const POLICY_GOVERNANCE_ERRORS = Object.freeze({
  CHANGE_UNAPPROVED: 'POLICY_CHANGE_UNAPPROVED',
  SIGNATURE_INVALID: 'POLICY_CHANGE_SIGNATURE_INVALID',
  VERSION_MISSING: 'POLICY_VERSION_MISSING',
  VERSION_NOT_PENDING: 'POLICY_VERSION_NOT_PENDING',
  POLICY_INVALID: 'POLICY_VERSION_DOCUMENT_INVALID',
});

/** خطأ حوكمة يحمل رمزاً ثابتاً وقابلاً للاختبار. */
export class PolicyGovernanceError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   */
  constructor(code, message) {
    super(message);
    this.name = 'PolicyGovernanceError';
    this.code = code;
  }
}

/**
 * وثيقة نسخة كما تظهر خارج المصرف. لا تُعاد صفوف PostgreSQL الخام كي لا يتسرّب
 * شكل السائق إلى بقية النظام.
 * @typedef {object} PolicyVersion
 * @property {string} policyId
 * @property {number} version
 * @property {PolicyRecord} policy
 * @property {string} reason
 * @property {string} proposedBy
 * @property {string | null} approvedBy
 * @property {string | null} signature
 * @property {boolean} active
 * @property {Date} createdAt
 */

/**
 * أقل واجهة لازمة لفاحص التوقيع. تتوافق `KingIdentity` مباشرةً: لا نولّد HMAC
 * مخفياً في هذه الوحدة لأن التوقيع يجب أن يكون قابلاً للتحقق من سلطة خارج المصرف.
 * @typedef {{ verify: (payload: object, signature: string) => boolean }} PolicySigner
 */

/**
 * ثبّت تمثيلاً JSON بترتيب مفاتيح حتمي. توقيع `KingIdentity` يوقّع
 * `JSON.stringify`، وJSONB لا يعد بحفظ ترتيب مفاتيح النص الذي أُدخل؛ لذا لا
 * يجوز توقيع الوثيقة الخام ثم مقارنتها بصورة JSONB المتغيرة ترتيباً.
 * @param {unknown} value
 * @returns {string}
 */
function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  const record = /** @type {Record<string, unknown>} */ (value);
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(',')}}`;
}

/**
 * @param {unknown} policy
 * @returns {string}
 */
function policyDigest(policy) {
  return createHash('sha256').update(canonicalJson(policy), 'utf8').digest('hex');
}

/**
 * مادة اعتماد نسخة عادية. تصديرها مقصود: الجهة التي تملك مفتاح الملك تحتاج مادة
 * واحدة بالضبط لتوقيعها، لا نسخة مكررة قد تسقط منها حقولٌ حاكمة.
 * @param {{ policyId: string, version: number, policy: PolicyRecord, approvedBy: string }} input
 * @returns {{ type: 'policy-version-approval', policyId: string, version: number, policyDigest: string, approvedBy: string }}
 */
export function policyApprovalPayload({ policyId, version, policy, approvedBy }) {
  return {
    type: 'policy-version-approval',
    policyId,
    version,
    policyDigest: policyDigest(policy),
    approvedBy,
  };
}

/**
 * مادة توقيع التراجع. تضم السبب والنسخة المقصودة كي لا يصلح توقيع تراجعٍ قديم
 * لتنشيط نسخة أخرى أو لكتابة سبب مختلف بعد المراجعة.
 * @param {{ policyId: string, toVersion: number, policy: PolicyRecord, approvedBy: string, reason: string }} input
 * @returns {{ type: 'policy-version-rollback', policyId: string, toVersion: number, policyDigest: string, approvedBy: string, reason: string }}
 */
export function policyRollbackPayload({ policyId, toVersion, policy, approvedBy, reason }) {
  return {
    type: 'policy-version-rollback',
    policyId,
    toVersion,
    policyDigest: policyDigest(policy),
    approvedBy,
    reason,
  };
}

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * هذا حرسٌ حدودي لا بديل مخطّط YAML: المصرف يقبل سياسة واحدة لا وثيقة الملفات
 * كلها، لذلك يثبت الشكل الأدنى الذي يحتاجه المحرك ويمنع JSON حرّاً ينهار عند
 * تحميله. ما بقي من تماسك الكتالوج والأدوار يتحقق منه `bundleWithOverrides`.
 * @param {unknown} document
 * @param {string} expectedId
 * @returns {PolicyRecord}
 */
function assertPolicyDocument(document, expectedId) {
  if (!isRecord(document)) {
    throw new PolicyGovernanceError(
      POLICY_GOVERNANCE_ERRORS.POLICY_INVALID,
      'وثيقة نسخة السياسة ليست كائناً.',
    );
  }
  const requiredText = ['id', 'name', 'owner', 'effect', 'reason'];
  for (const key of requiredText) {
    if (typeof document[key] !== 'string' || document[key].trim() === '') {
      throw new PolicyGovernanceError(
        POLICY_GOVERNANCE_ERRORS.POLICY_INVALID,
        `وثيقة السياسة ناقصة أو فارغة عند الحقل ${key}.`,
      );
    }
  }
  if (
    document['id'] !== expectedId ||
    (document['effect'] !== 'allow' && document['effect'] !== 'deny') ||
    typeof document['priority'] !== 'number' ||
    !Number.isInteger(document['priority']) ||
    !isRecord(document['actors']) ||
    !Array.isArray(document['actions']) ||
    !Array.isArray(document['resources'])
  ) {
    throw new PolicyGovernanceError(
      POLICY_GOVERNANCE_ERRORS.POLICY_INVALID,
      `وثيقة السياسة ${expectedId} لا تحقق الشكل الأدنى القابل للتقييم.`,
    );
  }
  return /** @type {PolicyRecord} */ (/** @type {unknown} */ (document));
}

/**
 * @param {unknown} value
 * @param {string} field
 * @returns {string}
 */
function requiredText(value, field) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new PolicyGovernanceError(
      POLICY_GOVERNANCE_ERRORS.POLICY_INVALID,
      `${field} يجب أن يكون نصاً غير فارغ.`,
    );
  }
  return value;
}

/**
 * @param {Record<string, unknown>} row
 * @returns {PolicyVersion}
 */
function versionFromRow(row) {
  const policyId = String(row['policy_id']);
  const policy = assertPolicyDocument(row['document'], policyId);
  return {
    policyId,
    version: Number(row['version']),
    policy,
    reason: String(row['change_reason']),
    proposedBy: String(row['proposed_by']),
    approvedBy: row['approved_by'] === null ? null : String(row['approved_by']),
    signature: row['approval_signature'] === null ? null : String(row['approval_signature']),
    active: Boolean(row['active']),
    createdAt: /** @type {Date} */ (row['created_at']),
  };
}

/**
 * ضع قفلاً استشارياً داخل المعاملة على معرّف سياسة واحد. قيد التفرّد يحرس النتيجة
 * النهائية، والقفل يمنع أن يحسب مقترحان متزامنان رقم النسخة التالي نفسه ثم يتحول
 * أحدهما إلى خطأ تكرار غير مقروء.
 * @param {import('pg').PoolClient} client
 * @param {string} policyId
 * @returns {Promise<void>}
 */
async function lockPolicy(client, policyId) {
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [policyId]);
}

/**
 * أنشئ مصرف إصدارات سياسة مرتبطاً بقاعدة وفاحص توقيع.
 * @param {{ pool: import('pg').Pool, signer: PolicySigner }} deps
 * @returns {{ propose: (input: { policy: PolicyRecord, reason: string, proposedBy: string }) => Promise<PolicyVersion>, approve: (input: { policyId: string, version: number, approvedBy: string, signature: string }) => Promise<PolicyVersion>, activate: (input: { policyId: string, version: number }) => Promise<never>, rollback: (input: { policyId: string, toVersion: number, approvedBy: string, signature: string, reason: string }) => Promise<PolicyVersion>, history: (policyId: string) => Promise<PolicyVersion[]>, bundleWithOverrides: (baseBundle: PolicyBundle) => Promise<PolicyBundle> }}
 */
export function createPolicyVersionStore({ pool, signer }) {
  if (!pool || !signer || typeof signer.verify !== 'function') {
    throw new Error('POLICY_VERSION_STORE_DEPENDENCY_MISSING');
  }

  return Object.freeze({
    /**
     * يخزن مسودةً غير نافذة. الرقم يخص المصرف لا الحقل الذي جاء به العميل، كي لا
     * يستطيع مقترحٌ إعادة استعمال نسخة تاريخية أو إعلان نسخة مختلفة في الوثيقة.
     * @param {{ policy: PolicyRecord, reason: string, proposedBy: string }} input
     * @returns {Promise<PolicyVersion>}
     */
    async propose({ policy, reason, proposedBy }) {
      const policyId = requiredText(policy.id, 'policy.id');
      const proposalReason = requiredText(reason, 'reason');
      const proposer = requiredText(proposedBy, 'proposedBy');
      assertPolicyDocument(policy, policyId);
      return withTransaction(pool, async (client) => {
        await lockPolicy(client, policyId);
        const numberResult = await client.query(
          'SELECT COALESCE(MAX(version), 0) + 1 AS next_version FROM state.policy_versions WHERE policy_id = $1',
          [policyId],
        );
        const numberRow = /** @type {Record<string, unknown> | undefined} */ (numberResult.rows[0]);
        if (numberRow === undefined) throw new Error('POLICY_VERSION_NUMBER_MISSING');
        const version = Number(numberRow['next_version']);
        const document = { ...policy, version, enabled: false };
        delete document.approvedBy;
        const result = await client.query(
          `INSERT INTO state.policy_versions
            (policy_id, version, document, change_reason, proposed_by)
           VALUES ($1, $2, $3::jsonb, $4, $5)
           RETURNING policy_id, version, document, change_reason, proposed_by,
                     approved_by, approval_signature, active, created_at`,
          [policyId, version, JSON.stringify(document), proposalReason, proposer],
        );
        const row = /** @type {Record<string, unknown> | undefined} */ (result.rows[0]);
        if (row === undefined) throw new Error('POLICY_VERSION_PROPOSAL_MISSING');
        return versionFromRow(row);
      });
    },

    /**
     * الاعتماد هو طريق التنشيط الوحيد. إبطال السابقة وتنشيط الجديدة داخل المعاملة
     * نفسها؛ فالقارئ خارجها يرى السابقة أو الجديدة، لا زمناً بلا سياسة نافذة.
     * @param {{ policyId: string, version: number, approvedBy: string, signature: string }} input
     * @returns {Promise<PolicyVersion>}
     */
    async approve({ policyId, version, approvedBy, signature }) {
      const id = requiredText(policyId, 'policyId');
      const approver = requiredText(approvedBy, 'approvedBy');
      if (!Number.isInteger(version) || version < 1) {
        throw new PolicyGovernanceError(
          POLICY_GOVERNANCE_ERRORS.VERSION_MISSING,
          'رقم النسخة غير صالح.',
        );
      }
      if (typeof signature !== 'string' || signature.trim() === '') {
        throw new PolicyGovernanceError(
          POLICY_GOVERNANCE_ERRORS.SIGNATURE_INVALID,
          'التنشيط بلا توقيع قابل للتحقق مرفوض.',
        );
      }
      return withTransaction(pool, async (client) => {
        await lockPolicy(client, id);
        const selected = await client.query(
          `SELECT policy_id, version, document, change_reason, proposed_by,
                  approved_by, approval_signature, active, created_at
             FROM state.policy_versions
            WHERE policy_id = $1 AND version = $2
            FOR UPDATE`,
          [id, version],
        );
        const selectedRow = /** @type {Record<string, unknown> | undefined} */ (selected.rows[0]);
        if (selectedRow === undefined) {
          throw new PolicyGovernanceError(
            POLICY_GOVERNANCE_ERRORS.VERSION_MISSING,
            `لا توجد النسخة ${version} من السياسة ${id}.`,
          );
        }
        const selectedVersion = versionFromRow(selectedRow);
        if (selectedVersion.active || selectedVersion.approvedBy !== null) {
          throw new PolicyGovernanceError(
            POLICY_GOVERNANCE_ERRORS.VERSION_NOT_PENDING,
            `النسخة ${version} ليست مسودة تنتظر اعتماداً.`,
          );
        }
        const payload = policyApprovalPayload({
          policyId: id,
          version,
          policy: selectedVersion.policy,
          approvedBy: approver,
        });
        if (!signer.verify(payload, signature)) {
          throw new PolicyGovernanceError(
            POLICY_GOVERNANCE_ERRORS.SIGNATURE_INVALID,
            'توقيع اعتماد تغيير السياسة لا يطابق النسخة المقترحة.',
          );
        }
        await client.query(
          'UPDATE state.policy_versions SET active = false WHERE policy_id = $1 AND active',
          [id],
        );
        const approved = await client.query(
          `UPDATE state.policy_versions
              SET active = true, approved_by = $3, approval_signature = $4
            WHERE policy_id = $1 AND version = $2
            RETURNING policy_id, version, document, change_reason, proposed_by,
                      approved_by, approval_signature, active, created_at`,
          [id, version, approver, signature],
        );
        const approvedRow = /** @type {Record<string, unknown> | undefined} */ (approved.rows[0]);
        if (approvedRow === undefined) throw new Error('POLICY_VERSION_APPROVAL_MISSING');
        return versionFromRow(approvedRow);
      });
    },

    /**
     * لا توجد بوابة تنشيط قصيرة تتجاوز الاعتماد. وجود هذه الدالة مقصود ليكون
     * الخطأ صريحاً لمن يحاول استعمال API متوقعاً بدل أن يكتشف غياباً غامضاً.
     * @param {{ policyId: string, version: number }} _input
     * @returns {Promise<never>}
     */
    async activate(_input) {
      throw new PolicyGovernanceError(
        POLICY_GOVERNANCE_ERRORS.CHANGE_UNAPPROVED,
        'POLICY_CHANGE_UNAPPROVED: لا تُنشَّط نسخة سياسة بلا اعتماد وتوقيع متحقق.',
      );
    },

    /**
     * ينشئ حدثاً جديداً يحمل مادة النسخة القديمة، ثم ينشّطه بمعاملة واحدة. لا يعيد
     * كتابة صف تاريخي؛ إعادة كتابة التاريخ تفقد سبب اقتراحه وتوقيعه الأصليين.
     * @param {{ policyId: string, toVersion: number, approvedBy: string, signature: string, reason: string }} input
     * @returns {Promise<PolicyVersion>}
     */
    async rollback({ policyId, toVersion, approvedBy, signature, reason }) {
      const id = requiredText(policyId, 'policyId');
      const approver = requiredText(approvedBy, 'approvedBy');
      const rollbackReason = requiredText(reason, 'reason');
      if (!Number.isInteger(toVersion) || toVersion < 1) {
        throw new PolicyGovernanceError(
          POLICY_GOVERNANCE_ERRORS.VERSION_MISSING,
          'رقم نسخة التراجع غير صالح.',
        );
      }
      if (typeof signature !== 'string' || signature.trim() === '') {
        throw new PolicyGovernanceError(
          POLICY_GOVERNANCE_ERRORS.SIGNATURE_INVALID,
          'التراجع بلا توقيع قابل للتحقق مرفوض.',
        );
      }
      return withTransaction(pool, async (client) => {
        await lockPolicy(client, id);
        const targetResult = await client.query(
          `SELECT policy_id, version, document, change_reason, proposed_by,
                  approved_by, approval_signature, active, created_at
             FROM state.policy_versions
            WHERE policy_id = $1 AND version = $2
            FOR UPDATE`,
          [id, toVersion],
        );
        const targetRow = /** @type {Record<string, unknown> | undefined} */ (targetResult.rows[0]);
        if (targetRow === undefined) {
          throw new PolicyGovernanceError(
            POLICY_GOVERNANCE_ERRORS.VERSION_MISSING,
            `لا توجد النسخة ${toVersion} المطلوب التراجع إليها من ${id}.`,
          );
        }
        const target = versionFromRow(targetRow);
        const payload = policyRollbackPayload({
          policyId: id,
          toVersion,
          policy: target.policy,
          approvedBy: approver,
          reason: rollbackReason,
        });
        if (!signer.verify(payload, signature)) {
          throw new PolicyGovernanceError(
            POLICY_GOVERNANCE_ERRORS.SIGNATURE_INVALID,
            'توقيع التراجع لا يطابق النسخة أو السبب المطلوبين.',
          );
        }
        const numberResult = await client.query(
          'SELECT COALESCE(MAX(version), 0) + 1 AS next_version FROM state.policy_versions WHERE policy_id = $1',
          [id],
        );
        const numberRow = /** @type {Record<string, unknown> | undefined} */ (numberResult.rows[0]);
        if (numberRow === undefined) throw new Error('POLICY_VERSION_NUMBER_MISSING');
        const nextVersion = Number(numberRow['next_version']);
        const document = {
          ...target.policy,
          version: nextVersion,
          enabled: false,
        };
        delete document.approvedBy;
        await client.query(
          'UPDATE state.policy_versions SET active = false WHERE policy_id = $1 AND active',
          [id],
        );
        const restored = await client.query(
          `INSERT INTO state.policy_versions
            (policy_id, version, document, change_reason, proposed_by, approved_by, approval_signature, active)
           VALUES ($1, $2, $3::jsonb, $4, $5, $5, $6, true)
           RETURNING policy_id, version, document, change_reason, proposed_by,
                     approved_by, approval_signature, active, created_at`,
          [id, nextVersion, JSON.stringify(document), rollbackReason, approver, signature],
        );
        const restoredRow = /** @type {Record<string, unknown> | undefined} */ (restored.rows[0]);
        if (restoredRow === undefined) throw new Error('POLICY_VERSION_ROLLBACK_MISSING');
        return versionFromRow(restoredRow);
      });
    },

    /**
     * يعيد التاريخ كاملاً، الأقدم أولاً، فلا تُقرأ «النسخة الحالية» حذفاً لمسار
     * الاعتماد والتراجع الذي أوصل إليها.
     * @param {string} policyId
     * @returns {Promise<PolicyVersion[]>}
     */
    async history(policyId) {
      const id = requiredText(policyId, 'policyId');
      const result = await pool.query(
        `SELECT policy_id, version, document, change_reason, proposed_by,
                approved_by, approval_signature, active, created_at
           FROM state.policy_versions
          WHERE policy_id = $1
          ORDER BY version ASC`,
        [id],
      );
      return result.rows.map((row) => versionFromRow(/** @type {Record<string, unknown>} */ (row)));
    },

    /**
     * يركّب مجموعة المحرّك من كتالوج الملفات الثابت ثم يستبدل كل سياسة لها نسخة
     * نافذة في المصرف. التحقق من وجود الأفعال والأدوار يرفض التعديل الفاسد قبل أن
     * يصل إلى المسار الساخن؛ قاعدة المصرف تحرس الاعتماد، وهذه الطبقة تحرس التماسك.
     * @param {PolicyBundle} baseBundle
     * @returns {Promise<PolicyBundle>}
     */
    async bundleWithOverrides(baseBundle) {
      const result = await pool.query(
        `SELECT policy_id, version, document, change_reason, proposed_by,
                approved_by, approval_signature, active, created_at
           FROM state.policy_versions
          WHERE active = true
          ORDER BY policy_id`,
      );
      /** @type {Map<string, PolicyRecord>} */
      const overrides = new Map();
      for (const raw of result.rows) {
        const row = versionFromRow(/** @type {Record<string, unknown>} */ (raw));
        /** @type {PolicyRecord} */
        const policy =
          row.approvedBy === null
            ? { ...row.policy, version: row.version, enabled: true }
            : {
                ...row.policy,
                version: row.version,
                enabled: true,
                approvedBy: row.approvedBy,
              };
        for (const action of policy.actions) {
          if (action !== '*' && !baseBundle.actions.has(action)) {
            throw new PolicyGovernanceError(
              POLICY_GOVERNANCE_ERRORS.POLICY_INVALID,
              `النسخة النافذة ${row.policyId} تشير إلى فعل غير معلن: ${action}.`,
            );
          }
        }
        for (const role of policy.actors.roles ?? []) {
          if (role !== '*' && !baseBundle.roles.has(role)) {
            throw new PolicyGovernanceError(
              POLICY_GOVERNANCE_ERRORS.POLICY_INVALID,
              `النسخة النافذة ${row.policyId} تشير إلى دور غير معلن: ${role}.`,
            );
          }
        }
        overrides.set(row.policyId, Object.freeze(policy));
      }
      const merged = baseBundle.policies.map((policy) => overrides.get(policy.id) ?? policy);
      for (const [policyId, policy] of overrides) {
        if (!baseBundle.policies.some((existing) => existing.id === policyId)) merged.push(policy);
      }
      return Object.freeze({
        ...baseBundle,
        policies: Object.freeze(merged),
      });
    },
  });
}
