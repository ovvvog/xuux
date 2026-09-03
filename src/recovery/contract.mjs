/**
 * تحميلُ عقدِ التعافي والتحقّقُ من ترابطِه — الخطوة `M10.08`.
 *
 * **العقدُ يُرفَض عند التحميلِ لا عند الاستعمال:** فأطوارٌ ترتيبُها مثلومٌ، أو
 * حكمٌ بلا رمزِ خروجٍ، أو دوريّةٌ ليست عدداً، لا يجوز أن تظهر في منتصفِ تجربةِ
 * تعافٍ وقد فُرِّغ جذرُ الاستعادةِ فعلاً.
 *
 * والضمانُ المُنفَّذُ هنا `G-RECOVERY-SINGLE-SOURCE-RPO`: **نافذةُ الفقدِ**
 * المقبولةُ تُشتقُّ من عقدِ الأقاليمِ (`config/regions.yaml` ⇐
 * `consistency.maxReplicationLagMs`) وتُلحَق بعقدِ التعافي عند تحميلِه؛ **ولا
 * يحمل عقدُ التعافي رقماً لها أصلاً** — يُثبت ذلك المخطَّطُ الصارمُ ويحرسه
 * الحاجزُ نصّاً. فمن كتب النافذةَ مرَّتين شدَّد إحداهما يوماً ونسي الأخرى، ثم
 * احتجَّ في لحظةِ العطلِ بالرقمِ الذي يُريحه.
 *
 * @module recovery/contract
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import Ajv2020Default from 'ajv/dist/2020.js';

// وحزمةُ Ajv تُصدِّر صنفَها افتراضاً في ESM، فيُقرأ نوعُه صريحاً وإلا صار «غيرَ
// قابلٍ للإنشاء» في الفحصِ الصارم — كما في وحداتِ البيئةِ والنشرِ والأقاليمِ قبلَها.
const Ajv2020 = /** @type {typeof import('ajv/dist/2020.js').Ajv2020} */ (
  /** @type {unknown} */ (Ajv2020Default)
);
import YAML from 'yaml';

import { loadRegionsContract } from '../regions/contract.mjs';

import { RECOVERY_ERRORS, RecoveryError } from './errors.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** مجلَّدُ الوثائقِ الافتراضيُّ لعقدِ التعافي. */
export const DEFAULT_RECOVERY_CONFIG_DIR = path.resolve(HERE, '..', '..', 'config');

/**
 * @typedef {object} RecoveryPhase
 * @property {string} id
 * @property {number} order
 * @property {string} purpose
 */

/**
 * @typedef {object} RecoveryVerdict
 * @property {string} id
 * @property {number} exitCode
 * @property {string} meaning
 */

/**
 * @typedef {object} RecoveryContract
 * @property {string} version
 * @property {{ maxRecoveryMs: number, statement: string }} objective
 * @property {{ everyDays: number, graceDays: number, label: string }} cadence
 * @property {RecoveryPhase[]} phases
 * @property {RecoveryVerdict[]} verdicts
 * @property {{ stateRoot: string, backupRoot: string, restoreRoot: string }} source
 * @property {{ path: string, lastDrillPath: string }} ledger
 * @property {string[]} events
 * @property {{ code: string, when: string }[]} refusalCodes
 * @property {{ id: string, statement: string, enforcedIn: string }[]} guarantees
 * @property {number} maxDataLossMs نافذةُ الفقدِ المشتقّةُ من عقدِ الأقاليمِ — مصدرُها واحدٌ خارجَ هذا العقد.
 */

/**
 * @param {string} code
 * @param {string} message
 * @param {Record<string, unknown>} [detail]
 * @returns {never}
 */
function refuse(code, message, detail = {}) {
  throw new RecoveryError(code, message, detail);
}

/** @param {unknown} error @returns {string} */
function errorText(error) {
  return error instanceof Error ? error.message : String(error);
}

/** @param {string} message @returns {never} */
function invalidContract(message) {
  refuse(RECOVERY_ERRORS.CONFIG_INVALID, message);
}

/**
 * تحميلُ عقدِ التعافي من `config/recovery.yaml` والتحقّقُ منه بمخطَّطِه الصارمِ
 * ثم بترابطِه، ثم **اشتقاقُ نافذةِ الفقدِ من عقدِ الأقاليمِ** لا من هذا العقد.
 *
 * @param {{ dir?: string }} [options]
 * @returns {RecoveryContract}
 */
