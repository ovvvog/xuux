/**
 * تحميلُ عقدِ اختباراتِ الفوضى والتحقّقُ من ترابطِه — الخطوة `M10.09`.
 *
 * **العقدُ يُرفَض عند التحميلِ لا في منتصفِ تجربةٍ:** فتجربةٌ بلا فرضيّةٍ، أو
 * عطبٌ بلا رقمٍ، أو حكمٌ يخرج صفراً وهو انحرافٌ، أو انحرافٌ مُقيَّدٌ بلا
 * مُدخلةِ عملٍ تُغلِقه — كلُّ ذلك لا يجوز أن يُكتشَف بعد أن تُقتل عمليّةٌ
 * ويُملأ قرصٌ وتُدسَّ سطورٌ فاسدةٌ في دفتر.
 *
 * والضمانُ المُنفَّذُ هنا `G-CHAOS-ONLY-RESILIENCE-EXITS-ZERO`: لكلِّ حكمٍ
 * رمزُ خروجٍ **مُفرَدٌ**، و**الصمودُ وحدَه** يخرج صفراً؛ فحكمٌ بالانحرافِ يخرج
 * صفراً حكمٌ لا يقرؤه مسارٌ آليٌّ، وبوابةٌ تقرأ الصفرَ نجاحاً تُصدِّق فوضى لم
 * تصمد.
 *
 * @module chaos/contract
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import Ajv2020Default from 'ajv/dist/2020.js';

// وحزمةُ Ajv تُصدِّر صنفَها افتراضاً في ESM، فيُقرأ نوعُه صريحاً وإلا صار «غيرَ
// قابلٍ للإنشاء» في الفحصِ الصارم — كما في وحداتِ الأقاليمِ والتعافي قبلَها.
const Ajv2020 = /** @type {typeof import('ajv/dist/2020.js').Ajv2020} */ (
  /** @type {unknown} */ (Ajv2020Default)
);
import YAML from 'yaml';

import { CHAOS_ERRORS, ChaosError } from './errors.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** مجلَّدُ الوثائقِ الافتراضيُّ لعقدِ الفوضى. */
export const DEFAULT_CHAOS_CONFIG_DIR = path.resolve(HERE, '..', '..', 'config');

/** حكمُ الصمودِ — وهو **الحكمُ الوحيدُ** المسموحُ له بالخروجِ صفراً. */
export const RESILIENT_VERDICT = 'chaos:resilient';

/**
 * @typedef {object} ChaosFault
 * @property {string} kind
 * @property {number} magnitude
 * @property {string} unit
 * @property {string} description
 */

/**
 * @typedef {object} ChaosExperiment
 * @property {string} id
 * @property {number} order
 * @property {ChaosFault} fault
 * @property {string} target
 * @property {string} hypothesis
 * @property {string} deviationCode
 */

/**
 * @typedef {object} ChaosVerdict
 * @property {string} id
 * @property {number} exitCode
 * @property {string} meaning
 */

/**
 * @typedef {object} ChaosDeviation
 * @property {string} code
 * @property {string} experiment
 * @property {string} finding
 * @property {string} fixedIn
 * @property {string} marker
 * @property {string} closedBy
 */

/**
 * @typedef {object} ChaosContract
 * @property {string} version
 * @property {ChaosExperiment[]} experiments
 * @property {ChaosVerdict[]} verdicts
 * @property {ChaosDeviation[]} deviations
 * @property {{ root: string }} source
 * @property {{ path: string }} ledger
 * @property {string[]} events
 * @property {{ code: string, when: string }[]} refusalCodes
 * @property {{ id: string, statement: string, enforcedIn: string }[]} guarantees
 */

/**
 * @param {string} code
 * @param {string} message
 * @param {Record<string, unknown>} [detail]
 * @returns {never}
 */
function refuse(code, message, detail = {}) {
  throw new ChaosError(code, message, detail);
}

/** @param {unknown} error @returns {string} */
function errorText(error) {
  return error instanceof Error ? error.message : String(error);
}

/** @param {string} message @returns {never} */
function invalidContract(message) {
  refuse(CHAOS_ERRORS.CONFIG_INVALID, message);
}

/**
 * الوحداتُ المُنفَّذةُ من أنواعِ العطبِ — نوعٌ معلَنٌ بلا مُنفِّذٍ وعدُ فوضى
 * لا تقع.
 */
