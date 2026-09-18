// دورة الاحتفاظ والمحو — الخطوة M7.06.
//
// فحص القبول المعلَن: **«دورة احتفاظ كاملة تُمحى وتُسجَّل»**. والشطر الثاني هو
// موضع القياس: قبل هذه الخطوة كان `retention.purge` يحذف الصفوف المنتهية
// بـ`DELETE` بلا شاهد ولا فاعل ولا سبب، فلا يبقى في الدولة ما يميّز «مُحي بانتهاء
// مدّته» من «لم يوجد قطّ». فتُقاس هنا الدورة كلها: المادّة تزول، وعقدُها يزول،
// وتوابعُ العقد تُشهد قبل زوالها، والشاهد يبقى في سلسلةٍ متّصلة.
//
// ومعها تُقاس الأبواب التي كانت مفتوحة: محوٌ بدورٍ ليس مطهِّراً، ومحوُ عقدٍ قبل
// ذاكرته (وهو ما ترفضه القاعدة رفضاً محتوماً)، ومحوُ محفوظٍ قانوناً، وتشغيلٌ
// يُعاد بالخطأ، وترتيبٌ معكوسٌ في السياسة.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { registerTmpRoot } from '../helpers/tmp-roots.mjs';

import { EventLog } from '../../src/root-of-trust/index.mjs';
import {
  AgentMemoryStore,
  DataAccessGate,
  DataCatalog,
  ErasureLedger,
  RETENTION_CYCLE_ERRORS,
  RetentionCycle,
  loadClassificationLattice,
  loadRetentionPolicy,
} from '../../src/data/index.mjs';
import { dependentFault, RETENTION_ERRORS } from '../../src/persistence/retention.mjs';
import {
  CLASSIFICATION_APPROVAL_SPEC,
  ERASURE_RECORD_SPEC,
} from '../../src/persistence/entities.mjs';
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

const HOUR = 3600000;

// `R6-A-01`: المحوُ صارَ يمرُّ بنقطةِ التفويضِ على الفعلِ `purge-data`، وهو فوقَ
// العتبةِ السياديّةِ؛ فكلُّ محوٍ في هذا الملفِّ يحملُ أمراً ملكيّاً بمعرّفِه
// وملخّصِه، وفاعلُه مسجَّلٌ في بوابةِ الهويةِ. وهذا ليس تخفيفاً للاختبارِ بل
// تشديدٌ: قبلَ الإصلاحِ كان يكفي نصُّ دورٍ يُرسلُه المُنادي.
const ROYAL = { id: 'rc:retention-test', digest: 'b'.repeat(64) };

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
 * تركيبٌ **كالتركيب المُشغَّل**: نفس ما يفعله `createRegistries` — دفترُ نسبٍ يقرأ
 * مستودع الأصول، وفهرسٌ وبوابةٌ عليهما، ودفترُ شواهدٍ ودورةٌ تقرأ كلَّ ذلك. ولو
 * رُكِّب هنا غيرُ المُشغَّل لقاس الاختبار تركيباً لا يعمل في الدولة.
 */
