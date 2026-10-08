import { RetentionCycle, RETENTION_CYCLE_ERRORS } from '/home/user/workspace/xuux-review-284f74d0/src/data/retention-cycle.mjs';

const mockLog = { append: () => {} };
const mockErasureLedger = { record: () => {} };
const mockRepositories = {};

// Test with authorizer without identityGate
try {
  const cycle = new RetentionCycle({
    log: mockLog,
    erasureLedger: mockErasureLedger,
    repositories: mockRepositories,
    authorizer: {
      authorize: async () => ({ decision: { allowed: true }, token: {} }),
      identityGate: null,
    },
  });

  await cycle.eraseDirected({
    actor: { id: 'nobody:unregistered', role: 'role:operator' },
    target: 'memories',
    targetId: 'mem-1',
  });
  console.log('FAILED: purge allowed without identityGate!');
  process.exit(3);
} catch (err) {
  console.log('Caught error (no identityGate):', err.code);
  if (err.code !== RETENTION_CYCLE_ERRORS.AUTHORIZER_REQUIRED) {
    process.exit(1);
  }
}

// Test with authorizer that enforces policy (e.g. rejection)
try {
  const cycle = new RetentionCycle({
    log: mockLog,
    erasureLedger: mockErasureLedger,
    repositories: mockRepositories,
    authorizer: {
      authorize: async () => ({
        decision: { allowed: false, code: 'POLICY_SOVEREIGN_COMMAND_REQUIRED', reason: 'royal command required' },
        token: {},
      }),
      identityGate: { verify: () => ({ valid: true }) },
    },
  });

  await cycle.eraseDirected({
    actor: { id: 'nobody:unregistered', role: 'role:operator' },
    target: 'memories',
    targetId: 'mem-1',
  });
  console.log('FAILED: purge allowed when authorizer rejects!');
  process.exit(3);
} catch (err) {
  console.log('Caught error (authorizer rejected):', err.code, err.message);
  if (err.code !== RETENTION_CYCLE_ERRORS.NOT_AUTHORIZED) {
    process.exit(1);
  }
}

console.log('All tests passed for R6-A-01 closure!');
process.exit(0);
