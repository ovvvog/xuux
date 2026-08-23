import { randomUUID } from 'node:crypto';
import { AGENT_SPEC } from '../persistence/entities.mjs';

/**
 * سجل الوكلاء — صار **دائماً** في الخطوة `M3.05`.
 *
 * كان هذا السجل `Map` في الذاكرة: كل وكيل وشهادته يُمحى بإعادة التشغيل، فتُقرأ
 * دولةٌ فيها مئة وكيل مُصرَّح كأنها دولة فارغة. صار المخزن **مستودعاً** يُمرَّر من
 * الخارج (`repository`)، وله تطبيقان بنفس العقد: `createPostgresRepository`
 * للتشغيل، و`createMemoryRepository` للاختبار السريع.
 *
 * **ثمنُ الاستمرارية معلن:** كل عملية صارت `async`، لأن الكتابة في قاعدة لا تكون
 * متزامنة. ومن استدعى `register` بلا `await` أخذ وعداً لا سجلاً — وهذا ما يمنعه
 * `typecheck` عند المستدعي.
 *
 * وحقول السجل لم تُبتَر لتناسب جدولاً: الجدول هو الذي وُسِّع في الهجرة `0002`
 * ليحمل الدور والمالك والشهادة، لأن المخطَّط الأول كُتب قبل أن يُوصَل بسجل.
 */

/**
 * حالة الوكيل، مشتقة من الكائن المُجمَّد فلا تنحرف عنه.
 * @typedef {(typeof AgentState)[keyof typeof AgentState]} AgentStateValue
 */

/**
 * نوع الوكيل: آدميٌّ أو خدمةٌ أو ذاتيُّ التشغيل. القيمة الافتراضية `autonomous`
 * لأن هذا ما تسجّله الدولة اليوم، والإعلان أوضح من افتراضٍ مستور في القاعدة.
 * @typedef {'human' | 'service' | 'autonomous'} AgentKindValue
 */

/**
 * سجل وكيل كما يعود من المستودع. `createdAt` و`stateChangedAt` كائنا `Date` من
 * القاعدة لا نصّان، و`version` هو نسخة القفل المتفائل يديرها المستودع.
 * @typedef {object} AgentRecord
 * @property {string} id
 * @property {string} name
 * @property {string} role
 * @property {string} owner - الجهة المسؤولة عن الوكيل
 * @property {AgentKindValue} kind
 * @property {string[]} capabilities
 * @property {import('../root-of-trust/identity.mjs').Certificate} certificate
 * @property {AgentStateValue} state
 * @property {number} version
 * @property {Date} createdAt
 * @property {Date} updatedAt
 * @property {string | null} stateReason - سبب آخر انتقال؛ إلزامي في الحالات العقابية
 * @property {Date | null} stateChangedAt
 */

/**
 * عقد المستودع الذي يحتاجه هذا السجل — التطبيقان يستوفيانه.
 * @typedef {object} AgentRepository
 * @property {(record: Record<string, unknown>) => Promise<Record<string, unknown>>} insert
 * @property {(id: string) => Promise<Record<string, unknown> | null>} findById
 * @property {(query?: { filter?: Record<string, unknown>, limit?: number }) => Promise<Array<Record<string, unknown>>>} list
 * @property {(filter?: Record<string, unknown>) => Promise<number>} count
 * @property {(id: string, expectedVersion: number, patch: Record<string, unknown>) => Promise<Record<string, unknown>>} update
 */

export const AgentState = Object.freeze({
  ACTIVE: 'active',
  SUSPENDED: 'suspended',
  REVOKED: 'revoked',
  RETIRED: 'retired',
});

/** الحالات العقابية التي لا تُعلن بلا سبب مسجَّل (نفس قيد القاعدة). */
const PUNITIVE = new Set([AgentState.SUSPENDED, 'quarantined', AgentState.REVOKED]);

const FORBIDDEN = new Set(['sovereign:root', 'key:export', 'policy:self-modify']);

/**
 * حوّل صفّ المستودع إلى سجل وكيل. الفحص هنا ليس تجميلاً: من قرأ صفّاً من قاعدة
 * قد كتب فيها غيرُ هذا الكود، فالتضييق يجعل الفساد خطأً مُسمّى لا انحرافاً صامتاً.
 * @param {Record<string, unknown>} row
 * @returns {AgentRecord}
 */
function toAgent(row) {
  const certificate = row['certificate'];
  if (typeof certificate !== 'object' || certificate === null) {
    throw new Error('AGENT_RECORD_CORRUPT_CERTIFICATE');
  }
  return /** @type {AgentRecord} */ (/** @type {unknown} */ (Object.freeze({ ...row })));
}

