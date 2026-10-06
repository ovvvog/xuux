// `WL-348`: الديوانُ الملكيُّ ومصادقةُ الملكِ القويّةُ في التركيبِ الإنتاجيّ.
//
// قبلَ هذه الوحدةِ لم يكن في `createProductionSystem` ديوانٌ أصلاً: النظامُ الإنتاجيُّ يملكُ
// جذرَ الثقةِ والسلسلةَ والتاجَ والنواة، ولا مِقبضَ يُصدِرُ به الملكُ إيقافاً أو استئنافاً أو
// نقضاً بمصادقةٍ قويّة. والديوانُ نفسُه كانَ لا يعملُ على مكوّناتِ الإنتاج: التاجُ يردُّ
// `command` المتزامن (‏`WL-347`)، والدفترُ الموقَّعُ يردُّ `commit` المتزامن، ومفتاحُ الإيقافِ
// يوقِّعُ في التوكنِ وحدَه، والسجلُّ المختومُ يردُّ الإلحاقَ الخام (‏`WL-348`).
//
// وما لا يُخترَعُ هنا ويبقى تبعيّةً مُعلَنة:
//   • **أسرارُ العاملِ الثاني** (‏`factorSecrets`) — لا مصدرَ إنتاجيٌّ لها في المستودع. تُحقَنُ
//     في `options.factorSecrets`، وبغيابِها تُرَدُّ كلُّ مصادقةٍ بـ`AUTHN_SECRET_MISSING` فلا
//     يُنفَّذُ أمرٌ (‏فشلٌ مغلق) — ولا يُستبدَلُ بها سرٌّ ثابتٌ ولا عاملٌ مُعطَّل.
//   • **طبقةُ الواجهةِ** للمشاهد — غيرُ مركَّبةٍ في الإنتاج؛ فالمشاهدُ تُرَدُّ بـ`CONSOLE_GATEWAY_REQUIRED`.
//   • **النقضُ** (‏`crown.veto`) في ذاكرةِ العمليّة — لا يصمدُ لإعادةِ التشغيل؛ والإيقافُ الشاملُ هو
//     الحدُّ الدائم (‏`HaltSwitch`).

import { KingAuthenticator, loadKingAuthPolicy } from '../authn/king-auth.mjs';
import { RoyalConsole, loadConsolePolicy } from '../console/royal-console.mjs';

export const SOVEREIGN_CONSOLE_ERRORS = Object.freeze({
  FACTOR_WITNESS_UNREADABLE: 'PRODUCTION_FACTOR_WITNESS_UNREADABLE',
});

/**
 * @typedef {object} SealedLogReader
 * @property {ReadonlyArray<{ id?: unknown, type?: unknown, data?: unknown }>} events
 * @property {boolean} sealed
 * @property {(event: unknown) => Promise<unknown>} openEvent
 */

/**
 * يقرأُ شهودَ استهلاكِ العاملِ الثاني من السجلِّ المختومِ **عندَ الإقلاع** ويفتحُ أجسامَها.
 *
 * `KingAuthenticator` يستعيدُ ما استُهلِكَ من رموزٍ بقراءةٍ متزامنة (‏`eventsOfTypeSinceStep`)،
 * وأجسامُ السجلِّ الإنتاجيِّ مختومةٌ لا تُقرأُ إلّا بـ`openEvent` غيرِ المتزامن — فقراءتُها الخامُ
 * تُرجِعُ نصّاً مُشفَّراً بلا `device` ولا `step`، فلا يُستعادُ شيءٌ ويعودُ رمزٌ مستهلَكٌ صالحاً بعدَ
 * إعادةِ التشغيل. فتُفتَحُ هنا قبلَ أيِّ طلب، كما تُستعادُ حالةُ الحجرِ (‏`quarantineFromSealedLog`).
 * وجسمٌ لا يُفتَحُ رفضٌ مُسمّى لا تخطٍّ صامت.
 * @param {SealedLogReader} log
 * @param {string} type
 * @returns {Promise<ReadonlyArray<{ type: string, data: { device?: unknown, step?: unknown } }>>}
 */
