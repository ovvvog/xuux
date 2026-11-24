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
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
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
import { createBackup } from '../../scripts/backup.mjs';
import { restoreBackup } from '../../scripts/restore.mjs';
import { createIsolatedDatabase, databaseUrl, skipWithoutDatabase } from '../helpers/pg.mjs';
import { BINDABLE_TEXT, enactLawThroughCrown } from '../helpers/legislation.mjs';
import { createTestEncryptor } from '../helpers/encryption.mjs';
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
    // مزوّدُ المفاتيح **واحدٌ قبل الانقطاع وبعده**: الذاكرة صارت مغلَّفةً
    // (`M7.03`) و`remember` يرفض بلا مغلِّف بـ`MEMORY_ENCRYPTOR_REQUIRED`. ومزوّدٌ
    // جديدٌ بعد الإقلاع يعني مفتاحاً جديداً لا يفكّ ما كُتب — وذاك ليس «إعادة
    // تشغيل» بل فقدُ مفاتيح. فمادةُ المفاتيح تنجو كما تنجو القاعدة، وهو ما
    // يجعل المقيسَ نجاةَ الحالة لا نجاةَ الشكل (`WL-045`).
    const encryption = await createTestEncryptor();
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
        keyProvider: encryption.keyProvider,
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
      // **قراءةٌ فعليةٌ قبل الانقطاع.** الاختبارُ يدّعي بعد الإقلاع أن «قراءةً
      // وقعت قبل إعادة التشغيل ولم يبقَ لها قيد نسب» دعوى منتفية — ولم تكن قبل
      // `WL-045` أيُّ قراءةٍ تقع أصلاً، فالدعوى كانت تُقاس على فراغٍ ولا تصدُق
      // أبداً. والقارئُ ملكٌ لأن العقدَ سياديّ: قارئٌ أدنى تخليصاً يُرفض، ورفضٌ
      // ليس قراءةً تُترك لها قيد نسب.
      const sovereignReader = testActor('role:king');
      await before.accessGate.read({
        actor: sovereignReader,
        assetId: dataset.id,
        reader: () => 'مادة سيادية',
      });
      const memory = await before.memory.remember(
        agent.id,
        { note: 'ما يجب أن يبقى' },
        { actor: operator },
      );
      const law = await before.laws.propose({
        title: 'استمرارية الحالة',
        // النصُّ يبلغ الحدَّ الأدنى المُعلَن للربط: قانونٌ أقصرُ منه لا يُنفَّذ.
        text: BINDABLE_TEXT,
        scope: 'operations',
        proposer: 'council',
      });
      // النفاذُ يمرّ بالسلطةِ التشريعيةِ بأمرٍ ملكيٍّ موقَّع (`M8.02`) لا
      // بـ`transition(…, 'crown')`: ذاك مقارنةُ نصٍّ لا سلطة، ويرفضه المسارُ
      // الآن بـ`LAW_ENACTMENT_PATH_REQUIRED`. وكان هذا الاختبارُ يستعمله فيُخفق
      // من يومِ `M8.02` — لم يظهر لأنه متخطّىً بغياب `DATABASE_URL` (`WL-045`).
      await before.laws.transition(law.id, LawState.PROPOSED, 'council');
      await enactLawThroughCrown({ laws: before.laws, log: beforeLog, lawId: law.id });

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
        keyProvider: encryption.keyProvider,
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
      encryption.cleanup();
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

// ‏نُقلتا حرفيّاً من `data-preservation.test.mjs` (‏`WL-608`، أصلُهما `atomicity.test.mjs`): حالتا `cancel` بقيتا هناك،
// والأربعُ معاً تجاوزت مهلةَ الملفِّ 120 ث على CI. لا مهلةَ رُفِعت ولا توكيدَ تغيّر؛ والمساعداتُ نسخٌ حرفيّة.

/** وصلةُ الإدارة (‏superuser الاختبار). */
function l78AdminUrl() {
  return /** @type {string} */ (databaseUrl());
}

/** @param {string} name */
function l78Url(name) {
  const url = new URL(/** @type {string} */ (process.env.DATABASE_URL));
  url.pathname = `/${name}`;
  return url.toString();
}

// ─── ‏`WL-606`: فشلُ حسابِ البصمةِ وانقطاعُ الاتصالِ أثناءَه — في النسخِ وفي الاستعادة ───
//
// الحقن: جلسةٌ مراقِبةٌ تنتظرُ استعلامَ تجزئةِ الصفوفِ في `pg_stat_activity` للقاعدةِ المعنيّة، ثمّ
// ‏`pg_cancel_backend` (‏فشلُ حسابٍ: `57014`) أو `pg_terminate_backend` (‏انقطاعُ اتصال). الجدولُ كبيرٌ
// (‏200 ألفِ صفّ) كي يطولَ الاستعلامُ بما يكفي للمراقبة؛ **والاختبارُ يؤكّدُ أنّ الحقنَ وقع** وإلا سقط.

// ‏الجدولُ الكبيرُ وحدَه (‏`state.laws`، 200 ألفِ صفّ): استعلامُ بصمةٍ لجدولٍ صغيرٍ ينتهي بينَ قراءةِ
// `pg_stat_activity` ووصولِ الإلغاء، فيقعُ الإلغاءُ على جلسةٍ خاملةٍ ويُهمَل والنسخُ ينجح (‏سقوطٌ في CI على
// `wl-606`: «الحقنُ وقع» و`BACKUP_CREATED`). الإنهاءُ لا يتأثّرُ لأنّه يقتلُ الجلسةَ أيّاً كان استعلامُها.
const L78_DIGEST_QUERY = '%convert_to(t::text%"state"."laws" AS t%';

