// العيب D1 — تجميدٌ سطحي يُعطي مناعةً كاذبة، في كل السجلات.
//
// كانت كل الوحدات تُرجع `Object.freeze({ ...record })`، والتجميد سطحيّ: الحقول
// المركّبة (‏`capabilities` و`lineage` و`evidence` والشهادة والحكم) تُنسخ
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
import { Court, LawRegistry } from '../../src/governance/law-system.mjs';
import { createMemoryRepository } from '../../src/persistence/repository-memory.mjs';
import { DataAccessGate } from '../../src/data/access-gate.mjs';
import { loadClassificationLattice } from '../../src/data/classification.mjs';
import { enforcementPointFor, testActor } from '../helpers/authorization.mjs';
import { createTestEncryptor } from '../helpers/encryption.mjs';

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

/** @returns {DataCatalog} */
function catalogSetup(log = new EventLog()) {
  return new DataCatalog({
    log,
    repository: createMemoryRepository(DataCatalog.spec),
    enforcementPoint: enforcementPointFor(log),
  });
}

/**
 * بوابة وصولٍ حقيقية: مخزن الذاكرة يرفض العمل بلا واحدة بعد `M7.02`، والمقيس في
 * هذا الملف هو التجميد العميق لا الإتاحة.
 * @param {EventLog} log
 * @param {DataCatalog} catalog
 * @returns {DataAccessGate}
 */
function accessGateFor(log, catalog) {
  return new DataAccessGate({
    log,
    catalog,
    lattice: loadClassificationLattice(),
    enforcementPoint: enforcementPointFor(log),
  });
}

/** @returns {LawRegistry} */
function lawSetup(log = new EventLog()) {
  return new LawRegistry({ log, repository: createMemoryRepository(LawRegistry.spec) });
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

test('D1 — سلسلة اشتقاق البيانات المُرجَعة لا تُعدَّل', async () => {
  const catalog = catalogSetup();
  const record = await catalog.register({
    name: 'جدول',
    owner: 'crown',
    source: 'seed',
    lineage: [{ from: 'seed' }],
  });
  // السلسلة هي ما يُبنى عليه التدقيق: نسبٌ يُعدَّل بعد التسجيل نسبٌ مكذوب.
  assert.throws(() => record.lineage.push({ from: 'مدسوس' }), TypeError);
  const inner = /** @type {Record<string, unknown>} */ (record.lineage[0]);
  assert.throws(
    () => {
      'use strict';
      inner.from = 'مبدَّل';
    },
    TypeError,
    'عنصر داخل السلسلة قابل للتعديل',
  );
  assert.deepEqual((await catalog.get(record.id))?.lineage, [{ from: 'seed' }]);
});

test('D1 — أدلة القضية المُرجَعة لا تُعدَّل بعد رفعها', () => {
  const log = new EventLog();
  const court = new Court({ log, laws: lawSetup(log) });
  const filed = court.file({
    claimant: 'وكيل-أ',
    respondent: 'وكيل-ب',
    claim: 'تجاوز صلاحية',
    evidence: [{ ref: 'حدث-1' }],
  });
  assert.throws(() => filed.evidence.push({ ref: 'دليل-مدسوس' }), TypeError);
  assert.equal(court.cases.get(filed.id)?.evidence.length, 1);
});

test('D1 — الحكم المُرجَع مُجمَّد فلا تُبدَّل نتيجته', () => {
  const log = new EventLog();
  const court = new Court({ log, laws: lawSetup(log) });
  const filed = court.file({ claimant: 'أ', respondent: 'ب', claim: 'دعوى' });
  court.hear(filed.id);
  const decided = court.decide(filed.id, { outcome: 'محكوم لصالح أ', reason: 'الدليل' });
  const judgment = /** @type {Record<string, unknown>} */ (
    /** @type {unknown} */ (decided.judgment)
  );
  assert.throws(
    () => {
      'use strict';
      judgment.outcome = 'محكوم لصالح ب';
    },
    TypeError,
    'نتيجة الحكم قابلة للتبديل',
  );
  assert.equal(court.cases.get(filed.id)?.judgment?.outcome, 'محكوم لصالح أ');
});

test('محتوى الذاكرة الذي يملكه المستدعي لا يُجمَّد عليه — حدٌّ معلن', async () => {
  const log = new EventLog();
  const catalog = catalogSetup(log);
  const memory = new AgentMemoryStore({
    catalog,
    log,
    repository: createMemoryRepository(AgentMemoryStore.spec),
    // البوابة لازمة للتذكّر والاستدعاء (`M7.02`)؛ والمقيس هنا التجميد لا الإتاحة.
    accessGate: accessGateFor(log, catalog),
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
