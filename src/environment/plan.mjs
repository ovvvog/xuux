/**
 * خطّةُ إقامةِ البيئةِ — **نقيّةٌ بلا أثرٍ ولا قرصٍ ولا أمرٍ يُشغَّل** (الخطوة
 * `M10.05`).
 *
 * هذه الوحدةُ **تُقرّر ماذا يُنفَّذ ولا تُنفِّذ**: تأخذ العقدَ ووقائعَ البيئةِ
 * المُمرَّرةَ (أيُّ الأدواتِ حاضرةٌ، وأيُّ المتغيّراتِ مضبوطةٌ، وما الوضعُ)
 * فتُعيد قائمةَ خطواتٍ مرتَّبةً كلٌّ منها إمّا **مُنفَّذةٌ** أو **مُتخطّاةٌ
 * بسببٍ مُسمّىً**. وفصلُ القرارِ عن التنفيذِ هو ما يجعل «الأمرَ الواحدَ»
 * قابلاً للاختبارِ بلا حاويةٍ ولا شبكةٍ ولا قرص.
 *
 * والضماناتُ المُنفَّذةُ هنا:
 *
 * `G-ENV-ORDERED-PHASES`: الترتيبُ ترتيبُ الإعلانِ في الوثيقةِ حرفيّاً، ولا
 * فرزَ ولا إعادةَ ترتيبٍ ولا تنفيذَ متوازياً. فمن صرّف قبل أن يُثبِّتَ لم يجد
 * المُصرِّف، ومن هاجَرَ قبل أن تُقام القاعدةُ رأى **رفضَ وصلةٍ** فقرأه خطأَ
 * هجرة.
 *
 * `G-ENV-DECLARED-SKIP`: كلُّ طورٍ مُتخطّىً يحمل **سببَ تخطٍّ مُسمّىً** ونصَّه؛
 * فتخطٍّ صامتٌ يُقرأ تنفيذاً، فيُظَنُّ أنّ الهجراتِ طُبِّقت وهي لم تُطبَّق —
 * وأوّلُ من يكتشفه من يقرأ جدولاً غيرَ موجود.
 *
 * `G-ENV-IDEMPOTENT-BOOTSTRAP`: كلُّ طورٍ في الخطّةِ متكافئٌ (يُفحَص هنا أيضاً
 * لا في التحميلِ وحدَه)؛ فـ«أمرٌ واحدٌ» يُعاد على بيئةٍ قائمةٍ فلا يُفسِدها،
 * وطورٌ غيرُ متكافئٍ يجعل الأمرَ الواحدَ «أمراً يُحفَظ عدَدُ مرّاتِه».
 *
 * @module environment/plan
 */

import { ENV_ERRORS, EnvironmentError } from './errors.mjs';

/**
 * @typedef {import('./contract.mjs').EnvironmentContract} EnvironmentContract
 * @typedef {import('./contract.mjs').EnvironmentPhase} EnvironmentPhase
 */

/**
 * وقائعُ البيئةِ المُمرَّرةُ لحسابِ الخطّة.
 *
 * @typedef {object} EnvironmentFacts
 * @property {string} profile
 * @property {string[]} presentTools
 * @property {string[]} setVariables
 */

/**
 * @typedef {object} PlanStep
 * @property {string} phase
 * @property {string} title
 * @property {'directories' | 'command'} kind
 * @property {string | null} command
 * @property {string[]} args
 * @property {number} timeoutMs
 * @property {boolean} skipped
 * @property {string | null} skipReason
 * @property {string | null} skipStatement
 */

/**
 * @typedef {object} BootstrapPlan
 * @property {string} profile
 * @property {PlanStep[]} steps
 * @property {number} executeCount
 * @property {number} skipCount
 * @property {string[]} directories
 */

/**
 * @param {string} code
 * @param {string} message
 * @param {Record<string, unknown>} [detail]
 * @returns {never}
 */
function refuse(code, message, detail = {}) {
  throw new EnvironmentError(code, message, detail);
}

/**
 * حسابُ خطّةِ الإقامةِ من العقدِ ووقائعِ البيئة.
 *
 * @param {EnvironmentContract} contract
 * @param {EnvironmentFacts} facts
 * @returns {BootstrapPlan}
 */
