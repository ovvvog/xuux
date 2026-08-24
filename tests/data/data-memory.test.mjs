import test from 'node:test';
import assert from 'node:assert/strict';
import { EventLog } from '../../src/root-of-trust/index.mjs';
import {
  AgentMemoryStore,
  Classification,
  DataAccessGate,
  DataCatalog,
  loadClassificationLattice,
} from '../../src/data/index.mjs';
import { createMemoryRepository } from '../../src/persistence/repository-memory.mjs';
import { createTestEncryptor } from '../helpers/encryption.mjs';
import { createPolicyDecisionPoint } from '../../src/policy/engine.mjs';
import { EnforcementPoint } from '../../src/policy/enforcement-point.mjs';
import { loadPolicyBundle } from '../../src/policy/loader.mjs';

const lattice = loadClassificationLattice();
const bundle = loadPolicyBundle();

/** فاعلٌ وكيلٌ حقيقي: التخليص يُشتقّ من دوره ولا يُمرَّر (`M7.02`). */
function agentActor(id = 'agent:a') {
  return /** @type {never} */ ({
    id,
    role: 'role:agent',
    kind: 'agent',
    state: 'active',
    scope: 'org:interior',
  });
}

// الفهرس والذاكرة صارا على مستودعات (`M3.05`)؛ ومستودع الذاكرة هنا لسرعة
// الاختبار لا لإثبات الاستمرارية، وإثباتها في `tests/persistence/restart.test.mjs`.
// المغلِّف يُبنى مرّة لهذا الملف: مزوّد مفاتيح لكل نداء `setup` كان سيُنشئ مجلداً
// مؤقّتاً لكل اختبار فيبطئ الملف بلا أن يقيس شيئاً زائداً — والمقيس هنا الذاكرة
// لا عزل المفاتيح، وعزلُها مقيس في `tests/data/encryption.test.mjs`.
const fixture = await createTestEncryptor();
test.after(() => fixture.cleanup());

function setup(limits = {}) {
  const log = new EventLog();
  const enforcementPoint = new EnforcementPoint({
    decisionPoint: createPolicyDecisionPoint({ bundle }),
    log,
  });
  const catalog = new DataCatalog({
    log,
    repository: createMemoryRepository(DataCatalog.spec),
    lattice,
    enforcementPoint,
  });
  // البوابة تُركَّب هنا كما تُركَّب في الإنتاج: مخزنٌ بلا بوابة يرفض كل استدعاء.
  const accessGate = new DataAccessGate({ log, catalog, lattice, enforcementPoint });
  const memory = new AgentMemoryStore({
    catalog,
    log,
    repository: createMemoryRepository(AgentMemoryStore.spec),
    accessGate,
    // المغلِّف لازم للتذكّر والاستدعاء (`M7.03`): مخزنٌ بلا مغلِّف يرفض، ولا يكتب
    // نصّاً — فلو كتب نصّاً لصار تركُ المغلِّف أسهلَ طريقٍ إلى مخزونٍ مكشوف.
    encryptor: fixture.encryptor,
    ...limits,
  });
  return { log, catalog, memory, accessGate };
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
  // قرار الإتاحة انتقل إلى بوابة الوصول (`M7.02`) واختباره في
  // `tests/data/access-gate.test.mjs`؛ والمقيس هنا أن الفهرس لم يُبقِ منه مساراً.
  assert.equal(
    /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (DataCatalog.prototype))[
      'canRead'
    ],
    undefined,
  );
  await catalog.markQuality(d.id, 'verified');
  const after = await catalog.get(d.id);
  assert.ok(after, 'السجل يجب أن يبقى بعد تعليم الجودة');
  assert.equal(after.quality, 'verified');
  // النسخة أثرٌ للكتابة: تسجيلٌ ثم تعليم جودة يعنيان كتابتين.
  assert.equal(after.version, 2);
});

test('memory is isolated by agent identity', async () => {
  const { memory } = setup();
  const x = await memory.remember('agent:a', 'private note', { actor: agentActor() });
  assert.equal((await memory.recall({ id: x.id, actor: agentActor() })).content, 'private note');
  await assert.rejects(
    () => memory.recall({ id: x.id, actor: agentActor('agent:b') }),
    /MEMORY_NOT_FOUND/,
  );
  await memory.forget('agent:a', x.id);
  await assert.rejects(() => memory.recall({ id: x.id, actor: agentActor() }), /MEMORY_NOT_FOUND/);
});

test('memory quota is enforced', async () => {
  const { memory } = setup({ maxEntries: 1 });
  await memory.remember('agent:a', 'one', { actor: agentActor() });
  await assert.rejects(
    () => memory.remember('agent:a', 'two', { actor: agentActor() }),
    /MEMORY_QUOTA_EXCEEDED/,
  );
});

test('two memories for the same agent do not collide on dataset name', async () => {
  // عيبٌ لم يكن يظهر في `Map` بلا قيد فريد: اسم عقد البيانات كان
  // `memory:${agentId}` فيتعارض عند ثاني ذاكرة لنفس الوكيل. القيد الفريد في
  // القاعدة هو ما كشفه، والاسم صار يحمل معرّف الذاكرة.
  const { memory, catalog } = setup();
  const first = await memory.remember('agent:a', 'one', { actor: agentActor() });
  const second = await memory.remember('agent:a', 'two', { actor: agentActor() });
  assert.notEqual(first.datasetId, second.datasetId);
  assert.ok(await catalog.get(first.datasetId));
  assert.ok(await catalog.get(second.datasetId));
});
