// اختبارُ قبولِ الخطوة M9.01: **كلُّ محاولةِ كتابةٍ من مسارِ المراقبةِ تُرفض
// بنيوياً**.
//
// و«بنيوياً» ليست كلمةً تُقال: تُقاس بأربعةِ أشقّاء، وكلُّ شقيقٍ يفشل وحدَه إن
// انكسر:
//   ١. **الرفضُ عند اللمسِ لا عند التنفيذ:** الوصولُ إلى أيِّ اسمٍ كاتبٍ على
//      المشهدِ يرفع `MONITOR_WRITE_FORBIDDEN` قبل أن توجد مكالمة، فلا يُمسك
//      المستدعي دالّةَ كتابةٍ يمرّرها إلى موضعٍ لا يفحص. والكتابةُ على المشهدِ
//      نفسِه وحذفُه وإعادةُ تعريفِه وتبديلُ سلفِه مرفوضةٌ بالرمزِ ذاته.
//   ٢. **لا مسارَ ثانٍ:** وكيلُ المراقبةِ لا يُصدِّر مشهداً ولا مستودعاً ولا يملك
//      على سطحِه اسماً كاتباً واحداً؛ فالقراءةُ كلُّها من `read` وحده.
//   ٣. **القدرةُ غيرُ المستعملةِ قدرة:** دورٌ يحمل قدرةً خارجَ المقروءِ المُعلَنِ
//      يمنع **التركيب** لا يُستعمَل صامتاً؛ والتقابلُ في الاتجاهين.
//   ٤. **ما يُقرأ لا يُعدَّل بيدِ قارئه:** الصفوفُ المُعادةُ صورٌ مُجمَّدةٌ
//      تجميداً عميقاً، فتعديلُ صفٍّ مقروءٍ يفشل ولا يمسّ المخزن.
//
// ومعه الفشلُ المغلق (المادة 9): سجلُّ أحداثٍ غيرُ موصولٍ يرفض كلَّ قراءة، وسجلُّ
// هوياتٍ غيرُ موصولٍ يرفضها كذلك — ويُقاس الرفضُ على **كلِّ** مشهدٍ مُعلَنٍ وكلِّ
// نداءٍ مقروءٍ لا على واحدٍ منها.
//
// **حدٌّ معلَن:** المستودعاتُ ذاكريةٌ لا PostgreSQL، فقيودُ الهجرة لا تُقاس هنا؛
// وسجلُّ الهوياتِ يُمثَّل بكائنٍ يُرجِع صفوفاً مصنوعةً كي تُقاس حالاتُ الهويةِ
// (معلَّقٌ، محجورٌ، بدورٍ آخر) بلا إصدارِ شهاداتٍ لكلِّ حالة — والتحقّقُ المقيسُ
// هنا حكمُ الوكيلِ على الصفِّ لا سلامةُ إصدارِ الشهادة، وتلك مقيسةٌ في
// `tests/identity`.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { registerTmpRoot } from '../helpers/tmp-roots.mjs';

import { EventLog } from '../../src/root-of-trust/index.mjs';
import { createMemoryRepositories } from '../../src/persistence/composition.mjs';
import {
  MONITOR_ERRORS,
  MonitorAgent,
  createReadOnlyView,
  loadMonitoringPolicy,
  readRoleCapabilities,
} from '../../src/observability/index.mjs';

/** وثيقةُ المراقبةِ النافذة، مقروءةً لا مُختلقة. */
const CONFIG_DIR = path.join(process.cwd(), 'config');
const POLICY = loadMonitoringPolicy({ dir: CONFIG_DIR });

/** أسماءُ الكتابةِ في مستودعاتِ المشروع — تُقاس كلُّها لا واحدٌ منها. */
const WRITE_NAMES = Object.freeze(['insert', 'update', 'remove', 'delete', 'upsert']);

const AUDITOR = 'agent:monitor-1';

/**
 * @param {unknown} error
 * @returns {string}
 */
