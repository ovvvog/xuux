/**
 * تحميلُ عقدِ البيئةِ والتحقّقُ من ترابطِه — الخطوة `M10.05`.
 *
 * **العقدُ يُرفَض عند التحميلِ لا عند الاستعمال:** فمرجعٌ إلى أداةٍ أو متغيّرٍ
 * أو مجسٍّ لم يُعلَن يظهر أوّلَ ما يُقرأ الملفُّ، لا في منتصفِ إقامةٍ بعد أن
 * صُرِفت دقائقُ ونُصِّبت حاويةٌ. ومن أخّر الرفضَ إلى موضعِ الاستعمالِ جعل
 * البيئةَ تفشل في مكانٍ لا يدلّ على سببِها.
 *
 * والضمانُ المُنفَّذُ هنا: `G-ENV-NO-SECRET-VALUES` — العقدُ يُعلن **اسمَ**
 * المتغيّرِ وصيغتَه وموضعَ لزومِه ولا يحمل **قيمتَه**، ويُرَدُّ إن حمل حقلَ
 * قيمةٍ أصلاً؛ فسرٌّ في وثيقةٍ متعقَّبةٍ سرٌّ انتهى (المادة 7).
 *
 * @module environment/contract
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import Ajv2020Default from 'ajv/dist/2020.js';

// وحزمةُ Ajv تُصدِّر صنفَها افتراضاً في ESM، فيُقرأ نوعُه صريحاً وإلا صار «غيرَ
// قابلٍ للإنشاء» في الفحصِ الصارم — كما في وحدةِ التكلفةِ والسعةِ قبلَها.
const Ajv2020 = /** @type {typeof import('ajv/dist/2020.js').Ajv2020} */ (
  /** @type {unknown} */ (Ajv2020Default)
);
import YAML from 'yaml';

import { ENV_ERRORS, EnvironmentError } from './errors.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** مجلَّدُ الوثائقِ الافتراضيُّ لعقدِ البيئة. */
export const DEFAULT_ENVIRONMENT_CONFIG_DIR = path.resolve(HERE, '..', '..', 'config');

/** أوضاعُ البيئةِ المُعلَنةُ بترتيبِها. */
export const ENVIRONMENT_PROFILES = Object.freeze(['development', 'ci', 'production']);

/** أحكامُ فحصِ الصحّةِ بترتيبِ سوئِها؛ فالترتيبُ يُستعمل في اختيارِ الأسوأ. */
export const HEALTH_VERDICTS = Object.freeze(['healthy', 'degraded', 'unfit']);

/**
 * @param {string} code
 * @param {string} message
 * @param {Record<string, unknown>} [detail]
 * @returns {never}
 */
function refuse(code, message, detail = {}) {
  throw new EnvironmentError(code, message, detail);
}

/** @param {unknown} error @returns {string} */
function errorText(error) {
  return error instanceof Error ? error.message : String(error);
}

/** @param {string} message @returns {never} */
function invalidContract(message) {
  refuse(ENV_ERRORS.CONFIG_INVALID, message);
}

/**
 * @typedef {object} EnvironmentTool
 * @property {string} id
 * @property {string} command
 * @property {string[]} args
 * @property {number} [minMajor]
 * @property {number} [maxMajor]
 * @property {string[]} requiredIn
 * @property {string} statement
 */

/**
 * @typedef {object} EnvironmentVariable
 * @property {string} id
 * @property {string[]} requiredIn
 * @property {string} format
 * @property {boolean} secret
 * @property {string} statement
 */

/**
 * @typedef {object} EnvironmentDirectory
 * @property {string} path
 * @property {string} statement
 */

/**
 * @typedef {object} EnvironmentPhase
 * @property {string} id
 * @property {string} title
 * @property {'directories' | 'command'} kind
 * @property {string} [command]
 * @property {string[]} [args]
 * @property {string[]} [skipWhenProfileIn]
 * @property {string} [skipWhenVariableUnset]
 * @property {string} [skipWhenToolMissing]
 * @property {boolean} idempotent
 * @property {number} timeoutMs
 * @property {string} statement
 */

/**
 * @typedef {object} EnvironmentProbe
 * @property {string} id
 * @property {'tool' | 'variable' | 'directory' | 'file'} kind
 * @property {string} target
 * @property {'info' | 'warning' | 'critical'} severity
 * @property {string} statement
 */

/**
 * @typedef {object} HealthVerdictSpec
 * @property {string} id
 * @property {number} exitCode
 * @property {string} statement
 */

