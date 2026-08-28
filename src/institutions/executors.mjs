/**
 * منفِّذو عملِ المؤسسات: الأثرُ الذي يُقاس لا الذي يُعلَن — الخطوة M8.05
 *
 * **العيبُ الذي يُغلقه هذا الملف:** «المؤسسةُ نفّذت المهمّة» في أكثر الأنظمة
 * عَلَمٌ يُرفع: عمودٌ اسمه `executed_at` يُكتب فيه وقتٌ ثم يُقال إنّ العملَ وقع.
 * ولا أحدَ يسأل: ما الذي أُنتج؟ فتصير المؤسسةُ تستهلك ميزانيةً وتُنتج صفوفَ
 * حالةٍ لا مخرَجاً، ويُقرأ تقريرُها على عملٍ لم يقع.
 *
 * والمنفِّذُ هنا اثنان لا يُفصلان: `fingerprint` تقرأ مخزنَ مخرجات المؤسسة نصّاً،
 * و`produce` تكتب المخرَج. ووحدةُ التشغيل تقرأ البصمةَ قبل الإنتاج وبعده: إن لم
 * تتغيّر رُفِضت المهمّةُ برمز `INSTITUTION_EXECUTION_INEFFECTIVE` ولم تُسجَّل
 * منفَّذة.
 *
 * **وحدٌّ معلَن أول:** البصمةُ تُقرأ من `institution_outputs` وحده، فهي تقيس
 * «أنتجت المؤسسةُ مخرَجاً» لا «صارَ العالمُ أفضل». وصحّةُ المضمون خارج قياس هذه
 * الخطوة.
 *
 * **وحدٌّ معلَن ثانٍ:** المنفِّذان لا يملكان `revert`. عملُ المؤسسة ليس حكماً
 * قضائياً يُتراجع عنه بأمرٍ (وذلك في `src/judiciary/executors.mjs`)؛ وإلغاءُ
 * المخرجات وسحبُها مسجَّلٌ في `docs/REMAINING_WORK.md` لا مُوهَمٌ بوجوده.
 */

/**
 * @typedef {object} InstitutionEffectExecutor
 * @property {string} name اسمُ الأثر كما هو معلَنٌ في `config/institutions.yaml`.
 * @property {(institutionId: string) => Promise<string>} fingerprint بصمةُ مخزنِ مخرجات المؤسسة.
 * @property {(input: { institutionId: string, taskId: string, kind: string, subject: string, agentId: string }) => Promise<string>} produce
 *   يكتب المخرَجَ ويُعيد معرِّفَه.
 */

/**
 * بصمةُ مخزنِ المخرجات لمؤسسةٍ بعينها: عددُ المخرجات ومعرِّفاتُها مرتَّبةً.
 *
 * والعددُ وحده لا يكفي: مخرَجٌ يُحذَف وآخرُ يُكتب يُبقيان العددَ كما هو. ومعرِّفاتٌ
 * بلا ترتيبٍ تُعطي بصمتين مختلفتين لنفس الحالة فتُقرأ تغيُّراً لم يقع.
 * @param {import('../persistence/repository-memory.mjs').Repository} outputs
 * @param {string} institutionId
 * @returns {Promise<string>}
 */
export async function outputFingerprint(outputs, institutionId) {
  const rows = await outputs.list({ filter: { institutionId } });
  const ids = rows
    .map((row) => String(/** @type {Record<string, unknown>} */ (row)['id']))
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return `outputs:${ids.length}:${ids.join(',')}`;
}

/**
 * منفِّذٌ عامٌّ يكتب مخرَجاً في مخزنِ مخرجات المؤسسة.
 *
 * والحملُ (`payload`) مُشتقٌّ من موضوع المهمّة لا مُخترَعٌ: مخرَجٌ لا علاقةَ له
 * بما طُلب مخرَجٌ يُنتج بصمةً مختلفةً ويُمرِّر تنفيذاً كاذباً.
 * @param {object} deps
 * @param {string} deps.name اسمُ الأثر المُعلَن.
 * @param {string} deps.documentKind نوعُ الوثيقة التي يُنتجها هذا الأثر.
 * @param {import('../persistence/repository-memory.mjs').Repository} deps.outputs
 * @param {() => Date} [deps.now]
 * @returns {InstitutionEffectExecutor}
 */
export function createOutputExecutor({ name, documentKind, outputs, now = () => new Date() }) {
  if (!outputs) throw new Error('INSTITUTION_EXECUTOR_DEPENDENCY_MISSING');
  return Object.freeze({
    name,
    /**
     * @param {string} institutionId
     * @returns {Promise<string>}
     */
    fingerprint: (institutionId) => outputFingerprint(outputs, institutionId),
    /**
     * @param {{ institutionId: string, taskId: string, kind: string, subject: string, agentId: string }} input
     * @returns {Promise<string>}
     */
    produce: async ({ institutionId, taskId, kind, subject, agentId }) => {
      const id = `out:${taskId}`;
      await outputs.insert({
        id,
        institutionId,
        taskId,
        kind,
        effect: name,
        payload: { document: documentKind, subject, producedFor: taskId },
        producedBy: agentId,
        producedAt: now(),
      });
      return id;
    },
  });
}

/**
 * منفِّذُ «إدراج خدمةٍ في كتالوج الخدمات الرقمية» — أثرُ وزارة الإدارة الرقمية.
 * @param {{ outputs: import('../persistence/repository-memory.mjs').Repository, now?: () => Date }} deps
 * @returns {InstitutionEffectExecutor}
 */
export function createServiceCatalogExecutor({ outputs, now }) {
  return createOutputExecutor({
    name: 'publish-service-catalog',
    documentKind: 'service-catalog-entry',
    outputs,
    ...(now === undefined ? {} : { now }),
  });
}

/**
 * منفِّذُ «إصدار نشرةٍ إحصائية» — أثرُ هيئة الإحصاء.
 * @param {{ outputs: import('../persistence/repository-memory.mjs').Repository, now?: () => Date }} deps
 * @returns {InstitutionEffectExecutor}
 */
export function createStatisticalBulletinExecutor({ outputs, now }) {
  return createOutputExecutor({
    name: 'publish-statistical-bulletin',
    documentKind: 'statistical-bulletin',
    outputs,
    ...(now === undefined ? {} : { now }),
  });
}

/**
 * يبني فهرسَ المنفِّذين باسم الأثر.
 * @param {readonly InstitutionEffectExecutor[]} executors
 * @returns {Map<string, InstitutionEffectExecutor>}
 */
export function effectIndex(executors) {
  /** @type {Map<string, InstitutionEffectExecutor>} */
  const index = new Map();
  for (const executor of executors) index.set(executor.name, executor);
  return index;
}
