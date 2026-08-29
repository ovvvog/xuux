/**
 * وحدة العمل — معاملة واحدة للعمليات المركّبة (الخطوة `M3.06`).
 *
 * العيب الذي تُعالجه: بعض العمليات في الدولة ليست كتابةً واحدة. «تذكّر» تكتب
 * عقد بيانات ثم ذاكرةً تحيل إليه؛ و«فعّل نموذجاً» تُسقط النشط السابق ثم تُثبت
 * الجديد. حين تنفذ الكتابة الأولى وتُخفق الثانية، تبقى القاعدة على حالٍ لا
 * يقولها أحد: عقد بيانات بلا ذاكرة، أو غرضٌ بلا نموذج نشط لحظةَ الإخفاق. لا
 * يظهر هذا في اختبار سعيد، ويظهر في التشغيل حين يُقطع الاتصال بين الكتابتين.
 *
 * والحل ليس ترتيباً أذكى للكتابات — الترتيب لا يُنجي من الإخفاق بين اثنتين —
 * وإنما معاملةٌ واحدة: إمّا الكل أو لا شيء.
 *
 * حدٌّ معلن: `withUnitOfWork` تُلزم **كل** المستودعات فيها بوصلةٍ واحدة، وهذا
 * يعني تسلسل الكتابات داخلها. لا تُلفّ فيها عملاً طويلاً (استدعاء شبكة، أو
 * حسبةً ثقيلة) لأن الوصلة تبقى محجوزة والمعاملة مفتوحة، والمعاملة المفتوحة
 * طويلاً تُعطّل التنظيف في PostgreSQL. لُفّ الكتابات وحدها.
 *
 * حدٌّ معلن ثانٍ: سجلّ الأحداث (`EventLog`) في الذاكرة اليوم، فأحداثه ليست جزءاً
 * من هذه المعاملة. إذا تراجعت المعاملة بقي الحدث مكتوباً في السجل الذاكري بينما
 * لم يبقَ أثرٌ في القاعدة. جعلُ السجل جزءاً من المعاملة موضعه `M4` مع جذر الثقة،
 * وهو مذكور في خارطة الطريق لا مسكوتٌ عنه.
 */

import { withTransaction } from './db.mjs';
import {
  AGENT_SPEC,
  CLASSIFICATION_APPROVAL_SPEC,
  DATA_ASSET_SPEC,
  DATA_LINEAGE_SPEC,
  ERASURE_RECORD_SPEC,
  EVENT_MESSAGE_SPEC,
  EVENT_OFFSET_SPEC,
  CASE_SPEC,
  INSTITUTION_SPEC,
  INSTITUTION_TASK_SPEC,
  INSTITUTION_OUTPUT_SPEC,
  INSTITUTION_MANDATE_SPEC,
  INSTITUTION_BREACH_SPEC,
  INSTITUTION_REPORT_CYCLE_SPEC,
  FEDERATION_DELEGATION_SPEC,
  FEDERATION_ACT_SPEC,
  FEDERATION_REFUSAL_SPEC,
  FEDERATION_REGISTER_SPEC,
  ROYAL_REPORT_SPEC,
  LAW_SPEC,
  MEMORY_SPEC,
  MODEL_SPEC,
} from './entities.mjs';
import { createPostgresRepository } from './repository-postgres.mjs';

/** @typedef {import('./composition.mjs').StateRepositories} StateRepositories */

/**
 * يبني مستودعات مربوطة بوصلة معاملة واحدة.
 * @param {import('pg').PoolClient} client
 * @returns {StateRepositories}
 */
export function createClientRepositories(client) {
  return /** @type {StateRepositories} */ (
    /** @type {unknown} */ ({
      agents: createPostgresRepository(client, AGENT_SPEC),
      models: createPostgresRepository(client, MODEL_SPEC),
      dataAssets: createPostgresRepository(client, DATA_ASSET_SPEC),
      memories: createPostgresRepository(client, MEMORY_SPEC),
      laws: createPostgresRepository(client, LAW_SPEC),
      cases: createPostgresRepository(client, CASE_SPEC),
      classificationApprovals: createPostgresRepository(client, CLASSIFICATION_APPROVAL_SPEC),
      dataLineage: createPostgresRepository(client, DATA_LINEAGE_SPEC),
      // دفتر شواهد المحو داخل المعاملة نفسها (`M7.06`): شاهدٌ يُكتب في وصلةٍ
      // أخرى يبقى لو تراجعت معاملةُ المحو — فتشهد الدولة على محوٍ لم يقع.
      erasureRecords: createPostgresRepository(client, ERASURE_RECORD_SPEC),
      // رسائلُ القنوات ومواضعُ قراءتها داخل المعاملة نفسها (`M7.07`): رسالةٌ
      // تُنشر في وصلةٍ أخرى تبقى لو تراجعت معاملةُ فعلها — فتُعلِم القناةُ بما
      // لم يقع، وموضعٌ يُثبّت خارجها يُقرّ بمعالجةٍ تراجعت.
      eventMessages: createPostgresRepository(client, EVENT_MESSAGE_SPEC),
      eventOffsets: createPostgresRepository(client, EVENT_OFFSET_SPEC),
      // مؤسساتُ التشغيل داخل المعاملة نفسها (`M8.05`): قيدُ الميزانية يُكتب في
      // صفِّ المؤسسة والمخرَجُ في جدولٍ آخر، فوصلتان تعنيان أن يبقى المقيَّدُ
      // بلا مخرَجٍ أو يبقى المخرَجُ بلا قيدٍ إن تراجعت إحداهما.
      institutions: createPostgresRepository(client, INSTITUTION_SPEC),
      institutionTasks: createPostgresRepository(client, INSTITUTION_TASK_SPEC),
      institutionOutputs: createPostgresRepository(client, INSTITUTION_OUTPUT_SPEC),
      institutionMandates: createPostgresRepository(client, INSTITUTION_MANDATE_SPEC),
      institutionBreaches: createPostgresRepository(client, INSTITUTION_BREACH_SPEC),
      institutionReportCycles: createPostgresRepository(client, INSTITUTION_REPORT_CYCLE_SPEC),
      federationDelegations: createPostgresRepository(client, FEDERATION_DELEGATION_SPEC),
      federationActs: createPostgresRepository(client, FEDERATION_ACT_SPEC),
      federationRefusals: createPostgresRepository(client, FEDERATION_REFUSAL_SPEC),
      federationRegister: createPostgresRepository(client, FEDERATION_REGISTER_SPEC),
      royalReports: createPostgresRepository(client, ROYAL_REPORT_SPEC),
    })
  );
}

/**
 * نفّذ عملاً على مستودعات كلها في معاملة واحدة.
 *
 * كل ما يُكتب داخل `work` يُقرّ معاً أو يتراجع معاً. وأي خطأ يُرفع كما هو بعد
 * التراجع: لا يُبتلع، لأن معاملةً تتراجع بصمت أسوأ من كتابةٍ جزئية معلومة.
 * @template T
 * @param {import('pg').Pool} pool
 * @param {(repositories: StateRepositories, client: import('pg').PoolClient) => Promise<T>} work
 * @returns {Promise<T>}
 */
export function withUnitOfWork(pool, work) {
  return withTransaction(pool, (client) => work(createClientRepositories(client), client));
}
