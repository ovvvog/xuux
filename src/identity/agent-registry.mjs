import { randomUUID } from 'node:crypto';

/**
 * حالة الوكيل، مشتقة من الكائن المُجمَّد فلا تنحرف عنه.
 * @typedef {(typeof AgentState)[keyof typeof AgentState]} AgentStateValue
 */

/**
 * سجل وكيل. حقول تغيير الحالة تُضاف عند أول انتقال فهي اختيارية.
 * @typedef {object} AgentRecord
 * @property {string} id
 * @property {string} name
 * @property {string} role
 * @property {string} owner - الجهة المسؤولة عن الوكيل
 * @property {string[]} capabilities
 * @property {import('../root-of-trust/identity.mjs').Certificate} certificate
 * @property {AgentStateValue} state
 * @property {string} createdAt
 * @property {string | undefined} [stateReason] - سبب آخر انتقال؛ يُكتب كما ورد
 *   حتى لو غاب، فمحو الحقل عند غياب السبب كان سيخفي أن انتقالاً بلا سبب قد حدث
 * @property {string} [stateChangedAt]
 */

export const AgentState = Object.freeze({
  ACTIVE: 'active',
  SUSPENDED: 'suspended',
  REVOKED: 'revoked',
  RETIRED: 'retired',
});
const FORBIDDEN = new Set(['sovereign:root', 'key:export', 'policy:self-modify']);

export class AgentRegistry {
  /**
   * الاعتماديات اختيارية في النوع لأن التوقيع يقبل الاستدعاء بلا وسائط ويردّ
   * بخطأ مُسمّى `AGENT_REGISTRY_DEPENDENCY_MISSING`؛ التحقّق بعده يضيّق النوع.
   * @param {{ ca?: import('../root-of-trust/identity.mjs').CertificateAuthority, log?: import('../root-of-trust/event-log.mjs').EventLog, maxAgents?: number }} [deps]
   */
  constructor({ ca, log, maxAgents = 100000 } = {}) {
    if (!ca || !log) throw new Error('AGENT_REGISTRY_DEPENDENCY_MISSING');
    this.ca = ca;
    this.log = log;
    this.maxAgents = maxAgents;
    /** @type {Map<string, AgentRecord>} */
    this.agents = new Map();
  }
  /**
   * يسجّل وكيلاً ويُصدر له شهادة. القدرات المحرّمة تُرفض قبل الإصدار لا بعده،
   * فلا تُوجد شهادة لقدرة ممنوعة ولو للحظة.
   * @param {{ name: string, role: string, capabilities?: string[], owner?: string }} spec
   * @returns {Readonly<AgentRecord>}
   */
  register({ name, role, capabilities = [], owner = 'crown' }) {
    if (!name || !role) throw new Error('AGENT_IDENTITY_REQUIRED');
    if (this.agents.size >= this.maxAgents) throw new Error('AGENT_QUOTA_EXCEEDED');
    if (capabilities.some((x) => FORBIDDEN.has(x))) throw new Error('FORBIDDEN_CAPABILITY');
    const id = 'agent:' + randomUUID();
    const certificate = this.ca.issue(id, role, capabilities);
    /** @type {AgentRecord} */
    const record = {
      id,
      name,
      role,
      owner,
      capabilities: [...capabilities],
      certificate,
      state: AgentState.ACTIVE,
      createdAt: new Date().toISOString(),
    };
    this.agents.set(id, record);
    this.log.append('agent.registered', owner, { id, role, capabilities });
    return Object.freeze({ ...record });
  }
  /**
   * ينقل الوكيل إلى حالة أخرى. الملغى لا يُعاد تفعيله، وإلغاء الوكيل يُلغي
   * شهادته في نفس العملية فلا تبقى شهادة سارية لوكيل ملغى.
   * @param {string} id
   * @param {AgentStateValue} state
   * @param {string} [reason]
   * @returns {Readonly<AgentRecord>}
   */
  transition(id, state, reason) {
    const a = this.agents.get(id);
    if (!a) throw new Error('AGENT_NOT_FOUND');
    if (!Object.values(AgentState).includes(state)) throw new Error('INVALID_AGENT_STATE');
    if (a.state === AgentState.REVOKED && state !== AgentState.REVOKED)
      throw new Error('REVOKED_AGENT_IMMUTABLE');
    a.state = state;
    a.stateReason = reason;
    a.stateChangedAt = new Date().toISOString();
    if (state === AgentState.REVOKED) this.ca.revoke(a.certificate.id, reason || 'agent revoked');
    this.log.append(`agent.${state}`, 'crown', { id, reason });
    return Object.freeze({ ...a });
  }
  /**
   * @param {string} id
   * @returns {Readonly<AgentRecord> | null}
   */
  get(id) {
    const a = this.agents.get(id);
    return a ? Object.freeze({ ...a }) : null;
  }
  /**
   * @param {AgentStateValue} [state] - إن غابت أُرجع كل الوكلاء
   * @returns {Array<Readonly<AgentRecord>>}
   */
  list(state) {
    return [...this.agents.values()]
      .filter((x) => !state || x.state === state)
      .map((x) => Object.freeze({ ...x }));
  }
}