export async function factorWitnessesFromSealedLog(log, type) {
  /** @type {Array<{ type: string, data: { device?: unknown, step?: unknown } }>} */
  const out = [];
  for (const event of log.events) {
    if (event?.type !== type) continue;
    /** @type {unknown} */
    let body;
    try {
      body = log.sealed ? await log.openEvent(event) : event.data;
    } catch {
      throw new Error(
        `${SOVEREIGN_CONSOLE_ERRORS.FACTOR_WITNESS_UNREADABLE}: ${String(event.id ?? '')}`,
      );
    }
    if (body === null || typeof body !== 'object') {
      throw new Error(
        `${SOVEREIGN_CONSOLE_ERRORS.FACTOR_WITNESS_UNREADABLE}: ${String(event.id ?? '')}`,
      );
    }
    out.push({ type, data: /** @type {{ device?: unknown, step?: unknown }} */ (body) });
  }
  return Object.freeze(out);
}

/**
 * يركّبُ مصادقةَ الملكِ القويّةَ والديوانَ على مكوّناتِ الإنتاجِ نفسِها: السجلُّ المختومُ عبرَ
 * مُحوِّلِه المرتَّب، ودفترُ الأوامرِ الموقَّع، ومفتاحُ الإيقافِ الموقِّعُ في التوكن، وبوابةُ التاج،
 * والساعةُ الموثوقة. ولا شيءَ منها يُبنى هنا من جديد.
 * @param {object} deps
 * @param {{ append: Function, appendSealed: Function, flush: () => Promise<void>, sealed: unknown }} deps.enforcementLog مُحوِّلُ `sealedAudit`
 * @param {SealedLogReader & { eventsOfTypeSinceStep?: unknown }} deps.sealedLog السجلُّ المختومُ الخام
 * @param {import('../console/royal-console.mjs').ConsoleCrownLike} deps.crown
 * @param {import('../console/royal-console.mjs').ConsoleHaltLike} deps.haltSwitch
 * @param {import('../console/royal-console.mjs').ConsoleLedgerLike} deps.commandLedger
 * @param {{ id: string, verify: (payload: object, signature: string) => boolean }} deps.king الهويّةُ الملكيّةُ (‏المفتاحُ العامّ)
 * @param {{ now(): number }} deps.clock
 * @param {import('../authn/king-auth.mjs').FactorSecretsLike | null} [deps.factorSecrets]
 * @returns {Promise<{ kingAuth: KingAuthenticator, royalConsole: RoyalConsole }>}
 */
export async function composeSovereignConsole(deps) {
  const authnPolicy = loadKingAuthPolicy();
  const witnesses = await factorWitnessesFromSealedLog(
    deps.sealedLog,
    authnPolicy.audit.factorConsumedEvent,
  );
  const enforcementLog = deps.enforcementLog;
  // سجلُّ المصادقةِ: الكتابةُ على المُحوِّلِ المرتَّبِ نفسِه (‏ترتيبٌ واحدٌ للقيود)، والاستعادةُ من
  // الشهودِ المفتوحةِ عندَ الإقلاع. وما يُستهلَكُ بعدَ الإقلاعِ يحفظُه المُصادِقُ في ذاكرتِه.
  const authnLog = {
    append: (
      /** @type {string} */ t,
      /** @type {string} */ a,
      /** @type {Record<string, unknown>} */ d,
    ) => enforcementLog.append(t, a, d),
    appendSealed: (
      /** @type {string} */ t,
      /** @type {string} */ a,
      /** @type {Record<string, unknown>} */ d,
    ) => enforcementLog.appendSealed(t, a, d),
    flush: () => enforcementLog.flush(),
    sealed: enforcementLog.sealed,
    /** @param {string} type @param {number} minStep */
    eventsOfTypeSinceStep: (type, minStep) =>
      witnesses.filter(
        (w) => w.type === type && typeof w.data.step === 'number' && w.data.step >= minStep,
      ),
  };
  const nowMs = () => deps.clock.now();
  const kingAuth = new KingAuthenticator({
    policy: authnPolicy,
    king: deps.king,
    log: authnLog,
    factorSecrets: deps.factorSecrets ?? null,
    nowMs,
  });
  const royalConsole = new RoyalConsole({
    policy: loadConsolePolicy(),
    gateway: null,
    crown: deps.crown,
    haltSwitch: deps.haltSwitch,
    king: deps.king,
    kingAuth,
    commandLedger: deps.commandLedger,
    log: /** @type {import('../console/royal-console.mjs').ConsoleLogLike} */ (
      /** @type {unknown} */ (enforcementLog)
    ),
    nowMs,
  });
  return { kingAuth, royalConsole };
}
