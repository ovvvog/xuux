/**
 * وثيقةُ القضاء: تحميلُها والتحقّقُ منها ورموزُ رفضها — الخطوة M8.03
 *
 * **العيبُ الذي يُغلقه هذا الملف:** شرطُ «الحكم الصحيح» لم يكن مكتوباً في موضعٍ
 * واحدٍ يُقرأ. كان موزَّعاً بين قيدين في القاعدة (`cases_judgment_needs_hearing`
 * و`cases_verdict_iff_judged`) ومقارنةِ حالةٍ في `Map` داخل
 * `src/governance/law-system.mjs`، ولا شيءَ في الوسط يقول إنّ الحكمَ يلزمه سببٌ
 * مكتوب — مع أنّ المادةَ 11 تقول ذلك نصّاً. فمن أراد أن يعرف «ما الذي يصير به
 * الفصلُ حكماً» لم يجد جواباً بل نصفَ جواب. وهذا الملفُّ يقرأ الجوابَ من
 * `config/judiciary.yaml` ويرفض الوثيقةَ المخالفةَ لمخطَّطها برمزٍ مُسمّى.
 *
 * ورموزُ الرفض هنا **مُشتقّةٌ من الوثيقة لا مكتوبةٌ بيدين**: `JUDICIARY_ERRORS`
 * يُقابل بندَ ضمانٍ في `config/judiciary.yaml`، وحاجزُ البوابة 20 يرفض أن يُعلَن
 * في الوثيقة رمزٌ لا يقع في كودٍ، أو يقع في الكود رمزٌ لا تعلنه الوثيقة.
 */

import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import Ajv2020Default from 'ajv/dist/2020.js';

const Ajv2020 = /** @type {typeof import('ajv/dist/2020.js').Ajv2020} */ (
  /** @type {unknown} */ (Ajv2020Default)
);

/** المجلدُ الافتراضيُّ للوثائق الحاكمة. */
export const DEFAULT_JUDICIARY_CONFIG_DIR = path.join(process.cwd(), 'config');

/**
 * رموزُ الرفض في مسار القضاء. كلُّ رمزٍ هنا بندُ ضمانٍ في
 * `config/judiciary.yaml`، والبوابةُ 20 تحرس التقابل في الاتجاهين.
 */
export const JUDICIARY_ERRORS = Object.freeze({
  CONFIG_INVALID: 'JUDICIARY_CONFIG_INVALID',
  LAW_NOT_ENACTED: 'JUDICIARY_LAW_NOT_ENACTED',
  CASE_NOT_FOUND: 'JUDICIARY_CASE_NOT_FOUND',
  HEARING_REQUIRED: 'JUDICIARY_HEARING_REQUIRED',
  JUDGE_IS_PARTY: 'JUDICIARY_JUDGE_IS_PARTY',
  JUDGE_MISMATCH: 'JUDICIARY_JUDGE_MISMATCH',
  REASON_REQUIRED: 'JUDICIARY_REASON_REQUIRED',
  OUTCOME_UNKNOWN: 'JUDICIARY_OUTCOME_UNKNOWN',
  ROYAL_COMMAND_REQUIRED: 'JUDICIARY_ROYAL_COMMAND_REQUIRED',
  NOTHING_TO_EXECUTE: 'JUDICIARY_NOTHING_TO_EXECUTE',
  ALREADY_EXECUTED: 'JUDICIARY_ALREADY_EXECUTED',
  APPEAL_PENDING: 'JUDICIARY_APPEAL_PENDING',
  EFFECT_UNKNOWN: 'JUDICIARY_EFFECT_UNKNOWN',
  EXECUTOR_MISSING: 'JUDICIARY_EXECUTOR_MISSING',
  EXECUTION_INEFFECTIVE: 'JUDICIARY_EXECUTION_INEFFECTIVE',
  NOTHING_TO_REVERSE: 'JUDICIARY_NOTHING_TO_REVERSE',
  REVERSAL_INEFFECTIVE: 'JUDICIARY_REVERSAL_INEFFECTIVE',
  NOT_APPEALABLE: 'JUDICIARY_NOT_APPEALABLE',
  APPELLANT_NOT_PARTY: 'JUDICIARY_APPELLANT_NOT_PARTY',
});

/**
 * خطأُ القضاء: يحمل رمزاً من `JUDICIARY_ERRORS` وتفصيلاً عربياً. والرمزُ حقلٌ لا
 * نصُّ رسالةٍ يُفتَّش فيه، كي يكون الفرزُ في المستدعي على قيمةٍ لا على لغة.
 */
