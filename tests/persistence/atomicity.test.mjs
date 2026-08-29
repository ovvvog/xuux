// ذرّية العمليات المركّبة — الخطوة `M3.06`.
//
// الدعوى المُختبَرة: العملية التي تكتب في أكثر من جدول إمّا أن تتم كلها أو لا
// يبقى منها أثر. وإثباتُها لا يكون بمسار سعيد، بل بإخفاقٍ **بين** الكتابتين ثم
// فحصٍ للقاعدة من وصلةٍ أخرى: أي صفٍّ باقٍ من عملية أخفقت هو دليل نقض.
//
// وفيه أيضاً اختبار «الفرق»: نفس العملية بلا معاملة تُبقي أثراً جزئياً. وُضع
// لأن اختباراً يمرّ في الحالتين لا يُثبت شيئاً عن المعاملة.
//
// التشغيل: DATABASE_URL=... node --test tests/persistence/atomicity.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CertificateAuthority, EventLog, KingIdentity } from '../../src/root-of-trust/index.mjs';
import { ModelState } from '../../src/models/model-registry.mjs';
import {
  createPostgresRegistries,
  createPostgresRepositories,
  createRegistries,
} from '../../src/persistence/composition.mjs';
import { withUnitOfWork } from '../../src/persistence/unit-of-work.mjs';
import { up } from '../../src/persistence/migrator.mjs';
import { createIsolatedDatabase, skipWithoutDatabase } from '../helpers/pg.mjs';
import { enforcementPointFor, testActor } from '../helpers/authorization.mjs';
import { registerEvaluationExperiment } from '../helpers/experiment-support.mjs';
import { createTestEncryptor } from '../helpers/encryption.mjs';

/**
 * @param {import('pg').Pool} pool
 * @param {string} table
 * @returns {Promise<number>}
 */
async function countRows(pool, table) {
  const result = await pool.query(`SELECT count(*)::int AS n FROM state.${table}`);
  return Number(result.rows[0]?.n ?? -1);
}

/** @returns {CertificateAuthority} */
function authority() {
  return new CertificateAuthority(new KingIdentity());
}

test(
  'إخفاق في منتصف «تذكّر» لا يُبقي عقد بيانات يتيماً',
  { skip: skipWithoutDatabase },
  async () => {
    const encryption = await createTestEncryptor();
    // مزوّد المفاتيح يُمرَّر: `remember` صار يشترط مغلِّفاً (`M7.03`) ويرفض
    // بـ`MEMORY_ENCRYPTOR_REQUIRED` **قبل** أي كتابة. وبلا مزوّدٍ كان الاختبار
    // يقيس رفضاً سابقاً للكتابتين لا إخفاقاً بينهما — أي لا يقيس الذرّية أصلاً.
    // لم يظهر لأن اختبارات القاعدة كانت متخطّاةً دائماً (`WL-045`).
    const created = await createIsolatedDatabase('atomic');
    try {
      await up(created.pool);
      // نقطة التفويض تُمرَّر كي يصل الطلب إلى الكتابة أصلاً: بلا بوابةٍ مُفوَّضة
      // يُرفض «تذكّر» قبل أي كتابة، فلا يبقى إخفاقٌ **بين** الكتابتين ليُقاس.
      const log = new EventLog();
      const registries = createPostgresRegistries({
        pool: created.pool,
        ca: authority(),
        log,
        enforcementPoint: enforcementPointFor(log),
        keyProvider: encryption.keyProvider,
      });
      const operator = testActor('role:operator');
      const agent = await registries.agents.register({ name: 'وكيل-ذرّي', role: 'auditor' });

      // نوع ذاكرة خارج القيم المُعلنة: يُرفض عند كتابة **الذاكرة** أي بعد كتابة
      // عقد البيانات. فهذا إخفاق واقع بين الكتابتين لا محاكاةً مصطنعة له.
      await assert.rejects(
        () =>
          registries.memory.remember(
            agent.id,
            { note: 'لا ينبغي أن يبقى' },
            {
              kind: /** @type {'episodic'} */ (/** @type {unknown} */ ('نوع-غير-معلن')),
              actor: operator,
            },
          ),
        /REPOSITORY_INVALID_RECORD|FIELD_ENUM/,
      );

      assert.equal(await countRows(created.pool, 'memories'), 0, 'ذاكرة كُتبت رغم الإخفاق');
      assert.equal(
        await countRows(created.pool, 'data_assets'),
        0,
        'عقد بيانات يتيم بقي بعد إخفاق «تذكّر»',
      );
    } finally {
      await created.drop();
      encryption.cleanup();
    }
  },
);