/**
 * @param {string} database
 * @param {'cancel' | 'terminate'} mode
 * @returns {{ done: Promise<number>, stop: () => void }} عددُ الجلساتِ المقطوعة.
 */
function l78InterruptDigest(database, mode) {
  const watcher = new pg.Pool({ connectionString: l78AdminUrl(), max: 1 });
  let stopped = false;
  const done = (async () => {
    try {
      const deadline = Date.now() + 60_000;
      while (!stopped && Date.now() < deadline) {
        const hit = await watcher.query(
          `SELECT pid, ${mode === 'cancel' ? 'pg_cancel_backend' : 'pg_terminate_backend'}(pid) AS ok
             FROM pg_stat_activity
            WHERE datname = $1 AND state = 'active' AND query LIKE $2 AND pid <> pg_backend_pid()`,
          [database, L78_DIGEST_QUERY],
        );
        if (hit.rowCount !== null && hit.rowCount > 0) return hit.rowCount;
        await new Promise((resolve) => setTimeout(resolve, 3));
      }
      return 0;
    } finally {
      await watcher.end();
    }
  })();
  return { done, stop: () => (stopped = true) };
}

/** مصدرٌ مُهاجَرٌ كبيرٌ بما يكفي لمراقبةِ استعلامِ البصمة. */
async function l78LargeSource(/** @type {string} */ label) {
  const source = await createIsolatedDatabase(label);
  await up(source.pool);
  await source.pool.query(
    `INSERT INTO state.laws (id, title, body, status, scope, proposer)
     SELECT 'law-' || lpad(g::text, 7, '0'), 'عنوان ' || g, repeat('نصّ ', 8) || g, 'draft', 'testing', 'agent-001'
       FROM generate_series(1, 200000) g`,
  );
  return source;
}

for (const mode of /** @type {('cancel' | 'terminate')[]} */ (['terminate'])) {
  test(
    `WL-606: ${mode === 'cancel' ? 'فشلُ حسابِ' : 'انقطاعُ الاتصالِ أثناءَ حسابِ'} البصمةِ في النسخ ⇒ BACKUP_DIGEST_FAILED بلا أرشيفٍ ولا بيانٍ ولا جدولٍ مرحليّ`,
    { skip: skipWithoutDatabase, timeout: 120_000 },
    async () => {
      const source = await l78LargeSource(`l78dgb${mode.slice(0, 4)}`);
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'l78-digest-backup-'));
      const dump = path.join(dir, 'state.dump');
      try {
        const interrupt = l78InterruptDigest(source.name, mode);
        const outcome = await createBackup(dump, l78Url(source.name)).then(
          () => 'BACKUP_CREATED',
          (/** @type {any} */ error) => error,
        );
        interrupt.stop();
        assert.ok((await interrupt.done) > 0, 'الحقنُ لم يقع — الاختبارُ لا يقيس');
        assert.equal(outcome?.code, 'BACKUP_DIGEST_FAILED', String(outcome?.message ?? outcome));
        assert.equal(fs.existsSync(dump), false, 'كُتبَ أرشيفٌ رغمَ فشلِ البصمة');
        assert.equal(fs.existsSync(`${dump}.manifest.json`), false, 'كُتبَ بيانٌ رغمَ فشلِ البصمة');
        const staging = await source.pool.query(
          `SELECT count(*)::int AS n FROM pg_class c JOIN pg_namespace s ON s.oid = c.relnamespace
            WHERE s.nspname = 'state' AND c.relname LIKE '\\_\\_backup\\_%'`,
        );
        assert.equal(staging.rows[0].n, 0, 'بقيَ جدولٌ مرحليٌّ في المصدر');
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
        await source.drop();
      }
    },
  );

  test(
    `WL-606: ${mode === 'cancel' ? 'فشلُ حسابِ' : 'انقطاعُ الاتصالِ أثناءَ حسابِ'} البصمةِ بعدَ الاستعادة ⇒ RESTORE_CONTENT_CHECK_FAILED، لا RESTORE_OK والدفترُ غيرُ مُركَّب`,
    { skip: skipWithoutDatabase, timeout: 120_000 },
    async () => {
      const source = await l78LargeSource(`l78dgr${mode.slice(0, 4)}`);
      const target = await createIsolatedDatabase(`l78dgr${mode.slice(0, 4)}t`);
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'l78-digest-restore-'));
      const dump = path.join(dir, 'state.dump');
      try {
        await createBackup(dump, l78Url(source.name));
        const interrupt = l78InterruptDigest(target.name, mode);
        const outcome = await restoreBackup(
          { dumpPath: dump, database: target.name, force: false },
          l78AdminUrl(),
        ).then(
          () => 'RESTORE_OK',
          (/** @type {any} */ error) => error,
        );
        interrupt.stop();
        assert.ok((await interrupt.done) > 0, 'الحقنُ لم يقع — الاختبارُ لا يقيس');
        assert.notEqual(outcome, 'RESTORE_OK');
        assert.equal(
          outcome?.code,
          'RESTORE_CONTENT_CHECK_FAILED',
          String(outcome?.message ?? outcome),
        );
        assert.match(
          String(outcome?.message),
          mode === 'cancel' ? /57014/ : /terminat|57P01|Connection/i,
        );
        const ledger = await target.pool.query(
          `SELECT to_regclass('public.schema_migrations') IS NULL AS absent`,
        );
        assert.equal(ledger.rows[0].absent, true, 'رُكِّبَ دفترُ الهجراتِ رغمَ فشلِ التحقّق');
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
        await target.drop();
        await source.drop();
      }
    },
  );
}
