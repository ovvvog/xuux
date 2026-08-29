/**
 * حدُّ معدَّلِ النداء — الخطوة `M9.02`.
 *
 * **العيبُ الذي تُغلقه هذه الوحدة:** كانت الحصّةُ الوحيدةُ في الدولةِ حصّةَ
 * `config/quotas.yaml` وتُخصم على **الأفعالِ المسموحة** وحدها (نقطةُ التفويضِ لا
 * تخصم على طلبٍ مرفوض، وذاك صحيحٌ في موضعِه: وإلا استُنزفت حصّةُ وكيلٍ بطلباتٍ
 * مرفوضةٍ يرسلها غيرُه). لكنّه يترك بابَ الواجهةِ مفتوحاً: مَن ينادي ألفَ نداءٍ
 * مرفوضٍ في الثانيةِ لا يُخصم منه شيءٌ ولا يوقفه أحد.
 *
 * فحدُّ المعدَّلِ هنا **يَعُدُّ المحاولةَ لا النجاح**: كلُّ نداءٍ وصل إلى ما بعد
 * المصادقةِ يُحسَب، سُمح به أو رُفض. والفارقُ عن الحصّةِ مقصودٌ ومعلَن:
 * الحصّةُ تحدّ **ما تملكه** من عملٍ نافذ، وهذا يحدّ **ما تطلبه** من النظامِ في
 * وحدةِ زمن.
 *
 * **نافذةٌ ثابتةٌ لا منزلقة، بحدٍّ معلَن:** النافذةُ الثابتةُ تسمح بذروةٍ على
 * حدِّ نافذتين متجاورتين (حتى ضِعفِ الحدِّ في لحظةٍ واحدة)، والمنزلقةُ تحتاج
 * حفظَ زمنِ كلِّ نداءٍ فتصير الذاكرةُ نفسُها سطحَ استنزاف. اختيرت الثابتةُ
 * ونُطق حدُّها بدل أن يُقال «حدُّ معدَّل» ويُترك ما يعنيه للتخمين.
 *
 * **المفتاحُ (مسار، هوية) لا الهويةُ وحدها:** حدٌّ على الهويةِ وحدها يجعل
 * قراءةَ سجلٍّ ثقيلٍ تُنفِق حدَّ كلِّ المسارات، وحدٌّ على المسارِ وحده يجعل
 * مُنادياً واحداً يُغلق المسارَ على الجميع.
 *
 * **حدٌّ معلَن:** العدّادُ في ذاكرةِ العملية. فحدُّ المعدَّلِ **لكلِّ عملية** لا
 * للعنقود، ونشرٌ بعدّةِ نسخٍ يُضاعف الحدَّ الفعليَّ بعددها. الحدُّ العنقوديُّ
 * يحتاج مخزناً مشتركاً وهو قرارُ تشغيلٍ في `M10`، ولا يُزعَم هنا.
 */

/** رمزُ رفضِ الحدّ — مُعلَنٌ في `config/api.yaml`. */
export const RATE_LIMIT_ERRORS = Object.freeze({
  RATE_LIMITED: 'API_RATE_LIMITED',
});

/** خطأُ حدِّ معدَّلٍ برمزٍ مُعلَن، يحمل مهلةَ إعادةِ المحاولةِ رقماً لا نصّاً. */
export class RateLimitError extends Error {
  /**
   * @param {string} message
   * @param {{ retryAfterSeconds: number, limit: number, windowSeconds: number }} detail
   */
  constructor(message, detail) {
    super(message);
    this.name = 'RateLimitError';
    this.code = RATE_LIMIT_ERRORS.RATE_LIMITED;
    this.retryAfterSeconds = detail.retryAfterSeconds;
    this.limit = detail.limit;
    this.windowSeconds = detail.windowSeconds;
  }
}

/**
 * @typedef {object} RateLimitRule
 * @property {number} windowSeconds
 * @property {number} maxCalls
 */

export class RateLimiter {
  /** @type {RateLimitRule} */
  #fallback;
  /** @type {Map<string, RateLimitRule>} */
  #rules;
  /** @type {() => Date} */
  #now;
  /** @type {Map<string, { windowStartMs: number, calls: number }>} */
  #windows = new Map();

  /**
   * @param {{ fallback: RateLimitRule, rules?: Map<string, RateLimitRule> | null, now?: () => Date }} deps
   */
  constructor({ fallback, rules = null, now }) {
    this.#fallback = fallback;
    this.#rules = rules ?? new Map();
    this.#now = now ?? (() => new Date());
  }

  /**
   * القاعدةُ النافذةُ على مسار: المُعلَنةُ له، وإلا الافتراضُ المُعلَنُ في الوثيقة.
   * @param {string} routeId
   * @returns {RateLimitRule}
   */
  ruleFor(routeId) {
    return this.#rules.get(routeId) ?? this.#fallback;
  }

  /**
   * يَعُدُّ محاولةً ويرفضُها إن تجاوزت الحدَّ. يُنادى **قبل** التفويضِ عن قصد:
   * الغرضُ أن يُحسَب النداءُ المرفوضُ أيضاً، ونداءٌ يُعَدُّ بعد السماحِ وحده لا
   * يحدّ من يُخفق ألفَ مرّة.
   * @param {{ routeId: string, actorId: string }} request
   * @returns {{ remaining: number, limit: number, windowSeconds: number, resetAt: string }}
   */
  consume({ routeId, actorId }) {
    const rule = this.ruleFor(routeId);
    const windowMs = rule.windowSeconds * 1000;
    const nowMs = this.#now().getTime();
    const key = `${routeId}\u0000${actorId}`;
    const current = this.#windows.get(key);
    const window =
      current === undefined || nowMs - current.windowStartMs >= windowMs
        ? { windowStartMs: nowMs, calls: 0 }
        : current;
    if (window.calls >= rule.maxCalls) {
      const resetAtMs = window.windowStartMs + windowMs;
      const retryAfterSeconds = Math.max(1, Math.ceil((resetAtMs - nowMs) / 1000));
      // العدّادُ لا يُزاد على المرفوضِ بالحدِّ نفسِه: زيادتُه تُطيل النافذةَ بلا
      // نهايةٍ لمن يُلِحّ، فيصير الحدُّ حظراً دائماً لا حدَّ معدَّل.
      this.#windows.set(key, window);
      throw new RateLimitError(
        `حدُّ المعدَّلِ على المسار ${routeId} استُنفد: ${rule.maxCalls} نداءً في ${rule.windowSeconds} ثانية. أعِد المحاولةَ بعد ${retryAfterSeconds} ثانية.`,
        { retryAfterSeconds, limit: rule.maxCalls, windowSeconds: rule.windowSeconds },
      );
    }
    window.calls += 1;
    this.#windows.set(key, window);
    return {
      remaining: rule.maxCalls - window.calls,
      limit: rule.maxCalls,
      windowSeconds: rule.windowSeconds,
      resetAt: new Date(window.windowStartMs + windowMs).toISOString(),
    };
  }
}
