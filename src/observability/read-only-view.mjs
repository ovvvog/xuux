/**
 * المشهد الآمن للقراءة فقط — الخطوة `M9.01` (بند P1).
 *
 * **العيب الذي تُغلقه هذه الوحدة:** كل قارئ للحالة في المستودع يقرؤها من **نفس
 * الكائن** الذي يكتب بها: مستودعات `createRegistries` تُصدِّر `insert` و`update`
 * و`remove` بجوار `findById` و`list` و`count`. فمن أراد رؤيةً وحدها أخذ سلطةً
 * معها، وصار الفرقُ بين المراقب والفاعل نيّةَ الكاتب لا حدَّ التشغيل. ومنعُ
 * الكتابة بفحصٍ داخل الدالّة لا يكفي: من أمسك المرجع `repo.insert` أمسك السلطةَ
 * نفسها، وما يُمسك يُنادى من موضعٍ آخر لا يمرّ بالفحص.
 *
 * **القاعدةُ الحاكمة:** المستودعُ الحقيقيُّ يبقى في **إغلاقٍ** لا يُصدَّر، والمشهدُ
 * سطحٌ جديد لا يحمل إلا الدوالَّ المقروءةَ المُمرَّرة. وكلُّ اسمٍ آخر — `insert`
 * و`update` و`remove` وأيُّ اسمٍ لم يُعلَن — **يُرفض عند لمسه** بـ
 * `MONITOR_WRITE_FORBIDDEN` قبل أن توجد مكالمة: لا يُعاد `undefined` فيُقال «ليس
 * دالّة» غامضاً، ولا تُعاد دالّةٌ ترفض عند تنفيذها فيُمكن تمريرُها. والكتابةُ
 * على المشهد نفسه (`view.insert = fn`) وحذفُ اسمٍ منه وإعادةُ تعريفِه مرفوضةٌ
 * بالرمز ذاته، فلا يُوسَّع السطحُ بعد إنشائه. وهذا معيارُ القبول: «كل محاولة
 * كتابة من هذا المسار تُرفض بنيوياً».
 *
 * **حدودٌ مُعلَنة:**
 * 1. هذه الوحدة لا تعرف **أيَّ** الأسماء كاتبة: هي تسمح بما مُرِّر إليها وترفض ما
 *    سواه. وقائمةُ الأسماء المقروءة بياناتٌ في `config/monitoring.yaml`، والحدُّ
 *    على أن يكون المُعلَنُ مقروءاً حقاً يقع في `src/observability/monitor-agent.mjs`
 *    عند التحميل — لأن الحدَّ على البيانات موضعُه محمِّلُ البيانات.
 * 2. المشهدُ يمنع الوصولَ إلى المستودع من خلاله؛ ولا يمنع من يملك المستودعَ أصلاً
 *    من الكتابة به مباشرةً. المنعُ بنيويٌّ **لهذا المسار** كما ينصّ معيارُ القبول،
 *    لا حجرٌ عامٌّ على بقية المستودع.
 * 3. الصورةُ المُعادةُ مُجمَّدةٌ تجميداً عميقاً عبر `snapshot`، وحدُّ التجميدِ
 *    المُعلَنُ هناك (‏`Buffer` و`Date` و`Map` تُمرَّر بالمرجع) قائمٌ هنا كما هو.
 */

import { snapshot } from '../lib/snapshot.mjs';

/** رمزُ الرفضِ البنيويِّ لكلِّ اسمٍ غيرِ مقروءٍ على المشهد. */
export const VIEW_ERRORS = Object.freeze({
  WRITE_FORBIDDEN: 'MONITOR_WRITE_FORBIDDEN',
});

/** خطأُ مشهدٍ للقراءةِ فقط برمزٍ مُعلَن. */
export class ReadOnlyViewError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   */
  constructor(code, message) {
    super(message);
    this.name = 'ReadOnlyViewError';
    this.code = code;
  }
}

/**
 * @typedef {(...args: unknown[]) => Promise<unknown>} ReaderFn
 */

/**
 * @typedef {object} ReadOnlyView
 * @property {string} viewId معرّفُ المشهدِ كما أُعلن.
 * @property {string} entity الجدولُ الذي يُقرأ منه فعلاً.
 * @property {readonly string[]} methods أسماءُ النداءاتِ المقروءةِ المتاحة.
 * @property {(name: string, args: readonly unknown[]) => Promise<unknown>} read
 */

/**
 * ينشئ مشهداً للقراءةِ فقط من دوالَّ قراءةٍ مُمرَّرة. المستودعُ لا يُمرَّر إلى
 * هنا ولا يُحفَظ: المُمرَّرُ دوالٌّ محدودةٌ يملكها المُنشئ، فلا طريقَ من المشهدِ
 * إلى المستودعِ ولو بالانعكاس (‏`Reflect`) لأن المرجعَ غيرُ موجودٍ في السطح.
 *
 * @param {{ viewId: string, entity: string, readers: Readonly<Record<string, ReaderFn>> }} spec
 * @returns {ReadOnlyView}
 */
