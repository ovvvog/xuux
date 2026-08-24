/**
 * بوابة الهوية — M6.01
 *
 * المسألة التي تحلّها: نقطة التفويض كانت تقرأ الفاعل **من الطلب**: `actor.role`
 * و`actor.state` و`actor.capabilities` نصوصٌ يكتبها المستدعي. فمن استدعى النقطة
 * بدورٍ ليس دوره حصل على قرار ذاك الدور، ووكيلٌ **مُبطَل** — شهادته مسحوبة أو
 * حالته ملغاة — كان يمرّ ما دام يُصرِّح بحالة `active` في الطلب. أي أن جذر الثقة
 * كان يصدر الشهادات ولا يُسأل عنها في نقطة القرار.
 *
 * فصارت الهوية تُحضَر من مصدرها في كل تفويض: السجل يُقرأ منه الوكيل، وسلطة
 * الشهادات يُتحقّق منها توقيعُ شهادته وعدم سحبها، ودفتر المنح تُضاف منه القدرات
 * المؤقّتة السارية. والمطالبة في الطلب **تُستبدل** لا تُصدَّق.
 *
 * فأثر الإبطال صار فورياً بحكم البناء لا بحكم التذكّر: `AgentRegistry.transition`
 * إلى `revoked` يسحب الشهادة في نفس العملية، وهذه البوابة تسأل السلطة في كل
 * طلب، فأول تفويض بعد الإبطال يُرفض — ولا يبقى مسارٌ يقبل هويةً مُبطَلة.
 */

import { IncidentSeverity } from './incident-register.mjs';

/** @typedef {import('./capability-catalog.mjs').CapabilityCatalog} CapabilityCatalog */
/** @typedef {import('./agent-registry.mjs').AgentRegistry} AgentRegistry */
/** @typedef {import('./capability-grants.mjs').CapabilityGrantLedger} CapabilityGrantLedger */

/** الحالة الوحيدة التي تُعمل بها هوية. غيرها يُرفض ولو كان مؤقتاً. */
const OPERATIONAL_STATE = 'active';

// أنواع الفاعل المعلنة في `src/policy/model.mts`. وفحصها هنا ليس إرضاءً للمدقّق:
// السجل دائمٌ وقد تُكتب فيه قيمة من نسخة أقدم أو من غير هذا الكود، ونوعٌ لا تعرفه
// السياسة يُقرأ في المحرّك فاعلاً مجهول الصفة — فالرفض أولى من التمرير.
const ACTOR_KINDS = new Set(['human', 'autonomous', 'service']);

/**
 * نتيجة التحقّق. `ok: false` يحمل رمزاً وسبباً — لأن «مرفوض» بلا رمز لا يوجّه
 * من قرأه إلى تصحيح.
 * @typedef {object} IdentityVerdict
 * @property {boolean} ok
 * @property {string} code
 * @property {string} reason
 * @property {{ id: string, role: string, state: string, kind: 'human' | 'autonomous' | 'service', capabilities: readonly string[] } | null} actor
 */

export class IdentityGate {
  /**
   * @param {{ registry?: AgentRegistry, ca?: { isValid: (cert: import('../root-of-trust/identity.mjs').Certificate) => boolean }, catalog?: CapabilityCatalog, grants?: CapabilityGrantLedger | null, incidents?: import('./incident-register.mjs').IncidentRegister | null, log?: { append: (type: string, actor: string, payload: object) => unknown } | null }} [deps]
   */
  constructor({ registry, ca, catalog, grants = null, incidents = null, log = null } = {}) {
    if (!registry || !ca || !catalog) throw new Error('IDENTITY_GATE_DEPENDENCY_MISSING');
    this.registry = registry;
    this.ca = ca;
    this.catalog = catalog;
    this.grants = grants;
    this.incidents = incidents;
    this.log = log;
  }