const IMPLEMENTED_FAULT_KINDS = Object.freeze({
  'process-kill': 'signal',
  latency: 'milliseconds',
  'disk-exhaustion': 'bytes-free',
  'corrupt-record': 'lines',
  'clock-reversal': 'milliseconds',
});

/**
 * @param {ChaosContract} contract
 * @returns {void}
 */
function assertExperiments(contract) {
  /** @type {Set<string>} */
  const ids = new Set();
  /** @type {Set<string>} */
  const deviationCodes = new Set();
  /** @type {Set<number>} */
  const orders = new Set();
  for (const experiment of contract.experiments) {
    if (ids.has(experiment.id)) {
      refuse(
        CHAOS_ERRORS.EXPERIMENT_DUPLICATE,
        `التجربةُ «${experiment.id}» معلَنةٌ مرَّتين — ومعرَّفٌ مكرَّرٌ يجعل نتيجتَين نتيجةً واحدةً تُقرأ.`,
        { experiment: experiment.id },
      );
    }
    ids.add(experiment.id);
    if (deviationCodes.has(experiment.deviationCode)) {
      refuse(
        CHAOS_ERRORS.EXPERIMENT_DUPLICATE,
        `رمزُ الانحراف «${experiment.deviationCode}» مشتركٌ بين تجربتَين — ورمزٌ مشتركٌ يُخفي أيَّ الفرضيّتَين أُخلِفت.`,
        { experiment: experiment.id, deviationCode: experiment.deviationCode },
      );
    }
    deviationCodes.add(experiment.deviationCode);
    orders.add(experiment.order);
    if (experiment.hypothesis.trim() === '') {
      refuse(
        CHAOS_ERRORS.HYPOTHESIS_MISSING,
        `التجربةُ «${experiment.id}» بلا فرضيّةٍ مكتوبةٍ — وتجربةٌ بلا فرضيّةٍ عرضُ عطبٍ لا قياسُ صمود.`,
        { experiment: experiment.id },
      );
    }
    const expectedUnit = /** @type {Record<string, string>} */ (IMPLEMENTED_FAULT_KINDS)[
      experiment.fault.kind
    ];
    if (expectedUnit === undefined) {
      refuse(
        CHAOS_ERRORS.FAULT_INVALID,
        `نوعُ العطبِ «${experiment.fault.kind}» معلَنٌ ولا مُنفِّذَ له في جامعِ الوقائع — ووعدُ فوضى لا تقع أسوأُ من عدمِها.`,
        { experiment: experiment.id, kind: experiment.fault.kind },
      );
    }
    if (experiment.fault.unit !== expectedUnit) {
      refuse(
        CHAOS_ERRORS.FAULT_INVALID,
        `وحدةُ عطبِ «${experiment.id}» «${experiment.fault.unit}» لا تُوافق نوعَه «${experiment.fault.kind}» (المُنتظَرُ «${expectedUnit}») — ورقمٌ بلا وحدةٍ صحيحةٍ رقمٌ لا يُقارَن.`,
        { experiment: experiment.id },
      );
    }
    if (!Number.isSafeInteger(experiment.fault.magnitude) || experiment.fault.magnitude < 0) {
      refuse(
        CHAOS_ERRORS.FAULT_INVALID,
        `قدرُ عطبِ «${experiment.id}» ليس عدداً صحيحاً غيرَ سالبٍ — والعطبُ يُوصَف رقماً لا بلاغةً.`,
        { experiment: experiment.id, magnitude: experiment.fault.magnitude },
      );
    }
    if (!experiment.target.startsWith(`${contract.source.root}/`)) {
      refuse(
        CHAOS_ERRORS.BLAST_RADIUS_ESCAPE,
        `هدفُ «${experiment.id}» (${experiment.target}) خارجَ جذرِ التجاربِ ${contract.source.root} — ونصفُ قطرِ الانفجارِ معلَنٌ لا مُقدَّر.`,
        { experiment: experiment.id, target: experiment.target },
      );
    }
  }
  for (let index = 1; index <= contract.experiments.length; index += 1) {
    if (!orders.has(index)) {
      refuse(
        CHAOS_ERRORS.ORDER_INVALID,
        `ترتيبُ التجاربِ مثلومٌ عند ${String(index)} — وترتيبٌ بفجوةٍ يُخفي تجربةً حُذِفت.`,
        { missingOrder: index },
      );
    }
  }
}

