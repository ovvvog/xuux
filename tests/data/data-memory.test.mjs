import test from 'node:test';
import assert from 'node:assert/strict';
import { EventLog } from '../../src/root-of-trust/index.mjs';
import { AgentMemoryStore, Classification, DataCatalog } from '../../src/data/index.mjs';
import { createMemoryRepository } from '../../src/persistence/repository-memory.mjs';

// الفهرس والذاكرة صارا على مستودعات (`M3.05`)؛ ومستودع الذاكرة هنا لسرعة
// الاختبار لا لإثبات الاستمرارية، وإثباتها في `tests/persistence/restart.test.mjs`.
function setup(limits = {}) {
  const log = new EventLog();
  const catalog = new DataCatalog({ log, repository: createMemoryRepository(DataCatalog.spec) });
  const memory = new AgentMemoryStore({
    catalog,
    log,
    repository: createMemoryRepository(AgentMemoryStore.spec),
    ...limits,
  });
  return { log, catalog, memory };
}

test('catalog registers lineage classification and quality', async () => {
  const { catalog } = setup();
  const d = await catalog.register({
    name: 'royal-record',
    owner: 'crown',
    classification: Classification.SOVEREIGN,
    source: 'crown',
    lineage: ['command'],
  });
  assert.equal(d.quality, 'unverified');
  await assert.rejects(() => catalog.canRead(d.id, 'agent', 'sensitive'), /DATA_ACCESS_DENIED/);
  await catalog.markQuality(d.id, 'verified');
  const after = await catalog.get(d.id);
  assert.ok(after, 'السجل يجب أن يبقى بعد تعليم الجودة');
  assert.equal(after.quality, 'verified');
  // النسخة أثرٌ للكتابة: تسجيلٌ ثم تعليم جودة يعنيان كتابتين.
  assert.equal(after.version, 2);
});

test('memory is isolated by agent identity', async () => {
  const { memory } = setup();
  const x = await memory.remember('agent:a', 'private note');
  assert.equal((await memory.recall('agent:a', x.id)).content, 'private note');
  await assert.rejects(() => memory.recall('agent:b', x.id), /MEMORY_NOT_FOUND/);
  await memory.forget('agent:a', x.id);
  await assert.rejects(() => memory.recall('agent:a', x.id), /MEMORY_NOT_FOUND/);
});

test('memory quota is enforced', async () => {
  const { memory } = setup({ maxEntries: 1 });
  await memory.remember('agent:a', 'one');
  await assert.rejects(() => memory.remember('agent:a', 'two'), /MEMORY_QUOTA_EXCEEDED/);
});

test('two memories for the same agent do not collide on dataset name', async () => {
  // عيبٌ لم يكن يظهر في `Map` بلا قيد فريد: اسم عقد البيانات كان
  // `memory:${agentId}` فيتعارض عند ثاني ذاكرة لنفس الوكيل. القيد الفريد في
  // القاعدة هو ما كشفه، والاسم صار يحمل معرّف الذاكرة.
  const { memory, catalog } = setup();
  const first = await memory.remember('agent:a', 'one');
  const second = await memory.remember('agent:a', 'two');
  assert.notEqual(first.datasetId, second.datasetId);
  assert.ok(await catalog.get(first.datasetId));
  assert.ok(await catalog.get(second.datasetId));
});
