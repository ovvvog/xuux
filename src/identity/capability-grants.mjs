/**
 * دفتر منح القدرات — M6.02
 *
 * المسألة التي يحلّها: قدرات الوكيل كانت مصفوفةً تُكتب مرّةً عند التسجيل وتبقى
 * ما بقي الوكيل. فمن احتاج قدرةً لساعة أخذها للأبد، ولا أحد يعرف **من** منحها
 * ولا **لماذا** ولا **حتى متى** — والتوسّع في الصلاحية بلا انتهاء هو أكثر ما
 * يحوّل وكيلاً مفيداً إلى خطر بمرور الوقت.
 *
 * فصار المنح **عقداً بأربعة حقول إلزامية**: القدرة، والسبب، والمانح، والمدة.
 * وانتهاء المدة **يُسقط القدرة بلا تدخّل**: لا حاصد مجدول ولا مهمة تنظيف —
 * القراءة نفسها تُقاس بالساعة المُمرَّرة، فمنحٌ انتهى لا يظهر في القدرات
 * الفعّالة ولو لم يُحذف من المخزن بعد. وذلك مقصود: تنظيفٌ لم يعمل لا يجوز أن
 * يترك قدرةً سارية.
 *
 * ثلاث قواعد يُرفض ما خالفها بخطأ مُسمّى:
 *   1. **المحرَّم لا يُمنح** (`M6.03`): يُرفض ويُفتح به حادثة، لا يُرفض بصمت.
 *   2. **المدة لها سقف من البيانات**: `maxDurationSeconds` في الكتالوج، فمن طلب
 *      أطول رُفض — والسقف يُقرأ من الملف لا من الكود.
 *   3. **المانح غير المستفيد**: من منح نفسه قدرةً صار سقفه سقف رغبته.
 *
 * **حدٌّ معلن:** الدفتر في الذاكرة، فالمنح يُمحى بإعادة التشغيل — وهذا **أقل
 * القيود ضرراً** لأن سقوط منحٍ بإعادة التشغيل يضيّق الصلاحية ولا يوسّعها.
 * إدامته مؤجَّلة إلى `M7`، ومسجَّلة في `docs/AGENT_CONTAINMENT.md §6`.
 */

import { randomUUID } from 'node:crypto';
import { IncidentSeverity } from './incident-register.mjs';

/** @typedef {import('./capability-catalog.mjs').CapabilityCatalog} CapabilityCatalog */

/**
 * منحة واحدة كما تُقرأ.
 * @typedef {object} CapabilityGrant
 * @property {string} id
 * @property {string} agentId
 * @property {string} capability
 * @property {string} reason
 * @property {string} grantedBy
 * @property {string} grantorRole
 * @property {string} grantedAt
 * @property {string} expiresAt
 * @property {string | null} revokedAt
 * @property {string | null} revokedReason
 */

export class CapabilityGrantLedger {
  /**
   * @param {{ catalog?: CapabilityCatalog, log?: { append: (type: string, actor: string, payload: object) => unknown }, incidents?: import('./incident-register.mjs').IncidentRegister | null, now?: () => Date }} [deps]
   */
  constructor({ catalog, log, incidents = null, now } = {}) {
    if (!catalog || !log) throw new Error('CAPABILITY_LEDGER_DEPENDENCY_MISSING');
    this.catalog = catalog;
    this.log = log;
    this.incidents = incidents;
    this.now = now ?? (() => new Date());
    /** @type {Map<string, CapabilityGrant>} */
    this.grants = new Map();
  }