function setup() {
  const log = new EventLog();
  // بوابةُ هويةٍ مصغَّرةٌ تحاكي جذرَ الثقةِ: تعرفُ المطهِّرَ المسجَّلَ وحدَه، فلا
  // يمحو من يصفُ نفسَه مطهِّراً. وقياسُ الرفضِ التفصيليُّ في
  // `tests/data/retention-authorization.test.mjs`.
  const identityGate = {
    /**
     * @param {string} actorId
     */
    async verify(actorId) {
      if (actorId !== 'operator:root') {
        return {
          ok: false,
          code: 'IDENTITY_UNKNOWN',
          reason: `الفاعل ${actorId} غير مسجَّل في جذر الثقة.`,
          actor: null,
        };
      }
      return {
        ok: true,
        code: 'IDENTITY_OK',
        reason: 'مسجَّل ونشط.',
        actor: {
          id: 'operator:root',
          role: 'role:operator',
          state: 'active',
          kind: /** @type {any} */ ('human'),
          capabilities: [],
        },
      };
    },
  };
  const enforcementPoint = new EnforcementPoint({
    decisionPoint: createPolicyDecisionPoint({ bundle }),
    log,
    identityGate: /** @type {never} */ (identityGate),
  });
  const assets = createMemoryRepository(DataCatalog.spec);
  const { ledger, repository: lineageRepository } = createTestLedger({ log, assets, lattice });
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
  const memories = createMemoryRepository(AgentMemoryStore.spec);
  const memory = new AgentMemoryStore({
    catalog,
    log,
    repository: memories,
    accessGate,
    encryptor: fixture.encryptor,
  });
  const erasureRecords = createMemoryRepository(ERASURE_RECORD_SPEC);
  const erasureLedger = new ErasureLedger({ log, repository: erasureRecords });
  const approvals = createMemoryRepository(CLASSIFICATION_APPROVAL_SPEC);
  const retention = new RetentionCycle({
    log,
    erasureLedger,
    authorizer: /** @type {never} */ ({
      identityGate,
      /**
       * @param {any} request
       */
      authorize: (request) => enforcementPoint.authorize(request),
      /**
       * @param {string | undefined} token
       * @param {any} expected
       */
      verify: (token, expected) => enforcementPoint.verify(token, expected),
    }),
    repositories: {
      dataAssets: assets,
      memories,
      dataLineage: lineageRepository,
      classificationApprovals: approvals,
    },
  });
  return {
    log,
    memory,
    memories,
    assets,
    lineageRepository,
    erasureLedger,
    erasureRecords,
    retention,
  };
}

/**
 * يُقدّم انتهاء مدخلٍ إلى الماضي في المستودع مباشرةً: لا مسارَ في المخزن يُقصّر
 * مدّة الاحتفاظ — وهو مقصود، فتقصيرُها من الطلب يجعل الاحتفاظ رقماً يقوله
 * المُنادي. والقياس هنا على حالِ صفٍّ مرّ عليه الزمن.
 * @param {{ findById: (id: string) => Promise<Record<string, unknown> | null>, update: (id: string, expectedVersion: number, patch: Record<string, unknown>) => Promise<unknown> }} repository
 * @param {string} id
 * @param {Record<string, unknown>} patch
 * @returns {Promise<void>}
 */
async function forceRow(repository, id, patch) {
  const row = await repository.findById(id);
  assert.ok(row !== null, `الصفّ «${id}» غير موجود، فلا يُقاس عليه شيء.`);
  await repository.update(id, Number(row['version']), patch);
}

test('فحص القبول: دورة احتفاظ كاملة تُمحى وتُسجَّل', async () => {
  const { memory, memories, assets, lineageRepository, erasureLedger, retention, log } = setup();
  const alpha = agent('agent:alpha');
  const expiring = await memory.remember('agent:alpha', 'مادّةٌ انتهت مدّتها', { actor: alpha });
  const living = await memory.remember('agent:alpha', 'مادّةٌ حيّة', { actor: alpha });
  const doomedAsset = String((await memories.findById(expiring.id))?.['datasetId']);
  // النسب مكتوبٌ فعلاً قبل المحو: بلا تابعٍ قائم لا تُقاس شهادةُ التوابع.
  const lineageBefore = await lineageRepository.list({ filter: { assetId: doomedAsset } });
  assert.ok(lineageBefore.length > 0, 'عقدُ البيانات بلا صفّ نسبٍ واحد، فلا شهادةَ تُقاس.');
  await forceRow(memories, expiring.id, { expiresAt: new Date(Date.now() - 1000) });

  const report = await retention.run({ actor: operator(), royalCommand: ROYAL });

  // (1) المادّة زالت، وعقدُها زال معها: عقدٌ يبقى بعد مادّته أصلٌ يتيمٌ في الفهرس.
  assert.equal(await memories.findById(expiring.id), null);
  assert.equal(await assets.findById(doomedAsset), null);
  // (2) وما لم تنتهِ مدّته باقٍ: الدورة تمحو ما انتهى لا ما وجدته.
  assert.ok((await memories.findById(living.id)) !== null);
  assert.deepEqual(
    report.erased.map((entry) => entry.target),
    ['memories', 'data_assets'],
  );
  // (3) الشاهد مكتوبٌ لكلٍّ من المحوَين، بترتيب الدورة نفسه.
  const entries = await erasureLedger.entries();
  assert.equal(entries.length, 2);
  assert.deepEqual(
    entries.map((row) => String(row['target'])),
    ['memories', 'data_assets'],
  );
  assert.deepEqual(
    entries.map((row) => String(row['targetId'])),
    [expiring.id, doomedAsset],
  );
  for (const row of entries) {
    assert.equal(String(row['reason']), 'retention');
    assert.equal(String(row['actorId']), 'operator:root');
    // الشاهد لا يحمل مادّة ما مُحي: دفترٌ يحمل المادة يُبطل المحو من باب التدقيق.
    assert.ok(!Object.prototype.hasOwnProperty.call(row, 'content'));
  }
  // (4) شهادةُ التوابع: العدد ورأسُ السلسلة قبل الزوال — والتوابع نفسها زالت.
  const attested = /** @type {Record<string, { rows: number, headHash: string | null }>} */ (
    entries[1]?.['dependents']
  );
  assert.equal(attested['state.data_lineage']?.rows, lineageBefore.length);
  assert.match(String(attested['state.data_lineage']?.headHash), /^[0-9a-f]{64}$/);
  assert.deepEqual(await lineageRepository.list({ filter: { assetId: doomedAsset } }), []);
  // (5) السلسلة متّصلة، ورأسُها يساوي عدد الشواهد.
  assert.equal(await erasureLedger.assertIntact(), 2);
  assert.equal(report.ledgerSeq, 2);
  // (6) والمحو حدثٌ في السجل لا فعلٌ صامت.
  const erasureEvents = log.snapshot().filter((entry) => String(entry.type) === 'retention.erased');
  assert.equal(erasureEvents.length, 2);
});