export class JudiciaryError extends Error {
  /**
   * @param {string} code
   * @param {string} detail
   */
  constructor(code, detail) {
    super(`${code}: ${detail}`);
    this.name = 'JudiciaryError';
    this.code = code;
    this.detail = detail;
  }
}

/**
 * @typedef {'file' | 'hear' | 'judge' | 'execute' | 'reverse' | 'appeal'} JudicialAct
 */

/**
 * @typedef {object} JudiciaryHolder
 * @property {string} role
 * @property {readonly JudicialAct[]} may
 * @property {string} reason
 */

/**
 * @typedef {object} JudiciaryProcedure
 * @property {true} requireHearingBeforeJudgment
 * @property {true} requireSameJudgeAsHearing
 * @property {true} requireJudgeNotParty
 * @property {true} requireEnactedLaw
 * @property {number} minReasonLength
 * @property {number} minAppealReasonLength
 * @property {number} minReversalReasonLength
 * @property {readonly string[]} outcomes
 * @property {readonly string[]} nonExecutableOutcomes
 * @property {string} executeAction
 * @property {string} reverseAction
 */

/**
 * @typedef {object} JudiciaryEffect
 * @property {string} name
 * @property {true} reversible
 * @property {string} statement
 * @property {readonly string[]} enforcedBy
 */

/**
 * @typedef {object} JudiciaryGuarantee
 * @property {string} code
 * @property {string} statement
 * @property {readonly string[]} enforcedBy
 */

/**
 * @typedef {object} JudiciaryPolicy
 * @property {number} version
 * @property {readonly JudiciaryHolder[]} holders
 * @property {JudiciaryProcedure} procedure
 * @property {readonly JudiciaryEffect[]} effects
 * @property {readonly JudiciaryGuarantee[]} guarantees
 */

/**
 * @param {unknown} error
 * @returns {string}
 */
function errorText(error) {
  return error instanceof Error ? error.message : String(error);
}

/**
 * يقرأ وثيقةَ القضاء ويتحقّق منها مخطَّطاً وتماسكاً.
 * @param {{ dir?: string }} [options]
 * @returns {JudiciaryPolicy}
 */
