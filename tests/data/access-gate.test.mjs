// اختبار بوابة الوصول إلى البيانات — M7.02.
//
// معيار القبول: «وصول بلا تخليص كافٍ يُرفض ويُسجَّل». والمقيس أوسع من العبارة،
// لأن عبارةً واحدة تُمرَّر بشرطٍ واحد. المفحوص هنا هل بقي **مسارٌ** إلى مادةٍ
// مصنّفة بلا قرار كامل: بتمرير تخليصٍ في الطلب، أو بقراءةٍ بلا سياسة تُقيَّم، أو
// بكتابةٍ إلى الأسفل تُخرج المادة من مرتبتها، أو بأثرٍ يُنفَّذ بتذكرةٍ غير محقَّقة،
// أو بمخزن ذاكرةٍ يُركَّب بلا بوابة فيقرأ بلا قرار.
//
// ونقطة التفويض هنا **حقيقية** بحزمة السياسات الحقيقية: بوابةٌ تُختبر بنقطةٍ
// مزيّفة تُثبت أنها تنادي مزيّفاً لا أنها محكومة.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';

import {
  ACCESS_ERRORS,
  AgentMemoryStore,
  DataAccessGate,
  DataCatalog,
  loadClassificationLattice,
} from '../../src/data/index.mjs';
import { createPolicyDecisionPoint } from '../../src/policy/engine.mjs';
import { EnforcementPoint } from '../../src/policy/enforcement-point.mjs';
import { loadPolicyBundle } from '../../src/policy/loader.mjs';
import { createMemoryRepository } from '../../src/persistence/repository-memory.mjs';
import { QuarantineWarden } from '../../src/governance/quarantine.mjs';
import { IncidentRegister } from '../../src/identity/incident-register.mjs';
import { createTestEncryptor } from '../helpers/encryption.mjs';
import { createTestLedger } from '../helpers/lineage.mjs';

const bundle = loadPolicyBundle();
const lattice = loadClassificationLattice();
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** سجل أحداث صغير: المقيس ما سُجّل، فلا يُستعار سجلٌ ثقيل لقياس التسجيل. */
function memoryLog() {
  /** @type {Array<{ type: string, actor: string, payload: Record<string, unknown> }>} */
  const events = [];
  return {
    events,
    /**
     * @param {string} type
     * @param {string} actor
     * @param {object} payload
     * @returns {void}
     */
    append(type, actor, payload) {
      events.push({ type, actor, payload: /** @type {Record<string, unknown>} */ (payload) });
    },
  };
}

/**
 * @param {{ withEnforcement?: boolean, withQuarantine?: boolean, withLineage?: boolean }} [options]
 */
function setup({ withEnforcement = true, withQuarantine = true, withLineage = true } = {}) {
  const log = memoryLog();
  const enforcementPoint = new EnforcementPoint({
    decisionPoint: createPolicyDecisionPoint({ bundle }),
    log,
  });
  const assets = createMemoryRepository(DataCatalog.spec);
  // دفتر النسب شرط تركيبٍ للفهرس وللبوابة معاً بعد `M7.04`.
  const { ledger, repository: lineageRepository } = createTestLedger({
    log: /** @type {never} */ (log),
    assets,
    lattice,
  });
  const catalog = new DataCatalog({
    log: /** @type {never} */ (log),
    repository: assets,
    lattice,
    approvals: null,
    enforcementPoint,
    lineage: withLineage ? ledger : null,
  });
  const warden = new QuarantineWarden({
    incidents: new IncidentRegister({}),
    log: /** @type {never} */ (log),
  });
  const gate = new DataAccessGate({
    log: /** @type {never} */ (log),
    catalog,
    lattice,
    enforcementPoint: withEnforcement ? enforcementPoint : null,
    quarantine: withQuarantine ? warden : null,
    lineage: withLineage ? ledger : null,
  });
  return { log, catalog, gate, warden, enforcementPoint, ledger, lineageRepository };
}

/**
 * @param {string} role
 * @param {Record<string, unknown>} [patch]
 */
function actorOf(role, patch = {}) {
  return {
    id: `agent:${role.replace('role:', '')}-1`,
    role,
    kind: /** @type {const} */ ('human'),
    state: 'active',
    scope: 'org:interior',
    ...patch,
  };
}

/**
 * @param {DataCatalog} catalog
 * @param {string} classification
 * @param {string} name
 */
