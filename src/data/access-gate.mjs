/**
 * بوابة الوصول إلى البيانات — الخطوة `M7.02`.
 *
 * **ما كان قبلها:** كان في فهرس البيانات دالّةٌ اسمها `canRead(id, actor, clearance)`
 * تقارن تصريحاً **يمرّره المُنادي** بتصنيف الأصل وترفع `DATA_ACCESS_DENIED` عامّاً.
 * فمن نادى الدالّة بـ`'sovereign'` قرأ السيادي؛ ولا سياسةَ قُيّمت، ولا تذكرةَ
 * قرارٍ تُحقَّق، ولا رفضَ يُسجَّل — والرفض غير المسجَّل لا يُرى فيه مسحٌ ولا اعتداء.
 * وأسوأ من ذلك: **الكتابة لم يكن عليها قرار إتاحة أصلاً**؛ `register` و`markQuality`
 * تكتبان في الفهرس بلا مرورٍ بنقطة التفويض.
 *
 * **وما صار:** كل قراءةٍ وكل كتابةٍ لأصل بيانات تمرّ من هنا، والترتيب مقصود:
 *
 *   1. **نقطة التفويض شرط تركيب**: بوابةٌ بلا نقطة تفويض لا تعمل، تُرفض بـ
 *      `DATA_ACCESS_ENFORCEMENT_REQUIRED` — الغياب رفضٌ لا تجاوز (المادة 9).
 *   2. **الأصل يُقرأ من الفهرس** فتصنيفُه يأتي من المستودع لا من الطلب.
 *   3. **`authorize` أولاً**: وفيه بوابةُ الهوية تستبدل ما يزعمه المُطالب من دورٍ
 *      وحالةٍ بما يقوله جذر الثقة، فدورٌ مزعوم يُرفض بـ`IDENTITY_UNVERIFIED`.
 *   4. **ثم يُشتقّ التخليص من الدور** عبر `lattice.clearanceFor` — بياناً في
 *      `config/classification.yaml` لا قيمةً في الطلب. ودورٌ بلا تخليص معلَن يُرفض.
 *   5. **ثم قرار السلّم**: القراءة تشترط أن يبلغ التخليص التصنيف أو يفوقه؛
 *      والكتابة تشترط عكسه — لا **كتابة إلى الأسفل**: من يحمل تخليصاً عالياً لا
 *      يكتب في أصلٍ أدنى تصنيفاً، لأن ذلك هو طريق النقل من السيادي إلى العام
 *      بلا إعادة تصنيف ولا اعتماد.
 *   6. **ثم `verify` للتذكرة مباشرةً قبل الأثر** فلا تُنفَّذ عمليةٌ بقرارٍ قديم أو
 *      لموردٍ آخر، والتذكرة تُستهلَك مرّة.
 *   7. **ثم الأثر**، ثم `data.access.granted` أو `data.write.committed`.
 *
 * وكلُّ رفضٍ يُسجَّل بـ`data.access.refused` برمزه، **ويُبلَّغ الحاجب** بإشارة
 * `clearance-denied` — فمحاولاتُ وصولٍ متكرّرة بلا تخليص تُفتح بها حادثة حجر بدل
 * أن تبقى أسطراً في سجل.
 *
 * **حدٌّ معلن:** هذه البوابة تحكم أصول `state.data_assets` وذاكرةَ الوكلاء
 * الموصولة بها. وحدودُ حجم الذاكرة وعزلُها بين الوكلاء عملُ الخطوة `M7.05` لا
 * هذه الخطوة، وتشفيرُ المادّة نفسها عملُ `M7.03`.
 */

/** @typedef {import('./classification.mjs').ClassificationLattice} AccessLattice */
/** @typedef {import('./classification.mjs').ClassificationValue} AccessTier */
/** @typedef {import('../policy/model.mjs').PolicyActor} Actor */
/** @typedef {import('../policy/enforcement-point.mjs').EnforcementPoint} EnforcementPoint */
/** @typedef {import('../root-of-trust/event-log.mjs').EventLog} AccessEventLog */

/** فعل القراءة كما هو معلَن في كتالوج الأفعال. */
export const READ_ACTION = 'read-data';

