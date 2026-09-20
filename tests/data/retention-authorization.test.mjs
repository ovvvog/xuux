// اختبارُ تفويضِ المحوِ — إغلاقُ `R6-A-01` (مجلسُ النماذجِ، الجولةُ M11.06).
//
// **العيبُ المُقاسُ قبلَ الإصلاحِ بنصِّه:** حارسُ المحوِ الوحيدُ كان
// `assertSweeper` في `src/data/retention-cycle.mjs`: يقرأُ `actor.role` **نصّاً
// يُرسلُه المُنادي** ويقارنُه بأدوارِ المطهِّرِ. لا بوابةَ هويةٍ، ولا نداءَ إلى
// `EnforcementPoint.authorize`، ولا أمرَ ملكيّاً — مع أنّ `purge-data` مُعلَنٌ فوقَ
// العتبةِ السياديّةِ (`config/royal-authority.yaml`، `delegable: false`) وكان بلا
// مستهلِكٍ واحدٍ في `src/`. وقياسُ المجلسِ: فاعلٌ
// `{ id: 'nobody:unregistered', role: 'role:operator' }` محا صفَّينِ فعلاً
// **بصفرِ نداءاتٍ** إلى `authorize`.
//
// **وما يقيسُه هذا الملفُّ** ثلاثةُ أشياءَ لا يُغني بعضُها عن بعضٍ:
//  1. أنّ فاعلاً غيرَ مسجَّلٍ (أو مسجَّلاً بلا صلاحيةٍ، أو مُعلَّقاً) **يُرفَض**
//     ولا يُمحى صفٌّ واحدٌ.
//  2. أنّ عددَ نداءاتِ `authorize` على المسارِ الناجحِ **أكبرُ من صفرٍ** ومقيسٌ —
//     وأنّه صفرٌ فيما يُرفَض قبلَ التفويضِ. فحارسٌ يُقاس بالرفضِ وحدَه قد يكون
//     يرفضُ لسببٍ آخرَ.
//  3. أنّ حارسَ الدورِ النصّيِّ **لم يبقَ هو السلطةَ**: دورٌ صحيحٌ نصّاً مع هويةٍ
//     غيرِ مسجَّلةٍ يُرفَض، وهذا بعينُه ما كان يمرُّ.

import test from 'node:test';
import assert from 'node:assert/strict';

import { EventLog } from '../../src/root-of-trust/index.mjs';
import {
  AgentMemoryStore,
  DataAccessGate,
  DataCatalog,
  ErasureLedger,
  MEMORY_LIMIT_ERRORS,
  PURGE_AUTHORITY_ERRORS,
  RETENTION_CYCLE_ERRORS,
  RetentionCycle,
  loadClassificationLattice,
} from '../../src/data/index.mjs';
import { ERASURE_RECORD_SPEC } from '../../src/persistence/entities.mjs';
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

/** أمرٌ ملكيٌّ بمعرّفِه وملخّصِه: العتبةُ السياديّةُ ترفضُ ناقصَ الربطِ. */
const ROYAL = { id: 'rc:retention-2026-09', digest: 'a'.repeat(64) };

/**
 * سجلُّ هوياتٍ مصغَّرٌ يحاكي جذرَ الثقةِ: يعرفُ من سُجِّل وحدَه. وهذا هو الفرقُ
 * المقيسُ — قبلَ الإصلاحِ لم يكن لأحدٍ أن يسألَه.
 * @param {Array<{ id: string, role: string, state?: string, kind?: string }>} registered
 */