test('كشفُ العبث: شاهدٌ يُحرَّف أو يُحذف يُسقط التحقّق', async () => {
  const { memory, memories, erasureLedger, erasureRecords, retention } = setup();
  const alpha = agent('agent:alpha');
  const entry = await memory.remember('agent:alpha', 'مادّة', { actor: alpha });
  await forceRow(memories, entry.id, { expiresAt: new Date(Date.now() - 1000) });
  await retention.run({ actor: operator(), royalCommand: ROYAL });
  assert.equal(await erasureLedger.assertIntact(), 2);

  // تحريفُ فاعلِ المحو في الشاهد الأول: التجزئة تُحسب على الفاعل، فينقطع الربط.
  const first = (await erasureLedger.entries())[0];
  await forceRow(erasureRecords, String(first?.['id']), { actorId: 'operator:impostor' });
  const verdict = await erasureLedger.verify();
  assert.equal(verdict.ok, false);
  await assert.rejects(() => erasureLedger.assertIntact(), /CHAIN_BROKEN|ERASURE/);
});

test('محوٌ بدورٍ ليس مطهِّراً مرفوضٌ رفضاً مُسمّى', async () => {
  const { memory, memories, retention, erasureLedger } = setup();
  const alpha = agent('agent:alpha');
  const entry = await memory.remember('agent:alpha', 'مادّة', { actor: alpha });
  await forceRow(memories, entry.id, { expiresAt: new Date(Date.now() - 1000) });

  // الوكيل ليس مطهِّراً قصداً: من يمحو ما انتهت مدّته يمحو دليلاً، فلا يكون صاحبه.
  await assert.rejects(
    () => retention.run({ actor: alpha }),
    (error) =>
      error instanceof Error && error.message.includes(RETENTION_CYCLE_ERRORS.SWEEP_REFUSED),
  );
  // والجردُ كذلك: من لا يجوز له المحو لا يجوز له تسمية ما سيُمحى ومتى.
  await assert.rejects(
    () => retention.plan({ actor: alpha }),
    (error) =>
      error instanceof Error && error.message.includes(RETENTION_CYCLE_ERRORS.SWEEP_REFUSED),
  );
  // ولا شاهدَ كُتب، ولا صفٌّ زال: الرفض يقع قبل أي أثر.
  assert.deepEqual(await erasureLedger.entries(), []);
  assert.ok((await memories.findById(entry.id)) !== null);
});