function registerAsset(catalog, classification, name) {
  return catalog.register({
    name,
    owner: 'crown',
    classification: /** @type {never} */ (classification),
    source: 'crown',
  });
}

/**
 * يقيس **رمز** الرفض لا نصّه: النص للبشر يتغيّر، والرمز عقدٌ يُبنى عليه.
 * @param {() => Promise<unknown>} fn
 * @param {string | string[]} code
 */
async function rejectsWithCode(fn, code) {
  const codes = Array.isArray(code) ? code : [code];
  await assert.rejects(fn, (error) => {
    const actual = /** @type {{ code?: string }} */ (error).code;
    assert.ok(
      actual !== undefined && codes.includes(actual),
      `الرمز المنتظر ${codes.join(' أو ')} والواقع ${String(actual)}`,
    );
    return true;
  });
}

/**
 * @param {ReturnType<typeof memoryLog>} log
 * @param {string} type
 */
function eventsOf(log, type) {
  return log.events.filter((event) => event.type === type);
}

// ── التخليص بياناً لا مطالبةً ───────────────────────────────────────────────

test('التخليص يُشتقّ من الدور من ملف الإعدادات، ودورٌ غير معلَن لا تخليص له', () => {
  assert.equal(lattice.clearanceFor('role:king'), 'sovereign');
  assert.equal(lattice.clearanceFor('role:minister'), 'sensitive');
  assert.equal(lattice.clearanceFor('role:agent'), 'internal');
  assert.equal(lattice.clearanceFor('role:intruder'), null);
  assert.equal(lattice.clearanceFor(undefined), null);
  assert.equal(lattice.clearanceFor(42), null);
});

test('كل دور في config/roles.yaml له تخليص معلَن — وإلا انحرف الملفّان', () => {
  const roles = YAML.parse(fs.readFileSync(path.join(REPO_ROOT, 'config/roles.yaml'), 'utf8'));
  const declared = new Set(lattice.clearedRoles);
  const missing = roles.roles
    .map((/** @type {{id: string}} */ r) => r.id)
    .filter((/** @type {string} */ id) => !declared.has(id));
  assert.deepEqual(missing, [], `أدوارٌ بلا تخليص معلَن: ${missing.join('، ')}`);
});

test('تخليصٌ يُمرَّر في الطلب لا يُقرأ: الدور وحده يقرّر', async () => {
  const { catalog, gate } = setup();
  const asset = await registerAsset(catalog, 'sensitive', 'set:passthrough');
  // فاعلٌ دورُه «وكيل» (تخليصه داخلي) يزعم تخليصاً سيادياً في حقلٍ إضافي.
  const liar = actorOf('role:agent', { clearance: 'sovereign' });
  await rejectsWithCode(
    () => gate.read({ actor: /** @type {never} */ (liar), assetId: asset.id, reader: () => 'x' }),
    'DATA_ACCESS_CLEARANCE_INSUFFICIENT',
  );
});

test('دورٌ بلا تخليص معلَن يُرفض ولا يُفترض له أدنى مرتبة', async () => {
  const { catalog, gate } = setup();
  const asset = await registerAsset(catalog, 'public', 'set:undeclared-role');
  await rejectsWithCode(
    () =>
      gate.read({
        actor: /** @type {never} */ (actorOf('role:minister', { role: 'role:ghost' })),
        assetId: asset.id,
        reader: () => 'x',
      }),
    // السياسة ترفضه أولاً لأن دوره غير مأذون؛ والرفض قائم في الحالين ولا يُقرأ العام.
    ['POLICY_UNKNOWN_ROLE', 'DATA_ACCESS_NOT_AUTHORIZED', 'DATA_ACCESS_CLEARANCE_UNDECLARED'],
  );
});

// ── القراءة ────────────────────────────────────────────────────────────────

test('القراءة المأذونة بتخليص كافٍ تنفَّذ وتُسجَّل بتصنيفها', async () => {
  const { catalog, gate, log } = setup();
  const asset = await registerAsset(catalog, 'sensitive', 'set:read-ok');
  const value = await gate.read({
    actor: /** @type {never} */ (actorOf('role:minister')),
    assetId: asset.id,
    purpose: 'audit-review',
    reader: (found) => `read:${found.id}`,
  });
  assert.equal(value, `read:${asset.id}`);
  const granted = eventsOf(log, 'data.access.granted');
  assert.equal(granted.length, 1);
  assert.equal(granted[0]?.payload['classification'], 'sensitive');
  assert.equal(granted[0]?.payload['clearance'], 'sensitive');
  assert.equal(granted[0]?.payload['purpose'], 'audit-review');
});