/** فعل الكتابة كما هو معلَن في كتالوج الأفعال. */
export const WRITE_ACTION = 'write-data';

/** نوع الشذوذ الذي تُبلَّغ به إشارةُ الحجر عند الرفض. */
export const ACCESS_ANOMALY = 'clearance-denied';

export const ACCESS_ERRORS = Object.freeze({
  ENFORCEMENT_REQUIRED: 'DATA_ACCESS_ENFORCEMENT_REQUIRED',
  ASSET_UNKNOWN: 'DATA_ACCESS_ASSET_UNKNOWN',
  ACTOR_REQUIRED: 'DATA_ACCESS_ACTOR_REQUIRED',
  CLEARANCE_UNDECLARED: 'DATA_ACCESS_CLEARANCE_UNDECLARED',
  CLEARANCE_INSUFFICIENT: 'DATA_ACCESS_CLEARANCE_INSUFFICIENT',
  WRITE_DOWN_REFUSED: 'DATA_ACCESS_WRITE_DOWN_REFUSED',
  NOT_AUTHORIZED: 'DATA_ACCESS_NOT_AUTHORIZED',
  TICKET_INVALID: 'DATA_ACCESS_TICKET_INVALID',
  EFFECT_REQUIRED: 'DATA_ACCESS_EFFECT_REQUIRED',
});

/** خطأ وصولٍ مُسمّى: الرمز للأتمتة، والنص للقارئ، والتفصيل للتدقيق. */
export class DataAccessError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   * @param {Record<string, unknown>} [detail]
   */
  constructor(code, message, detail = {}) {
    super(message);
    this.name = 'DataAccessError';
    /** @type {string} */
    this.code = code;
    /** @type {Record<string, unknown>} */
    this.detail = detail;
  }
}

export class DataAccessGate {
  /**
   * @param {{ log?: AccessEventLog, catalog?: { get: (id: string) => Promise<{ id: string, owner: string, classification: AccessTier } | null> }, lattice?: AccessLattice, enforcementPoint?: EnforcementPoint | null, quarantine?: { report: (input: { kind: string, subject: string, detail?: Record<string, unknown> }) => unknown } | null }} [deps]
   */
  constructor({ log, catalog, lattice, enforcementPoint = null, quarantine = null } = {}) {
    if (!log || !catalog || !lattice) throw new Error('DATA_ACCESS_DEPENDENCY_MISSING');
    this.log = log;
    this.catalog = catalog;
    /** @type {AccessLattice} */
    this.lattice = lattice;
    /** @type {EnforcementPoint | null} */
    this.enforcementPoint = enforcementPoint;
    /**
     * الحاجب اختياري في التركيب: بلاغُ الحجر تشديدٌ لا شرطُ صحة، وغيابُه لا يجعل
     * الرفض سماحاً. أما نقطةُ التفويض فغيابها رفضٌ.
     * @type {{ report: (input: { kind: string, subject: string, detail?: Record<string, unknown> }) => unknown } | null}
     */
    this.quarantine = quarantine;
  }

  /**
   * يقرأ أصلاً بعد قرار إتاحة كامل. الأثر `reader` يُستدعى **بعد** التحقّق من
   * التذكرة، ويُمرَّر إليه سجلُّ الأصل — فمن لم يمرّ بالبوابة لا يصل إلى المادة.
   * @param {object} request
   * @param {Actor} request.actor
   * @param {string} request.assetId
   * @param {string} [request.purpose]
   * @param {(asset: { id: string, owner: string, classification: AccessTier }) => unknown} request.reader
   * @returns {Promise<unknown>}
   */
  async read({ actor, assetId, purpose = 'unspecified', reader }) {
    return this.#decide({ actor, assetId, purpose, effect: reader, mode: 'read' });
  }

  /**
   * يكتب في أصل بعد قرار إتاحة كامل، ويمنع **الكتابة إلى الأسفل**.
   * @param {object} request
   * @param {Actor} request.actor
   * @param {string} request.assetId
   * @param {string} [request.purpose]
   * @param {(asset: { id: string, owner: string, classification: AccessTier }) => unknown} request.writer
   * @returns {Promise<unknown>}
   */
  async write({ actor, assetId, purpose = 'unspecified', writer }) {
    return this.#decide({ actor, assetId, purpose, effect: writer, mode: 'write' });
  }

