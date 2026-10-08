import { purge, eraseById } from '/home/user/workspace/xuux-review-284f74d0/src/persistence/retention.mjs';

const mockPool = {
  query: async () => ({ rows: [{ eligible: 1 }], rowCount: 1 }),
  connect: async () => ({ query: async () => ({ rowCount: 1 }), release: () => {} })
};

try {
  await purge(mockPool, { now: new Date(), tables: ['memories'], dryRun: false });
  console.log('FAILED: purge allowed raw deletion!');
  process.exit(1);
} catch (err) {
  console.log('purge correctly rejected:', err.code, err.message);
}

try {
  await eraseById(mockPool, 'memories', 'mem-1');
  console.log('FAILED: eraseById allowed raw deletion!');
  process.exit(1);
} catch (err) {
  console.log('eraseById correctly rejected:', err.code, err.message);
}

console.log('All raw purge paths blocked successfully!');
process.exit(0);