test('وصولٌ بلا تخليص كافٍ يُرفض ويُسجَّل ولا يُنفَّذ الأثر — معيار القبول', async () => {
  const { catalog, gate, log } = setup();
  const asset = await registerAsset(catalog, 'sovereign', 'set:read-denied');
  let touched = false;
  await rejectsWithCode(
    () =>
      gate.read({
        actor: /** @type {never} */ (actorOf('role:operator')),
        assetId: asset.id,
        reader: () => {
          touched = true;
          return 'material';
        },
      }),
    'DATA_ACCESS_CLEARANCE_INSUFFICIENT',
  );
  assert.equal(touched, false, 'الأثر نُفِّذ بعد الرفض');
  const refused = eventsOf(log, 'data.access.refused');
  assert.equal(refused.length, 1);
  assert.equal(refused[0]?.payload['code'], ACCESS_ERRORS.CLEARANCE_INSUFFICIENT);
  assert.equal(refused[0]?.payload['classification'], 'sovereign');
  assert.equal(refused[0]?.payload['clearance'], 'internal');
  assert.equal(eventsOf(log, 'data.access.granted').length, 0);
});

test('الرفض يُبلَّغ الحاجب، ويُعزل الموضوع عند العتبة', async () => {
  const { catalog, gate, log } = setup();
  const asset = await registerAsset(catalog, 'sovereign', 'set:quarantine');
  const actor = actorOf('role:operator');
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await rejectsWithCode(
      () => gate.read({ actor: /** @type {never} */ (actor), assetId: asset.id, reader: () => 1 }),
      'DATA_ACCESS_CLEARANCE_INSUFFICIENT',
    );
  }
  const signals = eventsOf(log, 'quarantine.signal').filter(
    (event) => event.payload['kind'] === 'clearance-denied',
  );
  assert.equal(signals.length, 3);
  assert.equal(eventsOf(log, 'quarantine.isolated').length, 1);
});

test('السياسة تمنع الوكيل من قراءة السيادي ولو بلغ تخليصه — وهو لا يبلغه', async () => {
  const { catalog, gate, log } = setup();
  const asset = await registerAsset(catalog, 'sovereign', 'set:agent-sovereign');
  await rejectsWithCode(
    () =>
      gate.read({
        actor: /** @type {never} */ (actorOf('role:agent', { kind: 'agent' })),
        assetId: asset.id,
        reader: () => 1,
      }),
    'DATA_ACCESS_NOT_AUTHORIZED',
  );
  const decisions = eventsOf(log, 'policy.decision');
  assert.equal(decisions.at(-1)?.payload['policyId'], 'pol:deny-agent-read-sovereign');
});

test('الملك يقرأ السيادي: الرفض ليس عطلاً عامّاً', async () => {
  const { catalog, gate } = setup();
  const asset = await registerAsset(catalog, 'sovereign', 'set:king-read');
  const value = await gate.read({
    actor: /** @type {never} */ (actorOf('role:king')),
    assetId: asset.id,
    reader: () => 'sovereign-material',
  });
  assert.equal(value, 'sovereign-material');
});

// ── الكتابة ────────────────────────────────────────────────────────────────

test('الكتابة في أصلٍ بمستوى التخليص تنفَّذ وتُسجَّل', async () => {
  const { catalog, gate, log } = setup();
  const asset = await registerAsset(catalog, 'internal', 'set:write-ok');
  const result = await gate.write({
    actor: /** @type {never} */ (actorOf('role:operator')),
    assetId: asset.id,
    writer: () => 'written',
  });
  assert.equal(result, 'written');
  assert.equal(eventsOf(log, 'data.write.committed').length, 1);
});