/**
 * @typedef {object} EnvironmentContract
 * @property {number} version
 * @property {string} statement
 * @property {{ id: string, statement: string }[]} profiles
 * @property {EnvironmentTool[]} toolchain
 * @property {EnvironmentVariable[]} variables
 * @property {EnvironmentDirectory[]} directories
 * @property {EnvironmentPhase[]} phases
 * @property {EnvironmentProbe[]} probes
 * @property {{ verdicts: HealthVerdictSpec[], requiredProbes: string[], statement: string }} healthCheck
 * @property {{ events: { type: string, statement: string }[] }} audit
 * @property {{ code: string, statement: string }[]} refusalCodes
 * @property {{ id: string, file: string, statement: string }[]} guarantees
 */

/**
 * الحقولُ التي **يُرفَض** حضورُها في إعلانِ متغيّرٍ: أيُّ حقلٍ يحمل قيمةً.
 * والمخطَّطُ يمنعها بـ`additionalProperties: false`، ويُعاد الفحصُ هنا نصّاً
 * لأنّ الضمانَ `G-ENV-NO-SECRET-VALUES` يجب أن يُنفَّذ في **موضعٍ يُقرأ** لا في
 * مخطَّطٍ قد يُخفَّف يوماً.
 */
const FORBIDDEN_VALUE_FIELDS = Object.freeze(['value', 'default', 'example', 'sample']);

/**
 * تحميلُ عقدِ البيئةِ من `config/environment.yaml` والتحقّقُ منه بمخطَّطِه
 * الصارمِ ثم بترابطِه.
 *
 * @param {{ dir?: string }} [options]
 * @returns {EnvironmentContract}
 */
export function loadEnvironmentContract(options = {}) {
  const dir = options.dir ?? DEFAULT_ENVIRONMENT_CONFIG_DIR;
  const schemaDir = fs.existsSync(path.join(dir, 'schemas')) ? dir : DEFAULT_ENVIRONMENT_CONFIG_DIR;
  const file = path.join(dir, 'environment.yaml');
  if (!fs.existsSync(file)) {
    invalidContract(
      'عقدُ البيئةِ غائب؛ وبيئةٌ بلا عقدٍ يُعلن ما تحتاجه بيئةٌ تُبنى بذاكرةِ من بناها وتختلف من جهازٍ إلى جهاز.',
    );
  }
  /** @type {unknown} */
  let raw;
  try {
    raw = YAML.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    invalidContract(`تعذّرت قراءة environment.yaml: ${errorText(error)}`);
  }
  const schemaPath = path.join(schemaDir, 'schemas', 'environment.schema.json');
  if (!fs.existsSync(schemaPath)) {
    invalidContract(
      'مخطَّطُ عقدِ البيئةِ غائب؛ وبلا مخطَّطٍ يصير العقدُ نصّاً حرّاً كالحالِ الذي جاء ليُغلقه.',
    );
  }
  const validate = new Ajv2020({ allErrors: true, strict: false }).compile(
    JSON.parse(fs.readFileSync(schemaPath, 'utf8')),
  );
  if (!validate(raw)) {
    const problems = (validate.errors ?? [])
      .map(
        (/** @type {{ instancePath: string, message?: string }} */ entry) =>
          `${entry.instancePath || '/'}: ${entry.message ?? 'مخالفة'}`,
      )
      .join('؛ ');
    invalidContract(`عقدُ البيئةِ يخالف مخطَّطَه: ${problems}`);
  }
  const parsed = /** @type {EnvironmentContract} */ (raw);

  assertProfiles(parsed);
  assertUniqueIds(parsed);
  assertNoSecretValues(parsed, file);
  assertPhaseReferences(parsed);
  assertProbeReferences(parsed);
  assertHealthCheck(parsed);

  return parsed;
}

/** @param {EnvironmentContract} contract */
function assertProfiles(contract) {
  const declared = new Set(contract.profiles.map((profile) => profile.id));
  for (const profile of ENVIRONMENT_PROFILES) {
    if (!declared.has(profile)) {
      invalidContract(
        `وضعُ البيئةِ «${profile}» غيرُ مُعلَنٍ في profiles؛ ووضعٌ يُنسَب إليه لزومٌ ولا يُعلَن يجعل «لازمٌ» كلمةً بلا موضعٍ تلزم فيه.`,
      );
    }
  }
  if (declared.size !== contract.profiles.length) {
    invalidContract(
      'وضعُ بيئةٍ مكرَّرٌ في profiles؛ ومعرّفٌ يُشير إلى وضعين وضعٌ لا يُعرَف أيُّه النافذ.',
    );
  }
}