function codeOf(error) {
  return error !== null && typeof error === 'object' && 'code' in error
    ? String(/** @type {{ code: unknown }} */ (error).code)
    : `بلا رمز: ${String(error)}`;
}

/**
 * دولةٌ مصغَّرةٌ بمستودعاتٍ ذاكريةٍ وسجلِّ أحداثٍ حقيقيّ.
 * @param {object} [options]
 * @param {boolean} [options.withLog] بلا سجلٍّ يُقاس أنّ القراءةَ تسقط لا أنّها تمرّ.
 * @param {boolean} [options.withAgents] بلا سجلِّ هوياتٍ يُقاس أنّ القراءةَ تسقط.
 * @param {Record<string, Record<string, unknown>>} [options.identities]
 * @param {readonly string[]} [options.roleCapabilities]
 */
function state(options = {}) {
  const log = new EventLog();
  const repositories = createMemoryRepositories();
  const identities = options.identities ?? {
    [AUDITOR]: { id: AUDITOR, kind: 'service', state: 'active', role: POLICY.role },
    'agent:monitor-suspended': {
      id: 'agent:monitor-suspended',
      kind: 'service',
      state: 'suspended',
      role: POLICY.role,
    },
    'human:minister-1': {
      id: 'human:minister-1',
      kind: 'human',
      state: 'active',
      role: 'role:minister',
    },
  };
  const agents = {
    /** @param {string} id */
    get: async (id) => identities[id] ?? null,
  };
  const monitor = new MonitorAgent({
    policy: POLICY,
    repositories,
    agents: options.withAgents === false ? null : /** @type {never} */ (agents),
    log: options.withLog === false ? null : log,
    ...(options.roleCapabilities === undefined
      ? {}
      : { roleCapabilities: options.roleCapabilities }),
  });
  return { log, repositories, monitor };
}

/**
 * صفٌّ حقيقيٌّ في سجلِّ الهوياتِ ليُقاس أنّ المسارَ **يقرأ** فعلاً لا يُرجع فراغاً.
 * @param {ReturnType<typeof state>} s
 * @param {string} id
 * @param {string} role
 * @param {string} [owner]
 */
async function seedAgent(s, id, role, owner = 'crown') {
  await s.repositories.agents.insert({
    id,
    name: `وكيل ${id}`,
    role,
    owner,
    kind: 'service',
    state: 'active',
    capabilities: ['action:read-registry'],
    certificate: { subject: id, issuer: 'king', nested: { depth: 1 } },
  });
}

/**
 * مجلَّدُ إعداداتٍ مؤقّتٌ: `monitoring.yaml` معدَّلةٌ و`roles.yaml` منقولةٌ كما هي
 * إلا ما يُطلب تعديلُه. والمخطَّطُ يُقرأ من مجلَّدِ الإعداداتِ النافذِ لأن المؤقّتَ
 * بلا `schemas/` — وذلك سلوكُ المحمِّلِ المُعلَن.
 * @param {(doc: string) => string} editMonitoring
 * @param {(doc: string) => string} [editRoles]
 * @returns {string}
 */
function tempConfig(editMonitoring, editRoles) {
  const dir = registerTmpRoot(fs.mkdtempSync(path.join(os.tmpdir(), 'monitoring-config-')));
  fs.writeFileSync(
    path.join(dir, 'monitoring.yaml'),
    editMonitoring(fs.readFileSync(path.join(CONFIG_DIR, 'monitoring.yaml'), 'utf8')),
    'utf8',
  );
  const roles = fs.readFileSync(path.join(CONFIG_DIR, 'roles.yaml'), 'utf8');
  fs.writeFileSync(
    path.join(dir, 'roles.yaml'),
    editRoles === undefined ? roles : editRoles(roles),
    'utf8',
  );
  return dir;
}

