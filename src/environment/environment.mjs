/**
 * مِقبضُ البيئةِ الجامع — الخطوة `M10.05`.
 *
 * **العيبُ الذي تُغلقه هذه الوحدة:** صار للنظامِ بعد `M10.01`–`M10.04` رقمٌ
 * وحكمٌ وصوتٌ وثمنٌ — **وكلُّ ذلك بشرطِ أن يكون النظامُ قائماً أصلاً**. وقيامُه
 * كان **معرفةً في رأسِ من بناه**: نُسخةُ Node في موضعٍ، والقاعدةُ في موضعٍ،
 * والهجراتُ في نصٍّ ثالثٍ، و`DATABASE_URL` لا يُعلَن في موضعٍ واحدٍ قطُّ بل
 * يُستنبَط من قراءةِ الكود. **وبيئةٌ تُبنى بالذاكرةِ تختلف من جهازٍ إلى جهازٍ،
 * ونظامٌ تختلف بيئتُه لا يُقاس حكمٌ واحدٌ عليه.**
 *
 * **والقاعدة: لا لزومَ بلا إعلانٍ في عقدٍ واحدٍ، ولا طورَ يُتخطّى بلا سببٍ
 * مُسمّىً، ولا حكمَ صحّةٍ على مجسٍّ لم يُشغَّل.**
 *
 * وهذه الوحدةُ **لا تُشغِّل أمراً ولا تلمس قرصاً**: تُركِّب العقدَ والخطّةَ
 * والحكمَ وتُقيّدها في السجلِّ الدائمِ **المُحقَنِ** — والتنفيذُ الفعليُّ في
 * `scripts/bootstrap.mjs`، وجمعُ الوقائعِ في
 * `scripts/lib/environment-facts.mjs`. وفصلُ الحسابِ عن الأثرِ هو ما يجعل
 * الحكمَ قابلاً للاختبارِ بلا حاويةٍ ولا شبكة.
 *
 * والضماناتُ المُنفَّذةُ هنا:
 *
 * `G-ENV-INJECTED-CLOCK`: الساعةُ مُحقَنةٌ في المُنشئِ ولا `setTimeout` ولا
 * `setInterval` في المسار؛ فمدّةٌ تُقاس على ساعةِ النظامِ لا تُثبَّت في اختبارٍ
 * فيصير الاختبارُ يقول «أكبرُ من صفر» وهو لا يقول شيئاً.
 *
 * `G-ENV-SINGLE-LEDGER`: القيدُ في السجلِّ الدائمِ المُحقَنِ **وحدَه**؛ ولا
 * سجلَّ إقامةٍ ثانياً يُستحدَث هنا، فلو فُتح له مسارٌ ثانٍ لصار في الدولةِ
 * سجلَّا إقامةٍ يتباعدان وقُرئ أحدُهما دون الآخر.
 *
 * **حدودٌ معلَنة:**
 * 1. **الفحصُ يُصدِر حكماً ولا يُصلِح شيئاً**؛ والإصلاحُ فعلُ `bootstrap` وحدَه.
 * 2. **الحكمُ حكمٌ على البيئةِ لا على النظام**: بيئةٌ `healthy` لا تعني أنّ
 *    البوابةَ خضراءُ — تلك حكمُ `npm run validate` وحكمُ CI.
 * 3. **لا مخزنَ أسرارٍ هنا ولا توليدَ سرٍّ**: العقدُ يُعلن اسمَ المتغيّرِ
 *    وصيغتَه، والقيمةُ من البيئةِ لا من المستودع.
 *
 * @module environment/environment
 */

import { exitCodeOf, loadEnvironmentContract } from './contract.mjs';
import { ENV_ERRORS, EnvironmentError } from './errors.mjs';
import { bootstrapPlan } from './plan.mjs';
import { evaluateProbes, healthVerdict } from './probes.mjs';