function identityGate(registered) {
  /** @type {Array<string>} */
  const asked = [];
  return {
    asked,
    /**
     * @param {string} actorId
     */
    async verify(actorId) {
      asked.push(actorId);
      const found = registered.find((entry) => entry.id === actorId);
      if (found === undefined) {
        return {
          ok: false,
          code: 'IDENTITY_UNKNOWN',
          reason: `الفاعل ${actorId} غير مسجَّل في جذر الثقة؛ ولا يُقبل فاعلٌ يصف نفسه.`,
          actor: null,
        };
      }
      if ((found.state ?? 'active') !== 'active') {
        return {
          ok: false,
          code: 'IDENTITY_NOT_ACTIVE',
          reason: `الفاعل ${actorId} حالته ${found.state}؛ فلا يفعل فعلاً محكوماً.`,
          actor: null,
        };
      }
      return {
        ok: true,
        code: 'IDENTITY_OK',
        reason: 'مسجَّل ونشط.',
        actor: {
          id: found.id,
          role: found.role,
          state: found.state ?? 'active',
          kind: /** @type {any} */ (found.kind ?? 'human'),
          capabilities: [],
        },
      };
    },
  };
}

/**
 * تركيبٌ كالمُشغَّل، ومعه **عدّادُ نداءاتِ التفويضِ**: المقيسُ أنّ النداءَ وقعَ
 * فعلاً لا أنّ الرفضَ وقعَ.
 * @param {{ registered?: Array<{ id: string, role: string, state?: string }>, withAuthorizer?: boolean, withIdentityGate?: boolean }} [options]
 */
function setup(options = {}) {
  const registered = options.registered ?? [{ id: 'king:root', role: 'role:king' }];
  const withAuthorizer = options.withAuthorizer ?? true;
  const withIdentityGate = options.withIdentityGate ?? true;
  const log = new EventLog();
  const gate = identityGate(registered);
  const enforcementPoint = new EnforcementPoint({
    decisionPoint: createPolicyDecisionPoint({ bundle }),
    log,
    ...(withIdentityGate ? { identityGate: gate } : { requireIdentityGate: false }),
    // R5-B-06: مُحقِّقُ أمرٍ موصولٌ — نطاقُ هذه المجموعةِ الاحتفاظُ والوصولُ
    // لا توثيقُ الأمرِ، والأمرُ في الاختبارِ صحيحٌ ببنائِه.
    royalCommandVerifier: () => true,
  });
  /** @type {Array<{ actorId: string, action: string }>} */
  const authorizeCalls = [];
  const authorizer = {
    identityGate: withIdentityGate ? gate : null,
    /**
     * @param {any} request
     */
    async authorize(request) {
      authorizeCalls.push({ actorId: String(request.actor?.id), action: String(request.action) });
      return enforcementPoint.authorize(request);
    },
    /**
     * @param {string | undefined} token
     * @param {{ actorId: string, action: string, resourceKey: string }} expected
     */
    verify(token, expected) {
      return enforcementPoint.verify(token, expected);
    },
  };

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
    // `LIM-3`: نقطةُ التفويضِ تصلُ المطهِّرَ كما تصلُ الدورةَ. وقبلَ `WL-190` لم
    // تكن تصلُه أصلاً، فكان `sweepExpired` يحذفُ بنصِّ دورٍ يُرسلُه المُنادي.
    ...(withAuthorizer ? { authorizer } : {}),
  });
  const erasureRecords = createMemoryRepository(ERASURE_RECORD_SPEC);
  const erasureLedger = new ErasureLedger({ log, repository: erasureRecords });
  const retention = new RetentionCycle({
    log,
    erasureLedger,
    ...(withAuthorizer ? { authorizer } : {}),
    repositories: {
      dataAssets: assets,
      memories,
      dataLineage: lineageRepository,
      classificationApprovals: createMemoryRepository({
        ...ERASURE_RECORD_SPEC,
        table: 'classification_approvals',
      }),
    },
  });
  return { retention, memory, memories, authorizeCalls, gate, log };
}

/**
 * يزرعُ مدخلَ ذاكرةٍ منتهيَ المدّةِ مباشرةً في المستودعِ: المقيسُ هو المحوُ لا
 * مسارُ الكتابةِ، وكتابةٌ محكومةٌ هنا تُدخلُ حارساً آخرَ في القياسِ.
 * @param {any} memories
 * @param {string} id
 */