test('المعيار: كلُّ اسمٍ كاتبٍ يُرفض عند لمسِه على المشهد لا عند تنفيذه', async () => {
  let calls = 0;
  const view = createReadOnlyView({
    viewId: 'probe',
    entity: 'state.agents',
    readers: {
      count: async () => {
        calls += 1;
        return 7;
      },
    },
  });
  for (const name of WRITE_NAMES) {
    assert.throws(
      () => /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (view))[name],
      (/** @type {unknown} */ error) => codeOf(error) === MONITOR_ERRORS.WRITE_FORBIDDEN,
      `الاسم ${name} لم يُرفض عند لمسِه`,
    );
  }
  // ولا يُوسَّع السطحُ ولا يُنقَص ولا يُبدَّل سلفُه.
  assert.throws(
    () => {
      /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (view))['insert'] = () => 1;
    },
    (/** @type {unknown} */ error) => codeOf(error) === MONITOR_ERRORS.WRITE_FORBIDDEN,
  );
  assert.throws(
    () => {
      delete (/** @type {Record<string, unknown>} */ (/** @type {unknown} */ (view))['count']);
    },
    (/** @type {unknown} */ error) => codeOf(error) === MONITOR_ERRORS.WRITE_FORBIDDEN,
  );
  assert.throws(
    () => Object.defineProperty(view, 'insert', { value: () => 1 }),
    (/** @type {unknown} */ error) => codeOf(error) === MONITOR_ERRORS.WRITE_FORBIDDEN,
  );
  assert.throws(
    () => Object.setPrototypeOf(view, { insert: () => 1 }),
    (/** @type {unknown} */ error) => codeOf(error) === MONITOR_ERRORS.WRITE_FORBIDDEN,
  );
  // والقراءةُ المُعلَنةُ تعمل: الرفضُ ليس تعطيلاً عامّاً.
  assert.equal(await view.read('count', [{}]), 7);
  assert.equal(calls, 1);
  // ونداءٌ غيرُ مُعلَنٍ عبر المسارِ الموحَّدِ مرفوضٌ بنفسِ الرمزِ لا بمسارٍ ثانٍ.
  await assert.rejects(
    () => view.read('insert', [{}]),
    (/** @type {unknown} */ error) => codeOf(error) === MONITOR_ERRORS.WRITE_FORBIDDEN,
  );
});

test('المعيار: القراءةُ بنداءٍ كاتبٍ مرفوضةٌ على كلِّ مشهدٍ مُعلَن', async () => {
  const s = state();
  for (const view of POLICY.views) {
    for (const name of WRITE_NAMES) {
      await assert.rejects(
        () => s.monitor.read(view.id, { actor: AUDITOR, method: name }),
        (/** @type {unknown} */ error) => codeOf(error) === MONITOR_ERRORS.WRITE_FORBIDDEN,
        `المشهد ${view.id} قبِل النداء ${name}`,
      );
    }
  }
});

test('المعيار: لا مسارَ ثانٍ — الوكيلُ لا يُصدِّر مشهداً ولا مستودعاً ولا اسماً كاتباً', () => {
  const s = state();
  const surface = new Set([
    ...Object.getOwnPropertyNames(MonitorAgent.prototype),
    ...Object.keys(s.monitor),
  ]);
  for (const name of WRITE_NAMES) {
    assert.equal(surface.has(name), false, `سطحُ الوكيلِ يحمل الاسمَ الكاتب ${name}`);
  }
  for (const name of ['view', 'repositories', 'repository', 'views' + 'Map']) {
    assert.equal(
      surface.has(name),
      false,
      `سطحُ الوكيلِ يُصدِّر ${name} فيفتح قراءةً خارجَ التدقيق`,
    );
  }
  // والمشاهدُ تُعلَن بمعرّفاتها لا بأجسامها.
  assert.deepEqual(
    [...s.monitor.views()],
    POLICY.views.map((view) => view.id),
  );
  for (const id of s.monitor.views()) assert.equal(typeof id, 'string');
});

