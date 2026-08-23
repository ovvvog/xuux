import test from 'node:test';
import assert from 'node:assert/strict';
import { EventLog } from '../../src/root-of-trust/index.mjs';
import { ModelRegistry, ModelState, ModelSandbox } from '../../src/models/index.mjs';
function setup() {
  return { log: new EventLog() };
}
test('registers model with immutable weight digest', () => {
  const { log } = setup(),
    r = new ModelRegistry({ log }),
    m = r.register({
      name: 'reasoner',
      version: '1.0.0',
      purpose: 'planning',
      source: 'internal',
      weights: 'weights',
      capabilities: ['read:data'],
    });
  assert.equal(m.state, ModelState.REGISTERED);
  assert.equal(r.verifyWeights(m.id, 'weights'), true);
  assert.equal(r.verifyWeights(m.id, 'changed'), false);
});
test('rejects unsafe model capabilities and missing manifest', () => {
  const r = new ModelRegistry({ log: new EventLog() });
  assert.throws(
    () =>
      r.register({
        name: 'x',
        version: '1',
        purpose: 'x',
        source: 'x',
        weights: 'x',
        capabilities: ['bypass-crown'],
      }),
    /FORBIDDEN_MODEL_CAPABILITY/,
  );
  assert.throws(() => r.register({ name: 'x' }), /MODEL_MANIFEST_REQUIRED/);
});
test('requires approval before activation and supports sandbox', () => {
  const r = new ModelRegistry({ log: new EventLog() }),
    m = r.register({
      name: 'safe',
      version: '1',
      purpose: 'inspect',
      source: 'test',
      weights: 'x',
    });
  assert.throws(() => r.activate(m.id), /MODEL_NOT_APPROVED/);
  r.transition(m.id, ModelState.SANDBOXED, 'evaluation');
  const s = new ModelSandbox();
  assert.equal(s.run(r.getActive('inspect') ?? r.models.get(m.id), { x: 1 }).network, 'disabled');
  r.transition(m.id, ModelState.APPROVED, 'passed');
  assert.equal(r.activate(m.id).id, m.id);
});
test('rolled back model cannot return to service', () => {
  const r = new ModelRegistry({ log: new EventLog() }),
    m = r.register({ name: 'bad', version: '1', purpose: 'x', source: 'test', weights: 'x' });
  r.transition(m.id, ModelState.ROLLED_BACK, 'failed eval');
  assert.throws(
    () => r.transition(m.id, ModelState.APPROVED, 'retry'),
    /ROLLED_BACK_MODEL_IMMUTABLE/,
  );
});
