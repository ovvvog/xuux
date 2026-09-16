/**
 * ترجمةُ الرفضِ المُسمّى إلى ردٍّ على السلكِ — سدادُ الدَينِ `D-1`.
 *
 * طبقةُ النقلِ **لا تملكُ سلطةً**: لا تُقرِّرُ إذناً، ولا تُخفِّفُ رفضاً، ولا
 * تختصرُ عقبةً. وكلُّ ما تفعلُه هذه الوحدةُ أن تُترجِمَ رمزَ رفضٍ **مُعلَناً في
 * `config/api.yaml`** إلى رقمِ حالةٍ على السلكِ. ومبادئُها ثلاثةٌ:
 *
 * 1. **الخريطةُ مُستوفاةٌ أو تَسقُطُ:** رمزٌ لا ترجمةَ له لا يُسقَطُ إلى `200`
 *    ولا يُخمَّنُ، بل يُردُّ `500` **ويُحرِسُه اختبارٌ** يقابلُ مفاتيحَ
 *    `API_ERRORS` و`SESSION_ERRORS` و`CONSOLE_ERRORS` و`TRANSPORT_ERRORS`
 *    بمفاتيحِ هذه الخريطةِ في الاتجاهَينِ. فمَن أضافَ رمزَ رفضٍ جديداً في
 *    البوابةِ ونسيَ ترجمتَه أفشلَ الحاجزَ، ولم يُسلِّمْ رفضاً بلا معنىً.
 *
 *    **ودَينُ `LIVE-6` وُلِدَ من نقصِ هذا الحاجزِ نفسِه:** كان يقابلُ
 *    `API_ERRORS` و`CONSOLE_ERRORS` **ولا يقابلُ `SESSION_ERRORS`**، فمرَّت
 *    رموزُ إثباتِ الحيازةِ الأربعةُ بلا ترجمةٍ وسقطَتْ إلى `500` — أي قيلَ
 *    للمُنادي «عَطَبٌ داخليٌّ» وهو **رفضُ مصادقةٍ**. فوُسِّعَ الحاجزُ إلى
 *    `SESSION_ERRORS` كي لا يتكرَّرَ النسيانُ صامتاً.
 * 2. **الجسمُ لا يَشرحُ الداخلَ:** يُخرَجُ الرمزُ المُعلَنُ ورسالةٌ عربيّةٌ
 *    مُعلَنةٌ هنا، **لا** نصُّ الاستثناءِ ولا أثرُ المكدَّسِ ولا اسمُ ملفٍّ. فرسالةُ
 *    خطأٍ مُفصَّلةٌ خريطةٌ للمُهاجِمِ، والصمتُ عن الداخلِ ليس إخفاءَ عَيبٍ لأنّ
 *    القيدَ الكاملَ مكتوبٌ في سجلِّ الأحداثِ الذي كتبَته البوابةُ قبلَ الرفضِ.
 * 3. **`401` تُميَّزُ عن `403` عن `404`:** جلسةٌ غائبةٌ ليست هويّةً مُعلَّقةً،
 *    وهويّةٌ مُعلَّقةٌ ليست مساراً مجهولاً. وخلطُها يُخفي على المالكِ سببَ منعِه.
 */

import { API_ERRORS, SESSION_ERRORS } from '../api/index.mjs';
import { CONSOLE_ERRORS } from '../console/index.mjs';

/** رموزُ رفضٍ من طبقةِ النقلِ نفسِها — ما يُرَدُّ قبلَ أن تُسأَلَ البوابةُ. */
export const TRANSPORT_ERRORS = Object.freeze({
  ROUTE_UNKNOWN: 'TRANSPORT_ROUTE_UNKNOWN',
  METHOD_NOT_ALLOWED: 'TRANSPORT_METHOD_NOT_ALLOWED',
  URI_TOO_LONG: 'TRANSPORT_URI_TOO_LONG',
  BODY_NOT_ALLOWED: 'TRANSPORT_BODY_NOT_ALLOWED',
  GATEWAY_REQUIRED: 'TRANSPORT_GATEWAY_REQUIRED',
  // مسلكُ فتحِ الجلسةِ مُعلَنٌ والبوابةُ الموصولةُ لا تُصدِرُ جلساتٍ — `WL-194`.
  // **ولماذا رمزٌ جديدٌ لا `GATEWAY_REQUIRED`:** الأوّلُ يقولُ «لا دولةَ مُركَّبةً»
  // وهذا يقولُ «الدولةُ مُركَّبةٌ وهذا المسلكُ بلا خادِمٍ»، وخلطُهما يُرسِلُ المُشغِّلَ
  // يفحصُ التركيبَ كلَّه والعلةُ في واحدةٍ.
  SESSION_UNSERVED: 'TRANSPORT_SESSION_UNSERVED',
  INTERNAL: 'TRANSPORT_INTERNAL',
});