test('المعيار: الصفوفُ المقروءةُ صورٌ مُجمَّدةٌ عميقاً فلا يُعدِّلها قارئُها', async () => {
  const s = state();
  await seedAgent(s, AUDITOR, POLICY.role);
  const row = /** @type {Record<string, unknown>} */ (
    await s.monitor.read('agents', { actor: AUDITOR, method: 'findById', id: AUDITOR })
  );
  assert.equal(row['id'], AUDITOR);
  assert.equal(Object.isFrozen(row), true);
  assert.throws(() => {
    row['role'] = 'role:king';
  });
  const certificate = /** @type {Record<string, unknown>} */ (row['certificate']);
  assert.equal(Object.isFrozen(certificate), true);
  assert.throws(() => {
    /** @type {Record<string, unknown>} */ (certificate['nested'])['depth'] = 99;
  });
  // والمخزنُ لم يمسّه شيء.
  const stored = /** @type {Record<string, unknown>} */ (
    await s.repositories.agents.findById(AUDITOR)
  );
  assert.equal(stored['role'], POLICY.role);
});

test('القدرةُ غيرُ المستعملةِ قدرة: قدرةٌ زائدةٌ أو ناقصةٌ تمنع التركيب', () => {
  const held = readRoleCapabilities({ dir: CONFIG_DIR, role: POLICY.role });
  // الدورُ النافذُ يطابق المُعلَنَ تطابقاً تامّاً — وإلا ما كان التركيبُ ليقع أصلاً.
  assert.deepEqual([...held].sort(), [...POLICY.allowedCapabilities].sort());
  assert.throws(
    () => state({ roleCapabilities: [...held, 'action:write-memory'] }),
    (/** @type {unknown} */ error) => codeOf(error) === MONITOR_ERRORS.CAPABILITY_FORBIDDEN,
  );
  assert.throws(
    () => state({ roleCapabilities: held.slice(1) }),
    (/** @type {unknown} */ error) => codeOf(error) === MONITOR_ERRORS.CAPABILITY_UNDECLARED,
  );
  assert.throws(
    () => readRoleCapabilities({ dir: CONFIG_DIR, role: 'role:not-declared' }),
    (/** @type {unknown} */ error) => codeOf(error) === MONITOR_ERRORS.CONFIG_INVALID,
  );
});

test('التركيبُ يقع أو يُردّ عند التركيب: مشهدٌ بلا مستودعٍ أو بجدولٍ مخالفٍ يمنع الإنشاء', () => {
  assert.throws(
    () =>
      new MonitorAgent({
        policy: POLICY,
        repositories: {},
        roleCapabilities: POLICY.allowedCapabilities,
        agents: null,
        log: new EventLog(),
      }),
    (/** @type {unknown} */ error) => codeOf(error) === MONITOR_ERRORS.VIEW_NOT_COMPOSED,
  );
  const repositories = /** @type {Record<string, unknown>} */ (
    /** @type {unknown} */ (createMemoryRepositories())
  );
  const first = POLICY.views[0];
  assert.notEqual(first, undefined);
  const registry = /** @type {MonitorViewName} */ (first?.registry ?? 'agents');
  // جدولٌ مخالفٌ: نفسُ النداءاتِ المقروءةِ ومواصفةٌ تُعلن جدولاً آخر.
  const original = /** @type {Record<string, unknown>} */ (repositories[registry]);
  repositories[registry] = {
    ...original,
    spec: { name: 'other', table: 'state.other_table', filterable: [] },
  };
  assert.throws(
    () =>
      new MonitorAgent({
        policy: POLICY,
        repositories,
        roleCapabilities: POLICY.allowedCapabilities,
        agents: null,
        log: new EventLog(),
      }),
    (/** @type {unknown} */ error) => codeOf(error) === MONITOR_ERRORS.ENTITY_MISMATCH,
  );
  // ونداءٌ مقروءٌ ناقصٌ في المستودعِ يُردّ عند التركيبِ لا عند أولِ سؤالٍ صحيح.
  const lacking = { ...original };
  const method = /** @type {string} */ (POLICY.readMethods[0] ?? 'list');
  delete (/** @type {Record<string, unknown>} */ (lacking)[method]);
  repositories[registry] = lacking;
  assert.throws(
    () =>
      new MonitorAgent({
        policy: POLICY,
        repositories,
        roleCapabilities: POLICY.allowedCapabilities,
        agents: null,
        log: new EventLog(),
      }),
    (/** @type {unknown} */ error) => codeOf(error) === MONITOR_ERRORS.VIEW_NOT_COMPOSED,
  );
});

