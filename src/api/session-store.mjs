/**
 * جلساتُ طبقةِ الواجهةِ الداخلية — الخطوة `M9.02`.
 *
 * **العيبُ الذي تُغلقه هذه الوحدة:** لم يكن في المستودعِ مفهومُ «مُنادٍ موثَّق».
 * من ملك مرجعاً إلى وكيلِ المراقبةِ نادى `read` وأعطاه معرّفَ فاعلٍ **نصّاً**؛
 * فالمصادقةُ كانت مطالبةً يكتبها المستدعي عن نفسه، وذاك ليس مصادقةً بل ثقةً.
 * فصار للمُنادي **جلسةٌ** يُفتحها من يُثبت هويةً نشطةً في سجلِّ الهويات، ورمزُها
 * سرٌّ عشوائيٌّ لا يُشتقّ من الهويةِ ولا يُخمَّن منها.
 *
 * **قراراتٌ مقصودةٌ في التصميم:**
 * 1. **لا يُخزَّن الرمزُ نصّاً.** يُخزَّن `sha256` له وحده، والبحثُ يقع ببصمةِ ما
 *    قدّمه المُنادي. فمن قرأ ذاكرةَ العمليةِ أو مقطعَ تشخيصٍ لا يجد رمزاً صالحاً،
 *    بل بصماتٍ لا تُعاد إلى أصلها. والفارقُ عمليٌّ لا شكليّ: الجلسةُ سرٌّ حيٌّ
 *    يُقبل، بخلافِ معرّفِ الهويةِ الذي يُعلَن في كلِّ قيدِ تدقيق.
 * 2. **المهلةُ معلَنةٌ ولا تُمدَّد ضمناً.** جلسةٌ تُمدَّد بكلِّ نداءٍ جلسةٌ لا
 *    تنتهي، ومن سُرِق رمزُه بقي المسارُ مفتوحاً ما دام السارقُ ينادي. فالانتهاءُ
 *    بالوقتِ المطلق، ومن أراد المتابعةَ فتح جلسةً جديدةً بهويةٍ تُتحقَّق مرّةً أخرى.
 * 3. **الهويةُ تُقرأ عند الفتحِ وعند كلِّ حلٍّ.** فمن عُلِّق أو حُجِر بعد فتحِ
 *    جلستِه لا يُنادي بها: التحقُّقُ عند الفتحِ وحده يترك نافذةً بطولِ المهلة.
 * 4. **الرمزُ المنتهي يُحذف عند لمسِه** لا يُترك ينمو في الذاكرة، ولا يُعاد سببُ
 *    رفضٍ مبهم: `API_SESSION_EXPIRED` غيرُ `API_SESSION_INVALID` كي يُعرَف
 *    الفرقُ بين «انتهت» و«لا وجودَ لها».
 *
 * **حدودٌ معلَنة:** الجلساتُ في ذاكرةِ العمليةِ فتزول بإعادةِ التشغيل — وذاك
 * مقبولٌ لأن الجلسةَ إذنُ نداءٍ لحظيٌّ لا سجلٌّ دائم، وهو نفسُ اختيارِ تذكرةِ
 * نقطةِ التفويض. ولا عاملَ ثانٍ هنا: المصادقةُ القويةُ للملكِ نصُّ `M9.04`.
 */

import { createHash, randomBytes } from 'node:crypto';

/** رموزُ رفضِ الجلسة — كلُّها مُعلَنةٌ في `config/api.yaml`. */
export const SESSION_ERRORS = Object.freeze({
  AUTH_REQUIRED: 'API_AUTH_REQUIRED',
  SESSION_INVALID: 'API_SESSION_INVALID',
  SESSION_EXPIRED: 'API_SESSION_EXPIRED',
  IDENTITY_UNVERIFIED: 'API_IDENTITY_UNVERIFIED',
  AUDIT_REQUIRED: 'API_AUDIT_REQUIRED',
});

/** خطأُ جلسةٍ برمزٍ مُعلَن. */
export class SessionError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   */
  constructor(code, message) {
    super(message);
    this.name = 'SessionError';
    this.code = code;
  }
}

/**
 * @typedef {object} SessionPolicy
 * @property {number} ttlSeconds
 * @property {number} tokenBytes
 * @property {string} digest
 */

/**
 * @typedef {object} SessionAuditPolicy
 * @property {string} sessionOpenedEvent
 * @property {string} sessionClosedEvent
 */

/**
 * @typedef {object} SessionLogLike
 * @property {(type: string, actor: string, data: Record<string, unknown>) => unknown} append
 */

/**
 * @typedef {object} SessionAgentsLike
 * @property {(id: string) => Promise<Record<string, unknown> | null>} get
 */

