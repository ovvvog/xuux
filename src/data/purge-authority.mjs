// سلطةُ المحوِ — إغلاقُ الدَينِ `LIM-3` (‏`WL-190`).
//
// **العيبُ المُقاسُ قبلَ هذا الملفِّ، لا الموصوفُ:** كان في المستودعِ **مسارا محوٍ
// لا مسارٌ واحدٌ**. أُغلِقَ أوّلُهما في `R6-A-01` (‏`RetentionCycle.run` و
// `eraseDirected`) فصارَ يمرُّ ببوابةِ هويةٍ ونقطةِ تفويضٍ وأمرٍ ملكيٍّ. وبقيَ
// الثاني — `AgentMemoryStore.sweepExpired` — يحذفُ الصفوفَ المنتهيةَ فعلاً
// (`repository.remove`) وحارسُه الوحيدُ `policy.isSweeper(actor.role)`: **نصُّ
// دورٍ يُرسلُه المُنادي**. فلا بوابةَ هويةٍ، ولا نداءَ إلى `authorize`، ولا أمرَ
// ملكيٍّ — مع أنّ `purge-data` مُعلَنٌ فوقَ العتبةِ السياديّةِ في
// `config/royal-authority.yaml` (‏`delegable: false`، وسببُه: «المحوُ يُفقد
// الدليلَ نفسَه»). فكان `role:operator` مُعلَناً في `cycle.sweeperRoles` و
// `expiry.sweeperRoles` ومأذوناً في `pol:purge-data-sweeper-roles`، **ولا يبلغُ
// العتبةَ** — ومع ذلك يمحو على أحدِ المسارَينِ.
//
// **والإعلانُ الذي يُغلقُ الدَينَ مكتوبٌ هنا في الشفرةِ لا في وثيقةٍ بعيدةٍ:**
// أدوارُ المطهِّرِ **أهليّةٌ لا سلطةٌ**. الأهليّةُ تقولُ «مَن يجوزُ أن يُشغِّلَ
// أداةَ المحوِ»، والسلطةُ تقولُ «بأيِّ قرارٍ يقعُ المحوُ» — والثانيةُ فوقَ العتبةِ
// السياديّةِ فلا تُفوَّضُ لدورٍ أصلاً. فمَن قرأَ قائمةَ الأدوارِ وحدَها وحسِبَها
// إذناً بالمحوِ قرأَ نصفَ الشرطِ.
//
// **ولا يُثبَّتُ الشرطُ في الكودِ ثابتاً:** يُقرأُ من `config/royal-authority.yaml`
// نفسِه. فلو أُنزِلَ `purge-data` عن العتبةِ يوماً بقرارِ مالكٍ، تبعَه الكودُ
// بلا تعديلٍ — وحاجزٌ يُكرِّرُ العتبةَ في مكانَينِ يفترقُ أحدُهما عن الآخرِ.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';
import { PURGE_ACTION } from './retention-cycle.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** مجلد البيانات الافتراضي؛ يُبدَّل في الاختبار لقياسِ عتبةٍ أخرى. */
export const DEFAULT_PURGE_CONFIG_DIR = path.join(ROOT, 'config');

/**
 * الفعلُ المحكومُ للمحوِ. **اسمٌ واحدٌ لا اسمانِ**: يُستوردُ من موضعِ إعلانِه
 * الأصليِّ (`retention-cycle.mjs`) ولا يُنسخُ حرفيّاً هنا. فاسمانِ لفعلٍ واحدٍ
 * يفترقانِ عند أوّلِ تغييرٍ، فيصيرُ مسارٌ يستأذنُ في فعلٍ والعتبةُ مُعلَنةٌ على
 * فعلٍ آخرَ — وهو تجاوزٌ صامتٌ لا خطأُ تسميةٍ.
 */
export const PURGE_DATA_ACTION = PURGE_ACTION;

export const PURGE_AUTHORITY_ERRORS = Object.freeze({
  UNDECLARED: 'PURGE_AUTHORITY_UNDECLARED',
  ROLE_NOT_AUTHORITY: 'PURGE_ROLE_NOT_AUTHORITY',
});

/** خطأُ سلطةٍ مُسمّى: الرمزُ للأتمتةِ والنصُّ لمن يقرأُ الرفضَ. */
export class PurgeAuthorityError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   * @param {Record<string, unknown>} [detail]
   */
  constructor(code, message, detail = {}) {
    super(`${code}: ${message}`);
    this.name = 'PurgeAuthorityError';
    this.code = code;
    this.detail = Object.freeze({ ...detail });
  }
}

/**
 * سلطةُ فعلِ المحوِ كما تُقرأُ من العتبةِ السياديّةِ.
 * @typedef {object} PurgeAuthority
 * @property {string} action
 * @property {boolean} royalCommandRequired - `true` حين يكون الفعلُ غيرَ قابلٍ للتفويضِ
 * @property {string} reason - سببُ العتبةِ كما أُعلِنَ، يُنقَلُ في نصِّ الرفضِ
 */

