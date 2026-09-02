// المناوبةُ — «من على المناوبةِ الآن؟» جوابٌ يُحسَب لا يُسأل عنه إنسان.
//
// العيبُ الذي تُغلقه هذه الوحدةُ بدقة: أعلنت `M9.06` جهاتِ التصعيدِ
// **بأدوارِها** — مكتبُ التدقيقِ ومكتبُ القرارِ — ولم تُعلن **متى** يكون كلٌّ
// منهما مسؤولاً. فقولُ «يُبلَّغ المدقّق» جوابٌ لا يُنفَّذ في الثالثةِ صباحاً:
// أيُّ مدقّقٍ، وهل هو على المناوبةِ في هذه اللحظةِ بعينِها؟ ومن أعلن دوراً
// بلا شِفتٍ أعلن أملاً لا مسؤولية.
//
// والشِفتُ هنا **إزاحةٌ في دورةٍ** لا ساعةُ حائط: يُحَلُّ بالباقي من تقسيمِ
// اللحظةِ على `cycleMs`. وهذا قرارٌ مقصودٌ لا تبسيطٌ: ساعةُ الحائطِ تجرُّ
// معها منطقةً زمنيةً وتوقيتاً صيفيّاً وساعةَ نظامٍ لا يملكها الاختبار، فتصير
// «من على المناوبة؟» سؤالاً جوابُه يتغيّر بمكانِ تشغيلِ العملية. والإزاحةُ
// في دورةٍ تُقاس على ساعةٍ **مُمرَّرةٍ** فيُختبَر جوابُها في كلِّ لحظةٍ من
// الدورةِ بلا انتظارِ ليل.
//
// **والجدولُ يُغطّي الدورةَ كلَّها بلا فجوةٍ ولا تداخُل** — يُفحَص عند
// التحميلِ ويُفحَص نصّاً في الحاجز. فجوةٌ واحدةٌ تعني لحظةً لا مستجيبَ فيها،
// وذاك بعينُه العطبُ الذي جاءت المناوبةُ لتمنعَه — فلا تُبنى المناوبةُ على
// «الأغلبُ أنّ أحداً سيرى». وتداخُلٌ يعني مسؤولين اثنين في لحظةٍ واحدةٍ، وكلٌّ
// منهما يطمئنُّ إلى أنّ الآخرَ سيردّ، وهذا صمتٌ بمسؤولٍ مضاعَف.
//
// **حدٌّ معلَنٌ:** لا استثناءَ ولا تبديلَ شِفتٍ ولا «إجازةُ مستجيبٍ» — الجدولُ
// دوريٌّ صِرفٌ يُعدَّل بتعديلِ الوثيقة. والاستثناءُ الفرديُّ حالةٌ تحتاج
// مالكاً وقيداً وسجلًّا، ولم تُطلَب في معيارِ هذه الخطوةِ فلا تُخترَع فيها.

import { IR_ERRORS, IncidentResponseError } from './errors.mjs';

/**
 * @typedef {object} RotationShift
 * @property {string} id
 * @property {number} startMs
 * @property {number} endMs
 * @property {string} responder
 * @property {string} purpose
 */

/**
 * @typedef {object} RotationPolicy
 * @property {number} cycleMs
 * @property {string} statement
 * @property {readonly RotationShift[]} shifts
 */

/**
 * فحصُ تغطيةِ الجدولِ للدورةِ: بلا فجوةٍ ولا تداخُلٍ ولا شِفتٍ خارجَ الدورة.
 *
 * يُنادى من المُحمِّلِ فيسقط الملفُّ المعتلُّ عند القراءةِ لا عند أولِ حادثةٍ
 * في الثالثةِ صباحاً — وتأخيرُ اكتشافِ الفجوةِ إلى لحظةِ الحاجةِ إليها هو
 * أسوأُ ما يمكن أن يُفعل بها.
 *
 * @param {RotationPolicy} rotation
 * @returns {void}
 */
