/**
 * سجلُّ التفويضاتِ النافذة — الخطوة `M8.08`.
 *
 * **العيبُ الذي تعالجه هذه الوحدة:** في `M8.07` صار للتفويضِ صفٌّ في
 * `state.federation_delegations` يُقرأ منه حالُ الترابِ الآن. لكنّ ذلك الصفَّ
 * **لا يقول بأيِّ أمرٍ فُوِّض ولا بأيِّ أمرٍ سُحب**: يُحدَّث في موضعه فيمحو ما قبله،
 * ولا يحمل معرّفَ أمرٍ ملكيٍّ ولا وقتَ إصدارِه ولا زمنَ نفاذِ السحبِ مقيساً. فكانت
 * السيادةُ **حالةً حاضرةً** لا سلسلةَ أوامرَ تُراجَع، ولا مهلةَ نفاذٍ تُقاس.
 *
 * وهذه الوحدةُ تُنفِذ ما يُعلنه قسمُ `sovereignty` في
 * `config/federation-delegation.yaml`:
 *
 *   1. **صفٌّ لكلِّ أمرٍ ملكيٍّ نفذ** (منحاً أو سحباً) بمعرّفِ أمره **الذي لا
 *      يتكرّر**، ووقتِ إصداره ووقتِ قبوله في بوابة التاجِ ووقتِ نفاذِ أثره.
 *   2. **الزمنُ مقيسٌ لا موصوف**: `latencyMs` فارقُ الإصدارِ والنفاذ، ويقابله في
 *      السحبِ `deadlineMs` المُعلَنُ و`withinDeadline` **محسوباً منه** لا مكتوباً
 *      استقلالاً — وثابتُ المواصفةِ يرفض صفّاً يقول غيرَ ما يقيسه وقتاه.
 *   3. **تجاوزُ المهلةِ يُنشر حادثةً** (`federation.revocation.overdue`) ولا
 *      يُحذف قياسُه: مهلةٌ تُخضَّر بحذفِ قياسها ليست مهلة.
 *   4. **النافذُ الآن يُقرأ من السجل** لا من الوثيقةِ ولا من الصفِّ وحدَه:
 *      `effective()` تُعيد ما مُنح ولم يُسحب بعده.
 *   5. **التباعدُ يُكشف**: `assertConsistent` تقابل صفوفَ التفويضِ بالسجلِّ في
 *      الاتجاهين، فصفٌّ نافذٌ بلا أمرٍ أو أمرٌ بلا صفٍّ يُردّ بـ
 *      `FEDERATION_REGISTER_DIVERGED`.
 *
 * **حدٌّ معلَن:** الصفُّ **لا يُوقَّع ولا يُسلسَل بالتلبيد**. سلسلةُ الوقائعِ
 * الموقَّعةُ هي `src/root-of-trust/persistent-log.mjs`، وهذا سجلٌّ جدوليٌّ يُقرأ
 * بالاستعلامِ لا سلسلةٌ تُبرهن على نفسها؛ ومن حرّر القاعدةَ مباشرةً يُكشف بالتباعدِ
 * لا بالتوقيع.
 */

import { FEDERATION_ERRORS, FederationError } from './delegation.mjs';

/** أثرُ الأمرِ الملكيِّ في السجل: منحُ تفويضٍ أو سحبُه. */
export const REGISTER_EFFECTS = Object.freeze({
  GRANT: 'GRANT',
  REVOKE: 'REVOKE',
});

/**
 * @typedef {Readonly<{
 *   commandId: string,
 *   action: string,
 *   effect: 'GRANT' | 'REVOKE',
 *   territoryKey: string,
 *   level: string,
 *   actorRole: string,
 *   issuedAt: Date,
 *   acceptedAt: Date,
 *   effectiveAt: Date,
 *   deadlineMs: number | null,
 *   reason: string | null,
 * }>} RegisterInput
 */

/**
 * @param {import('../persistence/entities.mjs').EntityRecord} record
 * @param {string} key
 * @returns {string}
 */
function text(record, key) {
  const value = record[key];
  return typeof value === 'string' ? value : '';
}

/**
 * @param {import('../persistence/entities.mjs').EntityRecord} record
 * @param {string} key
 * @returns {number}
 */
function time(record, key) {
  const value = record[key];
  return value instanceof Date ? value.getTime() : 0;
}

/** سجلُّ التفويضاتِ النافذةِ: صفٌّ لكلِّ أمرٍ ملكيٍّ نفذ، ومنه يُقرأ النافذُ الآن. */
export class DelegationRegister {
  /**
   * @param {object} deps
   * @param {import('../persistence/repository-memory.mjs').Repository} deps.repository
   * @param {import('../root-of-trust/event-log.mjs').EventLog} deps.log
   */
  constructor({ repository, log }) {
    if (!repository) throw new Error('FEDERATION_REGISTER_REPOSITORY_REQUIRED');
    if (!log) throw new Error('FEDERATION_EVENT_LOG_REQUIRED');
    this.repository = repository;
    this.log = log;
  }