async function expiredMemory(memories, id) {
  await memories.insert({
    id,
    agentId: 'agent:one',
    datasetId: 'ds:notes',
    kind: 'episodic',
    content: { text: 'نصٌّ منتهي المدّة' },
    legalHold: false,
    expiresAt: new Date(Date.now() - HOUR),
  });
}

test('فاعلٌ غيرُ مسجَّلٍ بدورٍ صحيحٍ نصّاً يُرفَض ولا يمحو صفّاً — وهذا نصّ العيب', async () => {
  const { retention, memories, authorizeCalls } = setup({
    registered: [{ id: 'king:root', role: 'role:king' }],
  });
  await expiredMemory(memories, 'mem:unregistered');
  await assert.rejects(
    () =>
      retention.run({
        // نفسُ الفاعلِ الذي محا صفَّينِ في قياسِ المجلسِ.
        actor: /** @type {never} */ ({
          id: 'nobody:unregistered',
          role: 'role:king',
          kind: 'human',
          state: 'active',
        }),
        royalCommand: ROYAL,
      }),
    (error) => {
      assert.equal(
        /** @type {{ code: string }} */ (error).code,
        RETENTION_CYCLE_ERRORS.NOT_AUTHORIZED,
      );
      assert.match(String(error), /IDENTITY|هوية|مسجَّل/);
      return true;
    },
  );
  // والنداءُ وقعَ فعلاً: رفضٌ بلا نداءٍ لا يُثبتُ أنّ المسارَ صارَ محكوماً.
  assert.deepEqual(authorizeCalls, [{ actorId: 'nobody:unregistered', action: 'purge-data' }]);
  const remaining = await memories.list({});
  assert.equal(remaining.length, 1, 'مُحي صفٌّ لفاعلٍ غيرِ مسجَّلٍ.');
});

test('فاعلٌ مسجَّلٌ بدورٍ لا يملك المحوَ يُرفَض بقرارِ السياسةِ لا بنصِّ دورِه', async () => {
  const { retention, memories, authorizeCalls } = setup({
    registered: [{ id: 'agent:one', role: 'role:agent' }],
  });
  await expiredMemory(memories, 'mem:role');
  await assert.rejects(
    () =>
      retention.run({
        // يُدّعى دورُ المطهِّرِ نصّاً، وجذرُ الثقةِ يقول: `role:agent`.
        actor: /** @type {never} */ ({
          id: 'agent:one',
          role: 'role:king',
          kind: 'agent',
          state: 'active',
        }),
        royalCommand: ROYAL,
      }),
    (error) => {
      assert.equal(
        /** @type {{ code: string }} */ (error).code,
        RETENTION_CYCLE_ERRORS.NOT_AUTHORIZED,
      );
      return true;
    },
  );
  assert.equal(authorizeCalls.length, 1);
  assert.equal((await memories.list({})).length, 1);
});

test('فاعلٌ مسجَّلٌ ومُعلَّقٌ يُرفَض — الحالةُ من جذرِ الثقةِ لا من الطلبِ', async () => {
  const { retention, memories } = setup({
    registered: [{ id: 'king:root', role: 'role:king', state: 'suspended' }],
  });
  await expiredMemory(memories, 'mem:suspended');
  await assert.rejects(
    () =>
      retention.run({
        actor: /** @type {never} */ ({
          id: 'king:root',
          role: 'role:king',
          kind: 'human',
          state: 'active',
        }),
        royalCommand: ROYAL,
      }),
    (error) => {
      assert.equal(
        /** @type {{ code: string }} */ (error).code,
        RETENTION_CYCLE_ERRORS.NOT_AUTHORIZED,
      );
      return true;
    },
  );
  assert.equal((await memories.list({})).length, 1);
});

