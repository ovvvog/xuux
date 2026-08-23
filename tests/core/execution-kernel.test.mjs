import test from 'node:test';
import assert from 'node:assert/strict';
import {
  KingIdentity,
  CertificateAuthority,
  EventLog,
  CrownGateway,
  createRoyalCommand,
} from '../../src/root-of-trust/index.mjs';
import { ExecutionKernel, TaskState } from '../../src/core/index.mjs';
function setup() {
  const king = new KingIdentity(),
    log = new EventLog(),
    crown = new CrownGateway(king, new CertificateAuthority(king), log);
  return { king, log, crown };
}
test('kernel executes only through crown and records lifecycle', () => {
  const { king, log, crown } = setup();
  const k = new ExecutionKernel({ crown, log });
  const c = createRoyalCommand('inspect', 'agent:one');
  const result = k.submit(c, king.sign(c), () => ({ ok: true }));
  assert.equal(result.state, TaskState.SUCCEEDED);
  assert.equal(k.getTask(result.id).result.ok, true);
  assert.equal(log.events.filter((x) => x.type.startsWith('kernel.task')).length, 3);
});
test('kernel records failures and propagates them', () => {
  const { king, log, crown } = setup();
  const k = new ExecutionKernel({ crown, log });
  const c = createRoyalCommand('inspect', 'agent:one');
  assert.throws(
    () =>
      k.submit(c, king.sign(c), () => {
        throw new Error('controlled failure');
      }),
    /controlled failure/,
  );
  assert.equal([...k.tasks.values()][0].state, TaskState.FAILED);
});
test('safe mode blocks new tasks until resumed', () => {
  const { king, log, crown } = setup();
  const k = new ExecutionKernel({ crown, log });
  k.stop('maintenance');
  const c = createRoyalCommand('inspect', 'agent:one');
  assert.throws(() => k.submit(c, king.sign(c), () => true), /SAFE_MODE/);
  k.resume();
  assert.equal(k.submit(c, king.sign(c), () => true).state, TaskState.SUCCEEDED);
});