export function loadRecoveryContract(options = {}) {
  const dir = options.dir ?? DEFAULT_RECOVERY_CONFIG_DIR;
  const schemaDir = fs.existsSync(path.join(dir, 'schemas')) ? dir : DEFAULT_RECOVERY_CONFIG_DIR;
  const file = path.join(dir, 'recovery.yaml');
  if (!fs.existsSync(file)) {
    invalidContract(
      'عقدُ التعافي غائب؛ ودولةٌ بلا عهدِ تعافٍ دولةٌ تَعِد بالعودةِ ولا تقول متى ولا كيف تُقاس.',
    );
  }
  /** @type {unknown} */
  let raw;
  try {
    raw = YAML.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    invalidContract(`تعذّرت قراءة recovery.yaml: ${errorText(error)}`);
  }
  const schemaPath = path.join(schemaDir, 'schemas', 'recovery.schema.json');
  if (!fs.existsSync(schemaPath)) {
    invalidContract(
      'مخطَّطُ عقدِ التعافي غائب؛ وبلا مخطَّطٍ يصير العقدُ نصّاً حرّاً كالحالِ الذي جاء ليُغلقه.',
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
    invalidContract(`عقدُ التعافي يخالف مخطَّطَه: ${problems}`);
  }
  const parsed = /** @type {RecoveryContract} */ (raw);

  assertObjective(parsed);
  assertCadence(parsed);
  assertPhases(parsed);
  assertVerdicts(parsed);
  assertRoots(parsed);
  assertGuarantees(parsed);

  // الضمان `G-RECOVERY-SINGLE-SOURCE-RPO`: الرقمُ يُقرأ من هناك ولا يُكتب هنا.
  const regions = loadRegionsContract({ dir });
  return Object.freeze({ ...parsed, maxDataLossMs: regions.maxDataLossMs });
}

/** @param {RecoveryContract} contract */
function assertObjective(contract) {
  const target = contract.objective.maxRecoveryMs;
  if (!Number.isSafeInteger(target) || target <= 0) {
    refuse(
      RECOVERY_ERRORS.OBJECTIVE_INVALID,
      `زمنُ التعافي المستهدَف «${String(target)}» ليس عدداً صحيحاً موجباً — وعهدٌ بلا رقمٍ طمأنةٌ لا عهد.`,
      { maxRecoveryMs: target },
    );
  }
}

/** @param {RecoveryContract} contract */
function assertCadence(contract) {
  const { everyDays, graceDays } = contract.cadence;
  if (!Number.isSafeInteger(everyDays) || everyDays <= 0) {
    refuse(
      RECOVERY_ERRORS.CADENCE_INVALID,
      `دوريّةُ التجربةِ «${String(everyDays)}» ليست عددَ أيّامٍ صالحاً — و«دوريّةٌ» بلا رقمٍ عادةٌ تُنسى.`,
      { everyDays },
    );
  }
  if (!Number.isSafeInteger(graceDays) || graceDays < 0) {
    refuse(
      RECOVERY_ERRORS.CADENCE_INVALID,
      `سماحُ التأخّرِ «${String(graceDays)}» ليس عدداً صحيحاً غيرَ سالبٍ.`,
      { graceDays },
    );
  }
  if (graceDays >= everyDays) {
    refuse(
      RECOVERY_ERRORS.CADENCE_INVALID,
      'سماحُ التأخّرِ يساوي الدوريّةَ أو يجاوزها — وسماحٌ بهذا الاتّساعِ يُلغي الدوريّةَ ولا يرحمها.',
      { everyDays, graceDays },
    );
  }
}

/** @param {RecoveryContract} contract */
function assertPhases(contract) {
  /** @type {Set<string>} */
  const ids = new Set();
  const orders = contract.phases.map((phase) => phase.order).sort((a, b) => a - b);
  for (const phase of contract.phases) {
    if (ids.has(phase.id)) {
      invalidContract(`الطور «${phase.id}» مُعلَنٌ مرّتين — وطورٌ برتبتين رتبةٌ لا تُقرأ.`);
    }
    ids.add(phase.id);
  }
  for (const [index, order] of orders.entries()) {
    if (order !== index + 1) {
      refuse(
        RECOVERY_ERRORS.PHASE_ORDER_INVALID,
        'رتبُ الأطوارِ ليست متتاليةً من واحدٍ بلا فجوةٍ ولا تكرارٍ — وترتيبٌ مثلومٌ ترتيبٌ يُقرَّر بالحظّ.',
        { orders },
      );
    }
  }
  for (const required of ['phase:capture', 'phase:wipe', 'phase:restore', 'phase:verify']) {
    if (!ids.has(required)) {
      refuse(
        RECOVERY_ERRORS.PHASE_ORDER_INVALID,
        `الطور «${required}» غيرُ مُعلَنٍ في العقد — وأربعةُ أطوارٍ لا ثلاثةٌ ولا اثنان.`,
        { phase: required },
      );
    }
  }
  const wipe = contract.phases.find((phase) => phase.id === 'phase:wipe');
  const restore = contract.phases.find((phase) => phase.id === 'phase:restore');
  if (wipe !== undefined && restore !== undefined && wipe.order >= restore.order) {
    refuse(
      RECOVERY_ERRORS.PHASE_ORDER_INVALID,
      'الاستعادةُ مُرتَّبةٌ قبل التفريغِ — ومن استعاد فوقَ حالةٍ قائمةٍ قاس بقاءَ ما كان لا عودةَ ما ذهب.',
      { wipe: wipe.order, restore: restore.order },
    );
  }
}

/** @param {RecoveryContract} contract */
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
        `رمزُ الخروج ${String(verdict.exitCode)} مُعلَنٌ لحكمين — والمسارُ الآليُّ يقرأ الرمزَ لا الاسمَ.`,
      );
    }
    ids.add(verdict.id);
    codes.add(verdict.exitCode);
  }
  for (const required of ['recovery:met', 'recovery:missed', 'recovery:unmeasured']) {
    if (!ids.has(required)) {
      refuse(
        RECOVERY_ERRORS.VERDICT_UNDECLARED,
        `الحكم «${required}» غيرُ مُعلَنٍ في العقد — وثلاثةُ أحوالٍ لا اثنان.`,
        { verdict: required },
      );
    }
  }
  const met = contract.verdicts.find((verdict) => verdict.id === 'recovery:met');
  if (met !== undefined && met.exitCode !== 0) {
    invalidContract(
      'رمزُ خروجِ حكمِ البلوغِ ليس صفراً — والمسارُ الآليُّ يقرأ الصفرَ نجاحاً، فمن غيّره جعل نجاحَه فشلاً.',
    );
  }
  for (const verdict of contract.verdicts) {
    if (verdict.id !== 'recovery:met' && verdict.exitCode === 0) {
      invalidContract(
        `الحكم «${verdict.id}» يخرج صفراً — وحكمٌ بالإخفاقِ يخرج صفراً حكمٌ لا يقرؤه مسارٌ آليّ.`,
      );
    }
  }
}