export function bootstrapPlan(contract, facts) {
  const profiles = new Set(contract.profiles.map((profile) => profile.id));
  if (!profiles.has(facts.profile)) {
    refuse(
      ENV_ERRORS.PROFILE_UNDECLARED,
      `وضعُ البيئةِ «${facts.profile}» غيرُ مُعلَنٍ في عقدِ البيئة؛ وخطّةٌ تُحسَب على وضعٍ لم يُعلَن خطّةٌ لا يُعرَف ما يُتخطّى فيها.`,
      { profile: facts.profile },
    );
  }
  /** @type {Set<string>} */
  const presentTools = new Set(facts.presentTools);
  /** @type {Set<string>} */
  const setVariables = new Set(facts.setVariables);
  const declaredTools = new Set(contract.toolchain.map((tool) => tool.id));
  for (const tool of presentTools) {
    if (!declaredTools.has(tool)) {
      refuse(
        ENV_ERRORS.TOOL_UNDECLARED,
        `واقعةٌ لأداةٍ غيرِ مُعلَنةٍ «${tool}»؛ وأداةٌ تُحسَب في الخطّةِ ولم تُعلَن في العقدِ تُدخل في الإقامةِ ما لم يُوافَق عليه.`,
        { tool },
      );
    }
  }
  const declaredVariables = new Set(contract.variables.map((variable) => variable.id));
  for (const variable of setVariables) {
    if (!declaredVariables.has(variable)) {
      refuse(ENV_ERRORS.VARIABLE_UNDECLARED, `واقعةٌ لمتغيّرٍ غيرِ مُعلَنٍ «${variable}».`, {
        variable,
      });
    }
  }

  /** @type {PlanStep[]} */
  const steps = [];
  for (const phase of contract.phases) {
    if (!phase.idempotent) {
      refuse(
        ENV_ERRORS.PHASE_NOT_IDEMPOTENT,
        `الطورُ «${phase.id}» غيرُ متكافئٍ فلا يدخل في خطّةِ أمرٍ واحدٍ يُعاد.`,
        { phase: phase.id },
      );
    }
    const skip = skipDecision(phase, facts.profile, presentTools, setVariables);
    steps.push({
      phase: phase.id,
      title: phase.title,
      kind: phase.kind,
      command: phase.command ?? null,
      args: phase.args ?? [],
      timeoutMs: phase.timeoutMs,
      skipped: skip !== null,
      skipReason: skip === null ? null : skip.reason,
      skipStatement: skip === null ? null : skip.statement,
    });
  }
  return {
    profile: facts.profile,
    steps,
    executeCount: steps.filter((step) => !step.skipped).length,
    skipCount: steps.filter((step) => step.skipped).length,
    directories: contract.directories.map((entry) => entry.path),
  };
}

/**
 * قرارُ التخطّي بسببٍ **مُسمّىً**؛ والترتيبُ هنا مقصودٌ: الوضعُ أوّلاً لأنه
 * قرارٌ مُعلَنٌ في الوثيقةِ، ثم الأداةُ، ثم المتغيّرُ — فسببٌ واحدٌ يُقال لا
 * ثلاثةٌ تُخلَط.
 *
 * @param {EnvironmentPhase} phase
 * @param {string} profile
 * @param {Set<string>} presentTools
 * @param {Set<string>} setVariables
 * @returns {{ reason: string, statement: string } | null}
 */
function skipDecision(phase, profile, presentTools, setVariables) {
  if ((phase.skipWhenProfileIn ?? []).includes(profile)) {
    return {
      reason: 'profile',
      statement: `مُتخطّىً بإعلانِ الوثيقةِ في وضعِ «${profile}» — لا صامتاً.`,
    };
  }
  if (phase.skipWhenToolMissing !== undefined && !presentTools.has(phase.skipWhenToolMissing)) {
    return {
      reason: 'tool-missing',
      statement: `الأداةُ «${phase.skipWhenToolMissing}» غائبةٌ، فيُتخطّى الطورُ ولا يُدَّعى أنه نُفِّذ.`,
    };
  }
  if (phase.skipWhenVariableUnset !== undefined && !setVariables.has(phase.skipWhenVariableUnset)) {
    return {
      reason: 'variable-unset',
      statement: `المتغيّرُ «${phase.skipWhenVariableUnset}» غيرُ مضبوطٍ، ولا تُصطنَع له قيمةٌ — فقيمةٌ يخترعها سكربتٌ تُقيم أثراً في موضعٍ لم يقصده أحد.`,
    };
  }
  return null;
}

/**
 * حكمُ إصدارِ أداةٍ على مجالِها المُعلَن — **العددُ الرئيسُ وحدَه**، فالمُرقَّعُ
 * يتغيّر كلَّ أسبوعٍ وتثبيتُه يُوقف البيئةَ على ترقيعٍ أمنيّ.
 *
 * @param {{ minMajor?: number, maxMajor?: number }} tool
 * @param {string} versionText
 * @returns {{ inRange: boolean, major: number | null }}
 */
export function versionInRange(tool, versionText) {
  const match = /(\d+)\.(\d+)\.(\d+)/.exec(versionText) ?? /(\d+)\.(\d+)/.exec(versionText);
  if (match === null || match[1] === undefined) {
    return { inRange: false, major: null };
  }
  const major = Number.parseInt(match[1], 10);
  if (tool.minMajor !== undefined && major < tool.minMajor) {
    return { inRange: false, major };
  }
  if (tool.maxMajor !== undefined && major > tool.maxMajor) {
    return { inRange: false, major };
  }
  return { inRange: true, major };
}