/**
 * يقرأُ عتبةَ `purge-data` من `config/royal-authority.yaml`.
 *
 * وفعلٌ **غائبٌ** عن ملفِّ العتبةِ ليس فعلاً مباحاً: غيابُه يعني أنّ المحوَ لا
 * تحكمُه عتبةٌ مُعلَنةٌ، فيُرفَضُ التحميلُ برمزٍ مُسمّىً بدلاً من أن يُقرأَ
 * السكوتُ إذناً.
 * @param {{ dir?: string }} [options]
 * @returns {PurgeAuthority}
 */
export function loadPurgeAuthority(options = {}) {
  const dir = options.dir ?? DEFAULT_PURGE_CONFIG_DIR;
  const file = path.join(dir, 'royal-authority.yaml');
  if (!fs.existsSync(file)) {
    throw new PurgeAuthorityError(
      PURGE_AUTHORITY_ERRORS.UNDECLARED,
      `ملفُّ العتبةِ السياديّةِ غائبٌ (${file})؛ ومحوٌ بلا عتبةٍ مُعلَنةٍ محوٌ بلا سلطةٍ تُراجَع.`,
      { file },
    );
  }
  const parsed =
    /** @type {{ threshold?: Array<{ action?: unknown, reason?: unknown, delegable?: unknown }> }} */ (
      YAML.parse(fs.readFileSync(file, 'utf8'))
    );
  const entries = Array.isArray(parsed?.threshold) ? parsed.threshold : [];
  const entry = entries.find((row) => row?.action === PURGE_DATA_ACTION);
  if (entry === undefined) {
    throw new PurgeAuthorityError(
      PURGE_AUTHORITY_ERRORS.UNDECLARED,
      `الفعلُ «${PURGE_DATA_ACTION}» غيرُ مُعلَنٍ في العتبةِ السياديّةِ (${file})؛ وسكوتُ الملفِّ لا يُقرأُ إذناً بالمحوِ.`,
      { action: PURGE_DATA_ACTION, file },
    );
  }
  return Object.freeze({
    action: PURGE_DATA_ACTION,
    royalCommandRequired: entry.delegable === false,
    reason: typeof entry.reason === 'string' ? entry.reason : '',
  });
}

/**
 * ربطُ الأمرِ الملكيِّ كما يُقدَّمُ إلى نقطةِ التفويضِ.
 * @typedef {object} RoyalCommandBinding
 * @property {string} id
 * @property {string} digest
 */

/**
 * **الإعلانُ مُنفَّذاً:** دورُ المطهِّرِ أهليّةٌ لا سلطةٌ. فإن كان الفعلُ فوقَ
 * العتبةِ السياديّةِ لزمَ أمرٌ ملكيٌّ **بمعرِّفِه وملخّصِه** لكلِّ محوٍ، ولا
 * يُغني عنه دورٌ ولا سياسةُ إذنٍ تذكرُ ذلك الدورَ.
 *
 * ويُرفَضُ هنا **قبلَ** نداءِ التفويضِ لا بعدَه: الرفضُ المتأخّرُ يُقرأُ رمزَ
 * سياسةٍ عامّاً، والمقصودُ أن يقرأَ المُنادي سببَ رفضِه باسمِه.
 * @param {{ authority: PurgeAuthority, role: string, sweeperRoles?: readonly string[], royalCommand?: RoyalCommandBinding }} request
 * @returns {RoyalCommandBinding | null}
 */
export function assertRoyalCommandForPurge({ authority, role, sweeperRoles = [], royalCommand }) {
  if (!authority.royalCommandRequired) return royalCommand ?? null;
  const bound =
    royalCommand !== undefined &&
    royalCommand !== null &&
    typeof royalCommand.id === 'string' &&
    royalCommand.id.trim() !== '' &&
    typeof royalCommand.digest === 'string' &&
    royalCommand.digest.trim() !== '';
  if (!bound) {
    throw new PurgeAuthorityError(
      PURGE_AUTHORITY_ERRORS.ROLE_NOT_AUTHORITY,
      `الدورُ «${role}» أهليّةٌ لا سلطةٌ: هو من أدوارِ المطهِّرِ المُعلَنةِ (${[...sweeperRoles].join('، ')}) وقد تأذنُ له سياسةٌ، لكنّ الفعلَ «${authority.action}» فوقَ العتبةِ السياديّةِ (${authority.reason}) فلا يبلغُها دورٌ ولا تفويضٌ — ويلزمُ أمرٌ ملكيٌّ بمعرِّفِه وملخّصِه لكلِّ محوٍ.`,
      { role, action: authority.action, sweeperRoles: [...sweeperRoles] },
    );
  }
  return { id: royalCommand.id, digest: royalCommand.digest };
}
