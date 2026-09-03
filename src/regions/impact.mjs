/**
 * حسابُ أثرِ سقوطِ الإقليمِ والحكمُ عليه — الخطوة `M10.07`.
 *
 * **الضمان `G-REGION-IMPACT-MEASURED`:** «استمرّت الخدمة» ليست عبارةً تُقال بل
 * رقمانِ يُقاسان: **زمنُ انقطاعِ الكتابةِ** من لحظةِ سقوطِ الكاتبِ إلى لحظةِ قبولِ
 * الكاتبِ الجديدِ كتابةً فعليّةً، و**نافذةُ الفقدِ** وهي ما لم يُنسَخ بعدُ لحظةَ
 * السقوط. وكلاهما يُحاسَب على سقفٍ معلَنٍ في العقد، ونافذةُ الفقدِ **مصدرُها
 * عهدُ الاتساقِ وحدَه** لا رقمٌ ثانٍ يُكتب في قسمِ الأثر.
 *
 * وهذا الملفُّ **نقيٌّ**: لا قرصَ ولا عمليّةَ ولا ساعةَ — اللحظاتُ تُمرَّر إليه.
 *
 * @module regions/impact
 */

import { REGION_ERRORS, RegionError } from './errors.mjs';

/**
 * @typedef {object} RegionImpact
 * @property {number} unavailableMs زمنُ انقطاعِ الكتابةِ المقيس.
 * @property {number} maxUnavailableMs السقفُ المعلَن.
 * @property {number} dataLossWindowMs نافذةُ الفقدِ المقيسةُ (تأخّرُ النسخِ لحظةَ السقوط).
 * @property {number} maxDataLossMs نافذةُ الفقدِ المعلَنةُ المشتقّةُ من عهدِ الاتساق.
 * @property {boolean} withinBudget أكان الأثرُ كلُّه ضمن العهدِ المعلَن؟
 * @property {string | null} breach رمزُ التجاوزِ إن وقع.
 */

/**
 * @param {string} code
 * @param {string} message
 * @param {Record<string, unknown>} [detail]
 * @returns {never}
 */
function refuse(code, message, detail = {}) {
  throw new RegionError(code, message, detail);
}

/**
 * حسابُ الأثرِ من لحظاتٍ مقيسةٍ والحكمُ عليه بالسقوفِ المعلَنة.
 *
 * @param {object} input
 * @param {import('./contract.mjs').RegionsContract} input.contract
 * @param {number} input.droppedAt لحظةُ إسقاطِ الكاتب.
 * @param {number} input.writeAcceptedAt لحظةُ قبولِ الكاتبِ الجديدِ كتابةً فعليّة.
 * @param {number} input.lagAtDropMs تأخّرُ نسخِ المرشَّحِ المقيسُ لحظةَ السقوط.
 * @returns {RegionImpact}
 */
export function measureImpact(input) {
  const { contract, droppedAt, writeAcceptedAt, lagAtDropMs } = input;
  for (const [name, value] of [
    ['droppedAt', droppedAt],
    ['writeAcceptedAt', writeAcceptedAt],
    ['lagAtDropMs', lagAtDropMs],
  ]) {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      refuse(REGION_ERRORS.CLOCK_INVALID, `القيمة «${String(name)}» ليست عدداً منتهياً.`, {
        field: name,
      });
    }
  }
  if (writeAcceptedAt < droppedAt) {
    refuse(
      REGION_ERRORS.CLOCK_INVALID,
      'لحظةُ قبولِ الكتابةِ قبل لحظةِ السقوط — وساعةٌ ترجع إلى الوراء لا يُقاس عليها أثرٌ.',
      { droppedAt, writeAcceptedAt },
    );
  }
  if (lagAtDropMs < 0) {
    refuse(REGION_ERRORS.LAG_INVALID, 'تأخّرُ النسخِ لحظةَ السقوطِ سالبٌ.', { lagAtDropMs });
  }
  const unavailableMs = writeAcceptedAt - droppedAt;
  const maxDataLossMs = contract.maxDataLossMs;
  let breach = null;
  if (unavailableMs > contract.impact.maxUnavailableMs) {
    breach = REGION_ERRORS.IMPACT_EXCEEDED;
  } else if (lagAtDropMs > maxDataLossMs) {
    breach = REGION_ERRORS.LAG_EXCEEDED;
  }
  return Object.freeze({
    unavailableMs,
    maxUnavailableMs: contract.impact.maxUnavailableMs,
    dataLossWindowMs: lagAtDropMs,
    maxDataLossMs,
    withinBudget: breach === null,
    breach,
  });
}