test('المحوُ بلا أمرٍ ملكيٍّ يُرفَض: `purge-data` فوقَ العتبةِ السياديّةِ', async () => {
  const { retention, memories, authorizeCalls } = setup();
  await expiredMemory(memories, 'mem:no-command');
  await assert.rejects(
    () =>
      retention.run({
        actor: /** @type {never} */ ({
          id: 'king:root',
          role: 'role:king',
          kind: 'human',
          state: 'active',
        }),
      }),
    (error) => {
      assert.equal(
        /** @type {{ code: string }} */ (error).code,
        RETENTION_CYCLE_ERRORS.NOT_AUTHORIZED,
      );
      assert.match(String(error), /SOVEREIGN_COMMAND_REQUIRED/);
      return true;
    },
  );
  assert.equal(authorizeCalls.length, 1);
  assert.equal((await memories.list({})).length, 1);
});

test('محوٌ بلا نقطةِ تفويضٍ يُرفَض رفضاً مُسمّىً — التركيبُ الصامتُ لا يمحو', async () => {
  const { retention, memories } = setup({ withAuthorizer: false });
  await expiredMemory(memories, 'mem:no-authorizer');
  await assert.rejects(
    () =>
      retention.run({
        actor: /** @type {never} */ ({
          id: 'king:root',
          role: 'role:king',
          kind: 'human',
          state: 'active',
        }),
        royalCommand: ROYAL,
      }),
    (error) => {
      assert.equal(
        /** @type {{ code: string }} */ (error).code,
        RETENTION_CYCLE_ERRORS.AUTHORIZER_REQUIRED,
      );
      return true;
    },
  );
  assert.equal((await memories.list({})).length, 1);
});

test('نقطةُ تفويضٍ بلا بوابةِ هويةٍ لا تكفي: تقبلُ من يصفُ نفسَه', async () => {
  const { retention, memories } = setup({ withIdentityGate: false });
  await expiredMemory(memories, 'mem:no-gate');
  await assert.rejects(
    () =>
      retention.run({
        actor: /** @type {never} */ ({
          id: 'nobody:unregistered',
          role: 'role:king',
          kind: 'human',
          state: 'active',
        }),
        royalCommand: ROYAL,
      }),
    (error) => {
      assert.equal(
        /** @type {{ code: string }} */ (error).code,
        RETENTION_CYCLE_ERRORS.AUTHORIZER_REQUIRED,
      );
      assert.match(String(error), /بوابةِ هويةٍ/);
      return true;
    },
  );
  assert.equal((await memories.list({})).length, 1);
});

test('المحوُ الفعليُّ يقعُ بعدَ نداءِ تفويضٍ مقيسٍ — لا صفرَ نداءاتٍ كما كُشِف', async () => {
  const { retention, memories, authorizeCalls, gate, log } = setup();
  await expiredMemory(memories, 'mem:authorized');
  const report = await retention.run({
    actor: /** @type {never} */ ({
      id: 'king:root',
      role: 'role:king',
      kind: 'human',
      state: 'active',
    }),
    royalCommand: ROYAL,
  });
  assert.equal(report.erased.length, 1);
  assert.deepEqual(report.erased[0], { target: 'memories', id: 'mem:authorized' });
  assert.equal((await memories.list({})).length, 0);
  // النداءُ مقيسٌ لا مُفترَضٌ: هذا هو مقابلُ «authorize calls = []» في القياسِ.
  assert.equal(authorizeCalls.length, 1);
  assert.deepEqual(authorizeCalls[0], { actorId: 'king:root', action: 'purge-data' });
  assert.ok(gate.asked.includes('king:root'), 'لم تُسأل بوابةُ الهويةِ عن الفاعلِ.');
  const events = log.snapshot().map((entry) => entry.type);
  assert.ok(events.includes('retention.authorized'));
});

