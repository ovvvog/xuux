/**
 * دفتر منح القدرات — M6.02
 *
 * المسألة التي يحلّها: قدرات الوكيل كانت مصفوفةً تُكتب مرّةً عند التسجيل وتبقى
 * ما بقي الوكيل. فمن احتاج قدرةً لساعة أخذها للأبد، ولا أحد يعرف **من** منحها
 * ولا **لماذا** ولا **حتى متى** — والتوسّع في الصلاحية بلا انتهاء هو أكثر ما
 * يحوّل وكيلاً مفيداً إلى خطر بمرور الوقت.
 *
 * فصار المنح **عقداً بأربعة حقول إلزامية**: القدرة، والسبب، والمانح، والمدة.
 * وانتهاء المدة **يُسقط القدرة بلا تدخّل**: لا حاصد مجدول ولا مهمة تنظيف —
 * القراءة نفسها تُقاس بالساعة المُمرَّرة، فمنحٌ انتهى لا يظهر في القدرات
 * الفعّالة ولو لم يُحذف من المخزن بعد. وذلك مقصود: تنظيفٌ لم يعمل لا يجوز أن
 * يترك قدرةً سارية.
 *
 * ثلاث قواعد يُرفض ما خالفها بخطأ مُسمّى:
 *   1. **المحرَّم لا يُمنح** (`M6.03`): يُرفض ويُفتح به حادثة، لا يُرفض بصمت.
 *   2. **المدة لها سقف من البيانات**: `maxDurationSeconds` في الكتالوج، فمن طلب
 *      أطول رُفض — والسقف يُقرأ من الملف لا من الكود.
 *   3. **المانح غير المستفيد**: من منح نفسه قدرةً صار سقفه سقف رغبته.
 * **دوامُ المنحِ عقدٌ على المُركِّبِ (شطرُ «المنح» من `R6-A-05`، `WL-355`):** الدفترُ
 * يقبلُ مخزناً بعقدِ `load`/`save` — إن مُرِّرَ استرجعَ المنحَ عندَ البناءِ وأدامَ
 * كلَّ تغييرٍ (منحٌ وسحبٌ وتفريغٌ) فورَ وقوعِه، وإن لم يُمَرَّر بقيَ في الذاكرةِ
 * كما كانَ (تركيبٌ يختارُ عدمَ الدوامِ يُضيّقُ الصلاحيةَ عندَ الإقلاعِ لا
 * يُوسّعُها). والاسترجاعُ **مُتحقَّقٌ لا مُصدَّقٌ**: كلُّ مُدخلٍ يُفحصُ حقلاً
 * حقلاً (نصوصٌ غيرُ فارغةٍ وتواريخُ مقروءةٌ واتّساقُ السحبِ)، ولقطةٌ معطوبةٌ
 * تُرفَعُ بخطأٍ مُسمّى لا تُفترَضُ سليمةً. وحدٌّ مُعلَنٌ: اللقطةُ الملفّيةُ ليست
 * مختومةً — حمايةُ ملفّاتِها من العبثِ شأنُ التركيبِ الذي يختارُ موضعَها (جذرُ
 * حالةٍ مختومٍ في الإنتاجِ)، وهذا عينُ عقدِ مخزنِ ميزانيةِ الاستدلالِ (`LIM-1`).
 *
 * **WL-361 (‏`R6-A-05`، تتمّةُ «المنح»): الاسترجاعُ الآن **مُقيدٌ بشاهدٍ مختومٍ**
 * لا مجرد فحصِ شكلٍ.** من يفحصُ شكلَ مُدخلٍ لا يثبتُ أصالتَهُ: ملفٌّ صالحُ
 * البنيةِ (‏JSON سليمٌ، الحقولُ كلُّها موجودةٌ) بيدِ صاحبِ القرصِ قد يَحمِلُ منحاً
 * لم يُصدرها المانحُ الحقيقيُّ أبداً — `grantedBy`/`grantorRole` داخلَ الملفِّ
 * ادّعاءٌ لا برهانٌ. فالاسترجاعُ اليومَ يقارنُ كلَّ منحةٍ بحدثٍ مختومٍ (`
 * capability.granted`) في السجلِّ الذي يملكُ الحقيقةَ، ولا تُقبَلُ منحةٌ بلا شاهدٍ
 * مطابقٍ (`CAPABILITY_GRANT_UNWITNESSED`). والسحبُ يُقرأُ من الشاهدِ أيضاً: منحٌ
 * تُركَ في اللقطةِ غيرَ مسحوبٍ وأُشهدَ بسحبِهِ يُبعثُ **مسحوباً** لا سارياً.
 *
 * **WL-363 (‏قرارُ المالكِ، تتمّةُ «المنح»): المنحُ والسحبُ داخلَ معاملةِ حاجزِ
 * الالتزامِ.** لقطةُ المنحِ صارتْ منَ مكوّناتِ بصمةِ الحالةِ المختومةِ، فكتابتُها
 * لا تقعُ إلا داخلَ معاملةٍ (`runTxn`) يُسجِّلُ حاجزُ الالتزامِ تراجعَها ويُحدِّثُ
 * هضمَ الحالةِ ويرفَعُ البيانَ معَ ختمِ الشاهدِ في السجلِّ — كتلةً واحدةً أو لا شيء.
 * والمسارُ المتزامنُ (`grant`/`revoke`) يَرفُضُ العملَ تحتَ حاجزٍ مُنشَّطٍ (`CAPABILITY_GRANT_TXN_REQUIRED`):
 * لا نجاحَ قبلَ دوامِ الحالةِ والشاهدِ معاً، ولا كاتبَ ثانٍ في الجذرِ يُقبَلُ صامتاً.
 */