export function assertRotationCovers(rotation) {
  const { cycleMs, shifts } = rotation;
  if (shifts.length === 0) {
    throw new IncidentResponseError(
      IR_ERRORS.ROTATION_GAP,
      'جدولُ المناوبةِ بلا شِفتٍ واحد؛ ودورةٌ بلا شِفتٍ دورةٌ بلا مستجيبٍ في أيِّ لحظةٍ منها.',
      { cycleMs },
    );
  }

  const ordered = [...shifts].sort((a, b) => a.startMs - b.startMs);
  let cursor = 0;
  for (const shift of ordered) {
    if (shift.endMs <= shift.startMs) {
      throw new IncidentResponseError(
        IR_ERRORS.ROTATION_GAP,
        `الشِفت «${shift.id}» ينتهي عند بدايتِه أو قبلَها (${shift.startMs} ← ${shift.endMs})؛ وشِفتٌ بلا مدّةٍ اسمٌ في جدولٍ لا مسؤوليةٌ في زمن.`,
        { shift: shift.id, startMs: shift.startMs, endMs: shift.endMs },
      );
    }
    if (shift.endMs > cycleMs) {
      throw new IncidentResponseError(
        IR_ERRORS.ROTATION_GAP,
        `الشِفت «${shift.id}» يتجاوز مدّةَ الدورةِ المُعلَنةَ (${shift.endMs} > ${cycleMs})؛ وشِفتٌ يفيض عن دورتِه يلتفّ على أوّلِها فيُخفي تداخُلاً لا يُرى في الجدول.`,
        { shift: shift.id, endMs: shift.endMs, cycleMs },
      );
    }
    if (shift.startMs > cursor) {
      throw new IncidentResponseError(
        IR_ERRORS.ROTATION_GAP,
        `فجوةٌ في جدولِ المناوبةِ بين ${cursor} و${shift.startMs} من الدورة؛ وفجوةٌ واحدةٌ تعني لحظةً لا مستجيبَ فيها، وهي بعينُها العطبُ الذي جاءت المناوبةُ لتمنعَه.`,
        { fromMs: cursor, toMs: shift.startMs, shift: shift.id },
      );
    }
    if (shift.startMs < cursor) {
      throw new IncidentResponseError(
        IR_ERRORS.ROTATION_GAP,
        `تداخُلٌ في جدولِ المناوبةِ عند ${shift.startMs} من الدورةِ مع ما قبلَه المنتهي عند ${cursor}؛ ومسؤولانِ في لحظةٍ واحدةٍ صمتٌ مضاعَفٌ، إذ يطمئنُّ كلٌّ منهما إلى أنّ الآخرَ سيردّ.`,
        { atMs: shift.startMs, previousEndMs: cursor, shift: shift.id },
      );
    }
    cursor = shift.endMs;
  }

  if (cursor !== cycleMs) {
    throw new IncidentResponseError(
      IR_ERRORS.ROTATION_GAP,
      `جدولُ المناوبةِ ينتهي عند ${cursor} ومدّةُ الدورةِ ${cycleMs}؛ وذيلُ دورةٍ بلا شِفتٍ لحظاتٌ لا مستجيبَ فيها تعود في كلِّ دورة.`,
      { coveredMs: cursor, cycleMs },
    );
  }
}

/**
 * حلُّ الشِفتِ على لحظةٍ مُمرَّرة: الباقي من تقسيمِ اللحظةِ على الدورة.
 *
 * @param {RotationPolicy} rotation
 * @param {number} atMs
 * @returns {{ shift: string, responder: string, offsetMs: number, startMs: number, endMs: number }}
 */
export function responderAt(rotation, atMs) {
  const offsetMs = ((atMs % rotation.cycleMs) + rotation.cycleMs) % rotation.cycleMs;
  for (const shift of rotation.shifts) {
    if (offsetMs >= shift.startMs && offsetMs < shift.endMs) {
      return {
        shift: shift.id,
        responder: shift.responder,
        offsetMs,
        startMs: shift.startMs,
        endMs: shift.endMs,
      };
    }
  }
  // لا يُبلَغ هذا الموضعُ إلا إذا سقط فحصُ التغطيةِ عند التحميل؛ ورفضٌ مُسمّىً
  // أصدقُ من إعادةِ «أوّلِ شِفتٍ» بوصفِه جواباً.
  throw new IncidentResponseError(
    IR_ERRORS.ROTATION_GAP,
    `لا شِفتَ يُغطّي الإزاحة ${offsetMs} من الدورة؛ ولحظةٌ بلا مستجيبٍ تُرفَض بالاسمِ ولا يُختار لها مستجيبٌ تخميناً.`,
    { offsetMs, cycleMs: rotation.cycleMs },
  );
}

/**
 * «هل هذا المستجيبُ على المناوبةِ في هذه اللحظة؟» — عقبةُ الإقرار.
 *
 * ورمزانِ لا رمزٌ واحد: جهةٌ **غيرُ معلَنةٍ** أصلاً في جدولِ المناوبةِ ليست
 * كجهةٍ معلَنةٍ **ليست على مناوبتِها الآن**. الأولى عطبُ إعلانٍ يُصلَح في
 * وثيقة، والثانيةُ حالةٌ صحيحةٌ في زمنٍ خاطئ، ومن جمعهما في رمزٍ واحدٍ حرم
 * قارئَ السجلِّ من التمييزِ بينهما.
 *
 * @param {RotationPolicy} rotation
 * @param {string} responder
 * @param {number} atMs
 * @returns {{ shift: string, responder: string, offsetMs: number, startMs: number, endMs: number }}
 */
export function assertOnCall(rotation, responder, atMs) {
  const declared = rotation.shifts.some((shift) => shift.responder === responder);
  if (!declared) {
    throw new IncidentResponseError(
      IR_ERRORS.RESPONDER_UNKNOWN,
      `المستجيب «${responder}» غيرُ معلَنٍ في جدولِ المناوبة؛ والمُعلَنونَ ${[...new Set(rotation.shifts.map((shift) => shift.responder))].join('، ')} — ومستجيبٌ يخترعه المُنادي إقرارٌ لا يُعرف صاحبُه.`,
      { responder },
    );
  }
  const onCall = responderAt(rotation, atMs);
  if (onCall.responder !== responder) {
    throw new IncidentResponseError(
      IR_ERRORS.RESPONDER_NOT_ON_CALL,
      `المستجيب «${responder}» ليس على المناوبةِ في هذه اللحظة؛ والمناوبةُ للشِفت «${onCall.shift}» وصاحبُه «${onCall.responder}» — وإقرارٌ من غيرِ المناوبِ يُسقِط معنى الجدولِ ويُخفي أنّ المناوبَ لم يرَ شيئاً.`,
      { responder, onCall: onCall.responder, shift: onCall.shift, offsetMs: onCall.offsetMs },
    );
  }
  return onCall;
}