test('المحوُ الموجَّهُ يمرُّ بنفسِ التفويضِ على هدفِه بعينِه', async () => {
  const { retention, memories, authorizeCalls } = setup();
  await expiredMemory(memories, 'mem:directed');
  // بلا أمرٍ ملكيٍّ: مرفوضٌ، ولا يُقرأُ الصفُّ قبلَ القرارِ.
  await assert.rejects(
    () =>
      retention.eraseDirected({
        actor: /** @type {never} */ ({
          id: 'king:root',
          role: 'role:king',
          kind: 'human',
          state: 'active',
        }),
        target: 'memories',
        id: 'mem:directed',
      }),
    (error) => {
      assert.equal(
        /** @type {{ code: string }} */ (error).code,
        RETENTION_CYCLE_ERRORS.NOT_AUTHORIZED,
      );
      return true;
    },
  );
  assert.equal((await memories.list({})).length, 1);
  const outcome = await retention.eraseDirected({
    actor: /** @type {never} */ ({
      id: 'king:root',
      role: 'role:king',
      kind: 'human',
      state: 'active',
    }),
    target: 'memories',
    id: 'mem:directed',
    royalCommand: ROYAL,
  });
  assert.equal(outcome.id, 'mem:directed');
  assert.equal((await memories.list({})).length, 0);
  assert.equal(authorizeCalls.length, 2);
  assert.ok(authorizeCalls.every((call) => call.action === 'purge-data'));
});

test('تذكرةُ القرارِ تُستهلَكُ مرّةً واحدةً: لا محوَ ثانياً بنفسِ القرارِ', async () => {
  const { retention, memories } = setup();
  await expiredMemory(memories, 'mem:first');
  await expiredMemory(memories, 'mem:second');
  await retention.run({
    actor: /** @type {never} */ ({
      id: 'king:root',
      role: 'role:king',
      kind: 'human',
      state: 'active',
    }),
    royalCommand: ROYAL,
  });
  assert.equal((await memories.list({})).length, 0);
});

// ─────────────────────────────────────────────────────────────────────────────
// `LIM-3` (‏`WL-190`): **مسارُ المحوِ الثاني**. أُغلِقَ في `R6-A-01` مسارُ
// `RetentionCycle`، وبقيَ `AgentMemoryStore.sweepExpired` يحذفُ صفوفاً فعلاً
// (`repository.remove`) وحارسُه الوحيدُ `policy.isSweeper(actor.role)` — نصُّ دورٍ
// يُرسلُه المُنادي. فكان `role:operator` مُعلَناً في أدوارِ المطهِّرِ ومأذوناً في
// `pol:purge-data-sweeper-roles` **ولا يبلغُ العتبةَ السياديّةَ**، ومع ذلك يمحو.
// والمقيسُ أدناه أربعةُ أشياءَ لا يُغني بعضُها عن بعضٍ: أنّ الأهليّةَ وحدَها لا
// تمحو، وأنّ الرفضَ يقعُ **بصفرِ نداءاتِ تفويضٍ** (فرفضٌ متأخّرٌ سببُه آخرُ)،
// وأنّ التركيبَ الناقصَ يُرفَض لا يُمرَّر، وأنّ المسارَ المأذونَ يمحو فعلاً بنداءِ
// تفويضٍ **مقيسٍ**.
// ─────────────────────────────────────────────────────────────────────────────

/** @param {string} [role] */
function sweeper(role = 'role:operator') {
  return /** @type {any} */ ({ id: 'operator:root', role, kind: 'human', state: 'active' });
}

const SWEEPER_REGISTERED = [{ id: 'operator:root', role: 'role:operator' }];

