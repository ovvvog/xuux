/**
 * وثيقةُ التشريع: تحميلُها والتحقّقُ منها ورموزُ رفضها — الخطوة M8.02
 *
 * **العيبُ الذي يُغلقه هذا الملف:** شرطُ «القانون النافذ» لم يكن مكتوباً في
 * موضعٍ واحدٍ يُقرأ. كان موزَّعاً بين قيدٍ في القاعدة (`laws_enactment_complete`)
 * ومقارنةِ نصٍّ في `law-system.mjs` (`actor !== 'crown'`) ولا شيءَ في الوسط.
 * فمن أراد أن يعرف «ما الذي يصير به النصُّ قانوناً» لم يجد جواباً بل ثلاثةَ
 * أنصافِ جواب. وهذا الملفُّ يقرأ الجوابَ من `config/legislation.yaml` ويرفض
 * الوثيقةَ المخالفةَ لمخطَّطها برمزٍ مُسمّى، فيصير الشرطُ بياناً واحداً.
 *
 * ورموزُ الرفض هنا **مُشتقّةٌ من الوثيقة لا مكتوبةٌ بيدين**: `LEGISLATION_ERRORS`
 * يُقابل بندَ ضمانٍ في `config/legislation.yaml`، وحاجزُ البوابة 19 يرفض أن
 * يُعلَن في الوثيقة رمزٌ لا يقع في كودٍ، أو يقع في الكود رمزٌ لا تعلنه الوثيقة.
 */

import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import Ajv2020Default from 'ajv/dist/2020.js';

const Ajv2020 = /** @type {typeof import('ajv/dist/2020.js').Ajv2020} */ (
  /** @type {unknown} */ (Ajv2020Default)
);

/** المجلدُ الافتراضيُّ للوثائق الحاكمة. */
export const DEFAULT_LEGISLATION_CONFIG_DIR = path.join(process.cwd(), 'config');

/**
 * رموزُ الرفض في مسار التشريع. كلُّ رمزٍ هنا بندُ ضمانٍ في
 * `config/legislation.yaml`، والبوابةُ 19 تحرس التقابل في الاتجاهين.
 */
export const LEGISLATION_ERRORS = Object.freeze({
  CONFIG_INVALID: 'LEGISLATION_CONFIG_INVALID',
  BINDING_REQUIRED: 'LEGISLATION_BINDING_REQUIRED',
  ARTICLE_UNKNOWN: 'LEGISLATION_ARTICLE_UNKNOWN',
  POLICY_UNKNOWN: 'LEGISLATION_POLICY_UNKNOWN',
  POLICY_DISABLED: 'LEGISLATION_POLICY_DISABLED',
  LAWREF_MISMATCH: 'LEGISLATION_LAWREF_MISMATCH',
  TEXT_TOO_SHORT: 'LEGISLATION_TEXT_TOO_SHORT',
  ROYAL_COMMAND_REQUIRED: 'LEGISLATION_ROYAL_COMMAND_REQUIRED',
  CONFLICT_UNRESOLVED: 'LEGISLATION_CONFLICT_UNRESOLVED',
  RESOLUTION_INEFFECTIVE: 'LEGISLATION_RESOLUTION_INEFFECTIVE',
});

/**
 * خطأُ التشريع: يحمل رمزاً من `LEGISLATION_ERRORS` وتفصيلاً عربياً. والرمزُ حقلٌ
 * لا نصُّ رسالةٍ يُفتَّش فيه، كي يكون الفرزُ في المستدعي على قيمةٍ لا على لغة.
 */
export class LegislationError extends Error {
  /**
   * @param {string} code
   * @param {string} detail
   */
  constructor(code, detail) {
    super(`${code}: ${detail}`);
    this.name = 'LegislationError';
    this.code = code;
    this.detail = detail;
  }
}

/**
 * @typedef {object} LegislationHolder
 * @property {string} role
 * @property {readonly ('propose' | 'bind' | 'enact' | 'resolve')[]} may
 * @property {string} reason
 */

/**
 * @typedef {object} LegislationBinding
 * @property {true} requireArticle
 * @property {number} minPolicies
 * @property {true} requireLawRefMatch
 * @property {number} minTextLength
 * @property {true} requireScope
 * @property {string} enactAction
 * @property {string} resolveAction
 */

/**
 * @typedef {object} LegislationConflictKind
 * @property {string} kind
 * @property {string} code
 * @property {boolean} blocking
 * @property {string} statement
 * @property {readonly string[]} enforcedBy
 */

/**
 * @typedef {object} LegislationGuarantee
 * @property {string} code
 * @property {string} statement
 * @property {readonly string[]} enforcedBy
 */

/**
 * @typedef {object} LegislationPolicy
 * @property {number} version
 * @property {readonly LegislationHolder[]} holders
 * @property {LegislationBinding} binding
 * @property {readonly LegislationConflictKind[]} conflictKinds
 * @property {readonly LegislationGuarantee[]} guarantees
 */

/**
 * @param {unknown} error
 * @returns {string}
 */
function errorText(error) {
  return error instanceof Error ? error.message : String(error);
}

/**
 * يقرأ وثيقةَ التشريع ويتحقّق منها مخطَّطاً وتماسكاً.
 * @param {{ dir?: string }} [options]
 * @returns {LegislationPolicy}
 */
