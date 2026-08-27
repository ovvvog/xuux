/**
 * منفِّذو الأحكام: الأثرُ الذي يُقاس لا الذي يُعلَن — الخطوة M8.03
 *
 * **العيبُ الذي يُغلقه هذا الملف:** «تنفيذُ الحكم» في أكثر الأنظمة عَلَمٌ يُرفع:
 * عمودٌ اسمه `executed_at` يُكتب فيه وقتٌ ثم يُقال إنّ الحكم نُفِّذ. ولا أحدَ
 * يسأل: ما الذي تغيّر؟ فيصير الحكمُ منفَّذاً في الدفتر وغيرَ منفَّذٍ في الواقع،
 * ولا يظهر الفرقُ إلا حين يُطلب التراجع فلا يوجد ما يُتراجع عنه.
 *
 * والمنفِّذُ هنا ليس دالّةَ «افعل» وحدها، بل ثلاثةٌ لا تنفصل: `fingerprint`
 * تقرأ الحالةَ المعنيّة نصّاً، و`apply` تُحدث الأثر، و`revert` تُعيده. والمحكمةُ
 * تقرأ البصمةَ قبل التنفيذ وبعده: إن لم تتغيّر رُدَّ الأمرُ ولم يُسجَّل تنفيذ.
 * وعند التراجع تُقارَن البصمةُ بالمحفوظة قبل التنفيذ: إن لم ترجع رُدَّ التراجع.
 *
 * **وحدٌّ معلَن:** منفِّذٌ واحدٌ في هذه الخطوة (تعليقُ هوية المدّعى عليه). وهو
 * كافٍ لإثبات أنّ المسارَ يقيس لا يُعلن، ولا يدّعي أنّ الدولةَ تملك كلَّ أنواع
 * التنفيذ. بقيةُ الآثار (الغرامة، ردُّ المال، منعُ الفعل) تحتاج دفاترَ لا وجودَ
 * لها بعد، وهي مسجَّلة في `docs/REMAINING_WORK.md` لا مُوهَمٌ بوجودها.
 */

/**
 * @typedef {object} JudgmentExecutor
 * @property {string} name اسمُ الأثر كما هو معلَنٌ في `config/judiciary.yaml`.
 * @property {(target: string) => Promise<string>} fingerprint بصمةُ الحالة المعنيّة.
 * @property {(input: { target: string, caseId: string, reason: string }) => Promise<void>} apply
 * @property {(input: { target: string, caseId: string, reason: string }) => Promise<void>} revert
 */

/**
 * منفِّذُ «تعليق هوية المدّعى عليه».
 *
 * البصمةُ حالةُ الهوية نفسُها لا وقتٌ ولا عدّاد: حالةٌ لا تتغيّر تعني تنفيذاً لم
 * يقع، وهذا ما تقيسه المحكمة. وهويةٌ غيرُ موجودةٍ تُعطي بصمةً `absent` فتُرفض
 * محاولةُ التنفيذ لعدم تغيُّر البصمة — لا تُرفض برسالةٍ خاصّة، لأنّ القياسَ
 * أصدقُ من الفحص المسبَق.
 * @param {object} deps
 * @param {import('../identity/agent-registry.mjs').AgentRegistry} deps.agents
 * @returns {JudgmentExecutor}
 */
export function createAgentSuspensionExecutor({ agents }) {
  if (!agents) throw new Error('JUDICIARY_EXECUTOR_DEPENDENCY_MISSING');
  return Object.freeze({
    name: 'suspend-respondent-agent',
    /**
     * @param {string} target
     * @returns {Promise<string>}
     */
    fingerprint: async (target) => {
      const agent = await agents.get(target);
      return agent === null ? 'absent' : `state:${String(agent.state)}`;
    },
    /**
     * @param {{ target: string, caseId: string, reason: string }} input
     * @returns {Promise<void>}
     */
    apply: async ({ target, caseId, reason }) => {
      // السببُ يُمرَّر إلى السجل لأنّ الحالةَ العقابية في `AgentRegistry` لا
      // تُعلَن بلا سببٍ مسجَّل (نفسُ قيد القاعدة)، ومعرّفُ القضية جزءٌ منه كي
      // يُقرأ في المراجعة من أين جاء التعليق.
      await agents.transition(target, 'suspended', `${caseId}: ${reason}`);
    },
    /**
     * @param {{ target: string, caseId: string, reason: string }} input
     * @returns {Promise<void>}
     */
    revert: async ({ target }) => {
      await agents.transition(target, 'active');
    },
  });
}

/**
 * يبني فهرسَ المنفِّذين باسم الأثر.
 * @param {readonly JudgmentExecutor[]} executors
 * @returns {Map<string, JudgmentExecutor>}
 */
export function executorIndex(executors) {
  /** @type {Map<string, JudgmentExecutor>} */
  const index = new Map();
  for (const executor of executors) index.set(executor.name, executor);
  return index;
}
