/**
 * حصّةُ الاستدلالِ وبندُ كلفتِه — بياناتٌ لا أرقامٌ في الشفرةِ (‏`D-11`، الشوطُ
 * الثالثُ (ب))
 *
 * **العيبُ الذي يُغلقُه هذا الملفُّ** كان مُعلَناً في `docs/INFERENCE.md` §5
 * بنصِّه: «سقوفُ البوابةِ أرقامٌ في الشفرةِ (`DEFAULT_TOKENS_PER_WINDOW`) لا من
 * `config/quotas.yaml`»، والوثيقةُ تُعلنُ `inference-tokens` بحدٍّ في نافذةٍ
 * بالثواني، بينما البوابةُ كانت تُحاسِبُ في نافذةِ حدِّ المعدَّلِ نفسِها. فكان
 * في الدولةِ **سقفانِ لموردٍ واحدٍ**: مُعلَنٌ لا يَنفُذُ، ونافذٌ لا يُعلَنُ.
 *
 * **ولا رقمَ سقفٍ في هذا الملفِّ:** الحدُّ والنافذةُ يُقرآنِ من الوثيقةِ، وغيابُ
 * الحصّةِ **رفضٌ مُسمّىً** لا سقوطٌ صامتٌ إلى رقمٍ مكتوبٍ — إذ سقفٌ افتراضيٌّ
 * يعملُ عندَ غيابِ الوثيقةِ يجعلُ حذفَ الحصّةِ من الوثيقةِ بلا أثرٍ مقيسٍ.
 *
 * **وبندُ الكلفةِ يُقابَلُ بموردِ الحصّةِ** عندَ القراءةِ، فلا يُسعَّرُ استهلاكُ
 * موردٍ على بندِ موردٍ آخرَ ولو تشابهَ الاسمانِ.
 */

import { loadCostCapacityPolicy } from '../cost-capacity/cost-capacity.mjs';
import { loadPolicyBundle } from '../policy/loader.mjs';

/** موردُ الحصّةِ المُعلَنُ في `config/quotas.yaml`. */
export const INFERENCE_TOKENS_RESOURCE = 'inference-tokens';

/** بندُ الكلفةِ المُعلَنُ في `config/cost-capacity.yaml`. */
export const INFERENCE_COST_ITEM = 'cost:inference-tokens';

export const INFERENCE_QUOTA_ERRORS = Object.freeze({
  QUOTA_UNDECLARED: 'INFERENCE_QUOTA_UNDECLARED',
  QUOTA_INVALID: 'INFERENCE_QUOTA_INVALID',
  COST_ITEM_UNDECLARED: 'INFERENCE_COST_ITEM_UNDECLARED',
  COST_ITEM_MISMATCH: 'INFERENCE_COST_ITEM_MISMATCH',
});

/** خطأ مسمى: الرمزُ للبرامجِ والرسالةُ العربيةُ لقرارِ الرفضِ المقروءِ. */
export class InferenceQuotaError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   * @param {Record<string, unknown>} [detail]
   */
  constructor(code, message, detail = {}) {
    super(message);
    this.name = 'InferenceQuotaError';
    /** @type {string} */
    this.code = code;
    /** @type {Record<string, unknown>} */
    this.detail = detail;
  }
}

/**
 * @typedef {object} InferenceTokenQuota
 * @property {string} resource
 * @property {number} tokensPerWindow الحدُّ كما أُعلنَ في الوثيقةِ
 * @property {number} windowSeconds النافذةُ كما أُعلنَت
 * @property {number} budgetWindowMs النافذةُ نفسُها بالمللي ثانيةٍ
 * @property {string} subjectType
 * @property {string} unit
 */

/**
 * حصّةُ رموزِ الاستدلالِ من `config/quotas.yaml`.
 *
 * @param {{ bundle?: { quotas?: readonly Record<string, unknown>[] }, dir?: string }} [options]
 * @returns {Readonly<InferenceTokenQuota>}
 */