export function loadJudiciaryPolicy(options = {}) {
  const dir = options.dir ?? DEFAULT_JUDICIARY_CONFIG_DIR;
  const schemaDir = fs.existsSync(path.join(dir, 'schemas')) ? dir : DEFAULT_JUDICIARY_CONFIG_DIR;
  const file = path.join(dir, 'judiciary.yaml');
  if (!fs.existsSync(file)) {
    throw new JudiciaryError(
      JUDICIARY_ERRORS.CONFIG_INVALID,
      'وثيقةُ القضاء غائبة؛ ودولةٌ بلا شرطٍ معلَنٍ للحكم يصير فيها كلُّ فصلٍ حكماً.',
    );
  }
  /** @type {unknown} */
  let raw;
  try {
    raw = YAML.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    throw new JudiciaryError(
      JUDICIARY_ERRORS.CONFIG_INVALID,
      `تعذّرت قراءة judiciary.yaml: ${errorText(error)}`,
    );
  }
  const schemaPath = path.join(schemaDir, 'schemas', 'judiciary.schema.json');
  if (!fs.existsSync(schemaPath)) {
    throw new JudiciaryError(
      JUDICIARY_ERRORS.CONFIG_INVALID,
      'مخطَّطُ القضاء غائب؛ وبلا مخطَّطٍ تصير الوثيقةُ نصّاً حرّاً كالذي جاءت لتمنعه.',
    );
  }
  const validate = new Ajv2020({ allErrors: true, strict: false }).compile(
    JSON.parse(fs.readFileSync(schemaPath, 'utf8')),
  );
  if (!validate(raw)) {
    const problems = (validate.errors ?? [])
      .map((entry) => `${entry.instancePath || '/'} ${entry.message ?? ''}`.trim())
      .join(' · ');
    throw new JudiciaryError(
      JUDICIARY_ERRORS.CONFIG_INVALID,
      `judiciary.yaml يخالف مخطَّطه: ${problems}`,
    );
  }
  const parsed = /** @type {JudiciaryPolicy} */ (raw);

  // فحوصُ تماسكٍ لا يُعبِّر عنها مخطَّط:
  const guarantees = new Set(parsed.guarantees.map((entry) => entry.code));
  if (guarantees.size !== parsed.guarantees.length) {
    throw new JudiciaryError(
      JUDICIARY_ERRORS.CONFIG_INVALID,
      'بندُ ضمانٍ مكرَّرُ الرمز؛ والتكرارُ يجعل الواقعةَ مبهمة.',
    );
  }
  const effects = new Set(parsed.effects.map((entry) => entry.name));
  if (effects.size !== parsed.effects.length) {
    throw new JudiciaryError(
      JUDICIARY_ERRORS.CONFIG_INVALID,
      'أثرُ تنفيذٍ مكرَّرُ الاسم؛ والاسمُ هو ما يُطلب به المُنفِّذ.',
    );
  }
  // فعلُ التنفيذ وفعلُ التراجع لا يجوز أن يكونا فعلاً واحداً: من ملك التنفيذَ
  // ملك التراجعَ بنفس الأمر، فيصير أمرٌ واحدٌ يُنفِّذ ويُبطل بلا قرارٍ ثانٍ.
  if (parsed.procedure.executeAction === parsed.procedure.reverseAction) {
    throw new JudiciaryError(
      JUDICIARY_ERRORS.CONFIG_INVALID,
      'فعلُ التنفيذ وفعلُ التراجع فعلٌ واحد؛ ودمجُهما يُلغي استقلالَ قرارِ التراجع.',
    );
  }
  // منطوقاتُ «لا تُنفَّذ» يجب أن تكون من المنطوقات المُعلَنة: قيمةٌ خارجها تمنع
  // تنفيذَ ما لا وجودَ له وتترك المُعلَنَ مفتوحاً.
  for (const outcome of parsed.procedure.nonExecutableOutcomes) {
    if (!parsed.procedure.outcomes.includes(outcome)) {
      throw new JudiciaryError(
        JUDICIARY_ERRORS.CONFIG_INVALID,
        `المنطوقُ ${outcome} مُعلَنٌ غيرَ قابلٍ للتنفيذ وهو ليس من المنطوقات المُعلَنة.`,
      );
    }
  }
  // ولا بدَّ من منطوقٍ واحدٍ قابلٍ للتنفيذ: وثيقةٌ كلُّ منطوقٍ فيها لا يُنفَّذ
  // تجعل القضاءَ رأياً لا حكماً.
  if (
    !parsed.procedure.outcomes.some(
      (outcome) => !parsed.procedure.nonExecutableOutcomes.includes(outcome),
    )
  ) {
    throw new JudiciaryError(
      JUDICIARY_ERRORS.CONFIG_INVALID,
      'لا منطوقَ قابلاً للتنفيذ في الوثيقة؛ وقضاءٌ لا يُنفَّذ منه شيءٌ رأيٌ لا حكم.',
    );
  }
  // من يحكم ومن يُنفِّذ: لا بدَّ من حاملٍ لكلٍّ، ولا يجوز أن يكون واحداً — وهذا
  // نصُّ المادة 11: «ولا يُراجع أحدٌ عملَ نفسه».
  const judges = rolesFor(parsed, 'judge');
  const executors = rolesFor(parsed, 'execute');
  if (judges.size === 0) {
    throw new JudiciaryError(
      JUDICIARY_ERRORS.CONFIG_INVALID,
      'لا حاملَ لسلطة الحكم في الوثيقة؛ وسلطةٌ بلا حاملٍ معلَنٍ سلطةٌ لكل أحد.',
    );
  }
  if (executors.size === 0) {
    throw new JudiciaryError(
      JUDICIARY_ERRORS.CONFIG_INVALID,
      'لا حاملَ لسلطة التنفيذ في الوثيقة؛ وحكمٌ لا يُنفِّذه أحدٌ نصٌّ في دفتر.',
    );
  }
  for (const role of judges) {
    if (executors.has(role)) {
      throw new JudiciaryError(
        JUDICIARY_ERRORS.CONFIG_INVALID,
        `الدور ${role} يحكم ويُنفِّذ معاً؛ ومن ينفّذ حكمَ نفسه يُراجع عملَ نفسه.`,
      );
    }
  }
  return Object.freeze(parsed);
}

/**
 * الأدوارُ التي تملك فعلاً قضائياً بعينه.
 * @param {JudiciaryPolicy} policy
 * @param {JudicialAct} act
 * @returns {ReadonlySet<string>}
 */
export function rolesFor(policy, act) {
  return new Set(policy.holders.filter((h) => h.may.includes(act)).map((h) => h.role));
}