  /**
   * التخليص المشتقّ من دور الفاعل. يُرفع خطأ مُسمّى لدورٍ بلا تخليص معلَن؛
   * ومَن أراد القيمة بلا رفعٍ قرأ `lattice.clearanceFor` مباشرة.
   * @param {Actor} actor
   * @returns {AccessTier}
   */
  clearanceOf(actor) {
    const clearance = this.lattice.clearanceFor(actor?.role);
    if (clearance === null) {
      throw new DataAccessError(
        ACCESS_ERRORS.CLEARANCE_UNDECLARED,
        `الدور «${actor?.role ?? 'مجهول'}» لا تخليص أمني معلَن له في config/classification.yaml؛ الأدوار المخلَّصة: ${this.lattice.clearedRoles.join('، ')}. الجهل بالتخليص رفضٌ لا افتراضُ أدنى مرتبة.`,
        { role: actor?.role ?? null },
      );
    }
    return clearance;
  }

  /**
   * يمنع إنشاء مادةٍ بتصنيفٍ أدنى من تخليص منشئها. تُنادى من مسار الإنشاء (حيث لا
   * أصلَ بعد فلا `assetId`)، وهي وجهُ «لا كتابة إلى الأسفل» عند الإنشاء.
   * @param {Actor} actor
   * @param {unknown} classification
   * @returns {AccessTier}
   */
  assertNoWriteDown(actor, classification) {
    const clearance = this.clearanceOf(actor);
    const target = this.lattice.tier(classification).id;
    if (this.lattice.rank(target) < this.lattice.rank(clearance)) {
      const detail = { classification: target, clearance, actorId: actor?.id ?? 'unknown' };
      this.log.append('data.access.refused', actor?.id ?? 'unknown', {
        ...detail,
        mode: 'create',
        code: ACCESS_ERRORS.WRITE_DOWN_REFUSED,
      });
      this.#raise(actor?.id ?? 'unknown', { ...detail, mode: 'create' });
      throw new DataAccessError(
        ACCESS_ERRORS.WRITE_DOWN_REFUSED,
        `فاعلٌ بتخليص «${clearance}» يُنشئ مادةً مصنّفة «${target}» أدنى من تخليصه؛ هذا هو طريقُ نقل المادة إلى الأسفل بلا إعادة تصنيف ولا اعتماد.`,
        detail,
      );
    }
    return target;
  }