export function loadLegislationPolicy(options = {}) {
  const dir = options.dir ?? DEFAULT_LEGISLATION_CONFIG_DIR;
  const schemaDir = fs.existsSync(path.join(dir, 'schemas')) ? dir : DEFAULT_LEGISLATION_CONFIG_DIR;
  const file = path.join(dir, 'legislation.yaml');
  if (!fs.existsSync(file)) {
    throw new LegislationError(
      LEGISLATION_ERRORS.CONFIG_INVALID,
      'وثيقةُ التشريع غائبة؛ ودولةٌ بلا شرطٍ معلَنٍ للنفاذ يصير فيها كلُّ نصٍّ قانوناً.',
    );
  }
  /** @type {unknown} */
  let raw;
  try {
    raw = YAML.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    throw new LegislationError(
      LEGISLATION_ERRORS.CONFIG_INVALID,
      `تعذّرت قراءة legislation.yaml: ${errorText(error)}`,
    );
  }
  const schemaPath = path.join(schemaDir, 'schemas', 'legislation.schema.json');
  if (!fs.existsSync(schemaPath)) {
    throw new LegislationError(
      LEGISLATION_ERRORS.CONFIG_INVALID,
      'مخطَّطُ التشريع غائب؛ وبلا مخطَّطٍ تصير الوثيقةُ نصّاً حرّاً كالذي جاءت لتمنعه.',
    );
  }
  const validate = new Ajv2020({ allErrors: true, strict: false }).compile(
    JSON.parse(fs.readFileSync(schemaPath, 'utf8')),
  );
  if (!validate(raw)) {
    const problems = (validate.errors ?? [])
      .map((entry) => `${entry.instancePath || '/'} ${entry.message ?? ''}`.trim())
      .join(' · ');
    throw new LegislationError(
      LEGISLATION_ERRORS.CONFIG_INVALID,
      `legislation.yaml يخالف مخطَّطه: ${problems}`,
    );
  }
  const parsed = /** @type {LegislationPolicy} */ (raw);

  // فحوصُ تماسكٍ لا يُعبِّر عنها مخطَّط:
  const kinds = new Set(parsed.conflictKinds.map((entry) => entry.kind));
  if (kinds.size !== parsed.conflictKinds.length) {
    throw new LegislationError(
      LEGISLATION_ERRORS.CONFIG_INVALID,
      'نوعُ تعارضٍ مكرَّر؛ والنوعُ المكرَّر يجعل رمزَ البلاغ مبهماً.',
    );
  }
  const codes = new Set(parsed.conflictKinds.map((entry) => entry.code));
  if (codes.size !== parsed.conflictKinds.length) {
    throw new LegislationError(
      LEGISLATION_ERRORS.CONFIG_INVALID,
      'رمزُ تعارضٍ مكرَّرٌ في نوعين؛ والرمزُ هو ما يُفرَز عليه في المستدعي.',
    );
  }
  const guarantees = new Set(parsed.guarantees.map((entry) => entry.code));
  if (guarantees.size !== parsed.guarantees.length) {
    throw new LegislationError(
      LEGISLATION_ERRORS.CONFIG_INVALID,
      'بندُ ضمانٍ مكرَّرُ الرمز؛ والتكرارُ يجعل الواقعةَ مبهمة.',
    );
  }
  // لا بدَّ من نوعٍ مانعٍ واحدٍ على الأقل: وثيقةٌ كلُّ تعارضٍ فيها «يُعلَن ولا
  // يمنع» تُحوِّل الكشفَ إلى تقريرٍ لا حاجز، وذلك عينُ العيب الذي جاءت لتغلقه.
  if (!parsed.conflictKinds.some((entry) => entry.blocking)) {
    throw new LegislationError(
      LEGISLATION_ERRORS.CONFIG_INVALID,
      'لا نوعَ تعارضٍ مانعاً في الوثيقة؛ وكشفٌ لا يمنع تقريرٌ لا حاجز.',
    );
  }
  // فعلُ النفاذ وفعلُ الحلِّ لا يجوز أن يكونا فعلاً واحداً: من يملك حلَّ
  // التعارض يصير مالكاً للنفاذ نفسِه، فيسقط الفصلُ الذي أُعلن في `holders`.
  if (parsed.binding.enactAction === parsed.binding.resolveAction) {
    throw new LegislationError(
      LEGISLATION_ERRORS.CONFIG_INVALID,
      'فعلُ النفاذ وفعلُ حلِّ التعارض فعلٌ واحد؛ ودمجُهما يُلغي الفصلَ بين السلطتين.',
    );
  }
  // من يُصدر يجب أن يكون معلَناً: وثيقةٌ لا تسمّي صاحبَ الإصدار تجعل الإصدارَ
  // مباحاً لكل دورٍ يمرُّ بالسياسة.
  if (!parsed.holders.some((holder) => holder.may.includes('enact'))) {
    throw new LegislationError(
      LEGISLATION_ERRORS.CONFIG_INVALID,
      'لا حاملَ لسلطة الإصدار في الوثيقة؛ وسلطةٌ بلا حاملٍ معلَنٍ سلطةٌ لكل أحد.',
    );
  }
  return Object.freeze(parsed);
}

/**
 * الأدوارُ التي تملك فعلاً تشريعياً بعينه.
 * @param {LegislationPolicy} policy
 * @param {'propose' | 'bind' | 'enact' | 'resolve'} act
 * @returns {ReadonlySet<string>}
 */
export function rolesFor(policy, act) {
  return new Set(policy.holders.filter((h) => h.may.includes(act)).map((h) => h.role));
}
