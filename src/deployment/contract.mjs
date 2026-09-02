/**
 * تحميلُ عقدِ النشرِ والتحقّقُ من ترابطِه — الخطوة `M10.06`.
 *
 * **العقدُ يُرفَض عند التحميلِ لا عند الاستعمال:** فبوابةٌ تُشير إلى هدفِ خدمةٍ
 * لم يُعلَن، أو حكمٌ يُطلَق التراجعُ عليه ولا رمزَ خروجٍ له، لا يجوز أن يظهرا في
 * منتصفِ نشرٍ بعد أن قُدِّمت موجتانِ على مستفيدين.
 *
 * والضمانُ المُنفَّذُ هنا `G-DEPLOY-SINGLE-SOURCE-THRESHOLDS`: عتباتُ بواباتِ
 * النشرِ **أهدافُ `config/service-levels.yaml` بمعرّفاتِها**، تُقرأ من وثيقتِها
 * وتُلحَق بالعقدِ عند تحميلِه؛ ولا يحمل عقدُ النشرِ رقمَ هدفٍ ولا عتبةَ زمنٍ
 * أصلاً — يُثبت ذلك المخطَّطُ الصارمُ ويحرسه الحاجزُ نصّاً. فمن كتب العتبةَ
 * مرّتين شدّد إحداهما يوماً ونسي الأخرى، فبقيت بوابةُ نشرِه خضراءَ على عهدٍ لم
 * يعد قائماً.
 *
 * @module deployment/contract
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import Ajv2020Default from 'ajv/dist/2020.js';

// وحزمةُ Ajv تُصدِّر صنفَها افتراضاً في ESM، فيُقرأ نوعُه صريحاً وإلا صار «غيرَ
// قابلٍ للإنشاء» في الفحصِ الصارم — كما في وحدةِ البيئةِ قبلَها.
const Ajv2020 = /** @type {typeof import('ajv/dist/2020.js').Ajv2020} */ (
  /** @type {unknown} */ (Ajv2020Default)
);
import YAML from 'yaml';

import { loadServiceLevelPolicy } from '../service-levels/service-levels.mjs';

import { DEPLOY_ERRORS, DeploymentError } from './errors.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** مجلَّدُ الوثائقِ الافتراضيُّ لعقدِ النشر. */
export const DEFAULT_DEPLOYMENT_CONFIG_DIR = path.resolve(HERE, '..', '..', 'config');

/**
 * @typedef {object} DeploymentWave
 * @property {string} id
 * @property {number} order
 * @property {number} sharePercent
 * @property {number} minObservations
 * @property {number} timeoutMs
 * @property {string[]} objectives
 * @property {string} statement
 */

/**
 * @typedef {object} DeploymentVerdict
 * @property {string} id
 * @property {number} exitCode
 * @property {string} statement
 */

/**
 * @typedef {object} DeploymentContract
 * @property {number} version
 * @property {string} statement
 * @property {{ idPattern: string, manifestFile: string, probeFile: string, statement: string }} release
 * @property {DeploymentWave[]} waves
 * @property {{ automatic: boolean, triggerOn: string[], maxDurationMs: number, statement: string }} rollback
 * @property {DeploymentVerdict[]} verdicts
 * @property {{ path: string, pointerPath: string, releasesPath: string, statement: string }} ledger
 * @property {{ events: { type: string, statement: string }[] }} audit
 * @property {{ code: string, statement: string }[]} refusalCodes
 * @property {{ id: string, file: string, statement: string }[]} guarantees
 * @property {Readonly<Record<string, { id: string, target: number }>>} objectives أهدافُ الخدمةِ المُلحَقةُ من وثيقتِها — مصدرُ العتباتِ الوحيد.
 */

/**
 * @param {string} code
 * @param {string} message
 * @param {Record<string, unknown>} [detail]
 * @returns {never}
 */
function refuse(code, message, detail = {}) {
  throw new DeploymentError(code, message, detail);
}

/** @param {unknown} error @returns {string} */
function errorText(error) {
  return error instanceof Error ? error.message : String(error);
}

/** @param {string} message @returns {never} */
function invalidContract(message) {
  refuse(DEPLOY_ERRORS.CONFIG_INVALID, message);
}

/**
 * تحميلُ عقدِ النشرِ من `config/deployment.yaml` والتحقّقُ منه بمخطَّطِه الصارمِ
 * ثم بترابطِه، ثم إلحاقُ أهدافِ الخدمةِ المُشار إليها من وثيقتِها.
 *
 * @param {{ dir?: string }} [options]
 * @returns {DeploymentContract}
 */