/** @param {EnvironmentContract} contract */
function assertUniqueIds(contract) {
  /** @type {[string, string[]][]} */
  const groups = [
    ['أداة', contract.toolchain.map((tool) => tool.id)],
    ['متغيّر', contract.variables.map((variable) => variable.id)],
    ['مجلَّد', contract.directories.map((entry) => entry.path)],
    ['طور', contract.phases.map((phase) => phase.id)],
    ['مجسّ', contract.probes.map((probe) => probe.id)],
    ['رمزُ رفضٍ', contract.refusalCodes.map((entry) => entry.code)],
    ['ضمان', contract.guarantees.map((entry) => entry.id)],
  ];
  for (const [label, ids] of groups) {
    if (new Set(ids).size !== ids.length) {
      invalidContract(
        `${label} مكرَّرُ المعرّفِ في عقدِ البيئة؛ ومعرّفٌ مكرَّرٌ يجعل الحكمَ عليه غيرَ محدَّدٍ.`,
      );
    }
  }
}

/**
 * `G-ENV-NO-SECRET-VALUES`: لا حقلَ قيمةٍ في إعلانِ متغيّرٍ، ولا قيمةَ سرٍّ في
 * متنِ الوثيقةِ نفسِها.
 *
 * @param {EnvironmentContract} contract
 * @param {string} file
 */
function assertNoSecretValues(contract, file) {
  for (const variable of contract.variables) {
    for (const field of FORBIDDEN_VALUE_FIELDS) {
      if (Object.prototype.hasOwnProperty.call(variable, field)) {
        invalidContract(
          `المتغيّرُ «${variable.id}» يحمل الحقلَ «${field}» في ${path.basename(file)}؛ والعقدُ يُعلن الاسمَ والصيغةَ ولا يحمل قيمةً — فسرٌّ في وثيقةٍ متعقَّبةٍ سرٌّ انتهى.`,
        );
      }
    }
    try {
      new RegExp(variable.format);
    } catch (error) {
      invalidContract(
        `صيغةُ المتغيّرِ «${variable.id}» ليست تعبيراً نمطيّاً صالحاً (${errorText(error)})؛ وصيغةٌ لا تُصرَّف صيغةٌ لا تفحص شيئاً.`,
      );
    }
  }
}

/** @param {EnvironmentContract} contract */
function assertPhaseReferences(contract) {
  const toolIds = new Set(contract.toolchain.map((tool) => tool.id));
  const variableIds = new Set(contract.variables.map((variable) => variable.id));
  const profileIds = new Set(contract.profiles.map((profile) => profile.id));
  for (const phase of contract.phases) {
    if (!phase.idempotent) {
      refuse(
        ENV_ERRORS.PHASE_NOT_IDEMPOTENT,
        `الطورُ «${phase.id}» مُعلَنٌ غيرَ متكافئٍ؛ و«أمرٌ واحدٌ يُقيم البيئةَ» لا يقوم على طورٍ يُفسِد بيئةً قائمةً إن أُعيد.`,
        { phase: phase.id },
      );
    }
    if (phase.skipWhenToolMissing !== undefined && !toolIds.has(phase.skipWhenToolMissing)) {
      refuse(
        ENV_ERRORS.TOOL_UNDECLARED,
        `الطورُ «${phase.id}» يُتخطّى بغيابِ أداةٍ غيرِ مُعلَنةٍ «${phase.skipWhenToolMissing}»؛ وشرطُ تخطٍّ على أداةٍ لا تُفحَص شرطٌ لا يتحقّق أبداً.`,
        { phase: phase.id, tool: phase.skipWhenToolMissing },
      );
    }
    if (
      phase.skipWhenVariableUnset !== undefined &&
      !variableIds.has(phase.skipWhenVariableUnset)
    ) {
      refuse(
        ENV_ERRORS.VARIABLE_UNDECLARED,
        `الطورُ «${phase.id}» يُتخطّى بغيابِ متغيّرٍ غيرِ مُعلَنٍ «${phase.skipWhenVariableUnset}»؛ ومتغيّرٌ لا يُعلَن لا يُفحَص فلا يُتخطّى الطورُ ولو غاب.`,
        { phase: phase.id, variable: phase.skipWhenVariableUnset },
      );
    }
    for (const profile of phase.skipWhenProfileIn ?? []) {
      if (!profileIds.has(profile)) {
        refuse(
          ENV_ERRORS.PROFILE_UNDECLARED,
          `الطورُ «${phase.id}» يُتخطّى في وضعٍ غيرِ مُعلَنٍ «${profile}».`,
          { phase: phase.id, profile },
        );
      }
    }
  }
  for (const tool of contract.toolchain) {
    if (
      tool.minMajor !== undefined &&
      tool.maxMajor !== undefined &&
      tool.maxMajor < tool.minMajor
    ) {
      invalidContract(
        `مجالُ إصدارِ الأداةِ «${tool.id}» مقلوبٌ (${tool.minMajor}..${tool.maxMajor})؛ ومجالٌ مقلوبٌ يرفض كلَّ إصدارٍ فيُقرأ غيابُ الأداةِ خطأً في الأداة.`,
      );
    }
    for (const profile of tool.requiredIn) {
      if (!profileIds.has(profile)) {
        refuse(
          ENV_ERRORS.PROFILE_UNDECLARED,
          `الأداةُ «${tool.id}» لازمةٌ في وضعٍ غيرِ مُعلَنٍ «${profile}».`,
          { tool: tool.id, profile },
        );
      }
    }
  }
  for (const variable of contract.variables) {
    for (const profile of variable.requiredIn) {
      if (!profileIds.has(profile)) {
        refuse(
          ENV_ERRORS.PROFILE_UNDECLARED,
          `المتغيّرُ «${variable.id}» لازمٌ في وضعٍ غيرِ مُعلَنٍ «${profile}».`,
          { variable: variable.id, profile },
        );
      }
    }
  }
}