test(
  'بلا معاملة يبقى الأثر الجزئي — الفرق الذي تصنعه وحدة العمل',
  { skip: skipWithoutDatabase },
  async () => {
    const encryption = await createTestEncryptor();
    // مزوّد المفاتيح يُمرَّر: `remember` صار يشترط مغلِّفاً (`M7.03`) ويرفض
    // بـ`MEMORY_ENCRYPTOR_REQUIRED` **قبل** أي كتابة. وبلا مزوّدٍ كان الاختبار
    // يقيس رفضاً سابقاً للكتابتين لا إخفاقاً بينهما — أي لا يقيس الذرّية أصلاً.
    // لم يظهر لأن اختبارات القاعدة كانت متخطّاةً دائماً (`WL-045`).
    const created = await createIsolatedDatabase('nonatomic');
    try {
      await up(created.pool);
      // نفس المستودعات، بلا مُشغّل معاملة: هذا هو ما كان عليه الحال قبل `M3.06`.
      const log = new EventLog();
      const registries = createRegistries({
        ca: authority(),
        log,
        repositories: createPostgresRepositories(created.pool),
        enforcementPoint: enforcementPointFor(log),
        keyProvider: encryption.keyProvider,
      });
      const operator = testActor('role:operator');
      const agent = await registries.agents.register({ name: 'وكيل-غير-ذرّي', role: 'auditor' });
      await assert.rejects(() =>
        registries.memory.remember(
          agent.id,
          { note: 'أثر جزئي' },
          {
            kind: /** @type {'episodic'} */ (/** @type {unknown} */ ('نوع-غير-معلن')),
            actor: operator,
          },
        ),
      );
      assert.equal(await countRows(created.pool, 'memories'), 0);
      assert.equal(
        await countRows(created.pool, 'data_assets'),
        1,
        'لو صار هذا صفراً فالاختبار السابق لم يُثبت شيئاً عن المعاملة',
      );
    } finally {
      await created.drop();
      encryption.cleanup();
    }
  },
);

test(
  'إخفاق بعد إسقاط النشط السابق لا يترك الغرض بلا نشط',
  { skip: skipWithoutDatabase },
  async () => {
    const created = await createIsolatedDatabase('activate');
    try {
      await up(created.pool);
      const ca = authority();
      const log = new EventLog();
      const registries = createPostgresRegistries({ pool: created.pool, ca, log });

      /**
       * @param {string} name
       * @param {string} version
       * @param {string} weights
       */
      const approved = async (name, version, weights) => {
        const model = await registries.models.register({
          name,
          modelVersion: version,
          purpose: 'audit',
          provider: 'internal',
          weights,
        });
        await registries.models.transition(model.id, ModelState.SANDBOXED, 'اختبار معزول');
        await registries.models.transition(model.id, ModelState.APPROVED, 'اعتماد');
        registries.models.evaluationLedger.record({
          modelId: model.id,
          fingerprint: model.fingerprint,
          evaluatedBy: 'role:minister',
          experimentId: registerEvaluationExperiment(registries.models.evaluationLedger, {
            modelId: model.id,
            fingerprint: model.fingerprint,
          }),
          results: [
            { checkId: 'safety', score: 1 },
            { checkId: 'quality', score: 1 },
          ],
        });
        return model;
      };

      const first = await approved('أول', '1.0.0', 'w-1');
      const second = await approved('ثانٍ', '2.0.0', 'w-2');
      await registries.models.activate(first.id);
      assert.equal((await registries.models.getActive('audit'))?.id, first.id);

      // إخفاقٌ مُقحَم **بين** الكتابتين: أُسقط النشط السابق ثم يُرفع خطأ قبل رفع
      // الجديد. بلا معاملة يبقى الغرض بلا نشط؛ ومعها يعود الأول نشطاً كما كان.
      await assert.rejects(
        () =>
          withUnitOfWork(created.pool, async (repositories) => {
            const inner = createRegistries({ ca, log, repositories });
            const previous = await inner.models.getActive('audit');
            assert.ok(previous);
            await repositories.models.update(previous.id, previous.version, { isActive: false });
            throw new Error('انقطاع مُقحَم بين الكتابتين');
          }),
        /انقطاع مُقحَم/,
      );

      const stillActive = await registries.models.getActive('audit');
      assert.equal(stillActive?.id, first.id, 'الغرض بقي بلا نشط بعد إخفاق التفعيل');
      assert.ok(second.id, 'النموذج الثاني مسجَّل ولم يُفعَّل');
    } finally {
      await created.drop();
    }
  },
);

test(
  'وحدة العمل تشمل أكثر من سجل: تراجعٌ واحد لكل ما كُتب فيها',
  { skip: skipWithoutDatabase },
  async () => {
    const created = await createIsolatedDatabase('uow');
    try {
      await up(created.pool);
      const ca = authority();
      const log = new EventLog();
      await assert.rejects(
        () =>
          withUnitOfWork(created.pool, async (repositories) => {
            const inner = createRegistries({ ca, log, repositories });
            await inner.agents.register({ name: 'وكيل-داخل-معاملة', role: 'observer' });
            await inner.laws.propose({
              title: 'قانون داخل معاملة',
              text: 'لا يبقى إن تراجعت',
              scope: 'operations',
              proposer: 'council',
            });
            throw new Error('إخفاق بعد كتابتين في سجلّين');
          }),
        /إخفاق بعد كتابتين/,
      );
      assert.equal(await countRows(created.pool, 'agents'), 0, 'وكيل بقي بعد تراجع المعاملة');
      assert.equal(await countRows(created.pool, 'laws'), 0, 'قانون بقي بعد تراجع المعاملة');
    } finally {
      await created.drop();
    }
  },
);
