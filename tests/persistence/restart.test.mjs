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
import { enforcementPointFor, testActor } from '../helpers/authorization.mjs';
import { registerEvaluationExperiment } from '../helpers/experiment-support.mjs';

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

      // نقطة التفويض تُمرَّر لأن الوصول إلى البيانات صار يمرّ ببوابةٍ تُقيّم السياسة
      // (`M7.02`): سجلاتٌ بلا نقطة تفويض ترفض كل قراءة وكتابة، والمقيس هنا النجاة
      // من إعادة التشغيل لا التركيب الناقص.
      const beforeLog = new EventLog();
      const before = createRegistries({
        ca,
        log: beforeLog,
        repositories: createPostgresRepositories(created.pool),
        enforcementPoint: enforcementPointFor(beforeLog),
      });
      // مشغّلٌ تخليصه «internal»: يكتب ذاكرةً داخلية بلا كتابةٍ إلى الأسفل.
      const operator = testActor('role:operator');

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
      before.models.evaluationLedger.record({
        modelId: model.id,
        fingerprint: model.fingerprint,
        evaluatedBy: 'role:minister',
        experimentId: registerEvaluationExperiment(before.models.evaluationLedger, {
          modelId: model.id,
          fingerprint: model.fingerprint,
        }),
        results: [
          { checkId: 'safety', score: 1 },
          { checkId: 'quality', score: 1 },
        ],
      });
      await before.models.activate(model.id);
      const dataset = await before.catalog.register({
        name: 'سجل-ملكي',
        owner: 'crown',
        classification: 'sovereign',
        source: 'crown',
        retentionDays: 3650,
      });
      await before.catalog.markQuality(dataset.id, 'verified');
      const memory = await before.memory.remember(
        agent.id,
        { note: 'ما يجب أن يبقى' },
        { actor: operator },
      );
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
      const afterLog = new EventLog();
      const after = createRegistries({
        ca,
        log: afterLog,
        repositories: createPostgresRepositories(second),
        enforcementPoint: enforcementPointFor(afterLog),
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
      // النسب لم يعد حقلاً في السجل (`M7.04`) بل صفوفاً في `state.data_lineage`:
      // فالمقيس أن **السلسلة** نجت من إعادة التشغيل وأن تجزئتها ما زالت متّصلة —
      // نسبٌ يُنسى بإعادة التشغيل لا يُجيب عن «من أين جاء هذا الأصل» بعد أول إقلاع.
      const tracedAfter = await after.lineage.trace(dataset.id);
      assert.equal(tracedAfter.origins.length, 1, 'قيد الأصل لم ينجُ من إعادة التشغيل');
      assert.equal(tracedAfter.origins[0]?.actorId, 'crown');
      assert.ok(
        tracedAfter.reads.length >= 1,
        'قراءةٌ وقعت قبل إعادة التشغيل ولم يبقَ لها قيد نسب',
      );
      assert.equal((await after.lineage.verify()).ok, true, 'سلسلة النسب انكسرت بعد الإقلاع');
      // التصنيف نجا من إعادة التشغيل ⇒ بوابة الوصول ترفض قراءته بتخليصٍ أدنى.
      // القرار صار في البوابة لا في الفهرس (`M7.02`)، والمقيس أن **البيانات**
      // المستعادة هي ما يبني الرفض.
      await assert.rejects(
        () =>
          after.accessGate.read({
            actor: operator,
            assetId: dataset.id,
            reader: () => 'مادة سيادية',
          }),
        /تخليص/,
        'التصنيف السيادي ضاع فصار يُقرأ بتخليصٍ أدنى',
      );

      const recalled = await after.memory.recall({ id: memory.id, actor: operator });
      assert.deepEqual(recalled.content, { note: 'ما يجب أن يبقى' });
      assert.equal(recalled.datasetId, memory.datasetId);
      await assert.rejects(
        () => after.memory.recall({ id: memory.id, agentId: 'agent:غريب', actor: operator }),
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