/** @param {RecoveryContract} contract */
function assertRoots(contract) {
  const roots = [
    contract.source.stateRoot,
    contract.source.backupRoot,
    contract.source.restoreRoot,
  ].map((root) => root.replace(/\/+$/u, ''));
  for (const [index, root] of roots.entries()) {
    for (const [other, otherRoot] of roots.entries()) {
      if (index === other) {
        continue;
      }
      if (root === otherRoot || otherRoot.startsWith(`${root}/`)) {
        invalidContract(
          `جذرانِ متداخلانِ في عقدِ التعافي (${root} و${otherRoot}) — ومن فرَّغ جذراً يحوي نسختَه محا ما جاء يستعيده.`,
        );
      }
    }
  }
  if (contract.ledger.path === contract.ledger.lastDrillPath) {
    invalidContract(
      'مسارُ الدفترِ ومسارُ سجلِّ آخرِ تجربةٍ واحدٌ — ومعنيانِ في موضعٍ واحدٍ يُفسدانِ معاً.',
    );
  }
}

/** @param {RecoveryContract} contract */
function assertGuarantees(contract) {
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
 * رمزُ خروجِ حكمٍ معلَنٍ.
 *
 * @param {RecoveryContract} contract
 * @param {string} verdictId
 * @returns {number}
 */
export function exitCodeFor(contract, verdictId) {
  const verdict = contract.verdicts.find((entry) => entry.id === verdictId);
  if (verdict === undefined) {
    refuse(RECOVERY_ERRORS.VERDICT_UNDECLARED, `الحكم «${verdictId}» غيرُ مُعلَنٍ في العقد.`, {
      verdict: verdictId,
    });
  }
  return verdict.exitCode;
}
