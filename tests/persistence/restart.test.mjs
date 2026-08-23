// إعادة تشغيل كاملة ⇒ استرجاع الحالة بلا خسارة — الخطوة `M3.05` وشرط البوابة `G3`.
//
// هذا هو الاختبار الذي يجعل «صارت السجلات دائمة» قولاً قابلاً للتكذيب: تُبنى
// السجلات على قاعدة حقيقية، وتُكتب فيها حالة كاملة (وكيل بشهادته، نموذج معتمد
// ومُفعَّل، عقد بيانات، ذاكرة، قانون نافذ)، ثم **يُقطع المجمّع وتُهدم كل
// الكائنات** — وهذا أقرب ما يمكن محاكاته لإعادة تشغيل العملية — ثم تُبنى
// السجلات من جديد على نفس القاعدة وتُقرأ الحالة.
//
// ولا يكفي أن تُقرأ المعرّفات: الشهادة تُتحقّق صلاحيتها بعد إعادة البناء، لأن
// وكيلاً يعود بلا شهادةٍ صالحة وكيلٌ بلا إثبات تصريح.
//
// التشغيل: DATABASE_URL=... node --test tests/persistence/restart.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { CertificateAuthority, EventLog, KingIdentity } from '../../src/root-of-trust/index.mjs';
import { ModelState } from '../../src/models/model-registry.mjs';
import { LawState } from '../../src/governance/law-system.mjs';
import { AgentState } from '../../src/identity/agent-registry.mjs';
import {
  createPostgresRepositories,
  createRegistries,
} from '../../src/persistence/composition.mjs';
import { up } from '../../src/persistence/migrator.mjs';
import { createIsolatedDatabase, databaseUrl, skipWithoutDatabase } from '../helpers/pg.mjs';

/**
 * مجمّع جديد على نفس القاعدة — يمثّل عمليةً جديدة لا تعرف شيئاً عن سابقتها.
 * @param {string} name
 * @returns {import('pg').Pool}
 */
function reconnect(name) {
  const url = databaseUrl();
  if (url === undefined) throw new Error('DATABASE_URL غير معلَنة.');
  const target = new URL(url);
  target.pathname = `/${name}`;
  const pool = new pg.Pool({ connectionString: target.toString(), max: 4 });
  pool.on('error', (error) => {
    console.warn(`[تنبيه] اتصال ساكن انقطع: ${error.message}`);
  });
  return pool;
}