export function loadInferenceTokenQuota(options = {}) {
  const bundle =
    options.bundle ?? loadPolicyBundle(options.dir === undefined ? {} : { dir: options.dir });
  const quotas = bundle.quotas ?? [];
  const quota = quotas.find((entry) => entry['resource'] === INFERENCE_TOKENS_RESOURCE);
  if (quota === undefined) {
    throw new InferenceQuotaError(
      INFERENCE_QUOTA_ERRORS.QUOTA_UNDECLARED,
      `لا حصّةَ مُعلَنةً للموردِ «${INFERENCE_TOKENS_RESOURCE}» في وثيقةِ الحصصِ؛ وسقفٌ افتراضيٌّ في الشفرةِ يجعلُ حذفَ الحصّةِ من الوثيقةِ بلا أثرٍ.`,
      { resource: INFERENCE_TOKENS_RESOURCE },
    );
  }
  const limit = quota['limit'];
  const windowSeconds = quota['windowSeconds'];
  if (!Number.isInteger(limit) || Number(limit) <= 0) {
    throw new InferenceQuotaError(
      INFERENCE_QUOTA_ERRORS.QUOTA_INVALID,
      `حدُّ حصّةِ «${INFERENCE_TOKENS_RESOURCE}» «${String(limit)}» ليس عدداً صحيحاً موجباً؛ وسقفٌ لا يُعَدُّ سقفٌ لا يُقاسُ عليه تجاوزٌ.`,
      { resource: INFERENCE_TOKENS_RESOURCE, limit: String(limit) },
    );
  }
  if (!Number.isInteger(windowSeconds) || Number(windowSeconds) <= 0) {
    throw new InferenceQuotaError(
      INFERENCE_QUOTA_ERRORS.QUOTA_INVALID,
      `نافذةُ حصّةِ «${INFERENCE_TOKENS_RESOURCE}» «${String(windowSeconds)}» ليست عدداً صحيحاً موجباً من الثواني؛ ونافذةٌ بلا طولٍ نافذةٌ لا تُغلَقُ.`,
      { resource: INFERENCE_TOKENS_RESOURCE, windowSeconds: String(windowSeconds) },
    );
  }
  return Object.freeze({
    resource: INFERENCE_TOKENS_RESOURCE,
    tokensPerWindow: Number(limit),
    windowSeconds: Number(windowSeconds),
    budgetWindowMs: Number(windowSeconds) * 1000,
    subjectType: typeof quota['subjectType'] === 'string' ? String(quota['subjectType']) : 'agent',
    unit: typeof quota['unit'] === 'string' ? String(quota['unit']) : '',
  });
}

/**
 * بندُ كلفةِ الاستدلالِ من `config/cost-capacity.yaml`، **مقابَلاً بموردِ
 * الحصّةِ**: بندٌ يُسعِّرُ مورداً آخرَ يجعلُ قيدَ الاستهلاكِ قيداً على غيرِ ما
 * استُهلِكَ.
 *
 * @param {{ policy?: { costItems?: readonly Record<string, unknown>[] }, dir?: string }} [options]
 * @returns {Readonly<{ id: string, resource: string }>}
 */
export function inferenceCostItem(options = {}) {
  const policy =
    options.policy ?? loadCostCapacityPolicy(options.dir === undefined ? {} : { dir: options.dir });
  const item = (policy.costItems ?? []).find((entry) => entry['id'] === INFERENCE_COST_ITEM);
  if (item === undefined) {
    throw new InferenceQuotaError(
      INFERENCE_QUOTA_ERRORS.COST_ITEM_UNDECLARED,
      `لا بندَ كلفةٍ مُعلَناً بالمُعرِّفِ «${INFERENCE_COST_ITEM}» في وثيقةِ التكلفةِ؛ واستهلاكٌ يُقيَّدُ بلا ثمنٍ مُعلَنٍ سلفاً يُسعَّرُ بعدَ وقوعِه.`,
      { item: INFERENCE_COST_ITEM },
    );
  }
  if (item['resource'] !== INFERENCE_TOKENS_RESOURCE) {
    throw new InferenceQuotaError(
      INFERENCE_QUOTA_ERRORS.COST_ITEM_MISMATCH,
      `بندُ الكلفةِ «${INFERENCE_COST_ITEM}» مربوطٌ بالموردِ «${String(item['resource'])}» لا بـ«${INFERENCE_TOKENS_RESOURCE}»؛ ووثيقتانِ تتباعدانِ في اسمِ الموردِ تُنتجانِ سقفاً على موردٍ وثمناً على آخرَ.`,
      { item: INFERENCE_COST_ITEM, resource: String(item['resource']) },
    );
  }
  return Object.freeze({ id: INFERENCE_COST_ITEM, resource: INFERENCE_TOKENS_RESOURCE });
}
