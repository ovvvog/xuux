/**
 * بوابة الخروج الخارجي — M6.05
 *
 * العيب الذي تعالجه: القدرة `network:egress` كانت **معلَنة** في كتالوج القدرات
 * وفي كتالوج الأفعال (`external-egress` في `config/policies.yaml`) بلا مسارٍ
 * واحدٍ ينفّذها. ومعنى ذلك أن أي وحدة تستدعي `fetch` مباشرة تُخرج بيانات خارج
 * حدود الدولة بلا قرار ولا سجل ولا حدّ معدّل — أي أن الإعلان كان توثيقاً لا حاجزاً.
 *
 * فالبوابة **المسار الوحيد** للخروج: لا تملك الوحدات ناقلاً خاصاً، بل تُمرَّر
 * حِزمتها هنا فتُقاس ثم تُقيَّم ثم تُسجَّل ثم تُنقل. والترتيب مقصود:
 *
 *   1. **الجهة** تُطابَق بسجلٍ معلَن أولاً: جهةٌ مجهولة تُرفض قبل أن يُقرأ محتوى
 *      الحِزمة، فلا يصير الرفض نفسه قناةً تُسرّب حجم البيانات إلى الخارج.
 *   2. **الحجم** يُقاس قبل التفويض: حِزمةٌ فوق الحدّ تُرفض بلا استهلاك حصّة.
 *   3. **حدّ المعدّل** يُحسب على الفاعل في نافذة زمنية: بغيره يصير الخروج
 *      المأذون قناةَ استنزافٍ بطلباتٍ صغيرة متتابعة، كلٌّ منها مأذون.
 *   4. **التفويض** عبر نقطة التفويض وحدها (`external-egress` فعلٌ حسّاس)، فتسري
 *      عليه سياسة منع المصنَّف الحسّاس وسياسة الجهات المعتمدة وحصّة البايتات.
 *   5. **التذكرة تُستهلَك في لحظة النقل** (`verify`) لا قبله بدقائق: إذنٌ مُصدَر
 *      ثم محفوظ لاستخدامٍ لاحق رخصةٌ دائمة، والمطلوب إذنٌ لحظي لمرّة واحدة.
 *   6. **السجل يُكتب في الحالتين**: الرفض يُسجَّل كما يُسجَّل النقل، وإلا صار سجل
 *      الخروج سجلَ النجاح فقط فلا يُرى الاعتداء.
 *
 * حدود معلنة:
 *   - البوابة لا تُشفّر الحمولة ولا تفحص محتواها؛ التصنيف يأتي من المُنادي
 *     ويُحاسَب عليه في السياسة، والتصنيف الكاذب عيبٌ في الفاعل لا في البوابة.
 *   - عدّاد المعدّل في الذاكرة: يُصفَّر بإعادة التشغيل، فهو حدٌّ لعمليةٍ واحدة لا
 *     حدٌّ موزَّع. الحصّة الدائمة مسؤولية دفتر الحصص في نقطة التفويض.
 *   - البوابة لا تمنع وحدةً تستدعي `fetch` بنفسها؛ منعُ ذلك عزلٌ حقيقي (M6.04)
 *     وهو غير منفَّذ. الحاجز هنا تنظيمي في الشيفرة لا حاجز نواة.
 */

const DEFAULT_WINDOW_MS = 60_000;
const DEFAULT_CALLS_PER_WINDOW = 30;
const DEFAULT_MAX_PAYLOAD_BYTES = 1_048_576;

/** فعل الخروج كما هو معلَن في كتالوج الأفعال؛ يُفوَّض ويُتحقَّق من تذكرته هنا. */
export const EGRESS_ACTION = 'external-egress';

export const EGRESS_ERRORS = Object.freeze({
  DEPENDENCY_MISSING: 'EGRESS_DEPENDENCY_MISSING',
  DESTINATION_UNKNOWN: 'EGRESS_DESTINATION_UNKNOWN',
  PAYLOAD_TOO_LARGE: 'EGRESS_PAYLOAD_TOO_LARGE',
  RATE_LIMIT_EXCEEDED: 'EGRESS_RATE_LIMIT_EXCEEDED',
  NOT_AUTHORIZED: 'EGRESS_NOT_AUTHORIZED',
  TICKET_INVALID: 'EGRESS_TICKET_INVALID',
  TRANSPORT_FAILED: 'EGRESS_TRANSPORT_FAILED',
});

