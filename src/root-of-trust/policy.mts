// جذر الثقة — محرّك السياسة الأدنى الذي تستند إليه بوابة التاج.
// نُقل إلى TypeScript في M2.01 بلا تغيير سلوك. المحرّك الكامل هو المسار M4.

/** تفويض صاحب الطلب كما يراه المحرّك: قد يكون ناقصاً أو غائباً كلياً. */
export type PolicyCertificate = { role?: string; capabilities?: string[] } | null | undefined;

const SENSITIVE: Set<string> = new Set([
  'create-agent',
  'change-policy',
  'external-egress',
  'allocate-budget',
  'deploy-model',
  'stop-state',
]);

export class PolicyEngine {
  rules: Map<string, Set<string>> = new Map();

  /**
   * يثبت مجموعة القدرات التي يحكم بها الدور بدل الاعتماد على المطالبات وحدها.
   * @param role - الدور التنظيمي
   * @param capabilities - القدرات المسموح بها للدور
   */
  setRole(role: string, capabilities: Iterable<string>): void {
    this.rules.set(role, new Set(capabilities));
  }

  /**
   * يمنع الأفعال الحساسة ما لم ترد قدرة صريحة أو تفويض سيادي.
   * @param certificate - تفويض صاحب الطلب إن وجد
   * @param action - الفعل المطلوب تفويضه
   * @returns يثبت اجتياز التفويض
   */
  authorize(certificate: PolicyCertificate, action: string): true {
    if (!certificate || !certificate.role) throw new Error('MISSING_CERTIFICATE');
    const allowed = this.rules.get(certificate.role) ?? new Set(certificate.capabilities ?? []);
    const capability = `action:${action}`;
    if (SENSITIVE.has(action) && !allowed.has(capability) && !allowed.has('sovereign:delegate'))
      throw new Error('POLICY_DENIED');
    if (!SENSITIVE.has(action) && allowed.size === 0) throw new Error('POLICY_DENIED');
    return true;
  }
}