  /**
   * يكتب أثرَ أمرٍ ملكيٍّ في السجل، ويقيس زمنَ نفاذه، ويحكم على مهلته إن كان سحباً.
   *
   * والحكمُ **محسوبٌ هنا** من الوقتين لا مُمرَّرٌ من المستدعي: قياسٌ يُمرَّر جاهزاً
   * قياسٌ يُكتب باليد. وتجاوزُ المهلةِ يُنشر حادثةً ولا يُحذف من الصف.
   * @param {RegisterInput} input
   * @returns {Promise<import('../persistence/entities.mjs').EntityRecord>}
   */
  async record(input) {
    const latencyMs = input.effectiveAt.getTime() - input.issuedAt.getTime();
    const deadlineMs = input.effect === REGISTER_EFFECTS.REVOKE ? input.deadlineMs : null;
    const withinDeadline = deadlineMs === null ? null : latencyMs <= deadlineMs;
    const row = await this.repository.insert({
      id: `register:${input.commandId}`,
      commandId: input.commandId,
      action: input.action,
      effect: input.effect,
      territoryKey: input.territoryKey,
      level: input.level,
      actorRole: input.actorRole,
      issuedAt: input.issuedAt,
      acceptedAt: input.acceptedAt,
      effectiveAt: input.effectiveAt,
      latencyMs,
      deadlineMs,
      withinDeadline,
      reason: input.effect === REGISTER_EFFECTS.REVOKE ? input.reason : null,
    });
    this.log.append('federation.delegation.registered', 'role:king', {
      commandId: input.commandId,
      territoryKey: input.territoryKey,
      effect: input.effect,
      latencyMs,
      withinDeadline: withinDeadline === null ? 'n/a' : String(withinDeadline),
    });
    if (withinDeadline === false) {
      // التجاوزُ يُنشر ولا يُخفى: سيادةٌ سُحبت متأخِّرةً عن مهلتها المُعلَنةِ خبرٌ
      // سياديٌّ لا تفصيلٌ تشغيلي، وصفُّه يبقى شاهداً على التأخُّر لا على النجاح.
      this.log.append('federation.revocation.overdue', 'role:king', {
        commandId: input.commandId,
        territoryKey: input.territoryKey,
        latencyMs,
        deadlineMs: Number(deadlineMs),
      });
    }
    return row;
  }

  /**
   * صفوفُ السجلِّ مرتَّبةً بزمنِ النفاذ من الأقدمِ إلى الأحدث.
   * @param {Readonly<Record<string, unknown>>} [filter]
   * @returns {Promise<readonly import('../persistence/entities.mjs').EntityRecord[]>}
   */
  async entries(filter = {}) {
    const rows = await this.repository.list({ filter, limit: 10000 });
    return [...rows].sort((left, right) => time(left, 'effectiveAt') - time(right, 'effectiveAt'));
  }

  /**
   * أمرُ السجلِّ الأخيرُ لترابٍ، أو `undefined` إن لم يُصدَر له أمرٌ قطّ.
   * @param {string} territoryKey
   * @returns {Promise<import('../persistence/entities.mjs').EntityRecord | undefined>}
   */
  async last(territoryKey) {
    const rows = await this.entries({ territoryKey });
    return rows.at(-1);
  }

  /**
   * التفويضاتُ **النافذةُ الآن** مقروءةً من السجل: مُنِحت ولم يُسحب بعدها.
   * @returns {Promise<ReadonlyMap<string, import('../persistence/entities.mjs').EntityRecord>>}
   */
  async effective() {
    /** @type {Map<string, import('../persistence/entities.mjs').EntityRecord>} */
    const state = new Map();
    for (const row of await this.entries()) {
      const key = text(row, 'territoryKey');
      if (text(row, 'effect') === REGISTER_EFFECTS.GRANT) state.set(key, row);
      else state.delete(key);
    }
    return state;
  }

  /**
   * يقابل صفوفَ التفويضِ بالسجلِّ **في الاتجاهين** ويرفض التباعد.
   *
   * فصفٌّ نافذٌ في `state.federation_delegations` بلا منحٍ في السجلِّ سلطةٌ نشأت
   * بلا أمرٍ ملكيّ، وأمرُ منحٍ في السجلِّ بلا صفٍّ نافذٍ سيادةٌ في الدفترِ لا أثرَ
   * لها في التشغيل. والاثنان يُكشفان ولا يُقرأ أحدُهما وحدَه.
   * @param {import('../persistence/repository-memory.mjs').Repository} delegations
   * @returns {Promise<ReadonlyMap<string, import('../persistence/entities.mjs').EntityRecord>>}
   */
  async assertConsistent(delegations) {
    const registered = await this.effective();
    const rows = await delegations.list({ limit: 10000 });
    /** @type {Set<string>} */
    const live = new Set();
    for (const row of rows) {
      if (row['revokedAt'] === null) live.add(text(row, 'territoryKey'));
    }
    for (const key of live) {
      if (!registered.has(key)) {
        throw new FederationError(
          FEDERATION_ERRORS.REGISTER_DIVERGED,
          `تفويضُ ${key} نافذٌ في الصفوفِ ولا أمرَ منحٍ له في سجلِّ التفويضاتِ النافذة؛ وسلطةٌ نشأت بلا أمرٍ ملكيٍّ سلطةٌ لا يُعرَف مصدرُها.`,
        );
      }
    }
    for (const key of registered.keys()) {
      if (!live.has(key)) {
        throw new FederationError(
          FEDERATION_ERRORS.REGISTER_DIVERGED,
          `سجلُّ التفويضاتِ يقول إنّ ${key} نافذٌ ولا صفَّ تفويضٍ نافذاً له؛ وسيادةٌ في الدفترِ بلا أثرٍ في التشغيلِ دفترٌ يُقرأ خطأً.`,
        );
      }
    }
    return registered;
  }
}