/** خطأ مُسمّى: البوابات والأتمتة تقرأ الرمز، والنص العربي للقارئ البشري. */
export class EgressError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   * @param {Record<string, unknown>} [detail]
   */
  constructor(code, message, detail = {}) {
    super(message);
    this.name = 'EgressError';
    /** @type {string} */
    this.code = code;
    /** @type {Record<string, unknown>} */
    this.detail = detail;
  }
}

/**
 * @typedef {object} EgressDestination
 * @property {string} id معرّف الجهة كما تقرؤه السياسة في `context.destination`.
 * @property {string} uri العنوان المعلَن للجهة.
 * @property {string} purpose الغرض المعلَن؛ يُسجَّل مع كل نقل.
 */

/**
 * @typedef {object} EgressRequest
 * @property {import('../policy/model.mjs').PolicyActor} actor
 * @property {string} destination
 * @property {string | Uint8Array} payload
 * @property {string} [classification] تصنيف البيانات: `public` أو `internal` أو `sensitive` أو `secret`.
 * @property {string} [resourceId] معرّف المورد المُخرَج؛ يُبنى منه مفتاح المورد.
 * @property {Record<string, unknown>} [context] سياق إضافي يُدمج في طلب التفويض.
 */

export class EgressGate {
  /**
   * @param {{ enforcementPoint?: import('../policy/enforcement-point.mjs').EnforcementPoint, log?: { append: (type: string, actor: string, payload: object) => unknown }, transport?: (record: { destination: EgressDestination, bytes: number, payload: string | Uint8Array }) => Promise<unknown>, destinations?: readonly EgressDestination[], quarantine?: { report: (signal: object) => unknown } | null, callsPerWindow?: number, windowMs?: number, maxPayloadBytes?: number, now?: () => Date }} [deps]
   */
  constructor({
    enforcementPoint,
    log,
    transport,
    destinations = [],
    quarantine = null,
    callsPerWindow = DEFAULT_CALLS_PER_WINDOW,
    windowMs = DEFAULT_WINDOW_MS,
    maxPayloadBytes = DEFAULT_MAX_PAYLOAD_BYTES,
    now,
  } = {}) {
    if (!enforcementPoint || !log || typeof transport !== 'function') {
      throw new EgressError(
        EGRESS_ERRORS.DEPENDENCY_MISSING,
        'بوابة الخروج تحتاج نقطة تفويض وسجلاً وناقلاً: بوابةٌ بلا أحدها تسمح بالخروج بلا قرار أو بلا أثر.',
      );
    }
    this.enforcementPoint = enforcementPoint;
    this.log = log;
    this.transport = transport;
    this.quarantine = quarantine;
    this.callsPerWindow = callsPerWindow;
    this.windowMs = windowMs;
    this.maxPayloadBytes = maxPayloadBytes;
    this.now = now ?? (() => new Date());
    /** @type {Map<string, EgressDestination>} */
    this.destinations = new Map();
    for (const destination of destinations) this.destinations.set(destination.id, destination);
    /** @type {Map<string, number[]>} أوقات المحاولات لكل فاعل داخل النافذة */
    this.attempts = new Map();
  }

  /**
   * يقيس الحمولة بالبايت لا بالمحارف: المحرف العربي بايتان أو ثلاثة، وقياسه
   * محرفاً يجعل الحدّ المعلَن أكبر من الحقيقة.
   * @param {string | Uint8Array} payload
   * @returns {number}
   */
  static sizeOf(payload) {
    if (payload instanceof Uint8Array) return payload.byteLength;
    return Buffer.byteLength(String(payload ?? ''), 'utf8');
  }

