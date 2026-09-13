// حدود ذاكرة الوكلاء وعزلها — الخطوة M7.05.
//
// فحص القبول المعلَن: **«وكيل لا يقرأ ذاكرة وكيل آخر بأي مسار»**. و«بأي مسار» هي
// موضع القياس: لا يكفي أن يُرفض `recall` بمعرّفٍ مباشر، بل تُقاس كل الأبواب التي
// كانت مفتوحة قبل هذه الخطوة — استدعاءٌ بمعرّف، واستدعاءٌ بذكر اسم المالك،
// وسردٌ باسم غيره، ونسيانُ ذاكرة غيره، وزرعُ ذاكرةٍ في وعاء غيره، ثم مادّةٌ
// انتهت مدّتها.
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventLog } from '../../src/root-of-trust/index.mjs';
import {
  AgentMemoryStore,
  DataAccessGate,
  DataCatalog,
  MEMORY_LIMIT_ERRORS,
  loadClassificationLattice,
  loadMemoryPolicy,
} from '../../src/data/index.mjs';
import { createMemoryRepository } from '../../src/persistence/repository-memory.mjs';
import { createTestEncryptor } from '../helpers/encryption.mjs';
import { createPolicyDecisionPoint } from '../../src/policy/engine.mjs';
import { EnforcementPoint } from '../../src/policy/enforcement-point.mjs';
import { loadPolicyBundle } from '../../src/policy/loader.mjs';
import { createTestLedger } from '../helpers/lineage.mjs';

const lattice = loadClassificationLattice();
const bundle = loadPolicyBundle();
const fixture = await createTestEncryptor();
test.after(() => fixture.cleanup());

/**
 * @param {string} id
 * @returns {never}
 */
function agent(id) {
  return /** @type {never} */ ({
    id,
    role: 'role:agent',
    kind: 'agent',
    state: 'active',
    scope: 'org:interior',
  });
}

/**
 * @param {string} [role]
 * @returns {never}
 */
function operator(role = 'role:operator') {
  return /** @type {never} */ ({
    id: 'operator:root',
    role,
    kind: 'human',
    state: 'active',
    scope: 'org:interior',
  });
}

/**
 * @param {{ policy?: import('../../src/data/memory-limits.mjs').MemoryPolicy, quarantine?: { report: (input: { kind: string, subject: string, detail?: Record<string, unknown> }) => unknown } }} [options]
 */
function setup(options = {}) {
  const log = new EventLog();
  const enforcementPoint = new EnforcementPoint({
    decisionPoint: createPolicyDecisionPoint({ bundle }),
    log,
    requireIdentityGate: false, // اختباراتٌ لا تُمرِّر بوابةَ هويةٍ
  });
  const assets = createMemoryRepository(DataCatalog.spec);
  const { ledger } = createTestLedger({ log, assets, lattice });
  const catalog = new DataCatalog({
    log,
    repository: assets,
    lattice,
    enforcementPoint,
    lineage: ledger,
  });
  const accessGate = new DataAccessGate({
    log,
    catalog,
    lattice,
    enforcementPoint,
    lineage: ledger,
  });
  const repository = createMemoryRepository(AgentMemoryStore.spec);
  const memory = new AgentMemoryStore({
    catalog,
    log,
    repository,
    accessGate,
    encryptor: fixture.encryptor,
    ...(options.policy === undefined ? {} : { policy: options.policy }),
    ...(options.quarantine === undefined ? {} : { quarantine: options.quarantine }),
  });
  return { log, memory, repository, accessGate };
}

/**
 * سياسةٌ مُشتقّة من سياسة المستودع بتعديلٍ ضيّق: الأرقام تبقى من `config/memory.yaml`
 * فلا يقيس الاختبار سياسةً يخترعها لنفسه، والتعديل يُصرَّح به في كل استعمال.
 * @param {Record<string, unknown>} overrides
 * @returns {import('../../src/data/memory-limits.mjs').MemoryPolicy}
 */
