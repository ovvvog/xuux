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

import { createHash, randomBytes, createPublicKey, verify as cryptoVerify } from 'node:crypto';

/** رموزُ رفضِ الجلسة — كلُّها مُعلَنةٌ في `config/api.yaml`. */
export const SESSION_ERRORS = Object.freeze({
  AUTH_REQUIRED: 'API_AUTH_REQUIRED',
  SESSION_INVALID: 'API_SESSION_INVALID',
  SESSION_EXPIRED: 'API_SESSION_EXPIRED',
  IDENTITY_UNVERIFIED: 'API_IDENTITY_UNVERIFIED',
  AUDIT_REQUIRED: 'API_AUDIT_REQUIRED',
  // إثباتُ الحيازةِ (M11.04 — GPT-F01 / Grok-F02): الجلسةُ لا تُفتح ولا تُحَلُّ
  // بمعرّفٍ عامٍّ وحدَه. لا بدَّ من توقيعٍ يُثبتُ حيازةَ المفتاحِ الخاصِّ المربوطِ
  // بالفاعلِ. والفشلُ مغلقٌ: غيابُ التوقيعِ أو خطؤُه أو إعادةُ تشغيله رفضٌ لا قبولٌ صامت.
  POP_REQUIRED: 'API_POP_REQUIRED',
  POP_INVALID: 'API_POP_INVALID',
  POP_REPLAY: 'API_POP_REPLAY',
  POP_EXPIRED: 'API_POP_EXPIRED',
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
  /** @type {Map<string, { actorId: string, expiresAtMs: number, openedAtMs: number, popPublicKey: import('node:crypto').KeyObject | null, nonces: Set<string> }>} */
  #sessions = new Map();
  /** @type {boolean} */
  #requirePoP;
  /** @type {Map<string, import('node:crypto').KeyObject>} */
  #popKeys = new Map();
  /** @type {Set<string>} */
  #openNonces = new Set();
  /** @type {number} نافذةُ قبولِ الطابعِ الزمنيِّ بالثواني — خارجُها رفضٌ يمنعُ إعادةَ التشغيل. */
  #popWindowSeconds = 300;

  /**
   * @param {{ policy: SessionPolicy, audit: SessionAuditPolicy, log?: SessionLogLike | null, agents?: SessionAgentsLike | null, now?: () => Date, requirePoP?: boolean, popWindowSeconds?: number }} deps
   */
  constructor({
    policy,
    audit,
    log = null,
    agents = null,
    now,
    requirePoP = true,
    popWindowSeconds = 300,
  }) {
    this.#policy = policy;
    this.#audit = audit;
    this.#log = log;
    this.#agents = agents;
    this.#now = now ?? (() => new Date());
    this.#requirePoP = requirePoP !== false;
    if (Number.isFinite(popWindowSeconds) && popWindowSeconds > 0) {
      this.#popWindowSeconds = popWindowSeconds;
    }
  }

  /** عددُ الجلساتِ القائمة — للقياسِ لا للوصول؛ ولا يُعاد رمزٌ ولا بصمةٌ كاملة. */
  get size() {
    return this.#sessions.size;
  }

  /**
   * يُسجِّلُ مفتاحًا عامًّا لإثباتِ الحيازةِ لفاعلٍ ما (M11.04 — GPT-F01/Grok-F02).
   * **لا يُفتَحُ مفتاحٌ خاصٌّ هنا ولا يُخزَّنُ:** يُسجَّلُ المفتاحُ العامُّ وحدَه،
   * فيُثبتُ مَن يَملكُ الخاصَّ المقابلَ دون أن يَقدِرَ النظامُ نفسُه على انتحالِه.
   * والفشلُ مغلقٌ: إن لُزِمَ PoP ولم يُسجَّلْ للفاعلِ مفتاحٌ، لا تُفتَحُ له جلسةٌ
   * ولو أثبتَ هويةً نشطة — فالمعرّفُ العامُّ وحدَه لا يكفي.
   * @param {string} actorId
   * @param {string} publicKeyPem — مفتاحٌ عامٌّ Ed25519 بصيغةِ SPKI PEM
   * @returns {boolean} هل سُجِّلَ المفتاحُ صالحًا
   */
  registerPoPKey(actorId, publicKeyPem) {
    if (typeof actorId !== 'string' || actorId.trim() === '') return false;
    if (typeof publicKeyPem !== 'string' || publicKeyPem.trim() === '') return false;
    try {
      const key = createPublicKey(publicKeyPem);
      if (key.asymmetricKeyType !== 'ed25519') return false;
      this.#popKeys.set(actorId, key);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * هل لُزِمَ إثباتُ الحيازةِ في هذا المخزن؟ للقراءةِ في القيودِ لا لتغييرِ السلوك.
   * @returns {boolean}
   */
  get requirePoP() {
    return this.#requirePoP;
  }

  /**
   * يتحققُ من إثباتِ الحيازةِ لكلِّ طلبٍ (M11.04 — GPT-F01/Grok-F02). لا يكفي فتحُ
   * الجلسةِ مرّةً: من سُرِقَ الرمزُ لا يَنْتَحِلُ صاحبَه إلا بتوقيعٍ جديدٍ على حمولةِ
   * الطلبِ نفسِه، بطابعٍ زمنيٍّ داخلَ النافذةِ وnonceٍ غيرِ مكرَّرٍ. والفشلُ مغلقٌ.
   * @param {ResolvedSession} session
   * @param {{ popSignature: string | undefined, popTimestamp: string | undefined, popNonce: string | undefined, canonicalPayload: string }} ctx
   * @returns {void}
   */
  verifyPoP(session, ctx) {
    if (!this.#requirePoP) return;
    const fingerprint = session.id;
    // الجلسةُ لا تُوجدُ بـ`id` وحده — `id` مقطوعٌ من البصمة، فنبحثُ بالجلسةِ نفسِها
    // بحثًا يربطُ التحقّقَ بالخريطةِ لا بنصٍّ يكتبُه المستدعي.
    let entry = null;
    for (const [fp, e] of this.#sessions) {
      if (sessionIdOf(fp) === fingerprint) {
        entry = e;
        break;
      }
    }
    if (entry === null || entry.popPublicKey === null) {
      throw new SessionError(
        SESSION_ERRORS.POP_REQUIRED,
        'الجلسةُ لا تحملُ مفتاحَ حيازةٍ مربوطًا؛ ولا تُحَلُّ جلسةٌ بلا إثباتِ حيازةٍ في تركيبٍ يُلزمُه.',
      );
    }
    const { popSignature, popTimestamp, popNonce, canonicalPayload } = ctx ?? {};
    if (
      typeof popSignature !== 'string' ||
      typeof popTimestamp !== 'string' ||
      typeof popNonce !== 'string' ||
      typeof canonicalPayload !== 'string'
    ) {
      throw new SessionError(
        SESSION_ERRORS.POP_REQUIRED,
        'لا يُقبلُ الطلبُ بلا توقيعِ حيازةٍ وطابعٍ زمنيٍّ وnonceٍ وحمولةٍ متّفَقٍ عليها؛ والغيابُ رفضٌ لا استثناءٌ مسموح.',
      );
    }
    this.#checkTimestamp(popTimestamp);
    if (entry.nonces.has(popNonce)) {
      throw new SessionError(
        SESSION_ERRORS.POP_REPLAY,
        'الـnonce مكرَّرٌ؛ ولا يُقبلُ توقيعٌ واحدٌ مرّتَين — فإعادةُ التشغيلِ مرفوضةٌ ولو كان التوقيعُ صالحًا.',
      );
    }
    const message = this.#canonicalMessage(canonicalPayload, popTimestamp, popNonce);
    if (!this.#verifySignature(entry.popPublicKey, message, popSignature)) {
      throw new SessionError(
        SESSION_ERRORS.POP_INVALID,
        'توقيعُ الحيازةِ لا يطابقُ المفتاحَ المربوطَ بالجلسةِ على الحمولةِ المُوقَّعةِ؛ فمن لا يملكُ الخاصَّ لا يُمثِّلُ صاحبَ الجلسة.',
      );
    }
    entry.nonces.add(popNonce);
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
    // إثباتُ الحيازةِ عندَ الفتحِ (M11.04 — GPT-F01/Grok-F02): المعرّفُ العامُّ وحدَه
    // لا يَنْتَحِلُ. لا بدَّ من توقيعٍ يُثبتُ حيازةَ المفتاحِ الخاصِّ المربوطِ بالفاعلِ،
    // وإلا بقيَتِ الثغرةُ: من عرفَ معرّفًا نشطًا فتحَ جلسةً كأنّه صاحبُها. والفشلُ مغلقٌ.
    const popPublicKey = this.#requireOpenPoP(actorId, request);
    const token = randomBytes(this.#policy.tokenBytes).toString('base64url');
    const fingerprint = this.#fingerprint(token);
    const nowMs = this.#now().getTime();
    const expiresAtMs = nowMs + this.#policy.ttlSeconds * 1000;
    this.#sessions.set(fingerprint, {
      actorId,
      expiresAtMs,
      openedAtMs: nowMs,
      popPublicKey,
      nonces: new Set(),
    });
    const sessionId = sessionIdOf(fingerprint);
    log.append(this.#audit.sessionOpenedEvent, actorId, {
      session: sessionId,
      role: String(record['role']),
      ttlSeconds: this.#policy.ttlSeconds,
      expiresAt: new Date(expiresAtMs).toISOString(),
      popEnforced: this.#requirePoP,
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
   * يلزمُ إثباتَ الحيازةِ عندَ فتحِ الجلسةِ. يُعيدُ المفتاحَ العامَّ المربوطَ
   * بالفاعلِ ليُخزَّنَ على الجلسةِ، أو يرفضُ فشلاً مغلقًا. وإن لم يُلزمِ المخزنُ PoP
   * فلا يُتحقَّقُ شيءٌ (توافقٌ مع الإصدارِ).
   * @param {string} actorId
   * @param {Record<string, unknown>} request
   * @returns {import('node:crypto').KeyObject | null}
   */
  #requireOpenPoP(actorId, request) {
    if (!this.#requirePoP) return null;
    const publicKey = this.#popKeys.get(actorId);
    if (publicKey === undefined) {
      throw new SessionError(
        SESSION_ERRORS.POP_REQUIRED,
        `لا مفتاحَ حيازةٍ مسجَّلٌ للفاعلِ «${actorId}»؛ ولا تُفتَحُ جلسةٌ بمعرّفٍ عامٍّ وحدَه — فمن عرفَ الاسمَ لا يَنْتَحِلُ صاحبَه.`,
      );
    }
    const popSignature = typeof request?.popSignature === 'string' ? request.popSignature : '';
    const popTimestamp = typeof request?.popTimestamp === 'string' ? request.popTimestamp : '';
    const popNonce = typeof request?.popNonce === 'string' ? request.popNonce : '';
    if (popSignature === '' || popTimestamp === '' || popNonce === '') {
      throw new SessionError(
        SESSION_ERRORS.POP_REQUIRED,
        'فتحُ الجلسةِ يلزمُه توقيعُ حيازةٍ وطابعٌ زمنيٌّ وnonceٌ؛ والغيابُ رفضٌ لا استثناءٌ مسموح.',
      );
    }
    this.#checkTimestamp(popTimestamp);
    if (this.#openNonces.has(popNonce)) {
      throw new SessionError(
        SESSION_ERRORS.POP_REPLAY,
        'الـnonce مكرَّرٌ عندَ الفتحِ؛ ولا يُقبلُ توقيعٌ واحدٌ مرّتَين.',
      );
    }
    const message = this.#canonicalOpenMessage(actorId, popTimestamp, popNonce);
    if (!this.#verifySignature(publicKey, message, popSignature)) {
      throw new SessionError(
        SESSION_ERRORS.POP_INVALID,
        'توقيعُ الفتحِ لا يطابقُ المفتاحَ المسجَّلَ للفاعلِ؛ فمن لا يملكُ الخاصَّ لا يفتحُ جلسةً باسمِه.',
      );
    }
    this.#openNonces.add(popNonce);
    return publicKey;
  }

  /**
   * يتحققُ من أنّ الطابعَ الزمنيِّ داخلَ نافذةِ القبولِ. الفشلُ مغلقٌ: طابعٌ قديمٌ
   * أو مستقبليٌّ خارجٌ عن النافذةِ يُرفضُ كي لا يُعادَ تشغيلُ توقيعٍ مسجَّلٍ سلفًا.
   * @param {string} popTimestamp - ISO 8601
   */
  #checkTimestamp(popTimestamp) {
    const ts = Date.parse(popTimestamp);
    if (!Number.isFinite(ts)) {
      throw new SessionError(
        SESSION_ERRORS.POP_EXPIRED,
        'الطابعُ الزمنيُّ لإثباتِ الحيازةِ غيرُ مقروءٍ؛ وما لا يُعرَفُ وقتُه لا يُقبلُ توقيعُه.',
      );
    }
    const nowMs = this.#now().getTime();
    const skewMs = Math.abs(nowMs - ts);
    if (skewMs > this.#popWindowSeconds * 1000) {
      throw new SessionError(
        SESSION_ERRORS.POP_EXPIRED,
        `الطابعُ الزمنيُّ لإثباتِ الحيازةِ خارجَ نافذةِ القبولِ (‏${this.#popWindowSeconds}ث)؛ والتوقيعُ منتهيًا لا يُقبلُ ولو كان صالحًا.`,
      );
    }
  }

  /**
   * صياغةُ الرسالةِ المتّفَقِ عليها للتحققِ من التوقيعِ. الثباتُ شرطٌ: تغييرُ ترتيبٍ
   * أو فاصلٍ يكسرُ التحقّقَ، فلا يُتركُ للموقِّعِ أن يختارَه.
   * @param {string} canonicalPayload
   * @param {string} popTimestamp
   * @param {string} popNonce
   * @returns {string}
   */
  #canonicalMessage(canonicalPayload, popTimestamp, popNonce) {
    return `${canonicalPayload}|${popTimestamp}|${popNonce}`;
  }

  /**
   * الرسالةُ المتّفَقُ عليها عندَ الفتحِ: توقّعُ الحمولةِ على المعرّفِ والطابعِ وnonce.
   * @param {string} actorId
   * @param {string} popTimestamp
   * @param {string} popNonce
   * @returns {string}
   */
  #canonicalOpenMessage(actorId, popTimestamp, popNonce) {
    return this.#canonicalMessage(`open:${actorId}`, popTimestamp, popNonce);
  }

  /**
   * يتحققُ من توقيعِ Ed25519. كلُّ ما لا يمكنُ التحققُ منه يُرجعُ `false` لا أن يُسقطَ
   * الفاحصَ — فالتوقيعُ التالفُ باطلٌ لا حادثٌ.
   * @param {import('node:crypto').KeyObject} publicKey
   * @param {string} message
   * @param {string} signatureB64url
   * @returns {boolean}
   */
  #verifySignature(publicKey, message, signatureB64url) {
    try {
      return cryptoVerify(
        null,
        Buffer.from(message, 'utf8'),
        publicKey,
        Buffer.from(signatureB64url, 'base64url'),
      );
    } catch {
      return false;
    }
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
