/** @typedef {{role?: string, capabilities?: string[]} | null | undefined} PolicyCertificate */

/** @type {Set<string>} */
const SENSITIVE = new Set([
  'create-agent',
  'change-policy',
  'external-egress',
  'allocate-budget',
  'deploy-model',
  'stop-state',
]);
export class PolicyEngine {
  constructor() {
    /** @type {Map<string, Set<string>>} */
    this.rules = new Map();
  }
  /**
   * يثبت مجموعة القدرات التي يحكم بها الدور بدل الاعتماد على المطالبات وحدها.
   * @param {string} role - الدور التنظيمي
   * @param {Iterable<string>} capabilities - القدرات المسموح بها للدور
   */
  setRole(role, capabilities) {
    this.rules.set(role, new Set(capabilities));
  }
  /**
   * يمنع الأفعال الحساسة ما لم ترد قدرة صريحة أو تفويض سيادي.
   * @param {PolicyCertificate} certificate - تفويض صاحب الطلب إن وجد
   * @param {string} action - الفعل المطلوب تفويضه
   * @returns {true} يثبت اجتياز التفويض
   */
  authorize(certificate, action) {
    if (!certificate || !certificate.role) throw new Error('MISSING_CERTIFICATE');
    const allowed = this.rules.get(certificate.role) ?? new Set(certificate.capabilities ?? []);
    const capability = `action:${action}`;
    if (SENSITIVE.has(action) && !allowed.has(capability) && !allowed.has('sovereign:delegate'))
      throw new Error('POLICY_DENIED');
    if (!SENSITIVE.has(action) && allowed.size === 0) throw new Error('POLICY_DENIED');
    return true;
  }
}