  /**
   * @param {{ kind: string, subject: string, detail: Record<string, unknown> }} input
   */
  #signal({ kind, subject, detail }) {
    if (this.quarantine === null) return;
    try {
      this.quarantine.report({ kind, subject, detail });
    } catch {
      // فشلُ الحاجب لا يحوّل رفضاً إلى سماح، ولا يُخفي الخطأ الأصلي عن المُنادي.
    }
  }

  /**
   * @param {string} subject
   * @param {Record<string, unknown>} detail
   */
  #raise(subject, detail) {
    this.#signal({ kind: ACCESS_ANOMALY, subject, detail });
  }

  /**
   * @param {{ actor: Actor, assetId: string, purpose: string, effect: (asset: { id: string, owner: string, classification: AccessTier }) => unknown, mode: 'read' | 'write' }} request
   * @returns {Promise<unknown>}
   */
  async #decide({ actor, assetId, purpose, effect, mode }) {
    const action = mode === 'read' ? READ_ACTION : WRITE_ACTION;
    const actorId = actor?.id ?? 'unknown';

    /**
     * الرفض يُسجَّل ويُبلَّغ الحاجبَ ثم يُرفع. السجلُّ قبل الرفع لأن استثناءً يبتلعه
     * مُنادٍ آخر لا يترك أثراً، والأثر هو ما يُدقَّق.
     * @param {string} code
     * @param {string} message
     * @param {Record<string, unknown>} [detail]
     * @returns {never}
     */
    const refuse = (code, message, detail = {}) => {
      this.log.append('data.access.refused', actorId, { assetId, mode, action, code, ...detail });
      this.#raise(actorId, { assetId, mode, code, ...detail });
      throw new DataAccessError(code, message, { assetId, mode, ...detail });
    };

    if (typeof effect !== 'function') {
      refuse(
        ACCESS_ERRORS.EFFECT_REQUIRED,
        `طلبُ ${mode === 'read' ? 'قراءة' : 'كتابة'} بلا أثرٍ قابل للتنفيذ؛ بوابةٌ تُصدر قراراً ثم لا تُنفّذ شيئاً تُنتج تذاكر لا آثاراً.`,
      );
    }
    if (typeof actor?.id !== 'string' || actor.id.trim() === '') {
      refuse(ACCESS_ERRORS.ACTOR_REQUIRED, 'وصولٌ بلا فاعلٍ مُعرَّف: لا يُنسب ولا يُدقَّق.');
    }
    if (this.enforcementPoint === null) {
      refuse(
        ACCESS_ERRORS.ENFORCEMENT_REQUIRED,
        'بوابة الوصول بلا نقطة تفويض لا تُنفّذ قراءةً ولا كتابة؛ الغياب رفضٌ لا تجاوز.',
      );
    }

    const asset = await this.catalog.get(assetId);
    if (asset === null) {
      refuse(
        ACCESS_ERRORS.ASSET_UNKNOWN,
        `أصل البيانات «${assetId}» غير مفهرس؛ وصولٌ إلى ما لا تصنيف له يُرفض بدل أن يُعامَل عامّاً.`,
      );
    }
    const classification = asset.classification;

    const { decision, token } = await this.enforcementPoint.authorize({
      actor,
      action,
      resource: { type: 'data', id: assetId, classification, owner: asset.owner },
      context: { classification, purpose, mode },
    });
    if (!decision.allowed) {
      refuse(
        ACCESS_ERRORS.NOT_AUTHORIZED,
        `التفويض رفض ${mode === 'read' ? 'القراءة' : 'الكتابة'} برمز ${decision.code}: ${decision.reason}`,
        { classification, policyCode: decision.code },
      );
    }

    // التخليص يُشتقّ **بعد** التفويض: بوابة الهوية داخل `authorize` تستبدل الدور
    // المزعوم بما يقوله جذر الثقة، فاشتقاقُ التخليص من دورٍ لم يُتحقَّق بعد يبني
    // القرار على مطالبةٍ لا على هوية.
    /** @type {AccessTier} */
    let clearance;
    try {
      clearance = this.clearanceOf(actor);
    } catch (error) {
      const code =
        error instanceof DataAccessError ? error.code : ACCESS_ERRORS.CLEARANCE_UNDECLARED;
      refuse(code, error instanceof Error ? error.message : String(error), {
        classification,
        role: actor?.role ?? null,
      });
    }

    if (mode === 'read' && !this.lattice.dominates(clearance, classification)) {
      refuse(
        ACCESS_ERRORS.CLEARANCE_INSUFFICIENT,
        `تخليص «${clearance}» لا يبلغ تصنيف «${classification}»؛ القراءة مرفوضة ومسجَّلة.`,
        { classification, clearance },
      );
    }
    if (mode === 'write' && this.lattice.rank(classification) < this.lattice.rank(clearance)) {
      refuse(
        ACCESS_ERRORS.WRITE_DOWN_REFUSED,
        `كتابةٌ إلى الأسفل: تخليص «${clearance}» في أصلٍ مصنّف «${classification}». هذا الطريق يُخرج المادة من مرتبتها بلا إعادة تصنيف ولا اعتماد، فيُرفض.`,
        { classification, clearance },
      );
    }

    try {
      this.enforcementPoint.verify(token ?? undefined, {
        actorId: actor.id,
        action,
        resourceKey: `data:${assetId}`,
      });
    } catch (error) {
      refuse(
        ACCESS_ERRORS.TICKET_INVALID,
        `تذكرة القرار غير مقبولة: ${error instanceof Error ? error.message : String(error)}`,
        { classification, clearance },
      );
    }

    const result = await effect(asset);
    this.log.append(mode === 'read' ? 'data.access.granted' : 'data.write.committed', actor.id, {
      assetId,
      classification,
      clearance,
      purpose,
      action,
    });
    return result;
  }
}