/**
 * ترجمةُ كلِّ رمزٍ مُعلَنٍ في `config/api.yaml` إلى حالةٍ على السلكِ.
 * والتعليقُ بجانبِ كلِّ سطرٍ يقولُ **لِمَ** هذه الحالةُ لا غيرُها.
 * @type {Readonly<Record<string, number>>}
 */
export const STATUS_BY_CODE = Object.freeze({
  // مسارٌ لم يُعلَنْ لا وجودَ له. و`404` تُقالُ للمجهولِ لا `400`: الطلبُ سليمُ
  // الشكلِ، والمفقودُ هو المورِدُ نفسُه.
  [API_ERRORS.ROUTE_UNKNOWN]: 404,
  // بلا رمزِ جلسةٍ: نقصُ مصادقةٍ لا نقصُ إذنٍ — و`401` وحدَها تدعو إلى المصادقةِ.
  [API_ERRORS.AUTH_REQUIRED]: 401,
  [API_ERRORS.SESSION_INVALID]: 401,
  [API_ERRORS.SESSION_EXPIRED]: 401,
  // الهويّةُ عُرِفَتْ ولم تُقبَلْ حالتُها: إذنٌ لا مصادقةٌ، فلا تُعادُ المصادقةُ عبثاً.
  [API_ERRORS.IDENTITY_UNVERIFIED]: 403,
  [API_ERRORS.AUTHORIZATION_DENIED]: 403,
  [API_ERRORS.TICKET_INVALID]: 403,
  [API_ERRORS.RATE_LIMITED]: 429,
  [API_ERRORS.PARAMS_INVALID]: 400,
  // ── رفضُ إثباتِ الحيازةِ (`SESSION_ERRORS.POP_*`) — سدادُ `LIVE-6` ──
  // **الأربعةُ `401` لا `500`:** التوقيعُ في هذا التركيبِ **مادةُ مصادقةٍ لكلِّ
  // نداءٍ** لا إذنٌ على مورِدٍ؛ فغيابُه ونقضُه وانتهاؤه وإعادتُه **كلُّها إخفاقُ
  // مصادقةٍ** يُصلِحُه المُنادي بتوقيعٍ جديدٍ صحيحٍ — و`401` وحدَها تدعوه إلى
  // ذلك. و`500` تكذبُ عليه مرّتَينِ: تُوهِمُه أنّ العَطَبَ عندنا، وتُخفي عنه
  // أنّ بيدِه إصلاحَه.
  [SESSION_ERRORS.POP_REQUIRED]: 401,
  [SESSION_ERRORS.POP_INVALID]: 401,
  // **وإعادةُ `nonce` هنا `401` وإعادةُ الأمرِ الملكيِّ `409` — والفرقُ مقصودٌ لا
  // تناقضٌ:** `nonce` **مادةُ مصادقةٍ لنداءٍ واحدٍ** استُهلِكت، فالمُنادي يُصادِقُ
  // من جديدٍ بـ`nonce` آخرَ ⇒ `401`. أمّا الأمرُ الملكيُّ فمُعرَّفٌ **مُفرَدٌ
  // لأثرٍ سياديٍّ** نُفِّذَ مرّةً، فإعادتُه **تعارضُ حالٍ** لا نقصُ مصادقةٍ، ولا
  // يُصلِحُها توقيعٌ جديدٌ ⇒ `409`.
  [SESSION_ERRORS.POP_REPLAY]: 401,
  [SESSION_ERRORS.POP_EXPIRED]: 401,
  // نقصُ تابعٍ في الدولةِ نفسِها: خدمةٌ غيرُ مُهيَّأةٍ لا طلبٌ خاطئٌ. و`503`
  // تقولُ الحقيقةَ: النظامُ ناقصٌ الآنَ، والطلبُ لم يكنْ خطأَ صاحبِه.
  [API_ERRORS.CONFIG_INVALID]: 503,
  [API_ERRORS.ENFORCEMENT_REQUIRED]: 503,
  [API_ERRORS.AUDIT_REQUIRED]: 503,
  [API_ERRORS.HANDLER_UNDECLARED]: 503,
  [API_ERRORS.HANDLER_REFUSED]: 502,
  // رفضُ النقلِ نفسِه.
  [TRANSPORT_ERRORS.ROUTE_UNKNOWN]: 404,
  [TRANSPORT_ERRORS.METHOD_NOT_ALLOWED]: 405,
  [TRANSPORT_ERRORS.URI_TOO_LONG]: 414,
  [TRANSPORT_ERRORS.BODY_NOT_ALLOWED]: 400,
  [TRANSPORT_ERRORS.GATEWAY_REQUIRED]: 503,
  // المسلكُ مُعلَنٌ والخادِمُ غائبٌ: عَطبُ تركيبٍ مؤقّتٌ لا خطأُ مُنادٍ.
  [TRANSPORT_ERRORS.SESSION_UNSERVED]: 503,
  [TRANSPORT_ERRORS.INTERNAL]: 500,
  // ── رموزُ الديوانِ الملكيِّ (`M9.03`) ──
  // الكتابةُ السياديّةُ المُوقَّعةُ تُترجَمُ برموزِها المُعلَنةِ لا تُخمَّنُ.
  // والقاعدةُ نفسُها: رمزٌ بلا ترجمةٍ يُرَدُّ `500` ويُفشِلُه الحاجز.
  [CONSOLE_ERRORS.CONFIG_INVALID]: 503,
  [CONSOLE_ERRORS.AUDIT_REQUIRED]: 503,
  [CONSOLE_ERRORS.VIEW_UNDECLARED]: 404,
  [CONSOLE_ERRORS.GATEWAY_REQUIRED]: 503,
  [CONSOLE_ERRORS.VIEW_REFUSED]: 502,
  [CONSOLE_ERRORS.COMMAND_UNDECLARED]: 404,
  [CONSOLE_ERRORS.ACTION_MISMATCH]: 400,
  [CONSOLE_ERRORS.TARGET_MISMATCH]: 400,
  [CONSOLE_ERRORS.CROWN_REQUIRED]: 503,
  [CONSOLE_ERRORS.COMMAND_REJECTED]: 400,
  [CONSOLE_ERRORS.KING_REQUIRED]: 503,
  [CONSOLE_ERRORS.AUTHENTICATION_REQUIRED]: 401,
  [CONSOLE_ERRORS.SIGNATURE_INVALID]: 403,
  [CONSOLE_ERRORS.REPLAYED_COMMAND]: 409,
  [CONSOLE_ERRORS.HALT_REQUIRED]: 503,
  [CONSOLE_ERRORS.EFFECT_REFUSED]: 500,
  [CONSOLE_ERRORS.PATH_UNDECLARED]: 404,
});

