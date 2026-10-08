import { PolicyDecisionPoint } from '/home/user/workspace/xuux-review-284f74d0/src/policy/engine.mjs';
import { loadPolicyBundle } from '/home/user/workspace/xuux-review-284f74d0/src/policy/loader.mjs';

const bundle = loadPolicyBundle();
const pdp = new PolicyDecisionPoint(bundle);

// Case 1: role:agent with capabilities: [] for write-data
const res1 = pdp.evaluate({
  actor: { id: 'agent-1', role: 'role:agent', kind: 'agent', state: 'active', capabilities: [] },
  action: 'write-data',
  resource: { type: 'data', id: 'res-1' }
});

// Case 2: role:agent with granted capability action:create-agent
const res2 = pdp.evaluate({
  actor: { id: 'agent-1', role: 'role:agent', kind: 'agent', state: 'active', capabilities: ['action:create-agent'] },
  action: 'create-agent',
  resource: { type: 'agent', id: 'agent-new' }
});

console.log('res1 (write-data with []):', res1.allowed, res1.code);
console.log('res2 (create-agent with capability):', res2.allowed, res2.code);

if (res1.allowed && !res2.allowed && res2.code === 'POLICY_NO_MATCH') {
  console.log('REPRODUCED: Role alone decides, capabilities in actor are ignored by engine!');
  process.exit(0);
} else {
  console.log('NOT REPRODUCED');
  process.exit(1);
}
