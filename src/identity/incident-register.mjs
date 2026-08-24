/**
 * سجل الحوادث — M6.03
 *
 * معيار قبول `M6.03` يقول: محاولة منح قدرة محرَّمة **تُرفض وتُسجَّل كحادثة**.
 * فالرفض وحده لا يكفي: من رُفض له طلبٌ محرَّم مرّةً واحدة قد يكون خطأً في
 * الإعداد، ومن كرّره ألفاً فهو سلوك يستحق تدخّلاً. ولا يُقاس التكرار بلا سجل.
 *
 * والحادثة **ليست** سطراً في سجل الأحداث فقط: سجل الأحداث يُلحق ولا يُستعلَم
 * بحالة، والحادثة لها حالة (مفتوحة/مغلقة) وتُقرأ لاحقاً في الحجْر التلقائي
 * (`M6.09`). فهذا السجل هو المفصل الذي يعلَّق عليه ذاك.
 *
 * **حدٌّ معلن:** المخزن في الذاكرة، فالحوادث تُمحى بإعادة التشغيل. إدامته
 * مؤجَّلة إلى خطوة `M6.09` حيث يُوصل بمستودع كسجل الوكلاء — وهذا مسجَّل في
 * `docs/AGENT_CONTAINMENT.md §6` ولا يُقرأ من هذا الملف أنه دائم.
 */

import { randomUUID } from 'node:crypto';

/**
 * @typedef {object} Incident
 * @property {string} id
 * @property {string} type - نوع الحادثة، مثل `forbidden-capability`
 * @property {string} subject - من وقعت عليه أو منه
 * @property {'open' | 'closed'} state
 * @property {IncidentSeverityValue} severity
 * @property {Record<string, unknown>} detail
 * @property {string} openedAt
 * @property {string | null} closedAt
 * @property {string | null} closedReason
 */

/** @typedef {'low' | 'medium' | 'high' | 'critical'} IncidentSeverityValue */

/** درجات الخطورة المعلنة؛ غيرها يُرفض فلا تنمو المفردات بلا قرار. */
export const IncidentSeverity = Object.freeze({
  LOW: /** @type {const} */ ('low'),
  MEDIUM: /** @type {const} */ ('medium'),
  HIGH: /** @type {const} */ ('high'),
  CRITICAL: /** @type {const} */ ('critical'),
});

/** القيم كمصفوفة نصوص للفحص في زمن التشغيل دون تضييق يمنع الفحص نفسه. */
const SEVERITIES = /** @type {readonly string[]} */ (Object.values(IncidentSeverity));

export class IncidentRegister {
  /**
   * @param {{ log?: { append: (type: string, actor: string, payload: object) => unknown } | null, now?: () => Date }} [deps]
   */
  constructor({ log = null, now } = {}) {
    this.log = log;
    this.now = now ?? (() => new Date());
    /** @type {Map<string, Incident>} */
    this.incidents = new Map();
  }

  /**
   * يفتح حادثة. الخطورة تُصرّح ولا تُستنتج: من فتح حادثة بلا خطورة معلنة تركَ
   * لمن يقرأها أن يقدّرها، والتقدير عند القراءة يُنتج فرزاً مختلفاً كل مرّة.
   * @param {{ type: string, subject: string, severity?: IncidentSeverityValue, detail?: Record<string, unknown> }} spec
   * @returns {Incident}
   */
  open({ type, subject, severity = IncidentSeverity.HIGH, detail = {} }) {
    if (typeof type !== 'string' || type.trim() === '') throw new Error('INCIDENT_TYPE_REQUIRED');
    if (typeof subject !== 'string' || subject.trim() === '') {
      throw new Error('INCIDENT_SUBJECT_REQUIRED');
    }
    if (!SEVERITIES.includes(severity)) {
      throw new Error('INCIDENT_SEVERITY_UNKNOWN');
    }
    /** @type {Incident} */
    const incident = Object.freeze({
      id: 'incident:' + randomUUID(),
      type,
      subject,
      state: /** @type {const} */ ('open'),
      severity,
      detail: Object.freeze({ ...detail }),
      openedAt: this.now().toISOString(),
      closedAt: null,
      closedReason: null,
    });
    this.incidents.set(incident.id, incident);
    if (this.log !== null) {
      this.log.append('incident.opened', subject, {
        id: incident.id,
        type,
        severity,
        ...detail,
      });
    }
    return incident;
  }

  /**
   * يغلق حادثة بسبب مسجَّل. الإغلاق بلا سبب ممنوع لنفس علّة المادة في سجل
   * الوكلاء: قرارٌ عقابي أو إنهاؤه بلا سبب لا يُراجع.
   * @param {string} id
   * @param {string} reason
   * @returns {Incident}
   */
  close(id, reason) {
    const current = this.incidents.get(id);
    if (current === undefined) throw new Error('INCIDENT_NOT_FOUND');
    if (typeof reason !== 'string' || reason.trim() === '') {
      throw new Error('INCIDENT_CLOSE_REASON_REQUIRED');
    }
    if (current.state === 'closed') return current;
    /** @type {Incident} */
    const closed = Object.freeze({
      ...current,
      state: /** @type {const} */ ('closed'),
      closedAt: this.now().toISOString(),
      closedReason: reason,
    });
    this.incidents.set(id, closed);
    if (this.log !== null) {
      this.log.append('incident.closed', current.subject, { id, reason });
    }
    return closed;
  }

  /**
   * @param {string} id
   * @returns {Incident | null}
   */
  get(id) {
    return this.incidents.get(id) ?? null;
  }

  /**
   * @param {{ state?: 'open' | 'closed', type?: string, subject?: string }} [filter]
   * @returns {Incident[]}
   */
  list(filter = {}) {
    return [...this.incidents.values()].filter(
      (incident) =>
        (filter.state === undefined || incident.state === filter.state) &&
        (filter.type === undefined || incident.type === filter.type) &&
        (filter.subject === undefined || incident.subject === filter.subject),
    );
  }
}

/**
 * @param {ConstructorParameters<typeof IncidentRegister>[0]} [deps]
 * @returns {IncidentRegister}
 */
export function createIncidentRegister(deps) {
  return new IncidentRegister(deps);
}