  /**
   * يتحقّق من هوية فاعل ويُخرج قدراته الفعّالة.
   *
   * الترتيب: الوجود، ثم الحالة، ثم مطابقة موضوع الشهادة للمعرّف، ثم صلاحية
   * الشهادة عند السلطة. ومطابقة الموضوع قبل التحقّق من التوقيع مقصودة: شهادةٌ
   * صحيحة التوقيع لموضوعٍ آخر تمرّ من فحص التوقيع وحده، وهي عين إعادة استخدام
   * شهادة الغير.
   * @param {string} actorId
   * @returns {Promise<IdentityVerdict>}
   */
  async verify(actorId) {
    if (typeof actorId !== 'string' || actorId.trim() === '') {
      return this.deny('IDENTITY_ID_MISSING', 'الطلب بلا معرّف فاعل، ولا تُفحص هويةٌ بلا معرّف.');
    }

    const agent = await this.registry.get(actorId);
    if (agent === null) {
      return this.deny(
        'IDENTITY_UNKNOWN',
        `لا وكيل بالمعرّف ${actorId} في سجل الدولة؛ الهوية تُقرأ من السجل لا من الطلب.`,
      );
    }

    if (agent.state !== OPERATIONAL_STATE) {
      return this.deny(
        'IDENTITY_NOT_ACTIVE',
        `حالة الوكيل ${actorId} هي ${agent.state}${agent.stateReason === null ? '' : ` (${agent.stateReason})`}؛ ولا يعمل إلا النشط.`,
      );
    }

    const certificate = agent.certificate;
    if (certificate.subject !== actorId) {
      return this.deny(
        'IDENTITY_SUBJECT_MISMATCH',
        `شهادة الوكيل ${actorId} صادرة للموضوع ${certificate.subject}؛ شهادة الغير لا تُقبل ولو صحّ توقيعها.`,
      );
    }

    if (!ACTOR_KINDS.has(agent.kind)) {
      return this.deny(
        'IDENTITY_KIND_UNKNOWN',
        `نوع الفاعل ${agent.kind} غير معلن في نموذج السياسة؛ وما لا تعرفه السياسة لا تحكمه.`,
      );
    }

    if (!this.ca.isValid(certificate)) {
      return this.deny(
        'IDENTITY_CERTIFICATE_INVALID',
        `شهادة الوكيل ${actorId} مسحوبة أو توقيعها لا يطابق ملك الإصدار.`,
      );
    }

    // دفاعٌ في العمق: قدرةٌ محرَّمة في شهادةٍ سارية تعني أن الكتالوج ضُيِّق **بعد**
    // إصدارها. فتُسقَط هنا ولا تصل إلى القرار، وتُفتح بها حادثة لأن شهادةً تحمل
    // محرَّماً واقعةٌ تستحق مراجعة إصدارها لا تصفيةً صامتة.
    /** @type {string[]} */
    const fromCertificate = [];
    /** @type {string[]} */
    const stripped = [];
    for (const capability of certificate.capabilities ?? []) {
      if (this.catalog.forbidden.has(capability)) stripped.push(capability);
      else fromCertificate.push(capability);
    }
    if (stripped.length > 0) {
      if (this.incidents !== null) {
        this.incidents.open({
          type: 'forbidden-capability',
          subject: actorId,
          severity: IncidentSeverity.CRITICAL,
          detail: { capabilities: stripped, certificateId: certificate.id, origin: 'certificate' },
        });
      }
      if (this.log !== null) {
        this.log.append('identity.capability.stripped', actorId, { capabilities: stripped });
      }
    }

    const granted = this.grants === null ? new Set() : this.grants.capabilitiesOf(actorId);
    // المنح تُصفّى بالكتالوج كذلك: منحةٌ قديمة لقدرةٍ صارت محرَّمة لا تسري.
    const capabilities = new Set(fromCertificate);
    for (const capability of granted) {
      if (!this.catalog.forbidden.has(capability)) capabilities.add(capability);
    }

    return Object.freeze({
      ok: true,
      code: 'IDENTITY_VERIFIED',
      reason: `هوية ${actorId} محقَّقة من السجل وسلطة الشهادات.`,
      actor: Object.freeze({
        id: agent.id,
        role: agent.role,
        state: agent.state,
        kind: /** @type {'human' | 'autonomous' | 'service'} */ (agent.kind),
        capabilities: Object.freeze([...capabilities].sort()),
      }),
    });
  }

  /**
   * @param {string} code
   * @param {string} reason
   * @returns {IdentityVerdict}
   */
  deny(code, reason) {
    return Object.freeze({ ok: false, code, reason, actor: null });
  }
}

/**
 * @param {ConstructorParameters<typeof IdentityGate>[0]} deps
 * @returns {IdentityGate}
 */
export function createIdentityGate(deps) {
  return new IdentityGate(deps);
}
