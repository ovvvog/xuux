/**
 * هويّةُ الإصداراتِ وهدفُ التراجعِ — الشقُّ النقيُّ من الخطوة `M10.06`.
 *
 * **العيبُ الذي تُغلقه هذه الوحدة:** «ارجع إلى النسخةِ السليمة» أمرٌ لا يُنفَّذ
 * إلا إذا كان في النظامِ موضعٌ واحدٌ **يعرف أيُّ إصدارٍ نُشِّط بحكمٍ صحيح**.
 * ومن تركه لذاكرةِ منفِّذِ النشرِ جعل أخطرَ قرارٍ في أسوأِ لحظةٍ معتمداً على
 * أضعفِ مصدرِ حقيقةٍ في المنظومة.
 *
 * والضمانُ المُنفَّذُ هنا `G-DEPLOY-PREVIOUS-FROM-LEDGER`: هدفُ التراجعِ
 * يُشتقّ من **وقائعِ الدفترِ المكتوبةِ** التي تصل مُعامِلاً، لا من وسيطٍ
 * يُمرَّره منفِّذٌ ولا من قراءةِ ملفٍّ هنا — فالوحدةُ نقيّةٌ
 * (‏`G-DEPLOY-PURE-JUDGEMENT`).
 *
 * @module deployment/releases
 */

import { DEPLOY_ERRORS, DeploymentError } from './errors.mjs';

/**
 * @typedef {object} LedgerEntry
 * @property {string} type نوعُ الواقعةِ من `audit.events` في العقد.
 * @property {string} [release] الإصدارُ الذي تخصُّه الواقعة.
 * @property {string} [wave]
 * @property {string} [verdict]
 * @property {number} [at]
 */

/**
 * التحقّقُ من هويّةِ إصدارٍ بصيغةِ العقدِ المُعلَنة.
 *
 * @param {string} releaseId
 * @param {string} pattern الصيغةُ كما وردت في `release.idPattern`.
 * @returns {string}
 */
export function assertReleaseId(releaseId, pattern) {
  if (typeof releaseId !== 'string' || releaseId.length === 0) {
    throw new DeploymentError(
      DEPLOY_ERRORS.RELEASE_ID_INVALID,
      'هويّةُ الإصدارِ غائبةٌ — ونشرُ ما لا اسمَ له لا يُتراجَع عنه لأنّه لا يُشار إليه.',
      { release: releaseId },
    );
  }
  if (!new RegExp(pattern, 'u').test(releaseId)) {
    throw new DeploymentError(
      DEPLOY_ERRORS.RELEASE_ID_INVALID,
      `هويّةُ الإصدارِ «${releaseId}» لا تطابق الصيغةَ المعلَنةَ في العقد (${pattern}).`,
      { release: releaseId, pattern },
    );
  }
  return releaseId;
}

/**
 * آخرُ إصدارٍ نُشِّط بحكمٍ صحيحٍ قبل الإصدارِ الجاري — هدفُ التراجعِ.
 *
 * ويُستثنى الإصدارُ الجاري صراحةً: فمن تراجع إلى نفسِه لم يتراجع.
 *
 * @param {ReadonlyArray<LedgerEntry>} entries وقائعُ الدفترِ بترتيبِ كتابتِها.
 * @param {{ excludeRelease?: string, activationType?: string }} [options]
 * @returns {string | null}
 */
export function selectRollbackTarget(entries, options = {}) {
  const activationType = options.activationType ?? 'deploy.release.activated';
  const exclude = options.excludeRelease;
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (entry === undefined || entry.type !== activationType) continue;
    const release = entry.release;
    if (typeof release !== 'string' || release.length === 0) continue;
    if (exclude !== undefined && release === exclude) continue;
    return release;
  }
  return null;
}

/**
 * هدفُ التراجعِ أو ردٌّ مُسمّىً حين لا سابقَ سليمٌ في الدفتر.
 *
 * @param {ReadonlyArray<LedgerEntry>} entries
 * @param {{ excludeRelease?: string, activationType?: string }} [options]
 * @returns {string}
 */
export function requireRollbackTarget(entries, options = {}) {
  const target = selectRollbackTarget(entries, options);
  if (target === null) {
    throw new DeploymentError(
      DEPLOY_ERRORS.ROLLBACK_TARGET_MISSING,
      'لزم التراجعُ ولا إصدارَ سابقٌ نُشِّط بحكمٍ صحيحٍ في دفترِ النشر — والردُّ هنا أصدقُ من تنشيطِ إصدارٍ يُظَنّ سليماً.',
      { excludeRelease: options.excludeRelease ?? null },
    );
  }
  return target;
}