/** رسائلُ مُعلَنةٌ: لا يُسرَّبُ نصُّ الاستثناءِ الداخليِّ إلى السلكِ. */
const MESSAGE_BY_CODE = Object.freeze({
  [API_ERRORS.ROUTE_UNKNOWN]: 'لا مسارَ بهذا الاسمِ؛ وما لم يُعلَنْ لا وجودَ له.',
  [API_ERRORS.AUTH_REQUIRED]: 'يلزمُ رمزُ جلسةٍ في ترويسةِ `Authorization`.',
  [API_ERRORS.SESSION_INVALID]: 'رمزُ الجلسةِ غيرُ معروفٍ.',
  [API_ERRORS.SESSION_EXPIRED]: 'انتهتْ مهلةُ الجلسةِ؛ والمهلةُ لا تُمدَّدُ بالاستعمالِ.',
  [API_ERRORS.IDENTITY_UNVERIFIED]: 'حالةُ الهويّةِ لا تسمحُ بالنداءِ.',
  [API_ERRORS.AUTHORIZATION_DENIED]: 'مُنِعَ بقرارِ نقطةِ التفويضِ المركزيّةِ.',
  [API_ERRORS.TICKET_INVALID]: 'تذكرةُ القرارِ غيرُ صالحةٍ أو استُهلِكَتْ.',
  [API_ERRORS.RATE_LIMITED]: 'تجاوزَ الحدَّ المُعلَنَ للمعدَّلِ.',
  [API_ERRORS.PARAMS_INVALID]: 'وُسطاءُ النداءِ لا توافقُ ما أُعلِنَ للمسارِ.',
  [API_ERRORS.CONFIG_INVALID]: 'وثيقةُ الواجهةِ غيرُ صالحةٍ؛ فلا يُخدَمُ نداءٌ.',
  [API_ERRORS.ENFORCEMENT_REQUIRED]: 'لا نقطةَ تفويضٍ؛ والنقصُ رفضٌ لا سماحٌ.',
  [API_ERRORS.AUDIT_REQUIRED]: 'لا سجلَّ أحداثٍ؛ ولا نداءَ بلا قيدٍ.',
  [API_ERRORS.HANDLER_UNDECLARED]: 'النداءُ المُعلَنُ للمسارِ لا مُنفِّذَ له.',
  [API_ERRORS.HANDLER_REFUSED]: 'رفضَ المشهدُ المقروءُ تنفيذَ النداءِ.',
  // ورسائلُ إثباتِ الحيازةِ تقولُ **ما يلزمُ المُنادي فعلُه**، ولا تُفصِّلُ سبباً
  // داخليّاً: «أيُّ حقلٍ في الحمولةِ خالفَ» خريطةٌ للمُهاجِمِ، وقيدُها في سجلِّ
  // الأحداثِ لا في الردِّ.
  [SESSION_ERRORS.POP_REQUIRED]: 'يلزمُ إثباتُ حيازةٍ موقَّعٌ لكلِّ نداءٍ، لا رمزُ جلسةٍ وحدَه.',
  [SESSION_ERRORS.POP_INVALID]: 'إثباتُ الحيازةِ لم يُقبَلْ؛ وُقِّعَ بما لا يطابقُ هذا النداءَ.',
  [SESSION_ERRORS.POP_REPLAY]: 'مُعرِّفُ الإثباتِ مُستهلَكٌ؛ ولا يُقبَلُ توقيعٌ مرّتَينِ.',
  [SESSION_ERRORS.POP_EXPIRED]: 'انقضت مهلةُ إثباتِ الحيازةِ؛ ويُوقَّعُ النداءُ من جديدٍ.',
  [TRANSPORT_ERRORS.ROUTE_UNKNOWN]: 'لا مسارَ بهذا العنوانِ في وثيقةِ الواجهةِ.',
  [TRANSPORT_ERRORS.METHOD_NOT_ALLOWED]: 'المسارُ مُعلَنٌ بفعلٍ غيرِ هذا؛ والقراءةُ `GET` وحدَها.',
  [TRANSPORT_ERRORS.URI_TOO_LONG]: 'العنوانُ أطولُ من الحدِّ المُعلَنِ.',
  [TRANSPORT_ERRORS.BODY_NOT_ALLOWED]: 'لا جسمَ في طلبِ قراءةٍ.',
  [TRANSPORT_ERRORS.GATEWAY_REQUIRED]: 'الدولةُ غيرُ مُركَّبةٍ؛ فلا نداءَ.',
  [TRANSPORT_ERRORS.SESSION_UNSERVED]:
    'مسلكُ فتحِ الجلسةِ مُعلَنٌ والبوابةُ الموصولةُ لا تُصدِرُ جلساتٍ.',
  [TRANSPORT_ERRORS.INTERNAL]: 'عَطَبٌ داخليٌّ؛ وقيدُه في سجلِّ الأحداثِ لا في هذا الردِّ.',
  // ── رسائلُ الديوانِ الملكيِّ ──
  [CONSOLE_ERRORS.CONFIG_INVALID]: 'وثيقةُ الديوانِ غيرُ صالحةٍ؛ فلا يُخدَمُ أمرٌ.',
  [CONSOLE_ERRORS.AUDIT_REQUIRED]: 'لا سجلَّ أحداثٍ موصولٍ بالديوان؛ ولا أمرَ بلا قيدٍ يشهد عليه.',
  [CONSOLE_ERRORS.VIEW_UNDECLARED]: 'مشهدٌ غيرُ معلَنٍ في وثيقةِ الديوان.',
  [CONSOLE_ERRORS.GATEWAY_REQUIRED]: 'طبقةُ الواجهةِ غيرُ موصولةٍ بالديوان.',
  [CONSOLE_ERRORS.VIEW_REFUSED]: 'ردَّت طبقةُ الواجهةِ المشهدَ.',
  [CONSOLE_ERRORS.COMMAND_UNDECLARED]: 'أمرٌ غيرُ معلَنٍ في وثيقةِ الديوان.',
  [CONSOLE_ERRORS.ACTION_MISMATCH]: 'الفعلُ الموقَّعُ لا يطابقُ فعلَ الأمرِ المُعلَن.',
  [CONSOLE_ERRORS.TARGET_MISMATCH]: 'الهدفُ الموقَّعُ لا يطابقُ هدفَ الأمرِ المُعلَن.',
  [CONSOLE_ERRORS.CROWN_REQUIRED]: 'بوابةُ التاجِ غيرُ موصولةٍ بالديوان.',
  [CONSOLE_ERRORS.COMMAND_REJECTED]: 'رُدَّ الأمرُ الملكيُّ.',
  [CONSOLE_ERRORS.KING_REQUIRED]: 'هويةُ الملكِ غيرُ موصولةٍ بالديوان.',
  [CONSOLE_ERRORS.AUTHENTICATION_REQUIRED]: 'الأمرُ يشترط جلسةً قويةً للملكِ ولم تُستوفَ.',
  [CONSOLE_ERRORS.SIGNATURE_INVALID]: 'توقيعُ الأمرِ لم يُقبل.',
  [CONSOLE_ERRORS.REPLAYED_COMMAND]: 'معرّفُ الأمرِ مستهلَكٌ؛ ولا تُعادُ الأوامرُ.',
  [CONSOLE_ERRORS.HALT_REQUIRED]: 'زرُّ الإيقافِ الشاملِ غيرُ موصولٍ بالديوان.',
  [CONSOLE_ERRORS.EFFECT_REFUSED]: 'قُبل الأمرُ وثُبِّت ثم ردَّه أثرُه؛ والقيدُ يبقى شاهداً.',
  [CONSOLE_ERRORS.PATH_UNDECLARED]: 'مسارُ الأمرِ غيرُ معلَنٍ في الكودِ ولا في الوثيقة.',
});