import { randomUUID } from 'node:crypto';
import { IncidentSeverity } from './incident-register.mjs';

/** @typedef {import('./capability-catalog.mjs').CapabilityCatalog} CapabilityCatalog */

/**
 * مانحٌ موثَّقٌ — هويةٌ تحقّقَ منها بوابةُ الهويّة (أو إثباتُ الحيازة) لا
 * ادّعاءٌ من الطالب. الدورُ هنا حقيقيٌّ لا قابلٌ للتزوير: لا يُقبلُ دورٌ
 * مختلفٌ عمّا ثبتَ في المانح، ومحاولةُ التظاهرِ بدورٍ أرفعَ تُرفضُ صراحةً.
 * @typedef {{ id: string, role: string, state: string }} VerifiedPrincipal
 */

/**
 * منحة واحدة كما تُقرأ.
 * @typedef {object} CapabilityGrant
 * @property {string} id
 * @property {string} agentId
 * @property {string} capability
 * @property {string} reason
 * @property {string} grantedBy
 * @property {string} grantorRole
 * @property {string} grantedAt
 * @property {string} expiresAt
 * @property {string | null} revokedAt
 * @property {string | null} revokedReason
 */

export class CapabilityGrantLedger {
  /**
   * @param {{ catalog?: CapabilityCatalog, log?: { append: (type: string, actor: string, payload: object) => unknown, flush?: () => Promise<void> }, incidents?: import('./incident-register.mjs').IncidentRegister | null, now?: () => Date, store?: { load(): unknown, save(entries: CapabilityGrant[]): void } | null, grantWitness?: Map<string, { granted: object, revoked: object | null }> | null, runTxn?: ((intent: string, fn: () => unknown) => Promise<unknown>) | null }} [deps]
   */
  constructor({
    catalog,
    log,
    incidents = null,
    now,
    store = null,
    grantWitness = null,
    runTxn = null,
  } = {}) {
    if (!catalog || !log) throw new Error('CAPABILITY_LEDGER_DEPENDENCY_MISSING');
    this.catalog = catalog;
    this.log = log;
    this.incidents = incidents;
    this.now = now ?? (() => new Date());
    /**
     * مسارُ المعاملةِ (`WL-363`): من يملكُ حاجزَ الالتزامِ يُمرِّرُهُ هنا، فتقعُ
     * منحٌ وسحبٌ داخلَ معاملةٍ واحدةٍ معَ ختمِ الشاهدِ في السجلِّ المختومِ — فلا
     * نجاحَ قبلَ دوامِ الحالةِ والشاهدِ معاً. وإن لم يُمَرَّرْ (تركيباتٌ واختباراتٌ)
     * بقيَ المسارُ المتزامنُ كما كانَ.
     * @type {((intent: string, fn: () => unknown) => Promise<unknown>) | null}
     */
    this.runTxn = runTxn;
    /**
     * عقدُ الدوامِ: من يملكُ اللقطةَ يملكُ أينَ تعيشُ، والدفترُ يطلبُ الواجهةَ.
     * @type {{ load(): unknown, save(entries: CapabilityGrant[]): void } | null}
     */
    this.store = store;
    /**
     * شاهدُ الحقيقةِ المختومُ للمنحِ (`WL-361`): إن مُرِّرَ فالاسترجاعُ لا يَقبَلُ
     * منحاً لا يُطابِقُهُ. خريطةٌ من مُعرّفِ المنحةِ إلى الحدثِ المختومِ الذي
     * أَشهَدَ بمنحِها (وسحبِها إن وُجدَ) — بُنيتَ من السجلِّ المختومِ قبلَ البناءِ
     * بـ`grantsFromSealedLog`، لا من اللقطةِ الملفّيةِ.
     * @type {Map<string, { granted: object, revoked: object | null }> | null}
     */
    this.grantWitness = grantWitness;
    /** @type {Map<string, CapabilityGrant>} */
    this.grants = new Map();
    /**
     * منحٌ أُنشئت في الذاكرة ولم يُختَم شاهدُها بعدُ (`WL-361`): لا تدخلُ اللقطةَ الملفّيةَ
     * قبلَ ختمِ شاهدِها — فالملفُّ **دائماً** مجموعةٌ جزئيّةٌ ممّا يشهدُ به السجلُّ المختومُ، وانقطاعٌ
     * بينَ المنحِ والختمِ يُضيّقُ (تضيعُ المنحةُ) ولا يُنتجُ ملفّاً بمنحٍ بلا دليل.
     * @type {Set<string>}
     */
    this.pendingGrantIds = new Set();
    /** @type {Array<() => void>} عملياتُ حفظٍ مُعلَّقةٌ تُصرَّفُ تباعاً وتُعادُ عندَ الفشلِ. */
    this.pendingPersists = [];
    /** @type {unknown} */
    this.persistError = null;
    /** اختبارٌ فقط: تعليقُ الحفظِ صامتاً. */
    this.persistSuspended = false;
    if (this.store !== null) {
      this.#restoreFromStore();
    }
  }