export function createReadOnlyView({ viewId, entity, readers }) {
  const methods = Object.freeze(Object.keys(readers));

  /** @type {Record<string, unknown>} */
  const surface = Object.create(null);
  surface['viewId'] = viewId;
  surface['entity'] = entity;
  surface['methods'] = methods;
  for (const name of methods) {
    const reader = readers[name];
    if (typeof reader !== 'function') continue;
    surface[name] = async (/** @type {unknown[]} */ ...args) => snapshot(await reader(...args));
  }
  // النداءُ الموحَّد: يُستعمل حين يكون الاسمُ قيمةً وقت التشغيل، ويمرّ بنفسِ
  // الرفضِ لا بمسارٍ ثانٍ — لو كان له مسارٌ ثانٍ لصار بابَ تجاوزٍ للسطحِ نفسه.
  surface['read'] = async (/** @type {string} */ name, /** @type {readonly unknown[]} */ args) => {
    const reader = Object.hasOwn(readers, name) ? readers[name] : undefined;
    if (typeof reader !== 'function') {
      throw new ReadOnlyViewError(
        VIEW_ERRORS.WRITE_FORBIDDEN,
        `النداء «${name}» غيرُ مُعلَنٍ مقروءاً على مشهد «${viewId}»؛ وكلُّ ما ليس مقروءاً معلَناً مرفوضٌ بنيوياً لا مؤجَّلاً إلى تنفيذه.`,
      );
    }
    return snapshot(await reader(...args));
  };

  const target = Object.freeze(surface);

  return /** @type {ReadOnlyView} */ (
    /** @type {unknown} */ (
      new Proxy(target, {
        /**
         * @param {Record<string, unknown>} object
         * @param {string | symbol} property
         * @returns {unknown}
         */
        get(object, property) {
          if (typeof property === 'symbol') {
            // الرموزُ (‏`Symbol.toStringTag` وأدواتُ الفحصِ والطباعة) ليست أسماءَ
            // نداءٍ يخترعها مستدعٍ؛ ورميُ الخطأِ عندها كان سيكسر طباعةَ الكائنِ
            // في أوّلِ رسالةِ خطأٍ تُشير إليه — أي يُخفي الرفضَ الذي جاء يُعلنه.
            return Reflect.get(object, property);
          }
          if (Object.hasOwn(object, property)) return object[property];
          throw new ReadOnlyViewError(
            VIEW_ERRORS.WRITE_FORBIDDEN,
            `الاسم «${property}» غيرُ موجودٍ على مشهد «${viewId}» للقراءةِ فقط؛ فلا يُمسك المستدعي دالّةَ كتابةٍ أصلاً — الرفضُ عند اللمسِ لا عند التنفيذ.`,
          );
        },
        /**
         * @param {Record<string, unknown>} _object
         * @param {string | symbol} property
         * @returns {never}
         */
        set(_object, property) {
          throw new ReadOnlyViewError(
            VIEW_ERRORS.WRITE_FORBIDDEN,
            `لا يُكتب على مشهد «${viewId}»: محاولةُ إسنادٍ إلى «${String(property)}» مرفوضة، وسطحُ المشهدِ لا يُوسَّع بعد إنشائه.`,
          );
        },
        /**
         * @param {Record<string, unknown>} _object
         * @param {string | symbol} property
         * @returns {never}
         */
        deleteProperty(_object, property) {
          throw new ReadOnlyViewError(
            VIEW_ERRORS.WRITE_FORBIDDEN,
            `لا يُحذف من مشهد «${viewId}»: محاولةُ حذفِ «${String(property)}» مرفوضة، ومشهدٌ يُنقَص منه مشهدٌ يُعاد تشكيلُه بيدِ قارئه.`,
          );
        },
        /**
         * @param {Record<string, unknown>} _object
         * @param {string | symbol} property
         * @returns {never}
         */
        defineProperty(_object, property) {
          throw new ReadOnlyViewError(
            VIEW_ERRORS.WRITE_FORBIDDEN,
            `لا يُعاد تعريفُ «${String(property)}» على مشهد «${viewId}»؛ وإعادةُ التعريفِ بابُ إدخالِ نداءٍ كاتبٍ من خلفِ السطح.`,
          );
        },
        /**
         * @param {Record<string, unknown>} _object
         * @returns {never}
         */
        setPrototypeOf(_object) {
          throw new ReadOnlyViewError(
            VIEW_ERRORS.WRITE_FORBIDDEN,
            `لا يُبدَّل سلفُ مشهد «${viewId}»؛ وسلفٌ جديدٌ يُدخل أسماءً موروثةً لم تُعلَن مقروءة.`,
          );
        },
      })
    )
  );
}