export function loadDeploymentContract(options = {}) {
  const dir = options.dir ?? DEFAULT_DEPLOYMENT_CONFIG_DIR;
  const schemaDir = fs.existsSync(path.join(dir, 'schemas')) ? dir : DEFAULT_DEPLOYMENT_CONFIG_DIR;
  const file = path.join(dir, 'deployment.yaml');
  if (!fs.existsSync(file)) {
    invalidContract(
      'عقدُ النشرِ غائب؛ ونشرٌ بلا عقدٍ يُعلن موجاتِه وبواباتِه نشرٌ يُنفَّذ بذاكرةِ من نفّذه ويختلف من مرّةٍ إلى مرّة.',
    );
  }
  /** @type {unknown} */
  let raw;
  try {
    raw = YAML.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    invalidContract(`تعذّرت قراءة deployment.yaml: ${errorText(error)}`);
  }
  const schemaPath = path.join(schemaDir, 'schemas', 'deployment.schema.json');
  if (!fs.existsSync(schemaPath)) {
    invalidContract(
      'مخطَّطُ عقدِ النشرِ غائب؛ وبلا مخطَّطٍ يصير العقدُ نصّاً حرّاً كالحالِ الذي جاء ليُغلقه.',
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
    invalidContract(`عقدُ النشرِ يخالف مخطَّطَه: ${problems}`);
  }
  const parsed = /** @type {DeploymentContract} */ (raw);

  assertReleasePattern(parsed);
  assertVerdicts(parsed);
  assertLedgerPaths(parsed);
  assertGuaranteeFiles(parsed);
  const objectives = collectObjectives(parsed, dir);

  return Object.freeze({ ...parsed, objectives });
}

/** @param {DeploymentContract} contract */
function assertReleasePattern(contract) {
  try {
    new RegExp(contract.release.idPattern, 'u');
  } catch (error) {
    invalidContract(`صيغةُ هويّةِ الإصدارِ ليست تعبيراً نمطيّاً صالحاً: ${errorText(error)}`);
  }
}

/** @param {DeploymentContract} contract */
function assertVerdicts(contract) {
  /** @type {Set<string>} */
  const ids = new Set();
  /** @type {Set<number>} */
  const codes = new Set();
  for (const verdict of contract.verdicts) {
    if (ids.has(verdict.id)) {
      invalidContract(`الحكم «${verdict.id}» مُعلَنٌ مرّتين — وحكمٌ برمزَي خروجٍ حكمانِ لا حكم.`);
    }
    if (codes.has(verdict.exitCode)) {
      invalidContract(
        `رمزُ الخروج ${String(verdict.exitCode)} مُعلَنٌ لحكمين — والمسارُ الآليُّ يقرأ الرمزَ لا الاسمَ، فرمزٌ لحكمين لا يُميَّز.`,
      );
    }
    ids.add(verdict.id);
    codes.add(verdict.exitCode);
  }
  for (const required of ['verdict:healthy', 'verdict:broken', 'verdict:unmeasured']) {
    if (!ids.has(required)) {
      invalidContract(`الحكم «${required}» غيرُ مُعلَنٍ في العقد — وثلاثةُ أحوالٍ لا اثنان.`);
    }
  }
  for (const trigger of contract.rollback.triggerOn) {
    if (!ids.has(trigger)) {
      refuse(
        DEPLOY_ERRORS.VERDICT_UNDECLARED,
        `سياسةُ التراجعِ تُطلَق على الحكم «${trigger}» ولا إعلانَ له في العقد.`,
        { verdict: trigger },
      );
    }
  }
  const healthy = contract.verdicts.find((verdict) => verdict.id === 'verdict:healthy');
  if (healthy !== undefined && healthy.exitCode !== 0) {
    invalidContract(
      'رمزُ خروجِ الحكمِ الصحيحِ ليس صفراً — والمسارُ الآليُّ يقرأ الصفرَ نجاحاً، فمن غيّره جعل نجاحَه فشلاً.',
    );
  }
  if (contract.rollback.triggerOn.includes('verdict:healthy')) {
    invalidContract('التراجعُ مُطلَقٌ على الحكمِ الصحيح — وذلك عقدٌ لا يُنشَر به شيءٌ أبداً.');
  }
}

/** @param {DeploymentContract} contract */
function assertLedgerPaths(contract) {
  const paths = [contract.ledger.path, contract.ledger.pointerPath, contract.ledger.releasesPath];
  if (new Set(paths).size !== paths.length) {
    invalidContract(
      'مساراتُ الدفترِ والمؤشِّرِ والإصداراتِ متداخلةٌ — وموضعٌ واحدٌ لمعنيين يُفسدهما معاً.',
    );
  }
}

/** @param {DeploymentContract} contract */
function assertGuaranteeFiles(contract) {
  /** @type {Set<string>} */
  const ids = new Set();
  for (const guarantee of contract.guarantees) {
    if (ids.has(guarantee.id)) {
      invalidContract(`الضمان «${guarantee.id}» مُعلَنٌ مرّتين في العقد.`);
    }
    ids.add(guarantee.id);
  }
}

/**
 * إلحاقُ أهدافِ الخدمةِ المُشار إليها في البواباتِ من وثيقتِها — لا نسخةَ ثانيةً
 * لها هنا (`G-DEPLOY-SINGLE-SOURCE-THRESHOLDS`).
 *
 * @param {DeploymentContract} contract
 * @param {string} dir
 * @returns {Readonly<Record<string, { id: string, target: number }>>}
 */
function collectObjectives(contract, dir) {
  /** @type {import('../service-levels/service-levels.mjs').ServiceLevelPolicy} */
  let policy;
  try {
    policy = loadServiceLevelPolicy({ dir });
  } catch (error) {
    invalidContract(
      `وثيقةُ أهدافِ الخدمةِ لا تُحمَّل فلا تُقرأ عتباتُ بواباتِ النشر: ${errorText(error)}`,
    );
  }
  /** @type {Record<string, { id: string, target: number }>} */
  const objectives = {};
  for (const capability of policy.capabilities) {
    for (const objective of capability.objectives) {
      objectives[objective.id] = Object.freeze({ id: objective.id, target: objective.target });
    }
  }
  for (const wave of contract.waves) {
    for (const objectiveId of wave.objectives) {
      if (objectives[objectiveId] === undefined) {
        refuse(
          DEPLOY_ERRORS.OBJECTIVE_UNDECLARED,
          `بوابةُ الموجةِ «${wave.id}» تُشير إلى الهدف «${objectiveId}» ولا إعلانَ له في config/service-levels.yaml — وبوابةٌ بعتبةٍ بلا عهدٍ خلفَها بوابةٌ تحرس رقماً لا وعداً.`,
          { wave: wave.id, objective: objectiveId },
        );
      }
    }
  }
  return Object.freeze(objectives);
}