test('محوُ عقدٍ قبل ذاكرته مرفوض، والمحفوظُ قانوناً لا يُمحى ولا يُسقط الدورة', async () => {
  const { memory, memories, assets, retention, erasureLedger } = setup();
  const alpha = agent('agent:alpha');
  const held = await memory.remember('agent:alpha', 'مادّةٌ عقدُها محفوظ', { actor: alpha });
  const heldAsset = String((await memories.findById(held.id))?.['datasetId']);

  // (1) محوُ العقد قبل ذاكرته: `state.memories.dataset_id … ON DELETE RESTRICT` يرفضه
  //     في القاعدة رفضاً محتوماً، والدورة ترفضه برمزٍ مُسمّى قبل أن تصل القاعدة.
  await assert.rejects(
    () =>
      retention.eraseDirected({
        actor: operator(),
        target: 'data_assets',
        id: heldAsset,
        royalCommand: ROYAL,
      }),
    (error) =>
      error instanceof Error && error.message.includes(RETENTION_CYCLE_ERRORS.DEPENDENT_PRESENT),
  );

  // (2) عقدٌ محفوظٌ قانوناً ومادّتُه انتهت: المادّة تُمحى وتُسجَّل، والعقد يبقى
  //     برفضٍ مُسمّى في التقرير — وإسقاطُ الدورة هنا كان سيمنع محو كل ما بعده.
  await forceRow(assets, heldAsset, { legalHold: true });
  await forceRow(memories, held.id, { expiresAt: new Date(Date.now() - 1000) });
  const report = await retention.run({ actor: operator(), royalCommand: ROYAL });

  assert.equal(await memories.findById(held.id), null);
  assert.ok((await assets.findById(heldAsset)) !== null);
  assert.deepEqual(
    report.erased.map((entry) => entry.target),
    ['memories'],
  );
  assert.equal(report.refused.length, 1);
  assert.equal(report.refused[0]?.code, RETENTION_CYCLE_ERRORS.LEGAL_HOLD);
  assert.equal((await erasureLedger.entries()).length, 1);
});

test('بوابةُ التكرار ترفض إعادة التشغيل، والدورةُ لا تمحو مرّتين', async () => {
  const { memory, memories, retention, erasureLedger } = setup();
  const alpha = agent('agent:alpha');
  const entry = await memory.remember('agent:alpha', 'مادّة', { actor: alpha });
  await forceRow(memories, entry.id, { expiresAt: new Date(Date.now() - 1000) });
  const first = await retention.run({ actor: operator(), royalCommand: ROYAL });
  assert.equal(first.erased.length, 2);

  // تشغيلٌ يُعاد فوراً يُرفض: المدّة الدنيا معلَنة في السياسة، وتُقاس على آخر شاهدٍ
  // في الدفتر لا على متغيّرٍ في الذاكرة الحيّة يُصفَّر بإعادة التشغيل.
  await assert.rejects(
    () => retention.run({ actor: operator(), royalCommand: ROYAL }),
    (error) => error instanceof Error && error.message.includes(RETENTION_CYCLE_ERRORS.TOO_SOON),
  );
  // وبعد مرور المدّة: تمرّ الدورة ولا تمحو شيئاً ولا تكتب شاهداً — المحو مُقتصرٌ
  // على ما انتهت مدّته، فلا يتضاعف الشاهد على صفٍّ واحد.
  const later = await retention.run({
    actor: operator(),
    now: new Date(Date.now() + 2 * HOUR),
    royalCommand: ROYAL,
  });
  assert.deepEqual(later.erased, []);
  assert.equal((await erasureLedger.entries()).length, 2);
});

test('الجردُ الجافّ يعدّ ولا يمحو', async () => {
  const { memory, memories, retention, erasureLedger } = setup();
  const alpha = agent('agent:alpha');
  const entry = await memory.remember('agent:alpha', 'مادّة', { actor: alpha });
  await memory.remember('agent:alpha', 'مادّةٌ حيّة', { actor: alpha });
  await forceRow(memories, entry.id, { expiresAt: new Date(Date.now() - 1000) });

  const plan = await retention.plan({ actor: operator() });
  const memoriesTarget = plan.targets.find((target) => target.key === 'memories');
  assert.equal(memoriesTarget?.eligible, 1);
  assert.deepEqual(memoriesTarget?.ids, [entry.id]);
  // الجردُ لا يمحو ولا يكتب شاهداً: تخطيطٌ يمحو ليس تخطيطاً.
  assert.ok((await memories.findById(entry.id)) !== null);
  assert.deepEqual(await erasureLedger.entries(), []);
});

