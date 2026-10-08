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
//
// `WL-349`: **النقضُ** (‏`crown.veto`) كانَ في ذاكرةِ العمليّةِ وحدَها فيسقطُ بإعادةِ التشغيل. صارَ
// الديوانُ يختمُ حالتَه الجديدةَ (‏`console.veto.state`) قبلَ أن يُغيِّرَها، ويُعيدُها الإقلاعُ هنا من
// آخرِ قيدٍ مختومٍ قبلَ تركيبِ الديوانِ وقبلَ أيِّ أمر (‏`vetoFromSealedLog`).

import { KingAuthenticator, loadKingAuthPolicy } from '../authn/king-auth.mjs';
import { RoyalConsole, loadConsolePolicy } from '../console/royal-console.mjs';

export const SOVEREIGN_CONSOLE_ERRORS = Object.freeze({
  FACTOR_WITNESS_UNREADABLE: 'PRODUCTION_FACTOR_WITNESS_UNREADABLE',
  VETO_RECORD_UNREADABLE: 'PRODUCTION_VETO_RECORD_UNREADABLE',
  VETO_RECORD_UNAUTHORIZED: 'PRODUCTION_VETO_RECORD_UNAUTHORIZED',
});

/**
 * `WL-349`: حالةُ النقضِ من السجلِّ المختومِ عندَ الإقلاع — **آخرُ** قيدِ حالةٍ هو الحاكم
 * (‏السجلُّ مرتَّبٌ بالإلحاق، والقيدُ يُختَمُ قبلَ الأثرِ في الديوان).
 *
 * قيدٌ لا يُفتَحُ، أو جسمٌ بلا `vetoed` منطقيٍّ، أو نقضٌ بلا سببٍ نصّيّ: رفضٌ مُسمّى يمنعُ
 * الإقلاع — لا «لا نقض» صامتاً؛ فقيدٌ تالفٌ قد يكونُ نقضاً قائماً، وفتحُ البوابةِ عليه فشلٌ مفتوح.
 *
 * `WL-352` (‏`R12-ASTRA-01`): القيدُ وحدَه ليس سلطة. ختمُ السجلِّ يُثبِتُ سلامةَ التخزين، لا أنَّ كاتبَ
 * القيدِ يملكُ مفتاحَ الملك؛ وكلُّ مكوِّنٍ يحملُ مُحوِّلَ السجلِّ يستطيعُ إلحاقَ `{ vetoed: false }`.
 * فالحالةُ لا تُقرأُ من حقولِ القيدِ بل من **الأمرِ الملكيِّ الموقَّعِ المحمولِ فيه**: يُتحقَّقُ من توقيعِه
 * بالمفتاحِ العامِّ، ومن أنَّ فعلَه وهدفَه فعلُ النقضِ أو رفعِه المُعلَنُ في `config/royal-console.yaml`،
 * ومن أنَّ معرّفَه مُثبَّتٌ في دفترِ الأوامر (‏قُبِلَ فعلاً)، ومن أنّه لم يَرِد في قيدِ حالةٍ قبلَه (‏فإعادةُ
 * قيدِ رفعٍ صحيحٍ بعدَ نقضٍ أحدثَ لا تُسقِطُه). وأيُّ إخلالٍ رفضٌ مُسمّى يمنعُ الإقلاع — كالقيدِ التالف.
 * @param {SealedLogReader} log
 * @param {string} type
 * @param {VetoAuthority} authority
 * @returns {Promise<{ vetoed: boolean, reason: string | null, commandId: string } | null>} `null` إن لم يُختَم نقضٌ قطّ
 */
