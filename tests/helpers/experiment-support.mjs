/**
 * سندٌ للاختبارات — الخطوة M7.08.
 *
 * منذ `M7.08` لا يقبل `ModelEvaluationLedger.record` درجةً بلا تجربةٍ مسجَّلة
 * (البند ME-1). فكلُّ اختبارٍ يسجّل نتيجةَ تقييمٍ يحتاج أن يكتب سندَها أولاً —
 * وهذا هو المقصود: التكلفةُ التي يدفعها الاختبارُ هي نفسُها التي يدفعها الإنتاج.
 *
 * ولا يُخفي هذا الملفُّ الحاجزَ ولا يتجاوزه: هو يسجّل تجربةً **صحيحةً** بالسياسة
 * ويرد معرّفَها، فمن أراد اختبارَ الرفض لا يستعمله.
 */

import { ExperimentLedger } from '../../src/knowledge/experiment-ledger.mjs';

/**
 * سجل تجاربَ في الذاكرة صالحٌ للحقن في سجل التقييم.
 * @param {{ append: (type: string, actor: string, payload: object) => unknown }} log
 * @returns {ExperimentLedger}
 */
export function experimentLedgerFor(log) {
  return new ExperimentLedger({ log });
}

/**
 * يسجّل تجربةَ تقييمٍ صحيحةً لهذا النموذج وهذه البصمة ويرد معرّفَها.
 * @param {import('../../src/models/evaluation.mjs').ModelEvaluationLedger} evaluationLedger
 * @param {{ modelId: string, fingerprint: string, actor?: string, role?: string }} subject
 * @returns {string}
 */
export function registerEvaluationExperiment(
  evaluationLedger,
  { modelId, fingerprint, actor = 'actor:minister', role = 'role:minister' },
) {
  // سجلُّ التقييم يعلن من اعتمادِه `assertRegistered` وحدها — وهو الصواب: لا يحتاج
  // إلى التسجيل. والاختبارات تحتاجه، فيوسّع النوعَ هنا صراحةً لا في المصدر.
  const experiments = /** @type {ExperimentLedger} */ (
    /** @type {unknown} */ (evaluationLedger.experiments)
  );
  const record = experiments.register({
    kind: 'model-evaluation',
    title: `تقييم ${modelId} قبل تنشيطه`,
    hypothesis: 'أوزانُ هذه البصمة تتجاوز عتباتِ الفحوص الواجبة كلَّها.',
    metrics: ['safety', 'accuracy'],
    subject: { modelId, fingerprint },
    reproducibility: {
      seed: '42',
      datasetHash: 'd'.repeat(64),
      codeRevision: 'e'.repeat(40),
      environment: 'node20-linux',
    },
    registeredBy: actor,
    role,
  });
  return record.id;
}
