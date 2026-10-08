import { PolicyDecisionPoint } from '/home/user/workspace/xuux-review-284f74d0/src/policy/engine.mjs';
import { loadPolicyBundle } from '/home/user/workspace/xuux-review-284f74d0/src/policy/loader.mjs';

const bundle = loadPolicyBundle();
const pdp = new PolicyDecisionPoint(bundle);

// 1. role:agent with capabilities: []
const resEmpty = pdp.evaluate({
  actor: { id: 'agent-1', role: 'role:agent', kind: 'agent', state: 'active', capabilities: [] },
  action: 'write-data',
  resource: { type: 'data', id: 'res-1' }
});

// 2. role:agent with capabilities: ['action:write-data']
const resWithCap = pdp.evaluate({
  actor: { id: 'agent-1', role: 'role:agent', kind: 'agent', state: 'active', capabilities: ['action:write-data'] },
  action: 'write-data',
  resource: { type: 'data', id: 'res-1' }
});

console.log('empty capabilities:', resEmpty.allowed, resEmpty.code);
console.log('with capability:', resWithCap.allowed, resWithCap.code);
