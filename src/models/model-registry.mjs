import { createHash, randomUUID } from 'node:crypto';
export const ModelState = Object.freeze({
  REGISTERED: 'registered',
  SANDBOXED: 'sandboxed',
  APPROVED: 'approved',
  SUSPENDED: 'suspended',
  ROLLED_BACK: 'rolled-back',
});
const FORBIDDEN_CAPABILITIES = new Set([
  'self-modify',
  'spawn-unbounded',
  'external-write',
  'bypass-crown',
]);
export class ModelRegistry {
  constructor({ log, maxModels = 10000 } = {}) {
    if (!log) throw new Error('MODEL_REGISTRY_DEPENDENCY_MISSING');
    this.log = log;
    this.maxModels = maxModels;
    this.models = new Map();
    this.activeByPurpose = new Map();
  }
  register({ name, version, purpose, source, weights, capabilities = [] }) {
    if (!name || !version || !purpose || !source || !weights)
      throw new Error('MODEL_MANIFEST_REQUIRED');
    if (this.models.size >= this.maxModels) throw new Error('MODEL_QUOTA_EXCEEDED');
    if (capabilities.some((x) => FORBIDDEN_CAPABILITIES.has(x)))
      throw new Error('FORBIDDEN_MODEL_CAPABILITY');
    const digest = createHash('sha256').update(weights).digest('hex');
    const id = 'model:' + randomUUID();
    const record = {
      id,
      name,
      version,
      purpose,
      source,
      digest,
      capabilities: [...capabilities],
      state: ModelState.REGISTERED,
      createdAt: new Date().toISOString(),
    };
    this.models.set(id, record);
    this.log.append('model.registered', 'crown', { id, name, version, digest });
    return Object.freeze({ ...record });
  }
  transition(id, state, reason) {
    const m = this.models.get(id);
    if (!m) throw new Error('MODEL_NOT_FOUND');
    if (!Object.values(ModelState).includes(state)) throw new Error('INVALID_MODEL_STATE');
    if (m.state === ModelState.ROLLED_BACK && state !== ModelState.ROLLED_BACK)
      throw new Error('ROLLED_BACK_MODEL_IMMUTABLE');
    m.state = state;
    m.reason = reason;
    m.changedAt = new Date().toISOString();
    this.log.append(`model.${state}`, 'crown', { id, reason });
    return Object.freeze({ ...m });
  }
  activate(id) {
    const m = this.models.get(id);
    if (!m || m.state !== ModelState.APPROVED) throw new Error('MODEL_NOT_APPROVED');
    const previous = this.activeByPurpose.get(m.purpose);
    this.activeByPurpose.set(m.purpose, id);
    this.log.append('model.activated', 'crown', { id, purpose: m.purpose, previous });
    return Object.freeze({ ...m });
  }
  getActive(purpose) {
    const id = this.activeByPurpose.get(purpose);
    return id ? this.models.get(id) : null;
  }
  verifyWeights(id, weights) {
    const m = this.models.get(id);
    if (!m) throw new Error('MODEL_NOT_FOUND');
    return createHash('sha256').update(weights).digest('hex') === m.digest;
  }
}
export class ModelSandbox {
  run(model, input, { timeoutMs = 1000 } = {}) {
    if (model.state !== ModelState.SANDBOXED && model.state !== ModelState.APPROVED)
      throw new Error('MODEL_NOT_SANDBOXED');
    return {
      modelId: model.id,
      inputHash: createHash('sha256').update(JSON.stringify(input)).digest('hex'),
      timeoutMs,
      network: 'disabled',
      writes: 'disabled',
      output: 'sandbox-result',
    };
  }
}