test('الفشلُ مغلق: بلا سجلِّ أحداثٍ وبلا سجلِّ هوياتٍ لا تقع قراءةٌ واحدة', async () => {
  const noLog = state({ withLog: false });
  const noAgents = state({ withAgents: false });
  for (const view of POLICY.views) {
    for (const method of POLICY.readMethods) {
      await assert.rejects(
        () => noLog.monitor.read(view.id, { actor: AUDITOR, method, id: 'x' }),
        (/** @type {unknown} */ error) => codeOf(error) === MONITOR_ERRORS.AUDIT_REQUIRED,
        `${view.id}/${method} قُرئ بلا أثرِ تدقيق`,
      );
      await assert.rejects(
        () => noAgents.monitor.read(view.id, { actor: AUDITOR, method, id: 'x' }),
        (/** @type {unknown} */ error) => codeOf(error) === MONITOR_ERRORS.IDENTITY_UNVERIFIED,
        `${view.id}/${method} قُرئ بلا هويةٍ محقَّقة`,
      );
    }
  }
});

test('الهويةُ تُقرأ لا تُفترض: غيرُ مسجَّلٍ ومعلَّقٌ وبدورٍ آخر وبلا معرّفٍ — كلُّهم مرفوضون', async () => {
  const s = state();
  for (const actor of ['', '   ', 'agent:ghost', 'agent:monitor-suspended', 'human:minister-1']) {
    await assert.rejects(
      () => s.monitor.read('agents', { actor, method: 'count' }),
      (/** @type {unknown} */ error) => codeOf(error) === MONITOR_ERRORS.IDENTITY_UNVERIFIED,
      `الهوية «${actor}» قرأت وما كان لها أن تقرأ`,
    );
  }
});

test('السؤالُ محدود: ترشيحٌ غيرُ مُعلَنٍ وحدٌّ فوق السقفِ ومعرّفٌ غائبٌ مرفوضون', async () => {
  const s = state();
  /** @type {Array<import('../../src/observability/monitor-agent.mjs').MonitorReadRequest>} */
  const bad = [
    { actor: AUDITOR, method: 'list', filter: { notAField: 'x' } },
    { actor: AUDITOR, method: 'count', filter: { notAField: 'x' } },
    { actor: AUDITOR, method: 'list', limit: POLICY.maxRows + 1 },
    { actor: AUDITOR, method: 'list', limit: 0 },
    { actor: AUDITOR, method: 'list', limit: 1.5 },
    { actor: AUDITOR, method: 'findById' },
    { actor: AUDITOR, method: 'findById', id: '  ' },
  ];
  for (const request of bad) {
    await assert.rejects(
      () => s.monitor.read('agents', request),
      (/** @type {unknown} */ error) => codeOf(error) === MONITOR_ERRORS.QUERY_UNSUPPORTED,
      `سؤالٌ غيرُ محدودٍ مرّ: ${JSON.stringify(request)}`,
    );
  }
  // ومشهدٌ غيرُ مُعلَنٍ يُردّ برمزِه لا برمزِ سؤالٍ.
  await assert.rejects(
    () => s.monitor.read('notAView', { actor: AUDITOR, method: 'count' }),
    (/** @type {unknown} */ error) => codeOf(error) === MONITOR_ERRORS.VIEW_UNKNOWN,
  );
});