/**
 * الضمان `G-CHAOS-ONLY-RESILIENCE-EXITS-ZERO` يُنفَّذ هنا.
 *
 * @param {ChaosContract} contract
 * @returns {void}
 */
function assertVerdicts(contract) {
  /** @type {Set<string>} */
  const ids = new Set();
  /** @type {Set<number>} */
  const codes = new Set();
  const experimentIds = new Set(contract.experiments.map((experiment) => experiment.id));
  for (const verdict of contract.verdicts) {
    if (ids.has(verdict.id)) {
      refuse(
        CHAOS_ERRORS.VERDICT_UNDECLARED,
        `الحكم «${verdict.id}» معلَنٌ مرَّتين — وحكمانِ بمعرَّفٍ واحدٍ حكمٌ لا يُعرَف رمزُ خروجِه.`,
        { verdict: verdict.id },
      );
    }
    ids.add(verdict.id);
    if (experimentIds.has(verdict.id)) {
      refuse(
        CHAOS_ERRORS.VERDICT_UNDECLARED,
        `المعرَّف «${verdict.id}» حكمٌ وتجربةٌ في وقتٍ واحدٍ — والخلطُ بينهما يُقرَأ نتيجةً لتجربةٍ لم تجرِ.`,
        { verdict: verdict.id },
      );
    }
    if (codes.has(verdict.exitCode)) {
      refuse(
        CHAOS_ERRORS.EXIT_CODE_CONFLICT,
        `رمزُ الخروج ${String(verdict.exitCode)} مشتركٌ بين حكمَين — ورمزٌ مشتركٌ يجعل الانحرافَ والصمودَ سواءً عند القراءة.`,
        { verdict: verdict.id, exitCode: verdict.exitCode },
      );
    }
    codes.add(verdict.exitCode);
    if (verdict.id === RESILIENT_VERDICT && verdict.exitCode !== 0) {
      refuse(
        CHAOS_ERRORS.EXIT_CODE_CONFLICT,
        'حكمُ الصمودِ لا يخرج صفراً — والمسارُ الآليُّ يقرأ الصفرَ نجاحاً فحسب.',
        { verdict: verdict.id, exitCode: verdict.exitCode },
      );
    }
    if (verdict.id !== RESILIENT_VERDICT && verdict.exitCode === 0) {
      refuse(
        CHAOS_ERRORS.EXIT_CODE_CONFLICT,
        `الحكم «${verdict.id}» يخرج صفراً وهو ليس صموداً — والضمان G-CHAOS-ONLY-RESILIENCE-EXITS-ZERO يمنعه.`,
        { verdict: verdict.id },
      );
    }
  }
  if (!ids.has(RESILIENT_VERDICT)) {
    refuse(
      CHAOS_ERRORS.VERDICT_UNDECLARED,
      `العقدُ بلا حكمِ «${RESILIENT_VERDICT}» — وعقدُ فوضى بلا حكمِ صمودٍ عقدٌ لا يُخرِج صفراً أبداً.`,
    );
  }
}

/**
 * دفترُ الانحرافاتِ يُرفَض عند التحميلِ إن أشار إلى تجربةٍ غيرِ معلَنةٍ أو
 * حمل رمزاً لا يُقابل رمزَ انحرافِ تجربتِه.
 *
 * @param {ChaosContract} contract
 * @returns {void}
 */
function assertDeviationLedger(contract) {
  /** @type {Map<string, string>} */
  const codeByExperiment = new Map(
    contract.experiments.map((experiment) => [experiment.id, experiment.deviationCode]),
  );
  /** @type {Set<string>} */
  const seen = new Set();
  for (const deviation of contract.deviations) {
    if (seen.has(deviation.code)) {
      refuse(
        CHAOS_ERRORS.DEVIATION_UNDECLARED,
        `الانحراف «${deviation.code}» مُقيَّدٌ مرَّتين في الدفترِ — ودفترٌ يكرِّر مُدخلةً يُقرأ منه إغلاقٌ لغيرِ ما أُغلِق.`,
        { deviation: deviation.code },
      );
    }
    seen.add(deviation.code);
    const expected = codeByExperiment.get(deviation.experiment);
    if (expected === undefined) {
      refuse(
        CHAOS_ERRORS.EXPERIMENT_UNDECLARED,
        `الانحراف «${deviation.code}» يُشير إلى تجربةٍ غيرِ معلَنةٍ «${deviation.experiment}».`,
        { deviation: deviation.code, experiment: deviation.experiment },
      );
    }
    if (expected !== deviation.code) {
      refuse(
        CHAOS_ERRORS.DEVIATION_UNDECLARED,
        `الانحراف «${deviation.code}» ليس رمزَ انحرافِ تجربتِه «${deviation.experiment}» (المُعلَنُ «${expected}»).`,
        { deviation: deviation.code, experiment: deviation.experiment },
      );
    }
  }
}