function policyWith(overrides) {
  const base = loadMemoryPolicy();
  const shape = {
    version: base.version,
    owner: base.owner,
    quotas: { ...base.quotas },
    expiry: { ...base.expiry, defaultDays: { ...base.expiry.defaultDays } },
    isolation: { ...base.isolation },
    anomaly: { ...base.anomaly },
    store: { table: base.store.table, dbConstraints: [...base.store.dbConstraints] },
    guardedPaths: base.guardedPaths.map((entry) => ({ ...entry, methods: [...entry.methods] })),
    repositoryHolders: [...base.repositoryHolders],
    ...overrides,
  };
  return new (Object.getPrototypeOf(base).constructor)(shape);
}

/**
 * يُقدّم تاريخ انتهاء مدخلٍ إلى الماضي في المستودع مباشرةً: لا مسارَ في المخزن
 * يُقصّر مدّة الاحتفاظ — وهو مقصود، فتقصيرُها من الطلب يجعل الاحتفاظ رقماً يقوله
 * المُنادي. والقياس هنا على حالِ صفٍّ مرّ عليه الزمن.
 * @param {{ findById: (id: string) => Promise<Record<string, unknown> | null>, update: (id: string, expectedVersion: number, patch: Record<string, unknown>) => Promise<unknown> }} repository
 * @param {{ id: string, version: number }} entry
 * @returns {Promise<void>}
 */
async function age(repository, entry) {
  await repository.update(entry.id, entry.version, { expiresAt: new Date(Date.now() - 1000) });
}

test('فحص القبول: وكيلٌ لا يقرأ ذاكرة وكيلٍ آخر بأي مسار', async () => {
  const { memory } = setup();
  const a = agent('agent:alpha');
  const b = agent('agent:beta');
  const secret = await memory.remember('agent:alpha', 'سرُّ ألفا', { actor: a });

  // (1) استدعاءٌ بالمعرّف المباشر — والرمز `MEMORY_NOT_FOUND` لا «ليس لك»: رمزٌ
  // يميّز الوجود من عدمه يجعل الرفض نفسه قناةً تُجيب عن «هل يملك فلانٌ هذا؟».
  await assert.rejects(() => memory.recall({ id: secret.id, actor: b }), /MEMORY_NOT_FOUND/);
  // (2) استدعاءٌ بذكر اسم المالك — الباب الذي كان يظنّ صاحبُه أنه إذن.
  await assert.rejects(
    () => memory.recall({ id: secret.id, actor: b, agentId: 'agent:alpha' }),
    /MEMORY_NOT_FOUND/,
  );
  // (3) سردُ مداخل الغير — ولو بلا مادّة: الوصفُ وحده يقول متى عمل وعلى ماذا.
  await assert.rejects(
    () => memory.list({ actor: b, agentId: 'agent:alpha' }),
    (error) =>
      error instanceof Error && error.message.includes(MEMORY_LIMIT_ERRORS.ISOLATION_REFUSED),
  );
  // والسرد لنفسه يعمل ولا يُعيد مادّة — فالمسار المحكوم قائمٌ لا مسدود.
  const own = await memory.list({ actor: a });
  assert.equal(own.length, 1);
  assert.equal(own[0]?.id, secret.id);
  assert.ok(!Object.prototype.hasOwnProperty.call(own[0] ?? {}, 'content'));
  assert.deepEqual(await memory.list({ actor: b }), []);
  // (4) نسيانُ ذاكرة الغير — كان `forget(agentId, id)` يمحوها لمن يعرف المعرّف.
  await assert.rejects(() => memory.forget({ id: secret.id, actor: b }), /MEMORY_NOT_FOUND/);
  // (5) زرعُ ذاكرةٍ في وعاء الغير — تسريبٌ بالاتجاه المعاكس: تُقرأ لاحقاً ذاكرةَ
  // صاحبها وتُصدَّق.
  await assert.rejects(
    () => memory.remember('agent:alpha', 'ذاكرةٌ مزروعة', { actor: b }),
    (error) =>
      error instanceof Error && error.message.includes(MEMORY_LIMIT_ERRORS.OWNER_CLAIM_REFUSED),
  );
  // والمالك نفسه يقرأ ويمحو: العزلُ حصرٌ لا تعطيل.
  assert.equal((await memory.recall({ id: secret.id, actor: a })).content, 'سرُّ ألفا');
  assert.equal(await memory.forget({ id: secret.id, actor: a }), true);
});

