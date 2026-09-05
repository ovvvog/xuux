/**
 * تحميلُ عقدِ تمرينِ الطوارئ والتحقّقُ من ترابطِه — الخطوة `M11.07`.
 *
 * **العقدُ يُرفَض عند التحميلِ لا في منتصفِ تمرينٍ:** فطورٌ بلا عهدِ زمنٍ، أو
 * طورٌ بلا إنفاذٍ مقيسٍ، أو أطوارٌ غيرُ متتاليةٍ، أو حكمٌ يخرج صفراً وهو إخفاقٌ،
 * أو مجموعُ عهودِ الأطوارِ يتجاوز عهدَ التمرينِ كلِّه — كلُّ ذلك لا يجوز أن
 * يُكتشَف بعد أن تُوقَف الدولةُ ويُحجَر وكيلٌ ويُفرَّغ جذرٌ ويُستعاد.
 *
 * والضمانُ المُنفَّذُ هنا `G-EMERGENCY-ONLY-READINESS-EXITS-ZERO`: لكلِّ حكمٍ
 * رمزُ خروجٍ **مُفرَدٌ**، و**الجاهزيّةُ وحدَها** تخرج صفراً؛ فحكمٌ بالإخفاقِ يخرج
 * صفراً حكمٌ لا يقرؤه مسارٌ آليٌّ، وبوابةٌ تقرأ الصفرَ نجاحاً تُصدِّق تمريناً لم
 * يقع.
 *
 * @module emergency/contract
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import Ajv2020Default from 'ajv/dist/2020.js';

// وحزمةُ Ajv تُصدِّر صنفَها افتراضاً في ESM، فيُقرأ نوعُه صريحاً وإلا صار «غيرَ
// قابلٍ للإنشاء» في الفحصِ الصارم — كما في وحداتِ التعافي والفوضى قبلَها.
const Ajv2020 = /** @type {typeof import('ajv/dist/2020.js').Ajv2020} */ (
  /** @type {unknown} */ (Ajv2020Default)
);
import YAML from 'yaml';

import { EMERGENCY_ERRORS, EmergencyError } from './errors.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** مجلَّدُ الوثائقِ الافتراضيُّ لعقدِ تمرينِ الطوارئ. */
export const DEFAULT_EMERGENCY_CONFIG_DIR = path.resolve(HERE, '..', '..', 'config');

/** حكمُ الجاهزيّةِ — وهو **الحكمُ الوحيدُ** المسموحُ له بالخروجِ صفراً. */
export const READY_VERDICT = 'emergency:ready';

/**
 * @typedef {object} EmergencyPhase
 * @property {string} id
 * @property {number} order
 * @property {number} maxMs
 * @property {string} purpose
 * @property {string} enforcement
 * @property {string} enforcedBy
 */

/**
 * @typedef {object} EmergencyVerdict
 * @property {string} id
 * @property {number} exitCode
 * @property {string} meaning
 */

/**
 * @typedef {object} EmergencyContract
 * @property {string} version
 * @property {{ maxDrillMs: number, statement: string }} objective
 * @property {EmergencyPhase[]} phases
 * @property {EmergencyVerdict[]} verdicts
 * @property {{ stateRoot: string, reportsDir: string }} source
 * @property {{ path: string, lastDrillPath: string }} ledger
 * @property {string[]} events
 * @property {{ code: string, when: string }[]} refusalCodes
 * @property {{ id: string, statement: string, enforcedIn: string }[]} guarantees
 */

/** @param {string} message @returns {never} */
function invalidContract(message) {
  throw new EmergencyError(EMERGENCY_ERRORS.CONFIG_INVALID, message);
}

/** @param {unknown} error @returns {string} */
function errorText(error) {
  return error instanceof Error ? error.message : String(error);
}

/**
 * يُحمِّل العقدَ ويُصادِق عليه بمخطَّطِه الصارمِ ثم يفحص ترابطَه.
 *
 * @param {{ configDir?: string }} [options]
 * @returns {EmergencyContract}
 */