/**
 * @param {ChaosContract} contract
 * @returns {void}
 */
function assertGuarantees(contract) {
  /** @type {Set<string>} */
  const ids = new Set();
  for (const guarantee of contract.guarantees) {
    if (ids.has(guarantee.id)) {
      invalidContract(`الضمان «${guarantee.id}» معلَنٌ مرَّتين في العقد.`);
    }
    ids.add(guarantee.id);
    if (guarantee.enforcedIn.trim() === '') {
      invalidContract(`الضمان «${guarantee.id}» بلا ملفِّ إنفاذٍ — وضمانٌ بلا منفِّذٍ عبارة.`);
    }
  }
}

/**
 * تحميلُ عقدِ الفوضى من `config/chaos.yaml` والتحقّقُ منه بمخطَّطِه الصارمِ
 * ثم بترابطِه.
 *
 * @param {{ dir?: string }} [options]
 * @returns {ChaosContract}
 */
export function loadChaosContract(options = {}) {
  const dir = options.dir ?? DEFAULT_CHAOS_CONFIG_DIR;
  const schemaDir = fs.existsSync(path.join(dir, 'schemas')) ? dir : DEFAULT_CHAOS_CONFIG_DIR;
  const file = path.join(dir, 'chaos.yaml');
  if (!fs.existsSync(file)) {
    invalidContract(
      'عقدُ الفوضى غائب؛ ودولةٌ بلا عقدِ فوضى دولةٌ تقول «نحن صامدون» ولم تُسقِط عقدةً واحدةً بيدِها قطُّ.',
    );
  }
  /** @type {unknown} */
  let raw;
  try {
    raw = YAML.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    invalidContract(`تعذّرت قراءة chaos.yaml: ${errorText(error)}`);
  }
  const schemaPath = path.join(schemaDir, 'schemas', 'chaos.schema.json');
  if (!fs.existsSync(schemaPath)) {
    invalidContract(
      'مخطَّطُ عقدِ الفوضى غائب؛ وبلا مخطَّطٍ يصير العقدُ نصّاً حرّاً تُضاف إليه تجربةٌ بلا فرضيّةٍ فلا يُلاحظ.',
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
    invalidContract(`عقدُ الفوضى يخالف مخطَّطَه: ${problems}`);
  }
  const parsed = /** @type {ChaosContract} */ (raw);

  assertExperiments(parsed);
  assertVerdicts(parsed);
  assertDeviationLedger(parsed);
  assertGuarantees(parsed);

  return Object.freeze(parsed);
}

/**
 * رمزُ خروجِ حكمٍ معلَنٍ — وحكمٌ لا إعلانَ له يُرَدُّ ولا يُخرَج بصفرٍ
 * «تفاؤلاً».
 *
 * @param {ChaosContract} contract
 * @param {string} verdictId
 * @returns {number}
 */
export function exitCodeFor(contract, verdictId) {
  const verdict = contract.verdicts.find((entry) => entry.id === verdictId);
  if (verdict === undefined) {
    refuse(
      CHAOS_ERRORS.VERDICT_UNDECLARED,
      `الحكم «${verdictId}» لا إعلانَ له في عقدِ الفوضى — ولا يُخرَج برمزٍ لم يُعلَن.`,
      { verdict: verdictId },
    );
  }
  return verdict.exitCode;
}

/**
 * تجربةٌ معلَنةٌ بمعرَّفِها، أو رفضٌ صريح.
 *
 * @param {ChaosContract} contract
 * @param {string} experimentId
 * @returns {ChaosExperiment}
 */
export function requireExperiment(contract, experimentId) {
  const experiment = contract.experiments.find((entry) => entry.id === experimentId);
  if (experiment === undefined) {
    refuse(
      CHAOS_ERRORS.EXPERIMENT_UNDECLARED,
      `التجربة «${experimentId}» لا إعلانَ لها في عقدِ الفوضى.`,
      { experiment: experimentId },
    );
  }
  return experiment;
}