export class AgentRegistry {
  /**
   * الاعتماديات اختيارية في النوع لأن التوقيع يقبل الاستدعاء بلا وسائط ويردّ
   * بخطأ مُسمّى `AGENT_REGISTRY_DEPENDENCY_MISSING`؛ التحقّق بعده يضيّق النوع.
   * @param {{ ca?: import('../root-of-trust/identity.mjs').CertificateAuthority, log?: import('../root-of-trust/event-log.mjs').EventLog, repository?: AgentRepository, maxAgents?: number }} [deps]
   */
  constructor({ ca, log, repository, maxAgents = 100000 } = {}) {
    if (!ca || !log || !repository) throw new Error('AGENT_REGISTRY_DEPENDENCY_MISSING');
    this.ca = ca;
    this.log = log;
    /** @type {AgentRepository} */
    this.repository = repository;
    this.maxAgents = maxAgents;
  }

  /**
   * مواصفة السجل التي يُبنى عليها مستودعه — تُصدَّر كي لا يخترعها المستدعي.
   * @returns {import('../persistence/entities.mjs').EntitySpec}
   */
  static get spec() {
    return AGENT_SPEC;
  }

  /**
   * يسجّل وكيلاً ويُصدر له شهادة. القدرات المحرّمة تُرفض قبل الإصدار لا بعده،
   * فلا تُوجد شهادة لقدرة ممنوعة ولو للحظة. والحصّة تُقرأ من المستودع لا من عدّاد
   * في الذاكرة، فإعادة التشغيل لا تُصفّر الحدّ.
   * @param {{ name: string, role: string, capabilities?: string[], owner?: string, kind?: AgentKindValue }} spec
   * @returns {Promise<AgentRecord>}
   */
  async register({ name, role, capabilities = [], owner = 'crown', kind = 'autonomous' }) {
    if (!name || !role) throw new Error('AGENT_IDENTITY_REQUIRED');
    if ((await this.repository.count()) >= this.maxAgents) throw new Error('AGENT_QUOTA_EXCEEDED');
    if (capabilities.some((x) => FORBIDDEN.has(x))) throw new Error('FORBIDDEN_CAPABILITY');
    const id = 'agent:' + randomUUID();
    const certificate = this.ca.issue(id, role, capabilities);
    const row = await this.repository.insert({
      id,
      name,
      role,
      owner,
      kind,
      capabilities: [...capabilities],
      // الشهادة تُخزَّن كبياناتٍ لا كمرجع: `JSON.parse(JSON.stringify(...))` يقطع
      // أي مرجع للكائن الأصلي، فمن عدّل شهادته بعد التسجيل لم يعدّل المخزون.
      certificate: JSON.parse(JSON.stringify(certificate)),
      state: AgentState.ACTIVE,
    });
    this.log.append('agent.registered', owner, { id, role, capabilities });
    return toAgent(row);
  }

  /**
   * ينقل الوكيل إلى حالة أخرى. الملغى لا يُعاد تفعيله، وإلغاء الوكيل يُلغي
   * شهادته في نفس العملية فلا تبقى شهادة سارية لوكيل ملغى.
   *
   * والسبب صار **إلزامياً في الحالات العقابية** (تعليق أو حجْر أو إلغاء): قيد
   * القاعدة `agents_punitive_has_reason` يرفض غيره، وقرارٌ عقابي بلا سبب مسجَّل
   * لا يُراجع. وهذا **تضييقٌ في السلوك** كان السجل قبله يقبل التعليق بلا سبب.
   * @param {string} id
   * @param {AgentStateValue} state
   * @param {string} [reason]
   * @returns {Promise<AgentRecord>}
   */
  async transition(id, state, reason) {
    const row = await this.repository.findById(id);
    if (row === null) throw new Error('AGENT_NOT_FOUND');
    const current = toAgent(row);
    if (!Object.values(AgentState).includes(state)) throw new Error('INVALID_AGENT_STATE');
    if (current.state === AgentState.REVOKED && state !== AgentState.REVOKED)
      throw new Error('REVOKED_AGENT_IMMUTABLE');
    const punitive = PUNITIVE.has(state);
    const hasReason = typeof reason === 'string' && reason.trim() !== '';
    if (punitive && !hasReason) throw new Error('AGENT_PUNITIVE_REASON_REQUIRED');
    const updated = await this.repository.update(id, current.version, {
      state,
      stateReason: hasReason && punitive ? reason : null,
      stateChangedAt: new Date(),
    });
    if (state === AgentState.REVOKED) {
      this.ca.revoke(current.certificate.id, reason ?? 'agent revoked');
    }
    this.log.append(`agent.${state}`, 'crown', { id, reason });
    return toAgent(updated);
  }

  /**
   * @param {string} id
   * @returns {Promise<AgentRecord | null>}
   */
  async get(id) {
    const row = await this.repository.findById(id);
    return row === null ? null : toAgent(row);
  }

  /**
   * @param {AgentStateValue} [state] - إن غابت أُرجع كل الوكلاء
   * @returns {Promise<AgentRecord[]>}
   */
  async list(state) {
    const rows = await this.repository.list(state === undefined ? {} : { filter: { state } });
    return rows.map((row) => toAgent(row));
  }
}