  /**
   * استرجاعُ المنحِ من المخزنِ عندَ البناءِ. اللقطةُ **مُتحقَّقٌ منها** لا
   * مُصدَّقٌ عليها: كلُّ مُدخلٍ يُفحصُ حقلاً حقلاً، وكلُّ خللٍ يُرفَعُ بخطأٍ
   * مُسمّى — فمنحٌ مجهولُ الحالةِ لا يُفترَضُ سليماً ولا معدوماً. والملفُّ
   * الغائبُ إقلاعٌ نظيفٌ لا خطأٌ.
   * @returns {void}
   */
  #restoreFromStore() {
    const store = this.store;
    if (store === null) return;
    /** @type {unknown} */
    let snapshot;
    try {
      snapshot = store.load();
    } catch (error) {
      throw new Error('CAPABILITY_GRANT_STORE_UNREADABLE', { cause: error });
    }
    if (snapshot === null || snapshot === undefined) return;
    if (!Array.isArray(snapshot)) {
      throw new Error('CAPABILITY_GRANT_STORE_INVALID');
    }
    const seen = new Set();
    for (const entry of snapshot) {
      const grant = this.#validatedGrant(entry);
      let restored = grant;
      // **لا منحَ بلا شاهدٍ مختومٍ.** فحصُ الحقولِ يثبتُ البنيةَ لا الأصالةَ: ملفٌّ سليمُ البنيةِ بيدِ
      // صاحبِ القرصِ قد يحملُ منحاً لم يُصدرْها مانحٌ حقيقيٌّ، و`grantedBy`/`grantorRole` داخلَه ادّعاءٌ.
      // الشاهدُ المختومُ هو من يُثبتُ؛ واللقطةُ المُعدَّلةُ يدويّاً تُرفَضُ لا تُقبَلُ صامتةً.
      if (this.grantWitness !== null) {
        const witness = this.grantWitness.get(grant.id);
        if (witness === undefined) {
          throw new Error(`CAPABILITY_GRANT_UNWITNESSED: ${grant.id}`);
        }
        const w = /** @type {Record<string, unknown>} */ (witness.granted);
        // والمقابلةُ حقلاً حقلاً: شاهدٌ لا يُطابقُ لا يَشمَلُ المنحةَ. وحقلا `grantedAt`/`grantorRole`
        // مطلوبانِ في الشاهدِ (غيابُهما رفضٌ لا تساهلٌ).
        if (
          w.agentId !== grant.agentId ||
          w.capability !== grant.capability ||
          w.grantedBy !== grant.grantedBy ||
          w.grantorRole !== grant.grantorRole ||
          w.grantedAt !== grant.grantedAt ||
          w.expiresAt !== grant.expiresAt ||
          w.reason !== grant.reason
        ) {
          throw new Error(`CAPABILITY_GRANT_WITNESS_MISMATCH: ${grant.id}`);
        }
        // السحبُ: الاتجاهُ الأضيقُ يفوزُ. سحبٌ شهدَ به السجلُّ المختومُ ولم يبلغِ اللقطةَ (انقطاعٌ بينَ
        // ختمِ السحبِ وحفظِه) يُطبَّقُ من الشاهدِ — فلا تعودُ منحةٌ مسحوبةٌ سارية. وسحبٌ في اللقطةِ بلا
        // شاهدِ سحبٍ (انقطاعٌ قبلَ ختمِهِ) يبقى مسحوباً: السحبُ لا يُوسِّعُ صلاحيةً أبداً.
        // سحبٌ مُزوَّرٌ: الملفُّ يدّعي سحباً والشاهدُ لا يعرفُ سحباً — من حرَّفَ الملفَّ ليُخفيَ
        // سحباً من الشاهدِ يُكشَفُ، ومن حرَّفَهُ ليُدّعيَ سحباً لم يقعْ يُكذَبُ: السحبُ يُقاسُ على
        // الشاهدِ المختومِ لا على قولِ الملفّ.
        if (witness.revoked === null && grant.revokedAt !== null) {
          throw new Error(`CAPABILITY_GRANT_WITNESS_REVOKE_UNPROVEN: ${grant.id}`);
        }
        if (witness.revoked !== null && grant.revokedAt === null) {
          const r = /** @type {Record<string, unknown>} */ (witness.revoked);
          restored = Object.freeze({
            ...grant,
            revokedAt:
              typeof r.revokedAt === 'string' && Number.isFinite(Date.parse(r.revokedAt))
                ? r.revokedAt
                : this.now().toISOString(),
            revokedReason:
              typeof r.reason === 'string' && r.reason.trim() !== ''
                ? r.reason
                : 'revoked (sealed)',
          });
        }
      }
      // **قواعدُ الكتالوجِ تُعادُ عندَ الاسترجاعِ** (`WL-361`): ما يرفضُهُ المسارُ الحيُّ يرفضُهُ الاسترجاعُ —
      // قدرةٌ غيرُ قابلةٍ للمنحِ، أو مانحٌ بدورٍ غيرِ مخوَّلٍ، أو ذاتُ المانحِ والمستفيدِ، أو مدّةٌ
      // فوقَ السقفِ أو غيرُ موجبةٍ، وإلا صارتِ اللقطةُ طريقاً حولَ قواعدِ المنحِ. وتأتي **بعدَ** فحصِ
      // الشاهدِ: منحٌ بلا شاهدٍ تُرفَضُ بلا كشفِ قواعدِ الكتالوجِ، ومنحٌ شُهِدَ لها تُقاسُ عليها.
      this.#assertCatalogRules(grant);
      if (seen.has(grant.id)) throw new Error('CAPABILITY_GRANT_STORE_INVALID');
      seen.add(grant.id);
      this.grants.set(grant.id, restored);
    }
  }

  /**
   * قواعدُ الكتالوجِ على منحةٍ مُسترجَعةٍ — المسارُ الحيُّ نفسُهُ (`WL-361`): ما يرفضُهُ الإنشاءُ
   * يرفضُهُ الاسترجاعُ، وإلا صارتِ اللقطةُ الملفّيةُ طريقاً حولَ قواعدِ المنحِ: قدرةٌ غيرُ قابلةٍ، أو
   * مانحٌ بدورٍ غيرِ مخوَّلٍ، أو منحٌ للذاتِ، أو مدّةٌ فوقَ سقفِ البياناتِ أو غيرِ موجبةٍ.
   * @param {CapabilityGrant} grant
   * @returns {void}
   */
  #assertCatalogRules(grant) {
    const definition = this.catalog.grantable.get(grant.capability);
    if (definition === undefined) {
      throw new Error(`CAPABILITY_NOT_GRANTABLE: ${grant.id}`);
    }
    if (grant.grantedBy === grant.agentId) {
      throw new Error(`CAPABILITY_SELF_GRANT_FORBIDDEN: ${grant.id}`);
    }
    if (!definition.grantorRoles.has(grant.grantorRole)) {
      throw new Error(`CAPABILITY_GRANTOR_NOT_AUTHORIZED: ${grant.id}`);
    }
    const ttlSeconds = (Date.parse(grant.expiresAt) - Date.parse(grant.grantedAt)) / 1000;
    if (!Number.isInteger(ttlSeconds) || ttlSeconds <= 0) {
      throw new Error(`CAPABILITY_GRANT_TTL_INVALID: ${grant.id}`);
    }
    if (ttlSeconds > definition.maxDurationSeconds) {
      throw new Error(`CAPABILITY_GRANT_TTL_ABOVE_MAX: ${grant.id}`);
    }
  }

  /**
   * **الشاهدُ المختومُ أوّلاً ثمّ الملفُّ** (`WL-361`، تتمّةُ «المنح»): ترتيبُ العمليةِ. المنحُ الحيُّ
   * يُسجِّلُ قيدَهُ في السجلِّ المختومِ **قبلَ** أن يدخلَ اللقطةَ الملفّيةَ، والسحبُ كذلكَ — فالشاهدُ هو
   * الحقيقةُ والملفُّ ذاكرةُ الوصولِ، وانقطاعٌ بينَ الخطوتَينِ يُضيّقُ لا يُوسّعُ.
   * @param {() => void} persist
   * @returns {void}
   */
  /**
   * صرفُ سلسلةِ الإلحاقاتِ المختومةِ داخلَ المعاملةِ قبلَ نهايةِ جسمِها.
   * @returns {Promise<void>}
   */
  async #drainLogAppends() {
    const log =
      /** @type {{ append: (type: string, actor: string, payload: object) => unknown, flush?: () => Promise<void> }} */ (
        this.log
      );
    if (typeof log.flush !== 'function') return;
    await log.flush();
  }

  /**
   * @param {() => void} persist
   */
  #persistAfterWitness(persist) {
    // كلُّ عمليةٍ تُصرِّفُ اللقطةَ من الحالةِ الراهنةِ، فإعادةُ صرفِها بعدَ فشلٍ سابقٍ بلا ضررٍ
    // (idempotent): آخرُ لقطةٍ تكسبُ. والفشلُ لا يُبتلَعُ: يُحفَظُ ويُرفعُ عندَ `persist()`، وعمليةٌ
    // جديدةٌ تُعادُ أيضاً — فالذاكرةُ لا تتقدّمُ على القرصِ إلا بنجاحِ الحفظِ الأخيرِ.
    this.pendingPersists.push(persist);
    if (this.persistError !== null) throw this.persistError;
  }

  /**
   * ينتظرُ حتى تُكتَبَ آخرُ عمليةِ منحٍ/سحبٍ إلى الملفّ. للتركيبِ الإنتاجيِّ الذي يُغلقُ بنظامٍ
   * وباختباراتِ الاستمراريّةِ. يرفعُ أوّلَ فشلٍ حفظٍ ويُخليهُ — فالرفضُ صوتٌ لا سُمٌّ، وإعادةُ
   * المحاولةِ على مخزنٍ سليمٍ تنجحُ.
   * @returns {Promise<void>}
   */
  async persist() {
    // يَصرِفُ كلَّ عملياتِ الحفظِ المعلَّقةِ (وإعادةَ صرفِ ما فشلَ سابقاً)، ويرفعُ أوّلَ فشلٍ
    // ويُخلّيهِ — فالرفضُ صوتٌ لا سُمٌّ، وإعادةُ المحاولةِ على مخزنٍ سليمٍ تنجحُ.
    while (this.pendingPersists.length > 0) {
      const persist = this.pendingPersists.shift();
      if (persist === undefined || this.persistSuspended === true) continue;
      try {
        persist();
      } catch (error) {
        // الفاشلُ يُعادُ إلى مقدّمةِ الطابورِ: عملياتٌ أخرى قد تصرّفُ بعدهُ فتكتبُ الحالةَ كلَّها.
        this.pendingPersists.unshift(persist);
        const e =
          this.persistError ?? new Error('CAPABILITY_GRANT_STORE_WRITE_FAILED', { cause: error });
        this.persistError = null;
        throw e;
      }
    }
    if (this.persistError !== null) {
      const error = this.persistError;
      this.persistError = null;
      throw error;
    }
  }

  /**
   * يمنحُ منحاً **داخلَ معاملةِ حاجزِ الالتزامِ** (`WL-363`): ختمُ الشاهدِ في السجلِّ
   * المختومِ وحفظُ اللقطةِ الملفّيةِ وهضمُ الحالةِ وترقيةُ البيانِ — كتلةٌ واحدةٌ
   * تُنفَّذُ أو تُسترجَعُ كلُّها. لا نجاحَ قبلَ دوامِ الحالةِ والشاهدِ معاً، فالانقطاعُ
   * بينَ الخطواتِ يُسترجَعُ ولا يُنتِجُ نصفَ حالةٍ. وبلا `runTxn` يَسقُطُ إلى المسارِ
   * المتزامنِ نفسِهِ (تركيباتٌ واختباراتٌ).
   * @param {Parameters<CapabilityGrantLedger['grant']>[0]} spec
   * @returns {Promise<CapabilityGrant>}
   */
  async grantAsync(spec) {
    if (this.runTxn === null) return this.grant(spec);
    const runTxn = this.runTxn;
    return /** @type {Promise<CapabilityGrant>} */ (
      runTxn('grants.grant', async () => {
        const granted = this.#grant(spec);
        // ختمُ الشاهدِ داخلَ المعاملةِ نفسِها (`WL-363`): لا تنتهي `S3` قبلَ أن يُختَمَ
        // قيدُ المنحِ في السجلِّ — فالكتلةُ واحدةٌ: شاهدٌ ولقطةٌ وهضمٌ وبيانٌ أو لا شيء.
        await this.#drainLogAppends();
        // وحفظُ اللقطةِ الملفّيةِ داخلَ المعاملةِ أيضاً: الكتابةُ للحاجزِ (`beforeDurableWrite`)
        // فتُدرِجُ التراجعَ وتُحدِّثُ الهضمَ معَ ختمِ الشاهدِ.
        await this.persist();
        return granted;
      })
    );
  }

  /**
   * يسحبُ منحاً **داخلَ معاملةِ حاجزِ الالتزامِ** (`WL-363`): ختمُ شاهدِ السحبِ وحفظُ
   * اللقطةِ وهضمُ الحالةِ وترقيةُ البيانِ — كتلةٌ واحدةٌ. والانقطاعُ يُسترجَعُ ولا
   * يُبعِثُ منحاً سارياً بعدَ سحبٍ مُشهَدٍ لهُ.
   * @param {string} id
   * @param {string} reason
   * @returns {Promise<CapabilityGrant>}
   */
  async revokeAsync(id, reason) {
    if (this.runTxn === null) return this.revoke(id, reason);
    const runTxn = this.runTxn;
    return /** @type {Promise<CapabilityGrant>} */ (
      runTxn('grants.revoke', async () => {
        const revoked = this.#revoke(id, reason);
        // ختمُ شاهدِ السحبِ داخلَ المعاملةِ نفسِها (`WL-363`) — الكتلةُ الواحدةُ.
        await this.#drainLogAppends();
        // وحفظُ اللقطةِ داخلَ المعاملةِ أيضاً — الكتابةُ للحاجزِ.
        await this.persist();
        return revoked;
      })
    );
  }

  /**
   * تعليقُ الحفظِ أثناءَ الاختبارِ — لا يُستعملُ في الإنتاجِ: يُغلقُ عملُ الحفظِ صامتاً.
   * @returns {void}
   */
  suspendPersistForTest() {
    this.persistSuspended = true;
  }

  /**
   * استئنافُ الحفظِ بعدَ الاختبارِ.
   * @returns {void}
   */
  resumePersist() {
    this.persistSuspended = false;
  }

  /**
   * فحصُ مُدخلٍ مُسترجَعٍ حقلاً حقلاً. النصوصُ غيرُ الفارغةِ، والتواريخُ
   * مقروءةٌ، والسحبُ متّسقٌ (ختمٌ معَ سببٍ أو لا شيءَ معَ لا شيءَ). والمُدخلُ
   * السليمُ يُجمَّدُ كما تُجمَّدُ المنحُ المُنشأةُ في المسارِ الحيّ.
   * @param {unknown} entry
   * @returns {CapabilityGrant}
   */
  #validatedGrant(entry) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      throw new Error('CAPABILITY_GRANT_STORE_INVALID');
    }
    const record = /** @type {Record<string, unknown>} */ (entry);
    for (const field of ['id', 'agentId', 'capability', 'reason', 'grantedBy', 'grantorRole']) {
      const value = record[field];
      if (typeof value !== 'string' || value.trim() === '') {
        throw new Error('CAPABILITY_GRANT_STORE_INVALID');
      }
    }
    for (const field of ['grantedAt', 'expiresAt']) {
      const value = record[field];
      if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) {
        throw new Error('CAPABILITY_GRANT_STORE_INVALID');
      }
    }
    // حذفُ حقلي السحبِ من لقطةٍ لا يجعلُ المسحوبَ سارياً: الغيابُ رفضٌ لا صفرٌ
    // — فالحقلانِ مطلوبانِ حاضرينِ (قيمةً أو `null`).
    if (!('revokedAt' in record) || !('revokedReason' in record)) {
      throw new Error('CAPABILITY_GRANT_STORE_INVALID');
    }
    // والقدرةُ المحرَّمةُ لا يُبعثُها مخزنٌ: ما يرفضُه المسارُ الحيُّ يرفضُه
    // الاسترجاعُ، وإلا صارتِ اللقطةُ طريقاً حولَ المحرَّمِ.
    if (this.catalog.forbidden.has(String(record.capability))) {
      throw new Error('CAPABILITY_GRANT_STORE_INVALID');
    }
    const revokedAt = record.revokedAt;
    const revokedReason = record.revokedReason;
    if (revokedAt === null) {
      if (revokedReason !== null && revokedReason !== undefined) {
        throw new Error('CAPABILITY_GRANT_STORE_INVALID');
      }
    } else {
      if (typeof revokedAt !== 'string' || !Number.isFinite(Date.parse(revokedAt))) {
        throw new Error('CAPABILITY_GRANT_STORE_INVALID');
      }
      if (typeof revokedReason !== 'string' || revokedReason.trim() === '') {
        throw new Error('CAPABILITY_GRANT_STORE_INVALID');
      }
    }
    return Object.freeze({
      id: String(record.id),
      agentId: String(record.agentId),
      capability: String(record.capability),
      reason: String(record.reason),
      grantedBy: String(record.grantedBy),
      grantorRole: String(record.grantorRole),
      grantedAt: String(record.grantedAt),
      expiresAt: String(record.expiresAt),
      revokedAt: revokedAt === null || revokedAt === undefined ? null : String(revokedAt),
      revokedReason:
        revokedReason === null || revokedReason === undefined ? null : String(revokedReason),
    });
  }

  /**
   * الالتزامُ **قبلَ الأثرِ**: اللقطةُ الجديدةُ تُكتبُ إلى المخزنِ أوّلاً، فإذا
   * نجحتْ حلّتْ محلَّ الخريطةِ، وإذا فشلتْ رُفعَ الخطأُ **والخريطةُ كما كانت** —
   * فلا منحةً في الذاكرةِ بلا أثرٍ على القرصِ، ولا سحباً في الذاكرةِ يعودُ
   * سارياً بإعادةِ التشغيلِ. بهذا لا يقعَ بعدَ فشلِ كتابةٍ إلا حالٌ متّسقٌ:
   * ما لم يُلتزمْ لم يقعْ، والمُنفِّذُ يُخبَرُ بصوتٍ فيُعيدُ المحاولةَ.
   *
   * **لماذا الالتزامُ قبلَ الأثرِ لا بعده:** فاقدُ السحبِ يُوسّعُ الصلاحيةَ لا
   * يُضيّقُها (سحبٌ رُفعَ من القرصِ يعودُ بثقلِه)، وفاقدُ المنحِ يُضيّقُها —
   * فالخريطةُ تابعةٌ للقرصِ لا العكسُ، والذاكرةُ لا تسبقُ الالتزامَ أبداً.
   * @param {Map<string, CapabilityGrant>} next
   * @returns {void}
   */
  #commit(next) {
    if (this.store === null) return;
    try {
      this.store.save([...next.values()]);
    } catch (error) {
      throw new Error('CAPABILITY_GRANT_STORE_WRITE_FAILED', { cause: error });
    }
    this.grants = next;
  }

  /**
   * يمنح قدرةً مؤقّتة. المانحُ **موثَّقٌ** لا ادّعاءٌ: لا يُقبلُ منحٌ بلا
   * `principal` تحقّقَ منه بوابةُ الهويّة، ودورُه حقيقيٌّ لا قابلٌ للتزوير. ومحاولةُ
   * تمريرِ `grantedBy`/`grantorRole` مخالفةٍ لِما ثبتَ في المانح تُرفضُ صراحةً
   * (`CAPABILITY_GRANTOR_MISMATCH`) — فلا ينتحلُ مشغّلٌ دورَ وزير. الترتيب مقصود:
   * **المحرَّم يُفحص أولاً** فلا يُقيَّم مانحٌ ولا مدة لطلبٍ لا يجوز أصلاً، ولا
   * تُفتح حادثةٌ مرتين على نفس الطلب.
   * @param {{ agentId: string, capability: string, reason: string, principal?: VerifiedPrincipal, ttlSeconds: number, grantedBy?: string, grantorRole?: string }} spec
   * @returns {CapabilityGrant}
   */
  grant(spec) {
    // **WL-363:** تحتَ حاجزِ التزامٍ مُنشَّطٍ لا مسارَ متزامناً — الكتابةُ للجذرِ
    // معاملةٌ (`grantAsync`) أو لا شيء: لا نجاحَ قبلَ دوامِ الحالةِ والشاهدِ معاً.
    if (this.runTxn !== null) {
      throw new Error('CAPABILITY_GRANT_TXN_REQUIRED');
    }
    return this.#grant(spec);
  }

  /**
   * جسمُ المنحِ المشتركُ بينَ المسارَينِ (`grant` المتزامنِ و`grantAsync` المعامَليِّ).
   * @param {Parameters<CapabilityGrantLedger['grant']>[0]} spec
   * @returns {CapabilityGrant}
   */
  #grant({ agentId, capability, reason, principal, ttlSeconds, grantedBy, grantorRole }) {
    for (const [field, value] of Object.entries({
      agentId,
      capability,
      reason,
    })) {
      if (typeof value !== 'string' || value.trim() === '') {
        throw new Error(`CAPABILITY_GRANT_FIELD_MISSING: ${field}`);
      }
    }

    // الفشلُ مغلقٌ بلا مانحٍ موثَّق: لا ثقةَ بادّعاءِ المانح من الطالب.
    if (
      principal === undefined ||
      principal === null ||
      typeof principal !== 'object' ||
      typeof principal.id !== 'string' ||
      typeof principal.role !== 'string' ||
      typeof principal.state !== 'string' ||
      principal.id.trim() === '' ||
      principal.role.trim() === '' ||
      principal.state.trim() === ''
    ) {
      throw new Error('CAPABILITY_GRANTOR_UNVERIFIED');
    }
    if (principal.state !== 'active') {
      throw new Error('CAPABILITY_GRANTOR_NOT_ACTIVE');
    }
    // إن أُمرِرَ ادّعاءُ مانحٍ/دورٍ مختلفٌ عمّا ثبتَ في المانح، يُرفضُ صراحةً —
    // فمحاولةُ انتحالِ دورٍ أرفعَ تُكشفُ ولا تُقبل.
    if (grantedBy !== undefined && grantedBy.trim() !== '' && grantedBy !== principal.id) {
      throw new Error('CAPABILITY_GRANTOR_MISMATCH');
    }
    if (grantorRole !== undefined && grantorRole.trim() !== '' && grantorRole !== principal.role) {
      throw new Error('CAPABILITY_GRANTOR_MISMATCH');
    }
    const verifiedGrantedBy = principal.id;
    const verifiedGrantorRole = principal.role;

    if (this.catalog.forbidden.has(capability)) {
      const entry = this.catalog.forbidden.get(capability);
      if (this.incidents !== null) {
        this.incidents.open({
          type: 'forbidden-capability',
          subject: verifiedGrantedBy,
          severity: IncidentSeverity.CRITICAL,
          detail: {
            capability,
            beneficiary: agentId,
            grantorRole: verifiedGrantorRole,
            lawRef: entry?.lawRef ?? null,
            attemptedReason: reason,
          },
        });
      }
      this.log.append('capability.grant.forbidden', verifiedGrantedBy, {
        capability,
        beneficiary: agentId,
        reason: entry?.reason ?? 'قدرة محرَّمة',
      });
      throw new Error('FORBIDDEN_CAPABILITY');
    }

    const definition = this.catalog.grantable.get(capability);
    if (definition === undefined) throw new Error('CAPABILITY_NOT_GRANTABLE');

    if (verifiedGrantedBy === agentId) throw new Error('CAPABILITY_SELF_GRANT_FORBIDDEN');
    if (!definition.grantorRoles.has(verifiedGrantorRole)) {
      throw new Error('CAPABILITY_GRANTOR_NOT_AUTHORIZED');
    }
    if (!Number.isInteger(ttlSeconds) || ttlSeconds <= 0) {
      throw new Error('CAPABILITY_GRANT_TTL_INVALID');
    }
    if (ttlSeconds > definition.maxDurationSeconds) {
      throw new Error('CAPABILITY_GRANT_TTL_ABOVE_MAX');
    }

    const grantedAt = this.now();
    /** @type {CapabilityGrant} */
    const record = Object.freeze({
      id: 'grant:' + randomUUID(),
      agentId,
      capability,
      reason,
      grantedBy: verifiedGrantedBy,
      grantorRole: verifiedGrantorRole,
      grantedAt: grantedAt.toISOString(),
      expiresAt: new Date(grantedAt.getTime() + ttlSeconds * 1000).toISOString(),
      revokedAt: null,
      revokedReason: null,
    });
    // **الشاهدُ أوّلاً** (`WL-361`): المنحُ يُقيَّدُ في السجلِّ المختومِ قبلَ أن يدخلَ اللقطةَ الملفّيةَ —
    // فالشاهدُ المختومُ هو الحقيقةُ، والملفُّ ذاكرةُ الوصولِ. من انقطعَ قبلَ ختمِ الشاهدِ فمنحُهُ لم يقعْ
    // (لا منحَ في الملفِّ بلا شاهدٍ يَشمَلُهُ)؛ ومن انقطعَ بعدَ الشاهدِ فمنحُهُ باقٍ (لا حاجةَ لإعادةِ
    // نداءٍ): الاسترجاعُ يُصدِّقُهُ من الشاهدِ وإن فاتَ حفظُ الملفّ. ولا يُدخلُ الملفُّ منحاً بلا شاهدٍ
    // مختومٍ أبداً.
    this.log.append('capability.granted', verifiedGrantedBy, {
      id: record.id,
      agentId,
      capability,
      ttlSeconds,
      // الحقولُ الكاملةُ في الشاهدِ (`WL-361`): المقابلةُ عندَ الاسترجاعِ حقلاً حقلاً تطلبُ المُنشئَ
      // نفسَهُ الذي جازَ الإنشاءَ — فالمانحُ والدورُ والزمنُ في القيدِ المختومِ لا في الملفِّ وحدَهُ.
      grantedBy: verifiedGrantedBy,
      grantorRole: verifiedGrantorRole,
      grantedAt: record.grantedAt,
      expiresAt: record.expiresAt,
      reason,
    });
    if (this.store !== null) {
      this.grants.set(record.id, record);
      this.pendingGrantIds.add(record.id);
      const persist = () => {
        if (this.persistSuspended === true) return;
        const next = new Map(this.grants);
        next.set(record.id, record);
        this.#commit(next);
        this.pendingGrantIds.delete(record.id);
      };
      this.#persistAfterWitness(persist);
    } else {
      this.grants.set(record.id, record);
    }
    return record;
  }

  /**
   * هل المنحة سارية في هذه اللحظة؟ الانتهاء يُحسب بالمقارنة لا بالحذف.
   * @param {CapabilityGrant} grant
   * @param {number} atMs
   * @returns {boolean}
   */
  static isActive(grant, atMs) {
    if (grant.revokedAt !== null) return false;
    return Date.parse(grant.expiresAt) > atMs;
  }

  /**
   * المنح السارية لوكيل.
   * @param {string} agentId
   * @returns {CapabilityGrant[]}
   */
  activeGrants(agentId) {
    const atMs = this.now().getTime();
    return [...this.grants.values()].filter(
      (grant) => grant.agentId === agentId && CapabilityGrantLedger.isActive(grant, atMs),
    );
  }

  /**
   * القدرات الممنوحة السارية لوكيل — وهي التي تُضاف إلى قدرات دوره.
   * @param {string} agentId
   * @returns {Set<string>}
   */
  capabilitiesOf(agentId) {
    return new Set(this.activeGrants(agentId).map((grant) => grant.capability));
  }

  /**
   * يسحب منحةً قبل انتهاء مدتها. السبب إلزامي.
   * @param {string} id
   * @param {string} reason
   * @returns {CapabilityGrant}
   */
  revoke(id, reason) {
    // **WL-363:** مثلُ المنحِ — لا سحبَ متزامناً تحتَ حاجزٍ مُنشَّطٍ (`revokeAsync`).
    if (this.runTxn !== null) {
      throw new Error('CAPABILITY_GRANT_TXN_REQUIRED');
    }
    return this.#revoke(id, reason);
  }

  /**
   * جسمُ السحبِ المشتركُ بينَ المسارَينِ (`revoke` المتزامنِ و`revokeAsync` المعامَليِّ).
   * @param {string} id
   * @param {string} reason
   * @returns {CapabilityGrant}
   */
  #revoke(id, reason) {
    const current = this.grants.get(id);
    if (current === undefined) throw new Error('CAPABILITY_GRANT_NOT_FOUND');
    if (typeof reason !== 'string' || reason.trim() === '') {
      throw new Error('CAPABILITY_REVOKE_REASON_REQUIRED');
    }
    if (current.revokedAt !== null) return current;
    /** @type {CapabilityGrant} */
    const revoked = Object.freeze({
      ...current,
      revokedAt: this.now().toISOString(),
      revokedReason: reason,
    });
    // **الشاهدُ أوّلاً** (`WL-361`): السحبُ يُقيَّدُ في السجلِّ المختومِ قبلَ أن يدخلَ اللقطةَ الملفّيةَ.
    // انقطاعٌ بينَ ختمِ السحبِ وحفظِهِ يُضيّقُ: الاسترجاعُ يعرفُ من الشاهدِ أنّ المنحةَ مسحوبةٌ فيرفضُ
    // إعادتَها ساريةً. ولا يُوسّعُ السحبُ صلاحيةً أبداً.
    this.log.append('capability.revoked', current.grantedBy, {
      id,
      agentId: current.agentId,
      capability: current.capability,
      // الشاهدُ الكاملُ للسحبِ (`WL-361`): عندَ المقابلةِ بعدَ الإقلاعِ يُطبَّقُ من الشاهدِ لا من الملفّ.
      revokedAt: revoked.revokedAt,
      reason,
    });
    if (this.store !== null) {
      this.grants.set(id, revoked);
      const persist = () => {
        if (this.persistSuspended === true) return;
        const next = new Map(this.grants);
        next.set(id, revoked);
        this.#commit(next);
      };
      this.#persistAfterWitness(persist);
    } else {
      this.grants.set(id, revoked);
    }
    return revoked;
  }

  /**
   * يسحب كل منح وكيل في عملية واحدة — يستدعيه إلغاء الوكيل وحجْره، فلا تبقى
   * قدرةٌ ممنوحة لهويةٍ أُبطلت.
   * @param {string} agentId
   * @param {string} reason
   * @returns {number} عدد المنح المسحوبة
   */
  revokeAllFor(agentId, reason) {
    let count = 0;
    for (const grant of this.activeGrants(agentId)) {
      this.revoke(grant.id, reason);
      count += 1;
    }
    return count;
  }

  /**
   * يحذف المنح المنتهية من المخزن. **لا يغيّر القدرات الفعّالة**: هو تفريغ ذاكرة
   * لا إنفاذ سياسة، وذلك عين المقصود — إنفاذُ الانتهاء واقعٌ قبل هذا النداء.
   * @returns {number} عدد ما حُذف
   */
  prune() {
    const atMs = this.now().getTime();
    let count = 0;
    /** @type {Set<string>} */
    const expired = new Set();
    for (const [id, grant] of this.grants) {
      if (grant.revokedAt === null && Date.parse(grant.expiresAt) > atMs) continue;
      expired.add(id);
      count += 1;
    }
    if (count > 0) {
      if (this.store !== null) {
        const next = new Map(this.grants);
        for (const id of expired) {
          // **المنحُ الراعي** (`pendingGrantIds`) لا يُفرَّغُ قبلَ ختمِ شاهدِها (`WL-361`): من لم
          // يُشهدْ لهُ بعدُ لا يُحذفُ من اللقطةِ — فالحذفُ هنا تخطٍّ لعمليةٍ لم تكتملْ لا تنظيفٌ.
          if (this.pendingGrantIds.has(id)) continue;
          next.delete(id);
        }
        this.#commit(next);
      } else {
        for (const id of expired) this.grants.delete(id);
      }
      this.log.append('capability.grants.pruned', 'crown', { count });
    }
    return count;
  }
}

/**
 * @param {ConstructorParameters<typeof CapabilityGrantLedger>[0]} deps
 * @returns {CapabilityGrantLedger}
 */
export function createCapabilityGrantLedger(deps) {
  return new CapabilityGrantLedger(deps);
}