export async function vetoFromSealedLog(log, type, authority) {
  if (
    authority === null ||
    typeof authority !== 'object' ||
    typeof authority.king?.verify !== 'function' ||
    typeof authority.ledger?.has !== 'function' ||
    !Array.isArray(authority.commands)
  ) {
    // بلا متحقِّقٍ لا استعادة: استعادةٌ لا تتحقّقُ من السلطةِ هي الثغرةُ نفسُها.
    throw new Error(
      `${SOVEREIGN_CONSOLE_ERRORS.VETO_RECORD_UNAUTHORIZED}: لا مُتحقِّقَ من سلطةِ قيدِ النقض`,
    );
  }
  const vetoSpec = authority.commands.find((c) => c.kind === 'veto');
  const clearSpec = authority.commands.find((c) => c.kind === 'veto-clear');
  /** @type {Set<string>} */
  const seen = new Set();
  /** @type {{ vetoed: boolean, reason: string | null, commandId: string } | null} */
  let last = null;
  for (const event of log.events) {
    if (event?.type !== type) continue;
    const unreadable = () =>
      new Error(`${SOVEREIGN_CONSOLE_ERRORS.VETO_RECORD_UNREADABLE}: ${String(event.id ?? '')}`);
    const unauthorized = (/** @type {string} */ why) =>
      new Error(
        `${SOVEREIGN_CONSOLE_ERRORS.VETO_RECORD_UNAUTHORIZED}: ${String(event.id ?? '')} — ${why}`,
      );
    /** @type {unknown} */
    let body;
    try {
      body = log.sealed ? await log.openEvent(event) : event.data;
    } catch {
      throw unreadable();
    }
    if (body === null || typeof body !== 'object') throw unreadable();
    const record = /** @type {Record<string, unknown>} */ (body);
    if (typeof record['vetoed'] !== 'boolean') throw unreadable();
    if (record['vetoed'] && (typeof record['reason'] !== 'string' || record['reason'] === '')) {
      throw unreadable();
    }
    const royal = record['royalCommand'];
    const signature = record['signature'];
    if (royal === null || typeof royal !== 'object' || Array.isArray(royal)) {
      throw unauthorized('لا أمرَ ملكيَّ في القيد');
    }
    if (typeof signature !== 'string' || signature === '') throw unauthorized('لا توقيع');
    const command = /** @type {Record<string, unknown>} */ (royal);
    /** @type {boolean} */
    let verified;
    try {
      verified = authority.king.verify(command, signature) === true;
    } catch {
      verified = false;
    }
    if (!verified) throw unauthorized('توقيعٌ لا يُقبَلُ بمفتاحِ الملك');
    const spec = record['vetoed'] ? vetoSpec : clearSpec;
    if (
      spec === undefined ||
      command['action'] !== spec.action ||
      command['target'] !== spec.target
    ) {
      throw unauthorized('الأمرُ الموقَّعُ ليس أمرَ هذه الحالة');
    }
    const commandId = typeof command['id'] === 'string' ? command['id'].trim() : '';
    if (commandId === '' || record['commandId'] !== commandId) {
      throw unauthorized('معرّفُ القيدِ لا يطابقُ الأمرَ الموقَّع');
    }
    if (!authority.ledger.has(commandId))
      throw unauthorized('الأمرُ غيرُ مُثبَّتٍ في دفترِ الأوامر');
    if (seen.has(commandId)) throw unauthorized('قيدُ حالةٍ مُعادٌ لأمرٍ ورَدَ قبلَه');
    seen.add(commandId);
    const payload =
      command['payload'] !== null && typeof command['payload'] === 'object'
        ? /** @type {Record<string, unknown>} */ (command['payload'])
        : {};
    const signedReason = typeof payload['reason'] === 'string' ? payload['reason'].trim() : '';
    const reason = record['vetoed']
      ? signedReason === ''
        ? 'blocked by crown'
        : signedReason
      : null;
    if (record['vetoed'] && record['reason'] !== reason) {
      throw unauthorized('سببُ القيدِ غيرُ سببِ الأمرِ الموقَّع');
    }
    last = { vetoed: record['vetoed'], reason, commandId };
  }
  return last;
}

/**
 * ما تتحقّقُ به استعادةُ النقضِ من سلطةِ القيد (‏`WL-352`).
 * @typedef {object} VetoAuthority
 * @property {{ verify: (payload: object, signature: string) => boolean }} king المفتاحُ العامُّ للملك
 * @property {{ has: (id: string) => boolean }} ledger دفترُ الأوامرِ المُحمَّل
 * @property {ReadonlyArray<{ kind: string, action: string, target: string }>} commands أوامرُ الديوانِ المُعلَنة
 */

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
 * @returns {Promise<{ kingAuth: KingAuthenticator, royalConsole: RoyalConsole, restoredVeto: { vetoed: boolean, reason: string | null, commandId: string } | null }>}
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
  // `WL-349`: النقضُ المختومُ يعودُ قبلَ تركيبِ الديوان — فلا أمرَ يمرُّ من بوابةٍ نقضَها الملك.
  const consolePolicy = loadConsolePolicy();
  const restoredVeto = await vetoFromSealedLog(deps.sealedLog, consolePolicy.audit.vetoStateEvent, {
    king: deps.king,
    ledger: /** @type {{ has: (id: string) => boolean }} */ (
      /** @type {unknown} */ (deps.commandLedger)
    ),
    commands: consolePolicy.commands,
  });
  if (restoredVeto !== null && restoredVeto.vetoed) {
    deps.crown.veto.block(/** @type {string} */ (restoredVeto.reason));
  } else if (restoredVeto !== null) {
    deps.crown.veto.clear();
  }
  const nowMs = () => deps.clock.now();
  const kingAuth = new KingAuthenticator({
    policy: authnPolicy,
    king: deps.king,
    log: authnLog,
    factorSecrets: deps.factorSecrets ?? null,
    nowMs,
  });
  const royalConsole = new RoyalConsole({
    policy: consolePolicy,
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
  return { kingAuth, royalConsole, restoredVeto };
}