export function loadEmergencyContract(options = {}) {
  const configDir = options.configDir ?? DEFAULT_EMERGENCY_CONFIG_DIR;
  const contractFile = path.join(configDir, 'emergency-drill.yaml');
  const schemaFile = path.join(configDir, 'schemas', 'emergency-drill.schema.json');
  if (!fs.existsSync(contractFile)) {
    invalidContract(`عقدُ تمرينِ الطوارئ غائبٌ: ${contractFile} — ولا تمرينَ بلا عقدٍ يُقاس عليه.`);
  }
  if (!fs.existsSync(schemaFile)) {
    invalidContract(`مخطَّطُ العقدِ غائبٌ: ${schemaFile} — وعقدٌ بلا مخطَّطٍ نصٌّ لا يُصادَق.`);
  }

  /** @type {unknown} */
  let parsed;
  try {
    parsed = YAML.parse(fs.readFileSync(contractFile, 'utf8'));
  } catch (error) {
    invalidContract(`تعذّر تحليلُ ${contractFile}: ${errorText(error)}`);
  }

  /** @type {import('ajv/dist/2020.js').Ajv2020} */
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  const validate = ajv.compile(JSON.parse(fs.readFileSync(schemaFile, 'utf8')));
  if (!validate(parsed)) {
    const problems = (validate.errors ?? [])
      .map((entry) => `${entry.instancePath || '/'} ${entry.message ?? ''}`.trim())
      .join('؛ ');
    invalidContract(`العقدُ يُخالف مخطَّطَه: ${problems}`);
  }

  const contract = /** @type {EmergencyContract} */ (parsed);

  // ── الأطوارُ: متتاليةٌ من واحدٍ بلا فجوةٍ ولا تكرارٍ، ولكلٍّ عهدُ زمنٍ موجب ──
  const orders = contract.phases.map((phase) => phase.order).sort((left, right) => left - right);
  for (let index = 0; index < orders.length; index += 1) {
    if (orders[index] !== index + 1) {
      throw new EmergencyError(
        EMERGENCY_ERRORS.PHASE_ORDER_INVALID,
        `ترتيبُ الأطوارِ ليس متتالياً من واحدٍ: ${orders.join('،')} — وترتيبٌ فيه فجوةٌ يجعل «الطورَ التالي» مجهولاً.`,
      );
    }
  }
  const ids = new Set(contract.phases.map((phase) => phase.id));
  if (ids.size !== contract.phases.length) {
    throw new EmergencyError(
      EMERGENCY_ERRORS.PHASE_ORDER_INVALID,
      'معرَّفُ طورٍ مكرَّرٌ — ومعرَّفٌ مكرَّرٌ يجعل حكمَ الطورِ ملتبساً.',
    );
  }

  // ── العهدُ: مجموعُ عهودِ الأطوارِ لا يتجاوز عهدَ التمرينِ كلِّه ──
  const sum = contract.phases.reduce((total, phase) => total + phase.maxMs, 0);
  if (!Number.isSafeInteger(contract.objective.maxDrillMs) || contract.objective.maxDrillMs <= 0) {
    throw new EmergencyError(
      EMERGENCY_ERRORS.OBJECTIVE_INVALID,
      'زمنُ التمرينِ المستهدَفُ ليس عدداً صحيحاً موجباً منتهياً.',
    );
  }
  if (sum > contract.objective.maxDrillMs) {
    throw new EmergencyError(
      EMERGENCY_ERRORS.OBJECTIVE_INVALID,
      `مجموعُ عهودِ الأطوارِ (${sum}) يتجاوز عهدَ التمرينِ كلِّه (${contract.objective.maxDrillMs}) — فعهدٌ لا يُمكن بلوغُه بأطوارِه عهدٌ يُخلَف بالحساب قبل التشغيل.`,
    );
  }

  // ── الأحكامُ: رمزُ خروجٍ مُفرَدٌ لكلٍّ، والجاهزيّةُ وحدَها تخرج صفراً ──
  const codes = new Set();
  for (const verdict of contract.verdicts) {
    if (codes.has(verdict.exitCode)) {
      invalidContract(
        `رمزُ الخروجِ ${verdict.exitCode} مكرَّرٌ بين حكمَين — ورمزٌ مشتركٌ يجعل الحكمَين واحداً في قراءةِ المسارِ الآليّ.`,
      );
    }
    codes.add(verdict.exitCode);
    if (verdict.exitCode === 0 && verdict.id !== READY_VERDICT) {
      invalidContract(
        `الحكمُ ${verdict.id} يخرج صفراً وهو ليس حكمَ الجاهزيّةِ — والصفرُ يُقرأ نجاحاً في كلِّ مسارٍ آليّ.`,
      );
    }
  }
  const ready = contract.verdicts.find((verdict) => verdict.id === READY_VERDICT);
  if (ready === undefined) {
    invalidContract(`حكمُ الجاهزيّةِ ${READY_VERDICT} غيرُ معلَنٍ في العقد.`);
  }
  if (ready.exitCode !== 0) {
    invalidContract(
      `حكمُ الجاهزيّةِ يخرج ${ready.exitCode} لا صفراً — فبوابةٌ تقرأ الصفرَ نجاحاً لن ترى نجاحاً أبداً.`,
    );
  }

  return contract;
}

/**
 * رمزُ خروجِ حكمٍ **مقروءٌ من العقدِ** لا مكتوبٌ في منفِّذٍ.
 *
 * @param {EmergencyContract} contract
 * @param {string} verdictId
 * @returns {number}
 */
export function exitCodeFor(contract, verdictId) {
  const verdict = contract.verdicts.find((entry) => entry.id === verdictId);
  if (verdict === undefined) {
    throw new EmergencyError(
      EMERGENCY_ERRORS.VERDICT_UNDECLARED,
      `الحكمُ «${verdictId}» غيرُ معلَنٍ في العقدِ — ولا يُخترَع حكمٌ في منفِّذ.`,
    );
  }
  return verdict.exitCode;
}