test('الكتابة إلى الأسفل مرفوضة: تخليصٌ عالٍ لا يكتب في أصلٍ أدنى', async () => {
  const { catalog, gate, log } = setup();
  const asset = await registerAsset(catalog, 'public', 'set:write-down');
  let touched = false;
  await rejectsWithCode(
    () =>
      gate.write({
        actor: /** @type {never} */ (actorOf('role:minister')),
        assetId: asset.id,
        writer: () => {
          touched = true;
          return 'leak';
        },
      }),
    'DATA_ACCESS_WRITE_DOWN_REFUSED',
  );
  assert.equal(touched, false);
  assert.equal(
    eventsOf(log, 'data.access.refused').at(-1)?.payload['code'],
    ACCESS_ERRORS.WRITE_DOWN_REFUSED,
  );
});

test('الكتابة إلى الأعلى مسموحة: الرفض على الاتجاه لا على الفارق', async () => {
  const { catalog, gate } = setup();
  const asset = await registerAsset(catalog, 'sovereign', 'set:write-up');
  const result = await gate.write({
    actor: /** @type {never} */ (actorOf('role:operator')),
    assetId: asset.id,
    writer: () => 'appended',
  });
  assert.equal(result, 'appended');
});

test('المراجع يقرأ ولا يكتب: السياسة لا تأذن له بالكتابة', async () => {
  const { catalog, gate } = setup();
  const asset = await registerAsset(catalog, 'sensitive', 'set:auditor');
  const read = await gate.read({
    actor: /** @type {never} */ (actorOf('role:auditor')),
    assetId: asset.id,
    reader: () => 'ok',
  });
  assert.equal(read, 'ok');
  await rejectsWithCode(
    () =>
      gate.write({
        actor: /** @type {never} */ (actorOf('role:auditor')),
        assetId: asset.id,
        writer: () => 'nope',
      }),
    'DATA_ACCESS_NOT_AUTHORIZED',
  );
});

// ── التركيب الناقص والمسارات الجانبية ───────────────────────────────────────

test('بوابةٌ بلا نقطة تفويض ترفض كل قراءة وكتابة ولا تتجاوزها', async () => {
  const { catalog, gate } = setup({ withEnforcement: false });
  const asset = await registerAsset(catalog, 'public', 'set:no-epp');
  await rejectsWithCode(
    () =>
      gate.read({
        actor: /** @type {never} */ (actorOf('role:king')),
        assetId: asset.id,
        reader: () => 1,
      }),
    'DATA_ACCESS_ENFORCEMENT_REQUIRED',
  );
  await rejectsWithCode(
    () =>
      gate.write({
        actor: /** @type {never} */ (actorOf('role:king')),
        assetId: asset.id,
        writer: () => 1,
      }),
    'DATA_ACCESS_ENFORCEMENT_REQUIRED',
  );
});

test('أصلٌ غير مفهرس يُرفض ولا يُعامَل عامّاً', async () => {
  const { gate } = setup();
  await rejectsWithCode(
    () =>
      gate.read({
        actor: /** @type {never} */ (actorOf('role:king')),
        assetId: 'data:missing',
        reader: () => 1,
      }),
    'DATA_ACCESS_ASSET_UNKNOWN',
  );
});

test('طلبٌ بلا فاعل أو بلا أثر يُرفض برمزه', async () => {
  const { catalog, gate } = setup();
  const asset = await registerAsset(catalog, 'public', 'set:malformed');
  await rejectsWithCode(
    () => gate.read({ actor: /** @type {never} */ ({}), assetId: asset.id, reader: () => 1 }),
    'DATA_ACCESS_ACTOR_REQUIRED',
  );
  await rejectsWithCode(
    () =>
      gate.read({
        actor: /** @type {never} */ (actorOf('role:king')),
        assetId: asset.id,
        reader: /** @type {never} */ (undefined),
      }),
    'DATA_ACCESS_EFFECT_REQUIRED',
  );
});

test('تذكرة القرار تُستهلَك مرّة: التذكرة نفسها لا تُنفّذ أثرين', async () => {
  const { catalog, enforcementPoint } = setup();
  const asset = await registerAsset(catalog, 'internal', 'set:ticket');
  const actor = actorOf('role:operator');
  const { token } = await enforcementPoint.authorize({
    actor: /** @type {never} */ (actor),
    action: 'read-data',
    resource: { type: 'data', id: asset.id, classification: 'internal' },
    context: {},
  });
  assert.equal(typeof token, 'string');
  enforcementPoint.verify(/** @type {string} */ (token), {
    actorId: actor.id,
    action: 'read-data',
    resourceKey: `data:${asset.id}`,
  });
  assert.throws(() =>
    enforcementPoint.verify(/** @type {string} */ (token), {
      actorId: actor.id,
      action: 'read-data',
      resourceKey: `data:${asset.id}`,
    }),
  );
});