test('التوقيع القديم `forget(agentId, id)` مرفوضٌ رفضاً مُسمّى', async () => {
  const { memory } = setup();
  const a = agent('agent:alpha');
  const entry = await memory.remember('agent:alpha', 'مادّة', { actor: a });
  await assert.rejects(
    () => memory.forget('agent:alpha', entry.id),
    (error) =>
      error instanceof Error && error.message.includes(MEMORY_LIMIT_ERRORS.OWNER_CLAIM_REFUSED),
  );
  // والمدخل باقٍ: رفضُ التوقيع ليس محواً صامتاً.
  assert.equal((await memory.recall({ id: entry.id, actor: a })).content, 'مادّة');
});

test('الانتهاء يُكتب فعلاً من السياسة لا من الطلب', async () => {
  const { memory, repository } = setup();
  const a = agent('agent:alpha');
  const before = Date.now();
  const entry = await memory.remember('agent:alpha', 'حادثة', { actor: a, kind: 'episodic' });
  assert.ok(entry.expiresAt instanceof Date, 'مدخلٌ بلا تاريخ انتهاء ذاكرةٌ أبديّة');
  const days = loadMemoryPolicy().daysFor('episodic');
  const expected = before + days * 86_400_000;
  assert.ok(Math.abs(entry.expiresAt.getTime() - expected) < 60_000);
  // والصفّ في المستودع يحمله كذلك: القياس على القيمة المُعادة وحدها كان سيمرّ
  // على مخزنٍ يحسب الانتهاء ولا يكتبه.
  const row = await repository.findById(entry.id);
  assert.ok(row?.['expiresAt'] instanceof Date);
});

test('ذاكرةٌ انتهت مدّتها لا تُستدعى ولا تُسرد ولو بقي صفّها', async () => {
  const { memory, repository } = setup();
  const a = agent('agent:alpha');
  const entry = await memory.remember('agent:alpha', 'مادّة قديمة', { actor: a });
  // إزاحةُ الانتهاء إلى الماضي في المستودع مباشرةً: هي حالُ صفٍّ مرّ عليه الزمن،
  // والمقيس أن **الفجوة** بين الانتهاء ومرور المطهِّر ليست إذناً بالقراءة.
  await age(repository, entry);
  await assert.rejects(
    () => memory.recall({ id: entry.id, actor: a }),
    (error) => error instanceof Error && error.message.includes(MEMORY_LIMIT_ERRORS.EXPIRED),
  );
  assert.deepEqual(await memory.list({ actor: a }), []);
});

test('المطهِّر فعلُ تشغيلٍ لا فعلُ وكيل', async () => {
  const { memory, repository } = setup();
  const a = agent('agent:alpha');
  const entry = await memory.remember('agent:alpha', 'مادّة قديمة', { actor: a });
  await age(repository, entry);
  await assert.rejects(
    () => memory.sweepExpired({ actor: a }),
    (error) => error instanceof Error && error.message.includes(MEMORY_LIMIT_ERRORS.SWEEP_REFUSED),
  );
  assert.equal(await repository.count(), 1, 'الرفض لا يمحو');
  const purged = await memory.sweepExpired({ actor: operator() });
  assert.deepEqual(purged, [entry.id]);
  assert.equal(await repository.count(), 0);
});

test('حصّة الوكيل تُرفض عليه وحده ولا تُغلق المخزن على غيره', async () => {
  // العيب المقيس: الفحص القديم كان `count()` بلا مرشِّح على سقفٍ واحد، فوكيلٌ
  // واحد يملأ المخزن ويمنع كل الوكلاء — تجويعٌ يعبر حدّ الوكيل.
  const { memory } = setup({
    policy: policyWith({ quotas: { ...loadMemoryPolicy().quotas, perAgentEntries: 2 } }),
  });
  const a = agent('agent:alpha');
  const b = agent('agent:beta');
  await memory.remember('agent:alpha', '١', { actor: a });
  await memory.remember('agent:alpha', '٢', { actor: a });
  await assert.rejects(
    () => memory.remember('agent:alpha', '٣', { actor: a }),
    (error) =>
      error instanceof Error && error.message.includes(MEMORY_LIMIT_ERRORS.AGENT_QUOTA_EXCEEDED),
  );
  // وبيتا يكتب: حصّةُ ألفا ليست سقفَ المخزن.
  const mine = await memory.remember('agent:beta', 'مادّتي', { actor: b });
  assert.equal(mine.agentId, 'agent:beta');
});