/**
 * @typedef {object} ResolvedSession
 * @property {string} id بصمةُ الرمزِ مقتطعةً — معرّفُ الجلسةِ في قيودِ التدقيق، ولا يُعاد الرمز.
 * @property {string} actorId
 * @property {string} role
 * @property {string} state
 * @property {readonly string[]} capabilities
 * @property {string} expiresAt
 */

/**
 * يقتطع بصمةَ الرمزِ إلى معرّفٍ يُسجَّل. القيدُ يحتاج ما يُميّز الجلسةَ لا ما
 * يفتحها، والاقتطاعُ يمنع أن يصير القيدُ نفسُه خزانةَ بصماتٍ كاملة.
 * @param {string} fingerprint
 * @returns {string}
 */
function sessionIdOf(fingerprint) {
  return fingerprint.slice(0, 16);
}

export class SessionStore {
  /** @type {SessionPolicy} */
  #policy;
  /** @type {SessionAuditPolicy} */
  #audit;
  /** @type {SessionLogLike | null} */
  #log;
  /** @type {SessionAgentsLike | null} */
  #agents;
  /** @type {() => Date} */
  #now;
  /** @type {Map<string, { actorId: string, expiresAtMs: number, openedAtMs: number }>} */
  #sessions = new Map();

  /**
   * @param {{ policy: SessionPolicy, audit: SessionAuditPolicy, log?: SessionLogLike | null, agents?: SessionAgentsLike | null, now?: () => Date }} deps
   */
  constructor({ policy, audit, log = null, agents = null, now }) {
    this.#policy = policy;
    this.#audit = audit;
    this.#log = log;
    this.#agents = agents;
    this.#now = now ?? (() => new Date());
  }

  /** عددُ الجلساتِ القائمة — للقياسِ لا للوصول؛ ولا يُعاد رمزٌ ولا بصمةٌ كاملة. */
  get size() {
    return this.#sessions.size;
  }

  /**
   * يفتح جلسةً لهويةٍ مسجَّلةٍ نشطة. ويُعاد الرمزُ **مرّةً واحدةً هنا** ولا يُخزَّن،
   * فمن أضاعه فتح جلسةً جديدةً ولا يُستعاد.
   * @param {{ actorId: string }} request
   * @returns {Promise<{ token: string, sessionId: string, actorId: string, expiresAt: string }>}
   */
  async open(request) {
    const log = this.#log;
    if (log === null) {
      throw new SessionError(
        SESSION_ERRORS.AUDIT_REQUIRED,
        'سجلُّ الأحداثِ غيرُ موصولٍ بمخزنِ الجلسات؛ وجلسةٌ تُفتح بلا أثرٍ مصادقةٌ لا يُعرَف متى وقعت.',
      );
    }
    const actorId = typeof request?.actorId === 'string' ? request.actorId.trim() : '';
    const record = await this.#requireActiveIdentity(actorId);
    const token = randomBytes(this.#policy.tokenBytes).toString('base64url');
    const fingerprint = this.#fingerprint(token);
    const nowMs = this.#now().getTime();
    const expiresAtMs = nowMs + this.#policy.ttlSeconds * 1000;
    this.#sessions.set(fingerprint, { actorId, expiresAtMs, openedAtMs: nowMs });
    const sessionId = sessionIdOf(fingerprint);
    log.append(this.#audit.sessionOpenedEvent, actorId, {
      session: sessionId,
      role: String(record['role']),
      ttlSeconds: this.#policy.ttlSeconds,
      expiresAt: new Date(expiresAtMs).toISOString(),
    });
    return {
      token,
      sessionId,
      actorId,
      expiresAt: new Date(expiresAtMs).toISOString(),
    };
  }