/**
 * يستخرجُ رمزَ الرفضِ من خطأٍ إن كان مُسمّىً.
 * @param {unknown} error
 * @returns {string}
 */
export function codeOf(error) {
  if (error !== null && typeof error === 'object' && 'code' in error) {
    const code = /** @type {{ code: unknown }} */ (error).code;
    if (typeof code === 'string' && code.trim() !== '') return code;
  }
  return TRANSPORT_ERRORS.INTERNAL;
}

/**
 * يُصيِّرُ رمزَ رفضٍ رَدّاً على السلكِ.
 * @param {string} code
 * @returns {{ status: number, body: { code: string, message: string } }}
 */
export function problemFor(code) {
  // رمزٌ لا ترجمةَ له **لا يُسقَطُ إلى نجاحٍ**: يُرَدُّ `500` ويبقى الرمزُ كما هو
  // في الجسمِ كي يُقرأَ ويُصلَحَ، ويُفشِلُه الحاجزُ في أوّلِ تحقُّقٍ.
  const statuses = /** @type {Readonly<Record<string, number>>} */ (STATUS_BY_CODE);
  const messages = /** @type {Readonly<Record<string, string>>} */ (MESSAGE_BY_CODE);
  const status = statuses[code] ?? 500;
  const message = messages[code] ?? 'رفضٌ مُسمّىً بلا ترجمةٍ مُعلَنةٍ في طبقةِ النقلِ.';
  return { status, body: { code, message } };
}
