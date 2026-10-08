import { RetentionCycle, RETENTION_CYCLE_ERRORS } from '/home/user/workspace/xuux-review-284f74d0/src/data/retention-cycle.mjs';

const mockLog = { append: () => {} };
const mockErasureLedger = { record: () => {} };
const mockRepositories = {};

try {
  const cycle = new RetentionCycle({
    log: mockLog,
    erasureLedger: mockErasureLedger,
    repositories: mockRepositories,
    authorizer: null,
  });

  await cycle.eraseDirected({
    actor: { id: 'nobody:unregistered', role: 'role:operator' },
    target: 'memories',
    targetId: 'mem-1',
  });
  console.log('FAILED: purge allowed without authorizer!');
  process.exit(3);
} catch (err) {
  console.log('Caught error:', err.code, err.message);
  if (err.code === RETENTION_CYCLE_ERRORS.AUTHORIZER_REQUIRED) {
    console.log('SUCCESS: Blocked with RETENTION_AUTHORIZER_REQUIRED');
    process.exit(0);
  }
  process.exit(1);
}