  /**
   * يسجّل محاولة ويعيد عددها في النافذة الجارية.
   * @param {string} actorId
   * @returns {number}
   */
  #countAttempt(actorId) {
    const nowMs = this.now().getTime();
    const cutoff = nowMs - this.windowMs;
    const previous = (this.attempts.get(actorId) ?? []).filter((at) => at > cutoff);
    previous.push(nowMs);
    this.attempts.set(actorId, previous);
    return previous.length;
  }

  /**
   * يرفض ويسجّل ويُبلّغ الحجر. الرفض حدثٌ في السجل لا استثناءٌ صامت.
   * @param {string} code
   * @param {string} message
   * @param {{ actorId: string, destination: string, bytes: number, classification: string }} facts
   * @returns {never}
   */
  #refuse(code, message, facts) {
    this.log.append('egress.refused', facts.actorId, { code, reason: message, ...facts });
    if (this.quarantine !== null) {
      this.quarantine.report({
        kind: 'egress-refused',
        subject: facts.actorId,
        detail: { code, destination: facts.destination, bytes: facts.bytes },
      });
    }
    throw new EgressError(code, message, facts);
  }

  /**
   * المسار الوحيد للخروج الخارجي.
   * @param {EgressRequest} request
   * @returns {Promise<{ bytes: number, destination: string, policyId: string | null, result: unknown }>}
   */
  async send(request) {
    const actor = /** @type {{ id?: unknown }} */ (request.actor ?? {});
    const actorId = typeof actor.id === 'string' ? actor.id : 'unknown';
    const classification = request.classification ?? 'internal';
    const bytes = EgressGate.sizeOf(request.payload);
    const facts = { actorId, destination: request.destination, bytes, classification };

    const destination = this.destinations.get(request.destination);
    if (destination === undefined) {
      this.#refuse(
        EGRESS_ERRORS.DESTINATION_UNKNOWN,
        `الجهة «${request.destination}» غير معلَنة في سجل الجهات؛ الخروج إلى جهة غير معلَنة ممنوع ولو كان الفاعل مأذوناً بالخروج.`,
        facts,
      );
    }
    if (bytes > this.maxPayloadBytes) {
      this.#refuse(
        EGRESS_ERRORS.PAYLOAD_TOO_LARGE,
        `الحمولة ${bytes} بايت وحدّ الحِزمة ${this.maxPayloadBytes}؛ حِزمةٌ فوق الحدّ تُرفض قبل التفويض فلا تُخصم حصّة على مرفوض.`,
        facts,
      );
    }
    const attempts = this.#countAttempt(actorId);
    if (attempts > this.callsPerWindow) {
      this.#refuse(
        EGRESS_ERRORS.RATE_LIMIT_EXCEEDED,
        `تجاوز الفاعل ${actorId} حدّ المعدّل: ${attempts} محاولة في ${this.windowMs} مللي ثانية والحدّ ${this.callsPerWindow}.`,
        facts,
      );
    }

    const resourceId = request.resourceId ?? destination.id;
    const policyRequest = {
      actor: request.actor,
      action: EGRESS_ACTION,
      resource: { type: 'data', id: resourceId, classification },
      context: { ...(request.context ?? {}), destination: destination.id, bytes },
    };
    const { decision, token } = await this.enforcementPoint.authorize(policyRequest);
    if (!decision.allowed) {
      this.#refuse(
        EGRESS_ERRORS.NOT_AUTHORIZED,
        `التفويض رفض الخروج برمز ${decision.code}: ${decision.reason}`,
        facts,
      );
    }

    // التذكرة تُستهلَك هنا، بعد القرار وقبل النقل بسطرٍ واحد.
    try {
      this.enforcementPoint.verify(token ?? undefined, {
        actorId,
        action: EGRESS_ACTION,
        resourceKey: `data:${resourceId}`,
      });
    } catch (error) {
      this.#refuse(
        EGRESS_ERRORS.TICKET_INVALID,
        `تذكرة القرار غير مقبولة: ${error instanceof Error ? error.message : String(error)}`,
        facts,
      );
    }

    let result;
    try {
      result = await this.transport({ destination, bytes, payload: request.payload });
    } catch (error) {
      this.#refuse(
        EGRESS_ERRORS.TRANSPORT_FAILED,
        `فشل النقل إلى ${destination.id}: ${error instanceof Error ? error.message : String(error)}`,
        facts,
      );
    }

    this.log.append('egress.sent', actorId, {
      destination: destination.id,
      uri: destination.uri,
      purpose: destination.purpose,
      bytes,
      classification,
      policyId: decision.policyId,
      attemptsInWindow: attempts,
    });
    return { bytes, destination: destination.id, policyId: decision.policyId, result };
  }
}

/**
 * ينشئ بوابة الخروج.
 * @param {ConstructorParameters<typeof EgressGate>[0]} deps
 * @returns {EgressGate}
 */
export function createEgressGate(deps) {
  return new EgressGate(deps);
}
