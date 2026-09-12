// العيب D1 — تجميدٌ سطحي يُعطي مناعةً كاذبة، في كل السجلات.
//
// كانت كل الوحدات تُرجع `Object.freeze({ ...record })`، والتجميد سطحيّ: الحقول
// المركّبة (‏`capabilities` وقيود النسب و`evidence` والشهادة والحكم) تُنسخ
// **بالمرجع** فتبقى مشتركة مع السجل الداخلي. فمن أخذ «صورة مُجمَّدة» قدر أن
// يدسّ في مصفوفتها، ودسُّه يقع في السجل نفسه — أي أن كل فحوص القدرات المحرَّمة
// عند التسجيل تُتجاوز **بعد** التسجيل.
//
// وهذا أخطر من مجرّد تسريب مرجع: التجميد الظاهر يُسكت الشكّ. من رأى
// `Object.isFrozen(record) === true` توقّف عن الحذر.
//
// التشغيل: node --test tests/core/immutability-gates.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CertificateAuthority, EventLog, KingIdentity } from '../../src/root-of-trust/index.mjs';
import { AgentRegistry } from '../../src/identity/agent-registry.mjs';
import { DataCatalog } from '../../src/data/data-catalog.mjs';
import { AgentMemoryStore } from '../../src/data/memory-store.mjs';
import { createMemoryRepository } from '../../src/persistence/repository-memory.mjs';
import { DataAccessGate } from '../../src/data/access-gate.mjs';
import { loadClassificationLattice } from '../../src/data/classification.mjs';
import { enforcementPointFor, testActor } from '../helpers/authorization.mjs';
import { judged, state as judiciaryState } from '../judiciary/harness.mjs';
import { createTestEncryptor } from '../helpers/encryption.mjs';
import { createTestLedger } from '../helpers/lineage.mjs';

// مغلِّفٌ واحد لهذا الملف على مجلد مفاتيح مؤقّت؛ يُنظَّف عند انتهاء الملف.
const fixture = await createTestEncryptor();
test.after(() => fixture.cleanup());

// بعد `M3.05` صارت السجلات على مستودعات، فمستودع الذاكرة هو ما يُختبر عليه ضابط
// `D1` هنا: التجميد العميق شرطٌ في **عقد المستودع** لا عادةٌ في صنفٍ واحد،
// ومستودع القاعدة يجري عليه نفس الشرط في `tests/persistence/contract.test.mjs`.
/** @returns {{ log: EventLog, agents: AgentRegistry }} */
function agentSetup() {
  const log = new EventLog();
  const king = new KingIdentity();
  const ca = new CertificateAuthority(king);
  return {
    log,
    agents: new AgentRegistry({ ca, log, repository: createMemoryRepository(AgentRegistry.spec) }),
  };
}

/**
 * الفهرس صار يرفض التسجيل بلا دفتر نسب (‏`M7.04`)، فالدفتر يُركَّب هنا كما يُركَّب
 * في التشغيل، ويُعاد معه ليُقاس تجميدُ قيوده.
 * @returns {{ catalog: DataCatalog, ledger: import('../../src/data/lineage.mjs').LineageLedger }}
 */
function catalogSetup(log = new EventLog()) {
  const repository = createMemoryRepository(DataCatalog.spec);
  const { ledger } = createTestLedger({ log, assets: repository });
  const catalog = new DataCatalog({
    log,
    repository,
    enforcementPoint: enforcementPointFor(log),
    lineage: ledger,
  });
  return { catalog, ledger };
}

/**
 * بوابة وصولٍ حقيقية: مخزن الذاكرة يرفض العمل بلا واحدة بعد `M7.02`، والمقيس في
 * هذا الملف هو التجميد العميق لا الإتاحة.
 * @param {EventLog} log
 * @param {DataCatalog} catalog
 * @param {import('../../src/data/lineage.mjs').LineageLedger} ledger
 * @returns {DataAccessGate}
 */
function accessGateFor(log, catalog, ledger) {
  return new DataAccessGate({
    log,
    catalog,
    lattice: loadClassificationLattice(),
    enforcementPoint: enforcementPointFor(log),
    // والدفتر لازم كذلك (`M7.04`): بوابةٌ بلا دفتر ترفض كل وصول.
    lineage: ledger,
  });
}

test('D1 — قدرات الوكيل المُرجَعة لا تشترك مع مصفوفة السجل', async () => {
  const { agents } = agentSetup();
  const agent = await agents.register({
    name: 'وكيل',
    role: 'auditor',
    capabilities: ['read:log'],
  });
  assert.throws(() => agent.capabilities.push('sovereign:root'), TypeError);
  assert.deepEqual((await agents.get(agent.id))?.capabilities, ['read:log']);
});

test('D1 — شهادة الوكيل المُرجَعة مُجمَّدة ولا تُعدَّل قدراتها', async () => {
  const { agents } = agentSetup();
  const agent = await agents.register({
    name: 'وكيل',
    role: 'auditor',
    capabilities: ['read:log'],
  });
  // الشهادة هي مستند التفويض؛ تسريبُها بالمرجع يعني ترقية دورٍ بيد المستدعي.
  assert.equal(Object.isFrozen(agent.certificate), true, 'الشهادة غير مُجمَّدة');
  assert.throws(() => agent.certificate.capabilities.push('key:export'), TypeError);
});