/**
 * @typedef {import('./contract.mjs').EnvironmentContract} EnvironmentContract
 * @typedef {import('./plan.mjs').EnvironmentFacts} EnvironmentFacts
 * @typedef {import('./plan.mjs').BootstrapPlan} BootstrapPlan
 * @typedef {import('./probes.mjs').ProbeObservation} ProbeObservation
 * @typedef {import('./probes.mjs').HealthReport} HealthReport
 */

/**
 * سجلٌّ يُحقَن: `append(type, actor, data)` — وهو عقدُ `PersistentEventLog`
 * نفسِه في `src/root-of-trust/`، ولا تستوردُه هذه الوحدةُ فلا تُنشئ سجلّاً.
 *
 * @typedef {{ append: (type: string, actor: string, data: Record<string, unknown>) => unknown }} EnvironmentLog
 */

/** مِقبضُ البيئةِ: عقدٌ واحدٌ، وخطّةٌ تُحسَب، وحكمُ صحّةٍ يُقيَّد. */
export class Environment {
  /** @type {EnvironmentContract} */
  #contract;
  /** @type {EnvironmentLog} */
  #log;
  /** @type {() => number} */
  #nowMs;

  /**
   * @param {object} deps
   * @param {EnvironmentContract} [deps.contract] العقدُ؛ وإن غاب حُمِّل من `deps.dir`.
   * @param {string} [deps.dir] مجلَّدُ الوثائق.
   * @param {EnvironmentLog} deps.log السجلُّ الدائمُ المُحقَن.
   * @param {() => number} [deps.nowMs] الساعةُ المُحقَنة.
   */
  constructor(deps) {
    if (deps === undefined || deps === null || typeof deps.log?.append !== 'function') {
      throw new EnvironmentError(
        ENV_ERRORS.LOG_REQUIRED,
        'سجلُّ الأحداثِ غيرُ مُحقَنٍ؛ وإقامةٌ لا تُقيَّد إقامةٌ لا يُسأل عنها أحدٌ، ومن أراد تشغيلاً بلا قيدٍ أراد أثراً بلا صاحب.',
      );
    }
    this.#contract =
      deps.contract ?? loadEnvironmentContract(deps.dir === undefined ? {} : { dir: deps.dir });
    this.#log = deps.log;
    const clock = deps.nowMs ?? (() => Date.now());
    if (typeof clock !== 'function') {
      throw new EnvironmentError(
        ENV_ERRORS.CLOCK_INVALID,
        'الساعةُ المُحقَنةُ ليست دالّةً؛ وزمنٌ لا يُسأل عنه زمنٌ يُقرأ من ساعةِ من شغَّل لا من ساعةِ الدولة.',
      );
    }
    this.#nowMs = clock;
  }

  /** وصفُ العقدِ عدَداً — يقرؤه الحاجزُ والاختبارُ ولا يحمل قيمةَ سرٍّ واحدة. */
  describe() {
    return {
      version: this.#contract.version,
      profiles: this.#contract.profiles.map((profile) => profile.id),
      tools: this.#contract.toolchain.map((tool) => tool.id),
      variables: this.#contract.variables.map((variable) => variable.id),
      directories: this.#contract.directories.map((entry) => entry.path),
      phases: this.#contract.phases.map((phase) => phase.id),
      probes: this.#contract.probes.map((probe) => probe.id),
      requiredProbes: [...this.#contract.healthCheck.requiredProbes],
      refusalCodes: this.#contract.refusalCodes.map((entry) => entry.code),
      guarantees: this.#contract.guarantees.map((entry) => entry.id),
    };
  }

  /** العقدُ نفسُه — للقراءةِ لا للتعديل. */
  get contract() {
    return this.#contract;
  }

  /**
   * خطّةُ الإقامةِ، مُقيَّدةً في السجلِّ بأطوارِها المُنفَّذةِ والمُتخطّاةِ
   * وأسبابِ تخطّيها.
   *
   * @param {EnvironmentFacts} facts
   * @param {{ actor?: string }} [options]
   * @returns {BootstrapPlan}
   */
  plan(facts, options = {}) {
    const plan = bootstrapPlan(this.#contract, facts);
    this.#append('environment.bootstrap.planned', options.actor ?? 'system@bootstrap', {
      profile: plan.profile,
      execute: plan.steps.filter((step) => !step.skipped).map((step) => step.phase),
      skipped: plan.steps
        .filter((step) => step.skipped)
        .map((step) => ({ phase: step.phase, reason: step.skipReason })),
    });
    return plan;
  }