test(
  'إعادة تشغيل كاملة لا تفقد أي حالة من السجلات الخمس',
  { skip: skipWithoutDatabase },
  async () => {
    const created = await createIsolatedDatabase('restart');
    /** @type {import('pg').Pool | null} */
    let second = null;
    try {
      await up(created.pool);

      // التاج نفسه ليس في القاعدة (جذر الثقة موضعه `M4`)، فيُثبَّت هنا كي تكون
      // صلاحية الشهادة قابلة للتحقّق بعد إعادة البناء بنفس السلطة.
      const king = new KingIdentity();
      const ca = new CertificateAuthority(king);

      const before = createRegistries({
        ca,
        log: new EventLog(),
        repositories: createPostgresRepositories(created.pool),
      });

      const agent = await before.agents.register({
        name: 'مدقّق-الاستمرارية',
        role: 'auditor',
        owner: 'crown',
        capabilities: ['read:log'],
      });
      const model = await before.models.register({
        name: 'مدقّق',
        modelVersion: '1.0.0',
        purpose: 'audit',
        provider: 'internal',
        weights: 'w-1',
        capabilities: ['read:data'],
      });
      await before.models.transition(model.id, ModelState.SANDBOXED, 'اختبار معزول');
      await before.models.transition(model.id, ModelState.APPROVED, 'اعتماد');
      await before.models.activate(model.id);
      const dataset = await before.catalog.register({
        name: 'سجل-ملكي',
        owner: 'crown',
        classification: 'sovereign',
        source: 'crown',
        lineage: [{ from: 'command' }],
        retentionDays: 3650,
      });
      await before.catalog.markQuality(dataset.id, 'verified');
      const memory = await before.memory.remember(agent.id, { note: 'ما يجب أن يبقى' });
      const law = await before.laws.propose({
        title: 'استمرارية الحالة',
        text: 'ما لا يبقى بعد إعادة التشغيل لا يُحكم به',
        scope: 'operations',
        proposer: 'council',
      });
      await before.laws.transition(law.id, LawState.ENACTED, 'crown');

      // إعادة التشغيل: ينقطع المجمّع وتُهدم كل كائنات السجلات. ما بعد هذا السطر
      // لا يقرأ شيئاً من ذاكرة العملية السابقة إلا المعرّفات التي نتحقّق منها.
      await created.pool.end();
      second = reconnect(created.name);
      const after = createRegistries({
        ca,
        log: new EventLog(),
        repositories: createPostgresRepositories(second),
      });

      const recoveredAgent = await after.agents.get(agent.id);
      assert.ok(recoveredAgent, 'الوكيل لم يعد بعد إعادة التشغيل');
      assert.equal(recoveredAgent.state, AgentState.ACTIVE);
      assert.equal(recoveredAgent.role, 'auditor');
      assert.equal(recoveredAgent.owner, 'crown');
      assert.deepEqual(recoveredAgent.capabilities, ['read:log']);
      assert.equal(
        ca.isValid(recoveredAgent.certificate),
        true,
        'الشهادة لم تعد صالحة بعد إعادة التشغيل',
      );
      assert.deepEqual(
        (await after.agents.list(AgentState.ACTIVE)).map((x) => x.id),
        [agent.id],
      );

      const recoveredActive = await after.models.getActive('audit');
      assert.ok(recoveredActive, 'النموذج النشط لغرضه لم يعد');
      assert.equal(recoveredActive.id, model.id);
      assert.equal(recoveredActive.state, ModelState.APPROVED);
      assert.equal(recoveredActive.approvedBy, 'crown');
      assert.equal(recoveredActive.modelVersion, '1.0.0');
      assert.equal(
        await after.models.verifyWeights(model.id, 'w-1'),
        true,
        'بصمة الأوزان لم تنجُ من إعادة التشغيل',
      );

      const recoveredDataset = await after.catalog.get(dataset.id);
      assert.ok(recoveredDataset, 'عقد البيانات لم يعد');
      assert.equal(recoveredDataset.classification, 'sovereign');
      assert.equal(recoveredDataset.quality, 'verified');
      assert.deepEqual(recoveredDataset.lineage, [{ from: 'command' }]);
      await assert.rejects(
        () => after.catalog.canRead(dataset.id, agent.id, 'internal'),
        /DATA_ACCESS_DENIED/,
        'التصنيف السيادي ضاع فصار يُقرأ بتصريح أدنى',
      );

      const recalled = await after.memory.recall(agent.id, memory.id, 'sovereign');
      assert.deepEqual(recalled.content, { note: 'ما يجب أن يبقى' });
      assert.equal(recalled.datasetId, memory.datasetId);
      await assert.rejects(
        () => after.memory.recall('agent:غريب', memory.id, 'sovereign'),
        /MEMORY_NOT_FOUND/,
        'عزل الذاكرة بالهوية ضاع بعد إعادة التشغيل',
      );

      const enacted = await after.laws.active('operations');
      assert.equal(enacted.length, 1);
      assert.equal(enacted[0]?.id, law.id);
      assert.equal(enacted[0]?.enactedBy, 'crown');
      assert.ok(enacted[0]?.enactedAt instanceof Date, 'وقت النفاذ ضاع');
    } finally {
      if (second !== null) await second.end();
      await created.drop();
    }
  },
);

test('الحصص تُقرأ من القاعدة لا من عدّاد في الذاكرة', { skip: skipWithoutDatabase }, async () => {
  // حصّةٌ محفوظة في عدّاد داخلي تُصفَّر بإعادة التشغيل، فتُتجاوز بإعادة تشغيل
  // لا أكثر. هذا الاختبار يمنع رجوع ذلك العيب.
  const created = await createIsolatedDatabase('quota');
  /** @type {import('pg').Pool | null} */
  let second = null;
  try {
    await up(created.pool);
    const ca = new CertificateAuthority(new KingIdentity());
    const first = createRegistries({
      ca,
      log: new EventLog(),
      repositories: createPostgresRepositories(created.pool),
      limits: { maxAgents: 1 },
    });
    await first.agents.register({ name: 'الأول', role: 'observer' });
    await created.pool.end();

    second = reconnect(created.name);
    const restarted = createRegistries({
      ca,
      log: new EventLog(),
      repositories: createPostgresRepositories(second),
      limits: { maxAgents: 1 },
    });
    await assert.rejects(
      () => restarted.agents.register({ name: 'الثاني', role: 'observer' }),
      /AGENT_QUOTA_EXCEEDED/,
      'الحصّة صُفِّرت بإعادة التشغيل',
    );
  } finally {
    if (second !== null) await second.end();
    await created.drop();
  }
});