  /**
   * يمنح قدرةً مؤقّتة. الترتيب مقصود: **المحرَّم يُفحص أولاً** فلا يُقيَّم مانحٌ
   * ولا مدة لطلبٍ لا يجوز أصلاً، ولا تُفتح حادثةٌ مرتين على نفس الطلب.
   * @param {{ agentId: string, capability: string, reason: string, grantedBy: string, grantorRole: string, ttlSeconds: number }} spec
   * @returns {CapabilityGrant}
   */
  grant({ agentId, capability, reason, grantedBy, grantorRole, ttlSeconds }) {
    for (const [field, value] of Object.entries({
      agentId,
      capability,
      reason,
      grantedBy,
      grantorRole,
    })) {
      if (typeof value !== 'string' || value.trim() === '') {
        throw new Error(`CAPABILITY_GRANT_FIELD_MISSING: ${field}`);
      }
    }

    if (this.catalog.forbidden.has(capability)) {
      const entry = this.catalog.forbidden.get(capability);
      if (this.incidents !== null) {
        this.incidents.open({
          type: 'forbidden-capability',
          subject: grantedBy,
          severity: IncidentSeverity.CRITICAL,
          detail: {
            capability,
            beneficiary: agentId,
            grantorRole,
            lawRef: entry?.lawRef ?? null,
            attemptedReason: reason,
          },
        });
      }
      this.log.append('capability.grant.forbidden', grantedBy, {
        capability,
        beneficiary: agentId,
        reason: entry?.reason ?? 'قدرة محرَّمة',
      });
      throw new Error('FORBIDDEN_CAPABILITY');
    }

    const definition = this.catalog.grantable.get(capability);
    if (definition === undefined) throw new Error('CAPABILITY_NOT_GRANTABLE');

    if (grantedBy === agentId) throw new Error('CAPABILITY_SELF_GRANT_FORBIDDEN');
    if (!definition.grantorRoles.has(grantorRole)) {
      throw new Error('CAPABILITY_GRANTOR_NOT_AUTHORIZED');
    }
    if (!Number.isInteger(ttlSeconds) || ttlSeconds <= 0) {
      throw new Error('CAPABILITY_GRANT_TTL_INVALID');
    }
    if (ttlSeconds > definition.maxDurationSeconds) {
      throw new Error('CAPABILITY_GRANT_TTL_ABOVE_MAX');
    }

    const grantedAt = this.now();
    /** @type {CapabilityGrant} */
    const record = Object.freeze({
      id: 'grant:' + randomUUID(),
      agentId,
      capability,
      reason,
      grantedBy,
      grantorRole,
      grantedAt: grantedAt.toISOString(),
      expiresAt: new Date(grantedAt.getTime() + ttlSeconds * 1000).toISOString(),
      revokedAt: null,
      revokedReason: null,
    });
    this.grants.set(record.id, record);
    this.log.append('capability.granted', grantedBy, {
      id: record.id,
      agentId,
      capability,
      ttlSeconds,
      expiresAt: record.expiresAt,
      reason,
    });
    return record;
  }

  /**
   * هل المنحة سارية في هذه اللحظة؟ الانتهاء يُحسب بالمقارنة لا بالحذف.
   * @param {CapabilityGrant} grant
   * @param {number} atMs
   * @returns {boolean}
   */
  static isActive(grant, atMs) {
    if (grant.revokedAt !== null) return false;
    return Date.parse(grant.expiresAt) > atMs;
  }

  /**
   * المنح السارية لوكيل.
   * @param {string} agentId
   * @returns {CapabilityGrant[]}
   */
  activeGrants(agentId) {
    const atMs = this.now().getTime();
    return [...this.grants.values()].filter(
      (grant) => grant.agentId === agentId && CapabilityGrantLedger.isActive(grant, atMs),
    );
  }

  /**
   * القدرات الممنوحة السارية لوكيل — وهي التي تُضاف إلى قدرات دوره.
   * @param {string} agentId
   * @returns {Set<string>}
   */
  capabilitiesOf(agentId) {
    return new Set(this.activeGrants(agentId).map((grant) => grant.capability));
  }

  /**
   * يسحب منحةً قبل انتهاء مدتها. السبب إلزامي.
   * @param {string} id
   * @param {string} reason
   * @returns {CapabilityGrant}
   */
  revoke(id, reason) {
    const current = this.grants.get(id);
    if (current === undefined) throw new Error('CAPABILITY_GRANT_NOT_FOUND');
    if (typeof reason !== 'string' || reason.trim() === '') {
      throw new Error('CAPABILITY_REVOKE_REASON_REQUIRED');
    }
    if (current.revokedAt !== null) return current;
    /** @type {CapabilityGrant} */
    const revoked = Object.freeze({
      ...current,
      revokedAt: this.now().toISOString(),
      revokedReason: reason,
    });
    this.grants.set(id, revoked);
    this.log.append('capability.revoked', current.grantedBy, {
      id,
      agentId: current.agentId,
      capability: current.capability,
      reason,
    });
    return revoked;
  }

  /**
   * يسحب كل منح وكيل في عملية واحدة — يستدعيه إلغاء الوكيل وحجْره، فلا تبقى
   * قدرةٌ ممنوحة لهويةٍ أُبطلت.
   * @param {string} agentId
   * @param {string} reason
   * @returns {number} عدد المنح المسحوبة
   */
  revokeAllFor(agentId, reason) {
    let count = 0;
    for (const grant of this.activeGrants(agentId)) {
      this.revoke(grant.id, reason);
      count += 1;
    }
    return count;
  }

  /**
   * يحذف المنح المنتهية من المخزن. **لا يغيّر القدرات الفعّالة**: هو تفريغ ذاكرة
   * لا إنفاذ سياسة، وذلك عين المقصود — إنفاذُ الانتهاء واقعٌ قبل هذا النداء.
   * @returns {number} عدد ما حُذف
   */
  prune() {
    const atMs = this.now().getTime();
    let count = 0;
    for (const [id, grant] of this.grants) {
      if (grant.revokedAt === null && Date.parse(grant.expiresAt) > atMs) continue;
      this.grants.delete(id);
      count += 1;
    }
    if (count > 0) this.log.append('capability.grants.pruned', 'crown', { count });
    return count;
  }
}

/**
 * @param {ConstructorParameters<typeof CapabilityGrantLedger>[0]} deps
 * @returns {CapabilityGrantLedger}
 */
export function createCapabilityGrantLedger(deps) {
  return new CapabilityGrantLedger(deps);
}