test('D1 — الصورة المُرجَعة من get وlist مُجمَّدة في العمق', async () => {
  const { agents } = agentSetup();
  const agent = await agents.register({
    name: 'وكيل',
    role: 'auditor',
    capabilities: ['read:log'],
  });
  const fetched = await agents.get(agent.id);
  assert.ok(fetched);
  assert.throws(() => fetched.capabilities.push('policy:self-modify'), TypeError);
  const listed = (await agents.list())[0];
  assert.ok(listed);
  assert.throws(() => listed.capabilities.push('policy:self-modify'), TypeError);
});

test('D1 — قيد نسب البيانات المُرجَع لا يُعدَّل', async () => {
  // كان المقيس هنا حقل `lineage` في سجل الأصل، وقد **أُلغي** في `M7.04`: كان
  // مصفوفةً حرّة يكتبها المُسجّل، فتجميدُها كان يحرس ادّعاءً لا نسباً. والمقيس
  // الآن قيدُ النسب نفسه — وهو ما يُبنى عليه التدقيق: نسبٌ يُعدَّل بعد كتابته روايةٌ.
  const { catalog, ledger } = catalogSetup();
  const root = await catalog.register({ name: 'جذر', owner: 'crown', source: 'seed' });
  const derived = await catalog.register({
    name: 'مشتقّ',
    owner: 'crown',
    source: 'transform',
    derivedFrom: [root.id],
  });
  const trace = await ledger.trace(derived.id);
  const entry = trace.entries.find((row) => row.kind === 'derivation');
  assert.ok(entry, 'قيد الاشتقاق لم يُكتب');
  assert.throws(() => entry.parents.push('data:مدسوس'), TypeError);
  assert.throws(
    () => {
      'use strict';
      /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (entry)).kind = 'read';
    },
    TypeError,
    'نوع القيد قابل للتعديل',
  );
  assert.deepEqual((await ledger.trace(derived.id)).edges, [
    { child: derived.id, parent: root.id },
  ]);
});

// وكان هنا اختبارانِ لـ`Court` في `src/governance/law-system.mjs` — قضاءٌ في
// الذاكرةِ لا ينادِيه مسارٌ إنتاجيٌّ، حُذِف في الفجوةِ الثالثةِ من الأمرِ التنفيذيِّ.
// فنُقِل القياسُ إلى القضاءِ النافذِ (`src/judiciary/`) لأنّ ضابطَ `D1` يُشترى على
// السطحِ الذي يُنادى فعلاً: صفٌّ يُعادُ من المستودعِ مُجمَّداً، ومحاولةُ تبديلِ
// حكمِه لا تمسُّ ما في المستودع.
test('D1 — صفُّ القضيةِ المُعادُ من القضاءِ النافذِ مُجمَّدٌ فلا يُبدَّل حكمُه', async () => {
  const s = judiciaryState();
  const { caseId } = await judged(s);
  const row = await s.judiciary.repository.findById(caseId);
  assert.ok(row, 'القضيةُ لم تُقرأ من المستودع');
  assert.equal(Object.isFrozen(row), true, 'الصفُّ المُعادُ غيرُ مُجمَّد');
  assert.throws(
    () => {
      'use strict';
      /** @type {Record<string, unknown>} */ (row)['verdict'] = 'innocent';
    },
    TypeError,
    'نتيجةُ الحكمِ قابلةٌ للتبديلِ في الصفِّ المُعاد',
  );
  assert.equal((await s.judiciary.repository.findById(caseId))?.['verdict'], row['verdict']);
});

test('محتوى الذاكرة الذي يملكه المستدعي لا يُجمَّد عليه — حدٌّ معلن', async () => {
  const log = new EventLog();
  const { catalog, ledger } = catalogSetup(log);
  const memory = new AgentMemoryStore({
    catalog,
    log,
    repository: createMemoryRepository(AgentMemoryStore.spec),
    // البوابة لازمة للتذكّر والاستدعاء (`M7.02`)؛ والمقيس هنا التجميد لا الإتاحة.
    accessGate: accessGateFor(log, catalog, ledger),
    // والمغلِّف لازم كذلك (`M7.03`). والتجميد يبقى مقيساً على المادة **بعد الفكّ**:
    // لو رجع الفكّ كائناً غير مُجمَّد لصار المستدعي يعدّل ما استُدعي.
    encryptor: fixture.encryptor,
  });
  const actor = testActor('role:agent', { id: 'agent:1' });
  const content = { note: 'أصل' };
  const entry = await memory.remember('agent:1', content, { actor });
  // الصورة المُرجَعة مُجمَّدة، **وكائن المستدعي يبقى كما هو**: التجميد يقع على
  // نسخةٍ لا على ما يملكه غيرنا. فلو جُمِّد الأصل لعطّلنا كوداً لا نملكه.
  content.note = 'مُعدَّل';
  assert.equal(content.note, 'مُعدَّل', 'جُمِّد كائن المستدعي');
  const recalled = await memory.recall({ id: entry.id, actor });
  const stored = /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (recalled.content));
  assert.equal(stored.note, 'أصل', 'المخزون تبع تعديلاً لاحقاً على كائن المستدعي');
  assert.throws(
    () => {
      'use strict';
      stored.note = 'دسّ';
    },
    TypeError,
    'المخزون المُرجَع قابل للتعديل',
  );
});