test('مطهِّرُ الذاكرةِ يمحو بأمرٍ ملكيٍّ وبنداءِ تفويضٍ مقيسٍ — `LIM-3`', async () => {
  const { memory, memories, authorizeCalls } = setup({ registered: SWEEPER_REGISTERED });
  await expiredMemory(memories, 'mem:one');
  await expiredMemory(memories, 'mem:two');
  const purged = await memory.sweepExpired({ actor: sweeper(), royalCommand: ROYAL });
  assert.equal(purged.length, 2, 'المسارُ المأذونُ يمحو فعلاً لا يرفضُ كلَّ شيءٍ');
  assert.equal(await memories.count(), 0);
  const purgeCalls = authorizeCalls.filter((call) => call.action === 'purge-data');
  assert.ok(purgeCalls.length > 0, 'نداءُ التفويضِ وقعَ فعلاً — وكان صفراً قبلَ الإصلاح');
  assert.equal(purgeCalls[0]?.actorId, 'operator:root');
});

test('دورٌ مأذونٌ بلا أمرٍ ملكيٍّ لا يبلغُ العتبةَ: أهليّةٌ لا سلطةٌ', async () => {
  const { memory, memories, authorizeCalls } = setup({ registered: SWEEPER_REGISTERED });
  await expiredMemory(memories, 'mem:one');
  await assert.rejects(
    () => memory.sweepExpired({ actor: sweeper() }),
    (error) =>
      error instanceof Error &&
      error.message.includes(PURGE_AUTHORITY_ERRORS.ROLE_NOT_AUTHORITY) &&
      error.message.includes('purge-data'),
  );
  assert.equal(await memories.count(), 1, 'الرفضُ لا يمحو صفّاً');
  // الرفضُ **قبلَ** نداءِ التفويضِ: فرفضٌ متأخّرٌ يُقرأُ رمزَ سياسةٍ عامّاً ولا
  // يُسمّي للمُنادي أنّ دورَه أهليّةٌ لا سلطةٌ.
  assert.deepEqual(
    authorizeCalls.filter((call) => call.action === 'purge-data'),
    [],
  );
});

test('مطهِّرٌ بلا نقطةِ تفويضٍ يُرفَض رفضاً مُسمّىً — التركيبُ الصامتُ لا يمحو', async () => {
  const { memory, memories } = setup({ registered: SWEEPER_REGISTERED, withAuthorizer: false });
  await expiredMemory(memories, 'mem:one');
  await assert.rejects(
    () => memory.sweepExpired({ actor: sweeper(), royalCommand: ROYAL }),
    (error) =>
      error instanceof Error &&
      error.message.includes(MEMORY_LIMIT_ERRORS.PURGE_AUTHORIZER_REQUIRED),
  );
  assert.equal(await memories.count(), 1);
});

test('نقطةُ تفويضٍ بلا بوابةِ هويةٍ لا تكفي المطهِّرَ: تقبلُ من يصفُ نفسَه', async () => {
  const { memory, memories } = setup({ registered: SWEEPER_REGISTERED, withIdentityGate: false });
  await expiredMemory(memories, 'mem:one');
  await assert.rejects(
    () => memory.sweepExpired({ actor: sweeper(), royalCommand: ROYAL }),
    (error) =>
      error instanceof Error &&
      error.message.includes(MEMORY_LIMIT_ERRORS.PURGE_AUTHORIZER_REQUIRED),
  );
  assert.equal(await memories.count(), 1);
});

test('دورٌ ليس من أدوارِ المطهِّرِ يُرفَض قبلَ العتبةِ بصفرِ نداءاتِ تفويضٍ', async () => {
  const { memory, memories, authorizeCalls } = setup({ registered: SWEEPER_REGISTERED });
  await expiredMemory(memories, 'mem:one');
  await assert.rejects(
    () => memory.sweepExpired({ actor: sweeper('role:agent'), royalCommand: ROYAL }),
    (error) => error instanceof Error && error.message.includes(MEMORY_LIMIT_ERRORS.SWEEP_REFUSED),
  );
  assert.equal(await memories.count(), 1);
  assert.deepEqual(
    authorizeCalls.filter((call) => call.action === 'purge-data'),
    [],
  );
});