  /**
   * يحلّ رمزاً إلى جلسةٍ وهويةٍ نشطة. كلُّ إخفاقٍ رمزٌ مُعلَن، ولا يسقط شيءٌ إلى
   * قبولٍ صامت.
   * @param {string | undefined | null} token
   * @returns {Promise<ResolvedSession>}
   */
  async resolve(token) {
    if (typeof token !== 'string' || token.trim() === '') {
      throw new SessionError(
        SESSION_ERRORS.AUTH_REQUIRED,
        'النداءُ بلا رمزِ جلسةٍ مرفوض؛ ومُنادٍ لا هويةَ له لا يُقرأ له طلب — والغيابُ رفضٌ لا استثناءٌ مسموح.',
      );
    }
    const fingerprint = this.#fingerprint(token);
    const entry = this.#sessions.get(fingerprint);
    if (entry === undefined) {
      throw new SessionError(
        SESSION_ERRORS.SESSION_INVALID,
        'رمزُ الجلسةِ لا يقابله جلسةٌ قائمة؛ ورمزٌ مجهولٌ يُرفض ولا يُفصَّل سببُ جهلِه كي لا يُستدلَّ به على رمزٍ صالح.',
      );
    }
    // ولا مقارنةَ سرٍّ هنا يُقاس زمنُها: المفتاحُ في الخريطةِ **بصمةُ** ما قدّمه
    // المُنادي، فالمقارنةُ تقع على قيمةٍ مشتقّةٍ من مُدخلِه لا على السرِّ المحفوظ،
    // ولا يُسرَّب من زمنِ اللَّقْطِ موضعُ اختلافٍ في رمزٍ صالح. ومقارنةٌ «ثابتةُ
    // الزمن» تُكتب هنا على البصمةِ بنفسِها زينةٌ لا تحرس شيئاً، فلم تُكتب.
    const nowMs = this.#now().getTime();
    if (nowMs >= entry.expiresAtMs) {
      // المنتهيةُ تُحذف عند لمسِها: تركُها ينمو بالذاكرةِ ويجعل «عدد الجلسات»
      // رقماً لا يقول شيئاً.
      this.#sessions.delete(fingerprint);
      throw new SessionError(
        SESSION_ERRORS.SESSION_EXPIRED,
        `الجلسةُ انتهت في ${new Date(entry.expiresAtMs).toISOString()}؛ والمهلةُ معلَنةٌ ولا تُمدَّد بالاستعمال — فمن أراد المتابعةَ فتح جلسةً بهويةٍ تُتحقَّق من جديد.`,
      );
    }
    const record = await this.#requireActiveIdentity(entry.actorId);
    const capabilitiesRaw = record['capabilities'];
    return Object.freeze({
      id: sessionIdOf(fingerprint),
      actorId: entry.actorId,
      role: String(record['role']),
      state: String(record['state']),
      capabilities: Object.freeze(
        Array.isArray(capabilitiesRaw) ? capabilitiesRaw.map(String) : [],
      ),
      expiresAt: new Date(entry.expiresAtMs).toISOString(),
    });
  }

  /**
   * يُغلق جلسةً. وإغلاقُ جلسةٍ غيرِ قائمةٍ لا يُخفق: الغرضُ ألا تبقى، وهي ليست
   * باقيةً — والقيدُ يُكتب لما أُغلق فعلاً وحده.
   * @param {string | undefined | null} token
   * @returns {boolean}
   */
  close(token) {
    if (typeof token !== 'string' || token.trim() === '') return false;
    const fingerprint = this.#fingerprint(token);
    const entry = this.#sessions.get(fingerprint);
    if (entry === undefined) return false;
    this.#sessions.delete(fingerprint);
    this.#log?.append(this.#audit.sessionClosedEvent, entry.actorId, {
      session: sessionIdOf(fingerprint),
      openedAt: new Date(entry.openedAtMs).toISOString(),
    });
    return true;
  }

  /**
   * @param {string} actorId
   * @returns {Promise<Record<string, unknown>>}
   */
  async #requireActiveIdentity(actorId) {
    const agents = this.#agents;
    if (agents === null) {
      throw new SessionError(
        SESSION_ERRORS.IDENTITY_UNVERIFIED,
        'سجلُّ الهوياتِ غيرُ موصولٍ بمخزنِ الجلسات؛ وجلسةٌ تُفتح لهويةٍ لا تُقرأ جلسةٌ لفاعلٍ مزعوم (المادة 9).',
      );
    }
    if (actorId === '') {
      throw new SessionError(
        SESSION_ERRORS.IDENTITY_UNVERIFIED,
        'الجلسةُ بلا معرّفِ هويةٍ مرفوضة؛ ومُنادٍ بلا اسمٍ لا يُسأل عن نداءِه أحد.',
      );
    }
    const record = await agents.get(actorId);
    if (record === null) {
      throw new SessionError(
        SESSION_ERRORS.IDENTITY_UNVERIFIED,
        `الهوية «${actorId}» غيرُ مسجَّلةٍ في سجلِّ الهويات؛ ومن ليس هويةً مسجَّلةً لا تُفتح له جلسةٌ ولا تُقبل منه.`,
      );
    }
    const state = record['state'];
    if (state !== 'active') {
      throw new SessionError(
        SESSION_ERRORS.IDENTITY_UNVERIFIED,
        `الهوية «${actorId}» حالُها «${String(state)}» لا «active»؛ ومن عُلِّق أو حُجِر لا تبقى له جلسةٌ ولو فُتحت قبل تعليقه.`,
      );
    }
    return record;
  }

  /**
   * بصمةُ الرمز. تُحسب بالخوارزميةِ المُعلَنةِ في الوثيقةِ لا بواحدةٍ مكتوبةٍ في
   * الكود، كي يكون تغييرُها قراراً يُقرأ في البيانات.
   * @param {string} token
   * @returns {string}
   */
  #fingerprint(token) {
    return createHash(this.#policy.digest).update(token, 'utf8').digest('hex');
  }
}