test('المسار الجانبي أُغلق: لا دالّة canRead في فهرس البيانات', () => {
  assert.equal(
    typeof (
      /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (DataCatalog.prototype))[
        'canRead'
      ]
    ),
    'undefined',
    'عادت دالّةٌ تقارن تخليصاً يُمرَّر بتصنيف الأصل بلا سياسة ولا تذكرة',
  );
});

// ── ذاكرة الوكلاء تمرّ من البوابة ───────────────────────────────────────────

const fixture = await createTestEncryptor();
test.after(() => fixture.cleanup());

/**
 * @param {{ withGate?: boolean, withEncryptor?: boolean }} [options]
 */
function memorySetup({ withGate = true, withEncryptor = true } = {}) {
  const { log, catalog, gate } = setup();
  const memory = new AgentMemoryStore({
    catalog,
    log: /** @type {never} */ (log),
    repository: createMemoryRepository(AgentMemoryStore.spec),
    accessGate: withGate ? gate : null,
    encryptor: withEncryptor ? fixture.encryptor : null,
  });
  return { log, catalog, gate, memory };
}

test('مخزنٌ بلا بوابة يرفض التذكّر والاستدعاء ولا يقرأ بلا قرار', async () => {
  const { memory } = memorySetup({ withGate: false });
  await assert.rejects(
    () =>
      memory.remember('agent:a', { x: 1 }, { actor: /** @type {never} */ (actorOf('role:agent')) }),
    /MEMORY_ACCESS_GATE_REQUIRED/,
  );
  await assert.rejects(
    () => memory.recall({ id: 'memory:none', actor: /** @type {never} */ (actorOf('role:agent')) }),
    /MEMORY_ACCESS_GATE_REQUIRED/,
  );
});

test('الاستدعاء يمرّ بقرار إتاحة، فتخليصٌ لا يبلغ التصنيف يُرفض ويُسجَّل', async () => {
  const { memory, log } = memorySetup();
  const minister = actorOf('role:minister');
  const entry = await memory.remember(
    'agent:worker',
    { secretPlan: true },
    { classification: 'sensitive', actor: /** @type {never} */ (minister) },
  );
  const back = await memory.recall({
    agentId: 'agent:worker',
    id: entry.id,
    actor: /** @type {never} */ (minister),
  });
  assert.deepEqual(back.content, { secretPlan: true });
  // وكيلٌ آخر يذكر معرّف صاحب الذاكرة: الملكية تُقاس بالفاعل فلا يُعاد له شيء.
  await assert.rejects(
    () =>
      memory.recall({
        id: entry.id,
        actor: /** @type {never} */ (actorOf('role:agent', { id: 'agent:other', kind: 'agent' })),
      }),
    /MEMORY_NOT_FOUND/,
  );
  // ومشغّلٌ تخليصه «internal» يُرفض على التصنيف لا على الملكية.
  await rejectsWithCode(
    () => memory.recall({ id: entry.id, actor: /** @type {never} */ (actorOf('role:operator')) }),
    'DATA_ACCESS_CLEARANCE_INSUFFICIENT',
  );
  assert.ok(eventsOf(log, 'data.access.refused').length >= 1);
});

test('التذكّر بتصنيفٍ أدنى من تخليص المُنشئ مرفوض: لا كتابة إلى الأسفل عند الإنشاء', async () => {
  const { memory, log } = memorySetup();
  await rejectsWithCode(
    () =>
      memory.remember(
        'agent:worker',
        { leak: true },
        { classification: 'public', actor: /** @type {never} */ (actorOf('role:minister')) },
      ),
    'DATA_ACCESS_WRITE_DOWN_REFUSED',
  );
  assert.equal(
    eventsOf(log, 'data.access.refused').at(-1)?.payload['mode'],
    'create',
    'الرفض لم يُسجَّل كإنشاء',
  );
  assert.equal(eventsOf(log, 'memory.created').length, 0);
});

test('التذكّر بلا فاعل مُعرَّف يُرفض: كتابةٌ لا تُنسب لا تُدقَّق', async () => {
  const { memory } = memorySetup();
  await assert.rejects(() => memory.remember('agent:worker', { x: 1 }), /MEMORY_ACTOR_REQUIRED/);
});