/** @param {EnvironmentContract} contract */
function assertProbeReferences(contract) {
  const toolIds = new Set(contract.toolchain.map((tool) => tool.id));
  const variableIds = new Set(contract.variables.map((variable) => variable.id));
  const directoryPaths = new Set(contract.directories.map((entry) => entry.path));
  for (const probe of contract.probes) {
    if (probe.kind === 'tool' && !toolIds.has(probe.target)) {
      refuse(
        ENV_ERRORS.TOOL_UNDECLARED,
        `المجسُّ «${probe.id}» يفحص أداةً غيرَ مُعلَنةٍ «${probe.target}»؛ ومجسٌّ على هدفٍ لا وجودَ له في العقدِ يُنتج حكماً على لا شيء.`,
        { probe: probe.id, target: probe.target },
      );
    }
    if (probe.kind === 'variable' && !variableIds.has(probe.target)) {
      refuse(
        ENV_ERRORS.VARIABLE_UNDECLARED,
        `المجسُّ «${probe.id}» يفحص متغيّراً غيرَ مُعلَنٍ «${probe.target}».`,
        { probe: probe.id, target: probe.target },
      );
    }
    if (probe.kind === 'directory' && !directoryPaths.has(probe.target)) {
      invalidContract(
        `المجسُّ «${probe.id}» يفحص مجلَّداً غيرَ مُعلَنٍ في directories «${probe.target}»؛ ومجلَّدٌ يُفحَص ولا يُنشئه طورٌ مجلَّدٌ يسقط فحصُه أبداً.`,
      );
    }
  }
}

/** @param {EnvironmentContract} contract */
function assertHealthCheck(contract) {
  const probeIds = new Set(contract.probes.map((probe) => probe.id));
  for (const required of contract.healthCheck.requiredProbes) {
    if (!probeIds.has(required)) {
      refuse(
        ENV_ERRORS.PROBE_UNDECLARED,
        `المجسُّ اللازمُ «${required}» غيرُ مُعلَنٍ في probes؛ ومجسٌّ لازمٌ لا وجودَ له يُوقف كلَّ فحصٍ بالرمزِ ENV_PROBE_MISSING إلى الأبد.`,
        { probe: required },
      );
    }
  }
  const verdictIds = contract.healthCheck.verdicts.map((verdict) => verdict.id);
  for (const verdict of HEALTH_VERDICTS) {
    if (!verdictIds.includes(verdict)) {
      refuse(
        ENV_ERRORS.VERDICT_UNDECLARED,
        `الحكمُ «${verdict}» غيرُ مُعلَنٍ في healthCheck.verdicts؛ وحكمٌ يُصدره الكودُ ولا تُعلنه الوثيقةُ حكمٌ لا يُعرَف رمزُ خروجِه.`,
        { verdict },
      );
    }
  }
  const unfit = contract.healthCheck.verdicts.find((verdict) => verdict.id === 'unfit');
  if (unfit !== undefined && unfit.exitCode === 0) {
    invalidContract(
      'حكمُ «unfit» بِرمزِ خروجٍ صفريٍّ؛ وحكمٌ بالفشلِ يخرج صفراً حكمٌ لا يقرؤه مسارٌ آليٌّ فيُدمَج على بيئةٍ غيرِ صالحة.',
    );
  }
}

/**
 * رمزُ الخروجِ المُعلَنُ لحكمٍ بعينِه — **من الوثيقةِ لا من الكود**.
 *
 * @param {EnvironmentContract} contract
 * @param {string} verdict
 * @returns {number}
 */
export function exitCodeOf(contract, verdict) {
  const found = contract.healthCheck.verdicts.find((entry) => entry.id === verdict);
  if (found === undefined) {
    refuse(ENV_ERRORS.VERDICT_UNDECLARED, `حكمٌ غيرُ مُعلَنٍ «${verdict}».`, { verdict });
  }
  return found.exitCode;
}
