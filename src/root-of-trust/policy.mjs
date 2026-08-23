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
    this.rules = new Map();
  }
  setRole(role, capabilities) {
    this.rules.set(role, new Set(capabilities));
  }
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