test('القراءةُ تقع فعلاً وتُسجَّل قبل وقوعِها، والرفضُ يُسجَّل برمزِه', async () => {
  const s = state();
  await seedAgent(s, AUDITOR, POLICY.role);
  await seedAgent(s, 'agent:worker-1', 'role:operator', 'ministry:labour');
  assert.equal(await s.monitor.read('agents', { actor: AUDITOR, method: 'count' }), 2);
  const listed = /** @type {ReadonlyArray<Record<string, unknown>>} */ (
    await s.monitor.read('agents', {
      actor: AUDITOR,
      method: 'list',
      filter: { owner: 'ministry:labour' },
      limit: 10,
    })
  );
  assert.equal(listed.length, 1);
  assert.equal(listed[0]?.['id'], 'agent:worker-1');
  const reads = s.log.events.filter((event) => event.type === POLICY.audit.readEvent);
  assert.equal(reads.length, 2);
  const last = /** @type {Record<string, unknown>} */ (reads[1]?.data);
  assert.equal(reads[1]?.actor, AUDITOR);
  assert.equal(last['view'], 'agents');
  assert.equal(last['entity'], 'state.agents');
  assert.equal(last['method'], 'list');
  assert.deepEqual(last['filterKeys'], ['owner']);
  assert.equal(last['limit'], 10);

  await assert.rejects(() => s.monitor.read('agents', { actor: AUDITOR, method: 'insert' }));
  const refusals = s.log.events.filter((event) => event.type === POLICY.audit.refusalEvent);
  assert.equal(refusals.length, 1);
  const refusal = refusals[0];
  assert.ok(refusal !== undefined);
  assert.equal(
    /** @type {Record<string, unknown>} */ (refusal.data)['code'],
    MONITOR_ERRORS.WRITE_FORBIDDEN,
  );
  // وسلسلةُ السجلِّ تبقى سليمةً بعد قيودِ المراقبةِ والرفض.
  assert.equal(s.log.verifyChain().ok, true);
});

test('الوثيقةُ حدٌّ لا وصف: كلُّ رمزٍ مضمونٌ، والكتابةُ لا تُعلَن قراءةً', () => {
  const codes = new Set(POLICY.guarantees.map((guarantee) => guarantee.code));
  for (const code of Object.values(MONITOR_ERRORS)) {
    assert.equal(codes.has(code), true, `الرمز ${code} بلا ضمانٍ مكتوبٍ في الوثيقة`);
  }
  for (const guarantee of POLICY.guarantees) {
    const file = path.join(process.cwd(), guarantee.enforcedBy);
    assert.equal(fs.existsSync(file), true, `ملفُّ إنفاذِ ${guarantee.code} غيرُ موجود`);
    assert.equal(
      fs.readFileSync(file, 'utf8').includes(guarantee.code),
      true,
      `الرمز ${guarantee.code} غيرُ حاضرٍ في ${guarantee.enforcedBy}`,
    );
  }
  for (const name of POLICY.readMethods) {
    assert.equal(WRITE_NAMES.includes(name), false, `النداءُ الكاتب ${name} مُعلَنٌ مقروءاً`);
  }
  // ووثيقةٌ تُعلن الكتابةَ قراءةً تُردّ عند التحميلِ لا تُقبل بتحذير.
  const forged = tempConfig((doc) => doc.replace('  - findById\n', '  - findById\n  - insert\n'));
  assert.throws(
    () => loadMonitoringPolicy({ dir: forged }),
    (/** @type {unknown} */ error) => codeOf(error) === MONITOR_ERRORS.CONFIG_INVALID,
  );
  // ومشهدان بمعرّفٍ واحدٍ يُردّان كذلك.
  const duplicated = tempConfig((doc) =>
    doc.replace(
      '  - id: institutions\n',
      '  - id: agents\n    registry: agentsTwin\n    entity: state.agents_twin\n    purpose: مشهدٌ مكرَّرٌ لقياسِ الردّ.\n\n  - id: institutions\n',
    ),
  );
  assert.throws(
    () => loadMonitoringPolicy({ dir: duplicated }),
    (/** @type {unknown} */ error) => codeOf(error) === MONITOR_ERRORS.CONFIG_INVALID,
  );
});

/** @typedef {'agents'} MonitorViewName */