test('السياسة ترفض ترتيباً معكوساً وأدوارَ مطهِّرٍ تخالف سياسة الذاكرة', () => {
  // الشجرة المنسوخة تُنشأ **تحت جذر المستودع** لا في `/tmp`: مُحمِّلُ سياسة الذاكرة
  // يقيس أسماء الوحدات المصرَّح لها على `path.resolve(dir, '..')` — أي على الشجرة
  // المفحوصة — فشجرةٌ في `/tmp` بلا `src/` كانت ستسقط لسببٍ غير المقصود بالقياس.
  const source = path.join(process.cwd(), 'config');
  const dir = registerTmpRoot(fs.mkdtempSync(path.join(process.cwd(), '.retention-policy-')));
  try {
    // ونسخةُ الإعدادات تُوضع في المجلد المؤقّت **نفسه** لا في `config/` داخله: أبوه
    // حينها هو جذر المستودع، وفيه `src/` التي يقيس عليها المُحمِّل أسماء الوحدات.
    fs.cpSync(source, dir, { recursive: true });
    const configDir = dir;
    const file = path.join(configDir, 'retention.yaml');
    const original = fs.readFileSync(file, 'utf8');

    // (1) عكسُ الترتيب: محوُ العقد قبل ذاكرته مرفوضٌ محتوماً في القاعدة
    //     (`ON DELETE RESTRICT`)، فسياسةٌ تُعلنه تصف دورةً تفشل كل مرّة.
    fs.writeFileSync(
      file,
      original.replace(
        /order:\s*\n\s*- memories\s*\n\s*- data_assets/,
        'order:\n    - data_assets\n    - memories',
      ),
    );
    assert.throws(
      () => loadRetentionPolicy({ dir: configDir }),
      (error) =>
        error instanceof Error && error.message.includes(RETENTION_CYCLE_ERRORS.CONFIG_INVALID),
    );

    // (2) أدوارُ مطهِّرٍ تخالف `config/memory.yaml`: قائمتان في ملفّين تعنيان أن
    //     المحو يقع بدورٍ لا يملكه في الملف الآخر.
    fs.writeFileSync(file, original.replace('- role:operator', '- role:auditor'));
    assert.throws(
      () => loadRetentionPolicy({ dir: configDir }),
      (error) =>
        error instanceof Error && error.message.includes(RETENTION_CYCLE_ERRORS.CONFIG_INVALID),
    );

    // والسياسة الأصلية تُحمَّل: الرفضُ حكمٌ على الانحراف لا على كل شيء.
    fs.writeFileSync(file, original);
    const policy = loadRetentionPolicy({ dir: configDir });
    assert.deepEqual([...policy.cycle.order], ['memories', 'data_assets']);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('خطأ المرجع الخام يُترجم إلى رفضٍ مُسمّى', () => {
  // العيب المُقاس: `purge` كان يرفع خطأ قاعدةٍ خاماً (‏`23503`) فيُقرأ خللاً لا
  // رفضاً، والفعلُ المطلوب معروف: المحو بدورةٍ تشهد على التوابع قبل زوالها.
  const named = dependentFault(
    Object.assign(new Error('violates foreign key constraint'), {
      code: '23503',
      constraint: 'data_lineage_asset_id_fkey',
    }),
    'state.data_assets',
  );
  assert.ok(named !== null);
  assert.equal(named.code, RETENTION_ERRORS.DEPENDENTS_PRESENT);
  assert.match(named.message, /data_lineage_asset_id_fkey/);
  assert.match(named.message, /RetentionCycle\.run/);
  // وما ليس خطأ مرجعٍ يُمرَّر كما هو: ترجمةٌ تشمل كل خطأ تُخفي أخطاءً أخرى.
  assert.equal(dependentFault(Object.assign(new Error('boom'), { code: '23505' }), 'x'), null);
  assert.equal(dependentFault(new Error('boom'), 'x'), null);
  assert.equal(dependentFault(null, 'x'), null);
});