  /**
   * قيدُ طورٍ واحدٍ بحصيلتِه — يُنادى من `scripts/bootstrap.mjs` بعد كلِّ طورٍ،
   * فيُقرأ الأثرُ من السجلِّ لا من مخرَجِ الطرفيّةِ الذي يُغلَق فيضيع.
   *
   * @param {{ phase: string, ok: boolean, exitCode: number | null, durationMs: number, detail?: string }} outcome
   * @param {{ actor?: string }} [options]
   */
  recordPhase(outcome, options = {}) {
    const declared = this.#contract.phases.some((phase) => phase.id === outcome.phase);
    if (!declared) {
      throw new EnvironmentError(
        ENV_ERRORS.PHASE_UNDECLARED,
        `قيدٌ لطورٍ غيرِ مُعلَنٍ «${outcome.phase}»؛ وطورٌ يُنفَّذ ولم يُعلَن في العقدِ أثرٌ لا يُراجَع.`,
        { phase: outcome.phase },
      );
    }
    this.#append('environment.bootstrap.phase', options.actor ?? 'system@bootstrap', {
      phase: outcome.phase,
      ok: outcome.ok === true,
      exitCode: outcome.exitCode,
      durationMs: outcome.durationMs,
      detail: outcome.detail ?? '',
    });
  }

  /**
   * حكمُ فحصِ الصحّةِ من وقائعَ **مُمرَّرةٍ**، مُقيَّداً في السجلّ.
   *
   * @param {ProbeObservation[]} observations
   * @param {{ actor?: string }} [options]
   * @returns {HealthReport}
   */
  verify(observations, options = {}) {
    const results = evaluateProbes(this.#contract, observations);
    const report = healthVerdict(this.#contract, results);
    this.#append('environment.verify.completed', options.actor ?? 'system@verify', {
      verdict: report.verdict,
      exitCode: report.exitCode,
      probes: results.length,
      failed: report.failed.map((result) => ({
        probe: result.probe,
        severity: result.severity,
      })),
    });
    return report;
  }

  /**
   * رمزُ الخروجِ المُعلَنُ لحكمٍ — **من الوثيقةِ لا من الكود**.
   *
   * @param {string} verdict
   * @returns {number}
   */
  exitCodeFor(verdict) {
    return exitCodeOf(this.#contract, verdict);
  }

  /**
   * @param {string} type
   * @param {string} actor
   * @param {Record<string, unknown>} data
   */
  #append(type, actor, data) {
    const declared = this.#contract.audit.events.some((event) => event.type === type);
    if (!declared) {
      throw new EnvironmentError(
        ENV_ERRORS.CONFIG_INVALID,
        `نوعُ حدثٍ غيرُ مُعلَنٍ في audit.events «${type}»؛ وقيدٌ بنوعٍ لا تُعلنه الوثيقةُ قيدٌ لا يجده من يقرأ السجلَّ بحثاً عنه.`,
        { type },
      );
    }
    const atMs = this.#nowMs();
    if (!Number.isFinite(atMs)) {
      throw new EnvironmentError(
        ENV_ERRORS.CLOCK_INVALID,
        `الساعةُ المُحقَنةُ أعادت «${String(atMs)}» وليست عدداً منتهياً؛ وقيدٌ بلا زمنٍ قيدٌ لا يقع في تقريرٍ بعينه.`,
        { atMs },
      );
    }
    this.#log.append(type, actor, { ...data, atMs });
  }
}