test('مدخلٌ يتجاوز حدّ الحجم يُرفض قبل أي كتابة', async () => {
  const { memory } = setup({
    policy: policyWith({ quotas: { ...loadMemoryPolicy().quotas, maxEntryBytes: 256 } }),
  });
  const a = agent('agent:alpha');
  await assert.rejects(
    () => memory.remember('agent:alpha', 'ن'.repeat(4096), { actor: a }),
    (error) =>
      error instanceof Error && error.message.includes(MEMORY_LIMIT_ERRORS.ENTRY_TOO_LARGE),
  );
  // ولا عقد بيانات بقي: الرفض قبل الكتابتين لا بينهما.
  assert.deepEqual(await memory.list({ actor: a }), []);
});

test('تكرارُ محاولة العبور يرفع إشارة حجر عند العتبة', async () => {
  /** @type {Array<{ kind: string, subject: string }>} */
  const reports = [];
  const { memory } = setup({
    quarantine: {
      report: (input) => {
        reports.push({ kind: input.kind, subject: input.subject });
        return true;
      },
    },
  });
  const a = agent('agent:alpha');
  const b = agent('agent:beta');
  const entry = await memory.remember('agent:alpha', 'سرّ', { actor: a });
  const threshold = loadMemoryPolicy().anomaly.crossAgentAttemptsBeforeSignal;
  for (let attempt = 1; attempt < threshold; attempt += 1) {
    await assert.rejects(() => memory.recall({ id: entry.id, actor: b }), /MEMORY_NOT_FOUND/);
  }
  assert.equal(reports.length, 0, 'محاولةٌ واحدة قد تكون معرّفاً خاطئاً فلا تُحجَر');
  await assert.rejects(() => memory.recall({ id: entry.id, actor: b }), /MEMORY_NOT_FOUND/);
  assert.equal(reports.length, 1);
  assert.equal(reports[0]?.subject, 'agent:beta');
  assert.equal(reports[0]?.kind, loadMemoryPolicy().anomaly.signalKind);
});

test('دورٌ تشغيلي يكتب لوكيلٍ باسمه ولا يكتب بلا مالك', async () => {
  const { memory, log } = setup();
  const entry = await memory.remember('agent:alpha', 'تهيئة', { actor: operator() });
  assert.equal(entry.agentId, 'agent:alpha');
  await assert.rejects(
    () => memory.remember('', 'بلا مالك', { actor: operator() }),
    (error) => error instanceof Error && error.message.includes(MEMORY_LIMIT_ERRORS.INPUT_INVALID),
  );
  // والحدث يقول من كتب: نيابةٌ تُسجَّل لا تُقرأ لاحقاً كأنّ الوكيل كتبها بنفسه.
  const created = log.events.filter((item) => item.type === 'memory.created');
  assert.equal(created.length, 1);
});

test('رفضُ العزل يُسجَّل حدثاً بعدد المحاولات', async () => {
  const { memory, log } = setup();
  const a = agent('agent:alpha');
  const b = agent('agent:beta');
  const entry = await memory.remember('agent:alpha', 'سرّ', { actor: a });
  await assert.rejects(() => memory.recall({ id: entry.id, actor: b }), /MEMORY_NOT_FOUND/);
  const refusals = log.events.filter((item) => item.type === 'memory.isolation.refused');
  assert.equal(refusals.length, 1);
  assert.equal(refusals[0]?.actor, 'agent:beta');
  const first = /** @type {{ data: Record<string, unknown> }} */ (refusals[0]);
  assert.equal(first.data['attempts'], 1);
});
