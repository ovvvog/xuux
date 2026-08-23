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

/** @returns {{ log: EventLog, agents: AgentRegistry }} */
function agentSetup() {
  const log = new EventLog();
  const king = new KingIdentity();
  const ca = new CertificateAuthority(king);
  return { log, agents: new AgentRegistry({ ca, log }) };
}

test('D1 — قدرات الوكيل المُرجَعة لا تشترك مع مصفوفة السجل', () => {
  const { agents } = agentSetup();
  const agent = agents.register({ name: 'وكيل', role: 'auditor', capabilities: ['read:log'] });
  assert.throws(() => agent.capabilities.push('sovereign:root'), TypeError);
  assert.deepEqual(agents.agents.get(agent.id)?.capabilities, ['read:log']);
});

test('D1 — شهادة الوكيل المُرجَعة مُجمَّدة ولا تُعدَّل قدراتها', () => {
  const { agents } = agentSetup();
  const agent = agents.register({ name: 'وكيل', role: 'auditor', capabilities: ['read:log'] });
  // الشهادة هي مستند التفويض؛ تسريبُها بالمرجع يعني ترقية دورٍ بيد المستدعي.
  assert.equal(Object.isFrozen(agent.certificate), true, 'الشهادة غير مُجمَّدة');
  assert.throws(() => agent.certificate.capabilities.push('key:export'), TypeError);
});

test('D1 — الصورة المُرجَعة من get وlist مُجمَّدة في العمق', () => {
  const { agents } = agentSetup();
  const agent = agents.register({ name: 'وكيل', role: 'auditor', capabilities: ['read:log'] });
  const fetched = agents.get(agent.id);
  assert.ok(fetched);
  assert.throws(() => fetched.capabilities.push('policy:self-modify'), TypeError);
  const listed = agents.list()[0];
  assert.ok(listed);
  assert.throws(() => listed.capabilities.push('policy:self-modify'), TypeError);
});

test('D1 — سلسلة اشتقاق البيانات المُرجَعة لا تُعدَّل', () => {
  const log = new EventLog();
  const catalog = new DataCatalog({ log });
  const record = catalog.register({
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
  assert.deepEqual(catalog.records.get(record.id)?.lineage, [{ from: 'seed' }]);
});

test('D1 — أدلة القضية المُرجَعة لا تُعدَّل بعد رفعها', () => {
  const log = new EventLog();
  const court = new Court({ log, laws: new LawRegistry({ log }) });
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
  const court = new Court({ log, laws: new LawRegistry({ log }) });
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

test('محتوى الذاكرة الذي يملكه المستدعي لا يُجمَّد عليه — حدٌّ معلن', () => {
  const log = new EventLog();
  const catalog = new DataCatalog({ log });
  const memory = new AgentMemoryStore({ catalog, log });
  const content = { note: 'أصل' };
  const entry = memory.remember('agent:1', content);
  // الصورة المُرجَعة مُجمَّدة، **وكائن المستدعي يبقى كما هو**: التجميد يقع على
  // نسخةٍ لا على ما يملكه غيرنا. فلو جُمِّد الأصل لعطّلنا كوداً لا نملكه.
  content.note = 'مُعدَّل';
  assert.equal(content.note, 'مُعدَّل', 'جُمِّد كائن المستدعي');
  const recalled = memory.recall('agent:1', entry.id);
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
